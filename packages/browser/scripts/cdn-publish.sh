#!/usr/bin/env bash
# Uploads dist/cdn/{sfere.min.js,sfere.js,manifest.json} to the CDN bucket.
# See docs/CDN-POLICY.md for the URL scheme and caching contract this encodes,
# and docs/RELEASING.md / infra/cdn/README.md for how it's invoked in CI.
#
# Usage:
#   scripts/cdn-publish.sh <version> [--dry-run] [--alias-only] [--latest] [--dist <dir>]
#
#   <version>       bare semver, no leading 'v' (e.g. 0.1.0 or 0.2.0-next.0)
#   --dry-run       print every gcloud command instead of running it
#   --alias-only    only (re-)point the alias path; used for rollback — see
#                   "Rollback" in docs/CDN-POLICY.md. Skips the immutable upload
#                   entirely, so it never needs the immutable files to be rebuilt.
#   --latest        move sdk/latest/ to this version even when the rules below
#                   would not (e.g. rolling latest back across alias lines).
#   --dist <dir>    directory holding {sfere.min.js,sfere.js,manifest.json}
#                   (default: dist/cdn). Point this at a scratch directory to
#                   test the script without touching the repo's own dist/.
#
# Required env:
#   CDN_BUCKET      bare bucket name (no gs:// prefix), e.g. sfere-sdk-cdn
# Optional env:
#   CDN_LATEST_CURRENT  version sdk/latest/ serves now; skips reading it from the
#                       bucket (for --dry-run tests; "none" means no latest yet)
#   GITHUB_OUTPUT       when set (in Actions), gets alias_segment= and latest_moved=
#
# The latest channel, sdk/latest/, is for embeds that can never be edited once
# shipped (an app-store app, a published tag template). It follows the newest
# stable release across every alias line, majors included. A stable publish
# moves it when the version is >= the one it serves, so a patch to an older line
# never drags it back. --alias-only (rollback) moves it only while it is on the
# same alias line, or with --latest. Prereleases never touch it.
#
# Immutability: the immutable path is written with --if-generation-match=0, which
# makes gcloud storage cp fail the upload if an object already exists at that
# name (any generation) — so a re-run can never silently overwrite a previously
# published version; the deploy SA also has no delete permission there. The
# alias path is overwritten on purpose: overwriting needs storage.objects.delete
# (even with versioning on), which the SA holds only under the alias prefixes
# via an IAM Condition (infra/cdn/provision.sh). Object versioning keeps every
# prior alias generation for 90 days (infra/cdn/lifecycle.json).
set -euo pipefail

DIST="dist/cdn"
DRY_RUN=0
ALIAS_ONLY=0
FORCE_LATEST=0
VERSION=""

usage() {
  echo "Usage: $0 <version> [--dry-run] [--alias-only] [--latest] [--dist <dir>]" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --alias-only) ALIAS_ONLY=1; shift ;;
    --latest) FORCE_LATEST=1; shift ;;
    --dist) DIST="$2"; shift 2 ;;
    -h|--help) usage ;;
    -*) echo "Unknown flag: $1" >&2; usage ;;
    *)
      if [ -n "$VERSION" ]; then echo "Unexpected extra argument: $1" >&2; usage; fi
      VERSION="$1"; shift ;;
  esac
done

[ -n "$VERSION" ] || usage
: "${CDN_BUCKET:?CDN_BUCKET env var is required (bare bucket name, no gs:// prefix)}"

case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) : ;;
  *) echo "cdn-publish: '$VERSION' does not look like a semver (X.Y.Z or X.Y.Z-pre)." >&2; exit 1 ;;
esac

for f in sfere.min.js sfere.js manifest.json; do
  [ -f "$DIST/$f" ] || { echo "cdn-publish: missing $DIST/$f (run \`npm run build && npm run cdn:manifest\` first)." >&2; exit 1; }
done

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

content_type_for() {
  case "$1" in
    *.json) echo "application/json; charset=utf-8" ;;
    *.js) echo "application/javascript; charset=utf-8" ;;
    *) echo "application/octet-stream" ;;
  esac
}

# --- alias segment: v{major} at >=1.0.0, v0.{minor} while 0.x. Prereleases
# (a '-' in the version) never touch the alias — there is nothing to point it at
# that downstream consumers should pick up automatically.
IS_PRERELEASE=0
case "$VERSION" in *-*) IS_PRERELEASE=1 ;; esac

MAJOR="${VERSION%%.*}"
REST="${VERSION#*.}"
MINOR="${REST%%.*}"
if [ "$MAJOR" -ge 1 ] 2>/dev/null; then
  ALIAS_SEGMENT="v${MAJOR}"
else
  ALIAS_SEGMENT="v0.${MINOR}"
fi

IMMUTABLE_PREFIX="gs://${CDN_BUCKET}/sdk/v${VERSION}"
ALIAS_PREFIX="gs://${CDN_BUCKET}/sdk/${ALIAS_SEGMENT}"
LATEST_PREFIX="gs://${CDN_BUCKET}/sdk/latest"

alias_segment_of() {
  local v="$1" major rest
  major="${v%%.*}"
  rest="${v#*.}"
  if [ "$major" -ge 1 ] 2>/dev/null; then echo "v${major}"; else echo "v0.${rest%%.*}"; fi
}

# The version sdk/latest/ serves now, from its manifest.json; empty when there
# is none yet. Any other read failure stops the publish rather than guess, since
# guessing wrong could move latest backwards.
current_latest() {
  if [ -n "${CDN_LATEST_CURRENT:-}" ]; then
    [ "$CDN_LATEST_CURRENT" = "none" ] || echo "$CDN_LATEST_CURRENT"
    return 0
  fi
  local out
  if out="$(gcloud storage cat "${LATEST_PREFIX}/manifest.json" 2>&1)"; then
    printf '%s\n' "$out" | sed -nE 's/^ *"version": *"([^"]+)".*/\1/p' | head -n1
    return 0
  fi
  # "Not found" wording differs across gcloud versions: current gcloud prints
  # "The following URLs matched no objects or files:", older ones "No URLs
  # matched". Everything else (403 and up) is a real failure and must stop the
  # publish — see the 2026-10-05 run, which aborted on this exact message.
  if printf '%s\n' "$out" | grep -qiE 'matched no objects|No URLs matched|not found|404'; then
    return 0
  fi
  echo "cdn-publish: could not read ${LATEST_PREFIX}/manifest.json:" >&2
  printf '%s\n' "$out" >&2
  return 1
}

# Strictly-semver-ordered ">=" for stable X.Y.Z versions.
version_gte() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]
}

upload_immutable() {
  local file="$1"
  local ct
  ct="$(content_type_for "$file")"
  # --if-generation-match=0 means "only create if no object (any generation)
  # exists at this name yet" — the atomic form of immutability, enforced by GCS
  # itself rather than by racy pre-check-then-upload logic.
  run gcloud storage cp "$DIST/$file" "${IMMUTABLE_PREFIX}/${file}" \
    --if-generation-match=0 \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "$ct" \
    --custom-metadata "sfere-sdk-version=${VERSION}"
}

upload_alias() {
  local file="$1" prefix="$2"
  local ct
  ct="$(content_type_for "$file")"
  run gcloud storage cp "$DIST/$file" "${prefix}/${file}" \
    --cache-control "public, max-age=300, stale-while-revalidate=86400" \
    --content-type "$ct" \
    --custom-metadata "sfere-sdk-version=${VERSION}"
}

# Decide on latest before uploading anything, so a failed read of the current
# latest stops the publish before any object moves.
MOVE_LATEST=0
WHY=""
if [ "$IS_PRERELEASE" -eq 0 ]; then
  CURRENT="$(current_latest)"
  if [ "$FORCE_LATEST" -eq 1 ]; then
    MOVE_LATEST=1; WHY="--latest given"
  elif [ -z "$CURRENT" ]; then
    MOVE_LATEST=1; WHY="sdk/latest/ does not exist yet"
  elif [ "$ALIAS_ONLY" -eq 1 ] && [ "$(alias_segment_of "$CURRENT")" = "$ALIAS_SEGMENT" ]; then
    MOVE_LATEST=1; WHY="rollback on latest's own line (${ALIAS_SEGMENT}, now v${CURRENT})"
  elif version_gte "$VERSION" "$CURRENT"; then
    MOVE_LATEST=1; WHY="v${VERSION} >= v${CURRENT}"
  else
    MOVE_LATEST=0; WHY="latest serves v${CURRENT}, newer than v${VERSION} on another line (pass --latest to force)"
  fi
fi

if [ "$ALIAS_ONLY" -eq 0 ]; then
  echo "Publishing immutable v${VERSION} to ${IMMUTABLE_PREFIX}/ ..."
  for f in sfere.min.js sfere.js manifest.json; do
    upload_immutable "$f"
  done
else
  echo "--alias-only: skipping immutable upload for v${VERSION}."
fi

LATEST_MOVED=false
if [ "$IS_PRERELEASE" -eq 1 ]; then
  echo "Prerelease version ($VERSION): not touching the ${ALIAS_SEGMENT} alias or latest."
else
  echo "Pointing alias ${ALIAS_SEGMENT} at v${VERSION} (${ALIAS_PREFIX}/) ..."
  for f in sfere.min.js sfere.js manifest.json; do
    upload_alias "$f" "$ALIAS_PREFIX"
  done

  if [ "$MOVE_LATEST" -eq 1 ]; then
    echo "Pointing latest at v${VERSION} (${LATEST_PREFIX}/): ${WHY} ..."
    for f in sfere.min.js sfere.js manifest.json; do
      upload_alias "$f" "$LATEST_PREFIX"
    done
    LATEST_MOVED=true
  else
    echo "Leaving latest alone: ${WHY}."
  fi
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "alias_segment=${ALIAS_SEGMENT}" >> "$GITHUB_OUTPUT"
  echo "latest_moved=${LATEST_MOVED}" >> "$GITHUB_OUTPUT"
fi

echo "Done."

#!/usr/bin/env bash
# Uploads a package's dist/cdn/ bundles plus manifest.json to the CDN bucket. Run from the
# package directory. The browser SDK uses the defaults: {sfere.min.js,sfere.js,manifest.json}
# under sdk/. A package with a `sfereCdn` block in its package.json (packages/salla) sets its
# own path prefix and file list, e.g. integrations/salla/ + sfere-salla.min.js.
# See docs/CDN-POLICY.md for the URL scheme and caching contract this encodes,
# and docs/RELEASING.md / infra/cdn/README.md for how it's invoked in CI.
#
# Usage:
#   scripts/cdn-publish.sh <version> [--dry-run] [--alias-only] [--dist <dir>]
#
#   <version>       bare semver, no leading 'v' (e.g. 0.1.0 or 0.2.0-next.0)
#   --dry-run       print every gcloud command instead of running it
#   --alias-only    only (re-)point the alias path; used for rollback — see
#                   "Rollback" in docs/CDN-POLICY.md. Skips the immutable upload
#                   entirely, so it never needs the immutable files to be rebuilt.
#   --dist <dir>    directory holding the bundles and manifest.json
#                   (default: dist/cdn). Point this at a scratch directory to
#                   test the script without touching the repo's own dist/.
#
# Required env:
#   CDN_BUCKET      bare bucket name (no gs:// prefix), e.g. sfere-sdk-cdn
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
VERSION=""

usage() {
  echo "Usage: $0 <version> [--dry-run] [--alias-only] [--dist <dir>]" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --alias-only) ALIAS_ONLY=1; shift ;;
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

# Path prefix and files from package.json's `sfereCdn` (defaults: the browser SDK's).
PREFIX="sdk"
FILES="sfere.min.js sfere.js"
META="sfere-sdk-version=${VERSION}"
if [ -f package.json ] && [ "$(node -p 'Boolean(require("./package.json").sfereCdn)')" = "true" ]; then
  PREFIX="$(node -p 'require("./package.json").sfereCdn.prefix')"
  FILES="$(node -p 'require("./package.json").sfereCdn.files.join(" ")')"
  META="sfere-package=$(node -p 'require("./package.json").name'),sfere-version=${VERSION}"
fi
case "$PREFIX" in
  sdk|integrations/[a-z0-9-]*) : ;;
  *) echo "cdn-publish: unexpected CDN prefix '$PREFIX' (sdk or integrations/<name>)." >&2; exit 1 ;;
esac
FILES="$FILES manifest.json"

for f in $FILES; do
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

IMMUTABLE_PREFIX="gs://${CDN_BUCKET}/${PREFIX}/v${VERSION}"
ALIAS_PREFIX="gs://${CDN_BUCKET}/${PREFIX}/${ALIAS_SEGMENT}"

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
    --custom-metadata "$META"
}

upload_alias() {
  local file="$1"
  local ct
  ct="$(content_type_for "$file")"
  run gcloud storage cp "$DIST/$file" "${ALIAS_PREFIX}/${file}" \
    --cache-control "public, max-age=300, stale-while-revalidate=86400" \
    --content-type "$ct" \
    --custom-metadata "$META"
}

if [ "$ALIAS_ONLY" -eq 0 ]; then
  echo "Publishing immutable v${VERSION} to ${IMMUTABLE_PREFIX}/ ..."
  for f in $FILES; do
    upload_immutable "$f"
  done
else
  echo "--alias-only: skipping immutable upload for v${VERSION}."
fi

if [ "$IS_PRERELEASE" -eq 1 ]; then
  echo "Prerelease version ($VERSION): not touching the ${ALIAS_SEGMENT} alias."
else
  echo "Pointing alias ${ALIAS_SEGMENT} at v${VERSION} (${ALIAS_PREFIX}/) ..."
  for f in $FILES; do
    upload_alias "$f"
  done
fi

echo "Done."

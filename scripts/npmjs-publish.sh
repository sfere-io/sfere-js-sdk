#!/usr/bin/env bash
# Mirrors one package version, already published to GitHub Packages, to the
# public npm registry (registry.npmjs.org) with public access, so users can
# `npm install` it without a token. Called by release.yml's "Tag the published
# versions" step for each version that run released. See docs/RELEASING.md.
#
# Usage:
#   scripts/npmjs-publish.sh <name> <version> <tarball>
#
#   <name>      package name, e.g. @sfere-io/sfere-sdk
#   <version>   bare semver, e.g. 0.4.2
#   <tarball>   the .tgz downloaded back from GitHub Packages. It is published
#               to npmjs unchanged, so both registries serve the same bytes.
#
# Env:
#   NPM_PUBLISH_TOKEN  npm automation (or granular, 2FA-bypassing) token with
#                      write access to the @sfere-io scope. Empty: nothing is
#                      published or checked, a ::warning:: is printed, exit 0.
#   DRY_RUN=1          run `npm publish --dry-run` and skip the download-back.
#
# Prints exactly one word on stdout: `published`, `exists` (already on npmjs,
# e.g. a re-run) or `skipped` (no token). Everything else goes to stderr.
#
# Registry routing, verified with `npm publish --dry-run` on npm 10 and 11:
#   - publishConfig.registry (npm.pkg.github.com, in the tarball's package.json)
#     beats `npm_config_registry` from the environment, but not `--registry`.
#   - A scope line `@sfere-io:registry=https://npm.pkg.github.com/` (what
#     actions/setup-node writes) beats `--registry` for publish, view and pack.
# So every npm call below gets its own userconfig with no GitHub scope line,
# plus explicit `--registry` and `--@sfere-io:registry` flags, and the publish
# is preceded by a dry run that must name registry.npmjs.org.
set -euo pipefail

NAME="${1:?usage: npmjs-publish.sh <name> <version> <tarball>}"
VERSION="${2:?usage: npmjs-publish.sh <name> <version> <tarball>}"
TARBALL="${3:?usage: npmjs-publish.sh <name> <version> <tarball>}"
NPMJS="https://registry.npmjs.org/"
SCOPE="${NAME%%/*}"

log() { echo "$@" >&2; }

[ -f "$TARBALL" ] || { log "::error::tarball not found: $TARBALL"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

# Anonymous config: what an end user without any token has.
ANON_RC="$WORK/anonymous.npmrc"
printf 'registry=%s\n%s:registry=%s\n' "$NPMJS" "$SCOPE" "$NPMJS" > "$ANON_RC"
npmjs_anon() { (cd "$WORK" && npm "$@" --userconfig "$ANON_RC" --registry "$NPMJS" "--$SCOPE:registry=$NPMJS"); }

# No token: skip before contacting npmjs at all, so a missing secret can never
# fail the release.
if [ -z "${NPM_PUBLISH_TOKEN:-}" ]; then
  log "::warning::NPM_TOKEN is not set: $NAME@$VERSION was published to GitHub Packages only, not to registry.npmjs.org. Add the NPM_TOKEN repository secret before the next release (docs/RELEASING.md)."
  echo skipped
  exit 0
fi

# Already there? (idempotent re-runs). A 404 (no such package, or no such
# version: E404 on npm 10 and 11) means "not yet"; any other error fails.
if OUT="$(npmjs_anon view "$NAME@$VERSION" version 2>"$WORK/view.err")" && [ "$OUT" = "$VERSION" ]; then
  log "$NAME@$VERSION is already on registry.npmjs.org; not publishing it again."
  echo exists
  exit 0
fi
grep -vE '^npm (warn|notice)' "$WORK/view.err" > "$WORK/view.errors" || true
if [ -s "$WORK/view.errors" ] && ! grep -q "E404" "$WORK/view.errors"; then
  cat "$WORK/view.err" >&2
  log "::error::could not check $NAME@$VERSION on registry.npmjs.org."
  exit 1
fi

# Mirror the dist-tag the version got on GitHub Packages (latest, or the
# prerelease tag Changesets used, e.g. next). Read through the caller's own npm
# config, which points the scope at GitHub Packages.
DIST_TAG="$(npm view "$NAME" dist-tags --json 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let t={};try{t=JSON.parse(s)}catch{};const hit=Object.keys(t).find(k=>t[k]===process.argv[1]);process.stdout.write(hit||"")})' "$VERSION" || true)"
if [ -z "$DIST_TAG" ]; then
  case "$VERSION" in *-*) DIST_TAG=next ;; *) DIST_TAG=latest ;; esac
fi

# The token is handed to npm as NODE_AUTH_TOKEN, only for these calls.
AUTH_RC="$WORK/npmjs.npmrc"
printf 'registry=%s\n%s:registry=%s\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' "$NPMJS" "$SCOPE" "$NPMJS" > "$AUTH_RC"
npmjs_publish() {
  (cd "$WORK" && NODE_AUTH_TOKEN="$NPM_PUBLISH_TOKEN" npm publish "$TARBALL" \
    --userconfig "$AUTH_RC" --registry "$NPMJS" "--$SCOPE:registry=$NPMJS" \
    --access public --tag "$DIST_TAG" --ignore-scripts "$@")
}

# Guard: a dry run must target registry.npmjs.org before anything is sent.
npmjs_publish --dry-run > "$WORK/dry.out" 2>&1 || { cat "$WORK/dry.out" >&2; exit 1; }
if ! grep -q "Publishing to https://registry.npmjs.org/ with tag $DIST_TAG and public access" "$WORK/dry.out"; then
  cat "$WORK/dry.out" >&2
  log "::error::npm would not publish $NAME@$VERSION to registry.npmjs.org with public access; refusing."
  exit 1
fi
log "Dry run targets registry.npmjs.org (tag $DIST_TAG, public access)."

if [ "${DRY_RUN:-}" = "1" ]; then
  log "DRY_RUN=1: stopping before the real publish of $NAME@$VERSION."
  echo published
  exit 0
fi

npmjs_publish >&2

# Download it back without any token, exactly as a user would, and require the
# dist/ entry points. npmjs can answer 404 for a short while after a publish.
for attempt in $(seq 1 12); do
  if npmjs_anon pack "$NAME@$VERSION" --json > "$WORK/pack.json" 2>"$WORK/pack.err"; then
    break
  fi
  if [ "$attempt" -eq 12 ]; then
    cat "$WORK/pack.err" >&2
    log "::error::$NAME@$VERSION was published to registry.npmjs.org but cannot be downloaded back."
    exit 1
  fi
  log "registry.npmjs.org does not serve $NAME@$VERSION yet; retrying in 15 s ($attempt/12)."
  sleep 15
done
for f in dist/index.js dist/index.cjs dist/index.d.ts; do
  if ! node -e "process.exit(require('$WORK/pack.json')[0].files.some(x => x.path === '$f') ? 0 : 1)"; then
    log "::error::$NAME@$VERSION on registry.npmjs.org has no $f: the published package is broken."
    exit 1
  fi
done
log "registry.npmjs.org copy of $NAME@$VERSION downloads without a token and contains its dist/ entry points."
echo published

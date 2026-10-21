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
# Authentication, first match wins:
#   1. NPM_PUBLISH_TOKEN set: npm token with write access to the @sfere-io
#      scope that publishes without a one-time password. Kept while the
#      release moves to Trusted Publishing; remove the NPM_TOKEN secret once
#      Trusted Publishing works (docs/RELEASING.md).
#   2. GitHub Actions with `permissions: id-token: write`
#      (GITHUB_ACTIONS=true, ACTIONS_ID_TOKEN_REQUEST_URL and
#      ACTIONS_ID_TOKEN_REQUEST_TOKEN set): npm Trusted Publishing. No token
#      is written anywhere: `npm publish` (npm >= 11.5.1) exchanges the job's
#      OIDC token for a short-lived publish token and attaches provenance.
#      Needs a trusted publisher entry for the package on npmjs.com.
#   3. Neither: nothing is published or checked, a ::warning:: is printed,
#      exit 0.
# With `id-token: write` granted, npm also tries the OIDC exchange in case 1
# and uses the exchanged token when it succeeds, so a leftover NPM_TOKEN does
# not get in the way of Trusted Publishing.
#
# Env:
#   NPM_PUBLISH_TOKEN  see case 1 above. Empty or unset: case 2 or 3.
#   DRY_RUN=1          run `npm publish --dry-run` and skip the download-back.
#
# Prints exactly one word on stdout: `published`, `exists` (already on npmjs,
# e.g. a re-run) or `skipped` (no token and no OIDC). Everything else goes to
# stderr.
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

# Pick the credentials. Neither a token nor OIDC: skip before contacting npmjs
# at all, so a run without either can never fail the release.
if [ -n "${NPM_PUBLISH_TOKEN:-}" ]; then
  AUTH_MODE=token
  log "Authenticating to registry.npmjs.org with NPM_PUBLISH_TOKEN."
elif [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
  AUTH_MODE=oidc
  log "Authenticating to registry.npmjs.org with Trusted Publishing (GitHub Actions OIDC)."
else
  log "::warning::Neither NPM_TOKEN nor Trusted Publishing is available: $NAME@$VERSION was published to GitHub Packages only, not to registry.npmjs.org. Set up npm Trusted Publishing for this package and grant the job \`id-token: write\` (docs/RELEASING.md, \"Trusted Publishing\")."
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

# Trusted Publishing needs npm 11.5.1 or newer; older versions publish without
# credentials and fail with ENEEDAUTH. Say so plainly instead.
if [ "$AUTH_MODE" = oidc ]; then
  NPM_VERSION="$(npm --version)"
  if ! node -e 'const [a, b, c] = process.argv[1].split(/[.-]/).map(Number); process.exit(a > 11 || (a === 11 && (b > 5 || (b === 5 && c >= 1))) ? 0 : 1)' "$NPM_VERSION"; then
    log "::error::Trusted Publishing needs npm 11.5.1 or newer, this job runs npm $NPM_VERSION."
    exit 1
  fi
fi

# Mirror the dist-tag the version got on GitHub Packages (latest, or the
# prerelease tag Changesets used, e.g. next). Read through the caller's own npm
# config, which points the scope at GitHub Packages.
DIST_TAG="$(npm view "$NAME" dist-tags --json 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let t={};try{t=JSON.parse(s)}catch{};const hit=Object.keys(t).find(k=>t[k]===process.argv[1]);process.stdout.write(hit||"")})' "$VERSION" || true)"
if [ -z "$DIST_TAG" ]; then
  case "$VERSION" in *-*) DIST_TAG=next ;; *) DIST_TAG=latest ;; esac
fi

# Same routing for both modes. Token mode: the token is handed to npm as
# NODE_AUTH_TOKEN, only for these calls. OIDC mode: the userconfig has no
# _authToken line and NODE_AUTH_TOKEN (the GitHub Packages token in
# release.yml) is removed, so the only credential npm can use for
# registry.npmjs.org is the one it gets from the OIDC exchange.
AUTH_RC="$WORK/npmjs.npmrc"
printf 'registry=%s\n%s:registry=%s\n' "$NPMJS" "$SCOPE" "$NPMJS" > "$AUTH_RC"
if [ "$AUTH_MODE" = token ]; then
  printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' >> "$AUTH_RC"
fi
PUBLISH_ARGS=(publish "$TARBALL" --userconfig "$AUTH_RC" --registry "$NPMJS" "--$SCOPE:registry=$NPMJS"
  --access public --tag "$DIST_TAG" --ignore-scripts)
npmjs_publish() {
  if [ "$AUTH_MODE" = token ]; then
    (cd "$WORK" && NODE_AUTH_TOKEN="$NPM_PUBLISH_TOKEN" npm "${PUBLISH_ARGS[@]}" "$@")
  else
    (cd "$WORK" && env -u NODE_AUTH_TOKEN npm "${PUBLISH_ARGS[@]}" "$@")
  fi
}

# Guard: a dry run must target registry.npmjs.org before anything is sent.
# In OIDC mode npm already performs the token exchange during the dry run, and
# warns that it is not logged in when the exchange failed.
npmjs_publish --dry-run > "$WORK/dry.out" 2>&1 || { cat "$WORK/dry.out" >&2; exit 1; }
if [ "$AUTH_MODE" = oidc ] && grep -q "requires you to be logged in" "$WORK/dry.out"; then
  cat "$WORK/dry.out" >&2
  WORKFLOW_FILE="${GITHUB_WORKFLOW_REF:-<workflow>.yml}"
  WORKFLOW_FILE="${WORKFLOW_FILE%%@*}"
  log "::error::npm could not exchange this job's OIDC token for a publish token for $NAME. On npmjs.com the package needs a trusted publisher (GitHub Actions) for repository ${GITHUB_REPOSITORY:-<owner/repo>} and workflow filename ${WORKFLOW_FILE##*/} (plus the job's environment, if it has one), with npm publish allowed (docs/RELEASING.md, \"Trusted Publishing\")."
  exit 1
fi
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

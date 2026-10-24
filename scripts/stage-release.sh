#!/usr/bin/env bash
# Stages every public workspace package whose version is not on
# registry.npmjs.org yet, with `npm stage publish`. A staged version is not
# installable until a maintainer approves it with 2FA (`npm stage approve`, or
# on npmjs.com). Runs as release.yml's `publish-script` (`npm run release`),
# i.e. only when no changesets are pending. See docs/RELEASING.md, "Approving
# a staged release".
#
# For each version it stages, it pushes a `staged/<tag>` git tag at HEAD:
# `staged/vX.Y.Z` for the browser SDK, `staged/<name>@X.Y.Z` for the others.
# That marker records which commit the staged bytes were built from (the
# finishing run tags that commit, not whatever main is by then), and tells a
# later run the version is already staged. The job's OIDC token cannot run
# `npm stage list`, so CI has no other way to know.
#
# Authentication: npm Trusted Publishing (the job's `id-token: write`). The
# trusted publisher entry on npmjs.com needs no extra permission:
# `npm stage publish` is always allowed.
#
# Env:
#   DRY_RUN=1   run `npm stage publish --dry-run` and push no marker.
set -euo pipefail

BROWSER="@sfere.io/sfere-sdk"
NPMJS="https://registry.npmjs.org/"

# Changesets pre mode (.changeset/pre.json) publishes under its tag (e.g. next).
PRE_TAG="$(node -p "try { const p = require('./.changeset/pre.json'); p.mode === 'pre' ? p.tag : '' } catch { '' }")"

for manifest in packages/*/package.json; do
  if [ "$(node -p "require('./$manifest').private === true")" = "true" ]; then continue; fi
  NAME="$(node -p "require('./$manifest').name")"
  V="$(node -p "require('./$manifest').version")"
  if [ "$NAME" = "$BROWSER" ]; then TAG="v$V"; else TAG="$NAME@$V"; fi
  MARKER="staged/$TAG"

  # Anonymous read, as a user installs: an approved version is simply there.
  if npm view "$NAME@$V" version --registry "$NPMJS" > /dev/null 2>&1; then
    echo "$NAME@$V is already on registry.npmjs.org; nothing to stage."
    continue
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/$MARKER" > /dev/null; then
    echo "$NAME@$V is already staged ($MARKER); waiting for approval."
    continue
  fi

  if [ -n "$PRE_TAG" ]; then
    DIST_TAG="$PRE_TAG"
  else
    case "$V" in *-*) DIST_TAG=next ;; *) DIST_TAG=latest ;; esac
  fi

  if [ "${DRY_RUN:-}" = "1" ]; then
    npm stage publish -w "$NAME" --access public --tag "$DIST_TAG" --registry "$NPMJS" --dry-run
    continue
  fi
  npm stage publish -w "$NAME" --access public --tag "$DIST_TAG" --registry "$NPMJS"
  git tag "$MARKER" HEAD
  git push origin "refs/tags/$MARKER"
  echo "Staged $NAME@$V with tag $DIST_TAG ($MARKER at $(git rev-parse --short HEAD))."
done

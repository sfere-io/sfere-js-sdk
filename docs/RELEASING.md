# Releasing

How a release of `@sfere-io/sfere-sdk` and `@sfere-io/sfere-node` actually
happens, end to end. For what
each CI job checks, see `CI.md`. For the CDN side specifically, see
`CDN-POLICY.md` and `../infra/cdn/README.md`.

## The short version

1. Add a changeset on your branch/PR.
2. Merge the PR to `main` like normal.
3. `release.yml` opens (or updates) a **"Version Packages"** PR.
4. Merging *that* PR is what actually ships: publish (GitHub Packages, then
   the public npm registry), tag, GitHub release, CDN deploy.

Nothing publishes on a normal PR merge — only merging the Version Packages PR
does.

## 1. Add a changeset

On your feature branch, once you've made a user-facing change under `src/`:

```sh
npx changeset
```

It asks for a bump type (`patch` / `minor` / `major`) and a summary; it writes
a markdown file under `.changeset/`. Commit that file with the rest of your
PR. A PR that only touches `docs/`, `.github/`, or other non-shipping paths
doesn't need one — the "changeset added?" checkbox in the PR template is a
reminder, not an automated gate.

## 2. What happens automatically after merge

`release.yml` runs on every push to `main`:

1. The full `ci.yml` gate runs first (reused via `workflow_call`) — a release
   can never publish bytes that didn't pass the same checks as a PR.
2. **Changesets decides what's next:**
   - **Pending changesets exist** → it opens/updates the "Version Packages"
     PR: `package.json`'s version bump, a compiled `CHANGELOG.md` entry, and
     the `.changeset/*.md` files consumed. Nothing is published yet.
   - **No pending changesets** (this push *is* that PR's merge) → it
     publishes every public workspace package whose `package.json` version is
     not yet on GitHub Packages (`@sfere-io/sfere-sdk`, `@sfere-io/sfere-node`).
   `publishConfig.registry` in each `package.json` points this publish at
   GitHub Packages.
   The publish job builds every package first (`npm run build`); each
   package's `prepublishOnly` also refuses to publish without `dist/`.
   Releases up to `sfere-sdk` 0.3.1 and `sfere-node` 0.1.0 were published
   **without `dist/`** (no build in this job); the CDN was never affected.
   Those versions (`sfere-sdk` 0.1.0, 0.2.0, 0.3.0, 0.3.1 and `sfere-node`
   0.1.0) were deleted from GitHub Packages on 2026-09-29. The earliest
   installable versions are `sfere-sdk` 0.3.2 and `sfere-node` 0.1.1.
3. Before tagging, the release downloads each newly published version back
   from GitHub Packages and fails unless it contains its `dist/` entry points.
   It then publishes that same tarball to the public npm registry
   (`registry.npmjs.org`, public access) and downloads it back from there
   without a token, with the same `dist/` check. See
   [Publishing to the public npm registry](#publishing-to-the-public-npm-registry).
   Only once every package has passed both does each one get a tag: `vX.Y.Z`
   for the browser SDK, `@sfere-io/sfere-node@X.Y.Z` for the Node SDK.
4. On a successful browser publish: dist is
   rebuilt from that tag (deterministically — same inputs as `ci.yml`'s
   build), and two GitHub releases are cut:
   - **Browser SDK vX.Y.Z** on `vX.Y.Z`, with `dist/cdn/sfere.min.js`,
     `dist/cdn/sfere.js` and `dist/cdn/manifest.json` attached. It stays the
     repository's "Latest" release.
   - **React vX.Y.Z** on a new `react-vX.Y.Z` tag at the same commit. React
     ships inside `@sfere-io/sfere-sdk` (the `/react` subpath), so this page
     shares the browser version; it carries React install and import notes.

   Then `cdn-deploy.yml` is called to publish the CDN files.
   (Paths are under `packages/browser/` since the workspace layout.)
5. On a successful Node publish (with or without a browser one), the
   `release-node` job cuts **Node SDK vX.Y.Z** on its
   `@sfere-io/sfere-node@X.Y.Z` tag.

Every release page quotes that version's `CHANGELOG.md` section.

You don't do any of steps 3–5 by hand — merging the Version Packages PR is the
only manual action.

Two things worth knowing about that PR:

- It is opened by `changesets/action` with the workflow's `GITHUB_TOKEN`, and
  GitHub does not start `pull_request` workflows for events created by that
  token, so the Version Packages PR itself shows **no CI checks**. Nothing is
  lost: merging it pushes to `main`, and `release.yml` runs the full `ci.yml`
  gate before it publishes anything.
- **`main` requires `check` and `e2e` on every PR** (ruleset "protect main",
  2026-09-29), so that PR shows as blocked. An org admin merges it through the
  ruleset's pull-request bypass:

  ```sh
  gh pr merge <number> --merge --admin
  ```

  Only use `--admin` on the Version Packages PR. Every other PR merges once its
  checks are green.
- The setting **"Allow GitHub Actions to create and approve pull requests"**
  must be on at both the organisation level and the repository level (Actions →
  General), or the action cannot open it. Both are on as of 2026-09-28.

### Starting a new alias line (new minor while 0.x, new major after 1.0)

The CDN deploy service account may overwrite only the alias prefixes it was
provisioned for (an IAM Condition enumerates them — `../infra/cdn/README.md`
"Alias overwrite"). The *first* release on a new line (e.g. `0.2.0` creating
`/sdk/v0.2/`) works without any change; the *second* one (e.g. `0.2.1`,
overwriting `/sdk/v0.2/`) fails on the alias upload until someone re-runs
`infra/cdn/provision.sh` with `CDN_ALIASES` including the new line. Do that
right after the first release of the line. If a deploy already failed on the
alias, the immutable files are published, so a plain re-run stops on the
immutability guard (HTTP 412); re-point only the alias instead:

```sh
CDN_ALIASES="v0.1 v0.2 v0.3 v0.4" infra/cdn/provision.sh
gh workflow run cdn-deploy.yml --ref main -f version=<X.Y.Z> -f alias_only=true
```

As of 2026-09-29 the deploy account may overwrite `v0.1` to `v0.4`, so the
next line that needs this is `v0.5`. `sdk/latest/` is always in the condition
(`provision.sh` adds it), so it never needs a re-run of its own.

### Before releasing a major

A major also moves `/sdk/latest/`, which app-store apps and other embeds nobody
can edit load. Check that an unchanged loader snippet still works against the
new build before merging the Version Packages PR (see `CDN-POLICY.md`, "The
latest channel").

## Prerelease flow

To ship a `-next` prerelease line (e.g. testing a breaking change before
committing to it):

```sh
npx changeset pre enter next
git add .changeset/pre.json
git commit -m "chore: enter next prerelease mode"
```

While in this mode, every merged changeset bumps a `-next.N` version instead
of a normal one, and `release.yml`'s publish step ships it under the npm
dist-tag `next` (Changesets does this automatically while `.changeset/pre.json`
is present, with nothing extra to configure). The npmjs copy gets the same
dist-tag: `scripts/npmjs-publish.sh` reads it from GitHub Packages. A consumer opts in with
`npm install @sfere-io/sfere-sdk@next`; `npm install @sfere-io/sfere-sdk`
(no tag) is unaffected.

A prerelease's CDN files still publish to their own immutable path
(`/sdk/v1.5.0-next.0/...`) — but, per `CDN-POLICY.md`, **never** to an alias.

To leave prerelease mode once you're ready to cut a normal release:

```sh
npx changeset pre exit
git add .changeset/pre.json
git commit -m "chore: exit next prerelease mode"
```

## Hotfix

There's no separate hotfix branch model — `main` is always releasable. To
ship a fix fast:

1. Branch from `main`, fix, add a changeset (`patch` in the overwhelming
   majority of cases), PR, merge.
2. Merge the resulting Version Packages PR immediately rather than letting
   other changesets accumulate into it first — it publishes whatever's
   pending at merge time, so keep that PR small when the fix is urgent.

## Rollback

**Un-publishing from GitHub Packages or npmjs, or deleting a tag, is not the
rollback path.** Those are immutable by design (see `CDN-POLICY.md`), and
npmjs never lets a version number be reused, even after an unpublish. To roll back
what's actually being served:

- **npm consumers**: they pin a version already; nothing to do on your side
  beyond publishing a new patch and telling them to move off the bad one.
- **CDN alias consumers**: re-point the alias at the last-known-good version
  without touching anything else:

  ```sh
  gh workflow run cdn-deploy.yml --ref main -f version=<last-known-good, e.g. 1.4.1> -f alias_only=true
  ```

  The version is **bare** (`1.4.1`, not `v1.4.1`); a leading `v` makes the
  checkout look for tag `vv1.4.1` and fail. This runs `cdn-deploy.yml` via
  `workflow_dispatch`, which rebuilds that
  tag deterministically and runs `scripts/cdn-publish.sh <version>
  --alias-only` — see `CDN-POLICY.md` "Rollback" for why `--alias-only`
  matters (it never touches the bad version's immutable files, and never
  re-publishes anything to npm). Without `alias_only=true` the workflow
  attempts a full publish, and the immutable upload is refused by
  `--if-generation-match=0` because that version already exists.

## Required secrets, variables and environments

| Name | Kind | Used by | Notes |
|---|---|---|---|
| `SONAR_TOKEN` | secret | `ci.yml` (`sonar` job) | Optional — the job skips cleanly (step-summary note) if unset. |
| `WIF_PROVIDER` | repo variable | `cdn-deploy.yml` | Full WIF provider resource name. See `../infra/cdn/README.md`. |
| `CDN_DEPLOY_SA` | repo variable | `cdn-deploy.yml` | The deploy service account's email. |
| `GCP_PROJECT_ID` | repo variable | `cdn-deploy.yml` | `koratona-9791a`. |
| `CDN_BUCKET` | repo variable | `cdn-deploy.yml` | Bare bucket name, no `gs://`. |
| `CDN_BASE_URL` | repo variable | `cdn-deploy.yml` | `https://cdn.sfere.io`. Optional — the post-deploy smoke test is skipped (not failed) when unset. |
| `cdn-production` | GitHub Environment | `cdn-deploy.yml` (`deploy` job) | Deployments only from `main`. No required reviewer (not available on the organisation's plan for private repos), see `CDN-POLICY.md` "Who approves". |
| `GITHUB_TOKEN` | built-in | `release.yml` | Used as `NODE_AUTH_TOKEN` to publish to and read from GitHub Packages, by `changesets/action` (its default token) for the Version Packages PR, and for the tag push / GitHub release. No manual setup. |
| `NPM_TOKEN` | secret | `release.yml` (tag step, via `scripts/npmjs-publish.sh`) | **Being retired.** npm token for registry.npmjs.org, used only while it is set. Delete it once a release has been published through Trusted Publishing, see [Trusted Publishing](#trusted-publishing). |
| Trusted publisher | npmjs.com package setting | `release.yml` (`version-or-publish` job, `id-token: write`) | One entry on each of `@sfere-io/sfere-sdk` and `@sfere-io/sfere-node`. Replaces `NPM_TOKEN`; nothing to store in GitHub. See [Trusted Publishing](#trusted-publishing). |

All of the above except the npm entries were set on the repository (then
`sfere-io/sfere-sdk`, now `sfere-io/sfere-js-sdk`) on 2026-09-28, and the CDN
infrastructure is provisioned. Current values and resource names are in
`OPERATIONS.md`. `NPM_TOKEN` was added on 2026-10-21, but its token asks for a
one-time password, so the 0.4.2 / 0.2.2 release failed on the npmjs publish
with `EOTP` (see [First publish by hand](#first-publish-by-hand)).

## Publishing to the public npm registry

GitHub Packages demands a token even to install a public package, so every
release is also published to `registry.npmjs.org` with public access. Users
install with a plain `npm install @sfere-io/sfere-sdk` or
`npm install @sfere-io/sfere-node`. GitHub Packages stays as the first publish
target and a mirror for maintainers. The first versions on npmjs are
`@sfere-io/sfere-sdk` 0.4.2 and `@sfere-io/sfere-node` 0.2.2. Earlier versions
are not copied there.

### One-time setup (organisation owner)

1. Create the npm organisation **`sfere-io`** on npmjs.com (it owns the
   `@sfere-io` scope; the free plan allows unlimited public packages).
2. Publish the first version of each package by hand, because a trusted
   publisher can only be added to a package that already exists on npmjs:
   [First publish by hand](#first-publish-by-hand).
3. Add a trusted publisher to both packages:
   [Trusted Publishing](#trusted-publishing).

### Trusted Publishing

The release publishes to npmjs with
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers): no npm
token is stored in GitHub. The `version-or-publish` job in `release.yml` has
`permissions: id-token: write` and installs npm 11.21.0 (Trusted Publishing
needs npm 11.5.1 or newer and Node 22.14.0 or newer; the Node 22 from `.nvmrc`
ships npm 10). `npm publish` then exchanges the job's GitHub OIDC token for a
short-lived token that can publish only that package, and attaches provenance
because the repository and the packages are public. Trusted Publishing works
only on GitHub-hosted runners.

**Setup, once per package** (`@sfere-io/sfere-sdk` and `@sfere-io/sfere-node`),
by an owner of the `sfere-io` npm organisation:

1. On npmjs.com open the package, then **Settings** → **Trusted Publisher**.
   Under "Select your publisher", click **GitHub Actions**.
2. Fill in the fields exactly as below. They are case-sensitive.

   | Field | Value |
   |---|---|
   | Organization or user | `sfere-io` |
   | Repository | `sfere-js-sdk` |
   | Workflow filename | `release.yml` (the file name only, no path) |
   | Environment name | leave empty: `version-or-publish` runs without a GitHub environment |
   | Allowed actions | allow `npm publish` (direct publishing). The script runs `npm publish`, not `npm stage publish`. |

3. Save. npm does not check the entry when it is saved; a mistake only shows
   up at the next publish.

The same entry from a terminal (npm 11.21.0 or newer, logged in to npmjs with
two-factor authentication; it asks for a one-time password):

```sh
npm trust github @sfere-io/sfere-sdk --file release.yml --repository sfere-io/sfere-js-sdk --allow-publish \
  --registry https://registry.npmjs.org/ --@sfere-io:registry=https://registry.npmjs.org/
npm trust github @sfere-io/sfere-node --file release.yml --repository sfere-io/sfere-js-sdk --allow-publish \
  --registry https://registry.npmjs.org/ --@sfere-io:registry=https://registry.npmjs.org/
```

**Timing.** A new trusted publisher entry expires if no publish uses it within
2 days, and an expired entry cannot be edited: delete it and add it again. So
add the entries shortly before merging a Version Packages PR, which is the
only thing that publishes.

**While `NPM_TOKEN` still exists.** The script uses the token when the secret
is set. With `id-token: write` granted, npm still tries the OIDC exchange
first and uses the exchanged token whenever a trusted publisher matches, so the
token is only a fallback. Without `NPM_TOKEN`, a package that has no matching
trusted publisher fails the tag step before anything is tagged, with an
`::error::` that lists the expected npmjs.com values; fix the entry and re-run
the job.

**After the first release published through Trusted Publishing** (its version
page on npmjs.com shows provenance):

1. Delete the `NPM_TOKEN` repository secret (Settings → Secrets and variables
   → Actions) and remove the `NPM_PUBLISH_TOKEN` line from `release.yml`.
2. Revoke that token on npmjs.com (your avatar → **Access Tokens**).
3. Optional, recommended by npm: on each package, **Settings** →
   **Publishing access** → "Require two-factor authentication and disallow
   tokens", then **Update Package Settings**. Trusted Publishing keeps working,
   because it does not use a token.

npm is phasing out tokens that bypass two-factor authentication for
publishing, so this is the publishing path to keep.

### What the release does

In `release.yml`'s "Tag the published versions" step, for each version that run
released (every public package whose tag does not exist yet; `sfere-shared` is
private and never published), `scripts/npmjs-publish.sh`:

1. Picks its credentials: the `NPM_TOKEN` secret while it is set, otherwise
   [Trusted Publishing](#trusted-publishing) with the job's OIDC token. With
   neither (outside GitHub Actions, or a job without `id-token: write`) it
   skips with a `::warning::` and the release continues; npmjs is not
   contacted at all then.
2. Skips the version if it is already on npmjs, so a re-run is safe.
   With Trusted Publishing it then requires npm 11.5.1 or newer.
3. Publishes the tarball it just downloaded back from GitHub Packages,
   unchanged, so both registries serve the same bytes. It first runs the
   publish as a dry run and refuses unless npm reports
   `Publishing to https://registry.npmjs.org/ … public access`. With Trusted
   Publishing the dry run already performs the OIDC exchange, and the script
   stops there with an `::error::` if npm reports it is not logged in (no
   matching trusted publisher).
4. Downloads the version back from npmjs with no token, retrying while
   npmjs catches up, and fails unless it contains `dist/index.js`,
   `dist/index.cjs` and `dist/index.d.ts`.

Every package is published and checked before any tag is pushed. If the npmjs
publish fails, nothing is tagged and the release jobs after it do not run;
re-run the failed job (or push to `main` again) and it picks up where it
stopped. The GitHub release notes say "on npm" only when the npmjs copy exists.

Why a dedicated config instead of `--registry`: the package's
`publishConfig.registry` (GitHub Packages) overrides `npm_config_registry`
from the environment, and the `@sfere-io:registry=https://npm.pkg.github.com/`
line that `actions/setup-node` writes overrides even `--registry`, for
`publish`, `view` and `pack` alike (checked with `npm publish --dry-run` on
npm 10 and 11). So the script gives every npmjs call its own userconfig plus
`--registry` and `--@sfere-io:registry` flags.

### First publish by hand

A trusted publisher can only be added to a package that exists on npmjs, so
the first version of each package is published from a terminal by an owner of
the `sfere-io` npm organisation. As of 2026-10-21 neither package is on npmjs:
`@sfere-io/sfere-sdk` 0.4.2 and `@sfere-io/sfere-node` 0.2.2 are on GitHub
Packages but untagged, because the npmjs publish of that release failed.

With a GitHub token (`read:packages`) configured for npm.pkg.github.com,
download the exact GitHub Packages tarballs, then publish them with a
dedicated npm config that holds only the npmjs login:

```sh
npm pack @sfere-io/sfere-sdk@0.4.2 --@sfere-io:registry=https://npm.pkg.github.com
npm pack @sfere-io/sfere-node@0.2.2 --@sfere-io:registry=https://npm.pkg.github.com

printf 'registry=https://registry.npmjs.org/\n@sfere-io:registry=https://registry.npmjs.org/\n' > npmjs.npmrc
npm login --userconfig ./npmjs.npmrc --registry https://registry.npmjs.org/

for tgz in sfere-io-sfere-sdk-0.4.2.tgz sfere-io-sfere-node-0.2.2.tgz; do
  npm publish "$tgz" --userconfig ./npmjs.npmrc --registry https://registry.npmjs.org/ \
    --@sfere-io:registry=https://registry.npmjs.org/ --access public --tag latest --ignore-scripts --dry-run
done
```

Each dry run must print
`Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)`.
Then run the same `npm publish` lines without `--dry-run` (npm asks for a
one-time password), and finish with
`npm logout --userconfig ./npmjs.npmrc --registry https://registry.npmjs.org/`
and `rm npmjs.npmrc`. The next push to `main` finds both versions on npmjs
(`exists`), tags them, and cuts their GitHub releases and CDN deploy.

Alternatively, replace `NPM_TOKEN` with a token that publishes without a
one-time password and re-run the failed release job.

### A version that was released without the npmjs copy

Versions whose npmjs publish was skipped are tagged, so later runs do not
retry them. Publish such a version by hand with the
[First publish by hand](#first-publish-by-hand) commands, or with the script
and an npm token in `NPM_PUBLISH_TOKEN` (plus a GitHub token with
`read:packages` configured for npm.pkg.github.com):

```sh
npm pack @sfere-io/sfere-sdk@<version> --@sfere-io:registry=https://npm.pkg.github.com
DRY_RUN=1 scripts/npmjs-publish.sh @sfere-io/sfere-sdk <version> sfere-io-sfere-sdk-<version>.tgz
scripts/npmjs-publish.sh @sfere-io/sfere-sdk <version> sfere-io-sfere-sdk-<version>.tgz
```

The script prints `published`, `exists` or `skipped`.

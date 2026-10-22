# Releasing

How a release of `@sfere.io/sfere-sdk` and `@sfere.io/sfere-node` actually
happens, end to end. For what
each CI job checks, see `CI.md`. For the CDN side specifically, see
`CDN-POLICY.md` and `../infra/cdn/README.md`.

## The short version

1. Add a changeset on your branch/PR.
2. Merge the PR to `main` like normal.
3. `release.yml` opens (or updates) a **"Version Packages"** PR.
4. Merging *that* PR **stages** the new versions on the public npm registry.
   Nothing is installable yet.
5. A maintainer **approves** each staged version with 2FA, then **runs the
   `release` workflow by hand**. That run tags, cuts the GitHub releases and
   deploys the CDN. See [Approving a staged release](#approving-a-staged-release).

Nothing is staged on a normal PR merge — only merging the Version Packages PR
does, and nothing reaches users until a human approves it.

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
   - **No pending changesets** (this push *is* that PR's merge) →
     `scripts/stage-release.sh` **stages** every public workspace package
     whose `package.json` version is neither on registry.npmjs.org nor already
     staged (`@sfere.io/sfere-sdk`, `@sfere.io/sfere-node`), with
     `npm stage publish`, public access and
     [Trusted Publishing](#trusted-publishing): no npm token is stored
     anywhere. For each one it pushes a `staged/<tag>` git tag (e.g.
     `staged/v0.4.3`) recording the commit the staged bytes were built from.
   The publish job builds every package first (`npm run build`); each
   package's `prepublishOnly` also refuses to publish without `dist/`.
   Releases up to `sfere-sdk` 0.3.1 and `sfere-node` 0.1.0 were published
   **without `dist/`** (no build in this job); the CDN was never affected.
   Those versions were on the old GitHub Packages registry only (see
   [Package history](#package-history)).
3. A staged version is reported in the run's summary as "waiting for
   approval", and the run ends there, green. A maintainer approves it
   ([Approving a staged release](#approving-a-staged-release)) and runs the
   workflow again.
4. On that run, the release downloads each approved version back from
   registry.npmjs.org without a token, exactly as a user installs it, and
   fails unless it contains `dist/index.js`, `dist/index.cjs` and
   `dist/index.d.ts`. Only once every package has passed does each one get a
   tag, on the commit its `staged/<tag>` marker records (the marker is then
   deleted): `vX.Y.Z` for the browser SDK, `@sfere.io/sfere-node@X.Y.Z` for
   the Node SDK. If a check fails, nothing is tagged; re-run the job and it
   picks up where it stopped.
5. On a successful browser release: dist is
   rebuilt from that tag (deterministically — same inputs as `ci.yml`'s
   build), and two GitHub releases are cut:
   - **Browser SDK vX.Y.Z** on `vX.Y.Z`, with `dist/cdn/sfere.min.js`,
     `dist/cdn/sfere.js` and `dist/cdn/manifest.json` attached. It stays the
     repository's "Latest" release.
   - **React vX.Y.Z** on a new `react-vX.Y.Z` tag at the same commit. React
     ships inside `@sfere.io/sfere-sdk` (the `/react` subpath), so this page
     shares the browser version; it carries React install and import notes.

   Then `cdn-deploy.yml` is called to publish the CDN files.
   (Paths are under `packages/browser/` since the workspace layout.)
6. On a successful Node release (with or without a browser one), the
   `release-node` job cuts **Node SDK vX.Y.Z** on its
   `@sfere.io/sfere-node@X.Y.Z` tag.

Every release page quotes that version's `CHANGELOG.md` section.

Apart from merging the Version Packages PR, approving the staged versions and
starting the finishing run are the only manual actions.

### Approving a staged release

Approving needs an account in the `sfere.io` npm organisation with 2FA (a
security key works). From a terminal (npm 11.21.0 or newer):

```sh
npm stage list @sfere.io/sfere-sdk        # shows the stage id of each pending version
npm stage view <stage-id>                 # optional: inspect it
npm stage download <stage-id>             # optional: fetch the tarball and look inside
npm stage approve <stage-id>              # 2FA prompt: browser link with a security key
```

Repeat for `@sfere.io/sfere-node` if it has a pending version. The same
approve and reject buttons are on npmjs.com, on the package's page. Then
finish the release:

```sh
gh workflow run release.yml -R sfere-io/sfere-js-sdk --ref main
```

(or Actions → release → Run workflow). If the finishing run happens before
every approval, it tags what is approved and reports the rest as waiting; run
it again after the remaining approvals.

**Rejecting** a staged version: `npm stage reject <stage-id>`, then delete its
marker (`git push origin :refs/tags/staged/<tag>`). The version number can be
staged again only after the reject; usually you ship a new patch instead.

**Why the second run.** The short-lived token Trusted Publishing gives the job
can run `npm stage publish` but not `npm stage list` or `approve`, so CI can
neither see nor wait for an approval. The `staged/<tag>` marker is how a later
run knows a version is already staged, and which commit to tag.

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
is present, with nothing extra to configure). A consumer opts in with
`npm install @sfere.io/sfere-sdk@next`; `npm install @sfere.io/sfere-sdk`
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

**Un-publishing from npmjs, or deleting a tag, is not the
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
| `GITHUB_TOKEN` | built-in | `release.yml` | Used by `changesets/action` (its default token) for the Version Packages PR, and for the tag push / GitHub release. No manual setup. |
| Trusted publisher | npmjs.com package setting | `release.yml` (`version-or-publish` job, `id-token: write`) | One entry on each of `@sfere.io/sfere-sdk` and `@sfere.io/sfere-node`; nothing to store in GitHub. See [Trusted Publishing](#trusted-publishing). |

All of the above except the npm entries were set on the repository (then
`sfere-io/sfere-sdk`, now `sfere-io/sfere-js-sdk`) on 2026-09-28, and the CDN
infrastructure is provisioned. Current values and resource names are in
`OPERATIONS.md`. There is no npm token secret: an `NPM_TOKEN` secret added on
2026-10-21 is unused and should be deleted.

## Publishing to the public npm registry

Users install with a plain `npm install @sfere.io/sfere-sdk` or
`npm install @sfere.io/sfere-node`: no token or `.npmrc`. The packages are
owned by the npm organisation **`sfere.io`** (it owns the `@sfere.io` scope).
The first versions on npmjs are `@sfere.io/sfere-sdk` 0.4.2 and
`@sfere.io/sfere-node` 0.2.2.

### Package history

Up to `sfere-sdk` 0.4.2 and `sfere-node` 0.2.2 the packages were published as
`@sfere-io/sfere-sdk` and `@sfere-io/sfere-node` to GitHub Packages only, which
demands a token even to install a public package. On 2026-10-22 they moved to
the `@sfere.io` scope on npmjs and GitHub Packages was retired: it can only
host a scope that matches the GitHub organisation (`sfere-io`), and the npm
organisation `sfere-io` belongs to someone else. Nothing publishes to GitHub
Packages any more, and versions before 0.4.2 / 0.2.2 are not on npmjs. The
`context.library.name` stamp on events changed with the package name, from
`@sfere-io/sfere-<sdk>` to `@sfere.io/sfere-<sdk>`.

### Trusted Publishing

The release publishes to npmjs with
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers): no npm
token is stored in GitHub. The `version-or-publish` job in `release.yml` has
`permissions: id-token: write` and installs npm 11.21.0 before the publish
script (staged publishing and Trusted Publishing need a recent npm; the Node
22 from `.nvmrc` ships npm 10). `npm stage publish` then exchanges the job's
GitHub OIDC token for a short-lived token that can stage only that package,
and attaches provenance because the repository and the packages are public.
Trusted Publishing works only on GitHub-hosted runners.

**Setup, once per package** (`@sfere.io/sfere-sdk` and `@sfere.io/sfere-node`),
by an owner of the `sfere.io` npm organisation. A trusted publisher can only be
added to a package that already exists on npmjs, so the first version is
published by hand ([First publish by hand](#first-publish-by-hand)).

1. On npmjs.com open the package, then **Settings** → **Trusted Publisher**.
   Under "Select your publisher", click **GitHub Actions**.
2. Fill in the fields exactly as below. They are case-sensitive.

   | Field | Value |
   |---|---|
   | Organization or user | `sfere-io` (the GitHub organisation) |
   | Repository | `sfere-js-sdk` |
   | Workflow filename | `release.yml` (the file name only, no path) |
   | Environment name | leave empty: `version-or-publish` runs without a GitHub environment |
   | Allowed actions | leave **both** "Allow npm publish" and "Allow npm dist-tag" unchecked. `npm stage publish` is always allowed, and it is all the workflow runs; the dist-tag is set at staging time. |

3. Save. npm does not check the entry when it is saved; a mistake only shows
   up at the next publish, as a `404` on the `PUT`.

The same entry from a terminal (npm 11.21.0 or newer, logged in to npmjs with
two-factor authentication):

```sh
npm trust github @sfere.io/sfere-sdk --file release.yml --repository sfere-io/sfere-js-sdk --allow-stage-publish
npm trust github @sfere.io/sfere-node --file release.yml --repository sfere-io/sfere-js-sdk --allow-stage-publish
```

**Timing.** A new trusted publisher entry expires if no publish uses it within
2 days, and an expired entry cannot be edited: delete it and add it again. So
add the entries shortly before merging a Version Packages PR, which is the
only thing that stages.

Then, recommended by npm: on each package, **Settings** → **Publishing
access** → "Require two-factor authentication and disallow tokens", then
**Update Package Settings**. Staging through Trusted Publishing keeps working,
because it does not use a token, and approval always needs 2FA.

### First publish by hand

Only needed for a package that is not on npmjs yet. An owner of the `sfere.io`
npm organisation publishes the built package from a clean checkout of the
commit being released:

```sh
npm ci && npm run build && npm run verify
npm whoami                       # must be a member of the sfere.io npm org
for w in @sfere.io/sfere-sdk @sfere.io/sfere-node; do
  npm publish -w "$w" --access public --tag latest --dry-run
done
```

Each dry run must print
`Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)`.
Then run the same `npm publish` lines without `--dry-run` in an interactive
terminal: with a security key, npm prints an `https://www.npmjs.com/auth/cli/…`
link to approve in the browser (add `--auth-type=web` if it asks for a
one-time password instead). A `404` on the `PUT` means the logged-in account
cannot publish to the `@sfere.io` scope. The next push to `main` finds both
versions on npmjs, tags them, and cuts their GitHub releases and CDN deploy.

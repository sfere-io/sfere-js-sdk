# Releasing

How a release of `@fanfinity/sfere-sdk` actually happens, end to end. For what
each CI job checks, see `CI.md`. For the CDN side specifically, see
`CDN-POLICY.md` and `../infra/cdn/README.md`.

## The short version

1. Add a changeset on your branch/PR.
2. Merge the PR to `main` like normal.
3. `release.yml` opens (or updates) a **"Version Packages"** PR.
4. Merging *that* PR is what actually ships: publish, tag, GitHub release,
   CDN deploy.

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
     not yet on GitHub Packages (`@fanfinity/sfere-sdk`, `@fanfinity/sfere-node`).
   The publish job builds every package first (`npm run build`); each
   package's `prepublishOnly` also refuses to publish without `dist/`.
   Releases up to `sfere-sdk` 0.3.1 and `sfere-node` 0.1.0 were published
   **without `dist/`** (no build in this job), so those npm versions are
   unusable; the CDN was never affected. Use 0.3.2+ / 0.1.1+.
3. Before tagging, the release downloads each newly published version back
   from the registry and fails unless it contains its `dist/` entry points.
   Each package published gets a tag: `vX.Y.Z` for the browser SDK,
   `@fanfinity/sfere-node@X.Y.Z` for the Node SDK. Only a browser release
   continues below; a Node-only release stops at the tag.
4. On a successful browser publish: dist is
   rebuilt from that tag (deterministically — same inputs as `ci.yml`'s
   build), a GitHub release is cut with `dist/cdn/sfere.min.js`,
   `dist/cdn/sfere.js` and `dist/cdn/manifest.json` attached, and
   `cdn-deploy.yml` is called to publish those same files to the CDN.
   (Paths are under `packages/browser/` since the workspace layout.)

You don't do any of steps 3–4 by hand — merging the Version Packages PR is the
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
next line that needs this is `v0.5`.

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
is present — nothing extra to configure). A consumer opts in with
`npm install @fanfinity/sfere-sdk@next`; `npm install @fanfinity/sfere-sdk`
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

**Un-publishing from GitHub Packages or deleting a tag is not the rollback
path** — those are immutable by design (see `CDN-POLICY.md`). To roll back
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
| `GITHUB_TOKEN` | built-in | `release.yml` | Used as `NODE_AUTH_TOKEN` to publish to GitHub Packages, by `changesets/action` (its default token) for the Version Packages PR, and for the tag push / GitHub release. No manual setup. |

All of the above are set on `fanfinity/sfere-sdk` (2026-09-28), and the CDN
infrastructure is provisioned. Current values and resource names are in
`OPERATIONS.md`.

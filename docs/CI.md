# CI

What each workflow job checks, and how to reproduce it on your own machine
before pushing. See `RELEASING.md` for what happens after `main`, and
`CDN-POLICY.md` / `../infra/cdn/README.md` for the CDN-specific pieces.

## `ci.yml` — runs on every PR, and (via `workflow_call`) as the first job of
`release.yml` on every push to `main`

There is deliberately no separate `push: main` trigger: `release.yml` runs on
every push to `main` and calls this workflow first, so a second, identical
run per push would only double the e2e time.

### `check`

| Step | Command | Locally |
|---|---|---|
| Typecheck | `npm run typecheck` | `npm run typecheck` |
| Lint | `npm run lint` | `npm run lint` |
| Format | `npm run format:check` | `npm run format:check` (`npm run format` to fix) |
| Unit tests + coverage | `npm run test:coverage` | `npm run test:coverage` — writes `coverage/lcov.info` and `coverage/coverage-summary.json` |
| Build | `npm run build` | `npm run build` — produces `dist/index.{js,cjs,d.ts}` and `dist/cdn/{sfere.min.js,sfere.js}` |
| Size budget | `npm run size` | `npm run size` — fails if `dist/cdn/sfere.min.js` (gzipped) is over budget |
| Dist contract | `npm run verify` | `npm run verify` — exports resolve, the IIFE defines `window.SfereSDK`, no default host reaches `cdn.segment.com` / `api.segment.io`, license banner present |
| Packaging sanity | `npm pack --dry-run` | same command |

Coverage totals are written to the job's step summary (visible on the
Actions run) and the full report is uploaded as the `coverage` artifact;
`dist/` is uploaded as the `dist` artifact for the `sonar` job and for local
inspection.

### `e2e` (needs `check`)

Rebuilds `dist/`, installs a headless Chromium via Playwright
(`npx playwright install --with-deps chromium`), and runs `npm run test:e2e`
— the Playwright suite against the built `dist/` and `test/e2e`'s mock
ingestion server. Reproduce locally:

```sh
npm run build
npx playwright install --with-deps chromium   # first time only
npm run test:e2e
```

On failure, the `playwright-report` artifact is uploaded (HTML report with
traces/screenshots).

### `sonar` (needs `check`)

Runs SonarQube Cloud static analysis plus the coverage `check` produced,
via `SonarSource/sonarqube-scan-action`, configured by
`../sonar-project.properties`. **Skipped with a step-summary note** (not
failed) when the `SONAR_TOKEN` secret isn't set — this is deliberate so fork
PRs (which get no secrets) and this repo before SonarCloud project import
both stay green. There's no meaningful "run it locally" — SonarQube Cloud is
a hosted service; the closest local proxy is running `test:coverage` and
reading the report yourself, or using the SonarLint IDE plugin against the
same rules.

## `release.yml` — runs on push to `main`

Reuses `ci.yml` in full (`secrets: inherit`) before doing anything else. See
`RELEASING.md` for the Changesets version-vs-publish logic, tagging, GitHub
release, and the call into `cdn-deploy.yml`. Nothing in this workflow has a
meaningful "run it locally" equivalent — it's inherently a CI-only,
merge-triggered flow (Changesets needs to compare against `main`'s history,
and publishing needs the repo's `GITHUB_TOKEN`).

## `cdn-deploy.yml` — called by `release.yml`, or run by hand

`workflow_call` (from `release.yml`) or `workflow_dispatch` (manual —
including rollback with `alias_only=true`; see `RELEASING.md`). `check-config` first confirms the
CDN repository variables are set, skipping the rest cleanly if not. `deploy`
then checks out the requested tag, rebuilds deterministically
(`npm ci && npm run build && npm run verify && npm run cdn:manifest`),
confirms the checked-out `package.json` version matches the requested
version, authenticates to GCP via WIF, and runs `scripts/cdn-publish.sh`.
When `CDN_BASE_URL` is set, it then fetches the just-published immutable URL
and checks its SRI hash against `manifest.json` and its `Cache-Control` /
`Content-Type` headers. Local equivalent (without the GCP upload):

```sh
npm run build && npm run verify && npm run cdn:manifest
scripts/cdn-publish.sh "$(node -p 'require("./package.json").version')" --dry-run
```

## Local pre-push checklist

The one-liner that mirrors `check` end to end:

```sh
npm ci && npm run typecheck && npm run lint && npm run format:check \
  && npm run test:coverage && npm run build && npm run size && npm run verify \
  && npm pack --dry-run
```

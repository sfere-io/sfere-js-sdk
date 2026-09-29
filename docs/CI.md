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
| Build | `npm run build` | `npm run build` — every workspace: `packages/browser/dist/{index,react}.{js,cjs,d.ts}` + `dist/cdn/{sfere.min.js,sfere.js}`, and `packages/node/dist/index.{js,cjs,d.ts}` |
| Size budget | `npm run size` | `npm run size` — fails if the browser `dist/cdn/sfere.min.js` (gzipped) is over budget |
| Dist contract | `npm run verify` | `npm run verify` — per package. Node: ESM/CJS exports, banner, shared code inlined, and a live send that reaches only the configured `/v1/batch` with the Sfere wire shape. Browser: exports resolve (including `./react` and its `react/` node10 stub, `"use client"`, SDK kept external), the IIFE defines `window.SfereSDK`, no default host reaches `cdn.segment.com` / `api.segment.io`, license banners present |
| Packaging sanity | `npm pack --dry-run --workspaces` | same command |

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

What the suite covers, beyond the per-feature specs:

- **React bindings, as published** (`test/e2e/specs/react.spec.ts`).
  - `global-setup.ts` runs `npm pack` and extracts the tarball into `test/e2e/.tmp/consumer/node_modules/`, with the consumer in its own package scope.
  - It then bundles `test/e2e/react-app.tsx` (React 19, StrictMode) against the installed package, in both the development and production builds.
  - Setup fails if the bundle does not contain the installed `dist/index.js` exactly once. That catches a file missing from `files`, a broken `exports` map, or a second SDK copy.
  - The spec asserts:
    - one page view per route;
    - one SDK instance;
    - React-tagged, well-formed payloads;
    - traits and consent on later events;
    - no console errors.
- **The live-CDN smoke** (`cdn-smoke.spec.ts`) is skipped here. It runs only in `cdn-deploy.yml`.
- **Node SDK, as published** (`packages/node/test/e2e/packed.mjs`).
  - It runs `npm pack`, installs the tarball into a consumer with its own package scope, and checks the tarball's file list.
  - It then runs a real **ESM** app and a real **CommonJS** app. Each receives a browser-like request (proxy headers, ad cookies, a landing URL with click IDs) and forwards it with `requestContext()` to a mock ingestion host.
  - It asserts:
    - Basic auth on `/v1/batch`;
    - the Sfere library and User-Agent;
    - call order;
    - the end-user IP, user agent, locale, page, campaign and click IDs (including `fbclid` → `fbc`);
    - the dedup id.
  - A TypeScript consumer is type-checked under `node16` and `bundler` resolution.
- **Node SDK against staging** (`npm run smoke:staging -w @fanfinity/sfere-node`, manual, needs `SFERE_WRITE_KEY` and `SFERE_HOST`): sends a tagged identify and purchase through the built SDK and requires `okEvents: 2`.

Because `release.yml` calls this workflow before publishing, a red e2e run blocks the npm publish, the tag and the CDN deploy.

On failure, the `playwright-report` artifact (`packages/browser/playwright-report/`) is uploaded (HTML report with
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
`Content-Type` headers. It then runs **a browser smoke test against the live CDN**: Playwright Chromium runs `test/e2e/specs/cdn-smoke.spec.ts`, which loads the published bundle and must deliver a `track` to the mock ingestion host.

1. **The immutable URL**, loaded with `<script integrity crossorigin>` using the manifest's SRI. This fails fast on an SRI, CORS or HTTP error.
2. **The alias URL** the loader snippet uses (skipped for prereleases). The edge caches the alias for up to 5 minutes and ignores query strings in its cache key, so the step first waits (at most 7 minutes) until the edge serves the new version, then requires the deployed `context.library.version`.

On failure, the `cdn-smoke-report` artifact is uploaded. Run the smoke test against production by hand:

```sh
npm run build   # global-setup needs dist/
CDN_SMOKE_URL=https://cdn.sfere.io/sdk/v0.1.0/sfere.min.js \
CDN_SMOKE_SRI="$(curl -fsS https://cdn.sfere.io/sdk/v0.1.0/manifest.json | node -p 'JSON.parse(require("fs").readFileSync(0)).files.find(f=>f.path.endsWith("sfere.min.js")).sha384')" \
CDN_SMOKE_VERSION=0.1.0 npx playwright test test/e2e/specs/cdn-smoke.spec.ts
```

Local equivalent of the build and upload (without the GCP upload):

```sh
npm run build && npm run verify && npm run cdn:manifest
scripts/cdn-publish.sh "$(node -p 'require("./package.json").version')" --dry-run
```

## Local pre-push checklist

The one-liner that mirrors `check` end to end:

```sh
npm ci && npm run typecheck && npm run lint && npm run format:check \
  && npm run test:coverage && npm run build && npm run size && npm run verify \
  && npm pack --dry-run --workspaces
```

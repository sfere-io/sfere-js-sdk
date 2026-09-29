# Sfere SDK: architecture and build contract

_Internal. Written 2026-09-28 from the research in `../sfere-sdk-research/` (`sdk-base-decision.md`, `journify-production-evidence.md`, `journify-payload-spec.md`). Never name the ingestion platform's vendor in this repo: say "ingestion endpoint"._

## What it is

- **`@segment/analytics-next` 1.84.3 used unmodified, as an npm dependency** (MIT, not a fork), plus a Sfere **enrichment plugin** and a thin `load()` wrapper holding the settings that make it talk to our ingestion endpoint.
- **Two distributions from one source:**
  - npm package `@fanfinity/sfere-sdk` (ESM + CJS + types), on GitHub Packages;
  - a single-file IIFE bundle for a `<script>` tag, served from our CDN (`https://cdn.sfere.io/sdk/…`). See `docs/CDN-POLICY.md`.

## Decisions this code must respect (founder, 2026-09-28)

1. **Payload shape:** identifiers in `context.clientIds` with exactly these keys: `fbp, fbc, ttp, ttclid, scid, scclid, epik, li_fat_id, msclkid, oppref, obref, gclid, wbraid, gbraid, twclid, rdt_cid, clarity_uid, clarity_sid`. Traits go where analytics-next puts them. No root-level `externalIds`. (`clarity_uid` / `clarity_sid` added 2026-09-28, user: Microsoft Clarity's IDs, for joining profiles to Clarity recordings. `obref` added the same day: the OpenAI pixel's browser id, which the OpenAI CAPI sends as `user.obref`.)
2. **No hashing, no phone formatting in the SDK.** Server-side destinations hash and normalise.
3. **Canonical e-commerce vocabulary: GA4 names and `properties.items[]`** (`purchase`, `add_to_cart`, `begin_checkout`, `view_item`, …). The SDK passes event names through untouched; it only documents and types the GA4 vocabulary.
4. **Transport:**
   - standard mode: `POST {host}/api/s/{t|p|i|g|a}` with `Authorization: Basic base64(writeKey:)`;
   - batching mode: `POST {host}/v1/batch/b`.
   Both were proven against staging.
5. **Settings inline, never fetched.** `cdnSettings` is built in code (`integrations["Segment.io"].apiKey = writeKey`, `plan` with `__default` enabled for track/identify/group, and **`metrics.sampleRate: 0`**). The ingress does not expose a settings route, and remote metrics would post to `{apiHost}/m`, which is noise.
6. **Never load from `cdn.segment.com`.** `cdnURL` defaults to the CDN origin that served the bundle (or an explicit option), so no request goes to a third-party host.

## Public API (the contract every agent builds against)

```ts
import { SfereAnalytics, sfereEnrichment } from "@fanfinity/sfere-sdk";

const sfere = SfereAnalytics.load({
  writeKey: "keyId:secret",               // required, the public browser key
  host: "https://ingest.example.com",      // required, ingestion origin (scheme + host, no path)
  batching?: boolean | { size?: number; timeout?: number },  // default false
  cdnURL?: string,                         // origin for lazy chunks; default = bundle origin / host
  consent?: Record<string, boolean>,       // initial consent categories
  sessionTimeoutMinutes?: number,          // default 30, inactivity based
  clickIdStorage?: "session" | "local",    // default "session"
  disableClientPersistence?: boolean,      // default auto (see "Blocked storage" below)
  debug?: boolean,
});
// `sfere` is an AnalyticsBrowser: sfere.track / page / identify / group / alias / reset …
sfere.setConsent({ advertising: true, analytics: true }); // updates context.consent on later events
```

- `SfereAnalytics.load` returns the `AnalyticsBrowser` from analytics-next, extended with `setConsent`.
- `sfereEnrichment(options)` is exported for teams that call `AnalyticsBrowser.load` themselves.

### React bindings (`@fanfinity/sfere-sdk/react`, `src/react.ts`), added 2026-09-29

- `SfereProvider`, `useSfere()`, `usePageTracking(routeKey, options?)`. React `>=17 <20` is an optional peer dependency.
- **A subpath of this package, not a separate package.** This is a deliberate deviation from the SDK-family plan, which proposed `packages/browser` + `packages/react` in Phase 1.
  - The bindings only wrap `SfereAnalytics.load`, so versioning them in lockstep removes any compatibility matrix.
  - It is the same trade-off as `@vercel/analytics/react`.
  - The cost: a React-only fix cuts a new browser version and redeploys an identical CDN bundle. That is harmless, because CDN paths are versioned.
  - Reviewed independently 2026-09-29.
- **Build:** a separate tsup entry.
  - The entry imports the SDK **by package name** and keeps it external, so apps share one SDK module and instance.
  - It has its own banner, since it bundles no third-party code, followed by `"use client"`.
  - `tsconfig.json` `paths` and a vitest alias point that import at `src/index.ts` for typecheck and unit tests. Only `verify` exercises the built self-import, so it must stay in CI.
  - `react/package.json` is a resolution stub for consumers that ignore `exports` (TypeScript `moduleResolution: node10`, older bundlers).
- **Behaviour:**
  - The provider loads **once per write key + host** during render, not in an effect, because children's effects run first.
  - Later options for the same key are ignored, with a console warning.
  - React events carry `context.library.binding: "react"` beside the unchanged `name`, `version` and `base`.

**The repo is an npm workspace (since the Node SDK, 2026-09-29):**

```
packages/browser        @fanfinity/sfere-sdk    (".", "./react"; the CDN source)
packages/node           @fanfinity/sfere-node   (wraps analytics-node; must not be a subpath: it would add a Node dependency to every browser install)
packages/shared         private, source-only, bundled into both: cookie/URL click-ID maps and parsers
packages/react-native   @fanfinity/sfere-react-native (Phase 3, not yet created)
```

React stays a subpath of `packages/browser`. Python, Swift and Kotlin get their own repos; the GTM templates are not npm packages. The release pipeline handles several packages:
- **Tags.** Per-package tags in the changesets form (`@fanfinity/sfere-node@x.y.z`), keeping plain `vX.Y.Z` for the browser package, because `cdn-deploy.yml` checks out `v${version}`.
- **Tagging step.** The step in `release.yml` loops over every public `packages/*/package.json`.
- **Rollbacks.** `cdn-deploy.yml` finds the browser package in the checked-out tag (`packages/browser`, or the repo root for v0.3.0 and older), so rolling back to a pre-workspace version still works.
- **Gating.** `release-artifacts` and `cdn-deploy` run only when the browser package was published.



- Exposes `window.SfereSDK = { load, sfereEnrichment, version }`.
- **Auto-init:** if the executing `<script>` has `data-write-key` and `data-host`, it calls `load()`, assigns the result to `window.sfere`, and **replays any calls queued on a stub `window.sfere`** created by the loader snippet before the bundle arrived.
- The loader snippet (`src/cdn/snippet.html`, also printed in the README) is short, async, and queues `track / page / identify / group / alias / reset / setConsent`.

## Enrichment plugin behaviour (`src/plugins/enrichment.ts`, `type: "enrichment"`)

Port of `../sfere-sdk-research/lab/sfere-enrichment.js`, which was proven on the wire, plus the items the research carried over:

| Field | Source |
|---|---|
| `context.clientIds` from cookies | `_fbp→fbp, _fbc→fbc, _ttp→ttp, ttclid, _scid→scid, _scclid→scclid, _epik→epik, li_fat_id, _uetmsclkid→msclkid, __oppref→oppref`, `_gcl_aw` / `_gcl_dc → gclid` (text after the second dot), and `_clck → clarity_uid`, `_clsk → clarity_sid` (first field, before the first `^`) |
| `context.clientIds` from URL, persisted per session | `gclid, wbraid, gbraid, ttclid, ScCid→scclid, twclid, epik, msclkid, li_fat_id, oppref, rdt_cid`; **`fbclid → fbc = fb.1.<ms>.<fbclid>`**. A newer URL click replaces an older value. A pixel-set `_fbc` cookie wins, unless the URL carried a newer `fbclid` |
| `context.campaign.gad_source`, `context.campaign.gad_campaignid` | URL `gad_source` / `gad_campaignid`, persisted like click IDs. Merged into analytics-next's own UTM `campaign` object, never replacing it |
| `context.session` | `{ id }`, inactivity rotation (default 30 min), in localStorage `sfere_session` |
| `context.consent` | `{ categoryPreferences: {…} }` from `setConsent` or the `consent` option; omitted when unset |
| `context.page.lang` | `document.documentElement.lang`, when set (`locale` reflects the browser, not the page) |
| `context.library` | `{ name: "@fanfinity/sfere-sdk", version: <sdk version>, base: "analytics-next@<its version>" }`, replacing the base library's own stamp (amended 2026-09-28, review) |
| `properties.sfere_dedup_id` | on `track` only: kept if the site set it (e.g. the order id); otherwise set to the event's `messageId`. The server-side destinations dedupe on `messageId`, not on this property, so pixels must be given the `messageId` (see INTEGRATION.md#deduplication) |

- **Warehouse width:** the payload must not carry `_metadata`, and it must not carry `integrations` unless the caller set it. Find the analytics-next setting or plugin point that achieves this (read `node_modules/@segment/analytics-next`, e.g. `addBundledMetadata` / the segmentio `normalize`), prove it in a unit test, and record where it happens.
- **Robustness:** all storage access is wrapped in try/catch; the SDK must work when cookies or storage are blocked. There must be no errors on the server side (SSR import), so guard `window` / `document`.
- **Blocked storage (amended 2026-09-28, review):** the base library itself has unguarded accesses — its persisted queue's mutex (localStorage), its cookie store's `set()`, and a `_ga` cookie read in its environment ("before") plugin — so when either surface *throws*, events hang or fail on every retry. `load()` therefore probes localStorage (write/read/remove) and `document.cookie` (read/write, expired probe cookie) and passes the library's own `disableClientPersistence: true` when either throws (or when the caller sets the option); when cookies throw it also replaces the library's environment plugin with `src/plugins/environment.ts` (same core fields, no cookie reads). The base library stays unmodified.

## Known limitation, documented rather than solved

**First-event cookie race.** On the landing page view, `_fbp` / `_ttp` may not exist yet because the ad pixels haven't run. `fbclid → fbc` covers Meta's click ID. A spike on a page with real pixels is still pending (research item 5).

## Repo layout and ownership

| Path | Owner | What |
|---|---|---|
| `packages/browser/` (`src/`, `test/unit/`, `tsup.config.ts`, `tsconfig*.json`, `vitest.config.ts`, `scripts/size-check.mjs`, `scripts/verify-dist.mjs`, `THIRD_PARTY_NOTICES.md`) | SDK core | browser SDK code, unit tests, build |
| `packages/node/` | SDK core | Node SDK: `src/index.ts` (client + dedup plugin), `src/http-client.ts` (wire shaping), `src/context.ts` (`requestContext`), `scripts/verify-dist.mjs`, `scripts/staging-smoke.mjs`, `test/e2e/packed.mjs` |
| `packages/shared/` | SDK core | identifier maps and parsers both SDKs bundle |
| `.github/`, `sonar-project.properties`, `.changeset/`, `infra/cdn/`, `packages/browser/scripts/cdn-*.{mjs,sh}`, `docs/CDN-POLICY.md`, `docs/RELEASING.md`, `docs/CI.md` | Delivery | CI/CD, Sonar, versioning, publishing, CDN |
| `packages/browser/test/e2e/` | E2E | Playwright + mock ingestion server |
| `README.md`, `packages/*/README.md`, `docs/INTEGRATION.md`, `docs/EVENTS.md`, `docs/WIRE-CONTRACT.md`, `docs/HTTP-API.md`, `CONTRIBUTING.md`, `SECURITY.md` | Docs | developer-facing docs, shareable with client developers |

Root `package.json` scripts keep the names CI calls and fan out to the workspaces (`--workspaces --if-present`); `size` and `cdn:manifest` run in the browser package only. Lint and format run once over the whole repo.

## npm scripts (names are fixed; CI calls exactly these)

| Script | Does |
|---|---|
| `build` | tsup: `dist/index.{js,cjs,d.ts}` + `dist/cdn/sfere.min.js` (IIFE, minified, license banner) + `dist/cdn/sfere.js` (unminified) |
| `typecheck` | `tsc --noEmit` |
| `lint` / `format` / `format:check` | eslint / prettier |
| `test` / `test:coverage` | vitest; coverage writes `coverage/lcov.info` and `coverage/coverage-summary.json` |
| `test:e2e` | Playwright headless Chromium against `dist/` and the mock server |
| `size` | `scripts/size-check.mjs`: gzip budget for `dist/cdn/sfere.min.js`; fails when over |
| `verify` | `scripts/verify-dist.mjs`: exports resolve, IIFE defines `SfereSDK`, no `cdn.segment.com` / `api.segment.io` default host reachable in config, banner present |
| `cdn:manifest` | `scripts/cdn-manifest.mjs`: `dist/cdn/manifest.json` with version, files, sizes, sha384 SRI |
| `changeset` / `version-packages` / `release` | Changesets: add / version / publish |

Node 22 (`.nvmrc`), npm (lockfile committed).

# Security

## Reporting a vulnerability

If you discover a security vulnerability in the Sfere SDK, please email **support@sfere.io** to report it. Mark your email subject as "Security Vulnerability Report" and include:

- A description of the vulnerability
- Steps to reproduce it
- Affected SDK versions
- Any workarounds you've found

Do not disclose the vulnerability publicly until we've released a fix.

## Supported versions

We support the **latest minor version** of the SDK. Updates within a minor version (patches) may include security fixes. Always upgrade to the latest patch version in your 0.1.x branch (e.g., 0.1.5).

For breaking changes or major new features, we release a new minor version (e.g., 0.2.0). Older minor versions do not receive security patches.

## What the SDK stores in the browser

The SDK reads and writes the following browser storage:

### Cookies (read by the SDK)

The SDK reads cookies set by ad platforms and analytics tools. It does not write these cookies; it only reads their values and extracts click IDs:

| Cookie | Ad platform | Value extracted as |
|--------|-------------|-------------------|
| `_fbp` | Meta | `context.clientIds.fbp` |
| `_fbc` | Meta | `context.clientIds.fbc` |
| `_ttp` | TikTok | `context.clientIds.ttp` |
| `_scid` | Snap | `context.clientIds.scid` |
| `_scclid` | Snap | `context.clientIds.scclid` |
| `_epik` | Pinterest | `context.clientIds.epik` |
| `li_fat_id` | LinkedIn | `context.clientIds.li_fat_id` |
| `_uetmsclkid` | Microsoft | `context.clientIds.msclkid` |
| `__oppref` | Criteo | `context.clientIds.oppref` |
| `_gcl_aw` | Google Ads | `context.clientIds.gclid` (text after the second dot) |
| `_gcl_dc` | Google Ads | `context.clientIds.gclid` (fallback) |
| `ttclid` | TikTok | `context.clientIds.ttclid` |

Click IDs that arrive as URL parameters (`gclid`, `wbraid`, `gbraid`, `ttclid`, `ScCid`, `twclid`, `epik`, `msclkid`, `li_fat_id`, `oppref`, `rdt_cid`, `fbclid`, plus `gad_source` / `gad_campaignid`) are read from the landing URL, not from cookies.

### Cookies and localStorage written by the underlying library

`@segment/analytics-next` keeps the anonymous ID, user ID, traits and group under `ajs_*` names, in both a first-party cookie (one year, on the site's registrable domain) and localStorage, and keeps its retry queue in localStorage (`persisted-queue:v1:<writeKey>:*`). `reset()` clears the user ID, traits and anonymous ID. See the [analytics-next source](https://github.com/segmentio/analytics-next).

### localStorage written by the SDK itself

- **`sfere_session`** — `{ id, last }`: the session ID (a millisecond timestamp) and the last-activity time. No personal data.
- **`sfere_click_ids`** — only with `clickIdStorage: "local"` (see below).

### sessionStorage

Click IDs and `gad_*` parameters from the landing URL are stored in `sessionStorage` under `sfere_click_ids` (the default, `clickIdStorage: "session"`), cleared when the tab closes.

### In-memory mode

At load time the SDK writes and removes a probe key in localStorage and writes an already-expired probe cookie (`sfere_probe`). If either throws, or if you pass `disableClientPersistence: true`, nothing above is written: the underlying library's queue, anonymous ID and traits live in memory for the page, and the SDK's own session and click IDs are kept in memory too.

## Public write key

The `writeKey` in SDK configuration is **not a secret** — it is a public browser key designed to be embedded in client-side code (and in the CDN loader snippet). It identifies the data stream to the ingestion endpoint but cannot be used to read or modify data. **Treat it as a public identifier, not a credential.** It is sent on every request twice: as `Authorization: Basic base64(writeKey:)` and, by the underlying library's normalisation, as a `writeKey` field in the JSON body. Both are visible in DevTools by design.

Do not embed server-side keys or API tokens in the SDK.

## Identifier handling

The SDK sends all identifiers **unhashed** over HTTPS to the Sfere ingestion endpoint:

- User IDs (from `identify()`)
- Email addresses and other traits
- Ad click IDs from cookies and URL parameters
- Session IDs
- Event properties

**Hashing, normalization, and PII obfuscation happen server-side** in the ingestion platform and are applied per destination. The SDK's role is to collect and forward; server-side destinations handle sensitive data transformation.

**Implication:** Always collect user consent before sending data. The SDK has a `consent` option and `setConsent()` method to track consent state; use them before tracking events.

## Cookies and tracking blockers

The SDK keeps working when cookies or localStorage are unavailable:

- Every read and write the SDK makes is wrapped in try/catch; an unreadable cookie means that click ID is silently absent from `context.clientIds`.
- If storage throws, the SDK switches to in-memory mode (above): the session ID and click IDs hold for the page and events are still sent, with a per-page anonymous ID.
- Ad platform pixels still run; the SDK just can't read their cookies.

There are **no hard failures** if storage is blocked — the SDK continues to function, and this is covered by the end-to-end suite (`test/e2e/specs/storage-blocked.spec.ts`).

## Transport security

The `host` option must be an `http(s)` origin. Use **`https://`** for every real deployment; `http://` is accepted only so local development against `http://localhost:<port>` works, and the SDK never falls back from one to the other. The SDK never fetches configuration or sends metrics to any third-party host: every request goes to `host`.

## Third-party dependencies

The SDK depends on one production dependency: **@segment/analytics-next** (MIT license). This library is a mature, widely-used event collection framework. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full attribution.

The build bundles analytics-next into the IIFE distribution; npm consumers receive it as a separate dependency to allow deduplication in monorepos.

## Content Security Policy (CSP)

The SDK respects your page's Content-Security-Policy. If your CSP blocks `cdn.sfere.io` or your ingestion host, the SDK will not load or send data. See [INTEGRATION.md](docs/INTEGRATION.md#content-security-policy-csp) for CSP directives.

## SSR and Node.js compatibility

The SDK guards against `window` and `document` references, making it safe to import in Node.js or server-side contexts. The enrichment plugin checks for a DOM before reading cookies or storage.

You can `import { SfereAnalytics }` in a Next.js or Node.js server without errors, and calling `load()` there returns an inert instance whose methods resolve to `undefined` — shared code can call `sfere.track()` during SSR without branching.

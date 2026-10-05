# Sfere Browser SDK

Collect first-party fan engagement events in real time. The Sfere SDK enriches every event with ad platform click IDs and identifiers from your site, then sends them to the Sfere ingestion endpoint for activation across sponsorship and monetization channels.

> **Status:** 0.1.0 is live — `https://cdn.sfere.io/sdk/v0.1/sfere.min.js` and `@fanfinity/sfere-sdk@0.1.0` on GitHub Packages. Maintainers: start with [docs/OPERATIONS.md](../../docs/OPERATIONS.md).

## Quick start

### Script tag (CDN)

Paste the loader snippet into your page's `<head>`, replacing `YOUR_WRITE_KEY` and `YOUR_INGESTION_HOST`. It creates a `window.sfere` queue immediately, loads the bundle asynchronously, and records the first page view (`q.page()`); every call made before the bundle arrives is replayed in order once it has. This is `src/cdn/snippet.html`, verbatim:

```html
<!-- Sfere SDK loader. Replace YOUR_WRITE_KEY and YOUR_INGESTION_HOST. -->
<script>
  !(function (w, d) {
    if (w.sfere) return;
    var q = (w.sfere = []);
    ["track", "page", "identify", "group", "alias", "reset", "setConsent"].forEach(function (m) {
      q[m] = function () {
        q.push([m].concat([].slice.call(arguments)));
        return q;
      };
    });
    var s = d.createElement("script");
    s.async = true;
    s.src = "https://cdn.sfere.io/sdk/v0.1/sfere.min.js";
    s.setAttribute("data-write-key", "YOUR_WRITE_KEY");
    s.setAttribute("data-host", "https://YOUR_INGESTION_HOST");
    d.head.appendChild(s);
    q.page();
  })(window, document);
</script>
```

Then, anywhere on the page:

```html
<script>
  sfere.track("view_item", {
    currency: "SAR",
    value: 29.99,
    items: [{ item_id: "sku_123", item_name: "T-Shirt", price: 29.99, quantity: 1 }],
  });
</script>
```

The snippet already sends the first `page()`; call `sfere.page()` yourself only on later route changes. Add `s.setAttribute("data-batching", "true")` next to the other attributes to enable [batching](#configuration). The bundle also exposes `window.SfereSDK = { load, sfereEnrichment, version }` for pages that prefer to call `load()` themselves.

`https://cdn.sfere.io/sdk/v0.1/` is the **alias** URL: it follows the latest 0.1.x patch. For a production page pinned with Subresource Integrity, use the **immutable** URL `https://cdn.sfere.io/sdk/v0.1.0/sfere.min.js` with the `integrity` hash from that build's `manifest.json` — see [docs/CDN-POLICY.md](../../docs/CDN-POLICY.md). Never put an SRI hash on the alias URL. For embeds you can never edit again (an app-store app, a published tag template), use `https://cdn.sfere.io/sdk/latest/sfere.min.js`: it follows every stable release, across lines and majors.

### npm

```bash
npm install @fanfinity/sfere-sdk
```

The package is on GitHub Packages. Create a token with the `read:packages` scope, then add to your `.npmrc`:

```
@fanfinity:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<YOUR_TOKEN>
```

Initialize the SDK:

```javascript
import { SfereAnalytics } from "@fanfinity/sfere-sdk";

const sfere = SfereAnalytics.load({
  writeKey: "keyId:secret",
  host: "https://ingest.example.com",
  consent: { advertising: true, analytics: true },
});

sfere.page();
sfere.track("add_to_cart", {
  currency: "SAR",
  value: 29.99,
  items: [{ item_id: "sku_123", item_name: "T-Shirt", price: 29.99, quantity: 1 }],
});
```

`load()` returns immediately; calls made before the SDK is ready are buffered. On the server (no `window`) it returns an inert instance whose methods resolve to `undefined`, so shared code can call it during SSR.

### React and Next.js

```tsx
import { SfereProvider, usePageTracking, useSfere } from "@fanfinity/sfere-sdk/react";

<SfereProvider writeKey="keyId:secret" host="https://ingest.example.com">
  <App />
</SfereProvider>;

// inside a component under the provider
usePageTracking(pathname + search); // one page() per route change
const sfere = useSfere();
sfere.track("add_to_cart", { currency: "SAR", value: 29.99, items: [/* … */] });
```

The provider loads the SDK once per write key and host, StrictMode included. React is an optional peer dependency (17+). For React Router and the Next.js App/Pages Router setups, see [Integration guide: React and Next.js](../../docs/INTEGRATION.md#react-and-nextjs-fanfinitysfere-sdkreact).

## Configuration

Options for `SfereAnalytics.load()` (`SfereLoadOptions` in `dist/index.d.ts`):

| Option | Type | Required | Default | Notes |
|--------|------|----------|---------|-------|
| `writeKey` | string | yes | — | Public browser key, `keyId:secret`. Sent as `Authorization: Basic` and in the request body. |
| `host` | string | yes | — | Ingestion origin: scheme + host, no path (e.g. `https://ingest.example.com`). Events go to `{host}/api/s/{t,p,i,g,a}`. |
| `batching` | boolean \| `{ size?: number; timeout?: number }` | no | `false` | `true` batches up to 10 events or 5000 ms, whichever first, to `{host}/v1/batch/b`. |
| `cdnURL` | string | no | CDN build: the origin that served the bundle; npm build: `host` | Origin the underlying library would resolve lazy chunks against. Nothing is fetched from it in practice. |
| `consent` | `Record<string, boolean>` | no | — | Initial consent categories, sent as `context.consent.categoryPreferences`. |
| `sessionTimeoutMinutes` | number | no | `30` | Inactivity after which `context.session.id` rotates. |
| `clickIdStorage` | `"session"` \| `"local"` | no | `"session"` | Where URL click IDs persist (`sfere_click_ids`). |
| `disableClientPersistence` | boolean | no | auto | Keep the queue, anonymous ID and traits in memory only. Turned on automatically when localStorage or `document.cookie` throws (sandboxed iframes, hardened privacy modes); set `true` to force it. |
| `carryTraits` | boolean | no | `true` | Copy identify traits into `context.traits` on every later event. |
| `debug` | boolean | no | `false` | Log every event and plugin step to the console. |

Script-tag attributes: `data-write-key`, `data-host`, and optionally `data-batching="true"`.

## What the SDK adds to every event

| Field | Value | Example |
|-------|-------|---------|
| `context.clientIds` | Ad-platform and analytics identifiers from cookies and URL parameters; keys are `fbp, fbc, ttp, ttclid, scid, scclid, epik, li_fat_id, msclkid, oppref, obref, gclid, wbraid, gbraid, twclid, rdt_cid, clarity_uid, clarity_sid` | `{ "fbp": "fb.1.1727500000000.123", "gclid": "CjwKCAj…" }` |
| `context.campaign.gad_source`, `context.campaign.gad_campaignid` | Google Ads landing parameters, merged into the UTM `campaign` object | `{ "source": "google", "name": "spring", "gad_source": "1", "gad_campaignid": "12345" }` |
| `context.session` | Inactivity-based session, kept in localStorage `sfere_session` | `{ "id": 1727500000000 }` |
| `context.traits` | The visitor's identify traits, copied onto every later event so server-side destinations can match on email and phone. Turn off with `carryTraits: false` | `{ "email": "fan@example.com", "phone": "+966500000000" }` |
| `context.consent` | Categories from the `consent` option or `setConsent()`; omitted when unset | `{ "categoryPreferences": { "advertising": true } }` |
| `context.page.lang` | `<html lang>` when set | `"ar"` |
| `context.library` | This SDK, with the underlying library under `base` | `{ "name": "@fanfinity/sfere-sdk", "version": "0.1.0", "base": "analytics-next@1.84.3" }` |
| `properties.sfere_dedup_id` | On `track` only: kept if your site set it, otherwise the event's `messageId`. Server-side destinations dedupe on `messageId`, so give browser pixels the `messageId` ([Deduplication](../../docs/INTEGRATION.md#deduplication)) | `"ajs-next-1727500000000-…"` |

A landing `fbclid` becomes `context.clientIds.fbc` in Meta's `fb.1.<ms>.<fbclid>` format. The wire payload carries no `_metadata`, and no `integrations` unless you set some on the call.

## Consent

```javascript
sfere.setConsent({ advertising: true, analytics: true });
```

Replaces the categories carried in `context.consent` on every later event. Call it when your consent banner resolves; pass the initial state through the `consent` option on `load()`.

## Tracking events

Use GA4 event names and `properties.items[]` (see [docs/EVENTS.md](../../docs/EVENTS.md) for the vocabulary and typed property shapes):

```javascript
// Page view (once per route change; the loader snippet already sent the first one)
sfere.page("Product", { sku: "12345" });

// Identify on login
sfere.identify("user_123", { email: "fan@example.com" });

// E-commerce
sfere.track("purchase", {
  transaction_id: "order_456",
  value: 179.98,
  currency: "SAR",
  items: [{ item_id: "sku_123", item_name: "Jersey", price: 89.99, quantity: 2 }],
});

// Reset on logout
sfere.reset();
```

## Development

```bash
npm ci
npm run typecheck && npm run lint && npm run format:check
npm run test:coverage
npm run build && npm run size && npm run verify && npm run cdn:manifest
npx playwright install --with-deps chromium   # first time only
npm run test:e2e
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for branch naming, commit standards and changesets, [docs/CI.md](../../docs/CI.md) for what CI runs and [docs/RELEASING.md](../../docs/RELEASING.md) for how a release ships.

## Troubleshooting

**No requests in DevTools?** Check that your Content Security Policy allows `script-src` from `cdn.sfere.io` and `connect-src` to your ingestion host. See [docs/INTEGRATION.md](../../docs/INTEGRATION.md).

**`context.clientIds` is missing pixel IDs on the landing page?** Ad pixels set `_fbp`, `_ttp` and similar cookies asynchronously, so the first event may not carry them yet. A landing `fbclid` is converted to `fbc` immediately. See the [first-event cookie race](../../docs/ARCHITECTURE.md#known-limitation-documented-rather-than-solved).

**Storage or cookies blocked?** The SDK keeps working: it detects a throwing localStorage or `document.cookie` at load time and switches to in-memory mode, so events are still sent (with a per-page anonymous ID and session).

**`window.sfere` is an array?** The bundle has not loaded yet. Calls made on it are queued and replayed; once loaded it is the SDK instance, and references kept to the old array forward to it.

## Third-party software

This SDK uses [@segment/analytics-next](https://github.com/segmentio/analytics-next) (MIT license). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full attribution.

## More

- [Integration guide](../../docs/INTEGRATION.md) — CSP, SPA page views and React bindings, consent, deduplication, troubleshooting
- [Events reference](../../docs/EVENTS.md) — GA4 event names, properties and examples
- [Wire contract](../../docs/WIRE-CONTRACT.md) — the payload every Sfere SDK sends (browser, React, server, mobile)
- [HTTP API](../../docs/HTTP-API.md) — send events without an SDK
- [CDN policy](../../docs/CDN-POLICY.md) — versioning, SRI, aliases, rollback
- [Security](../../SECURITY.md) — vulnerability reporting, what is stored, what is sent
- [Contributing](../../CONTRIBUTING.md) — branch conventions, testing, changesets
- [Operations](../../docs/OPERATIONS.md) — maintainers: what is live, releasing, CDN deploys and rollback, cloud resources, open items
- [Releasing](../../docs/RELEASING.md) and [CI](../../docs/CI.md) — the release pipeline in detail

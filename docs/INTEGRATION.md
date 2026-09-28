# Integration Guide

Step-by-step walkthrough to instrument your site with the Sfere SDK.

## Get a write key

Contact your Sfere account manager to obtain a public browser write key in the format `keyId:secret`. This is safe to embed in client-side code—do not use server-side keys.

## Pick CDN or npm

**CDN**: Fastest setup, no build required. Paste the loader snippet from the [README](../README.md#script-tag-cdn) (it is `src/cdn/snippet.html`, verbatim) into `<head>`, replacing `YOUR_WRITE_KEY` and `YOUR_INGESTION_HOST`. It queues calls until the bundle loads and sends the first page view itself. If you do not need to call the SDK before it has loaded, a plain tag also works — the bundle auto-initialises from its `data-*` attributes:

```html
<script
  async
  src="https://cdn.sfere.io/sdk/v0.1/sfere.min.js"
  data-write-key="keyId:secret"
  data-host="https://ingest.example.com"
></script>
```

`/sdk/v0.1/` is the alias URL (latest 0.1.x). For an SRI-pinned production page use the immutable URL `/sdk/v0.1.0/sfere.min.js` with the hash from its `manifest.json` — see [CDN-POLICY.md](CDN-POLICY.md).

**npm**: Better for single-page apps and teams using a bundler (webpack, Vite, etc.). Allows you to import directly in your framework.

## Content Security Policy (CSP)

Sfere requires two CSP directives:

```http
script-src cdn.sfere.io;
connect-src <your-ingestion-host>;
```

**Example:**
```http
Content-Security-Policy: default-src 'self'; script-src 'self' cdn.sfere.io; connect-src 'self' https://ingest.example.com;
```

If you use a nonce, put it on the inline loader snippet (`<script nonce="…">`) and keep `cdn.sfere.io` in `script-src` (or use `'strict-dynamic'`, which lets the nonced snippet's injected script load). With the plain-tag form above, the nonce goes on that tag:

```html
<script nonce="abc123" async src="https://cdn.sfere.io/sdk/v0.1/sfere.min.js" data-write-key="…" data-host="…"></script>
```

## Single-page app: page views

Call `sfere.page()` every time the route changes. The SDK does not track route changes automatically. With the CDN loader snippet the first page view is already sent by the snippet's `q.page()`; with npm, send it yourself after `load()`.

### React Router v7

```javascript
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SfereAnalytics } from "@fanfinity/sfere-sdk";

const sfere = SfereAnalytics.load({
  writeKey: "keyId:secret",
  host: "https://ingest.example.com"
});

function usePageTracking() {
  const { pathname } = useLocation();

  useEffect(() => {
    // page(name, properties) — the SDK fills in url, path, title and referrer itself
    sfere.page(pathname.split("/")[1] || "home", { path: pathname });
  }, [pathname]);
}

export default function App() {
  usePageTracking();
  return (/* your routes */);
}
```

### Vue Router

```javascript
import { SfereAnalytics } from "@fanfinity/sfere-sdk";
import router from "./router";

const sfere = SfereAnalytics.load({
  writeKey: "keyId:secret",
  host: "https://ingest.example.com"
});

router.afterEach((to) => {
  sfere.page(String(to.name || to.path), { path: to.path });
});

export default sfere;
```

## Identify on login

When a user logs in, call `identify()` with a stable user ID and any properties you want to track:

```javascript
sfere.identify("user_123", {
  email: "fan@example.com",
  name: "Ahmed Al-Dosari",
  subscription_tier: "premium"
});
```

These traits are sent unhashed (hashing happens server-side, per destination) and persisted by the underlying library across page loads (`ajs_user_id`, `ajs_user_traits`), or in memory only when storage is blocked.

## Reset on logout

Clear the user session when a user logs out:

```javascript
sfere.reset();
```

This clears the user ID and traits but preserves the session ID and ad click IDs.

## Consent integration

Integrate with your consent management platform (CMP) callback:

```javascript
// Example: OneTrust callback
window.OnetrustActiveGroups = "";
window.onConsentStatusChange = function() {
  const consent = {
    advertising: window.OnetrustActiveGroups.includes("C0002"),
    analytics: window.OnetrustActiveGroups.includes("C0001")
  };
  sfere.setConsent(consent);
};

// Or generic CMP:
function onCMPReady(cmp) {
  const consent = {
    advertising: cmp.getConsentFor("advertising"),
    analytics: cmp.getConsentFor("analytics")
  };
  sfere.setConsent(consent);
}
```

Always update consent **before** tracking user actions. For initial page load, pass consent to `load()`:

```javascript
const sfere = SfereAnalytics.load({
  writeKey: "keyId:secret",
  host: "https://ingest.example.com",
  consent: {
    advertising: localStorage.getItem("consent_advertising") === "true",
    analytics: localStorage.getItem("consent_analytics") === "true"
  }
});
```

## Deduplication

Browser pixels (Meta Conversions API, TikTok Pixel, Google Ads) and server-side destinations both receive events. Use `sfere_dedup_id` to deduplicate:

1. On a purchase, set `sfere_dedup_id` (a property, next to `transaction_id`) to your order ID:

```javascript
sfere.track("purchase", {
  transaction_id: "order_456",
  value: 179.98,
  currency: "USD",
  sfere_dedup_id: "order_456", // Must match the pixel's event_id
  items: [ /* … */ ]
});
```

2. In your Meta and TikTok pixels, use the same order ID as the `event_id` parameter:

```html
<!-- Meta Pixel -->
<script>
  fbq("track", "Purchase", {
    value: 179.98,
    currency: "USD",
    event_id: "order_456"  // Must match sfere_dedup_id
  });
</script>

<!-- TikTok Pixel -->
<script>
  ttq.track("Purchase", {
    value: 179.98,
    currency: "USD",
    event_id: "order_456"  // Must match sfere_dedup_id
  });
</script>
```

If you don't set `sfere_dedup_id`, the SDK automatically uses the event's `messageId`. Server-side destinations will also use this key.

## Known limitation: first-event cookie race

On a landing page, pixel-set cookies (`_fbp`, `_ttp`, `_scid`, …) may not exist yet when the first event is sent, because the ad pixels run asynchronously. The first event can therefore lack the cookie-based identifiers; later events on the same page and the second page view carry them.

Click IDs carried in the landing URL are not affected: `gclid`, `wbraid`, `gbraid`, `ttclid`, `ScCid`, `twclid`, `epik`, `msclkid`, `li_fat_id`, `oppref` and `rdt_cid` are read from the URL on the very first event and persisted for the session, and a Meta `fbclid` is converted immediately to `context.clientIds.fbc` in the form `fb.1.<milliseconds>.<fbclid>` (a pixel-set `_fbc` cookie later takes precedence unless a newer `fbclid` arrives).

## Troubleshooting

### Verify requests are reaching the ingestion endpoint

1. Open DevTools → Network tab
2. Filter for POST requests to `{host}/api/s/t`
3. Look for requests like: `POST https://ingest.example.com/api/s/t`
4. Response should be `{ "ok": true }`

**CSP errors?**  
Check your Content-Security-Policy header:
- `script-src` must include `cdn.sfere.io`
- `connect-src` must include your ingestion host

**Requests blocked by ad blockers?**  
Some ad blockers may block requests to hosts with "ingest" or "analytics" in the name. If your ingestion host is blocked, use a generic subdomain (e.g., `https://collect.example.com`) instead.

### No click IDs in context.clientIds

**Causes:**
- Ad platform pixels haven't run yet (see first-event cookie race)
- Cookies are blocked by the user's browser or a tracking blocker
- URL click parameters were not present in the landing URL

**Solution:**
- Check the browser's Application tab → Cookies to see whether `_fbp`, `_ttp`, etc. are set; the second page view usually carries them
- Confirm the landing URL actually contained the click parameter (`gclid`, `fbclid`, …); they persist in `sessionStorage` under `sfere_click_ids` (or `localStorage` with `clickIdStorage: "local"`)

### Blocked storage or cookies

The SDK never fails on blocked storage. Its own reads and writes are wrapped in try/catch, and at load time it probes localStorage and `document.cookie`: if either throws (sandboxed iframes, opaque origins, hardened privacy modes), it switches the underlying library to in-memory mode — events are still sent, with an anonymous ID and session that last for the page. You can force this mode with `disableClientPersistence: true`. If you see errors in the console, they come from CSP (see above) or from the network, not from storage.

Local development: `host` may be `http://localhost:<port>`; production hosts must be `https://`.

### Events not batching

By default, events are sent individually to `POST {host}/api/s/{t,p,i,g,a}`. To enable batching:

```javascript
const sfere = SfereAnalytics.load({
  writeKey: "keyId:secret",
  host: "https://ingest.example.com",
  batching: { size: 10, timeout: 5000 }, // flush at 10 events or after 5 s; `true` uses these defaults
});
```

With the CDN snippet, add `s.setAttribute("data-batching", "true")` next to the other attributes (defaults only). Batches go to `POST {host}/v1/batch/b`.

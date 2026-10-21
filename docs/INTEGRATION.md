# Integration Guide

Step-by-step walkthrough to instrument your site with the Sfere SDK.

## Get a write key

Contact your Sfere account manager to obtain a public browser write key in the format `keyId:secret`. This is safe to embed in client-side code—do not use server-side keys.

You also need the ingestion host your events go to. The Sfere event host is `https://events.sfere.io`; use another host only if Sfere gives you one with your keys. The examples in this guide use the placeholder `https://ingest.example.com`.

## Pick CDN or npm

**CDN**: Fastest setup, no build required. Paste the loader snippet from the [browser SDK README](../packages/browser/README.md#script-tag-cdn) (it is `packages/browser/src/cdn/snippet.html`, verbatim) into `<head>`, replacing `YOUR_WRITE_KEY` and `YOUR_INGESTION_HOST`. It queues calls until the bundle loads and sends the first page view itself. If you do not need to call the SDK before it has loaded, a plain tag also works: the bundle auto-initialises from its `data-*` attributes:

```html
<script
  async
  src="https://cdn.sfere.io/sdk/v0.4/sfere.min.js"
  data-write-key="keyId:secret"
  data-host="https://ingest.example.com"
></script>
```

`/sdk/v0.4/` is the alias URL (latest 0.4.x). If the snippet goes somewhere you can never edit again (an app-store app, a published tag template), use `https://cdn.sfere.io/sdk/latest/sfere.min.js` instead: it follows every stable release, majors included. For an SRI-pinned production page use the immutable URL of a released version, `/sdk/v0.4.X/sfere.min.js` (for example `/sdk/v0.4.1/sfere.min.js`), with the hash from its `manifest.json`. See [CDN-POLICY.md](CDN-POLICY.md).

**npm**: Better for single-page apps and teams using a bundler (webpack, Vite, etc.). Allows you to import directly in your framework. Install it from the public npm registry; no token or `.npmrc` setup is needed:

```bash
npm install @sfere-io/sfere-sdk
```

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
<script nonce="abc123" async src="https://cdn.sfere.io/sdk/v0.4/sfere.min.js" data-write-key="…" data-host="…"></script>
```

## Single-page app: page views

Call `sfere.page()` every time the route changes. The SDK does not track route changes automatically. With the CDN loader snippet the first page view is already sent by the snippet's `q.page()`; with npm, send it yourself after `load()`.

### React and Next.js: `@sfere-io/sfere-sdk/react`

The package ships React bindings as a subpath (React 17+ as an optional peer; nothing React-related loads unless you import it):

- `<SfereProvider writeKey host …>` takes every `load()` option plus `disabled`. It loads the SDK **once per write key + host** for the life of the page, so StrictMode, remounts and HMR never start a second queue. Options other than `writeKey` and `host` are read once; changing them later has no effect and logs a console warning. Events sent through the provider carry `context.library.binding: "react"`.
- `useSfere()` returns that instance (`track`, `identify`, `setConsent`, …). Outside a provider it throws.
- `usePageTracking(routeKey, { skipInitial?, name?, properties? })` sends `page()` once per distinct `routeKey`, StrictMode included. The SDK fills in url, path, title and referrer itself.

React Router v7:

```tsx
import { useLocation } from "react-router-dom";
import { SfereProvider, usePageTracking, useSfere } from "@sfere-io/sfere-sdk/react";

function PageViews() {
  const { pathname, search } = useLocation();
  usePageTracking(pathname + search);
  return null;
}

export default function App() {
  return (
    <SfereProvider writeKey="keyId:secret" host="https://ingest.example.com">
      <PageViews />
      {/* your routes */}
    </SfereProvider>
  );
}

function AddToCart({ item }) {
  const sfere = useSfere();
  return <button onClick={() => sfere.track("add_to_cart", { currency: "SAR", value: item.price, items: [item] })}>Add</button>;
}
```

Next.js App Router (`app/providers.tsx`, rendered from `app/layout.tsx`). The module is marked `"use client"`, so it can be imported from a client component directly. `useSearchParams()` needs a `<Suspense>` boundary:

```tsx
"use client";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SfereProvider, usePageTracking } from "@sfere-io/sfere-sdk/react";

function PageViews() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  usePageTracking(search ? `${pathname}?${search}` : pathname);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SfereProvider writeKey={process.env.NEXT_PUBLIC_SFERE_WRITE_KEY!} host={process.env.NEXT_PUBLIC_SFERE_HOST!}>
      <Suspense fallback={null}><PageViews /></Suspense>
      {children}
    </SfereProvider>
  );
}
```

Next.js Pages Router: in `_app.tsx`, wrap the page in `<SfereProvider>` and call `usePageTracking(useRouter().asPath)` from a child component.

During server rendering the provider hands out an inert instance whose methods resolve to `undefined`; nothing is sent from the server. Use the React bindings or the CDN loader snippet on a page, not both: each would load its own instance. `skipInitial: true` is for apps where the first page view is already sent elsewhere.

### Vue Router

```javascript
import { SfereAnalytics } from "@sfere-io/sfere-sdk";
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

When a browser pixel and a server-side destination both report the same event, the ad platform counts it once only if both carry the same event ID **and** the same event name. The server-side destinations use the event's `messageId` as that ID, so give the pixel the `messageId` of the SDK event:

```javascript
// Once the SDK has loaded, track() resolves to the sent event.
const ctx = await sfere.track("generate_lead", { form_type: "demo" });
const eventId = ctx.event.messageId;

fbq("track", "Lead", {}, { eventID: eventId });                 // Meta: 4th argument
ttq.track("Lead", {}, { event_id: eventId });                    // TikTok
snaptr("track", "SIGN_UP", { client_dedup_id: eventId });       // Snap
lintrk("track", { conversion_id: 123456, event_id: eventId });  // LinkedIn
```

Other platforms take it as OpenAI `oaiq("measure", name, props, { event_id })`, Microsoft UET `event_id`, X `conversion_id` and Google Ads `transaction_id`.

- **Names must match too.** The pixel's event name must be the one the destination sends for your SDK event (for example `generate_lead` becomes Meta `Lead`, TikTok `Lead`, Snap `SIGN_UP`).
- **Loaded through Google Tag Manager?** Push the ID to the `dataLayer` from the `track()` result and read it in the pixel tags with a Data Layer Variable.
- **Wait for the loaded instance.** Before the bundle loads, `window.sfere` is the loader stub, and its calls return the stub, not a promise. The loaded instance is itself thenable, so if you wrap it in a promise, box it (`resolve({ sfere })`); resolving a promise with it directly hands you `[Analytics, Context]` instead.

`properties.sfere_dedup_id` is still set on every `track` (your own value, or the `messageId`), but the server-side destinations don't read it. Don't use it to pass an order ID to the pixel: the two IDs would no longer match.

## Known limitation: first-event cookie race

On a landing page, pixel-set cookies (`_fbp`, `_ttp`, `_scid`, …) may not exist yet when the first event is sent, because the ad pixels run asynchronously. The same applies to Microsoft Clarity's `_clck` / `_clsk` cookies (`clarity_uid` / `clarity_sid`), which the Clarity script sets after it loads. The first event can therefore lack the cookie-based identifiers; later events on the same page and the second page view carry them.

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

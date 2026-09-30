# Sfere for Salla storefronts

`@fanfinity/sfere-salla` is one script, `sfere-salla.min.js`, served from `cdn.sfere.io`. It runs on every Salla storefront that installs the Sfere app, and it does three things:

1. It waits for the storefront (`Salla.onReady`), then loads the [Sfere browser SDK](../browser) from the CDN. The SDK URL is pinned and SRI-checked.
2. It registers **one** storefront analytics tracker (`Salla.analytics.registerTracker`). The tracker forwards every storefront event to `window.sfere`.
3. It identifies logged-in customers.

The package is **private**. It is never published to npm, and the CDN is the only way to get it. The config comes from the tag that loads the script, not from the build. So one App Snippet serves every store.

## The App Snippet

Salla's App Snippet field takes **JavaScript, not HTML**. Salla rejects a `<script>` tag there. Paste this into the app's App Snippet in the Salla Partners portal, and replace the two placeholders:

```js
(function (d) {
  if (d.querySelector("script[data-sfere-salla]")) return;
  var s = d.createElement("script");
  s.async = true;
  s.src = "https://cdn.sfere.io/integrations/salla/v0.1.0/sfere-salla.min.js";
  s.integrity = "sha384-<files[0].sha384 from https://cdn.sfere.io/integrations/salla/v0.1.0/manifest.json>";
  s.crossOrigin = "anonymous";
  s.setAttribute("data-sfere-salla", "");
  s.setAttribute("data-write-key", "YOUR_BROWSER_WRITE_KEY");
  s.setAttribute("data-host", "https://YOUR_INGESTION_HOST");
  s.setAttribute("data-store-id", "{{store.id}}");
  (d.head || d.documentElement).appendChild(s);
})(document);
```

- **Use the immutable URL with SRI** (`/v0.1.0/`), as [CDN-POLICY.md](../../docs/CDN-POLICY.md) requires. Take the hash from that version's `manifest.json`, or from the `<script>` line `npm run cdn:manifest` prints. `crossOrigin = "anonymous"` is required, or the browser skips the integrity check. The alias `/integrations/salla/v0.1/` follows the latest 0.1.x. Use it only without an `integrity`, and only on a store you can afford to have change under you.
- **`YOUR_BROWSER_WRITE_KEY`** is the ingest-only browser key. It is public by design, because every visitor's browser sees it. It still lives only in the portal and never in this repository. Staging uses **one browser key for all stores**; see [Per-store write keys](#per-store-write-keys) for the follow-up.
- **`{{store.id}}`** is a Salla snippet template parameter. It is optional: the integration reads the store id from `Salla.config` first. If the value reaches the page unrendered (it still contains `{{`), it is ignored.

## Configuration

Each option is read from a `data-*` attribute on the loading tag first. If the attribute is missing, the option is read from the query string of the tag's `src`.

| Attribute | Query | Required | Meaning |
|---|---|---|---|
| `data-write-key` | `write_key` | yes | Browser write key. |
| `data-host` | `host` | yes | Ingestion endpoint, `https://...`. Trailing `/` is stripped. |
| `data-store-id` | `store_id` | no | Fallback store id, used when `Salla.config` has none. |
| `data-sdk-src` | `sdk_src` | no | Load a different SDK build, for testing only. With an override, SRI is set only if `data-sdk-integrity` is given. |
| `data-sdk-integrity` | `sdk_integrity` | no | SRI hash for `data-sdk-src`. |
| `data-debug` | `debug` | no | `true` or `1`: log `[Sfere] ...` lines. |

Without a write key and an `http(s)` host, the script does nothing. It never throws into the storefront.

**SDK pin.** By default the script loads `https://cdn.sfere.io/sdk/v0.3.2/sfere.min.js` with that build's SRI hash (`src/config.ts`). That is an immutable URL, so the SDK a store runs changes only when a new integration version ships. It is not the 0.1 line: 0.1.x does not carry `identify` traits onto later events. To move the pin, update `SDK_VERSION`, `SDK_SRC` and `SDK_INTEGRITY` from the new SDK version's `manifest.json`, and ship a new integration version.

## What it sends

| Storefront | Sfere |
|---|---|
| `track(name, payload)` | `sfere.track(name, {...payload, store_id, source: "salla_browser"})`. The storefront already emits the SDK's event names (`Product Viewed`, `Product Added`, `Cart Viewed`, `Order Completed`, ...), so names pass through unchanged. |
| page load | One `sfere.page({store_id, source})`. |
| storefront `page()` | Dropped when it is for the URL already sent, and sent for a new URL. |
| logged-in customer | `sfere.identify(user.id, {email, phone, firstName, lastName})` before the first page. Plain values; hashing is server-side. A guest is never identified. |
| `Order Completed` | Also gets `sfere_dedup_id = salla.purchase.{store_id}.{order_id}` (at most 64 characters). The server-side order event uses the same id, so the purchase is counted once. |

When the tracker registers, the storefront replays the current page's `Product Viewed` to it. That event is forwarded like any other.

Consent is not wired. Salla exposes no consent API that we have verified, so nothing calls `setConsent()`.

**Debugging.** Add `?sfere_debug=1` to a storefront URL, or set `localStorage.sfere_debug = "1"`, `window.SFERE_DEBUG = true` or `data-debug="true"`. Without one of these the script logs nothing. `window.SfereSalla.version` shows which version is running.

**CSP.** A store with a Content Security Policy must allow `script-src cdn.sfere.io` and `connect-src` for the ingestion host.

## CDN

| Kind | URL |
|---|---|
| Immutable | `https://cdn.sfere.io/integrations/salla/v{X.Y.Z}/sfere-salla.min.js` (+ `manifest.json`) |
| Alias | `https://cdn.sfere.io/integrations/salla/v0.{minor}/sfere-salla.min.js` (+ `manifest.json`) |

These URLs follow the same caching, immutability and rollback rules as `/sdk/` ([CDN-POLICY.md](../../docs/CDN-POLICY.md)). `package.json`'s `sfereCdn` block tells the shared scripts in `packages/browser/scripts/` (`cdn-manifest.mjs`, `cdn-publish.sh`, `size-check.mjs`) what to do: the path prefix, the file list, the entry and the gzip budget (2,350 B, the 0.1.0 measurement plus about 10%).

**Releasing.** Add a changeset for `@fanfinity/sfere-salla` and merge. When the Version Packages PR merges, `release.yml` tags `@fanfinity/sfere-salla@X.Y.Z`, and `cdn-deploy.yml` (`target: salla`) publishes it. Rollback:

```sh
gh workflow run cdn-deploy.yml --ref main -f target=salla -f version=<X.Y.Z> -f alias_only=true
```

Before the **second** release on an alias line, re-run `infra/cdn/provision.sh` with that line in `CDN_ALIASES`, e.g. `CDN_ALIASES="v0.1 v0.2 v0.3 v0.4 integrations/salla/v0.1"`. The first release only creates the alias objects. The second overwrites them, which needs the conditioned delete grant. See [RELEASING.md](../../docs/RELEASING.md).

## Per-store write keys

For now one browser key serves every store, and `store_id` on each event tells the stores apart. That is the staging default. To give each store its own key, one of these is needed:

- A per-store value that Salla can render into the snippet, as a template parameter like `{{store.id}}`. The value would be the key, or a lookup key. This is only possible if Salla supports app-settings parameters in snippets, which is not verified.
- A small key-lookup endpoint that maps a store id to its key. The script would fetch it before it loads the SDK.

Neither is built. The script's config surface (`data-write-key` per tag) already supports both.

## Known gaps

- **Checkout.** Salla's checkout runs on `pay.salla.sa`. Whether App Snippets run there is **unverified**, so browser-side checkout events may be missing. The server-side order event (with the shared `sfere_dedup_id`) is the record of truth for purchases.
- `Order Completed` dedup assumes the storefront's `order_id` equals the order webhook's id. This is not yet verified.

## Development

```sh
npm run build -w @fanfinity/sfere-salla     # dist/cdn/sfere-salla.min.js
npm run test:coverage -w @fanfinity/sfere-salla
npm run verify -w @fanfinity/sfere-salla    # bundle contract + a mocked storefront run
npm run size -w @fanfinity/sfere-salla
npm run cdn:manifest -w @fanfinity/sfere-salla
```

The unit tests (`test/unit/`) run the integration against a mocked `window.Salla` in happy-dom.

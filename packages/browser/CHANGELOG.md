# @sfere-io/sfere-sdk

## 0.4.0

### Minor Changes

- df490d9: The package moved from `@fanfinity/sfere-sdk` to `@sfere-io/sfere-sdk`, with the React bindings at `@sfere-io/sfere-sdk/react`, after the GitHub organisation was renamed to `sfere-io`. Install the new name and update your imports. Events now carry `context.library.name: "@sfere-io/sfere-sdk"` (was `"@fanfinity/sfere-sdk"`); anything that filters on that value must accept both. The API and the CDN URLs are unchanged.

## 0.3.2

### Patch Changes

- e476aa0: The npm package now contains its build. Every npm release up to 0.3.1 was published without `dist/` (the release job never built it), so `import "@fanfinity/sfere-sdk"` failed to resolve. The CDN bundles were never affected. No code changes.

## 0.3.1

### Patch Changes

- 5ad2974: The storage/cookie probe in `load()` now removes its `sfere_probe` cookie with an expiry date in the past instead of `max-age=0`, which some DOM implementations kept readable. No behaviour change in browsers.

## 0.3.0

### Minor Changes

- 32271b5: React bindings at `@fanfinity/sfere-sdk/react`: `SfereProvider` (loads once per write key and host, StrictMode-safe), `useSfere()` and `usePageTracking(routeKey)`. React 17–19 is an optional peer dependency. Events sent through the provider carry `context.library.binding: "react"`. The main entry and the CDN bundle are unchanged.

## 0.2.0

### Minor Changes

- 32a32be: Events after `identify` now carry the visitor's traits in `context.traits`, so server-side destinations can match leads on email and phone. Opt out with `carryTraits: false`.
- 32a32be: `context.clientIds` now carries Microsoft Clarity's IDs: `clarity_uid` (first `^`-separated field of the `_clck` cookie) and `clarity_sid` (first field of `_clsk`). It also carries `obref` from the OpenAI pixel's `__obref` cookie.

### Patch Changes

- 32a32be: Docs: deduplication now describes what the server-side destinations actually do. They dedupe on the event's `messageId`, so browser pixels must be given the `messageId` from `track()`'s result, and `sfere_dedup_id` is not read server-side.

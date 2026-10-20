# @sfere-io/sfere-node

## 0.2.0

### Minor Changes

- df490d9: The package moved from `@fanfinity/sfere-node` to `@sfere-io/sfere-node` after the GitHub organisation was renamed to `sfere-io`. Install the new name and update your imports. Events now carry `context.library.name: "@sfere-io/sfere-node"` (was `"@fanfinity/sfere-node"`); anything that filters on that value must accept both. The API is unchanged.

## 0.1.1

### Patch Changes

- e476aa0: The npm package now contains its build. 0.1.0 was published without `dist/` (the release job never built it), so it could not be imported. No code changes.

## 0.1.0

### Minor Changes

- e00ea1d: First release of the Sfere Node SDK. `SfereAnalytics` sends server-to-server events to `{host}/v1/batch` in the Sfere wire shape: its own `context.library`, no `_metadata`, no empty `integrations`, a `sfere_dedup_id` on every `track`, and call order kept across event types. `requestContext(req)` builds the customer's IP, user agent, locale, page, campaign and ad click IDs from a Node `IncomingMessage` or a Fetch API `Request`, because ingestion does not fill them in for server events.

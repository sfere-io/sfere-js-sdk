# @sfere-io/sfere-node

## 0.1.1

### Patch Changes

- e476aa0: The npm package now contains its build. 0.1.0 was published without `dist/` (the release job never built it), so it could not be imported. No code changes.

## 0.1.0

### Minor Changes

- e00ea1d: First release of the Sfere Node SDK. `SfereAnalytics` sends server-to-server events to `{host}/v1/batch` in the Sfere wire shape: its own `context.library`, no `_metadata`, no empty `integrations`, a `sfere_dedup_id` on every `track`, and call order kept across event types. `requestContext(req)` builds the customer's IP, user agent, locale, page, campaign and ad click IDs from a Node `IncomingMessage` or a Fetch API `Request`, because ingestion does not fill them in for server events.

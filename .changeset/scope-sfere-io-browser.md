---
"@sfere-io/sfere-sdk": minor
---

The package moved from `@fanfinity/sfere-sdk` to `@sfere-io/sfere-sdk`, with the React bindings at `@sfere-io/sfere-sdk/react`, after the GitHub organisation was renamed to `sfere-io`. Install the new name and update your imports. Events now carry `context.library.name: "@sfere-io/sfere-sdk"` (was `"@fanfinity/sfere-sdk"`); anything that filters on that value must accept both. The API and the CDN URLs are unchanged.

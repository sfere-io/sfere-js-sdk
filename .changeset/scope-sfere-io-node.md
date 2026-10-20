---
"@sfere-io/sfere-node": minor
---

The package moved from `@fanfinity/sfere-node` to `@sfere-io/sfere-node` after the GitHub organisation was renamed to `sfere-io`. Install the new name and update your imports. Events now carry `context.library.name: "@sfere-io/sfere-node"` (was `"@fanfinity/sfere-node"`); anything that filters on that value must accept both. The API is unchanged.

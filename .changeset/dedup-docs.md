---
"@fanfinity/sfere-sdk": patch
---

Docs: deduplication now describes what the server-side destinations actually do. They dedupe on the event's `messageId`, so browser pixels must be given the `messageId` from `track()`'s result, and `sfere_dedup_id` is not read server-side.

---
"@fanfinity/sfere-salla": minor
---

Per-store browser keys for the one shared App Snippet. With `data-config-url` (or `config_url`) and no `data-write-key`, the script takes the store id (`data-store-id`, else `Salla.config` `store.id`), GETs `<config-url>?store_id=<id>` for `{write_key, host}`, caches it in `sessionStorage` per store, and then loads the SDK as before. A 404, a network failure or an unusable reply (no key, or a host that is not http(s)) leaves the integration inert, with a debug log only. A static `data-write-key` still wins and never fetches.

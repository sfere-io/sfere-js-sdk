---
"@fanfinity/sfere-sdk": minor
---

`context.clientIds` now carries Microsoft Clarity's IDs: `clarity_uid` (first `^`-separated field of the `_clck` cookie) and `clarity_sid` (first field of `_clsk`). It also carries `obref` from the OpenAI pixel's `__obref` cookie.

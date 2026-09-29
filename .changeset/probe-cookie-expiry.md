---
"@fanfinity/sfere-sdk": patch
---

The storage/cookie probe in `load()` now removes its `sfere_probe` cookie with an expiry date in the past instead of `max-age=0`, which some DOM implementations kept readable. No behaviour change in browsers.

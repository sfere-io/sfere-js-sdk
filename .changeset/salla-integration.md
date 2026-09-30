---
"@fanfinity/sfere-salla": minor
---

New: the Salla storefront integration, `sfere-salla.min.js` on `cdn.sfere.io/integrations/salla/`. One App Snippet for every store: it reads its write key and host from the loading tag, loads the Sfere SDK 0.3.2 from its immutable URL with SRI, registers one storefront analytics tracker that forwards every event with `store_id` and `source: "salla_browser"`, identifies logged-in customers, and sets `sfere_dedup_id` on `Order Completed`.

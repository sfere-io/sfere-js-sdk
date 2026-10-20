# Events Reference

The Sfere SDK uses the GA4 e-commerce vocabulary for event and property names, so one instrumentation feeds analytics and server-side conversion destinations alike. The SDK passes event names and properties through untouched; the shapes below are also exported as TypeScript types (`EcommerceEventMap`, `Item`, `PurchaseProperties`, … from `@sfere-io/sfere-sdk`).

## Naming rules

- **Event names**: GA4 names verbatim, snake_case. Any other name is accepted and forwarded as-is.
- **Properties**: snake_case, GA4 field names.
- **Currency**: ISO 4217 code (`SAR`, `USD`, `AED`) — required by GA4 whenever `value` is set.
- **Value**: a number, not a string.
- **Items**: `items[]`, one object per product line, using the fields below.
- **`sfere_dedup_id`**: set on every `track` (your own value, or the event's `messageId`). The server-side destinations dedupe on the event's `messageId`, so give browser pixels the `messageId`; see [INTEGRATION.md](INTEGRATION.md#deduplication).

## Core events

| Event | When to fire | Properties (GA4 required) | Optional |
|-------|--------------|---------------------------|----------|
| `view_item` | Product detail page viewed | `currency`, `value`, `items[]` | — |
| `view_item_list` | Product listing viewed | `items[]` | `item_list_id`, `item_list_name` |
| `select_item` | Product clicked in a list | `items[]` | `item_list_id`, `item_list_name` |
| `add_to_cart` | Product added to cart | `currency`, `value`, `items[]` | — |
| `remove_from_cart` | Product removed from cart | `currency`, `value`, `items[]` | — |
| `add_to_wishlist` | Product added to a wishlist | `currency`, `value`, `items[]` | — |
| `view_cart` | Cart viewed | `currency`, `value`, `items[]` | — |
| `begin_checkout` | Checkout started | `currency`, `value`, `items[]` | `coupon` |
| `add_shipping_info` | Shipping method chosen | `currency`, `value`, `items[]` | `coupon`, `shipping_tier` |
| `add_payment_info` | Payment details entered | `currency`, `value`, `items[]` | `coupon`, `payment_type` |
| `purchase` | Order completed | `transaction_id`, `currency`, `value`, `items[]` | `coupon`, `tax`, `shipping` |
| `refund` | Order refunded (full or partial) | `transaction_id`, `currency`, `value` | `items[]`, `coupon`, `tax`, `shipping` |
| `search` | Site search submitted | `search_term` | — |
| `sign_up` | Account created | — | `method` |
| `login` | User logged in | — | `method` |
| `generate_lead` | Lead form submitted | — | `currency`, `value` |

## Item object

Fields of each element of `items[]` (`Item` type):

| Field | Type | Example |
|-------|------|---------|
| `item_id` | string | `"sku_12345"` |
| `item_name` | string | `"Away Jersey"` |
| `price` | number | `89.99` |
| `quantity` | number | `2` |
| `item_brand` | string | `"Al-Hilal"` |
| `item_category` … `item_category5` | string | `"Apparel"` |
| `item_variant` | string | `"XL"` |
| `item_list_id`, `item_list_name` | string | `"related"`, `"Related products"` |
| `index` | number | `3` |
| `coupon` | string | `"SUMMER20"` |
| `discount` | number | `10` |
| `affiliation` | string | `"Riyadh store"` |
| `location_id` | string | `"ChIJ…"` |

GA4 requires `item_id` or `item_name` on every item. Extra keys (e.g. `image_url`, `url`) are allowed and forwarded unchanged.

## Examples

### View item

```javascript
sfere.track("view_item", {
  currency: "SAR",
  value: 89.99,
  items: [
    {
      item_id: "sku_12345",
      item_name: "Away Jersey",
      price: 89.99,
      quantity: 1,
      item_brand: "Al-Hilal",
      item_category: "Apparel",
    },
  ],
});
```

### Add to cart

```javascript
sfere.track("add_to_cart", {
  currency: "SAR",
  value: 89.99,
  items: [
    { item_id: "sku_12345", item_name: "Away Jersey", price: 89.99, quantity: 1, item_category: "Apparel" },
  ],
});
```

### Begin checkout

```javascript
sfere.track("begin_checkout", {
  currency: "SAR",
  value: 229.97,
  coupon: "SUMMER20",
  items: [
    { item_id: "sku_12345", item_name: "Away Jersey", price: 89.99, quantity: 2, coupon: "SUMMER20" },
    { item_id: "sku_67890", item_name: "Home Shorts", price: 49.99, quantity: 1 },
  ],
});
```

### Purchase

```javascript
sfere.track("purchase", {
  transaction_id: "order_98765",
  currency: "SAR",
  value: 256.96,
  tax: 16.99,
  shipping: 10.0,
  coupon: "SUMMER20",
  sfere_dedup_id: "order_98765",
  items: [
    { item_id: "sku_12345", item_name: "Away Jersey", price: 89.99, quantity: 2, coupon: "SUMMER20" },
    { item_id: "sku_67890", item_name: "Home Shorts", price: 49.99, quantity: 1 },
  ],
});
```

### Refund (partial)

```javascript
sfere.track("refund", {
  transaction_id: "order_98765",
  currency: "SAR",
  value: 89.99,
  items: [{ item_id: "sku_12345", item_name: "Away Jersey", price: 89.99, quantity: 1 }],
});
```

## Additional context

Every event automatically carries `context.clientIds`, `context.campaign.gad_*`, `context.session`, `context.consent` (when set), `context.page.lang` (when set), `context.library`, and — on `track` — `properties.sfere_dedup_id`. See the README's "What the SDK adds to every event" for values and examples; you do not add these yourself.

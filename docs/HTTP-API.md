# HTTP API

Send events to Sfere from any language or platform without an SDK. The payload is the same one the SDKs send ([WIRE-CONTRACT.md](WIRE-CONTRACT.md)), and event names follow [EVENTS.md](EVENTS.md).

## Base URL and keys

- **Base URL:** the Sfere event host, `https://events.sfere.io`, unless Sfere gives you a different ingestion host with your write keys. The examples below use the placeholder `https://ingest.example.com`.
- **Browser key:** for code that runs on the visitor's device. It is public.
- **Server key:** for your backend only. Keep it secret.

Pass the key in one of these ways:

| Method | Example |
|---|---|
| Basic auth (recommended) | `Authorization: Basic base64("keyId:secret:")`. The key is the username and the password is empty. In curl: `-u 'keyId:secret:'` |
| Header | `X-Write-Key: keyId:secret` |
| Body (batch endpoint only) | `"writeKey": "keyId:secret"` |

## Send one event

`POST /api/s/{type}`. `{type}` is one of:
- `track`
- `page`
- `screen`
- `identify`
- `group`
- `alias`

From a backend, use `POST /api/s/s2s/{type}` with a server key.

```bash
curl https://ingest.example.com/api/s/s2s/track \
  -u 'keyId:secret:' \
  -H 'Content-Type: application/json' \
  -d '{
    "messageId": "order-456-purchase",
    "userId": "user_123",
    "event": "purchase",
    "timestamp": "2026-09-29T10:00:00.000Z",
    "properties": {
      "transaction_id": "order_456",
      "currency": "SAR",
      "value": 179.98,
      "items": [{ "item_id": "sku_123", "item_name": "Jersey", "price": 89.99, "quantity": 2 }],
      "sfere_dedup_id": "order-456-purchase"
    },
    "context": {
      "ip": "203.0.113.7",
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) …",
      "traits": { "email": "fan@example.com", "phone": "+966500000000" },
      "clientIds": { "fbp": "fb.1.1727500000000.123", "gclid": "CjwKCAj…" },
      "page": { "url": "https://shop.example.com/checkout/thanks" }
    }
  }'
```

Identify:

```bash
curl https://ingest.example.com/api/s/s2s/identify -u 'keyId:secret:' -H 'Content-Type: application/json' \
  -d '{ "userId": "user_123", "traits": { "email": "fan@example.com", "first_name": "Sara" } }'
```

## Send a batch

`POST /v1/batch`. Up to 100 events and 500 KB per request.

```bash
curl https://ingest.example.com/v1/batch -u 'keyId:secret:' -H 'Content-Type: application/json' \
  -d '{
    "batch": [
      { "type": "identify", "messageId": "m-1", "userId": "user_123", "traits": { "email": "fan@example.com" } },
      { "type": "track", "messageId": "m-2", "userId": "user_123", "event": "add_to_cart",
        "properties": { "currency": "SAR", "value": 89.99, "items": [{ "item_id": "sku_123", "price": 89.99, "quantity": 1 }] } }
    ],
    "context": { "ip": "203.0.113.7", "userAgent": "…" }
  }'
```

Each batch item needs `type`. A top-level `context` applies to every item.

## Fields

| Field | Required | Notes |
|---|---|---|
| `type` | batch only | On `/api/s/{type}` the path sets it |
| `userId` or `anonymousId` | one of them | `anonymousId` for visitors who have not logged in |
| `messageId` | recommended | Unique per event, `[A-Za-z0-9._-]`, at most 64 characters. Sfere generates one if it is missing. Make it stable (e.g. `order-456-purchase`) so a retried request is not counted twice |
| `event` | `track` | GA4 name, at most 128 characters ([EVENTS.md](EVENTS.md)) |
| `timestamp` | no | ISO 8601. Defaults to the time Sfere received the event |
| `properties`, `traits` | no | Plain values. Do **not** hash email or phone; Sfere hashes per destination |
| `context.ip`, `context.userAgent` | **yes, from a backend** | The end user's, from the original request. Sfere never fills them in for server events, so without them ad-platform matching has no IP or browser to go on |
| `context.clientIds` | recommended | Ad-platform identifiers from the visitor's cookies (`_fbp` → `fbp`, `_fbc` → `fbc`, `_ttp` → `ttp`, …) and landing URL (`gclid`, `ttclid`, …). Key list: [WIRE-CONTRACT.md §4](WIRE-CONTRACT.md#4-sfere-context-fields) |
| `properties.sfere_dedup_id` | for events also sent from the browser | Use the same value on both sides so destinations count the conversion once |

Keep payloads flat and predictable. Every distinct property name becomes a column in your analytics warehouse.

## Responses

| Endpoint | Success | Failure |
|---|---|---|
| `/api/s/s2s/{type}` | `200` | `401` for an invalid key, `400` for a malformed body. Retry only `429` and `5xx` |
| `/api/s/{type}` (browser key) | `200 {"ok":true}` | HTTP `200` with an error message in the body; read the body |
| `/v1/batch` | `200 {"ok":true,"receivedEvents":2,"okEvents":2}` | `401` for an invalid key. `okEvents` lower than `receivedEvents` means some events were rejected |

Bodies over 1 MB are rejected.

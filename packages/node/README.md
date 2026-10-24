# Sfere Node SDK

Send first-party fan events to Sfere from your server: purchases, refunds, sign-ups, and anything else your backend knows about. Each event carries the end user's IP, user agent and ad click IDs taken from their request, so server-side conversions match on ad platforms as well as browser events do.

> **Status:** the 0.2 line, on the public npm registry from 0.2.2 (no token needed). Node.js 20+. ESM and CommonJS.

## Install

```bash
npm install @sfere.io/sfere-node
```

The package is on the public npm registry, so no token or `.npmrc` setup is needed.

## Quick start

```javascript
import { SfereAnalytics, requestContext } from "@sfere.io/sfere-node";

const sfere = new SfereAnalytics({
  writeKey: process.env.SFERE_WRITE_KEY, // server key: keep it secret
  host: "https://ingest.example.com",
});

// In a request handler (Express, Fastify, Next.js, plain http, a Fetch API Request):
sfere.track({
  userId: "user_123",
  event: "purchase",
  properties: {
    transaction_id: "order_456",
    currency: "SAR",
    value: 179.98,
    items: [{ item_id: "sku_123", item_name: "Jersey", price: 89.99, quantity: 2 }],
    sfere_dedup_id: "order_456", // same value as the browser's purchase event, if you send one
  },
  context: requestContext(req),
});

// On shutdown, so queued events are sent:
await sfere.closeAndFlush();
```

Use a **server key**. A browser key belongs in pages and apps; a server key must never leave your backend.

## Why `requestContext(req)` matters

Sfere does not fill in the IP or user agent of server-sent events: a server event's origin is your server, not your customer. Ad-platform conversion APIs match on the customer's IP, user agent and click IDs, so pass them from the request that the customer made:

| Field | From |
|---|---|
| `context.ip` | Left-most `X-Forwarded-For`, then `X-Real-IP`, then the socket address (`trustProxy: false` uses only the socket) |
| `context.userAgent` | `User-Agent` |
| `context.locale` | First `Accept-Language` tag |
| `context.page` | The request URL (or `pageUrl`), plus `Referer` |
| `context.campaign` | `utm_*` and `gad_source` / `gad_campaignid` in that URL (or the referrer's) |
| `context.clientIds` | Ad cookies (`_fbp`, `_fbc`, `_ttp`, `_gcl_aw`, `_scid`, …) and landing click IDs (`gclid`, `ttclid`, `msclkid`, …); a landing `fbclid` becomes `fbc` |

The key names are the same ones the browser SDK sends. The full list is in the [wire contract](../../docs/WIRE-CONTRACT.md#4-sfere-context-fields).

`requestContext` accepts a Node `IncomingMessage` (plain `http`, Express, Fastify's `request.raw`, Next.js Pages API routes) and a Fetch API `Request` (Next.js route handlers, Hono, Remix, edge runtimes). Options:

| Option | Default | Notes |
|---|---|---|
| `trustProxy` | `true` | Read the client IP and host from forwarding headers. Set `false` when the app is reached directly, so a client cannot choose the IP it is reported with |
| `pageUrl` | request URL | The page the customer is on, when the request is an API call from that page |

When the event happens away from a customer request (a webhook, a cron job, a refund issued by staff), pass the context you stored from their session instead, or send the event without one.

## Configuration

| Option | Type | Default | Notes |
|---|---|---|---|
| `writeKey` | string | — | Required. Server key, `keyId:secret` |
| `host` | string | — | Required. Ingestion origin, no path. Events go to `{host}/v1/batch` |
| `flushAt` | number | `15` | Events per request |
| `flushInterval` | number | `10000` | Max ms an event waits before its batch is sent |
| `maxRetries` | number | `3` | Retries per batch on network errors, 5xx and 429, with backoff. A 4xx other than 429 (bad key, bad event) is not retried |
| `httpRequestTimeout` | number | `10000` | Per-request timeout in ms |
| `disable` | boolean | `false` | Accept calls, send nothing (tests, local development) |
| `httpClient` | `HTTPClient` | fetch | Custom transport (proxies, agents, tests) |

`SfereAnalytics` has the underlying analytics client's full API: `track`, `identify`, `page`, `screen`, `group`, `alias`, `flush`, `closeAndFlush`, and `on("error" | "http_request" | …)`.

## What the SDK adds to every event

| Field | Value |
|---|---|
| `context.library` | `{ name: "@sfere.io/sfere-node", version, base: "analytics-node@<version>" }` |
| `properties.sfere_dedup_id` | On `track`: kept if you set it (use the order id), otherwise the event's `messageId` |

The wire payload carries no `_metadata`, and no `integrations` unless you set some. Events leave in the order you send them. Email and phone are sent as plain values: Sfere hashes them per destination.

## Events

Use GA4 event names and `properties.items[]`, the same vocabulary as the browser SDK: [EVENTS.md](../../docs/EVENTS.md).

## Development

From the repository root:

```bash
npm ci
npm run build -w @sfere.io/sfere-node
npm run test:coverage -w @sfere.io/sfere-node
npm run verify -w @sfere.io/sfere-node     # dist contract
npm run test:e2e -w @sfere.io/sfere-node   # packed tarball, real ESM + CommonJS apps
SFERE_WRITE_KEY=… SFERE_HOST=https://… npm run smoke:staging -w @sfere.io/sfere-node
```

## Third-party software

This SDK depends on [@segment/analytics-node](https://github.com/segmentio/analytics-next/tree/master/packages/node) (MIT license). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](LICENSE).

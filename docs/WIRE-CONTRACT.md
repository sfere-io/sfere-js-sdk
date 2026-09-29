# Wire contract: what every Sfere SDK sends

_The source of truth for the browser SDK, the React bindings and the planned server (Node, Python), mobile (iOS, Android, React Native) and tag-manager integrations. A new SDK is done when its events match this page. Event names and properties are in [EVENTS.md](EVENTS.md) and are not repeated here._

Status key: **live** = shipped in the browser SDK and checked on the wire. **planned** = required of the SDK that will introduce it. **UNVERIFIED** = not yet tested against the ingestion endpoint.

## 1. Endpoints

| Path | Use | Sent by |
|---|---|---|
| `POST {host}/api/s/{type}` | one event; `{type}` is `page`, `identify`, `track`, `group`, `alias`, `screen` or its first letter | browser SDK (default), HTTP API |
| `POST {host}/v1/batch`, `{host}/v1/batch/b` | `{ "batch": [...], "writeKey": "…", "context": {…} }` | browser SDK with `batching`, server SDKs (`/v1/batch`), mobile SDKs (`/v1/batch/b`), server tag manager |
| `POST {host}/api/s/s2s/{type}`, `{host}/api/s/s2s/batch` | server-to-server variants | HTTP API from a backend, with a server key |

`{host}` is the tenant's ingestion origin. The public ingress only routes the `/api/s/` and `/v1/batch` prefixes. So:
- **Mobile SDKs** set their API host to `{host}/v1/batch`. They post to `{apiHost}/b`, which lands on `/v1/batch/b`.
- **The `/api/s/s2s/` variants** fall under the `/api/s/` prefix and are routed. Error codes differ from the browser path (§6).

## 2. Authentication

The write key is `keyId:secret`. The endpoint accepts it as any of:
- `Authorization: Basic base64("<keyId:secret>:")`;
- `X-Write-Key: <keyId:secret>`;
- `writeKey` in the body, **batch only**. The single-event path ignores the body key.

Every SDK sends the Basic header, and batch SDKs also put the key in the body.

| Key type | Where | Rule |
|---|---|---|
| Browser key | web pages, mobile apps, the web tag template | Public by design. It is visible in the page, so it grants ingest only |
| Server key | Node, Python, server tag container, backend HTTP calls | Secret. Never ship it in a page or an app binary |

**The key type decides the ingest type, not the path** (verified on staging, 2026-09-29, with a server key). A server key was treated as server ingest (`ingestType: s2s`) on every path:
- `/api/s/s2s/{type}`;
- `/api/s/{type}` (the browser path);
- `/v1/batch`, with the key in Basic auth or only in the body;
- `/v1/batch/b`.

Still untested: a *browser* key on `/v1/batch`. The browser SDK's batching mode uses that path, and it already works on the wire (spike config C).

## 3. Event envelope

Standard fields: `type`, `messageId`, `anonymousId`, `userId`, `timestamp`, `context`, and:
- `event` + `properties` on `track`;
- `name` + `properties` on `page` and `screen`;
- `traits` on `identify` and `group`;
- `groupId`, `previousId`.

- `messageId`: unique per event, `[A-Za-z0-9._-]`, at most 64 characters. The ingestion endpoint sanitises and truncates anything else, so generate a compliant one.
- `track.event`: at most 128 characters. Use the GA4 names from [EVENTS.md](EVENTS.md).
- **Must not appear on the wire:**
  - `_metadata`;
  - `integrations`, unless the caller set some explicitly.

  Every unknown field becomes a warehouse column, and the events table has already hit 300+ columns once.
- No client-side hashing and no phone reformatting. Destinations do both, per destination.

## 4. Sfere context fields

| Field | Browser | Server | Mobile | Rule |
|---|---|---|---|---|
| `context.clientIds` | live: cookies + landing URL params | planned: from the incoming request's cookies and URL | planned: from the deep link / install referrer | Key names are fixed by the destinations: `fbp, fbc, ttp, ttclid, scid, scclid, epik, li_fat_id, msclkid, oppref, obref, gclid, wbraid, gbraid, twclid, rdt_cid, clarity_uid, clarity_sid`. A landing `fbclid` becomes `fbc = fb.1.<ms>.<fbclid>` |
| `context.traits` | live: identify traits copied to later events (`carryTraits`) | planned: caller-supplied | planned: same as browser | Plain values (email, phone); never hashed by the SDK |
| `context.session.id` | live: epoch ms, rotates after 30 min of inactivity | optional: forward the browser's | planned: same rule, app foreground counts as activity | Number |
| `context.consent.categoryPreferences` | live: `setConsent()` | planned: forwarded from the browser | planned: `setConsent()` | `{ advertising: bool, analytics: bool, … }`; omitted when unknown |
| `context.library` | live | planned | planned | `{ name: "@fanfinity/sfere-<sdk>", version, base: "<underlying library>@<version>" }`. A framework binding adds `binding` (live: `"react"`) and leaves `name` as its SDK's |
| `context.ip`, `context.userAgent` | filled by the ingestion endpoint | **required**: the end user's, forwarded from the original request | filled by the endpoint / the SDK | Server ingest **keeps whatever `context.ip` the sender sets** and **never fills a missing one**. It records the caller's address separately, as top-level `requestIp`. The CAPI destinations read only `context.ip`, so a server event without it reaches ad platforms with **no IP at all**, and loses that match signal (verified 2026-09-29) |
| `context.page.url`, `.referrer`, `.lang` | live | planned: from the incoming request | n/a | |
| `context.campaign` | live: `utm_*` + `gad_source`, `gad_campaignid` | planned: from the request URL | planned: from the deep link | |
| `context.device.advertisingId`, `context.device.adTrackingEnabled` | n/a | n/a | planned | IDFA only after ATT authorisation; GAID only when the advertising consent category is granted. Otherwise omit, never send zeros |
| `context.app` | n/a | n/a | planned | `{ name, version, build, namespace }` |
| `properties.sfere_dedup_id` | live (`track`) | planned (`track`) | planned (`track`) | Kept when the caller sets it, otherwise `messageId`. A purchase sent from both the browser and a server must carry the **same** value |

## 5. Delivery

- Retry on network errors, `5xx` and `429`, with backoff. Do not retry other `4xx`.
- Keep events in a persisted queue across restarts where the platform allows: localStorage (browser) or disk (mobile). A server SDK flushes on shutdown.
- Batch limits: at most 100 events and 500 KB per request. The endpoint rejects bodies over 1 MB.
- No remote settings fetch and no remote metrics. Every SDK ships its settings inline.
- Never contact a third-party host. Every request goes to the configured `{host}`.

## 6. Responses

| Path | Success | Failure |
|---|---|---|
| browser key, single event | `200 {"ok":true}` | **also HTTP 200**, with an error in the body. Rejected browser events are not retried by status code |
| server key, any path | `200 {"ok":true}`, or on batch `{"ok":true,"okEvents":n,"receivedEvents":n}` | `401 {"error":"stream not found: …"}` for an unknown key (on `/v1/batch` too); `400` for malformed JSON or a `track` without `event` (verified 2026-09-29) |
| batch | `200 {"ok":true,"receivedEvents":n,"okEvents":n}` | `okEvents < receivedEvents` means some were rejected |

## 7. Naming

- Packages: `@fanfinity/sfere-sdk` (browser, with `/react`), then `@fanfinity/sfere-node`, `sfere-analytics` (Python), `SfereAnalytics` (Swift), `io.sfere:analytics` (Android), `@fanfinity/sfere-react-native`.
- Public docs describe the ingestion platform generically. The underlying library names appear only in `THIRD_PARTY_NOTICES.md` and in the `context.library.base` string.

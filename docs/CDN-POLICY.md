# CDN policy

The policy for `https://cdn.sfere.io/sdk/...` — what a developer embedding the
script-tag build needs to know. For how the CDN is provisioned and deployed,
see `../infra/cdn/README.md` and `RELEASING.md`.

## URL scheme: immutable vs. alias

Every published version gets two kinds of URL:

| Kind | Path | Example |
|---|---|---|
| **Immutable** | `/sdk/v{X.Y.Z}/{file}` | `/sdk/v1.4.2/sfere.min.js` |
| **Alias** | `/sdk/v{major}/{file}` (>=1.0.0) or `/sdk/v0.{minor}/{file}` (0.x) | `/sdk/v1/sfere.min.js`, `/sdk/v0.3/sfere.min.js` |
| **Latest** | `/sdk/latest/{file}` | `/sdk/latest/sfere.min.js` |

**Use the immutable URL in production**, pinned with [Subresource Integrity
(SRI)](#subresource-integrity-sri). It never changes bytes once published, so
it's the only URL SRI can validate against — the alias URL is by definition
mutable, and a browser will refuse to load it if you give it an SRI hash that
worked yesterday but not today.

The alias URL exists for **evaluation and internal tooling** that wants
"whatever the latest compatible build is" without a redeploy per patch
release — e.g. a docs playground, or the loader snippet on a page you
control end to end and can tolerate a same-day rollback flipping under it.
Prereleases (a version like `1.5.0-next.0`) **never** get published to an
alias — see "Rollback" below for why that matters.

### The latest channel: embeds you can never edit

`/sdk/latest/` always serves the newest stable release, across every alias
line, majors included. It exists for embeds that cannot be changed once
shipped: an app-store app's injected snippet, a published tag template, a
partner's page we will never touch again. A line alias would freeze there the
day the next minor (0.x) or major ships; `latest` does not.

How it moves (`scripts/cdn-publish.sh`):

- A stable release moves it when its version is `>=` the one `latest` serves,
  so a patch to an older line (say `0.3.4` after `0.4.0`) never drags it back.
- A rollback (`--alias-only`) moves it only while `latest` is on the same line.
  To roll `latest` back across lines, after a bad new minor or major, pass
  `--latest` (workflow input `force_latest`).
- Prereleases never touch it.

Same caching as an alias, same no-SRI rule. **This URL is a compatibility
promise.** Every future release, majors included, reaches these embeds with
no one reviewing them. So the loader contract must never break: the global
name, the queued methods (`track / page / identify / group / alias / reset /
setConsent`), the `data-*` attributes, and the wire format. Breaking changes to
the npm API are fine; breaking changes to that contract need a new channel.
Check a major against an unchanged snippet before you release it.

`manifest.json` alongside every published build (at both the immutable and
alias path) has the authoritative mapping — `urls.immutable` and
`urls.alias` — plus every file's size and hash. `scripts/cdn-manifest.mjs`
generates it at build time and prints a ready-to-paste `<script>` tag.

## Caching

| Path | `Cache-Control` | Why |
|---|---|---|
| Immutable | `public, max-age=31536000, immutable` | Bytes at this URL never change — cache forever, browser-side and at the edge. |
| Alias | `public, max-age=300, stale-while-revalidate=86400` | Short freshness window so a repoint (a new patch release, or a rollback) is picked up within minutes, but a CDN or browser hiccup still serves the last-known-good copy for up to a day while revalidating. |
| `manifest.json` (either path) | inherits its path's rule above | It's just another published file. |

Cloud CDN is configured with `cache-mode=USE_ORIGIN_HEADERS` (see
`../infra/cdn/README.md`) — the headers above, set at upload time by
`scripts/cdn-publish.sh`, are what the edge actually honors. There is no
second, independently configured TTL to keep in sync.

## Subresource Integrity (SRI)

Every immutable URL should be loaded with an SRI hash, so a compromised or
misconfigured CDN edge can't silently serve altered bytes:

```html
<script
  src="https://cdn.sfere.io/sdk/v1.4.2/sfere.min.js"
  integrity="sha384-<from manifest.json>"
  crossorigin="anonymous"
></script>
```

Get the hash from `dist/cdn/manifest.json`'s `files[].sha384` (already in
`sha384-...` SRI form), or from the `<script>` tag `scripts/cdn-manifest.mjs`
prints after a build. `crossorigin="anonymous"` is required for SRI to work
cross-origin at all — omit it and the browser silently skips the integrity
check.

**Never put an SRI hash on an alias URL.** The alias is designed to change
bytes over time; a browser correctly refuses to load it once the hash stops
matching, which turns "the alias moved on" into "the page is broken."

## CORS

`GET`/`HEAD` from any origin (`../infra/cdn/cors.json`), 1-hour preflight
cache. The bundle is a public, unauthenticated static asset — no cookies, no
credentials — so an open CORS policy carries no data-exposure risk; it only
lets any site's JavaScript read the response body (needed for SRI
verification and for any tooling that fetches the bundle text directly).

## Compression

Cloud CDN compresses text responses (`compression-mode=AUTOMATIC`): Brotli
when the client's `Accept-Encoding` allows it, gzip otherwise. This is
edge-side content negotiation — the objects themselves are stored
uncompressed in the bucket, so `manifest.json`'s `gzipBytes` figure (and the
`size` npm script's budget) describe the gzip case specifically, as the
conservative, universally-supported baseline.

## Immutability guarantee, and how it's enforced

**A version, once published, never changes.** This is enforced at the
storage layer, not by convention:

- `scripts/cdn-publish.sh` uploads the immutable path with
  `--if-generation-match=0` — the upload itself fails if anything already
  exists at that name, at any generation. A re-run, or a mistaken re-publish
  of an old version, cannot silently overwrite it.
- The CDN deploy service account holds `roles/storage.objectCreator` and
  `roles/storage.objectViewer` bucket-wide, and `storage.objects.delete`
  **only** under the alias prefixes (`sdk/v0.<minor>/`, `sdk/v<major>/`, `sdk/latest/`),
  through an IAM Condition. Overwriting an existing object in Cloud Storage
  requires delete even with versioning on, so the immutable paths cannot be
  overwritten by the deploy path at all. Full design, and why the condition
  enumerates alias prefixes with `startsWith()` (no regex support on object
  names), in `../infra/cdn/README.md`.

## Rollback

To roll back, re-point an alias at a previously published (already
immutable) version — never re-publish or mutate the old version's bytes:

```sh
packages/browser/scripts/cdn-publish.sh <version-to-roll-back-to> --alias-only   # run from packages/browser
```

`--alias-only` skips the immutable upload entirely (that version's immutable
files are untouched — they're still there, unchanged) and only rewrites the
alias path's objects to match. `.github/workflows/cdn-deploy.yml` (via
`workflow_dispatch`) runs this the same way it runs a normal deploy, just
pointed at an older `version` input — see `RELEASING.md` "Rollback".

This is why prereleases never get an alias: there is nothing safe to roll an
alias *back to* on a track that a prerelease never joined.

## Deprecation and retention

- **Immutable versions are kept forever.** Nothing ever deletes them — SRI
  hashes in the wild, in a client's cached HTML, must keep resolving.
- **Noncurrent alias generations are kept 90 days**
  (`../infra/cdn/lifecycle.json`), then deleted by the bucket's own lifecycle
  rule. This bounds storage cost for the alias path (which accumulates a new
  generation on every release that touches it) without affecting the
  immutable guarantee above — the alias path was never the thing SRI pins
  against.

## Security

- **No cookies are set** by any request to this CDN, and none should ever
  be sent — it's a static, unauthenticated, publicly cacheable asset. A
  cookie on a CDN response would also poison the shared cache across every
  visitor.
- **No query-string cache busting.** Cache invalidation is versioning
  (a new immutable path) or the alias's short TTL, never `?v=...` — a query
  string would fragment the cache per caller for no benefit, since
  `cache-mode=USE_ORIGIN_HEADERS` doesn't key on it specially.
- **Content Security Policy.** A site loading the SDK should allow, at
  minimum:
  ```
  script-src cdn.sfere.io;
  connect-src <your ingestion endpoint host>;
  ```
  The second directive is the host your `SfereAnalytics.load({ host })` call
  points at — it's yours, not `cdn.sfere.io`, and this document doesn't name
  it because it's per-deployment. (Whatever runs behind it is never to be
  named in client-facing material — see the root `CLAUDE.md`; this
  repository never writes vendor names for the ingestion platform.)

## Availability

Cloud CDN and the underlying GCS bucket carry Google's standard multi-region
durability and edge-cache availability characteristics. **No specific uptime
or latency SLA is committed here** — none has been benchmarked or contracted
for this deployment, and none should be quoted to a client until it has.

## Who approves production CDN deploys

`.github/workflows/cdn-deploy.yml`'s `deploy` job runs in the GitHub
Environment `cdn-production`, which only accepts deployments from `main`.
It has **no required reviewer**: the organisation's GitHub plan does not offer
required reviewers on private repositories. In practice the gate is merging
to `main`. A normal release deploys only when a maintainer merges the Version
Packages PR, and a manual deploy or rollback needs someone with write access
to dispatch the workflow on `main`. If the plan changes, add a reviewer under
Settings → Environments → `cdn-production`; no workflow change is needed.

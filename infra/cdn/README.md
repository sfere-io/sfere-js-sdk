# Sfere SDK CDN infrastructure

What serves `https://cdn.sfere.io/sdk/...`. Provisioned by `provision.sh`
(idempotent, **not run by CI** — a human with the right IAM in `koratona-9791a`
runs it, once, by hand). See `../../docs/CDN-POLICY.md` for the URL scheme,
caching contract and rollback procedure this infra exists to serve, and
`../../docs/RELEASING.md` for how `cdn-deploy.yml` uses it after provisioning.

## What `provision.sh` creates

In GCP project `koratona-9791a`, region `me-central2` (Dammam — confirmed with
`gcloud compute regions list --filter=name~me-central`):

1. **`gs://sfere-sdk-cdn`** — uniform bucket-level access, object versioning
   on, a lifecycle rule (`lifecycle.json`) deleting noncurrent versions after
   90 days, and CORS (`cors.json`: GET/HEAD, any origin, 1h preflight cache).
2. **A custom IAM role**, `sfereSdkCdnPublicReader`, holding only
   `storage.objects.get`, bound to `allUsers` on the bucket. See
   "Public read without listing" below for why this isn't
   `roles/storage.objectViewer`.
3. **A deploy service account**, `sfere-sdk-cdn-deploy@koratona-9791a.iam
   .gserviceaccount.com`, with `roles/storage.objectCreator` +
   `roles/storage.objectViewer` on this bucket only, plus a second custom
   role `sfereSdkCdnAliasOverwriter` (`storage.objects.delete` only) bound
   with an **IAM Condition** that limits it to the alias prefixes — see
   "Alias overwrite: delete permission, scoped by IAM Condition". It is bound
   to the **existing** GitHub Actions Workload Identity pool (`github-pool` /
   `github-provider`, documented in `../../../backend/README.md` "One-time
   GCP setup") for the `fanfinity/sfere-sdk` repo only. No new WIF pool is
   created.
4. **A backend bucket** (`sfere-sdk-cdn-backend`) with Cloud CDN enabled:
   `cache-mode=USE_ORIGIN_HEADERS` (so the `Cache-Control` headers
   `cdn-publish.sh` sets on upload are what Cloud CDN actually honors, not a
   second, independently-configured TTL), `compression-mode=AUTOMATIC`, and a
   short (30s) negative-cache TTL for 404s so a not-yet-propagated alias
   pointer doesn't stay "not found" for long.
5. **An HTTPS load balancer**: a global static IP, a Google-managed cert for
   `cdn.sfere.io`, a URL map defaulting every path to the backend bucket, and
   the HTTPS target proxy + forwarding rule tying it together.

## Public read without listing

The brief for this bucket is "public GET, no directory listing." The
predefined `roles/storage.objectViewer` role does not achieve that: it
includes `storage.objects.list`, which — bound to `allUsers` — would let
anyone enumerate every object (every published SDK version, ever) via the
JSON API's list endpoint, not just fetch one by name.

Instead, `provision.sh` creates a **custom role** with exactly one permission,
`storage.objects.get`, and binds only that role to `allUsers`. Anyone who
knows (or guesses) a path can `GET` it; nobody can list the bucket's
contents. This is the standard pattern for "public CDN bucket, no
enumeration" on GCS — there's no built-in predefined role that already does
this.

## Immutable paths: no delete, and a generation precondition

Google documents `roles/storage.objectCreator` as able to create objects but
**not** to replace or overwrite them: overwriting an existing object name
requires `storage.objects.delete`, and that stays true with object
versioning on (versioning decides what happens to the *previous* generation;
it does not remove the permission check). The deploy SA therefore has no
delete permission on the immutable paths, and is stopped twice there:

- **IAM.** Bucket-wide the SA holds only `objectCreator` + `objectViewer`; the
  delete grant below is conditioned to the alias prefixes and never matches
  `sdk/vX.Y.Z/...`.
- **`--if-generation-match=0`** in `../../scripts/cdn-publish.sh`: the upload
  itself fails if any generation already exists at that name, so a re-run or
  a mistaken re-publish of an old version is refused by GCS before IAM is
  even consulted.

## Alias overwrite: delete permission, scoped by IAM Condition

The alias paths (`sdk/v0.<minor>/` while 0.x, `sdk/v<major>/` from 1.0) are
the only objects that are ever re-pointed, so they are the only objects the
SA may overwrite — which means delete. `provision.sh` creates a custom role
`sfereSdkCdnAliasOverwriter` holding exactly `storage.objects.delete` and
binds it to the SA **with an IAM Condition** on the object name:

```
resource.name.startsWith("projects/_/buckets/sfere-sdk-cdn/objects/sdk/v0.1/")
  || resource.name.startsWith("projects/_/buckets/sfere-sdk-cdn/objects/sdk/v1/")   # one clause per alias line
```

Why enumerated `startsWith()` clauses and not one regex: for Cloud Storage,
IAM Conditions on `resource.name` support only `startsWith()`, `endsWith()`,
`extract()`, `==` and `!=` (Google's "Conditions attribute reference",
Resource name → Cloud Storage: "Supported functions and operators:
startsWith(), endsWith(), extract(), ==, !="). There is no `matches()`, so
"one dot at most in the segment" cannot be expressed as a pattern. The
trailing `/` in each prefix is what separates an alias from a version:
`objects/sdk/v0.1/` matches `sdk/v0.1/sfere.min.js` and not
`sdk/v0.1.0/sfere.min.js` (whose name continues with `.0/`). Conditions
require uniform bucket-level access, which the bucket has from creation.

The alias list is the `CDN_ALIASES` variable (default: the alias line of the
version in `package.json`). **A new alias line needs a re-run** with the new
line added — before the *second* release on that line: the first release only
creates the alias objects, which `objectCreator` already allows; the second
overwrites them and would fail with a 403 on the alias upload (the immutable
files are already published at that point; re-run `provision.sh`, then re-run
`cdn-deploy.yml` for that version). `docs/RELEASING.md` carries this as a
checklist item. Re-running with a longer list adds a second, broader binding
next to the old one; the narrower one is a subset and harmless.

Object versioning still matters: an alias overwrite demotes the previous
generation to noncurrent instead of destroying it, and the lifecycle rule
(`lifecycle.json`) reclaims those after 90 days as bucket configuration, not
through any principal's IAM.

If a delete is ever genuinely needed elsewhere (e.g. purging a version
published in error), it's a manual, out-of-band `gcloud storage rm` by
someone with project-level `storage.admin` — never something the CI deploy
path can do.

## DNS

**`cdn.sfere.io` does not resolve today.** Once `provision.sh` has run, it
prints the static IP; create:

```
A   cdn.sfere.io   ->   <the printed IP>
```

The Google-managed certificate only issues after that record resolves and
propagates — until then the LB serves a default certificate and HTTPS
requests to `cdn.sfere.io` will show a cert mismatch. This is expected during
the gap between provisioning and DNS propagation, not a misconfiguration.

## Repository variables this unblocks

`provision.sh`'s final output lines are the exact values to set as repository
Variables on `fanfinity/sfere-sdk` (see `../../docs/RELEASING.md`'s table):
`WIF_PROVIDER`, `CDN_DEPLOY_SA`, `GCP_PROJECT_ID`, `CDN_BUCKET`, and
`CDN_BASE_URL`. Until they're set, `.github/workflows/cdn-deploy.yml` skips
its deploy job cleanly (step-summary note, not a failure) — the release
pipeline stays green before this infra exists.

## Re-running

`provision.sh` is safe to re-run: every create step tolerates "already
exists" and moves on. Re-run it after editing `cors.json` or `lifecycle.json`
— the `buckets update` calls apply the current file's contents each time, so
that part is not merely idempotent but actively syncs config changes; the
`create` calls for already-existing resources are true no-ops.

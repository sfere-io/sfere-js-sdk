# Operations: what is live and how to run it

_Internal maintainer runbook. Last verified 2026-09-28. Start here if you are taking over this repo._

## What is live

| Thing | Where | State |
|---|---|---|
| npm package | `@fanfinity/sfere-sdk` on GitHub Packages (private, follows repo access) | **0.1.0** published |
| Git tag + GitHub release | `v0.1.0`, with `sfere.min.js`, `sfere.js` and `manifest.json` attached | done |
| CDN, immutable | `https://cdn.sfere.io/sdk/v0.1.0/sfere.min.js` | live, `Cache-Control: public, max-age=31536000, immutable` |
| CDN, alias | `https://cdn.sfere.io/sdk/v0.1/sfere.min.js` | live, `Cache-Control: public, max-age=300, stale-while-revalidate=86400` |
| SonarQube Cloud | project `fanfinity_sfere-sdk` (org `fanfinity`) | quality gate passing on `main` |

**Verified end to end on 2026-09-28:**
- A page loaded the SDK from `cdn.sfere.io`, and the staging ingestion endpoint (`console.fanfinity.io`) answered `{"ok":true}` for page, identify and track.
- The events carried `context.clientIds`, `context.campaign` and the Sfere `context.library`.
- No request went to any third-party host.

Production ingestion (`console.sfere.io`) has **not** received SDK traffic yet. Use a production write key from the Sfere console when onboarding the first site.

## Everyday work

1. **Change code:** branch, then open a PR. CI runs typecheck, lint, unit tests, e2e, size, verify and Sonar.
2. **Anything user-facing needs a changeset:** `npm run changeset` (patch / minor / major plus a one-line summary).
3. **Merge to `main`:** `release.yml` opens or updates the **"chore: version packages"** PR.
4. **Merge that PR to ship.** This one merge publishes to GitHub Packages, tags `vX.Y.Z`, creates the GitHub release and deploys the CDN. Details: [RELEASING.md](RELEASING.md).

### Manual CDN deploy or rollback

```sh
# re-deploy a released version (the input is the bare version: 0.1.0, not v0.1.0)
gh workflow run cdn-deploy.yml -R fanfinity/sfere-sdk --ref main -f version=0.1.0

# roll the alias back to a known-good version (never touches immutable files)
gh workflow run cdn-deploy.yml -R fanfinity/sfere-sdk --ref main -f version=0.1.0 -f alias_only=true
```

A full deploy of an already-deployed version fails by design: immutable files are write-once. Use `alias_only=true` for rollbacks.

### Before the second release of a new minor line (0.2.x, 0.3.x, …)

The deploy account may overwrite only the alias folders it was provisioned for. Today that is only `sdk/v0.1/`. The first `0.2.0` release creates `sdk/v0.2/` without trouble. **Before `0.2.1`**, run:

```sh
CDN_ALIASES="v0.1 v0.2" infra/cdn/provision.sh
```

If you skip this, the second deploy on that line fails with a 403 on the alias upload. From 1.0 onwards, alias folders are per major (`v1`, `v2`, …). Background: [../infra/cdn/README.md](../infra/cdn/README.md).

## Cloud resources (GCP project `koratona-9791a`)

| Resource | Name |
|---|---|
| Bucket (me-central2, versioned, uniform access) | `sfere-sdk-cdn` |
| Backend bucket with Cloud CDN | `sfere-sdk-cdn-backend` |
| URL map / HTTPS proxy / forwarding rule | `sfere-sdk-cdn-lb` / `sfere-sdk-cdn-https-proxy` / `sfere-sdk-cdn-https` |
| Static IP | `sfere-sdk-cdn-ip` = `136.69.38.89` |
| Managed certificate | `sfere-sdk-cdn-cert` (auto-renews) |
| DNS | `A cdn.sfere.io → 136.69.38.89`, TTL 300, in Cloud DNS zone `sfereio` |
| Deploy service account | `sfere-sdk-cdn-deploy@koratona-9791a.iam.gserviceaccount.com` |
| Custom roles | `sfereSdkCdnPublicReader` (public GET, no listing), `sfereSdkCdnAliasOverwriter` (delete, alias folders only) |
| GitHub → GCP sign-in | WIF pool `github-pool` / provider `github-provider`. The provider only accepts repos owned by `fanfinity` (tightened 2026-09-28) |

- **Cost:** the load balancer forwarding rule and Cloud CDN bill monthly even with no traffic.
- **HTTPS only:** port 80 is not served.

## GitHub repository settings

- **Repository variables:** `WIF_PROVIDER`, `CDN_DEPLOY_SA`, `GCP_PROJECT_ID`, `CDN_BUCKET`, `CDN_BASE_URL`, all set. Secret: `SONAR_TOKEN`, set.
- **`cdn-production` environment:** deployments only from `main`. It has **no required reviewer**, because the organisation's GitHub plan does not offer required reviewers on private repos. Anyone who can merge to `main`, or dispatch the workflow on `main`, can deploy the CDN.
- **Allow GitHub Actions to create and approve pull requests:** on, both at the organisation level and on this repo. The Version Packages PR needs it.
- **Dependabot:**
  - minor and patch updates are grouped;
  - each major gets its own PR;
  - **TypeScript 7 is ignored** until typescript-eslint supports it. typescript-eslint 8.x and tsup's declaration build still need TypeScript 6's compiler API. When support lands, remove the ignore rule and upgrade in one PR.

## Open items

- **First-event cookie race:** on the landing page, `_fbp` / `_ttp` may not exist yet. It needs a spike on a real site with live pixels ([ARCHITECTURE.md](ARCHITECTURE.md)).
- **Server-side destinations** (a separate repo) must accept GA4 names and `items[]`, and normalise phone numbers, before conversions from this SDK map fully. Tracked as issues #12 and #13 in the destinations repository.
- **Deduplication:** the server-side destinations use the event's `messageId` as the event id, so pixels must be given the `messageId` from `track()`'s result (verified live on 2026-09-28 across 7 platforms). `properties.sfere_dedup_id` is not read server-side.
- **Bundle size** is 45.6 KB gzip against a 49.5 KB budget. About 40 KB minified of analytics-next code can never run with our inline settings. Trimming it would mean stubbing modules, which the "use analytics-next unmodified" decision rules out for now.

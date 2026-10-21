# Operations: what is live and how to run it

_Internal maintainer runbook. "What is live" last updated 2026-10-21. Start here if you are taking over this repo._

## What is live

| Thing | Where | State |
|---|---|---|
| npm packages, public registry | `@sfere-io/sfere-sdk` and `@sfere-io/sfere-node` on registry.npmjs.org, public, no token to install | starts with the next release (`sfere-sdk` 0.4.2, `sfere-node` 0.2.2). Needs the `sfere-io` npm organisation and the `NPM_TOKEN` secret ([RELEASING.md](RELEASING.md#publishing-to-the-public-npm-registry)) |
| npm packages, GitHub Packages | the same two packages on npm.pkg.github.com, a mirror for maintainers (installing from it needs a token with `read:packages`, even though the repo is public) | `sfere-sdk` **0.4.1**, `sfere-node` **0.2.1** |
| Git tags + GitHub releases | `v0.4.1` (Browser SDK, with `sfere.min.js`, `sfere.js` and `manifest.json` attached), `react-v0.4.1`, `@sfere-io/sfere-node@0.2.1` | done |
| CDN, immutable | `https://cdn.sfere.io/sdk/v0.4.1/sfere.min.js` (one path per released version, `v0.4.X`) | live, `Cache-Control: public, max-age=31536000, immutable` |
| CDN, alias | `https://cdn.sfere.io/sdk/v0.4/sfere.min.js` (latest 0.4.x) | live, `Cache-Control: public, max-age=300, stale-while-revalidate=86400` |
| CDN, latest | `https://cdn.sfere.io/sdk/latest/sfere.min.js` | newest stable release across all lines; for embeds nobody can edit. Same caching as an alias ([CDN-POLICY.md](CDN-POLICY.md#the-latest-channel-embeds-you-can-never-edit)) |
| Event ingestion | `https://events.sfere.io` | production host |
| SonarQube Cloud | project `fanfinity_sfere-sdk` (org `sfere-io`) | quality gate passing on `main` |

**Verified end to end on 2026-09-28:**
- A page loaded the SDK from `cdn.sfere.io`, and a staging ingestion endpoint answered `{"ok":true}` for page, identify and track.
- The events carried `context.clientIds`, `context.campaign` and the Sfere `context.library`.
- No request went to any third-party host.

Use a production write key from the Sfere console, with the host `https://events.sfere.io`, when onboarding a site.

## Everyday work

1. **Change code:** branch, then open a PR. CI runs typecheck, lint, unit tests, e2e, size, verify and Sonar.
2. **Anything user-facing needs a changeset:** `npm run changeset` (patch / minor / major plus a one-line summary).
3. **Merge to `main`:** `release.yml` opens or updates the **"chore: version packages"** PR.
4. **Merge that PR to ship.** This one merge publishes to GitHub Packages and the public npm registry, tags each package, creates the Browser, React and Node GitHub releases for what shipped, and deploys the CDN. Details: [RELEASING.md](RELEASING.md).

### Manual CDN deploy or rollback

```sh
# re-deploy a released version (the input is the bare version: 0.4.1, not v0.4.1)
gh workflow run cdn-deploy.yml -R sfere-io/sfere-js-sdk --ref main -f version=0.4.1

# roll the alias back to a known-good version (never touches immutable files)
gh workflow run cdn-deploy.yml -R sfere-io/sfere-js-sdk --ref main -f version=0.4.1 -f alias_only=true
```

A full deploy of an already-deployed version fails by design: immutable files are write-once. Use `alias_only=true` for rollbacks.

`/sdk/latest/` follows on its own: forward on every newer stable release, and back on a rollback while it is on that line. To roll it back across lines (a bad new minor or major), add `-f force_latest=true`:

```sh
gh workflow run cdn-deploy.yml -R sfere-io/sfere-js-sdk --ref main -f version=0.3.2 -f alias_only=true -f force_latest=true
```

### Before the second release of a new minor line (0.2.x, 0.3.x, …)

The deploy account may overwrite only the alias folders it was provisioned for. Since 2026-09-29 that is `sdk/v0.1/` to `sdk/v0.4/` (provisioned ahead, after the 0.3.1 alias move failed on this). The first `0.2.0` release creates `sdk/v0.2/` without trouble. **Before `0.2.1`**, run:

```sh
CDN_ALIASES="v0.1 v0.2 v0.3 v0.4 v0.5" infra/cdn/provision.sh   # add the new line to the full list
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
| GitHub → GCP sign-in | WIF pool `github-pool` / provider `github-provider`. The provider only accepts repos owned by the Sfere org, keyed on the org's numeric id (`repository_owner_id == 194491647`), and the SA is bound to this repo's numeric id, so renaming the org or repo does not break the sign-in |

- **Cost:** the load balancer forwarding rule and Cloud CDN bill monthly even with no traffic.
- **HTTPS only:** port 80 is not served.

## GitHub repository settings

- **Repository variables:** `WIF_PROVIDER`, `CDN_DEPLOY_SA`, `GCP_PROJECT_ID`, `CDN_BUCKET`, `CDN_BASE_URL`, all set. Secrets: `SONAR_TOKEN`, set; `NPM_TOKEN` (publishing to registry.npmjs.org), required before the next release, see [RELEASING.md](RELEASING.md#publishing-to-the-public-npm-registry).
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

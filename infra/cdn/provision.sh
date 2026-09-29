#!/usr/bin/env bash
# One-time (and idempotent re-run-safe) provisioning for the Sfere SDK CDN:
# a public-read GCS bucket, a backend bucket with Cloud CDN, an HTTPS load
# balancer with a Google-managed cert for cdn.sfere.io, a static IP, and a
# WIF-bound deploy service account scoped to that one bucket.
#
# NOT run automatically by CI — this is infra, run by hand by whoever has the
# right IAM in koratona-9791a. See README.md in this directory for the full
# design rationale (in particular "Immutability without delete permission").
#
# Usage: infra/cdn/provision.sh [--dry-run]
#   --dry-run   print every gcloud command instead of running it (this is the
#               tested path — see the report for the transcript; nothing here
#               was actually created against the real project).
#
# Idempotent: every create step tolerates "already exists" and moves on, so
# re-running after a partial failure (or to pick up a config.json change to
# cors.json/lifecycle.json) is safe.
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) echo "Usage: $0 [--dry-run]"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# --- Fixed identifiers for this project. Override via env if you're standing up
# a second environment (e.g. a staging CDN bucket) from a copy of this script. ---
PROJECT="${PROJECT:-koratona-9791a}"
PROJECT_NUMBER="${PROJECT_NUMBER:-728485491932}" # see backend/README.md "One-time GCP setup"
REGION="${REGION:-me-central2}" # Dammam; confirmed with `gcloud compute regions list --filter=name~me-central`
BUCKET="${CDN_BUCKET:-sfere-sdk-cdn}"
BACKEND_BUCKET="${BACKEND_BUCKET:-sfere-sdk-cdn-backend}"
IP_NAME="${IP_NAME:-sfere-sdk-cdn-ip}"
CERT_NAME="${CERT_NAME:-sfere-sdk-cdn-cert}"
URL_MAP="${URL_MAP:-sfere-sdk-cdn-lb}"
HTTPS_PROXY="${HTTPS_PROXY:-sfere-sdk-cdn-https-proxy}"
FORWARDING_RULE="${FORWARDING_RULE:-sfere-sdk-cdn-https}"
DOMAIN="${DOMAIN:-cdn.sfere.io}"

# Reuse the shared GitHub Actions WIF pool/provider that backend/README.md
# documents as already existing in this project — do not create a second one.
WIF_POOL="${WIF_POOL:-github-pool}"
WIF_PROVIDER="${WIF_PROVIDER:-github-provider}"
DEPLOY_SA_ID="${DEPLOY_SA_ID:-sfere-sdk-cdn-deploy}"
DEPLOY_SA="${DEPLOY_SA_ID}@${PROJECT}.iam.gserviceaccount.com"
GITHUB_REPO="${GITHUB_REPO:-fanfinity/sfere-sdk}"

CUSTOM_ROLE_ID="${CUSTOM_ROLE_ID:-sfereSdkCdnPublicReader}"
ALIAS_ROLE_ID="${ALIAS_ROLE_ID:-sfereSdkCdnAliasOverwriter}"
INVALIDATE_ROLE_ID="${INVALIDATE_ROLE_ID:-sfereSdkCdnInvalidator}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Alias lines the deploy SA may overwrite, space-separated (e.g. "v0.1 v0.2 v1").
# Overwriting an existing GCS object needs storage.objects.delete even with
# versioning on, so the SA gets delete ONLY on these prefixes, via an IAM
# Condition. Cloud Storage conditions on object names support startsWith() /
# endsWith() / extract() / == / != and no regex, so the alias prefixes are
# enumerated rather than pattern-matched. Default: the alias line of the version
# in ../../packages/browser/package.json (v0.<minor> while 0.x, v<major> from 1.0.0). A NEW alias
# line (new minor while 0.x, new major after) must be added here and the script
# re-run before the SECOND release on that line — the first release only
# creates the alias objects, which objectCreator already allows. See README.md
# "Alias overwrite: delete permission, scoped by IAM Condition".
if [ -z "${CDN_ALIASES:-}" ]; then
  PKG_VERSION="$(sed -nE 's/^ *"version": *"([^"]+)".*/\1/p' "${SCRIPT_DIR}/../../packages/browser/package.json" | head -n1)"
  PKG_MAJOR="${PKG_VERSION%%.*}"
  PKG_REST="${PKG_VERSION#*.}"
  PKG_MINOR="${PKG_REST%%.*}"
  if [ "${PKG_MAJOR:-0}" -ge 1 ] 2>/dev/null; then
    CDN_ALIASES="v${PKG_MAJOR}"
  else
    CDN_ALIASES="v0.${PKG_MINOR}"
  fi
fi
for alias in $CDN_ALIASES; do
  case "$alias" in
    v[0-9]|v[0-9][0-9]|v0.[0-9]|v0.[0-9][0-9]) : ;;
    *) echo "CDN_ALIASES entry '$alias' is not an alias segment (expected v<major> or v0.<minor>)" >&2; exit 1 ;;
  esac
done

echo "Project: $PROJECT   Region: $REGION   Bucket: gs://$BUCKET   Alias lines: $CDN_ALIASES"
[ "$DRY_RUN" -eq 1 ] && echo "(--dry-run: no gcloud command below actually runs)"
echo

# run_idempotent CMD...
#   --dry-run: print the command, do nothing.
#   otherwise: run it; a failure whose output looks like "already exists" (or
#   HTTP 409) is treated as success, since every step here is a create.
run_idempotent() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  local out status attempt
  # A custom role created a moment ago is not yet visible to bucket IAM
  # ("does not exist in the resource's hierarchy"); retry for up to ~2 min.
  for attempt in $(seq 1 12); do
    set +e
    out="$("$@" 2>&1)"
    status=$?
    set -e
    if [ "$status" -ne 0 ] && echo "$out" | grep -q "does not exist in the resource's hierarchy"; then
      echo "  (custom role not propagated yet, retry ${attempt}/12)"
      sleep 10
      continue
    fi
    break
  done
  if [ "$status" -eq 0 ]; then
    [ -n "$out" ] && echo "$out"
    return 0
  fi
  if echo "$out" | grep -qiE 'already exists|alreadyexists|HTTPError 409|409 Conflict'; then
    echo "  (already exists, skipping)"
    return 0
  fi
  echo "$out" >&2
  return "$status"
}

# ---------------------------------------------------------------------------
# 1. The bucket: uniform bucket-level access, versioning on, public GET-only via
#    a custom role (never the predefined roles/storage.objectViewer — see
#    README.md, that role also grants storage.objects.list, i.e. directory
#    listing, which the brief for this bucket explicitly excludes).
# ---------------------------------------------------------------------------
echo "--- GCS bucket ---"
run_idempotent gcloud storage buckets create "gs://${BUCKET}" \
  --project="$PROJECT" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --no-public-access-prevention \
  --default-storage-class=standard

run_idempotent gcloud storage buckets update "gs://${BUCKET}" \
  --project="$PROJECT" \
  --versioning

run_idempotent gcloud storage buckets update "gs://${BUCKET}" \
  --project="$PROJECT" \
  --lifecycle-file="${SCRIPT_DIR}/lifecycle.json"

run_idempotent gcloud storage buckets update "gs://${BUCKET}" \
  --project="$PROJECT" \
  --cors-file="${SCRIPT_DIR}/cors.json"

echo
echo "--- Custom role: object GET without LIST ---"
# roles/storage.objectViewer includes storage.objects.list, which would let
# anyone enumerate every published version. This custom role has only the one
# permission the public actually needs.
run_idempotent gcloud iam roles create "$CUSTOM_ROLE_ID" \
  --project="$PROJECT" \
  --title="Sfere SDK CDN public reader" \
  --description="GET-only public read for the sfere-sdk CDN bucket; deliberately excludes storage.objects.list so the bucket cannot be enumerated." \
  --permissions=storage.objects.get \
  --stage=GA

# `--condition=None` on the unconditional bindings: once the policy holds the conditional alias
# binding below, gcloud refuses (non-interactively) to add a binding without an explicit
# condition, which broke every re-run after the first.
run_idempotent gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member=allUsers \
  --role="projects/${PROJECT}/roles/${CUSTOM_ROLE_ID}" \
  --condition=None

echo
echo "--- Deploy service account ---"
run_idempotent gcloud iam service-accounts create "$DEPLOY_SA_ID" \
  --project="$PROJECT" \
  --display-name="sfere-sdk CDN deploy (WIF, GitHub Actions)"

# Bucket-wide: create + read only. objectCreator can create objects at names
# that do not exist yet; it can NOT overwrite an existing object — GCS requires
# storage.objects.delete for that, even with object versioning on. So on the
# immutable paths the SA is stopped twice: by IAM (no delete) and by the
# --if-generation-match=0 precondition cdn-publish.sh sends. objectViewer (get)
# lets the deploy workflow read back what it uploaded, and is scoped to this
# bucket only — it is not the public grant above, so its .list permission is
# harmless (only this SA can use it, not the public).
run_idempotent gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/storage.objectCreator \
  --condition=None

run_idempotent gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/storage.objectViewer \
  --condition=None

echo
echo "--- Alias overwrite: delete permission scoped to the alias prefixes ---"
# The alias paths (/sdk/v0.<minor>/, /sdk/v<major>/) are the only objects that
# are ever re-pointed, so they are the only objects the SA may delete/overwrite.
# A custom role with the single permission storage.objects.delete, bound with
# an IAM Condition that ORs one startsWith() per alias prefix. Uniform
# bucket-level access (set at bucket creation) is required for conditions.
# Note the trailing "/": "objects/sdk/v0.1/" matches sdk/v0.1/sfere.min.js and
# not sdk/v0.1.0/sfere.min.js, whose name continues with ".0/".
run_idempotent gcloud iam roles create "$ALIAS_ROLE_ID" \
  --project="$PROJECT" \
  --title="Sfere SDK CDN alias overwriter" \
  --description="storage.objects.delete only; bound to the deploy SA with an IAM Condition limiting it to the mutable alias prefixes under sdk/." \
  --permissions=storage.objects.delete \
  --stage=GA

ALIAS_CONDITION=""
for alias in $CDN_ALIASES; do
  clause="resource.name.startsWith(\"projects/_/buckets/${BUCKET}/objects/sdk/${alias}/\")"
  ALIAS_CONDITION="${ALIAS_CONDITION:+${ALIAS_CONDITION} || }${clause}"
done
# --condition takes key=value pairs separated by commas; the expression contains
# none (quotes, parentheses and || only), so it can be passed inline. Re-running
# with a longer CDN_ALIASES adds a second, broader binding; the earlier narrower
# one is a subset and harmless (remove it with remove-iam-policy-binding
# --condition=... --all if you want a tidy policy).
run_idempotent gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="projects/${PROJECT}/roles/${ALIAS_ROLE_ID}" \
  --condition="expression=${ALIAS_CONDITION},title=sfere-sdk-cdn-alias-overwrite,description=Overwrite (delete) allowed only under the mutable alias prefixes"

# Let sfere-sdk's GitHub Actions (and only sfere-sdk's) impersonate this SA via
# the pool backend/README.md already stands up for the same project.
run_idempotent gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --project="$PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}"

echo
echo "--- CDN cache invalidation: the SDK URL map only ---"
# After an alias moves, cdn-deploy.yml invalidates /sdk/<alias>/* so the edge serves the new
# version at once (without it, serve-while-stale kept the old alias ~8 minutes on the 0.3.2
# deploy). Invalidation is only a cache purge: it cannot change content or routing. The role holds
# the two permissions `gcloud compute url-maps invalidate-cdn-cache --async` needs, and the
# binding's condition limits it to this one URL map, not every load balancer in the project.
run_idempotent gcloud iam roles create "$INVALIDATE_ROLE_ID" \
  --project="$PROJECT" \
  --title="Sfere SDK CDN cache invalidator" \
  --description="compute.urlMaps.invalidateCache + get; bound to the deploy SA with a condition on the SDK CDN URL map." \
  --permissions=compute.urlMaps.invalidateCache,compute.urlMaps.get \
  --stage=GA

run_idempotent gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="projects/${PROJECT}/roles/${INVALIDATE_ROLE_ID}" \
  --condition="expression=resource.name == \"projects/${PROJECT}/global/urlMaps/${URL_MAP}\",title=sfere-sdk-cdn-invalidate,description=Cache invalidation on the SDK CDN URL map only"

echo
echo "--- Backend bucket + Cloud CDN ---"
run_idempotent gcloud compute backend-buckets create "$BACKEND_BUCKET" \
  --project="$PROJECT" \
  --gcs-bucket-name="$BUCKET" \
  --enable-cdn \
  --cache-mode=USE_ORIGIN_HEADERS \
  --compression-mode=AUTOMATIC \
  --negative-caching \
  --negative-caching-policy=404=30

echo
echo "--- HTTPS load balancer for ${DOMAIN} ---"
run_idempotent gcloud compute addresses create "$IP_NAME" \
  --project="$PROJECT" \
  --global \
  --ip-version=IPV4

run_idempotent gcloud compute ssl-certificates create "$CERT_NAME" \
  --project="$PROJECT" \
  --global \
  --domains="$DOMAIN"

run_idempotent gcloud compute url-maps create "$URL_MAP" \
  --project="$PROJECT" \
  --default-backend-bucket="$BACKEND_BUCKET"

run_idempotent gcloud compute target-https-proxies create "$HTTPS_PROXY" \
  --project="$PROJECT" \
  --global \
  --url-map="$URL_MAP" \
  --global-ssl-certificates \
  --ssl-certificates="$CERT_NAME"

run_idempotent gcloud compute forwarding-rules create "$FORWARDING_RULE" \
  --project="$PROJECT" \
  --global \
  --address="$IP_NAME" \
  --global-address \
  --target-https-proxy="$HTTPS_PROXY" \
  --global-target-https-proxy \
  --ports=443

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run complete. Nothing was created."
else
  IP="$(gcloud compute addresses describe "$IP_NAME" --project="$PROJECT" --global --format='value(address)' 2>/dev/null || echo '<see gcloud compute addresses describe>')"
  echo "Provisioning complete."
  echo
  echo "Alias lines the deploy SA may overwrite: ${CDN_ALIASES}"
  echo "When a new alias line starts (new minor while 0.x, new major after 1.0),"
  echo "re-run before the second release on that line, e.g.:"
  # Suggest the line after the highest one provisioned (v0.<n> -> v0.<n+1>, v<n> -> v<n+1>).
  LAST_ALIAS="$(printf '%s\n' $CDN_ALIASES | sort -V | tail -n1)"
  case "$LAST_ALIAS" in
    v0.*) NEXT_ALIAS="v0.$(( ${LAST_ALIAS#v0.} + 1 ))" ;;
    *) NEXT_ALIAS="v$(( ${LAST_ALIAS#v} + 1 ))" ;;
  esac
  echo "  CDN_ALIASES=\"${CDN_ALIASES} ${NEXT_ALIAS}\" $0"
  echo
  echo "DNS — create this record (cdn.sfere.io does not resolve today):"
  echo "  A   ${DOMAIN}   ->   ${IP}"
  echo
  echo "The Google-managed certificate for ${DOMAIN} only issues once that A"
  echo "record resolves; until then the LB serves a default/self-signed cert."
  echo
  echo "Repository variables to set on fanfinity/sfere-sdk (Settings > Secrets"
  echo "and variables > Actions > Variables), and on the cdn-production"
  echo "Environment's required reviewer list:"
  echo "  WIF_PROVIDER   = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
  echo "  CDN_DEPLOY_SA  = ${DEPLOY_SA}"
  echo "  GCP_PROJECT_ID = ${PROJECT}"
  echo "  CDN_BUCKET     = ${BUCKET}"
  echo "  CDN_BASE_URL   = https://${DOMAIN}"
fi

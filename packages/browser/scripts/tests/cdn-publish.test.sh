#!/usr/bin/env bash
# Regression tests for the sdk/latest/ decision table in ../cdn-publish.sh.
#
#   bash packages/browser/scripts/tests/cdn-publish.test.sh
#
# Self-contained: it generates a fake `gcloud` in a temp dir and refuses to run
# unless that fake — and only that fake — resolves on PATH. Keep that guard: a
# non-executable fake in an earlier version of this harness let the real gcloud
# through and wrote test files into the live bucket.
#
# The fake covers the not-found wording both ways on purpose. The 2026-10-05
# deploy (run 37306716322) failed because current gcloud says "The following
# URLs matched no objects or files", which the script's narrower pattern missed.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH="${CDN_PUBLISH_SCRIPT:-$SCRIPT_DIR/../cdn-publish.sh}"
[ -f "$PUBLISH" ] || { echo "no cdn-publish.sh at $PUBLISH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKEBIN="$WORK/bin"
LOG="$WORK/gcloud.log"
OUT="$WORK/out.log"
GITHUB_OUTPUT_FILE="$WORK/github-output.log"
DIST="$WORK/dist"

mkdir -p "$FAKEBIN" "$DIST"
for f in sfere.min.js sfere.js manifest.json; do echo "// fake $f" > "$DIST/$f"; done

# --- the fake, and the guard that it is the gcloud that will run -------------
cat > "$FAKEBIN/gcloud" <<'FAKE'
#!/usr/bin/env bash
# Test double for gcloud. `storage cat` behavior comes from FAKE_GCAT_BEHAVIOR:
#   missing        the message current gcloud prints when the object is absent
#   missing-legacy the "No URLs matched" wording older gcloud printed
#   version:<v>    a sdk/latest/manifest.json serving <v>
#   denied         a 403 (a read failure: the publish must stop, not guess)
echo "GCLOUD $*" >> "${FAKE_GLOG:?}"
if [ "${1:-}" = "storage" ] && [ "${2:-}" = "cat" ]; then
  case "${FAKE_GCAT_BEHAVIOR:?set per scenario}" in
    missing)
      echo "ERROR: (gcloud.storage.cat) The following URLs matched no objects or files:" >&2
      echo "${3:-}" >&2
      exit 1 ;;
    missing-legacy)
      echo "ERROR: (gcloud.storage.cat) No URLs matched." >&2
      exit 1 ;;
    version:*)
      printf '{\n  "version": "%s",\n  "files": []\n}\n' "${FAKE_GCAT_BEHAVIOR#version:}"
      exit 0 ;;
    denied)
      echo "ERROR: (gcloud.storage.cat) 403 access denied: Permission 'storage.objects.get' denied." >&2
      exit 1 ;;
    *) echo "fake gcloud: unknown FAKE_GCAT_BEHAVIOR=$FAKE_GCAT_BEHAVIOR" >&2; exit 2 ;;
  esac
fi
exit 0
FAKE
chmod +x "$FAKEBIN/gcloud"

export PATH="$FAKEBIN:$PATH"
RESOLVED="$(command -v gcloud || true)"
if [ "$RESOLVED" != "$FAKEBIN/gcloud" ]; then
  echo "SAFETY: refusing to run: gcloud resolves to '$RESOLVED', not the test fake." >&2
  exit 1
fi

# --- harness ----------------------------------------------------------------
FAILS=0
PASSES=0

pass() { echo "  PASS $1"; PASSES=$((PASSES + 1)); }
fail() { echo "  FAIL $1"; FAILS=$((FAILS + 1)); }

file_matches()   { grep -qE "$2" "$1"; }
uploads_to()     { grep ' storage cp ' "$LOG" | grep -q "$1"; }
upload_count()   { grep ' storage cp ' "$LOG" | grep -c "$1"; }
cat_calls()      { grep -c ' storage cat ' "$LOG"; }

# run_case <name> <cat-behavior> <CDN_LATEST_CURRENT or -> <publish args...>
run_case() {
  local name="$1" behavior="$2" current="$3"
  shift 3
  export FAKE_GCAT_BEHAVIOR="$behavior" FAKE_GLOG="$LOG"
  : > "$LOG"; : > "$OUT"; : > "$GITHUB_OUTPUT_FILE"
  echo "=== $name ==="
  (
    cd "$WORK"
    [ "$current" = "-" ] || export CDN_LATEST_CURRENT="$current"
    CDN_BUCKET=test-bucket GITHUB_OUTPUT="$GITHUB_OUTPUT_FILE" bash "$PUBLISH" "$@" --dist "$DIST"
  ) > "$OUT" 2>&1
  CASE_EXIT=$?
  echo "exit=$CASE_EXIT  github-output: $(tr '\n' ' ' < "$GITHUB_OUTPUT_FILE")"
}

expect_exit_ok()   { if [ "$1" -eq 0 ]; then pass "$2"; else fail "$2 (exit $1)"; fi; }
expect_exit_fail() { if [ "$1" -ne 0 ]; then pass "$2"; else fail "$2 (exited 0)"; fi; }

# --- scenarios --------------------------------------------------------------

# 1. No latest yet. This exact wording is what the 2026-10-05 run tripped on.
run_case first-publish-missing missing - 0.3.2 --alias-only
expect_exit_ok "$CASE_EXIT" "first-publish-missing exits 0"
if uploads_to 'sdk/v0.3/'; then pass "creates the line alias"; else fail "creates the line alias"; fi
if uploads_to 'sdk/latest/'; then pass "creates sdk/latest/"; else fail "creates sdk/latest/"; fi
if file_matches "$GITHUB_OUTPUT_FILE" 'latest_moved=true'; then pass "latest_moved=true"; else fail "latest_moved=true"; fi

# 2. Same, with the wording older gcloud printed.
run_case first-publish-legacy-message missing-legacy - 0.3.2 --alias-only
if uploads_to 'sdk/latest/'; then pass "legacy not-found wording also recognized"; else fail "legacy not-found wording also recognized"; fi

# 3. A read failure must stop the publish before anything is uploaded.
run_case read-denied denied - 0.3.2 --alias-only
expect_exit_fail "$CASE_EXIT" "read-denied exits non-zero"
if [ "$(grep -c ' storage cp ' "$LOG")" -eq 0 ]; then pass "no upload after a failed read"; else fail "no upload after a failed read"; fi
if file_matches "$OUT" 'could not read'; then pass "explains the failed read"; else fail "explains the failed read"; fi

# 4. Rollback on latest's own line moves it back.
run_case same-line-rollback version:0.3.3 - 0.3.2 --alias-only
if uploads_to 'sdk/latest/'; then pass "rollback on its own line moves latest"; else fail "rollback on its own line moves latest"; fi

# 5. Rollback across lines does not, without --latest.
run_case cross-line-rollback version:0.4.0 - 0.3.2 --alias-only
if ! uploads_to 'sdk/latest/'; then pass "cross-line rollback leaves latest alone"; else fail "cross-line rollback leaves latest alone"; fi
if file_matches "$GITHUB_OUTPUT_FILE" 'latest_moved=false'; then pass "latest_moved=false"; else fail "latest_moved=false"; fi

# 6. ...and --latest forces it.
run_case cross-line-rollback-forced version:0.4.0 - 0.3.2 --alias-only --latest
if uploads_to 'sdk/latest/'; then pass "--latest forces the move"; else fail "--latest forces the move"; fi

# 7. A patch to an older line after a newer line shipped never drags latest back.
run_case older-line-patch version:0.4.0 - 0.3.4
if ! uploads_to 'sdk/latest/'; then pass "older-line patch leaves latest alone"; else fail "older-line patch leaves latest alone"; fi

# 8. Version ordering: 0.10.0 is newer than 0.9.0, and 1.0.0 is newer than 0.9.0.
run_case minor-ordering version:0.9.0 - 0.10.0 --alias-only
if uploads_to 'sdk/latest/'; then pass "0.10.0 >= 0.9.0"; else fail "0.10.0 >= 0.9.0"; fi
run_case major-ordering version:0.9.0 - 1.0.0 --alias-only
if uploads_to 'sdk/latest/'; then pass "1.0.0 >= 0.9.0"; else fail "1.0.0 >= 0.9.0"; fi

# 9. Prereleases never touch the alias or latest, only the immutable path.
run_case prerelease version:0.3.2 - 0.3.3-next.0
if ! uploads_to 'sdk/latest/' && ! uploads_to 'sdk/v0.3/'; then pass "prerelease touches neither alias nor latest"; else fail "prerelease touches neither alias nor latest"; fi
if uploads_to 'sdk/v0.3.3-next.0/'; then pass "prerelease still publishes immutably"; else fail "prerelease still publishes immutably"; fi

# 10. CDN_LATEST_CURRENT short-circuits the bucket read (the dry-run escape hatch).
run_case latest-current-env version:0.4.0 0.4.0 0.3.2 --alias-only
if [ "$(cat_calls)" -eq 0 ]; then pass "CDN_LATEST_CURRENT skips the read"; else fail "CDN_LATEST_CURRENT skips the read"; fi
if ! uploads_to 'sdk/latest/'; then pass "and applies the same rules"; else fail "and applies the same rules"; fi

echo
echo "passed=$PASSES failed=$FAILS"
[ "$FAILS" -eq 0 ]

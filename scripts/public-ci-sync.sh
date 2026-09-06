#!/usr/bin/env bash
# =============================================================================
# public-ci-sync.sh — deterministic PRIVATE -> PUBLIC CI mirror sync
# Source of truth: 7clan/medivault (PRIVATE)  branch: platform/macos
# Mirror target:   7clan/medivault-ci-public (PUBLIC, history-free snapshots)
#
# CONTRACT (acceptance/public-ci-mirror-contract.md):
#   1. require clean private worktree          (P1)
#   2. capture exact private SHA               (P1, must match origin)
#   3. export ONLY allowlisted content         (P2 git archive = tracked tree)
#   4. remove disallowed files                 (P4, after P3 audit)
#   5. run secret scan                         (P5, gitleaks, fail-closed)
#   6. run PHI/PII safety checks               (P6, fail-closed)
#   7. verify no .git / private history        (P7 + root-commit proofs)
#   8. update traceability metadata            (P8 .public-ci-source.json)
#   9. initialize/update public mirror tree    (P9-P10: fresh init OR clone+replace)
#  10. commit the snapshot                     (P10, "ci-mirror: source <SHA>")
#  11. push public repo                        (P11)
#  12. optionally dispatch requested CI mode   (P13, $1)
#  +x. apply public GitHub security settings   (P12: secret scanning, push
#      protection, dependabot, actions allowlist, workflow READ default,
#      branch protection: no force-push, no deletion)
#
# TOKEN MODEL (two credentials, least privilege):
#   PUBLIC  token (TOKEN_FILE, default /tmp/.gh_pat):        public mirror only —
#     contents R/W, actions, workflows, administration. Used for ALL public
#     operations: clone/push/ls-remote + every GitHub API call.
#   PRIVATE token (PRIVATE_TOKEN_FILE, /tmp/.gh_pat_private):  7clan/medivault
#     only — CONTENTS READ ONLY. Used exclusively for the P1 origin fetch
#     (HEAD == origin proof). It is never used for any write, never passed to
#     the public side, and never present in any artifact, log, or URL.
#   If PRIVATE_TOKEN_FILE is absent, P1 falls back to the public token (single
#   token mode) — which simply fails closed if it cannot read the private repo.
#
# MIRROR TOOLING OVERLAY (P4b):
#   The private credential is READ ONLY, so the mirror tooling (proof workflow,
#   this script, gitleaks config, contract) cannot be committed to the private
#   repo first. Instead the sync injects these files into the export from the
#   staging directory AFTER exclusion removal (P4) and BEFORE the scans (P5+),
#   refusing to overwrite any path already present in the export. The overlay
#   only ever ADDS mirror-infrastructure files; the private content itself is
#   untouched. Traceability (.public-ci-source.json) still records the exact
#   private source SHA.
## OFFLINE SELF-TEST: MV_SYNC_OFFLINE_TEST=1 ./public-ci-sync.sh
#   Runs P1(phase-a)-P8 only, against a local repo with no origin; used to
#   validate the safety pipeline without touching GitHub.
# =============================================================================
set -euo pipefail

# ------------------------------- configuration -------------------------------
PRIVATE_REPO_DIR="${MV_PRIVATE_REPO:-/home/z/medivault-macos}"
PRIVATE_BRANCH="${MV_PRIVATE_BRANCH:-platform/macos}"
PUBLIC_SLUG="${MV_PUBLIC_REPO:-7clan/medivault-ci-public}"
PUBLIC_BRANCH="${MV_PUBLIC_BRANCH:-main}"
PUBLIC_DESC="MediVault public CI mirror: history-free sanitized snapshots of the private canonical repo (CI infrastructure only, not source of truth)"
TOKEN_FILE="${MV_GH_TOKEN_FILE:-/tmp/.gh_pat}"
PRIVATE_TOKEN_FILE="${MV_PRIVATE_TOKEN_FILE:-/tmp/.gh_pat_private}"
GITLEAKS_BIN="${GITLEAKS_BIN:-gitleaks}"
OFFLINE="${MV_SYNC_OFFLINE_TEST:-0}"
DISPATCH_MODE="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GITLEAKS_CONFIG="$SCRIPT_DIR/gitleaks-mirror.toml"
TOOLING_DIR="${MV_MIRROR_TOOLING_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
[ -x "$GITLEAKS_BIN" ] || GITLEAKS_BIN="$(command -v gitleaks || true)"
[ -n "$GITLEAKS_BIN" ] || { echo "SYNC-FAIL: gitleaks not found (set GITLEAKS_BIN)" >&2; exit 1; }
[ -f "$GITLEAKS_CONFIG" ] || { echo "SYNC-FAIL: missing $GITLEAKS_CONFIG" >&2; exit 1; }

die()  { echo "SYNC-FAIL: $*" >&2; exit 1; }
note() { echo "SYNC:    $*"; }

# temp workspace (all removed on exit; nothing secret is ever printed)
TMP_ROOT="$(mktemp -d /tmp/mv-public-sync.XXXXXX)"
EXPORT_DIR="$TMP_ROOT/export"
RESPONSE_FILE="$TMP_ROOT/api-response.json"
CRED_HELPER="$TMP_ROOT/gh-cred-helper.sh"
PRIVATE_CRED_HELPER="$TMP_ROOT/gh-private-cred-helper.sh"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT
mkdir -p "$EXPORT_DIR"

# git wrapper: authenticated via a runtime credential helper that READS the
# token file only when git asks for credentials. The token value never
# appears in argv, remote URLs, logs, or this file.
setup_cred_helper() {
  cat > "$CRED_HELPER" <<EOF
#!/bin/sh
printf 'username=x-access-token\n'
printf 'password=%s\n' "\$(cat '$TOKEN_FILE')"
EOF
  chmod 700 "$CRED_HELPER"
}
setup_private_cred_helper() { # reads the PRIVATE read-only token; used ONLY for the P1 fetch
  cat > "$PRIVATE_CRED_HELPER" <<EOF
#!/bin/sh
printf 'username=x-access-token\n'
printf 'password=%s\n' "\$(cat '$PRIVATE_CRED_SRC')"
EOF
  chmod 700 "$PRIVATE_CRED_HELPER"
}
gitp() { # public operations
  git -c "credential.helper=!$CRED_HELPER" "$@"
}
gitp_priv() { # private read operations (fetch only)
  git -c "credential.helper=!$PRIVATE_CRED_HELPER" "$@"
}

# github_api METHOD PATH [JSON_BODY] -> sets HTTP_CODE, body in $RESPONSE_FILE
github_api() {
  local method="$1" path="$2" body="${3:-}"
  local tok; tok="$(cat "$TOKEN_FILE")"
  local common=(-sS -X "$method"
    -H "Authorization: Bearer $tok"
    -H "Accept: application/vnd.github+json"
    -H "X-GitHub-Api-Version: 2022-11-28"
    -o "$RESPONSE_FILE" -w '%{http_code}')
  if [ -n "$body" ]; then
    HTTP_CODE="$(curl "${common[@]}" -H "Content-Type: application/json" -d "$body" "https://api.github.com$path")"
  else
    HTTP_CODE="$(curl "${common[@]}" "https://api.github.com$path")"
  fi
}
api_body() { cat "$RESPONSE_FILE" 2>/dev/null || echo ''; }

# ============================== P1: private repo ==============================
note "P1 private repo checks: $PRIVATE_REPO_DIR (branch $PRIVATE_BRANCH)"
[ -d "$PRIVATE_REPO_DIR/.git" ] || die "private repo not found at $PRIVATE_REPO_DIR"
git -C "$PRIVATE_REPO_DIR" rev-parse --verify HEAD >/dev/null 2>&1 || die "private repo has no HEAD"
CUR_BRANCH="$(git -C "$PRIVATE_REPO_DIR" rev-parse --abbrev-ref HEAD)"
[ "$CUR_BRANCH" = "$PRIVATE_BRANCH" ] || die "private repo is on '$CUR_BRANCH', must be on $PRIVATE_BRANCH"
[ -z "$(git -C "$PRIVATE_REPO_DIR" status --porcelain)" ] || die "private worktree is DIRTY — commit/stash first (clean worktree required)"
PRIVATE_SHA="$(git -C "$PRIVATE_REPO_DIR" rev-parse HEAD)"
note "P1 private SHA: $PRIVATE_SHA (worktree clean)"
if [ "$OFFLINE" != "1" ]; then
  [ -f "$TOKEN_FILE" ] && [ -s "$TOKEN_FILE" ] || die "credential file missing/empty: $TOKEN_FILE (deliver per approval spec; never commit it)"
  chmod 600 "$TOKEN_FILE" 2>/dev/null || true
  setup_cred_helper
  if [ -f "$PRIVATE_TOKEN_FILE" ] && [ -s "$PRIVATE_TOKEN_FILE" ]; then
    chmod 600 "$PRIVATE_TOKEN_FILE" 2>/dev/null || true
    PRIVATE_CRED_SRC="$PRIVATE_TOKEN_FILE"
  else
    PRIVATE_CRED_SRC="$TOKEN_FILE" # single-token fallback
  fi
  setup_private_cred_helper
  gitp_priv -C "$PRIVATE_REPO_DIR" fetch origin "$PRIVATE_BRANCH" --quiet \
    || die "cannot fetch origin/$PRIVATE_BRANCH (private token lacks 7clan/medivault read?)"
  REMOTE_SHA="$(git -C "$PRIVATE_REPO_DIR" rev-parse "origin/$PRIVATE_BRANCH")"
  [ "$PRIVATE_SHA" = "$REMOTE_SHA" ] \
    || die "local $PRIVATE_BRANCH HEAD ($PRIVATE_SHA) != origin ($REMOTE_SHA) — push private first, then sync"
  note "P1 local HEAD == origin/$PRIVATE_BRANCH (fetched with the PRIVATE read-only credential)"
fi

# ===================== P2: history-free export of the SHA =====================
note "P2 exporting tracked tree of $PRIVATE_SHA (git archive — no history, no .git, no untracked files)"
git -C "$PRIVATE_REPO_DIR" archive --format=tar "$PRIVATE_SHA" | tar -x -C "$EXPORT_DIR"
EXPORTED_COUNT="$(find "$EXPORT_DIR" -type f | wc -l | tr -d ' ')"
note "P2 exported $EXPORTED_COUNT files"

# =============== P3: publication safety audit (BEFORE removal) ===============
# Anything committed that must NOT ship ALSO requires PRIVATE remediation,
# so it is audited before removal instead of being silently stripped.
note "P3 pre-removal publication safety audit (fail-closed)"
AUDIT_RED=0
audit_report() { # TYPE PATH REMEDIATION
  echo "AUDIT-UNSAFE TYPE=$1 PATH=$2 REMEDIATION=$3"
  AUDIT_RED=1
}
while IFS= read -r -d '' f; do
  audit_report "env-file" "${f#"$EXPORT_DIR"/}" "remove from private repo; move values to CI runtime env (printf recipe); rotate any exposed values"
done < <(find "$EXPORT_DIR" -type f -name '.env*' ! -name '.env.example' -print0)
while IFS= read -r -d '' f; do
  audit_report "key-or-cert" "${f#"$EXPORT_DIR"/}" "remove from private repo and rotate/revoke the material"
done < <(find "$EXPORT_DIR" -type f \( -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' \
  -o -name '*.mobileprovision' -o -name '*.cer' -o -name '*.crt' -o -name '*.keystore' \
  -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name 'known_hosts' \) -print0)
while IFS= read -r -d '' f; do
  audit_report "database-or-dump" "${f#"$EXPORT_DIR"/}" "remove from private repo; verify no PHI in it; use synthetic CI databases only"
done < <(find "$EXPORT_DIR" -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \
  -o -name '*.dump' -o -name '*.bak' -o -name '*.sqlbak' \) -print0)
while IFS= read -r -d '' f; do
  audit_report "sql-outside-migrations" "${f#"$EXPORT_DIR"/}" "SQL outside prisma/migrations is treated as a data dump: remove from private repo or relocate"
done < <(find "$EXPORT_DIR" -type f -name '*.sql' ! -path '*/prisma/migrations/*' -print0)
if [ "$AUDIT_RED" = "1" ]; then
  die "publication audit RED: remediate the PRIVATE repo (paths above, values never printed) before any public snapshot"
fi
note "P3 audit GREEN (no env/keys/certs/database/dump files committed)"

# ==================== P4: remove disallowed (non-shipping) ===================
note "P4 removing disallowed content from the export"
REMOVED_COUNT=0
rm_path() { # relative glob dir/file
  if [ -e "$EXPORT_DIR/$1" ]; then
    rm -rf "${EXPORT_DIR:?}/$1"
    REMOVED_COUNT=$((REMOVED_COUNT + 1))
    echo "  excluded: $1"
  fi
}
rm_path "windows"          # frozen Windows implementation stays private
rm_path ".github/workflows/windows-build.yml"        # Windows CI (frozen lane)
rm_path ".github/workflows/windows-installer-only.yml"
rm_path ".github/workflows/windows-integration.yml"
rm_path ".github/workflows/ps51-parse-investigation.yml" # retired private diagnostic workflow
rm_path "data"             # runtime object storage (patient-shaped blobs never ship, even encrypted)
rm_path "-X"               # empty curl cookie-jar dev artifact (no cookies present; excluded regardless)
rm_path "tsconfig.tsbuildinfo" # build cache artifact
while IFS= read -r -d '' d; do
  rm -rf "$d"; REMOVED_COUNT=$((REMOVED_COUNT + 1)); echo "  excluded: ${d#"$EXPORT_DIR"/}/"
done < <(find "$EXPORT_DIR" -type d \( -name node_modules -o -name target -o -name dist \
  -o -name build -o -name coverage -o -name '.idea' -o -name '.vscode' \
  -o -name '__MACOSX' -o -name '.AppleDouble' -o -name 'tool-results' \
  -o -name 'upload' -o -name 'download' \) -prune -print0 2>/dev/null)
while IFS= read -r -d '' f; do
  rm -f "$f"; REMOVED_COUNT=$((REMOVED_COUNT + 1)); echo "  excluded: ${f#"$EXPORT_DIR"/}"
done < <(find "$EXPORT_DIR" -type f \( -name '*.tsbuildinfo' -o -name '.env*' -o -name '.DS_Store' -o -name '*.log' \
  -o -iname 'worklog*' -o -iname '*worklog*.md' -o -name '*.tmp' -o -name '*.swp' \) -print0 2>/dev/null)
note "P4 removed $REMOVED_COUNT disallowed paths"

# ============ P4b: mirror tooling overlay (see header: read-only private) =====
note "P4b injecting mirror tooling overlay from $TOOLING_DIR (additive only)"
OVERLAY_COUNT=0
overlay_inject() { # tooling-src export-dst
  local src="$1" dst="$EXPORT_DIR/$2"
  [ -f "$src" ] || die "overlay source missing: $src"
  [ -e "$dst" ] && die "overlay collision: $2 already exists in the export — resolve deliberately (commit tooling to the private repo, or rename)"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  OVERLAY_COUNT=$((OVERLAY_COUNT + 1))
  echo "  overlay: $2"
}
overlay_inject "$TOOLING_DIR/.github/workflows/public-mirror-proof.yml" ".github/workflows/public-mirror-proof.yml"
overlay_inject "$SCRIPT_DIR/public-ci-sync.sh" "scripts/public-ci-sync.sh"
overlay_inject "$SCRIPT_DIR/gitleaks-mirror.toml" "scripts/gitleaks-mirror.toml"
overlay_inject "$TOOLING_DIR/acceptance/public-ci-mirror-contract.md" "acceptance/public-ci-mirror-contract.md"
note "P4b injected $OVERLAY_COUNT mirror tooling files (scanned by P5/P6 like all content)"

# ========================= P5: secret scan (gitleaks) =========================
note "P5 secret scan (gitleaks, values never printed)"
run_gitleaks() { # srcdir label
  local src="$1" label="$2"
  local report="$TMP_ROOT/gl-$label.json"
  local code=0
  "$GITLEAKS_BIN" dir "$src" --config "$GITLEAKS_CONFIG" \
    --report-format json --report-path "$report" --redact >/dev/null 2>&1 || code=$?
  [ "$code" -eq 0 ] || {
    echo "SECRET-SCAN-RED ($label): findings below (rule + path + line ONLY, values redacted)"
    jq -r '.[] | "  TYPE=\(.RuleID // .ruleId) PATH=\(.File // .file):\(.StartLine // .startLine)"' "$report" 2>/dev/null \
      || echo "  (no parseable report; rerun locally with the same command)"
    return 1
  }
  echo "SECRET-SCAN-GREEN ($label)"
  return 0
}
run_gitleaks "$PRIVATE_REPO_DIR" private-tree || die "secret scan RED on the private tree — remediate private repo first"
run_gitleaks "$EXPORT_DIR" public-export || die "secret scan RED on the export"

# ============================ P6: PHI/PII checks ==============================
note "P6 PHI/PII safety checks (value patterns; paths only in output)"
PHI_RED=0
phi_flag() { # SEVERITY PATTERN PATH
  echo "PHI-SCAN $1 PATTERN=$2 PATH=${3#"$EXPORT_DIR"/}"
  if [ "$1" = "FAIL" ]; then PHI_RED=1; fi
}
# a) high-signal value patterns in DATA-like files -> hard fail
while IFS= read -r -d '' f; do
  grep -qE '[0-9]{3}-[0-9]{2}-[0-9]{4}' "$f" 2>/dev/null \
    && phi_flag FAIL ssn-shaped-value "$f"
  grep -P '(?<![\w./@-])[a-zA-Z0-9._%+-]+@(?!example\.|test\.|localhost|synthetic\.)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}' "$f" >/dev/null 2>&1 \
    && phi_flag FAIL non-synthetic-email "$f"
  grep -qE '\b[0-9]{16}\b' "$f" 2>/dev/null \
    && phi_flag FAIL card-shaped-value "$f"
done < <(find "$EXPORT_DIR" -type f -size -2M \( -name '*.json' -o -name '*.csv' -o -name '*.sql' \) -print0)
# b) same patterns in source/docs -> WARN (manual verification required)
while IFS= read -r -d '' f; do
  grep -qE '[0-9]{3}-[0-9]{2}-[0-9]{4}' "$f" 2>/dev/null \
    && phi_flag WARN ssn-shaped-value "$f"
  grep -P '(?<![\w./@-])[a-zA-Z0-9._%+-]+@(?!example\.|test\.|localhost|synthetic\.)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}' "$f" >/dev/null 2>&1 \
    && phi_flag WARN non-synthetic-email "$f"
done < <(find "$EXPORT_DIR" -type f -size -2M \( -name '*.md' -o -name '*.txt' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \) -print0)
[ "$PHI_RED" = "0" ] || die "PHI/PII scan RED (data-like files carry value-shaped PII) — remediate private repo"
note "P6 PHI/PII scan GREEN (warnings, if any, listed above for manual verification)"

# ================ P7: verify no private history / refs included ==============
note "P7 history-free verification"
[ ! -e "$EXPORT_DIR/.git" ] || die "export contains .git"
HISTJUNK="$(find "$EXPORT_DIR" \( -name '.git' -o -name '.gitmodules' -o -name '.gitignore-repo' \) -print)"
[ -z "$HISTJUNK" ] || die "export contains git refs: $HISTJUNK"
note "P7 export has no .git, no gitmodules, no private refs (git archive of a single tree)"

# ==================== P8: traceability metadata (no secrets) ==================
note "P8 writing .public-ci-source.json"
printf '{\n  "private_source_sha": "%s",\n  "platform": "macos",\n  "purpose": "public-ci-mirror"\n}\n' \
  "$PRIVATE_SHA" > "$EXPORT_DIR/.public-ci-source.json"
jq -e . "$EXPORT_DIR/.public-ci-source.json" >/dev/null || die "traceability file is not valid JSON"
FINAL_COUNT="$(find "$EXPORT_DIR" -type f | wc -l | tr -d ' ')"
note "P8 final export: $FINAL_COUNT files (traceable to private SHA $PRIVATE_SHA)"

# ------------------------------- offline stop ---------------------------------
if [ "$OFFLINE" = "1" ]; then
  echo "OFFLINE-TEST-GREEN: phases P1-P8 completed against the local repo; GitHub phases skipped"
  exit 0
fi

# ==================== P9: public repo exists / create it ======================
note "P9 public repository: $PUBLIC_SLUG"
github_api GET "/repos/$PUBLIC_SLUG"
if [ "$HTTP_CODE" = "200" ]; then
  [ "$(jq -r '.private' "$RESPONSE_FILE")" = "false" ] \
    || die "$PUBLIC_SLUG exists but is PRIVATE — the mirror must be public"
  note "P9 public repo already exists (idempotent re-sync)"
elif [ "$HTTP_CODE" = "404" ]; then
  OWNER="${PUBLIC_SLUG%%/*}"
  github_api GET "/user"
  [ "$HTTP_CODE" = "200" ] || die "token cannot authenticate (GET /user HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")"
  TOKEN_LOGIN="$(jq -r '.login' "$RESPONSE_FILE")"
  github_api GET "/users/$OWNER"
  [ "$HTTP_CODE" = "200" ] || die "cannot inspect owner $OWNER (HTTP $HTTP_CODE)"
  OWNER_TYPE="$(jq -r '.type' "$RESPONSE_FILE")"
  if [ "$OWNER_TYPE" = "Organization" ]; then
    CREATE_PATH="/orgs/$OWNER/repos"
  elif [ "$TOKEN_LOGIN" = "$OWNER" ]; then
    CREATE_PATH="/user/repos"
  else
    die "token belongs to '$TOKEN_LOGIN' but mirror owner is user '$OWNER' — use a token from the $OWNER account"
  fi
  github_api POST "$CREATE_PATH" \
    "{\"name\":\"${PUBLIC_SLUG#*/}\",\"description\":\"$PUBLIC_DESC\",\"private\":false,\"has_issues\":false,\"has_wiki\":false,\"has_projects\":false}"
  [ "$HTTP_CODE" = "201" ] || die "repo creation failed (HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")"
  note "P9 created PUBLIC repo $PUBLIC_SLUG (via $CREATE_PATH)"
else
  die "unexpected API response for /repos/$PUBLIC_SLUG (HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")"
fi

# ============ P10: public working tree + commit (history-free) ================
note "P10 preparing public working tree"
PUB_WORK="$TMP_ROOT/public-work"
mkdir -p "$PUB_WORK"
PUBLIC_URL="https://github.com/$PUBLIC_SLUG.git"
PUBLIC_ROOT_BEFORE="$(git ls-remote --heads "$PUBLIC_URL" "refs/heads/$PUBLIC_BRANCH" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$PUBLIC_ROOT_BEFORE" = "0" ]; then
  git init -q -b "$PUBLIC_BRANCH" "$PUB_WORK"
  git -C "$PUB_WORK" remote add origin "$PUBLIC_URL"
  FIRST_SNAPSHOT=1
else
  gitp clone -q "$PUBLIC_URL" "$PUB_WORK"
  git -C "$PUB_WORK" checkout -q -B "$PUBLIC_BRANCH" "origin/$PUBLIC_BRANCH"
  # replace the whole tree with the new snapshot (keep only .git)
  find "$PUB_WORK" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
  FIRST_SNAPSHOT=0
fi
cp -R "$EXPORT_DIR/." "$PUB_WORK/"
git -C "$PUB_WORK" add -A
git -C "$PUB_WORK" -c user.name="medivault-ci-mirror" -c user.email="mirror@invalid" \
  commit -q -m "ci-mirror: source $PRIVATE_SHA" \
  || note "P10 no content change since last snapshot — nothing to commit"
if git -C "$PUB_WORK" rev-parse --verify HEAD >/dev/null 2>&1; then
  ROOT_COMMITS="$(git -C "$PUB_WORK" rev-list --max-parents=0 HEAD | wc -l | tr -d ' ')"
  [ "$ROOT_COMMITS" = "1" ] || die "public history must have exactly ONE parentless root commit (found $ROOT_COMMITS)"
  if [ "$FIRST_SNAPSHOT" = "1" ]; then
    if git -C "$PUB_WORK" rev-parse -q --verify 'HEAD^' >/dev/null 2>&1; then
      die "FIRST SNAPSHOT must have NO parents (private history leaked?)"
    fi
    note "P10 first snapshot: root commit $(git -C "$PUB_WORK" rev-parse --short HEAD) has ZERO parents"
  else
    note "P10 snapshot commit: $(git -C "$PUB_WORK" rev-parse --short HEAD) (root-commit invariant held)"
  fi
  [ -z "$(git -C "$PUB_WORK" status --porcelain)" ] || die "public worktree not clean after commit"
fi

# ============================ P11: push public repo ===========================
note "P11 pushing $PUBLIC_BRANCH to $PUBLIC_SLUG"
gitp -C "$PUB_WORK" push -q origin "$PUBLIC_BRANCH" 2>/dev/null \
  || gitp -C "$PUB_WORK" push origin "$PUBLIC_BRANCH" \
  || die "push to public mirror failed (token lacks public repo write?)"
note "P11 push complete"

# ============ P12: public GitHub security settings (idempotent) ==============
note "P12 applying security settings"
github_api PATCH "/repos/$PUBLIC_SLUG" \
  '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"},"dependabot_security_updates":{"status":"enabled"}}}'
case "$HTTP_CODE" in 200|201) note "P12 secret scanning + push protection + dependabot security updates: ON";;
  *) die "security_and_analysis PATCH failed (HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")";; esac
github_api PUT "/repos/$PUBLIC_SLUG/vulnerability-alerts"
[ "$HTTP_CODE" = "204" ] || note "P12 dependabot alerts enable returned HTTP $HTTP_CODE (verify manually)"
github_api PUT "/repos/$PUBLIC_SLUG/actions/permissions" \
  '{"enabled":true,"allowed_actions":"selected"}'
[ "$HTTP_CODE" = "204" ] || die "actions permissions failed (HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")"
ACTIONS_JSON='{"patterns_allowed":[]}'
while IFS= read -r action; do
  ACTIONS_JSON="$(jq -c --arg p "$action@*" '.patterns_allowed += [$p]' <<<"$ACTIONS_JSON")"
done < <(grep -rhoE 'uses:[[:space:]]*[^[:space:]]+' "$EXPORT_DIR/.github" 2>/dev/null \
  | sed -E 's/uses:[[:space:]]*//' | grep -v '^\./' | grep -v '^docker://' | sed 's/@.*//' | sort -u)
[ "$(jq -r '.patterns_allowed | length' <<<"$ACTIONS_JSON")" -gt 0 ] \
  || die "no actions extracted from workflows — refusing to allowlist an empty set"
github_api PUT "/repos/$PUBLIC_SLUG/actions/permissions/actions" "$ACTIONS_JSON"
[ "$HTTP_CODE" = "204" ] || die "actions allowlist failed (HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")"
note "P12 actions allowed (selected): $(jq -r '.patterns_allowed | join(", ")' <<<"$ACTIONS_JSON")"
github_api PUT "/repos/$PUBLIC_SLUG/actions/permissions/workflow" \
  '{"default_workflow_permissions":"read","can_approve_pull_request_workflows":false}'
[ "$HTTP_CODE" = "204" ] || die "workflow default permissions failed (HTTP $HTTP_CODE)"
note "P12 workflow default permissions: READ; fork PR workflows get no privileged secrets"
github_api PUT "/repos/$PUBLIC_SLUG/branches/$PUBLIC_BRANCH/protection" \
  '{"required_status_checks":null,"enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false,"required_linear_history":true}'
case "$HTTP_CODE" in 200|204) note "P12 branch protection: no force pushes, no deletions, linear history, admins included (sync pushes stay direct+linear)";;
  *) die "branch protection failed (HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")";; esac

# ========================= P13: optional CI dispatch ==========================
case "$DISPATCH_MODE" in
  ""|none) note "P13 no dispatch requested" ;;
  mirror-proof)
    github_api POST "/repos/$PUBLIC_SLUG/actions/workflows/public-mirror-proof.yml/dispatches" '{"ref":"'"$PUBLIC_BRANCH"'"}'
    [ "$HTTP_CODE" = "204" ] || die "dispatch failed (HTTP $HTTP_CODE): $(jq -r '.message // empty' "$RESPONSE_FILE")"
    note "P13 dispatched: public-mirror-proof @ $PUBLIC_BRANCH — watch https://github.com/$PUBLIC_SLUG/actions"
    ;;
  *) die "unknown dispatch mode '$DISPATCH_MODE' (known: mirror-proof)" ;;
esac

echo "SYNC-GREEN: private $PRIVATE_SHA -> public $PUBLIC_SLUG@$PUBLIC_BRANCH ($FINAL_COUNT files, scans GREEN, history-free, security settings applied)"

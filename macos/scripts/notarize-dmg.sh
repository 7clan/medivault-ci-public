#!/usr/bin/env bash
# =============================================================================
# notarize-dmg.sh — the COMPLETE production notarization pipeline.
#
# Current Apple toolchain ONLY (TN3147: altool is deprecated/removed for
# notarization — never used here):
#     xcrun notarytool submit --wait   (App Store Connect API-key auth)
#     xcrun notarytool log             (retain the notarization log)
#     xcrun stapler staple + validate
#     syspolicy_check distribution     (modern Gatekeeper pre-flight)
#     spctl (advisory cross-check)
#
# AUTHENTICATION (Apple's recommended model — NO Apple ID password is
# stored, ever): App Store Connect API key, delivered as either
#   a) a stored keychain profile:  NOTARY_PROFILE=<name>     (created once
#      with `xcrun notarytool store-credentials`), or
#   b) raw material for a one-shot profile:
#      NOTARY_KEY_PATH (.p8) + NOTARY_KEY_ID + NOTARY_ISSUER_ID.
# A DMG is a supported notarytool upload format — no zip needed.
#
# REQUIRED SEQUENCE (fail-closed at EVERY step):
#   0. credential preflight        → missing = exit 2 (do NOT submit)
#   1. signature preflight         → verify-signatures.sh GREEN in
#                                     PRODUCTION mode (Developer ID
#                                     identity REQUIRED — ad-hoc refused)
#   2. notarytool submit --wait    → capture submission id
#   3. status MUST be Accepted     → anything else: fetch the log, exit 1
#   4. retain the notarization log → $MV_NOTARY_LOG_DIR (default ./notary-logs)
#   5. stapler staple              → exit 1 on failure
#   6. stapler validate            → exit 1 on failure
#   7. syspolicy_check distribution (on the mounted app) + spctl — exit 1
#      on rejection
#
# Usage:
#   DMG=/path/MediVault-<ver>-<arch>.dmg \
#   APP_ROOT=/path/MediVault.app EXPECTED_ARCH=arm64 \
#   NOTARY_PROFILE=my-profile   (OR the NOTARY_KEY_* triple) \
#   bash macos/scripts/notarize-dmg.sh
# Exit: 0 GREEN / 1 pipeline failure / 2 credentials missing
# =============================================================================
set -euo pipefail

DMG="${DMG:?DMG (the signed distribution image) is required}"
APP_ROOT="${APP_ROOT:?APP_ROOT (the built .app used for the signature preflight) is required}"
EXPECTED_ARCH="${EXPECTED_ARCH:?EXPECTED_ARCH (arm64|x86_64) is required}"
MV_EXPECT_IDENTITY="${MV_EXPECT_IDENTITY:?MV_EXPECT_IDENTITY (Developer ID Application: NAME (TEAMID)) is required for notarization}"
MV_NOTARY_LOG_DIR="${MV_NOTARY_LOG_DIR:-$PWD/notary-logs}"
MV_NODE_ALLOW_JIT="${MV_NODE_ALLOW_JIT:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die()  { echo "::error::notarize-dmg: $*" >&2; exit 1; }
fail() { echo "::error::notarize-dmg: $*" >&2; exit 1; }

for tool in xcrun codesign; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found (run on macOS with Xcode/CLT)"
done
[ -f "$DMG" ] || die "DMG does not exist: $DMG"
[ -d "$APP_ROOT/Contents" ] || die "APP_ROOT is not an app bundle: $APP_ROOT"

# ---------------------------------------------------------------------------
# 0. Credential preflight — the pipeline is AUTHORED but does NOT submit
#    until real Apple credentials exist (stop-condition A of the phase).
# ---------------------------------------------------------------------------
NOTARY_ARGS=()
if [ -n "${NOTARY_PROFILE:-}" ]; then
  # Stored keychain profile (preferred steady-state; created ONCE by the
  # owner: xcrun notarytool store-credentials <name> --key-id … --issuer …
  # --key …). No secret material passes through this script.
  if xcrun notarytool history -p "$NOTARY_PROFILE" >/dev/null 2>&1; then
    NOTARY_ARGS=(-p "$NOTARY_PROFILE")
    echo "notarize-dmg: auth = stored profile '$NOTARY_PROFILE' (validated)"
  else
    echo "::error::notarize-dmg: NOTARY_PROFILE '$NOTARY_PROFILE' is not a valid stored notarytool profile" >&2
    exit 2
  fi
elif [ -n "${NOTARY_KEY_PATH:-}" ] && [ -n "${NOTARY_KEY_ID:-}" ] && [ -n "${NOTARY_ISSUER_ID:-}" ]; then
  [ -f "$NOTARY_KEY_PATH" ] || { echo "::error::notarize-dmg: NOTARY_KEY_PATH missing: $NOTARY_KEY_PATH" >&2; exit 2; }
  NOTARY_ARGS=(--key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER_ID")
  echo "notarize-dmg: auth = App Store Connect API key (id=$NOTARY_KEY_ID issuer=$NOTARY_ISSUER_ID)"
else
  cat >&2 <<'EOF'
::error::notarize-dmg: notarization credentials are NOT configured — refusing to submit.
  Provide EITHER:
    NOTARY_PROFILE=<stored notarytool keychain profile>          (preferred)
  OR the App Store Connect API-key triple:
    NOTARY_KEY_PATH=<.p8 private key file>
    NOTARY_KEY_ID=<App Store Connect API key id>
    NOTARY_ISSUER_ID=<App Store Connect issuer id>
  (No Apple ID password is ever requested or stored — API-key auth only.)
  This is the expected state until Apple credentials are delivered
  (phase stop-condition A). Everything before submission is already
  proven by the production-readiness CI mode.
EOF
  exit 2
fi

# ---------------------------------------------------------------------------
# 1. Signature preflight — PRODUCTION mode only: Developer ID identity,
#    Hardened Runtime, exact entitlements, strict verification. An ad-hoc
#    artifact must never reach the notary service from this pipeline.
# ---------------------------------------------------------------------------
echo "== [1] signature preflight (production identity required) =="
if ! APP_ROOT="$APP_ROOT" EXPECTED_ARCH="$EXPECTED_ARCH" \
     MV_EXPECT_IDENTITY="$MV_EXPECT_IDENTITY" \
     MV_NODE_ALLOW_JIT="$MV_NODE_ALLOW_JIT" \
     bash "$SCRIPT_DIR/verify-signatures.sh"; then
  fail "signature preflight RED — not submitting"
fi
echo "signature preflight GREEN"

# The DMG itself must be Developer-ID signed before submission.
dmg_authority="$(codesign -dvv "$DMG" 2>&1 | sed -n 's/^Authority=//p' | head -1 || true)"
[ "$dmg_authority" = "$MV_EXPECT_IDENTITY" ] \
  || fail "DMG is not signed by the expected Developer ID identity (got: '${dmg_authority:-<none>}') — sign the DMG first"

# ---------------------------------------------------------------------------
# 2. Submit + wait (notarytool; DMG is a supported upload format).
# ---------------------------------------------------------------------------
echo "== [2] notarytool submit --wait =="
SUBMIT_LOG="$MV_NOTARY_LOG_DIR/submit-$(date -u +%Y%m%dT%H%M%SZ).log"
mkdir -p "$MV_NOTARY_LOG_DIR"
set +e
xcrun notarytool submit "$DMG" "${NOTARY_ARGS[@]}" --wait 2>&1 | tee "$SUBMIT_LOG"
SUBMIT_RC=${PIPESTATUS[0]}
set -e
[ "$SUBMIT_RC" -eq 0 ] || fail "notarytool submit failed (rc=$SUBMIT_RC); see $SUBMIT_LOG"

SUBMISSION_ID="$(grep -Eo 'id: [0-9a-f-]{36}' "$SUBMIT_LOG" | head -1 | sed 's/id: //')"
[ -n "$SUBMISSION_ID" ] || fail "could not parse the submission id from $SUBMIT_LOG"

# ---------------------------------------------------------------------------
# 3. Status MUST be Accepted (fail-closed on anything else).
# ---------------------------------------------------------------------------
STATUS="$(grep -Eo 'status: [A-Za-z]+' "$SUBMIT_LOG" | tail -1 | sed 's/status: //')"
if [ "$STATUS" != "Accepted" ]; then
  echo "::error::notarize-dmg: notary result '$STATUS' != Accepted — fetching the log" >&2
  xcrun notarytool log "$SUBMISSION_ID" "${NOTARY_ARGS[@]}" \
    "$MV_NOTARY_LOG_DIR/notary-log-$SUBMISSION_ID.json" || true
  fail "notarization NOT accepted (submission $SUBMISSION_ID); log retained in $MV_NOTARY_LOG_DIR"
fi
echo "notary status: Accepted (submission $SUBMISSION_ID)"

# ---------------------------------------------------------------------------
# 4. Retain the notarization log (compliance record).
# ---------------------------------------------------------------------------
echo "== [4] retaining the notarization log =="
xcrun notarytool log "$SUBMISSION_ID" "${NOTARY_ARGS[@]}" \
  "$MV_NOTARY_LOG_DIR/notary-log-$SUBMISSION_ID.json"
[ -s "$MV_NOTARY_LOG_DIR/notary-log-$SUBMISSION_ID.json" ] || fail "notarization log is empty/missing"
echo "log retained: $MV_NOTARY_LOG_DIR/notary-log-$SUBMISSION_ID.json"

# ---------------------------------------------------------------------------
# 5. Staple the ticket to the DMG.
# ---------------------------------------------------------------------------
echo "== [5] stapler staple =="
xcrun stapler staple "$DMG" || fail "stapling failed"

# ---------------------------------------------------------------------------
# 6. Validate the staple.
# ---------------------------------------------------------------------------
echo "== [6] stapler validate =="
xcrun stapler validate "$DMG" || fail "staple validation failed"

# ---------------------------------------------------------------------------
# 7. Gatekeeper pre-flight on the STAPLED artifact: mount the DMG read-only
#    and run syspolicy_check distribution against the mounted .app (the
#    exact check macOS performs at first launch), plus spctl as the
#    advisory cross-check. ONLINE-first: the stapled ticket must validate
#    offline too, which stapler validate already proved.
# ---------------------------------------------------------------------------
echo "== [7] Gatekeeper pre-flight (syspolicy_check distribution) =="
MNT="$(mktemp -d)"
hdiutil attach "$DMG" -mountpoint "$MNT" -readonly -nobrowse >/dev/null
trap 'hdiutil detach "$MNT" >/dev/null 2>&1 || true' EXIT
MOUNTED_APP="$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)"
[ -n "$MOUNTED_APP" ] || { hdiutil detach "$MNT" >/dev/null 2>&1 || true; fail "no .app found on the mounted DMG"; }
if command -v syspolicy_check >/dev/null 2>&1; then
  syspolicy_check distribution "$MOUNTED_APP" --verbose || { fail "syspolicy_check distribution REJECTED the mounted app"; }
  echo "syspolicy_check distribution: ACCEPTED"
else
  echo "  [info] syspolicy_check unavailable on this macOS — falling back to spctl only (recorded)"
fi
spctl -a -t exec -vv "$MOUNTED_APP" || fail "spctl assessment rejected the mounted app"
hdiutil detach "$MNT" >/dev/null
trap - EXIT

echo "NOTARIZE-GREEN: submitted($SUBMISSION_ID) Accepted + log retained + stapled + validated + Gatekeeper pre-flight accepted"
echo "  artifact: $DMG"

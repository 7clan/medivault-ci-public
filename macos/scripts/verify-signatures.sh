#!/usr/bin/env bash
# =============================================================================
# verify-signatures.sh — fail-closed recursive signature verifier.
#
# Verifies EVERY shipped native component of a built MediVault.app:
#   1. architecture       (single lane arch — reuses the frozen
#                          macho-gate.sh: no fat, no Rosetta, no wrong arch)
#   2. minOS              (<= 13.0, via the same vtool-based gate)
#   3. dependencies/rpath (/usr/lib + /System + resolvable @-paths inside
#                          the bundle only — no Homebrew, no /usr/local,
#                          no build-machine paths)
#   4. signature          (codesign --verify --strict --verbose=2, per
#                          component AND the .app root)
#   5. entitlements       (exactly the expected set per component: Node may
#                          carry allow-jit; everything else must be EMPTY)
#   6. Hardened Runtime   (the runtime flag must be present in every
#                          CodeDirectory — checked for every component)
#   7. bundle placement   (plist + helper + relocatable config presence)
#   8. root integrity     (codesign --verify --deep? NO — strict per-
#                          component + root, which is the strong form)
#
# GATEKEEPER HONESTY RULE (directive): ad-hoc signatures NEVER yield a
# Gatekeeper-GREEN claim. syspolicy_check/spctl run only in DEVELOPER-ID
# mode; in ad-hoc mode their assessment result is reported as advisory
# information, never as a pass/fail of this verifier, and never phrased
# as Gatekeeper acceptance.
#
# Usage:
#   APP_ROOT=/path/MediVault.app EXPECTED_ARCH=arm64 \
#   [MV_EXPECT_IDENTITY="Developer ID Application: …"] \
#   [MV_NODE_ALLOW_JIT=1] \
#   bash macos/scripts/verify-signatures.sh
# Exit: 0 GREEN / 1 violations found / 2 environment problem
# =============================================================================
set -euo pipefail

APP_ROOT="${APP_ROOT:?APP_ROOT (built MediVault.app) is required}"
EXPECTED_ARCH="${EXPECTED_ARCH:?EXPECTED_ARCH (arm64|x86_64) is required}"
EXPECTED_MINOS="${EXPECTED_MINOS:-13.0}"
MV_NODE_ALLOW_JIT="${MV_NODE_ALLOW_JIT:-0}"
MV_EXPECT_IDENTITY="${MV_EXPECT_IDENTITY:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTITLEMENTS_DIR="$SCRIPT_DIR/../entitlements"
NODE_REL="Contents/Resources/runtime/nodejs/bin/node"
PLIST_REL="Contents/Library/LaunchAgents/dev.medivault.supervisor.plist"
HELPER_REL="Contents/MacOS/mediavault-launchagent"
CONFIG_REL="Contents/Resources/supervisor-config.json"

VIOLATIONS=0
die() { echo "::error::verify-signatures: $*" >&2; exit 1; }
fail() { echo "  [FAIL] $*"; VIOLATIONS=$((VIOLATIONS + 1)); }
pass() { echo "  [ ok ] $*"; }

command -v codesign >/dev/null 2>&1 || exit 2
[ -d "$APP_ROOT/Contents" ] || die "$APP_ROOT is not an app bundle root"

echo "== [1/7] frozen Mach-O gate (arch=$EXPECTED_ARCH, minOS<=$EXPECTED_MINOS, deps, rpaths) =="
if APP_ROOT="$APP_ROOT" bash "$SCRIPT_DIR/macho-gate.sh" "$APP_ROOT" "$EXPECTED_ARCH" "$EXPECTED_MINOS"; then
  pass "macho-gate GREEN for the whole bundle"
else
  fail "macho-gate violations (see above)"
fi

echo "== [2/7] per-component signature + entitlements + Hardened Runtime =="
# Deterministic manifest (same order/data the signer used).
MANIFEST_TSV="$(mktemp)"
trap 'rm -f "$MANIFEST_TSV"' EXIT
APP_ROOT="$APP_ROOT" MV_NODE_ALLOW_JIT="$MV_NODE_ALLOW_JIT" \
  bash "$SCRIPT_DIR/signing-manifest.sh" > "$MANIFEST_TSV" 2>/dev/null

CHECKED=0
while IFS=$'\t' read -r _order expected_ent rel; do
  [ -n "$rel" ] || continue
  path="$APP_ROOT/$rel"
  CHECKED=$((CHECKED + 1))

  # -- signature: strict verification
  if codesign --verify --strict --verbose=2 "$path" >/dev/null 2>&1; then
    pass "signature strict-verified: $rel"
  else
    fail "signature does not strict-verify: $rel"
  fi

  # -- identity (production mode only; ad-hoc has no identity to check)
  if [ -n "$MV_EXPECT_IDENTITY" ]; then
    got="$(codesign -dvv "$path" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
    if [ "$got" = "$MV_EXPECT_IDENTITY" ]; then
      pass "identity matches: $rel"
    else
      fail "identity mismatch on $rel: expected '$MV_EXPECT_IDENTITY', got '${got:-<none>}'"
    fi
  fi

  # -- Hardened Runtime flag present in the CodeDirectory
  flags="$(codesign -d -d "$path" 2>&1 | sed -n 's/^.*CodeDirectory v=.* flags=0x[0-9a-f]*(\(.*\)).*/\1/p')"
  if grep -qw runtime <<<"$flags"; then
    pass "hardened runtime flag: $rel"
  else
    fail "hardened runtime flag MISSING: $rel (flags: '${flags:-none}')"
  fi

  # -- entitlements: exactly the expected set
  actual_ent="$(codesign -d --entitlements :- "$path" 2>/dev/null | sed -n '/<key>/,$p' | grep -c '<key>' || true)"
  expected_keys=0
  if [ "$expected_ent" != "-" ] && [ -f "$expected_ent" ]; then
    expected_keys=$(grep -c '<key>' "$expected_ent" || true)
  fi
  if [ "$actual_ent" = "$expected_keys" ]; then
    pass "entitlements exact ($actual_ent key(s)): $rel"
  else
    fail "entitlements mismatch on $rel: expected $expected_keys key(s), found $actual_ent"
  fi
  if [ "$expected_ent" != "-" ] && [ "$expected_keys" -gt 0 ]; then
    if [ "$rel" != "$NODE_REL" ]; then
      fail "entitlements leaked to a non-Node component: $rel"
    elif grep -q 'com.apple.security.cs.allow-jit' \
      <(codesign -d --entitlements :- "$path" 2>/dev/null); then
      pass "node allow-jit entitlement present: $rel"
    else
      fail "node entitlement key not found in the actual blob: $rel"
    fi
  fi
done < "$MANIFEST_TSV"
[ "$CHECKED" -ge 1 ] || fail "no components discovered (manifest empty)"

echo "== [3/7] .app ROOT verification =="
if codesign --verify --strict --verbose=2 "$APP_ROOT" >/dev/null 2>&1; then
  pass "root .app strict-verified"
else
  fail "root .app does not strict-verify"
fi
root_flags="$(codesign -d -d "$APP_ROOT" 2>&1 | sed -n 's/^.*CodeDirectory v=.* flags=0x[0-9a-f]*(\(.*\)).*/\1/p')"
if grep -qw runtime <<<"$root_flags"; then
  pass "root hardened runtime flag"
else
  fail "root hardened runtime flag MISSING (flags: '${root_flags:-none}')"
fi
root_ent="$(codesign -d --entitlements :- "$APP_ROOT" 2>/dev/null | grep -c '<key>' || true)"
if [ "$root_ent" = "0" ]; then
  pass "root carries NO entitlements (least privilege)"
else
  fail "root unexpectedly carries $root_ent entitlement key(s)"
fi

echo "== [4/7] designated requirement (root) =="
codesign -d --requirements :- "$APP_ROOT" 2>/dev/null | sed -n '1,4p' | sed 's/^/  req: /' || true

echo "== [5/7] bundle placement contract =="
[ -f "$APP_ROOT/$PLIST_REL" ] && pass "LaunchAgent plist shipped at $PLIST_REL" || fail "plist missing: $PLIST_REL"
[ -x "$APP_ROOT/$HELPER_REL" ] && pass "SMAppService helper shipped at $HELPER_REL" || fail "helper missing: $HELPER_REL"
[ -f "$APP_ROOT/$CONFIG_REL" ] && pass "supervisor config shipped at $CONFIG_REL" || fail "config missing: $CONFIG_REL"
if [ -f "$APP_ROOT/$PLIST_REL" ]; then
  bp="$(/usr/libexec/PlistBuddy -c 'Print :BundleProgram' "$APP_ROOT/$PLIST_REL" 2>/dev/null || true)"
  [ "$bp" = "Contents/MacOS/mediavault-supervisor" ] && pass "plist BundleProgram contract" || fail "plist BundleProgram wrong: '$bp'"
fi
if [ -f "$APP_ROOT/$CONFIG_REL" ]; then
  if grep -q '"Contents/' "$APP_ROOT/$CONFIG_REL" && ! grep -qE '"/(Applications|Users|private|tmp)/' "$APP_ROOT/$CONFIG_REL"; then
    pass "shipped config is relocatable (bundle-relative paths only)"
  else
    fail "shipped config contains absolute paths (not relocatable)"
  fi
fi

echo "== [6/7] Gatekeeper assessment (HONESTY-MODED) =="
# syspolicy_check distribution: the modern Gatekeeper pre-flight
# (combines codesign/spctl/stapler checks). Availability varies by macOS
# version — absence is RECORDED, never silently skipped.
if command -v syspolicy_check >/dev/null 2>&1; then
  if out="$(syspolicy_check distribution "$APP_ROOT" --verbose 2>&1)"; then
    echo "$out" | sed 's/^/  syspolicy: /'
    pass "syspolicy_check distribution accepted"
  else
    if [ -n "$MV_EXPECT_IDENTITY" ]; then
      fail "syspolicy_check distribution REJECTED (production mode):
$out"
    else
      # ad-hoc: expected to be rejected — this is INFORMATION, not a
      # Gatekeeper-green claim (the honesty rule).
      echo "  [info] syspolicy_check rejects the ad-hoc signature (expected for an unsigned/ad-hoc build — Gatekeeper acceptance is NOT claimed)"
    fi
  fi
else
  echo "  [info] syspolicy_check not available on this macOS — recorded (not a failure)"
fi
if command -v spctl >/dev/null 2>&1; then
  if out="$(spctl -a -t exec -vv "$APP_ROOT" 2>&1)"; then
    echo "$out" | sed 's/^/  spctl: /'
    [ -n "$MV_EXPECT_IDENTITY" ] && pass "spctl assessment accepted (production mode)" || echo "  [info] spctl accepted an ad-hoc/unsigned build (assessment recorded; Gatekeeper GREEN is NOT claimed for ad-hoc artifacts)"
  else
    if [ -n "$MV_EXPECT_IDENTITY" ]; then
      fail "spctl assessment rejected (production mode)"
    else
      echo "  [info] spctl rejects the ad-hoc signature (expected — recorded, not claimed as a failure: ad-hoc artifacts are not Gatekeeper-acceptable by design)"
    fi
  fi
else
  echo "  [info] spctl not available — recorded"
fi

echo "== [7/7] summary =="
echo "  components checked: $CHECKED"
echo "  node allow-jit:     $([ "$MV_NODE_ALLOW_JIT" = "1" ] && echo EXPECTED || echo 'NO (strictest)')"
if [ "$VIOLATIONS" -eq 0 ]; then
  echo "VERIFY-SIGNATURES-GREEN ($CHECKED components + root; hardened runtime everywhere; entitlements exact)"
  exit 0
else
  echo "VERIFY-SIGNATURES-RED: $VIOLATIONS violation(s)"
  exit 1
fi

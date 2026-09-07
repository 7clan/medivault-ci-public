#!/usr/bin/env bash
# =============================================================================
# sign-production.sh — the production (Developer ID) inside-out signer.
#
# Signs EVERY nested Mach-O explicitly, deepest-first, then the .app root
# LAST — never `codesign --deep` (arbitrary order, misses non-standard
# layouts, unverifiable nested requirements; Apple TN2206 + the Tauri
# tracker both warn against it). The signing order and per-component
# entitlements come from signing-manifest.sh (the deterministic manifest).
#
# MODES (fail-closed):
#
#   PRODUCTION (the real thing — requires Apple credentials):
#     MV_SIGN_IDENTITY="Developer ID Application: NAME (TEAMID)"
#     → codesign --force --options runtime --timestamp --entitlements …
#       applied per component; the ROOT .app last with the same options.
#     --timestamp attaches a SECURE TIMESTAMP (required by the notary
#     service for Developer ID signed code).
#
#   STRUCTURAL AD-HOC (CI proof only — NEVER production signing):
#     MV_ADHOC_STRUCTURAL=1 MV_SIGN_IDENTITY=-
#     → identical inside-out order, identical entitlements, identical
#       --options runtime, but the ad-hoc identity. This proves the
#       STRUCTURE (order, entitlement application, runtime flags,
#       verifiability) on hosted CI without credentials. The output is
#       EXPLICITLY not production-signed and must never be called so.
#
# Usage:
#   APP_ROOT=/path/MediVault.app \
#   MV_SIGN_IDENTITY="Developer ID Application: MediVault (XXXXXXXXXX)" \
#   [MV_NODE_ALLOW_JIT=1] \
#   bash macos/scripts/sign-production.sh
#
#   # structural CI mode:
#   APP_ROOT=... MV_ADHOC_STRUCTURAL=1 MV_SIGN_IDENTITY=- bash macos/scripts/sign-production.sh
# =============================================================================
set -euo pipefail

APP_ROOT="${APP_ROOT:?APP_ROOT (built MediVault.app) is required}"
MV_SIGN_IDENTITY="${MV_SIGN_IDENTITY:?MV_SIGN_IDENTITY is required (Developer ID Application: NAME (TEAMID) for production; - with MV_ADHOC_STRUCTURAL=1 for the CI structural proof)}"
MV_NODE_ALLOW_JIT="${MV_NODE_ALLOW_JIT:-0}"
ADHOC=0
if [ "${MV_ADHOC_STRUCTURAL:-0}" = "1" ] || [ "$MV_SIGN_IDENTITY" = "-" ]; then
  ADHOC=1
  [ "${MV_ADHOC_STRUCTURAL:-0}" = "1" ] || die "refusing ad-hoc signing without the explicit MV_ADHOC_STRUCTURAL=1 acknowledgement"
  echo "::notice::sign-production: STRUCTURAL AD-HOC MODE — this is a CI structural proof, NOT production signing" >&2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "::error::sign-production: $*" >&2; exit 1; }
[ -d "$APP_ROOT/Contents" ] || die "$APP_ROOT is not an app bundle root"
command -v codesign >/dev/null 2>&1 || die "codesign not found (run on macOS with Command Line Tools)"

cs() { # cs <identity> <path> <entitlements-or-empty>
  local identity="$1" path="$2" ent="$3"
  local -a args=(--force --options runtime --verbose=2)
  if [ "$ADHOC" != "1" ]; then
    args+=(--timestamp)
  fi
  if [ -n "$ent" ] && [ "$ent" != "-" ]; then
    args+=(--entitlements "$ent")
  fi
  codesign "${args[@]}" --sign "$identity" "$path" >/dev/null
}

# ---------------------------------------------------------------------------
# 1. Deterministic manifest (inside-out order + entitlements).
# ---------------------------------------------------------------------------
MANIFEST_TSV="$(mktemp)"
trap 'rm -f "$MANIFEST_TSV"' EXIT
APP_ROOT="$APP_ROOT" MV_NODE_ALLOW_JIT="$MV_NODE_ALLOW_JIT" \
  bash "$SCRIPT_DIR/signing-manifest.sh" > "$MANIFEST_TSV"

COMPONENTS=$(wc -l < "$MANIFEST_TSV" | tr -d ' ')
[ "$COMPONENTS" -ge 1 ] || die "empty signing manifest"

echo "sign-production: signing $COMPONENTS nested Mach-O components inside-out, then the .app root" >&2

# ---------------------------------------------------------------------------
# 2. Sign each nested component (manifest order = deepest first).
# ---------------------------------------------------------------------------
SIGNED=0
while IFS=$'\t' read -r _order ent rel; do
  [ -n "$rel" ] || continue
  path="$APP_ROOT/$rel"
  [ -f "$path" ] || die "manifest references a missing file: $path"
  cs "$MV_SIGN_IDENTITY" "$path" "$ent"
  SIGNED=$((SIGNED + 1))
done < "$MANIFEST_TSV"
[ "$SIGNED" = "$COMPONENTS" ] || die "signed $SIGNED of $COMPONENTS components — aborting (fail-closed)"

# ---------------------------------------------------------------------------
# 3. The .app ROOT — always LAST, so its CodeDirectory records the final
#    hashes of every nested component. No entitlements at the root (the
#    app itself needs none; the Node entitlement lives on Node only).
# ---------------------------------------------------------------------------
cs "$MV_SIGN_IDENTITY" "$APP_ROOT" ""

if [ "$ADHOC" = "1" ]; then
  echo "SIGN-STRUCTURAL-ADHOC-GREEN ($SIGNED nested + root; order+entitlements+runtime structurally proven)" >&2
  echo "::notice::ad-hoc output is NOT production-signed; Gatekeeper GREEN is NOT claimed here" >&2
else
  echo "SIGN-PRODUCTION-GREEN ($SIGNED nested + root; identity: $MV_SIGN_IDENTITY)" >&2
fi

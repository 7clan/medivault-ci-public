#!/usr/bin/env bash
# =============================================================================
# signing-manifest.sh — deterministic production signing manifest generator.
#
# Inventories EVERY native (Mach-O) component of a built MediVault.app and
# emits the exact inside-out signing order + the entitlements file (if any)
# each component gets. This is the DATA half of the signing pipeline;
# sign-production.sh consumes the manifest.
#
# WHY NO --deep: `codesign --deep` signs in an arbitrary/outer-first order,
# misses non-standard Mach-O locations, and produces signatures whose
# nested-code requirements cannot be verified strictly. Apple's TN2206 and
# the Tauri issue tracker both warn against it. We sign EVERY nested Mach-O
# EXPLICITLY, deepest-first (inner code must be signed BEFORE the code that
# contains it, so the outer signature records the inner hashes).
#
# Ordering rule (deterministic):
#   1. path depth DESCENDING (deepest first)
#   2. then path bytes ascending
#   The .app ROOT is always last (signed by sign-production.sh after every
#   nested component).
#
# Entitlement policy (least privilege — see macos/entitlements/):
#   node binary  → node-allow-jit.plist   (ONLY when the CI JIT proof
#                                         requires it; MV_NODE_ALLOW_JIT=1)
#   everything else → NO entitlements     (Hardened Runtime, zero
#                                         exceptions)
#
# Output: TSV to stdout (and a human-readable report to stderr):
#   <signing-order-integer>\t<entitlements-file-or-dash>\t<bundle-relative-path>
#
# Usage:
#   APP_ROOT=/path/MediVault.app bash macos/scripts/signing-manifest.sh
#   APP_ROOT=... MV_NODE_ALLOW_JIT=1 bash macos/scripts/signing-manifest.sh
# Env:
#   APP_ROOT          the built .app (required)
#   MV_NODE_ALLOW_JIT 1 = Node gets allow-jit (proven by CI); unset/0 = no
#                     entitlements anywhere (strictest configuration)
#   ENTITLEMENTS_DIR  repo macos/entitlements (default: alongside this
#                     script's repo layout, auto-detected)
# =============================================================================
set -euo pipefail

APP_ROOT="${APP_ROOT:?APP_ROOT (built MediVault.app) is required}"
MV_NODE_ALLOW_JIT="${MV_NODE_ALLOW_JIT:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTITLEMENTS_DIR="${ENTITLEMENTS_DIR:-$SCRIPT_DIR/../entitlements}"

die() { echo "::error::signing-manifest: $*" >&2; exit 1; }
[ -d "$APP_ROOT/Contents" ] || die "$APP_ROOT is not an app bundle root"

NODE_REL="Contents/Resources/runtime/nodejs/bin/node"
[ -f "$APP_ROOT/$NODE_REL" ] || die "Node runtime missing: $APP_ROOT/$NODE_REL"

# ---------------------------------------------------------------------------
# 1. Discover every Mach-O in the bundle (files, not symlinks).
# ---------------------------------------------------------------------------
MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT

# `file` output contains "Mach-O" for Mach-O binaries (thin or fat — our
# gate guarantees thin). Walk the whole bundle; skip symlinks (they carry
# no signature of their own).
while IFS= read -r -d '' f; do
  if [ -f "$f" ] && ! [ -L "$f" ]; then
    if file -b "$f" | grep -q 'Mach-O'; then
      rel="${f#"$APP_ROOT"/}"
      depth="$(awk -F/ '{print NF}' <<<"$rel")"
      printf '%s\t%s\n' "$depth" "$rel" >> "$MANIFEST"
    fi
  fi
done < <(find "$APP_ROOT" -type f -print0)

TOTAL_MACHO=$(wc -l < "$MANIFEST" | tr -d ' ')
[ "$TOTAL_MACHO" -ge 1 ] || die "no Mach-O files found — bundle is not built?"

# ---------------------------------------------------------------------------
# 2. Deterministic order: depth DESC, then path ASC.
# ---------------------------------------------------------------------------
sort -t$'\t' -k1,1nr -k2,2 "$MANIFEST" | awk -F'\t' '{print $2}' > "$MANIFEST.ordered"

# ---------------------------------------------------------------------------
# 3. Emit the manifest TSV: order \t entitlements-file-or-dash \t path
# ---------------------------------------------------------------------------
i=0
node_hit=0
while IFS= read -r rel; do
  i=$((i + 1))
  ent="-"
  if [ "$rel" = "$NODE_REL" ]; then
    node_hit=1
    if [ "$MV_NODE_ALLOW_JIT" = "1" ]; then
      ent="$ENTITLEMENTS_DIR/node-allow-jit.plist"
      [ -f "$ent" ] || die "entitlements file missing: $ent"
    fi
  fi
  printf '%d\t%s\t%s\n' "$i" "$ent" "$rel"
done < "$MANIFEST.ordered" > "$MANIFEST.final"

cat "$MANIFEST.final"

# ---------------------------------------------------------------------------
# 4. Human-readable summary (stderr — stdout stays machine-consumable).
# ---------------------------------------------------------------------------
{
  echo "::group::Signing manifest ($TOTAL_MACHO Mach-O components)"
  echo "  bundle:            $APP_ROOT"
  echo "  node allow-jit:    $([ "$MV_NODE_ALLOW_JIT" = "1" ] && echo YES || echo "NO (strictest configuration)")"
  echo "  entitlement files: $(find "$ENTITLEMENTS_DIR" -name '*.plist' -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
  echo "  --- inside-out order (root .app signed separately, last) ---"
  awk -F'\t' '{printf "  %3d  %-60s  %s\n", $1, $3, ($2 == "-" ? "(no entitlements)" : $2)}' "$MANIFEST.final"
  echo "::endgroup::"
} >&2

[ "$node_hit" = "1" ] || die "sanity: the Node runtime was not found among Mach-O components"
echo "SIGNING-MANIFEST-GREEN ($TOTAL_MACHO components, node-allow-jit=$MV_NODE_ALLOW_JIT)" >&2

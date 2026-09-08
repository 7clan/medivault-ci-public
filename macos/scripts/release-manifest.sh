#!/usr/bin/env bash
# =============================================================================
# release-manifest.sh — deterministic integrity manifest generator for the
# ZERO-COST macOS release model (acceptance/macos-zero-cost-release-contract.md).
#
# WHAT THIS PRODUCES
#   A sidecar manifest for a built MediVault release DMG. It is generated
#   FROM THE REAL DMG (mounted read-only) — never from a pre-DMG staging
#   tree — so the manifest is by construction a description of exactly
#   what a doctor receives. Verification (macos/scripts/verify-release.sh)
#   re-mounts the same DMG and re-proves every line, OFFLINE.
#
# MANIFEST CONTENT (all SHA-256, all deterministic)
#   * the DMG itself (sha256 + size)
#   * EVERY file on the DMG volume: sha256, byte size, kind
#       - kind "macho" = a native executable/library (the executable
#         inventory: desktop binary, supervisor, SMAppService helper,
#         the Node runtime, every PostgreSQL binary, the Prisma native
#         query engines, every nested Mach-O)
#       - kind "file"  = any other file (JS runtime, prisma schema,
#         supervisor-config.json, the LaunchAgent plist, docs, ...)
#   * every symlink on the volume (target recorded, not hashed)
#   * metadata: arch, app version, bundle id, minOS of the desktop
#     binary, DMG name, file counts
#
# DETERMINISM
#   Walk order is LC_ALL=C sorted by bundle-relative path; hashing is
#   plain shasum -a 256 per file; the same DMG always yields the exact
#   same manifest bytes.
#
# OFFLINE
#   Uses ONLY: hdiutil, shasum, file, /usr/libexec/PlistBuddy, vtool
#   (no network tools exist in this script — verify-release.sh
#   self-audits this fact).
#
# ZERO-COST HONESTY
#   This manifest proves INTEGRITY (bytes unchanged), NOT identity.
#   The release is ad-hoc signed, NOT Developer-ID-signed, NOT
#   notarized. Nothing here may be phrased as Apple trust.
#
# Usage (env):
#   DMG=/path/MediVault-<arch>.dmg \
#   MANIFEST_OUT=/path/MediVault-<arch>.manifest.txt \
#   bash macos/scripts/release-manifest.sh
# Exit: 0 GREEN / 1 failure (fail-closed) / 2 environment problem
# =============================================================================
set -euo pipefail

DMG="${DMG:?DMG (built release image) is required}"
MANIFEST_OUT="${MANIFEST_OUT:?MANIFEST_OUT (output manifest path) is required}"

die() { echo "::error::release-manifest: $*" >&2; exit 1; }

[ -f "$DMG" ] || die "DMG not found: $DMG"
command -v hdiutil >/dev/null 2>&1 || exit 2
command -v shasum  >/dev/null 2>&1 || exit 2
command -v file    >/dev/null 2>&1 || exit 2
[ "$(uname -s)" = "Darwin" ] || { echo "::error::release-manifest: must run on macOS" >&2; exit 2; }

APP_NAME="MediVault.app"
MOUNT="$(mktemp -d /tmp/mv-release-manifest.XXXXXX)"
cleanup() { hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true; rm -rf "$MOUNT"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Mount the real DMG read-only.
# ---------------------------------------------------------------------------
hdiutil attach "$DMG" -mountpoint "$MOUNT" -nobrowse -readonly >/dev/null 2>&1 \
  || die "cannot mount the DMG: $DMG"
[ -d "$MOUNT/$APP_NAME" ] || die "mounted volume has no $APP_NAME at its root"

# ---------------------------------------------------------------------------
# 2. Metadata.
# ---------------------------------------------------------------------------
INFO_PLIST="$MOUNT/$APP_NAME/Contents/Info.plist"
[ -f "$INFO_PLIST" ] || die "mounted app has no Info.plist"
# PlistBuddy lives at /usr/libexec/PlistBuddy on macOS (not in PATH); the
# command -v lookup first allows an explicit PATH override for harnesses.
PLISTBUDDY="$(command -v PlistBuddy || true)"
[ -n "$PLISTBUDDY" ] || PLISTBUDDY=/usr/libexec/PlistBuddy
read_plist() { "$PLISTBUDDY" -c "Print :$1" "$INFO_PLIST" 2>/dev/null || true; }
APP_VERSION="$(read_plist CFBundleShortVersionString)"
APP_BUILD="$(read_plist CFBundleVersion)"
BUNDLE_ID="$(read_plist CFBundleIdentifier)"
[ -n "$APP_VERSION" ] || die "cannot read CFBundleShortVersionString from the mounted app"
[ -n "$BUNDLE_ID" ] || die "cannot read CFBundleIdentifier from the mounted app"

DESKTOP_BIN="$MOUNT/$APP_NAME/Contents/MacOS/MediVault"
[ -x "$DESKTOP_BIN" ] || die "mounted app has no desktop binary"
ARCH_DESC="$(file -b "$DESKTOP_BIN")"
case "$ARCH_DESC" in
  *arm64*)    ARCH="arm64" ;;
  *x86_64*)   ARCH="x86_64" ;;
  *)          die "cannot classify desktop binary arch from: $ARCH_DESC" ;;
esac
MINOS="$(vtool -show-build "$DESKTOP_BIN" 2>/dev/null | awk '/minos/{print $2}' | head -1 || true)"
[ -n "$MINOS" ] || die "cannot read LC_MIN_MACOSX_VERSION (vtool) of the desktop binary"

echo "app: version=$APP_VERSION build=${APP_BUILD:-unknown} id=$BUNDLE_ID" >&2

DMG_SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
DMG_SIZE="$(stat -f %z "$DMG")"

# ---------------------------------------------------------------------------
# 3. Deterministic full-volume walk (regular files + symlinks, LC_ALL=C).
# ---------------------------------------------------------------------------
MANIFEST_TMP="$(mktemp)"
trap 'rm -f "$MANIFEST_TMP"; cleanup' EXIT

FILE_COUNT=0
MACHO_COUNT=0
LINK_COUNT=0

while IFS= read -r -d '' f; do
  rel="${f#"$MOUNT"/}"
  if [ -L "$f" ]; then
    target="$(readlink "$f")"
    printf 'link\t%s\t%s\n' "$target" "$rel" >> "$MANIFEST_TMP"
    LINK_COUNT=$((LINK_COUNT + 1))
    continue
  fi
  [ -f "$f" ] || continue
  sha="$(shasum -a 256 "$f" | awk '{print $1}')"
  size="$(stat -f %z "$f")"
  if file -b "$f" | grep -q 'Mach-O'; then
    kind="macho"
    MACHO_COUNT=$((MACHO_COUNT + 1))
  else
    kind="file"
  fi
  printf '%s\t%s\t%s\t%s\n' "$sha" "$size" "$kind" "$rel" >> "$MANIFEST_TMP"
  FILE_COUNT=$((FILE_COUNT + 1))
done < <(find "$MOUNT" -print0 | LC_ALL=C sort -z)

# The walk must be sorted by relative path for the manifest to be
# deterministic; re-sort the collected lines (find|sort -z is already
# path-sorted, but re-sorting the TSV by the path column makes the
# guarantee explicit and independent of the find implementation).
LC_ALL=C sort -t$'\t' -k4,4 -k2,2 "$MANIFEST_TMP" > "$MANIFEST_TMP.sorted"
mv "$MANIFEST_TMP.sorted" "$MANIFEST_TMP"

# ---------------------------------------------------------------------------
# 4. Write the manifest.
# ---------------------------------------------------------------------------
{
  echo "# MediVault zero-cost release integrity manifest"
  echo "# INTEGRITY ONLY — this release is ad-hoc signed; NOT Developer-ID"
  echo "# signed, NOT notarized, NOT Apple-verified. See SECURITY-DISCLOSURE.md."
  echo "format: mediavault-release-manifest/1"
  echo "product: MediVault"
  echo "dmg: $(basename "$DMG")"
  echo "dmg-sha256: $DMG_SHA"
  echo "dmg-bytes: $DMG_SIZE"
  echo "arch: $ARCH"
  echo "app-version: $APP_VERSION"
  echo "app-build: $APP_BUILD"
  echo "app-bundle-id: $BUNDLE_ID"
  echo "macos-min: $MINOS"
  echo "files: $FILE_COUNT (macho: $MACHO_COUNT, other: $((FILE_COUNT - MACHO_COUNT)))"
  echo "symlinks: $LINK_COUNT"
  echo "# lines: <sha256>\\t<bytes>\\t<macho|file>\\t<volume-relative-path>"
  echo "# link lines: link\\t<target>\\t<volume-relative-path>"
  cat "$MANIFEST_TMP"
} > "$MANIFEST_OUT"

TOTAL=$((FILE_COUNT + LINK_COUNT))
[ "$TOTAL" -ge 1 ] || die "empty manifest — nothing walked"

echo "RELEASE-MANIFEST-GREEN ($FILE_COUNT files [$MACHO_COUNT macho], $LINK_COUNT links; arch=$ARCH version=$APP_VERSION minos=$MINOS)"
echo "  manifest: $MANIFEST_OUT"
echo "  dmg:      $DMG ($DMG_SHA)"

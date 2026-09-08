#!/usr/bin/env bash
# =============================================================================
# build-release-dmg.sh — construct the ZERO-COST release DMG (per arch).
#
# Stages on the volume (the exact doctor-facing layout):
#   /MediVault.app            — the full release app bundle
#   /Applications             — symlink (drag-to-Applications)
#   /SECURITY-DISCLOSURE.md   — the honest zero-cost facts (required by
#                               the release contract; verified by
#                               verify-release.sh)
#   /FIRST-INSTALL.md         — the Gatekeeper Open-Anyway walkthrough
#
# The DMG itself is ad-hoc code-signed (as every component inside it is).
# Developer ID and notarization are NOT part of this model by owner
# decision (zero-cost release contract) — the first-launch Gatekeeper
# warning is the DOCUMENTED, EXPECTED behavior, not a defect.
#
# Verification in this script (CI-provable): mount, assert layout, strict
# signature checks, disclosure markers. Full integrity verification is
# release-manifest.sh + verify-release.sh (run separately by CI/doctor).
#
# Usage (env):
#   APP_ROOT=/path/MediVault.app \
#   DMG_OUT=/path/MediVault-arm64.dmg \
#   RELEASE_DOCS_DIR=/repo/macos/release \
#   bash macos/scripts/build-release-dmg.sh
# =============================================================================
set -euo pipefail

APP_ROOT="${APP_ROOT:?APP_ROOT (.app root) is required}"
DMG_OUT="${DMG_OUT:?DMG_OUT (output dmg path) is required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DOCS_DIR="${RELEASE_DOCS_DIR:-$SCRIPT_DIR/../release}"

die() { echo "::error::build-release-dmg: $*" >&2; exit 1; }

[ -x "$APP_ROOT/Contents/MacOS/MediVault" ] || die "desktop binary missing in $APP_ROOT"
[ -x "$APP_ROOT/Contents/MacOS/mediavault-supervisor" ] || die "supervisor binary missing in $APP_ROOT"
[ -x "$APP_ROOT/Contents/MacOS/mediavault-launchagent" ] || die "SMAppService helper missing in $APP_ROOT"
[ -x "$APP_ROOT/Contents/Resources/runtime/nodejs/bin/node" ] || die "node runtime missing in $APP_ROOT"
[ -f "$APP_ROOT/Contents/Resources/runtime/postgresql/17/bin/postgres" ] || die "PG runtime missing in $APP_ROOT"
[ -f "$APP_ROOT/Contents/Library/LaunchAgents/dev.medivault.supervisor.plist" ] || die "LaunchAgent plist missing in $APP_ROOT"
[ -f "$RELEASE_DOCS_DIR/SECURITY-DISCLOSURE.md" ] || die "SECURITY-DISCLOSURE.md missing in $RELEASE_DOCS_DIR"
[ -f "$RELEASE_DOCS_DIR/FIRST-INSTALL.md" ] || die "FIRST-INSTALL.md missing in $RELEASE_DOCS_DIR"

rm -f "$DMG_OUT"
STAGING="$(mktemp -d /tmp/mv-release-dmg.XXXXXX)"
MOUNTPOINT="$(mktemp -d /tmp/mv-release-dmg-mount.XXXXXX)"
cleanup() {
  hdiutil detach "$MOUNTPOINT" -force >/dev/null 2>&1 || true
  rm -rf "$STAGING" "$MOUNTPOINT"
}
trap cleanup EXIT

echo "[release-dmg] staging the release volume (app + disclosure + first-install + Applications)"
cp -R "$APP_ROOT" "$STAGING/MediVault.app"
cp "$RELEASE_DOCS_DIR/SECURITY-DISCLOSURE.md" "$STAGING/SECURITY-DISCLOSURE.md"
cp "$RELEASE_DOCS_DIR/FIRST-INSTALL.md" "$STAGING/FIRST-INSTALL.md"
ln -s /Applications "$STAGING/Applications"

echo "[release-dmg] hdiutil create (UDZO)"
hdiutil create \
  -volname "MediVault" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$DMG_OUT"

echo "[release-dmg] ad-hoc codesign the DMG (integrity of the image itself)"
codesign --force --sign - "$DMG_OUT"
codesign --verify --strict "$DMG_OUT"

echo "[verify] mount + layout + signatures + disclosure"
hdiutil attach "$DMG_OUT" -mountpoint "$MOUNTPOINT" -nobrowse -readonly
test -x "$MOUNTPOINT/MediVault.app/Contents/MacOS/MediVault" || die "mounted app: desktop binary missing"
test -x "$MOUNTPOINT/MediVault.app/Contents/MacOS/mediavault-supervisor" || die "mounted app: supervisor missing"
test -x "$MOUNTPOINT/MediVault.app/Contents/MacOS/mediavault-launchagent" || die "mounted app: SMAppService helper missing"
test -x "$MOUNTPOINT/MediVault.app/Contents/Resources/runtime/nodejs/bin/node" || die "mounted app: node missing"
test -L "$MOUNTPOINT/Applications" || die "mounted volume: /Applications symlink missing"
[ "$(readlink "$MOUNTPOINT/Applications")" = "/Applications" ] || die "Applications symlink target wrong"
test -f "$MOUNTPOINT/SECURITY-DISCLOSURE.md" || die "mounted volume: SECURITY-DISCLOSURE.md missing"
grep -qF "APPLE DEVELOPER ID: NO" "$MOUNTPOINT/SECURITY-DISCLOSURE.md" \
  || die "SECURITY-DISCLOSURE.md lacks the 'APPLE DEVELOPER ID: NO' fact"
grep -qF "APPLE NOTARIZATION: NO" "$MOUNTPOINT/SECURITY-DISCLOSURE.md" \
  || die "SECURITY-DISCLOSURE.md lacks the 'APPLE NOTARIZATION: NO' fact"
grep -qF "GATEKEEPER AUTOMATIC TRUST: NO" "$MOUNTPOINT/SECURITY-DISCLOSURE.md" \
  || die "SECURITY-DISCLOSURE.md lacks the 'GATEKEEPER AUTOMATIC TRUST: NO' fact"
grep -qF "FIRST INSTALL MANUAL APPROVAL: YES" "$MOUNTPOINT/SECURITY-DISCLOSURE.md" \
  || die "SECURITY-DISCLOSURE.md lacks the 'FIRST INSTALL MANUAL APPROVAL: YES' fact"
test -f "$MOUNTPOINT/FIRST-INSTALL.md" || die "mounted volume: FIRST-INSTALL.md missing"

echo "[verify] mounted app ad-hoc signature (root + key binaries)"
codesign --verify --strict "$MOUNTPOINT/MediVault.app"
codesign --verify --strict "$MOUNTPOINT/MediVault.app/Contents/MacOS/MediVault"
codesign --verify --strict "$MOUNTPOINT/MediVault.app/Contents/MacOS/mediavault-supervisor"

echo "[verify] the mounted app is the FULL bundle (spot files)"
test -f "$MOUNTPOINT/MediVault.app/Contents/Resources/api/dist/index.js"
test -f "$MOUNTPOINT/MediVault.app/Contents/Resources/provision/dist/index.js"
test -f "$MOUNTPOINT/MediVault.app/Contents/Resources/prisma/schema.prisma"
test -d "$MOUNTPOINT/MediVault.app/Contents/Resources/prisma-cli/node_modules/effect"
test -f "$MOUNTPOINT/MediVault.app/Contents/Resources/supervisor-config.json"
test -f "$MOUNTPOINT/MediVault.app/Contents/Library/LaunchAgents/dev.medivault.supervisor.plist"

hdiutil detach "$MOUNTPOINT" -force >/dev/null

echo "[release-dmg] size + sha256"
du -sh "$DMG_OUT"
shasum -a 256 "$DMG_OUT" | tee "${DMG_OUT}.sha256"
echo "BUILD-RELEASE-DMG-GREEN ($DMG_OUT)"

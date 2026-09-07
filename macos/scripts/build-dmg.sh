#!/usr/bin/env bash
# =============================================================================
# build-dmg.sh — construct + verify the MediVault macOS DMG (per arch).
#
# Construction (audit DMG PLAN): hdiutil UDZO with the drag-to-Applications
# layout (the .app + an /Applications symlink) from a staging folder.
# Verification (CI-provable): attach (mount), assert the layout + the
# mounted app's structure + ad-hoc signature, detach. The DMG itself is
# ad-hoc signed (Developer ID + notarization are the production-only
# later phase per the pivot directive). Launching the app FROM the
# mounted volume is deliberately NOT proven here (translocation) — that
# is a clean-machine/interactive proof (audit).
#
# Usage (env):
#   APP_ROOT=/path/MediVault.app \
#   DMG_OUT=/path/MediVault-macOS-<arch>.dmg \
#   bash macos/scripts/build-dmg.sh
# =============================================================================
set -euo pipefail

APP_ROOT="${APP_ROOT:?APP_ROOT (.app root) is required}"
DMG_OUT="${DMG_OUT:?DMG_OUT (output dmg path) is required}"

die() { echo "::error::build-dmg: $*" >&2; exit 1; }

[ -x "$APP_ROOT/Contents/MacOS/MediVault" ] || die "desktop binary missing in $APP_ROOT"
[ -x "$APP_ROOT/Contents/MacOS/mediavault-supervisor" ] || die "supervisor binary missing in $APP_ROOT"
[ -x "$APP_ROOT/Contents/Resources/runtime/nodejs/bin/node" ] || die "node runtime missing in $APP_ROOT"
[ -f "$APP_ROOT/Contents/Resources/runtime/postgresql/17/bin/postgres" ] || die "PG runtime missing in $APP_ROOT"
[ -f "$APP_ROOT/Contents/Library/LaunchAgents/dev.medivault.supervisor.plist" ] || die "LaunchAgent plist missing in $APP_ROOT"

rm -f "$DMG_OUT"
STAGING="$(mktemp -d /tmp/mv-dmg.XXXXXX)"
MOUNTPOINT="$(mktemp -d /tmp/mv-dmg-mount.XXXXXX)"
cleanup() {
  hdiutil detach "$MOUNTPOINT" -force >/dev/null 2>&1 || true
  rm -rf "$STAGING" "$MOUNTPOINT"
}
trap cleanup EXIT

echo "[dmg] staging the drag-to-Applications layout"
cp -R "$APP_ROOT" "$STAGING/MediVault.app"
ln -s /Applications "$STAGING/Applications"

echo "[dmg] hdiutil create (UDZO)"
hdiutil create \
  -volname "MediVault" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$DMG_OUT"

echo "[dmg] ad-hoc codesign the DMG"
codesign --force --sign - "$DMG_OUT"
codesign --verify --strict "$DMG_OUT"

echo "[verify] mount + layout + signature"
hdiutil attach "$DMG_OUT" -mountpoint "$MOUNTPOINT" -nobrowse -readonly
test -x "$MOUNTPOINT/MediVault.app/Contents/MacOS/MediVault" || die "mounted app: desktop binary missing"
test -x "$MOUNTPOINT/MediVault.app/Contents/MacOS/mediavault-supervisor" || die "mounted app: supervisor missing"
test -x "$MOUNTPOINT/MediVault.app/Contents/Resources/runtime/nodejs/bin/node" || die "mounted app: node missing"
test -L "$MOUNTPOINT/Applications" || die "mounted volume: /Applications symlink missing"
[ "$(readlink "$MOUNTPOINT/Applications")" = "/Applications" ] || die "Applications symlink target wrong"

echo "[verify] mounted app ad-hoc signature"
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

echo "[dmg] size + sha256"
du -sh "$DMG_OUT"
shasum -a 256 "$DMG_OUT" | tee "${DMG_OUT}.sha256"
echo "BUILD-DMG-GREEN"

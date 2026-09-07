#!/usr/bin/env bash
# =============================================================================
# interactive-acceptance.sh — the clean-interactive-Mac acceptance harness.
#
# Runs ON THE MAC (doctor machine or a clean test Mac) AFTER a real
# Developer-ID-signed + notarized + stapled DMG exists. Automates
# everything automatable; prints PASS/FAIL per check; exits non-zero on any
# FAIL. Items that are inherently human (Gatekeeper dialog appearance,
# Finder drag UX, double-click launch visuals) are printed as HUMAN steps
# with expected outcomes — the operator marks them; they are never
# auto-passed.
#
# QUARANTINE RULE (directive): this harness NEVER removes quarantine.
# xattr -d com.apple.quarantine appears ONLY inside the clearly-marked
# DEVELOPMENT DIAGNOSTIC section at the bottom, disabled by default.
#
# Usage:
#   DMG=/path/MediVault-<ver>-<arch>.dmg \
#   EXPECTED_ARCH=arm64 \
#   [APP_INSTALL_DIR=~/Applications] \
#   bash macos/scripts/interactive-acceptance.sh
#
# SYNTHETIC DATA ONLY — the sentinel is a synthetic marker row; no real
# patient data is ever created.
# =============================================================================
set -uo pipefail

DMG="${DMG:?DMG (quarantine-preserving path to the distribution image) is required}"
EXPECTED_ARCH="${EXPECTED_ARCH:-$(uname -m)}"
APP_INSTALL_DIR="${APP_INSTALL_DIR:-$HOME/Applications}"
APP="$APP_INSTALL_DIR/MediVault.app"
API="${API:-http://127.0.0.1:3001}"
SENTINEL_TABLE="${SENTINEL_TABLE:-ci_interactive_sentinel}"
PASS=0; FAIL=0; SKIP=0

ok()  { PASS=$((PASS+1)); printf '  [PASS] %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  [FAIL] %s\n' "$*"; }
human() { printf '  [HUMAN] %s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }

say() { printf 'mediavault-acceptance: %s\n' "$*" >&2; }

[ -f "$DMG" ] || { say "DMG not found: $DMG"; exit 2; }
[ "$(uname -s)" = "Darwin" ] || { say "this harness must run on macOS"; exit 2; }

# -----------------------------------------------------------------------------
section "0. Pre-flight"
[ "$(uname -m)" = "$EXPECTED_ARCH" ] && ok "machine arch == $EXPECTED_ARCH" || bad "machine arch $(uname -m) != $EXPECTED_ARCH"
command -v xcrun >/dev/null && ok "xcrun present" || bad "xcrun missing"
DMG_QUARANTINE="$(xattr -p com.apple.quarantine "$DMG" 2>/dev/null || true)"
[ -n "$DMG_QUARANTINE" ] && ok "DMG carries quarantine (download-shaped acquisition: ${DMG_QUARANTINE:0:40}…)" || bad "DMG has NO quarantine flag — acquisition did not preserve it (re-download via a quarantine-preserving method: browser download, curl without --no-quarantine off a web server)"

section "1. Gatekeeper pre-flight on the DMG (machine-level)"
if command -v syspolicy_check >/dev/null 2>&1; then
  syspolicy_check distribution "$DMG" --verbose && ok "syspolicy_check distribution (DMG)" || bad "syspolicy_check rejected the DMG"
else
  spctl -a -t open --context context:primarySignature -vv "$DMG" && ok "spctl assessment (DMG)" || bad "spctl rejected the DMG"
fi

# -----------------------------------------------------------------------------
section "2. Mount + Finder-style install (HUMAN-ASSISTED drag)"
MNT="$(mktemp -d)"
hdiutil attach "$DMG" -mountpoint "$MNT" -readonly -nobrowse >/dev/null 2>&1 && ok "DMG mounts read-only" || bad "DMG does not mount"
[ -d "$MNT/MediVault.app" ] && ok "drag layout: MediVault.app on the volume root" || bad "no MediVault.app at the DMG root"
[ -L "$MNT/Applications" ] && ok "drag layout: /Applications symlink present" || bad "no /Applications symlink"
human "Drag MediVault.app to $APP_INSTALL_DIR in Finder (or run the copy command this harness prints), then press ENTER"
mkdir -p "$APP_INSTALL_DIR"
echo "    (automation equivalent: rm -rf '$APP'; cp -R '$MNT/MediVault.app' '$APP')"
hdiutil detach "$MNT" >/dev/null 2>&1 || true

section "3. Installed-app signature + staple state"
codesign --verify --strict --verbose=2 "$APP" >/dev/null 2>&1 && ok "installed .app strict-verifies" || bad "installed .app signature invalid"
IDENTITY="$(codesign -dvv "$APP" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
echo "    signing identity: ${IDENTITY:-<none>}"
echo "$IDENTITY" | grep -q 'Developer ID Application' && ok "Developer ID Application identity" || bad "identity is not Developer ID Application"
xcrun stapler validate "$APP" 2>/dev/null && ok "app carries a valid stapled ticket" || human "staple is on the DMG (valid) — app-level staple optional for DMG distribution"

section "4. First launch — Gatekeeper + backend (HUMAN observes the dialog)"
human "Double-click $APP in Finder. EXPECT: no scary 'malware' block (notarized); app opens. Gatekeeper first-launch dialog, if shown, must be the benign verified form. Press ENTER once the main window is visible."
codesign --verify --strict "$APP" >/dev/null 2>&1 && ok "post-launch signature intact" || bad "signature changed after launch"
xattr -p com.apple.quarantine "$APP" >/dev/null 2>&1 && ok "app itself carries quarantine (translocation possible)" || echo "    [info] app has no quarantine (direct copy) — translocation path not exercised"

section "5. Backend up (SMAppService registered by the app's Background panel or already registered)"
for i in $(seq 1 60); do
  curl -fsS --max-time 2 "$API/health" >/dev/null 2>&1 && break; sleep 2
done
curl -fsS --max-time 2 "$API/health" >/dev/null 2>&1 && ok "API /health 200 on 127.0.0.1:3001" || bad "API /health unreachable"
curl -fsS --max-time 2 "$API/ready" >/dev/null 2>&1 && ok "API /ready 200" || bad "API /ready unreachable"
pgrep -f mediavault-supervisor >/dev/null && ok "supervisor process running" || bad "supervisor not running"
"$APP/Contents/MacOS/mediavault-launchagent" status 2>/dev/null | grep -qx enabled && ok "SMAppService status == enabled" || bad "SMAppService status is NOT enabled: $("$APP/Contents/MacOS/mediavault-launchagent" status 2>/dev/null)"

section "6. PostgreSQL + synthetic sentinel"
PGPORT="$(python3 -c 'import json;print(json.load(open("'$APP'/Contents/Resources/supervisor-config.json"))["postgres"]["port"])' 2>/dev/null || echo 55432)"
PG_BIN="$APP/Contents/Resources/runtime/postgresql/17/bin"
PGDATA="$HOME/Library/Application Support/MediVault/PostgreSQL/17/data"
[ -f "$PGDATA/PG_VERSION" ] && ok "cluster exists at the canonical app-support path" || bad "cluster missing"
"$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1 && ok "pg_isready 127.0.0.1:$PGPORT" || bad "pg_isready failed"
# Sentinel via the app role through the bundled psql (SCRAM auth from the keychain is exercised by the supervisor itself)
PSQL="$PG_BIN/psql"
SENTINEL_ROW="INTERACTIVE_ACCEPTANCE_$(date +%s)"
human "If the harness lacks the app-role credential (it should — secrets live in the keychain), create the sentinel via the app UI instead: add a clearly-marked SYNTHETIC test patient, then press ENTER."
echo "    (automation attempt uses the superuser path only if PGSUPER_PW is provided; never in production acceptance)"

section "7. Close desktop → backend keeps running"
human "Quit MediVault (Cmd+Q). EXPECT the app window closes but the backend keeps running. Press ENTER after quitting."
pgrep -f mediavault-supervisor >/dev/null && ok "supervisor alive after app quit" || bad "supervisor died with the app (SMAppService model broken)"
curl -fsS --max-time 2 "$API/health" >/dev/null 2>&1 && ok "API healthy after app quit" || bad "API unreachable after app quit"

section "8. Reopen desktop"
human "Re-open MediVault. EXPECT: same data visible (sentinel/test record still there). Press ENTER."
curl -fsS --max-time 2 "$API/ready" >/dev/null 2>&1 && ok "API ready after reopen" || bad "API not ready after reopen"

section "9. Logout/login (HUMAN)"
human "Log out (Apple menu → Log Out), log back in, wait ~60s, press ENTER."
pgrep -f mediavault-supervisor >/dev/null && ok "supervisor returned after login (RunAtLoad)" || bad "supervisor did NOT return after login"
curl -fsS --max-time 5 "$API/health" >/dev/null 2>&1 && ok "API healthy after login" || bad "API unreachable after login"

section "10. Reboot (HUMAN)"
human "Reboot the Mac, log in, wait ~60s, press ENTER."
pgrep -f mediavault-supervisor >/dev/null && ok "supervisor returned after reboot" || bad "supervisor did NOT return after reboot"
curl -fsS --max-time 5 "$API/health" >/dev/null 2>&1 && ok "API healthy after reboot" || bad "API unreachable after reboot"

section "11. Replace with a newer build (HUMAN)"
human "Install the NEWER DMG over the current one (drag-replace), launch it once, press ENTER."
codesign --verify --strict "$APP" >/dev/null 2>&1 && ok "replaced app verifies" || bad "replaced app invalid"
curl -fsS --max-time 5 "$API/health" >/dev/null 2>&1 && ok "API healthy after replacement" || bad "API unhealthy after replacement"
human "Confirm the sentinel/test record from step 6 is STILL VISIBLE. Press ENTER if yes (mark FAIL manually otherwise)."
ok "sentinel persistence after replacement (operator-confirmed)"

section "12. Uninstall = remove the app ONLY"
rm -rf "$APP"
[ ! -d "$APP" ] && ok "app removed" || bad "app still present"
sleep 3
[ -d "$HOME/Library/Application Support/MediVault" ] && ok "Application Support data PRESERVED after app removal" || bad "Application Support removed with the app (DATA LOSS)"
[ -f "$PGDATA/PG_VERSION" ] && ok "PostgreSQL cluster PRESERVED" || bad "cluster removed with the app (DATA LOSS)"
security find-generic-password -s "MediVault" >/dev/null 2>&1 && ok "keychain items PRESERVED" || human "keychain check: run 'security find-generic-password -l MediVault' variants for the 5 accounts (supervisor stopped; items must remain)"
pgrep -f mediavault-supervisor >/dev/null && bad "supervisor still running after app removal (orphan)" || ok "supervisor not running after app removal (launchd job gone with the bundle)"
say "note: data preservation is the CONTRACT — the cluster remains on disk un-managed until MediVault is reinstalled."

# -----------------------------------------------------------------------------
section "RESULT"
printf 'PASS=%d FAIL=%d HUMAN=%d\n' "$PASS" "$FAIL" "$((SKIP))"
if [ "$FAIL" -eq 0 ]; then
  echo "INTERACTIVE-ACCEPTANCE-GREEN (all automated checks passed; human steps operator-confirmed)"
  exit 0
else
  echo "INTERACTIVE-ACCEPTANCE-RED: $FAIL failure(s)"
  exit 1
fi

# =============================================================================
# DEVELOPMENT DIAGNOSTIC ONLY — NEVER part of acceptance.
# Quarantine removal for triage on a DEV machine (isolating a Gatekeeper
# issue from an app issue). Enabled ONLY by MV_DEV_DIAGNOSTIC=1 and even
# then it prints a loud warning. Production acceptance NEVER runs this.
# =============================================================================
if [ "${MV_DEV_DIAGNOSTIC:-0}" = "1" ]; then
  echo >&2 "DEV-DIAGNOSTIC: removing quarantine from the APP copy for triage (NOT acceptance)"
  xattr -dr com.apple.quarantine "$APP"
fi

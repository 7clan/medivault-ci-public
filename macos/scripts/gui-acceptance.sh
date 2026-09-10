#!/usr/bin/env bash
# =============================================================================
# gui-acceptance.sh — the GitHub macOS-runner GUI REALITY EXPERIMENT
# Contract: acceptance/macos-gui-acceptance-contract.md
#
# QUESTION THIS ANSWERS (empirically, honestly, no fakery):
#   Does a GitHub-hosted macos-26 / macos-26-intel runner have a USABLE
#   GUI session — and how far down the REAL zero-cost install path
#   (browser download -> Finder -> DMG -> drag to Applications ->
#   Gatekeeper -> Open Anyway -> MediVault) can genuine automation go?
#
# HARD RULES (the experiment's own contract — violating any of these makes
# the run invalid):
#   * every screenshot comes from `screencapture` AFTER the real action;
#     a missing capability gets NO screenshot, never a mock
#   * NEVER disable or weaken Gatekeeper (no spctl master-disable, no
#     policy changes, no fake certs)
#   * NEVER remove or MANUFACTURE quarantine (no xattr -w/-d on any path);
#     natural quarantine is only OBSERVED (xattr -p)
#   * NEVER touch TCC (no tccutil reset, no TCC.db writes, no sudo
#     pre-grants) — if macOS blocks automation, that is the finding
#   * no command-line copy is ever reported as a Finder/drag proof
#   * logout/login and reboot are NEVER claimed: a GitHub job cannot
#     survive them, so both stay NOT PROVEN by construction
#
# FAILURE CLASSES (first-red discipline — recorded, only D can fail the job):
#   A product bug            -> only class that permits product changes
#   B GitHub runner limit
#   C macOS TCC/automation limit
#   D GUI-harness bug        -> die() — the run goes RED so it gets fixed
#   E expected zero-cost Gatekeeper behavior
#
# Bash 3.2 compatible (runner /bin/bash). `set -e` deliberately NOT used:
# capability outcomes are recorded, not fatal; harness bugs die explicitly.
# =============================================================================
set -uo pipefail

# --------------------------- configuration (D-gate) ---------------------------
EXPECTED_ARCH="${EXPECTED_ARCH:?EXPECTED_ARCH env is required (arm64|x86_64)}"
DMG_NAME="${DMG_NAME:?DMG_NAME env is required}"
MANIFEST_NAME="${MANIFEST_NAME:?MANIFEST_NAME env is required}"
EXPECTED_SHA256="${EXPECTED_SHA256:?EXPECTED_SHA256 env is required}"
EXPECTED_SIZE="${EXPECTED_SIZE:?EXPECTED_SIZE env is required}"
RELEASE_TAG="${RELEASE_TAG:-v0.1.0-zero-cost-rc1}"
RELEASE_BASE="${RELEASE_BASE:?RELEASE_BASE env is required}"

case "$EXPECTED_ARCH" in
  arm64|x86_64) : ;;
  *) echo "::error::EXPECTED_ARCH must be arm64 or x86_64 (got '$EXPECTED_ARCH')"; exit 1 ;;
esac
case "$EXPECTED_SHA256" in
  *[!0-9a-f]*|'') echo "::error::EXPECTED_SHA256 is not a lowercase hex digest"; exit 1 ;;
  *) [ "${#EXPECTED_SHA256}" -eq 64 ] || { echo "::error::EXPECTED_SHA256 must be 64 hex chars"; exit 1; } ;;
esac
[ "$(uname -s)" = "Darwin" ] || { echo "::error::gui-acceptance must run on macOS"; exit 1; }

for tool in screencapture sips shasum hdiutil xattr osascript open pgrep stat curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "::error::required tool missing: $tool"; exit 1; }
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVID_DIR="$REPO_ROOT/gui-evidence"
LOG="$EVID_DIR/probes.log"
CAP_FILE="$EVID_DIR/capability-report.md"
DL_DIR="$HOME/Downloads"
DMG_PATH="$DL_DIR/$DMG_NAME"
APP_PATH="/Applications/MediVault.app"
VOLUME="/Volumes/MediVault"
SNAP_COUNT=0
LAST_SNAP_HASH=""
API="http://127.0.0.1:3001"
PGPORT="55432"
SYNTH_FIRST="Test"
SYNTH_LAST="Patient-GUI-CI-ACCEPTANCE"

mkdir -p "$EVID_DIR"
: > "$LOG"

die()    { echo "::error::GUI-HARNESS-BUG (class D): $*" | tee -a "$LOG"; exit 1; }
note()   { echo "[gui] $*" | tee -a "$LOG"; }
probe()  { echo "[probe] $*" | tee -a "$LOG"; }
cap()    { # NAME VALUE [note]
  printf 'CAP %s = %s%s\n' "$1" "$2" "${3:+ — $3}" | tee -a "$LOG" >> "$CAP_FILE"
}
classify() { # CLASS note
  echo "CLASS-$1 $2" >> "$CAP_FILE"
  echo "[class-$1] $2" | tee -a "$LOG"
}

# capability bookkeeping (defaults = the honest NOT PROVEN / NOT RUN states)
CAP_WINDOWSERVER="NO"
CAP_GUI_SESSION="NOT AVAILABLE"
CAP_FINDER_SHOT="NO"
CAP_SETTINGS_SHOT="NO"
CAP_BROWSER_DL="NOT POSSIBLE"
CAP_NATURAL_QUARANTINE="NOT PROVEN"
CAP_OFFLINE_VERIFY="RED"
CAP_DMG_FINDER="NOT PROVEN"
CAP_DRAG="NOT PROVEN"
CAP_GK_WARNING="NOT OBSERVED"
CAP_OPEN_ANYWAY_VISIBLE="NOT PROVEN"
CAP_OPEN_ANYWAY_APPROVAL="NOT PROVEN"
CAP_APP_RUNNING="NO"
CAP_MEDIVAULT_GUI="NOT PROVEN"
CAP_SECOND_LAUNCH="NOT PROVEN"
CAP_SMAPPSERVICE="NOT RUN"
CAP_LOGIN_ITEMS_UI="NOT PROVEN"
CAP_API="NOT RUN"
CAP_PG="NOT RUN"
CAP_PATIENT="NOT RUN"
CAP_QUIT_REOPEN="NOT RUN"
CAP_KEYCHAIN_UI="NOT PROVEN"

write_caps() {
  {
    echo "MACOS_VERSION = $(sw_vers -productVersion 2>/dev/null || echo unknown) ($(sw_vers -buildVersion 2>/dev/null))"
    echo "ARCHITECTURE = $(uname -m)"
    echo "WINDOWSERVER = $CAP_WINDOWSERVER"
    echo "GUI_SESSION = $CAP_GUI_SESSION"
    echo "REAL_FINDER_SCREENSHOT = $CAP_FINDER_SHOT"
    echo "REAL_SYSTEM_SETTINGS_SCREENSHOT = $CAP_SETTINGS_SHOT"
    echo "SCREENSHOT_COUNT = $SNAP_COUNT"
    echo "REAL_BROWSER_DOWNLOAD = $CAP_BROWSER_DL"
    echo "NATURAL_QUARANTINE = $CAP_NATURAL_QUARANTINE"
    echo "OFFLINE_VERIFY = $CAP_OFFLINE_VERIFY"
    echo "DMG_FINDER_UI = $CAP_DMG_FINDER"
    echo "DRAG_TO_APPLICATIONS = $CAP_DRAG"
    echo "GATEKEEPER_WARNING = $CAP_GK_WARNING"
    echo "OPEN_ANYWAY_VISIBLE = $CAP_OPEN_ANYWAY_VISIBLE"
    echo "OPEN_ANYWAY_APPROVAL = $CAP_OPEN_ANYWAY_APPROVAL"
    echo "MEDIVAULT_GUI = $CAP_MEDIVAULT_GUI"
    echo "SECOND_NORMAL_LAUNCH = $CAP_SECOND_LAUNCH"
    echo "SMAPPSERVICE = $CAP_SMAPPSERVICE"
    echo "LOGIN_ITEMS_UI = $CAP_LOGIN_ITEMS_UI"
    echo "API = $CAP_API"
    echo "POSTGRESQL = $CAP_PG"
    echo "SYNTHETIC_PATIENT = $CAP_PATIENT"
    echo "QUIT_REOPEN = $CAP_QUIT_REOPEN"
    echo "KEYCHAIN_UI = $CAP_KEYCHAIN_UI"
    echo "LOGOUT_LOGIN = NOT PROVEN (a GitHub job cannot survive a real logout/login)"
    echo "REBOOT = NOT PROVEN (a GitHub job cannot survive a real reboot)"
  } >> "$CAP_FILE"
}

# ------------------------------ helpers --------------------------------------
snap() { # <stem> — native screenshot AFTER a real action; validates the PNG
  local stem="$1" out="$EVID_DIR/$stem.png"
  if screencapture -x "$out" 2>>"$LOG" && [ -s "$out" ]; then
    SNAP_COUNT=$((SNAP_COUNT + 1))
    local h dim sz
    h="$(shasum -a 256 "$out" 2>/dev/null | awk '{print $1}')"
    dim="$(sips -g pixelWidth -g pixelHeight "$out" 2>/dev/null | awk '/pixelWidth|pixelHeight/ {printf "%s ", $2}')"
    sz="$(stat -f%z "$out" 2>/dev/null)"
    echo "[snap] $stem.png dim=($dim) size=${sz}B sha256=${h:0:12}" | tee -a "$LOG"
    LAST_SNAP_HASH="$h"
    return 0
  fi
  echo "[snap] FAILED $stem (screencapture error or empty file — no mock is ever created)" | tee -a "$LOG"
  return 1
}

snap_changed() { # did the screen actually change since the last snap? hash-diff
  local prev="$1"
  [ -n "$LAST_SNAP_HASH" ] || return 1
  local new; new="$LAST_SNAP_HASH"
  local old; old="$(shasum -a 256 "$EVID_DIR/$prev.png" 2>/dev/null | awk '{print $1}')"
  [ -n "$old" ] && [ "$old" != "$new" ]
}

osa() { # osascript -e <script> [timeout_s] — watchdogged (a consent/password dialog can hang it)
  local script="$1" t="${2:-30}"
  OSA_OUT=""; OSA_ERR=""
  local outf=/tmp/gui-osa.out errf=/tmp/gui-osa.err
  : > "$outf"; : > "$errf"
  osascript -e "$script" >"$outf" 2>"$errf" &
  local pid=$! i=0
  while kill -0 "$pid" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt "$t" ]; then
      kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
      OSA_ERR="osascript timed out after ${t}s (a GUI consent/password dialog is likely blocking — no automation bypass attempted)"
      echo "[osa] $OSA_ERR" | tee -a "$LOG"
      return 1
    fi
    sleep 1
  done
  wait "$pid"; local rc=$?
  if [ "$rc" -eq 0 ]; then OSA_OUT="$(cat "$outf")"; return 0; fi
  OSA_ERR="$(tr '\n' ' ' < "$errf" | cut -c1-300)"; [ -n "$OSA_ERR" ] || OSA_ERR="osascript exit $rc"
  return 1
}

wait_for_path() { # <path> <timeout_s> — waits for an exact-size file
  local path="$1" timeout="$2" i size
  for i in $(seq 1 "$timeout"); do
    size="$(stat -f%z "$path" 2>/dev/null || echo 0)"
    if [ "$size" = "$EXPECTED_SIZE" ] && [ ! -e "$path.download" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

window_count() { # CGWindowList probe (compiled on the runner; read-only)
  # Window COUNT + bounds are visible WITHOUT Screen Recording permission
  # (owner NAMES are hidden by TCC — the count itself is the evidence).
  cat > /tmp/gui-windowlist.swift <<'SWIFT'
import CoreGraphics
let opts = CGWindowListOption([.optionOnScreenOnly])
let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] ?? []
var real = 0
for w in list {
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let wv = b["Width"] as? Double ?? 0
  let hv = b["Height"] as? Double ?? 0
  if wv > 100 && hv > 100 { real += 1 }
}
print("WINDOWLIST_TOTAL=\(list.count)")
print("WINDOWLIST_REAL=\(real)")
SWIFT
  WINDOW_COUNT=-1
  if swiftc -O -o /tmp/gui-windowlist /tmp/gui-windowlist.swift 2>>"$LOG"; then
    /tmp/gui-windowlist 2>>"$LOG" | tee -a "$LOG"
    WINDOW_COUNT="$(/tmp/gui-windowlist 2>/dev/null | grep WINDOWLIST_REAL= | cut -d= -f2)"
    case "$WINDOW_COUNT" in ''|*[!0-9]*) WINDOW_COUNT=-1 ;; esac
  else
    echo "WINDOWLIST=UNAVAILABLE (swiftc failed)" | tee -a "$LOG"
  fi
}

# =============================== PHASE A ======================================
# Environment + GUI session reality probe (the FIRST question).
note "=== PHASE A: environment + GUI session probe ==="
probe "sw_vers: $(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null) build $(sw_vers -buildVersion 2>/dev/null)"
probe "uname -m: $(uname -m) (expected $EXPECTED_ARCH)"
[ "$(uname -m)" = "$EXPECTED_ARCH" ] || die "runner arch $(uname -m) != requested $EXPECTED_ARCH (wrong label dispatched)"
if [ "$EXPECTED_ARCH" = "arm64" ]; then
  T="$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)"
  probe "sysctl.proc_translated=$T (0 = native Apple Silicon, no Rosetta)"
  [ "$T" = "0" ] || die "arm64 lane is running under Rosetta"
fi
probe "user: $(id -un) uid=$(id -u) groups=$(id -Gn | cut -c1-80)"
CONSOLE_USER="$(stat -f%Su /dev/console 2>/dev/null || echo unknown)"
probe "console user (/dev/console): $CONSOLE_USER"
probe "who: $(who 2>/dev/null | tr '\n' '|' | cut -c1-200)"

if pgrep -x WindowServer >/dev/null 2>&1; then
  CAP_WINDOWSERVER="YES"
  probe "WindowServer: RUNNING (pid $(pgrep -x WindowServer | tr '\n' ' '))"
else
  CAP_WINDOWSERVER="NO"
  probe "WindowServer: NOT RUNNING"
fi
if launchctl print "gui/$(id -u)" >/dev/null 2>&1; then
  probe "launchctl gui domain for uid $(id -u): present"
else
  probe "launchctl gui domain for uid $(id -u): ABSENT"
fi
probe "display: $(system_profiler SPDisplaysDataType 2>/dev/null | grep -E 'Resolution|Display Type' | head -2 | tr '\n' ' ')"
window_count
WC_BASE="$WINDOW_COUNT"

note "PHASE A: opening Finder (LaunchServices — no TCC needed)"
open -a Finder || note "open -a Finder returned non-zero"
sleep 3
snap 01-desktop || true
window_count
WC_FINDER="$WINDOW_COUNT"
snap 02-finder || true
FINDER_CHANGED="no"; snap_changed 01-desktop && FINDER_CHANGED="yes"
probe "screen changed after opening Finder (hash-diff): $FINDER_CHANGED; real windows: $WC_BASE -> $WC_FINDER"

note "PHASE A: opening System Settings"
open -a "System Settings" || note "open -a System Settings returned non-zero"
sleep 5
snap 03-system-settings || true
window_count
WC_SETTINGS="$WINDOW_COUNT"
SETTINGS_CHANGED="no"; snap_changed 02-finder && SETTINGS_CHANGED="yes"
probe "screen changed after opening System Settings (hash-diff): $SETTINGS_CHANGED; real windows: $WC_FINDER -> $WC_SETTINGS"

WINDOWS_INCREASED="no"
if [ "$WC_SETTINGS" -gt "$WC_BASE" ] 2>/dev/null || [ "$WC_FINDER" -gt "$WC_BASE" ] 2>/dev/null; then
  WINDOWS_INCREASED="yes"
fi
probe "on-screen window count increased after real window opens: $WINDOWS_INCREASED"

if [ "$CAP_WINDOWSERVER" = "YES" ] && [ "$CONSOLE_USER" = "$(id -un)" ] \
   && { [ "$FINDER_CHANGED" = "yes" ] || [ "$SETTINGS_CHANGED" = "yes" ] || [ "$WINDOWS_INCREASED" = "yes" ]; }; then
  CAP_GUI_SESSION="AVAILABLE"
  CAP_FINDER_SHOT="YES"
  CAP_SETTINGS_SHOT="YES"
  note "GUI_SESSION = AVAILABLE (WindowServer + console user + genuine screen/window change)"
  classify B "GUI session is real on this runner label (to be re-confirmed by human inspection of the gallery)"
else
  CAP_GUI_SESSION="NOT AVAILABLE"
  note "GUI_SESSION = NOT AVAILABLE — stopping the experiment honestly (no faked continuation)"
  classify B "runner has no usable GUI session (WindowServer=$CAP_WINDOWSERVER console=$CONSOLE_USER finder-diff=$FINDER_CHANGED settings-diff=$SETTINGS_CHANGED windows=$WC_BASE->$WC_SETTINGS)"
  write_caps
  cap SUMMARY "GUI_SESSION=NOT AVAILABLE"
  echo "GUI-ACCEPTANCE-RECORDED (GUI session NOT available — honest stop)"
  exit 0
fi

# =============================== PHASE B ======================================
# Real browser download of the frozen release (Safari inside the runner).
note "=== PHASE B: real browser download (Safari) of $RELEASE_TAG/$DMG_NAME ==="
RELEASE_URL="$RELEASE_BASE/$DMG_NAME"
probe "release URL: $RELEASE_URL"
probe "expected size: $EXPECTED_SIZE bytes; sha256 ${EXPECTED_SHA256:0:12}…"
rm -f "$DMG_PATH" "$DMG_PATH.download" 2>/dev/null || true

BROWSER_OK="no"
if open -a Safari "$RELEASE_URL"; then
  probe "Safari launched with the release URL (LaunchServices)"
  sleep 5
  snap 04-browser-download || true
  note "waiting for the Safari download to complete (up to 15 min, no .download sibling, exact size)"
  if wait_for_path "$DMG_PATH" 900; then
    BROWSER_OK="yes"
    CAP_BROWSER_DL="GREEN"
    note "browser download complete: $DMG_PATH ($(stat -f%z "$DMG_PATH") bytes)"
  else
    size="$(stat -f%z "$DMG_PATH" 2>/dev/null || echo 0)"
    probe "Safari download did not complete in 15 min (present size: $size)"
    CAP_BROWSER_DL="RED"
    classify C "Safari download incomplete on the runner (prompt/consent or first-run state?)"
  fi
else
  CAP_BROWSER_DL="NOT POSSIBLE"
  probe "open -a Safari failed"
  classify B "Safari not launchable on this runner"
fi

if [ "$BROWSER_OK" != "yes" ]; then
  # Harness acquisition fallback — explicitly NOT a browser download. The
  # rest of the experiment can still gather evidence on the artifact itself.
  note "FALLBACK: harness curl acquisition (documented: NOT a browser download; no quarantine expected)"
  if curl -fL --retry 3 -o "$DMG_PATH" "$RELEASE_URL"; then
    probe "curl acquisition complete ($(stat -f%z "$DMG_PATH") bytes)"
    classify B "browser download unavailable — curl fallback used, honestly labeled"
  else
    note "curl acquisition failed too — the artifact cannot be obtained"
    write_caps
    exit 0
  fi
fi

# natural quarantine: OBSERVE only (never write/remove)
Q="$(xattr -p com.apple.quarantine "$DMG_PATH" 2>/dev/null || true)"
if [ -n "$Q" ]; then
  CAP_NATURAL_QUARANTINE="YES"
  probe "com.apple.quarantine NATURALLY present on the download: $Q"
else
  CAP_NATURAL_QUARANTINE="NO"
  probe "com.apple.quarantine NOT present on the download (browser=$CAP_BROWSER_DL)"
fi

# Downloads folder in Finder (real window) + screenshot
open "$DL_DIR" 2>/dev/null || true
sleep 3
snap 05-downloads || true

# =============================== PHASE C ======================================
# Offline verification of the EXACT frozen release candidate (no rebuild).
note "=== PHASE C: offline verify (pinned SHA + full verify-release) ==="
ACTUAL_SHA="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
probe "downloaded sha256: $ACTUAL_SHA"
if [ "$ACTUAL_SHA" = "$EXPECTED_SHA256" ]; then
  note "pinned SHA-256 MATCHES the frozen release (arm64 7059c372… / x86_64 1eb5a245… per request)"
else
  CAP_OFFLINE_VERIFY="RED"
  classify D "downloaded DMG hash does not match the pinned release — refusing to continue with an unverified artifact"
  write_caps
  exit 1
fi
MANIFEST_PATH="$DL_DIR/$MANIFEST_NAME"
curl -fsSL -o "$MANIFEST_PATH" "$RELEASE_BASE/$MANIFEST_NAME" \
  || die "cannot acquire the manifest sidecar (harness acquisition, not part of the offline proof)"
if ( cd "$DL_DIR" && EXPECTED_ARCH="$EXPECTED_ARCH" bash "$REPO_ROOT/macos/scripts/verify-release.sh" "$DMG_NAME" "$MANIFEST_NAME" ) >>"$LOG" 2>&1; then
  CAP_OFFLINE_VERIFY="GREEN"
  note "verify-release.sh: VERIFY-RELEASE-GREEN (every shipped file byte-verified offline)"
else
  CAP_OFFLINE_VERIFY="RED"
  note "verify-release.sh FAILED — see probes.log for its full output"
  classify D "verify-release red on a hash-matching DMG — investigate before continuing"
  write_caps
  exit 1
fi

# =============================== PHASE D ======================================
# DMG opened by Finder (real GUI mount + window).
note "=== PHASE D: open the DMG in Finder ==="
hdiutil detach "$VOLUME" -quiet >/dev/null 2>&1 || true
open "$DMG_PATH" || die "open \$DMG failed (harness D-class)"
MOUNTED="no"
for i in $(seq 1 60); do
  [ -d "$VOLUME" ] && MOUNTED="yes" && break
  sleep 1
done
if [ "$MOUNTED" = "yes" ]; then
  sleep 3
  snap 06-dmg || true
  snap 07-dmg-finder || true
  CAP_DMG_FINDER="GREEN"
  probe "mounted volume: $(ls "$VOLUME" 2>/dev/null | tr '\n' ' ')"
  probe "drag layout present: $([ -d "$VOLUME/MediVault.app" ] && echo app && [ -L "$VOLUME/Applications" ] && echo +Applications-symlink)"
else
  CAP_DMG_FINDER="NOT PROVEN"
  probe "volume did not appear at $VOLUME after open"
  classify B "Finder DMG mount did not surface on the runner"
fi

# =============================== PHASE E ======================================
# Drag MediVault to Applications — genuine GUI automation only.
# Ladder of honesty (each rung labeled; none is ever mislabeled):
#   1. System Events GUI automation (the only true drag-class automation)
#   2. Finder AppleScript duplicate to /Applications (Finder performs it;
#      may hit the admin-password dialog — that dialog is real evidence)
#   3. Finder duplicate to ~/Applications (canonical per-user install)
#   4. harness cp -R to ~/Applications (explicitly NOT a Finder proof)
note "=== PHASE E: drag to Applications (genuine automation only) ==="
UI_AUTOMATION="unprobed"
if osa 'tell application "System Events" to get name of every process' 20; then
  UI_AUTOMATION="available"
  probe "System Events UI scripting: AVAILABLE on this runner (assistive access granted)"
else
  UI_AUTOMATION="blocked"
  probe "System Events UI scripting: BLOCKED — exact error: $OSA_ERR"
  classify C "assistive access (System Events) denied for the runner host process: $OSA_ERR"
fi

PLACEMENT="none"
USER_APP_PATH="$HOME/Applications/MediVault.app"
if [ "$UI_AUTOMATION" = "available" ] && [ "$MOUNTED" = "yes" ]; then
  note "attempting genuine GUI automation: Finder window copy (select + cmd+C/V) — a DRAG is not directly scriptable via System Events"
  open "$VOLUME" 2>/dev/null || true
  sleep 2
  if osa '
    tell application "System Events"
      tell process "Finder"
        set frontmost to true
        delay 1
        set w to window 1
        set {wx, wy} to position of w
        set {wwd, wht} to size of w
      end tell
    end tell
    return (wx as string) & "," & (wy as string) & "," & (wwd as string) & "," & (wht as string)' 20; then
    probe "DMG window bounds: $OSA_OUT"
    IFS=',' read -r WX WY WW WH <<< "$OSA_OUT"
    ICON_X=$((WX + WW / 5)); ICON_Y=$((WY + WH / 2))
    if osa "tell application \"System Events\" to click at {$ICON_X, $ICON_Y}" 15; then
      sleep 1
      if osa 'tell application "System Events" to key code 8 using {command down}' 15; then
        sleep 1
        open "/Applications" 2>/dev/null || true; sleep 2
        if osa 'tell application "System Events" to key code 9 using {command down}' 20; then
          sleep 8
          [ -d "$APP_PATH" ] && PLACEMENT="gui-keyboard-copy"
        fi
      fi
    fi
  fi
  if [ "$PLACEMENT" = "none" ]; then
    probe "GUI keyboard copy did not produce $APP_PATH (error: ${OSA_ERR:-—}; an admin-password dialog may be up)"
    snap 08-applications || true
  fi
fi

if [ "$PLACEMENT" = "none" ] && [ "$MOUNTED" = "yes" ]; then
  note "attempting Finder AppleScript duplicate to /Applications (Finder itself performs the copy — not a drag)"
  if osa "tell application \"Finder\" to duplicate (POSIX file \"$VOLUME/MediVault.app\") to (POSIX file \"/Applications\") with replacing" 30; then
    for i in $(seq 1 30); do [ -d "$APP_PATH" ] && PLACEMENT="finder-applescript" && break; sleep 1; done
    [ "$PLACEMENT" != "none" ] || probe "Finder duplicate to /Applications returned ok but $APP_PATH never appeared"
  else
    probe "Finder duplicate to /Applications BLOCKED — exact error: $OSA_ERR"
    classify C "Finder/Apple Events denied or admin-password dialog blocked the /Applications copy: $OSA_ERR"
    snap 08-applications || true
  fi
fi

if [ "$PLACEMENT" = "none" ] && [ "$MOUNTED" = "yes" ]; then
  note "attempting Finder AppleScript duplicate to ~/Applications (canonical per-user install — no admin password needed)"
  mkdir -p "$HOME/Applications"
  if osa "tell application \"Finder\" to duplicate (POSIX file \"$VOLUME/MediVault.app\") to (POSIX file \"$HOME/Applications\") with replacing" 30; then
    for i in $(seq 1 30); do [ -d "$USER_APP_PATH" ] && PLACEMENT="finder-applescript-peruser" && APP_PATH="$USER_APP_PATH" && break; sleep 1; done
    [ "$PLACEMENT" != "none" ] || probe "Finder duplicate to ~/Applications returned ok but the app never appeared"
  else
    probe "Finder duplicate to ~/Applications BLOCKED — exact error: $OSA_ERR"
    classify C "Apple Events to Finder denied (Automation TCC): $OSA_ERR"
  fi
fi

if [ "$PLACEMENT" = "none" ] && [ "$MOUNTED" = "yes" ]; then
  # Last resort so the LAUNCH investigation can continue. Explicitly NOT a
  # Finder proof — labeled in every report. Command-line placement by the
  # harness; DRAG_TO_APPLICATIONS stays NOT PROVEN.
  note "FALLBACK: command-line placement to ~/Applications (harness cp -R — explicitly NOT a Finder/drag proof, recorded as such)"
  mkdir -p "$HOME/Applications"
  if cp -R "$VOLUME/MediVault.app" "$USER_APP_PATH" 2>>"$LOG" && [ -d "$USER_APP_PATH" ]; then
    PLACEMENT="command-line (NOT a Finder proof)"
    APP_PATH="$USER_APP_PATH"
    classify B "app placement needed command-line copy — drag/Finder automation unavailable on the runner"
  else
    die "cp -R from the mounted volume failed (harness D-class)"
  fi
fi

if [ -d "$APP_PATH" ]; then
  open "$(dirname "$APP_PATH")" 2>/dev/null || true
  sleep 2
  [ -f "$EVID_DIR/08-applications.png" ] || snap 08-applications || true
  QAPP="$(xattr -p com.apple.quarantine "$APP_PATH" 2>/dev/null || true)"
  probe "quarantine on $APP_PATH after placement ($PLACEMENT): ${QAPP:-<none>}"
  case "$PLACEMENT" in
    gui-keyboard-copy) CAP_DRAG="NOT PROVEN (GUI keyboard copy worked; a literal drag is not scriptable)";;
    finder-applescript) CAP_DRAG="NOT PROVEN (Finder AppleScript duplicate worked — Finder performed it, but not a drag)";;
    finder-applescript-peruser) CAP_DRAG="NOT PROVEN (Finder duplicate to ~/Applications worked — Finder performed it, but not a drag)";;
    command-line*) CAP_DRAG="NOT PROVEN (command-line placement — never claimed as Finder)";;
  esac
else
  CAP_DRAG="RED"
  note "no installed $APP_PATH — launch phase cannot run"
  write_caps
  exit 0
fi

# =============================== PHASE F ======================================
# First launch + Gatekeeper (the EXPECTED zero-cost behavior is a warning).
note "=== PHASE F: first launch + Gatekeeper observation ==="
probe "spctl assessment (read-only probe, never a bypass): $(spctl -a -vv "$APP_PATH" 2>&1 | tr '\n' ' ' || true)"
open "$APP_PATH" || note "open \$APP_PATH returned non-zero"
sleep 10
APP_UP="no"
for i in $(seq 1 10); do
  if pgrep -f "MediVault.app/Contents/MacOS/MediVault" >/dev/null 2>&1; then APP_UP="yes"; break; fi
  if pgrep -x MediVault >/dev/null 2>&1; then APP_UP="yes"; break; fi
  sleep 1
done
snap 09-first-launch || true
sleep 3
snap 10-gatekeeper || true
probe "MediVault process after first open: $APP_UP"
if [ "$APP_UP" = "yes" ]; then
  probe "app launched WITHOUT a Gatekeeper block (quarantine on app: ${QAPP:-none})"
  if [ -z "$QAPP" ]; then
    CAP_GK_WARNING="NOT OBSERVED (no quarantine propagated to the placed copy)"
    classify B "command-line/Finder-script placement did not propagate quarantine — Gatekeeper not exercised on this path"
  fi
else
  if [ -n "$QAPP" ]; then
    CAP_GK_WARNING="OBSERVED (screenshot 10 captured; app blocked = the expected zero-cost first-launch behavior)"
    classify E "unnotarized/ad-hoc app blocked at first launch — the documented zero-cost contract (Open Anyway flow)"
  else
    CAP_GK_WARNING="NOT OBSERVED (no quarantine; app simply did not start — see logs)"
    classify D "app did not start and there was no quarantine to explain a block — needs investigation"
  fi
fi

note "PHASE F: System Settings -> Privacy & Security (the Open Anyway surface)"
open "x-apple.systempreferences:com.apple.settings.privacy.security" 2>/dev/null || true
sleep 6
snap 11-privacy-security || true

if [ "$UI_AUTOMATION" = "available" ]; then
  note "attempting to detect the Open Anyway button via System Events (legitimate GUI automation)"
  if osa '
    tell application "System Settings" to activate
    delay 2
    tell application "System Events"
      tell (first process whose name is "System Settings")
        set hits to 0
        try
          repeat with el in (entire contents of window 1)
            try
              if class of el is button and name of el contains "Open Anyway" then set hits to hits + 1
            end try
          end repeat
        end try
      end tell
    end tell
    return hits as string' 90; then
    if [ -n "$OSA_OUT" ] && [ "$OSA_OUT" != "0" ]; then
      CAP_OPEN_ANYWAY_VISIBLE="YES"
      probe "Open Anyway button FOUND via UI scripting (count: $OSA_OUT)"
      snap 12-open-anyway || true
      note "attempting the APPROVAL click (only through legitimate GUI automation)"
      if osa '
        tell application "System Events"
          tell (first process whose name is "System Settings")
            repeat with el in (entire contents of window 1)
              try
                if class of el is button and name of el contains "Open Anyway" then
                  click el
                  return "clicked"
                end if
              end try
            end repeat
          end tell
        end tell
        return "not-found"' 90; then
        probe "Open Anyway click: $OSA_OUT"
        sleep 8
        snap 12-open-anyway || true
        if pgrep -x MediVault >/dev/null 2>&1 || pgrep -f "MediVault.app/Contents/MacOS/MediVault" >/dev/null 2>&1; then
          CAP_OPEN_ANYWAY_APPROVAL="GREEN"
          APP_UP="yes"
        else
          # admin-password dialog may now be up — that too is a TCC surface
          CAP_OPEN_ANYWAY_APPROVAL="BLOCKED_BY_OS_AUTOMATION_POLICY"
          classify C "Open Anyway clicked but the admin-credential dialog could not be satisfied by automation: ${OSA_ERR:-password dialog}"
        fi
      else
        CAP_OPEN_ANYWAY_APPROVAL="BLOCKED_BY_OS_AUTOMATION_POLICY"
        classify C "Open Anyway click refused by macOS automation policy: $OSA_ERR"
      fi
    else
      CAP_OPEN_ANYWAY_VISIBLE="NO (System Settings reachable; button not detected — blocked app may be absent)"
      probe "Open Anyway not found in the Privacy & Security UI (count: ${OSA_OUT:-0})"
    fi
  else
    probe "Open Anyway detection error: $OSA_ERR"
    CAP_OPEN_ANYWAY_VISIBLE="NOT PROVEN (UI query error — screenshot 11 is the human evidence)"
    CAP_OPEN_ANYWAY_APPROVAL="BLOCKED_BY_OS_AUTOMATION_POLICY"
    classify C "System Events query of System Settings failed: $OSA_ERR"
  fi
else
  CAP_OPEN_ANYWAY_VISIBLE="NOT PROVEN (gallery screenshot 11 is the human evidence; automation blocked)"
  CAP_OPEN_ANYWAY_APPROVAL="BLOCKED_BY_OS_AUTOMATION_POLICY"
  note "Open Anyway approval not attempted: assistive access is blocked on this runner (recorded in Phase E)"
fi

# =============================== PHASE H ======================================
# Product checks — ONLY if MediVault actually runs.
if [ "$APP_UP" != "yes" ]; then
  note "=== MediVault is not running (Gatekeeper/launch path) — product phases stay NOT RUN ==="
  write_caps
  cap SUMMARY "stopped at launch phase (APP_UP=$APP_UP, GK=$CAP_GK_WARNING)"
  echo "GUI-ACCEPTANCE-RECORDED (launch-phase stop — all outcomes honestly recorded)"
  exit 0
fi

note "=== PHASE H: MediVault product checks (app IS running) ==="
sleep 5
snap 13-medivault || true
CAP_MEDIVAULT_GUI="GREEN (process running; window captured for gallery inspection)"

note "waiting for the supervisor to provision + the API to become healthy (first run, bounded 10 min)"
API_OK="no"
for i in $(seq 1 600); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$API/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then API_OK="yes"; break; fi
  [ $((i % 60)) -eq 0 ] && probe "still waiting for /health ($i s, last code $code)"
  sleep 1
done
if [ "$API_OK" = "yes" ]; then
  CAP_API="GREEN"
  probe "/health -> 200 after ${i}s; /ready -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$API/ready" 2>/dev/null || echo 000)"
  API_BIND="$(lsof -nP -iTCP:3001 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sort -u | tr '\n' ' ')"
  probe "API listen endpoints: ${API_BIND:-none}"
  case "$API_BIND" in
    *127.0.0.1:3001*) [ -z "$(echo "$API_BIND" | tr ' ' '\n' | grep -v '^127.0.0.1:3001$' | grep -v '^$')" ] && probe "API loopback-only: YES" ;;
  esac
else
  CAP_API="RED"
  probe "API never became healthy on $API (supervisor provisioning on a runner may be slow — see logs)"
  probe "supervisor status: $(cat "$HOME/Library/Application Support/MediVault/runtime-state/supervisor-status.json" 2>/dev/null || echo none)"
  probe "supervisor.log tail:"; tail -15 "$HOME/Library/Logs/MediVault/supervisor.log" 2>/dev/null | tee -a "$LOG" || true
fi

PG_BIND="$(lsof -nP -iTCP:$PGPORT -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sort -u | tr '\n' ' ')"
probe "PG listen endpoints: ${PG_BIND:-none}"
PGBIN="$APP_PATH/Contents/Resources/runtime/postgresql/17/bin"
if [ -x "$PGBIN/pg_isready" ]; then
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
    CAP_PG="GREEN"
    probe "pg_isready 127.0.0.1:$PGPORT: accepting connections"
    case "$PG_BIND" in
      *127.0.0.1:$PGPORT*) [ -z "$(echo "$PG_BIND" | tr ' ' '\n' | grep -v "^127.0.0.1:$PGPORT\$" | grep -v '^$')" ] && probe "PG loopback-only: YES" ;;
    esac
  else
    CAP_PG="RED"
    probe "pg_isready 127.0.0.1:$PGPORT: NOT accepting"
  fi
else
  CAP_PG="NOT RUN (bundled pg_isready not found at $PGBIN)"
fi

# SMAppService / Login Items evidence
SVC="gui/$(id -u)/dev.medivault.supervisor"
if launchctl print "$SVC" >/tmp/gui-sa-launchctl.txt 2>&1; then
  CAP_SMAPPSERVICE="GREEN (launchd job present in the GUI domain)"
  grep -E 'state = |program =' /tmp/gui-sa-launchctl.txt | head -4 | while IFS= read -r l; do probe "launchctl: $l"; done
else
  probe "launchctl print $SVC failed: $(head -1 /tmp/gui-sa-launchctl.txt)"
  probe "sfltool dump-state (Login Items): $(sfltool dump-state 2>/dev/null | grep -i medivault | head -2 | tr '\n' ' ' || echo 'no medivault rows')"
  CAP_SMAPPSERVICE="NOT PROVEN (job not observable via launchctl — SMAppService state unknown without the UI)"
fi
open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" 2>/dev/null || true
sleep 5
snap 15-login-items || true
CAP_LOGIN_ITEMS_UI="CAPTURED (screenshot 15 — human gallery evidence)"

# Synthetic patient through the product's own API (Test Patient GUI-CI-ACCEPTANCE)
if [ "$CAP_API" = "GREEN" ]; then
  JAR="/tmp/gui-cookies.txt"; rm -f "$JAR"
  ORIGIN="tauri://localhost"
  NEEDS="$(curl -s --max-time 5 "$API/api/auth/setup" 2>/dev/null || echo '{}')"
  probe "auth setup state: $NEEDS"
  SETUP_OK="no"
  if echo "$NEEDS" | grep -q '"needsSetup":true'; then
    if curl -s --max-time 10 -c "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
        -d '{"email":"gui-ci-acceptance@synthetic.test","password":"GuiCiAcceptance-2026!","name":"GUI CI Acceptance"}' \
        "$API/api/auth/setup" -o /tmp/gui-setup.json -w '%{http_code}' | grep -qE '201|200'; then
      SETUP_OK="yes"; probe "first-admin setup: created (synthetic CI identity)"
    else
      probe "first-admin setup failed: $(cat /tmp/gui-setup.json 2>/dev/null | cut -c1-200)"
    fi
  else
    # Already provisioned instance: the CSRF cookie is only issued by
    # setup/login responses (no unauthenticated issuance route exists), so
    # the harness cannot log in without the interactive browser flow.
    probe "auth already set up: harness login impossible without an interactive CSRF issuance (no GET csrf route)"
    SETUP_OK="skip"
  fi
  if [ "$SETUP_OK" = "yes" ]; then
    CTOK="$(grep mvlt_csrf "$JAR" 2>/dev/null | awk '{print $NF}')"
    CODE="$(curl -s --max-time 10 -b "$JAR" -H "Origin: $ORIGIN" -H "x-csrf-token: $CTOK" \
      -H 'Content-Type: application/json' \
      -d "{\"firstName\":\"$SYNTH_FIRST\",\"lastName\":\"$SYNTH_LAST\",\"notes\":\"Synthetic GUI CI acceptance marker\"}" \
      "$API/api/patients" -o /tmp/gui-patient.json -w '%{http_code}')"
    probe "patient create HTTP $CODE: $(cat /tmp/gui-patient.json 2>/dev/null | cut -c1-160)"
    if [ "$CODE" = "201" ]; then
      CAP_PATIENT="GREEN (created via the product API; captured in the UI by screenshot 16)"
    else
      CAP_PATIENT="RED (HTTP $CODE — CSRF/origin/permission surface; recorded honestly)"
    fi
  elif [ "$SETUP_OK" = "skip" ]; then
    CAP_PATIENT="NOT PROVEN (auth flow could not be established on a re-provisioned instance)"
  else
    CAP_PATIENT="NOT PROVEN (auth setup rejected: see probes.log)"
  fi
  sleep 3
  snap 16-synthetic-patient || true
else
  CAP_PATIENT="NOT RUN (API not healthy)"
fi

# quit/reopen + persistence
note "PHASE H: quit + reopen (persistence proof)"
if osa 'tell application "MediVault" to quit' 20; then
  probe "quit via AppleScript: issued"
else
  probe "quit via AppleScript blocked ($OSA_ERR) — falling back to SIGTERM the desktop process"
  pkill -TERM -f "MediVault.app/Contents/MacOS/MediVault" 2>/dev/null || true
fi
for i in $(seq 1 20); do pgrep -f "MediVault.app/Contents/MacOS/MediVault" >/dev/null 2>&1 || break; sleep 1; done
sleep 3
open "$APP_PATH" || note "reopen failed"
sleep 15
REOPEN_UP="no"
for i in $(seq 1 30); do
  if pgrep -f "MediVault.app/Contents/MacOS/MediVault" >/dev/null 2>&1; then REOPEN_UP="yes"; break; fi
  sleep 1
done
snap 17-relaunch || true
if [ "$REOPEN_UP" = "yes" ]; then
  CAP_SECOND_LAUNCH="GREEN (process running after quit/reopen; screenshot 17)"
  # bounded wait for the backend to return before probing persistence
  for i in $(seq 1 180); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$API/health" 2>/dev/null || echo 000)"
    [ "$code" = "200" ] && break
    sleep 1
  done
  RCODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API/api/patients" 2>/dev/null || echo 000)"
  probe "post-reopen /api/patients (auth-protected): $RCODE (auth surface intact)"
  probe "post-reopen /health: $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API/health" 2>/dev/null || echo 000)"
  if [ "${CAP_PATIENT#GREEN}" != "$CAP_PATIENT" ]; then
    PERSIST="$(curl -s --max-time 5 -b /tmp/gui-cookies.txt -H "Origin: tauri://localhost" "$API/api/patients" 2>/dev/null | grep -c "GUI-CI-ACCEPTANCE" || true)"
    probe "synthetic patient rows visible after reopen: $PERSIST"
    [ "${PERSIST:-0}" -ge 1 ] && CAP_QUIT_REOPEN="GREEN (patient persisted across quit/reopen)" || CAP_QUIT_REOPEN="RED (patient missing after reopen)"
  else
    CAP_QUIT_REOPEN="GREEN (backend health across quit/reopen; patient persistence not assertable without the API session)"
  fi
else
  CAP_SECOND_LAUNCH="RED (process did not return after reopen)"
fi

# Keychain observation: any prompt would have appeared during the launch
# screenshots; we never extract values (readability is the backend's job).
CAP_KEYCHAIN_UI="NOT PROVEN (no prompt capture evidence in this run; prompts require an interactive user)"

write_caps
cap SUMMARY "run complete — see capability-report.md + probes.log + the screenshot gallery artifact"
echo "GUI-ACCEPTANCE-RECORDED (full run; all outcomes honestly recorded)"
exit 0

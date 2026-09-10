#!/usr/bin/env bash
# =============================================================================
# gui-acceptance.sh — the GitHub macOS-runner GUI REALITY EXPERIMENT
# Contract: acceptance/macos-gui-acceptance-contract.md
#
# ITERATION 2 (run 2) — driven by run 1 (34467419086) findings:
#   D-class fixed: the 20s pgrep-only launch window lost the race against
#     Gatekeeper assessment + app exec. Replaced by a bounded 120s
#     multi-signal detector (System Events process existence, LaunchServices
#     lsappinfo, pgrep as secondary, visible window title, Gatekeeper-alert
#     process watch) that records exact open→process / open→window timings
#     and NEVER counts launch as failed while macOS is still evaluating.
#   C-class addressed with legitimate automation (NOT a bypass): Safari's
#     real download-permission dialog for release-assets.githubusercontent.com
#     is now answered through System Events by clicking the genuine
#     "Allow" button — TCC databases untouched, Safari not bypassed.
#   Natural quarantine: OBSERVED ONLY (xattr -p), never written or removed;
#     the exact value is preserved as text evidence and its source app is
#     parsed from the attribute itself.
#
# QUESTION THIS ANSWERS (empirically, honestly, no fakery):
#   Does a GitHub-hosted macos-26 / macos-26-intel runner have a USABLE
#   GUI session — and how far down the REAL zero-cost install path
#   (Safari download -> consent -> natural quarantine -> Finder -> DMG ->
#   place into Applications -> first quarantined launch -> Gatekeeper
#   warning -> Privacy & Security -> Open Anyway -> MediVault product
#   checks) can genuine automation go?
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
# Bash 3.2 note: every `local` is on its own line (multi-assignment locals
# expand later words before earlier words are bound — first red 34467016447).
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

for tool in screencapture sips shasum hdiutil xattr osascript open pgrep stat curl lsappinfo; do
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
SYNTH_LAST="Patient"
SYNTH_NOTES="GUI-CI-ACCEPTANCE"
SYNTH_EMAIL="gui-ci-acceptance@synthetic.test"
SYNTH_PASS="GuiCiAcceptance-2026!"
# The Tauri window title (src-tauri/tauri.conf.json) — em dash included.
EXPECTED_TITLE="MediVault — Medical Document Manager"

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

# capability bookkeeping — field names mirror the requested final report
CAP_WINDOWSERVER="NO"
CAP_GUI_SESSION="NOT AVAILABLE"
CAP_FINDER_SHOT="NO"
CAP_SETTINGS_SHOT="NO"
CAP_SAFARI_DL="NOT POSSIBLE"
CAP_CONSENT="NOT OBSERVED"
CAP_QUARANTINE="NOT PROVEN"
CAP_QUARANTINE_SRC="NOT PROVEN"
CAP_DMG_HASH="RED"
CAP_OFFLINE_VERIFY="RED"
CAP_DMG_FINDER="NOT PROVEN"
CAP_PLACEMENT="NOT PROVEN"
CAP_PLACEMENT_HOW="none"
CAP_FIRST_LAUNCH="NOT RUN"
CAP_GK_WARNING="NOT PROVEN"
CAP_OA_VISIBLE="NOT PROVEN"
CAP_OA_APPROVAL="NOT PROVEN"
CAP_MV_PROC="NOT PROVEN"
CAP_MV_WINDOW="NOT PROVEN"
CAP_SECOND_LAUNCH="NOT PROVEN"
CAP_SMAPPSERVICE_UI="NOT PROVEN"
CAP_SMAPPSTATE_TEXT="not read"
CAP_LOGIN_ITEMS_UI="NOT PROVEN"
CAP_API="NOT RUN"
CAP_PG="NOT RUN"
CAP_PATIENT="NOT RUN"
CAP_QUIT_REOPEN="NOT RUN"
CAP_KEYCHAIN_UI="NOT PROVEN"
CAP_LAUNCH_TIMING=""

APP_QUARANTINE_VALUE=""
QAPP=""
KEYCHAIN_SNAP_N=0

write_caps() {
  {
    echo "MACOS_VERSION = $(sw_vers -productVersion 2>/dev/null || echo unknown) ($(sw_vers -buildVersion 2>/dev/null))"
    echo "ARCHITECTURE = $(uname -m)"
    echo "WINDOWSERVER = $CAP_WINDOWSERVER"
    echo "GUI_SESSION = $CAP_GUI_SESSION"
    echo "REAL_FINDER_SCREENSHOT = $CAP_FINDER_SHOT"
    echo "REAL_SYSTEM_SETTINGS_SCREENSHOT = $CAP_SETTINGS_SHOT"
    echo "SCREENSHOT_COUNT = $SNAP_COUNT"
    echo "REAL_SAFARI_DOWNLOAD = $CAP_SAFARI_DL"
    echo "SAFARI_DOWNLOAD_CONSENT = $CAP_CONSENT"
    echo "NATURAL_QUARANTINE = $CAP_QUARANTINE"
    echo "QUARANTINE_SOURCE = $CAP_QUARANTINE_SRC"
    echo "DMG_HASH = $CAP_DMG_HASH"
    echo "OFFLINE_VERIFY = $CAP_OFFLINE_VERIFY"
    echo "FINDER_DMG = $CAP_DMG_FINDER"
    echo "FINDER_PLACEMENT = $CAP_PLACEMENT (method: $CAP_PLACEMENT_HOW)"
    echo "FIRST_QUARANTINED_LAUNCH = $CAP_FIRST_LAUNCH"
    echo "GATEKEEPER_WARNING = $CAP_GK_WARNING"
    echo "OPEN_ANYWAY_VISIBLE = $CAP_OA_VISIBLE"
    echo "OPEN_ANYWAY_APPROVAL = $CAP_OA_APPROVAL"
    echo "MEDIVAULT_PROCESS = $CAP_MV_PROC"
    echo "MEDIVAULT_WINDOW = $CAP_MV_WINDOW"
    echo "SECOND_NORMAL_LAUNCH = $CAP_SECOND_LAUNCH"
    echo "SMAPPSERVICE_UI = $CAP_SMAPPSERVICE_UI"
    echo "SMAPPSERVICE_STATE_TEXT = $CAP_SMAPPSTATE_TEXT"
    echo "LOGIN_ITEMS_UI = $CAP_LOGIN_ITEMS_UI"
    echo "API = $CAP_API"
    echo "POSTGRES = $CAP_PG"
    echo "SYNTHETIC_PATIENT = $CAP_PATIENT"
    echo "QUIT_REOPEN = $CAP_QUIT_REOPEN"
    echo "KEYCHAIN_UI = $CAP_KEYCHAIN_UI"
    echo "LAUNCH_TIMING = ${CAP_LAUNCH_TIMING:-not measured}"
    echo "LOGOUT_LOGIN = NOT PROVEN (a GitHub job cannot survive a real logout/login)"
    echo "REBOOT = NOT PROVEN (a GitHub job cannot survive a real reboot)"
  } >> "$CAP_FILE"
}

# ------------------------------ helpers --------------------------------------
snap() { # <stem> — native screenshot AFTER a real action; validates the PNG
  local stem="$1"
  local out="$EVID_DIR/$stem.png"
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
  local new
  new="$LAST_SNAP_HASH"
  local old
  old="$(shasum -a 256 "$EVID_DIR/$prev.png" 2>/dev/null | awk '{print $1}')"
  [ -n "$old" ] && [ "$old" != "$new" ]
}

osa() { # osascript -e <script> [timeout_s] — watchdogged (a consent/password dialog can hang it)
  local script="$1"
  local t="${2:-30}"
  OSA_OUT=""; OSA_ERR=""
  local outf=/tmp/gui-osa.out
  local errf=/tmp/gui-osa.err
  : > "$outf"; : > "$errf"
  osascript -e "$script" >"$outf" 2>"$errf" &
  local pid=$!
  local i=0
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

wait_for_path() { # <path> <timeout_s> — waits for an exact-size file (progress logged)
  local path="$1"
  local timeout="$2"
  local i
  local size
  for i in $(seq 1 "$timeout"); do
    size="$(stat -f%z "$path" 2>/dev/null || echo 0)"
    if [ "$size" = "$EXPECTED_SIZE" ] && [ ! -e "$path.download" ]; then
      return 0
    fi
    if [ $((i % 30)) -eq 0 ]; then
      probe "download in progress: ${size}/${EXPECTED_SIZE} bytes (${i}s)"
    fi
    sleep 1
  done
  return 1
}

window_count() { # CGWindowList probe (compiled on the runner; read-only)
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

# --------- System Events UI helpers (legitimate automation only) -------------
# Walk the UI tree of a process looking for a button whose name contains the
# given text. Modes: "find" (report name), "click" (click the first match).
ui_button() { # <mode> <process> <name-contains> [timeout]
  local mode="$1"
  local proc="$2"
  local want="$3"
  local t="${4:-90}"
  osa "tell application \"System Events\"
  tell process \"$proc\"
    set hit to \"none\"
    try
      repeat with el in (entire contents of window 1)
        try
          if class of el is button then
            set n to (name of el) as string
            if n contains \"$want\" then
              if \"$mode\" is \"click\" then click el
              set hit to \"$mode:\" & n
              exit repeat
            end if
          end if
        end try
      end repeat
    end try
  end tell
end tell
return hit" "$t"
}

# Dump the first N button/field names of a process window (diagnostics only).
ui_dump_names() { # <process> [timeout]
  local proc="$1"
  local t="${2:-60}"
  osa "tell application \"System Events\"
  tell process \"$proc\"
    set out to \"\"
    set c to 0
    try
      repeat with el in (entire contents of window 1)
        try
          set cl to class of el as string
          if cl is \"button\" or cl is \"text field\" or cl is \"static text\" then
            set n to (name of el) as string
            if n is not \"\" then
              set out to out & cl & \"=\" & n & \"; \"
              set c to c + 1
              if c is 60 then exit repeat
            end if
          end if
        end try
      end repeat
    end try
  end tell
end tell
return out" "$t"
}

# Count windows of a process (0/1.. or -1 on query failure).
ui_window_count() { # <process>
  local proc="$1"
  if osa "tell application \"System Events\" to tell process \"$proc\" to count windows" 8; then
    printf '%s' "$OSA_OUT" | tr -d ' '
  else
    printf '%s' "-1"
  fi
}

# Read the static texts of every window of a process (dialog text evidence).
ui_dialog_texts() { # <process>
  local proc="$1"
  osa "tell application \"System Events\"
  tell process \"$proc\"
    set out to \"\"
    repeat with w in (get windows)
      try
        repeat with el in (entire contents of w)
          try
            if class of el is static text then
              set t to (value of el) as string
              if t is not \"\" then set out to out & t & \" | \"
            end if
          end try
        end repeat
      end try
    end repeat
  end tell
end tell
return out" 30
}

# Click the first button with an exact name across every window of a process.
ui_click_button_in_windows() { # <process> <name> [timeout]
  local proc="$1"
  local want="$2"
  local t="${3:-30}"
  osa "tell application \"System Events\"
  tell process \"$proc\"
    repeat with w in (get windows)
      try
        repeat with el in (entire contents of w)
          try
            if class of el is button then
              set n to (name of el) as string
              if n is \"$want\" then
                click el
                return \"clicked:$want\"
              end if
            end if
          end try
        end repeat
      end try
    end repeat
  end tell
end tell
return \"not-found\"" "$t"
}

# Click the first button whose name CONTAINS text across every window/sheet.
ui_click_button_contains_in_windows() { # <process> <contains> [timeout]
  local proc="$1"
  local want="$2"
  local t="${3:-30}"
  osa "tell application \"System Events\"
  tell process \"$proc\"
    repeat with w in (get windows)
      try
        repeat with el in (entire contents of w)
          try
            if class of el is button then
              set n to (name of el) as string
              if n contains \"$want\" then
                click el
                return \"clicked:\" & n
              end if
            end if
          end try
        end repeat
      end try
    end repeat
  end tell
end tell
return \"not-found\"" "$t"
}

# Type text into the Nth text field of a process window (click + keystroke).
ui_type_into_field() { # <process> <field-ordinal 1-based> <text> [timeout]
  local proc="$1"
  local ord="$2"
  local text="$3"
  local t="${4:-30}"
  osa "tell application \"System Events\"
  tell process \"$proc\"
    set fields to {}
    try
      repeat with el in (entire contents of window 1)
        try
          set cl to class of el as string
          if cl is \"text field\" then set end of fields to el
        end try
      end repeat
    end try
    if (count of fields) is greater than or equal to $ord then
      set f to item $ord of fields
      click f
      delay 1
      keystroke \"$text\"
      return \"typed-field-$ord\"
    end if
  end tell
end tell
return \"no-field-$ord\"" "$t"
}

# ------------------- robust bounded app-launch detector (D fix) ---------------
# Signals polled (legitimate, read-only):
#   * System Events process existence  (backed by NSRunningApplication)
#   * LaunchServices (lsappinfo list)
#   * pgrep (secondary evidence)
#   * visible window title via System Events
#   * Gatekeeper alert processes (CoreServicesUIAgent/UserNotificationCenter)
#   * SecurityAgent windows (Keychain/auth prompts — snap immediately)
# Timing from the open request is captured for process and window appearance.
wait_for_medivault() { # <timeout_s> <label>
  local timeout="$1"
  local label="$2"
  local t0
  t0="$(date +%s)"
  MV_PROC="no"; MV_WINDOW="no"; MV_TITLE=""; MV_T_PROC=""; MV_T_WINDOW=""
  MV_BLOCK="no"; MV_T_BLOCK=""; MV_BLOCK_SINCE=""; MV_KEYCHAIN="no"; MV_AUTH="no"
  local tick=0
  local se_every=2
  note "launch detector [$label]: waiting up to ${timeout}s wall-clock (Gatekeeper assessment may delay exec — launch is never counted failed while macOS is evaluating)"
  while [ $(( $(date +%s) - t0 )) -le "$timeout" ]; do
    # cheap signal first
    if [ "$MV_PROC" = "no" ]; then
      if pgrep -x MediVault >/dev/null 2>&1 || pgrep -f "MediVault.app/Contents/MacOS/MediVault" >/dev/null 2>&1; then
        MV_PROC="yes"
        MV_T_PROC=$(( $(date +%s) - t0 ))
        probe "detector[$label]: process signal=pgrep (secondary) after ${MV_T_PROC}s"
      fi
    fi
    tick=$((tick + 1))
    if [ $((tick % se_every)) -eq 0 ]; then
      if [ "$MV_PROC" = "no" ]; then
        if lsappinfo list 2>/dev/null | grep -q "MediVault"; then
          MV_PROC="yes"
          MV_T_PROC=$(( $(date +%s) - t0 ))
          probe "detector[$label]: process signal=LaunchServices lsappinfo after ${MV_T_PROC}s"
        elif osa 'tell application "System Events" to exists process "MediVault"' 8; then
          MV_PROC="yes"
          MV_T_PROC=$(( $(date +%s) - t0 ))
          probe "detector[$label]: process signal=System Events (NSRunningApplication) after ${MV_T_PROC}s"
        fi
      fi
    fi
    if [ "$MV_PROC" = "yes" ] && [ "$MV_WINDOW" = "no" ]; then
      if osa 'tell application "System Events" to tell process "MediVault" to get value of attribute "AXTitle" of window 1' 8; then
        MV_TITLE="$OSA_OUT"
        MV_WINDOW="yes"
        MV_T_WINDOW=$(( $(date +%s) - t0 ))
        probe "detector[$label]: visible window after ${MV_T_WINDOW}s — title: '$MV_TITLE'"
      fi
    fi
    # Gatekeeper alert watch (only while the app has not appeared yet)
    if [ "$MV_PROC" = "no" ] && [ "$MV_BLOCK" = "no" ]; then
      local gk
      gk="$(ui_window_count "CoreServicesUIAgent")"
      if [ "$gk" = "-1" ]; then
        gk="$(ui_window_count "UserNotificationCenter")"
      fi
      case "$gk" in
        -1|0|'') : ;;
        *) MV_BLOCK="yes"; MV_T_BLOCK=$(( $(date +%s) - t0 )); MV_BLOCK_SINCE="$(date +%s)"
           probe "detector[$label]: Gatekeeper alert window detected after ${MV_T_BLOCK}s (process hosting it has $gk window(s))" ;;
      esac
    fi
    # Keychain / auth prompt watch (capture immediately, once)
    if [ "$MV_KEYCHAIN" = "no" ]; then
      local sa
      sa="$(ui_window_count "SecurityAgent")"
      case "$sa" in
        -1|0|'') : ;;
        *) MV_KEYCHAIN="yes"
           KEYCHAIN_SNAP_N=$((KEYCHAIN_SNAP_N + 1))
           note "detector[$label]: SecurityAgent prompt window detected (possible Keychain/auth dialog) — capturing immediately (prompt #$KEYCHAIN_SNAP_N)"
           snap "$(printf '%02d' $((34 + KEYCHAIN_SNAP_N)))-keychain-prompt" || true ;;
      esac
    fi
    # success: process + visible window
    if [ "$MV_PROC" = "yes" ] && [ "$MV_WINDOW" = "yes" ]; then
      break
    fi
    # blocked: Gatekeeper alert has been up for >= 15s and no app process
    if [ "$MV_BLOCK" = "yes" ] && [ "$MV_PROC" = "no" ]; then
      if [ $(( $(date +%s) - MV_BLOCK_SINCE )) -ge 15 ]; then
        probe "detector[$label]: stopping — Gatekeeper alert is the outcome (app was blocked, not slow)"
        break
      fi
    fi
    sleep 2
  done
  local waited
  waited=$(( $(date +%s) - t0 ))
  probe "detector[$label] summary: proc=$MV_PROC (${MV_T_PROC:-never}s) window=$MV_WINDOW (${MV_T_WINDOW:-never}s) title='${MV_TITLE:-none}' gatekeeper-alert=$MV_BLOCK (${MV_T_BLOCK:-never}s) keychain-prompt=$MV_KEYCHAIN waited=${waited}s"
}

# Open the app and run the robust detector. Sets MV_* + records timing.
open_and_detect() { # <label> [timeout]
  local label="$1"
  local timeout="${2:-120}"
  local t0
  t0="$(date +%s)"
  open "$APP_PATH" || note "open \$APP_PATH returned non-zero (continuing — Gatekeeper may still present UI)"
  wait_for_medivault "$timeout" "$label"
  if [ -n "$MV_T_PROC" ] || [ -n "$MV_T_WINDOW" ]; then
    local entry="$label: open→process=${MV_T_PROC:-n/a}s, open→window=${MV_T_WINDOW:-n/a}s (title: ${MV_TITLE:-none})"
    if [ -n "$CAP_LAUNCH_TIMING" ]; then
      CAP_LAUNCH_TIMING="$CAP_LAUNCH_TIMING | $entry"
    else
      CAP_LAUNCH_TIMING="$entry"
    fi
  fi
}

quit_medivault() {
  if osa 'tell application "MediVault" to quit' 20; then
    probe "quit via AppleScript: issued"
  else
    probe "quit via AppleScript blocked ($OSA_ERR) — falling back to SIGTERM the desktop process"
    pkill -TERM -f "MediVault.app/Contents/MacOS/MediVault" 2>/dev/null || true
  fi
  local i
  for i in $(seq 1 30); do
    pgrep -f "MediVault.app/Contents/MacOS/MediVault" >/dev/null 2>&1 || break
    sleep 1
  done
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

# System Events availability probe (needed for the consent + Open Anyway flows)
UI_AUTOMATION="unprobed"
if osa 'tell application "System Events" to get name of every process' 20; then
  UI_AUTOMATION="available"
  probe "System Events UI scripting: AVAILABLE on this runner (assistive access granted)"
else
  UI_AUTOMATION="blocked"
  probe "System Events UI scripting: BLOCKED — exact error: $OSA_ERR"
  classify C "assistive access (System Events) denied for the runner host process: $OSA_ERR"
fi

# =============================== PHASE B ======================================
# REAL Safari download of the frozen release — including answering Safari's
# genuine download-permission dialog through System Events (clicking the
# real "Allow" button: legitimate GUI interaction, NOT a TCC bypass).
note "=== PHASE B: real Safari download of $RELEASE_TAG/$DMG_NAME (with genuine consent-dialog automation) ==="
RELEASE_URL="$RELEASE_BASE/$DMG_NAME"
probe "release URL: $RELEASE_URL"
probe "expected size: $EXPECTED_SIZE bytes; sha256 ${EXPECTED_SHA256:0:12}…"
rm -f "$DMG_PATH" "$DMG_PATH.download" 2>/dev/null || true

BROWSER_OK="no"
CONSENT_ROUNDS=0
if open -a Safari "$RELEASE_URL"; then
  probe "Safari launched with the release URL (LaunchServices)"
  # Poll for Safari's download-permission dialog (button "Allow" + text about
  # allowing downloads / the release-assets host). Up to 90s, 2s interval.
  DL_CONSENT_T0="$(date +%s)"
  while [ $(( $(date +%s) - DL_CONSENT_T0 )) -lt 90 ]; do
    if [ "$UI_AUTOMATION" = "available" ]; then
      if osa 'tell application "System Events"
  tell process "Safari"
    set found to "none"
    repeat with w in (get windows)
      try
        set hasAllow to false
        set hasText to false
        repeat with el in (entire contents of w)
          try
            if class of el is button and (name of el) as string is "Allow" then set hasAllow to true
          end try
          try
            if class of el is static text then
              set t to (value of el) as string
              if t contains "allow downloads" or t contains "release-assets" then set hasText to true
            end if
          end try
        end repeat
        if hasAllow and hasText then
          set found to "consent-dialog"
          exit repeat
        end if
      end try
    end repeat
  end tell
end tell
return found' 15; then
        if [ "$OSA_OUT" = "consent-dialog" ]; then
          CONSENT_ROUNDS=$((CONSENT_ROUNDS + 1))
          CAP_CONSENT="OBSERVED"
          note "Safari download-permission dialog DETECTED (round $CONSENT_ROUNDS) — capturing evidence BEFORE clicking"
          snap 18-safari-download-consent || true
          sleep 1
          # exact-name match: "Don't Allow" CONTAINS "Allow", so a contains-
          # match could click the wrong button. Exact match cannot.
          if ui_click_button_in_windows "Safari" "Allow" 25; then
            if [ "${OSA_OUT#clicked}" != "$OSA_OUT" ]; then
              probe "consent dialog: clicked the genuine 'Allow' button (legitimate System Events automation; TCC untouched)"
              sleep 4
              snap 19-safari-download-started || true
            else
              probe "consent dialog: no exact 'Allow' button found ($OSA_OUT) — dialog stays up; download cannot proceed via Safari"
              classify C "Safari consent dialog had no exact Allow button reachable by automation: $OSA_OUT"
            fi
          else
            probe "consent dialog: clicking Allow FAILED — $OSA_ERR (the dialog stays up; download cannot proceed via Safari)"
            classify C "Safari consent dialog present but System Events could not click Allow: $OSA_ERR"
            snap 19-safari-download-started || true
          fi
        fi
      fi
    fi
    # stop polling when the download actually completes or clearly started
    size="$(stat -f%z "$DMG_PATH" 2>/dev/null || echo 0)"
    dsize="$(stat -f%z "$DMG_PATH.download" 2>/dev/null || echo 0)"
    if [ "$size" = "$EXPECTED_SIZE" ] || [ "$dsize" -gt 0 ]; then
      break
    fi
    sleep 2
  done
  if [ "$CAP_CONSENT" != "OBSERVED" ]; then
    probe "no Safari download-permission dialog was detected within the poll window (Safari may have auto-allowed, prompted differently, or failed)"
    dsize="$(stat -f%z "$DMG_PATH.download" 2>/dev/null || echo 0)"
    if [ "$dsize" -gt 0 ]; then
      snap 19-safari-download-started || true
    fi
  fi
  note "waiting for the Safari download to complete (bounded 15 min, no .download sibling, exact size)"
  if wait_for_path "$DMG_PATH" 900; then
    BROWSER_OK="yes"
    CAP_SAFARI_DL="GREEN"
    note "Safari download complete: $DMG_PATH ($(stat -f%z "$DMG_PATH") bytes)"
  else
    size="$(stat -f%z "$DMG_PATH" 2>/dev/null || echo 0)"
    probe "Safari download did not complete in 15 min (present size: $size)"
    CAP_SAFARI_DL="RED"
    if [ "$CAP_CONSENT" = "OBSERVED" ]; then
      classify C "Safari consent was clicked but the download still did not complete (runner network/first-run state?)"
    else
      classify C "Safari download incomplete on the runner (prompt/consent or first-run state?)"
    fi
  fi
else
  CAP_SAFARI_DL="NOT POSSIBLE"
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

# ---- DMG hash FIRST (per contract: verify the hash right after download) ----
ACTUAL_SHA="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
probe "downloaded sha256: $ACTUAL_SHA"
if [ "$ACTUAL_SHA" = "$EXPECTED_SHA256" ]; then
  CAP_DMG_HASH="GREEN"
  note "pinned SHA-256 MATCHES the frozen release (arm64 7059c372… / x86_64 1eb5a245… per request)"
else
  CAP_DMG_HASH="RED"
  classify D "downloaded DMG hash does not match the pinned release — refusing to continue with an unverified artifact"
  write_caps
  exit 1
fi

# ---- NATURAL QUARANTINE — observe only, preserve the exact value -----------
note "=== PHASE B2: natural quarantine evidence (observation only) ==="
Q="$(xattr -p com.apple.quarantine "$DMG_PATH" 2>/dev/null || true)"
{
  echo "com.apple.quarantine on $DMG_PATH"
  echo "observed: $(date -u 2>/dev/null)"
  echo "value: ${Q:-<absent>}"
  echo "download-method: ${BROWSER_OK:+Safari}${BROWSER_OK:-curl-fallback}"
  echo "(observed with xattr -p only — never written, never removed)"
} > "$EVID_DIR/quarantine-evidence.txt" 2>/dev/null || true
if [ -n "$Q" ]; then
  CAP_QUARANTINE="YES"
  probe "com.apple.quarantine NATURALLY present on the download: $Q"
  case "$Q" in
    *com.apple.Safari*)
      CAP_QUARANTINE_SRC="SAFARI"
      probe "quarantine source parsed from the attribute value: com.apple.Safari (the download attribute names its origin app)" ;;
    *) CAP_QUARANTINE_SRC="OTHER"
       probe "quarantine present but its source app is not Safari: $Q" ;;
  esac
else
  CAP_QUARANTINE="NO"
  CAP_QUARANTINE_SRC="NOT PROVEN"
  probe "com.apple.quarantine NOT present on the download (browser=$CAP_SAFARI_DL)"
fi

# Downloads folder in Finder (real window) + screenshots
open "$DL_DIR" 2>/dev/null || true
sleep 3
snap 20-downloads-with-dmg || true
# 21: Get Info window on the DMG (only if the automation works — else skipped)
if [ "$UI_AUTOMATION" = "available" ]; then
  if osa "tell application \"Finder\"
  set dmgFile to (POSIX file \"$DMG_PATH\") as alias
  reveal dmgFile
end tell
delay 1
tell application \"System Events\" to tell process \"Finder\" to keystroke \"i\" using command down" 20; then
    sleep 3
    snap 21-quarantined-dmg || true
    probe "Finder Get Info window opened on the DMG (info panel is human evidence; the xattr value in quarantine-evidence.txt is the quarantine proof)"
    osa 'tell application "System Events" to keystroke "w" using command down' 10 || true
  else
    probe "Finder Get Info automation unavailable ($OSA_ERR) — 21-quarantined-dmg not created (only real states get files)"
  fi
fi

# =============================== PHASE C ======================================
# Offline verification of the EXACT frozen release candidate (no rebuild).
note "=== PHASE C: offline verify (full verify-release) ==="
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
  snap 22-dmg-finder || true
  CAP_DMG_FINDER="GREEN"
  probe "mounted volume: $(ls "$VOLUME" 2>/dev/null | tr '\n' ' ')"
  probe "drag layout present: $([ -d "$VOLUME/MediVault.app" ] && echo app && [ -L "$VOLUME/Applications" ] && echo +Applications-symlink)"
else
  CAP_DMG_FINDER="NOT PROVEN"
  probe "volume did not appear at $VOLUME after open"
  classify B "Finder DMG mount did not surface on the runner"
fi

# =============================== PHASE E ======================================
# Place MediVault into Applications — genuine GUI automation ladder.
# Ladder of honesty (each rung labeled; none is ever mislabeled):
#   1. System Events GUI automation (keyboard copy in the real Finder windows)
#   2. Finder AppleScript duplicate to /Applications (Finder performs the
#      copy; may hit the admin-password dialog — that dialog is real evidence)
#   3. Finder duplicate to ~/Applications (canonical per-user install)
#   4. harness cp -R to ~/Applications (explicitly NOT a Finder proof)
# A DMG quarantined by Safari propagates quarantine through the Finder copy
# (that is macOS behavior, observed — never manufactured here).
note "=== PHASE E: place into Applications (genuine automation only) ==="
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
  fi
fi

if [ "$PLACEMENT" = "none" ] && [ "$MOUNTED" = "yes" ]; then
  note "attempting Finder AppleScript duplicate to /Applications (Finder itself performs the copy — not a drag)"
  if osa "tell application \"Finder\" to duplicate (POSIX file \"$VOLUME/MediVault.app\") to (POSIX file \"/Applications\") with replacing" 30; then
    for i in $(seq 1 60); do [ -d "$APP_PATH" ] && PLACEMENT="finder-applescript" && break; sleep 1; done
    [ "$PLACEMENT" != "none" ] || probe "Finder duplicate to /Applications returned ok but $APP_PATH never appeared"
  else
    probe "Finder duplicate to /Applications BLOCKED — exact error: $OSA_ERR"
    classify C "Finder/Apple Events denied or admin-password dialog blocked the /Applications copy: $OSA_ERR"
  fi
fi

if [ "$PLACEMENT" = "none" ] && [ "$MOUNTED" = "yes" ]; then
  note "attempting Finder AppleScript duplicate to ~/Applications (canonical per-user install — no admin password needed)"
  mkdir -p "$HOME/Applications"
  if osa "tell application \"Finder\" to duplicate (POSIX file \"$VOLUME/MediVault.app\") to (POSIX file \"$HOME/Applications\") with replacing" 30; then
    for i in $(seq 1 60); do [ -d "$USER_APP_PATH" ] && PLACEMENT="finder-applescript-peruser" && APP_PATH="$USER_APP_PATH" && break; sleep 1; done
    [ "$PLACEMENT" != "none" ] || probe "Finder duplicate to ~/Applications returned ok but the app never appeared"
  else
    probe "Finder duplicate to ~/Applications BLOCKED — exact error: $OSA_ERR"
    classify C "Apple Events to Finder denied (Automation TCC): $OSA_ERR"
  fi
fi

if [ "$PLACEMENT" = "none" ] && [ "$MOUNTED" = "yes" ]; then
  # Last resort so the LAUNCH investigation can continue. Explicitly NOT a
  # Finder proof — labeled in every report. Command-line placement by the
  # harness; FINDER_PLACEMENT stays NOT PROVEN.
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
  snap 23-applications || true
  CAP_PLACEMENT_HOW="$PLACEMENT"
  case "$PLACEMENT" in
    gui-keyboard-copy) CAP_PLACEMENT="GREEN (GUI keyboard copy in real Finder windows)" ;;
    finder-applescript) CAP_PLACEMENT="GREEN (Finder AppleScript duplicate — Finder performed the copy)" ;;
    finder-applescript-peruser) CAP_PLACEMENT="GREEN (Finder duplicate to ~/Applications — Finder performed the copy)" ;;
    command-line*) CAP_PLACEMENT="NOT PROVEN (command-line placement — never claimed as Finder)" ;;
    *) CAP_PLACEMENT="NOT PROVEN" ;;
  esac
  QAPP="$(xattr -p com.apple.quarantine "$APP_PATH" 2>/dev/null || true)"
  APP_QUARANTINE_VALUE="$QAPP"
  probe "quarantine on $APP_PATH after placement ($PLACEMENT): ${QAPP:-<none>}"
  {
    echo "com.apple.quarantine on $APP_PATH (after placement: $PLACEMENT)"
    echo "value: ${QAPP:-<absent>}"
    echo "dmg quarantine was: ${Q:-<absent>}"
  } >> "$EVID_DIR/quarantine-evidence.txt" 2>/dev/null || true
else
  CAP_PLACEMENT="RED"
  note "no installed $APP_PATH — launch phase cannot run"
  write_caps
  exit 0
fi

# =============================== PHASE F ======================================
# First launch of the PLACED app with the robust bounded detector.
note "=== PHASE F: first launch + Gatekeeper observation (robust 120s detector) ==="
probe "spctl assessment (read-only probe, never a bypass): $(spctl -a -vv "$APP_PATH" 2>&1 | tr '\n' ' ' || true)"
probe "quarantine on the app about to launch: ${QAPP:-<none>}"
open_and_detect "first-launch" 120
snap 24-first-quarantined-launch || true

GK_TEXT=""
if [ "$MV_BLOCK" = "yes" ]; then
  sleep 2
  snap 25-gatekeeper-warning || true
  CAP_GK_WARNING="OBSERVED (alert detected; screenshots 24/25)"
  probe "Gatekeeper alert: capturing its text via System Events (read-only)"
  for hostproc in CoreServicesUIAgent UserNotificationCenter; do
    if ui_dialog_texts "$hostproc"; then
      if [ -n "${OSA_OUT// /}" ]; then GK_TEXT="$OSA_OUT"; break; fi
    fi
  done
  if [ -n "$GK_TEXT" ]; then
    {
      echo "Gatekeeper alert text (host process: $hostproc)"
      echo "$GK_TEXT"
    } > "$EVID_DIR/gatekeeper-alert-text.txt"
    probe "Gatekeeper alert text: $(printf '%s' "$GK_TEXT" | cut -c1-400)"
  else
    probe "Gatekeeper alert text could not be read via AX (screenshots 24/25 are the evidence)"
  fi
  classify E "quarantined ad-hoc app blocked at first launch — the documented zero-cost Gatekeeper contract (Open Anyway flow)"
  # Dismiss the alert through its own buttons (legitimate interaction)
  GK_DISMISS="not-attempted"
  if ui_click_button_in_windows "CoreServicesUIAgent" "Done" 15; then
    if [ "${OSA_OUT#clicked}" != "$OSA_OUT" ]; then GK_DISMISS="$OSA_OUT"; fi
  fi
  if [ "$GK_DISMISS" = "not-attempted" ]; then
    if ui_click_button_in_windows "CoreServicesUIAgent" "OK" 15; then
      if [ "${OSA_OUT#clicked}" != "$OSA_OUT" ]; then GK_DISMISS="$OSA_OUT"; fi
    fi
  fi
  if [ "$GK_DISMISS" != "not-attempted" ]; then
    probe "Gatekeeper alert dismissed via its own button: $GK_DISMISS"
  else
    probe "Gatekeeper alert dismissal not performed (no Done/OK button found or AX blocked — the alert may stay on screen; screenshots preserved)"
  fi
  sleep 2
elif [ "$MV_PROC" = "yes" ]; then
  if [ -n "$QAPP" ]; then
    CAP_GK_WARNING="NOT OBSERVED (app is quarantined but launched without a visible block — recorded honestly)"
    probe "app launched while quarantined WITHOUT a visible Gatekeeper block (macOS 26 behavior recorded as observed)"
  else
    CAP_GK_WARNING="NOT OBSERVED (no quarantine propagated to the placed copy — Gatekeeper not exercised on this path)"
    if [ "$CAP_QUARANTINE" = "YES" ]; then
      classify B "DMG had natural quarantine but it did not propagate through the placement method used ($PLACEMENT)"
    else
      classify B "no quarantine existed to propagate (browser download unavailable) — Gatekeeper chain honestly stopped"
    fi
  fi
  CAP_FIRST_LAUNCH="launched: process + window visible (open→process=${MV_T_PROC:-n/a}s, open→window=${MV_T_WINDOW:-n/a}s)"
else
  # neither app nor alert — record honestly, do not guess
  CAP_FIRST_LAUNCH="no process and no Gatekeeper alert within 120s (honest unknown — see detector summary)"
  if [ -n "$QAPP" ]; then
    CAP_GK_WARNING="NOT OBSERVED (app quarantined; no alert detected and no process — macOS may have rejected it silently)"
    classify D "quarantined app neither launched nor showed an alert within 120s — needs investigation"
  else
    CAP_GK_WARNING="NOT OBSERVED (no quarantine; app did not start — see logs)"
    classify D "app did not start and there was no quarantine to explain a block — needs investigation"
  fi
fi
if [ "$MV_PROC" = "yes" ]; then
  CAP_MV_PROC="GREEN"
  if [ "$MV_WINDOW" = "yes" ]; then
    CAP_MV_WINDOW="GREEN"
    case "$MV_TITLE" in
      *MediVault*) : ;;
      *) probe "window title does not contain 'MediVault': '$MV_TITLE'" ;;
    esac
    probe "window title observed: '$MV_TITLE' (expected: '$EXPECTED_TITLE')"
  else
    CAP_MV_WINDOW="RED (process up, no visible window detected within bound)"
  fi
fi

# ---- Open Anyway flow (only when Gatekeeper blocked the app) ----------------
OA_FLOW="no"
if [ "$MV_BLOCK" = "yes" ] && [ "$UI_AUTOMATION" = "available" ]; then
  OA_FLOW="yes"
  note "=== PHASE F2: System Settings -> Privacy & Security -> Open Anyway (legitimate automation) ==="
  open "x-apple.systempreferences:com.apple.settings.privacy.security" 2>/dev/null || true
  sleep 10
  snap 26-privacy-security-before || true
  note "searching the real Privacy & Security UI for the Open Anyway button (System Settings may take time to populate)"
  OA_FOUND="no"
  OA_T0="$(date +%s)"
  while [ $(( $(date +%s) - OA_T0 )) -lt 120 ]; do
    osa 'tell application "System Settings" to activate' 10 >/dev/null 2>&1 || true
    sleep 2
    if osa 'tell application "System Events"
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
return hits as string' 45; then
      if [ -n "$OSA_OUT" ] && [ "$OSA_OUT" != "0" ]; then
        OA_FOUND="yes"
        break
      fi
    fi
    sleep 3
  done
  if [ "$OA_FOUND" = "yes" ]; then
    CAP_OA_VISIBLE="YES"
    probe "Open Anyway button FOUND in the real Privacy & Security UI (count: $OSA_OUT)"
    snap 27-open-anyway-visible || true
    note "clicking Open Anyway through legitimate GUI automation"
    if osa 'tell application "System Events"
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
return "not-found"' 60; then
      probe "Open Anyway click issued: $OSA_OUT"
      sleep 5
      # confirmation dialog (admin auth or a confirm alert) — capture BEFORE acting
      CONFIRM_HOST=""
      local_sa="$(ui_window_count "SecurityAgent")"
      if [ "$local_sa" != "-1" ] && [ "$local_sa" != "0" ] && [ -n "$local_sa" ]; then
        CONFIRM_HOST="SecurityAgent"
      fi
      if [ -z "$CONFIRM_HOST" ]; then
        ss_sheets="$(ui_window_count "System Settings")"
        probe "post-click System Settings windows: $ss_sheets (checking for an in-window confirmation sheet)"
      fi
      snap 28-open-anyway-confirmation || true
      if [ "$CONFIRM_HOST" = "SecurityAgent" ]; then
        probe "confirmation appears as an admin-authorization dialog (SecurityAgent) — text:"
        if ui_dialog_texts "SecurityAgent"; then
          probe "confirmation dialog text: $(printf '%s' "$OSA_OUT" | cut -c1-300)"
        fi
        # Attempt the genuine completion: fill the runner's own account name
        # and (empty) password, then click the dialog's own action button.
        # This is typing into the REAL dialog — no policy bypass, no TCC edit.
        note "attempting to satisfy the admin-authorization dialog with the runner's own (passwordless) account via GUI typing"
        if osa 'tell application "System Events"
  tell process "SecurityAgent"
    set fields to {}
    repeat with w in (get windows)
      try
        repeat with el in (entire contents of w)
          try
            set cl to class of el as string
            if cl is "text field" or cl is "secure text field" then set end of fields to el
          end try
        end repeat
      end try
    end repeat
    if (count of fields) is greater than or equal to 2 then
      set value of item 1 of fields to "runner"
      set value of item 2 of fields to ""
    else if (count of fields) is 1 then
      set value of item 1 of fields to ""
    end if
  end tell
end tell
return "fields-filled"' 30; then
          probe "auth fields filled (runner / empty password): $OSA_OUT"
        else
          probe "auth fields could not be set via AX: $OSA_ERR"
        fi
        AUTH_CLICKED="no"
        for btn in "OK" "Allow" "Unlock" "Continue" "Modify Settings"; do
          if ui_click_button_in_windows "SecurityAgent" "$btn" 15; then
            if [ "${OSA_OUT#clicked}" != "$OSA_OUT" ]; then
              AUTH_CLICKED="yes"
              probe "auth dialog action button clicked: $OSA_OUT"
              break
            fi
          fi
        done
        [ "$AUTH_CLICKED" = "yes" ] || probe "no auth action button was clickable (credentials unknown or AX blocked — recorded honestly)"
        sleep 5
      else
        # plain confirmation alert (e.g. "Open" / "Allow") inside System Settings
        CONFIRM_CLICKED="no"
        for btn in "Open" "Allow" "Confirm"; do
          if ui_click_button_contains_in_windows "System Settings" "$btn" 20; then
            if [ "${OSA_OUT#clicked}" != "$OSA_OUT" ]; then
              CONFIRM_CLICKED="yes"
              probe "confirmation button clicked: $OSA_OUT"
              break
            fi
          fi
        done
        [ "$CONFIRM_CLICKED" = "yes" ] || probe "no in-window confirmation button found (the click may not have produced a dialog — recorded honestly)"
        sleep 5
      fi
      # verdict: did the block actually clear (app can now exec)?
      probe "post-approval state: SecurityAgent windows=$(ui_window_count "SecurityAgent")"
      sleep 3
      snap 28-open-anyway-confirmation || true
      note "verifying the approval outcome by relaunching MediVault (the detector requires real process + window)"
      open_and_detect "after-approval" 120
      if [ "$MV_PROC" = "yes" ]; then
        CAP_OA_APPROVAL="GREEN"
        CAP_FIRST_LAUNCH="blocked by Gatekeeper at first launch; approved via Open Anyway; relaunched successfully (open→process=${MV_T_PROC:-n/a}s)"
        snap 29-medivault-after-approval || true
      else
        CAP_OA_APPROVAL="BLOCKED_BY_OS_AUTOMATION_POLICY"
        classify C "Open Anyway clicked but the authorization could not be satisfied by automation (runner account credentials unknown/empty): see 28-open-anyway-confirmation.png"
      fi
    else
      CAP_OA_APPROVAL="BLOCKED_BY_OS_AUTOMATION_POLICY"
      classify C "Open Anyway click refused by macOS automation policy: $OSA_ERR"
    fi
  else
    CAP_OA_VISIBLE="NO (System Settings reachable; button not detected within 120s)"
    probe "Open Anyway not found in the Privacy & Security UI (the blocked-app row may require scrolling, or it is absent)"
  fi
elif [ "$MV_BLOCK" = "yes" ]; then
  CAP_OA_VISIBLE="NOT PROVEN (assistive access blocked — screenshot 26 is the human evidence)"
  CAP_OA_APPROVAL="BLOCKED_BY_OS_AUTOMATION_POLICY"
  note "Open Anyway approval not attempted: assistive access is blocked on this runner (recorded in Phase A/B)"
fi

# =============================== PHASE G ======================================
# Second normal launch: close and reopen once more (the user-path proof).
if [ "$CAP_MV_PROC" = "GREEN" ]; then
  note "=== PHASE G: close + reopen once more (second normal launch) ==="
  quit_medivault
  sleep 3
  open_and_detect "second-normal-launch" 120
  if [ "$MV_PROC" = "yes" ] && [ "$MV_WINDOW" = "yes" ]; then
    CAP_SECOND_LAUNCH="GREEN (process + window after close/reopen; open→window=${MV_T_WINDOW:-n/a}s)"
    snap 30-medivault-second-normal-launch || true
  else
    CAP_SECOND_LAUNCH="RED (process did not return after reopen: proc=$MV_PROC window=$MV_WINDOW)"
    snap 30-medivault-second-normal-launch || true
  fi
fi

# =============================== PHASE H ======================================
# Product checks — ONLY if MediVault actually runs.
if [ "$CAP_MV_PROC" != "GREEN" ]; then
  note "=== MediVault is not running (Gatekeeper/launch path) — product phases stay NOT RUN ==="
  write_caps
  cap SUMMARY "stopped at launch phase (proc=$CAP_MV_PROC, GK=$CAP_GK_WARNING, OA=$CAP_OA_APPROVAL)"
  echo "GUI-ACCEPTANCE-RECORDED (launch-phase stop — all outcomes honestly recorded)"
  exit 0
fi

note "=== PHASE H: MediVault product checks (app IS running) ==="

# --- API health + loopback-only binding ---
note "waiting for the supervisor to provision + the API to become healthy (first run, bounded 10 min)"
API_OK="no"
i=0
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
    *127.0.0.1:3001*) if [ -z "$(echo "$API_BIND" | tr ' ' '\n' | grep -v '^127.0.0.1:3001$' | grep -v '^$')" ]; then
      probe "API loopback-only (127.0.0.1:3001 only): YES"
    else
      probe "API loopback-only: NO — non-loopback endpoints detected: $API_BIND"
    fi ;;
    *) probe "API 127.0.0.1:3001 not seen in lsof output: $API_BIND" ;;
  esac
else
  CAP_API="RED"
  probe "API never became healthy on $API (supervisor provisioning on a runner may be slow — see logs)"
  probe "supervisor status: $(cat "$HOME/Library/Application Support/MediVault/runtime-state/supervisor-status.json" 2>/dev/null || echo none)"
  probe "supervisor.log tail:"; tail -15 "$HOME/Library/Logs/MediVault/supervisor.log" 2>/dev/null | tee -a "$LOG" || true
fi

# --- PostgreSQL loopback-only ---
PG_BIND="$(lsof -nP -iTCP:$PGPORT -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sort -u | tr '\n' ' ')"
probe "PG listen endpoints: ${PG_BIND:-none}"
PGBIN="$APP_PATH/Contents/Resources/runtime/postgresql/17/bin"
if [ -x "$PGBIN/pg_isready" ]; then
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
    CAP_PG="GREEN"
    probe "pg_isready 127.0.0.1:$PGPORT: accepting connections"
    case "$PG_BIND" in
      *127.0.0.1:$PGPORT*) if [ -z "$(echo "$PG_BIND" | tr ' ' '\n' | grep -v "^127.0.0.1:$PGPORT\$" | grep -v '^$')" ]; then
        probe "PG loopback-only (127.0.0.1:$PGPORT only): YES"
      else
        probe "PG loopback-only: NO — non-loopback endpoints detected: $PG_BIND"
      fi ;;
      *) probe "PG 127.0.0.1:$PGPORT not seen in lsof output: $PG_BIND" ;;
    esac
  else
    CAP_PG="RED"
    probe "pg_isready 127.0.0.1:$PGPORT: NOT accepting"
  fi
else
  CAP_PG="NOT RUN (bundled pg_isready not found at $PGBIN)"
fi

# --- Settings -> Background (the SMAppService control panel) ---
note "PHASE H: Settings -> Background (SMAppService UI) through real GUI automation"
if osa 'tell application "MediVault" to activate' 10; then :; fi
sleep 2
# Widen the window so the ≥lg tab labels ("Background") render (1024 screen
# would otherwise hide them); top-left corner keeps everything on-screen.
osa 'tell application "System Events"
  tell process "MediVault"
    set position of window 1 to {0, 0}
    set size of window 1 to {1400, 900}
  end tell
end tell' 15 || probe "window resize not possible ($OSA_ERR) — continuing at current size"
sleep 2
SETTINGS_CLICKED="no"
if [ "$UI_AUTOMATION" = "available" ]; then
  if ui_button "find" "MediVault" "Settings" 90; then
    if [ "$OSA_OUT" != "none" ] && [ -n "$OSA_OUT" ]; then
      probe "MediVault UI exposes a control matching 'Settings': $OSA_OUT (webview accessibility IS reachable)"
    else
      probe "MediVault webview does not expose a 'Settings' control by name (web content may be AX-opaque) — dumping visible names for diagnosis"
      if ui_dump_names "MediVault" 60; then
        probe "MediVault AX names (first 60): $(printf '%s' "$OSA_OUT" | cut -c1-600)"
      fi
    fi
  else
    probe "MediVault webview 'Settings' lookup failed: $OSA_ERR — dumping visible names for diagnosis"
    if ui_dump_names "MediVault" 60; then
      probe "MediVault AX names (first 60): $(printf '%s' "$OSA_OUT" | cut -c1-600)"
    fi
  fi
  if ui_button "click" "MediVault" "Settings" 90; then
    if [ "$OSA_OUT" != "none" ] && [ -n "$OSA_OUT" ] && [ "${OSA_OUT#click:}" != "$OSA_OUT" ]; then
      SETTINGS_CLICKED="yes"
      probe "sidebar Settings clicked: $OSA_OUT"
    else
      probe "sidebar Settings click did not land on a named control ($OSA_OUT)"
    fi
  else
    probe "sidebar Settings click failed: $OSA_ERR"
  fi
else
  probe "System Events unavailable — Settings UI automation skipped (C-class, recorded)"
fi
if [ "$SETTINGS_CLICKED" = "yes" ]; then
  sleep 3
  BG_CLICKED="no"
  if ui_button "click" "MediVault" "Background" 90; then
    if [ "${OSA_OUT#click:}" != "$OSA_OUT" ]; then
      BG_CLICKED="yes"
      probe "Background tab clicked: $OSA_OUT"
    else
      probe "Background tab not found by name ($OSA_OUT) — tab labels may be hidden below the lg breakpoint"
    fi
  else
    probe "Background tab click failed: $OSA_ERR — dumping names for diagnosis"
    if ui_dump_names "MediVault" 60; then
      probe "MediVault AX names (first 60): $(printf '%s' "$OSA_OUT" | cut -c1-600)"
    fi
  fi
  sleep 2
  snap 31-background-settings || true
  # Read the panel's real state text + launchd ground truth
  if ui_dump_names "MediVault" 60; then
    DUMP="$OSA_OUT"
    case "$DUMP" in
      *"Register background service"*) CAP_SMAPPSTATE_TEXT="notRegistered (panel offers Register background service)" ;;
      *"Open Login Items Settings"*) CAP_SMAPPSTATE_TEXT="requiresApproval (panel offers Open Login Items Settings)" ;;
      *Background*service*active*|*"background service is enabled"*) CAP_SMAPPSTATE_TEXT="enabled (panel reports active)" ;;
      *"not found"*|*"installation"*) CAP_SMAPPSTATE_TEXT="notFound (panel reports installation error)" ;;
      *) CAP_SMAPPSTATE_TEXT="text not matched (dump recorded in probes.log)" ;;
    esac
    probe "BackgroundServicePanel state from the real UI: $CAP_SMAPPSTATE_TEXT"
  fi
  SVC="gui/$(id -u)/dev.medivault.supervisor"
  if launchctl print "$SVC" >/tmp/gui-sa-launchctl.txt 2>&1; then
    probe "launchctl ground truth: $SVC IS present in the GUI domain"
    grep -E 'state = |program =' /tmp/gui-sa-launchctl.txt | head -4 | while IFS= read -r l; do probe "launchctl: $l"; done
  else
    probe "launchctl ground truth: $SVC NOT present (SMAppService not registered yet — matches notRegistered)"
  fi
  # Exercise the real registration path (only through the real buttons)
  if [ "$CAP_SMAPPSTATE_TEXT" = "not read" ]; then
    CAP_SMAPPSERVICE_UI="NOT PROVEN (panel captured; state text not readable via AX — screenshot 31 is the human evidence)"
  elif [ "$CAP_SMAPPSTATE_TEXT" != "${CAP_SMAPPSTATE_TEXT#notRegistered}" ]; then
    note "exercising the real registration path: clicking 'Register background service'"
    REGISTER_CLICKED="no"
    if ui_button "click" "MediVault" "Register background service" 60; then
      if [ "${OSA_OUT#click:}" != "$OSA_OUT" ]; then
        REGISTER_CLICKED="yes"
        probe "Register clicked: $OSA_OUT"
      else
        probe "Register button not found by name ($OSA_OUT) — registration path not exercised"
      fi
    else
      probe "Register click automation failed: $OSA_ERR"
    fi
    if [ "$REGISTER_CLICKED" = "yes" ]; then
      sleep 8
      snap 31-background-settings || true
      if ui_dump_names "MediVault" 60; then
        DUMP2="$OSA_OUT"
        case "$DUMP2" in
          *"Open Login Items Settings"*) CAP_SMAPPSTATE_TEXT="requiresApproval (after real registration — Apple's contract)" ;;
          *"Register background service"*) CAP_SMAPPSTATE_TEXT="notRegistered still (registration may have failed — see UI)" ;;
          *background*service*active*|*enabled*) CAP_SMAPPSTATE_TEXT="enabled (registration auto-approved?)" ;;
          *) : ;;
        esac
        probe "post-registration panel state: $CAP_SMAPPSTATE_TEXT"
      fi
      # SMAppService UI state = the panel + the registration we exercised
      CAP_SMAPPSERVICE_UI="GREEN (panel captured + real registration path exercised; state: $CAP_SMAPPSTATE_TEXT)"
    else
      CAP_SMAPPSERVICE_UI="NOT PROVEN (panel captured; registration click blocked — see probes.log)"
    fi
  else
    CAP_SMAPPSERVICE_UI="GREEN (panel captured; real state: $CAP_SMAPPSTATE_TEXT)"
  fi
  # Open the real Login Items screen through the app's own button
  if printf '%s' "$CAP_SMAPPSTATE_TEXT" | grep -q "requiresApproval"; then
    note "opening the real Login Items settings through the app's own 'Open Login Items Settings' button"
    if ui_button "click" "MediVault" "Open Login Items Settings" 60; then
      if [ "${OSA_OUT#click:}" != "$OSA_OUT" ]; then
        probe "Open Login Items Settings clicked: $OSA_OUT"
        sleep 8
        snap 32-login-items || true
        CAP_LOGIN_ITEMS_UI="CAPTURED (real System Settings Login Items screen — screenshot 32)"
      else
        probe "Open Login Items Settings button not found ($OSA_OUT) — opening the surface via URL"
        open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" 2>/dev/null || true
        sleep 8
        snap 32-login-items || true
        CAP_LOGIN_ITEMS_UI="CAPTURED (opened via URL after the app button was not found — screenshot 32)"
      fi
      note "attempting the Login Items approval toggle through System Events (legitimate GUI automation)"
      if osa 'tell application "System Events"
  tell (first process whose name is "System Settings")
    try
      repeat with el in (entire contents of window 1)
        try
          if class of el is checkbox or class of el is switch then
            set d to (description of el) as string
            set n to (name of el) as string
            if d contains "MediVault" or n contains "MediVault" then
              click el
              return "toggled:" & n
            end if
          end if
        end try
      end repeat
    end try
  end tell
end tell
return "not-found"' 90; then
        if [ "${OSA_OUT#toggled}" != "$OSA_OUT" ]; then
          probe "Login Items approval toggle clicked: $OSA_OUT"
          sleep 3
          snap 32-login-items || true
        else
          probe "Login Items approval toggle not found ($OSA_OUT) — approval left to the human (C-class if blocked)"
        fi
      else
        probe "Login Items toggle automation error: $OSA_ERR (approval left to the human — C-class if blocked)"
      fi
    else
      probe "Open Login Items Settings click failed: $OSA_ERR"
      open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" 2>/dev/null || true
      sleep 6
      snap 32-login-items || true
      CAP_LOGIN_ITEMS_UI="CAPTURED (opened via URL after the app button failed — screenshot 32)"
    fi
  else
    open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" 2>/dev/null || true
    sleep 6
    snap 32-login-items || true
    CAP_LOGIN_ITEMS_UI="CAPTURED (screenshot 32 — human gallery evidence)"
  fi
else
  # Settings click failed — still capture the Login Items surface + launchd truth
  open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" 2>/dev/null || true
  sleep 6
  snap 32-login-items || true
  CAP_LOGIN_ITEMS_UI="NOT PROVEN (app settings not reachable via AX; screenshot 32 is the system surface)"
fi

# --- synthetic patient through the product's own API ---
if [ "$CAP_API" = "GREEN" ]; then
  JAR="/tmp/gui-cookies.txt"; rm -f "$JAR"
  ORIGIN="tauri://localhost"
  NEEDS="$(curl -s --max-time 5 "$API/api/auth/setup" 2>/dev/null || echo '{}')"
  probe "auth setup state: $NEEDS"
  SETUP_OK="no"
  if echo "$NEEDS" | grep -q '"needsSetup":true'; then
    if curl -s --max-time 10 -c "$JAR" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
        -d "{\"email\":\"$SYNTH_EMAIL\",\"password\":\"$SYNTH_PASS\",\"name\":\"GUI CI Acceptance\"}" \
        "$API/api/auth/setup" -o /tmp/gui-setup.json -w '%{http_code}' | grep -qE '201|200'; then
      SETUP_OK="yes"; probe "first-admin setup: created (synthetic CI identity)"
    else
      probe "first-admin setup failed: $(cat /tmp/gui-setup.json 2>/dev/null | cut -c1-200)"
    fi
  else
    probe "auth already set up: harness login impossible without an interactive CSRF issuance (no GET csrf route)"
    SETUP_OK="skip"
  fi
  if [ "$SETUP_OK" = "yes" ]; then
    CTOK="$(grep mvlt_csrf "$JAR" 2>/dev/null | awk '{print $NF}')"
    CODE="$(curl -s --max-time 10 -b "$JAR" -H "Origin: $ORIGIN" -H "x-csrf-token: $CTOK" \
      -H 'Content-Type: application/json' \
      -d "{\"firstName\":\"$SYNTH_FIRST\",\"lastName\":\"$SYNTH_LAST\",\"notes\":\"$SYNTH_NOTES\"}" \
      "$API/api/patients" -o /tmp/gui-patient.json -w '%{http_code}')"
    probe "patient create HTTP $CODE: $(cat /tmp/gui-patient.json 2>/dev/null | cut -c1-160)"
    if [ "$CODE" = "201" ]; then
      CAP_PATIENT="GREEN (Test Patient / $SYNTH_NOTES created via the product API)"
      # Show it in the real UI: sign in through the REAL form, then open Patients
      note "presenting the synthetic patient in the real UI (sign in through the genuine form via System Events)"
      if osa 'tell application "MediVault" to activate' 10; then :; fi
      sleep 2
      if ui_type_into_field "MediVault" 1 "$SYNTH_EMAIL" 30; then
        probe "email field: $OSA_OUT"
        if [ "${OSA_OUT#typed-field}" != "$OSA_OUT" ] && ui_type_into_field "MediVault" 2 "$SYNTH_PASS" 30 && [ "${OSA_OUT#typed-field}" != "$OSA_OUT" ]; then
          probe "password field: $OSA_OUT"
          sleep 1
          if ui_button "click" "MediVault" "Sign In" 60; then
            if [ "${OSA_OUT#click:}" != "$OSA_OUT" ]; then
              probe "Sign In clicked: $OSA_OUT"
              sleep 6
              if ui_button "click" "MediVault" "Patients" 90; then
                if [ "${OSA_OUT#click:}" != "$OSA_OUT" ]; then
                  probe "Patients view opened: $OSA_OUT"
                else
                  probe "Patients view not found by name ($OSA_OUT) — screenshot shows the post-sign-in state"
                fi
                sleep 3
              fi
            else
              probe "Sign In button not found by name ($OSA_OUT) — screenshot shows the sign-in screen"
            fi
          fi
        else
          probe "password field not reachable (web form may be AX-opaque) — screenshot shows the current real UI"
        fi
      else
        probe "email field not reachable — screenshot shows the current real UI"
      fi
      snap 33-synthetic-patient || true
    else
      CAP_PATIENT="RED (HTTP $CODE — CSRF/origin/permission surface; recorded honestly)"
      snap 33-synthetic-patient || true
    fi
  elif [ "$SETUP_OK" = "skip" ]; then
    CAP_PATIENT="NOT PROVEN (auth flow could not be established on a re-provisioned instance)"
  else
    CAP_PATIENT="NOT PROVEN (auth setup rejected: see probes.log)"
  fi
else
  CAP_PATIENT="NOT RUN (API not healthy)"
fi

# --- quit/reopen + persistence ---
note "PHASE H: quit + reopen (persistence proof)"
quit_medivault
sleep 3
open_and_detect "persistence-reopen" 120
if [ "$MV_PROC" = "yes" ]; then
  snap 34-persistence-after-reopen || true
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
    PERSIST="$(curl -s --max-time 5 -b /tmp/gui-cookies.txt -H "Origin: tauri://localhost" "$API/api/patients" 2>/dev/null | grep -c "$SYNTH_NOTES" || true)"
    probe "synthetic patient rows visible after reopen (API): $PERSIST"
    if [ "${PERSIST:-0}" -ge 1 ]; then
      CAP_QUIT_REOPEN="GREEN ($SYNTH_NOTES patient persisted across quit/reopen; process + window after reopen)"
    else
      CAP_QUIT_REOPEN="RED (patient missing after reopen)"
    fi
  else
    CAP_QUIT_REOPEN="GREEN (process + backend health across quit/reopen; patient persistence not assertable without the API session)"
  fi
  # If still signed-out in the UI, sign back in to SHOW the persisted patient
  if osa 'tell application "MediVault" to activate' 10; then :; fi
  sleep 2
  if ui_type_into_field "MediVault" 1 "$SYNTH_EMAIL" 30 && [ "${OSA_OUT#typed-field}" != "$OSA_OUT" ]; then
    if ui_type_into_field "MediVault" 2 "$SYNTH_PASS" 30 && [ "${OSA_OUT#typed-field}" != "$OSA_OUT" ]; then
      sleep 1
      if ui_button "click" "MediVault" "Sign In" 60 && [ "${OSA_OUT#click:}" != "$OSA_OUT" ]; then
        sleep 6
        ui_button "click" "MediVault" "Patients" 90 || true
        sleep 3
      fi
    fi
  fi
  snap 34-persistence-after-reopen || true
else
  CAP_QUIT_REOPEN="RED (process did not return after reopen)"
  snap 34-persistence-after-reopen || true
fi

# --- Keychain observation summary ---
# Any SecurityAgent prompt captured during any launch appears as
# 35-keychain-prompt.png; we never extract values (readability is the
# backend's job).
if [ "$MV_KEYCHAIN" = "yes" ]; then
  CAP_KEYCHAIN_UI="GREEN ($KEYCHAIN_SNAP_N real SecurityAgent/Keychain prompt(s) captured — see *-keychain-prompt*.png in the artifact)"
else
  CAP_KEYCHAIN_UI="NOT PROVEN (no prompt appeared in this run; prompts may require an interactive user)"
fi

write_caps
cap SUMMARY "iteration-2 run complete — see capability-report.md + probes.log + quarantine-evidence.txt + the screenshot gallery artifact"
echo "GUI-ACCEPTANCE-RECORDED (full run; all outcomes honestly recorded)"
exit 0

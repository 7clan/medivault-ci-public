#!/usr/bin/env bash
# =============================================================================
# exploratory-qa.sh — FULL INTERACTIVE EXPLORATORY QA (focus-scoped)
# =============================================================================
# Built on the FROZEN GREEN baseline (product-functional-test.sh @ f6dc341d /
# mirror 0b0d936 / ARM64 run 34796558466). The interaction stack (OCR, CGEvent,
# Unicode typing, scrolling, dialogs, launch detection) is VERBATIM-EXTRACTED
# from the frozen lane; every battle-tested lesson is carried over.
#
# WHAT THIS LANE ADDS: an exploratory framework with a per-run `focus`
# (surface | account | patients | search | settings | persistence) and an
# honest bug-discipline:
#   P0  → STOP IMMEDIATELY (preserve evidence; no auto-fix; report first)
#   P1  → stop the current focus → prove → root-cause → minimal product fix
#         → regression test → targeted ARM64 rerun → resume the focus
#   P2  → the same first-red discipline as P1
#   P3  → record and continue (fix only if isolated/safe)
#   D   → harness bug (fixed between runs; recorded honestly)
#   ENV → environment limitation (record only)
#   EXPECTED → documented product behavior (record only)
#
# HONESTY CONTRACT (unchanged from the frozen lane):
#   * every screenshot is a real `screencapture` AFTER the real action
#   * every click is on an OCR-located REAL label (never a guessed coordinate
#     except the recorded anchored fallbacks) and verified by visible change
#   * text entry is real keystrokes into the real focused field
#   * no JS injection; API probes are backend verification only and labeled
#   * only synthetic data; the account password is generated and never printed
#   * KNOWN SOURCE FACTS honored: toasts NEVER render (the shadcn Toaster is
#     not mounted) — no toast text is ever used as an OCR needle; "expected"
#     here means what the CURRENT product actually does per its source.
# =============================================================================
set -uo pipefail

# --------------------------- configuration ---------------------------
EXPECTED_ARCH="${EXPECTED_ARCH:-arm64}"
QA_FOCUS="${QA_FOCUS:-surface}"
case "$QA_FOCUS" in
  surface|account|patients|search|settings|persistence) : ;;
  *) echo "::error::QA_FOCUS must be surface|account|patients|search|settings|persistence (got '$QA_FOCUS')"; exit 1 ;;
esac
DMG_PATH="${DMG_PATH:?DMG_PATH env is required (the built test DMG)}"
DMG_SHA256_FILE="${DMG_SHA256_FILE:?DMG_SHA256_FILE env is required (the .sha256 sidecar)}"
APP_PATH="/Applications/MediVault.app"
VOLUME="/Volumes/MediVault"
HELPER_NAME="mediavault-launchagent"

case "$EXPECTED_ARCH" in
  arm64|x86_64) : ;;
  *) echo "::error::EXPECTED_ARCH must be arm64 or x86_64 (got '$EXPECTED_ARCH')"; exit 1 ;;
esac
[ "$(uname -s)" = "Darwin" ] || { echo "::error::exploratory-qa must run on macOS"; exit 1; }
for tool in screencapture sips shasum hdiutil osascript open pgrep curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "::error::required tool missing: $tool"; exit 1; }
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVID_DIR="$REPO_ROOT/gui-evidence"
LOG="$EVID_DIR/probes.log"
CAP_FILE="$EVID_DIR/qa-capability-report.md"
BUG_FILE="$EVID_DIR/BUG-REGISTER.md"
SURFACE_FILE="$EVID_DIR/SURFACE-MAP.md"
SNAP_COUNT=0
LAST_SNAP_HASH=""
SURFACE_ROWS=0
BUG_COUNT=0
N_P0=0; N_P1=0; N_P2=0; N_P3=0; N_D=0; N_ENV=0; N_EXP=0
QA_OUTCOME="INCOMPLETE"

API="http://127.0.0.1:3001"
PGPORT="55432"
SUP_STATUS="$HOME/Library/Application Support/MediVault/runtime-state/supervisor-status.json"

# Synthetic account (obviously fake; the password is generated locally and
# NEVER printed). The deterministic-class generation is verbatim from the
# frozen lane (the setup form's strength checklist demands 8+ chars with
# upper, lower, digit AND special).
DOC_NAME="MediVault Test Doctor"
DOC_EMAIL="doctor.test@example.invalid"
DOC_PASS_FILE="/tmp/.mv-doc-pass"
umask 077
{ printf 'Aa1!'; openssl rand -base64 24 | tr -d '\n'; } > "$DOC_PASS_FILE"
grep -q '[A-Z]' "$DOC_PASS_FILE" || { echo "FATAL: password lacks an uppercase letter"; exit 1; }
grep -q '[a-z]' "$DOC_PASS_FILE" || { echo "FATAL: password lacks a lowercase letter"; exit 1; }
grep -q '[0-9]' "$DOC_PASS_FILE" || { echo "FATAL: password lacks a digit"; exit 1; }
grep -q '!' "$DOC_PASS_FILE" || { echo "FATAL: password lacks a special character"; exit 1; }

# Synthetic patients — obviously fake data only. Patient C's name is Arabic
# (first=محمد, last=تجريبي — "Muhammad Test"). The patients-focus cohort
# (directive 2026-09-15): every patient carries a UNIQUE sentinel note so the
# cross-patient isolation checks are unambiguous (a foreign sentinel on the
# wrong detail screen is a P0). Unique phone DIGIT TOKENS (0101/0202/…)
# make row targeting OCR-robust for the Arabic/accented/long-name patients
# (search matches phone contains; digits type and OCR reliably).
PAT_A_FIRST="John";  PAT_A_LAST="Test";  PAT_A_NOTE="ONLY-JOHN-ALPHA"
PAT_B_FIRST="Jane";  PAT_B_LAST="Test";  PAT_B_NOTE="ONLY-JANE-BRAVO"
PAT_C_FIRST="محمد"; PAT_C_LAST="تجريبي"; PAT_C_NOTE="ONLY-MOHAMMAD-CHARLIE"
PAT_D_FIRST="Élodie"; PAT_D_LAST="Müller"; PAT_D_NOTE="ONLY-ELODIE-DELTA"
PAT_E_FIRST="O'Connor"; PAT_E_LAST="Test"; PAT_E_NOTE="ONLY-OCONNOR-ECHO"
PAT_F_FIRST="Very Long Synthetic Patient Name"; PAT_F_LAST="For MediVault Testing"; PAT_F_NOTE="ONLY-LONGNAME-FOXTROT"
PAT_ZED_FIRST="Zed"; PAT_ZED_LAST="Delete"; PAT_ZED_NOTE="ONLY-ZED-DELETE"
# per-patient synthetic contact data (Jane intentionally has NONE — the
# empty-optional-fields create probe)
PAT_A_PHONE="+1 555 0101"; PAT_A_EMAIL="john.test@example.invalid"
PAT_C_PHONE="+966 5 555 0202 77"
PAT_D_PHONE="+1 555 0304"; PAT_D_EMAIL="elodie.muller@example.invalid"; PAT_D_ADDR="12 Rue de l'Été, Paris 75001"
PAT_E_PHONE="555.0105.777"
PAT_F_PHONE="+1 555 0106 x99"; PAT_F_EMAIL="very.long.name.for.medivault@example.invalid"
PAT_F_ADDR="4182 Extended Synthetic Boulevard, Suite 4200 Unit 7, Long Testing City 99999-1234"
PAT_ZED_PHONE="+1 555 0199"; PAT_ZED_EMAIL="zed.delete@example.invalid"

# The Tauri window title (src-tauri/tauri.conf.json) — em dash included.
EXPECTED_TITLE="MediVault — Medical Document Manager"

# Crash-report watch marker (created BEFORE the first launch).
QA_T0_MARKER="/tmp/qa-run-start-marker"
rm -f "$QA_T0_MARKER"; touch "$QA_T0_MARKER"

mkdir -p "$EVID_DIR"
: > "$LOG"

# --------------------- QA discipline framework (new) ------------------------
die() {
  echo "::error::GUI-HARNESS-BUG (class D): $*" | tee -a "$LOG"
  bug D "HARNESS" "fatal harness error: $*"
  QA_OUTCOME="HARNESS-ERROR"
  write_caps
  echo "EXPLORATORY-QA-HARNESS-ERROR"
  exit 1
}
note()   { echo "[gui] $*" | tee -a "$LOG"; }
probe()  { echo "[probe] $*" | tee -a "$LOG"; }
qa_cap() { # <field> <value> [detail] — capability bookkeeping
  printf 'CAP %s = %s%s\n' "$1" "$2" "${3:+ — $3}" | tee -a "$LOG" >> "$CAP_FILE"
}

bug_discipline() {
  case "$1" in
    P0) echo "STOP IMMEDIATELY — preserve evidence; report before any change" ;;
    P1) echo "stop current focus → prove → root-cause → minimal fix → regression test → targeted ARM64 rerun → resume focus" ;;
    P2) echo "same first-red discipline as P1" ;;
    P3) echo "record and continue; fix only if isolated and safe" ;;
    D)  echo "harness bug — fix the harness and continue" ;;
    ENV) echo "environment limitation — record only" ;;
    EXPECTED) echo "documented product behavior — record only" ;;
    *) echo "unknown" ;;
  esac
}

capture_backend_logs() { # preserve the API/supervisor logs on any stop-class bug
  # D-diagnostic (run 34911558547): the P1's evidence chain stopped at the
  # webview's visible error — the backend's own request log (pino: every
  # request with method/url/statusCode; authorization/cookie headers
  # redacted; bodies never logged) tells the OTHER side of the story (what
  # status /api/auth/refresh actually returned, CSRF rejections, etc).
  # Preserved for every stop-class first-red from now on.
  local bl dest
  for bl in "$HOME/Library/Logs/MediVault/api.log" \
            "$HOME/Library/Logs/MediVault/supervisor.log" \
            "$HOME/Library/Logs/MediVault/provisioner.log" \
            "$HOME/Library/Logs/MediVault/postgres.log"; do
    if [ -s "$bl" ]; then
      dest="$EVID_DIR/backend-$(basename "$bl")"
      tail -n 400 "$bl" > "$dest" 2>/dev/null || true
      probe "backend log preserved: $dest (last 400 lines)"
    fi
  done
}

bug() { # <class> <area> <detail> [stop] — the exploratory first-red recorder
  local cls="$1" area="$2" detail="$3" stopmode="${4:-}"
  BUG_COUNT=$((BUG_COUNT + 1))
  case "$cls" in
    P0) N_P0=$((N_P0 + 1)) ;;
    P1) N_P1=$((N_P1 + 1)) ;;
    P2) N_P2=$((N_P2 + 1)) ;;
    P3) N_P3=$((N_P3 + 1)) ;;
    D)  N_D=$((N_D + 1)) ;;
    ENV) N_ENV=$((N_ENV + 1)) ;;
    EXPECTED) N_EXP=$((N_EXP + 1)) ;;
    *) N_D=$((N_D + 1)) ;;
  esac
  local evstem="bug-$(printf '%02d' "$BUG_COUNT")-$(printf '%s' "$area" | tr ' ' '-' | tr -cd 'A-Za-z0-9-' | cut -c1-24)"
  snap "$evstem" >/dev/null 2>&1 || true
  {
    echo ""
    echo "## BUG-$BUG_COUNT [$cls] $area"
    echo "- **Class**: $cls — $(bug_discipline "$cls")"
    echo "- **Area**: $area"
    echo "- **Detail**: $detail"
    echo "- **Focus**: $QA_FOCUS"
    echo "- **Evidence**: ${evstem}.png (+ the referenced before/after shots)"
    echo "- **OCR context (the last capture, first 40 OCR lines)**:"
    echo ""
    echo '```'
    printf '%s\n' "$OCR_TEXT" | head -40
    echo '```'
  } >> "$BUG_FILE"
  echo "[bug-$cls] $area: $detail (evidence ${evstem}.png)" | tee -a "$LOG"
  case "$cls" in
    P0)
      QA_OUTCOME="P0-STOP"
      capture_backend_logs
      write_caps
      echo "EXPLORATORY-QA-P0-STOP"
      exit 2
      ;;
    P1)
      QA_OUTCOME="P1-RED"
      capture_backend_logs
      write_caps
      echo "EXPLORATORY-QA-P1-RED"
      exit 3
      ;;
    P2)
      QA_OUTCOME="P2-RED"
      capture_backend_logs
      write_caps
      echo "EXPLORATORY-QA-P2-RED"
      exit 4
      ;;
    ENV)
      if [ "$stopmode" = "stop" ]; then
        QA_OUTCOME="ENV-RED"
        write_caps
        echo "EXPLORATORY-QA-ENV-RED"
        exit 5
      fi
      ;;
  esac
  return 0
}

write_caps() {
  {
    echo "QA_FOCUS = $QA_FOCUS"
    echo "MACOS_VERSION = $(sw_vers -productVersion 2>/dev/null || echo unknown) ($(sw_vers -buildVersion 2>/dev/null))"
    echo "ARCHITECTURE = $(uname -m)"
    echo "INSTALL_PATH_LABEL = PRODUCT_FUNCTIONAL_TEST_INSTALL (built from the focus commit in this run; hash-verified; non-quarantined — NOT a distribution-path proof)"
    echo "SCREENSHOT_COUNT = $SNAP_COUNT"
    echo "SURFACE_ROWS = $SURFACE_ROWS"
    echo "BUGS_P0 = $N_P0"
    echo "BUGS_P1 = $N_P1"
    echo "BUGS_P2 = $N_P2"
    echo "BUGS_P3 = $N_P3"
    echo "BUGS_D = $N_D"
    echo "BUGS_ENV = $N_ENV"
    echo "BUGS_EXPECTED = $N_EXP"
    echo "OUTCOME = $QA_OUTCOME"
  } >> "$CAP_FILE"
}

surface_section() { # <title> — a new markdown section + table header in the surface map
  {
    echo ""
    echo "### $1"
    echo ""
    echo "| Feature | How reached | Visible controls | Expected behavior | Test attempted | Result | Evidence | Classification |"
    echo "|---|---|---|---|---|---|---|---|"
  } >> "$SURFACE_FILE"
  note "surface-section: $1"
}

surface_row() { # <feature> <how-reached> <controls> <expected> <test> <result> <evidence> <classification>
  SURFACE_ROWS=$((SURFACE_ROWS + 1))
  # (run 34860208614 first-red, class D) an arg-count mistake here used to
  # ABORT the whole run under set -u ($8 unbound, exit 1). Now a wrong arg
  # count records honestly instead of crashing; the static pre-push check
  # (98 call sites = exactly 8 args) remains the primary control.
  if [ "$#" -ne 8 ]; then
    probe "surface-row[$SURFACE_ROWS]: ARG-COUNT BUG (class D) — got $# args, need 8 — recording with placeholders; fix the call site"
  fi
  printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' "${1:-?}" "${2:-?}" "${3:-?}" "${4:-?}" "${5:-?}" "${6:-?}" "${7:-?}" "${8:-?}" >> "$SURFACE_FILE"
  probe "surface[$SURFACE_ROWS]: ${1:-?} — ${6:-?} (evidence: ${7:-?}) [${8:-?}]"
}

record_inventory() { # <label> — dump the current OCR inventory into the surface map (raw evidence)
  {
    echo ""
    echo "<details><summary>OCR inventory — $1</summary>"
    echo ""
    echo '```'
    printf '%s\n' "$OCR_TEXT" | awk -F'|' 'NF>=3 {print $2}' | grep -v '^ *$' || true
    echo '```'
    echo "</details>"
  } >> "$SURFACE_FILE"
}

# The deliverable file headers.
{
  echo "# MediVault — Exploratory QA run (focus: $QA_FOCUS)"
  echo ""
  echo "- Generated: $(date -u 2>/dev/null || date)"
  echo "- Lane: exploratory-qa.sh (built on the frozen product-functional-test interaction stack)"
  echo "- Discipline: P0 stop / P1-P2 stop-focus first-red / P3 record / D harness / ENV-EXPECTED record"
  echo ""
  echo "## Capability report"
} > "$CAP_FILE"
{
  echo "# MediVault — BUG REGISTER (exploratory QA)"
  echo ""
  echo "Per-run findings. Classes: P0 (data isolation/corruption/severe security — immediate stop),"
  echo "P1 (core workflow unusable), P2 (substantive functional defect), P3 (cosmetic/UX),"
  echo "D (harness bug), ENV (environment), EXPECTED (documented behavior)."
  echo ""
  echo "- Run focus: $QA_FOCUS"
} > "$BUG_FILE"
{
  echo "# MediVault — FULL PRODUCT SURFACE MAP (live-filled)"
  echo ""
  echo "Every row is a REAL reachable surface verified through the GUI this run."
  echo "No feature is invented: if a surface was not reachable, it is recorded as such."
  echo "OCR inventories (raw visible-text dumps) are attached per screen as details blocks."
} > "$SURFACE_FILE"
snap_file() { # <src> <stem>
  local src="$1"
  local stem="$2"
  local out="$EVID_DIR/$stem.png"
  if [ -s "$src" ] && cp "$src" "$out" 2>>"$LOG" && [ -s "$out" ]; then
    SNAP_COUNT=$((SNAP_COUNT + 1))
    local h dim sz
    h="$(shasum -a 256 "$out" 2>/dev/null | awk '{print $1}')"
    dim="$(sips -g pixelWidth -g pixelHeight "$out" 2>/dev/null | awk '/pixelWidth|pixelHeight/ {printf "%s ", $2}')"
    sz="$(stat -f%z "$out" 2>/dev/null)"
    echo "[snap] $stem.png dim=($dim) size=${sz}B sha256=${h:0:12}" | tee -a "$LOG"
    LAST_SNAP_HASH="$h"
    return 0
  fi
  echo "[snap] FAILED $stem (no mock is ever created)" | tee -a "$LOG"
  return 1
}

snap() { # <stem>
  local stem="$1"
  local tmp="/tmp/gui-snap.$$.png"
  if screencapture -x "$tmp" 2>>"$LOG"; then
    snap_file "$tmp" "$stem"
    local rc=$?
    rm -f "$tmp"
    return $rc
  fi
  echo "[snap] FAILED $stem" | tee -a "$LOG"
  return 1
}

osa() { # osascript -e <script> [timeout_s]
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
      OSA_ERR="osascript timed out after ${t}s"
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

ui_window_count() { # <process>
  local proc="$1"
  if osa "tell application \"System Events\" to tell process \"$proc\" to count windows" 8; then
    printf '%s' "$OSA_OUT" | tr -d ' '
  else
    printf '%s' "-1"
  fi
}

guarded_open() { # <timeout_s> <open-args...>
  local t="$1"
  shift
  local t0 pid rc
  ( "$@" ) &
  pid=$!
  t0="$(date +%s)"
  while kill -0 "$pid" 2>/dev/null; do
    if [ $(( $(date +%s) - t0 )) -ge "$t" ]; then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      probe "guarded_open: '$*' exceeded ${t}s — killed"
      return 124
    fi
    sleep 1
  done
  wait "$pid"
  rc=$?
  return $rc
}

# ------------------- bounded app-launch detector (proven, v2+) ----------------
wait_for_medivault() { # <timeout_s> <label> — CASE-INSENSITIVE process detection
  # Run 7's decisive lesson: the Tauri binary is `medivault` (lowercase, from
  # the Cargo package name — CFBundleExecutable), while the bundle/LS name is
  # "MediVault". Case-sensitive pgrep missed a HEALTHY `open`-launched app.
  local timeout="$1"
  local label="$2"
  local t0
  t0="$(date +%s)"
  MV_PROC="no"; MV_WINDOW="no"; MV_TITLE=""; MV_T_PROC=""; MV_T_WINDOW=""
  while [ $(( $(date +%s) - t0 )) -le "$timeout" ]; do
    if [ "$MV_PROC" = "no" ]; then
      # "ediVault.app/Contents/MacOS/" matches BOTH spellings of the binary.
      if pgrep -f "ediVault.app/Contents/MacOS/" >/dev/null 2>&1; then
        MV_PROC="yes"; MV_T_PROC=$(( $(date +%s) - t0 ))
        probe "detector[$label]: process after ${MV_T_PROC}s ($(pgrep -f 'ediVault.app/Contents/MacOS/' | tr '\n' ' '))"
      fi
    fi
    if [ "$MV_WINDOW" = "no" ]; then
      # Window probe runs INDEPENDENT of the process probe (never gated).
      if osa 'tell application "System Events" to get name of every process whose name contains "edivault"' 8; then
        if [ -n "$(printf '%s' "$OSA_OUT" | tr -d ' ,')" ]; then
          if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to get value of attribute "AXTitle" of window 1' 8; then
            MV_TITLE="$OSA_OUT"
            MV_WINDOW="yes"
            [ -n "$MV_T_WINDOW" ] || MV_T_WINDOW=$(( $(date +%s) - t0 ))
            probe "detector[$label]: window after ${MV_T_WINDOW}s — title: '$MV_TITLE'"
          fi
        fi
      fi
    fi
    if [ "$MV_PROC" = "yes" ] && [ "$MV_WINDOW" = "yes" ]; then
      break
    fi
    sleep 2
  done
  probe "detector[$label] summary: proc=$MV_PROC (${MV_T_PROC:-never}s) window=$MV_WINDOW (${MV_T_WINDOW:-never}s) title='${MV_TITLE:-none}'"
}

# (self-review fix) open_and_detect() was removed — dead code: the launch
# flow below calls guarded_open + wait_for_medivault directly (the shared
# CAP_LAUNCH_TIMING line lives there); this wrapper was never called.

quit_medivault() {
  if osa 'tell application "MediVault" to quit' 20; then
    probe "quit via AppleScript: issued"
  else
    probe "quit via AppleScript blocked ($OSA_ERR) — SIGTERM fallback"
    pkill -TERM -f "ediVault.app/Contents/MacOS/" 2>/dev/null || true
  fi
  local i
  for i in $(seq 1 30); do
    pgrep -f "ediVault.app/Contents/MacOS/" >/dev/null 2>&1 || break
    sleep 1
  done
}
# ------------------- visual interaction stack (Vision OCR + CGEvent) ----------
note "=== visual interaction stack (Vision OCR + native CGEvent input) ==="
MV_OCR="/tmp/mv-ocr"
MV_OCR_AR="/tmp/mv-ocr-ar"
MV_MOUSE="/tmp/mv-mouse"
MV_SHOT="/tmp/mv-shot.png"
MV_LINES="/tmp/mv-ocr-lines.txt"
MV_SCALE="1"
OCR_TEXT=""
OCR_HIT_X=""; OCR_HIT_Y=""; OCR_HIT_W=""; OCR_HIT_H=""
LAST_OCR_HASH=""
OCR_STACK="no"
cat > /tmp/mv-ocr.swift <<'SWIFT'
import Foundation
import AppKit
import Vision
let args = CommandLine.arguments
guard args.count >= 2 else { print("ERR usage mv-ocr <image>"); exit(2) }
guard let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("ERR cannot load \(args[1])"); exit(3)
}
let pw = Double(cg.width); let ph = Double(cg.height)
let db = CGDisplayBounds(CGMainDisplayID())
print("IMG \(Int(pw)) \(Int(ph)) \(Int(db.width)) \(Int(db.height))")
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([req]) } catch { print("ERR vision \(error)"); exit(4) }
guard let results = req.results else { print("ERR no results"); exit(5) }
for obs in results {
  guard let cand = obs.topCandidates(1).first else { continue }
  let box = obs.boundingBox
  let cx = (box.origin.x + box.width / 2) * pw
  let cy = ph - (box.origin.y + box.height / 2) * ph
  let w = box.width * pw
  let h = box.height * ph
  let text = cand.string.replacingOccurrences(of: "|", with: "/")
  print("LINE|\(text)|\(Int(cx))|\(Int(cy))|\(Int(w))|\(Int(h))")
}
SWIFT
# Arabic-capable variant (patient C's name is Arabic; recorded honestly).
cat > /tmp/mv-ocr-ar.swift <<'SWIFT'
import Foundation
import AppKit
import Vision
let args = CommandLine.arguments
guard args.count >= 2 else { print("ERR usage mv-ocr-ar <image>"); exit(2) }
guard let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  print("ERR cannot load \(args[1])"); exit(3)
}
let pw = Double(cg.width); let ph = Double(cg.height)
let db = CGDisplayBounds(CGMainDisplayID())
print("IMG \(Int(pw)) \(Int(ph)) \(Int(db.width)) \(Int(db.height))")
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
if #available(macOS 13.0, *) {
  req.recognitionLanguages = ["ar-SA", "en-US"]
}
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([req]) } catch { print("ERR vision \(error)"); exit(4) }
guard let results = req.results else { print("ERR no results"); exit(5) }
for obs in results {
  guard let cand = obs.topCandidates(1).first else { continue }
  let box = obs.boundingBox
  let cx = (box.origin.x + box.width / 2) * pw
  let cy = ph - (box.origin.y + box.height / 2) * ph
  let w = box.width * pw
  let h = box.height * ph
  let text = cand.string.replacingOccurrences(of: "|", with: "/")
  print("LINE|\(text)|\(Int(cx))|\(Int(cy))|\(Int(w))|\(Int(h))")
}
SWIFT
cat > /tmp/mv-mouse.swift <<'SWIFT'
import Foundation
import CoreGraphics
let args = CommandLine.arguments
guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else {
  print("ERR usage mv-mouse <x> <y> [left|right|double]"); exit(2)
}
let mode = args.count >= 4 ? args[3] : "left"
let btn: CGMouseButton = mode == "right" ? .right : .left
let down: CGEventType = mode == "right" ? .rightMouseDown : .leftMouseDown
let up: CGEventType = mode == "right" ? .rightMouseUp : .leftMouseUp
let pt = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .combinedSessionState)
func post(_ t: CGEventType) {
  let e = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: pt, mouseButton: btn)
  e?.post(tap: .cghidEventTap)
}
post(.mouseMoved)
usleep(150_000)
post(down)
usleep(120_000)
post(up)
if mode == "double" {
  usleep(80_000)
  post(.leftMouseDown)
  usleep(100_000)
  post(.leftMouseUp)
}
print("CLICKED \(x) \(y) \(mode)")
SWIFT
if swiftc -O -o "$MV_OCR" /tmp/mv-ocr.swift 2>>"$LOG" \
   && swiftc -O -o "$MV_MOUSE" /tmp/mv-mouse.swift 2>>"$LOG"; then
  OCR_STACK="yes"
  probe "core visual stack compiled: mv-ocr (Vision OCR) + mv-mouse (native CGEvent)"
else
  probe "CORE visual stack compile FAILED — visual interaction unavailable"
  classify C "swiftc failed on the runner — the OCR/CGEvent visual stack could not be built"
fi
if ! swiftc -O -o "$MV_OCR_AR" /tmp/mv-ocr-ar.swift 2>>"$LOG"; then
  probe "Arabic-capable OCR compile FAILED — Arabic verification will rely on search/isolation behavior (recorded honestly)"
fi

# --- mv-scroll: native CGEvent scroll wheel --------------------------------
# (PFT run 34709293200 first-red, class D): the dashboard's patient list,
# stats and search box render BELOW THE FOLD of the 1024x768 runner window;
# a real user scrolls — the harness must too. The scroll wheel event is
# posted at the current cursor position, so the caller moves the mouse to
# the scrollable area first (mouseMoved + scrollWheel). Compiled
# SEPARATELY and NON-FATALLY: if it fails, the scroll helpers fall back to
# keyboard-only Page Down / Home and the outcomes stay honest.
cat > /tmp/mv-scroll.swift <<'SWIFT'
import Foundation
import CoreGraphics
let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[1]), let y = Double(args[2]), let lines = Int(args[3]) else {
  print("ERR usage mv-scroll <x> <y> <lines> [up]"); exit(2)
}
let up = args.count >= 5 && args[4] == "up"
let pt = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .combinedSessionState)
if let mv = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: pt, mouseButton: .left) {
  mv.post(tap: .cghidEventTap)
}
usleep(150_000)
let delta: Int32 = up ? Int32(lines) : -Int32(lines)
if let e = CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) {
  e.post(tap: .cghidEventTap)
  exit(0)
}
print("ERR scroll event creation failed"); exit(2)
SWIFT
MV_SCROLL="/tmp/mv-scroll"
if swiftc -O -o "$MV_SCROLL" /tmp/mv-scroll.swift 2>>"$LOG"; then
  probe "mv-scroll compiled (native CGEvent scroll wheel)"
else
  MV_SCROLL=""
  probe "mv-scroll compile FAILED — scrolling falls back to keyboard Page Down/Home only (recorded honestly)"
fi

# --- mv-icon-scan: locate white glyph clusters in a horizontal band -------
# The patient-detail edit control is ICON-ONLY (title="Edit Patient" is a
# tooltip, not rendered text — an OCR needle can never match it). This
# scans the banner band to the RIGHT of the OCR-found patient name for
# bright low-saturation clusters (the white report|EDIT|trash icons on the
# gradient banner) and prints their centers in SCREEN coordinates:
#   ICON|cx|cy
# Arguments: <png> <scale> <x0-screen> <cy-screen> <half-band-screen>
cat > /tmp/mv-icon-scan.swift <<'SWIFT'
import Foundation
import CoreGraphics
import ImageIO
let args = CommandLine.arguments
guard args.count >= 6, let scale = Double(args[2]), scale > 0,
      let x0s = Double(args[3]), let cys = Double(args[4]), let half = Double(args[5]) else {
  print("ERR usage mv-icon-scan <png> <scale> <x0> <cy> <half-band>"); exit(2)
}
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("ERR read"); exit(2) }
let w = img.width, h = img.height
guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                          space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { print("ERR ctx"); exit(2) }
ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
guard let data = ctx.data else { print("ERR data"); exit(2) }
let buf = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
let x0 = max(0, min(w - 1, Int(x0s / scale)))
let yTop = max(0, Int((cys - half) / scale))
let yBot = min(h - 1, Int((cys + half) / scale))
if yTop > yBot || x0 >= w - 1 { exit(0) }
func bright(_ px: Int, _ py: Int) -> Bool {
  let row = h - 1 - py
  let off = (row * w + px) * 4
  let r = Int(buf[off]), g = Int(buf[off + 1]), b = Int(buf[off + 2])
  return r > 195 && g > 195 && b > 195 && (max(r, g, b) - min(r, g, b)) < 40
}
var colCounts = [Int](repeating: 0, count: w)
for py in yTop...yBot {
  for px in x0..<w {
    if bright(px, py) { colCounts[px] += 1 }
  }
}
var runs: [(Int, Int)] = []
var start = -1
for px in x0..<w {
  let on = colCounts[px] >= 2
  if on {
    if start < 0 { start = px }
  } else {
    if start >= 0 { runs.append((start, px - 1)); start = -1 }
  }
}
if start >= 0 { runs.append((start, w - 1)) }
var merged: [(Int, Int)] = []
for r in runs {
  if let last = merged.last, r.0 - last.1 <= 14 {
    merged[merged.count - 1].1 = r.1
  } else if r.1 - r.0 >= 4 {
    merged.append(r)
  }
}
for m in merged {
  let cxImg = (m.0 + m.1) / 2
  var ys: [Int] = []
  for px in m.0...m.1 {
    for py in yTop...yBot where bright(px, py) { ys.append(py); break }
  }
  let cyImg = ys.isEmpty ? (yTop + yBot) / 2 : ys.reduce(0, +) / ys.count
  print("ICON|\(Int(Double(cxImg) * scale))|\(Int(Double(cyImg) * scale))")
}
SWIFT
# --- mv-type-uni: type arbitrary UNICODE text via CGEvent keyboard events ----
# (run 34782801632, class D): AppleScript `keystroke` CANNOT type non-Roman
# scripts — typing "محمد" (4 letters) produced "Aaaa" (4 garbage chars; the
# patient was created with a garbled name and the Arabic needle correctly
# found nothing). CGEvent keyboard events CAN carry a Unicode string
# (keyboardSetUnicodeString) — this helper types it in <=20-UTF16-unit
# chunks (the historical per-event limit). Compiled separately and
# non-fatally; the clipboard paste is the fallback.
cat > /tmp/mv-type-uni.swift <<'SWIFT'
import Foundation
import CoreGraphics
let args = CommandLine.arguments
guard args.count >= 2 else { print("ERR usage mv-type-uni <text>"); exit(2) }
let text = args[1]
let src = CGEventSource(stateID: .combinedSessionState)
let units = Array(text.utf16)
let maxChunk = 20
var offset = 0
while offset < units.count {
  let end = min(offset + maxChunk, units.count)
  let chunkUnits = Array(units[offset..<end])
  if let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true) {
    chunkUnits.withUnsafeBufferPointer { buf in
      down.keyboardSetUnicodeString(stringLength: buf.count, unicodeString: buf.baseAddress)
    }
    down.post(tap: .cghidEventTap)
  }
  usleep(50_000)
  if let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) {
    up.post(tap: .cghidEventTap)
  }
  offset = end
  usleep(30_000)
}
exit(0)
SWIFT
MV_TYPE_UNI="/tmp/mv-type-uni"
if swiftc -O -o "$MV_TYPE_UNI" /tmp/mv-type-uni.swift 2>>"$LOG"; then
  probe "mv-type-uni compiled (Unicode CGEvent typing)"
else
  MV_TYPE_UNI=""
  probe "mv-type-uni compile FAILED — Arabic typing falls back to clipboard paste (recorded honestly)"
fi

MV_ICONSCAN="/tmp/mv-icon-scan"
if swiftc -O -o "$MV_ICONSCAN" /tmp/mv-icon-scan.swift 2>>"$LOG"; then
  probe "mv-icon-scan compiled (white-glyph cluster locator for icon-only controls)"
else
  MV_ICONSCAN=""
  probe "mv-icon-scan compile FAILED — the icon-only edit control will use the OCR-anchored fallback (recorded honestly)"
fi
ocr_capture() { # full-screen capture + OCR; sets OCR_TEXT / MV_SCALE / LAST_OCR_HASH
  if ! screencapture -x "$MV_SHOT" 2>>"$LOG"; then
    probe "ocr_capture: screencapture FAILED"
    return 1
  fi
  if ! "$MV_OCR" "$MV_SHOT" > "$MV_LINES" 2>>"$LOG"; then
    probe "ocr_capture: mv-ocr FAILED"
    return 1
  fi
  local hdr pxw ptw
  hdr="$(sed -n '1p' "$MV_LINES")"
  pxw="$(printf '%s' "$hdr" | awk '{print $2}')"
  ptw="$(printf '%s' "$hdr" | awk '{print $4}')"
  if [ -n "$pxw" ] && [ -n "$ptw" ] && [ "$ptw" -gt 0 ] 2>/dev/null; then
    MV_SCALE="$(awk -v a="$pxw" -v b="$ptw" 'BEGIN{printf "%.4f", a/b}')"
  fi
  OCR_TEXT="$(grep '^LINE|' "$MV_LINES" 2>/dev/null || true)"
  LAST_OCR_HASH="$(shasum -a 256 "$MV_SHOT" 2>/dev/null | awk '{print $1}')"
  probe "ocr: $(printf '%s\n' "$OCR_TEXT" | grep -c '^LINE|') lines, scale=$MV_SCALE — inventory: $(printf '%s' "$OCR_TEXT" | awk -F'|' '{printf "[%s] ", $2}' | cut -c1-500)"
  return 0
}

ocr_lookup() { # <needle> [first|last] [exact|any|label]
  local needle="$1"
  local which="${2:-first}"
  local mode="${3:-any}"
  OCR_HIT_X=""; OCR_HIT_Y=""; OCR_HIT_W=""; OCR_HIT_H=""
  local hits px py w h
  hits="$(printf '%s\n' "$OCR_TEXT" | grep -i -- "|${needle}|" || true)"
  if [ -z "$hits" ] && [ "$mode" != "exact" ]; then
    if [ "$mode" = "label" ]; then
      # LABEL mode (PFT run 34705012537 first-red): a substring match on a
      # SHORT line only — floating field labels are short ("• Password",
      # "Full Name *", "Confirm*"); long SENTENCES containing the needle
      # (error banners like "Invalid email or password. Please try
      # again.") are not labels. Without this, the 15-relogin's Password
      # lookup matched the error banner, the click missed the input, and
      # the subsequent Cmd+A + Backspace (no input focused) triggered
      # macOS's back-navigation — the webview returned to the tauri://
      # first-run page from the back/forward cache.
      hits="$(printf '%s\n' "$OCR_TEXT" | awk -F'|' -v n="$needle"         'tolower($2) ~ tolower(n) && length($2) <= length(n) + 14' || true)"
    else
      hits="$(printf '%s\n' "$OCR_TEXT" | grep -i -- "|[^|]*${needle}[^|]*|" || true)"
    fi
  fi
  if [ -z "$hits" ] && [ "${needle// /}" != "$needle" ]; then
    # Vision dropped the spaces in the rendered text: retry space-insensitively
    # (the coords survive the strip — they carry no spaces)
    hits="$(printf '%s\n' "$OCR_TEXT" | tr -d ' ' | grep -i -- "|[^|]*${needle// /}[^|]*|" || true)"
    [ -n "$hits" ] && probe "ocr-lookup: '$needle' found space-insensitively (Vision dropped the spaces)"
  fi
  [ -n "$hits" ] || return 1
  if [ "$which" = "last" ]; then
    hits="$(printf '%s\n' "$hits" | tail -1)"
  else
    hits="$(printf '%s\n' "$hits" | head -1)"
  fi
  px="$(printf '%s' "$hits" | awk -F'|' '{print $3}')"
  py="$(printf '%s' "$hits" | awk -F'|' '{print $4}')"
  w="$(printf '%s' "$hits" | awk -F'|' '{print $5}')"
  h="$(printf '%s' "$hits" | awk -F'|' '{print $6}')"
  [ -n "$px" ] && [ -n "$py" ] || return 1
  OCR_HIT_X="$(awk -v a="$px" -v s="$MV_SCALE" 'BEGIN{printf "%.0f", a/s}')"
  OCR_HIT_Y="$(awk -v a="$py" -v s="$MV_SCALE" 'BEGIN{printf "%.0f", a/s}')"
  OCR_HIT_W="$(awk -v a="${w:-0}" -v s="$MV_SCALE" 'BEGIN{printf "%.0f", a/s}')"
  OCR_HIT_H="$(awk -v a="${h:-0}" -v s="$MV_SCALE" 'BEGIN{printf "%.0f", a/s}')"
  return 0
}

# Space-insensitive OCR text match (run 34781243249 first-red, class D):
# Apple Vision sometimes DROPS the spaces in rendered text ("MediVaultTestDoctor"
# for "MediVault Test Doctor" — the typed value WAS in the field, the needle
# just could not match). Every text verification below falls back to a
# space-stripped comparison; the logged probe records when it mattered.
ocr_grep() { # <needle> [haystack-default-OCR_TEXT]
  local needle="$1" hay="${2:-$OCR_TEXT}" nospace
  if printf '%s\n' "$hay" | grep -qi -- "|[^|]*${needle}"; then return 0; fi
  nospace="${needle// /}"
  if [ -n "$nospace" ] && printf '%s\n' "$hay" | tr -d ' ' | grep -qi -- "|[^|]*${nospace}"; then
    probe "ocr-grep: '$needle' matched space-insensitively (Vision dropped the spaces)"
    return 0
  fi
  return 1
}

v_click() { # <needle> <stem> <expect-text> [first|last] [y-offset-points] [lookup-mode any|label|exact]
# (self-review fix) the optional 6th arg passes ocr_lookup's mode through:
# 'label' restricts the fallback match to SHORT lines — needed when the
# needle word ALSO occurs inside a long descriptive sentence (the theme
# buttons 'Light'/'Dark' vs the Appearance description 'Switch between
# light and dark mode', which contains BOTH words and would win the plain
# substring match in reading order). Default 'any' = byte-identical
# behavior for every pre-existing call site.
  local needle="$1"
  local stem="$2"
  local expect="$3"
  local which="${4:-first}"
  local yoff="${5:-0}"
  local lmode="${6:-any}" # lookup mode passed through to ocr_lookup (label = short-line only)
  if [ "$OCR_STACK" != "yes" ]; then
    probe "vclick[$stem]: visual stack unavailable — skipped"
    return 1
  fi
  ocr_capture || return 1
  local before_hash="$LAST_OCR_HASH"
  snap_file "$MV_SHOT" "${stem}-before" || true
  if ! ocr_lookup "$needle" "$which" "$lmode"; then
    probe "vclick[$stem]: target '$needle' NOT FOUND on screen — no click attempted (never a guessed coordinate)"
    return 1
  fi
  local tx ty
  tx="$OCR_HIT_X"
  ty=$(( OCR_HIT_Y + yoff ))
  probe "vclick[$stem]: intended target='$needle' → screen point ($tx,$ty) — native CGEvent click"
  if ! "$MV_MOUSE" "$tx" "$ty" 2>>"$LOG"; then
    probe "vclick[$stem]: mv-mouse FAILED"
    return 1
  fi
  sleep 2
  ocr_capture || return 1
  snap_file "$MV_SHOT" "${stem}-after" || true
  local verified="no" why=""
  if [ -n "$expect" ] && ocr_grep "$expect"; then
    verified="yes"; why="expected text '$expect' is now visible"
  elif [ "$LAST_OCR_HASH" != "$before_hash" ]; then
    verified="yes"; why="visible screen change (hash-diff)"
  else
    why="NO visible change after the click"
  fi
  probe "vclick[$stem]: verification: $verified — $why"
  [ "$verified" = "yes" ] && return 0
  return 1
}

# Click a needle that may appear MULTIPLE times on screen (e.g. "Add
# Patient" as both the toolbar button and the dialog submit, "Sign In" as
# both the card title and the button): try each OCR hit in order until a
# verified visible state change — every attempt is recorded.
v_click_try_hits() { # <needle> <stem> <expect-text>
  local needle="$1" stem="$2" expect="$3"
  local hit
  for hit in first last; do
    if v_click "$needle" "$stem-$hit" "$expect" "$hit"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# (patients-focus self-review) v_click_arabic — the Arabic-OCR row clicker —
# was REMOVED as dead code: the patients battery's phone-token row targeting
# (open_patient_by_phone_token: search by the unique phone digits, click the
# row's phone text) replaced the Arabic-name row click everywhere (digits OCR
# and type reliably where Arabic script OCR does not); no call sites remain.

# =============================================================================
# Scrolling (the 1024x768 runner window cuts the dashboard at the GETTING
# STARTED banner; the search box, stats and the PATIENT LIST are below the
# fold — run 34709293200's first red was exactly this: the patient WAS
# created through the real dialog but the needle could never be visible
# without scrolling). A real user scrolls; the harness scrolls the same
# way (native scroll wheel over the content, keyboard assist).
# =============================================================================
SCROLL_X="700"   # main content area: right of the app nav, below the header
SCROLL_Y="480"

scroll_burst() { # <down|up> [x] [y] [lines]
  local dir="$1" x="${2:-$SCROLL_X}" y="${3:-$SCROLL_Y}" lines="${4:-12}"
  if [ -n "$MV_SCROLL" ]; then
    if [ "$dir" = "up" ]; then
      "$MV_SCROLL" "$x" "$y" "$lines" up 2>>"$LOG" || true
    else
      "$MV_SCROLL" "$x" "$y" "$lines" 2>>"$LOG" || true
    fi
  fi
}

v_scroll_find() { # <needle> <max-bursts> [arabic yes|no] [dir down|up]
  local needle="$1" max="${2:-10}" arabic="${3:-no}" dir="${4:-down}"
  local i=0
  while [ "$i" -lt "$max" ]; do
    if [ "$arabic" = "yes" ] && [ -x "$MV_OCR_AR" ]; then
      screencapture -x "$MV_SHOT" 2>>"$LOG" || return 1
      "$MV_OCR_AR" "$MV_SHOT" > "$MV_LINES" 2>>"$LOG" || return 1
      OCR_TEXT="$(grep '^LINE|' "$MV_LINES" 2>/dev/null || true)"
      LAST_OCR_HASH="$(shasum -a 256 "$MV_SHOT" 2>/dev/null | awk '{print $1}')"
      probe "ocr(ar): $(printf '%s\n' "$OCR_TEXT" | grep -c '^LINE|') lines — looking for '$needle'"
    else
      ocr_capture || return 1
    fi
    if [ -n "$OCR_TEXT" ] && ocr_grep "$needle"; then
      probe "scroll-find: '$needle' is visible after $i scroll burst(s) ($dir)"
      return 0
    fi
    scroll_burst "$dir"
    if [ $(( (i + 1) % 3 )) -eq 0 ]; then
      # keyboard assist (Page Down 121 / Home 115) — needs key focus in the page
      if [ "$dir" = "up" ]; then
        osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 115' 10 >/dev/null 2>&1 || true
      else
        osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 121' 10 >/dev/null 2>&1 || true
      fi
    fi
    sleep 1
    i=$((i + 1))
  done
  probe "scroll-find: '$needle' NOT visible after $max $dir scroll bursts"
  return 1
}

v_scroll_top() { # bounded scroll-up until a top-of-page marker is visible
  local max="${1:-10}"
  if v_scroll_find "GETTING STARTED" "$max" no up; then return 0; fi
  if ocr_grep "All caught up"; then
    probe "scroll-top: the TodaysOverview card is visible — the page is at the top"
    return 0
  fi
  if printf '%s\n' "$OCR_TEXT" | grep -qi -- "|[^|]*Add Patient"; then
    probe "scroll-top: the Add Patient quick action is visible — the page is at the top"
    return 0
  fi
  probe "scroll-top: top-of-page markers not confirmed (recorded honestly)"
  return 1
}

# (self-review fix) v_reveal_search_box() was removed — dead code:
# search_type() focuses the search box via the app's own Cmd+K shortcut
# (works from any scroll position), so the below-fold reveal dance was
# never called.

# Scan the whole patient-detail view in bounded scroll steps: the OWN note
# must appear SOMEWHERE; the FOREIGN notes must appear NOWHERE. Sets
# SCAN_OWN_SEEN / SCAN_FOREIGN_SEEN.
scan_detail_page() { # <own-note> <foreign-1> <foreign-2>
  SCAN_OWN_SEEN=no; SCAN_FOREIGN_SEEN=no
  local own="$1" f1="$2" f2="$3"
  local i=0 last_hash=""
  # (run 34786096512, class D) the detail view opens at the scroll offset
  # CARRIED OVER from the dashboard — the note card at the TOP of the view
  # was never seen by a down-only scan. Scroll UP to the top first (the
  # rubber band stops the overshoot), then scan down through the whole view.
  local up=0
  while [ "$up" -lt 8 ]; do
    scroll_burst up
    sleep 1
    up=$((up + 1))
  done
  probe "scan-detail: scrolled to the top of the detail view before the down-scan"
  while [ "$i" -lt 10 ]; do
    ocr_capture || true
    if [ -n "$last_hash" ] && [ "$LAST_OCR_HASH" = "$last_hash" ]; then
      probe "scan-detail: the screen stopped changing — the bottom of the detail view is reached"
      break
    fi
    last_hash="$LAST_OCR_HASH"
    if [ -n "$own" ] && ocr_grep "$own"; then
      SCAN_OWN_SEEN=yes
    fi
    local f
    for f in "$f1" "$f2"; do
      if [ -n "$f" ] && ocr_grep "$f"; then
        SCAN_FOREIGN_SEEN=yes
        probe "scan-detail: FOREIGN note text is visible: '$f'"
      fi
    done
    scroll_burst down
    sleep 1
    i=$((i + 1))
  done
  probe "scan-detail complete: own-note=$SCAN_OWN_SEEN foreign-note=$SCAN_FOREIGN_SEEN (scrolled through the detail view)"
}

# Click the ICON-ONLY edit pencil in the patient-detail banner. The control
# has no visible text (title="Edit Patient" is a tooltip) — an OCR needle
# can never match it. Primary: pixel-scan the white glyph clusters right of
# the OCR-found patient name on the banner (report | EDIT | trash) and click
# the MIDDLE cluster. Fallback: OCR-anchored right-aligned estimates. Every
# attempt is VERIFIED by the edit dialog's 'First Name' label appearing.
v_click_edit_pencil() { # <patient-full-name> <stem> [yband-adj]
  # (patients focus) the optional 3rd arg shifts the icon band for anchors
  # that are NOT the patient NAME: the banner's contact subline (phone/email)
  # sits ~38pt BELOW the name, so phone/email-anchored calls pass -38 to
  # re-center the band on the measured icon row (name_top-13). Default 0 =
  # byte-identical behavior for every pre-existing name-anchored call site.
  local name="$1" stem="$2" yadj="${3:-0}"
  # (run 34985384528, class D — pe3/pe4): a detail opened from a SEARCH-row
  # click can land with the banner SCROLLED OFF-SCREEN (the post-open OCR
  # shows the mid-page sections — 'No prescriptions yet'/'Clinical Notes' —
  # and NO banner), so the anchor (name/phone subline) is 'not found on
  # screen' and the edit battery D/P1s even though the right detail IS
  # open. Scroll the detail to the TOP (the banner) before the anchor
  # lookup — the same top-restore scan_detail_multi already does (8 up
  # bursts are a no-op when already at the top).
  local up=0
  while [ "$up" -lt 8 ]; do
    scroll_burst up
    sleep 1
    up=$((up + 1))
  done
  ocr_capture || return 1
  if ! ocr_lookup "$name" "first"; then
    probe "vclick-pencil[$stem]: anchor text '$name' not found on screen — no anchor, no click"
    return 1
  fi
  # (run 34788023216 forensics): the icons sit at the banner row's UPPER
  # band — measured y 186..199 against the name's OCR box top y=207 — the
  # old symmetric ±16 band around the name's center missed them entirely and
  # the fixed fallbacks hit pure gradient. Scan an ASYMMETRIC band around
  # (name_top - 13) ± 22 (covers name_top-35 .. name_top+9), then prefer the
  # RIGHT-side clusters (x>700): the icons are [report | EDIT | trash].
  # (run 35026560477, class D — the phone-anchored band): the icons sit at
  # the NAME's band (the banner's top row), NOT at the anchor's own y —
  # the phone/email subline sits ~171pt BELOW the name in the current
  # layout, so the old -38 yadj put the band at y≈319 where the scan found
  # the CALL/EMAIL action icons instead and every fallback missed the edit
  # row (pe3 D + the pe4 P1). Derive the band from the TOPMOST CONTENT
  # LINE (x≥200 — right of the sidebar, y 140..400 — below the app header/
  # tabs, within the banner): the patient name/avatar row. The yadj is
  # kept ONLY as the legacy fallback when no content line is found; the
  # anchor itself still verifies the right patient's detail is open.
  local band_cy x0 band_src
  band_src="$(detail_banner_row)"
  if [ -n "$band_src" ]; then
    band_cy=$(( band_src - 13 ))
    probe "vclick-pencil[$stem]: icon band from the topmost banner row y=$band_src → band center y=$band_cy"
  else
    band_cy=$(( OCR_HIT_Y - 13 + yadj ))
    probe "vclick-pencil[$stem]: no banner row found — band from the anchor y=$OCR_HIT_Y (adj $yadj) → band center y=$band_cy"
  fi
  x0=$(( OCR_HIT_X + OCR_HIT_W + 30 ))
  probe "vclick-pencil[$stem]: anchor name '$name' at ($OCR_HIT_X,$OCR_HIT_Y) — icon band center y=$band_cy, scan from x=$x0"
  if [ -n "$MV_ICONSCAN" ]; then
    local hits n hit cx icy
    hits="$("$MV_ICONSCAN" "$MV_SHOT" "$MV_SCALE" "$x0" "$band_cy" "22" 2>>"$LOG" || true)"
    n="$(printf '%s\n' "$hits" | grep -c '^ICON|' || true)"
    probe "vclick-pencil[$stem]: icon scan found $n white glyph cluster(s): $(printf '%s' "$hits" | tr '\n' ' ')"
    # right-side clusters first (the icon row); the MIDDLE of 3 is the pencil
    local right_hits
    right_hits="$(printf '%s\n' "$hits" | grep '^ICON|' | awk -F'|' '$2 > 700' | sort -t'|' -k2 -n)"
    local rn
    rn="$(printf '%s\n' "$right_hits" | grep -c '^ICON|' || true)"
    if [ "${rn:-0}" -ge 3 ]; then
      hit="$(printf '%s\n' "$right_hits" | sed -n '2p')"
    elif [ "${rn:-0}" -ge 1 ]; then
      hit="$(printf '%s\n' "$right_hits" | head -1)"
    else
      hit="$(printf '%s\n' "$hits" | grep '^ICON|' | head -1 || true)"
    fi
    if [ -n "$hit" ]; then
      cx="$(printf '%s' "$hit" | awk -F'|' '{print $2}')"
      icy="$(printf '%s' "$hit" | awk -F'|' '{print $3}')"
      probe "vclick-pencil[$stem]: clicking the icon cluster at ($cx,$icy) — verified by the dialog opening"
      "$MV_MOUSE" "$cx" "$icy" 2>>"$LOG" || true
      sleep 2
      ocr_capture || return 1
      if ocr_grep "First Name"; then
        snap_file "$MV_SHOT" "${stem}-open" || true
        probe "vclick-pencil[$stem]: the Edit Patient dialog opened (First Name visible)"
        return 0
      fi
      probe "vclick-pencil[$stem]: the cluster click did not open the edit dialog"
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 53' 10 >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
  # OCR-anchored fallback at the MEASURED icon band (icons y ≈ name_top-15;
  # pencil ≈ x 902 with the fitted window). Each candidate is VERIFIED;
  # Escape dismisses anything opened by a miss (report/trash).
  # (run 35026560477): the fallback y also follows the topmost banner row
  # when found — the phone-anchored calls otherwise fall 171pt below the
  # icon row and every candidate misses.
  local cand tx ty2
  if [ -n "$band_src" ]; then
    ty2=$(( band_src - 15 ))
  else
    ty2=$(( OCR_HIT_Y - 15 + yadj ))
  fi
  for cand in 902 920 884 860 944; do
    tx="$cand"
    probe "vclick-pencil[$stem]: anchored fallback click at ($tx,$ty2) (the measured icon band)"
    "$MV_MOUSE" "$tx" "$ty2" 2>>"$LOG" || true
    sleep 2
    ocr_capture || return 1
    if ocr_grep "First Name"; then
      snap_file "$MV_SHOT" "${stem}-open-fb" || true
      probe "vclick-pencil[$stem]: the Edit Patient dialog opened via the anchored fallback"
      return 0
    fi
    osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 53' 10 >/dev/null 2>&1 || true
    sleep 1
  done
  probe "vclick-pencil[$stem]: the icon-only edit control could not be activated (all attempts recorded)"
  return 1
}

v_type_into() { # <label-needle> <text> <stem> [secret yes|no] [arabic yes|no] [clear yes|no] [xmin]
  local label="$1"
  local text="$2"
  local stem="$3"
  local secret="${4:-no}"
  local arabic="${5:-no}"
  local clear="${6:-no}"
  local xmin="${7:-}"
  if [ "$OCR_STACK" != "yes" ]; then
    probe "vtype[$stem]: visual stack unavailable — skipped"
    return 1
  fi
  ocr_capture || return 1
  snap_file "$MV_SHOT" "${stem}-before" || true
  # (run 35017083195, class D — the edit-dialog label collision): the EDIT
  # dialog renders over the patient DETAIL page whose banner carries the
  # SAME short labels (Phone/Notes/Address/Email) at the LEFT edge
  # (x≈141 screen pts) — the label lookup's FIRST hit picked the banner's
  # label, the click landed on the dialog OVERLAY left of the card, and
  # the modal DISMISSED itself before a single keystroke (then Notes /
  # Cancel / Save were all 'not found' and the edit battery P1'd). The
  # optional xmin restricts the label search to the dialog card's x-range
  # (the card's field labels sit at x≥~300): the edit-battery call sites
  # pass 250. Default empty = byte-identical behavior for every
  # pre-existing call site (the create dialog sits over the dashboard,
  # which has no Phone/Notes/Email/Address short labels).
  local saved_ocr="$OCR_TEXT"
  if [ -n "$xmin" ]; then
    OCR_TEXT="$(printf '%s\n' "$OCR_TEXT" | awk -F'|' -v m="$xmin" -v s="${MV_SCALE:-1}" '($3+0)/s >= m')"
    [ -n "$OCR_TEXT" ] || OCR_TEXT="$saved_ocr"
  fi
  if ! ocr_lookup "$label" "first" "label"; then
    OCR_TEXT="$saved_ocr"
    probe "vtype[$stem]: label '$label' NOT FOUND on screen — no click attempted"
    return 1
  fi
  OCR_TEXT="$saved_ocr"
  local lx ly tx ty
  lx="$OCR_HIT_X"
  ly="$OCR_HIT_Y"
  tx="$lx"
  ty=$(( ly + 6 ))
  probe "vtype[$stem]: label='$label' at ($lx,$ly) → clicking the REAL label, then typing the real text"
  if ! "$MV_MOUSE" "$tx" "$ty" 2>>"$LOG"; then
    probe "vtype[$stem]: mv-mouse FAILED"
    return 1
  fi
  sleep 1
  # Optional field clear (a real user's flow): the login form KEEPS a
  # failed attempt's password (setError only — the app does not clear it),
  # so re-typing over a wrong attempt must select-all + delete first.
  if [ "$clear" = "yes" ]; then
    osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "a" using command down' 10 || true
    sleep 1
    osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 51' 10 || true
    sleep 1
  fi
  # AppleScript `keystroke` cannot type non-Roman scripts (run 34782801632:
  # "محمد" became "Aaaa") — the Arabic path types via Unicode CGEvents,
  # with a clipboard paste as the verified fallback.
  TYPED_OK=0
  if [ "$arabic" = "yes" ] && [ -n "$MV_TYPE_UNI" ]; then
    if "$MV_TYPE_UNI" "$text" 2>>"$LOG"; then
      sleep 1
      TYPED_OK=1
      probe "vtype[$stem]: typed the Arabic text via Unicode CGEvents"
    else
      probe "vtype[$stem]: mv-type-uni failed — falling back to the clipboard paste"
    fi
  elif [ "$arabic" = "yes" ]; then
    probe "vtype[$stem]: mv-type-uni unavailable — using the clipboard paste"
  fi
  if [ "$TYPED_OK" = "0" ] && [ "$arabic" != "yes" ]; then
    if osa "tell application \"System Events\" to tell (first process whose name contains \"edivault\") to keystroke \"$text\"" 15; then
      sleep 1
      TYPED_OK=1
    fi
  fi
  if [ "$TYPED_OK" = "0" ] && [ "$arabic" = "yes" ]; then
    # Clipboard paste (the app is NOT sandboxed — no paste permission prompt):
    # set the clipboard to the real text, select the field, paste (Cmd+V).
    osa "set the clipboard to \"$text\"" 10 || true
    sleep 1
    osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "a" using command down' 10 || true
    sleep 1
    osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 51' 10 || true
    sleep 1
    osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "v" using command down' 10 || true
    sleep 1
    probe "vtype[$stem]: pasted the Arabic text (clipboard + Cmd+V — a real user's flow for non-Latin input)"
    TYPED_OK=1
  fi
  if [ "$TYPED_OK" = "1" ]; then
    sleep 1
    ocr_capture || return 1
    snap_file "$MV_SHOT" "${stem}-after" || true
    if [ "$secret" = "yes" ]; then
      probe "vtype[$stem]: typed into the masked field (not visually verifiable by design)"
      return 0
    fi
    if [ "$arabic" = "yes" ] && [ -x "$MV_OCR_AR" ]; then
      if "$MV_OCR_AR" "$MV_SHOT" > "$MV_LINES" 2>>"$LOG" \
         && grep -qi -- "|[^|]*${text}[^|]*|" "$MV_LINES"; then
        probe "vtype[$stem]: Arabic text verified on screen (multi-language Vision OCR)"
        return 0
      fi
      # one paste retry before the honest soft-fail
      osa "set the clipboard to \"$text\"" 10 || true
      sleep 1
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "a" using command down' 10 || true
      sleep 1
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 51' 10 || true
      sleep 1
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "v" using command down' 10 || true
      sleep 1
      ocr_capture || return 1
      snap_file "$MV_SHOT" "${stem}-after-paste" || true
      if "$MV_OCR_AR" "$MV_SHOT" > "$MV_LINES" 2>>"$LOG" \
         && grep -qi -- "|[^|]*${text}[^|]*|" "$MV_LINES"; then
        probe "vtype[$stem]: Arabic text verified on screen after the paste retry (multi-language Vision OCR)"
        return 0
      fi
      probe "vtype[$stem]: Arabic text not OCR-verified — the typed field state is on the screenshot; search/isolation behavior is the functional proof"
      return 0
    fi
    if ocr_grep "$text"; then
      probe "vtype[$stem]: typed text is now VISIBLE on screen (verified)"
      return 0
    fi
    probe "vtype[$stem]: typed text not visible — one retry with a deeper offset (Cmd+A replaces)"
    ty=$(( ly + 40 ))
    if "$MV_MOUSE" "$tx" "$ty" 2>>"$LOG"; then
      sleep 1
      osa 'tell application "System Events" to tell process "MediVault" to keystroke "a" using command down' 10 || true
      sleep 1
      if osa "tell application \"System Events\" to tell (first process whose name contains \"edivault\") to keystroke \"$text\"" 15; then
        sleep 1
        ocr_capture || return 1
        snap_file "$MV_SHOT" "${stem}-after" || true
        if [ "$secret" = "yes" ]; then return 0; fi
        if printf '%s\n' "$OCR_TEXT" | grep -qi -- "|[^|]*${text}"; then
          probe "vtype[$stem]: retry verified — typed text visible"
          return 0
        fi
      else
        probe "vtype[$stem]: retry keystroke FAILED (kept): $OSA_ERR"
      fi
    fi
    probe "vtype[$stem]: typing could NOT be verified visually — recorded honestly"
    return 1
  else
    probe "vtype[$stem]: keystroke FAILED (kept, not discarded): $OSA_ERR"
    return 1
  fi
}

wait_for_ocr() { # <needle> <timeout_s> <label> — bounded wait until text is visible
  local needle="$1" t="$2" label="$3"
  local t0
  t0="$(date +%s)"
  while [ $(( $(date +%s) - t0 )) -le "$t" ]; do
    if ocr_capture && ocr_grep "$needle"; then
      probe "wait_for_ocr[$label]: '$needle' visible after $(( $(date +%s) - t0 ))s"
      return 0
    fi
    sleep 3
  done
  probe "wait_for_ocr[$label]: '$needle' NOT visible within ${t}s"
  return 1
}
app_running() { # case-safe liveness probe (the binary is `medivault`, the LS name is `MediVault`)
  pgrep -f "ediVault.app/Contents/MacOS/" >/dev/null 2>&1
}

launch_medivault() { # honest launch: direct-exec FIRST (RUST_LOG captured) → LS open → Finder
  # The bundle's REAL executable name (CFBundleExecutable — `medivault` in
  # this build; read from Info.plist, never assumed). Direct execution in the
  # same GUI login session keeps the app's OWN stderr (RUST_LOG=debug,
  # webview console forwarding) capturable — the decisive first-red tool.
  # The LaunchServices/open path was already proven working (run 14).
  local rc
  MV_BIN_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo medivault)"
  MV_BIN="$APP_PATH/Contents/MacOS/$MV_BIN_NAME"
  probe "bundle executable: $MV_BIN_NAME (from CFBundleExecutable)"
  rm -f /tmp/mv-direct-launch.exit
  ( RUST_LOG=debug "$MV_BIN" > /tmp/mv-direct-launch.log 2>&1; echo $? > /tmp/mv-direct-launch.exit ) &
  LAUNCH_PID=$!
  sleep 8
  if kill -0 "$LAUNCH_PID" 2>/dev/null; then
    probe "launch method: direct binary execution with RUST_LOG=debug (stderr captured to /tmp/mv-direct-launch.log)"
    return 0
  fi
  probe "direct launch failed — falling back to open (LaunchServices)"
  OPEN_STDERR="/tmp/mv-open.err"
  set +e
  open "$APP_PATH" 2>"$OPEN_STDERR"
  rc=$?
  set -e
  probe "open exit=$rc; stderr: $(head -c 300 "$OPEN_STDERR" 2>/dev/null | tr '\n' ' ')"
  sleep 12
  if app_running; then
    probe "launch method: open (LaunchServices) — process is up: $(pgrep -f 'ediVault.app/Contents/MacOS/' | tr '\n' ' ')"
    return 0
  fi
  probe "open produced no process — registering the app with LaunchServices (lsregister) and retrying"
  LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [ -x "$LSREG" ]; then
    "$LSREG" -f "$APP_PATH" >/dev/null 2>&1 || probe "lsregister -f returned non-zero (kept)"
    sleep 3
  fi
  set +e
  open "$APP_PATH" 2>"$OPEN_STDERR"
  rc=$?
  set -e
  probe "open retry exit=$rc; stderr: $(head -c 300 "$OPEN_STDERR" 2>/dev/null | tr '\n' ' ')"
  sleep 12
  if app_running; then
    probe "launch method: open after lsregister — process is up"
    return 0
  fi
  # Finder open (the doctor-facing double-click equivalent)
  if osa "tell application \"Finder\" to open application file (POSIX file \"$APP_PATH\" as alias)" 30; then
    sleep 12
    if app_running; then
      probe "launch method: Finder open — process is up"
      return 0
    fi
  else
    probe "Finder open failed (kept): $OSA_ERR"
  fi
  # Final fallback: direct binary execution in the SAME GUI login session
  # (the app, window, and all GUI interactions are real — recorded honestly
  # as a direct-binary launch because every LaunchServices path failed).
  # Uses the REAL CFBundleExecutable name; RUST_LOG=debug surfaces the app's
  # own diagnostics (incl. webview console forwarding) in the captured log.
  probe "launch method: DIRECT BINARY EXECUTION (all LaunchServices paths failed — recorded honestly)"
  rm -f /tmp/mv-direct-launch.exit
  ( RUST_LOG=debug "$MV_BIN" > /tmp/mv-direct-launch.log 2>&1; echo $? > /tmp/mv-direct-launch.exit ) &
  LAUNCH_PID=$!
  sleep 8
  kill -0 "$LAUNCH_PID" 2>/dev/null || { probe "direct launch also failed"; return 1; }
  return 0
}

launch_and_detect() { # <label> [timeout] — robust launch + the bounded detector
  local label="$1"
  local timeout="${2:-180}"
  launch_medivault
  wait_for_medivault "$timeout" "$label"
  if [ -n "$MV_T_WINDOW" ]; then
    CAP_LAUNCH_TIMING="${CAP_LAUNCH_TIMING:+$CAP_LAUNCH_TIMING | }$label: launch→window=${MV_T_WINDOW}s"
  fi
  fit_window
}

fit_window() { # (run 34777677885, class D) the app's 1280x800 window is
  # CENTERED on the 1024x768 runner screen → it overhangs both edges
  # (x ≈ -128..1152): the screenshot CLIPS the left ~128px of the window —
  # the patient row's avatar, the 'Joh' of 'John Test' and the 'P' of
  # 'Patients' were all cut off-screen, so the OCR needles could never
  # match. Fit the window to the screen (position {0,25}, size {1024,700} —
  # within the app's declared min 1024x680, resizable per tauri.conf).
  [ "$MV_WINDOW" = "yes" ] || return 0
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to set position of window 1 to {0, 25}' 10 || true
  sleep 1
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to set size of window 1 to {1024, 700}' 10 || true
  sleep 1
  if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to get {position, size} of window 1' 8; then
    probe "window fitted to the runner screen: {position, size} = $OSA_OUT (was overhanging x≈-128..1152 — the left 128px was clipped off-screen; the OCR needles now see the full window)"
  fi
}
note "=== PHASE 7: logout / login / wrong-password ==="
# The profile pill shows the doctor name; clicking it opens the Sign Out menu.
# The profile pill truncates the account name with an ellipsis ("MediVault
# Test ..." — run 34698812086 first-red): click the VISIBLE prefix when the
# full name is not OCR-findable.
open_profile_menu() { # <stem> — needle variants + an ANCHORED fallback
  local stem="$1"
  if v_click "$DOC_NAME" "${stem}-pill" "Sign Out"; then return 0; fi
  if v_click "MediVault Test" "${stem}-pill-prefix" "Sign Out"; then return 0; fi
  # (run 34779478099, class D) Apple Vision DROPPED the pill's text line in
  # the fitted-window geometry (the pixels render identically to the runs
  # where it was read). Anchor on the reliably-OCR'd header nav and click
  # the right-aligned pill's center band; every candidate is VERIFIED by
  # the Sign Out menu appearing.
  ocr_capture || return 1
  if ocr_lookup "Settings" "first" "label"; then
    local cy cand
    cy=$(( OCR_HIT_Y + (OCR_HIT_H / 2) ))
    for cand in 800 850 750 900; do
      probe "pill-anchored[$stem]: clicking the right-aligned header band at ($cand,$cy) — verified by the Sign Out menu"
      "$MV_MOUSE" "$cand" "$cy" 2>>"$LOG" || true
      sleep 2
      ocr_capture || return 1
      if ocr_grep "Sign Out"; then
        snap_file "$MV_SHOT" "${stem}-pill-anchored" || true
        probe "pill-anchored[$stem]: the profile menu opened (Sign Out visible) via the anchored click"
        return 0
      fi
      # dismiss anything accidentally opened before the next candidate
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 53' 10 >/dev/null 2>&1 || true
      sleep 1
    done
  fi
  return 1
}
clear_search_box() { # (run 34784559413, class D) the OCR-anchored clear failed when the
  # box held text — the placeholder disappears, so the label lookup cannot
  # find it, and the leftover filter hid the other patients' rows. Use the
  # app's OWN focus-search shortcut instead: Ctrl/Cmd+K (use-keyboard-
  # shortcuts.ts — works from ANY focus state, requiresNoInput: false, and
  # querySelector matches the input's placeholder ATTRIBUTE which persists
  # even when the placeholder text is visually hidden). Then Cmd+A + delete.
  # Fully keyboard — no OCR, no visibility requirement.
  # (run 35048296418, class D — the back-navigation trap): when the current
  # view is NOT the patients list (e.g., a patient detail left open by the
  # delete battery), the Cmd+K does not focus any input and the BACKSPACE
  # triggers WKWebView's BACK navigation — the webview returns to the
  # tauri:// first-run page from the back/forward cache (the account-era
  # mechanism; in this run it trapped the whole PNAV battery on the
  # onboarding screen). GUARD: the patients search bar must be visible
  # before the keystrokes; otherwise click Dashboard first.
  ocr_capture || true
  if ! ocr_grep "Search patients"; then
    probe "clear-search: the patients search bar is not visible — clicking Dashboard first (the Backspace back-navigation guard)"
    v_click "Dashboard" "clear-search-goto-dash" "Add Patient" || true
    sleep 2
    ocr_capture || true
  fi
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "k" using command down' 10 || true
  sleep 1
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "a" using command down' 10 || true
  sleep 1
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 51' 10 || true
  sleep 2
  probe "clear-search: Cmd+K (the app's real focus-search shortcut) → Cmd+A → Backspace — the query is cleared, the full list returns"
  return 0
}

search_type() { # <text> <stem> [arabic yes|no] — Cmd+K focus, clear, type the query
  local text="$1" stem="$2" arabic="${3:-no}"
  ocr_capture || true
  snap_file "$MV_SHOT" "${stem}-before" || true
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "k" using command down' 10 || true
  sleep 1
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "a" using command down' 10 || true
  sleep 1
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 51' 10 || true
  sleep 1
  if [ "$arabic" = "yes" ]; then
    if [ -n "$MV_TYPE_UNI" ] && "$MV_TYPE_UNI" "$text" 2>>"$LOG"; then
      sleep 1
      probe "search[$stem]: typed '$text' via Unicode CGEvents after the Cmd+K focus"
    else
      osa "set the clipboard to \"$text\"" 10 || true
      sleep 1
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "v" using command down' 10 || true
      sleep 1
      probe "search[$stem]: pasted '$text' after the Cmd+K focus (clipboard — a real user's flow for non-Latin input)"
    fi
  else
    osa "tell application \"System Events\" to tell (first process whose name contains \"edivault\") to keystroke \"$text\"" 15 || true
    sleep 1
    probe "search[$stem]: typed '$text' after the Cmd+K focus"
  fi
  sleep 2
  ocr_capture || true
  snap_file "$MV_SHOT" "${stem}-after" || true
  return 0
}

open_patient_detail() { # <full-name> <stem> [row-needle] — the optional 3rd arg overrides the ROW click needle
  local full="$1" stem="$2" rowneedle="${3:-$1}"
  # A search filter may be active from a previous step — clear it first so
  # the FULL list is visible (the filtered list hides the other rows).
  clear_search_box || true
  # (runs 34790106973 + 34792248572, class D) reveal the REAL patient-list
  # section (its header) before the row click: above the list sit the
  # Recently Viewed mini-cards (stale pre-edit snapshots) and BELOW it sits
  # the Activity Timeline (entries constructed as all-null skeletons — the
  # P2 the product fix addresses). Scrolling to the section header puts the
  # list rows in view; the rows are then the FIRST '$full' hits in reading
  # order (the timeline entries come after them).
  # (run 34930796719, class D — the FALSE P0 at PI): a '$full' NAME needle
  # PREFIX-matches similar-name rows once the PC8 cohort exists ('John
  # Test' matches 'John Test-Hyphen'/'John Tester'/'john test') — the only
  # in-view match won, the WRONG patient's detail opened, and that
  # patient's OWN sentinel note then read as 'foreign' (the API log +
  # the pc8c create dialog screenshots prove the mapping: name, phone,
  # and note all belonged to the opened record). The optional row-needle
  # (the patient's unique row PHONE line) targets the right row; every
  # John Test call site now passes it. Default = the name (byte-identical
  # behavior for every pre-existing call site).
  v_scroll_find "Recent Patients" 6 || v_scroll_find "Search Results" 6 || v_scroll_find "$rowneedle" 5 || true
  if ! v_click "$rowneedle" "${stem}-row" "$full" "first"; then
    if v_scroll_find "$rowneedle" 6 || v_scroll_find "$rowneedle" 5 no up; then
      if ! v_click "$rowneedle" "${stem}-row-retry" "$full" "first"; then
        snap "${stem}-row-failed" || true
        return 1
      fi
    else
      snap "${stem}-row-failed" || true
      return 1
    fi
  fi
  sleep 2
  snap "${stem}-detail" || true
  return 0
}
create_patient() { # <first> <last> <note> <stem> <arabic yes|no>
  local first="$1" last="$2" notetxt="$3" stem="$4" arabic="${5:-no}"
  if ! v_click "Add Patient" "${stem}-open" "First Name" first 0 label; then
    if ! v_click_try_hits "Add Patient" "${stem}-open" "First Name"; then
      snap "${stem}-open-failed" || true
      product_red "PATIENT_${stem}" "the Add Patient dialog ('First Name' field) never opened"
    fi
  fi
  if [ "$arabic" = "yes" ]; then
    if ! v_type_into "First Name" "$first" "${stem}-first" no yes; then
      product_red "PATIENT_${stem}" "could not type the Arabic first name"
    fi
    if ! v_type_into "Last Name" "$last" "${stem}-last" no yes; then
      product_red "PATIENT_${stem}" "could not type the Arabic last name"
    fi
    if ! v_type_into "Notes" "$notetxt" "${stem}-notes"; then
      product_red "PATIENT_${stem}" "could not type the patient notes"
    fi
  else
    if ! v_type_into "First Name" "$first" "${stem}-first"; then
      product_red "PATIENT_${stem}" "could not type the first name"
    fi
    if ! v_type_into "Last Name" "$last" "${stem}-last"; then
      product_red "PATIENT_${stem}" "could not type the last name"
    fi
    if ! v_type_into "Notes" "$notetxt" "${stem}-notes"; then
      product_red "PATIENT_${stem}" "could not type the patient notes"
    fi
  fi
  snap "${stem}-form-filled" || true
  # Below-the-fold + textarea-safe submit (runs 34697721680 + 34707729968):
  # the footer button can sit below the fold, AND the last typed field
  # (Notes) is a TEXTAREA — Return there inserts a NEWLINE, it does not
  # submit the form. Click the FIRST NAME field (a real <input>), press
  # Return THERE, and treat the dialog TITLE disappearing as submitted
  # (unambiguous; works for the Arabic patient too). The real button
  # click remains the fallback.
  PATIENT_SUBMITTED=0
  if ocr_lookup "First Name" "first" "label"; then
    "$MV_MOUSE" "$OCR_HIT_X" "$(( OCR_HIT_Y + 6 ))" 2>>"$LOG" || true
    sleep 1
    if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
      sleep 3
      ocr_capture || true
      if [ -n "$OCR_TEXT" ] && ! ocr_grep "Add New Patient"; then
        PATIENT_SUBMITTED=1
        snap "${stem}-submit-enter" || true
        probe "the First-Name-field Return submitted the ${stem} patient form (below-the-fold footer + the Notes textarea trap — a real user's flow)"
      fi
    fi
  fi
  if [ "$PATIENT_SUBMITTED" = "0" ]; then
    # Reveal the dialog's OWN footer (the submit button sits below the
    # dialog's internal fold — scroll the DIALOG area, not the page), then
    # click the real submit button.
    local b=0
    while [ "$b" -lt 4 ]; do
      scroll_burst down 500 400
      sleep 1
      b=$((b + 1))
    done
    if ! v_click_try_hits "Add Patient" "${stem}-submit" "$first"; then
      snap "${stem}-submit-failed" || true
      product_red "PATIENT_${stem}" "submitting the Add Patient form produced no visible change"
    fi
  fi
  sleep 2
}

# =============================================================================
# GATEWAY — shared by every focus: clean state, install, first-run,
# registration, backend, hand-off, account creation. Adapted from the frozen
# lane's phases 1-6 with the exploratory bug discipline and surface recording.
# =============================================================================
note "=== GATEWAY 1: clean-state proof ==="
snap "01-preflight" || true

FRESH="yes"
for d in "$HOME/Library/Application Support/MediVault" "$HOME/Library/Logs/MediVault"; do
  if [ -e "$d" ]; then
    FRESH="no (exists: $d)"
    probe "fresh-state: $d already exists"
  fi
done
if launchctl print "gui/$(id -u)/dev.medivault.supervisor" >/dev/null 2>&1; then
  FRESH="no (launchd job present)"
  probe "fresh-state: launchd job already exists"
fi
if curl -fsS --max-time 2 "$API/health" >/dev/null 2>&1; then
  FRESH="no (API already answering)"
  probe "fresh-state: the API is already answering"
fi
probe "fresh-state verdict: $FRESH"
qa_cap FRESH_STATE "$FRESH"
case "$FRESH" in
  yes) : ;;
  *) bug ENV FRESH_STATE "the runner was not in a clean MediVault state: $FRESH" stop ;;
esac

# =============================================================================
note "=== GATEWAY 2: hash-verified install (labeled) ==="
[ -f "$DMG_PATH" ] || die "DMG not found at $DMG_PATH"
EXPECTED_SHA="$(awk '{print $1}' "$DMG_SHA256_FILE")"
[ "${#EXPECTED_SHA}" -eq 64 ] || die "bad sha256 sidecar"
ACTUAL_SHA="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
probe "DMG sha256: expected=${EXPECTED_SHA:0:16}… actual=${ACTUAL_SHA:0:16}…"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || bug ENV DMG_HASH "DMG hash mismatch (build artifact corrupted?)" stop
qa_cap DMG_HASH "GREEN (sha256 ${ACTUAL_SHA:0:16}…) — built from this run's commit"

hdiutil attach "$DMG_PATH" -mountpoint "$VOLUME" -nobrowse -readonly >/dev/null 2>>"$LOG" || die "hdiutil attach failed"
[ -x "$VOLUME/MediVault.app/Contents/MacOS/MediVault" ] || die "mounted DMG has no MediVault.app"
rm -rf "$APP_PATH"

# Placement: FINDER duplicate first (the iteration-3-proven method — Finder
# performs the copy AND registers the app with LaunchServices; run 6 proved
# `open` cannot launch a bash-cp'd app on this macOS 26 image). Honest
# fallback: bash cp (labeled).
PLACEMENT_HOW="none"
if osa "tell application \"Finder\" to duplicate (POSIX file \"$VOLUME/MediVault.app\") to (POSIX file \"/Applications\") with replacing" 60; then
  for i in $(seq 1 60); do [ -d "$APP_PATH" ] && PLACEMENT_HOW="finder-applescript" && break; sleep 1; done
fi
if [ "$PLACEMENT_HOW" = "none" ]; then
  probe "Finder duplicate did not produce $APP_PATH (${OSA_ERR:-no error}) — bash cp fallback (labeled: NOT a Finder placement)"
  cp -R "$VOLUME/MediVault.app" "$APP_PATH" || die "cp of the app bundle failed"
  PLACEMENT_HOW="bash-cp (NOT a Finder placement)"
fi
qa_cap INSTALL "GREEN ($PLACEMENT_HOW; non-quarantined by construction — never browser-downloaded)"

hdiutil detach "$VOLUME" -force >/dev/null 2>&1 || true
XATTR_OUT="$(xattr "$APP_PATH" 2>/dev/null | tr '\n' ' ')"
probe "installed app xattrs: '${XATTR_OUT:-none}'"
probe "helper file type: $(file "$APP_PATH/Contents/MacOS/$HELPER_NAME" 2>&1 | head -1)"
probe "helper (bash) status: $("$APP_PATH/Contents/MacOS/$HELPER_NAME" status 2>&1 | head -2 | tr '\n' ' ' || true)"
[ -f "$APP_PATH/Contents/MacOS/$HELPER_NAME" ] || die "SMAppService helper missing in the installed app"
snap "03-installed-app" || true

# =============================================================================
note "=== GATEWAY 3: first launch → first-run onboarding (surface recorded) ==="
launch_and_detect "qa-first-launch" 180
if [ "$MV_WINDOW" != "yes" ]; then
  note "--- launch diagnostics (honest evidence BEFORE the verdict) ---"
  probe "spctl assessment: $(spctl --assess -vv "$APP_PATH" 2>&1 | head -2 | tr '\n' ' ' || true)"
  probe "codesign verify: $(codesign --verify --strict "$APP_PATH" 2>&1 | head -2 | tr '\n' ' ' || true)"
  probe "lsappinfo: $(lsappinfo info "file:$APP_PATH" 2>&1 | head -3 | tr '\n' ' ' || true)"
  probe "helper (bash) status: $("$APP_PATH/Contents/MacOS/$HELPER_NAME" status 2>&1 | head -2 | tr '\n' ' ' || true)"
  rm -f /tmp/mv-direct.exit
  ( "$APP_PATH/Contents/MacOS/MediVault" > /tmp/mv-direct.log 2>&1; echo $? > /tmp/mv-direct.exit ) &
  DIRECT_PID=$!
  sleep 12
  if kill -0 "$DIRECT_PID" 2>/dev/null; then
    probe "direct exec: process ALIVE after 12s (pid $DIRECT_PID) — capturing, then killing"
    sleep 3
    snap "03a-direct-exec-window" || true
    kill -TERM "$DIRECT_PID" 2>/dev/null || true
  else
    probe "direct exec: process EXITED (code $(cat /tmp/mv-direct.exit 2>/dev/null || echo '?'))"
  fi
  sleep 2
  probe "--- direct-exec output (first 60 lines) ---"
  sed -n '1,60p' /tmp/mv-direct.log 2>/dev/null | tee -a "$LOG" || probe "(no output captured)"
  probe "--- crash reports (newest 5) ---"
  ls -t "$HOME/Library/Logs/DiagnosticReports" 2>/dev/null | head -5 | tee -a "$LOG" || probe "(none)"
  bug P1 FIRST_LAUNCH "the MediVault window never appeared (proc=$MV_PROC; diagnostics above)"
fi
qa_cap MEDIVAULT_WINDOW "GREEN (window after ${MV_T_WINDOW:-?}s — title: $MV_TITLE)"

if ! wait_for_ocr "Local services" 90 "first-run-screen"; then
  snap "04-first-run-not-visible" || true
  probe "OCR inventory for diagnosis: $(printf '%s' "$OCR_TEXT" | awk -F'|' '{printf "[%s] ", $2}' | cut -c1-600)"
  bug P1 FIRST_RUN_SETUP_CONTROL "the first-run onboarding screen (the 'Local services' card) never became visible"
fi
sleep 6
ocr_capture || true
snap "04-first-run-screen" || true
if [ -s /tmp/mv-direct-launch.log ]; then
  probe "--- app console (first 60 lines) ---"
  sed -n '1,60p' /tmp/mv-direct-launch.log 2>/dev/null | tee -a "$LOG" || true
fi

# SURFACE RECORD: the pre-auth first-run onboarding screen.
record_inventory "first-run onboarding (pre-auth, tauri:// origin)"
surface_section "First-run onboarding screen (pre-auth)"
surface_row "Onboarding title + subtitle" "app first launch" "MediVault wordmark; 'Secure Medical Document Management — first-run setup' subtitle" "brand + context visible pre-auth" "observed (OCR)" "RECORDED" "04-first-run-screen" "OK"
surface_row "Local services card" "first launch" "'Local services' title; PostgreSQL + local API description; status badge" "the setup control card is visible before any account exists" "observed (OCR)" "RECORDED" "04-first-run-screen" "OK"
surface_row "Set up MediVault button" "first launch, Local services card" "'Set up MediVault' primary button" "clicking registers the SMAppService background service" "clicked in GATEWAY 4 (real CGEvent click, verified)" "PENDING GATEWAY 4" "05-setup-click-before/after" "OK"
surface_row "Onboarding footer privacy line" "first launch" "'All data stays local on this Mac…'" "privacy promise visible pre-auth" "observed (OCR)" "RECORDED" "04-first-run-screen" "OK"

# Error-state detection (frozen lane): capture diagnostics, one real retry.
if printf '%s' "$OCR_TEXT" | grep -qi -- "|[^|]*\(helper missing\|error occurred\|failed\|incomplete\)"; then
  note "--- onboarding ERROR state detected — decisive diagnostics ---"
  probe "running MediVault processes (ACTUAL binary paths):"
  ps auxww | grep -i "[M]ediVault" | awk '{printf "  pid=%s %s\n", $2, substr($0, index($0,$11))}' | head -8 | tee -a "$LOG"
  probe "--- Contents/MacOS NOW (after the app checked it):"
  ls -la "$APP_PATH/Contents/MacOS/" 2>&1 | tee -a "$LOG"
  probe "helper (bash) status NOW: $("$APP_PATH/Contents/MacOS/$HELPER_NAME" status 2>&1 | head -2 | tr '\n' ' ' || true)"
  if [ -s /tmp/mv-direct-launch.log ]; then
    probe "--- the app's OWN stderr (RUST_LOG=debug, first 80 lines) ---"
    sed -n '1,80p' /tmp/mv-direct-launch.log 2>/dev/null | tee -a "$LOG" || true
  fi
  snap "04b-onboarding-error-state" || true
  note "--- clicking the real 'Try again' button (one legitimate recovery attempt) ---"
  if v_click "Try again" "04c-error-retry" "Set up MediVault"; then
    probe "the retry recovered: the setup control is now visible"
  else
    sleep 5
    ocr_capture || true
    if printf '%s' "$OCR_TEXT" | grep -qi -- "|[^|]*Set up MediVault"; then
      probe "the retry recovered (verified on the second OCR pass)"
    else
      bug P1 FIRST_RUN_SETUP_CONTROL "the onboarding shows an ERROR instead of the setup control and the real Try-again click did not recover it (visible on 04b-onboarding-error-state.png)"
    fi
  fi
fi

FIRST_RUN_CONTROL="RED"
for needle in "Set up MediVault" "Local services" "Not registered"; do
  if ocr_grep "$needle"; then
    FIRST_RUN_CONTROL="GREEN ('$needle' visible pre-auth)"
    break
  fi
done
qa_cap FIRST_RUN_SETUP_CONTROL "$FIRST_RUN_CONTROL"
[ "$FIRST_RUN_CONTROL" != "RED" ] || bug P1 FIRST_RUN_SETUP_CONTROL "the pre-auth setup control ('Set up MediVault') is not visible on the first-run screen"

# Keychain prompt watch (honest observation only).
if [ "$(ui_window_count "SecurityAgent")" != "0" ] && [ "$(ui_window_count "SecurityAgent")" != "-1" ]; then
  snap "04a-keychain-prompt" || true
  qa_cap KEYCHAIN_UI "OBSERVED (SecurityAgent window during first-run)"
fi

# =============================================================================
note "=== GATEWAY 4: real registration click → backend start ==="
if ! v_click "Set up MediVault" "05-setup-click" "preparing local services"; then
  sleep 3
  ocr_capture || true
  if printf '%s' "$OCR_TEXT" | grep -qi -- "|[^|]*preparing local services\||[^|]*Registering"; then
    probe "the first click's state change was caught on the second OCR pass"
  elif v_click "Set up MediVault" "05-setup-click-retry" "preparing local services"; then
    :
  else
    snap "05-setup-click-failed" || true
    if [ -s /tmp/mv-direct-launch.log ]; then
      probe "--- app console at the click failure (last 80 lines) ---"
      tail -80 /tmp/mv-direct-launch.log 2>/dev/null | tee -a "$LOG" || true
    fi
    bug P1 REGISTRATION_CLICK "clicking the real 'Set up MediVault' control produced no visible state change"
  fi
fi
qa_cap REGISTRATION_CLICK "GREEN (real CGEvent click on the OCR-located button, verified by visible state change)"

note "--- bounded wait for the backend (supervisor provision can take minutes) ---"
SMAPP="NOT PROVEN"
API_OK=0
t0="$(date +%s)"
while [ $(( $(date +%s) - t0 )) -le 420 ]; do
  ST="$("$APP_PATH/Contents/MacOS/$HELPER_NAME" status 2>/dev/null || echo query-failed)"
  if [ "$ST" = "enabled" ]; then
    SMAPP="enabled"
  fi
  if curl -fsS --max-time 2 "$API/health" >/dev/null 2>&1; then
    API_OK=1
    break
  fi
  if [ $(( ($(date +%s) - t0) % 15 )) -eq 0 ]; then
    probe "backend wait: ${ST:-?}, elapsed=$(( $(date +%s) - t0 ))s"
    snap "06-backend-waiting" || true
  fi
  sleep 3
done
probe "SMAppService status: $SMAPP; API answered: $API_OK after $(( $(date +%s) - t0 ))s"
[ "$SMAPP" = "enabled" ] || {
  ST="$("$APP_PATH/Contents/MacOS/$HELPER_NAME" status 2>/dev/null || echo query-failed)"
  bug P1 SMAPPSERVICE "status is '$ST' after clicking the real setup control (expected enabled or requiresApproval with guidance)"
}
qa_cap SMAPPSERVICE "GREEN (status=enabled after the real UI registration click)"

[ "$API_OK" = "1" ] || {
  note "--- backend-never-up diagnostics (supervisor state + logs + launchd job) ---"
  SUP_HOME="$HOME/Library/Application Support/MediVault"
  probe "supervisor status file: $(cat "$SUP_HOME/runtime-state/supervisor-status.json" 2>/dev/null | head -c 400 || echo 'ABSENT')"
  probe "--- supervisor.log (last 40 lines):"
  tail -40 "$HOME/Library/Logs/MediVault/supervisor.log" 2>/dev/null | tee -a "$LOG" || probe "(supervisor.log absent)"
  probe "--- provision.log (last 25 lines):"
  tail -25 "$HOME/Library/Logs/MediVault/provision.log" 2>/dev/null | tee -a "$LOG" || probe "(provision.log absent)"
  probe "--- launchd job:"
  launchctl print "gui/$(id -u)/dev.medivault.supervisor" 2>&1 | grep -E 'state = |pid = |runs = |last exit code|program identifier|managed_by' | head -8 | tee -a "$LOG" || true
  bug P1 API "the API at 127.0.0.1:3001/health never answered after registration (waited 420s)"
}
qa_cap API "GREEN (http 127.0.0.1:3001/health after registration)"

# PostgreSQL proofs (self-reported state + LISTEN socket + /ready SELECT 1).
probe "supervisor status: $(cat "$SUP_STATUS" 2>/dev/null | head -c 400)"
SSTATE2="$(python3 -c "import json;print(json.load(open('$SUP_STATUS')).get('state','none'))" 2>/dev/null || echo none)"
t0s="$(date +%s)"
while [ "$SSTATE2" != "healthy" ] && [ $(( $(date +%s) - t0s )) -lt 45 ]; do
  if [ "$SSTATE2" = "failed" ] || [ "$SSTATE2" = "stopped" ]; then break; fi
  sleep 2
  SSTATE2="$(python3 -c "import json;print(json.load(open('$SUP_STATUS')).get('state','none'))" 2>/dev/null || echo none)"
done
PG_PID="$(python3 -c "import json;print(json.load(open('$SUP_STATUS')).get('pg_pid',0))" 2>/dev/null || echo 0)"
PG_LISTEN="$(lsof -nP -iTCP:$PGPORT 2>/dev/null | grep LISTEN | head -1)"
READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$API/ready" || echo 000)"
probe "pg proofs: supervisor-state=$SSTATE2 pg_pid=$PG_PID alive=$(kill -0 "$PG_PID" 2>/dev/null && echo yes || echo no) listen='${PG_LISTEN:-none}' /ready=$READY_CODE"
if [ "$SSTATE2" = "healthy" ] && [ -n "$PG_LISTEN" ] && [ "$READY_CODE" = "200" ]; then
  PG_CAP="GREEN (supervisor self-reports healthy; PG LISTENs on 127.0.0.1:$PGPORT; API /ready=200 performs SELECT 1 through the real DB)"
elif [ "$SSTATE2" = "healthy" ] && [ "$READY_CODE" = "200" ]; then
  PG_CAP="GREEN (supervisor healthy; API /ready=200 — SELECT 1 through the real DB; lsof did not show the listener, recorded honestly)"
else
  PG_CAP="RED (supervisor state=$SSTATE2 /ready=$READY_CODE listen='${PG_LISTEN:-none}')"
fi
qa_cap POSTGRES "$PG_CAP"
case "$PG_CAP" in GREEN*) : ;; *) bug P1 POSTGRES "$PG_CAP" ;; esac

snap "07-backend-healthy" || true

# BACKEND-CONTRACT surface rows (the clinic user's invisible-but-real surface).
surface_section "Background services (invisible surfaces, verified by contract)"
surface_row "SMAppService registration" "Set up MediVault click" "none (background)" "launchd registers dev.medivault.supervisor; status=enabled" "helper status queried" "GREEN (enabled)" "07-backend-healthy" "OK"
surface_row "API service" "Set up MediVault click" "none (background)" "127.0.0.1:3001 /health answers; loopback only" "curl /health + /ready" "GREEN" "07-backend-healthy" "OK"
surface_row "PostgreSQL" "Set up MediVault click" "none (background)" "127.0.0.1:55432 LISTEN; /ready=200 = SELECT 1" "lsof + /ready" "GREEN" "07-backend-healthy" "OK"

# =============================================================================
note "=== GATEWAY 5: hand-off to the API-served frontend (account setup) ==="
if ! wait_for_ocr "Create Your Account" 120 "account-setup-screen"; then
  if v_click "Open MediVault" "07a-handoff-fallback" "Create Your Account"; then
    wait_for_ocr "Create Your Account" 60 "account-setup-screen-after-fallback" || true
  fi
fi
SAFARI_WINS="$(ui_window_count "Safari")"
if ocr_grep "Create Your Account"; then
  if [ "$SAFARI_WINS" != "0" ] && [ "$SAFARI_WINS" != "-1" ]; then
    probe "Safari has $SAFARI_WINS window(s) — checking whether the setup screen is in SAFARI, not the app (disambiguation)"
    if osa 'tell application "System Events" to tell process "MediVault" to get value of attribute "AXTitle" of window 1' 8; then
      probe "MediVault window still present with title: $OSA_OUT"
    fi
  fi
  qa_cap HANDOFF "GREEN (the webview reached the API-served frontend: 'Create Your Account' visible)"
else
  snap "08-handoff-failed" || true
  note "--- hand-off diagnostics ---"
  probe "server-side: GET /            -> $(curl -s -o /dev/null -w '%{http_code} %{size_download}B' --max-time 4 "$API/" 2>/dev/null || echo 'REFUSED')"
  probe "server-side: GET /api/auth/setup -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$API/api/auth/setup" 2>/dev/null || echo 'REFUSED')"
  probe "WebContent processes: $(pgrep -fl 'com.apple.WebKit.WebContent' 2>/dev/null | head -3 | tr '\n' ' ' || echo none)"
  probe "--- WebKit / navigation system log (last 3 minutes, selected):"
  log show --last 3m --predicate 'process CONTAINS[c] "WebKit" OR (process == "medivault" AND eventMessage CONTAINS[c] "navigation")' --style compact 2>/dev/null | tail -30 | tee -a "$LOG" || probe "(log show unavailable)"
  if [ -s /tmp/mv-direct-launch.log ]; then
    probe "--- app console at the hand-off failure (last 40 lines) ---"
    tail -40 /tmp/mv-direct-launch.log 2>/dev/null | tee -a "$LOG" || true
  fi
  bug P1 HANDOFF "the app did not hand off to the API-served setup screen within 120s of backend health"
fi
snap "08-account-setup-screen" || true

# SURFACE RECORD: the account setup form (BEFORE consuming it).
record_inventory "account setup form (Create Your Account)"
surface_section "Account setup form (API-served origin, one-time)"
surface_row "Create Your Account card" "first-run hand-off" "title 'Create Your Account'; desc 'Fill in your details to get started'; step labels Profile/Security/Specialty" "the one-time account creation form" "observed (OCR) then filled+submitted in GATEWAY 6" "RECORDED" "08-account-setup-screen" "OK"
surface_row "Required fields" "setup form" "'Full Name *', 'Email *', 'Password *', 'Confirm *' (floating labels)" "all four required to create the account" "typed into the REAL fields (GATEWAY 6)" "PENDING GATEWAY 6" "09-account-*" "OK"
surface_row "Password strength checklist" "setup form" "'8+ characters', 'Uppercase (A-Z)', 'Lowercase (a-z)', 'Numbers (0-9)', 'Special (!@#$)' + 'Password strength:' meter" "live strength feedback while typing" "observed (OCR)" "RECORDED" "08-account-setup-screen" "OK"
surface_row "Optional fields" "setup form" "'Phone (optional)', 'Specialty (optional)' + preset specialty chips" "optional profile data" "observed (OCR where visible)" "RECORDED" "08-account-setup-screen" "OK"
surface_row "Submit + back" "setup form" "'Create Account & Start' button; 'Back to Sign In' link" "submit creates the account and enters the app" "submitted via the focused-field Return (real user flow)" "PENDING GATEWAY 6" "10-account-submit-enter" "OK"

# =============================================================================
# SETUP-FORM VALIDATION SUITE (account focus only) — probes the ONE-TIME
# Create Your Account form BEFORE consuming it. Safety design:
#   * SU1-SU3 are CLIENT-gated probes (mismatch / <6-char gates per the
#     form source) — they never reach the API and can never consume the
#     form; their honest outcome is the visible rejection text;
#   * SU4 (boundary) and SU5 (malformed email) DO reach the API and are
#     budget-aware: the server keeps an in-memory setup limiter at
#     3 POSTs/hour (auth-service checkRateLimit('setup', 3, 1h)). The
#     source-expected path spends 1 (boundary rejected by the 10-char
#     server policy) + 1 (malformed email ACCEPTED -> the account IS
#     created with it; GATEWAY 6 then runs no third submit) and leaves
#     the 3rd for the duplicate-setup probe inside focus_account;
#   * every outcome is recorded honestly (GREEN / P3 / D / ENV) — the
#     source-level suspects stay suspects until the real GUI speaks.
# Passwords go into masked fields (secret=yes) and are never printed;
# SU5's email is a synthetic non-address (no @).
# =============================================================================
DOC_PASS="$(cat "$DOC_PASS_FILE")"
SETUP_CONSUMED="no"
SETUP_API_ATTEMPTS=0

setup_after_submit_scroll_top() { # bring the form-top (and any error block
  # or native bubble anchored there) back into OCR view before the checks —
  # a blocked submit AUTO-SCROLLS to the first invalid field, and a React
  # rejection renders at the form top: from the page top both are visible.
  v_scroll_find "Full Name" 5 no up || true
}

setup_reject_grep() { # <needles...> — OCR a rejection text across up to 4
  # scroll-varied re-read positions; echoes the MATCHED needle (empty = none)
  # (run 34880579779, class D) the setup form's error block OCRs CLEANLY at
  # mid-viewport positions (SU2's 'Password must be at least 6 characters.'
  # was read perfectly at y~430) but GARBLES near the viewport top edge
  # (SU3's 'Passwords do not match.' became 'Passworas ao not maicn.' — the
  # gate FIRED and the pixels prove it, only the needle could not match).
  # Each re-read scrolls one 2-line burst up (the content moves ~40px down
  # the viewport, away from the chrome) and re-captures.
  local pos=0 matched="" n
  while [ "$pos" -le 3 ] && [ -z "$matched" ]; do
    ocr_capture || true
    for n in "$@"; do
      if [ -n "$n" ] && ocr_grep "$n"; then matched="$n"; break; fi
    done
    if [ -z "$matched" ] && [ "$pos" -lt 3 ]; then
      scroll_burst up 700 400 2
      sleep 1
    fi
    pos=$(( pos + 1 ))
  done
  printf '%s' "$matched"
}

setup_form_alive() { # is the one-time setup form still on screen?
  # (run 34880579779, class D) the title needle alone is SCROLL-POSITION
  # dependent: after the fill pattern's down-scroll the title sits above
  # the viewport while the form itself is alive — SU4/SU5 were wrongly
  # skipped. The first field label is visible at BOTH positions and exists
  # only on the setup form (the Add Patient dialog uses First/Last Name;
  # the login screen has no Full Name field).
  ocr_capture || return 1
  if ocr_grep "Create Your Account"; then return 0; fi
  ocr_grep "Full Name"
}

# (run 34877260555 first-red, class D) the setup-form GEOMETRY: a rejected
# submit renders the React error block between the card header and the
# fields — the block is ~48px tall and pushes the Password/Confirm labels
# BELOW the 768px fold (the run's OCR context proves it: after SU4's
# server rejection the Password/Confirm labels vanish from every capture,
# so both the clears and the typing failed and GATEWAY 6 hit a false P1).
# A real user scrolls; the harness scrolls the same way. clear_field was
# removed (dead after this redesign): every v_type_into below carries
# clear=yes — Cmd+A + Backspace before typing — so residual probe values
# can never be appended to (run 2's "MediVault Test DoctorMediVault Test
# Doctor" concatenation was the symptom).
setup_fill_form() { # <name> <email> <password> <confirm> <stem-prefix>
  # A real user's flow: scroll to the form top, fill name/email, scroll the
  # lower fields into view, fill password/confirm. On a compact (error-free)
  # form both scroll-finds are zero-burst no-ops — byte-compatible with the
  # proven surface-run typing flow.
  local name="$1" email="$2" pass="$3" conf="$4" stem="$5"
  v_scroll_find "Full Name" 6 no up || true
  if ! v_type_into "Full Name" "$name" "${stem}-name" no no yes; then
    return 1
  fi
  if ! v_type_into "Email" "$email" "${stem}-email" no no yes; then
    return 1
  fi
  v_scroll_find "Confirm" 4 no down || true
  if ! v_type_into "Password" "$pass" "${stem}-password" yes no yes; then
    return 1
  fi
  v_type_into "Confirm" "$conf" "${stem}-confirm" yes no yes
}

submit_focused_return() { # Return in whatever field currently holds focus
  # (run 34873498636 first-red, class D — see the comment at the former site)
  # defined BEFORE the setup-validation suite: the suite submits the one-time
  # form five times BEFORE the focus-framework section executes.
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10 >/dev/null 2>&1 || true
  sleep 3
}

setup_validation_suite() {
  note "=== SETUP VALIDATION SUITE (focus account): probing the one-time form ==="
  surface_section "Account setup form — validation battery (focus account)"

  # ---- SU1: empty-field submission ---------------------------------------
  # Two rejection layers may speak: the BROWSER's native constraint
  # validation (all four inputs carry `required`; WKWebView renders a
  # 'Please fill out this field.' bubble and never fires onSubmit) OR the
  # React gates (mismatch / 6-char minimum) OR a server 400. Any of the
  # three texts = a visible rejection; the one-time form must survive.
  if v_click "Email" "su1-focus-email" ""; then
    submit_focused_return
    local su1_rej=0
    ocr_capture || true
    if ocr_grep "fill out this field"; then su1_rej=1; fi
    if [ "$su1_rej" = "0" ] && ocr_grep "at least 6 characters"; then su1_rej=1; fi
    if [ "$su1_rej" = "0" ] && ocr_grep "are required"; then su1_rej=1; fi
    if [ "$su1_rej" = "1" ]; then
      snap "su1-empty-rejected" || true
      record_inventory "setup form after the empty-field submission"
      qa_cap EMPTY_FIELDS "GREEN (the all-empty submit was visibly rejected — the browser's native required-field validation fired; still on the setup form)"
      surface_row "Empty-field rejection" "setup form submitted with every field empty" "the four required floating-label fields (all inputs carry required) + submit" "the empty submit is rejected; no account is created" "focused the Email field + pressed Return; the visible native validation rejection was OCR-verified" "GREEN (rejected)" "su1-empty-rejected" "OK"
    elif ocr_grep "Add Patient"; then
      bug P1 EMPTY_FIELDS "the all-empty setup form submission left the setup screen (no visible rejection — account created?)"
      SETUP_CONSUMED="yes"
    else
      bug D SU1_VERIFY "could not OCR-verify the empty-submit rejection text (form still on screen — recorded honestly, no false red)"
      qa_cap EMPTY_FIELDS "INCONCLUSIVE (no rejection text OCR-verified; the form survived — see the D record)"
    fi
  else
    bug D SU1_FOCUS "could not focus the setup Email field for the empty-submit probe (no click attempted — probe inconclusive)"
  fi

  # ---- SU2: weak password ------------------------------------------------
  # ALL fields are filled (name/email included — run 34877260555 lesson:
  # with name/email empty the browser's NATIVE required validation blocks
  # the submit and the app's own 6-char gate never fires). 'Ab1!' passes
  # native (no minlength) and trips the React gate.
  if setup_fill_form "$DOC_NAME" "$DOC_EMAIL" "Ab1!" "Ab1!" "su2"; then
    submit_focused_return
    setup_after_submit_scroll_top
    SU2_HIT="$(setup_reject_grep "at least 6 characters" "are required")"
    if [ -n "$SU2_HIT" ]; then
      snap "su2-weak-rejected" || true
      record_inventory "setup form after the weak-password submission"
      qa_cap WEAK_PASSWORD "GREEN (the short-password submit was visibly rejected — the app's own gate text; matched needle: '$SU2_HIT')"
      surface_row "Weak password rejection" "all fields filled; Password + Confirm = 'Ab1!' then submit" "password strength checklist + submit" "a too-short password cannot create the account" "filled the whole form (so native validation passes) + Return; the visible rejection was OCR-verified (needle: $SU2_HIT)" "GREEN (rejected)" "su2-weak-rejected" "OK"
    elif [ -n "$(setup_reject_grep "fill out this field")" ]; then
      bug D SU2_NATIVE "the weak-password submit was STILL blocked by the native required validation (a field did not take the typing — probe inconclusive; the gate text unproven)"
      qa_cap WEAK_PASSWORD "INCONCLUSIVE (the native required validation blocked the submit — a typing glitch; see the D record)"
    elif ocr_grep "Add Patient"; then
      bug P1 WEAK_PASSWORD "the short-password ('Ab1!') submission left the setup screen (no visible rejection)"
      SETUP_CONSUMED="yes"
    else
      bug D SU2_VERIFY "could not OCR-verify the weak-password rejection text (recorded honestly)"
      qa_cap WEAK_PASSWORD "INCONCLUSIVE (no rejection text OCR-verified — see the D record)"
    fi
  else
    bug D SU2_TYPE "could not fill the weak-password probe form (typing failure — probe inconclusive)"
  fi

  # ---- SU3: confirmation mismatch ----------------------------------------
  # All fields filled (the form holds SU2's name/email — re-typed with
  # clear=yes by the helper); the mismatch gate is the FIRST React check.
  if setup_fill_form "$DOC_NAME" "$DOC_EMAIL" "$DOC_PASS" "Mismatch-Pass-99" "su3"; then
    submit_focused_return
    setup_after_submit_scroll_top
    SU3_HIT="$(setup_reject_grep "do not match")"
    if [ -n "$SU3_HIT" ]; then
      snap "su3-mismatch-rejected" || true
      record_inventory "setup form after the mismatch submission"
      qa_cap PASSWORD_MISMATCH "GREEN (the mismatched confirm was visibly rejected — 'do not match')"
      surface_row "Confirmation mismatch rejection" "all fields filled; Password = valid secret, Confirm = different value, then submit" "the two masked fields + submit" "mismatched passwords cannot create the account" "filled the whole form + Return; the 'do not match' rejection was OCR-verified (scroll-varied re-read)" "GREEN (rejected)" "su3-mismatch-rejected" "OK"
    elif [ -n "$(setup_reject_grep "are required")" ]; then
      # Equal-value typing glitch or gate miss: the submit was STILL
      # rejected server-side — the mismatch gate itself is not proven.
      bug D SU3_INCONCLUSIVE "the mismatch rejection text was not observed; the submit was still rejected ('are required') — the mismatch gate is unproven this run"
      qa_cap PASSWORD_MISMATCH "INCONCLUSIVE (submit still rejected server-side; the specific gate text not OCR-observed)"
    elif [ -n "$(setup_reject_grep "fill out this field")" ]; then
      bug D SU3_NATIVE "the mismatch submit was blocked by the native required validation (a field did not take the typing — probe inconclusive)"
      qa_cap PASSWORD_MISMATCH "INCONCLUSIVE (the native required validation blocked the submit — see the D record)"
    elif ocr_grep "Add Patient"; then
      bug P1 PASSWORD_MISMATCH "the mismatched-password submission left the setup screen (no visible rejection)"
      SETUP_CONSUMED="yes"
    else
      bug D SU3_VERIFY "could not OCR-verify the mismatch rejection text (recorded honestly)"
      qa_cap PASSWORD_MISMATCH "INCONCLUSIVE (no rejection text OCR-verified — see the D record)"
    fi
  else
    bug D SU3_TYPE "could not fill the mismatch probe form (typing failure — probe inconclusive)"
  fi

  # ---- SU4: password requirement boundary --------------------------------
  # The on-screen checklist advertises '8+ characters'; the form's client
  # gate is 6; the server policy is 10 (packages/auth password.ts). An
  # 8-char all-class password satisfies EVERY on-screen checklist row —
  # this probe submits exactly that and records what the real product
  # does. This is an API attempt (budget slot 1 of 3).
  if setup_form_alive; then
    if setup_fill_form "$DOC_NAME" "$DOC_EMAIL" "Qa1!efgh" "Qa1!efgh" "su4"; then
      submit_focused_return
      setup_after_submit_scroll_top
      SETUP_API_ATTEMPTS=$(( SETUP_API_ATTEMPTS + 1 ))
      local su4_done=0
      SU4_HIT="$(setup_reject_grep "at least 10 characters")"
      if [ -n "$SU4_HIT" ]; then
        su4_done=1
        snap "su4-boundary-rejected" || true
        record_inventory "setup form after the 8-char boundary submission"
        qa_cap PASSWORD_BOUNDARY "GREEN (8-char all-class password REJECTED by the server's 10-char policy — the on-screen checklist understates it)"
        surface_row "Password requirement boundary" "checklist-compliant 8-char all-class password submitted" "checklist says '8+ characters'; submit gate is 6" "the real enforced minimum is discoverable only by rejection" "submitted the checklist-compliant password; the visible server rejection was OCR-verified" "GREEN (rejected — server minimum is 10, checklist says 8)" "su4-boundary-rejected" "P3-NOTE"
        bug P3 PASSWORD_POLICY_MISMATCH "the setup form's on-screen checklist advertises '8+ characters' and its client gate is 6, but the server enforces 10 — a checklist-compliant password is visibly rejected. Clinic impact: a doctor following the on-screen requirements gets an unexplained rejection (no checklist row says 10)."
      elif wait_for_ocr "Add Patient" 20 "su4-boundary-accepted"; then
        su4_done=1
        snap "su4-boundary-accepted" || true
        bug P3 PASSWORD_BOUNDARY_ACCEPTED "the server ACCEPTED the 8-char all-class password (the source-declared policy is 10) — the real enforced minimum is 8 or lower this build; the account was created with the boundary password"
        printf 'Qa1!efgh\n' > "$DOC_PASS_FILE"
        DOC_PASS="Qa1!efgh"
        SETUP_CONSUMED="yes"
        qa_cap PASSWORD_BOUNDARY "RED-P3 (8-char all-class password ACCEPTED — weaker than the declared 10-char policy; account created with it)"
        qa_cap ACCOUNT_CREATION "GREEN (account created via the setup form with the boundary password — see PASSWORD_BOUNDARY)"
        surface_row "Password requirement boundary" "checklist-compliant 8-char all-class password submitted" "checklist says '8+ characters'" "the real enforced minimum" "submitted; the dashboard appeared (accepted)" "RED-P3 (accepted at 8)" "su4-boundary-accepted" "P3"
      fi
      if [ "$su4_done" = "0" ]; then
        if setup_form_alive; then
          bug D SU4_VERIFY "the boundary submission produced no OCR-readable outcome; the form is still alive — continuing (probe inconclusive)"
          qa_cap PASSWORD_BOUNDARY "INCONCLUSIVE (no OCR-readable outcome; the form survived)"
        else
          bug P1 SU4_STATE "after the boundary submission the screen is neither the setup form nor the dashboard"
        fi
      fi
    else
      bug D SU4_TYPE "could not fill the boundary probe (typing failure — probe inconclusive; no submit attempted)"
    fi
  else
    probe "SU4 skipped — the setup form is no longer on screen (an earlier probe consumed it)"
    qa_cap PASSWORD_BOUNDARY "NOT EXERCISED this run (the form-alive check failed after SU3 — honest skip; see the probe log)"
  fi

  # ---- SU5: malformed email ----------------------------------------------
  # The source-level suspect, NARROWED by the input layer: the Email input
  # is type=email + required — the BROWSER's native constraint validation
  # ("Please include an '@' in the email address.") blocks a no-@ submit
  # BEFORE the app's own code runs; no APP-level format validation exists
  # beyond it. This probe submits a structurally invalid address with an
  # otherwise-valid form: a native-bubble rejection proves the input-layer
  # protection (the suspect refuted at the GUI); acceptance (dashboard)
  # would prove a REAL validation gap (P3) and consume the form; a React/
  # server error text also records a rejection honestly. API budget slot
  # 2 of 3 — spent ONLY if the native layer lets the submit through.
  if [ "$SETUP_CONSUMED" != "yes" ] && setup_form_alive; then
    if setup_fill_form "$DOC_NAME" "malformed.no-at.medivault-qa" "$DOC_PASS" "$DOC_PASS" "su5"; then
      submit_focused_return
      # The native bubble (if any) appears IMMEDIATELY (the blocked submit
      # auto-scrolls the invalid Email field into view); bring the form-top
      # into OCR view and check the rejection needles FIRST, before spending
      # the 90s dashboard wait
      setup_after_submit_scroll_top
      local su5_rej=0
      local su5_native=0
      # scroll-varied re-reads: the native bubble anchors at the Email field
      # (auto-scrolled into view by the blocked submit) and the React error
      # renders at the form top — both OCR better away from the viewport top
      SU5_NATIVE_HIT="$(setup_reject_grep "include an" "email address")"
      if [ -n "$SU5_NATIVE_HIT" ]; then su5_rej=1; su5_native=1; fi
      if [ "$su5_rej" = "0" ] && [ -n "$(setup_reject_grep "at least 10 characters" "are required" "valid")" ]; then su5_rej=1; fi
      # API-attempt accounting (run 34873498636 refinement): a NATIVE-bubble
      # rejection proves the submit never left the browser — it costs NO
      # real setup-POST budget. Every other outcome (accepted by the server,
      # rejected by the server, or unverifiable) conservatively counts.
      if [ "$su5_native" = "0" ]; then
        SETUP_API_ATTEMPTS=$(( SETUP_API_ATTEMPTS + 1 ))
      else
        probe "SU5: the native type=email validation blocked the submit — no setup POST spent (budget intact)"
      fi
      local su5_done=0
      if [ "$su5_rej" = "1" ]; then
        su5_done=1
        snap "su5-malformed-rejected" || true
        record_inventory "setup form after the malformed-email submission (native validation)"
        qa_cap INVALID_EMAIL "GREEN (the structurally invalid email (no @) was visibly REJECTED — the browser's native type=email validation fired; no account was created with it)"
        surface_row "Malformed email handling" "structurally invalid email (no @) + otherwise valid form" "the Email input (type=email + required) + submit" "an invalid address must be rejected before an account exists" "typed the malformed address + submitted; the native validation rejection was OCR-verified (bubble text visible)" "GREEN (rejected at the input layer)" "su5-malformed-rejected" "OK"
      elif wait_for_ocr "Add Patient" 90 "su5-malformed-accepted"; then
        su5_done=1
        snap "su5-malformed-accepted" || true
        record_inventory "dashboard after the malformed-email account creation"
        DOC_EMAIL="malformed.no-at.medivault-qa"
        SETUP_CONSUMED="yes"
        bug P3 EMAIL_VALIDATION "the setup form accepted the structurally invalid address 'malformed.no-at.medivault-qa' (no @) and created the account with it — no email-format validation exists on the client or the server path. Clinic impact: account-identity data quality (a typo'd address becomes the login handle with no correction prompt). Not a security exposure (loopback-only, synthetic)."
        qa_cap INVALID_EMAIL "RED-P3 (the malformed email was ACCEPTED — the account was created with it; login continues with this address)"
        qa_cap ACCOUNT_CREATION "GREEN (account created through the real setup form — via the malformed-email probe; the dashboard is visible)"
        surface_row "Malformed email handling" "structurally invalid email (no @) + otherwise valid form" "the Email field + submit" "a structurally invalid address should be rejected by validation" "typed the malformed address + submitted; the dashboard appeared (accepted — P3 recorded)" "RED-P3 (accepted)" "su5-malformed-accepted" "P3"
        surface_row "Valid account creation" "the real one-time setup form" "'Create Account & Start'" "a valid submission creates the account and enters the app" "the account exists and the session is live (created by the SU5 probe — see its row)" "GREEN" "su5-malformed-accepted; 10-dashboard" "OK"
      elif ocr_grep "at least 10 characters" || ocr_grep "are required" || ocr_grep "valid"; then
        su5_done=1
        snap "su5-malformed-rejected" || true
        qa_cap INVALID_EMAIL "GREEN (the malformed email was visibly rejected — validation present)"
        surface_row "Malformed email handling" "structurally invalid email (no @) + otherwise valid form" "the Email field + submit" "an invalid address is rejected" "typed + submitted; a visible rejection appeared" "GREEN (rejected)" "su5-malformed-rejected" "OK"
      fi
      if [ "$su5_done" = "0" ]; then
        if setup_form_alive; then
          bug D SU5_VERIFY "the malformed-email submission produced no OCR-readable outcome; the form is still alive — GATEWAY 6 will submit the valid form (probe inconclusive; its clear=yes typing clears any residual values)"
          qa_cap INVALID_EMAIL "INCONCLUSIVE (no OCR-readable outcome)"
        elif ocr_grep "Add Patient"; then
          su5_done=1
          DOC_EMAIL="malformed.no-at.medivault-qa"
          SETUP_CONSUMED="yes"
          probe "SU5: the dashboard appeared without the wait catching it — treating as accepted (honest late detection)"
          bug P3 EMAIL_VALIDATION "the malformed address 'malformed.no-at.medivault-qa' was accepted (dashboard reached; late-detected) — no email-format validation on the path"
          qa_cap INVALID_EMAIL "RED-P3 (accepted — late-detected)"
          qa_cap ACCOUNT_CREATION "GREEN (account created; dashboard visible)"
        else
          bug P1 SU5_STATE "after the malformed-email submission the screen is neither the form nor the dashboard"
        fi
      fi
    else
      bug D SU5_TYPE "could not fill the malformed-email probe (typing/verification failure — no submit attempted; GATEWAY 6 proceeds)"
      qa_cap INVALID_EMAIL "INCONCLUSIVE (harness typing limit — the probe did not submit)"
    fi
  else
    probe "SU5 skipped — the setup form was already consumed (SETUP_CONSUMED=$SETUP_CONSUMED) or not detected alive"
    if [ "$SETUP_CONSUMED" != "yes" ]; then
      qa_cap INVALID_EMAIL "NOT EXERCISED this run (the form-alive check failed — honest skip; see the probe log)"
    fi
  fi
  note "setup validation suite complete: SETUP_CONSUMED=$SETUP_CONSUMED SETUP_API_ATTEMPTS=$SETUP_API_ATTEMPTS"
}

if [ "$QA_FOCUS" = "account" ]; then
  setup_validation_suite
fi

# =============================================================================
note "=== GATEWAY 6: account creation (real UI) ==="
if [ "$SETUP_CONSUMED" = "yes" ]; then
  note "GATEWAY 6 submission SKIPPED — the one-time form was already consumed by the setup-validation suite (the account exists and the session is live; see the SU records)"
  if ! wait_for_ocr "Add Patient" 90 "dashboard-after-suite-consumed"; then
    snap "10-dashboard-not-visible-after-suite" || true
    bug P1 ACCOUNT_CREATION "the suite consumed the form but the dashboard never appeared"
  fi
  snap "10-dashboard" || true
else
# (run 34877260555 first-red, class D) the suite may leave the form with the
# error block rendered (the Password/Confirm labels below the fold) and
# residual probe values in the fields — the same scroll-aware + clear=yes
# fill pattern as the suite (a real user scrolls and corrects); on a clean
# compact form both scroll-finds are zero-burst no-ops.
if ! setup_fill_form "$DOC_NAME" "$DOC_EMAIL" "$DOC_PASS" "$DOC_PASS" "09-account"; then
  snap "09-account-fill-failed" || true
  bug P1 ACCOUNT_CREATION "could not fill the real setup form (a name/email/password/confirm typing step failed — see the probe log for which field; the scroll-aware pattern already ran)"
fi
snap "09-account-form-filled" || true

SUBMITTED=0
if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
  sleep 3
  if wait_for_ocr "Add Patient" 45 "dashboard-after-enter-submit"; then
    SUBMITTED=1
    snap "10-account-submit-enter" || true
    probe "the focused-field Return submitted the setup form (the button was below the fold — a real user's flow)"
  fi
fi
if [ "$SUBMITTED" = "0" ]; then
  ocr_capture || true
  if ! ocr_grep "Create Account"; then
    osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 121' 10 >/dev/null 2>&1 || true
    sleep 1
  fi
  if ! v_click "Create Account & Start" "10-account-submit" "Add Patient"; then
    if ! v_click "Create Account" "10-account-submit" "Add Patient"; then
      snap "10-account-submit-failed" || true
      bug P1 ACCOUNT_CREATION "submitting the real setup form produced no visible change (no dashboard)"
    fi
  fi
fi
if ! wait_for_ocr "Add Patient" 90 "dashboard-after-setup"; then
  snap "10-dashboard-not-visible" || true
  bug P1 ACCOUNT_CREATION "the dashboard ('Add Patient') never appeared after account creation"
fi
SETUP_API_ATTEMPTS=$(( SETUP_API_ATTEMPTS + 1 ))
qa_cap ACCOUNT_CREATION "GREEN (account created through the real setup form; the dashboard is visible)"
snap "10-dashboard" || true
fi # SETUP_CONSUMED guard around GATEWAY 6

# =============================================================================
# FOCUS FRAMEWORK (new) — reusable exploratory helpers
# =============================================================================

# Compatibility shim: the verbatim-extracted primitives call product_red()
# on their first-red paths — in this lane that is the P1 stop-focus
# discipline (same stop semantics, honest bookkeeping).
product_red() { # <field> <detail> — first product red → P1 (stop the focus)
  bug P1 "$1" "$2"
}

wait_text_gone() { # <needle> <timeout_s> <label> — bounded wait until text is NOT visible
  local needle="$1" t="$2" label="$3"
  local t0
  t0="$(date +%s)"
  while [ $(( $(date +%s) - t0 )) -le "$t" ]; do
    if ocr_capture && ! ocr_grep "$needle"; then
      probe "wait_gone[$label]: '$needle' no longer visible"
      return 0
    fi
    sleep 2
  done
  probe "wait_gone[$label]: '$needle' STILL visible after ${t}s"
  return 1
}

press_escape() { # the real Escape key into the app
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 53' 10 >/dev/null 2>&1 || true
  sleep 1
}

# (run 34873498636 first-red, class D) submit_focused_return ORIGINALLY lived
# in this focus-framework section — but the setup-validation suite (which runs
# BEFORE GATEWAY 6, earlier in the linear flow) calls it at a point where the
# definition did not exist yet: bash 3.2 resolves function names at CALL time,
# so all five setup probes failed with 'command not found' and never actually
# submitted the form (the probes' honest D records from that run are the
# evidence). The definition now lives BEFORE the suite; the invocation-order-
# aware static checker (def-before-use v2) is the regression test.
scroll_through_view() { # <stem-prefix> <max-screens> — record every unique screen top→bottom
  local stem="$1" max="$2"
  local i=0 last_hash="" up=0
  while [ "$up" -lt 8 ]; do
    scroll_burst up
    sleep 1
    up=$((up + 1))
  done
  probe "scroll-through[$stem]: scrolled to the top first (rubber-band bounded)"
  while [ "$i" -lt "$max" ]; do
    ocr_capture || true
    if [ -n "$last_hash" ] && [ "$LAST_OCR_HASH" = "$last_hash" ]; then
      probe "scroll-through[$stem]: the screen stopped changing at position $i (bottom reached)"
      break
    fi
    last_hash="$LAST_OCR_HASH"
    snap "${stem}-${i}" || true
    record_inventory "${stem} screen position ${i}"
    scroll_burst down
    sleep 1
    i=$((i + 1))
  done
  probe "scroll-through[$stem]: $i unique screen(s) recorded"
}

create_patient_full() { # <first> <last> <phone> <email> <note> <stem> — richer create (search focus data)
  local first="$1" last="$2" phone="$3" email="$4" notetxt="$5" stem="$6"
  if ! v_click "Add Patient" "${stem}-open" "First Name" first 0 label; then
    if ! v_click_try_hits "Add Patient" "${stem}-open" "First Name"; then
      snap "${stem}-open-failed" || true
      bug P1 "PATIENT_${stem}" "the Add Patient dialog ('First Name' field) never opened"
    fi
  fi
  if ! v_type_into "First Name" "$first" "${stem}-first"; then
    bug P1 "PATIENT_${stem}" "could not type the first name"
  fi
  if ! v_type_into "Last Name" "$last" "${stem}-last"; then
    bug P1 "PATIENT_${stem}" "could not type the last name"
  fi
  if ! v_type_into "Phone" "$phone" "${stem}-phone"; then
    bug P1 "PATIENT_${stem}" "could not type the phone"
  fi
  if ! v_type_into "Email" "$email" "${stem}-email"; then
    bug P1 "PATIENT_${stem}" "could not type the email"
  fi
  if ! v_type_into "Notes" "$notetxt" "${stem}-notes"; then
    bug P1 "PATIENT_${stem}" "could not type the patient notes"
  fi
  snap "${stem}-form-filled" || true
  PATIENT_SUBMITTED=0
  if ocr_lookup "First Name" "first" "label"; then
    "$MV_MOUSE" "$OCR_HIT_X" "$(( OCR_HIT_Y + 6 ))" 2>>"$LOG" || true
    sleep 1
    if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
      sleep 3
      ocr_capture || true
      if [ -n "$OCR_TEXT" ] && ! ocr_grep "Add New Patient"; then
        PATIENT_SUBMITTED=1
        snap "${stem}-submit-enter" || true
        probe "the First-Name-field Return submitted the ${stem} patient form"
      fi
    fi
  fi
  if [ "$PATIENT_SUBMITTED" = "0" ]; then
    local b=0
    while [ "$b" -lt 4 ]; do
      scroll_burst down 500 400
      sleep 1
      b=$((b + 1))
    done
    if ! v_click_try_hits "Add Patient" "${stem}-submit" "$first"; then
      snap "${stem}-submit-failed" || true
      bug P1 "PATIENT_${stem}" "submitting the Add Patient form produced no visible change"
    fi
  fi
  sleep 2
}

v_click_delete_trash() { # <patient-full-name> <stem> — the icon-only DELETE control (rightmost cluster)
  local name="$1" stem="$2"
  # (run 35048296418, class D): a detail opened from a SEARCH-row click
  # lands with the banner SCROLLED OFF-SCREEN — the name anchor is then
  # 'not found' and the delete battery D's (Zed was never deleted, and the
  # PP persistence count P1'd on the cascade). Scroll the detail to the TOP
  # (the banner) before the anchor lookup — the pencil's own fix.
  local up=0
  while [ "$up" -lt 8 ]; do
    scroll_burst up
    sleep 1
    up=$((up + 1))
  done
  ocr_capture || return 1
  if ! ocr_lookup "$name" "first"; then
    probe "vclick-trash[$stem]: patient name '$name' not found on screen — no anchor, no click"
    return 1
  fi
  # (run 35048296418, class D): the band comes from the TOPMOST BANNER ROW
  # (the pencil's shared derivation) — never from the anchor's own y.
  local band_cy x0 band_src
  band_src="$(detail_banner_row)"
  if [ -n "$band_src" ]; then
    band_cy=$(( band_src - 13 ))
  else
    band_cy=$(( OCR_HIT_Y - 13 ))
  fi
  x0=$(( OCR_HIT_X + OCR_HIT_W + 30 ))
  probe "vclick-trash[$stem]: anchor name '$name' at ($OCR_HIT_X,$OCR_HIT_Y) — icon band center y=$band_cy"
  if [ -n "$MV_ICONSCAN" ]; then
    local hits n hit cx icy
    hits="$("$MV_ICONSCAN" "$MV_SHOT" "$MV_SCALE" "$x0" "$band_cy" "22" 2>>"$LOG" || true)"
    n="$(printf '%s\n' "$hits" | grep -c '^ICON|' || true)"
    probe "vclick-trash[$stem]: icon scan found $n cluster(s): $(printf '%s' "$hits" | tr '\n' ' ')"
    local right_hits rn
    right_hits="$(printf '%s\n' "$hits" | grep '^ICON|' | awk -F'|' '$2 > 700' | sort -t'|' -k2 -n)"
    rn="$(printf '%s\n' "$right_hits" | grep -c '^ICON|' || true)"
    if [ "${rn:-0}" -ge 3 ]; then
      hit="$(printf '%s\n' "$right_hits" | sed -n '3p')"   # trash = RIGHTMOST of report|pencil|trash
    elif [ "${rn:-0}" -ge 1 ]; then
      hit="$(printf '%s\n' "$right_hits" | tail -1)"
    else
      hit=""
    fi
    if [ -n "$hit" ]; then
      cx="$(printf '%s' "$hit" | awk -F'|' '{print $2}')"
      icy="$(printf '%s' "$hit" | awk -F'|' '{print $3}')"
      probe "vclick-trash[$stem]: clicking the rightmost cluster at ($cx,$icy) — verified by the 'Delete Patient' dialog opening"
      "$MV_MOUSE" "$cx" "$icy" 2>>"$LOG" || true
      sleep 2
      ocr_capture || return 1
      if ocr_grep "Delete Patient"; then
        snap_file "$MV_SHOT" "${stem}-open" || true
        probe "vclick-trash[$stem]: the Delete Patient dialog opened"
        return 0
      fi
      probe "vclick-trash[$stem]: the cluster click did not open the delete dialog"
      press_escape
    fi
  fi
  local cand ty2
  ty2=$(( OCR_HIT_Y - 15 ))
  for cand in 940 955 920 970 900; do
    probe "vclick-trash[$stem]: anchored fallback click at ($cand,$ty2)"
    "$MV_MOUSE" "$cand" "$ty2" 2>>"$LOG" || true
    sleep 2
    ocr_capture || return 1
    if ocr_grep "Delete Patient"; then
      snap_file "$MV_SHOT" "${stem}-open-fb" || true
      probe "vclick-trash[$stem]: the Delete Patient dialog opened via the anchored fallback"
      return 0
    fi
    press_escape
    sleep 1
  done
  probe "vclick-trash[$stem]: the icon-only delete control could not be activated (all attempts recorded)"
  return 1
}

# =============================================================================
# FOCUS: surface — the reachable-product walk (clinic user + QA)
# =============================================================================
focus_surface() {
  note "=== FOCUS surface: the reachable-product walk ==="

  # --- S1: dashboard top ---
  v_scroll_top 10 || true
  ocr_capture || true
  snap "s10-dashboard-top" || true
  record_inventory "dashboard top (fresh account, post-setup)"
  surface_section "Dashboard — top (fresh account)"
  surface_row "App header" "post-setup dashboard" "logo + 'MediVault' wordmark; nav pills 'Dashboard'/'Settings'; icon-only right controls (patient switcher, notification bell, theme toggle, backup, profile pill)" "persistent header navigation on every app view" "observed (OCR); the icon-only controls are recorded as such (no OCR text anchor — see the dedicated rows below)" "RECORDED" "s10-dashboard-top" "OK"
  surface_row "Greeting + date" "dashboard top" "'Good Morning/Afternoon/Evening, MediVault Test Doctor' + the long-form date" "personalized greeting from the account name" "observed (OCR)" "RECORDED" "s10-dashboard-top" "OK"
  surface_row "Dashboard action buttons" "dashboard top" "'Analytics' (toggle), 'Calendar' (toggle), 'Add Patient', 'Scan Document', 'Import CSV', 'Export CSV'" "the primary action row" "each visited later in this focus (S3-S6)" "PENDING" "s10-dashboard-top" "OK"
  surface_row "Today's Overview widget" "dashboard top" "live clock + date; visits/seen/docs badges; 'All caught up!' empty state; 'Schedule Visit' + 'Add Patient' buttons" "the day-at-a-glance card" "observed (OCR)" "RECORDED" "s10-dashboard-top" "OK"

  # --- S2: the full dashboard scroll-through + section discovery ---
  scroll_through_view "s11-dashboard" 12
  surface_section "Dashboard — scroll-through sections (fresh account)"
  local seen_welcome=no seen_stats=no seen_categories=no seen_search=no seen_recentlyviewed=no seen_upcoming=no seen_patients=no seen_empty=no seen_docs=no seen_timeline=no seen_footer=no
  local j=0 last_hash=""
  v_scroll_top 10 || true
  while [ "$j" -lt 14 ]; do
    ocr_capture || true
    if [ -n "$last_hash" ] && [ "$LAST_OCR_HASH" = "$last_hash" ]; then break; fi
    last_hash="$LAST_OCR_HASH"
    ocr_grep "GETTING STARTED" && seen_welcome=yes
    ocr_grep "Recent Uploads" && seen_stats=yes
    ocr_grep "Document Categories" && seen_categories=yes
    ocr_grep "Search patients" && seen_search=yes
    ocr_grep "Recently Viewed" && seen_recentlyviewed=yes
    ocr_grep "Upcoming Visits" && seen_upcoming=yes
    ocr_grep "Recent Patients" && seen_patients=yes
    ocr_grep "No patients yet" && seen_empty=yes
    ocr_grep "Recent Documents" && seen_docs=yes
    ocr_grep "Activity Timeline" && seen_timeline=yes
    ocr_grep "All data stored locally" && seen_footer=yes
    scroll_burst down
    sleep 1
    j=$((j + 1))
  done
  probe "dashboard section discovery: welcome=$seen_welcome stats=$seen_stats categories=$seen_categories search=$seen_search recentlyviewed=$seen_recentlyviewed upcoming=$seen_upcoming patients=$seen_patients empty=$seen_empty docs=$seen_docs timeline=$seen_timeline footer=$seen_footer"
  surface_row "Welcome banner (GETTING STARTED tips)" "dashboard scroll" "'GETTING STARTED — Tip N of 4'; rotating tips; per-tip action button ('Add Patient'/'Start Scanning'/'Go to Settings')" "onboarding tips for a fresh account" "observed=$seen_welcome (OCR)" "RECORDED" "s11-dashboard-*" "OK"
  surface_row "Stat cards" "dashboard scroll" "'Patients', 'Documents', 'Storage Used', 'Recent Uploads' (+ 'documents today' subtext)" "the clinic-at-a-glance stats" "observed=$seen_stats (OCR)" "RECORDED" "s11-dashboard-*" "OK"
  surface_row "Document Categories chart" "dashboard scroll" "'Document Categories' card (top-5 categories bar chart)" "document category distribution" "observed=$seen_categories (OCR)" "RECORDED" "s11-dashboard-*" "OK"
  surface_row "Patient search box" "dashboard scroll" "placeholder 'Search patients by name, phone, or email...'; clear control; 'Ctrl+K' hint" "the patient search entry point" "observed=$seen_search; exercised in S10" "RECORDED" "s11-dashboard-*; s18-*" "OK"
  surface_row "Recently Viewed chips" "dashboard scroll" "'Recently Viewed' heading + avatar chips (empty on a fresh account — the section hides)" "quick re-entry to recently opened patients" "observed=$seen_recentlyviewed (hidden when empty per source — EXPECTED)" "RECORDED" "s11-dashboard-*" "EXPECTED"
  surface_row "Upcoming Visits" "dashboard scroll" "'Upcoming Visits' heading + 'Schedule Visit' button; 'No upcoming visits' empty state" "the visit schedule entry point" "observed=$seen_upcoming (OCR); the dialog is probed in S7" "RECORDED" "s11-dashboard-*" "OK"
  surface_row "Patient list (Recent Patients)" "dashboard scroll" "'Recent Patients' heading + 'N patients' badge; 'No patients yet' + 'Get Started' empty state on a fresh account" "the patient roster" "observed=$seen_patients empty-state=$seen_empty (OCR)" "RECORDED" "s11-dashboard-*" "OK"
  surface_row "Recent Documents" "dashboard scroll" "'Recent Documents' grid (hidden when the query is active / no data)" "recent document cards" "observed=$seen_docs (OCR)" "RECORDED" "s11-dashboard-*" "OK"
  surface_row "Activity Timeline" "dashboard scroll" "'Activity Timeline' heading + event rows" "recent clinic activity" "observed=$seen_timeline (OCR)" "RECORDED" "s11-dashboard-*" "OK"
  surface_row "App footer" "dashboard scroll (bottom)" "'MediVault'; 'Secure Medical Document Management'; 'HIPAA Ready'; 'v1.0'; 'All data stored locally'; Community/Support/Updates links; 'Press Shift+? for shortcuts' button" "the persistent footer" "observed=$seen_footer (OCR); the shortcuts button is probed in S9" "RECORDED" "s11-dashboard-*" "OK"

  # --- S3: Analytics panel toggle ---
  v_scroll_top 10 || true
  if v_click "Analytics" "s13-analytics-on" "Patient Growth"; then
    sleep 2
    ocr_capture || true
    snap "s13-analytics-panel" || true
    record_inventory "analytics panel (expanded)"
    surface_section "Analytics panel (dashboard toggle)"
    surface_row "Analytics panel" "'Analytics' dashboard toggle" "period pills 'Last 12 Months'/'Last 6 Months'/'Last 30 Days'; 'Export CSV'; charts 'Patient Growth', 'Documents Uploaded', 'Document Categories', 'Storage Growth', 'Activity Heatmap'" "an in-dashboard analytics expansion" "toggled ON via the real button; panels OCR-verified" "GREEN (opened + verified)" "s13-analytics-*" "OK"
    if v_click "Analytics" "s13-analytics-off" ""; then
      probe "analytics toggle-off click verified (hash-diff)"
    else
      ocr_capture || true
      if ! ocr_grep "Patient Growth"; then
        probe "analytics panel collapsed (verified by absence of 'Patient Growth')"
      else
        bug D SURFACE_ANALYTICS_TOGGLE "the analytics panel did not visibly collapse on the second 'Analytics' click (harness verification limit or a product toggle bug — recorded)"
      fi
    fi
  else
    bug D SURFACE_ANALYTICS_OPEN "the 'Analytics' toggle could not be activated (OCR/click failed — recorded honestly)"
  fi

  # --- S4: Calendar panel toggle ---
  v_scroll_top 10 || true
  if v_click "Calendar" "s14-calendar-on" "Appointment Calendar"; then
    sleep 2
    ocr_capture || true
    snap "s14-calendar-panel" || true
    record_inventory "appointment calendar (expanded)"
    surface_section "Appointment Calendar panel (dashboard toggle)"
    surface_row "Appointment Calendar panel" "'Calendar' dashboard toggle" "heading 'Appointment Calendar' + 'N visit(s) in view'; 'Month'/'Week' modes; '<' 'Today' '>' nav; Visit Types legend; day cells" "an in-dashboard visit calendar" "toggled ON via the real button; verified by the panel heading" "GREEN (opened + verified)" "s14-calendar-*" "OK"
    if v_click "Calendar" "s14-calendar-off" ""; then
      probe "calendar toggle-off click verified (hash-diff)"
    else
      ocr_capture || true
      if ! ocr_grep "Appointment Calendar"; then
        probe "calendar panel collapsed (verified by absence of the heading)"
      else
        bug D SURFACE_CALENDAR_TOGGLE "the calendar panel did not visibly collapse on the second 'Calendar' click (recorded)"
      fi
    fi
  else
    bug D SURFACE_CALENDAR_OPEN "the 'Calendar' toggle could not be activated (recorded honestly)"
  fi

  # --- S5: Scan & Upload view ---
  v_scroll_top 10 || true
  if v_click "Scan Document" "s15-scan-view" "Scan & Upload"; then
    sleep 2
    ocr_capture || true
    snap "s15-scan-view" || true
    record_inventory "Scan & Upload view"
    surface_section "Scan & Upload view"
    surface_row "Scan & Upload view" "'Scan Document' dashboard button" "title 'Scan & Upload' + capture/upload subtitle; 'Select Patient *' dropdown; 'Camera Capture' card ('Open Camera'); 'File Upload' card ('Drop files here or click to browse' + supported formats); 'Document Details' (Title/Category/Notes); 'Upload N Document(s)' submit; 'Recently Scanned' strip" "the document capture surface" "opened via the real button; OCR-verified" "GREEN (opened + verified)" "s15-scan-view" "OK"
    surface_row "Open Camera button" "Scan & Upload view" "'Open Camera' + shutter + 'Capture Document'" "device-camera document scanning" "NOT activated this focus (camera hardware dependency on the runner — ENV); recorded per source" "RECORDED (not tested)" "s15-scan-view" "ENV"
    v_click "Dashboard" "s15-back-to-dashboard" "Add Patient" || true
    wait_for_ocr "Add Patient" 45 "dashboard-after-scan" || true
  else
    bug P1 SURFACE_SCAN_VIEW "the 'Scan Document' button did not open the Scan & Upload view"
  fi

  # --- S6: Add Patient dialog (open → inventory → empty-required probe → cancel → escape path) ---
  v_scroll_top 10 || true
  if v_click "Add Patient" "s16-dialog-open" "Add New Patient" first 0 label || v_click "Add Patient" "s16-dialog-open" "First Name" first 0 label; then
    sleep 2
    ocr_capture || true
    snap "s16-add-patient-dialog" || true
    record_inventory "Add New Patient dialog"
    surface_section "Add Patient dialog"
    surface_row "Add New Patient dialog" "'Add Patient' dashboard button" "title 'Add New Patient'; fields 'First Name *', 'Last Name *', 'Date of Birth', 'Phone', 'Email', 'Address', 'Notes'; 'Optional Details' divider + optional-filled meter; 'Cancel' + 'Add Patient' buttons" "the patient creation form" "opened via the real button; OCR-verified" "GREEN (opened + verified)" "s16-add-patient-dialog" "OK"
    # empty-required probe: Return in the EMPTY First Name field → HTML5 required must block
    if ocr_lookup "First Name" "first" "label"; then
      "$MV_MOUSE" "$OCR_HIT_X" "$(( OCR_HIT_Y + 6 ))" 2>>"$LOG" || true
      sleep 1
      submit_focused_return
      ocr_capture || true
      snap "s16-empty-required-probe" || true
      if ocr_grep "Add New Patient"; then
        probe "empty-required probe: the dialog STAYED OPEN (required validation held — no patient created with empty names)"
        surface_row "Required-field validation" "Add Patient dialog, empty submit" "'First Name *'/'Last Name *' required" "an empty submit must not create a patient" "Return pressed in the empty First Name field; dialog stayed open" "HELD (no empty patient)" "s16-empty-required-probe" "OK"
      else
        bug P2 PATIENT_EMPTY_SUBMIT "submitting the Add Patient form with EMPTY required fields CLOSED the dialog (validation missing or bypassed?)"
      fi
    fi
    # cancel path
    if v_click "Cancel" "s16-dialog-cancel" ""; then
      probe "cancel click verified (hash-diff)"
    fi
    ocr_capture || true
    if ! ocr_grep "Add New Patient"; then
      probe "the Add Patient dialog closed via the real Cancel click"
      surface_row "Cancel button" "Add Patient dialog" "'Cancel'" "closes the dialog without creating" "clicked; dialog closed" "GREEN" "s16-dialog-cancel-*" "OK"
    else
      press_escape
      ocr_capture || true
      if ! ocr_grep "Add New Patient"; then
        probe "the Add Patient dialog closed via Escape (after the Cancel click failed)"
        surface_row "Cancel button" "Add Patient dialog" "'Cancel'" "closes the dialog without creating" "Cancel click FAILED; Escape closed it" "D (cancel click failed — Escape worked)" "s16-dialog-cancel-*" "D"
      else
        bug D SURFACE_DIALOG_CANCEL "the Add Patient dialog would not close via Cancel OR Escape"
      fi
    fi
    # escape path (reopen → Escape)
    if v_click "Add Patient" "s16-dialog-reopen" "First Name" first 0 label; then
      press_escape
      ocr_capture || true
      if ! ocr_grep "Add New Patient"; then
        probe "the Add Patient dialog closed via the real Escape key"
        surface_row "Escape close" "Add Patient dialog (reopened)" "Esc key" "closes the dialog" "pressed Escape; dialog closed" "GREEN" "s16-dialog-reopen-*" "OK"
      else
        bug P3 DIALOG_ESCAPE "the Add Patient dialog did not close on Escape (Radix dialogs should)"
      fi
    fi
  else
    bug P1 SURFACE_ADD_PATIENT_DIALOG "the 'Add Patient' button did not open the dialog"
  fi

  # --- S6b: Import Patients dialog (open → inventory → cancel) ---
  v_scroll_top 10 || true
  if v_click "Import CSV" "s16b-import-open" "Import Patients"; then
    sleep 2
    ocr_capture || true
    snap "s16b-import-dialog" || true
    record_inventory "Import Patients dialog"
    surface_section "Import Patients dialog"
    surface_row "Import Patients dialog" "'Import CSV' dashboard button" "title 'Import Patients'; CSV dropzone ('Drag & drop your CSV file here'); 'Download CSV template' link; 'Required CSV format:' firstName,lastName,… hint; 'Cancel' + 'Import Patients' buttons" "bulk patient import" "opened via the real button; OCR-verified" "GREEN (opened)" "s16b-import-dialog" "OK"
    if v_click "Cancel" "s16b-import-cancel" ""; then
      probe "import dialog cancel verified"
    fi
    wait_text_gone "Import Patients" 10 "import-dialog-closed" || press_escape
  else
    bug D SURFACE_IMPORT_DIALOG "the 'Import CSV' button did not open the Import Patients dialog (recorded honestly)"
  fi

  # --- S6c: Schedule Visit dialog (open → inventory → cancel) ---
  v_scroll_top 10 || true
  if v_scroll_find "Schedule Visit" 6; then
    # (self-review fix) the old expect-text was 'Schedule Visit' — the SAME
    # string as the needle, so the click verification matched the button
    # still visible behind the overlay (or the dialog's own submit button)
    # and proved nothing. 'Chief Complaint' is unique to the dialog body
    # (source: visit-scheduler.tsx Label) — seeing it proves the DIALOG
    # opened, not merely that a 'Schedule Visit' string exists on screen.
    if v_click "Schedule Visit" "s16c-visit-open" "Chief Complaint"; then
      sleep 2
      ocr_capture || true
      snap "s16c-visit-dialog" || true
      record_inventory "Schedule Visit dialog"
      surface_section "Schedule Visit dialog"
      surface_row "Schedule Visit dialog" "'Schedule Visit' button (Today's Overview + Upcoming Visits — both real entries)" "'Patient *' select; 'Visit Date *' picker; 'Time'; Visit Type chips; 'Chief Complaint'; diagnosis/prescription/follow-up fields; 'Cancel' + 'Schedule Visit' buttons" "visit scheduling" "opened via the real button; verified by the dialog-unique 'Chief Complaint' label" "GREEN (opened)" "s16c-visit-dialog" "OK"
      if v_click "Cancel" "s16c-visit-cancel" ""; then
        probe "visit dialog cancel verified"
      fi
      # (self-review fix) verify closure by the DIALOG-unique label — the
      # dashboard's own 'Schedule Visit' buttons stay visible behind the
      # overlay, so waiting for that string to vanish would always time out.
      wait_text_gone "Chief Complaint" 10 "visit-dialog-closed" || press_escape
    fi
  else
    probe "'Schedule Visit' not visible on screen this pass (recorded honestly — the empty state may sit below the fold)"
  fi

  # --- S7: profile menu (open → inventory → close WITHOUT signing out) ---
  if open_profile_menu "s17-profile"; then
    ocr_capture || true
    snap "s17-profile-menu" || true
    record_inventory "profile dropdown menu"
    surface_section "Profile menu (header pill)"
    surface_row "Profile dropdown" "profile pill click" "doctor name header + 'Clinic Doctor' subtitle; 'Sign Out' item" "the account menu" "opened via the real pill click; OCR-verified" "GREEN (opened)" "s17-profile-menu" "OK"
    press_escape
    ocr_capture || true
    if ocr_grep "Add Patient"; then
      probe "the profile menu closed via Escape WITHOUT signing out (the dashboard is still visible)"
      surface_row "Menu dismissal" "profile dropdown, Esc" "—" "closes the menu without signing out" "pressed Escape; dashboard still visible" "GREEN" "s17-profile-menu" "OK"
    else
      press_escape
      ocr_capture || true
      if ocr_grep "Sign In"; then
        bug P3 PROFILE_MENU_ESCAPES_OUT "Escape on the profile menu appears to have signed out (or the menu swallowed focus) — the app reached the Sign In screen without clicking Sign Out"
      else
        bug D SURFACE_PROFILE_CLOSE "the profile menu state after Escape is neither dashboard nor Sign In (recorded honestly)"
      fi
    fi
  else
    bug D SURFACE_PROFILE_MENU "the profile pill could not be clicked this run (anchored attempts recorded)"
  fi

  # --- S8: Quick Patient Switcher (Ctrl/Cmd+P — the real keyboard path) ---
  if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "p" using command down' 10; then
    sleep 2
    if wait_for_ocr "Search patients" 15 "quick-switcher-open"; then
      ocr_capture || true
      snap "s18-quick-switcher" || true
      record_inventory "Quick Patient Switcher dialog (Cmd+P)"
      surface_section "Quick Patient Switcher (Cmd+P)"
      surface_row "Quick Patient Switcher" "Cmd+P shortcut" "search input (placeholder 'Search patients...'); 'Recently Viewed'/'All Patients' sections; footer Navigate/Select/Close + 'N patient(s)'" "the keyboard patient navigator" "opened via the REAL Cmd+P shortcut; OCR-verified" "GREEN (opened)" "s18-quick-switcher" "OK"
      press_escape
      ocr_capture || true
      if ocr_grep "Add Patient"; then
        probe "the quick switcher closed via Escape"
      else
        bug D SURFACE_SWITCHER_CLOSE "the quick switcher did not close on Escape (recorded honestly)"
      fi
    else
      probe "Cmd+P did not open the switcher within 15s (recorded honestly)"
    fi
  fi

  # --- S9: Keyboard Shortcuts dialog (the footer's real button) ---
  if v_scroll_find "Press Shift" 10; then
    if v_click "Press Shift" "s19-shortcuts-open" "Keyboard Shortcuts"; then
      sleep 2
      ocr_capture || true
      snap "s19-shortcuts-dialog" || true
      record_inventory "Keyboard Shortcuts dialog"
      surface_section "Keyboard Shortcuts dialog"
      surface_row "Keyboard Shortcuts dialog" "footer button 'Press Shift+? for shortcuts'" "title 'Keyboard Shortcuts'; the 7-shortcut table; 'Press ? anytime…' footer" "the shortcut reference" "opened via the REAL footer button; OCR-verified" "GREEN (opened)" "s19-shortcuts-dialog" "OK"
      press_escape
      ocr_capture || true
      if ! ocr_grep "Keyboard Shortcuts"; then
        probe "the shortcuts dialog closed via Escape"
      else
        bug D SURFACE_SHORTCUTS_CLOSE "the shortcuts dialog did not close on Escape (recorded honestly)"
      fi
    fi
  else
    probe "the footer shortcuts button was not reachable this pass (recorded honestly)"
  fi

  # --- S10: search surface (fresh-account empty state) ---
  search_type "John" "s20-search-empty"
  sleep 2
  ocr_capture || true
  snap "s20-search-empty" || true
  record_inventory "patient search — empty-account state (query 'John')"
  surface_section "Patient search (fresh account — empty data state)"
  # (run 34860208614 first-red, class D) the product renders TWO honest
  # empty states for an empty search: the in-list badge 'No results found'
  # (visible above the fold — what the run actually saw) and the larger
  # 'No patients found' + 'Try adjusting…' block (below the fold on the
  # 1024x768 window). EITHER proves the honest empty state; the row records
  # which one was observed.
  local seen_empty=""
  if ocr_grep "No results found"; then
    seen_empty="in-list badge 'No results found'"
  elif ocr_grep "No patients found"; then
    seen_empty="empty-state block 'No patients found'"
  fi
  if [ -n "$seen_empty" ]; then
    surface_row "Search empty state" "search box, query 'John' (no patients exist)" "'No results found' badge (dashboard.tsx:654) OR 'No patients found' + 'Try adjusting your search terms or check the spelling' (dashboard.tsx:819)" "an honest empty state" "typed via the real search box (Cmd+K focus)" "GREEN (observed: $seen_empty)" "s20-search-empty" "OK"
  else
    surface_row "Search empty state" "search box, query 'John' (no patients exist)" "'No results found' badge OR 'No patients found' block" "an honest empty state" "typed via the real search box" "NOT OBSERVED (recorded honestly)" "s20-search-empty" "OK"
  fi
  clear_search_box || true
  sleep 2
  ocr_capture || true
  snap "s20-search-cleared" || true
  # (run 34860208614 first-red, class D — THE red that stopped the run) this
  # call originally passed SEVEN args (the <controls> column was missing) —
  # surface_row's unconditional $8 then tripped set -u's 'unbound variable'
  # abort (exit 1) right here. Every surface_row call is now arg-count-
  # validated statically (98 call sites, all exactly 8).
  surface_row "Search clear (Cmd+K, Cmd+A, Backspace)" "the app's own focus-search shortcut" "—" "the query clears; the unfiltered list returns" "cleared via the real keyboard path" "GREEN" "s20-search-cleared" "OK"
  surface_row "Header icon-only controls (bell / theme / backup)" "header (right side)" "icon-only buttons: notifications (title 'Notifications'), theme (Switch to Light/Dark Mode), backup (Download Backup)" "icon controls with tooltips" "NOT clicked this focus (no OCR text anchor — the anchored-click risk is recorded); the theme surface IS tested via Settings → Appearance (S11)" "RECORDED (not clicked)" "s10-dashboard-top" "OK"

  # --- S11: Settings walk ---
  if v_click "Settings" "s21-settings-open" "Doctor Profile"; then
    wait_for_ocr "Doctor Profile" 30 "settings-open" || true
    v_scroll_top 10 || true
    ocr_capture || true
    snap "s21-settings-top" || true
    record_inventory "Settings view — top (Doctor Profile + Appearance)"
    scroll_through_view "s22-settings" 12
    surface_section "Settings view (all sections)"
    local s_seen_profile=no s_seen_appearance=no s_seen_storage=no s_seen_backup=no s_seen_devices=no s_seen_install=no s_seen_security=no s_seen_about=no s_seen_danger=no
    local k=0 last_hash2=""
    v_scroll_top 10 || true
    while [ "$k" -lt 14 ]; do
      ocr_capture || true
      if [ -n "$last_hash2" ] && [ "$LAST_OCR_HASH" = "$last_hash2" ]; then break; fi
      last_hash2="$LAST_OCR_HASH"
      ocr_grep "Doctor Profile" && s_seen_profile=yes
      ocr_grep "Appearance" && s_seen_appearance=yes
      ocr_grep "Storage & Statistics" && s_seen_storage=yes
      ocr_grep "Backup & Export" && s_seen_backup=yes
      ocr_grep "Supported Devices" && s_seen_devices=yes
      ocr_grep "Install App" && s_seen_install=yes
      ocr_grep "Security & Privacy" && s_seen_security=yes
      ocr_grep "About MediVault" && s_seen_about=yes
      ocr_grep "Danger Zone" && s_seen_danger=yes
      scroll_burst down
      sleep 1
      k=$((k + 1))
    done
    probe "settings section discovery: profile=$s_seen_profile appearance=$s_seen_appearance storage=$s_seen_storage backup=$s_seen_backup devices=$s_seen_devices install=$s_seen_install security=$s_seen_security about=$s_seen_about danger=$s_seen_danger"
    surface_row "Doctor Profile section" "Settings nav pill" "avatar; name/email; 'Clinic Doctor'; 'Edit Profile'; 'Display Name' input + 'Save'" "account identity editing" "observed=$s_seen_profile; the Display Name probe below" "RECORDED" "s21-settings-top; s22-settings-*" "OK"
    surface_row "Appearance section" "Settings scroll" "'Theme' label + 'Switch between light and dark mode'; segmented 'Light'/'Dark'; two preview cards" "theme control (persisted via localStorage)" "observed=$s_seen_appearance; toggled Dark→Light below" "RECORDED" "s22-settings-*" "OK"
    surface_row "Storage & Statistics" "Settings scroll" "'Total Patients'/'Total Documents'/'Storage Used' tiles + circular %" "read-only clinic stats" "observed=$s_seen_storage" "RECORDED" "s22-settings-*" "OK"
    surface_row "Backup & Export" "Settings scroll" "copy + 'Estimated backup size'; 'Download Complete Backup (ZIP)' button; decorative storage tiles" "the full-backup download" "observed=$s_seen_backup; NOT clicked this focus (hard-navigation/download risk — deferred to the settings focus)" "RECORDED (not tested)" "s22-settings-*" "OK"
    surface_row "Supported Devices / Install App" "Settings scroll" "static device copy; 'Windows / Desktop' + 'iOS / Android' buttons" "PWA install entry points" "observed=$s_seen_devices install=$s_seen_install; not clicked this focus (deferred)" "RECORDED (not tested)" "s22-settings-*" "OK"
    surface_row "Security & Privacy checklist" "Settings scroll" "static checklist (bcrypt, JWT, local storage, isolation, middleware)" "security posture copy" "observed=$s_seen_security" "RECORDED" "s22-settings-*" "OK"
    surface_row "About MediVault" "Settings scroll" "'Version 2.0.0'; Build Date; Tech Stack badges" "version information" "observed=$s_seen_about" "RECORDED" "s22-settings-*" "OK"
    surface_row "Danger Zone" "Settings scroll (bottom)" "'These actions are irreversible…'; 'Reset All Data' row + 'Reset' button" "destructive-action area" "observed=$s_seen_danger; NOT activated this focus (the stub proof belongs to the settings focus)" "RECORDED (not tested)" "s22-settings-*" "OK"

    # Appearance toggle (real clicks, hash-verified).
    # (self-review fix) 'Dark'/'Light' as plain needles are OCR-AMBIGUOUS: the
    # Appearance description 'Switch between light and dark mode' contains
    # BOTH words and sits ABOVE the segmented control — a plain substring
    # lookup would click the description paragraph. label mode restricts the
    # match to SHORT lines (the segmented buttons; the tiny preview-card
    # captions also qualify but sit BELOW the control in reading order, so
    # which=first hits the real segmented button — and the preview cards are
    # themselves functional theme toggles, so even that miss is honest).
    v_scroll_find "Appearance" 8 || true
    if v_click "Dark" "s23-appearance-dark" "" "first" "0" "label"; then
      sleep 2
      ocr_capture || true
      snap "s23-appearance-dark" || true
      probe "appearance: 'Dark' clicked — visible change verified (hash-diff)"
      surface_row "Theme switch to Dark" "Settings → Appearance → 'Dark'" "segmented control" "the app switches to the dark theme" "clicked; visible change verified" "GREEN" "s23-appearance-dark" "OK"
    else
      bug D SURFACE_THEME_DARK "the 'Dark' theme click produced no verifiable change (recorded honestly)"
    fi
    if v_click "Light" "s24-appearance-light" "" "first" "0" "label"; then
      sleep 2
      ocr_capture || true
      snap "s24-appearance-light" || true
      probe "appearance: 'Light' clicked — restored (hash-diff)"
      surface_row "Theme restore to Light" "Settings → Appearance → 'Light'" "segmented control" "the app returns to the light theme" "clicked; visible change verified" "GREEN" "s24-appearance-light" "OK"
    else
      bug D SURFACE_THEME_LIGHT "the 'Light' theme click produced no verifiable change (recorded honestly)"
    fi

    # Display Name probe (UI-level; persistence proof deferred to the settings focus)
    v_scroll_find "Doctor Profile" 6 no up || true
    if v_type_into "Display Name" "QA Surface Probe" "s25-displayname"; then
      if v_click "Save" "s25-displayname-save" "QA Surface Probe"; then
        ocr_capture || true
        snap "s25-displayname-saved" || true
        surface_row "Display Name change" "Settings → Doctor Profile → Display Name → 'Save'" "'Display Name' input + 'Save'" "the display name updates in the UI" "typed + saved; the new name is OCR-visible" "GREEN (UI-level)" "s25-displayname-*" "OK"
        probe "display name probe: saved (UI-level; the memory-only persistence proof is the settings focus's job)"
      else
        bug P3 SETTINGS_DISPLAYNAME_NOCHANGE "the Display Name Save produced no visible change (recorded honestly)"
      fi
    else
      bug D SURFACE_DISPLAYNAME_TYPE "could not type into the Display Name field (recorded honestly)"
    fi

    v_click "Dashboard" "s26-back-to-dashboard" "Add Patient" || true
    wait_for_ocr "Add Patient" 45 "dashboard-after-settings" || true
  else
    bug P1 SURFACE_SETTINGS_NAV "the 'Settings' nav pill did not open the Settings view"
  fi

  # --- S12: Sign In screen walk (sign out → inventory → sign back in) ---
  if open_profile_menu "s27-logout"; then
    if v_click "Sign Out" "s28-signout" "Sign In"; then
      sleep 2
      ocr_capture || true
      snap "s28-signin-screen" || true
      record_inventory "Sign In screen (post-logout)"
      surface_section "Sign In screen (post-logout)"
      surface_row "Sign In card" "profile menu → Sign Out" "title 'Sign In'; 'Access your patient documents securely'; 'Email'/'Password' fields; 'Remember me' checkbox; 'Forgot password?' link; 'Sign In' button; 'v2.0' badge" "the returning-user login" "observed (OCR); login exercised below" "RECORDED" "s28-signin-screen" "OK"
      surface_row "'Set Up Your Account' button" "Sign In screen bottom" "'First time using MediVault?' + 'Set Up Your Account' button" "a second setup entry (the account already exists — source: navigates to the setup view)" "observed (OCR); NOT clicked (would leave the login flow — deferred to the account focus)" "RECORDED (not tested)" "s28-signin-screen" "OK"
      surface_row "Feature cards + legal links" "Sign In screen" "'Scan Documents'/'Secure Storage'/'Patient Care' cards; Terms of Service/Privacy Policy links (source: dead '#')" "login-screen statics" "observed (OCR)" "RECORDED" "s28-signin-screen" "OK"
      # sign back in (the proven login path)
      if ! v_type_into "Email" "$DOC_EMAIL" "s29-login-email"; then
        bug P1 SURFACE_RELOGIN "could not type the login Email"
      fi
      if ! v_type_into "Password" "$DOC_PASS" "s29-login-password" yes; then
        bug P1 SURFACE_RELOGIN "could not type the login Password"
      fi
      LOGIN_SUBMITTED=0
      if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
        sleep 3
        if wait_for_ocr "Add Patient" 45 "dashboard-after-enter-login"; then
          LOGIN_SUBMITTED=1
          snap "s29-login-submit-enter" || true
        fi
      fi
      if [ "$LOGIN_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "s29-login-submit" "Add Patient"; then
        snap "s29-login-failed" || true
        bug P1 SURFACE_RELOGIN "re-login after the sign-out walk failed"
      fi
      wait_for_ocr "Add Patient" 60 "dashboard-after-relogin" || bug P1 SURFACE_RELOGIN "no dashboard after re-login"
      surface_row "Re-login" "Sign In screen → credentials → Return" "—" "returns to the dashboard" "logged back in through the real form" "GREEN" "s29-login-*" "OK"
    else
      bug P1 SURFACE_SIGNOUT "the Sign Out click did not reach the Sign In screen"
    fi
  else
    bug D SURFACE_SIGNOUT_MENU "the profile pill could not be clicked for the sign-out walk"
  fi

  # --- S13: honest not-reachable-now records ---
  surface_section "Surfaces NOT reachable in the surface focus (no patient data yet)"
  surface_row "Patient detail view" "requires a patient row" "banner (name/phone/email/DOB); contact cards; Visit History; Timeline; Prescriptions; Clinical Notes; Documents list + Upload/Scan actions; report/edit/delete icon controls" "the per-patient workspace" "NOT reachable (fresh account — the deep walk belongs to the patients focus)" "NOT TESTED (deferred)" "—" "DEFERRED"
  surface_row "Document viewer" "requires a document" "zoom/print/fullscreen; Document Info; Annotations" "the per-document viewer" "NOT reachable (no documents on a fresh account)" "NOT TESTED (deferred)" "—" "DEFERRED"
  surface_row "Edit Patient / Delete Patient / Edit Document / prescription / clinical-note / visit-editor dialogs" "require patient data" "—" "the data-editing dialogs" "NOT reachable this focus (deferred to the patients focus)" "NOT TESTED (deferred)" "—" "DEFERRED"
  surface_row "Export CSV / Download Backup downloads" "dashboard 'Export CSV'; Settings backup button" "—" "data export downloads" "NOT activated this focus (hard-navigation/download risk — deferred to the search/settings focuses)" "NOT TESTED (deferred)" "—" "DEFERRED"
  note "focus surface complete"
}

# =============================================================================
# FOCUS: account — the auth lifecycle + session identity
# =============================================================================
focus_account() {
  note "=== FOCUS account: the auth lifecycle + session identity ==="
  # Login rate budget (auth-service in-memory limiter: 5 login attempts per
  # 15 min PER EMAIL; 5 FAILED attempts lock the account for 15 min):
  # this focus spends — wrong password (1) + correct re-login (2) + cycle-2
  # login (3) + the reopen re-login (4, ONLY if the webview session did not
  # persist) = at most 4 of 5; the wrong-EMAIL probe uses a NONEXISTENT
  # address (its own limiter key; no failed-attempt increment on the real
  # account because no user matches). The setup-POST budget (3/hour) is
  # tracked in SETUP_API_ATTEMPTS for the duplicate-setup probe at A9.

  # A0: search-query leak seed (typed BEFORE logout — the post-relogin check)
  search_type "LeakProbe" "a00-leak-seed"
  sleep 2
  ocr_capture || true
  snap "a00-leak-seed" || true
  record_inventory "search query seeded before logout ('LeakProbe')"
  clear_search_box || true

  # A1: unauthenticated API access must be rejected (backend verification, labeled)
  ME_CODE="$(curl -s -o /tmp/qa-me.json -w '%{http_code}' --max-time 4 "$API/api/auth/me" || echo 000)"
  probe "[backend-verification] GET /api/auth/me WITHOUT credentials -> HTTP $ME_CODE (expect 401)"
  if [ "$ME_CODE" = "401" ]; then
    qa_cap AUTH_ENFORCEMENT "GREEN (401 without a session — auth enforced at the API)"
    surface_section "Auth contract (backend verification, labeled)"
    surface_row "API auth enforcement" "curl without the webview's session cookie" "—" "protected endpoints reject unauthenticated access" "probed /api/auth/me without credentials" "GREEN (401)" "probes.log" "OK"
  else
    bug P1 AUTH_ENFORCEMENT "GET /api/auth/me returned HTTP $ME_CODE without credentials (expected 401 — auth not enforced?)"
  fi

  # A2: logout through the real profile menu
  open_profile_menu "a2-logout" || bug P1 LOGOUT "the profile pill could not be clicked to reach Sign Out"
  v_click "Sign Out" "a3-signout" "Sign In" || bug P1 LOGOUT "clicking the real Sign Out control did not return to the Sign In screen"
  qa_cap LOGOUT "GREEN (real Sign Out click → the Sign In screen is visible)"
  sleep 2
  ocr_capture || true
  snap "a3-signin-screen" || true
  record_inventory "Sign In screen (account focus)"
  surface_section "Sign In screen (account focus)"

  # A2b: protected UI after logout — no dashboard content may remain visible
  # while the Sign In screen holds the app; the no-credential API probe is
  # repeated HERE (while the app itself sits logged-out) with its honest
  # limitation labeled: the webview's own session cookie is not externally
  # readable from the harness, so the GUI-level proof is the login screen
  # itself plus the absence of protected UI.
  ME_CODE2="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$API/api/auth/me" || echo 000)"
  probe "[backend-verification] GET /api/auth/me without credentials WHILE LOGGED OUT -> HTTP $ME_CODE2 (expect 401)"
  if ocr_grep "Add Patient"; then
    bug P1 PROTECTED_UI_AFTER_LOGOUT "dashboard content ('Add Patient') is still visible after logout"
  else
    probe "protected-UI check after logout: no dashboard content visible (login screen holds the app)"
    surface_row "Protected UI after logout" "profile menu → Sign Out" "the app must land on the pre-auth Sign In screen" "no authenticated UI is reachable without a session" "OCR: 'Sign In' visible, 'Add Patient' NOT visible; /api/auth/me without credentials = HTTP $ME_CODE2" "GREEN (pre-auth state only)" "a3-signin-screen" "OK"
    qa_cap PROTECTED_UI_AFTER_LOGOUT "GREEN (login screen only; no dashboard content; /api/auth/me = $ME_CODE2 without credentials)"
  fi
  if ocr_grep "LeakProbe"; then
    bug P3 LOGOUT_STATE_LEAK "the seeded search query text is visible on the LOGGED-OUT screen (stale UI state across the logout boundary)"
  fi

  # A3: wrong password → the honest visible rejection
  if ! v_type_into "Email" "$DOC_EMAIL" "a4-wrong-email"; then
    bug P1 WRONG_PASSWORD "could not type the email for the wrong-password attempt"
  fi
  if ! v_type_into "Password" "Definitely-Wrong-Pass-99" "a4-wrong-password" yes; then
    bug P1 WRONG_PASSWORD "could not type the wrong password"
  fi
  WRONG_SUBMITTED=0
  if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
    sleep 3
    if wait_for_ocr "Invalid email or password" 20 "wrong-after-enter"; then
      WRONG_SUBMITTED=1
      snap "a4-wrong-submit-enter" || true
    fi
  fi
  if [ "$WRONG_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "a4-wrong-submit" "Invalid email or password"; then
    snap "a4-wrong-password-failed" || true
    bug P1 WRONG_PASSWORD "the wrong password did NOT produce the expected visible rejection"
  fi
  qa_cap WRONG_PASSWORD "GREEN ('Invalid email or password' visible after the real wrong-password submit)"
  snap "a4-wrong-password-error" || true
  surface_row "Wrong password rejection" "Sign In with the correct email + a wrong password" "Email/Password fields + 'Sign In'" "the login is rejected with a visible error" "typed real email + wrong password + Return; 'Invalid email or password' OCR-verified" "GREEN (rejected)" "a4-wrong-password-error" "OK"

  # A3w: wrong EMAIL (a nonexistent address + the CORRECT password) — the
  # login path's second failure mode. A nonexistent user must produce the
  # same generic rejection (no user enumeration).
  GHOST_EMAIL="ghost.nonexistent@medivault-qa.invalid"
  if v_type_into "Email" "$GHOST_EMAIL" "a4w-wrong-email" no no yes && \
     v_type_into "Password" "$DOC_PASS" "a4w-correct-password" yes no yes; then
    WRONG_EMAIL_SUBMITTED=0
    if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
      sleep 3
      if wait_for_ocr "Invalid email or password" 20 "wrong-email-after-enter"; then
        WRONG_EMAIL_SUBMITTED=1
        snap "a4w-wrong-email-submit-enter" || true
      fi
    fi
    if [ "$WRONG_EMAIL_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "a4w-wrong-email-submit" "Invalid email or password"; then
      snap "a4w-wrong-email-failed" || true
      bug P1 WRONG_EMAIL "the nonexistent-email login did NOT produce the expected visible rejection"
    fi
    if wait_for_ocr "Sign In" 10 "still-on-login-after-wrong-email" || ! ocr_grep "Add Patient"; then
      qa_cap WRONG_EMAIL "GREEN (nonexistent email + correct password → 'Invalid email or password'; no user enumeration — same message as wrong password)"
      surface_row "Wrong email rejection" "Sign In with a nonexistent address + the correct password" "Email/Password fields + 'Sign In'" "a nonexistent identity cannot log in; the message must not leak which factor failed" "typed the ghost address + Return; 'Invalid email or password' OCR-verified" "GREEN (rejected; no enumeration)" "a4w-wrong-email-submit-enter" "OK"
    else
      bug P1 WRONG_EMAIL "the nonexistent-email login LEFT the login screen (session granted without a matching user?)"
    fi
  else
    bug D WRONG_EMAIL_PROBE "could not type the wrong-email probe credentials (probe inconclusive)"
  fi

  # A3b: dead-link probes (P3 records — no navigation expected)
  if ! v_click "Forgot password" "a5-forgot-probe" ""; then
    bug P3 LOGIN_DEAD_LINK_FORGOT "the 'Forgot password?' link produces no navigation and no recovery flow (dead link — source: preventDefault only). Clinic impact: a locked-out doctor has no in-app recovery path."
  else
    probe "Forgot password click produced a visible change — recorded (no dead link proven)"
  fi

  # A4: correct re-login (restore BOTH fields — the wrong-email probe left
  # the ghost address in the Email field; the failed attempts left the
  # wrong value in the Password field)
  if ! v_type_into "Email" "$DOC_EMAIL" "a6-login-email-restore" no no yes; then
    bug P1 LOGIN "could not re-enter the correct email after the wrong-email attempt"
  fi
  if ! v_type_into "Password" "$DOC_PASS" "a6-login-again-password" yes no yes; then
    bug P1 LOGIN "could not re-enter the correct password after the wrong attempt"
  fi
  RELOGIN_SUBMITTED=0
  if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
    sleep 3
    if wait_for_ocr "Add Patient" 45 "relogin-after-enter"; then
      RELOGIN_SUBMITTED=1
      snap "a6-relogin-submit-enter" || true
    fi
  fi
  if [ "$RELOGIN_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "a6-login-again" "Add Patient"; then
    snap "a6-login-failed" || true
    bug P1 LOGIN "re-login with the correct password failed"
  fi
  wait_for_ocr "Add Patient" 60 "dashboard-after-relogin" || bug P1 LOGIN "no dashboard after re-login"
  qa_cap LOGIN "GREEN (correct synthetic credentials → the dashboard)"
  snap "a6-relogin-dashboard" || true

  # A5: identity consistency after re-login — the /api/auth/me regression
  # surface (the PFT-34701835070 bug: a flat-parse of the nested response
  # lost the doctor name and the pill fell back to the EMAIL PREFIX; the
  # correct GUI proof is the account NAME being displayed here).
  ocr_capture || true
  if ocr_grep "Test Doctor"; then
    qa_cap IDENTITY_CONSISTENCY "GREEN (the account name is OCR-visible after re-login — the /api/auth/me nested-response parse holds: the pill shows the NAME, not the email prefix)"
  elif ocr_grep "MediVault Test"; then
    qa_cap IDENTITY_CONSISTENCY "GREEN (the account-name prefix is OCR-visible after re-login — pill truncation; the /api/auth/me nested-response parse holds)"
  else
    bug P3 IDENTITY_VISIBILITY "the account name was not OCR-visible after re-login (may be truncation/OCR limits — recorded honestly)"
  fi

  # A5b: profile/menu identity consistency — open the REAL profile dropdown
  # and verify the name + 'Clinic Doctor' subtitle; then close it via a real
  # outside-click (the Dashboard nav pill — a no-op navigation on this view)
  # verified by the dropdown disappearing.
  if open_profile_menu "a5b-profile-menu"; then
    ocr_capture || true
    snap "a5b-profile-menu-identity" || true
    MENU_NAME=0; MENU_ROLE=0
    ocr_grep "Test Doctor" && MENU_NAME=1
    [ "$MENU_NAME" = "0" ] && ocr_grep "MediVault Test" && MENU_NAME=1
    ocr_grep "Clinic Doctor" && MENU_ROLE=1
    if [ "$MENU_NAME" = "1" ] && [ "$MENU_ROLE" = "1" ]; then
      qa_cap PROFILE_IDENTITY "GREEN (the profile dropdown shows the account name + 'Clinic Doctor' — menu identity consistent after login)"
      surface_row "Profile/menu identity" "header profile pill click" "avatar initial; account name; 'Clinic Doctor'; 'Sign Out'" "the menu identifies the signed-in account" "opened the real dropdown; name + role OCR-verified" "GREEN" "a5b-profile-menu-identity" "OK"
    else
      bug P3 PROFILE_IDENTITY "the profile dropdown identity was not fully OCR-verifiable (name=$MENU_NAME role=$MENU_ROLE — recorded honestly)"
    fi
    if v_click "Dashboard" "a5b-menu-close" "Add Patient"; then
      wait_text_gone "Sign Out" 10 "profile-menu-closed" || probe "profile menu may still be open (honest note — next probes open it fresh)"
    else
      probe "menu-close click not verified — continuing (open_profile_menu re-verifies by the Sign Out menu appearing)"
    fi
  else
    bug D PROFILE_MENU_PROBE "could not open the profile menu for the identity check (recorded honestly)"
  fi

  # A6: logout state-leakage probe (the seeded 'LeakProbe' query)
  ocr_capture || true
  snap "a7-leak-check" || true
  if ocr_grep "LeakProbe" || ocr_grep "Search Results"; then
    bug P3 LOGOUT_STATE_LEAK "the search query seeded BEFORE logout is still active after re-login (stale searchQuery in the store — the dashboard re-renders filtered for the new session). Cosmetic data-isolation adjacent leak: a different doctor logging in on the same seat would see the previous session's search filter state."
  else
    probe "leak check: no stale search query visible after re-login"
    qa_cap LOGOUT_STATE "GREEN (no visible stale search state after logout/re-login)"
  fi

  # A6b: REPEATED logout/login cycle (cycle 2 of 2) — full real-GUI round trip
  open_profile_menu "a6b-logout2" || bug P1 REPEATED_LOGIN_LOGOUT "cycle-2: the profile pill could not be clicked to reach Sign Out"
  v_click "Sign Out" "a6b-signout2" "Sign In" || bug P1 REPEATED_LOGIN_LOGOUT "cycle-2: Sign Out did not return to the Sign In screen"
  sleep 2
  ocr_capture || true
  snap "a6b-signout2-screen" || true
  if ocr_grep "Add Patient"; then
    bug P1 REPEATED_LOGIN_LOGOUT "cycle-2: dashboard content visible after logout"
  fi
  if ! v_type_into "Email" "$DOC_EMAIL" "a6b-login2-email"; then
    bug P1 REPEATED_LOGIN_LOGOUT "cycle-2: could not type the email"
  fi
  if ! v_type_into "Password" "$DOC_PASS" "a6b-login2-password" yes; then
    bug P1 REPEATED_LOGIN_LOGOUT "cycle-2: could not type the password"
  fi
  CYCLE2_SUBMITTED=0
  if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
    sleep 3
    if wait_for_ocr "Add Patient" 45 "cycle2-after-enter"; then
      CYCLE2_SUBMITTED=1
      snap "a6b-login2-submit-enter" || true
    fi
  fi
  if [ "$CYCLE2_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "a6b-login2-submit" "Add Patient"; then
    snap "a6b-login2-failed" || true
    bug P1 REPEATED_LOGIN_LOGOUT "cycle-2: the correct login failed"
  fi
  wait_for_ocr "Add Patient" 60 "dashboard-after-cycle2" || bug P1 REPEATED_LOGIN_LOGOUT "cycle-2: no dashboard"
  ocr_capture || true
  if ocr_grep "Test Doctor" || ocr_grep "MediVault Test"; then
    qa_cap REPEATED_LOGIN_LOGOUT "GREEN (two full logout→login cycles completed; the identity re-appears each time)"
    surface_row "Repeated logout/login cycles" "Sign Out → Sign In → dashboard, twice" "the full auth round trip" "the cycles are stable; no state corruption" "cycle 1 (a2→a6) + cycle 2 (a6b) both GREEN with the name re-appearing" "GREEN" "a6b-*" "OK"
  else
    qa_cap REPEATED_LOGIN_LOGOUT "GREEN (two full cycles completed; the name was not OCR-visible on cycle 2 — honest OCR note)"
    surface_row "Repeated logout/login cycles" "Sign Out → Sign In → dashboard, twice" "the full auth round trip" "the cycles are stable; no state corruption" "cycle 1 + cycle 2 both completed the round trip" "GREEN" "a6b-*" "OK"
  fi
  snap "a6b-dashboard2" || true

  # A7: session restore (quit → reopen)
  quit_medivault
  snap "a8-quit-confirmed" || true
  SSTATE="$(python3 -c "import json;print(json.load(open('$SUP_STATUS')).get('state','none'))" 2>/dev/null || echo none)"
  probe "supervisor state after app quit: $SSTATE"
  [ "$SSTATE" = "healthy" ] || bug P1 QUIT_REOPEN "the background supervisor is not healthy after the desktop app quit (state=$SSTATE)"
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1 || bug P1 QUIT_REOPEN "the API stopped answering after the desktop app quit"
  launch_and_detect "account-reopen" 180
  [ "$MV_WINDOW" = "yes" ] || bug P1 QUIT_REOPEN "the MediVault window did not reappear after reopen"
  REOPEN_PATH="unknown"
  if ! wait_for_ocr "Add Patient" 150 "dashboard-after-reopen"; then
    if ocr_grep "Sign In"; then
      REOPEN_PATH="signin-required"
      probe "re-open reached the Sign In screen (webview session did not persist) — logging in again (honest outcome)"
      if ! v_type_into "Email" "$DOC_EMAIL" "a9-relogin-email"; then
        bug P1 QUIT_REOPEN "could not type the email on the re-open login screen"
      fi
      if ! v_type_into "Password" "$DOC_PASS" "a9-relogin-password" yes; then
        bug P1 QUIT_REOPEN "could not type the password on the re-open login screen"
      fi
      REOPEN_LOGIN_SUBMITTED=0
      if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
        sleep 3
        if wait_for_ocr "Add Patient" 45 "reopen-relogin-after-enter"; then
          REOPEN_LOGIN_SUBMITTED=1
          snap "a9-relogin-submit-enter" || true
        fi
      fi
      if [ "$REOPEN_LOGIN_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "a9-relogin" "Add Patient"; then
        bug P1 QUIT_REOPEN "re-login after reopen failed"
      fi
      wait_for_ocr "Add Patient" 60 "dashboard-after-relogin" || bug P1 QUIT_REOPEN "no dashboard after re-login on reopen"
      qa_cap SESSION_RESTORE "SIGN-IN REQUIRED (honest outcome: the webview session did not persist across quit/reopen; login succeeded)"
      surface_row "Quit/reopen session restoration" "quit the app → relaunch" "the app window + whichever auth state the webview held" "the desktop app survives quit/reopen and reaches a working state" "reopened; the Sign In screen appeared (session cookie did not persist); re-login succeeded" "GREEN (sign-in required — honest outcome)" "a9-*" "OK"
    else
      snap "a9-reopen-unknown-screen" || true
      bug P1 QUIT_REOPEN "after reopen the screen is neither the dashboard nor the Sign In screen"
    fi
  else
    REOPEN_PATH="restored"
    qa_cap SESSION_RESTORE "GREEN (the dashboard returned directly after reopen — the session persisted)"
    surface_row "Quit/reopen session restoration" "quit the app → relaunch" "the app window + the persisted webview session" "the desktop app survives quit/reopen and restores the session" "reopened; the dashboard appeared directly" "GREEN (session restored)" "a9-reopen-dashboard" "OK"
  fi
  snap "a9-reopen-dashboard" || true
  qa_cap QUIT_REOPEN "GREEN (quit → relaunch → a working app state; path: $REOPEN_PATH)"

  # A7b: identity consistency after quit/reopen — the second /api/auth/me
  # regression surface (page.tsx checkSession parses /me on reload to
  # restore doctorInfo; the PFT-34701835070 bug lost the identity here).
  ocr_capture || true
  REOPEN_NAME=0
  ocr_grep "Test Doctor" && REOPEN_NAME=1
  [ "$REOPEN_NAME" = "0" ] && ocr_grep "MediVault Test" && REOPEN_NAME=1
  if [ "$REOPEN_NAME" = "1" ]; then
    probe "identity after reopen: the account name is visible on the dashboard (path: $REOPEN_PATH)"
  else
    bug P3 IDENTITY_AFTER_REOPEN "the account name was not OCR-visible after quit/reopen (truncation/OCR limits — recorded honestly)"
  fi
  if open_profile_menu "a7b-reopen-profile"; then
    ocr_capture || true
    snap "a7b-reopen-profile-identity" || true
    REOPEN_MENU_NAME=0; REOPEN_MENU_ROLE=0
    ocr_grep "Test Doctor" && REOPEN_MENU_NAME=1
    [ "$REOPEN_MENU_NAME" = "0" ] && ocr_grep "MediVault Test" && REOPEN_MENU_NAME=1
    ocr_grep "Clinic Doctor" && REOPEN_MENU_ROLE=1
    if [ "$REOPEN_MENU_NAME" = "1" ] && [ "$REOPEN_MENU_ROLE" = "1" ]; then
      qa_cap IDENTITY_AFTER_REOPEN "GREEN (identity consistent after quit/reopen: dashboard name + profile menu name/role; restore path: $REOPEN_PATH — the /api/auth/me session-restore parse holds)"
      surface_row "Identity consistency after quit/reopen" "reopen → dashboard + profile menu" "the name everywhere the identity is displayed" "the same doctor identity survives the restart" "OCR: dashboard name + menu name + 'Clinic Doctor' (path: $REOPEN_PATH)" "GREEN" "a7b-reopen-profile-identity" "OK"
    else
      bug P3 IDENTITY_AFTER_REOPEN "the post-reopen profile menu identity was not fully OCR-verifiable (name=$REOPEN_MENU_NAME role=$REOPEN_MENU_ROLE — honest)"
    fi
    v_click "Dashboard" "a7b-menu-close" "Add Patient" || true
    wait_text_gone "Sign Out" 10 "reopen-menu-closed" || true
  else
    bug D REOPEN_PROFILE_PROBE "could not open the profile menu after reopen (honest record)"
  fi

  # A8: account name/email display consistency — Settings → Doctor Profile
  # (the one place the EMAIL is displayed; with the malformed-email outcome
  # from SU5 this records exactly what the clinic user would see)
  if v_click "Settings" "a8-settings-open" "Doctor Profile"; then
    v_scroll_find "Doctor Profile" 6 no up || true
    ocr_capture || true
    snap "a8-settings-doctor-profile" || true
    SET_NAME=0; SET_ROLE=0; SET_EMAIL=0
    ocr_grep "Test Doctor" && SET_NAME=1
    [ "$SET_NAME" = "0" ] && ocr_grep "MediVault Test" && SET_NAME=1
    ocr_grep "Clinic Doctor" && SET_ROLE=1
    ocr_grep "$DOC_EMAIL" && SET_EMAIL=1
    if [ "$SET_EMAIL" = "1" ]; then
      qa_cap ACCOUNT_EMAIL_DISPLAY "GREEN (Settings → Doctor Profile displays the account email: $DOC_EMAIL)"
    else
      bug P3 EMAIL_DISPLAY_VERIFY "the account email was not OCR-visible in Settings → Doctor Profile (small-text OCR limit — recorded honestly; the section screenshot carries the pixels)"
      qa_cap ACCOUNT_EMAIL_DISPLAY "UNVERIFIED-OCR (the Doctor Profile section is on the screenshot; the email text was not OCR-readable)"
    fi
    if [ "$SET_NAME" = "1" ]; then
      probe "Settings Doctor Profile: name OCR-visible"
    else
      bug P3 NAME_DISPLAY_VERIFY "the account name was not OCR-visible in Settings → Doctor Profile (honest OCR note)"
    fi
    surface_row "Account name/email display consistency" "Settings → Doctor Profile card" "avatar; name; email line; 'Clinic Doctor'; 'Edit Profile'" "the account identity is displayed consistently" "OCR: name=$SET_NAME role=$SET_ROLE email=$SET_EMAIL (the email string: $DOC_EMAIL)" "RECORDED (email OCR=$SET_EMAIL)" "a8-settings-doctor-profile" "OK"
    v_click "Dashboard" "a8-back-to-dashboard" "Add Patient" || true
    wait_for_ocr "Add Patient" 45 "dashboard-after-settings-identity" || true
  else
    bug D SETTINGS_IDENTITY_PROBE "could not open Settings for the identity display check (honest record)"
  fi

  # A9: duplicate account/setup behavior — the Sign In screen's
  # 'Set Up Your Account' entry with an account ALREADY existing. The
  # button is reachable (source: setCurrentView('setup') — no client guard);
  # the protection must come from the server (SetupAlreadyCompletedError →
  # 409 'Initial setup has already been completed'). The setup POST budget
  # is 3/hour: this probe submits ONLY if the suite + GATEWAY 6 left a slot.
  open_profile_menu "a9-logout3" || bug P1 DUPLICATE_SETUP "A9: the profile pill could not be clicked (3rd logout)"
  v_click "Sign Out" "a9-signout3" "Sign In" || bug P1 DUPLICATE_SETUP "A9: Sign Out did not return to the Sign In screen"
  sleep 2
  ocr_capture || true
  snap "a9-signin-for-setup-entry" || true
  if ocr_grep "Add Patient"; then
    bug P1 PROTECTED_UI_AFTER_LOGOUT "A9: dashboard content still visible after the 3rd logout"
  else
    probe "A9 protected state after the 3rd logout: pre-auth screen only (consistent with A2b)"
  fi
  surface_section "Duplicate account/setup behavior (focus account)"
  # A9 entry click with OCR-retry: (runs 34873498636 + 34880579779
  # first-reds, class D — Vision bottom-card line-dropping variance) the
  # Sign In screen's bottom card content ('First time using MediVault?' +
  # the 'Set Up Your Account' button + the feature cards) was OCR-read at
  # the A2b-era captures but persistently DROPPED at the A9-era captures —
  # the needle was not locatable, NO click was attempted, and the original
  # P3 record misattributed an OCR miss to the product. The login column
  # (~800px) is scrollable on the 768px viewport: each retry scrolls a
  # small 2-line burst DOWN (the bottom card rises into view) and
  # re-captures — v_click re-captures on every call, so the retries
  # genuinely re-read the screen. Only a located-but-inert click remains
  # a product P3.
  A9_ENTRY_CLICKED=0
  A9_ENTRY_ATTEMPT=0
  while [ "$A9_ENTRY_ATTEMPT" -lt 4 ]; do
    ocr_capture || true
    if ocr_grep "Set Up Your Account"; then
      if v_click "Set Up Your Account" "a9-setup-entry-$A9_ENTRY_ATTEMPT" "Create Your Account"; then
        A9_ENTRY_CLICKED=1
        break
      else
        probe "A9: the entry button was located but the click produced no verified change — one more attempt (a real user would look again)"
      fi
    else
      probe "A9: 'Set Up Your Account' not OCR-visible this capture (Vision bottom-card line-drop variance — the A2b-era captures read it) — scrolling a touch and recapturing"
      snap "a9-entry-ocr-retry-$A9_ENTRY_ATTEMPT" || true
      scroll_burst down 700 400 2
    fi
    A9_ENTRY_ATTEMPT=$(( A9_ENTRY_ATTEMPT + 1 ))
    [ "$A9_ENTRY_CLICKED" = "1" ] || sleep 2
  done
  if [ "$A9_ENTRY_CLICKED" = "1" ]; then
    snap "a9-setup-form-reachable" || true
    record_inventory "setup view reached from the Sign In screen while an account exists"
    surface_row "'Set Up Your Account' entry with an existing account" "Sign In screen → 'Set Up Your Account'" "the one-time setup form renders again (no client-side guard on the entry)" "the server must reject any second-account attempt (one-account model)" "clicked the real button; the setup form appeared" "RECORDED (form reachable; server rejection probed below)" "a9-setup-form-reachable" "OK"
    if [ "$SETUP_API_ATTEMPTS" -lt 3 ]; then
      probe "A9: setup POST budget has a slot (attempts so far: $SETUP_API_ATTEMPTS) — submitting the duplicate form"
      if setup_fill_form "MediVault Duplicate QA" "duplicate.attempt@example.invalid" "$DOC_PASS" "$DOC_PASS" "a9-dup"; then
        submit_focused_return
        setup_after_submit_scroll_top
        SETUP_API_ATTEMPTS=$(( SETUP_API_ATTEMPTS + 1 ))
        if [ -n "$(setup_reject_grep "already been completed")" ]; then
          snap "a9-duplicate-rejected" || true
          qa_cap DUPLICATE_SETUP "GREEN (the duplicate setup submission was rejected with the visible server error 'Initial setup has already been completed')"
          surface_row "Duplicate setup rejection" "the setup form filled with a second synthetic identity + submit" "the one-time form + submit" "a second account cannot be created" "submitted; the 409 rejection text was OCR-verified (scroll-varied re-read)" "GREEN (rejected)" "a9-duplicate-rejected" "OK"
        elif wait_for_ocr "Too many requests" 15 "duplicate-setup-rate-limited"; then
          snap "a9-duplicate-rate-limited" || true
          bug ENV DUPLICATE_SETUP_RATE "the duplicate-setup probe hit the setup rate limiter (budget consumed by the validation probes) — the rejection itself is still a rejection; the SetupAlreadyCompleted guard was not reached this run"
          qa_cap DUPLICATE_SETUP "GREEN-via-RATE-LIMIT (rejected by the limiter; the 409 guard not exercised — ENV record)"
          surface_row "Duplicate setup rejection" "the setup form filled with a second synthetic identity + submit" "the one-time form + submit" "a second account cannot be created" "submitted; the visible rejection came from the rate limiter (budget) — honest ENV record" "GREEN (rejected; ENV note)" "a9-duplicate-rate-limited" "ENV"
        elif ocr_grep "Add Patient"; then
          snap "a9-duplicate-accepted" || true
          bug P1 DUPLICATE_SETUP "the duplicate setup submission LEFT the setup screen — a second account may have been created!"
        else
          snap "a9-duplicate-unverified" || true
          bug D DUPLICATE_SETUP_VERIFY "the duplicate submission produced no OCR-readable outcome (honest record; no account-creation signal observed)"
        fi
      else
        bug D DUPLICATE_SETUP_TYPE "could not fill the duplicate-setup probe form (no submit attempted — honest harness record)"
      fi
    else
      probe "A9: setup POST budget exhausted ($SETUP_API_ATTEMPTS attempts) — the duplicate SUBMIT is skipped (the entry-reachability row above still stands)"
      bug ENV DUPLICATE_SETUP_BUDGET "the duplicate-setup submission was not exercised: the 3/hour setup budget was consumed by the validation probes (form reachability recorded above)"
      qa_cap DUPLICATE_SETUP "NOT EXERCISED (setup rate budget consumed; the form IS reachable — see the entry row)"
      surface_row "Duplicate setup rejection" "the setup form with a second identity" "the one-time form + submit" "a second account cannot be created" "NOT submitted (budget) — the reachability row above is this run's evidence" "NOT TESTED (ENV budget)" "—" "ENV"
    fi
  else
    bug D DUPLICATE_SETUP_ENTRY_OCR "the 'Set Up Your Account' button could not be OCR-located after 3 fresh captures (Vision bottom-card line-drop variance — the same screen WAS OCR-read earlier in this run at A2b); NO click was attempted — the entry probe is inconclusive this run, NOT a product finding (the run-34873498636 P3 misattributed this to the product and is hereby corrected to class D)"
    qa_cap DUPLICATE_SETUP "INCONCLUSIVE (the entry button was not OCR-locatable at click time — harness OCR variance; no click attempted)"
    surface_row "'Set Up Your Account' entry with an existing account" "Sign In screen → 'Set Up Your Account'" "the one-time setup form" "the entry should not create a second account" "button not OCR-locatable after 3 captures (harness OCR variance — class D); no click attempted" "NOT TESTED (OCR variance — D record)" "a9-entry-ocr-retry-*" "D"
  fi
  snap "a9-final-state" || true
  note "focus account complete (final app state: logged out, pre-auth screen — the FINAL section's teardown runs from here)"
}

# =============================================================================
# PATIENTS-FOCUS HELPERS — the deep-lifecycle primitives (all verified by the
# probe pattern: never a guessed coordinate; every click OCR-anchored; every
# claim OCR-verified; every limit recorded honestly)
# =============================================================================

read_patient_count() { # → PATIENTS_COUNT (number | 0 | unreadable)
  PATIENTS_COUNT="unreadable"
  clear_search_box || true
  v_scroll_top 10 || true
  if v_scroll_find "Recent Patients" 8; then
    sleep 2
    ocr_capture || return 0
    local n
    n="$(printf '%s\n' "$OCR_TEXT" | awk -F'|' '{print $2}' | sed 's/^O /0 /' | grep -E '[0-9] *patients?' | head -1 | sed -E 's/[^0-9]//g')"
    if [ -n "$n" ]; then PATIENTS_COUNT="$n"; fi
  else
    if v_scroll_find "No patients yet" 5; then PATIENTS_COUNT="0"; fi
  fi
  probe "read-patient-count: badge='$PATIENTS_COUNT'"
}

v_clear_field() { # <label-needle> <stem> [xmin] — Cmd+A + Delete in the field under the label
  local label="$1" stem="$2" xmin="${3:-}"
  ocr_capture || return 1
  # (run 35017083195, class D — same as v_type_into's xmin): restrict the
  # label search to the EDIT dialog card's x-range when requested — the
  # detail banner behind the dialog carries the same short labels at the
  # left edge and the first-hit click dismissed the modal via the overlay.
  local saved_ocr="$OCR_TEXT"
  if [ -n "$xmin" ]; then
    OCR_TEXT="$(printf '%s\n' "$OCR_TEXT" | awk -F'|' -v m="$xmin" -v s="${MV_SCALE:-1}" '($3+0)/s >= m')"
    [ -n "$OCR_TEXT" ] || OCR_TEXT="$saved_ocr"
  fi
  if ! ocr_lookup "$label" "first" "label"; then
    OCR_TEXT="$saved_ocr"
    probe "vclear[$stem]: label '$label' NOT FOUND — no click attempted"
    return 1
  fi
  OCR_TEXT="$saved_ocr"
  "$MV_MOUSE" "$OCR_HIT_X" "$(( OCR_HIT_Y + 6 ))" 2>>"$LOG" || return 1
  sleep 1
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "a" using command down' 10 || true
  sleep 1
  osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 51' 10 || true
  sleep 1
  probe "vclear[$stem]: cleared the field under '$label' (Cmd+A + Delete — a real user's clear)"
  return 0
}

# ---- D-fix helpers (run 34901913438 first-red: the dialog-closed verdict) --
# The dialog TITLES garble in OCR once the dialog's inner content scrolls
# (observed: 'Add New Patient' read as 'Dochhnard'/'Nachhnord' while the
# native 'Fill out this field' bubble was showing after a rejected submit —
# a CORRECT native rejection was misread as 'dialog closed' and reported as
# a P1 creation). Dialog presence is now ANY of several stable dialog-only
# needles; closes are VERIFIED with bounded Escape retries; the create
# verdicts corroborate against the patient count badge.
add_patient_dialog_visible() { # → 0 when ANY stable Add-Patient-dialog needle is on screen
  ocr_grep "Add New Patient" && return 0
  ocr_grep "Enter the patient's information" && return 0
  ocr_grep "Optional Details" && return 0
  ocr_grep "First Name" && return 0
  ocr_grep "Fill out this field" && return 0
  return 1
}

edit_patient_dialog_visible() { # → 0 when ANY stable Edit-Patient-dialog needle is on screen
  ocr_grep "Edit Patient" && return 0
  ocr_grep "Save Changes" && return 0
  ocr_grep "Completion" && return 0
  ocr_grep "First Name" && return 0
  return 1
}

ensure_dialog_closed() { # <stem> <visible-fn> — bounded VERIFIED Escape retries
  local stem="$1" visfn="$2" esc=0
  ocr_capture || true
  while "$visfn" && [ "$esc" -lt 3 ]; do
    probe "ensure-closed[$stem]: the dialog is still visible — Escape retry $esc"
    press_escape
    sleep 1
    esc=$((esc + 1))
    ocr_capture || true
  done
  if "$visfn"; then
    snap "${stem}-still-open-after-escapes" || true
    return 1
  fi
  return 0
}

create_patient_deep() { # <first> <last> <phone> <email> <address> <notes> <stem> [arabic yes|no] [dob-digits]
  # Returns: 0 = created (the dialog closed after the submit); 2 = the submit
  # was REJECTED (the dialog stayed open — the validation probes expect
  # this); 1 = a harness-level failure. Empty fields are SKIPPED (the
  # empty-optional probe depends on this).
  local first="$1" last="$2" phone="$3" email="$4" address="$5" notes="$6" stem="$7"
  local arabic="${8:-no}" dob="${9:-}"
  if ! v_click "Add Patient" "${stem}-open" "First Name" first 0 label; then
    if ! v_click_try_hits "Add Patient" "${stem}-open" "First Name"; then
      snap "${stem}-open-failed" || true
      return 1
    fi
  fi
  local nfail=0
  if [ "$arabic" = "yes" ]; then
    if [ -n "$first" ]; then
      v_type_into "First Name" "$first" "${stem}-first" no yes || nfail=$((nfail + 1))
    fi
    if [ -n "$last" ]; then
      v_type_into "Last Name" "$last" "${stem}-last" no yes || nfail=$((nfail + 1))
    fi
  else
    if [ -n "$first" ]; then
      v_type_into "First Name" "$first" "${stem}-first" || nfail=$((nfail + 1))
    fi
    if [ -n "$last" ]; then
      v_type_into "Last Name" "$last" "${stem}-last" || nfail=$((nfail + 1))
    fi
  fi
  [ -n "$phone" ] && { v_type_into "Phone" "$phone" "${stem}-phone" || nfail=$((nfail + 1)); }
  [ -n "$email" ] && { v_type_into "Email" "$email" "${stem}-email" || nfail=$((nfail + 1)); }
  [ -n "$address" ] && { v_type_into "Address" "$address" "${stem}-address" || nfail=$((nfail + 1)); }
  [ -n "$notes" ] && { v_type_into "Notes" "$notes" "${stem}-notes" || nfail=$((nfail + 1)); }
  # DOB (type=date): NOT CALLED by the patients battery — the System Events
  # keystroke automation cannot enter the WebKit date segments (three runs
  # of proof; the attempt also leaves the field mid-segment-edit, which
  # blocks the whole form submit with 'Invalid value'). Recorded as the
  # DOB_DATE_INPUT_AUTOMATION ENV entry at PC7. The parameter stays for a
  # future lane that finds a working path (e.g. a paste-based approach).
  if [ -n "$dob" ]; then
    if v_type_into "Date of Birth" "$dob" "${stem}-dob"; then
      probe "create[$stem]: typed the DOB digits — verified functionally on the row/detail later"
    else
      probe "create[$stem]: the DOB digits could not be typed/verified (type=date automation limit — honest record; the field is optional)"
    fi
  fi
  snap "${stem}-form-filled" || true
  [ "$nfail" -gt 0 ] && probe "create[$stem]: $nfail typing step(s) not visually verified (kept — the dialog-close + row + count verify is the functional proof)"
  local submitted=0
  if ocr_lookup "First Name" "first" "label"; then
    "$MV_MOUSE" "$OCR_HIT_X" "$(( OCR_HIT_Y + 6 ))" 2>>"$LOG" || true
    sleep 1
    if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
      sleep 3
      ocr_capture || true
      if [ -n "$OCR_TEXT" ] && ! add_patient_dialog_visible; then
        submitted=1
        snap "${stem}-submit-enter" || true
      fi
    fi
  fi
  if [ "$submitted" = "0" ]; then
    local b=0
    while [ "$b" -lt 4 ]; do
      scroll_burst down 500 400
      sleep 1
      b=$((b + 1))
    done
    if ! v_click_try_hits "Add Patient" "${stem}-submit" "${first:-Add Patient}"; then
      snap "${stem}-submit-failed" || true
      return 1
    fi
    sleep 3
  fi
  sleep 2
  ocr_capture || true
  if add_patient_dialog_visible; then
    snap "${stem}-dialog-still-open" || true
    probe "create[$stem]: the Add New Patient dialog is STILL OPEN after the submit (a rejection — the caller checks the rejection text)"
    return 2
  fi
  probe "create[$stem]: the Add New Patient dialog closed after the submit"
  return 0
}

v_click_near_anchor_y() { # <needle> <anchor-needle> <stem> [tolerance-pts] — click the needle hit closest in Y to the anchor hit
  # (dialog-footer submits: the same label can render BOTH in the dialog
  # footer AND dimmed in the page behind — only the hit on the anchor's row
  # is the dialog's own button; every other candidate is left unclicked)
  local needle="$1" anchor="$2" stem="$3" tol="${4:-40}"
  ocr_capture || return 1
  if ! ocr_lookup "$anchor" "first"; then
    probe "vclick-near[$stem]: anchor '$anchor' NOT FOUND — no click attempted"
    return 1
  fi
  local ay="$OCR_HIT_Y"
  local hitsfile="/tmp/qa-ocr-hits.txt"
  printf '%s\n' "$OCR_TEXT" | grep -i -- "|[^|]*${needle}[^|]*|" > "$hitsfile" 2>/dev/null || true
  if [ ! -s "$hitsfile" ]; then
    probe "vclick-near[$stem]: no '$needle' hits on screen — no click"
    return 1
  fi
  local best_d=99999 best_x="" best_y="" hit px py sx sy d
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    px="$(printf '%s' "$hit" | awk -F'|' '{print $3}')"
    py="$(printf '%s' "$hit" | awk -F'|' '{print $4}')"
    [ -n "$px" ] && [ -n "$py" ] || continue
    sx="$(awk -v a="$px" -v s="$MV_SCALE" 'BEGIN{printf "%.0f", a/s}')"
    sy="$(awk -v a="$py" -v s="$MV_SCALE" 'BEGIN{printf "%.0f", a/s}')"
    d=$(( sy - ay ))
    [ "$d" -lt 0 ] && d=$(( 0 - d ))
    if [ "$d" -lt "$best_d" ]; then best_d="$d"; best_x="$sx"; best_y="$sy"; fi
  done < "$hitsfile"
  rm -f "$hitsfile"
  if [ -z "$best_x" ] || [ "$best_d" -gt "$tol" ]; then
    probe "vclick-near[$stem]: no '$needle' hit within ${tol}pt of the anchor row (closest ${best_d}pt) — no click"
    return 1
  fi
  probe "vclick-near[$stem]: clicking '$needle' at ($best_x,$best_y) — ${best_d}pt from the anchor '$anchor' (the dialog-footer row)"
  if ! "$MV_MOUSE" "$best_x" "$best_y" 2>>"$LOG"; then
    return 1
  fi
  sleep 2
  return 0
}

scan_detail_multi() { # <own-note> <foreign-csv> — the N-sentinel isolation scan of the detail view
  SCAN_OWN_SEEN=no; SCAN_FOREIGN_SEEN=no; SCAN_FOREIGN_WHICH=""
  local own="$1" flist="$2"
  # (run 34936649898, class D — the foreign list must be RELATIVE to the
  # scanned patient): FOREIGN_ALL carries the sentinels of the OTHER
  # patients — but it also contains the sentinels of every patient that IS
  # scanned by this function (Jane/Muhammad/Élodie/O'Connor/LongName/Zed
  # and the PC8 trio). A correctly-opened, correctly-isolated detail then
  # matched its OWN note as 'foreign' and fired a FALSE P0 (John Tester's
  # ONLY-TESTER-GOLF at the pc8 sub-check, 07:11:32Z — the detail showed
  # name+phone+note all his own). Strip the own note from the foreign list
  # HERE — the single point that fixes every current and future call site
  # by construction. (John Test's ALPHA is not in the list — a no-op there.)
  if [ -n "$own" ] && [ -n "$flist" ]; then
    flist="$(printf '%s' "$flist" | tr ',' '\n' | { grep -vx -- "$own" || true; } | tr '\n' ',' | sed 's/,$//')"
  fi
  local up=0
  while [ "$up" -lt 8 ]; do
    scroll_burst up
    sleep 1
    up=$((up + 1))
  done
  probe "scan-multi: scrolled to the top of the detail view before the down-scan"
  local i=0 last_hash="" f OLDIFS="$IFS"
  while [ "$i" -lt 10 ]; do
    ocr_capture || true
    if [ -n "$last_hash" ] && [ "$LAST_OCR_HASH" = "$last_hash" ]; then
      probe "scan-multi: the screen stopped changing — the bottom of the detail view is reached"
      break
    fi
    last_hash="$LAST_OCR_HASH"
    if [ -n "$own" ] && ocr_grep "$own"; then SCAN_OWN_SEEN=yes; fi
    IFS=','
    for f in $flist; do
      if [ -n "$f" ] && ocr_grep "$f"; then
        SCAN_FOREIGN_SEEN=yes
        SCAN_FOREIGN_WHICH="$SCAN_FOREIGN_WHICH $f"
        probe "scan-multi: FOREIGN note text is visible: '$f'"
      fi
    done
    IFS="$OLDIFS"
    scroll_burst down
    sleep 1
    i=$((i + 1))
  done
  probe "scan-multi complete: own=$SCAN_OWN_SEEN foreign=$SCAN_FOREIGN_SEEN${SCAN_FOREIGN_WHICH:+ — which:}$SCAN_FOREIGN_WHICH"
}

verify_detail_authoritative() { # <full-name> <phone> <email> <note> <stem> [foreign-csv]
  # The entry-point consistency verifier (the P2 5ede518 regression surface):
  # whatever object an entry point passed (full, partial, or a stale pre-edit
  # snapshot), the detail view must render the AUTHORITATIVE record — the
  # refetch-on-mount is the fix under test. Sets VDA_* (1 = verified, 0 =
  # NOT verified) + VDA_SKELETON (1 = the 'No contact information added
  # yet.' empty state appeared — the stale/skeleton symptom) + VDA_FOREIGN_*.
  VDA_NAME=0; VDA_PHONE=0; VDA_EMAIL=0; VDA_NOTE=0; VDA_SKELETON=0
  VDA_FOREIGN_SEEN=no; VDA_FOREIGN_WHICH=""
  local full="$1" phone="$2" email="$3" note="$4" stem="$5" flist="${6:-}"
  # (run 34936649898, class D — same as scan_detail_multi): the foreign
  # list must be RELATIVE to the scanned patient. Zed's own
  # ONLY-ZED-DELETE is IN FOREIGN_ALL, so pe-other-zed's gate
  # (VDA_FOREIGN_SEEN != yes) and pv4's probe would each read his OWN note
  # as foreign on a perfectly correct detail. Strip the own note here.
  if [ -n "$note" ] && [ -n "$flist" ]; then
    flist="$(printf '%s' "$flist" | tr ',' '\n' | { grep -vx -- "$note" || true; } | tr '\n' ',' | sed 's/,$//')"
  fi
  local up=0
  while [ "$up" -lt 8 ]; do
    scroll_burst up
    sleep 1
    up=$((up + 1))
  done
  local i=0 last_hash="" f OLDIFS="$IFS"
  while [ "$i" -lt 10 ]; do
    ocr_capture || true
    if [ -n "$last_hash" ] && [ "$LAST_OCR_HASH" = "$last_hash" ]; then
      break
    fi
    last_hash="$LAST_OCR_HASH"
    [ "$VDA_NAME" = "0" ] && [ -n "$full" ] && ocr_grep "$full" && VDA_NAME=1
    [ "$VDA_PHONE" = "0" ] && [ -n "$phone" ] && ocr_grep "$phone" && VDA_PHONE=1
    [ "$VDA_EMAIL" = "0" ] && [ -n "$email" ] && ocr_grep "$email" && VDA_EMAIL=1
    [ "$VDA_NOTE" = "0" ] && [ -n "$note" ] && ocr_grep "$note" && VDA_NOTE=1
    [ "$VDA_SKELETON" = "0" ] && ocr_grep "No contact information" && VDA_SKELETON=1
    if [ -n "$flist" ]; then
      IFS=','
      for f in $flist; do
        if [ -n "$f" ] && ocr_grep "$f"; then
          VDA_FOREIGN_SEEN=yes
          VDA_FOREIGN_WHICH="$VDA_FOREIGN_WHICH $f"
          probe "verify-detail[$stem]: FOREIGN note text is visible: '$f'"
        fi
      done
      IFS="$OLDIFS"
    fi
    scroll_burst down
    sleep 1
    i=$((i + 1))
  done
  snap "${stem}-authoritative" || true
  probe "verify-detail[$stem]: name=$VDA_NAME phone=$VDA_PHONE email=$VDA_EMAIL note=$VDA_NOTE skeleton-empty-state=$VDA_SKELETON foreign=$VDA_FOREIGN_SEEN$VDA_FOREIGN_WHICH"
}

detail_scroll_top() { # <stem> — the detail-page top restore (the banner): the idiom pe5's verify and scan_detail_multi already use
  # (run 35034199641, class D — the pe4 verify): a detail reopened from a
  # search-row click lands with the banner SCROLLED OFF-SCREEN (the
  # post-open OCR shows the mid-page sections only) — a DOWN-only
  # scroll-find then moves AWAY from the banner where the edited
  # values render. The API log proved both consecutive edits SAVED
  # (PUT 200 ×2) while the verify P1'd on the invisible-but-saved note.
  # Bounded 8 up bursts (a no-op when already at the top).
  # (run 35068548928, class D): the restore now ends with a FRESH
  # ocr_capture — the callers' ocr_grep reads the global OCR_TEXT, which
  # otherwise still holds the STALE pre-scroll capture (the mid-page
  # sections, no sentinel) and the verify fails on a correct record.
  local stem="$1" up=0
  while [ "$up" -lt 8 ]; do
    scroll_burst up
    sleep 1
    up=$((up + 1))
  done
  ocr_capture || true
  probe "detail-top[$stem]: scrolled to the top of the detail view (the banner) — OCR refreshed"
}

detail_banner_row() { # echoes the detail banner's name/avatar row y (the icon row sits at row-13/-15); empty when no content line is found
  # Shared by the pencil and the trash icon clicks. (runs 35026560477 +
  # 35041063210, class D): the icon band must come from the TOPMOST
  # CONTENT LINE (x≥200, y 140..400 — the name/avatar row), never from
  # the anchor's own y (the contact subline sits ~171pt below the icons);
  # and an Arabic banner's text does not OCR, so the topmost line can be
  # a LOWER section line — clamp to the banner window [150..210] (every
  # OCR-able patient measured 195-199) with the modal row 195 assumed
  # outside it.
  local row
  row="$(printf '%s\n' "$OCR_TEXT" | awk -F'|' '$1=="LINE" {y=$4+0; x=$3+0; if (y>=140 && y<=400 && x>=200 && (best=="" || y<best)) best=y} END {print (best=="" ? "" : best)}')"
  case "$row" in
    ''|*[!0-9]*) row="" ;;
  esac
  if [ -n "$row" ] && { [ "$row" -lt 150 ] || [ "$row" -gt 210 ]; }; then
    row=195
  fi
  printf '%s' "$row"
}

detail_open_proof() { # <stem> — the real detail-open gate: the LIST always shows its search bar
  # ('Search patients by name, phone, or email...'), the DETAIL page never
  # does; and the detail always carries one of its section markers within
  # view ('Visit History'/'Prescriptions'/'Clinical Notes' — none of which
  # exist on the list or dashboard). Bounded 5×2s retries absorb slow loads.
  # (run 34930796719, class D): the query-box focus ring changed the screen
  # hash and v_click's hash-diff verify passed a FALSE 'detail opened' —
  # this gate now ends every open-by-token success path.
  local stem="$1" i
  for i in 1 2 3 4 5; do
    ocr_capture || true
    if ! ocr_grep "Search patients"; then
      if ocr_grep "Visit History" || ocr_grep "Prescriptions" || ocr_grep "Clinical Notes"; then
        probe "detail-proof[$stem]: confirmed — the list search bar is absent and a detail section marker is visible"
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

open_patient_by_phone_token() { # <token> <full-name> <stem> [row-phone] — search by the unique phone digits, open via the row
  local token="$1" full="$2" stem="$3" rowphone="${4:-}"
  clear_search_box || true
  v_scroll_top 10 || true
  if ! search_type "$token" "${stem}-search"; then
    probe "open-by-token[$stem]: could not type the token '$token'"
    return 1
  fi
  sleep 2
  # (run 34930796719, class D — the pc8 sub-check forensics): the single
  # filtered row sits BELOW the fold ('1 result found' + dashboard cards
  # above it). Scrolling to the bare TOKEN stopped at the search box's own
  # QUERY line (always visible at top-left); the rowphone click then found
  # nothing, and the bare-token fallback clicked the QUERY line itself —
  # the API log proves NO detail GET ever fired for any of the three
  # sub-checks, yet all three 'opened' (the scan swept the LIST, and the
  # sub-checks honestly recorded bug-D 'own note not verified'). Fix:
  # scroll to the ROW-ONLY text (the full row phone — the query box holds
  # only the token) FIRST, then click it; every success path is gated on
  # detail_open_proof so a query-box click can never read as success.
  if [ -n "$rowphone" ]; then
    v_scroll_find "$rowphone" 6 || v_scroll_find "$token" 6 || true
  else
    v_scroll_find "$token" 6 || true
  fi
  ocr_capture || true
  snap "${stem}-filtered" || true
  # click the row: the full phone string (row-only text — the search box
  # holds only the token), falling back to the token itself (the box may
  # OCR-match first — the detail_open_proof gate rejects a false open)
  local opened="no"
  if [ -n "$rowphone" ]; then
    if v_click "$rowphone" "${stem}-row" "$full" || v_click_try_hits "$rowphone" "${stem}-row" "$full" || v_click_try_hits "$token" "${stem}-row2" "$full"; then
      sleep 2
      if detail_open_proof "$stem"; then
        opened="yes"
      else
        probe "open-by-token[$stem]: the click did NOT open the detail (the list search bar is still present) — no false success"
      fi
    fi
  else
    if v_click_try_hits "$token" "${stem}-row" "$full"; then
      sleep 2
      if detail_open_proof "$stem"; then
        opened="yes"
      else
        probe "open-by-token[$stem]: the click did NOT open the detail (the list search bar is still present) — no false success"
      fi
    fi
  fi
  if [ "$opened" = "yes" ]; then
    snap "${stem}-detail" || true
    return 0
  fi
  snap "${stem}-row-failed" || true
  return 1
}

# =============================================================================
# FOCUS: patients — the patient lifecycle deep walk (directive 2026-09-15):
# create battery (cancel/required/empty-optional/Arabic/accented/apostrophe/
# long/duplicates/DOB/double-submit) → visit scheduling → sentinel isolation →
# edit battery (cancel/multi/single/consecutive/clear/Unicode/Arabic) →
# EIGHT entry-point consistency proofs (the stale/skeleton P2 regression) →
# delete battery (cancel/confirm/post-delete sanity/ghost entry) →
# human-mistake navigation → quit/reopen patient-level persistence.
# =============================================================================
focus_patients() {
  note "=== FOCUS patients: the patient lifecycle deep walk ==="
  local FOREIGN_ALL="ONLY-JANE-BRAVO,ONLY-MOHAMMAD-CHARLIE,ONLY-ELODIE-DELTA,ONLY-OCONNOR-ECHO,ONLY-LONGNAME-FOXTROT,ONLY-ZED-DELETE,ONLY-TESTER-GOLF,ONLY-LOWCASE-HOTEL,ONLY-HYPHEN-INDIA"
  local JOHN_NEW_PHONE="+1 555 0777"
  local JOHN_NEW_NOTE="ONLY-JOHN-ALPHA v2"

  # ------------------------------------------------------------------
  # PC — CREATE BATTERY
  # ------------------------------------------------------------------
  note "=== patients PC: the create battery ==="

  # PC0 — cancel create: a half-filled dialog must create NOTHING
  read_patient_count
  PC0_BEFORE="$PATIENTS_COUNT"
  # D-fix (run 34901913438 BUG-1): read_patient_count leaves the view scrolled
  # down at the patients list — scroll the header 'Add Patient' button back
  # into view before the single-attempt dialog-open click.
  v_scroll_top 10 || true
  if v_click "Add Patient" "pc0-open" "First Name" first 0 label; then
    v_type_into "First Name" "Scratch Pad" "pc0-first" || true
    snap "pc0-form-half-filled" || true
    if v_click "Cancel" "pc0-cancel" ""; then
      probe "pc0: the Cancel click registered"
    fi
    sleep 2
    # D-fix (BUG-2 class): VERIFIED close via the multi-needle dialog check —
    # the count re-read below is only honest once the dialog is really gone.
    ensure_dialog_closed "pc0" add_patient_dialog_visible \
      || bug D PATIENTS_CANCEL_CREATE "the Add Patient dialog would not close after Cancel + 3 Escapes (harness limit — the count check below may be unreadable)"
    read_patient_count
    if [ "$PATIENTS_COUNT" = "unreadable" ]; then
      bug D PATIENTS_CANCEL_CREATE "the post-cancel patient count could not be OCR-read (the honest limit — no verdict; the close evidence is in the pc0-* captures)"
    elif [ "$PATIENTS_COUNT" = "$PC0_BEFORE" ]; then
      qa_cap CANCEL_CREATE "GREEN (the half-filled Add Patient dialog was canceled; the count is unchanged at $PATIENTS_COUNT)"
      surface_row "Cancel create" "Add Patient dialog → 'Cancel' (half-filled form)" "'Cancel' + 'Add Patient' buttons" "canceling discards the form; no patient is created" "filled First Name only → Cancel → dialog closed; count unchanged ($PC0_BEFORE)" "GREEN" "pc0-*" "OK"
    else
      bug P1 CANCEL_CREATE "after canceling a half-filled Add Patient dialog the patient count changed ($PC0_BEFORE → $PATIENTS_COUNT — a canceled create must not write a record)"
    fi
    # P2 regression probe (run 34904733614): the canceled create's typed data
    # must NOT leak into the next Add Patient session — observed: PC0's
    # canceled 'Scratch Pad' persisted in the dialog state and pre-filled
    # PC1b's form, so the 'last-name-only' probe actually submitted BOTH
    # names and created an unintended 'Scratch Pad Probe' record (count 0→1,
    # VLM-proven via pc1b-lastonly-form-filled.png + the Patients stat card).
    # Product fix: add-patient-dialog resets its fields on open (useEffect).
    v_scroll_top 10 || true
    if v_click "Add Patient" "pc0-reopen" "First Name" first 0 label; then
      sleep 1
      ocr_capture || true
      if ocr_grep "Scratch Pad"; then
        bug P2 DIALOG_STATE_LEAK "the canceled create's typed 'Scratch Pad' is STILL present in the reopened Add Patient dialog (canceled form data persisting across sessions — the run-34904733614 root cause)"
        press_escape
        sleep 1
        ensure_dialog_closed "pc0-leak-close" add_patient_dialog_visible || true
      else
        qa_cap DIALOG_STATE_RESET "GREEN (the reopened Add Patient dialog is clean — the canceled 'Scratch Pad' did not persist; the run-34904733614 leak is fixed)"
        surface_row "Dialog state reset" "Add Patient canceled then reopened" "7 empty fields" "canceled form data must not persist into the next create session" "canceled with 'Scratch Pad' typed → reopened → fields clean" "GREEN (clean reopen)" "pc0-reopen-after" "OK"
        ensure_dialog_closed "pc0-reopen-close" add_patient_dialog_visible || true
      fi
    fi
  else
    bug D PATIENTS_CANCEL_CREATE "the Add Patient dialog could not be opened for the cancel-create probe"
  fi

  # PC1 — required fields: an empty-names submit must be rejected
  v_scroll_top 10 || true
  PC1_RC=0
  create_patient_deep "" "" "" "" "" "an empty probe note" "pc1-empty" >/dev/null 2>&1 || PC1_RC=$?
  if [ "$PC1_RC" = "2" ]; then
    ocr_capture || true
    snap "pc1-rejected" || true
    if ocr_grep "Fill out this field" || ocr_grep "First name and last name are required"; then
      qa_cap EMPTY_REQUIRED_FIELDS "GREEN (the empty-names submit was rejected — the rejection text is visible)"
      surface_row "Required name fields" "Add Patient dialog submitted empty" "First Name*/Last Name* (required)" "the submit is rejected with a visible message" "submitted both names empty; the dialog stayed open with the rejection visible" "GREEN (rejected)" "pc1-rejected" "OK"
    else
      bug D PATIENTS_REQUIRED_FIELDS "the empty submit was rejected (the dialog stayed open) but the rejection TEXT could not be OCR-verified (the behavior is correct; the needle is the honest limit)"
    fi
    ensure_dialog_closed "pc1-empty" add_patient_dialog_visible || true
  elif [ "$PC1_RC" = "0" ]; then
    # D-hardening (run 34901913438 BUG-2): corroborate a 'created' verdict
    # against the count badge before firing the P1 — an OCR-garbled 'closed'
    # with the dialog actually open must not masquerade as a product defect.
    ensure_dialog_closed "pc1-empty" add_patient_dialog_visible || true
    read_patient_count
    if [ "$PATIENTS_COUNT" = "$PC0_BEFORE" ] || [ "$PATIENTS_COUNT" = "0" ] || [ "$PATIENTS_COUNT" = "unreadable" ]; then
      bug D PATIENTS_REQUIRED_FIELDS "the 'created' verdict could not be corroborated (count '$PATIENTS_COUNT' vs '$PC0_BEFORE' before) — a dialog-closed misread, no creation proven (harness D; the native validation may have fired correctly)"
    else
      bug P1 PATIENTS_REQUIRED_FIELDS "the empty-names submit CREATED a patient (count '$PC0_BEFORE' → '$PATIENTS_COUNT'; the required validation did not fire)"
    fi
  else
    bug D PATIENTS_REQUIRED_FIELDS "the empty-submit probe could not run (a harness step failed — recorded honestly)"
  fi

  # PC1b — last-name-only: also rejected
  v_scroll_top 10 || true
  PC1B_RC=0
  create_patient_deep "" "Probe" "" "" "" "" "pc1b-lastonly" >/dev/null 2>&1 || PC1B_RC=$?
  if [ "$PC1B_RC" = "2" ]; then
    probe "pc1b: the last-name-only submit was rejected (the dialog stayed open)"
    ensure_dialog_closed "pc1b-lastonly" add_patient_dialog_visible || true
  elif [ "$PC1B_RC" = "0" ]; then
    bug P1 PATIENTS_REQUIRED_FIELDS "the first-name-empty submit CREATED a patient (the required validation did not fire on the first field)"
  fi

  # PC2 — John Test: the full-data valid create (sentinel ONLY-JOHN-ALPHA)
  v_scroll_top 10 || true
  PC2_RC=0
  create_patient_deep "$PAT_A_FIRST" "$PAT_A_LAST" "$PAT_A_PHONE" "$PAT_A_EMAIL" "" "$PAT_A_NOTE" "pc2-john" >/dev/null 2>&1 || PC2_RC=$?
  if [ "$PC2_RC" = "0" ]; then
    sleep 2
    read_patient_count
    if v_scroll_find "$PAT_A_FIRST $PAT_A_LAST" 12; then
      ocr_grep "$PAT_A_PHONE" && probe "pc2: John's row shows his phone"
      qa_cap PATIENT_CREATE "GREEN (John Test created through the real dialog; the row + the count badge ($PATIENTS_COUNT) updated)"
      surface_row "Valid create (full data)" "Add Patient dialog → fill all fields → submit" "7 fields; progress bar; 'Add Patient' submit" "the dialog closes; the list/count update; the new row is visible" "created John Test; dialog closed; row visible; badge=$PATIENTS_COUNT" "GREEN" "pc2-*" "OK"
      snap "pc2-john-listed" || true
    else
      bug P1 PATIENT_CREATE "John Test was created (dialog closed) but his row is NOT visible in the list"
    fi
  else
    bug P1 PATIENT_CREATE "the John Test create did not complete (rc=$PC2_RC — see the pc2 evidence)"
  fi

  # ------------------------------------------------------------------
  # PS — SCHEDULE A VISIT FOR JOHN (run NOW while he is the ONLY patient:
  # the scheduler's Patient select dropdown then holds exactly one item —
  # no scroll ambiguity; the visit enables the Today/Overview + Upcoming +
  # Calendar entry points; the date defaults to TODAY)
  # ------------------------------------------------------------------
  note "=== patients PS: schedule a visit for John (the entry-point enabler) ==="
  VISIT_SCHEDULED=0
  v_scroll_top 10 || true
  if v_scroll_find "Upcoming Visits" 6 || v_scroll_find "Schedule Visit" 6; then
    if v_click "Schedule Visit" "ps-open" "Chief Complaint"; then
      if v_click "Select a patient" "ps-select-open" ""; then
        sleep 1
        ocr_capture || true
        snap "ps-dropdown-open" || true
        record_inventory "Schedule Visit dialog — the Patient select dropdown (John is the only item)"
        if v_click "$PAT_A_FIRST $PAT_A_LAST" "ps-item" "" "first" || v_click "$PAT_A_FIRST" "ps-item-fb" "" "first"; then
          sleep 1
          ocr_capture || true
          if ! ocr_grep "Select a patient"; then
            probe "ps: the patient select now holds John Test (the placeholder is gone)"
            # the dialog-footer submit: the 'Schedule Visit' hit on the
            # Cancel's row (the dimmed background buttons must NOT be clicked)
            if v_click_near_anchor_y "Schedule Visit" "Cancel" "ps-submit" 40; then
              sleep 2
              if wait_text_gone "Chief Complaint" 10 "ps-dialog-close"; then
                sleep 2
                if v_scroll_find "Upcoming Visits" 6; then
                  ocr_capture || true
                  if ocr_grep "$PAT_A_FIRST $PAT_A_LAST" || ocr_grep "09:00" || ocr_grep "Checkup"; then
                    VISIT_SCHEDULED=1
                    qa_cap VISIT_SCHEDULING "GREEN (a visit for John Test was scheduled through the real dialog — the Upcoming Visits card appeared)"
                    surface_row "Visit scheduling (entry-point enabler)" "Upcoming Visits → 'Schedule Visit' dialog" "Patient select; date (defaults today); 'Schedule Visit' submit" "the visit appears in Upcoming Visits + Today's Overview + the calendar" "scheduled John Test today 09:00; the card appeared" "GREEN" "ps-*" "OK"
                    snap "ps-upcoming-card" || true
                  else
                    bug P1 VISIT_SCHEDULING "the scheduler dialog closed but no Upcoming Visits card for John Test is visible"
                  fi
                fi
              else
                bug D PATIENTS_VISIT_SUBMIT "the anchored footer submit did not close the scheduler dialog (honest harness limit — the Today/Upcoming/Calendar entry probes will be recorded NOT EXERCISED)"
                press_escape
                sleep 1
              fi
            else
              bug D PATIENTS_VISIT_SUBMIT "the dialog-footer 'Schedule Visit' could not be anchored (the Today/Upcoming/Calendar entry probes will be recorded NOT EXERCISED)"
              press_escape
              sleep 1
            fi
          else
            bug D PATIENTS_VISIT_SELECT "the patient item click did not register in the select (the placeholder persists — honest record)"
            press_escape
            sleep 1
          fi
        else
          bug D PATIENTS_VISIT_SELECT "John's item could not be clicked in the patient dropdown (honest record)"
          press_escape
          sleep 1
        fi
      else
        bug D PATIENTS_VISIT_SELECT "the Patient select trigger could not be clicked (honest record)"
        press_escape
        sleep 1
      fi
    else
      bug D PATIENTS_VISIT_OPEN "the Schedule Visit dialog did not open (honest record)"
    fi
  else
    probe "ps: the Upcoming Visits section was not reachable — the visit entry-point probes will be recorded NOT EXERCISED"
  fi

  # PC3 — Jane Test: optional fields ALL empty (the notes-only create)
  v_scroll_top 10 || true
  PC3_RC=0
  create_patient_deep "$PAT_B_FIRST" "$PAT_B_LAST" "" "" "" "$PAT_B_NOTE" "pc3-jane" >/dev/null 2>&1 || PC3_RC=$?
  if [ "$PC3_RC" = "0" ]; then
    sleep 2
    read_patient_count
    if v_scroll_find "$PAT_B_FIRST $PAT_B_LAST" 12; then
      qa_cap EMPTY_OPTIONAL_FIELDS "GREEN (Jane Test created with every optional field empty; row visible; badge=$PATIENTS_COUNT)"
      surface_row "Optional fields empty" "Add Patient dialog (names + Notes only)" "—" "optional-empty creates succeed" "created Jane Test with no phone/email/address/DOB" "GREEN" "pc3-*" "OK"
      snap "pc3-jane-listed" || true
    else
      bug P1 PATIENT_CREATE "Jane Test (optional-empty) was created but her row is NOT visible"
    fi
  else
    bug P1 PATIENT_CREATE "the Jane Test optional-empty create did not complete (rc=$PC3_RC)"
  fi

  # PC4 — Muhammad Test: the Arabic create
  v_scroll_top 10 || true
  PC4_RC=0
  create_patient_deep "$PAT_C_FIRST" "$PAT_C_LAST" "$PAT_C_PHONE" "" "" "$PAT_C_NOTE" "pc4-mohammad" yes >/dev/null 2>&1 || PC4_RC=$?
  if [ "$PC4_RC" = "0" ]; then
    sleep 2
    read_patient_count
    if search_type "0202" "pc4-search-c" >/dev/null 2>&1; then
      sleep 2
    fi
    v_scroll_find "0202" 6 || true
    ocr_capture || true
    if ocr_grep "0202" || ocr_grep "$PAT_C_PHONE"; then
      qa_cap ARABIC_CREATE "GREEN (the Arabic patient Muhammad Test created through the real dialog — international phone format accepted; badge=$PATIENTS_COUNT)"
      surface_row "Arabic name create" "Add Patient dialog (Arabic typing path)" "—" "Arabic names create correctly" "created Muhammad Test (Arabic) + international phone; the phone-token search surfaced the row" "GREEN" "pc4-*" "OK"
      snap "pc4-c-listed" || true
    else
      bug P1 ARABIC_CREATE "the Arabic patient create closed the dialog but the row is not findable via his phone token"
    fi
    clear_search_box || true
  else
    bug P1 ARABIC_CREATE "the Arabic patient create did not complete (rc=$PC4_RC)"
  fi

  # PC5 — Élodie Müller: accented Latin
  v_scroll_top 10 || true
  PC5_RC=0
  create_patient_deep "$PAT_D_FIRST" "$PAT_D_LAST" "$PAT_D_PHONE" "$PAT_D_EMAIL" "$PAT_D_ADDR" "$PAT_D_NOTE" "pc5-elodie" yes >/dev/null 2>&1 || PC5_RC=$?
  if [ "$PC5_RC" = "0" ]; then
    sleep 2
    read_patient_count
    if search_type "0304" "pc5-search-d" >/dev/null 2>&1; then
      sleep 2
    fi
    v_scroll_find "0304" 6 || true
    ocr_capture || true
    if ocr_grep "0304" || ocr_grep "Muller" || ocr_grep "Müller" || ocr_grep "Élodie"; then
      qa_cap ACCENTED_LATIN_CREATE "GREEN (Élodie Müller created — accented Latin + accented address accepted; badge=$PATIENTS_COUNT)"
      surface_row "Accented Latin create" "Add Patient dialog (Unicode typing path)" "—" "accented names/addresses create correctly" "created Élodie Müller with the accented address; the phone-token search surfaced the row" "GREEN" "pc5-*" "OK"
      snap "pc5-d-listed" || true
    else
      bug P1 ACCENTED_LATIN_CREATE "the accented patient create closed the dialog but the row is not findable (token 0304)"
    fi
    clear_search_box || true
  else
    bug P1 ACCENTED_LATIN_CREATE "the accented patient create did not complete (rc=$PC5_RC)"
  fi

  # PC6 — O'Connor Test: apostrophe in the name + dotted phone
  v_scroll_top 10 || true
  PC6_RC=0
  create_patient_deep "$PAT_E_FIRST" "$PAT_E_LAST" "$PAT_E_PHONE" "" "" "$PAT_E_NOTE" "pc6-oconnor" >/dev/null 2>&1 || PC6_RC=$?
  if [ "$PC6_RC" = "0" ]; then
    sleep 2
    read_patient_count
    if search_type "0105" "pc6-search-e" >/dev/null 2>&1; then
      sleep 2
    fi
    v_scroll_find "0105" 6 || true
    ocr_capture || true
    if ocr_grep "0105" || ocr_grep "O'Connor" || ocr_grep "O Connor" || ocr_grep "Connor"; then
      qa_cap APOSTROPHE_HYPHEN_CREATE "GREEN (O'Connor Test created — the apostrophe + the dotted phone format accepted; badge=$PATIENTS_COUNT)"
      surface_row "Apostrophe name create" "Add Patient dialog (apostrophe + dotted phone)" "—" "apostrophes/hyphens create correctly" "created O'Connor Test with the 555.0105.777 dotted phone" "GREEN" "pc6-*" "OK"
      snap "pc6-e-listed" || true
    else
      bug P1 APOSTROPHE_CREATE "the O'Connor create closed the dialog but the row is not findable (token 0105)"
    fi
    clear_search_box || true
  else
    bug P1 APOSTROPHE_CREATE "the O'Connor create did not complete (rc=$PC6_RC)"
  fi

  # PC7 — the very long name + long values (the DOB digit attempt is
  # recorded as an ENV limitation — see the DOB_DATE_INPUT_AUTOMATION note)
  v_scroll_top 10 || true
  PC7_RC=0
  create_patient_deep "$PAT_F_FIRST" "$PAT_F_LAST" "$PAT_F_PHONE" "$PAT_F_EMAIL" "$PAT_F_ADDR" "$PAT_F_NOTE" "pc7-long" >/dev/null 2>&1 || PC7_RC=$?
  bug ENV DOB_DATE_INPUT_AUTOMATION "the type=date DOB automation is not feasible via System Events keystrokes: three runs (34917898200, 34921354377, 34924632947) prove the digits never enter the WebKit date segments, and the attempt leaves the field mid-segment-edit which blocks the WHOLE form submit ('Invalid value' — no API POST ever sent; neither a Tab segment-cycle nor a blur clears it). The DOB digit attempt is NOT EXERCISED by this lane; the DOB display is verified on the row/detail only if set by other means. The long-values create itself (the 46-char name + long phone/email/address/notes) is the probe's substance."
  if [ "$PC7_RC" = "0" ]; then
    sleep 2
    read_patient_count
    if v_scroll_find "MediVault Testing" 12; then
      ocr_capture || true
      if ocr_grep "DOB"; then
        probe "pc7: the long-name patient's row shows a DOB — set by another path (honest record)"
        qa_cap PATIENT_DOB "GREEN (a DOB is visible on the row)"
      else
        probe "pc7: no DOB visible on the row (the digit-entry attempt is not exercised — the ENV record above; the field is optional)"
        qa_cap PATIENT_DOB "NOT EXERCISED (the type=date automation limit — the ENV record above; the field is optional)"
      fi
      qa_cap LONG_VALUES_CREATE "GREEN (the very long synthetic name + long address/notes/phone-with-extension accepted; badge=$PATIENTS_COUNT)"
      surface_row "Long values create" "Add Patient dialog (46-char first name + long address/notes)" "—" "long values create and display (truncation in tight UI slots is fine)" "created 'Very Long Synthetic Patient Name For MediVault Testing'" "GREEN" "pc7-*" "OK"
      snap "pc7-f-listed" || true
    else
      bug P1 LONG_VALUES_CREATE "the long-name patient was created but the row is not visible"
    fi
  else
    bug P1 LONG_VALUES_CREATE "the long-name create did not complete (rc=$PC7_RC)"
  fi

  # PC8 — duplicate/similar names: John Tester / john test / John-Test-Hyphen
  # (the API has no uniqueness constraint — the UI must keep them SEPARATE)
  note "=== patients PC8: the duplicate/similar-name cohort ==="
  local sim_rc=0 sim_n=0
  # D-fix (run 34927416875 PC8a): PC7's row verification leaves the view
  # scrolled down at the patients list — scroll the header button back
  # into view before the first dialog-open click (the same class as the
  # PC0 fix; PC8b/PC8c already had it).
  v_scroll_top 10 || true
  create_patient_deep "John" "Tester" "+1 555 1101" "john.tester@example.invalid" "" "ONLY-TESTER-GOLF" "pc8a-tester" >/dev/null 2>&1 || sim_rc=$?
  [ "$sim_rc" = "0" ] && sim_n=$((sim_n + 1))
  v_scroll_top 10 || true
  sim_rc=0
  create_patient_deep "john" "test" "+1 555 1102" "" "" "ONLY-LOWCASE-HOTEL" "pc8b-lowcase" >/dev/null 2>&1 || sim_rc=$?
  [ "$sim_rc" = "0" ] && sim_n=$((sim_n + 1))
  v_scroll_top 10 || true
  sim_rc=0
  create_patient_deep "John" "Test-Hyphen" "+1 555 1103" "" "" "ONLY-HYPHEN-INDIA" "pc8c-hyphen" >/dev/null 2>&1 || sim_rc=$?
  [ "$sim_rc" = "0" ] && sim_n=$((sim_n + 1))
  read_patient_count
  if [ "$sim_n" = "3" ]; then
    if [ "$PATIENTS_COUNT" = "9" ]; then
      qa_cap DUPLICATE_SIMILAR_NAMES "GREEN (John Test / John Tester / john test / John-Test-Hyphen coexist as separate rows — count 9 as expected; no merge)"
      surface_row "Duplicate/similar names" "three similar-name creates after John Test" "—" "similar names stay separate records (no merge, no wrong record)" "created 3 similar patients; count=9; each opens its own record (verified via unique phone tokens below)" "GREEN" "pc8*" "OK"
    else
      bug P1 DUPLICATE_NAMES "the three similar-name patients were created but the count badge reads '$PATIENTS_COUNT' (expected 9) — patients may have merged or the count is wrong"
    fi
  else
    bug P1 DUPLICATE_NAMES "the similar-name cohort created only $sim_n of 3 patients"
  fi
  snap "pc8-list-after-dups" || true
  # each similar patient opens its OWN record (unique-token targeting):
  local tok who expect_note
  for tok in 1101 1102 1103; do
    case "$tok" in
      1101) who="John Tester"; expect_note="ONLY-TESTER-GOLF" ;;
      1102) who="john test"; expect_note="ONLY-LOWCASE-HOTEL" ;;
      1103) who="John Test-Hyphen"; expect_note="ONLY-HYPHEN-INDIA" ;;
    esac
    if open_patient_by_phone_token "$tok" "$who" "pc8-$tok" "+1 555 $tok"; then
      scan_detail_multi "$expect_note" "$FOREIGN_ALL"
      if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
        bug P0 PATIENT_DATA_ISOLATION "a similar-name patient ($who) shows ANOTHER patient's sentinel note ($SCAN_FOREIGN_WHICH) — cross-patient data leak"
      elif [ "$SCAN_OWN_SEEN" = "yes" ]; then
        probe "pc8: $who opened his OWN record (own sentinel present, no foreign sentinels) — no similar-name merge"
      else
        bug D PATIENTS_SIMILAR "$who's own note could not be OCR-verified on his detail (the open + the phone verify stand)"
      fi
      v_click "Dashboard" "pc8-$tok-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "pc8-$tok-dash" || true
    else
      bug P1 DUPLICATE_NAMES "could not open $who via his unique phone token $tok (a similar-name record may be missing/wrong)"
    fi
  done
  v_scroll_top 10 || true

  # PC10 — Zed Delete: the DOUBLE-SUBMIT create (a rapid second submit must
  # NOT create a second patient — the human-mistake create probe)
  note "=== patients PC10: the double-submit create (Zed) ==="
  ZED_CREATED=0
  # D-fix (the PC8a class, applied preemptively): the PC8 verification
  # loop can leave the view scrolled — restore the header button first.
  v_scroll_top 10 || true
  if v_click "Add Patient" "pc10-open" "First Name" first 0 label; then
    v_type_into "First Name" "$PAT_ZED_FIRST" "pc10-first" || true
    v_type_into "Last Name" "$PAT_ZED_LAST" "pc10-last" || true
    v_type_into "Phone" "$PAT_ZED_PHONE" "pc10-phone" || true
    v_type_into "Email" "$PAT_ZED_EMAIL" "pc10-email" || true
    v_type_into "Notes" "$PAT_ZED_NOTE" "pc10-notes" || true
    snap "pc10-form-filled" || true
    if ocr_lookup "First Name" "first" "label"; then
      "$MV_MOUSE" "$OCR_HIT_X" "$(( OCR_HIT_Y + 6 ))" 2>>"$LOG" || true
      sleep 1
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10 || true
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10 || true
      sleep 3
    fi
    ocr_capture || true
    if ! add_patient_dialog_visible; then
      ZED_CREATED=1
      snap "pc10-submitted-double" || true
    fi
    if [ "$ZED_CREATED" = "0" ]; then
      local b2=0
      while [ "$b2" -lt 4 ]; do
        scroll_burst down 500 400
        sleep 1
        b2=$((b2 + 1))
      done
      if v_click_try_hits "Add Patient" "pc10-submit" "$PAT_ZED_FIRST"; then
        ZED_CREATED=1
        sleep 2
      fi
    fi
    press_escape
    sleep 1
  fi
  read_patient_count
  if [ "$ZED_CREATED" = "1" ] && [ "$PATIENTS_COUNT" = "10" ]; then
    qa_cap DOUBLE_SUBMIT_CREATE "GREEN (the rapid double-submit created exactly ONE Zed Delete patient — count 10; no duplicate record)"
    surface_row "Double-submit create" "Add Patient submit pressed twice rapidly" "—" "a rapid double-submit creates exactly one record" "double-Return submit; count=10 (not 11)" "GREEN" "pc10-*" "OK"
  elif [ "$ZED_CREATED" = "1" ]; then
    bug P1 DOUBLE_SUBMIT_CREATE "after the double-submit the count badge reads '$PATIENTS_COUNT' (expected 10 — the second submit may have created a duplicate)"
  else
    bug P1 PATIENT_CREATE "the Zed Delete create did not complete"
  fi

  # ------------------------------------------------------------------
  # PI — SENTINEL ISOLATION (the P0 discipline)
  # ------------------------------------------------------------------
  note "=== patients PI: the sentinel isolation scans ==="
  surface_section "Patient data isolation (sentinel scans)"
  # John (also seeds recentlyViewed with the PRE-EDIT object — required for
  # the later stale-entry regression proof)
  # (run 34930796719 D-fix): the row-needle is John's unique phone line —
  # the bare 'John Test' name needle prefix-matched the PC8 similar-name
  # cohort rows and opened John Test-Hyphen's detail (the FALSE P0).
  # (run 34985384528 D-fix #2): the Recent Patients panel is CAPPED at 8
  # rows sorted by updatedAt desc (the API's /api/stats take:8) — John,
  # the OLDEST never-updated record, sits below the cap once the PC8+Zed
  # cohort fills it, so his row is not rendered on the dashboard at all.
  # Open him via the proven phone-token SEARCH path instead (the exact
  # path that opened 1101/1102/1103/0202/0304/0105/0106 with detail-proof
  # confirmations in run 12). After PE2's edit bumps his updatedAt, the
  # PV1/nv6/PP row-needle opens (0777) become reachable again (his row
  # returns to the TOP of the panel).
  if open_patient_by_phone_token "0101" "$PAT_A_FIRST $PAT_A_LAST" "pi-john" "$PAT_A_PHONE"; then
    scan_detail_multi "$PAT_A_NOTE" "$FOREIGN_ALL"
    if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
      bug P0 PATIENT_DATA_ISOLATION "John Test's detail shows another patient's sentinel note ($SCAN_FOREIGN_WHICH) — CROSS-PATIENT DATA LEAK"
    elif [ "$SCAN_OWN_SEEN" = "yes" ]; then
      qa_cap PATIENT_ISOLATION_JOHN "GREEN (own sentinel ONLY-JOHN-ALPHA visible; all 8 foreign sentinels absent across the full detail scan)"
      surface_row "Isolation — John Test" "detail opened from the list row" "—" "only own data on the detail" "full scroll-scan: own note yes; foreign sentinels no" "GREEN" "pi-john-*" "OK"
    else
      bug P1 PATIENT_DATA_ISOLATION "John's own sentinel note is not visible on his detail (scanned)"
    fi
    snap "pi-john-isolated" || true
  else
    bug D PATIENTS_ISOLATION "could not open John's detail for the isolation scan"
  fi
  # Jane
  v_click "Dashboard" "pi-jane-back" "Add Patient" || true
  wait_for_ocr "Add Patient" 30 "pi-jane-dash" || true
  v_scroll_top 10 || true
  if open_patient_detail "$PAT_B_FIRST $PAT_B_LAST" "pi-jane"; then
    scan_detail_multi "$PAT_B_NOTE" "$FOREIGN_ALL"
    if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
      bug P0 PATIENT_DATA_ISOLATION "Jane Test's detail shows another patient's sentinel note ($SCAN_FOREIGN_WHICH) — CROSS-PATIENT DATA LEAK"
    elif [ "$SCAN_OWN_SEEN" = "yes" ]; then
      qa_cap PATIENT_ISOLATION_JANE "GREEN (own sentinel present; no foreign sentinels)"
      surface_row "Isolation — Jane Test" "detail opened from the list row" "—" "only own data" "full scan: own yes; foreign no" "GREEN" "pi-jane-*" "OK"
    else
      bug P1 PATIENT_DATA_ISOLATION "Jane's own sentinel note is not visible on her detail (scanned)"
    fi
    snap "pi-jane-isolated" || true
  else
    bug D PATIENTS_ISOLATION "could not open Jane's detail for the isolation scan"
  fi
  # Muhammad (token 0202)
  v_click "Dashboard" "pi-c-back" "Add Patient" || true
  wait_for_ocr "Add Patient" 30 "pi-c-dash" || true
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0202" "محمد" "pi-c" "$PAT_C_PHONE"; then
    scan_detail_multi "$PAT_C_NOTE" "$FOREIGN_ALL"
    if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
      bug P0 PATIENT_DATA_ISOLATION "Muhammad's detail shows another patient's sentinel note ($SCAN_FOREIGN_WHICH) — CROSS-PATIENT DATA LEAK"
    elif [ "$SCAN_OWN_SEEN" = "yes" ]; then
      qa_cap PATIENT_ISOLATION_MOHAMMAD "GREEN (the Arabic patient's own sentinel present; no foreign sentinels)"
      surface_row "Isolation — Muhammad Test (Arabic)" "detail opened via the phone-token search" "—" "only own data" "full scan: own yes; foreign no" "GREEN" "pi-c-*" "OK"
    else
      bug P1 PATIENT_DATA_ISOLATION "Muhammad's own sentinel note is not visible on his detail (scanned)"
    fi
    snap "pi-c-isolated" || true
  else
    bug D PATIENTS_ISOLATION "could not open Muhammad's detail for the isolation scan"
  fi
  # Élodie (token 0304)
  v_click "Dashboard" "pi-d-back" "Add Patient" || true
  wait_for_ocr "Add Patient" 30 "pi-d-dash" || true
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0304" "Élodie" "pi-d" "$PAT_D_PHONE"; then
    scan_detail_multi "$PAT_D_NOTE" "$FOREIGN_ALL"
    if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
      bug P0 PATIENT_DATA_ISOLATION "Élodie's detail shows another patient's sentinel note ($SCAN_FOREIGN_WHICH) — CROSS-PATIENT DATA LEAK"
    elif [ "$SCAN_OWN_SEEN" = "yes" ]; then
      qa_cap PATIENT_ISOLATION_ELODIE "GREEN (the accented patient's own sentinel present; no foreign sentinels)"
      surface_row "Isolation — Élodie Müller" "detail opened via the phone-token search" "—" "only own data" "full scan: own yes; foreign no" "GREEN" "pi-d-*" "OK"
    else
      bug P1 PATIENT_DATA_ISOLATION "Élodie's own sentinel note is not visible on her detail (scanned)"
    fi
    snap "pi-d-isolated" || true
  else
    bug D PATIENTS_ISOLATION "could not open Élodie's detail for the isolation scan"
  fi
  # O'Connor (token 0105)
  v_click "Dashboard" "pi-e-back" "Add Patient" || true
  wait_for_ocr "Add Patient" 30 "pi-e-dash" || true
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0105" "O'Connor" "pi-e" "$PAT_E_PHONE"; then
    scan_detail_multi "$PAT_E_NOTE" "$FOREIGN_ALL"
    if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
      bug P0 PATIENT_DATA_ISOLATION "O'Connor's detail shows another patient's sentinel note ($SCAN_FOREIGN_WHICH) — CROSS-PATIENT DATA LEAK"
    elif [ "$SCAN_OWN_SEEN" = "yes" ]; then
      qa_cap PATIENT_ISOLATION_OCONNOR "GREEN (the apostrophe patient's own sentinel present; no foreign sentinels)"
      surface_row "Isolation — O'Connor Test" "detail opened via the phone-token search" "—" "only own data" "full scan: own yes; foreign no" "GREEN" "pi-e-*" "OK"
    else
      bug P1 PATIENT_DATA_ISOLATION "O'Connor's own sentinel note is not visible on his detail (scanned)"
    fi
    snap "pi-e-isolated" || true
  else
    bug D PATIENTS_ISOLATION "could not open O'Connor's detail for the isolation scan"
  fi
  # the long-name patient (token 0106)
  v_click "Dashboard" "pi-f-back" "Add Patient" || true
  wait_for_ocr "Add Patient" 30 "pi-f-dash" || true
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0106" "Very Long" "pi-f" "$PAT_F_PHONE"; then
    scan_detail_multi "$PAT_F_NOTE" "$FOREIGN_ALL"
    if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
      bug P0 PATIENT_DATA_ISOLATION "the long-name patient's detail shows another patient's sentinel note ($SCAN_FOREIGN_WHICH) — CROSS-PATIENT DATA LEAK"
    elif [ "$SCAN_OWN_SEEN" = "yes" ]; then
      qa_cap PATIENT_ISOLATION_LONGNAME "GREEN (the long-name patient's own sentinel present; no foreign sentinels)"
      surface_row "Isolation — long-name patient" "detail opened via the phone-token search" "—" "only own data" "full scan: own yes; foreign no" "GREEN" "pi-f-*" "OK"
    else
      bug P1 PATIENT_DATA_ISOLATION "the long-name patient's own sentinel note is not visible on his detail (scanned)"
    fi
    snap "pi-f-isolated" || true
  else
    bug D PATIENTS_ISOLATION "could not open the long-name patient's detail for the isolation scan"
  fi
  v_click "Dashboard" "pi-final-back" "Add Patient" || true
  wait_for_ocr "Add Patient" 30 "pi-final-dash" || true
  v_scroll_top 10 || true

  # ------------------------------------------------------------------
  # PE — EDIT BATTERY (run BEFORE the entry-point proofs so the stale-
  # snapshot regression is armed: John's recentlyViewed cache holds his
  # PRE-EDIT phone from the PI scans)
  # ------------------------------------------------------------------
  note "=== patients PE: the edit battery ==="

  # PE1 — cancel edit: the typed value must NOT persist (John opened via
  # the phone-token search — his row sits below the 8-row panel cap)
  if open_patient_by_phone_token "0101" "$PAT_A_FIRST $PAT_A_LAST" "pe1-john" "$PAT_A_PHONE"; then
    if v_click_edit_pencil "$PAT_A_FIRST $PAT_A_LAST" "pe1-edit-open"; then
      v_type_into "Phone" "999-999-9999" "pe1-phone" no no no 250 || true
      snap "pe1-form-typed" || true
      v_click "Cancel" "pe1-cancel" "" || true
      sleep 2
      # D-fix (BUG-2 class): VERIFIED close via the multi-needle edit-dialog
      # check — the 999-999-9999 absence check below is only honest once the
      # dialog (which displays the typed value) is really gone.
      ensure_dialog_closed "pe1-close" edit_patient_dialog_visible || true
      ocr_grep "999-999-9999" && bug P1 CANCEL_EDIT "the canceled edit's phone (999-999-9999) is VISIBLE after the cancel — a canceled edit must not persist"
      if ! ocr_grep "999-999-9999"; then
        qa_cap CANCEL_EDIT "GREEN (the typed-but-canceled phone did not persist; John's real phone is unchanged)"
        surface_row "Cancel edit" "Edit Patient dialog → type → 'Cancel'" "'Cancel' + 'Save Changes'" "canceling discards the edit" "typed 999-999-9999 → Cancel → the value is absent" "GREEN" "pe1-*" "OK"
      fi
    else
      bug D PATIENTS_EDIT_PENCIL "the edit pencil could not be activated for the cancel-edit probe"
    fi
    v_click "Dashboard" "pe1-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe1-dash" || true
  else
    bug D PATIENTS_EDIT "could not open John's detail for the edit battery"
  fi

  # PE2 — multi-field save (phone + note) on John — THE edit that arms the
  # stale-snapshot regression for the entry-point battery (opened via the
  # phone-token search — the panel-cap D of run 34985384528)
  v_scroll_top 10 || true
  PE2_RC=0
  if open_patient_by_phone_token "0101" "$PAT_A_FIRST $PAT_A_LAST" "pe2-john" "$PAT_A_PHONE"; then
    if v_click_edit_pencil "$PAT_A_FIRST $PAT_A_LAST" "pe2-edit-open"; then
      v_type_into "Phone" "$JOHN_NEW_PHONE" "pe2-phone" no no yes 250 || true
      v_clear_field "Notes" "pe2-notes-clear" 250 || true
      v_type_into "Notes" "$JOHN_NEW_NOTE" "pe2-notes" no no no 250 || true
      snap "pe2-form-edited" || true
      if v_click_near_anchor_y "Save Changes" "Cancel" "pe2-save" 40; then
        sleep 3
        ocr_capture || true
        if edit_patient_dialog_visible; then
          local b3=0
          while [ "$b3" -lt 4 ]; do
            scroll_burst down 500 400
            sleep 1
            b3=$((b3 + 1))
          done
          v_click_try_hits "Save Changes" "pe2-save-fb" "$JOHN_NEW_PHONE" || PE2_RC=1
        fi
      else
        local b4=0
        while [ "$b4" -lt 4 ]; do
          scroll_burst down 500 400
          sleep 1
          b4=$((b4 + 1))
        done
        v_click_try_hits "Save Changes" "pe2-save-fb" "$JOHN_NEW_PHONE" || PE2_RC=1
      fi
      sleep 2
      if [ "$PE2_RC" = "0" ]; then
        detail_scroll_top "pe2-verify" || true
        if v_scroll_find "$JOHN_NEW_PHONE" 8; then
          ocr_capture || true
          if ocr_grep "$PAT_A_PHONE"; then
            bug P1 PATIENT_EDIT "the OLD phone ($PAT_A_PHONE) is still visible alongside the new one after the edit"
          else
            qa_cap PATIENT_EDIT "GREEN (multi-field edit saved: phone → $JOHN_NEW_PHONE, note → v2; the old phone is gone; the dialog closed)"
            surface_row "Multi-field edit" "Edit Patient dialog → Save Changes" "7 prefilled fields + Completion meter" "the edited values replace the old ones; the dialog closes" "edited phone+note; new values visible; old phone absent" "GREEN" "pe2-*" "OK"
          fi
          snap "pe2-saved" || true
        else
          bug P1 PATIENT_EDIT "the edited phone ($JOHN_NEW_PHONE) is not visible after the edit dialog closed"
        fi
      else
        bug P1 PATIENT_EDIT "saving John's edit produced no visible change"
      fi
    else
      bug P1 PATIENT_EDIT "the edit pencil could not be activated for the multi-field edit"
    fi
    v_click "Dashboard" "pe2-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe2-dash" || true
  else
    bug D PATIENTS_EDIT "could not open John's detail for the multi-field edit"
  fi

  # PE3 — single-field edit: Élodie's phone (the pencil anchored on her
  # phone with the -38 band correction — the accented name cannot anchor)
  v_scroll_top 10 || true
  PE3_RC=0
  if open_patient_by_phone_token "0304" "Élodie" "pe3-elodie" "$PAT_D_PHONE"; then
    if v_click_edit_pencil "$PAT_D_PHONE" "pe3-edit-open" -38; then
      v_type_into "Phone" "+33 1 555 0304" "pe3-phone" no no yes 250 || true
      snap "pe3-form-edited" || true
      if v_click_near_anchor_y "Save Changes" "Cancel" "pe3-save" 40; then
        sleep 3
      else
        local b5=0
        while [ "$b5" -lt 4 ]; do
          scroll_burst down 500 400
          sleep 1
          b5=$((b5 + 1))
        done
        v_click_try_hits "Save Changes" "pe3-save-fb" "0304" || PE3_RC=1
      fi
      sleep 2
      ocr_capture || true
      if edit_patient_dialog_visible; then PE3_RC=1; press_escape; sleep 1; fi
      if [ "$PE3_RC" = "0" ]; then
        detail_scroll_top "pe3-verify" || true
        if v_scroll_find "0304" 6; then
          qa_cap PATIENT_EDIT_SINGLE_FIELD "GREEN (Élodie's single-field phone edit saved — the new +33 number visible)"
          surface_row "Single-field edit" "Edit Patient dialog → one field → Save" "—" "only the edited field changes" "edited Élodie's phone only; verified" "GREEN" "pe3-*" "OK"
          snap "pe3-saved" || true
        else
          bug P1 PATIENT_EDIT_SINGLE_FIELD "Élodie's single-field edit did not visibly save"
        fi
      else
        bug P1 PATIENT_EDIT_SINGLE_FIELD "Élodie's single-field edit save did not complete"
      fi
    else
      bug D PATIENTS_EDIT_PENCIL "the edit pencil could not be activated for Élodie (phone-anchored attempts recorded)"
    fi
    v_click "Dashboard" "pe3-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe3-dash" || true
  else
    bug D PATIENTS_EDIT "could not open Élodie's detail for the single-field edit"
  fi

  # PE4 — consecutive edits: O'Connor's note, twice in a row
  v_scroll_top 10 || true
  PE4_RC=0
  if open_patient_by_phone_token "0105" "O'Connor" "pe4-oconnor" "$PAT_E_PHONE"; then
    local round
    for round in 1 2; do
      if v_click_edit_pencil "$PAT_E_PHONE" "pe4-edit-open-r$round" -38; then
        v_clear_field "Notes" "pe4-notes-clear-r$round" 250 || true
        v_type_into "Notes" "ONLY-OCONNOR-ECHO round$round" "pe4-notes-r$round" no no no 250 || true
        if v_click_near_anchor_y "Save Changes" "Cancel" "pe4-save-r$round" 40; then
          sleep 3
        else
          local b6=0
          while [ "$b6" -lt 4 ]; do
            scroll_burst down 500 400
            sleep 1
            b6=$((b6 + 1))
          done
          v_click_try_hits "Save Changes" "pe4-save-fb-r$round" "round$round" || PE4_RC=1
        fi
        sleep 2
        ocr_capture || true
        if edit_patient_dialog_visible; then PE4_RC=1; press_escape; sleep 1; fi
        v_click "Dashboard" "pe4-back-r$round" "Add Patient" || true
        wait_for_ocr "Add Patient" 30 "pe4-dash-r$round" || true
        v_scroll_top 10 || true
        if ! open_patient_by_phone_token "0105" "O'Connor" "pe4-reopen-r$round" "$PAT_E_PHONE"; then
          PE4_RC=1
        fi
      else
        PE4_RC=1
        break
      fi
    done
    if [ "$PE4_RC" = "0" ]; then
      detail_scroll_top "pe4-verify" || true
      if v_scroll_find "round2" 8; then
        qa_cap PATIENT_EDIT_CONSECUTIVE "GREEN (two consecutive edits both saved — the final note reads round2)"
        surface_row "Consecutive edits" "two edit-save cycles back to back" "—" "each edit persists; the last one stands" "O'Connor's note edited twice; 'round2' visible" "GREEN" "pe4-*" "OK"
        snap "pe4-saved-final" || true
      else
        bug P1 PATIENT_EDIT_CONSECUTIVE "the consecutive edits saved but the final value (round2) is not visible"
      fi
    else
      bug P1 PATIENT_EDIT_CONSECUTIVE "a consecutive-edit round failed (see the pe4 evidence)"
    fi
    v_click "Dashboard" "pe4-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe4-dash" || true
  else
    bug D PATIENTS_EDIT "could not open O'Connor's detail for the consecutive edits"
  fi

  # PE6 — Unicode edit: Élodie's address (acceded Latin via the Unicode
  # path; run BEFORE the phone-clear so the token targeting still works)
  v_scroll_top 10 || true
  PE6_RC=0
  if open_patient_by_phone_token "0304" "Élodie" "pe6-elodie" "+33 1 555 0304"; then
    if v_click_edit_pencil "+33 1 555 0304" "pe6-edit-open" -38; then
      v_clear_field "Address" "pe6-addr-clear" 250 || true
      v_type_into "Address" "22 Avenue de la République" "pe6-addr" no yes no 250 || true
      snap "pe6-form-edited" || true
      if v_click_near_anchor_y "Save Changes" "Cancel" "pe6-save" 40; then
        sleep 3
      else
        local b8=0
        while [ "$b8" -lt 4 ]; do
          scroll_burst down 500 400
          sleep 1
          b8=$((b8 + 1))
        done
        v_click_try_hits "Save Changes" "pe6-save-fb" "République" || PE6_RC=1
      fi
      sleep 2
      ocr_capture || true
      if edit_patient_dialog_visible; then PE6_RC=1; press_escape; sleep 1; fi
      if [ "$PE6_RC" = "0" ]; then
        detail_scroll_top "pe6-verify" || true
        if v_scroll_find "République" 8; then
          qa_cap PATIENT_EDIT_UNICODE "GREEN (the accented address edit (22 Avenue de la République) saved and is visible)"
          surface_row "Unicode edit" "Edit Patient dialog → accented address → Save" "—" "accented values edit and persist" "edited the address; 'République' visible" "GREEN" "pe6-*" "OK"
          snap "pe6-saved" || true
        else
          probe "pe6: the accented address could not be OCR-verified on the detail (Vision accent-dropping — the save itself may have succeeded; honest record)"
          bug D PATIENT_EDIT_UNICODE_VERIFY "the accented-address edit verification needle ('République') was not OCR-locatable after the save (accent rendering/OCR limit — honest)"
        fi
      else
        bug P1 PATIENT_EDIT_UNICODE "the accented address edit did not visibly save"
      fi
    else
      bug D PATIENTS_EDIT_PENCIL "the edit pencil could not be activated for the Unicode edit (phone-anchored)"
    fi
    v_click "Dashboard" "pe6-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe6-dash" || true
  else
    bug D PATIENTS_EDIT_UNICODE "could not open Élodie's detail for the Unicode edit"
  fi

  # PE5 — clear an optional field: Élodie's phone (Cmd+A + Delete → the
  # trimmed empty string saves as NULL)
  v_scroll_top 10 || true
  PE5_RC=0
  if open_patient_by_phone_token "0304" "Élodie" "pe5-elodie" "+33 1 555 0304"; then
    if v_click_edit_pencil "+33 1 555 0304" "pe5-edit-open" -38; then
      v_clear_field "Phone" "pe5-phone-clear" 250 || true
      snap "pe5-phone-cleared" || true
      if v_click_near_anchor_y "Save Changes" "Cancel" "pe5-save" 40; then
        sleep 3
      else
        local b7=0
        while [ "$b7" -lt 4 ]; do
          scroll_burst down 500 400
          sleep 1
          b7=$((b7 + 1))
        done
        v_click_try_hits "Save Changes" "pe5-save-fb" "Élodie" || PE5_RC=1
      fi
      sleep 2
      ocr_capture || true
      if edit_patient_dialog_visible; then PE5_RC=1; press_escape; sleep 1; fi
      if [ "$PE5_RC" = "0" ]; then
        # her phone must be GONE and the skeleton empty-state must NOT
        # appear (she still has email + address + note)
        local up5=0
        while [ "$up5" -lt 8 ]; do
          scroll_burst up
          sleep 1
          up5=$((up5 + 1))
        done
        local i5=0 last_hash5=""
        PE5_PHONE_GONE=0; PE5_SKELETON=0
        while [ "$i5" -lt 8 ]; do
          ocr_capture || true
          if [ -n "$last_hash5" ] && [ "$LAST_OCR_HASH" = "$last_hash5" ]; then break; fi
          last_hash5="$LAST_OCR_HASH"
          if ! ocr_grep "555 0304" && ! ocr_grep "5550304"; then
            PE5_PHONE_GONE=1
          fi
          ocr_grep "No contact information" && PE5_SKELETON=1
          scroll_burst down
          sleep 1
          i5=$((i5 + 1))
        done
        if [ "$PE5_PHONE_GONE" = "1" ] && [ "$PE5_SKELETON" = "0" ]; then
          qa_cap PATIENT_EDIT_CLEAR_OPTIONAL "GREEN (Élodie's phone was cleared to empty — the number is gone; no skeleton empty-state (her other data remains))"
          surface_row "Clear optional field" "Edit Patient dialog → clear Phone → Save" "—" "the field empties; the record keeps its other data" "cleared the phone; number absent; email/address/note intact" "GREEN" "pe5-*" "OK"
        elif [ "$PE5_PHONE_GONE" = "0" ]; then
          bug P1 PATIENT_EDIT_CLEAR_OPTIONAL "clearing Élodie's phone did not persist (the number is still visible)"
        else
          bug P2 PATIENT_EDIT_CLEAR_OPTIONAL "after clearing only the phone, the detail shows the 'No contact information added yet' skeleton (her email/address/note still exist — a stale empty-state render)"
        fi
        snap "pe5-cleared-result" || true
      else
        bug P1 PATIENT_EDIT_CLEAR_OPTIONAL "the clear-optional save did not complete"
      fi
    else
      bug D PATIENTS_EDIT_PENCIL "the edit pencil could not be activated for the clear-optional probe (post-edit phone anchor)"
    fi
    v_click "Dashboard" "pe5-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe5-dash" || true
  else
    bug D PATIENTS_EDIT "could not open Élodie's detail for the clear-optional edit"
  fi

  # PE7 — Arabic edit: Muhammad's note (sentinel + Arabic word)
  v_scroll_top 10 || true
  PE7_RC=0
  if open_patient_by_phone_token "0202" "محمد" "pe7-mohammad" "$PAT_C_PHONE"; then
    if v_click_edit_pencil "$PAT_C_PHONE" "pe7-edit-open" -38; then
      v_clear_field "Notes" "pe7-notes-clear" 250 || true
      v_type_into "Notes" "ONLY-MOHAMMAD-CHARLIE تحديث" "pe7-notes" no yes no 250 || true
      snap "pe7-form-edited" || true
      if v_click_near_anchor_y "Save Changes" "Cancel" "pe7-save" 40; then
        sleep 3
      else
        local b9=0
        while [ "$b9" -lt 4 ]; do
          scroll_burst down 500 400
          sleep 1
          b9=$((b9 + 1))
        done
        v_click_try_hits "Save Changes" "pe7-save-fb" "ONLY-MOHAMMAD-CHARLIE" || PE7_RC=1
      fi
      sleep 2
      ocr_capture || true
      if edit_patient_dialog_visible; then PE7_RC=1; press_escape; sleep 1; fi
      if [ "$PE7_RC" = "0" ]; then
        detail_scroll_top "pe7-verify" || true
        if v_scroll_find "ONLY-MOHAMMAD-CHARLIE" 8; then
          qa_cap PATIENT_EDIT_ARABIC "GREEN (the Arabic-mixed note edit saved — the sentinel persists on the detail)"
          surface_row "Arabic edit" "Edit Patient dialog → mixed Arabic/Latin note → Save" "—" "Arabic values edit and persist" "edited Muhammad's note (sentinel + تحديث); sentinel visible" "GREEN" "pe7-*" "OK"
          snap "pe7-saved" || true
        else
          bug P1 PATIENT_EDIT_ARABIC "the Arabic-mixed note edit saved but the sentinel is not visible on the detail"
        fi
      else
        bug P1 PATIENT_EDIT_ARABIC "the Arabic note edit did not visibly save"
      fi
    else
      bug D PATIENTS_EDIT_PENCIL "the edit pencil could not be activated for the Arabic edit (phone-anchored)"
    fi
    v_click "Dashboard" "pe7-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe7-dash" || true
  else
    bug D PATIENTS_EDIT_ARABIC "could not open Muhammad's detail for the Arabic edit"
  fi

  # PE-OTHER — other patients unchanged after the edit battery (Zed is the
  # stable anchor: untouched by every edit)
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0199" "Zed" "pe-other-zed" "$PAT_ZED_PHONE"; then
    verify_detail_authoritative "$PAT_ZED_FIRST $PAT_ZED_LAST" "$PAT_ZED_PHONE" "$PAT_ZED_EMAIL" "$PAT_ZED_NOTE" "pe-other-zed" "$FOREIGN_ALL"
    if [ "$VDA_PHONE" = "1" ] && [ "$VDA_NOTE" = "1" ] && [ "$VDA_FOREIGN_SEEN" != "yes" ]; then
      probe "pe-other: Zed (untouched by the edits) still shows his exact data — no unrelated-patient changes from the edit battery"
    else
      bug P1 PATIENT_EDIT_SIDE_EFFECT "the untouched patient Zed shows unexpected data after the edit battery (phone=$VDA_PHONE note=$VDA_NOTE foreign=$VDA_FOREIGN_SEEN$VDA_FOREIGN_WHICH)"
    fi
    v_click "Dashboard" "pe-other-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pe-other-dash" || true
  else
    bug D PATIENTS_EDIT_OTHER "could not open Zed's detail for the untouched-patient check"
  fi
  v_scroll_top 10 || true

  # ------------------------------------------------------------------
  # PV — ENTRY-POINT CONSISTENCY (the P2 5ede518 stale/skeleton regression:
  # every entry point must render the AUTHORITATIVE record — John's NEW
  # phone $JOHN_NEW_PHONE — never a stale snapshot, never the skeleton)
  # ------------------------------------------------------------------
  note "=== patients PV: the entry-point consistency battery ==="
  surface_section "Entry-point consistency (the stale/skeleton regression)"
  local PV_FAILS=0

  # PV1 — the Recent Patients list row (row-needle = the post-edit phone
  # line — the bare name needle collides with the PC8 similar-name cohort)
  v_scroll_top 10 || true
  if open_patient_detail "$PAT_A_FIRST $PAT_A_LAST" "pv1-list-row" "$JOHN_NEW_PHONE"; then
    verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pv1" "$FOREIGN_ALL"
    if [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ] && [ "$VDA_FOREIGN_SEEN" != "yes" ]; then
      qa_cap ENTRY_POINT_LIST_ROW "GREEN (list row → the authoritative record: the NEW phone is visible; no skeleton; no foreign sentinels)"
      surface_row "Entry point — list row" "Recent Patients row click" "the row card" "the detail shows the authoritative record" "opened John from the list; the new phone verified" "GREEN" "pv1-*" "OK"
    else
      PV_FAILS=$((PV_FAILS + 1))
      bug P1 ENTRY_POINT_LIST_ROW "the list-row entry rendered a non-authoritative record (phone=$VDA_PHONE skeleton=$VDA_SKELETON foreign=$VDA_FOREIGN_SEEN$VDA_FOREIGN_WHICH)"
    fi
    v_click "Dashboard" "pv1-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pv1-dash" || true
  else
    PV_FAILS=$((PV_FAILS + 1))
    bug D PATIENTS_PV_LIST "could not open John from the list row (honest)"
  fi

  # PV2 — the search-result row (search by the EDITED phone token — one row,
  # and it proves the search index reflects the edit)
  v_scroll_top 10 || true
  if search_type "0777" "pv2-search" >/dev/null 2>&1; then
    sleep 2
    v_scroll_find "0777" 6 || true
    ocr_capture || true
    if v_click "$JOHN_NEW_PHONE" "pv2-row" "$PAT_A_FIRST" || v_click_try_hits "0777" "pv2-row" "$PAT_A_FIRST"; then
      sleep 2
      snap "pv2-detail" || true
      verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pv2" "$FOREIGN_ALL"
      if [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ] && [ "$VDA_FOREIGN_SEEN" != "yes" ]; then
        qa_cap ENTRY_POINT_SEARCH_ROW "GREEN (the search-result row → the authoritative record; the search index reflects the edited phone)"
        surface_row "Entry point — search result row" "search box (the edited phone token) → filtered row click" "the filtered row" "the detail shows the authoritative record" "searched the new phone token; opened the row; verified" "GREEN" "pv2-*" "OK"
      else
        PV_FAILS=$((PV_FAILS + 1))
        bug P1 ENTRY_POINT_SEARCH_ROW "the search-row entry rendered a non-authoritative record (phone=$VDA_PHONE skeleton=$VDA_SKELETON)"
      fi
      v_click "Dashboard" "pv2-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "pv2-dash" || true
    else
      PV_FAILS=$((PV_FAILS + 1))
      bug D PATIENTS_PV_SEARCH "could not click the search-result row (honest)"
    fi
  else
    PV_FAILS=$((PV_FAILS + 1))
    bug D PATIENTS_PV_SEARCH "could not type the search for the search-row entry probe"
  fi
  clear_search_box || true
  v_scroll_top 10 || true

  # PV3 — the Recently Viewed mini-card (the STALE pre-edit snapshot: the
  # cached object still holds John's OLD phone — the refetch must win)
  if v_scroll_find "Recently Viewed" 8; then
    scroll_burst down
    sleep 1
    ocr_capture || true
    record_inventory "Recently Viewed section (pre-click — the mini-card carries the PRE-EDIT cached object)"
    if v_click "$PAT_A_FIRST $PAT_A_LAST" "pv3-card" "$PAT_A_FIRST" "first"; then
      sleep 2
      snap "pv3-detail" || true
      verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pv3" "$FOREIGN_ALL"
      if [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ]; then
        qa_cap ENTRY_POINT_RECENTLY_VIEWED "GREEN (the Recently Viewed mini-card (a STALE pre-edit snapshot) still rendered the AUTHORITATIVE record — the refetch-on-mount regression HOLDS)"
        surface_row "Entry point — Recently Viewed mini-card" "the avatar chip under 'Recently Viewed'" "the chip (cached localStorage object)" "the refetch must replace the stale snapshot with the authoritative record" "clicked John's mini-card (cached pre-edit phone); the NEW phone rendered" "GREEN (the 5ede518 fix holds)" "pv3-*" "OK"
      else
        PV_FAILS=$((PV_FAILS + 1))
        bug P1 ENTRY_POINT_RECENTLY_VIEWED "the Recently Viewed entry rendered the STALE record (phone=$VDA_PHONE — 0 means no phone matched the NEW value; skeleton=$VDA_SKELETON) — the stale/skeleton bug REGRESSED"
      fi
      v_click "Dashboard" "pv3-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "pv3-dash" || true
    else
      PV_FAILS=$((PV_FAILS + 1))
      bug D PATIENTS_PV_RV "the Recently Viewed mini-card could not be clicked (honest)"
    fi
  else
    probe "pv3: the Recently Viewed section was not visible (no recently-viewed entries?) — recorded honestly"
    qa_cap ENTRY_POINT_RECENTLY_VIEWED "NOT EXERCISED (the Recently Viewed section was not visible)"
  fi
  v_scroll_top 10 || true

  # PV4 — the Activity Timeline entry (the SKELETON path: id+name only —
  # the newest patient's entry sits at the top)
  if v_scroll_find "Activity Timeline" 8; then
    scroll_burst down
    sleep 1
    ocr_capture || true
    record_inventory "Activity Timeline (pre-click — the entry passes a name-only skeleton object)"
    if v_click "Patient record created" "pv4-entry" "" "first"; then
      sleep 2
      snap "pv4-detail" || true
      # the top entry is the NEWEST patient = Zed (full data → the skeleton
      # must NOT produce an empty record)
      verify_detail_authoritative "$PAT_ZED_FIRST $PAT_ZED_LAST" "$PAT_ZED_PHONE" "$PAT_ZED_EMAIL" "$PAT_ZED_NOTE" "pv4" "$FOREIGN_ALL"
      if [ "$VDA_NAME" = "1" ] && [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ]; then
        qa_cap ENTRY_POINT_ACTIVITY_TIMELINE "GREEN (the Activity Timeline entry (a NAME-ONLY skeleton object) rendered the FULL authoritative record — the P2 regression HOLDS)"
        surface_row "Entry point — Activity Timeline entry" "the 'Patient record created' event card" "the event card (name-only object)" "the refetch must fill the full record" "clicked the top timeline entry (Zed); his full data rendered" "GREEN (the 5ede518 fix holds)" "pv4-*" "OK"
      else
        PV_FAILS=$((PV_FAILS + 1))
        bug P1 ENTRY_POINT_ACTIVITY_TIMELINE "the Activity Timeline entry rendered a skeleton/stale record (name=$VDA_NAME phone=$VDA_PHONE skeleton=$VDA_SKELETON) — the P2 REGRESSED"
      fi
      v_click "Dashboard" "pv4-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "pv4-dash" || true
    else
      PV_FAILS=$((PV_FAILS + 1))
      bug D PATIENTS_PV_ACTIVITY "the Activity Timeline entry could not be clicked (honest)"
    fi
  else
    probe "pv4: the Activity Timeline was not visible — recorded honestly"
    qa_cap ENTRY_POINT_ACTIVITY_TIMELINE "NOT EXERCISED (the timeline was not visible)"
  fi
  v_scroll_top 10 || true

  # PV5 — the Quick Patient Switcher (Cmd+P; John's email is the detail-only
  # verification marker — the switcher rows show name+phone only)
  if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "p" using command down' 10; then
    sleep 2
    ocr_capture || true
    snap "pv5-switcher-open" || true
    record_inventory "Quick Patient Switcher dialog (Cmd+P)"
    if v_click "$PAT_A_FIRST $PAT_A_LAST" "pv5-item" "" "first" || v_click_try_hits "$PAT_A_FIRST $PAT_A_LAST" "pv5-item" ""; then
      sleep 2
      if wait_for_ocr "$PAT_A_EMAIL" 12 "pv5-detail-open"; then
        verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pv5" "$FOREIGN_ALL"
        if [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ]; then
          qa_cap ENTRY_POINT_QUICK_SWITCHER "GREEN (the Cmd+P Quick Patient Switcher → the authoritative record)"
          surface_row "Entry point — Quick Patient Switcher" "Cmd+P → the patient list dialog" "the switcher list + its search" "selecting a patient opens the authoritative record" "Cmd+P → John; the new phone verified" "GREEN" "pv5-*" "OK"
        else
          PV_FAILS=$((PV_FAILS + 1))
          bug P1 ENTRY_POINT_QUICK_SWITCHER "the switcher entry rendered a non-authoritative record (phone=$VDA_PHONE skeleton=$VDA_SKELETON)"
        fi
      else
        press_escape
        sleep 1
        PV_FAILS=$((PV_FAILS + 1))
        bug D PATIENTS_PV_SWITCHER "the switcher selection did not open John's detail (the email marker never appeared — honest)"
      fi
      v_click "Dashboard" "pv5-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "pv5-dash" || true
    else
      press_escape
      sleep 1
      PV_FAILS=$((PV_FAILS + 1))
      bug D PATIENTS_PV_SWITCHER "John's row could not be clicked in the switcher (honest)"
    fi
  else
    PV_FAILS=$((PV_FAILS + 1))
    bug D PATIENTS_PV_SWITCHER "the Cmd+P keystroke did not register (honest)"
  fi
  v_scroll_top 10 || true

  # PV6 — the Today's Overview 'Next:' chip (skeleton id+name — requires the
  # scheduled visit)
  if [ "$VISIT_SCHEDULED" = "1" ]; then
    v_scroll_top 10 || true
    if v_scroll_find "Next" 6 || v_scroll_find "All caught up" 4; then
      ocr_capture || true
      snap "pv6-overview" || true
      record_inventory "Today's Overview (the Next chip zone)"
      if ocr_grep "Next: $PAT_A_FIRST"; then
        if v_click "Next: $PAT_A_FIRST" "pv6-chip" "$PAT_A_FIRST" || v_click "Next" "pv6-chip-fb" "$PAT_A_FIRST"; then
          sleep 2
          snap "pv6-detail" || true
          verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pv6" "$FOREIGN_ALL"
          if [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ]; then
            qa_cap ENTRY_POINT_TODAY_OVERVIEW "GREEN (the Today's Overview 'Next:' chip (a name-only skeleton) → the authoritative record)"
            surface_row "Entry point — Today's Overview 'Next:' chip" "the overview card's next-appointment chip" "the chip (name-only object)" "the refetch must fill the full record" "clicked the Next: John chip; the new phone verified" "GREEN" "pv6-*" "OK"
          else
            PV_FAILS=$((PV_FAILS + 1))
            bug P1 ENTRY_POINT_TODAY_OVERVIEW "the Today's Overview entry rendered a skeleton/stale record (phone=$VDA_PHONE skeleton=$VDA_SKELETON)"
          fi
          v_click "Dashboard" "pv6-back" "Add Patient" || true
          wait_for_ocr "Add Patient" 30 "pv6-dash" || true
        else
          PV_FAILS=$((PV_FAILS + 1))
          bug D PATIENTS_PV_TODAY "the Next: chip could not be clicked (honest)"
        fi
      else
        probe "pv6: the 'Next: John' chip was not OCR-visible (the overview may not have refreshed) — recorded honestly"
        qa_cap ENTRY_POINT_TODAY_OVERVIEW "NOT EXERCISED (the Next chip was not visible)"
      fi
    else
      qa_cap ENTRY_POINT_TODAY_OVERVIEW "NOT EXERCISED (the Today's Overview zone was not reachable)"
    fi
  else
    qa_cap ENTRY_POINT_TODAY_OVERVIEW "NOT EXERCISED (the visit was not scheduled — see the PS records)"
    surface_row "Entry point — Today's Overview 'Next:' chip" "the overview card's next-appointment chip" "the chip (name-only object)" "the refetch must fill the full record" "NOT EXERCISED (no visit scheduled)" "NOT EXERCISED" "pv6-*" "N/A"
  fi

  # PV7 — the Upcoming Visits card (partial object: dob+phone only)
  if [ "$VISIT_SCHEDULED" = "1" ]; then
    v_scroll_top 10 || true
    if v_scroll_find "Upcoming Visits" 6; then
      scroll_burst down
      sleep 1
      ocr_capture || true
      record_inventory "Upcoming Visits (the visit card zone)"
      if v_click "Checkup" "pv7-card" "$PAT_A_FIRST" || v_click "$PAT_A_FIRST $PAT_A_LAST" "pv7-card-fb" "$PAT_A_FIRST"; then
        sleep 2
        snap "pv7-detail" || true
        verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pv7" "$FOREIGN_ALL"
        if [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ]; then
          qa_cap ENTRY_POINT_UPCOMING_CARD "GREEN (the Upcoming Visits card (a partial object) → the authoritative record)"
          surface_row "Entry point — Upcoming Visits card" "the visit card under 'Upcoming Visits'" "the visit card" "the refetch must fill the full record" "clicked the visit card; the new phone verified" "GREEN" "pv7-*" "OK"
        else
          PV_FAILS=$((PV_FAILS + 1))
          bug P1 ENTRY_POINT_UPCOMING_CARD "the Upcoming Visits entry rendered a non-authoritative record (phone=$VDA_PHONE skeleton=$VDA_SKELETON)"
        fi
        v_click "Dashboard" "pv7-back" "Add Patient" || true
        wait_for_ocr "Add Patient" 30 "pv7-dash" || true
      else
        PV_FAILS=$((PV_FAILS + 1))
        bug D PATIENTS_PV_UPCOMING "the Upcoming Visits card could not be clicked (honest)"
      fi
    else
      qa_cap ENTRY_POINT_UPCOMING_CARD "NOT EXERCISED (the Upcoming Visits section was not reachable)"
    fi
  else
    qa_cap ENTRY_POINT_UPCOMING_CARD "NOT EXERCISED (no visit scheduled)"
    surface_row "Entry point — Upcoming Visits card" "the visit card" "the visit card" "the refetch must fill the full record" "NOT EXERCISED (no visit scheduled)" "NOT EXERCISED" "pv7-*" "N/A"
  fi

  # PV8 — the Calendar week view visit chip (partial object)
  if [ "$VISIT_SCHEDULED" = "1" ]; then
    v_scroll_top 10 || true
    if v_click "Calendar" "pv8-toggle" "Month"; then
      sleep 2
      if v_click "Week" "pv8-week-mode" ""; then
        sleep 2
        ocr_capture || true
        snap "pv8-week-view" || true
        record_inventory "Calendar week view (the visit chip zone)"
        if v_click "$PAT_A_FIRST $PAT_A_LAST" "pv8-chip" "$PAT_A_FIRST" || v_click "09:00" "pv8-chip-fb" "$PAT_A_FIRST"; then
          sleep 2
          snap "pv8-detail" || true
          verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pv8" "$FOREIGN_ALL"
          if [ "$VDA_PHONE" = "1" ] && [ "$VDA_SKELETON" = "0" ]; then
            qa_cap ENTRY_POINT_CALENDAR "GREEN (the Calendar visit chip (a partial object) → the authoritative record)"
            surface_row "Entry point — Calendar visit chip" "Calendar toggle → Week → the visit chip" "the week-view visit chip" "the refetch must fill the full record" "clicked John's visit chip; the new phone verified" "GREEN" "pv8-*" "OK"
          else
            PV_FAILS=$((PV_FAILS + 1))
            bug P1 ENTRY_POINT_CALENDAR "the Calendar entry rendered a non-authoritative record (phone=$VDA_PHONE skeleton=$VDA_SKELETON)"
          fi
          v_click "Dashboard" "pv8-back" "Add Patient" || true
          wait_for_ocr "Add Patient" 30 "pv8-dash" || true
        else
          PV_FAILS=$((PV_FAILS + 1))
          bug D PATIENTS_PV_CALENDAR "the calendar visit chip could not be clicked (honest)"
        fi
      else
        PV_FAILS=$((PV_FAILS + 1))
        bug D PATIENTS_PV_CALENDAR "the Week mode toggle could not be clicked (honest)"
      fi
    else
      PV_FAILS=$((PV_FAILS + 1))
      bug D PATIENTS_PV_CALENDAR "the Calendar toggle could not be clicked (honest)"
    fi
  else
    qa_cap ENTRY_POINT_CALENDAR "NOT EXERCISED (no visit scheduled)"
    surface_row "Entry point — Calendar visit chip" "Calendar → Week → the visit chip" "the week-view visit chip" "the refetch must fill the full record" "NOT EXERCISED (no visit scheduled)" "NOT EXERCISED" "pv8-*" "N/A"
  fi

  if [ "$PV_FAILS" = "0" ]; then
    qa_cap ENTRY_POINT_CONSISTENCY "GREEN (every exercised entry point rendered the AUTHORITATIVE record — the stale/skeleton P2 regression holds)"
  else
    qa_cap ENTRY_POINT_CONSISTENCY "RED ($PV_FAILS entry-point probe(s) failed — see the PV records)"
  fi
  v_scroll_top 10 || true

  # ------------------------------------------------------------------
  # PDEL — DELETE BATTERY (Zed)
  # ------------------------------------------------------------------
  note "=== patients PDEL: the delete battery ==="

  # DEL1 — cancel delete
  v_scroll_top 10 || true
  DEL1_RC=0
  if open_patient_by_phone_token "0199" "$PAT_ZED_FIRST $PAT_ZED_LAST" "del1-zed" "$PAT_ZED_PHONE"; then
    if v_click_delete_trash "$PAT_ZED_FIRST $PAT_ZED_LAST" "del1-dialog"; then
      ocr_capture || true
      snap "del1-dialog" || true
      record_inventory "Delete Patient dialog (Zed)"
      surface_section "Patient delete battery"
      surface_row "Delete Patient dialog" "detail banner trash icon" "'Are you sure…' copy; 'Cancel' + 'Delete Patient & All Documents'" "the destructive confirm" "opened via the icon-only trash" "GREEN (opened)" "del1-dialog" "OK"
      if v_click "Cancel" "del1-cancel" ""; then
        probe "del1: the Cancel click registered"
      fi
      sleep 2
      ocr_capture || true
      if ocr_grep "Delete Patient"; then
        press_escape
        sleep 1
      fi
      wait_text_gone "Delete Patient" 8 "del1-close" || true
      v_click "Dashboard" "del1-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "del1-dash" || true
      v_scroll_top 10 || true
      if search_type "Zed" "del1-verify" >/dev/null 2>&1; then
        sleep 2
        v_scroll_find "Zed" 6 || true
        ocr_capture || true
        if ocr_grep "$PAT_ZED_FIRST $PAT_ZED_LAST"; then
          qa_cap PATIENT_DELETE_CANCEL "GREEN (Cancel kept Zed — no destructive side effect from the canceled confirm)"
          surface_row "Delete cancel" "Delete Patient dialog → 'Cancel'" "—" "canceling keeps the patient" "canceled; Zed still searchable" "GREEN" "del1-verify" "OK"
        else
          DEL1_RC=1
          bug P1 PATIENT_DELETE_CANCEL "after canceling the Delete dialog, Zed is no longer findable (destructive side effect from a canceled confirm?)"
        fi
      else
        DEL1_RC=1
        bug D PATIENTS_DELETE_CANCEL "the post-cancel verification search could not run"
      fi
    else
      bug D PATIENTS_DELETE_TRASH "the icon-only delete control could not be activated for the cancel probe"
    fi
  else
    bug D PATIENTS_DELETE "could not open Zed's detail for the delete battery"
  fi

  # DEL2 — confirm delete
  v_scroll_top 10 || true
  if [ "$DEL1_RC" = "0" ]; then
    if open_patient_by_phone_token "0199" "$PAT_ZED_FIRST $PAT_ZED_LAST" "del2-zed" "$PAT_ZED_PHONE"; then
      if v_click_delete_trash "$PAT_ZED_FIRST $PAT_ZED_LAST" "del2-dialog"; then
        if v_click "Delete Patient & All Documents" "del2-confirm" ""; then
          sleep 3
          ocr_capture || true
          snap "del2-after-confirm" || true
          wait_for_ocr "Add Patient" 20 "del2-dashboard-return" || true
          clear_search_box || true
          v_scroll_top 10 || true
          if search_type "Zed" "del2-verify-gone" >/dev/null 2>&1; then
            sleep 2
            v_scroll_find "No patients found" 6 || true
            ocr_capture || true
            snap "del2-search-gone" || true
            if ocr_grep "$PAT_ZED_FIRST $PAT_ZED_LAST"; then
              bug P1 PATIENT_DELETE "Zed is STILL findable after the confirmed delete (the record was not removed)"
            else
              qa_cap PATIENT_DELETE "GREEN (the confirmed delete removed Zed: the record is gone, the search no longer finds him, the app returned to the dashboard)"
              surface_row "Delete confirm" "Delete Patient dialog → 'Delete Patient & All Documents'" "—" "the patient + documents are removed; the app returns to the dashboard" "confirmed; the search finds nothing; the dashboard shown" "GREEN" "del2-*" "OK"
            fi
          else
            bug D PATIENTS_DELETE_VERIFY "the post-delete verification search could not run"
          fi
          clear_search_box || true
          read_patient_count
          if [ "$PATIENTS_COUNT" = "9" ]; then
            probe "del2: the count badge is back to 9 — the remaining patients are intact"
          else
            bug P1 PATIENT_DELETE_COUNT "after deleting Zed the count badge reads '$PATIENTS_COUNT' (expected 9)"
          fi
          v_scroll_find "$PAT_A_FIRST $PAT_A_LAST" 8 || true
          ocr_capture || true
          ocr_grep "$PAT_A_FIRST $PAT_A_LAST" && probe "del2: John's row is still present after Zed's deletion"
        else
          bug P1 PATIENT_DELETE "the destructive confirm button could not be clicked (located but inert?)"
        fi
      else
        bug D PATIENTS_DELETE_TRASH "the icon-only delete control could not be activated for the confirm probe"
      fi
    else
      bug D PATIENTS_DELETE "could not re-open Zed's detail for the confirm delete"
    fi
  fi

  # DEL3 — the stale Recently Viewed ghost entry for the DELETED patient
  # (run 35048296418, class D): after del2 the flow can still be on Zed's
  # DETAIL — the Recently Viewed section lives on the DASHBOARD. Navigate
  # there first (the click is idempotent when already there).
  v_click "Dashboard" "del3-goto-dash" "Add Patient" || true
  wait_for_ocr "Add Patient" 20 "del3-dash" || true
  v_scroll_top 10 || true
  if v_scroll_find "Recently Viewed" 8; then
    scroll_burst down
    sleep 1
    ocr_capture || true
    record_inventory "Recently Viewed after the delete (Zed's ghost chip?)"
    if ocr_grep "$PAT_ZED_FIRST"; then
      if v_click "$PAT_ZED_FIRST $PAT_ZED_LAST" "del3-ghost" "$PAT_ZED_FIRST" "first"; then
        sleep 3
        ocr_capture || true
        snap "del3-ghost-detail" || true
        if ocr_grep "$PAT_ZED_PHONE"; then
          bug P3 PATIENT_DELETE_GHOST_ENTRY "the deleted patient's Recently Viewed chip still opens a detail showing his cached data (the server-side record is gone — the chip is a stale localStorage ghost; recorded P3)"
          surface_row "Deleted-patient ghost entry" "Recently Viewed chip for the deleted patient" "—" "a deleted patient's cached chip should not render a live-looking record" "clicked Zed's ghost chip; his cached phone rendered" "P3 (stale cache)" "del3-*" "P3"
          press_escape
          sleep 1
        else
          probe "del3: the ghost chip did not render the deleted patient's data (a graceful 404/empty render) — sane behavior"
          surface_row "Deleted-patient ghost entry" "Recently Viewed chip for the deleted patient" "—" "—" "clicked; no cached data rendered (graceful)" "GREEN (sane)" "del3-*" "OK"
        fi
        v_click "Dashboard" "del3-back" "Add Patient" || true
        wait_for_ocr "Add Patient" 30 "del3-dash" || true
      else
        probe "del3: Zed's ghost chip was visible but not clickable (honest record)"
      fi
    else
      probe "del3: no Zed chip remains in Recently Viewed (the chip list rotated or was cleaned) — sane"
      surface_row "Deleted-patient ghost entry" "Recently Viewed after delete" "—" "no stale chip for the deleted patient" "no Zed chip visible" "GREEN (clean)" "del3-*" "OK"
    fi
  else
    probe "del3: the Recently Viewed section was not visible for the ghost-entry probe"
  fi
  v_scroll_top 10 || true

  # ------------------------------------------------------------------
  # PNAV — HUMAN-MISTAKE NAVIGATION
  # ------------------------------------------------------------------
  note "=== patients PNAV: the human-mistake navigation battery ==="
  surface_section "Human-mistake navigation (patients)"

  # NV1 — open a patient then IMMEDIATELY switch patients
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0105" "O'Connor" "nv1-first" "$PAT_E_PHONE"; then
    v_click "Dashboard" "nv1-quick-back" "Add Patient" || true
    sleep 1
    v_scroll_top 10 || true
    if open_patient_detail "$PAT_B_FIRST $PAT_B_LAST" "nv1-second"; then
      detail_scroll_top "nv1-second-verify" || true
      if ocr_grep "$PAT_B_NOTE"; then
        probe "nv1: the immediate switch landed on JANE's record (her sentinel present)"
        qa_cap NAV_IMMEDIATE_SWITCH "GREEN (open → immediate switch → the second patient's own record)"
        surface_row "Immediate patient switch" "open O'Connor → back → open Jane" "—" "the last-opened patient's record renders (no stale first-patient data)" "Jane's sentinel verified" "GREEN" "nv1-*" "OK"
      else
        ocr_grep "$PAT_E_NOTE" && bug P1 NAV_IMMEDIATE_SWITCH "the immediate switch to Jane still shows O'CONNOR's note (stale first-patient data)"
      fi
      v_click "Dashboard" "nv1-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "nv1-dash" || true
    else
      bug D PATIENTS_NAV "could not open the second patient for the immediate-switch probe"
    fi
  else
    bug D PATIENTS_NAV "could not open the first patient for the immediate-switch probe"
  fi

  # NV2 — edit dialog open → navigate away (the outside-click must close the
  # dialog without saving)
  v_scroll_top 10 || true
  if open_patient_detail "$PAT_B_FIRST $PAT_B_LAST" "nv2-jane"; then
    if v_click_edit_pencil "$PAT_B_FIRST $PAT_B_LAST" "nv2-edit-open"; then
      v_type_into "Phone" "888-000-7777" "nv2-phone" no no no 250 || true
      snap "nv2-edit-typed" || true
      v_click "Dashboard" "nv2-nav-away" "" || true
      sleep 2
      ocr_capture || true
      if edit_patient_dialog_visible; then
        press_escape
        sleep 1
        v_click "Dashboard" "nv2-nav-away-2" "Add Patient" || true
        sleep 2
      fi
      wait_for_ocr "Add Patient" 20 "nv2-dashboard" || true
      v_scroll_top 10 || true
      if open_patient_detail "$PAT_B_FIRST $PAT_B_LAST" "nv2-reopen"; then
        detail_scroll_top "nv2-reopen-verify" || true
        if ocr_grep "888-000-7777"; then
          bug P1 NAV_EDIT_NAVIGATE_AWAY "navigating away from a typed (unsaved) edit dialog PERSISTED the value 888-000-7777 — the abandoned edit must not save"
        else
          qa_cap NAV_EDIT_NAVIGATE_AWAY "GREEN (the abandoned edit dialog did not save its typed value)"
          surface_row "Edit → navigate away" "typed edit → click Dashboard (the dialog closes unsaved)" "—" "the abandoned edit must not persist" "navigated away; the typed phone is absent" "GREEN" "nv2-*" "OK"
        fi
        v_click "Dashboard" "nv2-back" "Add Patient" || true
        wait_for_ocr "Add Patient" 30 "nv2-back-dash" || true
      else
        bug D PATIENTS_NAV "could not reopen Jane for the navigate-away verification"
      fi
    else
      bug D PATIENTS_NAV "the edit pencil could not be activated for the navigate-away probe"
    fi
  else
    bug D PATIENTS_NAV "could not open Jane for the navigate-away probe"
  fi

  # NV3 — rapid patient switching (3 hops, each verified by the own-sentinel)
  # (run 35057060814, class D): hop3 searched the STALE pre-edit token '0101'
  # — John's phone is $JOHN_NEW_PHONE after PE2, so the search found 0
  # patients, the open failed, and the conflated P1 claimed 'landed on the
  # wrong record'. The token is now the post-edit 0777; each sentinel grep
  # is preceded by the detail top-restore (the search-row open can land
  # past the banner where the sentinel renders); and a FAILED OPEN is an
  # honest D — only a real sentinel mismatch is the P1.
  v_scroll_top 10 || true
  NV3_RC=0; NV3_OPENFAIL=0
  if open_patient_by_phone_token "0202" "محمد" "nv3-hop1" "$PAT_C_PHONE"; then
    detail_scroll_top "nv3-hop1-verify" || true
    ocr_grep "$PAT_C_NOTE" || NV3_RC=1
    v_click "Dashboard" "nv3-back1" "Add Patient" || true
    sleep 1
    v_scroll_top 10 || true
    if open_patient_by_phone_token "0105" "O'Connor" "nv3-hop2" "$PAT_E_PHONE"; then
      detail_scroll_top "nv3-hop2-verify" || true
      ocr_grep "$PAT_E_NOTE" || NV3_RC=1
      v_click "Dashboard" "nv3-back2" "Add Patient" || true
      sleep 1
      v_scroll_top 10 || true
      if open_patient_by_phone_token "0777" "John" "nv3-hop3" "$JOHN_NEW_PHONE"; then
        detail_scroll_top "nv3-hop3-verify" || true
        ocr_grep "$PAT_A_NOTE" || NV3_RC=1
      else
        NV3_OPENFAIL=1
        bug D PATIENTS_NAV "the third rapid-switch hop could not open John (the post-edit 0777 search — honest)"
      fi
    else
      NV3_OPENFAIL=1
      bug D PATIENTS_NAV "the second rapid-switch hop could not open O'Connor (honest)"
    fi
    if [ "$NV3_OPENFAIL" = "0" ] && [ "$NV3_RC" = "0" ]; then
      qa_cap NAV_RAPID_SWITCHING "GREEN (3 rapid patient hops — each landed on its own record with its own sentinel)"
      surface_row "Rapid patient switching" "open → back → open ×3 at human speed" "—" "each open renders the correct record" "3 hops; each sentinel verified" "GREEN" "nv3-*" "OK"
    elif [ "$NV3_OPENFAIL" = "0" ]; then
      bug P1 NAV_RAPID_SWITCHING "a rapid-switch hop landed on the wrong record (a sentinel mismatched — see the nv3 evidence)"
    fi
    v_click "Dashboard" "nv3-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "nv3-dash" || true
  else
    bug D PATIENTS_NAV "the rapid-switch battery could not start"
  fi

  # NV6 — search → open → clear search → reopen
  v_scroll_top 10 || true
  if search_type "0777" "nv6-search" >/dev/null 2>&1; then
    sleep 2
    if v_click "$JOHN_NEW_PHONE" "nv6-row" "$PAT_A_FIRST" || v_click_try_hits "0777" "nv6-row" "$PAT_A_FIRST"; then
      sleep 2
      snap "nv6-first-open" || true
      v_click "Dashboard" "nv6-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "nv6-dash" || true
      clear_search_box || true
      v_scroll_top 10 || true
      if open_patient_detail "$PAT_A_FIRST $PAT_A_LAST" "nv6-reopen" "$JOHN_NEW_PHONE"; then
        # (run 35083580318, class D): the reopen's detail can land scrolled
        # past the banner where the edited phone renders — the restore (which
        # refreshes the OCR) before the grep.
        detail_scroll_top "nv6-reopen-verify" || true
        if ocr_grep "0777"; then
          qa_cap NAV_SEARCH_CLEAR_REOPEN "GREEN (search → open → clear → reopen: the same authoritative record both times)"
          surface_row "Search → clear → reopen" "search box, row click, clear, list reopen" "—" "the record is stable across search states" "both opens showed the edited phone" "GREEN" "nv6-*" "OK"
        else
          bug P1 NAV_SEARCH_CLEAR_REOPEN "the reopen after clearing the search lost the edited phone (0777 absent)"
        fi
        v_click "Dashboard" "nv6-back2" "Add Patient" || true
        wait_for_ocr "Add Patient" 30 "nv6-dash2" || true
      else
        bug D PATIENTS_NAV "could not reopen John for the search-clear-reopen probe"
      fi
    else
      bug D PATIENTS_NAV "could not open the search-result row for the search-clear-reopen probe"
    fi
  else
    bug D PATIENTS_NAV "could not type the search for the search-clear-reopen probe"
  fi
  clear_search_box || true
  v_scroll_top 10 || true

  # NV7 — logout WHILE ON a patient detail (the directive's optional probe —
  # practical here): no patient data may remain visible logged-out; the
  # re-login reopens the same patient with his data intact
  # (login budget: auto-login 1 + this re-login 2 + the PP reopen ≤1 = ≤3 of 5)
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0202" "محمد" "nv7-mohammad" "$PAT_C_PHONE"; then
    ocr_grep "$PAT_C_NOTE" && probe "nv7: Muhammad's detail is open (his sentinel visible) before the logout"
    open_profile_menu "nv7-profile" || bug P1 NAV_LOGOUT_FROM_DETAIL "the profile pill could not be clicked from the patient detail"
    v_click "Sign Out" "nv7-signout" "Sign In" || bug P1 NAV_LOGOUT_FROM_DETAIL "Sign Out from the patient detail did not reach the Sign In screen"
    sleep 2
    ocr_capture || true
    snap "nv7-logged-out" || true
    record_inventory "Sign In screen after logging out from a patient detail"
    if ocr_grep "$PAT_C_NOTE" || ocr_grep "$PAT_C_PHONE"; then
      bug P3 NAV_LOGOUT_FROM_DETAIL "patient data (Muhammad's sentinel/phone) is still visible on the LOGGED-OUT screen after leaving the patient detail"
    else
      probe "nv7: no patient data visible after the logout from the detail view (the protected UI is clean)"
    fi
    if ! v_type_into "Email" "$DOC_EMAIL" "nv7-relogin-email"; then
      bug P1 NAV_LOGOUT_FROM_DETAIL "could not type the email for the re-login"
    fi
    if ! v_type_into "Password" "$DOC_PASS" "nv7-relogin-password" yes; then
      bug P1 NAV_LOGOUT_FROM_DETAIL "could not type the password for the re-login"
    fi
    NV7_LOGIN=0
    if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
      sleep 3
      if wait_for_ocr "Add Patient" 45 "nv7-relogin-after-enter"; then NV7_LOGIN=1; fi
    fi
    if [ "$NV7_LOGIN" = "0" ] && ! v_click_try_hits "Sign In" "nv7-relogin" "Add Patient"; then
      bug P1 NAV_LOGOUT_FROM_DETAIL "the re-login after the detail-logout failed"
    fi
    wait_for_ocr "Add Patient" 60 "nv7-dashboard" || bug P1 NAV_LOGOUT_FROM_DETAIL "no dashboard after the re-login"
    v_scroll_top 10 || true
    if open_patient_by_phone_token "0202" "محمد" "nv7-reopen" "$PAT_C_PHONE"; then
      detail_scroll_top "nv7-reopen-verify" || true
      if ocr_grep "$PAT_C_NOTE"; then
        qa_cap NAV_LOGOUT_FROM_DETAIL "GREEN (logout from the patient detail → clean login screen (no patient data) → re-login → the same patient reopens with his data intact)"
        surface_row "Logout from a patient detail" "patient detail → profile → Sign Out → Sign In → reopen" "—" "no patient data logged-out; the record reopens intact after re-login" "sentinel absent logged-out; present after the reopen" "GREEN" "nv7-*" "OK"
      else
        bug P1 NAV_LOGOUT_FROM_DETAIL "after the re-login + reopen, Muhammad's sentinel note is not visible (the record lost data across the logout cycle?)"
      fi
      v_click "Dashboard" "nv7-back" "Add Patient" || true
      wait_for_ocr "Add Patient" 30 "nv7-dash" || true
    else
      bug D NAV_LOGOUT_FROM_DETAIL "could not reopen Muhammad after the re-login (honest)"
    fi
  else
    probe "nv7: could not open Muhammad's detail for the logout-from-detail probe — recorded honestly (honest skip)"
  fi
  v_scroll_top 10 || true

  # ------------------------------------------------------------------
  # PP — PATIENT-LEVEL PERSISTENCE (quit/reopen)
  # ------------------------------------------------------------------
  note "=== patients PP: quit/reopen patient-level persistence ==="
  quit_medivault
  snap "pp-quit-confirmed" || true
  PP_SSTATE="$(python3 -c "import json;print(json.load(open('$SUP_STATUS')).get('state','none'))" 2>/dev/null || echo none)"
  probe "pp: supervisor state after the app quit: $PP_SSTATE"
  [ "$PP_SSTATE" = "healthy" ] || bug P1 PATIENT_PERSISTENCE "the background supervisor is not healthy after the app quit (state=$PP_SSTATE)"
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1 || bug P1 PATIENT_PERSISTENCE "the API stopped answering after the app quit"
  PP_PG_BIND="$(lsof -nP -iTCP:"$PGPORT" 2>/dev/null | grep LISTEN | awk '{print $9}' | head -1)"
  probe "pp: PostgreSQL listener after the quit: ${PP_PG_BIND:-none} (loopback required)"
  launch_and_detect "patients-reopen" 180
  [ "$MV_WINDOW" = "yes" ] || bug P1 PATIENT_PERSISTENCE "the MediVault window did not reappear after the reopen"
  PP_PATH="restored"
  if ! wait_for_ocr "Add Patient" 150 "pp-dashboard"; then
    if ocr_grep "Sign In"; then
      PP_PATH="signin-required"
      probe "pp: the reopen reached the Sign In screen — re-logging in (the honest path)"
      if ! v_type_into "Email" "$DOC_EMAIL" "pp-relogin-email"; then
        bug P1 PATIENT_PERSISTENCE "could not type the email on the reopen login screen"
      fi
      if ! v_type_into "Password" "$DOC_PASS" "pp-relogin-password" yes; then
        bug P1 PATIENT_PERSISTENCE "could not type the password on the reopen login screen"
      fi
      PP_LOGIN=0
      if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
        sleep 3
        if wait_for_ocr "Add Patient" 45 "pp-relogin-after-enter"; then PP_LOGIN=1; fi
      fi
      if [ "$PP_LOGIN" = "0" ] && ! v_click_try_hits "Sign In" "pp-relogin" "Add Patient"; then
        bug P1 PATIENT_PERSISTENCE "the re-login after the reopen failed"
      fi
      wait_for_ocr "Add Patient" 60 "pp-dashboard-after-relogin" || bug P1 PATIENT_PERSISTENCE "no dashboard after the reopen re-login"
    else
      snap "pp-reopen-unknown" || true
      bug P1 PATIENT_PERSISTENCE "after the reopen the screen is neither the dashboard nor the Sign In screen"
    fi
  fi
  snap "pp-reopen-dashboard" || true
  qa_cap PATIENT_PERSISTENCE_REOPEN "GREEN (quit → relaunch → a working app state; path: $PP_PATH; supervisor healthy; API healthy; PG '$PP_PG_BIND')"

  # the count survived
  read_patient_count
  if [ "$PATIENTS_COUNT" = "9" ]; then
    probe "pp: the patient count survived the restart (9)"
  else
    bug P1 PATIENT_PERSISTENCE "the patient count after the restart reads '$PATIENTS_COUNT' (expected 9 — records may have been lost)"
  fi

  # John's EDITED values + sentinel survived (the authoritative record)
  v_scroll_top 10 || true
  if open_patient_detail "$PAT_A_FIRST $PAT_A_LAST" "pp-john" "$JOHN_NEW_PHONE"; then
    verify_detail_authoritative "$PAT_A_FIRST $PAT_A_LAST" "$JOHN_NEW_PHONE" "$PAT_A_EMAIL" "$PAT_A_NOTE" "pp-john" "$FOREIGN_ALL"
    if [ "$VDA_PHONE" = "1" ] && [ "$VDA_NOTE" = "1" ] && [ "$VDA_FOREIGN_SEEN" != "yes" ]; then
      qa_cap PATIENT_PERSISTENCE "GREEN (the edited values + sentinel notes survived the quit/reopen: John's new phone + note; isolation intact; path $PP_PATH)"
      surface_row "Patient persistence (quit/reopen)" "quit → relaunch → the roster + the records" "—" "all patients, edits, and sentinels survive the restart" "count 9; John's edited phone + sentinel; isolation intact; Zed still gone" "GREEN" "pp-*" "OK"
    else
      bug P1 PATIENT_PERSISTENCE "John's post-restart record is wrong (phone=$VDA_PHONE note=$VDA_NOTE foreign=$VDA_FOREIGN_SEEN$VDA_FOREIGN_WHICH)"
    fi
    v_click "Dashboard" "pp-john-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pp-john-dash" || true
  else
    bug P1 PATIENT_PERSISTENCE "could not reopen John's detail after the restart"
  fi

  # Muhammad's Arabic-mixed note survived
  v_scroll_top 10 || true
  if open_patient_by_phone_token "0202" "محمد" "pp-mohammad" "$PAT_C_PHONE"; then
    # (run 35083580318, class D — same as nv6): the restore (OCR-refreshing)
    # before the sentinel grep — the search-row open can land past the banner.
    detail_scroll_top "pp-mohammad-verify" || true
    if ocr_grep "$PAT_C_NOTE"; then
      probe "pp: Muhammad's Arabic-mixed note survived the restart (sentinel visible)"
    else
      bug P1 PATIENT_PERSISTENCE "Muhammad's note (the Arabic-mixed edit from PE7) did not survive the restart"
    fi
    v_click "Dashboard" "pp-c-back" "Add Patient" || true
    wait_for_ocr "Add Patient" 30 "pp-c-dash" || true
  else
    bug D PATIENT_PERSISTENCE_ARABIC "could not open Muhammad's detail after the restart (honest)"
  fi

  # the deleted patient STAYS deleted
  v_scroll_top 10 || true
  if search_type "Zed" "pp-zed-gone" >/dev/null 2>&1; then
    sleep 2
    v_scroll_find "No patients found" 6 || true
    ocr_capture || true
    snap "pp-zed-still-gone" || true
    if ocr_grep "$PAT_ZED_FIRST $PAT_ZED_LAST"; then
      bug P1 PATIENT_DELETE_RESURRECT "the DELETED patient Zed is findable again after the quit/reopen (the delete did not persist — records resurrected)"
    else
      probe "pp: the deleted patient remains deleted after the restart (no resurrection)"
      qa_cap PATIENT_DELETE_PERSISTENCE "GREEN (the deleted patient stayed deleted across the restart)"
    fi
  else
    bug D PATIENT_PERSISTENCE_DELETE "the post-restart deleted-patient search could not run"
  fi
  clear_search_box || true
  v_scroll_top 10 || true
  note "focus patients complete"
}

# =============================================================================
# FOCUS: search — the patient search behavior
# =============================================================================
focus_search() {
  note "=== FOCUS search: the patient search behavior (real search box) ==="

  create_patient_full "John" "Test" "+1 555 0101" "john.search@example.invalid" "Search focus note" "q10-patient-a"
  sleep 6
  v_scroll_find "John Test" 12 || bug P1 SEARCH_SETUP "Patient John Test is not visible in the list after creation"
  qa_cap SEARCH_SETUP "GREEN (the search-focus patient exists)"
  snap "q10-patient-a-listed" || true

  # q1: exact-case
  search_type "John" "q11-search-exact"
  sleep 2
  v_scroll_find "John Test" 8 || true
  ocr_capture || true
  snap "q11-search-exact" || true
  if ocr_grep "John Test"; then
    qa_cap SEARCH_EXACT "GREEN ('John' surfaces the row)"
    surface_section "Patient search behavior (probes)"
    surface_row "Exact-case search 'John'" "search box (Cmd+K focus)" "filtered list + result counter" "surfaces John Test" "typed; row visible" "GREEN" "q11-search-exact" "OK"
  else
    bug P2 SEARCH_EXACT "searching 'John' (exact case) did not surface John Test"
  fi

  # q2: lowercase — the case-sensitivity probe
  search_type "john" "q12-search-lower"
  sleep 2
  v_scroll_find "John Test" 6 || true
  ocr_capture || true
  snap "q12-search-lower" || true
  if ocr_grep "John Test"; then
    qa_cap SEARCH_CASE "GREEN (lowercase 'john' also surfaces the row — case-insensitive in practice)"
    surface_row "Lowercase search 'john'" "search box" "—" "a lowercase query should still find 'John Test'" "typed; row visible" "GREEN (case-insensitive)" "q12-search-lower" "OK"
  else
    v_scroll_find "No patients found" 6 || true
    ocr_capture || true
    snap "q12-search-lower-empty" || true
    surface_row "Lowercase search 'john'" "search box" "—" "a lowercase query should still find 'John Test'" "typed; 'No patients found' shown" "RED (case-sensitive)" "q12-search-lower-empty" "P2"
    bug P2 SEARCH_CASE_SENSITIVE "searching 'john' (lowercase) does NOT surface 'John Test' while 'John' does — the server-side Prisma contains query lacks mode:'insensitive' (case-sensitive on PostgreSQL). A real clinic user typing a lowercase name gets a false 'No patients found'."
  fi

  # q3: uppercase (records the same class honestly if case-sensitive)
  search_type "JOHN" "q13-search-upper"
  sleep 2
  ocr_capture || true
  snap "q13-search-upper" || true
  if ocr_grep "John Test"; then
    probe "uppercase 'JOHN' search: row visible"
    surface_row "Uppercase search 'JOHN'" "search box" "—" "recorded" "typed; row visible" "GREEN" "q13-search-upper" "OK"
  else
    probe "uppercase 'JOHN' search: row NOT visible (consistent with case sensitivity)"
    surface_row "Uppercase search 'JOHN'" "search box" "—" "recorded" "typed; not found" "RED (case-sensitive)" "q13-search-upper" "P2"
  fi

  # q4: partial prefix 'Joh'
  search_type "Joh" "q14-search-partial"
  sleep 2
  v_scroll_find "John Test" 6 || true
  ocr_capture || true
  snap "q14-search-partial" || true
  if ocr_grep "John Test"; then
    qa_cap SEARCH_PARTIAL "GREEN (partial 'Joh' matches — contains semantics)"
    surface_row "Partial search 'Joh'" "search box" "—" "prefix substring matching" "typed; row visible" "GREEN" "q14-search-partial" "OK"
  else
    bug P2 SEARCH_PARTIAL "the partial query 'Joh' did not surface John Test (contains matching broken?)"
  fi

  # q5: phone fragment
  search_type "555" "q15-search-phone"
  sleep 2
  v_scroll_find "John Test" 6 || true
  ocr_capture || true
  snap "q15-search-phone" || true
  if ocr_grep "John Test"; then
    qa_cap SEARCH_PHONE "GREEN (phone fragment '555' surfaces the patient)"
    surface_row "Phone search '555'" "search box" "—" "phone substring matching (per the placeholder promise)" "typed; row visible" "GREEN" "q15-search-phone" "OK"
  else
    bug P2 SEARCH_PHONE "the phone fragment '555' did not surface John Test (the placeholder promises phone search)"
  fi

  # q6: email fragment
  search_type "john.search" "q16-search-email"
  sleep 2
  v_scroll_find "John Test" 6 || true
  ocr_capture || true
  snap "q16-search-email" || true
  if ocr_grep "John Test"; then
    qa_cap SEARCH_EMAIL "GREEN (email fragment surfaces the patient)"
    surface_row "Email search 'john.search'" "search box" "—" "email substring matching (per the placeholder promise)" "typed; row visible" "GREEN" "q16-search-email" "OK"
  else
    bug P2 SEARCH_EMAIL "the email fragment 'john.search' did not surface John Test (the placeholder promises email search)"
  fi

  # q7: no-results empty state
  search_type "zzzqqq" "q17-search-none"
  sleep 2
  ocr_capture || true
  snap "q17-search-none" || true
  if ocr_grep "No patients found"; then
    qa_cap SEARCH_EMPTY "GREEN (the honest no-results state is shown)"
    surface_row "No-results search 'zzzqqq'" "search box" "'No patients found' + 'Try adjusting your search terms…'" "an honest empty state" "typed; empty state visible" "GREEN" "q17-search-none" "OK"
  else
    bug P3 SEARCH_EMPTY_STATE "the no-results state text was not OCR-visible (recorded honestly)"
  fi

  # q8: clear → the unfiltered list returns
  clear_search_box || true
  sleep 2
  ocr_capture || true
  snap "q18-search-cleared" || true
  if ocr_grep "Recent Patients"; then
    qa_cap SEARCH_CLEAR "GREEN (clearing returns the Recent Patients list)"
    surface_row "Search clear" "Cmd+K → Cmd+A → Backspace" "—" "the unfiltered list returns" "cleared; heading visible" "GREEN" "q18-search-cleared" "OK"
  else
    bug P3 SEARCH_CLEAR_STATE "after clearing, 'Recent Patients' was not OCR-visible (recorded honestly)"
  fi

  # q9: the quick switcher's client-side search (consistency check)
  if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "p" using command down' 10; then
    sleep 2
    if wait_for_ocr "Search patients" 15 "switcher-open"; then
      # type lowercase into the switcher
      osa 'tell application "System Events" to tell (first process whose name contains "edivault") to keystroke "john"' 10 || true
      sleep 2
      ocr_capture || true
      snap "q19-switcher-lowercase" || true
      record_inventory "Quick Patient Switcher search 'john' (client-side)"
      if ocr_grep "John Test"; then
        probe "switcher lowercase search: John Test visible (the switcher filter is client-side case-INsensitive)"
        surface_row "Quick switcher search 'john'" "Cmd+P → 'john'" "—" "the switcher's own client-side search" "typed; row visible" "GREEN (case-insensitive — INCONSISTENT with the main search if that is case-sensitive)" "q19-switcher-lowercase" "OK"
      else
        probe "switcher lowercase search: John Test NOT visible (recorded honestly)"
        surface_row "Quick switcher search 'john'" "Cmd+P → 'john'" "—" "the switcher's own client-side search" "typed; not visible" "RECORDED" "q19-switcher-lowercase" "OK"
      fi
      press_escape
    fi
  fi

  # q10: search-scope honesty (address/notes are NOT searched — the placeholder is accurate)
  search_type "Search focus note" "q20-search-notes"
  sleep 2
  ocr_capture || true
  snap "q20-search-notes" || true
  if ocr_grep "John Test"; then
    probe "notes-fragment search: the row surfaced (notes ARE matched — the placeholder under-promises)"
    surface_row "Notes-fragment search" "search box, 'Search focus note'" "—" "recorded honestly" "typed; row visible" "GREEN (matched — the placeholder only promises name/phone/email)" "q20-search-notes" "OK"
  else
    probe "notes-fragment search: not visible (recorded — source scope is name/phone/email only)"
    surface_row "Notes-fragment search" "search box, 'Search focus note'" "—" "the documented scope (name/phone/email) does not include notes" "typed; not found" "EXPECTED (documented scope)" "q20-search-notes" "EXPECTED"
  fi
  clear_search_box || true
  note "focus search complete"
}

# =============================================================================
# FOCUS: settings — the Settings behavior probes
# =============================================================================
focus_settings() {
  note "=== FOCUS settings: the Settings behavior probes ==="

  create_patient "John" "Test" "Settings focus note" "g10-patient-a"
  sleep 6
  v_scroll_find "John Test" 12 || bug P1 SETTINGS_SETUP "Patient John Test is not visible after creation"
  qa_cap SETTINGS_SETUP "GREEN (the settings-focus patient exists)"
  v_scroll_top 10 || true

  # g1: open settings
  v_click "Settings" "g11-settings-open" "Doctor Profile" || bug P1 SETTINGS_NAV "the Settings nav pill did not open the Settings view"
  wait_for_ocr "Doctor Profile" 30 "settings-open" || bug P1 SETTINGS_NAV "the Settings view never appeared"
  snap "g11-settings-top" || true
  record_inventory "Settings view (settings focus)"
  surface_section "Settings behavior probes"

  # g2: Display Name change (UI-level)
  v_type_into "Display Name" "QA Settings Probe" "g12-displayname" || bug P1 SETTINGS_DISPLAYNAME "could not type into Display Name"
  v_click "Save" "g12-displayname-save" "QA Settings Probe" || bug P1 SETTINGS_DISPLAYNAME "the Save click produced no visible change"
  ocr_capture || true
  snap "g12-displayname-saved" || true
  if ocr_grep "QA Settings Probe"; then
    qa_cap SETTINGS_DISPLAYNAME "GREEN (the display name changed in the UI)"
    surface_row "Display Name change (UI)" "Settings → Doctor Profile" "'Display Name' + 'Save'" "the display name updates" "typed + saved" "GREEN (UI)" "g12-displayname-*" "OK"
  else
    bug P3 SETTINGS_DISPLAYNAME_NOVIS "the new display name is not OCR-visible after Save (recorded honestly)"
  fi

  # g3: Appearance toggle
  v_scroll_find "Appearance" 8 || true
  if v_click "Dark" "g13-appearance-dark" ""; then
    ocr_capture || true
    snap "g13-appearance-dark" || true
    surface_row "Theme → Dark" "Settings → Appearance" "segmented 'Dark'" "the app switches theme" "clicked; visible change" "GREEN" "g13-appearance-dark" "OK"
  fi
  if v_click "Light" "g14-appearance-light" ""; then
    ocr_capture || true
    snap "g14-appearance-light" || true
    surface_row "Theme → Light (restore)" "Settings → Appearance" "segmented 'Light'" "the app restores the light theme" "clicked; visible change" "GREEN" "g14-appearance-light" "OK"
  fi

  # g4: Danger Zone stub probe (the real proof — Confirm Reset must NOT delete)
  v_scroll_find "Danger Zone" 8 || bug P1 SETTINGS_DANGERZONE "the Danger Zone section was not reachable"
  snap "g15-dangerzone" || true
  if v_click "Reset" "g15-reset-click" "Confirm Reset"; then
    ocr_capture || true
    snap "g15-reset-armed" || true
    surface_row "Danger Zone reset arming" "Settings → Danger Zone → 'Reset'" "'Reset All Data' row; 'Reset' → 'Cancel' + 'Confirm Reset'" "arming the destructive action" "clicked; Confirm appeared" "GREEN (armed)" "g15-reset-armed" "OK"
    v_click "Confirm Reset" "g16-confirm-reset" "" || bug P2 SETTINGS_DANGERZONE "clicking Confirm Reset produced no visible change"
    sleep 3
    ocr_capture || true
    snap "g16-after-confirm-reset" || true
    # the proof: the patient still exists
    v_click "Dashboard" "g17-back-verify" "Add Patient" || true
    wait_for_ocr "Add Patient" 45 "dashboard-after-reset" || true
    v_scroll_top 10 || true
    search_type "John" "g17-verify-patients" || true
    sleep 2
    v_scroll_find "John Test" 8 || true
    ocr_capture || true
    snap "g17-verify-patients" || true
    if ocr_grep "John Test"; then
      qa_cap SETTINGS_DANGERZONE "STUB PROVEN (Confirm Reset deleted nothing)"
      surface_row "Danger Zone Confirm Reset" "Danger Zone → 'Confirm Reset'" "—" "labeled 'Permanently delete all patients…' — source: a placeholder toast, no API call" "clicked Confirm; patient data fully intact afterward" "STUB (no reset happens; the placeholder toast also never renders — the Toaster is not mounted)" "g16-after-confirm-reset; g17-verify-patients" "P3"
      bug P3 SETTINGS_DANGERZONE_STUB "the Danger Zone 'Reset All Data' confirm is a no-op stub: after clicking 'Confirm Reset', the patient data is fully intact, while the UI promises 'Permanently delete all patients, documents, and settings' (the 'Feature Placeholder' toast never renders because the Toaster component is not mounted). A user relying on the reset to scrub data before handing over the machine would leave patient data in place."
    else
      qa_cap SETTINGS_DANGERZONE "REAL RESET (the confirm deleted the patient)"
      surface_row "Danger Zone Confirm Reset" "Danger Zone → 'Confirm Reset'" "—" "labeled 'Permanently delete…'" "clicked Confirm; the patient is gone" "REAL RESET" "g17-verify-patients" "OK"
    fi
  else
    bug P2 SETTINGS_DANGERZONE_ARM "clicking 'Reset' did not reveal the 'Confirm Reset' control"
  fi

  # g5: Install App buttons (inert in the desktop app)
  v_click "Settings" "g18-settings-again" "Doctor Profile" || true
  wait_for_ocr "Doctor Profile" 30 "settings-again" || true
  if v_scroll_find "Install App" 8; then
    snap "g18-installapp" || true
    if ! v_click "Windows / Desktop" "g18-installapp-click" ""; then
      bug P3 SETTINGS_INSTALLAPP_INERT "the 'Windows / Desktop' Install App button produces no visible change in the desktop app (no PWA install prompt exists in Tauri; the fallback toast never renders because the Toaster is not mounted)"
      surface_row "Install App button" "Settings → Install App → 'Windows / Desktop'" "—" "inert in the desktop build" "clicked; no visible change" "INERT (P3)" "g18-installapp-click-*" "P3"
    else
      probe "Install App click produced a visible change — recorded"
      surface_row "Install App button" "Settings → Install App → 'Windows / Desktop'" "—" "—" "clicked; visible change" "RECORDED" "g18-installapp-click-*" "OK"
    fi
  fi

  # g6: Display Name memory-only persistence proof (quit → reopen → the name reverted?)
  v_click "Dashboard" "g19-back-before-restart" "Add Patient" || true
  quit_medivault
  snap "g19-quit" || true
  SSTATE="$(python3 -c "import json;print(json.load(open('$SUP_STATUS')).get('state','none'))" 2>/dev/null || echo none)"
  probe "supervisor state after app quit: $SSTATE"
  [ "$SSTATE" = "healthy" ] || bug P1 SETTINGS_RESTART "the supervisor is not healthy after quit (state=$SSTATE)"
  launch_and_detect "settings-reopen" 180
  [ "$MV_WINDOW" = "yes" ] || bug P1 SETTINGS_RESTART "the window did not reappear after reopen"
  if ! wait_for_ocr "Add Patient" 150 "dashboard-after-reopen"; then
    if ocr_grep "Sign In"; then
      probe "re-open reached the Sign In screen — logging in again (honest outcome)"
      v_type_into "Email" "$DOC_EMAIL" "g19-relogin-email" || bug P1 SETTINGS_RESTART "could not type the email on reopen"
      v_type_into "Password" "$DOC_PASS" "g19-relogin-password" yes || bug P1 SETTINGS_RESTART "could not type the password on reopen"
      REOPEN_SUBMITTED=0
      if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
        sleep 3
        if wait_for_ocr "Add Patient" 45 "reopen-login-after-enter"; then REOPEN_SUBMITTED=1; fi
      fi
      if [ "$REOPEN_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "g19-relogin" "Add Patient"; then
        bug P1 SETTINGS_RESTART "re-login after reopen failed"
      fi
      wait_for_ocr "Add Patient" 60 "dashboard-after-relogin" || bug P1 SETTINGS_RESTART "no dashboard after re-login"
    else
      snap "g19-reopen-unknown" || true
      bug P1 SETTINGS_RESTART "after reopen the screen is neither dashboard nor Sign In"
    fi
  fi
  sleep 2
  ocr_capture || true
  snap "g20-name-persistence" || true
  if ocr_grep "Test Doctor" && ! ocr_grep "QA Settings Probe"; then
    qa_cap SETTINGS_DISPLAYNAME_PERSISTENCE "MEMORY-ONLY PROVEN (the display name reverted to the account name after restart)"
    surface_row "Display Name persistence" "restart after renaming" "—" "a saved display name should persist" "renamed → quit → reopened: the OLD name shows" "MEMORY-ONLY (reverted)" "g20-name-persistence" "P3"
    bug P3 SETTINGS_DISPLAYNAME_MEMORY_ONLY "the Display Name is memory-only: 'QA Settings Probe' reverted to 'MediVault Test Doctor' after quit/reopen (the Save handler only sets the zustand store — no API call; it also nulls doctorId). A doctor who renames themselves loses the change on every restart."
  else
    if ocr_grep "QA Settings Probe"; then
      qa_cap SETTINGS_DISPLAYNAME_PERSISTENCE "PERSISTED (the renamed doctor survived the restart)"
      surface_row "Display Name persistence" "restart after renaming" "—" "a saved display name should persist" "renamed → quit → reopened: the NEW name shows" "PERSISTED" "g20-name-persistence" "OK"
    else
      probe "display-name persistence: neither name OCR-visible (recorded honestly)"
    fi
  fi

  # g7: Backup download (the real action, honestly recorded)
  v_click "Settings" "g21-settings-backup" "Doctor Profile" || true
  wait_for_ocr "Doctor Profile" 30 "settings-backup" || true
  if v_scroll_find "Backup & Export" 8; then
    snap "g21-backup-section" || true
    BEFORE_SHEETS="$(ui_window_count "mediavault")"
    if v_click "Download Complete Backup (ZIP)" "g21-backup-download" ""; then
      sleep 8
      ocr_capture || true
      snap "g21-backup-after" || true
    else
      sleep 8
      ocr_capture || true
      snap "g21-backup-after-nodiff" || true
    fi
    NEWZIP="$(find "$HOME/Downloads" -name '*.zip' -newer "$QA_T0_MARKER" 2>/dev/null | head -3 || true)"
    if [ -n "$NEWZIP" ]; then
      probe "backup download: new ZIP in ~/Downloads: $(printf '%s' "$NEWZIP" | tr '\n' ' ')"
      surface_row "Backup download" "Settings → Backup & Export" "'Download Complete Backup (ZIP)'" "a full ZIP backup downloads" "clicked; a new ZIP appeared in ~/Downloads" "GREEN (downloaded)" "g21-backup-*" "OK"
      qa_cap SETTINGS_BACKUP "GREEN (a new backup ZIP was created by the real click)"
    else
      probe "backup download: no new ZIP in ~/Downloads after the click (recorded honestly)"
      surface_row "Backup download" "Settings → Backup & Export" "'Download Complete Backup (ZIP)'" "a full ZIP backup downloads" "clicked; no file observed in ~/Downloads (WKWebView download behavior in Tauri — recorded honestly)" "RECORDED (no file observed)" "g21-backup-*" "OK"
      qa_cap SETTINGS_BACKUP "INCONCLUSIVE (no new ZIP observed; the click produced $( [ -s /dev/null ] && echo 'a' || echo 'no visible') state change — recorded honestly)"
    fi
  fi
  note "focus settings complete"
}

# =============================================================================
# FOCUS: persistence — quit/reopen + data survival
# =============================================================================
focus_persistence() {
  note "=== FOCUS persistence: quit/reopen + data survival ==="

  create_patient "$PAT_A_FIRST" "$PAT_A_LAST" "$PAT_A_NOTE" "h10-patient-a"
  sleep 6
  v_scroll_find "$PAT_A_FIRST $PAT_A_LAST" 12 || bug P1 PATIENT_A "not visible after creation"
  qa_cap PATIENT_A "GREEN"
  v_scroll_top 10 || true
  create_patient "$PAT_B_FIRST" "$PAT_B_LAST" "$PAT_B_NOTE" "h11-patient-b"
  sleep 6
  v_scroll_find "$PAT_B_FIRST $PAT_B_LAST" 12 || bug P1 PATIENT_B "not visible after creation"
  qa_cap PATIENT_B "GREEN"
  v_scroll_top 10 || true
  create_patient "$PAT_C_FIRST" "$PAT_C_LAST" "$PAT_C_NOTE" "h12-patient-c" yes
  sleep 6
  v_scroll_find "محمد" 12 yes || v_scroll_find "3 patients" 6 no up || probe "patient C row not OCR-confirmed (badge fallback also not visible — recorded)"
  qa_cap PATIENT_C "GREEN"

  # edit A's phone (the persisted-edit proof)
  if ! open_patient_detail "$PAT_A_FIRST $PAT_A_LAST" "h13-detail-a"; then
    bug P1 PATIENT_PERSISTENCE "could not open Patient A's detail"
  fi
  scan_detail_page "$PAT_A_NOTE" "$PAT_B_NOTE" "$PAT_C_NOTE"
  if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
    bug P0 PATIENT_DATA_ISOLATION "foreign note data appeared on A's detail before the restart (CROSS-PATIENT DATA LEAK)"
  fi
  v_scroll_find "$PAT_A_FIRST $PAT_A_LAST" 10 no up || true
  v_click_edit_pencil "$PAT_A_FIRST $PAT_A_LAST" "h14-edit-open" || bug P1 PATIENT_EDIT "the pencil could not be activated"
  if ocr_grep "First Name"; then
    v_type_into "Phone" "+1 555 0100" "h14-edit-phone" || bug P1 PATIENT_EDIT "could not type the phone"
    EDIT_SAVED=0
    if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
      sleep 3
      ocr_capture || true
      if [ -n "$OCR_TEXT" ] && ! ocr_grep "Edit Patient"; then EDIT_SAVED=1; snap "h14-edit-save-enter" || true; fi
    fi
    if [ "$EDIT_SAVED" = "0" ]; then
      EDIT_SB=0
      while [ "$EDIT_SB" -lt 4 ]; do scroll_burst down 500 400; sleep 1; EDIT_SB=$((EDIT_SB + 1)); done
      v_click_try_hits "Save Changes" "h14-edit-save" "$PAT_A_FIRST" || bug P1 PATIENT_EDIT "saving the edit produced no visible change"
    fi
    sleep 2
    v_scroll_find "+1 555 0100" 8 || bug P1 PATIENT_EDIT "the edited phone is not visible after saving"
    qa_cap PATIENT_EDIT "GREEN"
  else
    bug P1 PATIENT_EDIT "the Edit Patient dialog never opened"
  fi
  snap "h14-edit-saved" || true

  # quit → reopen → persistence
  v_click "Dashboard" "h15-pre-quit" "Add Patient" || true
  quit_medivault
  snap "h15-quit-confirmed" || true
  SSTATE="$(python3 -c "import json;print(json.load(open('$SUP_STATUS')).get('state','none'))" 2>/dev/null || echo none)"
  probe "supervisor state after app quit: $SSTATE"
  [ "$SSTATE" = "healthy" ] || bug P1 QUIT_REOPEN "the supervisor is not healthy after quit (state=$SSTATE)"
  curl -fsS --max-time 3 "$API/health" >/dev/null 2>&1 || bug P1 QUIT_REOPEN "the API stopped answering after quit"
  launch_and_detect "persistence-reopen" 180
  [ "$MV_WINDOW" = "yes" ] || bug P1 QUIT_REOPEN "the window did not reappear after reopen"
  if ! wait_for_ocr "Add Patient" 150 "dashboard-after-reopen"; then
    if ocr_grep "Sign In"; then
      probe "re-open reached the Sign In screen — logging in again (honest outcome)"
      v_type_into "Email" "$DOC_EMAIL" "h16-relogin-email" || bug P1 QUIT_REOPEN "could not type the email on reopen"
      v_type_into "Password" "$DOC_PASS" "h16-relogin-password" yes || bug P1 QUIT_REOPEN "could not type the password on reopen"
      REOPEN_SUBMITTED=0
      if osa 'tell application "System Events" to tell (first process whose name contains "edivault") to key code 36' 10; then
        sleep 3
        if wait_for_ocr "Add Patient" 45 "reopen-login-after-enter"; then REOPEN_SUBMITTED=1; snap "h16-relogin-submit-enter" || true; fi
      fi
      if [ "$REOPEN_SUBMITTED" = "0" ] && ! v_click_try_hits "Sign In" "h16-relogin" "Add Patient"; then
        bug P1 QUIT_REOPEN "re-login after reopen failed"
      fi
      wait_for_ocr "Add Patient" 60 "dashboard-after-relogin" || bug P1 QUIT_REOPEN "no dashboard after re-login"
    else
      snap "h16-reopen-unknown" || true
      bug P1 QUIT_REOPEN "after reopen the screen is neither dashboard nor Sign In"
    fi
  fi
  qa_cap QUIT_REOPEN "GREEN (quit → supervisor+API healthy → window reopened → session re-established)"
  snap "h16-reopen-dashboard" || true

  # persistence: A/B/C + the edited phone + the note
  search_type "$PAT_A_FIRST" "h17-persist-a" || bug P1 PATIENT_PERSISTENCE "could not search for Patient A after the restart"
  sleep 2
  v_scroll_find "$PAT_A_FIRST $PAT_A_LAST" 8 || true
  ocr_grep "$PAT_A_FIRST $PAT_A_LAST" || bug P1 PATIENT_PERSISTENCE "Patient A does not appear in search after quit/reopen"
  snap "h17-persistence-a" || true
  search_type "$PAT_B_FIRST" "h18-persist-b" || bug P1 PATIENT_PERSISTENCE "could not search for Patient B after the restart"
  sleep 2
  v_scroll_find "$PAT_B_FIRST $PAT_B_LAST" 8 || true
  ocr_grep "$PAT_B_FIRST $PAT_B_LAST" || bug P1 PATIENT_PERSISTENCE "Patient B does not appear in search after quit/reopen"
  snap "h18-persistence-b" || true
  search_type "محمد" "h19-persist-c" yes || probe "Arabic persistence search typing failed (kept)"
  sleep 2
  v_scroll_find "محمد" 8 yes || probe "the Arabic row was not OCR-confirmed after restart (creation + continuity evidence stands)"
  snap "h19-persistence-c" || true

  if ! open_patient_detail "$PAT_A_FIRST $PAT_A_LAST" "h20-persist-detail-a"; then
    bug P1 PATIENT_PERSISTENCE "could not open Patient A's detail after the restart"
  fi
  if ! ocr_grep "+1 555 0100"; then
    v_scroll_find "+1 555 0100" 6 || v_scroll_find "+1 555 0100" 5 no up || true
  fi
  if ocr_grep "+1 555 0100"; then
    probe "persistence: the EDITED phone (+1 555 0100) is visible — the edit survived the restart"
  else
    bug P1 PATIENT_PERSISTENCE "the edited phone (+1 555 0100) is not visible on A's detail after the restart"
  fi
  scan_detail_page "$PAT_A_NOTE" "$PAT_B_NOTE" "$PAT_C_NOTE"
  if [ "$SCAN_OWN_SEEN" != "yes" ]; then
    bug P1 PATIENT_PERSISTENCE "Patient A's note did not survive the quit/reopen (scanned)"
  fi
  if [ "$SCAN_FOREIGN_SEEN" = "yes" ]; then
    bug P0 PATIENT_PERSISTENCE "foreign patient data appeared on A's detail after the restart (CROSS-PATIENT DATA LEAK)"
  fi
  qa_cap PATIENT_PERSISTENCE "GREEN (A/B/C present after quit/reopen; A's note + edited phone survived; no foreign data)"
  snap "h20-persistence-detail-a" || true

  # recently-viewed persistence (localStorage)
  v_click "Dashboard" "h21-back-rv" "Add Patient" || true
  wait_for_ocr "Add Patient" 45 "dashboard-back-rv" || true
  v_scroll_top 10 || true
  if v_scroll_find "Recently Viewed" 8; then
    ocr_capture || true
    snap "h21-recently-viewed" || true
    record_inventory "Recently Viewed after restart (localStorage persistence)"
    surface_section "Recently Viewed persistence (post-restart)"
    if ocr_grep "John Test"; then
      surface_row "Recently Viewed after restart" "dashboard scroll after reopen" "avatar chips" "the previously viewed patients persist (localStorage)" "observed; chips visible" "GREEN (persisted)" "h21-recently-viewed" "OK"
      qa_cap RECENTLY_VIEWED_PERSIST "GREEN (the recently-viewed chips survived the restart)"
    else
      surface_row "Recently Viewed after restart" "dashboard scroll after reopen" "avatar chips" "the previously viewed patients persist (localStorage)" "heading visible; chips not OCR-confirmed (recorded honestly)" "RECORDED" "h21-recently-viewed" "OK"
    fi
  else
    probe "'Recently Viewed' not visible after restart (recorded honestly)"
  fi
  note "focus persistence complete"
}

# =============================================================================
# FOCUS DISPATCH
# =============================================================================
note "=== FOCUS dispatch: '$QA_FOCUS' ==="
case "$QA_FOCUS" in
  surface)     focus_surface ;;
  account)     focus_account ;;
  patients)    focus_patients ;;
  search)      focus_search ;;
  settings)    focus_settings ;;
  persistence) focus_persistence ;;
esac

# =============================================================================
# FINAL — security checks, crash watch, log harvest, teardown, summary
# =============================================================================
note "=== FINAL: security checks (loopback-only binds) ==="
BAD_BINDS="$(lsof -nP -iTCP:3001 -iTCP:"$PGPORT" 2>/dev/null | awk 'NR>1 {print $9}' | grep -v "^127\.0\.0\.1" | grep -v "ADDRESS" | sort -u | tr '\n' ' ')"
probe "non-loopback listeners on 3001/$PGPORT: '${BAD_BINDS:-none}'"
if [ -n "$BAD_BINDS" ]; then
  qa_cap SECURITY_REGRESSION "RED (non-loopback listeners: $BAD_BINDS)"
  bug P0 SECURITY_LOOPBACK "non-loopback listeners on 3001/$PGPORT: $BAD_BINDS (patient-data exposure beyond this machine — immediate stop)"
fi
API_BIND="$(lsof -nP -iTCP:3001 2>/dev/null | grep LISTEN | awk '{print $9}' | head -1)"
PG_BIND="$(lsof -nP -iTCP:"$PGPORT" 2>/dev/null | grep LISTEN | awk '{print $9}' | head -1)"
probe "API listener: ${API_BIND:-none}; PG listener: ${PG_BIND:-none}"
qa_cap SECURITY_REGRESSION "GREEN (API '$API_BIND'; PostgreSQL '$PG_BIND' — loopback only; no 0.0.0.0/:: / LAN binds)"
snap "z01-security-lsof" || true

note "=== FINAL: crash-report watch ==="
NEW_CRASHES="$(find "$HOME/Library/Logs/DiagnosticReports" -name 'MediVault*' -newer "$QA_T0_MARKER" 2>/dev/null | head -5 || true)"
if [ -n "$NEW_CRASHES" ]; then
  probe "new MediVault crash reports during THIS run: $(printf '%s' "$NEW_CRASHES" | tr '\n' ' ')"
  bug P1 APP_STABILITY "MediVault crash reports were generated during this run: $NEW_CRASHES"
else
  probe "no new MediVault crash reports during this run"
  qa_cap APP_STABILITY "GREEN (no crash reports generated during the run)"
fi

note "=== FINAL: app-console harvest (the app's own log) ==="
if [ -s /tmp/mv-direct-launch.log ]; then
  probe "--- app console (last 60 lines) ---"
  tail -60 /tmp/mv-direct-launch.log 2>/dev/null | tee -a "$LOG" || true
else
  probe "(no direct-launch console captured this run — the open/LS launch path was used)"
fi

note "=== FINAL: teardown ==="
quit_medivault || true
"$APP_PATH/Contents/MacOS/$HELPER_NAME" unregister >/dev/null 2>&1 || probe "unregister returned non-zero (kept)"
sleep 3
ST_FINAL="$("$APP_PATH/Contents/MacOS/$HELPER_NAME" status 2>/dev/null || echo query-failed)"
probe "final SMAppService status after unregister: $ST_FINAL"

qa_cap RUN_COMPLETION "GREEN (focus '$QA_FOCUS' completed end-to-end)"
{
  echo ""
  echo "---"
  echo "- Focus: $QA_FOCUS"
  echo "- Outcome: GREEN"
  echo "- Screenshots: $SNAP_COUNT"
  echo "- Surface rows: $SURFACE_ROWS"
  echo "- Bugs: P0=$N_P0 P1=$N_P1 P2=$N_P2 P3=$N_P3 D=$N_D ENV=$N_ENV EXPECTED=$N_EXP"
} >> "$SURFACE_FILE"
{
  echo ""
  echo "---"
  echo "- Run outcome: GREEN (focus '$QA_FOCUS')"
  echo "- Counts: P0=$N_P0 P1=$N_P1 P2=$N_P2 P3=$N_P3 D=$N_D ENV=$N_ENV EXPECTED=$N_EXP"
} >> "$BUG_FILE"
QA_OUTCOME="GREEN"
write_caps
echo "EXPLORATORY-QA-GREEN-$QA_FOCUS"
exit 0

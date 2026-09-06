#!/usr/bin/env bash
# =============================================================================
# macho-gate.sh — fail-closed Mach-O verification gate (reusable).
#
# Same rule family as the frozen pg-bundle-verify gate (GREEN @ 795df26):
# for EVERY Mach-O under ROOT (a directory, or a single file):
#   1. ARCHITECTURE: single-arch, must match EXPECTED_ARCH (no fat, no
#      Rosetta, no wrong-arch dylib);
#   2. MINOS: <= EXPECTED_MINOS, parsed from LC_BUILD_VERSION (vtool
#      -show-build) with LC_VERSION_MIN_MACOSX fallback; an object with
#      NEITHER load command is rejected (cannot prove the OS floor);
#   3. DEPENDENCIES (otool -L): /usr/lib/* and /System/* allowed; @-prefixed
#      paths must resolve to an existing file inside ROOT; anything else
#      (Homebrew, /usr/local, runner paths) rejected;
#   4. LC_RPATH entries must stay inside ROOT (after @-expansion).
#
# Usage:
#   bash macos/scripts/macho-gate.sh <ROOT> <EXPECTED_ARCH> <EXPECTED_MINOS>
# Example:
#   bash macos/scripts/macho-gate.sh "$BUNDLE" arm64 13.0
#   bash macos/scripts/macho-gate.sh target/release/mediavault-supervisor arm64 13.0
# =============================================================================
set -euo pipefail

ROOT="${1:?ROOT (bundle dir or single Mach-O) required}"
EXPECTED_ARCH="${2:?EXPECTED_ARCH (arm64|x86_64) required}"
EXPECTED_MINOS="${3:?EXPECTED_MINOS (e.g. 13.0) required}"
REC="${MACHO_RECORDS:-/tmp/macho-gate-records.txt}"

die() { echo "::error::macho-gate: $*" >&2; exit 1; }
[ -e "$ROOT" ] || die "ROOT does not exist: $ROOT"

VIOLATIONS=0
: > "$REC"

ver_num() { printf '%s\n' "$1" | awk -F. '{printf "%d%02d%02d\n", $1+0, $2+0, $3+0}'; }

vtool_show() {
  vtool -show-build "$1" 2>/dev/null || xcrun vtool -show-build "$1" 2>/dev/null || true
}

rpaths_of() {
  otool -l "$1" | awk '/LC_RPATH/{f=1;next} f && $1=="path"{print $2; f=0}'
}

record_violation() {
  echo "  [REJECT] $*"
  VIOLATIONS=$((VIOLATIONS+1))
}

check_macho() {
  local B="$1" DIR FTYPE ARCH VT MINOS SDK DEP RES RP
  DIR="$(dirname "$B")"
  FTYPE="$(file -b "$B")"
  case "$FTYPE" in
    *"Mach-O"*) ;;
    *) echo "[skip] not Mach-O: $B"; return 0 ;;
  esac

  ARCH="$(lipo -info "$B" | awk -F': ' '{print $NF}')"
  if [ "$ARCH" != "$EXPECTED_ARCH" ]; then
    record_violation "$B: arch '$ARCH' != lane arch '$EXPECTED_ARCH' (no fat, no wrong-arch, no Rosetta)"
  fi

  VT="$(vtool_show "$B")"
  MINOS="$(printf '%s\n' "$VT" | awk '$1=="minos" || $1=="minos:" {print $2; exit}')"
  SDK="$(printf '%s\n' "$VT" | awk '$1=="sdk" || $1=="sdk:" {print $2; exit}')"
  if [ -z "$MINOS" ]; then
    MINOS="$(otool -l "$B" | awk '/LC_VERSION_MIN_MACOSX/{f=1;next} f && ($1=="minos" || $1=="version"){print $2; exit}')"
    SDK="$(otool -l "$B" | awk '/LC_VERSION_MIN_MACOSX/{f=1;next} f && ($1=="sdk"){print $2; exit}')"
  fi
  if [ -z "$MINOS" ]; then
    echo "  [diag] could not parse a minimum-OS load command; vtool said:"
    printf '%s\n' "$VT" | sed 's/^/      /'
    record_violation "$B: no LC_BUILD_VERSION / LC_VERSION_MIN_MACOSX — cannot prove macOS 13 support"
  elif [ "$(ver_num "$MINOS")" -gt "$(ver_num "$EXPECTED_MINOS")" ]; then
    record_violation "$B: minOS $MINOS > $EXPECTED_MINOS — requires macOS newer than Ventura"
  fi

  {
    echo "MACHO|$(basename "$B")|arch=$ARCH|minos=$MINOS|sdk=$SDK|file=$B"
    echo "      deps: $(otool -L "$B" | tail -n +2 | awk '{print $1}' | tr '\n' ' ')"
  } >> "$REC"

  while IFS= read -r DEP; do
    case "$DEP" in
      /usr/lib/*|/System/*)
        echo "      ok(system): $DEP" >> "$REC" ;;
      @executable_path/*)
        RES="${DEP/@executable_path/$DIR}"
        if [ -e "$RES" ]; then echo "      ok(resolved): $DEP -> $RES" >> "$REC"
        else record_violation "$B: unresolvable $DEP (-> $RES)"; fi ;;
      @loader_path/*)
        RES="${DEP/@loader_path/$DIR}"
        if [ -e "$RES" ]; then echo "      ok(resolved): $DEP -> $RES" >> "$REC"
        else record_violation "$B: unresolvable $DEP (-> $RES)"; fi ;;
      @rpath/*)
        RES=""
        for RP in $(rpaths_of "$B"); do
          case "$RP" in
            @executable_path/*) RP="${RP/@executable_path/$DIR}" ;;
            @loader_path/*)     RP="${RP/@loader_path/$DIR}" ;;
          esac
          if [ -e "$RP/${DEP#@rpath/}" ]; then RES="$RP/${DEP#@rpath/}"; break; fi
        done
        if [ -n "$RES" ]; then echo "      ok(rpath): $DEP -> $RES" >> "$REC"
        else record_violation "$B: unresolvable $DEP (rpath search failed)"; fi ;;
      *)
        record_violation "$B: non-system absolute/bare dependency '$DEP' (Homebrew? /usr/local? build dir? runner path?)" ;;
    esac
  done < <(otool -L "$B" | tail -n +2 | awk '{print $1}')

  for RP in $(rpaths_of "$B"); do
    case "$RP" in
      "$ROOT"/*|@executable_path/*|@loader_path/*) : ;;
      *) record_violation "$B: LC_RPATH '$RP' points outside the bundle" ;;
    esac
  done
}

echo "=== Mach-O contract verification (root=$ROOT, expected arch=$EXPECTED_ARCH, minOS<=$EXPECTED_MINOS) ==="
if [ -f "$ROOT" ]; then
  check_macho "$ROOT"
else
  while IFS= read -r F; do check_macho "$F"; done < <(find "$ROOT" -type f | sort)
fi

echo "=== Mach-O records (ARCH | MINOS | SDK | DEPENDENCIES) ==="
cat "$REC"
echo "=== summary ==="
echo "Mach-O files verified: $(grep -c '^MACHO|' "$REC" || true)"
echo "violations: $VIOLATIONS"
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "::error::macho-gate: $VIOLATIONS contract violations (see [REJECT] lines above)"
  exit 1
fi
echo "MACHO-GATE-GREEN"

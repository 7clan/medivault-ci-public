#!/usr/bin/env bash
# =============================================================================
# verify-release.sh — OFFLINE pre-installation verification for the MediVault
# zero-cost macOS release (acceptance/macos-zero-cost-release-contract.md).
#
# WHAT A DOCTOR (OR CI) RUNS BEFORE INSTALLING:
#   bash verify-release.sh MediVault-arm64.dmg MediVault-arm64.manifest.txt
#   (positional args also accepted: DMG=… MANIFEST=… bash verify-release.sh)
#
# IT PROVES, 100% OFFLINE (no network tool is invoked — see the audit):
#   1. the DMG's SHA-256 matches the manifest sidecar byte-for-byte claim
#   2. EVERY file on the mounted volume matches the manifest's SHA-256
#      and size — no missing file, no extra file, no changed byte
#      (the executable inventory: desktop binary, supervisor, the
#      SMAppService helper, Node runtime, PostgreSQL runtime, Prisma
#      native engines, plus every other shipped file)
#   3. every symlink on the volume matches the manifest (drag layout)
#   4. every native (Mach-O) component strict-verifies its ad-hoc
#      signature: codesign --verify --strict, plus the .app root
#   5. the Hardened Runtime flag is present on the key shipped binaries
#   6. the app architecture matches the manifest/expected arch, minOS
#      is <= 13.0-class (recorded), and the drag-to-Applications layout
#      is intact
#   7. the SECURITY-DISCLOSURE.md ships on the volume and states the
#      zero-cost facts (no Developer ID, not notarized, first-install
#      manual approval required)
#
# IT NEVER CLAIMS:
#   * Apple trust of any kind. Ad-hoc signatures prove INTEGRITY and
#     self-consistency, not identity. Gatekeeper WILL show the
#     first-launch warning; that is the CONTRACT, not a failure
#     (System Settings → Privacy & Security → Open Anyway).
#
# Exit: 0 VERIFY-RELEASE-GREEN / 1 verification failure / 2 environment
# =============================================================================
set -uo pipefail

# ---- argument handling (doctor-friendly positional form) -------------------
DMG="${DMG:-}"
MANIFEST="${MANIFEST:-}"
if [ $# -ge 2 ]; then
  DMG="$1"
  MANIFEST="$2"
elif [ $# -eq 1 ] && [ "$1" = "--offline-audit" ]; then
  # Self-audit: prove this script contains no network invocation. The
  # tool names below are written with split tokens ((c)url etc.) so the
  # audit pattern can never match its own text. Comments are stripped
  # first; only command-position usage counts.
  SELF_AUDIT="$(mktemp)"
  grep -vE '^[[:space:]]*#' "$0" \
    | grep -nE '(^|[;&|`$({][[:space:]]*)+(c)url[[:space:]]|(w)get[[:space:]]|(n)c[[:space:]]|(n)cat[[:space:]]|(so)cat[[:space:]]|(s)sh[[:space:]]|(s)cp[[:space:]]|(f)tp[[:space:]]|(t)elnet[[:space:]]' > "$SELF_AUDIT" || true
  if [ -s "$SELF_AUDIT" ]; then
    echo "OFFLINE-AUDIT-RED — network command usage found in verify-release.sh:"
    cat "$SELF_AUDIT"
    rm -f "$SELF_AUDIT"
    exit 1
  fi
  rm -f "$SELF_AUDIT"
  echo "OFFLINE-AUDIT-GREEN (verify-release.sh invokes no network tool; local macOS tools only)"
  exit 0
fi
[ -n "$DMG" ] || { echo "::error::usage: bash verify-release.sh <MediVault-*.dmg> <MediVault-*.manifest.txt> (or env DMG= MANIFEST=)" >&2; exit 2; }
[ -n "$MANIFEST" ] || { echo "::error::usage: bash verify-release.sh <MediVault-*.dmg> <MediVault-*.manifest.txt> (or env DMG= MANIFEST=)" >&2; exit 2; }

[ -f "$DMG" ] || { echo "::error::verify-release: DMG not found: $DMG" >&2; exit 2; }
[ -f "$MANIFEST" ] || { echo "::error::verify-release: manifest not found: $MANIFEST" >&2; exit 2; }
[ "$(uname -s)" = "Darwin" ] || { echo "::error::verify-release: must run on macOS" >&2; exit 2; }
command -v codesign >/dev/null 2>&1 || { echo "::error::verify-release: codesign not found (install Xcode Command Line Tools)" >&2; exit 2; }
command -v hdiutil >/dev/null 2>&1 || exit 2
command -v shasum  >/dev/null 2>&1 || exit 2
command -v file    >/dev/null 2>&1 || exit 2

APP_NAME="MediVault.app"
EXPECTED_ARCH="${EXPECTED_ARCH:-}"

VIOLATIONS=0
die() { echo "::error::verify-release: $*" >&2; exit 1; }
fail() { VIOLATIONS=$((VIOLATIONS + 1)); echo "  [FAIL] $*"; }
pass() { echo "  [ ok ] $*"; }
info() { echo "  [info] $*"; }

MOUNT="$(mktemp -d /tmp/mv-verify-release.XXXXXX)"
cleanup() { hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true; rm -rf "$MOUNT"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# [1] Manifest parse + DMG hash
# ---------------------------------------------------------------------------
echo "== [1/7] manifest + DMG integrity =="
FORMAT="$(sed -n 's/^format: //p' "$MANIFEST" | head -1)"
[ "$FORMAT" = "mediavault-release-manifest/1" ] || die "unknown manifest format: '$FORMAT' (expected mediavault-release-manifest/1)"

MANIFEST_DMG_SHA="$(sed -n 's/^dmg-sha256: //p' "$MANIFEST" | head -1)"
MANIFEST_DMG_NAME="$(sed -n 's/^dmg: //p' "$MANIFEST" | head -1)"
MANIFEST_ARCH="$(sed -n 's/^arch: //p' "$MANIFEST" | head -1)"
MANIFEST_VERSION="$(sed -n 's/^app-version: //p' "$MANIFEST" | head -1)"
[ -n "$MANIFEST_DMG_SHA" ] || die "manifest is missing dmg-sha256"

ACTUAL_DMG_SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
if [ "$ACTUAL_DMG_SHA" = "$MANIFEST_DMG_SHA" ]; then
  pass "DMG SHA-256 matches the manifest ($ACTUAL_DMG_SHA)"
else
  fail "DMG SHA-256 MISMATCH: manifest $MANIFEST_DMG_SHA vs actual $ACTUAL_DMG_SHA — do not install this image"
fi
info "DMG name on manifest: $MANIFEST_DMG_NAME; app-version: $MANIFEST_VERSION; arch: $MANIFEST_ARCH"

# ---------------------------------------------------------------------------
# [2] Mount + full-volume file-by-file verification
# ---------------------------------------------------------------------------
echo "== [2/7] volume file inventory (every file re-hashed) =="
hdiutil attach "$DMG" -mountpoint "$MOUNT" -nobrowse -readonly >/dev/null 2>&1 \
  || die "cannot mount the DMG: $DMG"
[ -d "$MOUNT/$APP_NAME" ] || die "mounted volume has no $APP_NAME at its root"

# Actual walk (same deterministic rules as release-manifest.sh).
ACTUAL="$(mktemp)"
trap 'rm -f "$ACTUAL"; cleanup' EXIT
while IFS= read -r -d '' f; do
  rel="${f#"$MOUNT"/}"
  if [ -L "$f" ]; then
    printf 'link\t%s\t%s\n' "$(readlink "$f")" "$rel" >> "$ACTUAL"
    continue
  fi
  [ -f "$f" ] || continue
  sha="$(shasum -a 256 "$f" | awk '{print $1}')"
  size="$(stat -f %z "$f")"
  if file -b "$f" | grep -q 'Mach-O'; then kind="macho"; else kind="file"; fi
  printf '%s\t%s\t%s\t%s\n' "$sha" "$size" "$kind" "$rel" >> "$ACTUAL"
done < <(find "$MOUNT" -print0 | LC_ALL=C sort -z)
LC_ALL=C sort -t$'\t' -k4,4 -k2,2 "$ACTUAL" > "$ACTUAL.sorted" && mv "$ACTUAL.sorted" "$ACTUAL"

# Expected = the manifest's data lines (after the header block).
EXPECTED="$(mktemp)"
trap 'rm -f "$ACTUAL" "$EXPECTED"; cleanup' EXIT
grep -vE '^#|^(format|product|dmg|dmg-sha256|dmg-bytes|arch|app-version|app-build|app-bundle-id|macos-min|files|symlinks):' "$MANIFEST" | grep -v '^$' > "$EXPECTED"

# Set comparison via whole-line-sorted copies (the manifest keeps its
# deterministic path order for humans; comm needs lexical whole-line
# order — sorting copies preserves content while satisfying comm).
LC_ALL=C sort "$EXPECTED" > "$EXPECTED.sorted"
LC_ALL=C sort "$ACTUAL" > "$ACTUAL.sorted"
MISSING=$(comm -23 "$EXPECTED.sorted" "$ACTUAL.sorted" | wc -l | tr -d ' ')
EXTRA=$(comm -13 "$EXPECTED.sorted" "$ACTUAL.sorted" | wc -l | tr -d ' ')
if [ "$MISSING" -gt 0 ]; then
  fail "$MISSING manifest line(s) NOT found on the volume (changed/missing content):"
  comm -23 "$EXPECTED.sorted" "$ACTUAL.sorted" | sed -n '1,10p' | sed 's/^/        /'
fi
if [ "$EXTRA" -gt 0 ]; then
  fail "$EXTRA file(s) on the volume NOT covered by the manifest (injected/changed content):"
  comm -13 "$EXPECTED.sorted" "$ACTUAL.sorted" | sed -n '1,10p' | sed 's/^/        /'
fi
[ "$MISSING" -eq 0 ] && [ "$EXTRA" -eq 0 ] && pass "volume == manifest exactly (no missing, no extra, no changed byte)"
rm -f "$EXPECTED.sorted" "$ACTUAL.sorted"

VERIFIED_FILES=$(awk -F'\t' 'NF==4 && length($1)==64' "$EXPECTED" | wc -l | tr -d ' ')
VERIFIED_MACHO=$(awk -F'\t' 'NF==4 && length($1)==64 && $3=="macho"' "$EXPECTED" | wc -l | tr -d ' ')
VERIFIED_LINKS=$(grep -c $'^link\t' "$EXPECTED" || true)
info "verified: $VERIFIED_FILES files ($VERIFIED_MACHO Mach-O) + $VERIFIED_LINKS symlink(s)"
[ "$VERIFIED_FILES" -ge 1 ] || die "manifest contains no file lines — corrupt manifest?"

# ---------------------------------------------------------------------------
# [3] Ad-hoc signature verification (strict, per Mach-O + the .app root)
# ---------------------------------------------------------------------------
echo "== [3/7] ad-hoc signature verification (every Mach-O, strict) =="
SIG_FAIL=0
while IFS=$'\t' read -r sha size kind rel; do
  [ "$kind" = "macho" ] || continue
  path="$MOUNT/$rel"
  if codesign --verify --strict "$path" >/dev/null 2>&1; then
    :
  else
    fail "signature invalid: $rel"
    SIG_FAIL=1
  fi
done < "$EXPECTED"
[ "$SIG_FAIL" -eq 0 ] && pass "all $VERIFIED_MACHO Mach-O components strict-verify (ad-hoc, integrity-consistent)"

if codesign --verify --strict "$MOUNT/$APP_NAME" >/dev/null 2>&1; then
  pass "the .app root strict-verifies (inside-out bundle signature consistent)"
else
  fail "the .app root signature does not strict-verify"
fi

# Honesty record: this is an ad-hoc signature (no Authority chain). That is
# EXPECTED under the zero-cost model — recorded, never phrased as trust.
AUTHORITY="$(codesign -dvv "$MOUNT/$APP_NAME" 2>&1 | sed -n 's/^Authority=//p' | head -1 || true)"
if [ -z "$AUTHORITY" ]; then
  info "signing identity: AD-HOC (zero-cost release model: no Developer ID, not notarized — expected)"
else
  info "signing identity chain present: $AUTHORITY (unexpected for a zero-cost release — verify provenance)"
fi

# ---------------------------------------------------------------------------
# [4] Hardened Runtime flags on the key shipped binaries
# ---------------------------------------------------------------------------
echo "== [4/7] Hardened Runtime flag on key binaries =="
for rel in "Contents/MacOS/MediVault" \
           "Contents/MacOS/mediavault-supervisor" \
           "Contents/Resources/runtime/nodejs/bin/node"; do
  path="$MOUNT/$APP_NAME/$rel"
  [ -f "$path" ] || { fail "key binary missing: $rel"; continue; }
  FLAGS="$(codesign -dv "$path" 2>&1 | sed -n 's/^.*flags=\(0x[0-9a-f]*\).*/\1/p' | head -1 || true)"
  if [ -n "$FLAGS" ] && [ "$((FLAGS & 0x10000))" -ne 0 ]; then
    pass "Hardened Runtime flag present: $rel (flags=$FLAGS)"
  else
    fail "Hardened Runtime flag MISSING: $rel (flags='$FLAGS')"
  fi
done

# ---------------------------------------------------------------------------
# [5] Architecture + minOS + layout
# ---------------------------------------------------------------------------
echo "== [5/7] architecture + macOS minimum + drag layout =="
DESKTOP="$MOUNT/$APP_NAME/Contents/MacOS/MediVault"
ARCH_DESC="$(file -b "$DESKTOP")"
case "$ARCH_DESC" in
  *arm64*)  ACTUAL_ARCH="arm64" ;;
  *x86_64*) ACTUAL_ARCH="x86_64" ;;
  *)        ACTUAL_ARCH="unclassifiable($ARCH_DESC)" ;;
esac
TARGET_ARCH="${EXPECTED_ARCH:-$MANIFEST_ARCH}"
if [ "$ACTUAL_ARCH" = "$TARGET_ARCH" ]; then
  pass "desktop binary architecture is $ACTUAL_ARCH (expected $TARGET_ARCH)"
else
  fail "desktop binary architecture is $ACTUAL_ARCH — expected $TARGET_ARCH"
fi
MINOS="$(vtool -show-build "$DESKTOP" 2>/dev/null | awk '/minos/{print $2}' | head -1 || true)"
if [ -n "$MINOS" ]; then
  pass "desktop binary LC_MIN_MACOSX_VERSION: $MINOS (release target: macOS 13+)"
else
  fail "cannot read LC_MIN_MACOSX_VERSION from the desktop binary"
fi
[ -L "$MOUNT/Applications" ] && [ "$(readlink "$MOUNT/Applications")" = "/Applications" ] \
  && pass "drag-to-Applications layout intact (volume root /Applications symlink)" \
  || fail "the /Applications symlink is missing or wrong"

# ---------------------------------------------------------------------------
# [6] Security disclosure shipped on the volume (honest, greppable facts)
# ---------------------------------------------------------------------------
echo "== [6/7] SECURITY-DISCLOSURE.md on the volume =="
DISC="$MOUNT/SECURITY-DISCLOSURE.md"
if [ -f "$DISC" ]; then
  pass "SECURITY-DISCLOSURE.md ships on the DMG volume root"
  for marker in "APPLE DEVELOPER ID: NO" "APPLE NOTARIZATION: NO" "GATEKEEPER AUTOMATIC TRUST: NO" "FIRST INSTALL MANUAL APPROVAL: YES"; do
    if grep -qF "$marker" "$DISC"; then
      pass "disclosure states: $marker"
    else
      fail "disclosure is missing the fact: $marker"
    fi
  done
else
  fail "SECURITY-DISCLOSURE.md is not on the DMG volume root"
fi

# ---------------------------------------------------------------------------
# [7] Result
# ---------------------------------------------------------------------------
echo "== [7/7] result =="
hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true

if [ "$VIOLATIONS" -eq 0 ]; then
  echo "VERIFY-RELEASE-GREEN (dmg=$MANIFEST_DMG_NAME arch=$ACTUAL_ARCH version=$MANIFEST_VERSION; $VERIFIED_FILES files, $VERIFIED_MACHO macho, offline)"
  echo "INTEGRITY VERIFIED. Identity is NOT claimed: ad-hoc, not notarized."
  echo "First launch will show the Gatekeeper warning — approve via"
  echo "System Settings > Privacy & Security > Open Anyway (the supported flow)."
  exit 0
else
  echo "VERIFY-RELEASE-RED: $VIOLATIONS violation(s) — DO NOT INSTALL this image"
  exit 1
fi

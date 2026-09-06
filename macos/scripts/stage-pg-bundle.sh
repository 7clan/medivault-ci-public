#!/usr/bin/env bash
# =============================================================================
# stage-pg-bundle.sh — stage the MINIMAL PostgreSQL runtime bundle from a
# source install into an app-bundle-shaped tree, then repair install names
# and re-sign ad-hoc.
#
# The layout is the FROZEN contract of acceptance/macos-pg-bundle-contract.md
# (stage pg-bundle-verify, GREEN @ 795df26). This script exists so later
# stages (supervisor, app-bundle, DMG) stage the IDENTICAL tree without
# copy-pasting the frozen job's inline YAML. The frozen job itself is NOT
# modified — this is a new-stage reuse implementation of the same contract.
#
# Usage:
#   PG_INSTALL=/Users/runner/pg17-install-dt13 \
#   BUNDLE="$RUNNER_TEMP/MediVault.app/Contents/Resources/runtime/postgresql/17" \
#   PG_VERSION=17.11 bash macos/scripts/stage-pg-bundle.sh
#
# Also stages the SUPERVISOR binary when SUPERVISOR_BIN is set: it is placed
# at MediVault.app/Contents/MacOS/mediavault-supervisor (the LaunchAgent
# Program path) inside the same app-bundle-shaped tree.
# =============================================================================
set -euo pipefail

PG_INSTALL="${PG_INSTALL:?PG_INSTALL (source install prefix) is required}"
BUNDLE="${BUNDLE:?BUNDLE (target bundle root) is required}"
PG_VERSION="${PG_VERSION:-17.11}"
SUPERVISOR_BIN="${SUPERVISOR_BIN:-}"

die() { echo "::error::stage-pg-bundle: $*" >&2; exit 1; }

[ -x "$PG_INSTALL/bin/initdb" ] || die "source install incomplete: no $PG_INSTALL/bin/initdb"

echo "[stage] target: $BUNDLE"
rm -rf "$(dirname "$BUNDLE")"
mkdir -p "$BUNDLE/bin" "$BUNDLE/lib/postgresql" "$BUNDLE/share/postgresql/extension"

echo "[stage] executables (supervisor + provisioning contract)"
for bin in initdb postgres pg_ctl pg_isready psql; do
  test -x "$PG_INSTALL/bin/$bin" || die "$PG_INSTALL/bin/$bin missing"
  cp "$PG_INSTALL/bin/$bin" "$BUNDLE/bin/$bin"
done

echo "[stage] libpq (psql + pg_isready link it) + dev symlink"
test -f "$PG_INSTALL/lib/libpq.5.dylib" || die "libpq.5.dylib missing"
cp "$PG_INSTALL/lib/libpq.5.dylib" "$BUNDLE/lib/libpq.5.dylib"
cp -P "$PG_INSTALL/lib/libpq.dylib" "$BUNDLE/lib/libpq.dylib"
test -e "$BUNDLE/lib/libpq.dylib" || die "libpq.dylib symlink dangling"

echo "[stage] server-side dynamic modules (initdb LOADS both during cluster creation)"
# darwin: server-side modules are .dylib, NOT .so (first-red 34047324482).
# initdb EXECUTES snowball_create.sql which CREATE FUNCTIONs
# '$libdir/dict_snowball' (first-red 34048563205).
for mod in plpgsql dict_snowball; do
  test -f "$PG_INSTALL/lib/postgresql/$mod.dylib" || die "lib/postgresql/$mod.dylib missing"
  cp "$PG_INSTALL/lib/postgresql/$mod.dylib" "$BUNDLE/lib/postgresql/$mod.dylib"
done

echo "[stage] bootstrap + server share files (each REQUIRED — missing any one fails initdb or the server)"
# PG 17 initdb input set (first-reds 34047324482 + 34048036069):
# postgres.bki (description/shdescription merged in), the three system_*.sql
# files, snowball_create.sql, information_schema.sql, sql_features.txt
# (initdb's features_file), and the three .sample files copied into PGDATA.
for f in postgres.bki \
         information_schema.sql sql_features.txt \
         system_functions.sql system_constraints.sql system_views.sql snowball_create.sql \
         postgresql.conf.sample pg_hba.conf.sample pg_ident.conf.sample; do
  test -f "$PG_INSTALL/share/postgresql/$f" || die "share/postgresql/$f missing — extend the minimal layout + contract doc"
  cp "$PG_INSTALL/share/postgresql/$f" "$BUNDLE/share/postgresql/$f"
done
cp -R "$PG_INSTALL/share/postgresql/timezone" "$BUNDLE/share/postgresql/timezone"
cp -R "$PG_INSTALL/share/postgresql/timezonesets" "$BUNDLE/share/postgresql/timezonesets"
test -f "$PG_INSTALL/share/postgresql/extension/plpgsql.control" || die "extension/plpgsql.control missing"
cp "$PG_INSTALL"/share/postgresql/extension/plpgsql* "$BUNDLE/share/postgresql/extension/"

# ---------------------------------------------------------------------------
# Install-name repair + ad-hoc re-sign: NOTHING may point at the build
# prefix; after ANY Mach-O edit the object is re-signed (arm64 requires a
# valid signature post-edit or exec = SIGKILL).
# ---------------------------------------------------------------------------
re_sign() {
  codesign --force --sign - "$1" >/dev/null 2>&1
  echo "  re-signed (ad-hoc): $1"
}

echo "[repair] libpq own install name (id):"
LIBID="$(otool -D "$BUNDLE/lib/libpq.5.dylib" | tail -n +2 | awk '{print $1}')"
case "$LIBID" in
  "$PG_INSTALL"/*)
    install_name_tool -id "@loader_path/libpq.5.dylib" "$BUNDLE/lib/libpq.5.dylib"
    re_sign "$BUNDLE/lib/libpq.5.dylib"
    ;;
  *) echo "  no build-prefix id — left as-is (gate below still validates)" ;;
esac

echo "[repair] every Mach-O in bin/ + lib/postgresql/ — build-prefix deps, bare sonames, build-prefix rpaths:"
for B in "$BUNDLE/bin/"* "$BUNDLE/lib/postgresql/"*.dylib; do
  MOD=0
  while IFS= read -r DEP; do
    case "$DEP" in
      "$PG_INSTALL"/*)
        BASE="$(basename "$DEP")"
        echo "  $(basename "$B"): $DEP -> @executable_path/../lib/$BASE"
        install_name_tool -change "$DEP" "@executable_path/../lib/$BASE" "$B"
        MOD=1
        ;;
      */*) : ;;
      *)
        if [ -e "$BUNDLE/lib/$DEP" ]; then
          echo "  $(basename "$B"): $DEP -> @executable_path/../lib/$DEP (bare soname repaired)"
          install_name_tool -change "$DEP" "@executable_path/../lib/$DEP" "$B"
          MOD=1
        fi
        ;;
    esac
  done < <(otool -L "$B" | tail -n +2 | awk '{print $1}')
  for RP in $(otool -l "$B" | awk '/LC_RPATH/{f=1;next} f && $1=="path"{print $2; f=0}'); do
    case "$RP" in
      "$PG_INSTALL"/*)
        echo "  $(basename "$B"): deleting build-prefix rpath $RP"
        install_name_tool -delete_rpath "$RP" "$B"
        MOD=1
        ;;
    esac
  done
  if [ "$MOD" = "1" ]; then re_sign "$B"; fi
done

# ---------------------------------------------------------------------------
# Optional: place the supervisor binary at its LaunchAgent Program path.
# ---------------------------------------------------------------------------
if [ -n "$SUPERVISOR_BIN" ]; then
  test -x "$SUPERVISOR_BIN" || die "SUPERVISOR_BIN not executable: $SUPERVISOR_BIN"
  APP_ROOT="$(cd "$(dirname "$BUNDLE")/../.." && pwd)"   # .../MediVault.app
  MACOS_DIR="$APP_ROOT/MacOS"
  mkdir -p "$MACOS_DIR"
  cp "$SUPERVISOR_BIN" "$MACOS_DIR/mediavault-supervisor"
  echo "[stage] supervisor binary -> $MACOS_DIR/mediavault-supervisor"
fi

echo "[stage] done — layout:"
find "$BUNDLE" | sed "s|$BUNDLE|<BUNDLE>|" | sort
echo "bundle size: $(du -sh "$BUNDLE" | cut -f1)"
echo "file count:  $(find "$BUNDLE" -type f | wc -l | tr -d ' ')"
echo "STAGE-PG-BUNDLE-GREEN"

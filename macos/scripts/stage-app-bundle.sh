#!/usr/bin/env bash
# =============================================================================
# stage-app-bundle.sh — assemble the COMPLETE MediVault.app runtime tree
# (Node/PG app-bundle staging stage).
#
# Preconditions: the .app root already contains the supervisor binary and
# the PG runtime bundle (macos/scripts/stage-pg-bundle.sh with
# SUPERVISOR_BIN=...). This script adds:
#
#   Contents/Resources/runtime/nodejs/bin/node   (pinned nodejs.org runtime)
#   Contents/Resources/api/                      (staged API runtime tree)
#   Contents/Resources/provision/                (provisioner dist + package.json)
#   Contents/Resources/prisma-cli/node_modules/{prisma,@prisma/engines}
#   Contents/Resources/prisma/                   (schema.prisma + migrations/)
#   Contents/Library/LaunchAgents/dev.medivault.supervisor.plist
#
# The supervisor config JSON is NOT written here (it is environment-specific:
# CI points at the staged tree, production at /Applications) — the caller
# writes it to Contents/Resources/supervisor-config.json.
#
# Usage (env):
#   APP_ROOT=/path/MediVault.app \
#   NODE_TARBALL=/path/node-v22.23.2-darwin-arm64.tar.gz \
#   API_STAGE=$RUNNER_TEMP/medivault-api \
#   PROVISION_DIR=macos/provision \
#   PRISMA_MODULES=node_modules \
#   PRISMA_SCHEMA_DIR=packages/db/prisma \
#   LAUNCHAGENT_SRC=macos/launchagent/dev.medivault.supervisor.plist \
#   bash macos/scripts/stage-app-bundle.sh
# =============================================================================
set -euo pipefail

APP_ROOT="${APP_ROOT:?APP_ROOT (.app root) is required}"
NODE_TARBALL="${NODE_TARBALL:?NODE_TARBALL (verified node tarball) is required}"
API_STAGE="${API_STAGE:?API_STAGE (staged api runtime tree) is required}"
PROVISION_DIR="${PROVISION_DIR:?PROVISION_DIR (macos/provision) is required}"
PRISMA_MODULES="${PRISMA_MODULES:?PRISMA_MODULES (repo node_modules) is required}"
PRISMA_SCHEMA_DIR="${PRISMA_SCHEMA_DIR:?PRISMA_SCHEMA_DIR (packages/db/prisma) is required}"
LAUNCHAGENT_SRC="${LAUNCHAGENT_SRC:?LAUNCHAGENT_SRC (plist source) is required}"

die() { echo "::error::stage-app-bundle: $*" >&2; exit 1; }

[ -d "$APP_ROOT/Contents" ] || die "$APP_ROOT is not an app bundle root (no Contents/)"
[ -x "$APP_ROOT/Contents/MacOS/mediavault-supervisor" ] || die "supervisor binary missing (run stage-pg-bundle.sh with SUPERVISOR_BIN first)"
[ -d "$APP_ROOT/Contents/Resources/runtime/postgresql/17" ] || die "PG bundle missing (run stage-pg-bundle.sh first)"
[ -f "$NODE_TARBALL" ] || die "NODE_TARBALL missing: $NODE_TARBALL"
[ -f "$API_STAGE/api/dist/index.js" ] || die "API entry missing in API_STAGE"
[ -f "$PROVISION_DIR/dist/index.js" ] || die "provisioner dist missing (build macos/provision first)"
[ -f "$PRISMA_MODULES/prisma/build/index.js" ] || die "prisma CLI JS entry missing in $PRISMA_MODULES"
[ -f "$PRISMA_SCHEMA_DIR/schema.prisma" ] || die "prisma schema missing"
[ -f "$LAUNCHAGENT_SRC" ] || die "LaunchAgent plist source missing"

RES="$APP_ROOT/Contents/Resources"

echo "[node] extracting the pinned Node runtime into $RES/runtime/nodejs"
rm -rf "$RES/runtime/nodejs"
TMP_NODE="$(mktemp -d)"
tar -xzf "$NODE_TARBALL" -C "$TMP_NODE"
NODE_DIR="$(find "$TMP_NODE" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$NODE_DIR" ] || die "node tarball layout unexpected (no top-level dir)"
[ -x "$NODE_DIR/bin/node" ] || die "node binary missing in tarball"
mkdir -p "$RES/runtime/nodejs/bin"
cp "$NODE_DIR/bin/node" "$RES/runtime/nodejs/bin/node"
"$RES/runtime/nodejs/bin/node" --version
rm -rf "$TMP_NODE"

echo "[api] copying the staged API runtime tree"
rm -rf "$RES/api"
cp -R "$API_STAGE/api" "$RES/api"
test -f "$RES/api/dist/index.js"
test -f "$RES/api/package.json"

echo "[provision] copying the provisioner"
rm -rf "$RES/provision"
mkdir -p "$RES/provision"
cp -R "$PROVISION_DIR/dist" "$RES/provision/dist"
cp "$PROVISION_DIR/package.json" "$RES/provision/package.json"
test -f "$RES/provision/dist/index.js"

echo "[prisma] copying the staged prisma CLI node_modules (FULL dependency closure: effect etc.)"
rm -rf "$RES/prisma-cli"
mkdir -p "$RES/prisma-cli"
cp -R "$PRISMA_MODULES" "$RES/prisma-cli/node_modules"
test -f "$RES/prisma-cli/node_modules/prisma/build/index.js"
test -d "$RES/prisma-cli/node_modules/@prisma/engines" || die "@prisma/engines missing (migrate deploy needs the schema engine)"
test -d "$RES/prisma-cli/node_modules/effect" || die "effect missing — the prisma CLI runtime closure is incomplete (@prisma/config requires it)"

echo "[prisma] copying schema + migrations"
rm -rf "$RES/prisma"
cp -R "$PRISMA_SCHEMA_DIR" "$RES/prisma"
test -f "$RES/prisma/schema.prisma"
MIGRATIONS="$(find "$RES/prisma/migrations" -maxdepth 1 -mindepth 1 -type d | grep -v migration_lock | wc -l | tr -d ' ')"
echo "  migrations packaged: $MIGRATIONS"

echo "[launchagent] copying the plist"
mkdir -p "$APP_ROOT/Contents/Library/LaunchAgents"
cp "$LAUNCHAGENT_SRC" "$APP_ROOT/Contents/Library/LaunchAgents/dev.medivault.supervisor.plist"

echo "[done] full bundle layout:"
# sed reads to EOF (no SIGPIPE under set -o pipefail, unlike `head`).
find "$APP_ROOT" -not -path "*/runtime/postgresql/17/share/*" -not -path "*/runtime/postgresql/17/lib/*" | sed "s|$APP_ROOT|<APP>|" | sort | sed -n '1,60p'
echo "bundle size: $(du -sh "$APP_ROOT" | cut -f1)"
echo "STAGE-APP-BUNDLE-GREEN"

# MediVault — macOS 26 (Tahoe) Smoke Contract (stage: macos-26-smoke)

Status: **AUTHORED — awaiting first public dispatch** (stage 6 of the
macOS campaign; first-red discipline applies until GREEN, then FREEZE)
Lane: `platform/macos` (private) → `7clan/medivault-ci-public` (mirror)
Predecessor stages (FROZEN GREEN): `integration` @ `a282f45`
(34031521912), `pg-bundle-verify` @ `795df26` (34051758040),
`supervisor-lifecycle` @ `c71ac4c` (34063917607), `provision-lifecycle`
@ `1a0c48f` (34065567722), `bundle-verify` @ `2089913` (34066717890),
`desktop-build` @ `59e3155` (34075676148), `dmg` @ `9623a48`
(34077839660)

## 0. Purpose — COMPATIBILITY validation, not development

The frozen product contracts (stages 1–5) are re-run on the NEWEST macOS
on **native** public GitHub-hosted runners. Runner labels verified
against `actions/runner-images` before authoring (2026-09-07):

| Arch | Runner label | Native proof |
|------|--------------|--------------|
| arm64 | `macos-26` | `uname -m == arm64` + `sysctl.proc_translated == 0` (never Rosetta) |
| x86_64 | `macos-26-intel` | `uname -m == x86_64` (no Rosetta exists on Intel) |

**No product changes are made merely because SDK/runtime versions are
newer.** If RED: fix only the first PROVEN macOS-26-specific issue in
private `platform/macos`, sync to the public mirror, retest.

## 1. What runs (mode: `macos-26-smoke`)

The full frozen `dmg` pipeline, **unchanged** (same steps, pinned
versions, `MACOSX_DEPLOYMENT_TARGET=13.0`, and the SAME cache keys —
the frozen macos-15-built PG 17.11 dt13 artifacts are restored and run
on Tahoe):

1. frontend static export → `cargo tauri build` (app bundle, per-arch)
2. supervisor (rust, ad-hoc signed) + provisioner (tsc) + API (tsc) +
   prisma generate; staged API runtime + prisma CLI closure + pinned
   nodejs.org Node 22 tarball (SHA-256 fail-closed)
3. PG 17.11 from the pinned postgresql.org source (cache key shared
   with the frozen lanes; a cache miss rebuilds the SAME dt13 contract
   on the macos-26 toolchain)
4. backend merged into the Tauri `MediVault.app` (frozen
   `stage-pg-bundle.sh` + `stage-app-bundle.sh` + supervisor config)
5. ad-hoc codesign + the fail-closed Mach-O gate on EVERY native binary
   group (desktop, supervisor, node, PG)
6. DMG construction + verification (`build-dmg.sh`: UDZO, drag layout,
   mount/structure/signature asserts, SHA-256 sidecar)

Then the macOS-26-specific proofs:

7. **App copy/extraction**: mount the DMG, `cp -R` the app OUT of the
   mounted volume, detach, re-verify `codesign` + Mach-O gates on the
   COPIED tree (install simulation; native arch + minOS ≤ 13.0 +
   deps `/usr/lib`+`/System` only — "no unexpected new dylib/runtime
   dependency" is enforced fail-closed on Tahoe).
8. **Keychain basic access**: real runner login-keychain bootstrap via
   the supervisor's `bootstrap-secrets` (5 items created, then 5×
   "already present" on the idempotent second run), existence proven
   with `security find-generic-password`; values never printed. CI seed
   values (see §3) ride the supervisor's own proven `SecItemAdd` path.
9. **Supervisor lifecycle from the INSTALLED app**: delegated CLEAN
   provisioning → healthy; bundled PostgreSQL starts (supervisor spawn
   + independent `pg_isready`); authenticated `SELECT 1` as the app
   role (independent `psql` probe); existing migrations/schema
   (`_prisma_migrations` count == 8); Node/API startup on the PACKAGED
   node binary; `/health` 200 + `/ready` 200; graceful SIGTERM ladder →
   exit 0, state `stopped`, zero owned orphans, `postmaster.pid` gone.
10. **Tauri launch smoke from the INSTALLED app** (headless, honest):
    the desktop binary starts, stays alive ≥ 15s, terminates on
    SIGTERM. WKWebView/window initialization at the hosted-CI level;
    full window UX remains an interactive proof.

## 2. Report fields (per the stage-6 directive)

PRIVATE SOURCE SHA / PUBLIC SNAPSHOT SHA / per-arch RUNNER + UNAME +
PG + API + SUPERVISOR + KEYCHAIN BASIC PROOF + TAURI + DMG +
MACH-O/MINOS / RESULT (ARM64 + INTEL GREEN/RED) / any Tahoe-specific
regression. Both-arch GREEN ⇒ FREEZE `macos-26-smoke` and proceed to
`reinstall-acceptance`.

## 3. CI keychain seed values (supervisor change, additive)

`bootstrap-secrets` now honors optional `MV_KEYCHAIN_SEED_<ACCOUNT>`
env vars (shape-validated against the account's generated-value shape;
fail-closed on mismatch; still ONLY-if-absent, never overwrites).
Hosted CI sets known test values so the harness can additionally prove
an INDEPENDENT authenticated `SELECT 1` (and, in stage 7, create/verify
the DB sentinel). The values are never echoed, logged, or uploaded; the
runner is ephemeral; a doctor machine never sets these vars, so
production behavior is byte-identical (random generation through the
same proven `SecItemAdd` path). This is the ONLY product-tree change of
this stage — additive, and the frozen `supervisor-lifecycle` mode never
sets the vars.

## 4. Explicitly NOT proven here (honesty)

- Real interactive doctor-machine behavior (SMAppService registration
  states, Login Items approval, logout/login persistence, Gatekeeper,
  keychain prompt UX) — interactive acceptance list.
- Developer ID / hardened runtime / nested Mach-O signing /
  notarization / stapling — production phase requiring user Apple
  credentials.
- Launching from the MOUNTED volume (translocation) — clean-machine
  proof. (The smoke installs by copying OUT of the mounted volume,
  which is exactly the drag-install path.)

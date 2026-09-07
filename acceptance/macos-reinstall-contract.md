# MediVault — macOS Reinstall / Uninstall Acceptance Contract (stage: reinstall-acceptance)

Status: **FROZEN GREEN** (stage 7 of the macOS campaign — frozen
2026-09-07T21:00Z). Evidence: public run **34159463755** @ mirror
snapshot `adf2439` (= private `04828f5`) — `reinstall-acceptance
(arm64)` job **101858055678** GREEN (20:27:24→20:39:15Z) and
`reinstall-acceptance (x64)` job **101858055511** GREEN
(20:27:20→20:58:15Z). First-red ledger (all new-lane issues, zero
frozen-product changes): (1) run 34155527771 — CASE 2 asserted a
provisioner classification line the supervisor-restart path never
produces → proof switched to provision.log invariance (088e440);
(2) run 34156668748 — CASE 3b referenced DMG_B without sourcing
/tmp/dmg-b.env (cd8cc85); (3) run 34158152261 — CASE 4a pre-seeded a
sentinel table into the interrupted app-db (prisma P3005 ambiguous
baseline, production-impossible state) → construction now
production-realistic with the sentinel seeded post-resume (04828f5).
Lane: `platform/macos` (private) → `7clan/medivault-ci-public` (mirror)
Predecessor stages (FROZEN GREEN): `integration`, `pg-bundle-verify`,
`supervisor-lifecycle`, `provision-lifecycle`, `bundle-verify`,
`desktop-build`, `dmg` (see the dmg contract for the SHAs/runs), plus
`macos-26-smoke` (must be FROZEN GREEN first).

## 0. Rules of engagement

- Uses the ACTUAL `.app` and `.dmg` artifacts (never `target/debug`
  binaries): everything installs by mounting a DMG and copying
  `MediVault.app` out of it, like a user drag-install.
- Real user data locations: `~/Library/Application Support/MediVault`,
  `~/Library/Logs/MediVault`, the REAL login keychain, per-user
  install at `~/Applications/MediVault.app`. Native `macos-26` /
  `macos-26-intel` runners, both arches.
- A VALID database is NEVER destroyed as a recovery shortcut.
- Only MediVault-owned processes are ever stopped (PID /
  process-tree / canonical-path rules) — never by executable name.
- No destructive uninstall workflow is implemented (uninstall = remove
  the app; data preservation is the CONTRACT). Patient-data destruction
  remains a separate, explicit, future operation.

## 1. CASE 1 — FRESH INSTALL (+ first-run provisioning + sentinel)

Fresh simulated user state (no Application Support, no Logs, empty
keychain): mount DMG **A** (build v0.1.0) → install to
`~/Applications` (codesign + Mach-O gates on the installed tree;
`CFBundleShortVersionString` asserted) → re-point the installed app's
supervisor config to the REAL user data paths → keychain bootstrap
(5 items created via the supervisor; second run proves 5×
no-overwrite idempotence) → supervisor `run` → delegated CLEAN
provisioning → healthy → proofs: `pg_isready`, authenticated
`SELECT 1` as the app role, API on the packaged node, `/health` +
`/ready` 200 → create the harmless synthetic DB sentinel:

```
CREATE TABLE ci_reinstall_sentinel (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT ... VALUES ('CI_REINSTALL_SENTINEL_<run_id>_<arch>_<epoch>');
```

Preservation witnesses captured: `PG_VERSION` SHA-256, provisioned
marker `createdAt`, provision.log `initdb` occurrence baseline.
Graceful SIGTERM: exit 0, `stopped`, zero orphans.

## 2. CASE 2 — APP RESTART

Re-run the supervisor from the installed app: VALID_EXISTING → healthy
(`/health` + `/ready`), sentinel STILL PRESENT, `PG_VERSION` sha
unchanged, provisioned `createdAt` unchanged, provision.log
byte-identical to the case-1 capture (the frozen supervisor never
re-invokes the provisioner when the cluster exists — that IS the
VALID_EXISTING restart path, fail-closed by design), initdb
occurrences NOT grown ⇒ cluster NOT re-initialized. Graceful stop.

## 3. CASE 3 — REINSTALL / UPGRADE (app replacement)

With the existing valid Application Support tree and owned processes
already stopped gracefully: build **B** — a NEWLY BUILT version
(`tauri.conf.json` version 0.1.0 → 0.1.1; fresh `cargo tauri build`;
fresh backend merge, ad-hoc signing, Mach-O gates, DMG B; the
CFBundleVersion delta is asserted on the installed bundle). Then:

- remove `~/Applications/MediVault.app` → install from DMG B (v0.1.1)
- reconcile/migrate from the NEW app's packaged provisioner
  (VALID_EXISTING + idempotent migrations — the exact flow a
  migration-carrying upgrade performs)
- PRESERVED: Application Support tree + provisioned.json + Logs
  (`~/Library/Logs/MediVault`), Keychain material (5/5 items, no
  overwrite, credentials still authenticate — proven by the healthy
  run against the SAME cluster)
- supervisor healthy, `/health` + `/ready`
- sentinel AFTER REINSTALL: PRESENT; `PG_VERSION` sha unchanged;
  provisioned `createdAt` unchanged; initdb count not grown ⇒
  **PG CLUSTER REINITIALIZED: MUST BE NO** (and is NO)
- graceful stop + zero orphans

Honesty note: within one CI run, builds A and B differ by the
CFBundleVersion stamp and the freshly rebuilt/re-staged bundle (the
desktop Mach-O may be byte-identical if cargo reuses its cache); TRUE
cross-version (different product code) reinstall is a doctor-machine
acceptance item. The replacement mechanics — the actual contract under
test — are fully exercised.

## 4. CASE 4 — RECOVERY / INTERRUPTED STATES

Classification-level cases (the frozen provision-lifecycle pattern,
now driven from the INSTALLED app's packaged node + provisioner +
prisma + PG on macOS 26, with isolated app-support trees):

- **4a RECOVERABLE_INCOMPLETE** ("app replaced but provisioning not
  completed"): constructed state = cluster + app role + app db DONE,
  migrations NOT done, `provision-pending.json` present, app-db EMPTY
  (the production-realistic interrupted state — nothing but the
  provisioner writes to the app-db before completion; a pre-seeded
  sentinel table would be a prisma P3005 ambiguous baseline, which the
  provisioner correctly refuses fail-closed). Provisioner must resume
  EXACTLY (migrations + completion marker, pending removed),
  `PG_VERSION` sha unchanged, role/db identity preserved; then the
  supervisor runs the recovered state to healthy (proving it is
  production-usable) and the sentinel is seeded POST-resume as the app
  role (writability proof); graceful stop.
- **4b FAIL-CLOSED (pending + unexpected state)**: pending marker +
  an unexpected non-template database. Provisioner exits 5
  (INCOMPLETE_EXISTING) with NOTHING altered: cluster file count
  equal, `PG_VERSION` sha equal, no provisioned.json created, pending
  marker still present, no server left running.
- **4c FAIL-CLOSED (valid cluster, missing trust anchor)**: fully
  valid app-db cluster but NO markers at all (missing/partial runtime
  state). Provisioner exits 5, nothing altered, never auto re-init.
- **4d STALE PENDING MARKER**: a stale `provision-pending.json` over
  the valid completed install (crash-after-completion simulation):
  reconciled (marker removed), VALID verify path, sentinel + cluster
  preserved, supervisor healthy.

CLEAN (case 1) and VALID_EXISTING (cases 2/3) complete the 4-state
equivalence with the frozen classification contract.

## 5. CASE 5 — UNINSTALL CONTRACT

Remove `~/Applications/MediVault.app` (the application only). Expected:
**APPLICATION REMOVED / DATA PRESERVED**. Proven fail-closed:

- Application Support tree intact (`PG_VERSION` sha unchanged from
  case 1, provisioned.json present) + Logs present
- Keychain entries PRESERVED (5/5 existence)
- The preserved cluster still holds the sentinel: the cluster is
  started with the REFERENCE PG runtime (the dt13 build) and the
  sentinel row is queried as the superuser → count == 1 → stopped
  cleanly, zero postgres processes
- No PostgreSQL cluster, storage, patient data, backups, or Keychain
  entries are ever deleted by uninstall (there IS no destructive
  uninstall workflow in v1)

## 6. PROCESS SAFETY (whole matrix)

Unrelated control processes are planted up front and must survive
EVERY stop/restart cycle of the matrix (checked after each case):

- `/bin/sleep` copied to `/tmp/r7-unrelated/postgres` (running as
  `postgres 4321` — a naive `pkill postgres` would kill it)
- `/bin/sleep` copied to `/tmp/r7-unrelated/pg_ctl` (running as
  `pg_ctl 4322`)
- an unrelated `node -e 'setInterval(...)'` process (a naive
  `pkill node` would kill it — and the CI runner itself)

The supervisor's owned-process discipline (direct children, PID tree,
canonical paths) is the mechanism under witness; nothing in this job
ever kills by executable name.

## 7. CI keychain seed values

Same supervisor mechanism as the macos-26-smoke contract (§3 there):
`MV_KEYCHAIN_SEED_<ACCOUNT>` env vars, shape-validated, only-if-absent,
never overwritten, values never printed/uploaded. They exist so the
harness can construct the interrupted states with the SAME credentials
the keychain holds, create/verify the sentinel, and drive the
provisioner directly (the provisioner's documented contract is
env-injected secrets — it never reads the keychain itself).

## 8. Explicitly NOT proven here (honesty)

- SMAppService / Login Items states, logout/login, reboot, Finder DMG
  UX, drag-to-Applications UX, double-click launch UX, Gatekeeper
  dialogs, keychain prompt behavior — INTERACTIVE MAC acceptance list
  (deliberately not blocking this stage).
- TRUE cross-version (different product code) replacement — see §3
  honesty note.
- Login Items-driven supervisor start (launchd) — the lifecycle is
  proven in the foreground supervisor mode (the frozen
  supervisor-lifecycle contract); LaunchAgent registration semantics
  stay interactive.
- Developer-ID-signed behavior — production phase.

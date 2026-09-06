# MediVault — macOS Supervisor Contract (stage: supervisor-lifecycle)

Status: **FROZEN GREEN** (stage: supervisor-lifecycle — do not reopen unless
a later first-red directly proves this contract wrong)
Lane: `platform/macos` · Verified GREEN @ `c71ac4c`, run `34063917607`
(both arches, 2026-09-06) · Predecessor stages (FROZEN GREEN, not
reopened): `integration` @ `a282f45` (run `34031521912`),
`pg-bundle-verify` @ `795df26` (run `34051758040`)
First-red ledger for this stage (all fixed in the private lane, mirrored
after each fix): (1) run `34062829878` — stage-pg-bundle app-root path
math (2 levels up → Contents/Resources); (2) run `34063304408` —
executable dir omitted the Contents/ component (`.app/MacOS` vs
`.app/Contents/MacOS`); (3) run `34063575936` — harness provisioned the
cluster at a _temp path while the supervisor resolves the production
layout `<app_support>/PostgreSQL/17/data` (supervisor fail-closed
correctly; harness moved to the production layout, proving the real
contract). GREEN run 34063917607: Mach-O gates GREEN (supervisor binary
+ PG bundle re-proof, both arches), startup → healthy, independent
pg_isready/SCRAM SELECT 1//health//ready proofs, single-instance lock
exit 3, SIGKILL crash-resilience (restart 1/5, ~1 s, healthy again,
/health 200), graceful SIGTERM ladder (API signal 15 exit 0 → PG signal
2 exit 0 → supervisor exit 0, state stopped, zero orphans, postmaster.pid
gone), log redaction GREEN.

---

## 1. What this stage delivers

`macos/supervisor/` — the `mediavault-supervisor` binary: one small native
Rust process that owns the entire backend lifecycle on the doctor's Mac.
It is the replacement for the Windows service stack
(`node-windows`/WinSW + `medivault-service.js` env injector) — a
RE-implementation, not a port.

| Concern | Windows (frozen) | macOS supervisor (this stage) |
|---|---|---|
| Process identity | SCM service `medivaultapi.exe` | user-scoped LaunchAgent `dev.medivault.supervisor` (SMAppService) |
| Env/secret injection | `secure-config.json` → service env | config JSON (non-secret) + SecretsProvider (env now, Keychain next stage) → child env |
| PG lifecycle | `pg_ctl` via PowerShell | direct child + SIGINT fast shutdown ladder |
| Crash resilience | SCM recovery + WinSW | launchd `KeepAlive` (outer) + supervisor restart backoff (inner) |
| Graceful stop | SCM stop → SIGTERM | SIGTERM/SIGINT → API TERM → PG fast ladder → exit 0 |

## 2. Binary contract

- Crate: `macos/supervisor` (edition 2021, deps: `libc`, `serde`,
  `serde_json` ONLY — deliberately no tokio/reqwest/keyring; the resulting
  Mach-O links libSystem only, keeping the dependency gate trivial).
- Built per-architecture natively (`aarch64-apple-darwin` /
  `x86_64-apple-darwin`), `MACOSX_DEPLOYMENT_TARGET=13.0`, toolchain
  pinned by the repo-root `rust-toolchain.toml`.
- Subcommands:
  - `run --config <path>` — foreground supervision loop (what the
    LaunchAgent runs and what CI proves);
  - `status --config <path>` — print the status JSON;
  - `version`.
- Exit codes (stable contract): `0` clean SIGTERM shutdown; `1` fatal
  fail-closed; `2` status file missing/unreadable; `3` another instance
  holds the lock; `4` config missing/invalid; `5` cluster not provisioned.
- Single instance: advisory `flock(LOCK_EX|LOCK_NB)` on
  `<app-support>/runtime-state/supervisor.lock` — kernel-released on
  death, so a crashed supervisor never leaves a stale lock.

## 3. Config contract (non-secret half only)

`config.production.example.json` documents the full schema (v1,
`deny_unknown_fields`). Secrets NEVER appear in this file — they come
from the `secrets.source` seam:

- `env` (this stage + CI): `MV_PG_APP_PASSWORD`, `MV_AUTH_JWT_SECRET`,
  `MV_MEDIVAULT_MASTER_KEY` — read once at startup, injected into the
  Node child's environment only, never logged, never written to any file.
- `keychain` (next stage, Keychain/provisioning): fails closed today
  with an explicit not-yet-wired error rather than silently degrading.

Derived paths (production): app-support
`~/Library/Application Support/MediVault` (leading `~` expands via
`$HOME`), logs `~/Library/Logs/MediVault/{supervisor,postgres,api}.log`,
status `<app-support>/runtime-state/supervisor-status.json`, cluster
`<app-support>/PostgreSQL/17/data` — NEVER inside the .app bundle.

## 4. Startup sequence (fail-closed at every step)

1. resolve + validate config (all executables must exist);
2. create app-support/log/runtime-state/storage dirs;
3. require `PG_VERSION` in PGDATA (cluster provisioned by the
   provisioner — the supervisor NEVER initializes or re-initializes a
   cluster; exit 5 otherwise);
4. acquire the single-instance lock;
5. start `postgres -D <pgdata>` as a DIRECT child (logs → postgres.log);
6. bounded `pg_isready` poll (bundle binary, default 120 s);
7. authenticated `SELECT 1` AS THE APP ROLE via bundle `psql`
   (`PGPASSWORD` through env only — proves SCRAM through bundled libpq);
8. start the Node API as a direct child with the injected env contract
   (`PORT`, `HOST`, `DATABASE_URL` (password percent-encoded),
   `AUTH_JWT_SECRET`, `MEDIVAULT_MASTER_KEY`, `MEDIVAULT_DATA_DIR`,
   `ALLOWED_ORIGINS`, `TRUSTED_LOCAL_TLS_TERMINATION=true`,
   `NODE_ENV=production`);
9. bounded `GET /health` → HTTP 200 (hand-rolled HTTP/1.1 over
   TcpStream — no HTTP client crate);
10. status → `healthy`.

## 5. Supervision

- 250 ms tick: reap both children (`try_wait`); a dead child (BOTH
  normal exits and signal deaths — `status.code()` is `None` for signal
  deaths and must never be confused with "still running") triggers the
  restart path immediately.
- Restart path: bounded exponential backoff (500 ms doubling, cap 8 s),
  max restarts per child (default 5) — exceeding it is fail-closed
  (graceful stop of everything, status `failed`, exit 1). After a child
  restarts, its own readiness gate runs again (pg_isready / /health)
  before the state returns to `healthy`.
- Periodic health (every `health_interval_sec`, default 5 s): `pg_isready`
  + `GET /health`; 3 consecutive failures of either → restart that child
  (covers hung-but-alive children that exit-code supervision cannot see).
- The status file is heartbeat-rewritten (atomic tmp+rename) so
  "is the supervisor fresh?" is always answerable.

## 6. Shutdown ladder (SIGTERM/SIGINT to the supervisor)

1. status → `stopping`;
2. API: SIGTERM (Fastify's proven graceful close) → bounded (default
   30 s) → SIGKILL;
3. PostgreSQL: **SIGINT = fast shutdown** (never SIGTERM/smart first,
   never SIGKILL first) → bounded (default 60 s) → SIGQUIT (immediate)
   → bounded → SIGKILL;
4. status → `stopped`, pids cleared, exit **0**.

Both children are reaped by the supervisor — CI proves zero orphan
processes after exit.

## 7. LaunchAgent contract

`macos/launchagent/dev.medivault.supervisor.plist` ships inside the app
bundle at `Contents/Library/LaunchAgents/` (registered via
`SMAppService.agent` from the desktop app at first-run setup —
macOS 13+). Label `dev.medivault.supervisor`, `RunAtLoad`, `KeepAlive`
(launchd = outer crash ring), `ProcessType Background`, `ExitTimeOut 90`
(> supervisor's worst-case graceful ladder). No StandardOut/ErrPath:
launchd capture paths must be per-user absolute, unknowable at
bundle-build time; the supervisor owns structured file logging
(pre-logging early crashes are observable via
`log show --predicate 'process == "mediavault-supervisor"'`).

SMAppService registration UX and the Login Items approval pane are
interactive proofs (cloud Mac / doctor's Mac) — deliberately NOT claimed
by CI. The app-bundle stage wires registration; this stage proves the
same binary's foreground lifecycle contract.

## 8. What CI proves (supervisor-lifecycle mode, both architectures)

1. Supervisor compiles natively per arch with
   `MACOSX_DEPLOYMENT_TARGET=13.0`;
2. **Mach-O gate on the supervisor binary**: single-arch matching the
   lane, `minOS <= 13.0` (vtool/`LC_BUILD_VERSION`), dependencies only
   `/usr/lib` + `/System` (no Homebrew, no `/usr/local`) — same
   fail-closed gate family as the frozen pg-bundle stage, via the
   reusable `macos/scripts/macho-gate.sh`;
3. The PG runtime bundle is re-staged from the pinned source
   (same frozen contract/layout, shared CI cache) and re-gated;
4. Harness pre-provisions the cluster (initdb SCRAM + app role + DB +
   migrations — the provisioner's job, landing next stage) and then
   STOPS it: the supervisor must START the existing cluster itself
   (production boot path);
5. Startup sequence reaches `healthy` (status file + independent
   pg_isready/psql/curl proofs);
6. A second supervisor instance fails fast (exit 3, lock error);
7. Crash resilience: `SIGKILL` the API child → supervisor restarts it
   (restarts=1) and returns to `healthy` with /health 200;
8. SIGTERM the supervisor → exit 0, status `stopped`, zero orphan
   postgres/node processes (pgrep proof);
9. Log redaction: the CI secret values never appear in supervisor.log,
   postgres.log, or api.log.

Stage-1 scope note (honest boundary): the Node child CI runs is the
runner's setup-node Node 22 — the pinned nodejs.org runtime staging +
hash gate lands with the Node/PG app-bundle stage, which re-proves this
lifecycle against the shipped runtime.

## 9. Explicit non-goals of this stage

- Keychain reads (secrets.source `keychain`) — Keychain/provisioning
  stage;
- initdb / 4-state classification / migrations — provisioner stage;
- SMAppService registration + Login Items UX — app-bundle/desktop stage;
- LAN mode, TLS listener — later phases per the audit.

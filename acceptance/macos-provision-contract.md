# MediVault — macOS Provisioner & Keychain Contract (stage: provision-lifecycle)

Status: **FROZEN GREEN** (stage: provision-lifecycle — do not reopen unless
a later first-red directly proves this contract wrong)
Lane: `platform/macos` · Verified GREEN @ `1a0c48f`, run `34065567722`
(both arches, 2026-09-06) · Predecessor stages (FROZEN GREEN, not
reopened): `integration` @ `a282f45` (run `34031521912`),
`pg-bundle-verify` @ `795df26` (run `34051758040`), `supervisor-lifecycle`
@ `c71ac4c` (run `34063917607`)
First-red ledger: (1) run `34065127029` — the B-matrix steps replaced
PATH and dropped setup-node's node dir (`node: command not found`);
cluster A (real login-keychain bootstrap + read-back + delegated
provisioning + graceful lifecycle) was GREEN already in that run.
(2) run `34065334408` — SQL boolean text-cast renders `true`/`false`
(`rolcanlogin || ','`), not psql's display form `t`/`f`; the provisioner's
role-identity parser and the CI assertion fixed (both spellings
normalized). GREEN run 34065567722: real login-keychain items created +
read back by the supervisor (same ad-hoc-signed binary), delegated
bootstrap with keychain-sourced random secrets to healthy, /health +
/ready 200, SIGTERM graceful exit 0 with zero orphans; the full 4-state
matrix with sentinel data-preservation (VALID_EXISTING never
re-initializes), stale-pending reconciliation, RECOVERABLE_INCOMPLETE
resume with exact role identity, INCOMPLETE_EXISTING fail-closed x2 with
nothing altered; log redaction GREEN.

---

## 1. What this stage delivers

1. **`macos/provision/`** — the macOS provisioner (Node 22, zero runtime
   deps, TypeScript → `dist/`): the native re-implementation of the frozen
   Windows `install-postgres.ps1` behavioral contract (the 4-state
   machine, crash-safe pending markers, idempotent application-database
   provisioning, fail-closed everywhere). PowerShell is NOT ported.
2. **Supervisor Keychain secret source** (`secrets.source: "keychain"`)
   + `bootstrap-secrets` subcommand: generic-password items under service
   `dev.medivault` (accounts `pg-app-password`, `pg-bootstrap`,
   `master-key`, `jwt-secret`, `csrf-secret`).
3. **Provisioner delegation** in the supervisor: an unprovisioned cluster
   + a configured provisioner → delegate + bounded wait (new
   `provisioning` status state). Absent provisioner block = the frozen
   stage-1 fail-closed behavior, unchanged.

## 2. The 4-state machine (offline + online)

Offline signals: `PG_VERSION` in PGDATA, `config/provisioned.json`
(completion marker, the trust anchor), `config/provision-pending.json`
(interruption signal with crash-safe stage flags). All marker writes are
atomic (tmp + rename).

| State | Signals | Action |
|---|---|---|
| `CLEAN` | no cluster, no markers | full bootstrap |
| `VALID_EXISTING` | cluster + consistent marker | online verify + idempotent migrations; NEVER re-initdb |
| `PENDING` | pending marker + cluster | ONLINE decision: (a) stale-complete marker on top → reconcile → VALID_EXISTING; (b) EXACTLY the recoverable interrupted app-db state → resume role/db/migrations only; (c) anything contradictory → INCOMPLETE_EXISTING |
| `PENDING` (no cluster) | pending marker, no PG_VERSION | INCOMPLETE_EXISTING — interrupted before initdb; never auto re-init |
| `INCOMPLETE_EXISTING` | cluster without a consistent marker, or marker without cluster | exit 5, NOTHING altered, manual intervention |

The online recoverable-state probe (Windows
`Test-RecoverableIncompleteInstallation` semantics): canonical cluster +
stored superuser credential authenticates + NO unexpected non-template
databases + NO unexpected login roles + app role absent-or-exact
(LOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE + authenticates) + app database
absent-or-owned-by-app-role. Only then: resume; PostgreSQL itself is never
reinstalled or reinitialized.

`VALID_EXISTING` verification failure (stored app-role credential does not
authenticate) is exit 6 — credentials are NEVER auto-reset and the cluster
is NEVER re-initialized.

## 3. Bootstrap flow (CLEAN)

pending marker → `initdb` (SCRAM local+host, superuser pw via `--pwfile`
0600 temp file, UTF8) → `postgresql.conf` (port + 127.0.0.1-only) →
`pg_ctl -w` bounded start → `pg_isready` → CREATE ROLE (LOGIN,
NOSUPERUSER) + CREATE DATABASE (OWNER) with existence checks →
`prisma migrate deploy` (configured CLI + schema, DATABASE_URL built with
percent-encoded app password) → authenticated `SELECT 1` as the app role →
`pg_ctl -m fast` stop → provisioned marker (atomic) → pending removed
(renamed to `.removed.<pid>` for forensics). Provisioner logs:
`<logDir>/provision.log`.

Secrets enter via environment ONLY (`MV_PG_SUPER_PASSWORD`,
`MV_PG_APP_PASSWORD`) — the provisioner NEVER touches the Keychain
(ACL prompts stay in the supervisor's binary, per the audit).

Exit codes: 0 ok; 2 usage; 4 config; 5 INCOMPLETE_EXISTING (fail closed);
6 VALID_EXISTING verification failure; 7 provisioning step failure; 8
missing secret env var.

## 4. Keychain contract (supervisor side)

- Service `dev.medivault`; accounts `pg-app-password`, `pg-bootstrap`
  (superuser), `master-key` (64-hex), `jwt-secret` (64-hex),
  `csrf-secret` (64-hex; stored for the future API CSRF seam, not
  injected today).
- `bootstrap-secrets --config <path>`: EXPLICIT first-run creation —
  random values (`/dev/urandom`), NEVER overwrites existing items, prints
  account NAMES only. `run` never auto-creates items (a regenerated master
  key would silently orphan every encrypted object — missing items fail
  closed listing the account names).
- `secrets.source: "keychain"` load: reads the required accounts; the
  supervisor injects values into child envs only; values never logged.
- Non-macOS builds: `keychain` source fails closed at config load
  (explicit error) — the module is `cfg(target_os = "macos")`.
- CI proof: the supervisor creates the items on the runner's real login
  keychain (SecItemAdd), then reads them back in a SECOND supervisor
  process (same binary → same ad-hoc code identity → same-keychain
  read-back without prompts).

## 5. Supervisor delegation contract

Config block (optional, additive — schema v1 keeps working without it):

```json
"provisioner": {
  "entry": "<abs>/provision/dist/index.js",
  "prisma_cli": "<abs>/prisma/build/index.js",
  "prisma_schema": "<abs>/packages/db/prisma/schema.prisma",
  "timeout_sec": 600
}
```

Startup order: cluster check → if unprovisioned AND provisioner
configured: status `provisioning` → spawn
`<node> <entry> provision --config <same config>` with env-injected
secrets (names only in logs; the provisioner's stdout inherits the
supervisor's) → bounded wait (timeout_sec; on timeout TERM+KILL the
child, fail closed) → re-check the marker → continue startup. Provisioner
failure = supervisor fail-closed (exit 1, status `failed`).

## 6. What CI proves (provision-lifecycle mode, both architectures)

Cluster A (keychain integration): supervisor binary ad-hoc re-signed
(keychain code-identity stability) → `bootstrap-secrets` on the runner's
REAL login keychain → item existence proven via `security
find-generic-password` (never `-w`) → supervisor `run` with
`secrets.source: "keychain"` + provisioner delegation → the provisioner
bootstraps the cluster with KEYCHAIN-sourced random secrets → healthy →
/health + /ready 200 → SIGTERM → exit 0, zero orphans, postmaster.pid
gone.

Cluster B (the 4-state matrix, real PG, env secrets): CLEAN bootstrap →
sentinel table+row → VALID_EXISTING re-provision with the SENTINEL ROW
SURVIVING (data-preservation witness: never re-initdb) → stale-pending
reconciliation → RECOVERABLE_INCOMPLETE resume (role+db dropped +
pending marker: exactly recreated, marker rewritten) → INCOMPLETE_EXISTING
(cluster, no marker) exit 5 with the cluster byte-count UNCHANGED →
INCOMPLETE_EXISTING (pending, no cluster) exit 5 with the moved-aside
cluster restored intact. Plus log redaction across all provisioner and
supervisor logs.

## 7. Non-goals / later stages

- The packaged app-bundle layout (Resources/provision, packaged prisma)
  — Node/PG app-bundle staging stage re-proves with the shipped tree.
- SMAppService registration UX — app-bundle/desktop stage.
- Keychain FIRST-RUN UX (ACL prompt on the doctor's Mac) — interactive
  proof, documented in the audit.

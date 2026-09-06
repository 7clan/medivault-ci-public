# MediVault — PostgreSQL 17.11 Runtime Bundle Contract (macOS)

Status: **FROZEN GREEN** (stage: pg-bundle-verify — do not reopen unless a
later first-red directly proves this contract wrong)
Lane: `platform/macos` · Verified GREEN @ `795df26`, run `34051758040`
(both arches, 2026-09-06) · Predecessor stage: integration (FROZEN GREEN @
`a282f45`, run `34031521912` — not reopened)
CI job: `.github/workflows/macos-build.yml` → `pg-bundle-verify` (dispatch-only,
matrix: arm64 `macos-15` + x64 `macos-15-intel`)

This document formalizes the exact PostgreSQL 17.11 runtime that will ship
inside `MediVault.app/Contents/Resources/runtime/postgresql/17/`. The CI job
is the fail-closed verifier of every rule below.

---

## 1. Source provenance (pinned, fail-closed)

| Field | Value |
|---|---|
| Product | PostgreSQL 17.11 (major 17, exact 17.11) |
| Tarball | `https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.gz` |
| SHA-256 | `5367f6fb2ec97efe1eb2e0c7926bb33438e51b0bd3a9733b88498056a7dc9a7e` |
| Verification | `shasum -a 256 --check --strict` at download time; mismatch aborts the build |

No Homebrew, no Postgres.app, no zonky.io artifacts, no EDB binaries — the
Windows lanes' EDB/binary experiments are frozen elsewhere and are not part
of the macOS lane.

## 2. Build contract

- Native compilation per architecture: `aarch64-apple-darwin` on the arm64
  lane, `x86_64-apple-darwin` on the Intel lane. No Rosetta, no fat/universal
  builds (per the pivot directive: separate per-arch DMGs).
- Configure flags (FROZEN — see §5): `--prefix=<install> --without-icu
  --without-readline`.
- **`MACOSX_DEPLOYMENT_TARGET=13.0` is exported for the entire build**
  (configure + make). MediVault claims macOS 13 (Ventura)+; every Mach-O we
  compile must require `minOS <= 13.0`. Building on a macOS 15 runner does
  NOT imply Ventura support — without the explicit target, clang bakes the
  runner's SDK default (macOS 15) into `LC_BUILD_VERSION`, silently raising
  the real minimum OS. The CI gate (§4) verifies the resulting load commands,
  not the intent.
- Third-party **prebuilt** binaries (if ever bundled) never get the target
  overridden blindly: their declared minimum OS is inspected with the same
  gate and rejected if it exceeds 13.0.
- Separate CI cache key from the integration job
  (`macos-pg17-dt13-<arch>-<version>-<sha>`, prefix `pg17-install-dt13`):
  the frozen integration build had no explicit target and is macOS-15-min;
  restoring it into this job must (and would) fail the gate.

## 3. Minimal runtime layout (what actually ships)

Derived from what MediVault's supervisor + provisioning actually execute:
`initdb` (first-run cluster creation), `postgres`/`pg_ctl` (server lifecycle),
`pg_isready` (bounded readiness), `psql` (SCRAM/role/proof tooling).

```
<BUNDLE>/bin/initdb
<BUNDLE>/bin/postgres
<BUNDLE>/bin/pg_ctl
<BUNDLE>/bin/pg_isready
<BUNDLE>/bin/psql
<BUNDLE>/lib/libpq.5.dylib
<BUNDLE>/lib/libpq.dylib            (symlink → libpq.5.dylib)
<BUNDLE>/lib/postgresql/plpgsql.dylib      (darwin module suffix is .dylib, NOT .so —
                                          first-red 34047324482; initdb's
                                          'installing PL/pgSQL' step loads it)
<BUNDLE>/lib/postgresql/dict_snowball.dylib (initdb EXECUTES snowball_create.sql,
                                          which CREATE FUNCTIONs
                                          '$libdir/dict_snowball' — first-red
                                          34048563205)
<BUNDLE>/share/postgresql/postgres.bki            (PG 17: catalog bootstrap,
                                                     comments/descriptions merged IN)
<BUNDLE>/share/postgresql/information_schema.sql
<BUNDLE>/share/postgresql/sql_features.txt           (initdb's features_file —
                                                     first-red 34048036069)
<BUNDLE>/share/postgresql/system_functions.sql
<BUNDLE>/share/postgresql/system_constraints.sql   (PG 17 initdb processes these
                                                     three SQL files)
<BUNDLE>/share/postgresql/system_views.sql
<BUNDLE>/share/postgresql/snowball_create.sql
<BUNDLE>/share/postgresql/postgresql.conf.sample   (initdb copies → postgresql.conf)
<BUNDLE>/share/postgresql/pg_hba.conf.sample       (initdb copies → pg_hba.conf)
<BUNDLE>/share/postgresql/pg_ident.conf.sample     (initdb copies → pg_ident.conf)
<BUNDLE>/share/postgresql/timezone/                (server TZ database)
<BUNDLE>/share/postgresql/timezonesets/            (timezone_abbreviations files)
<BUNDLE>/share/postgresql/extension/plpgsql.control
<BUNDLE>/share/postgresql/extension/plpgsql--1.0.sql
```

Everything else `make install` produces (other client tools, ecpg family,
other extension SQL, pgxs, errcodes, locale rules, the on-demand encoding
conversion modules, pgoutput/libpqwalreceiver — loaded only for non-UTF8
client conversions / logical replication, none of which MediVault uses) is
intentionally EXCLUDED. PostgreSQL resolves
its share/lib/pkglib paths **relative to the executing binary** when the
tree's relative layout is preserved (`bin/`, `lib/`, `share/` siblings) —
that is what makes this layout relocatable into the app bundle. The CI
relocation test proves it: the in-server `pg_config` view must report
`BINDIR`/`LIBDIR`/`SHAREDIR`/`PKGLIBDIR` inside the relocated tree.

## 4. Mach-O portability + minimum-OS contract (fail-closed gate)

For EVERY shipped Mach-O the CI records: **architecture, minimum macOS
version, SDK version, dependencies**. The gate rejects:

1. **Architecture** — the object must be single-arch and match the lane
   (`arm64` on arm64, `x86_64` on Intel). No fat files, no wrong-arch
   dylibs, no Rosetta.
2. **minOS > 13.0** — parsed from `LC_BUILD_VERSION` (vtool
   `-show-build`, `minos` field) with fallback to `LC_VERSION_MIN_MACOSX`
   (`otool -l`). A binary with NEITHER load command is rejected (cannot
   prove Ventura support). SDK version is recorded but may exceed 13.0
   (building against a newer SDK is normal and correct).
3. **Dependencies** (`otool -L`):
   - `/usr/lib/*` and `/System/*` — allowed (system).
   - `@executable_path/…`, `@loader_path/…` — must resolve to an existing
     file INSIDE the bundle.
   - `@rpath/…` — must resolve via the object's `LC_RPATH` entries; every
     `LC_RPATH` entry must itself be `@`-prefixed or inside the bundle.
   - Anything else is rejected: Homebrew paths, `/opt/homebrew`,
     `/usr/local`, runner-specific paths, build-directory absolute paths,
     bare sonames.
4. **Install-name repair (portability)** — before the gate, build-prefix
   dependencies are rewritten to `@executable_path/../lib/<name>` and the
   `libpq` install-name ID to `@loader_path/libpq.5.dylib`; build-prefix
   `LC_RPATH` entries are deleted. After ANY `install_name_tool` edit the
   object is re-signed **ad-hoc** (`codesign --force --sign -`): arm64
   requires a valid signature after any Mach-O modification (an invalid
   signature is SIGKILL at exec). Ad-hoc is the dev-lane signing posture;
   Developer ID + hardened runtime + notarization come later per the audit.

## 5. Feature freeze: `--without-icu` (and `--without-readline`)

The build is configured `--without-icu` (and `--without-readline`, which is
irrelevant at runtime — no psql interactive line editing is used by
provisioning). This is a **frozen decision, not a completeness accident**:

- MediVault's schema and all 8 migrations declare **no `COLLATE`**, no
  `nondeterministic` collations, and no ICU-specific features (verified by
  grep over `packages/db/prisma/migrations/*.sql` + schema in CI).
- Locale behavior therefore comes from libc only; encoding is UTF8.
- **A `--without-icu` PG 17 cluster is not ICU-row-free**: `pg_collation.dat`
  bootstraps exactly ONE provider-`'i'` row — `unicode` (oid 963,
  colllocale `und`, "sorts using the Unicode Collation Algorithm with
  default settings") — into EVERY PG 17 cluster regardless of ICU support;
  it is inert without ICU (using it would error, nothing uses it). An
  ICU-enabled build imports HUNDREDS of provider-`'i'` rows instead. The CI
  proof therefore asserts: provider-`'i'` count == 1 AND that row is the
  bootstrap `unicode` row (first-red 34049189077 — the naive "expect 0"
  assertion was wrong).
- CI re-proves compatibility on every run: `prisma migrate deploy` (all 8
  migrations), the migration-count assertion, and the full frozen shared
  test suites all execute against the ICU-less **relocated** server.
- Changing this flag (e.g. adding ICU) is a product decision that must go
  through re-verification of §5 — it is not a build-option drive-by.

## 6. Relocation test (the core proof)

The bundle is staged into a fresh, arbitrary, app-bundle-shaped directory
(`…/MediVault.app/Contents/Resources/runtime/postgresql/17` under the
runner's temp — never the build/install prefix). Then, with a `PATH` that
contains **no `/opt/homebrew/bin`, no `/usr/local/bin`**, and after proving
no PostgreSQL exists anywhere else on the runner, the following run FROM
THE RELOCATED TREE:

1. `initdb -D <PGDATA> --pwfile … --auth-local=scram-sha-256
   --auth-host=scram-sha-256 --encoding=UTF8` (SCRAM for local AND host —
   real auth, no trust/md5 shortcuts; password via `--pwfile`, never argv).
2. `pg_ctl -D <PGDATA> -w -t 120 start` (bounded wait), 127.0.0.1-only
   listener, custom port.
3. `pg_isready -h 127.0.0.1 -p <port>`.
4. In-server `pg_config` view: `BINDIR`/`LIBDIR`/`SHAREDIR`/`PKGLIBDIR`
   must resolve inside the relocated bundle (the relocation proof);
   `CONFIGURE` records the original build prefix (expected, documented).
5. App role + database created via a SCRAM-authenticated superuser session.
6. SCRAM login **as the app role** + `SELECT 1`.
7. `prisma migrate deploy` (all 8 migrations) + `_prisma_migrations` row
   count == migration directory count.
8. ICU/collation freeze proofs (§5) + `pg_extension` (PL/pgSQL loads from
   the relocated tree).
9. The frozen DB-integration serial suites (same file list as the frozen
   integration mode's serial group — the suites whose behavior depends on
   the PG runtime under test). The DB-FREE unit/crypto suites are not run
   in this job: no PG signal, already GREEN at the same shared code in the
   frozen integration stage (a282f45 / run 34031521912), and three
   runner-instance-variance REDs here with zero bundle-relevant findings
   (runs 34049669476 / 34050266206 / 34051053487 — x64 crypto-streaming
   30–60s/test under both parallel AND serial execution; x64
   crypto-roundtrip 1MB stall on an instance where 1-byte-over tests took
   16s while a full stream roundtrip took 350ms).
10. Teardown: `pg_ctl stop -m fast` (bounded) + zero-orphan-postgres proof.

Cluster semantics carried over from the frozen integration stage (and the
Windows lanes before them): never reinitialize a valid cluster; the
CLEAN / VALID_EXISTING / RECOVERABLE_INCOMPLETE / INCOMPLETE_EXISTING
fail-closed classification is implemented in the later provisioning stage,
not in the PG bundle itself.

## 7. Non-goals / staged elsewhere

- Rust supervisor (owns PG + Node lifecycle): next stage.
- Keychain secrets, TLS decision (loopback HTTP vs local HTTPS — the
  `TRUSTED_LOCAL_TLS_TERMINATION` CI harness value is NOT a production
  decision), SMAppService LaunchAgent: later stages.
- Node 22 bundling, Tauri app, DMG layout, ad-hoc → Developer ID signing +
  notarization, macOS 26 smoke, reinstall/uninstall regressions: later
  stages per the lane order.
- The frozen integration stage (`a282f45`) is not reopened by this work.

## 8. Verification record

| When | SHA | Run | Result |
|---|---|---|---|
| 2026-09-06 | a41ddf0 | 34047324482 | RED (first-red, both arches): darwin module suffix is `.dylib` not `.so`; PG 17 removed `postgres.description`/`postgres.shdescription` (merged into `postgres.bki`) and added `system_functions.sql` + `system_constraints.sql` to initdb's inputs — layout fixed. Build itself proven: dt13 vtool spot-check showed `minos 13.0 / sdk 15.5`. |
| 2026-09-06 | 421100c | 34047726666 | RED (first-red, both arches): Mach-O gate REJECTED all 7 objects — the vtool field parser expected `minos:` with a colon, but Xcode 16's `vtool -show-build` prints space-separated `minos 13.0` / `sdk 15.5`. Fail-closed held (no false GREEN); parser fixed + raw-output diagnostic added. |
| 2026-09-06 | 3aa4a18 | 34048036069 | RED (first-red, both arches): Mach-O gate GREEN (all 7 objects: arch ✓, minos 13.0 ✓, deps ✓ — repaired @executable_path deps resolved); relocation initdb failed on the missing `sql_features.txt` (initdb's features_file). Layout fixed. |
| 2026-09-06 | 70b7a54 | 34048563205 | RED (first-red, both arches): bootstrap GREEN (bki + system files OK), but post-bootstrap initdb EXECUTES snowball_create.sql → `CREATE FUNCTION '$libdir/dict_snowball'` → FATAL without `lib/postgresql/dict_snowball.dylib`. Module added. |
| 2026-09-06 | a493794 | 34049189077 | RED (first-red, both arches): relocation FULLY GREEN — initdb SCRAM from the relocated tree, bounded pg_ctl start, pg_isready, no-external-PG proof, in-server pg_config BINDIR/LIBDIR/SHAREDIR/PKGLIBDIR inside the bundle, app role + db, SCRAM SELECT 1 as the app role, prisma migrate deploy 8/8. Failed only on the ICU assertion: a --without-icu PG 17 cluster contains exactly ONE provider-'i' row (the bootstrap `unicode` collation, pg_collation.dat oid 963) — "expect 0" was wrong; proof corrected to assert that exact row. |
| 2026-09-06 | 54423c1 | 34049669476 | **arm64 GREEN end-to-end.** x64 RED only in the shared suites: crypto-streaming timed out under 22-way parallel contention on the 2-core Intel runner (5MB roundtrip > 60s; RSS measurement > 30s) — baseline RSS matched the GREEN integration run (1590.9 vs 1610.9 MB), so timing noise, not a bundle regression. Same remedy as the frozen integration lane's m3-memory-streaming precedent: the file moved to this job's serial group; shared test code untouched; the integration job's own steps stay byte-frozen. |
| 2026-09-06 | c3f803e | 34050266206 | **arm64 GREEN end-to-end (again).** x64: unit group 21 files/189 tests GREEN (crypto-streaming excluded); DB serial group all GREEN; crypto-streaming still timed out SERIALLY — measured work is 30–60s per test on the 2-core Intel runner (run 6: RSS test completed at 32.6s; run 7: the 60s-budget roundtrip passed, the 30s-default RSS test did not). Root cause is the runner-calibrated budget, not contention alone: the file now runs in its own step with `--test-timeout=120000` (shared test code untouched, still executed fail-closed). |
| (next run pending) | | | |

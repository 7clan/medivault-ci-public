# MediVault — MACOS ARCHITECTURE AUDIT

Date: 2026-09-06 · Prepared on: `platform/macos` @ `a8593484c5aa9c1606edc5f71e3db6a817f01d77`
Repo (canonical): `7clan/medivault` (transferred from `mohammadfarhat81010-arch/medivault`; old URL 301-redirects — tooling must use the canonical name)
Windows freeze refs (created this session, zero commits, zero merges, zero deletions):
- `windows/frozen-2026-09-06` → `a859348` (latest Windows implementation)
- `experiment/postgres-binary-bundle` → `a859348` (untouched)
- `experiment/postgres-edb-fix` → `c97db38` (untouched)

---

## REUSABLE SHARED CODE (port as-is, no rewrite)

| Area | Files | Why reusable |
|---|---|---|
| Fastify API core | `mini-services/api-service/src/**` (server.ts, plugins/{auth,cors,csrf,error-handler,logging,multipart,rate-limit}, routes/{auth,users,roles,patients,documents,visits,notes,prescriptions,annotations,misc}, lib/{db,https-enforcement}, services/{backup-service,startup-cleanup}) | Pure Node ESM, env-driven config, **zero Windows coupling** (verified: no ProgramData/AppData/C:\ in tree). SIGTERM/SIGINT graceful shutdown already implemented — supervisor-friendly. `/health` 200 + `/ready` SELECT 1 readiness contract already present. Built with `tsc` → `api/dist/index.js`. |
| API config contract | env vars: `DATABASE_URL, AUTH_JWT_SECRET, MEDIVAULT_MASTER_KEY, TLS_CERT_PATH, TLS_KEY_PATH, ENCRYPTED_STORAGE_PATH, NODE_ENV, PORT, HOST, CSRF_SECRET, LOG_LEVEL, TRUSTED_LOCAL_TLS_TERMINATION` | The seam Windows fills via `secure-config.json` + `medivault-service.js`; macOS fills the **same env contract** from Keychain + Application Support. API code unchanged. |
| Prisma layer | `packages/db` (schema.prisma — 24 models, 8 migrations; `src/client.ts`), `@prisma/client` 6.19.2 | Engine files are per-arch artifacts; schema/migrations byte-identical across platforms. |
| Crypto & auth packages | `packages/crypto` (AES-GCM streaming, key-management, storage-service, 19 test files), `packages/auth` (tokens, rbac, audit, password, rate-limit, crypto-pairing) | Pure TS; `@types/node ^22` already declared — Node-22-ready. |
| Desktop frontend | `src/**` (Next 16 static export → `out/`, 92 components, lib/desktop Tauri IPC wrappers, store) + `next.config.ts` (`NEXT_OUTPUT=export`) | Framework-agnostic web layer served by Tauri WKWebView on macOS. |
| Tauri Rust core | `src-tauri/src/**` (commands/{auth,backup,device,documents,patients,settings}, api_client.rs, main.rs/lib.rs) | `cfg` gates already exist; reqwest HTTP client not CSP-bound. Identifier `com.medivault.desktop`. |
| Test suites | `tests/**` (m2/m3/m4 unit+integration, api-route, db-schema), `packages/crypto/tests/**` | Vitest; run against real PG on macOS CI. |
| Windows semantics (as **behavioral spec**, not code) | 4-state PG classification (CLEAN / VALID_EXISTING / RECOVERABLE_INCOMPLETE / INCOMPLETE_EXISTING), fail-closed, never auto re-init, DB sentinel witness, version-consistency, quiesce-before-replace, uninstall-preserves-data | Re-implement natively in the macOS provisioner; do NOT port PowerShell. |

## WINDOWS-ONLY CODE (frozen, never deleted, not ported)

`windows/` (52 files) — `installer/` (medivault-installer.nsi, build-installer.ps1, generate-secure-config.ps1, quiesce-install.ps1, wait-for-*.ps1, test-reinstall-quiesce.ps1), `postgres/` (install-postgres.ps1 4-state machine, initialize/verify/upgrade-database.ps1, stage-postgres-binaries.ps1, 8 test scripts), `service/` (node-windows/WinSW wrapper, service-install.js SCM identity `medivaultapi.exe`/"MediVault API", medivault-service.js env injector), `tls/` (PowerShell cert gen/validate/trust), `upgrade/`, `desktop/test-desktop-launch.ps1`, `tests/` (10 TS tests) — plus CI `.github/workflows/{windows-build,windows-installer-only,windows-integration}.yml` (Node 20 pins; push/PR gated to `[main]` only; installer-only + integration are dispatch-only; **no cron anywhere — verified; nothing scheduled to stop**). Windows service entry `windows/service/medivault-service.js` + node-windows are replaced (not ported) by the macOS supervisor.

## FILES THAT NEED PLATFORM ABSTRACTION

1. `src-tauri/src/credential/mod.rs` — Windows Credential Manager + DPAPI → add `#[cfg(target_os = "macos")]` Keychain backend (`keyring` crate covers both; keeps the `MediVault/server-url` + future item names identical).
2. `src-tauri/src/commands/settings.rs` — `app_data_dir()` is `#[cfg(windows)]` → add macOS branch → `~/Library/Application Support/MediVault`.
3. `src-tauri/src/scanner/mod.rs` — WIA is `#[cfg(windows)]` with a `not(windows)` fallback (deferred) → macOS scanner path = ImageCaptureCore (or document import) later; feature-gated, non-blocking for v1.
4. `windows/service/medivault-service.js` (secure-config.json → env injection) → **replacement**, macOS supervisor (no port).
5. `windows/tls/*.ps1` (cert generation/trust) → **replacement**, rcgen-based native generator (no port).
6. `windows/installer/generate-secure-config.ps1` (config: port 3001, host `0.0.0.0`, nodeEnv production, trustedLocalTlsTermination true, storage path, secrets) → macOS equivalent metadata JSON + Keychain (macOS host default becomes `127.0.0.1`, see TLS/LAN plan).
7. `packages/db/prisma/schema.prisma` generator — add `binaryTargets` or per-arch generate on CI (darwin-arm64 / darwin).
8. Desktop WKWebView user-data dir — the Windows EBWebView `dataDirectory` fix must be re-proven for WKWebView (`~/Library/.../WebKit` data dir outside the app bundle, writable) in the macOS desktop-launch regression.

## NEW MACOS FILES (tree `macos/`, nothing inside `windows/`)

```
macos/supervisor/                  # Rust crate: mediavault-supervisor
macos/provision/                   # Node 22 provisioning: initdb, SCRAM, role/db,
                                   #   4-state classification, migrate deploy, SELECT 1
macos/tls/                         # rcgen cert generator + trust helper
macos/keychain/                    # Keychain item contract + first-run bootstrap
macos/launchagent/dev.medivault.supervisor.plist   # app-bundle Contents/Library/LaunchAgents
macos/dmg/                         # DMG construction (layout, background, symlink)
macos/scripts/                     # verify-runtime.sh, mach-o-deps.sh, sign.sh, staple.sh
macos/tests/                       # supervisor lifecycle, reinstall matrix, sentinel witness
.github/workflows/macos-build.yml  # dispatch modes mirroring the Windows discipline
.github/workflows/macos-dmg-only.yml  # artifact-reuse rebuild (installer-only pattern)
macos/docs/architecture.md
```

## MINIMUM MACOS VERSION

**macOS 13.0 (Ventura)** — floor set by `SMAppService` (13+). Tauri 2/WKWebView support older, Prisma/Node 22 fine, but SMAppService is non-negotiable for the background model. Deployment target `MACOSX_DEPLOYMENT_TARGET=13.0`; runners macos-15/macos-26 build binaries that still run on 13 (verify via `vtool -show-build` minos). LAN-mode Local Network privacy behaviors documented for 14+.

## SMAPPSERVICE DESIGN

- **User-scoped LaunchAgent** via `SMAppService.agent` (ServiceManagement.framework). No root LaunchDaemon. Backend runs while the doctor is logged in, independent of the desktop window.
- Plist lives **inside the app bundle**: `MediVault.app/Contents/Library/LaunchAgents/dev.medivault.supervisor.plist` — `Label dev.medivault.supervisor`, `RunAtLoad=true`, `KeepAlive=true`, `Program=/Applications/MediVault.app/Contents/MacOS/mediavault-supervisor`, `StandardOut/ErrPath ~/Library/Logs/MediVault/supervisor.log`. Supervisor holds a single-instance lock; KeepAlive gives crash-resilience.
- Registration from the desktop app at first-run setup (`SMAppService.agent.register()`); status surfaced in Settings (`SMAppService.status`); "Stop background service" = unregister. LaunchDaemon remains out of scope until an explicit serve-while-logged-out requirement exists.
- Known edge: moving/renaming the .app breaks the agent path → app verifies its own path is `/Applications/MediVault.app` at launch and re-registers/guides if not (interactive tests cover this).

## SUPERVISOR DESIGN

One small native Rust helper `mediavault-supervisor` (no shell, absolute paths only):

- **Startup**: resolve canonical paths (`/Applications/MediVault.app/Contents/Resources/{postgresql/17, runtime/nodejs, api}`) → load non-secret metadata from `~/Library/Application Support/MediVault/config` → load secrets from Keychain → ensure provisioned (delegating to `macos/provision` on first run) → start PostgreSQL → bounded `pg_isready` → authenticated `SELECT 1` → start API (`node api/dist/index.js`, env-injected: same contract as Windows) → bounded `GET /health` poll → healthy.
- **Supervision**: children are direct child processes; restart with bounded backoff; PID/log discipline; **no orphan/zombie children**.
- **Shutdown** (SIGTERM): stop API gracefully (SIGTERM; Fastify already closes + disconnects Prisma on SIGTERM) → stop PostgreSQL gracefully (fast shutdown mode; bounded wait → escalate → SIGKILL only after bounded failure) → exit 0. `postgres` treats SIGTERM as *smart* shutdown, so the supervisor issues `pg_ctl -m fast` semantics or SIGINT for fast mode; never SIGKILL first.
- Secrets: read from Keychain by the supervisor and **injected via env to the Node child only** — Node never touches Keychain (avoids Keychain ACL prompts entirely). Never logged.
- Logs → `~/Library/Logs/MediVault/`.

## POSTGRESQL BUNDLE PLAN

- PostgreSQL **17.x**, architecture-specific `arm64` + `x86_64`, bundled at `MediVault.app/Contents/Resources/postgresql/17` (bin + share + lib).
- **Source preference (recommended)**: build from the official `postgresql.org` **source tarball** pinned by exact version + SHA256, built per-arch on GitHub macOS runners with `--without-icu` (avoids ICU/locale build deps), `--with-openssl` NOT required if SCRAM-SHA-256 only (PG17 supports `--with-openssl` optional; SCRAM needs only built-in crypto). CI-cached (~15 min first build, cached thereafter). Best provenance chain: one hash from postgresql.org.
- **Alternative (faster, needs provenance approval)**: zonky.io embedded-postgres binaries (darwin-amd64 / darwin-arm64 Maven artifacts, PG17 available) — provenance = Maven Central checksums; third-party packaging trust required. Decision requested from user; default = source build.
- Provisioning (in `macos/provision`, Node 22): `initdb --encoding=UTF8` SCRAM auth; localhost-only bind (`127.0.0.1`, random high port in a bounded range); random credentials; app role + database; `prisma migrate deploy`; authenticated `SELECT 1`; pending-state marker semantics; the **4-state classification** (CLEAN / VALID_EXISTING / RECOVERABLE_INCOMPLETE / INCOMPLETE_EXISTING) reimplemented natively with the same fail-closed, never-auto-re-init contract; DB sentinel witness in regressions.

## NODE 22 PLAN

- Bundle official **Node 22 LTS** (exact pinned version) per arch: `node-v22.x-darwin-arm64.tar.gz` + `node-v22.x-darwin-x64.tar.gz` from nodejs.org, verified against the official `SHASUMS256.txt` at CI time (same staged-asset discipline as the Windows PG ZIP). Location: `MediVault.app/Contents/Resources/runtime/nodejs/bin/node`. No system Node, no Homebrew.
- Windows CI pins Node 20 today; macOS CI pins 22. API `engines` floor is >=18 and `@types/node ^22` already — compatibility expected; **acceptance gate: full API vitest suite green on Node 22 on both macOS architectures before any bundle is trusted.**

## PRISMA PLAN

- `prisma generate` run **natively on each arch runner** (engines: `darwin-arm64` and `darwin`), producing per-arch builds of `packages/db` + API dist. No cross-generation.
- `prisma migrate deploy` executed against a **real PG17 instance on native macOS CI** (integration job). Migration history already proven on Windows PG17 — same 8 migrations.
- Schema gains `binaryTargets = ["native"]` (+ explicit target per arch at generate time) so build and runtime match.

## KEYCHAIN PLAN

- Long-lived secrets as generic-password items under service `dev.medivault` (accounts: `pg-app-password`, `pg-bootstrap`, `master-key`, `jwt-secret`, `csrf-secret`). Accessed by the supervisor via the `keyring`/`security-framework` crates. Node gets values only via env injection.
- Non-secret metadata in `~/Library/Application Support/MediVault/config` (port, host, pgPort, storage path, state markers) — mirrors Windows' split of `pg-port.txt`/`db-credentials.json` schema vs secrets.
- CI: runners get env-var-provided test secrets; **never print Keychain values in logs** (CI asserts redaction patterns, as the Windows tests already do). First-run item creation happens on the doctor's Mac (production) with one-time ACL prompt only for the supervisor.

## DATA PATH PLAN

```
/Applications/MediVault.app                                   # read-only app/runtime
~/Library/Application Support/MediVault/
    PostgreSQL/17/data          # PG cluster (NEVER inside the .app)
    config/                     # non-secret metadata + state markers
    storage/                    # ENCRYPTED_STORAGE_PATH (content-addressed .enc objects)
    tls/                        # generated key/cert (LAN/direct-TLS mode)
    runtime-state/              # supervisor status, PIDs, health snapshots
~/Library/Logs/MediVault/       # supervisor + API + PG logs
Backups: USER-SELECTED directory (desktop Settings `backup_destination`; never hardcoded, never inside the .app)
```
Windows backup-path assumptions are not ported; `backup-service.ts` already takes a caller-supplied destination.

## TLS PLAN

- PowerShell TLS generation is **not** ported. Replacement: **rcgen** (maintained pure-Rust, ring-backed) in the supervisor/helper — no OpenSSL install anywhere (ring is statically linked).
- Certificate contract preserved: self-managed local CA + server cert; SANs `localhost`, `127.0.0.1`, hostname (LAN mode adds LAN IPs/mDNS name); strong modern key (ECDSA P-384 default; RSA-4096 optional via RustCrypto `rsa` if bit-parity with the Windows PKCS#1 4096 contract is demanded — SANs are the hard contract).
- Desktop currently speaks plain HTTP to the API (Fastify has no TLS listener today; Windows used `TRUSTED_LOCAL_TLS_TERMINATION=true`). macOS Phase 1 mirrors that (localhost-only binding makes this safe); Phase 2 adds a direct-TLS listener in the API (env-gated `TLS_CERT_PATH` already exists in the contract) or a rustls front in the supervisor — decided at implementation time, keeping the same env contract.

## LOCAL-ONLY VS LAN PLAN

- **Default: localhost-only.** macOS supervisor sets `HOST=127.0.0.1` (deliberate deviation from Windows' `0.0.0.0` per directive — no silent LAN exposure). Desktop connects to `http://127.0.0.1:<port>`; CORS/CSRF origins adjusted to the local default.
- **LAN mode = explicit opt-in** (Settings toggle): re-bind to `0.0.0.0`, regenerate cert SANs (LAN IP/mDNS), surface macOS **Local Network privacy** (TCC) requirements in first-run guidance, document firewall prompt. Nothing about LAN is default.

## ARM64 BUILD PLAN

- Runner `macos-15` (+ targeted smoke on `macos-26`), target `aarch64-apple-darwin`: tsc API build + native `prisma generate` + `next build` static export + `cargo tauri build` + ad-hoc codesign of every native component + DMG `MediVault-macOS-arm64.dmg`. Pinned Node 22 darwin-arm64 + PG17 arm64 staging with hash gates.

## INTEL BUILD PLAN

- Runner `macos-15-intel` (+ `macos-26-intel` smoke), target `x86_64-apple-darwin`: identical pipeline, `MediVault-macOS-x64.dmg`. **No universal binary first** — independent builds/tests per arch, exactly as on Windows.
- Priority #1 artifact = the doctor's actual chip — **user to confirm** (assumed arm64 pending confirmation).

## SIGNING PLAN

- **Dev/CI phase: ad-hoc** (`codesign -s -`) — does not block development.
- **Production: Developer ID Application** + **Hardened Runtime**; sign **each nested native component individually** before the outer bundle: MediVault main executable, `mediavault-supervisor`, bundled `node`, every PostgreSQL executable (`postgres`, `pg_ctl`, `initdb`, `pg_isready`, `psql`, …), PostgreSQL `.dylib`s, Prisma engine library, any helper libs. `codesign --deep` is **not** sufficient proof — the audit trail is per-component signature verification + final `codesign --verify --deep --strict --verbose=2`.
- Entitlements: minimal (no JIT required; Keychain access is default-allowed for signed apps owning the items; network-server needs no entitlement under hardened runtime).

## NOTARIZATION PLAN

- Production only: `notarytool submit` (App Store Connect API key — user-provided) of the zipped app + the DMG; require **ACCEPTED**; `xcrun stapler staple` on both `.app` and `.dmg`; `stapler validate`; `spctl -a -vv -t exec` / `-t open --context context:primary-signature` assessments; **Gatekeeper on a clean machine** (LEVEL 2/3 test). No TestFlight, no App Store, no provisioning profiles, no developer mode, no Xcode on the doctor's Mac.

## DMG PLAN

- `MediVault-macOS-arm64.dmg` / `MediVault-macOS-x64.dmg`: `hdiutil` UDZO (or create-dmg) with drag-to-Applications layout (app + `/Applications` symlink + background). DMG itself signed and notarized + stapled. Estimated size ≈ 150–250 MB (PG ~60 MB + Node ~90 MB + app ~20 MB, compressed) — far below the 604 MB Windows installer.
- Verification: mount, layout assert, bundle structure assert, `codesign` verify, optional app-binary launch from mounted volume is NOT part of CI proof (translocation) — clean-machine test is LEVEL 2/3.

## REINSTALL PLAN

- v1 = manual signed/notarized DMG replacement (no automatic Tauri updater yet).
- Flow: detect running supervisor (SMAppService status/health socket) → desktop "Quit & Update" (or manual: close app, supervisor stops API then PG gracefully — SIGTERM path) → replace `MediVault.app` (drag over; Application Support / Keychain / PG cluster / patient files are **outside** the bundle and preserved by construction) → relaunch → first-run detection classifies existing state as **VALID_EXISTING** (never re-initdb) → `prisma migrate deploy` → bounded health → desktop. Same-version and cross-version reinstall both covered by a CASE-matrix regression (mirroring the Windows 5-case quiesce matrix, adapted: CASE1 API+desktop running, CASE2 both running w/ graceful close, CASE3 both stopped, CASE4 stop-hang bounded fail-closed, CASE5 same-version full-data-preservation with DB sentinel).

## UNINSTALL PLAN

- **Trashing MediVault.app never erases patient data** (all mutable state is outside the bundle by layout). Default: APP REMOVED → DATA PRESERVED.
- Stale LaunchAgent cleanup: Settings "Remove background service" (SMAppService.unregister) — also offered during a clean uninstall flow; fallback documented (`launchctl bootout gui/$UID/dev.medivault.supervisor`).
- Explicit destructive "DELETE ALL MEDIVAULT DATA" = separate, typed-confirmation action: removes `~/Library/Application Support/MediVault`, `~/Library/Logs/MediVault`, Keychain items; backups only if explicitly included in the confirmation. Never automatic; never destroys cluster/patient files/backups without that explicit step.

## GITHUB CI MATRIX

`macos-build.yml` (on `platform/macos`, workflow_dispatch with modes: `full | integration | desktop-launch-regression | reinstall-regression | dmg-only`; REST dispatch verified working with the canonical repo name):

| Stage | arm64 | x86_64 |
|---|---|---|
| preflight (static contracts, redaction checks) | macos-15 | macos-15-intel |
| pg-bundle-verify (download/hash/initdb/start/ready/SCRAM) | macos-15 | macos-15-intel |
| api-integration (tsc build, vitest suite, migrate deploy, /health) | macos-15 | macos-15-intel |
| supervisor-lifecycle (start→healthy→SIGTERM→clean, orphan check) | macos-15 | macos-15-intel |
| build-desktop (tauri, per-arch node/PG staging, ad-hoc sign) | macos-15 | macos-15-intel |
| dmg (construct, mount, layout, codesign verify) | macos-15 | macos-15-intel |
| desktop-launch / reinstall regressions | macos-15 | macos-15-intel |
| smoke on newer OS | macos-26 | macos-26-intel |
| `macos-dmg-only.yml` (trusted full-run artifact reuse — no duplicate expensive builds) | both | both |

Artifact discipline copied from Windows: 1-day retention on targeted runs, reuse desktop binary, checksums + provenance (SOURCE SHA, run IDs, artifact IDs, sizes, SHA256) — **the artifact-storage quota incident must not repeat**.

## WHAT GITHUB CI CAN PROVE

PG archive hash + exec; initdb; PG start; `pg_isready`; role/database creation; `prisma migrate deploy`; authenticated `SELECT 1`; API start; `/health`; supervisor foreground lifecycle incl. bounded shutdown + no orphans; bounded stay-alive; desktop binary close/reopen; **reinstall** (replace .app dir, classification, sentinel persistence); architecture verification (Mach-O `arm64`/`x86_64` via `lipo`/`file`); Mach-O dependency verification (`otool -L` — no Homebrew/`/usr/local` deps); DMG construction + mount + layout; ad-hoc signature verification; log redaction. LaunchAgent via `launchctl bootstrap` in the runner session: attempted and reported honestly; if the runner session can't prove it, it moves down a level (never silently marked proven).

## WHAT REQUIRES INTERACTIVE CLOUD MAC

- Gatekeeper full UX on a clean machine (right-click Open / notarized DMG open prompt).
- Drag-to-Applications install UX; app translocation behavior.
- **SMAppService registration approval UI** (Login Items pane interaction).
- macOS Local Network privacy prompt (LAN mode).
- Keychain first-run ACL prompt (supervisor item creation).
- Finder DMG background/UX polish; real close/reopen of the GUI app; Login Items persistence across a real logout/login.

## WHAT REQUIRES DOCTOR'S ACTUAL MAC

- Final acceptance only: real chip (decides priority DMG), real `/Applications` install, real Keychain, reboot persistence of the LaunchAgent, long-run stability, scanner hardware (when scanner integration lands), backup to a real user-selected/external directory, and the first real patient workflow. The doctor's Mac is never primary debugging infrastructure.

## KNOWN RISKS

1. PG source-build time on CI (~15 min/arch, mitigated by caching; zonky alternative pending provenance approval).
2. PG17 build flags on macOS (ICU off; locale/`--no-locale` semantics to pin in tests).
3. `macos-26` / `macos-26-intel` label availability — verify at implementation; fallback macos-15(-intel) (audit assumes user's labels; CI authored defensively).
4. WKWebView user-data dir (port of the Windows EBWebView fix — must be re-proven; risk of app-bundle-relative default).
5. CSP `connect-src http://localhost:*` — Rust-side HTTP is unaffected; any direct webview fetch to `127.0.0.1` needs a CSP tweak (one-line, in the macOS lane only).
6. App moved out of `/Applications` → LaunchAgent path break (detection + guidance; interactive test).
7. macOS runner cost multiplier + artifact quota (mitigated by reuse + 1-day retention).
8. Node 22 vs pinned CI Node 20 divergence — covered by the Node-22 full-suite gate.
9. `codesign --deep` as a false sense of security — mitigated by per-component signing + strict verification.
10. SMAppService behavior differences across 13→26 (status semantics; tested on 15/26 runners, manual on doctor's version).

## BLOCKERS

1. **Apple Developer Program membership + Developer ID Application certificate + notarytool API key** (user-provided; production DMG only — does NOT block dev/CI/ad-hoc phase).
2. **Doctor's actual chip** (arm64 vs Intel) — decides priority #1 DMG. Assumed arm64 pending user confirmation.
3. **PG17 darwin binary source decision** — default: postgresql.org source build (recommended); zonky.io needs explicit provenance approval.
4. **Explicit LAN requirement** — currently OFF by design; needed before LAN-mode work.
5. Runner label availability (macos-26 / macos-26-intel) — verify at first CI authoring; fallback exists.
6. New PAT works fully via canonical repo `7clan/medivault` (old path returns 301; earlier "404s" were the unfollowed redirect) — tooling updated; retained at `/tmp/.gh_pat` for the campaign (delete at close-out).

---

**Status: audit complete and internally consistent. No production edits made to Windows code (frozen) and none to `platform/macos` beyond the ref creation. Awaiting user review/approval of this audit before implementation begins on `platform/macos` only.**

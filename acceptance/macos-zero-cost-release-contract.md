# MediVault macOS — Zero-cost release contract

Status: **FROZEN GREEN — ZERO-COST-RELEASE-CANDIDATE** (declared
2026-09-08; freeze evidence in §13: run 34255257006 both arches
first-run GREEN; run 34279589309 both arches; run 34285107767 both
arches). Adopted by owner decision on 2026-09-08. CI stages:
`zero-cost-release`, `smappservice-lifecycle`, `keychain-lifecycle`
(macos-build.yml). This is NOT and will never be labeled
Apple-notarized-production.

## 1. Owner decision record (2026-09-08)

> CHANGE RELEASE STRATEGY — ZERO-COST MACOS DISTRIBUTION.
> I will NOT purchase an Apple Developer Program membership.
> Therefore Developer ID signing and Apple notarization are NOT
> requirements for this release. Do NOT ask for Apple credentials again.

Consequences, binding for every artifact and document in this lane:

| Property | Value |
|---|---|
| Apple Developer Program membership | NONE (no credentials will be requested again) |
| Developer ID signing | NOT AVAILABLE — never faked |
| Apple notarization | NOT AVAILABLE — never faked |
| Distribution | DIRECT, to a small number of known doctor Macs |
| First-install Gatekeeper behavior | user explicitly approves via Apple's supported **System Settings → Privacy & Security → Open Anyway → Open** flow |
| Gatekeeper itself | NEVER disabled, globally or per-machine |

## 2. Security disclosure (mandatory, shipped, verbatim facts)

Every release ships `SECURITY-DISCLOSURE.md` on the DMG volume root and
states these exact greppable facts:

```
APPLE DEVELOPER ID: NO
APPLE NOTARIZATION: NO
GATEKEEPER AUTOMATIC TRUST: NO
FIRST INSTALL MANUAL APPROVAL: YES
```

This release must NEVER be labeled "Apple-verified", "Apple-approved",
"Developer-ID-signed", or "notarized". CI step `build-release-dmg.sh`
fails closed if the disclosure is missing any fact; `verify-release.sh`
re-checks it before installation.

## 3. Build model (kept — unchanged from the proven stages)

* native `arm64` and native `x86_64` builds (no fat, no Rosetta);
* macOS >= 13.0 (`MACOSX_DEPLOYMENT_TARGET=13.0`, vtool-verified);
* Hardened-Runtime-compatible bundle: every Mach-O signed with
  `--options runtime` (zero entitlements — the frozen
  NODE_ALLOW_JIT=not-needed proof), inside-out (deepest-first, root
  `.app` last — never `codesign --deep`);
* **ad-hoc signatures are THE release signature** (`sign-production.sh`
  `MV_ADHOC_RELEASE=1`): integrity + Hardened Runtime, no identity;
* relocatable runtime (`@executable_path`/`@loader_path`, bundle-relative
  config, verified relocation);
* Model A localhost security (FROZEN GREEN, run 34240532237: API
  127.0.0.1:3001 only, PostgreSQL 127.0.0.1:55432 only, strict Origin,
  auth/session/CSRF, fail-closed on unsafe configs);
* SMAppService LaunchAgent (user-scoped, `BundleProgram`, plist shipped
  in-bundle);
* Keychain secret store (`dev.medivault` service, 5 accounts,
  explicit first-run bootstrap, never-overwrite, fail-closed on missing);
* PostgreSQL/data-preservation semantics (FROZEN:
  reinstall-acceptance + provision-lifecycle).

Final artifacts per release:

* `MediVault-arm64.dmg` + `MediVault-arm64.dmg.sha256` +
  `MediVault-arm64.manifest.txt`
* `MediVault-x86_64.dmg` + `MediVault-x86_64.dmg.sha256` +
  `MediVault-x86_64.manifest.txt`
* `verify-release.sh` (the offline pre-install verification tool) +
  `SECURITY-DISCLOSURE.md` + `FIRST-INSTALL.md` (also on the volumes)

## 4. Integrity manifest (deterministic, offline-verifiable)

`macos/scripts/release-manifest.sh` generates, from the REAL mounted DMG:

* the DMG's own SHA-256;
* EVERY file on the volume: SHA-256, byte size, kind (`macho` for the
  executable inventory — desktop binary, supervisor, SMAppService
  helper, Node runtime, every PostgreSQL binary, Prisma native engines —
  or `file`), volume-relative path;
* every symlink (target recorded);
* metadata: arch, app version/build/bundle id, desktop-binary minOS.

Determinism: LC_ALL=C path ordering; the same DMG yields byte-identical
manifests. The manifest proves INTEGRITY, never identity.

## 5. Pre-install verification (offline, no internet service)

`macos/scripts/verify-release.sh` (run by CI and by the doctor Mac):

1. re-hashes the DMG and every volume file against the manifest —
   fail-closed on any missing/extra/changed byte;
2. strict-verifies every Mach-O's ad-hoc signature + the `.app` root;
3. checks the Hardened Runtime flag on the key binaries;
4. checks arch + minOS + drag layout;
5. checks the shipped disclosure facts.

OFFLINE BY CONSTRUCTION: the tool invokes no network command; it
self-audits this (`--offline-audit`) and CI asserts the audit. Only
local macOS tools are used (`hdiutil`, `shasum`, `file`, `codesign`,
`vtool`, `PlistBuddy`).

## 6. Gatekeeper acceptance contract (zero-cost form)

**The initial Gatekeeper warning is NOT a product failure.** PASS means
ALL of:

1. fresh Mac / clean user + quarantined DMG acquisition (quarantine flag
   present — the harness fails closed otherwise);
2. mount → Finder drag to `/Applications` (quarantine inherited);
3. first launch attempt → the EXPECTED Gatekeeper
   unidentified-developer warning/block occurs;
4. the user follows Apple's supported manual override
   (System Settings → Privacy & Security → **Open Anyway** → **Open**);
5. the app launches;
6. every subsequent launch works normally (no warning);
7. Gatekeeper remains enabled throughout (no `spctl --master-disable`,
   no security-policy disabling, no quarantine removal, no fake/stolen/
   shared certificates, no fake notarization, no certificate-trust
   tricks).

Details: `acceptance/macos-gatekeeper-acceptance-plan.md` (zero-cost
revision). Interactive proof: `macos/scripts/interactive-acceptance.sh`
sections 0–4.

## 7. SMAppService proofs

**CI-provable contract** (`smappservice-lifecycle` mode, hosted macOS
runners): helper `self-test` (bundle identity + shipped plist);
`status` = `notRegistered` before registration; `register()` succeeds
under the ad-hoc release signature (empirically proven — if Apple
restricts ad-hoc SMAppService registration, the failure is captured
verbatim and escalated BEFORE any architecture change); after
registration the status is one of the four documented values with the
launchd job present (`launchctl print gui/<uid>/dev.medivault.supervisor`);
when `enabled`, launchd itself starts the supervisor (RunAtLoad) to
healthy, the backend's parent is launchd (independence from any desktop
/CI shell), KeepAlive restarts a SIGKILLed supervisor back to healthy;
`unregister` returns to `notRegistered` with the job and processes gone.

**Interactive contract** (clean Mac, `interactive-acceptance.sh`
sections 5–10): Login Items approval UI (via
`openSystemSettingsLoginItems()`), backend starts through launchd,
desktop closes while the backend remains alive, reopen succeeds,
logout/login returns the backend (RunAtLoad), reboot returns the
backend. SMAppService is NOT replaced by legacy `launchctl`
production installation unless current Apple behavior empirically proves
it cannot work under this release model.

## 8. Keychain lifecycle proofs

**CI-provable contract** (`keychain-lifecycle` mode): first-run
bootstrap creates exactly the 5 `dev.medivault` items (values never
printed); supervisor run #1 with `secrets.source: "keychain"` reaches
healthy (secret read #1, via SCRAM-authenticated PostgreSQL + API
/health + /ready); graceful SIGTERM (exit 0, zero orphans); supervisor
run #2 from a FRESH process re-reads the keychain (secret read #2) and
reaches healthy; bootstrap-secrets idempotence (5× "already present",
never overwrites); deleting one item makes the next supervisor run FAIL
CLOSED naming the account (no env fallback, no API start). Cross-build
reads under the ad-hoc identity are proven by the frozen
reinstall-acceptance CASE 3b (replacement build reads the 5 items).

**Interactive contract** (clean Mac): initial provisioning → secret
read → supervisor restart → secret read again → logout/login → secret
read again → reboot → secret read again → app replacement/update read.
The indirect proof discipline is unchanged: the supervisor re-reads the
items at every start; a healthy API after restart proves the read; the
harness never extracts keychain values.

**Ad-hoc identity stability rule (binding):** if ad-hoc code identity
causes Keychain authorization instability between builds (prompts that
cannot be satisfied, denied reads), the exact behavior is recorded and
escalated BEFORE any change. Keychain ACLs are NEVER loosened merely to
make a test pass.

## 9. Controlled update model (no silent automatic updater)

Because there is no Developer ID identity and no notarization, there is
NO silent automatic updater. Updates are controlled manual replacement:

1. verify the NEW DMG offline (`verify-release.sh` + its manifest) —
   GREEN required before anything is touched;
2. stop owned processes safely (quit MediVault; the supervisor shuts
   down PostgreSQL gracefully — SIGTERM, exit 0, zero orphans);
3. replace `MediVault.app` (Finder drag-replace);
4. preserve Application Support, PostgreSQL data, Keychain items (the
   frozen reinstall-acceptance CASE 3a/3b semantics);
5. restart (launch once; re-register if macOS dropped the Login Item);
6. verify sentinel data (the synthetic acceptance patient is still
   visible; the API is healthy).

Preservation semantics are CI-proven by the frozen reinstall-acceptance
mode (sentinel row count, no re-initdb, provisioned.json createdAt
unchanged, keychain 5× already-present). The interactive harness
section 11 executes the same flow on the doctor Mac.

## 10. ZERO-COST-RELEASE-CANDIDATE criteria

| # | Requirement | Evidence |
|---|---|---|
| 1 | ARM64 artifact GREEN | run 34255257006 (arm64 job; first-run GREEN) |
| 2 | Intel artifact GREEN | run 34255257006 (x64 job; first-run GREEN) |
| 3 | SHA-256 integrity GREEN | run 34255257006 (manifest + offline verification + tamper negative controls) |
| 4 | ad-hoc signature verification GREEN | run 34255257006 (verify-signatures + verify-release + Hardened Runtime flags) |
| 5 | Model A GREEN | FROZEN: localhost-security run 34240532237 |
| 6 | SMAppService CI-provable contract GREEN | run 34279589309 (both arches; 5-red ledger in §13) |
| 7 | Keychain CI-provable contract GREEN | run 34285107767 (both arches; 1-red ledger in §13) |
| 8 | install/reinstall/uninstall preservation GREEN | FROZEN: reinstall-acceptance |
| 9 | interactive acceptance harness READY | `interactive-acceptance.sh` (zero-cost revision) + 5 acceptance docs |

When 1–9 hold, the status is ZERO-COST-RELEASE-CANDIDATE and the
remaining proof is exactly the interactive acceptance on ONE clean Mac
(§11).

## 11. What remains for the owner on ONE clean interactive Mac

1. Acquire the release artifacts (DMG + `.manifest.txt` + `verify-release.sh`)
   from the green CI run, onto the clean Mac, quarantine-preserving
   (browser download or `curl` from a web URL).
2. `bash verify-release.sh <dmg> <manifest>` → VERIFY-RELEASE-GREEN.
3. `bash macos/scripts/interactive-acceptance.sh DMG=<dmg> MANIFEST=<manifest> EXPECTED_ARCH=<arm64|x86_64>`
   and follow the printed HUMAN steps: the Gatekeeper warning +
   Open-Anyway approval (section 4), Login Items approval (section 5),
   sentinel patient (section 6), quit/reopen (7–8), logout/login (9),
   reboot (10), optional controlled update (11), uninstall check (12).
4. Record the keychain prompt behavior during section 11 (prompted or
   not) — the ad-hoc identity stability evidence.

## 12. Prohibited (never, under this model)

`spctl --master-disable`; security-policy disabling; automatic or manual
quarantine removal as part of acceptance; fake Developer ID
certificates; stolen/shared certificates; fake notarization;
certificate trust tricks presented as Apple trust; labeling the release
Apple-verified/Apple-approved/Developer-ID-signed/notarized; silent
automatic updates; touching the Windows tree; merging to main;
modifying the dashboard; re-running the ten frozen CI modes.

## 13. Freeze evidence (FILLED 2026-09-08 — all runs on the public mirror,
dispatched per ONE SHA + ONE MODE = ONE RUN; the ten frozen modes were
never rerun — all skipped by the mode guard in every run)

**zero-cost-release — run 34255257006 @ private b3dc522 (FIRST-RUN
GREEN, both arches, zero reds):**

- arm64 job: `MediVault-arm64.dmg` (203,766,525 bytes),
  SHA-256 `7059c3725b256be8860622e89e28e3d76cce3388ec7aec4953637f8eefc29b34`,
  manifest 8733 files (15 Mach-O), 16 symlinks, arch arm64, version
  0.1.0, bundle id `com.medivault.desktop`, minOS 13.0;
  `ZC-NODE-ALLOW-JIT: not-needed` (zero entitlements);
  ZC-OFFLINE-VERIFICATION GREEN (self-audit + tamper negative
  controls: corrupted-DMG RED + forged-manifest RED);
  ZC-HARDENED-LIFECYCLE GREEN (canonical per-user install of the exact
  release artifact, shipped relocatable config, CLEAN provisioning,
  /health + /ready 200 on 127.0.0.1:3001, SCRAM SELECT 1, 8 migrations,
  graceful SIGTERM exit 0, zero orphans).
  Artifacts retained 30 days: `medivault-zero-cost-release-arm64`
  (DMG + .sha256 + manifest + verify-release.sh + SECURITY-DISCLOSURE.md
  + FIRST-INSTALL.md + summary). The downloaded artifact re-hashed to
  the exact manifest value end-to-end through GitHub's pipeline.
- x64 job: `MediVault-x86_64.dmg`,
  SHA-256 `1eb5a2452922d3f587227623cfa0a176443ebcbb178fc18da5164b2923b22f35`,
  manifest 8733 files (15 Mach-O); same GREEN marker set.
  Artifacts: `medivault-zero-cost-release-x86_64` (same set).

**smappservice-lifecycle — run 34279589309 @ private d4ef774 (GREEN,
both arches; first-red ledger of 5):**

- 34261011477 @ 84fc66b-lineage b3dc522: my pre-registration assertion
  was mis-shaped (`notRegistered` asserted; the documented fresh state
  for a never-launched app is `notFound` — identical value in the frozen
  production-readiness evidence). Fixed: both accepted + recorded.
- 34265844092 @ 84fc66b: register() SUCCEEDED under the ad-hoc release
  signature → status `enabled`; my generic `launchctl print` grep
  expected `program = ` but the SMAppService job prints
  `program identifier = <BundleProgram>` + `managed_by =
  com.apple.xpc.ServiceManagement`. Fixed with the REAL (stronger)
  job-shape assertions.
- 34269854253 @ fed2dff: `SA-BRANCH=enabled` written into a sourced env
  file — hyphens are invalid in bash identifiers (executed as a command,
  exit 127). Fixed to `SA_BRANCH`.
- 34271908241 @ c6c0bcd: EMPIRICAL FINDING — launchd/SMAppService-
  trampolined processes are NOT visible to `pgrep -f` (pid 86833 running
  + healthy, pgrep matched nothing). Fixed: the supervisor's
  self-reported `.pid` (status file) + `kill -0` liveness — the honest
  discipline.
- 34275097624 @ 9e7f8de: SMAppService.unregister() flips status to
  `notRegistered` immediately but the launchd job teardown is
  ASYNCHRONOUS. Fixed: bounded 60s wait for job removal; residual job
  acceptable only if inert (no live supervisor, not state=running).
- Final GREEN evidence (both arches): SA-REGISTER-UNDER-ADHOC GREEN,
  status after register `enabled`, SA-LAUNCHD-JOB GREEN
  (ServiceManagement-managed, BundleProgram shape, parent bundle
  com.medivault.desktop), SA-BRANCH-A-GREEN (launchd RunAtLoad →
  healthy; supervisor parent == launchd(1); /health 200),
  SA-KEEPALIVE-GREEN (SIGKILL 89266 → launchd relaunch 90285 healthy),
  SA-OPEN-SETTINGS-GREEN, unregister → notRegistered + async teardown +
  processes stopped.

**keychain-lifecycle — run 34285107767 @ private 8ead05c (GREEN, both
arches; first-red ledger of 1):**

- 34283175406 @ d4ef774: my K4 assertion expected the provisioner's
  `VALID_EXISTING` line on restart — but the supervisor recognizes an
  already-provisioned cluster ITSELF (`cluster_provisioned()`:
  PG_VERSION in PGDATA) and does NOT re-invoke the provisioner; run 2's
  healthy state + unchanged initdb count IS the restart proof (the
  x64 leg failed only at `next/font` Google-Fonts fetch — the known
  transient runner variance, frozen production-readiness precedent).
  Fixed: K4 = fresh process healthy + exactly ONE provisioner
  delegation total + initdb count unchanged + PG_VERSION present +
  /health 200.
- Final GREEN evidence (both arches): K1 provisioning GREEN (5 items,
  REAL random values, never printed), K2 read #1 GREEN (CLEAN delegated
  provisioning → healthy; /ready authenticated), K3 graceful GREEN
  (exit 0, zero orphans, postmaster.pid gone), K4 read #2 GREEN (fresh
  process, existing cluster recognized, no re-provisioning), K5
  idempotence GREEN (5/5 already present — never overwritten), K6
  fail-closed GREEN (deleted jwt-secret → supervisor exit 1 +
  documented error naming the account + no API/DB start).
  KL-ACL-MODIFICATIONS: NONE.

**Status: ZERO-COST-RELEASE-CANDIDATE declared on 2026-09-08.**

Remaining proof = EXACTLY the interactive acceptance on ONE clean Mac
(§11): the Gatekeeper warning + Open-Anyway approval (the contract's
PASS is warning + override + subsequent normal launch), the Login Items
approval, the synthetic sentinel, quit/reopen, logout/login, reboot,
the controlled update (with the keychain prompt note), and the
uninstall data-preservation check — all driven by
`macos/scripts/interactive-acceptance.sh`.

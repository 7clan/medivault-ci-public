# MediVault — macOS Production-Readiness Contract (stage: production-readiness)

Status: **FROZEN GREEN** (frozen 2026-09-08T01:48Z). Evidence: public
run **34174841903** (run_number 33) @ mirror snapshot `8a549c5` (=
private `3e14537`) — `production-readiness (arm64)` job **101906072260**
GREEN (00:54:22→01:05:35Z) and `production-readiness (x64)` job
**101906071818** GREEN (01:19:06→01:47:55Z; the leg's FIRST attempt
failed at `next/font` remote-resource fetch — instance variance on that
runner, retried via the run's `rerun-failed-jobs` endpoint: SAME run,
SAME SHA, no duplicate dispatch; ONE SHA + ONE MODE = ONE RUN held).

First-red ledger (all new-lane issues; frozen product semantics never
altered):
1. run 34167622193 @ `1e2a5cd` — MY OWN test was shape-flawed: asserted
   `lexical(root/Contents/MacOS) == lexical(exe_dir)`, which only holds
   when the exe truly sits at `<root>/Contents/MacOS` (not for a test
   binary in `target/debug/deps`). Fixed `dfdcf77`: prove the
   normalization contract at the real location + the bundle-shape math
   on a synthetic path.
2. run 34168321417 @ `e675767` — swiftc emits `LC_RPATH /usr/lib/swift`
   (outside the bundle): the frozen Mach-O gate rejects it. Fixed
   `83d8f66`: `install_name_tool -delete_rpath /usr/lib/swift` + re-sign
   (the Swift runtime dylibs resolve via absolute `/usr/lib` install
   names — allowed by the gate's deps rule).
3. run 34169508827 @ `1e46adb` — TWO findings: (a) MY verifier bug:
   `codesign -d -d` never prints the CodeDirectory flags line — fixed
   with `codesign -dvv`; (b) REAL hygiene finding: the PREBUILT prisma
   query engines ship their BUILD MACHINE's absolute install ID
   (`/Users/runner/work/prisma-engines/…/libquery_engine.dylib`) in
   LC_ID_DYLIB — never surfaced before (frozen gates never covered the
   prisma engines; they are dlopen'ed, not linked). Fixed `d0ef88d`:
   rewrite install IDs to `@loader_path/<name>` + re-sign + a
   fail-closed residual absolute-path scan across every shipped Mach-O.
4. run 34171321066 @ `0cdfeef` — MY scan bug: `otool -L` line 1 is the
   HEADER (the inspected file's own path) — scanning all lines flagged
   every Mach-O's header. Fixed `0cfc7a9`: `tail -n +2` (header skip;
   line 2 = install ID for dylibs, then deps).
5. run 34172486700 @ `729ef53` — MY scan false-positive: the no-legacy
   scan matched the SMAppService helper's DOCUMENTATION comments
   ("NOT legacy launchctl load/unload"). Fixed `7fd473d`: strip
   comment lines — the scan fails only on real code.
6. run 34173608740 @ `6fbb150` — REAL gap: the Node provisioner re-reads
   the shared config with the OLD loader (required absolute user dirs,
   no `Contents/`-relative support) and crashed on the shipped
   relocatable shape. Fixed `3e14537`: the provisioner mirrors the
   Rust contract exactly (optional user dirs with per-user defaults,
   `Contents/`-relative resolution against the config-derived bundle
   root, resolved provisioner/prisma paths).

Lane: `platform/macos` (private, canonical) → `7clan/medivault-ci-public`
(public mirror, history-free) — unchanged flow. All predecessor stages
remain FROZEN GREEN (not rerun).

## 0. Purpose

Everything that can honestly be completed BEFORE Apple Developer
credentials and an interactive Mac exist:

1. **Relocatable production install model** — the shipped
   `supervisor-config.json` is bundle-relative (`Contents/`-prefixed
   paths; per-user `~/Library` defaults applied at load by the
   supervisor); the LaunchAgent plist uses `BundleProgram`
   (launchd.plist(5), SMAppService-only key) instead of an absolute
   `Program`; the supervisor defaults to `run` + the exe-relative config
   when started with no arguments (the LaunchAgent shape). Proven
   end-to-end from an arbitrary install location.
2. **SMAppService production control path** — the Swift helper
   (`Contents/MacOS/medivault-launchagent`), the Rust desktop commands,
   and the Settings → Background panel implementing Apple's exact status
   model (notRegistered | enabled | requiresApproval | notFound) with
   `openSystemSettingsLoginItems()` for the approval state. No legacy
   `launchctl load/unload` anywhere in production paths.
3. **Hardened Runtime structural proof** — every Mach-O signed
   ad-hoc+runtime in the exact production inside-out order with the
   least-privilege entitlements, verified fail-closed. Explicitly NOT
   production signing; Gatekeeper GREEN is never claimed.
4. **Node JIT entitlement decision, empirical** — strictest-first:
   run a JIT-tiering workload under the hardened Node with NO
   entitlements; if it crashes, record the proof and add
   `com.apple.security.cs.allow-jit` to the Node binary ONLY, then
   re-prove. Zero other entitlements anywhere.
5. **Hardened lifecycle from the installed app** — the supervisor
   lifecycle (delegated CLEAN provisioning → healthy → graceful stop)
   running with the HARDENED binaries from an arbitrary install
   location using the SHIPPED relocatable config (production shape).

## 1. What runs (mode: `production-readiness`) — PROVEN GREEN 2026-09-08

Matrix: `macos-26` (arm64) + `macos-26-intel` (x64) — the newest-OS
runners (the frozen dmg pipeline blocks, pinned versions, same cache
keys; a cache miss rebuilds the identical dt13 contract).

GREEN evidence per step (both arches):
* supervisor unit tests 13/13 (incl. the relocatable-config resolution
  suite: bundle-relative resolution, optional user dirs, the synthetic
  odd-location bundle) — `test result: ok. 13 passed`;
* desktop unit tests 2/2 (SMAppService status mapping + the
  fail-closed rejection of any non-documented status);
* PRISMA-INSTALL-ID-HYGIENE-GREEN (2 engines repaired to
  `@loader_path/…` + zero non-system absolute references across every
  shipped Mach-O);
* SIGN-STRUCTURAL-ADHOC-GREEN — 15 nested Mach-O components + the root,
  signed inside-out with `--options runtime`, zero entitlements;
* **NODE_ALLOW_JIT=not-needed** (the empirical strictest-first proof:
  hardened Node with NO entitlements ran the JIT-tiering workload,
  exit 0, `JIT-WORKLOAD-OK` — V8's MAP_JIT W^X path works under the
  Hardened Runtime on Node 22.23.2; the shipped configuration carries
  ZERO entitlements, matching the least-privilege directive);
* VERIFY-SIGNATURES-GREEN — 15 components + root, hardened-runtime flag
  verified everywhere (`codesign -dvv`), entitlements exact, bundle
  placement + relocatable-config contract, per-component strict
  verification;
* SMAppService proofs — helper `self-test` from inside the built .app
  (bundle identity + plist found at the exact shipped path), `status`
  returns a documented value (`notFound` on CI — the four-value model
  membership is the assert), plutil lint + BundleProgram contract;
* NO-LEGACY-REGISTRATION-GREEN + NO-ALTOOL-GREEN (code-only scan);
* DMG built + verified (frozen contract);
* DEFAULT-CONFIG-RESOLUTION-GREEN — `status` with NO `--config` from
  `$RUNNER_TEMP/OddPlaces/deep/MediVault.app` exits 2 (valid config,
  no status yet): exe-relative default resolution proven from an
  arbitrary install location;
* HARDENED-LIFECYCLE-GREEN — the supervisor with NO arguments (the
  LaunchAgent shape) from the odd location: seeded keychain bootstrap
  5/5, CLEAN delegated provisioning via the PACKAGED provisioner (now
  relocatable-aware), 8/8 migrations, authenticated SELECT 1 as the
  app role on the SHIPPED production port 55432, the API on the
  packaged hardened Node with /health + /ready 200 on port 3001,
  graceful SIGTERM exit 0, zero owned orphans, postmaster.pid gone.

1. **Preflight** — native arch proof (uname + proc_translated), tools
   (swiftc present).
2. **Frozen app build** — frontend export, `cargo tauri build`,
   supervisor, provisioner, API, prisma closure, pinned Node tarball,
   PG 17.11 dt13 (shared cache) — the frozen `dmg` pipeline blocks.
3. **SMAppService helper** — `swiftc -O -target <arch>-apple-macos13.0`
   builds `mediavault-launchagent`; macho-gate (single arch, minOS ≤
   13.0, `/usr/lib`+`/System` deps only); staged into
   `Contents/MacOS/`.
4. **Relocatable staging** — `stage-app-bundle.sh` (updated) writes the
   shipped `supervisor-config.json` (Contents/-relative, no user
   identity, production ports 55432/3001, keychain source,
   `tauri://localhost` origin) and asserts the plist `BundleProgram`
   contract + `plutil -lint`.
5. **Structural hardened signing** — `signing-manifest.sh` →
   `sign-production.sh` (MV_ADHOC_STRUCTURAL=1) → `verify-signatures.sh`
   GREEN (strict per-component verify, runtime flag everywhere,
   entitlements exact, placement contract).
6. **Node JIT strictest-first proof** — hardened Node without
   entitlements runs a JIT-tiering workload:
   * pass → `NODE_ALLOW_JIT=not-needed` (zero entitlements ship);
   * crash → re-sign Node with allow-jit, re-run, must pass →
     `NODE_ALLOW_JIT=needed` (recorded with the failure evidence).
   The final verified bundle always reflects the PROVEN configuration.
7. **SMAppService proofs** — helper `self-test` from inside the built
   .app (bundle identity, plist found at the exact shipped path, live
   status query); `status` returns one of the four documented values
   (expected on CI: `notRegistered`/`notFound` — membership is the
   assert, never the specific value); Rust status-mapping unit tests
   (`cargo test` for the desktop crate's mapping module + the
   supervisor's config resolution tests).
8. **No-legacy-registration proof** — the shipped tree contains no
   `launchctl load/unload`, `SMLoginItemSetEnabled`, `SMJobBless`, or
   `altool` in any production path (fail-closed grep of the staged
   scripts/ sources).
9. **Hardened lifecycle from an ODD install location** — build the DMG
   (frozen `build-dmg.sh`), mount, copy to a non-standard directory
   (`$RUNNER_TEMP/OddInstall/MediVault.app`), run the supervisor with
   NO `--config` (defaults: exe-relative shipped config), with the
   keychain seed variables (the proven harness pattern): CLEAN
   delegated provisioning → healthy (`/health` + `/ready` 200) →
   graceful SIGTERM → exit 0 → zero orphans. Then `status` (no config)
   proves the default config path resolution.
10. **Summary lines** — machine-readable pr-summary output (the r7
    pattern) for the directive report.

## 2. Honest not-proven list (interactive/credential-gated)

* Real SMAppService registration/approval (Login Items UI) — interactive.
* Developer-ID signing, notarization, stapling — credentials-gated
  (scripts READY; notarize-dmg.sh exits 2 by design until then).
* Gatekeeper acceptance — clean-machine + credentials.
* Keychain under the production identity — dedicated requalification
  plan (`developer-id-keychain-lifecycle`).
* Logout/login, reboot, drag/double-click UX — the interactive harness
  covers them on the doctor machine.

## 3. Frozen-stage safety

Additive changes only: a new helper binary in `Contents/MacOS/`, the
plist key model (Program→BundleProgram — the launchd-driven start path
was never CI-proven, only the foreground lifecycle, which is unchanged),
the shipped config content (CI jobs that need CI values overwrite it, as
the frozen harness steps already did), supervisor default-argument
support (explicit args keep the exact frozen behavior; the frozen modes
always pass `--config` explicitly). No frozen product code path changes
semantics. The frozen historical modes are NOT rerun; this mode provides
the regression proof for the additive deltas.

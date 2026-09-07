# MediVault — macOS Production-Readiness Contract (stage: production-readiness)

Status: **AUTHORED** — the production hardening / distribution
preparation phase. Freezes GREEN when the mode passes on BOTH
architectures on the public mirror CI.

Lane: `platform/macos` (private, canonical) → `7clan/medivault-ci-public`
(public mirror, history-free) — unchanged flow, ONE SHA + ONE MODE = ONE
RUN discipline. All predecessor stages remain FROZEN GREEN (not rerun).

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

## 1. What runs (mode: `production-readiness`)

Matrix: `macos-26` (arm64) + `macos-26-intel` (x64) — the newest-OS
runners (the frozen dmg pipeline blocks, pinned versions, same cache
keys; a cache miss rebuilds the identical dt13 contract).

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

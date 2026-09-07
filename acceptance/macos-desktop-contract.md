# MediVault — macOS Desktop (Tauri) Contract (stage: desktop-build)

Status: **FROZEN GREEN** (stage: desktop-build — do not reopen unless a
later first-red directly proves this contract wrong)
Lane: `platform/macos` · Verified GREEN @ `59e3155`, run `34075676148`
(both arches, 2026-09-07) · Predecessor stages (FROZEN GREEN):
`integration` @ `a282f45` (34031521912), `pg-bundle-verify` @ `795df26`
(34051758040), `supervisor-lifecycle` @ `c71ac4c` (34063917607),
`provision-lifecycle` @ `1a0c48f` (34065567722), `bundle-verify` @
`2089913` (34066717890)
First-red ledger: (1) run `34067065373` — cargo tauri-cli installs the
executable as `cargo-tauri` (`tauri: command not found`); invoke via
`cargo tauri`. (2) run `34068656915` — Cargo.toml section ORDER made
every crate after the `[target.'cfg(windows)'.dependencies]` header
(tokio, log, uuid, chrono, …) Windows-ONLY, so macOS resolved none:
un-gated into [dependencies] (Windows graph unchanged, same lock).
(3) run `34070052883` — three never-compiled non-Windows paths:
ungated `use std::os::windows::ffi::OsStrExt` in credential/mod.rs; the
not(windows) backup branch referencing `metadata` vs `_metadata`; the
not(windows) scanner stub typing `super::WiaScannerInfo` instead of
`wia::WiaScannerInfo`. (4) run `34071656997` — tauri's bundler needs an
.icns (frozen set ships PNGs + .ico): icon.icns generated in CI from the
committed PNGs (sips + iconutil) and listed first. (5) run `34073656327`
— gate/smoke steps used `$APP` while the env file exports `APP_ROOT`.
GREEN run 34075676148: frontend export, `cargo tauri build --bundles
app` (per-arch, deployment target 13.0), backend merge into the SAME
MediVault.app, ad-hoc codesign + Mach-O gates on desktop + supervisor +
node + PG (all violations 0 — the WKWebView-linked desktop binary's
dependencies are all /System), and the launch smoke (starts, alive
≥15s, SIGTERM terminates).

## 1. What this stage delivers

The desktop shell joins the shipped tree: `cargo tauri build` (tauri 2.11.5
crate, tauri-cli v2, per-arch, `MACOSX_DEPLOYMENT_TARGET=13.0`, app bundle
only — DMG is the next stage) produces `MediVault.app` with the desktop
binary + Info.plist (`LSMinimumSystemVersion 13.0`) + icons, and the
COMPLETE backend (frozen stage-3 tree) is merged into the SAME bundle:
supervisor at `Contents/MacOS/mediavault-supervisor`, node + PG runtimes,
api, provision, prisma closure, `supervisor-config.json`, LaunchAgent
plist at `Contents/Library/LaunchAgents/`.

Frontend: the existing static export (`NEXT_OUTPUT=export` → `out/`,
`frontendDist`) — the WKWebView serves it from the embedded assets; the
CSP now allows `connect-src http://127.0.0.1:*` (macOS backend bind; the
audit's known risk #5, fixed in this lane only).

## 2. What CI proves (desktop-build mode, both arches)

1. The frontend exports (`out/index.html` + assets).
2. `tauri build --bundles app` compiles the desktop binary per-arch under
   the deployment target.
3. The backend merge produces the complete bundle (frozen layout guards).
4. Ad-hoc codesign + the fail-closed Mach-O gate on EVERY native binary:
   desktop, supervisor, node, PG bundle (violations 0 expected).
5. **Launch smoke (honest scope)**: the desktop binary starts on the
   runner, stays alive ≥15 s, terminates on SIGTERM. Real window UX
   (close/reopen, Login Items pane, drag-to-Applications, translocation)
   stays an INTERACTIVE proof per the audit — never silently claimed by CI.

## 3. Non-goals / later stages

- DMG construction + signing — next stage (DMG).
- The full desktop-launch regression (window + backend + settings UX) and
  the reinstall matrix — later modes.
- SMAppService registration from the app (first-run setup) — desktop
  integration stage; the plist + supervisor contract is already frozen.
- Scanner (ImageCaptureCore) — feature-gated, non-blocking (audit).

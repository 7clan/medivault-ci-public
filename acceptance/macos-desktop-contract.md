# MediVault — macOS Desktop (Tauri) Contract (stage: desktop-build)

Status: **IN PROGRESS — first-red discipline active** (marked FROZEN GREEN
only when the `desktop-build` CI mode is green on both architectures)
Lane: `platform/macos`
Predecessor stages (FROZEN GREEN): `integration` @ `a282f45` (34031521912),
`pg-bundle-verify` @ `795df26` (34051758040), `supervisor-lifecycle` @
`c71ac4c` (34063917607), `provision-lifecycle` @ `1a0c48f` (34065567722),
`bundle-verify` @ `2089913` (34066717890)

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

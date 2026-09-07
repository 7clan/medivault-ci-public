# MediVault — macOS DMG Contract (stage: dmg)

Status: **FROZEN GREEN** (stage: dmg — do not reopen unless a later
first-red directly proves this contract wrong) · Verified GREEN @
`9623a48`, run `34077839660` (both arches, 2026-09-07) — GREEN on the
FIRST dispatch (no first-reds this stage): the desktop-build pipeline
ran clean and the DMG constructed + verified on both architectures
Lane: `platform/macos`
Predecessor stages (FROZEN GREEN): `integration` @ `a282f45` (34031521912),
`pg-bundle-verify` @ `795df26` (34051758040), `supervisor-lifecycle` @
`c71ac4c` (34063917607), `provision-lifecycle` @ `1a0c48f` (34065567722),
`bundle-verify` @ `2089913` (34066717890), `desktop-build` @ `59e3155`
(34075676148)

## 1. Construction (per arch)

`macos/scripts/build-dmg.sh`: staging folder with the COMPLETE
`MediVault.app` (desktop-build product: Tauri shell + supervisor + pinned
Node + PG17 + api + provision + prisma + config + plist) plus an
`/Applications` symlink; `hdiutil create -volname MediVault -format UDZO`;
the DMG is ad-hoc signed (`codesign -s -`). Output:
`MediVault-macOS-arm64.dmg` / `MediVault-macOS-x64.dmg` + SHA-256 sidecar.

## 2. Verification (CI-provable, both arches)

Mount (`hdiutil attach -readonly -nobrowse`), then fail-closed asserts:
drag layout (mounted app + `/Applications` symlink → `/Applications`),
mounted app structure (desktop + supervisor + node + PG + api + provision
+ prisma closure + config + plist), ad-hoc signatures of the DMG, the
mounted .app, and its binaries, then detach. `du` + SHA-256 recorded.

## 3. Explicitly NOT proven on CI (per the audit, honestly)

- Launching the app FROM the mounted volume (app translocation) —
  clean-machine/interactive proof.
- Gatekeeper UX, notarization, Developer ID — production-only phase per
  the pivot directive (ad-hoc until the doctor-facing DMG phase).
- Drag-to-Applications install UX — interactive.

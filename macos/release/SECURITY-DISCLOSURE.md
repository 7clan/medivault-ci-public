# MediVault — Security disclosure (READ BEFORE FIRST LAUNCH)

This is an honest, plain statement of how this MediVault release was built
and what your Mac will show you. Nothing here is hidden or sugarcoated.

```
APPLE DEVELOPER ID: NO
APPLE NOTARIZATION: NO
GATEKEEPER AUTOMATIC TRUST: NO
FIRST INSTALL MANUAL APPROVAL: YES
```

## What this means

- MediVault is distributed **directly** by the clinic to a small number of
  known Macs. It is **not** distributed through the public internet at large.
- The app and every bundled component are signed with an **ad-hoc
  signature** (integrity + Hardened Runtime), **not** with an Apple
  "Developer ID Application" certificate, and the release has **not** been
  notarized by Apple. No Apple Developer Program membership is held for
  this product.
- Therefore, on first launch, **macOS Gatekeeper will show a warning**
  ("can't be opened because it is from an unidentified developer" or the
  modern equivalent). **This is expected.** It is not a sign of tampering.

## How to approve the app (Apple's supported flow — Gatekeeper stays ON)

1. Double-click `MediVault` the first time. macOS blocks it and shows the
   warning. **Do not** bypass Gatekeeper globally and **do not** run any
   commands to disable security settings.
2. Open **System Settings → Privacy & Security**.
3. Scroll to the security prompt about MediVault and click **Open Anyway**.
4. Confirm in the dialog that appears (**Open**).
5. MediVault launches. **Every later launch works normally** — the manual
   approval is a one-time action per app version install.

If you prefer command-line pre-install verification, run
`verify-release.sh` with this DMG and its `.manifest.txt` sidecar BEFORE
installing — it re-hashes every file offline and checks the signatures.

## What IS protected in this release

- Every file on this disk image is covered by a SHA-256 manifest
  (the `.manifest.txt` sidecar shipped next to the DMG). Any changed byte
  is detectable offline before installation.
- All native components (the app, the supervisor, the Node runtime, the
  PostgreSQL runtime, the Prisma engines) are ad-hoc code-signed with the
  Hardened Runtime flag, inside-out (every nested component first, the app
  root last).
- The backend API and PostgreSQL listen **only on 127.0.0.1** (localhost).
  No LAN exposure, strict Origin checking, session + CSRF protection.
- Application data (PostgreSQL cluster, encryption keys in the Keychain)
  lives OUTSIDE the app bundle and is preserved across app updates and
  reinstalls.

## What this release must NEVER be called

This release is **not** "Apple-verified", **not** "Apple-approved", **not**
"Developer-ID-signed", and **not** "notarized". Anyone describing it with
those words is misdescribing it.

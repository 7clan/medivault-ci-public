# MediVault — First install on macOS 13 or later

You need 5 minutes and the two files the clinic gave you:

- `MediVault-<arch>.dmg`  — the app disk image
- `MediVault-<arch>.manifest.txt` — its SHA-256 integrity sidecar

`<arch>` must match your Mac: `arm64` for Apple Silicon, `x86_64` for Intel.

## Optional but recommended: verify BEFORE installing (offline)

If you are comfortable with Terminal (Xcode Command Line Tools required):

```sh
bash verify-release.sh MediVault-arm64.dmg MediVault-arm64.manifest.txt
```

This re-hashes every file in the image offline (no internet needed) and
checks every signature. It must print `VERIFY-RELEASE-GREEN`.

## Install

1. Double-click the `.dmg`. It mounts as "MediVault".
2. Read `SECURITY-DISCLOSURE.md` on the mounted volume (also required
   reading for the first-launch approval below).
3. Drag **MediVault** onto the **Applications** folder shortcut shown in
   the same window.
4. Eject the "MediVault" volume.

## First launch — the Gatekeeper approval (ONE time, expected)

The first launch is blocked by macOS with a warning because this release
is ad-hoc signed and not notarized. **This is expected.** Approve it the
Apple-supported way — Gatekeeper stays ON:

1. Open **MediVault** from Applications. The Gatekeeper warning appears.
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the MediVault security note → click **Open Anyway**.
4. Confirm with **Open**. MediVault starts.
5. From now on, launching MediVault works normally, no warning.

Never disable Gatekeeper (no `sudo spctl --master-disable`, no security
"tweaks"). The manual **Open Anyway** approval is the supported path.

## After first launch

- MediVault asks to register its background service (Login Items). Approve
  it in **System Settings → General → Login Items** when macOS shows the
  notice — this is what keeps the clinical backend running.
- All data lives in `~/Library/Application Support/MediVault` and secrets
  in your login Keychain. Replacing the app (update) preserves them.

## Updating to a new version (controlled manual replacement)

1. Quit MediVault (the backend stops gracefully).
2. Run `bash verify-release.sh <new-dmg> <new-manifest>` — must be GREEN.
3. Drag the new MediVault over the old one in Applications (replace).
4. Launch once. Your data is preserved; the Keychain may ask you to allow
   the new version access to MediVault's stored items — choose **Always
   Allow** if prompted.

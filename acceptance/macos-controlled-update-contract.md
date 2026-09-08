# MediVault macOS — Controlled update contract (zero-cost model)

Status: **AUTHORED** — the only supported update mechanism under the
zero-cost release model. Governing contract:
`acceptance/macos-zero-cost-release-contract.md`.

## Why no automatic updater

There is no Developer ID identity and no notarization. A silent
automatic updater would replace the running app without the doctor's
knowledge and without any identity anchor to prove the replacement's
provenance — exactly the shape of a drive-by attack. Therefore:

* NO silent automatic updater exists (and none may be added under this
  model);
* updates are **controlled manual replacement**, performed or supervised
  by the clinic, with offline hash verification BEFORE anything is
  touched.

## The procedure (mandatory order)

1. **Verify the NEW DMG offline, before anything is touched:**
   `bash verify-release.sh <new-dmg> <new-manifest.txt>` → must print
   `VERIFY-RELEASE-GREEN` (every file hash + every ad-hoc signature +
   disclosure + layout; no network needed). A RED verification aborts
   the update.
2. **Stop owned processes safely:** quit MediVault (the desktop app
   asks the supervisor to stop; the supervisor stops the API and
   PostgreSQL gracefully — SIGTERM, supervisor exit 0, zero orphans,
   `postmaster.pid` gone). Do not `kill -9`.
3. **Replace `MediVault.app`:** Finder drag-replace (or `rm -rf` + copy
   from the verified DMG).
4. **Preserve (never delete):**
   * `~/Library/Application Support/MediVault` (cluster + state);
   * the PostgreSQL data directory semantics (no re-initdb —
     CI-frozen: reinstall CASE 3a/3b);
   * the 5 Keychain items (`dev.medivault` service) — never overwritten
     (bootstrap is idempotent by design);
   * `~/Library/Logs/MediVault`.
5. **Restart:** launch MediVault once. If macOS dropped the Login Item
   registration during replacement, re-approve it in Login Items (the
   app surfaces this via its Background panel). If macOS or the
   Keychain asks to authorize the new version for MediVault's items,
   choose **Always Allow** (record the prompt behavior — it is the
   ad-hoc identity stability evidence).
6. **Verify sentinel data:** the synthetic acceptance patient is still
   visible; the API is healthy (`/health` on 127.0.0.1:3001). The
   provisioner classifies the existing cluster as `VALID_EXISTING`
   (recorded in `provision.log`); no re-initialization occurs.

## What the update must never do

* never disable Gatekeeper or remove quarantine to "make it easier";
* never fall back to unsigned/unverified artifacts (verification is
  step 1, always);
* never delete Application Support, cluster data, or keychain items;
* never re-run initdb over an existing cluster (fail-closed by the
  frozen provisioning semantics);
* never claim the new build is Apple-verified in any way.

## CI + interactive evidence

* **CI (frozen):** `reinstall-acceptance` CASE 3a/3b — build B
  (v0.1.1) replaces build A (v0.1.0): sentinel row count unchanged,
  `PG_VERSION` byte-identical, `provisioned.json` `createdAt`
  unchanged, initdb count does not grow, keychain 5× already-present,
  and the NEW build's supervisor reaches healthy from the preserved
  data.
* **CI (new):** `zero-cost-release` proves the verification tool itself
  against the real release artifacts (`verify-release.sh` GREEN +
  offline self-audit).
* **Interactive:** `interactive-acceptance.sh` section 11 executes the
  full procedure on the doctor Mac with the same assertions automated
  where possible (pre-replacement offline verification, post-replacement
  health, operator-confirmed sentinel persistence + keychain prompt
  note).

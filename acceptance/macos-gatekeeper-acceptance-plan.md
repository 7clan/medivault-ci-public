# MediVault macOS — Gatekeeper acceptance plan (ZERO-COST revision)

Status: **AUTHORED (zero-cost form)** — supersedes the Developer-ID-era
revision of this plan. Executes whenever a zero-cost release DMG exists
(it always ships ad-hoc signed). Governing contract:
`acceptance/macos-zero-cost-release-contract.md`.

## Core principle: the warning is the contract, not a failure

Under the zero-cost release model (no Developer ID, no notarization) the
expected first-launch behavior is a Gatekeeper block:

> "MediVault" can't be opened because it is from an unidentified
> developer. (or the current macOS wording of the same fact)

**PASS = warning occurs as expected AND Apple's supported manual
override successfully authorizes the known app AND subsequent normal
launch succeeds.** A missing warning on a quarantined fresh install
would be an anomaly worth investigating (wrong artifact or stale
approval), not a success.

## The acceptance flow (real, on a fresh Mac / clean VM user)

1. **Fresh/clean Mac or reset VM** — no prior MediVault installs, no
   cached trust, ideally a freshly created user account (a factory-reset
   VM is the strong form). Gatekeeper fully ON.
2. **Acquire the DMG quarantine-preserving** — browser download or
   `curl` from a web URL. The harness fails closed unless
   `xattr -p com.apple.quarantine <dmg>` is non-empty.
3. **Optional pre-install offline verification** —
   `bash verify-release.sh <dmg> <manifest>` → VERIFY-RELEASE-GREEN
   (every file hash + every ad-hoc signature + disclosure facts; no
   network).
4. **Mount + Finder drag to /Applications** (the drag preserves
   quarantine; Terminal copies are NOT the acceptance path).
5. **First launch attempt — EXPECT the Gatekeeper block.** Do not treat
   it as a failure; do not bypass it.
6. **Apple-supported manual override:**
   System Settings → Privacy & Security → scroll to the MediVault
   notice → **Open Anyway** → confirm **Open**. The app launches.
7. **Subsequent launches work normally** — no warning, no approval
   (relaunch at least once).
8. **Gatekeeper stays enabled the whole time.** No `spctl
   --master-disable`, no security-policy disabling, no quarantine
   removal, no certificate manipulation of any kind.

## Machine-level assessment (informational, NOT the gate)

`syspolicy_check distribution <path>` / `spctl -a -t open` on the
ad-hoc DMG are EXPECTED to be rejected — that is what "no automatic
trust" means. CI records these outputs as information only
(`verify-signatures.sh` honesty rule); they are never pass/fail and
never phrased as Gatekeeper acceptance. The acceptance gate is the
interactive flow above.

## RED criteria (any one fails the acceptance)

* No Gatekeeper warning appears on a quarantined first launch of the
  ad-hoc release (unexpected — investigate stale trust/wrong artifact).
* The Open Anyway flow is unavailable or does not authorize the app
  (e.g. the notice never appears in Privacy & Security).
* After the manual override the app still cannot launch.
* Subsequent launches still warn or block.
* The app's ad-hoc signature fails strict verification
  (`codesign --verify --strict`) before or after launch.
* The offline verification (`verify-release.sh`) is RED on the acquired
  DMG (tampered or corrupted acquisition).
* Gatekeeper had to be disabled or quarantine removed to make it work
  (forbidden — this invalidates the acceptance, it does not fix it).

## Automated pre-flights wired (CI)

* `build-release-dmg.sh`: disclosure facts + layout + strict signatures
  on the mounted volume (fail-closed).
* `verify-release.sh` in CI: the full offline verification against the
  real release DMG, plus the `--offline-audit` proof that the tool
  itself invokes no network command.
* `verify-signatures.sh` honesty rule unchanged: ad-hoc artifacts never
  yield a Gatekeeper-GREEN claim.

## Interactive proof vehicle

`macos/scripts/interactive-acceptance.sh` sections 0–4 automate this
plan on the clean Mac (quarantine check, offline verify, ad-hoc +
Hardened-Runtime signature checks, the human Gatekeeper steps with
explicit EXPECTED outcomes, subsequent-launch check). The harness never
removes quarantine; its only quarantine-touching block is the disabled
`MV_DEV_DIAGNOSTIC=1` development diagnostic.

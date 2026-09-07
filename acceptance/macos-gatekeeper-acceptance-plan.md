# MediVault macOS — Gatekeeper acceptance plan

Status: **AUTHORED** — executes when a Developer-ID-signed, notarized,
stapled DMG exists (requires Apple credentials first).

## Core principle: NOTARIZATION ≠ GATEKEEPER ACCEPTANCE

Two SEPARATE gates (directive §11):

1. **Notarization gate** — `macos/scripts/notarize-dmg.sh`:
   submit → status **Accepted** (required, fail-closed) → notarization
   log RETAINED → `stapler staple` → `stapler validate`. This proves
   Apple scanned the artifact and a ticket exists.
2. **Gatekeeper acceptance gate** — the operating system actually
   permitting first launch on a clean machine. A notarized artifact is
   NOT automatically Gatekeeper proof: cached trust state, online
   lookups, and stale assessment caches can mask problems.

## Tools (current, per Apple guidance and SYSPOLICY_CHECK(1))

* `syspolicy_check distribution <path>` — "runs the same checks on your
  app as macOS does when determining if your app can be executed. This
  includes Gatekeeper checks, XProtect checks, provisioning profile
  checks" — the modern pre-flight (macOS 14/15+).
* `syspolicy_check notary-submission <path>` — same checks as the notary
  service; used as an optional pre-submission diagnostic.
* `spctl -a -t exec` — legacy-but-valid cross-check (NOTE: on macOS
  Sequoia+ spctl no longer MANAGES Gatekeeper policy — assessment-only
  usage remains meaningful; policy toggling via spctl is dead and is not
  part of this plan).
* Deprecated/never used: `altool` (TN3147), `spctl --master-disable`.

## Highest-confidence final sequence (the acceptance standard)

1. **Fresh/clean Mac or reset VM** — no prior MediVault installs, no
   cached trust: `sfltool dumpbtm` shows no MediVault records; the
   quarantine-assessment cache for the relevant team/identifier is empty
   (a freshly created user account on a test Mac is a good approximation;
   a factory-reset VM is the strong form).
2. **Acquire the DMG quarantine-preserving** — browser download (or a
   `curl` fetch of the published artifact). Verify
   `xattr -p com.apple.quarantine` is NON-EMPTY before anything else
   (the interactive harness fails closed here).
3. **Install + first launch exactly like a normal user** (the harness's
   human steps): drag to ~/Applications, double-click.
4. **Test while ONLINE** — Gatekeeper resolves the notary ticket online
   when no staple is cached; both stapled and unstapled paths should
   behave. Record the actual first-launch dialog form.
5. **Test OFFLINE with the stapled ticket** — network off, fresh
   quarantine, first launch: the STAPLED ticket alone must satisfy
   Gatekeeper (this is what stapling is for). This run must use a NEW
   quarantined copy (e.g., re-download-then-offline, or a second clean
   user) so no cached online result masks anything.
6. **No cached trust masking**: rotate between at least two clean
   accounts/VMs for steps 4 and 5, and on macOS 14+ optionally clear
   `syspolicy` assessment entries via the supported UI (System Settings)
   — never by disabling Gatekeeper.

## Automated pre-flights already wired

* `notarize-dmg.sh` step 7: `syspolicy_check distribution` + `spctl`
  against the app mounted from the **stapled DMG** (the exact artifact a
  user receives).
* `verify-signatures.sh` honesty rule: ad-hoc artifacts NEVER yield a
  Gatekeeper-GREEN claim; syspolicy/spctl outputs for ad-hoc builds are
  recorded as information only.

## RED criteria (any one fails the gate)

* The clean-machine first launch shows a malware-style block or
  "unidentified developer" for the notarized+stapled artifact.
* The OFFLINE stapled first launch fails.
* `syspolicy_check distribution` rejects the mounted app.
* The staple is missing/invalid (`stapler validate` fails) on the
  distributed DMG.
* Any quarantine-preserving acquisition path shows the app cannot run.

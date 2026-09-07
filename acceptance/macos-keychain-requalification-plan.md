# MediVault macOS — Keychain production requalification plan

Status: **AUTHORED** — executes AFTER real Developer-ID signing exists.

## Why requalification is required

The existing keychain proofs (provision-lifecycle run 34065567722;
bundle-verify 34066717890; macos-26-smoke 34154281875; reinstall
34159463755) are engineering-GREEN with **ad-hoc signed** binaries. They
prove the mechanism: SecItemAdd by the supervisor, cross-process read-back
by the same binary, 5 items, no-overwrite idempotence 5/5, values never
printed.

They are **not** final production Keychain proof: changing the code
signature from ad-hoc to `Developer ID Application: NAME (TEAMID)` changes
the code's identity and designated requirement. Keychain ACLs on existing
items were bound to the ad-hoc designated requirement (or, for ACL-free
items, to "the creating code"). After the identity change:

* New items: created by the Developer-ID binary, ACL bound to the
  Developer-ID designated requirement — correct by construction.
* Existing items (upgrade-in-place scenarios): the new binary must still
  authenticate WITHOUT unexpected recurring prompts. This is exactly what
  must be proven — and it cannot be proven with ad-hoc artifacts.

## Planned stage: `developer-id-keychain-lifecycle`

Runs on a REAL machine (doctor Mac or a private-repo macOS runner with the
Developer-ID cert imported — NEVER the public mirror, which must not see
credentials) once `APPLE_DEVELOPER_ID_APPLICATION_*` secrets exist.

Sequence (per the phase directive — no ACL weakening to make CI happy):

1. **create secrets** — install a Developer-ID-signed build, run the
   supervisor bootstrap (`bootstrap-secrets` / first-run delegation);
   the 5 items are created by the new identity; capture item presence +
   account names only (never values).
2. **LaunchAgent helper reads them** — with SMAppService registration
   active, launchd starts the supervisor; it authenticates to PG/API from
   the keychain (indirect read proof: /health + /ready 200 + SCRAM SELECT 1
   as the app role).
3. **helper restart** — kill/restart the supervisor (launchd KeepAlive or
   manual): the SAME identity must read the same items with NO prompt
   (same-designated-requirement re-auth).
4. **read again after logout/login** — keychain re-lock/unlock cycle; the
   Login Items-driven supervisor start must re-authenticate silently.
5. **install a NEWER Developer-ID-signed build** (same Team ID) over the
   old one, same app-support data: the same keychain secrets must remain
   readable — same-team Developer-ID upgrades keep a stable designated
   requirement (anchor apple generic + Team ID), which is the property
   under test.
6. **no recurring unexpected keychain prompt** — any visible prompt
   (other than an intentional first-authorization UX the product defines)
   is RED.

GREEN criterion: all six steps pass with zero ACL modifications and zero
prompt recurrences; evidence = the run log + item presence records.

## Frozen-contract safety

No change to the supervisor's keychain code (macos/supervisor/src/keychain.rs)
is planned by this stage. The existing CI proofs stay valid for the
ad-hoc/CI lane; the new stage adds the production-identity lane. If step 5
fails (Team-ID-designated-requirement mismatch), the fix is architectural
(explicit ACLs pinned to the Team-ID anchor at creation time —
`SecAccess`/`SecTrustedApplication` equivalents via the Security
framework's ACL API), and it must be a deliberate, reviewed change — never
a blanket "allow all apps" weakening.

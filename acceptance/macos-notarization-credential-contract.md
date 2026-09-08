# MediVault macOS — Apple credential contract (names/types ONLY)

> **SUPERSEDED (2026-09-08, owner decision):** the zero-cost release
> model (acceptance/macos-zero-cost-release-contract.md) means NO Apple
> Developer Program membership, NO Developer ID signing, NO
> notarization. No Apple credentials will be requested again. This
> document is retained as the exact specification IF the owner ever
> reverses that decision; nothing in it is active.

Status: **SUPERSEDED (zero-cost model)** — nothing is requested, nothing will be. This document defines
exactly what the owner must later provide to unlock the production half of
the pipeline (signing + notarization). NO values are ever printed,
committed, mirrored, or written to the public repo.

## 1. Required secrets (exact names/types)

| Secret name | Type | Used for | Where it may live |
|---|---|---|---|
| `APPLE_DEVELOPER_ID_APPLICATION_CERT_P12` | base64 of the `.p12` export of the **Developer ID Application** certificate (cert + private key) | `security import` into the signing keychain, then `codesign` as `Developer ID Application: <NAME> (<TEAMID>)` | PRIVATE repo Actions secrets, or the local/doctor Mac keychain |
| `APPLE_DEVELOPER_ID_CERT_P12_PASSWORD` | string (the `.p12` export password) | `security import -P` | same as above |
| `APPLE_TEAM_ID` | 10-character Team ID string | building the identity string + notarytool `--team-id` contexts | same |
| `APPLE_ASC_API_KEY_ID` | App Store Connect API **Key ID** | notarytool API-key auth | same |
| `APPLE_ASC_ISSUER_ID` | App Store Connect **Issuer ID** (UUID) | notarytool API-key auth | same |
| `APPLE_ASC_API_KEY_P8` | base64 of the App Store Connect **`.p8` private key** file | notarytool API-key auth | same |

The API-key triple (`KEY_ID`, `ISSUER_ID`, `P8`) is Apple's recommended
notarytool authentication (TN3147; NOTARYTOOL(1): `--key <path> --key-id
<id> --issuer <uuid>`). **No Apple ID, no app-specific password, and no
Apple ID password is ever requested or stored** for notarization.

One-time (recommended) steady state: import the API key into a local
keychain profile once —
`xcrun notarytool store-credentials <profile> --key-id … --issuer … --key …`
— after which the pipeline takes just `NOTARY_PROFILE=<profile>`.
`macos/scripts/notarize-dmg.sh` supports both shapes.

## 2. Non-secret configuration (also needed at run time)

* `MV_SIGN_IDENTITY` = `Developer ID Application: <NAME> (<TEAMID>)` — the
  full identity string (derive from the certificate subject + Team ID).
* `NOTARY_PROFILE` (optional, steady state) — the stored keychain profile
  name.

## 3. Prerequisites on the Apple side (owner actions, one-time)

1. Apple Developer Program membership (the org account).
2. Create the **Developer ID Application** certificate in the Developer
   portal (cert signing request), export as `.p12` with a password.
3. Create an **App Store Connect API key** with Developer / Admin role
   sufficient for notarization; download the `.p8` (the Key ID + Issuer
   ID are shown at creation).
4. Record the Team ID.

## 4. Where secrets may NEVER go

* The public mirror `7clan/medivault-ci-public` (Actions secrets, env,
  files, or the synced tree) — the mirror is public by design; the
  notarization/signing pipeline is authored to run EITHER on the private
  repo's Actions OR on the owner/doctor Mac, never on the mirror.
* Logs, worklogs, reports (this repo's discipline already forbids it).
* Any `XTransformPort`/gateway-visible surface.

## 5. Pipeline state until then (expected, not an error)

`macos/scripts/notarize-dmg.sh` exits with code **2**
("credentials missing") by design — the fail-closed preflight. The
structural half (inside-out signing order, entitlements, Hardened Runtime
flags, strict verification) is CI-proven in ad-hoc structural mode by the
`production-readiness` mode; nothing production is claimed from it.

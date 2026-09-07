# MediVault macOS — Production-readiness research log

Sources reviewed for the production hardening / distribution preparation
phase (priority order: Apple documentation → Tauri 2 → Node/PG docs →
community operational evidence). Community advice conflicting with
current Apple documentation was resolved in favor of Apple.

## Apple (authoritative, primary)

| Topic | Source | Key takeaways used |
|---|---|---|
| Hardened Runtime | developer.apple.com/documentation/security/hardened-runtime | Runtime exceptions are per-entitlement; least-privilege model |
| `com.apple.security.cs.allow-jit` | developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit | "Allow Execution of JIT-compiled code" — the MAP_JIT exception; Apple's own text: JIT code "may crash or behave in unexpected ways" without it under Hardened Runtime |
| `allow-unsigned-executable-memory` | same tree | broader than allow-jit (writable+executable WITHOUT MAP_JIT) — deliberately NOT granted |
| TN3147 "Migrating to the latest notarization tool" | developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool | notarytool is the current tool; altool deprecated — pipeline uses notarytool only |
| Customizing the notarization workflow | developer.apple.com/documentation/security/customizing-the-notarization-workflow | `notarytool submit --wait`, keychain credentials, API-key auth |
| NOTARYTOOL(1) man page (Xcode) | full synopsis reviewed | auth forms: `--key/--key-id/--issuer` (API key) OR `--apple-id/--password/--team-id` OR `-p profile`; subcommands submit/info/wait/log/history/store-credentials; stapler(1) for tickets |
| SYSPOLICY_CHECK(1) man page | full synopsis reviewed | `syspolicy_check notary-submission` / `distribution [–verbose] [--json]` — distribution = "the same checks on your app as macOS does when determining if your app can be executed" |
| "Updating helper executables from earlier versions of macOS" | developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos | helpers INSIDE the app bundle; agents at `Contents/Library/LaunchAgents`; replace `Program` with **`BundleProgram`** bundle-relative; check authorization at launch; alert + `openSystemSettingsLoginItems()` |
| launchd.plist(5) | full `BundleProgram` section reviewed | `BundleProgram` is "an app-bundle relative path … only supported for plists that are installed using SMAppService"; `Program` must be absolute — hence BundleProgram for relocatable installs |
| SMAppService status model | SMAppService.Status (notRegistered/enabled/requiresApproval/notFound) via the API reference + theevilbit's documented walk-through | exactly four states surfaced; no invented values |
| ATS / NSAllowsLocalNetworking | developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking | local networking allowance semantics (localhost-security recommendation input) |
| TN2206 macOS Code Signing In Depth (archive) | reviewed | nested code is recorded by the outer signature — inner must be signed first (inside-out rationale); no `--deep` |

## Tauri 2

| Topic | Source | Takeaways used |
|---|---|---|
| macOS code signing & notarization | v2.tauri.app/distribute/sign/macos | Tauri's automatic signing covers the app it builds — our Node/PG/prisma/supervisor Mach-Os are OUTSIDE its knowledge, so the pipeline signs nested code itself (Tauri's env-var model informs our env contract but is not sufficient alone) |
| Tauri issue #7690 / #11992 | github.com/tauri-apps/tauri | documented community+dev confirmation: "do not pass --deep"; sidecar/bundled-binary signing issues → explicit nested signing is the robust path |
| WKWebView origin (macOS) | Tauri 2 custom-scheme default | `tauri://localhost` is the webview origin on macOS → production `allowed_origins` includes it |

## Node / PostgreSQL / Prisma

| Topic | Source | Takeaways used |
|---|---|---|
| Node/V8 under Hardened Runtime | Electron builder docs + operational write-ups (electron.build mac hardenedRuntime; forasoft/artmann 2025-26 write-ups) | consistent operational evidence: V8 needs exactly `allow-jit` (not unsigned-executable-memory) under hardened runtime — treated as HYPOTHESIS ONLY until our own CI proof runs (strictest-first); the CI job decides |
| Node 22 / PostgreSQL 17.11 / Prisma 6.19.2 | existing frozen-stage contracts (pg-bundle-verify etc.) | binary set, minOS 13.0 gates, dependency rules (already execution-proven) |

## Community / Stack Overflow (operational evidence only, never overriding Apple)

* theevilbit "macOS Service Management — The SMAppService API" (2023) —
  status enum behavior, sfltool dumpbtm inspection, bundle-relative
  helper paths (consistent with Apple docs).
* scriptingosx "Notarize a Command Line Tool with notarytool" — API-key
  auth operational shape (consistent with NOTARYTOOL(1)).
* derflounder / mjtsai on Sequoia spctl deprecation — spctl no longer
  MANAGES Gatekeeper; assessment usage remains; policy toggling dead
  (informed the Gatekeeper plan; Apple's syspolicy_check is primary).
* Unity/JUCE forum threads on nested-code signing errors with `--deep`
  (consistent with TN2206 + Tauri tracker).

## Deliberately REJECTED as legacy (per directive)

* `altool` (deprecated, TN3147) — never referenced by our pipeline.
* `launchctl load/unload` as a registration path — SMAppService only;
  CI asserts no legacy registration path exists.
* `codesign --deep` recipes — explicit inside-out manifest instead.
* Old Hardened Runtime "just add disable-library-validation /
  allow-unsigned-executable-memory" advice — least-privilege policy with
  written justifications and an empirical strictest-first proof instead.

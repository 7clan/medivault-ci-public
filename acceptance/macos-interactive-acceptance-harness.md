# MediVault macOS — Interactive acceptance harness (doc)

Status: **READY** (the harness is authored and automated as far as
honestly possible; it RUNS on the doctor/clean Mac once a
Developer-ID-signed, notarized, stapled DMG exists).

Script: `macos/scripts/interactive-acceptance.sh` (run ON the Mac,
`DMG=<path> EXPECTED_ARCH=arm64|universal-check bash …`).

## Coverage map (directive §10 → harness sections)

| Directive requirement | Harness section | Automated? |
|---|---|---|
| fresh/quarantined DMG download | 0 (quarantine flag MUST be present on the DMG path — the harness fails if acquisition dropped it) + doc note: acquire via browser download or `curl` from a web URL (quarantine is applied to downloaded files) | AUTO |
| mount DMG | 2 | AUTO |
| Finder drag to Applications | 2 (layout verified; the drag itself is human) | HUMAN+AUTO |
| double-click launch | 4 | HUMAN (observes the window) |
| Gatekeeper | 1 (syspolicy_check/spctl pre-flight) + 4 (real first-launch) | AUTO+HUMAN |
| SMAppService registration | 5 (`mediavault-launchagent status` == `enabled`) | AUTO |
| Login Items approval | 4/5 (the app's Background panel drives it; approval is human) | HUMAN |
| backend starts | 5 (/health) | AUTO |
| PostgreSQL starts | 6 (pg_isready 127.0.0.1) | AUTO |
| /health, /ready | 5 | AUTO |
| create SYNTHETIC sentinel record | 6 (synthetic marker row / synthetic test patient — **no real patient data**) | HUMAN (UI) |
| close desktop → backend remains | 7 (supervisor pgrep + /health after Cmd+Q) | AUTO |
| reopen desktop → sentinel persists | 8 | AUTO+HUMAN |
| logout/login → backend returns, sentinel persists | 9 | AUTO+HUMAN |
| reboot → backend returns, sentinel persists | 10 | AUTO+HUMAN |
| replace app with newer build → sentinel persists | 11 | AUTO+HUMAN |
| uninstall app only → data remains | 12 (App Support + PG_VERSION + keychain items + no orphan supervisor) | AUTO |

## Rules baked into the harness

* **PASS/FAIL output everywhere**; exit code reflects automated failures.
* **Quarantine is NEVER removed** for acceptance. The only quarantine
  removal in the file is inside the clearly-marked DEVELOPMENT DIAGNOSTIC
  block, gated behind `MV_DEV_DIAGNOSTIC=1`, off by default, and it only
  ever touches a dev copy.
* HUMAN steps print their EXPECTED outcome — the operator confirms; the
  harness never auto-passes a human step.
* The sentinel is synthetic (`INTERACTIVE_ACCEPTANCE_<epoch>` /
  a clearly-marked test patient) — no real patient data.
* Secrets stay in the keychain: the harness never extracts keychain
  values; it proves secret usability indirectly through the running
  supervisor/API (the same discipline as the frozen CI stages).

## Environment notes

* Runs from the repo checkout (or any copy of the script) on the target
  Mac; needs only macOS + Xcode CLT (`xcrun`, `codesign`, `hdiutil`,
  `spctl`/`syspolicy_check`, `security`, `pgrep`, `curl`).
* The OFFLINE-with-stapled-ticket check and the clean/clean-machine
  no-cached-trust check belong to the Gatekeeper acceptance plan
  (separate document) — this harness covers the interactive UX flow.

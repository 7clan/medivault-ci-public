# MediVault macOS — Interactive acceptance harness (ZERO-COST revision)

Status: **READY (zero-cost form)** — runs on the doctor/clean Mac
against a zero-cost release DMG (ad-hoc signed, not notarized). Governing
contract: `acceptance/macos-zero-cost-release-contract.md`.

Script: `macos/scripts/interactive-acceptance.sh`
(run ON the Mac):

```sh
DMG=/path/MediVault-arm64.dmg \
MANIFEST=/path/MediVault-arm64.manifest.txt \
EXPECTED_ARCH=arm64 \
bash macos/scripts/interactive-acceptance.sh
```

The harness sits at the STOP-GATE required by the campaign: everything
that genuinely needs interactive macOS UI (Gatekeeper dialog, Login
Items approval, logout/login, reboot, Finder drag) is prepared here and
executed by the operator; hosted CI proves the CI-provable contracts in
the `zero-cost-release` / `smappservice-lifecycle` / `keychain-lifecycle`
modes.

## Coverage map (directive → harness sections)

| Requirement | Harness section | Automated? |
|---|---|---|
| quarantined DMG acquisition | 0 (quarantine MUST be present — fail-closed) | AUTO |
| offline pre-install verification (hashes + signatures, no network) | 1b (verify-release.sh) | AUTO |
| machine-level assessment recorded (expected: NOT trusted) | 1 (info only — never a failure) | AUTO |
| mount DMG + layout + shipped disclosure | 2 | AUTO |
| Finder drag to /Applications (quarantine-preserving) | 2 (the drag is human — cp is explicitly rejected) | HUMAN+AUTO |
| installed app ad-hoc + Hardened Runtime signature | 3 | AUTO |
| first launch: EXPECTED Gatekeeper warning | 4 (expected block — the CONTRACT) | HUMAN (observes) |
| System Settings → Privacy & Security → Open Anyway → Open | 4 | HUMAN |
| app launches after the manual approval | 4 | AUTO (process check) |
| subsequent launch works normally (no warning) | 4 | HUMAN+AUTO |
| SMAppService status model + Login Items approval | 5 (status + openSystemSettingsLoginItems + approval) | AUTO+HUMAN |
| backend starts through launchd (parent = launchd) | 5 | AUTO |
| PostgreSQL up + synthetic sentinel | 6 | AUTO+HUMAN |
| close desktop → backend remains | 7 | AUTO |
| reopen desktop | 8 | AUTO+HUMAN |
| logout/login → backend returns, supervisor RESTARTED, keychain re-read | 9 (restart marker + /health) | AUTO+HUMAN |
| reboot → backend returns, supervisor RESTARTED, keychain re-read | 10 | AUTO+HUMAN |
| controlled update: verify new DMG offline first, replace, preserve | 11 (verify-release.sh + replacement + keychain prompt note) | AUTO+HUMAN |
| uninstall = app only; Application Support + cluster + 5 keychain items preserved | 12 | AUTO |

## Rules baked into the harness

* **The Gatekeeper warning is expected**: PASS means warning observed +
  Apple's supported Open-Anyway override + subsequent normal launch
  (zero-cost Gatekeeper acceptance contract).
* **PASS/FAIL everywhere**; exit code reflects automated failures; human
  steps print EXPECTED outcomes and are operator-confirmed, never
  auto-passed.
* **Quarantine is NEVER removed** (the only quarantine-touching block is
  the disabled `MV_DEV_DIAGNOSTIC=1` development diagnostic).
* **Offline by construction**: the only sub-tool invoked is
  `verify-release.sh` (self-audited to contain no network command).
* The sentinel is synthetic (a clearly-marked test patient) — no real
  patient data.
* Secrets stay in the keychain: the harness never extracts keychain
  values; readability is proven indirectly through the running
  supervisor/API (the same discipline as the frozen CI stages). If a
  keychain authorization problem appears during the update section, the
  operator records the exact prompt/error (ad-hoc identity stability
  evidence) and does NOT weaken protections to pass.
* Supervisor restart proofs use a process marker (PID + lstart) around
  logout/login and reboot, so "supervisor restarted → keychain re-read"
  is explicit, not implied.

## Environment notes

Runs on the target Mac; needs macOS + Xcode CLT (`xcrun`, `codesign`,
`hdiutil`, `syspolicy_check`/`spctl`, `security`, `vtool`, `pgrep`,
`curl`, `python3`). `NEW_DMG`/`NEW_MANIFEST` env enables the controlled
update section; `KEYCHAIN_PROMPT_NOTE=prompted|not prompted` records the
keychain authorization behavior during replacement.

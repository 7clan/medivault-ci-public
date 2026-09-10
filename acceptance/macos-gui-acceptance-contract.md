# macOS GUI Acceptance Contract — the GitHub-runner GUI reality experiment

Status: **AUTHORED — first dispatch pending** (stage order: after the frozen
zero-cost release candidate; this is TEST INFRASTRUCTURE ONLY — it never
modifies MediVault product code).

Related frozen contracts:
- `acceptance/macos-zero-cost-release-contract.md` (the release under test)
- `acceptance/macos-gatekeeper-acceptance-plan.md` (the Open Anyway PASS
  criteria this experiment partially automates)
- `acceptance/macos-26-smoke-contract.md` (runner labels proven available)

## 1. The one question

Does a GitHub-hosted **macos-26** (arm64) / **macos-26-intel** (x86_64)
runner have a **usable GUI session** — and how far down the REAL zero-cost
install path can **genuine** automation go?

This is an *experiment*, not a pass/fail acceptance gate: every capability
is recorded GREEN / RED / NOT PROVEN / NOT RUN / OBSERVED / BLOCKED, and the
run is green iff the experiment executed honestly.

## 2. Frozen release under test (never rebuilt)

`v0.1.0-zero-cost-rc1` on `7clan/medivault-ci-public` (run 34255257006):

| arch | asset | SHA-256 | size |
|---|---|---|---|
| arm64 | `MediVault-arm64.dmg` | `7059c3725b256be8860622e89e28e3d76cce3388ec7aec4953637f8eefc29b34` | 203,766,525 |
| x86_64 | `MediVault-x86_64.dmg` | `1eb5a2452922d3f587227623cfa0a176443ebcbb178fc18da5164b2923b22f35` | 218,227,556 |

The workflow pins these digests; the script fail-closes if the downloaded
bytes do not match, and the full offline `verify-release.sh` (every shipped
file byte-verified) must be GREEN before any install-path step runs.

## 3. Experiment phases (capability-gated)

| Phase | Proves | Honest stop when |
|---|---|---|
| A | `sw_vers`, `uname -m` (native, no Rosetta), console user, WindowServer, GUI domain, real screen change after opening Finder/System Settings (hash-diff + CGWindowList probe + native screenshots 01–03) | GUI_SESSION = NOT AVAILABLE → summary, exit |
| B | real Safari download of the frozen release; **natural** `com.apple.quarantine` (observed only, never written) | Safari unusable → curl fallback, explicitly labeled NOT a browser download |
| C | pinned SHA-256 + full offline `verify-release.sh` | hash mismatch (D) → refuse to continue |
| D | DMG opened by Finder: real mount + DMG window (screenshots 06–07) + drag-layout assert | volume never appears |
| E | placement ladder, each rung labeled: System Events GUI automation → Finder duplicate to `/Applications` (admin-password dialog is genuine evidence) → Finder duplicate to `~/Applications` (canonical per-user) → harness `cp -R` (explicitly NOT a Finder proof) | app not placeable → launch phase skipped |
| F | first `open`: Gatekeeper observation (spctl read-only probe, screenshots 09–11), Privacy & Security pane, **Open Anyway** detection + approval **only via legitimate GUI automation** | assistive access denied → OPEN_ANYWAY = BLOCKED_BY_OS_AUTOMATION_POLICY (never bypassed) |
| H | (only if the app actually runs) MediVault window, /health + /ready, loopback-only 3001/55432 proofs, bundled pg_isready, SMAppService launchd job, Login Items pane, synthetic patient `Test Patient` / `GUI-CI-ACCEPTANCE` via the product's own API (first-admin setup → CSRF cookie flow), quit/reopen persistence, screenshots 13–17 | app not running → all stay NOT RUN |

## 4. Non-negotiable honesty rules

1. Every screenshot is native `screencapture` output taken AFTER the real
   action; a missing capability produces NO screenshot, never a mock.
2. Gatekeeper is never disabled or weakened (no `spctl --master-disable`,
   no policy changes, no fake certs; `spctl -a` read-only probes allowed).
3. Quarantine is never manufactured or removed (`xattr -p` only; no
   `xattr -w` / `xattr -d` anywhere in the harness).
4. TCC is never touched (no `tccutil`, no TCC.db writes, no pre-grants);
   macOS blocking automation IS the finding (class C).
5. No command-line copy is ever reported as a Finder/drag proof — the
   capability stays NOT PROVEN with the exact placement method recorded.
6. Logout/login and reboot are NEVER claimed: a GitHub job cannot survive
   them, so both remain NOT PROVEN by construction.
7. Keychain security is never weakened; values are never extracted.
8. Synthetic data only: the sole created patient is
   `Test Patient` / `GUI-CI-ACCEPTANCE` with a synthetic CI identity.

## 5. Failure-class discipline (first-red)

| Class | Meaning | Permitted response |
|---|---|---|
| A | MediVault product bug | product change (the ONLY class that permits it) |
| B | GitHub runner limitation | record honestly; no product change |
| C | macOS TCC/automation limitation | record the exact error; never bypass |
| D | GUI-harness bug | minimal `gui-acceptance-ci` fix, re-dispatch (only class that fails the run) |
| E | expected zero-cost Gatekeeper behavior | record as the documented contract |

## 6. Evidence

- Artifact `gui-evidence-<arch>` (7-day retention): native screenshots in
  the suggested sequence (`01-desktop` … `17-relaunch` — only genuinely
  occurring screens), `capability-report.md`, `probes.log`, osascript
  error captures, swift CGWindowList probe output.
- The post-run flow (outside CI): download the artifacts, build the
  temporary screenshot evidence gallery at
  `/tmp/medivault-gui-evidence/`, serve it locally for human inspection.
- Missing images remain NOT PROVEN; the report never infers an image from
  a log line.

## 7. Explicitly NOT proven by this workflow (by design)

- A literal mouse drag (System Events cannot script drags; recorded NOT
  PROVEN even when a GUI keyboard copy or Finder duplicate succeeds).
- Logout/login, reboot (job cannot survive them).
- Keychain prompt interaction (requires an interactive user).
- Real Gatekeeper *approval* unless automation is genuinely permitted.
- Any translocation behavior on a clean end-user machine.
- The DMG built here is never re-built: the frozen release is downloaded
  and hash-gated exactly as shipped.

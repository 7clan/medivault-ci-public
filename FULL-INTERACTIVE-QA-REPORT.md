# MediVault — FULL INTERACTIVE QA REPORT

The campaign-level report of the FULL interactive exploratory QA
(professional QA + clinic-user perspectives; synthetic data only) on the
frozen GREEN baseline.

- **Baseline**: private `f6dc341d6821760009266d4d29447de630eb452a`
  (`platform/macos`); public snapshot `0b0d9364ccc1f0b9eed2ada2c6114d2e7c3d8572`;
  ARM64 GREEN run `34796558466`.
- **Wave 1 focuses**: `surface` → `account` → `patients` → `search` →
  `settings` → `persistence` (one focus dispatched per run; surface first).
- **Discipline**: P0 stop / P1-P2 stop-at-first-red then the full fix
  workflow (prove → root-cause → minimal fix → regression test → targeted
  rerun → resume) / P3 record / D harness-fix-and-rerun / ENV & EXPECTED
  record only. No soft-red.
- **Harness**: `macos/scripts/exploratory-qa.sh` — the frozen lane's
  battle-tested interaction stack verbatim-extracted (Vision OCR + CGEvent
  clicks, Unicode/Arabic typing, space-insensitive matching, icon-only
  control scanning, bounded scrolls, dialog-close verification) plus the
  exploratory focus framework. Static validation: bash -n GREEN, bash 3.2
  compatible, function definitions before use (see the historical D entry in
  `BUG-REGISTER.md` for why that check exists).

## Historical note (carried into every report)

A **D — historical frozen-lane harness gap** is recorded in `BUG-REGISTER.md`
(BUG-H1): the old `20-search-jane` phase never executed because `search_type`
was defined after its call site; the phase's GREEN was coincidental (the
unfiltered list still showed the row). This is NOT a product bug, the frozen
lane is not edited, and later persistence search phases genuinely exercised
search.

## Focus runs

| Focus | Run ID | Outcome | Bugs found | Evidence |
|---|---|---|---|---|
| surface | 34864029026 | GREEN (EXPLORATORY-QA-GREEN-surface) | P0=0 P1=0 P2=0 P3=0; D=3 (theme-toggle off-screen at click time, display-name visual verify — deferred to the settings focus with better strategies) | run artifact `qa-evidence-arm64-focus-surface` (113 screenshots; SURFACE-MAP.md 59 rows / 18 sections; capability report all GREEN) |
| account | 34873498636 (run 1) + the D-fix rerun | run 1: GREEN (EXPLORATORY-QA-GREEN-account) — the FULL auth lifecycle GREEN (creation, logout, protected-UI, wrong password, wrong email, login, identity consistency incl. both /api/auth/me regression surfaces, leak check, 2 cycles, quit/reopen session restore, settings name/email display); D=5 (the setup-validation battery never submitted — submit_focused_return defined after its caller; fixed) + P3=1 (reclassified D: the A9 entry-click needle was OCR-dropped, no click attempted) → harness fixed + invocation-order-aware checker added → targeted rerun | run-1 artifact `qa-evidence-arm64-focus-account` (122 screenshots; 27 capability rows; BUG-REGISTER with 6 honest records) |
| patients | — | — | — | — |
| search | — | — | — | — |
| settings | — | — | — | — |
| persistence | — | — | — | — |

## Account focus — planned battery (pre-dispatch record)

The account focus (`exploratory-qa` focus=account, ARM64) exercises the
real account/auth lifecycle through the visible GUI with synthetic
credentials only (the password is generated locally and never printed;
masked fields are typed via the real keyboard path).

**Setup-form validation suite (before the one-time form is consumed):**

- SU1 empty-field submission (client-gated; either the 6-char gate text or
  a server 400 is an honest visible rejection)
- SU2 weak password (`Ab1!` → the visible rejection)
- SU3 confirmation mismatch (the visible mismatch rejection)
- SU4 password requirement boundary — a checklist-COMPLIANT 8-char
  all-class password (the on-screen checklist says 8+, the client gate is
  6, the server policy is 10): the real GUI decides which is enforced; the
  observed outcome is recorded (expected: visible server rejection → P3
  checklist/policy mismatch record)
- SU5 malformed email — a structurally invalid address (no @) with an
  otherwise valid form: the source-level suspect (no email-format
  validation on the path) is reproduced through the real GUI; acceptance
  consumes the form (the account is created with it — P3) and the run
  continues with the adapted synthetic address; rejection records GREEN

Rate-budget design (both source-verified): the server keeps an in-memory
setup limiter at 3 POSTs/hour and a per-email login limiter at 5 attempts
per 15 min (5 failed attempts lock for 15 min). The suite spends at most
2 setup POSTs (SU4+SU5; GATEWAY 6 runs no third submit when SU5 accepts),
leaving the 3rd for the duplicate-setup probe; the login flow spends at
most 4 of 5 attempts on the real synthetic email (the wrong-email probe
uses a nonexistent address — its own limiter key, no lock impact).

**Auth lifecycle through the real GUI:**

- A2 logout (profile menu → Sign Out) + A2b protected-UI check after
  logout (login screen only; no dashboard content; labeled no-credential
  `/api/auth/me` 401 probe with its honest limitation — the webview's own
  cookie is not externally readable from the harness)
- A3 wrong password → visible rejection; A3w wrong (nonexistent) email +
  correct password → the same generic rejection (no user enumeration)
- A4 correct re-login (both fields restored — the probes leave non-current
  values behind)
- A5/A5b identity consistency after login — dashboard name + the profile
  dropdown (name + `Clinic Doctor`): the `/api/auth/me` nested-response
  regression surfaces (the PFT-34701835070 fix: a flat parse fell back to
  the email prefix)
- A6 logout state-leakage probe (the search query seeded before logout)
- A6b repeated logout/login cycle (2 full cycles)
- A7 quit/reopen (supervisor health + relaunch + whichever session state
  the webview held — restored or sign-in-required, recorded honestly)
- A7b identity consistency after quit/reopen (dashboard + profile menu)
- A8 account name/email display consistency — Settings → Doctor Profile
  (the one place the email is displayed)
- A9 duplicate account/setup behavior — the Sign In screen's `Set Up Your
  Account` entry with an account already existing (client-side entry is
  unguarded per source; the server's SetupAlreadyCompleted 409 is the
  protection — probed within the setup POST budget)

The final section of every run re-verifies the loopback-only binds
(API 127.0.0.1:3001, PostgreSQL 127.0.0.1:55432 — no 0.0.0.0/::/LAN),
the crash-report watch, and the teardown.

## Cumulative campaign status

(to be updated after each focus: capability fields, screenshot totals,
bug-register deltas, surface-map completeness, next-focus safety verdict)

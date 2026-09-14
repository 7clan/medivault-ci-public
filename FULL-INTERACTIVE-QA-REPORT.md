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
| account | 34873498636 → 34877260555 → 34880579779 → **34885186221 (definitive)** | **GREEN (EXPLORATORY-QA-GREEN-account)** — ALL 31 capability rows GREEN: empty fields (native required validation), weak password (the app's 6-char gate), confirmation mismatch, the password boundary (the server's 10-char policy), malformed email (the native type=email layer), account creation, logout, protected-UI-after-logout, wrong password, wrong email (no enumeration), login, identity consistency (post-login /api/auth/me), profile/menu identity, no stale state, 2 full logout/login cycles, quit/reopen + session restore (path: restored), identity after reopen (the /me session-restore surface), settings name/email display, duplicate setup rejected (the 409), auth enforcement (401), security regression (loopback only), stability, completion. **P0=0 P1=0 P2=0 P3=1 D=0 ENV=0** | run artifact `qa-evidence-arm64-focus-account` (142 screenshots; 28 surface rows; BUG-REGISTER with the single P3). The 3 earlier runs were the first-red discipline at work: D=5 (submit_focused_return defined after its caller) → D (the error-block fold geometry + the native-validation interplay) → D=2 (the error-block OCR position garble + the scroll-position-dependent form-alive check + the A9 bottom-card reveal) — each root-caused, fixed, regression-tested, and rerun; the campaign master register records the P3 |
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

## Patients focus — planned battery (pre-dispatch record)

The patients focus (`exploratory-qa` focus=patients, ARM64, directive
2026-09-15) exercises the patient lifecycle far deeper than the baseline
through the visible GUI with synthetic data only. Every patient carries a
UNIQUE sentinel note (`ONLY-JOHN-ALPHA`, `ONLY-JANE-BRAVO`,
`ONLY-MOHAMMAD-CHARLIE`, `ONLY-ELODIE-DELTA`, `ONLY-OCONNOR-ECHO`,
`ONLY-LONGNAME-FOXTROT`, `ONLY-ZED-DELETE`, plus three similar-name
sentinels) — any foreign sentinel visible on a patient's detail is a P0
cross-patient data leak (immediate stop). Unique phone DIGIT TOKENS
(0101/0202/0304/0105/0106/1101/1102/1103/0199) make row targeting
OCR-robust for the Arabic/accented/long-name patients (the search matches
phone `contains`; digits type and OCR reliably).

**Cohort (all synthetic, per the directive):** John Test (full data),
Jane Test (optional fields ALL empty), محمد تجريبي (Arabic + international
phone), Élodie Müller (accented Latin + accented address), O'Connor Test
(apostrophe + dotted phone), Very Long Synthetic Patient Name For MediVault
Testing (long values + the DOB digit-entry attempt), the similar-name trio
John Tester / john test / John-Test-Hyphen (distinct sentinels — no merge,
each opens its own record), and Zed Delete (the delete-battery target).

**Create battery (PC):** cancel-create (count unchanged), empty-names
submit (native required rejection, both the double-empty and the
last-name-only forms), valid full-data create, optional-empty create,
Arabic create, accented create, apostrophe create, long-values create,
duplicate/similar-name trio (count 9, per-record sentinel verification),
and the rapid double-submit create (exactly ONE Zed — count 10).

**Visit scheduling enabler (PS):** a visit for John scheduled through the
real dialog (patient select → today's default date → the anchored footer
submit) — this enables the Today/Overview, Upcoming-Visits, and Calendar
entry points. Scheduled while John is the only patient (the dropdown then
holds exactly one item — no scroll ambiguity).

**Isolation (PI):** a full scroll-scan of every cohort patient's detail —
own sentinel present, ALL 8 foreign sentinels absent (P0 on any leak).

**Edit battery (PE, before the entry-point proofs so the stale-snapshot
regression is armed — John's recentlyViewed cache holds his PRE-EDIT phone
from the isolation scans):** cancel-edit (typed value absent), multi-field
edit (John's phone + note — the edit that arms the regression),
single-field edit (Élodie's phone), consecutive edits (O'Connor ×2),
Unicode edit (Élodie's accented address), clear-optional-field (Élodie's
phone → NULL; the skeleton empty-state must NOT appear), Arabic edit
(Muhammad's mixed note), and the untouched-patient check (Zed's exact data
after the whole battery).

**Entry-point consistency (PV — the P2 5ede518 stale/skeleton regression:
every entry point must render the AUTHORITATIVE record, John's EDITED
phone):** (1) the Recent-Patients list row, (2) the search-result row
(searched by the EDITED phone token — also proves the search index reflects
edits), (3) the Recently Viewed mini-card (a STALE pre-edit cached object —
the refetch must win), (4) the Activity Timeline entry (a NAME-ONLY
skeleton object), (5) the Cmd+P Quick Patient Switcher, (6) the Today's
Overview `Next:` chip (name-only skeleton), (7) the Upcoming Visits card
(partial object), (8) the Calendar week-view visit chip (partial object).
Probes 6-8 are honest NOT-EXERCISED records if the visit scheduling hits a
harness limit (per the directive's "if present" allowance).

**Delete battery (PDEL):** cancel-delete (Zed kept), confirm-delete (the
record gone, the search finds nothing, the count back to 9, the app returns
to the dashboard), the post-delete Recently-Viewed ghost entry (the stale
localStorage chip for the deleted patient — P3 if it renders cached data),
and no resurrection after the restart.

**Human-mistake navigation (PNAV):** open → immediate switch, edit →
navigate away (the abandoned edit must not save), rapid switching ×3
(each sentinel verified), search → open → clear → reopen, and logout
WHILE ON a patient detail → no patient data logged-out → re-login → the
same record intact (login budget: ≤3 of 5 in a fresh run).

**Patient-level persistence (PP):** quit → supervisor/API/PostgreSQL
health → relaunch (either session path, recorded honestly) → count 9,
John's edited values + sentinel, Muhammad's Arabic-mixed note, isolation
intact, and Zed still gone. The dedicated persistence focus still comes
later.

The final section of the run re-verifies the loopback-only binds, the
crash-report watch, and the teardown.

## Cumulative campaign status

(to be updated after each focus: capability fields, screenshot totals,
bug-register deltas, surface-map completeness, next-focus safety verdict)

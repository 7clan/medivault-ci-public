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

---

## Patients focus — RUN 1 (34901913438 @ 8111001, 2026-09-14 22:00–22:21)

**Outcome: P1-RED — honest first-red stop at PC1 (after 31 screenshots).**

The build job GREEN (the DMG hash-verified from this run's commit); the GUI
job GREEN through preflight → install → launch → registration → handoff →
account creation → dashboard, then the patients battery started:

- **PC0** — the cancel-create probe could not open the dialog: a **D**
  (the count-read helper had scrolled the dashboard header's Add Patient
  button out of the OCR view — BUG-PD1, evidence bug-01 + the OCR context).
- **PC1** — the empty-names submit: the harness reported **P1**
  PATIENTS_REQUIRED_FIELDS "the empty-names submit CREATED a patient". The
  run's own evidence PROVES this a harness misclassification (**D**): the
  three post-submit captures show the dialog STILL OPEN, the native
  "Fill out this field" bubble visible, the typed note intact, and the
  count badge still 0 — the native required validation FIRED and blocked
  the submit exactly as designed; the dialog-closed verdict had anchored on
  the OCR-garbled dialog title ('Dochhnord'/'Nachhnord' after the submit
  fallback's scroll bursts) — BUG-P1→D with the full proof chain.
- The run stopped at the P1 per the discipline (exit code 3); the artifact
  (10371696057, 35 files: 31 screenshots + probes.log + BUG-REGISTER +
  capability report + surface map) preserved and mirrored locally.

**Disposition per first-red discipline:** the initial P1 was DISPROVEN by
the evidence (no patient was created — the count never moved; the rejection
bubble is in the screenshots) → reclassified D; the two D root causes are
fixed in the harness (multi-needle dialog-presence checks
`add_patient_dialog_visible`/`edit_patient_dialog_visible`, verified closes
`ensure_dialog_closed`, the PC0 scroll fix, the count-badge O→0
normalization, and the PC1 rc=0 count corroboration); full static
validation re-run GREEN (bash -n, bash-3.2, def-before-use v2 at 64
functions / 1946 call sites, 164 surface_row sites all 8 args, frozen
lanes byte-identical, secret/PHI scans clean); targeted ARM64 rerun
dispatched on the synced mirror.

**Honest capability state from run 1** (before the stop): FRESH_STATE yes,
DMG_HASH GREEN, INSTALL GREEN, window/first-run/registration/SMAppService/
API/PostgreSQL/handoff/account-creation ALL GREEN — the identical
foundation the surface and account focuses proved; the patients-specific
probes begin at PC0.

---

## Patients focus — RUN 2 (34904733614 @ 37b0369, 2026-09-14 22:33–22:57)

**Outcome: P1-RED at PC1b — which PROVED to be a real P2 product defect
(the dialog state leak), not the reported validation failure.**

The D-fix from run 1 held perfectly: PC0 GREEN (the scroll fix opened the
dialog; the cancel closed it verified; the count badge read 0 — the O→0
normalization working), and PC1 GREEN (the multi-needle verdict caught the
still-open dialog, `pc1-empty-dialog-still-open.png` + `pc1-rejected.png`
with the native bubble — the run-1 false-P1 mechanism eliminated).

PC1b (the last-name-only probe) then reported P1 "the first-name-empty
submit CREATED a patient". The prove step (VLM reads of the run's own
screenshots + the source) established what actually happened:

1. The Patients stat card read **0** before PC1b and **1** after — a record
   WAS created (the harness verdict was factually correct).
2. `pc1b-lastonly-form-filled.png` shows the form's First Name containing
   **'Scratch Pad'** — the data typed into PC0's CANCELED create — plus the
   note leaked from PC1's rejected submit: **the AddPatientDialog never
   resets its fields on close** (handleClose clears only the error state;
   the reset exists solely on the success path).
3. So the 'last-name-only' submit actually carried BOTH names ('Scratch
   Pad' + 'Probe'), passed the native validation and the route's
   first+last requirement legitimately, and created an unintended record.
   The required-field validation itself works correctly (PC1 proved it
   fires on a genuinely-empty form).

**Disposition (P1/P2 first-red discipline):** reclassified P2
(DIALOG_STATE_LEAK — a substantive data-integrity defect); the minimal
product fix applied (add-patient-dialog resets its 7 fields + error on
open via useEffect — the edit dialog's own established idiom; the edit
dialog itself is not affected); the regression probe added to the battery
(PC0 now reopens the dialog after the cancel and asserts the canceled
'Scratch Pad' is absent — P2 fires if the leak recurs); full static
validation re-run; targeted ARM64 rerun dispatched.

Run-2 evidence preserved: artifact 10372732041 (47 files — 43 screenshots
incl. the full PC0/PC1/PC1b chains, probes.log, registers) + the GUI job
log + the VLM proof reads recorded in BUG-REGISTER.md.

---

## Patients focus — RUN 3 (34907338207 @ be9e76c, 2026-09-14 23:07–23:43)

**Outcome: P1-RED at PC5 — a REAL product defect (the missing session
refresh), plus the first honest D on the visit-scheduler select.**

The run-1 and run-2 fixes ALL held: PC0 GREEN (cancel + count 0 + the
**dialog-state-leak regression probe GREEN** — the reopened dialog clean,
`pc0-reopen-after.png`, the P2 fix proven in the real GUI), PC1 GREEN
(empty-names rejection + the bubble), PC1b GREEN (last-name-only rejection
— with the clean dialog the probe now genuinely exercises the empty first
name), PC2 GREEN (John Test created with the ONLY-JOHN-ALPHA sentinel),
PS: honest D (the shadcn-select patient dropdown could not be automated —
"the dialog-footer 'Schedule Visit' could not be anchored" — the PV6/7/8
entry-point probes will record NOT-EXERCISED; the known limitation,
recorded not hidden), PC3 GREEN (Jane, optional-empty), PC4 GREEN
(Muhammad, the Arabic create).

PC5 (Élodie Müller — accented Latin): the form filled correctly (VLM read:
Élodie/Müller + all fields + the ONLY-ELODIE-DELTA sentinel note), the
submit clicked — and the dialog showed **"Authentication required"**: the
POST returned 401. Root cause: the access token lives 15 minutes, the
refresh cookie + endpoint exist, and the web frontend never calls the
refresh — after ~15 min of continuous use every authenticated request
fails (PC2-PC4 were inside the window; PC5 at ~24 min was outside). The
surface/account focuses never wrote past 15 min, which is why this is the
patients focus's find — precisely the deep-lifecycle discovery the
directive asked for.

**Disposition (P1 first-red discipline):** proven (the error box + the
source + the timeline); the minimal product fix applied at the single
point every API request flows through — the global fetch adapter
(src/lib/fetch-csrf.ts) now performs one single-flight /api/auth/refresh
on a 401 and retries the original request with the rotated CSRF pair
(auth endpoints + Bearer transport exempt; failed refresh = the original
401). Regression test: the battery itself (PC5+ run >15 min into the
session). Targeted ARM64 rerun dispatched.

Run-3 evidence preserved: artifact 10373009495 (119 files — 115
screenshots through PC5, probes.log, registers) + the GUI job log + the
VLM proof reads in BUG-REGISTER.md.

## Patients focus — RUN 10 (34930796719 @ 6d87fd4, 2026-09-15 04:57–06:03)

The deepest patients walk yet: the GUI job ran 05:14:35–06:03 (49 min) and
progressed past every prior stop — PC0–PC7 GREEN, **PC8 3/3 similar-name
creates GREEN (the run-9 scroll-restore fix held — pc8a opened on the
first attempt; badge 6→7→8→9)**, **PC10 double-submit GREEN (9→10 —
exactly ONE Zed Delete created from the double click; the run-9
preemptive scroll-restore held)**, then the first-ever entry into PI —
where the run stopped at a P0 that the prove step reclassified as a
FALSE positive (harness D-class, no product defect). Full chain in
BUG-REGISTER.md (BUG-P0→D + BUG-PD3).

Run-10 headlines:
- **PC8 (similar names)**: John Tester / john test (lowercase) /
  John Test-Hyphen all created as SEPARATE records (count 9, no merge);
  the per-phone isolation sub-checks recorded honest bug-D "own note not
  OCR-verified" — forensics then proved those sub-checks never opened a
  detail at all (BUG-PD3: the row click hit the search query line; zero
  detail GETs in the API log). Fixed for the rerun.
- **PC10 (double-submit)**: the form (Zed Delete, +1 555 0199) submitted
  twice rapidly → one record; count badge 10; surface[22] GREEN.
- **PI (sentinel isolation)**: the John probe's "John Test" needle
  prefix-matched the "John Test-Hyphen" row → the WRONG (but entirely
  self-consistent) detail opened → the hyphen patient's OWN note
  (ONLY-HYPHEN-INDIA) read as "foreign" → the false P0. The API log +
  the pc8c create-dialog VLM read prove name/phone/note all belonged to
  the opened record. **The product's isolation is intact; the harness
  row-targeting was not.**
- **Session refresh still holding**: the 05:49:15 create shows
  401 → refresh → 201 (the transparent retry, ~32 min into the session —
  the run-3/5/6 fix chain proven again).
- **ENV unchanged**: DOB date-field automation remains the recorded ENV
  limit (bug-ENV entry at 05:43:01); PC7's long-values create stays GREEN
  without it.

Fixes shipped for the rerun (harness-only, zero product code):
`open_patient_detail` gains the row-needle (all 6 John opens
disambiguated by their unique phone line), `open_patient_by_phone_token`
scrolls to the row phone before clicking and gates success on the new
`detail_open_proof` (search-bar-absent + detail-section-marker). Static
validation all GREEN (bash -n, no bash-4 constructs, def-before-use
68 fns/2379 sites, surface_row 165×8, frozen lanes untouched, secret/PHI
clean). Targeted ARM64 rerun dispatched — continuing from PI (the exact
stopping point), then PE → PV×8 → PDEL → PNAV → PP.

Run-10 evidence preserved: artifact 10382368515 (249 files, 84MB) at
/tmp/qa-patients-run10/ + the GUI job log (1190 lines).

## Patients focus — RUN 11 (34936649898 @ 4a19c7e, 2026-09-15 06:22–07:11)

The run-10 fixes PROVEN working, one layer deeper: PC0–PC7 GREEN, PC8 3/3
creates GREEN (badge 9), then the pc8-1101 sub-check (John Tester) — the
first correctly-exercised cohort isolation scan of the campaign (scrolled
to the row phone, clicked the ROW, `detail_open_proof` confirmed the real
detail opened: "the list search bar is absent and a detail section marker
is visible") — the detail showed John Tester's own name+phone+email+note,
all self-consistent… and the run still stopped at a P0: the FOREIGN_ALL
list contains the scanned patient's own sentinel (ONLY-TESTER-GOLF), so
his own note read as "foreign". **Reclassified D (FALSE) — the second
onion layer of the same isolation-check defect; no product bug** (full
chain in BUG-REGISTER: FOREIGN_LIST_NOT_RELATIVE).

The structural audit that followed: FOREIGN_ALL contains the sentinels of
EVERY patient the battery scans with it (Jane/Muhammad/Élodie/
O'Connor/LongName/Zed/the PC8 trio — everyone except John Test himself).
Runs 1–10 never reached those scans with a working open, so the two
defect layers (row targeting, then list relativization) were exposed one
per run. Fix applied at the single point both scan functions share (the
own note is stripped from the foreign list by construction — +21 lines,
zero product code; functional-tested: GOLF→8 foreign, ALPHA→no-op 9,
ZED-DELETE→8, empty→unchanged).

Run-11 evidence preserved: artifact 10384822943 (201 files) +
the GUI job log. Targeted ARM64 rerun dispatched — continuing from the
exact stopping point (the pc8 sub-checks → PI → PE → PV×8 → PDEL → PNAV
→ PP).

## Patients focus — RUN 12 (34985384528 @ c08fb31, 2026-09-15 14:59–16:24)

The deepest walk of the campaign (~85 min): PC0–PC7 GREEN, PC8 3/3
creates GREEN (badge 9), **all three pc8 isolation sub-checks GREEN for
the first time** (own=yes foreign=no for John Tester, john test, and
John Test-Hyphen — the run-11 fixes proven: row-phone targeting +
detail_open_proof + the RELATIVIZED foreign list), then PI: **Jane,
Muhammad, Élodie, O'Connor, and the long-name patient ALL GREEN (own=yes
foreign=no)** — five real isolation scans. John's PI open recorded an
honest D (BUG-PD4: his row sits below the 8-row Recent Patients panel
cap — the API sorts by updatedAt and takes 8; John is the oldest
never-updated record). PE1/PE2 hit the same cap (D). PE3 (Élodie) and
PE4 (O'Connor) opened correctly via the phone-token search — but the
edit pencil could not anchor (BUG-PD5: the search-row click opens the
detail SCROLLED PAST the banner; the anchor subline is off-screen) —
pe4's round failure escalated to the run's stop P1 (reclassified D — the
BUG-PD5 escalation; no product edit was ever attempted).

Net: the product's data isolation is now proven across SIX real detail
scans (5 PI + 3 pc8 sub-checks) — zero foreign sentinels anywhere. The
PS shadcn-select D and the DOB ENV limit re-recorded unchanged.

Fixes shipped for the rerun (harness-only, +30/−5): the pre-edit John
opens (PI/PE1/PE2) via the proven phone-token search path; the pencil
top-restore before the anchor lookup. Static validation all GREEN
(bash -n, no bash-4 constructs, def-before-use 68 fns/196 top-level
calls, surface_row 165×8, frozen lanes, secret/PHI clean).

Run-12 evidence preserved: artifact 10406119085 (302 files) + the GUI
job log. Targeted ARM64 rerun dispatched — continuing from the exact
stopping point (PE4's consecutive edits → PE5-PE7 → PV×8 → PDEL →
PNAV → PP).

## Patients focus — RUN 13 (35017083195 @ e391b85, 2026-09-15 20:01–21:27)

The deepest and cleanest walk yet (~86 min): PC0–PC7 GREEN, PC8 3/3
GREEN, the pc8 isolation sub-checks GREEN, and — for the first time —
**ALL NINE isolation scans GREEN**: John Test (via the fixed token
open), Jane, Muhammad, Élodie, O'Connor, the long-name patient, and the
three similar-name cohort patients — own sentinel present, ZERO foreign
sentinels across every full-detail scan. The product's patient data
isolation stands proven across the entire cohort.

PE1/PE2 opened John correctly (the run-12 token-search fix proven), the
pencil opened the Edit Patient dialog — and then the run stopped at
PE2's P1 ("saving John's edit produced no visible change"). The prove
step found the harness defect: the label lookup for the dialog's Phone
field picked the DETAIL BANNER's 'Phone' label at the left edge (the
edit dialog renders over the detail page); the label click landed on
the dialog OVERLAY and the modal dismissed itself before a single
keystroke — Notes/Cancel/Save then all "not found" → the P1. PE1's
recorded "Cancel edit — GREEN" was vacuous (the same dismissal —
nothing was ever typed) and must be re-earned by the rerun. No product
defect: no edit was ever attempted, let alone lost.

Fix shipped (harness-only, +47/−16): the optional xmin label filter on
v_type_into/v_clear_field — all 13 edit-battery typing sites restrict
the label search to the dialog card's x-range (250). Static validation
all GREEN (bash -n, no bash-4 constructs, def-before-use 68 fns,
surface_row 165×8, frozen lanes, secret/PHI clean).

Run-13 evidence preserved: artifact 10419362290 (311 files). Targeted
ARM64 rerun dispatched — continuing from the exact stopping point
(PE2's edit → PE3–PE7 → PV×8 → PDEL → PNAV → PP → the final report).

## Patients focus — RUN 14 (35026560477 @ 6f1b6b6, 2026-09-15 21:36–23:00)

The arming edit is DONE: PC0–PC10 GREEN, all NINE isolation scans GREEN
again (stable), **PE1 Cancel-edit GREEN — earned this time** (the xmin
filter targeted the dialog's Phone field (312,461); the typed 999
verified visible; the Escape-cancel closed the dialog; the value did
not persist), and **PE2 Multi-field edit GREEN** — the edit that arms
the stale-snapshot regression: John's phone → +1 555 0777, note → v2,
the old phone gone.

The run then stopped at the NEXT harness layer: pe3 (Élodie) and pe4
(O'Connor) pencil activations failed — their calls anchor on the CONTACT
SUBLINE (their names OCR unreliably: É, ', Arabic), and the icon band
was derived from the anchor's own y (≈370) with a stale −38 adjustment:
the real icon row sits at the NAME's band (y≈164..199), ~171pt above the
phone line — the scan found the CALL/EMAIL action icons at the wrong
band and every fallback missed. pe4's round failure escalated to the
stopping P1 (reclassified D — BUG-PD7; no product edit was attempted).

Fix shipped (harness-only, +27/−3): the pencil band (and fallback y)
now derives from the TOPMOST banner content row (the name/avatar line)
— independent of the anchor's position; the anchor still gates the
right patient. Static validation all GREEN (bash -n, no bash-4
constructs, def-before-use 68 fns, surface_row 165×8, frozen lanes,
secret/PHI clean).

Run-14 evidence preserved: artifact (330 files). Targeted ARM64 rerun
dispatched — continuing from the exact stopping point (pe3-pe7 edits →
PV×8 → PDEL → PNAV → PP → the final report).

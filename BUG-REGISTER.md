# MediVault — BUG REGISTER

Per-run findings of the FULL interactive exploratory QA campaign. Classes:
**P0** (patient-data isolation/corruption or severe security — immediate stop),
**P1** (core workflow unusable), **P2** (substantive functional defect),
**P3** (cosmetic/UX), **D** (harness bug), **ENV** (environment limitation),
**EXPECTED** (documented behavior, not a bug).

Discipline (no soft-red): P0 → the run stops immediately; P1/P2 → the run
stops at the first red, then prove → root-cause → minimal fix → regression
test → targeted rerun → resume the focus; P3/D/ENV/EXPECTED → recorded, run
continues (D additionally means the harness gets fixed and rerun).

Live findings are appended by the harness into the per-run artifact
`gui-evidence/BUG-REGISTER.md`. This file is the campaign master register.

---

## Historical (pre-campaign) entries

### BUG-H1

- **Class**: D — historical frozen-lane harness gap
- **Area**: frozen `product-functional-test.sh` search phase
- **Detail**: the old `20-search-jane` phase did not execute because the
  helper (`search_type`) was defined after the call (call at line 1911,
  definition at line 1960). The phase's verification then passed
  coincidentally — the search was never typed, so the *unfiltered* list still
  showed Patient B's row and the check went GREEN without the search ever
  running. The `21-search-c` call (line 1926) hit the same ordering gap but
  failed honestly into its `else` branch ("Arabic search typing failed
  (kept)"). Later persistence search phases (`27-search-c-detail`,
  `31/32/33-persist-*`, all after the definition) genuinely exercised search.
- **IMPORTANT**: this is NOT a MediVault product bug. The frozen baseline
  lane is NOT edited for this (read-only inspection only). The reconstructed
  exploratory harness validated function-order statically (definitions before
  use; bash 3.2 top-to-bottom execution) precisely to prevent this class.
- **Disposition**: recorded only. No action on the frozen lane.

---

## Campaign findings

(filled per focus run — the harness appends numbered BUG-N entries with
evidence screenshots, OCR context, and classification per the discipline
above)

---

## Campaign findings

### BUG-A1 [P3] PASSWORD_POLICY_MISMATCH (account focus, run 34885186221)

- **Class**: P3 — record and continue
- **Area**: account setup — password policy communication
- **Detail**: the setup form's on-screen password checklist advertises
  "8+ characters" and its client-side submit gate is 6, but the server
  enforces a 10-character minimum (plus the four character classes) — a
  password that satisfies EVERY on-screen checklist row (8 chars, upper +
  lower + digit + special) is visibly rejected with
  "Password must be at least 10 characters long" and no checklist row
  explains it.
- **Reproduction (real GUI)**: fill the one-time setup form with a valid
  name, a valid email, and the checklist-compliant 8-char all-class
  password in both masked fields → submit → the server rejection renders
  in the form's error block (evidence: `su4-boundary-rejected.png`; the
  OCR context in the run artifact reads the full rejection text).
- **Clinic impact**: a doctor who follows the on-screen requirements
  exactly gets an unexplained rejection — a first-run frustration
  (data-quality adjacent, no security weakening: the enforced policy is
  STRONGER than advertised).
- **Proven in**: runs 34877260555 and 34885186221 (the boundary probe
  GREEN both times — the rejection is deterministic).
- **Suggested minimal fix (NOT applied — the frozen product is
  read-only in this campaign)**: align the checklist copy ("10+
  characters") and the client gate (≥10) with the enforced server policy.

### BUG-P1 → reclassified D [D] PATIENTS_REQUIRED_FIELDS — run 34901913438 (patients focus, run 1)

- **Class**: D — harness bug (initially recorded P1 by the harness; PROVEN a
  misclassification by the run's own evidence; the product behaved correctly)
- **Area**: patients — create dialog required-field validation verdict
- **Detail**: the empty-names submit (PC1) was reported as "CREATED a patient
  (the required validation did not fire)". The run's own evidence disproves
  this: THREE consecutive post-submit OCR captures (probes.log lines 219-229 +
  the bug-02 screenshot) show the Add New Patient dialog STILL OPEN with the
  native WebKit validation bubble "Fill out this field" pointing at the First
  Name field, the typed note still present, and the patient count badge still
  reading 0 ("O patients"). The native required validation FIRED; no patient
  was created; the dialog never closed.
- **Root cause (harness)**: `create_patient_deep`'s dialog-closed verdict was
  a single-needle `ocr_grep "Add New Patient"` on the dialog TITLE — which
  garbles in OCR once the submit-fallback's scroll bursts scroll the dialog's
  inner content (observed reads: 'Dochhnard', 'Nachhnord', '09 nachbaand'
  while every OTHER dialog element — subtitle, field labels, the bubble —
  reads perfectly). A garbled title read as "dialog gone" → rc=0 → the P1.
- **Fix (class D, applied)**: dialog presence is now ANY of five stable
  dialog-only needles (title, subtitle, Optional Details, First Name label,
  the Fill-out-this-field bubble) via `add_patient_dialog_visible`; the
  intermediate submitted-check and the final verdict both use it; PC1's
  rc=0 branch corroborates against the count badge before firing any P1
  (misread → D; a corroborated count increase → the real P1).
- **Regression test**: the fixed PC1 probe itself (the bubble text check in
  the GREEN path is the native-validation proof); plus run-2 rerun.
- **Evidence**: bug-02-PATIENTSREQUIREDFIELDS.png, pc1-empty-* (7 shots),
  probes.log lines 219-232, artifact 10371696057.

### BUG-PD1 [D] PATIENTS_CANCEL_CREATE — run 34901913438 (patients focus, run 1)

- **Class**: D — harness bug — fix the harness and continue
- **Area**: patients — cancel-create probe dialog open
- **Detail**: PC0's dialog-open click reported "Add Patient NOT FOUND" —
  because `read_patient_count` leaves the dashboard view scrolled DOWN at
  the patients list (its v_scroll_find), putting the header "Add Patient"
  button out of the OCR view before PC0's single-attempt click.
- **Fix (class D, applied)**: PC0 scrolls the header back into view
  (`v_scroll_top`) before the open click; the post-cancel close is now a
  VERIFIED close (`ensure_dialog_closed`, bounded Escape retries against the
  multi-needle dialog check) instead of a title-only wait; the count verdict
  distinguishes "unreadable" (honest D, no verdict) from a real change (P1).
- **Related hardening (same defect class, same focus)**: the badge OCR read
  'O patients' (letter O) as unreadable — `read_patient_count` now
  normalizes a leading letter-O to 0; the EDIT battery's six title-only
  "still open" checks and the PE1/NV2 close flows use
  `edit_patient_dialog_visible` / verified closes (the edit dialog title
  'Edit Patient' has the same garble exposure; fixed before it could
  misfire a false edit-P1).
- **Evidence**: bug-01-PATIENTSCANCELCREATE.png, pc0-open-before.png,
  probes.log lines 190-193, artifact 10371696057.

### BUG-P2 [P2] DIALOG_STATE_LEAK (patients focus, run 34904733614 — run 2)

- **Class**: P2 — substantive functional defect (proven; minimal product fix
  applied per the first-red discipline; the harness's initial P1 wording was
  an interpretation error — the required validation itself works correctly)
- **Area**: patients — Add Patient dialog state lifecycle
- **Detail**: the AddPatientDialog does not reset its fields when the dialog
  is closed/canceled — `handleClose` clears only the error state; the
  7-field reset exists ONLY on the create-success path. A canceled create's
  typed data silently persists and pre-fills the NEXT Add Patient session.
- **Proof chain (run 34904733614)**: PC0 (fixed) opened the dialog, typed
  'Scratch Pad' in First Name, canceled — the count stayed 0 (cancel itself
  GREEN). PC1's rejected submit left 'an empty probe note' in the same
  persistent state. PC1b (the last-name-only probe) reopened the dialog and
  typed 'Probe' in Last Name — the VLM read of
  `pc1b-lastonly-form-filled.png` proves the form showed First Name =
  'Scratch Pad' (leaked) + Last Name = 'Probe' + the leaked note; the Enter
  submit was therefore VALID, the POST carried BOTH names, and an unintended
  'Scratch Pad Probe' record was created — the Patients stat card read 0
  before (pc1-empty-open-before.png) and 1 after
  (pc1b-lastonly-submit-enter.png + bug-01), the dialog closed on the
  success path, and the harness correctly observed a creation (its P1
  message misattributed the cause — the fields were not empty).
- **Root cause (source)**: `src/components/add-patient-dialog.tsx`
  handleClose clears `error` only; the edit-patient-dialog is NOT affected
  (it re-syncs every field from the patient record on open via useEffect —
  the same idiom the fix adopts).
- **Clinic impact**: a receptionist who cancels a half-typed patient form
  and later opens Add Patient for a DIFFERENT patient finds the old data
  pre-filled; an inattentive submit creates a wrong/composite record in a
  medical app (wrong-chart risk downstream).
- **Fix (applied — minimal, the edit dialog's own idiom)**: a `useEffect`
  on `open` resets all 7 fields + the error when the dialog opens.
- **Regression test (added)**: the PC0 reopen probe — after the cancel
  count check, the battery reopens the Add Patient dialog and asserts
  'Scratch Pad' is ABSENT (P2 fires if the leak recurs); the fixed dialog
  must reopen clean.
- **Evidence**: pc1b-lastonly-form-filled.png (the leaked form),
  pc1b-lastonly-submit-enter.png + bug-01-PATIENTSREQUIREDFIELDS.png
  (Patients card = 1), pc1-empty-open-before.png (Patients card = 0),
  probes.log lines 291-311, artifact 10372732041.

### BUG-P1 [P1] SESSION_REFRESH_MISSING (patients focus, run 34907338207 — run 3)

- **Class**: P1 — core workflow unusable after 15 minutes (proven; minimal
  product fix applied per the first-red discipline)
- **Area**: authentication — web session lifecycle
- **Detail**: the access token (`mvlt_session` cookie) has a 15-minute TTL
  and the 48-hour refresh token (`mvlt_refresh` cookie) + the rotating
  `/api/auth/refresh` endpoint both exist — but the web frontend NEVER
  calls the refresh endpoint. After 15 minutes of continuous use every
  authenticated request fails with 401 "Authentication required" until the
  user manually logs out and back in. The mid-session casualty: a valid,
  correctly-filled patient create (all fields + the sentinel note) failed
  with the error rendered in the dialog while the form data was preserved
  (the only reason no data was lost).
- **Proof chain (run 34907338207)**: PC2/PC3/PC4 creates all succeeded
  (authenticated POSTs within the 15-min window); PC5's identical create —
  ~24 minutes after login — returned the visible "Authentication required"
  error (bug-02-ACCENTEDLATINCREATE.png + its OCR context line
  "Authentication required|370|163"; the VLM read confirms the correctly
  filled form + the error box). The session TTL is 48h (AuthSession) but
  the ACCESS token is 15 min (auth-service `15 * 60`); `rg 'auth/refresh'`
  over `src/` shows the frontend never calls it (the only hits are a
  route-permissions table row and comments).
- **Why the earlier focuses stayed GREEN**: the surface focus made no
  authenticated writes after the first ~15 min (pure GUI reading), and the
  account focus's writes all landed inside its login cycles' 15-min
  windows. The patients battery is the first focus to write continuously
  for >15 minutes — exactly what a deep lifecycle walk is for.
- **Root cause (source)**: no client-side refresh path; the dialogs' raw
  `fetch()` calls return the 401 to the component error states.
- **Fix (applied — minimal, single point)**: the global fetch adapter
  (src/lib/fetch-csrf.ts, which already wraps every mutating /api request
  with the CSRF header and is imported once by the app page) now, on a 401
  from a cookie-mode /api request: attempts ONE single-flight
  `POST /api/auth/refresh` (CSRF-attached, credentials included), and on
  success retries the original request with the ROTATED CSRF pair. Auth
  endpoints that legitimately 401 (login/setup/csrf/refresh/mobile) and
  Bearer-transport requests are exempt; a failed refresh returns the
  original 401 untouched (the honest logged-out path). This also silently
  hardens the boot session-restore path (GET /api/auth/me after an expired
  access token now refreshes instead of bouncing to Sign In).
- **Regression test**: the patients battery itself — PC5+ run ~20+ minutes
  into the session; with the fix, the accented create (and every later
  write: edits, visits, deletes) must complete transparently. A run-4
  completion past the 15-min mark is the proof.
- **Evidence**: bug-02-ACCENTEDLATINCREATE.png (the 401 error box in the
  correctly-filled dialog), pc5-elodie-dialog-still-open.png,
  probes.log lines 827-875, artifact 10373009495 (119 files).

### BUG-P0 → reclassified D [D] PATIENT_DATA_ISOLATION (FALSE) — run 34930796719 (patients focus, run 10)

- **Class**: recorded P0 by the harness, **reclassified D after the prove
  step — a FALSE positive: no cross-patient data leak occurred**. The
  product's data isolation held perfectly.
- **The reported red**: `[bug-P0] PATIENT_DATA_ISOLATION: John Test's
  detail shows another patient's sentinel note (ONLY-HYPHEN-INDIA) —
  CROSS-PATIENT DATA LEAK` at PI (06:02:45Z, exit 2, the deepest patients
  stop yet — past PC8 and PC10 into PI).
- **What actually happened (the full proof chain)**:
  1. The PI John probe clicked the row intended as "John Test" — but the
     needle "John Test" PREFIX-matches the PC8 similar-name cohort rows
     ("John Test-Hyphen", "John Tester", "john test"). Only the Zed and
     "John Test-Hyphen" rows were in view; the hyphen row won
     (vclick at (176,584) → the hyphen row line).
  2. The detail that opened was **John Test-Hyphen's own record**: the
     API log shows exactly ONE detail GET in the window —
     `GET /api/patients/1e9fc36b…` at 06:02:00 (+visits/notes/documents/
     prescriptions/timeline, all 200) — and the rendered page consistently
     shows HIS name, HIS phone (+1 555 1103), and HIS note
     (ONLY-HYPHEN-INDIA).
  3. That note is NOT foreign: the pc8c create at 05:49:15 typed exactly
     `John / Test-Hyphen / +1 555 1103 / Notes: ONLY-HYPHEN-INDIA`
     (VLM-verified on pc8c-hyphen-notes-after.png; the create POST shows
     the proven 401→refresh→201 transparent-retry pattern — the session
     refresh fix still holding past the 15-min mark).
  4. The PI scan's own/foreign lists are computed for the INTENDED patient
     (John Test, own=ONLY-JOHN-ALPHA) — so the actually-opened patient's
     own note read as "foreign". Name+phone+note all belonged to the
     opened record: a consistent triple, i.e. the authoritative record of
     the wrong-needle patient, not a mixed-record leak.
- **Root cause (harness, class D)**: `open_patient_detail`'s name needle
  is a LINE substring — ambiguous once similar names exist (exactly the
  condition PC8 creates). The first in-view match won.
- **Fix (applied — harness-only, +81/−19 in exploratory-qa.sh, zero
  product code)**: (a) `open_patient_detail` takes an optional 3rd
  row-needle (the patient's unique row-phone line); every John Test open
  (PI, PE1, PE2, PV1, PNAV-nv6, PP) now passes it — pre-edit
  `+1 555 0101`, post-edit `+1 555 0777`; (b) every phone-token open's
  success is gated on a NEW `detail_open_proof` (see BUG-PD3); (c) default
  row-needle = the name — byte-identical for every pre-existing call site.
- **Regression surface**: PI John's own scan (own=ONLY-JOHN-ALPHA present,
  all 9 foreign sentinels absent) now actually exercises John Test's
  record; the similar-name sub-checks exercise each cohort patient's own
  record.
- **Evidence**: bug-07-PATIENTDATAISOLATION.png, pi-john-row-before.png
  (the two in-view rows), pi-john-detail.png, pc8c-hyphen-notes-after.png
  (VLM: the create assignment), backend-api.log (the single detail GET +
  the 05:49:15 401→201 pair), artifact 10382368515 (249 files).

### BUG-PD3 [D] OPEN_BY_PHONE_TOKEN_FALSE_OPEN — run 34930796719 (patients focus, run 10)

- **Class**: D — harness defect (the pc8 similar-name sub-checks silently
  verified the wrong screen)
- **Detail**: all three pc8 isolation sub-checks ("each similar patient
  opens its OWN record") reported success without ever opening a detail:
  the API log contains **zero** detail GETs at 05:51/05:54/05:57. The
  single filtered row sits below the fold; scrolling to the bare token
  stopped at the search box's own QUERY line (always visible); the
  row-phone click found nothing; and the bare-token fallback clicked the
  QUERY line itself — its focus ring changed the screen hash, and
  v_click's hash-diff verify passed a FALSE "detail opened". The scan then
  swept the filtered LIST (no notes there) → the honest bug-D "own note
  could not be OCR-verified" — the right verdict class, wrong mechanism.
- **Fix (applied, harness-only)**: `open_patient_by_phone_token` now
  scrolls to the ROW-ONLY text (the full row phone — the query box holds
  only the token) before clicking, and every success path is gated on the
  NEW `detail_open_proof` helper: the LIST always renders its search bar
  ("Search patients by name, phone, or email…") while the DETAIL never
  does — AND the detail must show one of its section markers ("Visit
  History"/"Prescriptions"/"Clinical Notes", none of which exist on the
  list or dashboard). A query-box click can never again read as success.
- **Evidence**: probes 05:51:16-05:57:44 (the query-line clicks at
  (82,387)/(83,388)/(82,389)), backend-api.log (no detail GETs in that
  window), pc8-1101/1102/1103-search-after.png + -filtered.png (the row
  below the fold), artifact 10382368515.

### BUG-P0 → reclassified D (2) [D] FOREIGN_LIST_NOT_RELATIVE — run 34936649898 (patients focus, run 11)

- **Class**: recorded P0 by the harness, **reclassified D after the prove
  step — a FALSE positive: no cross-patient data leak occurred. The
  run-10 row-targeting fixes themselves worked perfectly.**
- **The reported red**: `[bug-P0] PATIENT_DATA_ISOLATION: a similar-name
  patient (John Tester) shows ANOTHER patient's sentinel note
  (ONLY-TESTER-GOLF) — cross-patient data leak` at the pc8 sub-check
  (07:11:32Z, exit 2).
- **What actually happened (the proof chain)**:
  1. The run-10 fixes held: pc8-1101 scrolled to the ROW phone
     ('+1 555 1101'), clicked the ROW (145,434), and the NEW
     `detail_open_proof` confirmed the real detail ("the list search bar
     is absent and a detail section marker is visible") — the first
     correctly-exercised cohort isolation scan of the campaign.
  2. The opened detail is John Tester's OWN record, self-consistent:
     name "John Tester", phone "+1 555 1101", email
     "john.tester@example.invalid", Notes "ONLY-TESTER-GOLF" — exactly
     the pc8a create assignment (verified against the run's own OCR
     line at 07:10:57).
  3. `scan_detail_multi "$expect_note" "$FOREIGN_ALL"` — but
     FOREIGN_ALL **contains ONLY-TESTER-GOLF** (John Tester's own
     sentinel). His own note matched the "foreign" list → false P0.
- **Root cause (harness, class D — structural)**: FOREIGN_ALL is the
  sentinel set of all OTHER patients *from John Test's perspective* —
  but it also contains the sentinels of EVERY patient the battery scans
  with it: Jane (BRAVO), Muhammad (CHARLIE), Élodie (DELTA), O'Connor
  (ECHO), LongName (FOXTROT), Zed (ZED-DELETE), and the PC8 trio
  (GOLF/HOTEL/INDIA). Any correctly-opened, correctly-isolated detail of
  those patients would false-P0/false-P1 the moment the scan works.
  Runs 1–10 never reached these scans with a working open — the two
  defects were masked layers of the same onion.
- **Fix (applied — harness-only, +21 lines, single point)**: BOTH scan
  functions (`scan_detail_multi` and `verify_detail_authoritative`)
  receive the patient's own note as a parameter — each now strips it from
  the foreign list before scanning (`tr ',' '\n' | grep -vx -- "$own" ||
  true | tr '\n' ',' | sed 's/,$//'`), fixing every current and future
  call site by construction. Functional test: own=GOLF → 8 foreign;
  own=ALPHA (John, not in list) → unchanged 9 (no-op); own=ZED-DELETE →
  8; empty own → unchanged. This also pre-fixes pe-other-zed's
  VDA_FOREIGN_SEEN gate (Zed) and pv4's probe noise.
- **Evidence**: bug-03-PATIENTDATAISOLATION.png, pc8-1101-detail.png,
  pc8-1101-row-before.png + the 07:10:57 OCR line (the self-consistent
  triple), artifact 10384822943 (201 files).

### BUG-PD4 [D] RECENT_PANEL_CAP_HIDES_John — run 34985384528 (patients focus, run 12)

- **Class**: D — harness targeting defect (three honest bug-D "could not
  open John's detail" stops: PI, PE1, PE2)
- **Detail**: the run-10 row-needle fix (the unique row-phone line) is
  correct — but John's row is NOT RENDERED on the dashboard at all: the
  Recent Patients panel is `db.patient.findMany({ orderBy: { updatedAt:
  'desc' }, take: 8 })` (the /api/stats route) — capped at 8 rows sorted
  by update recency. John, the OLDEST never-updated record, falls below
  the cap once the PC8 trio + Zed fill it; the scroll searches (6 down +
  5 up) can never find "+1 555 0101" because it is not on the screen.
- **Fix (applied, harness-only)**: the pre-edit John opens (PI, PE1,
  PE2) now use the phone-token SEARCH path (`open_patient_by_phone_token
  "0101" …`) — the exact path proven 7× in this very run (1101, 1102,
  1103, 0202, 0304, 0105, 0106 — every one detail-proof confirmed). The
  post-edit opens (PV1, PNAV-nv6, PP) keep the row-needle: PE2's edit
  bumps John's updatedAt, returning his row to the TOP of the panel,
  where "+1 555 0777" is directly clickable.
- **Evidence**: probes 16:04:00–16:04:32 (the failed row searches), the
  panel OCR (only the newest 7-8 rows ever render), bug-03/04/05, the
  /api/stats route source (take:8, updatedAt desc), artifact 10406119085.

### BUG-PD5 [D] DETAIL_OPEN_SCROLLED_PAST_BANNER — run 34985384528 (patients focus, run 12)

- **Class**: D — harness anchoring defect (pe3/pe4 pencil failures; the
  pe4 failure escalated to the run's stop as a P1)
- **Detail**: a detail opened from a SEARCH-row click can land with the
  banner SCROLLED OFF-SCREEN — the post-open OCR shows the mid-page
  sections ('No prescriptions yet'/'Clinical Notes'/…, which is exactly
  why detail_open_proof passes) and NO banner. The edit pencil anchors on
  the banner's name/phone subline → "anchor text not found on screen" →
  pe3 recorded bug-D, and pe4's round-1 failure escalated to
  `[bug-P1] PATIENT_EDIT_CONSECUTIVE` — the run's honest stop.
- **Fix (applied, harness-only)**: `v_click_edit_pencil` now scrolls the
  detail to the TOP (the banner) before the anchor lookup — the same
  bounded 8-up-burst top-restore `scan_detail_multi` already performs
  (a no-op when already at the top). Every pencil call site (pe1-pe7,
  nv2) is a detail-page context, so the scroll is always safe.
- **Evidence**: pe3-elodie/pe4-oconnor post-open OCRs (sections visible,
  no banner), bug-06/07, artifact 10406119085.

### [P1 → D] PATIENT_EDIT_CONSECUTIVE (run 34985384528) — disposition

The run's stopping P1 ("a consecutive-edit round failed") is the pe4
escalation of BUG-PD5: round 1's pencil could not anchor because the
detail was opened scrolled past the banner. No product edit was ever
attempted on O'Connor's record — no evidence of a product defect. With
the pencil top-restore, PE4's rounds should exercise the real
consecutive-edit semantics (edit → save → edit again). Reclassified D
(root cause BUG-PD5); the PE4 probe itself remains the regression test
for the rerun.

### BUG-PD6 [D] EDIT_DIALOG_LABEL_COLLISION — run 35017083195 (patients focus, run 13)

- **Class**: D — harness targeting defect (the run's stopping P1 +
  a vacuous pe1 GREEN)
- **The reported red**: `[bug-P1] PATIENT_EDIT: saving John's edit
  produced no visible change` at PE2 (21:27:31Z) — the edit battery's
  arming edit never happened.
- **What actually happened (the proof chain)**:
  1. The run-12 fixes held: PE1/PE2 opened John via the phone-token
     search (detail-proof confirmed) and the pencil opened the Edit
     Patient dialog (the anchored fallback; the dialog verified by its
     'First Name' + 'Completion' + '5 of 7 fields' markers).
  2. `v_type_into "Phone"` looked up the label 'Phone' — and found the
     PATIENT DETAIL banner's 'Phone' label at (141,351), not the
     dialog's field label (~x=313): the edit dialog renders over the
     detail page, whose banner carries the SAME short labels
     (Phone/Notes/Email/Address) at the LEFT edge, and the lookup's
     first-hit in reading order picked the banner's.
  3. The label click at (141,351) landed on the dialog OVERLAY, left of
     the dialog card — the modal DISMISSED itself (outside-click
     dismissal) before a single keystroke. The subsequent OCRs show the
     dashboard/detail with no dialog; 'Notes', 'Cancel', and 'Save
     Changes' were all 'NOT FOUND' → PE2_RC=1 → the P1.
  4. PE1 had the SAME dismissal (its typing went nowhere) — its recorded
     "Cancel edit — GREEN" is VACUOUS (the dialog was already dismissed;
     nothing was ever typed; the 999-absent check passed trivially). The
     rerun must re-earn it.
- **Root cause (harness, class D)**: the label lookup has no notion of
  the dialog card's x-range; over the detail page the same-named banner
  labels win the first-hit.
- **Fix (applied, harness-only, +47/−16)**: `v_type_into` (optional 7th
  arg) and `v_clear_field` (optional 3rd arg) accept an `xmin` label
  filter — when set, the OCR lines are filtered to x ≥ xmin (scaled)
  before the label lookup and restored after; all 13 edit-battery
  typing sites (pe1/pe2/pe3/pe4/pe5/pe6/pe7 + nv2) pass 250 (the dialog
  card's fields sit at x≥~300; the banner labels at x≈141). Default
  empty = byte-identical for every pre-existing call site (the create
  dialog sits over the dashboard, which has no such labels — 13 runs of
  evidence).
- **Evidence**: pe1/pe2 label hits at (141,351), the post-click OCRs
  (dashboard, no dialog), bug-03, artifact 10419362290 (311 files).

### BUG-PD7 [D] PENCIL_BAND_FROM_ANCHOR_Y — run 35026560477 (patients focus, run 14)

- **Class**: D — harness targeting defect (pe3 D + the pe4 consecutive
  P1 — the run's stop)
- **Detail**: the edit-pencil's icon band was derived from the ANCHOR's
  own y (anchor_y − 13 + yadj). For the NAME-anchored calls (pe1/pe2/nv2)
  that is correct — the icons sit at the name's band (y≈164..199,
  empirically proven by the successful (902,184) fallback). But the
  phone-anchored calls (pe3-pe7: Élodie/O'Connor/Muhammad — their names
  OCR unreliably due to accents/apostrophe/Arabic) anchor on the contact
  subline at y≈370, ~171pt BELOW the name in the current layout; the
  stale -38 yadj put the band at y≈319, where the icon scan found the
  CALL/EMAIL action icons (and clicking them did nothing) and every
  fallback candidate (902/920/884/860/944, y=317) missed the edit row.
- **Fix (applied, harness-only, +27/−3)**: the band (and the fallback y)
  is now derived from the TOPMOST CONTENT LINE of the detail banner —
  the patient name/avatar row (x≥200 — right of the sidebar, y 140..400
  — below the app header/tabs): band_cy = row_y − 13, fallback
  ty2 = row_y − 15, INDEPENDENT of the anchor's own position (the anchor
  still verifies the right patient's detail is open). The yadj survives
  only as the legacy fallback when no banner row is found. Functional
  test: the avatar row y=186 → band 173 / fallback 171 — both inside the
  proven icon row (164..199); the old phone-anchored band 319 → outside.
- **Also proven in run 14 (the run-13 fix held)**: pe1's Cancel-edit
  GREEN is now EARNED (the xmin filter targeted the dialog's Phone
  field at (312,461) — typing verified visible — vs. the banner label
  at (141,351) that dismissed the modal in run 13), and PE2's
  multi-field edit GREEN (the arming edit saved: John's phone
  +1 555 0777 + note v2).
- **Evidence**: pe3/pe4 pencil probes (the (701,297) cluster = the
  action icons; the y=317 fallbacks), pe1/pe2 GREENs, bug-03/04,
  artifact (run 14, 330 files).

### BUG-PD8 [D] POST_SAVE_VERIFY_SCROLL_DIRECTION — run 35034199641 (patients focus, run 15)

- **Class**: D — harness verification defect (the run's stopping P1)
- **The reported red**: `[bug-P1] PATIENT_EDIT_CONSECUTIVE: the
  consecutive edits saved but the final value (round2) is not visible`
  (00:35:21Z).
- **What actually happened (the proof chain)**:
  1. The run-14 pencil-band fix WORKED: pe3 (single-field Élodie)
     GREEN, and pe4's two rounds both SAVED — the API log shows BOTH
     PUTs to O'Connor's record (00:29:35 round1 → 200, 00:32:39 round2
     → 200). The product behaved correctly.
  2. The final verify reopened O'Connor's detail — which landed with
     the banner SCROLLED OFF-SCREEN (the post-open OCR shows only the
     mid-page sections: 'No prescriptions yet'/'Clinical Notes'/'No
     documents yet') — and `v_scroll_find 'round2'` scrolls DOWN ONLY,
     moving AWAY from the banner where the note renders. The saved
     value was never going to be seen from there.
- **Root cause (harness, class D)**: the PE post-save verifies assumed
  the detail opens at the top; the search-row open can land mid-page.
  pe5's verify already had the 8-up-burst top-restore — the others
  didn't.
- **Fix (applied, harness-only, +48/−18)**: NEW `detail_scroll_top`
  helper (the pe5 idiom extracted); called before the pe2/pe3/pe4/pe6/
  pe7 verifies (pe5 already had it inline). The pe3/pe6 blocks also
  gained the proper save-failed P1 branches (the restructure made the
  save-completion vs visible-save distinction explicit).
- **Evidence**: the two 200 PUTs, the reopened detail's mid-page OCRs,
  the 'NOT visible after 8 down scroll bursts' probe, bug-03, artifact
  (run 15, 362 files).

### BUG-PD9 [D] PENCIL_BAND_ARABIC_BANNER + [INFRA] JOB_TIMEOUT_90 — run 35041063210 (patients focus, run 16)

- **Class**: D (pe7) + an infrastructure classification for the run's
  CANCELLED conclusion
- **The cancellation (classified)**: the GUI job was cancelled at exactly
  90:00 elapsed (started 00:55:42, cancelled 02:26:15 — the workflow's
  `timeout-minutes: 90`), mid-PV2, with the artifact uploaded by the
  post-cancel cleanup. NOT a harness stop, NOT a product failure: the
  battery legitimately outgrew 90 minutes now that PE completes (the
  run reached PV2 at 90:00; PV1 was already GREEN). Fix: the GUI job's
  timeout raised to 150 minutes (the campaign's own workflow file, not
  a frozen lane).
- **pe7 (the pencil's last gap)**: Muhammad's ARABIC banner text does
  not OCR — the topmost-content-line band derivation (run 15's fix)
  picked a lower section line (y=229), drifting the fallback band 30pt
  below the icon row (the pe7 fallbacks at y=214 all missed; every
  OCR-able patient's row measured 195-199 with the icons at ~180-199).
  Fix: the derived row is CLAMPED to the banner window [150,210] —
  outside it, the modal row (195) is assumed (the exact position that
  worked for pe3-pe6).
- **Also proven in run 16**: PE4 CONSECUTIVE GREEN (both rounds saved
  AND visually confirmed — the run-15 verify fix), pe5 CLEAR-OPTIONAL
  GREEN, pe6 UNICODE GREEN (implied by reaching pe7), **PV1 the
  list-row entry point GREEN** (the post-edit 0777 row found via the
  retry; the authoritative record verified: name/phone/email/note all
  present, no skeleton, no foreign sentinels).
- **Evidence**: the 90:00 cancellation timing, PV1's GREEN, the pe7
  fallback probes, artifact 10427253185 (130MB).

### BUG-PD10 [D] PDEL_TRASH_BAND + the BACKSPACE_BACK_NAVIGATION trap + the PP cascade — run 35048296418 (patients focus, run 17)

- **Class**: D — three linked harness defects (the run's stopping P1 was
  a cascade)
- **The reported red**: `[bug-P1] PATIENT_PERSISTENCE: the patient count
  after the restart reads '10' (expected 9 — records may have been lost)`
  (04:41:06Z) — a CASCADE: Zed was never deleted, so 10 is the CORRECT
  count for the actual state. No persistence defect.
- **Defect 1 (PDEL, the trash)**: `v_click_delete_trash` had the two
  pre-fix pencil defects — no top-restore (the search-row open leaves the
  banner off-screen → "patient name 'Zed Delete' not found") and the
  band from the anchor's y. Fix: the pencil's `detail_scroll_top` +
  the shared `detail_banner_row` derivation (extracted into a helper
  used by both icon clicks).
- **Defect 2 (the trap)**: after the del2 D, the flow stayed on Zed's
  DETAIL; the next `clear_search_box` ran its Cmd+K → Cmd+A →
  **Backspace** with no input focused — WKWebView's BACK navigation
  returned the webview to the tauri:// first-run page (the account-era
  mechanism), and the ENTIRE PNAV battery then D'd against the
  onboarding screen (nv1/nv2/nv3/nv6 all "could not open"). Fix: the
  clear now GUARDS — the patients search bar must be visible before the
  keystrokes, else it clicks Dashboard first.
- **Defect 3 (del3's context)**: the ghost-entry probe searched for the
  Recently Viewed section while still on the detail (it lives on the
  dashboard). Fix: an explicit (idempotent) Dashboard navigation before
  the probe.
- **Also proven in run 17**: the ENTIRE edit battery GREEN (all 7 probes
  incl. pe7 Arabic — the band clamp worked), PV1/PV2/PV4/PV5 GREEN
  (PV3 the Recently Viewed chip D — honest; PV6-8 NOT EXERCISED — the
  known visit-scheduler limitation).
- **Evidence**: the del1/del2 "name not found" probes, the 04:30:39
  clear-search followed by the onboarding OCRs, the nv D's on the
  onboarding, the PP count-10, artifact (502 files).

### BUG-PD11 [D] NV3_STALE_PRE_EDIT_TOKEN — run 35057060814 (patients focus, run 18)

- **Class**: D — harness defect (the run's stopping P1 — a FALSE
  positive; no product defect)
- **The reported red**: `[bug-P1] NAV_RAPID_SWITCHING: a rapid-switch hop
  landed on the wrong record (a sentinel mismatched)` (07:21:55Z).
- **What actually happened**: hop 3 searched the phone token **'0101' —
  John's PRE-edit number**. PE2 had changed John's phone to
  +1 555 0777 hours earlier in the battery; the search for the stale
  token returned **"No patients found"** (the OCR evidence), the row
  click had nothing to click, the open returned failure — and the
  conflated verdict logic reported it as "landed on the wrong record".
  Hops 1 (Muhammad) and 2 (O'Connor) opened correctly with their
  sentinels verified. No wrong record was ever rendered.
- **Fix (applied, harness-only, +28/−10)**: hop 3 now searches the
  POST-edit token '0777' with $JOHN_NEW_PHONE as the row needle; each
  hop's sentinel grep is preceded by the detail top-restore (the
  search-row open can land past the banner); and a FAILED OPEN is an
  honest D — only a real sentinel mismatch records the P1.
- **Also proven in run 18**: **PDEL ALL GREEN** (the Delete dialog
  opened via the fixed trash, the cancel delete GREEN, the confirm
  delete GREEN — Zed DELETED, the count badge 9 — and the ghost entry
  GREEN/clean), nv2 edit-navigate-away GREEN.
- **Evidence**: the "No patients found" OCRs at 07:21, the hop1/hop2
  sentinel passes, bug-05, artifact (536 files).

### BUG-PD12 [D] DETAIL_TOP_STALE_OCR — run 35068548928 (patients focus, run 19)

- **Class**: D — harness defect (the run's stopping P1 — a FALSE
  positive; all three rapid-switch hops opened the CORRECT records)
- **The reported red**: `[bug-P1] NAV_RAPID_SWITCHING: a rapid-switch hop
  landed on the wrong record (a sentinel mismatched)` (10:06:19Z).
- **What actually happened**: all 3 hops searched their tokens, clicked
  their rows, and passed detail_open_proof (the OCR evidence shows each
  detail's sections). The run-19 nv3 fix added `detail_scroll_top`
  before each sentinel grep — but the restore SCROLLED without
  refreshing the global OCR_TEXT: the subsequent `ocr_grep` read the
  STALE pre-scroll capture (the mid-page sections — no sentinel banner)
  and recorded the mismatch. No wrong record was ever rendered.
- **Fix (applied, one line + the comment)**: `detail_scroll_top` ends
  with a fresh `ocr_capture` — every caller's ocr_grep now reads the
  post-restore state. (The PE verifies were unaffected: their
  v_scroll_find re-captures internally.)
- **Evidence**: the three hop rows' correct clicks + detail-proofs, the
  stale-OCR greps, bug-04, artifact (531 files).

### BUG-PD13 [D] NV6_BARE_GREP_PAST_BANNER — run 35083580318 (patients focus, run 20)

- **Class**: D — the same scrolled-past-banner family (the run's stopping P1 — FALSE)
- **The reported red**: `[bug-P1] NAV_SEARCH_CLEAR_REOPEN: the reopen
  after clearing the search lost the edited phone (0777 absent)`.
- **What actually happened**: the reopen WORKED — the retry clicked
  John's 0777 row, the detail opened (the OCRs show its sections) — but
  the verify's bare `ocr_grep "0777"` read the mid-page capture (the
  banner, where the phone renders, was scrolled off-screen). nv3 was
  GREEN this run (the OCR-refresh fix proven); the same bare-grep
  pattern remained in nv6 (and PP's Muhammad check).
- **Fix (applied, harness-only)**: nv6's reopen verify + PP's Muhammad
  verify use `detail_scroll_top` (the OCR-refreshing restore) before
  their greps. The PP John verify was already safe
  (verify_detail_authoritative scrolls internally); the PP Zed-gone
  check is an absence check on the search page.
- **Evidence**: the 0777 row-retry click, the mid-page post-open OCRs,
  bug-04, artifact (546 files).

### BUG-PD14 [D] ADD_PATIENT_LINE_MERGE_TRAP — run 35098545148 (patients focus, run 21)

- **Class**: D — an OCR line-merge misfire (the run's stopping P1 — FALSE;
  the product never received a create request: zero POST /api/patients)
- **The reported red**: `[bug-P1] PATIENT_CREATE: the John Test create
  did not complete (rc=1)` at PC2 — only ~28 min into the run (this
  runner ALSO showed a transient onboarding error state at boot — a
  degraded-render session).
- **What actually happened (VLM-proven)**: PC1b's dialog-open click
  was OCR-located on a MERGED line — the nav row ("Dashboard Settings
  … Add Patient") merged into one long line whose bounding box covers
  the Settings tab; the click landed on the SETTINGS NAV and navigated
  away. PC1b then ran vacuously on Settings (typing into the Display
  Name field; its "rejected" verdict unearned), and PC2's open honestly
  failed (no 'Add Patient' on Settings) → the P1.
- **Fix (applied, harness-only)**: every 'Add Patient' dialog-open
  click (the shared create functions, PC0, PC10, and the s16 surface
  probe) uses the LABEL lookup mode — the fallback match is restricted
  to SHORT lines (≤ needle+14), so a merged nav line can never win; the
  toolbar button ('2+ Add Patient') still matches. The try_hits
  fallbacks were already self-correcting (each hit is verified by
  'First Name' appearing).
- **Evidence**: pc1b-open-before (Dashboard) → pc1b-open-after
  (Settings), the Settings-page form-filled/submit-failed snaps, the
  zero create POSTs, bug-01, artifact (546+ files).

### BUG-PD15 [D] NV7_BARE_GREP_PAST_BANNER — run 35102143182 (patients focus, run 22)

- **Class**: D — the last of the scrolled-past-banner bare-grep family
  (the run's stopping P1 — FALSE)
- **The reported red**: `[bug-P1] NAV_LOGOUT_FROM_DETAIL: after the
  re-login + reopen, Muhammad's sentinel note is not visible (the
  record lost data across the logout cycle?)` (16:16:16Z).
- **What actually happened**: the logout/re-login/reopen all WORKED
  (the flow reached the reopen; the token open succeeded) — but the
  verify's bare `ocr_grep` read the mid-page capture (the banner, where
  the sentinel renders, was scrolled off-screen). The SAME pattern also
  existed in nv1's and nv2's verifies (nv2's is an absence check that
  passed vacuously — the restore makes it real).
- **Fix (applied, harness-only, 3 sites)**: nv1-second, nv2-reopen, and
  nv7-reopen use `detail_scroll_top` (the OCR-refreshing restore) before
  their greps — the systematic sweep now shows ZERO remaining
  bare-grep-after-open sites in the battery.
- **Also proven in run 22**: nv1-nv6 all GREEN (the first run through
  the ENTIRE navigation battery).
- **Evidence**: bug-05, the artifact (run 22).

### BUG-PD16 [D/INFRA] GUI_BUDGET_150_OUTGROWN — run 35121130113 (patients focus, run 23)

- **Class**: INFRASTRUCTURE (the same class as BUG-PD9's 90-min case) —
  the FIRST full-GREEN-path walk legitimately outgrew the 150-minute
  GUI budget.
- **What actually happened**: run 23 walked PC0–PC10 + all isolation
  scans + the ENTIRE edit battery + PV1/2/4/5 + PDEL + nv1–nv6 ALL GREEN
  (~151 min) — with no first-red and no harness stop — and the runner
  cancelled at exactly the 150-min boundary with only nv7 + PP + the
  final report unstarted.
- **Fix (applied, workflow-only, +7/−2)**: the exploratory-qa.yml GUI
  job `timeout-minutes` 150 → 210 (the campaign's own workflow — no
  product code, no frozen lane, no harness change).
- **Regression proof**: run 24 (35139685879) completed the FULL walk
  in ~157 min of GUI time — nv7 GREEN (the logout-from-detail cycle)
  and PP GREEN (the quit/reopen persistence: John's edited values,
  Muhammad's Arabic note, isolation intact, Zed still deleted) —
  ending `EXPLORATORY-QA-GREEN-patients`.
- **Evidence**: the run-23 artifact (10463734605, 536+ screenshots)
  and the run-24 artifact (10471500388, 590 files).

### Patients campaign — FINAL STATE (run 24 GREEN, 2026-09-16)

The definitive patients run (35139685879 @ 517e37f, private 79f93ad)
completed end-to-end: 57 capability rows — 51 GREEN, 4 NOT EXERCISED
(the stable shadcn-select visit-scheduler limitation + its PV6–8
dependents), 2 recorded. The register's standing entries: BUG-PD1…PD16
all fixed harness-side; the only product fixes of the whole campaign
remain the P1 session-refresh and the P2 dialog-state-reset (both
frozen GREEN); BUG-A1 (P3 password-policy mismatch) remains the only
open product finding. PATIENTS = FROZEN GREEN.

### BUG-PD17 [D] WAVE_FIRST_RUN_ANCHORING_FAMILY — runs 35157789388 + 35159006355 (the wave's first-reds, all harness-class)

- **Class**: D — the four new batteries' first macOS run + the settings
  focus's first dispatch; five distinct anchoring/idiom defects, zero
  product defects (full evidence in the wave logs; artifacts preserved).
- **(a) settings g2 SETTINGS_DISPLAYNAME**: settings-view's Display Name
  label has NO htmlFor — the label click left the body focused, the
  keystrokes went to the page, and the two spaces in the typed probe
  scrolled the Settings page two viewport-heights down (the verify then
  read scrolled-away captures). Fixed via the app's own focus path (the
  Edit Profile button → profile-name-input focus) + a verify-scroll
  guard before the grep.
- **(b) documents DB0**: the 'Scan Document' fallback matched the
  welcome-banner TIP-2 title (a longer containing line) instead of the
  toolbar button. Fixed with the BUG-PD14 label/short-line mode + the
  toolbar-reveal scroll + scan-view-unique verification markers.
- **(c) clinical CC0–CC2**: the battery never restored the detail top
  between section walks — after landing mid-page, every section search
  scrolled further down (Visit History is ABOVE). Fixed with 29
  detail_scroll_top restores at every step boundary.
- **(d) dataio DD1**: the toolbar row sits ABOVE the GETTING STARTED
  banner that v_scroll_top stops at — 'Import CSV' was out of OCR view
  at click time. Fixed with dio_toolbar_click (scroll until the toolbar
  row is visible → wait → label-mode click), applied to every toolbar
  call site.
- **(e) desktop fx1-pat1**: the fixture used create_patient_full whose
  email typing-verify hard-P1s on the @-mangle OCR family (the '2
  optional filled' counter proves the typing worked). Fixed by creating
  both fixtures via create_patient_deep (the patients battery's proven
  soft-verify idiom).
- **Also (orchestration, run 35157098933)**: sequential focuses on one
  VM failed the harness's own FRESH_STATE gateway → shard A split into
  three clean-VM jobs; first-red evidence was not preserved as artifacts
  (rename-on-success only) → the battery step now preserves every
  focus's evidence red-or-green.
- **Regression rerun**: shards="settings,B,C,D,E" (search + persistence
  GREEN at 140d3a89 stay frozen per the cross-shard fix discipline).

### BUG-PD18 [D] WAVE_ROUND2_REDS — runs 35162802404 (the second wave round, five harness-class first-reds)

- **(a) settings g4**: the check P2'd when 'Confirm Reset' produced no visible
  change — but that IS the designed placeholder behavior (source: a 'Feature
  Placeholder' toast; the Toaster is not mounted so nothing ever renders).
  The verdict must come from the data-intact proof, not the visibility of
  the click's effect. Fixed: the no-change outcome records a probe; the
  STUB verdict is the patient-still-exists check.
- **(b) clinical CC2 footer**: 'Schedule Visit' is textually ambiguous (the
  dialog title + the dimmed page + the footer submit). The round-1 near-anchor
  'Cancel' never OCR'd and the click never landed on the footer. Fixed with
  clc_footer_click: the LAST OCR hit + a y-gate below the dialog's Chief
  Complaint field (the same class that kept the patients PV6-8 NOT
  EXERCISED — now solved for the clinical battery) + the cascade guard
  (ledger flags: an uncreated record can never P1 as 'lost').
- **(c) desktop fx3 row click**: open_patient_by_phone_token called without
  the row-phone needle → the raw '0456' matched the search QUERY line. All
  13 call sites now pass the formatted row needle (+1 555 0456).
- **(d) documents fixtures**: the welcome banner's 6-second tip carousel
  animation caused a hash-diff false-positive in create_patient_deep's
  dialog-open verify (Jane's dialog never opened; the typing soft-failed
  into the dashboard). Fixed with docb_fixture_create: an anchor-gate
  before the create, dialog-close hygiene, ONE bounded rc=1 retry, and
  API-log POST corroboration for the cohort.
- **(e) dataio DD2 multibyte arrow**: '$dd2_before→$dd2_after' — bash ate
  the arrow's lead byte INTO the variable name ('dd2_before<E2>') and
  set -u killed the focus mid-verify. All 8 '$var→' adjacencies in the
  file converted to ASCII '->' (zero remain); DD2's badge corroboration
  now actually computes (before-badge + IMPORTED, SKIPPED never added).

### BUG-PD19 [P2 PRODUCT, FIXED] IMPORT_SILENT_REJECTION — wave round-4 (run 35166559598, DD3b)

- **Class**: P2 — a genuine product defect (the first real product finding of
  the parallel wave).
- **The finding**: selecting an EMPTY .csv in the Import Patients dialog (via
  the file picker OR drag-drop) silently rejects it: no error banner, no
  staged file, no toast. The user has no idea why nothing happened.
- **Root cause** (source-proven): `handleFileSelect` and `handleDrop` in
  `src/components/import-patients-dialog.tsx` call `setError(msg)` on a
  validation failure but never `setPhase('error')` — and the red validation
  banner renders only under `{error && phase === 'error'}` (line ~589), so it
  is unreachable for selection-phase rejections. `validateFile` (:101-113)
  correctly returns 'The selected file is empty.' etc. — the message just
  could never render.
- **The minimal product fix (applied)**: both handlers now set
  `setPhase('error')` alongside `setError` (2 sites, +6 lines with comments).
  The dropzone remains visible in the error phase (the render tree already
  supports idle|error) and both paths accept a new selection afterward.
- **The regression tripwire**: the DD3b check now expects the banner text
  ('The selected file is empty.') to be OCR-visible after the empty-file
  selection; it flips to GREEN when this fix ships in the build, and stays a
  hard P2 if it ever regresses.
- **Round-5 harness fixes alongside** (BUG-PD18 continuation): the documents
  scan-view Title/Notes typing (htmlFor-less labels — the same class as the
  settings g2) now types into the field's own line with no Backspace
  (structurally killing the WKWebView back-navigation trap) + a first-run
  recovery; the desktop fixture uploads use the patient-detail path's
  immediate-onchange contract; the clinical CC12/CC15b reopen-verifies find
  the section header from the top (three latent false-P1s also fixed); the
  CC11 trash anchor uses the CC10-proven band.

### BUG-PD20 [P1 PRODUCT, FIXED] DETACHED_UPLOAD_INPUT — wave rounds 4+6 (shard E, DESKTOP_FX_UPLOAD)

- **Class**: P1 — the primary document-upload path was DEAD in the Tauri build.
- **The finding**: patient-detail's 'Upload Files' opened the macOS file
  chooser; the automation drove a real selection (the panel closed on the
  driven full path) — but ZERO upload POSTs ever fired, across two
  independent rounds. The identical chooser drive on the scan view's
  ATTACHED #file-upload input worked flawlessly in the same builds.
- **Root cause** (source-proven): patient-detail.tsx's handleUploadDocument
  created the file input via document.createElement and clicked it WITHOUT
  ever appending it to the DOM — WKWebView opens the picker for the
  detached node but never delivers the FileList to its onchange, so the
  selection was silently dropped (no POST, no toast, no row).
- **The minimal product fix (applied)**: appendChild the input to
  document.body before .click() (display:none) + remove it in the
  onchange's finally — the exact pattern the scan view already uses.
- **Regression proof plan**: shard B's DB12 (Jane's patient-detail upload)
  runs against the OLD build first (expect the same 0-POST behavior =
  independent confirmation), then shard E's fixture upload + the §15
  doctor workflow run against the FIXED build must show the POSTs fire.
- **Round-7 harness fixes alongside**: DB3's gate is now position-tolerant
  (the false 'DB2 did not complete' skip — DB2 was actually GREEN; the
  gate's 'Scan & Upload' grep read a scrolled-away capture) and the DB4
  sweep does per-row section-top restores + 12-burst finds with the
  verdict split (row missing + POST on record = honest D; no POST = the
  genuine P1).

### BUG-PD21 [D HARNESS, FIXED] FX_RX_SCROLL_OVERSHOOT — wave round-8 (run 35252868562, shard E, DESKTOP_FX_RX)

- **Class**: D — harness-only (zero product change).
- **The finding**: shard E's fx4 step red'd [bug-P1]
  DESKTOP_FX_RX "the Prescriptions section was not reachable" — the
  down-sweep's captures showed Visit History (17:40:40) then Clinical
  Notes/Documents (17:40:44) with the Prescriptions section never inside
  any capture, though the section demonstrably rendered: the fx3-open
  captures minutes earlier (17:38:04/06) showed "Prescriptions / New
  Prescription / No prescriptions yet / Create first prescription", and
  the same page's data was intact.
- **Root cause** (log-proven): `v_scroll_find`'s keyboard assist — every
  3rd burst it presses Page Down (key code 121), a FULL-VIEWPORT (~768px)
  jump. A 12-line scroll step (~450px) can never fully skip a section
  (≥318px viewport overlap), but the assist's full-page jump leapt the
  collapsed ~150px Prescriptions section from below-the-fold to
  above-the-fold between two captures.
- **The fix (harness-only, +33/−13)**: `v_scroll_find` gains an optional
  5th parameter `burst-lines` (default 12 = byte-identical historical
  behavior for every existing call site); a FINE sweep (<12 lines/step)
  never uses the keyboard assist. The desktop battery's 9 short-section
  finds (fx4 New Prescription; fx4/de4/de12 medication; de6 Backup &
  Export; de8c/de9 New Prescription; de10 Clinical Notes ×2) now use
  `16 no down 4` — ~150px steps, no full-page jumps.
- **The verdict stands**: the product itself was never red — the E shard
  stops were the harness skipping sections. (Also note for the record:
  run 35252868562's shard E fx3 uploads SUCCEEDED on the fixed build —
  POSTs fired through the real patient-detail chooser — the first live
  BUG-PD20 regression proof.)

### BUG-PD22 [D HARNESS, FIXED] DE_DOC_OPEN_NO_SCROLL — wave round-9 (run 35256165070, shard E, DESKTOP_DE1)

- **Class**: D — harness-only (zero product change).
- **The finding**: the E-rerun (post-PD21) advanced past fx4 to DE1 and red'd
  [bug-P1] DESKTOP_DE1 "the PDF document row could not be opened into the
  viewer" — three consecutive `v_click 'dsk-fixture-doc'` NOT-FOUNDs, with
  no scroll ever attempted between the detail open and the click.
- **Root cause** (log-proven): the detail opens MID-PAGE (the known BUG-PD5
  behavior — the fresh viewport lands at Visit History/Prescriptions, as the
  18:12:15/18 captures show) and the Documents section sits BELOW the fold;
  DE1/DE2/DE6e clicked the document row immediately after the open with no
  scroll-find into view. (Distinct from run-9's DB6 red: there the row WAS
  scrolled to and clicked — the viewer itself failed to render; here the
  click was never even attempted on a visible target.)
- **The fix (harness-only, 3 sites)**: a fine sweep
  `v_scroll_find "$PDF_TITLE" 16 no down 4 || true` precedes each of the
  three document-row opens (de1/de2/de6e). The fine mode (BUG-PD21) keeps
  the row inside consecutive captures.
- **The verdict stands**: the product's document rows render (fx3 verified
  both rows OCR-visible in the same battery); only the harness neglected to
  bring the row into the viewport before clicking.

### BUG-PD23 [P1 PRODUCT, FIXED] VIEW_TRANSITION_STALE_SCROLL — the document-viewer P1 root cause (DE1/DB6, three macOS reds + the DE1i image discrimination)

- **Class**: P1 product — the viewer red was REAL, but its original
  "DocumentViewer does not mount / does not render" reading was FALSE.
- **The finding**: clicking a document row from a deep-scrolled patient
  detail switched the view correctly (store + DOM + the /view fetch all
  prove the DocumentViewer mounted and rendered) — but the viewer's HEADER
  (back button, title, category badge, size, toolbar) never appeared. The
  same red reproduced on old-build B, new-build B, and shard E (PDF), and
  the DE1i discrimination proved the IMAGE branch equally red — a shared
  defect, not the PDF iframe.
- **Root cause (proven in the local production repro, per the directive's
  protocol)**: the WINDOW is the scroll owner for every top-level view
  (main's content grows the body; the `overflow-hidden` on main is inert),
  and no view transition ever reset it. A deep patient-detail scroll
  (~2400px, reaching the Documents section below the fold) carried into the
  document viewer, CLAMPED to the new page's maxScroll (~256px), and opened
  the document BELOW its header — the top ~256px (the py-6 padding + the
  entire header row) sat above the viewport while the canvas content and
  the WKWebView native PDF chrome painted mid-screen. The proof: before the
  click scrollY=2409; after the click scrollY=256 (=maxScroll) with the
  viewer's h1 at y=-89 (above the viewport); `window.scrollTo(0,0)` ALONE
  revealed the fully-functional header (both image and PDF) with the view,
  the content, and the document association all intact — no remount, no
  reload. The macOS evidence matches exactly: the canvas painting at
  y≈130 (above its unscrolled position), the sticky app header intact, the
  white PDF area + native floating toolbar, and the OCR failure on the
  title that sat above the viewport.
- **The fix (product, minimal — the navigation layer, not the store)**:
  one `useEffect` in `src/app/page.tsx` resets the window scroll on every
  `currentView` change (instant — no smooth behavior), covering all five
  top-level transitions (dashboard→patient-detail,
  patient-detail→document-viewer, document-viewer→patient-detail,
  dashboard→settings, dashboard→scan-capture; all verified at scrollY=0
  with the viewer h1 visible at y=88 for BOTH the image and the PDF).
  Plus three stable QA anchors on the DocumentViewer
  (`data-qa=document-viewer/-title/-frame`).
- **Regression coverage**: `tests/pd23-view-scroll-reset.test.ts` (5
  fail-closed static assertions: the reset exists + is keyed on currentView
  + is instant + lives in page.tsx NOT the store + the QA anchors + the
  unchanged selectDocument contract).
- **Disproven along the way (kept for the record)**: the WKWebView
  iframe-PDF layer theory (the image branch red too), the service-worker
  controllerchange/reload theory (no page reload — the API log is silent
  after the click; the post-click `/sw.js` fetch is the spec-compliant
  soft-update triggered by the in-scope iframe navigation, byte-identical
  SW → no controllerchange), and the viewer-mount/state theory (the viewer
  mounted and rendered correctly the whole time). The pdf.js canvas rewrite
  was prepared but never committed — reverted in full per the directive.
- **The historical viewer RED evidence STANDS** (run-9 DB6 old-build, run
  35170397410-family new-build B, runs 35256165070/35258613892 shard E,
  and run 35324944270 DE1i) — reclassified from "viewer does not open"
  to "viewer opened below its header (stale scroll)".

### BUG-PD25 [D HARNESS, FIXED] DETAIL_PROOF_STALE_TOP_OPEN — the PD23 top-open vs the detail-open needle
- **Class**: D (harness) — the product behaved CORRECTLY (better than before); the proof needle was stale
- **Where**: `macos/scripts/exploratory-qa.sh` → `detail_open_proof()` (the gate that ends every `open_patient_by_phone_token` success path + the dd13 View probe)
- **First red**: run 35338695096 (shard E, 2026-09-18 11:28Z) — `[bug-P1] DESKTOP_DE1_IMAGE "could not open Print Docutest's detail for the image-viewer check"` — a FALSE P1
- **Root cause**: the PD23 scroll-reset fix (038ae05, in-DMG since `6e6a80fc…`) opens the patient detail at the TOP — the identity card (avatar/name/phone/email/notes/stats) fills the first screen and the detail section markers (`Visit History`/`Prescriptions`/`Clinical Notes`) sit BELOW the fold. `detail_open_proof` required a marker IN VIEW within 5×2s of in-place OCR retries — the pre-PD23 mid-page landing (BUG-PD5) had put them in view for free. The gate timed out on a perfectly-opened detail (VLM-verified evidence: detail top visible, search bar GONE, page cut off mid-stats — the probe's failure wording "the list search bar is still present" was misleading: the actual miss was the absent marker, the search-bar check passed).
- **Side proof**: this false red is itself macOS evidence that the PD23 fix works on the real build — the detail now opens at the TOP (the BUG-PD5 mid-page landing is gone)
- **Exposure**: every `open_patient_by_phone_token` caller — the E shard de1i (first red), the running B shard (documents), the dd13-view probe, AND the source patients battery (pc8/PV/PE opens) — all share this needle
- **Fix**: when the list is proven GONE (the `Search patients` absent gate — unchanged, still binds FIRST), spend ONE bounded sweep (`v_scroll_find` down, 8 bursts) looking for a detail-only section marker before failing. A list/query-box state never reaches the sweep (the strong gate), and a dashboard has no section markers (no false positive). Position-safety audited: every position-dependent caller restores its own position first (`v_click_edit_pencil` and `scan_detail_multi` scroll up; the document-row lookups scroll down)
- **Workflow enablers (same commit)**: the parallel wave's prep matrix gained an opt-in `P` shard (the definitive patients regression against the SAME frozen DMG — NO rebuild, directive 2026-09-18 §13; inert in the default A–E filter) and the shard timeout 150→240 (the patients battery measures ~175-185 min; a cap, not a runtime)
- **Evidence preserved**: the 35338695096 E-shard artifact (fx1/fx2/fx3 all GREEN before the false red) stands as the D-class analysis record; the E+B rerun reuses the same immutable DMG

### BUG-PD26 [P2 PRODUCT, FIXED] DESKTOP_EXPORT_CSV — the Export CSV webview navigation (no file, the app replaced by raw data)
- **Class**: P2 — first-red of the rerun-E wave (run 35341388397, de6, 12:14:57Z) — only reachable after the PD23 viewer fix let the desktop battery proceed past the viewer opens
- **Where**: `src/components/dashboard.tsx` — the dashboard's Export CSV button
- **Detail**: the click NAVIGATED the webview away from the app: the OCR shows the raw CSV (headers + both fixture patients' rows) rendered IN the MediVault window, no file landed in ~/Downloads, and the battery had to recover
- **Root cause**: the button navigated the webview top-level to the '/api/patients/export' attachment endpoint. The API route itself is correct (Content-Type text/csv + Content-Disposition attachment + filename) — but macOS WKWebView (Tauri) does not turn that navigation into a file save in this app; it renders the CSV inline, replacing the SPA. (An initial suspicion of a corrupted route line was a terminal-display artifact — `od -c` proved the source correct)
- **Fix**: the button now uses the viewer Download button's proven pattern — fetch with credentials -> blob -> object URL -> `<a download>` click -> revoke — which WKWebView handles as a real file save. The analytics-dashboard's Export CSV was already the separate, correct client-side path (unaffected)
- **Regression coverage**: `tests/pd26-export-csv-download.test.ts` (7 fail-closed static assertions: the handler wiring, NO webview-navigation-to-export remains anywhere in the component, credentials-include fetch, the blob+anchor pattern, both toasts, the route's attachment disposition, the analytics button untouched)
- **Related (documented, NOT this fix — the next round's product work)**: the print family — the viewer Print handler (`window.open(viewUrl,'_blank')` + `.print()`) and the report Print buttons (`window.print()`) are inoperative in WKWebView/Tauri (the E-shard ENV records: no native sheet ever appears), and the rerun-B late-battery degradation (an icon-band click sequence in the viewer flipped the app to the in-app login→setup state at ~13:02Z, leaving DB9-DB17 unexercised as honest D-records) correlates with this same desktop-integration family. The exact trigger icon is not identifiable from the preserved evidence (blind icon-band clicking; no backend API log in that artifact). The next round should design a real macOS print path (e.g., handing the document to the OS via the opener plugin) and reproduce/fix the state flip

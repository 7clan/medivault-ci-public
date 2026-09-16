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

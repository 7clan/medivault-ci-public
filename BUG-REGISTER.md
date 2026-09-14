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

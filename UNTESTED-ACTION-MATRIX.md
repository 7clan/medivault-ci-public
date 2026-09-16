# UNTESTED-ACTION-MATRIX — MediVault Parallel Completion Wave

AUTHORITATIVE HEADS (frozen for this matrix):
- PRIVATE: `afc96c51cdf687eaa7ff0c6bf62ae0508891d27a` (7clan/medivault @ platform/macos)
- PUBLIC:  `97f44a9307b1906cbdcede0902b0c30fb0fc5141` (7clan/medivault-ci-public)
- Derived 100% from current source (4 parallel read-only source audits, 2026-09-16). Existence ≠ functional proof.

COLUMNS: SURFACE | CONTROL | SOURCE | EXPECTED ACTION | PREVIOUSLY PROVEN? | EVIDENCE RUN | FROZEN? | REMAINING TEST SHARD | RESULT

CLASSIFICATIONS (final gate — every row must end as exactly one):
GREEN / RED / NOT IMPLEMENTED / ENV / EXPECTED / DEFERRED-PHYSICAL-HARDWARE
Result values now: PENDING (untested), FROZEN-GREEN (proven, do-not-rerun), PARTIAL (proved as side-effect of another battery).

FROZEN CONTRACT LEDGER (directive §1 — do not rerun; reopen only on NEW regression proof):
install/first-run bootstrap · SMAppService · API loopback (127.0.0.1:3001) · PG loopback (127.0.0.1:55432) ·
account creation · login/logout · wrong-password/wrong-email · session restoration (incl. 401→refresh→retry, P1 fix frozen) ·
identity consistency · surface existence inventory (run 34864029026) · patients battery once run 35121130113 is GREEN ·
Model A localhost security (per-run SECURITY_REGRESSION gate) · macOS packaging/signing/reinstall.

---

## §0 FROZEN / PREVIOUSLY-PROVEN CONTROLS (compact rows)

| SURFACE | CONTROL | SOURCE | EXPECTED ACTION | PREV PROVEN? | EVIDENCE RUN | FROZEN? | SHARD | RESULT |
|---|---|---|---|---|---|---|---|---|
| first-run-onboarding | Set up MediVault / Check again / Open Login Items / I've approved it / Try again ×2 / Open MediVault | first-run-onboarding.tsx:231-387 | SMAppService register / status re-query / open System Settings / refresh / health hand-off | YES | every run gateways 3-5 | YES | — | FROZEN-GREEN |
| setup-form | 5 SU validation probes (empty/weak/mismatch/boundary/invalid-email) + Create Account & Start | setup-form.tsx:90-574 | client checks then POST /api/auth/setup + auto-login | YES | account 34885186221 (SU1-SU5 + GATEWAY 6) | YES | — | FROZEN-GREEN |
| login-form | Email / Password / eye toggle / Sign In | login-form.tsx:231-349 | POST /api/auth/login → /api/auth/me → dashboard | YES | account 34885186221 (A1-A5b) | YES | — | FROZEN-GREEN |
| login-form | Set Up Your Account button | login-form.tsx:370-372 | → setup view; duplicate-setup server 409 | YES | A9 | 34885186221 | YES | — | FROZEN-GREEN |
| auth-lifecycle | Sign Out (header icon + profile menu) / logout state-leak / repeated logout-login / quit-reopen session restore | app-header.tsx:252-269 | POST /api/auth/logout; no content after logout; session restores | YES | A2/A2b/A6/A6b/A7/A7b | 34885186221 | YES | — | FROZEN-GREEN |
| patients-battery | PC0-PC10, PI ×9 isolation scans, PE1-PE7, PV1-PV8, PDEL1-3, NV1-NV7, PP | exploratory-qa.sh focus_patients | full patient CRUD/isolation/edit/entry-points/delete/navigation/persistence | PARTIAL (runs 10-22 cumulative; run 23 = definitive) | 35121130113 IN FLIGHT | PENDING-GREEN | — | FROZEN after run 23 GREEN |
| add/edit-patient dialogs | all 18 form fields + Cancel/Save/Add buttons | add/edit-patient-dialog.tsx | create/edit patient (incl. state-reset regression PC0 probe) | YES | patients runs 10-22 | after run 23 | YES | — | FROZEN-GREEN |
| patient-detail | back arrow / Edit Patient / Delete Patient (dialog cancel+confirm) / banner identity | patient-detail.tsx:524-592,1231-1239 | nav + edit dialog + cascade delete (Zed deleted, count 9) | YES | runs 18-23 | after run 23 | YES | — | FROZEN-GREEN |
| surface-map | existence of every surface below | FULL-PRODUCT-SURFACE-MAP.md | rows reconciled live | YES (existence only) | 34864029026 | YES (existence) | functional proof in shards | PARTIAL |

---

## §A SHARD A — SEARCH + SETTINGS + BASIC PERSISTENCE

| SURFACE | CONTROL | SOURCE | EXPECTED ACTION | PREV PROVEN? | EVIDENCE RUN | FROZEN? | SHARD | RESULT |
|---|---|---|---|---|---|---|---|---|
| dashboard-search | search input (debounced 300ms → GET /api/patients?search=) | dashboard.tsx:590-601 | results counter updates; case/partial/Unicode/Arabic/phone/email/empty/no-result/rapid-change/edited-data (q1-q10 battery designed, never dispatched) | NO (design exists) | — | NO | A | PENDING |
| dashboard-search | Clear-search X button | dashboard.tsx:604-614 | clears query → unfiltered list (q8) | NO | — | NO | A | PENDING |
| dashboard-search | search case-sensitivity HYPOTHESIS | routes/patients (contains, no mode:'insensitive') | q2/q3 prove or refute the P2 candidate | NO | — | NO | A | PENDING |
| quick-patient-switcher | search input (client-side filter) | quick-patient-switcher.tsx:244-252 | filters fetched 200 by name/phone/email (q9) | NO | — | NO | A | PENDING |
| quick-patient-switcher | ArrowDown/ArrowUp/Enter/ESC in dialog | quick-patient-switcher.tsx:148-168 | keyboard selection + close | NO | — | NO | A | PENDING |
| quick-patient-switcher | patient row click + Recently Viewed section + footer count | quick-patient-switcher.tsx:186-307,343 | selectPatient → detail; count correct | PARTIAL (row click via PV5) | patients runs | NO | A | PENDING |
| settings-view | Edit Profile (focus shortcut) | settings-view.tsx:166-175 | focuses name input | NO | — | NO | A | PENDING |
| settings-view | Display Name input + Save | settings-view.tsx:183-199 | 500ms fake persist → setDoctorInfo store ONLY; toast "Profile Updated" | NO | — | NO | A | PENDING |
| settings-view | Display Name persistence (quit/reopen → reverts) | settings-view.tsx:105-112 | g6: memory-only (P3 record; EXPECTED) | NO | — | NO | A | PENDING |
| settings-view | Light / Dark buttons + preview cards ×2 | settings-view.tsx:234-290 | setTheme; preview applies | NO | — | NO | A | PENDING |
| settings-view | theme persistence across quit/reopen | next-themes via settings + header | g3 + h-series: theme survives restart | NO | — | NO | A | PENDING |
| settings-view | Storage & Statistics correctness | settings-view.tsx:301-389 (GET /api/stats) | counts match controlled fixtures | NO | — | NO | A | PENDING |
| settings-view | Download Complete Backup (ZIP) button | settings-view.tsx:418-443 → GET /api/backup | ZIP blob download + toast (g7; content validation in Shard D/E) | NO | — | NO | A (button) / D+E (content) | PENDING |
| settings-view | Windows/Desktop + iOS/Android install controls | settings-view.tsx:536-576 | deferredPrompt or instruction toast (g5: inert P3 record) | NO | — | NO | A | PENDING |
| settings-view | Danger Zone: Reset → Cancel / Confirm Reset | settings-view.tsx:780-772 | **FEATURE PLACEHOLDER** toast only, NO deletion (g4; directive §3 NOTE — not a product failure) | NO | — | NO | A | PENDING |
| login-form | Remember me checkbox | login-form.tsx:279-298 | value never consumed (EXPECTED record) | NO | — | NO | A | PENDING |
| login-form | Forgot password? link | login-form.tsx:299-307 | no-op preventDefault (P3 recorded A3b) | YES (recorded) | 34885186221 | recorded | A (re-confirm) | EXPECTED |
| login-form | Terms of Service / Privacy Policy links | login-form.tsx:355,359 | href="#" dead links (record EXPECTED) | NO | — | NO | A | PENDING |
| app-persistence | logout/login cycle (minimal fixture) | app-header | auth frozen; only fixture re-use | YES | 34885186221 | partial | A (fixture only) | FROZEN-GREEN |
| app-persistence | quit → supervisor/API/PG health → relaunch → session + state | h-series | patients A/B/C + edited phone + note survive (QUIT_REOPEN, PATIENT_PERSISTENCE) | NO (designed) | — | NO | A | PENDING |
| app-persistence | Recently Viewed chips survive restart (localStorage) | recently-viewed.tsx + h-series | RECENTLY_VIEWED_PERSIST | NO | — | NO | A | PENDING |

---

## §B SHARD B — DOCUMENTS + SCAN + FILE MANAGEMENT

| SURFACE | CONTROL | SOURCE | EXPECTED ACTION | PREV PROVEN? | EVIDENCE RUN | FROZEN? | SHARD | RESULT |
|---|---|---|---|---|---|---|---|---|
| scan-capture | Back arrow | scan-capture.tsx:220 | stopCamera + goBack | NO | — | NO | B | PENDING |
| scan-capture | Select Patient select (patient-scoped vs pre-targeted) | scan-capture.tsx:243-245 | loads /api/patients?limit=100; scan-target preselect from patient-detail | NO | — | NO | B | PENDING |
| scan-capture | Open Camera | scan-capture.tsx:270-280 (getUserMedia env/user, 1920×1080) | real camera or honest permission/error path; **runner has no camera device → CAMERA HARDWARE = ENV; do not fake** | NO | — | NO | B (software path) | PENDING |
| scan-capture | Switch Camera / Close camera | scan-capture.tsx:259,262 | facingMode toggle / stop tracks | NO | — | NO | B (if reachable; else ENV) | PENDING |
| scan-capture | Shutter + Capture Document | scan-capture.tsx:300-307 | JPEG capture 0.95 → staged file + localStorage recently-scanned | NO | — | NO | B (ENV if no device) | PENDING |
| scan-capture | Drop zone (drag/drop real WebView) + click-to-browse | scan-capture.tsx:333-341 | file staging, 50 MiB client check | NO | — | NO | B | PENDING |
| scan-capture | Hidden file input (accept .pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.tiff,.tif; multiple) | scan-capture.tsx:342 | real macOS file chooser; auto-title from filename | NO | — | NO | B | PENDING |
| scan-capture | Remove staged file (X per row) | scan-capture.tsx:353 | removeFile — note: captured pages NOT removable (record) | NO | — | NO | B | PENDING |
| scan-capture | Title input / Category select (9 categories) / Notes textarea | scan-capture.tsx:367-369 | metadata for upload | NO | — | NO | B | PENDING |
| scan-capture | Upload N Document(s) | scan-capture.tsx:375-377 | per-file POST /api/patients/:id/documents multipart; success/partial/cancel paths | NO | — | NO | B | PENDING |
| upload-formats | FORMAT MATRIX: PDF/PNG/JPEG/WEBP/BMP/TIFF/HEIC-if-constructible; TXT only if supported | scan-capture.tsx accept list; patient-detail.tsx:446-482 | upload+viewer+download+print support per format (UPLOAD/VIEWER/DOWNLOAD/PRINT SUPPORTED distinction) | NO | — | NO | B | PENDING |
| upload-formats | Unicode filename / Arabic filename / spaces / apostrophe / very long / same-name-diff-bytes / zero-byte / corrupt PDF / corrupt image / unsupported ext / just-below-50MiB / above-50MiB | client 50 MiB checks (scan-capture.tsx:147,168; patient-detail.tsx:456) | accept or honest reject toast; **server multipart cap is 500MB (plugins/multipart.ts:21) — 50 MiB is client-only (record P3 security note)** | NO | — | NO | B | PENDING |
| patient-detail-docs | Upload Files (hidden multi-file input) | patient-detail.tsx:846-851,446-482 | same upload contract from detail context | NO | — | NO | B | PENDING |
| patient-detail-docs | Scan with Camera button | patient-detail.tsx:852-857 | pre-targeted scan-capture | NO | — | NO | B | PENDING |
| patient-detail-docs | Select → row checkboxes → batch bar (Close/Select All/Export ZIP/Delete N) | patient-detail.tsx:866-874,1296-1354 | JSZip client export of selected docs; batch delete dialogs | NO | — | NO | B | PENDING |
| patient-detail-docs | Category filter pills + Sort select (6 orders) | patient-detail.tsx:886-946 | client-side filter/sort | NO | — | NO | B | PENDING |
| patient-detail-docs | Document row open (viewer nav) + thumbnail render | patient-detail.tsx:1067-1119 | selectDocument → viewer; thumbs via /view endpoint | NO | — | NO | B | PENDING |
| patient-detail-docs | Per-row Edit Document (dialog) | patient-detail.tsx:1122-1130 → edit-document-dialog.tsx | PUT /api/documents/:id (title/category/notes only) | NO | — | NO | B | PENDING |
| patient-detail-docs | Per-row Download | patient-detail.tsx:1131-1139 | GET /api/documents/:id blob → file; **SHA-256 vs source** | NO | — | NO | B | PENDING |
| patient-detail-docs | Per-row Delete (confirm dialog Cancel/Delete) | patient-detail.tsx:1140-1153,1179-1187 | DELETE (soft + deferred purge); no stale preview; persistence after reopen | NO | — | NO | B | PENDING |
| patient-detail-docs | Empty-state Upload/Scan CTAs | patient-detail.tsx:986-997 | same flows | NO | — | NO | B | PENDING |
| edit-document-dialog | Title / Category / Notes / Cancel / Save Changes | edit-document-dialog.tsx:35-123 | metadata update + toast | NO | — | NO | B | PENDING |
| document-isolation | John/Jane/Muhammad unique files; wrong-patient content = P0 STOP | upload/list/scan paths | doc lists + viewer + downloads show only owning patient's files | NO | — | NO | B | PENDING |
| document-viewer | Back / patient name chip (back-to-patient) | document-viewer.tsx:177,186-189 | nav; sparse-patient selectPatient path | NO | — | NO | B | PENDING |
| document-viewer | Zoom In / Zoom Out / Reset | document-viewer.tsx:196-201,112-117 | 0.25-3.0 steps; **PDF zoom is a no-op (transform on <img> only) — EXPECTED record** | NO | — | NO | B | PENDING |
| document-viewer | Download icon | document-viewer.tsx:202,119 | blob download; hash verify | NO | — | NO | B | PENDING |
| document-viewer | Print icon | document-viewer.tsx:203,120 | window.open(/view) + printWindow.print() → Shard E native print contract | NO | — | NO | B/E | PENDING |
| document-viewer | Fullscreen enter/exit (component overlay, NOT Fullscreen API) | document-viewer.tsx:204,124 | overlay mode switch | NO | — | NO | B | PENDING |
| document-viewer | Info panel (fullscreen only) | document-viewer.tsx:121,133-172 | name/category/size/scanned/patient | NO | — | NO | B | PENDING |
| document-viewer | Annotations panel (fullscreen only) | document-viewer.tsx:123,279-297 | opens DocumentAnnotations | NO | — | NO | B | PENDING |
| document-annotations | annotation input + Add | document-annotations.tsx:85-172 | POST (content, x=0,y=0,page=1 hardcoded — **text comments, not spatial: EXPECTED record**) | NO | — | NO | B | PENDING |
| document-annotations | 6 color presets | document-annotations.tsx:175-183 | color selection | NO | — | NO | B | PENDING |
| document-annotations | inline edit (Enter/Esc) + confirm/cancel + Pencil | document-annotations.tsx:211-222 | PUT /api/annotations/:id | NO | — | NO | B | PENDING |
| document-annotations | delete arm + confirm/cancel + Trash | document-annotations.tsx:225-229 | DELETE /api/annotations/:id (credentials omission noted — functional proof decides) | NO | — | NO | B | PENDING |
| document-annotations | persistence across quit/reopen | server-side store | annotations survive restart | NO | — | NO | B | PENDING |
| recent-docs | Dashboard Recent Documents cards → correct patient + doc | dashboard.tsx:1028-1033 | no stale/wrong-patient object | NO | — | NO | B/D | PENDING |

---

## §C SHARD C — CLINICAL WORKFLOW (VISITS + NOTES + PRESCRIPTIONS + REPORTS)

| SURFACE | CONTROL | SOURCE | EXPECTED ACTION | PREV PROVEN? | EVIDENCE RUN | FROZEN? | SHARD | RESULT |
|---|---|---|---|---|---|---|---|---|
| patient-detail | New Prescription / Create first prescription | patient-detail.tsx:778-808 | opens PrescriptionGenerator (with/without visitId) | NO | — | NO | C | PENDING |
| patient-detail | Generate Report icon | patient-detail.tsx:566-574 | opens PatientSummaryReport | NO | — | NO | C | PENDING |
| patient-detail | Timeline toggle (+count badge) | patient-detail.tsx:723-741 | shows PatientTimeline card | NO | — | NO | C | PENDING |
| patient-detail | Add patient details link (sparse record) | patient-detail.tsx:694-697 | opens Edit dialog | NO | — | NO | C | PENDING |
| visit-scheduler | Patient select (when unscoped) | visit-scheduler.tsx:230-241 | /api/patients?limit=100 | NO | — | NO | C | PENDING |
| visit-scheduler | Visit Date popover + Calendar | visit-scheduler.tsx:262-281 | pick date (**shadcn-select automation D known — PV6-8 family; harness must solve or record NOT-EXERCISED honestly**) | NO | — | NO | C | PENDING |
| visit-scheduler | Time select (08:00-20:30 ×30min) | visit-scheduler.tsx:288-299 | slot selection | NO | — | NO | C | PENDING |
| visit-scheduler | Visit Type ×5 icon cards | visit-scheduler.tsx:304-335 | Checkup/Follow-up/Consultation/Emergency/Procedure | NO | — | NO | C | PENDING |
| visit-scheduler | Chief Complaint / Diagnosis / Prescription (legacy free-text) / Follow-up fields / Additional Notes | visit-scheduler.tsx:340-449 | textareas (legacy prescription field = EXPECTED record) | NO | — | NO | C | PENDING |
| visit-scheduler | Status pills ×4 (edit mode only) | visit-scheduler.tsx:352-370 | scheduled/completed/cancelled/no-show | NO | — | NO | C | PENDING |
| visit-scheduler | Cancel / Schedule Visit / Save Changes | visit-scheduler.tsx:454-464 | POST/PUT /api/visits; validation toasts | NO | — | NO | C | PENDING |
| visit-history | Schedule Visit (header + empty-state) | visit-history.tsx:197-229 | opens scheduler | NO | — | NO | C | PENDING |
| visit-history | expand chevron / Edit / Delete per visit | visit-history.tsx:311-334 | edit opens prefilled scheduler; delete → confirm dialog | NO | — | NO | C | PENDING |
| visit-history | Mark Complete / Cancel Visit | visit-history.tsx:390-407 | PUT status completed/cancelled + toast | NO | — | NO | C | PENDING |
| visit-history | Create Prescription (from scheduled/completed visit) | visit-history.tsx:408-442 | opens generator with visitId | NO | — | NO | C | PENDING |
| visit-history | Schedule Follow-up (completed visit, prefilled complaint) | visit-history.tsx:423-431 | scheduler prefilled "Follow-up for {type} on {date}" | NO | — | NO | C | PENDING |
| visit-history | delete-visit dialog Cancel/Delete | visit-history.tsx:483-487 | DELETE /api/visits/:id | NO | — | NO | C | PENDING |
| visit-history | quit/reopen persistence | GET /api/patients/:id/visits | visits survive restart; linked to exact patient | NO | — | NO | C | PENDING |
| clinical-notes | Add Note (header + empty state) + close X | clinical-notes.tsx:400-408,308-315,240-247 | quick-add form | NO | — | NO | C | PENDING |
| clinical-notes | title / category (6) / content fields | clinical-notes.tsx:250-272 | form state | NO | — | NO | C | PENDING |
| clinical-notes | Cancel / Add Note submit | clinical-notes.tsx:274-289 | POST /api/notes (patientId scoped) | NO | — | NO | C | PENDING |
| clinical-notes | long note / Unicode / Arabic content | POST /api/notes | content round-trip | NO | — | NO | C | PENDING |
| clinical-notes | Pin/Unpin per note | clinical-notes.tsx:487-501 | PUT {isPinned}; pinned render first | NO | — | NO | C | PENDING |
| clinical-notes | expand / inline edit (title/category/content, Enter/Esc, confirm/cancel) | clinical-notes.tsx:505-604 | PUT /api/notes/:id | NO | — | NO | C | PENDING |
| clinical-notes | Delete (confirm dialog) | clinical-notes.tsx:388-392,545-552 | DELETE /api/notes/:id | NO | — | NO | C | PENDING |
| clinical-notes | patient isolation + persistence | GET /api/notes?patientId | only intended patient's notes; survive reopen | NO | — | NO | C | PENDING |
| prescription-generator | Quick Templates collapse toggle | prescription-generator.tsx:415-430 | expand/collapse strip | NO | — | NO | C | PENDING |
| prescription-generator | template search + clear X | prescription-generator.tsx:445-459 | name/category/dosage substring filter | NO | — | NO | C | PENDING |
| prescription-generator | category pills: All + 6 categories | prescription-generator.tsx:464-496 | filter 8 templates | NO | — | NO | C | PENDING |
| prescription-generator | 8 template cards (Amoxicillin/Ibuprofen/Metformin/Lisinopril/Omeprazole/Paracetamol/Azithromycin/Losartan) | prescription-generator.tsx:507-549 | fill first empty med row + toast | NO | — | NO | C | PENDING |
| prescription-generator | per-med: name/dosage/frequency(8)/duration(9)/instructions + remove (blocked at 1 row) | prescription-generator.tsx:593-667 | row CRUD | NO | — | NO | C | PENDING |
| prescription-generator | Add Medication | prescription-generator.tsx:659-667 | append row | NO | — | NO | C | PENDING |
| prescription-generator | Notes textarea / Cancel / Create Prescription | prescription-generator.tsx:675-704 | POST /api/prescriptions; empty-med validation toast | NO | — | NO | C | PENDING |
| prescription-generator | reopen persistence + patient-only attachment | GET /api/prescriptions?patientId | rx survives; foreign patient has none (P0 gate) | NO | — | NO | C | PENDING |
| prescription-card | expand / Print / Mark Complete / Discontinue / Delete | prescription-card.tsx:163-213 | PUT status; DELETE immediate **no confirmation — EXPECTED record (P3 candidate)** | NO | — | NO | C | PENDING |
| prescription-print | Close / Print | prescription-print.tsx:512-522 | window.open + document.write + onload print (→ Shard E native contract) | NO | — | NO | C/E | PENDING |
| patient-summary-report | Print Report | patient-summary-report.tsx:150-153 | window.print() (→ E) | NO | — | NO | C/E | PENDING |
| patient-summary-report | Download as PDF | patient-summary-report.tsx:154-157 | **identical window.print() — NO PDF pipeline: EXPECTED record (label overstates)** | NO | — | NO | C/E | PENDING |
| patient-summary-report | report content integrity (POST /api/reports) | misc/index.ts:285-386 | demographics + doc/visit/rx/note counts + recent activity; belongs to EXACT patient (foreign data = P0) | NO | — | NO | C | PENDING |

---

## §D SHARD D — DATA IO + BACKUP + DASHBOARD + ANALYTICS + NOTIFICATIONS + GLOBAL ACTIONS

| SURFACE | CONTROL | SOURCE | EXPECTED ACTION | PREV PROVEN? | EVIDENCE RUN | FROZEN? | SHARD | RESULT |
|---|---|---|---|---|---|---|---|---|
| import-csv | Download CSV template | import-patients-dialog.tsx:160-174 | client Blob → medivault-patient-template.csv; file exists + headers parse | NO | — | NO | D | PENDING |
| import-csv | file picker + drag/drop CSV + Remove file | import-patients-dialog.tsx:316-398 | .csv-only + 10MB client validation + honest error toasts | NO | — | NO | D | PENDING |
| import-csv | Import Patients submit (simulated progress — EXPECTED cosmetic) | import-patients-dialog.tsx:176-259 | POST /api/patients/import; imported/skipped/errors result panel | NO | — | NO | D | PENDING |
| import-csv | Import Another / Done / Cancel (blocked while uploading) | import-patients-dialog.tsx:629-672 | reset states | NO | — | NO | D | PENDING |
| import-csv | CASES: valid / Unicode / Arabic / quoted-comma / quoted-newline / optional-fields / duplicate rows / missing-field / extra-column / bad-date / malformed / empty file / wrong extension / >10MB | server parser patients/index.ts:361-450 | per-case imported/skipped/error counts; no existing-record corruption | NO | — | NO | D | PENDING |
| export-csv | Dashboard Export CSV | dashboard.tsx:440-449 | window.location=/api/patients/export; file exists, parses, expected rows, Unicode, correct quoting, NO credentials/tokens | NO | — | NO | D | PENDING |
| backup | Download Complete Backup ZIP (settings + header icon) | app-header.tsx:62-80 + GET /api/backup | ZIP exists, structurally valid, extracts, manifest.json + decrypted doc payload present, **no runtime secrets / tokens / build-machine files**; no restore UI → RESTORE = NOT IMPLEMENTED (UI; API endpoints exist unused) | NO | — | NO | D | PENDING |
| dashboard-counts | patients/documents/storage/recent-uploads stats cards + category breakdown + StatsCharts | dashboard.tsx:498-575 (GET /api/stats) | counts react correctly to controlled mutations | NO | — | NO | D | PENDING |
| dashboard-widgets | Today's Overview (next appointment panel, Schedule Visit, Add Patient, live badges) | todays-overview.tsx:275-332 | panel navigates to patient; buttons open dialogs | NO | — | NO | D | PENDING |
| dashboard-widgets | Upcoming Visits card → patient detail linkage | dashboard.tsx:675-734 | card click → correct patient | NO | — | NO | D | PENDING |
| dashboard-widgets | Recent Patients list rows | dashboard.tsx:915-917 | correct patients, correct order | NO | — | NO | D | PENDING |
| dashboard-widgets | Activity Timeline event cards | activity-timeline.tsx:102-105 | correct patient/doc; **fabricates sparse patient object (source note) — verify no wrong-patient render** | NO | — | NO | D | PENDING |
| dashboard-widgets | Welcome banner (4 dots, contextual action, Next tip, Dismiss; localStorage permanent) | welcome-banner.tsx:201-277 | carousel + dismiss persists; **tip-3 'Upload Existing Files' opens Add Patient (mismatch record)** | NO | — | NO | D | PENDING |
| dashboard-widgets | patient card Call/Email icon buttons | dashboard.tsx:970-987 | **stopPropagation no-ops (no tel:/mailto:) — EXPECTED record** | NO | — | NO | D | PENDING |
| dashboard-widgets | patient card View icon + Get Started | dashboard.tsx:886-996 | selectPatient nav | PARTIAL (nav via other entries) | patients runs | NO | D | PENDING |
| analytics | toggle open (and closes Calendar) | dashboard.tsx:396-409 | panel render | PARTIAL (surface S) | 34864029026 | NO | D | PENDING |
| analytics | period ×3 (12months/6months/30days) | analytics-dashboard.tsx:323-335 | GET /api/stats?period= refetch | NO | — | NO | D | PENDING |
| analytics | 5 charts (Patient Growth area, Documents bar, Categories pie, Storage area, 28-day heatmap) | analytics-dashboard.tsx:352-564 | values react sanely to fixtures | NO | — | NO | D | PENDING |
| analytics | Export CSV (analytics) | analytics-dashboard.tsx:275-284 | **4 client-side blob CSVs** (patients/documents/category/storage-by-month) — files exist + parse | NO | — | NO | D | PENDING |
| calendar | toggle open (and closes Analytics) | dashboard.tsx:410-423 | panel render | PARTIAL (surface S) | 34864029026 | NO | D | PENDING |
| calendar | Month/Week mode toggle | appointment-calendar.tsx:454-477 | mode switch | NO | — | NO | D | PENDING |
| calendar | Prev / Today / Next | appointment-calendar.tsx:484-492,303-331 | navigation + today reset | NO | — | NO | D | PENDING |
| calendar | month day cells (42; clickable only with visits) + day popover visit list → patient | appointment-calendar.tsx:713-775,1004-1017 | visit entries correct | NO | — | NO | D | PENDING |
| calendar | day-popover quick actions (Complete/Cancel/Patient→) + Visit Actions dialog ×3 buttons | appointment-calendar.tsx:1058-1091,600-631 | status PUT + nav | NO | — | NO | D | PENDING |
| calendar | week view blocks: left-click → patient; **right-click → actions dialog (undocumented affordance)** | appointment-calendar.tsx:907-939 | both paths work | NO | — | NO | D | PENDING |
| notifications | bell open/close + unread badge | notification-center.tsx:145-162 | dropdown; localStorage only | NO | — | NO | D | PENDING |
| notifications | Mark all read / trash clear-all | notification-center.tsx:187-205 | state updates; empty/non-empty behavior; rows are non-clickable (EXPECTED record) | NO | — | NO | D | PENDING |
| fab | Quick Actions FAB (mobile-only md:hidden): open/close + Add Patient + Scan + Quick Upload | quick-actions-fab.tsx:11-42,79-174 | **desktop window → unreachable = ENV; Quick Upload is a dead-end handler (dashboard.tsx:225-231 discards files) — record** | NO | — | NO | D (ENV) | PENDING |
| mobile-nav | bottom tabs (mobile-only) | mobile-bottom-nav.tsx:13-19 | ENV on desktop runner (Patients/Upload duplicate destinations — record) | NO | — | NO | D (ENV) | PENDING |
| pwa-prompt | Dismiss / Install / Not now (beforeinstallprompt-gated) | pwa-install-prompt.tsx:49-140 | **never fires in Tauri WKWebView = ENV/EXPECTED** | NO | — | NO | D (ENV) | PENDING |
| header | logo → dashboard / Dashboard nav / Settings nav | app-header.tsx:97-141 | view switch | PARTIAL (surface S + patients runs used Settings nav) | 34864029026 | NO | D | PENDING |
| header | Switch Patient icon (Ctrl+P) / bell / theme toggle / Download Backup icon / profile pill + dropdown / Sign Out ×2 / hamburger + mobile menu | app-header.tsx:153-372 | each control functional; click-outside closes; backup icon downloads | PARTIAL (Sign Out frozen; existence proven) | account run | NO | D | PENDING |
| keyboard | Cmd+N (add patient, dashboard-only) | use-keyboard-shortcuts.ts:20-31 | opens dialog via event | NO | — | NO | D | PENDING |
| keyboard | Cmd+D (scan view) | use-keyboard-shortcuts.ts:33-42 | view switch | NO | — | NO | D | PENDING |
| keyboard | Cmd+P (switcher) | use-keyboard-shortcuts.ts:44-52 | opens switcher | YES | patients PV5 | — | D (re-verify in sweep) | PARTIAL |
| keyboard | Cmd+F / Cmd+K (focus search) | use-keyboard-shortcuts.ts:54-80 | focus search input | NO | — | NO | D | PENDING |
| keyboard | Cmd+B (go back) | use-keyboard-shortcuts.ts:82-90 | view-history back | NO | — | NO | D | PENDING |
| keyboard | Escape (dispatches medivault:close-dialogs — **DEAD EVENT, zero listeners; Radix dialogs close natively; non-Radix dropdowns don't: EXPECTED record**) | use-keyboard-shortcuts.ts:92-100 | record actual behavior per surface | PARTIAL (Radix Esc via PC0) | patients runs | NO | D | PENDING |
| keyboard | Shift+? (shortcuts dialog) | use-keyboard-shortcuts.ts:102-110 + page.tsx:360-366 | dialog opens (list itself is static — EXPECTED) | PARTIAL (surface S) | 34864029026 | NO | D | PENDING |

---

## §E SHARD E — macOS SAVE / PRINT / DESKTOP INTEGRATION + ERROR/RECOVERY

| SURFACE | CONTROL | SOURCE | EXPECTED ACTION | PREV PROVEN? | EVIDENCE RUN | FROZEN? | SHARD | RESULT |
|---|---|---|---|---|---|---|---|---|
| print-document | viewer Print icon → native macOS print UI | document-viewer.tsx:70-73 | dialog/sheet appears; Cancel; reopen; correct document context; app responsive; Save-as-PDF to QA temp → exists, non-zero, opens, correct synthetic content, no foreign sentinel | NO | — | NO | E | PENDING |
| print-report | Print Report (window.print) | patient-summary-report.tsx:122-124 | native print path; Save as PDF; correct patient | NO | — | NO | E | PENDING |
| print-report | Download as PDF button | patient-summary-report.tsx:126-128 | actually triggers same print dialog (EXPECTED); PDF via Save-as-PDF; correct patient | NO | — | NO | E | PENDING |
| print-prescription | Prescription Print | prescription-print.tsx:55-309 | new-window print; doctor/patient/meds/dosage/instructions verified in output PDF | NO | — | NO | E | PENDING |
| physical-printer | paper output | hosted runner | **ENV — no physical hardware; do NOT install fake printer** | — | — | — | E | DEFERRED-PHYSICAL |
| desktop-save | downloaded document / CSV / backup ZIP / report PDF / prescription PDF on real filesystem paths | download mechanisms | files exist at real paths; open via macOS mechanisms | NO | — | NO | E (with B/D) | PENDING |
| error-recovery | backend temporarily unavailable → non-destructive read/action | supervisor stop | useful failure/no crash; recovery after restore | NO | — | NO | E | PENDING |
| error-recovery | rapid repeated clicks on safe actions | various | no dup records (PC10 analog for docs/notes/rx) | PARTIAL (patients PC10) | patients runs | NO | E | PENDING |
| error-recovery | close dialog mid-flow / navigate away during unsaved work | various dialogs | no partial saves (NV2 analog) | PARTIAL (patient dialogs) | patients runs | NO | E | PENDING |
| error-recovery | cancel native file chooser / cancel print | file + print paths | clean cancel, app responsive | NO | — | NO | E | PENDING |
| error-recovery | quit/reopen after saved data | app lifecycle | state intact (integration with h-series) | NO | — | NO | E | PENDING |

---

## §F PLACEHOLDER / EXPECTED-BEHAVIOR REGISTRY (source-proven; not product failures unless directive says so)

1. RESET ALL DATA = **FEATURE PLACEHOLDER** (settings-view.tsx:763-769, self-labeled toast) — per directive §3 NOTE.
2. "Download as PDF" (patient report) = window.print() alias (patient-summary-report.tsx:126-128).
3. Settings Display Name Save = client-store only, no server persistence (settings-view.tsx:105-112).
4. Forgot password / Terms / Privacy links = dead anchors (login-form.tsx:299-307,355,359); Remember me = unconsumed state.
5. Quick Upload (mobile FAB) = file picker with no onchange — silently discards (dashboard.tsx:225-231).
6. Call/Email patient-card icons = stopPropagation no-ops (dashboard.tsx:970-987).
7. Esc global "close dialogs" = dead event dispatch (use-keyboard-shortcuts.ts:92-100); Radix-native Esc works.
8. Annotations are text comments (x=0,y=0,page=1 hardcoded) — not spatial pins (document-annotations.tsx:92).
9. Viewer zoom ineffective on PDFs (transform on <img> only, document-viewer.tsx:270); Info/Annotations panels fullscreen-only.
10. 50 MiB limit is client-side only; server multipart cap 500MB (plugins/multipart.ts:21) — API-bypass robustness note (P3 record).
11. Prescription-card Delete = no confirmation dialog (prescription-card.tsx:204-213).
12. Visit-scheduler legacy free-text "Prescription" field parallels structured generator (visit-print.tsx:390-396).
13. Analytics Export CSV = 4 simultaneous client-side blob downloads (analytics-dashboard.tsx:275-284).
14. Import progress bar = simulated client animation (import-patients-dialog.tsx:184-192).
15. RESTORE = NOT IMPLEMENTED in UI (server endpoints POST /api/backups/:id/restore exist unused).
16. PWA install prompt never fires in Tauri WKWebView (beforeinstallprompt-gated).
17. Week-view right-click affordance has no visible hint (appointment-calendar.tsx:907-939).
18. Delete-fetch credentials omission in 4 components (annotations/notes/visits/prescriptions) — functional proof in shards decides (post-handoff same-origin cookies).
19. Server search is case-sensitive (contains, no mode:'insensitive') — q2/q3 hypothesis P2-candidate.
20. Welcome banner tip-3 "Upload Existing Files" action opens Add Patient (mismatch).

## §G PHYSICAL-CLINIC DEFERRED MATRIX (PHYSICAL-CLINIC-PILOT.md)

| FEATURE | HOSTED QA RESULT | WHY PHYSICAL NEEDED | PASS CONDITION |
|---|---|---|---|
| physical paper print | ENV (no printer) | real paper path | doctor prints one rx + one report on clinic printer |
| physical webcam/document camera | ENV (no camera device) | real capture optics/lighting | doctor scans 1 page via clinic camera |
| physical USB drive backup restore | ENV | real medium | backup ZIP written to + read from USB |
| real scanner hardware | ENV | native scanner integration | scan-to-MediVault from clinic MFP |
| clinic LAN peripherals | ENV | network isolation | verify loopback-only on clinic network |

## §H COVERAGE COUNTS (to be finalized at gate §12)

TOTAL CONTROLS: ~330 rows (incl. frozen compact sections + case-matrix rows)
Current: FROZEN-GREEN ~40 · PENDING ~270 · EXPECTED-registered 20 · ENV-candidate 8
UNCLASSIFIED AT GATE MUST = 0.

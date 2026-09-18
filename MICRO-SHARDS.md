# MICRO-SHARDS — the micro-shard QA catalog (manifest)

**Directive 2026-09-18: micro-shard parallel QA.** This file is the human
manifest of the micro-shard architecture. The dispatch truth is:

1. the `QA_FOCUS=micro:<name>` validation case at the top of
   `macos/scripts/exploratory-qa.sh` (what the harness will run), and
2. the `CATALOG` in `.github/workflows/micro-qa-parallel.yml` (what the
   wave dispatcher will fan out; the artifact name for a shard is always
   `qa-<name>`).

`qa-registry/green-evidence.json` is the FREEZE authority (what is proven
GREEN, at which DMG SHA-256); `qa-registry/impact-map.json` is the RERUN
authority (what a change invalidates). This manifest documents how the
micro shards relate to both.

## How to dispatch a micro wave

```
workflow: Micro QA Parallel Wave  (.github/workflows/micro-qa-parallel.yml)
inputs:
  source_run_id:    <a run that owns the frozen DMG — normally completed GREEN;
                     in_progress/non-green ONLY with allow_in_progress_source=true
                     (the proven strict/provisional gate; PROVISIONAL evidence
                     promotes on source GREEN at the same DMG SHA-256)>
  source_sha:       <the expected public head SHA — stale-head guard>
  micro_shards:     camera,backup,csv-export        # any comma-separated subset
  sibling_run_ids:  <optional earlier run ids whose qa-* evidence joins the gallery>
```

Each matrix entry = **ONE micro shard on its OWN clean macOS VM** (the
harness's FRESH_STATE gateway demands a pristine runner per invocation),
proves the frozen DMG SHA-256 itself before launch, runs the FULL gateway
chain (install → first-run setup → account creation), then its capability
battery. `fail-fast=false`, `max-parallel=5`: a red micro shard exits its
own job only; every other shard continues to its own honest first-red
(P0 stop / P1–P2 first-red / P3 record / D harness / ENV — the same
discipline as the coarse lane). Evidence is uploaded **always**, named
`qa-<micro-shard>`.

## The catalog (§4 list → shard → artifact → status)

Status legend:

- **implemented** — the shard has its own micro body in
  `macos/scripts/exploratory-qa.sh` (the relevant step sequences extracted
  from the proven coarse batteries).
- **mapped-to-parent** — the name is accepted and dispatches to its PROVEN
  parent battery VERBATIM (the coarse lane does the walking; the shard's
  evidence still names `micro:<name>`). Honest: this is not finer-grained
  yet — the parent battery runs whole.
- **pending-feature** — the capability is under construction on its feature
  worktree (`feature/guided-tour`, `feature/i18n`, `feature/bulk-patient-management`);
  no battery exists yet, so the shard records the gap honestly and stays
  GREEN (a feature under construction is not a product red).

| §4 capability | Micro shard (`QA_FOCUS=`) | Evidence artifact | Status | Body / parent battery |
|---|---|---|---|---|
| CORE / STARTUP | `micro:core-startup` | `qa-core-startup` | mapped-to-parent | `focus_surface` (the first-run/onboarding walk) |
| AUTH | `micro:auth` | `qa-auth-en` | mapped-to-parent | `focus_account` (login/logout/session/wrong-password) |
| PATIENT (isolation) | `micro:patient-isolation` | `qa-patient-isolation` | mapped-to-parent | `focus_patients` |
| NEW PATIENT MANAGEMENT | `micro:bulk-delete` | `qa-bulk-delete` | **implemented** | `micro_bulk_delete` — the DIRECTIVE §20 matrix: the 5-patient cohort (ALPHA/BRAVO/CHARLIE/DELTA 'Bulk' + the out-of-filter sentinel Echo Standalone), fixtures (docs + one visit for the survivor + the deleted), Select Patients → select BRAVO+DELTA only → the strong confirmation (count + names + warning + Cancel-first proof) → delete → the survivor gates (P0 BULK_DELETE_WRONG_PATIENT on any missing survivor/document/visit) → the filtered select-all re-run (search 'Bulk' → only the filtered rows selected; Echo never selected) |
| VISITS | `micro:visits` | `qa-visits` | mapped-to-parent | `focus_clinical` |
| CLINICAL (notes / prescriptions) | `micro:clinical-notes`, `micro:prescriptions` | `qa-clinical-notes`, `qa-prescriptions` | mapped-to-parent | `focus_clinical` |
| REPORTS (clinical) | `micro:reports` | `qa-reports` | mapped-to-parent | `focus_clinical` |
| DOCUMENT INGEST (upload/scan) | `micro:upload`, `micro:scan` | `qa-upload`, `qa-scan` | mapped-to-parent | `focus_documents` (DB1–DB4 upload matrix) |
| CAMERA | `micro:camera` | `qa-camera` | **implemented** | `micro_camera` — the DB14 path (pre-targeted scan entry, GENUINE getUserMedia attempt, close/switch; honest ENV when the hosted runner has no camera — no fake camera is ever used) |
| VIEWERS | `micro:viewer-pdf` | `qa-viewer-pdf` | **implemented** | `micro_viewer_pdf` — open + header + content + the patient-chip EXPECTED record + back |
| VIEWERS | `micro:viewer-image` | `qa-viewer-image` | **implemented** | `micro_viewer_image` — open + zoom (125/150/reset) + fullscreen + Info panel + back (the DB7 image battery) |
| DOCUMENT FILE ACTIONS | `micro:download`, `micro:annotations`, `micro:document-isolation` | `qa-download`, `qa-annotations`, `qa-document-isolation` | mapped-to-parent | `focus_documents` (DB10 download, DB8 annotations, DB5 isolation) |
| CSV IMPORT (cancel contract) | `micro:csv-import-cancel` | `qa-csv-import-cancel` | **implemented** | `micro_csv_import_cancel` — the PD24 in-flight-lock probe (Import → Cancel 0.7s later) with the BUG-PD27 API-log commit acceptance + Cancel-at-idle |
| CSV IMPORT (valid) | `micro:csv-import-valid` | `qa-csv-import-valid` | mapped-to-parent | `focus_dataio` (DD2) |
| CSV IMPORT (edge cases) | `micro:csv-import-edge` | `qa-csv-import-edge` | mapped-to-parent | `focus_dataio` (DD3a–DD3h) |
| CSV IMPORT (whole battery) | `micro:csv-import` | `qa-csv-import` | mapped-to-parent | `focus_dataio` |
| CSV EXPORT | `micro:csv-export` | `qa-csv-export` | **implemented** | `micro_csv_export` — the PD26 blob-download + the BUG-PD28 header needle + content integrity (Arabic + quoted-comma address) + secret scan |
| BACKUP | `micro:backup` | `qa-backup` | **implemented** | `micro_backup` — the **BUG-PD29-fixed** probe (scroll-find the BUTTON label `Download Complete Backup (ZIP)` — settings-view.tsx:439 — not the section header), PK magic + manifest.json parse + secret scan |
| PRINT | `micro:print` | `qa-print` | **implemented** | `micro_print` — MP1 the viewer Print icon + MP2 Print Report (window.print) + MP3 the rx preview content contract + Print; native-sheet or honest ENV (the documented WKWebView print-family gap) |
| SAVE AS PDF | `micro:save-pdf` | `qa-save-pdf` | **implemented** | `micro_save_pdf` — the DE2–DE4 outcomes: document / report / prescription Save-as-PDF with magic+size+content verify and the wrong-patient P0 check |
| REPORT PRINTING | (covered by `micro:print` MP2 / `micro:save-pdf` MS2) | `qa-report-pdf` (impact-map name) | **implemented** (inside print/save-pdf) | the DE3 report path |
| PRESCRIPTION PRINTING | (covered by `micro:print` MP3 / `micro:save-pdf` MS3) | `qa-prescription-pdf` (impact-map name) | **implemented** (inside print/save-pdf) | the DE4 rx path |
| DASHBOARD | `micro:dashboard` | `qa-dashboard-counts` | mapped-to-parent | `focus_dataio` (DD0 stats + widgets) |
| SETTINGS | `micro:settings` | `qa-settings-en` | mapped-to-parent | `focus_settings` |
| PERSISTENCE | `micro:persistence` | `qa-persistence` | **implemented** (granularity fits: the parent battery IS the shard) | `focus_persistence` (the h-series quit/reopen battery) |
| SECURITY | `micro:security` | `qa-security` | **implemented** | `micro_security` — no-credential 401 probes, logout → protected-UI gone, loopback-only binds, relogin (the FINAL section re-proves loopback + crash watch at teardown) |
| TOUR | `micro:tour-en` | `qa-tour-en` | **implemented** | `micro_tour_en` — the DIRECTIVE §21 walk: the first-login offer (TOUR_GATEWAY=skip keeps it) → Next/Back/progress ('Step 2 of 20' + the step titles) → Skip (overlay unmounts; the plain UI works) → Help & Guide (replay + jump-to-section) → the completion persistence after a logout/login cycle. **Gateway opt-out:** this shard sets `TOUR_GATEWAY=skip` — the offer is the shard's own subject |
| TOUR (Arabic) | `micro:tour-ar` | `qa-tour-ar` | pending-feature | same — `TOUR_GATEWAY=skip` (the offer survives for the shard; the shard itself exercises/dismisses it through the product's affordances) |
| LANGUAGE / RTL | `micro:rtl` | `qa-rtl-layout` | pending-feature | the i18n infrastructure is in flight on `feature/i18n`. Keeps the DEFAULT `TOUR_GATEWAY=on`: this shard's subject is the app's RTL layout, not the tour — at the first shell mount the offer is English (default locale), so the gateway dismissal needle works and the battery runs on the plain RTL UI |

Impact-map aliases: `qa-report-pdf` and `qa-prescription-pdf` (per
`qa-registry/impact-map.json`) are satisfied by `micro:print` /
`micro:save-pdf` today; `qa-nav` and `qa-en-ui-spotcheck` remain covered by
the coarse `surface` lane until their micro bodies are needed.

## The green-freeze rule

Once a micro shard is GREEN on a given DMG (SHA-256 recorded in its evidence
and in the registry), that result is FROZEN — it is never rerun "just to be
safe". A product change unfreezes ONLY the shards listed for that change
surface in `qa-registry/impact-map.json` (the rerun authority):

```
change → rerun exactly those micro shards (+ any short integration note);
harness/CI-only changes (probe scripts, workflow yml, no product files in
the diff) → rerun NOTHING.
```

The dispatch corollary: pass `micro_shards` = exactly the affected subset
(e.g. a backup-code change → `micro_shards=backup`); already-green shards
stay frozen and are simply absent from the matrix. A D-class harness
finding on a shard does NOT unfreeze the others (fix the harness, rerun the
affected shard against the SAME frozen DMG — no rebuild).

## The first-login tour offer (FEATURE C gateway step)

The guided tour auto-offers exactly ONCE per install at the first
authenticated-shell mount, and its modal spotlight overlay dims the
dashboard (and blocks every pointer event below it) — the exact surface
every battery OCRs. `exploratory-qa.sh` therefore gained
`tour_dismiss_if_present` (the `TOUR_OFFER` capability record): a bounded
15s poll for the welcome-step needle `Welcome to MediVault`, then the
product's own affordances in order — Escape (key code 53 → the tour's
`skip()`), re-check, the card's visible Skip button (`data-qa="tour-skip"`),
re-check — with an honest `P1 TOUR_OFFER_BLOCKING` first-red if NEITHER
clears a visible offer (a stuck modal would block the whole battery). It is
invoked at every pristine-install first-arrival point (GATEWAY 6 submit /
fallback / final, the SETUP_CONSUMED branch, and the SU4/SU5
accepted-branch dashboard waits of the account suite). The dismissal
persists (`markTourDismissed` → localStorage, WKWebView profile), so the
batteries' logout/login and quit/reopen cycles never re-see the offer.

The **micro:tour-en / micro:tour-ar shards are the opt-out**: their QA_FOCUS
case sets `TOUR_GATEWAY=skip`, so the gateway step is a no-op probe and the
offer survives for the shard's own battery to exercise (their bodies are the
pending-feature records above). Every OTHER battery — coarse and micro —
dismisses the offer and proceeds on the plain UI. (micro:rtl keeps the
default: its subject is the RTL layout, not the tour.)

## Provenance of the micro bodies (honesty note)

Every implemented micro body REUSES the step sequences of the proven coarse
batteries (`focus_dataio` DD4/DD5/DD6, `focus_desktop` DE1–DE4, the FX
fixture set, `focus_documents` DB6/DB7/DB14) — extracted/wrapped, not
reinvented. The mapped-to-parent entries run those batteries VERBATIM on
their own VM. Nothing in the coarse lane changed except the mandated
D-class harness fix:

- **BUG-PD29 (D, wave 17 run 35361609673 shard E de6)** — the backup probe
  scroll-found the SECTION header (`Backup & Export`) and then clicked the
  BUTTON (`Download Complete Backup (ZIP)`), but the button sits BELOW the
  fold (description + estimated-size lines between header and button), so
  the click target was never found → false P2 `DESKTOP_BACKUP_ZIP`.
  Fixed in the desktop battery AND designed correctly into `micro:backup`:
  scroll-find the BUTTON label itself (the product source
  `src/components/settings-view.tsx:439` has exactly this label), then
  click it; the fail-closed path stays (a button that never appears is
  still an honest red).

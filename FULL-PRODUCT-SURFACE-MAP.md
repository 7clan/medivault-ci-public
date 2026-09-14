# MediVault — FULL PRODUCT SURFACE MAP

> The complete map of the REAL reachable product, verified through the GUI by
> the exploratory QA campaign (focus-scoped runs). **No feature is invented**:
> every row below is either (a) verified live through the GUI this campaign
> (marked with its run evidence) or (b) derived from the product source as a
> *to-verify* entry that a focus run must confirm before it counts.
>
> Live-run rows are appended by `macos/scripts/exploratory-qa.sh` into the
> per-run artifact `gui-evidence/SURFACE-MAP.md` (8 columns: feature / how
> reached / visible controls / expected behavior / test attempted / result /
> evidence / classification). This file is the source-derived master that the
> live runs reconcile against.

**Baseline under test (frozen):** private `f6dc341d6821760009266d4d29447de630eb452a`
(`platform/macos`), public snapshot `0b0d9364ccc1f0b9eed2ada2c6114d2e7c3d8572`,
ARM64 GREEN run `34796558466` (PRODUCT-FUNCTIONAL-TEST-GREEN, 15 capability
fields, 125 screenshots).

---

## 1. Navigation model (source: `app-header.tsx`, `use-app-store`, `mobile-bottom-nav.tsx`)

| Entry | How reached (real UI) | Notes |
|---|---|---|
| Nav pills `Dashboard` / `Settings` | header, every view | the only two top-level views |
| Header right controls (icon-only) | header | patient switcher (Ctrl+P), notification bell (`Notifications`), theme toggle (`Switch to Light/Dark Mode`), backup (`Download Backup`), profile pill |
| Back arrow | patient detail banner | returns to the dashboard |
| Ctrl+B | keyboard | `goBack()` |
| Mobile bottom nav | narrow windows | `mobile-bottom-nav.tsx` |
| Quick Actions FAB | floating button | `quick-actions-fab.tsx` |

## 2. Keyboard shortcuts (source: `use-keyboard-shortcuts.ts` — the shortcuts dialog lists 7)

| Shortcut | Action | Category | Guard |
|---|---|---|---|
| Ctrl/Cmd+N | Add new patient | Actions | dashboard only (fires `medivault:add-patient`) |
| Ctrl/Cmd+D | Scan document | Actions | any view → `scan-capture` |
| Ctrl/Cmd+P | Quick patient switcher | Navigation | fires `medivault:open-patient-switcher` |
| Ctrl/Cmd+F | Focus search | Navigation | dashboard only; works from inputs |
| Ctrl/Cmd+K | Focus search (alt) | Navigation | dashboard only; works from inputs |
| Ctrl/Cmd+B | Go back | Navigation | any view |
| Escape | Close dialogs | General | fires `medivault:close-dialogs`; works from inputs |
| Shift+? | Show keyboard shortcuts | Help | fires `medivault:show-shortcuts` |

## 3. Pre-auth surface

| Surface | Source | Live-verified by focus run |
|---|---|---|
| First-run onboarding (`Set up MediVault`) | `first-run-onboarding.tsx` | frozen lane (GREEN run) |
| Account setup form (`Create Your Account`) | `setup-form.tsx` | frozen lane (ACCOUNT_CREATION GREEN) |
| Sign In card (`Sign In`; Remember me; Forgot password?; `Set Up Your Account` second entry) | `login-form.tsx` | frozen lane (LOGIN/WRONG_PASSWORD GREEN); surface focus S12 walk |

## 4. Dashboard view (`dashboard.tsx`)

| Surface element | Source component |
|---|---|
| App header + wordmark | `app-header.tsx` |
| Greeting + long-form date | dashboard |
| Action buttons row: `Analytics` (toggle), `Calendar` (toggle), `Add Patient`, `Scan Document`, `Import CSV`, `Export CSV` | dashboard |
| Today's Overview widget (live clock, visits/seen/docs badges, `All caught up!`, `Schedule Visit`, `Add Patient`) | `todays-overview.tsx` |
| GETTING STARTED rotating tips (4 tips, per-tip action) | `welcome-banner.tsx` |
| Stat cards (Patients / Documents / Storage Used / Recent Uploads) | dashboard |
| Document Categories chart | `stats-charts.tsx` |
| Patient search box (placeholder `Search patients by name, phone, or email...`, clear, `Ctrl+K` hint) | dashboard |
| Recently Viewed chips (hidden when empty) | `recently-viewed.tsx` |
| Upcoming Visits (+ `Schedule Visit`) | dashboard |
| Recent Patients list (+ `N patients` badge; empty state `No patients yet`) | dashboard |
| Recent Documents grid | dashboard |
| Activity Timeline | `activity-timeline.tsx` |
| Analytics expansion (period pills, Patient Growth / Documents Uploaded / Document Categories / Storage Growth / Activity Heatmap charts, `Export CSV`) | `analytics-dashboard.tsx` |
| Appointment Calendar expansion (Month/Week, `<` `Today` `>`, Visit Types legend) | `appointment-calendar.tsx` |
| App footer (MediVault, HIPAA Ready, v1.0, `All data stored locally`, `Press Shift+? for shortcuts`) | dashboard |

## 5. Patient workspace (`patient-detail.tsx`)

Banner (back arrow, initials avatar, name, phone/email/DOB + age badge,
icon-only controls **report | pencil (edit) | trash (delete)**); contact cards;
Visit History; Timeline; Prescriptions; Clinical Notes; Documents list +
Upload/Scan actions.

## 6. Dialogs (source-verified titles)

| Dialog | Triggered by | Component |
|---|---|---|
| Add New Patient | `Add Patient` button / Ctrl+N | `add-patient-dialog.tsx` |
| Edit Patient | detail banner pencil | `edit-patient-dialog.tsx` |
| Delete Patient (`Delete Patient & All Documents`) | detail banner trash | `patient-detail.tsx` |
| Import Patients | `Import CSV` button | `import-patients-dialog.tsx` |
| Schedule Visit / Edit Visit / Delete Visit | `Schedule Visit` buttons / visit rows | `visit-scheduler.tsx`, `visit-history.tsx` |
| Quick Patient Switcher (Cmd+P) | keyboard | `quick-patient-switcher.tsx` |
| Keyboard Shortcuts | `Press Shift+?` footer button / Shift+? | `keyboard-shortcuts-dialog.tsx` |
| Notifications | header bell | `notification-center.tsx` |
| Edit Document | document actions | `edit-document-dialog.tsx` |
| Scan & Upload view (Camera Capture / File Upload / Document Details / Recently Scanned) | `Scan Document` button / Ctrl+D | `scan-capture.tsx` |
| Document viewer (zoom/print/fullscreen, Info, Annotations) | document card | `document-viewer.tsx` |
| Prescription generator / print | prescription actions | `prescription-generator.tsx`, `prescription-print.tsx` |
| Patient summary report (Generate Report) | detail banner report icon | `patient-summary-report.tsx` |

## 7. Settings view (`settings-view.tsx`)

Doctor Profile (avatar, name/email, `Edit Profile`, Display Name + Save);
Appearance (Theme, Light/Dark segmented, live preview cards — the preview
cards are themselves clickable toggles); Storage & Statistics;
Backup & Export (`Download Complete Backup (ZIP)`); Supported Devices /
Install App (PWA entries); Security & Privacy checklist; About MediVault
(Version 2.0.0, Build Date, Tech Stack); **Danger Zone** (`Reset All Data` +
`Reset`).

## 8. Background services (the invisible-but-real surface)

- SMAppService LaunchAgent (`mediavault-launchagent`) — supervisor process
  ownership verified by the frozen lane.
- API on `127.0.0.1:3001` (loopback-only contract; lsof-verified).
- PostgreSQL 17 on `127.0.0.1:55432` (loopback-only; `/ready` + `SELECT 1`).
- `/api/auth/*` (register/login/logout/session), `/api/patients*`,
  `/api/documents*`, `/api/visits*`, `/api/prescriptions*`,
  `/api/clinical-notes*`, `/api/dashboard*` (Fastify, `mini-services/api-service`).

## 9. Auth/session matrix (source)

| State | Reachable surface |
|---|---|
| No account (fresh) | onboarding → setup form (one-time) |
| Signed out | Sign In card (+ second `Set Up Your Account` entry) |
| Signed in | dashboard, patient workspace, settings, all dialogs |
| Session persistence | JWT + localStorage; quit/reopen re-establishes (frozen-lane-proven) |

## 10. Search behavior (source: dashboard + API `patients` route)

- Live filter as you type; matches name/phone/email; `Ctrl+K`/`Ctrl+F` focus.
- **HYPOTHESIS (source-level, NOT a bug until GUI-proven)**: the Prisma
  `contains` filter lacks `mode: 'insensitive'` → case-sensitive search
  (searching `john` may not find `John Test`). The `search` focus run must
  prove or refute this through the real GUI before it enters the bug register.

## 11. Suspected product behaviors (hypotheses only — GUI proof pending)

1. **Case-sensitive patient search** (P2 candidate) — see §10.
2. **Logout leaves `searchQuery`/`recentlyViewed` uncleared** (P3 candidate,
   state leakage into the next session) — `account` focus.
3. **Settings Display Name is memory-only** (P3 candidate — no persistence
   call) — `settings` focus.
4. **Danger Zone `Reset All Data` is a stub** (P3 candidate — no destructive
   API call) — `settings` focus.
5. **No email-format validation on the login/setup forms** (P3 candidate) —
   `account` focus.

None of the above is a MediVault bug yet: each is a source-derived hypothesis
that its focus run must reproduce through the GUI (with evidence) before it is
classified.

---

## Live-fill reconciliation (per focus run)

| Focus | Run ID | Outcome | Live map |
|---|---|---|---|
| surface | (to be filled after the run) | — | `gui-evidence/SURFACE-MAP.md` in the run artifact |
| account | — | — | — |
| patients | — | — | — |
| search | — | — | — |
| settings | — | — | — |
| persistence | — | — | — |

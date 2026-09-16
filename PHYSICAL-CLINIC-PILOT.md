# PHYSICAL-CLINIC-PILOT.md — Deferred Physical-Hardware Test Matrix

MediVault parallel completion wave (2026-09-16). Everything in this document is
IMPOSSIBLE to prove on GitHub-hosted macOS runners because it requires physical
clinic hardware. These items are separated from the software QA GREEN and must
NOT block it unless the software path itself is broken (directive §13).

Authoritative heads at authoring: private afc96c5 → public 97f44a9 → (run 24
definitive patients rerun @ 517e37f, in flight at authoring time).

---

## 1. Physical paper output from a real printer

- HOSTED QA RESULT: print dialogs + Save-as-PDF proven in Shard E (native
  print sheet appears, cancel/reopen, PDF files written, content verified);
  PHYSICAL PAPER OUTPUT = ENV (no printer hardware on hosted runners; we
  explicitly did NOT install a fake printer and call it physical-printer GREEN).
- WHY PHYSICAL TEST NEEDED: the final hop — the print pipeline driving real
  toner/paper through the clinic's actual printer driver — is only provable on
  the clinic machine with the clinic printer installed.
- EXACT CLINIC TEST PROCEDURE:
  1. On the doctor machine, open any patient → Prescriptions → a prescription → Print.
  2. In the native print dialog select the clinic's real printer. Print ONE page.
  3. Repeat for Patient Summary Report (Print Report).
  4. Compare paper output against the on-screen preview: doctor header, patient
     block, medication table (name/dosage/frequency/duration/instructions),
     signature line, watermark.
- PASS CONDITION: both documents print completely, legibly, on the clinic
  printer, with the on-screen preview's exact content; no blank pages, no
  truncated medication tables.

## 2. Physical webcam / document camera capture

- HOSTED QA RESULT: Open Camera genuinely attempted in Shard B (real
  getUserMedia call); CAMERA HARDWARE = ENV on the hosted runner (no camera
  device). Software path (permission handling, no crash, close camera) proven.
- WHY PHYSICAL TEST NEEDED: real optics, lighting, autofocus, and page-capture
  ergonomics only exist with the clinic's camera.
- EXACT CLINIC TEST PROCEDURE:
  1. Dashboard → Scan Document (or patient-detail → Scan with Camera).
  2. Allow camera access if macOS prompts. Verify the live preview shows the
     document under the clinic camera.
  3. Switch Camera once (environment ↔ user facing) if a second camera exists.
  4. Capture a page ("Capture Document"), verify the captured frame appears in
     the staged strip, complete the upload to the selected patient.
- PASS CONDITION: live preview works, capture produces a readable page, the
  staged/uploaded document belongs to the intended patient, no crash.

## 3. Physical USB drive backup round-trip

- HOSTED QA RESULT: Download Complete Backup (ZIP) proven in Shard D (file
  exists, PK magic, unzip -l lists manifest + documents, no secrets); written
  to ~/Downloads on the runner.
- WHY PHYSICAL TEST NEEDED: writing/reading the ZIP on real external media
  (FAT/exFAT quirks, large-file split, drive eject) is hardware-dependent.
- EXACT CLINIC TEST PROCEDURE:
  1. Insert the clinic's USB drive. Settings → Download Complete Backup (ZIP).
  2. In the save dialog choose the USB drive. Wait for the toast "Backup Complete".
  3. Eject safely. On any Mac, open the ZIP: verify manifest.json + the patient
     document folders extract correctly; open one document image.
- PASS CONDITION: ZIP lands on the USB drive, ejects cleanly, extracts on a
  second machine with manifest + documents intact.

## 4. Real scanner hardware (clinic MFP)

- HOSTED QA RESULT: N/A in the app — MediVault's scan feature uses the camera
  (getUserMedia), not TWAIN/ICA scanner drivers; file-picker upload of
  scanner-produced PDFs is covered by Shard B's format matrix.
- WHY PHYSICAL TEST NEEDED: if the clinic scans via MFP-to-file then uploads,
  the end-to-end ergonomics (file naming, format, size) should be sanity-checked.
- EXACT CLINIC TEST PROCEDURE:
  1. Scan one page on the clinic MFP to a PDF (and one to JPEG).
  2. Patient → Upload Files → select both → verify both upload, appear in the
     document list, and open in the viewer.
- PASS CONDITION: both MFP-produced files upload, list, and view correctly.

## 5. Clinic LAN peripherals / network isolation

- HOSTED QA RESULT: loopback-only binds (API 127.0.0.1:3001, PostgreSQL
  127.0.0.1:55432) re-verified in every run (SECURITY_REGRESSION GREEN); Model
  A localhost enforcement frozen GREEN.
- WHY PHYSICAL TEST NEEDED: on the clinic network (shared Wi‑Fi/Ethernet with
  other devices), confirm nothing listens beyond the machine and the app works
  behind the clinic's firewall/NAC.
- EXACT CLINIC TEST PROCEDURE:
  1. On the clinic network run: `lsof -nP -iTCP:3001 -iTCP:55432` — every line
     must show 127.0.0.1 binds only.
  2. From a SECOND clinic machine: attempt `curl http://<doctor-machine-ip>:3001/health`
     — it must FAIL (connection refused/timeout).
  3. Use MediVault normally for one patient interaction while on clinic Wi-Fi.
- PASS CONDITION: loopback-only binds confirmed live; the second machine cannot
  reach the API; normal function on the clinic network.

---

## Ready-for-pilot declaration

SOFTWARE QA GREEN (all shards) + this matrix's physical checks passing at the
clinic = READY FOR PHYSICAL DOCTOR-MACHINE PILOT. Until the physical items are
executed, they remain ENV rows in the action matrix, not software defects.

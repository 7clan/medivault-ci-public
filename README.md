# MediVault — macOS qualification and public CI evidence

MediVault is a privacy-conscious clinical document system built around a **local application/service stack**, PostgreSQL/Prisma persistence, desktop packaging, and explicit deployment/acceptance testing.

This repository/branch is focused on the **macOS qualification path**. The canonical product repository is private; selected source, CI infrastructure, acceptance contracts, and QA evidence are mirrored publicly so the engineering and validation work can be reviewed without exposing private development history or real patient data.

## Platform scope

The macOS work validates separate **Apple Silicon (arm64)** and **Intel (x86_64)** paths rather than treating one architecture as evidence for both.

Qualification work includes:

- application and DMG packaging;
- local PostgreSQL provisioning and migration;
- API/database health and readiness checks;
- loopback-only service defaults;
- lifecycle and graceful-shutdown behavior;
- reinstall/update and data-preservation contracts;
- release verification and artifact integrity;
- GUI/interactive acceptance work where hosted CI can exercise it;
- explicit records of what remains unproven on a real user machine.

## Evidence-first development

The project uses staged acceptance contracts and fail-closed checks. A stage is not considered complete simply because it compiles. Where possible, CI executes the packaged system and verifies behavior such as provisioning, migrations, database connectivity, API readiness, process lifecycle, persistence, and artifact integrity.

Useful entry points:

- `acceptance/` — platform contracts, stage evidence, and production-readiness records
- `FULL-INTERACTIVE-QA-REPORT.md` — interactive QA evidence
- `BUG-REGISTER.md` — defect and investigation history
- `UNTESTED-ACTION-MATRIX.md` — actions still requiring proof
- `PHYSICAL-CLINIC-PILOT.md` — pilot/real-environment planning
- `.github/workflows/` — reproducible CI lanes

## Windows-to-macOS pivot

MediVault was originally developed around a Windows deployment path. When the intended physician environment was confirmed to be macOS, the Windows work was preserved for traceability and development moved to a dedicated macOS lane instead of rewriting the entire application from scratch.

That pivot is part of the engineering story: requirements changed, platform-specific assumptions were isolated, and deployment behavior was requalified rather than merely relabeled.

## Security and privacy direction

The current design favors:

- local-only service binding by default;
- explicit authentication/session/device controls;
- local database/storage handling;
- controlled backup/recovery behavior;
- no real patient data in the public CI mirror;
- clear separation between CI-proven behavior and real-clinic deployment approval.

## Development workflow

AI-assisted development tools have been used as implementation accelerators. Architecture, requirements, debugging priorities, validation criteria, and platform decisions are directed and reviewed by Mohammad Farhat; generated changes are treated as code that still needs inspection and testing.

## Status

Active engineering project. The public mirror is **evidence and CI infrastructure**, not the source of truth for private clinical data or production deployment.

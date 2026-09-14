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
| surface | (pending dispatch) | — | — | — |
| account | — | — | — | — |
| patients | — | — | — | — |
| search | — | — | — | — |
| settings | — | — | — | — |
| persistence | — | — | — | — |

## Cumulative campaign status

(to be updated after each focus: capability fields, screenshot totals,
bug-register deltas, surface-map completeness, next-focus safety verdict)

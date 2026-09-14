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

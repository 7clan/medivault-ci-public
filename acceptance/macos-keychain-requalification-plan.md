# MediVault macOS — Keychain lifecycle plan (ZERO-COST / ad-hoc identity)

Status: **AUTHORED (zero-cost form)** — supersedes the Developer-ID-era
requalification plan (kept below as history). Governing contract:
`acceptance/macos-zero-cost-release-contract.md`. CI stage:
`keychain-lifecycle` (macos-build.yml, both arches).

## The identity question, inverted

Under the zero-cost release model the **ad-hoc signature is the
production identity**. There is no Developer-ID Team-ID anchor, so the
stability question is empirical, not theoretical:

1. **Same-binary reads** — the supervisor process that created the items
   re-reads them (restarts, reboots). Long proven GREEN in CI
   (provision-lifecycle, supervisor-lifecycle, reinstall, production-
   readiness) and trivially true for ACL purposes.
2. **Cross-binary, same-user reads** — a DIFFERENT ad-hoc binary (a new
   build, a replaced app) reading items created by an earlier build.
   CI evidence ALREADY EXISTS: the frozen reinstall-acceptance CASE 3b
   proves a NEWLY BUILT app (different cdhash) performs
   `bootstrap-secrets` read-back of all 5 items created by the OLD build
   — 5/5 "already present", no authorization failure, on the hosted
   runner's login keychain. The CI keychain is unlocked and the runner
   session is non-interactive, so this evidence is real but partial: it
   does NOT predict whether a real doctor Mac shows an authorization
   dialog on the same operation.
3. **Interactive truth** — on a real Mac with a locked/unlocked login
   keychain and a GUI, macOS MAY show a keychain authorization prompt
   when a new binary first reads existing items. That behavior is a
   SECURITY FEATURE, not a bug, and it is acceptable UX for the
   controlled manual update flow (the doctor clicks Always Allow once).

## CI-provable contract (`keychain-lifecycle` mode)

Per the directive's lifecycle list, everything hosted CI can honestly
prove, fail-closed:

1. **initial provisioning** — first-run bootstrap creates exactly the 5
   `dev.medivault` items; values never printed;
2. **secret read #1** — supervisor run #1 with
   `secrets.source: "keychain"` (the shipped release config) reaches
   healthy: PostgreSQL SCRAM-authenticated, migrations applied, API
   /health + /ready 200 on 127.0.0.1:3001;
3. **supervisor restart** — graceful SIGTERM (exit 0, zero orphans,
   postmaster.pid gone);
4. **secret read #2** — supervisor run #2 from a FRESH process re-reads
   the 5 items and reaches healthy again (proof the read is not cached
   in the process);
5. **idempotence** — `bootstrap-secrets` again: 5× "already present",
   never overwrites;
6. **fail-closed** — delete ONE item (`jwt-secret`); supervisor run #3
   must FAIL naming the account (no env fallback, no partial start,
   API never comes up);
7. **cross-build read** (referenced, frozen evidence) — reinstall
   CASE 3b: a different build reads the items (5/5 already-present).

GREEN criterion: all steps green with zero ACL modifications. The
supervisor's keychain code (`macos/supervisor/src/keychain.rs`) is NOT
modified by this stage.

## Interactive contract (the clean Mac, harness sections 5–11)

`macos/scripts/interactive-acceptance.sh`:

* initial provisioning + secret read (sections 5–6: launchd-started
  supervisor healthy, API /health, sentinel via the app);
* supervisor restart + secret read again (sections 9–10: logout/login
  and reboot — the harness records a process-start marker around each
  so the restart + re-read is explicit);
* app replacement/update (section 11: the controlled update flow; the
  operator records `KEYCHAIN_PROMPT_NOTE` — whether macOS prompted to
  authorize the new build, and whether Always Allow made it stick).

## Binding stability rule (from the owner directive)

If ad-hoc code identity causes Keychain authorization instability
between builds — prompts that cannot be satisfied, denied reads after
replacement — the exact behavior is captured and reported BEFORE any
change. Keychain ACLs are NEVER loosened merely to make the test pass.
Any remediation (e.g. an explicit ACL pinned at creation time) is a
deliberate, reviewed architectural change, never a blanket "allow all
apps" weakening.

## History: the Developer-ID requalification question (superseded)

The previous revision of this plan asked whether switching ad-hoc →
Developer ID would break existing ACLs. That question is moot under the
zero-cost model (no membership will be purchased; no Apple credentials
will be requested). The analysis is retained in git history for the day
the owner ever changes that decision.

---

# Historical: Developer-ID-era requalification plan (SUPERSEDED)

The existing keychain proofs (provision-lifecycle; bundle-verify;
macos-26-smoke; reinstall) are engineering-GREEN with **ad-hoc signed**
binaries. The Developer-ID plan was to prove, on a real machine, that a
Team-ID-anchored identity upgrade keeps existing items readable without
recurring prompts (same-designated-requirement re-auth; step-5 failure
would have required a deliberate ACL architecture change). Superseded by
the zero-cost decision; no Apple credentials are pending.

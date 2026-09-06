# Public CI Mirror Contract — 7clan/medivault-ci-public

Status: AUTHORED (awaiting first execution — credential-gated)
Owner branch (source of truth): `platform/macos` in PRIVATE `7clan/medivault`
Mirror (CI infrastructure only): PUBLIC `7clan/medivault-ci-public`
Sync mechanism: `scripts/public-ci-sync.sh` (fail-closed, deterministic)

---

## 1. Purpose and roles

| Repository | Visibility | Role |
|---|---|---|
| `7clan/medivault` | PRIVATE, permanent | Canonical source of truth. ALL product development happens here (`platform/macos` lane). Windows lanes stay frozen here. |
| `7clan/medivault-ci-public` | PUBLIC | Disposable CI infrastructure. History-free sanitized snapshots. NEVER a place to fix product code. |

The mirror exists so that macOS CI runs on standard GitHub-hosted runners
(public-repo minutes) without ever exposing the private repository, its
history, or any credential that could read it.

## 2. Non-negotiable properties

1. **History-free.** The public repo starts from a NEW git history. Its first
   commit has ZERO parents. Snapshots are `git archive` exports of one private
   SHA — no `.git`, no refs, no Actions history, no branches/tags are copied.
   The sync script asserts: exactly ONE parentless root commit, forever.
2. **One-way boundary.** Public Actions run exclusively on files already in
   the mirror. No workflow may clone/curl the private repo, use a private
   token, or download private artifacts. The only token involved in syncing
   lives on the private side (runtime file read), is never printed, never in
   remote URLs, never committed, never in artifacts/worklogs.
3. **Fail-closed.** Any audit, scan, or verification failure aborts before
   anything is pushed. Discovered issues are reported as TYPE/PATH/
   REMEDIATION with values never printed.
4. **Traceability without history.** Every snapshot carries
   `.public-ci-source.json`: `{"private_source_sha": "<sha>", "platform":
   "macos", "purpose": "public-ci-mirror"}`. Commit messages:
   `ci-mirror: source <SHA>`.
5. **Source-of-truth flow.** PRIVATE change → validate (private CI) →
   sanitize/export → scan → update PUBLIC snapshot → PUBLIC Actions →
   inspect result → fix PRIVATE source → sync again. NEVER fix product code
   in the mirror.

## 3. Publication allowlist (what may ship)

Frontend/shared application source, API source, `packages/`, Prisma schema
and migrations, `src-tauri` (when it exists), macOS implementation,
macOS CI workflows, synthetic tests/fixtures, package manifests/lockfiles,
safe acceptance contracts, safe build configuration, this mirror tooling
(itself secret-free).

## 4. Exclusion list (removed from every snapshot)

`windows/` (frozen Windows implementation — stays private; no shared build
dependency on it exists), the Windows CI workflows (`.github/workflows/
windows-build.yml`, `windows-installer-only.yml`, `windows-integration.yml`)
and the retired private diagnostic workflow `ps51-parse-investigation.yml`,
`data/` (runtime object storage — patient-shaped blobs never ship, even
encrypted), `node_modules/`, `target/`, `dist/`, `build/`, `coverage/`,
`.env*` (all variants incl. `.env.example`), database files (`*.db`,
`*.sqlite*`, `*.dump`, `*.bak`), SQL outside `prisma/migrations/`,
credentials/keys/certificates (`*.pem`, `*.key`, `*.p12`, `*.pfx`,
`*.mobileprovision`, `*.cer`, `*.crt`, `id_rsa*`, `id_ed25519*`,
`known_hosts`, `*.keystore`), coordination worklogs (`worklog*`), build
caches (`*.tsbuildinfo`), temporary diagnostics (`*.log`, `*.tmp`, `*.swp`),
stray dev artifacts (e.g. the empty `-X` curl cookie jar — verified to
contain no cookies, excluded regardless), `tool-results/`, `upload/`,
`download/`, `.idea/`, `.vscode/`, `.DS_Store`, `__MACOSX/`.

If a `windows/` file ever becomes genuinely required to build shared code,
it must be identified EXPLICITLY and copied by deliberate decision — never
by shipping the whole directory.

## 5. Safety gates (order enforced by the sync script)

- **P1** private repo: on `platform/macos`, CLEAN worktree, HEAD == origin
  (what is exported is exactly what is pushed), SHA captured.
- **P3** pre-removal audit (fail-closed on the COMMITTED tree, so problems
  require PRIVATE remediation rather than silent stripping): committed env
  files, keys/certs/signing material, databases/dumps, SQL outside
  migrations.
- **P4** exclusion removal (counted + logged paths).
- **P5** secret scan: gitleaks (default rules, `--redact`) on BOTH the
  private tree and the final export. Reports print rule+path+line ONLY.
- **P6** PHI/PII scan: SSN-shaped / 16-digit values / non-synthetic emails —
  hard FAIL in data-like files (json/csv/sql), WARN for manual verification
  in source/docs. Extension audit covers dump formats.
- **P7** history-free proof: no `.git`, no `.gitmodules`; root-commit
  invariants asserted after commit.
- **P8** traceability file written + validated.
- **P9-P11** public repo (create if missing, must be public), snapshot
  commit, push.
- **P12** security settings applied idempotently on EVERY sync:
  secret scanning ON, push protection ON, Dependabot alerts + security
  updates ON, Actions = selected allowlist (extracted from the workflows in
  the snapshot — an unlisted action fails closed), workflow default
  permissions READ (fork PR workflows receive no privileged secrets),
  branch protection: no force pushes, no deletions, linear history,
  administrators included (direct sync pushes remain possible because no
  required checks/reviews are configured).
- **P13** optional dispatch: currently `mirror-proof`; modes grow with the
  campaign (integration, pg-bundle-verify, supervisor, keychain, tauri,
  dmg, macos26-smoke, reinstall). Targeted execution only — never the whole
  pipeline per change.

## 6. Runners

Standard GitHub-hosted ONLY: `ubuntu-latest`, `macos-15`, `macos-15-intel`,
`macos-26`, `macos-26-intel`. No paid larger runners.

## 7. Artifact policy (public repo)

Artifacts must contain no secrets, credentials, env files, Keychain
material, TLS private keys, database dumps, patient data, or private source
bundles. Short retention. Build products become public only after a content
audit. PG runtime/binary bundles are open-source build products — allowed.

## 8. Credential policy (mirror operations)

Two least-privilege fine-grained credentials, both delivered out-of-band to
private-side files (mode 0600):

- **PRIVATE SOURCE credential** (`/tmp/.gh_pat_private`): `7clan/medivault`
  only, Contents READ-ONLY. Used exclusively for the P1 origin fetch
  (local HEAD == origin proof). Never used for any write. Never accessible
  to anything public.
- **PUBLIC MIRROR credential** (`/tmp/.gh_pat`): `7clan/medivault-ci-public`
  only — Contents R/W, Actions, Workflows, Administration. Used for all
  public operations (clone/push/ls-remote + every GitHub API call).

Rules: never printed, committed, uploaded, or embedded in remote URLs that
appear in logs (git authentication goes through runtime credential helpers
that read the files only when git asks). The previously exposed PAT is
permanently forbidden. The PUBLIC Actions runner receives NO credential at
all — public CI operates exclusively on files already in the mirror
(self-checkout with the job-scoped GITHUB_TOKEN, default READ). Deleted at
campaign close-out.

## 8b. Mirror tooling overlay (read-only private source)

Because the private credential is READ-ONLY, the mirror tooling (proof
workflow, sync script, gitleaks config, this contract) is committed to the
PRIVATE repo by the owner when convenient, and until then the sync script
injects these files into the export from the private-side staging directory
(phase P4b) AFTER exclusion removal and BEFORE the secret/PHI scans — so the
overlay is scanned like all other content. The overlay is additive-only: if
any target path already exists in the export (i.e. the tooling WAS committed
privately), the sync fails closed rather than overwriting private content.

## 8c. Publication safety audit record (first snapshot, 2026-09-06)

Audit of `platform/macos` @ `5393f76` (values never recorded):

| TYPE | PATH | SAFE/UNSAFE | REMEDIATION |
|---|---|---|---|
| env-example | `.env.example` | SAFE (placeholder URL, empty JWT secret) | excluded from export anyway |
| cookie-jar-file | `-X` | SAFE (header comments only, zero cookies — verified) | excluded from export; remove from private when convenient |
| runtime-data | `data/objects/*.enc` | SAFE as excluded (ciphertext, runtime droppings) | excluded from every snapshot; consider removing from private |
| worklog | `worklog.md` | SAFE as excluded (private coordination doc) | excluded; private-only |
| build-cache | `tsconfig.tsbuildinfo` | SAFE | excluded |
| ci-fixture-secret | `.github/workflows/macos-build.yml` (2 findings) | SAFE (CI-harness env for loopback-only PG/API; already in the repo's own Actions logs) | exact-value allowlist entries, documented |
| test-fixture-secret | `tests/{api-route-integration,m3-integration,m4-auth-unit}.test.ts` | SAFE (fixed fixtures required by frozen GREEN suites; no production system accepts them) | exact-value allowlist entries, documented |
| windows-lane-fixtures | `windows/**` (6 findings) | SAFE as excluded (frozen private lane, never ships) | path allowlist for the private-tree scan; windows/ excluded from every snapshot |
| PHI/PII | whole tree | GREEN (one false positive: `@2x.png` retina icon name, regex tightened) | none |
| real secrets / tokens | whole tree | NONE FOUND (zero token-shaped strings in the entire tree) | none |

The gitleaks exceptions are anchored to EXACT values/paths in
`scripts/gitleaks-mirror.toml` with justifications; any new or changed value
fails closed.

## 9. First-snapshot validation checklist

After the first public push + `mirror-proof` dispatch, ALL must hold before
any expensive stage continues:

- [ ] repository visibility = public (anonymous git + API)
- [ ] arm64 proof: `uname -m` = `arm64` on macos-15 (run ID recorded)
- [ ] x86_64 proof: `uname -m` = `x86_64` on macos-15-intel (run ID recorded)
- [ ] standard GitHub-hosted runners only (labels + ImageOS evidence)
- [ ] public CI checked out itself via GITHUB_TOKEN
- [ ] job GITHUB_TOKEN got HTTP 404 for the private repo (boundary)
- [ ] anonymous access to the private repo impossible (boundary)
- [ ] no private credential present anywhere in the mirror
- [ ] first commit has zero parents (no private history)

## 10. Frozen engineering state carried over

- integration: GREEN / FROZEN (`a282f45`, run 34031521912)
- pg-bundle-verify: GREEN / FROZEN (`795df26`, run 34051758040)
- Windows: private, frozen (`windows/frozen-2026-09-06` @ `a859348`)
- Next first-red target: Rust supervisor (authored in PRIVATE
  `platform/macos`, then synced to the mirror for native Mac execution).

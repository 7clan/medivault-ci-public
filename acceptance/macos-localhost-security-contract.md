# MediVault — macOS Production Localhost Security Contract (MODEL A)

Status: **FROZEN GREEN — the production localhost security contract**
(product decision received from the owner, 2026-09-08; IMPLEMENTED the
same day, before Apple credentials — this work requires none; the targeted
CI mode `localhost-security` ran the full first-red discipline and is
**FROZEN GREEN on both architectures** — run 34240532237 @ private
`752d936`, see §6 for the freeze evidence and the five-run first-red
ledger, including one genuine product find: the comma-joined Set-Cookie
header that silently dropped `mvlt_csrf`/`mvlt_refresh` for every real
HTTP client). This document supersedes the RECOMMENDATION status of
`acceptance/macos-localhost-security-recommendation.md` (the analysis
record). Model A compliance is NECESSARY, not sufficient, for any
production-ready claim (§7).

## 1. Decision record (verbatim)

> PRODUCT DECISION APPROVED:
>
> Use LOCALHOST SECURITY MODEL A.
>
> Production contract:
>
> - API binds ONLY to 127.0.0.1
> - PostgreSQL binds ONLY to 127.0.0.1
> - LAN remains OFF
> - strict Origin validation remains required
> - existing authentication/session protections remain required
> - DO NOT configure trustedLocalTlsTermination=true
> - DO NOT claim a TLS terminator exists
> - no 0.0.0.0 binding
> - no local certificate/trust machinery for this release

## 2. Normative contract clauses

For every macOS release artifact of MediVault (dev, CI, and distribution):

* **C1 — API loopback bind.** The API server binds exactly `127.0.0.1`
  (port 3001 in the shipped config). No `0.0.0.0`, no `::`, no LAN or
  interface addresses. The bind is the SUPERVISOR's env contract
  (`HOST=<api.host>`); the API never relies on its own fallback default
  (`0.0.0.0`, a Windows-era default) in any supervised production path —
  and in the Model A production mode it fails closed on any non-loopback
  bind (§4).
* **C2 — PostgreSQL loopback bind.** PostgreSQL binds exactly `127.0.0.1`
  (port 55432 in the shipped config) via `listen_addresses` written by
  the provisioner into `postgresql.conf`; the supervisor spawns
  `postgres` as a direct child with no listen override and now FAILS
  CLOSED at config resolution on any non-loopback `postgres.host`.
* **C3 — LAN OFF.** No LAN-facing listener, no LAN mode code path, no LAN
  opt-in for this release.
* **C4 — strict Origin validation.** The API's Origin policy remains an
  EXACT allowlist from `ALLOWED_ORIGINS` (shipped value:
  `tauri://localhost,http://localhost:3000` — the WKWebView origin plus
  the dev origin), with credentials enabled and no wildcard. The
  app-layer enforcement is unchanged and required: `validateOrigin`
  (Origin header REQUIRED on state-changing requests — no Host-only
  fallback — and membership in the allowlist) plus the CORS grant layer.
  The allowlist stays minimal; additions require a contract change.
* **C5 — authentication/session protections.** The existing model MUST
  remain in force and MUST NOT be weakened: httpOnly `mvlt_session`
  cookie / Bearer transport, JWT HS256 with signature + expiration +
  issuer + audience verification, `sessionVersion` matching, AuthSession
  existence/revocation/expiry/device binding, double-submit CSRF
  (`mvlt_csrf` + `X-CSRF-Token`, SameSite=Lax, timing-safe compare,
  mixed-transport rejection, no-navigate fetch mode) on state-changing
  routes, and per-route `requireAuth`/`requirePermission`. The only
  unauthenticated endpoints are the read-only, stateless `/health` and
  `/ready` (plus the stateless `GET /api/auth/setup` needs-setup probe).
  No unauthenticated state-changing endpoint may exist.
* **C6 — no trustedLocalTlsTermination.** `TRUSTED_LOCAL_TLS_TERMINATION`
  MUST NOT be set to `true` in any production configuration or production
  env injection. Its CI-harness usage in frozen historical lanes is
  historical evidence only.
* **C7 — no TLS-terminator claim.** No component, log line, document, or
  release note for this macOS release may claim a TLS terminator,
  TLS-terminating proxy, or trusted local proxy exists. None exists. The
  webview speaks plain HTTP to the loopback API (the documented
  `NSAllowsLocalNetworking` class of local-only transport).
* **C8 — no 0.0.0.0 binding.** Nothing in the shipped macOS artifact may
  bind `0.0.0.0` (or otherwise all interfaces) — API, PostgreSQL, Node,
  supervisor helpers, or any other component.
* **C9 — no local certificate/trust machinery.** No local CA, no
  rcgen/mkcert-style flow, no trust-profile installation, no
  per-hostname SAN generation, no key rotation lifecycle — nothing of
  Model B ships in this release, in code or in UX.

## 3. Compliance audit of the pre-implementation tree (private `32ded2d`, 2026-09-08)

Audited read-only against the frozen state: private `7clan/medivault`
`platform/macos` @ `32ded2d` (verified via its history-free public mirror
`7clan/medivault-ci-public` @ `6202e37`, commit "ci-mirror: source
32ded2d41f588b2ee0dee11814df09b5ded03e44"). Production-readiness stage
GREEN/FROZEN, run 34174841903.

| Clause | Pre-implementation status | Evidence (file @ `32ded2d`) |
|---|---|---|
| C1 API 127.0.0.1 | COMPLIANT (supervisor-injected) | `config.rs` `api.host` default `127.0.0.1`; `supervise.rs` `spawn_api()` injected `HOST=<api.host>`; shipped config `"host": "127.0.0.1", "port": 3001`; run 34174841903 proved `/health` + `/ready` 200. |
| C2 PG 127.0.0.1 | COMPLIANT | `macos/provision/src/pg.ts` `initdb()` writes `listen_addresses = '127.0.0.1'` + `port = 55432`; `proc.rs` `spawn_postgres()` direct child, no listen override. |
| C3 LAN OFF | COMPLIANT | No LAN code path in the macOS tree. |
| C4 strict Origin | COMPLIANT | `ALLOWED_ORIGINS` exact allowlist (`tauri://localhost,http://localhost:3000`); `plugins/cors.ts` + `plugins/csrf.ts` `validateOrigin` (Origin REQUIRED, no Host fallback, allowlist membership). |
| C5 auth/session | COMPLIANT | `plugins/auth.ts`, `lib/cookie-helpers.ts`, per-route `requireAuth`/`requirePermission`/`validateCsrf`. |
| C6 no trusted flag | **ONE EXCEPTION** | `macos/supervisor/src/supervise.rs` line 209 (`spawn_api()`): unconditionally injected `("TRUSTED_LOCAL_TLS_TERMINATION", "true")` into the production API child env. |
| C7 no TLS-terminator claim | **SAME EXCEPTION** | The injected flag's documented meaning (`lib/https-enforcement.ts`) was "behind a trusted local TLS-terminating proxy" — an assertion that a TLS terminator exists. None does. |
| C8 no 0.0.0.0 | COMPLIANT in shipped operation | The API's own fallback default `process.env.HOST \|\| '0.0.0.0'` (`server.ts:23`) was reachable only if the API ran WITHOUT the supervisor — never a supervised production path; now the Model A gate fails closed on it (§4). |
| C9 no cert/trust machinery | COMPLIANT | No Model B machinery anywhere in the macOS tree. |

The exception's precise semantics (why a blind deletion was wrong): the
flag was (1) the API's production HTTPS-enforcement allowance
(`enforceHttpsConfig()` exits 1 without it — deleting the injection alone
would break every supervised startup) and (2) the `trustProxy=127.0.0.1`
decision (an implied local proxy claim). `shouldUseSecureCookies()` was
NOT a production delta of the flag (`NODE_ENV=production` already forces
the `Secure` attribute).

## 4. Implementation (landed 2026-09-08, before Apple credentials)

A deliberate, narrowly scoped localhost-production mode — general
production HTTPS enforcement is NOT weakened globally; the exception
applies ONLY when ALL desktop-local conditions are true, and the server
REJECTS STARTUP on any unsafe combination. Windows semantics are
byte-identical (Windows never sets the new variable).

* **I1 — the supervisor's desktop-local assertion.**
  `macos/supervisor/src/supervise.rs` `spawn_api()` now injects
  `MEDIVAULT_LOCALHOST_ONLY=true` (replacing the forbidden
  `TRUSTED_LOCAL_TLS_TERMINATION=true`). The forbidden flag is never
  injected anywhere — no TLS terminator exists to claim.
* **I2 — supervisor loopback config gate (fail closed BEFORE any process
  is spawned).** `macos/supervisor/src/config.rs`
  `resolve_with_bundle_root()` rejects any non-loopback `api.host` or
  `postgres.host` (`0.0.0.0`, `::`, LAN/interface addresses, hostnames)
  with a dedicated config error; permitted hosts are exactly
  `127.0.0.1`, `::1`, `localhost`. Unit-tested (4 new tests; 17 total
  GREEN).
* **I3 — the API's localhost-production mode.**
  `mini-services/api-service/src/lib/https-enforcement.ts`:
  `isLocalhostProductionMode()` (production + the supervisor assertion);
  `assertLocalhostProductionSafety()` — the startup fail-closed gate for
  EVERY unsafe combination: non-loopback `HOST` (incl. unset),
  `TRUSTED_LOCAL_TLS_TERMINATION=true` (forbidden), `HTTPS=true`
  (contradictory), and an unexpected Origin policy (missing, empty,
  wildcard, or ANY non-local `ALLOWED_ORIGINS` entry — only
  `tauri://localhost` and loopback-host http(s) origins are local);
  `shouldTrustProxy()` — **false** in the localhost-production mode (no
  proxy exists; `X-Forwarded-*` never trusted), with all other paths
  byte-identical to the previous behavior.
  `mini-services/api-service/src/server.ts`: `trustProxy` uses
  `shouldTrustProxy()`; a `MODEL-A-LOCALHOST-PRODUCTION` startup posture
  line (host/port/trustProxy) is logged for runtime proof.
* **I4 — Windows preservation.** Every new branch is gated on
  `MEDIVAULT_LOCALHOST_ONLY` (a variable only the macOS supervisor sets).
  The general production enforcement (`HTTPS=true` /
  `NEXT_PUBLIC_BASE_URL` / trusted termination) is unchanged — proven by
  the preserved m4 test expectations plus the new preservation tests.
* **I5 — unit tests.**
  `tests/model-a-localhost-production.test.ts` (24 tests, GREEN):
  approved-config startup, the full unsafe-combination matrix (0.0.0.0 /
  LAN / `::` / unset HOST, trusted termination, HTTPS, wildcard/missing/
  non-local origins), `::1`/`localhost` acceptance, Windows-behavior
  preservation (production without config still throws; trusted
  termination still allowed outside the mode), and `shouldTrustProxy()`
  (false in mode; previous values otherwise).

## 5. Targeted CI mode: `localhost-security` (first-red discipline)

New dispatch-only mode (matrix `macos-26` arm64 + `macos-26-intel` x64 —
native runtime behavior is involved; runner labels verified for the
production-readiness lane). No frozen historical mode is rerun; the
frozen SHAs' evidence stands as history (their trees carried the §3
exception — that is recorded, not hidden). The lane builds the full
packaged bundle (supervisor + provisioner + API + pinned Node + PG17 dt13
in a synthetic `MediVault.app`), runs the REAL login-keychain bootstrap
and delegated CLEAN provisioning at the SHIPPED production ports
(55432/3001) with the SHIPPED origin semantics, and proves:

1. **T1** the approved localhost production config STARTS
   (supervisor-managed to healthy; `/health` + `/ready` 200 on the
   packaged Node; 8/8 migrations).
2. **T2** the API listens ONLY on `127.0.0.1:3001` (lsof; owned by the
   supervised API pid).
3. **T3** PostgreSQL listens ONLY on `127.0.0.1:55432` (lsof).
4. **T4** NO listener on `0.0.0.0` / `::` / LAN interface addresses — no
   wildcard listener on the contract ports, and every listener owned by
   the supervised pids is loopback-only.
5. **T5** `TRUSTED_LOCAL_TLS_TERMINATION` ABSENT and
   `MEDIVAULT_LOCALHOST_ONLY` PRESENT (direct live-process env read when
   the runner's `ps` exposes it — names checked, secret values never
   printed; otherwise the startup fail-closed contract: the API reaches
   healthy ONLY in the mode that crashes on the forbidden flag, proven by
   T11's live crash matrix).
6. **T6** `trustProxy` FALSE (the API's own startup posture line).
7. **T7** the valid MediVault desktop Origin (`tauri://localhost`)
   SUCCEEDS (200 + CORS grant).
8. **T8** hostile/unapproved Origins are REJECTED: app-level 403 on
   state-changing endpoints (hostile Origin AND missing Origin — Origin
   is required), no CORS grant on reads, no preflight grant.
9. **T9** authentication/session protections remain ACTIVE
   (unauthenticated `GET /api/auth/me` → 401; first-admin setup issues
   the session; authenticated `GET /api/auth/me` → 200).
10. **T10** CSRF protections remain ACTIVE (mutating request without
    `X-CSRF-Token` → 403; with the double-submit token → 200; a hostile
    Origin beats a fully valid session+CSRF → 403).
11. **T11** unsafe non-loopback production configurations FAIL CLOSED at
    BOTH levels: the packaged Node + packaged API exit non-zero with the
    Model A FATAL gate for `HOST=0.0.0.0` / `::` / LAN / trusted
    termination / HTTPS / wildcard origins / non-local origins / missing
    origins; the supervisor's `status --config` fails closed for
    `api.host`/`postgres.host` = `0.0.0.0` / `::` / LAN / remote.
12. **T12** the existing supervisor-managed startup still works
    end-to-end (T1) AND shuts down gracefully (SIGTERM → exit 0 → zero
    owned orphans → `postmaster.pid` gone).

Plus the supervisor unit tests (17, incl. the loopback gate) and the
Model A unit tests (24) run first (fail fast).

## 6. Freeze evidence (recorded at first GREEN — appended, never rewritten)

* Status: **FROZEN GREEN** — `localhost-security` = the Model A contract proven
  on real macOS runners of BOTH architectures (macos-26 arm64 + macos-26-intel
  x64), 2026-09-08.
* GREEN run: **34240532237** @ mirror `8c9a1e3` = private `752d936`
  (`7clan/medivault-ci-public`, mode `localhost-security`, ONE SHA + ONE MODE
  = ONE RUN).
  * arm64 job **102109235692** — 33/34 steps success, 0 failed, 1 skipped —
    all twelve `LS-T1…LS-T12` assertions GREEN (T2 `127.0.0.1:3001 only`;
    T3 `127.0.0.1:55432 only`; T5 `TRUSTED_LOCAL_TLS_TERMINATION: ABSENT`;
    T6 `TRUST-PROXY: FALSE`; T8 `HOSTILE-ORIGIN: REJECTED`; T11
    `UNSAFE-CONFIG: FAILS CLOSED`; T12 graceful SIGTERM, zero postgres
    orphans, postmaster.pid gone).
  * x64 job **102109236184** — 33/34 steps success, 0 failed, 1 skipped —
    the same twelve assertions GREEN.
* First-red ledger (each red: first proven failure only, minimal private fix,
  push → sanitized sync → new SHA → exactly one new run):
  1. Run 34235952324 @ 1dde2ad (= 967b400) — vitest 4 writes ANSI SGR codes
     into piped output on runners; the `Tests N passed (N)` summary grep
     failed although all 24 unit tests passed on both arches. Fix 876dc43:
     `NO_COLOR=1` + assertions grep an ANSI-stripped copy (proven against the
     raw failing-run bytes).
  2. Run 34236597907 @ 465dc4e (= 876dc43) — lsof ORs the process selection
     (`-p`) with the network selection (`-iTCP`) unless `-a` is given, so the
     T4 per-pid loop read kqueue/pipe fields as bogus addresses. Fix eb90bd2:
     `lsof -a -nP -p … -iTCP -sTCP:LISTEN` + awk extracts only from true
     `(LISTEN)` lines (proven on mock shapes + negative control).
  3. Run 34237523921 @ 96d3101 (= eb90bd2) — GENUINE PRODUCT FIND:
     `setAuthCookies`/`clearAuthCookies` joined all three auth cookies into
     ONE comma-separated `Set-Cookie` header; every real HTTP client parses
     that as a single cookie, so `mvlt_refresh` and `mvlt_csrf` were never
     actually delivered over the wire (the test suite's lenient `', '`
     splitting masked it; the frontend always expected them). Fix 5d1569f:
     pass the array to `reply.header('Set-Cookie', …)` — three separate
     headers, wire-proven; zero test regressions (baseline-diffed).
  4. Run 34238773249 @ 413180e (= 5d1569f) — two T9/T10 curls declared
     `Content-Type: application/json` without a body; Fastify answers 400
     (empty JSON body) before the route's origin/CSRF gates run. Fix 10eaaed:
     `-d '{}'` on both calls (matching the negative control and the real
     frontend); premise proven locally against the same Fastify version.
  5. Run 34239760593 @ 9b35dca (= 10eaaed) — test-sequencing flaw: the
     successful CSRF-positive logout revokes the session, so the
     hostile-origin call that followed was 401'd by the auth guard (proving
     nothing about the origin gate). Fix 752d936: the hostile-origin proof
     now runs BEFORE the logout, with a fully-live session; the route's own
     wiring (`[requireAuth, csrfPreHandler]`, CsrfError → 403) was verified
     before the reorder.
* Frozen-stage safety: the ten previously frozen modes were NOT rerun (each
  historical GREEN stands as history; all other mode jobs in the run are
  skipped by the ONE-MODE dispatch guard). The single shared-code delta of
  this campaign (5d1569f, the three Set-Cookie headers) is additive transport
  correctness — same cookies, same attributes, now actually deliverable —
  with the inject-based suites unchanged and passing; per the established
  additive pattern the developer-id-release clean build carries this delta
  forward on both platforms.

## 7. Production-ready claim discipline

Model A compliance is NECESSARY, not sufficient. The product is NOT
production-ready, and must not be claimed to be, until ALL of: Developer
ID signing, notarization (Accepted), stapling (+ `stapler validate`),
Gatekeeper acceptance (`syspolicy_check distribution` / `spctl`), real
SMAppService approval and launch, Keychain under the production identity
(`developer-id-keychain-lifecycle`), interactive Mac acceptance, and
doctor-machine acceptance are proven. The next real stages remain
`developer-id-release`, then `developer-id-keychain-lifecycle` (Apple
credentials required — never faked).

## 8. Residual risks (owner-accepted under Model A)

Carried from the analysis record, accepted by the product decision:
same-user local malware can reach auth-protected loopback endpoints and
impersonate components; no transport confidentiality on loopback
(sniffing loopback requires the same local privilege); the Origin
allowlist must be kept minimal and maintained (C4 is the live
mitigation). Cookie `Secure`-attribute semantics over plain loopback
HTTP from the `tauri://localhost` webview remain an interactive-Mac
proof item (unchanged behavior; `NODE_ENV=production` forces `Secure`).

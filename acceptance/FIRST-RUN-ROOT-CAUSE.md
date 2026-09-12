# MediVault — FIRST-RUN-ROOT-CAUSE.md

Status: **CONFIRMED (P1 product bug — fresh-install circular dependency, plus
three deeper first-run defects found while tracing the source)**
Date: 2026-09-11 · Lane: `platform/macos` · Trigger: iteration-3 GUI acceptance
(run 34623411477 evidence class — the app window reaches Sign-In and no
supported pre-auth control exists to start the backend)

## 1. The reported loop, verified in source

On a fresh installation (no user state, service never registered):

1. **MediVault launches to Sign-In.**
   `src/app/page.tsx:93-125` — `checkSession()` calls
   `fetch('/api/auth/setup')`; any failure throws to `catch` →
   `setCurrentView('login')` → `src/app/page.tsx:185-187` renders ONLY
   `<LoginForm />`. No header, no navigation, no Settings.

2. **Settings → Background is not available before authentication.**
   `src/app/page.tsx:193-255` — `AppHeader` (which contains the Settings
   entry, `src/components/app-header.tsx:88`) renders only in the
   authenticated shell (`currentView` is neither `login` nor `setup`).
   Pre-auth, nothing else links to Settings.

3. **Authentication requires the API at 127.0.0.1:3001.**
   `src/components/login-form.tsx:31` posts to `/api/auth/login`;
   `mini-services/api-service/src/server.ts:22,113` — the Fastify API is
   the only authenticator. Nothing answers until the supervisor runs it.

4. **The API is unavailable because the supervisor is not registered.**
   The supervisor (which starts PostgreSQL and the API) runs only as the
   launchd agent `dev.medivault.supervisor`
   (`macos/launchagent/dev.medivault.supervisor.plist` → BundleProgram
   `mediavault-supervisor` → `macos/supervisor/src/supervise.rs:190-227`
   spawns PG + API). On a fresh install `SMAppService.status` is
   `notRegistered` (proven on the runner: smappservice-lifecycle run
   34271908241, log line "fresh state: notRegistered").

5. **Registration is reachable only through the Background panel UI.**
   The ONLY UI that calls the real registration commands is
   `BackgroundServicePanel` (`src/components/desktop/BackgroundServicePanel.tsx:37-44`
   → `src/lib/desktop/api.ts:458-484` → Tauri IPC
   `src-tauri/src/main.rs:94-97` →
   `src-tauri/src/commands/background_service.rs:109-147` →
   `Contents/MacOS/medivault-launchagent`, the Swift SMAppService helper).

6. **The loop closes:** login needs the API → the API needs the
   supervisor registered → registration needs the Background panel → the
   panel needs Settings → Settings needs an authenticated user →
   authentication needs the API. A brand-new user can NEVER start the
   backend through the product UI.

## 2. Three deeper defects found while tracing (same first-run path)

These make the loop worse than reported — they were invisible until the
iteration-3 GUI evidence forced a full source trace:

**D1 — the registration UI is dead code in the shipped app.**
The shipped frontend is the static export of `src/app/page.tsx`
(`NEXT_OUTPUT=export` → `out/` → Tauri `frontendDist`, frozen
desktop-build contract). Nothing in that import graph references
`src/components/desktop/*` — the desktop family
(`DesktopLayout`, `SettingsPanel`, `BackgroundServicePanel`,
`DesktopLoginForm`) is imported only by `src/components/desktop/index.ts`
itself. The "Settings → Background" panel the architecture assumes
**is never rendered by the shipped app**, behind auth or not.
(Additionally `src/lib/desktop/api.ts:54` `require('@tauri-apps/api/core')`
cannot even be bundled — `@tauri-apps/api` is absent from `package.json`;
the module only compiles because nothing imports it.)

**D2 — the shipped web UI cannot reach the loopback API at all.**
Every web-component API call is a RELATIVE fetch — `fetch('/api/...')`
(63 call sites; `src/lib/api.ts:26,52,87` etc.). The Next.js rewrites that
map `/api/*` → `127.0.0.1:3001` exist only in the non-export dev/standalone
server (`next.config.ts` — "not applicable when building static export for
Tauri"). Inside the Tauri WKWebView the page origin is `tauri://localhost`,
so `/api/auth/login` resolves to `tauri://localhost/api/auth/login` —
the asset protocol, which answers 404. Even with the backend running,
the shipped login form can never authenticate.
(C1/C4 of the localhost-security contract assumed the webview speaks
plain HTTP to `http://127.0.0.1:3001` — the CSP was even opened for it —
but no frontend code was ever written to do it.)

**D3 — the cookie/CSRF model cannot pass webview→API auth as shipped.**
Session cookies are `HttpOnly; SameSite=Lax` with the `Secure` flag forced
in production (`mini-services/api-service/src/lib/cookie-helpers.ts:45-49`,
`https-enforcement.ts:162-167`), and login additionally requires the
double-submit CSRF pair `mvlt_csrf` cookie + `x-csrf-token` header
(`routes/auth/index.ts:52-53`, `plugins/csrf.ts:69-81`). Three blockers:
(a) a page at `tauri://localhost` and an API at `http://127.0.0.1:3001`
are cross-scheme/cross-site, so WebKit will not attach `SameSite=Lax`
cookies (WebKit bug 194029 family — the contract itself lists the
cookie-over-plain-loopback-HTTP semantics as an unproven interactive
item, §8 residual risks); (b) `Secure` cookies are not storable over
plain loopback HTTP in WebKit at all; (c) NO endpoint issues `mvlt_csrf`
before login and NO web component ever sends `x-csrf-token` — so even the
pure-web deployment's first login fails "CSRF cookie missing" (the API
tests fabricate the cookie with `generateCsrfToken()`
`tests/api-route-integration.test.ts:301-311` and never exercise the
cookie-less first login).

## 3. Why the backend chain itself is sound (not the bug)

The supervisor path that the loop locks out is proven GREEN in CI:
SMAppService.register() succeeds for the ad-hoc release-signed app and
returns `enabled` on macOS 26 runners (run 34271908241:
"status after registration: enabled"); launchd owns the job
(`managed_by = com.apple.xpc.ServiceManagement`), RunAtLoad starts the
supervisor, PG provisions at 127.0.0.1:55432, the API answers
`/health` 200 at 127.0.0.1:3001. **The defect is purely that the shipped
frontend has no supported pre-auth way to trigger it and no working
transport to use it once running.**

## 4. Fix direction (minimal, reusing the existing implementation)

Make first-run a visible, bounded, pre-auth state machine that drives the
SAME registration path, then serve the SAME frontend from the API origin
so the existing relative-fetch web app works unmodified:

- Pre-auth onboarding screen (embedded first-run page) reusing
  `getBackgroundServiceStatus` / `registerBackgroundService` /
  `openLoginItemsSettings` (the exact functions Settings → Background
  uses) with Apple's four-state model surfaced honestly:
  notRegistered → "Set up MediVault"; requiresApproval → guidance +
  "Open Login Items"; enabled → bounded wait for
  `http://127.0.0.1:3001/health`; notFound → the documented fresh
  state for a never-launched app (zero-cost-release contract) — the
  setup control is offered; a genuinely broken install fails at
  register() with the real error.
- The supervisor gains the frontend directory in the API child env; the
  API (Fastify, `@fastify/static` already a dependency) serves the static
  export at `http://127.0.0.1:3001/` — the webview navigates there once
  healthy. All existing relative `/api/*` fetches become same-origin,
  so `SameSite=Lax` cookies work unmodified and the C4 Origin allowlist
  gains only the loopback origin `http://127.0.0.1:3001` (a local origin,
  already permitted by the Model A gate, `https-enforcement.ts:88-92`).
- `GET /api/auth/csrf` issues the double-submit pair pre-login, and the
  frontend attaches `x-csrf-token` on mutating requests — completing the
  API's own documented model (`plugins/csrf.ts:3-13`) instead of weakening
  it.
- In Model A (localhost-production) `shouldUseSecureCookies()` returns
  false: the transport is plain loopback HTTP **by design**; the `Secure`
  flag there does not add security, it prevents WebKit from storing the
  cookie at all (the contract's own §8 acknowledged contradiction).
  Windows/general production behavior is unchanged.

Security contract preserved: API stays 127.0.0.1:3001-only, PostgreSQL
127.0.0.1:55432-only, no 0.0.0.0/::/LAN bind, Origin validation kept
(loopback allowlist), session auth kept (HttpOnly, SameSite=Lax), CSRF
kept (double-submit, bootstrapped), Keychain untouched, SMAppService
untouched, supervisor still owns PG/API processes.

## 5. Fix log (chronological, first-red discipline)

**F1 — the pre-auth onboarding fix landed** (see §4): embedded first-run
state machine (`src/components/first-run-onboarding.tsx`,
`src/lib/first-run-machine.ts`, `src/lib/local-backend.ts`) reusing the
exact Settings → Background registration commands; supervisor
`frontend_dir` + API-served static export at `http://127.0.0.1:3001/`;
`GET /api/auth/csrf` bootstrap + `x-csrf-token` on mutating requests;
Model A plain-loopback cookie storage. Targeted tests:
`tests/first-run-frontend.test.ts` (18) + `tests/first-run-api.test.ts`
(14) — all GREEN.

**F2 — the helper filename typo (the first real product red after F1).**
PFT runs 34650350460…34658231874: the app reported "SMAppService helper
missing" with `wanted "medivault-launchagent"` while the readdir listing
showed `mediavault-launchagent` — the Rust lookup constant
(`HELPER_NAME`) was missing ONE letter 'a'. bash probes worked because
the harness used the correct spelling. Fixed at commit 2284423
(HELPER_NAME → `mediavault-launchagent`). The typo predates the fix
(the frozen v0.1.0 code carries it), but the registration path was dead
code there (see D1), so it never fired.

**F3 — the source file itself was still misspelled** (found by the new
regression test, this session): the Swift source
`macos/smappservice/medivault-launchagent.swift` kept the old spelling
while every consumer used `mediavault-launchagent`. Renamed to
`macos/smappservice/mediavault-launchagent.swift` (+ the 6 referencing
yml/rs/sh surfaces). Pure rename — compile outputs, staged names, and
logic unchanged. Regression coverage:
`tests/helper-name-regression.test.ts` (9 assertions) pins the shared
name across the Rust constant, the staging script, the DMG verifiers,
the signature verifier, both acceptance harnesses, both workflows, and
the source filename — any drift fails the targeted suite before CI.

**F4 — the invoke hang (OPEN).** PFT runs 34659573072/34661025092
(after F2): the first-run card renders but the status invoke never
resolves (the `checking` spinner never advances; the helper itself runs
instantly from bash). Instrumentation added at commit eff9933: entry
logs on every `background_service_*` invoke, launch/exit/elapsed logs
in `run_helper`, and a BOUNDED 20s timeout on a dedicated thread so a
hung helper surfaces as a clear error instead of an indefinite hang.
The env_logger init (`src-tauri/src/main.rs:22-28`) + `RUST_LOG=debug`
direct-exec capture means the next PFT run's
`/tmp/mv-direct-launch.log` will show exactly where the chain stalls
(invoke entry → helper launch → helper exit → mapped status).

**F5 — the instrumentation itself never compiled (E0382).** PFT run
34688887879: `error[E0382]: borrow of moved value: child_helper` —
eff9933 moved `child_helper` into the watchdog thread closure and then
borrowed it in the `map_err` error path. The previous session's sync
failed at the secret scan BEFORE this was ever dispatched, so the
compile error was never seen. Repaired: the error path uses `helper`
(the un-moved outer binding — same path).

**F6 — the ACTUAL first-run boundary bug (the "invoke never resolves"
resolved).** Cross-referencing run 34662818460's evidence: the helper
answers `notFound` instantly from bash; the app console (RUST_LOG=debug)
shows only starting/ready; VLM on 04-first-run-screen.png shows the
CardContent renders COMPLETELY EMPTY — no spinner, no 'checking' text,
no setup control, no error. A phase stuck at 'checking' would render a
spinner + text; an EMPTY card means the phase reached `status` with a
value that matches NONE of the four render branches — i.e. the invoke
RESOLVED with an unexpected value. Root cause: the Rust enum
`BackgroundServiceStatus` had NO `#[serde(rename_all = "camelCase")]`,
so serde's default serialized the unit variants as the PascalCase
variant NAMES (`"NotRegistered"`), while the frontend (and the Swift
helper's stdout, and Apple's documented SMAppService status strings)
speak camelCase (`'notRegistered'`) — intersection empty, every branch
fails, the onboarding renders an empty card. Fix:
`#[serde(rename_all = "camelCase")]` + the IPC-boundary regression test
`ipc_boundary_serializes_the_documented_apple_status_strings` (pins
both directions; PascalCase explicitly rejected).

**F7 — fresh machines report `notFound`, not `notRegistered` (PFT run
34689461997 first-red, after F5/F6).** The instrumentation (now
compiling) proved the chain GREEN end-to-end: invoke received → helper
launched → exited 0 in 118ms → status reached the frontend → the card
RENDERED (F6 worked). But the rendered state was the fatal
`notFound` branch: "Installation problem. … Please reinstall
MediVault." — and the pre-auth setup control never appeared. Root
cause: `notFound` is the DOCUMENTED fresh state for a never-launched
app (macos-zero-cost-release-contract.md first-red ledger: "the
documented fresh state for a never-launched app is notFound —
identical value in the frozen production-readiness evidence"; the
smappservice-lifecycle lane explicitly accepts BOTH fresh states and
proves register() succeeds from either → enabled). The onboarding had
made the SAME mis-shaped assertion the lifecycle lane originally
made. Fix: the `notFound` branch offers the SAME "Set up MediVault"
registration control (with honest fresh-install copy); a genuinely
broken install (plist actually missing) fails at register() and
surfaces the real error. `showsSetupControl()` now covers both fresh
states; the frontend test pins this as the run-34689461997 regression.

**F8 — the fresh-install flow never bootstraps the keychain (PFT run
34690519015 first-red, after F7).** The F7 fix worked end-to-end: the
notFound branch rendered the setup control, the real click registered
(SMAppService flipped to `enabled` at 0s), the app entered the bounded
health wait — but the API never answered in 420s. Root cause: the
supervisor FAILS CLOSED when the 5 keychain items are missing (by
design — the frozen supervisor contract), and NOTHING in the
fresh-install product flow creates them. Every CI lane that reaches
`healthy` from a fresh state runs `mediavault-supervisor
bootstrap-secrets` FIRST (smappservice-lifecycle Branch A: bootstrap →
register → launchd start → healthy → /health 200 → parent == launchd —
CI-PROVEN; the items' keychain ACL is bound to the supervisor binary,
so the launchd-started supervisor reads items an earlier bootstrap
created). Fix: `background_service_register` runs the supervisor's
idempotent `bootstrap-secrets` (bounded 20s watchdog, same discipline
as the helper) BEFORE the helper's register — the pre-auth "Set up
MediVault" click now performs the complete CI-proven ordering. The
helper-name regression suite now also pins the supervisor filename
across the Rust constant, the cargo package name, the staging script,
the plist BundleProgram, and the DMG verifiers. The PFT harness's API
red now self-diagnoses (supervisor status file + supervisor.log +
provision.log + launchd job shape).

**F9 — the hand-off served a 500 (dependency drift: prod-staged
@fastify/static v8 vs tested v10).** PFT run 34692245479 (after F8):
the ENTIRE backend came up — registration click → keychain bootstrap →
SMAppService enabled → supervisor healthy in 10s (PG 127.0.0.1:55432
LISTEN, /ready=200 through the real DB) — and the webview DID navigate
to the API origin, but the screen showed the raw JSON
`{"error":"Internal server error"}`. Reproduced faithfully locally
(built dist + real static export + fresh prod `npm install
--omit=dev`): `TypeError: reply.header is not a function` at
static-frontend's setHeaders — @fastify/static **v8** invokes
setHeaders with the RAW http.ServerResponse (`.setHeader`), **v10**
with the FastifyReply (`.header`). The api-service package.json range
(`^8.1.3`) resolved v8.3.0 on the staged prod tree while the root
dev/test tree ran v10.1.2 — every test green, production 500. Fix
(three layers): (1) the setHeaders callback supports BOTH shapes
(feature-detect setHeader/header — verified against the exact v8.3.0
staged tree: GET / 200, assets 200, SPA fallback 200, csrf 200); (2)
the api-service fastify-family ranges aligned to the root (tested)
tree — @fastify/static ^10.1.2, cors ^11.3.0, multipart ^10.1.0,
rate-limit ^11.2.0, fastify ^5.11.0 (multipart and rate-limit carried
the SAME drift class, fixed pre-emptively); (3) a dependency drift
guard test pins every fastify-family dep in the api-service
package.json to the root (tested) major.

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
  `http://127.0.0.1:3001/health`; notFound → clear failure.
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

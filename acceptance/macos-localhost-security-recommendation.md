# MediVault macOS — Production localhost security model recommendation

Status: **SUPERSEDED BY APPROVAL — see
`acceptance/macos-localhost-security-contract.md`** (product decision
2026-09-08: MODEL A APPROVED; implemented + the `localhost-security` CI
lane). This document is the analysis record for that decision; its
"RECOMMENDATION ONLY" status below is historical.

Status: **RECOMMENDATION ONLY** — per the directive, NO production
network/security behavior changes until the owner approves. Current
production behavior stays: API 127.0.0.1-only, PG 127.0.0.1-only, LAN OFF,
loopback HTTP (TRUSTED_LOCAL_TLS_TERMINATION remains CI-harness-only and
must never leak into production config).

## Recommendation

**MODEL A — loopback-only HTTP.**

## Why (evaluated against the ACTUAL MediVault architecture)

MediVault's real client is the Tauri WKWebView desktop shell running as
the SAME local user that owns the supervisor/API/PG; the API binds
127.0.0.1 only; LAN is off by design; authentication is session/JWT with
its own token handling; the threat model is a single-doctor machine.

* **Threats both models must address on a loopback server:**
  1. remote network attackers — fully mitigated by the 127.0.0.1 bind in
     BOTH models (identical).
  2. malicious web pages in OTHER browsers attacking the local API
     (CSRF/DNS-rebinding style) — mitigated by Origin validation +
     auth/session semantics in Model A, and by TLS client-host
     verification in Model B only for hostname/rebinding — the practical
     mitigation is the same: strict Origin/Host checks + no
     unauthenticated endpoints.
  3. OTHER LOCAL PROCESSES connecting to 127.0.0.1:3001 — Model B without
     client certificates does NOT stop them (any local process can open a
     TCP connection to a local TLS server; it just can't impersonate the
     server). Model B's real gain — server AUTHENTICITY for the webview —
     protects against a rogue process PRE-BINDING the port and spoofing
     the API to phish the webview session. That attack requires the
     malware to already run as the same user, at which point it can also
     read the webview's session storage / inject into the app anyway.
     The marginal security gain is small; the complexity cost is large.
* **Model B's costs in THIS architecture:**
  * a real trust model requires a locally provisioned CA/cert whose trust
    must be established INSIDE WKWebView (Tauri's WKWebView has no
    per-view certificate-exception API) — realistically a trust-profile
    install (admin auth prompt) or an mkcert-style user trust flow;
  * SANs must cover the exact origin the webview uses; key permissions
    must be locked to the supervisor; renewal/rotation lifecycle code;
  * Apple's WKWebView + ATS already treats plain loopback specially
    (`NSAllowsLocalNetworking` semantics), and the product makes no
    "secure transport" claim to the user that loopback HTTP breaks —
    confidentiality on the loopback interface is not a user-facing
    promise being violated.
* **Apple-guidance alignment:** ATS exists for network transport; a
  loopback-only service with no remote exposure is the documented
  local-networking case (`NSAllowsLocalNetworking`), and nothing in the
  notarization/Gatekeeper chain requires local HTTPS.

## ATTACKS IT MITIGATES (Model A as specified)

* Remote/network-adjacent compromise of the API or PG (bind + LAN off).
* DNS-rebinding / cross-origin browser attacks against the local API
  (strict Origin allowlist: only the webview origin
  `tauri://localhost` + the dev origin; reject everything else; plus the
  existing auth/session model — no unauthenticated state-changing
  endpoints).
* Rogue webview content exfiltrating to the LAN (CSP `connect-src`
  already restricts the webview to `self` + loopback + explicit https).

## REMAINING RISKS (explicit, accepted under A)

* Local malware running as the same user can talk to 127.0.0.1:3001
  (auth-protected endpoints only) or impersonate components — this risk
  is NOT materially removed by Model B without mutual TLS, which Model B
  as scoped does not include; full local-process hardening is out of
  scope for any loopback design.
* No transport confidentiality on loopback (sniffing loopback requires
  the same local privilege — same residual class).
* Origin-validation must be maintained: the config's
  `allowed_origins` is the enforcement point — keep it minimal.

## COMPLEXITY + UX impact

* Model A: zero new UX; zero cert lifecycle; zero trust prompts; config
  values only.
* Model B: first-run trust establishment (possible admin prompt), cert
  generation/renewal/permissions code, WKWebView trust integration
  risk, diagnostics burden — for no user-visible security gain the
  doctor can perceive.

## REQUIRED CODE CHANGES IF APPROVED (Model A)

1. Confirm/enforce the Fastify Origin allowlist equals exactly
   `tauri://localhost` (+ the dev origin in dev builds) — the shipped
   config already carries `tauri://localhost,http://localhost:3000`.
2. Keep the CSP `connect-src` exactly as shipped (loopback + self).
3. No other changes; LAN stays OFF; PG stays 127.0.0.1-only.

(If Model B were ever chosen later: rcgen/openssl-free local CA, SAN
`localhost`+`127.0.0.1`, key 0600 supervisor-owned, trust profile
installation UX, and an explicit true "TLS termination" claim replacing
the current honesty note.)

## DECISION REQUESTED

Approve **Model A** (or direct Model B) — production behavior changes
only after this approval.

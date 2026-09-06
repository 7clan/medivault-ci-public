# MediVault — macOS Platform Pivot: Directive & Blocker Resolutions

Date: 2026-09-06 · Branch: `platform/macos` · Context: user-issued FINAL IMPLEMENTATION
INSTRUCTION for the macOS platform pivot (this file records the decisions it made, so the
audit's open blockers have a written resolution trail in-repo).

The companion document `acceptance/macos-architecture-audit.md` (27 sections, verbatim as
delivered — SHA-256 `2b9fa51530c89d1035334ac58c2e0d9cef00eba495885cc8c6f7c5b499ae0b47`)
is the architecture baseline. This directive approves it and resolves its blockers:

| # | Audit blocker | Resolution from the directive |
|---|---|---|
| 1 | Apple Developer Program + Developer ID + notary key | NOT a dev-phase blocker. Development and CI proceed with **ad-hoc signing**; production doctor-facing DMG later requires Developer ID + Hardened Runtime + notarization + stapling + Gatekeeper/spctl proof. |
| 2 | Doctor's actual chip (arm64 vs Intel) | **Support BOTH natively.** `aarch64-apple-darwin` and `x86_64-apple-darwin` are both first-class: `MediVault-macOS-arm64.dmg` + `MediVault-macOS-x64.dmg`. No Rosetta proof counts. No universal/fat build first. Each arch must independently pass before being called supported. |
| 3 | PG17 darwin binary source | **Default stands: postgresql.org source tarball** pinned by exact version + SHA256, built per-arch with `--without-icu`, CI-cached. zonky.io remains an alternative requiring explicit provenance approval (not granted). |
| 4 | LAN requirement | **Local-only default confirmed** (API binds `127.0.0.1`; LAN is a designed-later explicit mode accounting for NSLocalNetworkUsageDescription, Local Network permission, firewall, hostname/IP SANs, second-device connectivity). |
| 5 | Runner label availability | To be verified at first CI authoring (this session's first-red dispatch). Fallback labels documented in the audit. |
| 6 | PAT / canonical repo | Canonical repo `7clan/medivault` confirmed working with the current PAT. |

## Frozen scope guarantees (unchanged by this directive)

- Windows is **frozen**: `windows/frozen-2026-09-06` @ `a859348` is a permanent reference;
  `windows/` (NSIS, PowerShell, WinSW, PG recovery, TLS, desktop/reinstall regressions) is
  never deleted, never merged for the pivot, and Windows CI debugging is not resumed.
- Experimental lanes `experiment/postgres-binary-bundle` @ `a859348` and
  `experiment/postgres-edb-fix` @ `c97db38` stay untouched.
- The Z.ai view-platform dashboard is complete and frozen — no further changes to it.
- No Tauri automatic updating in v1; updates start as manual signed/notarized DMG
  replacement with reinstall/data-preservation proof. Uninstall = app removal preserves
  data; data deletion is always a separate explicit destructive operation.

## Implementation discipline

- Lane: `platform/macos` only (cut from `a859348`, the latest shared app state).
- **First-red discipline**: author the macOS CI lane, dispatch once for the current SHA,
  capture the real RED on GitHub-hosted macOS runners, then fix in ordered stages.
  When a stage is GREEN it is frozen and not reopened.
- macOS floor: **13.0 (Ventura)** (`SMAppService`); test newest macOS (incl. macos-26
  where CI permits) without raising the floor without proven API need.
- Compilation alone is never GREEN — execute (initdb → ready → migrate → SELECT 1 →
  API → /health → lifecycle) on both architectures.

**Status: audit approved via directive. macOS implementation begins on `platform/macos`.**

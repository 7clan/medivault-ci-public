# MediVault — macOS App-Bundle Contract (stage: bundle-verify)

Status: **IN PROGRESS — first-red discipline active** (marked FROZEN GREEN
only when the `bundle-verify` CI mode is green on both architectures)
Lane: `platform/macos`
Predecessor stages (FROZEN GREEN): `integration` @ `a282f45` (34031521912),
`pg-bundle-verify` @ `795df26` (34051758040), `supervisor-lifecycle` @
`c71ac4c` (34063917607), `provision-lifecycle` @ `1a0c48f` (34065567722)

## 1. The shipped tree

```
MediVault.app/
  Contents/MacOS/mediavault-supervisor              (ad-hoc signed per-arch)
  Contents/Resources/
    supervisor-config.json                          (paths/ports; secrets NEVER here)
    runtime/nodejs/bin/node                         (pinned nodejs.org runtime)
    runtime/postgresql/17/…                         (frozen pg-bundle contract)
    api/                                            (dist + prod node_modules + .prisma client)
    provision/dist + package.json                   (the provisioner)
    prisma-cli/node_modules/{prisma,@prisma/engines}
    prisma/                                         (schema.prisma + 8 migrations)
  Contents/Library/LaunchAgents/dev.medivault.supervisor.plist
```

## 2. Node runtime contract

- Official nodejs.org **Node 22.23.2 (LTS Jod)** per arch:
  `node-v22.23.2-darwin-arm64.tar.gz` /
  `node-v22.23.2-darwin-x64.tar.gz`.
- DOUBLE fail-closed hash gate at CI time: the workflow-pinned SHA-256 AND
  the `SHASUMS256.txt` entry of the exact dist directory must BOTH match.
- The tarball's `bin/node` only (the bundled npm/docs tree is not shipped);
  `node --version` proven from the packaged path.
- Third-party prebuilt binary: passes the same Mach-O gate family (single
  arch matching the lane, `minOS <= 13.0` recorded via vtool; deps
  /usr/lib + /System only). A prebuilt that demands newer than Ventura is
  rejected by the same rule as everything else (frozen contract §2).

## 3. What CI proves (bundle-verify mode, both arches)

1. The complete bundle assembles (stage-pg-bundle + stage-app-bundle);
   exact layout asserted file-by-file.
2. Mach-O gates: node binary, supervisor binary, PG bundle.
3. REAL login-keychain bootstrap + delegated provisioning + the FULL
   lifecycle **FROM THE PACKAGED TREE** — the provisioner runs through the
   packaged prisma CLI/engines + packaged schema; the API runs on the
   PACKAGED node binary (pgrep proof), healthy, /health + /ready 200.
4. Graceful SIGTERM: exit 0, zero orphans, postmaster.pid gone.
5. **Relocation proof**: the whole `.app` moves to a new path, the config's
   bundle-relative fields re-point, and the lifecycle runs again to
   healthy (VALID_EXISTING — the user-data cluster under Application
   Support is untouched by the move; no re-provisioning) + graceful exit 0.

## 4. Non-goals / later stages

- DMG construction + signing + notarization — DMG stage.
- Tauri desktop shell + WKWebView — Tauri stage.
- Real `/Applications` install + SMAppService registration UX —
  desktop/reinstall stages (interactive proofs per the audit).
- Developer ID signing — production-only (ad-hoc until then, per the
  directive).

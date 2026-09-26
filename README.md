# MediVault — Public macOS CI Mirror

This repository is the **public continuous-integration mirror** for the macOS development lane of MediVault. It exists to expose reproducible build, test, packaging, and acceptance evidence while the canonical application repository remains private.

The file `.public-ci-source.json` records the private source commit mirrored into this repository and identifies the mirror's platform as `macos`.

> **Important:** this is not intended to be the canonical product repository or a public medical-data repository. It is a build/test mirror containing code and infrastructure required to validate the macOS application path. No real patient data should be committed here.

## Project context

MediVault is an in-progress, privacy-conscious clinical document system intended for a physician workflow. The engineering work covers the application itself as well as the less visible deployment problems involved in making a local system usable on a real doctor's computer.

Development originally invested heavily in a Windows packaging and service path. Once the target user's actual machine was established as a Mac, the Windows lane was frozen rather than discarded, and development pivoted to a dedicated `platform/macos` lane.

The macOS pivot explicitly preserves the earlier Windows work while treating macOS as a separate platform qualification problem rather than pretending the Windows packaging could simply be relabeled.

## What the macOS lane validates

The private `platform/macos` branch and this public mirror contain acceptance contracts and CI around areas such as:

- native arm64 and x86_64 macOS builds
- application-bundle and DMG construction
- PostgreSQL packaging/provisioning
- database migration and readiness checks
- Fastify/Node service startup and health/readiness endpoints
- local-only networking defaults
- supervisor/service lifecycle behavior
- reinstall and data-preservation behavior
- macOS background-service registration design
- signing/release structure
- GUI and product-functional acceptance
- controlled update behavior
- backup/restore and lifecycle validation where covered by the acceptance suite

The project uses written acceptance contracts because "it compiled" is not considered sufficient evidence that a desktop application is deployable.

## CI workflows

This public mirror currently exposes workflows including:

```text
.github/workflows/gui-acceptance-ci.yml
.github/workflows/macos-build.yml
.github/workflows/product-functional-test.yml
.github/workflows/public-mirror-proof.yml
```

The macOS workflow is intentionally extensive because it acts as an executable qualification record for packaging, architecture, service, and lifecycle requirements.

## Platform pivot

The macOS work was not a complete restart. The application-level functionality was kept while platform-specific assumptions were revisited.

The repository records several explicit design decisions:

- Windows is frozen as a preserved reference instead of deleted.
- macOS arm64 and Intel/x86_64 are treated as distinct supported targets.
- the default application networking model remains loopback/local-only.
- service registration, bundle paths, signing, packaging, and update behavior are validated using macOS-specific mechanisms.
- development/release claims are separated from what still requires interactive testing on the final user's Mac.

That last point is important: the acceptance documents keep an explicit **not-proven** list rather than converting untested assumptions into claims.

## Technology represented in the mirror

- Next.js / React / TypeScript
- Fastify
- Prisma
- PostgreSQL
- Tauri
- Vitest
- macOS shell/Swift/Rust packaging and lifecycle tooling
- GitHub Actions CI

## Testing philosophy

The macOS acceptance work follows a fail-closed approach: a stage is considered successful only when the expected executable behavior is actually demonstrated.

Examples documented in the repository include:

- database initialization and migration
- authenticated database checks
- API `/health` and `/ready` checks
- process startup/shutdown and orphan-process checks
- architecture-specific binary validation
- application-bundle path/relocation checks
- packaging verification

The acceptance history also records failed assumptions and subsequent fixes instead of presenting only the final green result. That history is useful because it shows the difference between architecture on paper and deployment behavior on real CI runners.

## Development approach

MediVault has been developed with AI-assisted implementation tools as accelerators. The engineering contribution should therefore be understood in terms of **requirements, architecture, platform decisions, debugging, test design, validation, and integration**, rather than as a claim that every generated source line was typed manually.

## Why this repository is public

The main MediVault repository is private, but a private-only project is difficult to evaluate externally. This mirror provides inspectable evidence of the engineering process without making the canonical repository public.

For a reviewer, the useful signal is not simply that a healthcare UI exists; it is that the project treats **privacy, local deployment, platform migration, failure handling, and reproducible acceptance** as first-class engineering problems.

## Status

MediVault remains **in progress**. CI evidence can validate many packaging and lifecycle properties, but final doctor-facing deployment still depends on the actual target machine and any interactive platform checks documented as outstanding in the acceptance contracts.

/**
 * Helper-filename regression coverage — the ONE shared name.
 *
 * Product bug (P1 fix follow-up, runs 34658231874…34661025092): the Rust
 * lookup constant said `medivault-launchagent` (ONE missing letter "a")
 * while the staged helper binary was `mediavault-launchagent`. The app
 * stat()d a path that did not exist while bash — using the correct
 * spelling — ran the same binary instantly.
 *
 * This test pins the helper filename to a single value across EVERY
 * authoritative surface that produces, looks up, or verifies it. Any drift
 * (renaming the Rust constant, editing the staging script, renaming the
 * Swift source, changing a workflow output path basename) fails this test
 * with the exact file + extracted value, so the mismatch can never again
 * ship silently as a runtime "helper missing"/lookup failure.
 *
 * The name is deliberately duplicated across Rust/bash/yml (the release
 * pipeline is frozen staged code); the shared source of truth is THIS
 * test, which fails closed until all surfaces agree again.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The single agreed helper filename (staged beside the app executable). */
const HELPER_FILENAME = 'mediavault-launchagent'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  const path = join(repoRoot, rel)
  if (!existsSync(path)) {
    throw new Error(`regression test surface missing on disk: ${rel}`)
  }
  return readFileSync(path, 'utf8')
}

/** Extract the first capture group of a regex; fail with context if absent. */
function mustExtract(label: string, text: string, re: RegExp): string {
  const m = text.match(re)
  if (!m || m.length < 2) {
    throw new Error(
      `${label}: pattern ${re} no longer matches — the naming surface was refactored; update this regression test deliberately (and re-verify all surfaces)`,
    )
  }
  return m[1]
}

describe('SMAppService helper filename: one shared name across all surfaces', () => {
  it('the Swift helper source file is named <helper>.swift', () => {
    expect(
      existsSync(
        join(repoRoot, 'macos/smappservice', `${HELPER_FILENAME}.swift`),
      ),
    ).toBe(true)
  })

  it('the Rust lookup constant equals the shared name (THE original bug)', () => {
    const rust = readRepo('src-tauri/src/commands/background_service.rs')
    const constant = mustExtract(
      'background_service.rs HELPER_NAME',
      rust,
      /const HELPER_NAME: &str = "([^"]+)"/,
    )
    // Compare ASCII-folded to also catch invisible/normalization artifacts.
    expect(constant).toBe(HELPER_FILENAME)
  })

  it('stage-app-bundle.sh stages the helper at Contents/MacOS/<shared name>', () => {
    const sh = readRepo('macos/scripts/stage-app-bundle.sh')
    const staged = mustExtract(
      'stage-app-bundle.sh staged filename',
      sh,
      /cp "\$SMAPPSERVICE_BIN" "\$APP_ROOT\/Contents\/MacOS\/([^"]+)"/,
    )
    expect(staged).toBe(HELPER_FILENAME)
  })

  it('build-release-dmg.sh verifies the helper under the shared name (app + mounted DMG)', () => {
    const sh = readRepo('macos/scripts/build-release-dmg.sh')
    const inApp = mustExtract(
      'build-release-dmg.sh app check',
      sh,
      /\[ -x "\$APP_ROOT\/Contents\/MacOS\/([^"]+)" \] \|\| die "SMAppService helper missing in \$APP_ROOT"/,
    )
    const inDmg = mustExtract(
      'build-release-dmg.sh mounted check',
      sh,
      /test -x "\$MOUNTPOINT\/MediVault\.app\/Contents\/MacOS\/([^"]+)" \|\| die "mounted app: SMAppService helper missing"/,
    )
    expect(inApp).toBe(HELPER_FILENAME)
    expect(inDmg).toBe(HELPER_FILENAME)
  })

  it('verify-signatures.sh pins HELPER_REL to the shared name', () => {
    const sh = readRepo('macos/scripts/verify-signatures.sh')
    const rel = mustExtract(
      'verify-signatures.sh HELPER_REL',
      sh,
      /HELPER_REL="Contents\/MacOS\/([^"]+)"/,
    )
    expect(rel).toBe(HELPER_FILENAME)
  })

  it('interactive-acceptance.sh resolves HELPER under the shared name', () => {
    const sh = readRepo('macos/scripts/interactive-acceptance.sh')
    const helper = mustExtract(
      'interactive-acceptance.sh HELPER',
      sh,
      /HELPER="\$APP\/Contents\/MacOS\/([^"]+)"/,
    )
    expect(helper).toBe(HELPER_FILENAME)
  })

  it('product-functional-test.sh HELPER_NAME equals the shared name', () => {
    const sh = readRepo('macos/scripts/product-functional-test.sh')
    const name = mustExtract(
      'product-functional-test.sh HELPER_NAME',
      sh,
      /^HELPER_NAME="([^"]+)"/m,
    )
    expect(name).toBe(HELPER_FILENAME)
  })

  it('product-functional-test.yml compiles the helper to a path ending in the shared name', () => {
    const yml = readRepo('.github/workflows/product-functional-test.yml')
    const out = mustExtract(
      'product-functional-test.yml HELPER_OUT',
      yml,
      /HELPER_OUT="\$RUNNER_TEMP\/([^"]+)"/,
    )
    expect(out.endsWith(HELPER_FILENAME)).toBe(true)
  })

  it('macos-build.yml helper outputs end in the shared name (all build lanes)', () => {
    const yml = readRepo('.github/workflows/macos-build.yml')
    const outs = [...yml.matchAll(/HELPER_OUT="\$RUNNER_TEMP\/([^"]+)"/g)].map(
      (m) => m[1],
    )
    expect(outs.length).toBeGreaterThanOrEqual(3)
    for (const out of outs) {
      expect(out.endsWith(HELPER_FILENAME)).toBe(true)
    }
  })
})

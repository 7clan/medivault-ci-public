/**
 * P3 TOASTS_NEVER_RENDER — ONE connected toast architecture (task ff-2c).
 *
 * The shipped app mounts its toast renderer in exactly one place:
 * src/components/providers.tsx. Before this fix that file mounted
 * Sonner's <Toaster /> while EVERY component fired the shadcn use-toast
 * store (src/hooks/use-toast.ts) whose renderer
 * (src/components/ui/toaster.tsx) was never mounted — and no component
 * imports sonner directly — so all in-app feedback was silent (the P3
 * discovered during the physical-Mac acceptance round).
 *
 * Fail-closed contract, pinned the same way as the pd23/pd24/pd26
 * regression tests (source pins + real-module runtime checks). This
 * repo's vitest stack is node-environment only (no jsdom /
 * @testing-library), so the runtime checks render with
 * react-dom/server:
 *
 *   A. providers.tsx mounts the shadcn renderer — the ONLY toast
 *      renderer mounted anywhere in src (single architecture; Sonner's
 *      wrapper stays on disk, imported by nothing).
 *   B. The store feeds the hook: a toast dispatched through the exact
 *      `toast()` the components import is visible to a component using
 *      the exact `useToast()` the mounted renderer uses.
 *   C. The renderer component that providers.tsx mounts actually
 *      renders in the React pipeline (it produces its Radix viewport).
 *      The toast DOM itself is Radix-Portal-gated on a live DOM node,
 *      which node-only SSR cannot attach — that is exactly why the
 *      mount pin in A is what guards this regression.
 *   D. The seven audited feedback flows each fire the store — their
 *      call sites are pinned so a refactor cannot silently orphan one
 *      and bring the "silent toasts" condition back one flow at a
 *      time.
 */
import * as React from 'react'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useToast, toast } from '@/hooks/use-toast'
import { Toaster } from '@/components/ui/toaster'

const repoRoot = process.cwd()

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

/** every file under dir/ whose source matches re (repo-relative paths) */
function filesUnder(dir: string, re: RegExp): string[] {
  const hits: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (re.test(readFileSync(full, 'utf8'))) hits.push(full)
    }
  }
  walk(join(repoRoot, dir))
  return hits.map((p) => p.slice(repoRoot.length + 1)).sort()
}

// ---------------------------------------------------------------------------
// A. the single toast architecture (static mount pins)
// ---------------------------------------------------------------------------

describe('A. providers.tsx mounts the shadcn use-toast renderer — the only one', () => {
  const providers = readRepo('src/components/providers.tsx')

  it('imports the Toaster from the shadcn renderer (ui/toaster.tsx)', () => {
    expect(providers).toMatch(
      /import \{ Toaster \} from ['"]@\/components\/ui\/toaster['"]/,
    )
  })

  it('renders <Toaster /> inside the Providers tree (after the children)', () => {
    // (a JSX comment block may sit between the children and the mount)
    expect(providers).toMatch(
      /\{children\}\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<Toaster\s*\/>/,
    )
  })

  it('no longer imports or mounts Sonner (the producer-less renderer)', () => {
    expect(providers).not.toMatch(/from ['"]sonner['"]/)
    expect(providers).not.toMatch(/@\/components\/ui\/sonner/)
    // the old (producer-less) mount had a Sonner-only position prop; the
    // shadcn renderer mounts bare
    expect(providers).not.toMatch(/<Toaster position=/)
  })

  it('the shadcn renderer is mounted EXACTLY once app-wide (providers.tsx is the only importer of ui/toaster)', () => {
    expect(filesUnder('src', /from ['"]@\/components\/ui\/toaster['"]/)).toEqual([
      'src/components/providers.tsx',
    ])
  })

  it("Sonner's wrapper stays on disk but is imported by NOTHING (inert, no dependency churn)", () => {
    expect(existsSync(join(repoRoot, 'src/components/ui/sonner.tsx'))).toBe(true)
    // nothing anywhere in src imports the wrapper module...
    expect(filesUnder('src', /from ['"]@\/components\/ui\/sonner['"]/)).toEqual([])
    // ...and the only file that imports the sonner package at all is the
    // orphaned wrapper itself
    expect(filesUnder('src', /from ['"]sonner['"]/)).toEqual([
      'src/components/ui/sonner.tsx',
    ])
  })
})

// ---------------------------------------------------------------------------
// B. runtime — the real store feeds the real hook (the renderer's data path)
// ---------------------------------------------------------------------------

/**
 * The exact hook the mounted renderer (ui/toaster.tsx) uses. Rendering
 * this through React proves a toast dispatched by any component's
 * `toast(...)` call reaches React state via the same subscription the
 * renderer reads — end-to-end at the data level.
 */
function ToastStoreProbe() {
  const { toasts } = useToast()
  return React.createElement(
    'ul',
    { 'data-qa': 'toast-store-probe' },
    toasts.map((t) =>
      React.createElement(
        'li',
        { key: t.id, 'data-variant': t.variant ?? 'default' },
        `${String(t.title)}::${String(t.description)}`,
      ),
    ),
  )
}

describe('B. runtime — a dispatched toast is visible through the exact useToast() the renderer uses', () => {
  it('the components\' exact toast() lands in the exact useToast() state (title + description render)', () => {
    const title = 'TOAST_ARCH_PROBE_TITLE'
    const description = 'TOAST_ARCH_PROBE_DESCRIPTION'
    toast({ title, description })

    const html = renderToString(React.createElement(ToastStoreProbe))
    expect(html).toContain('data-qa="toast-store-probe"')
    expect(html).toContain(title)
    expect(html).toContain(description)
    expect(html).toContain('::') // the one toast we dispatched actually rendered a row
  })

  it('the destructive variant round-trips (failure toasts stay distinguishable)', () => {
    toast({
      title: 'TOAST_ARCH_PROBE_DESTRUCTIVE',
      description: 'TOAST_ARCH_PROBE_DESTRUCTIVE_DESC',
      variant: 'destructive',
    })

    const html = renderToString(React.createElement(ToastStoreProbe))
    expect(html).toContain('TOAST_ARCH_PROBE_DESTRUCTIVE')
    expect(html).toContain('data-variant="destructive"')
  })
})

// ---------------------------------------------------------------------------
// C. runtime — the mounted renderer component itself renders
// ---------------------------------------------------------------------------

describe('C. runtime — the renderer providers.tsx mounts renders in the React pipeline', () => {
  it('the real Toaster component renders its Radix toast viewport (no crash, viewport present)', () => {
    // feed the store first so the renderer has a live toast to render
    toast({ title: 'TOAST_ARCH_RENDER_PROBE', description: 'probe' })

    const html = renderToString(React.createElement(Toaster))
    // Radix ToastViewport renders the <ol> the (live-DOM-gated) toast
    // portals target; a clean render containing the viewport means the
    // component providers.tsx mounts really mounts. The toast content
    // itself is proven in section B (the Radix portal requires a live
    // DOM node this node-only test stack cannot provide).
    expect(html).toContain('<ol')
  })
})

// ---------------------------------------------------------------------------
// D. the seven audited feedback flows fire the store (call-site pins)
// ---------------------------------------------------------------------------

interface FlowPin {
  flow: string
  file: string
  // each needle is a real call site (or its store import) in the audited file
  needles: Array<{ what: string; re: RegExp }>
}

const FLOW_PINS: FlowPin[] = [
  {
    flow: 'CSV export — success AND failure',
    file: 'src/components/dashboard.tsx',
    needles: [
      { what: 'store import', re: /from ['"]@\/hooks\/use-toast['"]/ },
      { what: 'success toast', re: /toast\(\{ title: t\('dashboard\.exportStartedTitle'\)/ },
      { what: 'failure toast (destructive)', re: /toast\(\{ title: t\('dashboard\.exportFailedTitle'\), description: t\('dashboard\.exportFailedDesc'\), variant: 'destructive' \}\)/ },
    ],
  },
  {
    flow: 'Backup — success AND failure',
    file: 'src/components/app-header.tsx',
    needles: [
      { what: 'store import', re: /from ['"]@\/hooks\/use-toast['"]/ },
      { what: 'success toast', re: /toast\(\{ title: t\('header\.backupCompleteTitle'\)/ },
      { what: 'failure toast (destructive)', re: /toast\(\{ title: t\('header\.backupFailedTitle'\), description: t\('header\.backupFailedDesc'\), variant: 'destructive' \}\)/ },
    ],
  },
  {
    flow: 'Camera permission failure (classified UX — ff-2a merge)',
    file: 'src/components/scan-capture.tsx',
    needles: [
      { what: 'store import', re: /from ['"]@\/hooks\/use-toast['"]/ },
      { what: 'classified error path', re: /showCameraError\(classifyCameraError\(err\)\)/ },
      { what: 'destructive toast for every camera failure class', re: /toast\(\{ title: message\.title, description: message\.desc, variant: 'destructive' \}\)/ },
      { what: 'permission-denied message mapping', re: /title: t\('scan\.cameraDeniedTitle'\), desc: t\('scan\.cameraDeniedDesc'\)/ },
    ],
  },
  {
    flow: 'Document download — success AND failure',
    file: 'src/components/document-viewer.tsx',
    needles: [
      { what: 'store import', re: /from ['"]@\/hooks\/use-toast['"]/ },
      { what: 'success toast', re: /toast\(\{ title: t\('viewer\.downloadStartedTitle'\)/ },
      { what: 'failure toast (destructive)', re: /toast\(\{ title: t\('documents\.downloadFailedTitle'\), variant: 'destructive' \}\)/ },
    ],
  },
  {
    flow: 'Patient mutation — create',
    file: 'src/components/dashboard.tsx',
    needles: [
      { what: 'patient-added toast', re: /toast\(\{ title: t\('dashboard\.patientAddedTitle'\)/ },
    ],
  },
  {
    flow: 'Patient mutation — edit',
    file: 'src/components/edit-patient-dialog.tsx',
    needles: [
      { what: 'store import', re: /from ['"]@\/hooks\/use-toast['"]/ },
      { what: 'patient-updated toast', re: /title: t\('patients\.updatedTitle'\)/ },
    ],
  },
  {
    flow: 'Patient mutation — delete',
    file: 'src/components/patient-detail.tsx',
    needles: [
      { what: 'store import', re: /from ['"]@\/hooks\/use-toast['"]/ },
      { what: 'patient-deleted toast', re: /title: t\('patients\.deletedTitle'\)/ },
      { what: 'delete-failure toast (destructive)', re: /toast\(\{ title: t\('documents\.deleteFailedTitle'\), variant: 'destructive' \}\)/ },
    ],
  },
  {
    flow: 'Import result — success AND failure',
    file: 'src/components/import-patients-dialog.tsx',
    needles: [
      { what: 'store import', re: /from ['"]@\/hooks\/use-toast['"]/ },
      { what: 'success toast', re: /title: t\('importExport\.importComplete'\)/ },
      { what: 'failure toast (destructive)', re: /title: t\('importExport\.importFailed'\),\s*\n\s*description:[\s\S]*?variant: 'destructive',/ },
    ],
  },
]

describe('D. the audited feedback flows fire the (now rendered) toast store', () => {
  for (const pin of FLOW_PINS) {
    it(`${pin.flow} — ${pin.file}`, () => {
      const source = readRepo(pin.file)
      for (const needle of pin.needles) {
        expect(
          needle.re.test(source),
          `${pin.file}: missing ${needle.what} (expected ${needle.re})`,
        ).toBe(true)
      }
    })
  }
})

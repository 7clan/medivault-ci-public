/**
 * FEATURE ff-2b — the native print/PDF bridge (JS side).
 *
 * Coverage for `src/lib/print-bridge.ts` — the wrapper the three UI
 * surfaces (document viewer, report dialog, prescription dialog) hand
 * their PDF bytes to:
 *
 *  1. `nativeBridgeAvailable()` is FALSE in the plain node test env
 *     (no `window.__TAURI_INTERNALS__`) and detects the marker when the
 *     webview injects it — the same detector the components branch on
 *     for their web fallbacks.
 *  2. FALLBACK SELECTION: outside the desktop app, `openForPrint` /
 *     `savePdfFile` reject with a `PrintBridgeError` carrying the exact
 *     i18n toast key (`print.openFailedDesc` / `print.saveFailedDesc`)
 *     the components toast — never a raw rejection.
 *  3. The wire contract — through the REAL `@tauri-apps/api/core`
 *     `invoke` (which delegates to `window.__TAURI_INTERNALS__.invoke`
 *     exactly like the desktop webview): the Rust
 *     `{"outcome":"opened"|"saved"|"cancelled"}` envelopes parse to the
 *     typed results, the command names/args are passed verbatim, and
 *     command failures surface as PrintBridgeError.
 *  4. `bytesToBase64` (the transport encoding): RFC 4648 round-trip incl.
 *     the 32 KiB chunk boundary.
 *  5. `downloadBytesAsFile` (the web fallback): Blob-anchor download with
 *     object-URL revocation, typed so the pdf-lib
 *     `Uint8Array<ArrayBufferLike>` → `BlobPart` contract holds.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PrintBridgeError,
  __resetPrintBridgeCache,
  bytesToBase64,
  downloadBytesAsFile,
  nativeBridgeAvailable,
  openForPrint,
  savePdfFile,
} from '@/lib/print-bridge'

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => unknown

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

describe('ff-2b print bridge — native availability', () => {
  const realWindow = (globalThis as Record<string, unknown>).window

  afterEach(() => {
    if (realWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window
    } else {
      ;(globalThis as Record<string, unknown>).window = realWindow
    }
  })

  it('nativeBridgeAvailable() is FALSE in the plain web/test environment', () => {
    // No window.__TAURI_INTERNALS__ exists in node — the same condition
    // the components use to select their web fallbacks.
    expect(nativeBridgeAvailable()).toBe(false)
  })

  it('nativeBridgeAvailable() detects the Tauri internals marker the webview injects', () => {
    ;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }
    expect(nativeBridgeAvailable()).toBe(true)

    // Marker removed → web fallback again.
    ;(globalThis as Record<string, unknown>).window = {}
    expect(nativeBridgeAvailable()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fallback selection (outside the desktop app, invoke cannot work)
// ---------------------------------------------------------------------------

describe('ff-2b print bridge — fallback selection without a working bridge', () => {
  beforeEach(() => {
    __resetPrintBridgeCache()
  })

  it('openForPrint rejects with PrintBridgeError carrying the openFailed toast key', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    const err = await openForPrint(pdfBytes).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PrintBridgeError)
    expect((err as PrintBridgeError).key).toBe('print.openFailedDesc')
  })

  it('savePdfFile rejects with PrintBridgeError carrying the saveFailed toast key', async () => {
    const err = await savePdfFile(new Uint8Array([0x25, 0x50]), 'report.pdf').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PrintBridgeError)
    expect((err as PrintBridgeError).key).toBe('print.saveFailedDesc')
  })

  it('the toast keys the bridge carries exist in BOTH catalogs', () => {
    for (const locale of ['en', 'ar']) {
      const catalog = JSON.parse(
        readFileSync(join(process.cwd(), `src/i18n/locales/${locale}.json`), 'utf8'),
      ) as Record<string, string>
      expect(catalog['print.openFailedDesc']).toBeTruthy()
      expect(catalog['print.saveFailedDesc']).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// Wire contract — the Rust PrintOutcome / SaveOutcome envelopes
// ---------------------------------------------------------------------------

describe('ff-2b print bridge — IPC wire contract', () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []

  /**
   * Install `window.__TAURI_INTERNALS__.invoke` — the REAL
   * `@tauri-apps/api/core` `invoke` (which the bridge resolves via its
   * lazy `require`) delegates to it exactly like the desktop webview.
   */
  const installInternals = (handler: InvokeFn) => {
    ;(globalThis as Record<string, unknown>).window = {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => handler(cmd, args),
      },
    }
    __resetPrintBridgeCache()
  }

  beforeEach(() => {
    calls.length = 0
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
    __resetPrintBridgeCache()
  })

  it('openForPrint resolves {path} from the Rust "opened" envelope and passes base64', async () => {
    installInternals((cmd, args) => {
      calls.push({ cmd, args })
      return Promise.resolve({ outcome: 'opened', path: '/var/folders/…/medivault-print/medivault-1.pdf' })
    })
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
    const result = await openForPrint(bytes)
    expect(result).toEqual({ path: '/var/folders/…/medivault-print/medivault-1.pdf' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.cmd).toBe('open_for_print')
    expect(typeof calls[0]?.args?.dataB64).toBe('string')
    // The bytes travel as standard base64 of the exact document.
    expect(Buffer.from(String(calls[0]?.args?.dataB64), 'base64')).toEqual(
      Buffer.from(bytes),
    )
  })

  it('savePdfFile resolves {outcome:"saved", path} from the Rust envelope', async () => {
    installInternals((cmd, args) => {
      calls.push({ cmd, args })
      return Promise.resolve({
        outcome: 'saved',
        path: '/Users/doctor/Desktop/MediVault-Report.pdf',
      })
    })
    const result = await savePdfFile(new Uint8Array([0x25, 0x50]), 'report.pdf')
    expect(result).toEqual({
      outcome: 'saved',
      path: '/Users/doctor/Desktop/MediVault-Report.pdf',
    })
    expect(calls[0]?.cmd).toBe('save_pdf_file')
    expect(calls[0]?.args?.suggestedName).toBe('report.pdf')
  })

  it('savePdfFile resolves {outcome:"cancelled"} when the user dismisses the panel', async () => {
    installInternals(() => Promise.resolve({ outcome: 'cancelled' }))
    const result = await savePdfFile(new Uint8Array([0x25, 0x50]), 'report.pdf')
    expect(result).toEqual({ outcome: 'cancelled' })
  })

  it('a Rust-side Err(String) surfaces as PrintBridgeError with the message', async () => {
    installInternals(() =>
      Promise.reject(new Error('Unsupported file type — only PDF documents can be saved here.')),
    )
    const err = await savePdfFile(new Uint8Array([0x3c, 0x68]), 'x.pdf').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PrintBridgeError)
    expect((err as PrintBridgeError).key).toBe('print.saveFailedDesc')
    expect((err as PrintBridgeError).message).toContain('only PDF documents')
  })

  it('a malformed envelope (no outcome) fails closed with PrintBridgeError', async () => {
    installInternals(() => Promise.resolve({ something: 'unexpected' }))
    const err = await savePdfFile(new Uint8Array([0x25, 0x50]), 'x.pdf').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PrintBridgeError)
    expect((err as PrintBridgeError).key).toBe('print.saveFailedDesc')
  })
})

// ---------------------------------------------------------------------------
// bytesToBase64 — the transport encoding
// ---------------------------------------------------------------------------

describe('ff-2b print bridge — bytesToBase64', () => {
  it('round-trips arbitrary bytes (RFC 4648 standard alphabet)', () => {
    for (const len of [0, 1, 2, 3, 255, 256, 1024]) {
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = (i * 7 + 13) % 256
      const b64 = bytesToBase64(bytes)
      expect(b64).toMatch(/^[A-Za-z0-9+/]*={0,2}$/)
      expect(Buffer.from(b64, 'base64')).toEqual(Buffer.from(bytes))
    }
  })

  it('chunks above the 32 KiB spread budget without corrupting the stream', () => {
    // A payload that CROSSES the 0x8000 chunk boundary.
    const len = 0x8000 + 17
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = (i * 31 + 7) % 256
    const b64 = bytesToBase64(bytes)
    expect(Buffer.from(b64, 'base64')).toEqual(Buffer.from(bytes))
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })
})

// ---------------------------------------------------------------------------
// downloadBytesAsFile — the plain-web download fallback
// ---------------------------------------------------------------------------

describe('ff-2b print bridge — downloadBytesAsFile (web fallback)', () => {
  const realCreateObjectURL = URL.createObjectURL
  const realRevokeObjectURL = URL.revokeObjectURL
  const realDocument = (globalThis as Record<string, unknown>).document

  interface TestAnchor {
    href: string
    download: string
    clicked: boolean
  }
  let lastAnchor: TestAnchor
  let revoked: string[]

  beforeEach(() => {
    revoked = []
    URL.createObjectURL = vi.fn(() => 'blob:medivault-test') as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url)
    }) as unknown as typeof URL.revokeObjectURL
    lastAnchor = { href: '', download: '', clicked: false }
    const anchor = {
      click: () => {
        lastAnchor.clicked = true
      },
    }
    Object.defineProperty(anchor, 'href', {
      get() {
        return lastAnchor.href
      },
      set(v: string) {
        lastAnchor.href = v
      },
      configurable: true,
    })
    Object.defineProperty(anchor, 'download', {
      get() {
        return lastAnchor.download
      },
      set(v: string) {
        lastAnchor.download = v
      },
      configurable: true,
    })
    ;(globalThis as Record<string, unknown>).document = {
      createElement: () => anchor,
      body: { appendChild: () => {}, removeChild: () => {} },
    }
  })

  afterEach(() => {
    URL.createObjectURL = realCreateObjectURL
    URL.revokeObjectURL = realRevokeObjectURL
    if (realDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document
    } else {
      ;(globalThis as Record<string, unknown>).document = realDocument
    }
    vi.restoreAllMocks()
  })

  it('downloads the bytes as an application/pdf blob anchor and revokes the object URL', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
    downloadBytesAsFile(bytes, 'MediVault-Report.pdf')
    expect(lastAnchor.clicked).toBe(true)
    expect(lastAnchor.download).toBe('MediVault-Report.pdf')
    expect(lastAnchor.href).toBe('blob:medivault-test')
    expect(revoked).toEqual(['blob:medivault-test'])
  })

  it('accepts a non-default mime type (the document viewer passes it explicitly)', () => {
    downloadBytesAsFile(new Uint8Array([0xff, 0xd8, 0xff]), 'scan.jpg', 'image/jpeg')
    expect(lastAnchor.clicked).toBe(true)
    expect(lastAnchor.download).toBe('scan.jpg')
    expect(revoked).toEqual(['blob:medivault-test'])
  })
})

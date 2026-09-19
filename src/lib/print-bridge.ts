'use client'

/**
 * Native print / PDF bridge (ff-2b) — the JS side of the Rust commands in
 * `src-tauri/src/commands/print.rs`.
 *
 * The shipped app UI is served by the local Fastify API at
 * http://127.0.0.1:3001; the `loopback-print-bridge` capability grants
 * that origin access to EXACTLY the two bridge commands. `window.print()`
 * is proven inoperative inside WKWebView, so every desktop print/save
 * action materializes a REAL PDF client-side (pdf-lib) and hands the
 * bytes to these commands:
 *
 *   openForPrint(bytes)              → temp file + macOS Preview (⌘P there)
 *   savePdfFile(bytes, suggested)   → native save panel + user-chosen path
 *
 * Mirrors the `require('@tauri-apps/api/core')` pattern of
 * `src/lib/desktop/api.ts` so the plain-web build never breaks: the
 * require is lazy AND wrapped in try/catch.
 */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

let cachedInvoke: InvokeFn | null | undefined

/** Lazily resolve the Tauri `invoke` — null outside the desktop app. */
function getInvoke(): InvokeFn | null {
  if (cachedInvoke !== undefined) return cachedInvoke
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@tauri-apps/api/core')
    cachedInvoke = typeof mod?.invoke === 'function' ? (mod.invoke as InvokeFn) : null
  } catch {
    cachedInvoke = null
  }
  return cachedInvoke
}

/**
 * True when running inside the Tauri webview with IPC available
 * (`__TAURI_INTERNALS__` is injected by the webview on every page it
 * loads — including the API-served origin, where the print-bridge
 * capability makes the two bridge commands reachable).
 */
export function nativeBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** i18n keys the callers toast when a bridge error surfaces. */
export type PrintBridgeErrorKey =
  | 'print.openFailedDesc'
  | 'print.saveFailedDesc'

/** Typed error carrying an i18n key for the toast description. */
export class PrintBridgeError extends Error {
  readonly key: PrintBridgeErrorKey

  constructor(key: PrintBridgeErrorKey, fallbackMessage: string) {
    super(fallbackMessage)
    this.name = 'PrintBridgeError'
    this.key = key
  }
}

/**
 * Base64-encode bytes without adding a dependency (chunked `btoa`).
 * `String.fromCharCode.apply` has an argument limit — 32 KiB chunks are
 * safely below every engine's spread budget.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Web fallback (no native bridge): download bytes as a file through a
 * Blob-anchor click — the only path plain browsers have.
 *
 * `pdf-lib` returns `Uint8Array<ArrayBufferLike>` while the DOM `Blob`
 * constructor demands an `ArrayBuffer`-backed `BlobPart` (TS 5.7+
 * generic-ArrayBuffer strictness). `TypedArray#slice()` is typed to
 * return a freshly allocated `Uint8Array<ArrayBuffer>`, so
 * `bytes.slice().buffer` is assignable WITHOUT a cast — the single
 * consistent approach every caller uses for its PDF download.
 */
export function downloadBytesAsFile(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/pdf',
): void {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Wire shape of the Rust `PrintOutcome` (serde tag "outcome"). */
interface OpenOutcomeWire {
  outcome?: string
  path?: string
}

/** Wire shape of the Rust `SaveOutcome` (serde tag "outcome"). */
interface SaveOutcomeWire {
  outcome?: string
  path?: string
}

/**
 * Materialize the document bytes as a temp file and open them in the OS
 * default viewer (macOS Preview) for printing. The file lives under
 * `$TMPDIR/medivault-print` with an unpredictable, PHI-free name.
 *
 * @returns the temp file path (success toast + QA verification use it)
 * @throws PrintBridgeError (key `print.openFailedDesc`) on any failure
 */
export async function openForPrint(bytes: Uint8Array): Promise<{ path: string }> {
  const invoke = getInvoke()
  if (!invoke) {
    throw new PrintBridgeError(
      'print.openFailedDesc',
      'Printing is only available in the desktop app.',
    )
  }
  let outcome: OpenOutcomeWire
  try {
    outcome = await invoke<OpenOutcomeWire>('open_for_print', {
      dataB64: bytesToBase64(bytes),
    })
  } catch (err) {
    // Rust-side Err(String) — surface it without leaking file contents.
    const detail = err instanceof Error ? err.message : String(err)
    throw new PrintBridgeError('print.openFailedDesc', detail)
  }
  if (outcome?.outcome === 'opened' && typeof outcome.path === 'string') {
    return { path: outcome.path }
  }
  throw new PrintBridgeError(
    'print.openFailedDesc',
    'The document could not be opened for printing.',
  )
}

/** Discriminated result of {@link savePdfFile}. */
export type SavePdfResult =
  | { outcome: 'saved'; path: string }
  | { outcome: 'cancelled' }

/**
 * Show the NATIVE save panel and write the PDF bytes to the path the
 * user picks (the suggested name is sanitized Rust-side: no path
 * separators, ≤200 chars, forced `.pdf`).
 *
 * @throws PrintBridgeError (key `print.saveFailedDesc`) on any failure
 */
export async function savePdfFile(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<SavePdfResult> {
  const invoke = getInvoke()
  if (!invoke) {
    throw new PrintBridgeError(
      'print.saveFailedDesc',
      'Saving as PDF is only available in the desktop app.',
    )
  }
  let outcome: SaveOutcomeWire
  try {
    outcome = await invoke<SaveOutcomeWire>('save_pdf_file', {
      dataB64: bytesToBase64(bytes),
      suggestedName,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new PrintBridgeError('print.saveFailedDesc', detail)
  }
  if (outcome?.outcome === 'cancelled') {
    return { outcome: 'cancelled' }
  }
  if (outcome?.outcome === 'saved' && typeof outcome.path === 'string') {
    return { outcome: 'saved', path: outcome.path }
  }
  throw new PrintBridgeError(
    'print.saveFailedDesc',
    'The PDF could not be saved.',
  )
}

/** Test hook — drop the memoized `invoke` resolution. */
export function __resetPrintBridgeCache(): void {
  cachedInvoke = undefined
}

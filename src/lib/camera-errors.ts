/**
 * Camera failure classification for the scan-capture surface.
 *
 * getUserMedia rejects with DOMException (or DOMException-like) errors whose
 * `name` identifies the failure class. The scan view maps each class to ONE
 * doctor-friendly, actionable message — never a stack trace or a raw error
 * string. This module is intentionally PURE (no DOM access, no React, no
 * i18n imports) so it stays trivially unit-testable.
 */

export type CameraErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'not-supported'
  | 'unknown'

/** The DOMException `name` values each CameraErrorKind covers. */
const ERROR_NAMES: Record<CameraErrorKind, readonly string[]> = {
  // User/system denied the permission prompt (or it was pre-blocked).
  'permission-denied': ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'],
  // No camera satisfies the request (missing device or impossible constraints).
  'no-camera': ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'],
  // A camera exists but the stream could not be started (in use by another app / hardware failure / start aborted).
  'camera-busy': ['NotReadableError', 'TrackStartError', 'AbortError'],
  // getUserMedia is missing or was called incorrectly (no secure context / no implementation).
  'not-supported': ['TypeError'],
  // Anything else — a deliberately small bucket, shown as a generic retry message.
  'unknown': [],
}

export function classifyCameraError(err: unknown): CameraErrorKind {
  if (err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string') {
    const name = (err as { name: string }).name
    for (const kind of Object.keys(ERROR_NAMES) as CameraErrorKind[]) {
      if (ERROR_NAMES[kind].includes(name)) {
        return kind
      }
    }
  }
  return 'unknown'
}

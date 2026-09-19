/**
 * Unit tests for the camera failure classifier (src/lib/camera-errors.ts).
 *
 * The scan view's doctor-facing error UX depends on classifyCameraError
 * mapping every getUserMedia rejection class to exactly ONE actionable
 * message. These tests pin the mapping for every DOMException name the
 * web platform (and its legacy aliases) can surface, plus the unknown
 * fallback — no DOM or React required, the module is pure.
 */
import { describe, it, expect } from 'vitest'
import { classifyCameraError, type CameraErrorKind } from '@/lib/camera-errors'

/** Build a DOMException-like error the way browsers hand them to catch blocks. */
function namedError(name: string, message = 'getUserMedia failed'): Error {
  return Object.assign(new Error(message), { name })
}

describe('classifyCameraError — permission failures', () => {
  it('classifies NotAllowedError (permission prompt denied or pre-blocked)', () => {
    expect(classifyCameraError(namedError('NotAllowedError'))).toBe('permission-denied')
  })

  it('classifies the legacy PermissionDeniedError alias', () => {
    expect(classifyCameraError(namedError('PermissionDeniedError'))).toBe('permission-denied')
  })

  it('classifies SecurityError (permission blocked at the OS level)', () => {
    expect(classifyCameraError(namedError('SecurityError'))).toBe('permission-denied')
  })
})

describe('classifyCameraError — no camera available', () => {
  it('classifies NotFoundError (no camera device satisfies the request)', () => {
    expect(classifyCameraError(namedError('NotFoundError'))).toBe('no-camera')
  })

  it('classifies the legacy DevicesNotFoundError alias', () => {
    expect(classifyCameraError(namedError('DevicesNotFoundError'))).toBe('no-camera')
  })

  it('classifies OverconstrainedError (impossible constraints, no device matches)', () => {
    expect(classifyCameraError(namedError('OverconstrainedError'))).toBe('no-camera')
  })

  it('classifies the legacy ConstraintNotSatisfiedError alias', () => {
    expect(classifyCameraError(namedError('ConstraintNotSatisfiedError'))).toBe('no-camera')
  })
})

describe('classifyCameraError — camera exists but cannot start', () => {
  it('classifies NotReadableError (device in use or hardware failure)', () => {
    expect(classifyCameraError(namedError('NotReadableError'))).toBe('camera-busy')
  })

  it('classifies the legacy TrackStartError alias', () => {
    expect(classifyCameraError(namedError('TrackStartError'))).toBe('camera-busy')
  })

  it('classifies AbortError (stream start aborted / in-use) as camera-busy', () => {
    expect(classifyCameraError(namedError('AbortError'))).toBe('camera-busy')
  })
})

describe('classifyCameraError — capture unsupported', () => {
  it('classifies TypeError (getUserMedia missing or misused)', () => {
    expect(classifyCameraError(namedError('TypeError'))).toBe('not-supported')
  })
})

describe('classifyCameraError — unknown fallback', () => {
  it('classifies an unrecognized error name as unknown', () => {
    expect(classifyCameraError(namedError('SomeFutureBrowserError'))).toBe('unknown')
  })

  it('classifies a plain error without a name field as unknown', () => {
    expect(classifyCameraError(new Error('boom'))).toBe('unknown')
  })

  it('classifies a thrown string as unknown', () => {
    expect(classifyCameraError('NotAllowedError')).toBe('unknown')
  })

  it('classifies null/undefined as unknown', () => {
    expect(classifyCameraError(null)).toBe('unknown')
    expect(classifyCameraError(undefined)).toBe('unknown')
  })

  it('classifies an error whose name is not a string as unknown', () => {
    expect(classifyCameraError({ name: 42 })).toBe('unknown')
  })

  it('matches on the error name, not the message text', () => {
    const misleading = namedError('NotFoundError', 'NotAllowedError')
    expect(classifyCameraError(misleading)).toBe('no-camera')
  })
})

describe('classifyCameraError — the CameraErrorKind surface', () => {
  it('keeps exactly the five doctor-facing failure classes, every one reachable', () => {
    // Guards against a dead branch silently losing its i18n message pair.
    const representatives: Record<CameraErrorKind, unknown> = {
      'permission-denied': namedError('NotAllowedError'),
      'no-camera': namedError('NotFoundError'),
      'camera-busy': namedError('NotReadableError'),
      'not-supported': namedError('TypeError'),
      unknown: new Error('boom'),
    }
    for (const [kind, sample] of Object.entries(representatives)) {
      expect(classifyCameraError(sample)).toBe(kind)
    }
    expect(Object.keys(representatives)).toHaveLength(5)
  })
})

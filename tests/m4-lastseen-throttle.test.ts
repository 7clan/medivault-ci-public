import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

process.env.AUTH_JWT_SECRET = 'a'.repeat(64)

// Mock the DB before importing auth-helpers
const mockUpdate = vi.fn().mockResolvedValue({})
const mockAuthSessionFindUnique = vi.fn()
const mockUserFindUnique = vi.fn()
const mockDeviceFindFirst = vi.fn()
const mockRefreshTokenCount = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    authSession: {
      findUnique: mockAuthSessionFindUnique,
      update: mockUpdate,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
    deviceRegistration: {
      findFirst: mockDeviceFindFirst,
    },
    refreshToken: {
      count: mockRefreshTokenCount,
    },
  },
}))

// Mock @medivault/auth verifyAccessToken
vi.mock('@medivault/auth', () => ({
  verifyAccessToken: vi.fn().mockResolvedValue({
    sub: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    roleId: 'role-1',
    sessionVersion: 1,
    deviceId: null,
    familyId: null,
    sessionId: 'session-abc',
  }),
}))

// Mock next/headers to return a cookie with the session token
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ name: 'mvlt_session', value: 'fake-token' }),
  }),
}))

// Import after mocks are set up
const { getAuthSession, _resetLastSeenAtCache } = await import('@/lib/auth-helpers')

describe('getAuthSession lastSeenAt throttle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetLastSeenAtCache()
    vi.useFakeTimers()

    // Setup default DB responses for a valid session
    mockUserFindUnique.mockResolvedValue({
      id: 'user-1',
      isActive: true,
      mustChangePassword: false,
      sessionVersion: 1,
    })

    mockAuthSessionFindUnique.mockResolvedValue({
      id: 'session-abc',
      userId: 'user-1',
      deviceId: null,
      familyId: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600000),
    })

    mockUpdate.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes lastSeenAt on first call (session not in cache)', async () => {
    await getAuthSession()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'session-abc' },
      data: { lastSeenAt: expect.any(Date) },
    })
  })

  it('does NOT write lastSeenAt on subsequent rapid calls within 5 minutes', async () => {
    // First call — should write (cache is empty after reset)
    await getAuthSession()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    mockUpdate.mockClear()

    // Rapid call — should NOT write
    await getAuthSession()
    expect(mockUpdate).not.toHaveBeenCalled()

    // Another rapid call 1 minute later — still should NOT write
    vi.advanceTimersByTime(60_000)
    await getAuthSession()
    expect(mockUpdate).not.toHaveBeenCalled()

    // 4 more minutes later (total 5 min from first write minus 1ms) — still should NOT write
    vi.advanceTimersByTime(4 * 60_000 - 1000)
    await getAuthSession()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('writes lastSeenAt again after 5 minute threshold', async () => {
    // First call — writes to cache
    await getAuthSession()
    mockUpdate.mockClear()

    // Advance 5 minutes + 1ms — should write
    vi.advanceTimersByTime(300_001)
    await getAuthSession()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'session-abc' },
      data: { lastSeenAt: expect.any(Date) },
    })
  })

  it('writes lastSeenAt exactly at 5 minute threshold', async () => {
    // First call — writes to cache
    await getAuthSession()
    mockUpdate.mockClear()

    // Advance exactly 5 minutes — should write (>= check)
    vi.advanceTimersByTime(300_000)
    await getAuthSession()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('throttles independently per sessionId', async () => {
    // First call for session-abc — writes to cache
    await getAuthSession()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    mockUpdate.mockClear()

    // Switch to a different session
    const { verifyAccessToken } = await import('@medivault/auth')
    vi.mocked(verifyAccessToken).mockResolvedValueOnce({
      sub: 'user-2',
      name: 'Test User 2',
      email: 'test2@example.com',
      roleId: 'role-1',
      sessionVersion: 1,
      deviceId: null,
      familyId: null,
      sessionId: 'session-xyz',
    } as any)

    mockUserFindUnique.mockResolvedValueOnce({
      id: 'user-2',
      isActive: true,
      mustChangePassword: false,
      sessionVersion: 1,
    })

    mockAuthSessionFindUnique.mockResolvedValueOnce({
      id: 'session-xyz',
      userId: 'user-2',
      deviceId: null,
      familyId: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600000),
    })

    // Different session — should write even though session-abc was recently written
    await getAuthSession()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'session-xyz' },
      data: { lastSeenAt: expect.any(Date) },
    })
  })
})

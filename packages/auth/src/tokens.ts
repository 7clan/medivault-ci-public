/**
 * @medivault/auth — JWT Access Tokens & Refresh Token Utilities
 *
 * Uses the `jose` library for framework-independent JWT signing/verification.
 * Refresh tokens are opaque crypto-random strings hashed with SHA-256 for storage.
 */

import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { InvalidTokenError, TokenReuseError } from './errors.js'

// ─── Types ────────────────────────────────────────────────

/** Claims embedded in the access token. */
export interface AccessTokenPayload {
  /** Subject — user UUID */
  sub: string;
  /** User email address */
  email: string;
  /** User display name */
  name: string;
  /** Role UUID (null when unassigned) */
  roleId: string | null;
  /** Whether the account is active */
  isActive: boolean;
  /** Server-controlled session version — must match DB on every verification */
  sessionVersion: number;
  /** Device UUID (null for cookie-based browser sessions) */
  deviceId: string | null;
  /** Token family ID (binds access token to a refresh-token family) */
  familyId: string | null;
  /** AuthSession UUID (server-side session tracking) */
  sessionId: string | null;
  /** JWT issuer */
  iss: string;
  /** JWT audience */
  aud: string;
  /** Issued-at timestamp (seconds since epoch) */
  iat: number;
  /** Expiration timestamp (seconds since epoch) */
  exp: number;
}

/** Shape passed by callers when generating an access token. */
export interface AccessTokenInput {
  sub: string;
  email: string;
  name: string;
  roleId: string | null;
  isActive: boolean;
  sessionVersion: number;
  /** Device UUID (null for cookie-based browser sessions) */
  deviceId?: string | null;
  /** Token family ID */
  familyId?: string | null;
  /** AuthSession UUID (server-side session tracking) */
  sessionId?: string | null;
}

/** Configuration for JWT generation/verification */
export interface JwtConfig {
  /** HMAC secret */
  secret: string;
  /** Token issuer — validated on verify */
  issuer: string;
  /** Token audience — validated on verify */
  audience: string;
}

/** Default access token TTL: 15 minutes */
const DEFAULT_TTL_SECONDS = 15 * 60;

/** Default issuer */
const DEFAULT_ISSUER = 'medivault';

/** Default audience */
const DEFAULT_AUDIENCE = 'medivault-api';

/** Number of bytes for refresh tokens (48 bytes → 96 hex chars) */
const REFRESH_TOKEN_BYTES = 48;

/** Number of bytes for pairing codes (6 bytes → 12 hex chars) */
const PAIRING_CODE_BYTES = 6;

// ─── Helpers ──────────────────────────────────────────────

/**
 * Convert a raw secret string into a Uint8Array suitable for `jose`.
 */
function secretToKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// ─── Access Token ─────────────────────────────────────────

/**
 * Generate a signed JWT access token.
 *
 * @param payload        - User claims to encode in the token.
 * @param secret         - HMAC secret (shared with `verifyAccessToken`).
 * @param expiresInSeconds - Token lifetime in seconds (default 900 = 15 min).
 * @param config         - Optional issuer/audience overrides.
 * @returns The encoded JWT string.
 */
export async function generateAccessToken(
  payload: AccessTokenInput,
  secret: string,
  expiresInSeconds: number = DEFAULT_TTL_SECONDS,
  config?: Partial<JwtConfig>,
): Promise<string> {
  const key = secretToKey(secret);
  const iss = config?.issuer ?? DEFAULT_ISSUER;
  const aud = config?.audience ?? DEFAULT_AUDIENCE;

  return new SignJWT({
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    roleId: payload.roleId,
    isActive: payload.isActive,
    sessionVersion: payload.sessionVersion,
    deviceId: payload.deviceId ?? null,
    familyId: payload.familyId ?? null,
    sessionId: payload.sessionId ?? null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(iss)
    .setAudience(aud)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(key);
}

/**
 * Verify and decode a JWT access token.
 *
 * Validates: signature, expiration, issuer, audience, and algorithm (HS256 only).
 *
 * @param token  - The encoded JWT string.
 * @param secret - HMAC secret used during signing.
 * @param config - Optional issuer/audience overrides.
 * @returns The decoded payload with `iat` and `exp` as numbers.
 * @throws {InvalidTokenError} If the token is expired, malformed, or has an invalid signature.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
  config?: Partial<JwtConfig>,
): Promise<AccessTokenPayload> {
  try {
    const key = secretToKey(secret);
    const iss = config?.issuer ?? DEFAULT_ISSUER;
    const aud = config?.audience ?? DEFAULT_AUDIENCE;

    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: iss,
      audience: aud,
    });

    return {
      sub: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
      roleId: (payload.roleId as string) ?? null,
      isActive: payload.isActive as boolean,
      sessionVersion: (payload.sessionVersion as number) ?? 0,
      deviceId: (payload.deviceId as string) ?? null,
      familyId: (payload.familyId as string) ?? null,
      sessionId: (payload.sessionId as string) ?? null,
      iss: payload.iss as string,
      aud: payload.aud as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (err) {
    const isJoseError = err && typeof err === 'object' && 'code' in err;
    if (isJoseError && (err as { code: string }).code === 'ERR_JWT_EXPIRED') {
      throw new TokenReuseError('Token has expired');
    }
    throw new InvalidTokenError('Invalid or expired token');
  }
}

// ─── Refresh Token ────────────────────────────────────────

/**
 * Generate a new cryptographically-random refresh token.
 *
 * @returns A 96-character hex string (48 random bytes).
 */
export async function generateRefreshToken(): Promise<string> {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

/**
 * Generate a new token family ID (UUID v4).
 */
export function generateFamilyId(): string {
  return randomUUID();
}

/**
 * Compute a SHA-256 hash of a token for database storage.
 */
export async function hashToken(token: string): Promise<string> {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Verify that a raw token matches a stored SHA-256 hash using timing-safe comparison.
 */
export async function verifyTokenHash(
  token: string,
  hash: string,
): Promise<boolean> {
  const computed = await hashToken(token);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  const buf = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    buf[i] = a[i] ^ b[i];
  }
  return buf.every((byte) => byte === 0);
}

/**
 * Generate a short-lived pairing code.
 * @returns A 12-character hex string (6 random bytes).
 */
export function generatePairingCode(): string {
  return randomBytes(PAIRING_CODE_BYTES).toString('hex');
}

/**
 * Generate a CSRF token.
 * @returns A 32-byte hex string.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Verify a CSRF token using timing-safe comparison.
 */
export function verifyCsrfToken(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length) return false;
  const buf = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    buf[i] = a[i] ^ b[i];
  }
  return buf.every((byte) => byte === 0);
}

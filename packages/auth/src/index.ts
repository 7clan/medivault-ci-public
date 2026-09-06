/**
 * @medivault/auth — Barrel Exports
 *
 * Framework-independent authentication & authorization package.
 * No imports from Next.js, Prisma, or any web framework.
 */

// ─── Errors ─────────────────────────────────────────────
export {
  AuthError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  AccountLockedError,
  InvalidTokenError,
  TokenReuseError,
  SetupAlreadyCompletedError,
  CsrfError,
  MustChangePasswordError,
} from './errors.js'

// ─── Password ───────────────────────────────────────────
export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from './password.js'
export type { PasswordValidationResult } from './password'

// ─── Tokens ─────────────────────────────────────────────
export {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  generateFamilyId,
  hashToken,
  verifyTokenHash,
  generatePairingCode,
  generateCsrfToken,
  verifyCsrfToken,
} from './tokens.js'
export type { AccessTokenPayload, AccessTokenInput, JwtConfig } from './tokens'

// ─── RBAC ───────────────────────────────────────────────
export {
  PERMISSIONS,
  ROLES,
  hasPermission,
  hasAnyPermission,
  hasRole,
} from './rbac.js'
export type { GetPermissionsForRole } from './rbac'

// ─── Rate Limiting ──────────────────────────────────────
export {
  RateLimiter,
  rateLimiter,
  RATE_LIMITS,
} from './rate-limit.js'
export type { RateLimitResult } from './rate-limit'

// ─── Crypto Pairing ───────────────────────────────
export {
  generateChallengeNonce,
  verifySignature,
} from './crypto-pairing.js'

// ─── Audit ──────────────────────────────────────────────
export {
  audit,
  SECURITY_ACTIONS,
} from './audit.js'
export type { AuditParams, CreateAuditLogFn, SecurityAction } from './audit'

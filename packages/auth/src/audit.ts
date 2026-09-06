/**
 * @medivault/auth — Audit Logging Helper
 *
 * Framework-independent audit logging that delegates persistence to
 * a caller-supplied function (dependency injection). This keeps the
 * module free of Prisma or any other ORM dependency.
 */

// ─── Security Action Constants ──────────────────────────

/** Predefined security-related audit actions. */
export const SECURITY_ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ACCOUNT_ENABLE: 'ACCOUNT_ENABLE',
  ACCOUNT_DISABLE: 'ACCOUNT_DISABLE',
  ROLE_CHANGE: 'ROLE_CHANGE',
  PERMISSION_CHANGE: 'PERMISSION_CHANGE',
  DEVICE_REGISTER: 'DEVICE_REGISTER',
  DEVICE_REVOKE: 'DEVICE_REVOKE',
  SESSION_REVOKE: 'SESSION_REVOKE',
  ACCOUNT_LOCK: 'ACCOUNT_LOCK',
  ACCOUNT_UNLOCK: 'ACCOUNT_UNLOCK',
  TOKEN_FAMILY_REVOKE: 'TOKEN_FAMILY_REVOKE',
  DEVICE_PAIR_REQUEST: 'DEVICE_PAIR_REQUEST',
  DEVICE_PAIR_APPROVE: 'DEVICE_PAIR_APPROVE',
  DEVICE_PAIR_REJECT: 'DEVICE_PAIR_REJECT',
  SETUP_COMPLETED: 'SETUP_COMPLETED',
  TEMP_PASSWORD_SET: 'TEMP_PASSWORD_SET',
} as const;

/** Type representing the string literal union of all security actions. */
export type SecurityAction = (typeof SECURITY_ACTIONS)[keyof typeof SECURITY_ACTIONS];

// ─── Types ───────────────────────────────────────────────

/** Parameters for creating an audit log entry. */
export interface AuditParams {
  /** ID of the user performing the action */
  actorId: string;
  /** The action being audited (e.g. SECURITY_ACTIONS.LOGIN_SUCCESS) */
  action: string;
  /** Type of entity affected (e.g. 'User', 'Device', 'Session') */
  entityType: string;
  /** UUID of the affected entity */
  entityId: string;
  /** Optional structured metadata about the action */
  details?: Record<string, unknown>;
  /** Optional caller IP address */
  ipAddress?: string;
  /** Optional caller User-Agent header */
  userAgent?: string;
}

/**
 * Function signature for persisting an audit log entry.
 * Implemented by the consuming application (e.g. a Prisma create call).
 */
export type CreateAuditLogFn = (params: AuditParams) => Promise<void>;

// ─── Implementation ───────────────────────────────────────

/**
 * Create an audit log entry via the injected persistence function.
 *
 * This is a thin wrapper that ensures a consistent shape and makes
 * the call fire-and-forget friendly. Errors from `createFn` are
 * re-thrown so callers can decide whether to handle them.
 *
 * @param createFn - Function that persists the audit log (DI).
 * @param params   - Audit event details.
 * @example
 * ```ts
 * import { audit, SECURITY_ACTIONS } from '@medivault/auth';
 *
 * await audit(prismaAuditAdapter, {
 *   actorId: user.id,
 *   action: SECURITY_ACTIONS.LOGIN_SUCCESS,
 *   entityType: 'User',
 *   entityId: user.id,
 *   ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
 *   userAgent: req.headers.get('user-agent') ?? undefined,
 * });
 * ```
 */
export async function audit(
  createFn: CreateAuditLogFn,
  params: AuditParams,
): Promise<void> {
  await createFn(params);
}

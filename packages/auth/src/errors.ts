/**
 * @medivault/auth — Custom Authentication & Authorization Error Classes
 *
 * Framework-independent error hierarchy for auth-related failures.
 * Each error carries an HTTP status code for use in API routes.
 */

/**
 * Base error class for all authentication/authorization failures.
 * Carries an HTTP status code for use in API responses.
 */
export class AuthError extends Error {
  /** HTTP status code associated with this error */
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when credentials are invalid or missing (HTTP 401).
 */
export class AuthenticationError extends AuthError {
  constructor(message: string = 'Authentication required') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when an authenticated user lacks the required permission (HTTP 403).
 */
export class AuthorizationError extends AuthError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

/**
 * Thrown when a rate limit is exceeded (HTTP 429).
 * Includes `retryAfterMs` to communicate when the client may retry.
 */
export class RateLimitError extends AuthError {
  /** Milliseconds until the rate limit window resets */
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown when an account is locked due to too many failed attempts (HTTP 423).
 * Includes `retryAfterMs` to communicate when the lock expires.
 */
export class AccountLockedError extends AuthError {
  /** Milliseconds until the account lock expires */
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message, 423);
    this.name = 'AccountLockedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown when a JWT or refresh token is malformed or expired (HTTP 401).
 */
export class InvalidTokenError extends AuthError {
  constructor(message: string = 'Invalid or expired token') {
    super(message, 401);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Thrown when a previously-used refresh token is presented again,
 * indicating possible token theft (HTTP 401).
 */
export class TokenReuseError extends AuthError {
  constructor(message: string = 'Token reuse detected — possible security breach') {
    super(message, 401);
    this.name = 'TokenReuseError';
  }
}

/**
 * Thrown when an initial-setup action is attempted after setup has
 * already been completed (HTTP 409).
 */
export class SetupAlreadyCompletedError extends AuthError {
  constructor(message: string = 'Initial setup has already been completed') {
    super(message, 409);
    this.name = 'SetupAlreadyCompletedError';
  }
}

/**
 * Thrown when CSRF validation fails (HTTP 403).
 */
export class CsrfError extends AuthError {
  constructor(message: string = 'CSRF validation failed') {
    super(message, 403);
    this.name = 'CsrfError';
  }
}

/**
 * Thrown when a user must change their password before proceeding (HTTP 403).
 */
export class MustChangePasswordError extends AuthError {
  constructor(message: string = 'Password change required') {
    super(message, 403);
    this.name = 'MustChangePasswordError';
  }
}

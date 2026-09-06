/**
 * @medivault/auth — Password Hashing & Validation
 *
 * Uses bcryptjs for secure password hashing (cost factor 12).
 * Includes a strength validator for enforcing password policies.
 */

import bcrypt from 'bcryptjs';

/** Bcrypt cost factor — 12 provides a good balance of security vs. performance */
const BCRYPT_ROUNDS = 12;

/** Minimum password length */
const MIN_LENGTH = 10;

/** Character-class regexes used by the strength validator */
const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_DIGIT = /[0-9]/;
const HAS_SPECIAL = /[^A-Za-z0-9]/;

/**
 * Hash a plaintext password using bcrypt.
 *
 * @param plain - The plaintext password to hash.
 * @returns A bcrypt hash string suitable for storage.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 *
 * @param plain - The plaintext password provided by the user.
 * @param hash  - The stored bcrypt hash.
 * @returns `true` when the password matches, `false` otherwise.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Result of password-strength validation.
 */
export interface PasswordValidationResult {
  /** Whether the password meets all policy requirements */
  valid: boolean;
  /** Human-readable descriptions of each failed requirement */
  errors: string[];
}

/**
 * Validate password strength against MediVault policy.
 *
 * Requirements:
 * - Minimum 10 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character (non-alphanumeric)
 *
 * @param password - The plaintext password to validate.
 * @returns An object with `valid` flag and an array of error messages.
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters long`);
  }
  if (!HAS_UPPERCASE.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!HAS_LOWERCASE.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!HAS_DIGIT.test(password)) {
    errors.push('Password must contain at least one digit');
  }
  if (!HAS_SPECIAL.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return { valid: errors.length === 0, errors };
}

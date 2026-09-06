/**
 * @medivault/auth — Role-Based Access Control (RBAC)
 *
 * Framework-independent permission & role helpers.
 * Uses dependency injection for permission lookups so this module
 * never imports Prisma or any other ORM directly.
 */

// ─── Permission Definitions ─────────────────────────────

/**
 * Complete map of every permission in the system.
 * Keys are dot-notation permission identifiers; values are human-readable descriptions.
 */
export const PERMISSIONS: Record<string, string> = {
  // Patient
  'patient:view': 'View patient records',
  'patient:create': 'Create new patient records',
  'patient:edit': 'Edit existing patient records',
  'patient:delete': 'Delete patient records (soft-delete)',

  // Document
  'document:view': 'View documents',
  'document:upload': 'Upload new documents',
  'document:delete': 'Delete documents (soft-delete)',

  // Clinical Notes
  'notes:view': 'View clinical notes',
  'notes:create': 'Create clinical notes',
  'notes:edit': 'Edit clinical notes',
  'notes:delete': 'Delete clinical notes',

  // Visits
  'visits:view': 'View visits',
  'visits:create': 'Create new visits',
  'visits:edit': 'Edit existing visits',
  'visits:delete': 'Delete visits',

  // Prescriptions
  'prescriptions:view': 'View prescriptions',
  'prescriptions:create': 'Create prescriptions',
  'prescriptions:edit': 'Edit prescriptions',
  'prescriptions:delete': 'Delete prescriptions',

  // Reports
  'reports:view': 'View reports',
  'reports:generate': 'Generate new reports',

  // Backup
  'backup:view': 'View backup history',
  'backup:create': 'Create new backups',
  'backup:restore': 'Restore from a backup',

  // Users
  'users:view': 'View user accounts',
  'users:create': 'Create new user accounts',
  'users:edit': 'Edit user accounts',
  'users:delete': 'Delete user accounts',

  // Device
  'device:view': 'View registered devices',
  'device:manage': 'Register / revoke devices',

  // Audit
  'audit:view': 'View audit log entries',

  // Purge
  'purge:approve': 'Approve permanent data purge',
} as const;

/** All permission keys as an array — useful for the Admin role. */
const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

// ─── Role Definitions ───────────────────────────────────

/**
 * Default permission sets for each built-in role.
 * Keys are role names; values are arrays of permission identifiers.
 *
 * These defaults are used for seed data and fallback checks.
 * At runtime the authoritative source is the RolePermission table.
 */
export const ROLES: Record<string, string[]> = {
  Admin: [...ALL_PERMISSIONS],

  Doctor: [
    'patient:view', 'patient:create', 'patient:edit',
    'document:view', 'document:upload',
    'notes:view', 'notes:create', 'notes:edit', 'notes:delete',
    'visits:view', 'visits:create', 'visits:edit', 'visits:delete',
    'prescriptions:view', 'prescriptions:create', 'prescriptions:edit', 'prescriptions:delete',
    'reports:view', 'reports:generate',
    'backup:view',
  ],

  Assistant: [
    'patient:view',
    'document:view',
    'notes:view',
    'visits:view',
    'prescriptions:view',
    'reports:view',
  ],

  ReadOnly: [
    'patient:view',
    'document:view',
    'notes:view',
    'visits:view',
    'prescriptions:view',
    'reports:view',
  ],
} as const;

// ─── Dependency-Injection Types ─────────────────────────

/**
 * Function signature for fetching permissions assigned to a role.
 * Implemented by the consuming application (e.g. a Prisma query).
 */
export type GetPermissionsForRole = (roleId: string) => Promise<string[]>;

// ─── Permission Check Helpers ───────────────────────────

/**
 * Check whether a user's permission set includes a single required permission.
 *
 * @param userPermissions     - Array of permission identifiers the user currently holds.
 * @param requiredPermission  - The single permission that is required.
 * @returns `true` if the user has the permission.
 */
export function hasPermission(
  userPermissions: string[],
  requiredPermission: string,
): boolean {
  return userPermissions.includes(requiredPermission);
}

/**
 * Check whether a user's permission set includes **at least one** of the
 * required permissions (OR logic).
 *
 * @param userPermissions      - Array of permission identifiers the user currently holds.
 * @param requiredPermissions  - Array of permissions — only one needs to match.
 * @returns `true` if the user has any of the listed permissions.
 */
export function hasAnyPermission(
  userPermissions: string[],
  requiredPermissions: string[],
): boolean {
  return requiredPermissions.some((p) => userPermissions.includes(p));
}

/**
 * Check whether the user's role name matches a required role name.
 *
 * @param userRoleName   - The user's current role name (may be `null` if unassigned).
 * @param requiredRole   - The role name that is required.
 * @returns `true` if the user's role matches.
 */
export function hasRole(
  userRoleName: string | null,
  requiredRole: string,
): boolean {
  return userRoleName === requiredRole;
}

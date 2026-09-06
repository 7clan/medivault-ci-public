/**
 * MediVault — Route-Permission Registry
 *
 * Documents every API route and its required permission.
 * This is the single source of truth for route authorization.
 */

export interface RoutePermission {
  method: string
  path: string
  permission?: string      // single permission
  permissions?: string[]   // any-of list
  role?: string            // exact role match
  public?: boolean         // no auth required
  allowForcedPwChange?: boolean // allow mustChangePassword users
}

/**
 * Complete registry of all API routes and their authorization requirements.
 * Unlisted routes are not exposed.
 */
export const ROUTE_PERMISSIONS: RoutePermission[] = [
  // ─── Auth (public) ────────────────────────────────
  { method: 'POST',   path: '/api/auth/login',                public: true },
  { method: 'POST',   path: '/api/auth/refresh',              public: true },
  { method: 'GET',    path: '/api/auth/setup',                public: true },
  { method: 'POST',   path: '/api/auth/setup',                public: true },

  // ─── Auth — Mobile (public, device must be paired) ──
  { method: 'POST',   path: '/api/auth/mobile/challenge',    public: true },
  { method: 'POST',   path: '/api/auth/mobile/login',        public: true },
  { method: 'POST',   path: '/api/auth/mobile/refresh',      public: true },

  // ─── Auth (authenticated) ────────────────────────
  { method: 'GET',    path: '/api/auth/me',                   permission: undefined }, // just auth required
  { method: 'POST',   path: '/api/auth/logout',               permission: undefined },
  { method: 'POST',   path: '/api/auth/sessions/revoke-all',  permission: undefined },
  { method: 'PUT',    path: '/api/auth/password',             permission: undefined, allowForcedPwChange: true },

  // ─── Device pairing ─────────────────────────────
  { method: 'POST',   path: '/api/auth/devices/pair/request',  permission: 'device:manage' },
  { method: 'POST',   path: '/api/auth/devices/pair/approve', permission: 'device:manage' },
  { method: 'POST',   path: '/api/auth/devices/pair/claim',   public: true },
  { method: 'GET',    path: '/api/auth/devices',               permission: 'device:view' },
  { method: 'POST',   path: '/api/auth/devices',               permission: 'device:manage' },
  { method: 'DELETE', path: '/api/auth/devices/[id]',          permission: 'device:manage' },

  // ─── Patients ───────────────────────────────────
  { method: 'GET',    path: '/api/patients',                  permission: 'patient:view' },
  { method: 'POST',   path: '/api/patients',                  permission: 'patient:create' },
  { method: 'GET',    path: '/api/patients/export',           permission: 'patient:view' },
  { method: 'POST',   path: '/api/patients/import',           permission: 'patient:create' },
  { method: 'GET',    path: '/api/patients/[id]',             permission: 'patient:view' },
  { method: 'PUT',    path: '/api/patients/[id]',             permission: 'patient:edit' },
  { method: 'DELETE', path: '/api/patients/[id]',             permission: 'patient:delete' },
  { method: 'GET',    path: '/api/patients/[id]/documents',   permission: 'document:view' },
  { method: 'POST',   path: '/api/patients/[id]/documents',   permission: 'document:upload' },
  { method: 'GET',    path: '/api/patients/[id]/visits',      permission: 'visits:view' },
  { method: 'GET',    path: '/api/patients/[id]/timeline',    permission: 'patient:view' },

  // ─── Documents ──────────────────────────────────
  { method: 'GET',    path: '/api/documents/[id]',             permission: 'document:view' },
  { method: 'PUT',    path: '/api/documents/[id]',             permission: 'document:edit' },
  { method: 'DELETE', path: '/api/documents/[id]',             permission: 'document:delete' },
  { method: 'GET',    path: '/api/documents/[id]/view',        permission: 'document:view' },
  { method: 'GET',    path: '/api/documents/[id]/annotations', permission: 'notes:view' },
  { method: 'POST',   path: '/api/documents/[id]/annotations', permission: 'notes:create' },
  { method: 'POST',   path: '/api/documents/[id]/restore',     permission: 'backup:restore' },

  // ─── Notes ──────────────────────────────────────
  { method: 'GET',    path: '/api/notes',                      permission: 'notes:view' },
  { method: 'POST',   path: '/api/notes',                      permission: 'notes:create' },
  { method: 'PUT',    path: '/api/notes/[id]',                 permission: 'notes:edit' },
  { method: 'DELETE', path: '/api/notes/[id]',                 permission: 'notes:delete' },

  // ─── Visits ─────────────────────────────────────
  { method: 'GET',    path: '/api/visits',                     permission: 'visits:view' },
  { method: 'POST',   path: '/api/visits',                     permission: 'visits:create' },
  { method: 'GET',    path: '/api/visits/[id]',                permission: 'visits:view' },
  { method: 'PUT',    path: '/api/visits/[id]',                permission: 'visits:edit' },
  { method: 'DELETE', path: '/api/visits/[id]',                permission: 'visits:delete' },

  // ─── Prescriptions ──────────────────────────────
  { method: 'GET',    path: '/api/prescriptions',              permission: 'prescriptions:view' },
  { method: 'POST',   path: '/api/prescriptions',              permission: 'prescriptions:create' },
  { method: 'GET',    path: '/api/prescriptions/[id]',         permission: 'prescriptions:view' },
  { method: 'PUT',    path: '/api/prescriptions/[id]',         permission: 'prescriptions:edit' },
  { method: 'DELETE', path: '/api/prescriptions/[id]',         permission: 'prescriptions:delete' },

  // ─── Annotations ────────────────────────────────
  { method: 'PUT',    path: '/api/annotations/[id]',           permission: 'notes:edit' },
  { method: 'DELETE', path: '/api/annotations/[id]',           permission: 'notes:delete' },

  // ─── Reports ────────────────────────────────────
  { method: 'POST',   path: '/api/reports',                    permission: 'reports:generate' },

  // ─── Backup ─────────────────────────────────────
  { method: 'GET',    path: '/api/backup',                     permission: 'backup:view' },

  // ─── Users (admin) ──────────────────────────────
  { method: 'GET',    path: '/api/users',                      permission: 'users:view' },
  { method: 'POST',   path: '/api/users',                      permission: 'users:create' },
  { method: 'GET',    path: '/api/users/[id]',                 permission: 'users:view' },
  { method: 'PATCH',  path: '/api/users/[id]',                 permission: 'users:edit' },
  { method: 'DELETE', path: '/api/users/[id]',                 permission: 'users:delete' },
  { method: 'POST',   path: '/api/users/[id]/reset-password', permission: 'users:edit' },
  { method: 'POST',   path: '/api/users/[id]/enable',         permission: 'users:edit' },
  { method: 'POST',   path: '/api/users/[id]/disable',        permission: 'users:edit' },

  // ─── Roles ──────────────────────────────────────
  { method: 'GET',    path: '/api/roles',                      permission: 'users:view' },
  { method: 'PUT',    path: '/api/roles/[id]/permissions',    permission: 'users:edit' },

  // ─── Stats ──────────────────────────────────────
  { method: 'GET',    path: '/api/stats',                      permission: 'patient:view' },

  // ─── Root API ───────────────────────────────────
  { method: 'GET',    path: '/api',                            public: true },
]
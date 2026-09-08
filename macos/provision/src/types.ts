/**
 * Shared types for the MediVault macOS provisioner.
 *
 * The provisioner re-implements (natively, in Node 22) the behavioral
 * contract of the frozen Windows `install-postgres.ps1` 4-state machine:
 *
 *   CLEAN                  — no cluster, no markers: full first-run bootstrap.
 *   VALID_EXISTING         — cluster + valid provisioned marker: verify +
 *                            idempotent migrations. NEVER re-initdb.
 *   RECOVERABLE_INCOMPLETE — pending marker + healthy cluster whose
 *                            APPLICATION-DATABASE provisioning (role/db/
 *                            migrations) was interrupted: resume exactly
 *                            the missing pieces. PostgreSQL itself is never
 *                            reinstalled or reinitialized.
 *   INCOMPLETE_EXISTING    — contradictory/corrupt state: FAIL CLOSED,
 *                            nothing altered, manual intervention. NEVER
 *                            auto re-init (a partially-initialized cluster
 *                            must never be silently destroyed).
 *
 * Secrets: arrive via environment injection from the supervisor
 * (MV_PG_SUPER_PASSWORD / MV_PG_APP_PASSWORD). The provisioner NEVER reads
 * or writes the Keychain and never logs secret values.
 */

/** The non-secret half of the shared supervisor/provisioner config. */
export interface SupervisorConfig {
  version: number;
  paths: {
    /** Absolute OR `Contents/`-bundle-relative (the shipped production
     * shape — resolved against the app-bundle root derived from the
     * config's own location; see resolveConfigPath in config.ts). */
    pg_bundle: string;
    node_binary: string;
    api_entry: string;
    api_working_dir?: string;
    /** Optional — defaults to ~/Library/Application Support/MediVault
     * (per-user, applied at load; the shipped config carries no user
     * identity). */
    app_support_dir?: string;
    /** Optional — defaults to ~/Library/Logs/MediVault. */
    log_dir?: string;
  };
  postgres: {
    /** Optional — defaults to 127.0.0.1 (same as the supervisor schema). */
    host?: string;
    port: number;
    /** Optional — defaults to "postgres" (same as the supervisor schema). */
    superuser?: string;
    app_user: string;
    app_database: string;
    /** Optional — defaults to PostgreSQL/17/data. */
    pgdata_rel?: string;
  };
  api: {
    host: string;
    port: number;
    allowed_origins?: string;
  };
  secrets: { source: string };
  provisioner?: {
    entry: string;
    prisma_cli: string;
    prisma_schema: string;
    timeout_sec?: number;
  };
  limits?: Record<string, number>;
}

/** provisioned.json — the completion marker (the trust anchor). */
export interface ProvisionedMarker {
  schema: 1;
  status: 'complete';
  pgMajor: number;
  port: number;
  appUser: string;
  appDatabase: string;
  createdAt: string;
  updatedAt: string;
}

/** provision-pending.json — the interruption signal (crash-safe stages). */
export interface PendingMarker {
  schema: 1;
  status: 'pending';
  pgMajor: number;
  port: number;
  appUser: string;
  appDatabase: string;
  startedAt: string;
  stages: {
    initdb: boolean;
    server: boolean;
    role: boolean;
    database: boolean;
    migrations: boolean;
  };
}

export type Classification =
  | 'CLEAN'
  | 'VALID_EXISTING'
  | 'PENDING'
  | 'INCOMPLETE_EXISTING';

export interface ClassificationResult {
  state: Classification;
  /** Machine-readable detail for logs/CI. */
  detail: string;
  /** True when a stale pending marker sits on top of a complete install. */
  stalePending: boolean;
  pendingStages?: PendingMarker['stages'];
}

/** Exit codes — stable contract (documented in the stage contract doc). */
export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_CONFIG = 4;
export const EXIT_INCOMPLETE_EXISTING = 5;
export const EXIT_VERIFY_FAILED = 6;
export const EXIT_PROVISION_FAILED = 7;
export const EXIT_MISSING_SECRET = 8;

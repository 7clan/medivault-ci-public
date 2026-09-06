/**
 * The provisioner action flows.
 *
 * CLEAN                  → full bootstrap (initdb SCRAM → server → role →
 *                          database → migrations → SELECT 1 → stop →
 *                          provisioned marker → pending removed).
 * VALID_EXISTING         → online verify (server → app-role SELECT 1 →
 *                          idempotent migrations) → marker touched.
 *                          NEVER re-initdb. Credential inconsistency is
 *                          fail-closed (exit 6) — never auto-reset.
 * PENDING                → online decision (the Windows
 *                          Test-RecoverableIncompleteInstallation analog):
 *                          stale-complete marker on top → reconcile →
 *                          VALID_EXISTING; exactly-recoverable app-db
 *                          provisioning → resume; anything contradictory →
 *                          INCOMPLETE_EXISTING (exit 5, NOTHING altered).
 * INCOMPLETE_EXISTING    → exit 5, nothing altered (never auto re-init).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedProvisionerConfig } from './config.js';
import { loadConfig } from './config.js';
import { Logger } from './log.js';
import * as pg from './pg.js';
import {
  classifyOffline,
  loadMarkers,
  markerConsistent,
  pendingConsistent,
  removePending,
  touchProvisioned,
  updatePendingStages,
  writePending,
  writeProvisioned,
} from './state.js';
import {
  EXIT_INCOMPLETE_EXISTING,
  EXIT_MISSING_SECRET,
  EXIT_PROVISION_FAILED,
  EXIT_VERIFY_FAILED,
  type PendingMarker,
  type ProvisionedMarker,
} from './types.js';

export interface Secrets {
  superPassword: string | null;
  appPassword: string | null;
}

export function loadSecrets(logger: Logger, requireSuper: boolean): Secrets {
  const superPassword = process.env['MV_PG_SUPER_PASSWORD'] ?? null;
  const appPassword = process.env['MV_PG_APP_PASSWORD'] ?? null;
  const missing: string[] = [];
  if (!appPassword) missing.push('MV_PG_APP_PASSWORD');
  if (requireSuper && !superPassword) missing.push('MV_PG_SUPER_PASSWORD');
  if (missing.length > 0) {
    logger.error(`missing required secret environment variables: ${missing.join(', ')}`);
    process.exit(EXIT_MISSING_SECRET);
  }
  return { superPassword, appPassword };
}

/** The `classify` subcommand: offline classification, printed as JSON. */
export function cmdClassify(configPath: string): number {
  const { resolved } = loadConfig(configPath);
  const bundle = loadMarkers(resolved);
  const result = classifyOffline(bundle, resolved);
  const out = {
    state: result.state,
    detail: result.detail,
    pgMajor: bundle.pgMajor,
    hasCluster: bundle.hasCluster,
    provisionedMarker: bundle.provisioned !== null,
    pendingMarker: bundle.pending !== null,
    pendingStages: result.pendingStages ?? null,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

/** The `provision` subcommand: classify + act. */
export function cmdProvision(configPath: string): number {
  const { resolved } = loadConfig(configPath);
  const logger = new Logger(resolved.logDir);
  const bundle = loadMarkers(resolved);
  const offline = classifyOffline(bundle, resolved);
  logger.info(`offline classification: ${offline.state} (${offline.detail})`);

  switch (offline.state) {
    case 'CLEAN':
      return provisionClean(resolved, logger);
    case 'VALID_EXISTING':
      return verifyExisting(resolved, logger, bundle.provisioned);
    case 'PENDING':
      return resolvePending(resolved, logger, bundle.pending, bundle.provisioned, bundle.pgMajor);
    case 'INCOMPLETE_EXISTING':
      logger.error(
        `INCOMPLETE_EXISTING: ${offline.detail}. Fail closed — nothing was altered; manual intervention required. Never auto re-initialized.`,
      );
      return EXIT_INCOMPLETE_EXISTING;
  }
}

// ---------------------------------------------------------------------------
// CLEAN: full first-run bootstrap
// ---------------------------------------------------------------------------
function provisionClean(resolved: ResolvedProvisionerConfig, logger: Logger): number {
  const secrets = loadSecrets(logger, true);
  const appPassword = secrets.appPassword as string;
  const superPassword = secrets.superPassword as string;

  const pgMajor = 17;
  let pending: PendingMarker | null = writePending(resolved, pgMajor);
  logger.info('pending marker written (crash-safe staging begins)');

  if (!pg.initdb(resolved, superPassword, logger)) {
    logger.error('initdb failed — cluster left untouched; pending marker records the interruption');
    return EXIT_PROVISION_FAILED;
  }
  pending = updatePendingStages(resolved, pending, { initdb: true });
  logger.info('initdb complete (SCRAM local + host, UTF8, 127.0.0.1-only)');

  if (!pg.startServer(resolved, logger)) {
    return EXIT_PROVISION_FAILED;
  }
  pending = updatePendingStages(resolved, pending, { server: true });

  try {
    if (!pg.waitReady(resolved, logger)) {
      logger.error('pg_isready never accepted connections after start');
      return EXIT_PROVISION_FAILED;
    }

    pending = createRoleAndDatabase(resolved, superPassword, appPassword, logger, pending);
    if (pending === null) {
      return EXIT_PROVISION_FAILED;
    }

    if (!pg.migrateDeploy(resolved, appPassword, logger)) {
      return EXIT_PROVISION_FAILED;
    }
    pending = updatePendingStages(resolved, pending, { migrations: true });

    if (!proveSelectOne(resolved, appPassword, logger)) {
      return EXIT_PROVISION_FAILED;
    }
  } finally {
    // Always stop the bootstrap server session: the supervisor owns the
    // running lifecycle afterwards.
    if (!pg.stopServer(resolved, logger)) {
      logger.warn('pg_ctl stop reported failure (continuing — supervisor will need a clean start)');
    }
  }

  writeProvisioned(resolved, pgMajor);
  removePending(resolved);
  logger.info('CLEAN bootstrap complete: provisioned marker written, pending removed');
  return 0;
}

function createRoleAndDatabase(
  resolved: ResolvedProvisionerConfig,
  superPassword: string,
  appPassword: string,
  logger: Logger,
  pending: PendingMarker,
): PendingMarker | null {
  // Idempotent DDL with existence checks (also used by the recovery path).
  // psql -t -A prints EMPTY stdout when the row is absent — probe with
  // psql() directly so "absent" (empty) is never confused with "failed".
  const roleProbe = pg.psql(
    resolved,
    resolved.superuser,
    superPassword,
    'postgres',
    `SELECT 1 FROM pg_roles WHERE rolname = '${sqlLit(resolved.appUser)}'`,
    logger,
    'role existence probe',
  );
  if (!roleProbe.ok) {
    logger.error('CLEAN provisioning failed at the role existence probe');
    return null;
  }
  if (roleProbe.stdout === '') {
    const res = pg.psql(
      resolved,
      resolved.superuser,
      superPassword,
      'postgres',
      `CREATE ROLE "${sqlIdent(resolved.appUser)}" LOGIN PASSWORD '${sqlLit(appPassword)}'`,
      logger,
      'CREATE ROLE',
    );
    if (!res.ok) {
      logger.error('CLEAN provisioning failed at CREATE ROLE');
      return null;
    }
    logger.info(`app role created: ${resolved.appUser} (LOGIN, NOSUPERUSER)`);
  } else if (roleProbe.stdout === '1') {
    logger.info(`app role already exists: ${resolved.appUser}`);
  } else {
    logger.error(
      `role existence probe returned unexpected output: '${roleProbe.stdout}'`,
    );
    return null;
  }
  pending = updatePendingStages(resolved, pending, { role: true });

  const dbProbe = pg.psql(
    resolved,
    resolved.superuser,
    superPassword,
    'postgres',
    `SELECT 1 FROM pg_database WHERE datname = '${sqlLit(resolved.appDatabase)}'`,
    logger,
    'database existence probe',
  );
  if (!dbProbe.ok) {
    logger.error('CLEAN provisioning failed at the database existence probe');
    return null;
  }
  if (dbProbe.stdout === '') {
    const res = pg.psql(
      resolved,
      resolved.superuser,
      superPassword,
      'postgres',
      `CREATE DATABASE "${sqlIdent(resolved.appDatabase)}" OWNER "${sqlIdent(resolved.appUser)}"`,
      logger,
      'CREATE DATABASE',
    );
    if (!res.ok) {
      logger.error('CLEAN provisioning failed at CREATE DATABASE');
      return null;
    }
    logger.info(`app database created: ${resolved.appDatabase} (owner ${resolved.appUser})`);
  } else if (dbProbe.stdout === '1') {
    logger.info(`app database already exists: ${resolved.appDatabase}`);
  } else {
    logger.error(
      `database existence probe returned unexpected output: '${dbProbe.stdout}'`,
    );
    return null;
  }
  pending = updatePendingStages(resolved, pending, { database: true });
  return pending;
}

function proveSelectOne(
  resolved: ResolvedProvisionerConfig,
  appPassword: string,
  logger: Logger,
): boolean {
  const out = pg.psqlScalar(
    resolved,
    resolved.appUser,
    appPassword,
    resolved.appDatabase,
    'SELECT 1',
    logger,
    'app-role SELECT 1',
  );
  if (out !== '1') {
    logger.error('authenticated SELECT 1 as the app role did not return 1');
    return false;
  }
  logger.info('authenticated SELECT 1 as the app role: ok (SCRAM)');
  return true;
}

// ---------------------------------------------------------------------------
// VALID_EXISTING: online verify + idempotent migrations; NEVER re-initdb
// ---------------------------------------------------------------------------
function verifyExisting(
  resolved: ResolvedProvisionerConfig,
  logger: Logger,
  marker: ProvisionedMarker | null,
): number {
  const secrets = loadSecrets(logger, false);
  const appPassword = secrets.appPassword as string;

  if (!pg.startServer(resolved, logger)) {
    return EXIT_VERIFY_FAILED;
  }
  try {
    if (!pg.waitReady(resolved, logger)) {
      logger.error('existing cluster never accepted connections');
      return EXIT_VERIFY_FAILED;
    }
    if (!proveSelectOne(resolved, appPassword, logger)) {
      logger.error(
        'VALID_EXISTING verification failed: the stored app-role credential does not authenticate. ' +
          'Fail closed (exit 6) — credentials are never auto-reset; the cluster is never re-initialized.',
      );
      return EXIT_VERIFY_FAILED;
    }
    if (!pg.migrateDeploy(resolved, appPassword, logger)) {
      return EXIT_VERIFY_FAILED;
    }
    if (marker) {
      touchProvisioned(marker, resolved);
    }
    logger.info('VALID_EXISTING verified: cluster healthy, migrations deployed (idempotent), marker touched');
    return 0;
  } finally {
    if (!pg.stopServer(resolved, logger)) {
      logger.warn('pg_ctl stop reported failure during verify teardown');
    }
  }
}

// ---------------------------------------------------------------------------
// PENDING: the online recovery decision (Windows
// Test-RecoverableIncompleteInstallation semantics, natively)
// ---------------------------------------------------------------------------
function resolvePending(
  resolved: ResolvedProvisionerConfig,
  logger: Logger,
  pending: PendingMarker | null,
  provisioned: ProvisionedMarker | null,
  pgMajor: number | null,
): number {
  if (!pendingConsistent(pending, resolved)) {
    logger.error('pending marker present but inconsistent with the config — INCOMPLETE_EXISTING');
    return EXIT_INCOMPLETE_EXISTING;
  }
  const pend = pending as PendingMarker;

  // Case 1: stale pending marker on top of a COMPLETE install — reconcile
  // (the proven-green stale-pending semantics), then run the verify path.
  if (markerConsistent(provisioned, resolved, pgMajor)) {
    logger.info('stale pending marker on top of a complete provisioned marker — reconciling');
    removePending(resolved);
    return verifyExisting(resolved, logger, provisioned);
  }

  // Case 2: pending + no cluster — interrupted BEFORE initdb: fail closed
  // (Windows semantics: never auto re-init, even for an empty cluster).
  if (!existsSync(join(resolved.pgdata, 'PG_VERSION'))) {
    logger.error(
      'pending marker WITHOUT a cluster: provisioning was interrupted before initdb completed. ' +
        'Fail closed — the directory is left exactly as-is (never auto re-initialized).',
    );
    return EXIT_INCOMPLETE_EXISTING;
  }

  // Case 3: pending + cluster — the exact-recoverable-state probe.
  const secrets = loadSecrets(logger, true);
  const superPassword = secrets.superPassword as string;
  const appPassword = secrets.appPassword as string;

  if (pgMajor !== pend.pgMajor) {
    logger.error(
      `PG_VERSION major (${String(pgMajor)}) does not match the pending marker (${String(pend.pgMajor)}) — contradictory state`,
    );
    return EXIT_INCOMPLETE_EXISTING;
  }

  if (!pg.startServer(resolved, logger)) {
    return EXIT_INCOMPLETE_EXISTING;
  }
  try {
    if (!pg.waitReady(resolved, logger)) {
      logger.error('cluster under pending marker never accepted connections');
      return EXIT_INCOMPLETE_EXISTING;
    }

    // Phase 2: stored superuser credential must authenticate.
    const superOk = pg.psqlScalar(
      resolved,
      resolved.superuser,
      superPassword,
      'postgres',
      'SELECT 1',
      logger,
      'recovery: superuser auth probe',
    );
    if (superOk !== '1') {
      logger.error('stored superuser credential does not authenticate — fail closed');
      return EXIT_INCOMPLETE_EXISTING;
    }

    // No unexpected non-template databases (they could contain data).
    const unexpectedDbs = pg.psqlScalar(
      resolved,
      resolved.superuser,
      superPassword,
      'postgres',
      `SELECT count(*) FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres', '${sqlLit(resolved.appDatabase)}')`,
      logger,
      'recovery: unexpected-database probe',
    );
    if (unexpectedDbs !== '0') {
      logger.error(`unexpected non-template databases present (count=${unexpectedDbs ?? '?'}) — fail closed`);
      return EXIT_INCOMPLETE_EXISTING;
    }

    // No unexpected login roles.
    const unexpectedRoles = pg.psqlScalar(
      resolved,
      resolved.superuser,
      superPassword,
      'postgres',
      `SELECT count(*) FROM pg_roles WHERE rolcanlogin = true AND rolname NOT IN ('${sqlLit(resolved.superuser)}', '${sqlLit(resolved.appUser)}')`,
      logger,
      'recovery: unexpected-role probe',
    );
    if (unexpectedRoles !== '0') {
      logger.error(`unexpected login roles present (count=${unexpectedRoles ?? '?'}) — fail closed`);
      return EXIT_INCOMPLETE_EXISTING;
    }

    // Role: absent (create) OR exists with the EXACT expected identity and
    // authenticates with the stored app password. psql -t -A returns an
    // EMPTY stdout when the row is absent, so probe with psql() directly
    // to distinguish "no row" (absent) from a query failure.
    const roleProbe = pg.psql(
      resolved,
      resolved.superuser,
      superPassword,
      'postgres',
      `SELECT rolcanlogin || ',' || rolsuper || ',' || rolcreatedb || ',' || rolcreaterole FROM pg_roles WHERE rolname = '${sqlLit(resolved.appUser)}'`,
      logger,
      'recovery: role identity probe',
    );
    if (!roleProbe.ok) {
      return EXIT_INCOMPLETE_EXISTING;
    }
    let needRole = false;
    if (roleProbe.stdout === '') {
      needRole = true;
    } else {
      const roleRow = roleProbe.stdout;
      // Boolean text-cast renders 'true'/'false' (SQL `||` casts booleans
      // to text); psql's bare display form is 't'/'f'. Accept both.
      const norm = (tok: string | undefined): boolean | null => {
        if (tok === 't' || tok === 'true') return true;
        if (tok === 'f' || tok === 'false') return false;
        return null;
      };
      const [canlogin, rolsuper, rolcreatedb, rolcreaterole] = roleRow.split(',');
      const c = norm(canlogin);
      const s = norm(rolsuper);
      const cd = norm(rolcreatedb);
      const cr = norm(rolcreaterole);
      if (c !== true || s !== false || cd !== false || cr !== false) {
        logger.error(
          `role ${resolved.appUser} exists with unexpected attributes (${roleRow}) — fail closed`,
        );
        return EXIT_INCOMPLETE_EXISTING;
      }
      const roleAuth = pg.psqlScalar(
        resolved,
        resolved.appUser,
        appPassword,
        'postgres',
        'SELECT 1',
        logger,
        'recovery: app-role auth probe',
      );
      if (roleAuth !== '1') {
        logger.error('app role exists but the stored app password does not authenticate — fail closed');
        return EXIT_INCOMPLETE_EXISTING;
      }
    }

    // Database: absent (create) OR exists owned by the app user. Same
    // empty-stdout-is-absent semantics as the role probe.
    const dbProbe = pg.psql(
      resolved,
      resolved.superuser,
      superPassword,
      'postgres',
      `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${sqlLit(resolved.appDatabase)}'`,
      logger,
      'recovery: database owner probe',
    );
    if (!dbProbe.ok) {
      return EXIT_INCOMPLETE_EXISTING;
    }
    let needDb = false;
    if (dbProbe.stdout === '') {
      needDb = true;
    } else if (dbProbe.stdout !== resolved.appUser) {
      logger.error(
        `database ${resolved.appDatabase} exists but owned by '${dbProbe.stdout}' (expected '${resolved.appUser}') — fail closed`,
      );
      return EXIT_INCOMPLETE_EXISTING;
    }

    logger.info(
      `RECOVERABLE_INCOMPLETE confirmed (createRole=${String(needRole)}, createDatabase=${String(needDb)}) — resuming application-database provisioning`,
    );

    // Resume exactly the missing pieces. Cluster + credentials preserved.
    if (needRole) {
      const res = pg.psql(
        resolved,
        resolved.superuser,
        superPassword,
        'postgres',
        `CREATE ROLE "${sqlIdent(resolved.appUser)}" LOGIN PASSWORD '${sqlLit(appPassword)}'`,
        logger,
        'recovery: CREATE ROLE',
      );
      if (!res.ok) return EXIT_PROVISION_FAILED;
    }
    if (needDb) {
      const res = pg.psql(
        resolved,
        resolved.superuser,
        superPassword,
        'postgres',
        `CREATE DATABASE "${sqlIdent(resolved.appDatabase)}" OWNER "${sqlIdent(resolved.appUser)}"`,
        logger,
        'recovery: CREATE DATABASE',
      );
      if (!res.ok) return EXIT_PROVISION_FAILED;
    }
    if (!pg.migrateDeploy(resolved, appPassword, logger)) {
      return EXIT_PROVISION_FAILED;
    }
    if (!proveSelectOne(resolved, appPassword, logger)) {
      return EXIT_PROVISION_FAILED;
    }

    writeProvisioned(resolved, pgMajor ?? pend.pgMajor);
    removePending(resolved);
    logger.info('RECOVERABLE_INCOMPLETE resumed to completion: provisioned marker written');
    return 0;
  } finally {
    if (!pg.stopServer(resolved, logger)) {
      logger.warn('pg_ctl stop reported failure during recovery teardown');
    }
  }
}

// --- SQL literal/identifier escaping (defensive; values are config-fixed) ---
function sqlLit(v: string): string {
  return v.replace(/'/g, "''");
}
function sqlIdent(v: string): string {
  return v.replace(/"/g, '""');
}

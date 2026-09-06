/**
 * PostgreSQL child-process helpers (bundle binaries, absolute paths, no
 * shell). Mirrors the frozen CI harness patterns exactly:
 *   - initdb SCRAM via --pwfile (never argv, 0600 temp file)
 *   - postgresql.conf: port + 127.0.0.1-only bind
 *   - pg_ctl -w bounded start/stop (fast mode)
 *   - psql with PGPASSWORD via env only, -v ON_ERROR_STOP
 * Passwords are never logged; psql stderr is surfaced only on failure.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedProvisionerConfig } from './config.js';
import { Logger } from './log.js';

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  bin: string,
  args: string[],
  env: Record<string, string>,
  logger: Logger,
  label: string,
): RunResult {
  const res = spawnSync(bin, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const result: RunResult = {
    ok: res.status === 0,
    code: res.status,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
  if (!result.ok) {
    // Redact nothing that isn't there: env values are never echoed; psql
    // errors do not contain passwords. Surface verbatim for diagnosis.
    logger.error(
      `${label} failed (exit ${String(result.code)}): ${result.stderr.slice(0, 500)}`,
    );
  }
  return result;
}

export function initdb(
  resolved: ResolvedProvisionerConfig,
  superPassword: string,
  logger: Logger,
): boolean {
  mkdirSync(join(resolved.pgdata, '..'), { recursive: true });
  const pwFile = join(mkdtempSync(join(tmpdir(), 'mv-initdb-')), 'pw');
  try {
    writeFileSync(pwFile, `${superPassword}\n`, 'utf8');
    chmodSync(pwFile, 0o600);
    const res = run(
      resolved.bin.initdb,
      [
        '-D',
        resolved.pgdata,
        `--username=${resolved.superuser}`,
        `--pwfile=${pwFile}`,
        '--auth-local=scram-sha-256',
        '--auth-host=scram-sha-256',
        '--encoding=UTF8',
        '--no-instructions',
      ],
      {},
      logger,
      'initdb',
    );
    if (!res.ok) return false;
    appendFileSync(
      join(resolved.pgdata, 'postgresql.conf'),
      `\nport = ${resolved.pgPort}\nlisten_addresses = '${resolved.pgHost}'\n`,
      'utf8',
    );
    return true;
  } finally {
    try {
      unlinkSync(pwFile);
      rmSync(join(pwFile, '..'), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export function startServer(
  resolved: ResolvedProvisionerConfig,
  logger: Logger,
): boolean {
  const logPath = join(resolved.logDir, 'postgres-provision.log');
  const res = run(
    resolved.bin.pgCtl,
    ['-D', resolved.pgdata, '-w', '-t', '120', '-l', logPath, 'start'],
    {},
    logger,
    'pg_ctl start',
  );
  return res.ok;
}

export function stopServer(
  resolved: ResolvedProvisionerConfig,
  logger: Logger,
): boolean {
  const res = run(
    resolved.bin.pgCtl,
    ['-D', resolved.pgdata, '-m', 'fast', '-w', '-t', '60', 'stop'],
    {},
    logger,
    'pg_ctl stop',
  );
  return res.ok;
}

export function waitReady(
  resolved: ResolvedProvisionerConfig,
  logger: Logger,
  timeoutMs = 30_000,
): boolean {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = run(
      resolved.bin.pgIsready,
      ['-h', resolved.pgHost, '-p', String(resolved.pgPort)],
      {},
      logger,
      'pg_isready',
    );
    if (res.ok) return true;
    if (Date.now() >= deadline) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}

/** Run psql with PGPASSWORD (env only). */
export function psql(
  resolved: ResolvedProvisionerConfig,
  user: string,
  password: string,
  database: string,
  sql: string,
  logger: Logger,
  label: string,
): RunResult {
  return run(
    resolved.bin.psql,
    [
      '-h',
      resolved.pgHost,
      '-p',
      String(resolved.pgPort),
      '-U',
      user,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      sql,
    ],
    { PGPASSWORD: password },
    logger,
    label,
  );
}

/** psql -c returning single scalar value, or null. */
export function psqlScalar(
  resolved: ResolvedProvisionerConfig,
  user: string,
  password: string,
  database: string,
  sql: string,
  logger: Logger,
  label: string,
): string | null {
  const res = psql(resolved, user, password, database, sql, logger, label);
  if (!res.ok) return null;
  return res.stdout === '' ? null : res.stdout;
}

/** Run `prisma migrate deploy` via the configured CLI + schema. */
export function migrateDeploy(
  resolved: ResolvedProvisionerConfig,
  appPassword: string,
  logger: Logger,
): boolean {
  if (!resolved.prismaCli || !resolved.prismaSchema) {
    logger.error('migrations requested but provisioner.prisma_cli/prisma_schema are not configured');
    return false;
  }
  const databaseUrl = `postgresql://${encodeURIComponent(resolved.appUser)}:${encodeURIComponent(appPassword)}@${resolved.pgHost}:${resolved.pgPort}/${resolved.appDatabase}`;
  // The prisma CLI is a node script: spawn the configured nodeBinary with
  // the CLI JS entry; PATH keeps system tools resolvable.
  const res = spawnSync(
    resolved.nodeBinary,
    [resolved.prismaCli, 'migrate', 'deploy', '--schema', resolved.prismaSchema],
    {
      cwd: join(resolved.prismaSchema, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      timeout: 600_000,
    },
  );
  const ok = res.status === 0;
  if (!ok) {
    logger.error(
      `prisma migrate deploy failed (exit ${String(res.status)}): ${String(res.stderr).slice(0, 800)}`,
    );
  } else {
    logger.info('prisma migrate deploy: ok');
  }
  return ok;
}

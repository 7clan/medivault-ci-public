/**
 * Config resolution: the provisioner reads the SAME supervisor config JSON
 * (non-secret paths/ports/names only — secrets come from env).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupervisorConfig } from './types.js';
import { EXIT_CONFIG } from './types.js';

export interface ResolvedProvisionerConfig {
  pgBundle: string;
  nodeBinary: string;
  pgdata: string;
  pgPort: number;
  pgHost: string;
  superuser: string;
  appUser: string;
  appDatabase: string;
  appSupport: string;
  configDir: string;
  logDir: string;
  prismaCli?: string;
  prismaSchema?: string;
  /** Resolved binaries. */
  bin: {
    initdb: string;
    postgres: string;
    pgCtl: string;
    pgIsready: string;
    psql: string;
  };
}

export function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    const home = process.env['HOME'];
    if (!home) {
      throw new Error(`path uses '~' but HOME is not set: ${p}`);
    }
    return p === '~' ? home : `${home}/${p.slice(2)}`;
  }
  return p;
}

export function loadConfig(configPath: string): {
  cfg: SupervisorConfig;
  resolved: ResolvedProvisionerConfig;
} {
  if (!existsSync(configPath)) {
    fail(`config file does not exist: ${configPath}`);
  }
  let cfg: SupervisorConfig;
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf8')) as SupervisorConfig;
  } catch (err) {
    fail(`invalid config JSON in ${configPath}: ${String(err)}`);
  }
  if (cfg.version !== 1) {
    fail(`unsupported config version: ${cfg.version}`);
  }
  const appSupport = expandTilde(cfg.paths.app_support_dir);
  const logDir = expandTilde(cfg.paths.log_dir);
  const pgBundle = expandTilde(cfg.paths.pg_bundle);
  const nodeBinary = expandTilde(cfg.paths.node_binary);
  const pgdata = join(appSupport, cfg.postgres.pgdata_rel ?? 'PostgreSQL/17/data');

  const bin = {
    initdb: join(pgBundle, 'bin/initdb'),
    postgres: join(pgBundle, 'bin/postgres'),
    pgCtl: join(pgBundle, 'bin/pg_ctl'),
    pgIsready: join(pgBundle, 'bin/pg_isready'),
    psql: join(pgBundle, 'bin/psql'),
  };
  for (const [name, p] of Object.entries(bin)) {
    if (!existsSync(p)) {
      fail(`config error: pg_bundle bin/${name} missing: ${p}`);
    }
  }
  if (!existsSync(nodeBinary)) {
    fail(`config error: node_binary missing: ${nodeBinary}`);
  }

  const prov = cfg.provisioner;
  if (prov) {
    if (!existsSync(prov.entry)) {
      fail(`config error: provisioner.entry missing: ${prov.entry}`);
    }
    if (!existsSync(prov.prisma_cli)) {
      fail(`config error: provisioner.prisma_cli missing: ${prov.prisma_cli}`);
    }
    if (!existsSync(prov.prisma_schema)) {
      fail(
        `config error: provisioner.prisma_schema missing: ${prov.prisma_schema}`,
      );
    }
  }

  const resolved: ResolvedProvisionerConfig = {
    pgBundle,
    nodeBinary,
    pgdata,
    pgPort: cfg.postgres.port,
    pgHost: cfg.postgres.host ?? '127.0.0.1',
    // Same defaults as the supervisor's config schema (superuser/pgdata_rel
    // are optional there — one config document, one set of defaults).
    superuser: cfg.postgres.superuser ?? 'postgres',
    appUser: cfg.postgres.app_user,
    appDatabase: cfg.postgres.app_database,
    appSupport,
    configDir: join(appSupport, 'config'),
    logDir,
    prismaCli: prov?.prisma_cli,
    prismaSchema: prov?.prisma_schema,
    bin,
  };
  return { cfg, resolved };
}

function fail(message: string): never {
  console.error(`[provision] CONFIG-ERROR: ${message}`);
  process.exit(EXIT_CONFIG);
}

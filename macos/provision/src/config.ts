/**
 * Config resolution: the provisioner reads the SAME supervisor config JSON
 * (non-secret paths/ports/names only — secrets come from env).
 *
 * RELOCATABLE SHARED CONTRACT (production-readiness phase — mirrors
 * macos/supervisor/src/config.rs exactly):
 *   * every path value may be ABSOLUTE (CI harness), `~/`-relative
 *     (per-user), or `Contents/`-bundle-relative (the SHIPPED production
 *     config — install-location independent);
 *   * `Contents/`-prefixed values resolve against the app-bundle root
 *     DERIVED FROM THE CONFIG FILE'S OWN LOCATION (the shipped config
 *     lives at <bundle>/Contents/Resources/supervisor-config.json, so the
 *     bundle root is dirname(config)/../..);
 *   * `app_support_dir`/`log_dir` are OPTIONAL — absent means the
 *     per-user defaults ~/Library/Application Support/MediVault and
 *     ~/Library/Logs/MediVault (the shipped config embeds no user
 *     identity).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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

/** The app-bundle root derived from the CONFIG FILE location: the shipped
 * config lives at <bundle>/Contents/Resources/supervisor-config.json, so
 * the bundle root is dirname(config)/../.. (lexical, no fs access). */
export function bundleRootFromConfigPath(configPath: string): string {
  return resolve(dirname(resolve(configPath)), '..', '..');
}

/** Per-user default for paths.app_support_dir (applied when absent —
 * same value as the supervisor's Rust schema). */
const DEFAULT_APP_SUPPORT = '~/Library/Application Support/MediVault';
/** Per-user default for paths.log_dir. */
const DEFAULT_LOG_DIR = '~/Library/Logs/MediVault';

/** Resolve ONE config path value: tilde expansion first, then `Contents/`
 * — prefix resolution against the config-derived bundle root; absolute
 * values pass through unchanged. Same order/semantics as the Rust side. */
export function resolveConfigPath(
  field: string,
  value: string,
  bundleRoot: string,
): string {
  const expanded = expandTilde(value);
  if (expanded === 'Contents' || expanded.startsWith('Contents/')) {
    return join(bundleRoot, expanded);
  }
  if (!isAbsolute(expanded)) {
    throw new Error(
      `config error: paths.${field}: not absolute, not ~/-relative, not Contents/-relative: ${value}`,
    );
  }
  return expanded;
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
  // The bundle root for Contents/-relative values comes from the config's
  // OWN location (the shipped in-bundle shape). Absolute/tilde values are
  // unaffected by this derivation.
  const bundleRoot = bundleRootFromConfigPath(configPath);
  const rp = (field: string, value: string | undefined, fallback?: string): string => {
    if (value === undefined) {
      if (fallback !== undefined) return resolveConfigPath(field, fallback, bundleRoot);
      fail(`config error: paths.${field} is required (missing in ${configPath})`);
    }
    return resolveConfigPath(field, value, bundleRoot);
  };
  const appSupport = rp('app_support_dir', cfg.paths.app_support_dir, DEFAULT_APP_SUPPORT);
  const logDir = rp('log_dir', cfg.paths.log_dir, DEFAULT_LOG_DIR);
  const pgBundle = rp('pg_bundle', cfg.paths.pg_bundle);
  const nodeBinary = rp('node_binary', cfg.paths.node_binary);
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
    const provEntry = resolveConfigPath('provisioner.entry', prov.entry, bundleRoot);
    const provPrismaCli = resolveConfigPath('provisioner.prisma_cli', prov.prisma_cli, bundleRoot);
    const provPrismaSchema = resolveConfigPath(
      'provisioner.prisma_schema',
      prov.prisma_schema,
      bundleRoot,
    );
    if (!existsSync(provEntry)) {
      fail(`config error: provisioner.entry missing: ${provEntry}`);
    }
    if (!existsSync(provPrismaCli)) {
      fail(`config error: provisioner.prisma_cli missing: ${provPrismaCli}`);
    }
    if (!existsSync(provPrismaSchema)) {
      fail(`config error: provisioner.prisma_schema missing: ${provPrismaSchema}`);
    }
    prov.entry = provEntry;
    prov.prisma_cli = provPrismaCli;
    prov.prisma_schema = provPrismaSchema;
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

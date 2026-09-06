/**
 * State markers + the OFFLINE 4-state classification (pure filesystem
 * signals only — no server start; the online RECOVERABLE_INCOMPLETE probe
 * lives in provision.ts, mirroring the Windows contract where the exact
 * recoverable state is only decided after strict online validation).
 *
 * Marker files live in <appSupport>/config/:
 *   provisioned.json       — completion marker (the trust anchor)
 *   provision-pending.json — interruption signal with crash-safe stages
 *
 * All writes are atomic (tmp + rename) so a crash mid-write can never
 * produce a torn marker.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ClassificationResult,
  PendingMarker,
  ProvisionedMarker,
} from './types.js';
import type { ResolvedProvisionerConfig } from './config.js';

export const PROVISIONED_FILE = 'provisioned.json';
export const PENDING_FILE = 'provision-pending.json';

export interface MarkerBundle {
  provisionedPath: string;
  pendingPath: string;
  provisioned: ProvisionedMarker | null;
  pending: PendingMarker | null;
  hasCluster: boolean;
  pgMajor: number | null;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function loadMarkers(resolved: ResolvedProvisionerConfig): MarkerBundle {
  mkdirSync(resolved.configDir, { recursive: true });
  const provisionedPath = join(resolved.configDir, PROVISIONED_FILE);
  const pendingPath = join(resolved.configDir, PENDING_FILE);
  const provisioned = readJson<ProvisionedMarker>(provisionedPath);
  const pending = readJson<PendingMarker>(pendingPath);

  const pgVersionPath = join(resolved.pgdata, 'PG_VERSION');
  const hasCluster = existsSync(pgVersionPath);
  let pgMajor: number | null = null;
  if (hasCluster) {
    const raw = readFileSync(pgVersionPath, 'utf8').trim();
    const major = Number.parseInt(raw.split('.')[0] ?? '', 10);
    pgMajor = Number.isFinite(major) ? major : null;
  }
  return {
    provisionedPath,
    pendingPath,
    provisioned,
    pending,
    hasCluster,
    pgMajor,
  };
}

/** Structural + consistency validation of the provisioned marker. */
export function markerConsistent(
  marker: ProvisionedMarker | null,
  resolved: ResolvedProvisionerConfig,
  pgMajor: number | null,
): boolean {
  if (!marker) return false;
  if (marker.schema !== 1 || marker.status !== 'complete') return false;
  if (marker.port !== resolved.pgPort) return false;
  if (marker.appUser !== resolved.appUser) return false;
  if (marker.appDatabase !== resolved.appDatabase) return false;
  if (pgMajor !== null && marker.pgMajor !== pgMajor) return false;
  if (typeof marker.createdAt !== 'string' || typeof marker.updatedAt !== 'string') {
    return false;
  }
  return true;
}

/** Structural validation of the pending marker (must agree with config). */
export function pendingConsistent(
  pending: PendingMarker | null,
  resolved: ResolvedProvisionerConfig,
): pending is PendingMarker {
  if (!pending) return false;
  if (pending.schema !== 1 || pending.status !== 'pending') return false;
  if (pending.port !== resolved.pgPort) return false;
  if (pending.appUser !== resolved.appUser) return false;
  if (pending.appDatabase !== resolved.appDatabase) return false;
  return true;
}

/**
 * OFFLINE classification (the Windows Resolve-ExistingInstallationState
 * analog; the online recovery upgrade happens later):
 *
 *  - pending + cluster                        → PENDING (an ONLINE probe
 *    decides: stale-complete reconciliation, exactly-recoverable resume,
 *    or fail-closed INCOMPLETE_EXISTING)
 *  - pending + no cluster                     → INCOMPLETE_EXISTING
 *    (interrupted before initdb completed — Windows semantics: fail
 *    closed, never auto re-init)
 *  - no pending:
 *      no cluster, no marker                  → CLEAN
 *      cluster + consistent marker            → VALID_EXISTING
 *      anything else                          → INCOMPLETE_EXISTING
 *        (cluster without a marker = unexplained data — must never be
 *        silently destroyed; marker without a cluster = contradiction)
 */
export function classifyOffline(
  bundle: MarkerBundle,
  resolved: ResolvedProvisionerConfig,
): ClassificationResult {
  const { provisioned, pending, hasCluster, pgMajor } = bundle;

  if (pending) {
    return {
      state: 'PENDING',
      detail: hasCluster
        ? 'pending marker + cluster (online probe decides: stale-complete, recoverable, or fail-closed)'
        : 'pending marker WITHOUT a cluster (interrupted before initdb)',
      stalePending: false,
      pendingStages: pending.stages,
    };
  }

  if (!hasCluster && !provisioned) {
    return { state: 'CLEAN', detail: 'no cluster, no markers', stalePending: false };
  }
  if (hasCluster && markerConsistent(provisioned, resolved, pgMajor)) {
    return {
      state: 'VALID_EXISTING',
      detail: 'cluster + consistent provisioned marker',
      stalePending: false,
    };
  }
  return {
    state: 'INCOMPLETE_EXISTING',
    detail: !hasCluster
      ? 'provisioned marker without a cluster (contradiction)'
      : 'cluster without a consistent provisioned marker (unexplained data)',
    stalePending: false,
  };
}

export function writePending(
  resolved: ResolvedProvisionerConfig,
  pgMajor: number,
): PendingMarker {
  const now = new Date().toISOString();
  const marker: PendingMarker = {
    schema: 1,
    status: 'pending',
    pgMajor,
    port: resolved.pgPort,
    appUser: resolved.appUser,
    appDatabase: resolved.appDatabase,
    startedAt: now,
    stages: { initdb: false, server: false, role: false, database: false, migrations: false },
  };
  writeJsonAtomic(join(resolved.configDir, PENDING_FILE), marker);
  return marker;
}

export function updatePendingStages(
  resolved: ResolvedProvisionerConfig,
  marker: PendingMarker,
  patch: Partial<PendingMarker['stages']>,
): PendingMarker {
  const updated: PendingMarker = { ...marker, stages: { ...marker.stages, ...patch } };
  writeJsonAtomic(join(resolved.configDir, PENDING_FILE), updated);
  return updated;
}

export function writeProvisioned(
  resolved: ResolvedProvisionerConfig,
  pgMajor: number,
): ProvisionedMarker {
  const now = new Date().toISOString();
  const marker: ProvisionedMarker = {
    schema: 1,
    status: 'complete',
    pgMajor,
    port: resolved.pgPort,
    appUser: resolved.appUser,
    appDatabase: resolved.appDatabase,
    createdAt: now,
    updatedAt: now,
  };
  writeJsonAtomic(join(resolved.configDir, PROVISIONED_FILE), marker);
  return marker;
}

export function touchProvisioned(
  marker: ProvisionedMarker,
  resolved: ResolvedProvisionerConfig,
): void {
  writeJsonAtomic(join(resolved.configDir, PROVISIONED_FILE), {
    ...marker,
    updatedAt: new Date().toISOString(),
  });
}

export function removePending(resolved: ResolvedProvisionerConfig): void {
  const path = join(resolved.configDir, PENDING_FILE);
  if (existsSync(path)) {
    renameSync(path, `${path}.removed.${process.pid}`);
  }
}

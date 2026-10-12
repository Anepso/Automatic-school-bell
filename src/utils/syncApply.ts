import type { ScheduleItem } from '../types';
import type { UpsertPlan } from './syncSchedule';
import type { ImportSourceSnapshot, SyncMeta } from './storage';

/**
 * BS-6 (Model B — Last Successfully Applied Sync Source).
 *
 * The single rule this module encodes: the sync snapshot exists if and only if
 * a real, non-no-op change was durably applied. A no-op must not write, a
 * cancelled confirmation must not write, and a failed write must not leave the
 * in-memory state claiming success.
 */
export interface SyncApplyDeps {
  /**
   * Persists schedules, snapshot, and metadata as ONE main-process
   * transaction. Resolves to `true` only after the bytes are durable.
   */
  commit: (
    schedules: ScheduleItem[],
    snapshot: ImportSourceSnapshot,
    meta: SyncMeta,
  ) => Promise<boolean>;
  /** Timestamp source, injectable so tests are deterministic. */
  now?: () => string;
}

export type SyncApplyResult =
  | { status: 'noop' }
  | { status: 'applied'; snapshot: ImportSourceSnapshot; meta: SyncMeta }
  | { status: 'failed'; snapshot: ImportSourceSnapshot; meta: SyncMeta };

/**
 * Applies a precomputed plan.
 *
 * Callers MUST have already handled the no-op case for UI messaging; this
 * function is the single write gate and simply refuses to write for a no-op,
 * so neither path can accidentally persist a snapshot.
 */
export async function applyUpsertPlanDurable(
  plan: UpsertPlan,
  snapshot: ImportSourceSnapshot,
  deps: SyncApplyDeps,
): Promise<SyncApplyResult> {
  // No-op: nothing is written. The previous snapshot stays authoritative.
  if (plan.isNoop) return { status: 'noop' };

  const now = deps.now ? deps.now() : new Date().toISOString();
  const meta: SyncMeta = {
    lastSyncedAt: now,
    lastSourceFileName: plan.fileName || null,
  };

  const committed = await deps.commit(plan.nextSchedules, { ...snapshot, importedAt: now }, meta);
  if (!committed) return { status: 'failed', snapshot, meta };

  return { status: 'applied', snapshot: { ...snapshot, importedAt: now }, meta };
}

/**
 * Builds the snapshot for an import. Called ONLY after a plan is known to be a
 * real change, so a no-op import never creates a source to replay later.
 */
export function buildImportSnapshot(
  fileName: string,
  rows: ImportSourceSnapshot['rows'],
  skippedRowCount: number,
): ImportSourceSnapshot {
  return { fileName, importedAt: '', rows, skippedRowCount };
}

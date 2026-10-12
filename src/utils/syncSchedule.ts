import { AudioFileItem, ScheduleItem } from '../types';
import { validateTimeFormat } from './excelImport';
import { DEFAULT_SCHEDULES, ImportSourceRow } from './storage';

/**
 * Shared synchronization engine for the "Sinkronkan" action.
 *
 * Contract (Stage B):
 *   - Semantics ....... UPSERT (never replace, never blind-append)
 *   - Natural key ..... day + time + name
 *   - Source .......... last successfully applied import snapshot (local-first)
 *   - Network ......... none
 *
 * Both the Dashboard and Jadwal entry points funnel through `computeUpsertPlan`.
 */

/** Duration applied to newly inserted imported rows (parser does not read duration). */
export const IMPORT_DEFAULT_DURATION = '0:10';

function collapse(value: string): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** Day comparison uses the app's own normalized day value. */
export function normalizeDay(day: string): string {
  return collapse(day);
}

/** Time comparison uses the app's normalized HH:MM format (reuses the existing parser validator). */
export function normalizeTime(time: string): string {
  const clean = collapse(time);
  const result = validateTimeFormat(clean);
  return result.valid ? result.normalized : clean;
}

/** Name comparison is trimmed and case-insensitive. */
export function normalizeName(name: string): string {
  return collapse(name).toLowerCase();
}

function normalizeSound(soundName: string): string {
  return collapse(soundName).toLowerCase();
}

/** The final natural key: day + time + name. Never uses `id`. */
export function naturalKey(day: string, time: string, name: string): string {
  return `${normalizeDay(day)}|${normalizeTime(time)}|${normalizeName(name)}`;
}

export function rowNaturalKey(row: ImportSourceRow): string {
  return naturalKey(row.day, row.time, row.name);
}

/**
 * Resolve soundId for an imported row from the app's existing sound convention.
 *
 * The Excel contract only carries `soundName`, so a soundId is never invented:
 *   1. reuse the soundId already associated with that soundName in live schedules
 *   2. fall back to the seed schedule convention
 *   3. fall back to the audio library catalog fileName match
 *   4. otherwise return '' (honest unknown) rather than a fabricated id
 *
 * Playback resolves `soundName` (see audioEngine.playSoundByName), so this keeps
 * metadata truthful without affecting bell audio.
 */
export function resolveSoundId(
  soundName: string,
  existingSchedules: ScheduleItem[] = [],
  audioFiles: AudioFileItem[] = []
): string {
  const target = normalizeSound(soundName);
  if (!target) return '';

  for (const s of existingSchedules) {
    if (s.soundId && normalizeSound(s.soundName) === target) return s.soundId;
  }
  for (const s of DEFAULT_SCHEDULES) {
    if (s.soundId && normalizeSound(s.soundName) === target) return s.soundId;
  }
  const fromCatalog = audioFiles.find((a) => normalizeSound(a.fileName) === target);
  if (fromCatalog?.id) return fromCatalog.id;

  return '';
}

export interface UpsertPlan {
  /** Full next dataset: updated in place, new rows appended, local-only rows preserved. */
  nextSchedules: ScheduleItem[];
  /** Existing schedules whose authoritative fields actually changed. */
  updatedCount: number;
  /** Rows inserted because no existing natural key matched. */
  addedCount: number;
  /** Matched rows that were already identical. */
  unchangedCount: number;
  /** Existing schedules absent from the source; always preserved. */
  preservedCount: number;
  /** Source rows that duplicated an earlier source row (ambiguous). */
  conflictCount: number;
  /** Rows the parser rejected; not applied. */
  skippedRowCount: number;
  /** Source file label, when known. */
  fileName: string;
  /** True when applying the plan would not change the dataset at all. */
  isNoop: boolean;
}

/** Fields the source is authoritative for when a natural key matches. */
const AUTHORITATIVE_FIELDS: (keyof ScheduleItem)[] = [
  'description',
  'soundName',
  'soundId',
  'category',
];

/**
 * Overlay the source-authoritative fields onto a schedule.
 *
 * `id` is carried over from `base`, which is what preserves an existing
 * schedule's identity across an update. `duration` and `active` are
 * intentionally NOT overwritten: the Excel contract does not carry them
 * (the parser hardcodes both), so applying them would clobber locally curated
 * values. See report Limitations.
 */
function applySourceFields(
  base: ScheduleItem,
  row: ImportSourceRow,
  context: ScheduleItem[],
  audioFiles: AudioFileItem[]
): ScheduleItem {
  return {
    ...base,
    description: row.description,
    soundName: row.soundName,
    soundId: resolveSoundId(row.soundName, context, audioFiles),
    category: row.category,
  };
}

/**
 * Compute the full UPSERT result without mutating anything.
 *
 * Called BEFORE confirmation so the dialog can display real numbers and the
 * post-confirm apply stays a synchronous, deterministic local state update.
 *
 * Invariant (C6): one normalized natural key yields at most one schedule in
 * `nextSchedules`. Duplicate source rows are counted in `conflictCount` and
 * resolved deterministically by last-row-wins.
 */
export function computeUpsertPlan(
  existing: ScheduleItem[],
  rows: ImportSourceRow[],
  options: { audioFiles?: AudioFileItem[]; fileName?: string; skippedRowCount?: number } = {}
): UpsertPlan {
  const audioFiles = options.audioFiles ?? [];
  const usedIds = new Set(existing.map((s) => s.id));
  const originalById = new Map<string, ScheduleItem>(existing.map((s) => [s.id, s]));
  const workById = new Map<string, ScheduleItem>(existing.map((s) => [s.id, s]));
  const matchedExistingIds = new Set<string>();
  const sourceKeys = new Set<string>();
  /**
   * Planned inserts keyed by natural key.
   *
   * This is the C6 fix: because the plan is keyed by the natural key, a
   * duplicate source row re-plans the SAME slot instead of appending a second
   * schedule. `Map.set` on an existing key keeps the original insertion
   * position, so the final ordering is still "existing order, then new rows in
   * order of first appearance" while the values are last-row-wins.
   */
  const pendingByKey = new Map<string, ScheduleItem>();
  /** natural key -> schedule id, spanning both existing and planned schedules. */
  const idByKey = new Map<string, string>();
  for (const s of existing) {
    const key = naturalKey(s.day, s.time, s.name);
    if (!idByKey.has(key)) idByKey.set(key, s.id);
  }

  let conflictCount = 0;
  const timestampBase = Date.now();

  /** Everything planned so far; used as sound-resolution context. */
  const soundContext = (): ScheduleItem[] => [...workById.values(), ...pendingByKey.values()];

  const nextId = (index: number): string => {
    const base = `sch-import-${timestampBase}-${index}`;
    let candidate = base;
    let suffix = 1;
    while (usedIds.has(candidate) || Array.from(pendingByKey.values()).some((p) => p.id === candidate)) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  };

  rows.forEach((row, index) => {
    const key = rowNaturalKey(row);
    if (sourceKeys.has(key)) {
      // Ambiguous source: the last row wins for this natural key. The plan below
      // is keyed by natural key, so re-planning the same key overwrites the
      // earlier plan rather than producing a duplicate schedule.
      conflictCount += 1;
    }
    sourceKeys.add(key);

    // 1) Duplicate of a row already planned during THIS run -> last row wins.
    const planned = pendingByKey.get(key);
    if (planned) {
      pendingByKey.set(key, applySourceFields(planned, row, soundContext(), audioFiles));
      return;
    }

    // 2) Match an existing schedule -> keep its id, refresh authoritative fields.
    const existingId = idByKey.get(key);
    if (existingId !== undefined) {
      const current = workById.get(existingId);
      if (!current) return;
      matchedExistingIds.add(existingId);
      workById.set(existingId, applySourceFields(current, row, soundContext(), audioFiles));
      return;
    }

    // 3) Genuinely new natural key -> plan exactly one insert.
    const created: ScheduleItem = {
      id: nextId(index),
      time: normalizeTime(row.time),
      name: collapse(row.name),
      description: row.description,
      soundId: resolveSoundId(row.soundName, soundContext(), audioFiles),
      soundName: row.soundName,
      duration: IMPORT_DEFAULT_DURATION,
      day: normalizeDay(row.day),
      category: row.category,
      active: true,
    };
    pendingByKey.set(key, created);
    idByKey.set(key, created.id);
  });

  const pendingAdds = Array.from(pendingByKey.values());
  const nextSchedules: ScheduleItem[] = [
    ...Array.from(workById.values()),
    ...pendingAdds,
  ];

  /**
   * Counted once per resulting schedule rather than once per source row, so a
   * duplicated source row is never reported as several updated/added schedules.
   */
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const id of matchedExistingIds) {
    const before = originalById.get(id);
    const after = workById.get(id);
    if (!before || !after) continue;
    if (AUTHORITATIVE_FIELDS.some((f) => after[f] !== before[f])) updatedCount += 1;
    else unchangedCount += 1;
  }

  const preservedCount = existing.filter((s) => !matchedExistingIds.has(s.id)).length;
  const skippedRowCount = options.skippedRowCount ?? 0;

  return {
    nextSchedules,
    updatedCount,
    addedCount: pendingAdds.length,
    unchangedCount,
    preservedCount,
    conflictCount,
    skippedRowCount,
    fileName: options.fileName ?? '',
    isNoop: updatedCount === 0 && pendingAdds.length === 0,
  };
}

/** Factual confirmation copy. All numbers come from the computed plan. */
export function buildSyncConfirmationCopy(plan: UpsertPlan) {
  const parts = [
    `${plan.updatedCount} jadwal akan diperbarui`,
    `${plan.addedCount} jadwal baru akan ditambahkan`,
    `${plan.conflictCount} konflik`,
  ];
  const impactParts = [
    plan.preservedCount > 0
      ? `${plan.preservedCount} jadwal lama yang tidak ada di file tetap dipertahankan.`
      : 'Tidak ada jadwal lokal yang perlu dipertahankan.',
  ];
  if (plan.skippedRowCount > 0) {
    impactParts.push(`${plan.skippedRowCount} baris dilewati karena tidak valid.`);
  }

  return {
    description: `${parts.join(', ')}.`,
    impact: impactParts.join(' '),
  };
}

/** Factual success/failure toast copy. */
export function buildSyncResultCopy(plan: UpsertPlan): { title: string; desc: string } {
  if (plan.isNoop) {
    return {
      title: 'Jadwal sudah sinkron',
      desc: 'Tidak ada perubahan yang diperlukan.',
    };
  }

  const descParts = [
    `${plan.updatedCount} jadwal diperbarui`,
    `${plan.addedCount} jadwal ditambahkan`,
  ];
  if (plan.skippedRowCount > 0) {
    descParts.push(`${plan.skippedRowCount} baris dilewati karena tidak valid`);
  }
  return {
    title: 'Sinkronisasi selesai',
    desc: `${descParts.join(', ')}.`,
  };
}

/** Format a persisted ISO timestamp for the UI, or an honest empty state. */
export function formatSyncTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Belum pernah disinkronkan';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Belum pernah disinkronkan';

  const parts = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')} ${get('hour')}:${get('minute')}`;
}

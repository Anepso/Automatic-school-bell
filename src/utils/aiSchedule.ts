/**
 * B6 Gemini — renderer-side normalization of a validated AI proposal.
 *
 * The server validates the model's *envelope* (`ai-assistant-endpoint.ts`), but
 * it has no access to the audio library or to the schedule table, so the final
 * step — resolving a real `soundId` and expanding a proposal across its
 * applicable days — belongs here, where that data actually lives.
 *
 * Stage A findings addressed here (`STAGE_A_B6_GEMINI_PRODUCTION_AUDIT.md`):
 *   B6-GEM-09  AI output is validated before it can reach application state,
 *              and an unknown sound resolves to an honest empty value instead of
 *              a fabricated id.
 *   B6-GEM-09b `day: msg.applicableDays?.[0]` silently dropped every day after
 *              the first; a multi-day proposal now expands into one row per day.
 *
 * Invariants:
 *   - no sound is ever invented: an unmatched `soundName` yields `soundId: ''`
 *     (the same honest-unknown convention `resolveSoundId` already uses for the
 *     Excel import path, so playback still works off `soundName`);
 *   - no schedule is dropped because of a day list;
 *   - expansion is bounded, so a hostile day list cannot explode the table;
 *   - the storage schema and the scheduler contract are untouched — a
 *     `ScheduleItem` still carries exactly one `day`.
 */

import { AudioFileItem, ScheduleItem } from '../types';
import { resolveSoundId } from './syncSchedule';

/** Mirrors the server's day vocabulary so an unexpected value cannot slip through. */
const KNOWN_DAYS = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
] as const;

export const AI_EVERY_DAY_LABEL = 'Semua';

/** Duration applied when the model omitted one; matches the import convention. */
export const AI_DEFAULT_DURATION = '0:10';

/** Hard ceiling on rows produced by one apply, so storage cannot be flooded. */
export const AI_MAX_EXPANDED_ROWS = 200;

export interface AiProposedItem {
  time: string;
  name: string;
  description: string;
  soundName: string;
  duration: string;
  active: boolean;
}

export interface AiProposal {
  categoryName?: string;
  applicableDays: string[];
  items: AiProposedItem[];
}

export interface NormalizedProposal {
  rows: ScheduleItem[];
  /** True when the expansion ceiling was hit and rows were left out. */
  truncated: boolean;
  /** Rows the drawer could not resolve to a real audio asset. */
  unresolvedSoundCount: number;
  rejectedItemCount: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collapse(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function isValidTimeValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  return Number(match[1]) >= 0 && Number(match[1]) <= 23 && Number(match[2]) >= 0 && Number(match[2]) <= 59;
}

export function isValidDurationValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  if (Number(match[3]) > 59) return false;
  if (match[1] !== undefined && Number(match[1]) > 59) return false;
  return Number(match[2]) <= 59;
}

/** Case-insensitive day resolution against the app's own vocabulary. */
export function normalizeDays(values: unknown): string[] {
  const source = Array.isArray(values) ? values : [];
  const out: string[] = [];
  for (const entry of source) {
    const text = collapse(entry);
    if (!text) continue;
    if (text === AI_EVERY_DAY_LABEL) {
      if (!out.includes(AI_EVERY_DAY_LABEL)) out.push(AI_EVERY_DAY_LABEL);
      continue;
    }
    const match = KNOWN_DAYS.find((day) => day.toLowerCase() === text.toLowerCase());
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

/**
 * Expand `${AI_EVERY_DAY_LABEL}` into concrete days, mirroring how the scheduler
 * treats it. Kept local so this module does not import the protected scheduler.
 */
function expandEveryDay(): string[] {
  return [...KNOWN_DAYS];
}

export interface NormalizeOptions {
  /** Live schedules, so an already-associated soundId can be reused. */
  currentSchedules?: ScheduleItem[];
  /** The real audio library; never fabricated. */
  audioFiles?: AudioFileItem[];
  /** Prefix for generated ids; injectable so tests stay deterministic. */
  idFactory?: (index: number) => string;
}

const DEFAULT_CATEGORY = 'Jadwal AI';

/**
 * Convert a validated proposal into concrete `ScheduleItem` rows.
 *
 * Rejects (rather than coerces) an item with a bad time, a bad duration, or a
 * non-string required field, so nothing reaches application state unvalidated.
 * Days are expanded one row per day — the data model stores a single `day` per
 * schedule, so expanding is the only way to honour a multi-day proposal
 * without changing the storage schema.
 */
export function normalizeAiProposal(
  proposal: AiProposal,
  options: NormalizeOptions = {}
): NormalizedProposal {
  const {
    currentSchedules = [],
    audioFiles = [],
    idFactory = (index: number) => `sch-ai-${Date.now()}-${index}`,
  } = options;

  // The category is a plain label; `App.handleApplySchedule` owns creating it.
  const category = collapse(proposal.categoryName) || DEFAULT_CATEGORY;

  const declaredDays = normalizeDays(proposal.applicableDays);
  const days = declaredDays.length > 0 ? declaredDays : [];
  if (days.length === 0) {
    // Without a day there is nothing to schedule. Refuse rather than guess one.
    return { rows: [], truncated: false, unresolvedSoundCount: 0, rejectedItemCount: 0 };
  }
  const resolvedDays = days.includes(AI_EVERY_DAY_LABEL) ? expandEveryDay() : days;

  const rows: ScheduleItem[] = [];
  let truncated = false;
  let unresolvedSoundCount = 0;
  let rejectedItemCount = 0;
  let sequence = 0;

  const rawItems = Array.isArray(proposal.items) ? proposal.items : [];
  for (const entry of rawItems) {
    if (!isPlainObject(entry)) {
      rejectedItemCount += 1;
      continue;
    }
    if (!isValidTimeValue(entry.time)) {
      rejectedItemCount += 1;
      continue;
    }
    if (!isValidDurationValue(entry.duration)) {
      rejectedItemCount += 1;
      continue;
    }
    const name = collapse(entry.name);
    if (!name) {
      rejectedItemCount += 1;
      continue;
    }

    const soundName = typeof entry.soundName === 'string' ? entry.soundName.trim() : '';
    // Honest resolution only: reuse a real id, or leave it empty. Never 'snd-1'.
    const soundId = resolveSoundId(soundName, currentSchedules, audioFiles);
    if (!soundId) unresolvedSoundCount += 1;

    const description = typeof entry.description === 'string' ? entry.description.trim() : '';
    const duration = collapse(entry.duration) || AI_DEFAULT_DURATION;
    const active = entry.active === undefined ? true : Boolean(entry.active);

    for (const day of resolvedDays) {
      if (rows.length >= AI_MAX_EXPANDED_ROWS) {
        truncated = true;
        break;
      }
      rows.push({
        id: idFactory(sequence),
        time: (entry.time as string).trim(),
        name,
        description,
        soundId,
        soundName,
        duration,
        day,
        category,
        active,
      });
      sequence += 1;
    }
    if (truncated) break;
  }

  return { rows, truncated, unresolvedSoundCount, rejectedItemCount };
}
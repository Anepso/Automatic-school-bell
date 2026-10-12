import { ScheduleItem } from '../types';

export const SCHEDULE_DAY_NAMES = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
] as const;

export const EVERY_DAY_LABEL = 'Semua';

export function getScheduleDayName(date: Date): string {
  return SCHEDULE_DAY_NAMES[date.getDay()];
}

export function getScheduleClockText(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function getScheduleMinuteKey(date: Date): string {
  return `${getScheduleDayName(date)}-${getScheduleClockText(date)}`;
}

export interface NextScheduleResult {
  schedule: ScheduleItem;
  dayOffset: number;
}

export const NEXT_SCHEDULE_LOOKAHEAD_DAYS = 7;

/**
 * Display-only helper: the next schedule the UI should advertise.
 *
 * Deliberately asymmetric with findMatchingSchedule, which is the firing path:
 * firing must match the exact current minute (===), while display must look strictly
 * forward (>) so that a bell already due in this minute yields to the following one.
 * Do not unify these two comparisons.
 */
export function findNextSchedule(
  schedules: ScheduleItem[],
  now: Date
): NextScheduleResult | null {
  const eligible = schedules.filter((schedule) => schedule.active);
  if (eligible.length === 0) return null;

  const currentClock = getScheduleClockText(now);

  for (let dayOffset = 0; dayOffset <= NEXT_SCHEDULE_LOOKAHEAD_DAYS; dayOffset += 1) {
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + dayOffset
    );
    const targetDayName = getScheduleDayName(target);

    const candidates = eligible
      .filter((schedule) => schedule.day === targetDayName || schedule.day === EVERY_DAY_LABEL)
      .sort((a, b) => a.time.localeCompare(b.time));

    // Strictly forward on the current day; later days are wholly in the future.
    const match = candidates.find(
      (schedule) => dayOffset > 0 || schedule.time > currentClock
    );

    if (match) return { schedule: match, dayOffset };
  }

  return null;
}

/** Display-only formatter: MM:SS under an hour, H:MM:SS at or above one hour. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function findMatchingSchedule(
  schedules: ScheduleItem[],
  todayDayName: string,
  currentTimeFormatted: string
): ScheduleItem | undefined {
  return schedules.find((schedule) => {
    if (!schedule.active) return false;
    if (schedule.time !== currentTimeFormatted) return false;
    return schedule.day === todayDayName || schedule.day === EVERY_DAY_LABEL;
  });
}

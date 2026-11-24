import type { ReminderItem } from './reminderSchemas';

export type RRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RRuleWeekday = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA';

export const WEEKDAY_ORDER: readonly RRuleWeekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface ParsedRRule {
  freq: RRuleFreq;
  interval: number;
  byDay?: RRuleWeekday[];
  byMonthDay?: number;
  count?: number;
  untilYmd?: string; // YYYY-MM-DD
}

const VALID_FREQS = new Set<string>(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const VALID_DAYS = new Set<string>(WEEKDAY_ORDER);

/**
 * Pure, Expo-portable RFC-5545 RRULE parser for LifeOS recurrence rules.
 * Supports FREQ, INTERVAL, BYDAY, BYMONTHDAY, COUNT, and UNTIL.
 */
export function parseRRule(rrule?: string | null): ParsedRRule | null {
  if (!rrule) return null;
  const cleaned = rrule.trim().replace(/^RRULE:/i, '');
  if (!cleaned) return null;

  const parts = cleaned.split(';').filter(Boolean);
  let freq: RRuleFreq | null = null;
  let interval = 1;
  let byDay: RRuleWeekday[] | undefined;
  let byMonthDay: number | undefined;
  let count: number | undefined;
  let untilYmd: string | undefined;

  for (const part of parts) {
    const [rawKey, rawVal] = part.split('=');
    if (!rawKey || !rawVal) return null;
    const key = rawKey.trim().toUpperCase();
    const val = rawVal.trim().toUpperCase();

    if (key === 'FREQ') {
      if (!VALID_FREQS.has(val)) return null;
      freq = val as RRuleFreq;
    } else if (key === 'INTERVAL') {
      const n = Number.parseInt(val, 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) return null;
      interval = n;
    } else if (key === 'BYDAY') {
      const days = val.split(',').map((d) => d.trim()).filter(Boolean);
      if (days.length === 0 || !days.every((d) => VALID_DAYS.has(d))) return null;
      const uniqueSorted = Array.from(new Set(days)) as RRuleWeekday[];
      uniqueSorted.sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));
      byDay = uniqueSorted;
    } else if (key === 'BYMONTHDAY') {
      const d = Number.parseInt(val, 10);
      if (!Number.isFinite(d) || d < 1 || d > 31) return null;
      byMonthDay = d;
    } else if (key === 'COUNT') {
      const c = Number.parseInt(val, 10);
      if (!Number.isFinite(c) || c < 1 || c > 999) return null;
      count = c;
    } else if (key === 'UNTIL') {
      const m = val.match(/^(\d{4})(\d{2})(\d{2})/);
      if (!m) return null;
      untilYmd = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }

  if (!freq) return null;
  return { freq, interval, byDay, byMonthDay, count, untilYmd };
}

export function serializeRRule(rule: ParsedRRule): string {
  const segments: string[] = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) segments.push(`INTERVAL=${Math.min(365, Math.max(1, Math.round(rule.interval)))}`);
  if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length > 0) {
    const sorted = [...new Set(rule.byDay)].sort(
      (a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b)
    );
    segments.push(`BYDAY=${sorted.join(',')}`);
  }
  if (rule.freq === 'MONTHLY' && rule.byMonthDay && rule.byMonthDay >= 1 && rule.byMonthDay <= 31) {
    segments.push(`BYMONTHDAY=${Math.round(rule.byMonthDay)}`);
  }
  if (rule.count && rule.count >= 1) {
    segments.push(`COUNT=${Math.min(999, Math.round(rule.count))}`);
  }
  if (rule.untilYmd && /^\d{4}-\d{2}-\d{2}$/.test(rule.untilYmd)) {
    segments.push(`UNTIL=${rule.untilYmd.replace(/-/g, '')}`);
  }
  return segments.join(';');
}

const DAY_SHORT_LABELS: Record<RRuleWeekday, string> = {
  SU: 'Sun',
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
};

export function describeRRule(rrule?: string | null): string {
  const parsed = parseRRule(rrule);
  if (!parsed) return 'One-time';

  const every = parsed.interval === 1 ? 'Every' : `Every ${parsed.interval}`;
  let base = '';
  if (parsed.freq === 'DAILY') {
    base = parsed.interval === 1 ? 'Daily' : `${every} days`;
  } else if (parsed.freq === 'WEEKLY') {
    const dayStr =
      parsed.byDay && parsed.byDay.length > 0
        ? ` on ${parsed.byDay.map((d) => DAY_SHORT_LABELS[d]).join(', ')}`
        : '';
    base = parsed.interval === 1 ? `Weekly${dayStr}` : `${every} weeks${dayStr}`;
  } else if (parsed.freq === 'MONTHLY') {
    const md = parsed.byMonthDay ? ` (day ${parsed.byMonthDay})` : '';
    base = parsed.interval === 1 ? `Monthly${md}` : `${every} months${md}`;
  } else {
    base = parsed.interval === 1 ? 'Yearly' : `${every} years`;
  }

  if (parsed.count) base += ` · ${parsed.count}x`;
  if (parsed.untilYmd) base += ` · until ${parsed.untilYmd}`;
  return base;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addMonthsClamped(base: Date, monthsToAdd: number, preferredDay?: number): Date {
  const totalMonths = base.getFullYear() * 12 + base.getMonth() + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const maxDay = daysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(preferredDay ?? base.getDate(), maxDay);
  return new Date(
    targetYear,
    targetMonth,
    targetDay,
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    0
  );
}

function getUntilEndMs(untilYmd?: string): number | null {
  if (!untilYmd) return null;
  const [y, m, d] = untilYmd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * Deterministically expands occurrences of a reminder within [windowStart, windowEnd].
 * Handles snoozed first instance, month-end clamping (e.g. Jan 31 -> Feb 28/29),
 * weekly BYDAY sets, COUNT, and UNTIL boundaries.
 */
export function expandReminderOccurrences(
  reminder: Pick<ReminderItem, 'dueAtIso' | 'rrule' | 'snoozedUntilIso' | 'status' | 'completedCount'>,
  windowStart: Date,
  windowEnd: Date,
  maxInstances = 64
): Date[] {
  if (reminder.status === 'completed' || reminder.status === 'archived') {
    return [];
  }

  const baseDate = new Date(reminder.dueAtIso);
  if (Number.isNaN(baseDate.getTime())) return [];

  const snoozedDate =
    reminder.status === 'snoozed' && reminder.snoozedUntilIso
      ? new Date(reminder.snoozedUntilIso)
      : null;

  const parsed = parseRRule(reminder.rrule);
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  // One-time reminder
  if (!parsed) {
    const effective =
      snoozedDate && !Number.isNaN(snoozedDate.getTime()) ? snoozedDate : baseDate;
    const t = effective.getTime();
    return t >= startMs && t <= endMs ? [effective] : [];
  }

  const untilMs = getUntilEndMs(parsed.untilYmd);
  const remainingCount =
    parsed.count !== undefined ? Math.max(0, parsed.count - (reminder.completedCount ?? 0)) : Infinity;

  if (remainingCount <= 0) return [];

  const results: Date[] = [];
  let generatedCount = 0;
  let safetyCounter = 0;
  const MAX_ITERATIONS = 1200;

  const pushIfEligible = (candidate: Date, isFirstInstance: boolean): boolean => {
    const effective =
      isFirstInstance && snoozedDate && !Number.isNaN(snoozedDate.getTime())
        ? snoozedDate
        : candidate;
    const ms = effective.getTime();
    if (untilMs !== null && candidate.getTime() > untilMs) return false;
    generatedCount += 1;
    if (generatedCount > remainingCount) return false;
    if (ms > endMs) return false;
    if (ms >= startMs) {
      results.push(effective);
    }
    return results.length < maxInstances;
  };

  if (parsed.freq === 'DAILY') {
    let cursor = new Date(baseDate.getTime());
    while (safetyCounter++ < MAX_ITERATIONS) {
      if (untilMs !== null && cursor.getTime() > untilMs) break;
      if (generatedCount >= remainingCount) break;
      if (cursor.getTime() > endMs && !(generatedCount === 0 && snoozedDate && snoozedDate.getTime() <= endMs)) {
        break;
      }
      const keepGoing = pushIfEligible(new Date(cursor.getTime()), generatedCount === 0);
      if (!keepGoing && results.length >= maxInstances) break;
      cursor = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + parsed.interval,
        baseDate.getHours(),
        baseDate.getMinutes(),
        baseDate.getSeconds(),
        0
      );
    }
  } else if (parsed.freq === 'WEEKLY') {
    const targetDays =
      parsed.byDay && parsed.byDay.length > 0
        ? parsed.byDay.map((d) => WEEKDAY_ORDER.indexOf(d))
        : [baseDate.getDay()];

    // Start of week (Sunday) containing baseDate
    const baseWeekStart = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate() - baseDate.getDay(),
      baseDate.getHours(),
      baseDate.getMinutes(),
      baseDate.getSeconds(),
      0
    );

    let weekOffset = 0;
    while (safetyCounter++ < MAX_ITERATIONS) {
      let exceededWindow = true;
      for (const dow of targetDays) {
        const candidate = new Date(
          baseWeekStart.getFullYear(),
          baseWeekStart.getMonth(),
          baseWeekStart.getDate() + weekOffset * 7 + dow,
          baseDate.getHours(),
          baseDate.getMinutes(),
          baseDate.getSeconds(),
          0
        );
        if (candidate.getTime() < baseDate.getTime()) {
          exceededWindow = false;
          continue;
        }
        if (untilMs !== null && candidate.getTime() > untilMs) {
          return results;
        }
        if (generatedCount >= remainingCount) {
          return results;
        }
        if (candidate.getTime() <= endMs) {
          exceededWindow = false;
        }
        const keepGoing = pushIfEligible(candidate, generatedCount === 0);
        if (!keepGoing && results.length >= maxInstances) {
          return results;
        }
      }
      if (exceededWindow) break;
      weekOffset += parsed.interval;
    }
  } else if (parsed.freq === 'MONTHLY') {
    const prefDay = parsed.byMonthDay ?? baseDate.getDate();
    let step = 0;
    while (safetyCounter++ < MAX_ITERATIONS) {
      const candidate = addMonthsClamped(baseDate, step * parsed.interval, prefDay);
      if (untilMs !== null && candidate.getTime() > untilMs) break;
      if (generatedCount >= remainingCount) break;
      if (candidate.getTime() > endMs) break;
      const keepGoing = pushIfEligible(candidate, generatedCount === 0);
      if (!keepGoing && results.length >= maxInstances) break;
      step += 1;
    }
  } else if (parsed.freq === 'YEARLY') {
    let step = 0;
    while (safetyCounter++ < MAX_ITERATIONS) {
      const candidate = addMonthsClamped(baseDate, step * parsed.interval * 12, baseDate.getDate());
      if (untilMs !== null && candidate.getTime() > untilMs) break;
      if (generatedCount >= remainingCount) break;
      if (candidate.getTime() > endMs) break;
      const keepGoing = pushIfEligible(candidate, generatedCount === 0);
      if (!keepGoing && results.length >= maxInstances) break;
      step += 1;
    }
  }

  return results;
}

export interface CompletionTransition {
  nextDueAtIso: string;
  nextStatus: ReminderItem['status'];
  nextIsCompleted: boolean;
  nextCompletedCount: number;
  clearSnooze: boolean;
  advancedRecurring: boolean;
}

/**
 * Computes the deterministic next state when a user checks off a reminder.
 * - One-time reminder -> transitions to status='completed', isCompleted=true.
 * - Recurring reminder -> advances dueAtIso to the next occurrence strictly after max(dueAt, completedAt),
 *   unless COUNT or UNTIL has been exhausted.
 */
export function computeCompletionTransition(
  reminder: ReminderItem,
  completedAt: Date = new Date()
): CompletionTransition {
  const nextCompletedCount = reminder.completedCount + 1;
  const parsed = parseRRule(reminder.rrule);

  if (!parsed) {
    return {
      nextDueAtIso: reminder.dueAtIso,
      nextStatus: 'completed',
      nextIsCompleted: true,
      nextCompletedCount,
      clearSnooze: true,
      advancedRecurring: false,
    };
  }

  // Check if COUNT is now exhausted
  if (parsed.count !== undefined && nextCompletedCount >= parsed.count) {
    return {
      nextDueAtIso: reminder.dueAtIso,
      nextStatus: 'completed',
      nextIsCompleted: true,
      nextCompletedCount,
      clearSnooze: true,
      advancedRecurring: false,
    };
  }

  // Find the first occurrence strictly after max(current dueAt, completedAt - 1s)
  const baseMs = new Date(reminder.dueAtIso).getTime();
  const afterMs = Math.max(baseMs, completedAt.getTime()) + 1000;
  const searchStart = new Date(afterMs);
  const searchEnd = new Date(afterMs + 400 * 24 * 60 * 60 * 1000); // look up to ~13 months ahead

  const nextInstances = expandReminderOccurrences(
    {
      dueAtIso: reminder.dueAtIso,
      rrule: reminder.rrule,
      snoozedUntilIso: undefined,
      status: 'scheduled',
      completedCount: 0, // evaluate schedule sequence from base
    },
    searchStart,
    searchEnd,
    1
  );

  if (nextInstances.length === 0) {
    return {
      nextDueAtIso: reminder.dueAtIso,
      nextStatus: 'completed',
      nextIsCompleted: true,
      nextCompletedCount,
      clearSnooze: true,
      advancedRecurring: false,
    };
  }

  return {
    nextDueAtIso: nextInstances[0].toISOString(),
    nextStatus: 'scheduled',
    nextIsCompleted: false,
    nextCompletedCount,
    clearSnooze: true,
    advancedRecurring: true,
  };
}

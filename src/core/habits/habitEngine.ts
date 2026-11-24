import type { HabitItem, HabitMonthLog } from './habitSchemas';

export interface HabitStreakStats {
  currentStreak: number;
  bestStreak: number;
  totalCompletions: number;
  completedToday: boolean;
  consistency30dPct: number;
  completedLast7Days: number;
  lastCompletedDate?: string;
}

export interface HeatmapCell {
  dateYmd: string;
  monthKey: string;
  weekday: number; // 0 = Sun ... 6 = Sat
  completed: boolean;
  isToday: boolean;
}

export interface BreakPatternInsight {
  weakestWeekdayIndex: number | null;
  weakestWeekdayLabel: string | null;
  weekdayCompletionRates: Array<{ weekday: number; label: string; pct: number; totalOpportunities: number }>;
  averageStreakBeforeBreak: number;
  suggestion: string;
}

export interface HabitsOverviewSummary {
  activeCount: number;
  completedTodayCount: number;
  bestActiveStreak: number;
  avgConsistency30dPct: number;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function parseYmdUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function formatYmdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysYmd(ymd: string, deltaDays: number): string {
  const dt = parseYmdUtc(ymd);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return formatYmdUtc(dt);
}

/**
 * Flattens all monthly buckets for a given habit into a deduplicated Set of YYYY-MM-DD strings.
 */
export function collectHabitCompletedDays(habitId: string, logs: HabitMonthLog[]): Set<string> {
  const set = new Set<string>();
  for (const bucket of logs) {
    if (bucket.habitId !== habitId) continue;
    for (const day of bucket.days) {
      set.add(day);
    }
  }
  return set;
}

/**
 * Pure helper to toggle a single YYYY-MM-DD day inside a monthly bucket's days array.
 */
export function toggleDayInMonthBucket(existingDays: string[], targetYmd: string): {
  nextDays: string[];
  added: boolean;
} {
  const set = new Set(existingDays);
  if (set.has(targetYmd)) {
    set.delete(targetYmd);
    return { nextDays: Array.from(set).sort(), added: false };
  }
  set.add(targetYmd);
  return { nextDays: Array.from(set).sort().slice(0, 31), added: true };
}

/**
 * Deterministic streak & consistency evaluator.
 * - For `daily` habits: counts consecutive completed days ending today (or yesterday if not yet done today).
 * - For `weekly` habits: counts consecutive 7-day rolling weeks meeting `targetPerWeek` (or consecutive active days as fallback).
 */
export function computeHabitStreakStats(
  habit: Pick<HabitItem, 'frequency' | 'targetPerWeek'>,
  completedDays: Set<string>,
  todayYmd: string
): HabitStreakStats {
  const sorted = Array.from(completedDays).sort();
  const totalCompletions = sorted.length;
  const completedToday = completedDays.has(todayYmd);
  const lastCompletedDate = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;

  // 30-day consistency & last 7 days
  let hits30 = 0;
  let hits7 = 0;
  for (let i = 0; i < 30; i++) {
    const day = addDaysYmd(todayYmd, -i);
    if (completedDays.has(day)) {
      hits30 += 1;
      if (i < 7) hits7 += 1;
    }
  }
  const expected30 =
    habit.frequency === 'daily' ? 30 : Math.max(1, Math.round((30 / 7) * habit.targetPerWeek));
  const consistency30dPct = Math.min(100, Math.round((hits30 / expected30) * 100));

  // Best daily streak across full history
  let bestStreak = 0;
  let run = 0;
  let prevDay: string | null = null;
  for (const day of sorted) {
    if (prevDay && addDaysYmd(prevDay, 1) === day) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > bestStreak) bestStreak = run;
    prevDay = day;
  }

  // Current streak (allowing today to still be pending if yesterday was completed)
  let currentStreak = 0;
  let cursor = completedToday ? todayYmd : addDaysYmd(todayYmd, -1);
  while (completedDays.has(cursor)) {
    currentStreak += 1;
    cursor = addDaysYmd(cursor, -1);
  }

  if (habit.frequency === 'weekly') {
    // Also count consecutive completed weeks (7-day blocks ending today) meeting targetPerWeek
    let weeklyStreak = 0;
    for (let w = 0; w < 52; w++) {
      let countInWeek = 0;
      for (let d = 0; d < 7; d++) {
        const ymd = addDaysYmd(todayYmd, -(w * 7 + d));
        if (completedDays.has(ymd)) countInWeek += 1;
      }
      if (countInWeek >= habit.targetPerWeek) {
        weeklyStreak += 1;
      } else if (w === 0 && countInWeek > 0) {
        // Current week still in progress; check prior weeks
        continue;
      } else {
        break;
      }
    }
    // Keep streak integer consistent (weeks for weekly habits, days for daily)
    currentStreak = weeklyStreak;
    bestStreak = Math.max(bestStreak > 0 ? Math.ceil(bestStreak / 7) : 0, weeklyStreak);
  }

  return {
    currentStreak,
    bestStreak: Math.max(bestStreak, currentStreak),
    totalCompletions,
    completedToday,
    consistency30dPct,
    completedLast7Days: hits7,
    lastCompletedDate,
  };
}

/**
 * Generates an 84-day (12-week) contribution heatmap grid ending on `todayYmd`.
 */
export function buildHabitHeatmap(
  completedDays: Set<string>,
  todayYmd: string,
  daysCount = 84
): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const dateYmd = addDaysYmd(todayYmd, -i);
    const dt = parseYmdUtc(dateYmd);
    cells.push({
      dateYmd,
      monthKey: dateYmd.slice(0, 7),
      weekday: dt.getUTCDay(),
      completed: completedDays.has(dateYmd),
      isToday: dateYmd === todayYmd,
    });
  }
  return cells;
}

/**
 * Deterministic Break-Pattern Analyzer (zero AI hallucination):
 * Examines the past 56 days (8 weeks) to find which weekday has the lowest completion rate
 * and the average streak length before a break occurs.
 */
export function analyzeHabitBreakPatterns(
  completedDays: Set<string>,
  todayYmd: string,
  windowDays = 56
): BreakPatternInsight {
  const hitsByDow = [0, 0, 0, 0, 0, 0, 0];
  const oppByDow = [0, 0, 0, 0, 0, 0, 0];

  const runs: number[] = [];
  let activeRun = 0;

  for (let i = windowDays - 1; i >= 0; i--) {
    const ymd = addDaysYmd(todayYmd, -i);
    const dow = parseYmdUtc(ymd).getUTCDay();
    oppByDow[dow] += 1;
    if (completedDays.has(ymd)) {
      hitsByDow[dow] += 1;
      activeRun += 1;
    } else if (activeRun > 0) {
      runs.push(activeRun);
      activeRun = 0;
    }
  }
  if (activeRun > 0) runs.push(activeRun);

  const weekdayCompletionRates = WEEKDAY_NAMES.map((label, weekday) => {
    const opp = oppByDow[weekday] || 1;
    return {
      weekday,
      label,
      pct: Math.round((hitsByDow[weekday] / opp) * 100),
      totalOpportunities: oppByDow[weekday],
    };
  });

  if (completedDays.size < 3) {
    return {
      weakestWeekdayIndex: null,
      weakestWeekdayLabel: null,
      weekdayCompletionRates,
      averageStreakBeforeBreak: completedDays.size,
      suggestion: 'Log at least 3 days to unlock deterministic weekday break-pattern insights.',
    };
  }

  let weakest = weekdayCompletionRates[0];
  for (const item of weekdayCompletionRates) {
    if (item.pct < weakest.pct) weakest = item;
  }

  const avgStreak =
    runs.length > 0
      ? Math.round((runs.reduce((acc, v) => acc + v, 0) / runs.length) * 10) / 10
      : 0;

  const suggestion =
    weakest.pct === 100
      ? 'Perfect 8-week consistency across every day of the week.'
      : `Most breaks happen on ${weakest.label} (${weakest.pct}% completion). Consider pairing a lighter 2-minute version or shifting your reminder on ${weakest.label}s.`;

  return {
    weakestWeekdayIndex: weakest.weekday,
    weakestWeekdayLabel: weakest.label,
    weekdayCompletionRates,
    averageStreakBeforeBreak: avgStreak,
    suggestion,
  };
}

export function computeHabitsOverview(
  habits: HabitItem[],
  logs: HabitMonthLog[],
  todayYmd: string
): HabitsOverviewSummary {
  const active = habits.filter((h) => !h.archived);
  if (active.length === 0) {
    return {
      activeCount: 0,
      completedTodayCount: 0,
      bestActiveStreak: 0,
      avgConsistency30dPct: 0,
    };
  }

  let completedTodayCount = 0;
  let bestActiveStreak = 0;
  let consistencySum = 0;

  for (const h of active) {
    const days = collectHabitCompletedDays(h.id, logs);
    const stats = computeHabitStreakStats(h, days, todayYmd);
    if (stats.completedToday) completedTodayCount += 1;
    if (stats.currentStreak > bestActiveStreak) bestActiveStreak = stats.currentStreak;
    consistencySum += stats.consistency30dPct;
  }

  return {
    activeCount: active.length,
    completedTodayCount,
    bestActiveStreak,
    avgConsistency30dPct: Math.round(consistencySum / active.length),
  };
}

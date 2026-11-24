import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysYmd,
  analyzeHabitBreakPatterns,
  buildHabitHeatmap,
  collectHabitCompletedDays,
  computeHabitsOverview,
  computeHabitStreakStats,
  toggleDayInMonthBucket,
} from './habitEngine';
import { getHabitMonthBucketId, type HabitItem, type HabitMonthLog } from './habitSchemas';

test('Monthly-bucketed habit log toggling, streak computation, and 84-day heatmap work deterministically', () => {
  const today = '2026-11-24';
  const habitId = 'hab_walk';
  assert.equal(getHabitMonthBucketId(habitId, '2026-11'), 'hab_walk_2026_11');

  let days: string[] = [];
  for (let i = 0; i < 5; i++) {
    const res = toggleDayInMonthBucket(days, addDaysYmd(today, -i));
    assert.equal(res.added, true);
    days = res.nextDays;
  }
  assert.equal(days.length, 5);

  const logs: HabitMonthLog[] = [
    {
      id: getHabitMonthBucketId(habitId, '2026-11'),
      uid: 'u1',
      habitId,
      monthKey: '2026-11',
      days,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    },
  ];

  const completedSet = collectHabitCompletedDays(habitId, logs);
  const stats = computeHabitStreakStats({ frequency: 'daily', targetPerWeek: 7 }, completedSet, today);
  assert.equal(stats.currentStreak, 5);
  assert.equal(stats.bestStreak, 5);
  assert.equal(stats.completedToday, true);
  assert.equal(stats.completedLast7Days, 5);

  const heatmap = buildHabitHeatmap(completedSet, today, 84);
  assert.equal(heatmap.length, 84);
  assert.equal(heatmap[83].dateYmd, today);
  assert.equal(heatmap[83].completed, true);
  assert.equal(heatmap[83].isToday, true);

  // Untoggle today and verify yesterday still holds 4-day active streak
  const untoggled = toggleDayInMonthBucket(days, today);
  assert.equal(untoggled.added, false);
  const afterUntoggle = computeHabitStreakStats(
    { frequency: 'daily', targetPerWeek: 7 },
    new Set(untoggled.nextDays),
    today
  );
  assert.equal(afterUntoggle.completedToday, false);
  assert.equal(afterUntoggle.currentStreak, 4);
});

test('Break-pattern analyzer accurately detects weakest weekday and computes overview metrics', () => {
  const today = '2026-11-24'; // Tuesday
  const completed = new Set<string>();
  // Complete every day in the last 56 days EXCEPT Fridays (weekday === 5)
  for (let i = 0; i < 56; i++) {
    const ymd = addDaysYmd(today, -i);
    const dt = new Date(`${ymd}T00:00:00Z`);
    if (dt.getUTCDay() !== 5) {
      completed.add(ymd);
    }
  }

  const insight = analyzeHabitBreakPatterns(completed, today, 56);
  assert.equal(insight.weakestWeekdayIndex, 5);
  assert.equal(insight.weakestWeekdayLabel, 'Friday');
  assert.match(insight.suggestion, /Friday/);
  assert.ok(insight.averageStreakBeforeBreak >= 5);

  const habit: HabitItem = {
    id: 'hab_read',
    uid: 'u1',
    name: 'Read 20 pages',
    category: 'learning',
    frequency: 'daily',
    targetPerWeek: 7,
    currentStreak: 4,
    bestStreak: 6,
    totalCompletions: completed.size,
    archived: false,
    version: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
  };
  const overview = computeHabitsOverview(
    [habit],
    [
      {
        id: 'hab_read_2026_11',
        uid: 'u1',
        habitId: 'hab_read',
        monthKey: '2026-11',
        days: Array.from(completed).filter((d) => d.startsWith('2026-11')),
        version: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
    ],
    today
  );
  assert.equal(overview.activeCount, 1);
  assert.equal(overview.completedTodayCount, 1);
  assert.ok(overview.bestActiveStreak >= 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSortKeys,
  generateSortKeyBetween,
  sortBySortKey,
} from './fractionalIndex.ts';
import { buildUnifiedMonthlyCalendar } from './unifiedCalendar.ts';
import type { TaskItem } from './plannerSchemas.ts';
import type { ReminderItem } from '../reminders/reminderSchemas.ts';
import type { DebtRecord } from '../debts/debtSchemas.ts';

test('Fractional Index generates strictly ordered keys across 50 sequential midpoint insertions', () => {
  const first = generateSortKeyBetween(null, null);
  const last = generateSortKeyBetween(first, null);
  assert.ok(compareSortKeys(first, last) < 0);

  let left = first;
  const right = last;
  const generated: string[] = [first];

  // Repeatedly insert between left and right (worst-case stress test)
  for (let i = 0; i < 50; i++) {
    const mid = generateSortKeyBetween(left, right);
    assert.ok(compareSortKeys(left, mid) < 0, `Expected ${left} < ${mid} at iteration ${i}`);
    assert.ok(compareSortKeys(mid, right) < 0, `Expected ${mid} < ${right} at iteration ${i}`);
    assert.match(mid, /^[0-9A-Za-z]{1,64}$/);
    generated.push(mid);
    left = mid;
  }
  generated.push(right);

  const shuffled = [...generated].reverse().map((sortKey, idx) => ({ id: `t_${idx}`, sortKey }));
  const sorted = sortBySortKey(shuffled).map((x) => x.sortKey);
  assert.deepEqual(sorted, generated);
});

test('Fractional Index supports prepending before the first item', () => {
  let head = generateSortKeyBetween(null, null);
  for (let i = 0; i < 10; i++) {
    const prev = generateSortKeyBetween(null, head);
    assert.ok(compareSortKeys(prev, head) < 0, `Expected ${prev} < ${head}`);
    assert.match(prev, /^[0-9A-Za-z]{1,64}$/);
    head = prev;
  }
});

test('Unified Monthly Calendar merges Tasks, Reminders, and Open Debts on exact day cells', () => {
  const tasks: TaskItem[] = [
    {
      id: 'task_1',
      uid: 'u1',
      listId: 'work',
      title: 'Finalize quarterly budget',
      priority: 1,
      sortKey: 'V',
      status: 'todo',
      dueDate: '2026-11-15',
      version: 1,
    },
  ];
  const reminders: ReminderItem[] = [
    {
      id: 'rem_1',
      uid: 'u1',
      title: 'Evening Meds',
      category: 'medicine',
      priority: 'urgent',
      dueAtIso: '2026-11-15T12:00:00.000Z',
      respectQuietHours: false,
      status: 'scheduled',
      isCompleted: false,
      completedCount: 0,
      version: 1,
    },
  ];
  const debts: DebtRecord[] = [
    {
      id: 'debt_1',
      uid: 'u1',
      direction: 'i_owe',
      personKey: 'karwan',
      personName: 'Karwan',
      category: 'personal',
      principalMinor: 100000,
      remainingMinor: 50000,
      currency: 'IQD',
      dueDate: '2026-11-15',
      status: 'partial',
      paymentCount: 1,
      version: 2,
    },
  ];

  const grid = buildUnifiedMonthlyCalendar({
    year: 2026,
    monthIndex: 10, // November (0-indexed)
    todayYmd: '2026-11-15',
    tasks,
    reminders,
    debts,
  });

  assert.equal(grid.days.length, 42);
  const nov15 = grid.days.find((d) => d.dateYmd === '2026-11-15');
  assert.ok(nov15);
  assert.equal(nov15.isToday, true);
  assert.equal(nov15.events.length, 3);
  const kinds = new Set(nov15.events.map((e) => e.kind));
  assert.deepEqual(kinds, new Set(['task', 'reminder', 'debt']));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCompletionTransition,
  describeRRule,
  expandReminderOccurrences,
  parseRRule,
  serializeRRule,
} from './rruleEngine';
import {
  analyzeSevenDayWorkload,
  buildRollingNotificationQueue,
  IOS_LOCAL_NOTIFICATION_CAP,
  isInQuietHours,
  shiftPastQuietHours,
} from './notificationScheduler';
import type { ReminderItem } from './reminderSchemas';

function makeReminder(overrides: Partial<ReminderItem> = {}): ReminderItem {
  return {
    id: 'rem_test_1',
    uid: 'user_1',
    title: 'Take Vitamin D',
    category: 'routine',
    priority: 'normal',
    dueAtIso: new Date(2026, 10, 23, 9, 0, 0).toISOString(),
    respectQuietHours: true,
    status: 'scheduled',
    isCompleted: false,
    completedCount: 0,
    version: 1,
    ...overrides,
  };
}

test('RRULE parse, serialize, and human description round-trip cleanly', () => {
  const rule = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,SU,FR;COUNT=10');
  assert.ok(rule);
  assert.equal(rule.freq, 'WEEKLY');
  assert.equal(rule.interval, 2);
  assert.deepEqual(rule.byDay, ['SU', 'WE', 'FR']);
  assert.equal(rule.count, 10);

  const serialized = serializeRRule(rule);
  assert.equal(serialized, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,WE,FR;COUNT=10');
  assert.match(describeRRule(serialized), /Every 2 weeks on Sun, Wed, Fri/);

  // Reject malformed rules
  assert.equal(parseRRule('FREQ=HOURLY'), null);
  assert.equal(parseRRule('FREQ=DAILY;INTERVAL=0'), null);
});

test('Monthly RRULE clamps Jan 31 safely to Feb 28 (non-leap) and Mar 31', () => {
  const base = new Date(2026, 0, 31, 10, 0, 0); // Jan 31, 2026
  const rem = makeReminder({
    dueAtIso: base.toISOString(),
    rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31',
  });
  const occurrences = expandReminderOccurrences(
    rem,
    new Date(2026, 0, 1, 0, 0, 0),
    new Date(2026, 3, 5, 23, 59, 59),
    5
  );
  assert.equal(occurrences.length, 3);
  assert.equal(occurrences[0].getMonth(), 0);
  assert.equal(occurrences[0].getDate(), 31);
  assert.equal(occurrences[1].getMonth(), 1);
  assert.equal(occurrences[1].getDate(), 28); // 2026 is not leap year
  assert.equal(occurrences[2].getMonth(), 2);
  assert.equal(occurrences[2].getDate(), 31);
});

test('Quiet hours accurately detect and shift overnight (22:00-07:00) and daytime ranges', () => {
  const quiet = { startHHMM: '22:00', endHHMM: '07:00' };
  const lateNight = new Date(2026, 10, 23, 23, 30, 0);
  const earlyMorning = new Date(2026, 10, 24, 5, 15, 0);
  const noon = new Date(2026, 10, 24, 12, 0, 0);

  assert.equal(isInQuietHours(lateNight, quiet), true);
  assert.equal(isInQuietHours(earlyMorning, quiet), true);
  assert.equal(isInQuietHours(noon, quiet), false);

  const shiftedEvening = shiftPastQuietHours(lateNight, quiet);
  assert.equal(shiftedEvening.shifted, true);
  assert.equal(shiftedEvening.date.getDate(), 24);
  assert.equal(shiftedEvening.date.getHours(), 7);
  assert.equal(shiftedEvening.date.getMinutes(), 0);

  const shiftedEarly = shiftPastQuietHours(earlyMorning, quiet);
  assert.equal(shiftedEarly.shifted, true);
  assert.equal(shiftedEarly.date.getDate(), 24);
  assert.equal(shiftedEarly.date.getHours(), 7);
});

test('Rolling 64-Notification Scheduler strictly caps slots at 64 and respects medicine quiet-hour bypass', () => {
  const now = new Date(2026, 10, 23, 8, 0, 0);
  // Create 4 daily reminders -> 4 * 30 = 120 occurrences in 30 days (> 64 cap)
  const reminders: ReminderItem[] = [
    makeReminder({
      id: 'rem_med',
      title: 'Night Insulin',
      category: 'medicine',
      priority: 'urgent',
      dueAtIso: new Date(2026, 10, 23, 23, 0, 0).toISOString(),
      rrule: 'FREQ=DAILY;INTERVAL=1',
      respectQuietHours: false, // must NOT shift
    }),
    makeReminder({
      id: 'rem_quiet_shift',
      title: 'Evening Journal',
      category: 'routine',
      priority: 'low',
      dueAtIso: new Date(2026, 10, 23, 23, 15, 0).toISOString(),
      rrule: 'FREQ=DAILY;INTERVAL=1',
      respectQuietHours: true, // MUST shift to 07:00 next day
    }),
    makeReminder({
      id: 'rem_bill',
      title: 'Check Utility Meter',
      category: 'bill',
      priority: 'high',
      dueAtIso: new Date(2026, 10, 23, 10, 0, 0).toISOString(),
      rrule: 'FREQ=DAILY;INTERVAL=1',
    }),
    makeReminder({
      id: 'rem_task',
      title: 'Inbox Zero',
      category: 'task',
      priority: 'normal',
      dueAtIso: new Date(2026, 10, 23, 15, 0, 0).toISOString(),
      rrule: 'FREQ=DAILY;INTERVAL=1',
    }),
  ];

  const queue = buildRollingNotificationQueue({
    reminders,
    quietHours: { startHHMM: '22:00', endHHMM: '07:00' },
    now,
    horizonDays: 30,
  });

  assert.equal(queue.cap, IOS_LOCAL_NOTIFICATION_CAP);
  assert.equal(queue.slots.length, 64);
  assert.ok(queue.overflowCount > 50);

  // Verify medicine bypassed quiet hours
  const medSlot = queue.slots.find((s) => s.reminderId === 'rem_med');
  assert.ok(medSlot);
  assert.equal(medSlot.bypassedQuietHours, true);
  assert.equal(medSlot.shiftedByQuietHours, false);
  assert.equal(new Date(medSlot.scheduledFireAtIso).getHours(), 23);

  // Verify routine shifted past quiet hours to 07:00
  const quietSlot = queue.slots.find((s) => s.reminderId === 'rem_quiet_shift');
  assert.ok(quietSlot);
  assert.equal(quietSlot.shiftedByQuietHours, true);
  assert.equal(new Date(quietSlot.scheduledFireAtIso).getHours(), 7);

  // Verify chronological ordering across all 64 slots
  for (let i = 1; i < queue.slots.length; i++) {
    assert.ok(
      new Date(queue.slots[i].scheduledFireAtIso).getTime() >=
        new Date(queue.slots[i - 1].scheduledFireAtIso).getTime()
    );
  }
});

test('Completion transition advances recurring reminders and finishes COUNT-bounded or one-time reminders', () => {
  const oneTime = makeReminder({ rrule: undefined });
  const doneOne = computeCompletionTransition(oneTime, new Date(2026, 10, 23, 9, 5, 0));
  assert.equal(doneOne.nextStatus, 'completed');
  assert.equal(doneOne.nextIsCompleted, true);
  assert.equal(doneOne.advancedRecurring, false);

  const recurring = makeReminder({
    dueAtIso: new Date(2026, 10, 23, 9, 0, 0).toISOString(),
    rrule: 'FREQ=DAILY;INTERVAL=1;COUNT=2',
    completedCount: 0,
  });
  const firstStep = computeCompletionTransition(recurring, new Date(2026, 10, 23, 9, 5, 0));
  assert.equal(firstStep.nextStatus, 'scheduled');
  assert.equal(firstStep.nextIsCompleted, false);
  assert.equal(firstStep.advancedRecurring, true);
  assert.equal(new Date(firstStep.nextDueAtIso).getDate(), 24);

  const secondStep = computeCompletionTransition(
    { ...recurring, dueAtIso: firstStep.nextDueAtIso, completedCount: firstStep.nextCompletedCount },
    new Date(2026, 10, 24, 9, 5, 0)
  );
  assert.equal(secondStep.nextStatus, 'completed');
  assert.equal(secondStep.nextIsCompleted, true);
});

test('Seven-day workload analyzer flags overloaded days accurately', () => {
  const now = new Date(2026, 10, 23, 8, 0, 0);
  const reminders: ReminderItem[] = [0, 1, 2, 3, 4].map((idx) =>
    makeReminder({
      id: `rem_load_${idx}`,
      title: `Task ${idx}`,
      dueAtIso: new Date(2026, 10, 23, 10 + idx, 0, 0).toISOString(),
    })
  );
  const queue = buildRollingNotificationQueue({
    reminders,
    quietHours: { startHHMM: '22:00', endHHMM: '07:00' },
    now,
  });
  const workload = analyzeSevenDayWorkload(queue, now);
  assert.equal(workload.length, 7);
  assert.equal(workload[0].count, 5);
  assert.equal(workload[0].isOverloaded, true);
  assert.equal(workload[1].count, 0);
  assert.equal(workload[1].isOverloaded, false);
});

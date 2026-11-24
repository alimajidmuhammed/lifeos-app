/**
 * Expo-Portable Unified Calendar Aggregator
 *
 * Merges due dates across Tasks, Smart Reminders, and Open Debts into a deterministic
 * 42-cell (6-week) monthly calendar grid without any DOM or Firebase dependencies.
 */

import type { DebtRecord } from '../debts/debtSchemas';
import { computeEffectiveStatus } from '../debts/debtEngine';
import { getEffectiveFireDate } from '../reminders/notificationScheduler';
import type { ReminderItem } from '../reminders/reminderSchemas';
import type { TaskItem } from './plannerSchemas';

export type CalendarEventKind = 'task' | 'reminder' | 'debt';

export interface CalendarEvent {
  id: string;
  sourceId: string;
  kind: CalendarEventKind;
  dateYmd: string;
  title: string;
  subtitle?: string;
  timeLabel?: string;
  isDone: boolean;
  isUrgent: boolean;
}

export interface CalendarDayCell {
  dateYmd: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

export interface MonthlyCalendarGrid {
  year: number;
  monthIndex: number; // 0..11
  days: CalendarDayCell[];
  totalEventsInMonth: number;
}

export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildUnifiedMonthlyCalendar(params: {
  year: number;
  monthIndex: number; // 0..11
  todayYmd: string;
  tasks: readonly TaskItem[];
  reminders: readonly ReminderItem[];
  debts: readonly DebtRecord[];
}): MonthlyCalendarGrid {
  const { year, monthIndex, todayYmd, tasks, reminders, debts } = params;

  const eventsByDay = new Map<string, CalendarEvent[]>();
  const pushEvent = (ev: CalendarEvent) => {
    const arr = eventsByDay.get(ev.dateYmd);
    if (arr) {
      arr.push(ev);
    } else {
      eventsByDay.set(ev.dateYmd, [ev]);
    }
  };

  for (const task of tasks) {
    if (!task.dueDate) continue;
    pushEvent({
      id: `task_${task.id}`,
      sourceId: task.id,
      kind: 'task',
      dateYmd: task.dueDate,
      title: task.title,
      subtitle: task.listId,
      isDone: task.status === 'done',
      isUrgent: task.priority === 1 && task.status !== 'done',
    });
  }

  for (const rem of reminders) {
    if (rem.status === 'archived') continue;
    const fire = getEffectiveFireDate(rem);
    if (Number.isNaN(fire.getTime())) continue;
    const ymd = formatLocalYmd(fire);
    pushEvent({
      id: `rem_${rem.id}`,
      sourceId: rem.id,
      kind: 'reminder',
      dateYmd: ymd,
      title: rem.title,
      subtitle: rem.category,
      timeLabel: formatHHMM(fire),
      isDone: rem.isCompleted,
      isUrgent: !rem.isCompleted && (rem.priority === 'urgent' || rem.priority === 'high'),
    });
  }

  for (const debt of debts) {
    if (!debt.dueDate) continue;
    const status = computeEffectiveStatus(debt, todayYmd);
    if (status === 'settled') continue;
    pushEvent({
      id: `debt_${debt.id}`,
      sourceId: debt.id,
      kind: 'debt',
      dateYmd: debt.dueDate,
      title: `${debt.direction === 'i_owe' ? 'Pay' : 'Collect'}: ${debt.personName}`,
      subtitle: debt.currency,
      isDone: false,
      isUrgent: status === 'overdue',
    });
  }

  const firstOfMonth = new Date(year, monthIndex, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(year, monthIndex, 1 - startWeekday);

  const days: CalendarDayCell[] = [];
  let totalEventsInMonth = 0;

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateYmd = formatLocalYmd(cellDate);
    const inCurrentMonth = cellDate.getMonth() === monthIndex && cellDate.getFullYear() === year;
    const dayEvents = (eventsByDay.get(dateYmd) ?? []).sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
    if (inCurrentMonth) {
      totalEventsInMonth += dayEvents.length;
    }
    days.push({
      dateYmd,
      dayOfMonth: cellDate.getDate(),
      inCurrentMonth,
      isToday: dateYmd === todayYmd,
      events: dayEvents,
    });
  }

  return {
    year,
    monthIndex,
    days,
    totalEventsInMonth,
  };
}

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { DebtRecord } from '../../../core/debts/debtSchemas';
import type { ReminderItem } from '../../../core/reminders/reminderSchemas';
import type { TaskItem } from '../../../core/planner/plannerSchemas';
import {
  buildUnifiedMonthlyCalendar,
  formatLocalYmd,
  type CalendarEventKind,
} from '../../../core/planner/unifiedCalendar';

interface UnifiedCalendarPanelProps {
  tasks: readonly TaskItem[];
  reminders: readonly ReminderItem[];
  debts: readonly DebtRecord[];
  locale: string;
  onAddTaskForDate: (ymd: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KIND_LABELS: Record<CalendarEventKind, string> = {
  task: 'Task',
  reminder: 'Reminder',
  debt: 'Debt Due',
};

export const UnifiedCalendarPanel: React.FC<UnifiedCalendarPanelProps> = ({
  tasks,
  reminders,
  debts,
  locale,
  onAddTaskForDate,
}) => {
  const today = new Date();
  const todayYmd = formatLocalYmd(today);

  const [cursorYear, setCursorYear] = useState(today.getFullYear());
  const [cursorMonth, setCursorMonth] = useState(today.getMonth());
  const [selectedYmd, setSelectedYmd] = useState(todayYmd);

  const grid = useMemo(
    () =>
      buildUnifiedMonthlyCalendar({
        year: cursorYear,
        monthIndex: cursorMonth,
        todayYmd,
        tasks,
        reminders,
        debts,
      }),
    [cursorYear, cursorMonth, todayYmd, tasks, reminders, debts]
  );

  const selectedCell = useMemo(
    () => grid.days.find((d) => d.dateYmd === selectedYmd) ?? grid.days.find((d) => d.isToday) ?? grid.days[0],
    [grid.days, selectedYmd]
  );

  const monthTitle = useMemo(() => {
    const dt = new Date(cursorYear, cursorMonth, 1);
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, {
      month: 'long',
      year: 'numeric',
    }).format(dt);
  }, [cursorYear, cursorMonth, locale]);

  const shiftMonth = (delta: number) => {
    const next = new Date(cursorYear, cursorMonth + delta, 1);
    setCursorYear(next.getFullYear());
    setCursorMonth(next.getMonth());
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      {/* Monthly Grid */}
      <div className="xl:col-span-2 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{monthTitle}</h2>
            <p className="text-xs text-[var(--text-muted)] font-numeric">
              {grid.totalEventsInMonth} scheduled {grid.totalEventsInMonth === 1 ? 'item' : 'items'} · Tasks · Reminders · Debts
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCursorYear(today.getFullYear());
                setCursorMonth(today.getMonth());
                setSelectedYmd(todayYmd);
              }}
              className="min-h-[36px] px-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
          {WEEKDAYS.map((wd) => (
            <div
              key={wd}
              className="py-2 text-center text-[11px] font-semibold text-[var(--text-muted)]"
            >
              {wd}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-[var(--border-hairline)]">
          {grid.days.map((cell) => {
            const isSelected = cell.dateYmd === selectedCell?.dateYmd;
            const visibleEvents = cell.events.slice(0, 2);
            const moreCount = cell.events.length - visibleEvents.length;

            return (
              <button
                key={cell.dateYmd}
                type="button"
                onClick={() => setSelectedYmd(cell.dateYmd)}
                className={`min-h-[84px] sm:min-h-[96px] p-2 text-start flex flex-col justify-between transition-colors ${
                  isSelected
                    ? 'bg-[var(--accent-soft)]'
                    : cell.inCurrentMonth
                      ? 'bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)]/50'
                      : 'bg-[var(--bg-canvas)] text-[var(--text-muted)]'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span
                    className={`font-numeric text-xs font-semibold ${
                      cell.isToday
                        ? 'text-[var(--accent)]'
                        : cell.inCurrentMonth
                          ? 'text-[var(--text-primary)]'
                          : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {cell.dayOfMonth}
                  </span>
                  {cell.events.length > 0 && (
                    <span className="font-numeric text-[10px] text-[var(--text-muted)]">
                      {cell.events.length}
                    </span>
                  )}
                </div>

                <div className="space-y-0.5 w-full mt-1">
                  {visibleEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className={`truncate text-[11px] leading-tight ${
                        ev.isDone
                          ? 'line-through text-[var(--text-muted)]'
                          : ev.kind === 'debt'
                            ? 'text-amber-700 dark:text-amber-300 font-medium'
                            : ev.kind === 'reminder'
                              ? 'text-[var(--accent)] font-medium'
                              : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {moreCount > 0 && (
                    <div className="font-numeric text-[10px] text-[var(--text-muted)]">
                      +{moreCount} more
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Day Agenda Inspector */}
      <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between gap-2">
          <div>
            <h3 className="font-numeric text-sm font-semibold text-[var(--text-primary)]">
              {selectedCell?.dateYmd}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              {selectedCell?.events.length ?? 0}{' '}
              {(selectedCell?.events.length ?? 0) === 1 ? 'entry' : 'entries'} across modules
            </p>
          </div>
          <button
            type="button"
            onClick={() => onAddTaskForDate(selectedCell?.dateYmd ?? todayYmd)}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Task</span>
          </button>
        </div>

        {!selectedCell || selectedCell.events.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--text-muted)]">
            No tasks, reminders, or debt due dates scheduled on this day.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-hairline)]">
            {selectedCell.events.map((ev) => (
              <div key={ev.id} className="px-5 py-3.5 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-medium ${
                      ev.isDone ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {ev.title}
                  </span>
                  {ev.timeLabel && (
                    <span className="font-numeric text-xs text-[var(--text-muted)] shrink-0">
                      {ev.timeLabel}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  <span
                    className={
                      ev.kind === 'debt'
                        ? 'text-amber-700 dark:text-amber-300 font-medium'
                        : ev.kind === 'reminder'
                          ? 'text-[var(--accent)] font-medium'
                          : 'text-[var(--text-secondary)] font-medium'
                    }
                  >
                    {KIND_LABELS[ev.kind]}
                  </span>
                  {ev.subtitle && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span>{ev.subtitle}</span>
                    </>
                  )}
                  {ev.isUrgent && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="text-red-600 dark:text-red-400 font-medium">Priority</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

import React from 'react';
import { Bell, BellRing, Info, MoonStar } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  REMINDER_CHANNELS,
  type ReminderCategory,
} from '../../../core/reminders/reminderSchemas';
import type {
  DailyWorkloadSummary,
  QuietHoursConfig,
  RollingSchedulerSnapshot,
} from '../../../core/reminders/notificationScheduler';
import type { BrowserNotificationState } from '../../../hooks/useReminders';
import { isNativePlatform } from '../../../core/reminders/nativeNotifications';

function formatSlotTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/**
 * 1. Rolling 64-Notification Queue Inspector Panel
 */
export const RollingQueuePanel: React.FC<{
  queue: RollingSchedulerSnapshot;
  quietHours: QuietHoursConfig;
  locale: string;
  notifPermission: BrowserNotificationState;
  onRequestPermission: () => Promise<void>;
  onSendTest: () => void;
}> = ({
  queue,
  quietHours,
  locale,
  notifPermission,
  onRequestPermission,
  onSendTest,
}) => {
  const { t } = useTranslation();
  const usagePct = Math.min(100, Math.round((queue.slots.length / queue.cap) * 100));

  return (
    <div className="space-y-4">
      {/* Scheduler Status & Web Notification Controls */}
      <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('reminders.schedulerTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Rolling {queue.horizonDays}-day window strictly capped at {queue.cap} pending local slots for iOS compatibility · Quiet hours {quietHours.startHHMM}–{quietHours.endHHMM}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {notifPermission === 'granted' ? (
              <button
                type="button"
                onClick={onSendTest}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
              >
                <BellRing className="h-3.5 w-3.5 text-[var(--accent)]" />
                <span>{t('reminders.testNotifBtn')}</span>
              </button>
            ) : notifPermission === 'default' ? (
              <button
                type="button"
                onClick={() => void onRequestPermission()}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] whitespace-nowrap"
              >
                <Bell className="h-3.5 w-3.5" />
                <span>{t('reminders.enableNotifBtn')}</span>
              </button>
            ) : (
              <span className="text-xs text-[var(--text-muted)]">
                {isNativePlatform() ? 'Device alerts' : 'Browser alerts'}:{' '}
                {notifPermission === 'denied'
                  ? isNativePlatform()
                    ? 'Blocked in Phone Settings'
                    : 'Blocked in browser settings'
                  : 'Unsupported'}
              </span>
            )}
          </div>
        </div>

        {/* Capacity Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-numeric">
            <span className="font-semibold text-[var(--text-primary)]">
              {queue.slots.length} / {queue.cap} slots scheduled
            </span>
            <span className="text-[var(--text-muted)]">
              {queue.quietHoursShiftedCount} quiet-hour shifted · {queue.overflowCount} deferred beyond 64-cap
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>

        {/* Platform Delivery Mode Note */}
        <div className="flex items-start gap-2.5 pt-2 border-t border-[var(--border-hairline)] text-xs text-[var(--text-secondary)]">
          <Info className="h-4 w-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
          <p>
            {isNativePlatform() ? (
              <>
                <strong>Native Mobile Alarms Active:</strong> This 64-slot queue is synced directly to your device&apos;s OS alarm scheduler (<code className="font-numeric">LocalNotifications</code>) for 100% offline lock-screen alerts even when the app is closed.
              </>
            ) : (
              <>
                <strong>Web Browser Mode vs. Native App:</strong> In a web browser tab, alerts rely on browser notification permissions. When installed as the native Android/iOS app, this exact 64-slot queue schedules OS-level offline alarms automatically.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Scheduled Slot Table */}
      {queue.slots.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-secondary)]">
          No upcoming notifications in the next {queue.horizonDays} days. Add a reminder or debt due date to populate the rolling 64-slot queue.
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
          {queue.slots.map((slot) => (
            <div
              key={`${slot.reminderId}_${slot.slotIndex}`}
              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-numeric text-xs font-semibold text-[var(--text-muted)]">
                    #{slot.slotIndex}
                  </span>
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {slot.title}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-muted)]">
                  <span className="font-numeric">{slot.channelId}</span>
                  <span aria-hidden="true">·</span>
                  <span>{slot.priority}</span>
                  {slot.source === 'debt_due' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[var(--accent)]">Auto debt due alert</span>
                    </>
                  )}
                  {slot.shiftedByQuietHours && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <MoonStar className="h-3 w-3" />
                        Shifted past quiet hours
                      </span>
                    </>
                  )}
                  {slot.bypassedQuietHours && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-red-600 dark:text-red-400">
                        Quiet hours bypassed
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="text-start sm:text-end shrink-0">
                <div className="font-numeric text-xs font-semibold text-[var(--text-primary)]">
                  {formatSlotTime(slot.scheduledFireAtIso, locale)}
                </div>
                {slot.shiftedByQuietHours && (
                  <div className="font-numeric text-[11px] text-[var(--text-muted)]">
                    was {formatSlotTime(slot.originalFireAtIso, locale)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 2. Eight Notification Channels Directory Panel
 */
export const ChannelsDirectoryPanel: React.FC<{
  channelCounts: Record<ReminderCategory, number>;
  onFilterChannel: (cat: ReminderCategory) => void;
}> = ({ channelCounts, onFilterChannel }) => {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
      {REMINDER_CHANNELS.map((ch) => (
        <div
          key={ch.id}
          className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t(ch.labelKey)}
              </span>
              <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
              <span className="font-numeric text-xs text-[var(--text-muted)]">{ch.channelId}</span>
              <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
              <span className="text-xs text-[var(--text-secondary)]">
                Default: {ch.defaultPriority}
              </span>
              <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
              <span
                className={`text-xs font-medium ${
                  ch.defaultRespectQuietHours
                    ? 'text-[var(--text-muted)]'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {ch.defaultRespectQuietHours ? 'Respects quiet hours' : 'Bypasses quiet hours'}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{ch.description}</p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="font-numeric text-xs text-[var(--text-muted)]">
              {channelCounts[ch.id]} {channelCounts[ch.id] === 1 ? 'slot' : 'slots'}
            </span>
            <button
              type="button"
              onClick={() => onFilterChannel(ch.id)}
              className="min-h-[36px] rounded-lg border border-[var(--border-hairline)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
            >
              Filter
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * 3. Deterministic 7-Day Workload Balance Panel
 */
export const WorkloadBalancePanel: React.FC<{
  workload: DailyWorkloadSummary[];
}> = ({ workload }) => {
  const maxCount = Math.max(5, ...workload.map((d) => d.count));

  return (
    <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
      <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>Deterministic 7-day alert load (flags ≥ 5 alerts/day or ≥ 3 alerts in one clock hour)</span>
        <span className="font-numeric">Next 7 days</span>
      </div>

      {workload.map((day) => {
        const pct = Math.min(100, Math.round((day.count / maxCount) * 100));
        return (
          <div key={day.dateYmd} className="px-5 py-4 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {day.label}
                </span>
                <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                <span className="font-numeric text-xs text-[var(--text-muted)]">
                  {day.dateYmd}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-numeric">
                <span
                  className={`font-semibold ${
                    day.isOverloaded
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-[var(--text-primary)]'
                  }`}
                >
                  {day.count} {day.count === 1 ? 'alert' : 'alerts'}
                </span>
                {day.isOverloaded && (
                  <>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">·</span>
                    <span className="font-sans font-medium text-amber-600 dark:text-amber-400">
                      {day.clusteredHour !== null
                        ? `Clustered around ${String(day.clusteredHour).padStart(2, '0')}:00`
                        : 'Heavy day — consider snoozing low-priority items'}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  day.isOverloaded ? 'bg-amber-500' : 'bg-[var(--accent)]'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

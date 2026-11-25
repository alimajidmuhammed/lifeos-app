import React, { useMemo, useState } from 'react';
import {
  Bell,
  Check,
  Clock,
  Edit3,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { computeEffectiveStatus } from '../../../core/debts/debtEngine';
import {
  getEffectiveFireDate,
  isInQuietHours,
} from '../../../core/reminders/notificationScheduler';
import {
  getChannelMeta,
  REMINDER_CHANNELS,
  type ReminderCategory,
  type ReminderItem,
} from '../../../core/reminders/reminderSchemas';
import { describeRRule } from '../../../core/reminders/rruleEngine';
import { useDebts } from '../../../hooks/useDebts';
import { useReminders } from '../../../hooks/useReminders';
import { useUIStore } from '../../../state/useUIStore';
import { hapticLight, hapticSuccess } from '../../../core/native/mobileBridge';
import { isNativePlatform } from '../../../core/reminders/nativeNotifications';
import { ReminderFormModal } from './ReminderFormModal';
import {
  ChannelsDirectoryPanel,
  RollingQueuePanel,
  WorkloadBalancePanel,
} from './RemindersSchedulerPanels';

type SubTab = 'agenda' | 'queue' | 'channels' | 'workload';
type StatusFilter = 'active' | 'today' | 'overdue' | 'completed' | 'all';

function formatDueDisplay(date: Date, locale: string): string {
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const RemindersView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const showToast = useUIStore((s) => s.showToast);

  const { debts } = useDebts();
  const {
    reminders,
    loading,
    quietHours,
    rollingQueue,
    sevenDayWorkload,
    summary,
    notifPermission,
    requestBrowserNotifications,
    sendTestNotification,
    createReminder,
    updateReminder,
    completeReminder,
    reopenReminder,
    snoozeReminder,
    deleteReminder,
    restoreReminder,
    isCloudSynced,
  } = useReminders();

  const [subTab, setSubTab] = useState<SubTab>('agenda');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ReminderCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [formFocusAi, setFormFocusAi] = useState(false);
  const [editingReminder, setEditingReminder] = useState<ReminderItem | null>(null);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  const [swipeRow, setSwipeRow] = useState<{ id: string; startX: number; startY: number; dx: number } | null>(null);

  const openDebts = useMemo(
    () => debts.filter((d) => computeEffectiveStatus(d) !== 'settled'),
    [debts]
  );

  const filteredReminders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 24 * 60 * 60 * 1000 - 1;

    return reminders.filter((r) => {
      const done = r.isCompleted || r.status === 'completed' || r.status === 'archived';
      const fireMs = getEffectiveFireDate(r).getTime();

      if (statusFilter === 'active' && done) return false;
      if (statusFilter === 'completed' && !done) return false;
      if (statusFilter === 'overdue' && (done || fireMs >= now.getTime())) return false;
      if (statusFilter === 'today' && (done || fireMs < startOfToday || fireMs > endOfToday)) {
        return false;
      }

      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (q) {
        const hay = `${r.title} ${r.notes ?? ''} ${r.category} ${r.rrule ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reminders, statusFilter, categoryFilter, searchQuery]);

  const handleCompleteToggle = async (rem: ReminderItem) => {
    void hapticSuccess();
    if (rem.isCompleted) {
      await reopenReminder(rem);
      showToast(`Reopened "${rem.title}".`);
      return;
    }
    const res = await completeReminder(rem);
    if (res.advancedRecurring) {
      showToast(
        `Completed "${rem.title}" — next scheduled for ${formatDueDisplay(new Date(res.nextDueAtIso), profile.locale)}.`
      );
    } else {
      showToast(`Completed "${rem.title}".`);
    }
  };

  const handleQuickSnooze = async (rem: ReminderItem, mode: '15m' | '1h' | 'tomorrow9') => {
    void hapticLight();
    let target: Date;
    if (mode === '15m') {
      target = new Date(Date.now() + 15 * 60 * 1000);
      target.setSeconds(0, 0);
    } else if (mode === '1h') {
      target = new Date(Date.now() + 60 * 60 * 1000);
      target.setSeconds(0, 0);
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      target = tomorrow;
    }
    await snoozeReminder(rem, target.toISOString());
    setSnoozeOpenId(null);
    showToast(`Snoozed "${rem.title}" until ${formatDueDisplay(target, profile.locale)}.`);
  };

  const handleDeleteWithUndo = async (rem: ReminderItem) => {
    void hapticLight();
    await deleteReminder(rem);
    showToast(`Deleted "${rem.title}".`, () => {
      void restoreReminder(rem);
    });
  };

  const handleRequestNotif = async () => {
    void hapticLight();
    const res = await requestBrowserNotifications();
    if (res === 'granted') {
      showToast(isNativePlatform() ? 'Native device alarms enabled.' : 'Browser notifications enabled.');
    } else if (res === 'denied') {
      showToast(
        isNativePlatform()
          ? 'Notifications blocked in Phone Settings → Apps → LifeinOne.'
          : 'Browser notifications were blocked in site settings.'
      );
    }
  };

  const handleSendTest = () => {
    const ok = sendTestNotification();
    showToast(
      ok
        ? isNativePlatform()
          ? 'Native alarm scheduled (fires in 1s).'
          : 'Test notification dispatched.'
        : isNativePlatform()
          ? 'Enable device alarm permission first.'
          : 'Enable browser notification permission first.'
    );
  };

  const nowMs = Date.now();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)]">
            <span>{isCloudSynced ? t('common.syncedCloudMode') : t('common.offlineLocalMode')}</span>
            <span aria-hidden="true"> · </span>
            <span className="font-numeric">
              {t('ui.quietHoursLabel')} {quietHours.startHHMM}–{quietHours.endHHMM}
            </span>
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('reminders.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {t('reminders.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {notifPermission === 'granted' ? (
            <button
              type="button"
              onClick={handleSendTest}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs sm:text-sm font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors whitespace-nowrap"
            >
              <Bell className="h-4 w-4" />
              <span>{isNativePlatform() ? t('ui.testNativeAlert') : t('ui.testPushAlert')}</span>
            </button>
          ) : notifPermission === 'denied' ? (
            <button
              type="button"
              onClick={() => void handleRequestNotif()}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs sm:text-sm font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
            >
              <Bell className="h-4 w-4" />
              <span>{t('ui.alertsOff')}</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setEditingReminder(null);
              setFormFocusAi(true);
              setFormOpen(true);
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs sm:text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors whitespace-nowrap"
          >
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            <span>{t('reminders.aiQuickSchedule')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingReminder(null);
              setFormFocusAi(false);
              setFormOpen(true);
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>{t('reminders.addReminder')}</span>
          </button>
        </div>
      </section>

      {notifPermission === 'unsupported' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <strong>On iPhone / iPad:</strong> Apple requires installing the app first. Tap <strong>Share → Add to Home Screen</strong>, then open LifeinOne from your Home Screen icon to enable lock-screen notifications.
        </div>
      )}

      {/* 4-Column Flat KPI Strip */}
      <section
        aria-label="Reminders summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl border border-[var(--border-hairline)] bg-[var(--border-hairline)] overflow-hidden"
      >
        <div className="bg-[var(--bg-surface)] p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('reminders.kpiDueToday')}</div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--accent)]">
            {summary.dueTodayCount}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            {summary.activeCount} active · {summary.completedCount} completed
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('reminders.kpiOverdue')}</div>
          <div
            className={`mt-2 font-numeric text-xl font-semibold ${
              summary.overdueCount > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-[var(--text-primary)]'
            }`}
          >
            {summary.overdueCount}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {summary.overdueCount > 0 ? 'Needs action or snooze' : 'All alerts on schedule'}
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('reminders.kpiRecurring')}</div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--text-primary)]">
            {summary.recurringActiveCount}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            RFC-5545 RRULE auto-advancing
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('reminders.kpiQueueSlots')}</div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--text-primary)]">
            {rollingQueue.slots.length} / {rollingQueue.cap}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            {rollingQueue.quietHoursShiftedCount} quiet-shifted · {rollingQueue.overflowCount} overflow
          </div>
        </div>
      </section>

      {/* Segmented View Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Reminders views"
          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]"
        >
          {(
            [
              { id: 'agenda', label: t('reminders.tabAgenda') },
              { id: 'queue', label: t('reminders.tabQueue') },
              { id: 'channels', label: t('reminders.tabChannels') },
              { id: 'workload', label: t('reminders.tabWorkload') },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={subTab === tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                subTab === tab.id
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-view Content */}
      {subTab === 'queue' ? (
        <RollingQueuePanel
          queue={rollingQueue}
          quietHours={quietHours}
          locale={profile.locale}
          notifPermission={notifPermission}
          onRequestPermission={handleRequestNotif}
          onSendTest={handleSendTest}
        />
      ) : subTab === 'channels' ? (
        <ChannelsDirectoryPanel
          channelCounts={rollingQueue.channelCounts}
          onFilterChannel={(cat) => {
            setCategoryFilter(cat);
            setStatusFilter('active');
            setSubTab('agenda');
          }}
        />
      ) : subTab === 'workload' ? (
        <WorkloadBalancePanel workload={sevenDayWorkload} />
      ) : (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('reminders.searchPlaceholder')}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] ps-10 pe-3.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <select
                aria-label="Filter by channel"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'all' | ReminderCategory)}
                className="min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="all">{t('reminders.allChannels')}</option>
                {REMINDER_CHANNELS.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {t(ch.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]">
              {(
                [
                  { id: 'active', label: t('reminders.filterActive') },
                  { id: 'today', label: t('reminders.filterToday') },
                  { id: 'overdue', label: t('reminders.filterOverdue') },
                  { id: 'completed', label: t('reminders.filterCompleted') },
                  { id: 'all', label: t('reminders.filterAll') },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStatusFilter(item.id)}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    statusFilter === item.id
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reminders Agenda List */}
          {loading ? (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="p-5 flex items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-48 rounded bg-[var(--bg-subtle)] animate-pulse" />
                    <div className="h-3 w-72 rounded bg-[var(--bg-subtle)] animate-pulse" />
                  </div>
                  <div className="h-8 w-24 rounded bg-[var(--bg-subtle)] animate-pulse" />
                </div>
              ))}
            </div>
          ) : filteredReminders.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-10 text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center anim-habit-pulse">
                <Bell className="h-6 w-6 anim-bell-swing" />
              </div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {reminders.length === 0 ? t('reminders.emptyTitle') : 'No reminders match your filters'}
              </h2>
              <p className="max-w-md mx-auto text-xs sm:text-sm text-[var(--text-secondary)]">
                {reminders.length === 0
                  ? t('reminders.emptyDesc')
                  : 'Try clearing the search query or switching status to All.'}
              </p>
              {reminders.length === 0 && (
                <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingReminder(null);
                      setFormFocusAi(false);
                      setFormOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{t('reminders.addReminder')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingReminder(null);
                      setFormFocusAi(true);
                      setFormOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                  >
                    <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                    <span>{t('reminders.aiQuickSchedule')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
              {filteredReminders.map((rem) => {
                const effDate = getEffectiveFireDate(rem);
                const isOverdue = !rem.isCompleted && effDate.getTime() < nowMs;
                const chMeta = getChannelMeta(rem.category);
                const inQuiet = !rem.isCompleted && isInQuietHours(effDate, quietHours);

                const isSwipingThis = swipeRow?.id === rem.id;
                const swipeDx = isSwipingThis ? swipeRow.dx : 0;

                return (
                  <div
                    key={rem.id}
                    onTouchStart={(e) => {
                      const t0 = e.touches[0];
                      if (!t0 || t0.clientX <= 36) return;
                      setSwipeRow({ id: rem.id, startX: t0.clientX, startY: t0.clientY, dx: 0 });
                    }}
                    onTouchMove={(e) => {
                      if (!isSwipingThis || !swipeRow) return;
                      const t0 = e.touches[0];
                      if (!t0) return;
                      const dx = t0.clientX - swipeRow.startX;
                      const dy = Math.abs(t0.clientY - swipeRow.startY);
                      if (dy > 28 && Math.abs(dx) < 20) {
                        setSwipeRow(null);
                        return;
                      }
                      if (Math.abs(dx) > 12) {
                        setSwipeRow({ ...swipeRow, dx: Math.max(-110, Math.min(110, dx)) });
                      }
                    }}
                    onTouchEnd={() => {
                      if (!isSwipingThis || !swipeRow) return;
                      const dx = swipeRow.dx;
                      setSwipeRow(null);
                      if (dx >= 72) {
                        void handleCompleteToggle(rem);
                      } else if (dx <= -72 && !rem.isCompleted) {
                        void handleQuickSnooze(rem, '1h');
                      }
                    }}
                    style={
                      swipeDx !== 0
                        ? { transform: `translateX(${swipeDx}px)`, transition: 'none' }
                        : { transition: 'transform 200ms ease-out' }
                    }
                    className={`px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-[var(--bg-subtle)]/40 transition-colors ${
                      swipeDx >= 50
                        ? 'bg-emerald-500/10'
                        : swipeDx <= -50 && !rem.isCompleted
                          ? 'bg-amber-500/10'
                          : ''
                    }`}
                  >
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      <button
                        type="button"
                        aria-label={rem.isCompleted ? 'Reopen reminder' : 'Complete reminder'}
                        onClick={() => void handleCompleteToggle(rem)}
                        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                          rem.isCompleted
                            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                            : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-transparent hover:border-[var(--accent)]'
                        }`}
                      >
                        {rem.isCompleted ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                      </button>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span
                            className={`text-sm font-semibold ${
                              rem.isCompleted
                                ? 'line-through text-[var(--text-muted)]'
                                : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {rem.title}
                          </span>
                          <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                          <span className="text-xs font-medium text-[var(--accent)]">
                            {t(chMeta.labelKey)}
                          </span>
                          {rem.priority !== 'normal' && (
                            <>
                              <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                              <span
                                className={`text-xs font-medium ${
                                  rem.priority === 'urgent'
                                    ? 'text-red-600 dark:text-red-400'
                                    : rem.priority === 'high'
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-[var(--text-muted)]'
                                }`}
                              >
                                {rem.priority}
                              </span>
                            </>
                          )}
                          {isOverdue && (
                            <>
                              <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                              <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                                {t('reminders.statusOverdue')}
                              </span>
                            </>
                          )}
                          {rem.status === 'snoozed' && !rem.isCompleted && (
                            <>
                              <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                {t('reminders.statusSnoozed')}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[var(--text-muted)]">
                          <span className="font-numeric">
                            {formatDueDisplay(effDate, profile.locale)}
                          </span>
                          {rem.rrule && (
                            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                              <Repeat className="h-3 w-3" />
                              <span>{describeRRule(rem.rrule)}</span>
                            </span>
                          )}
                          {inQuiet && (
                            <span className="text-amber-600 dark:text-amber-400">
                              · {rem.respectQuietHours ? `Quiet-shifted to ${quietHours.endHHMM}` : 'Bypasses quiet hours'}
                            </span>
                          )}
                          {rem.completedCount > 0 && (
                            <span className="font-numeric">
                              · {rem.completedCount}x done
                            </span>
                          )}
                          {rem.notes && (
                            <span className="truncate max-w-xs">· {rem.notes}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                      {!rem.isCompleted && (
                        <>
                          {snoozeOpenId === rem.id ? (
                            <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-1">
                              <button
                                type="button"
                                onClick={() => void handleQuickSnooze(rem, '15m')}
                                className="min-h-[30px] px-2 rounded-md text-xs font-numeric font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                              >
                                +15m
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleQuickSnooze(rem, '1h')}
                                className="min-h-[30px] px-2 rounded-md text-xs font-numeric font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                              >
                                +1h
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleQuickSnooze(rem, 'tomorrow9')}
                                className="min-h-[30px] px-2 rounded-md text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                              >
                                Tomorrow 09:00
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSnoozeOpenId(rem.id)}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                            >
                              <Clock className="h-3.5 w-3.5" />
                              <span>{t('reminders.snooze')}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            aria-label={t('reminders.editReminder')}
                            onClick={() => {
                              setEditingReminder(rem);
                              setFormFocusAi(false);
                              setFormOpen(true);
                            }}
                            className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        aria-label={t('reminders.deleteReminder')}
                        onClick={() => void handleDeleteWithUndo(rem)}
                        className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Reminder Modal */}
      <ReminderFormModal
        open={formOpen}
        editingReminder={editingReminder}
        initialFocusAi={formFocusAi}
        openDebts={openDebts}
        onClose={() => {
          setFormOpen(false);
          setEditingReminder(null);
        }}
        onCreate={async (input) => {
          await createReminder(input);
          showToast(`Scheduled "${input.title}".`);
        }}
        onUpdate={async (current, patch) => {
          await updateReminder(current, patch);
          showToast(`Updated "${patch.title ?? current.title}".`);
        }}
      />
    </div>
  );
};

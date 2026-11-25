import React, { useMemo } from 'react';
import { Bell, CheckCheck, Clock, Scale, Sparkles, X } from 'lucide-react';
import { computeEffectiveStatus } from '../core/debts/debtEngine';
import { getEffectiveFireDate } from '../core/reminders/notificationScheduler';
import { hapticLight } from '../core/native/mobileBridge';
import { useDebts } from '../hooks/useDebts';
import { useReminders } from '../hooks/useReminders';
import {
  useNotificationInboxStore,
  type InboxNotificationItem,
} from '../state/useNotificationInboxStore';
import { useUIStore } from '../state/useUIStore';
import { LottieBadge } from './LottieBadge';
import bellCalmAnim from '../assets/lottie/bell-calm.json';

function formatRelativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const diffMin = Math.round((Date.now() - ms) / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.round(diffHr / 24);
  return `${diffDays}d ago`;
}

export function useAllInboxNotifications(): {
  items: InboxNotificationItem[];
  unreadCount: number;
  readSet: Set<string>;
} {
  const { reminders } = useReminders();
  const { debts } = useDebts();
  const readIds = useNotificationInboxStore((s) => s.readIds);
  const customItems = useNotificationInboxStore((s) => s.customItems);

  return useMemo(() => {
    const now = Date.now();
    const list: InboxNotificationItem[] = [...customItems];

    for (const rem of reminders) {
      if (rem.isCompleted || rem.status === 'completed' || rem.status === 'archived') continue;
      const fireDate = getEffectiveFireDate(rem);
      if (fireDate.getTime() <= now) {
        list.push({
          id: `rem_${rem.id}_${fireDate.toISOString()}`,
          title: rem.title,
          body: `Reminder due (${rem.category})`,
          createdAtIso: fireDate.toISOString(),
          source: 'reminder',
          route: 'reminders',
        });
      }
    }

    for (const d of debts) {
      if (computeEffectiveStatus(d) === 'overdue' && d.dueDate) {
        list.push({
          id: `debt_${d.id}_${d.dueDate}`,
          title: `Overdue: ${d.personName}`,
          body: d.direction === 'owed_to_me' ? 'Payment expected' : 'Payment due',
          createdAtIso: `${d.dueDate}T09:00:00`,
          source: 'debt',
          route: 'debts',
        });
      }
    }

    list.sort((a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso));
    const readSet = new Set(readIds);
    const unreadCount = list.filter((item) => !readSet.has(item.id)).length;

    return { items: list, unreadCount, readSet };
  }, [reminders, debts, readIds, customItems]);
}

export const NotificationCenterModal: React.FC = () => {
  const open = useNotificationInboxStore((s) => s.open);
  const setOpen = useNotificationInboxStore((s) => s.setOpen);
  const markRead = useNotificationInboxStore((s) => s.markRead);
  const markAllRead = useNotificationInboxStore((s) => s.markAllRead);
  const setActiveRoute = useUIStore((s) => s.setActiveRoute);

  const { items, unreadCount, readSet } = useAllInboxNotifications();

  if (!open) return null;

  const handleTapItem = (item: InboxNotificationItem) => {
    void hapticLight();
    markRead(item.id);
    setOpen(false);
    setActiveRoute(item.route);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 sm:backdrop-blur-xs p-0 sm:p-4 overflow-hidden anim-modal-backdrop"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-md rounded-none sm:rounded-2xl pt-safe sm:pt-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-hidden sm:max-h-[85dvh] flex flex-col anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Notifications</h2>
            {unreadCount > 0 && (
              <span className="font-numeric inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  void hapticLight();
                  markAllRead(items.map((i) => i.id));
                }}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-hairline)] pb-safe">
          {items.length === 0 ? (
            <div className="px-6 py-16 text-center space-y-2">
              <div className="mx-auto flex items-center justify-center">
                <LottieBadge
                  animationData={bellCalmAnim}
                  size={64}
                  loop
                  fallback={
                    <div className="h-11 w-11 rounded-2xl bg-[var(--bg-subtle)] flex items-center justify-center text-[var(--text-muted)]">
                      <Bell className="h-5 w-5" />
                    </div>
                  }
                />
              </div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">All caught up</p>
              <p className="text-xs text-[var(--text-muted)]">
                Missed reminders, overdue alerts, and app announcements will appear here.
              </p>
            </div>
          ) : (
            items.map((item) => {
              const isUnread = !readSet.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleTapItem(item)}
                  className={`w-full text-start px-5 py-3.5 flex items-start gap-3 transition-colors hover:bg-[var(--bg-subtle)] ${
                    isUnread ? 'bg-[var(--accent-soft)]/45' : ''
                  }`}
                >
                  <div
                    className={`mt-0.5 h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${
                      item.source === 'debt'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : item.source === 'system'
                          ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {item.source === 'debt' ? (
                      <Scale className="h-4 w-4" />
                    ) : item.source === 'system' ? (
                      <Sparkles className="h-4 w-4" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {item.title}
                      </span>
                      <span className="font-numeric text-[11px] text-[var(--text-muted)] shrink-0">
                        {formatRelativeTime(item.createdAtIso)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)] truncate">{item.body}</p>
                  </div>
                  {isUnread && (
                    <span
                      aria-label="Unread"
                      className="mt-2 h-2 w-2 rounded-full bg-[var(--accent)] shrink-0"
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

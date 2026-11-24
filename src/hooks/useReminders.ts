import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  analyzeSevenDayWorkload,
  buildRollingNotificationQueue,
  getEffectiveFireDate,
  type DailyWorkloadSummary,
  type RollingSchedulerSnapshot,
} from '../core/reminders/notificationScheduler';
import {
  playNotificationChime,
  syncRollingQueueToBackgroundAlerts,
  triggerBackgroundTestAlert,
} from '../core/reminders/pushNotificationsBridge';
import type { CreateReminderInput, ReminderItem } from '../core/reminders/reminderSchemas';
import {
  firebaseRemindersRepository,
  localRemindersRepository,
} from '../data/repositories/remindersRepository';
import { useUIStore } from '../state/useUIStore';
import { useDebts } from './useDebts';

export type BrowserNotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

function getNotificationPermissionState(): BrowserNotificationState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as BrowserNotificationState;
}

export function useReminders() {
  const authUser = useUIStore((s) => s.authUser);
  const profile = useUIStore((s) => s.profile);
  const { debts } = useDebts();

  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifPermission, setNotifPermission] = useState<BrowserNotificationState>(
    getNotificationPermissionState
  );
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const repo = authUser ? firebaseRemindersRepository : localRemindersRepository;
  const uid = authUser?.uid ?? 'local_offline_user';

  useEffect(() => {
    setLoading(true);
    const unsub = repo.subscribeReminders(
      uid,
      (list) => {
        setReminders(list);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [repo, uid]);

  // Refresh clock tick every 60s so overdue/today badges and foreground alerts stay fresh
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const quietHours = useMemo(
    () => ({
      startHHMM: profile.quietHoursStart || '22:00',
      endHHMM: profile.quietHoursEnd || '07:00',
    }),
    [profile.quietHoursStart, profile.quietHoursEnd]
  );

  const rollingQueue: RollingSchedulerSnapshot = useMemo(
    () =>
      buildRollingNotificationQueue({
        reminders,
        quietHours,
        now: new Date(nowTick),
        horizonDays: 30,
        openDebts: debts,
      }),
    [reminders, quietHours, nowTick, debts]
  );

  const sevenDayWorkload: DailyWorkloadSummary[] = useMemo(
    () => analyzeSevenDayWorkload(rollingQueue, new Date(nowTick)),
    [rollingQueue, nowTick]
  );

  const summary = useMemo(() => {
    const now = new Date(nowTick);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 24 * 60 * 60 * 1000 - 1;

    let dueTodayCount = 0;
    let overdueCount = 0;
    let recurringActiveCount = 0;
    let completedCount = 0;

    for (const r of reminders) {
      if (r.isCompleted || r.status === 'completed' || r.status === 'archived') {
        completedCount += 1;
        continue;
      }
      if (r.rrule) recurringActiveCount += 1;
      const fireMs = getEffectiveFireDate(r).getTime();
      if (fireMs < now.getTime()) {
        overdueCount += 1;
      }
      if (fireMs >= startOfToday && fireMs <= endOfToday) {
        dueTodayCount += 1;
      }
    }

    return {
      dueTodayCount,
      overdueCount,
      recurringActiveCount,
      completedCount,
      activeCount: reminders.length - completedCount,
    };
  }, [reminders, nowTick]);

  // Automatically sync upcoming 64-slot queue to Web Push / Native LocalNotifications when granted
  useEffect(() => {
    if (notifPermission === 'granted') {
      void syncRollingQueueToBackgroundAlerts(rollingQueue.slots);
    }
  }, [notifPermission, rollingQueue.slots]);

  // Play chime when a background Web Push arrives while app is open
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | undefined)?.type === 'LIFEOS_PLAY_CHIME') {
        playNotificationChime();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const requestBrowserNotifications = useCallback(async (): Promise<BrowserNotificationState> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifPermission('unsupported');
      return 'unsupported';
    }
    try {
      const result = await Notification.requestPermission();
      const next = result as BrowserNotificationState;
      setNotifPermission(next);
      if (next === 'granted') {
        void syncRollingQueueToBackgroundAlerts(rollingQueue.slots);
      }
      return next;
    } catch {
      return getNotificationPermissionState();
    }
  }, [rollingQueue.slots]);

  const sendTestNotification = useCallback((): boolean => {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    void triggerBackgroundTestAlert(rollingQueue.slots.length);
    return true;
  }, [rollingQueue.slots.length]);

  const createReminder = useCallback(
    (input: CreateReminderInput) => repo.createReminder(uid, input),
    [repo, uid]
  );

  const updateReminder = useCallback(
    (
      current: ReminderItem,
      patch: Partial<
        Pick<
          ReminderItem,
          | 'title'
          | 'notes'
          | 'category'
          | 'priority'
          | 'dueAtIso'
          | 'rrule'
          | 'respectQuietHours'
          | 'linkedDebtId'
        >
      >
    ) => repo.updateReminder(uid, current, patch),
    [repo, uid]
  );

  const completeReminder = useCallback(
    (current: ReminderItem) => repo.completeReminder(uid, current),
    [repo, uid]
  );

  const reopenReminder = useCallback(
    (current: ReminderItem) => repo.reopenReminder(uid, current),
    [repo, uid]
  );

  const snoozeReminder = useCallback(
    (current: ReminderItem, snoozedUntilIso: string) =>
      repo.snoozeReminder(uid, current, snoozedUntilIso),
    [repo, uid]
  );

  const deleteReminder = useCallback(
    (reminder: ReminderItem) => repo.deleteReminder(uid, reminder),
    [repo, uid]
  );

  const restoreReminder = useCallback(
    (reminder: ReminderItem) => repo.restoreReminder(uid, reminder),
    [repo, uid]
  );

  return {
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
    isCloudSynced: Boolean(authUser),
  };
}

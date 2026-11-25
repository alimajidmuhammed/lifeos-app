import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type ScheduleOptions } from '@capacitor/local-notifications';
import type { ScheduledNotificationSlot } from './notificationScheduler';

export const isNativePlatform = (): boolean => {
  return Capacitor.isNativePlatform();
};

export const getNativePlatformName = (): 'ios' | 'android' | 'web' => {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
};

/**
 * Request notification permissions natively or check status.
 */
export async function checkOrRequestNativeNotificationPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (!isNativePlatform()) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission as 'granted' | 'denied' | 'default';
    }
    return 'default';
  }

  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') {
      return 'granted';
    }
    if (status.display === 'denied') {
      return 'denied';
    }
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted' ? 'granted' : requested.display === 'denied' ? 'denied' : 'default';
  } catch (err) {
    console.error('Error requesting native notification permissions:', err);
    return 'default';
  }
}

/**
 * Sets up Android notification channels for sound, importance, and vibration
 */
export async function initializeNotificationChannels(): Promise<void> {
  if (!isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

  try {
    await LocalNotifications.createChannel({
      id: 'lifeos_reminders_channel',
      name: 'LifeOS Reminders',
      description: 'Primary alerts for scheduled tasks and life reminders',
      importance: 5, // High importance (heads-up notification + sound)
      visibility: 1, // Public on lockscreen
      sound: 'beep.wav',
      vibration: true,
      lights: true,
      lightColor: '#059669',
    });
  } catch (err) {
    console.warn('Unable to create native notification channel:', err);
  }
}

/**
 * Schedule native device local notifications. Works 100% offline and when app is closed.
 */
export async function scheduleNativeLocalNotifications(
  slots: ScheduledNotificationSlot[]
): Promise<number> {
  if (!isNativePlatform()) return 0;

  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return 0;

    // Ensure channels exist on Android
    await initializeNotificationChannels();

    // Clear existing pending notifications to avoid duplicates
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }

    const futureSlots = slots
      .filter((s) => Date.parse(s.scheduledFireAtIso) > Date.now())
      .slice(0, 64);

    if (futureSlots.length === 0) return 0;

    const notifs = futureSlots.map((s, idx) => ({
      id: idx + 1001,
      title: s.title,
      body: s.source === 'debt_due' ? `Payment / debt due: ${s.title}` : `Scheduled reminder (${s.category})`,
      channelId: 'lifeos_reminders_channel',
      schedule: {
        at: new Date(s.scheduledFireAtIso),
        allowWhileIdle: true, // Exact alarm on modern Android battery doze
      },
      extra: {
        reminderId: s.reminderId,
        source: s.source,
      },
    }));

    await LocalNotifications.schedule({ notifications: notifs });
    return notifs.length;
  } catch (err) {
    console.error('Failed to schedule native local notifications:', err);
    return 0;
  }
}

/**
 * Send an immediate test native notification
 */
export async function sendNativeTestNotification(slotCount: number): Promise<boolean> {
  if (!isNativePlatform()) return false;

  try {
    const perm = await checkOrRequestNativeNotificationPermission();
    if (perm !== 'granted') return false;

    await initializeNotificationChannels();

    await LocalNotifications.schedule({
      notifications: [
        {
          id: 9999,
          title: 'LifeOS Native Alert',
          body: `Native device notification active (${slotCount}/64 slots queued).`,
          channelId: 'lifeos_reminders_channel',
          schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
        },
      ],
    });
    return true;
  } catch (err) {
    console.error('Failed to send native test notification:', err);
    return false;
  }
}

/**
 * Listens for user tapping a scheduled local notification and routes to the relevant module.
 */
export function registerNotificationTapListener(
  onNavigate: (route: 'reminders' | 'debts') => void
): () => void {
  if (!isNativePlatform()) return () => {};

  let handle: { remove: () => Promise<void> } | null = null;
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const extra = action.notification?.extra as { source?: string } | undefined;
    if (extra?.source === 'debt_due') {
      onNavigate('debts');
    } else {
      onNavigate('reminders');
    }
  }).then((h) => {
    handle = h;
  });

  return () => {
    void handle?.remove();
  };
}

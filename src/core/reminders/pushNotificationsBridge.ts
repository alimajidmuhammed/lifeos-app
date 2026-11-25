import {
  isNativePlatform,
  scheduleNativeLocalNotifications,
  sendNativeTestNotification,
} from './nativeNotifications';
import type { ScheduledNotificationSlot } from './notificationScheduler';

interface CapacitorLocalNotifPlugin {
  requestPermissions?: () => Promise<{ display: string }>;
  getPending?: () => Promise<{ notifications: Array<{ id: number }> }>;
  cancel?: (opts: { notifications: Array<{ id: number }> }) => Promise<void>;
  schedule: (opts: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule: { at: Date; allowWhileIdle?: boolean };
      extra?: Record<string, unknown>;
    }>;
  }) => Promise<void>;
}

interface CapacitorWindow extends Window {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      LocalNotifications?: CapacitorLocalNotifPlugin;
    };
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function playNotificationChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };

    playTone(587.33, now, 0.22);       // D5
    playTone(880.0, now + 0.14, 0.35); // A5
    window.setTimeout(() => { void ctx.close(); }, 700);
  } catch {
    // Ignore audio context block before user gesture
  }
}

export function isNativeCapacitorApp(): boolean {
  return isNativePlatform();
}

async function getOrCreateWebPushSubscription(): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }
  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }
    await navigator.serviceWorker.ready;

    const resp = await fetch('/api/push/vapid-public-key');
    if (!resp.ok) return null;
    const { publicKey } = (await resp.json()) as { publicKey?: string };
    if (!publicKey) return null;

    const targetKey = urlBase64ToUint8Array(publicKey);
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      // If Render redeployed with new ephemeral VAPID keys, re-subscribe cleanly
      const existingKey = existing.options?.applicationServerKey
        ? new Uint8Array(existing.options.applicationServerKey)
        : null;
      const keysMatch =
        existingKey &&
        existingKey.length === targetKey.length &&
        existingKey.every((b, i) => b === targetKey[i]);
      if (keysMatch) return existing;
      await existing.unsubscribe().catch(() => {});
    }

    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: targetKey,
    });
  } catch {
    return null;
  }
}

/**
 * Syncs the 64-slot Rolling Notification Queue to either:
 * 1) Native Capacitor LocalNotifications (100% offline Android/iOS alarms)
 * 2) Web Push server scheduler (background notifications when browser/PWA is closed)
 */
export async function syncRollingQueueToBackgroundAlerts(
  slots: ScheduledNotificationSlot[]
): Promise<{ mode: 'native' | 'web_push' | 'foreground_only'; count: number }> {
  // Layer 1: Native Android/iOS via Capacitor LocalNotifications plugin
  if (isNativePlatform()) {
    const scheduledCount = await scheduleNativeLocalNotifications(slots);
    if (scheduledCount > 0) {
      return { mode: 'native', count: scheduledCount };
    }
  }

  // Layer 2: Web Push via Service Worker + Node scheduler
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const sub = await getOrCreateWebPushSubscription();
    if (sub) {
      try {
        const futureSlots = slots
          .filter((s) => Date.parse(s.scheduledFireAtIso) > Date.now() - 60_000)
          .slice(0, 64)
          .map((s) => ({
            slotKey: `${s.reminderId}_${s.scheduledFireAtIso}`,
            title: s.title,
            body: `Reminder (${s.category})`,
            fireAtIso: s.scheduledFireAtIso,
          }));
        const resp = await fetch('/api/push/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON(), slots: futureSlots }),
        });
        if (resp.ok) {
          return { mode: 'web_push', count: futureSlots.length };
        }
      } catch {
        // Offline or server unreachable
      }
    }
  }

  return { mode: 'foreground_only', count: 0 };
}

export async function triggerBackgroundTestAlert(slotCount: number): Promise<boolean> {
  playNotificationChime();
  if (isNativePlatform()) {
    const success = await sendNativeTestNotification(slotCount);
    if (success) return true;
  }

  // Try real Web Push through Service Worker first
  const sub = await getOrCreateWebPushSubscription();
  if (sub) {
    try {
      const resp = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (resp.ok) return true;
    } catch {
      // Fall back to local SW notification
    }
  }

  // Fallback to ServiceWorkerRegistration.showNotification (works on Android Chrome even if push server is offline)
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('LifeOS Smart Reminders', {
        body: `Alerts active. Rolling queue has ${slotCount}/64 slots scheduled.`,
        icon: '/pwa-192x192.png',
      });
      return true;
    } catch {
      // Fall through
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('LifeOS Smart Reminders', {
      body: `Alerts active. Rolling queue has ${slotCount}/64 slots scheduled.`,
      icon: '/pwa-192x192.png',
    });
    return true;
  }

  return false;
}

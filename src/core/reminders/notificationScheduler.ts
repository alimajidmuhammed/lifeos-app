import type { DebtRecord } from '../debts/debtSchemas';
import { computeEffectiveStatus } from '../debts/debtEngine';
import {
  getChannelMeta,
  type ReminderCategory,
  type ReminderItem,
  type ReminderPriority,
} from './reminderSchemas';
import { expandReminderOccurrences } from './rruleEngine';

export const IOS_LOCAL_NOTIFICATION_CAP = 64;

export interface QuietHoursConfig {
  startHHMM: string; // e.g. '22:00'
  endHHMM: string;   // e.g. '07:00'
}

export interface ScheduledNotificationSlot {
  slotIndex: number; // 1..64
  reminderId: string;
  source: 'reminder' | 'debt_due';
  title: string;
  category: ReminderCategory;
  channelId: string;
  priority: ReminderPriority;
  originalFireAtIso: string;
  scheduledFireAtIso: string;
  shiftedByQuietHours: boolean;
  bypassedQuietHours: boolean;
}

export interface RollingSchedulerSnapshot {
  cap: number;
  slots: ScheduledNotificationSlot[];
  totalCandidatesInHorizon: number;
  overflowCount: number;
  quietHoursShiftedCount: number;
  channelCounts: Record<ReminderCategory, number>;
  horizonDays: number;
  generatedAtIso: string;
}

export interface DailyWorkloadSummary {
  dateYmd: string;
  label: string;
  count: number;
  highPriorityCount: number;
  isOverloaded: boolean;
  clusteredHour: number | null;
}

const PRIORITY_WEIGHT: Record<ReminderPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function parseHHMMToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Checks whether a local Date falls inside Quiet Hours.
 * Handles both overnight ranges (22:00 -> 07:00) and same-day ranges (13:00 -> 15:00).
 */
export function isInQuietHours(date: Date, quiet: QuietHoursConfig): boolean {
  const startMin = parseHHMMToMinutes(quiet.startHHMM);
  const endMin = parseHHMMToMinutes(quiet.endHHMM);
  if (startMin === null || endMin === null || startMin === endMin) return false;

  const curMin = date.getHours() * 60 + date.getMinutes();
  if (startMin > endMin) {
    // Overnight quiet hours (e.g. 22:00 to 07:00)
    return curMin >= startMin || curMin < endMin;
  }
  // Daytime quiet hours (e.g. 13:00 to 15:00)
  return curMin >= startMin && curMin < endMin;
}

/**
 * Deterministically shifts a Date that falls inside Quiet Hours to the exact end of Quiet Hours.
 * Leaves dates outside Quiet Hours untouched.
 */
export function shiftPastQuietHours(date: Date, quiet: QuietHoursConfig): { date: Date; shifted: boolean } {
  if (!isInQuietHours(date, quiet)) {
    return { date, shifted: false };
  }
  const startMin = parseHHMMToMinutes(quiet.startHHMM)!;
  const endMin = parseHHMMToMinutes(quiet.endHHMM)!;
  const endHour = Math.floor(endMin / 60);
  const endMinute = endMin % 60;
  const curMin = date.getHours() * 60 + date.getMinutes();

  const shifted = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    endHour,
    endMinute,
    0,
    0
  );

  // If overnight range and currently at/after start (evening), advance to next calendar day
  if (startMin > endMin && curMin >= startMin) {
    shifted.setDate(shifted.getDate() + 1);
  }

  return { date: shifted, shifted: true };
}

/**
 * Rolling 64-Notification Scheduler (Expo-portable core).
 *
 * iOS enforces a hard OS limit of 64 pending local notifications per app (`UNUserNotificationCenter`).
 * This deterministic scheduler expands recurring & one-time reminders over a rolling horizon
 * (default 30 days), applies Quiet Hours deferral (unless bypassed for urgent/medicine),
 * merges upcoming open Debt due dates, sorts chronologically with priority tie-breaking,
 * and caps the queue strictly at 64 slots.
 */
export function buildRollingNotificationQueue(params: {
  reminders: ReminderItem[];
  quietHours: QuietHoursConfig;
  now?: Date;
  horizonDays?: number;
  cap?: number;
  openDebts?: DebtRecord[];
}): RollingSchedulerSnapshot {
  const now = params.now ?? new Date();
  const horizonDays = params.horizonDays ?? 30;
  const cap = Math.max(1, Math.min(IOS_LOCAL_NOTIFICATION_CAP, params.cap ?? IOS_LOCAL_NOTIFICATION_CAP));
  const windowEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const candidates: Array<Omit<ScheduledNotificationSlot, 'slotIndex'>> = [];

  for (const rem of params.reminders) {
    if (rem.status === 'completed' || rem.status === 'archived') continue;
    const channel = getChannelMeta(rem.category);
    const occurrences = expandReminderOccurrences(rem, now, windowEnd, cap);
    for (const occ of occurrences) {
      const inQuiet = isInQuietHours(occ, params.quietHours);
      let finalDate = occ;
      let shifted = false;
      let bypassed = false;

      if (inQuiet) {
        if (rem.respectQuietHours) {
          const res = shiftPastQuietHours(occ, params.quietHours);
          finalDate = res.date;
          shifted = res.shifted;
        } else {
          bypassed = true;
        }
      }

      if (finalDate.getTime() >= now.getTime() && finalDate.getTime() <= windowEnd.getTime()) {
        candidates.push({
          reminderId: rem.id,
          source: 'reminder',
          title: rem.title,
          category: rem.category,
          channelId: channel.channelId,
          priority: rem.priority,
          originalFireAtIso: occ.toISOString(),
          scheduledFireAtIso: finalDate.toISOString(),
          shiftedByQuietHours: shifted,
          bypassedQuietHours: bypassed,
        });
      }
    }
  }

  // Synthesize automatic 09:00 local due-date alerts for open debts that aren't already explicitly linked
  if (params.openDebts && params.openDebts.length > 0) {
    const linkedDebtIds = new Set(
      params.reminders
        .filter((r) => r.status !== 'completed' && r.status !== 'archived' && r.linkedDebtId)
        .map((r) => r.linkedDebtId as string)
    );
    const todayYmd = now.toISOString().slice(0, 10);
    const debtChannel = getChannelMeta('debt');

    for (const debt of params.openDebts) {
      if (!debt.dueDate || linkedDebtIds.has(debt.id)) continue;
      if (computeEffectiveStatus(debt, todayYmd) === 'settled') continue;
      const [y, m, d] = debt.dueDate.split('-').map(Number);
      const fireDate = new Date(y, m - 1, d, 9, 0, 0, 0);
      if (fireDate.getTime() >= now.getTime() && fireDate.getTime() <= windowEnd.getTime()) {
        const res = shiftPastQuietHours(fireDate, params.quietHours);
        candidates.push({
          reminderId: `debt_alert_${debt.id}`,
          source: 'debt_due',
          title:
            debt.direction === 'owed_to_me'
              ? `Debt due from ${debt.personName}`
              : `Debt payment due to ${debt.personName}`,
          category: 'debt',
          channelId: debtChannel.channelId,
          priority: 'high',
          originalFireAtIso: fireDate.toISOString(),
          scheduledFireAtIso: res.date.toISOString(),
          shiftedByQuietHours: res.shifted,
          bypassedQuietHours: false,
        });
      }
    }
  }

  // Sort chronologically, breaking identical-timestamp ties by priority desc then title asc
  candidates.sort((a, b) => {
    const diff = new Date(a.scheduledFireAtIso).getTime() - new Date(b.scheduledFireAtIso).getTime();
    if (diff !== 0) return diff;
    const pDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (pDiff !== 0) return pDiff;
    return a.title.localeCompare(b.title);
  });

  const sliced = candidates.slice(0, cap).map((item, idx) => ({
    ...item,
    slotIndex: idx + 1,
  }));

  const channelCounts: Record<ReminderCategory, number> = {
    routine: 0,
    birthday: 0,
    debt: 0,
    task: 0,
    medicine: 0,
    bill: 0,
    expiry: 0,
    custom: 0,
  };

  let quietHoursShiftedCount = 0;
  for (const s of sliced) {
    channelCounts[s.category] += 1;
    if (s.shiftedByQuietHours) quietHoursShiftedCount += 1;
  }

  return {
    cap,
    slots: sliced,
    totalCandidatesInHorizon: candidates.length,
    overflowCount: Math.max(0, candidates.length - sliced.length),
    quietHoursShiftedCount,
    channelCounts,
    horizonDays,
    generatedAtIso: now.toISOString(),
  };
}

export function getEffectiveFireDate(reminder: ReminderItem): Date {
  if (reminder.status === 'snoozed' && reminder.snoozedUntilIso) {
    const sn = new Date(reminder.snoozedUntilIso);
    if (!Number.isNaN(sn.getTime())) return sn;
  }
  return new Date(reminder.dueAtIso);
}

/**
 * Deterministic 7-day workload & overload detector.
 * Flags days with >= 5 scheduled alerts or >= 3 alerts clustered in the same clock hour.
 */
export function analyzeSevenDayWorkload(
  queue: RollingSchedulerSnapshot,
  now: Date = new Date()
): DailyWorkloadSummary[] {
  const days: DailyWorkloadSummary[] = [];
  const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daySlots = queue.slots.filter((s) => {
      const sd = new Date(s.scheduledFireAtIso);
      return (
        sd.getFullYear() === d.getFullYear() &&
        sd.getMonth() === d.getMonth() &&
        sd.getDate() === d.getDate()
      );
    });

    const hourBuckets = new Map<number, number>();
    let highPriorityCount = 0;
    for (const slot of daySlots) {
      if (slot.priority === 'high' || slot.priority === 'urgent') highPriorityCount += 1;
      const h = new Date(slot.scheduledFireAtIso).getHours();
      hourBuckets.set(h, (hourBuckets.get(h) ?? 0) + 1);
    }

    let clusteredHour: number | null = null;
    for (const [h, cnt] of hourBuckets.entries()) {
      if (cnt >= 3) {
        clusteredHour = h;
        break;
      }
    }

    days.push({
      dateYmd: ymd,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayFmt.format(d),
      count: daySlots.length,
      highPriorityCount,
      isOverloaded: daySlots.length >= 5 || clusteredHour !== null,
      clusteredHour,
    });
  }

  return days;
}

import { z } from 'zod';

export const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
export const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ReminderCategorySchema = z.enum([
  'routine',
  'birthday',
  'debt',
  'task',
  'medicine',
  'bill',
  'expiry',
  'custom',
]);
export type ReminderCategory = z.infer<typeof ReminderCategorySchema>;

export const ReminderPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type ReminderPriority = z.infer<typeof ReminderPrioritySchema>;

export const ReminderStatusSchema = z.enum(['scheduled', 'snoozed', 'completed', 'archived']);
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;

export interface ReminderChannelMeta {
  id: ReminderCategory;
  channelId: string;
  labelKey: string;
  defaultPriority: ReminderPriority;
  defaultRespectQuietHours: boolean;
  description: string;
}

/**
 * 8 dedicated notification channels (maps 1:1 to Android Notification Channels
 * and iOS Notification Categories in Expo EAS builds).
 */
export const REMINDER_CHANNELS: readonly ReminderChannelMeta[] = [
  {
    id: 'routine',
    channelId: 'lifeos_routine',
    labelKey: 'reminders.catRoutine',
    defaultPriority: 'normal',
    defaultRespectQuietHours: true,
    description: 'Daily habits, morning/evening check-ins, and recurring rituals.',
  },
  {
    id: 'medicine',
    channelId: 'lifeos_medicine',
    labelKey: 'reminders.catMedicine',
    defaultPriority: 'urgent',
    defaultRespectQuietHours: false,
    description: 'Time-critical medication doses. Bypasses quiet hours by default.',
  },
  {
    id: 'debt',
    channelId: 'lifeos_debt',
    labelKey: 'reminders.catDebt',
    defaultPriority: 'high',
    defaultRespectQuietHours: true,
    description: 'Payment due dates, installment check-ins, and borrower follow-ups.',
  },
  {
    id: 'bill',
    channelId: 'lifeos_bill',
    labelKey: 'reminders.catBill',
    defaultPriority: 'high',
    defaultRespectQuietHours: true,
    description: 'Utilities, rent, subscriptions, and recurring monthly invoices.',
  },
  {
    id: 'expiry',
    channelId: 'lifeos_expiry',
    labelKey: 'reminders.catExpiry',
    defaultPriority: 'high',
    defaultRespectQuietHours: true,
    description: 'Passports, IDs, insurance policies, and contract renewals.',
  },
  {
    id: 'birthday',
    channelId: 'lifeos_birthday',
    labelKey: 'reminders.catBirthday',
    defaultPriority: 'normal',
    defaultRespectQuietHours: true,
    description: 'Birthdays, anniversaries, and family milestones.',
  },
  {
    id: 'task',
    channelId: 'lifeos_task',
    labelKey: 'reminders.catTask',
    defaultPriority: 'normal',
    defaultRespectQuietHours: true,
    description: 'Action items, errands, and deadline reminders.',
  },
  {
    id: 'custom',
    channelId: 'lifeos_custom',
    labelKey: 'reminders.catCustom',
    defaultPriority: 'normal',
    defaultRespectQuietHours: true,
    description: 'Flexible personal alerts and one-off reminders.',
  },
] as const;

export function getChannelMeta(category: ReminderCategory): ReminderChannelMeta {
  return REMINDER_CHANNELS.find((c) => c.id === category) ?? REMINDER_CHANNELS[7];
}

export const ReminderItemSchema = z
  .object({
    id: z.string().min(1).max(128).regex(ID_REGEX),
    uid: z.string().min(1).max(128).regex(ID_REGEX),
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(1000).optional(),
    category: ReminderCategorySchema,
    priority: ReminderPrioritySchema,
    dueAtIso: z.string().max(30).regex(ISO_UTC_REGEX),
    rrule: z.string().trim().max(200).optional(),
    snoozedUntilIso: z.string().max(30).regex(ISO_UTC_REGEX).optional(),
    respectQuietHours: z.boolean(),
    status: ReminderStatusSchema,
    isCompleted: z.boolean(),
    completedCount: z.number().int().min(0).max(100000),
    lastCompletedAtIso: z.string().max(30).regex(ISO_UTC_REGEX).optional(),
    linkedDebtId: z.string().min(1).max(128).regex(ID_REGEX).optional(),
    version: z.number().int().min(1),
    createdAtIso: z.string().optional(),
    updatedAtIso: z.string().optional(),
  })
  .refine((d) => (d.status === 'completed' ? d.isCompleted === true : d.isCompleted === false), {
    message: 'status and isCompleted must stay synchronized.',
  });

export type ReminderItem = z.infer<typeof ReminderItemSchema>;

export const CreateReminderInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  notes: z.string().trim().max(1000).optional(),
  category: ReminderCategorySchema.default('custom'),
  priority: ReminderPrioritySchema.default('normal'),
  dueAtIso: z.string().max(30).regex(ISO_UTC_REGEX),
  rrule: z.string().trim().max(200).optional(),
  respectQuietHours: z.boolean().default(false),
  linkedDebtId: z.string().min(1).max(128).regex(ID_REGEX).optional(),
});

export type CreateReminderInput = z.infer<typeof CreateReminderInputSchema>;

export function generateReminderId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `rem_${ts}_${rand}`;
}

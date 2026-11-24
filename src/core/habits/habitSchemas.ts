import { z } from 'zod';

export const HABIT_CATEGORIES = [
  'health',
  'mindfulness',
  'learning',
  'finance',
  'fitness',
  'productivity',
  'custom',
] as const;

export type HabitCategory = (typeof HABIT_CATEGORIES)[number];

export const HABIT_CATEGORY_META: Record<HabitCategory, { labelKey: string; fallbackLabel: string }> = {
  health: { labelKey: 'habits.catHealth', fallbackLabel: 'Health' },
  mindfulness: { labelKey: 'habits.catMindfulness', fallbackLabel: 'Mindfulness' },
  learning: { labelKey: 'habits.catLearning', fallbackLabel: 'Learning' },
  finance: { labelKey: 'habits.catFinance', fallbackLabel: 'Finance' },
  fitness: { labelKey: 'habits.catFitness', fallbackLabel: 'Fitness' },
  productivity: { labelKey: 'habits.catProductivity', fallbackLabel: 'Productivity' },
  custom: { labelKey: 'habits.catCustom', fallbackLabel: 'Custom' },
};

export const HabitFrequencySchema = z.enum(['daily', 'weekly']);
export type HabitFrequency = z.infer<typeof HabitFrequencySchema>;

const dateYmdRegex = /^\d{4}-\d{2}-\d{2}$/;
const monthKeyRegex = /^\d{4}-\d{2}$/;
const timeHHMMRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const HabitItemSchema = z.object({
  id: z.string().min(1).max(128),
  uid: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  category: z.enum(HABIT_CATEGORIES),
  frequency: HabitFrequencySchema,
  targetPerWeek: z.number().int().min(1).max(7),
  reminderTime: z.string().regex(timeHHMMRegex).optional(),
  currentStreak: z.number().int().min(0).max(100000),
  bestStreak: z.number().int().min(0).max(100000),
  totalCompletions: z.number().int().min(0).max(1000000),
  lastCompletedDate: z.string().regex(dateYmdRegex).optional(),
  archived: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type HabitItem = z.infer<typeof HabitItemSchema>;

export const CreateHabitInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(HABIT_CATEGORIES).default('health'),
  frequency: HabitFrequencySchema.default('daily'),
  targetPerWeek: z.number().int().min(1).max(7).default(7),
  reminderTime: z.string().regex(timeHHMMRegex).optional(),
});

export type CreateHabitInput = z.infer<typeof CreateHabitInputSchema>;

export const HabitMonthLogSchema = z.object({
  id: z.string().min(1).max(128),
  uid: z.string().min(1).max(128),
  habitId: z.string().min(1).max(128),
  monthKey: z.string().regex(monthKeyRegex),
  days: z.array(z.string().regex(dateYmdRegex)).max(31),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type HabitMonthLog = z.infer<typeof HabitMonthLogSchema>;

export function getHabitMonthBucketId(habitId: string, monthKey: string): string {
  const safeMonth = monthKey.replace('-', '_');
  return `${habitId}_${safeMonth}`.slice(0, 128);
}

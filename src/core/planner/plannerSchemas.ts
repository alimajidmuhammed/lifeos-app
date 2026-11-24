import { z } from 'zod';

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const SubtaskItemSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1).max(200),
  done: z.boolean(),
});
export type SubtaskItem = z.infer<typeof SubtaskItemSchema>;

export const TaskItemSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  uid: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  listId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).optional(),
  priority: z.number().int().min(1).max(4),
  sortKey: z.string().min(1).max(64).regex(/^[0-9A-Za-z]+$/),
  status: TaskStatusSchema,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  subtasks: z.array(SubtaskItemSchema).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  completedAtIso: z.string().min(20).max(30).optional(),
  version: z.number().int().min(1),
  createdAtIso: z.string().optional(),
  updatedAtIso: z.string().optional(),
});
export type TaskItem = z.infer<typeof TaskItemSchema>;

export const CreateTaskInputSchema = z.object({
  listId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).default('inbox'),
  title: z.string().trim().min(1, 'Task title is required').max(200),
  notes: z.string().trim().max(2000).optional(),
  priority: z.number().int().min(1).max(4).default(3),
  status: TaskStatusSchema.default('todo'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  subtasks: z.array(SubtaskItemSchema).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export interface TaskListMeta {
  id: string;
  labelKey: string;
  fallbackLabel: string;
}

export const DEFAULT_TASK_LISTS: readonly TaskListMeta[] = [
  { id: 'inbox', labelKey: 'planner.listInbox', fallbackLabel: 'Inbox' },
  { id: 'personal', labelKey: 'planner.listPersonal', fallbackLabel: 'Personal' },
  { id: 'work', labelKey: 'planner.listWork', fallbackLabel: 'Work' },
  { id: 'finance', labelKey: 'planner.listFinance', fallbackLabel: 'Finance' },
  { id: 'health', labelKey: 'planner.listHealth', fallbackLabel: 'Health' },
] as const;

export function getTaskListMeta(listId: string): TaskListMeta {
  return (
    DEFAULT_TASK_LISTS.find((l) => l.id === listId) ?? {
      id: listId,
      labelKey: 'planner.listInbox',
      fallbackLabel: listId,
    }
  );
}

export function getPriorityLabel(priority: number): { label: string; short: string } {
  switch (priority) {
    case 1:
      return { label: 'Urgent', short: 'P1' };
    case 2:
      return { label: 'High', short: 'P2' };
    case 3:
      return { label: 'Medium', short: 'P3' };
    default:
      return { label: 'Low', short: 'P4' };
  }
}

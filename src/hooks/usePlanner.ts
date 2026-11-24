import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  generateSortKeyBetween,
  sortBySortKey,
} from '../core/planner/fractionalIndex';
import type {
  CreateTaskInput,
  SubtaskItem,
  TaskItem,
  TaskStatus,
} from '../core/planner/plannerSchemas';
import { formatLocalYmd } from '../core/planner/unifiedCalendar';
import {
  firebasePlannerRepository,
  localPlannerRepository,
} from '../data/repositories/plannerRepository';
import { useUIStore } from '../state/useUIStore';

export function usePlanner() {
  const authUser = useUIStore((s) => s.authUser);
  const authReady = useUIStore((s) => s.authReady);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isCloud = Boolean(authUser?.uid);
  const uid = authUser?.uid ?? 'local';
  const repo = isCloud ? firebasePlannerRepository : localPlannerRepository;

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    setError(null);
    const unsub = repo.subscribeTasks(
      uid,
      (list) => {
        setTasks(sortBySortKey(list));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [authReady, repo, uid]);

  const summary = useMemo(() => {
    const todayYmd = formatLocalYmd(new Date());
    let activeCount = 0;
    let inProgressCount = 0;
    let dueTodayCount = 0;
    let overdueCount = 0;
    let completedCount = 0;

    for (const t of tasks) {
      if (t.status === 'done') {
        completedCount++;
        continue;
      }
      activeCount++;
      if (t.status === 'in_progress') inProgressCount++;
      if (t.dueDate === todayYmd) dueTodayCount++;
      if (t.dueDate && t.dueDate < todayYmd) overdueCount++;
    }

    return {
      totalCount: tasks.length,
      activeCount,
      inProgressCount,
      dueTodayCount,
      overdueCount,
      completedCount,
    };
  }, [tasks]);

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      // Append cleanly at end using single fractional index key
      const lastKey = tasks.length > 0 ? tasks[tasks.length - 1].sortKey : null;
      const sortKey = generateSortKeyBetween(lastKey, null);
      return repo.createTask(uid, input, sortKey);
    },
    [repo, tasks, uid]
  );

  const reorderTaskBetween = useCallback(
    async (task: TaskItem, prevTask: TaskItem | null, nextTask: TaskItem | null, nextListId?: string) => {
      const prevKey = prevTask ? prevTask.sortKey : null;
      const nextKey = nextTask ? nextTask.sortKey : null;
      // Guard against identical bounds if two items share a key
      let nextSortKey: string;
      if (prevKey && nextKey && prevKey >= nextKey) {
        nextSortKey = generateSortKeyBetween(prevKey, null);
      } else {
        nextSortKey = generateSortKeyBetween(prevKey, nextKey);
      }
      await repo.reorderTask(uid, task, nextSortKey, nextListId);
    },
    [repo, uid]
  );

  const setTaskStatus = useCallback(
    async (task: TaskItem, status: TaskStatus) => {
      await repo.updateTaskStatusOrSubtasks(uid, task, {
        status,
        completedAtIso: status === 'done' ? new Date().toISOString() : null,
      });
    },
    [repo, uid]
  );

  const toggleSubtask = useCallback(
    async (task: TaskItem, subtaskId: string) => {
      const nextSubs: SubtaskItem[] = (task.subtasks ?? []).map((s) =>
        s.id === subtaskId ? { ...s, done: !s.done } : s
      );
      await repo.updateTaskStatusOrSubtasks(uid, task, { subtasks: nextSubs });
    },
    [repo, uid]
  );

  const updateTaskMeta = useCallback(
    async (
      current: TaskItem,
      patch: Partial<
        Pick<
          TaskItem,
          'listId' | 'title' | 'notes' | 'priority' | 'dueDate' | 'subtasks' | 'tags' | 'status'
        >
      >
    ) => {
      await repo.updateTaskMeta(uid, current, patch);
    },
    [repo, uid]
  );

  const deleteTask = useCallback(
    async (task: TaskItem) => {
      await repo.deleteTask(uid, task);
    },
    [repo, uid]
  );

  const restoreTask = useCallback(
    async (task: TaskItem) => {
      await repo.restoreTask(uid, task);
    },
    [repo, uid]
  );

  return {
    tasks,
    loading,
    error,
    summary,
    isCloudSynced: isCloud,
    createTask,
    reorderTaskBetween,
    setTaskStatus,
    toggleSubtask,
    updateTaskMeta,
    deleteTask,
    restoreTask,
  };
}

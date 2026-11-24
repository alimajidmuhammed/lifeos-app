import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTodayDayKey } from '../core/entitlements/entitlements';
import { computeHabitsOverview } from '../core/habits/habitEngine';
import type { CreateHabitInput, HabitItem, HabitMonthLog } from '../core/habits/habitSchemas';
import {
  firebaseHabitsRepository,
  localHabitsRepository,
} from '../data/repositories/habitsRepository';
import { useUIStore } from '../state/useUIStore';

export function useHabits() {
  const authUser = useUIStore((s) => s.authUser);
  const uid = authUser?.uid ?? 'local_user';
  const repo = authUser ? firebaseHabitsRepository : localHabitsRepository;

  const [habits, setHabits] = useState<HabitItem[]>([]);
  const [logs, setLogs] = useState<HabitMonthLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let hReady = false;
    let lReady = false;

    const unsubHabits = repo.subscribeHabits(
      uid,
      (items) => {
        setHabits(items);
        hReady = true;
        if (hReady && lReady) setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    const unsubLogs = repo.subscribeHabitLogs(
      uid,
      (items) => {
        setLogs(items);
        lReady = true;
        if (hReady && lReady) setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      unsubHabits();
      unsubLogs();
    };
  }, [repo, uid]);

  const todayYmd = getTodayDayKey();

  const summary = useMemo(
    () => computeHabitsOverview(habits, logs, todayYmd),
    [habits, logs, todayYmd]
  );

  const createHabit = useCallback(
    (input: CreateHabitInput) => repo.createHabit(uid, input),
    [repo, uid]
  );

  const updateHabitMeta = useCallback(
    (
      current: HabitItem,
      patch: Partial<
        Pick<HabitItem, 'name' | 'category' | 'frequency' | 'targetPerWeek' | 'reminderTime' | 'archived'>
      >
    ) => repo.updateHabitMeta(uid, current, patch),
    [repo, uid]
  );

  const toggleHabitDay = useCallback(
    async (habit: HabitItem, dateYmd = todayYmd) => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(12);
        } catch {
          // Ignore unsupported haptic permission
        }
      }
      return repo.toggleHabitDay(uid, habit, logs, dateYmd, todayYmd);
    },
    [repo, uid, logs, todayYmd]
  );

  const deleteHabit = useCallback(
    (habit: HabitItem) => repo.deleteHabit(uid, habit),
    [repo, uid]
  );

  const restoreHabit = useCallback(
    (habit: HabitItem) => repo.restoreHabit(uid, habit),
    [repo, uid]
  );

  return {
    habits,
    logs,
    loading,
    error,
    todayYmd,
    summary,
    createHabit,
    updateHabitMeta,
    toggleHabitDay,
    deleteHabit,
    restoreHabit,
  };
}

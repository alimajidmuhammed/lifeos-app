import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  collectHabitCompletedDays,
  computeHabitStreakStats,
  toggleDayInMonthBucket,
} from '../../core/habits/habitEngine';
import {
  CreateHabitInputSchema,
  getHabitMonthBucketId,
  type CreateHabitInput,
  type HabitItem,
  type HabitMonthLog,
} from '../../core/habits/habitSchemas';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseClient';
import type { HabitsRepository } from './interfaces';

const LOCAL_HABITS_KEY = 'lifeos_local_habits_v1';
const LOCAL_HABIT_LOGS_KEY = 'lifeos_local_habit_logs_v1';
const HABITS_EVENT = 'lifeos:habits:changed';

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class FirebaseWebHabitsRepository implements HabitsRepository {
  subscribeHabits(
    uid: string,
    onData: (habits: HabitItem[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/habits`;
    const q = query(
      collection(db, 'users', uid, 'habits'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(
      q,
      (snap) => {
        const items: HabitItem[] = snap.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            uid: String(raw.uid ?? uid),
            name: String(raw.name ?? ''),
            category: (raw.category ?? 'health') as HabitItem['category'],
            frequency: (raw.frequency ?? 'daily') as HabitItem['frequency'],
            targetPerWeek: Number(raw.targetPerWeek ?? 7),
            reminderTime: typeof raw.reminderTime === 'string' ? raw.reminderTime : undefined,
            currentStreak: Number(raw.currentStreak ?? 0),
            bestStreak: Number(raw.bestStreak ?? 0),
            totalCompletions: Number(raw.totalCompletions ?? 0),
            lastCompletedDate:
              typeof raw.lastCompletedDate === 'string' ? raw.lastCompletedDate : undefined,
            archived: Boolean(raw.archived),
            version: Number(raw.version ?? 1),
            createdAt: tsToIso(raw.createdAt),
            updatedAt: tsToIso(raw.updatedAt),
          };
        });
        onData(items);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
  }

  subscribeHabitLogs(
    uid: string,
    onData: (logs: HabitMonthLog[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/habitLogs`;
    const q = query(collection(db, 'users', uid, 'habitLogs'), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const logs: HabitMonthLog[] = snap.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            uid: String(raw.uid ?? uid),
            habitId: String(raw.habitId ?? ''),
            monthKey: String(raw.monthKey ?? ''),
            days: Array.isArray(raw.days) ? raw.days.map(String) : [],
            version: Number(raw.version ?? 1),
            createdAt: tsToIso(raw.createdAt),
            updatedAt: tsToIso(raw.updatedAt),
          };
        });
        onData(logs);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
  }

  async createHabit(uid: string, input: CreateHabitInput): Promise<HabitItem> {
    const valid = CreateHabitInputSchema.parse(input);
    const id = makeId('hab');
    const path = `users/${uid}/habits/${id}`;
    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      uid,
      name: valid.name,
      category: valid.category,
      frequency: valid.frequency,
      targetPerWeek: valid.frequency === 'daily' ? 7 : valid.targetPerWeek,
      currentStreak: 0,
      bestStreak: 0,
      totalCompletions: 0,
      archived: false,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (valid.reminderTime) payload.reminderTime = valid.reminderTime;

    try {
      await setDoc(doc(db, 'users', uid, 'habits', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }

    return {
      id,
      uid,
      name: valid.name,
      category: valid.category,
      frequency: valid.frequency,
      targetPerWeek: valid.frequency === 'daily' ? 7 : valid.targetPerWeek,
      reminderTime: valid.reminderTime,
      currentStreak: 0,
      bestStreak: 0,
      totalCompletions: 0,
      archived: false,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  async updateHabitMeta(
    uid: string,
    current: HabitItem,
    patch: Partial<
      Pick<HabitItem, 'name' | 'category' | 'frequency' | 'targetPerWeek' | 'reminderTime' | 'archived'>
    >
  ): Promise<void> {
    const path = `users/${uid}/habits/${current.id}`;
    const updateData: Record<string, unknown> = {
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (patch.name !== undefined) updateData.name = patch.name.trim().slice(0, 120);
    if (patch.category !== undefined) updateData.category = patch.category;
    if (patch.frequency !== undefined) updateData.frequency = patch.frequency;
    if (patch.targetPerWeek !== undefined) updateData.targetPerWeek = patch.targetPerWeek;
    if (patch.reminderTime !== undefined) updateData.reminderTime = patch.reminderTime;
    if (patch.archived !== undefined) updateData.archived = patch.archived;

    try {
      await updateDoc(doc(db, 'users', uid, 'habits', current.id), updateData);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async toggleHabitDay(
    uid: string,
    habit: HabitItem,
    existingLogs: HabitMonthLog[],
    dateYmd: string,
    todayYmd: string
  ): Promise<{ added: boolean; currentStreak: number }> {
    const monthKey = dateYmd.slice(0, 7);
    const bucketId = getHabitMonthBucketId(habit.id, monthKey);
    const existingBucket = existingLogs.find((l) => l.id === bucketId) ?? null;

    const { nextDays, added } = toggleDayInMonthBucket(existingBucket?.days ?? [], dateYmd);

    // Recompute deterministic streak stats with the updated bucket included
    const simulatedLogs = existingBucket
      ? existingLogs.map((l) => (l.id === bucketId ? { ...l, days: nextDays } : l))
      : [
          ...existingLogs,
          {
            id: bucketId,
            uid,
            habitId: habit.id,
            monthKey,
            days: nextDays,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];

    const completedSet = collectHabitCompletedDays(habit.id, simulatedLogs);
    const stats = computeHabitStreakStats(habit, completedSet, todayYmd);

    const batch = writeBatch(db);
    const bucketRef = doc(db, 'users', uid, 'habitLogs', bucketId);
    if (existingBucket) {
      batch.update(bucketRef, {
        days: nextDays,
        version: existingBucket.version + 1,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(bucketRef, {
        uid,
        habitId: habit.id,
        monthKey,
        days: nextDays,
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const habitUpdate: Record<string, unknown> = {
      currentStreak: stats.currentStreak,
      bestStreak: Math.max(habit.bestStreak, stats.bestStreak),
      totalCompletions: stats.totalCompletions,
      version: habit.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (stats.lastCompletedDate) {
      habitUpdate.lastCompletedDate = stats.lastCompletedDate;
    }
    batch.update(doc(db, 'users', uid, 'habits', habit.id), habitUpdate);

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/habitLogs/${bucketId}`);
    }

    return { added, currentStreak: stats.currentStreak };
  }

  async deleteHabit(uid: string, habit: HabitItem): Promise<void> {
    const path = `users/${uid}/habits/${habit.id}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'habits', habit.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async restoreHabit(uid: string, habit: HabitItem): Promise<void> {
    const path = `users/${uid}/habits/${habit.id}`;
    const payload: Record<string, unknown> = {
      uid,
      name: habit.name,
      category: habit.category,
      frequency: habit.frequency,
      targetPerWeek: habit.targetPerWeek,
      currentStreak: habit.currentStreak,
      bestStreak: Math.max(habit.bestStreak, habit.currentStreak),
      totalCompletions: habit.totalCompletions,
      archived: habit.archived,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (habit.reminderTime) payload.reminderTime = habit.reminderTime;
    if (habit.lastCompletedDate) payload.lastCompletedDate = habit.lastCompletedDate;

    try {
      await setDoc(doc(db, 'users', uid, 'habits', habit.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }
}

export class LocalOfflineHabitsRepository implements HabitsRepository {
  private readHabits(): HabitItem[] {
    try {
      const raw = localStorage.getItem(LOCAL_HABITS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as HabitItem[]) : [];
    } catch {
      return [];
    }
  }

  private writeHabits(items: HabitItem[]): void {
    localStorage.setItem(LOCAL_HABITS_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(HABITS_EVENT));
  }

  private readLogs(): HabitMonthLog[] {
    try {
      const raw = localStorage.getItem(LOCAL_HABIT_LOGS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as HabitMonthLog[]) : [];
    } catch {
      return [];
    }
  }

  private writeLogs(items: HabitMonthLog[]): void {
    localStorage.setItem(LOCAL_HABIT_LOGS_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(HABITS_EVENT));
  }

  subscribeHabits(_uid: string, onData: (habits: HabitItem[]) => void): () => void {
    const emit = () => onData(this.readHabits());
    emit();
    window.addEventListener(HABITS_EVENT, emit);
    window.addEventListener('storage', emit);
    return () => {
      window.removeEventListener(HABITS_EVENT, emit);
      window.removeEventListener('storage', emit);
    };
  }

  subscribeHabitLogs(_uid: string, onData: (logs: HabitMonthLog[]) => void): () => void {
    const emit = () => onData(this.readLogs());
    emit();
    window.addEventListener(HABITS_EVENT, emit);
    window.addEventListener('storage', emit);
    return () => {
      window.removeEventListener(HABITS_EVENT, emit);
      window.removeEventListener('storage', emit);
    };
  }

  async createHabit(uid: string, input: CreateHabitInput): Promise<HabitItem> {
    const valid = CreateHabitInputSchema.parse(input);
    const nowIso = new Date().toISOString();
    const item: HabitItem = {
      id: makeId('hab'),
      uid,
      name: valid.name,
      category: valid.category,
      frequency: valid.frequency,
      targetPerWeek: valid.frequency === 'daily' ? 7 : valid.targetPerWeek,
      reminderTime: valid.reminderTime,
      currentStreak: 0,
      bestStreak: 0,
      totalCompletions: 0,
      archived: false,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.writeHabits([item, ...this.readHabits()]);
    return item;
  }

  async updateHabitMeta(
    _uid: string,
    current: HabitItem,
    patch: Partial<
      Pick<HabitItem, 'name' | 'category' | 'frequency' | 'targetPerWeek' | 'reminderTime' | 'archived'>
    >
  ): Promise<void> {
    const items = this.readHabits().map((h) =>
      h.id === current.id
        ? {
            ...h,
            ...patch,
            version: h.version + 1,
            updatedAt: new Date().toISOString(),
          }
        : h
    );
    this.writeHabits(items);
  }

  async toggleHabitDay(
    uid: string,
    habit: HabitItem,
    _existingLogs: HabitMonthLog[],
    dateYmd: string,
    todayYmd: string
  ): Promise<{ added: boolean; currentStreak: number }> {
    const monthKey = dateYmd.slice(0, 7);
    const bucketId = getHabitMonthBucketId(habit.id, monthKey);
    const allLogs = this.readLogs();
    const existingBucket = allLogs.find((l) => l.id === bucketId) ?? null;
    const { nextDays, added } = toggleDayInMonthBucket(existingBucket?.days ?? [], dateYmd);
    const nowIso = new Date().toISOString();

    const nextLogs = existingBucket
      ? allLogs.map((l) =>
          l.id === bucketId ? { ...l, days: nextDays, version: l.version + 1, updatedAt: nowIso } : l
        )
      : [
          ...allLogs,
          {
            id: bucketId,
            uid,
            habitId: habit.id,
            monthKey,
            days: nextDays,
            version: 1,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];

    const completedSet = collectHabitCompletedDays(habit.id, nextLogs);
    const stats = computeHabitStreakStats(habit, completedSet, todayYmd);

    const nextHabits = this.readHabits().map((h) =>
      h.id === habit.id
        ? {
            ...h,
            currentStreak: stats.currentStreak,
            bestStreak: Math.max(h.bestStreak, stats.bestStreak),
            totalCompletions: stats.totalCompletions,
            lastCompletedDate: stats.lastCompletedDate,
            version: h.version + 1,
            updatedAt: nowIso,
          }
        : h
    );

    localStorage.setItem(LOCAL_HABIT_LOGS_KEY, JSON.stringify(nextLogs));
    localStorage.setItem(LOCAL_HABITS_KEY, JSON.stringify(nextHabits));
    window.dispatchEvent(new CustomEvent(HABITS_EVENT));

    return { added, currentStreak: stats.currentStreak };
  }

  async deleteHabit(_uid: string, habit: HabitItem): Promise<void> {
    this.writeHabits(this.readHabits().filter((h) => h.id !== habit.id));
  }

  async restoreHabit(_uid: string, habit: HabitItem): Promise<void> {
    const items = this.readHabits().filter((h) => h.id !== habit.id);
    this.writeHabits([habit, ...items]);
  }
}

export const firebaseHabitsRepository = new FirebaseWebHabitsRepository();
export const localHabitsRepository = new LocalOfflineHabitsRepository();

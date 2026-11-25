import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseClient';
import {
  CreateReminderInputSchema,
  generateReminderId,
  ReminderItemSchema,
  type CreateReminderInput,
  type ReminderItem,
} from '../../core/reminders/reminderSchemas';
import { computeCompletionTransition, parseRRule } from '../../core/reminders/rruleEngine';
import type { RemindersRepository } from './interfaces';

function tsToIso(val: unknown): string | undefined {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return undefined;
}

function sortRemindersChronologically(items: ReminderItem[]): ReminderItem[] {
  return [...items].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    const aTime = new Date(a.snoozedUntilIso ?? a.dueAtIso).getTime();
    const bTime = new Date(b.snoozedUntilIso ?? b.dueAtIso).getTime();
    return aTime - bTime;
  });
}

/**
 * Cloud Firestore Web Adapter for Phase 3 Smart Reminders.
 * Enforces strict Zod validation, action-split updates matching firestore.rules,
 * and structured error surfacing via handleFirestoreError.
 */
export class FirebaseWebRemindersRepository implements RemindersRepository {
  subscribeReminders(
    uid: string,
    onData: (reminders: ReminderItem[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/reminders`;
    const q = query(collection(db, 'users', uid, 'reminders'), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const items: ReminderItem[] = [];
        for (const d of snap.docs) {
          const raw = d.data();
          const parsed = ReminderItemSchema.safeParse({
            id: d.id,
            uid: raw.uid,
            title: raw.title,
            notes: raw.notes,
            category: raw.category ?? 'custom',
            priority: raw.priority ?? 'normal',
            dueAtIso: raw.dueAtIso,
            rrule: raw.rrule,
            snoozedUntilIso: raw.snoozedUntilIso,
            respectQuietHours: raw.respectQuietHours ?? false,
            status: raw.status ?? (raw.isCompleted ? 'completed' : 'scheduled'),
            isCompleted: Boolean(raw.isCompleted),
            completedCount: Number(raw.completedCount ?? 0),
            lastCompletedAtIso: raw.lastCompletedAtIso,
            linkedDebtId: raw.linkedDebtId,
            version: Number(raw.version ?? 1),
            createdAtIso: tsToIso(raw.createdAt),
            updatedAtIso: tsToIso(raw.updatedAt),
          });
          if (parsed.success) items.push(parsed.data);
        }
        onData(sortRemindersChronologically(items));
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
  }

  async createReminder(uid: string, input: CreateReminderInput): Promise<ReminderItem> {
    const validatedInput = CreateReminderInputSchema.parse(input);
    const cleanedRrule = validatedInput.rrule?.trim() || undefined;
    if (cleanedRrule && !parseRRule(cleanedRrule)) {
      throw new Error('Invalid recurrence rule (RRULE).');
    }

    const id = generateReminderId();
    const nowIso = new Date().toISOString();
    const record: ReminderItem = ReminderItemSchema.parse({
      id,
      uid,
      title: validatedInput.title,
      notes: validatedInput.notes || undefined,
      category: validatedInput.category,
      priority: validatedInput.priority,
      dueAtIso: validatedInput.dueAtIso,
      rrule: cleanedRrule,
      respectQuietHours: validatedInput.respectQuietHours,
      status: 'scheduled',
      isCompleted: false,
      completedCount: 0,
      linkedDebtId: validatedInput.linkedDebtId || undefined,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    });

    const path = `users/${uid}/reminders/${id}`;
    const payload: Record<string, unknown> = {
      uid,
      title: record.title,
      category: record.category,
      priority: record.priority,
      dueAtIso: record.dueAtIso,
      respectQuietHours: record.respectQuietHours,
      status: record.status,
      isCompleted: false,
      completedCount: 0,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (record.notes) payload.notes = record.notes;
    if (record.rrule) payload.rrule = record.rrule;
    if (record.linkedDebtId) payload.linkedDebtId = record.linkedDebtId;

    try {
      await setDoc(doc(db, 'users', uid, 'reminders', id), payload);
      return record;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  async updateReminder(
    uid: string,
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
  ): Promise<void> {
    if (current.status === 'archived') {
      throw new Error('Archived reminders cannot be modified.');
    }
    const nextRrule = patch.rrule !== undefined ? patch.rrule.trim() || undefined : current.rrule;
    if (nextRrule && !parseRRule(nextRrule)) {
      throw new Error('Invalid recurrence rule (RRULE).');
    }

    const candidate = ReminderItemSchema.parse({
      ...current,
      title: patch.title !== undefined ? patch.title.trim() : current.title,
      notes: patch.notes !== undefined ? patch.notes.trim() || undefined : current.notes,
      category: patch.category ?? current.category,
      priority: patch.priority ?? current.priority,
      dueAtIso: patch.dueAtIso ?? current.dueAtIso,
      rrule: nextRrule,
      snoozedUntilIso: patch.dueAtIso ? undefined : current.snoozedUntilIso,
      status: patch.dueAtIso && current.status === 'snoozed' ? 'scheduled' : current.status,
      respectQuietHours: patch.respectQuietHours ?? current.respectQuietHours,
      linkedDebtId: patch.linkedDebtId !== undefined ? patch.linkedDebtId || undefined : current.linkedDebtId,
      version: current.version + 1,
    });

    const path = `users/${uid}/reminders/${current.id}`;
    const payload: Record<string, unknown> = {
      title: candidate.title,
      notes: candidate.notes ? candidate.notes : deleteField(),
      category: candidate.category,
      priority: candidate.priority,
      dueAtIso: candidate.dueAtIso,
      rrule: candidate.rrule ? candidate.rrule : deleteField(),
      snoozedUntilIso: candidate.snoozedUntilIso ? candidate.snoozedUntilIso : deleteField(),
      respectQuietHours: candidate.respectQuietHours,
      status: candidate.status,
      isCompleted: candidate.isCompleted,
      linkedDebtId: candidate.linkedDebtId ? candidate.linkedDebtId : deleteField(),
      version: candidate.version,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'users', uid, 'reminders', current.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async completeReminder(
    uid: string,
    current: ReminderItem
  ): Promise<{ advancedRecurring: boolean; nextDueAtIso: string }> {
    const now = new Date();
    const transition = computeCompletionTransition(current, now);
    const path = `users/${uid}/reminders/${current.id}`;

    const payload: Record<string, unknown> = {
      dueAtIso: transition.nextDueAtIso,
      snoozedUntilIso: deleteField(),
      status: transition.nextStatus,
      isCompleted: transition.nextIsCompleted,
      completedCount: transition.nextCompletedCount,
      lastCompletedAtIso: now.toISOString(),
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'users', uid, 'reminders', current.id), payload);
      return {
        advancedRecurring: transition.advancedRecurring,
        nextDueAtIso: transition.nextDueAtIso,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async reopenReminder(uid: string, current: ReminderItem): Promise<void> {
    const path = `users/${uid}/reminders/${current.id}`;
    try {
      await updateDoc(doc(db, 'users', uid, 'reminders', current.id), {
        status: 'scheduled',
        isCompleted: false,
        snoozedUntilIso: deleteField(),
        version: current.version + 1,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async snoozeReminder(uid: string, current: ReminderItem, snoozedUntilIso: string): Promise<void> {
    const path = `users/${uid}/reminders/${current.id}`;
    try {
      await updateDoc(doc(db, 'users', uid, 'reminders', current.id), {
        snoozedUntilIso,
        status: 'snoozed',
        version: current.version + 1,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async deleteReminder(uid: string, reminder: ReminderItem): Promise<void> {
    const path = `users/${uid}/reminders/${reminder.id}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'reminders', reminder.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async restoreReminder(uid: string, reminder: ReminderItem): Promise<void> {
    const validated = ReminderItemSchema.parse({ ...reminder, uid, version: 1 });
    const path = `users/${uid}/reminders/${validated.id}`;
    const payload: Record<string, unknown> = {
      uid,
      title: validated.title,
      category: validated.category,
      priority: validated.priority,
      dueAtIso: validated.dueAtIso,
      respectQuietHours: validated.respectQuietHours,
      status: validated.status,
      isCompleted: validated.isCompleted,
      completedCount: validated.completedCount,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (validated.notes) payload.notes = validated.notes;
    if (validated.rrule) payload.rrule = validated.rrule;
    if (validated.snoozedUntilIso) payload.snoozedUntilIso = validated.snoozedUntilIso;
    if (validated.lastCompletedAtIso) payload.lastCompletedAtIso = validated.lastCompletedAtIso;
    if (validated.linkedDebtId) payload.linkedDebtId = validated.linkedDebtId;

    try {
      await setDoc(doc(db, 'users', uid, 'reminders', validated.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }
}

/**
 * Local Offline Adapter for Stage 0 unauthenticated / offline workspace.
 */
const LOCAL_REMINDERS_STORAGE_KEY = 'lifeos_local_reminders_v1';

class LocalOfflineRemindersRepository implements RemindersRepository {
  private listeners = new Set<(reminders: ReminderItem[]) => void>();

  private readAll(): ReminderItem[] {
    try {
      const raw = localStorage.getItem(LOCAL_REMINDERS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return sortRemindersChronologically(parsed as ReminderItem[]);
      }
    } catch {
      // Ignore read errors
    }
    return [];
  }

  private writeAll(items: ReminderItem[]): void {
    const sorted = sortRemindersChronologically(items);
    try {
      localStorage.setItem(LOCAL_REMINDERS_STORAGE_KEY, JSON.stringify(sorted));
    } catch {
      // Ignore quota errors
    }
    for (const cb of this.listeners) cb(sorted);
  }

  subscribeReminders(_uid: string, onData: (reminders: ReminderItem[]) => void): () => void {
    this.listeners.add(onData);
    onData(this.readAll());
    return () => {
      this.listeners.delete(onData);
    };
  }

  async createReminder(uid: string, input: CreateReminderInput): Promise<ReminderItem> {
    const validatedInput = CreateReminderInputSchema.parse(input);
    const cleanedRrule = validatedInput.rrule?.trim() || undefined;
    if (cleanedRrule && !parseRRule(cleanedRrule)) {
      throw new Error('Invalid recurrence rule (RRULE).');
    }

    const nowIso = new Date().toISOString();
    const record = ReminderItemSchema.parse({
      id: generateReminderId(),
      uid,
      title: validatedInput.title,
      notes: validatedInput.notes || undefined,
      category: validatedInput.category,
      priority: validatedInput.priority,
      dueAtIso: validatedInput.dueAtIso,
      rrule: cleanedRrule,
      respectQuietHours: validatedInput.respectQuietHours,
      status: 'scheduled',
      isCompleted: false,
      completedCount: 0,
      linkedDebtId: validatedInput.linkedDebtId || undefined,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    });

    this.writeAll([record, ...this.readAll()]);
    return record;
  }

  async updateReminder(
    _uid: string,
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
  ): Promise<void> {
    const nextRrule = patch.rrule !== undefined ? patch.rrule.trim() || undefined : current.rrule;
    if (nextRrule && !parseRRule(nextRrule)) {
      throw new Error('Invalid recurrence rule (RRULE).');
    }

    const updated = ReminderItemSchema.parse({
      ...current,
      title: patch.title !== undefined ? patch.title.trim() : current.title,
      notes: patch.notes !== undefined ? patch.notes.trim() || undefined : current.notes,
      category: patch.category ?? current.category,
      priority: patch.priority ?? current.priority,
      dueAtIso: patch.dueAtIso ?? current.dueAtIso,
      rrule: nextRrule,
      snoozedUntilIso: patch.dueAtIso ? undefined : current.snoozedUntilIso,
      status: patch.dueAtIso && current.status === 'snoozed' ? 'scheduled' : current.status,
      respectQuietHours: patch.respectQuietHours ?? current.respectQuietHours,
      linkedDebtId: patch.linkedDebtId !== undefined ? patch.linkedDebtId || undefined : current.linkedDebtId,
      version: current.version + 1,
      updatedAtIso: new Date().toISOString(),
    });

    this.writeAll(this.readAll().map((r) => (r.id === current.id ? updated : r)));
  }

  async completeReminder(
    _uid: string,
    current: ReminderItem
  ): Promise<{ advancedRecurring: boolean; nextDueAtIso: string }> {
    const now = new Date();
    const transition = computeCompletionTransition(current, now);
    const updated = ReminderItemSchema.parse({
      ...current,
      dueAtIso: transition.nextDueAtIso,
      snoozedUntilIso: undefined,
      status: transition.nextStatus,
      isCompleted: transition.nextIsCompleted,
      completedCount: transition.nextCompletedCount,
      lastCompletedAtIso: now.toISOString(),
      version: current.version + 1,
      updatedAtIso: now.toISOString(),
    });
    this.writeAll(this.readAll().map((r) => (r.id === current.id ? updated : r)));
    return {
      advancedRecurring: transition.advancedRecurring,
      nextDueAtIso: transition.nextDueAtIso,
    };
  }

  async reopenReminder(_uid: string, current: ReminderItem): Promise<void> {
    const updated = ReminderItemSchema.parse({
      ...current,
      status: 'scheduled',
      isCompleted: false,
      snoozedUntilIso: undefined,
      version: current.version + 1,
      updatedAtIso: new Date().toISOString(),
    });
    this.writeAll(this.readAll().map((r) => (r.id === current.id ? updated : r)));
  }

  async snoozeReminder(_uid: string, current: ReminderItem, snoozedUntilIso: string): Promise<void> {
    const updated = ReminderItemSchema.parse({
      ...current,
      snoozedUntilIso,
      status: 'snoozed',
      version: current.version + 1,
      updatedAtIso: new Date().toISOString(),
    });
    this.writeAll(this.readAll().map((r) => (r.id === current.id ? updated : r)));
  }

  async deleteReminder(_uid: string, reminder: ReminderItem): Promise<void> {
    this.writeAll(this.readAll().filter((r) => r.id !== reminder.id));
  }

  async restoreReminder(_uid: string, reminder: ReminderItem): Promise<void> {
    const cur = this.readAll();
    if (cur.some((r) => r.id === reminder.id)) return;
    this.writeAll([reminder, ...cur]);
  }
}

export const firebaseRemindersRepository: RemindersRepository = new FirebaseWebRemindersRepository();
export const localRemindersRepository: RemindersRepository = new LocalOfflineRemindersRepository();

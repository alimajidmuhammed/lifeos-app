import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import {
  CreateTaskInputSchema,
  type CreateTaskInput,
  type SubtaskItem,
  type TaskItem,
  type TaskStatus,
} from '../../core/planner/plannerSchemas';
import { sortBySortKey } from '../../core/planner/fractionalIndex';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseClient';
import type { PlannerRepository } from './interfaces';

const LOCAL_TASKS_KEY = 'lifeos_local_tasks_v1';

function generateSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function timestampToIso(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  return undefined;
}

function mapTaskDoc(id: string, raw: Record<string, unknown>): TaskItem {
  return {
    id,
    uid: String(raw.uid ?? ''),
    listId: String(raw.listId ?? 'inbox'),
    title: String(raw.title ?? 'Untitled Task'),
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    priority: Number(raw.priority ?? 3),
    sortKey: String(raw.sortKey ?? 'V'),
    status: (raw.status as TaskStatus) ?? 'todo',
    dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : undefined,
    subtasks: Array.isArray(raw.subtasks) ? (raw.subtasks as SubtaskItem[]) : undefined,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined,
    completedAtIso: typeof raw.completedAtIso === 'string' ? raw.completedAtIso : undefined,
    version: Number(raw.version ?? 1),
    createdAtIso: timestampToIso(raw.createdAt),
    updatedAtIso: timestampToIso(raw.updatedAt),
  };
}

export class FirebaseWebPlannerRepository implements PlannerRepository {
  subscribeTasks(
    uid: string,
    onData: (tasks: TaskItem[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const colPath = `users/${uid}/tasks`;
    const q = query(collection(db, colPath), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => mapTaskDoc(d.id, d.data() as Record<string, unknown>));
        onData(sortBySortKey(list));
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, colPath);
        } catch (wrapped) {
          onError?.(wrapped as Error);
        }
      }
    );
  }

  async createTask(uid: string, rawInput: CreateTaskInput, sortKey: string): Promise<TaskItem> {
    const input = CreateTaskInputSchema.parse(rawInput);
    const id = generateSafeId('tsk');
    const docPath = `users/${uid}/tasks/${id}`;
    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      uid,
      listId: input.listId,
      title: input.title,
      priority: input.priority,
      sortKey,
      status: input.status,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.notes) payload.notes = input.notes;
    if (input.dueDate) payload.dueDate = input.dueDate;
    if (input.subtasks && input.subtasks.length > 0) payload.subtasks = input.subtasks;
    if (input.tags && input.tags.length > 0) payload.tags = input.tags;
    if (input.status === 'done') payload.completedAtIso = nowIso;

    try {
      await setDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    }

    return {
      id,
      uid,
      listId: input.listId,
      title: input.title,
      notes: input.notes,
      priority: input.priority,
      sortKey,
      status: input.status,
      dueDate: input.dueDate,
      subtasks: input.subtasks,
      tags: input.tags,
      completedAtIso: input.status === 'done' ? nowIso : undefined,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
  }

  async reorderTask(
    uid: string,
    current: TaskItem,
    nextSortKey: string,
    nextListId?: string
  ): Promise<void> {
    const docPath = `users/${uid}/tasks/${current.id}`;
    const payload: Record<string, unknown> = {
      sortKey: nextSortKey,
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (nextListId && nextListId !== current.listId) {
      payload.listId = nextListId;
    }
    try {
      await updateDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  }

  async updateTaskStatusOrSubtasks(
    uid: string,
    current: TaskItem,
    patch: { status?: TaskStatus; subtasks?: SubtaskItem[]; completedAtIso?: string | null }
  ): Promise<void> {
    const docPath = `users/${uid}/tasks/${current.id}`;
    const payload: Record<string, unknown> = {
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.subtasks !== undefined) payload.subtasks = patch.subtasks;
    if (patch.completedAtIso !== undefined) {
      payload.completedAtIso = patch.completedAtIso ? patch.completedAtIso : deleteField();
    }
    try {
      await updateDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  }

  async updateTaskMeta(
    uid: string,
    current: TaskItem,
    patch: Partial<Pick<TaskItem, 'listId' | 'title' | 'notes' | 'priority' | 'dueDate' | 'subtasks' | 'tags' | 'status'>>
  ): Promise<void> {
    const docPath = `users/${uid}/tasks/${current.id}`;
    const payload: Record<string, unknown> = {
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (patch.listId !== undefined) payload.listId = patch.listId;
    if (patch.title !== undefined) payload.title = patch.title.trim();
    if (patch.notes !== undefined) payload.notes = patch.notes ? patch.notes.trim() : deleteField();
    if (patch.priority !== undefined) payload.priority = patch.priority;
    if (patch.dueDate !== undefined) payload.dueDate = patch.dueDate ? patch.dueDate : deleteField();
    if (patch.subtasks !== undefined) payload.subtasks = patch.subtasks;
    if (patch.tags !== undefined) payload.tags = patch.tags;
    if (patch.status !== undefined) {
      payload.status = patch.status;
      payload.completedAtIso = patch.status === 'done' ? new Date().toISOString() : deleteField();
    }
    try {
      await updateDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  }

  async deleteTask(uid: string, task: TaskItem): Promise<void> {
    const docPath = `users/${uid}/tasks/${task.id}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  }

  async restoreTask(uid: string, task: TaskItem): Promise<void> {
    const docPath = `users/${uid}/tasks/${task.id}`;
    const payload: Record<string, unknown> = {
      uid,
      listId: task.listId,
      title: task.title,
      priority: task.priority,
      sortKey: task.sortKey,
      status: task.status,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (task.notes) payload.notes = task.notes;
    if (task.dueDate) payload.dueDate = task.dueDate;
    if (task.subtasks && task.subtasks.length > 0) payload.subtasks = task.subtasks;
    if (task.tags && task.tags.length > 0) payload.tags = task.tags;
    if (task.completedAtIso) payload.completedAtIso = task.completedAtIso;

    try {
      await setDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    }
  }
}

export class LocalOfflinePlannerRepository implements PlannerRepository {
  private listeners = new Set<(tasks: TaskItem[]) => void>();

  private loadAll(): TaskItem[] {
    try {
      const raw = localStorage.getItem(LOCAL_TASKS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sortBySortKey(parsed as TaskItem[]) : [];
    } catch {
      return [];
    }
  }

  private saveAll(items: TaskItem[]): void {
    const sorted = sortBySortKey(items);
    try {
      localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(sorted));
    } catch {
      // ignore quota error
    }
    this.listeners.forEach((cb) => cb(sorted));
  }

  subscribeTasks(_uid: string, onData: (tasks: TaskItem[]) => void): () => void {
    this.listeners.add(onData);
    onData(this.loadAll());
    return () => {
      this.listeners.delete(onData);
    };
  }

  async createTask(uid: string, rawInput: CreateTaskInput, sortKey: string): Promise<TaskItem> {
    const input = CreateTaskInputSchema.parse(rawInput);
    const nowIso = new Date().toISOString();
    const record: TaskItem = {
      id: generateSafeId('tsk'),
      uid: uid || 'local',
      listId: input.listId,
      title: input.title,
      notes: input.notes,
      priority: input.priority,
      sortKey,
      status: input.status,
      dueDate: input.dueDate,
      subtasks: input.subtasks,
      tags: input.tags,
      completedAtIso: input.status === 'done' ? nowIso : undefined,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
    this.saveAll([...this.loadAll(), record]);
    return record;
  }

  async reorderTask(
    _uid: string,
    current: TaskItem,
    nextSortKey: string,
    nextListId?: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const list = this.loadAll().map((t) =>
      t.id === current.id
        ? {
            ...t,
            sortKey: nextSortKey,
            listId: nextListId ?? t.listId,
            version: t.version + 1,
            updatedAtIso: nowIso,
          }
        : t
    );
    this.saveAll(list);
  }

  async updateTaskStatusOrSubtasks(
    _uid: string,
    current: TaskItem,
    patch: { status?: TaskStatus; subtasks?: SubtaskItem[]; completedAtIso?: string | null }
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const list = this.loadAll().map((t) => {
      if (t.id !== current.id) return t;
      const next: TaskItem = {
        ...t,
        status: patch.status ?? t.status,
        subtasks: patch.subtasks ?? t.subtasks,
        version: t.version + 1,
        updatedAtIso: nowIso,
      };
      if (patch.completedAtIso === null) {
        delete next.completedAtIso;
      } else if (patch.completedAtIso !== undefined) {
        next.completedAtIso = patch.completedAtIso;
      }
      return next;
    });
    this.saveAll(list);
  }

  async updateTaskMeta(
    _uid: string,
    current: TaskItem,
    patch: Partial<Pick<TaskItem, 'listId' | 'title' | 'notes' | 'priority' | 'dueDate' | 'subtasks' | 'tags' | 'status'>>
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const list = this.loadAll().map((t) => {
      if (t.id !== current.id) return t;
      const next: TaskItem = {
        ...t,
        listId: patch.listId ?? t.listId,
        title: patch.title !== undefined ? patch.title.trim() : t.title,
        notes: patch.notes !== undefined ? (patch.notes.trim() || undefined) : t.notes,
        priority: patch.priority ?? t.priority,
        dueDate: patch.dueDate !== undefined ? (patch.dueDate || undefined) : t.dueDate,
        subtasks: patch.subtasks !== undefined ? patch.subtasks : t.subtasks,
        tags: patch.tags !== undefined ? patch.tags : t.tags,
        status: patch.status ?? t.status,
        version: t.version + 1,
        updatedAtIso: nowIso,
      };
      if (patch.status === 'done' && !next.completedAtIso) {
        next.completedAtIso = nowIso;
      } else if (patch.status && patch.status !== 'done') {
        delete next.completedAtIso;
      }
      return next;
    });
    this.saveAll(list);
  }

  async deleteTask(_uid: string, task: TaskItem): Promise<void> {
    this.saveAll(this.loadAll().filter((t) => t.id !== task.id));
  }

  async restoreTask(_uid: string, task: TaskItem): Promise<void> {
    const existing = this.loadAll().filter((t) => t.id !== task.id);
    this.saveAll([...existing, task]);
  }
}

export const firebasePlannerRepository = new FirebaseWebPlannerRepository();
export const localPlannerRepository = new LocalOfflinePlannerRepository();

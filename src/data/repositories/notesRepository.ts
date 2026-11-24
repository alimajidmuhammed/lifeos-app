import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import {
  countMarkdownWords,
  CreateFolderInputSchema,
  CreateNoteInputSchema,
  type CreateFolderInput,
  type CreateNoteInput,
  type NoteFolder,
  type NoteItem,
  type NoteVersion,
} from '../../core/notes/noteSchemas';
import { sortBySortKey } from '../../core/planner/fractionalIndex';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseClient';
import type { NotesRepository } from './interfaces';

const LOCAL_FOLDERS_KEY = 'lifeos_local_note_folders_v1';
const LOCAL_NOTES_KEY = 'lifeos_local_notes_v1';
const LOCAL_VERSIONS_KEY = 'lifeos_local_note_versions_v1';

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

function sortNotesList(items: NoteItem[]): NoteItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const at = a.updatedAtIso ?? a.createdAtIso ?? '';
    const bt = b.updatedAtIso ?? b.createdAtIso ?? '';
    return bt.localeCompare(at);
  });
}

function mapFolderDoc(id: string, raw: Record<string, unknown>): NoteFolder {
  return {
    id,
    uid: String(raw.uid ?? ''),
    name: String(raw.name ?? 'Folder'),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : undefined,
    sortKey: String(raw.sortKey ?? 'V'),
    isLockedFolder: Boolean(raw.isLockedFolder),
    version: Number(raw.version ?? 1),
    createdAtIso: timestampToIso(raw.createdAt),
    updatedAtIso: timestampToIso(raw.updatedAt),
  };
}

function mapNoteDoc(id: string, raw: Record<string, unknown>): NoteItem {
  return {
    id,
    uid: String(raw.uid ?? ''),
    folderId: typeof raw.folderId === 'string' ? raw.folderId : undefined,
    title: String(raw.title ?? 'Untitled Note'),
    content: String(raw.content ?? ''),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : undefined,
    isEncrypted: Boolean(raw.isEncrypted),
    isLocked: Boolean(raw.isLocked),
    pinned: Boolean(raw.pinned),
    wordCount: Number(raw.wordCount ?? 0),
    version: Number(raw.version ?? 1),
    createdAtIso: timestampToIso(raw.createdAt),
    updatedAtIso: timestampToIso(raw.updatedAt),
  };
}

export class FirebaseWebNotesRepository implements NotesRepository {
  subscribeFolders(
    uid: string,
    onData: (folders: NoteFolder[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const colPath = `users/${uid}/noteFolders`;
    const q = query(collection(db, colPath), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => mapFolderDoc(d.id, d.data() as Record<string, unknown>));
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

  async createFolder(
    uid: string,
    rawInput: CreateFolderInput,
    sortKey: string
  ): Promise<NoteFolder> {
    const input = CreateFolderInputSchema.parse(rawInput);
    const id = generateSafeId('fld');
    const docPath = `users/${uid}/noteFolders/${id}`;
    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      uid,
      name: input.name,
      sortKey,
      isLockedFolder: input.isLockedFolder,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.parentId) payload.parentId = input.parentId;

    try {
      await setDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    }

    return {
      id,
      uid,
      name: input.name,
      parentId: input.parentId,
      sortKey,
      isLockedFolder: input.isLockedFolder,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
  }

  async deleteFolder(uid: string, folderId: string): Promise<void> {
    const docPath = `users/${uid}/noteFolders/${folderId}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  }

  subscribeNotes(
    uid: string,
    onData: (notes: NoteItem[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const colPath = `users/${uid}/notes`;
    const q = query(collection(db, colPath), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => mapNoteDoc(d.id, d.data() as Record<string, unknown>));
        onData(sortNotesList(list));
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

  async createNote(uid: string, rawInput: CreateNoteInput): Promise<NoteItem> {
    const input = CreateNoteInputSchema.parse(rawInput);
    const id = generateSafeId('nte');
    const docPath = `users/${uid}/notes/${id}`;
    const nowIso = new Date().toISOString();
    const wordCount = input.isEncrypted ? 0 : countMarkdownWords(input.content);

    const payload: Record<string, unknown> = {
      uid,
      title: input.title,
      content: input.content,
      isEncrypted: input.isEncrypted,
      isLocked: input.isEncrypted ? true : input.isLocked,
      pinned: input.pinned,
      wordCount,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.folderId) payload.folderId = input.folderId;
    if (input.tags && input.tags.length > 0) payload.tags = input.tags;

    try {
      await setDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    }

    return {
      id,
      uid,
      folderId: input.folderId,
      title: input.title,
      content: input.content,
      tags: input.tags,
      isEncrypted: input.isEncrypted,
      isLocked: input.isEncrypted ? true : input.isLocked,
      pinned: input.pinned,
      wordCount,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
  }

  async updateNoteContent(
    uid: string,
    current: NoteItem,
    patch: {
      title?: string;
      content?: string;
      folderId?: string | null;
      tags?: string[];
      pinned?: boolean;
      wordCount?: number;
    },
    saveVersionSnapshot = true
  ): Promise<void> {
    const docPath = `users/${uid}/notes/${current.id}`;
    const nextContent = patch.content !== undefined ? patch.content : current.content;
    const nextWordCount =
      patch.wordCount !== undefined
        ? patch.wordCount
        : current.isEncrypted
          ? 0
          : countMarkdownWords(nextContent);

    if (saveVersionSnapshot && (patch.content !== current.content || patch.title !== current.title)) {
      const verId = generateSafeId('ver');
      const verPath = `users/${uid}/notes/${current.id}/versions/${verId}`;
      try {
        await setDoc(doc(db, verPath), {
          uid,
          noteId: current.id,
          title: current.title,
          content: current.content,
          isEncrypted: current.isEncrypted,
          versionNumber: current.version,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, verPath);
      }
    }

    const payload: Record<string, unknown> = {
      wordCount: nextWordCount,
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (patch.title !== undefined) payload.title = patch.title.trim() || 'Untitled Note';
    if (patch.content !== undefined) payload.content = patch.content;
    if (patch.folderId !== undefined) {
      payload.folderId = patch.folderId ? patch.folderId : deleteField();
    }
    if (patch.tags !== undefined) payload.tags = patch.tags;
    if (patch.pinned !== undefined) payload.pinned = patch.pinned;

    try {
      await updateDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  }

  async togglePinOrFolder(
    uid: string,
    current: NoteItem,
    patch: { pinned?: boolean; folderId?: string | null }
  ): Promise<void> {
    const docPath = `users/${uid}/notes/${current.id}`;
    const payload: Record<string, unknown> = {
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (patch.pinned !== undefined) payload.pinned = patch.pinned;
    if (patch.folderId !== undefined) {
      payload.folderId = patch.folderId ? patch.folderId : deleteField();
    }
    try {
      await updateDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  }

  async setNoteEncryptionState(
    uid: string,
    current: NoteItem,
    next: { content: string; isEncrypted: boolean; isLocked: boolean; wordCount: number }
  ): Promise<void> {
    const docPath = `users/${uid}/notes/${current.id}`;
    try {
      await updateDoc(doc(db, docPath), {
        content: next.content,
        isEncrypted: next.isEncrypted,
        isLocked: next.isEncrypted ? true : next.isLocked,
        wordCount: next.wordCount,
        version: current.version + 1,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  }

  async deleteNote(uid: string, note: NoteItem): Promise<void> {
    const docPath = `users/${uid}/notes/${note.id}`;
    try {
      await deleteDoc(doc(db, docPath));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  }

  async restoreNote(uid: string, note: NoteItem): Promise<void> {
    const docPath = `users/${uid}/notes/${note.id}`;
    const payload: Record<string, unknown> = {
      uid,
      title: note.title,
      content: note.content,
      isEncrypted: note.isEncrypted,
      isLocked: note.isEncrypted ? true : note.isLocked,
      pinned: note.pinned,
      wordCount: note.wordCount,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (note.folderId) payload.folderId = note.folderId;
    if (note.tags && note.tags.length > 0) payload.tags = note.tags;
    try {
      await setDoc(doc(db, docPath), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    }
  }

  async listVersions(uid: string, noteId: string): Promise<NoteVersion[]> {
    const colPath = `users/${uid}/notes/${noteId}/versions`;
    try {
      const q = query(collection(db, colPath), where('uid', '==', uid));
      const snap = await getDocs(q);
      const list: NoteVersion[] = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          uid: String(raw.uid ?? uid),
          noteId: String(raw.noteId ?? noteId),
          title: String(raw.title ?? 'Snapshot'),
          content: String(raw.content ?? ''),
          isEncrypted: Boolean(raw.isEncrypted),
          versionNumber: Number(raw.versionNumber ?? 1),
          createdAtIso: timestampToIso(raw.createdAt) ?? new Date().toISOString(),
        };
      });
      return list.sort((a, b) => b.versionNumber - a.versionNumber);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colPath);
    }
  }
}

export class LocalOfflineNotesRepository implements NotesRepository {
  private folderListeners = new Set<(folders: NoteFolder[]) => void>();
  private noteListeners = new Set<(notes: NoteItem[]) => void>();

  private loadFolders(): NoteFolder[] {
    try {
      const raw = localStorage.getItem(LOCAL_FOLDERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sortBySortKey(parsed as NoteFolder[]) : [];
    } catch {
      return [];
    }
  }

  private saveFolders(items: NoteFolder[]): void {
    const sorted = sortBySortKey(items);
    try {
      localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(sorted));
    } catch {
      // ignore
    }
    this.folderListeners.forEach((cb) => cb(sorted));
  }

  private loadNotes(): NoteItem[] {
    try {
      const raw = localStorage.getItem(LOCAL_NOTES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sortNotesList(parsed as NoteItem[]) : [];
    } catch {
      return [];
    }
  }

  private saveNotes(items: NoteItem[]): void {
    const sorted = sortNotesList(items);
    try {
      localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(sorted));
    } catch {
      // ignore
    }
    this.noteListeners.forEach((cb) => cb(sorted));
  }

  private loadVersionsMap(): Record<string, NoteVersion[]> {
    try {
      const raw = localStorage.getItem(LOCAL_VERSIONS_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, NoteVersion[]>;
    } catch {
      return {};
    }
  }

  private saveVersionsMap(map: Record<string, NoteVersion[]>): void {
    try {
      localStorage.setItem(LOCAL_VERSIONS_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  subscribeFolders(_uid: string, onData: (folders: NoteFolder[]) => void): () => void {
    this.folderListeners.add(onData);
    onData(this.loadFolders());
    return () => {
      this.folderListeners.delete(onData);
    };
  }

  async createFolder(
    uid: string,
    rawInput: CreateFolderInput,
    sortKey: string
  ): Promise<NoteFolder> {
    const input = CreateFolderInputSchema.parse(rawInput);
    const nowIso = new Date().toISOString();
    const record: NoteFolder = {
      id: generateSafeId('fld'),
      uid: uid || 'local',
      name: input.name,
      parentId: input.parentId,
      sortKey,
      isLockedFolder: input.isLockedFolder,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
    this.saveFolders([...this.loadFolders(), record]);
    return record;
  }

  async deleteFolder(_uid: string, folderId: string): Promise<void> {
    // Reparent any child folders to root and unfile notes inside deleted folder
    const nextFolders = this.loadFolders()
      .filter((f) => f.id !== folderId)
      .map((f) => (f.parentId === folderId ? { ...f, parentId: undefined } : f));
    this.saveFolders(nextFolders);

    const nextNotes = this.loadNotes().map((n) =>
      n.folderId === folderId ? { ...n, folderId: undefined } : n
    );
    this.saveNotes(nextNotes);
  }

  subscribeNotes(_uid: string, onData: (notes: NoteItem[]) => void): () => void {
    this.noteListeners.add(onData);
    onData(this.loadNotes());
    return () => {
      this.noteListeners.delete(onData);
    };
  }

  async createNote(uid: string, rawInput: CreateNoteInput): Promise<NoteItem> {
    const input = CreateNoteInputSchema.parse(rawInput);
    const nowIso = new Date().toISOString();
    const record: NoteItem = {
      id: generateSafeId('nte'),
      uid: uid || 'local',
      folderId: input.folderId,
      title: input.title,
      content: input.content,
      tags: input.tags,
      isEncrypted: input.isEncrypted,
      isLocked: input.isEncrypted ? true : input.isLocked,
      pinned: input.pinned,
      wordCount: input.isEncrypted ? 0 : countMarkdownWords(input.content),
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
    this.saveNotes([...this.loadNotes(), record]);
    return record;
  }

  async updateNoteContent(
    uid: string,
    current: NoteItem,
    patch: {
      title?: string;
      content?: string;
      folderId?: string | null;
      tags?: string[];
      pinned?: boolean;
      wordCount?: number;
    },
    saveVersionSnapshot = true
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    if (saveVersionSnapshot && (patch.content !== current.content || patch.title !== current.title)) {
      const map = this.loadVersionsMap();
      const existingList = map[current.id] ?? [];
      const snap: NoteVersion = {
        id: generateSafeId('ver'),
        uid: uid || 'local',
        noteId: current.id,
        title: current.title,
        content: current.content,
        isEncrypted: current.isEncrypted,
        versionNumber: current.version,
        createdAtIso: current.updatedAtIso ?? nowIso,
      };
      map[current.id] = [snap, ...existingList].slice(0, 25);
      this.saveVersionsMap(map);
    }

    const nextContent = patch.content !== undefined ? patch.content : current.content;
    const nextWordCount =
      patch.wordCount !== undefined
        ? patch.wordCount
        : current.isEncrypted
          ? 0
          : countMarkdownWords(nextContent);

    const list = this.loadNotes().map((n) => {
      if (n.id !== current.id) return n;
      return {
        ...n,
        title: patch.title !== undefined ? (patch.title.trim() || 'Untitled Note') : n.title,
        content: nextContent,
        folderId: patch.folderId === null ? undefined : (patch.folderId ?? n.folderId),
        tags: patch.tags !== undefined ? patch.tags : n.tags,
        pinned: patch.pinned !== undefined ? patch.pinned : n.pinned,
        wordCount: nextWordCount,
        version: n.version + 1,
        updatedAtIso: nowIso,
      };
    });
    this.saveNotes(list);
  }

  async togglePinOrFolder(
    _uid: string,
    current: NoteItem,
    patch: { pinned?: boolean; folderId?: string | null }
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const list = this.loadNotes().map((n) => {
      if (n.id !== current.id) return n;
      return {
        ...n,
        pinned: patch.pinned !== undefined ? patch.pinned : n.pinned,
        folderId: patch.folderId === null ? undefined : (patch.folderId ?? n.folderId),
        version: n.version + 1,
        updatedAtIso: nowIso,
      };
    });
    this.saveNotes(list);
  }

  async setNoteEncryptionState(
    _uid: string,
    current: NoteItem,
    next: { content: string; isEncrypted: boolean; isLocked: boolean; wordCount: number }
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const list = this.loadNotes().map((n) => {
      if (n.id !== current.id) return n;
      return {
        ...n,
        content: next.content,
        isEncrypted: next.isEncrypted,
        isLocked: next.isEncrypted ? true : next.isLocked,
        wordCount: next.wordCount,
        version: n.version + 1,
        updatedAtIso: nowIso,
      };
    });
    this.saveNotes(list);
  }

  async deleteNote(_uid: string, note: NoteItem): Promise<void> {
    this.saveNotes(this.loadNotes().filter((n) => n.id !== note.id));
  }

  async restoreNote(_uid: string, note: NoteItem): Promise<void> {
    const filtered = this.loadNotes().filter((n) => n.id !== note.id);
    this.saveNotes([...filtered, note]);
  }

  async listVersions(_uid: string, noteId: string): Promise<NoteVersion[]> {
    const map = this.loadVersionsMap();
    return (map[noteId] ?? []).sort((a, b) => b.versionNumber - a.versionNumber);
  }
}

export const firebaseNotesRepository = new FirebaseWebNotesRepository();
export const localNotesRepository = new LocalOfflineNotesRepository();

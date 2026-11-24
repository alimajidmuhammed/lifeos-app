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
  CreateVaultDocumentInputSchema,
  CreateVaultFolderInputSchema,
  type CreateVaultDocumentInput,
  type CreateVaultFolderInput,
  type VaultDocType,
  type VaultDocumentMeta,
  type VaultFolder,
  type VaultStorageMode,
} from '../../core/vault/vaultSchemas';
import { sortBySortKey } from '../../core/planner/fractionalIndex';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseClient';
import type { VaultRepository } from './interfaces';

const LOCAL_VAULT_FOLDERS_KEY = 'lifeos_local_vault_folders_v1';
const LOCAL_VAULT_DOCS_KEY = 'lifeos_local_vault_docs_v1';

function generateSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function tsToIso(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

function sortDocsDefault(docs: VaultDocumentMeta[]): VaultDocumentMeta[] {
  return [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export class FirebaseWebVaultRepository implements VaultRepository {
  subscribeFolders(
    uid: string,
    onData: (folders: VaultFolder[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/vaultFolders`;
    const q = query(collection(db, path), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const list: VaultFolder[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            uid: String(data.uid ?? uid),
            name: String(data.name ?? 'Folder'),
            parentId: typeof data.parentId === 'string' ? data.parentId : undefined,
            sortKey: String(data.sortKey ?? 'V'),
            isLockedFolder: Boolean(data.isLockedFolder),
            version: Number(data.version ?? 1),
            createdAt: tsToIso(data.createdAt),
            updatedAt: tsToIso(data.updatedAt),
          };
        });
        onData(sortBySortKey(list));
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
  }

  async createFolder(
    uid: string,
    input: CreateVaultFolderInput,
    sortKey: string
  ): Promise<VaultFolder> {
    const parsed = CreateVaultFolderInputSchema.parse(input);
    const id = generateSafeId('vfold');
    const path = `users/${uid}/vaultFolders/${id}`;
    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      uid,
      name: parsed.name.slice(0, 80),
      sortKey: sortKey.slice(0, 64),
      isLockedFolder: parsed.isLockedFolder,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (parsed.parentId && parsed.parentId !== id) {
      payload.parentId = parsed.parentId;
    }

    try {
      await setDoc(doc(db, path), payload);
      return {
        id,
        uid,
        name: parsed.name.slice(0, 80),
        parentId: parsed.parentId && parsed.parentId !== id ? parsed.parentId : undefined,
        sortKey: sortKey.slice(0, 64),
        isLockedFolder: parsed.isLockedFolder,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  async deleteFolder(uid: string, folderId: string): Promise<void> {
    const path = `users/${uid}/vaultFolders/${folderId}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  subscribeDocuments(
    uid: string,
    onData: (docs: VaultDocumentMeta[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/documents`;
    const q = query(collection(db, path), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const list: VaultDocumentMeta[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            uid: String(data.uid ?? uid),
            folderId: typeof data.folderId === 'string' ? data.folderId : undefined,
            title: String(data.title ?? 'Untitled Document'),
            docType: (data.docType as VaultDocType) ?? 'other',
            storageMode: (data.storageMode as VaultStorageMode) ?? 'local_only',
            mimeType: String(data.mimeType ?? 'application/octet-stream'),
            sizeBytes: Number(data.sizeBytes ?? 0),
            pageCount: Math.max(1, Number(data.pageCount ?? 1)),
            expiryDate: typeof data.expiryDate === 'string' ? data.expiryDate : undefined,
            issuer: typeof data.issuer === 'string' ? data.issuer : undefined,
            documentNumberLast4: typeof data.documentNumberLast4 === 'string' ? data.documentNumberLast4 : undefined,
            tags: Array.isArray(data.tags) ? data.tags.map(String).slice(0, 10) : [],
            notes: typeof data.notes === 'string' ? data.notes : undefined,
            ocrText: typeof data.ocrText === 'string' ? data.ocrText : undefined,
            isEncrypted: Boolean(data.isEncrypted),
            isLocked: Boolean(data.isLocked || data.isEncrypted),
            localFileKey: typeof data.localFileKey === 'string' ? data.localFileKey : undefined,
            linkedReminderId: typeof data.linkedReminderId === 'string' ? data.linkedReminderId : undefined,
            version: Number(data.version ?? 1),
            createdAt: tsToIso(data.createdAt),
            updatedAt: tsToIso(data.updatedAt),
          };
        });
        onData(sortDocsDefault(list));
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
  }

  async createDocument(
    uid: string,
    input: CreateVaultDocumentInput
  ): Promise<VaultDocumentMeta> {
    const parsed = CreateVaultDocumentInputSchema.parse(input);
    const id = generateSafeId('vdoc');
    const path = `users/${uid}/documents/${id}`;
    const nowIso = new Date().toISOString();
    const isEncrypted = Boolean(parsed.isEncrypted);
    const isLocked = isEncrypted ? true : Boolean(parsed.isLocked);

    const payload: Record<string, unknown> = {
      uid,
      title: parsed.title.slice(0, 200),
      docType: parsed.docType,
      storageMode: parsed.storageMode,
      mimeType: parsed.mimeType.slice(0, 100),
      sizeBytes: Math.max(0, Math.min(52428800, Math.round(parsed.sizeBytes))),
      pageCount: Math.max(1, Math.min(100, Math.round(parsed.pageCount))),
      isEncrypted,
      isLocked,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (parsed.folderId) payload.folderId = parsed.folderId;
    if (parsed.expiryDate) payload.expiryDate = parsed.expiryDate;
    if (parsed.issuer) payload.issuer = parsed.issuer.slice(0, 120);
    if (parsed.documentNumberLast4) payload.documentNumberLast4 = parsed.documentNumberLast4.slice(0, 16);
    if (parsed.tags.length > 0) payload.tags = parsed.tags.slice(0, 10);
    if (parsed.notes) payload.notes = parsed.notes.slice(0, 2000);
    if (parsed.ocrText) payload.ocrText = parsed.ocrText.slice(0, 20000);
    if (parsed.localFileKey) payload.localFileKey = parsed.localFileKey;
    if (parsed.linkedReminderId) payload.linkedReminderId = parsed.linkedReminderId;

    try {
      await setDoc(doc(db, path), payload);
      return {
        id,
        uid,
        folderId: parsed.folderId,
        title: parsed.title.slice(0, 200),
        docType: parsed.docType,
        storageMode: parsed.storageMode,
        mimeType: parsed.mimeType.slice(0, 100),
        sizeBytes: Math.max(0, Math.min(52428800, Math.round(parsed.sizeBytes))),
        pageCount: Math.max(1, Math.min(100, Math.round(parsed.pageCount))),
        expiryDate: parsed.expiryDate,
        issuer: parsed.issuer,
        documentNumberLast4: parsed.documentNumberLast4,
        tags: parsed.tags.slice(0, 10),
        notes: parsed.notes,
        ocrText: parsed.ocrText,
        isEncrypted,
        isLocked,
        localFileKey: parsed.localFileKey,
        linkedReminderId: parsed.linkedReminderId,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  async updateDocumentMeta(
    uid: string,
    current: VaultDocumentMeta,
    patch: {
      folderId?: string | null;
      title?: string;
      docType?: VaultDocType;
      expiryDate?: string | null;
      issuer?: string | null;
      documentNumberLast4?: string | null;
      tags?: string[];
      notes?: string | null;
      ocrText?: string | null;
      linkedReminderId?: string | null;
    }
  ): Promise<void> {
    const path = `users/${uid}/documents/${current.id}`;
    const updates: Record<string, unknown> = {
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (patch.folderId !== undefined) updates.folderId = patch.folderId ? patch.folderId : deleteField();
    if (patch.title !== undefined) updates.title = patch.title.trim().slice(0, 200) || current.title;
    if (patch.docType !== undefined) updates.docType = patch.docType;
    if (patch.expiryDate !== undefined) updates.expiryDate = patch.expiryDate ? patch.expiryDate : deleteField();
    if (patch.issuer !== undefined) updates.issuer = patch.issuer?.trim() ? patch.issuer.trim().slice(0, 120) : deleteField();
    if (patch.documentNumberLast4 !== undefined) {
      updates.documentNumberLast4 = patch.documentNumberLast4?.trim()
        ? patch.documentNumberLast4.trim().slice(0, 16)
        : deleteField();
    }
    if (patch.tags !== undefined) updates.tags = patch.tags.slice(0, 10);
    if (patch.notes !== undefined) updates.notes = patch.notes?.trim() ? patch.notes.slice(0, 2000) : deleteField();
    if (patch.ocrText !== undefined) updates.ocrText = patch.ocrText?.trim() ? patch.ocrText.slice(0, 20000) : deleteField();
    if (patch.linkedReminderId !== undefined) {
      updates.linkedReminderId = patch.linkedReminderId ? patch.linkedReminderId : deleteField();
    }

    try {
      await updateDoc(doc(db, path), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async setDocumentSecurityState(
    uid: string,
    current: VaultDocumentMeta,
    next: {
      storageMode: VaultStorageMode;
      isEncrypted: boolean;
      isLocked: boolean;
      sizeBytes: number;
      mimeType: string;
      pageCount: number;
      localFileKey?: string;
    }
  ): Promise<void> {
    const path = `users/${uid}/documents/${current.id}`;
    const updates: Record<string, unknown> = {
      storageMode: next.storageMode,
      isEncrypted: next.isEncrypted,
      isLocked: next.isEncrypted ? true : next.isLocked,
      sizeBytes: Math.max(0, Math.min(52428800, Math.round(next.sizeBytes))),
      mimeType: next.mimeType.slice(0, 100),
      pageCount: Math.max(1, Math.min(100, Math.round(next.pageCount))),
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (next.localFileKey !== undefined) updates.localFileKey = next.localFileKey;

    try {
      await updateDoc(doc(db, path), updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async deleteDocument(uid: string, document: VaultDocumentMeta): Promise<void> {
    const path = `users/${uid}/documents/${document.id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async restoreDocument(uid: string, document: VaultDocumentMeta): Promise<void> {
    const path = `users/${uid}/documents/${document.id}`;
    const payload: Record<string, unknown> = {
      uid,
      title: document.title.slice(0, 200),
      docType: document.docType,
      storageMode: document.storageMode,
      mimeType: document.mimeType.slice(0, 100),
      sizeBytes: document.sizeBytes,
      pageCount: document.pageCount,
      isEncrypted: document.isEncrypted,
      isLocked: document.isEncrypted ? true : document.isLocked,
      version: Math.max(1, document.version),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (document.folderId) payload.folderId = document.folderId;
    if (document.expiryDate) payload.expiryDate = document.expiryDate;
    if (document.issuer) payload.issuer = document.issuer;
    if (document.documentNumberLast4) payload.documentNumberLast4 = document.documentNumberLast4;
    if (document.tags.length > 0) payload.tags = document.tags.slice(0, 10);
    if (document.notes) payload.notes = document.notes;
    if (document.ocrText) payload.ocrText = document.ocrText;
    if (document.localFileKey) payload.localFileKey = document.localFileKey;
    if (document.linkedReminderId) payload.linkedReminderId = document.linkedReminderId;

    try {
      await setDoc(doc(db, path), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }
}

export class LocalOfflineVaultRepository implements VaultRepository {
  private folderListeners = new Set<(folders: VaultFolder[]) => void>();
  private docListeners = new Set<(docs: VaultDocumentMeta[]) => void>();

  private readFolders(): VaultFolder[] {
    try {
      const raw = localStorage.getItem(LOCAL_VAULT_FOLDERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sortBySortKey(parsed as VaultFolder[]) : [];
    } catch {
      return [];
    }
  }

  private writeFolders(list: VaultFolder[]): void {
    const sorted = sortBySortKey(list);
    try {
      localStorage.setItem(LOCAL_VAULT_FOLDERS_KEY, JSON.stringify(sorted));
    } catch {
      // ignore storage quota errors
    }
    this.folderListeners.forEach((cb) => cb(sorted));
  }

  private readDocs(): VaultDocumentMeta[] {
    try {
      const raw = localStorage.getItem(LOCAL_VAULT_DOCS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sortDocsDefault(parsed as VaultDocumentMeta[]) : [];
    } catch {
      return [];
    }
  }

  private writeDocs(list: VaultDocumentMeta[]): void {
    const sorted = sortDocsDefault(list);
    try {
      localStorage.setItem(LOCAL_VAULT_DOCS_KEY, JSON.stringify(sorted));
    } catch {
      // ignore storage quota errors
    }
    this.docListeners.forEach((cb) => cb(sorted));
  }

  subscribeFolders(_uid: string, onData: (folders: VaultFolder[]) => void): () => void {
    this.folderListeners.add(onData);
    onData(this.readFolders());
    return () => {
      this.folderListeners.delete(onData);
    };
  }

  async createFolder(
    uid: string,
    input: CreateVaultFolderInput,
    sortKey: string
  ): Promise<VaultFolder> {
    const parsed = CreateVaultFolderInputSchema.parse(input);
    const id = generateSafeId('vfold');
    const now = new Date().toISOString();
    const folder: VaultFolder = {
      id,
      uid,
      name: parsed.name.slice(0, 80),
      parentId: parsed.parentId && parsed.parentId !== id ? parsed.parentId : undefined,
      sortKey,
      isLockedFolder: parsed.isLockedFolder,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.writeFolders([...this.readFolders(), folder]);
    return folder;
  }

  async deleteFolder(_uid: string, folderId: string): Promise<void> {
    this.writeFolders(this.readFolders().filter((f) => f.id !== folderId));
  }

  subscribeDocuments(_uid: string, onData: (docs: VaultDocumentMeta[]) => void): () => void {
    this.docListeners.add(onData);
    onData(this.readDocs());
    return () => {
      this.docListeners.delete(onData);
    };
  }

  async createDocument(
    uid: string,
    input: CreateVaultDocumentInput
  ): Promise<VaultDocumentMeta> {
    const parsed = CreateVaultDocumentInputSchema.parse(input);
    const id = generateSafeId('vdoc');
    const now = new Date().toISOString();
    const isEncrypted = Boolean(parsed.isEncrypted);
    const record: VaultDocumentMeta = {
      id,
      uid,
      folderId: parsed.folderId,
      title: parsed.title.slice(0, 200),
      docType: parsed.docType,
      storageMode: parsed.storageMode,
      mimeType: parsed.mimeType.slice(0, 100),
      sizeBytes: parsed.sizeBytes,
      pageCount: parsed.pageCount,
      expiryDate: parsed.expiryDate,
      issuer: parsed.issuer,
      documentNumberLast4: parsed.documentNumberLast4,
      tags: parsed.tags.slice(0, 10),
      notes: parsed.notes,
      ocrText: parsed.ocrText,
      isEncrypted,
      isLocked: isEncrypted ? true : Boolean(parsed.isLocked),
      localFileKey: parsed.localFileKey,
      linkedReminderId: parsed.linkedReminderId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.writeDocs([record, ...this.readDocs()]);
    return record;
  }

  async updateDocumentMeta(
    _uid: string,
    current: VaultDocumentMeta,
    patch: {
      folderId?: string | null;
      title?: string;
      docType?: VaultDocType;
      expiryDate?: string | null;
      issuer?: string | null;
      documentNumberLast4?: string | null;
      tags?: string[];
      notes?: string | null;
      ocrText?: string | null;
      linkedReminderId?: string | null;
    }
  ): Promise<void> {
    const list = this.readDocs();
    const idx = list.findIndex((d) => d.id === current.id);
    if (idx === -1) return;
    const prev = list[idx];
    list[idx] = {
      ...prev,
      folderId: patch.folderId !== undefined ? (patch.folderId ?? undefined) : prev.folderId,
      title: patch.title !== undefined ? patch.title.trim().slice(0, 200) || prev.title : prev.title,
      docType: patch.docType !== undefined ? patch.docType : prev.docType,
      expiryDate: patch.expiryDate !== undefined ? (patch.expiryDate ?? undefined) : prev.expiryDate,
      issuer: patch.issuer !== undefined ? (patch.issuer?.trim() || undefined) : prev.issuer,
      documentNumberLast4:
        patch.documentNumberLast4 !== undefined
          ? (patch.documentNumberLast4?.trim() || undefined)
          : prev.documentNumberLast4,
      tags: patch.tags !== undefined ? patch.tags.slice(0, 10) : prev.tags,
      notes: patch.notes !== undefined ? (patch.notes?.trim() || undefined) : prev.notes,
      ocrText: patch.ocrText !== undefined ? (patch.ocrText?.trim() || undefined) : prev.ocrText,
      linkedReminderId:
        patch.linkedReminderId !== undefined ? (patch.linkedReminderId ?? undefined) : prev.linkedReminderId,
      version: prev.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.writeDocs(list);
  }

  async setDocumentSecurityState(
    _uid: string,
    current: VaultDocumentMeta,
    next: {
      storageMode: VaultStorageMode;
      isEncrypted: boolean;
      isLocked: boolean;
      sizeBytes: number;
      mimeType: string;
      pageCount: number;
      localFileKey?: string;
    }
  ): Promise<void> {
    const list = this.readDocs();
    const idx = list.findIndex((d) => d.id === current.id);
    if (idx === -1) return;
    list[idx] = {
      ...list[idx],
      storageMode: next.storageMode,
      isEncrypted: next.isEncrypted,
      isLocked: next.isEncrypted ? true : next.isLocked,
      sizeBytes: next.sizeBytes,
      mimeType: next.mimeType,
      pageCount: next.pageCount,
      localFileKey: next.localFileKey !== undefined ? next.localFileKey : list[idx].localFileKey,
      version: list[idx].version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.writeDocs(list);
  }

  async deleteDocument(_uid: string, document: VaultDocumentMeta): Promise<void> {
    this.writeDocs(this.readDocs().filter((d) => d.id !== document.id));
  }

  async restoreDocument(_uid: string, document: VaultDocumentMeta): Promise<void> {
    const list = this.readDocs().filter((d) => d.id !== document.id);
    this.writeDocs([document, ...list]);
  }
}

export const firebaseVaultRepository = new FirebaseWebVaultRepository();
export const localVaultRepository = new LocalOfflineVaultRepository();

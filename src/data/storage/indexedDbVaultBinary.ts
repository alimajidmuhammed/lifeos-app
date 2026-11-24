/**
 * Local-Only Document Vault Binary Storage Adapter (IndexedDB on Web).
 * Keeps Stage 0 strictly on the Firebase Spark Free Tier ($0 billing risk)
 * while isolating binary persistence behind a clean adapter interface so
 * native builds (expo-file-system) or future Cloud Storage (Blaze) drop in cleanly.
 */
import type { EncryptedBinaryEnvelope } from '../../core/crypto/e2eCrypto';

export interface StoredVaultBinaryRecord {
  key: string;
  mimeType: string;
  isEncrypted: boolean;
  savedAt: string;
  // Plain binary when isEncrypted === false
  rawBytes?: Uint8Array;
  // Authenticated AES-256-GCM envelope when isEncrypted === true
  encrypted?: EncryptedBinaryEnvelope;
}

export interface VaultBinaryStorageAdapter {
  saveBinary(record: StoredVaultBinaryRecord): Promise<void>;
  getBinary(key: string): Promise<StoredVaultBinaryRecord | null>;
  deleteBinary(key: string): Promise<void>;
}

const DB_NAME = 'lifeos_vault_blobs_v1';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;

class IndexedDBVaultBinaryAdapter implements VaultBinaryStorageAdapter {
  private memoryFallback = new Map<string, StoredVaultBinaryRecord>();

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async saveBinary(record: StoredVaultBinaryRecord): Promise<void> {
    this.memoryFallback.set(record.key, record);
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to store vault binary locally.'));
    });
  }

  async getBinary(key: string): Promise<StoredVaultBinaryRecord | null> {
    const db = await this.openDb();
    if (!db) return this.memoryFallback.get(key) ?? null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => {
          const res = req.result as StoredVaultBinaryRecord | undefined;
          resolve(res ?? this.memoryFallback.get(key) ?? null);
        };
        req.onerror = () => resolve(this.memoryFallback.get(key) ?? null);
      } catch {
        resolve(this.memoryFallback.get(key) ?? null);
      }
    });
  }

  async deleteBinary(key: string): Promise<void> {
    this.memoryFallback.delete(key);
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export const localVaultBinaryStorage: VaultBinaryStorageAdapter = new IndexedDBVaultBinaryAdapter();

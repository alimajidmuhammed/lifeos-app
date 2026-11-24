import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bootstrapE2EVault,
  decryptBytes,
  deriveAesKeyFromSecret,
  encryptBytes,
  verifyE2EPassphrase,
} from '../core/crypto/e2eCrypto';
import { getTodayDayKey } from '../core/entitlements/entitlements';
import { generateSortKeyBetween } from '../core/planner/fractionalIndex';
import { computeVaultSummary } from '../core/vault/expiryEngine';
import {
  buildVaultFolderTree,
  flattenVaultFolderTree,
  type CreateVaultDocumentInput,
  type CreateVaultFolderInput,
  type VaultDocType,
  type VaultDocumentMeta,
  type VaultFolder,
} from '../core/vault/vaultSchemas';
import { userProfileRepository } from '../data/repositories/firebaseWebAdapter';
import {
  firebaseVaultRepository,
  localVaultRepository,
} from '../data/repositories/vaultRepository';
import { localVaultBinaryStorage } from '../data/storage/indexedDbVaultBinary';
import { useUIStore } from '../state/useUIStore';

function generateLocalBlobKey(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 14);
  return `vblob_${Date.now().toString(36)}_${rand}`;
}

export function useVault() {
  const authUser = useUIStore((s) => s.authUser);
  const authReady = useUIStore((s) => s.authReady);
  const profile = useUIStore((s) => s.profile);
  const setProfile = useUIStore((s) => s.setProfile);
  const isAppLocked = useUIStore((s) => s.isAppLocked);

  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [documents, setDocuments] = useState<VaultDocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Session-only in-memory AES-256-GCM CryptoKey (NEVER stored on disk or Firestore)
  const sessionKeyRef = useRef<CryptoKey | null>(null);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);

  const isCloud = Boolean(authUser?.uid);
  const uid = authUser?.uid ?? 'local';
  const repo = isCloud ? firebaseVaultRepository : localVaultRepository;

  // Wipe session E2E key immediately when app PIN lock engages
  useEffect(() => {
    if (isAppLocked) {
      sessionKeyRef.current = null;
      setVaultUnlocked(false);
    }
  }, [isAppLocked]);

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    setError(null);
    let foldersReady = false;
    let docsReady = false;
    const checkDone = () => {
      if (foldersReady && docsReady) setLoading(false);
    };

    const unsubFolders = repo.subscribeFolders(
      uid,
      (list) => {
        setFolders(list);
        foldersReady = true;
        checkDone();
      },
      (err) => {
        setError(err.message);
        foldersReady = true;
        checkDone();
      }
    );

    const unsubDocs = repo.subscribeDocuments(
      uid,
      (list) => {
        setDocuments(list);
        docsReady = true;
        checkDone();
      },
      (err) => {
        setError(err.message);
        docsReady = true;
        checkDone();
      }
    );

    return () => {
      unsubFolders();
      unsubDocs();
    };
  }, [authReady, uid, repo]);

  const folderTree = useMemo(() => buildVaultFolderTree(folders), [folders]);
  const flatFolders = useMemo(() => flattenVaultFolderTree(folderTree), [folderTree]);

  const todayYmd = getTodayDayKey();
  const summary = useMemo(() => computeVaultSummary(documents, todayYmd), [documents, todayYmd]);

  const initializeE2EVault = useCallback(
    async (passphrase: string): Promise<string> => {
      const boot = await bootstrapE2EVault(passphrase);
      const key = await deriveAesKeyFromSecret(passphrase, boot.salt);
      sessionKeyRef.current = key;
      setVaultUnlocked(true);

      const nextProfile = {
        ...profile,
        e2eConfigured: true,
        e2eSalt: boot.salt,
        e2eVerifier: boot.verifier,
      };
      setProfile(nextProfile);
      if (authUser) {
        await userProfileRepository.updateProfile(authUser.uid, profile, {
          e2eConfigured: true,
          e2eSalt: boot.salt,
          e2eVerifier: boot.verifier,
        });
      }
      return boot.recoveryKey;
    },
    [authUser, profile, setProfile]
  );

  const unlockE2ESession = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!profile.e2eConfigured || !profile.e2eSalt || !profile.e2eVerifier) return false;
      const valid = await verifyE2EPassphrase(passphrase, profile.e2eSalt, profile.e2eVerifier);
      if (!valid) return false;
      const key = await deriveAesKeyFromSecret(passphrase, profile.e2eSalt);
      sessionKeyRef.current = key;
      setVaultUnlocked(true);
      return true;
    },
    [profile.e2eConfigured, profile.e2eSalt, profile.e2eVerifier]
  );

  const lockE2ESession = useCallback(() => {
    sessionKeyRef.current = null;
    setVaultUnlocked(false);
  }, []);

  const createFolder = useCallback(
    async (input: CreateVaultFolderInput) => {
      const siblings = folders.filter((f) => (f.parentId ?? null) === (input.parentId ?? null));
      const lastKey = siblings.length > 0 ? siblings[siblings.length - 1].sortKey : null;
      const sortKey = generateSortKeyBetween(lastKey, null);
      return repo.createFolder(uid, input, sortKey);
    },
    [folders, repo, uid]
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const inFolder = documents.filter((d) => d.folderId === folderId);
      await Promise.all(
        inFolder.map((d) => repo.updateDocumentMeta(uid, d, { folderId: null }))
      );
      await repo.deleteFolder(uid, folderId);
    },
    [documents, repo, uid]
  );

  const createDocumentWithBinary = useCallback(
    async (
      input: Omit<CreateVaultDocumentInput, 'localFileKey' | 'sizeBytes'>,
      plainBytes: Uint8Array
    ): Promise<VaultDocumentMeta> => {
      const localFileKey = generateLocalBlobKey();
      const wantEncrypted = Boolean(input.isEncrypted);

      if (wantEncrypted) {
        if (!sessionKeyRef.current) {
          throw new Error('Unlock your E2E Vault session before saving an encrypted document.');
        }
        const encrypted = await encryptBytes(plainBytes, input.mimeType, sessionKeyRef.current);
        await localVaultBinaryStorage.saveBinary({
          key: localFileKey,
          mimeType: input.mimeType,
          isEncrypted: true,
          savedAt: new Date().toISOString(),
          encrypted,
        });
      } else {
        await localVaultBinaryStorage.saveBinary({
          key: localFileKey,
          mimeType: input.mimeType,
          isEncrypted: false,
          savedAt: new Date().toISOString(),
          rawBytes: plainBytes,
        });
      }

      return repo.createDocument(uid, {
        ...input,
        sizeBytes: plainBytes.byteLength,
        isEncrypted: wantEncrypted,
        isLocked: wantEncrypted ? true : Boolean(input.isLocked),
        localFileKey,
      });
    },
    [repo, uid]
  );

  const loadDocumentBytes = useCallback(
    async (doc: VaultDocumentMeta): Promise<{ bytes: Uint8Array; mimeType: string } | null> => {
      if (!doc.localFileKey) return null;
      const stored = await localVaultBinaryStorage.getBinary(doc.localFileKey);
      if (!stored) return null;

      if (stored.isEncrypted && stored.encrypted) {
        if (!sessionKeyRef.current) return null;
        const plain = await decryptBytes(stored.encrypted, sessionKeyRef.current);
        return { bytes: plain, mimeType: stored.encrypted.mimeType || doc.mimeType };
      }

      if (stored.rawBytes) {
        return { bytes: stored.rawBytes, mimeType: stored.mimeType || doc.mimeType };
      }
      return null;
    },
    []
  );

  const encryptExistingDocument = useCallback(
    async (doc: VaultDocumentMeta): Promise<void> => {
      if (!sessionKeyRef.current) {
        throw new Error('Unlock your E2E Vault session first.');
      }
      if (!doc.localFileKey) {
        throw new Error('No local binary file attached to this document.');
      }
      const stored = await localVaultBinaryStorage.getBinary(doc.localFileKey);
      if (!stored || !stored.rawBytes) {
        throw new Error('Local document binary is missing on this device.');
      }
      const encrypted = await encryptBytes(stored.rawBytes, stored.mimeType || doc.mimeType, sessionKeyRef.current);
      await localVaultBinaryStorage.saveBinary({
        key: doc.localFileKey,
        mimeType: doc.mimeType,
        isEncrypted: true,
        savedAt: new Date().toISOString(),
        encrypted,
      });
      await repo.setDocumentSecurityState(uid, doc, {
        storageMode: doc.storageMode,
        isEncrypted: true,
        isLocked: true,
        sizeBytes: doc.sizeBytes,
        mimeType: doc.mimeType,
        pageCount: doc.pageCount,
        localFileKey: doc.localFileKey,
      });
    },
    [repo, uid]
  );

  const decryptExistingDocument = useCallback(
    async (doc: VaultDocumentMeta): Promise<void> => {
      if (!sessionKeyRef.current) {
        throw new Error('Unlock your E2E Vault session first.');
      }
      if (!doc.localFileKey) {
        throw new Error('No local binary file attached to this document.');
      }
      const stored = await localVaultBinaryStorage.getBinary(doc.localFileKey);
      if (!stored || !stored.encrypted) {
        throw new Error('Encrypted binary payload is missing on this device.');
      }
      const plainBytes = await decryptBytes(stored.encrypted, sessionKeyRef.current);
      await localVaultBinaryStorage.saveBinary({
        key: doc.localFileKey,
        mimeType: doc.mimeType,
        isEncrypted: false,
        savedAt: new Date().toISOString(),
        rawBytes: plainBytes,
      });
      await repo.setDocumentSecurityState(uid, doc, {
        storageMode: doc.storageMode,
        isEncrypted: false,
        isLocked: false,
        sizeBytes: plainBytes.byteLength,
        mimeType: doc.mimeType,
        pageCount: doc.pageCount,
        localFileKey: doc.localFileKey,
      });
    },
    [repo, uid]
  );

  const updateDocumentMeta = useCallback(
    async (
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
    ) => {
      return repo.updateDocumentMeta(uid, current, patch);
    },
    [repo, uid]
  );

  const deleteDocument = useCallback(
    async (doc: VaultDocumentMeta) => {
      await repo.deleteDocument(uid, doc);
    },
    [repo, uid]
  );

  const restoreDocument = useCallback(
    async (doc: VaultDocumentMeta) => {
      await repo.restoreDocument(uid, doc);
    },
    [repo, uid]
  );

  return {
    folders,
    folderTree,
    flatFolders,
    documents,
    loading,
    error,
    isCloud,
    summary,
    todayYmd,
    vaultUnlocked,
    e2eConfigured: profile.e2eConfigured,
    initializeE2EVault,
    unlockE2ESession,
    lockE2ESession,
    createFolder,
    deleteFolder,
    createDocumentWithBinary,
    loadDocumentBytes,
    encryptExistingDocument,
    decryptExistingDocument,
    updateDocumentMeta,
    deleteDocument,
    restoreDocument,
  };
}

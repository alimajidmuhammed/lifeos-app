import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  bootstrapE2EVault,
  decryptText,
  deriveAesKeyFromSecret,
  encryptText,
  verifyE2EPassphrase,
  type EncryptedEnvelope,
} from '../core/crypto/e2eCrypto';
import {
  buildFolderTree,
  countMarkdownWords,
  flattenFolderTree,
  type CreateFolderInput,
  type CreateNoteInput,
  type NoteFolder,
  type NoteItem,
  type NoteVersion,
} from '../core/notes/noteSchemas';
import { generateSortKeyBetween } from '../core/planner/fractionalIndex';
import {
  firebaseNotesRepository,
  localNotesRepository,
} from '../data/repositories/notesRepository';
import { userProfileRepository } from '../data/repositories/firebaseWebAdapter';
import { useUIStore } from '../state/useUIStore';

export function useNotes() {
  const authUser = useUIStore((s) => s.authUser);
  const authReady = useUIStore((s) => s.authReady);
  const profile = useUIStore((s) => s.profile);
  const setProfile = useUIStore((s) => s.setProfile);
  const isAppLocked = useUIStore((s) => s.isAppLocked);

  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Session-only in-memory AES-256-GCM key & unlocked plaintexts (NEVER written to storage)
  const sessionKeyRef = useRef<CryptoKey | null>(null);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [decryptedBodies, setDecryptedBodies] = useState<Record<string, string>>({});

  const isCloud = Boolean(authUser?.uid);
  const uid = authUser?.uid ?? 'local';
  const repo = isCloud ? firebaseNotesRepository : localNotesRepository;

  // Wipe session E2E key immediately if app lock activates
  useEffect(() => {
    if (isAppLocked) {
      sessionKeyRef.current = null;
      setVaultUnlocked(false);
      setDecryptedBodies({});
    }
  }, [isAppLocked]);

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    setError(null);
    let foldersLoaded = false;
    let notesLoaded = false;
    const markDone = () => {
      if (foldersLoaded && notesLoaded) setLoading(false);
    };

    const unsubFolders = repo.subscribeFolders(
      uid,
      (list) => {
        setFolders(list);
        foldersLoaded = true;
        markDone();
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    const unsubNotes = repo.subscribeNotes(
      uid,
      (list) => {
        setNotes(list);
        notesLoaded = true;
        markDone();
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      unsubFolders();
      unsubNotes();
    };
  }, [authReady, repo, uid]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const flatFolders = useMemo(() => flattenFolderTree(folderTree), [folderTree]);

  const summary = useMemo(() => {
    let pinnedCount = 0;
    let lockedCount = 0;
    for (const n of notes) {
      if (n.pinned) pinnedCount++;
      if (n.isLocked || n.isEncrypted) lockedCount++;
    }
    return {
      totalNotes: notes.length,
      pinnedCount,
      lockedCount,
      folderCount: folders.length,
    };
  }, [notes, folders.length]);

  const createFolder = useCallback(
    async (input: CreateFolderInput) => {
      const lastKey = folders.length > 0 ? folders[folders.length - 1].sortKey : null;
      const sortKey = generateSortKeyBetween(lastKey, null);
      return repo.createFolder(uid, input, sortKey);
    },
    [folders, repo, uid]
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      await repo.deleteFolder(uid, folderId);
    },
    [repo, uid]
  );

  const createNote = useCallback(
    async (input: CreateNoteInput) => {
      return repo.createNote(uid, input);
    },
    [repo, uid]
  );

  const saveNote = useCallback(
    async (
      current: NoteItem,
      patch: {
        title?: string;
        plaintextContent?: string;
        folderId?: string | null;
        tags?: string[];
        pinned?: boolean;
      },
      saveSnapshot = true
    ) => {
      let storedContent = patch.plaintextContent;
      let wordCount: number | undefined;

      if (current.isEncrypted && patch.plaintextContent !== undefined) {
        if (!sessionKeyRef.current) {
          throw new Error('Unlock your E2E vault passphrase before saving an encrypted note.');
        }
        const env = await encryptText(patch.plaintextContent, sessionKeyRef.current);
        storedContent = JSON.stringify(env);
        wordCount = 0;
        setDecryptedBodies((prev) => ({
          ...prev,
          [current.id]: patch.plaintextContent!,
        }));
      } else if (patch.plaintextContent !== undefined) {
        wordCount = countMarkdownWords(patch.plaintextContent);
      }

      await repo.updateNoteContent(
        uid,
        current,
        {
          title: patch.title,
          content: storedContent,
          folderId: patch.folderId,
          tags: patch.tags,
          pinned: patch.pinned,
          wordCount,
        },
        saveSnapshot
      );
    },
    [repo, uid]
  );

  const togglePin = useCallback(
    async (note: NoteItem) => {
      await repo.togglePinOrFolder(uid, note, { pinned: !note.pinned });
    },
    [repo, uid]
  );

  const moveNoteToFolder = useCallback(
    async (note: NoteItem, folderId: string | null) => {
      await repo.togglePinOrFolder(uid, note, { folderId });
    },
    [repo, uid]
  );

  const deleteNote = useCallback(
    async (note: NoteItem) => {
      await repo.deleteNote(uid, note);
    },
    [repo, uid]
  );

  const restoreNote = useCallback(
    async (note: NoteItem) => {
      await repo.restoreNote(uid, note);
    },
    [repo, uid]
  );

  const listVersions = useCallback(
    async (noteId: string): Promise<NoteVersion[]> => {
      return repo.listVersions(uid, noteId);
    },
    [repo, uid]
  );

  const restoreVersion = useCallback(
    async (current: NoteItem, version: NoteVersion) => {
      await repo.updateNoteContent(
        uid,
        current,
        {
          title: version.title,
          content: version.content,
          wordCount: version.isEncrypted ? 0 : countMarkdownWords(version.content),
        },
        true
      );
      if (version.isEncrypted && sessionKeyRef.current) {
        try {
          const env = JSON.parse(version.content) as EncryptedEnvelope;
          const plain = await decryptText(env, sessionKeyRef.current);
          setDecryptedBodies((prev) => ({ ...prev, [current.id]: plain }));
        } catch {
          // leave locked if key mismatch
        }
      }
    },
    [repo, uid]
  );

  /**
   * Initializes opt-in E2E encryption on the user profile if not configured yet,
   * returning the one-time Recovery Key for the user to store offline.
   */
  const initializeE2EPassphrase = useCallback(
    async (passphrase: string): Promise<string> => {
      const boot = await bootstrapE2EVault(passphrase);
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
      sessionKeyRef.current = await deriveAesKeyFromSecret(passphrase, boot.salt);
      setVaultUnlocked(true);
      return boot.recoveryKey;
    },
    [authUser, profile, setProfile]
  );

  const unlockVaultSession = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!profile.e2eConfigured || !profile.e2eSalt || !profile.e2eVerifier) {
        return false;
      }
      const valid = await verifyE2EPassphrase(passphrase, profile.e2eSalt, profile.e2eVerifier);
      if (!valid) return false;
      sessionKeyRef.current = await deriveAesKeyFromSecret(passphrase, profile.e2eSalt);
      setVaultUnlocked(true);
      return true;
    },
    [profile.e2eConfigured, profile.e2eSalt, profile.e2eVerifier]
  );

  const lockVaultSession = useCallback(() => {
    sessionKeyRef.current = null;
    setVaultUnlocked(false);
    setDecryptedBodies({});
  }, []);

  const decryptNoteIntoSession = useCallback(async (note: NoteItem): Promise<string | null> => {
    if (!note.isEncrypted) return note.content;
    if (!sessionKeyRef.current) return null;
    try {
      const env = JSON.parse(note.content) as EncryptedEnvelope;
      const plain = await decryptText(env, sessionKeyRef.current);
      setDecryptedBodies((prev) => ({ ...prev, [note.id]: plain }));
      return plain;
    } catch {
      return null;
    }
  }, []);

  const encryptAndLockNote = useCallback(
    async (note: NoteItem, plaintext: string) => {
      if (!sessionKeyRef.current) {
        throw new Error('Unlock or configure your E2E passphrase first.');
      }
      const env = await encryptText(plaintext, sessionKeyRef.current);
      await repo.setNoteEncryptionState(uid, note, {
        content: JSON.stringify(env),
        isEncrypted: true,
        isLocked: true,
        wordCount: 0,
      });
      setDecryptedBodies((prev) => ({ ...prev, [note.id]: plaintext }));
    },
    [repo, uid]
  );

  const decryptAndUnlockNotePermanently = useCallback(
    async (note: NoteItem, plaintext: string) => {
      await repo.setNoteEncryptionState(uid, note, {
        content: plaintext,
        isEncrypted: false,
        isLocked: false,
        wordCount: countMarkdownWords(plaintext),
      });
      setDecryptedBodies((prev) => {
        const copy = { ...prev };
        delete copy[note.id];
        return copy;
      });
    },
    [repo, uid]
  );

  return {
    folders,
    folderTree,
    flatFolders,
    notes,
    loading,
    error,
    summary,
    isCloudSynced: isCloud,
    vaultUnlocked,
    decryptedBodies,
    createFolder,
    deleteFolder,
    createNote,
    saveNote,
    togglePin,
    moveNoteToFolder,
    deleteNote,
    restoreNote,
    listVersions,
    restoreVersion,
    initializeE2EPassphrase,
    unlockVaultSession,
    lockVaultSession,
    decryptNoteIntoSession,
    encryptAndLockNote,
    decryptAndUnlockNotePermanently,
  };
}

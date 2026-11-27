import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  CheckSquare,
  Code,
  Folder,
  FolderPlus,
  Heading2,
  History,
  Italic,
  List,
  Lock,
  Pin,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from '../../../components/ModalPortal';
import { MoreActionsMenu } from '../../../components/MoreActionsMenu';
import {
  requestNoteAssist,
  type NoteAiMode,
  type NoteAssistResult,
} from '../../../core/ai/notesAiClient';
import { evaluateDailyAiQuota, getTodayDayKey } from '../../../core/entitlements/entitlements';
import {
  countMarkdownWords,
  type NoteItem,
  type NoteVersion,
} from '../../../core/notes/noteSchemas';
import { toggleMarkdownChecklistLine } from '../../../core/notes/safeMarkdown';
import { aiUsageRepository } from '../../../data/repositories/firebaseWebAdapter';
import { useNotes } from '../../../hooks/useNotes';
import { usePlanner } from '../../../hooks/usePlanner';
import { useUIStore } from '../../../state/useUIStore';
import { NoteSecurityModal } from './NoteSecurityModal';
import { SafeMarkdownPreview } from './SafeMarkdownPreview';

type FolderFilter = 'all' | 'pinned' | 'locked' | string;
type EditorMode = 'edit' | 'split' | 'preview';

export const NotesView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const todayAiUsage = useUIStore((s) => s.todayAiUsage);
  const incrementLocalAiUsage = useUIStore((s) => s.incrementLocalAiUsage);
  const showToast = useUIStore((s) => s.showToast);

  const {
    folders,
    flatFolders,
    notes,
    loading,
    summary,
    isCloudSynced,
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
  } = useNotes();

  const { createTask } = usePlanner();

  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('split');

  // Local editor draft state
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // New nested folder state
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState('');

  // Version History Drawer state
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[]>([]);

  // Security / E2E modal state
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [pendingEncryptAfterUnlock, setPendingEncryptAfterUnlock] = useState(false);

  // AI Assist panel state
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<NoteAssistResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes.filter((n) => {
      if (folderFilter === 'pinned' && !n.pinned) return false;
      if (folderFilter === 'locked' && !n.isLocked && !n.isEncrypted) return false;
      if (
        folderFilter !== 'all' &&
        folderFilter !== 'pinned' &&
        folderFilter !== 'locked' &&
        n.folderId !== folderFilter
      ) {
        return false;
      }
      if (q) {
        const bodyForSearch = n.isEncrypted ? (decryptedBodies[n.id] ?? '') : n.content;
        const hay = `${n.title} ${bodyForSearch} ${(n.tags ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notes, folderFilter, searchQuery, decryptedBodies]);

  const selectedNote: NoteItem | null = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );

  // Keep editor synced when switching notes or decrypting a locked note
  useEffect(() => {
    setAiResult(null);
    setAiError(null);
    setVersionsOpen(false);

    if (!selectedNote) {
      setDraftTitle('');
      setDraftContent('');
      setDirty(false);
      return;
    }

    setDraftTitle(selectedNote.title);
    if (selectedNote.isEncrypted) {
      if (decryptedBodies[selectedNote.id] !== undefined) {
        setDraftContent(decryptedBodies[selectedNote.id]);
        setDirty(false);
      } else if (vaultUnlocked) {
        void decryptNoteIntoSession(selectedNote).then((plain) => {
          if (plain !== null) {
            setDraftContent(plain);
            setDirty(false);
          }
        });
      } else {
        setDraftContent('');
        setDirty(false);
      }
    } else {
      setDraftContent(selectedNote.content);
      setDirty(false);
    }
  }, [selectedNote?.id, selectedNote?.version, selectedNote?.isEncrypted, vaultUnlocked, decryptedBodies, decryptNoteIntoSession]);

  const isSelectedNoteSealed =
    Boolean(selectedNote?.isEncrypted) &&
    (!vaultUnlocked || (selectedNote ? decryptedBodies[selectedNote.id] === undefined : true));

  const aiAllowed = profile.aiGlobalEnabled && (profile.aiModuleToggles?.notes ?? true);

  const handleCreateNote = async () => {
    const activeFolderId =
      folderFilter !== 'all' && folderFilter !== 'pinned' && folderFilter !== 'locked'
        ? folderFilter
        : undefined;
    const created = await createNote({
      title: 'Untitled Note',
      content: '## Overview\n\n- [ ] First item\n',
      folderId: activeFolderId,
      isEncrypted: false,
      isLocked: false,
      pinned: false,
    });
    setSelectedNoteId(created.id);
    setEditorMode('split');
    showToast('Created new Markdown note.');
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderName.trim();
    if (!clean) return;
    await createFolder({
      name: clean,
      parentId: newFolderParentId || undefined,
      isLockedFolder: false,
    });
    setNewFolderName('');
    setNewFolderParentId('');
    setAddingFolder(false);
    showToast(`Created folder "${clean}".`);
  };

  const handleSaveNote = async () => {
    if (!selectedNote || isSelectedNoteSealed) return;
    setSaving(true);
    try {
      await saveNote(
        selectedNote,
        {
          title: draftTitle.trim() || 'Untitled Note',
          plaintextContent: draftContent,
        },
        true
      );
      setDirty(false);
      showToast(`Saved "${draftTitle.trim() || 'Untitled Note'}" (version snapshot recorded).`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save note.');
    } finally {
      setSaving(false);
    }
  };

  const insertMarkdownSnippet = (before: string, after = '') => {
    const el = textareaRef.current;
    if (!el) {
      setDraftContent((prev) => `${prev}${before}${after}`);
      setDirty(true);
      return;
    }
    const start = el.selectionStart ?? draftContent.length;
    const end = el.selectionEnd ?? draftContent.length;
    const selected = draftContent.slice(start, end);
    const next =
      draftContent.slice(0, start) + before + (selected || 'text') + after + draftContent.slice(end);
    setDraftContent(next);
    setDirty(true);
  };

  const handleToggleChecklistInPreview = (lineIndex: number) => {
    if (!selectedNote || isSelectedNoteSealed) return;
    const next = toggleMarkdownChecklistLine(draftContent, lineIndex);
    setDraftContent(next);
    setDirty(true);
  };

  const handleOpenVersions = async () => {
    if (!selectedNote) return;
    setVersionsOpen(true);
    setVersionsLoading(true);
    try {
      const list = await listVersions(selectedNote.id);
      setVersions(list);
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleRestoreVersion = async (ver: NoteVersion) => {
    if (!selectedNote) return;
    await restoreVersion(selectedNote, ver);
    setVersionsOpen(false);
    showToast(`Restored version v${ver.versionNumber}.`);
  };

  const handleToggleNoteLock = async () => {
    if (!selectedNote) return;

    if (!selectedNote.isEncrypted) {
      if (!profile.e2eConfigured || !vaultUnlocked) {
        setPendingEncryptAfterUnlock(true);
        setSecurityModalOpen(true);
        return;
      }
      await encryptAndLockNote(selectedNote, draftContent);
      setDirty(false);
      showToast(`Encrypted "${selectedNote.title}" with AES-256-GCM.`);
    } else {
      if (isSelectedNoteSealed) {
        setPendingEncryptAfterUnlock(false);
        setSecurityModalOpen(true);
        return;
      }
      await decryptAndUnlockNotePermanently(selectedNote, draftContent);
      setDirty(false);
      showToast(`Removed E2E encryption from "${selectedNote.title}".`);
    }
  };

  const handleDeleteNoteWithUndo = async (note: NoteItem) => {
    await deleteNote(note);
    if (selectedNoteId === note.id) {
      setSelectedNoteId(null);
    }
    showToast(`Deleted "${note.title}".`, () => {
      void restoreNote(note);
    });
  };

  const handleRunNoteAi = async (mode: NoteAiMode) => {
    if (!selectedNote) return;
    setAiPanelOpen(true);
    setAiError(null);
    setAiResult(null);

    if (selectedNote.isLocked || selectedNote.isEncrypted) {
      setAiError('Locked or E2E-encrypted notes are strictly blocked from AI processing by the LifeinOne Privacy Gate.');
      return;
    }
    if (!aiAllowed) {
      setAiError(t('assistant.disabledNotice'));
      return;
    }

    const dayKey = getTodayDayKey();
    const usedToday = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
    const quota = evaluateDailyAiQuota(usedToday, entitlements);
    if (!quota.allowed) {
      setAiError(`Daily AI quota reached (${quota.usedToday}/${quota.dailyLimit}).`);
      return;
    }

    setAiLoading(true);
    const res = await requestNoteAssist({
      title: draftTitle || selectedNote.title,
      content: draftContent || selectedNote.content,
      mode,
      locale: profile.locale,
      isLockedOrEncrypted: selectedNote.isLocked || selectedNote.isEncrypted,
      freeTier: entitlements.plan === 'free',
    });
    setAiLoading(false);

    if (!res.ok) {
      setAiError(res.error);
      return;
    }

    setAiResult(res.data);
    incrementLocalAiUsage(dayKey, res.meta.inputTokensEst, res.meta.outputTokensEst);
    if (authUser) {
      void aiUsageRepository.recordUsage(
        authUser.uid,
        dayKey,
        todayAiUsage.dayKey === dayKey ? todayAiUsage : null,
        res.meta.inputTokensEst,
        res.meta.outputTokensEst
      );
    }
  };

  const handleSendActionItemToPlanner = async (itemTitle: string) => {
    await createTask({
      title: itemTitle,
      listId: 'inbox',
      priority: 2,
      status: 'todo',
      notes: selectedNote ? `Extracted from note: ${selectedNote.title}` : undefined,
    });
    showToast(`Added "${itemTitle}" to Planner.`);
  };

  const liveWordCount = isSelectedNoteSealed ? 0 : countMarkdownWords(draftContent);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)]">
            <span>{isCloudSynced ? t('common.syncedCloudMode') : t('common.offlineLocalMode')}</span>
            <span aria-hidden="true"> · </span>
            <span className="font-numeric">
              {summary.totalNotes} {summary.totalNotes === 1 ? 'note' : 'notes'} · {summary.lockedCount} E2E locked
            </span>
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('notes.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {t('notes.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {vaultUnlocked && (
            <button
              type="button"
              onClick={() => {
                lockVaultSession();
                showToast('Locked E2E notes session in memory.');
              }}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs sm:text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-[var(--bg-subtle)] whitespace-nowrap"
            >
              <Lock className="h-4 w-4" />
              <span>Lock Session</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCreateNote()}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>{t('notes.newNote')}</span>
          </button>
        </div>
      </section>

      {/* Main 3-Pane Studio Container (Single-Elevation Hairline Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden min-h-[600px]">
        {/* Pane 1: Nested Folders & Smart Views */}
        <aside className="lg:col-span-3 border-b lg:border-b-0 lg:border-e border-[var(--border-hairline)] bg-[var(--bg-canvas)]/60 p-4 flex flex-col gap-4">
          <div className="space-y-1">
            {(
              [
                { id: 'all', label: t('notes.allNotes'), count: summary.totalNotes },
                { id: 'pinned', label: t('notes.pinnedNotes'), count: summary.pinnedCount },
                { id: 'locked', label: t('notes.lockedNotes'), count: summary.lockedCount },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFolderFilter(item.id)}
                className={`w-full min-h-[38px] px-3 py-1.5 rounded-lg flex items-center justify-between text-xs font-medium transition-colors ${
                  folderFilter === item.id
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                <span>{item.label}</span>
                <span className="font-numeric text-[11px] opacity-80">{item.count}</span>
              </button>
            ))}
          </div>

          <div className="border-t border-[var(--border-hairline)] pt-3 space-y-2 flex-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-[var(--text-muted)]">
                {t('notes.foldersTitle')}
              </span>
              <button
                type="button"
                aria-label="New folder"
                onClick={() => setAddingFolder((v) => !v)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </div>

            {addingFolder && (
              <form onSubmit={(e) => void handleCreateFolder(e)} className="space-y-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-2.5">
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="w-full min-h-[34px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                {folders.length > 0 && (
                  <select
                    aria-label="Parent folder"
                    value={newFolderParentId}
                    onChange={(e) => setNewFolderParentId(e.target.value)}
                    className="w-full min-h-[34px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
                  >
                    <option value="">Top-level folder</option>
                    {flatFolders.map(({ folder, depth }) => (
                      <option key={folder.id} value={folder.id}>
                        {'— '.repeat(depth)}
                        {folder.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAddingFolder(false)}
                    className="px-2.5 py-1 rounded-md text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-[11px] font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            {flatFolders.length === 0 ? (
              <p className="px-2 text-[11px] text-[var(--text-muted)]">
                No folders yet. Create nested folders for projects or private notes.
              </p>
            ) : (
              <div className="space-y-0.5">
                {flatFolders.map(({ folder, depth }) => {
                  const active = folderFilter === folder.id;
                  const count = notes.filter((n) => n.folderId === folder.id).length;
                  return (
                    <div
                      key={folder.id}
                      style={{ paddingInlineStart: `${depth * 14}px` }}
                      className="flex items-center gap-1 group"
                    >
                      <button
                        type="button"
                        onClick={() => setFolderFilter(folder.id)}
                        className={`flex-1 min-w-0 min-h-[34px] px-2.5 py-1 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors ${
                          active
                            ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0 truncate">
                          <Folder className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{folder.name}</span>
                        </span>
                        <span className="font-numeric text-[11px] opacity-75 shrink-0">{count}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete folder ${folder.name}`}
                        onClick={() => {
                          void deleteFolder(folder.id);
                          if (folderFilter === folder.id) setFolderFilter('all');
                          showToast(`Deleted folder "${folder.name}".`);
                        }}
                        className="opacity-60 hover:opacity-100 h-7 w-7 inline-flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Pane 2: Notes List */}
        <section className="lg:col-span-3 border-b lg:border-b-0 lg:border-e border-[var(--border-hairline)] flex flex-col">
          <div className="p-3 border-b border-[var(--border-hairline)]">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('notes.searchPlaceholder')}
                className="w-full min-h-[38px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] ps-9 pe-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div className="flex-1 divide-y divide-[var(--border-hairline)] overflow-y-auto max-h-[540px]">
            {loading ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
                ))}
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  {notes.length === 0 ? t('notes.emptyTitle') : 'No matching notes'}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {notes.length === 0 ? t('notes.emptyDesc') : 'Try a different folder or search query.'}
                </p>
              </div>
            ) : (
              filteredNotes.map((note) => {
                const selected = note.id === selectedNoteId;
                const folderName = note.folderId
                  ? folders.find((f) => f.id === note.folderId)?.name
                  : undefined;

                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`w-full px-4 py-3.5 text-start transition-colors space-y-1 ${
                      selected
                        ? 'bg-[var(--accent-soft)]'
                        : 'hover:bg-[var(--bg-subtle)]/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {note.title}
                      </span>
                      <span className="inline-flex items-center gap-1 shrink-0 text-[var(--text-muted)]">
                        {note.pinned && <Pin className="h-3 w-3 text-[var(--accent)]" />}
                        {(note.isLocked || note.isEncrypted) && (
                          <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                        )}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {note.isEncrypted ? (
                        <span className="text-amber-700 dark:text-amber-300 font-medium">
                          AES-256-GCM Encrypted
                        </span>
                      ) : (
                        <span>
                          {note.wordCount} {note.wordCount === 1 ? 'word' : 'words'}
                        </span>
                      )}
                      {folderName && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span>{folderName}</span>
                        </>
                      )}
                      <span aria-hidden="true"> · </span>
                      <span className="font-numeric">v{note.version}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Pane 3: Markdown Editor + Live Preview + Version History + AI Assist */}
        <section className="lg:col-span-6 flex flex-col min-w-0">
          {!selectedNote ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Select or create a Markdown note
              </h2>
              <p className="max-w-sm text-xs text-[var(--text-secondary)]">
                Write structured Markdown with live checklists, version snapshots, nested folders, and opt-in AES-256-GCM zero-knowledge locking.
              </p>
              <button
                type="button"
                onClick={() => void handleCreateNote()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('notes.newNote')}</span>
              </button>
            </div>
          ) : (
            <>
              {/* Editor Top Bar */}
              <div className="px-4 py-3 border-b border-[var(--border-hairline)] flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <select
                    aria-label="Note folder"
                    value={selectedNote.folderId ?? ''}
                    onChange={(e) => void moveNoteToFolder(selectedNote, e.target.value || null)}
                    className="min-h-[34px] max-w-[140px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-secondary)]"
                  >
                    <option value="">Unfiled</option>
                    {flatFolders.map(({ folder, depth }) => (
                      <option key={folder.id} value={folder.id}>
                        {'— '.repeat(depth)}
                        {folder.name}
                      </option>
                    ))}
                  </select>

                  <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg-subtle)]">
                    {(['edit', 'split', 'preview'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEditorMode(m)}
                        className={`min-h-[30px] px-2.5 rounded-md text-[11px] font-medium capitalize transition-colors ${
                          editorMode === m
                            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={saving || !dirty || isSelectedNoteSealed}
                    onClick={() => void handleSaveNote()}
                    className="inline-flex h-8 px-3 items-center gap-1 rounded-lg bg-[var(--accent)] text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-45 whitespace-nowrap"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{saving ? '...' : 'Save'}</span>
                  </button>

                  <MoreActionsMenu
                    items={[
                      {
                        id: 'pin',
                        label: selectedNote.pinned
                          ? t('ui.unpinNote', 'Unpin Note')
                          : t('ui.pinNote', 'Pin Note'),
                        icon: Pin,
                        onClick: () => void togglePin(selectedNote),
                      },
                      {
                        id: 'lock',
                        label: selectedNote.isEncrypted
                          ? t('ui.decrypt', 'Unlock / Decrypt E2E')
                          : t('ui.lockE2E', 'Lock with E2E'),
                        icon: selectedNote.isEncrypted ? Unlock : Lock,
                        onClick: () => void handleToggleNoteLock(),
                      },
                      {
                        id: 'versions',
                        label: t('ui.versionHistory', 'Version History'),
                        icon: History,
                        onClick: () => void handleOpenVersions(),
                      },
                      {
                        id: 'delete',
                        label: t('ui.deleteNote', 'Delete Note'),
                        icon: Trash2,
                        tone: 'warn',
                        onClick: () => void handleDeleteNoteWithUndo(selectedNote),
                      },
                    ]}
                  />
                </div>
              </div>

              {/* Sealed E2E Gate vs Active Editor */}
              {isSelectedNoteSealed ? (
                <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-subtle)] text-amber-600 dark:text-amber-400">
                    <Lock className="h-6 w-6" />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">
                      {selectedNote.title}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      This note is encrypted on-device with AES-256-GCM. Enter your vault passphrase to decrypt it in memory. AI features never read locked notes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingEncryptAfterUnlock(false);
                      setSecurityModalOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    <Unlock className="h-4 w-4" />
                    <span>Unlock with Passphrase</span>
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Title Input & Markdown Toolbar */}
                  <div className="px-5 pt-4 pb-2 space-y-2.5 border-b border-[var(--border-hairline)]">
                    <input
                      type="text"
                      maxLength={200}
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="Note title..."
                      className="w-full bg-transparent text-lg font-bold tracking-tight text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Heading"
                          onClick={() => insertMarkdownSnippet('\n## ', '')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <Heading2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Bold"
                          onClick={() => insertMarkdownSnippet('**', '**')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <Bold className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Italic"
                          onClick={() => insertMarkdownSnippet('*', '*')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <Italic className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Bullet list"
                          onClick={() => insertMarkdownSnippet('\n- ', '')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <List className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Checklist"
                          onClick={() => insertMarkdownSnippet('\n- [ ] ', '')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <CheckSquare className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Inline code"
                          onClick={() => insertMarkdownSnippet('`', '`')}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <Code className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span className="font-numeric">
                          {liveWordCount} {liveWordCount === 1 ? 'word' : 'words'} · v{selectedNote.version}
                        </span>
                        {dirty && (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">· Unsaved</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Privacy-Gated AI Assist Bar */}
                  <div className="px-5 py-2.5 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)]/50 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                      <span className="font-medium">Note AI</span>
                      {selectedNote.isEncrypted && (
                        <span className="text-[11px] text-amber-700 dark:text-amber-300">
                          · Blocked on E2E locked notes (Privacy Gate)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={aiLoading || selectedNote.isEncrypted || selectedNote.isLocked}
                        onClick={() => void handleRunNoteAi('summarize')}
                        className="min-h-[30px] px-2.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-45 whitespace-nowrap"
                      >
                        Summarize
                      </button>
                      <button
                        type="button"
                        disabled={aiLoading || selectedNote.isEncrypted || selectedNote.isLocked}
                        onClick={() => void handleRunNoteAi('action_items')}
                        className="min-h-[30px] px-2.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-45 whitespace-nowrap"
                      >
                        Extract Tasks
                      </button>
                      <button
                        type="button"
                        disabled={aiLoading || selectedNote.isEncrypted || selectedNote.isLocked}
                        onClick={() => void handleRunNoteAi('polish')}
                        className="min-h-[30px] px-2.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-45 whitespace-nowrap"
                      >
                        Polish
                      </button>
                    </div>
                  </div>

                  {/* AI Result Preview Panel (Confirmation-Gated) */}
                  {aiPanelOpen && (aiLoading || aiResult || aiError) && (
                    <div className="px-5 py-3.5 border-b border-[var(--border-hairline)] bg-[var(--bg-canvas)] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          AI Note Preview
                        </span>
                        <button
                          type="button"
                          aria-label="Close AI preview"
                          onClick={() => setAiPanelOpen(false)}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {aiLoading ? (
                        <p className="text-xs text-[var(--text-muted)]">Analyzing note via server proxy...</p>
                      ) : aiError ? (
                        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                          <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>{aiError}</span>
                        </p>
                      ) : aiResult ? (
                        <div className="space-y-2.5">
                          <p className="text-xs leading-relaxed text-[var(--text-primary)]">
                            {aiResult.summary}
                          </p>
                          {aiResult.actionItems.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold text-[var(--text-muted)]">
                                Extracted Action Items
                              </div>
                              {aiResult.actionItems.map((item, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5"
                                >
                                  <span className="text-xs text-[var(--text-primary)]">{item}</span>
                                  <button
                                    type="button"
                                    onClick={() => void handleSendActionItemToPlanner(item)}
                                    className="text-[11px] font-semibold text-[var(--accent)] hover:underline whitespace-nowrap shrink-0"
                                  >
                                    + Send to Planner
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {aiResult.polishedMarkdown && (
                            <div className="pt-1 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setDraftContent(aiResult.polishedMarkdown!);
                                  setDirty(true);
                                  setAiPanelOpen(false);
                                  showToast('Applied polished draft to editor. Click Save to commit.');
                                }}
                                className="min-h-[32px] rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                              >
                                Apply Polished Markdown
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Editor & Safe Preview Split */}
                  <div
                    className={`flex-1 grid min-h-[340px] ${
                      editorMode === 'split' ? 'grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--border-hairline)]' : 'grid-cols-1'
                    }`}
                  >
                    {(editorMode === 'edit' || editorMode === 'split') && (
                      <textarea
                        ref={textareaRef}
                        aria-label="Markdown editor"
                        value={draftContent}
                        onChange={(e) => {
                          setDraftContent(e.target.value);
                          setDirty(true);
                        }}
                        placeholder="Write in Markdown... (# Heading, **bold**, - [ ] checklist)"
                        className="w-full h-full min-h-[320px] resize-none bg-transparent p-5 font-numeric text-xs sm:text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                      />
                    )}

                    {(editorMode === 'preview' || editorMode === 'split') && (
                      <div className="p-5 overflow-y-auto bg-[var(--bg-canvas)]/30">
                        <SafeMarkdownPreview
                          markdown={draftContent}
                          onToggleChecklistLine={handleToggleChecklistInPreview}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Version History Drawer */}
      {versionsOpen && selectedNote && (
        <ModalPortal onClose={() => setVersionsOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Note version history"
            className="fixed inset-0 z-[60] flex justify-end bg-slate-950/50 backdrop-blur-xs"
            onClick={() => setVersionsOpen(false)}
          >
          <div
            className="w-full max-w-md h-full bg-[var(--bg-surface)] border-s border-[var(--border-hairline)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Version History
                </h2>
                <p className="text-xs text-[var(--text-muted)] truncate max-w-[260px]">
                  {selectedNote.title} · Current v{selectedNote.version}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close version history"
                onClick={() => setVersionsOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-hairline)]">
              {versionsLoading ? (
                <div className="p-5 text-xs text-[var(--text-muted)]">Loading snapshots...</div>
              ) : versions.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                  No previous revisions yet. Each time you save changes, an immutable snapshot is recorded here.
                </div>
              ) : (
                versions.map((ver) => (
                  <div key={ver.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          v{ver.versionNumber} · {ver.title}
                        </div>
                        <div className="font-numeric text-[11px] text-[var(--text-muted)]">
                          {new Date(ver.createdAtIso).toLocaleString()}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRestoreVersion(ver)}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Restore</span>
                      </button>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] line-clamp-3 font-numeric">
                      {ver.isEncrypted ? '[AES-256-GCM encrypted snapshot]' : ver.content || '(empty)'}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* E2E Encryption Setup & Session Unlock Modal */}
      <NoteSecurityModal
        open={securityModalOpen}
        e2eConfigured={profile.e2eConfigured}
        onClose={() => {
          setSecurityModalOpen(false);
          setPendingEncryptAfterUnlock(false);
        }}
        onInitializeE2E={initializeE2EPassphrase}
        onUnlockSession={unlockVaultSession}
        onUnlockedSuccess={() => {
          if (pendingEncryptAfterUnlock && selectedNote && !selectedNote.isEncrypted) {
            void encryptAndLockNote(selectedNote, draftContent).then(() => {
              setDirty(false);
              showToast(`Encrypted "${selectedNote.title}" with AES-256-GCM.`);
            });
          } else if (selectedNote?.isEncrypted) {
            void decryptNoteIntoSession(selectedNote);
            showToast('Unlocked E2E notes session.');
          }
          setPendingEncryptAfterUnlock(false);
        }}
      />
    </div>
  );
};

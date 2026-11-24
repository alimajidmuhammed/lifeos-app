import React, { useEffect, useMemo, useState } from 'react';
import {
  BellPlus,
  Check,
  Clock,
  Download,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { evaluatePrivacyGate } from '../../../core/ai/privacyGate';
import {
  buildExpiryReminderInput,
  evaluateDocumentExpiry,
} from '../../../core/vault/expiryEngine';
import {
  formatBytes,
  VAULT_DOC_TYPE_META,
  VAULT_DOC_TYPES,
  type VaultDocType,
  type VaultDocumentMeta,
} from '../../../core/vault/vaultSchemas';
import { useReminders } from '../../../hooks/useReminders';
import { useVault } from '../../../hooks/useVault';
import { useUIStore } from '../../../state/useUIStore';
import { NoteSecurityModal } from '../../notes/ui/NoteSecurityModal';
import { DocumentScannerModal } from './DocumentScannerModal';

type SmartScope = 'all' | 'expiring' | 'locked';

export const VaultView: React.FC = () => {
  const { t } = useTranslation();
  const showToast = useUIStore((s) => s.showToast);
  const { createReminder } = useReminders();

  const {
    folders,
    flatFolders,
    documents,
    loading,
    error,
    summary,
    todayYmd,
    vaultUnlocked,
    e2eConfigured,
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
  } = useVault();

  // Navigation & filter state
  const [scope, setScope] = useState<SmartScope>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [docTypeFilter, setDocTypeFilter] = useState<VaultDocType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  // Folder creation inline form
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState('');

  // Modals
  const [scannerOpen, setScannerOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [afterUnlockAction, setAfterUnlockAction] = useState<(() => void) | null>(null);

  // Active document binary preview & metadata editor
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [binaryLoading, setBinaryLoading] = useState(false);
  const [binaryMissing, setBinaryMissing] = useState(false);

  const [editOcr, setEditOcr] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [editIssuer, setEditIssuer] = useState('');
  const [editFolderId, setEditFolderId] = useState('');
  const [metaDirty, setMetaDirty] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  // Live privacy gate test feedback
  const [privacyGateNotice, setPrivacyGateNotice] = useState<string | null>(null);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (selectedFolderId && doc.folderId !== selectedFolderId) return false;
      if (scope === 'locked' && !doc.isEncrypted) return false;
      if (scope === 'expiring') {
        const ev = evaluateDocumentExpiry(doc.expiryDate, todayYmd);
        if (ev.status !== 'expired' && ev.status !== 'critical' && ev.status !== 'soon') {
          return false;
        }
      }
      if (docTypeFilter !== 'all' && doc.docType !== docTypeFilter) return false;
      if (q) {
        const hay = [
          doc.title,
          doc.docType,
          doc.issuer ?? '',
          doc.documentNumberLast4 ?? '',
          doc.notes ?? '',
          doc.ocrText ?? '',
          ...doc.tags,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [documents, selectedFolderId, scope, docTypeFilter, searchQuery, todayYmd]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? filteredDocs[0] ?? null,
    [documents, selectedDocId, filteredDocs]
  );

  const isSelectedDocSealed = Boolean(selectedDoc?.isEncrypted && !vaultUnlocked);

  // Sync inspector draft inputs when selectedDoc changes
  useEffect(() => {
    if (!selectedDoc) {
      setEditOcr('');
      setEditExpiry('');
      setEditIssuer('');
      setEditFolderId('');
      setMetaDirty(false);
      return;
    }
    setEditOcr(selectedDoc.ocrText ?? '');
    setEditExpiry(selectedDoc.expiryDate ?? '');
    setEditIssuer(selectedDoc.issuer ?? '');
    setEditFolderId(selectedDoc.folderId ?? '');
    setMetaDirty(false);
    setPrivacyGateNotice(null);
  }, [selectedDoc?.id, selectedDoc?.updatedAt]);

  // Load binary preview from IndexedDB (decrypting in memory if E2E unlocked)
  useEffect(() => {
    let active = true;
    let createdObjectUrl: string | null = null;

    setPreviewUrl(null);
    setPreviewMime(null);
    setPreviewText(null);
    setBinaryMissing(false);

    if (!selectedDoc || isSelectedDocSealed) return;

    setBinaryLoading(true);
    void loadDocumentBytes(selectedDoc)
      .then((res) => {
        if (!active) return;
        if (!res) {
          setBinaryMissing(true);
          return;
        }
        setPreviewMime(res.mimeType);
        if (res.mimeType === 'text/plain') {
          setPreviewText(new TextDecoder().decode(res.bytes));
          return;
        }
        const copy = new Uint8Array(new ArrayBuffer(res.bytes.byteLength));
        copy.set(res.bytes);
        const blob = new Blob([copy], { type: res.mimeType });
        createdObjectUrl = URL.createObjectURL(blob);
        setPreviewUrl(createdObjectUrl);
      })
      .catch(() => {
        if (active) setBinaryMissing(true);
      })
      .finally(() => {
        if (active) setBinaryLoading(false);
      });

    return () => {
      active = false;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [selectedDoc?.id, selectedDoc?.isEncrypted, selectedDoc?.version, isSelectedDocSealed, vaultUnlocked, loadDocumentBytes]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await createFolder({
        name: newFolderName.trim(),
        parentId: newFolderParentId || undefined,
        isLockedFolder: false,
      });
      setNewFolderName('');
      setNewFolderParentId('');
      setAddingFolder(false);
      showToast('Vault folder created.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create folder.');
    }
  };

  const handleSaveMeta = async () => {
    if (!selectedDoc) return;
    setSavingMeta(true);
    try {
      await updateDocumentMeta(selectedDoc, {
        folderId: editFolderId || null,
        expiryDate: editExpiry || null,
        issuer: editIssuer.trim() || null,
        ocrText: editOcr.trim() || null,
      });
      setMetaDirty(false);
      showToast('Document details saved.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save document details.');
    } finally {
      setSavingMeta(false);
    }
  };

  const handleDownloadDocument = async () => {
    if (!selectedDoc || isSelectedDocSealed) return;
    const res = await loadDocumentBytes(selectedDoc);
    if (!res) {
      showToast('Local binary file not found on this device.');
      return;
    }
    const copy = new Uint8Array(new ArrayBuffer(res.bytes.byteLength));
    copy.set(res.bytes);
    const blob = new Blob([copy], { type: res.mimeType });
    const url = URL.createObjectURL(blob);
    const ext =
      res.mimeType === 'application/pdf'
        ? 'pdf'
        : res.mimeType === 'image/jpeg'
          ? 'jpg'
          : res.mimeType === 'image/png'
            ? 'png'
            : 'txt';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedDoc.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleScheduleExpiryReminder = async (doc: VaultDocumentMeta) => {
    const draft = buildExpiryReminderInput(doc, todayYmd, 30);
    if (!draft) {
      showToast('Set an expiry date first to schedule an alert.');
      return;
    }
    try {
      const rem = await createReminder(draft);
      await updateDocumentMeta(doc, { linkedReminderId: rem.id });
      showToast(`Expiry reminder scheduled for ${draft.dueAtIso.slice(0, 10)}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not schedule expiry reminder.');
    }
  };

  const handleToggleEncryption = async (doc: VaultDocumentMeta) => {
    const runToggle = async () => {
      try {
        if (doc.isEncrypted) {
          await decryptExistingDocument(doc);
          showToast('Document decrypted on-device.');
        } else {
          await encryptExistingDocument(doc);
          showToast('Document encrypted with AES-256-GCM.');
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Encryption toggle failed.');
      }
    };

    if (!vaultUnlocked) {
      setAfterUnlockAction(() => () => void runToggle());
      setSecurityModalOpen(true);
      return;
    }
    await runToggle();
  };

  const handleDeleteWithUndo = async (doc: VaultDocumentMeta) => {
    await deleteDocument(doc);
    if (selectedDocId === doc.id) setSelectedDocId(null);
    showToast(`Deleted "${doc.title}"`, () => {
      void restoreDocument(doc);
    });
  };

  const handleTestVaultPrivacyGate = (doc: VaultDocumentMeta) => {
    const verdict = evaluatePrivacyGate({
      freeTier: true,
      module: 'vault',
      text: `${doc.title} ${doc.docType} ${doc.ocrText ?? ''}`,
      hasAttachmentImage: true,
      containsVaultSensitiveDoc: true,
      containsLockedOrE2E: doc.isEncrypted,
    });
    setPrivacyGateNotice(
      verdict.allowed
        ? 'Allowed (Paid zero-retention tier).'
        : `${verdict.code}: ${verdict.reason}`
    );
  };

  const selectedExpiry = selectedDoc ? evaluateDocumentExpiry(selectedDoc.expiryDate, todayYmd) : null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('vault.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {t('vault.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {vaultUnlocked && (
            <button
              type="button"
              onClick={lockE2ESession}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
            >
              <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span>Lock Session</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>{t('vault.addDocument')}</span>
          </button>
        </div>
      </section>

      {/* 4-Column Flat KPI Strip */}
      <section
        aria-label="Document Vault metrics"
        className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl border border-[var(--border-hairline)] bg-[var(--border-hairline)] overflow-hidden"
      >
        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('vault.kpiTotal')}</div>
          <div className="mt-1.5 font-numeric text-xl font-semibold text-[var(--text-primary)]">
            {summary.totalDocs}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
            {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('vault.kpiExpiring')}</div>
          <div
            className={`mt-1.5 font-numeric text-xl font-semibold ${
              summary.expiredCount > 0
                ? 'text-red-600 dark:text-red-400'
                : summary.expiring30Count > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-[var(--text-primary)]'
            }`}
          >
            {summary.expiredCount + summary.expiring90Count}
          </div>
          <div className="mt-0.5 font-numeric text-xs text-[var(--text-muted)]">
            {summary.expiredCount} expired · {summary.expiring30Count} &le; 30d
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('vault.kpiEncrypted')}</div>
          <div className="mt-1.5 font-numeric text-xl font-semibold text-[var(--accent)]">
            {summary.encryptedCount}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
            {vaultUnlocked ? 'E2E session unlocked' : 'AES-256-GCM opt-in'}
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('vault.kpiStorage')}</div>
          <div className="mt-1.5 font-numeric text-xl font-semibold text-[var(--text-primary)] whitespace-nowrap">
            {formatBytes(summary.totalBytes)}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
            Local-Only (Spark · $0)
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 3-Pane Document Vault Studio */}
      <section className="grid grid-cols-1 lg:grid-cols-12 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden min-h-[580px]">
        {/* Pane 1: Smart Views & Nested Folders */}
        <aside className="lg:col-span-3 border-b lg:border-b-0 lg:border-e border-[var(--border-hairline)] p-4 space-y-5">
          <div className="space-y-1">
            {(
              [
                { id: 'all', label: t('vault.allDocs'), count: summary.totalDocs },
                {
                  id: 'expiring',
                  label: t('vault.expiringSoon'),
                  count: summary.expiredCount + summary.expiring90Count,
                },
                { id: 'locked', label: t('vault.lockedDocs'), count: summary.encryptedCount },
              ] as const
            ).map((item) => {
              const active = scope === item.id && selectedFolderId === null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setScope(item.id);
                    setSelectedFolderId(null);
                  }}
                  className={`w-full min-h-[38px] flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="font-numeric text-[11px] opacity-80">{item.count}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-4 border-t border-[var(--border-hairline)] space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {t('vault.foldersTitle')}
              </span>
              <button
                type="button"
                aria-label="New vault folder"
                onClick={() => setAddingFolder((v) => !v)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
              >
                <FolderPlus className="h-4 w-4" />
              </button>
            </div>

            {addingFolder && (
              <form
                onSubmit={(e) => void handleCreateFolder(e)}
                className="space-y-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-2.5"
              >
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Vault folder name"
                  className="w-full min-h-[34px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                {folders.length > 0 && (
                  <select
                    aria-label="Parent vault folder"
                    value={newFolderParentId}
                    onChange={(e) => setNewFolderParentId(e.target.value)}
                    className="w-full min-h-[34px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)]"
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
                Create nested folders (e.g. Identity, Vehicles, Warranties).
              </p>
            ) : (
              <div className="space-y-0.5">
                {flatFolders.map(({ folder, depth }) => {
                  const active = selectedFolderId === folder.id;
                  return (
                    <div
                      key={folder.id}
                      className={`group flex items-center justify-between rounded-lg pe-1 transition-colors ${
                        active
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                      }`}
                      style={{ paddingInlineStart: `${8 + depth * 14}px` }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFolderId(folder.id);
                          setScope('all');
                        }}
                        className="flex-1 min-h-[34px] flex items-center gap-2 text-start text-xs font-medium truncate py-1"
                      >
                        <Folder className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete vault folder ${folder.name}`}
                        onClick={() => {
                          if (selectedFolderId === folder.id) setSelectedFolderId(null);
                          void deleteFolder(folder.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Storage Posture Note */}
          <div className="pt-4 border-t border-[var(--border-hairline)] space-y-1.5 text-[11px] text-[var(--text-muted)]">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--text-secondary)]">
              <HardDrive className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>Local-Only Storage Mode</span>
            </div>
            <p className="leading-relaxed">
              Document files stay in local IndexedDB (Spark free tier · $0). Cloud Storage sync requires upgrading Firebase to Blaze with budget alerts.
            </p>
          </div>
        </aside>

        {/* Pane 2: Searchable Document List */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-e border-[var(--border-hairline)] flex flex-col">
          <div className="p-3.5 border-b border-[var(--border-hairline)] space-y-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-[var(--text-muted)] absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('vault.searchPlaceholder')}
                className="w-full min-h-[38px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] ps-8 pe-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <select
              aria-label="Filter by document type"
              value={docTypeFilter}
              onChange={(e) => setDocTypeFilter(e.target.value as VaultDocType | 'all')}
              className="w-full min-h-[34px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="all">{t('vault.allTypes')}</option>
              {VAULT_DOC_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {t(VAULT_DOC_TYPE_META[dt].labelKey, VAULT_DOC_TYPE_META[dt].fallbackLabel)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-hairline)]">
            {loading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
                ))}
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {documents.length === 0 ? t('vault.emptyTitle') : 'No matching documents'}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {documents.length === 0
                    ? t('vault.emptyDesc')
                    : 'Adjust your search, folder, or document type filter.'}
                </p>
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = selectedDoc?.id === doc.id;
                const exp = evaluateDocumentExpiry(doc.expiryDate, todayYmd);
                const typeMeta = VAULT_DOC_TYPE_META[doc.docType];
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full px-4 py-3.5 text-start transition-colors space-y-1 ${
                      isSelected
                        ? 'bg-[var(--accent-soft)]/70'
                        : 'hover:bg-[var(--bg-subtle)]/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {doc.title}
                      </span>
                      {doc.isEncrypted && (
                        <Lock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <span>{t(typeMeta.labelKey, typeMeta.fallbackLabel)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-numeric">{formatBytes(doc.sizeBytes)}</span>
                      {doc.pageCount > 1 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-numeric">{doc.pageCount}p</span>
                        </>
                      )}
                      {exp.status !== 'no_expiry' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-numeric font-medium ${
                              exp.status === 'expired'
                                ? 'text-red-600 dark:text-red-400'
                                : exp.status === 'critical'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : exp.status === 'soon'
                                    ? 'text-amber-700 dark:text-amber-300'
                                    : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {exp.label}
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Pane 3: Document Preview, Expiry Alerts, E2E Lock & Privacy Gate */}
        <div className="lg:col-span-5 flex flex-col min-w-0">
          {!selectedDoc ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-subtle)] text-[var(--accent)]">
                <FileText className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                {t('vault.emptyTitle')}
              </h3>
              <p className="max-w-sm text-xs text-[var(--text-secondary)] leading-relaxed">
                {t('vault.emptyDesc')}
              </p>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('vault.addDocument')}</span>
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Top Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-hairline)]">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {selectedDoc.title}
                  </h2>
                  <p className="font-numeric text-[11px] text-[var(--text-muted)]">
                    {t(
                      VAULT_DOC_TYPE_META[selectedDoc.docType].labelKey,
                      VAULT_DOC_TYPE_META[selectedDoc.docType].fallbackLabel
                    )}{' '}
                    · {selectedDoc.mimeType} · {formatBytes(selectedDoc.sizeBytes)}
                    {selectedDoc.documentNumberLast4 ? ` · ID: ${selectedDoc.documentNumberLast4}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!isSelectedDocSealed && (
                    <button
                      type="button"
                      aria-label="Download document"
                      onClick={() => void handleDownloadDocument()}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={selectedDoc.isEncrypted ? 'Decrypt document' : 'Encrypt document'}
                    onClick={() => void handleToggleEncryption(selectedDoc)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap ${
                      selectedDoc.isEncrypted
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                    }`}
                  >
                    {selectedDoc.isEncrypted ? (
                      <>
                        <Unlock className="h-3.5 w-3.5" />
                        <span>Decrypt</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        <span>Lock E2E</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    aria-label="Delete document"
                    onClick={() => void handleDeleteWithUndo(selectedDoc)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Sealed E2E Gate vs Active Inspector */}
              {isSelectedDocSealed ? (
                <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-subtle)] text-amber-600 dark:text-amber-400">
                    <Lock className="h-6 w-6" />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <h3 className="text-base font-semibold text-[var(--text-primary)]">
                      {selectedDoc.title}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      This document file is encrypted on-device with AES-256-GCM. Unlock your Vault session to decrypt and view it in memory.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAfterUnlockAction(null);
                      setSecurityModalOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    <Unlock className="h-4 w-4" />
                    <span>Unlock with Passphrase</span>
                  </button>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  {/* Binary Preview Surface */}
                  <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] overflow-hidden min-h-[180px] flex items-center justify-center">
                    {binaryLoading ? (
                      <span className="text-xs text-[var(--text-muted)]">Loading local binary...</span>
                    ) : previewUrl && previewMime?.startsWith('image/') ? (
                      <img
                        src={previewUrl}
                        alt={selectedDoc.title}
                        className="max-h-[260px] w-auto object-contain p-2"
                      />
                    ) : previewUrl && previewMime === 'application/pdf' ? (
                      <div className="w-full p-5 text-center space-y-3">
                        <FileText className="h-8 w-8 text-[var(--accent)] mx-auto" />
                        <div>
                          <div className="text-xs font-semibold text-[var(--text-primary)]">
                            PDF Document Ready ({selectedDoc.pageCount}{' '}
                            {selectedDoc.pageCount === 1 ? 'page' : 'pages'})
                          </div>
                          <div className="font-numeric text-[11px] text-[var(--text-muted)] mt-0.5">
                            {formatBytes(selectedDoc.sizeBytes)} · Stored in Local IndexedDB
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDownloadDocument()}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                        >
                          <Download className="h-3.5 w-3.5 text-[var(--accent)]" />
                          <span>Download PDF</span>
                        </button>
                      </div>
                    ) : previewText ? (
                      <pre className="w-full p-4 text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono">
                        {previewText}
                      </pre>
                    ) : binaryMissing ? (
                      <div className="p-5 text-center text-xs text-[var(--text-muted)]">
                        Local binary file is stored only on the device where it was scanned (Local-Only Vault mode).
                      </div>
                    ) : null}
                  </div>

                  {/* Expiry Status & One-Click Reminder Integration */}
                  {selectedExpiry && selectedExpiry.status !== 'no_expiry' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-3">
                      <div className="flex items-center gap-2 text-xs">
                        <Clock className="h-4 w-4 text-[var(--accent)] shrink-0" />
                        <div>
                          <span className="font-semibold text-[var(--text-primary)]">
                            {selectedExpiry.label}
                          </span>
                          <span className="font-numeric text-[var(--text-muted)] ms-2">
                            ({selectedDoc.expiryDate})
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleScheduleExpiryReminder(selectedDoc)}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                      >
                        <BellPlus className="h-3.5 w-3.5 text-[var(--accent)]" />
                        <span>
                          {selectedDoc.linkedReminderId ? 'Reminder Linked' : 'Schedule 30d Alert'}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Editable Metadata & Local OCR Text */}
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          Expiry Date
                        </label>
                        <input
                          type="date"
                          value={editExpiry}
                          onChange={(e) => {
                            setEditExpiry(e.target.value);
                            setMetaDirty(true);
                          }}
                          className="w-full min-h-[38px] font-numeric rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          Folder
                        </label>
                        <select
                          aria-label="Document folder"
                          value={editFolderId}
                          onChange={(e) => {
                            setEditFolderId(e.target.value);
                            setMetaDirty(true);
                          }}
                          className="w-full min-h-[38px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                        >
                          <option value="">No folder</option>
                          {flatFolders.map(({ folder, depth }) => (
                            <option key={folder.id} value={folder.id}>
                              {'— '.repeat(depth)}
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                        Issuer
                      </label>
                      <input
                        type="text"
                        maxLength={120}
                        value={editIssuer}
                        onChange={(e) => {
                          setEditIssuer(e.target.value);
                          setMetaDirty(true);
                        }}
                        placeholder="Issuing authority or vendor"
                        className="w-full min-h-[38px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                        On-Device OCR / Extracted Text (searchable locally)
                      </label>
                      <textarea
                        rows={3}
                        maxLength={20000}
                        value={editOcr}
                        onChange={(e) => {
                          setEditOcr(e.target.value);
                          setMetaDirty(true);
                        }}
                        placeholder="Store extracted text locally for instant offline search..."
                        className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>

                    {metaDirty && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={savingMeta}
                          onClick={() => void handleSaveMeta()}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{savingMeta ? 'Saving...' : 'Save Changes'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Privacy Gate Status & Verification */}
                  <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                        <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                        <span>Document AI Privacy Gate (Free Tier)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTestVaultPrivacyGate(selectedDoc)}
                        className="text-[11px] font-medium text-[var(--accent)] hover:underline whitespace-nowrap"
                      >
                        Verify Gate
                      </button>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      Cloud Document AI (image OCR &amp; field extraction) is strictly blocked while <code className="font-mono">free_tier=true</code> so your identity and financial scans never train external models. Upgrade to a paid zero-retention provider in Phase 7 to unlock Document AI.
                    </p>
                    {privacyGateNotice && (
                      <div className="flex items-start gap-1.5 pt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{privacyGateNotice}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Scanner / Upload Modal */}
      <DocumentScannerModal
        open={scannerOpen}
        flatFolders={flatFolders}
        defaultFolderId={selectedFolderId ?? undefined}
        vaultUnlocked={vaultUnlocked}
        e2eConfigured={e2eConfigured}
        onRequestUnlockE2E={(onSuccess) => {
          setAfterUnlockAction(() => onSuccess);
          setSecurityModalOpen(true);
        }}
        onClose={() => setScannerOpen(false)}
        onSave={async (input, bytes) => {
          const created = await createDocumentWithBinary(input, bytes);
          setSelectedDocId(created.id);
          showToast(
            created.isEncrypted
              ? 'Encrypted document saved to Local Vault.'
              : 'Document saved to Local Vault.'
          );
        }}
      />

      {/* Shared Opt-In AES-256-GCM Setup / Unlock Modal */}
      <NoteSecurityModal
        open={securityModalOpen}
        e2eConfigured={e2eConfigured}
        onClose={() => {
          setSecurityModalOpen(false);
          setAfterUnlockAction(null);
        }}
        onInitializeE2E={initializeE2EVault}
        onUnlockSession={unlockE2ESession}
        onUnlockedSuccess={() => {
          const cb = afterUnlockAction;
          setAfterUnlockAction(null);
          cb?.();
        }}
      />
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Crop,
  FileText,
  FileUp,
  Lock,
  Plus,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { captureNativePhotoDataUrl, isNativeApp } from '../../../core/native/mobileBridge';
import {
  enhanceScannedImage,
  type EnhancedScanResult,
  type ScanFilterPreset,
} from '../../../core/vault/imageEnhancer';
import {
  extractDocumentMetadataLocally,
  extractTextFromPdfBytesLocally,
} from '../../../core/vault/localDocExtractor';
import { runLocalImageOcr } from '../../../core/vault/localOcr';
import { buildMultiPagePdfFromJpegs } from '../../../core/vault/pdfGenerator';
import {
  formatBytes,
  VAULT_DOC_TYPE_META,
  VAULT_DOC_TYPES,
  type CreateVaultDocumentInput,
  type VaultDocType,
  type VaultFolder,
} from '../../../core/vault/vaultSchemas';

interface ScannedPage {
  id: string;
  rawDataUrl: string;
  rotationDeg: 0 | 90 | 180 | 270;
  cropInsetPct: number;
  filter: ScanFilterPreset;
  enhanced: EnhancedScanResult | null;
}

interface DocumentScannerModalProps {
  open: boolean;
  flatFolders: Array<{ folder: VaultFolder; depth: number }>;
  defaultFolderId?: string;
  vaultUnlocked: boolean;
  e2eConfigured: boolean;
  onRequestUnlockE2E: (onSuccess: () => void) => void;
  onClose: () => void;
  onSave: (
    input: Omit<CreateVaultDocumentInput, 'localFileKey' | 'sizeBytes'>,
    plainBytes: Uint8Array
  ) => Promise<void>;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('Could not read file bytes.'));
    reader.readAsArrayBuffer(file);
  });
}

export const DocumentScannerModal: React.FC<DocumentScannerModalProps> = ({
  open,
  flatFolders,
  defaultFolderId,
  vaultUnlocked,
  onRequestUnlockE2E,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();

  // Captured PDF or multi-page image scans
  const [uploadedPdf, setUploadedPdf] = useState<{
    name: string;
    bytes: Uint8Array;
  } | null>(null);
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [bundleAsPdf, setBundleAsPdf] = useState(true);

  // Camera capture state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  // Metadata fields
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<VaultDocType>('passport');
  const [folderId, setFolderId] = useState(defaultFolderId ?? '');
  const [expiryDate, setExpiryDate] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [issuer, setIssuer] = useState('');
  const [last4, setLast4] = useState('');
  const [notes, setNotes] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [encryptE2E, setEncryptE2E] = useState(false);

  type ExtractableField = 'title' | 'docType' | 'expiryDate' | 'issueDate' | 'issuer' | 'last4';
  const [extractedFlags, setExtractedFlags] = useState<Partial<Record<ExtractableField, boolean>>>({});
  const [confirmedFlags, setConfirmedFlags] = useState<Partial<Record<ExtractableField, boolean>>>({});

  const toggleConfirmField = (field: ExtractableField) => {
    setConfirmedFlags((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const applyLocalExtraction = (fileName?: string, text?: string) => {
    const ext = extractDocumentMetadataLocally({ fileName, text });
    const nextExtracted: Partial<Record<ExtractableField, boolean>> = {};
    const nextConfirmed: Partial<Record<ExtractableField, boolean>> = { ...confirmedFlags };

    if (ext.title && !confirmedFlags.title) {
      setTitle(ext.title);
      nextExtracted.title = true;
      nextConfirmed.title = false;
    }
    if (ext.docType && !confirmedFlags.docType) {
      setDocType(ext.docType);
      nextExtracted.docType = true;
      nextConfirmed.docType = false;
    }
    if (ext.expiryDate && !confirmedFlags.expiryDate) {
      setExpiryDate(ext.expiryDate);
      nextExtracted.expiryDate = true;
      nextConfirmed.expiryDate = false;
    }
    if (ext.issueDate && !confirmedFlags.issueDate) {
      setIssueDate(ext.issueDate);
      nextExtracted.issueDate = true;
      nextConfirmed.issueDate = false;
    }
    if (ext.issuer && !confirmedFlags.issuer) {
      setIssuer(ext.issuer);
      nextExtracted.issuer = true;
      nextConfirmed.issuer = false;
    }
    if (ext.documentNumberLast4 && !confirmedFlags.last4) {
      setLast4(ext.documentNumberLast4);
      nextExtracted.last4 = true;
      nextConfirmed.last4 = false;
    }
    if (ext.extractedText && !ocrText.trim()) {
      setOcrText(ext.extractedText);
    }

    setExtractedFlags((prev) => ({ ...prev, ...nextExtracted }));
    setConfirmedFlags(nextConfirmed);
  };

  const [processing, setProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    setFolderId(defaultFolderId ?? '');
    setError(null);
  }, [open, defaultFolderId]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (cameraActive && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {
        // Ignore autoplay promise rejection if user gesture already started it
      });
    }
  }, [cameraActive]);

  if (!open) return null;

  const resetAndClose = () => {
    stopCamera();
    setUploadedPdf(null);
    setPages([]);
    setActivePageIdx(0);
    setTitle('');
    setDocType('passport');
    setExpiryDate('');
    setIssueDate('');
    setIssuer('');
    setLast4('');
    setNotes('');
    setOcrText('');
    setEncryptE2E(false);
    setExtractedFlags({});
    setConfirmedFlags({});
    setError(null);
    onClose();
  };

  const addImagePage = async (
    rawDataUrl: string,
    suggestedTitle?: string,
    defaultPreset: ScanFilterPreset = 'original'
  ) => {
    setProcessing(true);
    setError(null);
    try {
      const enhanced = await enhanceScannedImage(rawDataUrl, {
        rotationDeg: 0,
        cropInsetPct: 0,
        filter: defaultPreset,
      });
      const newPage: ScannedPage = {
        id: `pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        rawDataUrl,
        rotationDeg: 0,
        cropInsetPct: 0,
        filter: defaultPreset,
        enhanced,
      };
      setUploadedPdf(null);
      setPages((prev) => {
        const next = [...prev, newPage];
        setActivePageIdx(next.length - 1);
        return next;
      });
      if (suggestedTitle && !title.trim()) {
        setTitle(suggestedTitle.replace(/\.[^.]+$/, '').slice(0, 120));
      }
      setProcessing(false);

      // Run 100% local on-device OCR in the background to extract passport/ID/invoice fields
      setOcrProgress(0);
      try {
        const recognized = await runLocalImageOcr(enhanced.dataUrl, (pct) => setOcrProgress(pct));
        if (recognized) {
          setOcrText((prev) => (prev ? `${prev}\n${recognized}`.slice(0, 2000) : recognized.slice(0, 2000)));
          applyLocalExtraction(suggestedTitle, recognized);
        } else {
          applyLocalExtraction(suggestedTitle);
        }
      } catch {
        // Non-fatal: user can still type or paste OCR text manually
        applyLocalExtraction(suggestedTitle);
      } finally {
        setOcrProgress(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process scanned image.');
    } finally {
      setProcessing(false);
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 50 * 1024 * 1024) {
        setError('Files must be under 50 MB.');
        continue;
      }
      if (file.type === 'application/pdf') {
        const bytes = await readFileAsBytes(file);
        setPages([]);
        setUploadedPdf({ name: file.name, bytes });
        const pdfText = extractTextFromPdfBytesLocally(bytes);
        applyLocalExtraction(file.name, pdfText);
        break;
      }
      if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file);
        await addImagePage(dataUrl, file.name);
      } else {
        setError('Please select a JPEG, PNG, WebP image, or PDF document.');
      }
    }
    e.target.value = '';
  };

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // On HTTP LAN or unsupported browsers, fall back directly to native camera input on mobile
      nativeCameraInputRef.current?.click();
      setCameraError('Live webcam preview requires HTTPS or localhost. Opened device camera / file picker instead.');
      return;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch {
        // Fallback for desktop webcams that reject ideal resolution/facingMode
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      setCameraActive(true);
    } catch {
      setCameraError('Camera permission denied or unavailable. Use "Take Photo" or "Upload Image / PDF" instead.');
    }
  };

  const captureFromCamera = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopCamera();
    await addImagePage(dataUrl, `Scanned Document ${new Date().toISOString().slice(0, 10)}`, 'vivid_color');
  };

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    setError(null);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 50 * 1024 * 1024) {
        setError('Files must be under 50 MB.');
        continue;
      }
      if (file.type === 'application/pdf') {
        const bytes = await readFileAsBytes(file);
        setPages([]);
        setUploadedPdf({ name: file.name, bytes });
        const pdfText = extractTextFromPdfBytesLocally(bytes);
        applyLocalExtraction(file.name, pdfText);
        break;
      }
      if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file);
        await addImagePage(dataUrl, file.name);
        applyLocalExtraction(file.name, ocrText);
      }
    }
  };

  const updateActivePageTransform = async (
    patch: Partial<Pick<ScannedPage, 'rotationDeg' | 'cropInsetPct' | 'filter'>>
  ) => {
    const target = pages[activePageIdx];
    if (!target) return;
    const nextPage: ScannedPage = { ...target, ...patch };
    setProcessing(true);
    try {
      const enhanced = await enhanceScannedImage(nextPage.rawDataUrl, {
        rotationDeg: nextPage.rotationDeg,
        cropInsetPct: nextPage.cropInsetPct,
        filter: nextPage.filter,
      });
      setPages((prev) =>
        prev.map((p, idx) => (idx === activePageIdx ? { ...nextPage, enhanced } : p))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transform failed.');
    } finally {
      setProcessing(false);
    }
  };

  const removePage = (idx: number) => {
    setPages((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setActivePageIdx((curr) => Math.max(0, Math.min(curr, next.length - 1)));
      return next;
    });
  };

  const performSave = async () => {
    if (!title.trim()) {
      setError('Document title is required.');
      return;
    }

    let payloadBytes: Uint8Array;
    let mimeType = 'application/pdf';
    let pageCount = 1;

    if (uploadedPdf) {
      payloadBytes = uploadedPdf.bytes;
      mimeType = 'application/pdf';
      pageCount = 1;
    } else if (pages.length > 0) {
      const enhancedPages = pages.map((p) => p.enhanced).filter((e): e is EnhancedScanResult => Boolean(e));
      if (enhancedPages.length === 0) {
        setError('Wait for scan enhancement to finish.');
        return;
      }
      pageCount = enhancedPages.length;
      if (bundleAsPdf || enhancedPages.length > 1) {
        payloadBytes = buildMultiPagePdfFromJpegs(
          enhancedPages.map((ep) => ({
            jpegBytes: ep.jpegBytes,
            width: ep.width,
            height: ep.height,
          }))
        );
        mimeType = 'application/pdf';
      } else {
        payloadBytes = enhancedPages[0].jpegBytes;
        mimeType = 'image/jpeg';
      }
    } else {
      // Allow metadata-only document record (e.g. tracking expiry date before scanning physical copy)
      payloadBytes = new TextEncoder().encode(
        `LifeOS Vault Metadata Record\nTitle: ${title.trim()}\nType: ${docType}\nExpiry: ${expiryDate || 'None'}\n`
      );
      mimeType = 'text/plain';
      pageCount = 1;
    }

    const combinedNotes = [
      issueDate ? `Issue Date: ${issueDate}` : '',
      notes.trim(),
    ]
      .filter(Boolean)
      .join('\n');

    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          folderId: folderId || undefined,
          title: title.trim(),
          docType,
          storageMode: 'local_only',
          mimeType,
          pageCount,
          expiryDate: expiryDate || undefined,
          issuer: issuer.trim() || undefined,
          documentNumberLast4: last4.trim() || undefined,
          tags: [],
          notes: combinedNotes || undefined,
          ocrText: ocrText.trim() || undefined,
          isEncrypted: encryptE2E,
          isLocked: encryptE2E,
        },
        payloadBytes
      );
      resetAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (encryptE2E && !vaultUnlocked) {
      onRequestUnlockE2E(() => {
        void performSave();
      });
      return;
    }
    await performSave();
  };

  const activePage = pages[activePageIdx];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('vault.addDocument')}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 sm:backdrop-blur-xs p-0 sm:p-4 overflow-y-auto anim-modal-backdrop"
      onClick={resetAndClose}
    >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-3xl rounded-none sm:rounded-2xl pt-safe pb-safe sm:pt-0 sm:pb-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-y-auto sm:my-auto sm:max-h-[90dvh] anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-hairline)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('vault.addDocument')}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Local-Only Vault · Raw files stay on-device (Zero Blaze storage billing)
            </p>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={resetAndClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-5 max-h-[82dvh] overflow-y-auto">
          {/* Capture / Upload Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => void handleDropFiles(e)}
            className={`rounded-xl border-2 border-dashed p-4 space-y-3 transition-colors ${
              isDragging
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Scan, Crop, Enhance &amp; Multi-Page PDF
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={(e) => void handleFilePicked(e)}
                  className="hidden"
                  aria-label="Upload document files"
                />
                <input
                  ref={nativeCameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => void handleFilePicked(e)}
                  className="hidden"
                  aria-label="Take photo with device camera"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                >
                  <FileUp className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>Upload Image / PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isNativeApp()) {
                      void captureNativePhotoDataUrl().then((dataUrl) => {
                        if (dataUrl) void addImagePage(dataUrl, 'Camera Scan');
                      });
                    } else {
                      nativeCameraInputRef.current?.click();
                    }
                  }}
                  className="sm:hidden inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                >
                  <Camera className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>Take Photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => (cameraActive ? stopCamera() : void startCamera())}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                >
                  <Camera className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>{cameraActive ? 'Stop Camera' : 'Camera Scan'}</span>
                </button>
              </div>
            </div>

            {!cameraActive && !uploadedPdf && pages.length === 0 && (
              <div className="py-4 text-center text-xs text-[var(--text-muted)]">
                Drag &amp; drop a photo or PDF here, or use Camera Scan / Upload above.
              </div>
            )}

            {cameraError && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{cameraError}</p>
            )}

            {cameraActive && (
              <div className="space-y-2.5">
                <div className="relative overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-black aspect-video">
                  <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void captureFromCamera()}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>Capture Page</span>
                  </button>
                </div>
              </div>
            )}

            {uploadedPdf && (
              <div className="flex items-center justify-between rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="h-4 w-4 text-[var(--accent)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {uploadedPdf.name}
                    </div>
                    <div className="font-numeric text-[11px] text-[var(--text-muted)]">
                      PDF · {formatBytes(uploadedPdf.bytes.byteLength)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove PDF"
                  onClick={() => setUploadedPdf(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {activePage && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-2 flex items-center justify-center min-h-[200px] max-h-[260px] overflow-hidden">
                  {activePage.enhanced ? (
                    <img
                      src={activePage.enhanced.dataUrl}
                      alt={`Scanned page ${activePageIdx + 1}`}
                      className="max-h-[240px] w-auto object-contain rounded-lg"
                    />
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">Enhancing scan...</span>
                  )}
                </div>

                <div className="space-y-3">
                  {/* Page strip */}
                  <div className="flex items-center justify-between">
                    <span className="font-numeric text-xs font-medium text-[var(--text-secondary)]">
                      Page {activePageIdx + 1} of {pages.length}
                      {activePage.enhanced ? ` · ${formatBytes(activePage.enhanced.sizeBytes)}` : ''}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add Page</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Remove current page"
                        onClick={() => removePage(activePageIdx)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {pages.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      {pages.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setActivePageIdx(idx)}
                          className={`font-numeric px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                            idx === activePageIdx
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                          }`}
                        >
                          P{idx + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Enhance Filter Presets */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                      <SlidersHorizontal className="h-3 w-3" />
                      <span>Enhance Filter</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[var(--bg-subtle)]">
                      {(
                        [
                          { id: 'original', label: 'Original' },
                          { id: 'document_bw', label: 'Doc B&W' },
                          { id: 'vivid_color', label: 'Vivid' },
                        ] as const
                      ).map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={processing}
                          onClick={() => void updateActivePageTransform({ filter: preset.id })}
                          className={`py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                            activePage.filter === preset.id
                              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotate + Edge Crop */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() =>
                        void updateActivePageTransform({
                          rotationDeg: (((activePage.rotationDeg + 90) % 360) as 0 | 90 | 180 | 270),
                        })
                      }
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>Rotate 90°</span>
                    </button>

                    <label className="flex-1 flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                      <Crop className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="whitespace-nowrap">Crop {activePage.cropInsetPct}%</span>
                      <input
                        type="range"
                        min={0}
                        max={20}
                        step={2}
                        value={activePage.cropInsetPct}
                        onChange={(e) =>
                          void updateActivePageTransform({ cropInsetPct: Number(e.target.value) })
                        }
                        className="w-full accent-[var(--accent)]"
                      />
                    </label>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] pt-1">
                    <input
                      type="checkbox"
                      checked={bundleAsPdf || pages.length > 1}
                      disabled={pages.length > 1}
                      onChange={(e) => setBundleAsPdf(e.target.checked)}
                      className="rounded accent-[var(--accent)]"
                    />
                    <span>Export scanned pages as multi-page PDF</span>
                  </label>
                </div>
              </div>
            )}

            {!uploadedPdf && pages.length === 0 && !cameraActive && (
              <p className="text-xs text-[var(--text-muted)]">
                Upload a photo/PDF or capture pages with your camera. You can also save a metadata-only record to track expiry dates now and attach scans later.
              </p>
            )}
          </div>

          {ocrProgress !== null && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <span>Reading document text on-device (no cloud upload)...</span>
              <span className="font-numeric font-semibold">{ocrProgress}%</span>
            </div>
          )}

          {/* Document Metadata Grid with Auto-Extraction & Per-Field Confirm */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  {t('vault.docTitleLabel')}
                </label>
                {extractedFlags.title && !confirmedFlags.title && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    Auto-extracted · Verify &amp; confirm
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setConfirmedFlags((p) => ({ ...p, title: false }));
                  }}
                  placeholder="e.g. Iraqi Passport — Main Holder"
                  className="flex-1 min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  aria-label="Confirm document title"
                  title={confirmedFlags.title ? 'Confirmed' : 'Confirm value'}
                  onClick={() => toggleConfirmField('title')}
                  className={`h-[42px] w-[42px] shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors ${
                    confirmedFlags.title
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : extractedFlags.title
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  {t('vault.docTypeLabel')}
                </label>
                {extractedFlags.docType && !confirmedFlags.docType && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Auto</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={docType}
                  onChange={(e) => {
                    setDocType(e.target.value as VaultDocType);
                    setConfirmedFlags((p) => ({ ...p, docType: false }));
                  }}
                  className="flex-1 min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {VAULT_DOC_TYPES.map((dt) => (
                    <option key={dt} value={dt}>
                      {t(VAULT_DOC_TYPE_META[dt].labelKey, VAULT_DOC_TYPE_META[dt].fallbackLabel)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Confirm document type"
                  title={confirmedFlags.docType ? 'Confirmed' : 'Confirm value'}
                  onClick={() => toggleConfirmField('docType')}
                  className={`h-[42px] w-[42px] shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors ${
                    confirmedFlags.docType
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : extractedFlags.docType
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t('vault.folderLabel')}
              </label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="">No folder (Root)</option>
                {flatFolders.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {'— '.repeat(depth)}
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  Issue Date (optional)
                </label>
                {extractedFlags.issueDate && !confirmedFlags.issueDate && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Auto</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => {
                    setIssueDate(e.target.value);
                    setConfirmedFlags((p) => ({ ...p, issueDate: false }));
                  }}
                  className="flex-1 min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  aria-label="Confirm issue date"
                  title={confirmedFlags.issueDate ? 'Confirmed' : 'Confirm value'}
                  onClick={() => toggleConfirmField('issueDate')}
                  className={`h-[42px] w-[42px] shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors ${
                    confirmedFlags.issueDate
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : extractedFlags.issueDate
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  {t('vault.expiryDateLabel')}
                </label>
                {extractedFlags.expiryDate && !confirmedFlags.expiryDate && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Auto</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => {
                    setExpiryDate(e.target.value);
                    setConfirmedFlags((p) => ({ ...p, expiryDate: false }));
                  }}
                  className="flex-1 min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  aria-label="Confirm expiry date"
                  title={confirmedFlags.expiryDate ? 'Confirmed' : 'Confirm value'}
                  onClick={() => toggleConfirmField('expiryDate')}
                  className={`h-[42px] w-[42px] shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors ${
                    confirmedFlags.expiryDate
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : extractedFlags.expiryDate
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  {t('vault.issuerLabel')}
                </label>
                {extractedFlags.issuer && !confirmedFlags.issuer && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Auto</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={120}
                  value={issuer}
                  onChange={(e) => {
                    setIssuer(e.target.value);
                    setConfirmedFlags((p) => ({ ...p, issuer: false }));
                  }}
                  placeholder="e.g. Directorate of Passports"
                  className="flex-1 min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  aria-label="Confirm issuer"
                  title={confirmedFlags.issuer ? 'Confirmed' : 'Confirm value'}
                  onClick={() => toggleConfirmField('issuer')}
                  className={`h-[42px] w-[42px] shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors ${
                    confirmedFlags.issuer
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : extractedFlags.issuer
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  Document / ID Number
                </label>
                {extractedFlags.last4 && !confirmedFlags.last4 && (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Auto</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={64}
                  value={last4}
                  onChange={(e) => {
                    setLast4(e.target.value);
                    setConfirmedFlags((p) => ({ ...p, last4: false }));
                  }}
                  placeholder="e.g. A12345678"
                  className="flex-1 min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  aria-label="Confirm last 4 digits"
                  title={confirmedFlags.last4 ? 'Confirmed' : 'Confirm value'}
                  onClick={() => toggleConfirmField('last4')}
                  className={`h-[42px] w-[42px] shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors ${
                    confirmedFlags.last4
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : extractedFlags.last4
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="w-full min-h-[42px] flex items-center justify-between gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 cursor-pointer">
                <span className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                  <Lock className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>Encrypt file (AES-256-GCM)</span>
                </span>
                <input
                  type="checkbox"
                  checked={encryptE2E}
                  onChange={(e) => setEncryptE2E(e.target.checked)}
                  className="rounded accent-[var(--accent)]"
                />
              </label>
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  On-Device Searchable OCR / Notes (optional)
                </label>
                {ocrText.trim() && (
                  <button
                    type="button"
                    onClick={() => applyLocalExtraction(title, ocrText)}
                    className="text-[11px] font-semibold text-[var(--accent)] hover:underline"
                  >
                    Auto-Extract Fields from Text
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                maxLength={2000}
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                placeholder="Paste extracted text or key details for offline search & auto-extraction..."
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-[11px] text-[var(--text-secondary)]">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--accent)] mt-0.5" />
            <span>
              <strong>Free-Tier Privacy Gate Active:</strong> Vault scans, passports, and IDs are stored strictly in local IndexedDB (Spark Free Tier) and are blocked from leaving your device for cloud AI processing.
            </span>
          </div>

          {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-hairline)]">
            <button
              type="button"
              onClick={resetAndClose}
              className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || processing}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : t('vault.saveDocument')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

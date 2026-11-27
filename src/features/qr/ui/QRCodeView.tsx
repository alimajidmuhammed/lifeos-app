import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  ExternalLink,
  ImagePlus,
  Link2,
  Move,
  Palette,
  Plus,
  QrCode,
  RotateCcw,
  Sparkles,
  Trash2,
  User,
  UserCircle2,
  X,
} from 'lucide-react';
import { useUIStore } from '../../../state/useUIStore';
import {
  DEFAULT_CUSTOM_THEME,
  encodeLinkProfile,
  LINK_ICON_OPTIONS,
  LINK_PROFILE_THEMES,
  LinkPlatformIcon,
  LinkProfileCardPreview,
  type LinkIconKey,
  type LinkProfilePayload,
} from './PublicLinkProfileView';

const STORAGE_KEY = 'lifeos_qr_link_profile_v1';
const MAX_AVATAR_BYTES = 200 * 1024;
const AVATAR_BG_SWATCHES = ['#FFFFFF', '#F1F5F9', '#0F172A', '#10B981', '#F59E0B', '#E11D48'];

function loadSavedProfile(): LinkProfilePayload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as LinkProfilePayload;
    }
  } catch {
    // Ignore
  }
  return {
    name: 'My LifeinOne Links',
    bio: 'All my important links in one place',
    avatarBg: '#FFFFFF',
    avatarPosX: 0,
    avatarPosY: 0,
    avatarZoom: 100,
    theme: 'emerald',
    customTheme: { ...DEFAULT_CUSTOM_THEME },
    links: [{ id: 'lnk_1', label: 'Website', url: 'https://lifeinone.app', icon: 'globe' }],
  };
}

/**
 * Compresses an uploaded image file on-device via Canvas so the resulting
 * data URL stays strictly under 200 KB (preserving PNG transparency if small enough).
 */
async function compressAvatarUnder200Kb(file: File): Promise<string> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image file.'));
    el.src = rawUrl;
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');

  let maxDim = 512;
  let quality = 0.86;
  let bestDataUrl = '';
  const hasTransparency = file.type === 'image/png' || file.type === 'image/webp';

  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const mime = hasTransparency && attempt < 3 ? 'image/webp' : 'image/jpeg';
    const candidate = canvas.toDataURL(mime, quality);
    const approxBytes = Math.ceil(candidate.split(',')[1].length * 0.75);
    bestDataUrl = candidate;

    if (approxBytes <= MAX_AVATAR_BYTES) {
      return candidate;
    }

    if (quality > 0.45) {
      quality -= 0.14;
    } else {
      maxDim = Math.round(maxDim * 0.75);
    }
  }

  return bestDataUrl;
}

export const QRCodeView: React.FC = () => {
  const showToast = useUIStore((s) => s.showToast);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origPosX: number;
    origPosY: number;
  }>({ active: false, startX: 0, startY: 0, origPosX: 50, origPosY: 50 });

  const [mode, setMode] = useState<'linktree' | 'single'>('linktree');
  const [singleUrl, setSingleUrl] = useState('https://lifeinone.app');
  const [qrColor, setQrColor] = useState('#0F172A');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [compressingImg, setCompressingImg] = useState(false);

  const [linkProfile, setLinkProfile] = useState<LinkProfilePayload>(loadSavedProfile);
  const [newIcon, setNewIcon] = useState<LinkIconKey>('telegram');
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(linkProfile));
    } catch {
      // Ignore
    }
  }, [linkProfile]);

  const profileShareUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lifeinone.app';
    const token = encodeLinkProfile(linkProfile);
    return `${origin}/?profile=${token}`;
  }, [linkProfile]);

  const targetQrValue =
    mode === 'single' ? singleUrl.trim() || 'https://lifeinone.app' : profileShareUrl;

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(targetQrValue, {
      width: 512,
      margin: 2,
      color: {
        dark: qrColor,
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [targetQrValue, qrColor]);

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCompressingImg(true);
    try {
      const dataUrl = await compressAvatarUnder200Kb(file);
      setLinkProfile((p) => ({
        ...p,
        avatarDataUrl: dataUrl,
        avatarPosX: 0,
        avatarPosY: 0,
        avatarZoom: 100,
      }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not process image.');
    } finally {
      setCompressingImg(false);
    }
  };

  const handleAvatarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!linkProfile.avatarDataUrl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origPosX: linkProfile.avatarPosX ?? 0,
      origPosY: linkProfile.avatarPosY ?? 0,
    };
  };

  const handleAvatarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nextX = Math.max(-80, Math.min(80, Math.round(dragRef.current.origPosX + dx * 0.8)));
    const nextY = Math.max(-80, Math.min(80, Math.round(dragRef.current.origPosY + dy * 0.8)));
    setLinkProfile((p) => ({ ...p, avatarPosX: nextX, avatarPosY: nextY }));
  };

  const handleAvatarPointerUp = () => {
    dragRef.current.active = false;
  };

  const handleAddLink = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = newUrl.trim();
    if (!cleanUrl) return;
    const defaultTitle =
      LINK_ICON_OPTIONS.find((o) => o.key === newIcon)?.label ??
      cleanUrl.replace(/^https?:\/\//, '').split('/')[0];
    const cleanLabel = newLabel.trim() || defaultTitle;
    setLinkProfile((prev) => ({
      ...prev,
      links: [
        ...prev.links,
        { id: `lnk_${Date.now()}`, label: cleanLabel, url: cleanUrl, icon: newIcon },
      ],
    }));
    setNewLabel('');
    setNewUrl('');
  };

  const handleRemoveLink = (id: string) => {
    setLinkProfile((prev) => ({
      ...prev,
      links: prev.links.filter((l) => l.id !== id),
    }));
  };

  const handleMoveLink = (index: number, delta: -1 | 1) => {
    setLinkProfile((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.links.length) return prev;
      const copy = [...prev.links];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return { ...prev, links: copy };
    });
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = mode === 'linktree' ? 'lifeinone-link-profile-qr.png' : 'lifeinone-qr.png';
    a.click();
    showToast('QR Code downloaded as PNG.');
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(targetQrValue);
      showToast('Link copied to clipboard.');
    } catch {
      showToast('Could not copy link.');
    }
  };

  const customTheme = { ...DEFAULT_CUSTOM_THEME, ...(linkProfile.customTheme ?? {}) };
  const updateCustomTheme = (patch: Partial<typeof customTheme>) => {
    setLinkProfile((p) => ({
      ...p,
      theme: 'custom',
      customTheme: { ...DEFAULT_CUSTOM_THEME, ...(p.customTheme ?? {}), ...patch },
    }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 dark:text-teal-400">
            <QrCode className="h-3.5 w-3.5" />
            <span>QR &amp; Link Hub</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            QR Code &amp; Link Profile
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)] max-w-2xl">
            Create a scannable Linktree-style profile for all your links, or generate a quick QR code for any URL.
          </p>
        </div>

        {/* Mode Switcher */}
        <div
          role="tablist"
          aria-label="QR Mode"
          className="inline-flex items-center gap-1 rounded-xl bg-[var(--bg-subtle)] p-1 self-start sm:self-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'linktree'}
            onClick={() => setMode('linktree')}
            className={`inline-flex items-center gap-1.5 min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'linktree'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <UserCircle2 className="h-3.5 w-3.5" />
            <span>Link Profile</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'single'}
            onClick={() => setMode('single')}
            className={`inline-flex items-center gap-1.5 min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'single'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>Single Link QR</span>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Editor */}
        <div className="lg:col-span-7 space-y-5">
          {mode === 'single' ? (
            <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 space-y-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Link2 className="h-4 w-4 text-[var(--accent)]" />
                <span>Website or Link URL</span>
              </h2>
              <input
                type="text"
                value={singleUrl}
                onChange={(e) => setSingleUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full min-h-[44px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </section>
          ) : (
            <>
              {/* Profile Details */}
              <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 space-y-5">
                <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                  <span>Profile Details</span>
                </h2>

                {/* Avatar Upload + Frame Drag + Background Color */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div
                    onPointerDown={handleAvatarPointerDown}
                    onPointerMove={handleAvatarPointerMove}
                    onPointerUp={handleAvatarPointerUp}
                    onPointerCancel={handleAvatarPointerUp}
                    style={{ backgroundColor: linkProfile.avatarBg || '#FFFFFF' }}
                    title={linkProfile.avatarDataUrl ? 'Drag to reposition image' : undefined}
                    className={`relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-[var(--border-hairline)] flex items-center justify-center touch-none select-none ${
                      linkProfile.avatarDataUrl ? 'cursor-grab active:cursor-grabbing' : ''
                    }`}
                  >
                    {linkProfile.avatarDataUrl ? (
                      <>
                        <img
                          src={linkProfile.avatarDataUrl}
                          alt="Profile avatar"
                          draggable={false}
                          style={{
                            transform: `translate(${linkProfile.avatarPosX ?? 0}%, ${linkProfile.avatarPosY ?? 0}%) scale(${(linkProfile.avatarZoom ?? 100) / 100})`,
                            transformOrigin: 'center center',
                          }}
                          className="h-full w-full object-contain pointer-events-none"
                        />
                        <span className="pointer-events-none absolute bottom-1 end-1 inline-flex h-5 w-5 items-center justify-center rounded-md bg-black/55 text-white">
                          <Move className="h-3 w-3" />
                        </span>
                      </>
                    ) : (
                      <User className="h-8 w-8 text-slate-400" />
                    )}
                  </div>

                  <div className="flex-1 space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleAvatarSelected(e)}
                      className="hidden"
                      aria-label="Upload profile photo"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={compressingImg}
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-50 btn-spring"
                      >
                        <ImagePlus className="h-3.5 w-3.5 text-[var(--accent)]" />
                        <span>{compressingImg ? 'Processing...' : 'Upload Photo'}</span>
                      </button>
                      {linkProfile.avatarDataUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            setLinkProfile((p) => ({ ...p, avatarDataUrl: undefined }))
                          }
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-[var(--border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-red-500"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>

                    {/* Image Background Color */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-[var(--text-muted)]">
                        Image Background:
                      </span>
                      {AVATAR_BG_SWATCHES.map((col) => (
                        <button
                          key={col}
                          type="button"
                          aria-label={`Image background ${col}`}
                          onClick={() => setLinkProfile((p) => ({ ...p, avatarBg: col }))}
                          className={`h-5 w-5 rounded-full border transition-transform ${
                            (linkProfile.avatarBg || '#FFFFFF') === col
                              ? 'border-[var(--accent)] scale-110 ring-2 ring-[var(--accent)]/30'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                          style={{ backgroundColor: col }}
                        />
                      ))}
                      <input
                        type="color"
                        aria-label="Custom image background color"
                        value={linkProfile.avatarBg || '#FFFFFF'}
                        onChange={(e) => setLinkProfile((p) => ({ ...p, avatarBg: e.target.value }))}
                        className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                    </div>

                    {/* Image Position & Zoom Controls */}
                    {linkProfile.avatarDataUrl && (
                      <div className="space-y-2 pt-1">
                        <div className="grid grid-cols-3 gap-2">
                          <label className="text-[11px] text-[var(--text-muted)] space-y-1">
                            <span>Left / Right ({linkProfile.avatarPosX ?? 0}%)</span>
                            <input
                              type="range"
                              min={-80}
                              max={80}
                              value={linkProfile.avatarPosX ?? 0}
                              onChange={(e) =>
                                setLinkProfile((p) => ({ ...p, avatarPosX: Number(e.target.value) }))
                              }
                              className="w-full accent-[var(--accent)]"
                            />
                          </label>
                          <label className="text-[11px] text-[var(--text-muted)] space-y-1">
                            <span>Up / Down ({linkProfile.avatarPosY ?? 0}%)</span>
                            <input
                              type="range"
                              min={-80}
                              max={80}
                              value={linkProfile.avatarPosY ?? 0}
                              onChange={(e) =>
                                setLinkProfile((p) => ({ ...p, avatarPosY: Number(e.target.value) }))
                              }
                              className="w-full accent-[var(--accent)]"
                            />
                          </label>
                          <label className="text-[11px] text-[var(--text-muted)] space-y-1">
                            <span>Zoom ({linkProfile.avatarZoom ?? 100}%)</span>
                            <input
                              type="range"
                              min={50}
                              max={250}
                              step={5}
                              value={linkProfile.avatarZoom ?? 100}
                              onChange={(e) =>
                                setLinkProfile((p) => ({ ...p, avatarZoom: Number(e.target.value) }))
                              }
                              className="w-full accent-[var(--accent)]"
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setLinkProfile((p) => ({
                              ...p,
                              avatarPosX: 0,
                              avatarPosY: 0,
                              avatarZoom: 100,
                            }))
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Reset position &amp; zoom</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      maxLength={60}
                      value={linkProfile.name}
                      onChange={(e) => setLinkProfile((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Your name or brand"
                      className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      Short Bio
                    </label>
                    <input
                      type="text"
                      maxLength={140}
                      value={linkProfile.bio}
                      onChange={(e) => setLinkProfile((p) => ({ ...p, bio: e.target.value }))}
                      placeholder="Designer, developer, creator..."
                      className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Theme Dropdown */}
                <div className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="qr-theme-select" className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Palette className="h-3.5 w-3.5 text-[var(--accent)]" />
                      <span>Theme</span>
                    </label>
                    <select
                      id="qr-theme-select"
                      value={linkProfile.theme}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'custom') {
                          updateCustomTheme({});
                        } else {
                          setLinkProfile((p) => ({ ...p, theme: val as typeof p.theme }));
                        }
                      }}
                      className="min-h-[38px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                    >
                      {LINK_PROFILE_THEMES.map((th) => (
                        <option key={th.id} value={th.id}>
                          {th.label}
                        </option>
                      ))}
                      <option value="custom">Custom Colors</option>
                    </select>
                  </div>

                  {/* Custom Background, Gradient, Text & Button Colors */}
                  {linkProfile.theme === 'custom' && (
                    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-3 anim-slide-up">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-primary)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={customTheme.useGradient}
                            onChange={(e) => updateCustomTheme({ useGradient: e.target.checked })}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                          <span>Use Gradient Background</span>
                        </label>
                        {customTheme.useGradient && (
                          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                            <span>Angle ({customTheme.gradientAngle}°)</span>
                            <input
                              type="range"
                              min={0}
                              max={360}
                              step={15}
                              value={customTheme.gradientAngle}
                              onChange={(e) =>
                                updateCustomTheme({ gradientAngle: Number(e.target.value) })
                              }
                              className="w-24 accent-[var(--accent)]"
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customTheme.bgColor1}
                            onChange={(e) => updateCustomTheme({ bgColor1: e.target.value })}
                            className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                          <span className="text-[var(--text-secondary)]">
                            {customTheme.useGradient ? 'Start' : 'Background'}
                          </span>
                        </label>

                        {customTheme.useGradient && (
                          <label className="flex items-center gap-2">
                            <input
                              type="color"
                              value={customTheme.bgColor2}
                              onChange={(e) => updateCustomTheme({ bgColor2: e.target.value })}
                              className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                            />
                            <span className="text-[var(--text-secondary)]">End</span>
                          </label>
                        )}

                        <label className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customTheme.textColor}
                            onChange={(e) => updateCustomTheme({ textColor: e.target.value })}
                            className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                          <span className="text-[var(--text-secondary)]">Text</span>
                        </label>

                        <label className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customTheme.buttonText}
                            onChange={(e) => updateCustomTheme({ buttonText: e.target.value })}
                            className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                          />
                          <span className="text-[var(--text-secondary)]">Btn Text</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Links Manager with Platform Icon Picker */}
              <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 space-y-4">
                <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-[var(--accent)]" />
                  <span>Your Links ({linkProfile.links.length})</span>
                </h2>

                <form onSubmit={handleAddLink} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <select
                    aria-label="Platform icon"
                    value={newIcon}
                    onChange={(e) => setNewIcon(e.target.value as LinkIconKey)}
                    className="sm:col-span-3 min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  >
                    {LINK_ICON_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Title (e.g. Telegram)"
                    className="sm:col-span-3 min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <input
                    type="text"
                    required
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="URL, phone, or email"
                    className="sm:col-span-4 min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-2 inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl bg-[var(--accent)] px-3 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] btn-spring"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add</span>
                  </button>
                </form>

                {linkProfile.links.length > 0 && (
                  <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] overflow-hidden">
                    {linkProfile.links.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 bg-[var(--bg-canvas)] px-3.5 py-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--accent)]">
                            <LinkPlatformIcon icon={item.icon} className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                              {item.label}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] truncate">
                              {item.url}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            aria-label={`Move ${item.label} up`}
                            disabled={idx === 0}
                            onClick={() => handleMoveLink(idx, -1)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${item.label} down`}
                            disabled={idx === linkProfile.links.length - 1}
                            onClick={() => handleMoveLink(idx, 1)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${item.label}`}
                            onClick={() => handleRemoveLink(item.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* Right: Live QR & Phone Preview */}
        <div className="lg:col-span-5 space-y-5">
          {/* Scannable QR Card */}
          <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 flex flex-col items-center text-center space-y-4">
            <div className="flex items-center justify-between w-full">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Scannable QR Code
              </span>
              <div className="flex items-center gap-1.5">
                {['#0F172A', '#059669', '#4F46E5', '#B91C1C'].map((col) => (
                  <button
                    key={col}
                    type="button"
                    aria-label={`QR color ${col}`}
                    onClick={() => setQrColor(col)}
                    className={`h-5 w-5 rounded-full border-2 transition-transform ${
                      qrColor === col ? 'border-[var(--accent)] scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: col }}
                  />
                ))}
              </div>
            </div>

            {qrDataUrl && (
              <div className="rounded-2xl border border-[var(--border-hairline)] bg-white p-3 shadow-sm anim-scale-in">
                <img
                  src={qrDataUrl}
                  alt="Generated QR Code"
                  className="h-48 w-48 object-contain"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2 w-full">
              <button
                type="button"
                onClick={handleDownloadQr}
                className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] btn-spring"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download PNG</span>
              </button>
              <button
                type="button"
                onClick={() => void handleCopyUrl()}
                className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] btn-spring"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Copy Link</span>
              </button>
              {mode === 'linktree' && (
                <a
                  href={profileShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                  title="Open public profile"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </section>

          {/* Live Linktree Preview */}
          {mode === 'linktree' && (
            <section className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-muted)] px-1">
                Live Mobile Preview (shown when scanned)
              </div>
              <LinkProfileCardPreview profile={linkProfile} compact />
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { ExternalLink, Globe, Mail, MapPin, Phone, Sparkles, User } from 'lucide-react';

export type LinkProfileTheme =
  | 'emerald'
  | 'midnight'
  | 'sunset'
  | 'minimal'
  | 'aurora'
  | 'obsidian'
  | 'rose'
  | 'nordic'
  | 'custom';

export type LinkIconKey =
  | 'globe'
  | 'telegram'
  | 'whatsapp'
  | 'instagram'
  | 'snapchat'
  | 'gmail'
  | 'phone'
  | 'map'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'facebook'
  | 'linkedin'
  | 'github';

export interface ProfileLinkItem {
  id: string;
  label: string;
  url: string;
  icon?: LinkIconKey;
}

export interface CustomThemeConfig {
  useGradient: boolean;
  bgColor1: string;
  bgColor2: string;
  gradientAngle: number;
  textColor: string;
  buttonBg: string;
  buttonText: string;
}

export interface LinkProfilePayload {
  name: string;
  bio: string;
  avatarDataUrl?: string;
  avatarBg?: string;
  avatarPosX?: number;
  avatarPosY?: number;
  avatarZoom?: number;
  theme: LinkProfileTheme;
  customTheme?: CustomThemeConfig;
  links: ProfileLinkItem[];
}

export const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
  useGradient: true,
  bgColor1: '#064e3b',
  bgColor2: '#0f172a',
  gradientAngle: 135,
  textColor: '#ffffff',
  buttonBg: '#ffffff24',
  buttonText: '#ffffff',
};

export const LINK_PROFILE_THEMES: Array<{
  id: Exclude<LinkProfileTheme, 'custom'>;
  label: string;
  swatch: string;
}> = [
  { id: 'emerald', label: 'Emerald Oasis', swatch: 'linear-gradient(135deg, #064e3b, #0f766e)' },
  { id: 'obsidian', label: 'Obsidian Gold', swatch: 'linear-gradient(135deg, #18181b, #92400e)' },
  { id: 'aurora', label: 'Northern Aurora', swatch: 'linear-gradient(135deg, #0f172a, #0d9488)' },
  { id: 'midnight', label: 'Midnight Indigo', swatch: 'linear-gradient(135deg, #020617, #3730a3)' },
  { id: 'rose', label: 'Velvet Rose', swatch: 'linear-gradient(135deg, #4c0519, #9f1239)' },
  { id: 'sunset', label: 'Warm Sunset', swatch: 'linear-gradient(135deg, #7c2d12, #c2410c)' },
  { id: 'nordic', label: 'Nordic Sage', swatch: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)' },
  { id: 'minimal', label: 'Minimal Paper', swatch: 'linear-gradient(135deg, #f8fafc, #e2e8f0)' },
];

export const LINK_ICON_OPTIONS: Array<{ key: LinkIconKey; label: string }> = [
  { key: 'globe', label: 'Website' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'snapchat', label: 'Snapchat' },
  { key: 'gmail', label: 'Gmail / Email' },
  { key: 'phone', label: 'Call / Phone' },
  { key: 'map', label: 'Map / Location' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'x', label: 'X / Twitter' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'github', label: 'GitHub' },
];

export const LinkPlatformIcon: React.FC<{ icon?: LinkIconKey; className?: string }> = ({
  icon = 'globe',
  className = 'h-4 w-4',
}) => {
  switch (icon) {
    case 'telegram':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M21.9 4.6 18.7 19.7c-.2 1-.8 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-7.9c.4-.3-.1-.5-.6-.2L6.6 13.7 2 12.2c-1-.3-1-1 .2-1.5l18-6.9c.8-.3 1.9.2 1.7.8Z" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
          <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
        </svg>
      );
    case 'snapchat':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M12 3c-3 0-5 2.2-5 5.2v2.1c-.8.1-1.5.5-1.5 1.1 0 .6.7 1 1.4 1.1-.4 1.7-1.6 3.1-3.4 3.7.7.8 2 1.1 3.1 1.2.4.8 1 1.5 1.9 1.5 1 0 1.8-.6 3.5-.6s2.5.6 3.5.6c.9 0 1.5-.7 1.9-1.5 1.1-.1 2.4-.4 3.1-1.2-1.8-.6-3-2-3.4-3.7.7-.1 1.4-.5 1.4-1.1 0-.6-.7-1-1.5-1.1V8.2C17 5.2 15 3 12 3Z" />
        </svg>
      );
    case 'gmail':
      return <Mail className={className} />;
    case 'phone':
      return <Phone className={className} />;
    case 'map':
      return <MapPin className={className} />;
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
          <path d="m10 15 5-3-5-3v6Z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
          <rect width="4" height="12" x="2" y="9" />
          <circle cx="4" cy="4" r="2" />
        </svg>
      );
    case 'github':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
          <path d="M9 18c-4.51 2-5-2-7-2" />
        </svg>
      );
    default:
      return <Globe className={className} />;
  }
};

export function encodeLinkProfile(profile: LinkProfilePayload): string {
  const compact = {
    n: profile.name,
    b: profile.bio,
    t: profile.theme,
    ...(profile.theme === 'custom' && profile.customTheme ? { ct: profile.customTheme } : {}),
    l: profile.links.map((x) => [x.label, x.url, x.icon || 'globe']),
  };
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeLinkProfile(token: string): LinkProfilePayload | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      n?: string;
      b?: string;
      t?: LinkProfileTheme;
      ct?: CustomThemeConfig;
      l?: [string, string, LinkIconKey?][];
    };
    return {
      name: parsed.n || 'LifeinOne Profile',
      bio: parsed.b || '',
      theme: parsed.t || 'emerald',
      customTheme: parsed.ct,
      links: Array.isArray(parsed.l)
        ? parsed.l.map(([label, url, icon], idx) => ({
            id: `pub_${idx}`,
            label: String(label || 'Link'),
            url: String(url || '#'),
            icon: icon || 'globe',
          }))
        : [],
    };
  } catch {
    return null;
  }
}

const THEME_CLASSES: Record<
  Exclude<LinkProfileTheme, 'custom'>,
  { bg: string; card: string; text: string; sub: string; btn: string }
> = {
  emerald: {
    bg: 'bg-gradient-to-br from-emerald-950 via-teal-900 to-slate-950',
    card: 'bg-white/10 border-white/15 backdrop-blur-md',
    text: 'text-white',
    sub: 'text-emerald-200/80',
    btn: 'bg-white/15 hover:bg-white/25 border-white/20 text-white',
  },
  obsidian: {
    bg: 'bg-gradient-to-br from-zinc-950 via-stone-900 to-amber-950/80',
    card: 'bg-amber-500/10 border-amber-400/25 backdrop-blur-md',
    text: 'text-amber-50',
    sub: 'text-amber-200/75',
    btn: 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/30 text-amber-50',
  },
  aurora: {
    bg: 'bg-gradient-to-br from-slate-950 via-teal-950 to-cyan-950',
    card: 'bg-teal-400/10 border-teal-300/20 backdrop-blur-md',
    text: 'text-cyan-50',
    sub: 'text-teal-200/80',
    btn: 'bg-teal-500/20 hover:bg-teal-500/30 border-teal-300/25 text-white',
  },
  midnight: {
    bg: 'bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900',
    card: 'bg-slate-900/70 border-indigo-400/20 backdrop-blur-md',
    text: 'text-white',
    sub: 'text-indigo-200/80',
    btn: 'bg-indigo-500/20 hover:bg-indigo-500/35 border-indigo-400/30 text-white',
  },
  rose: {
    bg: 'bg-gradient-to-br from-rose-950 via-pink-950 to-slate-950',
    card: 'bg-rose-400/10 border-rose-300/20 backdrop-blur-md',
    text: 'text-rose-50',
    sub: 'text-rose-200/80',
    btn: 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-300/25 text-white',
  },
  sunset: {
    bg: 'bg-gradient-to-br from-rose-950 via-orange-900 to-amber-950',
    card: 'bg-white/10 border-white/15 backdrop-blur-md',
    text: 'text-white',
    sub: 'text-amber-100/85',
    btn: 'bg-white/15 hover:bg-white/25 border-white/20 text-white',
  },
  nordic: {
    bg: 'bg-gradient-to-br from-[#EFECE6] via-[#E5E7EB] to-[#D8E2DC]',
    card: 'bg-white/80 border-slate-300/80 shadow-md',
    text: 'text-slate-900',
    sub: 'text-slate-600',
    btn: 'bg-white hover:bg-slate-50 border-slate-300/90 text-slate-900 shadow-xs',
  },
  minimal: {
    bg: 'bg-slate-50 dark:bg-slate-950',
    card: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xl',
    text: 'text-slate-900 dark:text-slate-50',
    sub: 'text-slate-600 dark:text-slate-400',
    btn: 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100',
  },
};

function normalizeSafeUrl(raw: string, icon?: LinkIconKey): string {
  const trimmed = raw.trim();
  if (!trimmed) return '#';
  if (icon === 'phone' && !/^tel:/i.test(trimmed) && /^[+\d\s()-]{5,}$/.test(trimmed)) {
    return `tel:${trimmed.replace(/\s+/g, '')}`;
  }
  if (icon === 'gmail' && !/^mailto:/i.test(trimmed) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `mailto:${trimmed}`;
  }
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export const LinkProfileCardPreview: React.FC<{
  profile: LinkProfilePayload;
  compact?: boolean;
}> = ({ profile, compact = false }) => {
  const isCustom = profile.theme === 'custom';
  const custom = { ...DEFAULT_CUSTOM_THEME, ...(profile.customTheme ?? {}) };
  const th =
    profile.theme === 'custom'
      ? THEME_CLASSES.emerald
      : (THEME_CLASSES[profile.theme] ?? THEME_CLASSES.emerald);

  const customContainerStyle: React.CSSProperties | undefined = isCustom
    ? {
        background: custom.useGradient
          ? `linear-gradient(${custom.gradientAngle}deg, ${custom.bgColor1}, ${custom.bgColor2})`
          : custom.bgColor1,
        color: custom.textColor,
      }
    : undefined;

  const customBtnStyle: React.CSSProperties | undefined = isCustom
    ? {
        backgroundColor: custom.buttonBg,
        color: custom.buttonText,
        borderColor: 'rgba(255,255,255,0.2)',
      }
    : undefined;

  const offsetX = profile.avatarPosX ?? 0;
  const offsetY = profile.avatarPosY ?? 0;
  const zoom = (profile.avatarZoom ?? 100) / 100;

  return (
    <div
      style={customContainerStyle}
      className={`w-full rounded-3xl ${isCustom ? '' : th.bg} ${compact ? 'p-5 min-h-[420px]' : 'min-h-dvh p-6'} flex flex-col items-center justify-between`}
    >
      <div className="w-full max-w-md mx-auto flex flex-col items-center text-center pt-4 space-y-5">
        <div
          style={profile.avatarBg ? { backgroundColor: profile.avatarBg } : undefined}
          className={`flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border shadow-lg ${
            profile.avatarBg ? 'border-white/25' : th.card
          }`}
        >
          {profile.avatarDataUrl ? (
            <img
              src={profile.avatarDataUrl}
              alt={profile.name || 'Profile avatar'}
              style={{
                transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
              className="h-full w-full object-contain transition-transform duration-100"
            />
          ) : (
            <User className={`h-9 w-9 opacity-80 ${isCustom ? '' : th.text}`} />
          )}
        </div>

        <div className="space-y-1.5">
          <h2
            style={isCustom ? { color: custom.textColor } : undefined}
            className={`font-display text-xl font-bold tracking-tight ${isCustom ? '' : th.text}`}
          >
            {profile.name || 'Your Name'}
          </h2>
          {profile.bio && (
            <p
              style={isCustom ? { color: custom.textColor, opacity: 0.8 } : undefined}
              className={`text-xs sm:text-sm max-w-xs mx-auto leading-relaxed ${isCustom ? '' : th.sub}`}
            >
              {profile.bio}
            </p>
          )}
        </div>

        <div className="w-full space-y-2.5 pt-2">
          {profile.links.length === 0 ? (
            <div
              style={isCustom ? customBtnStyle : undefined}
              className={`rounded-2xl border p-4 text-xs ${isCustom ? '' : `${th.card} ${th.sub}`}`}
            >
              Add links to see them here
            </div>
          ) : (
            profile.links.map((link) => (
              <a
                key={link.id}
                href={normalizeSafeUrl(link.url, link.icon)}
                target="_blank"
                rel="noopener noreferrer"
                style={isCustom ? customBtnStyle : undefined}
                className={`w-full min-h-[48px] rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 text-sm font-semibold transition-all btn-spring ${
                  isCustom ? 'hover:opacity-90' : th.btn
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <LinkPlatformIcon icon={link.icon} className="h-4 w-4 shrink-0 opacity-85" />
                  <span className="truncate">{link.label || link.url}</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </a>
            ))
          )}
        </div>
      </div>

      <div
        style={isCustom ? { color: custom.textColor, opacity: 0.7 } : undefined}
        className={`pt-8 pb-2 flex items-center gap-1.5 text-[11px] font-medium ${isCustom ? '' : th.sub}`}
      >
        <Sparkles className="h-3 w-3" />
        <span>LifeinOne Link Hub</span>
      </div>
    </div>
  );
};

export const PublicLinkProfileView: React.FC<{
  profile: LinkProfilePayload;
  onOpenApp: () => void;
}> = ({ profile, onOpenApp }) => {
  return (
    <div className="relative min-h-dvh">
      <LinkProfileCardPreview profile={profile} />
      <button
        type="button"
        onClick={onOpenApp}
        className="fixed bottom-4 end-4 z-20 rounded-full bg-slate-900/80 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-md border border-white/15 hover:bg-slate-900 transition-colors"
      >
        Open LifeinOne
      </button>
    </div>
  );
};

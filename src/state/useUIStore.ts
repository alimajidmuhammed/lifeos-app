import { create } from 'zustand';
import type { CurrencyCode, SupportedLocale } from '../core/currency/currency';
import {
  createDefaultUserProfile,
  type AiModuleToggles,
  type UserProfileData,
} from '../core/schemas/userProfileSchema';
import { PLAN_CATALOG, type PlanEntitlements } from '../core/entitlements/entitlements';
import type { AuthUserSummary, AiUsageRecord } from '../data/repositories/interfaces';
import i18n, { applyDocumentLocale } from '../core/i18n/i18n';

export type NavRoute =
  | 'home'
  | 'debts'
  | 'reminders'
  | 'planner'
  | 'notes'
  | 'vault'
  | 'habits'
  | 'finance'
  | 'settings';

export type ThemeMode = 'light' | 'dark' | 'amoled';

export interface ToastMessage {
  id: string;
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
}

const LOCAL_PROFILE_STORAGE_KEY = 'lifeos_local_profile_v1';
const LOCAL_PIN_STORAGE_KEY = 'lifeos_local_pin_hash_v1';
const LOCAL_AI_USAGE_KEY = 'lifeos_local_ai_usage_v1';

function loadLocalProfile(): UserProfileData {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_STORAGE_KEY);
    if (raw) {
      return { ...createDefaultUserProfile('local_offline_user'), ...JSON.parse(raw) };
    }
  } catch {
    // Ignore storage read failure
  }
  return createDefaultUserProfile('local_offline_user');
}

function saveLocalProfile(profile: UserProfileData): void {
  try {
    localStorage.setItem(LOCAL_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore
  }
}

export function applyDocumentTheme(theme: ThemeMode): void {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('dark', 'amoled');
    if (theme === 'dark') root.classList.add('dark');
    if (theme === 'amoled') root.classList.add('dark', 'amoled');
  }
  try {
    localStorage.setItem('lifeos_theme', theme);
  } catch {
    // Ignore
  }
}

export function hashPinQuick(pin: string): string {
  let h = 2166136261;
  for (let i = 0; i < pin.length; i++) {
    h ^= pin.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `pin_${(h >>> 0).toString(16)}`;
}

interface UIState {
  activeRoute: NavRoute;
  commandPaletteOpen: boolean;
  mobileMoreOpen: boolean;
  authReady: boolean;
  authUser: AuthUserSummary | null;
  profile: UserProfileData;
  entitlements: PlanEntitlements;
  todayAiUsage: AiUsageRecord;
  pinEnabled: boolean;
  isAppLocked: boolean;
  toast: ToastMessage | null;

  setActiveRoute: (route: NavRoute) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileMoreOpen: (open: boolean) => void;
  setAuthState: (user: AuthUserSummary | null, ready: boolean) => void;
  setProfile: (profile: UserProfileData) => void;
  patchLocalProfile: (patch: Partial<UserProfileData>) => void;
  setEntitlements: (entitlements: PlanEntitlements) => void;
  setTodayAiUsage: (usage: AiUsageRecord) => void;
  incrementLocalAiUsage: (dayKey: string, inTok: number, outTok: number) => void;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: SupportedLocale) => void;
  setCurrencies: (primary: CurrencyCode, secondary: CurrencyCode) => void;
  toggleAiModule: (moduleKey: keyof AiModuleToggles, enabled: boolean) => void;
  configurePinLock: (pin: string) => void;
  removePinLock: () => void;
  lockApp: () => void;
  unlockApp: (pin: string) => boolean;
  unlockAppDirect: () => void;
  showToast: (message: string, onUndo?: () => void) => void;
  dismissToast: () => void;
  density: 'comfortable' | 'compact';
  setDensity: (d: 'comfortable' | 'compact') => void;
  fontScale: number;
  setFontScale: (scale: number) => void;
}

const initialProfile = loadLocalProfile();
const initialPinHash = (() => {
  try {
    return localStorage.getItem(LOCAL_PIN_STORAGE_KEY);
  } catch {
    return null;
  }
})();

const initialUsage: AiUsageRecord = (() => {
  try {
    const raw = localStorage.getItem(LOCAL_AI_USAGE_KEY);
    if (raw) return JSON.parse(raw) as AiUsageRecord;
  } catch {
    // Ignore
  }
  return { dayKey: new Date().toISOString().slice(0, 10), requestCount: 0, inputTokensEst: 0, outputTokensEst: 0 };
})();

const initialDensity = (() => {
  try {
    const stored = localStorage.getItem('lifeos_density');
    if (stored === 'compact' || stored === 'comfortable') return stored;
  } catch {
    // Ignore
  }
  return 'comfortable';
})();

export function applyDocumentDensity(density: 'comfortable' | 'compact'): void {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (density === 'compact') {
      root.classList.add('density-compact');
    } else {
      root.classList.remove('density-compact');
    }
  }
  try {
    localStorage.setItem('lifeos_density', density);
  } catch {
    // Ignore
  }
}

const initialFontSize = (() => {
  try {
    const stored = Number(localStorage.getItem('lifeos_font_scale'));
    if (Number.isFinite(stored) && stored >= 85 && stored <= 125) return stored;
  } catch {
    // Ignore
  }
  return 100; // 100% default
})();

export function applyDocumentFontScale(scale: number): void {
  const clamped = Math.max(85, Math.min(125, Math.round(scale)));
  if (typeof document !== 'undefined') {
    document.documentElement.style.fontSize = `${clamped}%`;
  }
  try {
    localStorage.setItem('lifeos_font_scale', String(clamped));
  } catch {
    // Ignore
  }
}

// Initial apply
if (typeof document !== 'undefined') {
  applyDocumentDensity(initialDensity);
  applyDocumentFontScale(initialFontSize);
}

export const useUIStore = create<UIState>((set, get) => ({
  activeRoute: 'home',
  commandPaletteOpen: false,
  mobileMoreOpen: false,
  authReady: false,
  authUser: null,
  profile: initialProfile,
  entitlements: PLAN_CATALOG.free,
  todayAiUsage: initialUsage,
  pinEnabled: Boolean(initialPinHash),
  isAppLocked: false,
  toast: null,
  density: initialDensity,
  fontScale: initialFontSize,

  setActiveRoute: (route) => set({ activeRoute: route, mobileMoreOpen: false }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setMobileMoreOpen: (open) => set({ mobileMoreOpen: open }),

  setAuthState: (user, ready) => set({ authUser: user, authReady: ready }),

  setProfile: (profile) => {
    applyDocumentTheme(profile.theme);
    applyDocumentLocale(profile.locale);
    void i18n.changeLanguage(profile.locale);
    saveLocalProfile(profile);
    set({ profile });
  },

  patchLocalProfile: (patch) => {
    const next = { ...get().profile, ...patch };
    saveLocalProfile(next);
    set({ profile: next });
  },

  setEntitlements: (entitlements) => set({ entitlements }),
  setTodayAiUsage: (usage) => {
    try {
      localStorage.setItem(LOCAL_AI_USAGE_KEY, JSON.stringify(usage));
    } catch {
      // Ignore
    }
    set({ todayAiUsage: usage });
  },

  incrementLocalAiUsage: (dayKey, inTok, outTok) => {
    const curr = get().todayAiUsage;
    const next: AiUsageRecord =
      curr.dayKey === dayKey
        ? {
            dayKey,
            requestCount: curr.requestCount + 1,
            inputTokensEst: curr.inputTokensEst + inTok,
            outputTokensEst: curr.outputTokensEst + outTok,
          }
        : {
            dayKey,
            requestCount: 1,
            inputTokensEst: inTok,
            outputTokensEst: outTok,
          };
    try {
      localStorage.setItem(LOCAL_AI_USAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
    set({ todayAiUsage: next });
  },

  setTheme: (theme) => {
    applyDocumentTheme(theme);
    const next = { ...get().profile, theme };
    saveLocalProfile(next);
    set({ profile: next });
  },

  setLocale: (locale) => {
    applyDocumentLocale(locale);
    void i18n.changeLanguage(locale);
    const next = { ...get().profile, locale };
    saveLocalProfile(next);
    set({ profile: next });
  },

  setCurrencies: (primaryCurrency, secondaryCurrency) => {
    const next = { ...get().profile, primaryCurrency, secondaryCurrency };
    saveLocalProfile(next);
    set({ profile: next });
  },

  toggleAiModule: (moduleKey, enabled) => {
    const curr = get().profile;
    const nextToggles = {
      debts: true,
      reminders: true,
      planner: true,
      notes: true,
      vault: false,
      habits: true,
      finance: true,
      assistant: true,
      ...(curr.aiModuleToggles || {}),
      [moduleKey]: enabled,
    };
    const next = { ...curr, aiModuleToggles: nextToggles };
    saveLocalProfile(next);
    set({ profile: next });
  },

  configurePinLock: (pin) => {
    try {
      localStorage.setItem(LOCAL_PIN_STORAGE_KEY, hashPinQuick(pin));
    } catch {
      // Ignore
    }
    set({ pinEnabled: true });
  },

  removePinLock: () => {
    try {
      localStorage.removeItem(LOCAL_PIN_STORAGE_KEY);
    } catch {
      // Ignore
    }
    set({ pinEnabled: false, isAppLocked: false });
  },

  lockApp: () => {
    if (get().pinEnabled) {
      set({ isAppLocked: true });
    }
  },

  unlockApp: (pin) => {
    try {
      const stored = localStorage.getItem(LOCAL_PIN_STORAGE_KEY);
      if (stored && stored === hashPinQuick(pin)) {
        set({ isAppLocked: false });
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  },

  unlockAppDirect: () => {
    set({ isAppLocked: false });
  },

  showToast: (message, onUndo) => {
    const id = String(Date.now());
    set({ toast: { id, message, undoLabel: onUndo ? 'Undo' : undefined, onUndo } });
  },

  dismissToast: () => set({ toast: null }),

  setDensity: (density) => {
    applyDocumentDensity(density);
    set({ density });
  },

  setFontScale: (fontScale) => {
    applyDocumentFontScale(fontScale);
    set({ fontScale });
  },
}));

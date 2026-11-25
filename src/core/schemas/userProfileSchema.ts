import { z } from 'zod';

export const LocaleSchema = z.enum(['en', 'ar', 'ckb', 'kmr', 'fa', 'tr', 'ru', 'id', 'es', 'de']);
export const ThemeSchema = z.enum(['light', 'dark', 'amoled']);
export const CurrencySchema = z.enum(['IQD', 'USD', 'EUR']);
export const VaultStorageModeSchema = z.enum(['local_only', 'cloud_private']);

export const AiModuleTogglesSchema = z.object({
  debts: z.boolean().default(true),
  reminders: z.boolean().default(true),
  planner: z.boolean().default(true),
  notes: z.boolean().default(true),
  vault: z.boolean().default(false), // Disabled by default under Privacy Gate
  habits: z.boolean().default(true),
  finance: z.boolean().default(true),
  assistant: z.boolean().default(true),
});

export type AiModuleToggles = z.infer<typeof AiModuleTogglesSchema>;

export const UserProfileSchema = z.object({
  uid: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
  displayName: z.string().min(1).max(100),
  email: z.string().email().max(254).optional(),
  locale: LocaleSchema,
  theme: ThemeSchema,
  primaryCurrency: CurrencySchema,
  secondaryCurrency: CurrencySchema,
  vaultStorageMode: VaultStorageModeSchema,
  aiGlobalEnabled: z.boolean(),
  aiModuleToggles: AiModuleTogglesSchema.optional(),
  analyticsConsent: z.boolean(),
  aiPrivacyNoticeAccepted: z.boolean(),
  e2eConfigured: z.boolean(),
  e2eSalt: z.string().max(128).optional(),
  e2eVerifier: z.string().max(256).optional(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  version: z.number().int().min(1),
});

export type UserProfileData = z.infer<typeof UserProfileSchema>;

export const DEFAULT_AI_MODULE_TOGGLES: AiModuleToggles = {
  debts: true,
  reminders: true,
  planner: true,
  notes: true,
  vault: false,
  habits: true,
  finance: true,
  assistant: true,
};

export function createDefaultUserProfile(
  uid: string,
  displayName = 'Personal Workspace',
  email?: string
): UserProfileData {
  return {
    uid,
    displayName: displayName.slice(0, 100) || 'Personal Workspace',
    ...(email ? { email: email.slice(0, 254) } : {}),
    locale: 'en',
    theme: 'light',
    primaryCurrency: 'IQD',
    secondaryCurrency: 'USD',
    vaultStorageMode: 'local_only',
    aiGlobalEnabled: true,
    aiModuleToggles: { ...DEFAULT_AI_MODULE_TOGGLES },
    analyticsConsent: false,
    aiPrivacyNoticeAccepted: false,
    e2eConfigured: false,
    quietHoursStart: '22:30',
    quietHoursEnd: '07:00',
    version: 1,
  };
}

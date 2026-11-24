export type PlanTier = 'free' | 'pro' | 'family';

export interface PlanEntitlements {
  plan: PlanTier;
  aiDailyQuota: number;
  storageMbLimit: number;
  maxDocuments: number;
  e2eVaultAllowed: boolean;
  cloudDocumentAiAllowed: boolean;
}

export interface FeatureFlags {
  'auth.apple.enabled': boolean;
  'storage.cloud.enabled': boolean;
  'ai.free_tier': boolean;
  'billing.paywall.enabled': boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  'auth.apple.enabled': false, // Behind flag until Apple Developer account & Services ID configured
  'storage.cloud.enabled': false, // Stage 0 uses Spark free tier + Local-Only Vault
  'ai.free_tier': true, // Enforces hard Privacy Gate
  'billing.paywall.enabled': false, // Inactive during Stage 0 personal use
};

export const PLAN_CATALOG: Record<PlanTier, PlanEntitlements> = {
  free: {
    plan: 'free',
    aiDailyQuota: 75,
    storageMbLimit: 250,
    maxDocuments: 200,
    e2eVaultAllowed: true, // Local-only opt-in E2E enabled for Stage 0 owner privacy
    cloudDocumentAiAllowed: false,
  },
  pro: {
    plan: 'pro',
    aiDailyQuota: 250,
    storageMbLimit: 5120,
    maxDocuments: 2000,
    e2eVaultAllowed: true,
    cloudDocumentAiAllowed: true,
  },
  family: {
    plan: 'family',
    aiDailyQuota: 600,
    storageMbLimit: 15360,
    maxDocuments: 6000,
    e2eVaultAllowed: true,
    cloudDocumentAiAllowed: true,
  },
};

export interface QuotaCheckResult {
  allowed: boolean;
  usedToday: number;
  dailyLimit: number;
  remaining: number;
}

export function evaluateDailyAiQuota(
  usedToday: number,
  entitlements: PlanEntitlements
): QuotaCheckResult {
  const safeUsed = Math.max(0, Math.floor(usedToday));
  const remaining = Math.max(0, entitlements.aiDailyQuota - safeUsed);
  return {
    allowed: safeUsed < entitlements.aiDailyQuota,
    usedToday: safeUsed,
    dailyLimit: entitlements.aiDailyQuota,
    remaining,
  };
}

export function getTodayDayKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

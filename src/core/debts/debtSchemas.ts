import { z } from 'zod';
import type { CurrencyCode } from '../currency/currency';

export const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const DATE_YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const DebtDirectionSchema = z.enum(['i_owe', 'owed_to_me']);
export type DebtDirection = z.infer<typeof DebtDirectionSchema>;

export const DebtCategorySchema = z.enum([
  'personal',
  'family',
  'business',
  'loan',
  'bill_split',
  'other',
]);
export type DebtCategory = z.infer<typeof DebtCategorySchema>;

export const DebtStatusSchema = z.enum(['active', 'partial', 'overdue', 'settled']);
export type DebtStatus = z.infer<typeof DebtStatusSchema>;

export const PaymentMethodSchema = z.enum([
  'cash',
  'bank_transfer',
  'zaincash',
  'fib',
  'fastpay',
  'other',
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const CurrencyCodeSchema = z.enum(['IQD', 'USD', 'EUR']);

export const DebtRecordSchema = z
  .object({
    id: z.string().min(1).max(128).regex(ID_REGEX),
    uid: z.string().min(1).max(128).regex(ID_REGEX),
    direction: DebtDirectionSchema,
    personKey: z.string().min(1).max(128).regex(ID_REGEX),
    personName: z.string().trim().min(1).max(120),
    personPhone: z.string().trim().max(32).optional(),
    category: DebtCategorySchema,
    principalMinor: z.number().int().positive().max(1_000_000_000_000),
    remainingMinor: z.number().int().min(0).max(1_000_000_000_000),
    currency: CurrencyCodeSchema,
    dueDate: z.string().regex(DATE_YMD_REGEX).optional(),
    status: DebtStatusSchema,
    notes: z.string().max(2000).optional(),
    paymentCount: z.number().int().min(0).max(10_000),
    lastPaymentDate: z.string().regex(DATE_YMD_REGEX).optional(),
    version: z.number().int().min(1),
    createdAtIso: z.string().optional(),
    updatedAtIso: z.string().optional(),
  })
  .refine((d) => d.remainingMinor <= d.principalMinor, {
    message: 'Remaining balance cannot exceed principal amount.',
    path: ['remainingMinor'],
  })
  .refine(
    (d) => (d.remainingMinor === 0 ? d.status === 'settled' : d.status !== 'settled'),
    {
      message: 'Settled status must match zero remaining balance.',
      path: ['status'],
    }
  );

export type DebtRecord = z.infer<typeof DebtRecordSchema>;

export const DebtPaymentSchema = z.object({
  id: z.string().min(1).max(128).regex(ID_REGEX),
  uid: z.string().min(1).max(128).regex(ID_REGEX),
  debtId: z.string().min(1).max(128).regex(ID_REGEX),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  currency: CurrencyCodeSchema,
  paidOn: z.string().regex(DATE_YMD_REGEX),
  method: PaymentMethodSchema,
  note: z.string().max(500).optional(),
  wasOnTime: z.boolean(),
  createdAtIso: z.string().optional(),
});

export type DebtPayment = z.infer<typeof DebtPaymentSchema>;

export const DebtLedgerSchema = z.object({
  personKey: z.string().min(1).max(128).regex(ID_REGEX),
  uid: z.string().min(1).max(128).regex(ID_REGEX),
  personName: z.string().trim().min(1).max(120),
  personPhone: z.string().trim().max(32).optional(),
  onTimeCount: z.number().int().min(0),
  lateCount: z.number().int().min(0),
  activeDebtCount: z.number().int().min(0),
  version: z.number().int().min(1),
});

export type DebtLedger = z.infer<typeof DebtLedgerSchema>;

export const CreateDebtInputSchema = z.object({
  direction: DebtDirectionSchema,
  personName: z.string().trim().min(1, 'Person or lender name is required').max(120),
  personPhone: z.string().trim().max(32).optional(),
  category: DebtCategorySchema.default('personal'),
  principalMinor: z.number().int().positive('Amount must be greater than zero').max(1_000_000_000_000),
  currency: CurrencyCodeSchema,
  dueDate: z.string().regex(DATE_YMD_REGEX).optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateDebtInput = z.infer<typeof CreateDebtInputSchema>;

export const RecordPaymentInputSchema = z.object({
  debtId: z.string().min(1).max(128).regex(ID_REGEX),
  amountMinor: z.number().int().positive('Payment must be greater than zero').max(1_000_000_000_000),
  paidOn: z.string().regex(DATE_YMD_REGEX),
  method: PaymentMethodSchema.default('cash'),
  note: z.string().max(500).optional(),
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentInputSchema>;

export const AIParsedDebtDraftSchema = z.object({
  direction: DebtDirectionSchema,
  personName: z.string().trim().min(1).max(120),
  amountMajor: z.number().positive(),
  currency: CurrencyCodeSchema,
  category: DebtCategorySchema.default('personal'),
  dueDate: z.string().regex(DATE_YMD_REGEX).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  confidenceNote: z.string().max(240).nullable().optional(),
});

export type AIParsedDebtDraft = z.infer<typeof AIParsedDebtDraftSchema>;

/**
 * Generates a collision-resistant Firestore-safe personKey (`^[a-zA-Z0-9_-]+$`)
 * supporting English, Arabic, and Kurdish Sorani names identically.
 */
export function normalizePersonKey(rawName: string): string {
  const trimmed = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  const asciiSlug = trimmed
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return asciiSlug.length > 0 ? `p_${asciiSlug}_${suffix}` : `p_u_${suffix}`;
}

/**
 * Generates a deterministic-format Firestore-safe document ID.
 */
export function generateSafeEntityId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/**
 * Computes FX conversion rate between supported currencies using editable IQD base reference rates.
 */
export interface FxRatesToIqd {
  IQD: 1;
  USD: number;
  EUR: number;
}

export const DEFAULT_FX_RATES_TO_IQD: FxRatesToIqd = {
  IQD: 1,
  USD: 1500,
  EUR: 1620,
};

export function getCrossRate(from: CurrencyCode, to: CurrencyCode, rates: FxRatesToIqd): number {
  if (from === to) return 1;
  const fromInIqd = rates[from];
  const toInIqd = rates[to];
  return fromInIqd / toInIqd;
}

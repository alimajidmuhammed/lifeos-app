import { z } from 'zod';
import type { CurrencyCode } from '../currency/currency';

export const INCOME_CATEGORIES = ['salary', 'freelance', 'business', 'gift', 'other'] as const;

export const EXPENSE_CATEGORIES = [
  'housing',
  'food',
  'transport',
  'utilities',
  'health',
  'shopping',
  'subscriptions',
  'education',
  'entertainment',
  'debt_payment',
  'savings',
  'other',
] as const;

export const ALL_TRANSACTION_CATEGORIES = [
  'salary',
  'freelance',
  'business',
  'gift',
  'housing',
  'food',
  'transport',
  'utilities',
  'health',
  'shopping',
  'subscriptions',
  'education',
  'entertainment',
  'debt_payment',
  'savings',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type TransactionCategory = (typeof ALL_TRANSACTION_CATEGORIES)[number];

export const FINANCE_ACCOUNTS = ['cash', 'bank', 'zaincash', 'fib', 'fastpay', 'card'] as const;
export type FinanceAccount = (typeof FINANCE_ACCOUNTS)[number];

export const TRANSACTION_CATEGORY_LABELS: Record<TransactionCategory, string> = {
  salary: 'Salary',
  freelance: 'Freelance',
  business: 'Business',
  gift: 'Gift / Bonus',
  housing: 'Housing & Rent',
  food: 'Food & Groceries',
  transport: 'Transport & Fuel',
  utilities: 'Utilities & Internet',
  health: 'Health & Medical',
  shopping: 'Shopping',
  subscriptions: 'Subscriptions',
  education: 'Education',
  entertainment: 'Entertainment',
  debt_payment: 'Debt Payment',
  savings: 'Savings Transfer',
  other: 'Other',
};

export const FINANCE_ACCOUNT_LABELS: Record<FinanceAccount, string> = {
  cash: 'Cash',
  bank: 'Bank Account',
  zaincash: 'ZainCash',
  fib: 'FIB (First Iraqi Bank)',
  fastpay: 'FastPay',
  card: 'Card',
};

const dateYmdRegex = /^\d{4}-\d{2}-\d{2}$/;
const CurrencyEnum = z.enum(['IQD', 'USD', 'EUR']);

export const TransactionItemSchema = z.object({
  id: z.string().min(1).max(128),
  uid: z.string().min(1).max(128),
  type: z.enum(['income', 'expense']),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  currency: CurrencyEnum,
  category: z.enum(ALL_TRANSACTION_CATEGORIES),
  occurredOn: z.string().regex(dateYmdRegex),
  merchant: z.string().trim().max(120).optional(),
  account: z.enum(FINANCE_ACCOUNTS),
  note: z.string().trim().max(500).optional(),
  isRecurring: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TransactionItem = z.infer<typeof TransactionItemSchema>;

export const CreateTransactionInputSchema = z.object({
  type: z.enum(['income', 'expense']),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  currency: CurrencyEnum,
  category: z.enum(ALL_TRANSACTION_CATEGORIES),
  occurredOn: z.string().regex(dateYmdRegex),
  merchant: z.string().trim().max(120).optional(),
  account: z.enum(FINANCE_ACCOUNTS).default('cash'),
  note: z.string().trim().max(500).optional(),
  isRecurring: z.boolean().default(false),
});

export type CreateTransactionInput = z.infer<typeof CreateTransactionInputSchema>;

export const BudgetLimitSchema = z.object({
  id: z.string().min(1).max(128),
  uid: z.string().min(1).max(128),
  category: z.enum(EXPENSE_CATEGORIES),
  limitMinor: z.number().int().positive().max(1_000_000_000_000),
  currency: CurrencyEnum,
  alertThresholdPct: z.number().int().min(50).max(100),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BudgetLimit = z.infer<typeof BudgetLimitSchema>;

export const UpsertBudgetInputSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  limitMinor: z.number().int().positive().max(1_000_000_000_000),
  currency: CurrencyEnum,
  alertThresholdPct: z.number().int().min(50).max(100).default(80),
});

export type UpsertBudgetInput = z.infer<typeof UpsertBudgetInputSchema>;

export const SubscriptionCadenceSchema = z.enum(['weekly', 'monthly', 'yearly']);
export type SubscriptionCadence = z.infer<typeof SubscriptionCadenceSchema>;

export const SubscriptionStatusSchema = z.enum(['active', 'paused', 'cancelled']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const SubscriptionItemSchema = z.object({
  id: z.string().min(1).max(128),
  uid: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  currency: CurrencyEnum,
  cadence: SubscriptionCadenceSchema,
  nextBillingDate: z.string().regex(dateYmdRegex),
  category: z.enum(EXPENSE_CATEGORIES),
  status: SubscriptionStatusSchema,
  linkedReminderId: z.string().min(1).max(128).optional(),
  note: z.string().trim().max(500).optional(),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SubscriptionItem = z.infer<typeof SubscriptionItemSchema>;

export const CreateSubscriptionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amountMinor: z.number().int().positive().max(1_000_000_000_000),
  currency: CurrencyEnum,
  cadence: SubscriptionCadenceSchema.default('monthly'),
  nextBillingDate: z.string().regex(dateYmdRegex),
  category: z.enum(EXPENSE_CATEGORIES).default('subscriptions'),
  note: z.string().trim().max(500).optional(),
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInputSchema>;

export type FinanceCurrency = CurrencyCode;

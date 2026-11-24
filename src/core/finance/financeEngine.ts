import {
  convertMinorUnits,
  fromMinorUnits,
  toMinorUnits,
  type CurrencyCode,
  type FxRatesToIqd,
} from '../currency/currency';
import type { CreateReminderInput } from '../reminders/reminderSchemas';
import {
  ALL_TRANSACTION_CATEGORIES,
  FINANCE_ACCOUNTS,
  type BudgetLimit,
  type CreateTransactionInput,
  type ExpenseCategory,
  type FinanceAccount,
  type SubscriptionItem,
  type TransactionCategory,
  type TransactionItem,
} from './financeSchemas';

export interface CategorySpendItem {
  category: TransactionCategory;
  totalPrimaryMinor: number;
  sharePct: number;
  txCount: number;
}

export interface MonthlyCashflowSummary {
  monthKey: string;
  primaryCurrency: CurrencyCode;
  incomePrimaryMinor: number;
  expensePrimaryMinor: number;
  netPrimaryMinor: number;
  savingsRatePct: number;
  transactionCount: number;
  expenseBreakdown: CategorySpendItem[];
}

export interface BudgetEvaluation {
  budget: BudgetLimit;
  spentInBudgetCurrencyMinor: number;
  remainingMinor: number;
  usedPct: number;
  status: 'on_track' | 'warning' | 'exceeded';
}

export interface SubscriptionMetrics {
  activeCount: number;
  monthlyBurnPrimaryMinor: number;
  annualBurnPrimaryMinor: number;
  upcomingWithin14Days: SubscriptionItem[];
}

export interface ParsedCsvImportResult {
  validRows: CreateTransactionInput[];
  errors: Array<{ line: number; reason: string }>;
}

/**
 * Deterministic monthly cashflow aggregator in exact integer minor units.
 */
export function computeMonthlyFinanceSummary(
  transactions: TransactionItem[],
  monthKey: string,
  primaryCurrency: CurrencyCode,
  fxRates: FxRatesToIqd
): MonthlyCashflowSummary {
  let incomePrimaryMinor = 0;
  let expensePrimaryMinor = 0;
  let transactionCount = 0;
  const catMap = new Map<TransactionCategory, { total: number; count: number }>();

  for (const tx of transactions) {
    if (!tx.occurredOn.startsWith(monthKey)) continue;
    transactionCount += 1;
    const eqMinor = convertMinorUnits(tx.amountMinor, tx.currency, primaryCurrency, fxRates);
    if (tx.type === 'income') {
      incomePrimaryMinor += eqMinor;
    } else {
      expensePrimaryMinor += eqMinor;
      const prev = catMap.get(tx.category) ?? { total: 0, count: 0 };
      catMap.set(tx.category, { total: prev.total + eqMinor, count: prev.count + 1 });
    }
  }

  const netPrimaryMinor = incomePrimaryMinor - expensePrimaryMinor;
  const savingsRatePct =
    incomePrimaryMinor > 0
      ? Math.max(-100, Math.min(100, Math.round((netPrimaryMinor / incomePrimaryMinor) * 100)))
      : 0;

  const expenseBreakdown: CategorySpendItem[] = Array.from(catMap.entries())
    .map(([category, info]) => ({
      category,
      totalPrimaryMinor: info.total,
      sharePct: expensePrimaryMinor > 0 ? Math.round((info.total / expensePrimaryMinor) * 100) : 0,
      txCount: info.count,
    }))
    .sort((a, b) => b.totalPrimaryMinor - a.totalPrimaryMinor);

  return {
    monthKey,
    primaryCurrency,
    incomePrimaryMinor,
    expensePrimaryMinor,
    netPrimaryMinor,
    savingsRatePct,
    transactionCount,
    expenseBreakdown,
  };
}

/**
 * Evaluates each monthly category budget against actual spending in `monthKey`
 * (converting multi-currency expenses into each budget's declared currency via FX rates).
 */
export function evaluateMonthlyBudgets(
  budgets: BudgetLimit[],
  transactions: TransactionItem[],
  monthKey: string,
  fxRates: FxRatesToIqd
): BudgetEvaluation[] {
  return budgets
    .map((budget) => {
      let spent = 0;
      for (const tx of transactions) {
        if (tx.type !== 'expense') continue;
        if (!tx.occurredOn.startsWith(monthKey)) continue;
        if (tx.category !== (budget.category as TransactionCategory)) continue;
        spent += convertMinorUnits(tx.amountMinor, tx.currency, budget.currency, fxRates);
      }

      const usedPct = Math.round((spent / Math.max(1, budget.limitMinor)) * 100);
      const remainingMinor = budget.limitMinor - spent;
      const status: BudgetEvaluation['status'] =
        spent >= budget.limitMinor
          ? 'exceeded'
          : usedPct >= budget.alertThresholdPct
            ? 'warning'
            : 'on_track';

      return {
        budget,
        spentInBudgetCurrencyMinor: spent,
        remainingMinor,
        usedPct,
        status,
      };
    })
    .sort((a, b) => b.usedPct - a.usedPct);
}

/**
 * Computes normalized monthly & annualized recurring burn across active subscriptions.
 */
export function computeSubscriptionMetrics(
  subscriptions: SubscriptionItem[],
  primaryCurrency: CurrencyCode,
  fxRates: FxRatesToIqd,
  todayYmd: string
): SubscriptionMetrics {
  const active = subscriptions.filter((s) => s.status === 'active');
  let monthlyBurnPrimaryMinor = 0;
  const upcomingWithin14Days: SubscriptionItem[] = [];

  const todayMs = Date.parse(`${todayYmd}T00:00:00Z`);

  for (const sub of active) {
    const eqMinor = convertMinorUnits(sub.amountMinor, sub.currency, primaryCurrency, fxRates);
    const monthlyEq =
      sub.cadence === 'weekly'
        ? Math.round((eqMinor * 52) / 12)
        : sub.cadence === 'yearly'
          ? Math.round(eqMinor / 12)
          : eqMinor;
    monthlyBurnPrimaryMinor += monthlyEq;

    const billMs = Date.parse(`${sub.nextBillingDate}T00:00:00Z`);
    const diffDays = Math.round((billMs - todayMs) / 86_400_000);
    if (diffDays >= 0 && diffDays <= 14) {
      upcomingWithin14Days.push(sub);
    }
  }

  upcomingWithin14Days.sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate));

  return {
    activeCount: active.length,
    monthlyBurnPrimaryMinor,
    annualBurnPrimaryMinor: monthlyBurnPrimaryMinor * 12,
    upcomingWithin14Days,
  };
}

export function buildSubscriptionReminderInput(sub: SubscriptionItem): CreateReminderInput {
  const rrule =
    sub.cadence === 'weekly'
      ? 'FREQ=WEEKLY;INTERVAL=1'
      : sub.cadence === 'yearly'
        ? 'FREQ=YEARLY;INTERVAL=1'
        : 'FREQ=MONTHLY;INTERVAL=1';

  return {
    title: `Renew ${sub.name} (${fromMinorUnits(sub.amountMinor, sub.currency)} ${sub.currency})`,
    notes: `Recurring ${sub.cadence} subscription in Finance (${sub.category}).${sub.note ? ` ${sub.note}` : ''}`.slice(0, 1000),
    category: 'bill',
    priority: 'normal',
    dueAtIso: `${sub.nextBillingDate}T09:00:00.000Z`,
    rrule,
    respectQuietHours: true,
  };
}

/**
 * Neutralizes spreadsheet CSV formula injection (=, +, -, @, tab, CR) and applies RFC-4180 quoting.
 */
function csvEscapeSafe(raw: string): string {
  const trimmed = raw ?? '';
  const neutralized = /^[=+\-@\t\r]/.test(trimmed) ? `'${trimmed}` : trimmed;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function exportTransactionsToCsv(transactions: TransactionItem[]): string {
  const header = ['date', 'type', 'amount', 'currency', 'category', 'account', 'merchant', 'note'];
  const lines = [header.join(',')];

  const sorted = [...transactions].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  for (const tx of sorted) {
    const major = fromMinorUnits(tx.amountMinor, tx.currency);
    lines.push(
      [
        csvEscapeSafe(tx.occurredOn),
        csvEscapeSafe(tx.type),
        String(major),
        csvEscapeSafe(tx.currency),
        csvEscapeSafe(tx.category),
        csvEscapeSafe(tx.account),
        csvEscapeSafe(tx.merchant ?? ''),
        csvEscapeSafe(tx.note ?? ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

/**
 * Parses CSV text (header: date,type,amount,currency,category,account,merchant,note) into validated CreateTransactionInput drafts.
 */
export function parseTransactionsCsv(
  csvText: string,
  defaultCurrency: CurrencyCode = 'IQD'
): ParsedCsvImportResult {
  const rawLines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { validRows: [], errors: [{ line: 1, reason: 'CSV input is empty.' }] };
  }

  const validRows: CreateTransactionInput[] = [];
  const errors: Array<{ line: number; reason: string }> = [];

  const firstCells = splitCsvLine(rawLines[0]).map((c) => c.toLowerCase());
  const hasHeader = firstCells.includes('date') || firstCells.includes('amount') || firstCells.includes('type');
  const startIdx = hasHeader ? 1 : 0;

  const validCats = new Set<string>(ALL_TRANSACTION_CATEGORIES);
  const validAccounts = new Set<string>(FINANCE_ACCOUNTS);

  for (let i = startIdx; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const cols = splitCsvLine(rawLines[i]);
    if (cols.length < 3) {
      errors.push({ line: lineNo, reason: 'Expected at least date, type, amount columns.' });
      continue;
    }

    const [dateRaw, typeRaw, amountRaw, currRaw, catRaw, accRaw, merchantRaw, noteRaw] = cols;
    const occurredOn = dateRaw.replace(/^'/, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
      errors.push({ line: lineNo, reason: `Invalid date "${occurredOn}" (expected YYYY-MM-DD).` });
      continue;
    }

    const typeNorm = typeRaw.toLowerCase();
    if (typeNorm !== 'income' && typeNorm !== 'expense') {
      errors.push({ line: lineNo, reason: `Invalid type "${typeRaw}" (use income or expense).` });
      continue;
    }

    const amountNum = Number(amountRaw.replace(/,/g, ''));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      errors.push({ line: lineNo, reason: `Invalid amount "${amountRaw}".` });
      continue;
    }

    const currUpper = (currRaw || defaultCurrency).toUpperCase();
    const currency: CurrencyCode =
      currUpper === 'USD' || currUpper === 'EUR' || currUpper === 'IQD'
        ? currUpper
        : defaultCurrency;

    const amountMinor = toMinorUnits(amountNum, currency);
    if (amountMinor <= 0) {
      errors.push({ line: lineNo, reason: 'Amount converts to 0 minor units.' });
      continue;
    }

    const catNorm = (catRaw || 'other').toLowerCase();
    const category: TransactionCategory = validCats.has(catNorm)
      ? (catNorm as TransactionCategory)
      : 'other';

    const accNorm = (accRaw || 'cash').toLowerCase();
    const account: FinanceAccount = validAccounts.has(accNorm)
      ? (accNorm as FinanceAccount)
      : 'cash';

    const cleanMerchant = (merchantRaw ?? '').replace(/^'/, '').slice(0, 120) || undefined;
    const cleanNote = (noteRaw ?? '').replace(/^'/, '').slice(0, 500) || undefined;

    validRows.push({
      type: typeNorm,
      amountMinor,
      currency,
      category,
      occurredOn,
      account,
      merchant: cleanMerchant,
      note: cleanNote,
      isRecurring: false,
    });
  }

  return { validRows, errors };
}

export function isExpenseCategory(cat: string): cat is ExpenseCategory {
  return (
    cat === 'housing' ||
    cat === 'food' ||
    cat === 'transport' ||
    cat === 'utilities' ||
    cat === 'health' ||
    cat === 'shopping' ||
    cat === 'subscriptions' ||
    cat === 'education' ||
    cat === 'entertainment' ||
    cat === 'debt_payment' ||
    cat === 'savings' ||
    cat === 'other'
  );
}

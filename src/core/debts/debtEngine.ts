import { convertMinorUnits, type CurrencyCode } from '../currency/currency';
import {
  DEFAULT_FX_RATES_TO_IQD,
  getCrossRate,
  type DebtLedger,
  type DebtRecord,
  type DebtStatus,
  type FxRatesToIqd,
} from './debtSchemas';

export const SUPPORTED_CURRENCIES: CurrencyCode[] = ['IQD', 'USD', 'EUR'];

/**
 * Parses a YYYY-MM-DD date string into UTC epoch days (DST-safe integer day math).
 */
export function parseYmdToUtcDay(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

export function diffDaysYmd(fromYmd: string, toYmd: string): number {
  return parseYmdToUtcDay(toYmd) - parseYmdToUtcDay(fromYmd);
}

export function getTodayYmd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Computes effective debt status against a reference date (without mutating persisted state).
 */
export function computeEffectiveStatus(debt: DebtRecord, todayYmd: string = getTodayYmd()): DebtStatus {
  if (debt.remainingMinor === 0 || debt.status === 'settled') return 'settled';
  if (debt.dueDate && diffDaysYmd(todayYmd, debt.dueDate) < 0) return 'overdue';
  if (debt.remainingMinor < debt.principalMinor) return 'partial';
  return 'active';
}

export function computeDaysOverdue(debt: DebtRecord, todayYmd: string = getTodayYmd()): number {
  if (debt.remainingMinor === 0 || !debt.dueDate) return 0;
  const delta = diffDaysYmd(debt.dueDate, todayYmd);
  return delta > 0 ? delta : 0;
}

export interface CurrencyTotals {
  currency: CurrencyCode;
  owedToMeMinor: number;
  iOweMinor: number;
  netMinor: number;
  activeCount: number;
  overdueCount: number;
}

export interface DebtsSummaryMetrics {
  byCurrency: Record<CurrencyCode, CurrencyTotals>;
  primaryCurrency: CurrencyCode;
  equivalentOwedToMePrimaryMinor: number;
  equivalentIOwePrimaryMinor: number;
  equivalentNetPrimaryMinor: number;
  totalOpenCount: number;
  totalOverdueCount: number;
  totalSettledCount: number;
}

/**
 * Deterministic multi-currency debt aggregation in exact integer minor units.
 */
export function aggregateDebtMetrics(
  debts: DebtRecord[],
  primaryCurrency: CurrencyCode,
  fxRates: FxRatesToIqd = DEFAULT_FX_RATES_TO_IQD,
  todayYmd: string = getTodayYmd()
): DebtsSummaryMetrics {
  const byCurrency: Record<CurrencyCode, CurrencyTotals> = {
    IQD: { currency: 'IQD', owedToMeMinor: 0, iOweMinor: 0, netMinor: 0, activeCount: 0, overdueCount: 0 },
    USD: { currency: 'USD', owedToMeMinor: 0, iOweMinor: 0, netMinor: 0, activeCount: 0, overdueCount: 0 },
    EUR: { currency: 'EUR', owedToMeMinor: 0, iOweMinor: 0, netMinor: 0, activeCount: 0, overdueCount: 0 },
  };

  let totalOpenCount = 0;
  let totalOverdueCount = 0;
  let totalSettledCount = 0;

  for (const debt of debts) {
    const effStatus = computeEffectiveStatus(debt, todayYmd);
    if (effStatus === 'settled') {
      totalSettledCount += 1;
      continue;
    }

    totalOpenCount += 1;
    const bucket = byCurrency[debt.currency];
    bucket.activeCount += 1;

    if (effStatus === 'overdue') {
      bucket.overdueCount += 1;
      totalOverdueCount += 1;
    }

    if (debt.direction === 'owed_to_me') {
      bucket.owedToMeMinor += debt.remainingMinor;
    } else {
      bucket.iOweMinor += debt.remainingMinor;
    }
    bucket.netMinor = bucket.owedToMeMinor - bucket.iOweMinor;
  }

  let equivalentOwedToMePrimaryMinor = 0;
  let equivalentIOwePrimaryMinor = 0;

  for (const c of SUPPORTED_CURRENCIES) {
    const bucket = byCurrency[c];
    const rate = getCrossRate(c, primaryCurrency, fxRates);
    if (bucket.owedToMeMinor > 0) {
      equivalentOwedToMePrimaryMinor += convertMinorUnits(bucket.owedToMeMinor, c, primaryCurrency, rate);
    }
    if (bucket.iOweMinor > 0) {
      equivalentIOwePrimaryMinor += convertMinorUnits(bucket.iOweMinor, c, primaryCurrency, rate);
    }
  }

  return {
    byCurrency,
    primaryCurrency,
    equivalentOwedToMePrimaryMinor,
    equivalentIOwePrimaryMinor,
    equivalentNetPrimaryMinor: equivalentOwedToMePrimaryMinor - equivalentIOwePrimaryMinor,
    totalOpenCount,
    totalOverdueCount,
    totalSettledCount,
  };
}

export interface RepaymentProbabilityResult {
  score: number; // 0..100
  band: 'high' | 'moderate' | 'at_risk';
  factors: string[];
}

/**
 * Transparent, deterministic repayment probability estimator for `owed_to_me` debts.
 * Never uses AI or hidden weights: combines Laplace-smoothed counterparty history,
 * partial repayment progress, and overdue aging decay.
 */
export function estimateRepaymentProbability(
  debt: DebtRecord,
  ledger: Pick<DebtLedger, 'onTimeCount' | 'lateCount'> | null,
  todayYmd: string = getTodayYmd()
): RepaymentProbabilityResult {
  if (debt.remainingMinor === 0 || debt.status === 'settled') {
    return { score: 100, band: 'high', factors: ['Settled in full'] };
  }

  const factors: string[] = [];
  let score = 72; // Neutral baseline prior

  const onTime = ledger?.onTimeCount ?? 0;
  const late = ledger?.lateCount ?? 0;
  const totalHistory = onTime + late;

  if (totalHistory > 0) {
    // Laplace-smoothed reliability vs 0.72 baseline
    const smoothedRate = (onTime + 2) / (totalHistory + 3);
    const historyDelta = Math.round((smoothedRate - 0.67) * 38);
    score += historyDelta;
    factors.push(`History: ${onTime} on-time / ${late} late (${historyDelta >= 0 ? '+' : ''}${historyDelta})`);
  } else {
    factors.push('No prior payment history (neutral baseline)');
  }

  const paidRatio = (debt.principalMinor - debt.remainingMinor) / debt.principalMinor;
  if (paidRatio > 0) {
    const progressBoost = Math.round(paidRatio * 18);
    score += progressBoost;
    factors.push(`${Math.round(paidRatio * 100)}% already repaid (+${progressBoost})`);
  }

  const daysOverdue = computeDaysOverdue(debt, todayYmd);
  if (daysOverdue > 0) {
    let penalty = 0;
    if (daysOverdue <= 7) penalty = 10;
    else if (daysOverdue <= 30) penalty = 22;
    else if (daysOverdue <= 90) penalty = 38;
    else penalty = 52;
    score -= penalty;
    factors.push(`${daysOverdue}d overdue (-${penalty})`);
  } else if (debt.dueDate) {
    const daysUntil = diffDaysYmd(todayYmd, debt.dueDate);
    if (daysUntil >= 0 && daysUntil <= 7) {
      factors.push(`Due in ${daysUntil}d`);
    }
  } else {
    score -= 4;
    factors.push('No due date set (-4)');
  }

  const clamped = Math.max(5, Math.min(99, score));
  const band: 'high' | 'moderate' | 'at_risk' =
    clamped >= 70 ? 'high' : clamped >= 45 ? 'moderate' : 'at_risk';

  return { score: clamped, band, factors };
}

export interface PersonLedgerRollup {
  personKey: string;
  personName: string;
  personPhone?: string;
  activeCount: number;
  overdueCount: number;
  settledCount: number;
  onTimeCount: number;
  lateCount: number;
  netByCurrencyMinor: Record<CurrencyCode, number>;
  owedToMeByCurrencyMinor: Record<CurrencyCode, number>;
  iOweByCurrencyMinor: Record<CurrencyCode, number>;
  avgRepaymentScore: number | null;
}

export function buildPersonLedgerRollups(
  debts: DebtRecord[],
  ledgersByKey: Record<string, DebtLedger>,
  todayYmd: string = getTodayYmd()
): PersonLedgerRollup[] {
  const map = new Map<string, PersonLedgerRollup & { scoreSum: number; scoreCount: number }>();

  for (const debt of debts) {
    const existing = map.get(debt.personKey) ?? {
      personKey: debt.personKey,
      personName: debt.personName,
      personPhone: debt.personPhone ?? ledgersByKey[debt.personKey]?.personPhone,
      activeCount: 0,
      overdueCount: 0,
      settledCount: 0,
      onTimeCount: ledgersByKey[debt.personKey]?.onTimeCount ?? 0,
      lateCount: ledgersByKey[debt.personKey]?.lateCount ?? 0,
      netByCurrencyMinor: { IQD: 0, USD: 0, EUR: 0 },
      owedToMeByCurrencyMinor: { IQD: 0, USD: 0, EUR: 0 },
      iOweByCurrencyMinor: { IQD: 0, USD: 0, EUR: 0 },
      avgRepaymentScore: null,
      scoreSum: 0,
      scoreCount: 0,
    };

    if (!existing.personPhone && debt.personPhone) {
      existing.personPhone = debt.personPhone;
    }

    const eff = computeEffectiveStatus(debt, todayYmd);
    if (eff === 'settled') {
      existing.settledCount += 1;
    } else {
      existing.activeCount += 1;
      if (eff === 'overdue') existing.overdueCount += 1;
      if (debt.direction === 'owed_to_me') {
        existing.owedToMeByCurrencyMinor[debt.currency] += debt.remainingMinor;
        existing.netByCurrencyMinor[debt.currency] += debt.remainingMinor;
        const prob = estimateRepaymentProbability(debt, ledgersByKey[debt.personKey] ?? null, todayYmd);
        existing.scoreSum += prob.score;
        existing.scoreCount += 1;
      } else {
        existing.iOweByCurrencyMinor[debt.currency] += debt.remainingMinor;
        existing.netByCurrencyMinor[debt.currency] -= debt.remainingMinor;
      }
    }

    map.set(debt.personKey, existing);
  }

  return Array.from(map.values())
    .map(({ scoreSum, scoreCount, ...rest }) => ({
      ...rest,
      avgRepaymentScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
    }))
    .sort((a, b) => b.activeCount - a.activeCount || a.personName.localeCompare(b.personName));
}

export type PayoffStrategy = 'snowball' | 'avalanche';

export interface PayoffPlanItem {
  debtId: string;
  personName: string;
  currency: CurrencyCode;
  remainingOriginalMinor: number;
  remainingPrimaryMinor: number;
  interestRateBps: number;
  payoffMonth: number; // 1-indexed month when balance reaches 0, or -1 if > maxMonths
  estimatedInterestPrimaryMinor: number;
}

export interface PayoffPlanResult {
  strategy: PayoffStrategy;
  primaryCurrency: CurrencyCode;
  monthlyBudgetPrimaryMinor: number;
  totalMonths: number;
  cappedAtMaxMonths: boolean;
  totalPrincipalPrimaryMinor: number;
  totalInterestPrimaryMinor: number;
  items: PayoffPlanItem[];
}

/**
 * Deterministic Snowball (smallest balance first) vs. Avalanche (highest APR first) payoff planner
 * for open `i_owe` debts converted into the user's primary currency in integer minor units.
 */
export function computePayoffPlan(
  debts: DebtRecord[],
  strategy: PayoffStrategy,
  monthlyBudgetPrimaryMinor: number,
  primaryCurrency: CurrencyCode,
  fxRates: FxRatesToIqd = DEFAULT_FX_RATES_TO_IQD,
  maxMonths = 120
): PayoffPlanResult {
  const openIOwe = debts.filter((d) => d.direction === 'i_owe' && d.remainingMinor > 0 && d.status !== 'settled');

  if (openIOwe.length === 0 || monthlyBudgetPrimaryMinor <= 0) {
    return {
      strategy,
      primaryCurrency,
      monthlyBudgetPrimaryMinor: Math.max(0, Math.round(monthlyBudgetPrimaryMinor)),
      totalMonths: 0,
      cappedAtMaxMonths: false,
      totalPrincipalPrimaryMinor: 0,
      totalInterestPrimaryMinor: 0,
      items: [],
    };
  }

  const working = openIOwe.map((d) => {
    const rate = getCrossRate(d.currency, primaryCurrency, fxRates);
    const primaryRemaining = Math.max(1, convertMinorUnits(d.remainingMinor, d.currency, primaryCurrency, rate));
    return {
      debt: d,
      initialPrimary: primaryRemaining,
      balance: primaryRemaining,
      interestAccrued: 0,
      payoffMonth: -1,
    };
  });

  // Sort strictly deterministically
  working.sort((a, b) => {
    if (strategy === 'snowball') {
      return (
        a.initialPrimary - b.initialPrimary ||
        b.debt.interestRateBps - a.debt.interestRateBps ||
        (a.debt.dueDate ?? '9999-99-99').localeCompare(b.debt.dueDate ?? '9999-99-99')
      );
    }
    return (
      b.debt.interestRateBps - a.debt.interestRateBps ||
      a.initialPrimary - b.initialPrimary ||
      (a.debt.dueDate ?? '9999-99-99').localeCompare(b.debt.dueDate ?? '9999-99-99')
    );
  });

  const totalPrincipalPrimaryMinor = working.reduce((sum, w) => sum + w.initialPrimary, 0);
  let month = 0;

  while (month < maxMonths && working.some((w) => w.balance > 0)) {
    month += 1;

    // 1. Accrue monthly interest in integer minor units (APR bps / 10000 / 12)
    for (const w of working) {
      if (w.balance > 0 && w.debt.interestRateBps > 0) {
        const monthlyInterest = Math.round((w.balance * w.debt.interestRateBps) / 120_000);
        w.balance += monthlyInterest;
        w.interestAccrued += monthlyInterest;
      }
    }

    // 2. Apply monthly budget sequentially according to strategy order
    let budgetLeft = Math.round(monthlyBudgetPrimaryMinor);
    for (const w of working) {
      if (budgetLeft <= 0) break;
      if (w.balance <= 0) continue;
      const pay = Math.min(w.balance, budgetLeft);
      w.balance -= pay;
      budgetLeft -= pay;
      if (w.balance === 0 && w.payoffMonth === -1) {
        w.payoffMonth = month;
      }
    }
  }

  const cappedAtMaxMonths = working.some((w) => w.balance > 0);
  const totalInterestPrimaryMinor = working.reduce((sum, w) => sum + w.interestAccrued, 0);

  return {
    strategy,
    primaryCurrency,
    monthlyBudgetPrimaryMinor: Math.round(monthlyBudgetPrimaryMinor),
    totalMonths: month,
    cappedAtMaxMonths,
    totalPrincipalPrimaryMinor,
    totalInterestPrimaryMinor,
    items: working.map((w) => ({
      debtId: w.debt.id,
      personName: w.debt.personName,
      currency: w.debt.currency,
      remainingOriginalMinor: w.debt.remainingMinor,
      remainingPrimaryMinor: w.initialPrimary,
      interestRateBps: w.debt.interestRateBps,
      payoffMonth: w.payoffMonth,
      estimatedInterestPrimaryMinor: w.interestAccrued,
    })),
  };
}

export type CashFlowHorizonId = 'overdue' | 'days_0_30' | 'days_31_60' | 'days_61_90' | 'beyond_90' | 'no_date';

export interface CashFlowBucket {
  id: CashFlowHorizonId;
  inflowPrimaryMinor: number;
  outflowPrimaryMinor: number;
  netPrimaryMinor: number;
  inflowCount: number;
  outflowCount: number;
}

/**
 * Deterministic 30/60/90-day cash-flow forecast for open debts.
 */
export function buildCashFlowForecast(
  debts: DebtRecord[],
  primaryCurrency: CurrencyCode,
  fxRates: FxRatesToIqd = DEFAULT_FX_RATES_TO_IQD,
  todayYmd: string = getTodayYmd()
): CashFlowBucket[] {
  const order: CashFlowHorizonId[] = ['overdue', 'days_0_30', 'days_31_60', 'days_61_90', 'beyond_90', 'no_date'];
  const map: Record<CashFlowHorizonId, CashFlowBucket> = {
    overdue: { id: 'overdue', inflowPrimaryMinor: 0, outflowPrimaryMinor: 0, netPrimaryMinor: 0, inflowCount: 0, outflowCount: 0 },
    days_0_30: { id: 'days_0_30', inflowPrimaryMinor: 0, outflowPrimaryMinor: 0, netPrimaryMinor: 0, inflowCount: 0, outflowCount: 0 },
    days_31_60: { id: 'days_31_60', inflowPrimaryMinor: 0, outflowPrimaryMinor: 0, netPrimaryMinor: 0, inflowCount: 0, outflowCount: 0 },
    days_61_90: { id: 'days_61_90', inflowPrimaryMinor: 0, outflowPrimaryMinor: 0, netPrimaryMinor: 0, inflowCount: 0, outflowCount: 0 },
    beyond_90: { id: 'beyond_90', inflowPrimaryMinor: 0, outflowPrimaryMinor: 0, netPrimaryMinor: 0, inflowCount: 0, outflowCount: 0 },
    no_date: { id: 'no_date', inflowPrimaryMinor: 0, outflowPrimaryMinor: 0, netPrimaryMinor: 0, inflowCount: 0, outflowCount: 0 },
  };

  for (const d of debts) {
    if (d.remainingMinor === 0 || d.status === 'settled') continue;

    let bucketId: CashFlowHorizonId = 'no_date';
    if (d.dueDate) {
      const delta = diffDaysYmd(todayYmd, d.dueDate);
      if (delta < 0) bucketId = 'overdue';
      else if (delta <= 30) bucketId = 'days_0_30';
      else if (delta <= 60) bucketId = 'days_31_60';
      else if (delta <= 90) bucketId = 'days_61_90';
      else bucketId = 'beyond_90';
    }

    const rate = getCrossRate(d.currency, primaryCurrency, fxRates);
    const amountPrimary = convertMinorUnits(d.remainingMinor, d.currency, primaryCurrency, rate);
    const bucket = map[bucketId];

    if (d.direction === 'owed_to_me') {
      bucket.inflowPrimaryMinor += amountPrimary;
      bucket.inflowCount += 1;
    } else {
      bucket.outflowPrimaryMinor += amountPrimary;
      bucket.outflowCount += 1;
    }
    bucket.netPrimaryMinor = bucket.inflowPrimaryMinor - bucket.outflowPrimaryMinor;
  }

  return order.map((id) => map[id]);
}

/**
 * Pure payment transition calculation (enforces zero negative balance and status consistency).
 */
export function computePaymentTransition(
  debt: DebtRecord,
  amountMinor: number,
  paidOn: string
): {
  nextRemainingMinor: number;
  nextStatus: DebtStatus;
  nextPaymentCount: number;
  wasOnTime: boolean;
} {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Payment amount must be a positive integer in minor units.');
  }
  if (debt.remainingMinor === 0 || debt.status === 'settled') {
    throw new Error('Cannot log a payment against a settled debt.');
  }
  if (amountMinor > debt.remainingMinor) {
    throw new Error('Payment amount exceeds remaining debt balance.');
  }

  const nextRemainingMinor = debt.remainingMinor - amountMinor;
  const wasOnTime = !debt.dueDate || diffDaysYmd(paidOn, debt.dueDate) >= 0;
  const nextStatus: DebtStatus =
    nextRemainingMinor === 0
      ? 'settled'
      : debt.dueDate && diffDaysYmd(paidOn, debt.dueDate) < 0
        ? 'overdue'
        : 'partial';

  return {
    nextRemainingMinor,
    nextStatus,
    nextPaymentCount: debt.paymentCount + 1,
    wasOnTime,
  };
}

/**
 * Neutralizes spreadsheet formula injection (CSV/Excel safety) and escapes RFC-4180 fields.
 */
function escapeCsvCell(value: string | number | undefined): string {
  const raw = value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function exportDebtsToCsv(debts: DebtRecord[], todayYmd: string = getTodayYmd()): string {
  const headers = [
    'ID',
    'Direction',
    'Counterparty',
    'Phone',
    'Category',
    'Currency',
    'PrincipalMinor',
    'RemainingMinor',
    'APR_Percent',
    'DueDate',
    'EffectiveStatus',
    'PaymentCount',
    'Notes',
  ];

  const rows = debts.map((d) => [
    d.id,
    d.direction,
    d.personName,
    d.personPhone ?? '',
    d.category,
    d.currency,
    d.principalMinor,
    d.remainingMinor,
    (d.interestRateBps / 100).toFixed(2),
    d.dueDate ?? '',
    computeEffectiveStatus(d, todayYmd),
    d.paymentCount,
    d.notes ?? '',
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

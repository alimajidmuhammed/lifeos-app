import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FX_RATES_TO_IQD, toMinorUnits } from '../currency/currency';
import {
  buildSubscriptionReminderInput,
  computeMonthlyFinanceSummary,
  computeSubscriptionMetrics,
  evaluateMonthlyBudgets,
  exportTransactionsToCsv,
  parseTransactionsCsv,
} from './financeEngine';
import type { BudgetLimit, SubscriptionItem, TransactionItem } from './financeSchemas';

function makeTx(overrides: Partial<TransactionItem>): TransactionItem {
  return {
    id: 'tx_1',
    uid: 'u1',
    type: 'expense',
    amountMinor: 25000,
    currency: 'IQD',
    category: 'food',
    occurredOn: '2026-11-10',
    account: 'cash',
    isRecurring: false,
    version: 1,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

test('Monthly finance cashflow aggregates multi-currency IQD/USD minor units and evaluates budget alerts', () => {
  const txs: TransactionItem[] = [
    makeTx({ id: 't1', type: 'income', amountMinor: toMinorUnits(2000, 'USD'), currency: 'USD', category: 'salary' }),
    makeTx({ id: 't2', type: 'expense', amountMinor: toMinorUnits(450000, 'IQD'), currency: 'IQD', category: 'food' }),
    makeTx({ id: 't3', type: 'expense', amountMinor: toMinorUnits(100, 'USD'), currency: 'USD', category: 'food' }),
    makeTx({ id: 't4', type: 'expense', amountMinor: toMinorUnits(100000, 'IQD'), currency: 'IQD', category: 'utilities', occurredOn: '2026-10-05' }),
  ];

  const summary = computeMonthlyFinanceSummary(txs, '2026-11', 'IQD', DEFAULT_FX_RATES_TO_IQD);
  assert.equal(summary.transactionCount, 3);
  assert.equal(summary.incomePrimaryMinor, 2000 * DEFAULT_FX_RATES_TO_IQD.USD);
  assert.equal(summary.expensePrimaryMinor, 450000 + 100 * DEFAULT_FX_RATES_TO_IQD.USD);
  assert.ok(summary.netPrimaryMinor > 0);
  assert.ok(summary.savingsRatePct > 50);

  const budgets: BudgetLimit[] = [
    {
      id: 'b_food',
      uid: 'u1',
      category: 'food',
      limitMinor: 500000,
      currency: 'IQD',
      alertThresholdPct: 80,
      version: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];
  const evals = evaluateMonthlyBudgets(budgets, txs, '2026-11', DEFAULT_FX_RATES_TO_IQD);
  assert.equal(evals.length, 1);
  assert.equal(evals[0].status, 'exceeded');
  assert.ok(evals[0].usedPct > 100);
});

test('Subscription metrics normalize weekly/monthly/yearly burn and generate recurring reminder drafts', () => {
  const subs: SubscriptionItem[] = [
    {
      id: 's1',
      uid: 'u1',
      name: 'Fiber Internet',
      amountMinor: 45000,
      currency: 'IQD',
      cadence: 'monthly',
      nextBillingDate: '2026-11-28',
      category: 'utilities',
      status: 'active',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 's2',
      uid: 'u1',
      name: 'Cloud Backup',
      amountMinor: toMinorUnits(120, 'USD'),
      currency: 'USD',
      cadence: 'yearly',
      nextBillingDate: '2027-03-01',
      category: 'subscriptions',
      status: 'active',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const metrics = computeSubscriptionMetrics(subs, 'IQD', DEFAULT_FX_RATES_TO_IQD, '2026-11-24');
  assert.equal(metrics.activeCount, 2);
  assert.equal(metrics.upcomingWithin14Days.length, 1);
  assert.equal(metrics.monthlyBurnPrimaryMinor, 45000 + 10 * DEFAULT_FX_RATES_TO_IQD.USD);

  const rem = buildSubscriptionReminderInput(subs[0]);
  assert.equal(rem.category, 'bill');
  assert.equal(rem.rrule, 'FREQ=MONTHLY;INTERVAL=1');
  assert.equal(rem.dueAtIso, '2026-11-28T09:00:00.000Z');
});

test('CSV export neutralizes spreadsheet formulas and CSV import round-trips cleanly', () => {
  const txs: TransactionItem[] = [
    makeTx({
      id: 'tx_inj',
      merchant: '=CMD("calc")',
      note: 'Groceries, milk & bread',
      amountMinor: 35000,
      currency: 'IQD',
    }),
    makeTx({
      id: 'tx_usd',
      type: 'income',
      amountMinor: toMinorUnits(125.5, 'USD'),
      currency: 'USD',
      category: 'freelance',
      account: 'fib',
      merchant: 'Acme Studio',
    }),
  ];

  const csv = exportTransactionsToCsv(txs);
  assert.ok(csv.includes("'=CMD"), 'Formula injection prefix must be neutralized');

  const parsed = parseTransactionsCsv(csv, 'IQD');
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.validRows.length, 2);
  const usdRow = parsed.validRows.find((r) => r.currency === 'USD');
  assert.ok(usdRow);
  assert.equal(usdRow.amountMinor, 12550);
  assert.equal(usdRow.account, 'fib');
});

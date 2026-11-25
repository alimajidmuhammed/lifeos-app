import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateDebtMetrics,
  buildCashFlowForecast,
  buildPersonLedgerRollups,
  computeEffectiveStatus,
  computePaymentTransition,
  computePayoffPlan,
  estimateRepaymentProbability,
  exportDebtsToCsv,
} from './debtEngine';
import {
  DEFAULT_FX_RATES_TO_IQD,
  ID_REGEX,
  normalizePersonKey,
  type DebtRecord,
} from './debtSchemas';

function makeDebt(overrides: Partial<DebtRecord> = {}): DebtRecord {
  return {
    id: 'debt_1',
    uid: 'user_1',
    direction: 'owed_to_me',
    personKey: normalizePersonKey('Omar Ali'),
    personName: 'Omar Ali',
    category: 'personal',
    principalMinor: 500_000,
    remainingMinor: 500_000,
    currency: 'IQD',
    dueDate: '2026-12-10',
    status: 'active',
    paymentCount: 0,
    version: 1,
    ...overrides,
  };
}

test('normalizePersonKey produces Firestore-safe IDs for English, Arabic, and Kurdish names', () => {
  const keys = [
    normalizePersonKey('Omar Ali'),
    normalizePersonKey('أحمد محمد'),
    normalizePersonKey('ئەحمەد كەریم'),
    normalizePersonKey('  Omar   Ali  '),
  ];
  for (const k of keys) {
    assert.match(k, ID_REGEX);
    assert.ok(k.length >= 3 && k.length <= 64);
  }
  assert.equal(keys[0], keys[3], 'Whitespace-normalized English names must share personKey');
  assert.notEqual(keys[1], keys[2], 'Distinct Arabic and Kurdish names must not collide');
});

test('aggregateDebtMetrics calculates multi-currency totals and IQD equivalent accurately', () => {
  const debts: DebtRecord[] = [
    makeDebt({ id: 'd1', direction: 'owed_to_me', currency: 'IQD', principalMinor: 300_000, remainingMinor: 300_000 }),
    makeDebt({ id: 'd2', direction: 'owed_to_me', currency: 'USD', principalMinor: 10_000, remainingMinor: 10_000 }), // $100 -> 150,000 IQD
    makeDebt({ id: 'd3', direction: 'i_owe', currency: 'USD', principalMinor: 5_000, remainingMinor: 5_000, dueDate: '2026-11-01' }), // $50 -> 75,000 IQD (overdue)
    makeDebt({ id: 'd4', direction: 'i_owe', currency: 'IQD', principalMinor: 200_000, remainingMinor: 0, status: 'settled' }),
  ];

  const metrics = aggregateDebtMetrics(debts, 'IQD', DEFAULT_FX_RATES_TO_IQD, '2026-11-23');
  assert.equal(metrics.byCurrency.IQD.owedToMeMinor, 300_000);
  assert.equal(metrics.byCurrency.USD.owedToMeMinor, 10_000);
  assert.equal(metrics.byCurrency.USD.iOweMinor, 5_000);
  assert.equal(metrics.equivalentOwedToMePrimaryMinor, 450_000);
  assert.equal(metrics.equivalentIOwePrimaryMinor, 75_000);
  assert.equal(metrics.equivalentNetPrimaryMinor, 375_000);
  assert.equal(metrics.totalOpenCount, 3);
  assert.equal(metrics.totalOverdueCount, 1);
  assert.equal(metrics.totalSettledCount, 1);
});

test('computePaymentTransition enforces overpayment guard and terminal settled transition', () => {
  const debt = makeDebt({ principalMinor: 100_000, remainingMinor: 60_000, paymentCount: 1, dueDate: '2026-12-01' });

  const partial = computePaymentTransition(debt, 20_000, '2026-11-23');
  assert.equal(partial.nextRemainingMinor, 40_000);
  assert.equal(partial.nextStatus, 'partial');
  assert.equal(partial.nextPaymentCount, 2);
  assert.equal(partial.wasOnTime, true);

  const settled = computePaymentTransition(debt, 60_000, '2026-12-05');
  assert.equal(settled.nextRemainingMinor, 0);
  assert.equal(settled.nextStatus, 'settled');
  assert.equal(settled.wasOnTime, false);

  assert.throws(() => computePaymentTransition(debt, 60_001, '2026-11-23'), /exceeds remaining/);
});

test('estimateRepaymentProbability rewards on-time history & partial progress and decays overdue debts', () => {
  const strongDebt = makeDebt({ principalMinor: 200_000, remainingMinor: 100_000, dueDate: '2026-12-15' });
  const strong = estimateRepaymentProbability(strongDebt, { onTimeCount: 5, lateCount: 0 }, '2026-11-23');
  assert.equal(strong.band, 'high');
  assert.ok(strong.score >= 85);

  const overdueDebt = makeDebt({ principalMinor: 200_000, remainingMinor: 200_000, dueDate: '2026-09-01' });
  const weak = estimateRepaymentProbability(overdueDebt, { onTimeCount: 0, lateCount: 3 }, '2026-11-23');
  assert.equal(weak.band, 'at_risk');
  assert.ok(weak.score < 45);
});

test('computePayoffPlan compares Smallest First vs Due Soonest payoff order deterministically', () => {
  const debts: DebtRecord[] = [
    makeDebt({
      id: 'small_later',
      direction: 'i_owe',
      personName: 'Phone Installment',
      currency: 'USD',
      principalMinor: 40_000, // $400
      remainingMinor: 40_000,
      dueDate: '2027-06-01',
    }),
    makeDebt({
      id: 'large_sooner',
      direction: 'i_owe',
      personName: 'Supplier Balance',
      currency: 'USD',
      principalMinor: 200_000, // $2,000
      remainingMinor: 200_000,
      dueDate: '2026-12-15',
    }),
  ];

  const smallestFirst = computePayoffPlan(debts, 'smallest_first', 30_000, 'USD', DEFAULT_FX_RATES_TO_IQD);
  const dueSoonest = computePayoffPlan(debts, 'due_soonest', 30_000, 'USD', DEFAULT_FX_RATES_TO_IQD);

  assert.equal(smallestFirst.items[0].debtId, 'small_later');
  assert.equal(dueSoonest.items[0].debtId, 'large_sooner');
  assert.equal(smallestFirst.totalMonths, 8);
  assert.equal(dueSoonest.totalMonths, 8);
});

test('buildCashFlowForecast buckets overdue and 30/60/90-day obligations accurately', () => {
  const today = '2026-11-23';
  const debts: DebtRecord[] = [
    makeDebt({ id: 'd_over', direction: 'i_owe', currency: 'IQD', remainingMinor: 100_000, principalMinor: 100_000, dueDate: '2026-11-10' }),
    makeDebt({ id: 'd_30', direction: 'owed_to_me', currency: 'IQD', remainingMinor: 250_000, principalMinor: 250_000, dueDate: '2026-12-10' }),
    makeDebt({ id: 'd_60', direction: 'i_owe', currency: 'IQD', remainingMinor: 50_000, principalMinor: 50_000, dueDate: '2027-01-10' }),
    makeDebt({ id: 'd_none', direction: 'owed_to_me', currency: 'IQD', remainingMinor: 75_000, principalMinor: 75_000, dueDate: undefined }),
  ];

  const buckets = buildCashFlowForecast(debts, 'IQD', DEFAULT_FX_RATES_TO_IQD, today);
  const byId = Object.fromEntries(buckets.map((b) => [b.id, b]));
  assert.equal(byId.overdue.outflowPrimaryMinor, 100_000);
  assert.equal(byId.days_0_30.inflowPrimaryMinor, 250_000);
  assert.equal(byId.days_31_60.outflowPrimaryMinor, 50_000);
  assert.equal(byId.no_date.inflowPrimaryMinor, 75_000);
});

test('buildPersonLedgerRollups aggregates multi-currency net balances per person and CSV neutralizes formulas', () => {
  const personKey = normalizePersonKey('=CMD() Evil');
  const debts = [
    makeDebt({ id: 'd1', personKey, personName: '=CMD() Evil', direction: 'owed_to_me', currency: 'IQD', remainingMinor: 100_000, principalMinor: 100_000 }),
    makeDebt({ id: 'd2', personKey, personName: '=CMD() Evil', direction: 'i_owe', currency: 'IQD', remainingMinor: 40_000, principalMinor: 40_000 }),
  ];

  const rollups = buildPersonLedgerRollups(debts, {}, '2026-11-23');
  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].netByCurrencyMinor.IQD, 60_000);
  assert.equal(computeEffectiveStatus(debts[0], '2026-11-23'), 'active');

  const csv = exportDebtsToCsv(debts, '2026-11-23');
  assert.ok(csv.includes("'=CMD() Evil"), 'CSV export must neutralize spreadsheet formula injection');
});

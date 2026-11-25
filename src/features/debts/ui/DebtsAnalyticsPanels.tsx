import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney, toMinorUnits, type CurrencyCode } from '../../../core/currency/currency';
import {
  buildCashFlowForecast,
  buildPersonLedgerRollups,
  computePayoffPlan,
  SUPPORTED_CURRENCIES,
  type CashFlowHorizonId,
  type PayoffStrategy,
} from '../../../core/debts/debtEngine';
import type { DebtLedger, DebtRecord, FxRatesToIqd } from '../../../core/debts/debtSchemas';
import { useUIStore } from '../../../state/useUIStore';

interface PeoplePanelProps {
  debts: DebtRecord[];
  ledgersByKey: Record<string, DebtLedger>;
  onFilterByPerson: (personName: string) => void;
}

export const PeopleLedgerPanel: React.FC<PeoplePanelProps> = ({
  debts,
  ledgersByKey,
  onFilterByPerson,
}) => {
  const { t } = useTranslation();
  const locale = useUIStore((s) => s.profile.locale);

  const people = useMemo(
    () => buildPersonLedgerRollups(debts, ledgersByKey),
    [debts, ledgersByKey]
  );

  if (people.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text-primary)]">{t('debts.emptyTitle')}</p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{t('debts.emptyDesc')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
      {people.map((person) => {
        const activeCurrencies = SUPPORTED_CURRENCIES.filter(
          (c) =>
            person.owedToMeByCurrencyMinor[c] !== 0 ||
            person.iOweByCurrencyMinor[c] !== 0
        );
        const totalHistory = person.onTimeCount + person.lateCount;
        const onTimePct =
          totalHistory > 0 ? Math.round((person.onTimeCount / totalHistory) * 100) : null;

        return (
          <button
            key={person.personKey}
            type="button"
            onClick={() => onFilterByPerson(person.personName)}
            className="w-full px-5 py-4 text-start flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[var(--bg-subtle)]/60 transition-colors"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {person.personName}
                </span>
                <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                <span className="font-numeric text-xs text-[var(--text-muted)]">
                  {person.activeCount} open
                </span>
                {person.overdueCount > 0 && (
                  <>
                    <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                    <span className="font-numeric text-xs font-medium text-red-600 dark:text-red-400">
                      {person.overdueCount} overdue
                    </span>
                  </>
                )}
                {person.settledCount > 0 && (
                  <>
                    <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                    <span className="font-numeric text-xs text-[var(--text-muted)]">
                      {person.settledCount} settled
                    </span>
                  </>
                )}
              </div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                {onTimePct !== null ? (
                  <span className="font-numeric">
                    Reliability: {onTimePct}% on-time ({person.onTimeCount}/{totalHistory})
                  </span>
                ) : (
                  <span>No completed payment history yet</span>
                )}
                {person.avgRepaymentScore !== null && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="font-numeric">
                      Est. repayment: {person.avgRepaymentScore}%
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-end space-y-0.5">
                {activeCurrencies.length === 0 ? (
                  <span className="text-xs font-medium text-[var(--accent)]">All settled</span>
                ) : (
                  activeCurrencies.map((c) => {
                    const net = person.netByCurrencyMinor[c];
                    return (
                      <div
                        key={c}
                        className={`font-numeric text-sm font-semibold ${
                          net > 0
                            ? 'text-[var(--accent)]'
                            : net < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {net > 0 ? '+' : ''}
                        {formatMoney(net, c, locale)}
                      </div>
                    );
                  })
                )}
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--text-muted)] rtl:rotate-180" />
            </div>
          </button>
        );
      })}
    </div>
  );
};

interface PayoffPlannerPanelProps {
  debts: DebtRecord[];
  primaryCurrency: CurrencyCode;
  fxRates: FxRatesToIqd;
}

export const PayoffPlannerPanel: React.FC<PayoffPlannerPanelProps> = ({
  debts,
  primaryCurrency,
  fxRates,
}) => {
  const { t } = useTranslation();
  const locale = useUIStore((s) => s.profile.locale);

  const [strategy, setStrategy] = useState<PayoffStrategy>('smallest_first');
  const defaultBudgetMajor = primaryCurrency === 'IQD' ? '500000' : '350';
  const [budgetInput, setBudgetInput] = useState(defaultBudgetMajor);

  const budgetMinor = useMemo(() => {
    const val = Number(budgetInput.replace(/,/g, ''));
    if (!Number.isFinite(val) || val <= 0) return 0;
    return toMinorUnits(val, primaryCurrency);
  }, [budgetInput, primaryCurrency]);

  const smallestFirstPlan = useMemo(
    () => computePayoffPlan(debts, 'smallest_first', budgetMinor, primaryCurrency, fxRates),
    [debts, budgetMinor, primaryCurrency, fxRates]
  );

  const dueSoonestPlan = useMemo(
    () => computePayoffPlan(debts, 'due_soonest', budgetMinor, primaryCurrency, fxRates),
    [debts, budgetMinor, primaryCurrency, fxRates]
  );

  const activePlan = strategy === 'smallest_first' ? smallestFirstPlan : dueSoonestPlan;

  const openIOweCount = debts.filter(
    (d) => d.direction === 'i_owe' && d.remainingMinor > 0 && d.status !== 'settled'
  ).length;

  if (openIOweCount === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-8 text-center">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          No open &ldquo;{t('debts.iOwe')}&rdquo; debts to schedule
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Add any personal loan, installment, or balance you owe to compare Smallest-First vs. Due-Soonest payoff timelines.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Controls & Summary */}
      <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('debts.monthlyBudget')} ({primaryCurrency})
            </label>
            <input
              type="number"
              min="1"
              step={primaryCurrency === 'IQD' ? '25000' : '25'}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="w-full sm:w-56 min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--bg-subtle)]">
            {(['smallest_first', 'due_soonest'] as PayoffStrategy[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStrategy(s)}
                className={`min-h-[40px] px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  strategy === s
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {s === 'smallest_first' ? t('debts.smallestFirst') : t('debts.dueSoonest')}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px rounded-xl border border-[var(--border-hairline)] bg-[var(--border-hairline)] overflow-hidden">
          <div className="bg-[var(--bg-canvas)] p-4">
            <div className="text-xs text-[var(--text-muted)]">{t('debts.monthsToFree')}</div>
            <div className="mt-1 font-numeric text-xl font-bold text-[var(--text-primary)]">
              {activePlan.cappedAtMaxMonths ? '120+ mo' : `${activePlan.totalMonths} mo`}
            </div>
          </div>
          <div className="bg-[var(--bg-canvas)] p-4">
            <div className="text-xs text-[var(--text-muted)]">{t('debts.totalBalance')}</div>
            <div className="mt-1 font-numeric text-xl font-bold text-[var(--accent)]">
              {formatMoney(activePlan.totalPrincipalPrimaryMinor, primaryCurrency, locale)}
            </div>
          </div>
        </div>
      </div>

      {/* Ordered Payoff Sequence Table */}
      <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-x-auto">
        <table className="w-full text-start border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-hairline)] text-xs font-medium text-[var(--text-muted)]">
              <th className="py-3 px-4 text-start">#</th>
              <th className="py-3 px-4 text-start">{t('debts.personOrLender')}</th>
              <th className="py-3 px-4 text-end">{t('debts.remainingLabel')}</th>
              <th className="py-3 px-4 text-end">{t('debts.payoffMonthLabel')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-hairline)] text-sm">
            {activePlan.items.map((item, idx) => (
              <tr key={item.debtId} className="hover:bg-[var(--bg-subtle)]/50">
                <td className="py-3 px-4 font-numeric text-xs text-[var(--text-muted)]">
                  #{idx + 1}
                </td>
                <td className="py-3 px-4 font-medium text-[var(--text-primary)]">
                  {item.personName}
                </td>
                <td className="py-3 px-4 text-end font-numeric text-[var(--text-primary)]">
                  {formatMoney(item.remainingOriginalMinor, item.currency, locale)}
                </td>
                <td className="py-3 px-4 text-end font-numeric font-semibold text-[var(--accent)]">
                  {item.payoffMonth > 0 ? `${item.payoffMonth} mo` : '>120 mo'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface CashFlowForecastPanelProps {
  debts: DebtRecord[];
  primaryCurrency: CurrencyCode;
  fxRates: FxRatesToIqd;
}

const HORIZON_LABELS: Record<CashFlowHorizonId, string> = {
  overdue: 'Overdue Now',
  days_0_30: 'Next 30 Days',
  days_31_60: 'Days 31 – 60',
  days_61_90: 'Days 61 – 90',
  beyond_90: 'Beyond 90 Days',
  no_date: 'Flexible / No Due Date',
};

export const CashFlowForecastPanel: React.FC<CashFlowForecastPanelProps> = ({
  debts,
  primaryCurrency,
  fxRates,
}) => {
  const { t } = useTranslation();
  const locale = useUIStore((s) => s.profile.locale);

  const buckets = useMemo(
    () => buildCashFlowForecast(debts, primaryCurrency, fxRates),
    [debts, primaryCurrency, fxRates]
  );

  const maxFlow = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.inflowPrimaryMinor, b.outflowPrimaryMinor))
  );

  return (
    <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
      <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>All amounts converted to {primaryCurrency} using your reference FX rates</span>
        <span className="font-numeric">
          {t('debts.inflow')} vs. {t('debts.outflow')}
        </span>
      </div>

      {buckets.map((b) => {
        const inflowPct = Math.round((b.inflowPrimaryMinor / maxFlow) * 100);
        const outflowPct = Math.round((b.outflowPrimaryMinor / maxFlow) * 100);

        return (
          <div key={b.id} className="px-5 py-4 space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-semibold ${
                    b.id === 'overdue' && (b.inflowCount > 0 || b.outflowCount > 0)
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-[var(--text-primary)]'
                  }`}
                >
                  {HORIZON_LABELS[b.id]}
                </span>
                <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                <span className="font-numeric text-xs text-[var(--text-muted)]">
                  {b.inflowCount + b.outflowCount}{' '}
                  {b.inflowCount + b.outflowCount === 1 ? 'item' : 'items'}
                </span>
              </div>

              <div
                className={`font-numeric text-sm font-semibold ${
                  b.netPrimaryMinor > 0
                    ? 'text-[var(--accent)]'
                    : b.netPrimaryMinor < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-[var(--text-muted)]'
                }`}
              >
                {t('debts.netCash')}: {b.netPrimaryMinor > 0 ? '+' : ''}
                {formatMoney(b.netPrimaryMinor, primaryCurrency, locale)}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">
                    {t('debts.inflow')} ({b.inflowCount})
                  </span>
                  <span className="font-numeric font-medium text-[var(--accent)]">
                    {formatMoney(b.inflowPrimaryMinor, primaryCurrency, locale)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
                    style={{ width: `${inflowPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">
                    {t('debts.outflow')} ({b.outflowCount})
                  </span>
                  <span className="font-numeric font-medium text-red-600 dark:text-red-400">
                    {formatMoney(b.outflowPrimaryMinor, primaryCurrency, locale)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-red-500 transition-all duration-200"
                    style={{ width: `${outflowPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

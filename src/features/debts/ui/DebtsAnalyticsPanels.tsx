import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../core/currency/currency';
import { buildPersonLedgerRollups } from '../../../core/debts/debtEngine';
import type { DebtLedger, DebtRecord } from '../../../core/debts/debtSchemas';
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
        const activeCurrencies = Array.from(
          new Set([
            ...Object.keys(person.owedToMeByCurrencyMinor),
            ...Object.keys(person.iOweByCurrencyMinor),
          ])
        ).filter(
          (c) =>
            (person.owedToMeByCurrencyMinor[c] ?? 0) !== 0 ||
            (person.iOweByCurrencyMinor[c] ?? 0) !== 0
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
                  <span className="text-xs font-medium text-[var(--accent)]">{t('ui.allSettled')}</span>
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

import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  MessageSquareText,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../core/currency/currency';
import {
  computeDaysOverdue,
  computeEffectiveStatus,
  estimateRepaymentProbability,
} from '../../../core/debts/debtEngine';
import type { DebtLedger, DebtPayment, DebtRecord } from '../../../core/debts/debtSchemas';
import { useUIStore } from '../../../state/useUIStore';

interface DebtDetailDrawerProps {
  debt: DebtRecord | null;
  ledger: DebtLedger | null;
  listPayments: (debtId: string) => Promise<DebtPayment[]>;
  onClose: () => void;
  onEdit: (debt: DebtRecord) => void;
  onLogPayment: (debt: DebtRecord) => void;
  onDraftReminder: (debt: DebtRecord) => void;
  onDelete: (debt: DebtRecord) => Promise<void>;
}

export const DebtDetailDrawer: React.FC<DebtDetailDrawerProps> = ({
  debt,
  ledger,
  listPayments,
  onClose,
  onEdit,
  onLogPayment,
  onDraftReminder,
  onDelete,
}) => {
  const { t } = useTranslation();
  const locale = useUIStore((s) => s.profile.locale);

  const [payments, setPayments] = useState<DebtPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  useEffect(() => {
    if (!debt) return;
    let active = true;
    setLoadingPayments(true);
    void listPayments(debt.id)
      .then((list) => {
        if (active) setPayments(list);
      })
      .finally(() => {
        if (active) setLoadingPayments(false);
      });
    return () => {
      active = false;
    };
  }, [debt, debt?.paymentCount, listPayments]);

  if (!debt) return null;

  const effStatus = computeEffectiveStatus(debt);
  const daysOverdue = computeDaysOverdue(debt);
  const paidMinor = debt.principalMinor - debt.remainingMinor;
  const pctPaid = Math.min(100, Math.round((paidMinor / Math.max(1, debt.principalMinor)) * 100));
  const prob =
    debt.direction === 'owed_to_me' ? estimateRepaymentProbability(debt, ledger) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={debt.personName}
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-dvh overflow-y-auto border-s border-[var(--border-hairline)] bg-[var(--bg-surface)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
              {debt.personName}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {debt.direction === 'owed_to_me' ? t('debts.owedToMe') : t('debts.iOwe')} ·{' '}
              {debt.category.replace('_', ' ')}
              {debt.personPhone ? ` · ${debt.personPhone}` : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 p-5 space-y-6">
          {/* Balance Summary */}
          <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-muted)]">
                {t('debts.remaining')}
              </span>
              <span
                className={`text-xs font-medium ${
                  effStatus === 'overdue'
                    ? 'text-red-600 dark:text-red-400'
                    : effStatus === 'settled'
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-secondary)]'
                }`}
              >
                {effStatus === 'settled'
                  ? t('debts.settledLocked')
                  : effStatus === 'overdue'
                    ? t('debts.overdueDays', { count: daysOverdue })
                    : debt.dueDate
                      ? `${t('debts.dueDate')} ${debt.dueDate}`
                      : t('debts.noDueDate')}
              </span>
            </div>

            <div className="font-numeric text-2xl font-bold text-[var(--text-primary)]">
              {formatMoney(debt.remainingMinor, debt.currency, locale)}
            </div>

            <div className="h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
                style={{ width: `${pctPaid}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-numeric">
              <span>
                Paid: {formatMoney(paidMinor, debt.currency, locale)} ({pctPaid}%)
              </span>
              <span>
                Principal: {formatMoney(debt.principalMinor, debt.currency, locale)}
              </span>
            </div>
          </div>

          {/* Primary Actions */}
          {effStatus !== 'settled' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => onLogPayment(debt)}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{t('debts.logPayment')}</span>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onDraftReminder(debt)}
                  className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors whitespace-nowrap"
                >
                  <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('debts.draftReminder')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(debt)}
                  className="min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors whitespace-nowrap"
                >
                  <Edit3 className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('debts.editDebt')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Deterministic Repayment Probability Breakdown */}
          {prob && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  {t('debts.repaymentScore')} (Deterministic)
                </h3>
                <span
                  className={`font-numeric text-sm font-bold ${
                    prob.band === 'high'
                      ? 'text-[var(--accent)]'
                      : prob.band === 'moderate'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {prob.score}%
                </span>
              </div>
              <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                {prob.factors.map((f, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span aria-hidden="true" className="text-[var(--text-muted)]">·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes */}
          {debt.notes && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {t('debts.notesLabel')}
              </h3>
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                {debt.notes}
              </p>
            </div>
          )}

          {/* Append-only Payment Audit Log */}
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                {t('debts.paymentHistory')}
              </h3>
              <span className="font-numeric text-xs text-[var(--text-muted)]">
                {payments.length} {payments.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {loadingPayments ? (
              <div className="space-y-2">
                <div className="h-12 rounded-xl bg-[var(--bg-subtle)] animate-pulse" />
              </div>
            ) : payments.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">{t('debts.noPaymentsYet')}</p>
            ) : (
              <div className="rounded-xl border border-[var(--border-hairline)] divide-y divide-[var(--border-hairline)] overflow-hidden">
                {payments.map((p) => (
                  <div key={p.id} className="px-3.5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-numeric text-sm font-semibold text-[var(--text-primary)]">
                        {formatMoney(p.amountMinor, p.currency, locale)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] truncate">
                        <span className="font-numeric">{p.paidOn}</span> · {p.method.replace('_', ' ')}
                        {p.note ? ` · ${p.note}` : ''}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium whitespace-nowrap ${
                        p.wasOnTime
                          ? 'text-[var(--accent)]'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {p.wasOnTime ? 'On time' : 'Late'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Delete Action */}
        <div className="border-t border-[var(--border-hairline)] p-4">
          <button
            type="button"
            onClick={() => {
              void onDelete(debt);
              onClose();
            }}
            className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900/60 px-4 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('debts.deleteDebt')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

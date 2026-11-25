import React, { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney, fromMinorUnits, toMinorUnits } from '../../../core/currency/currency';
import { getTodayYmd } from '../../../core/debts/debtEngine';
import type { DebtRecord, PaymentMethod, RecordPaymentInput } from '../../../core/debts/debtSchemas';
import { useUIStore } from '../../../state/useUIStore';

interface DebtPaymentModalProps {
  debt: DebtRecord | null;
  onClose: () => void;
  onRecordPayment: (debt: DebtRecord, input: RecordPaymentInput) => Promise<void>;
}

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'zaincash', label: 'ZainCash' },
  { id: 'fib', label: 'FIB' },
  { id: 'fastpay', label: 'FastPay' },
  { id: 'other', label: 'Other' },
];

export const DebtPaymentModal: React.FC<DebtPaymentModalProps> = ({
  debt,
  onClose,
  onRecordPayment,
}) => {
  const { t } = useTranslation();
  const locale = useUIStore((s) => s.profile.locale);

  const [amountInput, setAmountInput] = useState('');
  const [paidOn, setPaidOn] = useState(getTodayYmd());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!debt) return;
    setAmountInput(String(fromMinorUnits(debt.remainingMinor, debt.currency)));
    setPaidOn(getTodayYmd());
    setMethod('cash');
    setNote('');
    setError(null);
  }, [debt]);

  if (!debt) return null;

  const parsedMajor = Number(amountInput.replace(/,/g, ''));
  const candidateMinor =
    Number.isFinite(parsedMajor) && parsedMajor > 0 ? toMinorUnits(parsedMajor, debt.currency) : 0;
  const nextRemaining = Math.max(0, debt.remainingMinor - candidateMinor);
  const isOverpay = candidateMinor > debt.remainingMinor;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (candidateMinor <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    if (isOverpay) {
      setError('Payment exceeds remaining debt balance.');
      return;
    }

    setSaving(true);
    try {
      await onRecordPayment(debt, {
        debtId: debt.id,
        amountMinor: candidateMinor,
        paidOn,
        method,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('debts.logPayment')}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 sm:backdrop-blur-xs p-0 sm:p-4 overflow-y-auto anim-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-md rounded-none sm:rounded-2xl pt-safe pb-safe sm:pt-0 sm:pb-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-y-auto sm:max-h-[90dvh] anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('debts.logPayment')}</h2>
            <p className="text-xs text-[var(--text-muted)] truncate">
              {debt.personName} · {t('debts.remaining')}:{' '}
              <span className="font-numeric font-medium text-[var(--text-primary)]">
                {formatMoney(debt.remainingMinor, debt.currency, locale)}
              </span>
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

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                {t('debts.amount')} ({debt.currency})
              </label>
              <button
                type="button"
                onClick={() => setAmountInput(String(fromMinorUnits(debt.remainingMinor, debt.currency)))}
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                {t('debts.payFullBtn')}
              </button>
            </div>
            <input
              type="number"
              step={debt.currency === 'IQD' ? '1' : '0.01'}
              min="0"
              required
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full min-h-[44px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-base font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t('debts.paymentMethod')}
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t('debts.paymentDate')}
              </label>
              <input
                type="date"
                required
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {t('debts.notesLabel')}
            </label>
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('ui.receiptPlaceholder')}
              className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          {/* Deterministic Preview Strip */}
          <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-3 flex items-center justify-between text-xs">
            <span className="text-[var(--text-secondary)]">{t('ui.newRemainingBalance')}</span>
            <span
              className={`font-numeric font-semibold ${
                isOverpay
                  ? 'text-red-600 dark:text-red-400'
                  : nextRemaining === 0
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text-primary)]'
              }`}
            >
              {isOverpay
                ? 'Exceeds balance'
                : nextRemaining === 0
                  ? `${formatMoney(0, debt.currency, locale)} · Settled`
                  : formatMoney(nextRemaining, debt.currency, locale)}
            </span>
          </div>

          {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--border-hairline)]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] rounded-xl border border-[var(--border-hairline)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || isOverpay || candidateMinor <= 0}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{saving ? '...' : t('debts.confirmPayment')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

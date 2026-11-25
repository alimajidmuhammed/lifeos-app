import React, { useEffect, useState } from 'react';
import { Sparkles, X, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fromMinorUnits, toMinorUnits, type CurrencyCode } from '../../../core/currency/currency';
import { getTodayYmd } from '../../../core/debts/debtEngine';
import type {
  CreateDebtInput,
  DebtCategory,
  DebtDirection,
  DebtRecord,
} from '../../../core/debts/debtSchemas';
import { parseNaturalLanguageDebt } from '../../../core/ai/debtsAiClient';
import { evaluateDailyAiQuota, getTodayDayKey } from '../../../core/entitlements/entitlements';
import { aiUsageRepository } from '../../../data/repositories/firebaseWebAdapter';
import { useUIStore } from '../../../state/useUIStore';

interface DebtFormModalProps {
  open: boolean;
  editingDebt: DebtRecord | null;
  initialFocusAi?: boolean;
  onClose: () => void;
  onCreate: (input: CreateDebtInput) => Promise<void>;
  onUpdate: (
    current: DebtRecord,
    patch: Partial<
      Pick<DebtRecord, 'personName' | 'personPhone' | 'category' | 'interestRateBps' | 'dueDate' | 'notes'>
    >
  ) => Promise<void>;
}

const CATEGORIES: DebtCategory[] = ['personal', 'family', 'business', 'loan', 'bill_split', 'other'];

export const DebtFormModal: React.FC<DebtFormModalProps> = ({
  open,
  editingDebt,
  initialFocusAi = false,
  onClose,
  onCreate,
  onUpdate,
}) => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const todayAiUsage = useUIStore((s) => s.todayAiUsage);
  const incrementLocalAiUsage = useUIStore((s) => s.incrementLocalAiUsage);

  const [direction, setDirection] = useState<DebtDirection>('owed_to_me');
  const [personName, setPersonName] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(profile.primaryCurrency);
  const [category, setCategory] = useState<DebtCategory>('personal');
  const [aprInput, setAprInput] = useState('0');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const [aiText, setAiText] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setAiError(null);
    setAiNotice(null);
    setAiText('');

    if (editingDebt) {
      setDirection(editingDebt.direction);
      setPersonName(editingDebt.personName);
      setPersonPhone(editingDebt.personPhone ?? '');
      setAmountInput(String(fromMinorUnits(editingDebt.principalMinor, editingDebt.currency)));
      setCurrency(editingDebt.currency);
      setCategory(editingDebt.category);
      setAprInput((editingDebt.interestRateBps / 100).toString());
      setDueDate(editingDebt.dueDate ?? '');
      setNotes(editingDebt.notes ?? '');
    } else {
      setDirection('owed_to_me');
      setPersonName('');
      setPersonPhone('');
      setAmountInput('');
      setCurrency(profile.primaryCurrency);
      setCategory('personal');
      setAprInput('0');
      setDueDate('');
      setNotes('');
    }
  }, [open, editingDebt, profile.primaryCurrency]);

  if (!open) return null;

  const isEditing = Boolean(editingDebt);
  const aiAllowedForDebts = profile.aiGlobalEnabled && (profile.aiModuleToggles?.debts ?? true);

  const handleAiParse = async () => {
    const trimmed = aiText.trim();
    if (!trimmed) return;
    if (!aiAllowedForDebts) {
      setAiError(t('assistant.disabledNotice'));
      return;
    }

    const dayKey = getTodayDayKey();
    const usedToday = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
    const quota = evaluateDailyAiQuota(usedToday, entitlements);
    if (!quota.allowed) {
      setAiError(`Daily AI quota reached (${quota.usedToday}/${quota.dailyLimit}). Fill fields manually below.`);
      return;
    }

    setAiParsing(true);
    setAiError(null);
    setAiNotice(null);

    const res = await parseNaturalLanguageDebt({
      text: trimmed,
      locale: profile.locale,
      defaultCurrency: profile.primaryCurrency,
      todayYmd: getTodayYmd(),
      freeTier: entitlements.plan === 'free',
    });

    setAiParsing(false);

    if (!res.ok) {
      setAiError(res.error);
      return;
    }

    const draft = res.data;
    setDirection(draft.direction);
    setPersonName(draft.personName);
    setAmountInput(String(draft.amountMajor));
    setCurrency(draft.currency);
    setCategory(draft.category);
    setAprInput(String(draft.interestRatePercent ?? 0));
    setDueDate(draft.dueDate ?? '');
    setNotes(draft.notes ?? '');
    setAiNotice(draft.confidenceNote || t('debts.aiDraftNotice'));

    incrementLocalAiUsage(dayKey, res.meta.inputTokensEst, res.meta.outputTokensEst);
    if (authUser) {
      void aiUsageRepository.recordUsage(
        authUser.uid,
        dayKey,
        todayAiUsage.dayKey === dayKey ? todayAiUsage : null,
        res.meta.inputTokensEst,
        res.meta.outputTokensEst
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = personName.trim();
    if (!cleanName) {
      setFormError('Please enter a person or lender name.');
      return;
    }

    const aprVal = Number(aprInput || '0');
    if (!Number.isFinite(aprVal) || aprVal < 0 || aprVal > 100) {
      setFormError('APR must be between 0% and 100%.');
      return;
    }
    const interestRateBps = Math.round(aprVal * 100);

    setSaving(true);
    try {
      if (editingDebt) {
        await onUpdate(editingDebt, {
          personName: cleanName,
          personPhone: personPhone.trim() || undefined,
          category,
          interestRateBps,
          dueDate: dueDate || undefined,
          notes: notes.trim() || undefined,
        });
      } else {
        const major = Number(amountInput.replace(/,/g, ''));
        if (!Number.isFinite(major) || major <= 0) {
          setFormError('Enter a valid amount greater than 0.');
          setSaving(false);
          return;
        }
        const principalMinor = toMinorUnits(major, currency);
        await onCreate({
          direction,
          personName: cleanName,
          personPhone: personPhone.trim() || undefined,
          category,
          principalMinor,
          currency,
          interestRateBps,
          dueDate: dueDate || undefined,
          notes: notes.trim() || undefined,
        });
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save debt record.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? t('debts.editDebt') : t('debts.addDebt')}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 sm:backdrop-blur-xs p-0 sm:p-4 overflow-hidden anim-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-lg sm:max-h-[90dvh] overflow-hidden rounded-none sm:rounded-2xl pt-safe sm:pt-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl flex flex-col anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--bg-surface)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {isEditing ? t('debts.editDebt') : t('debts.addDebt')}
          </h2>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* AI Natural Language Quick Parser (Create mode only, always confirmation-gated) */}
          {!isEditing && (
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>{t('debts.aiQuickEntry')}</span>
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">EN · AR · CKB</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus={initialFocusAi}
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAiParse();
                    }
                  }}
                  placeholder={t('debts.aiParsePlaceholder')}
                  className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  disabled={aiParsing || !aiText.trim()}
                  onClick={() => void handleAiParse()}
                  className="min-h-[40px] rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {aiParsing ? '...' : t('debts.aiParseBtn')}
                </button>
              </div>
              {aiNotice && (
                <p className="text-xs text-[var(--accent)] font-medium">{aiNotice}</p>
              )}
              {aiError && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{aiError}</span>
                </p>
              )}
            </div>
          )}

          <form id="lifeos-debt-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {/* Direction Segmented Control */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {t('debts.direction')}
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[var(--bg-subtle)]">
                {(['owed_to_me', 'i_owe'] as DebtDirection[]).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    disabled={isEditing}
                    onClick={() => setDirection(dir)}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors disabled:opacity-70 ${
                      direction === dir
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {dir === 'owed_to_me' ? t('debts.owedToMe') : t('debts.iOwe')}
                  </button>
                ))}
              </div>
            </div>

            {/* Person & Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('debts.personName')}
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder="Omar Ali / عمر علي"
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('debts.personPhone')}
                </label>
                <input
                  type="tel"
                  maxLength={32}
                  value={personPhone}
                  onChange={(e) => setPersonPhone(e.target.value)}
                  placeholder="+964 770 000 0000"
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {/* Amount & Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('debts.amount')}
                </label>
                <input
                  type="number"
                  step={currency === 'IQD' ? '1' : '0.01'}
                  min="0"
                  required
                  disabled={isEditing}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder={currency === 'IQD' ? '250000' : '150.00'}
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-60 focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('debts.currency')}
                </label>
                <select
                  disabled={isEditing}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:opacity-60 focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="IQD">IQD</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>

            {/* Category, Due Date, APR */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('debts.category')}
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DebtCategory)}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('debts.dueDate')}
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('debts.aprLabel')}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={aprInput}
                  onChange={(e) => setAprInput(e.target.value)}
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t('debts.notesLabel')}
              </label>
              <textarea
                rows={2}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Context, agreement terms, or installment reference..."
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {formError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">{formError}</p>
            )}
          </form>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] pb-safe">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] rounded-xl border border-[var(--border-hairline)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="lifeos-debt-form"
            disabled={saving}
            className="min-h-[42px] rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {saving ? '...' : isEditing ? t('debts.saveChanges') : t('debts.saveDebt')}
          </button>
        </div>
      </div>
    </div>
  );
};

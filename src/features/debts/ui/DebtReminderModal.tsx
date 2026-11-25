import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney, type SupportedLocale } from '../../../core/currency/currency';
import { computeDaysOverdue } from '../../../core/debts/debtEngine';
import type { DebtRecord } from '../../../core/debts/debtSchemas';
import { draftDebtReminderMessage } from '../../../core/ai/debtsAiClient';
import { evaluateDailyAiQuota, getTodayDayKey } from '../../../core/entitlements/entitlements';
import { aiUsageRepository } from '../../../data/repositories/firebaseWebAdapter';
import { useUIStore } from '../../../state/useUIStore';

interface DebtReminderModalProps {
  debt: DebtRecord | null;
  onClose: () => void;
}

type ReminderTone = 'gentle' | 'firm' | 'formal';

export const DebtReminderModal: React.FC<DebtReminderModalProps> = ({ debt, onClose }) => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const todayAiUsage = useUIStore((s) => s.todayAiUsage);
  const incrementLocalAiUsage = useUIStore((s) => s.incrementLocalAiUsage);
  const showToast = useUIStore((s) => s.showToast);

  const [language, setLanguage] = useState<SupportedLocale>(profile.locale);
  const [tone, setTone] = useState<ReminderTone>('gentle');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [metaText, setMetaText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!debt) return;
    setLanguage(profile.locale);
    setTone(computeDaysOverdue(debt) > 14 ? 'firm' : 'gentle');
    setSubject('');
    setMessage('');
    setMetaText(null);
    setError(null);
    setCopied(false);
  }, [debt, profile.locale]);

  if (!debt) return null;

  const formattedAmount = formatMoney(debt.remainingMinor, debt.currency, language);
  const daysOverdue = computeDaysOverdue(debt);
  const aiAllowedForDebts = profile.aiGlobalEnabled && (profile.aiModuleToggles?.debts ?? true);

  const handleGenerate = async () => {
    if (!aiAllowedForDebts) {
      setError(t('assistant.disabledNotice'));
      return;
    }

    const dayKey = getTodayDayKey();
    const usedToday = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
    const quota = evaluateDailyAiQuota(usedToday, entitlements);
    if (!quota.allowed) {
      setError(`Daily AI quota reached (${quota.usedToday}/${quota.dailyLimit}).`);
      return;
    }

    setLoading(true);
    setError(null);

    const res = await draftDebtReminderMessage({
      personName: debt.personName,
      formattedAmount,
      direction: debt.direction,
      dueDate: debt.dueDate ?? null,
      daysOverdue,
      tone,
      language,
      contextNote: debt.notes?.slice(0, 200),
      freeTier: entitlements.plan === 'free',
    });

    setLoading(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    setSubject(res.data.shortSubject);
    setMessage(res.data.message);
    setMetaText(`Generated in ${res.meta.latencyMs}ms`);

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

  const handleCopy = async () => {
    if (!message.trim()) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      showToast('Reminder copied to clipboard.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not access clipboard.');
    }
  };

  const cleanPhone = (debt.personPhone ?? '').replace(/[^\d]/g, '');
  const whatsAppHref = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('debts.reminderTitle')}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 sm:backdrop-blur-xs p-0 sm:p-4 overflow-y-auto anim-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-lg rounded-none sm:rounded-2xl pt-safe pb-safe sm:pt-0 sm:pb-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-y-auto sm:max-h-[90dvh] anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('debts.reminderTitle')}
            </h2>
            <p className="text-xs text-[var(--text-muted)] truncate">
              {debt.personName} · <span className="font-numeric">{formattedAmount}</span>
              {daysOverdue > 0 && ` · ${t('debts.overdueDays', { count: daysOverdue })}`}
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

        <div className="p-5 space-y-4">
          {/* Language & Tone Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Message Language
              </span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as SupportedLocale)}
                className="w-full min-h-[38px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="en">English</option>
                <option value="ar">العربية</option>
                <option value="ckb">کوردی سۆرانی</option>
                <option value="kmr">کوردی بادینی</option>
                <option value="fa">فارسی</option>
                <option value="tr">Türkçe</option>
                <option value="ru">Русский</option>
                <option value="id">Bahasa Indonesia</option>
                <option value="es">Español</option>
                <option value="de">Deutsch</option>
              </select>
            </div>

            <div>
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Tone
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]">
                {(
                  [
                    { id: 'gentle', label: t('debts.toneGentle') },
                    { id: 'firm', label: t('debts.toneFirm') },
                    { id: 'formal', label: t('debts.toneFormal') },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTone(item.id)}
                    className={`min-h-[36px] rounded-lg text-xs font-medium transition-colors truncate px-1 ${
                      tone === item.id
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGenerate()}
            className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            <span>{loading ? 'Drafting...' : t('debts.generateDraft')}</span>
          </button>

          {error && <p className="text-xs text-amber-700 dark:text-amber-300">{error}</p>}

          <div>
            {subject && (
              <div className="mb-1.5 text-xs font-medium text-[var(--text-muted)]">
                {subject}
                {metaText && <span className="font-numeric"> · {metaText}</span>}
              </div>
            )}
            <textarea
              dir={language === 'ar' || language === 'ckb' || language === 'kmr' || language === 'fa' ? 'rtl' : 'ltr'}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Click Generate Draft above, or write your custom reminder message here..."
              className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-3 text-sm leading-relaxed text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-[var(--border-hairline)]">
            <button
              type="button"
              disabled={!message.trim()}
              onClick={() => void handleCopy()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{t('debts.copyMessage')}</span>
            </button>

            <a
              href={message.trim() ? whatsAppHref : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!message.trim()}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white transition-colors ${
                message.trim() ? 'hover:bg-[var(--accent-hover)]' : 'opacity-50 pointer-events-none'
              }`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>{t('debts.openWhatsApp')}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

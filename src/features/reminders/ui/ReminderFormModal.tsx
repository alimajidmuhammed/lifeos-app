import React, { useEffect, useState } from 'react';
import { BellRing, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseNaturalLanguageReminder } from '../../../core/ai/remindersAiClient';
import { evaluateDailyAiQuota, getTodayDayKey } from '../../../core/entitlements/entitlements';
import type { DebtRecord } from '../../../core/debts/debtSchemas';
import {
  getChannelMeta,
  REMINDER_CHANNELS,
  type CreateReminderInput,
  type ReminderCategory,
  type ReminderItem,
  type ReminderPriority,
} from '../../../core/reminders/reminderSchemas';
import {
  describeRRule,
  parseRRule,
  serializeRRule,
  WEEKDAY_ORDER,
  type RRuleFreq,
  type RRuleWeekday,
} from '../../../core/reminders/rruleEngine';
import { aiUsageRepository } from '../../../data/repositories/firebaseWebAdapter';
import { useUIStore } from '../../../state/useUIStore';

interface ReminderFormModalProps {
  open: boolean;
  editingReminder: ReminderItem | null;
  initialFocusAi?: boolean;
  openDebts: DebtRecord[];
  onClose: () => void;
  onCreate: (input: CreateReminderInput) => Promise<void>;
  onUpdate: (
    current: ReminderItem,
    patch: Partial<
      Pick<
        ReminderItem,
        | 'title'
        | 'notes'
        | 'category'
        | 'priority'
        | 'dueAtIso'
        | 'rrule'
        | 'respectQuietHours'
        | 'linkedDebtId'
      >
    >
  ) => Promise<void>;
}

const WEEKDAY_LABELS: Record<RRuleWeekday, string> = {
  SU: 'Su',
  MO: 'Mo',
  TU: 'Tu',
  WE: 'We',
  TH: 'Th',
  FR: 'Fr',
  SA: 'Sa',
};

function toLocalDateYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toLocalTimeHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function combineLocalDateTimeToIso(ymd: string, hhmm: string): string {
  const [y, m, day] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const d = new Date(y, (m || 1) - 1, day || 1, hh || 0, mm || 0, 0, 0);
  return d.toISOString();
}

export const ReminderFormModal: React.FC<ReminderFormModalProps> = ({
  open,
  editingReminder,
  initialFocusAi = false,
  openDebts,
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

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<ReminderCategory>('routine');
  const [priority, setPriority] = useState<ReminderPriority>('normal');
  const [dateYmd, setDateYmd] = useState('');
  const [timeHHMM, setTimeHHMM] = useState('09:00');
  const [respectQuietHours, setRespectQuietHours] = useState(true);
  const [linkedDebtId, setLinkedDebtId] = useState('');

  // Structured Recurrence Builder state
  const [repeatMode, setRepeatMode] = useState<'none' | RRuleFreq>('none');
  const [intervalInput, setIntervalInput] = useState('1');
  const [byDays, setByDays] = useState<RRuleWeekday[]>([]);
  const [byMonthDay, setByMonthDay] = useState('');
  const [countInput, setCountInput] = useState('');

  // AI Quick Schedule state
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

    if (editingReminder) {
      const dt = new Date(editingReminder.dueAtIso);
      setTitle(editingReminder.title);
      setNotes(editingReminder.notes ?? '');
      setCategory(editingReminder.category);
      setPriority(editingReminder.priority);
      setDateYmd(toLocalDateYmd(dt));
      setTimeHHMM(toLocalTimeHHMM(dt));
      setRespectQuietHours(editingReminder.respectQuietHours);
      setLinkedDebtId(editingReminder.linkedDebtId ?? '');

      const parsedRule = parseRRule(editingReminder.rrule);
      if (parsedRule) {
        setRepeatMode(parsedRule.freq);
        setIntervalInput(String(parsedRule.interval));
        setByDays(parsedRule.byDay ?? []);
        setByMonthDay(parsedRule.byMonthDay ? String(parsedRule.byMonthDay) : '');
        setCountInput(parsedRule.count ? String(parsedRule.count) : '');
      } else {
        setRepeatMode('none');
        setIntervalInput('1');
        setByDays([]);
        setByMonthDay('');
        setCountInput('');
      }
    } else {
      const defaultDate = new Date(Date.now() + 60 * 60 * 1000);
      defaultDate.setMinutes(0, 0, 0);
      setTitle('');
      setNotes('');
      setCategory('routine');
      setPriority('normal');
      setDateYmd(toLocalDateYmd(defaultDate));
      setTimeHHMM(toLocalTimeHHMM(defaultDate));
      setRespectQuietHours(true);
      setLinkedDebtId('');
      setRepeatMode('none');
      setIntervalInput('1');
      setByDays([]);
      setByMonthDay('');
      setCountInput('');
    }
  }, [open, editingReminder]);

  if (!open) return null;

  const isEditing = Boolean(editingReminder);
  const aiAllowed = profile.aiGlobalEnabled && (profile.aiModuleToggles?.reminders ?? true);

  const computedRRule: string | undefined = (() => {
    if (repeatMode === 'none') return undefined;
    const interval = Math.max(1, Math.min(365, Number.parseInt(intervalInput, 10) || 1));
    const countVal = Number.parseInt(countInput, 10);
    const mdVal = Number.parseInt(byMonthDay, 10);
    return serializeRRule({
      freq: repeatMode,
      interval,
      byDay: repeatMode === 'WEEKLY' && byDays.length > 0 ? byDays : undefined,
      byMonthDay: repeatMode === 'MONTHLY' && mdVal >= 1 && mdVal <= 31 ? mdVal : undefined,
      count: Number.isFinite(countVal) && countVal >= 1 ? countVal : undefined,
    });
  })();

  const handleCategoryChange = (nextCat: ReminderCategory) => {
    setCategory(nextCat);
    if (!isEditing) {
      const meta = getChannelMeta(nextCat);
      setPriority(meta.defaultPriority);
      setRespectQuietHours(meta.defaultRespectQuietHours);
    }
  };

  const toggleWeekday = (day: RRuleWeekday) => {
    setByDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleAiParse = async () => {
    const trimmed = aiText.trim();
    if (!trimmed) return;
    if (!aiAllowed) {
      setAiError(t('assistant.disabledNotice'));
      return;
    }

    const dayKey = getTodayDayKey();
    const usedToday = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
    const quota = evaluateDailyAiQuota(usedToday, entitlements);
    if (!quota.allowed) {
      setAiError(`Daily AI quota reached (${quota.usedToday}/${quota.dailyLimit}). Fill schedule manually below.`);
      return;
    }

    setAiParsing(true);
    setAiError(null);
    setAiNotice(null);

    const now = new Date();
    const nowLocalIso = `${toLocalDateYmd(now)}T${toLocalTimeHHMM(now)}`;
    const res = await parseNaturalLanguageReminder({
      text: trimmed,
      locale: profile.locale,
      nowLocalIso,
      freeTier: entitlements.plan === 'free',
    });

    setAiParsing(false);

    if (!res.ok) {
      setAiError(res.error);
      return;
    }

    const draft = res.data;
    setTitle(draft.title);
    setCategory(draft.category);
    setPriority(draft.priority);
    setDateYmd(draft.dueDateYmd);
    setTimeHHMM(draft.dueTimeHHMM);
    setRespectQuietHours(draft.respectQuietHours);
    setNotes(draft.notes ?? '');

    const parsedRule = parseRRule(draft.rrule);
    if (parsedRule) {
      setRepeatMode(parsedRule.freq);
      setIntervalInput(String(parsedRule.interval));
      setByDays(parsedRule.byDay ?? []);
      setByMonthDay(parsedRule.byMonthDay ? String(parsedRule.byMonthDay) : '');
      setCountInput(parsedRule.count ? String(parsedRule.count) : '');
    } else {
      setRepeatMode('none');
      setIntervalInput('1');
      setByDays([]);
      setByMonthDay('');
      setCountInput('');
    }

    setAiNotice(draft.confidenceNote || t('reminders.aiDraftNotice'));

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

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('Reminder title is required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeHHMM)) {
      setFormError('Enter a valid date and time.');
      return;
    }

    const dueAtIso = combineLocalDateTimeToIso(dateYmd, timeHHMM);
    setSaving(true);
    try {
      if (isEditing && editingReminder) {
        await onUpdate(editingReminder, {
          title: cleanTitle,
          notes: notes.trim() || undefined,
          category,
          priority,
          dueAtIso,
          rrule: computedRRule,
          respectQuietHours,
          linkedDebtId: linkedDebtId || undefined,
        });
      } else {
        await onCreate({
          title: cleanTitle,
          notes: notes.trim() || undefined,
          category,
          priority,
          dueAtIso,
          rrule: computedRRule,
          respectQuietHours,
          linkedDebtId: linkedDebtId || undefined,
        });
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save reminder.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? t('reminders.editReminder') : t('reminders.addReminder')}
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto anim-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl rounded-b-3xl sm:rounded-2xl pt-safe border-b sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl overflow-hidden sm:my-auto max-h-[90dvh] flex flex-col anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-hairline)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {isEditing ? t('reminders.editReminder') : t('reminders.addReminder')}
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

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* AI Natural Language Schedule Parser (Create mode only, confirmation-gated) */}
          {!isEditing && (
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>{t('reminders.aiQuickSchedule')}</span>
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
                  placeholder={t('reminders.aiParsePlaceholder')}
                  className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  disabled={aiParsing || !aiText.trim()}
                  onClick={() => void handleAiParse()}
                  className="min-h-[40px] rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {aiParsing ? '...' : t('reminders.aiParseBtn')}
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

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t('reminders.titleLabel')}
              </label>
              <input
                type="text"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Take Vitamin D / Pay electricity bill"
                className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {/* Date, Time & Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('reminders.dateLabel')}
                </label>
                <input
                  type="date"
                  required
                  value={dateYmd}
                  onChange={(e) => setDateYmd(e.target.value)}
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('reminders.timeLabel')}
                </label>
                <input
                  type="time"
                  required
                  value={timeHHMM}
                  onChange={(e) => setTimeHHMM(e.target.value)}
                  className="w-full min-h-[42px] font-numeric rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('reminders.priorityLabel')}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as ReminderPriority)}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="low">{t('reminders.prioLow')}</option>
                  <option value="normal">{t('reminders.prioNormal')}</option>
                  <option value="high">{t('reminders.prioHigh')}</option>
                  <option value="urgent">{t('reminders.prioUrgent')}</option>
                </select>
              </div>
            </div>

            {/* 8 Notification Channels */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {t('reminders.channelLabel')}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {REMINDER_CHANNELS.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => handleCategoryChange(ch.id)}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                      category === ch.id
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {t(ch.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* RFC-5545 RRULE Recurrence Builder */}
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {t('reminders.recurrenceLabel')}
                </span>
                <span className="font-numeric text-[11px] text-[var(--text-muted)]">
                  {computedRRule ? `${describeRRule(computedRRule)} · ${computedRRule}` : t('reminders.oneTime')}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1 p-1 rounded-lg bg-[var(--bg-subtle)]">
                {(
                  [
                    { id: 'none', label: t('reminders.freqNone') },
                    { id: 'DAILY', label: t('reminders.freqDaily') },
                    { id: 'WEEKLY', label: t('reminders.freqWeekly') },
                    { id: 'MONTHLY', label: t('reminders.freqMonthly') },
                    { id: 'YEARLY', label: t('reminders.freqYearly') },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRepeatMode(opt.id)}
                    className={`min-h-[34px] rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      repeatMode === opt.id
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {repeatMode !== 'none' && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                        {t('reminders.intervalLabel')}
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={intervalInput}
                        onChange={(e) => setIntervalInput(e.target.value)}
                        className="w-full min-h-[38px] font-numeric rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                      />
                    </div>

                    {repeatMode === 'MONTHLY' && (
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                          Day of Month (1–31)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          placeholder="Auto"
                          value={byMonthDay}
                          onChange={(e) => setByMonthDay(e.target.value)}
                          className="w-full min-h-[38px] font-numeric rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">
                        Max Repeats (optional)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="999"
                        placeholder="Forever"
                        value={countInput}
                        onChange={(e) => setCountInput(e.target.value)}
                        className="w-full min-h-[38px] font-numeric rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                      />
                    </div>
                  </div>

                  {repeatMode === 'WEEKLY' && (
                    <div>
                      <span className="block text-[11px] font-medium text-[var(--text-muted)] mb-1.5">
                        Repeat on weekdays
                      </span>
                      <div className="grid grid-cols-7 gap-1">
                        {WEEKDAY_ORDER.map((day) => {
                          const active = byDays.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => toggleWeekday(day)}
                              className={`min-h-[36px] rounded-lg border text-xs font-semibold transition-colors ${
                                active
                                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                  : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                              }`}
                            >
                              {WEEKDAY_LABELS[day]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quiet Hours Policy Toggle */}
            <label className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-3 cursor-pointer">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <BellRing className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                  <span>{t('reminders.respectQuietHoursLabel')}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                  Quiet hours ({profile.quietHoursStart}–{profile.quietHoursEnd}): when enabled, night alerts shift to {profile.quietHoursEnd}. Turn off for urgent medicine doses.
                </p>
              </div>
              <input
                type="checkbox"
                checked={respectQuietHours}
                onChange={(e) => setRespectQuietHours(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[var(--accent)] shrink-0"
              />
            </label>

            {/* Optional Linked Open Debt */}
            {openDebts.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Link to Open Debt (optional)
                </label>
                <select
                  value={linkedDebtId}
                  onChange={(e) => setLinkedDebtId(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">None</option>
                  {openDebts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.personName} ({d.direction === 'owed_to_me' ? 'Owed to Me' : 'I Owe'} · {d.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t('reminders.notesLabel')}
              </label>
              <textarea
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional dosage, account number, or preparation notes..."
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {formError && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">{formError}</p>
            )}

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
                disabled={saving}
                className="min-h-[42px] rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {saving ? '...' : isEditing ? t('reminders.saveChanges') : t('reminders.saveReminder')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

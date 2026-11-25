import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  runGlobalToolAssistant,
  type GlobalAssistantResult,
  type ProposedToolAction,
} from '../core/ai/globalAssistantClient';
import { defaultLLMProvider, type AIRuntimeStatus } from '../core/ai/llmProvider';
import { toMinorUnits, type CurrencyCode } from '../core/currency/currency';
import { evaluateDailyAiQuota, getTodayDayKey } from '../core/entitlements/entitlements';
import {
  ALL_TRANSACTION_CATEGORIES,
  FINANCE_ACCOUNTS,
  type FinanceAccount,
  type TransactionCategory,
} from '../core/finance/financeSchemas';
import { HABIT_CATEGORIES, type HabitCategory } from '../core/habits/habitSchemas';
import { DebtCategorySchema, type DebtCategory, type DebtDirection } from '../core/debts/debtSchemas';
import {
  searchWorkspaceSnapshot,
  type SearchModuleId,
  type WorkspaceSnapshot,
} from '../core/search/globalSearchEngine';
import { aiUsageRepository } from '../data/repositories/firebaseWebAdapter';
import { useDebts } from '../hooks/useDebts';
import { useFinance } from '../hooks/useFinance';
import { useHabits } from '../hooks/useHabits';
import { useNotes } from '../hooks/useNotes';
import { usePlanner } from '../hooks/usePlanner';
import { useReminders } from '../hooks/useReminders';
import { useVault } from '../hooks/useVault';
import { useUIStore, type NavRoute } from '../state/useUIStore';

const MODULE_LABELS: Record<SearchModuleId, string> = {
  debts: 'Debts',
  reminders: 'Reminders',
  planner: 'Planner',
  notes: 'Notes',
  vault: 'Vault',
  habits: 'Habits',
  finance: 'Finance',
};

export const AICommandPalette: React.FC = () => {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setActiveRoute = useUIStore((s) => s.setActiveRoute);
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const todayAiUsage = useUIStore((s) => s.todayAiUsage);
  const incrementLocalAiUsage = useUIStore((s) => s.incrementLocalAiUsage);
  const showToast = useUIStore((s) => s.showToast);

  // Live workspace data across all 7 modules
  const { debts, fxRates, createDebt } = useDebts();
  const { reminders, createReminder } = useReminders();
  const { tasks, createTask } = usePlanner();
  const { notes } = useNotes();
  const { documents: vaultDocs } = useVault();
  const { habits, logs: habitLogs, createHabit } = useHabits();
  const { transactions, budgets, subscriptions, createTransaction } = useFinance();

  const [input, setInput] = useState('');
  const [moduleFilter, setModuleFilter] = useState<'all' | SearchModuleId>('all');
  const [simulateVaultImage, setSimulateVaultImage] = useState(false);
  const [simulateLockedNote, setSimulateLockedNote] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executingAction, setExecutingAction] = useState(false);
  const [result, setResult] = useState<GlobalAssistantResult | null>(null);
  const [actionConfirmedMsg, setActionConfirmedMsg] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<AIRuntimeStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    void defaultLLMProvider.getRuntimeStatus().then(setRuntimeStatus);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  const dayKey = getTodayDayKey();

  const workspaceSnapshot: WorkspaceSnapshot = useMemo(
    () => ({
      debts,
      reminders,
      tasks,
      notes,
      vaultDocs,
      habits,
      habitLogs,
      transactions,
      budgets,
      subscriptions,
      primaryCurrency: profile.primaryCurrency,
      locale: profile.locale,
      fxRates,
      todayYmd: dayKey,
    }),
    [
      debts,
      reminders,
      tasks,
      notes,
      vaultDocs,
      habits,
      habitLogs,
      transactions,
      budgets,
      subscriptions,
      profile.primaryCurrency,
      profile.locale,
      fxRates,
      dayKey,
    ]
  );

  // Instant offline cross-module search hits as the user types
  const localHits = useMemo(() => {
    const q = input.trim();
    if (q.length < 2) return [];
    return searchWorkspaceSnapshot(workspaceSnapshot, q, {
      moduleFilter,
      forCloudAiTool: false,
      limit: 8,
    });
  }, [workspaceSnapshot, input, moduleFilter]);

  if (!open) return null;

  const usedCount = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
  const quota = evaluateDailyAiQuota(usedCount, entitlements);
  const freeTier = runtimeStatus?.freeTier ?? true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    if (!profile.aiGlobalEnabled) {
      setResult({
        ok: false,
        code: 'AI_DISABLED',
        error: t('assistant.disabledNotice'),
      });
      return;
    }

    if (!quota.allowed) {
      setResult({
        ok: false,
        code: 'DAILY_QUOTA_REACHED',
        error: `Daily AI quota reached (${quota.usedToday}/${quota.dailyLimit}). Instant cross-module local search remains available.`,
      });
      return;
    }

    setLoading(true);
    setActionConfirmedMsg(null);
    setResult(null);

    const res = await runGlobalToolAssistant({
      query: trimmed,
      locale: profile.locale,
      snapshot: workspaceSnapshot,
      freeTier,
      simulateVaultImage,
      simulateLockedNote,
    });

    setResult(res);
    setLoading(false);

    if (res.ok) {
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
    }
  };

  const executeConfirmedAction = async (action: ProposedToolAction) => {
    setExecutingAction(true);
    try {
      const p = action.payload ?? {};
      if (action.actionType === 'create_task') {
        const title = String(p.title || action.title).trim().slice(0, 200);
        const rawList = String(p.listId || 'inbox');
        const listId = ['inbox', 'personal', 'work', 'finance', 'health'].includes(rawList)
          ? (rawList as 'inbox' | 'personal' | 'work' | 'finance' | 'health')
          : 'inbox';
        const prioNum = Number(p.priority);
        const priority =
          prioNum >= 1 && prioNum <= 4 ? (Math.round(prioNum) as 1 | 2 | 3 | 4) : 2;
        const dueDate =
          typeof p.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate)
            ? p.dueDate
            : undefined;
        await createTask({ title, listId, priority, status: 'todo', dueDate, subtasks: [] });
        const msg = `Created task "${title}" in Planner.`;
        setActionConfirmedMsg(msg);
        showToast(msg);
      } else if (action.actionType === 'create_reminder') {
        const title = String(p.title || action.title).trim().slice(0, 200);
        const rawCat = String(p.category || 'custom');
        const category = [
          'routine',
          'birthday',
          'debt',
          'task',
          'medicine',
          'bill',
          'expiry',
          'custom',
        ].includes(rawCat)
          ? (rawCat as
              | 'routine'
              | 'birthday'
              | 'debt'
              | 'task'
              | 'medicine'
              | 'bill'
              | 'expiry'
              | 'custom')
          : 'custom';
        const dueDateYmd =
          typeof p.dueDateYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDateYmd)
            ? p.dueDateYmd
            : dayKey;
        const dueTimeHHMM =
          typeof p.dueTimeHHMM === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.dueTimeHHMM)
            ? p.dueTimeHHMM
            : '09:00';
        const rrule = typeof p.rrule === 'string' && p.rrule.trim() ? p.rrule.trim() : undefined;
        await createReminder({
          title,
          category,
          priority: category === 'medicine' ? 'urgent' : 'normal',
          dueAtIso: `${dueDateYmd}T${dueTimeHHMM}:00.000Z`,
          rrule,
          respectQuietHours: category !== 'medicine',
        });
        const msg = `Scheduled reminder "${title}" for ${dueDateYmd} ${dueTimeHHMM}.`;
        setActionConfirmedMsg(msg);
        showToast(msg);
      } else if (action.actionType === 'create_habit') {
        const name = String(p.name || action.title).trim().slice(0, 120);
        const rawCat = String(p.category || 'health');
        const category: HabitCategory = (HABIT_CATEGORIES as readonly string[]).includes(rawCat)
          ? (rawCat as HabitCategory)
          : 'health';
        const frequency = p.frequency === 'weekly' ? 'weekly' : 'daily';
        const targetPerWeek =
          frequency === 'daily'
            ? 7
            : Math.max(1, Math.min(7, Number(p.targetPerWeek) || 4));
        await createHabit({ name, category, frequency, targetPerWeek });
        const msg = `Added habit "${name}" to Habits Tracker.`;
        setActionConfirmedMsg(msg);
        showToast(msg);
      } else if (action.actionType === 'create_transaction') {
        const type = p.type === 'income' ? 'income' : 'expense';
        const rawCurr = String(p.currency || profile.primaryCurrency).toUpperCase();
        const currency: CurrencyCode =
          rawCurr === 'USD' || rawCurr === 'EUR' || rawCurr === 'IQD'
            ? rawCurr
            : profile.primaryCurrency;
        const major = Math.max(1, Number(p.amountMajor) || 1);
        const rawCat = String(p.category || 'other');
        const category: TransactionCategory = (
          ALL_TRANSACTION_CATEGORIES as readonly string[]
        ).includes(rawCat)
          ? (rawCat as TransactionCategory)
          : 'other';
        const rawAcc = String(p.account || 'cash');
        const account: FinanceAccount = (FINANCE_ACCOUNTS as readonly string[]).includes(rawAcc)
          ? (rawAcc as FinanceAccount)
          : 'cash';
        const occurredOn =
          typeof p.occurredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.occurredOn)
            ? p.occurredOn
            : dayKey;
        await createTransaction({
          type,
          amountMinor: toMinorUnits(major, currency),
          currency,
          category,
          occurredOn,
          account,
          merchant: typeof p.merchant === 'string' ? p.merchant.slice(0, 120) : undefined,
          note: typeof p.note === 'string' ? p.note.slice(0, 500) : action.details.slice(0, 500),
          isRecurring: false,
        });
        const msg = `Recorded ${type} in Personal Finance (${major} ${currency}).`;
        setActionConfirmedMsg(msg);
        showToast(msg);
      } else if (action.actionType === 'create_debts') {
        const rawItems = Array.isArray(p.items) ? p.items : [p];
        let createdCount = 0;
        for (const rawItem of rawItems) {
          if (!rawItem || typeof rawItem !== 'object') continue;
          const item = rawItem as Record<string, unknown>;
          const personName = String(item.personName || '').trim().slice(0, 120);
          const amountMajor = Number(item.amountMajor);
          if (!personName || !Number.isFinite(amountMajor) || amountMajor <= 0) continue;
          const direction: DebtDirection =
            item.direction === 'owed_to_me' ? 'owed_to_me' : 'i_owe';
          const rawCurr = String(item.currency || profile.primaryCurrency).toUpperCase();
          const currency: CurrencyCode =
            rawCurr === 'USD' || rawCurr === 'EUR' || rawCurr === 'IQD'
              ? rawCurr
              : profile.primaryCurrency;
          const rawCat = String(item.category || 'personal');
          const category: DebtCategory = (DebtCategorySchema.options as readonly string[]).includes(rawCat)
            ? (rawCat as DebtCategory)
            : 'personal';
          const dueDate =
            typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
              ? item.dueDate
              : undefined;
          const notes =
            typeof item.notes === 'string' && item.notes.trim()
              ? item.notes.trim().slice(0, 2000)
              : undefined;

          await createDebt({
            direction,
            personName,
            category,
            principalMinor: toMinorUnits(amountMajor, currency),
            currency,
            dueDate,
            notes,
          });
          createdCount += 1;
        }
        const msg =
          createdCount > 0
            ? `Added ${createdCount} debt record${createdCount === 1 ? '' : 's'} to Debts Manager.`
            : 'No valid debt entries found to create.';
        setActionConfirmedMsg(msg);
        showToast(msg);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not apply proposed action.');
    } finally {
      setExecutingAction(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('assistant.title')}
      className="fixed inset-0 z-50 flex items-stretch sm:items-start justify-center bg-[var(--bg-surface)] sm:bg-slate-950/60 p-0 sm:p-4 sm:pt-16 sm:backdrop-blur-xs overflow-y-auto anim-modal-backdrop"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full h-dvh sm:h-auto sm:max-w-2xl rounded-none sm:rounded-2xl pt-safe pb-safe sm:pt-0 sm:pb-0 border-0 sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:shadow-xl overflow-y-auto sm:max-h-[85dvh] anim-top-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-hairline)] px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Global Search &amp; AI Command Palette
              </h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Instant offline search across all 7 modules + Privacy-Gated Gemini tool-calling with confirmation preview.
            </p>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setOpen(false)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status Metadata Line (Unboxed, Zero-Pill Discipline) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-6 py-2.5 text-xs text-[var(--text-muted)]">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            <span>{freeTier ? 'Privacy Gate: Free Tier Strict' : 'Paid Zero-Retention Tier'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-numeric">
              {t('ui.assistantHeader')}
            </span>
          </div>
          <div className="font-numeric text-[var(--text-secondary)]">
            Quota: {quota.usedToday}/{quota.dailyLimit}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!profile.aiGlobalEnabled && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200">
              {t('assistant.disabledNotice')}
            </div>
          )}

          {/* Unified Search / AI Input */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3.5 top-3.5 h-4 w-4 text-[var(--text-muted)]" />
              <label htmlFor="ai-command-input" className="sr-only">
                {t('ui.assistantSearchTitle')}
              </label>
              <textarea
                id="ai-command-input"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='Search across all 7 modules, or ask AI: "How much did I spend this month?" or "Add a daily habit to read 20 minutes"'
                className="w-full resize-none rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] ps-10 pe-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            {/* Module Scope Filter for Local Instant Search */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-muted)]">Search scope:</span>
                <select
                  aria-label="Global search module filter"
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value as 'all' | SearchModuleId)}
                  className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
                >
                  <option value="all">{t('ui.all7Modules')}</option>
                  {(Object.keys(MODULE_LABELS) as SearchModuleId[]).map((m) => (
                    <option key={m} value={m}>
                      {MODULE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <span className="font-numeric text-[var(--text-muted)]">
                {localHits.length > 0 ? `${localHits.length} instant local matches` : 'Type ≥2 chars for local search'}
              </span>
            </div>
          </div>

          {/* Instant Offline Cross-Module Search Results */}
          {localHits.length > 0 && (
            <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] divide-y divide-[var(--border-hairline)] overflow-hidden">
              {localHits.map((hit) => (
                <button
                  key={`${hit.module}-${hit.id}`}
                  type="button"
                  onClick={() => {
                    setActiveRoute(hit.module as NavRoute);
                    setOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 text-start flex items-center justify-between gap-3 hover:bg-[var(--bg-subtle)]/70 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--accent)]">
                        {MODULE_LABELS[hit.module]}
                      </span>
                      <span aria-hidden="true" className="text-[var(--text-muted)]">
                        ·
                      </span>
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {hit.title}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate">
                      {hit.subtitle}
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                </button>
              ))}
            </div>
          )}

          {/* Privacy Gate Test Checkboxes */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-[var(--text-secondary)]">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateVaultImage}
                onChange={(e) => setSimulateVaultImage(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-hairline)] accent-emerald-600"
              />
              <span>{t('assistant.includeVaultToggle')}</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateLockedNote}
                onChange={(e) => setSimulateLockedNote(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-hairline)] accent-emerald-600"
              />
              <span>{t('assistant.includeLockedToggle')}</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-[42px] rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
            >
              <Send className="h-4 w-4" />
              <span>{loading ? 'Running Tools...' : 'Ask AI Assistant'}</span>
            </button>
          </div>
        </form>

        {/* Output / Tool Trace / Privacy Gate Block / Live Confirmation Action */}
        {result && (
          <div className="border-t border-[var(--border-hairline)] bg-[var(--bg-canvas)]/60 p-6">
            {!result.ok ? (
              <div
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/5 p-4"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>
                    {result.privacyBlocked ? t('assistant.privacyBlockedTitle') : 'AI Unavailable'}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{result.error}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {result.toolsInvoked.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Wrench className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                    <span className="font-medium text-[var(--text-secondary)]">Tools called:</span>
                    <span className="font-numeric">
                      {result.toolsInvoked.map((tc) => tc.name).join(' · ')}
                    </span>
                  </div>
                )}

                <div>
                  <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-line">
                    {result.answer}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 font-numeric text-xs text-[var(--text-muted)]">
                    <span>{result.meta.latencyMs}ms</span>
                    <span aria-hidden="true">·</span>
                    <span>{t('ui.deterministicExec')}</span>
                  </div>
                </div>

                {result.proposedAction && (
                  <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {t('assistant.confirmationTitle')}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {t('assistant.confirmationDesc')}
                    </p>
                    <div className="mt-3 rounded-lg bg-[var(--bg-subtle)] p-3 text-xs space-y-2">
                      <div className="font-medium text-[var(--text-primary)]">
                        {result.proposedAction.title}
                      </div>
                      <div className="text-[var(--text-secondary)]">
                        {result.proposedAction.details}
                      </div>
                      {result.proposedAction.actionType === 'create_debts' &&
                        Array.isArray(
                          (result.proposedAction.payload as Record<string, unknown>)?.items
                        ) && (
                          <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
                            {(
                              (result.proposedAction.payload as Record<string, unknown>)
                                .items as Array<Record<string, unknown>>
                            ).map((item, idx) => {
                              const direction =
                                item.direction === 'they_owe_me' ? 'they_owe_me' : 'i_owe';
                              const isOwedToMe = direction === 'they_owe_me';
                              const person = String(item.personName || 'Contact');
                              const amt = Number(item.amountMajor || 0);
                              const curr = String(item.currency || 'USD').toUpperCase();
                              const itemNotes =
                                typeof item.notes === 'string' && item.notes.trim()
                                  ? item.notes.trim()
                                  : null;
                              return (
                                <div
                                  key={`${person}-${curr}-${idx}`}
                                  className="flex items-center justify-between gap-2 px-3 py-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate font-medium text-[var(--text-primary)]">
                                        {person}
                                      </span>
                                      <span
                                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                          isOwedToMe
                                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                        }`}
                                      >
                                        {isOwedToMe ? 'Owed to me' : 'I owe'}
                                      </span>
                                    </div>
                                    {itemNotes && (
                                      <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                                        {itemNotes}
                                      </div>
                                    )}
                                  </div>
                                  <span className="shrink-0 font-numeric font-semibold text-[var(--text-primary)]">
                                    {amt.toLocaleString()} {curr}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      <div className="font-numeric text-[var(--text-muted)]">
                        Target: {result.proposedAction.module} · Action:{' '}
                        {result.proposedAction.actionType}
                      </div>
                    </div>

                    {actionConfirmedMsg ? (
                      <div className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>{actionConfirmedMsg}</span>
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={executingAction}
                          onClick={() => void executeConfirmedAction(result.proposedAction!)}
                          className="min-h-[40px] rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
                        >
                          {executingAction ? t('ui.applying') : t('common.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setResult(null)}
                          className="min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

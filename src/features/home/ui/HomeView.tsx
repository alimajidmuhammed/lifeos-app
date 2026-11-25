import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BookText,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Flame,
  FolderLock,
  Plus,
  Scale,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../core/currency/currency';
import { aggregateDebtMetrics, computeEffectiveStatus } from '../../../core/debts/debtEngine';
import { evaluateDailyAiQuota, getTodayDayKey } from '../../../core/entitlements/entitlements';
import { defaultLLMProvider, type AIResult } from '../../../core/ai/llmProvider';
import { getEffectiveFireDate } from '../../../core/reminders/notificationScheduler';
import { hapticLight, hapticSuccess } from '../../../core/native/mobileBridge';
import { aiUsageRepository } from '../../../data/repositories/firebaseWebAdapter';
import { useDebts } from '../../../hooks/useDebts';
import { useReminders } from '../../../hooks/useReminders';
import { usePlanner } from '../../../hooks/usePlanner';
import { useNotes } from '../../../hooks/useNotes';
import { useVault } from '../../../hooks/useVault';
import { useHabits } from '../../../hooks/useHabits';
import { useFinance } from '../../../hooks/useFinance';
import { useUIStore, type NavRoute } from '../../../state/useUIStore';
import { LottieBadge } from '../../../components/LottieBadge';
import allCaughtUpAnim from '../../../assets/lottie/all-caught-up.json';

const ONBOARDING_DISMISSED_KEY = 'lifeos_onboarding_dismissed_v1';

interface TodayItem {
  id: string;
  kind: 'debt' | 'reminder' | 'task' | 'vault';
  title: string;
  context: string;
  status: 'overdue' | 'due_today' | 'expiring';
  route: NavRoute;
  sortPriority: number;
  onComplete?: () => Promise<void>;
  onSnooze?: () => Promise<void>;
}

export const HomeView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const todayAiUsage = useUIStore((s) => s.todayAiUsage);
  const setActiveRoute = useUIStore((s) => s.setActiveRoute);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const incrementLocalAiUsage = useUIStore((s) => s.incrementLocalAiUsage);
  const showToast = useUIStore((s) => s.showToast);

  const { debts, fxRates } = useDebts();
  const { reminders, summary: remSummary, rollingQueue, completeReminder, snoozeReminder } = useReminders();
  const { tasks, summary: plannerSummary, setTaskStatus } = usePlanner();
  const { summary: notesSummary } = useNotes();
  const { documents: vaultDocs, summary: vaultSummary } = useVault();
  const { summary: habitsSummary } = useHabits();
  const { monthlySummary: financeSummary } = useFinance();

  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingResult, setBriefingResult] = useState<AIResult | null>(null);
  const [onboardingExpanded, setOnboardingExpanded] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const dayKey = getTodayDayKey();
  const usedToday = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
  const quota = evaluateDailyAiQuota(usedToday, entitlements);
  const debtMetrics = aggregateDebtMetrics(debts, profile.primaryCurrency, fxRates, dayKey);

  // Extract clean, capitalized first name (never show generic "Personal Workspace")
  const firstName = useMemo(() => {
    const raw =
      (profile.displayName && profile.displayName.toLowerCase() !== 'personal workspace'
        ? profile.displayName
        : authUser?.displayName) || '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === 'personal workspace') return '';
    const first = trimmed.split(/\s+/)[0];
    return first.charAt(0).toUpperCase() + first.slice(1);
  }, [authUser?.displayName, profile.displayName]);

  const formattedToday = useMemo(() => {
    const now = new Date();
    if (profile.locale === 'ckb') {
      const days = ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'];
      const months = ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەمموز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'];
      return `${days[now.getDay()]}، ${now.getDate()} ${months[now.getMonth()]}`;
    }
    if (profile.locale === 'kmr') {
      const days = ['Yekşem', 'Duşem', 'Sêşem', 'Çarşem', 'Pêncşem', 'În', 'Şemî'];
      const months = ['Çile', 'Sibat', 'Adar', 'Nîsan', 'Gulan', 'Hezîran', 'Tîrmeh', 'Tebax', 'Îlon', 'Cotmeh', 'Mijdar', 'Kanûn'];
      return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
    }
    const localeTag = profile.locale === 'en' ? 'en-US' : profile.locale;
    return new Intl.DateTimeFormat(localeTag, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(now);
  }, [profile.locale]);

  // Unified "Needs you today" list (real items only, no fabricated data)
  const needsYouToday = useMemo<TodayItem[]>(() => {
    const items: TodayItem[] = [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday = startOfToday + 24 * 60 * 60 * 1000 - 1;
    const localeTag = profile.locale === 'en' ? 'en-US' : profile.locale;

    // 1. Overdue & due-today reminders
    for (const r of reminders) {
      if (r.isCompleted || r.status === 'completed' || r.status === 'archived') continue;
      const eff = getEffectiveFireDate(r);
      const ms = eff.getTime();
      if (ms <= endOfToday) {
        const isOverdue = ms < now.getTime();
        const timeStr = new Intl.DateTimeFormat(localeTag, {
          hour: '2-digit',
          minute: '2-digit',
        }).format(eff);
        items.push({
          id: `rem_${r.id}`,
          kind: 'reminder',
          title: r.title,
          context: timeStr,
          status: isOverdue ? 'overdue' : 'due_today',
          route: 'reminders',
          sortPriority: isOverdue ? 0 : 2,
          onComplete: async () => {
            void hapticSuccess();
            await completeReminder(r);
            showToast(`Completed "${r.title}"`);
          },
          onSnooze: async () => {
            void hapticLight();
            const target = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            await snoozeReminder(r, target);
            showToast(`Snoozed "${r.title}" 1h`);
          },
        });
      }
    }

    // 2. Overdue & due-today debts
    for (const d of debts) {
      const effStatus = computeEffectiveStatus(d, dayKey);
      if (effStatus === 'settled') continue;
      const isOverdue = effStatus === 'overdue';
      const isDueToday = d.dueDate === dayKey;
      if (isOverdue || isDueToday) {
        items.push({
          id: `debt_${d.id}`,
          kind: 'debt',
          title: d.personName,
          context: formatMoney(d.remainingMinor, d.currency, profile.locale),
          status: isOverdue ? 'overdue' : 'due_today',
          route: 'debts',
          sortPriority: isOverdue ? 1 : 3,
        });
      }
    }

    // 3. Overdue & due-today planner tasks
    for (const task of tasks) {
      if (task.status === 'done' || !task.dueDate) continue;
      const isOverdue = task.dueDate < dayKey;
      const isDueToday = task.dueDate === dayKey;
      if (isOverdue || isDueToday) {
        items.push({
          id: `task_${task.id}`,
          kind: 'task',
          title: task.title,
          context: task.dueDate,
          status: isOverdue ? 'overdue' : 'due_today',
          route: 'planner',
          sortPriority: isOverdue ? 1 : 4,
          onComplete: async () => {
            void hapticSuccess();
            await setTaskStatus(task, 'done');
            showToast(`Completed "${task.title}"`);
          },
        });
      }
    }

    // 4. Vault documents expiring soon or expired
    for (const doc of vaultDocs) {
      if (!doc.expiryDate) continue;
      const expMs = Date.parse(`${doc.expiryDate}T00:00:00`);
      const daysLeft = Math.ceil((expMs - startOfToday) / 86_400_000);
      if (daysLeft <= 30) {
        items.push({
          id: `vault_${doc.id}`,
          kind: 'vault',
          title: doc.title,
          context: doc.expiryDate,
          status: daysLeft < 0 ? 'overdue' : 'expiring',
          route: 'vault',
          sortPriority: daysLeft < 0 ? 1 : 5,
        });
      }
    }

    return items.sort((a, b) => a.sortPriority - b.sortPriority).slice(0, 8);
  }, [
    reminders,
    debts,
    tasks,
    vaultDocs,
    dayKey,
    profile.locale,
    completeReminder,
    snoozeReminder,
    setTaskStatus,
    showToast,
  ]);

  // First-run onboarding checklist (auto-checked from real data)
  const onboardingSteps = useMemo(
    () => [
      {
        id: 'signin',
        label: t('home.stepSignIn'),
        done: Boolean(authUser),
        route: 'settings' as NavRoute,
      },
      {
        id: 'debt',
        label: t('home.stepFirstDebt'),
        done: debts.length > 0,
        route: 'debts' as NavRoute,
      },
      {
        id: 'reminder',
        label: t('home.stepDailyReminder'),
        done: reminders.length > 0,
        route: 'reminders' as NavRoute,
      },
      {
        id: 'vault',
        label: t('home.stepScanDoc'),
        done: vaultSummary.totalDocs > 0,
        route: 'vault' as NavRoute,
      },
      {
        id: 'e2e',
        label: t('home.stepVaultPassphrase'),
        done: Boolean(profile.e2eConfigured),
        route: 'settings' as NavRoute,
      },
    ],
    [t, authUser, debts.length, reminders.length, vaultSummary.totalDocs, profile.e2eConfigured]
  );

  const onboardingDoneCount = onboardingSteps.filter((s) => s.done).length;
  const nextOnboardingStep = onboardingSteps.find((s) => !s.done) ?? null;
  const showOnboarding = !onboardingDismissed && onboardingDoneCount < onboardingSteps.length;

  const dismissOnboarding = () => {
    void hapticLight();
    setOnboardingDismissed(true);
    try {
      localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    } catch {
      // Ignore
    }
  };

  const handleGenerateBriefing = async () => {
    void hapticLight();
    setBriefingOpen(true);
    if (!profile.aiGlobalEnabled) {
      setBriefingResult({
        ok: false,
        code: 'AI_DISABLED',
        error: t('assistant.disabledNotice'),
      });
      return;
    }
    if (!quota.allowed) {
      setBriefingResult({
        ok: false,
        code: 'DAILY_QUOTA_REACHED',
        error: `Daily AI quota reached (${quota.usedToday}/${quota.dailyLimit}).`,
      });
      return;
    }

    setBriefingLoading(true);
    const netFmt = formatMoney(debtMetrics.equivalentNetPrimaryMinor, profile.primaryCurrency, profile.locale);
    const finNetFmt = formatMoney(financeSummary.netPrimaryMinor, profile.primaryCurrency, profile.locale);
    const prompt = `Provide a calm 2-sentence executive daily briefing for LifeOS. Primary currency: ${profile.primaryCurrency}. Open debts: ${debtMetrics.totalOpenCount}, Overdue: ${debtMetrics.totalOverdueCount}, Net balance: ${netFmt}. Reminders due today: ${remSummary.dueTodayCount}. Tasks: ${plannerSummary.activeCount} (${plannerSummary.dueTodayCount} due today). Notes: ${notesSummary.totalNotes}. Vault: ${vaultSummary.totalDocs}. Habits: ${habitsSummary.completedTodayCount}/${habitsSummary.activeCount} completed. Finance net: ${finNetFmt}. Suggest one actionable focus for today.`;

    const res = await defaultLLMProvider.complete(
      {
        module: 'assistant',
        taskType: 'briefing',
        text: prompt,
        locale: profile.locale,
        tier: 'lite',
      },
      true
    );
    setBriefingResult(res);
    setBriefingLoading(false);

    if (res.ok && !res.meta.cached) {
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

  const habitsRatio =
    habitsSummary.activeCount > 0
      ? habitsSummary.completedTodayCount / habitsSummary.activeCount
      : null;

  const moduleTiles: Array<{
    id: NavRoute;
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    primaryValue: string | null;
    hint: string;
    realRatio?: number | null;
  }> = [
    {
      id: 'debts',
      name: t('nav.debts'),
      icon: Scale,
      primaryValue:
        debts.length > 0
          ? formatMoney(debtMetrics.equivalentNetPrimaryMinor, profile.primaryCurrency, profile.locale)
          : null,
      hint:
        debts.length > 0
          ? `${debtMetrics.totalOpenCount} open`
          : t('home.emptyHintDebts'),
    },
    {
      id: 'reminders',
      name: t('nav.reminders'),
      icon: Bell,
      primaryValue: reminders.length > 0 ? String(remSummary.activeCount) : null,
      hint:
        reminders.length > 0
          ? `${remSummary.dueTodayCount} due today`
          : t('home.emptyHintReminders'),
    },
    {
      id: 'planner',
      name: t('nav.planner'),
      icon: CheckSquare,
      primaryValue: tasks.length > 0 ? String(plannerSummary.activeCount) : null,
      hint:
        tasks.length > 0
          ? `${plannerSummary.dueTodayCount} due today`
          : t('home.emptyHintPlanner'),
    },
    {
      id: 'finance',
      name: t('nav.finance'),
      icon: Wallet,
      primaryValue:
        financeSummary.transactionCount > 0
          ? formatMoney(financeSummary.netPrimaryMinor, profile.primaryCurrency, profile.locale)
          : null,
      hint:
        financeSummary.transactionCount > 0
          ? `${financeSummary.transactionCount} this month`
          : t('home.emptyHintFinance'),
    },
    {
      id: 'habits',
      name: t('nav.habits'),
      icon: Flame,
      primaryValue:
        habitsSummary.activeCount > 0
          ? `${habitsSummary.completedTodayCount}/${habitsSummary.activeCount}`
          : null,
      hint:
        habitsSummary.activeCount > 0
          ? habitsSummary.bestActiveStreak > 0
            ? t('home.streakDays', { count: habitsSummary.bestActiveStreak })
            : 'Today'
          : t('home.emptyHintHabits'),
      realRatio: habitsRatio,
    },
    {
      id: 'notes',
      name: t('nav.notes'),
      icon: BookText,
      primaryValue: notesSummary.totalNotes > 0 ? String(notesSummary.totalNotes) : null,
      hint:
        notesSummary.totalNotes > 0
          ? `${notesSummary.pinnedCount} pinned`
          : t('home.emptyHintNotes'),
    },
    {
      id: 'vault',
      name: t('nav.vault'),
      icon: FolderLock,
      primaryValue: vaultSummary.totalDocs > 0 ? String(vaultSummary.totalDocs) : null,
      hint:
        vaultSummary.totalDocs > 0
          ? t('home.vaultExpiringCount', { count: vaultSummary.expiredCount + vaultSummary.expiring90Count })
          : t('home.emptyHintVault'),
    },
  ];

  const nextUpcoming = rollingQueue.slots[0] ?? null;

  return (
    <div className="space-y-6">
      {/* ── 1. Compact Header (max ~96px on mobile) ── */}
      <section className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                authUser ? 'bg-[var(--status-ok)]' : 'bg-[var(--text-muted)]'
              }`}
              aria-hidden="true"
            />
            <span>{authUser ? t('common.syncedCloudMode') : t('common.offlineLocalMode')}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{formattedToday}</span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)] truncate">
            {firstName ? `${t('home.greeting')}, ${firstName}` : t('home.greeting')}
          </h1>
        </div>
      </section>

      {/* ── 2. Quick Capture Row (horizontally scrollable with edge fade, single AI entry in header) ── */}
      <section aria-label={t('home.quickCaptureLabel')} className="relative">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 pe-10 -mx-1 px-1">
          {(
            [
              { label: t('home.chipExpense'), icon: Plus, route: 'finance' as NavRoute },
              { label: t('home.chipTask'), icon: CheckSquare, route: 'planner' as NavRoute },
              { label: t('home.chipReminder'), icon: Bell, route: 'reminders' as NavRoute },
              { label: t('home.chipScanDoc'), icon: Camera, route: 'vault' as NavRoute },
              { label: t('home.chipNote'), icon: BookText, route: 'notes' as NavRoute },
            ] as const
          ).map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => {
                  void hapticLight();
                  setActiveRoute(chip.route);
                }}
                className="min-h-[44px] shrink-0 inline-flex items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] btn-spring whitespace-nowrap"
              >
                <Icon className="h-4 w-4 text-[var(--accent)]" />
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 end-0 w-10 bg-gradient-to-l rtl:bg-gradient-to-r from-[var(--bg-canvas)] to-transparent"
        />
      </section>

      {/* ── 3. Slim Collapsible First-Run Setup Row (expands on tap) ── */}
      {showOnboarding && (
        <section
          aria-label={t('home.onboardingTitle')}
          className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden"
        >
          <button
            type="button"
            onClick={() => {
              void hapticLight();
              setOnboardingExpanded((prev) => !prev);
            }}
            className="w-full min-h-[48px] px-4 py-2.5 flex items-center justify-between gap-3 text-start hover:bg-[var(--bg-subtle)]/40 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-14 h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                  style={{ width: `${Math.round((onboardingDoneCount / onboardingSteps.length) * 100)}%` }}
                />
              </div>
              <span className="tabular-nums-ui text-xs font-semibold text-[var(--text-secondary)] shrink-0">
                {t('home.setupProgress', {
                  done: onboardingDoneCount,
                  total: onboardingSteps.length,
                })}
              </span>
              {nextOnboardingStep && (
                <span className="text-xs text-[var(--text-muted)] truncate">
                  · {nextOnboardingStep.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-[var(--text-muted)] shrink-0">
              {onboardingExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </div>
          </button>

          {onboardingExpanded && (
            <div className="px-4 pb-3 pt-2 border-t border-[var(--border-hairline)] space-y-2">
              <div className="divide-y divide-[var(--border-hairline)]">
                {onboardingSteps.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => {
                      void hapticLight();
                      setActiveRoute(step.route);
                    }}
                    className="w-full min-h-[44px] py-2 flex items-center justify-between gap-3 text-start hover:bg-[var(--bg-subtle)]/50 rounded-lg px-2 -mx-2 transition-colors"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      {step.done ? (
                        <CheckCircle2 className="h-5 w-5 text-[var(--status-ok)] shrink-0" />
                      ) : (
                        <Circle className="h-5 w-5 text-[var(--text-muted)] shrink-0" />
                      )}
                      <span
                        className={`text-sm truncate ${
                          step.done
                            ? 'text-[var(--text-muted)]'
                            : 'font-medium text-[var(--text-primary)]'
                        }`}
                      >
                        {step.label}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                  </button>
                ))}
              </div>
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={dismissOnboarding}
                  className="min-h-[40px] inline-flex items-center gap-1 rounded-xl px-3 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>{t('home.onboardingDismiss')}</span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 4. Needs You Today (Unified Priority List) ── */}
      <section aria-label={t('home.needsYouTitle')} className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
            {t('home.needsYouTitle')}
          </h2>
          {needsYouToday.length > 0 && (
            <span className="tabular-nums-ui text-xs font-semibold text-[var(--text-muted)]">
              {needsYouToday.length}
            </span>
          )}
        </div>

        {needsYouToday.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 text-center space-y-2">
            <div className="mx-auto flex items-center justify-center">
              <LottieBadge
                animationData={allCaughtUpAnim}
                size={56}
                fallback={
                  <div className="h-10 w-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                }
              />
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {t('home.allCaughtUpTitle')}
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
              {t('home.allCaughtUpDesc')}
            </p>
            {nextUpcoming && (
              <button
                type="button"
                onClick={() => {
                  void hapticLight();
                  setActiveRoute(nextUpcoming.source === 'debt_due' ? 'debts' : 'reminders');
                }}
                className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              >
                <Clock className="h-4 w-4 text-[var(--accent)]" />
                <span>
                  {t('home.nextUpLabel')}: {nextUpcoming.title}
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
            {needsYouToday.map((item) => {
              const Icon =
                item.kind === 'debt'
                  ? Scale
                  : item.kind === 'task'
                    ? CheckSquare
                    : item.kind === 'vault'
                      ? FolderLock
                      : Bell;
              const statusLabel =
                item.status === 'overdue'
                  ? t('home.statusOverdue')
                  : item.status === 'expiring'
                    ? t('home.statusExpiring')
                    : t('home.statusDueToday');

              return (
                <div
                  key={item.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--bg-subtle)]/40 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      void hapticLight();
                      setActiveRoute(item.route);
                    }}
                    className="flex items-center gap-3 min-w-0 flex-1 text-start min-h-[44px]"
                  >
                    <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-secondary)] flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {item.title}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="tabular-nums-ui text-[var(--text-secondary)]">
                          {item.context}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            item.status === 'overdue'
                              ? 'text-[var(--status-danger)]'
                              : item.status === 'expiring'
                                ? 'text-[var(--status-warn)]'
                                : 'text-[var(--accent)]'
                          }`}
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{statusLabel}</span>
                        </span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.onSnooze && (
                      <button
                        type="button"
                        onClick={() => void item.onSnooze?.()}
                        className="min-h-[44px] px-2.5 rounded-xl border border-[var(--border-hairline)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                      >
                        {t('home.snooze1h')}
                      </button>
                    )}
                    {item.onComplete && (
                      <button
                        type="button"
                        onClick={() => void item.onComplete?.()}
                        className="min-h-[44px] px-3 rounded-xl bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)] hover:opacity-90 inline-flex items-center gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{t('home.markDone')}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 5. AI Daily Briefing (collapsed by default) ── */}
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] overflow-hidden">
        <button
          type="button"
          onClick={() => {
            if (!briefingOpen && !briefingResult) {
              void handleGenerateBriefing();
            } else {
              void hapticLight();
              setBriefingOpen((prev) => !prev);
            }
          }}
          className="w-full min-h-[56px] px-5 py-3.5 flex items-center justify-between gap-3 text-start hover:bg-[var(--bg-subtle)]/40 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('home.briefingTitle')}
              </h2>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {t('home.briefingTapHint')}
              </p>
            </div>
          </div>
          {briefingOpen ? (
            <ChevronUp className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
          )}
        </button>

        {briefingOpen && (
          <div className="px-5 pb-4 pt-3 border-t border-[var(--border-hairline)] space-y-3">
            {briefingLoading ? (
              <div className="space-y-2">
                <div className="h-3.5 w-3/4 rounded bg-[var(--bg-subtle)] animate-pulse" />
                <div className="h-3.5 w-1/2 rounded bg-[var(--bg-subtle)] animate-pulse" />
              </div>
            ) : briefingResult?.ok ? (
              <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                {briefingResult.data.summary}
              </p>
            ) : briefingResult && !briefingResult.ok ? (
              <p className="text-sm text-[var(--status-warn)]">{briefingResult.error}</p>
            ) : null}

            <button
              type="button"
              disabled={briefingLoading}
              onClick={() => void handleGenerateBriefing()}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>{briefingLoading ? t('home.synthesizing') : t('home.generateBriefing')}</span>
            </button>
          </div>
        )}
      </section>

      {/* ── 6. Modules Grid (2-col mobile / 4-col desktop, real data only) ── */}
      <section aria-label={t('home.modulesTitle')} className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] px-1">
          {t('home.modulesTitle')}
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {moduleTiles.map((tile) => {
            const Icon = tile.icon;
            const ringRadius = 14;
            const ringCirc = 2 * Math.PI * ringRadius;
            const ringOffset =
              tile.realRatio !== null && tile.realRatio !== undefined
                ? ringCirc - Math.min(1, Math.max(0, tile.realRatio)) * ringCirc
                : 0;

            return (
              <button
                key={tile.id}
                type="button"
                onClick={() => {
                  void hapticLight();
                  setActiveRoute(tile.id);
                }}
                className="group p-4 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:border-[var(--accent)]/50 transition-colors text-start btn-spring flex flex-col justify-between min-h-[116px]"
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <div className="h-9 w-9 rounded-xl bg-[var(--bg-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" />
                  </div>

                  {tile.realRatio !== null && tile.realRatio !== undefined && (
                    <svg className="h-8 w-8 -rotate-90 shrink-0" viewBox="0 0 36 36" aria-hidden="true">
                      <circle
                        cx="18"
                        cy="18"
                        r={ringRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        className="text-[var(--bg-subtle)]"
                      />
                      <circle
                        cx="18"
                        cy="18"
                        r={ringRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeDasharray={ringCirc}
                        strokeDashoffset={ringOffset}
                        className="text-[var(--accent)]"
                      />
                    </svg>
                  )}
                </div>

                <div className="mt-3 w-full">
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {tile.name}
                  </div>
                  {tile.primaryValue !== null ? (
                    <div className="mt-0.5 tabular-nums-ui text-lg font-bold text-[var(--text-primary)] truncate">
                      {tile.primaryValue}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-xs text-[var(--text-muted)] truncate">
                    {tile.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BookText,
  CheckSquare,
  Clock,
  Flame,
  FolderLock,
  Layers,
  Plus,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../core/currency/currency';
import { aggregateDebtMetrics } from '../../../core/debts/debtEngine';
import { evaluateDailyAiQuota, getTodayDayKey } from '../../../core/entitlements/entitlements';
import { defaultLLMProvider, type AIResult } from '../../../core/ai/llmProvider';
import { aiUsageRepository } from '../../../data/repositories/firebaseWebAdapter';
import { useDebts } from '../../../hooks/useDebts';
import { useReminders } from '../../../hooks/useReminders';
import { usePlanner } from '../../../hooks/usePlanner';
import { useNotes } from '../../../hooks/useNotes';
import { useVault } from '../../../hooks/useVault';
import { useHabits } from '../../../hooks/useHabits';
import { useFinance } from '../../../hooks/useFinance';
import { useUIStore, type NavRoute } from '../../../state/useUIStore';
import { hapticLight } from '../../../core/native/mobileBridge';

export const HomeView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const authUser = useUIStore((s) => s.authUser);
  const entitlements = useUIStore((s) => s.entitlements);
  const todayAiUsage = useUIStore((s) => s.todayAiUsage);
  const setActiveRoute = useUIStore((s) => s.setActiveRoute);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const incrementLocalAiUsage = useUIStore((s) => s.incrementLocalAiUsage);

  const { debts, fxRates } = useDebts();
  const { summary: remSummary, rollingQueue } = useReminders();
  const { summary: plannerSummary } = usePlanner();
  const { summary: notesSummary } = useNotes();
  const { summary: vaultSummary } = useVault();
  const { summary: habitsSummary } = useHabits();
  const { monthlySummary: financeSummary, subscriptionMetrics } = useFinance();

  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingResult, setBriefingResult] = useState<AIResult | null>(null);
  const [ringsReady, setRingsReady] = useState(false);
  const [touchedCard, setTouchedCard] = useState<string | null>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setRingsReady(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const triggerCardSweep = (cardId: string) => {
    void hapticLight();
    setTouchedCard(cardId);
    window.setTimeout(() => {
      setTouchedCard((curr) => (curr === cardId ? null : curr));
    }, 650);
  };

  const dayKey = getTodayDayKey();
  const usedToday = todayAiUsage.dayKey === dayKey ? todayAiUsage.requestCount : 0;
  const quota = evaluateDailyAiQuota(usedToday, entitlements);
  const quotaPercent = Math.min(100, Math.round((quota.usedToday / Math.max(1, quota.dailyLimit)) * 100));
  const debtMetrics = aggregateDebtMetrics(debts, profile.primaryCurrency, fxRates, dayKey);

  // Composite Life Health Score (0 - 100) synthesizing all modules deterministically
  const lifeScore = useMemo(() => {
    let score = 72; // calm baseline
    // Habits momentum (+14 max)
    if (habitsSummary.activeCount > 0) {
      const habitRatio = habitsSummary.completedTodayCount / habitsSummary.activeCount;
      score += Math.round(habitRatio * 14);
    } else {
      score += 6;
    }
    // Finance positive cashflow (+8)
    if (financeSummary.netPrimaryMinor >= 0) score += 8;
    else score -= 6;
    // Overdue penalties
    score -= Math.min(12, debtMetrics.totalOverdueCount * 4);
    score -= Math.min(10, remSummary.overdueCount * 3);
    // Vault expiry penalty
    score -= Math.min(6, vaultSummary.expiredCount * 3);
    // E2E readiness bonus
    if (profile.e2eConfigured) score += 6;
    return Math.max(15, Math.min(100, score));
  }, [habitsSummary, financeSummary, debtMetrics, remSummary, vaultSummary, profile.e2eConfigured]);

  const ringRadius = 46;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const displayedScore = !ringsReady || touchedCard === 'life_score' ? 0 : lifeScore;
  const ringOffset = ringCircumference - (displayedScore / 100) * ringCircumference;

  const handleGenerateBriefing = async () => {
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

  // Marquee Live Metrics Feed
  const marqueeItems = [
    { label: 'Finances', val: formatMoney(financeSummary.netPrimaryMinor, profile.primaryCurrency, profile.locale), icon: Wallet, color: 'text-emerald-500' },
    { label: 'Habits Today', val: `${habitsSummary.completedTodayCount}/${habitsSummary.activeCount} Done`, icon: Flame, color: 'text-amber-500' },
    { label: 'Tasks Due', val: `${plannerSummary.dueTodayCount} Today`, icon: CheckSquare, color: 'text-blue-500' },
    { label: 'Reminders', val: `${remSummary.dueTodayCount} Active`, icon: Bell, color: 'text-indigo-500' },
    { label: 'Debts Net', val: formatMoney(debtMetrics.equivalentNetPrimaryMinor, profile.primaryCurrency, profile.locale), icon: Scale, color: 'text-teal-500' },
    { label: 'Vault', val: `${vaultSummary.totalDocs} Docs`, icon: FolderLock, color: 'text-purple-500' },
    { label: 'Subscriptions', val: `${subscriptionMetrics.activeCount} Active`, icon: Clock, color: 'text-rose-500' },
    { label: 'Life Score', val: `${lifeScore}/100`, icon: TrendingUp, color: 'text-emerald-400' },
  ];

  const habitsPct = habitsSummary.activeCount > 0
    ? Math.round((habitsSummary.completedTodayCount / habitsSummary.activeCount) * 100)
    : 0;

  const dashboardModules = [
    {
      id: 'finance' as NavRoute,
      name: t('nav.finance'),
      metric: formatMoney(financeSummary.netPrimaryMinor, profile.primaryCurrency, profile.locale),
      sub: `${financeSummary.transactionCount} transactions this month`,
      icon: Wallet,
      tag: 'Cashflow',
      progress: financeSummary.netPrimaryMinor >= 0 ? 85 : 35,
      barColor: 'bg-emerald-500',
      color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    {
      id: 'habits' as NavRoute,
      name: t('nav.habits'),
      metric: `${habitsSummary.completedTodayCount} of ${habitsSummary.activeCount}`,
      sub: habitsSummary.bestActiveStreak > 0 ? `${habitsSummary.bestActiveStreak}-day streak active` : 'Build your daily streak',
      icon: Flame,
      tag: 'Streaks',
      progress: habitsPct,
      barColor: 'bg-amber-500',
      color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
    {
      id: 'planner' as NavRoute,
      name: t('nav.planner'),
      metric: `${plannerSummary.dueTodayCount} Due Today`,
      sub: `${plannerSummary.activeCount} total open tasks`,
      icon: CheckSquare,
      tag: 'Priorities',
      progress: plannerSummary.activeCount > 0 ? Math.max(15, 100 - plannerSummary.dueTodayCount * 15) : 100,
      barColor: 'bg-blue-500',
      color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    },
    {
      id: 'reminders' as NavRoute,
      name: t('nav.reminders'),
      metric: `${remSummary.dueTodayCount} Scheduled`,
      sub: `${remSummary.overdueCount} overdue · ${rollingQueue.slots.length}/64 queue`,
      icon: Bell,
      tag: 'Alerts',
      progress: Math.min(100, Math.round((rollingQueue.slots.length / 64) * 100) + 20),
      barColor: 'bg-indigo-500',
      color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    },
    {
      id: 'debts' as NavRoute,
      name: t('nav.debts'),
      metric: formatMoney(debtMetrics.equivalentNetPrimaryMinor, profile.primaryCurrency, profile.locale),
      sub: `${debtMetrics.totalOpenCount} open obligations`,
      icon: Scale,
      tag: 'Ledger',
      progress: debtMetrics.totalOverdueCount === 0 ? 90 : 45,
      barColor: 'bg-teal-500',
      color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
    },
    {
      id: 'notes' as NavRoute,
      name: t('nav.notes'),
      metric: `${notesSummary.totalNotes} Notes`,
      sub: `${notesSummary.lockedCount} E2E locked · ${notesSummary.pinnedCount} pinned`,
      icon: BookText,
      tag: 'Knowledge',
      progress: Math.min(100, notesSummary.totalNotes * 12 + 25),
      barColor: 'bg-cyan-500',
      color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    },
    {
      id: 'vault' as NavRoute,
      name: t('nav.vault'),
      metric: `${vaultSummary.totalDocs} Documents`,
      sub: `${vaultSummary.expiredCount + vaultSummary.expiring90Count} expiring soon · Local-only`,
      icon: FolderLock,
      tag: 'Private Vault',
      progress: vaultSummary.expiredCount === 0 ? 95 : 50,
      barColor: 'bg-purple-500',
      color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-7 perspective-stage">
      {/* ── 1. 3D Glassmorphic Hero Command Card ── */}
      <section className="relative overflow-hidden rounded-3xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6 sm:p-8 shadow-sm">
        {/* Ambient Animated Glow Orbs */}
        <div className="pointer-events-none absolute -top-24 -end-20 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl anim-float-slow" />
        <div className="pointer-events-none absolute -bottom-24 -start-20 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl anim-float-slow" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-3 max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-canvas)]/80 backdrop-blur-sm px-3 py-1 text-xs font-medium text-[var(--text-muted)]">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{authUser ? 'Cloud Sync Active' : 'Offline Local Workspace'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-numeric">{dayKey}</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)]">
              {t('home.greeting')}, {authUser?.displayName || profile.displayName || 'Friend'}
            </h1>

            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Your private command center for finances, habits, tasks, and encrypted records.
            </p>

            {/* Quick Capture Action Bar */}
            <div className="pt-2 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[var(--accent-hover)] btn-spring shadow-sm"
              >
                <Sparkles className="h-4 w-4" />
                <span>Quick Action</span>
                <kbd className="hidden sm:inline font-numeric text-[11px] opacity-85 ms-1 bg-black/15 px-1.5 py-0.5 rounded">⌘K</kbd>
              </button>

              <button
                type="button"
                onClick={() => setActiveRoute('finance')}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] btn-spring"
              >
                <Plus className="h-3.5 w-3.5 text-emerald-500" />
                <span>Expense</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveRoute('habits')}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] btn-spring"
              >
                <Flame className="h-3.5 w-3.5 text-amber-500" />
                <span>Check-in</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveRoute('vault')}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] btn-spring"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-purple-500" />
                <span>Vault</span>
              </button>
            </div>
          </div>

          {/* 3D Animated Life Health Score Widget */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => triggerCardSweep('life_score')}
            onTouchStart={() => triggerCardSweep('life_score')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') triggerCardSweep('life_score'); }}
            className="card-3d shrink-0 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)]/90 backdrop-blur-md p-5 flex items-center gap-5 self-start lg:self-auto cursor-pointer select-none"
          >
            <div className="relative h-28 w-28 flex items-center justify-center shrink-0">
              <svg className="h-28 w-28 -rotate-90 drop-shadow-sm" viewBox="0 0 112 112">
                <circle
                  cx="56"
                  cy="56"
                  r={ringRadius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="9"
                  className="text-[var(--bg-subtle)]"
                />
                <circle
                  cx="56"
                  cy="56"
                  r={ringRadius}
                  fill="none"
                  stroke="url(#lifeScoreGrad)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  className="transition-all duration-1000 ease-out"
                />
                <defs>
                  <linearGradient id="lifeScoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#14B8A6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-numeric text-2xl font-bold text-[var(--text-primary)]">
                  {lifeScore}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Score
                </span>
              </div>
            </div>

            <div className="space-y-1.5 min-w-[140px]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                Life Health
              </div>
              <div className="text-sm font-bold text-[var(--text-primary)]">
                {lifeScore >= 85 ? 'Optimal Balance' : lifeScore >= 65 ? 'Steady Momentum' : 'Needs Focus'}
              </div>
              <div className="text-xs text-[var(--text-muted)] space-y-0.5 font-numeric">
                <div>{habitsSummary.completedTodayCount}/{habitsSummary.activeCount} habits done</div>
                <div>{plannerSummary.dueTodayCount} tasks due today</div>
                <div>{profile.e2eConfigured ? 'E2E Shield On' : 'Local Storage'}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Live Infinite Metric Marquee Ticker ── */}
      <section
        aria-label="Live workspace pulse"
        className="relative overflow-hidden rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] py-3 select-none"
      >
        <div className="pointer-events-none absolute inset-y-0 start-0 w-12 bg-gradient-to-r from-[var(--bg-surface)] to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 end-0 w-12 bg-gradient-to-l from-[var(--bg-surface)] to-transparent z-10" />

        <div className="anim-marquee flex items-center gap-8">
          {[...marqueeItems, ...marqueeItems].map((item, idx) => {
            const Icon = item.icon;
            return (
              <div key={idx} className="flex items-center gap-2 shrink-0">
                <div className={`p-1.5 rounded-lg bg-[var(--bg-subtle)] ${item.color}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs text-[var(--text-muted)] font-medium">{item.label}:</span>
                <span className="font-numeric text-xs font-semibold text-[var(--text-primary)]">{item.val}</span>
                <span className="text-[var(--border-hairline)] ms-4 font-bold">/</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 2b. Calm "Up Next" Strip (next 3 upcoming reminders/debts) ── */}
      {rollingQueue.slots.length > 0 && (
        <section
          aria-label="Up next"
          className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Up Next
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                void hapticLight();
                setActiveRoute('reminders');
              }}
              className="text-xs font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
            >
              <span>View all</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {rollingQueue.slots.slice(0, 3).map((slot) => {
              const d = new Date(slot.scheduledFireAtIso);
              const timeStr = Number.isNaN(d.getTime())
                ? ''
                : new Intl.DateTimeFormat(profile.locale === 'en' ? 'en-US' : profile.locale, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(d);
              return (
                <button
                  key={`${slot.reminderId}_${slot.slotIndex}`}
                  type="button"
                  onClick={() => {
                    void hapticLight();
                    setActiveRoute(slot.source === 'debt_due' ? 'debts' : 'reminders');
                  }}
                  className="text-start rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3.5 py-2.5 hover:bg-[var(--bg-subtle)] transition-colors btn-spring flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {slot.title}
                    </div>
                    <div className="mt-0.5 font-numeric text-[11px] text-[var(--text-muted)] truncate">
                      {timeStr} · {slot.category}
                    </div>
                  </div>
                  <Bell className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 3. 3D-Perspective Interactive Dashboard Grid ── */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--accent)]" />
            <span>Workspace Modules</span>
          </h2>
          <span className="text-xs text-[var(--text-muted)]">Click any card to open</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 anim-stagger">
          {dashboardModules.map((m) => {
            const Icon = m.icon;
            const miniRadius = 18;
            const miniCirc = 2 * Math.PI * miniRadius;
            const pct = !ringsReady || touchedCard === m.id ? 0 : m.progress;
            const miniOffset = miniCirc - (pct / 100) * miniCirc;
            const ringColor = m.barColor.replace('bg-', 'text-');

            return (
              <button
                key={m.id}
                type="button"
                onTouchStart={() => triggerCardSweep(m.id)}
                onMouseEnter={() => triggerCardSweep(m.id)}
                onClick={() => setActiveRoute(m.id)}
                className="group p-5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:border-[var(--accent)]/50 transition-all text-start btn-spring card-3d flex flex-col justify-between min-h-[154px]"
              >
                <div className="flex items-start justify-between gap-2 w-full">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${m.color}`}>
                    <Icon className="h-3 w-3" />
                    <span>{m.tag}</span>
                  </span>

                  {/* Animated Circular Progress Ring */}
                  <div className="relative h-11 w-11 flex items-center justify-center shrink-0">
                    <svg className="h-11 w-11 -rotate-90" viewBox="0 0 44 44">
                      <circle
                        cx="22"
                        cy="22"
                        r={miniRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        className="text-[var(--bg-subtle)]"
                      />
                      <circle
                        cx="22"
                        cy="22"
                        r={miniRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={miniCirc}
                        strokeDashoffset={miniOffset}
                        className={`${ringColor} transition-all duration-700 ease-out`}
                      />
                    </svg>
                    <span className="absolute font-numeric text-[10px] font-bold text-[var(--text-primary)]">
                      {m.progress}%
                    </span>
                  </div>
                </div>

                <div className="mt-2 w-full">
                  <div className="text-xs text-[var(--text-muted)] font-medium">{m.name}</div>
                  <div className="font-numeric text-lg sm:text-xl font-bold text-[var(--text-primary)] mt-0.5 truncate">
                    {m.metric}
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 w-full">
                  <span className="text-xs text-[var(--text-muted)] truncate">{m.sub}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)] group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            );
          })}

          {/* AI Assistant Quota Card with Animated Circle */}
          {(() => {
            const miniRadius = 18;
            const miniCirc = 2 * Math.PI * miniRadius;
            const pct = !ringsReady || touchedCard === 'ai_quota' ? 0 : quotaPercent;
            const miniOffset = miniCirc - (pct / 100) * miniCirc;
            return (
              <button
                type="button"
                onTouchStart={() => triggerCardSweep('ai_quota')}
                onMouseEnter={() => triggerCardSweep('ai_quota')}
                onClick={() => setCommandPaletteOpen(true)}
                className="group p-5 rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:border-[var(--accent)]/50 transition-all text-start btn-spring card-3d flex flex-col justify-between min-h-[154px]"
              >
                <div className="flex items-start justify-between gap-2 w-full">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    <Sparkles className="h-3 w-3" />
                    <span>Assistant</span>
                  </span>

                  <div className="relative h-11 w-11 flex items-center justify-center shrink-0">
                    <svg className="h-11 w-11 -rotate-90" viewBox="0 0 44 44">
                      <circle
                        cx="22"
                        cy="22"
                        r={miniRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        className="text-[var(--bg-subtle)]"
                      />
                      <circle
                        cx="22"
                        cy="22"
                        r={miniRadius}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={miniCirc}
                        strokeDashoffset={miniOffset}
                        className="text-emerald-500 transition-all duration-700 ease-out"
                      />
                    </svg>
                    <span className="absolute font-numeric text-[10px] font-bold text-[var(--text-primary)]">
                      {quotaPercent}%
                    </span>
                  </div>
                </div>

                <div className="mt-2 w-full">
                  <div className="text-xs text-[var(--text-muted)] font-medium">Daily AI Quota</div>
                  <div className="font-numeric text-lg sm:text-xl font-bold text-[var(--text-primary)] mt-0.5">
                    {quota.usedToday} / {quota.dailyLimit}
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2 w-full">
                  <span className="text-xs text-[var(--text-muted)] truncate">Privacy Gate active · Tap to ask</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent)] group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            );
          })()}
        </div>
      </section>

      {/* ── 4. Daily AI Briefing Section ── */}
      <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {t('home.briefingTitle')}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Instant snapshot of what needs attention today
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={briefingLoading}
            onClick={() => void handleGenerateBriefing()}
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] btn-spring disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>{briefingLoading ? 'Synthesizing...' : 'Generate Briefing'}</span>
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--border-hairline)]">
          {!briefingResult ? (
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {debtMetrics.totalOverdueCount > 0 || remSummary.overdueCount > 0 || plannerSummary.dueTodayCount > 0
                ? `You have ${plannerSummary.dueTodayCount} tasks due today, ${remSummary.dueTodayCount} reminders, and ${debtMetrics.totalOpenCount} open debt items. Click "Generate Briefing" for a customized summary.`
                : 'All clear! No overdue items or urgent commitments. Click "Generate Briefing" anytime to get a quick summary of your day.'}
            </p>
          ) : briefingResult.ok ? (
            <div className="space-y-2">
              <p className="text-sm leading-relaxed text-[var(--text-primary)] font-medium">
                {briefingResult.data.summary}
              </p>
              <div className="flex items-center gap-2 text-[11px] font-numeric text-[var(--text-muted)]">
                <span>{briefingResult.meta.cached ? 'Instant Cache' : `${briefingResult.meta.latencyMs}ms`}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">{briefingResult.error}</p>
          )}
        </div>
      </section>
    </div>
  );
};

import React from 'react';
import { ShieldCheck, Sparkles, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore, type NavRoute } from '../../../state/useUIStore';

interface ModuleDetailInfo {
  phase: number;
  firestorePath: string;
  deterministicCore: string;
  aiCapabilities: string;
  privacyRule: string;
}

const MODULE_INFO: Record<Exclude<NavRoute, 'home' | 'settings'>, ModuleDetailInfo> = {
  debts: {
    phase: 2,
    firestorePath: 'users/{uid}/debts + debtLedgers + payments',
    deterministicCore:
      'Integer minor-unit IQD/USD/EUR balances, partial-payment transactions, installment schedules, Beta-smoothed repayment probability, and payoff timeline planning.',
    aiCapabilities:
      'Natural-language debt parsing, polite EN/AR/KU reminder drafts, and human explanations of deterministic risk scores.',
    privacyRule: 'Minimal text only; never sends raw contract/receipt images while free_tier=true.',
  },
  reminders: {
    phase: 3,
    firestorePath: 'users/{uid}/reminders',
    deterministicCore:
      'RRULE recurrence expansion, 8 category channels, quiet hours enforcement, and unit-tested Rolling 64-Notification Scheduler.',
    aiCapabilities:
      'Natural-language recurrence parsing, auto-category selection, and overload rebalancing suggestions.',
    privacyRule: 'Only reminder titles/schedule windows sent on explicit user action.',
  },
  planner: {
    phase: 4,
    firestorePath: 'users/{uid}/tasks + taskLists',
    deterministicCore:
      'Single-write fractional-index ordering (LexoRank), subtasks, Today/Upcoming/Completed views, unified calendar.',
    aiCapabilities:
      'Break big goals into subtasks, prioritize day/week, and draft weekly productivity summaries.',
    privacyRule: 'Requires explicit confirmation preview before creating or modifying tasks.',
  },
  notes: {
    phase: 4,
    firestorePath: 'users/{uid}/notes + noteFolders',
    deterministicCore:
      'Rich Markdown editor, nested folders, version snapshots, cross-module links, and opt-in AES-256-GCM locked notes.',
    aiCapabilities:
      'Summarize, rewrite, translate (EN/AR/KU), extract tasks, and auto-tag unlocked notes.',
    privacyRule: 'Locked or E2E encrypted notes are strictly blocked from cloud AI by the Privacy Gate.',
  },
  vault: {
    phase: 5,
    firestorePath: 'Local-Only IndexedDB Vault + users/{uid}/documents',
    deterministicCore:
      'Zero-billing Local-Only storage adapter (Spark free tier), nested folders, expiry alerts, and opt-in AES-256-GCM encryption.',
    aiCapabilities:
      'On-device OCR & local search on free tier. Cloud Document AI unlocks only after upgrading to a paid zero-retention provider.',
    privacyRule: 'Hard Privacy Gate blocks all scanned document images and passport/ID payloads while free_tier=true.',
  },
  habits: {
    phase: 6,
    firestorePath: 'users/{uid}/habits + habitLogs/{yyyy_mm}',
    deterministicCore:
      'Monthly-bucketed completion logs (12 docs/year total), deterministic streak engine, and heatmaps.',
    aiCapabilities: 'Streak break analysis and adaptive reminder time suggestions.',
    privacyRule: 'Only aggregated streak stats sent when AI is enabled for Habits.',
  },
  finance: {
    phase: 6,
    firestorePath: 'users/{uid}/transactions + budgets + subscriptions',
    deterministicCore:
      'Integer minor-unit ledger, category budgets, recurring subscription tracker, CSV import/export, deterministic cash-flow forecast.',
    aiCapabilities: 'Spending pattern summaries and subscription waste detection.',
    privacyRule: 'Deterministic math runs on-device; AI receives aggregated category totals only.',
  },
  qr: {
    phase: 7,
    firestorePath: 'localStorage (lifeos_qr_link_profile_v1)',
    deterministicCore:
      'On-device QR code generator and Linktree-style scannable link profile.',
    aiCapabilities: 'Optional link organization.',
    privacyRule: 'Generated locally on-device with no external tracking.',
  },
};

export const ModuleReadinessView: React.FC<{ route: Exclude<NavRoute, 'home' | 'settings'> }> = ({
  route,
}) => {
  const { t } = useTranslation();
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setActiveRoute = useUIStore((s) => s.setActiveRoute);
  const info = MODULE_INFO[route];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <p className="font-numeric text-xs text-[var(--text-muted)]">
          Phase {info.phase} Deliverable · {info.firestorePath}
        </p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          {t(`nav.${route}`)}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Security rules, tenant isolation, and repository contracts for this module are live from Phase 1. The full interactive UI and domain engine ship next in Phase {info.phase}.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
        <div className="p-5">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            Deterministic On-Device Core
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{info.deterministicCore}</p>
        </div>
        <div className="p-5">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            Embedded AI Layer
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{info.aiCapabilities}</p>
        </div>
        <div className="p-5">
          <div className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
            <span>Active Privacy Boundary</span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{info.privacyRule}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          <span>Test AI Pipeline &amp; Privacy Gate</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveRoute('settings')}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
        >
          <Settings className="h-4 w-4 text-[var(--text-muted)]" />
          <span>Configure Module Security</span>
        </button>
      </div>
    </div>
  );
};

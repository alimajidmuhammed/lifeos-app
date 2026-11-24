import { formatMoney, type CurrencyCode, type FxRatesToIqd, type SupportedLocale } from '../currency/currency';
import { aggregateDebtMetrics } from '../debts/debtEngine';
import type { DebtRecord } from '../debts/debtSchemas';
import {
  computeMonthlyFinanceSummary,
  computeSubscriptionMetrics,
} from '../finance/financeEngine';
import type { BudgetLimit, SubscriptionItem, TransactionItem } from '../finance/financeSchemas';
import {
  collectHabitCompletedDays,
  computeHabitsOverview,
  computeHabitStreakStats,
} from '../habits/habitEngine';
import type { HabitItem, HabitMonthLog } from '../habits/habitSchemas';
import type { NoteItem } from '../notes/noteSchemas';
import type { TaskItem } from '../planner/plannerSchemas';
import type { ReminderItem } from '../reminders/reminderSchemas';
import { evaluateDocumentExpiry } from '../vault/expiryEngine';
import type { VaultDocumentMeta } from '../vault/vaultSchemas';

export type SearchModuleId =
  | 'debts'
  | 'reminders'
  | 'planner'
  | 'notes'
  | 'vault'
  | 'habits'
  | 'finance';

export interface WorkspaceSearchHit {
  id: string;
  module: SearchModuleId;
  title: string;
  subtitle: string;
  score: number;
  isPrivacyRedacted?: boolean;
}

export interface WorkspaceSnapshot {
  debts: DebtRecord[];
  reminders: ReminderItem[];
  tasks: TaskItem[];
  notes: NoteItem[];
  vaultDocs: VaultDocumentMeta[];
  habits: HabitItem[];
  habitLogs: HabitMonthLog[];
  transactions: TransactionItem[];
  budgets: BudgetLimit[];
  subscriptions: SubscriptionItem[];
  primaryCurrency: CurrencyCode;
  locale: SupportedLocale;
  fxRates: FxRatesToIqd;
  todayYmd: string;
}

function scoreMatch(queryLower: string, primaryText: string, secondaryText = ''): number {
  const p = primaryText.toLowerCase();
  const s = secondaryText.toLowerCase();
  if (p === queryLower) return 100;
  if (p.startsWith(queryLower)) return 85;
  if (p.includes(queryLower)) return 70;
  const tokens = queryLower.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((tk) => p.includes(tk) || s.includes(tk))) {
    return 60;
  }
  if (s.includes(queryLower)) return 45;
  return 0;
}

/**
 * Deterministic cross-module offline search across all 7 LifeOS modules.
 * Strict Privacy Rule:
 * - Never searches or returns decrypted/raw content of E2E locked notes.
 * - Never exposes sensitive Vault OCR or binary text when `forCloudAiTool === true` (free tier).
 */
export function searchWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  query: string,
  options?: {
    moduleFilter?: SearchModuleId | 'all';
    forCloudAiTool?: boolean;
    limit?: number;
  }
): WorkspaceSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const filter = options?.moduleFilter ?? 'all';
  const forAi = Boolean(options?.forCloudAiTool);
  const limit = options?.limit ?? 15;
  const hits: WorkspaceSearchHit[] = [];

  if (filter === 'all' || filter === 'debts') {
    for (const d of snapshot.debts) {
      const score = scoreMatch(q, d.personName, `${d.category} ${d.status} ${d.notes ?? ''}`);
      if (score > 0) {
        hits.push({
          id: d.id,
          module: 'debts',
          title: `${d.personName} (${d.direction === 'i_owe' ? 'I owe' : 'Owed to me'})`,
          subtitle: `${formatMoney(d.remainingMinor, d.currency, snapshot.locale)} · ${d.status}${d.dueDate ? ` · Due ${d.dueDate}` : ''}`,
          score,
        });
      }
    }
  }

  if (filter === 'all' || filter === 'reminders') {
    for (const r of snapshot.reminders) {
      const score = scoreMatch(q, r.title, `${r.category} ${r.notes ?? ''}`);
      if (score > 0) {
        hits.push({
          id: r.id,
          module: 'reminders',
          title: r.title,
          subtitle: `${r.category} · ${r.status} · ${r.dueAtIso.slice(0, 10)}`,
          score,
        });
      }
    }
  }

  if (filter === 'all' || filter === 'planner') {
    for (const tk of snapshot.tasks) {
      const score = scoreMatch(q, tk.title, `${tk.listId} ${tk.notes ?? ''} ${(tk.tags ?? []).join(' ')}`);
      if (score > 0) {
        hits.push({
          id: tk.id,
          module: 'planner',
          title: tk.title,
          subtitle: `${tk.listId} · ${tk.status}${tk.dueDate ? ` · Due ${tk.dueDate}` : ''}`,
          score,
        });
      }
    }
  }

  if (filter === 'all' || filter === 'notes') {
    for (const n of snapshot.notes) {
      // Never search encrypted ciphertext or expose locked note content to AI tools
      const searchableBody = n.isEncrypted || n.isLocked ? '' : `${n.content.slice(0, 400)} ${(n.tags ?? []).join(' ')}`;
      if (forAi && (n.isEncrypted || n.isLocked)) continue;
      const score = scoreMatch(q, n.title, searchableBody);
      if (score > 0) {
        hits.push({
          id: n.id,
          module: 'notes',
          title: n.title,
          subtitle: n.isEncrypted
            ? 'E2E Locked Note · On-device encrypted'
            : `${n.wordCount} words${n.pinned ? ' · Pinned' : ''}`,
          score,
          isPrivacyRedacted: n.isEncrypted || n.isLocked,
        });
      }
    }
  }

  // Vault: allow local on-device search, NEVER transmit vault documents/OCR to free-tier cloud AI tools
  if ((filter === 'all' || filter === 'vault') && !forAi) {
    for (const doc of snapshot.vaultDocs) {
      const searchable = doc.isEncrypted
        ? `${doc.docType} ${doc.issuer ?? ''}`
        : `${doc.docType} ${doc.issuer ?? ''} ${doc.ocrText ?? ''} ${doc.notes ?? ''}`;
      const score = scoreMatch(q, doc.title, searchable);
      if (score > 0) {
        const exp = evaluateDocumentExpiry(doc.expiryDate, snapshot.todayYmd);
        hits.push({
          id: doc.id,
          module: 'vault',
          title: doc.title,
          subtitle: `${doc.docType}${exp.status !== 'no_expiry' ? ` · ${exp.label}` : ''}${doc.isEncrypted ? ' · E2E Encrypted' : ''}`,
          score,
          isPrivacyRedacted: doc.isEncrypted,
        });
      }
    }
  }

  if (filter === 'all' || filter === 'habits') {
    for (const h of snapshot.habits) {
      if (h.archived) continue;
      const score = scoreMatch(q, h.name, `${h.category} ${h.frequency}`);
      if (score > 0) {
        const days = collectHabitCompletedDays(h.id, snapshot.habitLogs);
        const stats = computeHabitStreakStats(h, days, snapshot.todayYmd);
        hits.push({
          id: h.id,
          module: 'habits',
          title: h.name,
          subtitle: `${h.category} · Streak ${stats.currentStreak} · 30d ${stats.consistency30dPct}%`,
          score,
        });
      }
    }
  }

  if (filter === 'all' || filter === 'finance') {
    for (const tx of snapshot.transactions) {
      const score = scoreMatch(
        q,
        tx.merchant || tx.category,
        `${tx.type} ${tx.category} ${tx.account} ${tx.note ?? ''} ${tx.occurredOn}`
      );
      if (score > 0) {
        hits.push({
          id: tx.id,
          module: 'finance',
          title: tx.merchant ? `${tx.merchant} (${tx.category})` : tx.category,
          subtitle: `${tx.type === 'income' ? '+' : '-'}${formatMoney(tx.amountMinor, tx.currency, snapshot.locale)} · ${tx.occurredOn}`,
          score,
        });
      }
    }

    for (const sub of snapshot.subscriptions) {
      const score = scoreMatch(q, sub.name, `${sub.category} ${sub.cadence} ${sub.status}`);
      if (score > 0) {
        hits.push({
          id: sub.id,
          module: 'finance',
          title: `${sub.name} (Subscription)`,
          subtitle: `${formatMoney(sub.amountMinor, sub.currency, snapshot.locale)}/${sub.cadence} · Next ${sub.nextBillingDate}`,
          score,
        });
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Deterministic read-only tool executor invoked locally when Gemini Function Calling
 * requests workspace summaries (keeps raw records, locked notes, and Vault scans off cloud AI).
 */
export function executeWorkspaceAiTool(
  toolName: string,
  args: Record<string, unknown>,
  snapshot: WorkspaceSnapshot
): Record<string, unknown> {
  const monthKey = snapshot.todayYmd.slice(0, 7);

  if (toolName === 'search_workspace') {
    const query = String(args.query ?? '').trim();
    const moduleFilter = (String(args.moduleFilter ?? 'all') as SearchModuleId | 'all');
    const hits = searchWorkspaceSnapshot(snapshot, query, {
      moduleFilter,
      forCloudAiTool: true,
      limit: 8,
    });
    return {
      query,
      resultCount: hits.length,
      privacyNote: 'Locked notes and Document Vault files are automatically excluded on free tier.',
      matches: hits.map((h) => ({ module: h.module, title: h.title, summary: h.subtitle })),
    };
  }

  if (toolName === 'get_financial_snapshot') {
    const fin = computeMonthlyFinanceSummary(
      snapshot.transactions,
      monthKey,
      snapshot.primaryCurrency,
      snapshot.fxRates
    );
    const subs = computeSubscriptionMetrics(
      snapshot.subscriptions,
      snapshot.primaryCurrency,
      snapshot.fxRates,
      snapshot.todayYmd
    );
    const debtMetrics = aggregateDebtMetrics(
      snapshot.debts,
      snapshot.primaryCurrency,
      snapshot.fxRates,
      snapshot.todayYmd
    );
    return {
      monthKey,
      primaryCurrency: snapshot.primaryCurrency,
      monthlyIncome: formatMoney(fin.incomePrimaryMinor, snapshot.primaryCurrency, snapshot.locale),
      monthlyExpense: formatMoney(fin.expensePrimaryMinor, snapshot.primaryCurrency, snapshot.locale),
      monthlyNet: formatMoney(fin.netPrimaryMinor, snapshot.primaryCurrency, snapshot.locale),
      savingsRatePct: fin.savingsRatePct,
      topExpenseCategories: fin.expenseBreakdown.slice(0, 4).map((c) => ({
        category: c.category,
        amount: formatMoney(c.totalPrimaryMinor, snapshot.primaryCurrency, snapshot.locale),
        sharePct: c.sharePct,
      })),
      activeSubscriptions: subs.activeCount,
      monthlySubscriptionBurn: formatMoney(subs.monthlyBurnPrimaryMinor, snapshot.primaryCurrency, snapshot.locale),
      openDebtsCount: debtMetrics.totalOpenCount,
      overdueDebtsCount: debtMetrics.totalOverdueCount,
      netDebtPosition: formatMoney(debtMetrics.equivalentNetPrimaryMinor, snapshot.primaryCurrency, snapshot.locale),
    };
  }

  if (toolName === 'get_habit_consistency') {
    const overview = computeHabitsOverview(snapshot.habits, snapshot.habitLogs, snapshot.todayYmd);
    const activeHabits = snapshot.habits
      .filter((h) => !h.archived)
      .slice(0, 10)
      .map((h) => {
        const stats = computeHabitStreakStats(
          h,
          collectHabitCompletedDays(h.id, snapshot.habitLogs),
          snapshot.todayYmd
        );
        return {
          name: h.name,
          category: h.category,
          completedToday: stats.completedToday,
          currentStreak: stats.currentStreak,
          consistency30dPct: stats.consistency30dPct,
        };
      });
    return {
      overview,
      habits: activeHabits,
    };
  }

  if (toolName === 'get_upcoming_commitments') {
    const activeReminders = snapshot.reminders
      .filter((r) => r.status === 'scheduled' || r.status === 'snoozed')
      .slice(0, 6)
      .map((r) => ({ title: r.title, category: r.category, dueDate: r.dueAtIso.slice(0, 10) }));
    const openTasks = snapshot.tasks
      .filter((t) => t.status !== 'done')
      .slice(0, 6)
      .map((t) => ({ title: t.title, listId: t.listId, dueDate: t.dueDate ?? null }));
    return {
      todayYmd: snapshot.todayYmd,
      activeRemindersCount: activeReminders.length,
      upcomingReminders: activeReminders,
      openTasksCount: openTasks.length,
      openTasks,
    };
  }

  return { error: `Unknown tool "${toolName}"` };
}

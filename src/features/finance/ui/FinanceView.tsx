import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Download,
  PieChart,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseFinanceSentence } from '../../../core/ai/globalAssistantClient';
import {
  convertMinorUnits,
  DEFAULT_FX_RATES_TO_IQD,
  formatMoney,
  toMinorUnits,
  type CurrencyCode,
} from '../../../core/currency/currency';
import {
  buildSubscriptionReminderInput,
  exportTransactionsToCsv,
  parseTransactionsCsv,
} from '../../../core/finance/financeEngine';
import {
  ALL_TRANSACTION_CATEGORIES,
  EXPENSE_CATEGORIES,
  FINANCE_ACCOUNTS,
  FINANCE_ACCOUNT_LABELS,
  INCOME_CATEGORIES,
  TRANSACTION_CATEGORY_LABELS,
  type ExpenseCategory,
  type FinanceAccount,
  type SubscriptionCadence,
  type SubscriptionItem,
  type TransactionCategory,
} from '../../../core/finance/financeSchemas';
import { useFinance } from '../../../hooks/useFinance';
import { useReminders } from '../../../hooks/useReminders';
import { useUIStore } from '../../../state/useUIStore';

type FinanceTab = 'ledger' | 'budgets' | 'subscriptions';
type TransactionType = 'income' | 'expense';

const CATEGORY_LABELS = TRANSACTION_CATEGORY_LABELS;
const ACCOUNT_LABELS = FINANCE_ACCOUNT_LABELS;

export const FinanceView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const showToast = useUIStore((s) => s.showToast);

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState<FinanceTab>('ledger');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const {
    transactions,
    budgets,
    subscriptions,
    loading,
    error,
    todayYmd,
    activeMonthKey,
    monthlySummary,
    budgetEvaluations,
    subscriptionMetrics,
    createTransaction,
    deleteTransaction,
    restoreTransaction,
    upsertBudget,
    deleteBudget,
    createSubscription,
    updateSubscriptionState,
    deleteSubscription,
    restoreSubscription,
  } = useFinance(selectedMonth);

  const { createReminder } = useReminders();

  // Add Transaction Modal + AI Quick Entry
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<TransactionType>('expense');
  const [txAmount, setTxAmount] = useState('');
  const [txCurrency, setTxCurrency] = useState<CurrencyCode>(profile.primaryCurrency);
  const [txCategory, setTxCategory] = useState<TransactionCategory>('food');
  const [txDate, setTxDate] = useState(todayYmd);
  const [txAccount, setTxAccount] = useState<FinanceAccount>('cash');
  const [txMerchant, setTxMerchant] = useState('');
  const [txNote, setTxNote] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraftNotice, setAiDraftNotice] = useState(false);
  const [saving, setSaving] = useState(false);

  // Budget Modal
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState<ExpenseCategory>('food');
  const [budgetLimitMajor, setBudgetLimitMajor] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState<CurrencyCode>(profile.primaryCurrency);
  const [budgetAlertPct, setBudgetAlertPct] = useState(80);

  // Subscription Modal
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [subName, setSubName] = useState('');
  const [subAmountMajor, setSubAmountMajor] = useState('');
  const [subCurrency, setSubCurrency] = useState<CurrencyCode>(profile.primaryCurrency);
  const [subCadence, setSubCadence] = useState<SubscriptionCadence>('monthly');
  const [subCategory, setSubCategory] = useState<ExpenseCategory>('subscriptions');
  const [subNextDate, setSubNextDate] = useState(todayYmd);
  const [subNote, setSubNote] = useState('');

  // CSV Import Modal
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importingCsv, setImportingCsv] = useState(false);

  const csvPreview = useMemo(() => {
    if (!csvText.trim()) return null;
    return parseTransactionsCsv(csvText, profile.primaryCurrency);
  }, [csvText, profile.primaryCurrency]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions
      .filter((tx) => tx.occurredOn.startsWith(activeMonthKey))
      .filter((tx) => (typeFilter === 'all' ? true : tx.type === typeFilter))
      .filter((tx) => (categoryFilter === 'all' ? true : tx.category === categoryFilter))
      .filter((tx) => {
        if (!q) return true;
        return (
          (tx.merchant ?? '').toLowerCase().includes(q) ||
          (tx.note ?? '').toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          tx.account.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
  }, [transactions, activeMonthKey, typeFilter, categoryFilter, searchQuery]);

  const secondaryNetMinor = convertMinorUnits(
    monthlySummary.netPrimaryMinor,
    profile.primaryCurrency,
    profile.secondaryCurrency,
    DEFAULT_FX_RATES_TO_IQD
  );

  const openTxModal = (focusAi = false) => {
    setTxType('expense');
    setTxAmount('');
    setTxCurrency(profile.primaryCurrency);
    setTxCategory('food');
    setTxDate(todayYmd);
    setTxAccount('cash');
    setTxMerchant('');
    setTxNote('');
    setAiDraftNotice(false);
    setAiInput('');
    setTxModalOpen(true);
    if (focusAi) {
      window.setTimeout(() => {
        document.getElementById('finance-ai-parse-input')?.focus();
      }, 60);
    }
  };

  const handleAiParse = async () => {
    const trimmed = aiInput.trim();
    if (!trimmed) return;
    if (!profile.aiGlobalEnabled) {
      showToast(t('assistant.disabledNotice'));
      return;
    }
    setAiLoading(true);
    const res = await parseFinanceSentence({
      text: trimmed,
      locale: profile.locale,
      defaultCurrency: profile.primaryCurrency,
      todayYmd,
      freeTier: true,
    });
    setAiLoading(false);

    if (!res.ok) {
      showToast(res.error);
      return;
    }

    setTxType(res.data.type);
    setTxAmount(String(res.data.amountMajor));
    setTxCurrency(res.data.currency);
    setTxCategory(res.data.category);
    setTxDate(res.data.occurredOn);
    setTxAccount(res.data.account);
    setTxMerchant(res.data.merchant ?? '');
    setTxNote(res.data.note ?? '');
    setAiDraftNotice(true);
  };

  const handleSaveTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = Number(txAmount);
    if (!Number.isFinite(major) || major <= 0) {
      showToast('Enter a positive transaction amount.');
      return;
    }
    const amountMinor = toMinorUnits(major, txCurrency);
    setSaving(true);
    try {
      await createTransaction({
        type: txType,
        amountMinor,
        currency: txCurrency,
        category: txCategory,
        occurredOn: txDate,
        account: txAccount,
        merchant: txMerchant.trim() || undefined,
        note: txNote.trim() || undefined,
        isRecurring: false,
      });
      setSelectedMonth(txDate.slice(0, 7));
      setTxModalOpen(false);
      showToast(
        `Saved ${txType} (${formatMoney(amountMinor, txCurrency, profile.locale)}).`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save transaction.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = Number(budgetLimitMajor);
    if (!Number.isFinite(major) || major <= 0) {
      showToast('Enter a positive budget limit.');
      return;
    }
    const existing = budgets.find((b) => b.category === budgetCategory) ?? null;
    try {
      await upsertBudget(existing, {
        category: budgetCategory,
        limitMinor: toMinorUnits(major, budgetCurrency),
        currency: budgetCurrency,
        alertThresholdPct: budgetAlertPct,
      });
      setBudgetModalOpen(false);
      setBudgetLimitMajor('');
      showToast(`Saved monthly budget for ${CATEGORY_LABELS[budgetCategory]}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save budget.');
    }
  };

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = Number(subAmountMajor);
    if (!subName.trim() || !Number.isFinite(major) || major <= 0) {
      showToast('Enter a subscription name and positive amount.');
      return;
    }
    try {
      await createSubscription({
        name: subName.trim(),
        amountMinor: toMinorUnits(major, subCurrency),
        currency: subCurrency,
        cadence: subCadence,
        category: subCategory,
        nextBillingDate: subNextDate,
        note: subNote.trim() || undefined,
      });
      setSubModalOpen(false);
      setSubName('');
      setSubAmountMajor('');
      setSubNote('');
      showToast(`Added recurring subscription "${subName.trim()}".`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save subscription.');
    }
  };

  const handleScheduleSubReminder = async (sub: SubscriptionItem) => {
    try {
      const remInput = buildSubscriptionReminderInput(sub);
      const created = await createReminder(remInput);
      await updateSubscriptionState(sub, { linkedReminderId: created.id });
      showToast(`Scheduled recurring bill reminder for "${sub.name}" in Smart Reminders.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not schedule bill reminder.');
    }
  };

  const handleExportCsv = () => {
    const csv = exportTransactionsToCsv(transactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifeos-finance-${activeMonthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${transactions.length} transactions to formula-safe CSV.`);
  };

  const handleConfirmCsvImport = async () => {
    if (!csvPreview || csvPreview.validRows.length === 0) return;
    setImportingCsv(true);
    try {
      for (const row of csvPreview.validRows) {
        await createTransaction(row);
      }
      const firstMonth = csvPreview.validRows[0].occurredOn.slice(0, 7);
      setSelectedMonth(firstMonth);
      setCsvModalOpen(false);
      setCsvText('');
      showToast(`Imported ${csvPreview.validRows.length} transactions from CSV.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not import CSV rows.');
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('finance.title')}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)] max-w-2xl">
            {t('finance.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            aria-label="Filter finance month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 font-numeric text-xs text-[var(--text-primary)]"
          />
          <button
            type="button"
            onClick={() => openTxModal(true)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span>{t('finance.aiQuickEntry')}</span>
          </button>
          <button
            type="button"
            onClick={() => setCsvModalOpen(true)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{t('finance.importCsv')}</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={transactions.length === 0}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('finance.exportCsv')}</span>
          </button>
          <button
            type="button"
            onClick={() => openTxModal(false)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>{t('finance.addTransaction')}</span>
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* 4-Column Flat KPI Strip */}
      <section
        aria-label="Monthly finance KPI strip"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl border border-[var(--border-hairline)] bg-[var(--border-hairline)] overflow-hidden"
      >
        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">
            {t('finance.kpiIncome')} ({activeMonthKey})
          </div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--accent)]">
            +{formatMoney(monthlySummary.incomePrimaryMinor, profile.primaryCurrency, profile.locale)}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            {monthlySummary.transactionCount} monthly entries
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">
            {t('finance.kpiExpenses')} ({activeMonthKey})
          </div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--text-primary)]">
            -{formatMoney(monthlySummary.expensePrimaryMinor, profile.primaryCurrency, profile.locale)}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {monthlySummary.expenseBreakdown[0]
              ? `Top: ${CATEGORY_LABELS[monthlySummary.expenseBreakdown[0].category]} (${monthlySummary.expenseBreakdown[0].sharePct}%)`
              : 'No expenses logged'}
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">
            {t('finance.kpiNetCashflow')}
          </div>
          <div
            className={`mt-2 font-numeric text-xl font-semibold ${
              monthlySummary.netPrimaryMinor > 0
                ? 'text-[var(--accent)]'
                : monthlySummary.netPrimaryMinor < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-[var(--text-primary)]'
            }`}
          >
            {monthlySummary.netPrimaryMinor > 0 ? '+' : ''}
            {formatMoney(monthlySummary.netPrimaryMinor, profile.primaryCurrency, profile.locale)}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            ≈ {formatMoney(secondaryNetMinor, profile.secondaryCurrency, profile.locale)} ·{' '}
            {monthlySummary.savingsRatePct}% savings
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-4 sm:p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">
            {t('finance.kpiSubscriptions')}
          </div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--text-primary)]">
            {formatMoney(
              subscriptionMetrics.monthlyBurnPrimaryMinor,
              profile.primaryCurrency,
              profile.locale
            )}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            {subscriptionMetrics.activeCount} active ·{' '}
            {subscriptionMetrics.upcomingWithin14Days.length} due ≤ 14d
          </div>
        </div>
      </section>

      {/* Underline Segmented Tabs */}
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border-hairline)]">
        <div className="flex items-center gap-6 overflow-x-auto">
          {(
            [
              { id: 'ledger', label: t('finance.tabLedger'), icon: Wallet },
              { id: 'budgets', label: t('finance.tabBudgets'), icon: PieChart },
              { id: 'subscriptions', label: t('finance.tabSubscriptions'), icon: Repeat },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {tab === 'budgets' && (
          <button
            type="button"
            onClick={() => setBudgetModalOpen(true)}
            className="mb-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('finance.addBudget')}</span>
          </button>
        )}

        {tab === 'subscriptions' && (
          <button
            type="button"
            onClick={() => setSubModalOpen(true)}
            className="mb-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('finance.addSubscription')}</span>
          </button>
        )}
      </div>

      {/* Tab 1: Ledger */}
      {tab === 'ledger' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search merchant, category, account, or note..."
                className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] ps-9 pe-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Filter transaction type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | TransactionType)}
                className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--text-primary)]"
              >
                <option value="all">All Types</option>
                <option value="income">{t('finance.typeIncome')}</option>
                <option value="expense">{t('finance.typeExpense')}</option>
              </select>
              <select
                aria-label="Filter category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--text-primary)]"
              >
                <option value="all">All Categories</option>
                {ALL_TRANSACTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Monthly Expense Breakdown Strip */}
          {monthlySummary.expenseBreakdown.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--text-muted)]">
                <span>Expense Distribution ({activeMonthKey})</span>
                <span className="font-numeric">
                  {formatMoney(monthlySummary.expensePrimaryMinor, profile.primaryCurrency, profile.locale)}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
                {monthlySummary.expenseBreakdown.slice(0, 6).map((row) => (
                  <div key={row.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-primary)] font-medium">
                        {CATEGORY_LABELS[row.category]}
                      </span>
                      <span className="font-numeric text-[var(--text-secondary)]">
                        {formatMoney(row.totalPrimaryMinor, profile.primaryCurrency, profile.locale)}{' '}
                        ({row.sharePct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${Math.max(4, row.sharePct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ledger Table / Rows */}
          {!loading && filteredTransactions.length === 0 ? (
            <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-6 py-12 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-subtle)] text-[var(--accent)]">
                <Wallet className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">
                {t('finance.emptyTitle')}
              </h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--text-secondary)]">
                {t('finance.emptyDesc')}
              </p>
              <button
                type="button"
                onClick={() => openTxModal(false)}
                className="mt-5 inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <Plus className="h-4 w-4" />
                <span>{t('finance.addTransaction')}</span>
              </button>
            </section>
          ) : (
            <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
              {filteredTransactions.map((tx) => {
                const isIncome = tx.type === 'income';
                const eqPrimary =
                  tx.currency !== profile.primaryCurrency
                    ? convertMinorUnits(
                        tx.amountMinor,
                        tx.currency,
                        profile.primaryCurrency,
                        DEFAULT_FX_RATES_TO_IQD
                      )
                    : null;
                return (
                  <div
                    key={tx.id}
                    className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-[var(--bg-subtle)]/40 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          isIncome
                            ? 'bg-emerald-500/10 text-[var(--accent)]'
                            : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {isIncome ? (
                          <ArrowDownLeft className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {tx.merchant || CATEGORY_LABELS[tx.category]}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-muted)]">
                          <span className="font-numeric">{tx.occurredOn}</span>
                          <span aria-hidden="true">·</span>
                          <span>{CATEGORY_LABELS[tx.category]}</span>
                          <span aria-hidden="true">·</span>
                          <span>{ACCOUNT_LABELS[tx.account]}</span>
                          {tx.note && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate max-w-xs">{tx.note}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-end">
                        <div
                          className={`font-numeric text-sm font-semibold ${
                            isIncome ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'
                          }`}
                        >
                          {isIncome ? '+' : '-'}
                          {formatMoney(tx.amountMinor, tx.currency, profile.locale)}
                        </div>
                        {eqPrimary !== null && (
                          <div className="font-numeric text-[11px] text-[var(--text-muted)]">
                            ≈ {formatMoney(eqPrimary, profile.primaryCurrency, profile.locale)}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete transaction ${tx.merchant || tx.category}`}
                        onClick={() => {
                          void deleteTransaction(tx).then(() => {
                            showToast('Transaction deleted.', () => {
                              void restoreTransaction(tx);
                            });
                          });
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      )}

      {/* Tab 2: Budgets */}
      {tab === 'budgets' && (
        <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
          {budgetEvaluations.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                No category budgets configured yet
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Set monthly spending limits for Food, Housing, Utilities, or Shopping with automatic warning thresholds.
              </p>
              <button
                type="button"
                onClick={() => setBudgetModalOpen(true)}
                className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <Plus className="h-4 w-4" />
                <span>{t('finance.addBudget')}</span>
              </button>
            </div>
          ) : (
            budgetEvaluations.map((ev) => {
              const barColor =
                ev.status === 'exceeded'
                  ? 'bg-red-500'
                  : ev.status === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-[var(--accent)]';
              return (
                <div key={ev.budget.id} className="p-5 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {CATEGORY_LABELS[ev.budget.category]}
                      </div>
                      <div className="mt-0.5 font-numeric text-xs text-[var(--text-muted)]">
                        Spent{' '}
                        {formatMoney(
                          ev.spentInBudgetCurrencyMinor,
                          ev.budget.currency,
                          profile.locale
                        )}{' '}
                        of{' '}
                        {formatMoney(
                          ev.budget.limitMinor,
                          ev.budget.currency,
                          profile.locale
                        )}{' '}
                        · Alert at {ev.budget.alertThresholdPct}%
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-numeric text-xs font-semibold ${
                          ev.status === 'exceeded'
                            ? 'text-red-600 dark:text-red-400'
                            : ev.status === 'warning'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-[var(--accent)]'
                        }`}
                      >
                        {ev.usedPct}% ·{' '}
                        {ev.remainingMinor >= 0
                          ? `${formatMoney(ev.remainingMinor, ev.budget.currency, profile.locale)} left`
                          : `${formatMoney(Math.abs(ev.remainingMinor), ev.budget.currency, profile.locale)} over`}
                      </span>
                      <button
                        type="button"
                        aria-label={`Delete ${ev.budget.category} budget`}
                        onClick={() => void deleteBudget(ev.budget.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${barColor}`}
                      style={{ width: `${Math.min(100, ev.usedPct)}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}

      {/* Tab 3: Recurring Subscriptions */}
      {tab === 'subscriptions' && (
        <section className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
          {subscriptions.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                No recurring subscriptions tracked yet
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Track Internet, Mobile Data, Cloud Storage, Gym, or Streaming bills and send 1-click renewal reminders to Smart Reminders.
              </p>
              <button
                type="button"
                onClick={() => setSubModalOpen(true)}
                className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <Plus className="h-4 w-4" />
                <span>{t('finance.addSubscription')}</span>
              </button>
            </div>
          ) : (
            subscriptions.map((sub) => (
              <div
                key={sub.id}
                className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  sub.status !== 'active' ? 'opacity-65' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {sub.name}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                      · {sub.cadence} · {sub.status}
                    </span>
                  </div>
                  <div className="mt-0.5 font-numeric text-xs text-[var(--text-muted)]">
                    Next billing: {sub.nextBillingDate} · {CATEGORY_LABELS[sub.category]}
                    {sub.linkedReminderId ? ' · Reminder linked' : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-numeric text-sm font-semibold text-[var(--text-primary)] me-2">
                    {formatMoney(sub.amountMinor, sub.currency, profile.locale)}
                  </span>
                  {!sub.linkedReminderId && (
                    <button
                      type="button"
                      onClick={() => void handleScheduleSubReminder(sub)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                    >
                      <Bell className="h-3.5 w-3.5 text-[var(--accent)]" />
                      <span>Remind</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void updateSubscriptionState(sub, {
                        status: sub.status === 'active' ? 'paused' : 'active',
                      })
                    }
                    className="min-h-[36px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                  >
                    {sub.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete subscription ${sub.name}`}
                    onClick={() => {
                      void deleteSubscription(sub).then(() => {
                        showToast(`Deleted subscription "${sub.name}".`, () => {
                          void restoreSubscription(sub);
                        });
                      });
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {/* Add Transaction Modal (with AI Quick Entry) */}
      {txModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('finance.addTransaction')}
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4 backdrop-blur-xs overflow-y-auto anim-modal-backdrop"
          onClick={() => setTxModalOpen(false)}
        >
          <div
            className="w-full sm:max-w-lg rounded-b-3xl sm:rounded-2xl pt-safe border-b sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl overflow-hidden max-h-[90dvh] overflow-y-auto anim-top-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {t('finance.addTransaction')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setTxModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTransaction} className="p-6 space-y-4">
              {/* Optional AI Natural-Language Quick Parse */}
              <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>{t('finance.aiQuickEntry')} (EN / AR / Kurdish)</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="finance-ai-parse-input"
                    type="text"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder={t('finance.aiParsePlaceholder')}
                    className="flex-1 min-h-[38px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={aiLoading || !aiInput.trim()}
                    onClick={() => void handleAiParse()}
                    className="min-h-[38px] rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 whitespace-nowrap"
                  >
                    {aiLoading ? 'Parsing...' : t('finance.aiParseBtn')}
                  </button>
                </div>
                {aiDraftNotice && (
                  <p className="text-[11px] font-medium text-[var(--accent)]">
                    {t('finance.aiDraftNotice')}
                  </p>
                )}
              </div>

              {/* Type Switcher */}
              <div className="grid grid-cols-2 gap-2">
                {(['expense', 'income'] as const).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => {
                      setTxType(tp);
                      setTxCategory(tp === 'income' ? 'salary' : 'food');
                    }}
                    className={`min-h-[40px] rounded-xl border text-xs font-semibold transition-colors ${
                      txType === tp
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {tp === 'income' ? t('finance.typeIncome') : t('finance.typeExpense')}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="tx-amount-input"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Amount
                  </label>
                  <input
                    id="tx-amount-input"
                    type="number"
                    step="any"
                    required
                    min="0.01"
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    placeholder="35000"
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 font-numeric text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tx-currency-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Currency
                  </label>
                  <select
                    id="tx-currency-select"
                    value={txCurrency}
                    onChange={(e) => setTxCurrency(e.target.value as CurrencyCode)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    <option value="IQD">IQD (Iraqi Dinar)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="tx-category-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="tx-category-select"
                    value={txCategory}
                    onChange={(e) => setTxCategory(e.target.value as TransactionCategory)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    {(txType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="tx-account-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Account
                  </label>
                  <select
                    id="tx-account-select"
                    value={txAccount}
                    onChange={(e) => setTxAccount(e.target.value as FinanceAccount)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    {FINANCE_ACCOUNTS.map((acc) => (
                      <option key={acc} value={acc}>
                        {ACCOUNT_LABELS[acc]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="tx-date-input"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Date
                  </label>
                  <input
                    id="tx-date-input"
                    type="date"
                    required
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 font-numeric text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tx-merchant-input"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Merchant / Payee
                  </label>
                  <input
                    id="tx-merchant-input"
                    type="text"
                    maxLength={120}
                    value={txMerchant}
                    onChange={(e) => setTxMerchant(e.target.value)}
                    placeholder="e.g. Family Mall"
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="tx-note-input"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                >
                  Note (optional)
                </label>
                <input
                  id="tx-note-input"
                  type="text"
                  maxLength={500}
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  placeholder="Optional reference..."
                  className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setTxModalOpen(false)}
                  className="min-h-[42px] rounded-xl px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving || !txAmount}
                  className="min-h-[42px] rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {saving ? 'Saving...' : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set Budget Modal */}
      {budgetModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('finance.addBudget')}
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4 backdrop-blur-xs overflow-y-auto anim-modal-backdrop"
          onClick={() => setBudgetModalOpen(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-b-3xl sm:rounded-2xl pt-safe border-b sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl overflow-hidden max-h-[90dvh] overflow-y-auto anim-top-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {t('finance.addBudget')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setBudgetModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveBudget} className="p-6 space-y-4">
              <div>
                <label
                  htmlFor="budget-cat-select"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                >
                  Expense Category
                </label>
                <select
                  id="budget-cat-select"
                  value={budgetCategory}
                  onChange={(e) => setBudgetCategory(e.target.value as ExpenseCategory)}
                  className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="budget-limit-input"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Monthly Limit
                  </label>
                  <input
                    id="budget-limit-input"
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={budgetLimitMajor}
                    onChange={(e) => setBudgetLimitMajor(e.target.value)}
                    placeholder="300000"
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 font-numeric text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="budget-curr-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Currency
                  </label>
                  <select
                    id="budget-curr-select"
                    value={budgetCurrency}
                    onChange={(e) => setBudgetCurrency(e.target.value as CurrencyCode)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    <option value="IQD">IQD</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="budget-alert-input"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                >
                  Warning Alert Threshold ({budgetAlertPct}%)
                </label>
                <input
                  id="budget-alert-input"
                  type="range"
                  min={50}
                  max={100}
                  step={5}
                  value={budgetAlertPct}
                  onChange={(e) => setBudgetAlertPct(Number(e.target.value))}
                  className="w-full accent-emerald-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBudgetModalOpen(false)}
                  className="min-h-[40px] rounded-xl px-4 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-[var(--accent)] px-5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Subscription Modal */}
      {subModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('finance.addSubscription')}
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4 backdrop-blur-xs overflow-y-auto anim-modal-backdrop"
          onClick={() => setSubModalOpen(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-b-3xl sm:rounded-2xl pt-safe border-b sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl overflow-hidden max-h-[90dvh] overflow-y-auto anim-top-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {t('finance.addSubscription')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setSubModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSubscription} className="p-6 space-y-4">
              <div>
                <label
                  htmlFor="sub-name-input"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                >
                  Subscription / Bill Name
                </label>
                <input
                  id="sub-name-input"
                  type="text"
                  required
                  maxLength={120}
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  placeholder="e.g. Fiber Internet, iCloud+"
                  className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sub-amount-input"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Amount
                  </label>
                  <input
                    id="sub-amount-input"
                    type="number"
                    required
                    min="0.01"
                    step="any"
                    value={subAmountMajor}
                    onChange={(e) => setSubAmountMajor(e.target.value)}
                    placeholder="45000"
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 font-numeric text-sm text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sub-curr-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Currency
                  </label>
                  <select
                    id="sub-curr-select"
                    value={subCurrency}
                    onChange={(e) => setSubCurrency(e.target.value as CurrencyCode)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    <option value="IQD">IQD</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sub-cadence-select"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Billing Cycle
                  </label>
                  <select
                    id="sub-cadence-select"
                    value={subCadence}
                    onChange={(e) => setSubCadence(e.target.value as SubscriptionCadence)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="sub-date-input"
                    className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                  >
                    Next Billing Date
                  </label>
                  <input
                    id="sub-date-input"
                    type="date"
                    required
                    value={subNextDate}
                    onChange={(e) => setSubNextDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 font-numeric text-sm text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="sub-cat-select"
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                >
                  Category
                </label>
                <select
                  id="sub-cat-select"
                  value={subCategory}
                  onChange={(e) => setSubCategory(e.target.value as ExpenseCategory)}
                  className="w-full min-h-[40px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-sm text-[var(--text-primary)]"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSubModalOpen(false)}
                  className="min-h-[40px] rounded-xl px-4 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-xl bg-[var(--accent)] px-5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                >
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('finance.importCsv')}
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4 backdrop-blur-xs overflow-y-auto anim-modal-backdrop"
          onClick={() => setCsvModalOpen(false)}
        >
          <div
            className="w-full sm:max-w-lg rounded-b-3xl sm:rounded-2xl pt-safe border-b sm:border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl overflow-hidden max-h-[90dvh] overflow-y-auto anim-top-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-6 py-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {t('finance.importCsv')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setCsvModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-[var(--text-muted)]">
                Format: <span className="font-numeric">date,type,amount,currency,category,account,merchant,note</span>
              </p>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  void f.text().then(setCsvText);
                }}
                className="block w-full text-xs text-[var(--text-secondary)]"
              />
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={`date,type,amount,currency,category,account,merchant,note\n${todayYmd},expense,25000,IQD,food,cash,Local Market,Groceries`}
                className="w-full rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 font-numeric text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              {csvPreview && (
                <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 text-xs space-y-1">
                  <div className="font-medium text-[var(--accent)]">
                    Ready to import: {csvPreview.validRows.length} valid rows
                  </div>
                  {csvPreview.errors.length > 0 && (
                    <div className="text-amber-700 dark:text-amber-400">
                      Skipped {csvPreview.errors.length} invalid{' '}
                      {csvPreview.errors.length === 1 ? 'line' : 'lines'} (e.g. Line{' '}
                      {csvPreview.errors[0].line}: {csvPreview.errors[0].reason})
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCsvModalOpen(false)}
                  className="min-h-[40px] rounded-xl px-4 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  disabled={importingCsv || !csvPreview || csvPreview.validRows.length === 0}
                  onClick={() => void handleConfirmCsvImport()}
                  className="min-h-[40px] rounded-xl bg-[var(--accent)] px-5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {importingCsv ? 'Importing...' : `Import ${csvPreview?.validRows.length ?? 0} Rows`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

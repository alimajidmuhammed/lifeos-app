import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  MessageSquareText,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../../core/currency/currency';
import {
  aggregateDebtMetrics,
  computeDaysOverdue,
  computeEffectiveStatus,
  estimateRepaymentProbability,
  exportDebtsToCsv,
  getTodayYmd,
} from '../../../core/debts/debtEngine';
import type { DebtDirection, DebtRecord } from '../../../core/debts/debtSchemas';
import { useDebts } from '../../../hooks/useDebts';
import { useUIStore } from '../../../state/useUIStore';
import { DebtFormModal } from './DebtFormModal';
import { DebtPaymentModal } from './DebtPaymentModal';
import { DebtReminderModal } from './DebtReminderModal';
import { DebtDetailDrawer } from './DebtDetailDrawer';
import {
  CashFlowForecastPanel,
  PayoffPlannerPanel,
  PeopleLedgerPanel,
} from './DebtsAnalyticsPanels';

type SubTab = 'ledger' | 'people' | 'planner' | 'forecast';
type StatusFilter = 'open' | 'overdue' | 'settled' | 'all';
type DirectionFilter = 'all' | DebtDirection;

export const DebtsView: React.FC = () => {
  const { t } = useTranslation();
  const profile = useUIStore((s) => s.profile);
  const showToast = useUIStore((s) => s.showToast);

  const {
    debts,
    ledgersByKey,
    loading,
    fxRates,
    setFxRates,
    createDebt,
    updateDebtMeta,
    recordPayment,
    deleteDebt,
    restoreDebt,
    listPayments,
    isCloudSynced,
  } = useDebts();

  const [subTab, setSubTab] = useState<SubTab>('ledger');
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [fxEditorOpen, setFxEditorOpen] = useState(false);
  const [usdRateInput, setUsdRateInput] = useState(String(fxRates.USD));
  const [eurRateInput, setEurRateInput] = useState(String(fxRates.EUR));

  const [formOpen, setFormOpen] = useState(false);
  const [formFocusAi, setFormFocusAi] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DebtRecord | null>(null);
  const [payingDebt, setPayingDebt] = useState<DebtRecord | null>(null);
  const [reminderDebt, setReminderDebt] = useState<DebtRecord | null>(null);
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);

  const todayYmd = getTodayYmd();

  const metrics = useMemo(
    () => aggregateDebtMetrics(debts, profile.primaryCurrency, fxRates, todayYmd),
    [debts, profile.primaryCurrency, fxRates, todayYmd]
  );

  const selectedDebt = useMemo(
    () => (selectedDebtId ? debts.find((d) => d.id === selectedDebtId) ?? null : null),
    [debts, selectedDebtId]
  );

  const filteredDebts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return debts.filter((d) => {
      const eff = computeEffectiveStatus(d, todayYmd);
      if (statusFilter === 'open' && eff === 'settled') return false;
      if (statusFilter === 'overdue' && eff !== 'overdue') return false;
      if (statusFilter === 'settled' && eff !== 'settled') return false;
      if (directionFilter !== 'all' && d.direction !== directionFilter) return false;
      if (q) {
        const hay = `${d.personName} ${d.category} ${d.notes ?? ''} ${d.currency}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [debts, searchQuery, directionFilter, statusFilter, todayYmd]);

  const handleSaveFxRates = (e: React.FormEvent) => {
    e.preventDefault();
    const usd = Number(usdRateInput);
    const eur = Number(eurRateInput);
    if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(eur) || eur <= 0) {
      showToast('Enter valid positive exchange rates.');
      return;
    }
    setFxRates({ IQD: 1, USD: Math.round(usd), EUR: Math.round(eur) });
    setFxEditorOpen(false);
    showToast('Reference FX rates updated.');
  };

  const handleExportCsv = () => {
    const csv = exportDebtsToCsv(debts, todayYmd);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifeos-debts-${todayYmd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported debts CSV.');
  };

  const handleDeleteWithUndo = async (debt: DebtRecord) => {
    await deleteDebt(debt);
    showToast(`Deleted debt for ${debt.personName}.`, () => {
      void restoreDebt(debt);
    });
  };

  const primaryCur = profile.primaryCurrency;
  const secondaryCur = profile.secondaryCurrency;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)]">
            <span>{isCloudSynced ? t('common.syncedCloudMode') : t('common.offlineLocalMode')}</span>
            <span aria-hidden="true"> · </span>
            <span className="font-numeric">1 USD = {fxRates.USD.toLocaleString()} IQD</span>
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('debts.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {t('debts.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditingDebt(null);
              setFormFocusAi(true);
              setFormOpen(true);
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs sm:text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors whitespace-nowrap"
          >
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            <span>{t('debts.aiQuickEntry')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingDebt(null);
              setFormFocusAi(false);
              setFormOpen(true);
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>{t('debts.addDebt')}</span>
          </button>
        </div>
      </section>

      {/* 4-Column Flat KPI Strip (Single Elevation, Hairline Dividers, Tabular Figures) */}
      <section
        aria-label="Debts financial summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl border border-[var(--border-hairline)] bg-[var(--border-hairline)] overflow-hidden"
      >
        <div className="bg-[var(--bg-surface)] p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('debts.owedToMe')}</div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--accent)]">
            {formatMoney(metrics.equivalentOwedToMePrimaryMinor, primaryCur, profile.locale)}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            {primaryCur}: {formatMoney(metrics.byCurrency[primaryCur].owedToMeMinor, primaryCur, profile.locale)} ·{' '}
            {secondaryCur}: {formatMoney(metrics.byCurrency[secondaryCur].owedToMeMinor, secondaryCur, profile.locale)}
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('debts.iOwe')}</div>
          <div className="mt-2 font-numeric text-xl font-semibold text-[var(--text-primary)]">
            {formatMoney(metrics.equivalentIOwePrimaryMinor, primaryCur, profile.locale)}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            {primaryCur}: {formatMoney(metrics.byCurrency[primaryCur].iOweMinor, primaryCur, profile.locale)} ·{' '}
            {secondaryCur}: {formatMoney(metrics.byCurrency[secondaryCur].iOweMinor, secondaryCur, profile.locale)}
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)]">{t('debts.netPosition')}</span>
            <button
              type="button"
              onClick={() => setFxEditorOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              <SlidersHorizontal className="h-3 w-3" />
              <span>{t('debts.fxRatesBtn')}</span>
            </button>
          </div>
          <div
            className={`mt-2 font-numeric text-xl font-semibold ${
              metrics.equivalentNetPrimaryMinor > 0
                ? 'text-[var(--accent)]'
                : metrics.equivalentNetPrimaryMinor < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-[var(--text-primary)]'
            }`}
          >
            {metrics.equivalentNetPrimaryMinor > 0 ? '+' : ''}
            {formatMoney(metrics.equivalentNetPrimaryMinor, primaryCur, profile.locale)}
          </div>
          <div className="mt-1 font-numeric text-xs text-[var(--text-muted)]">
            {metrics.totalOpenCount} open · {metrics.totalSettledCount} settled
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] p-5">
          <div className="text-xs font-medium text-[var(--text-muted)]">{t('debts.overdueAttention')}</div>
          <div
            className={`mt-2 font-numeric text-xl font-semibold ${
              metrics.totalOverdueCount > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-[var(--text-primary)]'
            }`}
          >
            {metrics.totalOverdueCount}
          </div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {metrics.totalOverdueCount > 0
              ? 'Past due date — review or send reminder'
              : 'All open obligations on schedule'}
          </div>
        </div>
      </section>

      {/* Editable FX Rates Bar (on demand) */}
      {fxEditorOpen && (
        <form
          onSubmit={handleSaveFxRates}
          className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 flex flex-wrap items-end gap-3"
        >
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              1 USD in IQD
            </label>
            <input
              type="number"
              min="1"
              value={usdRateInput}
              onChange={(e) => setUsdRateInput(e.target.value)}
              className="w-36 min-h-[38px] font-numeric rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              1 EUR in IQD
            </label>
            <input
              type="number"
              min="1"
              value={eurRateInput}
              onChange={(e) => setEurRateInput(e.target.value)}
              className="w-36 min-h-[38px] font-numeric rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
            />
          </div>
          <button
            type="submit"
            className="min-h-[38px] rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => setFxEditorOpen(false)}
            className="min-h-[38px] rounded-lg border border-[var(--border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
          >
            {t('common.cancel')}
          </button>
        </form>
      )}

      {/* Segmented View Tabs + CSV Export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Debts views"
          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]"
        >
          {(
            [
              { id: 'ledger', label: t('debts.tabLedger') },
              { id: 'people', label: t('debts.tabPeople') },
              { id: 'planner', label: t('debts.tabPlanner') },
              { id: 'forecast', label: t('debts.tabForecast') },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={subTab === tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                subTab === tab.id
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {debts.length > 0 && (
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t('debts.exportCsv')}</span>
          </button>
        )}
      </div>

      {/* Sub-view Content */}
      {subTab === 'people' ? (
        <PeopleLedgerPanel
          debts={debts}
          ledgersByKey={ledgersByKey}
          onFilterByPerson={(name) => {
            setSearchQuery(name);
            setStatusFilter('all');
            setDirectionFilter('all');
            setSubTab('ledger');
          }}
        />
      ) : subTab === 'planner' ? (
        <PayoffPlannerPanel
          debts={debts}
          primaryCurrency={profile.primaryCurrency}
          fxRates={fxRates}
        />
      ) : subTab === 'forecast' ? (
        <CashFlowForecastPanel
          debts={debts}
          primaryCurrency={profile.primaryCurrency}
          fxRates={fxRates}
        />
      ) : (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('debts.searchPlaceholder')}
                className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] ps-10 pe-3.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]">
                {(
                  [
                    { id: 'all', label: t('debts.filterAll') },
                    { id: 'owed_to_me', label: t('debts.owedToMe') },
                    { id: 'i_owe', label: t('debts.iOwe') },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDirectionFilter(item.id)}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      directionFilter === item.id
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]">
                {(
                  [
                    { id: 'open', label: t('debts.filterOpen') },
                    { id: 'overdue', label: t('debts.filterOverdue') },
                    { id: 'settled', label: t('debts.filterSettled') },
                    { id: 'all', label: t('debts.filterAll') },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStatusFilter(item.id)}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      statusFilter === item.id
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

          {/* Debt Ledger Rows */}
          {loading ? (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="p-5 flex items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-40 rounded bg-[var(--bg-subtle)] animate-pulse" />
                    <div className="h-3 w-64 rounded bg-[var(--bg-subtle)] animate-pulse" />
                  </div>
                  <div className="h-5 w-24 rounded bg-[var(--bg-subtle)] animate-pulse" />
                </div>
              ))}
            </div>
          ) : filteredDebts.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-10 text-center space-y-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {debts.length === 0 ? t('debts.emptyTitle') : 'No debts match your current filters'}
              </h2>
              <p className="max-w-md mx-auto text-xs sm:text-sm text-[var(--text-secondary)]">
                {debts.length === 0
                  ? t('debts.emptyDesc')
                  : 'Try clearing the search box or switching status to All.'}
              </p>
              {debts.length === 0 && (
                <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDebt(null);
                      setFormFocusAi(false);
                      setFormOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{t('debts.addDebt')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDebt(null);
                      setFormFocusAi(true);
                      setFormOpen(true);
                    }}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                  >
                    <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                    <span>{t('debts.aiQuickEntry')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] divide-y divide-[var(--border-hairline)] overflow-hidden">
              {filteredDebts.map((debt) => {
                const effStatus = computeEffectiveStatus(debt, todayYmd);
                const daysOverdue = computeDaysOverdue(debt, todayYmd);
                const pctPaid = Math.min(
                  100,
                  Math.round(((debt.principalMinor - debt.remainingMinor) / Math.max(1, debt.principalMinor)) * 100)
                );
                const prob =
                  debt.direction === 'owed_to_me' && effStatus !== 'settled'
                    ? estimateRepaymentProbability(debt, ledgersByKey[debt.personKey] ?? null, todayYmd)
                    : null;

                const statusLabel =
                  effStatus === 'settled'
                    ? t('debts.statusSettled')
                    : effStatus === 'overdue'
                      ? t('debts.overdueDays', { count: daysOverdue })
                      : effStatus === 'partial'
                        ? t('debts.statusPartial')
                        : t('debts.statusActive');

                return (
                  <div
                    key={debt.id}
                    className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[var(--bg-subtle)]/40 transition-colors"
                  >
                    {/* Clickable Main Summary */}
                    <button
                      type="button"
                      onClick={() => setSelectedDebtId(debt.id)}
                      className="flex-1 min-w-0 text-start space-y-1.5 focus:outline-none"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          {debt.personName}
                        </span>
                        <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                        <span
                          className={`text-xs font-medium ${
                            debt.direction === 'owed_to_me'
                              ? 'text-[var(--accent)]'
                              : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {debt.direction === 'owed_to_me' ? t('debts.owedToMe') : t('debts.iOwe')}
                        </span>
                        <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {debt.category.replace('_', ' ')}
                        </span>
                        <span aria-hidden="true" className="text-xs text-[var(--text-muted)]">·</span>
                        <span
                          className={`font-numeric text-xs font-medium ${
                            effStatus === 'overdue'
                              ? 'text-red-600 dark:text-red-400'
                              : effStatus === 'settled'
                                ? 'text-[var(--accent)]'
                                : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                        <span className="font-numeric">
                          {debt.dueDate ? `${t('debts.dueDate')} ${debt.dueDate}` : t('debts.noDueDate')}
                        </span>
                        {debt.interestRateBps > 0 && (
                          <span className="font-numeric">
                            · APR {(debt.interestRateBps / 100).toFixed(1)}%
                          </span>
                        )}
                        {prob && (
                          <span
                            className={`font-numeric ${
                              prob.band === 'at_risk'
                                ? 'text-red-600 dark:text-red-400'
                                : prob.band === 'moderate'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-[var(--text-secondary)]'
                            }`}
                          >
                            · {t('debts.repaymentScore')}: {prob.score}%
                          </span>
                        )}
                        {debt.notes && (
                          <span className="truncate max-w-xs">· {debt.notes}</span>
                        )}
                      </div>

                      {/* Subtle Repayment Progress Hairline */}
                      {pctPaid > 0 && effStatus !== 'settled' && (
                        <div className="pt-1 max-w-xs">
                          <div className="h-1 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--accent)]"
                              style={{ width: `${pctPaid}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </button>

                    {/* Right Side: Amount + Functional Action Buttons */}
                    <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-4 shrink-0">
                      <div className="text-start lg:text-end">
                        <div
                          className={`font-numeric text-base font-semibold ${
                            effStatus === 'settled'
                              ? 'text-[var(--text-muted)] line-through'
                              : debt.direction === 'owed_to_me'
                                ? 'text-[var(--accent)]'
                                : 'text-[var(--text-primary)]'
                          }`}
                        >
                          {formatMoney(debt.remainingMinor, debt.currency, profile.locale)}
                        </div>
                        {debt.remainingMinor !== debt.principalMinor && (
                          <div className="font-numeric text-[11px] text-[var(--text-muted)]">
                            {t('debts.ofPrincipal')} {formatMoney(debt.principalMinor, debt.currency, profile.locale)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {effStatus !== 'settled' && (
                          <>
                            <button
                              type="button"
                              onClick={() => setPayingDebt(debt)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:opacity-90 whitespace-nowrap"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{t('debts.logPayment')}</span>
                            </button>
                            <button
                              type="button"
                              aria-label={t('debts.draftReminder')}
                              onClick={() => setReminderDebt(debt)}
                              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                            >
                              <MessageSquareText className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedDebtId(debt.id)}
                          className="inline-flex min-h-[38px] items-center rounded-lg border border-[var(--border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] whitespace-nowrap"
                        >
                          {t('debts.details')}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals & Detail Drawer */}
      <DebtFormModal
        open={formOpen}
        editingDebt={editingDebt}
        initialFocusAi={formFocusAi}
        onClose={() => {
          setFormOpen(false);
          setEditingDebt(null);
        }}
        onCreate={async (input) => {
          await createDebt(input);
          showToast(`Saved debt for ${input.personName}.`);
        }}
        onUpdate={async (current, patch) => {
          await updateDebtMeta(current, patch);
          showToast(`Updated debt for ${patch.personName ?? current.personName}.`);
        }}
      />

      <DebtPaymentModal
        debt={payingDebt}
        onClose={() => setPayingDebt(null)}
        onRecordPayment={async (debt, input) => {
          await recordPayment(debt, input);
          showToast(
            input.amountMinor === debt.remainingMinor
              ? `Debt with ${debt.personName} settled in full.`
              : `Logged payment for ${debt.personName}.`
          );
        }}
      />

      <DebtReminderModal
        debt={reminderDebt}
        onClose={() => setReminderDebt(null)}
      />

      <DebtDetailDrawer
        debt={selectedDebt}
        ledger={selectedDebt ? ledgersByKey[selectedDebt.personKey] ?? null : null}
        listPayments={listPayments}
        onClose={() => setSelectedDebtId(null)}
        onEdit={(debt) => {
          setSelectedDebtId(null);
          setEditingDebt(debt);
          setFormFocusAi(false);
          setFormOpen(true);
        }}
        onLogPayment={(debt) => {
          setPayingDebt(debt);
        }}
        onDraftReminder={(debt) => {
          setReminderDebt(debt);
        }}
        onDelete={handleDeleteWithUndo}
      />
    </div>
  );
};

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_FX_RATES_TO_IQD } from '../core/currency/currency';
import { getTodayDayKey } from '../core/entitlements/entitlements';
import {
  computeMonthlyFinanceSummary,
  computeSubscriptionMetrics,
  evaluateMonthlyBudgets,
} from '../core/finance/financeEngine';
import type {
  BudgetLimit,
  CreateSubscriptionInput,
  CreateTransactionInput,
  SubscriptionItem,
  TransactionItem,
  UpsertBudgetInput,
} from '../core/finance/financeSchemas';
import {
  firebaseFinanceRepository,
  localFinanceRepository,
} from '../data/repositories/financeRepository';
import { useUIStore } from '../state/useUIStore';

export function useFinance(selectedMonthKey?: string) {
  const authUser = useUIStore((s) => s.authUser);
  const profile = useUIStore((s) => s.profile);
  const uid = authUser?.uid ?? 'local_user';
  const repo = authUser ? firebaseFinanceRepository : localFinanceRepository;

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [budgets, setBudgets] = useState<BudgetLimit[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let txDone = false;
    let bDone = false;
    let sDone = false;

    const mark = () => {
      if (txDone && bDone && sDone) setLoading(false);
    };

    const u1 = repo.subscribeTransactions(
      uid,
      (items) => {
        setTransactions(items);
        txDone = true;
        mark();
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    const u2 = repo.subscribeBudgets(
      uid,
      (items) => {
        setBudgets(items);
        bDone = true;
        mark();
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    const u3 = repo.subscribeSubscriptions(
      uid,
      (items) => {
        setSubscriptions(items);
        sDone = true;
        mark();
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      u1();
      u2();
      u3();
    };
  }, [repo, uid]);

  const todayYmd = getTodayDayKey();
  const activeMonthKey = selectedMonthKey || todayYmd.slice(0, 7);

  const monthlySummary = useMemo(
    () =>
      computeMonthlyFinanceSummary(
        transactions,
        activeMonthKey,
        profile.primaryCurrency,
        DEFAULT_FX_RATES_TO_IQD
      ),
    [transactions, activeMonthKey, profile.primaryCurrency]
  );

  const budgetEvaluations = useMemo(
    () =>
      evaluateMonthlyBudgets(budgets, transactions, activeMonthKey, DEFAULT_FX_RATES_TO_IQD),
    [budgets, transactions, activeMonthKey]
  );

  const subscriptionMetrics = useMemo(
    () =>
      computeSubscriptionMetrics(
        subscriptions,
        profile.primaryCurrency,
        DEFAULT_FX_RATES_TO_IQD,
        todayYmd
      ),
    [subscriptions, profile.primaryCurrency, todayYmd]
  );

  const createTransaction = useCallback(
    (input: CreateTransactionInput) => repo.createTransaction(uid, input),
    [repo, uid]
  );

  const deleteTransaction = useCallback(
    (tx: TransactionItem) => repo.deleteTransaction(uid, tx),
    [repo, uid]
  );

  const restoreTransaction = useCallback(
    (tx: TransactionItem) => repo.restoreTransaction(uid, tx),
    [repo, uid]
  );

  const upsertBudget = useCallback(
    (existing: BudgetLimit | null, input: UpsertBudgetInput) =>
      repo.upsertBudget(uid, existing, input),
    [repo, uid]
  );

  const deleteBudget = useCallback(
    (budgetId: string) => repo.deleteBudget(uid, budgetId),
    [repo, uid]
  );

  const createSubscription = useCallback(
    (input: CreateSubscriptionInput) => repo.createSubscription(uid, input),
    [repo, uid]
  );

  const updateSubscriptionState = useCallback(
    (
      current: SubscriptionItem,
      patch: Partial<Pick<SubscriptionItem, 'status' | 'nextBillingDate' | 'linkedReminderId'>>
    ) => repo.updateSubscriptionState(uid, current, patch),
    [repo, uid]
  );

  const deleteSubscription = useCallback(
    (sub: SubscriptionItem) => repo.deleteSubscription(uid, sub),
    [repo, uid]
  );

  const restoreSubscription = useCallback(
    (sub: SubscriptionItem) => repo.restoreSubscription(uid, sub),
    [repo, uid]
  );

  return {
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
  };
}

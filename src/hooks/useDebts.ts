import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_FX_RATES_TO_IQD,
  type CreateDebtInput,
  type DebtLedger,
  type DebtPayment,
  type DebtRecord,
  type FxRatesToIqd,
  type RecordPaymentInput,
} from '../core/debts/debtSchemas';
import {
  firebaseDebtsRepository,
  localDebtsRepository,
} from '../data/repositories/debtsRepository';
import { useUIStore } from '../state/useUIStore';

const FX_STORAGE_KEY = 'lifeos_fx_rates_v1';

function loadSavedFxRates(): FxRatesToIqd {
  try {
    const raw = localStorage.getItem(FX_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FxRatesToIqd>;
      const usd = Number(parsed.USD);
      const eur = Number(parsed.EUR);
      if (Number.isFinite(usd) && usd > 0 && Number.isFinite(eur) && eur > 0) {
        return { IQD: 1, USD: usd, EUR: eur };
      }
    }
  } catch {
    // Ignore storage read error
  }
  return DEFAULT_FX_RATES_TO_IQD;
}

export function useDebts() {
  const authUser = useUIStore((s) => s.authUser);
  const authReady = useUIStore((s) => s.authReady);
  const [debts, setDebts] = useState<DebtRecord[]>([]);
  const [ledgersByKey, setLedgersByKey] = useState<Record<string, DebtLedger>>({});
  const [loading, setLoading] = useState(true);
  const [fxRates, setFxRatesState] = useState<FxRatesToIqd>(loadSavedFxRates);

  const repo = authUser ? firebaseDebtsRepository : localDebtsRepository;
  const activeUid = authUser ? authUser.uid : 'local_offline_user';

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    const unsubDebts = repo.subscribeDebts(activeUid, (list) => {
      setDebts(list);
      setLoading(false);
    });
    const unsubLedgers = repo.subscribeLedgers(activeUid, (map) => {
      setLedgersByKey(map);
    });
    return () => {
      unsubDebts();
      unsubLedgers();
    };
  }, [authReady, repo, activeUid]);

  const setFxRates = useCallback((next: FxRatesToIqd) => {
    setFxRatesState(next);
    try {
      localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  }, []);

  const createDebt = useCallback(
    async (input: CreateDebtInput) => repo.createDebt(activeUid, input),
    [repo, activeUid]
  );

  const updateDebtMeta = useCallback(
    async (
      current: DebtRecord,
      patch: Partial<
        Pick<DebtRecord, 'personName' | 'personPhone' | 'category' | 'interestRateBps' | 'dueDate' | 'notes'>
      >
    ) => repo.updateDebtMeta(activeUid, current, patch),
    [repo, activeUid]
  );

  const recordPayment = useCallback(
    async (debt: DebtRecord, input: RecordPaymentInput) => repo.recordPayment(activeUid, debt, input),
    [repo, activeUid]
  );

  const deleteDebt = useCallback(
    async (debt: DebtRecord) => repo.deleteDebt(activeUid, debt),
    [repo, activeUid]
  );

  const restoreDebt = useCallback(
    async (debt: DebtRecord) => repo.restoreDebt(activeUid, debt),
    [repo, activeUid]
  );

  const listPayments = useCallback(
    async (debtId: string): Promise<DebtPayment[]> => repo.listPayments(activeUid, debtId),
    [repo, activeUid]
  );

  return {
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
    isCloudSynced: Boolean(authUser),
  };
}

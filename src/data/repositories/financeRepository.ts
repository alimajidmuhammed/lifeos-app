import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  CreateSubscriptionInputSchema,
  CreateTransactionInputSchema,
  UpsertBudgetInputSchema,
  type BudgetLimit,
  type CreateSubscriptionInput,
  type CreateTransactionInput,
  type SubscriptionItem,
  type TransactionItem,
  type UpsertBudgetInput,
} from '../../core/finance/financeSchemas';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseClient';
import type { FinanceRepository } from './interfaces';

const LOCAL_TXS_KEY = 'lifeos_local_transactions_v1';
const LOCAL_BUDGETS_KEY = 'lifeos_local_budgets_v1';
const LOCAL_SUBS_KEY = 'lifeos_local_subscriptions_v1';
const FINANCE_EVENT = 'lifeos:finance:changed';

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class FirebaseWebFinanceRepository implements FinanceRepository {
  subscribeTransactions(
    uid: string,
    onData: (txs: TransactionItem[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/transactions`;
    const q = query(
      collection(db, 'users', uid, 'transactions'),
      where('uid', '==', uid),
      orderBy('occurredOn', 'desc')
    );
    return onSnapshot(
      q,
      (snap) => {
        const items: TransactionItem[] = snap.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            uid: String(raw.uid ?? uid),
            type: (raw.type ?? 'expense') as TransactionItem['type'],
            amountMinor: Number(raw.amountMinor ?? 0),
            currency: (raw.currency ?? 'IQD') as TransactionItem['currency'],
            category: (raw.category ?? 'other') as TransactionItem['category'],
            occurredOn: String(raw.occurredOn ?? new Date().toISOString().slice(0, 10)),
            merchant: typeof raw.merchant === 'string' ? raw.merchant : undefined,
            account: (raw.account ?? 'cash') as TransactionItem['account'],
            note: typeof raw.note === 'string' ? raw.note : undefined,
            isRecurring: Boolean(raw.isRecurring),
            version: Number(raw.version ?? 1),
            createdAt: tsToIso(raw.createdAt),
            updatedAt: tsToIso(raw.updatedAt),
          };
        });
        onData(items);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
  }

  subscribeBudgets(
    uid: string,
    onData: (budgets: BudgetLimit[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/budgets`;
    const q = query(collection(db, 'users', uid, 'budgets'), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const items: BudgetLimit[] = snap.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            uid: String(raw.uid ?? uid),
            category: (raw.category ?? 'other') as BudgetLimit['category'],
            limitMinor: Number(raw.limitMinor ?? 0),
            currency: (raw.currency ?? 'IQD') as BudgetLimit['currency'],
            alertThresholdPct: Number(raw.alertThresholdPct ?? 80),
            version: Number(raw.version ?? 1),
            createdAt: tsToIso(raw.createdAt),
            updatedAt: tsToIso(raw.updatedAt),
          };
        });
        onData(items);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
  }

  subscribeSubscriptions(
    uid: string,
    onData: (subs: SubscriptionItem[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/subscriptions`;
    const q = query(collection(db, 'users', uid, 'subscriptions'), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const items: SubscriptionItem[] = snap.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            uid: String(raw.uid ?? uid),
            name: String(raw.name ?? ''),
            amountMinor: Number(raw.amountMinor ?? 0),
            currency: (raw.currency ?? 'IQD') as SubscriptionItem['currency'],
            cadence: (raw.cadence ?? 'monthly') as SubscriptionItem['cadence'],
            nextBillingDate: String(raw.nextBillingDate ?? new Date().toISOString().slice(0, 10)),
            category: (raw.category ?? 'subscriptions') as SubscriptionItem['category'],
            status: (raw.status ?? 'active') as SubscriptionItem['status'],
            linkedReminderId:
              typeof raw.linkedReminderId === 'string' ? raw.linkedReminderId : undefined,
            note: typeof raw.note === 'string' ? raw.note : undefined,
            version: Number(raw.version ?? 1),
            createdAt: tsToIso(raw.createdAt),
            updatedAt: tsToIso(raw.updatedAt),
          };
        });
        onData(items);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
  }

  async createTransaction(uid: string, input: CreateTransactionInput): Promise<TransactionItem> {
    const valid = CreateTransactionInputSchema.parse(input);
    const id = makeId('tx');
    const path = `users/${uid}/transactions/${id}`;
    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      uid,
      type: valid.type,
      amountMinor: valid.amountMinor,
      currency: valid.currency,
      category: valid.category,
      occurredOn: valid.occurredOn,
      account: valid.account,
      isRecurring: valid.isRecurring,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (valid.merchant) payload.merchant = valid.merchant;
    if (valid.note) payload.note = valid.note;

    try {
      await setDoc(doc(db, 'users', uid, 'transactions', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }

    return {
      id,
      uid,
      ...valid,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  async deleteTransaction(uid: string, tx: TransactionItem): Promise<void> {
    const path = `users/${uid}/transactions/${tx.id}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'transactions', tx.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async restoreTransaction(uid: string, tx: TransactionItem): Promise<void> {
    const path = `users/${uid}/transactions/${tx.id}`;
    const payload: Record<string, unknown> = {
      uid,
      type: tx.type,
      amountMinor: tx.amountMinor,
      currency: tx.currency,
      category: tx.category,
      occurredOn: tx.occurredOn,
      account: tx.account,
      isRecurring: tx.isRecurring,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (tx.merchant) payload.merchant = tx.merchant;
    if (tx.note) payload.note = tx.note;

    try {
      await setDoc(doc(db, 'users', uid, 'transactions', tx.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  async upsertBudget(
    uid: string,
    existing: BudgetLimit | null,
    input: UpsertBudgetInput
  ): Promise<BudgetLimit> {
    const valid = UpsertBudgetInputSchema.parse(input);
    const id = existing?.id ?? `budget_${valid.category}`;
    const path = `users/${uid}/budgets/${id}`;
    const nowIso = new Date().toISOString();

    try {
      if (existing) {
        await updateDoc(doc(db, 'users', uid, 'budgets', id), {
          category: valid.category,
          limitMinor: valid.limitMinor,
          currency: valid.currency,
          alertThresholdPct: valid.alertThresholdPct,
          version: existing.version + 1,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'users', uid, 'budgets', id), {
          uid,
          category: valid.category,
          limitMinor: valid.limitMinor,
          currency: valid.currency,
          alertThresholdPct: valid.alertThresholdPct,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, path);
    }

    return {
      id,
      uid,
      ...valid,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
  }

  async deleteBudget(uid: string, budgetId: string): Promise<void> {
    const path = `users/${uid}/budgets/${budgetId}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'budgets', budgetId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async createSubscription(
    uid: string,
    input: CreateSubscriptionInput
  ): Promise<SubscriptionItem> {
    const valid = CreateSubscriptionInputSchema.parse(input);
    const id = makeId('sub');
    const path = `users/${uid}/subscriptions/${id}`;
    const nowIso = new Date().toISOString();

    const payload: Record<string, unknown> = {
      uid,
      name: valid.name,
      amountMinor: valid.amountMinor,
      currency: valid.currency,
      cadence: valid.cadence,
      nextBillingDate: valid.nextBillingDate,
      category: valid.category,
      status: 'active',
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (valid.note) payload.note = valid.note;

    try {
      await setDoc(doc(db, 'users', uid, 'subscriptions', id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }

    return {
      id,
      uid,
      ...valid,
      status: 'active',
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  async updateSubscriptionState(
    uid: string,
    current: SubscriptionItem,
    patch: Partial<Pick<SubscriptionItem, 'status' | 'nextBillingDate' | 'linkedReminderId'>>
  ): Promise<void> {
    const path = `users/${uid}/subscriptions/${current.id}`;
    const updateData: Record<string, unknown> = {
      version: current.version + 1,
      updatedAt: serverTimestamp(),
    };
    if (patch.status !== undefined) updateData.status = patch.status;
    if (patch.nextBillingDate !== undefined) updateData.nextBillingDate = patch.nextBillingDate;
    if (patch.linkedReminderId !== undefined) updateData.linkedReminderId = patch.linkedReminderId;

    try {
      await updateDoc(doc(db, 'users', uid, 'subscriptions', current.id), updateData);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async deleteSubscription(uid: string, sub: SubscriptionItem): Promise<void> {
    const path = `users/${uid}/subscriptions/${sub.id}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'subscriptions', sub.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async restoreSubscription(uid: string, sub: SubscriptionItem): Promise<void> {
    const path = `users/${uid}/subscriptions/${sub.id}`;
    const payload: Record<string, unknown> = {
      uid,
      name: sub.name,
      amountMinor: sub.amountMinor,
      currency: sub.currency,
      cadence: sub.cadence,
      nextBillingDate: sub.nextBillingDate,
      category: sub.category,
      status: sub.status,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (sub.linkedReminderId) payload.linkedReminderId = sub.linkedReminderId;
    if (sub.note) payload.note = sub.note;

    try {
      await setDoc(doc(db, 'users', uid, 'subscriptions', sub.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }
}

export class LocalOfflineFinanceRepository implements FinanceRepository {
  private readKey<T>(key: string): T[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private writeKey<T>(key: string, items: T[]): void {
    localStorage.setItem(key, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(FINANCE_EVENT));
  }

  subscribeTransactions(_uid: string, onData: (txs: TransactionItem[]) => void): () => void {
    const emit = () =>
      onData(
        this.readKey<TransactionItem>(LOCAL_TXS_KEY).sort((a, b) =>
          b.occurredOn.localeCompare(a.occurredOn)
        )
      );
    emit();
    window.addEventListener(FINANCE_EVENT, emit);
    window.addEventListener('storage', emit);
    return () => {
      window.removeEventListener(FINANCE_EVENT, emit);
      window.removeEventListener('storage', emit);
    };
  }

  subscribeBudgets(_uid: string, onData: (budgets: BudgetLimit[]) => void): () => void {
    const emit = () => onData(this.readKey<BudgetLimit>(LOCAL_BUDGETS_KEY));
    emit();
    window.addEventListener(FINANCE_EVENT, emit);
    window.addEventListener('storage', emit);
    return () => {
      window.removeEventListener(FINANCE_EVENT, emit);
      window.removeEventListener('storage', emit);
    };
  }

  subscribeSubscriptions(_uid: string, onData: (subs: SubscriptionItem[]) => void): () => void {
    const emit = () => onData(this.readKey<SubscriptionItem>(LOCAL_SUBS_KEY));
    emit();
    window.addEventListener(FINANCE_EVENT, emit);
    window.addEventListener('storage', emit);
    return () => {
      window.removeEventListener(FINANCE_EVENT, emit);
      window.removeEventListener('storage', emit);
    };
  }

  async createTransaction(uid: string, input: CreateTransactionInput): Promise<TransactionItem> {
    const valid = CreateTransactionInputSchema.parse(input);
    const nowIso = new Date().toISOString();
    const item: TransactionItem = {
      id: makeId('tx'),
      uid,
      ...valid,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.writeKey(LOCAL_TXS_KEY, [item, ...this.readKey<TransactionItem>(LOCAL_TXS_KEY)]);
    return item;
  }

  async deleteTransaction(_uid: string, tx: TransactionItem): Promise<void> {
    this.writeKey(
      LOCAL_TXS_KEY,
      this.readKey<TransactionItem>(LOCAL_TXS_KEY).filter((t) => t.id !== tx.id)
    );
  }

  async restoreTransaction(_uid: string, tx: TransactionItem): Promise<void> {
    const list = this.readKey<TransactionItem>(LOCAL_TXS_KEY).filter((t) => t.id !== tx.id);
    this.writeKey(LOCAL_TXS_KEY, [tx, ...list]);
  }

  async upsertBudget(
    uid: string,
    existing: BudgetLimit | null,
    input: UpsertBudgetInput
  ): Promise<BudgetLimit> {
    const valid = UpsertBudgetInputSchema.parse(input);
    const nowIso = new Date().toISOString();
    const list = this.readKey<BudgetLimit>(LOCAL_BUDGETS_KEY);
    const match = existing ?? list.find((b) => b.category === valid.category) ?? null;
    const item: BudgetLimit = {
      id: match?.id ?? `budget_${valid.category}`,
      uid,
      ...valid,
      version: match ? match.version + 1 : 1,
      createdAt: match?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    const next = [...list.filter((b) => b.id !== item.id), item];
    this.writeKey(LOCAL_BUDGETS_KEY, next);
    return item;
  }

  async deleteBudget(_uid: string, budgetId: string): Promise<void> {
    this.writeKey(
      LOCAL_BUDGETS_KEY,
      this.readKey<BudgetLimit>(LOCAL_BUDGETS_KEY).filter((b) => b.id !== budgetId)
    );
  }

  async createSubscription(
    uid: string,
    input: CreateSubscriptionInput
  ): Promise<SubscriptionItem> {
    const valid = CreateSubscriptionInputSchema.parse(input);
    const nowIso = new Date().toISOString();
    const item: SubscriptionItem = {
      id: makeId('sub'),
      uid,
      ...valid,
      status: 'active',
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.writeKey(LOCAL_SUBS_KEY, [item, ...this.readKey<SubscriptionItem>(LOCAL_SUBS_KEY)]);
    return item;
  }

  async updateSubscriptionState(
    _uid: string,
    current: SubscriptionItem,
    patch: Partial<Pick<SubscriptionItem, 'status' | 'nextBillingDate' | 'linkedReminderId'>>
  ): Promise<void> {
    const next = this.readKey<SubscriptionItem>(LOCAL_SUBS_KEY).map((s) =>
      s.id === current.id
        ? { ...s, ...patch, version: s.version + 1, updatedAt: new Date().toISOString() }
        : s
    );
    this.writeKey(LOCAL_SUBS_KEY, next);
  }

  async deleteSubscription(_uid: string, sub: SubscriptionItem): Promise<void> {
    this.writeKey(
      LOCAL_SUBS_KEY,
      this.readKey<SubscriptionItem>(LOCAL_SUBS_KEY).filter((s) => s.id !== sub.id)
    );
  }

  async restoreSubscription(_uid: string, sub: SubscriptionItem): Promise<void> {
    const list = this.readKey<SubscriptionItem>(LOCAL_SUBS_KEY).filter((s) => s.id !== sub.id);
    this.writeKey(LOCAL_SUBS_KEY, [sub, ...list]);
  }
}

export const firebaseFinanceRepository = new FirebaseWebFinanceRepository();
export const localFinanceRepository = new LocalOfflineFinanceRepository();

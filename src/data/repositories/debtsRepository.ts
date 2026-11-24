import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseClient';
import {
  CreateDebtInputSchema,
  DebtLedgerSchema,
  DebtPaymentSchema,
  DebtRecordSchema,
  generateSafeEntityId,
  normalizePersonKey,
  RecordPaymentInputSchema,
  type CreateDebtInput,
  type DebtLedger,
  type DebtPayment,
  type DebtRecord,
  type RecordPaymentInput,
} from '../../core/debts/debtSchemas';
import {
  computeEffectiveStatus,
  computePaymentTransition,
  getTodayYmd,
} from '../../core/debts/debtEngine';
import type { DebtsRepository } from './interfaces';

function tsToIso(val: unknown): string | undefined {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string') return val;
  return undefined;
}

/**
 * Cloud Firestore Web Adapter for Phase 2 Debts Manager.
 * Enforces strict Zod validation prior to writes, atomic batch updates for payments & ledgers,
 * and structured error surfacing via handleFirestoreError.
 */
export class FirebaseWebDebtsRepository implements DebtsRepository {
  subscribeDebts(
    uid: string,
    onData: (debts: DebtRecord[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/debts`;
    const q = query(collection(db, 'users', uid, 'debts'), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const items: DebtRecord[] = [];
        for (const d of snap.docs) {
          const raw = d.data();
          const parsed = DebtRecordSchema.safeParse({
            id: d.id,
            uid: raw.uid,
            direction: raw.direction,
            personKey: raw.personKey,
            personName: raw.personName,
            personPhone: raw.personPhone,
            category: raw.category ?? 'personal',
            principalMinor: raw.principalMinor,
            remainingMinor: raw.remainingMinor,
            currency: raw.currency,
            interestRateBps: raw.interestRateBps ?? 0,
            dueDate: raw.dueDate,
            status: raw.status,
            notes: raw.notes,
            paymentCount: raw.paymentCount ?? 0,
            lastPaymentDate: raw.lastPaymentDate,
            version: raw.version ?? 1,
            createdAtIso: tsToIso(raw.createdAt),
            updatedAtIso: tsToIso(raw.updatedAt),
          });
          if (parsed.success) items.push(parsed.data);
        }
        items.sort((a, b) => (b.updatedAtIso ?? '').localeCompare(a.updatedAtIso ?? ''));
        onData(items);
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
  }

  subscribeLedgers(
    uid: string,
    onData: (ledgers: Record<string, DebtLedger>) => void,
    onError?: (err: Error) => void
  ): () => void {
    const path = `users/${uid}/debtLedgers`;
    const q = query(collection(db, 'users', uid, 'debtLedgers'), where('uid', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const result: Record<string, DebtLedger> = {};
        for (const d of snap.docs) {
          const raw = d.data();
          const parsed = DebtLedgerSchema.safeParse({
            personKey: d.id,
            uid: raw.uid,
            personName: raw.personName,
            personPhone: raw.personPhone,
            onTimeCount: raw.onTimeCount ?? 0,
            lateCount: raw.lateCount ?? 0,
            activeDebtCount: raw.activeDebtCount ?? 0,
            version: raw.version ?? 1,
          });
          if (parsed.success) result[d.id] = parsed.data;
        }
        onData(result);
      },
      (err) => {
        if (onError) onError(err);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );
  }

  async createDebt(uid: string, input: CreateDebtInput): Promise<DebtRecord> {
    const validatedInput = CreateDebtInputSchema.parse(input);
    const id = generateSafeEntityId('debt');
    const personKey = normalizePersonKey(validatedInput.personName);
    const today = getTodayYmd();

    const provisional: DebtRecord = {
      id,
      uid,
      direction: validatedInput.direction,
      personKey,
      personName: validatedInput.personName,
      personPhone: validatedInput.personPhone || undefined,
      category: validatedInput.category,
      principalMinor: validatedInput.principalMinor,
      remainingMinor: validatedInput.principalMinor,
      currency: validatedInput.currency,
      interestRateBps: validatedInput.interestRateBps,
      dueDate: validatedInput.dueDate || undefined,
      status: validatedInput.dueDate && validatedInput.dueDate < today ? 'overdue' : 'active',
      notes: validatedInput.notes || undefined,
      paymentCount: 0,
      version: 1,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    };
    const validated = DebtRecordSchema.parse(provisional);

    const debtPath = `users/${uid}/debts/${id}`;
    const debtRef = doc(db, 'users', uid, 'debts', id);
    const ledgerRef = doc(db, 'users', uid, 'debtLedgers', personKey);

    try {
      const ledgerSnap = await getDoc(ledgerRef);
      const batch = writeBatch(db);

      const firestoreDebtPayload: Record<string, unknown> = {
        uid,
        direction: validated.direction,
        personKey: validated.personKey,
        personName: validated.personName,
        category: validated.category,
        principalMinor: validated.principalMinor,
        remainingMinor: validated.remainingMinor,
        currency: validated.currency,
        interestRateBps: validated.interestRateBps,
        status: validated.status,
        paymentCount: 0,
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (validated.personPhone) firestoreDebtPayload.personPhone = validated.personPhone;
      if (validated.dueDate) firestoreDebtPayload.dueDate = validated.dueDate;
      if (validated.notes) firestoreDebtPayload.notes = validated.notes;

      batch.set(debtRef, firestoreDebtPayload);

      if (ledgerSnap.exists()) {
        const cur = ledgerSnap.data();
        const ledgerUpdate: Record<string, unknown> = {
          personName: validated.personName,
          activeDebtCount: Number(cur.activeDebtCount ?? 0) + 1,
          version: Number(cur.version ?? 1) + 1,
          updatedAt: serverTimestamp(),
        };
        if (validated.personPhone) ledgerUpdate.personPhone = validated.personPhone;
        batch.update(ledgerRef, ledgerUpdate);
      } else {
        const ledgerCreate: Record<string, unknown> = {
          uid,
          personName: validated.personName,
          onTimeCount: 0,
          lateCount: 0,
          activeDebtCount: 1,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (validated.personPhone) ledgerCreate.personPhone = validated.personPhone;
        batch.set(ledgerRef, ledgerCreate);
      }

      await batch.commit();
      return validated;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, debtPath);
    }
  }

  async updateDebtMeta(
    uid: string,
    current: DebtRecord,
    patch: Partial<
      Pick<DebtRecord, 'personName' | 'personPhone' | 'category' | 'interestRateBps' | 'dueDate' | 'notes'>
    >
  ): Promise<void> {
    if (current.status === 'settled') {
      throw new Error('Settled debts are locked and cannot be edited.');
    }
    const nextDue = patch.dueDate !== undefined ? patch.dueDate || undefined : current.dueDate;
    const candidate: DebtRecord = {
      ...current,
      personName: patch.personName !== undefined ? patch.personName.trim() : current.personName,
      personPhone: patch.personPhone !== undefined ? patch.personPhone.trim() || undefined : current.personPhone,
      category: patch.category ?? current.category,
      interestRateBps: patch.interestRateBps ?? current.interestRateBps,
      dueDate: nextDue,
      notes: patch.notes !== undefined ? patch.notes.trim() || undefined : current.notes,
      version: current.version + 1,
    };
    candidate.status = computeEffectiveStatus(candidate);
    const validated = DebtRecordSchema.parse(candidate);

    const path = `users/${uid}/debts/${current.id}`;
    const ref = doc(db, 'users', uid, 'debts', current.id);
    const updatePayload: Record<string, unknown> = {
      personName: validated.personName,
      personPhone: validated.personPhone ? validated.personPhone : deleteField(),
      category: validated.category,
      interestRateBps: validated.interestRateBps,
      dueDate: validated.dueDate ? validated.dueDate : deleteField(),
      status: validated.status,
      notes: validated.notes ? validated.notes : deleteField(),
      version: validated.version,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(ref, updatePayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  async recordPayment(uid: string, debt: DebtRecord, input: RecordPaymentInput): Promise<DebtPayment> {
    const validatedInput = RecordPaymentInputSchema.parse(input);
    const transition = computePaymentTransition(debt, validatedInput.amountMinor, validatedInput.paidOn);
    const paymentId = generateSafeEntityId('pay');

    const paymentObj: DebtPayment = DebtPaymentSchema.parse({
      id: paymentId,
      uid,
      debtId: debt.id,
      amountMinor: validatedInput.amountMinor,
      currency: debt.currency,
      paidOn: validatedInput.paidOn,
      method: validatedInput.method,
      note: validatedInput.note?.trim() || undefined,
      wasOnTime: transition.wasOnTime,
      createdAtIso: new Date().toISOString(),
    });

    const path = `users/${uid}/debts/${debt.id}/payments/${paymentId}`;
    const debtRef = doc(db, 'users', uid, 'debts', debt.id);
    const payRef = doc(db, 'users', uid, 'debts', debt.id, 'payments', paymentId);
    const ledgerRef = doc(db, 'users', uid, 'debtLedgers', debt.personKey);

    try {
      const ledgerSnap = await getDoc(ledgerRef);
      const batch = writeBatch(db);

      const payPayload: Record<string, unknown> = {
        uid,
        debtId: debt.id,
        amountMinor: paymentObj.amountMinor,
        currency: paymentObj.currency,
        paidOn: paymentObj.paidOn,
        method: paymentObj.method,
        wasOnTime: paymentObj.wasOnTime,
        createdAt: serverTimestamp(),
      };
      if (paymentObj.note) payPayload.note = paymentObj.note;

      batch.set(payRef, payPayload);
      batch.update(debtRef, {
        remainingMinor: transition.nextRemainingMinor,
        status: transition.nextStatus,
        paymentCount: transition.nextPaymentCount,
        lastPaymentDate: paymentObj.paidOn,
        version: debt.version + 1,
        updatedAt: serverTimestamp(),
      });

      if (ledgerSnap.exists()) {
        const cur = ledgerSnap.data();
        const activeDelta = transition.nextStatus === 'settled' ? -1 : 0;
        batch.update(ledgerRef, {
          onTimeCount: Number(cur.onTimeCount ?? 0) + (transition.wasOnTime ? 1 : 0),
          lateCount: Number(cur.lateCount ?? 0) + (transition.wasOnTime ? 0 : 1),
          activeDebtCount: Math.max(0, Number(cur.activeDebtCount ?? 0) + activeDelta),
          version: Number(cur.version ?? 1) + 1,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      return paymentObj;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  async deleteDebt(uid: string, debt: DebtRecord): Promise<void> {
    const path = `users/${uid}/debts/${debt.id}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'debts', debt.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async restoreDebt(uid: string, debt: DebtRecord): Promise<void> {
    const validated = DebtRecordSchema.parse({ ...debt, uid, version: 1 });
    const path = `users/${uid}/debts/${validated.id}`;
    const payload: Record<string, unknown> = {
      uid,
      direction: validated.direction,
      personKey: validated.personKey,
      personName: validated.personName,
      category: validated.category,
      principalMinor: validated.principalMinor,
      remainingMinor: validated.remainingMinor,
      currency: validated.currency,
      interestRateBps: validated.interestRateBps,
      status: validated.status,
      paymentCount: validated.paymentCount,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (validated.personPhone) payload.personPhone = validated.personPhone;
    if (validated.dueDate) payload.dueDate = validated.dueDate;
    if (validated.notes) payload.notes = validated.notes;
    if (validated.lastPaymentDate) payload.lastPaymentDate = validated.lastPaymentDate;

    try {
      await setDoc(doc(db, 'users', uid, 'debts', validated.id), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  async listPayments(uid: string, debtId: string): Promise<DebtPayment[]> {
    const path = `users/${uid}/debts/${debtId}/payments`;
    try {
      const q = query(
        collection(db, 'users', uid, 'debts', debtId, 'payments'),
        where('uid', '==', uid),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const list: DebtPayment[] = [];
      for (const d of snap.docs) {
        const raw = d.data();
        const parsed = DebtPaymentSchema.safeParse({
          id: d.id,
          uid: raw.uid,
          debtId: raw.debtId,
          amountMinor: raw.amountMinor,
          currency: raw.currency,
          paidOn: raw.paidOn,
          method: raw.method,
          note: raw.note,
          wasOnTime: Boolean(raw.wasOnTime),
          createdAtIso: tsToIso(raw.createdAt),
        });
        if (parsed.success) list.push(parsed.data);
      }
      return list;
    } catch (err) {
      // Fallback without orderBy index if composite index isn't deployed yet
      try {
        const qSimple = query(
          collection(db, 'users', uid, 'debts', debtId, 'payments'),
          where('uid', '==', uid)
        );
        const snap = await getDocs(qSimple);
        const list: DebtPayment[] = [];
        for (const d of snap.docs) {
          const raw = d.data();
          const parsed = DebtPaymentSchema.safeParse({
            id: d.id,
            uid: raw.uid,
            debtId: raw.debtId,
            amountMinor: raw.amountMinor,
            currency: raw.currency,
            paidOn: raw.paidOn,
            method: raw.method,
            note: raw.note,
            wasOnTime: Boolean(raw.wasOnTime),
            createdAtIso: tsToIso(raw.createdAt),
          });
          if (parsed.success) list.push(parsed.data);
        }
        return list.sort((a, b) => b.paidOn.localeCompare(a.paidOn));
      } catch (innerErr) {
        handleFirestoreError(innerErr, OperationType.LIST, path);
      }
    }
  }
}

/**
 * Local Offline Adapter for Stage 0 unauthenticated / airplane-mode personal workspace.
 * Mirrors the exact same DebtsRepository contract with reactive subscriber notifications.
 */
interface LocalDebtsStoreShape {
  debts: DebtRecord[];
  ledgers: Record<string, DebtLedger>;
  paymentsByDebt: Record<string, DebtPayment[]>;
}

const LOCAL_DEBTS_STORAGE_KEY = 'lifeos_local_debts_v1';

class LocalOfflineDebtsRepository implements DebtsRepository {
  private debtListeners = new Set<(debts: DebtRecord[]) => void>();
  private ledgerListeners = new Set<(ledgers: Record<string, DebtLedger>) => void>();

  private readStore(): LocalDebtsStoreShape {
    try {
      const raw = localStorage.getItem(LOCAL_DEBTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LocalDebtsStoreShape>;
        return {
          debts: Array.isArray(parsed.debts) ? parsed.debts : [],
          ledgers: parsed.ledgers ?? {},
          paymentsByDebt: parsed.paymentsByDebt ?? {},
        };
      }
    } catch {
      // Ignore storage read failure
    }
    return { debts: [], ledgers: {}, paymentsByDebt: {} };
  }

  private writeStore(next: LocalDebtsStoreShape): void {
    try {
      localStorage.setItem(LOCAL_DEBTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
    for (const cb of this.debtListeners) cb(next.debts);
    for (const cb of this.ledgerListeners) cb(next.ledgers);
  }

  subscribeDebts(
    _uid: string,
    onData: (debts: DebtRecord[]) => void
  ): () => void {
    this.debtListeners.add(onData);
    onData(this.readStore().debts);
    return () => {
      this.debtListeners.delete(onData);
    };
  }

  subscribeLedgers(
    _uid: string,
    onData: (ledgers: Record<string, DebtLedger>) => void
  ): () => void {
    this.ledgerListeners.add(onData);
    onData(this.readStore().ledgers);
    return () => {
      this.ledgerListeners.delete(onData);
    };
  }

  async createDebt(uid: string, input: CreateDebtInput): Promise<DebtRecord> {
    const validatedInput = CreateDebtInputSchema.parse(input);
    const id = generateSafeEntityId('debt');
    const personKey = normalizePersonKey(validatedInput.personName);
    const nowIso = new Date().toISOString();
    const today = getTodayYmd();

    const record: DebtRecord = DebtRecordSchema.parse({
      id,
      uid,
      direction: validatedInput.direction,
      personKey,
      personName: validatedInput.personName,
      personPhone: validatedInput.personPhone || undefined,
      category: validatedInput.category,
      principalMinor: validatedInput.principalMinor,
      remainingMinor: validatedInput.principalMinor,
      currency: validatedInput.currency,
      interestRateBps: validatedInput.interestRateBps,
      dueDate: validatedInput.dueDate || undefined,
      status: validatedInput.dueDate && validatedInput.dueDate < today ? 'overdue' : 'active',
      notes: validatedInput.notes || undefined,
      paymentCount: 0,
      version: 1,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    });

    const store = this.readStore();
    const curLedger = store.ledgers[personKey];
    const nextLedger: DebtLedger = {
      personKey,
      uid,
      personName: record.personName,
      personPhone: record.personPhone ?? curLedger?.personPhone,
      onTimeCount: curLedger?.onTimeCount ?? 0,
      lateCount: curLedger?.lateCount ?? 0,
      activeDebtCount: (curLedger?.activeDebtCount ?? 0) + 1,
      version: (curLedger?.version ?? 0) + 1,
    };

    this.writeStore({
      debts: [record, ...store.debts],
      ledgers: { ...store.ledgers, [personKey]: nextLedger },
      paymentsByDebt: store.paymentsByDebt,
    });

    return record;
  }

  async updateDebtMeta(
    _uid: string,
    current: DebtRecord,
    patch: Partial<
      Pick<DebtRecord, 'personName' | 'personPhone' | 'category' | 'interestRateBps' | 'dueDate' | 'notes'>
    >
  ): Promise<void> {
    if (current.status === 'settled') {
      throw new Error('Settled debts are locked and cannot be edited.');
    }
    const store = this.readStore();
    const updated: DebtRecord = {
      ...current,
      personName: patch.personName !== undefined ? patch.personName.trim() : current.personName,
      personPhone: patch.personPhone !== undefined ? patch.personPhone.trim() || undefined : current.personPhone,
      category: patch.category ?? current.category,
      interestRateBps: patch.interestRateBps ?? current.interestRateBps,
      dueDate: patch.dueDate !== undefined ? patch.dueDate || undefined : current.dueDate,
      notes: patch.notes !== undefined ? patch.notes.trim() || undefined : current.notes,
      version: current.version + 1,
      updatedAtIso: new Date().toISOString(),
    };
    updated.status = computeEffectiveStatus(updated);
    const validated = DebtRecordSchema.parse(updated);

    this.writeStore({
      ...store,
      debts: store.debts.map((d) => (d.id === current.id ? validated : d)),
    });
  }

  async recordPayment(uid: string, debt: DebtRecord, input: RecordPaymentInput): Promise<DebtPayment> {
    const validatedInput = RecordPaymentInputSchema.parse(input);
    const transition = computePaymentTransition(debt, validatedInput.amountMinor, validatedInput.paidOn);
    const payment: DebtPayment = DebtPaymentSchema.parse({
      id: generateSafeEntityId('pay'),
      uid,
      debtId: debt.id,
      amountMinor: validatedInput.amountMinor,
      currency: debt.currency,
      paidOn: validatedInput.paidOn,
      method: validatedInput.method,
      note: validatedInput.note?.trim() || undefined,
      wasOnTime: transition.wasOnTime,
      createdAtIso: new Date().toISOString(),
    });

    const store = this.readStore();
    const nextDebt: DebtRecord = {
      ...debt,
      remainingMinor: transition.nextRemainingMinor,
      status: transition.nextStatus,
      paymentCount: transition.nextPaymentCount,
      lastPaymentDate: payment.paidOn,
      version: debt.version + 1,
      updatedAtIso: new Date().toISOString(),
    };

    const curLedger = store.ledgers[debt.personKey] ?? {
      personKey: debt.personKey,
      uid,
      personName: debt.personName,
      personPhone: debt.personPhone,
      onTimeCount: 0,
      lateCount: 0,
      activeDebtCount: 1,
      version: 1,
    };

    const nextLedger: DebtLedger = {
      ...curLedger,
      onTimeCount: curLedger.onTimeCount + (transition.wasOnTime ? 1 : 0),
      lateCount: curLedger.lateCount + (transition.wasOnTime ? 0 : 1),
      activeDebtCount: Math.max(0, curLedger.activeDebtCount - (transition.nextStatus === 'settled' ? 1 : 0)),
      version: curLedger.version + 1,
    };

    const existingPays = store.paymentsByDebt[debt.id] ?? [];
    this.writeStore({
      debts: store.debts.map((d) => (d.id === debt.id ? nextDebt : d)),
      ledgers: { ...store.ledgers, [debt.personKey]: nextLedger },
      paymentsByDebt: {
        ...store.paymentsByDebt,
        [debt.id]: [payment, ...existingPays],
      },
    });

    return payment;
  }

  async deleteDebt(_uid: string, debt: DebtRecord): Promise<void> {
    const store = this.readStore();
    this.writeStore({
      ...store,
      debts: store.debts.filter((d) => d.id !== debt.id),
    });
  }

  async restoreDebt(_uid: string, debt: DebtRecord): Promise<void> {
    const store = this.readStore();
    if (store.debts.some((d) => d.id === debt.id)) return;
    this.writeStore({
      ...store,
      debts: [debt, ...store.debts],
    });
  }

  async listPayments(_uid: string, debtId: string): Promise<DebtPayment[]> {
    return this.readStore().paymentsByDebt[debtId] ?? [];
  }
}

export const firebaseDebtsRepository: DebtsRepository = new FirebaseWebDebtsRepository();
export const localDebtsRepository: DebtsRepository = new LocalOfflineDebtsRepository();

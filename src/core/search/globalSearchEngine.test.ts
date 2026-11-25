import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FX_RATES_TO_IQD } from '../currency/currency';
import {
  executeWorkspaceAiTool,
  searchWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from './globalSearchEngine';

function makeSnapshot(): WorkspaceSnapshot {
  return {
    primaryCurrency: 'IQD',
    locale: 'en',
    fxRates: DEFAULT_FX_RATES_TO_IQD,
    todayYmd: '2026-11-24',
    debts: [
      {
        id: 'd1',
        uid: 'u1',
        direction: 'owed_to_me',
        personKey: 'ali_hassan',
        personName: 'Ali Hassan',
        category: 'personal',
        principalMinor: 500000,
        remainingMinor: 250000,
        currency: 'IQD',
        status: 'partial',
        paymentCount: 1,
        version: 2,
        createdAtIso: '2026-10-01T00:00:00.000Z',
        updatedAtIso: '2026-11-01T00:00:00.000Z',
      },
    ],
    reminders: [],
    tasks: [],
    notes: [
      {
        id: 'n1',
        uid: 'u1',
        title: 'Secret Recovery Plan',
        content: '{"alg":"AES-256-GCM","iv":"abc","ct":"ciphertext"}',
        tags: [],
        isEncrypted: true,
        isLocked: true,
        pinned: false,
        wordCount: 0,
        version: 1,
        createdAtIso: '2026-11-01T00:00:00.000Z',
        updatedAtIso: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'n2',
        uid: 'u1',
        title: 'Grocery List',
        content: 'Buy olive oil and coffee beans',
        tags: ['home'],
        isEncrypted: false,
        isLocked: false,
        pinned: true,
        wordCount: 6,
        version: 1,
        createdAtIso: '2026-11-01T00:00:00.000Z',
        updatedAtIso: '2026-11-01T00:00:00.000Z',
      },
    ],
    vaultDocs: [
      {
        id: 'v1',
        uid: 'u1',
        title: 'Iraqi Passport',
        docType: 'passport',
        storageMode: 'local_only',
        mimeType: 'application/pdf',
        sizeBytes: 12000,
        pageCount: 1,
        expiryDate: '2026-12-15',
        tags: [],
        isEncrypted: false,
        isLocked: false,
        version: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    habits: [
      {
        id: 'h1',
        uid: 'u1',
        name: 'Morning Walk',
        category: 'fitness',
        frequency: 'daily',
        targetPerWeek: 7,
        currentStreak: 3,
        bestStreak: 5,
        totalCompletions: 12,
        archived: false,
        version: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
    ],
    habitLogs: [
      {
        id: 'h1_2026_11',
        uid: 'u1',
        habitId: 'h1',
        monthKey: '2026-11',
        days: ['2026-11-22', '2026-11-23', '2026-11-24'],
        version: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
    ],
    transactions: [
      {
        id: 'tx1',
        uid: 'u1',
        type: 'expense',
        amountMinor: 15000,
        currency: 'IQD',
        category: 'food',
        occurredOn: '2026-11-20',
        merchant: 'Baghdad Coffee',
        account: 'cash',
        isRecurring: false,
        version: 1,
        createdAt: '2026-11-20T00:00:00.000Z',
        updatedAt: '2026-11-20T00:00:00.000Z',
      },
    ],
    budgets: [],
    subscriptions: [],
  };
}

test('Offline global search finds across modules while cloud AI tool strictly redacts Vault & E2E locked notes', () => {
  const snap = makeSnapshot();

  // Offline search finds Vault Passport & coffee across Notes + Finance
  const localPassport = searchWorkspaceSnapshot(snap, 'Passport', { forCloudAiTool: false });
  assert.equal(localPassport.length, 1);
  assert.equal(localPassport[0].module, 'vault');

  const coffeeHits = searchWorkspaceSnapshot(snap, 'coffee', { forCloudAiTool: false });
  assert.equal(coffeeHits.length, 2);

  // Cloud AI tool search MUST exclude Vault documents and E2E locked notes
  const aiPassport = searchWorkspaceSnapshot(snap, 'Passport', { forCloudAiTool: true });
  assert.equal(aiPassport.length, 0);

  const aiSecret = searchWorkspaceSnapshot(snap, 'Secret', { forCloudAiTool: true });
  assert.equal(aiSecret.length, 0);

  // Deterministic financial & habit AI tools return aggregated non-sensitive summaries
  const finTool = executeWorkspaceAiTool('get_financial_snapshot', {}, snap);
  assert.equal(finTool.openDebtsCount, 1);
  assert.equal(finTool.primaryCurrency, 'IQD');

  const habitTool = executeWorkspaceAiTool('get_habit_consistency', {}, snap);
  const overview = habitTool.overview as { activeCount: number; completedTodayCount: number };
  assert.equal(overview.activeCount, 1);
  assert.equal(overview.completedTodayCount, 1);
});

import type { UserProfileData } from '../../core/schemas/userProfileSchema';
import type { PlanEntitlements } from '../../core/entitlements/entitlements';

export interface AuthUserSummary {
  uid: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  photoURL: string | null;
}

export interface AuthRepository {
  onAuthStateChanged(callback: (user: AuthUserSummary | null) => void): () => void;
  signInWithGoogle(): Promise<AuthUserSummary>;
  signInWithApple(): Promise<AuthUserSummary>;
  signOut(): Promise<void>;
}

export interface UserProfileRepository {
  subscribeProfile(
    uid: string,
    onData: (profile: UserProfileData) => void,
    onError?: (err: Error) => void
  ): () => void;
  ensureProfile(user: AuthUserSummary): Promise<UserProfileData>;
  updateProfile(uid: string, current: UserProfileData, patch: Partial<UserProfileData>): Promise<void>;
  subscribeEntitlements(
    uid: string,
    onData: (entitlements: PlanEntitlements) => void
  ): () => void;
}

export interface AiUsageRecord {
  dayKey: string;
  requestCount: number;
  inputTokensEst: number;
  outputTokensEst: number;
}

export interface AiUsageRepository {
  subscribeTodayUsage(uid: string, dayKey: string, onData: (usage: AiUsageRecord) => void): () => void;
  recordUsage(
    uid: string,
    dayKey: string,
    current: AiUsageRecord | null,
    inputTokensEst: number,
    outputTokensEst: number
  ): Promise<void>;
}

export interface LocalVaultEntryMeta {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isEncrypted: boolean;
  savedAt: string;
}

export interface LocalVaultStorageAdapter {
  listLocalEntries(): Promise<LocalVaultEntryMeta[]>;
  saveLocalEntry(meta: LocalVaultEntryMeta, payload: string): Promise<void>;
  removeLocalEntry(id: string): Promise<void>;
}

export interface DebtsRepository {
  subscribeDebts(
    uid: string,
    onData: (debts: import('../../core/debts/debtSchemas').DebtRecord[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  subscribeLedgers(
    uid: string,
    onData: (ledgers: Record<string, import('../../core/debts/debtSchemas').DebtLedger>) => void,
    onError?: (err: Error) => void
  ): () => void;
  createDebt(
    uid: string,
    input: import('../../core/debts/debtSchemas').CreateDebtInput
  ): Promise<import('../../core/debts/debtSchemas').DebtRecord>;
  updateDebtMeta(
    uid: string,
    current: import('../../core/debts/debtSchemas').DebtRecord,
    patch: Partial<
      Pick<
        import('../../core/debts/debtSchemas').DebtRecord,
        'personName' | 'personPhone' | 'category' | 'interestRateBps' | 'dueDate' | 'notes'
      >
    >
  ): Promise<void>;
  recordPayment(
    uid: string,
    debt: import('../../core/debts/debtSchemas').DebtRecord,
    input: import('../../core/debts/debtSchemas').RecordPaymentInput
  ): Promise<import('../../core/debts/debtSchemas').DebtPayment>;
  deleteDebt(uid: string, debt: import('../../core/debts/debtSchemas').DebtRecord): Promise<void>;
  restoreDebt(uid: string, debt: import('../../core/debts/debtSchemas').DebtRecord): Promise<void>;
  listPayments(uid: string, debtId: string): Promise<import('../../core/debts/debtSchemas').DebtPayment[]>;
}

export interface RemindersRepository {
  subscribeReminders(
    uid: string,
    onData: (reminders: import('../../core/reminders/reminderSchemas').ReminderItem[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createReminder(
    uid: string,
    input: import('../../core/reminders/reminderSchemas').CreateReminderInput
  ): Promise<import('../../core/reminders/reminderSchemas').ReminderItem>;
  updateReminder(
    uid: string,
    current: import('../../core/reminders/reminderSchemas').ReminderItem,
    patch: Partial<
      Pick<
        import('../../core/reminders/reminderSchemas').ReminderItem,
        | 'title'
        | 'notes'
        | 'category'
        | 'priority'
        | 'dueAtIso'
        | 'rrule'
        | 'respectQuietHours'
        | 'linkedDebtId'
      >
    >
  ): Promise<void>;
  completeReminder(
    uid: string,
    current: import('../../core/reminders/reminderSchemas').ReminderItem
  ): Promise<{ advancedRecurring: boolean; nextDueAtIso: string }>;
  reopenReminder(
    uid: string,
    current: import('../../core/reminders/reminderSchemas').ReminderItem
  ): Promise<void>;
  snoozeReminder(
    uid: string,
    current: import('../../core/reminders/reminderSchemas').ReminderItem,
    snoozedUntilIso: string
  ): Promise<void>;
  deleteReminder(
    uid: string,
    reminder: import('../../core/reminders/reminderSchemas').ReminderItem
  ): Promise<void>;
  restoreReminder(
    uid: string,
    reminder: import('../../core/reminders/reminderSchemas').ReminderItem
  ): Promise<void>;
}

export interface PlannerRepository {
  subscribeTasks(
    uid: string,
    onData: (tasks: import('../../core/planner/plannerSchemas').TaskItem[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createTask(
    uid: string,
    input: import('../../core/planner/plannerSchemas').CreateTaskInput,
    sortKey: string
  ): Promise<import('../../core/planner/plannerSchemas').TaskItem>;
  reorderTask(
    uid: string,
    current: import('../../core/planner/plannerSchemas').TaskItem,
    nextSortKey: string,
    nextListId?: string
  ): Promise<void>;
  updateTaskStatusOrSubtasks(
    uid: string,
    current: import('../../core/planner/plannerSchemas').TaskItem,
    patch: {
      status?: import('../../core/planner/plannerSchemas').TaskStatus;
      subtasks?: import('../../core/planner/plannerSchemas').SubtaskItem[];
      completedAtIso?: string | null;
    }
  ): Promise<void>;
  updateTaskMeta(
    uid: string,
    current: import('../../core/planner/plannerSchemas').TaskItem,
    patch: Partial<
      Pick<
        import('../../core/planner/plannerSchemas').TaskItem,
        'listId' | 'title' | 'notes' | 'priority' | 'dueDate' | 'subtasks' | 'tags' | 'status'
      >
    >
  ): Promise<void>;
  deleteTask(uid: string, task: import('../../core/planner/plannerSchemas').TaskItem): Promise<void>;
  restoreTask(uid: string, task: import('../../core/planner/plannerSchemas').TaskItem): Promise<void>;
}

export interface NotesRepository {
  subscribeFolders(
    uid: string,
    onData: (folders: import('../../core/notes/noteSchemas').NoteFolder[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createFolder(
    uid: string,
    input: import('../../core/notes/noteSchemas').CreateFolderInput,
    sortKey: string
  ): Promise<import('../../core/notes/noteSchemas').NoteFolder>;
  deleteFolder(uid: string, folderId: string): Promise<void>;

  subscribeNotes(
    uid: string,
    onData: (notes: import('../../core/notes/noteSchemas').NoteItem[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createNote(
    uid: string,
    input: import('../../core/notes/noteSchemas').CreateNoteInput
  ): Promise<import('../../core/notes/noteSchemas').NoteItem>;
  updateNoteContent(
    uid: string,
    current: import('../../core/notes/noteSchemas').NoteItem,
    patch: {
      title?: string;
      content?: string;
      folderId?: string | null;
      tags?: string[];
      pinned?: boolean;
      wordCount?: number;
    },
    saveVersionSnapshot?: boolean
  ): Promise<void>;
  togglePinOrFolder(
    uid: string,
    current: import('../../core/notes/noteSchemas').NoteItem,
    patch: { pinned?: boolean; folderId?: string | null }
  ): Promise<void>;
  setNoteEncryptionState(
    uid: string,
    current: import('../../core/notes/noteSchemas').NoteItem,
    next: { content: string; isEncrypted: boolean; isLocked: boolean; wordCount: number }
  ): Promise<void>;
  deleteNote(uid: string, note: import('../../core/notes/noteSchemas').NoteItem): Promise<void>;
  restoreNote(uid: string, note: import('../../core/notes/noteSchemas').NoteItem): Promise<void>;
  listVersions(
    uid: string,
    noteId: string
  ): Promise<import('../../core/notes/noteSchemas').NoteVersion[]>;
}

export interface VaultRepository {
  subscribeFolders(
    uid: string,
    onData: (folders: import('../../core/vault/vaultSchemas').VaultFolder[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createFolder(
    uid: string,
    input: import('../../core/vault/vaultSchemas').CreateVaultFolderInput,
    sortKey: string
  ): Promise<import('../../core/vault/vaultSchemas').VaultFolder>;
  deleteFolder(uid: string, folderId: string): Promise<void>;

  subscribeDocuments(
    uid: string,
    onData: (docs: import('../../core/vault/vaultSchemas').VaultDocumentMeta[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createDocument(
    uid: string,
    input: import('../../core/vault/vaultSchemas').CreateVaultDocumentInput
  ): Promise<import('../../core/vault/vaultSchemas').VaultDocumentMeta>;
  updateDocumentMeta(
    uid: string,
    current: import('../../core/vault/vaultSchemas').VaultDocumentMeta,
    patch: {
      folderId?: string | null;
      title?: string;
      docType?: import('../../core/vault/vaultSchemas').VaultDocType;
      expiryDate?: string | null;
      issuer?: string | null;
      documentNumberLast4?: string | null;
      tags?: string[];
      notes?: string | null;
      ocrText?: string | null;
      linkedReminderId?: string | null;
    }
  ): Promise<void>;
  setDocumentSecurityState(
    uid: string,
    current: import('../../core/vault/vaultSchemas').VaultDocumentMeta,
    next: {
      storageMode: import('../../core/vault/vaultSchemas').VaultStorageMode;
      isEncrypted: boolean;
      isLocked: boolean;
      sizeBytes: number;
      mimeType: string;
      pageCount: number;
      localFileKey?: string;
    }
  ): Promise<void>;
  deleteDocument(
    uid: string,
    doc: import('../../core/vault/vaultSchemas').VaultDocumentMeta
  ): Promise<void>;
  restoreDocument(
    uid: string,
    doc: import('../../core/vault/vaultSchemas').VaultDocumentMeta
  ): Promise<void>;
}

export interface HabitsRepository {
  subscribeHabits(
    uid: string,
    onData: (habits: import('../../core/habits/habitSchemas').HabitItem[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  subscribeHabitLogs(
    uid: string,
    onData: (logs: import('../../core/habits/habitSchemas').HabitMonthLog[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createHabit(
    uid: string,
    input: import('../../core/habits/habitSchemas').CreateHabitInput
  ): Promise<import('../../core/habits/habitSchemas').HabitItem>;
  updateHabitMeta(
    uid: string,
    current: import('../../core/habits/habitSchemas').HabitItem,
    patch: Partial<
      Pick<
        import('../../core/habits/habitSchemas').HabitItem,
        'name' | 'category' | 'frequency' | 'targetPerWeek' | 'reminderTime' | 'archived'
      >
    >
  ): Promise<void>;
  toggleHabitDay(
    uid: string,
    habit: import('../../core/habits/habitSchemas').HabitItem,
    existingLogs: import('../../core/habits/habitSchemas').HabitMonthLog[],
    dateYmd: string,
    todayYmd: string
  ): Promise<{ added: boolean; currentStreak: number }>;
  deleteHabit(
    uid: string,
    habit: import('../../core/habits/habitSchemas').HabitItem
  ): Promise<void>;
  restoreHabit(
    uid: string,
    habit: import('../../core/habits/habitSchemas').HabitItem
  ): Promise<void>;
}

export interface FinanceRepository {
  subscribeTransactions(
    uid: string,
    onData: (txs: import('../../core/finance/financeSchemas').TransactionItem[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  subscribeBudgets(
    uid: string,
    onData: (budgets: import('../../core/finance/financeSchemas').BudgetLimit[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  subscribeSubscriptions(
    uid: string,
    onData: (subs: import('../../core/finance/financeSchemas').SubscriptionItem[]) => void,
    onError?: (err: Error) => void
  ): () => void;
  createTransaction(
    uid: string,
    input: import('../../core/finance/financeSchemas').CreateTransactionInput
  ): Promise<import('../../core/finance/financeSchemas').TransactionItem>;
  deleteTransaction(
    uid: string,
    tx: import('../../core/finance/financeSchemas').TransactionItem
  ): Promise<void>;
  restoreTransaction(
    uid: string,
    tx: import('../../core/finance/financeSchemas').TransactionItem
  ): Promise<void>;
  upsertBudget(
    uid: string,
    existing: import('../../core/finance/financeSchemas').BudgetLimit | null,
    input: import('../../core/finance/financeSchemas').UpsertBudgetInput
  ): Promise<import('../../core/finance/financeSchemas').BudgetLimit>;
  deleteBudget(uid: string, budgetId: string): Promise<void>;
  createSubscription(
    uid: string,
    input: import('../../core/finance/financeSchemas').CreateSubscriptionInput
  ): Promise<import('../../core/finance/financeSchemas').SubscriptionItem>;
  updateSubscriptionState(
    uid: string,
    current: import('../../core/finance/financeSchemas').SubscriptionItem,
    patch: Partial<
      Pick<
        import('../../core/finance/financeSchemas').SubscriptionItem,
        'status' | 'nextBillingDate' | 'linkedReminderId'
      >
    >
  ): Promise<void>;
  deleteSubscription(
    uid: string,
    sub: import('../../core/finance/financeSchemas').SubscriptionItem
  ): Promise<void>;
  restoreSubscription(
    uid: string,
    sub: import('../../core/finance/financeSchemas').SubscriptionItem
  ): Promise<void>;
}





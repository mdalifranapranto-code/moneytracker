import {
  AccountRecord,
  BillRecord,
  BudgetRecord,
  CategoryRecord,
  CurrencyCode,
  DebtPaymentRecord,
  DebtRecord,
  GoogleConnectionState,
  RecurringTransactionRecord,
  SavingsContributionRecord,
  SavingsGoalRecord,
  SheetTabName,
  SyncConflictRecord,
  SyncQueueItem,
  SyncableFields,
  TransactionRecord,
} from '../types/finance';
import { advanceDateByFrequency, generateUUID, todayISO } from '../utils/format';
import { db } from './dexie';

let onMutationCallback: (() => void) | null = null;

export function registerMutationListener(cb: () => void) {
  onMutationCallback = cb;
}

function notifyLocalMutation() {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => {
        const syncManager = (reg as ServiceWorkerRegistration & {
          sync?: { register: (tag: string) => Promise<void> };
        }).sync;
        if (syncManager) {
          syncManager.register('my-money-sync').catch(() => {});
        }
      })
      .catch(() => {});
  }
  if (onMutationCallback) {
    onMutationCallback();
  }
}

export async function getConfig(key: string): Promise<string | null> {
  const row = await db.app_config.get(key);
  return row ? row.value : null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await db.app_config.put({ key, value });
}

export async function getDeviceId(): Promise<string> {
  const existing = await getConfig('device_id');
  if (existing) return existing;
  const id = generateUUID();
  await setConfig('device_id', id);
  return id;
}

export async function getActiveUserId(): Promise<string> {
  const conn = await getGoogleConnection();
  return conn.accountEmail || conn.accountUid || 'local-user';
}

export async function getCurrencyPreference(): Promise<CurrencyCode> {
  const val = await getConfig('currency');
  if (val === 'USD' || val === 'EUR' || val === 'GBP' || val === 'INR' || val === 'BDT') {
    return val;
  }
  return 'BDT';
}

export async function setCurrencyPreference(currency: CurrencyCode): Promise<void> {
  await setConfig('currency', currency);
}

export async function getGoogleConnection(): Promise<GoogleConnectionState> {
  const raw = await getConfig('google_connection');
  if (!raw) {
    return {
      accountEmail: null,
      accountName: null,
      accountUid: null,
      spreadsheetId: null,
      spreadsheetTitle: null,
      spreadsheetUrl: null,
      verifiedAt: null,
    };
  }
  try {
    return JSON.parse(raw) as GoogleConnectionState;
  } catch {
    return {
      accountEmail: null,
      accountName: null,
      accountUid: null,
      spreadsheetId: null,
      spreadsheetTitle: null,
      spreadsheetUrl: null,
      verifiedAt: null,
    };
  }
}

export async function saveGoogleConnection(state: GoogleConnectionState): Promise<void> {
  await setConfig('google_connection', JSON.stringify(state));
}

export async function addSyncLog(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string,
  details: string | null = null
): Promise<void> {
  await db.sync_logs.put({
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    level,
    message,
    details,
  });
  // Keep latest 150 logs
  const count = await db.sync_logs.count();
  if (count > 150) {
    const oldest = await db.sync_logs.orderBy('timestamp').limit(count - 150).toArray();
    await db.sync_logs.bulkDelete(oldest.map((l) => l.id));
  }
}

/**
 * Enqueue or coalesce a pending operation inside a Dexie transaction.
 * Guarantees TEST 2: multiple offline edits to the same record coalesce into a single latest operation.
 */
async function upsertRecordAndQueue<T extends SyncableFields>(
  entity: SheetTabName,
  record: T,
  action: 'upsert' | 'delete'
): Promise<void> {
  const table = db.getTableForEntity(entity);
  await table.put(record);

  const existingQueued = await db.sync_queue
    .where('record_id')
    .equals(record.id)
    .filter((item) => item.entity === entity && (item.status === 'queued' || item.status === 'failed'))
    .first();

  const nowIso = new Date().toISOString();
  const payloadCopy: Record<string, unknown> = {
    ...(record as unknown as Record<string, unknown>),
  };
  delete payloadCopy.last_synced_version;
  delete payloadCopy.last_synced_at;
  delete payloadCopy.sync_status;

  if (existingQueued) {
    await db.sync_queue.update(existingQueued.op_id, {
      action,
      payload_json: JSON.stringify(payloadCopy),
      updated_at: nowIso,
      status: 'queued',
      next_retry_at: Date.now(),
      last_error: null,
    });
  } else {
    const item: SyncQueueItem = {
      op_id: generateUUID(),
      record_id: record.id,
      entity,
      action,
      payload_json: JSON.stringify(payloadCopy),
      base_version: record.last_synced_version ?? 0,
      created_at: nowIso,
      updated_at: nowIso,
      retry_count: 0,
      next_retry_at: Date.now(),
      status: 'queued',
      last_error: null,
    };
    await db.sync_queue.put(item);
  }
}

export const DEFAULT_CATEGORIES: Array<
  Pick<CategoryRecord, 'name' | 'type' | 'color' | 'icon'>
> = [
  // Expense categories
  { name: 'Food & Groceries', type: 'expense', color: '#059669', icon: 'utensils' },
  { name: 'Dining & Restaurants', type: 'expense', color: '#EA580C', icon: 'coffee' },
  { name: 'Transport & Fuel', type: 'expense', color: '#0284C7', icon: 'car' },
  { name: 'Housing & Rent', type: 'expense', color: '#7C3AED', icon: 'home' },
  { name: 'Utilities & Internet', type: 'expense', color: '#D97706', icon: 'zap' },
  { name: 'Mobile & Recharge', type: 'expense', color: '#0891B2', icon: 'smartphone' },
  { name: 'Healthcare & Pharmacy', type: 'expense', color: '#DC2626', icon: 'heart' },
  { name: 'Education & Books', type: 'expense', color: '#4F46E5', icon: 'book' },
  { name: 'Shopping & Apparel', type: 'expense', color: '#DB2777', icon: 'shopping-bag' },
  { name: 'Personal Care', type: 'expense', color: '#BE185D', icon: 'sparkles' },
  { name: 'Entertainment & Streaming', type: 'expense', color: '#9333EA', icon: 'film' },
  { name: 'Travel & Lodging', type: 'expense', color: '#2563EB', icon: 'plane' },
  { name: 'Family & Gifts', type: 'expense', color: '#E11D48', icon: 'gift' },
  { name: 'Subscriptions & Software', type: 'expense', color: '#6366F1', icon: 'repeat' },
  { name: 'Insurance & Taxes', type: 'expense', color: '#475569', icon: 'shield' },
  { name: 'Miscellaneous Expense', type: 'expense', color: '#64748B', icon: 'tag' },
  // Income categories
  { name: 'Salary', type: 'income', color: '#10B981', icon: 'briefcase' },
  { name: 'Freelance & Business', type: 'income', color: '#0D9488', icon: 'laptop' },
  { name: 'Bonus & Commission', type: 'income', color: '#16A34A', icon: 'award' },
  { name: 'Investments & Dividends', type: 'income', color: '#0284C7', icon: 'trending-up' },
  { name: 'Rental Income', type: 'income', color: '#65A30D', icon: 'building' },
  { name: 'Gift & Allowance', type: 'income', color: '#14B8A6', icon: 'gift' },
  { name: 'Refunds & Cashback', type: 'income', color: '#22C55E', icon: 'rotate-ccw' },
];

export async function seedDefaultCategories(notifySync = false): Promise<number> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let added = 0;

  await db.transaction('rw', [db.categories, db.sync_queue], async () => {
    const existing = await db.categories.filter((c) => !c.deleted_at).toArray();
    const existingKeys = new Set(
      existing.map((c) => `${c.name.trim().toLowerCase()}::${c.type}`)
    );

    for (const c of DEFAULT_CATEGORIES) {
      const key = `${c.name.trim().toLowerCase()}::${c.type}`;
      if (existingKeys.has(key)) continue;

      const rec: CategoryRecord = {
        id: generateUUID(),
        user_id: userId,
        name: c.name,
        type: c.type,
        color: c.color,
        icon: c.icon,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        sync_version: 1,
        last_synced_version: 0,
        last_synced_at: null,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Categories', rec, 'upsert');
      existingKeys.add(key);
      added++;
    }
  });

  if (notifySync && added > 0) {
    notifyLocalMutation();
  }
  return added;
}

/**
 * Bootstrap essential structural defaults (Currency + Starter Categories + Cash Wallet)
 * with ZERO demo transactions.
 */
export async function ensureInitialBootstrap(): Promise<void> {
  const initialized = await getConfig('bootstrapped_v1');
  const categoriesV2 = await getConfig('bootstrapped_categories_v2');

  if (initialized === 'true' && categoriesV2 === 'true') return;

  await getDeviceId();
  const cur = await getConfig('currency');
  if (!cur) await setConfig('currency', 'BDT');

  const now = new Date().toISOString();
  const userId = 'local-user';
  const accCount = await db.accounts.count();

  if (initialized !== 'true' && accCount === 0) {
    await db.transaction('rw', [db.accounts, db.sync_queue, db.app_config], async () => {
      const cashWallet: AccountRecord = {
        id: generateUUID(),
        user_id: userId,
        name: 'Cash Wallet',
        type: 'cash',
        initial_balance: 0,
        current_balance: 0,
        currency: 'BDT',
        institution: 'Personal Cash',
        is_archived: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        sync_version: 1,
        last_synced_version: 0,
        last_synced_at: null,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Accounts', cashWallet, 'upsert');
    });
  }

  if (categoriesV2 !== 'true') {
    await seedDefaultCategories(false);
    await setConfig('bootstrapped_categories_v2', 'true');
  }

  if (initialized !== 'true') {
    await setConfig('bootstrapped_v1', 'true');
  }
}

/**
 * Recomputes deterministic account balances from initial_balance + all active transactions.
 */
export async function recalculateAccountBalances(accountIds?: string[]): Promise<void> {
  const allAccounts = await db.accounts.filter((a) => !a.deleted_at).toArray();
  const targetAccounts = accountIds
    ? allAccounts.filter((a) => accountIds.includes(a.id))
    : allAccounts;
  if (targetAccounts.length === 0) return;

  const activeTx = await db.transactions.filter((t) => !t.deleted_at).toArray();
  const now = new Date().toISOString();

  for (const acc of targetAccounts) {
    let balance = Number(acc.initial_balance) || 0;
    for (const tx of activeTx) {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'income' && tx.account_id === acc.id) {
        balance += amt;
      } else if (tx.type === 'expense' && tx.account_id === acc.id) {
        balance -= amt;
      } else if (tx.type === 'transfer') {
        if (tx.account_id === acc.id) balance -= amt;
        if (tx.to_account_id === acc.id) balance += amt;
      }
    }

    if (Math.abs(balance - acc.current_balance) > 0.0001) {
      const updated: AccountRecord = {
        ...acc,
        current_balance: Number(balance.toFixed(2)),
        updated_at: now,
        sync_version: acc.sync_version + 1,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Accounts', updated, 'upsert');
    }
  }
}

// ---------------- TRANSACTIONS ----------------

export async function saveTransaction(input: {
  id?: string;
  account_id: string;
  to_account_id?: string | null;
  category_id?: string | null;
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  currency?: string;
  date: string;
  merchant: string;
  note: string;
  bill_id?: string | null;
  recurring_id?: string | null;
}): Promise<TransactionRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  const defaultCurrency = await getCurrencyPreference();

  let saved!: TransactionRecord;

  await db.transaction(
    'rw',
    [db.transactions, db.accounts, db.sync_queue],
    async () => {
      const existing = input.id ? await db.transactions.get(input.id) : undefined;
      const affectedAccounts = new Set<string>([input.account_id]);
      if (input.to_account_id) affectedAccounts.add(input.to_account_id);
      if (existing) {
        affectedAccounts.add(existing.account_id);
        if (existing.to_account_id) affectedAccounts.add(existing.to_account_id);
      }

      saved = {
        id: existing?.id ?? generateUUID(),
        user_id: existing?.user_id ?? userId,
        account_id: input.account_id,
        to_account_id: input.type === 'transfer' ? (input.to_account_id ?? null) : null,
        category_id: input.type === 'transfer' ? null : (input.category_id ?? null),
        type: input.type,
        amount: Number(input.amount),
        currency: input.currency ?? existing?.currency ?? defaultCurrency,
        date: input.date,
        merchant: input.merchant.trim(),
        note: input.note.trim(),
        bill_id: input.bill_id ?? existing?.bill_id ?? null,
        recurring_id: input.recurring_id ?? existing?.recurring_id ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
        sync_version: (existing?.sync_version ?? 0) + 1,
        last_synced_version: existing?.last_synced_version ?? 0,
        last_synced_at: existing?.last_synced_at ?? null,
        sync_status: 'pending',
      };

      await upsertRecordAndQueue('Transactions', saved, 'upsert');
      await recalculateAccountBalances(Array.from(affectedAccounts));
    }
  );

  notifyLocalMutation();
  return saved;
}

export async function softDeleteTransaction(id: string): Promise<void> {
  const existing = await db.transactions.get(id);
  if (!existing) return;
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [db.transactions, db.accounts, db.sync_queue],
    async () => {
      const updated: TransactionRecord = {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Transactions', updated, 'delete');
      const affected = [existing.account_id];
      if (existing.to_account_id) affected.push(existing.to_account_id);
      await recalculateAccountBalances(affected);
    }
  );

  notifyLocalMutation();
}

export async function restoreTransaction(id: string): Promise<void> {
  const existing = await db.transactions.get(id);
  if (!existing) return;
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [db.transactions, db.accounts, db.sync_queue],
    async () => {
      const updated: TransactionRecord = {
        ...existing,
        deleted_at: null,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Transactions', updated, 'upsert');
      const affected = [existing.account_id];
      if (existing.to_account_id) affected.push(existing.to_account_id);
      await recalculateAccountBalances(affected);
    }
  );

  notifyLocalMutation();
}

// ---------------- ACCOUNTS ----------------

export async function saveAccount(input: {
  id?: string;
  name: string;
  type: AccountRecord['type'];
  initial_balance: number;
  currency?: string;
  institution: string;
  is_archived?: boolean;
}): Promise<AccountRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  const defaultCurrency = await getCurrencyPreference();
  let saved!: AccountRecord;

  await db.transaction('rw', [db.accounts, db.transactions, db.sync_queue], async () => {
    const existing = input.id ? await db.accounts.get(input.id) : undefined;
    saved = {
      id: existing?.id ?? generateUUID(),
      user_id: existing?.user_id ?? userId,
      name: input.name.trim(),
      type: input.type,
      initial_balance: Number(input.initial_balance),
      current_balance: existing?.current_balance ?? Number(input.initial_balance),
      currency: input.currency ?? existing?.currency ?? defaultCurrency,
      institution: input.institution.trim(),
      is_archived: input.is_archived ?? existing?.is_archived ?? false,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      sync_version: (existing?.sync_version ?? 0) + 1,
      last_synced_version: existing?.last_synced_version ?? 0,
      last_synced_at: existing?.last_synced_at ?? null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Accounts', saved, 'upsert');
    await recalculateAccountBalances([saved.id]);
  });

  notifyLocalMutation();
  return saved;
}

export async function softDeleteAccount(id: string): Promise<void> {
  const existing = await db.accounts.get(id);
  if (!existing) return;
  const now = new Date().toISOString();

  await db.transaction('rw', [db.accounts, db.sync_queue], async () => {
    await upsertRecordAndQueue(
      'Accounts',
      {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      },
      'delete'
    );
  });
  notifyLocalMutation();
}

// ---------------- CATEGORIES ----------------

export async function saveCategory(input: {
  id?: string;
  name: string;
  type: 'expense' | 'income';
  color: string;
  icon?: string;
}): Promise<CategoryRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let saved!: CategoryRecord;

  await db.transaction('rw', [db.categories, db.sync_queue], async () => {
    const existing = input.id ? await db.categories.get(input.id) : undefined;
    saved = {
      id: existing?.id ?? generateUUID(),
      user_id: existing?.user_id ?? userId,
      name: input.name.trim(),
      type: input.type,
      color: input.color,
      icon: input.icon ?? existing?.icon ?? 'tag',
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      sync_version: (existing?.sync_version ?? 0) + 1,
      last_synced_version: existing?.last_synced_version ?? 0,
      last_synced_at: existing?.last_synced_at ?? null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Categories', saved, 'upsert');
  });

  notifyLocalMutation();
  return saved;
}

export async function softDeleteCategory(id: string): Promise<void> {
  const existing = await db.categories.get(id);
  if (!existing) return;
  const now = new Date().toISOString();

  await db.transaction('rw', [db.categories, db.sync_queue], async () => {
    await upsertRecordAndQueue(
      'Categories',
      {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      },
      'delete'
    );
  });
  notifyLocalMutation();
}

// ---------------- BUDGETS ----------------

export async function saveBudget(input: {
  id?: string;
  category_id: string;
  amount_limit: number;
  period: string;
  rollover?: boolean;
}): Promise<BudgetRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let saved!: BudgetRecord;

  await db.transaction('rw', [db.budgets, db.sync_queue], async () => {
    const existing = input.id ? await db.budgets.get(input.id) : undefined;
    saved = {
      id: existing?.id ?? generateUUID(),
      user_id: existing?.user_id ?? userId,
      category_id: input.category_id,
      amount_limit: Number(input.amount_limit),
      period: input.period,
      rollover: input.rollover ?? existing?.rollover ?? false,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      sync_version: (existing?.sync_version ?? 0) + 1,
      last_synced_version: existing?.last_synced_version ?? 0,
      last_synced_at: existing?.last_synced_at ?? null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Budgets', saved, 'upsert');
  });

  notifyLocalMutation();
  return saved;
}

export async function softDeleteBudget(id: string): Promise<void> {
  const existing = await db.budgets.get(id);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.transaction('rw', [db.budgets, db.sync_queue], async () => {
    await upsertRecordAndQueue(
      'Budgets',
      {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      },
      'delete'
    );
  });
  notifyLocalMutation();
}

// ---------------- SAVINGS GOALS & CONTRIBUTIONS ----------------

export async function saveSavingsGoal(input: {
  id?: string;
  name: string;
  target_amount: number;
  target_date: string;
  linked_account_id?: string | null;
  status?: 'active' | 'completed' | 'paused';
}): Promise<SavingsGoalRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let saved!: SavingsGoalRecord;

  await db.transaction('rw', [db.savings_goals, db.sync_queue], async () => {
    const existing = input.id ? await db.savings_goals.get(input.id) : undefined;
    saved = {
      id: existing?.id ?? generateUUID(),
      user_id: existing?.user_id ?? userId,
      name: input.name.trim(),
      target_amount: Number(input.target_amount),
      current_amount: existing?.current_amount ?? 0,
      target_date: input.target_date,
      linked_account_id: input.linked_account_id ?? null,
      status: input.status ?? existing?.status ?? 'active',
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      sync_version: (existing?.sync_version ?? 0) + 1,
      last_synced_version: existing?.last_synced_version ?? 0,
      last_synced_at: existing?.last_synced_at ?? null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Savings_Goals', saved, 'upsert');
  });

  notifyLocalMutation();
  return saved;
}

export async function addSavingsContribution(input: {
  goal_id: string;
  account_id: string;
  amount: number;
  date: string;
  note: string;
}): Promise<SavingsContributionRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let contrib!: SavingsContributionRecord;

  await db.transaction(
    'rw',
    [db.savings_goals, db.savings_contributions, db.sync_queue],
    async () => {
      const goal = await db.savings_goals.get(input.goal_id);
      if (!goal) throw new Error('Savings goal not found');

      contrib = {
        id: generateUUID(),
        user_id: userId,
        goal_id: input.goal_id,
        account_id: input.account_id,
        amount: Number(input.amount),
        date: input.date,
        note: input.note.trim(),
        created_at: now,
        updated_at: now,
        deleted_at: null,
        sync_version: 1,
        last_synced_version: 0,
        last_synced_at: null,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Savings_Contributions', contrib, 'upsert');

      const newAmount = Number((goal.current_amount + Number(input.amount)).toFixed(2));
      const updatedGoal: SavingsGoalRecord = {
        ...goal,
        current_amount: newAmount,
        status: newAmount >= goal.target_amount ? 'completed' : goal.status,
        updated_at: now,
        sync_version: goal.sync_version + 1,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Savings_Goals', updatedGoal, 'upsert');
    }
  );

  notifyLocalMutation();
  return contrib;
}

export async function softDeleteSavingsGoal(id: string): Promise<void> {
  const existing = await db.savings_goals.get(id);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.transaction('rw', [db.savings_goals, db.sync_queue], async () => {
    await upsertRecordAndQueue(
      'Savings_Goals',
      {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      },
      'delete'
    );
  });
  notifyLocalMutation();
}

// ---------------- BILLS & RECURRING ----------------

export async function saveBill(input: {
  id?: string;
  name: string;
  amount: number;
  due_date: string;
  frequency: BillRecord['frequency'];
  category_id: string | null;
  account_id: string | null;
}): Promise<BillRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let saved!: BillRecord;

  await db.transaction('rw', [db.bills, db.sync_queue], async () => {
    const existing = input.id ? await db.bills.get(input.id) : undefined;
    const isOverdue = input.due_date < todayISO();
    saved = {
      id: existing?.id ?? generateUUID(),
      user_id: existing?.user_id ?? userId,
      name: input.name.trim(),
      amount: Number(input.amount),
      due_date: input.due_date,
      frequency: input.frequency,
      category_id: input.category_id,
      account_id: input.account_id,
      status: existing?.status === 'paid' ? 'paid' : isOverdue ? 'overdue' : 'unpaid',
      paid_at: existing?.paid_at ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      sync_version: (existing?.sync_version ?? 0) + 1,
      last_synced_version: existing?.last_synced_version ?? 0,
      last_synced_at: existing?.last_synced_at ?? null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Bills', saved, 'upsert');
  });

  notifyLocalMutation();
  return saved;
}

export async function markBillPaid(billId: string, accountId: string): Promise<void> {
  const bill = await db.bills.get(billId);
  if (!bill) return;
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  const defaultCurrency = await getCurrencyPreference();

  await db.transaction(
    'rw',
    [db.bills, db.transactions, db.accounts, db.sync_queue],
    async () => {
      const updatedBill: BillRecord = {
        ...bill,
        status: 'paid',
        paid_at: now,
        account_id: accountId,
        updated_at: now,
        sync_version: bill.sync_version + 1,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Bills', updatedBill, 'upsert');

      const tx: TransactionRecord = {
        id: generateUUID(),
        user_id: userId,
        account_id: accountId,
        to_account_id: null,
        category_id: bill.category_id,
        type: 'expense',
        amount: Number(bill.amount),
        currency: defaultCurrency,
        date: todayISO(),
        merchant: bill.name,
        note: `Bill payment (${bill.frequency})`,
        bill_id: bill.id,
        recurring_id: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        sync_version: 1,
        last_synced_version: 0,
        last_synced_at: null,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Transactions', tx, 'upsert');
      await recalculateAccountBalances([accountId]);
    }
  );

  notifyLocalMutation();
}

export async function softDeleteBill(id: string): Promise<void> {
  const existing = await db.bills.get(id);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.transaction('rw', [db.bills, db.sync_queue], async () => {
    await upsertRecordAndQueue(
      'Bills',
      {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      },
      'delete'
    );
  });
  notifyLocalMutation();
}

export async function saveRecurringTransaction(input: {
  id?: string;
  title: string;
  type: 'expense' | 'income';
  amount: number;
  account_id: string;
  category_id: string | null;
  frequency: RecurringTransactionRecord['frequency'];
  next_run_date: string;
  active?: boolean;
}): Promise<RecurringTransactionRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let saved!: RecurringTransactionRecord;

  await db.transaction('rw', [db.recurring_transactions, db.sync_queue], async () => {
    const existing = input.id ? await db.recurring_transactions.get(input.id) : undefined;
    saved = {
      id: existing?.id ?? generateUUID(),
      user_id: existing?.user_id ?? userId,
      title: input.title.trim(),
      type: input.type,
      amount: Number(input.amount),
      account_id: input.account_id,
      category_id: input.category_id,
      frequency: input.frequency,
      next_run_date: input.next_run_date,
      last_run_date: existing?.last_run_date ?? null,
      active: input.active ?? existing?.active ?? true,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      sync_version: (existing?.sync_version ?? 0) + 1,
      last_synced_version: existing?.last_synced_version ?? 0,
      last_synced_at: existing?.last_synced_at ?? null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Recurring_Transactions', saved, 'upsert');
  });

  notifyLocalMutation();
  return saved;
}

export async function postRecurringNow(recurringId: string): Promise<void> {
  const rec = await db.recurring_transactions.get(recurringId);
  if (!rec) return;
  const now = new Date().toISOString();
  const today = todayISO();
  const userId = await getActiveUserId();
  const defaultCurrency = await getCurrencyPreference();

  await db.transaction(
    'rw',
    [db.recurring_transactions, db.transactions, db.accounts, db.sync_queue],
    async () => {
      const tx: TransactionRecord = {
        id: generateUUID(),
        user_id: userId,
        account_id: rec.account_id,
        to_account_id: null,
        category_id: rec.category_id,
        type: rec.type,
        amount: Number(rec.amount),
        currency: defaultCurrency,
        date: today,
        merchant: rec.title,
        note: `Recurring (${rec.frequency})`,
        bill_id: null,
        recurring_id: rec.id,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        sync_version: 1,
        last_synced_version: 0,
        last_synced_at: null,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Transactions', tx, 'upsert');

      const nextDate = advanceDateByFrequency(rec.next_run_date, rec.frequency);
      const updatedRec: RecurringTransactionRecord = {
        ...rec,
        last_run_date: today,
        next_run_date: nextDate,
        updated_at: now,
        sync_version: rec.sync_version + 1,
        sync_status: 'pending',
      };
      await upsertRecordAndQueue('Recurring_Transactions', updatedRec, 'upsert');
      await recalculateAccountBalances([rec.account_id]);
    }
  );

  notifyLocalMutation();
}

export async function softDeleteRecurring(id: string): Promise<void> {
  const existing = await db.recurring_transactions.get(id);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.transaction('rw', [db.recurring_transactions, db.sync_queue], async () => {
    await upsertRecordAndQueue(
      'Recurring_Transactions',
      {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      },
      'delete'
    );
  });
  notifyLocalMutation();
}

// ---------------- DEBTS & PAYMENTS ----------------

export async function saveDebt(input: {
  id?: string;
  person_or_entity: string;
  direction: 'owed_to_me' | 'i_owe';
  principal_amount: number;
  due_date: string;
  note: string;
}): Promise<DebtRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let saved!: DebtRecord;

  await db.transaction('rw', [db.debts, db.sync_queue], async () => {
    const existing = input.id ? await db.debts.get(input.id) : undefined;
    saved = {
      id: existing?.id ?? generateUUID(),
      user_id: existing?.user_id ?? userId,
      person_or_entity: input.person_or_entity.trim(),
      direction: input.direction,
      principal_amount: Number(input.principal_amount),
      remaining_amount: existing?.remaining_amount ?? Number(input.principal_amount),
      due_date: input.due_date,
      note: input.note.trim(),
      status: existing?.status ?? 'active',
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      sync_version: (existing?.sync_version ?? 0) + 1,
      last_synced_version: existing?.last_synced_version ?? 0,
      last_synced_at: existing?.last_synced_at ?? null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Debts', saved, 'upsert');
  });

  notifyLocalMutation();
  return saved;
}

export async function addDebtPayment(input: {
  debt_id: string;
  account_id: string;
  amount: number;
  date: string;
  note: string;
}): Promise<DebtPaymentRecord> {
  const now = new Date().toISOString();
  const userId = await getActiveUserId();
  let payment!: DebtPaymentRecord;

  await db.transaction('rw', [db.debts, db.debt_payments, db.sync_queue], async () => {
    const debt = await db.debts.get(input.debt_id);
    if (!debt) throw new Error('Debt record not found');

    payment = {
      id: generateUUID(),
      user_id: userId,
      debt_id: input.debt_id,
      account_id: input.account_id,
      amount: Number(input.amount),
      date: input.date,
      note: input.note.trim(),
      created_at: now,
      updated_at: now,
      deleted_at: null,
      sync_version: 1,
      last_synced_version: 0,
      last_synced_at: null,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Debt_Payments', payment, 'upsert');

    const remaining = Math.max(0, Number((debt.remaining_amount - Number(input.amount)).toFixed(2)));
    const updatedDebt: DebtRecord = {
      ...debt,
      remaining_amount: remaining,
      status: remaining <= 0 ? 'settled' : 'active',
      updated_at: now,
      sync_version: debt.sync_version + 1,
      sync_status: 'pending',
    };
    await upsertRecordAndQueue('Debts', updatedDebt, 'upsert');
  });

  notifyLocalMutation();
  return payment;
}

export async function softDeleteDebt(id: string): Promise<void> {
  const existing = await db.debts.get(id);
  if (!existing) return;
  const now = new Date().toISOString();
  await db.transaction('rw', [db.debts, db.sync_queue], async () => {
    await upsertRecordAndQueue(
      'Debts',
      {
        ...existing,
        deleted_at: now,
        updated_at: now,
        sync_version: existing.sync_version + 1,
        sync_status: 'pending',
      },
      'delete'
    );
  });
  notifyLocalMutation();
}

// ---------------- CONFLICT RESOLUTION ----------------

export async function resolveConflictRecord(
  conflict: SyncConflictRecord,
  choice: 'kept_local' | 'accepted_remote' | 'merged'
): Promise<void> {
  const now = new Date().toISOString();
  const table = db.getTableForEntity(conflict.entity);
  const localRec = JSON.parse(conflict.local_record_json);
  const remoteRec = JSON.parse(conflict.remote_record_json);

  await db.transaction(
    'rw',
    [
      db.transactions,
      db.accounts,
      db.categories,
      db.budgets,
      db.savings_goals,
      db.savings_contributions,
      db.bills,
      db.recurring_transactions,
      db.debts,
      db.debt_payments,
      db.sync_queue,
      db.sync_conflicts,
    ],
    async () => {
      if (choice === 'kept_local') {
        const nextVer = Math.max(Number(localRec.sync_version) || 1, Number(remoteRec.sync_version) || 1) + 1;
        const updated = {
          ...localRec,
          updated_at: now,
          sync_version: nextVer,
          last_synced_version: Number(remoteRec.sync_version) || 0,
          sync_status: 'pending',
        };
        await table.put(updated);
        const existingQueue = await db.sync_queue.get(conflict.op_id);
        const payloadCopy = { ...updated };
        delete payloadCopy.last_synced_version;
        delete payloadCopy.last_synced_at;
        delete payloadCopy.sync_status;

        if (existingQueue) {
          await db.sync_queue.update(conflict.op_id, {
            payload_json: JSON.stringify(payloadCopy),
            base_version: Number(remoteRec.sync_version) || 0,
            status: 'queued',
            next_retry_at: Date.now(),
            last_error: null,
          });
        } else {
          await db.sync_queue.put({
            op_id: generateUUID(),
            record_id: updated.id,
            entity: conflict.entity,
            action: updated.deleted_at ? 'delete' : 'upsert',
            payload_json: JSON.stringify(payloadCopy),
            base_version: Number(remoteRec.sync_version) || 0,
            created_at: now,
            updated_at: now,
            retry_count: 0,
            next_retry_at: Date.now(),
            status: 'queued',
            last_error: null,
          });
        }
      } else if (choice === 'accepted_remote') {
        const syncedRemote = {
          ...remoteRec,
          last_synced_version: Number(remoteRec.sync_version) || 1,
          last_synced_at: remoteRec.updated_at,
          sync_status: 'synced',
        };
        await table.put(syncedRemote);
        await db.sync_queue.delete(conflict.op_id);
      } else if (choice === 'merged') {
        // Keep remote under original ID, and save local version as a brand-new UUID record
        const syncedRemote = {
          ...remoteRec,
          last_synced_version: Number(remoteRec.sync_version) || 1,
          last_synced_at: remoteRec.updated_at,
          sync_status: 'synced',
        };
        await table.put(syncedRemote);
        await db.sync_queue.delete(conflict.op_id);

        const clonedLocal = {
          ...localRec,
          id: generateUUID(),
          created_at: now,
          updated_at: now,
          sync_version: 1,
          last_synced_version: 0,
          last_synced_at: null,
          sync_status: 'pending',
        };
        await upsertRecordAndQueue(conflict.entity, clonedLocal, 'upsert');
      }

      await db.sync_conflicts.update(conflict.id, {
        resolution: choice,
        resolved_at: now,
      });

      if (conflict.entity === 'Transactions') {
        await recalculateAccountBalances();
      }
    }
  );

  notifyLocalMutation();
}

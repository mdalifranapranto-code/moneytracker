export type SyncStatus = 'synced' | 'pending' | 'failed' | 'conflict';

export type EngineSyncState =
  | 'Synced'
  | 'Syncing'
  | 'Pending'
  | 'Offline'
  | 'Failed'
  | 'Disconnected';

export type SheetTabName =
  | 'Transactions'
  | 'Accounts'
  | 'Categories'
  | 'Budgets'
  | 'Savings_Goals'
  | 'Savings_Contributions'
  | 'Bills'
  | 'Recurring_Transactions'
  | 'Debts'
  | 'Debt_Payments'
  | 'Sync_Metadata';

export const ALL_SHEET_TABS: SheetTabName[] = [
  'Transactions',
  'Accounts',
  'Categories',
  'Budgets',
  'Savings_Goals',
  'Savings_Contributions',
  'Bills',
  'Recurring_Transactions',
  'Debts',
  'Debt_Payments',
  'Sync_Metadata',
];

export type CurrencyCode = 'BDT' | 'USD' | 'EUR' | 'GBP' | 'INR';

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  name: string;
  locale: string;
}

export const CURRENCY_MAP: Record<CurrencyCode, CurrencyConfig> = {
  BDT: { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka', locale: 'en-BD' },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', locale: 'en-IE' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
};

export interface SyncableFields {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version: number;
  last_synced_version?: number;
  last_synced_at?: string | null;
  sync_status?: SyncStatus;
}

export type TransactionType = 'expense' | 'income' | 'transfer';

export interface TransactionRecord extends SyncableFields {
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  type: TransactionType;
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  note: string;
  bill_id: string | null;
  recurring_id: string | null;
}

export type AccountType = 'cash' | 'bank' | 'mobile_wallet' | 'credit' | 'savings';

export interface AccountRecord extends SyncableFields {
  name: string;
  type: AccountType;
  initial_balance: number;
  current_balance: number;
  currency: string;
  institution: string;
  is_archived: boolean;
}

export interface CategoryRecord extends SyncableFields {
  name: string;
  type: 'expense' | 'income';
  color: string;
  icon: string;
}

export interface BudgetRecord extends SyncableFields {
  category_id: string;
  amount_limit: number;
  period: string; // YYYY-MM
  rollover: boolean;
}

export interface SavingsGoalRecord extends SyncableFields {
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  linked_account_id: string | null;
  status: 'active' | 'completed' | 'paused';
}

export interface SavingsContributionRecord extends SyncableFields {
  goal_id: string;
  account_id: string;
  amount: number;
  date: string;
  note: string;
}

export interface BillRecord extends SyncableFields {
  name: string;
  amount: number;
  due_date: string;
  frequency: 'once' | 'monthly' | 'quarterly' | 'yearly';
  category_id: string | null;
  account_id: string | null;
  status: 'unpaid' | 'paid' | 'overdue';
  paid_at: string | null;
}

export interface RecurringTransactionRecord extends SyncableFields {
  title: string;
  type: 'expense' | 'income';
  amount: number;
  account_id: string;
  category_id: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  next_run_date: string;
  last_run_date: string | null;
  active: boolean;
}

export interface DebtRecord extends SyncableFields {
  person_or_entity: string;
  direction: 'owed_to_me' | 'i_owe';
  principal_amount: number;
  remaining_amount: number;
  due_date: string;
  note: string;
  status: 'active' | 'settled';
}

export interface DebtPaymentRecord extends SyncableFields {
  debt_id: string;
  account_id: string;
  amount: number;
  date: string;
  note: string;
}

export interface SyncMetadataRecord extends SyncableFields {
  device_id: string;
  last_sync_at: string;
  schema_version: number;
  client_app_version: string;
  last_sync_status: string;
}

export interface SyncQueueItem {
  op_id: string;
  record_id: string;
  entity: SheetTabName;
  action: 'upsert' | 'delete';
  payload_json: string;
  base_version: number;
  created_at: string;
  updated_at: string;
  retry_count: number;
  next_retry_at: number; // epoch ms
  status: 'queued' | 'processing' | 'failed' | 'conflict';
  last_error: string | null;
}

export interface SyncConflictRecord {
  id: string;
  entity: SheetTabName;
  record_id: string;
  op_id: string;
  local_record_json: string;
  remote_record_json: string;
  detected_at: string;
  resolution: 'pending' | 'kept_local' | 'accepted_remote' | 'merged';
  resolved_at: string | null;
}

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details: string | null;
}

export interface GoogleConnectionState {
  accountEmail: string | null;
  accountName: string | null;
  accountUid: string | null;
  spreadsheetId: string | null;
  spreadsheetTitle: string | null;
  spreadsheetUrl: string | null;
  verifiedAt: string | null;
}

export const SHEET_HEADERS: Record<SheetTabName, string[]> = {
  Transactions: [
    'id',
    'user_id',
    'account_id',
    'to_account_id',
    'category_id',
    'type',
    'amount',
    'currency',
    'date',
    'merchant',
    'note',
    'bill_id',
    'recurring_id',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Accounts: [
    'id',
    'user_id',
    'name',
    'type',
    'initial_balance',
    'current_balance',
    'currency',
    'institution',
    'is_archived',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Categories: [
    'id',
    'user_id',
    'name',
    'type',
    'color',
    'icon',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Budgets: [
    'id',
    'user_id',
    'category_id',
    'amount_limit',
    'period',
    'rollover',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Savings_Goals: [
    'id',
    'user_id',
    'name',
    'target_amount',
    'current_amount',
    'target_date',
    'linked_account_id',
    'status',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Savings_Contributions: [
    'id',
    'user_id',
    'goal_id',
    'account_id',
    'amount',
    'date',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Bills: [
    'id',
    'user_id',
    'name',
    'amount',
    'due_date',
    'frequency',
    'category_id',
    'account_id',
    'status',
    'paid_at',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Recurring_Transactions: [
    'id',
    'user_id',
    'title',
    'type',
    'amount',
    'account_id',
    'category_id',
    'frequency',
    'next_run_date',
    'last_run_date',
    'active',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Debts: [
    'id',
    'user_id',
    'person_or_entity',
    'direction',
    'principal_amount',
    'remaining_amount',
    'due_date',
    'note',
    'status',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Debt_Payments: [
    'id',
    'user_id',
    'debt_id',
    'account_id',
    'amount',
    'date',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
  Sync_Metadata: [
    'id',
    'user_id',
    'device_id',
    'last_sync_at',
    'schema_version',
    'client_app_version',
    'last_sync_status',
    'created_at',
    'updated_at',
    'deleted_at',
    'sync_version',
  ],
};

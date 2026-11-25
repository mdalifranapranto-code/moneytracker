import Dexie, { Table } from 'dexie';
import {
  AccountRecord,
  BillRecord,
  BudgetRecord,
  CategoryRecord,
  DebtPaymentRecord,
  DebtRecord,
  RecurringTransactionRecord,
  SavingsContributionRecord,
  SavingsGoalRecord,
  SheetTabName,
  SyncConflictRecord,
  SyncLogEntry,
  SyncMetadataRecord,
  SyncQueueItem,
  TransactionRecord,
} from '../types/finance';

export interface AppConfigEntry {
  key: string;
  value: string;
}

export class MyMoneyDB extends Dexie {
  transactions!: Table<TransactionRecord, string>;
  accounts!: Table<AccountRecord, string>;
  categories!: Table<CategoryRecord, string>;
  budgets!: Table<BudgetRecord, string>;
  savings_goals!: Table<SavingsGoalRecord, string>;
  savings_contributions!: Table<SavingsContributionRecord, string>;
  bills!: Table<BillRecord, string>;
  recurring_transactions!: Table<RecurringTransactionRecord, string>;
  debts!: Table<DebtRecord, string>;
  debt_payments!: Table<DebtPaymentRecord, string>;
  sync_metadata!: Table<SyncMetadataRecord, string>;

  sync_queue!: Table<SyncQueueItem, string>;
  sync_conflicts!: Table<SyncConflictRecord, string>;
  sync_logs!: Table<SyncLogEntry, string>;
  app_config!: Table<AppConfigEntry, string>;

  constructor() {
    super('MyMoneyOfflineDB');

    this.version(1).stores({
      transactions: 'id, account_id, to_account_id, category_id, type, date, updated_at, deleted_at, sync_status',
      accounts: 'id, name, type, updated_at, deleted_at, sync_status',
      categories: 'id, name, type, updated_at, deleted_at, sync_status',
      budgets: 'id, category_id, period, updated_at, deleted_at, sync_status',
      savings_goals: 'id, status, updated_at, deleted_at, sync_status',
      savings_contributions: 'id, goal_id, account_id, date, updated_at, deleted_at, sync_status',
      bills: 'id, due_date, status, updated_at, deleted_at, sync_status',
      recurring_transactions: 'id, next_run_date, active, updated_at, deleted_at, sync_status',
      debts: 'id, direction, status, updated_at, deleted_at, sync_status',
      debt_payments: 'id, debt_id, account_id, date, updated_at, deleted_at, sync_status',
      sync_metadata: 'id, device_id, updated_at, sync_status',

      sync_queue: 'op_id, record_id, entity, status, next_retry_at, created_at',
      sync_conflicts: 'id, entity, record_id, resolution, detected_at',
      sync_logs: 'id, timestamp, level',
      app_config: 'key',
    });
  }

  getTableForEntity(entity: SheetTabName): Table<any, string> {
    switch (entity) {
      case 'Transactions':
        return this.transactions;
      case 'Accounts':
        return this.accounts;
      case 'Categories':
        return this.categories;
      case 'Budgets':
        return this.budgets;
      case 'Savings_Goals':
        return this.savings_goals;
      case 'Savings_Contributions':
        return this.savings_contributions;
      case 'Bills':
        return this.bills;
      case 'Recurring_Transactions':
        return this.recurring_transactions;
      case 'Debts':
        return this.debts;
      case 'Debt_Payments':
        return this.debt_payments;
      case 'Sync_Metadata':
        return this.sync_metadata;
    }
  }
}

export const db = new MyMoneyDB();

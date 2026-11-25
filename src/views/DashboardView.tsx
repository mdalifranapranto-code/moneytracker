import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus } from 'lucide-react';
import { db } from '../db/dexie';
import { SyncStatusCard } from '../components/SyncStatusCard';
import { CurrencyCode, TransactionRecord, TransactionType } from '../types/finance';
import { currentMonthKey, formatMoney } from '../utils/format';

interface DashboardViewProps {
  currency: CurrencyCode;
  onQuickAdd: (type: TransactionType) => void;
  onEditTx: (tx: TransactionRecord) => void;
  onNavigate: (tab: string) => void;
  onOpenConflicts: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  currency,
  onQuickAdd,
  onEditTx,
  onNavigate,
  onOpenConflicts,
}) => {
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.deleted_at && !a.is_archived).toArray(),
    []
  );
  const transactions = useLiveQuery(
    () => db.transactions.filter((t) => !t.deleted_at).toArray(),
    []
  );
  const categories = useLiveQuery(
    () => db.categories.filter((c) => !c.deleted_at).toArray(),
    []
  );
  const budgets = useLiveQuery(
    () => db.budgets.filter((b) => !b.deleted_at).toArray(),
    []
  );
  const bills = useLiveQuery(
    () => db.bills.filter((b) => !b.deleted_at && b.status !== 'paid').toArray(),
    []
  );

  const accList = accounts ?? [];
  const txList = transactions ?? [];
  const catList = categories ?? [];
  const budgetList = budgets ?? [];
  const billList = bills ?? [];

  const monthKey = currentMonthKey();
  const netWorth = accList.reduce((sum, a) => sum + (Number(a.current_balance) || 0), 0);

  const monthTx = txList.filter((t) => t.date.startsWith(monthKey));
  const monthIncome = monthTx
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);
  const monthExpense = monthTx
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0);
  const monthNet = monthIncome - monthExpense;

  const catMap = new Map(catList.map((c) => [c.id, c]));
  const accMap = new Map(accList.map((a) => [a.id, a]));

  // Category spending breakdown for current month
  const catSpendMap = new Map<string, number>();
  for (const tx of monthTx) {
    if (tx.type !== 'expense') continue;
    const key = tx.category_id || 'uncategorized';
    catSpendMap.set(key, (catSpendMap.get(key) ?? 0) + Number(tx.amount));
  }
  const topCategories = Array.from(catSpendMap.entries())
    .map(([id, total]) => ({
      id,
      name: catMap.get(id)?.name ?? 'Uncategorized',
      color: catMap.get(id)?.color ?? '#64748B',
      total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const recentTx = [...txList]
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    .slice(0, 6);

  const monthBudgets = budgetList.filter((b) => b.period === monthKey).slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Sync Status Panel */}
      <SyncStatusCard
        onOpenConflicts={onOpenConflicts}
        onOpenSettings={() => onNavigate('settings')}
      />

      {/* 4-Column Financial KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Net Worth
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-slate-900 dark:text-slate-100">
            {formatMoney(netWorth, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Across {accList.length} active account{accList.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Monthly Income ({monthKey})
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-emerald-600 dark:text-emerald-400">
            {formatMoney(monthIncome, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {monthTx.filter((t) => t.type === 'income').length} inflow entries
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Monthly Expenses ({monthKey})
          </p>
          <p className="mt-2 text-2xl font-semibold font-mono-num text-red-600 dark:text-red-400">
            {formatMoney(monthExpense, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {monthTx.filter((t) => t.type === 'expense').length} outflow entries
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Net Cashflow
          </p>
          <p
            className={`mt-2 text-2xl font-semibold font-mono-num ${
              monthNet >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {monthNet >= 0 ? '+' : ''}
            {formatMoney(monthNet, currency)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {billList.length} upcoming unpaid bill{billList.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onQuickAdd('expense')}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Expense
        </button>
        <button
          type="button"
          onClick={() => onQuickAdd('income')}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <ArrowDownLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          Add Income
        </button>
        <button
          type="button"
          onClick={() => onQuickAdd('transfer')}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          <ArrowLeftRight className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          Transfer Money
        </button>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions (2 cols) */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Transactions
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              View full ledger
            </button>
          </div>

          {recentTx.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No transactions recorded yet. All entries are stored locally in IndexedDB and synced automatically when Google Sheets is connected.
              </p>
              <button
                type="button"
                onClick={() => onQuickAdd('expense')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-xs font-medium text-white dark:text-slate-900"
              >
                <Plus className="w-3.5 h-3.5" />
                Log First Transaction
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentTx.map((tx) => {
                const catName =
                  tx.type === 'transfer'
                    ? 'Transfer'
                    : catMap.get(tx.category_id ?? '')?.name ?? 'Uncategorized';
                const accName = accMap.get(tx.account_id)?.name ?? 'Account';
                const toAccName = tx.to_account_id
                  ? accMap.get(tx.to_account_id)?.name ?? 'Account'
                  : null;
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => onEditTx(tx)}
                    className="w-full flex items-center justify-between gap-4 py-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 px-2 -mx-2 rounded-lg transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {tx.type === 'income' ? (
                          <ArrowDownLeft className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : tx.type === 'transfer' ? (
                          <ArrowLeftRight className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                        )}
                        <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {tx.merchant || catName}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono-num">{tx.date}</span>
                        <span aria-hidden="true">·</span>
                        <span>{catName}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {toAccName ? `${accName} → ${toAccName}` : accName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            tx.sync_status === 'synced'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : tx.sync_status === 'conflict'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          {tx.sync_status === 'synced' ? 'Synced' : tx.sync_status === 'conflict' ? 'Conflict' : 'Pending'}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`shrink-0 text-sm font-semibold font-mono-num ${
                        tx.type === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : tx.type === 'transfer'
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                      {formatMoney(tx.amount, currency)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Category Breakdown & Budgets */}
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Top Spending ({monthKey})
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                Reports
              </button>
            </div>
            {topCategories.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 dark:text-slate-400">
                No expenses logged this month.
              </p>
            ) : (
              <div className="mt-4 space-y-3.5">
                {topCategories.map((c) => {
                  const pct = monthExpense > 0 ? Math.round((c.total / monthExpense) * 100) : 0;
                  return (
                    <div key={c.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {c.name}
                        </span>
                        <span className="font-mono-num text-slate-600 dark:text-slate-300">
                          {formatMoney(c.total, currency)} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: c.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Active Budgets
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('budgets')}
                className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                Manage
              </button>
            </div>
            {monthBudgets.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 dark:text-slate-400">
                No monthly budgets set for {monthKey}.
              </p>
            ) : (
              <div className="mt-4 space-y-3.5">
                {monthBudgets.map((b) => {
                  const spent = catSpendMap.get(b.category_id) ?? 0;
                  const pct = b.amount_limit > 0 ? Math.min(100, Math.round((spent / b.amount_limit) * 100)) : 0;
                  const over = spent > b.amount_limit;
                  return (
                    <div key={b.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {catMap.get(b.category_id)?.name ?? 'Category'}
                        </span>
                        <span
                          className={`font-mono-num ${
                            over
                              ? 'text-red-600 dark:text-red-400 font-semibold'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {formatMoney(spent, currency)} / {formatMoney(b.amount_limit, currency)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            over
                              ? 'bg-red-600'
                              : pct >= 80
                              ? 'bg-amber-500'
                              : 'bg-emerald-600'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

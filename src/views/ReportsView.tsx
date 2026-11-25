import React, { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download } from 'lucide-react';
import { db } from '../db/dexie';
import { CurrencyCode } from '../types/finance';
import { formatMoney } from '../utils/format';

interface ReportsViewProps {
  currency: CurrencyCode;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ currency }) => {
  const transactions = useLiveQuery(
    () => db.transactions.filter((t) => !t.deleted_at).toArray(),
    []
  );
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deleted_at).toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.filter((a) => !a.deleted_at).toArray(), []);

  const txList = transactions ?? [];
  const catMap = new Map((categories ?? []).map((c) => [c.id, c]));

  const monthlySeries = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months.map((m) => {
      const mTx = txList.filter((t) => t.date.startsWith(m));
      const income = mTx
        .filter((t) => t.type === 'income')
        .reduce((s, t) => s + Number(t.amount), 0);
      const expense = mTx
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + Number(t.amount), 0);
      return { month: m, income, expense };
    });
  }, [txList]);

  const maxMonthly = Math.max(
    1,
    ...monthlySeries.flatMap((m) => [m.income, m.expense])
  );

  const categorySummary = useMemo(() => {
    const map = new Map<string, { name: string; color: string; total: number; count: number }>();
    for (const tx of txList) {
      if (tx.type !== 'expense') continue;
      const key = tx.category_id || 'uncat';
      const cat = catMap.get(key);
      const existing = map.get(key) ?? {
        name: cat?.name ?? 'Uncategorized',
        color: cat?.color ?? '#64748B',
        total: 0,
        count: 0,
      };
      existing.total += Number(tx.amount);
      existing.count += 1;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [txList, catMap]);

  const totalAllExpenses = categorySummary.reduce((s, c) => s + c.total, 0);

  const handleDownloadJsonBackup = async () => {
    const backup = {
      exported_at: new Date().toISOString(),
      transactions: await db.transactions.toArray(),
      accounts: await db.accounts.toArray(),
      categories: await db.categories.toArray(),
      budgets: await db.budgets.toArray(),
      savings_goals: await db.savings_goals.toArray(),
      savings_contributions: await db.savings_contributions.toArray(),
      bills: await db.bills.toArray(),
      recurring_transactions: await db.recurring_transactions.toArray(),
      debts: await db.debts.toArray(),
      debt_payments: await db.debt_payments.toArray(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-money-offline-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Offline Financial Reports
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Computed locally from IndexedDB without requiring internet connectivity.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadJsonBackup}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Download className="w-3.5 h-3.5" />
          Export Full JSON Backup
        </button>
      </div>

      {/* 6-Month Income vs Expense Chart */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            6-Month Income vs. Expenses
          </h3>
          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" />
              Income
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-red-500" />
              Expenses
            </span>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-3 h-52 items-end pt-4 border-b border-slate-100 dark:border-slate-800 pb-2">
          {monthlySeries.map((m) => {
            const incH = Math.round((m.income / maxMonthly) * 160);
            const expH = Math.round((m.expense / maxMonthly) * 160);
            return (
              <div key={m.month} className="flex flex-col items-center gap-2 h-full justify-end">
                <div className="flex items-end gap-1.5 w-full justify-center">
                  <div
                    title={`Income: ${formatMoney(m.income, currency)}`}
                    className="w-4 sm:w-6 rounded-t bg-emerald-600 transition-all"
                    style={{ height: `${Math.max(2, incH)}px` }}
                  />
                  <div
                    title={`Expense: ${formatMoney(m.expense, currency)}`}
                    className="w-4 sm:w-6 rounded-t bg-red-500 transition-all"
                    style={{ height: `${Math.max(2, expH)}px` }}
                  />
                </div>
                <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                  {m.month}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category & Account Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">
            All-Time Expenses by Category
          </h3>
          {categorySummary.length === 0 ? (
            <p className="py-8 text-xs text-slate-500 dark:text-slate-400 text-center">
              No expense records available yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {categorySummary.map((c) => {
                const share =
                  totalAllExpenses > 0 ? Math.round((c.total / totalAllExpenses) * 100) : 0;
                return (
                  <div key={c.name} className="flex items-center justify-between py-2.5 text-xs">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {c.name}
                      </span>
                      <span className="text-slate-400 font-mono-num">({c.count})</span>
                    </div>
                    <div className="font-mono-num text-slate-700 dark:text-slate-300">
                      {formatMoney(c.total, currency)} · {share}%
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">
            Account Balances Summary
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(accounts ?? []).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2.5 text-xs">
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">{a.name}</div>
                  <div className="text-slate-400 capitalize">{a.type.replace('_', ' ')}</div>
                </div>
                <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  {formatMoney(a.current_balance, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

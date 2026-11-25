import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '../db/dexie';
import { saveBudget, softDeleteBudget } from '../db/repository';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BudgetRecord, CurrencyCode } from '../types/finance';
import { currentMonthKey, formatMoney } from '../utils/format';

interface BudgetsViewProps {
  currency: CurrencyCode;
  onNotify: (msg: string) => void;
}

export const BudgetsView: React.FC<BudgetsViewProps> = ({ currency, onNotify }) => {
  const [period, setPeriod] = useState(currentMonthKey());
  const categories = useLiveQuery(
    () => db.categories.filter((c) => !c.deleted_at && c.type === 'expense').toArray(),
    []
  );
  const budgets = useLiveQuery(
    () => db.budgets.filter((b) => !b.deleted_at && b.period === period).toArray(),
    [period]
  );
  const transactions = useLiveQuery(
    () => db.transactions.filter((t) => !t.deleted_at && t.type === 'expense').toArray(),
    []
  );

  const [categoryId, setCategoryId] = useState('');
  const [limit, setLimit] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BudgetRecord | null>(null);

  const catList = categories ?? [];
  const catMap = new Map(catList.map((c) => [c.id, c]));

  const spendByCat = new Map<string, number>();
  for (const tx of transactions ?? []) {
    if (!tx.date.startsWith(period) || !tx.category_id) continue;
    spendByCat.set(tx.category_id, (spendByCat.get(tx.category_id) ?? 0) + Number(tx.amount));
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetCat = categoryId || catList[0]?.id;
    const amt = Number(limit);
    if (!targetCat || !amt || amt <= 0) return;

    const existing = (budgets ?? []).find((b) => b.category_id === targetCat);
    await saveBudget({
      id: existing?.id,
      category_id: targetCat,
      amount_limit: amt,
      period,
    });
    setLimit('');
    onNotify('Budget saved locally.');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Monthly Category Budgets
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Track spending limits offline for any month.
            </p>
          </div>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm font-mono-num text-slate-900 dark:text-slate-100"
          />
        </div>

        <form onSubmit={handleSave} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Expense Category
            </label>
            <select
              value={categoryId || catList[0]?.id || ''}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              {catList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-44">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Limit ({currency})
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              required
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="5000"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Set Budget
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(budgets ?? []).length === 0 ? (
          <div className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No budgets configured for {period}. Use the form above to set your first limit.
          </div>
        ) : (
          (budgets ?? []).map((b) => {
            const cat = catMap.get(b.category_id);
            const spent = spendByCat.get(b.category_id) ?? 0;
            const remaining = b.amount_limit - spent;
            const pct = b.amount_limit > 0 ? Math.min(100, Math.round((spent / b.amount_limit) * 100)) : 0;
            const over = spent > b.amount_limit;

            return (
              <div
                key={b.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {cat?.name ?? 'Category'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                      {period} · {over ? 'Over budget' : `${pct}% used`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(b)}
                    aria-label="Delete budget"
                    className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      over ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono-num">
                  <span className="text-slate-600 dark:text-slate-300">
                    Spent: {formatMoney(spent, currency)}
                  </span>
                  <span
                    className={
                      over
                        ? 'text-red-600 dark:text-red-400 font-semibold'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }
                  >
                    {remaining >= 0
                      ? `Left: ${formatMoney(remaining, currency)}`
                      : `Over by ${formatMoney(Math.abs(remaining), currency)}`}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Soft-Delete Budget?"
        description="Remove this monthly budget limit and sync the deletion to Google Sheets?"
        confirmLabel="Delete Budget"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await softDeleteBudget(deleteTarget.id);
          setDeleteTarget(null);
          onNotify('Budget soft-deleted.');
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

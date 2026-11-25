import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '../db/dexie';
import {
  addSavingsContribution,
  saveSavingsGoal,
  softDeleteSavingsGoal,
} from '../db/repository';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CurrencyCode, SavingsGoalRecord } from '../types/finance';
import { formatMoney, todayISO } from '../utils/format';

interface GoalsViewProps {
  currency: CurrencyCode;
  onNotify: (msg: string) => void;
}

export const GoalsView: React.FC<GoalsViewProps> = ({ currency, onNotify }) => {
  const goals = useLiveQuery(() => db.savings_goals.filter((g) => !g.deleted_at).toArray(), []);
  const contributions = useLiveQuery(
    () => db.savings_contributions.filter((c) => !c.deleted_at).toArray(),
    []
  );
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.deleted_at && !a.is_archived).toArray(),
    []
  );

  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState(todayISO());
  const [contribGoalId, setContribGoalId] = useState<string | null>(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribAccountId, setContribAccountId] = useState('');
  const [contribNote, setContribNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SavingsGoalRecord | null>(null);

  const accList = accounts ?? [];

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || Number(targetAmount) <= 0) return;
    await saveSavingsGoal({
      name,
      target_amount: Number(targetAmount),
      target_date: targetDate,
    });
    setName('');
    setTargetAmount('');
    onNotify('Savings goal created locally.');
  };

  const handleContribute = async (e: React.FormEvent) => {
    e.preventDefault();
    const accId = contribAccountId || accList[0]?.id;
    if (!contribGoalId || !accId || Number(contribAmount) <= 0) return;
    await addSavingsContribution({
      goal_id: contribGoalId,
      account_id: accId,
      amount: Number(contribAmount),
      date: todayISO(),
      note: contribNote || 'Savings contribution',
    });
    setContribGoalId(null);
    setContribAmount('');
    setContribNote('');
    onNotify('Contribution recorded locally.');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Create Savings Goal
        </h2>
        <form onSubmit={handleCreateGoal} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Goal name (e.g., Emergency Fund)"
            className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <input
            type="number"
            step="0.01"
            min="1"
            required
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            placeholder={`Target (${currency})`}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100"
          />
          <div className="flex gap-2">
            <input
              type="date"
              required
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(goals ?? []).length === 0 ? (
          <div className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No savings goals yet. Create a target above to start tracking contributions.
          </div>
        ) : (
          (goals ?? []).map((goal) => {
            const pct =
              goal.target_amount > 0
                ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
                : 0;
            const goalContribs = (contributions ?? [])
              .filter((c) => c.goal_id === goal.id)
              .sort((a, b) => b.date.localeCompare(a.date));

            return (
              <div
                key={goal.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {goal.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                      Target date: {goal.target_date} · {goal.status} · {pct}%
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setContribGoalId(goal.id);
                        setContribAccountId(accList[0]?.id ?? '');
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      + Contribute
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(goal)}
                      aria-label="Delete savings goal"
                      className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono-num">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatMoney(goal.current_amount, currency)}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    Goal: {formatMoney(goal.target_amount, currency)}
                  </span>
                </div>

                {contribGoalId === goal.id && (
                  <form
                    onSubmit={handleContribute}
                    className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-2"
                  >
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={contribAmount}
                      onChange={(e) => setContribAmount(e.target.value)}
                      placeholder="Amount"
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-num"
                    />
                    <select
                      value={contribAccountId || accList[0]?.id || ''}
                      onChange={(e) => setContribAccountId(e.target.value)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    >
                      {accList.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-1.5">
                      <button
                        type="submit"
                        className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setContribGoalId(null)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {goalContribs.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    {goalContribs.slice(0, 3).map((c) => (
                      <div key={c.id} className="flex justify-between font-mono-num">
                        <span>{c.date} · {c.note}</span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          +{formatMoney(c.amount, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Soft-Delete Savings Goal?"
        description={`Mark "${deleteTarget?.name}" as deleted and sync to Google Sheets?`}
        confirmLabel="Delete Goal"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await softDeleteSavingsGoal(deleteTarget.id);
          setDeleteTarget(null);
          onNotify('Savings goal soft-deleted.');
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

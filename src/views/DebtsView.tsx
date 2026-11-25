import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '../db/dexie';
import { addDebtPayment, saveDebt, softDeleteDebt } from '../db/repository';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CurrencyCode, DebtRecord } from '../types/finance';
import { formatMoney, todayISO } from '../utils/format';

interface DebtsViewProps {
  currency: CurrencyCode;
  onNotify: (msg: string) => void;
}

export const DebtsView: React.FC<DebtsViewProps> = ({ currency, onNotify }) => {
  const debts = useLiveQuery(() => db.debts.filter((d) => !d.deleted_at).toArray(), []);
  const payments = useLiveQuery(
    () => db.debt_payments.filter((p) => !p.deleted_at).toArray(),
    []
  );
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.deleted_at && !a.is_archived).toArray(),
    []
  );

  const [person, setPerson] = useState('');
  const [direction, setDirection] = useState<'owed_to_me' | 'i_owe'>('i_owe');
  const [principal, setPrincipal] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const [payingDebtId, setPayingDebtId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DebtRecord | null>(null);

  const accList = accounts ?? [];

  const handleAddDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!person.trim() || Number(principal) <= 0) return;
    await saveDebt({
      person_or_entity: person,
      direction,
      principal_amount: Number(principal),
      due_date: dueDate,
      note,
    });
    setPerson('');
    setPrincipal('');
    setNote('');
    onNotify('Debt record saved locally.');
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const accId = payAccountId || accList[0]?.id;
    if (!payingDebtId || !accId || Number(payAmount) <= 0) return;
    await addDebtPayment({
      debt_id: payingDebtId,
      account_id: accId,
      amount: Number(payAmount),
      date: todayISO(),
      note: 'Debt repayment',
    });
    setPayingDebtId(null);
    setPayAmount('');
    onNotify('Debt payment recorded locally.');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Record Debt or Loan
        </h2>
        <form onSubmit={handleAddDebt} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            required
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Person or Lender (e.g., Rahim, Bank Loan)"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
          />
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'owed_to_me' | 'i_owe')}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="i_owe">I Owe (Payable)</option>
            <option value="owed_to_me">Owed to Me (Receivable)</option>
          </select>
          <input
            type="number"
            step="0.01"
            min="1"
            required
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            placeholder={`Principal (${currency})`}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num"
          />
          <input
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Save Debt
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(debts ?? []).length === 0 ? (
          <div className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No active debts or receivables recorded.
          </div>
        ) : (
          (debts ?? []).map((d) => {
            const paid = d.principal_amount - d.remaining_amount;
            const pct =
              d.principal_amount > 0
                ? Math.min(100, Math.round((paid / d.principal_amount) * 100))
                : 0;
            const debtPayments = (payments ?? []).filter((p) => p.debt_id === d.id);

            return (
              <div
                key={d.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {d.person_or_entity}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                      {d.direction === 'i_owe' ? 'Payable' : 'Receivable'} · Due {d.due_date} ·{' '}
                      {d.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.status !== 'settled' && accList[0] && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayingDebtId(d.id);
                          setPayAccountId(accList[0].id);
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Record Payment
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(d)}
                      aria-label="Delete debt"
                      className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono-num">
                  <span className="text-slate-600 dark:text-slate-300">
                    Remaining: {formatMoney(d.remaining_amount, currency)}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    Principal: {formatMoney(d.principal_amount, currency)}
                  </span>
                </div>

                {payingDebtId === d.id && (
                  <form
                    onSubmit={handleRecordPayment}
                    className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-2"
                  >
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="Amount"
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-num"
                    />
                    <select
                      value={payAccountId || accList[0]?.id || ''}
                      onChange={(e) => setPayAccountId(e.target.value)}
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
                        Pay
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayingDebtId(null)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {debtPayments.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1 font-mono-num">
                    {debtPayments.slice(0, 3).map((p) => (
                      <div key={p.id} className="flex justify-between">
                        <span>{p.date}</span>
                        <span>{formatMoney(p.amount, currency)}</span>
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
        title="Soft-Delete Debt?"
        description={`Mark debt with "${deleteTarget?.person_or_entity}" as deleted and sync to Google Sheets?`}
        confirmLabel="Delete Debt"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await softDeleteDebt(deleteTarget.id);
          setDeleteTarget(null);
          onNotify('Debt soft-deleted.');
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

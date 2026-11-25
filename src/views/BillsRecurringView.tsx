import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Play, Plus, Trash2 } from 'lucide-react';
import { db } from '../db/dexie';
import {
  markBillPaid,
  postRecurringNow,
  saveBill,
  saveRecurringTransaction,
  softDeleteBill,
  softDeleteRecurring,
} from '../db/repository';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  BillRecord,
  CurrencyCode,
  RecurringTransactionRecord,
} from '../types/finance';
import { formatMoney, todayISO } from '../utils/format';

interface BillsRecurringViewProps {
  currency: CurrencyCode;
  onNotify: (msg: string) => void;
}

export const BillsRecurringView: React.FC<BillsRecurringViewProps> = ({
  currency,
  onNotify,
}) => {
  const bills = useLiveQuery(() => db.bills.filter((b) => !b.deleted_at).toArray(), []);
  const recurring = useLiveQuery(
    () => db.recurring_transactions.filter((r) => !r.deleted_at).toArray(),
    []
  );
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.deleted_at && !a.is_archived).toArray(),
    []
  );
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deleted_at).toArray(), []);

  // Bill form
  const [billName, setBillName] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billDue, setBillDue] = useState(todayISO());
  const [billFreq, setBillFreq] = useState<BillRecord['frequency']>('monthly');

  // Recurring form
  const [recTitle, setRecTitle] = useState('');
  const [recType, setRecType] = useState<'expense' | 'income'>('expense');
  const [recAmount, setRecAmount] = useState('');
  const [recFreq, setRecFreq] = useState<RecurringTransactionRecord['frequency']>('monthly');
  const [recNextDate, setRecNextDate] = useState(todayISO());

  const [deleteBillTarget, setDeleteBillTarget] = useState<BillRecord | null>(null);
  const [deleteRecTarget, setDeleteRecTarget] = useState<RecurringTransactionRecord | null>(null);

  const accList = accounts ?? [];
  const catList = categories ?? [];

  const handleAddBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billName.trim() || Number(billAmount) <= 0) return;
    const defaultCat = catList.find((c) => c.type === 'expense')?.id ?? null;
    await saveBill({
      name: billName,
      amount: Number(billAmount),
      due_date: billDue,
      frequency: billFreq,
      category_id: defaultCat,
      account_id: accList[0]?.id ?? null,
    });
    setBillName('');
    setBillAmount('');
    onNotify('Bill saved locally.');
  };

  const handleAddRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    const accId = accList[0]?.id;
    if (!recTitle.trim() || !accId || Number(recAmount) <= 0) return;
    const catId = catList.find((c) => c.type === recType)?.id ?? null;
    await saveRecurringTransaction({
      title: recTitle,
      type: recType,
      amount: Number(recAmount),
      account_id: accId,
      category_id: catId,
      frequency: recFreq,
      next_run_date: recNextDate,
    });
    setRecTitle('');
    setRecAmount('');
    onNotify('Recurring schedule saved locally.');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Bills Section */}
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Add Upcoming Bill
          </h2>
          <form onSubmit={handleAddBill} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={billName}
              onChange={(e) => setBillName(e.target.value)}
              placeholder="Bill name (e.g., Internet, Rent)"
              className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <input
              type="number"
              step="0.01"
              min="1"
              required
              value={billAmount}
              onChange={(e) => setBillAmount(e.target.value)}
              placeholder={`Amount (${currency})`}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num"
            />
            <input
              type="date"
              required
              value={billDue}
              onChange={(e) => setBillDue(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num"
            />
            <select
              value={billFreq}
              onChange={(e) => setBillFreq(e.target.value as BillRecord['frequency'])}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="once">One-time</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Bill
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {(bills ?? []).length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No bills added yet.
            </p>
          ) : (
            (bills ?? []).map((bill) => (
              <div key={bill.id} className="flex items-center justify-between p-4 gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {bill.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                    Due {bill.due_date} · {bill.frequency} ·{' '}
                    <span
                      className={
                        bill.status === 'paid'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : bill.status === 'overdue'
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {bill.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="font-mono-num text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatMoney(bill.amount, currency)}
                  </span>
                  {bill.status !== 'paid' && accList[0] && (
                    <button
                      type="button"
                      onClick={async () => {
                        await markBillPaid(bill.id, bill.account_id || accList[0].id);
                        onNotify(`Paid "${bill.name}" and logged expense locally.`);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 dark:border-emerald-800 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                    >
                      <Check className="w-3 h-3" />
                      Mark Paid
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteBillTarget(bill)}
                    aria-label="Delete bill"
                    className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recurring Section */}
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Add Recurring Schedule
          </h2>
          <form onSubmit={handleAddRecurring} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={recTitle}
              onChange={(e) => setRecTitle(e.target.value)}
              placeholder="Title (e.g., Monthly Salary, Gym)"
              className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <select
              value={recType}
              onChange={(e) => setRecType(e.target.value as 'expense' | 'income')}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="1"
              required
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
              placeholder={`Amount (${currency})`}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num"
            />
            <select
              value={recFreq}
              onChange={(e) =>
                setRecFreq(e.target.value as RecurringTransactionRecord['frequency'])
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <div className="flex gap-2">
              <input
                type="date"
                required
                value={recNextDate}
                onChange={(e) => setRecNextDate(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-100 px-3.5 py-2 text-xs font-medium text-white dark:text-slate-900"
              >
                <Plus className="w-3.5 h-3.5" />
                Save
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {(recurring ?? []).length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No recurring transactions scheduled.
            </p>
          ) : (
            (recurring ?? []).map((rec) => (
              <div key={rec.id} className="flex items-center justify-between p-4 gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {rec.title}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-num mt-0.5">
                    {rec.type} · {rec.frequency} · Next: {rec.next_run_date}
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span
                    className={`font-mono-num text-sm font-semibold ${
                      rec.type === 'income'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatMoney(rec.amount, currency)}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await postRecurringNow(rec.id);
                      onNotify(`Posted "${rec.title}" transaction locally.`);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Play className="w-3 h-3" />
                    Post Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteRecTarget(rec)}
                    aria-label="Delete recurring transaction"
                    className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteBillTarget}
        title="Soft-Delete Bill?"
        description={`Mark bill "${deleteBillTarget?.name}" as deleted and sync to Google Sheets?`}
        confirmLabel="Delete Bill"
        destructive
        onConfirm={async () => {
          if (deleteBillTarget) await softDeleteBill(deleteBillTarget.id);
          setDeleteBillTarget(null);
          onNotify('Bill soft-deleted.');
        }}
        onCancel={() => setDeleteBillTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteRecTarget}
        title="Soft-Delete Recurring Rule?"
        description={`Mark "${deleteRecTarget?.title}" as deleted and sync to Google Sheets?`}
        confirmLabel="Delete Rule"
        destructive
        onConfirm={async () => {
          if (deleteRecTarget) await softDeleteRecurring(deleteRecTarget.id);
          setDeleteRecTarget(null);
          onNotify('Recurring schedule soft-deleted.');
        }}
        onCancel={() => setDeleteRecTarget(null)}
      />
    </div>
  );
};

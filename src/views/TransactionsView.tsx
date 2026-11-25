import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Edit2, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { db } from '../db/dexie';
import { restoreTransaction, softDeleteTransaction } from '../db/repository';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CurrencyCode, TransactionRecord } from '../types/finance';
import { formatMoney } from '../utils/format';

interface TransactionsViewProps {
  currency: CurrencyCode;
  onAddNew: () => void;
  onEditTx: (tx: TransactionRecord) => void;
  onNotify: (msg: string) => void;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  currency,
  onAddNew,
  onEditTx,
  onNotify,
}) => {
  const allTx = useLiveQuery(() => db.transactions.toArray(), []);
  const accounts = useLiveQuery(() => db.accounts.filter((a) => !a.deleted_at).toArray(), []);
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deleted_at).toArray(), []);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [syncFilter, setSyncFilter] = useState<'all' | 'pending' | 'synced' | 'failed' | 'conflict'>('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TransactionRecord | null>(null);

  const accMap = new Map((accounts ?? []).map((a) => [a.id, a]));
  const catMap = new Map((categories ?? []).map((c) => [c.id, c]));

  const filtered = useMemo(() => {
    const list = allTx ?? [];
    return list
      .filter((tx) => {
        if (!showDeleted && tx.deleted_at) return false;
        if (showDeleted && !tx.deleted_at) return false;
        if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
        if (
          accountFilter !== 'all' &&
          tx.account_id !== accountFilter &&
          tx.to_account_id !== accountFilter
        ) {
          return false;
        }
        if (syncFilter !== 'all' && (tx.sync_status ?? 'pending') !== syncFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          const cat = catMap.get(tx.category_id ?? '')?.name.toLowerCase() ?? '';
          const acc = accMap.get(tx.account_id)?.name.toLowerCase() ?? '';
          if (
            !tx.merchant.toLowerCase().includes(q) &&
            !tx.note.toLowerCase().includes(q) &&
            !cat.includes(q) &&
            !acc.includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.updated_at.localeCompare(a.updated_at));
  }, [allTx, showDeleted, typeFilter, accountFilter, syncFilter, search, catMap, accMap]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    await softDeleteTransaction(deleteTarget.id);
    setDeleteTarget(null);
    onNotify('Transaction soft-deleted and queued for Google Sheets sync.');
  };

  const handleRestore = async (id: string) => {
    await restoreTransaction(id);
    onNotify('Transaction restored and queued for sync.');
  };

  const handleExportCsv = () => {
    const headers = ['id', 'date', 'type', 'merchant', 'category', 'account', 'amount', 'currency', 'note', 'sync_status', 'deleted_at'];
    const rows = filtered.map((t) => [
      t.id,
      t.date,
      t.type,
      `"${(t.merchant || '').replace(/"/g, '""')}"`,
      `"${(catMap.get(t.category_id ?? '')?.name ?? '').replace(/"/g, '""')}"`,
      `"${(accMap.get(t.account_id)?.name ?? '').replace(/"/g, '""')}"`,
      t.amount,
      t.currency,
      `"${(t.note || '').replace(/"/g, '""')}"`,
      t.sync_status ?? 'pending',
      t.deleted_at ?? '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-money-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
              {(['all', 'expense', 'income', 'transfer'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    typeFilter === t
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowDeleted((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showDeleted
                  ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {showDeleted ? 'Viewing Soft-Deleted' : 'Show Deleted'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={onAddNew}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Transaction
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant, note, category..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="all">All Accounts</option>
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            value={syncFilter}
            onChange={(e) =>
              setSyncFilter(e.target.value as 'all' | 'pending' | 'synced' | 'failed' | 'conflict')
            }
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="all">All Sync States</option>
            <option value="synced">Synced</option>
            <option value="pending">Pending Sync</option>
            <option value="failed">Failed</option>
            <option value="conflict">Conflict</option>
          </select>
        </div>
      </div>

      {/* Ledger Data Grid */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {showDeleted
                ? 'No soft-deleted transactions found.'
                : 'No transactions match your current filters.'}
            </p>
            {!showDeleted && (
              <button
                type="button"
                onClick={onAddNew}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-xs font-medium text-white dark:text-slate-900"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Transaction
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-left text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Payee / Description</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Account</th>
                  <th className="py-3 px-4">Sync</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((tx) => {
                  const catName =
                    tx.type === 'transfer'
                      ? 'Transfer'
                      : catMap.get(tx.category_id ?? '')?.name ?? 'Uncategorized';
                  const accName = accMap.get(tx.account_id)?.name ?? 'Account';
                  const toName = tx.to_account_id ? accMap.get(tx.to_account_id)?.name : null;
                  const syncLabel =
                    tx.sync_status === 'synced'
                      ? 'Synced'
                      : tx.sync_status === 'conflict'
                      ? 'Conflict'
                      : tx.sync_status === 'failed'
                      ? 'Failed'
                      : 'Pending';

                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono-num text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {tx.date}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {tx.merchant || catName}
                        </div>
                        {tx.note && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                            {tx.note}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {catName}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {toName ? `${accName} → ${toName}` : accName}
                      </td>
                      <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                        <span
                          className={
                            syncLabel === 'Synced'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : syncLabel === 'Conflict'
                              ? 'text-amber-700 dark:text-amber-400 font-medium'
                              : syncLabel === 'Failed'
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          {syncLabel} · v{tx.sync_version}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono-num font-semibold whitespace-nowrap ${
                          tx.type === 'income'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : tx.type === 'transfer'
                            ? 'text-slate-700 dark:text-slate-200'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                        {formatMoney(tx.amount, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {tx.deleted_at ? (
                          <button
                            type="button"
                            onClick={() => handleRestore(tx.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Restore
                          </button>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditTx(tx)}
                              aria-label="Edit transaction"
                              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(tx)}
                              aria-label="Delete transaction"
                              className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Soft-Delete Transaction?"
        description={
          deleteTarget
            ? `This will mark "${deleteTarget.merchant || 'Transaction'}" (${formatMoney(
                deleteTarget.amount,
                currency
              )}) as deleted with a deleted_at timestamp, update account balances, and sync the deletion to Google Sheets.`
            : ''
        }
        confirmLabel="Delete Transaction"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

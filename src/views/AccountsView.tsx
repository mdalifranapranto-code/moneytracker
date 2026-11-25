import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '../db/dexie';
import {
  saveAccount,
  saveCategory,
  seedDefaultCategories,
  softDeleteAccount,
  softDeleteCategory,
} from '../db/repository';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AccountRecord, CategoryRecord, CurrencyCode } from '../types/finance';
import { formatMoney } from '../utils/format';

interface AccountsViewProps {
  currency: CurrencyCode;
  onNotify: (msg: string) => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ currency, onNotify }) => {
  const accounts = useLiveQuery(() => db.accounts.filter((a) => !a.deleted_at).toArray(), []);
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deleted_at).toArray(), []);

  // Account form state
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountRecord['type']>('bank');
  const [accBalance, setAccBalance] = useState('0');
  const [accInst, setAccInst] = useState('');
  const [editingAccId, setEditingAccId] = useState<string | null>(null);

  // Category form state
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'expense' | 'income'>('expense');
  const [catColor, setCatColor] = useState('#059669');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<'all' | 'expense' | 'income'>('all');

  const [deleteAccTarget, setDeleteAccTarget] = useState<AccountRecord | null>(null);
  const [deleteCatTarget, setDeleteCatTarget] = useState<CategoryRecord | null>(null);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) return;
    await saveAccount({
      id: editingAccId ?? undefined,
      name: accName,
      type: accType,
      initial_balance: Number(accBalance) || 0,
      currency,
      institution: accInst || 'Personal',
    });
    setAccName('');
    setAccBalance('0');
    setAccInst('');
    setEditingAccId(null);
    onNotify(editingAccId ? 'Account updated locally.' : 'Account added locally.');
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    await saveCategory({
      id: editingCatId ?? undefined,
      name: catName,
      type: catType,
      color: catColor,
    });
    setCatName('');
    setEditingCatId(null);
    onNotify(editingCatId ? 'Category updated locally.' : 'Category saved locally.');
  };

  const handleLoadPresets = async () => {
    const added = await seedDefaultCategories(true);
    onNotify(
      added > 0
        ? `Added ${added} standard preset categor${added === 1 ? 'y' : 'ies'}.`
        : 'All standard categories are already present.'
    );
  };

  const visibleCategories = (categories ?? [])
    .filter((c) => (catFilter === 'all' ? true : c.type === catFilter))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Accounts Column */}
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {editingAccId ? 'Edit Account' : 'Add Financial Account'}
          </h2>
          <form onSubmit={handleSaveAccount} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              placeholder="Account name (e.g., Dutch-Bangla, bKash)"
              className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <select
              value={accType}
              onChange={(e) => setAccType(e.target.value as AccountRecord['type'])}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank Account</option>
              <option value="mobile_wallet">Mobile Wallet (bKash/Nagad)</option>
              <option value="savings">Savings</option>
              <option value="credit">Credit Card</option>
            </select>
            <input
              type="number"
              step="0.01"
              value={accBalance}
              onChange={(e) => setAccBalance(e.target.value)}
              placeholder="Opening balance"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={accInst}
              onChange={(e) => setAccInst(e.target.value)}
              placeholder="Institution / Bank name"
              className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <div className="sm:col-span-2 flex justify-end gap-2">
              {editingAccId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingAccId(null);
                    setAccName('');
                    setAccBalance('0');
                    setAccInst('');
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {editingAccId ? 'Update Account' : 'Add Account'}
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
          {(accounts ?? []).map((acc) => (
            <div key={acc.id} className="flex items-center justify-between p-4 gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {acc.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {acc.type.replace('_', ' ')} · {acc.institution} ·{' '}
                  {acc.sync_status === 'synced' ? 'Synced' : 'Pending'}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono-num text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {formatMoney(acc.current_balance, currency)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingAccId(acc.id);
                    setAccName(acc.name);
                    setAccType(acc.type);
                    setAccBalance(String(acc.initial_balance));
                    setAccInst(acc.institution);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteAccTarget(acc)}
                  aria-label="Delete account"
                  className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Categories Column */}
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {editingCatId ? 'Edit Category' : 'Add Category'}
            </h2>
            <button
              type="button"
              onClick={handleLoadPresets}
              className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              Restore Missing Presets
            </button>
          </div>
          <form onSubmit={handleSaveCategory} className="mt-4 flex flex-wrap gap-3">
            <input
              type="text"
              required
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="Category name"
              className="flex-1 min-w-[160px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <select
              value={catType}
              onChange={(e) => setCatType(e.target.value as 'expense' | 'income')}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
            <input
              type="color"
              value={catColor}
              onChange={(e) => setCatColor(e.target.value)}
              className="h-9 w-12 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-1 cursor-pointer"
            />
            {editingCatId && (
              <button
                type="button"
                onClick={() => {
                  setEditingCatId(null);
                  setCatName('');
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-xs font-medium text-white dark:text-slate-900 hover:opacity-90"
            >
              <Plus className="w-3.5 h-3.5" />
              {editingCatId ? 'Update' : 'Add'}
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 font-mono-num">
              {visibleCategories.length} categories
            </span>
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
              {(['all', 'expense', 'income'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setCatFilter(f)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    catFilter === f
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
            {visibleCategories.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between p-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-sm shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {cat.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                      {cat.type} · {cat.sync_status === 'synced' ? 'Synced' : 'Pending'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCatId(cat.id);
                      setCatName(cat.name);
                      setCatType(cat.type);
                      setCatColor(cat.color);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteCatTarget(cat)}
                    aria-label="Delete category"
                    className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteAccTarget}
        title="Soft-Delete Account?"
        description={`Mark "${deleteAccTarget?.name}" as deleted and sync this change to Google Sheets?`}
        confirmLabel="Delete Account"
        destructive
        onConfirm={async () => {
          if (deleteAccTarget) await softDeleteAccount(deleteAccTarget.id);
          setDeleteAccTarget(null);
          onNotify('Account soft-deleted.');
        }}
        onCancel={() => setDeleteAccTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteCatTarget}
        title="Soft-Delete Category?"
        description={`Mark "${deleteCatTarget?.name}" as deleted and sync this change to Google Sheets?`}
        confirmLabel="Delete Category"
        destructive
        onConfirm={async () => {
          if (deleteCatTarget) await softDeleteCategory(deleteCatTarget.id);
          setDeleteCatTarget(null);
          onNotify('Category soft-deleted.');
        }}
        onCancel={() => setDeleteCatTarget(null)}
      />
    </div>
  );
};

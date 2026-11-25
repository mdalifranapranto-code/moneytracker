import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Menu,
  Moon,
  PiggyBank,
  Plus,
  ReceiptText,
  Settings,
  Sun,
  Target,
  X,
} from 'lucide-react';
import { ConflictResolutionModal } from './components/ConflictResolutionModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { TransactionModal } from './components/TransactionModal';
import {
  ensureInitialBootstrap,
  getCurrencyPreference,
  setCurrencyPreference,
} from './db/repository';
import { initSyncLifecycle } from './services/platformLifecycle';
import { useSyncStatus } from './services/syncEngine';
import { CurrencyCode, TransactionRecord, TransactionType } from './types/finance';
import { AccountsView } from './views/AccountsView';
import { BillsRecurringView } from './views/BillsRecurringView';
import { BudgetsView } from './views/BudgetsView';
import { DashboardView } from './views/DashboardView';
import { DebtsView } from './views/DebtsView';
import { GoalsView } from './views/GoalsView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { TransactionsView } from './views/TransactionsView';

type NavTabId =
  | 'dashboard'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'goals'
  | 'bills'
  | 'debts'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{ id: NavTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText },
  { id: 'accounts', label: 'Accounts', icon: CreditCard },
  { id: 'budgets', label: 'Budgets', icon: Target },
  { id: 'goals', label: 'Savings Goals', icon: PiggyBank },
  { id: 'bills', label: 'Bills & Recurring', icon: CalendarClock },
  { id: 'debts', label: 'Debts', icon: HandCoins },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [currency, setCurrency] = useState<CurrencyCode>('BDT');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('my-money-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalType, setTxModalType] = useState<TransactionType>('expense');
  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const syncStatus = useSyncStatus();

  useEffect(() => {
    let cleanupLifecycle: (() => void) | undefined;

    (async () => {
      await ensureInitialBootstrap();
      const prefCur = await getCurrencyPreference();
      setCurrency(prefCur);
      setReady(true);
      cleanupLifecycle = initSyncLifecycle();
    })();

    return () => {
      cleanupLifecycle?.();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('my-money-theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const handleCurrencyChange = async (next: CurrencyCode) => {
    setCurrency(next);
    await setCurrencyPreference(next);
  };

  const openQuickTx = (type: TransactionType) => {
    setEditingTx(null);
    setTxModalType(type);
    setTxModalOpen(true);
  };

  const openEditTx = (tx: TransactionRecord) => {
    setEditingTx(tx);
    setTxModalType(tx.type);
    setTxModalOpen(true);
  };

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-sm">
        Initializing local IndexedDB ledger...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar (260px) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            My Money
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <div className="flex items-center justify-between">
            <span>{syncStatus.isOnline ? 'Online' : 'Offline Mode'}</span>
            <span className="font-mono-num">{currency}</span>
          </div>
          <div className="truncate">
            {syncStatus.engineState} · {syncStatus.pendingCount} pending
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="h-14 flex items-center justify-between px-5 border-b border-slate-200 dark:border-slate-800">
              <span className="font-display text-base font-bold">My Money</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-16 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
              {currentNav.label}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label="Toggle Light/Dark theme"
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => openQuickTx('expense')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Transaction</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              currency={currency}
              onQuickAdd={openQuickTx}
              onEditTx={openEditTx}
              onNavigate={(tab) => setActiveTab(tab as NavTabId)}
              onOpenConflicts={() => setConflictsOpen(true)}
            />
          )}
          {activeTab === 'transactions' && (
            <TransactionsView
              currency={currency}
              onAddNew={() => openQuickTx('expense')}
              onEditTx={openEditTx}
              onNotify={showToast}
            />
          )}
          {activeTab === 'accounts' && (
            <AccountsView currency={currency} onNotify={showToast} />
          )}
          {activeTab === 'budgets' && (
            <BudgetsView currency={currency} onNotify={showToast} />
          )}
          {activeTab === 'goals' && (
            <GoalsView currency={currency} onNotify={showToast} />
          )}
          {activeTab === 'bills' && (
            <BillsRecurringView currency={currency} onNotify={showToast} />
          )}
          {activeTab === 'debts' && (
            <DebtsView currency={currency} onNotify={showToast} />
          )}
          {activeTab === 'reports' && <ReportsView currency={currency} />}
          {activeTab === 'settings' && (
            <SettingsView
              currency={currency}
              theme={theme}
              onChangeCurrency={handleCurrencyChange}
              onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              onOpenConflicts={() => setConflictsOpen(true)}
              onNotify={showToast}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <TransactionModal
        open={txModalOpen}
        initialTx={editingTx}
        defaultType={txModalType}
        currency={currency}
        onClose={() => setTxModalOpen(false)}
        onSaved={showToast}
      />

      <ConflictResolutionModal
        open={conflictsOpen}
        onClose={() => setConflictsOpen(false)}
      />

      {/* Non-blocking Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-900 dark:bg-slate-100 px-4 py-2.5 text-xs font-medium text-white dark:text-slate-900 shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

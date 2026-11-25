import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  LogOut,
  Plus,
  RefreshCw,
  ShieldAlert,
  SunMoon,
} from 'lucide-react';
import { db } from '../db/dexie';
import {
  addSyncLog,
  getGoogleConnection,
  saveGoogleConnection,
} from '../db/repository';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SyncStatusCard } from '../components/SyncStatusCard';
import {
  disconnectGoogleAccount,
  getAccessToken,
  googleSignIn,
} from '../services/googleAuth';
import {
  createLedgerSpreadsheet,
  DriveSpreadsheetFile,
  ensureRequiredTabsAndHeaders,
  listUserSpreadsheets,
} from '../services/googleSheetsApi';
import {
  queueAllLocalRecordsForInitialSync,
  refreshSyncSnapshot,
  runSync,
  useSyncStatus,
} from '../services/syncEngine';
import {
  ALL_SHEET_TABS,
  CURRENCY_MAP,
  CurrencyCode,
  SHEET_HEADERS,
} from '../types/finance';

interface SettingsViewProps {
  currency: CurrencyCode;
  theme: 'light' | 'dark';
  onChangeCurrency: (c: CurrencyCode) => void;
  onToggleTheme: () => void;
  onOpenConflicts: () => void;
  onNotify: (msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currency,
  theme,
  onChangeCurrency,
  onToggleTheme,
  onOpenConflicts,
  onNotify,
}) => {
  const syncStatus = useSyncStatus();
  const logs = useLiveQuery(
    () => db.sync_logs.orderBy('timestamp').reverse().limit(40).toArray(),
    []
  );
  const queueItems = useLiveQuery(() => db.sync_queue.toArray(), []);

  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [newSheetTitle, setNewSheetTitle] = useState('My Money Ledger');
  const [creatingSheet, setCreatingSheet] = useState(false);

  const [driveFiles, setDriveFiles] = useState<DriveSpreadsheetFile[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pendingExistingSheet, setPendingExistingSheet] = useState<DriveSpreadsheetFile | null>(
    null
  );

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmFullPush, setConfirmFullPush] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleConnectGoogle = async () => {
    setActionError(null);
    setIsAuthorizing(true);
    try {
      await googleSignIn();
      await refreshSyncSnapshot();
      onNotify('Google account authorized. Select or create a spreadsheet below.');
      const conn = await getGoogleConnection();
      if (conn.spreadsheetId) {
        await runSync({ manual: true });
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Google authorization failed.');
    } finally {
      setIsAuthorizing(false);
    }
  };

  const handleCreateSpreadsheet = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = getAccessToken();
    if (!token) {
      setActionError('Authorize your Google account first.');
      return;
    }
    setActionError(null);
    setCreatingSheet(true);
    try {
      const meta = await createLedgerSpreadsheet(
        token,
        newSheetTitle.trim() || 'My Money Ledger'
      );
      const existingConn = await getGoogleConnection();
      await saveGoogleConnection({
        ...existingConn,
        spreadsheetId: meta.spreadsheetId,
        spreadsheetTitle: meta.title,
        spreadsheetUrl: meta.spreadsheetUrl,
        verifiedAt: new Date().toISOString(),
      });
      await addSyncLog('success', `Created 11-tab spreadsheet "${meta.title}"`, meta.spreadsheetId);
      const queued = await queueAllLocalRecordsForInitialSync();
      onNotify(`Spreadsheet "${meta.title}" created (${queued} local records queued).`);
      await runSync({ manual: true });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to create spreadsheet.');
    } finally {
      setCreatingSheet(false);
    }
  };

  const handleBrowseDrive = async () => {
    const token = getAccessToken();
    if (!token) {
      setActionError('Authorize your Google account first.');
      return;
    }
    setActionError(null);
    setLoadingDrive(true);
    setShowPickerModal(true);
    try {
      const files = await listUserSpreadsheets(token);
      setDriveFiles(files);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Unable to list Drive spreadsheets.');
      setShowPickerModal(false);
    } finally {
      setLoadingDrive(false);
    }
  };

  const handleConfirmLinkExisting = async () => {
    if (!pendingExistingSheet) return;
    const token = getAccessToken();
    if (!token) {
      setPendingExistingSheet(null);
      setActionError('Google authorization expired. Please reconnect.');
      return;
    }
    setActionError(null);
    try {
      const meta = await ensureRequiredTabsAndHeaders(token, pendingExistingSheet.id);
      const existingConn = await getGoogleConnection();
      await saveGoogleConnection({
        ...existingConn,
        spreadsheetId: meta.spreadsheetId,
        spreadsheetTitle: meta.title,
        spreadsheetUrl: meta.spreadsheetUrl,
        verifiedAt: new Date().toISOString(),
      });
      await addSyncLog(
        'success',
        `Linked existing spreadsheet "${meta.title}" with 11 verified tabs`,
        meta.spreadsheetId
      );
      setPendingExistingSheet(null);
      setShowPickerModal(false);
      await queueAllLocalRecordsForInitialSync();
      onNotify(`Linked "${meta.title}" and started sync.`);
      await runSync({ manual: true });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to prepare spreadsheet tabs.');
      setPendingExistingSheet(null);
    }
  };

  const handleConfirmDisconnect = async () => {
    await disconnectGoogleAccount();
    await refreshSyncSnapshot();
    setConfirmDisconnect(false);
    onNotify('Disconnected Google Sheets. All local data remains safely in IndexedDB.');
  };

  const handleConfirmFullPush = async () => {
    setConfirmFullPush(false);
    const count = await queueAllLocalRecordsForInitialSync();
    onNotify(`Queued ${count} local records for synchronization.`);
    await runSync({ manual: true });
  };

  const hasToken = !!getAccessToken();

  return (
    <div className="space-y-6">
      {/* Live Sync Status Card */}
      <SyncStatusCard onOpenConflicts={onOpenConflicts} />

      {/* Preferences */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          App Preferences
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Default Currency
            </label>
            <select
              value={currency}
              onChange={(e) => {
                onChangeCurrency(e.target.value as CurrencyCode);
                onNotify(`Default currency updated to ${e.target.value}.`);
              }}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              {Object.values(CURRENCY_MAP).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol}) — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Appearance
            </label>
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-full flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <span>{theme === 'dark' ? 'Dark Ledger Theme' : 'Light Ledger Theme'}</span>
              <SunMoon className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>
      </section>

      {/* Google Sheets Integration */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Google Sheets Synchronization
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Connect your Google account via OAuth 2.0 to automatically sync all 11 ledger tabs whenever online.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSetupGuide((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <BookOpen className="w-3.5 h-3.5" />
            {showSetupGuide ? 'Hide Setup Guide' : 'Cloud & API Setup Guide'}
          </button>
        </div>

        {actionError && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-xs text-red-700 dark:text-red-300">
            {actionError}
          </div>
        )}

        {/* Step 1: Google Account Auth */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Google Account
            </div>
            {syncStatus.connectedEmail ? (
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                <CheckCircle2
                  className={`w-4 h-4 ${
                    hasToken
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-500'
                  }`}
                />
                <span>{syncStatus.connectedEmail}</span>
                {!hasToken && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">
                    (Authorization expired — reconnect required)
                  </span>
                )}
              </div>
            ) : (
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Not connected — local offline mode active
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(!hasToken || !syncStatus.connectedEmail) && (
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={isAuthorizing || !syncStatus.isOnline}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                  </div>
                  <span>
                    {isAuthorizing
                      ? 'Authorizing...'
                      : syncStatus.connectedEmail
                      ? 'Reconnect Google'
                      : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            )}

            {syncStatus.connectedEmail && (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/60 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* Step 2: Spreadsheet Selection or Creation */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Target Google Spreadsheet
              </div>
              {syncStatus.spreadsheetTitle ? (
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{syncStatus.spreadsheetTitle}</span>
                  {syncStatus.spreadsheetUrl && (
                    <a
                      href={syncStatus.spreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-normal text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      Open Sheet <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  No spreadsheet linked yet
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleBrowseDrive}
                disabled={!hasToken || !syncStatus.isOnline}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Select Existing Spreadsheet
              </button>

              {syncStatus.spreadsheetTitle && (
                <button
                  type="button"
                  onClick={() => setConfirmFullPush(true)}
                  disabled={!hasToken || !syncStatus.isOnline}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Push All Local Records
                </button>
              )}
            </div>
          </div>

          <form
            onSubmit={handleCreateSpreadsheet}
            className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800"
          >
            <input
              type="text"
              value={newSheetTitle}
              onChange={(e) => setNewSheetTitle(e.target.value)}
              placeholder="New spreadsheet title"
              className="flex-1 min-w-[200px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={!hasToken || creatingSheet || !syncStatus.isOnline}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              {creatingSheet ? 'Creating 11 Tabs...' : 'Create New 11-Tab Spreadsheet'}
            </button>
          </form>
        </div>

        {/* 11-Tab Schema Inspector */}
        <div>
          <button
            type="button"
            onClick={() => setShowSchema((v) => !v)}
            className="text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            {showSchema ? 'Hide 11-Tab Google Sheets Schema' : 'Inspect 11-Tab Google Sheets Schema'}
          </button>

          {showSchema && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {ALL_SHEET_TABS.map((tab) => (
                <div
                  key={tab}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs"
                >
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{tab}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400 break-words">
                    {SHEET_HEADERS[tab].join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Setup Guide (Collapsible) */}
      {showSetupGuide && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Google Cloud OAuth, Sheets API & Background Sync Setup Guide
          </h3>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              <strong>Google Cloud Console</strong>: Enable <em>Google Sheets API</em> and{' '}
              <em>Google Drive API</em> under APIs & Services in your GCP project.
            </li>
            <li>
              <strong>OAuth Consent Screen</strong>: Configure your app name and request minimal scopes:{' '}
              <code className="font-mono">spreadsheets</code>,{' '}
              <code className="font-mono">drive.file</code>, and{' '}
              <code className="font-mono">drive.metadata.readonly</code>.
            </li>
            <li>
              <strong>Zero Frontend Secrets</strong>: Access tokens are obtained client-side via Firebase OAuth 2.0 popup and held strictly in memory (never hardcoded or stored in localStorage).
            </li>
            <li>
              <strong>Android / Capacitor Background Sync</strong>: When wrapping with Capacitor, install{' '}
              <code className="font-mono">@capacitor/app</code> and{' '}
              <code className="font-mono">@capacitor/network</code>; our lifecycle bridge automatically attaches to <code className="font-mono">appStateChange</code> and <code className="font-mono">networkStatusChange</code>.
            </li>
          </ol>
        </section>
      )}

      {/* Sync Queue & Activity Log */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Sync Queue & Audit Log
          </h2>
          <span className="text-xs font-mono-num text-slate-500 dark:text-slate-400">
            {(queueItems ?? []).length} queued operations
          </span>
        </div>

        {(queueItems ?? []).length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
            {(queueItems ?? []).map((q) => (
              <div
                key={q.op_id}
                className="flex items-center justify-between px-3 py-2 text-xs font-mono-num"
              >
                <span className="text-slate-700 dark:text-slate-200">
                  {q.entity} · {q.action} · {q.record_id.slice(0, 8)}...
                </span>
                <span
                  className={
                    q.status === 'failed'
                      ? 'text-red-600 dark:text-red-400'
                      : q.status === 'conflict'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }
                >
                  {q.status} (retries: {q.retry_count})
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
          {(logs ?? []).length === 0 ? (
            <p className="py-4 text-xs text-slate-500 dark:text-slate-400">
              No sync events recorded yet.
            </p>
          ) : (
            (logs ?? []).map((log) => (
              <div key={log.id} className="py-2 text-xs flex items-start justify-between gap-4">
                <div>
                  <span
                    className={`font-medium ${
                      log.level === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : log.level === 'warn'
                        ? 'text-amber-600 dark:text-amber-400'
                        : log.level === 'success'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {log.message}
                  </span>
                  {log.details && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 break-all">
                      {log.details}
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-mono-num text-slate-400 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Drive Spreadsheet Picker Modal */}
      {showPickerModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Select Existing Google Spreadsheet
              </h3>
              <button
                type="button"
                onClick={() => setShowPickerModal(false)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Close
              </button>
            </div>

            {loadingDrive ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Loading spreadsheets from Google Drive...
              </p>
            ) : driveFiles.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                No spreadsheets found in your Google Drive.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                {driveFiles.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setPendingExistingSheet(f)}
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {f.name}
                      </span>
                    </div>
                    <span className="text-xs font-mono-num text-slate-400 shrink-0 ml-2">
                      {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialogs (Workspace Integration Mandatory Rule) */}
      <ConfirmDialog
        open={!!pendingExistingSheet}
        title="Initialize & Sync Selected Spreadsheet?"
        description={`Linking "${pendingExistingSheet?.name}" will verify and create any missing tabs among the 11 My Money ledger sheets (Transactions, Accounts, Categories, Budgets, Savings_Goals, Savings_Contributions, Bills, Recurring_Transactions, Debts, Debt_Payments, Sync_Metadata) and merge your records.`}
        confirmLabel="Confirm & Link Sheet"
        onConfirm={handleConfirmLinkExisting}
        onCancel={() => setPendingExistingSheet(null)}
      />

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Google Sheets?"
        description="This will sign out of Google and unlink the remote spreadsheet. Your local financial data and sync queue in IndexedDB will NOT be deleted."
        confirmLabel="Disconnect"
        destructive
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <ConfirmDialog
        open={confirmFullPush}
        title="Push All Local Records to Google Sheets?"
        description="This will enqueue any unsynchronized local records and update matching rows in your linked Google Spreadsheet by UUID without creating duplicates."
        confirmLabel="Push & Sync Now"
        onConfirm={handleConfirmFullPush}
        onCancel={() => setConfirmFullPush(false)}
      />
    </div>
  );
};

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  ExternalLink,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { googleSignIn } from '../services/googleAuth';
import { runSync, useSyncStatus } from '../services/syncEngine';
import { formatRelativeTime } from '../utils/format';

interface SyncStatusCardProps {
  compact?: boolean;
  onOpenConflicts?: () => void;
  onOpenSettings?: () => void;
}

export const SyncStatusCard: React.FC<SyncStatusCardProps> = ({
  compact = false,
  onOpenConflicts,
  onOpenSettings,
}) => {
  const status = useSyncStatus();
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleSyncNow = async () => {
    await runSync({ manual: true });
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await googleSignIn();
      await runSync({ manual: true });
    } catch {
      // Logged in sync_logs
    } finally {
      setIsReconnecting(false);
    }
  };

  const stateColor = (() => {
    switch (status.engineState) {
      case 'Synced':
        return 'text-emerald-700 dark:text-emerald-400';
      case 'Syncing':
        return 'text-sky-700 dark:text-sky-400';
      case 'Pending':
      case 'Offline':
        return 'text-amber-700 dark:text-amber-400';
      case 'Failed':
        return 'text-red-700 dark:text-red-400';
      case 'Disconnected':
        return 'text-slate-600 dark:text-slate-400';
    }
  })();

  const progressPct =
    status.progressTotal > 0
      ? Math.min(100, Math.round((status.progressCurrent / status.progressTotal) * 100))
      : 0;

  return (
    <section
      aria-label="Synchronization Status"
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={`inline-flex items-center gap-1.5 font-semibold ${stateColor}`}>
              {status.engineState === 'Synced' && <CheckCircle2 className="w-4 h-4" />}
              {status.engineState === 'Syncing' && <RefreshCw className="w-4 h-4 animate-spin" />}
              {(status.engineState === 'Pending' || status.engineState === 'Offline') && (
                <AlertCircle className="w-4 h-4" />
              )}
              {status.engineState === 'Failed' && <AlertCircle className="w-4 h-4" />}
              {status.engineState === 'Disconnected' && <CloudOff className="w-4 h-4" />}
              <span>Status: {status.engineState}</span>
            </span>

            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>

            <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              {status.isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Offline</span>
                </>
              )}
            </span>

            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>

            <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              {status.isConnected ? (
                <>
                  <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Google Sheets Connected</span>
                </>
              ) : (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    {status.tokenExpired
                      ? 'Google Sheets Reconnect Needed'
                      : 'Google Sheets Disconnected'}
                  </span>
                </>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
            <span>Last sync: {formatRelativeTime(status.lastSyncAt)}</span>
            <span aria-hidden="true">·</span>
            <span>Pending: {status.pendingCount}</span>
            <span aria-hidden="true">·</span>
            <span className={status.failedCount > 0 ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
              Failed: {status.failedCount}
            </span>
            {status.spreadsheetTitle && (
              <>
                <span aria-hidden="true">·</span>
                {status.spreadsheetUrl ? (
                  <a
                    href={status.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline font-sans"
                  >
                    <span>{status.spreadsheetTitle}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="font-sans">{status.spreadsheetTitle}</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {status.conflictCount > 0 && onOpenConflicts && (
            <button
              type="button"
              onClick={onOpenConflicts}
              className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 transition-colors whitespace-nowrap shrink-0"
            >
              Resolve {status.conflictCount} Conflict{status.conflictCount > 1 ? 's' : ''}
            </button>
          )}

          {status.tokenExpired && (
            <button
              type="button"
              onClick={handleReconnect}
              disabled={isReconnecting || !status.isOnline}
              className="rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {isReconnecting ? 'Reconnecting...' : 'Reconnect Google'}
            </button>
          )}

          {!status.spreadsheetTitle && onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Connect Sheets
            </button>
          )}

          <button
            type="button"
            onClick={handleSyncNow}
            disabled={status.engineState === 'Syncing' || !status.isOnline || !status.isConnected}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 px-3.5 py-2 text-xs font-medium text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${status.engineState === 'Syncing' ? 'animate-spin' : ''}`}
            />
            <span>{status.engineState === 'Syncing' ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        </div>
      </div>

      {status.engineState === 'Syncing' && (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{status.progressLabel}</span>
            <span className="font-mono-num">{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {!compact && status.lastError && (
        <div className="mt-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
          {status.lastError}
        </div>
      )}
    </section>
  );
};

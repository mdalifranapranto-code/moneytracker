import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, X } from 'lucide-react';
import { db } from '../db/dexie';
import { resolveConflictRecord } from '../db/repository';
import { runSync } from '../services/syncEngine';

interface ConflictResolutionModalProps {
  open: boolean;
  onClose: () => void;
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  open,
  onClose,
}) => {
  const conflicts = useLiveQuery(
    () => db.sync_conflicts.filter((c) => c.resolution === 'pending').toArray(),
    []
  );

  if (!open) return null;

  const list = conflicts ?? [];

  const handleResolve = async (
    conflictId: string,
    choice: 'kept_local' | 'accepted_remote' | 'merged'
  ) => {
    const target = list.find((c) => c.id === conflictId);
    if (!target) return;
    await resolveConflictRecord(target, choice);
    if (choice !== 'accepted_remote') {
      runSync({ manual: true }).catch(() => {});
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Resolve Sync Conflicts ({list.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {list.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
              All sync conflicts have been resolved.
            </p>
          ) : (
            list.map((c) => {
              const localObj = JSON.parse(c.local_record_json) as Record<string, unknown>;
              const remoteObj = JSON.parse(c.remote_record_json) as Record<string, unknown>;
              const keys = Array.from(
                new Set([...Object.keys(localObj), ...Object.keys(remoteObj)])
              ).filter((k) => !['id', 'user_id', 'created_at'].includes(k));

              return (
                <div
                  key={c.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {c.entity.replace('_', ' ')}
                    </span>
                    <span className="font-mono-num">Record ID: {c.record_id}</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-3 font-medium">Field</th>
                          <th className="py-2 pr-3 font-medium">Local (This Device)</th>
                          <th className="py-2 font-medium">Remote (Google Sheets)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {keys.map((key) => {
                          const lv = String(localObj[key] ?? '—');
                          const rv = String(remoteObj[key] ?? '—');
                          const differs = lv !== rv;
                          return (
                            <tr key={key}>
                              <td className="py-1.5 pr-3 font-mono text-slate-500 dark:text-slate-400">
                                {key}
                              </td>
                              <td
                                className={`py-1.5 pr-3 font-mono-num ${
                                  differs
                                    ? 'font-semibold text-amber-700 dark:text-amber-300'
                                    : 'text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {lv}
                              </td>
                              <td
                                className={`py-1.5 font-mono-num ${
                                  differs
                                    ? 'font-semibold text-sky-700 dark:text-sky-300'
                                    : 'text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {rv}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleResolve(c.id, 'accepted_remote')}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Accept Google Sheets
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolve(c.id, 'merged')}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Keep Both (Duplicate Local)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolve(c.id, 'kept_local')}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
                    >
                      Keep Local & Push
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

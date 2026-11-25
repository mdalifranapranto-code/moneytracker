import { useEffect, useState } from 'react';
import { db } from '../db/dexie';
import {
  addSyncLog,
  getConfig,
  getDeviceId,
  getGoogleConnection,
  recalculateAccountBalances,
  saveGoogleConnection,
  setConfig,
} from '../db/repository';
import {
  ALL_SHEET_TABS,
  EngineSyncState,
  SheetTabName,
  SyncQueueItem,
} from '../types/finance';
import { generateUUID } from '../utils/format';
import { getAccessToken, isTokenExpired, markTokenExpired } from './googleAuth';
import {
  ensureRequiredTabsAndHeaders,
  getSheetRows,
  GoogleApiError,
  upsertRowsBatch,
  verifySpreadsheetAccess,
} from './googleSheetsApi';

export interface SyncRuntimeStatus {
  isOnline: boolean;
  isConnected: boolean;
  tokenExpired: boolean;
  engineState: EngineSyncState;
  lastSyncAt: string | null;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  progressCurrent: number;
  progressTotal: number;
  progressLabel: string;
  lastError: string | null;
  connectedEmail: string | null;
  spreadsheetTitle: string | null;
  spreadsheetUrl: string | null;
}

let runtimeStatus: SyncRuntimeStatus = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isConnected: false,
  tokenExpired: false,
  engineState: 'Disconnected',
  lastSyncAt: null,
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  progressCurrent: 0,
  progressTotal: 0,
  progressLabel: '',
  lastError: null,
  connectedEmail: null,
  spreadsheetTitle: null,
  spreadsheetUrl: null,
};

let isSyncLocked = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<(status: SyncRuntimeStatus) => void>();

function emitStatus() {
  for (const sub of subscribers) {
    sub({ ...runtimeStatus });
  }
}

export async function refreshSyncSnapshot(): Promise<SyncRuntimeStatus> {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const conn = await getGoogleConnection();
  const lastSyncAt = await getConfig('last_sync_at');
  const queueItems = await db.sync_queue.toArray();
  const conflictCount = await db.sync_conflicts
    .filter((c) => c.resolution === 'pending')
    .count();

  const pendingCount = queueItems.filter(
    (q) => q.status === 'queued' || q.status === 'processing'
  ).length;
  const failedCount = queueItems.filter((q) => q.status === 'failed').length;

  const token = getAccessToken();
  const expired = isTokenExpired() || (!!conn.spreadsheetId && !token);
  const isConnected = !!conn.spreadsheetId && !!token && !expired;

  let engineState: EngineSyncState = runtimeStatus.engineState;
  if (!isSyncLocked) {
    if (!isOnline) {
      engineState = 'Offline';
    } else if (!conn.spreadsheetId || !token || expired) {
      engineState = 'Disconnected';
    } else if (failedCount > 0) {
      engineState = 'Failed';
    } else if (pendingCount > 0) {
      engineState = 'Pending';
    } else {
      engineState = 'Synced';
    }
  }

  runtimeStatus = {
    ...runtimeStatus,
    isOnline,
    isConnected,
    tokenExpired: expired && !!conn.spreadsheetId,
    engineState,
    lastSyncAt,
    pendingCount,
    failedCount,
    conflictCount,
    connectedEmail: conn.accountEmail,
    spreadsheetTitle: conn.spreadsheetTitle,
    spreadsheetUrl: conn.spreadsheetUrl,
  };
  emitStatus();
  return runtimeStatus;
}

export function useSyncStatus(): SyncRuntimeStatus {
  const [status, setStatus] = useState<SyncRuntimeStatus>(runtimeStatus);
  useEffect(() => {
    subscribers.add(setStatus);
    refreshSyncSnapshot().catch(() => {});
    return () => {
      subscribers.delete(setStatus);
    };
  }, []);
  return status;
}

function scheduleNextRetry(delayMs: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    runSync({ manual: false }).catch(() => {});
  }, delayMs);
}

/**
 * Push all existing active & deleted local records into the queue if a user
 * links a brand-new spreadsheet after working offline.
 */
export async function queueAllLocalRecordsForInitialSync(): Promise<number> {
  const now = new Date().toISOString();
  let queued = 0;

  const entityTabs: SheetTabName[] = ALL_SHEET_TABS.filter((t) => t !== 'Sync_Metadata');
  const existingQueue = await db.sync_queue.toArray();
  const queuedKeys = new Set(existingQueue.map((q) => `${q.entity}:${q.record_id}`));

  for (const entity of entityTabs) {
    const table = db.getTableForEntity(entity);
    const records = await table.toArray();
    for (const rec of records) {
      if (queuedKeys.has(`${entity}:${rec.id}`)) continue;
      if (rec.sync_status === 'synced' && rec.last_synced_version === rec.sync_version) continue;

      const payloadCopy = { ...rec };
      delete payloadCopy.last_synced_version;
      delete payloadCopy.last_synced_at;
      delete payloadCopy.sync_status;

      await db.sync_queue.put({
        op_id: generateUUID(),
        record_id: rec.id,
        entity,
        action: rec.deleted_at ? 'delete' : 'upsert',
        payload_json: JSON.stringify(payloadCopy),
        base_version: rec.last_synced_version ?? 0,
        created_at: now,
        updated_at: now,
        retry_count: 0,
        next_retry_at: Date.now(),
        status: 'queued',
        last_error: null,
      });
      queued++;
    }
  }

  await refreshSyncSnapshot();
  return queued;
}

/**
 * Core single-flight automatic synchronization cycle.
 */
export async function runSync(options: { manual?: boolean } = {}): Promise<boolean> {
  if (isSyncLocked) return false;

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (!isOnline) {
    await refreshSyncSnapshot();
    return false;
  }

  const conn = await getGoogleConnection();
  const token = getAccessToken();
  if (!conn.spreadsheetId) {
    await refreshSyncSnapshot();
    return false;
  }
  if (!token) {
    markTokenExpired('Google OAuth token unavailable after restart. Reconnect to sync.');
    await refreshSyncSnapshot();
    return false;
  }

  isSyncLocked = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  const nowMs = Date.now();
  const allQueue = await db.sync_queue.toArray();
  const dueItems = allQueue
    .filter((q) => {
      if (q.status === 'conflict') return false;
      if (options.manual) return q.status === 'queued' || q.status === 'failed';
      return (q.status === 'queued' || q.status === 'failed') && q.next_retry_at <= nowMs;
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const entityTabs = ALL_SHEET_TABS.filter((t) => t !== 'Sync_Metadata');
  const totalSteps = Math.max(1, dueItems.length > 0 ? entityTabs.length : 2);

  runtimeStatus = {
    ...runtimeStatus,
    engineState: 'Syncing',
    progressCurrent: 0,
    progressTotal: totalSteps,
    progressLabel: 'Verifying spreadsheet access...',
    lastError: null,
  };
  emitStatus();

  try {
    // 1. Verify access & ensure all 11 tabs + headers exist
    const meta = await verifySpreadsheetAccess(token, conn.spreadsheetId);
    const missingTabs = ALL_SHEET_TABS.filter((t) => !meta.sheetTitles.includes(t));
    if (missingTabs.length > 0) {
      await ensureRequiredTabsAndHeaders(token, conn.spreadsheetId);
    }

    await saveGoogleConnection({
      ...conn,
      spreadsheetTitle: meta.title,
      spreadsheetUrl: meta.spreadsheetUrl,
      verifiedAt: new Date().toISOString(),
    });

    // 2. Group queued operations by entity tab
    const byEntity = new Map<SheetTabName, SyncQueueItem[]>();
    for (const item of dueItems) {
      const list = byEntity.get(item.entity) ?? [];
      list.push(item);
      byEntity.set(item.entity, list);
    }

    let pushedCount = 0;
    let pulledCount = 0;
    let detectedConflicts = 0;
    let stepIndex = 0;

    // 3. Synchronize each entity tab (Push pending + Pull non-conflicting remote changes)
    for (const tabName of entityTabs) {
      stepIndex++;
      const items = byEntity.get(tabName) ?? [];
      runtimeStatus = {
        ...runtimeStatus,
        progressCurrent: stepIndex,
        progressLabel: `Syncing ${tabName.replace('_', ' ')}...`,
      };
      emitStatus();

      // Mark queued items as processing
      for (const item of items) {
        await db.sync_queue.update(item.op_id, { status: 'processing' });
      }

      const remoteRows = await getSheetRows(token, conn.spreadsheetId, tabName);
      const remoteById = new Map<string, { rowIndex: number; data: Record<string, unknown> }>();
      for (const r of remoteRows) {
        remoteById.set(String(r.data.id), r);
      }

      const updates: Array<{ rowIndex: number; record: Record<string, unknown> }> = [];
      const appends: Array<Record<string, unknown>> = [];
      const appendedIds = new Set<string>();
      const succeededItems: SyncQueueItem[] = [];
      const conflictOpIds = new Set<string>();

      for (const item of items) {
        const localRec = JSON.parse(item.payload_json) as Record<string, unknown>;
        const recordId = String(localRec.id);
        const remote = remoteById.get(recordId);

        if (remote) {
          const remoteVer = Number(remote.data.sync_version) || 0;
          const remoteUpdatedAt = String(remote.data.updated_at || '');
          const localVer = Number(localRec.sync_version) || 1;
          const localUpdatedAt = String(localRec.updated_at || '');

          // Idempotency check: already synced exact version
          if (remoteVer === localVer && remoteUpdatedAt === localUpdatedAt) {
            succeededItems.push(item);
            continue;
          }

          // Conflict check: remote is newer than our base_version
          if (remoteVer > item.base_version) {
            conflictOpIds.add(item.op_id);
            detectedConflicts++;

            await db.sync_queue.update(item.op_id, {
              status: 'conflict',
              last_error: `Remote version ${remoteVer} is newer than local base ${item.base_version}.`,
            });

            const table = db.getTableForEntity(tabName);
            const currentLocal = await table.get(recordId);
            if (currentLocal) {
              await table.update(recordId, { sync_status: 'conflict' });
            }

            await db.sync_conflicts.put({
              id: generateUUID(),
              entity: tabName,
              record_id: recordId,
              op_id: item.op_id,
              local_record_json: JSON.stringify(localRec),
              remote_record_json: JSON.stringify(remote.data),
              detected_at: new Date().toISOString(),
              resolution: 'pending',
              resolved_at: null,
            });
            continue;
          }

          updates.push({ rowIndex: remote.rowIndex, record: localRec });
          succeededItems.push(item);
        } else {
          if (!appendedIds.has(recordId)) {
            appends.push(localRec);
            appendedIds.add(recordId);
          }
          succeededItems.push(item);
        }
      }

      if (updates.length > 0 || appends.length > 0) {
        await upsertRowsBatch(token, conn.spreadsheetId, tabName, updates, appends);
        pushedCount += updates.length + appends.length;
      }

      // Confirm pushed items & clean queue ONLY after Google Sheets confirms 200 OK
      const table = db.getTableForEntity(tabName);
      for (const item of succeededItems) {
        if (conflictOpIds.has(item.op_id)) continue;
        const localRec = JSON.parse(item.payload_json) as Record<string, unknown>;
        const existingLocal = await table.get(item.record_id);
        if (existingLocal && Number(existingLocal.sync_version) === Number(localRec.sync_version)) {
          await table.update(item.record_id, {
            sync_status: 'synced',
            last_synced_version: Number(localRec.sync_version),
            last_synced_at: String(localRec.updated_at),
          });
        }
        await db.sync_queue.delete(item.op_id);
      }

      // Pull non-conflicting remote-only or newer remote rows (two-way safe hydration)
      const dirtyQueueIds = new Set(
        (await db.sync_queue.where('entity').equals(tabName).toArray()).map((q) => q.record_id)
      );
      for (const remote of remoteRows) {
        const rid = String(remote.data.id);
        if (dirtyQueueIds.has(rid)) continue;
        const existingLocal = await table.get(rid);
        const remoteVer = Number(remote.data.sync_version) || 1;
        if (!existingLocal || remoteVer > (existingLocal.sync_version || 0)) {
          await table.put({
            ...remote.data,
            last_synced_version: remoteVer,
            last_synced_at: String(remote.data.updated_at || ''),
            sync_status: 'synced',
          });
          pulledCount++;
        }
      }
    }

    if (pulledCount > 0) {
      await recalculateAccountBalances();
    }

    // 4. Update Sync_Metadata tab idempotently by device_id
    const nowIso = new Date().toISOString();
    const deviceId = await getDeviceId();
    const metaRows = await getSheetRows(token, conn.spreadsheetId, 'Sync_Metadata');
    const existingMetaRow = metaRows.find((r) => String(r.data.device_id) === deviceId);
    const metaRecord = {
      id: existingMetaRow ? String(existingMetaRow.data.id) : deviceId,
      user_id: conn.accountEmail || conn.accountUid || 'local-user',
      device_id: deviceId,
      last_sync_at: nowIso,
      schema_version: 1,
      client_app_version: '1.0.0',
      last_sync_status: detectedConflicts > 0 ? 'completed_with_conflicts' : 'success',
      created_at: existingMetaRow ? String(existingMetaRow.data.created_at) : nowIso,
      updated_at: nowIso,
      deleted_at: null,
      sync_version: existingMetaRow ? Number(existingMetaRow.data.sync_version || 0) + 1 : 1,
    };

    await upsertRowsBatch(
      token,
      conn.spreadsheetId,
      'Sync_Metadata',
      existingMetaRow ? [{ rowIndex: existingMetaRow.rowIndex, record: metaRecord }] : [],
      existingMetaRow ? [] : [metaRecord]
    );

    await setConfig('last_sync_at', nowIso);

    if (pushedCount > 0 || pulledCount > 0 || detectedConflicts > 0 || options.manual) {
      await addSyncLog(
        detectedConflicts > 0 ? 'warn' : 'success',
        `Sync complete: ${pushedCount} pushed, ${pulledCount} pulled${
          detectedConflicts > 0 ? `, ${detectedConflicts} conflicts` : ''
        }`,
        null
      );
    }

    runtimeStatus = {
      ...runtimeStatus,
      lastError:
        detectedConflicts > 0
          ? `${detectedConflicts} record conflict(s) require your review.`
          : null,
      progressCurrent: totalSteps,
      progressTotal: totalSteps,
      progressLabel: 'Synchronized',
    };
    return true;
  } catch (err: unknown) {
    const isAuthErr =
      err instanceof GoogleApiError && (err.status === 401 || err.status === 403);
    const msg = err instanceof Error ? err.message : 'Synchronization failed';

    if (isAuthErr) {
      // Revert processing items back to queued without incrementing failure backoff
      const processing = await db.sync_queue
        .filter((q) => q.status === 'processing')
        .toArray();
      for (const item of processing) {
        await db.sync_queue.update(item.op_id, {
          status: 'queued',
          last_error: 'Authorization expired',
        });
      }
      markTokenExpired(msg);
      runtimeStatus = {
        ...runtimeStatus,
        lastError: 'Google authorization expired. Click Reconnect to resume syncing.',
      };
    } else {
      // Network or transient error: leave in queue with exponential backoff
      const processing = await db.sync_queue
        .filter((q) => q.status === 'processing')
        .toArray();
      let minNextRetry = Infinity;
      for (const item of processing) {
        const nextRetryCount = item.retry_count + 1;
        const backoff = Math.min(300_000, 2000 * Math.pow(2, nextRetryCount));
        const jitter = Math.floor(Math.random() * 1000);
        const nextAt = Date.now() + backoff + jitter;
        if (nextAt < minNextRetry) minNextRetry = nextAt;
        await db.sync_queue.update(item.op_id, {
          status: 'failed',
          retry_count: nextRetryCount,
          next_retry_at: nextAt,
          last_error: msg,
        });
      }
      if (minNextRetry < Infinity && navigator.onLine) {
        scheduleNextRetry(Math.max(2000, minNextRetry - Date.now()));
      }
      await addSyncLog('error', 'Sync failed — records safely retained in queue', msg);
      runtimeStatus = {
        ...runtimeStatus,
        lastError: msg,
      };
    }
    return false;
  } finally {
    isSyncLocked = false;
    await refreshSyncSnapshot();
  }
}

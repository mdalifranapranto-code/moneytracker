import {
  ALL_SHEET_TABS,
  SHEET_HEADERS,
  SheetTabName,
} from '../types/finance';

export class GoogleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
  }
}

export interface DriveSpreadsheetFile {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheetTitles: string[];
}

export interface RemoteSheetRow {
  rowIndex: number; // 1-based row number in Google Sheet
  data: Record<string, unknown>;
}

function colIndexToLetter(colCount: number): string {
  // Supports up to 26+ columns cleanly
  let n = colCount;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter || 'A';
}

async function fetchGoogleJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let errMsg = `Google API request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error?.message) errMsg = body.error.message;
    } catch {
      // ignore json parse failure
    }
    throw new GoogleApiError(errMsg, res.status);
  }

  return (await res.json()) as T;
}

export async function verifySpreadsheetAccess(
  token: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=spreadsheetId,properties.title,spreadsheetUrl,sheets.properties.title`;

  const data = await fetchGoogleJson<{
    spreadsheetId: string;
    properties?: { title?: string };
    spreadsheetUrl?: string;
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(url, token);

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || 'My Money Ledger',
    spreadsheetUrl:
      data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
    sheetTitles: (data.sheets ?? []).map((s) => s.properties?.title || '').filter(Boolean),
  };
}

export async function listUserSpreadsheets(token: string): Promise<DriveSpreadsheetFile[]> {
  const query = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=30`;
  const data = await fetchGoogleJson<{ files?: DriveSpreadsheetFile[] }>(url, token);
  return data.files ?? [];
}

export async function createLedgerSpreadsheet(
  token: string,
  title = 'My Money Ledger'
): Promise<SpreadsheetMetadata> {
  const createUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  const payload = {
    properties: { title },
    sheets: ALL_SHEET_TABS.map((tabName) => ({
      properties: {
        title: tabName,
        gridProperties: { frozenRowCount: 1 },
      },
    })),
  };

  const created = await fetchGoogleJson<{
    spreadsheetId: string;
    properties?: { title?: string };
    spreadsheetUrl?: string;
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(createUrl, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  // Populate stable column headers on row 1 of all 11 tabs
  const headerUpdates = ALL_SHEET_TABS.map((tabName) => {
    const headers = SHEET_HEADERS[tabName];
    const endCol = colIndexToLetter(headers.length);
    return {
      range: `'${tabName}'!A1:${endCol}1`,
      values: [headers],
    };
  });

  await fetchGoogleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      created.spreadsheetId
    )}/values:batchUpdate`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: headerUpdates,
      }),
    }
  );

  return {
    spreadsheetId: created.spreadsheetId,
    title: created.properties?.title || title,
    spreadsheetUrl:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}`,
    sheetTitles: ALL_SHEET_TABS,
  };
}

export async function ensureRequiredTabsAndHeaders(
  token: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const meta = await verifySpreadsheetAccess(token, spreadsheetId);
  const missingTabs = ALL_SHEET_TABS.filter((tab) => !meta.sheetTitles.includes(tab));

  if (missingTabs.length > 0) {
    await fetchGoogleJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missingTabs.map((tabName) => ({
            addSheet: {
              properties: {
                title: tabName,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          })),
        }),
      }
    );
  }

  // Verify row 1 headers on all tabs; write header row if row 1 is missing/empty
  const rangesParam = ALL_SHEET_TABS.map(
    (t) => `ranges=${encodeURIComponent(`'${t}'!A1:Z1`)}`
  ).join('&');

  const headerBatch = await fetchGoogleJson<{
    valueRanges?: Array<{ range: string; values?: string[][] }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchGet?${rangesParam}`,
    token
  );

  const missingHeaders: Array<{ range: string; values: string[][] }> = [];
  ALL_SHEET_TABS.forEach((tabName, idx) => {
    const vr = headerBatch.valueRanges?.[idx];
    const row1 = vr?.values?.[0] ?? [];
    if (row1.length === 0 || row1[0] !== 'id') {
      const headers = SHEET_HEADERS[tabName];
      const endCol = colIndexToLetter(headers.length);
      missingHeaders.push({
        range: `'${tabName}'!A1:${endCol}1`,
        values: [headers],
      });
    }
  });

  if (missingHeaders.length > 0) {
    await fetchGoogleJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values:batchUpdate`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: missingHeaders,
        }),
      }
    );
  }

  return verifySpreadsheetAccess(token, spreadsheetId);
}

const NUMERIC_FIELDS = new Set([
  'amount',
  'initial_balance',
  'current_balance',
  'amount_limit',
  'target_amount',
  'principal_amount',
  'remaining_amount',
  'sync_version',
  'schema_version',
]);

const BOOLEAN_FIELDS = new Set(['is_archived', 'rollover', 'active']);

const NULLABLE_FIELDS = new Set([
  'deleted_at',
  'to_account_id',
  'category_id',
  'bill_id',
  'recurring_id',
  'linked_account_id',
  'account_id',
  'paid_at',
  'last_run_date',
]);

function deserializeCell(key: string, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') {
    if (NULLABLE_FIELDS.has(key)) return null;
    if (NUMERIC_FIELDS.has(key)) return 0;
    if (BOOLEAN_FIELDS.has(key)) return false;
    return '';
  }
  if (NUMERIC_FIELDS.has(key)) {
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  if (BOOLEAN_FIELDS.has(key)) {
    return raw === true || String(raw).toLowerCase() === 'true';
  }
  return String(raw);
}

function serializeCell(val: unknown): string | number | boolean {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  return String(val);
}

export function recordToSheetRow(
  tabName: SheetTabName,
  record: Record<string, unknown>
): Array<string | number | boolean> {
  const headers = SHEET_HEADERS[tabName];
  return headers.map((h) => serializeCell(record[h]));
}

export async function getSheetRows(
  token: string,
  spreadsheetId: string,
  tabName: SheetTabName
): Promise<RemoteSheetRow[]> {
  const headers = SHEET_HEADERS[tabName];
  const endCol = colIndexToLetter(headers.length);
  const range = `'${tabName}'!A1:${endCol}`;

  const data = await fetchGoogleJson<{ values?: unknown[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`,
    token
  );

  const values = data.values ?? [];
  if (values.length <= 1) return [];

  const actualHeaders = (values[0] as string[]).map((h) => String(h).trim());
  const rows: RemoteSheetRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const rawRow = values[i] ?? [];
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < actualHeaders.length; c++) {
      const key = actualHeaders[c];
      if (!key) continue;
      obj[key] = deserializeCell(key, rawRow[c]);
    }
    if (obj.id && String(obj.id).trim() !== '') {
      rows.push({
        rowIndex: i + 1, // 1-based sheet row index
        data: obj,
      });
    }
  }

  return rows;
}

export async function upsertRowsBatch(
  token: string,
  spreadsheetId: string,
  tabName: SheetTabName,
  updates: Array<{ rowIndex: number; record: Record<string, unknown> }>,
  appends: Array<Record<string, unknown>>
): Promise<void> {
  const headers = SHEET_HEADERS[tabName];
  const endCol = colIndexToLetter(headers.length);

  if (updates.length > 0) {
    const batchData = updates.map((u) => ({
      range: `'${tabName}'!A${u.rowIndex}:${endCol}${u.rowIndex}`,
      values: [recordToSheetRow(tabName, u.record)],
    }));

    await fetchGoogleJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values:batchUpdate`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: batchData,
        }),
      }
    );
  }

  if (appends.length > 0) {
    const appendValues = appends.map((rec) => recordToSheetRow(tabName, rec));
    await fetchGoogleJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(`'${tabName}'!A1:${endCol}1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          values: appendValues,
        }),
      }
    );
  }
}

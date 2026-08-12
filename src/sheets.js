import { LAST_COL } from './constants.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function getSheetIdMap(env, accessToken) {
  const cached = await env.RMA_COUNTERS.get('sheet_id_map', { type: 'json' });
  if (cached) return cached;

  const res = await fetch(
    `${BASE}/${env.SPREADSHEET_ID}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch sheet metadata: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const map = {};
  for (const s of data.sheets) map[s.properties.title] = s.properties.sheetId;

  await env.RMA_COUNTERS.put('sheet_id_map', JSON.stringify(map), { expirationTtl: 86400 });
  return map;
}

// Returns array of row arrays (no header row). rows[i] corresponds to
// sheet row (i + 2), since row 1 is the header.
export async function getRows(env, accessToken, tabName) {
  const res = await fetch(
    `${BASE}/${env.SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A2:${LAST_COL}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to read ${tabName}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

export async function appendRow(env, accessToken, tabName, rowValues) {
  const res = await fetch(
    `${BASE}/${env.SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A:${LAST_COL}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [rowValues] })
    }
  );
  if (!res.ok) throw new Error(`Failed to append to ${tabName}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function updateRow(env, accessToken, tabName, sheetRowNumber, rowValues) {
  const res = await fetch(
    `${BASE}/${env.SPREADSHEET_ID}/values/${encodeURIComponent(tabName)}!A${sheetRowNumber}:${LAST_COL}${sheetRowNumber}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [rowValues] })
    }
  );
  if (!res.ok) throw new Error(`Failed to update ${tabName} row ${sheetRowNumber}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function deleteRow(env, accessToken, tabName, sheetRowNumber) {
  const sheetIdMap = await getSheetIdMap(env, accessToken);
  const sheetId = sheetIdMap[tabName];
  if (sheetId === undefined) throw new Error(`Unknown tab "${tabName}" — not found in spreadsheet metadata`);

  const res = await fetch(`${BASE}/${env.SPREADSHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: sheetRowNumber - 1, // 0-indexed, inclusive
            endIndex: sheetRowNumber        // 0-indexed, exclusive
          }
        }
      }]
    })
  });
  if (!res.ok) throw new Error(`Failed to delete row from ${tabName}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Returns { sheetRowNumber, values } or null if not found.
// sheetRowNumber is the real row number in the sheet (accounting for the header row).
export async function findRowByRmaId(env, accessToken, tabName, rmaId) {
  const rows = await getRows(env, accessToken, tabName);
  const idx = rows.findIndex(r => r[0] === rmaId); // column A = RMA ID
  if (idx === -1) return null;
  return { sheetRowNumber: idx + 2, values: rows[idx] };
}

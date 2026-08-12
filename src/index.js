import { getAccessToken } from './auth.js';
import { getRows, appendRow, updateRow, deleteRow, findRowByRmaId } from './sheets.js';
import { generateRmaId } from './rmaId.js';
import { HEADERS } from './constants.js';
import { downloadFile } from './storage.js';
import { runRedFlagScan, runDailyReport } from './cron.js';

// Tighten this to your Pages domain once it exists (e.g. 'https://pentagon-rma.pages.dev')
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// Constant-time-ish string compare — avoids the obvious short-circuit
// timing leak of `a === b` on a shared secret. Overkill for this scale
// of app, but costs nothing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function rowToObject(row) {
  const obj = {};
  HEADERS.forEach((h, i) => { obj[h] = row[i] || ''; });
  return obj;
}

function objectToRow(obj) {
  return HEADERS.map(h => obj[h] ?? '');
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Shared API key required on every route below. Frontend sends it as
    // X-API-Key. env.API_KEY is a Worker secret — see README.
    const providedKey = request.headers.get('X-API-Key') || '';
    if (!env.API_KEY || !safeEqual(providedKey, env.API_KEY)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/tickets' && request.method === 'GET') {
        return await handleTickets(request, env);
      }
      if (url.pathname === '/device-history' && request.method === 'GET') {
        return await handleDeviceHistory(request, env);
      }
      if (url.pathname === '/intake' && request.method === 'POST') {
        return await handleIntake(request, env);
      }
      if (url.pathname === '/update' && request.method === 'POST') {
        return await handleUpdate(request, env);
      }
      if (url.pathname === '/return' && request.method === 'POST') {
        return await handleReturn(request, env);
      }
      if (url.pathname === '/reports/latest' && request.method === 'GET') {
        return await handleLatestReport(request, env);
      }
      // Manual triggers for testing the CRON logic without waiting for the schedule.
      if (url.pathname === '/admin/run-redflag-scan' && request.method === 'POST') {
        return json(await runRedFlagScan(env));
      }
      if (url.pathname === '/admin/run-daily-report' && request.method === 'POST') {
        return json(await runDailyReport(env));
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(runRedFlagScan(env));
    } else if (event.cron === '0 14 * * *') {
      ctx.waitUntil(runDailyReport(env));
    }
  }
};

// GET /reports/latest — proxies the most recent daily PDF report from
// R2 through the Worker, rather than exposing the bucket publicly
// (the report contains customer names and phone numbers).
async function handleLatestReport(request, env) {
  const cached = await env.RMA_COUNTERS.get('latest_report', { type: 'json' });
  if (!cached) return json({ error: 'No report generated yet' }, 404);

  const bytes = await downloadFile(env, cached.fileId);

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cached.filename}"`,
      ...CORS_HEADERS
    }
  });
}

// GET /tickets?tab=Open|Closed|Master (default Open)
// Powers the Dashboard's ticket table. Master is included as an option
// mainly for analytics use later — Open/Closed cover day-to-day.
async function handleTickets(request, env) {
  const url = new URL(request.url);
  const tab = url.searchParams.get('tab') || 'Open';
  if (!['Open', 'Closed', 'Master'].includes(tab)) {
    return json({ error: 'tab must be one of Open, Closed, Master' }, 400);
  }

  const accessToken = await getAccessToken(env);
  const rows = await getRows(env, accessToken, tab);
  const tickets = rows.map(rowToObject);

  return json({ tab, count: tickets.length, tickets });
}

// GET /device-history?sn=XXXX
// Called after the first barcode scan at intake, before a new RMA ID
// is generated, so the technician can see whether this device has
// been in before.
async function handleDeviceHistory(request, env) {
  const url = new URL(request.url);
  const sn = url.searchParams.get('sn');
  if (!sn) return json({ error: 'sn query param required' }, 400);

  const accessToken = await getAccessToken(env);
  const rows = await getRows(env, accessToken, 'Master');
  const priorRepairs = rows
    .filter(r => r[1] === sn) // column B = SN
    .map(rowToObject);

  return json({ sn, priorRepairs });
}

// POST /intake — creates a new ticket in Open + Master
async function handleIntake(request, env) {
  const body = await request.json();

  const required = ['sn', 'customerName', 'mobileNumber', 'modelNumber', 'productType', 'brand', 'problemDescription', 'warrantyStatus'];
  for (const field of required) {
    if (!body[field]) return json({ error: `Missing field: ${field}` }, 400);
  }

  const accessToken = await getAccessToken(env);
  const rmaId = await generateRmaId(env);
  const now = new Date().toISOString();

  const record = {
    'RMA ID': rmaId,
    'SN': body.sn,
    'Customer Name': body.customerName,
    'Mobile Number': body.mobileNumber,
    'Invoice Number': body.invoiceNumber || '',
    'Purchase Date': body.purchaseDate || '',
    'Model Number': body.modelNumber,
    'Product Type': body.productType,
    'Brand': body.brand,
    'Problem Description': body.problemDescription,
    'Technician Name': body.technicianName || '',
    'Date In': now,
    'Warranty Status': body.warrantyStatus,
    'Status': 'Diagnostics',
    'Resolution': '',
    'Repair/Replacement Details': '',
    'Date Out': '',
    'Collected By Name': '',
    'Collector Mobile Number': '',
    'Red Flag': 'No',
    'Red Flag Reason': '',
    'Additional Details': body.additionalDetails || '',
    'Last Edited Timestamp': now
  };

  const row = objectToRow(record);
  await appendRow(env, accessToken, 'Open', row);
  await appendRow(env, accessToken, 'Master', row);

  return json({ rmaId, record });
}

// POST /update — technician progress: diagnostics -> estimate -> repair -> ready
async function handleUpdate(request, env) {
  const body = await request.json();
  if (!body.rmaId) return json({ error: 'rmaId required' }, 400);

  const accessToken = await getAccessToken(env);
  const found = await findRowByRmaId(env, accessToken, 'Open', body.rmaId);
  if (!found) return json({ error: `RMA ID ${body.rmaId} not found in Open` }, 404);

  const record = rowToObject(found.values);
  const now = new Date().toISOString();

  if (body.status) record['Status'] = body.status;
  if (body.resolution) record['Resolution'] = body.resolution;
  if (body.repairDetails) record['Repair/Replacement Details'] = body.repairDetails;
  if (body.technicianName) record['Technician Name'] = body.technicianName;
  if (body.additionalDetails) record['Additional Details'] = body.additionalDetails;

  // Moving out of Diagnostics clears any auto red-flag from the CRON scan
  if (body.status && body.status !== 'Diagnostics') {
    record['Red Flag'] = 'No';
    record['Red Flag Reason'] = '';
  }
  record['Last Edited Timestamp'] = now;

  const updatedRow = objectToRow(record);
  await updateRow(env, accessToken, 'Open', found.sheetRowNumber, updatedRow);

  const masterFound = await findRowByRmaId(env, accessToken, 'Master', body.rmaId);
  if (masterFound) {
    await updateRow(env, accessToken, 'Master', masterFound.sheetRowNumber, updatedRow);
  }

  return json({ rmaId: body.rmaId, record });
}

// POST /return — customer collection: move Open -> Closed, mirror final state into Master
async function handleReturn(request, env) {
  const body = await request.json();
  if (!body.rmaId) return json({ error: 'rmaId required' }, 400);
  if (!body.collectedByName) return json({ error: 'collectedByName required' }, 400);

  const accessToken = await getAccessToken(env);
  const found = await findRowByRmaId(env, accessToken, 'Open', body.rmaId);
  if (!found) return json({ error: `RMA ID ${body.rmaId} not found in Open` }, 404);

  const record = rowToObject(found.values);
  const now = new Date().toISOString();

  record['Status'] = 'Closed';
  record['Date Out'] = now;
  record['Collected By Name'] = body.collectedByName;
  record['Collector Mobile Number'] = body.collectorMobileNumber || '';
  record['Last Edited Timestamp'] = now;

  const finalRow = objectToRow(record);

  await appendRow(env, accessToken, 'Closed', finalRow);
  await deleteRow(env, accessToken, 'Open', found.sheetRowNumber);

  const masterFound = await findRowByRmaId(env, accessToken, 'Master', body.rmaId);
  if (masterFound) {
    await updateRow(env, accessToken, 'Master', masterFound.sheetRowNumber, finalRow);
  }

  return json({ rmaId: body.rmaId, record });
}

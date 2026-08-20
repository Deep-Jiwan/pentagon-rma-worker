import { getAccessToken } from './auth.js';
import { getRows, appendRow, updateRow, deleteRow, findRowByRmaId } from './sheets.js';
import { generateRmaId } from './rmaId.js';
import { HEADERS } from './constants.js';
import { downloadFile, uploadPdf, deleteFile } from './storage.js';
import { runRedFlagScan, runDailyReport } from './cron.js';
import { computeReportMetrics } from './reportData.js';
import { buildReportPdf } from './pdfReport.js';

// Origins allowed to call this Worker from a browser. Access-Control-Allow-Origin
// can only ever hold one value, so we reflect back whichever of these matched
// the request's Origin header (falling back to the first entry for non-browser
// callers, e.g. curl, that send no Origin at all).
const ALLOWED_ORIGINS = [
  'https://pentagon-rma-frontend.pentagontz.workers.dev',
  'https://rma.pentagon-solutions.tech'
];

function corsHeaders(request) {
  const origin = request?.headers.get('Origin');
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    // Content-Disposition isn't on the CORS-safelisted response header list,
    // so without this the browser's fetch() can see the PDF bytes but not
    // the filename in it (api.ts reads Content-Disposition to name the
    // downloaded report/ticket-PDF file) — it silently falls back to a
    // generic name instead of erroring, which is what made this easy to miss.
    'Access-Control-Expose-Headers': 'Content-Disposition'
  };
}

function json(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
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
      return new Response(null, { headers: corsHeaders(request) });
    }

    // Shared API key required on every route below. Frontend sends it as
    // X-API-Key. env.API_KEY is a Worker secret — see README.
    const providedKey = request.headers.get('X-API-Key') || '';
    if (!env.API_KEY || !safeEqual(providedKey, env.API_KEY)) {
      return json({ error: 'Unauthorized' }, 401, request);
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
      if (url.pathname === '/reports/generate' && request.method === 'POST') {
        return await handleGenerateReport(request, env);
      }
      const pdfMatch = url.pathname.match(/^\/tickets\/([^/]+)\/pdf$/);
      if (pdfMatch && request.method === 'POST') {
        return await handleUploadTicketPdf(request, env, decodeURIComponent(pdfMatch[1]));
      }
      if (pdfMatch && request.method === 'GET') {
        return await handleDownloadTicketPdf(request, env, decodeURIComponent(pdfMatch[1]));
      }
      const ticketMatch = url.pathname.match(/^\/tickets\/([^/]+)$/);
      if (ticketMatch && request.method === 'DELETE') {
        return await handleDeleteTicket(request, env, decodeURIComponent(ticketMatch[1]));
      }
      // Manual triggers for testing the CRON logic without waiting for the schedule.
      if (url.pathname === '/admin/run-redflag-scan' && request.method === 'POST') {
        return json(await runRedFlagScan(env), 200, request);
      }
      if (url.pathname === '/admin/run-daily-report' && request.method === 'POST') {
        return json(await runDailyReport(env), 200, request);
      }
      return json({ error: 'Not found' }, 404, request);
    } catch (err) {
      return json({ error: err.message }, 500, request);
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

// POST /reports/generate — builds the report PDF fresh from the sheet's
// current state (not a cached daily snapshot), saves it into R2 as the
// canonical "latest" copy, then streams it straight back. The Worker
// proxies it rather than exposing the bucket publicly since the report
// contains customer names and phone numbers. The CRON's daily archival
// report (runDailyReport in cron.js) is unaffected — it still runs on
// schedule and keeps its own dated copies in R2.
async function handleGenerateReport(request, env) {
  const metrics = await computeReportMetrics(env);
  const pdfBytes = await buildReportPdf(metrics);

  const filename = 'RMA-Report-Latest.pdf';
  await uploadPdf(env, filename, pdfBytes);

  return new Response(pdfBytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="RMA-Report-${metrics.generatedAtLabel}.pdf"`,
      ...corsHeaders(request)
    }
  });
}

// POST /tickets/:rmaId/pdf — stores the RMA/warranty-form PDF into the
// RMA_REPORTS R2 bucket as "<rmaId>.pdf". The PDF itself is built once,
// client-side (frontend's lib/pdf.ts, via jsPDF) and posted here as raw
// bytes — the Worker doesn't regenerate it, so the form layout only lives
// in one place. Google Drive isn't used here for the same reason the daily
// reports aren't: this service account has no Drive storage quota outside
// a Workspace Shared Drive.
async function handleUploadTicketPdf(request, env, rmaId) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/pdf')) {
    return json({ error: 'Content-Type must be application/pdf' }, 400, request);
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: 'Empty PDF body' }, 400, request);

  const filename = `${rmaId}.pdf`;
  await uploadPdf(env, filename, bytes);
  return json({ rmaId, filename }, 200, request);
}

// GET /tickets/:rmaId/pdf — fetches a previously-saved ticket PDF back out
// of R2 (e.g. to reprint/redownload without regenerating client-side).
async function handleDownloadTicketPdf(request, env, rmaId) {
  const filename = `${rmaId}.pdf`;
  let bytes;
  try {
    bytes = await downloadFile(env, filename);
  } catch {
    return json({ error: `No saved PDF found for ${rmaId}` }, 404, request);
  }

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...corsHeaders(request)
    }
  });
}

// DELETE /tickets/:rmaId — permanently removes a ticket from Open or Closed
// (whichever it's currently in), and best-effort cleans up its saved PDF
// from R2. This is a hard delete with no undo on those two tabs — the
// frontend is expected to confirm with the user before calling it.
//
// Master is deliberately left alone: it's the permanent record of every
// RMA that's ever existed (open, closed, AND deleted), so it's never
// pruned here. Instead the Master row's Status is marked "Deleted (was:
// ...)" so it's obvious at a glance the ticket no longer exists on the
// live tabs, without losing the history.
async function handleDeleteTicket(request, env, rmaId) {
  const accessToken = await getAccessToken(env);
  let deletedFromAnyTab = false;

  for (const tab of ['Open', 'Closed']) {
    const found = await findRowByRmaId(env, accessToken, tab, rmaId);
    if (found) {
      await deleteRow(env, accessToken, tab, found.sheetRowNumber);
      deletedFromAnyTab = true;
    }
  }

  if (!deletedFromAnyTab) {
    return json({ error: `RMA ID ${rmaId} not found` }, 404, request);
  }

  const masterFound = await findRowByRmaId(env, accessToken, 'Master', rmaId);
  if (masterFound) {
    const record = rowToObject(masterFound.values);
    if (!record['Status'].startsWith('Deleted')) {
      record['Status'] = `Deleted (was: ${record['Status'] || 'unknown'})`;
      record['Last Edited Timestamp'] = new Date().toISOString();
      await updateRow(env, accessToken, 'Master', masterFound.sheetRowNumber, objectToRow(record));
    }
  }

  try {
    await deleteFile(env, `${rmaId}.pdf`);
  } catch {
    // Best-effort — a missing/failed R2 cleanup shouldn't undo the fact
    // the ticket itself was already deleted from the Sheet.
  }

  return json({ rmaId, deleted: true }, 200, request);
}

// GET /tickets?tab=Open|Closed|Master (default Open)
// Powers the Dashboard's ticket table. Master is included as an option
// mainly for analytics use later — Open/Closed cover day-to-day.
async function handleTickets(request, env) {
  const url = new URL(request.url);
  const tab = url.searchParams.get('tab') || 'Open';
  if (!['Open', 'Closed', 'Master'].includes(tab)) {
    return json({ error: 'tab must be one of Open, Closed, Master' }, 400, request);
  }

  const accessToken = await getAccessToken(env);
  const rows = await getRows(env, accessToken, tab);
  const tickets = rows.map(rowToObject);

  return json({ tab, count: tickets.length, tickets }, 200, request);
}

// GET /device-history?sn=XXXX
// Called after the first barcode scan at intake, before a new RMA ID
// is generated, so the technician can see whether this device has
// been in before.
async function handleDeviceHistory(request, env) {
  const url = new URL(request.url);
  const sn = url.searchParams.get('sn');
  if (!sn) return json({ error: 'sn query param required' }, 400, request);

  const accessToken = await getAccessToken(env);
  const rows = await getRows(env, accessToken, 'Master');
  const priorRepairs = rows
    .filter(r => r[1] === sn) // column B = SN
    .map(rowToObject);

  return json({ sn, priorRepairs }, 200, request);
}

// POST /intake — creates a new ticket in Open + Master
async function handleIntake(request, env) {
  const body = await request.json();

  const required = ['sn', 'customerName', 'mobileNumber', 'modelNumber', 'productType', 'brand', 'problemDescription', 'warrantyStatus'];
  for (const field of required) {
    if (!body[field]) return json({ error: `Missing field: ${field}` }, 400, request);
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

  return json({ rmaId, record }, 200, request);
}

// POST /update — technician progress: diagnostics -> estimate -> repair -> ready
async function handleUpdate(request, env) {
  const body = await request.json();
  if (!body.rmaId) return json({ error: 'rmaId required' }, 400, request);

  const accessToken = await getAccessToken(env);
  const found = await findRowByRmaId(env, accessToken, 'Open', body.rmaId);
  if (!found) return json({ error: `RMA ID ${body.rmaId} not found in Open` }, 404, request);

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

  return json({ rmaId: body.rmaId, record }, 200, request);
}

// POST /return — customer collection: move Open -> Closed, mirror final state into Master
async function handleReturn(request, env) {
  const body = await request.json();
  if (!body.rmaId) return json({ error: 'rmaId required' }, 400, request);
  if (!body.collectedByName) return json({ error: 'collectedByName required' }, 400, request);

  const accessToken = await getAccessToken(env);
  const found = await findRowByRmaId(env, accessToken, 'Open', body.rmaId);
  if (!found) return json({ error: `RMA ID ${body.rmaId} not found in Open` }, 404, request);

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

  return json({ rmaId: body.rmaId, record }, 200, request);
}

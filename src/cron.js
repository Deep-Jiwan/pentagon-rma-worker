import { getAccessToken } from './auth.js';
import { getRows, updateRow, findRowByRmaId } from './sheets.js';
import { uploadPdf } from './storage.js';
import { buildReportPdf } from './pdfReport.js';
import { computeReportMetrics } from './reportData.js';
import { HEADERS } from './constants.js';

function rowToObject(row) {
  const obj = {};
  HEADERS.forEach((h, i) => { obj[h] = row[i] || ''; });
  return obj;
}

function objectToRow(obj) {
  return HEADERS.map(h => obj[h] ?? '');
}

const STUCK_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Hourly: flag any Open ticket still in Diagnostics whose Last Edited
// Timestamp is more than 24h old and isn't already flagged.
export async function runRedFlagScan(env) {
  const accessToken = await getAccessToken(env);
  const rows = await getRows(env, accessToken, 'Open');
  const now = Date.now();
  let flagged = 0;

  for (let i = 0; i < rows.length; i++) {
    const record = rowToObject(rows[i]);
    if (record['Status'] !== 'Diagnostics') continue;
    if (record['Red Flag'] === 'Yes') continue;

    const lastEdited = Date.parse(record['Last Edited Timestamp']);
    if (!lastEdited || (now - lastEdited) < STUCK_THRESHOLD_MS) continue;

    record['Red Flag'] = 'Yes';
    record['Red Flag Reason'] = 'Stuck in Diagnostics for over 24 hours';

    const sheetRowNumber = i + 2; // header row offset
    await updateRow(env, accessToken, 'Open', sheetRowNumber, objectToRow(record));

    const masterFound = await findRowByRmaId(env, accessToken, 'Master', record['RMA ID']);
    if (masterFound) {
      await updateRow(env, accessToken, 'Master', masterFound.sheetRowNumber, objectToRow(record));
    }
    flagged++;
  }

  return { scanned: rows.length, flagged };
}

// Daily: snapshot the current sheet state, build the PDF report, and save
// it into the RMA_REPORTS R2 bucket for archival. This uses the exact same
// computeReportMetrics()/buildReportPdf() pipeline as the on-demand
// POST /reports/generate endpoint (see index.js) — the only difference is this
// one is triggered by the CRON schedule and keeps a dated copy in R2 rather
// than streaming straight back to a caller.
export async function runDailyReport(env) {
  const metrics = await computeReportMetrics(env);
  const pdfBytes = await buildReportPdf(metrics);

  const filename = `RMA-Report-${metrics.generatedAtLabel}.pdf`;
  const uploaded = await uploadPdf(env, filename, pdfBytes);

  await env.RMA_COUNTERS.put('latest_report', JSON.stringify({
    date: metrics.generatedAtLabel,
    fileId: uploaded.id,
    filename
  }));

  return {
    filename,
    fileId: uploaded.id,
    devicesIn: metrics.totals.devicesInToday,
    devicesClosed: metrics.totals.devicesClosedToday,
    redFlags: metrics.totals.redFlagged
  };
}

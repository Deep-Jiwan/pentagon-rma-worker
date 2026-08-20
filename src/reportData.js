import { getAccessToken } from './auth.js';
import { getRows } from './sheets.js';
import { HEADERS } from './constants.js';
import { getEatDateString, getEatDateLabel } from './utils.js';

const TOP_BRANDS_LIMIT = 6;
const BACKLOG_LIMIT = 10;
const TURNAROUND_SAMPLE_SIZE = 60; // most recently closed tickets, to keep the average current

function rowToObject(row) {
  const obj = {};
  HEADERS.forEach((h, i) => { obj[h] = row[i] || ''; });
  return obj;
}

function matchesEatDate(isoString, eatDateStr) {
  if (!isoString) return false;
  const parsed = Date.parse(isoString);
  if (!parsed) return false;
  return getEatDateString(new Date(parsed)) === eatDateStr;
}

function daysSince(isoString, now) {
  const parsed = Date.parse(isoString);
  if (!parsed) return null;
  return Math.max(0, Math.floor((now - parsed) / 86400000));
}

function countBy(records, field) {
  const counts = {};
  for (const r of records) {
    const key = (r[field] || '').trim() || '(unset)';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sortedEntries(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// Full point-in-time snapshot of the sheet's current state: everything the
// report PDF and the frontend's Report tab need. Used both by the on-demand
// "generate report" endpoint and the daily CRON — same computation either
// way, just triggered differently (see cron.js / index.js).
export async function computeReportMetrics(env) {
  const accessToken = await getAccessToken(env);
  const now = Date.now();
  const todayStr = getEatDateString();
  const todayLabel = getEatDateLabel();

  const openRows = (await getRows(env, accessToken, 'Open')).map(rowToObject);
  const closedRows = (await getRows(env, accessToken, 'Closed')).map(rowToObject);
  const allRows = [...openRows, ...closedRows];

  const devicesInToday = allRows.filter((r) => matchesEatDate(r['Date In'], todayStr));
  const devicesClosedToday = closedRows.filter((r) => matchesEatDate(r['Date Out'], todayStr));
  const redFlagged = openRows.filter((r) => r['Red Flag'] === 'Yes');

  const statusCounts = sortedEntries(countBy(openRows, 'Status'));
  const warrantyCounts = sortedEntries(countBy(allRows, 'Warranty Status'));
  const brandCounts = sortedEntries(countBy(allRows, 'Brand')).slice(0, TOP_BRANDS_LIMIT);

  const backlog = openRows
    .map((r) => ({ ...r, _daysOpen: daysSince(r['Date In'], now) }))
    .filter((r) => r._daysOpen !== null)
    .sort((a, b) => b._daysOpen - a._daysOpen)
    .slice(0, BACKLOG_LIMIT);

  const turnaroundSamples = closedRows
    .map((r) => {
      const inMs = Date.parse(r['Date In']);
      const outMs = Date.parse(r['Date Out']);
      if (!inMs || !outMs || outMs < inMs) return null;
      return { days: (outMs - inMs) / 86400000, outMs };
    })
    .filter(Boolean)
    .sort((a, b) => b.outMs - a.outMs)
    .slice(0, TURNAROUND_SAMPLE_SIZE);

  const avgTurnaroundDays = turnaroundSamples.length
    ? turnaroundSamples.reduce((sum, s) => sum + s.days, 0) / turnaroundSamples.length
    : null;

  return {
    generatedAtLabel: todayLabel,
    generatedAtIso: new Date(now).toISOString(),
    totals: {
      open: openRows.length,
      closed: closedRows.length,
      redFlagged: redFlagged.length,
      devicesInToday: devicesInToday.length,
      devicesClosedToday: devicesClosedToday.length
    },
    statusCounts,
    warrantyCounts,
    brandCounts,
    redFlagged,
    backlog,
    avgTurnaroundDays,
    turnaroundSampleSize: turnaroundSamples.length,
    devicesInToday,
    devicesClosedToday
  };
}

import { getAccessToken } from './auth.js';
import { getRows } from './sheets.js';
import { HEADERS } from './constants.js';
import { getEatDateString, getEatDateLabel } from './utils.js';

const TOP_BRANDS_LIMIT = 6;
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

function sortedEntries(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function countBy(records, field) {
  const counts = {};
  for (const r of records) {
    const key = (r[field] || '').trim() || '(unset)';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// The day's operational snapshot — what came in today, what went out today,
// and the current open/red-flag state — plus the standing shop-level mix
// (top brands, warranty split, average turnaround) that the frontend's Report
// tab shows, so the downloaded PDF and the in-app view tell the same story.
// The mix figures are the only part that reads the Closed tab as history;
// everything else is point-in-time. Used both by the on-demand "generate
// report" endpoint and the daily CRON — same computation either way, just
// triggered differently (see cron.js / index.js).
export async function computeReportMetrics(env) {
  const accessToken = await getAccessToken(env);
  const now = Date.now();
  const todayStr = getEatDateString();
  const todayLabel = getEatDateLabel();

  const openRows = (await getRows(env, accessToken, 'Open')).map(rowToObject);
  const closedRows = (await getRows(env, accessToken, 'Closed')).map(rowToObject);
  const allRows = [...openRows, ...closedRows];

  const devicesInToday = allRows.filter((r) => matchesEatDate(r['Date In'], todayStr));
  const devicesOutToday = closedRows.filter((r) => matchesEatDate(r['Date Out'], todayStr));
  const redFlagged = openRows.filter((r) => r['Red Flag'] === 'Yes');

  const statusCounts = sortedEntries(countBy(openRows, 'Status'));
  const warrantyCounts = sortedEntries(countBy(allRows, 'Warranty Status'));
  const brandCounts = sortedEntries(countBy(allRows, 'Brand')).slice(0, TOP_BRANDS_LIMIT);

  // Every open ticket, oldest first — the report's closing section, so the
  // PDF answers "what is actually in the shop right now?" and not just what
  // moved today. `_daysOpen` is null when Date In is missing/unparseable;
  // those tickets still belong in the list, they just can't be aged.
  const openTickets = openRows
    .map((r) => ({ ...r, _daysOpen: daysSince(r['Date In'], now) }))
    .sort((a, b) => (b._daysOpen ?? -1) - (a._daysOpen ?? -1));

  // Averaging the whole Closed history would let long-gone outliers drag the
  // number forever, so this is the most recent slice only.
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
      redFlagged: redFlagged.length,
      devicesInToday: devicesInToday.length,
      devicesOutToday: devicesOutToday.length
    },
    statusCounts,
    warrantyCounts,
    brandCounts,
    avgTurnaroundDays,
    turnaroundSampleSize: turnaroundSamples.length,
    devicesInToday,
    devicesOutToday,
    redFlagged,
    openTickets
  };
}

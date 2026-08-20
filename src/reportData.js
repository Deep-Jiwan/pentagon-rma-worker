import { getAccessToken } from './auth.js';
import { getRows } from './sheets.js';
import { HEADERS } from './constants.js';
import { getEatDateString, getEatDateLabel } from './utils.js';

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

// A single day's operational snapshot: what came in today, what went out
// today, and the current open/red-flag counts — deliberately NOT a
// historical analysis (no all-time Closed-tab breakdowns, no brand/warranty
// mix, no turnaround stats). Used both by the on-demand "generate report"
// endpoint and the daily CRON — same computation either way, just triggered
// differently (see cron.js / index.js). Closed is only read to find today's
// collections; nothing else about it is aggregated.
export async function computeReportMetrics(env) {
  const accessToken = await getAccessToken(env);
  const now = Date.now();
  const todayStr = getEatDateString();
  const todayLabel = getEatDateLabel();

  const openRows = (await getRows(env, accessToken, 'Open')).map(rowToObject);
  const closedRows = (await getRows(env, accessToken, 'Closed')).map(rowToObject);

  const devicesInToday = [...openRows, ...closedRows].filter((r) => matchesEatDate(r['Date In'], todayStr));
  const devicesOutToday = closedRows.filter((r) => matchesEatDate(r['Date Out'], todayStr));
  const redFlagged = openRows.filter((r) => r['Red Flag'] === 'Yes');

  const statusCounts = sortedEntries(countBy(openRows, 'Status'));

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
    devicesInToday,
    devicesOutToday,
    redFlagged
  };
}

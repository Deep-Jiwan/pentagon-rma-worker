// Tanzania is UTC+3 year-round (no DST). Both the RMA ID counter and
// the daily report need "today" measured in EAT, not server-local UTC.

export function getEatDateString(date = new Date()) {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const yyyy = eat.getUTCFullYear();
  const mm = String(eat.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(eat.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`; // e.g. "20260813"
}

export function getEatDateLabel(date = new Date()) {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().slice(0, 10); // e.g. "2026-08-13"
}

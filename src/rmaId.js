// Tanzania is UTC+3 year-round (no DST), so day boundaries for the
// RMA ID counter are computed in EAT, not server-local UTC — otherwise
// a device coming in at 8pm EAT could get tomorrow's date prefix.
function getEatDateString(date = new Date()) {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const yyyy = eat.getUTCFullYear();
  const mm = String(eat.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(eat.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// NOTE: KV get+put is NOT atomic. Two intakes landing in the same
// instant could in theory read the same counter value and produce a
// duplicate RMA ID. At ~10 devices/day this risk is effectively zero
// in practice, but if intake volume/concurrency ever grows, swap this
// for a Durable Object (which serializes access) instead of KV.
export async function generateRmaId(env) {
  const dateStr = getEatDateString();
  const counterKey = `counter:${dateStr}`;

  const current = await env.RMA_COUNTERS.get(counterKey);
  const next = current ? parseInt(current, 10) + 1 : 1;
  await env.RMA_COUNTERS.put(counterKey, String(next));

  const seq = String(next).padStart(2, '0');
  return `RMA-${dateStr}-${seq}`;
}

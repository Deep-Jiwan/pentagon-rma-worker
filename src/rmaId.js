import { getEatDateString } from './utils.js';

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

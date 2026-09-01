import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { HEADERS } from '../src/constants.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow, apiRequest, fakeCtx } from './helpers/fixtures.js';

const EDITED_AT = new Date(Date.now() - 3600000).toISOString();

function field(row, name) {
  return row[HEADERS.indexOf(name)];
}

describe('POST /tickets/:rmaId/whatsapp-sent', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': 'RMA-OPEN', 'Last Edited Timestamp': EDITED_AT })],
      Closed: [buildRow({ 'RMA ID': 'RMA-CLOSED', Status: 'Closed', 'Last Edited Timestamp': EDITED_AT })],
      Master: [
        buildRow({ 'RMA ID': 'RMA-OPEN', 'Last Edited Timestamp': EDITED_AT }),
        buildRow({ 'RMA ID': 'RMA-CLOSED', Status: 'Closed', 'Last Edited Timestamp': EDITED_AT })
      ]
    });
  });

  afterEach(() => google.restore());

  function send(rmaId, body) {
    return worker.fetch(
      apiRequest(`/tickets/${encodeURIComponent(rmaId)}/whatsapp-sent`, {
        method: 'POST',
        body: JSON.stringify(body ?? {})
      }),
      env,
      fakeCtx
    );
  }

  it('stamps the send on both the live tab and Master', async () => {
    const res = await send('RMA-OPEN', { type: 'intake' });
    expect(res.status).toBe(200);

    const { sentAt, type } = await res.json();
    expect(type).toBe('intake');

    for (const tab of ['Open', 'Master']) {
      const row = google.sheetData[tab].find((r) => r[0] === 'RMA-OPEN');
      expect(field(row, 'Last WhatsApp Sent')).toBe(sentAt);
      expect(field(row, 'Last WhatsApp Type')).toBe('intake');
    }
  });

  // The report's "awaiting an update" check compares the message clock
  // against the edit clock — stamping both here would make every message
  // look current the instant it is recorded, and the check would never fire.
  it('leaves Last Edited Timestamp alone', async () => {
    await send('RMA-OPEN');
    const row = google.sheetData.Open.find((r) => r[0] === 'RMA-OPEN');
    expect(field(row, 'Last Edited Timestamp')).toBe(EDITED_AT);
  });

  it('defaults the message type to update', async () => {
    const res = await send('RMA-OPEN');
    expect((await res.json()).type).toBe('update');
  });

  it('rejects a message type it does not recognise', async () => {
    const res = await send('RMA-OPEN', { type: 'carrier-pigeon' });
    expect(res.status).toBe(400);

    const row = google.sheetData.Open.find((r) => r[0] === 'RMA-OPEN');
    expect(field(row, 'Last WhatsApp Sent')).toBe('');
  });

  it('stamps a ticket that has already been collected', async () => {
    const res = await send('RMA-CLOSED');
    expect(res.status).toBe(200);

    const row = google.sheetData.Closed.find((r) => r[0] === 'RMA-CLOSED');
    expect(field(row, 'Last WhatsApp Sent')).not.toBe('');
  });

  it('404s on a ticket that does not exist', async () => {
    const res = await send('RMA-NOPE');
    expect(res.status).toBe(404);
  });

  it('requires the API key like every other route', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/tickets/RMA-OPEN/whatsapp-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(401);
  });
});

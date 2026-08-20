import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { HEADERS } from '../src/constants.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow, apiRequest, fakeCtx } from './helpers/fixtures.js';

const STATUS_COL = HEADERS.indexOf('Status');

describe('DELETE /tickets/:rmaId', () => {
  let env, google;
  const rmaId = 'RMA-20260101-01';

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': rmaId, Status: 'Diagnostics' })],
      Master: [buildRow({ 'RMA ID': rmaId, Status: 'Diagnostics' })]
    });
  });

  afterEach(() => google.restore());

  it('removes the ticket from Open but keeps a Deleted-marked row in Master', async () => {
    const res = await worker.fetch(apiRequest(`/tickets/${rmaId}`, { method: 'DELETE' }), env, fakeCtx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    expect(google.sheetData.Open.find((r) => r[0] === rmaId)).toBeUndefined();

    const masterRow = google.sheetData.Master.find((r) => r[0] === rmaId);
    expect(masterRow).toBeDefined();
    expect(masterRow[STATUS_COL]).toBe('Deleted (was: Diagnostics)');
  });

  it('also works for a ticket currently in Closed', async () => {
    google.sheetData.Open = [];
    google.sheetData.Closed = [buildRow({ 'RMA ID': rmaId, Status: 'Closed' })];

    const res = await worker.fetch(apiRequest(`/tickets/${rmaId}`, { method: 'DELETE' }), env, fakeCtx);
    expect(res.status).toBe(200);
    expect(google.sheetData.Closed.find((r) => r[0] === rmaId)).toBeUndefined();
  });

  it('404s for an RMA ID that does not exist on Open or Closed', async () => {
    const res = await worker.fetch(apiRequest('/tickets/RMA-does-not-exist', { method: 'DELETE' }), env, fakeCtx);
    expect(res.status).toBe(404);
  });

  it('does not double-wrap the Master status on a second delete of an already-gone ticket', async () => {
    // First delete succeeds (found in Open).
    await worker.fetch(apiRequest(`/tickets/${rmaId}`, { method: 'DELETE' }), env, fakeCtx);
    // Second delete: gone from Open/Closed already -> 404, and Master is untouched further.
    const res = await worker.fetch(apiRequest(`/tickets/${rmaId}`, { method: 'DELETE' }), env, fakeCtx);
    expect(res.status).toBe(404);

    const masterRow = google.sheetData.Master.find((r) => r[0] === rmaId);
    expect(masterRow[STATUS_COL]).toBe('Deleted (was: Diagnostics)');
  });
});

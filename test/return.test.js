import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { HEADERS } from '../src/constants.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow, apiRequest, fakeCtx } from './helpers/fixtures.js';

const STATUS_COL = HEADERS.indexOf('Status');
const COLLECTED_BY_COL = HEADERS.indexOf('Collected By Name');

describe('POST /return', () => {
  let env, google;
  const rmaId = 'RMA-20260101-01';

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': rmaId, Status: 'Ready for Pickup' })],
      Master: [buildRow({ 'RMA ID': rmaId, Status: 'Ready for Pickup' })]
    });
  });

  afterEach(() => google.restore());

  it('moves the ticket from Open to Closed and mirrors the final state to Master', async () => {
    const res = await worker.fetch(
      apiRequest('/return', { method: 'POST', body: JSON.stringify({ rmaId, collectedByName: 'Jane Doe' }) }),
      env,
      fakeCtx
    );

    expect(res.status).toBe(200);
    expect(google.sheetData.Open.find((r) => r[0] === rmaId)).toBeUndefined();

    const closedRow = google.sheetData.Closed.find((r) => r[0] === rmaId);
    expect(closedRow).toBeDefined();
    expect(closedRow[STATUS_COL]).toBe('Closed');
    expect(closedRow[COLLECTED_BY_COL]).toBe('Jane Doe');

    const masterRow = google.sheetData.Master.find((r) => r[0] === rmaId);
    expect(masterRow[STATUS_COL]).toBe('Closed');
  });

  it('requires collectedByName', async () => {
    const res = await worker.fetch(
      apiRequest('/return', { method: 'POST', body: JSON.stringify({ rmaId }) }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(400);
    expect(google.sheetData.Open).toHaveLength(1); // untouched
  });

  it('404s for an RMA ID not in Open', async () => {
    const res = await worker.fetch(
      apiRequest('/return', { method: 'POST', body: JSON.stringify({ rmaId: 'RMA-nope', collectedByName: 'X' }) }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { HEADERS } from '../src/constants.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow, apiRequest, fakeCtx } from './helpers/fixtures.js';

const STATUS_COL = HEADERS.indexOf('Status');
const RED_FLAG_COL = HEADERS.indexOf('Red Flag');

describe('POST /update', () => {
  let env, google;
  const rmaId = 'RMA-20260101-01';

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': rmaId, Status: 'Diagnostics', 'Red Flag': 'Yes', 'Red Flag Reason': 'Stuck in Diagnostics for over 24 hours' })],
      Master: [buildRow({ 'RMA ID': rmaId, Status: 'Diagnostics', 'Red Flag': 'Yes', 'Red Flag Reason': 'Stuck in Diagnostics for over 24 hours' })]
    });
  });

  afterEach(() => google.restore());

  it('updates status/resolution/repair details and mirrors the change to Master', async () => {
    const res = await worker.fetch(
      apiRequest('/update', {
        method: 'POST',
        body: JSON.stringify({
          rmaId,
          status: 'Repair',
          resolution: 'Replaced faulty power supply',
          repairDetails: 'Swapped capacitor C14',
          technicianName: 'Manase'
        })
      }),
      env,
      fakeCtx
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record['Status']).toBe('Repair');
    expect(body.record['Resolution']).toBe('Replaced faulty power supply');

    const masterRow = google.sheetData.Master.find((r) => r[0] === rmaId);
    expect(masterRow[STATUS_COL]).toBe('Repair');
  });

  it('clears the red flag once status moves off Diagnostics', async () => {
    const res = await worker.fetch(
      apiRequest('/update', { method: 'POST', body: JSON.stringify({ rmaId, status: 'Estimate Sent' }) }),
      env,
      fakeCtx
    );
    const body = await res.json();
    expect(body.record['Red Flag']).toBe('No');
    expect(body.record['Red Flag Reason']).toBe('');

    const openRow = google.sheetData.Open.find((r) => r[0] === rmaId);
    expect(openRow[RED_FLAG_COL]).toBe('No');
  });

  it('leaves the red flag alone if the status stays Diagnostics', async () => {
    const res = await worker.fetch(
      apiRequest('/update', { method: 'POST', body: JSON.stringify({ rmaId, resolution: 'Still investigating' }) }),
      env,
      fakeCtx
    );
    const body = await res.json();
    expect(body.record['Red Flag']).toBe('Yes');
  });

  it('404s for an RMA ID not in Open', async () => {
    const res = await worker.fetch(
      apiRequest('/update', { method: 'POST', body: JSON.stringify({ rmaId: 'RMA-does-not-exist', status: 'Repair' }) }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(404);
  });

  it('requires rmaId', async () => {
    const res = await worker.fetch(
      apiRequest('/update', { method: 'POST', body: JSON.stringify({ status: 'Repair' }) }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(400);
  });
});

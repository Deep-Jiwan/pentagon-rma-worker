import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { validIntakeBody, apiRequest, fakeCtx } from './helpers/fixtures.js';

describe('POST /intake', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock();
  });

  afterEach(() => google.restore());

  it('creates a ticket in Open and Master, defaulting to Diagnostics / no red flag', async () => {
    const res = await worker.fetch(
      apiRequest('/intake', { method: 'POST', body: JSON.stringify(validIntakeBody) }),
      env,
      fakeCtx
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rmaId).toMatch(/^RMA-\d{8}-\d{2}$/);
    expect(body.record['Status']).toBe('Diagnostics');
    expect(body.record['Red Flag']).toBe('No');
    expect(body.record['Customer Name']).toBe('Jane Doe');

    expect(google.sheetData.Open).toHaveLength(1);
    expect(google.sheetData.Master).toHaveLength(1);
    expect(google.sheetData.Open[0][0]).toBe(body.rmaId); // column A = RMA ID
  });

  it('rejects a request missing a required field', async () => {
    const { sn, ...missingSn } = validIntakeBody;
    const res = await worker.fetch(
      apiRequest('/intake', { method: 'POST', body: JSON.stringify(missingSn) }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(400);
    expect(google.sheetData.Open).toHaveLength(0);
  });

  it('generates sequential RMA IDs for the same day', async () => {
    const r1 = await worker.fetch(apiRequest('/intake', { method: 'POST', body: JSON.stringify(validIntakeBody) }), env, fakeCtx);
    const r2 = await worker.fetch(apiRequest('/intake', { method: 'POST', body: JSON.stringify({ ...validIntakeBody, sn: 'SN456' }) }), env, fakeCtx);
    const id1 = (await r1.json()).rmaId;
    const id2 = (await r2.json()).rmaId;
    expect(id1).not.toBe(id2);
    expect(id1.slice(0, -2)).toBe(id2.slice(0, -2)); // same date prefix
  });
});

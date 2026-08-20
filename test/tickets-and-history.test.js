import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow, apiRequest, fakeCtx } from './helpers/fixtures.js';

describe('GET /tickets', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': 'RMA-OPEN-1' })],
      Closed: [buildRow({ 'RMA ID': 'RMA-CLOSED-1', Status: 'Closed' })]
    });
  });

  afterEach(() => google.restore());

  it('defaults to the Open tab', async () => {
    const res = await worker.fetch(apiRequest('/tickets'), env, fakeCtx);
    const body = await res.json();
    expect(body.tab).toBe('Open');
    expect(body.count).toBe(1);
    expect(body.tickets[0]['RMA ID']).toBe('RMA-OPEN-1');
  });

  it('returns the Closed tab on request', async () => {
    const res = await worker.fetch(apiRequest('/tickets?tab=Closed'), env, fakeCtx);
    const body = await res.json();
    expect(body.tickets[0]['RMA ID']).toBe('RMA-CLOSED-1');
  });

  it('rejects an unknown tab', async () => {
    const res = await worker.fetch(apiRequest('/tickets?tab=Bogus'), env, fakeCtx);
    expect(res.status).toBe(400);
  });
});

describe('GET /device-history', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Master: [
        buildRow({ 'RMA ID': 'RMA-OLD-1', SN: 'SHARED-SN', Status: 'Closed' }),
        buildRow({ 'RMA ID': 'RMA-OTHER', SN: 'UNRELATED-SN' })
      ]
    });
  });

  afterEach(() => google.restore());

  it('finds prior repairs for a serial number from Master', async () => {
    const res = await worker.fetch(apiRequest('/device-history?sn=SHARED-SN'), env, fakeCtx);
    const body = await res.json();
    expect(body.priorRepairs).toHaveLength(1);
    expect(body.priorRepairs[0]['RMA ID']).toBe('RMA-OLD-1');
  });

  it('requires the sn query param', async () => {
    const res = await worker.fetch(apiRequest('/device-history'), env, fakeCtx);
    expect(res.status).toBe(400);
  });
});

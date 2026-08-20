import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { computeReportMetrics } from '../src/reportData.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow, apiRequest, fakeCtx } from './helpers/fixtures.js';

const TODAY = new Date().toISOString();
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 86400000).toISOString();

describe('computeReportMetrics', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [
        buildRow({ 'RMA ID': 'RMA-IN-TODAY', 'Date In': TODAY, Status: 'Diagnostics' }),
        buildRow({ 'RMA ID': 'RMA-OLD-OPEN', 'Date In': TWO_DAYS_AGO, Status: 'Repair', 'Red Flag': 'Yes', 'Red Flag Reason': 'Stuck in Diagnostics for over 24 hours' })
      ],
      Closed: [
        buildRow({ 'RMA ID': 'RMA-OUT-TODAY', 'Date In': TWO_DAYS_AGO, 'Date Out': TODAY, Status: 'Closed', 'Collected By Name': 'Jane Doe' }),
        buildRow({ 'RMA ID': 'RMA-OUT-OLD', 'Date In': TWO_DAYS_AGO, 'Date Out': TWO_DAYS_AGO, Status: 'Closed' })
      ]
    });
  });

  afterEach(() => google.restore());

  it('scopes devices in/out to today only, and totals/red-flags to current Open state', async () => {
    const metrics = await computeReportMetrics(env);

    expect(metrics.totals.open).toBe(2);
    expect(metrics.totals.redFlagged).toBe(1);
    expect(metrics.totals.devicesInToday).toBe(1);
    expect(metrics.totals.devicesOutToday).toBe(1);

    expect(metrics.devicesInToday.map((r) => r['RMA ID'])).toEqual(['RMA-IN-TODAY']);
    expect(metrics.devicesOutToday.map((r) => r['RMA ID'])).toEqual(['RMA-OUT-TODAY']);
    expect(metrics.redFlagged.map((r) => r['RMA ID'])).toEqual(['RMA-OLD-OPEN']);
  });

  it('does not include yesterday-out or yesterday-in tickets in the daily lists', async () => {
    const metrics = await computeReportMetrics(env);
    const inIds = metrics.devicesInToday.map((r) => r['RMA ID']);
    const outIds = metrics.devicesOutToday.map((r) => r['RMA ID']);
    expect(inIds).not.toContain('RMA-OLD-OPEN');
    expect(outIds).not.toContain('RMA-OUT-OLD');
  });
});

describe('POST /reports/generate', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': 'RMA-1', 'Date In': TODAY })]
    });
  });

  afterEach(() => google.restore());

  it('returns a real PDF and saves it to R2 as the latest copy', async () => {
    const res = await worker.fetch(apiRequest('/reports/generate', { method: 'POST' }), env, fakeCtx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(500);
    // A real PDF starts with the %PDF- magic bytes.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');

    expect(env.RMA_REPORTS._store.has('RMA-Report-Latest.pdf')).toBe(true);
  });
});

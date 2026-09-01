import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { computeReportMetrics } from '../src/reportData.js';
import { buildReportPdf } from '../src/pdfReport.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow, apiRequest, fakeCtx } from './helpers/fixtures.js';

const TODAY = new Date().toISOString();
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 86400000).toISOString();
const TEN_DAYS_AGO = new Date(Date.now() - 10 * 86400000).toISOString();

describe('computeReportMetrics', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock({
      Open: [
        buildRow({ 'RMA ID': 'RMA-IN-TODAY', 'Date In': TODAY, Status: 'Diagnostics', Brand: 'Hikvision', 'Warranty Status': 'Under Warranty' }),
        buildRow({ 'RMA ID': 'RMA-OLD-OPEN', 'Date In': TWO_DAYS_AGO, Status: 'Repair', Brand: 'Dahua', 'Warranty Status': 'Under Warranty', 'Red Flag': 'Yes', 'Red Flag Reason': 'Stuck in Diagnostics for over 24 hours' }),
        buildRow({ 'RMA ID': 'RMA-OLDEST-OPEN', 'Date In': TEN_DAYS_AGO, Status: 'Awaiting Parts', Brand: 'Hikvision', 'Warranty Status': 'No warranty (Paid Service)' })
      ],
      Closed: [
        buildRow({ 'RMA ID': 'RMA-OUT-TODAY', 'Date In': TWO_DAYS_AGO, 'Date Out': TODAY, Status: 'Closed', Brand: 'Hikvision', 'Warranty Status': 'Void under warranty', 'Collected By Name': 'Jane Doe' }),
        buildRow({ 'RMA ID': 'RMA-OUT-OLD', 'Date In': TWO_DAYS_AGO, 'Date Out': TWO_DAYS_AGO, Status: 'Closed', Brand: 'ZKTeco', 'Warranty Status': 'Under Warranty' })
      ]
    });
  });

  afterEach(() => google.restore());

  it('scopes devices in/out to today only, and totals/red-flags to current Open state', async () => {
    const metrics = await computeReportMetrics(env);

    expect(metrics.totals.open).toBe(3);
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

  it('lists every open ticket, oldest first, with its age in days', async () => {
    const metrics = await computeReportMetrics(env);

    expect(metrics.openTickets.map((r) => r['RMA ID'])).toEqual([
      'RMA-OLDEST-OPEN',
      'RMA-OLD-OPEN',
      'RMA-IN-TODAY'
    ]);
    expect(metrics.openTickets.map((r) => r._daysOpen)).toEqual([10, 2, 0]);
    // Closed tickets are history, not "currently open".
    expect(metrics.openTickets.map((r) => r['RMA ID'])).not.toContain('RMA-OUT-TODAY');
  });

  it('mixes brands and warranty status across open and closed tickets alike', async () => {
    const metrics = await computeReportMetrics(env);

    expect(metrics.brandCounts).toEqual([['Hikvision', 3], ['Dahua', 1], ['ZKTeco', 1]]);
    expect(metrics.warrantyCounts).toEqual([
      ['Under Warranty', 3],
      ['No warranty (Paid Service)', 1],
      ['Void under warranty', 1]
    ]);
  });

  it('averages turnaround over closed tickets that have both dates', async () => {
    const metrics = await computeReportMetrics(env);

    // RMA-OUT-TODAY took two days; RMA-OUT-OLD went out the day it came in.
    expect(metrics.turnaroundSampleSize).toBe(2);
    expect(metrics.avgTurnaroundDays).toBeCloseTo(1, 5);
  });

  it('reports no turnaround at all when no closed ticket has both dates', async () => {
    google.restore();
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': 'RMA-1', 'Date In': TODAY })],
      Closed: [buildRow({ 'RMA ID': 'RMA-2', 'Date In': TODAY, 'Date Out': '' })]
    });

    const metrics = await computeReportMetrics(env);
    expect(metrics.avgTurnaroundDays).toBeNull();
    expect(metrics.turnaroundSampleSize).toBe(0);
  });

  it('chases only the customers who have not heard about the ticket as it stands', async () => {
    google.restore();
    const anHourAgo = new Date(Date.now() - 3600000).toISOString();
    const halfAnHourAgo = new Date(Date.now() - 1800000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 7200000).toISOString();

    google = installGoogleMock({
      Open: [
        buildRow({ 'RMA ID': 'RMA-NEVER', 'Last Edited Timestamp': anHourAgo }),
        buildRow({
          'RMA ID': 'RMA-STALE',
          'Last Edited Timestamp': anHourAgo,
          'Last WhatsApp Sent': twoHoursAgo
        }),
        buildRow({
          'RMA ID': 'RMA-CURRENT',
          'Last Edited Timestamp': anHourAgo,
          'Last WhatsApp Sent': halfAnHourAgo
        })
      ]
    });

    const metrics = await computeReportMetrics(env);
    const byId = Object.fromEntries(metrics.openTickets.map((r) => [r['RMA ID'], r._messageState]));

    expect(byId).toEqual({
      'RMA-NEVER': 'never',
      // Messaged, but the ticket moved afterwards — the customer is holding
      // an out-of-date answer, which is no better than none.
      'RMA-STALE': 'stale',
      'RMA-CURRENT': 'current'
    });
    expect(metrics.awaitingNotification.map((r) => r['RMA ID'])).toEqual(['RMA-NEVER', 'RMA-STALE']);
  });

  it('renders every section of the PDF from that snapshot', async () => {
    const metrics = await computeReportMetrics(env);
    const bytes = await buildReportPdf(metrics);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('renders a report with nothing in it at all', async () => {
    google.restore();
    google = installGoogleMock({ Open: [], Closed: [] });

    const metrics = await computeReportMetrics(env);
    expect(metrics.openTickets).toEqual([]);
    expect(metrics.brandCounts).toEqual([]);
    expect(metrics.awaitingNotification).toEqual([]);

    const bytes = await buildReportPdf(metrics);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
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

  it('names the download with today\'s date, and exposes that header to the browser', async () => {
    const res = await worker.fetch(
      apiRequest('/reports/generate', { method: 'POST', headers: { Origin: 'https://rma.pentagon-solutions.tech' } }),
      env,
      fakeCtx
    );
    const disposition = res.headers.get('Content-Disposition');
    const today = new Date().toISOString().slice(0, 10);
    expect(disposition).toContain(`RMA-Report-${today}.pdf`);
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Disposition');
  });
});

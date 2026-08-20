import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runRedFlagScan } from '../src/cron.js';
import { HEADERS } from '../src/constants.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { buildRow } from './helpers/fixtures.js';

const RED_FLAG_COL = HEADERS.indexOf('Red Flag');
const REASON_COL = HEADERS.indexOf('Red Flag Reason');

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

describe('runRedFlagScan (hourly CRON)', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
  });

  afterEach(() => google?.restore());

  it('flags an Open Diagnostics ticket untouched for over 24h', async () => {
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': 'RMA-1', Status: 'Diagnostics', 'Last Edited Timestamp': hoursAgo(25) })],
      Master: [buildRow({ 'RMA ID': 'RMA-1', Status: 'Diagnostics', 'Last Edited Timestamp': hoursAgo(25) })]
    });

    const result = await runRedFlagScan(env);
    expect(result.flagged).toBe(1);

    const row = google.sheetData.Open.find((r) => r[0] === 'RMA-1');
    expect(row[RED_FLAG_COL]).toBe('Yes');
    expect(row[REASON_COL]).toBe('Stuck in Diagnostics for over 24 hours');

    const masterRow = google.sheetData.Master.find((r) => r[0] === 'RMA-1');
    expect(masterRow[RED_FLAG_COL]).toBe('Yes');
  });

  it('does not flag a ticket edited within the last 24h', async () => {
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': 'RMA-2', Status: 'Diagnostics', 'Last Edited Timestamp': hoursAgo(2) })]
    });
    const result = await runRedFlagScan(env);
    expect(result.flagged).toBe(0);
  });

  it('ignores tickets not in Diagnostics, even if stale', async () => {
    google = installGoogleMock({
      Open: [buildRow({ 'RMA ID': 'RMA-3', Status: 'Repair', 'Last Edited Timestamp': hoursAgo(72) })]
    });
    const result = await runRedFlagScan(env);
    expect(result.flagged).toBe(0);
  });

  it('does not re-flag a ticket that is already flagged', async () => {
    google = installGoogleMock({
      Open: [
        buildRow({
          'RMA ID': 'RMA-4',
          Status: 'Diagnostics',
          'Last Edited Timestamp': hoursAgo(48),
          'Red Flag': 'Yes',
          'Red Flag Reason': 'Stuck in Diagnostics for over 24 hours'
        })
      ]
    });
    const result = await runRedFlagScan(env);
    expect(result.flagged).toBe(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { createMockEnv } from './helpers/mockEnv.js';
import { installGoogleMock } from './helpers/mockGoogle.js';
import { fakeCtx } from './helpers/fixtures.js';

describe('shared API key', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock();
  });

  afterEach(() => google.restore());

  it('401s with no X-API-Key header', async () => {
    const res = await worker.fetch(new Request('https://worker.test/tickets'), env, fakeCtx);
    expect(res.status).toBe(401);
  });

  it('401s with the wrong key', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', { headers: { 'X-API-Key': 'wrong-key' } }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(401);
  });

  it('401s if the Worker has no API_KEY secret configured', async () => {
    const noKeyEnv = createMockEnv({ API_KEY: undefined });
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', { headers: { 'X-API-Key': 'anything' } }),
      noKeyEnv,
      fakeCtx
    );
    expect(res.status).toBe(401);
  });

  it('passes through with the correct key', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', { headers: { 'X-API-Key': 'test-api-key' } }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(200);
  });
});

describe('CORS', () => {
  let env, google;

  beforeEach(() => {
    env = createMockEnv();
    google = installGoogleMock();
  });

  afterEach(() => google.restore());

  it('exposes Content-Disposition so the frontend can read the download filename', async () => {
    // Content-Disposition isn't on the CORS-safelisted response header list —
    // without Access-Control-Expose-Headers, res.headers.get() on the
    // frontend returns null for it (silently, no error), and the dated
    // filename the server sends gets thrown away for a generic fallback.
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', {
        headers: { 'X-API-Key': 'test-api-key', Origin: 'https://rma.pentagon-solutions.tech' }
      }),
      env,
      fakeCtx
    );
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Disposition');
  });

  it('reflects the deployed frontend origin', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', {
        headers: { 'X-API-Key': 'test-api-key', Origin: 'https://pentagon-rma-frontend.pentagontz.workers.dev' }
      }),
      env,
      fakeCtx
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://pentagon-rma-frontend.pentagontz.workers.dev');
  });

  it('reflects the custom domain', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', {
        headers: { 'X-API-Key': 'test-api-key', Origin: 'https://rma.pentagon-solutions.tech' }
      }),
      env,
      fakeCtx
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rma.pentagon-solutions.tech');
  });

  it('falls back to the first allowed origin for an unrecognized Origin', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', {
        headers: { 'X-API-Key': 'test-api-key', Origin: 'https://evil.example.com' }
      }),
      env,
      fakeCtx
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://pentagon-rma-frontend.pentagontz.workers.dev');
  });

  it('answers an OPTIONS preflight without requiring the API key', async () => {
    const res = await worker.fetch(
      new Request('https://worker.test/tickets', {
        method: 'OPTIONS',
        headers: { Origin: 'https://rma.pentagon-solutions.tech' }
      }),
      env,
      fakeCtx
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rma.pentagon-solutions.tech');
  });
});

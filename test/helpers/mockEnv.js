import { generateKeyPairSync } from 'crypto';

// KV Namespace fake — just enough of the interface the app actually uses
// (get with {type:'json'}, put with expirationTtl, delete).
export function createMockKv() {
  const store = new Map();
  return {
    async get(key, opts) {
      if (!store.has(key)) return null;
      const raw = store.get(key);
      if (opts && opts.type === 'json') return JSON.parse(raw);
      return raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    _store: store
  };
}

// R2 Bucket fake — put/get/delete, get() returns an object with
// arrayBuffer() like the real R2ObjectBody.
export function createMockR2() {
  const store = new Map();
  return {
    async put(key, value) {
      store.set(key, value);
    },
    async get(key) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      return {
        async arrayBuffer() {
          if (value instanceof Uint8Array) return value.buffer;
          if (value instanceof ArrayBuffer) return value;
          return new TextEncoder().encode(String(value)).buffer;
        }
      };
    },
    async delete(key) {
      store.delete(key);
    },
    _store: store
  };
}

// A fresh, real RSA keypair generated per test run — auth.js genuinely
// imports this via Web Crypto and signs a JWT with it, so it has to be
// structurally valid PKCS8. It's never used for real Google auth (the
// token exchange itself is mocked in mockGoogle.js), so there's nothing
// sensitive about it.
export function createMockEnv(overrides = {}) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  return {
    API_KEY: 'test-api-key',
    GOOGLE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: privateKey,
    SPREADSHEET_ID: 'test-spreadsheet-id',
    RMA_COUNTERS: createMockKv(),
    RMA_REPORTS: createMockR2(),
    ...overrides
  };
}

import { HEADERS } from '../../src/constants.js';

// Builds a raw sheet row (array, in HEADERS column order) from a partial
// object keyed by field name, so tests never have to know column indexes.
export function buildRow(overrides = {}) {
  const now = new Date().toISOString();
  const base = {
    'RMA ID': 'RMA-20260101-01',
    SN: 'SN0',
    'Customer Name': 'Test Customer',
    'Mobile Number': '+255700000000',
    'Invoice Number': '',
    'Purchase Date': '',
    'Model Number': 'M1',
    'Product Type': 'Camera',
    Brand: 'Hikvision',
    'Problem Description': 'Test problem',
    'Technician Name': 'Manase',
    'Date In': now,
    'Warranty Status': 'Under Warranty',
    Status: 'Diagnostics',
    Resolution: '',
    'Repair/Replacement Details': '',
    'Date Out': '',
    'Collected By Name': '',
    'Collector Mobile Number': '',
    'Red Flag': 'No',
    'Red Flag Reason': '',
    'Additional Details': '',
    'Last Edited Timestamp': now
  };
  const merged = { ...base, ...overrides };
  return HEADERS.map((h) => merged[h] ?? '');
}

export const validIntakeBody = {
  sn: 'SN123',
  customerName: 'Jane Doe',
  mobileNumber: '+255700000000',
  invoiceNumber: 'INV-1',
  purchaseDate: '2026-01-01',
  modelNumber: 'DS-2CD2043G0',
  productType: 'IP Camera',
  brand: 'Hikvision',
  problemDescription: 'No image, power light off',
  technicianName: 'Manase',
  warrantyStatus: 'Under Warranty'
};

export function apiRequest(path, opts = {}) {
  return new Request(`https://worker.test${path}`, {
    ...opts,
    headers: {
      'X-API-Key': 'test-api-key',
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
}

export const fakeCtx = { waitUntil() {} };

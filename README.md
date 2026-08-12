# Pentagon RMA Worker

Cloudflare Worker that talks directly to the "Pentagon Solutions - RMA
Tracker" Google Sheet using the service account you set up earlier.
No Apps Script in the runtime path — this Worker is the only thing
that writes to the sheet from here on.

## Setup

```bash
cd pentagon-rma-worker
npm install
npx wrangler login
```

Set the two secrets from the service account JSON key you downloaded
(never put these in wrangler.toml or commit them):

```bash
npx wrangler secret put GOOGLE_CLIENT_EMAIL
# paste the "client_email" value from the JSON key, e.g.
# rma-worker@pentagon-rma.iam.gserviceaccount.com

npx wrangler secret put GOOGLE_PRIVATE_KEY
# paste the FULL "private_key" value from the JSON key, including the
# -----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY----- lines
```

`SPREADSHEET_ID` and the `RMA_COUNTERS` KV binding are already set in
`wrangler.toml` (pointing at the sheet in My Drive → Claude →
PentagonRMA and the KV namespace created for the RMA ID counter).

Make sure the sheet is shared with the service account's email as
**Editor** (done in the earlier step) — otherwise every request will
fail with a permissions error from the Sheets API.

## Run locally / deploy

```bash
npm run dev      # local dev server, wrangler dev
npm run deploy    # ships it to Cloudflare
```

## Endpoints

**GET `/device-history?sn=<serial>`**
Look up prior repair history for a device by serial number (call this
right after the intake barcode scan, before generating a new ticket).

**POST `/intake`**
```json
{
  "sn": "SN12345",
  "customerName": "Jane Doe",
  "mobileNumber": "0712345678",
  "invoiceNumber": "INV-001",
  "purchaseDate": "2026-01-15",
  "modelNumber": "DS-2CD2143G0",
  "productType": "IP Camera",
  "brand": "Hikvision",
  "problemDescription": "No power / not booting",
  "technicianName": "John",
  "warrantyStatus": "Warranty RMA",
  "additionalDetails": "Customer says it stopped after a storm"
}
```
Returns `{ rmaId, record }`. `rmaId` is what gets printed as the QR
on the receipt.

**POST `/update`**
```json
{ "rmaId": "RMA-20260813-01", "status": "Estimate Sent", "resolution": "Board-level repair needed" }
```
Any of `status`, `resolution`, `repairDetails`, `technicianName`,
`additionalDetails` can be included — only fields you send get changed.

**POST `/return`**
```json
{ "rmaId": "RMA-20260813-01", "collectedByName": "Jane Doe", "collectorMobileNumber": "0712345678" }
```
Moves the ticket from Open to Closed and mirrors the final state into
Master.

## Not wired up yet

- `scheduled()` is a stub — the hourly stuck-in-diagnostics red-flag
  scan and the daily PDF report both land in the next step.
- CORS is wide open (`*`) for now — tighten `CORS_HEADERS` in
  `src/index.js` to your actual Pages domain once the frontend exists.

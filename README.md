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

npx wrangler secret put API_KEY
# any random string — this is the shared key the frontend sends as
# X-API-Key on every request. Generate one with e.g.
# `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
```

`SPREADSHEET_ID` and the `RMA_COUNTERS` KV binding are already set in
`wrangler.toml` (pointing at the sheet in My Drive → Claude →
PentagonRMA and the KV namespace created for the RMA ID counter).

Make sure the sheet is shared with the service account's email as
**Editor** (done in the earlier step) — otherwise every request will
fail with a permissions error from the Sheets API.

Daily PDF reports are stored in the `RMA_REPORTS` R2 bucket (bound in
`wrangler.toml`) rather than Google Drive — service accounts have no
storage quota of their own outside a Google Workspace Shared Drive,
so Drive isn't used here at all.

## Run locally / deploy

```bash
npm run dev      # local dev server, wrangler dev
npm run deploy    # ships it to Cloudflare
```

## Endpoints

All endpoints below (except the `OPTIONS` preflight) require a shared
API key sent as the `X-API-Key` header, checked against the `API_KEY`
Worker secret. Requests without a matching key get `401 {"error":"Unauthorized"}`.

**GET `/tickets?tab=Open|Closed|Master`** (default `Open`)
Lists all rows from a tab as JSON objects — powers the Dashboard's
ticket table. Returns `{ tab, count, tickets }`.

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

**GET `/reports/latest`**
Downloads the most recent daily report PDF. The Worker fetches it from
the `RMA_REPORTS` R2 bucket and streams it back directly — the bucket
itself is never made public, since the report contains customer names
and phone numbers.

**POST `/tickets/:rmaId/pdf`**
Body is the raw PDF bytes (`Content-Type: application/pdf`), stored into
`RMA_REPORTS` as `<rmaId>.pdf`. The frontend generates this PDF itself
(via jsPDF, see its `lib/pdf.ts`) right after intake and posts it here as
a backup copy — the Worker never regenerates the form layout, so it only
lives in one place. Not Google Drive, for the same reason as the daily
report: this service account has no Drive storage quota outside a
Workspace Shared Drive.

**GET `/tickets/:rmaId/pdf`**
Fetches a previously-saved ticket PDF back out of R2 (e.g. to
reprint/redownload later without regenerating it client-side). `404` if
none was ever saved for that RMA ID.

**DELETE `/tickets/:rmaId`**
Permanently deletes a ticket from every tab it's in (Open or Closed,
whichever it's currently in, plus its Master mirror) and best-effort
cleans up its saved PDF from R2. Hard delete, no undo — the frontend
confirms with the user before calling this.

**POST `/admin/run-redflag-scan`** and **POST `/admin/run-daily-report`**
Manually trigger the CRON logic on demand, for testing — no need to
wait for the actual hourly/5pm schedule. No body required for either.

## CRON schedule

- Hourly (`0 * * * *`): scans Open for tickets still in Diagnostics
  with a Last Edited Timestamp older than 24h, sets Red Flag = Yes.
- Daily at 14:00 UTC / 17:00 EAT (`0 14 * * *`): builds the PDF report
  (new intakes today, closed today, currently red-flagged) and saves
  it into the `RMA_REPORTS` R2 bucket as `RMA-Report-YYYY-MM-DD.pdf`.

## Still to do

- CORS is locked to specific origins via the `ALLOWED_ORIGINS` list in
  `src/index.js` — add any new frontend domain there.
- Auth is a single shared API key for now (see Endpoints above) — fine
  for one small team on one Worker, but doesn't give per-technician
  accountability. Cloudflare Access or per-user login are options if
  that's ever needed.

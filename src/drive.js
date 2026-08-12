// Minimal Drive API v3 helpers — just enough to save the daily PDF
// report into the PentagonRMA folder and read it back out again for
// the dashboard's download button. Uses the same service account
// token as sheets.js (auth.js now requests both Sheets + Drive scope).

const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const FILES_BASE = 'https://www.googleapis.com/drive/v3/files';

// Uploads a PDF (as a Uint8Array/ArrayBuffer) into env.DRIVE_FOLDER_ID,
// naming it e.g. "RMA-Report-2026-08-13.pdf". Returns the created file's
// { id, name, webViewLink }.
export async function uploadPdf(env, accessToken, filename, pdfBytes) {
  const metadata = {
    name: filename,
    parents: [env.DRIVE_FOLDER_ID],
    mimeType: 'application/pdf'
  };

  const boundary = 'rma_report_boundary';
  const metadataPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n`;
  const filePartHeader =
    `--${boundary}\r\n` +
    `Content-Type: application/pdf\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const body = new Blob([
    encoder.encode(metadataPart),
    encoder.encode(filePartHeader),
    pdfBytes,
    encoder.encode(closing)
  ]);

  const res = await fetch(`${UPLOAD_BASE}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Finds a file by exact name inside env.DRIVE_FOLDER_ID. Returns the
// file's { id, name } or null.
export async function findFileByName(env, accessToken, filename) {
  const q = encodeURIComponent(`name = '${filename.replace(/'/g, "\\'")}' and '${env.DRIVE_FOLDER_ID}' in parents and trashed = false`);
  const res = await fetch(`${FILES_BASE}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Drive search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.files && data.files[0]) || null;
}

// Streams a file's raw bytes back out by ID — used to proxy the
// download through the Worker rather than exposing a public Drive link.
export async function downloadFile(env, accessToken, fileId) {
  const res = await fetch(`${FILES_BASE}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
  return res.arrayBuffer();
}

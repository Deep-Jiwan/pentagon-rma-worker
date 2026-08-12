// Minimal R2 helpers for the daily PDF report. Replaces the earlier
// Google Drive approach — service accounts have no Drive storage
// quota of their own outside a Google Workspace Shared Drive, so
// reports live in the RMA_REPORTS R2 bucket instead.

// Saves a PDF (Uint8Array/ArrayBuffer) under `filename` as the R2 key.
// Returns { id, name } — `id` mirrors the old Drive shape (the R2 key)
// so callers/dashboard payloads don't need to change.
export async function uploadPdf(env, filename, pdfBytes) {
  await env.RMA_REPORTS.put(filename, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' }
  });
  return { id: filename, name: filename };
}

// Streams a report's raw bytes back out by key (the filename).
export async function downloadFile(env, fileId) {
  const obj = await env.RMA_REPORTS.get(fileId);
  if (!obj) throw new Error(`Report not found in R2: ${fileId}`);
  return obj.arrayBuffer();
}

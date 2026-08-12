import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 612;  // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 40;

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

export async function buildDailyReportPdf({
  dateLabel,
  devicesIn,
  devicesClosed,
  redFlagCount,
  inToday,
  closedToday,
  redFlagged
}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(space) {
    if (y - space < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function text(str, { size = 10, bold = false, color } = {}) {
    ensureSpace(size + 6);
    page.drawText(str, { x: MARGIN, y, size, font: bold ? boldFont : font, color: color || rgb(0, 0, 0) });
    y -= (size + 6);
  }

  function sectionTitle(str) {
    y -= 8;
    text(str, { size: 12, bold: true });
  }

  const colX = [MARGIN, MARGIN + 110, MARGIN + 230, MARGIN + 350];
  function tableRow(cells, { bold = false, size = 9, color } = {}) {
    ensureSpace(size + 6);
    cells.forEach((c, i) => {
      page.drawText(c || '', { x: colX[i], y, size, font: bold ? boldFont : font, color: color || rgb(0, 0, 0) });
    });
    y -= (size + 6);
  }

  text('Pentagon Solutions - Daily RMA Report', { size: 16, bold: true });
  text(dateLabel, { size: 11 });
  y -= 4;
  text(
    `Devices in today: ${devicesIn}    Devices closed today: ${devicesClosed}    Red flags: ${redFlagCount}`,
    { size: 11, bold: true, color: redFlagCount > 0 ? rgb(0.7, 0, 0) : rgb(0, 0, 0) }
  );

  sectionTitle('New Intakes Today');
  tableRow(['RMA ID', 'Customer', 'Product', 'Status'], { bold: true });
  if (inToday.length === 0) {
    text('(none)', { size: 9 });
  } else {
    for (const r of inToday) {
      tableRow([r['RMA ID'], truncate(r['Customer Name'], 20), truncate(r['Product Type'], 18), r['Status']]);
    }
  }

  sectionTitle('Closed / Collected Today');
  tableRow(['RMA ID', 'Customer', 'Product', 'Collected By'], { bold: true });
  if (closedToday.length === 0) {
    text('(none)', { size: 9 });
  } else {
    for (const r of closedToday) {
      tableRow([r['RMA ID'], truncate(r['Customer Name'], 20), truncate(r['Product Type'], 18), truncate(r['Collected By Name'], 18)]);
    }
  }

  sectionTitle('Currently Red-Flagged (Needs Vendor Support)');
  tableRow(['RMA ID', 'Customer', 'Product', 'Reason'], { bold: true });
  if (redFlagged.length === 0) {
    text('(none)', { size: 9 });
  } else {
    for (const r of redFlagged) {
      tableRow(
        [r['RMA ID'], truncate(r['Customer Name'], 20), truncate(r['Product Type'], 18), truncate(r['Red Flag Reason'], 25)],
        { color: rgb(0.7, 0, 0) }
      );
    }
  }

  return pdfDoc.save(); // Uint8Array
}

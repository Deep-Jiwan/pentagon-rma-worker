import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_RESERVE = 34;

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const COLORS = {
  ink: hex('#0f172a'),
  sub: hex('#475569'),
  faint: hex('#94a3b8'),
  line: hex('#e2e8f0'),
  panel: hex('#f8fafc'),
  white: rgb(1, 1, 1),
  blue: hex('#2563eb'),
  blueSoft: hex('#dbeafe'),
  green: hex('#059669'),
  greenSoft: hex('#d1fae5'),
  amber: hex('#d97706'),
  amberSoft: hex('#fef3c7'),
  red: hex('#dc2626'),
  redSoft: hex('#fee2e2'),
  purple: hex('#7c3aed')
};

const SERIES_PALETTE = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.purple, COLORS.red, hex('#0891b2'), hex('#db2777'), hex('#65a30d')];

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

// Builds the branded, on-demand daily report PDF from a computeReportMetrics()
// snapshot — a single day's operational snapshot (devices in, devices out,
// current open/red-flag counts), not a historical analysis. Drawn with
// pdf-lib's vector primitives since Workers has no canvas/rasterizer to lean
// on for charts.
export async function buildReportPdf(metrics) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function addPage() {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensureSpace(h) {
    if (y - h < MARGIN + FOOTER_RESERVE) addPage();
  }

  function text(str, x, yy, { size = 10, f = font, color = COLORS.ink } = {}) {
    page.drawText(str || '', { x, y: yy, size, font: f, color });
  }

  function sectionTitle(str) {
    ensureSpace(24);
    text(str, MARGIN, y, { size: 12.5, f: bold, color: COLORS.ink });
    y -= 8;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 1,
      color: COLORS.line
    });
    y -= 14;
  }

  // --- Header (page 1 only) --------------------------------------------
  function drawHeader() {
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 78, width: PAGE_WIDTH, height: 78, color: COLORS.ink });
    text('Pentagon Solutions', MARGIN, PAGE_HEIGHT - 34, { size: 18, f: bold, color: COLORS.white });
    text('Daily RMA Report', MARGIN, PAGE_HEIGHT - 54, { size: 11, f: font, color: hex('#cbd5e1') });
    const genLine = `Generated ${metrics.generatedAtIso.slice(0, 16).replace('T', ' ')} UTC`;
    const genWidth = font.widthOfTextAtSize(genLine, 9);
    text(genLine, PAGE_WIDTH - MARGIN - genWidth, PAGE_HEIGHT - 34, { size: 9, f: font, color: hex('#cbd5e1') });
    const dateWidth = bold.widthOfTextAtSize(metrics.generatedAtLabel, 11);
    text(metrics.generatedAtLabel, PAGE_WIDTH - MARGIN - dateWidth, PAGE_HEIGHT - 54, { size: 11, f: bold, color: COLORS.white });
    y = PAGE_HEIGHT - 78 - 24;
  }
  drawHeader();

  // --- KPI cards ----------------------------------------------------------
  function kpiCards(cards) {
    const gap = 10;
    const w = (CONTENT_WIDTH - gap * (cards.length - 1)) / cards.length;
    const h = 58;
    ensureSpace(h + 18);
    cards.forEach((c, i) => {
      const x = MARGIN + i * (w + gap);
      page.drawRectangle({ x, y: y - h, width: w, height: h, color: c.soft, borderColor: COLORS.line, borderWidth: 1 });
      page.drawRectangle({ x, y: y - 4, width: w, height: 4, color: c.accent });
      const valueStr = String(c.value);
      const valueSize = 20;
      const valueWidth = bold.widthOfTextAtSize(valueStr, valueSize);
      text(valueStr, x + (w - valueWidth) / 2, y - 32, { size: valueSize, f: bold, color: c.accent });
      const labelSize = 7.5;
      const labelWidth = font.widthOfTextAtSize(c.label, labelSize);
      text(c.label, x + (w - labelWidth) / 2, y - h + 10, { size: labelSize, f: font, color: COLORS.sub });
    });
    y -= h + 18;
  }

  const t = metrics.totals;
  kpiCards([
    { label: 'DEVICES IN TODAY', value: t.devicesInToday, accent: COLORS.purple, soft: COLORS.panel },
    { label: 'DEVICES OUT TODAY', value: t.devicesOutToday, accent: COLORS.amber, soft: COLORS.panel },
    { label: 'OPEN TICKETS', value: t.open, accent: COLORS.blue, soft: COLORS.blueSoft },
    { label: 'RED FLAGS', value: t.redFlagged, accent: COLORS.red, soft: t.redFlagged > 0 ? COLORS.redSoft : COLORS.panel }
  ]);

  // --- Horizontal bar chart -------------------------------------------
  function barChart(title, data, { emptyLabel = 'No data' } = {}) {
    sectionTitle(title);
    if (data.length === 0) {
      text(emptyLabel, MARGIN, y, { size: 9.5, color: COLORS.faint });
      y -= 20;
      return;
    }
    const rowH = 20;
    const chartH = data.length * rowH + 6;
    ensureSpace(chartH);
    const labelW = 130;
    const valueW = 60;
    const barAreaW = CONTENT_WIDTH - labelW - valueW;
    const max = Math.max(...data.map(([, v]) => v), 1);

    data.forEach(([label, value], i) => {
      const rowY = y - i * rowH;
      const barW = Math.max(2, (value / max) * barAreaW);
      const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
      text(truncate(label, 22), MARGIN, rowY - 13, { size: 9, color: COLORS.sub });
      page.drawRectangle({ x: MARGIN + labelW, y: rowY - 15, width: barAreaW, height: 11, color: COLORS.panel });
      page.drawRectangle({ x: MARGIN + labelW, y: rowY - 15, width: barW, height: 11, color });
      text(`${value}`, MARGIN + labelW + barAreaW + 8, rowY - 13, { size: 9, f: bold, color: COLORS.ink });
    });
    y -= chartH + 12;
  }

  barChart('Open Ticket Status Breakdown (current)', metrics.statusCounts);

  // --- Table --------------------------------------------------------------
  function table(title, columns, rows, { emptyLabel = '(none)', rowColor } = {}) {
    sectionTitle(title);
    const colW = columns.map((c) => c.width);
    const colX = [MARGIN];
    for (let i = 0; i < colW.length - 1; i++) colX.push(colX[i] + colW[i]);

    function drawColumnHeaders() {
      ensureSpace(20);
      columns.forEach((c, i) => text(c.label, colX[i], y, { size: 8.5, f: bold, color: COLORS.sub }));
      y -= 14;
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 4 }, thickness: 0.75, color: COLORS.line });
    }
    drawColumnHeaders();

    if (rows.length === 0) {
      text(emptyLabel, MARGIN, y - 4, { size: 9, color: COLORS.faint });
      y -= 20;
      return;
    }

    rows.forEach((row, i) => {
      const pageBefore = page;
      ensureSpace(16);
      if (page !== pageBefore) drawColumnHeaders();
      if (i % 2 === 1) {
        page.drawRectangle({ x: MARGIN, y: y - 10, width: CONTENT_WIDTH, height: 14, color: COLORS.panel });
      }
      row.forEach((cell, ci) => {
        text(truncate(cell, columns[ci].chars), colX[ci], y - 6, { size: 8.5, color: rowColor || COLORS.ink });
      });
      y -= 15;
    });
    y -= 6;
  }

  table(
    'Devices In Today',
    [
      { label: 'RMA ID', width: 90, chars: 16 },
      { label: 'Customer', width: 150, chars: 26 },
      { label: 'Product', width: 150, chars: 26 },
      { label: 'Status', width: CONTENT_WIDTH - 390, chars: 18 }
    ],
    metrics.devicesInToday.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Status']])
  );

  table(
    'Devices Out Today (Collected)',
    [
      { label: 'RMA ID', width: 90, chars: 16 },
      { label: 'Customer', width: 150, chars: 26 },
      { label: 'Product', width: 150, chars: 26 },
      { label: 'Collected By', width: CONTENT_WIDTH - 390, chars: 20 }
    ],
    metrics.devicesOutToday.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Collected By Name']])
  );

  table(
    'Currently Red-Flagged (Needs Attention)',
    [
      { label: 'RMA ID', width: 90, chars: 16 },
      { label: 'Customer', width: 120, chars: 22 },
      { label: 'Product', width: 130, chars: 22 },
      { label: 'Reason', width: CONTENT_WIDTH - 340, chars: 40 }
    ],
    metrics.redFlagged.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Red Flag Reason']]),
    { rowColor: COLORS.red }
  );

  // --- Footer on every page -------------------------------------------
  const pages = pdfDoc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 28 }, end: { x: PAGE_WIDTH - MARGIN, y: 28 }, thickness: 0.75, color: COLORS.line });
    p.drawText('Pentagon Solutions - RMA System', { x: MARGIN, y: 16, size: 7.5, font, color: COLORS.faint });
    const pageStr = `Page ${i + 1} of ${pages.length}`;
    const pw = font.widthOfTextAtSize(pageStr, 7.5);
    p.drawText(pageStr, { x: PAGE_WIDTH - MARGIN - pw, y: 16, size: 7.5, font, color: COLORS.faint });
  });

  return pdfDoc.save();
}

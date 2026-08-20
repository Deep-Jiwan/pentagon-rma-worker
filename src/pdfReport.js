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

function fmtDays(n) {
  if (n === null || n === undefined) return '-';
  return n === 1 ? '1 day' : `${n.toFixed(n < 10 ? 1 : 0)} days`;
}

function polarPoint(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function pieSlicePath(cx, cy, r, startAngle, endAngle) {
  const segments = Math.max(2, Math.ceil((endAngle - startAngle) / 6));
  let d = `M ${cx} ${cy} `;
  const step = (endAngle - startAngle) / segments;
  for (let i = 0; i <= segments; i++) {
    const p = polarPoint(cx, cy, r, startAngle + step * i);
    d += `L ${p.x} ${p.y} `;
  }
  return d + 'Z';
}

// Builds the branded, multi-section PDF report from a computeReportMetrics()
// snapshot. Everything is drawn with pdf-lib's vector primitives (rects,
// circles, SVG-path pie slices) since Workers has no canvas/rasterizer to
// lean on for charts.
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
    text('RMA Status Report', MARGIN, PAGE_HEIGHT - 54, { size: 11, f: font, color: hex('#cbd5e1') });
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
    { label: 'OPEN TICKETS', value: t.open, accent: COLORS.blue, soft: COLORS.blueSoft },
    { label: 'CLOSED TICKETS', value: t.closed, accent: COLORS.green, soft: COLORS.greenSoft },
    { label: 'RED FLAGS', value: t.redFlagged, accent: COLORS.red, soft: t.redFlagged > 0 ? COLORS.redSoft : COLORS.panel },
    { label: 'IN TODAY', value: t.devicesInToday, accent: COLORS.purple, soft: COLORS.panel },
    { label: 'CLOSED TODAY', value: t.devicesClosedToday, accent: COLORS.amber, soft: COLORS.panel }
  ]);

  // --- Horizontal bar chart -------------------------------------------
  function barChart(title, data, { emptyLabel = 'No data', unit = '' } = {}) {
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
      text(`${value}${unit}`, MARGIN + labelW + barAreaW + 8, rowY - 13, { size: 9, f: bold, color: COLORS.ink });
    });
    y -= chartH + 12;
  }

  barChart('Open Ticket Status Breakdown', metrics.statusCounts);

  // --- Pie chart ------------------------------------------------------
  function pieChart(title, data) {
    sectionTitle(title);
    if (data.length === 0) {
      text('No data', MARGIN, y, { size: 9.5, color: COLORS.faint });
      y -= 20;
      return;
    }
    const r = 52;
    const chartH = r * 2 + 10;
    ensureSpace(chartH);
    const cx = MARGIN + r + 4;
    const cy = y - r - 4;
    const total = data.reduce((s, [, v]) => s + v, 0) || 1;

    let angle = 0;
    data.forEach(([, value], i) => {
      const sweep = (value / total) * 360;
      const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
      if (sweep > 0) {
        page.drawSvgPath(pieSlicePath(0, 0, r, angle, angle + sweep), { x: cx, y: cy, color, borderColor: COLORS.white, borderWidth: 1.5 });
      }
      angle += sweep;
    });

    const legendX = MARGIN + r * 2 + 30;
    let legendY = y - 6;
    data.forEach(([label, value], i) => {
      const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
      const pct = Math.round((value / total) * 100);
      page.drawRectangle({ x: legendX, y: legendY - 9, width: 9, height: 9, color });
      text(`${truncate(label, 24)} - ${value} (${pct}%)`, legendX + 14, legendY - 8, { size: 9, color: COLORS.sub });
      legendY -= 16;
    });

    y -= chartH + 12;
  }

  pieChart('Top Brands (All Tickets)', metrics.brandCounts);

  // --- Vertical bar chart ------------------------------------------------
  function verticalBarChart(title, data) {
    sectionTitle(title);
    if (data.length === 0) {
      text('No data', MARGIN, y, { size: 9.5, color: COLORS.faint });
      y -= 20;
      return;
    }
    const chartH = 130;
    const topPad = 22;
    const bottomPad = 16;
    const maxBarH = chartH - topPad - bottomPad;
    ensureSpace(chartH);
    const baseY = y - chartH + bottomPad;
    const max = Math.max(...data.map(([, v]) => v), 1);

    const gap = 28;
    const barW = Math.min(70, (CONTENT_WIDTH - gap * (data.length - 1)) / data.length - 10);
    const totalW = data.length * barW + (data.length - 1) * gap;
    const startX = MARGIN + (CONTENT_WIDTH - totalW) / 2;

    page.drawLine({ start: { x: MARGIN, y: baseY }, end: { x: PAGE_WIDTH - MARGIN, y: baseY }, thickness: 0.75, color: COLORS.line });

    data.forEach(([label, value], i) => {
      const x = startX + i * (barW + gap);
      const h = Math.max(2, (value / max) * maxBarH);
      const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
      page.drawRectangle({ x, y: baseY, width: barW, height: h, color });

      const valueStr = String(value);
      const valueWidth = bold.widthOfTextAtSize(valueStr, 10);
      text(valueStr, x + (barW - valueWidth) / 2, baseY + h + 6, { size: 10, f: bold, color: COLORS.ink });

      const labelStr = truncate(label, 14);
      const labelWidth = font.widthOfTextAtSize(labelStr, 8);
      text(labelStr, x + (barW - labelWidth) / 2, baseY - 12, { size: 8, color: COLORS.sub });
    });

    y -= chartH + 12;
  }

  verticalBarChart('Warranty Mix (All Tickets)', metrics.warrantyCounts);

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
    'Red-Flagged Tickets (Needs Attention)',
    [
      { label: 'RMA ID', width: 80, chars: 14 },
      { label: 'Customer', width: 130, chars: 22 },
      { label: 'Product', width: 130, chars: 22 },
      { label: 'Reason', width: CONTENT_WIDTH - 340, chars: 40 }
    ],
    metrics.redFlagged.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Red Flag Reason']]),
    { rowColor: COLORS.red }
  );

  table(
    'Oldest Open Backlog',
    [
      { label: 'RMA ID', width: 80, chars: 14 },
      { label: 'Customer', width: 120, chars: 20 },
      { label: 'Product', width: 110, chars: 18 },
      { label: 'Status', width: 90, chars: 16 },
      { label: 'Days Open', width: CONTENT_WIDTH - 400, chars: 12 }
    ],
    metrics.backlog.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Status'], String(r._daysOpen)])
  );

  // --- Turnaround summary --------------------------------------------------
  sectionTitle('Average Turnaround Time');
  ensureSpace(20);
  const turnaroundLine =
    metrics.avgTurnaroundDays === null
      ? 'Not enough closed tickets with both Date In and Date Out to calculate.'
      : `${fmtDays(metrics.avgTurnaroundDays)} on average, based on the last ${metrics.turnaroundSampleSize} closed ticket${metrics.turnaroundSampleSize === 1 ? '' : 's'}.`;
  text(turnaroundLine, MARGIN, y, { size: 9.5, color: COLORS.sub });
  y -= 20;

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

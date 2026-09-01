import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_RESERVE = 40;

const HEADER_H = 92; // full-bleed masthead, page 1 only
const CONT_HEADER_H = 40; // slim "continued" strip on pages 2+
const SECTION_GAP = 28; // breathing room above a section heading
const HEADING_TO_BODY = 18; // heading rule -> first row of content
const ROW_H = 19; // table row pitch
const BAR_ROW_H = 24; // bar chart row pitch

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

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// One decimal is the difference between "2.4 days" and "2 days" on a
// short repair, and noise once a ticket has been in for a fortnight.
function fmtDays(n) {
  return n.toFixed(n < 10 ? 1 : 0);
}

// A ticket's WhatsApp history in one narrow column. "Stale" is the case
// worth spotting: a message did go out, but the ticket has changed since,
// so what the customer was told is no longer true.
function fmtLastMessage(record) {
  if (record._messageState === 'never') return 'never';
  const days = record._daysSinceMessage;
  const age = days === null ? '?' : days === 0 ? 'today' : `${days}d ago`;
  return record._messageState === 'stale' ? `${age} (old)` : age;
}

function polarPoint(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// pdf-lib has no arc primitive, so a slice is a fan of short chords — one
// segment per ~6° keeps the curve smooth at the radius this report draws at.
function pieSlicePath(cx, cy, r, startAngle, endAngle) {
  const segments = Math.max(2, Math.ceil((endAngle - startAngle) / 6));
  let d = `M ${cx} ${cy} `;
  const step = (endAngle - startAngle) / segments;
  for (let i = 0; i <= segments; i++) {
    const pt = polarPoint(cx, cy, r, startAngle + step * i);
    d += `L ${pt.x} ${pt.y} `;
  }
  return d + 'Z';
}

// Builds the branded, on-demand daily report PDF from a computeReportMetrics()
// snapshot: the day's movement (devices in, devices out, current open/red-flag
// counts), the standing shop mix (top brands, warranty split, average
// turnaround) that the frontend's Report tab also shows, and a closing roster
// of every currently open ticket. Drawn with pdf-lib's vector primitives
// (rects, SVG-path pie slices) since Workers has no canvas/rasterizer to lean
// on for charts.
//
// Layout convention: `y` is the *top edge* of whatever gets drawn next, and
// every draw helper leaves it at the bottom edge of what it drew. Vertical
// rhythm comes from the SECTION_GAP / HEADING_TO_BODY / ROW_H constants above
// rather than ad-hoc nudges, so sections never end up jammed against the
// content before them.
export async function buildReportPdf(metrics) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function text(str, x, yy, { size = 10, f = font, color = COLORS.ink } = {}) {
    page.drawText(str || '', { x, y: yy, size, font: f, color });
  }

  function textRight(str, right, yy, { size = 10, f = font, color = COLORS.ink } = {}) {
    text(str, right - f.widthOfTextAtSize(str || '', size), yy, { size, f, color });
  }

  function rule(yy, { color = COLORS.line, thickness = 1, x1 = MARGIN, x2 = PAGE_WIDTH - MARGIN } = {}) {
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  }

  // Pages 2+ get a slim restatement of what this document is, so a printed
  // page that outlived the stack still identifies itself.
  function addPage() {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    text('Daily RMA Report', MARGIN, y - 9, { size: 9, f: bold, color: COLORS.sub });
    textRight(metrics.generatedAtLabel, PAGE_WIDTH - MARGIN, y - 9, { size: 9, color: COLORS.faint });
    rule(y - 18, { color: COLORS.line });
    y -= CONT_HEADER_H;
  }

  function ensureSpace(h) {
    if (y - h < MARGIN + FOOTER_RESERVE) {
      addPage();
      return true;
    }
    return false;
  }

  // --- Masthead (page 1 only) ------------------------------------------
  function drawMasthead() {
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_H, width: PAGE_WIDTH, height: HEADER_H, color: COLORS.ink });
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - HEADER_H, width: PAGE_WIDTH, height: 3, color: COLORS.blue });

    text('Pentagon Solutions', MARGIN, PAGE_HEIGHT - 44, { size: 19, f: bold, color: COLORS.white });
    text('Daily RMA Report', MARGIN, PAGE_HEIGHT - 64, { size: 10.5, color: hex('#94a3b8') });

    textRight(metrics.generatedAtLabel, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 44, { size: 12, f: bold, color: COLORS.white });
    const genLine = `Generated ${metrics.generatedAtIso.slice(0, 16).replace('T', ' ')} UTC`;
    textRight(genLine, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 64, { size: 8.5, color: hex('#94a3b8') });

    y = PAGE_HEIGHT - HEADER_H - 32;
  }
  drawMasthead();

  // --- Section heading --------------------------------------------------
  // `caption` is the right-hand row count — it turns a bare heading into a
  // summary line, so an empty section reads as "0 devices" rather than as a
  // heading that looks like it failed to render.
  // `bodyH` is how much of the section's content has to travel with the
  // heading. Tables stream row by row, so two rows is enough; a chart or a
  // stat panel is drawn in one atomic pass and has to reserve its full
  // height here, or the heading stays behind while the body jumps a page.
  function sectionTitle(str, caption, { bodyH = ROW_H * 2 } = {}) {
    // Reserve the heading plus that body, so a heading never strands itself
    // at the foot of a page. A fresh page already has its own top spacing,
    // so only pay SECTION_GAP when we stayed put.
    const broke = ensureSpace(SECTION_GAP + HEADING_TO_BODY + bodyH);
    if (!broke) y -= SECTION_GAP;

    text(str, MARGIN, y - 10, { size: 12, f: bold, color: COLORS.ink });
    if (caption) textRight(caption, PAGE_WIDTH - MARGIN, y - 9, { size: 8.5, color: COLORS.faint });
    y -= 18;
    rule(y);
    y -= HEADING_TO_BODY;
  }

  function emptyNote(str) {
    text(str, MARGIN, y - 12, { size: 9, color: COLORS.faint });
    y -= ROW_H + 4;
  }

  // --- KPI cards ----------------------------------------------------------
  function kpiCards(cards) {
    const gap = 12;
    const w = (CONTENT_WIDTH - gap * (cards.length - 1)) / cards.length;
    const h = 74;
    ensureSpace(h);
    cards.forEach((c, i) => {
      const x = MARGIN + i * (w + gap);
      page.drawRectangle({ x, y: y - h, width: w, height: h, color: c.soft, borderColor: COLORS.line, borderWidth: 1 });
      page.drawRectangle({ x, y: y - 4, width: w, height: 4, color: c.accent });

      const valueStr = String(c.value);
      const valueWidth = bold.widthOfTextAtSize(valueStr, 24);
      text(valueStr, x + (w - valueWidth) / 2, y - 44, { size: 24, f: bold, color: c.accent });

      const labelWidth = font.widthOfTextAtSize(c.label, 7.5);
      text(c.label, x + (w - labelWidth) / 2, y - h + 16, { size: 7.5, color: COLORS.sub });
    });
    y -= h;
  }

  const t = metrics.totals;
  kpiCards([
    { label: 'DEVICES IN TODAY', value: t.devicesInToday, accent: COLORS.purple, soft: COLORS.panel },
    { label: 'DEVICES OUT TODAY', value: t.devicesOutToday, accent: COLORS.amber, soft: COLORS.panel },
    { label: 'OPEN TICKETS', value: t.open, accent: COLORS.blue, soft: COLORS.blueSoft },
    { label: 'RED FLAGS', value: t.redFlagged, accent: COLORS.red, soft: t.redFlagged > 0 ? COLORS.redSoft : COLORS.panel }
  ]);

  // --- Horizontal bar chart -------------------------------------------
  function barChart(title, data, { emptyLabel = 'No open tickets to break down.' } = {}) {
    sectionTitle(title, data.length ? plural(data.length, 'status', 'statuses') : undefined);
    if (data.length === 0) {
      emptyNote(emptyLabel);
      return;
    }
    const labelW = 150;
    const valueW = 34;
    const barAreaW = CONTENT_WIDTH - labelW - valueW;
    const max = Math.max(...data.map(([, v]) => v), 1);

    data.forEach(([label, value], i) => {
      const pageBefore = page;
      ensureSpace(BAR_ROW_H);
      if (page !== pageBefore && i > 0) {
        // Rows that spill onto a new page keep their heading context.
        text(`${title} (continued)`, MARGIN, y - 10, { size: 9, f: bold, color: COLORS.faint });
        y -= 22;
      }
      const barW = Math.max(2, (value / max) * barAreaW);
      const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
      text(truncate(label, 26), MARGIN, y - 15, { size: 9, color: COLORS.sub });
      page.drawRectangle({ x: MARGIN + labelW, y: y - 18, width: barAreaW, height: 12, color: COLORS.panel });
      page.drawRectangle({ x: MARGIN + labelW, y: y - 18, width: barW, height: 12, color });
      textRight(String(value), PAGE_WIDTH - MARGIN, y - 15, { size: 9, f: bold, color: COLORS.ink });
      y -= BAR_ROW_H;
    });
    y -= 4;
  }

  barChart('Open Ticket Status Breakdown', metrics.statusCounts);

  // --- Pie chart --------------------------------------------------------
  // The legend carries the labels, so the slices themselves stay unlabelled —
  // at this radius, in-slice text on a 4% wedge is unreadable anyway.
  function pieChart(title, data, { emptyLabel = 'No data to break down.', unit = 'brand' } = {}) {
    const r = 52;
    const legendH = data.length * 16;
    const bodyH = Math.max(r * 2, legendH) + 10;

    sectionTitle(title, data.length ? plural(data.length, unit, `${unit}s`) : undefined, { bodyH });
    if (data.length === 0) {
      emptyNote(emptyLabel);
      return;
    }

    const cx = MARGIN + r + 4;
    const cy = y - r - 5;
    const total = data.reduce((s2, [, v]) => s2 + v, 0) || 1;

    let angle = 0;
    data.forEach(([, value], i) => {
      const sweep = (value / total) * 360;
      if (sweep > 0) {
        page.drawSvgPath(pieSlicePath(0, 0, r, angle, angle + sweep), {
          x: cx,
          y: cy,
          color: SERIES_PALETTE[i % SERIES_PALETTE.length],
          borderColor: COLORS.white,
          borderWidth: 1.5
        });
      }
      angle += sweep;
    });

    // Centre the legend block against the pie rather than top-aligning it,
    // so a two-entry legend doesn't float beside an otherwise empty circle.
    const legendX = MARGIN + r * 2 + 30;
    let legendY = y - 5 - Math.max(0, (bodyH - 10 - legendH) / 2);
    data.forEach(([label, value], i) => {
      const pct = Math.round((value / total) * 100);
      page.drawRectangle({ x: legendX, y: legendY - 9, width: 9, height: 9, color: SERIES_PALETTE[i % SERIES_PALETTE.length] });
      text(`${truncate(label, 24)} — ${value} (${pct}%)`, legendX + 14, legendY - 8, { size: 9, color: COLORS.sub });
      legendY -= 16;
    });

    y -= bodyH;
  }

  pieChart('Top Brands (All Tickets)', metrics.brandCounts, {
    emptyLabel: 'No tickets on record yet.'
  });

  // --- Vertical bar chart -------------------------------------------------
  // Used for the warranty split: few categories, long labels, and the
  // comparison people want is column-height at a glance.
  function verticalBarChart(title, data, { emptyLabel = 'No data to break down.', unit = 'category', unitPlural } = {}) {
    const chartH = 132;
    const topPad = 22;
    const bottomPad = 22;
    const maxBarH = chartH - topPad - bottomPad;

    sectionTitle(title, data.length ? plural(data.length, unit, unitPlural || `${unit}s`) : undefined, { bodyH: chartH });
    if (data.length === 0) {
      emptyNote(emptyLabel);
      return;
    }

    const baseY = y - chartH + bottomPad;
    const max = Math.max(...data.map(([, v]) => v), 1);

    // Each column owns an equal slice of the width; the bar is the middle
    // 60% of its slice, which keeps bars readable whether there are two
    // categories or six.
    const slotW = CONTENT_WIDTH / data.length;
    const barW = Math.max(18, Math.min(70, slotW * 0.6));
    const labelChars = Math.max(6, Math.floor(slotW / 4.5));

    rule(baseY, { color: COLORS.line, thickness: 0.75 });

    data.forEach(([label, value], i) => {
      const slotX = MARGIN + i * slotW;
      const x = slotX + (slotW - barW) / 2;
      const h = Math.max(2, (value / max) * maxBarH);
      page.drawRectangle({ x, y: baseY, width: barW, height: h, color: SERIES_PALETTE[i % SERIES_PALETTE.length] });

      const valueStr = String(value);
      text(valueStr, slotX + (slotW - bold.widthOfTextAtSize(valueStr, 10)) / 2, baseY + h + 6, { size: 10, f: bold, color: COLORS.ink });

      const labelStr = truncate(label, labelChars);
      text(labelStr, slotX + (slotW - font.widthOfTextAtSize(labelStr, 8)) / 2, baseY - 13, { size: 8, color: COLORS.sub });
    });

    y -= chartH;
  }

  verticalBarChart('Warranty Mix (All Tickets)', metrics.warrantyCounts, {
    unit: 'warranty status',
    unitPlural: 'warranty statuses',
    emptyLabel: 'No tickets on record yet.'
  });

  // --- Headline stat ------------------------------------------------------
  // One figure that needs no chart. A panel rather than a fifth KPI card, so
  // the number keeps its unit and its sample caption beside it.
  function statPanel(title, value, unit, caption) {
    const h = 62;
    sectionTitle(title, undefined, { bodyH: h });
    page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_WIDTH, height: h, color: COLORS.panel, borderColor: COLORS.line, borderWidth: 1 });
    page.drawRectangle({ x: MARGIN, y: y - h, width: 3, height: h, color: COLORS.green });

    if (value === null) {
      text(caption, MARGIN + 16, y - 35, { size: 9, color: COLORS.faint });
    } else {
      text(value, MARGIN + 16, y - 32, { size: 22, f: bold, color: COLORS.green });
      text(unit, MARGIN + 16 + bold.widthOfTextAtSize(value, 22) + 6, y - 32, { size: 10, color: COLORS.sub });
      text(caption, MARGIN + 16, y - h + 14, { size: 8, color: COLORS.faint });
    }
    y -= h;
  }

  const avgTurnaround = metrics.avgTurnaroundDays;
  statPanel(
    'Average Turnaround Time',
    avgTurnaround === null ? null : fmtDays(avgTurnaround),
    'days',
    avgTurnaround === null
      ? 'Not enough closed tickets with both a Date In and a Date Out to calculate.'
      : `Across the ${plural(metrics.turnaroundSampleSize, 'most recently closed ticket', 'most recently closed tickets')}.`
  );

  // --- Table --------------------------------------------------------------
  function table(title, columns, rows, { emptyLabel = 'Nothing to report.', caption, rowColor } = {}) {
    sectionTitle(title, caption);
    const colX = [MARGIN];
    for (let i = 0; i < columns.length - 1; i++) colX.push(colX[i] + columns[i].width);

    function drawColumnHeaders() {
      columns.forEach((c, i) => text(c.label.toUpperCase(), colX[i], y - 9, { size: 7.5, f: bold, color: COLORS.faint }));
      y -= 15;
      rule(y, { color: COLORS.line, thickness: 0.75 });
      y -= 5;
    }

    // Column headings over an empty table are just noise — an empty section
    // says its one sentence and gets out of the way.
    if (rows.length === 0) {
      emptyNote(emptyLabel);
      return;
    }
    drawColumnHeaders();

    rows.forEach((row, i) => {
      const pageBefore = page;
      ensureSpace(ROW_H);
      if (page !== pageBefore) {
        text(`${title} (continued)`, MARGIN, y - 10, { size: 9, f: bold, color: COLORS.faint });
        y -= 24;
        drawColumnHeaders();
      }
      if (i % 2 === 1) {
        page.drawRectangle({ x: MARGIN - 6, y: y - ROW_H, width: CONTENT_WIDTH + 12, height: ROW_H, color: COLORS.panel });
      }
      row.forEach((cell, ci) => {
        // The RMA ID leads each row, so it carries the weight — every other
        // cell stays regular so the eye lands on the identifier first. On an
        // alert table, `rowColor` tints only the ID and the trailing reason
        // column: colouring every cell turns the whole block into a red wash
        // that no longer reads as a warning.
        const isEdge = ci === 0 || ci === row.length - 1;
        text(truncate(cell, columns[ci].chars), colX[ci], y - ROW_H + 6.5, {
          size: 8.5,
          f: ci === 0 ? bold : font,
          color: rowColor && isEdge ? rowColor : ci === 0 ? COLORS.ink : COLORS.sub
        });
      });
      y -= ROW_H;
    });
    y -= 4;
  }

  table(
    'Devices In Today',
    [
      { label: 'RMA ID', width: 100, chars: 18 },
      { label: 'Customer', width: 145, chars: 26 },
      { label: 'Product', width: 145, chars: 26 },
      { label: 'Status', width: CONTENT_WIDTH - 390, chars: 20 }
    ],
    metrics.devicesInToday.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Status']]),
    {
      caption: plural(metrics.devicesInToday.length, 'device', 'devices'),
      emptyLabel: 'No devices booked in today.'
    }
  );

  table(
    'Devices Out Today (Collected)',
    [
      { label: 'RMA ID', width: 100, chars: 18 },
      { label: 'Customer', width: 145, chars: 26 },
      { label: 'Product', width: 145, chars: 26 },
      { label: 'Collected by', width: CONTENT_WIDTH - 390, chars: 20 }
    ],
    metrics.devicesOutToday.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Collected By Name']]),
    {
      caption: plural(metrics.devicesOutToday.length, 'device', 'devices'),
      emptyLabel: 'No devices collected today.'
    }
  );

  table(
    'Currently Red-Flagged (Needs Attention)',
    [
      { label: 'RMA ID', width: 100, chars: 18 },
      { label: 'Customer', width: 120, chars: 22 },
      { label: 'Product', width: 125, chars: 22 },
      { label: 'Reason', width: CONTENT_WIDTH - 345, chars: 42 }
    ],
    metrics.redFlagged.map((r) => [r['RMA ID'], r['Customer Name'], r['Product Type'], r['Red Flag Reason']]),
    {
      caption: metrics.redFlagged.length ? plural(metrics.redFlagged.length, 'ticket', 'tickets') : undefined,
      emptyLabel: 'Nothing red-flagged — all open tickets are on track.',
      rowColor: COLORS.red
    }
  );

  // The chase list. Sits with the red flags because it is the same kind of
  // section — work someone has to pick up — rather than a statistic.
  table(
    'Customers Awaiting an Update',
    [
      { label: 'RMA ID', width: 100, chars: 18 },
      { label: 'Customer', width: 130, chars: 23 },
      { label: 'Mobile', width: 100, chars: 17 },
      { label: 'Status', width: 110, chars: 19 },
      { label: 'Last Msg', width: CONTENT_WIDTH - 440, chars: 12 }
    ],
    metrics.awaitingNotification.map((r) => [
      r['RMA ID'],
      r['Customer Name'],
      r['Mobile Number'],
      r['Status'],
      fmtLastMessage(r)
    ]),
    {
      caption: metrics.awaitingNotification.length
        ? plural(metrics.awaitingNotification.length, 'ticket', 'tickets')
        : undefined,
      emptyLabel: 'Every open ticket has been messaged since it last changed.',
      rowColor: COLORS.amber
    }
  );

  // Closes the report with the full picture: every ticket still in the shop,
  // oldest first, so the longest-waiting device is the first line read rather
  // than something buried mid-table.
  table(
    'All Currently Open Tickets',
    [
      { label: 'RMA ID', width: 98, chars: 18 },
      { label: 'Customer', width: 112, chars: 20 },
      { label: 'Product', width: 98, chars: 17 },
      { label: 'Status', width: 100, chars: 17 },
      { label: 'Days Open', width: 52, chars: 7 },
      { label: 'Last Msg', width: CONTENT_WIDTH - 460, chars: 12 }
    ],
    metrics.openTickets.map((r) => [
      r['RMA ID'],
      r['Customer Name'],
      r['Product Type'],
      r['Status'],
      r._daysOpen === null ? '—' : String(r._daysOpen),
      fmtLastMessage(r)
    ]),
    {
      caption: plural(metrics.openTickets.length, 'ticket', 'tickets'),
      emptyLabel: 'No open tickets — the shop is clear.'
    }
  );

  // --- Footer on every page -------------------------------------------
  const pages = pdfDoc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 30 }, end: { x: PAGE_WIDTH - MARGIN, y: 30 }, thickness: 0.75, color: COLORS.line });
    p.drawText('Pentagon Solutions — RMA System', { x: MARGIN, y: 17, size: 7.5, font, color: COLORS.faint });
    const pageStr = `Page ${i + 1} of ${pages.length}`;
    const pw = font.widthOfTextAtSize(pageStr, 7.5);
    p.drawText(pageStr, { x: PAGE_WIDTH - MARGIN - pw, y: 17, size: 7.5, font, color: COLORS.faint });
  });

  return pdfDoc.save();
}

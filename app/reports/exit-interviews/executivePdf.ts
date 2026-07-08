// Executive brief PDF for the exit-interview report.
//
// Follows the house report style used by /reports/turnover, /reports/manager-rollup,
// and the sibling period export: 14pt centered title, 9pt centered meta line,
// bold section labels at x=36, autoTable with [37,99,154] headers, 36pt margins.
//
// Pure builder: takes already-computed aggregates plus the (optional) AI brief
// and saves a PDF. No data fetching, no network calls.
//
// Page 1 is numbers and never depends on the AI call. Page 2 is words: the
// generated narrative when we have one, verbatim employee comments when we
// don't. The document always renders.

const HEADER_FILL: [number, number, number] = [37, 99, 154];
const MARGIN = 36;

export interface ExecutiveBrief {
  narrative: string;
  themes: string[];
  actions: string[];
  sentiment: string;
}

export interface Quote {
  department: string;
  tenure: string;
  text: string;
}

export interface ExecutivePdfInput {
  startDate: string;
  endDate: string;
  locLabel: string;
  stats: {
    total: number;
    completed: number;
    conductRate: number;
    earlyExit: number;
    avgSat: number | null;
  };
  /** Ascending by month, `YYYY-MM`. */
  byMonth: { month: string; count: number }[];
  /** Departures in the equal-length window immediately before startDate. */
  priorPeriodCount: number;
  /** Worst average first. `poorPct` is the share rating 1 or 2. */
  ratingBreakdown: { label: string; avg: number | null; poor: number; poorPct: number; responses: number }[];
  /** Named management as their reason, OR rated it 1-2. */
  managementImplicated: { count: number; of: number; pct: number };
  /**
   * Reason categories, descending by count, with the non-answer buckets
   * (declined / unable to reach) already sorted to the end.
   */
  byReason: { label: string; count: number; nonAnswer: boolean }[];
  byLocation: { loc: string; count: number; avgSat: number | null; avgMgr: number | null }[];
  /** Null when the AI call failed or was unavailable — page 2 falls back. */
  brief: ExecutiveBrief | null;
  /** Used only when `brief` is null. */
  quotes: Quote[];
}

function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] || "?";
}

/** "up 22% vs prior period" / "flat" / null when there's no baseline. */
function trendPhrase(current: number, prior: number): string | null {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return "flat vs prior period";
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs prior period`;
}

export async function buildExecutivePdf(input: ExecutivePdfInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  const autoTable = (autoTableModule.default || autoTableModule) as typeof import("jspdf-autotable").default;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const now = new Date();

  const lastY = () =>
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;

  // ---------------------------------------------------------------- page 1

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Exit Interviews — Executive Summary", pageWidth / 2, 40, { align: "center" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  // En dash, not "→": jsPDF's default WinAnsi encoding has no U+2192 and
  // renders it as garbage. (The other report exports still have this bug.)
  doc.text(
    `${input.startDate} – ${input.endDate}   ·   ${input.locLabel}   ·   Generated ${now.toLocaleString()}`,
    pageWidth / 2,
    58,
    { align: "center" },
  );

  let y = 84;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Headline", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 16;

  const trend = trendPhrase(input.stats.total, input.priorPeriodCount);
  const earlyPct = input.stats.total > 0 ? Math.round((input.stats.earlyExit / input.stats.total) * 100) : 0;
  const mi = input.managementImplicated;
  const headline = [
    `Departures: ${input.stats.total}${trend ? `   (${trend})` : ""}`,
    `Left within 90 days: ${input.stats.earlyExit} (${earlyPct}%)`,
    `Average satisfaction: ${input.stats.avgSat != null ? `${input.stats.avgSat.toFixed(1)} / 5` : "—"}`,
    `Interviews completed: ${input.stats.completed} of ${input.stats.total} (${input.stats.conductRate.toFixed(0)}% conduct rate)`,
  ];
  for (const line of headline) {
    doc.text(line, MARGIN, y);
    y += 14;
  }

  // The headline finding, stated in bold and in plain words. Someone can leave
  // for a better offer and still rate management 1/5 — the reason chart alone
  // does not surface that, so it gets said here.
  if (mi.of > 0 && mi.pct >= 50) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `Management implicated in ${mi.count} of ${mi.of} interviews (${Math.round(mi.pct)}%) — rated poor, or named as the reason.`,
      MARGIN,
      y,
    );
    doc.setFont("helvetica", "normal");
    y += 14;
  }

  // How they rated us — the structured signal, worst first.
  y += 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("How they rated us", MARGIN, y);

  autoTable(doc, {
    startY: y + 8,
    head: [["", "Average (1-5)", "Rated poor (1-2)", "Responses"]],
    body: input.ratingBreakdown.map((d) => [
      d.label,
      d.avg != null ? d.avg.toFixed(1) : "—",
      `${d.poor}  (${Math.round(d.poorPct)}%)`,
      String(d.responses),
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: HEADER_FILL, textColor: 255, fontStyle: "bold", halign: "left" },
    columnStyles: {
      1: { halign: "right", cellWidth: 90 },
      2: { halign: "right", cellWidth: 110 },
      3: { halign: "right", cellWidth: 70 },
    },
    margin: { left: MARGIN, right: MARGIN },
    // Anything a majority called poor is the story on this page. Make it red.
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const dim = input.ratingBreakdown[data.row.index];
      if (dim && dim.poorPct >= 50) {
        data.cell.styles.textColor = [176, 32, 32];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  y = lastY() + 24;

  // Departures by month — small bar chart, house blue. No chart library.
  y += 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Departures by month", MARGIN, y);
  y += 14;

  const chartHeight = 54;
  const chartBase = y + chartHeight;
  const chartWidth = pageWidth - MARGIN * 2;
  const maxCount = Math.max(1, ...input.byMonth.map((m) => m.count));
  const slotWidth = input.byMonth.length > 0 ? chartWidth / input.byMonth.length : chartWidth;
  const barWidth = Math.min(26, slotWidth * 0.5);

  input.byMonth.forEach((m, i) => {
    const barHeight = Math.max(1, (m.count / maxCount) * chartHeight);
    const x = MARGIN + i * slotWidth + (slotWidth - barWidth) / 2;
    doc.setFillColor(HEADER_FILL[0], HEADER_FILL[1], HEADER_FILL[2]);
    doc.rect(x, chartBase - barHeight, barWidth, barHeight, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(90);
    doc.text(monthLabel(m.month), x + barWidth / 2, chartBase + 10, { align: "center" });
    doc.text(String(m.count), x + barWidth / 2, chartBase - barHeight - 3, { align: "center" });
    doc.setTextColor(0);
  });

  y = chartBase + 30;

  // Primary reason given. Deliberately NOT titled "why people leave" — it is
  // single-select, so it undercounts any cause that wasn't someone's top answer.
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Primary reason given for leaving", MARGIN, y);
  y += 12;
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(110);
  doc.text(
    "One reason per person. Someone can leave for a better offer and still rate management poorly — compare with the ratings above.",
    MARGIN,
    y,
  );
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");

  const firstNonAnswer = input.byReason.findIndex((r) => r.nonAnswer);
  autoTable(doc, {
    startY: y + 8,
    head: [["Category", "Departures", "Share"]],
    body: input.byReason.map((r) => [
      r.label,
      String(r.count),
      input.stats.total > 0 ? `${Math.round((r.count / input.stats.total) * 100)}%` : "—",
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: HEADER_FILL, textColor: 255, fontStyle: "bold", halign: "left" },
    columnStyles: { 1: { halign: "right", cellWidth: 70 }, 2: { halign: "right", cellWidth: 60 } },
    margin: { left: MARGIN, right: MARGIN },
    // The non-answer rows describe our coverage, not why anyone left. Mute them
    // and rule them off so they never read as a reason.
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const row = input.byReason[data.row.index];
      if (!row?.nonAnswer) return;
      data.cell.styles.textColor = [130, 130, 130];
      data.cell.styles.fontStyle = "italic";
      if (data.row.index === firstNonAnswer) {
        data.cell.styles.lineWidth = { top: 0.75, right: 0, bottom: 0, left: 0 };
        data.cell.styles.lineColor = [180, 180, 180];
      }
    },
  });

  // Where
  y = lastY() + 24;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Where", MARGIN, y);

  autoTable(doc, {
    startY: y + 8,
    head: [["Location", "Departures", "Share", "Avg satisfaction", "Avg mgmt"]],
    body: input.byLocation.map((l) => [
      l.loc,
      String(l.count),
      input.stats.total > 0 ? `${Math.round((l.count / input.stats.total) * 100)}%` : "—",
      l.avgSat?.toFixed(1) ?? "—",
      l.avgMgr?.toFixed(1) ?? "—",
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: HEADER_FILL, textColor: 255, fontStyle: "bold", halign: "left" },
    columnStyles: {
      1: { halign: "right", cellWidth: 70 },
      2: { halign: "right", cellWidth: 55 },
      3: { halign: "right", cellWidth: 95 },
      4: { halign: "right", cellWidth: 65 },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  // ---------------------------------------------------------------- page 2

  doc.addPage();
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("What They Told Us", pageWidth / 2, 40, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Based on ${input.stats.completed} completed interviews`,
    pageWidth / 2,
    58,
    { align: "center" },
  );

  y = 88;
  const contentWidth = pageWidth - MARGIN * 2;

  const sectionLabel = (text: string) => {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(text, MARGIN, y);
    y += 16;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
  };

  if (input.brief) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    for (const para of input.brief.narrative.split(/\n{2,}/).filter(Boolean)) {
      const wrapped = doc.splitTextToSize(para.trim(), contentWidth) as string[];
      doc.text(wrapped, MARGIN, y);
      y += wrapped.length * 12 + 10;
    }

    y += 6;
    if (input.brief.themes.length > 0) {
      sectionLabel("Key themes");
      for (const theme of input.brief.themes) {
        const wrapped = doc.splitTextToSize(theme, contentWidth - 14) as string[];
        doc.text("•", MARGIN, y);
        doc.text(wrapped, MARGIN + 12, y);
        y += wrapped.length * 12 + 4;
      }
      y += 12;
    }

    if (input.brief.actions.length > 0) {
      sectionLabel("Recommended actions");
      input.brief.actions.forEach((action, i) => {
        const wrapped = doc.splitTextToSize(action, contentWidth - 18) as string[];
        doc.text(`${i + 1}.`, MARGIN, y);
        doc.text(wrapped, MARGIN + 16, y);
        y += wrapped.length * 12 + 4;
      });
    }
  } else {
    // AI unavailable. Say so plainly, then let the employees speak for themselves.
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(130);
    doc.text("AI summary unavailable; showing raw comments.", MARGIN, y);
    doc.setTextColor(0);
    y += 22;

    if (input.quotes.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(130);
      doc.text("No written feedback was submitted in this period.", MARGIN, y);
      doc.setTextColor(0);
    }

    for (const q of input.quotes) {
      if (y > pageHeight - 80) break;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(`"${q.text.trim()}"`, contentWidth - 12) as string[];
      doc.text(wrapped, MARGIN + 10, y);
      y += wrapped.length * 12 + 2;

      doc.setFontSize(8);
      doc.setTextColor(130);
      doc.text(`— ${q.department}, ${q.tenure} tenure`, MARGIN + 10, y);
      doc.setTextColor(0);
      y += 18;
    }
  }

  // ---------------------------------------------------------------- footer

  const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } })
    .internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 24, { align: "right" });
  }

  doc.save(`exit_interviews_executive_${input.startDate}_to_${input.endDate}.pdf`);
}

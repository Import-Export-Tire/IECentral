// Executive brief PDF for the exit-interview report.
//
// Pure builder: takes already-computed aggregates plus the (optional) AI brief
// and returns a saved PDF. No data fetching, no network calls — so it can be
// reasoned about independently of Convex.
//
// Page 1 is numbers and never depends on the AI call. Page 2 is words: the
// generated narrative when we have one, verbatim employee comments when we
// don't. The document always renders.

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
    earlyExit: number;
    avgSat: number | null;
  };
  /** Ascending by month, `YYYY-MM`. */
  byMonth: { month: string; count: number }[];
  /** Departures in the equal-length window immediately before startDate. */
  priorPeriodCount: number;
  /** Descending by count. Already label-resolved. */
  byReason: { label: string; count: number }[];
  /** Descending by count. */
  byLocation: { loc: string; count: number }[];
  /** Null when the AI call failed or was unavailable — page 2 falls back. */
  brief: ExecutiveBrief | null;
  /** Used only when `brief` is null. */
  quotes: Quote[];
}

const INK = { r: 17, g: 24, b: 39 };
const MUTED = { r: 107, g: 114, b: 128 };
const ACCENT = { r: 37, g: 99, b: 154 };
const RULE = { r: 226, g: 232, b: 240 };

const MARGIN = 48;

function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] || "?";
}

function prettyDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "up 22%" / "down 8%" / "flat" / null when there's no prior baseline. */
function trendPhrase(current: number, prior: number): string | null {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return "flat vs the prior period";
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs the prior period`;
}

export async function buildExecutivePdf(input: ExecutivePdfInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;

  const rule = (y: number) => {
    doc.setDrawColor(RULE.r, RULE.g, RULE.b);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
  };

  const heading = (text: string, y: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(text.toUpperCase(), MARGIN, y);
    doc.setTextColor(INK.r, INK.g, INK.b);
  };

  // ---------------------------------------------------------------- page 1

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("Exit Interviews", MARGIN, 64);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(
    `${prettyDate(input.startDate)} – ${prettyDate(input.endDate)}  ·  ${input.locLabel}`,
    MARGIN,
    82,
  );
  rule(96);

  // Stat tiles
  const tiles: { value: string; label: string }[] = [
    { value: String(input.stats.total), label: "departures" },
    {
      value: input.stats.total > 0
        ? `${Math.round((input.stats.earlyExit / input.stats.total) * 100)}%`
        : "—",
      label: "left within 90 days",
    },
    {
      value: input.stats.avgSat != null ? `${input.stats.avgSat.toFixed(1)}/5` : "—",
      label: "avg satisfaction",
    },
  ];

  const tileWidth = contentWidth / tiles.length;
  tiles.forEach((tile, i) => {
    const x = MARGIN + i * tileWidth;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(tile.value, x, 140);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(tile.label, x, 156);
  });

  let y = 196;

  // Departures by month — plain rectangles, no chart library.
  heading("Departures by month", y);
  y += 16;

  const trend = trendPhrase(input.stats.total, input.priorPeriodCount);
  if (trend) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(trend, pageWidth - MARGIN, y - 16, { align: "right" });
    doc.setTextColor(INK.r, INK.g, INK.b);
  }

  const chartHeight = 64;
  const chartBase = y + chartHeight;
  const maxCount = Math.max(1, ...input.byMonth.map((m) => m.count));
  const slotWidth = input.byMonth.length > 0 ? contentWidth / input.byMonth.length : contentWidth;
  const barWidth = Math.min(28, slotWidth * 0.55);

  doc.setFillColor(ACCENT.r, ACCENT.g, ACCENT.b);
  input.byMonth.forEach((m, i) => {
    const barHeight = Math.max(1, (m.count / maxCount) * chartHeight);
    const x = MARGIN + i * slotWidth + (slotWidth - barWidth) / 2;
    doc.rect(x, chartBase - barHeight, barWidth, barHeight, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(monthLabel(m.month), x + barWidth / 2, chartBase + 11, { align: "center" });
    doc.setFontSize(7);
    doc.text(String(m.count), x + barWidth / 2, chartBase - barHeight - 4, { align: "center" });
    doc.setFillColor(ACCENT.r, ACCENT.g, ACCENT.b);
  });
  doc.setTextColor(INK.r, INK.g, INK.b);

  y = chartBase + 40;

  // Why people leave — horizontal bars
  heading("Why people leave", y);
  y += 18;

  const topReasons = input.byReason.slice(0, 6);
  const reasonMax = Math.max(1, ...topReasons.map((r) => r.count));
  const labelWidth = 150;
  const barTrack = contentWidth - labelWidth - 30;

  for (const reason of topReasons) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INK.r, INK.g, INK.b);
    const label = doc.splitTextToSize(reason.label, labelWidth - 8)[0] as string;
    doc.text(label, MARGIN, y + 8);

    const w = Math.max(2, (reason.count / reasonMax) * barTrack);
    doc.setFillColor(ACCENT.r, ACCENT.g, ACCENT.b);
    doc.rect(MARGIN + labelWidth, y, w, 10, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(String(reason.count), MARGIN + labelWidth + w + 6, y + 8.5);
    y += 18;
  }

  if (topReasons.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text("No reason recorded for any departure in this period.", MARGIN, y + 8);
    doc.setTextColor(INK.r, INK.g, INK.b);
    y += 18;
  }

  y += 22;

  // Where
  heading("Where", y);
  y += 18;
  doc.setFontSize(9);
  for (const loc of input.byLocation.slice(0, 5)) {
    const share = input.stats.total > 0 ? Math.round((loc.count / input.stats.total) * 100) : 0;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(loc.loc, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(loc.count), MARGIN + 180, y);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(`${share}% of departures`, MARGIN + 220, y);
    doc.setTextColor(INK.r, INK.g, INK.b);
    y += 16;
  }

  // ---------------------------------------------------------------- page 2

  doc.addPage();
  y = 64;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("What they told us", MARGIN, y);
  y += 18;
  rule(y);
  y += 28;

  if (input.brief) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(INK.r, INK.g, INK.b);
    for (const para of input.brief.narrative.split(/\n{2,}/).filter(Boolean)) {
      const wrapped = doc.splitTextToSize(para.trim(), contentWidth) as string[];
      doc.text(wrapped, MARGIN, y);
      y += wrapped.length * 14 + 10;
    }

    y += 8;
    if (input.brief.themes.length > 0) {
      heading("Key themes", y);
      y += 18;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      for (const theme of input.brief.themes) {
        const wrapped = doc.splitTextToSize(theme, contentWidth - 16) as string[];
        doc.text("•", MARGIN, y);
        doc.text(wrapped, MARGIN + 14, y);
        y += wrapped.length * 13 + 5;
      }
      y += 14;
    }

    if (input.brief.actions.length > 0) {
      heading("Recommended actions", y);
      y += 18;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      input.brief.actions.forEach((action, i) => {
        const wrapped = doc.splitTextToSize(action, contentWidth - 20) as string[];
        doc.text(`${i + 1}.`, MARGIN, y);
        doc.text(wrapped, MARGIN + 18, y);
        y += wrapped.length * 13 + 5;
      });
    }
  } else {
    // AI unavailable. Say so plainly, then let the employees speak for themselves.
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text("AI summary unavailable; showing raw comments.", MARGIN, y);
    doc.setTextColor(INK.r, INK.g, INK.b);
    y += 26;

    if (input.quotes.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      doc.text("No written feedback was submitted in this period.", MARGIN, y);
      doc.setTextColor(INK.r, INK.g, INK.b);
    }

    for (const q of input.quotes) {
      if (y > pageHeight - 90) break;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(INK.r, INK.g, INK.b);
      const wrapped = doc.splitTextToSize(`"${q.text.trim()}"`, contentWidth - 12) as string[];
      doc.text(wrapped, MARGIN + 12, y);
      y += wrapped.length * 13 + 3;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      doc.text(`— ${q.department}, ${q.tenure} tenure`, MARGIN + 12, y);
      doc.setTextColor(INK.r, INK.g, INK.b);
      y += 22;
    }
  }

  // ---------------------------------------------------------------- footer

  const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } })
    .internal.getNumberOfPages();
  const generatedAt = new Date().toLocaleString();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(
      `Based on ${input.stats.completed} completed of ${input.stats.total} departures  ·  Generated ${generatedAt}`,
      MARGIN,
      pageHeight - 28,
    );
    doc.text(`${i} / ${totalPages}`, pageWidth - MARGIN, pageHeight - 28, { align: "right" });
  }

  doc.save(`exit_interviews_executive_${input.startDate}_to_${input.endDate}.pdf`);
}

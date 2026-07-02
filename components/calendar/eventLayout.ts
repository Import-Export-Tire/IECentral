// GCal-style overlap column-packing for TIMED events within a single day.
// Pure module — no React.

export interface PositionedEvent<T> {
  event: T;
  topPct: number; // 0..100, top offset within the day column
  heightPct: number; // 0..100, clamped so top+height <= 100 and height >= a small min
  colIndex: number; // 0-based column within its overlap cluster
  colCount: number; // total columns in its overlap cluster
}

// Minimum visible height so very short events stay clickable.
// ~24 min out of a 1440-min day.
const MIN_HEIGHT_PCT = (24 / 1440) * 100;

interface Internal<T> {
  event: T;
  start: number; // clipped ms
  end: number; // clipped ms
  colIndex: number;
  colCount: number;
}

/**
 * Lay out timed events for one day.
 *
 * dayStart/dayEnd are ms timestamps for local midnight..midnight+24h of the day.
 * Each event's [startTime,endTime] is clipped to [dayStart,dayEnd] before
 * computing top/height, so multi-day events fill from the top or down to the
 * bottom correctly.
 *
 * Algorithm: sort by start asc then end desc; greedily assign each event to the
 * first free column; a cluster is a maximal run of events that mutually overlap
 * in time; every event in a cluster is given the same colCount (= max concurrent
 * columns in that cluster) so widths align GCal-style.
 */
export function layoutDayEvents<T extends { startTime: number; endTime: number }>(
  events: T[],
  dayStart: number,
  dayEnd: number
): PositionedEvent<T>[] {
  const dayMs = dayEnd - dayStart;
  if (dayMs <= 0) return [];

  // Clip to the day and keep only events with positive intersection.
  const clipped: Internal<T>[] = [];
  for (const event of events) {
    const start = Math.max(event.startTime, dayStart);
    const end = Math.min(event.endTime, dayEnd);
    if (end <= start) continue;
    clipped.push({ event, start, end, colIndex: 0, colCount: 1 });
  }

  // Sort by start ascending, then by end descending (longer first on ties).
  clipped.sort((a, b) => a.start - b.start || b.end - a.end);

  // Greedy column assignment + cluster detection.
  let clusterStart = 0; // index into clipped for the current cluster
  let clusterEnd = 0; // max end time seen in the current cluster
  let columns: number[] = []; // per-column: end time of the last event placed there

  const finalizeCluster = (from: number, to: number, colCount: number) => {
    for (let i = from; i < to; i++) clipped[i].colCount = colCount;
  };

  for (let i = 0; i < clipped.length; i++) {
    const ev = clipped[i];

    // If this event starts at/after the max end of the current cluster, the
    // cluster is complete — flush it before starting a new one.
    if (i > 0 && ev.start >= clusterEnd) {
      finalizeCluster(clusterStart, i, columns.length);
      clusterStart = i;
      columns = [];
      clusterEnd = ev.end;
    }

    // Find the first column whose last event has ended by ev.start.
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      if (columns[c] <= ev.start) {
        columns[c] = ev.end;
        ev.colIndex = c;
        placed = true;
        break;
      }
    }
    if (!placed) {
      ev.colIndex = columns.length;
      columns.push(ev.end);
    }

    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  // Flush the final cluster.
  finalizeCluster(clusterStart, clipped.length, columns.length);

  return clipped.map((c) => {
    const topPct = ((c.start - dayStart) / dayMs) * 100;
    let heightPct = ((c.end - c.start) / dayMs) * 100;
    if (heightPct < MIN_HEIGHT_PCT) heightPct = MIN_HEIGHT_PCT;
    if (topPct + heightPct > 100) heightPct = Math.max(0, 100 - topPct);
    return {
      event: c.event,
      topPct,
      heightPct,
      colIndex: c.colIndex,
      colCount: c.colCount,
    };
  });
}

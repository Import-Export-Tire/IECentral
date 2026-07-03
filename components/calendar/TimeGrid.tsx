"use client";

import { useEffect, useRef, useState } from "react";
import { layoutDayEvents } from "./eventLayout";

const HOUR_HEIGHT = 48; // px per hour row
const GRID_HEIGHT = HOUR_HEIGHT * 24; // 1152px total
const NOW_COLOR = "#ea4335"; // GCal red

interface TimeGridProps {
  days: Date[]; // 1 for day view, 7 for week view (local midnights)
  getEventsForDay: (d: Date) => any[];
  eventChipClass: (e: any) => string;
  onEventClick: (e: any) => void;
  // Drag (or click) an empty region to create an event with a prefilled range.
  // startMinutes/endMinutes are minutes-from-midnight, snapped to 15.
  onSlotCreate: (dayDate: Date, startMinutes: number, endMinutes: number) => void;
  isToday: (d: Date) => boolean;
  now: Date; // from useNowMinute
}

// Convert a Y pixel offset within the 1152px grid to minutes-from-midnight.
function yToMinutes(y: number): number {
  return (y / GRID_HEIGHT) * 1440;
}

// Snap minutes to the nearest 15-minute increment.
function snap15(m: number): number {
  return Math.round(m / 15) * 15;
}

function clampMin(m: number): number {
  return Math.max(0, Math.min(1440, m));
}

interface DragState {
  dayIndex: number;
  startMin: number;
  endMin: number;
}

function hourLabel(hour: number): string {
  // Match formatTime AM/PM style: "12 AM", "1 AM" … "11 PM".
  const period = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${period}`;
}

function dayStartMs(d: Date): number {
  return new Date(d).setHours(0, 0, 0, 0);
}

export default function TimeGrid({
  days,
  getEventsForDay,
  eventChipClass,
  onEventClick,
  onSlotCreate,
  isToday,
  now,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // One ref per day column so we can compute an accurate Y within the grid.
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = useState<DragState | null>(null);

  // On mount, scroll so ~7 AM is near the top (GCal behavior).
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
    }
  }, []);

  // Cancel an in-progress selection on Escape.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  const minutesFromPointer = (e: React.PointerEvent, dayIndex: number): number => {
    const col = columnRefs.current[dayIndex];
    if (!col) return 0;
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    return clampMin(snap15(yToMinutes(y)));
  };

  const handlePointerDown = (e: React.PointerEvent, dayIndex: number) => {
    // Only respond to primary button / touch / pen.
    if (e.button !== 0) return;
    const m = minutesFromPointer(e, dayIndex);
    setDrag({ dayIndex, startMin: m, endMin: m });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw if the pointer is already released */
    }
  };

  const handlePointerMove = (e: React.PointerEvent, dayIndex: number) => {
    if (!drag || drag.dayIndex !== dayIndex) return;
    const m = minutesFromPointer(e, dayIndex);
    setDrag((prev) => (prev ? { ...prev, endMin: m } : prev));
  };

  const handlePointerUp = (e: React.PointerEvent, dayIndex: number) => {
    if (!drag || drag.dayIndex !== dayIndex) return;
    let a = Math.min(drag.startMin, drag.endMin);
    let b = Math.max(drag.startMin, drag.endMin);
    // A no-drag click (or a sub-slot smudge) → default 60-minute block.
    if (b - a < 15) {
      b = Math.min(1440, a + 60);
      // If clamping at the bottom of the day left no room, shift start up.
      if (b - a < 60) a = Math.max(0, b - 60);
    }
    onSlotCreate(days[dayIndex], a, b);
    setDrag(null);
  };

  const cancelDrag = () => setDrag(null);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTopPct = (nowMinutes / 1440) * 100;

  // Split each day's events into all-day vs timed.
  const perDay = days.map((day) => {
    const ds = dayStartMs(day);
    const de = ds + 24 * 60 * 60 * 1000;
    const events = getEventsForDay(day);
    const allDay: any[] = [];
    const timed: any[] = [];
    for (const e of events) {
      const coversWholeDay = e.startTime <= ds && e.endTime >= de;
      if (e.isAllDay === true || coversWholeDay) allDay.push(e);
      else timed.push(e);
    }
    return { day, ds, de, allDay, positioned: layoutDayEvents(timed, ds, de) };
  });

  const gridColsStyle = { gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="overflow-x-auto">
      <div className={days.length > 1 ? "min-w-[720px]" : "min-w-[280px]"}>
        {/* Sticky day-header row */}
        <div
          className="grid sticky top-0 z-20 theme-bg-primary border-b theme-border-secondary"
          style={gridColsStyle}
        >
          <div className="border-r theme-border-secondary" />
          {days.map((day, i) => {
            const today = isToday(day);
            return (
              <div
                key={i}
                className="py-2 px-1 text-center border-r theme-border-secondary"
              >
                <div className="text-[11px] font-medium uppercase tracking-wide theme-text-tertiary">
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                <div
                  className={`mt-0.5 mx-auto text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${
                    today ? "bg-[#007AFF] text-white" : "theme-text-primary"
                  }`}
                >
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day row */}
        <div
          className="grid border-b theme-border-secondary"
          style={gridColsStyle}
        >
          <div className="py-1 pr-2 text-right border-r theme-border-secondary text-[10px] uppercase tracking-wide theme-text-tertiary flex items-center justify-end">
            All-day
          </div>
          {perDay.map(({ day, allDay }, i) => (
            <div key={i} className="p-1 border-r theme-border-secondary space-y-0.5 min-h-[28px]">
              {allDay.map((event) => (
                <div
                  key={event._id}
                  onClick={() => onEventClick(event)}
                  className={`text-[11px] px-1.5 py-0.5 rounded-md ring-1 ring-black/5 truncate cursor-pointer font-medium ${eventChipClass(event)}`}
                  title={event.title}
                >
                  {event.title}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Scrollable time grid */}
        <div
          ref={scrollRef}
          className="overflow-y-auto"
          style={{ maxHeight: "min(70vh, 720px)" }}
        >
          <div className="grid" style={{ ...gridColsStyle, height: GRID_HEIGHT }}>
            {/* Hour-label gutter */}
            <div className="relative border-r theme-border-secondary">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="absolute right-1 -translate-y-1/2 text-[10px] theme-text-tertiary"
                  style={{ top: h * HOUR_HEIGHT }}
                >
                  {h === 0 ? "" : hourLabel(h)}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {perDay.map(({ day, positioned }, i) => {
              const today = isToday(day);
              const dragActive = drag?.dayIndex === i;
              const dragTopMin = dragActive ? Math.min(drag!.startMin, drag!.endMin) : 0;
              const dragBotMin = dragActive ? Math.max(drag!.startMin, drag!.endMin) : 0;
              return (
                <div key={i} className="relative border-r theme-border-secondary">
                  {/* Hour gridlines (visual only) */}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t theme-border-secondary pointer-events-none"
                      style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Drag-select overlay: full-height, sits below event blocks
                      (z-0) so clicking an existing event still hits the event
                      (event blocks are z-10). Handles both click + drag. */}
                  <div
                    ref={(el) => {
                      columnRefs.current[i] = el;
                    }}
                    className="absolute inset-0 z-0 cursor-pointer touch-none"
                    onPointerDown={(e) => handlePointerDown(e, i)}
                    onPointerMove={(e) => handlePointerMove(e, i)}
                    onPointerUp={(e) => handlePointerUp(e, i)}
                    onPointerLeave={cancelDrag}
                    onPointerCancel={cancelDrag}
                  >
                    {dragActive && dragBotMin > dragTopMin && (
                      <div
                        className="absolute left-0.5 right-0.5 rounded-md bg-[#007AFF]/20 border border-[#007AFF]/40 pointer-events-none"
                        style={{
                          top: (dragTopMin / 1440) * GRID_HEIGHT,
                          height: ((dragBotMin - dragTopMin) / 1440) * GRID_HEIGHT,
                        }}
                      />
                    )}
                  </div>

                  {/* Positioned timed events */}
                  {positioned.map((p, idx) => {
                    const widthPct = 100 / p.colCount;
                    const leftPct = widthPct * p.colIndex;
                    const event = p.event;
                    // Block height in px (height stays duration-accurate). Short
                    // blocks can't fit the two-line time/title stack without
                    // clipping the title, so collapse them to a single line —
                    // same approach Google Calendar uses for brief events.
                    const pxHeight = (p.heightPct / 100) * GRID_HEIGHT;
                    const compact = pxHeight < 34;
                    const timeLabel = new Date(event.startTime).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    });
                    return (
                      <div
                        key={event._id ?? idx}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className={`absolute z-10 rounded-md px-1.5 py-0.5 overflow-hidden cursor-pointer text-[11px] leading-tight font-medium ring-1 ring-black/5 shadow-sm ${eventChipClass(event)}`}
                        style={{
                          // top/height stay duration-accurate; horizontal +2px
                          // left inset and -6px width give a GCal inter-column
                          // gap + right margin; ~1px vertical margin gives a
                          // hairline gap between consecutive events.
                          top: `${p.topPct}%`,
                          height: `${p.heightPct}%`,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 6px)`,
                          marginTop: "1px",
                          marginBottom: "1px",
                        }}
                        title={`${timeLabel} ${event.title}`}
                      >
                        {compact ? (
                          <div className="truncate">
                            <span className="opacity-70">{timeLabel}</span> {event.title}
                          </div>
                        ) : (
                          <>
                            <div className="truncate opacity-70 text-[10px]">{timeLabel}</div>
                            <div className="truncate font-semibold">{event.title}</div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Now line */}
                  {today && (
                    <div
                      className="absolute left-0 right-0 z-10 pointer-events-none"
                      style={{ top: `${nowTopPct}%` }}
                    >
                      <div
                        className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: NOW_COLOR }}
                      />
                      <div className="h-px" style={{ backgroundColor: NOW_COLOR }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

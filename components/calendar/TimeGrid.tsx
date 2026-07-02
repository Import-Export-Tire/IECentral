"use client";

import { useEffect, useRef } from "react";
import { layoutDayEvents } from "./eventLayout";

const HOUR_HEIGHT = 48; // px per hour row
const GRID_HEIGHT = HOUR_HEIGHT * 24; // 1152px total
const NOW_COLOR = "#ea4335"; // GCal red

interface TimeGridProps {
  days: Date[]; // 1 for day view, 7 for week view (local midnights)
  getEventsForDay: (d: Date) => any[];
  eventChipClass: (e: any) => string;
  onEventClick: (e: any) => void;
  onSlotClick: (dayDate: Date, hour: number) => void; // click empty slot to create
  isToday: (d: Date) => boolean;
  now: Date; // from useNowMinute
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
  onSlotClick,
  isToday,
  now,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // On mount, scroll so ~7 AM is near the top (GCal behavior).
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
    }
  }, []);

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
                  className={`text-[11px] px-1.5 py-0.5 rounded truncate cursor-pointer font-medium ${eventChipClass(event)}`}
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
              return (
                <div key={i} className="relative border-r theme-border-secondary">
                  {/* Hour gridlines + clickable slot layers */}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      onClick={() => onSlotClick(day, h)}
                      className="absolute left-0 right-0 border-t theme-border-secondary cursor-pointer"
                      style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Positioned timed events */}
                  {positioned.map((p, idx) => {
                    const gutter = 2; // px between columns
                    const widthPct = 100 / p.colCount;
                    const leftPct = widthPct * p.colIndex;
                    const event = p.event;
                    return (
                      <div
                        key={event._id ?? idx}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className={`absolute rounded px-1 py-0.5 overflow-hidden cursor-pointer text-[11px] leading-tight font-medium ${eventChipClass(event)}`}
                        style={{
                          top: `${p.topPct}%`,
                          height: `${p.heightPct}%`,
                          left: `calc(${leftPct}% + ${gutter}px)`,
                          width: `calc(${widthPct}% - ${gutter * 2}px)`,
                        }}
                        title={event.title}
                      >
                        <div className="truncate">
                          {new Date(event.startTime).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </div>
                        <div className="truncate">{event.title}</div>
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

import { useEffect, useState } from "react";

/**
 * Returns a Date for "now" in the browser's local timezone, re-rendering every
 * 60s. This is the user's location-based time (the JS Date is always local).
 * A minute cadence is plenty for the now-line — we do not thrash every second.
 */
export function useNowMinute(): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}

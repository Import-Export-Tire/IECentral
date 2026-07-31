import { timingSafeEqual } from "crypto";

/**
 * Bearer-token gate for the inventory endpoints.
 *
 * Returns null when the request is authorised, or the numeric status to reply
 * with. Fails CLOSED: an unset token yields 503, never open access.
 */
export function checkInventoryToken(req: Request): 401 | 503 | null {
  const expected = process.env.INVENTORY_SNAPSHOT_TOKEN;
  if (!expected) return 503;

  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return 401;
  const provided = header.slice(prefix.length);

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    // Length only — never the value, and no hash that could confirm a guess.
    console.warn(
      `[inventoryAuth] token mismatch (providedLen=${a.length} expectedLen=${b.length})`
    );
    return 401;
  }
  return null;
}

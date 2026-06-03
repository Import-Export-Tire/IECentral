import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { resolveBrand } from "@/lib/oeivalBrandIndex";

export const maxDuration = 60;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";

export async function POST() {
  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const missing = await convex.query(api.inventoryAdjustments.listMissingBrand, {}) as Array<{ id: string; locationCode: string; itemId: string }>;
    const entries: { id: any; manufacturerName: string; description?: string }[] = [];
    const unresolved: string[] = [];
    // Resolve per record (resolver is module-cached, so this is cheap after the first call).
    for (const m of missing) {
      const hit = await resolveBrand(m.itemId);
      if (hit && hit.manufacturerName) entries.push({ id: m.id, manufacturerName: hit.manufacturerName, description: hit.description });
      else unresolved.push(m.itemId);
    }
    let patched = 0;
    if (entries.length) {
      const res = await convex.mutation(api.inventoryAdjustments.backfillBrands, { entries });
      patched = (res as { patched: number }).patched;
    }
    return NextResponse.json({ scanned: missing.length, resolved: entries.length, patched, unresolvedCount: unresolved.length, unresolved: [...new Set(unresolved)].slice(0, 50) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "heal failed" }, { status: 500 });
  }
}

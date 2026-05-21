import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { brandCodeToName } from "@/lib/brandMapping";

export const maxDuration = 60;

const BUCKET = "ietires-dunlop-jmk-uploads";
const META_KEY = "jmk-uploads/oeival/_cache/latest.meta.json";
const ITEMS_KEY = "jmk-uploads/oeival/_cache/latest.items.ndjson.gz";

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

interface CacheMeta {
  fileKey: string;
  fileName: string;
  fileDate: string;
  totalRows: number;
  filters: { locations: string[]; brands: string[]; productTypes: string[]; dclasses: string[] };
  itemsKey: string;
  itemsBytes: number;
  generatedAt: string;
}

/**
 * GET /api/reports/inventory-data
 *
 * Reads pre-processed cache produced by the dunlop-oeival-processor
 * Lambda whenever a new OEIVAL lands in S3. Streams items.ndjson.gz
 * line-by-line, applies request-side filters, returns the matched
 * subset plus the filter dropdowns.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filterLocation = searchParams.get("location") || "";
    const filterBrand = searchParams.get("brand") || "";
    const filterProductType = searchParams.get("productType") || "";
    const filterDclass = searchParams.get("dclass") || "";

    // 1. Meta — tiny, parses instantly
    let meta: CacheMeta;
    try {
      const metaRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: META_KEY }));
      const metaText = await metaRes.Body?.transformToString("utf-8");
      if (!metaText) throw new Error("empty meta");
      meta = JSON.parse(metaText) as CacheMeta;
    } catch (err) {
      // Cache not yet populated. The Lambda runs on every new upload
      // — if you're seeing this, no OEIVAL has been processed yet.
      return NextResponse.json({
        items: [],
        filters: { locations: [], brands: [], productTypes: [], dclasses: [] },
        fileDate: null,
        staleWarning:
          "Inventory cache hasn't been built yet. Upload a new OEIVAL or trigger the dunlop-oeival-processor Lambda to populate it. (" +
          (err instanceof Error ? err.message : "unknown") + ")",
      });
    }

    // 2. Stream items.ndjson.gz, apply filters, accumulate matches
    const itemsRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: meta.itemsKey || ITEMS_KEY }));
    const body = itemsRes.Body as unknown as NodeJS.ReadableStream | null;
    if (!body) {
      return NextResponse.json({
        items: [],
        filters: meta.filters,
        fileDate: meta.fileDate,
        fileName: meta.fileName,
        totalRows: 0,
        staleWarning: "Cache items file missing.",
      });
    }
    const gunzip = createGunzip();
    body.pipe(gunzip as unknown as NodeJS.WritableStream);
    const rl = createInterface({ input: gunzip as unknown as NodeJS.ReadableStream, crlfDelay: Infinity });

    type Item = Record<string, string | number>;
    const items: Item[] = [];
    for await (const line of rl) {
      if (!line) continue;
      let it: Item;
      try { it = JSON.parse(line) as Item; } catch { continue; }
      if (filterLocation && it.location !== filterLocation) continue;
      if (filterProductType && it.productType !== filterProductType) continue;
      if (filterDclass && it.dclass !== filterDclass) continue;
      // Brand filter compares against the friendly name; the cache stores
      // raw manufacturerName codes, so map before comparing.
      if (filterBrand) {
        const friendly = brandCodeToName(String(it.manufacturerName ?? ""));
        if (friendly !== filterBrand) continue;
      }
      // Apply the friendly brand name to the item we return.
      it.manufacturerName = brandCodeToName(String(it.manufacturerName ?? ""));
      items.push(it);
    }

    return NextResponse.json({
      items,
      filters: meta.filters,
      fileDate: meta.fileDate,
      fileName: meta.fileName,
      totalRows: items.length,
    });
  } catch (err) {
    console.error("Inventory data error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load inventory data" }, { status: 500 });
  }
}

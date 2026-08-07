import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
// Relative, not "@/lib/...": vitest does not resolve the @ alias, and both
// files live in lib/ anyway.
import { brandCodeToName } from "./brandMapping";

const BUCKET = "ietires-dunlop-jmk-uploads";
const META_KEY = "jmk-uploads/oeival/_cache/latest.meta.json";
const ITEMS_KEY = "jmk-uploads/oeival/_cache/latest.items.ndjson.gz";

/**
 * We count TIRES. `productType` is JMK's classification and it is the honest
 * discriminator — every code starts with "T", but not every code is a tire.
 *
 *   T    -> TIRE, TIRE/U, LTADJ, STH, NGT, TED, TEST* — transaction
 *           placeholders carrying 990,000/999,000 "units". No real tires.
 *   T *  -> STUD12/13/15, "TIRE STUDDING PARTS AND LABOR". Parts and labour.
 *   rest -> TP passenger, TL light truck, TM medium truck, TST trailer,
 *           the starred variants TP-star and TL-star, plus TF, TS, TSG, T2M,
 *           TA, TO, TPT, TT. (Spelled out because a literal star-slash would
 *           close this comment.)
 *
 * A BLOCKLIST, not an allowlist, on purpose: if JMK adds a new tire class, an
 * allowlist would silently drop real inventory from every count, which is the
 * worse failure. A new placeholder class is caught by the two backstops below
 * and shows up in the excluded-count.
 */
export const NON_TIRE_PRODUCT_TYPES = new Set(["T", "T *"]);

/** Known placeholder itemIds — third layer, in case one gets reclassified. */
export const PLACEHOLDER_ITEM_IDS = new Set([
  "TIRE",
  "TIRE/U",
  "LTADJ",
  "STH",
  "NGT",
  "TED",
]);

/** Backstop: placeholders carry 990,000+. Largest real W09 stock is 1,872. */
export const PLACEHOLDER_QTY_THRESHOLD = 100_000;

/**
 * True when a row is a countable physical tire.
 *
 * Deliberately NOT keyed on `dclass`, which looks like the obvious rule — 463 of
 * W09's 480 real items are `dclass: "Dot"`. The other 17 are real tires too:
 * nine RBP commercial truck tires (225/70R19.5, 11R22.5) with blank dclass and
 * eight "Bracket" rows. Filtering on dclass silently drops them.
 */
export function isCountableTire(row: {
  productType?: string;
  itemId?: string;
  qtyOnHand?: number;
}): boolean {
  const pt = String(row.productType ?? "").trim().toUpperCase();
  if (!pt) return false; // no classification — don't guess it's a tire
  if (NON_TIRE_PRODUCT_TYPES.has(pt)) return false;

  const id = String(row.itemId ?? "").trim().toUpperCase();
  if (!id) return false;
  if (PLACEHOLDER_ITEM_IDS.has(id)) return false;
  if (id.startsWith("TEST")) return false;

  if (Math.abs(Number(row.qtyOnHand) || 0) >= PLACEHOLDER_QTY_THRESHOLD) return false;

  return true;
}

export type SnapshotItem = {
  itemId: string;
  qtyOnHand: number;
  brand: string;
  model: string;
  size: string;
  mpn: string;
  /**
   * JMK's own barcode for this item, straight from the OEIVAL and keyed by the
   * same itemId. This is the authoritative scan key — 99% populated at W09
   * (94% upcCode + 5% ean) — and it removes any need to bridge through
   * tireUPCs on the manufacturer part number.
   */
  upc: string;
  ean: string;
  /**
   * JMK's average cost per tire, so a variance can be valued in money rather
   * than only in units. avgCost rather than lastCost: a count variance spans
   * whatever was on the floor, not the most recent purchase, and avgCost is the
   * figure JMK's own extendedValue is built from.
   *
   * 0 when the OEIVAL carries no cost for the item — reports must treat that as
   * "unknown", never as a free tire.
   */
  avgCost: number;
};

export type SnapshotResult = {
  location: string;
  fileDate: string | null;
  fileName: string | null;
  generatedAt: string | null;
  count: number;
  excludedNonTires: number;
  excludedUnits: number;
  /** How many returned items carry a barcode — the scannable fraction. */
  withBarcode: number;
  /** Items with a usable avgCost, so a report can say how much of it it could value. */
  withCost: number;
  /** Book value of the returned stock at avgCost. */
  totalValue: number;
  items: SnapshotItem[];
};

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

/** Thrown when the Lambda has not yet built a cache. Route maps this to 409. */
export class SnapshotCacheMissing extends Error {}

/**
 * Stream the OEIVAL cache and return countable tire stock for one location.
 * Mirrors app/api/reports/inventory-data/route.ts, minus the price columns.
 */
export async function readLocationSnapshot(location: string): Promise<SnapshotResult> {
  const loc = location.trim().toUpperCase();

  let meta: {
    itemsKey?: string;
    fileDate?: string;
    fileName?: string;
    generatedAt?: string;
  };
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: META_KEY }));
    const text = await res.Body?.transformToString("utf-8");
    if (!text) throw new Error("empty meta");
    meta = JSON.parse(text);
  } catch (err) {
    throw new SnapshotCacheMissing(
      "Inventory cache hasn't been built yet. Upload a new OEIVAL or trigger the " +
        "dunlop-oeival-processor Lambda. (" +
        (err instanceof Error ? err.message : "unknown") +
        ")"
    );
  }

  const itemsRes = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: meta.itemsKey || ITEMS_KEY })
  );
  const body = itemsRes.Body as unknown as NodeJS.ReadableStream | null;
  if (!body) throw new SnapshotCacheMissing("Cache items file missing.");

  const gunzip = createGunzip();
  body.pipe(gunzip as unknown as NodeJS.WritableStream);
  const rl = createInterface({
    input: gunzip as unknown as NodeJS.ReadableStream,
    crlfDelay: Infinity,
  });

  // Key by itemId. W09 measured one row per itemId, but do not assume that
  // holds for every location — sum duplicates rather than overwrite.
  const byItem = new Map<string, SnapshotItem>();
  let excludedNonTires = 0;
  let excludedUnits = 0;

  for await (const line of rl) {
    if (!line) continue;
    let it: Record<string, string | number>;
    try {
      it = JSON.parse(line);
    } catch {
      continue;
    }
    if (String(it.location ?? "").trim().toUpperCase() !== loc) continue;

    const qty = Number(it.qtyOnHand ?? 0);
    if (qty === 0) continue;

    const itemId = String(it.itemId ?? "").trim();
    if (
      !isCountableTire({
        productType: String(it.productType ?? ""),
        itemId,
        qtyOnHand: qty,
      })
    ) {
      excludedNonTires += 1;
      excludedUnits += qty;
      continue;
    }

    const key = itemId.toUpperCase();
    const existing = byItem.get(key);
    if (existing) {
      existing.qtyOnHand += qty;
    } else {
      byItem.set(key, {
        itemId,
        qtyOnHand: qty,
        brand: brandCodeToName(String(it.manufacturerName ?? "")),
        model: String(it.model ?? ""),
        size: String(it.description ?? ""),
        mpn: String(it.mfgItemId ?? ""),
        upc: String(it.upcCode ?? "").trim(),
        ean: String(it.ean ?? "").trim(),
        avgCost: Number(it.avgCost ?? 0) || 0,
      });
    }
  }

  const items = [...byItem.values()];
  const withBarcode = items.filter((i) => i.upc || i.ean).length;
  const withCost = items.filter((i) => i.avgCost > 0).length;
  const totalValue =
    Math.round(items.reduce((n, i) => n + i.avgCost * i.qtyOnHand, 0) * 100) / 100;
  return {
    location: loc,
    withBarcode,
    withCost,
    totalValue,
    fileDate: meta.fileDate ?? null,
    fileName: meta.fileName ?? null,
    generatedAt: meta.generatedAt ?? null,
    count: items.length,
    excludedNonTires,
    excludedUnits,
    items,
  };
}

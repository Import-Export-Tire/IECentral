// Server-only module: imports Node stream/zlib APIs and AWS S3. Must never be
// bundled into a client component.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createGunzip } from "zlib";
import { createInterface } from "readline";
import { brandCodeToName } from "@/lib/brandMapping";

const BUCKET = "ietires-dunlop-jmk-uploads";
// Tire-label lookups read the COLLECTIVE index (cumulative union of every
// OEIVAL ever processed, keyed by itemId, never shrinks) — NOT the latest.*
// reporting snapshot. This way a partial upload (e.g. "R20 ONLY") can refresh
// reports without making non-R20 tire labels disappear. Built by the
// dunlop-oeival-processor Lambda (update_lookup_index).
const META_KEY = "jmk-uploads/oeival/_cache/lookup.meta.json";
const ITEMS_KEY = "jmk-uploads/oeival/_cache/lookup.items.ndjson.gz";

// Rebuild at least this often even if generatedAt looks unchanged, as a
// safety net against a stale/missing meta.
const TTL_MS = 10 * 60 * 1000;

const s3 = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } }
    : {}),
});

export interface BrandEntry {
  manufacturerName: string;
  description: string;
  model: string;
  mfgItemId: string;
}

interface CacheMeta {
  itemsKey?: string;
  generatedAt?: string;
}

// Module-scoped cache. Persists for the life of the serverless instance.
interface BrandCache {
  generatedAt: string;
  builtAt: number;
  map: Map<string, BrandEntry>;
}
let cache: BrandCache | null = null;
// In-flight build guard so concurrent requests share a single rebuild.
let buildInFlight: Promise<BrandCache> | null = null;

async function readMeta(): Promise<CacheMeta | null> {
  try {
    const metaRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: META_KEY }));
    const metaText = await metaRes.Body?.transformToString("utf-8");
    if (!metaText) return null;
    return JSON.parse(metaText) as CacheMeta;
  } catch {
    return null;
  }
}

async function buildMap(meta: CacheMeta | null): Promise<BrandCache> {
  const map = new Map<string, BrandEntry>();
  const itemsKey = meta?.itemsKey || ITEMS_KEY;

  const itemsRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: itemsKey }));
  const body = itemsRes.Body as unknown as NodeJS.ReadableStream | null;
  if (body) {
    const gunzip = createGunzip();
    body.pipe(gunzip as unknown as NodeJS.WritableStream);
    const rl = createInterface({ input: gunzip as unknown as NodeJS.ReadableStream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const rawId = String(o.itemId ?? "").trim().toUpperCase();
      if (!rawId) continue;
      // First write wins — brand is consistent per itemId across locations.
      if (map.has(rawId)) continue;
      const manufacturerName = brandCodeToName(String(o.manufacturerName ?? ""));
      if (!manufacturerName) continue;
      map.set(rawId, {
        manufacturerName,
        description: String(o.description ?? ""),
        model: String(o.model ?? ""),
        mfgItemId: String(o.mfgItemId ?? ""),
      });
    }
  }

  return { generatedAt: meta?.generatedAt ?? "", builtAt: Date.now(), map };
}

/**
 * Build or return the cached itemId(UPPERCASE) -> brand map.
 *
 * Caching strategy: the module holds a single { generatedAt, builtAt, map }.
 * On each call we read the tiny meta first. We rebuild the (large) map only
 * when the cache's `generatedAt` differs from meta's, or when the cached map
 * is older than TTL_MS. Concurrent rebuilds share one in-flight promise.
 */
export async function getBrandIndex(): Promise<Map<string, BrandEntry>> {
  const meta = await readMeta();
  const metaGeneratedAt = meta?.generatedAt ?? "";

  const isFresh =
    cache !== null &&
    cache.generatedAt === metaGeneratedAt &&
    Date.now() - cache.builtAt < TTL_MS;

  if (isFresh) return cache!.map;

  // A rebuild is in progress — await it rather than starting another.
  if (buildInFlight) {
    const built = await buildInFlight;
    return built.map;
  }

  buildInFlight = buildMap(meta);
  try {
    const built = await buildInFlight;
    cache = built;
    return built.map;
  } finally {
    buildInFlight = null;
  }
}

/**
 * Resolve a single itemId to its brand entry, or null if not in the cache.
 * The returned manufacturerName has already been passed through brandCodeToName.
 */
export async function resolveBrand(itemId: string): Promise<BrandEntry | null> {
  const key = String(itemId ?? "").trim().toUpperCase();
  if (!key) return null;
  const map = await getBrandIndex();
  return map.get(key) ?? null;
}

export interface TireSearchResult {
  itemId: string;
  brand: string;
  model: string;
  sizeDesc: string;
  mpn: string;
}

/**
 * Search the catalog by free text across brand + model + description(size) + itemId.
 * For finding an untagged tire: the user types what's on the sidewall (size/brand/
 * model) and picks a match. All terms must match (AND). Results deduped by
 * brand|model|size so the same tire doesn't repeat across SKUs.
 */
export async function searchTires(query: string, limit = 40): Promise<TireSearchResult[]> {
  const q = (query ?? "").trim().toLowerCase();
  if (q.length < 2) return [];
  // Match each term either as a plain substring OR with separators stripped, so a size
  // typed "245/40/R18", "245/40 R18", or "245-40R18" all match the catalog's "245/40R18".
  const compact = (s: string) => s.replace(/[^a-z0-9]/g, "");
  const terms = q.split(/\s+/).filter(Boolean).map((t) => ({ raw: t, comp: compact(t) }));
  const map = await getBrandIndex();
  const seen = new Set<string>();
  const out: TireSearchResult[] = [];
  for (const [itemId, e] of map) {
    const hay = `${e.manufacturerName} ${e.model} ${e.description} ${itemId}`.toLowerCase();
    const hayComp = compact(hay);
    if (!terms.every((t) => hay.includes(t.raw) || (t.comp.length >= 2 && hayComp.includes(t.comp)))) continue;
    const dedupKey = `${e.manufacturerName}|${e.model}|${e.description}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({ itemId, brand: e.manufacturerName, model: e.model, sizeDesc: e.description, mpn: e.mfgItemId });
    if (out.length >= limit) break;
  }
  return out;
}

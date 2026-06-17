// One-time backfill: generate card thumbnails (and cached Office PDFs) for existing docs.
//
// Usage:
//   node scripts/backfill-thumbnails.mjs            # against production (https://iecentral.com)
//   BASE_URL=http://localhost:3000 node scripts/backfill-thumbnails.mjs
//
// Lists all active documents from Convex and POSTs each id to /api/documents/thumbnail
// (idempotent — already-thumbnailed docs are simply regenerated). Low concurrency so the
// LibreOffice Lambda isn't stampeded.
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud";
const BASE_URL = process.env.BASE_URL || "https://iecentral.com";
const CONCURRENCY = 4;

const client = new ConvexHttpClient(CONVEX_URL);
const docs = await client.query(makeFunctionReference("documents:getAll"), {});
const active = docs.filter((d) => d.isActive);
console.log(`Backfilling thumbnails for ${active.length} active docs via ${BASE_URL} …`);

let done = 0, ok = 0, skip = 0, fail = 0;
const errs = [];
for (let i = 0; i < active.length; i += CONCURRENCY) {
  const batch = active.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(async (d) => {
      try {
        const res = await fetch(`${BASE_URL}/api/documents/thumbnail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: d._id }),
        });
        if (res.ok) ok++;
        else if (res.status === 204) skip++;
        else { fail++; if (errs.length < 8) errs.push(`${d.name} (${d.fileType}): ${res.status} ${(await res.text()).slice(0, 80)}`); }
      } catch (e) {
        fail++; if (errs.length < 8) errs.push(`${d.name}: ${String(e).slice(0, 80)}`);
      } finally {
        done++;
        process.stdout.write(`  ${done}/${active.length} (ok=${ok} skip=${skip} fail=${fail})\r`);
      }
    }),
  );
}
console.log(`\nDONE: ${ok} thumbnails, ${skip} skipped (unsupported type), ${fail} failed`);
if (errs.length) console.log("sample failures:\n" + errs.join("\n"));

#!/usr/bin/env node
/**
 * One-off / on-demand backfill for the OEIVAL cache.
 *
 * Mirrors the logic of aws/dunlop-reporter/lambdas/oeival_processor.py
 * but runs locally in Node, so you can rebuild the cache without
 * waiting for the Lambda to deploy.
 *
 * Usage:
 *   AWS_PROFILE=... node aws/dunlop-reporter/scripts/build-oeival-cache.mjs
 *
 * Picks the most-recent oeival CSV from s3://ietires-dunlop-jmk-uploads/jmk-uploads/oeival/
 * and writes the slim cache JSON to jmk-uploads/oeival/_cache/latest.json.
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createInterface } from "readline";

const BUCKET = "ietires-dunlop-jmk-uploads";
const CACHE_KEY = "jmk-uploads/oeival/_cache/latest.json";

const HEADER_MAP = {
  location: ["location", "loc id"],
  productType: ["product type"],
  stockType: ["stock type"],
  dclass: ["d class", "d-class", "dclass"],
  manufacturerCode: ["manufacturer code", "mfg code"],
  manufacturerName: ["manufacturer name", "mfg name", "mfg's name"],
  model: ["model"],
  itemId: ["item id"],
  mfgItemId: ["manufacturer's item id", "mfg's item id", "mfg item id"],
  description: ["description", "item description"],
  reorderPoint: ["reorder point"],
  qtyOnHand: ["qty on hand"],
  qtyCommitted: ["qty committed"],
  qtyAvailable: ["qty available"],
  priceRetail: ["o/e 'retail'", "retail"],
  priceCommercial: ["o/e 'commercial'", "commercial"],
  priceWholesale: ["o/e 'wholesale'", "wholesale"],
  priceBase: ["o/e 'base'", "base"],
  priceList: ["o/e 'list'", "list"],
  priceAdj: ["o/e 'adj'", "adj"],
  lastCost: ["last cost"],
  avgCost: ["avg cost"],
  stdCost: ["std cost"],
  fet: ["fet"],
  extendedValue: ["extended value"],
};

const DCLASS_DECODE = {
  Blank: "", Dash: "Dash", colon: "Colon", "Open Bracket": "Bracket",
  ".": "Dot", "^": "Caret", "[": "Bracket", ":": "Colon", "-": "Dash",
  "~": "Tilde", "*": "Star", "#": "Hash", "!": "Bang",
};
const DCLASS_SUFFIX = { ".": "Dot", "^": "Caret", "[": "Bracket", ":": "Colon", "-": "Dash", "~": "Tilde", "*": "Star", "#": "Hash" };

const num = (v) => {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

function parseCsvLine(line) {
  const fields = [];
  let field = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { fields.push(field.trim()); field = ""; }
      else field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function buildColMap(header) {
  const headers = header.map((h) => h.replace(/"/g, "").trim().toLowerCase());
  const col = {};
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    let idx = headers.findIndex((h) => aliases.some((a) => h === a));
    if (idx < 0) idx = headers.findIndex((h) => aliases.some((a) => h.includes(a)));
    if (idx >= 0) col[field] = idx;
  }
  const qoh = headers.indexOf("qty on hand");  if (qoh >= 0) col.qtyOnHand = qoh;
  const avg = headers.indexOf("avg cost");     if (avg >= 0) col.avgCost = avg;
  return col;
}

function rowToItem(row, col) {
  const g = (f) => { const i = col[f]; return i == null || i >= row.length ? "" : String(row[i] || "").trim(); };
  const gn = (f) => num(g(f));
  if (!g("location") && !g("productType")) return null;
  const rawDclass = g("dclass");
  let dclass = "";
  if ("dclass" in col) {
    dclass = DCLASS_DECODE[rawDclass || "Blank"] ?? rawDclass;
  } else {
    const id = g("itemId");
    const last = id.slice(-1);
    dclass = DCLASS_SUFFIX[last] || "";
  }
  return {
    location: g("location"), productType: g("productType"), stockType: gn("stockType"), dclass,
    manufacturerCode: g("manufacturerCode"), manufacturerName: g("manufacturerName"),
    model: g("model"), itemId: g("itemId"), mfgItemId: g("mfgItemId"), description: g("description"),
    reorderPoint: gn("reorderPoint"), qtyOnHand: gn("qtyOnHand"),
    qtyCommitted: gn("qtyCommitted"), qtyAvailable: gn("qtyAvailable"),
    priceRetail: gn("priceRetail"), priceCommercial: gn("priceCommercial"),
    priceWholesale: gn("priceWholesale"), priceBase: gn("priceBase"),
    priceList: gn("priceList"), priceAdj: gn("priceAdj"),
    lastCost: gn("lastCost"), avgCost: gn("avgCost"), stdCost: gn("stdCost"),
    fet: gn("fet"), extendedValue: gn("extendedValue"),
  };
}

function buildFilters(items) {
  const locations = new Set(), brands = new Set(), pts = new Set(), dcs = new Set();
  for (const it of items) {
    if (it.location) locations.add(it.location);
    if (it.manufacturerName) brands.add(it.manufacturerName);
    if (it.productType) pts.add(it.productType);
    if (it.dclass) dcs.add(it.dclass);
  }
  return {
    locations: [...locations].sort(),
    brands: [...brands].sort(),
    productTypes: [...pts].sort(),
    dclasses: [...dcs].sort(),
  };
}

async function main() {
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

  console.log("Listing OEIVAL files…");
  const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "jmk-uploads/oeival/", MaxKeys: 1000 }));
  const candidates = (list.Contents || [])
    .filter((o) => o.Key?.toLowerCase().includes("oeival") && o.Key.endsWith(".csv") && !o.Key.includes("_cache"))
    .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

  if (candidates.length === 0) {
    console.error("No OEIVAL csv files found.");
    process.exit(1);
  }
  const file = candidates[0];
  console.log(`Picked ${file.Key} (${Math.round((file.Size ?? 0) / 1024 / 1024)}MB, modified ${file.LastModified?.toISOString()})`);

  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: file.Key }));
  const body = obj.Body;

  const rl = createInterface({ input: body, crlfDelay: Infinity });
  let header = null, col = null;
  const items = [];
  let rowCount = 0;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^﻿/, "").replace(/\0/g, "");
    if (!line) continue;
    const fields = parseCsvLine(line);
    if (!header) { header = fields; col = buildColMap(header); continue; }
    rowCount++;
    const item = rowToItem(fields, col);
    if (item) items.push(item);
    if (rowCount % 50000 === 0) console.log(`  …${rowCount} rows`);
  }
  console.log(`Parsed ${items.length} items (out of ${rowCount} rows).`);

  const cache = {
    fileKey: file.Key,
    fileName: file.Key.split("/").pop(),
    fileDate: file.LastModified?.toISOString(),
    totalRows: items.length,
    items,
    filters: buildFilters(items),
    generatedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(cache);
  console.log(`Cache JSON: ${Math.round(json.length / 1024 / 1024)}MB. Uploading to s3://${BUCKET}/${CACHE_KEY}`);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: CACHE_KEY, Body: json, ContentType: "application/json",
  }));
  console.log("✔ Cache uploaded.");
}

main().catch((err) => { console.error(err); process.exit(1); });

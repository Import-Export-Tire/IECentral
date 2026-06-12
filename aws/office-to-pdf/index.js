"use strict";

/**
 * office-to-pdf Lambda
 *
 * Converts an Office document (Word/Excel/PowerPoint, and anything else
 * LibreOffice can read) to PDF, fully in-house — nothing leaves AWS.
 *
 * Invoked via a Function URL (POST JSON) by IECentral's /api/documents/office-pdf
 * route. Auth is a shared secret in the `x-convert-secret` header (CONVERT_SECRET env).
 *
 * Request  body: { "filename": "foo.docx", "contentBase64": "<base64 of the file>" }
 * Response body: { "pdfBase64": "<base64 of the produced PDF>" }
 *
 * LibreOffice ships in a public layer as a brotli-compressed tarball at
 * /opt/lo.tar.br. We decompress it (Node has native brotli) and untar it to
 * /tmp/instdir on the first invocation of a warm instance, then reuse it.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { pipeline } = require("stream/promises");

const SECRET = process.env.CONVERT_SECRET;
const LO_ARCHIVE = "/opt/lo.tar.br";
const SOFFICE = "/tmp/instdir/program/soffice.bin";

let unpackPromise = null;
async function ensureLibreOffice() {
  if (fs.existsSync(SOFFICE)) return;
  if (!unpackPromise) {
    unpackPromise = (async () => {
      await pipeline(
        fs.createReadStream(LO_ARCHIVE),
        zlib.createBrotliDecompress(),
        fs.createWriteStream("/tmp/lo.tar")
      );
      execFileSync("tar", ["xf", "/tmp/lo.tar", "-C", "/tmp"]);
      fs.rmSync("/tmp/lo.tar", { force: true });
    })();
  }
  return unpackPromise;
}

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  const headers = event.headers || {};
  const provided = headers["x-convert-secret"] || headers["X-Convert-Secret"];
  if (!SECRET || provided !== SECRET) return json(401, { error: "unauthorized" });

  let raw = event.body || "";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "invalid json body" });
  }
  const { filename, contentBase64 } = payload;
  if (!contentBase64) return json(400, { error: "missing contentBase64" });

  const safeName = String(filename || "input.docx").replace(/[^A-Za-z0-9._-]/g, "_");
  const ext = path.extname(safeName) || ".docx";
  const base = "doc_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
  const inPath = `/tmp/${base}${ext}`;
  const outPath = `/tmp/${base}.pdf`;
  // Per-invocation profile dir so concurrent conversions don't fight over a lock.
  const profile = `file:///tmp/profile_${base}`;

  fs.writeFileSync(inPath, Buffer.from(contentBase64, "base64"));

  try {
    await ensureLibreOffice();
    execFileSync(
      SOFFICE,
      [
        "--headless",
        "--norestore",
        "--invisible",
        "--nodefault",
        "--nofirststartwizard",
        "--nologo",
        `-env:UserInstallation=${profile}`,
        "--convert-to",
        "pdf",
        "--outdir",
        "/tmp",
        inPath,
      ],
      { env: { ...process.env, HOME: "/tmp" }, timeout: 55000, stdio: "pipe" }
    );
  } catch (e) {
    const detail = e.stderr ? e.stderr.toString() : e.message;
    return json(500, { error: "conversion failed", detail: String(detail).slice(0, 800) });
  } finally {
    try { fs.rmSync(inPath, { force: true }); } catch {}
    try { fs.rmSync(`/tmp/profile_${base}`, { recursive: true, force: true }); } catch {}
  }

  if (!fs.existsSync(outPath)) return json(500, { error: "no PDF produced" });
  const pdf = fs.readFileSync(outPath);
  try { fs.rmSync(outPath, { force: true }); } catch {}
  return json(200, { pdfBase64: pdf.toString("base64") });
};

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
 * Two transports (the synchronous SDK invoke caps request AND response payloads
 * at 6 MB, so large files must NOT travel in the payload):
 *   - URL mode (preferred): { filename, srcUrl, uploadUrl } — fetch the source
 *     from srcUrl, convert, POST the PDF to uploadUrl (a Convex upload URL),
 *     return { storageId }. Payloads stay tiny regardless of file size.
 *   - Inline mode (small files / legacy): { filename, contentBase64 } -> { pdfBase64 }.
 *
 * LibreOffice ships in a public layer as a brotli-compressed tarball at
 * /opt/lo.tar.br. We decompress it (Node has native brotli) and untar it to
 * /tmp/instdir on the first invocation of a warm instance, then reuse it.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const tar = require("tar");
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
      // /opt/lo.tar.br is brotli(tar). Decompress with Node's native brotli, then
      // extract with the bundled `tar` package — the Node 20 runtime (AL2023) has
      // no system `tar` binary.
      await pipeline(
        fs.createReadStream(LO_ARCHIVE),
        zlib.createBrotliDecompress(),
        fs.createWriteStream("/tmp/lo.tar")
      );
      await tar.x({ file: "/tmp/lo.tar", cwd: "/tmp" });
      fs.rmSync("/tmp/lo.tar", { force: true });
      // The runtime has no system fontconfig; give LibreOffice a minimal one
      // pointing at its own bundled fonts plus a writable cache dir.
      fs.mkdirSync("/tmp/fontcache", { recursive: true });
      fs.writeFileSync(
        "/tmp/fonts.conf",
        `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/tmp/instdir/share/fonts</dir>
  <cachedir>/tmp/fontcache</cachedir>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
</fontconfig>`
      );
    })();
  }
  return unpackPromise;
}

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  // Two invocation shapes: a direct SDK invoke (event IS the payload object) or a
  // Function URL request (event.body is a JSON string, secret in a header).
  let payload = event;
  if (typeof event.body === "string") {
    let raw = event.body;
    if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid json body" });
    }
  }

  const headers = event.headers || {};
  const provided = headers["x-convert-secret"] || headers["X-Convert-Secret"] || payload.secret;
  if (!SECRET || provided !== SECRET) return json(401, { error: "unauthorized" });

  const { filename, contentBase64, srcUrl, uploadUrl } = payload;
  if (!contentBase64 && !srcUrl) return json(400, { error: "missing source (contentBase64 or srcUrl)" });

  const safeName = String(filename || "input.docx").replace(/[^A-Za-z0-9._-]/g, "_");
  const ext = path.extname(safeName) || ".docx";
  const base = "doc_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
  const inPath = `/tmp/${base}${ext}`;
  const outPath = `/tmp/${base}.pdf`;

  // Acquire the source bytes — from a URL (any size) or inline base64 (small/legacy).
  let inputBuf;
  if (srcUrl) {
    try {
      const r = await fetch(srcUrl);
      if (!r.ok) return json(502, { error: "source fetch failed", status: r.status });
      inputBuf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      return json(502, { error: "source fetch failed", detail: String(e && e.message).slice(0, 300) });
    }
  } else {
    inputBuf = Buffer.from(contentBase64, "base64");
  }
  fs.writeFileSync(inPath, inputBuf);

  try {
    await ensureLibreOffice();
    // NOTE: do NOT pass -env:UserInstallation here — on this LibreOffice/runtime it
    // makes soffice.bin exit 81 with no output. The default profile under HOME=/tmp
    // is fine because standard Lambda runs one invocation per container at a time.
    execFileSync(SOFFICE, ["--headless", "--convert-to", "pdf", "--outdir", "/tmp", inPath], {
      env: {
        ...process.env,
        HOME: "/tmp",
        // Runtime ships no system fontconfig; point at the one we wrote.
        FONTCONFIG_FILE: "/tmp/fonts.conf",
        FONTCONFIG_PATH: "/tmp",
        // soffice.bin needs its own libs on the loader path (the soffice wrapper,
        // absent from this layer, normally sets this).
        LD_LIBRARY_PATH: `/tmp/instdir/program:${process.env.LD_LIBRARY_PATH || ""}`,
      },
      timeout: 100000,
      stdio: "pipe",
    });
  } catch (e) {
    const detail = `status=${e.status} ${e.stderr ? e.stderr.toString() : e.message}`;
    return json(500, { error: "conversion failed", detail: String(detail).slice(0, 800) });
  } finally {
    try { fs.rmSync(inPath, { force: true }); } catch {}
  }

  if (!fs.existsSync(outPath)) return json(500, { error: "no PDF produced" });
  const pdf = fs.readFileSync(outPath);
  try { fs.rmSync(outPath, { force: true }); } catch {}

  // URL mode: stream the PDF straight into Convex storage and return only the id,
  // so the (6 MB-capped) invoke response payload stays tiny.
  if (uploadUrl) {
    try {
      const up = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: pdf,
      });
      if (!up.ok) return json(502, { error: "pdf upload failed", status: up.status });
      const out = await up.json(); // Convex upload returns { storageId }
      if (!out || !out.storageId) return json(502, { error: "upload returned no storageId" });
      return json(200, { storageId: out.storageId });
    } catch (e) {
      return json(502, { error: "pdf upload failed", detail: String(e && e.message).slice(0, 300) });
    }
  }

  return json(200, { pdfBase64: pdf.toString("base64") });
};

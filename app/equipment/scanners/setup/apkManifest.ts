// app/equipment/scanners/setup/apkManifest.ts
// Downloads APK buffers from presigned S3 URLs and verifies SHA-256.

export type ApkEntry = {
  url: string;
  sha256: string | null;
  version: string;
  s3Key: string | null;
};

export type ApkManifest = {
  tireTrack: ApkEntry;
  rtLocator: ApkEntry;
  scannerAgent: ApkEntry;
};

const CACHE_DB = "scanner-setup-apk-cache";
const CACHE_STORE = "apks";

async function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCache(key: string): Promise<ArrayBuffer | null> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeCache(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    tx.objectStore(CACHE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Download an APK, verify its SHA-256 (if provided), cache it. Returns the ArrayBuffer. */
export async function fetchApk(
  entry: ApkEntry,
  onProgress?: (pct: number) => void,
): Promise<ArrayBuffer> {
  const cacheKey = entry.s3Key && entry.sha256 ? `${entry.s3Key}|${entry.sha256}` : null;
  if (cacheKey) {
    const cached = await readCache(cacheKey).catch(() => null);
    if (cached) {
      onProgress?.(100);
      return cached;
    }
  }

  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`APK download failed: ${res.status} ${res.statusText}`);

  const contentLength = Number(res.headers.get("content-length") ?? "0");
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (contentLength > 0) onProgress?.(Math.round((received / contentLength) * 100));
  }
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const buffer = merged.buffer;

  if (entry.sha256) {
    const actual = await sha256Hex(buffer);
    if (actual !== entry.sha256.toLowerCase()) {
      throw new Error(
        `APK SHA-256 mismatch (expected ${entry.sha256}, got ${actual}). Aborting install.`,
      );
    }
  }

  if (cacheKey) {
    await writeCache(cacheKey, buffer).catch(() => {});
  }
  return buffer;
}

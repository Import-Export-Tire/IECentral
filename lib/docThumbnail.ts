// Fire-and-forget request to generate a Doc Hub card thumbnail server-side.
// Called right after a document is created/replaced; never blocks the upload and
// swallows all errors (generation is best-effort — cards fall back to an icon).
export function requestThumbnail(documentId: string): void {
  try {
    void fetch("/api/documents/thumbnail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: documentId }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

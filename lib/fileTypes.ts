// Shared file-type resolution for Doc Hub.
//
// Many documents were uploaded with a generic fileType (application/octet-stream or
// application/x-msdownload) because the browser failed to detect a MIME type at upload.
// Preview/thumbnail dispatch and the file proxy all key off fileType, so for those docs
// nothing previews. resolveFileType() derives a usable MIME from the filename extension
// whenever the stored type is generic/missing.

export const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  log: "text/plain",
  rtf: "application/rtf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

const GENERIC = new Set([
  "",
  "application/octet-stream",
  "application/x-msdownload",
  "binary/octet-stream",
  "application/download",
  "application/force-download",
]);

export function extOf(fileName?: string): string {
  return (fileName || "").split(".").pop()?.toLowerCase() || "";
}

/** A usable MIME type: the stored fileType if specific, else derived from the extension. */
export function resolveFileType(fileType?: string, fileName?: string): string {
  const ft = (fileType || "").toLowerCase().trim();
  if (!GENERIC.has(ft)) return fileType as string;
  return EXT_MIME[extOf(fileName)] || fileType || "application/octet-stream";
}

/** Text-like MIME types that need a UTF-8 charset when served, so non-ASCII renders correctly. */
export function isTextType(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith("text/") || m.includes("json") || m.includes("xml") || m.includes("javascript");
}

// Printable PDF for the Equipment Responsibility Agreement.
// The wording comes from the shared, browser-free text module so the printed copy,
// the on-screen preview, and the stored record all match.
import { buildAgreementText, type AgreementInfo } from "./equipmentAgreementText";

// Re-export so existing importers (`@/lib/equipmentAgreementPdf`) keep working.
export { buildAgreementText };
export type { AgreementInfo };

// Load the app logo as a PNG data URL (jsPDF renders PNG reliably; the source is a
// .gif). Best-effort — returns null on any failure so the PDF still prints without it.
async function loadLogoForPdf(): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof document === "undefined") return null;
  try {
    const img = new Image();
    img.src = "/logo.gif";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo load failed"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

// Render the pre-filled agreement to a PDF and open the print dialog
// (hidden-iframe + blob: URL — blob: is allowed by the app CSP frame-src).
export async function printAgreementPdf(info: AgreementInfo): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;
  const usableWidth = pageW - margin * 2;
  let y = margin;

  // Company logo at the top (best-effort; skipped if it can't load).
  const logo = await loadLogoForPdf();
  if (logo && logo.width > 0) {
    const targetW = 120;
    const targetH = (logo.height / logo.width) * targetW;
    doc.addImage(logo.dataUrl, "PNG", margin, y, targetW, targetH);
    y += targetH + 12;
  }

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("EQUIPMENT RESPONSIBILITY AGREEMENT", margin, y);
  y += 18;

  // Body (full disclosure, minus the title line). Auto-shrink the font so the whole
  // agreement PLUS the signature block always fit on ONE page.
  doc.setFont("helvetica", "normal");
  const body = buildAgreementText(info).split("\n").slice(2).join("\n").trim();
  const SIG_BLOCK_H = 96; // signature/date + printed-name + generated-by footer
  const availForBody = pageH - margin - SIG_BLOCK_H - y;
  let bodySize = 9.5;
  let lineH = bodySize * 1.28;
  let lines: string[] = [];
  for (; bodySize >= 6.5; bodySize -= 0.5) {
    lineH = bodySize * 1.28;
    doc.setFontSize(bodySize);
    lines = doc.splitTextToSize(body, usableWidth) as string[];
    if (lines.length * lineH <= availForBody) break;
  }
  doc.setFontSize(bodySize);
  for (const line of lines) {
    doc.text(line, margin, y);
    y += lineH;
  }

  // Signature block (same page, just below the body)
  doc.setFontSize(9);
  const sigY = y + 22;
  doc.line(margin, sigY, margin + 220, sigY);
  doc.text("Employee signature", margin, sigY + 12);
  doc.line(margin + 280, sigY, margin + 280 + 150, sigY);
  doc.text("Date", margin + 280, sigY + 12);
  const printedY = sigY + 44;
  doc.line(margin, printedY, margin + 220, printedY);
  doc.text(`Printed name: ${info.personName}`, margin, printedY + 12);

  // Generated stamp — date/time + who printed it
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  const stamp = `Generated ${new Date().toLocaleString()}${info.generatedBy ? ` by ${info.generatedBy}` : ""}`;
  doc.text(stamp, margin, printedY + 30);
  doc.setTextColor(0);

  const url = doc.output("bloburl") as unknown as string;
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  iframe.src = url;
  // Attach onload BEFORE appending, and delay print() ~400ms so the PDF viewer has
  // actually rendered — printing immediately on load prints blank pages.
  // (Mirrors the working print path in app/safety-reports + app/bin-labels.)
  iframe.onload = () => {
    setTimeout(() => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
    }, 400);
  };
  document.body.appendChild(iframe);
  setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 120000);
}

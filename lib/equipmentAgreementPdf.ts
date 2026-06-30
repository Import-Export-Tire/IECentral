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
  const margin = 56;
  const usableWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const pageH = doc.internal.pageSize.getHeight();
  const bottomLimit = pageH - margin;
  const lineH = 15;
  let y = margin;

  // Company logo at the top (best-effort; skipped if it can't load).
  const logo = await loadLogoForPdf();
  if (logo && logo.width > 0) {
    const targetW = 150;
    const targetH = (logo.height / logo.width) * targetW;
    doc.addImage(logo.dataUrl, "PNG", margin, y, targetW, targetH);
    y += targetH + 16;
  }

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("EQUIPMENT RESPONSIBILITY AGREEMENT", margin, y);
  y += 26;

  // Body (full disclosure) — drop the title line (rendered above) and paginate.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const body = buildAgreementText(info).split("\n").slice(2).join("\n").trim();
  const lines = doc.splitTextToSize(body, usableWidth);
  for (const line of lines) {
    if (y > bottomLimit) { doc.addPage(); y = margin; }
    doc.text(line, margin, y);
    y += lineH;
  }

  // Signature block — keep it together; start a new page if it won't fit.
  y += 30;
  if (y + 90 > bottomLimit) { doc.addPage(); y = margin; }
  const sigY = y + 20;
  doc.line(margin, sigY, margin + 230, sigY);
  doc.text("Employee signature", margin, sigY + 14);
  doc.line(margin + 290, sigY, margin + 290 + 160, sigY);
  doc.text("Date", margin + 290, sigY + 14);
  const printedY = sigY + 56;
  doc.line(margin, printedY, margin + 230, printedY);
  doc.text(`Printed name: ${info.personName}`, margin, printedY + 14);

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

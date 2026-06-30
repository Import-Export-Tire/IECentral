// Shared Equipment Responsibility Agreement text + a printable PDF.
// Used by the scanner assign flow so the on-screen preview, the stored agreement,
// and the printed paper copy all use the same wording (no drift).

export type AgreementInfo = {
  personName: string;
  equipmentLabel?: string; // defaults to "Scanner"
  equipmentNumber: string;
  serialNumber?: string | null;
  equipmentValue: number;
};

export function buildAgreementText(info: AgreementInfo): string {
  const label = info.equipmentLabel ?? "Scanner";
  return `EQUIPMENT RESPONSIBILITY AGREEMENT

I, ${info.personName}, acknowledge receipt of the following company equipment:

Type: ${label}
Identifier: ${info.equipmentNumber}
Serial Number: ${info.serialNumber ?? "N/A"}

I understand that:
1. This equipment remains the property of IE Tires.
2. I am responsible for its care and safekeeping.
3. I will report any damage, loss, or malfunction immediately.
4. I may be held financially responsible for damage due to negligence (up to $${info.equipmentValue}).
5. I will return this equipment upon request or upon separation from the company.

By signing below, I acknowledge and agree to these terms.`;
}

// Render the pre-filled agreement to a one-page PDF and open the print dialog
// (hidden-iframe + blob: URL — blob: is allowed by the app CSP frame-src).
export async function printAgreementPdf(info: AgreementInfo): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 56;
  const usableWidth = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("EQUIPMENT RESPONSIBILITY AGREEMENT", margin, y);
  y += 30;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  // Body without the title line (printed above as the header).
  const body = buildAgreementText(info).split("\n").slice(2).join("\n").trim();
  const lines = doc.splitTextToSize(body, usableWidth);
  doc.text(lines, margin, y);
  y += lines.length * 15 + 48;

  // Signature block
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

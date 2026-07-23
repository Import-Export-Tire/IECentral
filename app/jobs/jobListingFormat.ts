export interface StructuredListing {
  summary: string;
  responsibilities: string[];
  requirements: string[];
}

const RESP_HEADING = "What You'll Do";
const REQ_HEADING = "What We're Looking For";
const OFFER_HEADINGS = ["What We Offer", "Benefits"];

// Normalize curly apostrophes to straight and lowercase. This is a 1:1
// character replacement, so indices in the normalized string map exactly
// onto the original string.
const norm = (s: string) => s.replace(/[‘’]/g, "'").toLowerCase();

export function composeDescription(listing: StructuredListing): string {
  const parts: string[] = [];
  const summary = listing.summary.trim();
  if (summary) parts.push(summary);

  const resp = listing.responsibilities.map((r) => r.trim()).filter(Boolean);
  if (resp.length) {
    parts.push([RESP_HEADING, ...resp.map((r) => `- ${r}`)].join("\n"));
  }

  const req = listing.requirements.map((r) => r.trim()).filter(Boolean);
  if (req.length) {
    parts.push([REQ_HEADING, ...req.map((r) => `- ${r}`)].join("\n"));
  }

  return parts.join("\n\n");
}

export function parseLegacyDescription(description: string): StructuredListing {
  const text = description ?? "";
  const hay = norm(text);
  const findIdx = (heading: string) => hay.indexOf(norm(heading));

  const respIdx = findIdx(RESP_HEADING);
  const reqIdx = findIdx(REQ_HEADING);
  const offerIdx =
    OFFER_HEADINGS.map(findIdx)
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? -1;

  const allHeadings = [respIdx, reqIdx, offerIdx].filter((i) => i >= 0).sort((a, b) => a - b);
  const firstHeading = allHeadings.length ? allHeadings[0] : text.length;
  const summary = text.slice(0, firstHeading).trim();

  const sliceBlock = (start: number, headingLen: number): string => {
    if (start < 0) return "";
    const after = start + headingLen;
    const nextEnds = [respIdx, reqIdx, offerIdx].filter((i) => i > start).sort((a, b) => a - b);
    const end = nextEnds.length ? nextEnds[0] : text.length;
    return text.slice(after, end).trim();
  };

  // Newline-delimited blocks split into one bullet per line; a run-on block
  // (no newlines) becomes a single bullet the staffer breaks up by hand.
  const toBullets = (block: string): string[] => {
    if (!block) return [];
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^[-•]\s*/, ""))
      .filter(Boolean);
    return lines.length ? lines : [block];
  };

  return {
    summary,
    responsibilities: toBullets(sliceBlock(respIdx, RESP_HEADING.length)),
    requirements: toBullets(sliceBlock(reqIdx, REQ_HEADING.length)),
  };
}

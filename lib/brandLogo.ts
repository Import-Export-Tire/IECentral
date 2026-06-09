// Maps a brand/manufacturer name to a logo file slug + path under /public/brand-logos.
export function brandLogoSlug(name: string): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
// e.g. "GOODYEAR" -> "goodyear", "BF GOODRICH" -> "bf-goodrich", "DOUBLE COIN" -> "double-coin"
export function brandLogoSrc(name: string): string | null {
  const slug = brandLogoSlug(name);
  return slug ? `/brand-logos/${slug}.png` : null;
}

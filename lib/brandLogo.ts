// Maps a brand/manufacturer name to its logo. Logos are stored in S3 (brand-logos/<slug>.png)
// and served via /api/brand-logo, so they persist centrally without living in the repo.
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
  return slug ? `/api/brand-logo?slug=${encodeURIComponent(slug)}` : null;
}

// Maps a brand/manufacturer name to its logo. Logos are stored in S3 (brand-logos/<slug>.png)
// and served via /api/brand-logo, so they persist centrally without living in the repo.
export function brandLogoSlug(name: string): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
// Bump when a logo is re-uploaded under an existing slug, to bust per-edge/browser
// caches immediately (a new URL = a fresh cache key everywhere). The route also uses a
// short s-maxage so future swaps self-heal within minutes without a bump.
const LOGO_CACHE_VERSION = "2";
// e.g. "GOODYEAR" -> "goodyear", "BF GOODRICH" -> "bf-goodrich", "DOUBLE COIN" -> "double-coin"
export function brandLogoSrc(name: string): string | null {
  const slug = brandLogoSlug(name);
  return slug ? `/api/brand-logo?slug=${encodeURIComponent(slug)}&v=${LOGO_CACHE_VERSION}` : null;
}

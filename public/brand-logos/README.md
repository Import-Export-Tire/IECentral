# Brand Logos

Drop a brand logo image here so it shows up on the **tire label** (preview + print) above the brand name.

## Naming

Save the file as `public/brand-logos/<slug>.png`, where `<slug>` is the brand name:

- lowercased, and
- with every run of non-alphanumeric characters replaced by a single hyphen (leading/trailing hyphens trimmed).

This is the same transform used by `brandLogoSlug()` in `lib/brandLogo.ts`.

### Examples

| Brand name    | File name          |
| ------------- | ------------------ |
| `GOODYEAR`    | `goodyear.png`     |
| `BF GOODRICH` | `bf-goodrich.png`  |
| `DOUBLE COIN` | `double-coin.png`  |

## Notes

- **PNG with a transparent background works best** (the label background is white).
- If no matching file exists for a brand, the label gracefully **falls back to the brand name text** — no broken-image icon is shown.

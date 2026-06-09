# Brand Logos

Brand logos for the **tire label** are stored in **S3**, not in this folder:
`s3://ietires-scanner-assets/brand-logos/<slug>.png`. The label resolves a logo by brand
name and loads it via `/api/brand-logo?slug=<slug>`. If none exists, the label falls back
to the brand name text (no broken image).

## Naming

`<slug>` = the brand name, lowercased, with every run of non-alphanumeric characters
replaced by a single hyphen (leading/trailing hyphens trimmed) — the same transform as
`brandLogoSlug()` in `lib/brandLogo.ts`.

| Brand name    | S3 key                          |
| ------------- | ------------------------------- |
| `GOODYEAR`    | `brand-logos/goodyear.png`      |
| `BF GOODRICH` | `brand-logos/bf-goodrich.png`   |
| `DOUBLE COIN` | `brand-logos/double-coin.png`   |

## Adding a logo

Upload a transparent-background PNG (label background is white):

```
aws s3 cp goodyear.png s3://ietires-scanner-assets/brand-logos/goodyear.png --content-type image/png
```

(This `public/brand-logos/` folder is no longer the source — kept only for this note.)

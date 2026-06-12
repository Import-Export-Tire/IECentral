# office-to-pdf Lambda

In-house LibreOffice converter that turns Office docs (Word/Excel/PowerPoint) into
PDF so the Doc Hub can preview and print them inline. Used by IECentral's
`/api/documents/office-pdf` route. Nothing leaves AWS — chosen over a hosted viewer
because Doc Hub holds HR PII.

## Deploy

```bash
cd aws/office-to-pdf
CONVERT_SECRET=<PREVIEW_PDF_SECRET value> ./deploy.sh
```

Then set the printed Function URL as `OFFICE_PDF_LAMBDA_URL` in Vercel (all envs)
and redeploy. `CONVERT_SECRET` must equal IECentral's `PREVIEW_PDF_SECRET`.

## How it works

- `index.js` decompresses the public LibreOffice layer (`/opt/lo.tar.br`, brotli)
  to `/tmp/instdir` on first warm-instance use (Node's native brotli — no extra deps),
  then runs `soffice --headless --convert-to pdf`.
- 2 GB memory, 2 GB `/tmp`, 60 s timeout. Function URL is no-auth but gated by the
  `x-convert-secret` header.

## Fallback if the public layer isn't reachable

`deploy.sh` aborts early if `get-layer-version-by-arn` can't see the layer from this
account. If that happens, switch to a container image built from
`shelf/libreoffice-lambda-base-image` (LibreOffice preinstalled): build, push to ECR,
and `create-function --package-type Image`. The handler logic is unchanged except it
calls `soffice` directly instead of unpacking the layer.

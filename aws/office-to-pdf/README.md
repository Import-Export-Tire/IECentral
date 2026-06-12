# office-to-pdf Lambda

In-house LibreOffice converter that turns Office docs (Word/Excel/PowerPoint) into
PDF so the Doc Hub can preview and print them inline. Used by IECentral's
`/api/documents/office-pdf` route. Nothing leaves AWS — chosen over a hosted viewer
because Doc Hub holds HR PII.

## Invocation model (private)

No public endpoint. IECentral's `/api/documents/office-pdf` route invokes this
function **directly via the AWS SDK** using a dedicated, invoke-only IAM user
(`office-to-pdf-invoker`, policy `invoke-office-to-pdf` — `lambda:InvokeFunction` on
this function only). That user's access key lives in Vercel as
`OFFICE_PDF_AWS_ACCESS_KEY_ID` / `OFFICE_PDF_AWS_SECRET_ACCESS_KEY`
(`OFFICE_PDF_AWS_REGION=us-east-1`, `OFFICE_PDF_LAMBDA_FUNCTION` defaults to
`office-to-pdf`). The shared secret (`CONVERT_SECRET` = IECentral `PREVIEW_PDF_SECRET`)
is passed in the payload as defense-in-depth; IAM is the real boundary.

## Deploy

```bash
cd aws/office-to-pdf
CONVERT_SECRET=<PREVIEW_PDF_SECRET value> ./deploy.sh
```

`deploy.sh` installs deps, zips `index.js` + `node_modules`, and creates/updates the
function (2 GB memory, 2 GB `/tmp`, 60 s timeout, LibreOffice layer). It does NOT create
a Function URL.

## How it works

- `index.js` decompresses the public LibreOffice layer (`/opt/lo.tar.br`, brotli) to
  `/tmp/instdir` on first warm-instance use (Node's native brotli), extracts the tar
  with the bundled `tar` package (the Node 20 / AL2023 runtime has no system `tar`),
  writes a minimal `fonts.conf` (no system fontconfig), then runs
  `soffice.bin --headless --convert-to pdf` with `LD_LIBRARY_PATH=/tmp/instdir/program`.
- **Do not** add `-env:UserInstallation`: on this LibreOffice/runtime combo it makes
  `soffice.bin` exit 81 with no output. The default profile under `HOME=/tmp` is fine
  (standard Lambda runs one invocation per container at a time).

## Fallback if the public layer isn't reachable

`deploy.sh` aborts early if `get-layer-version-by-arn` can't see the layer from this
account. If that happens, switch to a container image built from
`shelf/libreoffice-lambda-base-image` and `create-function --package-type Image`.

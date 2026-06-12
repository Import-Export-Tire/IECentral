# email-proxy — static-IP egress for email sync

IECentral's email sync (`imapflow` in `convex/email/sync.ts` + `send.ts`, and the
`scan-attachments` route) runs from Convex/Vercel on **dynamic** cloud IPs. Self-hosted
mail servers like `svm.ietires.com` rate-limit/fail2ban unknown sources and start
**refusing** connections (`ECONNREFUSED`). This box gives the sync **one fixed,
whitelistable egress IP**.

## How it works

```
Convex / Vercel  ──(imapflow proxy: socks5://…)──►  EC2 SOCKS5 proxy [Elastic IP]  ──►  svm.ietires.com:993
```

`imapflow`/`scan-attachments` read `process.env.EMAIL_PROXY_URL`. When set, all IMAP
egress tunnels through this proxy, so the mail server only ever sees the Elastic IP.
Unset = direct connection (default / backward compatible).

## Deploy

```bash
cd aws/email-proxy
# AWS creds in env, e.g.:  eval "$(aws configure export-credentials --profile ietires --format env)"
./deploy.sh
```

Prints the **Elastic IP** (give to IT to allowlist on `svm.ietires.com` port 993)
and the `EMAIL_PROXY_URL`. Then:

```bash
# Convex
npx convex env set EMAIL_PROXY_URL 'socks5://iecentral:<pass>@<EIP>:33080'
npx convex deploy -y
# Vercel (for the scan-attachments route)
printf '%s' 'socks5://iecentral:<pass>@<EIP>:33080' | npx vercel env add EMAIL_PROXY_URL production
```

## Box details

- `t4g.nano` (~$3/mo) Amazon Linux 2023 arm64, Docker running `serjs/go-socks5-proxy`
  with `--restart always`.
- **Auth:** SOCKS5 username/password (20-byte random pass) on a non-standard port.
- **No SSH** — manage via SSM Session Manager (`aws ssm start-session --target <id>`).
- Security group opens only the proxy port. Convex egress IPs are dynamic so it
  can't be source-restricted; the password + odd port are the gate.

## Hardening backlog (v1 ships without these)

- fail2ban / CrowdSec watching the proxy for brute-force, or move the proxy behind
  an allowlist if Convex ever publishes stable egress ranges.
- Rotate the password: change the container env + update `EMAIL_PROXY_URL` in
  Convex/Vercel.
- The proxy only tunnels TLS IMAP (it can't read message content); worst-case abuse
  of leaked creds is bandwidth/anonymization, mitigated by the random password.

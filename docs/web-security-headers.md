<!-- SPDX-License-Identifier: MIT -->

# Web app security headers

The auction interface must not be framed by another origin (clickjacking) and
must not be served with MIME sniffing enabled. Every response from the web app
carries:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `frame-ancestors 'none'` | No origin may embed the app in a frame |
| `X-Frame-Options` | `DENY` | The same denial for browsers that ignore `frame-ancestors` |
| `X-Content-Type-Options` | `nosniff` | The browser must trust the declared content type |

## Where they are configured

- `apps/web/src/lib/security-headers.ts` is the single source of truth (the
  `SECURITY_HEADERS` constant).
- `apps/web/vite.config.ts` sends them from the Vite dev server (`server.headers`)
  and the preview server (`preview.headers`).
- `apps/web/public/_headers` ships with the build output (`dist/_headers`) and is
  read by Netlify and Cloudflare Pages.

Hosts that do not read `_headers` (nginx, Caddy, S3 or CloudFront, Vercel) need
the same three headers set in their own configuration; copy them from the table
above. A CDN or proxy in front of the app must not strip or override them.

## Keeping them in step

`apps/web/src/lib/security-headers.test.ts` fails when `public/_headers` no longer
matches `SECURITY_HEADERS`, when the Vite config stops using it, or when this page
stops naming the files above. Run it with `pnpm --filter @sub-rosa/web test`.

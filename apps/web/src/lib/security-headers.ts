// Copyright (c) 2026 Sub Rosa contributors

/// Response headers every deployment of the web app must send so the auction
/// interface cannot be framed by another origin and browsers do not sniff
/// content types. The same values are served by the Vite dev and preview servers
/// (`vite.config.ts`) and shipped to static hosts in `public/_headers`;
/// `security-headers.test.ts` keeps all three in step. See
/// `docs/web-security-headers.md`.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};

/// Render `SECURITY_HEADERS` in the `_headers` file format used by Netlify and
/// Cloudflare Pages: one path rule, then one indented `Name: value` per line.
export function renderHeadersFile(headers: Readonly<Record<string, string>> = SECURITY_HEADERS): string {
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
  return `/*\n${lines.join("\n")}\n`;
}

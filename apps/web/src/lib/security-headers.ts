// Copyright (c) 2026 Sub Rosa contributors
export const WEB_SECURITY_HEADERS = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
} as const;

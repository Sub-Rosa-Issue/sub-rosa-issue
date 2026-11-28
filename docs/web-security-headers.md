# Auction web security headers

The auction web app sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and a `Content-Security-Policy` with `frame-ancestors 'none'`.

Vercel reads [vercel.json](../apps/web/vercel.json) when the project Root Directory is set to `apps/web`. Netlify and Cloudflare Pages use [_headers](../apps/web/public/_headers), copied into the build output by Vite. Other hosts must configure the same headers on their CDN or web server. Vite dev and preview use the same values.

After deployment, inspect the response headers on the deployed HTML route.

- [Vercel project configuration](https://vercel.com/docs/project-configuration)
- [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [Netlify headers](https://docs.netlify.com/manage/routing/headers/)

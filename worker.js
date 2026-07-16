/**
 * Linkify — Cloudflare Worker router
 * ----------------------------------
 * Deployed via GitHub integration. Static HTML files live in the
 * repo's /public folder and are served through the "ASSETS" binding
 * declared in wrangler.toml (Workers Static Assets).
 *
 * This worker's only job is URL routing:
 *   /            -> /index.html   (hub page)
 *   /img         -> /img.html     (Image to URL)
 *   /video       -> /video.html   (Video to URL)
 *   /audio       -> /audio.html   (Audio to URL)
 *   /sticker     -> /sticker.html (Sticker to URL)
 *   /doc         -> /doc.html     (Document to URL)
 *
 * Any other path is passed straight through to the asset handler
 * (so /img.html still resolves too, plus any CSS/JS/image assets),
 * and unknown paths fall back to a simple 404.
 */

const ROUTES = {
  '/': '/index.html',
  '/img': '/img.html',
  '/video': '/video.html',
  '/audio': '/audio.html',
  '/sticker': '/sticker.html',
  '/doc': '/doc.html',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Normalize trailing slashes, e.g. /img/ -> /img
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // Map the clean route to its underlying HTML asset.
    if (Object.prototype.hasOwnProperty.call(ROUTES, pathname)) {
      const assetPath = ROUTES[pathname];
      const assetUrl = new URL(assetPath, url.origin);
      const assetRequest = new Request(assetUrl.toString(), request);
      const response = await env.ASSETS.fetch(assetRequest);
      return withSecurityHeaders(response);
    }

    // Let every other request (real asset files, favicon, etc.) fall
    // through to the static asset handler as-is.
    const response = await env.ASSETS.fetch(request);

    // If the asset genuinely doesn't exist, return a minimal 404.
    if (response.status === 404) {
      return new Response(notFoundPage(), {
        status: 404,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });
    }

    return withSecurityHeaders(response);
  },
};

function withSecurityHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('x-content-type-options', 'nosniff');
  newHeaders.set('referrer-policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function notFoundPage() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>404 — Linkify</title>
<style>
  body{font-family:'Inter',sans-serif;background:#e9f0fa;color:#0b1b33;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:100vh;margin:0;text-align:center;}
  h1{font-size:52px;margin-bottom:8px;color:#134fb8;}
  a{color:#2f5fff;font-weight:600;text-decoration:none;margin-top:12px;}
</style></head>
<body>
  <h1>404</h1>
  <p>This page doesn't exist.</p>
  <a href="/">Back to Linkify</a>
</body></html>`;
}

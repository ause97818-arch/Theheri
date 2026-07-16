/**
 * Linkify — Cloudflare Worker router
 * ----------------------------------
 * Deployed via GitHub integration. Static HTML files live in the
 * repo's /public folder and are served through the "ASSETS" binding
 * declared in wrangler.toml (Workers Static Assets).
 *
 * This worker has two jobs:
 *
 * 1) PAGE ROUTING (the converter UIs):
 *      /            -> /index.html   (hub page)
 *      /img         -> /img.html     (Image to URL)
 *      /video       -> /video.html   (Video to URL)
 *      /audio       -> /audio.html   (Audio to URL)
 *      /sticker     -> /sticker.html (Sticker to URL)
 *      /doc         -> /doc.html     (Document to URL)
 *
 * 2) ASSET PROXYING (the generated links people actually share):
 *    Cloudinary is still the permanent storage backend, but nobody
 *    should ever see "res.cloudinary.com" in a link. So the browser
 *    builds links like:
 *        https://<your-domain>/image/<public_id>.jpg
 *        https://<your-domain>/video/<public_id>.mp4
 *        https://<your-domain>/audio/<public_id>.mp3
 *        https://<your-domain>/sticker/<public_id>.png
 *        https://<your-domain>/doc/<public_id>.pdf
 *    and this worker fetches the real file straight from Cloudinary
 *    behind the scenes and streams it back — no cloud name, no
 *    "/upload/", no version number ever shows up for the visitor.
 */

const CLOUD_NAME = 'wdhnno7y';

const PAGE_ROUTES = {
  '/': '/index.html',
  '/img': '/img.html',
  '/video': '/video.html',
  '/audio': '/audio.html',
  '/sticker': '/sticker.html',
  '/doc': '/doc.html',
};

// Public path segment -> Cloudinary's internal resource_type.
// (Cloudinary has no separate "audio" type — audio files live under "video".)
const ASSET_RESOURCE_TYPE = {
  image: 'image',
  sticker: 'image',
  video: 'video',
  audio: 'video',
  doc: 'raw',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Normalize trailing slashes, e.g. /img/ -> /img
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // --- 1) Exact-match page routes ---
    if (Object.prototype.hasOwnProperty.call(PAGE_ROUTES, pathname)) {
      const assetPath = PAGE_ROUTES[pathname];
      const assetUrl = new URL(assetPath, url.origin);
      const assetRequest = new Request(assetUrl.toString(), request);
      const response = await env.ASSETS.fetch(assetRequest);
      return withSecurityHeaders(response);
    }

    // --- 2) Branded asset proxy: /image/<file>, /video/<file>, etc. ---
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && Object.prototype.hasOwnProperty.call(ASSET_RESOURCE_TYPE, segments[0])) {
      const resourceType = ASSET_RESOURCE_TYPE[segments[0]];
      const filePath = segments.slice(1).join('/'); // supports nested public_ids too
      return proxyCloudinaryAsset(request, resourceType, filePath);
    }

    // --- 3) Everything else falls through to static assets ---
    const response = await env.ASSETS.fetch(request);

    if (response.status === 404) {
      return new Response(notFoundPage(), {
        status: 404,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });
    }

    return withSecurityHeaders(response);
  },
};

async function proxyCloudinaryAsset(request, resourceType, filePath) {
  const upstreamUrl = `https://res.cloudinary.com/${CLOUD_NAME}/${resourceType}/upload/${filePath}`;

  // Forward the method + relevant headers (Range is important for
  // video/audio seeking) so playback and downloads behave exactly
  // like a direct Cloudinary link would.
  const upstreamRequest = new Request(upstreamUrl, {
    method: request.method,
    headers: {
      'Range': request.headers.get('Range') || '',
      'If-None-Match': request.headers.get('If-None-Match') || '',
    },
  });

  const upstreamResponse = await fetch(upstreamRequest);

  if (upstreamResponse.status === 404) {
    return new Response(notFoundPage(), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
  }

  const headers = new Headers(upstreamResponse.headers);
  // Files are immutable once uploaded (unique public_id per upload),
  // so cache them aggressively at Cloudflare's edge.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  headers.delete('x-cld-error'); // don't leak upstream provider details

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

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

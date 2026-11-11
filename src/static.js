// Static files bundled into the Worker (see "rules" in wrangler.jsonc).
import indexHtml from '../public/index.html';
import styleCss from '../public/style.css';
import appJs from '../public/app.js';
import swJs from '../public/sw.js';
import manifest from '../public/manifest.webmanifest';
import iconSvg from '../public/icons/icon.svg';
import icon192 from '../public/icons/icon-192.png';
import icon512 from '../public/icons/icon-512.png';
import appleIcon from '../public/icons/apple-touch-icon.png';

const NO_CACHE = 'no-cache';
const SHORT = 'public, max-age=3600';
const LONG = 'public, max-age=604800';

export const FILES = {
  '/': [indexHtml, 'text/html; charset=utf-8', NO_CACHE],
  '/index.html': [indexHtml, 'text/html; charset=utf-8', NO_CACHE],
  '/style.css': [styleCss, 'text/css; charset=utf-8', SHORT],
  '/app.js': [appJs, 'text/javascript; charset=utf-8', SHORT],
  '/sw.js': [swJs, 'text/javascript; charset=utf-8', NO_CACHE],
  '/manifest.webmanifest': [manifest, 'application/manifest+json', SHORT],
  '/icons/icon.svg': [iconSvg, 'image/svg+xml', LONG],
  '/icons/icon-192.png': [icon192, 'image/png', LONG],
  '/icons/icon-512.png': [icon512, 'image/png', LONG],
  '/icons/apple-touch-icon.png': [appleIcon, 'image/png', LONG],
  '/apple-touch-icon.png': [appleIcon, 'image/png', LONG],
  '/favicon.ico': [icon192, 'image/png', LONG],
};

export function serveStatic(url, req) {
  const f = FILES[url.pathname] || (req.method === 'GET' && !url.pathname.includes('.') ? FILES['/'] : null);
  if (!f) return new Response('Not found', { status: 404 });
  const [body, type, cache] = f;
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: {
      'content-type': type,
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
    },
  });
}

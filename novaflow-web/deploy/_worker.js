// Cloudflare Pages advanced-mode worker: serve the application code only to a
// logged-in browser.
//
// It ships INSIDE the site zip (tools/package-site.mjs copies it to the
// web-dist root), so the existing "upload the zip" deploy is unchanged. With a
// _worker.js present, Pages routes every request here and static files are
// served through env.ASSETS.
//
// The gate is OFF until NOVAFLOW_SESSION_SECRET is set on the Pages project:
// with no secret every request is served as before, so deploying the zip never
// bricks the site. Set the secret (the same NOVAFLOW_SESSION_SECRET the edge
// functions use) in the Cloudflare dashboard to turn protection on.
//
// How it gates: the login shell (index.html + the account/runtime scripts +
// theme css + logo) is public so the login screen can render. Everything else -
// every renderer module, the React bundle, workers, wasm, model and template
// data - is served only when the request carries a cookie holding a valid,
// unexpired NovaFlow session token (nfs_...). A <script src> / importScripts
// request cannot send an Authorization header but does send same-origin
// cookies; novaflow-web-runtime.js mirrors the session token into that cookie.
// The token is HMAC-verified at the edge with the same algorithm the control
// plane uses (packages/shared/src/tokens.mjs), so a forged or expired cookie
// gets nothing. Finer checks (revoked session, disabled/expired account) still
// run on every API call in the control plane; the cookie only decides whether
// the browser may download the code at all.

const SESSION_COOKIE = 'nf_sess';

// Served without a login so the login screen itself can load.
const PUBLIC_FILES = new Set([
  '/',
  '/index.html',
  '/novaflow-web-runtime.js',
  '/novaflow-web-account.js',
  '/novaflow-ui-theme.css',
  '/foart-button-theme.css',
  '/foart-button-theme.js',
  '/release.json',
  '/robots.txt',
  '/favicon.ico'
]);

export function isPublicPath(pathname) {
  if (PUBLIC_FILES.has(pathname)) return true;
  // The shell's layout stylesheets and the logo. Code under /assets/ (the
  // React bundle, workers) stays gated - only styling and images are public.
  if (pathname.startsWith('/assets/')) {
    return /\.(css|png|svg|jpg|jpeg|webp|ico|woff2?)$/i.test(pathname);
  }
  return false;
}

function wantsHtml(request) {
  return (request.headers.get('accept') || '').includes('text/html');
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Byte-compatible with issueSessionToken / verifySessionToken: nfs_ + base64url(payload) + '.' + base64url(HMAC-SHA256(payload, secret)).
export async function sessionTokenValid(token, secret) {
  const raw = String(token || '').trim();
  if (!secret || !raw.startsWith('nfs_')) return false;
  const parts = raw.slice(4).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts[0]));
    if (!timingSafeEqual(bytesToBase64Url(new Uint8Array(signature)), parts[1])) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (!payload || typeof payload !== 'object' || !payload.sub || !payload.exp) return false;
    return Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const secret = env && env.NOVAFLOW_SESSION_SECRET;
    const serve = () => env.ASSETS.fetch(request);

    // Gate not configured: behave exactly like a plain static site.
    if (!secret) return serve();

    const url = new URL(request.url);
    if (isPublicPath(url.pathname)) return serve();

    const authed = await sessionTokenValid(readCookie(request, SESSION_COOKIE), secret);
    if (authed) return serve();

    // Not logged in. A page navigation gets the login shell; a code/data
    // sub-resource gets nothing.
    if (wantsHtml(request)) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url).toString(), request));
    }
    return new Response('login required', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
};

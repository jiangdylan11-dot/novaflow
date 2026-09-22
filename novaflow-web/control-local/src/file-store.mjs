// The local control plane's stand-in for Supabase Storage.
//
// The Web line has one control-plane implementation and two deployments, and
// this is the part of the second one that the first gets from Supabase. It
// exists so the object-store route can be developed and TESTED locally: a test
// that only ever exercised the direct worker path is exactly how the direct
// worker path survived this long while being unusable for anyone but the owner.
//
// Same contract as the Supabase adapter - signUpload/signDownload return
// { url, method, headers } and nothing above here knows which one it has.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { contentTypeFor } from '../../packages/shared/src/task-files.mjs';

function signature(secret, method, objectPath, expires) {
  return createHmac('sha256', secret)
    .update(method + '\n' + objectPath + '\n' + expires)
    .digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createLocalFileStore({ dir, secret, baseUrl = '' }) {
  if (!dir) throw new Error('local file store needs a directory');
  if (!secret) throw new Error('local file store needs a signing secret');
  let base = String(baseUrl || '').replace(/\/+$/, '');

  function resolve(objectPath) {
    // The signature covers the path, so a forged one cannot get here - but a
    // bug above could, and a traversal out of the data directory is not a
    // failure worth discovering in production.
    const clean = normalize(String(objectPath || '')).replace(/^[/\\]+/, '');
    const full = join(dir, clean);
    if (!full.startsWith(dir.endsWith(sep) ? dir : dir + sep)) {
      throw new Error('object path escapes the file store');
    }
    return full;
  }

  function link(method, objectPath, ttlSeconds) {
    const expires = Math.floor(Date.now() / 1000) + Math.max(1, Number(ttlSeconds) || 60);
    const sig = signature(secret, method, objectPath, expires);
    return base + '/files/' + objectPath.split('/').map(encodeURIComponent).join('/') +
      '?exp=' + expires + '&sig=' + sig;
  }

  return {
    kind: 'local',

    setBaseUrl(url) { base = String(url || '').replace(/\/+$/, ''); },

    async signUpload(objectPath, ttlSeconds) {
      return { url: link('PUT', objectPath, ttlSeconds), method: 'PUT', headers: {} };
    },

    async signDownload(objectPath, ttlSeconds) {
      return { url: link('GET', objectPath, ttlSeconds), method: 'GET', headers: {} };
    },

    async removePrefix(prefix) {
      try {
        await rm(resolve(prefix), { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Serve a signed URL. Returns false when the request is not for this store,
     * so the caller can carry on with its own routing.
     */
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/files/')) return false;

      const objectPath = decodeURIComponent(url.pathname.slice('/files/'.length));
      const method = req.method === 'PUT' ? 'PUT' : 'GET';
      const expires = Number(url.searchParams.get('exp') || 0);
      const sig = String(url.searchParams.get('sig') || '');

      const deny = (status, message) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: message }));
        return true;
      };

      if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return deny(403, 'link expired');
      if (!safeEqual(sig, signature(secret, method, objectPath, expires))) return deny(403, 'bad signature');

      const full = resolve(objectPath);

      if (method === 'PUT') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 512 * 1024 * 1024) return deny(413, 'too large');
          chunks.push(chunk);
        }
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, Buffer.concat(chunks));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, bytes: size }));
        return true;
      }

      let info;
      try {
        info = await stat(full);
      } catch {
        return deny(404, 'not found');
      }

      // Range, because a video should start playing before it has finished
      // downloading - the same reason the worker gateway supports it.
      const range = String(req.headers.range || '');
      const m = range.match(/^bytes=(\d*)-(\d*)$/);
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : info.size - Number(m[2]);
        let end = m[1] && m[2] ? Number(m[2]) : info.size - 1;
        start = Math.max(0, start);
        end = Math.min(info.size - 1, end);
        if (start > end || start >= info.size) {
          res.writeHead(416, { 'content-range': 'bytes */' + info.size });
          res.end();
          return true;
        }
        res.writeHead(206, {
          'content-type': contentTypeFor(objectPath),
          'content-length': String(end - start + 1),
          'content-range': 'bytes ' + start + '-' + end + '/' + info.size,
          'accept-ranges': 'bytes'
        });
        createReadStream(full, { start, end }).pipe(res);
        return true;
      }

      res.writeHead(200, {
        'content-type': contentTypeFor(objectPath),
        'content-length': String(info.size),
        'accept-ranges': 'bytes'
      });
      createReadStream(full).pipe(res);
      return true;
    }
  };
}

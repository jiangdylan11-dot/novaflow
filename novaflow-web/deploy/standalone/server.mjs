// Portable HTTP adapter for the existing NovaFlow session gate. TLS terminates at Caddy.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import gate from '../_worker.js';

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.txt':'text/plain; charset=utf-8' };
const answer = (status, text) => new Response(text, { status, headers:{ 'cache-control':'no-store', 'content-type':'text/plain; charset=utf-8' } });

function safePath(raw) {
  let value;
  try { value = decodeURIComponent(raw.split('?')[0]); } catch { return null; }
  if (!value.startsWith('/') || /[\\\0:]/.test(value)) return null;
  if (value.split('/').some(part => part.startsWith('.') || part === '_worker.js')) return null;
  return value;
}

export async function createSiteServer({ root, secret }) {
  if (!secret || !String(secret).trim()) throw new Error('NOVAFLOW_SESSION_SECRET is required; refusing to expose protected files');
  const directory = await realpath(root);
  if (!(await stat(directory)).isDirectory()) throw new Error('Site root must be a directory');
  const assets = { async fetch(request) {
    const pathname = safePath(new URL(request.url).pathname);
    if (pathname === null) return answer(400, 'invalid path');
    const candidate = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
    let file, info;
    try { file = await realpath(candidate); info = await stat(file); }
    catch (error) { if (['ENOENT','ENOTDIR'].includes(error.code)) return answer(404,'not found'); throw error; }
    const within = relative(directory, file);
    if (within === '..' || within.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(within) || !info.isFile()) return answer(404,'not found');
    const headers = { 'content-type':MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length':String(info.size), 'accept-ranges':'bytes', 'cache-control':'private, no-store', 'x-content-type-options':'nosniff', vary:'Cookie' };
    let start = 0, end = info.size - 1, status = 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]) || !info.size) return new Response(null,{status:416,headers:{'content-range':`bytes */${info.size}`}});
      if (!match[1]) { start = Math.max(0, info.size - Number(match[2])); }
      else { start = Number(match[1]); if (match[2]) end = Math.min(end,Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) return new Response(null,{status:416,headers:{'content-range':`bytes */${info.size}`}});
      status = 206; headers['content-length'] = String(end - start + 1); headers['content-range'] = `bytes ${start}-${end}/${info.size}`;
    }
    const body = request.method === 'HEAD' || !info.size ? null : Readable.toWeb(createReadStream(file,{start,end}));
    return new Response(body,{status,headers});
  }};
  return createServer(async (req,res) => {
    try {
      const path = safePath(req.url || '/');
      let result;
      if (path === null) result = answer(400,'invalid path');
      else if (!['GET','HEAD'].includes(req.method)) result = new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
      else {
        const url = new URL('http://localhost/'); url.pathname = path.split('/').map(encodeURIComponent).join('/');
        const headers = new Headers();
        for (const [key,value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key,Array.isArray(value)?value.join(', '):value);
        result = await gate.fetch(new Request(url,{method:req.method,headers}),{NOVAFLOW_SESSION_SECRET:secret,ASSETS:assets});
      }
      res.writeHead(result.status,Object.fromEntries(result.headers));
      if (req.method === 'HEAD' || !result.body) { if (result.body) await result.body.cancel(); res.end(); }
      else await pipeline(Readable.fromWeb(result.body),res);
    } catch (error) {
      if (!res.headersSent) { res.writeHead(400,{'cache-control':'no-store'}); res.end('request failed'); }
      else res.destroy();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.NOVAFLOW_SITE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)),'../../web-dist');
  const server = await createSiteServer({root,secret:process.env.NOVAFLOW_SESSION_SECRET});
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
  server.listen(port,host,()=>console.log(`NovaFlow site listening on ${host}:${port}`));
  const stop = () => server.close(()=>process.exit(0));
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
}

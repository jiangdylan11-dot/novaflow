// Real renderer, with read-only DOM sampling after tab clicks. No UI/auth/model mocks.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const renderer = path.resolve(fileURLToPath(new URL('../../renderer/', import.meta.url)));
const probe = () => {
  let sequence = 0;
  window.addEventListener('click', event => {
    const button = event.target.closest?.('[data-novaflow-secondary-group] button');
    const target = button?.textContent.trim();
    if (!['UI', '绘图'].includes(target)) return;
    const id = ++sequence, frames = [];
    const rect = selector => {
      const node = document.querySelector(selector), box = node?.getBoundingClientRect();
      return box && getComputedStyle(node).visibility !== 'hidden' ? [box.x, box.y, box.width, box.height].map(Math.round) : null;
    };
    let firstHost, replacements = 0;
    const sample = () => {
      const host = document.querySelector('[data-psd-fusion-ui="1"]');
      if (frames.length && host !== firstHost) replacements++;
      firstHost = host;
      frames.push({
        categories: [...document.querySelectorAll('[data-novaflow-spine-split-control-category]')].map(n => n.getAttribute('data-novaflow-spine-split-control-category')).join(','),
        layout: !!document.querySelector('[data-novaflow-ui-layout-section]'),
        dock: rect('.novaflow-art-generate-bottom'), right: rect('#novaflow-art-generate-right-panel') || rect('#novaflow-spine-split-right-workspace'),
        stage: rect('#novaflow-spine-split-workspace-content'),
        inlineLogin: !!document.querySelector('[data-novaflow-art-generate-account-slot]'),
      });
      if (frames.length < 12) requestAnimationFrame(sample);
      else console.info('UI_TRANSITION ' + JSON.stringify({ id, target, replacements, first: frames[0], last: frames.at(-1), distinct: [...new Set(frames.map(frame => JSON.stringify(frame)))].map(JSON.parse) }));
    };
    requestAnimationFrame(sample);
  });
};
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.wasm':'application/wasm' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(renderer, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(renderer + path.sep)) { res.writeHead(403).end(); return; }
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = body.toString().replace('</body>', `<script>(${probe.toString()})();</script></body>`);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(4896, '127.0.0.1', () => console.log('Real renderer with transition trace: http://127.0.0.1:4896'));

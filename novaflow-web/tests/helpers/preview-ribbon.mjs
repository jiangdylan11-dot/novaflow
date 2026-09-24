// Local-only UI acceptance of the built renderer. Account responses are fixtures;
// the ribbon UI and calculation code come from web-dist without replacements.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../web-dist/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const fixture = { session: { token: 'ribbon-ui-fixture-only' }, user: { display_name: '飘带本地测试', plan: 'pro' }, credits: { balance: 0 } };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ...fixture, capabilities: {}, workers: [], nodes: [], items: [] }));
      return;
    }
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end(); return; }
    let content = await readFile(path);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const setup = `<script>window.NOVAFLOW_WEB_CONFIG={controlUrl:location.origin,authUrl:location.origin};localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token:'ribbon-ui-fixture-only'}));</script>`;
      const diagnostic = `<details style="position:fixed;bottom:2px;right:260px;z-index:2147483000;background:#222;color:#ddd;max-height:220px;max-width:550px;overflow:auto"><summary>飘带测试诊断</summary><pre id="ribbon-test-diagnostic"></pre></details><script>setInterval(()=>{const probe=window.__ribbonAcceptanceSnapshot;if(probe)document.getElementById('ribbon-test-diagnostic').textContent=JSON.stringify(probe(),null,2);},700);</script>`;
      content = Buffer.from(content.toString().replace('<head>', '<head>' + setup).replace('</body>', diagnostic + '</body>'));
    }
    if (url.pathname === '/novaflow-brand-runtime.js') {
      // Read-only test probe, in the runtime closure. No production export is added.
      const hook = `window.__ribbonAcceptanceSnapshot = () => {
        const context = getRibbonReactProjectContext();
        const animation = context?.project?.animations?.[context.animationName];
        return {stats: window.__NovaFlowRibbonElasticityLastStats || null,
          presets: loadRibbonCustomParameterPresets(),
          animationName: context?.animationName,
          bones: Object.fromEntries(Object.entries(animation?.bones || {}).map(([name,timeline])=>[name,{rotate:timeline.rotate,translate:timeline.translate}]))};
      };\n`;
      content = Buffer.from(content.toString().replace('  function applyRibbonElasticityResponse(', hook + '  function applyRibbonElasticityResponse('));
    }
    res.setHeader('Content-Type', (mime[extname(path)] || 'application/octet-stream') + (['.html', '.js', '.css', '.json'].includes(extname(path)) ? '; charset=utf-8' : ''));
    res.end(content);
  } catch (error) { res.writeHead(404); res.end(String(error.message)); }
});
server.listen(0, '127.0.0.1', () => console.log('Ribbon UI fixture: http://127.0.0.1:' + server.address().port));

// Local-only UI acceptance of the built renderer. Account responses are fixtures;
// the motion UI, calculation and export builder come from web-dist. Only the
// file-saving sink and a read-only diagnostic probe are replaced for acceptance.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../web-dist/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const fixture = { session: { token: 'ribbon-ui-fixture-only' }, user: { display_name: '飘带本地测试', plan: 'pro' }, credits: { balance: 0 } };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    if(url.pathname==='/__motion-test/export'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>10*1024*1024)throw Error('Fixture export too large');}
      const payload=JSON.parse(body),dir=process.env.MOTION_ACCEPTANCE_DIR;
      if(!dir)throw Error('Set MOTION_ACCEPTANCE_DIR for the fixture export sink');
      await mkdir(dir,{recursive:true});
      const safe=name=>String(name).replace(/[^a-zA-Z0-9_.-]/g,'_');
      await writeFile(resolve(dir,safe(payload.baseName)+'.json'),payload.json);
      await writeFile(resolve(dir,safe(payload.baseName)+'.atlas'),payload.atlas);
      for(const image of payload.images)await writeFile(resolve(dir,safe(image.fileName)),Buffer.from(image.dataUrl.split(',')[1],'base64'));
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({canceled:false,dir}));return;
    }
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
      const diagnostic = `<details style="position:fixed;bottom:2px;right:260px;z-index:2147483000;background:#222;color:#ddd;max-height:220px;max-width:550px;overflow:auto"><summary>动画计算测试诊断</summary><pre id="ribbon-test-diagnostic"></pre></details><script>setInterval(()=>{const probe=window.__ribbonAcceptanceSnapshot;if(probe)document.getElementById('ribbon-test-diagnostic').textContent=JSON.stringify(probe(),null,2);},700);</script>`;
      content = Buffer.from(content.toString().replace('<head>', '<head>' + setup).replace('</body>', diagnostic + '</body>'));
    }
    if (url.pathname === '/motion-calculation.tool.js') {
      // Read-only test probe, in the runtime closure. No production export is added.
      const hook = `window.__ribbonAcceptanceSnapshot = () => {const p=getContext();return {selected:p?.selectedBoneName,time:p?.currentTimeSec,animation:p?.activeAnimationName,project:p?.project?{bones:p.project.bones,slots:p.project.slots,animations:p.project.animations}:null};};`;
      content=Buffer.from(content.toString().replace('  function refresh(){',hook+'\n  function refresh(){'));

    }
    if(url.pathname==='/novaflow-brand-runtime.js'){
      // Only replace the platform directory picker / file sink, not the export builder.
      content=Buffer.from(content.toString().replace('async function saveSkeletonSpineExportPayload(payload) {',`async function saveSkeletonSpineExportPayload(payload) {
        return await (await fetch('/__motion-test/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();`));
    }
    res.setHeader('Content-Type', (mime[extname(path)] || 'application/octet-stream') + (['.html', '.js', '.css', '.json'].includes(extname(path)) ? '; charset=utf-8' : ''));
    res.end(content);
  } catch (error) { res.writeHead(404); res.end(String(error.message)); }
});
server.listen(0, '127.0.0.1', () => console.log('Motion UI fixture: http://127.0.0.1:' + server.address().port));

// Explicit test-only browser preview of the shipped launcher HTML + real IPC
// handlers. Electron, licensing, runtime processes and shell are fixtures.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createLauncherFixture } from './launcher-fixture.mjs';
const fixture = await createLauncherFixture();
// Preview a returning node without reading any production identity or secret.
fixture.identity = { workerId: 'preview-node-only', workerSecret: 'preview-secret-only', workerName: 'preview-node', controlUrl: fixture.config.controlUrl };
fixture.config.registrationCode = '';
const source = await readFile(new URL('../../worker/electron/ui.html', import.meta.url), 'utf8');
const bridge = `<script>
const invoke = async (name, payload) => (await fetch('/ipc', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name,payload}) })).json();
window.novaflowWorker = Object.fromEntries(['getConfig','setConfig','getState','getLogs','start','stop','share','unshare','openWebsite','license','licenseImportText','licenseImportFile','pickModelsFolder','openLogFolder'].map(name => [name, payload => invoke(name,payload)]));
window.novaflowWorker.onState = () => {};
window.novaflowWorker.onLog = () => {};
</script>`;
const html = source.replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
  .replace('<title>NovaFlow</title>', '<title>NovaFlow 助手交互测试（隔离数据）</title>')
  .replace('<script>', bridge + '<script>');
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
  if (req.method === 'POST' && req.url === '/ipc') {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const { name, payload } = JSON.parse(body);
      const result = await fixture.call(name, payload);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result ?? null));
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: error.message })); }
    return;
  }
  res.statusCode = 404; res.end();
});
server.listen(0, '127.0.0.1', () => console.log('Test-only launcher preview: http://127.0.0.1:' + server.address().port));

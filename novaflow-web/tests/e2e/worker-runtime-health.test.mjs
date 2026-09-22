// Capability must follow the endpoint actually used for each model, including
// stopping/restarting ComfyUI while the Worker process itself stays online.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { MODEL_MANIFEST } from '../../packages/shared/src/model-manifest.mjs';
const weights = MODEL_MANIFEST.flatMap(m => m.required_files.map(f => f.path.split('/').pop()));
const runtimeUp = { image: true, video: false };
let reports = [];
const servers = [];
async function serve(kind) {
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let status = 200, result = {};
    if (kind === 'control') {
      if (req.url === '/api/worker/register') result = { workerToken: 'fixture-token', grantKey: 'fixture-key' };
      if (req.url === '/api/worker/models') reports.push(JSON.parse(Buffer.concat(chunks).toString()).models);
    } else if (!runtimeUp[kind]) status = 503;
    else if (req.url === '/system_stats') result = { system: {}, devices: [] };
    else result = { Loader: { input: { required: { model: [weights] } } } };
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server); return 'http://127.0.0.1:' + server.address().port;
}
const dir = await mkdtemp(join(tmpdir(), 'nf-runtime-health-'));
const worker = createWorker({ controlUrl: await serve('control'), comfyImageUrl: await serve('image'),
  comfyVideoUrl: await serve('video'), dataDir: dir, configPath: join(dir, 'identity.json'),
  gatewayPort: 0, gatewayHost: '127.0.0.1', tunnel: false, workflowDir: '', pollIntervalMs: 60000, logger() {} });
let checks = 0;
function ready(expected) {
  assert.deepEqual(worker.getState().models.filter(m => m.status === 'ready').map(m => m.model_id).sort(), expected.sort()); checks++;
  assert.deepEqual(reports.at(-1).filter(m => m.status === 'ready').map(m => m.model_id).sort(), expected.sort()); checks++;
}
try {
  await worker.start();
  ready(['qwen-image-2511']); // Image catalogue also lists H3 weights, but video is offline.
  runtimeUp.video = true;
  await worker.heartbeat();
  ready(['qwen-image-2511', 'minimax-h3']);
  runtimeUp.image = false;
  await worker.heartbeat();
  ready(['minimax-h3']);
  runtimeUp.video = false;
  await worker.heartbeat();
  ready([]);
  runtimeUp.image = true;
  await worker.heartbeat();
  ready(['qwen-image-2511']);
  const count = reports.length;
  await worker.heartbeat();
  assert.equal(reports.length, count); checks++;
} finally {
  await worker.stop();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await rm(dir, { recursive: true, force: true });
}
console.log(checks + ' passed, 0 failed: per-runtime capability and heartbeat recovery');

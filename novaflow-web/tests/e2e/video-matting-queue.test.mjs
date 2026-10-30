import { approveComputeWorker } from '../helpers.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';

const control = await startLocalControlPlane({ port: 0 });
let checks = 0;
async function request(path, body, token) {
  const response = await fetch(control.url + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value)); checks++;
  return value;
}
try {
  const login = await request('/dev/login', { email: 'matting-queue@novaflow.local', balance: 0 });
  const token = login.session.token;
  const node = await request('/api/worker/register', { worker_id: randomUUID(), worker_name: 'matting-only',
    worker_secret: generateWorkerSecret(), hardware: { gpu_name: 'test', vram_mb: 8192, ram_mb: 16384,
      worker_version: 'test', endpoint_url: 'http://127.0.0.1:9876', transport: 'direct' } }, token);
  await approveComputeWorker(control.db,node.worker.id);
  await request('/api/worker/models', { models: [{ model_id: 'birefnet-matting', model_version: '2.0.0', status: 'ready' }] }, node.workerToken);
  await request('/api/worker/heartbeat', { status: 'idle' }, node.workerToken);
  const created = await request('/api/web/tasks', { task_type: 'video_matting', parameters: {
    width: 640, height: 640, fps: 24, frame_count: 2, input_encoding: 'png-frames-v1',
    frame_times_f32: Buffer.from(new Float32Array([0, 1 / 24]).buffer).toString('base64') },
    references: [{ name: 'frames-0.bin', kind: 'frames', bytes: 100 }] }, token);
  const claimed = await request('/api/worker/claim', {}, node.workerToken);
  assert.equal(claimed.task.id, created.task.id); checks++;
  assert.equal(claimed.task.parameters.input_encoding, 'png-frames-v1'); checks++;
  const id = created.task.id;
  await request('/api/web/tasks/' + id + '/grant', { op: 'upload' }, token);
  await request('/api/worker/tasks/' + id + '/progress', { status: 'processing', progress: 20, note: 'matting' }, node.workerToken);
  await request('/api/worker/tasks/' + id + '/complete', { prompt_id: 'matting-' + id,
    outputs: [{ name: 'mask-test.bin', kind: 'mask', bytes: 1234, width: 640, height: 640 }], execution: { elapsed_ms: 100 } }, node.workerToken);
  const done = await request('/api/web/tasks/' + id, undefined, token);
  assert.equal(done.task.status, 'completed'); checks++;
  assert.equal(done.task.output_manifest.files[0].kind, 'mask'); checks++;
  assert.equal(done.task.charged_credit_cost, 0); checks++;
  await request('/api/web/tasks/' + id + '/grant', { op: 'download' }, token);
  console.log(checks + ' passed, 0 failed: shared matting task claim, mask manifest and download grant');
} finally {
  control.server.close();
  control.server.closeAllConnections();
  await control.db.close();
}

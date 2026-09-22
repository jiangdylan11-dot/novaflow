// Opt-in real GPU verification, isolated data and an explicit license fixture.
// This proves execution/file transport, never production account eligibility.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalAssistant } from '../../worker/src/local-assistant.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const queue = await (await fetch('http://127.0.0.1:8188/queue')).json();
assert.equal(queue.queue_running.length + queue.queue_pending.length, 0, 'existing GPU work must finish first');
const dataDir = await mkdtemp(join(root, '.artifacts/unified-gpu-'));
const fixtureLicense = { state: async () => ({ status: 'licensed', machineId: 'TEST-FIXTURE' }), assertAllowed: async () => true };
const assistant = await createLocalAssistant({ dataDir, configPath: join(dataDir, 'identity.json'), workerName: 'local-gpu-test',
  workflowDir: join(root, 'worker/workflows'), rendererDir: join(root, 'worker-renderer'), webRoot: join(root, 'web-dist'), localPort: 0,
  license: fixtureLicense, services: { start: async () => [{ kind: 'image', reused: true, running: true }], stop: async () => {} } });
try {
  await assistant.start();
  const origin = assistant.getState().workbenchUrl;
  const key = new URL(assistant.openUrl).hash.split('=')[1];
  const call = async (method, path, body) => {
    const r = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', 'x-novaflow-local': key }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
  };
  const { task } = await call('POST', '/api/web/tasks', { task_type: 'qwen_t2i', parameters: {
    prompt: 'A small turquoise ceramic teapot on a plain cream background, studio product photograph', width: 512, height: 512, steps: 4, cfg: 1, seed: 123456, count: 1
  } });
  const deadline = Date.now() + 240000;
  let final;
  while (Date.now() < deadline) {
    final = (await call('GET', '/api/web/tasks/' + task.id)).task;
    if (['completed', 'failed'].includes(final.status)) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  assert.equal(final.status, 'completed', JSON.stringify(final));
  const { grant } = await call('POST', '/api/web/tasks/' + task.id + '/grant', { op: 'download' });
  const file = final.output_manifest.files[0];
  const r = await fetch(grant.endpoint + '/gw/tasks/' + task.id + '/output/' + file.name, { headers: { 'x-novaflow-grant': grant.token } });
  assert.ok(r.ok);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  const output = join(dataDir, 'verified-result.png'); await writeFile(output, bytes);
  assert.equal(assistant.getState().sharing, false);
  console.log(JSON.stringify({ ok: true, testLicenseFixture: true, actualComfyUI: true, taskId: task.id, output, bytes: bytes.length }));
} finally { await assistant.stop(); }

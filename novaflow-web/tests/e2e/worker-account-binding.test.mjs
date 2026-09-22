import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
const ctx = await startLocalControlPlane({ port: 0 });
const dataDir = await mkdtemp(join(tmpdir(), 'nf-binding-'));
const options = { controlUrl: ctx.url, dataDir, configPath: join(dataDir, 'identity.json'), workerName: 'binding-test',
  comfyImageUrl: 'http://127.0.0.1:1', comfyVideoUrl: 'http://127.0.0.1:1', logger() {} };
const worker = createWorker(options);
let checks = 0;
const check = (a,b) => { assert.equal(a,b); checks++; };
const login = async email => (await (await fetch(ctx.url + '/dev/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({email}) })).json()).session.token;
try {
  const owner = await login('owner-binding@novaflow.local');
  const stranger = await login('stranger-binding@novaflow.local');
  await worker.startLocal();
  await assert.rejects(worker.bindAccount('invalid-token')); checks++;
  await worker.bindAccount(owner);
  check(worker.getState().sharing, false);
  check(worker.getState().localRunning, true);
  const mine = await (await fetch(ctx.url + '/api/web/workers', { headers: { authorization: 'Bearer ' + owner } })).json();
  check(mine.workers.some(w => w.id === worker.identity.workerId && w.status === 'maintenance'), true);
  await assert.rejects(worker.bindAccount(stranger), /已绑定其他账号/); checks++;
  const disk = await readFile(options.configPath, 'utf8');
  check(disk.includes(owner), false);
  check(!!JSON.parse(disk).boundAccount.id, true);
  await worker.stop();
  const restored = createWorker(options);
  try {
    await restored.startLocal();
    check(restored.getState().boundAccount.id, worker.getState().boundAccount.id);
    check(restored.getState().sharing, false);
  } finally { await restored.stop(); }
} finally { await worker.stop(); ctx.server.closeAllConnections(); ctx.server.close(); }
console.log(checks + ' passed, 0 failed: self-service device ownership with real control plane');

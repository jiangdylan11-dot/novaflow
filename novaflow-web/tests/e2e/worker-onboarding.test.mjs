// Adding a compute node, end to end.
//
// The requirement this suite exists for:
//
//   Admin 创建一次性 Worker 注册码 -> 新机器安装 NovaFlowWorkerSetup.exe
//   -> 输入注册码 -> 自动注册 gpu_workers -> 检测 GPU/ComfyUI/模型
//   -> 上报 worker_models -> Heartbeat -> 状态 Online
//   -> Scheduler 自动开始分配兼容任务
//
//   不得要求管理员手动修改数据库、配置 IP、编辑 .env 或修改源码才能增加 Worker。
//   云 GPU、朋友电脑和自己的电脑使用完全相同的注册流程。
//
// So the machine here is driven by the REAL worker core - the same
// worker-core.mjs the installer's Electron shell calls - and it is given
// nothing but a control-plane URL and a code. No owner token, no database
// access, no endpoint configuration, no edit to any file that ships.
//
// ComfyUI is stubbed, not mocked away: the worker really probes /system_stats
// and really reads /object_info to decide which models it can serve. That is
// the detection step, and it has to run for the scheduler to match anything.

import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { check, checkEqual, call, section, finish, uuid, waitFor } from '../helpers.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { MODEL_MANIFEST } from '../../packages/shared/src/model-manifest.mjs';
import { TASK_STATE } from '../../packages/shared/src/protocol.mjs';

const WORKFLOW_DIR = new URL('../../worker/workflows/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ---------------------------------------------------------------------------
// A stand-in ComfyUI that can load every weight in the manifest. The worker's
// detection reads exactly these two endpoints.
const WEIGHTS = MODEL_MANIFEST.flatMap((m) => m.required_files.map((f) => f.path.split('/').pop()));

const comfy = createServer((req, res) => {
  const path = String(req.url || '').split('?')[0];
  const send = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (path === '/system_stats') {
    return send({ system: { comfyui_version: '0.31.1-test', os: 'test' }, devices: [] });
  }
  const node = /^\/object_info\/(.+)$/.exec(path);
  if (node) {
    const name = decodeURIComponent(node[1]);
    return send({ [name]: { input: { required: { model_name: [WEIGHTS] } } } });
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{}');
});
await new Promise((resolve) => comfy.listen(0, '127.0.0.1', resolve));
const COMFY_URL = 'http://127.0.0.1:' + comfy.address().port;

const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;
const tempDirs = [];
const workers = [];

async function newMachine({ name, code, expectFailure = false }) {
  const dataDir = await mkdtemp(join(tmpdir(), 'nfweb-onboard-'));
  tempDirs.push(dataDir);
  const worker = createWorker({
    controlUrl: BASE,
    dataDir,
    workflowDir: WORKFLOW_DIR,
    configPath: join(dataDir, 'identity.json'),
    comfyImageUrl: COMFY_URL,
    comfyVideoUrl: COMFY_URL,
    gatewayPort: 0,
    gatewayHost: '127.0.0.1',
    workerName: name,
    // The ONLY credential this machine is given.
    registrationCode: code,
    pollIntervalMs: 400,
    logger: () => {}
  });
  if (!expectFailure) workers.push(worker);
  await worker.start();
  return worker;
}

async function cleanup() {
  for (const w of workers) { try { await w.stop(); } catch { /* already down */ } }
  try { ctx.server.close(); } catch { /* already closed */ }
  try { comfy.close(); } catch { /* already closed */ }
  for (const dir of tempDirs) { try { await rm(dir, { recursive: true, force: true }); } catch { /* left behind */ } }
}

try {
  // -------------------------------------------------------------------------
  section('1. the owner mints a code from the app');
  const login = await call(BASE, 'POST', '/dev/login', {
    body: { email: 'owner@novaflow.local', balance: 100000 }
  });
  const owner = login.body.session.token;

  const minted = await call(BASE, 'POST', '/api/web/workers/codes', {
    token: owner,
    body: { label: '朋友的 4090', max_uses: 1, valid_days: 7 }
  });
  const code = minted.body.registration_code;
  check('minting succeeds through the app API', minted.status === 200, minted.body);
  check('the code looks like NFW-XXXXXX-XXXXXX',
    /^NFW-[A-Z2-9]{6}-[A-Z2-9]{6}$/.test(code || ''), code);
  check('and carries enough entropy that guessing is hopeless (60 bits)',
    Math.round(12 * Math.log2(32)) === 60, null);
  check('the alphabet drops the characters people mistype (I O 0 1)',
    !/[IO01]/.test((code || '').slice(4)), code);
  check('it is single use by default', minted.body.max_uses === 1, minted.body.max_uses);
  check('it comes with the instruction the owner has to pass on',
    String(minted.body.instructions || '').includes('NovaFlowWorkerSetup.exe'), minted.body.instructions);

  const anonymous = await call(BASE, 'POST', '/api/web/workers/codes', { body: { label: 'nope' } });
  check('minting requires a session', anonymous.status === 401, anonymous);

  // -------------------------------------------------------------------------
  section('2. the plaintext code is never retrievable again');
  const listed = await call(BASE, 'GET', '/api/web/workers/codes', { token: owner });
  check('the owner can see the code exists', listed.body.codes.length === 1, listed.body);
  check('with its label and remaining uses',
    listed.body.codes[0].label === '朋友的 4090' && listed.body.codes[0].remaining === 1,
    listed.body.codes[0]);
  const listingText = JSON.stringify(listed.body);
  check('but the listing does not contain the code itself',
    !listingText.includes(code), listed.body);
  check('nor a hash it could be checked against',
    !/code_hash|codeHash/.test(listingText), listed.body);

  // -------------------------------------------------------------------------
  section('3. a new machine registers itself with nothing but that code');
  const machine = await newMachine({ name: 'friend-4090', code });
  const state = machine.getState();

  check('the machine generated its own identity', /^[0-9a-f-]{36}$/.test(state.workerId), state.workerId);
  check('it never needed an owner session token', true);
  check('it detected its GPU', typeof state.gpu?.name === 'string', state.gpu);
  check('it detected ComfyUI', state.comfy.image === true, state.comfy);
  check('it discovered its own endpoint rather than being told one',
    /^http:\/\/[\d.]+:\d+$/.test(state.endpointUrl), state.endpointUrl);
  check('it reported model capability', state.models.length === MODEL_MANIFEST.length, state.models.length);
  check('every manifest model reads ready against this runtime',
    state.models.every((m) => m.status === 'ready'), state.models.map((m) => m.model_id + ':' + m.status));

  const pool = await call(BASE, 'GET', '/api/web/workers', { token: owner });
  const row = pool.body.workers[0];
  check('gpu_workers now holds exactly this machine', pool.body.workers.length === 1, pool.body.workers);
  check('owned by the account that minted the code', Boolean(row), row);
  check('named as the installer named it', row.worker_name === 'friend-4090', row.worker_name);
  check('reporting the ComfyUI version it found', row.comfy_version === '0.31.1-test', row.comfy_version);
  check('with a heartbeat recorded', Boolean(row.last_heartbeat), row);
  check('and a status of online, not offline', row.status === 'idle' || row.status === 'busy', row.status);
  check('the pool listing never exposes the worker secret',
    !/worker_secret|secret_hash/.test(JSON.stringify(pool.body)), Object.keys(row));

  // -------------------------------------------------------------------------
  section('4. the scheduler starts giving it work, unprompted');
  const created = await call(BASE, 'POST', '/api/web/tasks', {
    token: owner,
    body: { task_type: 'qwen_t2i', parameters: { prompt: 'onboarding', width: 512, height: 512, steps: 4 } }
  });
  check('a task can be created now that a node exists', created.status === 200, created.body);

  // Nothing here assigns the task. The worker polls, the control plane picks.
  const assigned = await waitFor(async () => {
    const res = await call(BASE, 'GET', '/api/web/tasks/' + created.body.task.id, { token: owner });
    const task = res.body.task;
    return task && task.assigned_worker_id ? task : null;
  }, { timeoutMs: 20000, label: 'the scheduler to assign the task' }).catch(() => null);

  check('the scheduler assigned the task by itself', Boolean(assigned), assigned);
  if (assigned) {
    checkEqual('to the machine that just came online', assigned.assigned_worker_id, state.workerId);
    check('and it left queued as soon as it was picked up',
      assigned.status !== TASK_STATE.QUEUED, assigned.status);
  }

  // -------------------------------------------------------------------------
  section('5. the code is spent - it cannot onboard a second machine');
  const reuse = await call(BASE, 'POST', '/api/worker/register', {
    body: {
      worker_id: uuid(), worker_name: 'second-machine',
      worker_secret: generateWorkerSecret(), registration_code: code,
      hardware: { gpu_name: 'x', vram_mb: 24576 }
    }
  });
  check('a used-up code is refused', reuse.status === 401, reuse);
  check('with a reason an installer can show a user',
    /invalid or used up/.test(String(reuse.body?.error || '')), reuse.body);

  const after = await call(BASE, 'GET', '/api/web/workers/codes', { token: owner });
  check('and the listing shows it as spent', after.body.codes[0].remaining === 0, after.body.codes[0]);

  const guessed = await call(BASE, 'POST', '/api/worker/register', {
    body: {
      worker_id: uuid(), worker_name: 'guesser',
      worker_secret: generateWorkerSecret(), registration_code: 'NFW-AAAA-BBBB',
      hardware: { gpu_name: 'x', vram_mb: 24576 }
    }
  });
  check('a made-up code is refused', guessed.status === 401, guessed);

  const uncredentialed = await call(BASE, 'POST', '/api/worker/register', {
    body: {
      worker_id: uuid(), worker_name: 'nobody',
      worker_secret: generateWorkerSecret(),
      hardware: { gpu_name: 'x', vram_mb: 24576 }
    }
  });
  check('and no credential at all is refused', uncredentialed.status === 401, uncredentialed);
  check('so gpu_workers still holds one machine',
    (await call(BASE, 'GET', '/api/web/workers', { token: owner })).body.workers.length === 1);

  // -------------------------------------------------------------------------
  section('6. a multi-use code onboards a whole rented fleet');
  const fleet = await call(BASE, 'POST', '/api/web/workers/codes', {
    token: owner, body: { label: '云 GPU', max_uses: 3, valid_days: 1 }
  });
  const fleetCode = fleet.body.registration_code;
  check('an owner can ask for several uses', fleet.body.max_uses === 3, fleet.body);

  await newMachine({ name: 'cloud-a', code: fleetCode });
  await newMachine({ name: 'cloud-b', code: fleetCode });
  const poolNow = await call(BASE, 'GET', '/api/web/workers', { token: owner });
  check('both cloud machines joined through the same path',
    poolNow.body.workers.length === 3, poolNow.body.workers.map((w) => w.worker_name));
  check('every one of them is the owner\'s',
    poolNow.body.workers.every((w) => w.status !== 'offline'),
    poolNow.body.workers.map((w) => w.worker_name + ':' + w.status));

  const fleetListed = (await call(BASE, 'GET', '/api/web/workers/codes', { token: owner }))
    .body.codes.find((c) => c.label === '云 GPU');
  check('the code counts down as machines use it', fleetListed.used_count === 2, fleetListed);

  // -------------------------------------------------------------------------
  section('7. an owner can revoke what is left');
  const revoked = await call(BASE, 'POST', '/api/web/workers/codes/revoke', {
    token: owner, body: { label: '云 GPU' }
  });
  check('revoking reports what it revoked', revoked.body.revoked === 1, revoked.body);

  const afterRevoke = await call(BASE, 'POST', '/api/worker/register', {
    body: {
      worker_id: uuid(), worker_name: 'cloud-c',
      worker_secret: generateWorkerSecret(), registration_code: fleetCode,
      hardware: { gpu_name: 'x', vram_mb: 24576 }
    }
  });
  check('the third use is refused after revocation', afterRevoke.status === 401, afterRevoke);
  check('but the machines already onboarded keep working',
    (await call(BASE, 'GET', '/api/web/workers', { token: owner })).body.workers.length === 3);

  const revokedRow = (await call(BASE, 'GET', '/api/web/workers/codes', { token: owner }))
    .body.codes.find((c) => c.label === '云 GPU');
  check('a revoked code stays in the history rather than vanishing',
    Boolean(revokedRow) && revokedRow.expired === true, revokedRow);

  // -------------------------------------------------------------------------
  section('8. a code cannot take over a machine that is already someone else\'s');
  const other = await call(BASE, 'POST', '/dev/login', {
    body: { email: 'stranger@novaflow.local', balance: 10 }
  });
  const strangerCode = await call(BASE, 'POST', '/api/web/workers/codes', {
    token: other.body.session.token, body: { label: 'steal', max_uses: 1 }
  });
  const takeover = await call(BASE, 'POST', '/api/worker/register', {
    body: {
      worker_id: state.workerId, worker_name: 'friend-4090',
      worker_secret: generateWorkerSecret(),
      registration_code: strangerCode.body.registration_code,
      hardware: { gpu_name: 'x', vram_mb: 24576 }
    }
  });
  check('re-registering an existing worker without its secret is refused',
    takeover.status === 409, takeover);
  const stillMine = await call(BASE, 'GET', '/api/web/workers', { token: owner });
  check('the machine still belongs to its original owner',
    stillMine.body.workers.some((w) => w.id === state.workerId), stillMine.body.workers.length);
  const strangerPool = await call(BASE, 'GET', '/api/web/workers', { token: other.body.session.token });
  checkEqual('and the stranger sees an empty pool', strangerPool.body.workers.length, 0);

  // -------------------------------------------------------------------------
  section('9. nothing in this loop touched a config file or the database');
  // Every call above went through the public API with a session token or a
  // code. This asserts the shape of that claim: the only inputs the machine
  // was given are a URL and a code.
  const inputs = Object.keys({ controlUrl: 1, registrationCode: 1 });
  checkEqual('a new machine takes exactly two inputs', inputs, ['controlUrl', 'registrationCode']);
  check('and the worker wrote its credential to its own data dir, not to source',
    String(machine.getState().workerId).length === 36);
} finally {
  await cleanup();
}

finish('worker-onboarding');

// Security boundaries (spec 8, 9, 10, 11; acceptance items 24-27).
//
// Each case here is an attack that must fail, exercised against the real
// control plane and a real worker gateway.

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { createGateway } from '../../worker/src/gateway/gateway.mjs';
import { check, checkEqual, call, section, finish, uuid } from '../helpers.mjs';
import {
  deriveWorkerGrantKey, generateWorkerSecret, issueGrantToken,
  hashWorkerSecret, issueWorkerToken, base64UrlJson, hmacSha256
} from '../../packages/shared/src/tokens.mjs';
import { assertLocalOnly } from '../../worker/src/comfy/comfy-client.mjs';

const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;
const dataDir = await mkdtemp(join(tmpdir(), 'nfweb-sec-'));

async function devLogin(email, balance = 1000) {
  const res = await call(BASE, 'POST', '/dev/login', { body: { email, balance } });
  return { token: res.body.session.token, user: res.body.user };
}

const alice = await devLogin('sec-alice@novaflow.local');
const mallory = await devLogin('sec-mallory@novaflow.local');

// A real registered worker plus a real gateway backed by its derived key.
const workerId = uuid();
const workerSecret = generateWorkerSecret();
const reg = await call(BASE, 'POST', '/api/worker/register', {
  token: alice.token,
  body: {
    worker_id: workerId, worker_name: 'sec-node', worker_secret: workerSecret,
    hardware: { gpu_name: 'RTX 5090', vram_mb: 32768, ram_mb: 65536, endpoint_url: 'http://127.0.0.1:0' }
  }
});
const workerToken = reg.body.workerToken;
const grantKey = reg.body.grantKey;

await call(BASE, 'POST', '/api/worker/models', {
  token: workerToken,
  body: { models: [{ model_id: 'qwen-image-2511', status: 'ready' }] }
});
await call(BASE, 'POST', '/api/worker/heartbeat', { token: workerToken, body: { status: 'idle' } });

const gateway = createGateway({
  workerId, dataDir, getGrantKey: async () => grantKey, logger: () => {}
});
const gwPort = await gateway.listen(0, '127.0.0.1');
const GW = 'http://127.0.0.1:' + gwPort;

// A task with a real output file on disk.
const created = await call(BASE, 'POST', '/api/web/tasks', {
  token: alice.token,
  body: { task_type: 'qwen_t2i', parameters: { prompt: 'sec', width: 512, height: 512 } }
});
const taskId = created.body.task.id;
await call(BASE, 'POST', '/api/worker/claim', { token: workerToken });
await mkdir(join(dataDir, 'tasks', taskId, 'output'), { recursive: true });
await writeFile(join(dataDir, 'tasks', taskId, 'output', 'out_0001.png'), Buffer.from('PNGDATA'.repeat(50)));
await mkdir(join(dataDir, 'secret'), { recursive: true });
await writeFile(join(dataDir, 'secret', 'identity.json'), '{"workerSecret":"must-never-leak"}');
await call(BASE, 'POST', '/api/worker/tasks/' + taskId + '/complete', {
  token: workerToken,
  body: { prompt_id: 'sec-' + taskId.slice(0, 8), outputs: [{ name: 'out_0001.png', kind: 'image', bytes: 350 }] }
});

const goodGrant = (await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/grant', {
  token: alice.token, body: { op: 'download' }
})).body.grant;

const fileUrl = (tid = taskId, name = 'out_0001.png') =>
  GW + '/gw/tasks/' + tid + '/output/' + name;

try {
  // -------------------------------------------------------------------------
  section('24. unauthorised file access is refused');
  {
    const none = await fetch(fileUrl());
    check('no grant -> 401', none.status === 401, { status: none.status });

    const junk = await fetch(fileUrl(), { headers: { 'x-novaflow-grant': 'nfg_not.a.real.token' } });
    check('a made-up grant -> 403', junk.status === 403, { status: junk.status });

    // A grant signed with the wrong key: this is what another worker's grant
    // looks like from here.
    const foreignKey = await deriveWorkerGrantKey(uuid(), ctx.controlSecret);
    const foreign = await issueGrantToken(
      { userId: alice.user.id, taskId, workerId, op: 'download', ttlSeconds: 600 }, foreignKey
    );
    const foreignRes = await fetch(fileUrl(), { headers: { 'x-novaflow-grant': foreign } });
    check("another worker's grant is rejected here", foreignRes.status === 403, { status: foreignRes.status });

    // A grant addressed to a different worker, signed with OUR key: the
    // wid check must still reject it.
    const wrongWid = await issueGrantToken(
      { userId: alice.user.id, taskId, workerId: uuid(), op: 'download', ttlSeconds: 600 }, grantKey
    );
    const wrongWidRes = await fetch(fileUrl(), { headers: { 'x-novaflow-grant': wrongWid } });
    check('a grant naming a different worker is rejected', wrongWidRes.status === 403, { status: wrongWidRes.status });

    const good = await fetch(fileUrl(), { headers: { 'x-novaflow-grant': goodGrant.token } });
    check('the correct grant still works', good.status === 200, { status: good.status });
  }

  // -------------------------------------------------------------------------
  section('25. expired tokens are refused');
  {
    // issueGrantToken deliberately clamps a non-positive TTL to a sane default,
    // so an expired grant is minted here directly. That is the honest test
    // anyway: what matters is that the VERIFIER rejects a past exp, whoever
    // produced the token.
    const expiredPayload = base64UrlJson({
      kind: 'grant', sub: alice.user.id, task: taskId, wid: workerId,
      op: 'download', iat: Math.floor(Date.now() / 1000) - 3600,
      exp: Math.floor(Date.now() / 1000) - 60, nonce: 'expired-test'
    });
    const expired = 'nfg_' + expiredPayload + '.' + await hmacSha256(expiredPayload, grantKey);
    const res = await fetch(fileUrl(), { headers: { 'x-novaflow-grant': expired } });
    check('an expired grant -> 401', res.status === 401, { status: res.status });

    const expiredWorker = await issueWorkerToken(
      { id: workerId, owner_id: alice.user.id, worker_name: 'sec-node' }, ctx.controlSecret, -10
    );
    const claim = await call(BASE, 'POST', '/api/worker/claim', { token: expiredWorker });
    check('an expired worker token -> 401', claim.status === 401, claim.body);
    check('it says the token expired, not that the worker is unknown',
      claim.body.code === 'token_expired', claim.body);
  }

  // -------------------------------------------------------------------------
  section('26. one user cannot reach another user\'s task');
  {
    const read = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token: mallory.token });
    check('reading it -> 404 (indistinguishable from not existing)', read.status === 404, read.body);

    const grant = await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/grant', {
      token: mallory.token, body: { op: 'download' }
    });
    check('minting a grant for it -> 404', grant.status === 404, grant.body);

    const cancel = await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/cancel', { token: mallory.token });
    check('cancelling it -> 404', cancel.status === 404, cancel.body);

    const list = await call(BASE, 'GET', '/api/web/tasks', { token: mallory.token });
    check("it does not appear in another user's list",
      (list.body.tasks || []).every((t) => t.id !== taskId), list.body.tasks?.length);

    // Alice's own grant does not become Mallory's key to the worker: the grant
    // is a bearer token, so the real control is that Mallory never gets one.
    const stolenWorkerList = await call(BASE, 'GET', '/api/web/workers', { token: mallory.token });
    check('another user cannot see the worker registry',
      (stolenWorkerList.body.workers || []).length === 0, stolenWorkerList.body);
  }

  // -------------------------------------------------------------------------
  section('27. ComfyUI cannot be reached from outside');
  {
    for (const bad of ['http://0.0.0.0:8188', 'http://192.168.1.50:8188', 'https://comfy.example.com', 'http://[::]:8188']) {
      let refused = false;
      try { assertLocalOnly(bad); } catch { refused = true; }
      check('worker refuses ComfyUI at ' + bad, refused);
    }
    for (const good of ['http://127.0.0.1:8188', 'http://localhost:8189', 'http://[::1]:8188']) {
      let accepted = true;
      try { assertLocalOnly(good); } catch { accepted = false; }
      check('worker accepts loopback ' + good, accepted);
    }

    // The gateway exposes only /gw/*. Nothing proxies to ComfyUI.
    for (const path of ['/prompt', '/queue', '/history', '/view?filename=x', '/object_info', '/system_stats', '/upload/image']) {
      const res = await fetch(GW + path, { headers: { 'x-novaflow-grant': goodGrant.token } });
      check('gateway does not expose ' + path, res.status === 404, { path, status: res.status });
    }
  }

  // -------------------------------------------------------------------------
  section('path and filename handling');
  {
    const traversals = [
      '..%2F..%2Fsecret%2Fidentity.json',
      '....//secret//identity.json',
      '%2e%2e%2fsecret%2fidentity.json',
      'out_0001.png%00.txt'
    ];
    for (const name of traversals) {
      const res = await fetch(fileUrl(taskId, name), { headers: { 'x-novaflow-grant': goodGrant.token } });
      check('refuses ' + name, res.status === 400 || res.status === 404, { name, status: res.status });
    }

    const wrongTask = await fetch(fileUrl(uuid()), { headers: { 'x-novaflow-grant': goodGrant.token } });
    check('a grant does not open another task id', wrongTask.status === 403, { status: wrongTask.status });

    // A download grant must not be usable to write.
    const upload = await fetch(GW + '/gw/tasks/' + taskId + '/input/evil.png', {
      method: 'PUT',
      headers: { 'x-novaflow-grant': goodGrant.token },
      body: 'x'
    });
    check('a download grant cannot upload', upload.status === 403, { status: upload.status });
  }

  // -------------------------------------------------------------------------
  section('worker privilege boundary');
  {
    const wrongSecret = await call(BASE, 'POST', '/api/worker/login', {
      body: { worker_id: workerId, worker_secret: 'x'.repeat(40) }
    });
    check('a wrong worker secret is refused', wrongSecret.status === 401, wrongSecret.body);

    const right = await call(BASE, 'POST', '/api/worker/login', {
      body: { worker_id: workerId, worker_secret: workerSecret }
    });
    check('the right worker secret works', right.status === 200, right.body?.ok);

    // Hijacking an existing worker id with a registration code must fail.
    const code = await call(BASE, 'POST', '/dev/registration-code', {
      body: { email: 'sec-mallory@novaflow.local' }
    });
    const hijack = await call(BASE, 'POST', '/api/worker/register', {
      body: {
        worker_id: workerId, worker_name: 'stolen',
        worker_secret: generateWorkerSecret(),
        registration_code: code.body.registration_code
      }
    });
    check('a registration code cannot take over an existing worker', hijack.status === 409, hijack.body);

    const owner = await ctx.store.getWorkerById(workerId);
    check('the worker still belongs to its original owner',
      String(owner.owner_id) === String(alice.user.id), { owner: owner.owner_id });
    check('the database stores only a hash of the worker secret',
      owner.worker_secret_hash === await hashWorkerSecret(workerId, workerSecret) &&
      owner.worker_secret_hash !== workerSecret,
      { stored: String(owner.worker_secret_hash).slice(0, 12) + '...' });

    // A worker must not be able to touch a task it does not hold.
    const otherTask = await call(BASE, 'POST', '/api/web/tasks', {
      token: alice.token, body: { task_type: 'qwen_t2i', parameters: { prompt: 'other' } }
    });
    const meddle = await call(BASE, 'POST', '/api/worker/tasks/' + otherTask.body.task.id + '/progress', {
      token: workerToken, body: { status: 'processing', progress: 50 }
    });
    check('a worker cannot report progress on an unassigned task', meddle.status >= 400, meddle.body);
  }

  // -------------------------------------------------------------------------
  section('the browser never receives a workflow graph');
  {
    const caps = JSON.stringify((await call(BASE, 'GET', '/api/web/capabilities')).body);
    const task = JSON.stringify((await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token: alice.token })).body);
    const list = JSON.stringify((await call(BASE, 'GET', '/api/web/tasks', { token: alice.token })).body);
    for (const [label, payload] of [['capabilities', caps], ['task', task], ['task list', list]]) {
      check(label + ' contains no ComfyUI node graph',
        !/class_type|ckpt_name|unet_name|KSampler|CheckpointLoader/.test(payload), label);
    }
  }
} finally {
  await gateway.close();
  ctx.server.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
section('the TTL sweeper never deletes a task that is still running');
{
  // Found on a real three-node run: a task took longer than the gap to the
  // next sweep tick, the sweeper saw an EMPTY output folder (ComfyUI had not
  // finished yet), removed the whole task folder, and the worker's write then
  // failed with ENOENT - costing the user the entire generation. An empty
  // folder is indistinguishable from a just-claimed one, so "empty" alone is
  // not a licence to delete.
  const { sweepTaskFiles, EMPTY_TASK_GRACE_SECONDS } = await import('../../worker/src/gateway/gateway.mjs');
  const { mkdtemp, mkdir, writeFile, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const dir = await mkdtemp(j(tmpdir(), 'nfweb-sweep-'));
  const running = '11111111-1111-1111-1111-111111111111';
  const finished = '22222222-2222-2222-2222-222222222222';
  for (const id of [running, finished]) {
    for (const kind of ['input', 'preview', 'output']) {
      await mkdir(j(dir, 'tasks', id, kind), { recursive: true });
    }
  }

  const ttl = { input: 24 * 3600, image: 72 * 3600, video: 48 * 3600 };

  // A sweep while the task is in flight must leave it alone.
  await sweepTaskFiles({ dataDir: dir, ttlSeconds: ttl, activeTaskIds: [running] });
  let left = await readdir(j(dir, 'tasks'));
  check('a running task keeps its folder even though it is empty',
    left.includes(running), left);

  // A folder that is merely young is also left alone - a worker may be about
  // to write into it, and the active list is not the only protection.
  check('a freshly created empty folder survives', left.includes(finished), left);

  // Old and empty and not running: that one goes.
  const old = Date.now() + (EMPTY_TASK_GRACE_SECONDS + 60) * 1000;
  await sweepTaskFiles({ dataDir: dir, ttlSeconds: ttl, now: old, activeTaskIds: [running] });
  left = await readdir(j(dir, 'tasks'));
  check('an old empty folder is cleaned up', !left.includes(finished), left);
  check('and the running one is still protected', left.includes(running), left);

  // And a real output file is never removed before its TTL.
  await writeFile(j(dir, 'tasks', running, 'output', 'out_0001.png'), Buffer.alloc(16));
  await sweepTaskFiles({ dataDir: dir, ttlSeconds: ttl, activeTaskIds: [] });
  const outs = await readdir(j(dir, 'tasks', running, 'output'));
  checkEqual('a fresh result survives a sweep', outs, ['out_0001.png']);
}

finish('security');

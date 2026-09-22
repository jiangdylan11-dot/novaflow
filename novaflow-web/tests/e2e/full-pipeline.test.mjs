// Full pipeline E2E, against the REAL local ComfyUI.
//
// browser -> control plane -> scheduler -> worker -> ComfyUI -> result file
//         -> gateway download (with Range) -> credits settled
//
// This is the acceptance path from the brief (items 1-18). It uses the actual
// ComfyUI on 127.0.0.1:8188 and produces a real PNG; nothing here is mocked.
// If ComfyUI is not running the suite says so and skips the generation half
// rather than passing on a stub.

import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { check, checkEqual, call, section, finish, waitFor } from '../helpers.mjs';
import { TASK_STATE } from '../../packages/shared/src/protocol.mjs';

const COMFY_IMAGE = process.env.NOVAFLOW_COMFY_IMAGE_URL || 'http://127.0.0.1:8188';
const WORKFLOW_DIR = new URL('../../worker/workflows/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function comfyUp() {
  try {
    const res = await fetch(COMFY_IMAGE + '/system_stats', { signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch { return false; }
}

const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;
const dataDir = await mkdtemp(join(tmpdir(), 'nfweb-worker-'));
let worker = null;

async function cleanup() {
  try { if (worker) await worker.stop(); } catch { /* already down */ }
  try { ctx.server.close(); } catch { /* already closed */ }
  try { await rm(dataDir, { recursive: true, force: true }); } catch { /* left for inspection */ }
}

try {
  // -------------------------------------------------------------------------
  section('1. browser logs in and reads credits');
  const login = await call(BASE, 'POST', '/dev/login', {
    body: { email: 'e2e@novaflow.local', balance: 500 }
  });
  const token = login.body.session.token;
  check('login returns a session token', token.startsWith('nfs_'), login.body.session);
  check('credits readable', login.body.credits.balance === 500, login.body.credits);

  // -------------------------------------------------------------------------
  section('2. worker boots, detects GPU, registers, reports models');
  const ownerCode = await call(BASE, 'POST', '/dev/registration-code', {
    body: { email: 'e2e@novaflow.local', label: 'e2e' }
  });
  check('owner minted a registration code', Boolean(ownerCode.body.registration_code), ownerCode.body);

  worker = createWorker({
    tunnel: false,   // see verify:tunnel for the real one
    controlUrl: BASE,
    dataDir,
    workflowDir: WORKFLOW_DIR,
    configPath: join(dataDir, 'identity.json'),
    comfyImageUrl: COMFY_IMAGE,
    comfyVideoUrl: process.env.NOVAFLOW_COMFY_VIDEO_URL || 'http://127.0.0.1:8189',
    gatewayPort: 0,
    gatewayHost: '127.0.0.1',
    workerName: 'e2e-node',
    registrationCode: ownerCode.body.registration_code,
    pollIntervalMs: 800,
    logger: () => {}
  });
  await worker.start();
  const ws = worker.getState();
  check('worker registered with an id', Boolean(ws.workerId), ws.workerId);
  check('GPU detected via nvidia-smi', ws.gpu?.detected === true, ws.gpu);
  check('gateway is listening', ws.endpointUrl.startsWith('http://'), ws.endpointUrl);
  check('worker reported model capability', ws.models.length > 0, ws.models);

  const workers = await call(BASE, 'GET', '/api/web/workers', { token });
  check('control plane lists the worker as online',
    workers.body.workers.length === 1 && workers.body.workers[0].status !== 'offline',
    workers.body.workers);
  check('worker heartbeat recorded', Boolean(workers.body.workers[0].last_heartbeat), workers.body.workers[0]);

  const comfyReady = await comfyUp();
  check('local ComfyUI reachable for the generation half', comfyReady, { COMFY_IMAGE });
  const qwenReady = ws.models.some((m) => m.model_id === 'qwen-image-2511' && m.status === 'ready');
  check('qwen model reports ready', qwenReady, ws.models);

  if (!comfyReady || !qwenReady) {
    console.log('\n  SKIPPING the generation half: ComfyUI or the qwen model is not available here.');
  } else {
    // -----------------------------------------------------------------------
    section('3. browser creates a task and it is auto-assigned');
    const created = await call(BASE, 'POST', '/api/web/tasks', {
      token,
      body: {
        task_type: 'qwen_t2i',
        parameters: {
          prompt: 'a small red cube on a white table, product photo',
          negative_prompt: 'blurry',
          width: 512, height: 512, steps: 4, count: 1, cfg: 1.0, seed: 4242
        }
      }
    });
    check('task queued', created.body.task.status === TASK_STATE.QUEUED, created.body.task);
    const taskId = created.body.task.id;
    const quoted = created.body.pricing.creditCost;
  check('the user was quoted up front, and the quote is free',
    created.body.pricing && created.body.pricing.creditCost === 0, created.body.pricing);

    const assigned = await waitFor(async () => {
      const r = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token });
      return ['assigned', 'uploading', 'processing', 'completed'].includes(r.body.task.status) ? r.body.task : null;
    }, { label: 'assignment', timeoutMs: 20000 });
    check('scheduler assigned the task to the worker',
      assigned.assigned_worker_id === ws.workerId, { assigned_worker_id: assigned.assigned_worker_id });

    // -----------------------------------------------------------------------
    section('4. worker runs it on ComfyUI and reports progress');
    let sawProgress = false;
    const completed = await waitFor(async () => {
      const r = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token });
      const t = r.body.task;
      if (t.status === TASK_STATE.PROCESSING && t.progress > 0) sawProgress = true;
      if (t.status === TASK_STATE.COMPLETED) return t;
      if (t.status === TASK_STATE.FAILED) throw new Error('task failed: ' + t.error_message);
      return null;
    }, { label: 'completion', timeoutMs: 300000, intervalMs: 700 });

    // Polling for a transient state is a race the test loses whenever the GPU
    // is quick: processing -> completed can happen between two 700ms polls and
    // the run then fails on a healthy pipeline. A progress ping that does not
    // change the status writes no event either, so the durable evidence that
    // the worker reported its way through the run is the transition INTO
    // processing - which it only makes by calling the progress endpoint.
    const events = await ctx.store.taskEvents(taskId);
    const reported = events.some((e) => String(e.to_status || '') === TASK_STATE.PROCESSING);
    check('progress was reported while running', sawProgress || reported,
      { sawProgress, states: events.map((e) => e.to_status) });
    check('task completed', completed.status === TASK_STATE.COMPLETED, completed.status);
    check('output manifest lists a file',
      (completed.output_manifest.files || []).length > 0, completed.output_manifest);
    check('a real image came back',
      (completed.output_manifest.files || [])[0]?.bytes > 1000, completed.output_manifest.files);

    // -----------------------------------------------------------------------
    section('5. browser downloads the result through the gateway');
    const grant = await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/grant', {
      token, body: { op: 'download' }
    });
    check('download grant minted', grant.body.grant.token.startsWith('nfg_'), grant.body.grant);

    const fileName = completed.output_manifest.files[0].name;
    const fileUrl = grant.body.grant.endpoint + '/gw/tasks/' + taskId + '/output/' + fileName;

    const noGrant = await fetch(fileUrl);
    check('the gateway refuses an ungranted read', noGrant.status === 401, { status: noGrant.status });

    const withGrant = await fetch(fileUrl, { headers: { 'x-novaflow-grant': grant.body.grant.token } });
    const bytes = Buffer.from(await withGrant.arrayBuffer());
    check('granted read succeeds', withGrant.status === 200, { status: withGrant.status });
    check('the bytes are a PNG', bytes.subarray(1, 4).toString() === 'PNG', bytes.subarray(0, 8).toString('hex'));
    check('gateway advertises range support',
      withGrant.headers.get('accept-ranges') === 'bytes', withGrant.headers.get('accept-ranges'));

    // Save it where a human can look at it.
    const proofDir = new URL('../../.artifacts/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    await mkdir(proofDir, { recursive: true });
    await writeFile(join(proofDir, 'e2e-result.png'), bytes);
    console.log('  ->  saved proof image to novaflow-web/.artifacts/e2e-result.png (' + bytes.length + ' bytes)');

    // -----------------------------------------------------------------------
    section('5b. the address the outside world gets is read-only and warehouse-only');
    {
      // The worker's public address is a Cloudflare tunnel: it dials out from
      // the owner's machine, so nothing is opened on their router, and the
      // bytes go from their disk to whoever asked without passing through any
      // storage. That is what makes a result the owner generated actually
      // reachable by somebody else's browser.
      //
      // A tunnel forwards whatever method it is handed, though - a PUT through
      // one arrives at the origin exactly like a GET - so "read-only" has to
      // be enforced here, at the gateway. These requests carry the Host header
      // a tunnelled request carries, which is how the gateway tells outside
      // from inside.
      // What a real tunnelled request carries. Measured against a live quick
      // tunnel - cloudflared adds these and keeps the original Host. The Host
      // header itself is not used here because fetch() refuses to set it.
      const outside = {
        'cf-connecting-ip': '203.0.113.9',
        'cdn-loop': 'cloudflare; loops=1'
      };
      const base = grant.body.grant.endpoint;
      const out = (path, init) => fetch(base + path, {
        ...init, headers: { ...outside, ...(init?.headers || {}) }
      });

      const read = await out('/gw/tasks/' + taskId + '/output/' + fileName, {
        headers: { 'x-novaflow-grant': grant.body.grant.token }
      });
      const readBytes = Buffer.from(await read.arrayBuffer());
      check('from outside, a finished result reads normally',
        read.status === 200 && readBytes.equals(bytes), { status: read.status });

      const write = await out('/gw/tasks/' + taskId + '/input/evil.png', {
        method: 'PUT',
        headers: { 'x-novaflow-grant': grant.body.grant.token },
        body: 'x'
      });
      const writeBody = await write.text();
      // Checked by the reason, not just the number: an upload grant cannot be
      // minted for a finished task either, so a 403 on its own would pass this
      // whether or not the rule above it exists.
      check('from outside, nothing may be written to the owner disk',
        write.status === 403 && /finished results only/.test(writeBody),
        { status: write.status, body: writeBody.slice(0, 120) });

      const peek = await out('/gw/tasks/' + taskId + '/input/' + fileName, {
        headers: { 'x-novaflow-grant': grant.body.grant.token }
      });
      const peekBody = await peek.text();
      check('from outside, only the warehouse is visible',
        peek.status === 403 && /finished results only/.test(peekBody),
        { status: peek.status, body: peekBody.slice(0, 120) });

      // And the owner, whose browser reaches 127.0.0.1, keeps the full gateway.
      const inside = await fetch(base + '/gw/tasks/' + taskId + '/output/' + fileName, {
        headers: { 'x-novaflow-grant': grant.body.grant.token }
      });
      check('on the machine itself the gateway is unchanged', inside.status === 200, { status: inside.status });
    }

    // -----------------------------------------------------------------------
    section('5c. a task WITH a reference image runs end to end');
    {
      // The direction nothing ever tested. The browser queued the reference
      // bytes in a Map, sent the task carrying only their NAMES, and never
      // read the Map again - so the pixels stayed in the browser and the
      // worker waited two minutes for an upload that was not coming, then
      // failed the task. Text-to-image has no references, which is the only
      // reason every run that was ever verified worked.
      //
      // The image from section 5 is a real PNG, so this is a real 图生图.
      const editTask = await call(BASE, 'POST', '/api/web/tasks', {
        token,
        body: {
          task_type: 'qwen2511_edit',
          parameters: {
            prompt: 'make the cube blue',
            width: 512, height: 512, steps: 4, count: 1, cfg: 1.0, seed: 77,
            references: [{ name: 'ref.png', bytes: bytes.length, kind: 'image' }]
          }
        }
      });
      check('an edit task with a reference is accepted',
        editTask.status === 200 && editTask.body.task.status === TASK_STATE.QUEUED,
        { status: editTask.status, task: editTask.body.task?.status });
      const editId = editTask.body.task.id;

      const up = await call(BASE, 'POST', '/api/web/tasks/' + editId + '/files', {
        token, body: { op: 'upload', kind: 'input', names: ['ref.png'] }
      });
      check('the browser is given somewhere to put the reference',
        up.status === 200 && Boolean(up.body.files?.['ref.png']?.url), up.body);

      const put = await fetch(up.body.files['ref.png'].url, {
        method: up.body.files['ref.png'].method || 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes
      });
      check('the reference uploads', put.ok, { status: put.status });

      const done = await waitFor(async () => {
        const r = await call(BASE, 'GET', '/api/web/tasks/' + editId, { token });
        const t = r.body.task;
        if (t.status === TASK_STATE.COMPLETED) return t;
        if (t.status === TASK_STATE.FAILED) throw new Error('edit task failed: ' + t.error_message);
        return null;
      }, { label: 'edit completion', timeoutMs: 300000, intervalMs: 700 });

      check('the worker picked the reference up and finished',
        (done.output_manifest.files || []).length > 0, done.output_manifest);

      const editName = done.output_manifest.files[0].name;
      const refused = await call(BASE, 'POST', '/api/web/tasks/' + editId + '/files', {
        token, body: { op: 'download', kind: 'output', names: [editName] }
      });
      check('results are never served from storage', refused.status === 403, { status: refused.status });

      const editGrant = await call(BASE, 'POST', '/api/web/tasks/' + editId + '/grant', {
        token, body: { op: 'download' }
      });
      const editBytes = Buffer.from(await (await fetch(
        editGrant.body.grant.endpoint + '/gw/tasks/' + editId + '/output/' + editName,
        { headers: { 'x-novaflow-grant': editGrant.body.grant.token } }
      )).arrayBuffer());
      check('and the edited image comes back', editBytes.subarray(1, 4).toString() === 'PNG',
        { bytes: editBytes.length });
      await writeFile(join(proofDir, 'e2e-edit.png'), editBytes);
      console.log('  ->  saved edited proof to novaflow-web/.artifacts/e2e-edit.png (' + editBytes.length + ' bytes)');
    }

    // -----------------------------------------------------------------------
    section('6. HTTP Range works (video streams without a full download)');
    const ranged = await fetch(fileUrl, {
      headers: { 'x-novaflow-grant': grant.body.grant.token, range: 'bytes=0-99' }
    });
    const rangedBytes = Buffer.from(await ranged.arrayBuffer());
    check('range request returns 206', ranged.status === 206, { status: ranged.status });
    check('range returns exactly the asked-for slice', rangedBytes.length === 100, rangedBytes.length);
    check('content-range header is correct',
      ranged.headers.get('content-range') === 'bytes 0-99/' + bytes.length,
      ranged.headers.get('content-range'));

    const suffix = await fetch(fileUrl, {
      headers: { 'x-novaflow-grant': grant.body.grant.token, range: 'bytes=-50' }
    });
    check('suffix range works', suffix.status === 206 &&
      Buffer.from(await suffix.arrayBuffer()).length === 50, { status: suffix.status });

    const silly = await fetch(fileUrl, {
      headers: { 'x-novaflow-grant': grant.body.grant.token, range: 'bytes=' + (bytes.length + 10) + '-' }
    });
    check('an out-of-bounds range is refused with 416', silly.status === 416, { status: silly.status });

    // -----------------------------------------------------------------------
    section('7. credits settled exactly once, for the quoted amount');
    const balance = await ctx.store.getCreditBalance(login.body.user.id);
    const charged = 500 - balance;
  checkEqual('no credits were deducted - this ran on our own GPU', charged, 0);
    check('the charge matches the quote', Math.abs(charged - Math.round(quoted)) <= 1, { charged, quoted });

    const settlements = await ctx.db.query(
      'select count(*)::int as n from public.comfy_usage_settlements where user_id = $1',
      [login.body.user.id]
    );
  checkEqual('and no settlement row was written', settlements.rows[0].n, 0);

    // -----------------------------------------------------------------------
    section('8. cross-user and cross-task access is refused');
    const mallory = await call(BASE, 'POST', '/dev/login', {
      body: { email: 'mallory@novaflow.local', balance: 100 }
    });
    const stolen = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token: mallory.body.session.token });
    check("another user cannot read the task", stolen.status === 404, stolen.body);

    // A valid grant for THIS task must not open a different task id.
    const otherTaskUrl = grant.body.grant.endpoint +
      '/gw/tasks/00000000-0000-4000-8000-000000000000/output/' + fileName;
    const wrongTask = await fetch(otherTaskUrl, {
      headers: { 'x-novaflow-grant': grant.body.grant.token }
    });
    check('a grant is bound to one task only', wrongTask.status === 403, { status: wrongTask.status });

    const traversal = await fetch(grant.body.grant.endpoint + '/gw/tasks/' + taskId + '/output/..%2F..%2Fidentity.json', {
      headers: { 'x-novaflow-grant': grant.body.grant.token }
    });
    check('path traversal is refused', traversal.status === 400 || traversal.status === 404, { status: traversal.status });

    // -----------------------------------------------------------------------
    section('9. TTL cleanup removes the bytes and flags the task');
    const swept = await worker.sweepFiles({ input: 0, image: 0, video: 0 });
    check('sweep removed the result files', swept.removedFiles > 0, swept);
    check('sweep named the task whose output went away',
      swept.expiredTasks.includes(taskId), swept.expiredTasks);

    // sweepFiles now reports the expired ids to the control plane itself.
    // Nothing did before: result_expired was only ever set by this line in
    // this test, and in production a task's results were "expired" on the
    // worker's disk while the control plane still offered to fetch them.
    const afterTtl = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token });
    check('task metadata survives but is marked expired',
      afterTtl.body.task.result_expired === true, afterTtl.body.task);

    const goneGrant = await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/grant', {
      token, body: { op: 'download' }
    });
    check('a download grant is refused once results expired', goneGrant.status === 410, goneGrant.body);
  }

  // -------------------------------------------------------------------------
  section('10. ComfyUI is not reachable from outside');
  {
    const { assertLocalOnly } = await import('../../worker/src/comfy/comfy-client.mjs');
    let refused = false;
    try { assertLocalOnly('http://0.0.0.0:8188'); } catch { refused = true; }
    check('a worker refuses to run against 0.0.0.0 ComfyUI', refused);

    let refusedPublic = false;
    try { assertLocalOnly('http://203.0.113.10:8188'); } catch { refusedPublic = true; }
    check('a worker refuses a public ComfyUI address', refusedPublic);

    const gwHealth = await fetch(worker.gatewayEndpoint + '/gw/health');
    check('the gateway is the only externally reachable surface', gwHealth.ok, { status: gwHealth.status });

    const proxyAttempt = await fetch(worker.gatewayEndpoint + '/prompt', { method: 'POST' });
    check('the gateway does not proxy ComfyUI endpoints', proxyAttempt.status === 404, { status: proxyAttempt.status });
  }
} finally {
  await cleanup();
}

finish('full-pipeline');

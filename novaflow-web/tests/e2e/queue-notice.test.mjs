import { approveComputeWorker } from '../helpers.mjs';
// Queue notice (2026-10-15, user: 节点忙碌时弹框提示排队、已等多久、预计多久，能取消排队).
//
// A task waiting for a node learns its place in line and roughly when it starts from the control
// plane (shared pool) or the local queue (this machine's own work); a node whose runtime still has
// other prompts to finish says the same in its progress note. The page shows it in one dialog.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { check, checkEqual, call, section, finish, uuid } from '../helpers.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { QUEUE_NOTE_RE, TASK_STATE, WORKER_MODEL_STATUS, estimateQueueWait, withQueueNote } from '../../packages/shared/src/protocol.mjs';
import { createLocalTasks } from '../../worker/src/local-tasks.mjs';
import { createComfyClient } from '../../worker/src/comfy/comfy-client.mjs';

const T2I = { task_type: 'qwen_t2i', parameters: { prompt: 'a knight', width: 1024, height: 1024, steps: 20, count: 1 } };

// ---------------------------------------------------------------------------
section('protocol: the note marker and the estimate');
{
  checkEqual('the marker goes after the note', withQueueNote('waiting in queue', { ahead: 2, eta: 180 }), 'waiting in queue [queue ahead=2 eta=180]');
  checkEqual('no estimate, no eta', withQueueNote('waiting in queue', { ahead: 1, eta: null }), 'waiting in queue [queue ahead=1]');
  checkEqual('an older marker is replaced', withQueueNote('waiting in queue [queue ahead=3 eta=90]', { ahead: 1, eta: 30 }), 'waiting in queue [queue ahead=1 eta=30]');
  checkEqual('no place in line, the plain note', withQueueNote('rendering', {}), 'rendering');
  const match = QUEUE_NOTE_RE.exec('waiting in queue [queue ahead=2 eta=180]');
  check('the page reads it back', match && match[1] === '2' && match[2] === '180', match);

  checkEqual('two queued ahead of 60 s runs, one running 20 s in, one node',
    estimateQueueWait({ queuedAhead: 2, runningElapsed: [20], averageSeconds: 60, workers: 1 }), 160);
  checkEqual('two nodes share the line', estimateQueueWait({ queuedAhead: 2, runningElapsed: [20], averageSeconds: 60, workers: 2 }), 80);
  checkEqual('a run past its average still counts a little', estimateQueueWait({ queuedAhead: 0, runningElapsed: [300], averageSeconds: 60 }), 6);
  checkEqual('no recent run, no estimate', estimateQueueWait({ queuedAhead: 3, averageSeconds: 0 }), null);
}

// ---------------------------------------------------------------------------
section('control plane: a queued task gets its place in line');
const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;
try {
  const login = async (email) => {
    const res = await call(BASE, 'POST', '/dev/login', { body: { email, balance: 5000 } });
    return { token: res.body.session.token, user: res.body.user };
  };
  const alice = await login('alice-queue@novaflow.local');
  const bob = await login('bob-queue@novaflow.local');
  const create = async (who) => (await call(BASE, 'POST', '/api/web/tasks', { token: who.token, body: T2I })).body.task.id;
  const read = async (who, id) => (await call(BASE, 'GET', '/api/web/tasks/' + id, { token: who.token })).body.task;

  // Nobody online: the line still counts, and the page says no node is there.
  const first = await create(alice);
  const second = await create(bob);
  const third = await create(alice);
  const q1 = (await read(alice, first)).queue;
  const q3 = (await read(alice, third)).queue;
  check('the first in line has nobody ahead', q1 && q1.ahead === 0, q1);
  check("other users' tasks count, as numbers only", q3 && q3.ahead === 2, q3);
  check('no node online: workers 0 and no estimate', q3.workers === 0 && q3.eta_seconds === null, q3);
  check('whose tasks they are never shows', !JSON.stringify(q3).includes('bob'), q3);

  // A node comes up and takes the first task: it is running, the others wait behind it.
  const workerId = uuid();
  const reg = await call(BASE, 'POST', '/api/worker/register', {
    token: alice.token,
    body: {
      worker_id: workerId, worker_name: 'queue-node', worker_secret: generateWorkerSecret(),
      hardware: { gpu_name: 'RTX', vram_mb: 32768, ram_mb: 65536, worker_version: '0.1.0', comfy_version: '0.31.1', endpoint_url: 'http://127.0.0.1:9555', transport: 'direct' }
    }
  });
  await approveComputeWorker(ctx.db,workerId);
  const node = reg.body.workerToken;
  await call(BASE, 'POST', '/api/worker/models', { token: node, body: { models: [{ model_id: 'qwen-image-2511', model_version: '1', status: WORKER_MODEL_STATUS.READY }] } });
  await call(BASE, 'POST', '/api/worker/heartbeat', { token: node, body: { status: 'idle' } });
  const claim = await call(BASE, 'POST', '/api/worker/claim', { token: node });
  checkEqual('the node takes the oldest task', claim.body.task?.id, first);
  const claimed = await read(alice, first);
  check('a task a node holds has no place in line', claimed.status === TASK_STATE.ASSIGNED && !claimed.queue, claimed);

  // The node finishes it about 1.2 s after starting; stats are kept 5 s per model, so wait them out.
  await call(BASE, 'POST', '/api/worker/tasks/' + first + '/progress', { token: node, body: { status: 'processing', progress: 20, note: 'sampling' } });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await call(BASE, 'POST', '/api/worker/tasks/' + first + '/complete', {
    token: node, body: { prompt_id: 'p1', outputs: [{ name: 'out.png', kind: 'image', bytes: 10, width: 1024, height: 1024 }] }
  });
  await new Promise((resolve) => setTimeout(resolve, 5200));
  const after2 = (await read(bob, second)).queue;
  const after3 = (await read(alice, third)).queue;
  check('next in line: nobody ahead, starts about now', after2 && after2.ahead === 0 && after2.workers === 1 && after2.eta_seconds === 0, after2);
  check('one ahead: about one recent run (1.2 s)', after3 && after3.ahead === 1 && after3.eta_seconds >= 1 && after3.eta_seconds <= 3, after3);
} finally {
  await ctx.close?.();
}

// ---------------------------------------------------------------------------
section('local queue: this machine\'s own work');
{
  const dir = await mkdtemp(join(tmpdir(), 'nf-queue-'));
  try {
    const tasks = await createLocalTasks(dir);
    const a = await tasks.create(T2I, 'local');
    const b = await tasks.create(T2I, 'local');
    const c = await tasks.create(T2I, 'local');
    const d = await tasks.create(T2I, 'local');
    check('nothing ran yet: in line, no estimate', tasks.queueView(b.id).ahead === 1 && tasks.queueView(b.id).eta_seconds === null, tasks.queueView(b.id));
    // a took 60 s; b has been running 20 s; c and d wait.
    tasks.next();
    Object.assign(tasks.get(a.id), { status: 'completed', started_at: new Date(Date.now() - 120000).toISOString(), completed_at: new Date(Date.now() - 60000).toISOString() });
    tasks.next();
    Object.assign(tasks.get(b.id), { status: 'processing', started_at: new Date(Date.now() - 20000).toISOString() });
    const vc = tasks.queueView(c.id);
    const vd = tasks.queueView(d.id);
    check('behind the running one: 1 ahead, about 40 s', vc.ahead === 1 && Math.abs(vc.eta_seconds - 40) <= 1, vc);
    check('one more queued ahead: about 100 s', vd.ahead === 2 && Math.abs(vd.eta_seconds - 100) <= 1, vd);
    check('a running task has no place in line', tasks.queueView(b.id) === null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
section('node: a prompt behind other prompts on the runtime');
{
  const now = Date.now();
  let polls = 0;
  const respond = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url) => {
    const path = String(url).replace('http://127.0.0.1:8188', '');
    if (path.startsWith('/history?')) {
      // two earlier runs of 50 s and 70 s
      const run = (start, seconds) => ({ status: { status_str: 'success', completed: true, messages: [['execution_start', { timestamp: start }], ['execution_success', { timestamp: start + seconds * 1000 }]] } });
      return respond({ old1: run(now - 400000, 50), old2: run(now - 300000, 70) });
    }
    if (path.startsWith('/history/mine')) {
      polls += 1;
      return respond(polls > 3 ? { mine: { status: { status_str: 'success', completed: true }, outputs: {} } } : {});
    }
    if (path === '/queue') return respond({ queue_running: [[7, 'someone-else']], queue_pending: [[9, 'mine'], [8, 'other-pending']] });
    return respond({});
  };
  const comfy = createComfyClient({ baseUrl: 'http://127.0.0.1:8188', fetchImpl });
  const notes = [];
  await comfy.waitForPrompt('mine', { pollMs: 5, onProgress: async (pct, note) => { notes.push(note); } });
  const waiting = notes.find((n) => QUEUE_NOTE_RE.test(n));
  const parsed = waiting && QUEUE_NOTE_RE.exec(waiting);
  check('the node says how many are ahead (1 running + 1 queued before it)', parsed && parsed[1] === '2', notes);
  // average 60 s: running one ~60 s left + one queued 60 s = 120, in ten-second steps
  check('and roughly how long, in ten-second steps', parsed && Number(parsed[2]) === 120, notes);
}

finish('queue-notice');

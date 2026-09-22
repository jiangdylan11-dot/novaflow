// Multi-worker scheduling and failure recovery (spec 16, 18, 19).
//
// Runs several real worker identities against one control plane and asserts
// the properties the brief names: no double-claim, different tasks land on
// different workers, a busy worker takes nothing more, an offline worker is
// skipped, and a task stranded on a dead worker is requeued and eventually
// finished by a healthy one - without ever charging for the failure.
//
// These workers talk to the control plane over real HTTP but do not run
// ComfyUI; the generation half is covered by full-pipeline.test.mjs. Here the
// subject under test is the scheduler.

import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { check, call, section, finish, uuid, waitFor } from '../helpers.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { WORKER_MODEL_STATUS, TASK_STATE } from '../../packages/shared/src/protocol.mjs';

const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;

async function devLogin(email, balance) {
  const res = await call(BASE, 'POST', '/dev/login', { body: { email, balance } });
  return { token: res.body.session.token, user: res.body.user };
}

/** A worker that registers and heartbeats for real, but never runs ComfyUI. */
async function fakeWorker({ ownerToken, name, vram = 32768, models = ['qwen-image-2511'] }) {
  const workerId = uuid();
  const secret = generateWorkerSecret();
  const reg = await call(BASE, 'POST', '/api/worker/register', {
    token: ownerToken,
    body: {
      worker_id: workerId,
      worker_name: name,
      worker_secret: secret,
      hardware: {
        gpu_name: 'RTX test ' + name, vram_mb: vram, ram_mb: 65536,
        worker_version: '0.1.0', comfy_version: '0.31.1',
        endpoint_url: 'http://127.0.0.1:1/' + name, transport: 'direct'
      }
    }
  });
  if (reg.status !== 200) throw new Error('register failed: ' + JSON.stringify(reg.body));
  const token = reg.body.workerToken;
  await call(BASE, 'POST', '/api/worker/models', {
    token,
    body: { models: models.map((m) => ({ model_id: m, model_version: '1', status: WORKER_MODEL_STATUS.READY })) }
  });
  await call(BASE, 'POST', '/api/worker/heartbeat', { token, body: { status: 'idle' } });

  return {
    id: workerId,
    name,
    token,
    beat: (status = 'idle', currentTaskId = null) =>
      call(BASE, 'POST', '/api/worker/heartbeat', { token, body: { status, current_task_id: currentTaskId } }),
    claim: () => call(BASE, 'POST', '/api/worker/claim', { token }),
    progress: (taskId, progress, promptId) =>
      call(BASE, 'POST', '/api/worker/tasks/' + taskId + '/progress', {
        token, body: { status: 'processing', progress, prompt_id: promptId }
      }),
    complete: (taskId, promptId) =>
      call(BASE, 'POST', '/api/worker/tasks/' + taskId + '/complete', {
        token, body: { prompt_id: promptId, outputs: [{ name: 'out_0001.png', kind: 'image', bytes: 2048 }] }
      })
  };
}

const owner = await devLogin('multi@novaflow.local', 100000);

async function createTask(label) {
  const res = await call(BASE, 'POST', '/api/web/tasks', {
    token: owner.token,
    body: { task_type: 'qwen_t2i', parameters: { prompt: label, width: 512, height: 512, steps: 4 } }
  });
  if (res.status !== 200) throw new Error('create failed: ' + JSON.stringify(res.body));
  return res.body.task.id;
}

const sweep = (overrides = {}) =>
  call(BASE, 'POST', '/api/maintenance/sweep', { token: ctx.controlSecret, body: overrides });

// ---------------------------------------------------------------------------
section('three workers register');
const w1 = await fakeWorker({ ownerToken: owner.token, name: 'worker-001' });
const w2 = await fakeWorker({ ownerToken: owner.token, name: 'worker-002' });
const w3 = await fakeWorker({ ownerToken: owner.token, name: 'worker-003', models: [] });
{
  const list = await call(BASE, 'GET', '/api/web/workers', { token: owner.token });
  check('all three are registered', list.body.workers.length === 3, list.body.workers.map((w) => w.worker_name));
  check('each has its own identity',
    new Set([w1.id, w2.id, w3.id]).size === 3, [w1.id, w2.id, w3.id]);
}

// ---------------------------------------------------------------------------
section('a task is claimed by exactly one worker');
{
  const taskId = await createTask('single-claim');
  // Both workers race for the same queued task.
  const [a, b] = await Promise.all([w1.claim(), w2.claim()]);
  const winners = [a, b].filter((r) => r.body.task?.id === taskId);
  check('exactly one worker got it', winners.length === 1, {
    a: a.body.task?.id || null, b: b.body.task?.id || null
  });
  check('the other got nothing', [a, b].filter((r) => r.body.task === null).length === 1);

  const task = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token: owner.token });
  check('the task names one assigned worker',
    [w1.id, w2.id].includes(task.body.task.assigned_worker_id), task.body.task.assigned_worker_id);

  // Clean up so the next section starts from an empty queue.
  const holder = task.body.task.assigned_worker_id === w1.id ? w1 : w2;
  await holder.complete(taskId, 'p-single-claim');
  await holder.beat('idle');
}

// ---------------------------------------------------------------------------
section('different tasks land on different workers');
{
  const t1 = await createTask('spread-1');
  const t2 = await createTask('spread-2');

  const c1 = await w1.claim();
  const c2 = await w2.claim();
  check('worker-001 took one', Boolean(c1.body.task), c1.body);
  check('worker-002 took the other', Boolean(c2.body.task), c2.body);
  check('they took different tasks', c1.body.task.id !== c2.body.task.id, {
    a: c1.body.task.id, b: c2.body.task.id
  });
  check('both tasks are covered',
    new Set([c1.body.task.id, c2.body.task.id]).size === 2 &&
    [t1, t2].every((t) => [c1.body.task.id, c2.body.task.id].includes(t)));

  const c3 = await w1.claim();
  check('a busy worker claims nothing more', c3.body.task === null, c3.body);

  await w1.complete(c1.body.task.id, 'p-spread-1');
  await w2.complete(c2.body.task.id, 'p-spread-2');
  await w1.beat('idle');
  await w2.beat('idle');
}

// ---------------------------------------------------------------------------
section('a worker without the model never gets the task');
{
  const taskId = await createTask('capability');
  const c3 = await w3.claim();
  check('worker-003 (no models) claims nothing', c3.body.task === null, c3.body);

  const c1 = await w1.claim();
  check('a capable worker picks it up', c1.body.task?.id === taskId, c1.body);
  await w1.complete(taskId, 'p-capability');
  await w1.beat('idle');
}

// ---------------------------------------------------------------------------
section('an offline worker stops receiving work');
{
  // Mark worker-001 offline by letting its heartbeat lapse, then sweeping with
  // a zero-tolerance timeout.
  await sweep({ heartbeatTimeoutSeconds: 5, assignTimeoutSeconds: 10, processingTimeoutSeconds: 60 });
  await w2.beat('idle');
  await w3.beat('idle');

  // Give worker-001 a stale heartbeat by sweeping with a 5s window after a
  // short wait, while the others keep beating.
  await new Promise((r) => setTimeout(r, 6000));
  await w2.beat('idle');
  await w3.beat('idle');
  const result = await sweep({ heartbeatTimeoutSeconds: 5, assignTimeoutSeconds: 10, processingTimeoutSeconds: 60 });
  check('the sweeper marked the silent worker offline',
    result.body.sweep.workers_marked_offline >= 1, result.body.sweep);

  const stale = await w1.claim();
  check('an offline worker is refused work even if it asks', stale.body.task === null, stale.body);

  const taskId = await createTask('offline-skip');
  const c2 = await w2.claim();
  check('the healthy worker takes it instead', c2.body.task?.id === taskId, c2.body);
  await w2.complete(taskId, 'p-offline-skip');
  await w2.beat('idle');
}

// ---------------------------------------------------------------------------
section('a task stranded on a dead worker is requeued, not lost or charged');
{
  await w1.beat('idle');
  const taskId = await createTask('recovery');

  const c1 = await w1.claim();
  check('worker-001 picked it up', c1.body.task?.id === taskId, c1.body);
  await w1.progress(taskId, 30, 'p-recovery-attempt-1');

  const balanceBefore = await ctx.store.getCreditBalance(owner.user.id);

  // worker-001 now dies: it stops beating. worker-002 stays alive.
  await new Promise((r) => setTimeout(r, 6000));
  await w2.beat('idle');
  const result = await sweep({ heartbeatTimeoutSeconds: 5, assignTimeoutSeconds: 10, processingTimeoutSeconds: 3 });
  check('the sweeper requeued the stranded task', result.body.sweep.tasks_requeued >= 1, result.body.sweep);

  const requeued = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token: owner.token });
  check('the task is queued again', requeued.body.task.status === TASK_STATE.QUEUED, requeued.body.task.status);
  check('it remembers the failed attempt', requeued.body.task.attempt_count >= 1, requeued.body.task.attempt_count);
  check('it is no longer bound to the dead worker',
    requeued.body.task.assigned_worker_id === null, requeued.body.task.assigned_worker_id);

  const balanceMid = await ctx.store.getCreditBalance(owner.user.id);
  check('nothing was charged for the lost attempt', balanceMid === balanceBefore, { balanceBefore, balanceMid });

  // The healthy worker finishes it.
  const c2 = await w2.claim();
  check('the surviving worker picks the task up', c2.body.task?.id === taskId, c2.body);
  check('the retry is counted', c2.body.task.attempt_count >= 2, c2.body.task.attempt_count);
  await w2.complete(taskId, 'p-recovery-attempt-2');

  const done = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token: owner.token });
  check('the task eventually completed', done.body.task.status === TASK_STATE.COMPLETED, done.body.task.status);

  const balanceAfter = await ctx.store.getCreditBalance(owner.user.id);
  check('the user was charged once, for the successful run',
    balanceAfter < balanceMid, { balanceMid, balanceAfter });

  const settlements = await ctx.db.query(
    "select count(*)::int as n from public.comfy_usage_settlements where prompt_id like 'p-recovery%'"
  );
  check('the failed attempt produced no settlement row', settlements.rows[0].n === 1, settlements.rows[0]);
}

// ---------------------------------------------------------------------------
section('a worker recovers by itself after coming back');
{
  await w1.beat('idle');
  const back = await call(BASE, 'GET', '/api/web/workers', { token: owner.token });
  const w1row = back.body.workers.find((w) => w.id === w1.id);
  check('the returning worker is idle again', w1row.status === 'idle', w1row);

  const taskId = await createTask('after-recovery');
  const claimed = await waitFor(async () => {
    const a = await w1.claim();
    if (a.body.task) return { who: 'w1', task: a.body.task };
    const b = await w2.claim();
    if (b.body.task) return { who: 'w2', task: b.body.task };
    return null;
  }, { label: 'a worker to take the task', timeoutMs: 10000 });
  check('the recovered pool serves new work', claimed.task.id === taskId, claimed);
}

ctx.server.close();
finish('multi-worker');

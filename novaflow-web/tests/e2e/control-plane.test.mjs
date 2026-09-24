// Control-plane contract, exercised over real HTTP against real PostgreSQL.
//
// Covers acceptance items 3-9, 13, 19-23 and 25-26 from the brief:
// credits read, task creation, worker registration, heartbeat, GPU + model
// capability reporting, automatic assignment, progress, failure handling,
// credit correctness and the authorisation boundaries.

import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { check, checkEqual, call, section, finish, uuid } from '../helpers.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { TASK_STATE, WORKER_MODEL_STATUS } from '../../packages/shared/src/protocol.mjs';

const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;

async function devLogin(email, balance) {
  const res = await call(BASE, 'POST', '/dev/login', { body: { email, balance } });
  return { token: res.body.session.token, user: res.body.user, credits: res.body.credits };
}

async function registerWorker({ ownerToken, name, vram = 32768, models = ['qwen-image-2511', 'minimax-h3'], endpoint }) {
  const workerId = uuid();
  const secret = generateWorkerSecret();
  const res = await call(BASE, 'POST', '/api/worker/register', {
    token: ownerToken,
    body: {
      worker_id: workerId,
      worker_name: name,
      worker_secret: secret,
      hardware: {
        gpu_name: 'NVIDIA GeForce RTX 5090',
        vram_mb: vram,
        ram_mb: 65536,
        worker_version: '0.1.0',
        comfy_version: '0.31.1',
        endpoint_url: endpoint || ('http://127.0.0.1:9' + Math.floor(Math.random() * 900 + 100)),
        transport: 'direct'
      }
    }
  });
  if (res.status !== 200) throw new Error('register failed: ' + JSON.stringify(res.body));
  const workerToken = res.body.workerToken;
  await call(BASE, 'POST', '/api/worker/models', {
    token: workerToken,
    body: {
      models: models.map((m) => ({ model_id: m, model_version: '1', status: WORKER_MODEL_STATUS.READY }))
    }
  });
  await call(BASE, 'POST', '/api/worker/heartbeat', { token: workerToken, body: { status: 'idle' } });
  return { workerId, secret, workerToken, res };
}

// ---------------------------------------------------------------------------
section('health + capabilities');
{
  const health = await call(BASE, 'GET', '/health');
  check('health responds ok', health.status === 200 && health.body.ok === true, health.body);

  const caps = await call(BASE, 'GET', '/api/web/capabilities');
  check('capabilities list task types', caps.status === 200 && caps.body.taskTypes.length >= 3, caps.body);
  check('capabilities never leak a workflow graph',
    !JSON.stringify(caps.body).includes('class_type'), 'capabilities payload');
}

// ---------------------------------------------------------------------------
section('auth boundary');
const alice = await devLogin('alice@novaflow.local', 5000);
const bob = await devLogin('bob@novaflow.local', 5000);
{
  const noToken = await call(BASE, 'GET', '/api/web/tasks');
  check('listing tasks without a token is rejected', noToken.status === 401, noToken.body);

  const badToken = await call(BASE, 'GET', '/api/web/tasks', { token: 'nfs_garbage.signature' });
  check('a forged session token is rejected', badToken.status === 401, badToken.body);

  const ok = await call(BASE, 'GET', '/api/web/tasks', { token: alice.token });
  check('a valid session token is accepted', ok.status === 200, ok.body);

  check('credits are readable and seeded', alice.credits.balance === 5000, alice.credits);
}

// ---------------------------------------------------------------------------
section('worker registration + heartbeat + capability');
const w1 = await registerWorker({ ownerToken: alice.token, name: 'studio-5090' });
{
  check('worker registration returns a worker token', typeof w1.workerToken === 'string' && w1.workerToken.startsWith('nfw_'));
  check('worker registration returns a per-worker grant key',
    typeof w1.res.body.grantKey === 'string' && w1.res.body.grantKey.length > 20);
  check('worker registration never returns the secret hash',
    !JSON.stringify(w1.res.body.worker).includes('worker_secret_hash'), w1.res.body.worker);

  const hb = await call(BASE, 'POST', '/api/worker/heartbeat', {
    token: w1.workerToken,
    body: { status: 'idle', hardware: { vram_mb: 32768 } }
  });
  check('heartbeat accepted', hb.status === 200 && hb.body.worker.status === 'idle', hb.body);
  check('heartbeat reports GPU back', hb.body.worker.gpu_name.includes('5090'), hb.body.worker);

  const list = await call(BASE, 'GET', '/api/web/workers', { token: alice.token });
  check('owner sees their worker', list.status === 200 && list.body.workers.length === 1, list.body);

  const otherList = await call(BASE, 'GET', '/api/web/workers', { token: bob.token });
  check('another user does not see it', otherList.body.workers.length === 0, otherList.body);
}

// ---------------------------------------------------------------------------
section('worker cannot act outside itself');
{
  const asUser = await call(BASE, 'POST', '/api/worker/claim', { token: alice.token });
  check('a user session cannot claim worker work', asUser.status === 401, asUser.body);

  const asWorker = await call(BASE, 'GET', '/api/web/workers', { token: w1.workerToken });
  check('a worker token cannot read the user API', asWorker.status === 401, asWorker.body);

  const sweepAsUser = await call(BASE, 'POST', '/api/maintenance/sweep', { token: alice.token, body: {} });
  check('a user cannot drive the sweeper', sweepAsUser.status === 401, sweepAsUser.body);
}

// ---------------------------------------------------------------------------
section('task creation + pricing');
let taskId = '';
{
  const created = await call(BASE, 'POST', '/api/web/tasks', {
    token: alice.token,
    body: {
      task_type: 'qwen_t2i',
      parameters: { prompt: 'a knight', width: 1024, height: 1024, steps: 20, count: 1 }
    }
  });
  check('task created', created.status === 200 && created.body.task.status === TASK_STATE.QUEUED, created.body);
  taskId = created.body.task.id;
  check('the server, not the client, decided the price',
    created.body.pricing.source === 'novaflow_web_self_hosted_v1', created.body.pricing);
  checkEqual('and self-hosted work is free', created.body.pricing.creditCost, 0);
  check('a capable worker was detected', created.body.capableWorkers === 1, created.body);

  // The browser must not be able to talk itself into a cheaper task.
  const cheeky = await call(BASE, 'POST', '/api/web/tasks', {
    token: alice.token,
    body: {
      task_type: 'qwen_t2i',
      credit_cost: 0, chargeAmount: 0, estimatedCreditCost: 0,
      parameters: { prompt: 'x', width: 4096, height: 4096, steps: 100, count: 10 }
    }
  });
  // The client cannot smuggle a price in. It happens to be zero either way
  // today, so what is asserted is that the server's own verdict is what lands,
  // not that a made-up field was merely ignored.
  checkEqual('client-supplied price fields do not change the verdict',
    cheeky.body.pricing.creditCost, 0);
  checkEqual('and the verdict is the server rate rule',
    cheeky.body.pricing.source, 'novaflow_web_self_hosted_v1');
  // It was only a pricing probe; drop it so it does not sit at the head of the
  // FIFO queue and get claimed ahead of the tasks the later sections create.
  await call(BASE, 'POST', '/api/web/tasks/' + cheeky.body.task.id + '/cancel', { token: alice.token });

  const junk = await call(BASE, 'POST', '/api/web/tasks', {
    token: alice.token,
    body: { task_type: 'definitely_not_a_task', parameters: {} }
  });
  check('unknown task type refused', junk.status === 400, junk.body);

  // Credits meter what Grok / GPT / Google bill for. A user with none of them
  // must still be able to run their own GPU, so a zero balance is not a gate.
  const poor = await devLogin('poor@novaflow.local', 0);
  const allowed = await call(BASE, 'POST', '/api/web/tasks', {
    token: poor.token,
    body: { task_type: 'qwen_t2i', parameters: { prompt: 'x' } }
  });
  check('a zero-credit account can still use its own GPU', allowed.status === 200, allowed.body);
  checkEqual('at no cost', allowed.body.pricing.creditCost, 0);
  const poorBalance = await ctx.store.getCreditBalance(poor.user.id);
  checkEqual('and its balance is untouched', poorBalance, 0);
  await call(BASE, 'POST', '/api/web/tasks/' + allowed.body.task.id + '/cancel', { token: poor.token });
}

// ---------------------------------------------------------------------------
section('other users cannot reach the task');
{
  const asBob = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token: bob.token });
  check("another user's task reads as 404", asBob.status === 404, asBob.body);

  const grantAsBob = await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/grant', {
    token: bob.token, body: { op: 'upload' }
  });
  check('another user cannot mint a grant for it', grantAsBob.status === 404, grantAsBob.body);
}

// ---------------------------------------------------------------------------
section('assignment + progress + completion + credits');
{
  const claim = await call(BASE, 'POST', '/api/worker/claim', { token: w1.workerToken });
  check('worker claims the queued task', claim.body.task?.id === taskId, claim.body);
  // The worker view may name WHICH builder to run, but never a graph: no
  // node has a class_type anywhere in what it receives.
  check('claimed task carries business parameters, never a graph',
    claim.body.task.parameters.prompt === 'a knight' &&
    !JSON.stringify(claim.body.task).includes('class_type'), claim.body.task);

  const secondClaim = await call(BASE, 'POST', '/api/worker/claim', { token: w1.workerToken });
  check('a busy worker claims nothing more', secondClaim.body.task === null, secondClaim.body);

  const grant = await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/grant', {
    token: alice.token, body: { op: 'upload' }
  });
  check('upload grant issued once assigned',
    grant.status === 200 && grant.body.grant.token.startsWith('nfg_'), grant.body);
  check('grant carries the worker endpoint', Boolean(grant.body.grant.endpoint), grant.body.grant);

  const progress = await call(BASE, 'POST', '/api/worker/tasks/' + taskId + '/progress', {
    token: w1.workerToken,
    body: { status: 'processing', progress: 42, note: 'sampling', prompt_id: 'prompt-abc' }
  });
  check('progress recorded', progress.body.task.status === TASK_STATE.PROCESSING && progress.body.task.progress === 42, progress.body.task);

  const balanceBefore = await ctx.store.getCreditBalance(alice.user.id);

  const complete = await call(BASE, 'POST', '/api/worker/tasks/' + taskId + '/complete', {
    token: w1.workerToken,
    body: {
      prompt_id: 'prompt-abc',
      outputs: [{ name: 'out_0001.png', kind: 'image', bytes: 1048576, width: 1024, height: 1024 }],
      execution: { elapsed_ms: 9000, comfy_version: '0.31.1' }
    }
  });
  check('task completed', complete.body.task.status === TASK_STATE.COMPLETED, complete.body.task);
  check('settlement was skipped rather than written as a zero charge',
    complete.body.settlement && complete.body.settlement.skipped === 'self_hosted',
    complete.body.settlement);

  const balanceAfter = await ctx.store.getCreditBalance(alice.user.id);
  const charged = balanceBefore - balanceAfter;
  checkEqual('no credits were deducted for work on our own GPU', charged, 0);

  // Replay the completion: the idempotency key must prevent a second charge.
  await call(BASE, 'POST', '/api/worker/tasks/' + taskId + '/complete', {
    token: w1.workerToken,
    body: { prompt_id: 'prompt-abc', outputs: [{ name: 'out_0001.png', kind: 'image', bytes: 1 }] }
  });
  const balanceReplay = await ctx.store.getCreditBalance(alice.user.id);
  checkEqual('replaying completion does not double charge', balanceReplay, balanceAfter);

  const download = await call(BASE, 'POST', '/api/web/tasks/' + taskId + '/grant', {
    token: alice.token, body: { op: 'download' }
  });
  check('download grant issued after completion', download.status === 200, download.body);
}

// ---------------------------------------------------------------------------
section('failure never charges');
{
  const created = await call(BASE, 'POST', '/api/web/tasks', {
    token: alice.token,
    body: { task_type: 'qwen_t2i', parameters: { prompt: 'will fail', width: 1024, height: 1024 } }
  });
  const failTaskId = created.body.task.id;

  await call(BASE, 'POST', '/api/worker/heartbeat', { token: w1.workerToken, body: { status: 'idle' } });
  const claim = await call(BASE, 'POST', '/api/worker/claim', { token: w1.workerToken });
  check('failing task was assigned', claim.body.task?.id === failTaskId, claim.body);

  const before = await ctx.store.getCreditBalance(alice.user.id);
  const failed = await call(BASE, 'POST', '/api/worker/tasks/' + failTaskId + '/fail', {
    token: w1.workerToken,
    body: { error_code: 'comfy_crash', error_message: 'ComfyUI exited' }
  });
  check('task marked failed', failed.body.task.status === TASK_STATE.FAILED, failed.body.task);
  check('failure path reports no charge', failed.body.charged === false, failed.body);

  const after = await ctx.store.getCreditBalance(alice.user.id);
  checkEqual('a failed task costs the user nothing', after, before);

  const worker = await ctx.store.getWorkerById(w1.workerId);
  check('worker freed after failure', worker.status === 'idle' && !worker.current_task_id, worker);
}

// ---------------------------------------------------------------------------
section('state machine refuses illegal transitions');
{
  const created = await call(BASE, 'POST', '/api/web/tasks', {
    token: alice.token,
    body: { task_type: 'qwen_t2i', parameters: { prompt: 'sm' } }
  });
  const id = created.body.task.id;

  // Completing a task that was never assigned to this worker must be refused.
  const stolen = await call(BASE, 'POST', '/api/worker/tasks/' + id + '/complete', {
    token: w1.workerToken, body: { prompt_id: 'p-stolen', outputs: [] }
  });
  check('a worker cannot complete a task it does not hold', stolen.status === 403, stolen.body);

  const cancelled = await call(BASE, 'POST', '/api/web/tasks/' + id + '/cancel', { token: alice.token });
  check('user can cancel a queued task', cancelled.body.task.status === TASK_STATE.CANCELLED, cancelled.body.task);

  const again = await call(BASE, 'POST', '/api/web/tasks/' + id + '/cancel', { token: alice.token });
  check('cancelling twice is refused, not silently accepted', again.status >= 400, again.body);

  const events = await ctx.store.taskEvents(id);
  check('every transition is timestamped in the event log',
    events.length >= 2 && events.every((e) => Boolean(e.created_at)), events);
}

// ---------------------------------------------------------------------------
section('scheduler respects capability');
{
  const weak = await registerWorker({
    ownerToken: bob.token, name: 'laptop-3060', vram: 12288, models: ['qwen-image-2511']
  });

  const videoTask = await call(BASE, 'POST', '/api/web/tasks', {
    token: bob.token,
    body: {
      task_type: 'h3_i2v',
      parameters: { prompt: 'pan', duration_seconds: 3, references: [{ name: 'ref.png', bytes: 1024 }] }
    }
  });
  check('video task queued', videoTask.body.task.status === TASK_STATE.QUEUED, videoTask.body.task);
  // The worker pool is shared across users on purpose - a compute provider
  // serves everyone - so alice's 5090 counts for bob's video task.
  check('the shared pool reports the 5090 as capable',
    videoTask.body.capableWorkers === 1, videoTask.body);

  const claim = await call(BASE, 'POST', '/api/worker/claim', { token: weak.workerToken });
  check('a worker without the model or VRAM claims nothing', claim.body.task === null, claim.body);
}

// ---------------------------------------------------------------------------
section('account tiers: other people\'s nodes need a 高级账户');
{
  const body = { task_type: 'qwen_t2i', parameters: { prompt: 'a knight', width: 1024, height: 1024, steps: 20, count: 1 } };
  const basic = await call(BASE, 'POST', '/dev/login', { body: { email: 'basic@novaflow.local', balance: 5000, plan: 'trial' } });
  const basicToken = basic.body.session.token;
  const me = await call(BASE, 'GET', '/api/web/me', { token: basicToken });
  check('a 普通账户 (trial) reads its plan and no shared compute',
    me.status === 200 && me.body.user.plan === 'trial' && me.body.compute.shared === false, me.body);
  const refused = await call(BASE, 'POST', '/api/web/tasks', { token: basicToken, body });
  check('a 普通账户 cannot queue work for other nodes',
    refused.status === 403 && refused.body.code === 'plan_required' && /本机算力/.test(refused.body.error), refused.body);
  const list = await call(BASE, 'GET', '/api/web/tasks', { token: basicToken });
  check('the same account still reads its task list', list.status === 200 && list.body.tasks.length === 0, list.body);
  const upgraded = await call(BASE, 'POST', '/dev/login', { body: { email: 'basic@novaflow.local', balance: 5000, plan: 'pro' } });
  const allowed = await call(BASE, 'POST', '/api/web/tasks', { token: upgraded.body.session.token, body });
  check('upgraded to pro, the same account creates a task', allowed.status === 200 && allowed.body.task.status === TASK_STATE.QUEUED, allowed.body);
  const stale = await call(BASE, 'POST', '/api/web/tasks', { token: basicToken, body });
  check('the plan is read from the user row, not the old token', stale.status === 200, stale.body);
  const team = await call(BASE, 'POST', '/dev/login', { body: { email: 'team@novaflow.local', balance: 5000, plan: 'team' } });
  const teamMe = await call(BASE, 'GET', '/api/web/me', { token: team.body.session.token });
  check('a team account counts as 高级账户', teamMe.body.compute.shared === true && teamMe.body.user.plan === 'team', teamMe.body);
  const pro = await call(BASE, 'GET', '/api/web/me', { token: alice.token });
  check('the default dev login is a 高级账户', pro.body.compute.shared === true && pro.body.user.plan === 'pro', pro.body);
}

finish('control-plane');

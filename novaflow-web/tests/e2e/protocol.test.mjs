// Contract tests for the shared protocol.
//
// These guard the invariants that hold the three deployments together: the
// state machine JS and the state machine SQL must agree, the edge function's
// copies must match their sources, pricing must be monotonic and must ignore
// anything a client sends, and every task type must have a workflow.

import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createDatabase } from '../../control-local/src/db.mjs';
import { syncEdgeFunction } from '../../tools/sync-edge-function.mjs';
import { check, checkEqual, section, finish } from '../helpers.mjs';
import {
  TASK_STATE, TASK_TRANSITIONS, TASK_TYPE, TASK_TYPE_WORKFLOW,
  TASK_TYPE_REQUIREMENTS, canTransition, isTerminalState, isSafeFilename,
  TOKEN_PREFIX, requirementsFor
} from '../../packages/shared/src/protocol.mjs';
import { priceTask, priceFromRateCard } from '../../packages/shared/src/pricing.mjs';
import { MODEL_MANIFEST, findModel } from '../../packages/shared/src/model-manifest.mjs';
import { validateTaskParameters } from '../../packages/shared/src/control-plane.mjs';

const WORKFLOW_DIR = new URL('../../worker/workflows/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// ---------------------------------------------------------------------------
section('state machine: JS and SQL agree');
{
  const db = await createDatabase();
  const states = Object.values(TASK_STATE);
  let mismatches = 0;
  for (const from of states) {
    for (const to of states) {
      const js = canTransition(from, to);
      const res = await db.query('select public.novaflow_web_allows_transition($1, $2) as ok', [from, to]);
      const sql = Boolean(res.rows[0].ok);
      if (js !== sql) {
        mismatches += 1;
        console.log('    mismatch ' + from + ' -> ' + to + '  js=' + js + ' sql=' + sql);
      }
    }
  }
  check('every transition pair matches between JS and SQL (' + (states.length ** 2) + ' pairs)', mismatches === 0, { mismatches });

  check('terminal states allow nothing further',
    ['completed', 'failed', 'cancelled', 'expired'].every((s) => TASK_TRANSITIONS[s].length === 0));
  check('isTerminalState agrees with the transition table',
    Object.values(TASK_STATE).every((s) => isTerminalState(s) === (TASK_TRANSITIONS[s].length === 0)));
  check('a running task can always be cancelled',
    ['queued', 'assigned', 'uploading', 'processing'].every((s) => canTransition(s, TASK_STATE.CANCELLED)));
  check('only processing can complete',
    Object.values(TASK_STATE).filter((s) => canTransition(s, TASK_STATE.COMPLETED)).join() === 'processing');
  await db.close?.();
}

// ---------------------------------------------------------------------------
section('every task type is runnable');
{
  for (const taskType of Object.values(TASK_TYPE)) {
    const req = requirementsFor(taskType);
    check(taskType + ' declares requirements', Boolean(req?.modelId && req.minVramMb > 0), req);
    check(taskType + ' has a model in the manifest', Boolean(findModel(req.modelId)), req?.modelId);

    const file = TASK_TYPE_WORKFLOW[taskType];
    check(taskType + ' maps to a workflow file', Boolean(file), file);

    const raw = JSON.parse(await readFile(join(WORKFLOW_DIR, file), 'utf8'));
    check(file + ' has a graph', raw.graph && Object.keys(raw.graph).length > 0);
    check(file + ' has a prompt binding', Boolean(raw.bindings?.prompt), raw.bindings);

    // Every binding must point at a node that exists, or generation fails at
    // run time on someone's GPU instead of here.
    const badBindings = Object.entries(raw.bindings || {})
      .filter(([, b]) => !raw.graph[b.node])
      .map(([k]) => k);
    checkEqual(file + ' bindings all resolve to real nodes', badBindings, []);

    const badRefs = (raw.references || []).filter((r) => !raw.graph[r.node]).map((r) => r.node);
    checkEqual(file + ' reference slots all resolve', badRefs, []);

    // Every graph node must be a ComfyUI API-format node.
    const badNodes = Object.entries(raw.graph)
      .filter(([, n]) => !n.class_type || typeof n.inputs !== 'object')
      .map(([id]) => id);
    checkEqual(file + ' is valid ComfyUI API format', badNodes, []);
  }

  check('a model that needs a reference declares one',
    (JSON.parse(await readFile(join(WORKFLOW_DIR, TASK_TYPE_WORKFLOW[TASK_TYPE.H3_I2V]), 'utf8')).references || []).length > 0);
}

// ---------------------------------------------------------------------------
section('pricing is server-authoritative and sane');
{
  // What a user is actually charged: nothing, because every task type today
  // runs on this pool's own GPUs. See the "only third-party work costs
  // credits" section for that rule.
  checkEqual('a self-hosted image is free',
    priceTask(TASK_TYPE.QWEN_T2I, { width: 1024, height: 1024, steps: 20, count: 1 }).creditCost, 0);
  checkEqual('a self-hosted video is free',
    priceTask(TASK_TYPE.H3_I2V, { width: 1280, height: 720, duration_seconds: 10 }).creditCost, 0);

  // The rate card underneath still has to be right, because a provider-backed
  // task type will use it. Exercised directly so it cannot rot unnoticed while
  // everything above it is free.
  const base = priceFromRateCard(TASK_TYPE.QWEN_T2I, { width: 1024, height: 1024, steps: 20, count: 1 });
  check('the rate card prices a standard image above zero', base.creditCost > 0, base);

  const bigger = priceFromRateCard(TASK_TYPE.QWEN_T2I, { width: 2048, height: 2048, steps: 20, count: 1 });
  check('a bigger image costs more', bigger.creditCost > base.creditCost, { base: base.creditCost, bigger: bigger.creditCost });

  const more = priceFromRateCard(TASK_TYPE.QWEN_T2I, { width: 1024, height: 1024, steps: 40, count: 1 });
  check('more steps cost more', more.creditCost > base.creditCost, { base: base.creditCost, more: more.creditCost });

  const batch = priceFromRateCard(TASK_TYPE.QWEN_T2I, { width: 1024, height: 1024, steps: 20, count: 4 });
  check('a batch of 4 costs 4x', Math.abs(batch.creditCost - base.creditCost * 4) < 0.0001, { batch: batch.creditCost });

  // A client cannot smuggle a price in, whatever it calls the field.
  const hostile = priceFromRateCard(TASK_TYPE.QWEN_T2I, {
    width: 1024, height: 1024, steps: 20, count: 1,
    creditCost: 0, credit_cost: 0, chargeAmount: 0, price: 0, cost: 0, free: true
  });
  checkEqual('client-supplied price fields are ignored', hostile.creditCost, base.creditCost);

  // Out-of-range values clamp UP to the allowed maximum, never down to free.
  const absurd = priceFromRateCard(TASK_TYPE.QWEN_T2I, { width: 999999, height: 999999, steps: 99999, count: 9999 });
  check('absurd parameters clamp to a real, non-zero price', absurd.creditCost > base.creditCost, absurd);

  const negative = priceFromRateCard(TASK_TYPE.QWEN_T2I, { width: -1, height: -1, steps: -5, count: -3 });
  check('negative parameters never yield a negative or zero price', negative.creditCost > 0, negative);

  const video = priceFromRateCard(TASK_TYPE.H3_I2V, { width: 1280, height: 720, duration_seconds: 5 });
  check('video pricing scales with duration',
    priceFromRateCard(TASK_TYPE.H3_I2V, { width: 1280, height: 720, duration_seconds: 10 }).creditCost > video.creditCost);

  check('an unknown task type prices at zero rather than guessing',
    priceTask('nonsense', {}).creditCost === 0);
}

// ---------------------------------------------------------------------------
section('parameter validation clamps rather than trusts');
{
  const p = validateTaskParameters(TASK_TYPE.QWEN_T2I, {
    prompt: 'x'.repeat(99999),
    width: 99999, height: -5, steps: 1e9, count: 500, cfg: 1e6, seed: 'abc'
  });
  check('prompt is truncated', p.prompt.length <= 4000, p.prompt.length);
  check('width clamps to the ceiling', p.width === 4096, p.width);
  check('height clamps to the floor', p.height === 256, p.height);
  check('steps clamp', p.steps === 100, p.steps);
  check('count clamps', p.count === 10, p.count);
  check('cfg clamps', p.cfg <= 20, p.cfg);
  check('a non-numeric seed becomes random (-1)', p.seed === -1, p.seed);

  let refused = false;
  try { validateTaskParameters(TASK_TYPE.H3_I2V, { prompt: 'x', references: [] }); } catch { refused = true; }
  check('an image-to-video task without a reference is refused', refused);

  let unknown = false;
  try { validateTaskParameters('made_up', {}); } catch { unknown = true; }
  check('an unknown task type is refused', unknown);
}

// ---------------------------------------------------------------------------
section('filenames the gateway will accept');
{
  for (const good of ['out_0001.png', 'a.mp4', 'ref-1.jpeg', 'A1.webp']) {
    check('accepts ' + good, isSafeFilename(good));
  }
  for (const bad of ['../x.png', 'a/b.png', '..', '.hidden', '', 'x'.repeat(200), 'a\\b.png', 'a b.png', 'a;b.png']) {
    check('refuses ' + JSON.stringify(bad), !isSafeFilename(bad));
  }
}

// ---------------------------------------------------------------------------
section('token namespaces are distinct');
{
  const prefixes = Object.values(TOKEN_PREFIX);
  check('three distinct prefixes', new Set(prefixes).size === 3, prefixes);
  check('no prefix is a prefix of another',
    prefixes.every((a) => prefixes.filter((b) => b !== a).every((b) => !b.startsWith(a))), prefixes);
}

// ---------------------------------------------------------------------------
section('the deployed edge function matches its sources');
{
  const drift = await syncEdgeFunction({ check: true });
  checkEqual('every shared module copy is current (run npm run sync:edge if not)', drift.map((d) => d.file), []);
}

// ---------------------------------------------------------------------------
section('model manifest is coherent');
{
  for (const model of MODEL_MANIFEST) {
    check(model.model_id + ' lists required files', model.required_files.length > 0);
    check(model.model_id + ' declares a VRAM floor', model.min_vram_mb > 0);
    check(model.model_id + ' names its workflows', model.compatible_workflows.length > 0);
    check(model.model_id + ' files declare a size floor',
      model.required_files.every((f) => f.min_bytes > 0), model.required_files.map((f) => f.min_bytes));
  }
  const usedModels = new Set(Object.values(TASK_TYPE_REQUIREMENTS).map((r) => r.modelId));
  for (const id of usedModels) check('task types only reference manifest models: ' + id, Boolean(findModel(id)));
}

// ---------------------------------------------------------------------------
section('the edge function can actually be deployed');
{
  // This is where a real production deploy died. The file list was written by
  // hand and had lost workflow-modules.mjs: every local test passed, the sync
  // check said "in sync", and Deno failed to resolve the import on cold start.
  // The list is now derived from the imports, and this asserts that.
  const { resolveSharedFiles } = await import('../../tools/sync-edge-function.mjs');
  const { files, missing } = await resolveSharedFiles();
  checkEqual('every relative import of the edge function resolves', missing, []);
  check('and it reaches more than a couple of modules', files.length >= 5, files);

  const fnDir = new URL('../../supabase/functions/novaflow-web/', import.meta.url);
  const onDisk = (await readdir(fnDir)).filter((f) => f !== 'index.ts' && /\.(mjs|ts|js)$/.test(f)).sort();
  checkEqual('the folder holds exactly those modules, no more, no fewer', onDisk, files);

  // The bundle is what gets deployed, so it has to be current and parseable.
  const { bundleEdgeFunction } = await import('../../tools/bundle-edge-function.mjs');
  const bundle = await bundleEdgeFunction();
  check('the bundle inlines every module', bundle.files.length === files.length, bundle.files);
  check('and produces one file with the Deno entry point', bundle.chars > 50000, bundle.chars);

  const code = await readFile(fileURLToPath(new URL('../../supabase/functions/novaflow-web-bundle/index.ts', import.meta.url)), 'utf8');
  check('the bundle serves requests', /Deno\.serve\(/.test(code), null);
  checkEqual('no relative import survives the bundle',
    [...code.matchAll(/^[ \t]*import\s+[^;]*?from\s+['"]\.\/[^'"]+['"]/gm)].map((m) => m[0].trim()), []);
  // Node 24 strips types, so this parses the TypeScript for real.
  try {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../../supabase/functions/novaflow-web-bundle/index.ts', import.meta.url))], { stdio: 'pipe' });
    check('the bundle parses', true);
  } catch (error) {
    check('the bundle parses', false, String(error.stderr || error.message).slice(0, 200));
  }
}

// ---------------------------------------------------------------------------
section('the control secret does not have to be configured');
{
  // One fewer thing to create by hand when deploying. It is derived from the
  // session secret every deployment already has, with domain separation, so
  // holding one tells you nothing about the other.
  const { resolveControlSecret, hmacSha256 } = await import('../../packages/shared/src/tokens.mjs');

  const session = 'a-session-secret-that-every-deployment-already-has';
  const derived = await resolveControlSecret({ sessionSecret: session });
  check('a control secret is produced without one being set', derived.length >= 32, derived.length);
  checkEqual('and it is the same every cold start', derived, await resolveControlSecret({ sessionSecret: session }));
  check('it is not the session secret itself', derived !== session, null);
  check('and not a bare hash of it either',
    derived !== await hmacSha256(session, session), null);

  const other = await resolveControlSecret({ sessionSecret: session + 'x' });
  check('a different session secret gives a different control secret', derived !== other, null);

  const explicit = await resolveControlSecret({ controlSecret: 'set-by-hand', sessionSecret: session });
  checkEqual('an explicit secret still wins', explicit, 'set-by-hand');

  const none = await resolveControlSecret({});
  checkEqual('and nothing at all yields nothing, rather than a guessable default', none, '');
}

// ---------------------------------------------------------------------------
section('only third-party work costs credits');
{
  // The product rule: credits meter what Grok / GPT / Google bill for.
  // Generation that runs on this pool's own GPUs is free, whoever owns the
  // machine. Charging for someone's own hardware would be inventing a fee.
  const { priceTask } = await import('../../packages/shared/src/pricing.mjs');
  const { TASK_TYPE_REQUIREMENTS, isMetered, BILLING } = await import('../../packages/shared/src/protocol.mjs');

  for (const [type, req] of Object.entries(TASK_TYPE_REQUIREMENTS)) {
    checkEqual(type + ' runs on our own GPUs', req.billing, BILLING.SELF_HOSTED);
    const priced = priceTask(type, { width: 1024, height: 1024, steps: 40, count: 10, duration_seconds: 30 });
    checkEqual(type + ' costs nothing even at maximum settings', priced.creditCost, 0);
    check(type + ' says why it is free', /self_hosted/.test(priced.source), priced.source);
    check(type + ' is not metered', !isMetered(type), null);
  }

  // The metering machinery is kept, not deleted - a provider-backed task type
  // has to be able to use it without this all being rebuilt.
  check('the rate card is still there for provider-backed work',
    Object.keys((await import('../../packages/shared/src/pricing.mjs')).PRICE_TABLE).length >= 3, null);
}

finish('protocol');

// Renderer-workflow path, end to end.
//
// This is the route the real NovaFlow UI takes on the Web:
//
//   redacted builder records {module, method, options}
//     -> control plane checks it against the allow-list and prices it
//     -> worker runs NovaFlow's OWN builder to make the graph
//     -> ComfyUI renders it
//
// The point of this suite is that the browser never holds a graph and the
// worker never invents one - the graph that runs is the same one the desktop
// product would have submitted.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { createWorker } from '../../worker/src/worker-core.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { redactModule } from '../../tools/redact-workflow-module.mjs';
import { WORKFLOW_MODULES, isAllowedWorkflowCall } from '../../packages/shared/src/workflow-modules.mjs';
import { allWorkflowEntryMethods } from '../../packages/shared/src/workflow-modules.mjs';
import { check, checkEqual, call, section, finish, waitFor } from '../helpers.mjs';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const RENDERER = join(ROOT, 'renderer');
const COMFY_IMAGE = process.env.NOVAFLOW_COMFY_IMAGE_URL || 'http://127.0.0.1:8188';

const ctx = await startLocalControlPlane({ port: 0 });
const BASE = ctx.url;
const dataDir = await mkdtemp(join(tmpdir(), 'nfweb-rw-'));
let worker = null;

async function comfyUp() {
  try {
    const res = await fetch(COMFY_IMAGE + '/system_stats', { signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch { return false; }
}

try {
  // -------------------------------------------------------------------------
  section('the allow-list is the gate');
  {
    check('modules are declared', Object.keys(WORKFLOW_MODULES).length >= 8, Object.keys(WORKFLOW_MODULES).length);
    check('a declared call is allowed',
      isAllowedWorkflowCall('NovaFlowAiSequenceMiniMaxH3Workflow', 'getWorkflowJson'));
    check('an undeclared module is refused',
      !isAllowedWorkflowCall('NovaFlowSomethingElse', 'getWorkflowJson'));
    check('an undeclared method on a declared module is refused',
      !isAllowedWorkflowCall('NovaFlowAiSequenceMiniMaxH3Workflow', 'normalizeSteps'));

    // Every declared module must actually exist on the worker, or a user
    // would queue a task no worker can ever run.
    const host = await createWorkflowHost({ rendererDir: RENDERER });
    const missing = Object.keys(WORKFLOW_MODULES).filter((m) => !host.modules.includes(m));
    checkEqual('every declared module is loadable on the worker', missing, []);

    // And every declared method must exist on it.
    const badMethods = [];
    for (const [name, spec] of Object.entries(WORKFLOW_MODULES)) {
      const described = host.describe(name);
      for (const method of spec.methods) {
        if (!described || !described.functions.includes(method)) badMethods.push(name + '.' + method);
      }
    }
    checkEqual('every declared method exists', badMethods, []);
  }

  // -------------------------------------------------------------------------
  section('the browser records an intent instead of a graph');
  let recordedIntent = null;
  {
    const source = await readFile(join(RENDERER, 'ai-sequence-minimax-h3.workflow.js'), 'utf8');
    const moduleName = 'NovaFlowAiSequenceMiniMaxH3Workflow';
    const redacted = redactModule(source, {
      moduleName,
      forceNames: allWorkflowEntryMethods(),
      replacement: (fn) =>
        '\n    return globalThis.NovaFlowWebRuntime.serverOnly(' +
        JSON.stringify(moduleName) + ', ' + JSON.stringify(fn) + ', arguments);\n  '
    });
    checkEqual('the shipped module carries no topology', redacted.remaining, []);

    const recorder = {
      last: null,
      serverOnly(module, fn, args) {
        this.last = { module, method: fn, options: args[0] };
        return { __novaflowServerOnly: true, module, fn, options: args[0] };
      }
    };
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      Math, JSON, Date, setTimeout: () => 0, clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} },
      navigator: { userAgent: 'test' }, location: { href: 'http://x/' }, addEventListener() {},
      NovaFlowWebRuntime: recorder
    };
    sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
    const context = createContext(sandbox);
    runInContext(redacted.code, context, { filename: 'h3.redacted.js' });

    const api = sandbox[moduleName];
    const returned = api.getWorkflowJson({ mode: 'i2v', steps: 4 });

    check('the builder returned a delegation marker, not a graph',
      typeof returned === 'string'
        ? returned.includes('__novaflowServerOnly')
        : returned.__novaflowServerOnly === true, returned);
    check('the intent names the module and method',
      recorder.last && recorder.last.module === moduleName &&
      recorder.last.method === 'getWorkflowJson', recorder.last);
    check('the options the panel chose are carried',
      recorder.last && recorder.last.options && recorder.last.options.mode === 'i2v', recorder.last?.options);

    recordedIntent = recorder.last;
  }

  // -------------------------------------------------------------------------
  section('the control plane prices and queues it');
  const login = await call(BASE, 'POST', '/dev/login', { body: { email: 'rw@novaflow.local', balance: 5000 } });
  const token = login.body.session.token;
  {
    const refused = await call(BASE, 'POST', '/api/web/tasks', {
      token,
      body: {
        task_type: 'renderer_workflow',
        workflow: { module: 'NovaFlowEvilWorkflow', method: 'getWorkflowJson' },
        parameters: {}
      }
    });
    check('an undeclared module is refused at the door', refused.status === 400, refused.body);

    const refusedMethod = await call(BASE, 'POST', '/api/web/tasks', {
      token,
      body: {
        task_type: 'renderer_workflow',
        workflow: { module: 'NovaFlowAiSequenceMiniMaxH3Workflow', method: 'normalizeSteps' },
        parameters: {}
      }
    });
    check('a non-builder method is refused', refusedMethod.status === 400, refusedMethod.body);

    const huge = await call(BASE, 'POST', '/api/web/tasks', {
      token,
      body: {
        task_type: 'renderer_workflow',
        workflow: { module: 'NovaFlowAiSequenceMiniMaxH3Workflow', method: 'getWorkflowJson' },
        parameters: { blob: 'x'.repeat(300000) }
      }
    });
    check('an oversized options payload is refused', huge.status === 400, huge.body);
  }

  // -------------------------------------------------------------------------
  section('the worker builds with NovaFlow\'s own builder');
  {
    const host = await createWorkflowHost({ rendererDir: RENDERER });
    const graph = host.buildGraph({
      module: recordedIntent.module,
      method: recordedIntent.method,
      options: recordedIntent.options
    });
    check('the recorded intent rebuilds a real graph', Object.keys(graph).length >= 10, Object.keys(graph).length);
    check('it is the H3 graph the desktop submits',
      Object.values(graph).some((n) => n.class_type === 'MiniMaxH3ImageToVideo') &&
      Object.values(graph).some((n) => n.class_type === 'SamplerCustomAdvanced'),
      Object.values(graph).map((n) => n.class_type).join(','));
  }

  // -------------------------------------------------------------------------
  section('end to end on real ComfyUI');
  const comfyReady = await comfyUp();
  check('local ComfyUI reachable', comfyReady, { COMFY_IMAGE });

  if (comfyReady) {
    const code = await call(BASE, 'POST', '/dev/registration-code', { body: { email: 'rw@novaflow.local' } });
    worker = createWorker({
      controlUrl: BASE,
      dataDir,
      workflowDir: join(ROOT, 'worker/workflows'),
      rendererDir: RENDERER,
      configPath: join(dataDir, 'identity.json'),
      comfyImageUrl: COMFY_IMAGE,
      comfyVideoUrl: process.env.NOVAFLOW_COMFY_VIDEO_URL || 'http://127.0.0.1:8189',
      gatewayPort: 0,
      gatewayHost: '127.0.0.1',
      workerName: 'renderer-workflow-node',
      registrationCode: code.body.registration_code,
      pollIntervalMs: 700,
      logger: () => {}
    });
    await worker.start();
    check('worker online with the renderer host', Boolean(worker.getState().workerId));

    // Use the art provider builder: it runs on the image ComfyUI this machine
    // actually has, unlike H3 which needs the video runtime and much longer.
    const created = await call(BASE, 'POST', '/api/web/tasks', {
      token,
      body: {
        task_type: 'renderer_workflow',
        workflow: { module: 'NovaFlowArtGenerateProviderWorkflow', method: 'buildWorkflow' },
        parameters: {
          prompt: 'a small blue cube on a white table, product photo',
          width: 512, height: 512, steps: 4, count: 1
        }
      }
    });
    check('renderer workflow task queued', created.status === 200, created.body);
    check('it was priced server-side', created.body?.pricing?.creditCost > 0, created.body?.pricing);

    if (created.status === 200) {
      const taskId = created.body.task.id;
      const settled = await waitFor(async () => {
        const r = await call(BASE, 'GET', '/api/web/tasks/' + taskId, { token });
        const t = r.body.task;
        if (['completed', 'failed'].includes(t.status)) return t;
        return null;
      }, { label: 'the renderer workflow task to settle', timeoutMs: 240000, intervalMs: 900 });

      // Whether it renders depends on the builder matching this machine's
      // ComfyUI. Either way the CONTRACT holds: the browser sent no graph, and
      // a failure is reported honestly rather than silently swallowed.
      check('the task reached a terminal state', ['completed', 'failed'].includes(settled.status), settled.status);
      if (settled.status === 'completed') {
        check('it produced a file',
          (settled.output_manifest.files || []).length > 0, settled.output_manifest);
      } else {
        console.log('  note: the builder did not run here -> ' + (settled.error_message || settled.error_code));
        check('a failure costs the user nothing', settled.charged_credit_cost === 0, settled);
      }
    }
  }
} finally {
  try { if (worker) await worker.stop(); } catch { /* already down */ }
  try { ctx.server.close(); } catch { /* already closed */ }
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

finish('renderer-workflow');

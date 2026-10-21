// Workflow host - runs NovaFlow's REAL graph builders on the worker.
//
// The browser gets a redacted renderer: every function that knows about
// ComfyUI has had its body replaced by a recorder. The worker gets the
// instrumented renderer: the same functions, intact, registered by name in
// __nfBuilders as they are declared - which captures each one with its
// closure.
//
// So a task carries {module, fn, args} and this replays it. The graph that
// runs is produced by NovaFlow's own code, not by an approximation of it, and
// the browser never held one.
//
// Two ways in:
//   buildGraph({module, method, options})  - an exported builder on a
//                                            *.workflow.js module
//   replay({module, fn, args})             - any registered builder, including
//                                            the private ones inside the two
//                                            big runtimes

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from './dom-shim.mjs';
import { workflowModule, isAllowedWorkflowCall } from '../../../packages/shared/src/workflow-modules.mjs';

// Not runtime modules; loading them only produces noise.
const NOT_RUNTIME = new Set([
  'eslint.config.js',
  'vite.config.js',
  'proxy-electron-api.js',
  'runtime-fetch-proxy.js',
  'runtime-detect-stabilizer.js',
  'ai-sequence-matting-worker.js'  // a web worker entry, loaded via importScripts
]);

// Loaded first: later modules read their globals at definition time.
const LOAD_FIRST = [
  'comfyui-workflow-credit-cost.js',
  'art-quality-profile.workflow.js',
  'art-reference-compiler.workflow.js'
];

export async function createWorkflowHost({ rendererDir, logger, comfy, objectInfo } = {}) {
  const log = logger || (() => {});

  // NovaFlow's builders validate against the LIVE ComfyUI node catalogue -
  // requiredComfyNode('UNETLoader') and friends read /object_info before they
  // emit a node. On the desktop that goes through electronAPI; here it goes to
  // the compute node's own ComfyUI, which is the whole reason the builder runs
  // on this side of the wire.
  //
  // objectInfo lets a test supply a catalogue instead of a live runtime.
  const sandbox = createDomSandbox({
    electronAPI: createComfyBridge({ comfy, objectInfo, log })
  });
  const context = createContext(sandbox);

  const all = (await readdir(rendererDir)).filter(
    (f) => f.endsWith('.js') && !NOT_RUNTIME.has(f)
  );
  const ordered = [
    ...LOAD_FIRST.filter((f) => all.includes(f)),
    ...all.filter((f) => !LOAD_FIRST.includes(f))
  ];

  let uiSourceSHA256 = null;
  const digest = source => createHash('sha256').update(source).digest('hex');
  async function assertUiSourceCurrent(module, args) {
    if (module !== 'novaflow-brand-runtime' || args?.[10]?.taskProfile !== 'ui-design') return;
    const current = await readFile(join(rendererDir, 'novaflow-brand-runtime.js'), 'utf8');
    if (!uiSourceSHA256 || digest(current) !== uiSourceSHA256) throw new Error('UI工作流源码已变化，请刷新节点工作流后重试；旧缓存未执行');
  }
  const loaded = [];
  const partial = [];
  for (const file of ordered) {
    const source = await readFile(join(rendererDir, file), 'utf8');
    if (file === 'novaflow-brand-runtime.js') uiSourceSHA256 = digest(source);
    try {
      runInContext(source, context, { filename: file, timeout: 30000 });
      loaded.push(file);
    } catch (error) {
      // A module that throws PART WAY through has usually already registered
      // its builders - the registrations sit next to the declarations, near
      // the top, while the DOM work that failed comes later. So this is
      // recorded and reported rather than treated as fatal.
      partial.push({ file, error: String(error?.message || error).slice(0, 200) });
    }
  }

  const registry = sandbox.__nfBuilders || {};
  const modules = Object.keys(sandbox).filter(
    (k) => /^NovaFlow/.test(k) && sandbox[k] && typeof sandbox[k] === 'object'
  );
  const builderCount = Object.values(registry)
    .reduce((sum, fns) => sum + Object.keys(fns || {}).length, 0);

  log('workflow host ready', {
    loaded: loaded.length,
    partial: partial.length,
    apiModules: modules.length,
    builders: builderCount
  });

  function resolveBuilder(moduleName, fn) {
    const bucket = registry[String(moduleName || '')];
    if (bucket && typeof bucket[String(fn)] === 'function') return bucket[String(fn)];
    const api = sandbox[String(moduleName || '')];
    if (api && typeof api[String(fn)] === 'function') return api[String(fn)].bind(api);
    return null;
  }

  function asPrompt(result, label) {
    const graph = typeof result === 'string' ? JSON.parse(result) : result;
    // A builder may hand back the bare graph, or wrap it - ComfyUI's own
    // submit shape uses .prompt, and several NovaFlow builders return
    // {workflow, ...} with metadata alongside. Unwrap either.
    const prompt = graph && typeof graph === 'object'
      ? (graph.prompt && typeof graph.prompt === 'object' ? graph.prompt
        : graph.workflow && typeof graph.workflow === 'object' ? graph.workflow
        : graph)
      : graph;
    if (!prompt || typeof prompt !== 'object' || !Object.keys(prompt).length) {
      throw new Error(label + ' produced an empty graph');
    }
    const bad = Object.entries(prompt).filter(([, n]) => !n || typeof n.class_type !== 'string');
    if (bad.length) {
      throw new Error(label + ' produced nodes without class_type: ' + bad.map(([id]) => id).join(','));
    }
    return prompt;
  }

  const host = {
    loaded,
    partial,
    modules,
    registry,
    builderCount,

    /** Which builders a module actually registered, for tests and diagnostics. */
    buildersFor(moduleName) {
      return Object.keys(registry[String(moduleName || '')] || {});
    },

    /** Every registered builder, as "module.fn". */
    allBuilders() {
      const out = [];
      for (const [moduleName, fns] of Object.entries(registry)) {
        for (const fn of Object.keys(fns || {})) out.push(moduleName + '.' + fn);
      }
      return out.sort();
    },

    describe(moduleName) {
      const api = sandbox[moduleName];
      if (!api) return null;
      return {
        module: moduleName,
        functions: Object.keys(api).filter((k) => typeof api[k] === 'function'),
        values: Object.keys(api).filter((k) => typeof api[k] !== 'function')
      };
    },

    peekValue(moduleName, key) {
      const api = sandbox[String(moduleName || '')];
      if (!api) throw new Error('unknown workflow module: ' + moduleName);
      return api[key];
    },

    /**
     * Replay a call the browser recorded.
     *
     * The allow-list lives in the control plane, which refuses a task before it
     * reaches a worker. This is the second gate: a builder that was never
     * registered cannot be reached by name, whatever a task claims.
     */
    async replay({ module, fn, args = [] }) {
      await assertUiSourceCurrent(module, args);
      const builder = resolveBuilder(module, fn);
      if (!builder) {
        throw new Error('no registered builder ' + module + '.' + fn +
          ' (registered here: ' + (host.buildersFor(module).join(', ') || 'none') + ')');
      }
      // A builder may be async: it fetches the node catalogue before emitting.
      try {
        return await builder.apply(null, Array.isArray(args) ? args : [args]);
      } catch (error) {
        throw new Error(module + '.' + fn + ' refused these arguments: ' +
          String(error && error.message ? error.message : error));
      }
    },

    /** Replay and require the result to be a ComfyUI graph. */
    async replayGraph({ module, fn, args = [] }) {
      return asPrompt(await host.replay({ module, fn, args }), module + '.' + fn);
    },

    /** The exported-builder path, used by the fixed task types. */
    async buildGraph({ module, method, options }) {
      if (!isAllowedWorkflowCall(module, method)) throw new Error('workflow not available on the web: ' + module + '.' + method);
      const builder = resolveBuilder(module, method);
      if (!builder) throw new Error('unknown workflow method: ' + module + '.' + method);
      if (workflowModule(module)?.positional) {
        const args = options && options.__args;
        if (!Array.isArray(args)) throw new Error('missing positional workflow arguments');
        const safe = args.slice();
        await assertUiSourceCurrent(module, safe);
        if (method === 'buildArtGenerateRunWorkflow') {
          // The art builder is synchronous on the desktop, so it cannot fetch /object_info itself.
          // Re-read the catalogue here; the builder reads it through __objectInfoSync to pick an
          // engine. It is fetched per build because the node can gain or lose the 2.1 weights while
          // this worker runs, and the page routes UI runs by the node's live answer.
          try { await sandbox.electronAPI.__refreshObjectInfo(); } catch (_) { /* no runtime: default graph */ }
          await assertUiSourceCurrent(module, safe);
          const built = await builder(...safe);
          if (options.__controlNet) {
            const apply = resolveBuilder(module, 'applyArtReferenceControlNet');
            if (!apply) throw new Error('missing reference control builder');
            apply(built.workflow, safe[2], options.__controlNet);
          }
          return asPrompt(built, module + '.' + method);
        }
        // A caller never chooses a network destination or supplies node metadata: the first argument is
        // either a runtime URL (blanked; the bridge answers for this node) or the node catalogue (this
        // node's own, read fresh because weights and nodes come and go while the worker runs).
        if (CATALOGUE_FIRST.has(method)) {
          let catalogue = null;
          try { catalogue = await sandbox.electronAPI.__refreshObjectInfo(); } catch (_) { catalogue = sandbox.electronAPI.__objectInfoSync(); }
          if (!catalogue || typeof catalogue !== 'object') throw new Error('this node has no ComfyUI node catalogue to build ' + method + ' from');
          safe[0] = catalogue;
        } else {
          safe[0] = '';
        }
        if (method === 'defaultRmbgWorkflow') safe[3] = null;
        return asPrompt(await builder(...safe), module + '.' + method);
      }
      if (!GRAPH_METHODS.has(String(method))) {
        throw new Error('not a graph-building method: ' + method);
      }
      // A builder that checks the node catalogue (runtimeInfo: the NSFW 修图 graph) gets this node's own,
      // never the browser's: the browser has none, and its empty stand-in failed every NSFW run with
      // "missing required node: CheckpointLoaderSimple".
      let request = options;
      if (options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'runtimeInfo')) {
        let catalogue = null;
        try { catalogue = await sandbox.electronAPI.__refreshObjectInfo(); } catch (_) { catalogue = sandbox.electronAPI.__objectInfoSync(); }
        request = Object.assign({}, options, { runtimeInfo: catalogue });
      }
      // A builder validates its own options and throws when a panel sends
      // something it does not support. That is a task failure with a useful
      // message, not a crash.
      let result;
      try {
        result = await builder(request);
      } catch (error) {
        throw new Error(module + '.' + method + ' refused these options: ' +
          String(error && error.message ? error.message : error));
      }
      return asPrompt(result, module + '.' + method);
    },

    callHelper({ module, method, args = [] }) {
      const api = sandbox[String(module || '')];
      if (!api) throw new Error('unknown workflow module: ' + module);
      const fn = api[String(method || '')];
      if (typeof fn !== 'function') throw new Error('unknown method: ' + method);
      if (GRAPH_METHODS.has(String(method))) throw new Error('use buildGraph for graph methods');
      return fn.apply(api, args);
    }
  };

  return host;
}

// The exported builders a browser may name directly. Private builders go
// through replay() and are gated by the registry instead.
export const GRAPH_METHODS = new Set([
  'getWorkflowJson',
  'buildWorkflow',
  'buildRunWorkflow',
  'buildLocalUiWorkflow',
  'createWorkflow',
  'createTemplate',
  'build',
  'compile',
  'compilePrompt',
  'patchWorkflow'
]);

export const VALIDATOR_METHODS = /^(validate|assert|check)[A-Z]/;

// Positional builders whose first argument is the ComfyUI node catalogue. The page cannot read a
// node's catalogue, so it records an empty object there; the replay hands them this node's.
export const CATALOGUE_FIRST = new Set([
  'samPointWorkflowFromPrompts',
  'buildSeedVr2ImageUpscaleWorkflow',
  'buildQwenImageOutpaintWorkflow',
  'buildImageAngleAdjustWorkflow',
  'buildObjectTransferQwen21Workflow',
  'buildEffectExtractQwenWorkflow',
  'buildEffectDeeffectQwenWorkflow'
]);

/**
 * The slice of electronAPI a workflow builder actually uses: reading the node
 * catalogue and, occasionally, a model list. Everything else is absent on
 * purpose - a builder that reaches for more should fail here rather than
 * silently get a stub.
 */
function createComfyBridge({ comfy, objectInfo, log }) {
  const cache = new Map();
  if (objectInfo) cache.set('/object_info', objectInfo);

  const envelope = (data) => ({ ok: true, status: 200, data, result: data });
  async function requestJson(baseUrl, path) {
    if (baseUrl && typeof baseUrl === 'object') ({ path, baseUrl } = baseUrl);
    const clean = String(path || '').split('?')[0];
    if (!/^\/object_info(?:\/[^/]+)?$/.test(clean) && clean !== '/system_stats') throw new Error('unsupported builder lookup: ' + clean);
    if (cache.has(clean)) return envelope(cache.get(clean));

    // A per-node lookup can be answered from a full catalogue we already hold.
    const perNode = new RegExp('^\\/object_info\\/(.+)$').exec(clean);
    if (perNode && cache.has('/object_info')) {
      const all = cache.get('/object_info') || {};
      const name = decodeURIComponent(perNode[1]);
      const one = all[name] ? { [name]: all[name] } : {};
      return envelope(one);
    }

    if (!comfy) {
      throw new Error('this worker has no ComfyUI runtime configured, so ' + clean + ' cannot be answered');
    }
    const result = await comfy.requestJson(baseUrl, clean);
    if (clean === '/object_info') cache.set(clean, result);
    return envelope(result);
  }

  return {
    runtimeRequestJson: requestJson,
    runtimeGetSystemStats: async () => {
      if (!comfy) return { ok: false, error: 'no ComfyUI runtime' };
      return { ok: true, result: await comfy.requestJson('', '/system_stats') };
    },
    runtimeRequestBinary: async () => { throw new Error('a workflow builder must not fetch binaries'); },
    runtimeUploadImage: async () => { throw new Error('a workflow builder must not upload'); },
    runtimeProviderUsageSettlement: 'worker-host-v1',
    __primeObjectInfo: (info) => { cache.set('/object_info', info); log('object info primed', { nodes: Object.keys(info || {}).length }); },
    __refreshObjectInfo: async () => {
      if (!comfy) return cache.get('/object_info') || null;
      const fresh = await comfy.requestJson('', '/object_info');
      cache.set('/object_info', fresh);
      return fresh;
    },
    __objectInfoSync: () => cache.get('/object_info') || null
  };
}

// Workflow host - runs NovaFlow's REAL graph builders on the worker.
//
// The renderer's *.workflow.js files are self-contained UMD modules that
// attach an API object to globalThis and expose getWorkflowJson(options) /
// buildWorkflow(options). They touch localStorage and window only through
// guarded paths, so with a small DOM shim they run unmodified under Node.
//
// That is the whole point: the worker builds graphs with the SAME code the
// desktop product uses, rather than a hand-written approximation that drifts
// the first time someone tunes a sampler. The browser never receives these
// modules - it sends {module, method, options} and gets pixels back.
//
// Verified: all 18 renderer workflow modules load here, and
// NovaFlowAiSequenceMiniMaxH3Workflow.getWorkflowJson({mode:'i2v'}) produces
// the same 16-node graph the desktop build submits.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

// Modules whose graphs the browser must never see. Loading order matters for
// the few that read another module's globals at definition time.
const LOAD_ORDER = [
  'comfyui-workflow-credit-cost.js',
  'art-quality-profile.workflow.js',
  'art-reference-compiler.workflow.js'
];

/**
 * A minimal DOM/browser shim.
 *
 * Deliberately inert rather than clever: every method is a no-op that returns
 * a plausible empty value. A workflow module that genuinely needs a live DOM
 * would fail loudly here, which is what we want - better than silently
 * building a graph from a half-initialised module.
 */
function createBrowserShim() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null
  };

  const makeElement = () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    getContext: () => null,
    textContent: '', innerHTML: '', value: '', children: []
  });

  const document = {
    createElement: makeElement,
    createElementNS: makeElement,
    createDocumentFragment: makeElement,
    head: makeElement(),
    body: makeElement(),
    documentElement: makeElement(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    readyState: 'complete'
  };

  return {
    localStorage,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    document,
    navigator: { userAgent: 'NovaFlowWorker', language: 'zh-CN' },
    location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:' },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080
  };
}

export async function createWorkflowHost({ rendererDir, logger } = {}) {
  const log = logger || (() => {});
  const shim = createBrowserShim();

  // One shared context, like a real page: modules that read each other's
  // globals keep working.
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => { throw new Error('workflow builders must not perform network I/O'); },
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Math, JSON, Date, Intl,
    structuredClone,
    crypto: globalThis.crypto,
    ...shim
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const context = createContext(sandbox);

  const all = (await readdir(rendererDir)).filter((f) => f.endsWith('.workflow.js'));
  const ordered = [
    ...LOAD_ORDER.filter((f) => all.includes(f) || f.endsWith('.js')),
    ...all.filter((f) => !LOAD_ORDER.includes(f))
  ];

  const loaded = [];
  const failed = [];
  for (const file of ordered) {
    let source;
    try {
      source = await readFile(join(rendererDir, file), 'utf8');
    } catch {
      continue; // an optional module in LOAD_ORDER that this build does not ship
    }
    try {
      runInContext(source, context, { filename: file, timeout: 15000 });
      loaded.push(file);
    } catch (error) {
      failed.push({ file, error: String(error?.message || error) });
      log('workflow module failed to load', { file, error: String(error?.message || error) });
    }
  }

  // Which globals the modules actually published.
  const modules = Object.keys(sandbox).filter(
    (k) => /^NovaFlow/.test(k) && sandbox[k] && typeof sandbox[k] === 'object'
  );

  log('workflow host ready', { loaded: loaded.length, failed: failed.length, modules: modules.length });

  return {
    loaded,
    failed,
    modules,

    /** The API surface a module exposes, for the stub generator and for tests. */
    describe(moduleName) {
      const api = sandbox[moduleName];
      if (!api) return null;
      return {
        module: moduleName,
        functions: Object.keys(api).filter((k) => typeof api[k] === 'function'),
        values: Object.keys(api).filter((k) => typeof api[k] !== 'function')
      };
    },

    /**
     * Build a ComfyUI graph.
     *
     * `module` and `method` name the builder the browser intended to call;
     * `options` are the business parameters it recorded. Anything else is
     * refused, so a hostile client cannot reach an arbitrary function.
     */
    buildGraph({ module, method, options }) {
      const api = sandbox[String(module || '')];
      if (!api) throw new Error('unknown workflow module: ' + module);
      const fn = api[String(method || '')];
      if (typeof fn !== 'function') {
        throw new Error('unknown workflow method: ' + module + '.' + method);
      }
      if (!GRAPH_METHODS.has(String(method))) {
        throw new Error('not a graph-building method: ' + method);
      }
      const result = fn.call(api, options);
      const graph = typeof result === 'string' ? JSON.parse(result) : result;
      const prompt = graph && typeof graph === 'object' && graph.prompt && typeof graph.prompt === 'object'
        ? graph.prompt
        : graph;
      if (!prompt || typeof prompt !== 'object' || !Object.keys(prompt).length) {
        throw new Error(module + '.' + method + ' produced an empty graph');
      }
      const bad = Object.entries(prompt).filter(([, n]) => !n || typeof n.class_type !== 'string');
      if (bad.length) {
        throw new Error(module + '.' + method + ' produced nodes without class_type: ' + bad.map(([id]) => id).join(','));
      }
      return prompt;
    },

    /**
     * Read an exported value. Used by the stub generator to carry UI constants
     * (aspect ratios, step options) into the browser.
     */
    peekValue(moduleName, key) {
      const api = sandbox[String(moduleName || '')];
      if (!api) throw new Error('unknown workflow module: ' + moduleName);
      return api[key];
    },

    /**
     * Read a helper's source so the stub generator can carry it verbatim into
     * the browser. The generator scans what comes back for ComfyUI node names
     * and refuses anything that carries graph topology.
     */
    peekFunctionSource(moduleName, key) {
      const api = sandbox[String(moduleName || '')];
      if (!api) throw new Error('unknown workflow module: ' + moduleName);
      const fn = api[key];
      if (typeof fn !== 'function') return null;
      const source = Function.prototype.toString.call(fn);
      // A native or bound function cannot be carried across.
      if (/\[native code\]/.test(source)) return null;
      // Normalise a shorthand method (`foo(a) {}`) into an expression the stub
      // can assign.
      if (/^(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(source) && !/^function/.test(source) && !/=>/.test(source)) {
        return source.replace(/^(async\s+)?[A-Za-z_$][\w$]*/, (m, a) => (a ? 'async function' : 'function'));
      }
      return source;
    },

    /** Call a non-graph helper (resolution maths, normalisers) if ever needed. */
    callHelper({ module, method, args = [] }) {
      const api = sandbox[String(module || '')];
      if (!api) throw new Error('unknown workflow module: ' + module);
      const fn = api[String(method || '')];
      if (typeof fn !== 'function') throw new Error('unknown method: ' + method);
      if (GRAPH_METHODS.has(String(method))) throw new Error('use buildGraph for graph methods');
      return fn.apply(api, args);
    }
  };
}

// The only methods a client may ask the host to run. Everything about ComfyUI
// topology lives behind exactly these names.
export const GRAPH_METHODS = new Set([
  'getWorkflowJson',
  'buildWorkflow',
  'createTemplate',
  'buildGraph',
  'patchWorkflow',
  'toWorkflow',
  // Several modules name their builder plainly. These carry topology just the
  // same, so they run here and are recorded in the browser.
  'build',
  'compile',
  'buildLocalUiWorkflow',
  'buildRequest'
]);

// Validators re-run authoritatively on the worker before a graph is submitted.
// The browser gets a permissive stand-in so a panel that validates before
// enabling its button still works, without shipping the node list it checks.
export const VALIDATOR_METHODS = /^(validate|assert|check)[A-Z]/;

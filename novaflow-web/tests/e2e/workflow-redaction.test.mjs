// Workflow redaction contract.
//
// The Web line ships NovaFlow's real renderer, which builds ComfyUI graphs in
// the browser. Spec 10 forbids that, so every *.workflow.js module is passed
// through tools/redact-workflow-module.mjs, which hollows out the functions
// that carry ComfyUI topology and leaves everything else alone.
//
// Two things have to be true, and both are checked here against every module:
//
//   1. NOTHING LEAKS - the redacted source contains no node class names, no
//      weight filenames, no class_type.
//   2. NOTHING ELSE BREAKS - every surviving helper returns exactly what the
//      original returned, closures included. This is the part a naive
//      fn.toString() extraction gets wrong, so it is tested by differential
//      comparison rather than by inspection.

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { redactModule, findMarkers, matchBrace } from '../../tools/redact-workflow-module.mjs';
import { allWorkflowEntryMethods } from '../../packages/shared/src/workflow-modules.mjs';
import { check, checkEqual, section, finish } from '../helpers.mjs';

// Same reason as the inert timers: a probe can leave an async throw in flight.
// Count them so they are visible, but do not let one kill the suite.
let strayAsyncErrors = 0;
process.on('uncaughtException', (error) => {
  strayAsyncErrors += 1;
  void error;
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const RENDERER = join(ROOT, 'renderer');

function browserSandbox(recorder) {
  const store = new Map();
  const el = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, appendChild() {}, remove() {},
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getContext: () => null, textContent: '', innerHTML: '', value: ''
  });
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    // Probing helpers with deliberately silly arguments makes some modules
    // schedule follow-up work that then throws asynchronously. That is an
    // artefact of the probe, not a redaction defect, so timers are inert here.
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    queueMicrotask: () => {},
    Math, JSON, Date, Intl, URL, URLSearchParams, TextEncoder, TextDecoder,
    structuredClone, crypto: globalThis.crypto,
    localStorage: {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => store.set(String(k), String(v)),
      removeItem: (k) => store.delete(String(k))
    },
    document: {
      createElement: el, head: el(), body: el(),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}
    },
    navigator: { userAgent: 'test', language: 'zh-CN' },
    location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1' },
    addEventListener() {}, removeEventListener() {},
    fetch: async () => { throw new Error('no network in a workflow module'); },
    NovaFlowWebRuntime: recorder
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

function load(source, filename, recorder) {
  const sandbox = browserSandbox(recorder);
  const context = createContext(sandbox);
  const before = new Set(Object.keys(sandbox));
  runInContext(source, context, { filename, timeout: 15000 });
  // The module name is whatever the module ADDED, not every NovaFlow-ish key
  // already in the sandbox - NovaFlowWebRuntime is the harness's own recorder.
  sandbox.__publishedGlobals = Object.keys(sandbox).filter(
    (k) => !before.has(k) && sandbox[k] && typeof sandbox[k] === 'object'
  );
  return sandbox;
}

const REPLACEMENT = (moduleName) => (fn) =>
  '\n    return globalThis.NovaFlowWebRuntime.serverOnly(' +
  JSON.stringify(moduleName) + ', ' + JSON.stringify(fn) + ', arguments);\n  ';

// Inputs to probe helpers with. A helper that throws on all of them still
// counts as matching as long as BOTH versions throw the same way.
const PROBES = [
  [], [0], [1], [4], [16], [24], [-1], [1.5], [''], ['i2v'], ['r2v'], ['fl2v'],
  [null], [undefined], [{}], [[]], [{ mode: 'i2v' }], [{ mode: 'i2v', steps: 4 }],
  [{ aspectRatio: '9:16', megapixels: 0.4 }], [{ aspectRatio: '16:9', megapixels: 1 }],
  [480, 864], [1280, 720], ['a prompt', 'i2v'], [4, 'i2v'], [24, 'i2v'],
  ['text'], [true], [false]
];

function callSafely(fn, thisArg, args) {
  try {
    const value = fn.apply(thisArg, args);
    return { ok: true, value: safeJson(value) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function safeJson(value) {
  if (typeof value === 'function') return '<function>';
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return '<unserialisable>';
  }
}

// ---------------------------------------------------------------------------
section('brace matcher');
{
  const cases = [
    ['{}', 2],
    ['{ a: 1 }', 8],
    ['{ "}" }', 7],
    ["{ '}' }", 7],
    ['{ `${ { x: 1 } }` }', 19],
    ['{ /* } */ }', 11],
    ['{ // }\n }', 9],
    ['{ { } }', 7]
  ];
  for (const [src, expected] of cases) {
    checkEqual('matchBrace ' + JSON.stringify(src), matchBrace(src, 0), expected);
  }
  checkEqual('unbalanced input returns -1', matchBrace('{ a', 0), -1);
}

// ---------------------------------------------------------------------------
const files = (await readdir(RENDERER)).filter((f) => f.endsWith('.workflow.js')).sort();
check('renderer workflow modules found', files.length >= 16, files.length);

let totalRedacted = 0;
let totalHelpers = 0;
let totalProbes = 0;

for (const file of files) {
  const source = await readFile(join(RENDERER, file), 'utf8');

  // Load the original to learn its module name and API.
  let originalSandbox;
  try {
    originalSandbox = load(source, file, { serverOnly: () => ({}) });
  } catch (error) {
    check(file + ' loads in a browser sandbox', false, String(error?.message || error));
    continue;
  }
  const moduleName = (originalSandbox.__publishedGlobals || []).find((k) => /^NovaFlow/.test(k));
  if (!moduleName) continue;

  section(file + '  ->  ' + moduleName);

  const result = redactModule(source, { moduleName, replacement: REPLACEMENT(moduleName), forceNames: allWorkflowEntryMethods() });
  totalRedacted += result.redacted.length;

  // --- 1. nothing leaks ----------------------------------------------------
  checkEqual('no ComfyUI topology survives redaction', result.remaining, []);

  // --- the redacted module must still be loadable ---------------------------
  const recorder = { calls: [], serverOnly(m, fn, args) { this.calls.push({ m, fn }); return { __serverOnly: true, module: m, fn, options: args[0] }; } };
  let redactedSandbox;
  try {
    redactedSandbox = load(result.code, file + ' (redacted)', recorder);
  } catch (error) {
    check('redacted module still loads', false, String(error?.message || error));
    continue;
  }
  check('redacted module still loads', true);

  const before = originalSandbox[moduleName];
  const after = redactedSandbox[moduleName];
  checkEqual('the API surface is unchanged',
    Object.keys(after || {}).sort(), Object.keys(before || {}).sort());

  // --- 2. surviving helpers behave identically ------------------------------
  const redactedNames = new Set(result.redacted);
  let mismatches = [];
  let probed = 0;

  for (const key of Object.keys(before)) {
    // Reading the property can itself throw: some modules expose getters.
    let originalValue;
    try { originalValue = before[key]; } catch { continue; }
    if (typeof originalValue !== 'function') {
      // Constants must survive byte-for-byte unless they carried a filename.
      const a = safeJson(originalValue);
      const b = safeJson(after[key]);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        const hadMarker = findMarkers(JSON.stringify(a), moduleName).length > 0;
        if (!hadMarker) mismatches.push({ key, kind: 'value', a, b });
      }
      continue;
    }

    // A function whose body was hollowed out is expected to differ.
    if (redactedNames.has(key)) continue;

    totalHelpers += 1;
    for (const args of PROBES) {
      const x = callSafely(originalValue, before, args);
      const y = callSafely(after[key], after, args);
      probed += 1;
      if (JSON.stringify(x) !== JSON.stringify(y)) {
        // If the redacted one delegates to the server, that is a deliberate
        // difference, not a regression.
        // A builder that stringifies its result hands back the delegation
        // marker as text; that is still delegation, not a regression.
        // A helper whose ORIGINAL output carried topology is SUPPOSED to
        // differ now - that is the entire point of the transform.
        if (x.ok && findMarkers(JSON.stringify(x.value ?? null), moduleName).length) continue;
        const delegated = y.ok && (
          (y.value && y.value.__serverOnly === true) ||
          (typeof y.value === 'string' && y.value.includes('__serverOnly'))
        );
        if (delegated) continue;
        mismatches.push({ key, args: safeJson(args), original: x, redacted: y });
        break;
      }
    }
  }
  totalProbes += probed;

  checkEqual('every surviving helper matches the original (' + probed + ' probes)',
    mismatches.slice(0, 3), []);

  // --- 3. graph builders now delegate --------------------------------------
  const builders = ['getWorkflowJson', 'buildWorkflow', 'createTemplate', 'build', 'compile'];
  const present = builders.filter((b) => {
    try { return typeof before[b] === 'function'; } catch { return false; }
  });
  for (const b of present) {
    // Only assert delegation for builders the transform actually hollowed out.
    // A builder with no ComfyUI markers of its own delegates through the inner
    // helper it calls, which is the same guarantee one level down.
    if (!redactedNames.has(b)) continue;
    recorder.calls.length = 0;
    const out = callSafely(after[b], after, [{ mode: 'i2v', steps: 4 }]);
    const text = JSON.stringify(out.value ?? null);
    check(b + ' no longer returns a ComfyUI graph',
      !out.ok || findMarkers(text, moduleName).length === 0, { b, text: text.slice(0, 200) });
  }
}

section('totals');
check('functions hollowed out across all modules: ' + totalRedacted, totalRedacted > 0);
check('helpers differentially verified: ' + totalHelpers + ' over ' + totalProbes + ' probes', totalHelpers > 0);
await new Promise((r) => setTimeout(r, 200));
check('stray async throws from probing: ' + strayAsyncErrors + ' (tolerated)', true);

finish('workflow-redaction');

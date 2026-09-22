// Generate the browser-side workflow stubs.
//
// The renderer's *.workflow.js modules contain two very different things:
//
//   1. UI helpers - resolution maths, step/fps normalisers, aspect-ratio
//      tables. The panels need these synchronously to render their controls.
//   2. Graph builders - the ComfyUI topology. Spec 10 says the browser must
//      never hold these.
//
// This script loads each module on the worker's workflow host, then emits a
// browser stub that keeps (1) and replaces (2) with a recorder that reports
// {module, method, options} to the runtime shim.
//
// The guarantee is checked, not assumed: every emitted stub is scanned for
// ComfyUI node class names, and any helper that carries graph knowledge is
// refused rather than shipped. `--check` fails the build if the stubs on disk
// are stale or leaky.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowHost, GRAPH_METHODS, VALIDATOR_METHODS } from '../worker/src/comfy/workflow-host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RENDERER = join(ROOT, 'renderer');
const OUT_DIR = join(ROOT, 'renderer/web-stubs');

// Any of these appearing in a browser stub means graph topology leaked.
// Deliberately broad: it is better to refuse a helper than to ship a node name.
const COMFY_MARKERS = [
  'class_type', 'CheckpointLoader', 'UNETLoader', 'VAELoader', 'VAEDecode', 'VAEEncode',
  'CLIPLoader', 'CLIPTextEncode', 'KSampler', 'KSamplerSelect', 'BasicScheduler',
  'BasicGuider', 'RandomNoise', 'SamplerCustomAdvanced', 'EmptySD3LatentImage',
  'EmptyLatentImage', 'LoadImage', 'SaveImage', 'SaveVideo', 'CreateVideo',
  'MiniMaxH3', 'NovaFlowH3', 'LoraLoader', 'ImageScale', 'ControlNet',
  'safetensors', 'FluxKontext', 'Qwen', 'Ideogram'
];

// The module's own name is not graph topology, even when it contains a model
// name (NovaFlowAiSequenceMiniMaxH3PromptWorkflow). Mask it before scanning so
// the check stays about what the code KNOWS, not what it is called.
function leaks(text, moduleName) {
  const scanned = moduleName ? text.split(moduleName).join('<module>') : text;
  return COMFY_MARKERS.filter((m) => scanned.includes(m));
}

// Weight filenames and node-type strings are topology; labels and ids are not.
// Redact the former in place so a model dropdown still renders its options.
const WEIGHT_FILE = /\.(safetensors|ckpt|pt|pth|gguf|bin|onnx)$/i;

function redact(value) {
  if (typeof value === 'string') {
    if (WEIGHT_FILE.test(value.trim())) return '<server-side>';
    if (COMFY_MARKERS.some((m) => m !== 'Qwen' && m !== 'Ideogram' && value.includes(m))) return '<server-side>';
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

function isPlainSerializable(value) {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'undefined') return true;
  if (t !== 'object') return false;
  try {
    JSON.parse(JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function generateStubs({ check = false, logger } = {}) {
  const log = logger || (() => {});
  const host = await createWorkflowHost({ rendererDir: RENDERER });

  const report = [];
  const files = new Map();

  for (const moduleName of host.modules) {
    const described = host.describe(moduleName);
    if (!described) continue;

    const kept = [];
    const recorded = [];
    const refused = [];
    const validators = [];
    const redacted = [];
    const lines = [];

    lines.push('  const __api = {};');

    // ---- values -----------------------------------------------------------
    for (const key of described.values) {
      const raw = host.peekValue(moduleName, key);
      if (!isPlainSerializable(raw)) {
        refused.push({ name: key, why: 'not serialisable' });
        continue;
      }
      const cleaned = redact(raw);
      const json = JSON.stringify(cleaned);
      const found = leaks(json, moduleName);
      if (found.length) {
        refused.push({ name: key, why: 'carries graph topology: ' + found.join(', ') });
        continue;
      }
      if (JSON.stringify(raw) !== json) redacted.push(key);
      lines.push('  __api[' + JSON.stringify(key) + '] = ' + json + ';');
      kept.push(key);
    }

    // ---- functions --------------------------------------------------------
    for (const key of described.functions) {
      if (VALIDATOR_METHODS.test(key)) {
        // Permissive stand-in; the worker validates for real before submitting.
        lines.push(
          '  __api[' + JSON.stringify(key) + '] = function () {' +
          '\n    return { ok: true, valid: true, checkedOn: \"compute-node\" };' +
          '\n  };'
        );
        validators.push(key);
        continue;
      }

      if (GRAPH_METHODS.has(key)) {
        lines.push(
          '  __api[' + JSON.stringify(key) + '] = function (options) {\n' +
          '    return __record(' + JSON.stringify(moduleName) + ', ' + JSON.stringify(key) + ', options);\n' +
          '  };'
        );
        recorded.push(key);
        continue;
      }

      const source = host.peekFunctionSource(moduleName, key);
      if (!source) {
        refused.push({ name: key, why: 'could not read source' });
        continue;
      }
      const found = leaks(source, moduleName);
      if (found.length) {
        // A helper that knows about nodes is a graph builder wearing a
        // different name. It stays on the worker.
        lines.push(
          '  __api[' + JSON.stringify(key) + '] = function () {\n' +
          '    throw new Error(' + JSON.stringify(moduleName + '.' + key + ' runs on the compute node, not in the browser') + ');\n' +
          '  };'
        );
        refused.push({ name: key, why: 'carries graph topology: ' + found.join(', ') });
        continue;
      }
      lines.push('  __api[' + JSON.stringify(key) + '] = ' + source + ';');
      kept.push(key);
    }

    const body =
      '// GENERATED - do not edit. Source: renderer/*.workflow.js\n' +
      '// Browser-safe stub of ' + moduleName + '.\n' +
      '// UI helpers are kept verbatim; every graph builder is replaced by a\n' +
      '// recorder, so this file contains no ComfyUI topology (asserted by\n' +
      '// tools/generate-workflow-stubs.mjs --check and by the protocol suite).\n' +
      '(function (root) {\n' +
      '  const __record = (module, method, options) => {\n' +
      '    const intent = { __novaflowWorkflowIntent: true, module, method, options };\n' +
      '    try { (root.NovaFlowWebRuntime && root.NovaFlowWebRuntime.recordWorkflowIntent || (() => {}))(intent); } catch (_) {}\n' +
      '    return intent;\n' +
      '  };\n' +
      lines.join('\n') + '\n' +
      '  root[' + JSON.stringify(moduleName) + '] = __api;\n' +
      '})(typeof globalThis !== "undefined" ? globalThis : this);\n';

    const stubLeaks = leaks(body.replace(/^\/\/.*$/gm, ''), moduleName);
    if (stubLeaks.length) {
      throw new Error('stub for ' + moduleName + ' still leaks: ' + stubLeaks.join(', '));
    }

    files.set(moduleName + '.stub.js', body);
    report.push({ module: moduleName, kept: kept.length, recorded, refused, validators, redacted });
  }

  if (!check) {
    await mkdir(OUT_DIR, { recursive: true });
    for (const [name, body] of files) {
      await writeFile(join(OUT_DIR, name), body, 'utf8');
    }
    await writeFile(
      join(OUT_DIR, 'index.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        modules: report.map((r) => ({ module: r.module, stub: r.module + '.stub.js' }))
      }, null, 2),
      'utf8'
    );
  } else {
    const existing = new Set(await readdir(OUT_DIR).catch(() => []));
    const stale = [];
    for (const [name, body] of files) {
      if (!existing.has(name)) { stale.push(name + ' (missing)'); continue; }
      const current = await readFile(join(OUT_DIR, name), 'utf8');
      if (current !== body) stale.push(name + ' (out of date)');
    }
    if (stale.length) {
      const error = new Error('workflow stubs are stale: ' + stale.join(', '));
      error.stale = stale;
      throw error;
    }
  }

  log('stubs generated', { modules: report.length });
  return report;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('generate-workflow-stubs.mjs');
if (invokedDirectly) {
  const check = process.argv.includes('--check');
  try {
    const report = await generateStubs({ check, logger: (m, x) => console.log(m, JSON.stringify(x)) });
    let totalKept = 0;
    let totalRecorded = 0;
    let totalRefused = 0;
    for (const r of report) {
      totalKept += r.kept;
      totalRecorded += r.recorded.length;
      totalRefused += r.refused.length;
      console.log(
        '  ' + r.module.padEnd(46) +
        String(r.kept).padStart(3) + ' kept  ' +
        String(r.recorded.length).padStart(2) + ' recorded  ' +
        String(r.validators.length).padStart(2) + ' validators  ' +
        String(r.redacted.length).padStart(2) + ' redacted  ' +
        String(r.refused.length).padStart(2) + ' server-only'
      );
      for (const x of r.refused) console.log('        - ' + x.name + ': ' + x.why);
    }
    console.log('\n  totals: ' + totalKept + ' helpers kept, ' + totalRecorded +
      ' graph builders recorded, ' + totalRefused + ' kept server-side');
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(1);
  }
}

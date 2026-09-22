// Web renderer build contract.
//
// The build cuts renderer/ into two trees with the same span rules. This
// asserts the properties that make that safe to ship:
//
//   1. everything the browser gets PARSES - the transform rewrites 8.5 MB of
//      somebody else's JavaScript and a brace-matching slip truncates a
//      function silently
//   2. no graph TEMPLATE reaches the browser
//   3. anything the browser can RECORD, the worker can REPLAY
//   4. the shims load LAST, so the renderer keeps the browser implementation
//      it already runs on and only the AI transport is redirected
//   5. the worker's copy still loads and still builds NovaFlow's real graphs

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildWebRenderer, scanForLeaks, checkSyntax, PATHS } from '../../tools/build-web-renderer.mjs';
import { createWorkflowHost } from '../../worker/src/comfy/workflow-host.mjs';
import { findMarkers } from '../../tools/redact-workflow-module.mjs';
import { WORKFLOW_MODULES } from '../../packages/shared/src/workflow-modules.mjs';
import { check, checkEqual, section, finish } from '../helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

// A synthetic node catalogue: NovaFlow's builders validate against the live
// ComfyUI one, and this suite must not require a GPU runtime to be up.
const CATALOGUE_NODES = [
  'UNETLoader', 'VAELoader', 'VAEDecode', 'VAEDecodeAudio', 'VAEEncode',
  'CLIPLoader', 'CLIPTextEncode', 'KSampler', 'KSamplerSelect',
  'BasicScheduler', 'BasicGuider', 'RandomNoise', 'SamplerCustomAdvanced',
  'LoadImage', 'LoadVideo', 'LoadAudio', 'SaveImage', 'SaveVideo',
  'CreateVideo', 'GetVideoComponents', 'EmptySD3LatentImage', 'ImageScale',
  'CheckpointLoaderSimple', 'LoraLoaderModelOnly', 'NovaFlowH3SageAttention',
  'MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo', 'RMBG',
  'TextEncodeQwenImageEdit', 'InpaintModelConditioning', 'DifferentialDiffusion'
];
const objectInfo = Object.fromEntries(
  CATALOGUE_NODES.map((n) => [n, { input: { required: {} }, output: [], name: n }])
);

section('build');
const report = await buildWebRenderer({ clean: true });
check('modules were transformed', report.redactedModules > 0, report.redactedModules);
check('most modules needed nothing', report.copied > 50, report.copied);
check('builders were hollowed out', report.totalRedacted > 20, report.totalRedacted);
check('builders were registered for the worker', report.totalRegistered > 20, report.totalRegistered);

// ---------------------------------------------------------------------------
let webFiles = [];

section('1. everything the browser gets parses');
{
  const bad = await checkSyntax(PATHS.WEB_OUT);
  checkEqual('every file in web-dist parses', bad.map((b) => b.file), []);
  const workerBad = await checkSyntax(PATHS.WORKER_OUT);
  checkEqual('every file in worker-renderer parses', workerBad.map((b) => b.file), []);
}

// ---------------------------------------------------------------------------
section('2. no graph template reaches the browser');
{
  const leaks = await scanForLeaks(PATHS.WEB_OUT);
  const modules = leaks.filter((l) => !l.file.includes('assets'));
  checkEqual('no renderer module carries topology', modules.map((l) => l.file), []);

  // The prebuilt React bundle is minified and gets ONE targeted edit instead
  // of the general transform, so it is measured rather than required to be
  // spotless - what matters is that no GRAPH survives.
  const bundlePath = (await readdir(join(PATHS.WEB_OUT, 'assets')))
    .find((f) => /^index-.*\.js$/.test(f));
  if (bundlePath) {
    const shipped = await readFile(join(PATHS.WEB_OUT, 'assets', bundlePath), 'utf8');
    const original = await readFile(join(PATHS.SRC, 'assets', bundlePath), 'utf8');
    const nodes = (s) => (s.match(/class_type/g) || []).length;
    const weights = (s) => new Set(s.match(/[\w][\w .\\/-]*\.(?:safetensors|ckpt|gguf|pth|onnx)\b/g) || []).size;

    check('the bundle lost most of its node references (' + nodes(original) + ' -> ' + nodes(shipped) + ')',
      nodes(shipped) < nodes(original) / 3, { before: nodes(original), after: nodes(shipped) });
    check('the bundle lost most of its weight filenames (' + weights(original) + ' -> ' + weights(shipped) + ')',
      weights(shipped) < weights(original) / 2, { before: weights(original), after: weights(shipped) });

    // A template holding a whole graph is the thing that must be gone.
    const graphTemplates = [...shipped.matchAll(/`[^`]{2000,}`/g)]
      .filter((m) => (m[0].match(/class_type/g) || []).length >= 3);
    checkEqual('no whole-graph template survives in the bundle', graphTemplates.length, 0);
  }
}

// ---------------------------------------------------------------------------
section('3. anything recordable is replayable');
{
  checkEqual('no module records a call the worker cannot replay',
    report.mismatches.map((m) => m.module + ': ' + m.unreplayable.join(',')), []);
}

// ---------------------------------------------------------------------------
section('4. the shims load last and only override transport');
{
  const html = await readFile(join(PATHS.WEB_OUT, 'index.html'), 'utf8');
  webFiles = await readdir(PATHS.WEB_OUT);
  const runtimeAt = html.indexOf('novaflow-web-runtime.js');
  const proxyAt = html.indexOf('proxy-electron-api.js');
  const bundleAt = html.search(/assets\/index-[A-Za-z0-9_-]+\.js/);

  check('the runtime shim is present exactly once',
    (html.match(/novaflow-web-runtime\.js/g) || []).length === 1);
  check('the capability shim is present exactly once',
    (html.match(/novaflow-web-capabilities\.js/g) || []).length === 1);
  check('the shim loads AFTER proxy-electron-api.js', runtimeAt > proxyAt, { runtimeAt, proxyAt });
  check('the shim loads AFTER the React bundle', runtimeAt > bundleAt, { runtimeAt, bundleAt });
  check('the config block loads BEFORE everything', html.indexOf('NOVAFLOW_WEB_CONFIG') < proxyAt);

  const shim = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-runtime.js'), 'utf8');
  check('the shim overrides rather than replaces electronAPI',
    shim.includes('Override, never replace') || shim.includes('__novaflowWebOverrides'), null);
  check('object_info reports no runtime instead of an empty success',
    /object_info/.test(shim) && /ok: false/.test(shim), null);

  // 我的算力节点: minting a registration code has to be something an owner can
  // do in the app, because the brief forbids reaching for the database.
  check('the compute-node panel is present exactly once',
    (html.match(/novaflow-web-workers-panel\.js/g) || []).length === 1);
  const panel = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-workers-panel.js'), 'utf8');
  check('it mints codes through the app API, not by hand',
    panel.includes('/api/web/workers/codes'), null);
  check('it lists the pool from the control plane',
    panel.includes("'/api/web/workers'"), null);
}

// ---------------------------------------------------------------------------
section('4b. browser-only files stay out of the compute node');
{
  // The worker loads every .js in its tree. The runtime shim overrides
  // runtimeRequestJson - the bridge a builder reads the ComfyUI node catalogue
  // through - and answers /object_info with "not here, 503". That belongs to
  // the browser and would be a lie on a machine that HAS a runtime.
  const workerFiles = await readdir(PATHS.WORKER_OUT);
  checkEqual('no Web-line shim reached worker-renderer',
    workerFiles.filter((f) => f.startsWith('novaflow-web-')), []);
  checkEqual('the build says which files it held back',
    (report.browserOnly || []).slice().sort(),
    ['novaflow-web-capabilities.js', 'novaflow-web-runtime.js', 'novaflow-web-workers-panel.js']);
  for (const file of report.browserOnly || []) {
    check(file + ' did ship to the browser', webFiles.includes(file), webFiles.length);
  }
}

// ---------------------------------------------------------------------------
section('5. the worker copy still builds NovaFlow\'s real graphs');
{
  const host = await createWorkflowHost({ rendererDir: PATHS.WORKER_OUT, objectInfo });
  check('the worker loads the renderer', host.loaded.length > 80, host.loaded.length);
  check('builders are registered', host.builderCount > 50, host.builderCount);

  const missing = Object.keys(WORKFLOW_MODULES).filter((m) => !host.modules.includes(m));
  checkEqual('every allow-listed module is present', missing, []);

  const graph = await host.buildGraph({
    module: 'NovaFlowAiSequenceMiniMaxH3Workflow',
    method: 'getWorkflowJson',
    options: { mode: 'i2v', steps: 4 }
  });
  check('the H3 builder still produces the desktop graph',
    Object.keys(graph).length >= 14 &&
    Object.values(graph).some((n) => n.class_type === 'MiniMaxH3ImageToVideo'),
    Object.keys(graph).length);

  // The private builders inside the two big runtimes must be reachable too -
  // that is the whole point of instrumenting rather than just redacting.
  const splitBuilders = host.buildersFor('spine-split-runtime');
  check('the split runtime registered its private builders (' + splitBuilders.length + ')',
    splitBuilders.length >= 10, splitBuilders.slice(0, 6));
  const shellBuilders = host.buildersFor('novaflow-brand-runtime');
  check('the shell registered its private builders (' + shellBuilders.length + ')',
    shellBuilders.length >= 8, shellBuilders.slice(0, 6));
}

// ---------------------------------------------------------------------------
section('the build is a complete site');
{
  const files = await readdir(PATHS.WEB_OUT);
  check('index.html is present', files.includes('index.html'));
  for (const dir of ['assets', 'templates', 'aifx-styles', 'aifx-templates', 'vendor']) {
    check(dir + '/ was carried across', files.includes(dir), files);
  }
  const html = await readFile(join(PATHS.WEB_OUT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="\.\/([^"?]+)/g)].map((m) => m[1]);
  const absent = [];
  for (const src of scripts) {
    try { await stat(join(PATHS.WEB_OUT, src)); } catch { absent.push(src); }
  }
  checkEqual('every script index.html references exists', absent, []);
  check('the site loads ' + scripts.length + ' scripts', scripts.length > 85, scripts.length);
}

void execFileSync;
void findMarkers;
finish('web-renderer-build');

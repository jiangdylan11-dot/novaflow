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

  // Running a compute pool is an operator's job, not a user's. Minting codes
  // and onboarding machines live in the desktop 后台管理 tool next to 授权 and
  // 积分; someone who opens NovaFlow to draw should see whether compute is
  // available and nothing else.
  check('the app ships no pool-management surface',
    !/workers-panel|workers\/codes/.test(html), null);
  const appFiles = webFiles.filter((f) => f.endsWith('.js'));
  const minting = [];
  for (const file of appFiles) {
    const text = await readFile(join(PATHS.WEB_OUT, file), 'utf8');
    if (text.includes('/api/web/workers/codes')) minting.push(file);
  }
  checkEqual('no shipped file can mint a registration code', minting, []);

  // "Is there compute" has to work before anyone logs in, so it reads the
  // public capabilities endpoint rather than the owner's worker listing.
  const capsShim = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-capabilities.js'), 'utf8');
  check('availability is read from the public endpoint',
    /pollCapacity/.test(capsShim) && /available_workers/.test(capsShim), null);

  // Desktop chrome that cannot work in a tab is hidden rather than shown
  // pretending: the window buttons (the browser has its own) and 释放内存
  // (the VRAM is on somebody else's machine).
  check('the window controls are hidden',
    /\.nf-topbar-right/.test(capsShim) && /\.nf-win-btn/.test(capsShim), null);
  check('the release-memory button is hidden',
    /topbar-ai-runtime-release/.test(capsShim), null);
  check('the licence badge is hidden',
    /\.nf-license-status/.test(capsShim), null);

  // A deployment has to repoint the site at its own control plane. Editing
  // index.html by hand inside a 22 MB tree is how that goes wrong, so it is a
  // command - and the build always emits the local default, which means the
  // command has to be re-run after every rebuild.
  const { readConfig, writeConfig } = await import('../../tools/set-web-config.mjs');
  const built = readConfig(html);
  check('the build emits a readable config block', Boolean(built && built.controlUrl), built);
  checkEqual('and it defaults to the local control plane', built.controlUrl, 'http://127.0.0.1:4890');
  const moved = writeConfig(html, { controlUrl: 'https://example.test/functions/v1/novaflow-web' });
  checkEqual('repointing changes only the control URL',
    readConfig(moved),
    { controlUrl: 'https://example.test/functions/v1/novaflow-web', authUrl: built.authUrl });
  check('and rewrites nothing else', moved.length - html.length === ('https://example.test/functions/v1/novaflow-web'.length - built.controlUrl.length),
    { before: html.length, after: moved.length });
  check('and freeing memory does not claim to have freed any',
    /freed: false/.test(capsShim) && !/freed: true/.test(capsShim), null);

  // The desktop licence binds to a MACHINE CODE. A browser tab has no machine,
  // so there is nothing to bind and no file anyone could issue - a licence gate
  // on the Web is a form that can never succeed. Entitlement here is the
  // account, checked on every generate call by the control plane.
  const caps = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-capabilities.js'), 'utf8');
  check('the Web reports licensed without a licence file',
    /status: 'licensed'/.test(caps) && !/unlicensed/.test(caps), null);
  check('and never sends anyone to a machine-code form',
    !/licenseImport = async \(\) => fail/.test(caps), null);
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
    ['novaflow-web-account.js', 'novaflow-web-capabilities.js', 'novaflow-web-runtime.js']);
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
section('nothing tells a browser user to install a runtime');
{
  // A friend opened the site, switched to AI 序列, and was told
  // "未找到 MiniMax H3 Runtime（8189），请确认已安装并启动" - advice about
  // software they are not meant to install, about a port on their own machine
  // that will never have a runtime on it. The compute is somebody else's.
  const bundleName = (await readdir(join(PATHS.WEB_OUT, 'assets')))
    .find((f) => /^index-.*\.js$/.test(f));
  const bundle = await readFile(join(PATHS.WEB_OUT, 'assets', bundleName), 'utf8');

  const { REWORDS } = await import('../../tools/reword-desktop-strings.mjs');
  const survived = REWORDS.filter((r) => bundle.includes(r.from)).map((r) => r.from);
  checkEqual('no desktop install advice survives in the shipped bundle', survived, []);
  check('and the Web wording is there instead',
    bundle.includes('暂无可用算力节点'), null);
  check('the build reports every reword it made',
    (report.rewordedStrings || []).length === REWORDS.length, report.rewordedStrings);
  checkEqual('and none of them silently failed to match', report.rewordMisses || [], []);

  // The probe behind the message is answered from the pool, not from a port on
  // the viewer's machine.
  const shim = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-runtime.js'), 'utf8');
  check('the local runtime ports are intercepted', /8188\|8189/.test(shim), null);
  check('and answered from the worker pool', /available_workers/.test(shim), null);
  check('while the worker gateway is left alone', !/8790/.test(shim.split('LOCAL_RUNTIME')[1] || ''), null);

  // Reference images had the same shape of bug: the panel POSTs them straight
  // to the local ComfyUI upload endpoint instead of going through
  // electronAPI.runtimeUploadImage, so they were being offered to a machine
  // that is not going to run the task.
  check('reference uploads are routed to the worker, not a local ComfyUI',
    /upload\/image/.test(shim) && /runtimeUploadImage/.test(shim), null);

  // Sanitising a filename can destroy it - 参考图.png and 背景图.png both
  // become ___.png - and the second would silently overwrite the first.
  check('a name the sanitiser flattens gets a suffix so two files stay two files',
    /cleaned !== raw/.test(shim), null);
}

// ---------------------------------------------------------------------------
section('the shims honour the signatures the renderer calls with');
{
  // 美工 and 绘图 were dead for every user because of this. The renderer calls
  //
  //   runtimeRequestJson({ baseUrl, path, init })
  //
  // with ONE object, and the shim declared (baseUrl, path, init) positionally,
  // so path arrived undefined and the answer was
  // "NovaFlow AI Runtime 未连接: NovaFlow Web does not proxy" - with nothing
  // after "proxy", because the path it was complaining about was undefined.
  //
  // proxy-electron-api.js is the contract: it is the implementation the
  // renderer was written against and the one 4783 runs on. So the test is
  // whether the shim accepts what THAT accepts, not whether it looks tidy.
  const proxy = await readFile(join(PATHS.WEB_OUT, 'proxy-electron-api.js'), 'utf8');
  const shim = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-runtime.js'), 'utf8');

  // Every runtime method the proxy defines as taking a single payload.
  const payloadMethods = [...proxy.matchAll(/const (runtime[A-Za-z]+) = async \((payload|\)\s*=>)/g)]
    .map((m) => m[1]);
  check('the contract really is payload-shaped', payloadMethods.length >= 3, payloadMethods);

  const missing = [];
  for (const name of payloadMethods) {
    // The shim may not implement every one; what it must not do is implement
    // one with a positional signature.
    const decl = new RegExp('async ' + name + '\\(([^)]*)\\)').exec(shim);
    if (!decl) continue;
    const params = decl[1].trim();
    const acceptsPayload = params === '' || params.startsWith('...') ||
      params.startsWith('payload') || params.startsWith('{');
    if (!acceptsPayload) missing.push(name + '(' + params + ')');
  }
  checkEqual('no shim method takes positional arguments the renderer never sends',
    missing, []);

  // And the reader that unpacks it is present, so this is not vacuous.
  check('the shim unpacks a payload object', /function asPayload/.test(shim), null);
}

// ---------------------------------------------------------------------------
section('a logged-out visitor is told to log in, and can');
{
  // Everything on the Web needs a session. Without one the control plane says
  // "missing session token" and the panels surfaced that raw - three different
  // noises for one cause, none of them actionable, and the login buried in
  // 动画 → 模式选择 where nobody looks when the app says 503.
  const account = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-account.js'), 'utf8');
  const html = await readFile(join(PATHS.WEB_OUT, 'index.html'), 'utf8');
  const shim = await readFile(join(PATHS.WEB_OUT, 'novaflow-web-runtime.js'), 'utf8');

  check('the account control ships', account.length > 1000, account.length);
  check('and is loaded by the page',
    (html.match(/novaflow-web-account\.js/g) || []).length === 1, null);
  check('it puts a control in the topbar',
    /novaflow-topbar-ai-runtime-status/.test(account), null);
  check("and signs in through the renderer's own login",
    /clientAuthLogin/.test(account), null);

  check('an unauthenticated call says what to do about it',
    /请先登录/.test(shim), null);
  // The phrase may appear in a comment explaining the bug; what matters is
  // that it is not what a user is shown.
  const shimCode = shim.replace(/^\s*\/\/.*$/gm, '');
  check('rather than leaking the API wording',
    !/missing session token/.test(shimCode), null);
}

// ---------------------------------------------------------------------------
section('the build ships a website, not a project folder');
{
  // Cloudflare's uploader spotted this first: the build was copying everything
  // that was not a .js, which put package.json and package-lock.json on a
  // public origin - the whole dependency tree and its versions, free to read -
  // plus four tsconfigs, vite.config.ts and two internal .md files. A browser
  // loads none of it.
  const all = [];
  async function walk(dir, prefix = '') {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(dir, e.name), prefix + e.name + '/');
      else all.push(prefix + e.name);
    }
  }
  await walk(PATHS.WEB_OUT);

  const leaked = all.filter((f) => {
    const name = f.split('/').pop();
    return /\.(ts|tsx|mts|cts|md|map)$/i.test(name) ||
      /^tsconfig.*\.json$/i.test(name) ||
      /^package(-lock)?\.json$/i.test(name) ||
      /\.config\.(js|ts|mjs|cjs)$/i.test(name) ||
      /^\.env/i.test(name);
  });
  checkEqual('no build tooling or internal note is published', leaked, []);
  check('the build reports what it held back', (report.notShipped || []).length > 0, report.notShipped);

  // The site still has everything it needs to run.
  for (const needed of ['index.html', 'favicon.svg', 'robots.txt']) {
    check(needed + ' is still published', all.includes(needed), null);
  }
  check('and it is still a whole app (' + all.length + ' files)', all.length > 250, all.length);
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

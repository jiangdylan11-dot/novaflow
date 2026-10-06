// Build the NovaFlow Web renderer.
//
// Takes renderer/ - a verbatim copy of NovaFlow's own renderer - and produces
// two trees:
//
//   web-dist/          the deployable static site. Every ComfyUI graph builder
//                      is hollowed out; what is left records {module, fn, args}
//                      and sends it to the control plane.
//
//   worker-renderer/   what a compute node loads. The same modules, with those
//                      same builders REGISTERED by name so the worker can
//                      replay a recorded call with its closure intact.
//
// Both halves are cut from the same source with the same span rules, so they
// cannot drift: tests/e2e/web-renderer-build.test.mjs asserts the two lists of
// function names are identical, and that web-dist contains no topology.

import { readFile, writeFile, mkdir, readdir, rm, cp, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { redactModule, findMarkers } from './redact-workflow-module.mjs';
import { instrumentModule } from './instrument-workflow-module.mjs';
import { redactBundleFile } from './redact-dead-bundle-workflow.mjs';
import { rewordBundle } from './reword-desktop-strings.mjs';
import { fetchFfmpegCore } from './fetch-ffmpeg-core.mjs';
import { allWorkflowEntryMethods, WORKFLOW_SOURCE_MODULES } from '../packages/shared/src/workflow-modules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = join(ROOT, 'renderer');
const WEB_OUT = join(ROOT, 'web-dist');
const WORKER_OUT = join(ROOT, 'worker-renderer');

// Directories carried across untouched. `src/` is the TypeScript the bundle in
// assets/ was already built from, so it is not shipped.
const ASSET_DIRS = ['assets', 'templates', 'aifx-styles', 'aifx-templates', 'vendor', 'public'];
const SKIP_DIRS = ['src', 'node_modules', 'dist', 'debug-assets'];

// Build tooling and internal notes are not part of a website. They were being
// copied out because the rule was "everything that is not .js", which shipped
// package.json and package-lock.json to a public origin - handing anyone the
// full dependency tree and its versions - along with four tsconfigs, the vite
// config and two internal .md files. A browser loads none of it.
const NOT_SHIPPED = [
  /\.(ts|tsx|mts|cts)$/i,          // TypeScript sources and declarations
  /\.md$/i,                        // internal notes
  /^tsconfig.*\.json$/i,
  /^package(-lock)?\.json$/i,
  /\.config\.(js|ts|mjs|cjs)$/i,   // vite.config.ts, eslint.config.js, ...
  /^\.env/i,
  /\.map$/i                        // source maps point back at sources
];

/** Is this a file a browser actually loads? */
export function isShippable(name) {
  return !NOT_SHIPPED.some((re) => re.test(name));
}

// Loaded first so `window.electronAPI` exists before proxy-electron-api.js
// runs its capability check and installs its own loopback fallback.
const RUNTIME_SHIM = 'novaflow-web-runtime.js';
// Loaded right after the runtime: the Electron-capability equivalents extend
// the electronAPI the runtime published.
const CAPABILITY_SHIM = 'novaflow-web-capabilities.js';
// Nothing in the Web build manages the compute pool. That lives in the desktop
// 后台管理 tool (particle-editor-desktop/license-admin-gui, 算力节点 module),
// next to 授权 and 积分 where an operator already works. Someone who opens
// NovaFlow to draw sees only whether compute is available.

// The Web line's own files. They belong to the BROWSER half only.
//
// The worker loads every .js in its tree, so shipping these there let the
// runtime shim override runtimeRequestJson - the very bridge the worker's
// builders read the ComfyUI node catalogue through, answered on the browser
// side with "no node catalogue here, 503". A compute node must never be
// handed the browser's refusals.
// The account control in the topbar. Everything on the Web needs a session,
// and without a visible way to sign in the app just emits API noise.
const ACCOUNT_SHIM = 'novaflow-web-account.js';
// The 算力源 picker behind 「AI 已连接」: which pool node runs your work.
const COMPUTE_NODE_SHIM = 'novaflow-web-compute-node.js';
const WAREHOUSE_SHIM = 'novaflow-web-warehouse.js';

const TEMPLATE_SHIM = 'novaflow-web-templates.js';
const BROWSER_ONLY = new Set([RUNTIME_SHIM, CAPABILITY_SHIM, ACCOUNT_SHIM, COMPUTE_NODE_SHIM, WAREHOUSE_SHIM, TEMPLATE_SHIM]);

const REPLACEMENT = (moduleName) => (fn) => {
  // The catalog is UI data. Its desktop fallback mentions a Comfy node, which
  // causes the graph scanner to select it; returning a recipe breaks .filter().
  if (moduleName === 'art-generate-lora' && fn === 'catalogFromInfo') return '\n    if (!info?.ok || !Array.isArray(info.items)) throw new Error(info?.error || "读取兼容 LoRA 失败");\n    return info.items.map(item => item.name).filter(isSelectable);\n  ';
  if (moduleName === 'novaflow-brand-runtime' && fn === 'validateArtWorkflowNodes') return '\n    return;\n  ';
  if (moduleName === 'novaflow-brand-runtime' && fn === 'applyArtReferenceControlNet') return '\n    return globalThis.NovaFlowWebRuntime.recordArtReferenceControl(...arguments);\n  ';
  return '\n    return globalThis.NovaFlowWebRuntime.serverOnly(' +
  JSON.stringify(moduleName) + ', ' + JSON.stringify(fn) + ', arguments);\n  ';
};

// Static hosts (Cloudflare Workers assets, Pages) refuse a single file over 25
// MiB. Anything larger in the published tree becomes `<name>.part0`, `.part1`,
// ... of PART_BYTES each plus `<name>.parts.json` listing them, and the
// original is dropped from the tree. The page reads the manifest first.
export const HOST_FILE_LIMIT = 25 * 1024 * 1024;
export const PART_BYTES = 20 * 1024 * 1024;

export async function splitLargeFiles(dir) {
  const split = [];
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile()) continue;
      const info = await stat(full);
      if (info.size < HOST_FILE_LIMIT) continue;
      const bytes = await readFile(full);
      const parts = [];
      for (let offset = 0, index = 0; offset < bytes.length; offset += PART_BYTES, index += 1) {
        const partName = entry.name + '.part' + index;
        await writeFile(join(folder, partName), bytes.subarray(offset, Math.min(offset + PART_BYTES, bytes.length)));
        parts.push(partName);
      }
      const digest = createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(folder, entry.name + '.parts.json'), JSON.stringify({ file: entry.name, bytes: bytes.length, sha256: digest, parts }, null, 2));
      await rm(full);
      split.push({ file: relative(dir, full).replace(/\\/g, '/'), bytes: bytes.length, parts: parts.length });
    }
  };
  await walk(dir);
  return split;
}

/**
 * Clear a directory's CONTENTS, keeping the directory itself.
 *
 * Removing the directory is the obvious thing and it is wrong here: on Windows
 * a static server previewing web-dist holds the directory open, and rmdir then
 * fails with EBUSY and takes the whole build down. Nothing needs the inode to
 * change - only what is inside it.
 */
async function emptyDir(dir) {
  let list = [];
  try { list = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of list) {
    await rm(join(dir, entry.name), { recursive: true, force: true });
  }
}

export async function buildWebRenderer({ logger, clean = true } = {}) {
  const log = logger || (() => {});

  if (clean) {
    await emptyDir(WEB_OUT);
    await emptyDir(WORKER_OUT);
  }
  await mkdir(WEB_OUT, { recursive: true });
  await mkdir(WORKER_OUT, { recursive: true });

  // ffmpeg.wasm's 32 MB core (工具 → MP4 压缩 / 视频格式转换) is fetched, not
  // committed; see tools/fetch-ffmpeg-core.mjs. Offline, the build still goes
  // through and the page says the component is missing.
  try {
    const core = await fetchFfmpegCore();
    log('ffmpeg core', { bytes: core.bytes, downloaded: core.downloaded });
  } catch (error) {
    log('ffmpeg core missing', String((error && error.message) || error));
    console.warn('  ffmpeg core not available: ' + String((error && error.message) || error));
  }

  const entries = await readdir(SRC, { withFileTypes: true });
  const report = {
    modules: [], copied: 0, redactedModules: 0,
    totalRedacted: 0, totalRegistered: 0, mismatches: [], leaks: []
  };

  // -------------------------------------------------------------- js modules
  const forceNames = allWorkflowEntryMethods();
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== '.js') continue;
    // eslint.config.js and friends are build tooling that happens to end in
    // .js. Neither a browser nor a compute node has any use for them.
    if (!isShippable(entry.name)) {
      report.notShipped = (report.notShipped || []).concat(entry.name);
      continue;
    }
    const source = await readFile(join(SRC, entry.name), 'utf8');
    const moduleName = entry.name.replace(/\.js$/, '');

    if (BROWSER_ONLY.has(entry.name)) {
      await writeFile(join(WEB_OUT, entry.name), source, 'utf8');
      report.browserOnly = (report.browserOnly || []).concat(entry.name);
      continue;
    }

    if (!findMarkers(source, moduleName).length) {
      // Nothing to hide; both sides get the file untouched.
      await writeFile(join(WEB_OUT, entry.name), source, 'utf8');
      await writeFile(join(WORKER_OUT, entry.name), source, 'utf8');
      report.copied += 1;
      continue;
    }

    // The force list is by name. The execution bridge in novaflow-brand-runtime shares its method
    // name with the art provider module's buildRunWorkflow entry, but only forwards to
    // buildArtGenerateRunWorkflow, which already hands itself to the worker. Redacting the bridge
    // too turned local UI-design runs into a call no worker accepts.
    const redacted = redactModule(source, {
      moduleName,
      forceNames: forceNames.filter((name) => name !== 'buildArtGenerateRunWorkflow'
        && !(moduleName === 'novaflow-brand-runtime' && name === 'buildRunWorkflow')),
      replacement: REPLACEMENT(WORKFLOW_SOURCE_MODULES[moduleName] || moduleName)
    });
    const instrumented = instrumentModule(source, { moduleName, forceNames: moduleName === 'novaflow-brand-runtime' ? ['buildArtGenerateRunWorkflow'] : [] });

    await writeFile(join(WEB_OUT, entry.name), redacted.code, 'utf8');
    await writeFile(join(WORKER_OUT, entry.name), instrumented.code, 'utf8');

    // The browser must not be able to record a call the worker cannot replay.
    const registered = new Set(instrumented.registered);
    const unreplayable = redacted.redacted.filter(
      (name) => !registered.has(name) && !forceNames.includes(name)
    );

    report.modules.push({
      module: moduleName,
      redacted: redacted.redacted.length,
      registered: instrumented.registered.length,
      graphs: redacted.redactedGraphs,
      comments: redacted.strippedComments,
      identifiers: redacted.renamedIdentifiers.length,
      literals: redacted.redactedLiterals,
      remaining: redacted.remaining,
      unreplayable
    });
    report.redactedModules += 1;
    report.totalRedacted += redacted.redacted.length;
    report.totalRegistered += instrumented.registered.length;
    if (redacted.remaining.length) report.leaks.push({ module: moduleName, markers: redacted.remaining });
    if (unreplayable.length) report.mismatches.push({ module: moduleName, unreplayable });
  }

  // ------------------------------------------------- the prebuilt React bundle
  //
  // renderer/assets holds nine index-*.js files, eight of them left over from
  // older builds. index.html names the one that matters, so only that one is
  // shipped - and it goes through the same transform, because it is code a
  // browser downloads like any other.
  const indexHtmlSource = await readFile(join(SRC, 'index.html'), 'utf8');
  const referencedAssets = new Set(
    [...indexHtmlSource.matchAll(/\.\/assets\/([A-Za-z0-9._-]+)/g)].map((m) => m[1])
  );
  report.bundles = [];

  // --------------------------------------------------------- other assets
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      if (!ASSET_DIRS.includes(entry.name)) continue;
      if (entry.name === 'assets') {
        await copyAssets(join(SRC, 'assets'), join(WEB_OUT, 'assets'), {
          referenced: referencedAssets, report, forceNames
        });
        continue;
      }
      await cp(join(SRC, entry.name), join(WEB_OUT, entry.name), {
        recursive: true,
        filter: (src) => isShippable(src.split(/[\\/]/).pop() || '')
      });
      continue;
    }
    if (!entry.isFile()) continue;
    if (extname(entry.name) === '.js') continue;
    if (entry.name === 'index.html') continue;
    if (!isShippable(entry.name)) {
      report.notShipped = (report.notShipped || []).concat(entry.name);
      continue;
    }
    await cp(join(SRC, entry.name), join(WEB_OUT, entry.name));
  }

  // Cloudflare takes static files up to 25 MiB each. ffmpeg's core is 32 MB,
  // so the site carries it in parts (with a manifest beside them) and the page
  // stitches them back together before handing the bytes to WebAssembly.
  report.split = await splitLargeFiles(WEB_OUT);
  for (const item of report.split) log('split for the 25 MiB limit', item);

  const particleTemplates = [];
  for (const filename of (await readdir(join(ROOT, 'particle-templates'))).sort((a,b) => a.localeCompare(b, 'zh-CN', { numeric: true }))) {
    if (!filename.endsWith('.json') || filename.startsWith('builtin_tpl_')) continue;
    const parsed = JSON.parse(await readFile(join(ROOT, 'particle-templates', filename), 'utf8'));
    const name = filename.slice(0, -5).replace(/\s+/g, ' ').trim().slice(0, 40);
    const config = parsed.config || (parsed.systemName ? parsed : null);
    if (config) particleTemplates.push({ id: parsed.config ? String(parsed.id || 'file_' + name) : 'file_' + name, name, config, createdAt: Number(parsed.createdAt) || 1 });
  }
  if (!particleTemplates.length) throw new Error('no bundled particle templates');
  await mkdir(join(WEB_OUT, 'templates'), { recursive: true });
  await writeFile(join(WEB_OUT, 'templates/particle-bundled.json'), JSON.stringify(particleTemplates));

  // ------------------------------------------------------------- index.html
  const html = await readFile(join(SRC, 'index.html'), 'utf8');
  await writeFile(join(WEB_OUT, 'index.html'), rewriteIndexHtml(html), 'utf8');

  // Last, once every file is on disk: give each local asset a ?v= derived
  // from its own bytes.
  await stampCacheTokens();

  log('web renderer built', {
    modules: report.redactedModules,
    copied: report.copied,
    redacted: report.totalRedacted,
    registered: report.totalRegistered
  });

  return report;
}

/**
 * Put the Web runtime in front of everything.
 *
 * It must run before proxy-electron-api.js, which checks whether a preload
 * already provided electronAPI and installs a loopback fallback when it has
 * not. Winning that check is what makes the rest of the renderer work
 * unmodified.
 */
/**
 * Copy assets, transforming any JavaScript on the way.
 *
 * A stale bundle nobody references is dropped rather than shipped and
 * redacted: eight megabytes of dead code is not something to carry, and
 * scanning it for leaks would only ever report on code no browser loads.
 */
async function copyAssets(from, to, { referenced, report, forceNames }) {
  await mkdir(to, { recursive: true });
  const list = await readdir(from, { withFileTypes: true });
  for (const entry of list) {
    if (entry.isDirectory()) {
      await cp(join(from, entry.name), join(to, entry.name), {
        recursive: true,
        filter: (src) => isShippable(src.split(/[\\/]/).pop() || '')
      });
      continue;
    }
    if (extname(entry.name) !== '.js') {
      await cp(join(from, entry.name), join(to, entry.name));
      continue;
    }
    // A bundle index.html does not name is a leftover from an older build.
    if (/^index-[A-Za-z0-9_-]+\.js$/.test(entry.name) && !referenced.has(entry.name)) {
      report.droppedBundles = (report.droppedBundles || 0) + 1;
      continue;
    }

    const source = await readFile(join(from, entry.name), 'utf8');
    const moduleName = 'assets/' + entry.name.replace(/\.js$/, '');
    if (!findMarkers(source, moduleName).length) {
      await cp(join(from, entry.name), join(to, entry.name));
      continue;
    }

    // The bundle is shipped as built and then given ONE targeted edit; see
    // redact-dead-bundle-workflow.mjs for why the general passes are not used
    // on minified code.
    const redacted = { code: source, redacted: [], redactedGraphs: 0, strippedComments: 0, renamedIdentifiers: [], redactedLiterals: 0, remaining: [] };
    const instrumented = { code: source, registered: [] };
    await writeFile(join(to, entry.name), redacted.code, 'utf8');
    await mkdir(join(WORKER_OUT, 'assets'), { recursive: true });
    await writeFile(join(WORKER_OUT, 'assets', entry.name), instrumented.code, 'utf8');

    const targeted = redactBundleFile(join(to, entry.name));
    report.bundleEdits = (report.bundleEdits || []).concat({ file: entry.name, ...targeted });

    // Messages that tell a browser user to install software on their own
    // machine. The compute is somebody else's.
    const reworded = rewordBundle(join(to, entry.name));
    report.rewordedStrings = reworded.applied;
    if (reworded.missing.length) report.rewordMisses = reworded.missing;

    report.bundles.push({
      file: entry.name,
      redacted: redacted.redacted.length,
      registered: instrumented.registered.length,
      graphs: redacted.redactedGraphs,
      remaining: redacted.remaining
    });
    if (redacted.remaining.length) report.leaks.push({ module: moduleName, markers: redacted.remaining });
  }
}

/**
 * Give every local asset in index.html a ?v= that changes when the asset does.
 *
 * The tokens in index.html are hand-written and the shim tags carry fixed
 * ones, so a file could change while its URL did not. A browser that had
 * already cached it then keeps serving the old copy, which is how a rebuilt
 * runtime, stylesheet or account shim reaches a reloaded page unchanged. The
 * symptom is always "my fix did nothing", so it costs an afternoon each time.
 *
 * The token is the first 10 hex of the file's SHA-1: deterministic, so a file
 * that did not change keeps its URL and stays cached. assets/ is left alone -
 * those names already carry the bundler's own content hash.
 */
async function stampCacheTokens() {
  const indexPath = join(WEB_OUT, 'index.html');
  let html;
  try {
    html = await readFile(indexPath, 'utf8');
  } catch {
    return;
  }
  const tokens = new Map();
  const tokenFor = async (name) => {
    if (tokens.has(name)) return tokens.get(name);
    let token = null;
    try {
      token = createHash('sha1').update(await readFile(join(WEB_OUT, name))).digest('hex').slice(0, 10);
    } catch {
      token = null;
    }
    tokens.set(name, token);
    return token;
  };
  const found = [];
  const pattern = /(src|href)="\.\/([^"?#]+?)(?:\?v=[^"#]*)?"/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) found.push(match);
  let out = html;
  for (const [whole, attribute, name] of found) {
    if (name.startsWith('assets/')) continue;
    const token = await tokenFor(name);
    if (!token) continue;
    out = out.split(whole).join(`${attribute}="./${name}?v=${token}"`);
  }
  if (out !== html) await writeFile(indexPath, out, 'utf8');
}

export function rewriteIndexHtml(html) {
  let out = html;

  // A config block the deployment can rewrite without touching the bundle.
  const configTag =
    '    <script>\n' +
    '      // Filled in at deploy time. See docs/DEPLOY.md.\n' +
    '      window.NOVAFLOW_WEB_CONFIG = window.NOVAFLOW_WEB_CONFIG || {\n' +
    '        controlUrl: "http://127.0.0.1:4890",\n' +
    '        authUrl: "https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend"\n' +
    '      };\n' +
    '    </script>\n';

  // The config goes first, because modules read it as they load. The shims go
  // last - see below.
  const firstScript = out.search(/<script\b/);
  if (firstScript >= 0) {
    out = out.slice(0, firstScript) + configTag + '    ' + out.slice(firstScript);
  } else {
    out = out.replace('</head>', configTag + '  </head>');
  }

  // The transport shims load LAST, after proxy-electron-api.js has installed
  // the renderer's own browser implementation. That implementation is what
  // 4783 runs on and it works; the Web line only needs to redirect the AI
  // runtime away from 127.0.0.1:8188 and towards the worker pool.
  //
  // Loading them first was wrong: publishing electronAPI early makes
  // proxy-electron-api.js stand down, and the renderer then takes its DESKTOP
  // path on the strength of capabilities we advertise. That is what produced a
  // blank animation section.
  const shimTags =
    '    <script src="./' + WAREHOUSE_SHIM + '?v=warehouse-1"></script>\n' +
    '    <script src="./' + RUNTIME_SHIM + '?v=web-3"></script>\n' +
    '    <script src="./' + CAPABILITY_SHIM + '?v=web-board-fps-20261006-1"></script>\n' +
    '    <script src="./' + TEMPLATE_SHIM + '?v=templates-1"></script>\n' +
    '    <script src="./' + ACCOUNT_SHIM + '?v=web-1"></script>\n' +
    '    <script src="./' + COMPUTE_NODE_SHIM + '?v=web-1"></script>\n';
  const lastScript = out.lastIndexOf('</script>');
  if (lastScript >= 0) {
    const insertAt = lastScript + '</script>'.length;
    out = out.slice(0, insertAt) + '\n' + shimTags + out.slice(insertAt);
  } else {
    out = out.replace('</body>', shimTags + '  </body>');
  }

  // The desktop shell hard-codes a minimum width for an Electron window. A
  // browser tab can be narrower, and the renderer now lays itself out for any
  // width (the reference's 1400 / 720 tiers), so the page takes no minimum.
  out = out.replace(
    'html, body, #root { min-width: 1280px;',
    'html, body, #root { min-width: 0;'
  );

  out = out.replace('<title>NovaFlow</title>', '<title>NovaFlow Web</title>');
  return out;
}

/** Everything in web-dist that still names a ComfyUI node. */
export async function scanForLeaks(dir = WEB_OUT) {
  const hits = [];
  async function walk(current) {
    let list = [];
    try { list = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of list) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!['.js', '.html', '.json', '.mjs'].includes(extname(entry.name))) continue;
      // The prebuilt React bundle is the desktop app's own UI code; it is
      // scanned too, because "shipped to a browser" is the test, not "written
      // by this project".
      const text = await readFile(full, 'utf8');
      const markers = findMarkers(text.replace(/^\s*\/\/.*$/gm, ''));
      if (markers.length) hits.push({ file: relative(dir, full), markers });
    }
  }
  await walk(dir);
  return hits;
}

/**
 * Parse every emitted file.
 *
 * The transform rewrites 8.5 MB of somebody else's JavaScript; a brace-matching
 * slip truncates a function and leaves orphaned code behind it. That is not
 * something to discover in a browser console, so the build refuses to finish
 * with a file that does not parse.
 */
export async function checkSyntax(dir) {
  const bad = [];
  async function walk(current) {
    let list = [];
    try { list = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of list) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (extname(entry.name) !== '.js') continue;
      try {
        execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
      } catch (error) {
        const message = String(error.stderr || error.message || '');
        bad.push({ file: relative(dir, full), error: message.split('\n').slice(0, 4).join(' ').slice(0, 220) });
      }
    }
  }
  await walk(dir);
  return bad;
}

export const PATHS = { SRC, WEB_OUT, WORKER_OUT };

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('build-web-renderer.mjs');
if (invokedDirectly) {
  const report = await buildWebRenderer({ logger: (m, x) => console.log(m, JSON.stringify(x)) });

  console.log('\n  module                                        redact  register  graphs  ids  strings');
  for (const m of report.modules) {
    console.log(
      '  ' + m.module.padEnd(44) +
      String(m.redacted).padStart(6) +
      String(m.registered).padStart(10) +
      String(m.graphs).padStart(8) +
      String(m.identifiers).padStart(5) +
      String(m.literals).padStart(9)
    );
  }
  console.log('\n  untouched modules: ' + report.copied);

  if (report.mismatches.length) {
    console.log('\n  RECORDED BUT NOT REPLAYABLE:');
    for (const x of report.mismatches) console.log('    ' + x.module + ': ' + x.unreplayable.join(', '));
  }

  const leaks = await scanForLeaks();
  console.log('\n  leak scan over web-dist: ' + (leaks.length ? leaks.length + ' file(s)' : 'clean'));
  for (const l of leaks.slice(0, 10)) console.log('    ' + l.file + ' -> ' + l.markers.slice(0, 6).join(', '));

  for (const [label, dir] of [['web-dist', WEB_OUT], ['worker-renderer', WORKER_OUT]]) {
    const bad = await checkSyntax(dir);
    console.log('  syntax check ' + label + ': ' + (bad.length ? bad.length + ' FAILED' : 'all files parse'));
    for (const b of bad.slice(0, 6)) console.log('    ' + b.file + ' -> ' + b.error);
    if (bad.length) process.exitCode = 1;
  }

  const size = await dirSize(WEB_OUT);
  console.log('\n  web-dist: ' + Math.round(size / (1024 * 1024)) + ' MB');
}

async function dirSize(dir) {
  let total = 0;
  const list = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of list) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

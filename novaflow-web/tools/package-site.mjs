// Build, point at a control plane, verify, and package - in one command.
//
// These four steps have an order, and getting it wrong produces a site that
// looks fine and is broken: the build always writes the LOCAL control plane
// into index.html, so anything that rebuilds after the repoint silently undoes
// it. Running the test suite rebuilds. I did exactly that, zipped the result,
// and shipped a public site that tried to reach http://127.0.0.1:4890 - which
// fails as "暂无可用算力" with a perfectly healthy pool one HTTP call away.
//
// So the order is not something to remember. It is this file. And the last
// step refuses to produce a zip whose index.html still points at localhost,
// because that zip has no legitimate use on a public host.
//
//   node tools/package-site.mjs --control-url=https://<ref>.supabase.co/functions/v1/novaflow-web
//   node tools/package-site.mjs --control-url=... --out=C:/path/site.zip

import { readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildWebRenderer, PATHS, HOST_FILE_LIMIT } from './build-web-renderer.mjs';
import { readConfig, writeConfig } from './set-web-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const INDEX = join(PATHS.WEB_OUT, 'index.html');

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
}

const LOCAL = /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?/i;

export async function packageSite({ controlUrl, authUrl, artKnowledgeUrl, artKnowledgeEnabled, out, allowLocal = false, logger } = {}) {
  const log = logger || (() => {});

  // 1. build - this writes the local default into index.html. The published
  // site is minified: comments stripped, names mangled (anti-copy).
  const report = await buildWebRenderer({ clean: true, minify: true });
  log('built', { modules: report.redactedModules, copied: report.copied, minified: report.minify ? report.minify.minified : 0 });

  // 2. repoint
  if (controlUrl || authUrl || artKnowledgeUrl || artKnowledgeEnabled!==undefined) {
    const html = await readFile(INDEX, 'utf8');
    await writeFile(INDEX, writeConfig(html, { controlUrl, authUrl, artKnowledgeUrl, artKnowledgeEnabled }), 'utf8');
  }

  // 3. verify what actually landed, by reading the file back
  const config = readConfig(await readFile(INDEX, 'utf8'));
  if (!config) throw new Error('no config block in the built index.html');
  if (!allowLocal && LOCAL.test(config.controlUrl)) {
    throw new Error(
      'refusing to package: the site still points at ' + config.controlUrl +
      '\n  A public host cannot reach a local control plane. Pass --control-url=<your deployed function>' +
      '\n  (or --allow-local if you really are packaging for a local test).'
    );
  }
  if (controlUrl && config.controlUrl !== controlUrl) {
    throw new Error('the repoint did not take: asked for ' + controlUrl + ', file holds ' + config.controlUrl);
  }
  log('pointed at', config);

  // 4. zip - with tar, because PowerShell's Compress-Archive writes backslash
  //    separators, which the ZIP spec forbids. Cloudflare's unzipper obeys the
  //    spec, so every file in a subdirectory 404s and the site is a blank page
  //    with the main bundle missing. That cost a deploy to find.
  const zip = resolve(out || join(ROOT, '.artifacts/novaflow-web-site.zip'));
  // Cloudflare's uploader refuses any file of 25 MiB or more, one file at a
  // time, after everything else has gone up. Refuse here instead.
  const oversized = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (entry.isFile() && (await stat(full)).size >= HOST_FILE_LIMIT) oversized.push(relative(PATHS.WEB_OUT, full));
    }
  };
  await walk(PATHS.WEB_OUT);
  if (oversized.length) throw new Error('refusing to package: over the host\'s 25 MiB file limit: ' + oversized.join(', '));
  await mkdir(dirname(zip), { recursive: true });
  await rm(zip, { force: true });
  // Windows' own tar.exe, by full path. A `tar` from Git Bash reads C:\... as
  // a remote host ("Cannot connect to C: resolve failed").
  const tar = process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
    : 'tar';
  execFileSync(tar, ['-a', '-c', '-f', zip, '.'], { cwd: PATHS.WEB_OUT, stdio: 'pipe' });

  const bytes = (await import('node:fs')).statSync(zip).size;
  return { zip, bytes, config, files: report };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('package-site.mjs');
if (invokedDirectly) {
  try {
    const res = await packageSite({
      controlUrl: arg('control-url'),
      authUrl: arg('auth-url'),
      artKnowledgeUrl: arg('art-knowledge-url')||undefined,artKnowledgeEnabled:process.argv.includes('--enable-art-knowledge')?true:undefined,
      out: arg('out'),
      allowLocal: process.argv.includes('--allow-local'),
      logger: (m, x) => console.log('  ' + m + ' ' + (x ? JSON.stringify(x) : ''))
    });
    console.log('');
    console.log('  controlUrl : ' + res.config.controlUrl);
    console.log('  authUrl    : ' + res.config.authUrl);
    console.log('  zip        : ' + res.zip);
    console.log('  size       : ' + (res.bytes / 1024 / 1024).toFixed(1) + ' MB');
  } catch (error) {
    console.error('\n' + String(error.message || error) + '\n');
    process.exit(1);
  }
}

// Boot the deployed bundle under Deno and make it answer a request.
//
// This exists because a bundle that parses is not a bundle that runs. The
// first deploy carried a duplicate `const MAX_BODY_BYTES` - index.ts and
// control-plane.mjs each declared one, and the bundler checked the modules
// against each other but never against the entry. Node's type-stripping parsed
// it happily. Deno refused to start, and the only symptom in production was
//
//   503 {"code":"BOOT_ERROR","message":"Function failed to start"}
//
// with empty logs for the first hour. Running the thing is the only check that
// would have caught it, so now the thing gets run.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BUNDLE = join(ROOT, 'supabase/functions/novaflow-web-bundle/index.ts');
const DENO = join(ROOT, 'node_modules/.bin/deno' + (process.platform === 'win32' ? '.cmd' : ''));

export async function verifyEdgeBundle({ timeoutMs = 90000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nf-edge-boot-'));
  await copyFile(BUNDLE, join(dir, 'index.ts'));
  await writeFile(join(dir, 'deno.json'), JSON.stringify({ nodeModulesDir: 'auto' }), 'utf8');
  await mkdir(join(ROOT, '.artifacts/deno-cache'), { recursive: true });

  const child = spawn(DENO, ['run', '--no-check', '--allow-all', 'index.ts'], {
    cwd: dir,
    // deno is a .cmd shim on Windows; spawning it needs a shell there.
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      // Dummies: this proves the module graph loads and the server starts, not
      // that it can reach a database.
      SUPABASE_URL: 'https://example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy',
      NOVAFLOW_SESSION_SECRET: 'dummy-session-secret-for-boot-check',
      // A persistent cache, or every run re-downloads the npm dependency.
      DENO_DIR: join(ROOT, '.artifacts/deno-cache')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (d) => { output += String(d); });
  child.stderr.on('data', (d) => { output += String(d); });

  const exited = new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code)));
  const started = Date.now();
  let listening = null;

  try {
    while (Date.now() - started < timeoutMs) {
      const m = /Listening on (http:\/\/[^\s/]+)/.exec(output);
      if (m) { listening = m[1].replace('localhost', '127.0.0.1'); break; }
      if (/error:/i.test(output)) break;
      const raced = await Promise.race([exited, new Promise((r) => setTimeout(() => r('wait'), 250))]);
      if (raced !== 'wait') break;
    }

    if (!listening) {
      return { ok: false, booted: false, error: firstError(output), output: output.slice(0, 1200) };
    }

    // It is listening; make it actually answer. A public route, so no secrets
    // are needed for the reply to be meaningful.
    // Supabase prefixes the path with the function slug, so the same route has
    // to work three ways. Production 404s were the second failure after the
    // boot error; both were invisible to anything that only read the source.
    const forms = [
      '/api/web/capabilities',
      '/novaflow-web/api/web/capabilities',
      '/functions/v1/novaflow-web/api/web/capabilities'
    ];
    const answers = [];
    for (const form of forms) {
      try {
        const res = await fetch(listening + form);
        answers.push({ form, status: res.status, body: (await res.text()).slice(0, 160) });
      } catch (error) {
        return { ok: false, booted: true, error: 'listening but did not answer ' + form + ': ' + String(error.message || error) };
      }
    }
    const bad = answers.filter((a) => a.status !== 200);
    if (bad.length) {
      return {
        ok: false, booted: true, answers,
        error: 'these paths did not return 200: ' + bad.map((b) => b.form + ' -> ' + b.status).join(', ')
      };
    }

    return { ok: true, booted: true, status: 200, answers, body: answers[0].body, output: output.slice(0, 400) };
  } finally {
    // On Windows `deno` is a .cmd shim, so killing the child kills the shim and
    // leaves the real process holding the port and this script's stdout pipe -
    // the command then never returns. Kill the tree.
    await killTree(child);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
    return;
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

function firstError(output) {
  // The function serves on Deno.serve()'s default port, so a busy 8000 looks
  // like a broken bundle unless it is called out.
  if (/AddrInUse|address already in use/i.test(output)) {
    return 'port 8000 is already in use - free it and retry (the function serves on Deno.serve()\'s default port)';
  }
  const m = /error:[^\n]*(?:\n[^\n]*)?/i.exec(output);
  return m ? m[0].trim().slice(0, 300) : 'the bundle never reported "Listening"';
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('verify-edge-bundle.mjs');
if (invokedDirectly) {
  const res = await verifyEdgeBundle();
  if (!res.ok) {
    console.error('the edge bundle does not boot:');
    console.error('  ' + (res.error || 'unknown'));
    if (res.output) console.error('\n' + res.output);
    process.exit(1);
  }
  console.log('edge bundle boots and answers on every routing form:');
  for (const a of res.answers) console.log('  ' + String(a.status) + '  ' + a.form);
}

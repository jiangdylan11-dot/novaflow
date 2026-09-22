// Start the whole local acceptance stack in one command.
//
//   node tools/start-local-stack.mjs
//
// Brings up the control plane, one GPU worker and the built web app, mints a
// demo account and a registration code, and prints the URL to open. Ctrl+C
// stops everything.
//
// This is for trying the product on one machine. Production runs the control
// plane as a Supabase edge function and the workers on other people's PCs.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const CONTROL_PORT = Number(process.env.NOVAFLOW_WEB_CONTROL_PORT || 4890);
const WEB_PORT = Number(process.env.NOVAFLOW_WEB_PORT || 4892);
const GATEWAY_PORT = Number(process.env.NOVAFLOW_GATEWAY_PORT || 8790);
const CONTROL_URL = 'http://127.0.0.1:' + CONTROL_PORT;

const children = [];

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  const tag = '[' + label + '] ';
  child.stdout.on('data', (d) => process.stdout.write(tag + d));
  child.stderr.on('data', (d) => process.stderr.write(tag + d));
  child.on('exit', (code) => console.log(tag + 'exited with ' + code));
  children.push(child);
  return child;
}

async function waitForHttp(url, { timeoutMs = 60000, label = url } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + label);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function post(path, body) {
  const res = await fetch(CONTROL_URL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

function shutdown() {
  console.log('\nstopping the local stack...');
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------------------------------------------------------------
if (!existsSync(join(ROOT, 'web/dist/index.html'))) {
  console.log('web/dist is missing - building it first...');
  await new Promise((resolve, reject) => {
    const build = spawn('npm', ['--prefix', 'web', 'run', 'build'], {
      cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'
    });
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('web build failed'))));
  });
}

start('control', process.execPath, ['control-local/src/server.mjs'], {
  NOVAFLOW_WEB_CONTROL_PORT: String(CONTROL_PORT)
});
await waitForHttp(CONTROL_URL + '/health', { label: 'control plane' });
console.log('\ncontrol plane up on ' + CONTROL_URL);

const login = await post('/dev/login', { email: 'demo@novaflow.local', balance: 2000 });
const code = await post('/dev/registration-code', { email: 'demo@novaflow.local', label: 'local stack' });
console.log('demo account: demo@novaflow.local (' + login.credits.balance + ' credits)');

start('worker', process.execPath, ['worker/src/main-headless.mjs'], {
  NOVAFLOW_WEB_CONTROL_URL: CONTROL_URL,
  NOVAFLOW_WORKER_NAME: 'local-node',
  NOVAFLOW_WORKER_REGISTRATION_CODE: code.registration_code,
  NOVAFLOW_WORKER_DATA_DIR: join(ROOT, '.artifacts/worker-local'),
  NOVAFLOW_GATEWAY_PORT: String(GATEWAY_PORT),
  NOVAFLOW_PUBLIC_ENDPOINT: 'http://127.0.0.1:' + GATEWAY_PORT
});
await waitForHttp('http://127.0.0.1:' + GATEWAY_PORT + '/gw/health', { label: 'worker gateway' });
console.log('worker gateway up on http://127.0.0.1:' + GATEWAY_PORT);

start('web', 'npm', ['--prefix', 'web', 'run', 'preview', '--', '--port', String(WEB_PORT)]);
await waitForHttp('http://127.0.0.1:' + WEB_PORT + '/', { label: 'web app' });

console.log('\n' + '='.repeat(56));
console.log('  NovaFlow Web is ready');
console.log('='.repeat(56));
console.log('  open        http://127.0.0.1:' + WEB_PORT);
console.log('  sign in     click the "本地验收登录" button');
console.log('  then        美工 / 绘图 -> type a prompt -> 开始生成');
console.log('');
console.log('  control     ' + CONTROL_URL);
console.log('  gateway     http://127.0.0.1:' + GATEWAY_PORT);
console.log('  reg code    ' + code.registration_code + '  (for a second worker)');
console.log('');
console.log('  Ctrl+C to stop everything.');
console.log('='.repeat(56) + '\n');

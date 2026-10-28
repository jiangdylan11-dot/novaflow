// Start a disposable Postgres and run the two-connection migration test.
// Docker is preferred. `supabase start` is used only when Docker is absent
// and the Supabase CLI is on PATH. If neither can provide a database, exit 0.
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const container = 'novaflow-credit-migration-pg';
const url = 'postgres://postgres:postgres@127.0.0.1:55432/novaflow_credit_test';

function runnable(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0;
}

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = docker(['exec', container, 'pg_isready', '-U', 'postgres']);
    if (ready.status === 0) return;
    await delay(1000);
  }
  throw new Error('Postgres did not become ready');
}

async function startDocker() {
  docker(['rm', '-f', container]);
  const started = docker([
    'run', '-d', '--name', container,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_DB=novaflow_credit_test',
    '-p', '127.0.0.1:55432:5432',
    'postgres:16-alpine'
  ]);
  if (started.status !== 0) throw new Error(started.stderr || started.stdout || 'docker run failed');
  await waitForPostgres();
  return async () => { docker(['rm', '-f', container]); };
}

async function startSupabase() {
  const started = spawnSync('supabase', ['start'], { cwd: webRoot, encoding: 'utf8' });
  if (started.status !== 0) throw new Error(started.stderr || 'supabase start failed');
  const status = spawnSync('supabase', ['status', '-o', 'env'], { cwd: webRoot, encoding: 'utf8' });
  const match = /DB_URL="?([^"\n]+)"?/.exec(status.stdout || '');
  if (!match) throw new Error('supabase status did not report DB_URL');
  return { url: match[1], stop: async () => { spawnSync('supabase', ['stop'], { cwd: webRoot }); } };
}

const childEnv = { ...process.env };
let stop = async () => {};
try {
  if (process.env.NOVAFLOW_MIGRATION_TEST_URL) {
    childEnv.NOVAFLOW_MIGRATION_TEST_URL = process.env.NOVAFLOW_MIGRATION_TEST_URL;
  } else if (runnable('docker', ['info'])) {
    stop = await startDocker();
    childEnv.NOVAFLOW_MIGRATION_TEST_URL = url;
  } else if (runnable('supabase', ['--version'])) {
    const started = await startSupabase();
    childEnv.NOVAFLOW_MIGRATION_TEST_URL = started.url;
    stop = started.stop;
  } else {
    console.log('skip: Docker, Supabase, and NOVAFLOW_MIGRATION_TEST_URL are unavailable');
    process.exit(0);
  }
  const child = spawn(process.execPath, ['--test', 'tests/e2e/quota-migration-concurrency.test.mjs'], {
    cwd: webRoot, env: childEnv, stdio: 'inherit'
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  await stop();
  process.exit(code || 0);
} catch (error) {
  console.log('skip: ' + (error?.message || error));
  await stop();
  process.exit(0);
}

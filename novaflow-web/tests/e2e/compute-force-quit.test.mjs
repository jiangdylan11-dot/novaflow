// The forced half of "退出 Foart", run for real: it ends the assistant's process tree and the image
// runtime it recorded, and leaves alone a recorded process id that is no longer that runtime.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forceQuitCommand } from '../../worker/src/force-quit.cjs';

if (process.platform !== 'win32') { console.log('compute force quit: Windows only, skipped'); process.exit(0); }
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (test, label, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await new Promise(r => setTimeout(r, 100)); }
  assert.fail('timed out: ' + label);
};
const dir = await mkdtemp(join(tmpdir(), 'foart-force-quit-'));
const idle = 'setInterval(() => {}, 1000);';
// "The assistant": a parent that starts a child (the tunnel tool) and prints the child's id.
const parentScript = join(dir, 'assistant.js');
await writeFile(parentScript, "const c = require('node:child_process').spawn(process.execPath, ['-e', " + JSON.stringify(idle) + "], { stdio: 'ignore' }); console.log(c.pid); " + idle);
// "The image runtime": its command line names ComfyUI\main.py, like the real one.
await mkdir(join(dir, 'engine', 'ComfyUI'), { recursive: true });
const runtimeScript = join(dir, 'engine', 'ComfyUI', 'main.py');
await writeFile(runtimeScript, idle);
const spawned = [];
try {
  const parent = spawn(process.execPath, [parentScript], { stdio: ['ignore', 'pipe', 'ignore'] }); spawned.push(parent);
  const childPid = Number(await new Promise(resolve => parent.stdout.once('data', chunk => resolve(String(chunk).trim()))));
  const runtime = spawn(process.execPath, [runtimeScript, '--port', '8188'], { stdio: 'ignore' }); spawned.push(runtime);
  const bystander = spawn(process.execPath, ['-e', idle], { stdio: 'ignore' }); spawned.push(bystander);
  const record = join(dir, 'owned-runtimes.json');
  await writeFile(record, JSON.stringify({ 'image:8188': { pid: runtime.pid, startedAt: '1' }, 'video:8189': { pid: bystander.pid, startedAt: '2' } }));
  assert(alive(parent.pid) && alive(childPid) && alive(runtime.pid) && alive(bystander.pid));

  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', forceQuitCommand()], {
    env: { ...process.env, FOART_QUIT_PID: String(parent.pid), FOART_QUIT_RUNTIMES: record }, windowsHide: true, timeout: 60000 });
  assert.equal(run.status, 0, String(run.stderr));
  await until(() => !alive(parent.pid) && !alive(childPid), 'the assistant and its child end');
  await until(() => !alive(runtime.pid), 'the recorded image runtime ends');
  assert(alive(bystander.pid), 'a recorded id that is not the image runtime is left alone');
  assert.deepEqual(JSON.parse((await readFile(record, 'utf8')).replace(/^﻿/, '')), {}, 'the record is cleared so the next start does not adopt a dead runtime');
  console.log('compute force quit: process tree and recorded runtime ended, bystander untouched');
} finally {
  for (const child of spawned) { try { child.kill(); } catch { /* gone */ } }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

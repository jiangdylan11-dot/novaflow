import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRuntimeLauncher, createRuntimeServices, probeRuntimeListener } from '../../worker/src/runtime-services.mjs';
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const started = Date.now();
// A launcher can exit while its child still owns inherited output handles.
await runRuntimeLauncher(process.execPath, ['-e', `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:'inherit',windowsHide:true});c.unref();`]);
assert.ok(Date.now()-started < 1800, 'startup must not wait for long-lived child output'); checks++;
await assert.rejects(runRuntimeLauncher(process.execPath, ['-e', 'process.exit(7)']), /7/); checks++;
await assert.rejects(runRuntimeLauncher(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], {timeoutMs:100}), /超时/); checks++;

// Whose runtime is it: a stand-in ComfyUI listening in this very process.
const frees = [];
const server = http.createServer((req, res) => {
  if (req.url === '/system_stats') { res.end('{}'); return; }
  if (req.url === '/free' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { frees.push(JSON.parse(body)); res.end('{}'); });
    return;
  }
  res.statusCode = 404; res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const dir = await mkdtemp(join(tmpdir(), 'nf-runtime-'));
const stateFile = join(dir, 'owned-runtimes.json');
const scripts = [];
const make = () => createRuntimeServices({ imageUrl: 'http://127.0.0.1:' + port, stateFile, runScript: async (_entry, name) => { scripts.push(name); } });
const record = async () => { try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return null; } };
try {
  const who = await probeRuntimeListener(port);
  check(who && who.pid, process.pid, 'the listener on the port is identified');

  // Already running and never started by the assistant: borrowed. Stopping hands the memory back
  // once and never ends the process.
  let services = make();
  check((await services.start())[0].reused, true, 'a runtime found running is borrowed');
  await services.stop(); await services.stop();
  check(frees, [{ unload_models: true, free_memory: true }], 'stopping unloads a borrowed runtime once');
  check(scripts, [], 'and never runs its stop script');

  // Left behind by the last run (the record names this very process): taken back and stopped.
  await writeFile(stateFile, JSON.stringify({ ['image:' + port]: who }));
  services = make();
  check((await services.start())[0].adopted, true, 'the runtime the last run left is taken back');
  await services.stop();
  check(scripts, ['stop'], 'so stopping ends it');
  check(frees.length, 1, 'rather than only unloading it');
  check(await record(), {}, 'and its record is cleared');

  // A record of another process on the port (restarted by someone else): borrowed, record dropped.
  await writeFile(stateFile, JSON.stringify({ ['image:' + port]: { pid: who.pid, startedAt: '1' } }));
  services = make();
  check((await services.start())[0].reused, true, 'a different process on the recorded port is borrowed');
  check(await record(), {}, 'and the stale record goes');
  await services.stop();
  check([scripts.length, frees.length], [1, 2], 'it is unloaded, not ended');
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
console.log(checks + ' passed, 0 failed: launcher exit, failure and timeout; own, left-behind and borrowed runtimes');

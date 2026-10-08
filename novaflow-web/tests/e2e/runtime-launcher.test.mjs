import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
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

// Somebody's own ComfyUI on the port (a portable install: main.py relative, no NovaFlow nodes) is
// not borrowed: the runtime starts on an alternate port, through a second runtime folder whose
// runtime.json names that port and whose engine is the installed one.
const comfyAt = (argv) => http.createServer((req, res) => {
  if (req.url === '/system_stats') { res.end(JSON.stringify({ system: { argv } })); return; }
  res.statusCode = 404; res.end();
});
const listen = (srv, p = 0) => new Promise(resolve => srv.listen(p, '127.0.0.1', () => resolve(srv.address().port)));
const freePort = async () => { const s = http.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; };
const home = await mkdtemp(join(tmpdir(), 'nf-runtime-home-'));
const data = await mkdtemp(join(tmpdir(), 'nf-runtime-data-'));
const foreign = comfyAt(['ComfyUI\\main.py', '--windows-standalone-build', '--listen', '0.0.0.0']);
const foreignPort = await listen(foreign);
const servers = [foreign];
try {
  await mkdir(join(home, 'scripts'), { recursive: true });
  await mkdir(join(home, 'engine', 'ComfyUI'), { recursive: true });
  await mkdir(join(home, 'logs'), { recursive: true });
  await writeFile(join(home, 'engine', 'ComfyUI', 'main.py'), '# engine');
  for (const name of ['start', 'stop']) await writeFile(join(home, 'scripts', name + '-runtime.bat'), '@echo ' + name);
  await writeFile(join(home, 'runtime.json'), '\uFEFF' + JSON.stringify({ name: 'NovaFlow AI Runtime', port: foreignPort, modelsPath: 'C:\\NOVAFLOW\\models' }));
  const alternate = await freePort();
  const ran = [];
  const moved = () => createRuntimeServices({
    imageUrl: 'http://127.0.0.1:' + foreignPort, stateFile: join(data, 'owned-runtimes.json'), roots: { image: home }, alternatePorts: [alternate],
    runScript: async (entry, name) => {
      ran.push([name, entry.root]);
      if (name !== 'start') return;
      const config = JSON.parse(await readFile(join(entry.root, 'runtime.json'), 'utf8'));
      check(config.port, alternate, 'the second folder\'s runtime.json names the alternate port');
      check(config.modelsPath, 'C:\\NOVAFLOW\\models', 'and keeps everything else');
      check(await readFile(join(entry.root, 'engine', 'ComfyUI', 'main.py'), 'utf8'), '# engine', 'its engine is the installed one');
      check(await readFile(join(entry.root, 'scripts', 'stop-runtime.bat'), 'utf8'), '@echo stop', 'and so are its scripts');
      servers.push(comfyAt([join(entry.root, 'engine', 'ComfyUI', 'main.py'), '--port', String(alternate)]));
      await listen(servers.at(-1), alternate);
    }
  });
  let services = moved();
  let [image] = await services.start();
  check([image.url, image.running, image.reused], ['http://127.0.0.1:' + alternate, true, false], 'the runtime starts on the alternate port');
  const shadow = join(data, 'runtime-alt', 'image-' + alternate);
  check(ran, [['start', shadow]], 'from the second runtime folder');

  // The same assistant run starts again later: still on the alternate port, its own runtime there is
  // taken back rather than started twice.
  services = moved();
  [image] = await services.start();
  check([image.url, image.adopted], ['http://127.0.0.1:' + alternate, true], 'a runtime left on the alternate port is taken back');
  await services.stop();
  check(ran.at(-1), ['stop', shadow], 'and stopped through the same folder');

  // A NovaFlow runtime on the configured port (the desktop client's) is still borrowed.
  servers.at(-1).close();
  const desktop = comfyAt([join(home, 'engine', 'ComfyUI', 'main.py'), '--port', String(foreignPort)]);
  foreign.close();
  await listen(desktop, foreignPort);
  servers.push(desktop);
  services = moved();
  [image] = await services.start();
  check([image.url, image.reused], ['http://127.0.0.1:' + foreignPort, true], 'NovaFlow\'s own runtime on the port is borrowed as before');
  await services.stop();
} finally {
  for (const s of servers) s.close();
  await rm(home, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
}
console.log(checks + ' passed, 0 failed: launcher exit, failure and timeout; own, left-behind and borrowed runtimes; a foreign ComfyUI moves the runtime to another port');

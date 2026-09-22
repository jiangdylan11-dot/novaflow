// Explicit live GPU acceptance: node tools/verify-generation-routes.mjs [cutout|inpaint|art|video]
// Uses an isolated local control plane and the real built browser/worker code.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { startLocalControlPlane } from '../control-local/src/server.mjs';
import { createWorker } from '../worker/src/worker-core.mjs';
import { createDomSandbox } from '../worker/src/comfy/dom-shim.mjs';
import { instrumentModule } from './instrument-workflow-module.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, '.artifacts/generation-routes');
await mkdir(out, { recursive: true });
const control = await startLocalControlPlane({ port: 0 });
const post = async (path, body) => (await fetch(control.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const login = await post('/dev/login', { email: 'generation-routes@novaflow.local', balance: 0 });
const code = await post('/dev/registration-code', { email: 'generation-routes@novaflow.local' });
const worker = createWorker({ controlUrl: control.url, dataDir: join(out, 'worker'), configPath: join(out, 'identity.json'),
  workflowDir: join(root, 'worker/workflows'), rendererDir: join(root, 'worker-renderer'), tunnel: false,
  registrationCode: code.registration_code, gatewayPort: 0, gatewayHost: '127.0.0.1', pollIntervalMs: 500,
  logger: (event, data) => { if (/failed|queued|host ready/.test(event)) console.log(event, JSON.stringify(data)); }
});
const results = [];
try {
  await worker.start();
  const sandbox = createDomSandbox({ fetch, Response, Request, Blob, FormData,
    setTimeout, clearTimeout, HTMLButtonElement: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {},
    NOVAFLOW_WEB_CONFIG: { controlUrl: control.url }
  });
  const context = createContext(sandbox);
  runInContext(await readFile(join(root, 'web-dist/novaflow-web-runtime.js'), 'utf8'), context);
  sandbox.NovaFlowWebRuntime.setSession(login.session);
  runInContext(await readFile(join(root, 'web-dist/ai-sequence-minimax-h3.workflow.js'), 'utf8'), context);
  const brand = instrumentModule(await readFile(join(root, 'web-dist/novaflow-brand-runtime.js'), 'utf8'), {
    moduleName: 'browser-art', forceNames: ['buildArtGenerateRunWorkflow']
  });
  // UI timers are irrelevant here; only its actual builder entry is executed.
  sandbox.setTimeout = () => 0;
  runInContext(brand.code, context);
  sandbox.setTimeout = setTimeout;
  const image = await readFile(join(root, 'tests/fixtures/generation-routes/source.png'));
  const mask = await readFile(join(root, 'tests/fixtures/generation-routes/mask.png'));
  const upload = async (name, bytes) => (await sandbox.electronAPI.runtimeUploadImage({ fileName: name, dataBase64: bytes.toString('base64') })).data.name;
  const cases = process.argv.slice(2).length ? process.argv.slice(2) : ['cutout', 'inpaint', 'art', 'video'];
  for (const kind of cases) {
    const started = Date.now();
    try {
      let prompt, prefix = 'NovaFlow_Verify_' + kind;
      if (kind === 'cutout') {
        prompt = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultRmbgWorkflow', ['', await upload('source.png', image), prefix, null]);
      } else if (kind === 'inpaint') {
        prompt = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', 'defaultQwenInpaintWorkflow', ['', await upload('source.png', image), await upload('mask.png', mask), prefix, 'Complete the blue cup naturally.', { inpaintMode: 'complete' }]);
      } else if (kind === 'art') {
        prompt = sandbox.__nfBuilders['browser-art'].buildArtGenerateRunWorkflow('local', 'txt2img', [], prefix, 'a girl by the sea, game illustration', '', 'verify', [], {
          mode: 'txt2img', provider: 'local', width: 512, height: 512, localTextQuality: 'instant', randomSeed: false, seed: 42, nsfw: false
        }).workflow;
      } else if (kind === 'video') {
        prompt = sandbox.NovaFlowAiSequenceMiniMaxH3Workflow.getWorkflowJson({ mode: 't2v', prompt: 'A girl by the sea, gentle breeze, locked camera.', width: 352, height: 608, durationSeconds: 1, seed: 42 });
      } else throw new Error('unknown case ' + kind);
      console.log('START', kind);
      const sent = await sandbox.fetch('http://127.0.0.1:' + (kind === 'video' ? '8189' : '8188') + '/prompt', { method: 'POST', body: JSON.stringify({ prompt }) });
      const body = await sent.json();
      if (!sent.ok || !body.prompt_id) throw new Error(JSON.stringify(body));
      const id = body.prompt_id;
      let files;
      let lastNote = '';
      while (Date.now() - started < 20 * 60000) {
        const reply = await sandbox.electronAPI.runtimeRequestJson({ path: '/history/' + id });
        const entry = reply.data?.[id];
        if (entry?.status.status_str === 'error') throw new Error(JSON.stringify(entry.status.messages));
        const note = entry?.novaflow?.note;
        if (note && note !== lastNote) { console.log(kind, note); lastNote = note; }
        if (entry?.status.completed) {
          files = Object.values(entry.outputs).flatMap(v => [...(v.images || []), ...(v.gifs || [])]);
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!files?.length) throw new Error('no output before timeout');
      if (kind !== 'video' && !files.some(f => f.filename.startsWith(prefix))) throw new Error('art output prefix was lost');
      const file = files[0];
      const binary = await sandbox.electronAPI.runtimeRequestBinary({ path: '/view?filename=' + encodeURIComponent(file.filename) });
      if (!binary.ok || !binary.dataBase64) throw new Error(binary.error || 'no binary output');
      const output = join(out, kind + (kind === 'video' ? '.mp4' : '.png'));
      const bytes = Buffer.from(binary.dataBase64, 'base64');
      await writeFile(output, bytes);
      results.push({ kind, ok: true, taskId: id, elapsedMs: Date.now() - started, bytes: bytes.length, contentType: binary.contentType, output });
      console.log('PASS', kind, bytes.length, 'bytes');
    } catch (error) {
      results.push({ kind, ok: false, error: String(error.message || error), elapsedMs: Date.now() - started });
      console.log('FAIL', kind, String(error.message || error));
    }
    await writeFile(join(out, 'results-' + cases.join('-') + '.json'), JSON.stringify(results, null, 2));
  }
} finally {
  await worker.stop();
  await new Promise(r => control.server.close(r));
}
process.exit(results.some(r => !r.ok) ? 1 : 0);

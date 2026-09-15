'use strict';
// Exercise the production wash orchestrator with a recorded, non-explicit style
// profile. Only LoRA strength changes inside each paired comparison.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { loadWash } = require('./qwen-image-wash-smoke.cjs');
const root = path.resolve(__dirname, '..');
const mode = process.env.NF_WASH_SMOKE_MODE || 'wan';
const out = path.join(root, mode === 'smoothmix' ? 'docs/smoothmix-image-wash-integration' : 'docs/wan-image-wash-lora-validation');
const base = 'http://127.0.0.1:8188';
const sha = data => createHash('sha256').update(data).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
async function api(route, body) {
  const r = await fetch(base + route, { ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error(`${route}: ${r.status} ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
async function idle() {
  const q = await api('/queue');
  if (q.queue_running.length || q.queue_pending.length) throw Error('Runtime busy; no validation submitted.');
}
async function main() {
  if (mode !== 'wan') throw Error('Alternative wash routes were removed. Only Wan wash can be tested from the current application.');
  fs.mkdirSync(out, { recursive: true });
  await idle();
  const info = await api('/object_info');
  const source = fs.readFileSync(path.join(root, 'docs/smoothmix-image-wash-validation/source.png'));
  fs.writeFileSync(path.join(out, 'source.png'), source);
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'docs/image-wash-q5-optimization/qwen3-analysis/profile-with-medium.json'), 'utf8'));
  save('profile.json', profile);
  const cases = mode === 'smoothmix'
    ? [['smoothmix-low', .2, 0], ['smoothmix-medium', .65, 0]]
    : [['off-low', .2, 0], ['on-low', .2, .6], ['off-medium', .65, 0], ['on-medium', .65, .6]];
  for (const [name, denoise, wanLoraStrength] of cases) {
    if (fs.existsSync(path.join(out, name + '-run.json'))) throw Error(`Already recorded: ${name}; inspect evidence instead of overwriting.`);
    const s = loadWash();
    s.detectComfyBaseUrl = async () => base;
    s.comfyAllObjectInfo = async () => info;
    s.setSplitBusyDetail = () => {};
    s.runImageWashReversePrompt = async () => profile;
    s.uploadDataUrl = async (_base, _name, data) => {
      const form = new FormData();
      form.append('image', new Blob([Buffer.from(data.split(',')[1], 'base64')], { type: 'image/png' }), 'wan_lora_validation_source.png');
      form.append('overwrite', 'true');
      const r = await fetch(base + '/upload/image', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Error(await r.text());
      const upload = await r.json();
      return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
    };
    s.runPromptForFirstImage = async (_base, graph) => {
      await idle();
      const loras = Object.values(graph).filter(n => n.class_type === 'LoraLoaderModelOnly');
      assert.equal(loras.length, mode === 'smoothmix' ? 0 : wanLoraStrength ? 2 : 1);
      if (mode === 'smoothmix') {
        assert.equal(graph['3'].class_type, 'UNETLoader');
        assert.equal(graph['3'].inputs.unet_name, 'Wan22\\smoothMixWan2214BI2V_t2vLowV40.safetensors');
        assert.match(graph['9'].inputs.text, /^smoothmixanime/);
      }
      if (wanLoraStrength) assert.equal(graph['14'].inputs.strength_model, wanLoraStrength);
      save(name + '-workflow.json', graph);
      const start = Date.now();
      const submitted = await api('/prompt', { prompt: graph, client_id: 'novaflow-wan-lora-validation' });
      const record = { name, mode, denoise, wanLoraStrength, seed: 9122026, promptId: submitted.prompt_id, status: 'submitted', sourceSha256: sha(source), reverseInference: 'Recorded profile reused; live Prompt Assistant not exercised.', runtimeSourceSha256: sha(fs.readFileSync(path.join(root, 'particle-editor/spine-split-runtime.js'))) };
      save(name + '-run.json', record);
      console.log(name, 'submitted', submitted.prompt_id);
      let run;
      while (Date.now() - start < 600000) {
        run = (await api('/history/' + submitted.prompt_id))[submitted.prompt_id];
        if (run?.status?.completed || run?.status?.status_str === 'error') break;
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      if (!run?.status?.completed && run?.status?.status_str !== 'error') {
        await api('/interrupt', { prompt_id: submitted.prompt_id });
      }
      record.status = run?.status?.status_str || 'timeout';
      record.seconds = (Date.now() - start) / 1000;
      save(name + '-run.json', record);
      if (record.status !== 'success') throw Error(JSON.stringify(run?.status || record));
      assert.deepEqual(run.prompt[2], JSON.parse(JSON.stringify(graph)));
      save(name + '-history.json', run);
      const ref = Object.values(run.outputs).flatMap(n => n.images || [])[0];
      if (!ref) throw Error('Successful task has no image.');
      const response = await fetch(base + '/view?' + new URLSearchParams(ref));
      if (!response.ok) throw Error('Output download failed');
      const bytes = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(path.join(out, name + '.png'), bytes);
      record.outputSha256 = sha(bytes);
      record.output = ref;
      save(name + '-run.json', record);
      console.log(name, 'success', record.seconds, 'seconds');
      return 'data:image/png;base64,' + bytes.toString('base64');
    };
    await s.runImageWash('data:image/png;base64,' + source.toString('base64'), 'source.png', { mode, denoise, seed: 9122026, wanLoraStrength });
    save(name + '-debug.json', s.state.lastProcessingDebug);
  }
  await idle();
  await api('/free', { unload_models: true, free_memory: true });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

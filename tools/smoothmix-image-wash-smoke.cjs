'use strict';
// Isolated candidate evaluation. Does not mutate application workflows or models.
const fs = require('node:fs');
const path = require('node:path');
const { loadWash } = require('./qwen-image-wash-smoke.cjs');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8188';
const candidate = 'smoothMixWan22I2V14B_i2vLow.safetensors';
function adaptSmooth(graph, conditioned = true) {
  const g = structuredClone(graph);
  g['3'] = { class_type: 'UNETLoader', inputs: { unet_name: candidate, weight_dtype: 'default' } };
  delete g['4']; // Do not assume the production T2V acceleration LoRA is suitable.
  g['5'].inputs.model = ['3', 0];
  Object.assign(g['11'].inputs, { steps: 20, cfg: 3.5 });
  if (conditioned) {
    g['14'] = { class_type: 'GetImageSize', inputs: { image: ['2', 0] } };
    g['15'] = { class_type: 'WanImageToVideo', inputs: {
      positive: ['9', 0], negative: ['10', 0], vae: ['7', 0],
      width: ['14', 0], height: ['14', 1], length: 1, batch_size: 1, start_image: ['2', 0]
    } };
    g['11'].inputs.positive = ['15', 0];
    g['11'].inputs.negative = ['15', 1];
  }
  // Keep the encoded original as the sampler starting point (not an empty video).
  return g;
}
async function main() {
  const input = process.argv[2];
  if (!input) throw Error('Pass a non-sensitive comparison image.');
  const out = path.resolve(root, process.env.NF_SMOOTH_OUTPUT || 'docs/smoothmix-image-wash-validation');
  fs.mkdirSync(out, { recursive: true });
  const json = async (route, options) => {
    const r = await fetch(base + route, { ...options, signal: AbortSignal.timeout(30000) });
    const j = await r.json(); if (!r.ok) throw Error(JSON.stringify(j)); return j;
  };
  const idle = async () => {
    const q = await json('/queue');
    if (q.queue_running.length || q.queue_pending.length) throw Error('User work exists; no test submitted.');
  };
  await idle();
  const info = await json('/object_info');
  const source = fs.readFileSync(input);
  fs.writeFileSync(path.join(out, 'source.png'), source);
  const form = new FormData();
  form.append('image', new Blob([source], { type: 'image/png' }), 'smoothmix_wash_comparison_source.png');
  form.append('overwrite', 'true');
  const upload = await json('/upload/image', { method: 'POST', body: form });
  const filename = upload.subfolder ? upload.subfolder + '/' + upload.name : upload.name;
  const s = loadWash();
  s.imageWashSeed = () => 9122026;
  const description = 'A polished anime illustration of a hiker with short dark bob hair, orange short-sleeved buttoned shirt, olive green shorts and a large green backpack, standing on a sunlit countryside road. Blue sky, soft clouds, distant hills, trees, grass and fences. Gentle warm light, soft painted shading and delicate material textures.';
  const cases = (process.env.NF_SMOOTH_CASES || 'wan-low,wan-medium,smooth-low,smooth-medium').split(',');
  for (const name of cases) {
    const strength = name.endsWith('low') ? .2 : .65;
    const prefix = 'NovaFlow_validation/smooth_wash_' + name;
    const prompt = s.buildImageWashFinalPrompt(description, 'wan', strength);
    let graph = s.buildWanImageWashWorkflow(info, filename, prefix, prompt, strength);
    if (name.startsWith('smooth')) graph = adaptSmooth(graph, !name.includes('unconditioned'));
    await idle();
    fs.writeFileSync(path.join(out, name + '-workflow.json'), JSON.stringify(graph, null, 2));
    const started = Date.now();
    const submitted = await json('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'novaflow-smooth-wash-evaluation' }) });
    const evidence = { case: name, strength, promptId: submitted.prompt_id, seed: 9122026, fixedDescription: description, reverseInference: 'not exercised; fixed identical description for comparison', status: 'submitted' };
    const save = () => fs.writeFileSync(path.join(out, name + '-run.json'), JSON.stringify(evidence, null, 2));
    save(); console.log(name, 'submitted', submitted.prompt_id);
    let run;
    while (Date.now() - started < 1200000) {
      run = (await json('/history/' + submitted.prompt_id))[submitted.prompt_id];
      if (run?.status?.completed || run?.status?.status_str === 'error') break;
      await new Promise(r => setTimeout(r, 2500));
    }
    evidence.seconds = (Date.now() - started) / 1000;
    evidence.status = run?.status?.status_str || 'timeout';
    evidence.runtimeStatus = run?.status;
    save();
    if (evidence.status !== 'success') throw Error(JSON.stringify(evidence));
    const output = Object.values(run.outputs).flatMap(x => x.images || [])[0];
    if (!output) throw Error('Missing generated image');
    const r = await fetch(base + '/view?' + new URLSearchParams(output));
    if (!r.ok) throw Error('Image fetch failed');
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(await r.arrayBuffer()));
    console.log(name, 'success', Math.round(evidence.seconds), 'seconds');
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { adaptSmooth };

'use strict';
// Controlled weight-swap experiment; the application and model files stay intact.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const previous = path.join(root, 'docs/smoothmix-image-wash-validation');
const out = path.resolve(root, process.env.NF_REMIX_OUTPUT || 'docs/remix-image-wash-validation');
const base = 'http://127.0.0.1:8188';
const candidate = 'Wan22\\wan22RemixT2VI2V_t2vLowV20-Q5_K_M.gguf';
async function json(route, options) {
  const r = await fetch(base + route, { ...options, signal: AbortSignal.timeout(30000) });
  const value = await r.json();
  if (!r.ok) throw Error(JSON.stringify(value));
  return value;
}
async function idle() {
  const q = await json('/queue');
  if (q.queue_running.length || q.queue_pending.length) throw Error('Runtime busy; no test submitted.');
}
async function main() {
  const profile = process.env.NF_REMIX_STYLE ? JSON.parse(fs.readFileSync(path.resolve(root, process.env.NF_REMIX_STYLE), 'utf8')) : null;
  const wash = profile ? require('./qwen-image-wash-smoke.cjs').loadWash() : null;
  await idle();
  const info = await json('/object_info/LoaderGGUF');
  const choices = info.LoaderGGUF?.input?.required?.gguf_name?.[0];
  const model = choices?.find(x => x.replaceAll('\\', '/') === candidate.replaceAll('\\', '/'));
  if (!model) throw Error('Candidate not registered in LoaderGGUF');
  fs.mkdirSync(out, { recursive: true });
  for (const file of ['source.png', 'wan-low.png', 'wan-medium.png', 'wan-low-run.json', 'wan-medium-run.json', 'wan-low-workflow.json', 'wan-medium-workflow.json']) {
    fs.copyFileSync(path.join(previous, file), path.join(out, file));
  }
  const form = new FormData();
  form.append('image', new Blob([fs.readFileSync(path.join(out, 'source.png'))], { type: 'image/png' }), 'remix_wash_comparison_source.png');
  form.append('overwrite', 'true');
  const upload = await json('/upload/image', { method: 'POST', body: form });
  for (const name of (process.env.NF_REMIX_CASES || 'remix-low,remix-medium').split(',')) {
    const level = name.endsWith('low') ? 'low' : 'medium';
    const graph = JSON.parse(fs.readFileSync(path.join(previous, `wan-${level}-workflow.json`), 'utf8'));
    if (process.env.NF_REMIX_STRENGTH) {
      const strength = Number(process.env.NF_REMIX_STRENGTH);
      if (!Number.isFinite(strength) || strength <= 0 || strength > 1) throw Error('Invalid validation strength');
      graph['11'].inputs.denoise = strength;
    }
    graph['1'].inputs.image = upload.subfolder ? upload.subfolder + '/' + upload.name : upload.name;
    if (!name.startsWith('wan-style')) graph['3'].inputs.gguf_name = model;
    if (profile) graph['9'].inputs.text = wash.buildImageWashFinalPrompt(profile, 'wan', graph['11'].inputs.denoise);
    if (profile && process.env.NF_REMIX_FORMAT === 'descriptive') {
      graph['9'].inputs.text = `${profile.style}. ${profile.content}. The entire subject and background share this visual treatment: ${profile.style}.`;
    }
    if (profile && process.env.NF_REMIX_FORMAT === 'medium-first') {
      graph['9'].inputs.text = require('./wan-wash-prompt-candidate.cjs').buildMediumFirstPrompt(profile);
    }
    if (profile && process.env.NF_REMIX_MEDIUM_NEGATIVE === '1') graph['10'].inputs.text = wash.imageWashNegativePrompt('wan', profile);
    if (process.env.NF_REMIX_CFG) graph['11'].inputs.cfg = Number(process.env.NF_REMIX_CFG);
    if (process.env.NF_REMIX_STEPS) graph['11'].inputs.steps = Number(process.env.NF_REMIX_STEPS);
    if (process.env.NF_REMIX_SHIFT) graph['5'].inputs.shift = Number(process.env.NF_REMIX_SHIFT);
    if (process.env.NF_REMIX_SCHEDULER) graph['11'].inputs.scheduler = process.env.NF_REMIX_SCHEDULER;
    if (process.env.NF_REMIX_NEGATIVE) graph['10'].inputs.text += ', ' + process.env.NF_REMIX_NEGATIVE;
    graph['13'].inputs.filename_prefix = 'NovaFlow_validation/' + name;
    if (name.includes('no-lora')) {
      delete graph['4'];
      graph['5'].inputs.model = ['3', 0];
    }
    if (process.env.NF_REMIX_CFG_NORM) {
      graph['14'] = { class_type: 'CFGNorm', inputs: { model: ['5', 0], strength: Number(process.env.NF_REMIX_CFG_NORM), pre_cfg: process.env.NF_REMIX_CFG_NORM_PRE === '1' } };
      graph['11'].inputs.model = ['14', 0];
    }
    await idle();
    fs.writeFileSync(path.join(out, name + '-workflow.json'), JSON.stringify(graph, null, 2));
    const started = Date.now();
    const submitted = await json('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'novaflow-remix-wash-evaluation' }) });
    const record = { case: name, promptId: submitted.prompt_id, model: graph['3'].inputs.gguf_name, strength: graph['11'].inputs.denoise, status: 'submitted', baseline: `wan-${level}`, baselineReused: true, change: profile ? 'source style profile and revised production prompt; model as recorded' : name.includes('no-lora') ? 'weights and acceleration LoRA removed' : 'weights only; original LoRA and sampling retained', reverseInference: profile ? 'real image-wash-style vision profile loaded from recorded service response' : 'fixed baseline prompt; no reverse inference', styleProfile: profile };
    const save = () => fs.writeFileSync(path.join(out, name + '-run.json'), JSON.stringify(record, null, 2));
    record.sampling = { steps: graph['11'].inputs.steps, cfg: graph['11'].inputs.cfg, sampler: graph['11'].inputs.sampler_name, scheduler: graph['11'].inputs.scheduler, shift: graph['5'].inputs.shift, lora: graph['4']?.inputs || null, negative: graph['10'].inputs.text };
    if (process.env.NF_REMIX_PROFILE_SOURCE) record.reverseInference = process.env.NF_REMIX_PROFILE_SOURCE;
    record.promptFormat = process.env.NF_REMIX_FORMAT || 'production';
    record.sourceSha256 = createHash('sha256').update(fs.readFileSync(path.join(out, 'source.png'))).digest('hex');
    record.workflowSha256 = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
    record.samplerClass = graph['11'].class_type;
    record.outputBlend = false;
    record.productionDefaultChanged = false;
    record.guidanceNormalization = graph['14']?.inputs || null;
    save();
    console.log(name, 'submitted', record.promptId);
    let run;
    while (Date.now() - started < 1200000) {
      run = (await json('/history/' + record.promptId))[record.promptId];
      if (run?.status?.completed || run?.status?.status_str === 'error') break;
      await new Promise(r => setTimeout(r, 2500));
    }
    record.seconds = (Date.now() - started) / 1000;
    record.status = run?.status?.status_str || 'timeout';
    record.runtimeStatus = run?.status;
    if (run) fs.writeFileSync(path.join(out, name + '-history.json'), JSON.stringify(run, null, 2));
    save();
    if (record.status !== 'success') throw Error(JSON.stringify(record));
    const output = Object.values(run.outputs).flatMap(x => x.images || [])[0];
    if (!output) throw Error('Missing generated image');
    const response = await fetch(base + '/view?' + new URLSearchParams(output));
    if (!response.ok) throw Error('Cannot fetch result');
    const imageBytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(out, name + '.png'), imageBytes);
    record.outputSha256 = createHash('sha256').update(imageBytes).digest('hex');
    save();
    console.log(name, 'success', record.seconds, 'seconds');
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

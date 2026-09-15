'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadWash } = require('./qwen-image-wash-smoke.cjs');

async function main() {
  const [source, profileFile, output, strengths = '.2,.9', variant = 'standard'] = process.argv.slice(2);
  if (!['standard', 'distilled'].includes(variant)) throw Error('Variant must be standard or distilled');
  if (!source || !profileFile || !output) throw Error('Pass source, actual style-profile JSON, output directory, and strengths');
  const out = path.resolve(output);
  fs.mkdirSync(out, { recursive: true });
  const base = 'http://127.0.0.1:8188';
  const json = async (route, options) => {
    const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(15000) });
    const value = await response.json();
    if (!response.ok) throw Error(JSON.stringify(value));
    return value;
  };
  const info = await json('/object_info');
  const runtime = loadWash();
  const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  const sourceBytes = fs.readFileSync(source);
  fs.copyFileSync(source, path.join(out, 'source.png'));
  for (const strength of strengths.split(',').map(Number)) {
    if (!Number.isFinite(strength) || strength < .1 || strength > 1) throw Error('Invalid strength');
    const queue = await json('/queue');
    if (queue.queue_running.length || queue.queue_pending.length) throw Error('Runtime busy; no candidate submitted');
    const form = new FormData();
    form.append('image', new Blob([sourceBytes], { type: 'image/png' }), `nf_q5_source_redraw_${Date.now()}.png`);
    const upload = await json('/upload/image', { method: 'POST', body: form });
    const imageName = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
    const name = `live-${strength}`;
    const graph = runtime.buildWanSourceRedrawWorkflow(info, imageName, `novaflow_q5_source_redraw_${Date.now()}`, strength, { styleProfile: profile, seed: 9122026, distilledCandidate: variant === 'distilled' });
    fs.writeFileSync(path.join(out, `${name}-workflow.json`), JSON.stringify(graph, null, 2));
    const submitted = await json('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'novaflow-q5-source-redraw-validation' }) });
    const recordFile = path.join(out, `${name}-run.json`);
    const record = { status: 'running', promptId: submitted.prompt_id, strength, model: graph['3'].inputs.gguf_name,
      steps: graph['11'].inputs.steps, cfg: graph['11'].inputs.cfg, seed: graph['11'].inputs.seed, variant,
      productionDefaultChanged: false, outputBlend: false, visionProfile: path.resolve(profileFile) };
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
    console.log(name, 'submitted', submitted.prompt_id);
    const start = Date.now();
    let run;
    while (Date.now() - start < 1200000) {
      run = (await json('/history/' + submitted.prompt_id))[submitted.prompt_id];
      if (run?.status?.completed || run?.status?.status_str === 'error') break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    record.seconds = (Date.now() - start) / 1000;
    record.status = run?.status?.status_str || 'timeout';
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));
    if (run) fs.writeFileSync(path.join(out, `${name}-history.json`), JSON.stringify(run, null, 2));
    if (record.status !== 'success') throw Error(JSON.stringify(run?.status || record));
    const image = run.outputs['13']?.images?.[0];
    if (!image) throw Error('No generated output');
    const response = await fetch(base + '/view?' + new URLSearchParams(image));
    if (!response.ok) throw Error('Output unavailable');
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(await response.arrayBuffer()));
    console.log(name, 'success', record.seconds, 'seconds');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

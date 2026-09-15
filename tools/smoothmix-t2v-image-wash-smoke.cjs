'use strict';
// Isolated T2V candidate evaluation. Reuses the recorded Wan baseline; no UI changes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const baseline = path.join(root, 'docs/smoothmix-image-wash-validation');
const out = path.resolve(root, process.env.NF_SMOOTH_T2V_OUTPUT || 'docs/smoothmix-t2v-v4-image-wash-validation');
const base = 'http://127.0.0.1:8188';
const modelFamily = process.env.NF_WASH_MODEL_FAMILY || 'smoothmix';
const originalWan = modelFamily === 'original-wan';
const candidate = originalWan ? 'Wan22/Wan2.2-T2V-A14B-LowNoise-Q4_K_S.gguf' : 'Wan22/smoothMixWan2214BI2V_t2vLowV40.safetensors';
const sha = data => createHash('sha256').update(data).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2));
async function api(route, body) {
  const response = await fetch(base + route, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`${route}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function idle() {
  const queue = await api('/queue');
  if (queue.queue_running.length || queue.queue_pending.length) throw Error('Runtime busy; no candidate submitted.');
}
async function main() {
  if (!['smoothmix', 'original-wan'].includes(modelFamily)) throw Error('Unknown comparison model family.');
  const levels = { low: 0.2, medium: 0.65, high: 0.9 };
  const cases = (process.env.NF_SMOOTH_T2V_CASES || 'medium').split(',');
  if (cases.some(level => !(level in levels))) throw Error('Cases must be low, medium or high.');
  const strengthOverride = process.env.NF_SMOOTH_T2V_STRENGTH === undefined ? null : Number(process.env.NF_SMOOTH_T2V_STRENGTH);
  if (strengthOverride !== null && (!Number.isFinite(strengthOverride) || strengthOverride <= 0 || strengthOverride > 1)) throw Error('Invalid strength override.');
  const scheduler = process.env.NF_SMOOTH_T2V_SCHEDULER || 'simple';
  const steps = Number(process.env.NF_SMOOTH_T2V_STEPS || 8);
  const cfg = Number(process.env.NF_SMOOTH_T2V_CFG || 1);
  const shift = Number(process.env.NF_SMOOTH_T2V_SHIFT || 8);
  if (![steps, cfg, shift].every(Number.isFinite) || steps < 1 || steps > 40 || cfg < 1 || cfg > 6 || shift < 1 || shift > 12) throw Error('Invalid sampling settings.');
  if (!['simple', 'beta'].includes(scheduler)) throw Error('Unexpected scheduler.');
  const promptFormat = process.env.NF_SMOOTH_T2V_PROMPT || 'baseline';
  if (!['baseline', 'medium-first'].includes(promptFormat)) throw Error('Unexpected prompt format.');
  const variant = `${scheduler}-${steps}-cfg${cfg}-shift${shift}${promptFormat === 'baseline' ? '' : '-medium-first'}${strengthOverride === null ? '' : '-denoise' + strengthOverride}`;
  const fixture = process.env.NF_SMOOTH_T2V_FIXTURE ? JSON.parse(fs.readFileSync(path.resolve(root, process.env.NF_SMOOTH_T2V_FIXTURE), 'utf8')) : null;
  if (fixture && (!/^[a-z0-9-]+$/.test(fixture.id) || !fixture.source || !fixture.profile?.medium || !fixture.prompt || typeof fixture.styleTrigger !== 'string')) throw Error('Incomplete fixture definition.');
  const profile = fixture?.profile || JSON.parse(fs.readFileSync(path.join(root, 'docs/image-wash-q5-optimization/qwen3-analysis/profile-with-medium.json'), 'utf8'));
  const anime = /\banime\b|\bmanga\b/i.test(profile.medium);
  if (!fixture && !anime) throw Error('This recorded fixture is expected to be anime; inspect its profile before adapting.');
  const styleTrigger = originalWan ? '' : fixture ? fixture.styleTrigger : 'smoothmixanime, anime style';
  const sourceFile = fixture ? path.resolve(root, fixture.source) : path.join(baseline, 'source.png');
  await idle();
  const loader = originalWan ? 'LoaderGGUF' : 'UNETLoader';
  const modelInput = originalWan ? 'gguf_name' : 'unet_name';
  const info = await api('/object_info/' + loader);
  const model = info[loader].input.required[modelInput][0].find(name => name.replaceAll('\\', '/') === candidate);
  if (!model) throw Error(`${candidate} not registered in ${loader}.`);
  let originalLora;
  if (originalWan) {
    const loraInfo = await api('/object_info/LoraLoaderModelOnly');
    originalLora = loraInfo.LoraLoaderModelOnly.input.required.lora_name[0].find(name => name.replaceAll('\\', '/') === 'Wan21/Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors');
    if (!originalLora) throw Error('Original Wan acceleration LoRA is not registered.');
  }
  fs.mkdirSync(out, { recursive: true });
  for (const file of (fixture ? [] : ['source.png', 'wan-low.png', 'wan-medium.png', 'wan-low-run.json', 'wan-medium-run.json', 'wan-low-workflow.json', 'wan-medium-workflow.json'])) {
    fs.copyFileSync(path.join(baseline, file), path.join(out, file));
  }
  if (fixture) {
    fs.copyFileSync(sourceFile, path.join(out, 'source.png'));
    write('fixture.json', fixture);
  }
  const sourceBytes = fs.readFileSync(path.join(out, 'source.png'));
  const form = new FormData();
  form.append('image', new Blob([sourceBytes], { type: 'image/png' }), `smoothmix_t2v_v4_${fixture?.id || 'wash'}_source.png`);
  form.append('overwrite', 'true');
  const response = await fetch(base + '/upload/image', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error('Source upload failed: ' + await response.text());
  const upload = await response.json();
  for (const level of cases) {
    const strength = strengthOverride ?? levels[level];
    const name = `${originalWan ? 'original-wan' : 'smooth-t2v-v4'}-${fixture ? fixture.id + '-' : ''}${variant}-${level}`;
    if (fs.existsSync(path.join(out, name + '-run.json'))) throw Error('Case already recorded; use different settings or inspect the existing evidence: ' + name);
    const graph = JSON.parse(fs.readFileSync(path.join(baseline, 'wan-medium-workflow.json'), 'utf8'));
    graph['1'].inputs.image = upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
    if (originalWan) {
      graph['3'] = { class_type: 'LoaderGGUF', inputs: { gguf_name: model } };
      graph['4'].inputs.lora_name = originalLora;
      graph['5'].inputs = { model: ['4', 0], shift };
    } else {
      graph['3'] = { class_type: 'UNETLoader', inputs: { unet_name: model, weight_dtype: 'default' } };
      delete graph['4'];
      graph['5'].inputs = { model: ['3', 0], shift };
    }
    graph['9'].inputs.text = (styleTrigger ? styleTrigger + '. ' : '') + (promptFormat === 'medium-first'
      ? require('./wan-wash-prompt-candidate.cjs').buildMediumFirstPrompt(profile)
      : (fixture?.prompt || graph['9'].inputs.text));
    if (promptFormat === 'medium-first') graph['10'].inputs.text += ', photograph, photorealistic, live action, 3d render, CGI, doll, plastic skin, glossy skin, shiny plastic clothing, realistic skin pores';
    Object.assign(graph['11'].inputs, { steps, cfg, scheduler, denoise: strength });
    graph['13'].inputs.filename_prefix = 'NovaFlow_validation/' + name;
    await idle();
    // Release only cached models while idle; never interrupt another user's generation.
    await api('/free', { unload_models: true, free_memory: true });
    await pause(2000);
    await idle();
    write(name + '-workflow.json', graph);
    const record = {
      case: name, status: 'preparing', model, modelFamily, sourceSha256: sha(sourceBytes), workflowSha256: sha(JSON.stringify(graph)),
      strength, fixture: fixture?.id || null, baselineReused: !fixture && strengthOverride === null, baseline: fixture || level === 'high' || strengthOverride !== null ? null : `wan-${level}`,
      sampling: { steps, cfg, scheduler, shift, sampler: 'euler', seed: graph['11'].inputs.seed, externalLora: originalWan ? graph['4'].inputs : null },
      sourceStyleProfile: profile, styleTrigger,
      promptFormat,
      promptChange: fixture ? 'New fixture caption and medium manually observed from the actual source. Sampling is fixed; style trigger recorded explicitly.' : promptFormat === 'baseline' ? 'Recorded Wan baseline prompt plus author anime trigger, selected from the recorded source medium.' : 'Recorded source medium and content, expressed as 2D painted animation with author anime trigger; negative excludes photographic and 3D materials.',
      authorGuide: 'https://civitai.com/articles/32754/smoothmix-wan-22-t2v-v4-guide',
      settingProvenance: process.env.NF_SMOOTH_T2V_NOTE || (scheduler === 'beta' && steps === 7
        ? '7-step Euler/beta, CFG and shift from recorded NovaFlow baseline; author style trigger added and external acceleration LoRA removed. This is not a weights-only comparison.'
        : `Experimental ${steps}-step Euler/${scheduler}, CFG ${cfg}, shift ${shift}; not claimed as author v4 guidance.`),
      outputBlend: false, productionDefaultChanged: false, startedAt: new Date().toISOString(),
    };
    const save = () => write(name + '-run.json', record);
    save();
    const started = Date.now();
    try {
      const submitted = await api('/prompt', { prompt: graph, client_id: 'novaflow-smoothmix-t2v-v4-evaluation' });
      record.promptId = submitted.prompt_id;
      record.status = 'submitted';
      save();
      console.log(name, 'submitted', record.promptId);
      let history, lastLog = Date.now();
      while (Date.now() - started < 900000) {
        history = (await api('/history/' + record.promptId))[record.promptId];
        if (history?.status?.completed || history?.status?.status_str === 'error') break;
        if (Date.now() - lastLog > 30000) { console.log(name, 'running', Math.round((Date.now() - started) / 1000), 'seconds'); lastLog = Date.now(); }
        await pause(2500);
      }
      record.seconds = (Date.now() - started) / 1000;
      record.status = history?.status?.status_str || 'timeout';
      record.runtimeStatus = history?.status;
      if (history) write(name + '-history.json', history);
      save();
      if (record.status !== 'success') throw Error('Generation ' + record.status);
      const output = history.outputs['13']?.images?.[0];
      if (!output) throw Error('SaveImage returned no output.');
      const image = await fetch(base + '/view?' + new URLSearchParams(output), { signal: AbortSignal.timeout(30000) });
      if (!image.ok) throw Error('Cannot retrieve output.');
      const bytes = Buffer.from(await image.arrayBuffer());
      fs.writeFileSync(path.join(out, name + '.png'), bytes);
      record.output = output;
      record.outputSha256 = sha(bytes);
      save();
      console.log(name, 'success', record.seconds, 'seconds');
    } catch (error) {
      record.error = String(error);
      record.seconds = (Date.now() - started) / 1000;
      if (!['error', 'timeout', 'success'].includes(record.status)) record.status = 'harness_error';
      save();
      if (record.promptId) {
        try {
          const queue = await api('/queue');
          if (queue.queue_running.some(item => item[1] === record.promptId)) await api('/interrupt', { prompt_id: record.promptId });
          if (queue.queue_pending.some(item => item[1] === record.promptId)) await api('/queue', { delete: [record.promptId] });
        } catch (cleanupError) { record.cleanupError = String(cleanupError); save(); }
      }
      throw error;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

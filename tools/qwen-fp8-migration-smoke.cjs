'use strict';
// Runs neutral fixtures through the shipped Art and UI builders; leaves user queues alone.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8188';
function load(name) { const m = { exports: {} }; new Function('module', fs.readFileSync(path.join(root, 'particle-editor', name), 'utf8'))(m); return m.exports; }
const art = load('art-generate-model.resource.js');
const lora = load('art-generate-lora.js');
load('ui-design-local-resolution.helper.js');
const ui = load('ui-design-local.workflow.js');
const source = fs.readFileSync(path.join(root, 'particle-editor/novaflow-brand-runtime.js'), 'utf8');
const templates = vm.runInNewContext(source.slice(source.indexOf('const ART_GENERATE_WORKFLOW_TEMPLATES ='), source.indexOf('const ART_GENERATE_STATE =')) + ';ART_GENERATE_WORKFLOW_TEMPLATES');
async function json(route, options) {
  const res = await fetch(base + route, { ...options, signal: AbortSignal.timeout(30000) });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}
async function upload(name) {
  const form = new FormData();
  form.append('image', new Blob([fs.readFileSync(path.join(root, '.tmp-qwen-fp8-reference.png'))], { type: 'image/png' }), name);
  form.append('overwrite', 'true');
  const result = await json('/upload/image', { method: 'POST', body: form });
  return result.subfolder ? result.subfolder + '/' + result.name : result.name;
}
function resolvePrimitives(graph) {
  function resolve(value) {
    if (!Array.isArray(value)) return value;
    const node = graph[String(value[0])];
    if (node?.class_type.startsWith('Primitive')) return node.inputs.value;
    if (node?.class_type === 'ComfySwitchNode') return resolve(resolve(node.inputs.switch) ? node.inputs.on_true : node.inputs.on_false);
    return value;
  }
  for (const node of Object.values(graph)) for (const key of Object.keys(node.inputs || {})) node.inputs[key] = resolve(node.inputs[key]);
  for (const [id, node] of Object.entries(graph)) if (node.class_type.startsWith('Primitive') || node.class_type === 'ComfySwitchNode') delete graph[id];
  const used = new Set();
  function visit(id) { if (used.has(id)) return; used.add(id); for (const value of Object.values(graph[id]?.inputs || {})) if (Array.isArray(value) && graph[value[0]]) visit(String(value[0])); }
  Object.entries(graph).filter(([, n]) => n.class_type === 'SaveImage').forEach(([id]) => visit(id));
  return Object.fromEntries(Object.entries(graph).filter(([id]) => used.has(id)));
}
async function main() {
  const queue = await json('/queue');
  if (queue.queue_running.length || queue.queue_pending.length) throw new Error('Runtime busy; retry after user jobs finish');
  const primary = await upload('nf_fp8_migration_primary.png');
  const guide = await upload('nf_fp8_migration_guide.png');
  const evidence = [];
  for (const route of ['art-lora', 'ui-quality']) {
    let graph = JSON.parse(templates.img2img);
    graph['41'].inputs.image = primary; graph['83'].inputs.image = guide;
    graph['143:142'] = { class_type: 'ImageScale', inputs: { image: ['41', 0], upscale_method: 'lanczos', width: 512, height: 512, crop: 'disabled' } };
    graph['143:126'].inputs.prompt = 'Create a clean flat mobile game menu. Keep the three shapes and their positions. Use a dark navy background, a blue header, a golden circular emblem and a teal bottom button. No people, no text.';
    graph['143:124'].inputs.prompt = 'blurry, distorted, noise';
    graph['9'].inputs.filename_prefix = 'NovaFlow_validation/fp8_migration_' + route;
    graph['143:128'].inputs.seed = 9122511;
    delete graph['145']; delete graph['146'];
    if (route === 'art-lora') {
      const state = { provider: 'local', mode: 'img2img', nsfw: false, localEditStrength: 'faithful', loras: [{ name: 'qwen\\HQL0.2.safetensors', strength: 0.35 }] };
      graph = lora.apply(art.applyLocalWorkflowPreset(graph, state, 'img2img'), state);
      const { createQwenLoraCatalog } = require('../particle-editor-desktop/main/qwen-lora-catalog');
      lora.validate(graph, { ok: true, items: await createQwenLoraCatalog({ listRuntimeLoraNames: () => json('/object_info/LoraLoaderModelOnly') }).catalog() });
    } else {
      graph = ui.build({ taskProfile: 'ui-design', mode: 'img2img', localWorkflow: graph, layoutGuideEncoding: 'soft-ui-semantic-scaffold-v2', referenceRoles: [{ role: 'reference', name: primary, autoPrimary: true }, { role: 'ui_layout', name: guide }], state: { width: 512, height: 512, uiRunIntent: 'redesign' } }).workflow;
    }
    graph = resolvePrimitives(graph);
    if (JSON.stringify(graph).includes('qwen_image_edit_2511_bf16.safetensors')) throw new Error('Retired model leaked into workflow');
    fs.writeFileSync(path.join(root, `.tmp-qwen-fp8-${route}.json`), JSON.stringify(graph, null, 2));
    const submitted = await json('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'nf-fp8-migration-' + route }) });
    console.log(JSON.stringify({ route, prompt_id: submitted.prompt_id, event: 'submitted' }));
    const deadline = Date.now() + 20 * 60 * 1000;
    let run;
    while (Date.now() < deadline) {
      run = (await json('/history/' + submitted.prompt_id))[submitted.prompt_id];
      if (run?.status?.completed || run?.status?.status_str === 'error') break;
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    const item = { route, prompt_id: submitted.prompt_id, status: run?.status, outputs: run?.outputs, model: Object.values(graph).find(n => n.class_type === 'UNETLoader')?.inputs, samplers: Object.values(graph).filter(n => n.class_type === 'KSampler').map(n => n.inputs), loras: Object.values(graph).filter(n => n.class_type === 'LoraLoaderModelOnly').map(n => n.inputs) };
    evidence.push(item);
    fs.writeFileSync(path.join(root, 'docs/qwen-fp8-migration-live-2026-09-12.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ route, prompt_id: submitted.prompt_id, status: run?.status?.status_str, outputs: run?.outputs }));
    if (run?.status?.status_str !== 'success') throw new Error(JSON.stringify(run?.status || 'timeout'));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

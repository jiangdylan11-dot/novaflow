'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadSpine } = require('./qwen-rapid-migration-smoke.cjs');
const root = path.resolve(__dirname, '..');

function loadWash(file = 'particle-editor/spine-split-runtime.js') {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const s = loadSpine(file);
  for (const match of source.matchAll(/^  const (IMAGE_WASH_[A-Z0-9_]+) = [^\r\n]+/gm)) {
    if (vm.runInContext(`typeof ${match[1]}`, s) === 'undefined') vm.runInContext(match[0], s);
  }
  return s;
}

async function main() {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const input = process.argv[2];
  if (!input) throw Error('Pass a non-sensitive local PNG/JPG used for visual acceptance.');
  const out = path.resolve(root, process.env.NF_WASH_OUTPUT || 'docs/qwen-image-wash-validation');
  fs.mkdirSync(out, { recursive: true });
  const base = 'http://127.0.0.1:8188';
  const json = async (route, options) => {
    const r = await fetch(base + route, { ...options, signal: AbortSignal.timeout(30000) });
    const result = await r.json();
    if (!r.ok) throw Error(JSON.stringify(result));
    return result;
  };
  const info = await json('/object_info');
  const source = await loadImage(input);
  const canvas = createCanvas(source.width, source.height);
  canvas.getContext('2d').drawImage(source, 0, 0);
  fs.writeFileSync(path.join(out, 'source.png'), canvas.toBuffer('image/png'));
  const sourceUrl = canvas.toDataURL('image/png');
  const description = process.env.NF_WASH_DESCRIPTION || 'An anime-style hiker on a countryside road, short dark hair, orange shirt, green backpack and shorts, soft painted shading. Keep the existing composition, identity, outfit, colours and art style.';
  const cases = process.env.NF_WASH_CASES ? process.env.NF_WASH_CASES.split(',') : ['redraw-default', 'redraw-high'];
  for (const name of cases) {
    const strength = name === 'redraw-default' ? 0.65 : name === 'redraw-high' ? 0.85 : name === 'after-medium' ? 0.6 : 0.2;
    const sourceFile = name === 'before' ? '.tmp-image-wash-before.js' : 'particle-editor/spine-split-runtime.js';
    const s = loadWash(sourceFile);
    s.document = { createElement: () => createCanvas(1, 1) };
    s.loadImage = loadImage;
    s.setSplitBusyDetail = () => {};
    s.detectComfyBaseUrl = async () => base;
    s.comfyAllObjectInfo = async () => info;
    s.runImageWashReversePrompt = async () => {
      if (name !== 'before') throw Error('Qwen wash incorrectly called standalone Prompt Assistant');
      return description;
    };
    s.imageWashSeed = () => 9122026;
    s.uploadDataUrl = async (_base, _name, data) => {
      const form = new FormData();
      form.append('image', new Blob([Buffer.from(data.split(',')[1], 'base64')], { type: 'image/png' }), `wash_validation_${name}.png`);
      form.append('overwrite', 'true');
      const result = await json('/upload/image', { method: 'POST', body: form });
      return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    };
    s.runPromptForFirstImage = async (_base, graph) => {
      const queue = await json('/queue');
      if (queue.queue_running.length || queue.queue_pending.length) throw Error('Runtime has user work; no validation task submitted.');
      fs.writeFileSync(path.join(out, `${name}-workflow.json`), JSON.stringify(graph, null, 2));
      const submitted = await json('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'novaflow-qwen-wash-validation' }) });
      console.log(name, 'submitted', submitted.prompt_id);
      const start = Date.now();
      let run;
      while (Date.now() - start < 900000) {
        run = (await json('/history/' + submitted.prompt_id))[submitted.prompt_id];
        if (run?.status?.completed || run?.status?.status_str === 'error') break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (run?.status?.status_str !== 'success') throw Error(JSON.stringify(run?.status || { timeout: submitted.prompt_id }));
      const image = Object.values(run.outputs).flatMap(o => o.images || [])[0];
      if (!image) throw Error('No output image');
      const r = await fetch(base + '/view?' + new URLSearchParams(image));
      if (!r.ok) throw Error('Generated image unavailable');
      const data = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(path.join(out, `${name}-raw.png`), data);
      fs.writeFileSync(path.join(out, `${name}-run.json`), JSON.stringify({ promptId: submitted.prompt_id, seconds: (Date.now() - start) / 1000, status: run.status.status_str, strength, seed: 9122026, standaloneReverse: name === 'before' ? 'stubbed for legacy comparison' : 'forbidden; direct image conditioning verified' }, null, 2));
      console.log(name, 'success', Math.round((Date.now() - start) / 1000), 'seconds');
      return 'data:image/png;base64,' + data.toString('base64');
    };
    const result = await s.runImageWash(sourceUrl, 'source.png', { mode: 'qwenNsfw', denoise: strength, seed: 9122026 });
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(result.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(out, `${name}-debug.json`), JSON.stringify(s.state.lastProcessingDebug, null, 2));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { loadWash };

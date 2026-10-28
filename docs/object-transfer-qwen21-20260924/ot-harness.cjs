'use strict';
// Live A/B harness for 万物迁移: runs the REAL renderer pipeline (RMBG cutout -> 画风转换 -> placement ->
// integration -> decode) from novaflow-web/renderer/spine-split-runtime.js inside a Node sandbox, against
// the local ComfyUI, once per engine. Engines: bf16 / fp8mixed (2511 graphs from the production builder)
// and q21* (Qwen-Image-2.1 candidate graphs built here).
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createCanvas, loadImage: napiLoadImage } = require('@napi-rs/canvas');
const { loadSpine } = require('D:/AI_APP/NovaFlow-Web/tools/qwen-rapid-migration-smoke.cjs');

const baseUrl = process.env.NF_COMFY || 'http://127.0.0.1:8188';
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
const sceneFile = path.resolve(arg('scene')), objectFile = path.resolve(arg('object'));
const caseName = arg('case', path.basename(sceneFile, '.png') + '__' + path.basename(objectFile, '.png'));
const outDir = path.resolve(arg('out', 'ot-out'), caseName); fs.mkdirSync(outDir, { recursive: true });
const cacheDir = path.resolve(arg('out', 'ot-out'), 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
const place = arg('place', '0.08,0.72,0.28').split(',').map(Number); // x,y as fractions of scene w/h; w as fraction of scene width
const seeds = arg('seeds', '9122026').split(',').map(Number);
const engineNames = arg('engines', 'fp8mixed,q21').split(',');
const sceneArtStyle = arg('style', '');
const steps21 = Number(arg('steps21', 25));

const OBJECT_TRANSFER_NEGATIVE_PROMPT = '物体浮在半空，贴纸，描边，拼接边缘，平涂色块';
const ENGINES = {
  bf16: { kind: '2511', unet: 'qwen_image_edit_2511_bf16.safetensors' },
  fp8mixed: { kind: '2511', unet: 'qwen_image_edit_2511_fp8mixed.safetensors' },
  fp8def: { kind: '2511', unet: 'qwen_image_edit_2511_fp8mixed.safetensors', dtype: 'default' },
  q21: { kind: '21', steps: steps21, cfg: 1, negative: '', restyleCfg: 1 },
  q21n: { kind: '21', steps: steps21, cfg: 2.5, negative: OBJECT_TRANSFER_NEGATIVE_PROMPT, restyleCfg: 1 },
  q21s40: { kind: '21', steps: 40, cfg: 1, negative: '', restyleCfg: 1 },
};

const dataOf = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
const writeData = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function json(route, options) {
  const r = await fetch(baseUrl + route, { ...options, signal: AbortSignal.timeout(60000) });
  const v = await r.json(); if (!r.ok) throw new Error(JSON.stringify(v)); return v;
}

function sandbox() {
  const s = loadSpine('novaflow-web/renderer/spine-split-runtime.js');
  s.document = { createElement: () => createCanvas(1, 1) };
  s.window = { electronAPI: undefined };
  s.fetch = fetch; s.FormData = FormData; s.Blob = Blob; s.URL = URL; s.URLSearchParams = URLSearchParams;
  s.setTimeout = setTimeout; s.console = console;
  s.loadImage = (src) => napiLoadImage(typeof src === 'string' && src.startsWith('data:') ? Buffer.from(src.split(',')[1], 'base64') : src);
  s.blobToDataUrl = async (blob) => 'data:' + (blob.type || 'image/png') + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64');
  s.setSplitBusyDetail = () => {};
  s.detectComfyBaseUrl = async () => baseUrl;
  // The 2.1 constants live after the slice loadSpine captures; the 2.1 resolver needs them.
  vm.runInContext(`
    const QWEN21_UNETS = ['qwen-image-2.1-UC-Q8_0.gguf', 'qwen-image-2.1-UC-Q5_K_M.gguf', 'qwen-image-2.1-UC-Q4_K_M.gguf'];
    const QWEN21_CLIPS = ['qwen3vl_8b_w4a8_heretic.safetensors', 'qwen3vl_8b_int8_convrot.safetensors', 'qwen3vl_8b_bf16.safetensors'];
    const QWEN21_VAE = 'qwen_image_2.1_vae_bf16.safetensors';
  `, s);
  return s;
}

let runPrompt = null;

function setSeed(graph, seed) { for (const n of Object.values(graph)) if (n.class_type === 'KSampler') n.inputs.seed = seed; return graph; }

// Candidate 2.1 graph: the same two pictures (image_1 = the arranged plate, image_2 = the untouched
// scene) go to TextEncodeQwenImage21 at resolution 0, the sampler runs on the encoder's own latent
// (image_1's size), and the RGBA decode is split to RGB before saving.
function build21(s, info, rt, uploads, prefix, prompt, o) {
  const wf = {
    '1': { class_type: 'LoadImage', inputs: { image: uploads.placementName } },
    '2': { class_type: 'LoadImage', inputs: { image: uploads.referenceName } },
    '4': { class_type: 'UnetLoaderGGUF', inputs: s.buildComfyNodeInputs(info.UnetLoaderGGUF, { unet_name: rt.unetName }) },
    '5': { class_type: 'CLIPLoader', inputs: s.buildComfyNodeInputs(info.CLIPLoader, { clip_name: rt.clipName, type: 'qwen_image', device: 'default' }) },
    '6': { class_type: 'VAELoader', inputs: s.buildComfyNodeInputs(info.VAELoader, { vae_name: rt.vaeName }) }
  };
  let model = ['4', 0];
  if (info.QwenImage21Cache) { wf['7'] = { class_type: 'QwenImage21Cache', inputs: { model, device: 'auto', dtype: 'default' } }; model = ['7', 0]; }
  wf['8'] = { class_type: 'TextEncodeQwenImage21', inputs: s.buildComfyNodeInputs(info.TextEncodeQwenImage21, {
    clip: ['5', 0], vae: ['6', 0], prompt, negative_prompt: o.negative || '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['2', 0] }) };
  wf['9'] = { class_type: 'KSampler', inputs: s.buildComfyNodeInputs(info.KSampler, {
    seed: 0, steps: o.steps, cfg: o.cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
    model, positive: ['8', 0], negative: ['8', 1], latent_image: ['8', 2] }) };
  wf['10'] = { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['6', 0] } };
  wf['11'] = { class_type: 'SplitImageWithAlpha', inputs: { image: ['10', 0] } };
  wf['12'] = { class_type: 'SaveImage', inputs: { images: ['11', 0], filename_prefix: prefix } };
  return wf;
}

async function runGraph(s, graph, prefix, file, timeoutMs) {
  if (fs.existsSync(file) && fs.statSync(file).size > 100) { log('cached', path.basename(file)); return dataOf(file); }
  const q = await json('/queue'); if (q.queue_running.length || q.queue_pending.length) throw new Error('Runtime busy');
  fs.writeFileSync(file.replace(/\.png$/, '-workflow.json'), JSON.stringify(graph, null, 2));
  const t = Date.now();
  // The renderer's own submit+poll, captured before any stage override so this never recurses.
  const out = await runPrompt(baseUrl, graph, prefix, timeoutMs || 1800000);
  writeData(file, out);
  const seconds = Math.round((Date.now() - t) / 10) / 100;
  fs.writeFileSync(file.replace(/\.png$/, '-run.json'), JSON.stringify({ seconds, prefix }, null, 2));
  log('done', path.basename(file), seconds + 's');
  return out;
}

function stats(sceneCanvas, finalCanvas, bounds) {
  const w = sceneCanvas.width, h = sceneCanvas.height;
  const a = sceneCanvas.getContext('2d').getImageData(0, 0, w, h).data, b = finalCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  let outSum = 0, outN = 0, inSum = 0, inN = 0, rbA = 0, rbB = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    const inside = x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
    if (inside) { inSum += d; inN++; } else { outSum += d; outN++; }
    rbA += a[i] - a[i + 2]; rbB += b[i] - b[i + 2];
  }
  return { outsideMeanAbsDiff: +(outSum / outN).toFixed(2), insideMeanAbsDiff: +(inSum / inN).toFixed(2), rbOriginal: +(rbA / (w * h)).toFixed(2), rbResult: +(rbB / (w * h)).toFixed(2) };
}

async function main() {
  const s = sandbox();
  runPrompt = s.runPromptForFirstImage;
  const info = await json('/object_info');
  s.comfyAllObjectInfo = async () => info;
  s.comfyObjectInfo = async (b, type) => info[type];
  s.runRmbgCutout = async (dataUrl) => {
    const stamp = Date.now() + '_' + Math.random().toString(16).slice(2, 6);
    const name = await s.uploadDataUrl(baseUrl, `ot_cutout_${stamp}.png`, dataUrl);
    const prefix = `ot_cutout_${stamp}`;
    const nodes = await s.defaultRmbgNodes(baseUrl);
    const wf = await s.defaultRmbgWorkflow(baseUrl, name, prefix, nodes[0]);
    const out = await s.runPromptForFirstImage(baseUrl, wf, prefix, 300000);
    await s.assertModelAlphaDataUrl(out, 'RMBG');
    return out;
  };
  const origPlateSize = s.qwenEditPlateSize;
  const plate32 = (w, h) => { const p = origPlateSize(w, h); return { width: Math.ceil(p.width / 32) * 32, height: Math.ceil(p.height / 32) * 32, aspectError: p.aspectError }; };
  const origRestyle = s.buildObjectTransferRestyleWorkflow;

  const sceneImg = await s.loadImage(dataOf(sceneFile));
  const size = { width: sceneImg.width, height: sceneImg.height };
  const sceneCanvas = await s.canvasFromDataUrl(dataOf(sceneFile), size.width, size.height);
  s.sourceSize = async () => size;
  s.sourceFullCanvas = async () => sceneCanvas;

  // 1. RMBG cutout of the reference object (shared by every engine).
  const cutoutFile = path.join(cacheDir, 'cutout_' + path.basename(objectFile));
  let cutoutDataUrl;
  if (fs.existsSync(cutoutFile)) cutoutDataUrl = dataOf(cutoutFile);
  else { log('cutout', path.basename(objectFile)); cutoutDataUrl = await s.runRmbgCutout(dataOf(objectFile)); writeData(cutoutFile, cutoutDataUrl); }
  const refSize = await s.imageSizeFromDataUrl(cutoutDataUrl);
  const width = Math.round(size.width * place[2]);
  const bounds = { x: Math.round(size.width * place[0]), y: Math.round(size.height * place[1]), width, height: Math.round(width * refSize.height / refSize.width) };
  s.clampObjectTransferPlacement = () => bounds;
  s.state.objectTransfer = s.objectTransferDefaultState({ active: true, referenceCutoutDataUrl: cutoutDataUrl, referenceOriginalDataUrl: dataOf(objectFile), referenceWidth: refSize.width, referenceHeight: refSize.height, x: bounds.x, y: bounds.y, scale: width / refSize.width });
  log('case', caseName, 'scene', size, 'object', refSize, 'bounds', bounds);

  const results = [];
  for (const engineName of engineNames) {
    const engine = ENGINES[engineName]; if (!engine) throw new Error('unknown engine ' + engineName);
    for (const seed of seeds) {
      const tag = `${engineName}_s${seed}`;
      const runId = `NovaFlow_object_transfer_ot_${caseName.replace(/[^\w-]+/g, '_')}_${tag}`.slice(0, 120);
      let resolved, rt21;
      if (engine.kind === '2511') {
        resolved = s.resolveObjectTransferQwenRuntime(info);
        if (!s.comfyComboChoices(info.UNETLoader, 'unet_name').includes(engine.unet)) throw new Error('missing ' + engine.unet);
        resolved.unetName = engine.unet;
        s.qwenEditPlateSize = origPlateSize;
        s.buildObjectTransferRestyleWorkflow = (i, u, p, r, st) => { const g = origRestyle(i, u, p, r, st); if (engine.dtype) for (const n of Object.values(g)) if (n.class_type === 'UNETLoader') n.inputs.weight_dtype = engine.dtype; return setSeed(g, seed); };
      } else {
        rt21 = s.qwen21Runtime(info); if (!rt21) throw new Error('no 2.1 runtime');
        resolved = { unetName: rt21.unetName, clipName: rt21.clipName, vaeName: rt21.vaeName, loraName: '' };
        s.qwenEditPlateSize = plate32;
        s.buildObjectTransferRestyleWorkflow = (i, u, p, r, st) => setSeed(build21(s, i, rt21, u, p, s.objectTransferRestylePromptText(st), { steps: engine.steps, cfg: engine.restyleCfg, negative: '' }), seed);
      }
      // 2. 画风转换 (the real pass: grey plate, scene as image 2, RMBG afterwards), cached per engine+seed.
      const styledFile = path.join(outDir, `${tag}_styled-cutout.png`);
      let styledCutout;
      if (fs.existsSync(styledFile)) { styledCutout = dataOf(styledFile); log('cached', path.basename(styledFile)); }
      else {
        const origRun = s.runPromptForFirstImage;
        s.runPromptForFirstImage = async (b, graph, prefix, timeout) => {
          if (/_restyle$/.test(prefix)) return await runGraph(s, graph, prefix, path.join(outDir, `${tag}_restyle-plate.png`), timeout);
          return await origRun(b, graph, prefix, timeout);
        };
        try {
          const restyled = await s.objectTransferStyledCutoutDataUrl(baseUrl, info, resolved, cutoutDataUrl, sceneCanvas, runId, sceneArtStyle);
          styledCutout = restyled.styledCutout;
          writeData(styledFile, styledCutout);
        } finally { s.runPromptForFirstImage = origRun; }
      }
      // 3. Placement guide + aligned plate, exactly as the product builds them.
      const assets = await s.objectTransferBuildInputCanvases(styledCutout);
      writeData(path.join(outDir, `${tag}_placement-guide.png`), assets.placementGuideDataUrl);
      // 4. Integration pass.
      const finalFile = path.join(outDir, `${tag}_final.png`);
      let finalDataUrl;
      if (fs.existsSync(finalFile)) { finalDataUrl = dataOf(finalFile); log('cached', path.basename(finalFile)); }
      else {
        const placementName = await s.uploadDataUrl(baseUrl, runId + '_placement.png', assets.plateDataUrl);
        const referenceName = await s.uploadDataUrl(baseUrl, runId + '_scene.png', assets.sceneDataUrl);
        const graph = engine.kind === '2511'
          ? s.buildObjectTransferQwenWorkflow(info, { placementName, referenceName }, runId, resolved)
          : build21(s, info, rt21, { placementName, referenceName }, runId, s.objectTransferPromptText(), { steps: engine.steps, cfg: engine.cfg, negative: engine.negative });
        if (engine.dtype) for (const n of Object.values(graph)) if (n.class_type === 'UNETLoader') n.inputs.weight_dtype = engine.dtype;
        setSeed(graph, seed);
        const raw = await runGraph(s, graph, runId, path.join(outDir, `${tag}_raw.png`));
        finalDataUrl = await s.objectTransferDecodedResultDataUrl(raw, assets);
        writeData(finalFile, finalDataUrl);
      }
      const finalCanvas = await s.canvasFromDataUrl(finalDataUrl, size.width, size.height);
      const m = stats(sceneCanvas, finalCanvas, bounds);
      const runInfo = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).seconds : null;
      const row = { engine: engineName, seed, plate: assets.plateSize, restyleSeconds: runInfo(path.join(outDir, `${tag}_restyle-plate-run.json`)), finalSeconds: runInfo(path.join(outDir, `${tag}_raw-run.json`)), ...m };
      results.push(row); log(JSON.stringify(row));
    }
  }
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify({ case: caseName, scene: sceneFile, object: objectFile, bounds, results }, null, 2));
  // Contact sheet: scene | guide | one column per run.
  const tiles = [{ label: 'scene', file: sceneFile }, { label: 'guide', file: path.join(outDir, `${engineNames[0]}_s${seeds[0]}_placement-guide.png`) }];
  for (const r of results) tiles.push({ label: `${r.engine} s${r.seed}`, file: path.join(outDir, `${r.engine}_s${r.seed}_final.png`) });
  const tileH = 720, tileW = Math.round(tileH * size.width / size.height), pad = 8;
  const sheet = createCanvas(tiles.length * (tileW + pad) + pad, tileH + 40);
  const ctx = sheet.getContext('2d'); ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
  for (let i = 0; i < tiles.length; i++) {
    const img = await napiLoadImage(tiles[i].file);
    ctx.drawImage(img, pad + i * (tileW + pad), 34, tileW, tileH);
    ctx.fillText(tiles[i].label, pad + i * (tileW + pad) + 4, 24);
  }
  fs.writeFileSync(path.join(outDir, 'sheet.png'), sheet.toBuffer('image/png'));
  log('sheet', path.join(outDir, 'sheet.png'));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

// Chromium Canvas + the real editor coordinator. Only Comfy/network and cache
// are replaced; image composition, layer records, selection and history are real.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = process.env.NF_SPLIT_TEST_OUTPUT || path.join(root, '../.artifacts/generative-split');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  win.webContents.on('console-message', (_e, _level, message) => { if (/Error|FAIL/.test(message)) console.log(message); });
  try {
    await win.loadURL('data:text/html;charset=utf-8,<body><div id="fixture"></div>');
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    await evaluate(fs.readFileSync(path.join(root, 'renderer/generative-split.workflow.js'), 'utf8'));
    const seam = `window.splitTest = { state, executeGenerativeSplitTool, addGenerativeSplitTarget, ensureSelectionToolSession,
      generativeSplitToolbarNodes, stopSplitRun, undoSplitLayerEdit, redoSplitLayerEdit,
      install(info) {
        // No application workspace is mounted in this Canvas fixture. Keep its
        // visibility synchronizers from closing the otherwise real selection.
        render = () => {}; syncSplitWorkspace = () => {}; syncSplitEditToolWorkspace = () => {};
        detectComfyBaseUrl = async () => 'http://fixture'; comfyAllObjectInfo = async () => info;
        uploadDataUrl = async (_url, name, dataUrl) => { window.splitUploads[name] = dataUrl; return name; };
        requestJsonDirect = async () => ({ ok: true });
        runPromptForFirstImage = async (_url, graph) => window.splitGenerate(graph);
        cacheTempSplitPackage = async () => { if (window.splitCacheFail) throw Error('cache fixture'); };
      }, history() { return { undo: splitLayerUndoStack.length, redo: splitLayerRedoStack.length }; }
    };
    `;
    const spine = fs.readFileSync(path.join(root, 'renderer/spine-split-runtime.js'), 'utf8');
    assert(spine.includes('  window.NovaFlowSpineSplitBridge = {'));
    await evaluate(spine.replace('  window.NovaFlowSpineSplitBridge = {', seam + '  window.NovaFlowSpineSplitBridge = {'));
    const report = await evaluate(`(async () => {
      const checks = [], ok = (condition, label) => { if (!condition) throw Error('FAIL: ' + label); checks.push(label); };
      const api = NovaFlowGenerativeSplitWorkflow, t = splitTest, s = t.state;
      const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
      const image = data => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = data; });
      const source = canvas(256, 256), ctx = source.getContext('2d');
      ctx.fillStyle = '#a09080'; ctx.fillRect(0, 0, 256, 256); ctx.fillStyle = '#fa3040'; ctx.fillRect(100, 80, 40, 40);
      const mask = canvas(256, 256), m = mask.getContext('2d'); m.fillStyle = '#000'; m.fillRect(0, 0, 256, 256); m.fillStyle = '#fff'; m.fillRect(100, 80, 40, 40);
      const gate = api.backgroundMask(mask, 6, 0), gp = gate.getContext('2d').getImageData(0, 0, 256, 256).data;
      ok(gp[(80 * 256 + 100) * 4] === 255 && gp[(80 * 256 + 95) * 4] === 255, 'opaque mask dilation preserves centre and expands edges');
      ok(gp[(80 * 256 + 90) * 4] === 0, 'dilation has a bounded edit region');
      const softGate = api.backgroundMask(mask).getContext('2d').getImageData(0, 0, 256, 256).data;
      ok(softGate[(80 * 256 + 100) * 4] === 255, 'feather never blends the old object back into the selected core');
      const frame = api.planFrame(256, 256, { minX: 100, minY: 80, width: 40, height: 40, count: 1600 });
      const prepared = api.prepareFrame(source, mask, frame), candidate = canvas(frame.workingWidth, frame.workingHeight);
      candidate.getContext('2d').fillStyle = '#2050a0'; candidate.getContext('2d').fillRect(0, 0, candidate.width, candidate.height);
      const merged = api.composeBackground(source, candidate, frame, api.backgroundMask(mask));
      const original = ctx.getImageData(0, 0, 256, 256).data, result = merged.getContext('2d').getImageData(0, 0, 256, 256).data;
      const feather = api.backgroundMask(mask).getContext('2d').getImageData(0, 0, 256, 256).data;
      let outside = 0, inside = 0;
      for (let i = 0; i < original.length; i += 4) {
        const different = original.slice(i, i + 4).some((v, c) => v !== result[i + c]);
        if (!feather[i] && different) outside++; if (feather[i] && different) inside++;
      }
      ok(outside === 0 && inside > 0, 'background keeps every RGBA byte outside feathered selection');
      let mismatch = false; try { api.restoreFrame(canvas(32, 32), frame); } catch { mismatch = true; }
      ok(mismatch, 'wrong output dimensions rejected before placement');
      const info = Object.fromEntries(['LoadImage','NovaFlowGGUFBF16Loader','CLIPLoader','VAELoader','TextEncodeQwenImage21','QwenImage21Cache','BasicGuider','RandomNoise','KSamplerSelect','SamplerCustomAdvanced','VAEDecode','SaveImage','ManualSigmas','BasicScheduler'].map(k => [k, {}]));
      info.NovaFlowGGUFBF16Loader.input = { required: { unet_name: [['Qwen-Image-2.1-Turbo-BF16.gguf','qwen-image-2.1-UC-BF16.gguf']] } };
      info.CLIPLoader.input = { required: { clip_name: [['qwen3vl_8b_bf16_heretic.safetensors']] } };
      info.VAELoader.input = { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } };
      window.splitUploads = {}; window.splitCalls = []; window.splitPrompts = []; t.install(info);
      let failure = '', call = 0;
      window.splitGenerate = async graph => {
        const stage = graph[6].inputs.prompt.includes('Extract ONLY') ? 'object' : 'background'; splitCalls.push(stage); call++;
        splitPrompts.push(graph[6].inputs.prompt);
        const locator = await image(splitUploads[graph[2].inputs.image]), c = canvas(locator.width, locator.height), g = c.getContext('2d');
        if (stage === 'background' || failure === 'opaque') { g.fillStyle = '#206030'; g.fillRect(0, 0, c.width, c.height); }
        else {
          g.drawImage(locator, 0, 0); const p = g.getImageData(0, 0, c.width, c.height).data; let x = c.width, y = c.height, r = 0, b = 0;
          for (let i = 0; i < p.length; i += 4) if (p[i] < 20 && p[i + 1] > 240 && p[i + 2] < 20) { const px = i / 4 % c.width, py = Math.floor(i / 4 / c.width); x = Math.min(x, px); y = Math.min(y, py); r = Math.max(r, px); b = Math.max(b, py); }
          g.clearRect(0, 0, c.width, c.height); g.fillStyle = '#2040f0'; g.fillRect(x - 12, y - 12, r - x + 25, b - y + 25);
        }
        if (failure === 'second-object' && call === 3) throw Error('second object failed');
        if (failure === 'stale' && call === 2) s.source = { ...s.source, dataUrl: source.toDataURL() + '#changed' };
        if (failure === 'stop' && call === 2) t.stopSplitRun();
        return c.toDataURL();
      };
      const select = async (x = 100, y = 80) => { const session = await t.ensureSelectionToolSession(); if (!session) throw Error('No selection session: ' + JSON.stringify({ message: s.message, busy: s.busy, selection: s.selectionTool })); const g = session.maskCanvas.getContext('2d'); g.clearRect(0, 0, 256, 256); g.fillStyle = '#fff'; g.fillRect(x, y, 40, 40); };
      const begin = async () => { NovaFlowSpineSplitDebug.setSource('fixture.png', source.toDataURL()); await image(source.toDataURL()); await t.executeGenerativeSplitTool(); await select(); call = 0; splitCalls.length = 0; };
      await begin();
      const toolbar = document.querySelector('#fixture'); toolbar.replaceChildren(...t.generativeSplitToolbarNodes());
      const profile = toolbar.querySelector('select'); profile.value = 'standard'; profile.dispatchEvent(new Event('change', { bubbles: true }));
      ok(s.generativeSplit.profile === 'standard', 'profile select updates editor state'); s.generativeSplit.profile = 'turbo';
      s.generativeSplit.advancedPrompts = true; s.generativeSplit.objectName = '对象甲'; s.generativeSplit.objectPrompt = '去掉蓝色遮挡板'; s.generativeSplit.backgroundPrompt = '保持米色平涂底色'; toolbar.querySelector('[data-novaflow-generative-split-add]').click();
      for (let i = 0; i < 20 && s.generativeSplit.objectName; i++) await new Promise(r => setTimeout(r, 10));
      ok(!s.generativeSplit.objectName, 'native toolbar click queues object and clears current selection');
      await select(170, 150); s.generativeSplit.objectName = '对象乙'; s.generativeSplit.objectPrompt = '补全帽沿'; failure = 'second-object';
      const before = JSON.stringify(s.parts); await t.executeGenerativeSplitTool();
      ok(JSON.stringify(s.parts) === before && /second object failed/.test(s.message), 'second-object failure leaves all original layers untouched');
      const customPrompts = splitPrompts.slice(-3);
      ok(customPrompts[0].includes('保持米色平涂底色') && !customPrompts[0].includes('去掉蓝色遮挡板') && !customPrompts[0].includes('补全帽沿'), 'background receives only its own instructions');
      ok(customPrompts[1].includes('去掉蓝色遮挡板') && !customPrompts[1].includes('补全帽沿') && customPrompts[2].includes('补全帽沿') && !customPrompts[2].includes('去掉蓝色遮挡板'), 'each queued object keeps its own explicit instructions');
      s.generativeSplit.advancedPrompts = false;
      failure = ''; call = 0; splitCalls.length = 0; await t.executeGenerativeSplitTool();
      ok(s.parts.length === 3 && !s.busy, 'retry commits clean base and two objects together');
      ok(splitCalls.join(',') === 'background,object,object', 'multiple objects use separate sequential model runs');
      const prompts = splitPrompts.slice(-3);
      ok(prompts.every(prompt => !prompt.includes('Additional instructions')), 'closing advanced requirements disables stored background and queued-object overrides');
      ok(prompts[1].includes('reconstruct the missing target parts') && prompts[1].includes('colors, texture, material, illumination'), 'automatic mode completes occlusion and preserves appearance without manual instructions');
      const object = s.parts.find(p => (p.name || '').includes('对象甲'));
      const full = canvas(256, 256), f = full.getContext('2d'), oi = await image(object.dataUrl); f.drawImage(oi, object.x, object.y);
      ok(f.getImageData(100, 125, 1, 1).data[3] > 0, 'completed object pixels outside painted mask survive layer crop and placement');
      ok(t.undoSplitLayerEdit(), 'split supports undo');
      await new Promise(r => setTimeout(r, 80)); ok(s.parts.length === 0, 'undo removes the whole generated layer group');
      ok(t.redoSplitLayerEdit(), 'split supports redo');
      await new Promise(r => setTimeout(r, 80)); ok(s.parts.length === 3, 'redo restores the whole generated layer group');
      for (const reason of ['opaque', 'stale', 'stop']) {
        await begin(); failure = reason; const before = JSON.stringify(s.parts); await t.executeGenerativeSplitTool();
        ok(JSON.stringify(s.parts) === before && s.messageError, reason + ' output cannot commit partial or late results');
      }
      failure = ''; window.splitCacheFail = true; await begin(); await t.executeGenerativeSplitTool();
      ok(s.parts.length === 2 && /手动保存/.test(s.message), 'cache failure retains completed layers and gives recoverable notice');
      window.splitCacheFail = false;
      const sourceId = s.parts[0].id, unrelatedId = s.parts[1].id, unrelatedImage = s.parts[1].dataUrl;
      s.activePartId = sourceId; s.selectedPartIds = [sourceId]; s.viewMode = 'parts';
      await t.executeGenerativeSplitTool(); await select(); call = 0; await t.executeGenerativeSplitTool();
      ok(s.parts.length === 4 && s.parts.find(p => p.id === sourceId).visible === false, 'layer input retains its original as a hidden layer');
      ok(s.parts.find(p => p.id === unrelatedId).dataUrl === unrelatedImage, 'layer input leaves unrelated layer images unchanged');
      t.undoSplitLayerEdit(); await new Promise(r => setTimeout(r, 80));
      ok(s.parts.length === 2 && s.parts.find(p => p.id === sourceId).visible !== false, 'layer-input undo restores the original layer and visibility');
      return { checks, pixels: { outsideChanged: outside, insideChanged: inside }, prepared, source: source.toDataURL(), mask: mask.toDataURL() };
    })()`);
    for (const key of ['source', 'mask']) fs.writeFileSync(path.join(output, key + '.png'), Buffer.from(report[key].split(',')[1], 'base64'));
    for (const [key, value] of Object.entries(report.prepared)) fs.writeFileSync(path.join(output, key + '.png'), Buffer.from(value.split(',')[1], 'base64'));
    delete report.source; delete report.mask; delete report.prepared;
    fs.writeFileSync(path.join(output, 'canvas-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    app.exit(0);
  } catch (error) { console.error(error.stack || error); app.exit(1); }
});

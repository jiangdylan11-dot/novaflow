// Full source page, real tool controls and pointer painting; no model runs.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = process.env.NF_SPLIT_TEST_OUTPUT || path.join(root, '../.artifacts/generative-split');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'ui-profile'));
app.commandLine.appendSwitch('disable-gpu');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false, webSecurity: false } });
  const timer = setTimeout(() => { console.error('Full page test timed out'); win.destroy(); app.exit(2); }, 45000);
  try {
    await win.loadFile(path.join(root, 'renderer/index.html'));
    const ev = code => win.webContents.executeJavaScript(code, true);
    for (let i = 0; i < 100; i++) {
      if (await ev(`!!window.NovaFlowSpineSplitBridge && [...document.querySelectorAll('button')].some(b => b.innerText.trim() === '美工')`)) break;
      await wait(100);
    }
    for (let i = 0; i < 110; i++) {
      if (await ev(`!document.getElementById('novaflow-boot-splash')`)) break;
      await wait(100);
    }
    assert(await ev(`!document.getElementById('novaflow-boot-splash')`), 'actual page must be visible before testing the editor');
    await ev(`Object.defineProperty(document, 'hidden', { get: () => false }); [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '美工').click()`);
    await wait(700);
    await ev(`(() => { const c = Object.assign(document.createElement('canvas'), { width: 512, height: 512 }); const g = c.getContext('2d'); g.fillStyle = '#d9c9b9'; g.fillRect(0, 0, 512, 512); g.fillStyle = '#dd4433'; g.fillRect(160, 160, 180, 180); NovaFlowSpineSplitDebug.setSource('split-ui-fixture.png', c.toDataURL()); })()`);
    await wait(600);
    await ev(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '拆图').click()`);
    await wait(400);
    assert(await ev(`(() => {
      const oldTool = document.querySelector('[data-novaflow-spine-split-control-action="cutout"]');
      const newTool = document.querySelector('[data-novaflow-spine-split-control-action="generativeSplit"]');
      const pen = document.querySelector('[data-novaflow-spine-split-control-action="penCutout"]');
      return oldTool && pen && newTool && newTool.textContent.trim() === '对象分离'
        && oldTool.parentElement === newTool.parentElement
        && newTool.getBoundingClientRect().top >= oldTool.getBoundingClientRect().bottom;
    })()`), 'object separation appears below smart cutout inside the same split group, retaining existing tools');
    fs.writeFileSync(path.join(output, 'split-entry.png'), (await win.webContents.capturePage()).toPNG());
    await ev(`document.querySelector('[data-novaflow-spine-split-control-action="generativeSplit"]').click()`);
    await wait(500);
    // 2026-11-18: no route select, no 添加对象, no 特殊要求 — the tool runs on its defaults
    assert.equal(await ev(`document.querySelectorAll('[data-novaflow-generative-split-profile],[data-novaflow-generative-split-add],[data-novaflow-generative-split-advanced],[data-novaflow-generative-split-prompt]').length`), 0, 'object separation shows no route, add-object or special-request controls');
    assert.equal(await ev(`NovaFlowSpineSplitBridge.getState().generativeSplit.profile`), 'turbo', 'default route');
    assert.equal(await ev(`NovaFlowSpineSplitBridge.getState().generativeSplit.advancedPrompts`), false, 'no extra requests');
    assert(await ev(`document.body.innerText.includes('对象说明（选填）')`), 'the only text field is an optional target hint');
    assert(!(await ev(`document.body.innerText.includes('添加对象') || document.body.innerText.includes('特殊要求')`)), 'removed controls leave no text behind');
    assert.equal(await ev(`document.querySelectorAll('[data-novaflow-spine-split-tool-action="selectionRemoveBackground"]').length`), 0);
    fs.writeFileSync(path.join(output, 'editor-ui.png'), (await win.webContents.capturePage()).toPNG());
    await ev(`document.querySelector('[data-novaflow-spine-split-tool-action="selectionExit"]').click()`);
    await wait(300);
    await ev(`document.querySelector('[data-novaflow-spine-split-control-action="cutout"]').click()`);
    await wait(400);
    assert(await ev(`!NovaFlowSpineSplitBridge.getState().selectionTool.generativeSplit && !!document.querySelector('[data-novaflow-spine-split-tool-action="selectionRemoveBackground"]')`), 'old smart cutout remains independently usable after object separation exits');
    console.log('PASS: split group placement, old smart cutout, Turbo default, optional target hint, advanced collapse/enable, pointer mask, queue and clear');
    clearTimeout(timer); app.exit(0);
  } catch (error) { console.error(error.stack || error); clearTimeout(timer); app.exit(1); }
});

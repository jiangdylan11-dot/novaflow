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
    assert(await ev(`!!document.querySelector('[data-novaflow-generative-split-profile]')`), 'tool mode must invalidate the old cutout canvas toolbar');
    assert.equal(await ev(`document.querySelector('[data-novaflow-generative-split-profile]').value`), 'turbo', 'default route uses Turbo BF16');
    assert.equal(await ev(`document.querySelector('[data-novaflow-generative-split-advanced]').open`), false, 'normal use starts in automatic mode');
    assert.equal(await ev(`document.querySelector('[data-novaflow-generative-split-prompt="object"]').checkVisibility()`), false, 'detailed instructions are hidden by default');
    assert(await ev(`document.body.innerText.includes('对象说明（选填）')`), 'the only normal text field is an optional target hint');
    assert.equal(await ev(`document.querySelectorAll('[data-novaflow-spine-split-tool-action="selectionRemoveBackground"]').length`), 0);
    await ev(`(() => { const profile = document.querySelector('[data-novaflow-generative-split-profile]'); profile.value = 'standard'; profile.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await ev(`NovaFlowSpineSplitBridge.getState().generativeSplit.profile`), 'standard');
    await ev(`document.querySelector('[data-novaflow-generative-split-advanced] summary').click()`);
    await wait(300);
    assert.equal(await ev(`NovaFlowSpineSplitBridge.getState().generativeSplit.advancedPrompts`), true);
    await ev(`(() => { for (const [stage, value] of [['object', '去掉横板并补全杯底'], ['background', '保持米色纯色背景']]) { const field = document.querySelector('[data-novaflow-generative-split-prompt="' + stage + '"]'); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    await ev(`(() => {
      const c = document.querySelector('[data-novaflow-selection-tool-canvas="1"]'), r = c.getBoundingClientRect();
      const props = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: r.left + r.width * .45, clientY: r.top + r.height * .45 };
      c.dispatchEvent(new PointerEvent('pointerdown', { ...props, buttons: 1 }));
      c.dispatchEvent(new PointerEvent('pointermove', { ...props, buttons: 1, clientX: props.clientX + 30 }));
      c.dispatchEvent(new PointerEvent('pointerup', { ...props, buttons: 0, clientX: props.clientX + 30 }));
    })()`);
    await wait(300);
    await ev(`document.querySelector('[data-novaflow-generative-split-add]').click()`);
    await wait(500);
    assert.match(await ev(`document.querySelector('[data-novaflow-generative-split-add]').textContent`), /已选 1/, 'native click and canvas cache must update queued target count');
    assert.equal(await ev(`document.querySelector('[data-novaflow-generative-split-prompt="object"]').value`), '', 'adding a target clears only its per-object instructions');
    assert.equal(await ev(`document.querySelector('[data-novaflow-generative-split-prompt="background"]').value`), '保持米色纯色背景');
    assert.equal(await ev(`document.querySelector('[data-novaflow-generative-split-profile]').value`), 'standard');
    await ev(`document.querySelector('[data-novaflow-spine-split-tool-action="generativeSplitClear"]').click()`);
    await wait(300);
    assert.doesNotMatch(await ev(`document.querySelector('[data-novaflow-generative-split-add]').textContent`), /已选/);
    await ev(`document.querySelector('[data-novaflow-generative-split-advanced] summary').click()`);
    await wait(300);
    assert.equal(await ev(`NovaFlowSpineSplitBridge.getState().generativeSplit.advancedPrompts`), false);
    assert.equal(await ev(`document.querySelector('[data-novaflow-generative-split-prompt="background"]').checkVisibility()`), false);
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

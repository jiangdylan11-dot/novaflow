// Run after sync:runtime with Playwright resolvable via NODE_PATH.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const output = path.resolve(__dirname, '../../../work/spine-viewer');

(async () => {
  const root = path.resolve(__dirname, '../../web-dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const url = process.env.NF_VIEWER_URL || `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Authentication is exercised by the entry checks; this test covers the local tool UI.
    await page.route('**/novaflow-web-account.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '特效', exact: true }).click();
    await fs.mkdir(output, { recursive: true });
    const effectDock = page.locator('[data-novaflow-bottom-controls="1"]');
    await effectDock.screenshot({ path: path.join(output, 'effect-timeline-reference.png') });
    await page.getByRole('button', { name: '工具', exact: true }).click();
    const entry = page.locator('[data-novaflow-spine-viewer-entry="1"]');
    await entry.waitFor();
    await entry.click();
    const frame = await page.locator('#novaflow-spine-viewer-root iframe').elementHandle().then((element) => element.contentFrame());
    await frame.waitForFunction(() => Boolean(window.NovaFlowSpineViewer));
    assert.equal(await frame.locator('#blendModeSelect').count(), 0);
    assert.equal(await frame.locator('#removeAnimationButton').count(), 0);
    assert.deepEqual(await frame.locator('.canvas-toolbar button').evaluateAll((buttons) => buttons.map((button) => button.id)), ['actualSizeButton', 'autoFitButton']);
    assert.deepEqual(await frame.locator('.canvas-actions button').evaluateAll((buttons) => buttons.map((button) => button.id)), ['resetTransformButton', 'pickBackgroundButton', 'clearBackgroundButton', 'premultiplyToggle']);
    const fixtureFiles = await frame.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d'); context.fillStyle = '#ff8040'; context.fillRect(0, 0, 32, 32);
      const image = await new Promise((resolve) => canvas.toBlob(resolve));
      const files = [];
      for (const version of ['3.7', '3.8', '4.0', '4.1', '4.2']) {
        const name = `fixture-${version}`;
        const attachments = { picture: { picture: { width: 32, height: 32 } } };
        const skeleton = {
          skeleton: { spine: `${version}.00`, width: 32, height: 32 },
          bones: [{ name: 'root' }], slots: [{ name: 'picture', bone: 'root', attachment: 'picture' }],
          skins: version === '3.7' ? { default: attachments } : [{ name: 'default', attachments }],
          animations: { idle: { bones: { root: { rotate: [{ angle: 0 }, { time: 1, angle: 30 }] } } } },
        };
        const atlas = `${name}.png\nsize: 32,32\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\npicture\n  rotate: false\n  xy: 0, 0\n  size: 32, 32\n  orig: 32, 32\n  offset: 0, 0\n  index: -1\n`;
        files.push(new File([JSON.stringify(skeleton)], `${name}.json`), new File([atlas], `${name}.atlas`), new File([image], `${name}.png`, { type: 'image/png' }));
      }
      window.viewerTestFiles = files;
      return Promise.all(files.map(async (file) => ({ name: file.name, mimeType: file.type || 'application/octet-stream', bytes: [...new Uint8Array(await file.arrayBuffer())] })));
    });
    const chooserEvent = page.waitForEvent('filechooser');
    await frame.locator('#dropZone').click();
    const chooser = await chooserEvent;
    assert(chooser.isMultiple());
    await chooser.setFiles(fixtureFiles.map(({ name, mimeType, bytes }) => ({ name, mimeType, buffer: Buffer.from(bytes) })));
    await frame.waitForFunction(() => state.sceneItems.length === 5);
    const imported = await frame.evaluate(() => ({ count: state.sceneItems.length, versions: state.sceneItems.map((item) => item.runtimeVersion), status: elements.statusText.textContent }));
    assert.equal(imported.count, 5, JSON.stringify(imported));
    assert.deepEqual(imported.versions, ['3.7', '3.8', '4.0', '4.1', '4.2']);
    assert.equal(await frame.locator('#pickFilesButton,#pickFolderButton,#folderPicker,#loopToggle,input[type=checkbox]').count(), 0);
    assert(await frame.evaluate(() => state.sceneItems.every((item) => item.loop && item.player.animationState.getCurrent(0).loop)));
    const layerOrder = () => frame.evaluate(() => getLayerItemsTopFirst().map((item) => item.id));
    const originalOrder = await layerOrder();
    const activeId = originalOrder.at(-1);
    const activeRow = () => frame.locator(`.layer-item[data-scene-id="${activeId}"]`);
    await activeRow().locator('.layer-name').click();
    await page.keyboard.press('+');
    assert.equal((await layerOrder()).indexOf(activeId), 3);
    await page.keyboard.press('-');
    assert.deepEqual(await layerOrder(), originalOrder);
    await page.keyboard.press('NumpadAdd');
    assert.equal((await layerOrder()).indexOf(activeId), 3);
    await activeRow().getByRole('button', { name: '下移', exact: true }).click();
    assert.deepEqual(await layerOrder(), originalOrder);
    await activeRow().locator('.layer-name').dragTo(frame.locator('.layer-item').first(), { targetPosition: { x: 30, y: 2 } });
    assert.equal((await layerOrder())[0], activeId);
    await activeRow().locator('.layer-name').dragTo(frame.locator('.layer-item').last(), { targetPosition: { x: 30, y: 26 } });
    assert.deepEqual(await layerOrder(), originalOrder);
    assert.equal(await frame.locator('#premultiplyToggle').getAttribute('aria-pressed'), 'true');
    assert(await frame.evaluate(() => state.sceneItems.every((item) => item.premultipliedAlpha && item.player.config.premultipliedAlpha)));
    await frame.locator('#premultiplyToggle').click();
    assert.equal(await frame.locator('#premultiplyToggle').getAttribute('aria-pressed'), 'false');
    assert(await frame.evaluate(() => !getActiveSceneItem().player.config.premultipliedAlpha));
    await frame.locator('#projectSelect').selectOption(originalOrder[0]);
    assert.equal(await frame.locator('#premultiplyToggle').getAttribute('aria-pressed'), 'true');
    await frame.locator('#projectSelect').selectOption(activeId);
    assert.equal(await frame.locator('#premultiplyToggle').getAttribute('aria-pressed'), 'false');
    await frame.locator('#premultiplyToggle').click();
    await frame.evaluate(() => setPreviewZoom(.25));
    assert.equal(await frame.locator('#actualSizeButton').textContent(), '25%');
    await frame.locator('#actualSizeButton').click();
    assert.equal(await frame.evaluate(() => state.previewZoom), 1);
    await frame.evaluate(() => { for (const item of state.sceneItems) { item.x = 120; item.y = 60; item.positionTouched = true; applySceneItemTransform(item); } });
    await frame.getByRole('button', { name: '重置位置', exact: true }).click();
    assert(await frame.evaluate(() => {
      const mount = elements.playerMount.getBoundingClientRect();
      const rects = state.sceneItems.map((item) => item.element.getBoundingClientRect());
      return rects.every((r, i) => r.left >= mount.left && r.right <= mount.right && r.top >= mount.top && r.bottom <= mount.bottom && rects.every((other, j) => i === j || r.right <= other.left || r.left >= other.right || r.bottom <= other.top || r.top >= other.bottom));
    }), 'reset must arrange previously moved, overlapping projects inside the canvas');
    assert.deepEqual(await layerOrder(), originalOrder);
    const backgroundChooserEvent = page.waitForEvent('filechooser');
    await frame.getByRole('button', { name: '上传背景', exact: true }).click();
    const backgroundChooser = await backgroundChooserEvent;
    const background = fixtureFiles.find((file) => file.name.endsWith('.png'));
    await backgroundChooser.setFiles({ name: background.name, mimeType: 'image/png', buffer: Buffer.from(background.bytes) });
    await frame.waitForFunction(() => !elements.backgroundImage.hidden && !elements.clearBackgroundButton.disabled);
    await frame.getByRole('button', { name: '清除背景', exact: true }).click();
    assert(await frame.evaluate(() => elements.backgroundImage.hidden && elements.clearBackgroundButton.disabled));
    const actionsPosition = await frame.evaluate(() => {
      const actions = document.querySelector('.canvas-actions').getBoundingClientRect();
      const canvas = elements.playerMount.getBoundingClientRect();
      const timeline = document.querySelector('.stage-controls').getBoundingClientRect();
      return { centered: Math.abs(actions.x + actions.width / 2 - canvas.x - canvas.width / 2) < 1, aboveTimeline: actions.bottom < timeline.top };
    });
    assert.deepEqual(actionsPosition, { centered: true, aboveTimeline: true });
    assert.equal(await frame.locator('.sidebar #resetTransformButton,.sidebar #pickBackgroundButton,.sidebar #clearBackgroundButton').count(), 0);
    await frame.locator('#autoFitButton').click();
    assert(await frame.evaluate(() => {
      const mount = elements.playerMount.getBoundingClientRect();
      return state.sceneItems.every((item) => { const r = item.element.getBoundingClientRect(); return r.left >= mount.left && r.right <= mount.right && r.top >= mount.top && r.bottom <= mount.bottom; });
    }));
    await frame.locator('#actualSizeButton').click();
    // An external file drop reaches the canvas importer without changing existing layers.
    await frame.evaluate(async () => {
      const name = 'canvas-drop';
      const transfer = new DataTransfer();
      const source = viewerTestFiles.filter((file) => file.name.startsWith('fixture-4.2'));
      for (const file of source) {
        const text = /\.(json|atlas)$/.test(file.name) ? (await file.text()).replaceAll('fixture-4.2', name) : file;
        transfer.items.add(new File([text], file.name.replace('fixture-4.2', name), { type: file.type }));
      }
      elements.playerMount.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    await frame.waitForFunction(() => state.sceneItems.length === 6);
    await frame.locator('.layer-item').filter({ hasText: 'canvas-drop.json' }).locator('[data-action="remove"]').click();
    assert.deepEqual(await layerOrder(), originalOrder);
    await frame.locator('#projectSelect').selectOption(activeId);
    await frame.locator('#speedRange').fill('1.5');
    assert.equal(await frame.evaluate(() => getActiveSceneItem().speed), 1.5);
    const timeline = await frame.locator('#progressRange').boundingBox();
    await page.mouse.move(timeline.x + timeline.width * .25, timeline.y + timeline.height / 2);
    await page.mouse.down();
    assert(await frame.evaluate(() => getActiveSceneItem().player.paused));
    await page.mouse.move(timeline.x + timeline.width * .75, timeline.y + timeline.height / 2);
    assert(await frame.evaluate(() => Math.abs(getTrackTiming(getCurrentTrackEntry()).elapsed - .75) < .1));
    await page.mouse.up();
    assert(await frame.evaluate(() => !getActiveSceneItem().player.paused));
    await frame.locator('#playPauseButton').click();
    await frame.locator('#progressRange').click({ position: { x: timeline.width * .5, y: 7 } });
    assert(await frame.evaluate(() => getActiveSceneItem().player.paused));
    await frame.locator('#timeInput').fill('0.25');
    assert.equal(await frame.evaluate(() => getCurrentTrackEntry().trackTime), .25);
    const orderBeforeTyping = await layerOrder();
    await frame.locator('#timeInput').press('-');
    assert.deepEqual(await layerOrder(), orderBeforeTyping);
    await frame.locator('#timeInput').fill('0.25');
    await frame.locator('#timeInput').press('Enter');
    const selected = await frame.evaluate(() => state.activeSceneId);
    await page.getByRole('button', { name: 'SPINE 图集转换', exact: true }).click();
    assert(await page.locator('#novaflow-spine-viewer-root').isHidden());
    assert(await frame.evaluate(() => state.sceneItems.every((item) => item.player.paused)));
    await entry.click();
    assert.equal(await frame.evaluate(() => state.sceneItems.length), 5);
    assert.equal(await frame.evaluate(() => getActiveSceneItem().speed), 1.5);
    assert.equal(await frame.evaluate(() => state.activeSceneId), selected);
    assert(await frame.evaluate(() => getActiveSceneItem().player.paused));
    assert(await frame.evaluate(() => state.sceneItems.some((item) => !item.player.paused)));
    await page.getByRole('button', { name: 'PNG 压缩', exact: true }).click();
    assert(await page.locator('#novaflow-spine-viewer-root').isHidden());
    await entry.click();
    await page.getByRole('button', { name: '美工', exact: true }).click();
    await entry.waitFor({ state: 'detached' });
    assert(await page.locator('#novaflow-spine-viewer-root').isHidden());
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await entry.click();
    assert.equal(await page.locator('[data-novaflow-spine-viewer-entry="1"]').count(), 1);
    assert.equal(await frame.evaluate(() => state.sceneItems.length), 5);
    const rects = await page.evaluate(() => ({
      viewer: document.querySelector('#novaflow-spine-viewer-root').getBoundingClientRect().toJSON(),
      workspace: document.querySelector('[data-novaflow-tools-workspace]').getBoundingClientRect().toJSON(),
    }));
    assert(Math.abs(rects.viewer.x - rects.workspace.x) < 1);
    assert(rects.viewer.width > 500 && rects.viewer.height > 300);
    const painted = await frame.evaluate(() => state.sceneItems.map((item) => {
      const player = item.player, gl = player.context.gl;
      player.drawFrame(false);
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    }));
    assert(painted.every(Boolean), 'every runtime must draw visible pixels');
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'integrated.png') });
    await frame.locator('.sidebar').screenshot({ path: path.join(output, 'tools-panel.png') });
    if (process.env.NF_VIEWER_FIXTURES) {
      const fixtureDir = path.resolve(process.env.NF_VIEWER_FIXTURES);
      const files = (await fs.readdir(fixtureDir)).filter((name) => /\.(json|skel|atlas|png)$/i.test(name)).map((name) => path.join(fixtureDir, name));
      await frame.locator('#filePicker').setInputFiles(files);
      await frame.waitForFunction(() => !elements.statusText.classList.contains('error') && /^已新增/.test(elements.statusText.textContent) && state.sceneItems.length > 5);
      await page.screenshot({ path: path.join(output, 'real-projects.png') });
      console.log(await frame.locator('#statusText').textContent());
    }
    const remainingIds = await frame.evaluate(() => state.sceneItems.filter((item) => item.id !== state.activeSceneId).map((item) => item.id));
    for (const id of remainingIds) await frame.locator(`.layer-item[data-scene-id="${id}"] [data-action="remove"]`).click();
    await frame.evaluate(() => { const item = getActiveSceneItem(); item.x = 120; item.y = 60; applySceneItemTransform(item); });
    await frame.getByRole('button', { name: '重置位置', exact: true }).click();
    assert.deepEqual(await frame.evaluate(() => ({ x: getActiveSceneItem().x, y: getActiveSceneItem().y })), { x: 0, y: 0 });
    await frame.locator('.layer-item [data-action="remove"]').click();
    assert.equal(await frame.evaluate(() => state.sceneItems.length), 0);
    assert(await frame.locator('#resetTransformButton').isDisabled());
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, imported, painted, multiSelectImport: true, canvasDrop: true, layerDragAndShortcuts: true, alphaToggle: true, autoFitAndZoom: true, timelineScrubAndTimeInput: true, switching: true, userPausePreserved: true, errors }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

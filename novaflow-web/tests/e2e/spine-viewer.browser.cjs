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
    assert.equal(await frame.locator('#projectSelect').count(), 0);
    assert.equal(await frame.locator('#removeAnimationButton').count(), 0);
    assert.deepEqual(await frame.locator('.canvas-toolbar button').evaluateAll((buttons) => buttons.map((button) => button.id)), ['actualSizeButton', 'autoFitButton']);
    assert.deepEqual(await frame.locator('.canvas-actions button').evaluateAll((buttons) => buttons.map((button) => button.id)), ['resetTransformButton', 'pickBackgroundButton', 'clearBackgroundButton', 'premultiplyToggle', 'carouselAnimationToggle']);
    assert.equal(await frame.locator('#canvasHint').count(), 0);
    const fixtureFiles = await frame.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d'); context.fillStyle = '#ff8040'; context.fillRect(12, 12, 8, 8);
      const image = await new Promise((resolve) => canvas.toBlob(resolve));
      const files = [];
      for (const version of ['3.7', '3.8', '4.0', '4.1', '4.2']) {
        const name = `fixture-${version}`;
        const variant = ['3.7', '3.8', '4.0', '4.1', '4.2'].indexOf(version);
        const attachments = { picture: { picture: { width: [32,48,24,40,20][variant], height: [32,20,48,28,40][variant] } } };
        const duration = version === '3.7' ? .4 : version === '3.8' ? 1.2 : 1.0;
        const skeleton = {
          skeleton: { spine: `${version}.00`, width: 32, height: 32 },
          bones: [{ name: 'root' }], slots: [{ name: 'picture', bone: 'root', attachment: 'picture' }],
          skins: version === '3.7' ? { default: attachments } : [{ name: 'default', attachments }],
          animations: {
            idle: { bones: { root: { rotate: [{ angle: 0 }, { time: duration, angle: 30 }] } } },
            turn: { bones: { root: { rotate: [{ angle: 0 }, { time: 2, angle: -30 }] } } },
            flash: { bones: { root: { rotate: [{ angle: 0 }, { time: 2, angle: 15 }] } } },
          },
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
    const savedScenes = await frame.evaluate(() => state.sceneItems.map((item) => ({ id: item.id, x: item.x, y: item.y, z: item.zIndex })));
    const projectRow = (id) => frame.locator(`.layer-item[data-scene-id="${id}"] .layer-name`);
    const [firstProject, secondProject] = savedScenes;
    await frame.evaluate(() => state.sceneItems.forEach((item) => { item.player.pause(); item.paused = true; }));
    await projectRow(firstProject.id).click();
    await projectRow(secondProject.id).click({ modifiers: ['Control'] });
    assert.equal(await frame.evaluate(() => state.selectedSceneIds.size), 2);
    await frame.locator('#nextAnimationButton').click();
    assert.deepEqual(await frame.evaluate(() => state.sceneItems.map((item) => item.animationName)), ['turn', 'turn', 'idle', 'idle', 'idle']);
    assert(await frame.evaluate(() => state.sceneItems.every((item) => item.player.paused)));
    await frame.locator('#nextAnimationButton').click();
    await frame.locator('#nextAnimationButton').click();
    assert(await frame.evaluate(() => state.sceneItems.every((item) => item.animationName === 'idle')));
    await frame.locator('#carouselAnimationToggle').click();
    assert.equal(await frame.locator('#carouselAnimationToggle').getAttribute('aria-checked'), 'true');
    assert(await frame.evaluate(() => state.sceneItems.every((item) => item.animationName === 'idle')));
    await frame.evaluate(() => state.sceneItems.forEach((item) => {
      applyAnimation(item, 'idle'); item.carouselPending = false;
      item.player.play(); item.paused = false;
    }));
    await frame.waitForFunction(() => state.sceneItems[0].animationName === 'turn', null, { timeout: 5000 });
    assert.equal(await frame.evaluate(() => state.sceneItems[1].animationName), 'idle');
    await frame.locator('#nextAnimationButton').click();
    assert.deepEqual(await frame.evaluate(() => state.sceneItems.slice(0, 2).map((item) => item.animationName)), ['flash', 'turn']);
    assert.equal(await frame.locator('#carouselAnimationToggle').getAttribute('aria-checked'), 'true');
    await frame.waitForFunction(() => state.sceneItems.slice(2).every((item) => item.animationName === 'turn'), null, { timeout: 5000 });
    await frame.evaluate(() => state.sceneItems.forEach((item) => { item.player.pause(); item.paused = true; }));
    await frame.locator('#carouselAnimationToggle').click();
    assert.equal(await frame.locator('#carouselAnimationToggle').getAttribute('aria-checked'), 'false');
    await frame.evaluate(() => { for (const item of state.sceneItems) { applyAnimation(item, 'idle'); item.player.pause(); item.paused = true; } syncControlsFromSceneItem(getActiveSceneItem()); });
    const visibleCenter = (id) => frame.evaluate((sceneId) => {
      const item = getSceneItemById(sceneId); updateSceneOutline(item);
      const r = item.element.getBoundingClientRect(), b = item.visibleBounds;
      return { x: r.left + b.left + b.width / 2, y: r.top + b.top + b.height / 2 };
    }, id);
    const frameOffset = await page.locator('#novaflow-spine-viewer-root iframe').boundingBox();
    const canvasClick = async (point) => page.mouse.click(frameOffset.x + point.x, frameOffset.y + point.y);
    const dragPoint = await visibleCenter(firstProject.id);
    const beforeGroupDrag = await frame.evaluate(() => state.sceneItems.map((item) => ({ x: item.x, y: item.y })));
    await page.mouse.move(frameOffset.x + dragPoint.x, frameOffset.y + dragPoint.y);
    await page.mouse.down();
    await page.mouse.move(frameOffset.x + dragPoint.x + 24, frameOffset.y + dragPoint.y + 18, { steps: 3 });
    await page.mouse.up();
    const afterGroupDrag = await frame.evaluate(() => state.sceneItems.map((item) => ({ x: item.x, y: item.y })));
    for (let index = 0; index < 5; index++) {
      assert(Math.abs(afterGroupDrag[index].x - beforeGroupDrag[index].x - (index < 2 ? 24 : 0)) < 1);
      assert(Math.abs(afterGroupDrag[index].y - beforeGroupDrag[index].y - (index < 2 ? 18 : 0)) < 1);
    }
    assert(await frame.evaluate(() => state.sceneItems.filter((item) => state.selectedSceneIds.has(item.id)).every((item) => item.visibleBounds.width < item.element.offsetWidth / 2)));
    await frame.evaluate(([aId, bId]) => {
      const a = getSceneItemById(aId), b = getSceneItemById(bId);
      a.x = -24; a.y = 0; b.x = 24; b.y = 0;
      b.zIndex = state.nextZIndex++; b.element.style.zIndex = String(b.zIndex);
      applySceneItemTransform(a); applySceneItemTransform(b);
      selectSceneItem(b.id);
    }, [firstProject.id, secondProject.id]);
    const lowerPoint = await visibleCenter(firstProject.id);
    assert(await frame.evaluate(({ id, point }) => { const r = getSceneItemById(id).element.getBoundingClientRect(); return point.x > r.left && point.x < r.right && point.y > r.top && point.y < r.bottom; }, { id: secondProject.id, point: lowerPoint }));
    await canvasClick(lowerPoint);
    assert.equal(await frame.evaluate(() => state.activeSceneId), firstProject.id, 'transparent upper padding must allow selecting the lower animation');
    await frame.evaluate(([aId, bId]) => {
      const a = getSceneItemById(aId), b = getSceneItemById(bId);
      a.x = b.x = 0; a.y = b.y = 0; applySceneItemTransform(a); applySceneItemTransform(b);
    }, [firstProject.id, secondProject.id]);
    await canvasClick(await visibleCenter(secondProject.id));
    assert.equal(await frame.evaluate(() => state.activeSceneId), secondProject.id, 'overlapping visible pixels must select the top layer');
    const transparentPoint = await visibleCenter(secondProject.id);
    await frame.evaluate((id) => { const item = getSceneItemById(id); item.player.skeleton.color.a = 0; drawSceneFrame(item); }, secondProject.id);
    await canvasClick(transparentPoint);
    assert.equal(await frame.evaluate(() => state.activeSceneId), secondProject.id, 'a transparent frame must keep the fixed selectable envelope');
    assert(await frame.evaluate((id) => getFixedArtworkBounds(getSceneItemById(id)).width < 18, secondProject.id));
    await frame.evaluate((id) => { const item = getSceneItemById(id); item.player.skeleton.color.a = 1; drawSceneFrame(item); }, secondProject.id);
    await projectRow(firstProject.id).click();
    await page.keyboard.press('Control+a');
    assert.equal(await frame.evaluate(() => state.selectedSceneIds.size), 5);
    const rowsTopFirst = await frame.evaluate(() => getLayerItemsTopFirst().map((item) => item.id));
    await projectRow(rowsTopFirst[0]).click();
    await projectRow(rowsTopFirst[2]).click({ modifiers: ['Shift'] });
    assert.equal(await frame.evaluate(() => state.selectedSceneIds.size), 3);
    await frame.evaluate((saved) => {
      for (const entry of saved) {
        const item = getSceneItemById(entry.id); item.x = entry.x; item.y = entry.y; item.zIndex = entry.z;
        item.element.style.zIndex = String(entry.z); applySceneItemTransform(item); item.player.play(); item.paused = false;
      }
      selectSceneItem(saved[0].id);
    }, savedScenes);
    const beforeGlobalZoom = await frame.evaluate(() => ({ zoom: state.previewZoom, selected: [...state.selectedSceneIds], items: state.sceneItems.map((item) => ({ x: item.x, y: item.y, width: item.element.offsetWidth })) }));
    const zoomArea = await frame.locator('#playerMount').boundingBox();
    await page.mouse.move(zoomArea.x + zoomArea.width / 2, zoomArea.y + zoomArea.height / 2);
    await page.mouse.wheel(0, -120);
    await frame.waitForFunction((zoom) => state.previewZoom > zoom, beforeGlobalZoom.zoom);
    const afterGlobalZoom = await frame.evaluate(() => ({ zoom: state.previewZoom, selected: [...state.selectedSceneIds], items: state.sceneItems.map((item) => ({ x: item.x, y: item.y, width: item.element.offsetWidth })) }));
    const zoomFactor = afterGlobalZoom.zoom / beforeGlobalZoom.zoom;
    for (let i = 0; i < beforeGlobalZoom.items.length; i++) {
      assert(Math.abs(afterGlobalZoom.items[i].x - beforeGlobalZoom.items[i].x * zoomFactor) < .01);
      assert(Math.abs(afterGlobalZoom.items[i].y - beforeGlobalZoom.items[i].y * zoomFactor) < .01);
      assert(Math.abs(afterGlobalZoom.items[i].width - beforeGlobalZoom.items[i].width * zoomFactor) < 2);
    }
    assert.deepEqual(afterGlobalZoom.selected, beforeGlobalZoom.selected);
    await frame.locator('#actualSizeButton').click();
    await frame.getByRole('button', { name: '动画', exact: true }).click();
    await frame.getByRole('option', { name: 'turn', exact: true }).click();
    assert.equal(await frame.evaluate(() => getActiveSceneItem().animationName), 'turn');
    await frame.getByRole('button', { name: '动画', exact: true }).click();
    await frame.getByRole('option', { name: 'idle', exact: true }).click();
    assert.equal(await frame.locator('#pickFilesButton,#pickFolderButton,#folderPicker,#loopToggle,input[type=checkbox]').count(), 0);
    assert(await frame.evaluate(() => state.sceneItems.every((item) => item.loop && item.player.animationState.getCurrent(0).loop)));
    const layerOrder = () => frame.evaluate(() => getLayerItemsTopFirst().map((item) => item.id));
    const originalOrder = await layerOrder();
    const activeId = originalOrder.at(-1);
    const activeRow = () => frame.locator(`.layer-item[data-scene-id="${activeId}"]`);
    await activeRow().locator('.layer-name').click();
    await page.keyboard.press('+');
    assert.equal((await layerOrder()).indexOf(activeId), 3);
    assert.equal(await activeRow().locator('.layer-name').evaluate((node) => getComputedStyle(node).outlineStyle), 'none');
    await page.keyboard.press('-');
    assert.deepEqual(await layerOrder(), originalOrder);
    await page.keyboard.press('NumpadAdd');
    assert.equal((await layerOrder()).indexOf(activeId), 3);
    await frame.getByRole('button', { name: '下移', exact: true }).click();
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
    await frame.locator(`.layer-item[data-scene-id="${originalOrder[0]}"] .layer-name`).click();
    assert.equal(await frame.locator('#premultiplyToggle').getAttribute('aria-pressed'), 'true');
    await activeRow().locator('.layer-name').click();
    assert.equal(await frame.locator('#premultiplyToggle').getAttribute('aria-pressed'), 'false');
    await frame.locator('#premultiplyToggle').click();
    await frame.evaluate(() => setPreviewZoom(.25));
    assert.equal(await frame.locator('#actualSizeButton').textContent(), '25%');
    await frame.locator('#actualSizeButton').click();
    assert.equal(await frame.evaluate(() => state.previewZoom), 1);
    await frame.evaluate(() => { for (const item of state.sceneItems) { item.x = 120; item.y = 60; item.positionTouched = true; applySceneItemTransform(item); } });
    await frame.getByRole('button', { name: '重置位置', exact: true }).click();
    assert.equal(await frame.evaluate(() => state.previewZoom), 1, 'transparent padding must not force tiny zoom during arrangement');
    assert(await frame.evaluate(() => {
      const mount = elements.playerMount.getBoundingClientRect();
      const rects = state.sceneItems.map((item) => { const r = item.element.getBoundingClientRect(), b = getFixedArtworkBounds(item); return { left: r.left + b.left, top: r.top + b.top, right: r.left + b.left + b.width, bottom: r.top + b.top + b.height }; });
      return rects.every((r, i) => r.left >= mount.left && r.right <= mount.right && r.top >= mount.top && r.bottom <= mount.bottom && rects.every((other, j) => i === j || r.right <= other.left || r.left >= other.right || r.bottom <= other.top || r.top >= other.bottom));
    }), 'reset must arrange previously moved, overlapping projects inside the canvas');
    assert(await frame.evaluate(() => {
      const mount = elements.playerMount.getBoundingClientRect();
      const items = [...state.sceneItems].sort((a,b) => a.order - b.order);
      const columns = Math.min(items.length, Math.ceil(Math.sqrt(items.length * mount.width / mount.height)));
      const centers = items.map((item) => { const r = item.element.getBoundingClientRect(), b = getFixedArtworkBounds(item); return { x: r.left + b.left + b.width / 2, y: r.top + b.top + b.height / 2 }; });
      return centers.every((center, index) => Math.abs(center.x - centers[index % columns].x) < .05 && Math.abs(center.y - centers[Math.floor(index / columns) * columns].y) < .05);
    }), 'different sized animations must share their column and row centers');
    assert.deepEqual(await layerOrder(), originalOrder);
    const backgroundChooserEvent = page.waitForEvent('filechooser');
    await frame.getByRole('button', { name: '上传背景', exact: true }).click();
    const backgroundChooser = await backgroundChooserEvent;
    const background = fixtureFiles.find((file) => file.name.endsWith('.png'));
    await backgroundChooser.setFiles({ name: background.name, mimeType: 'image/png', buffer: Buffer.from(background.bytes) });
    await frame.waitForFunction(() => !elements.backgroundImage.hidden && !elements.clearBackgroundButton.disabled);
    const beforePan = await frame.evaluate(() => ({ selected: [...state.selectedSceneIds], items: state.sceneItems.map((item) => ({ x: item.x, y: item.y })) }));
    const panArea = await frame.locator('#playerMount').boundingBox();
    const panFrom = { x: panArea.x + panArea.width / 2, y: panArea.y + panArea.height / 2 };
    await page.mouse.move(panFrom.x, panFrom.y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(panFrom.x + 22, panFrom.y - 12, { steps: 3 }); await page.mouse.up({ button: 'right' });
    const afterPan = await frame.evaluate(() => ({ selected: [...state.selectedSceneIds], x: state.canvasPanX, y: state.canvasPanY, backgroundX: elements.backgroundImage.style.marginLeft, items: state.sceneItems.map((item) => ({ x: item.x, y: item.y })) }));
    assert.deepEqual(afterPan.selected, beforePan.selected);
    assert.equal(afterPan.backgroundX, `${afterPan.x}px`);
    for (let i = 0; i < beforePan.items.length; i++) { assert(Math.abs(afterPan.items[i].x - beforePan.items[i].x - 22) < .1); assert(Math.abs(afterPan.items[i].y - beforePan.items[i].y + 12) < .1); }
    await page.mouse.move(panFrom.x, panFrom.y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(panFrom.x - 22, panFrom.y + 12, { steps: 3 }); await page.mouse.up({ button: 'right' });
    const assertStableFit = async () => {
      await frame.evaluate(() => {
        setPreviewZoom(.83);
        state.canvasPanX = 17.35; state.canvasPanY = -19.75;
        state.sceneItems.forEach((item, index) => { item.x = (index - 2) * 143.15 * state.previewZoom + state.canvasPanX; item.y = ((index % 2) * 71.3 - 35.65) * state.previewZoom + state.canvasPanY; applySceneItemTransform(item); });
        applyBackgroundPreviewZoom(); syncCanvasGrid();
      });
      const fitState = () => frame.evaluate(() => [state.previewZoom, state.canvasPanX, state.canvasPanY, ...state.sceneItems.flatMap((item) => [item.x, item.y])]);
      await frame.locator('#autoFitButton').click();
      const firstFit = await fitState();
      for (let click = 0; click < 10; click++) {
        await frame.locator('#autoFitButton').click();
        const repeatedFit = await fitState();
        assert(repeatedFit.every((value, index) => Math.abs(value - firstFit[index]) < 1e-7), 'repeated Auto Fit must preserve the first fitted zoom and positions');
      }
    };
    await assertStableFit();
    await frame.getByRole('button', { name: '清除背景', exact: true }).click();
    assert(await frame.evaluate(() => elements.backgroundImage.hidden && elements.clearBackgroundButton.disabled));
    await assertStableFit();
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
      return state.sceneItems.every((item) => { const r = item.element.getBoundingClientRect(), b = getFixedArtworkBounds(item); return r.left + b.left >= mount.left && r.left + b.left + b.width <= mount.right && r.top + b.top >= mount.top && r.top + b.top + b.height <= mount.bottom; });
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
    await activeRow().locator('.layer-name').click();
    await frame.locator('#speedRange').fill('1.5');
    assert.equal(await frame.evaluate(() => getActiveSceneItem().speed), 1.5);
    const timeline = await frame.locator('#progressRange').boundingBox();
    await page.mouse.move(timeline.x + timeline.width * .25, timeline.y + timeline.height / 2);
    await page.mouse.down();
    assert(await frame.evaluate(() => getActiveSceneItem().player.paused));
    await page.mouse.move(timeline.x + timeline.width * .75, timeline.y + timeline.height / 2);
    assert(await frame.evaluate(() => { const t = getTrackTiming(getCurrentTrackEntry()); return Math.abs(t.elapsed / t.duration - .75) < .1; }));
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
    await frame.evaluate(async () => {
      const files = [];
      for (let index = 1; index <= 6; index++) {
        const name = `scroll-${index}`;
        for (const source of viewerTestFiles.filter((file) => file.name.startsWith('fixture-4.2'))) {
          let data = /\.(json|atlas)$/.test(source.name) ? (await source.text()).replaceAll('fixture-4.2', name) : source;
          if (source.name.endsWith('.json') && index <= 2) {
            const skeleton = JSON.parse(data); skeleton.slots[0].blend = index === 1 ? 'additive' : 'screen'; data = JSON.stringify(skeleton);
          }
          files.push(new File([data], source.name.replace('fixture-4.2', name), { type: source.type }));
        }
      }
      await enqueueFiles(files);
    });
    assert.equal(await frame.locator('.layer-item').count(), 11);
    assert.equal(await frame.locator('.layer-item .layer-order-button').count(), 0);
    assert.equal(await frame.locator('#layerList').getAttribute('aria-label'), '动画工程');
    assert(await frame.evaluate(() => {
      elements.layerList.scrollTop = 0;
      const list = elements.layerList.getBoundingClientRect();
      const rows = [...elements.layerList.querySelectorAll('.layer-item')].map((row) => row.getBoundingClientRect());
      return rows[9].bottom <= list.bottom + 1 && rows[10].bottom > list.bottom && elements.layerList.scrollHeight > elements.layerList.clientHeight;
    }), 'ten project rows fit; the eleventh requires scrolling');
    // Reproduce the reported obstruction: a high-ranked scene covers the toolbar.
    assert(await frame.evaluate(() => {
      const item = state.sceneItems.at(-1), mount = elements.playerMount.getBoundingClientRect();
      const actions = document.querySelector('.canvas-actions').getBoundingClientRect();
      const shift = sceneAnchorShift(item);
      item.x = actions.x + actions.width / 2 - mount.x - mount.width / 2 - shift.x;
      item.y = actions.y + actions.height / 2 - mount.y - mount.height / 2 - shift.y;
      item.element.style.zIndex = '9999';
      applySceneItemTransform(item);
      return [...document.querySelectorAll('.canvas-actions button:not(:disabled)')].every((button) => {
        const r = button.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button;
      });
    }), 'high project layers must not intercept canvas action clicks');
    const currentBeforeOverlayClick = await frame.evaluate(() => state.activeSceneId);
    const alphaBeforeOverlayClick = await frame.locator('#premultiplyToggle').getAttribute('aria-pressed');
    await frame.locator('#premultiplyToggle').click();
    assert.notEqual(await frame.locator('#premultiplyToggle').getAttribute('aria-pressed'), alphaBeforeOverlayClick);
    assert.equal(await frame.evaluate(() => state.activeSceneId), currentBeforeOverlayClick);
    await frame.locator('#premultiplyToggle').click();
    await frame.getByRole('button', { name: '重置位置', exact: true }).click();
    await frame.locator('.layer-item').last().locator('.layer-name').click();
    assert(await frame.evaluate(() => elements.layerList.scrollTop > 0));
    await frame.locator('.layer-item').first().locator('.layer-name').click();
    await page.screenshot({ path: path.join(output, 'eleven-projects.png') });
    const overflowIds = await frame.evaluate(() => state.sceneItems.filter((item) => item.project.label.startsWith('scroll-')).map((item) => item.id));
    for (const id of overflowIds) await frame.locator(`.layer-item[data-scene-id="${id}"] [data-action="remove"]`).click();
    assert.equal(await frame.locator('.layer-item').count(), 5);
    if (process.env.NF_VIEWER_FIXTURES) {
      const fixtureDir = path.resolve(process.env.NF_VIEWER_FIXTURES);
      const files = (await fs.readdir(fixtureDir)).filter((name) => /\.(json|skel|atlas|png)$/i.test(name)).map((name) => path.join(fixtureDir, name));
      await frame.locator('#filePicker').setInputFiles(files);
      await frame.waitForFunction(() => !elements.statusText.classList.contains('error') && /^已新增/.test(elements.statusText.textContent) && state.sceneItems.length > 5);
      assert(await frame.evaluate(() => state.sceneItems.filter((item) => !item.project.label.startsWith('fixture-')).every((item) => {
        const b = getFixedArtworkBounds(item); return [b.left,b.top,b.width,b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
      })));
      await page.screenshot({ path: path.join(output, 'real-projects.png') });
      console.log(await frame.locator('#statusText').textContent());
    }
    await frame.evaluate(() => clearSceneSelection());
    assert(await frame.locator('#carouselAnimationToggle').isEnabled());
    await frame.locator('#carouselAnimationToggle').click();
    assert.equal(await frame.locator('#carouselAnimationToggle').getAttribute('aria-checked'), 'true');
    await frame.locator('#carouselAnimationToggle').click();
    await frame.locator('.layer-item').first().locator('.layer-name').click();
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

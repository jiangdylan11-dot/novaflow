const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const runtime = process.env.NOVAFLOW_PAN_TEST_RUNTIME || path.resolve(__dirname, '../../particle-editor')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'novaflow-art-pan-test-'))
app.setPath('userData', path.join(out, 'profile'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const artSelector = '[data-novaflow-split-canvas-art="1"]'
const canvasSelector = '[data-novaflow-selection-tool-canvas="1"]'

async function exerciseViewport(width, height) {
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  })
  const errors = []
  win.webContents.on('console-message', (event, level, message) => {
    if (event.level === 'error' || level >= 3) errors.push(event.message || message)
  })
  const evaluate = code => win.webContents.executeJavaScript(code)
  const snapshot = () => evaluate(`(() => {
    const art = document.querySelector('${artSelector}');
    const r = art.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, transform: art.style.transform,
      panning: !!document.querySelector('[data-novaflow-split-panning="1"]') };
  })()`)
  const center = () => evaluate(`(() => {
    const r = document.querySelector('#novaflow-spine-split-workspace-overlay').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`)
  const drag = async (point, dx, dy, button = 'right') => {
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button, clickCount: 1 })
    await sleep(60)
    for (let step = 1; step <= 6; step++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + Math.round(dx * step / 6),
        y: point.y + Math.round(dy * step / 6), button, modifiers: [`${button}ButtonDown`] })
      await sleep(20)
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + dx, y: point.y + dy, button, clickCount: 1 })
    await sleep(150)
  }
  const zoom = async point => {
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    for (let i = 0; i < 7; i++) {
      win.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaX: 0, deltaY: 120 })
      await sleep(45)
    }
  }
  const fit = async () => {
    await evaluate(`document.querySelector('[data-novaflow-spine-split-fit-button="1"]').click()`)
    await sleep(120)
    assert.equal((await snapshot()).transform, 'translate(0px, 0px)')
  }
  const pixels = () => evaluate(`(() => {
    const c = document.querySelector('${canvasSelector}');
    return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
  })()`)
  try {
    await win.loadFile(path.join(runtime, 'index.html'), { query: { __novaflow_split_pan_fixture: '1' } })
    await sleep(1700)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === '\u7f8e\u5de5').click()`)
    await sleep(1000)
    win.webContents.focus()
    assert.equal(await evaluate(`document.getElementById('novaflow-spine-split-workspace-overlay').getAttribute('data-preview-ui')`), '1')
    // Native input has pointerType=mouse, unlike the old MouseEvent-only smoke tests.
    await evaluate(`window.__panPresses = []; window.addEventListener('pointerdown', e => {
      window.__panPresses.push({ trusted: e.isTrusted, pointerType: e.pointerType, button: e.button });
    }, true); true`)
    const point = await center()
    const initial = await snapshot()
    await zoom(point)
    const enlarged = await snapshot()
    assert.ok(enlarged.width > initial.width * 1.5, `wheel must enlarge the image: ${JSON.stringify({initial, enlarged})}`)
    await drag(point, 96, 48)
    const moved = await snapshot()
    assert.equal(moved.transform, 'translate(96px, 48px)', 'right drag must reach the art viewport')
    assert.equal(moved.panning, false)
    assert.ok(Math.abs(moved.x - enlarged.x - 96) < 1)
    assert.ok(Math.abs(moved.y - enlarged.y - 48) < 1)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x - 40, y: point.y - 30 })
    await sleep(150)
    assert.equal((await snapshot()).transform, moved.transform, 'release must stop panning')
    await fit()

    await evaluate(`document.querySelector('[data-novaflow-spine-split-control-category-toggle="edit"]').click()`)
    await evaluate(`document.querySelector('[data-novaflow-spine-split-control-action="inpaintEdit"]').click()`)
    await sleep(600)
    assert.equal(await evaluate(`!!document.querySelector('${canvasSelector}')`), true)
    await zoom(await center())
    const beforePaint = await pixels()
    await drag(await center(), -120, -70)
    assert.equal((await snapshot()).transform, 'translate(-120px, -70px)')
    assert.deepEqual(await pixels(), beforePaint, 'right drag must not paint')
    assert.equal(await evaluate(`document.querySelector('${canvasSelector}').style.pointerEvents`), '')

    const paintPoint = await center()
    const paintCoords = await evaluate(`(() => {
      const c = document.querySelector('${canvasSelector}'), r = c.getBoundingClientRect();
      return { x: Math.floor((${paintPoint.x} - r.x) * c.width / r.width),
        y: Math.floor((${paintPoint.y} - r.y) * c.height / r.height), width: c.width };
    })()`)
    await drag(paintPoint, 32, 16, 'left')
    const afterPaint = await pixels()
    const index = (paintCoords.y * paintCoords.width + paintCoords.x) * 4
    assert.notDeepEqual(afterPaint.slice(index, index + 4), beforePaint.slice(index, index + 4), 'brush must paint the image point under the cursor after pan/zoom')
    assert.equal((await snapshot()).transform, 'translate(-120px, -70px)', 'left painting must not pan')
    await drag(await center(), 84, 40)
    assert.deepEqual(await pixels(), afterPaint, 'panning must preserve the painted selection')
    const floatingAligned = await evaluate(`(() => {
      const c = document.querySelector('${canvasSelector}').getBoundingClientRect();
      const p = document.querySelector('[data-novaflow-selection-paint-floating="1"]').getBoundingClientRect();
      return ['x','y','width','height'].every(k => Math.abs(c[k]-p[k]) < 1);
    })()`)
    assert.equal(floatingAligned, true, 'paint overlay must follow the panned canvas')
    await fit()
    assert.deepEqual(await pixels(), afterPaint, 'auto fit must preserve the painted selection')

    await evaluate(`document.querySelector('[data-novaflow-spine-split-tool-action="selectionExit"]').click()`)
    await sleep(200)
    // Negative control: removing the ownership marker reproduces the original interception.
    await evaluate(`document.getElementById('novaflow-spine-split-workspace-overlay').removeAttribute('data-preview-ui')`)
    const beforeUnprotected = await snapshot()
    await drag(await center(), 96, 48)
    assert.equal((await snapshot()).transform, beforeUnprotected.transform, 'underlying preview must reproduce the unprotected failure')
    await evaluate(`document.getElementById('novaflow-spine-split-workspace-overlay').setAttribute('data-preview-ui', '1')`)
    await drag(await center(), 96, 48)
    assert.equal((await snapshot()).transform, 'translate(96px, 48px)')
    const presses = await evaluate('window.__panPresses')
    assert.ok(presses.some(e => e.trusted && e.pointerType === 'mouse' && e.button === 2))
    await evaluate(`Promise.all(Array.from(document.images).filter(i => i.complete && i.naturalWidth).map(i => i.decode().catch(() => {})))`)
    await win.webContents.capturePage()
    await sleep(150)
    fs.writeFileSync(path.join(out, `viewport-${width}.png`), (await win.webContents.capturePage()).toPNG())
    assert.deepEqual(errors, [])
    return { width, height, zoomRatio: enlarged.width / initial.width, pan: moved.transform,
      rightDragPreservesPaint: true, drawingCoordinates: paintCoords, overlayAligned: floatingAligned,
      originalFailureReproduced: true, consoleErrors: errors }
  } finally {
    win.destroy()
  }
}

app.whenReady().then(async () => {
  const results = []
  for (const size of [[1400, 950], [1024, 768]]) results.push(await exerciseViewport(...size))
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ ok: true, out, results }))
  app.exit(0)
}).catch(error => {
  console.error(error)
  console.error(`Evidence: ${out}`)
  app.exit(1)
})

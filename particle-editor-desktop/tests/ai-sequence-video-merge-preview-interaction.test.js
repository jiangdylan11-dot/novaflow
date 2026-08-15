const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..', '..')
const previewSource = fs.readFileSync(path.join(repoRoot, 'particle-editor/ai-sequence-video-merge.preview.js'), 'utf8')

test('video merge preview uses the sequence black background without a checker pattern', () => {
  assert.match(previewSource, /backgroundColor: '#0b0b0b', backgroundImage: 'none'/)
  assert.doesNotMatch(previewSource, /backgroundSize: '24px 24px'|linear-gradient\(45deg,rgba\(255,255,255,\.035\)/)
  assert.match(previewSource, /if \(state\.layers\.some\(function \(layer\) \{ return Boolean\(layer\.source\) \}\)\) \{[\s\S]{0,260}strokeRect/)
})

class FakeEventTarget {
  constructor() { this.listeners = new Map() }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener))
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this
    Array.from(this.listeners.get(event.type) || []).forEach((listener) => listener.call(this, event))
  }
}

class FakeNode extends FakeEventTarget {
  constructor(ownerDocument, tagName) {
    super()
    this.ownerDocument = ownerDocument
    this.tagName = String(tagName || '').toUpperCase()
    this.children = []
    this.parentElement = null
    this.style = {}
    this.attributes = new Map()
  }
  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }
  append(...children) { children.forEach((child) => this.appendChild(child)) }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null })
    this.children = []
    this.append(...children)
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  removeAttribute(name) { this.attributes.delete(name) }
  remove() {
    if (!this.parentElement) return
    const index = this.parentElement.children.indexOf(this)
    if (index >= 0) this.parentElement.children.splice(index, 1)
    this.parentElement = null
  }
}

class FakeContext {
  constructor() { this.arcs = [] }
  clearRect() {}
  save() {}
  restore() {}
  strokeRect() {}
  fillRect() {}
  drawImage() {}
  translate() {}
  scale() {}
  setLineDash() {}
  beginPath() {}
  arc(x, y, radius) { this.arcs.push({ x, y, radius }) }
  stroke() {}
}

class FakeCanvas extends FakeNode {
  constructor(ownerDocument, context) {
    super(ownerDocument, 'canvas')
    this.width = 300
    this.height = 150
    this.context = context
    this.focusCalls = []
  }
  getContext() { return this.context }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 } }
  focus(options) { this.focusCalls.push(options || null) }
  setPointerCapture(pointerId) { this.capturedPointerId = pointerId }
  releasePointerCapture(pointerId) {
    if (this.capturedPointerId === pointerId) this.capturedPointerId = null
  }
}

class FakeVideo extends FakeNode {
  constructor(ownerDocument) {
    super(ownerDocument, 'video')
    this.readyState = 4
    this.duration = 2
    this.currentTime = 0
    this.paused = true
    this.ended = false
    this.muted = true
    this.volume = 0
    this.preload = ''
    this.playsInline = false
    this.disablePictureInPicture = false
    this.playCalls = 0
    this.pauseCalls = 0
  }
  play() { this.playCalls += 1; this.paused = false; return Promise.resolve() }
  pause() { this.pauseCalls += 1; this.paused = true }
  load() {}
}

function pointerEvent(type, clientX, clientY, pointerId = 1, button = 0) {
  const event = {
    type, clientX, clientY, pointerId, button,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : (button === 2 ? 2 : 1),
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
    stopImmediatePropagation() { this.immediatePropagationStopped = true },
  }
  event.getCoalescedEvents = () => [event]
  return event
}

function wheelEvent(clientX, clientY, deltaY) {
  return {
    type: 'wheel', clientX, clientY, deltaY, deltaMode: 0,
    preventDefault() { this.defaultPrevented = true },
  }
}

function findByAttribute(node, name, expectedValue = '1') {
  if (!node) return null
  if (node.getAttribute?.(name) === expectedValue) return node
  for (const child of node.children || []) {
    const match = findByAttribute(child, name, expectedValue)
    if (match) return match
  }
  return null
}

function createPreviewHarness() {
  const contexts = []
  const videos = []
  let scheduledFrameId = 0
  const scheduledFrames = new Map()
  const canceledFrameIds = []
  const windowRef = new FakeEventTarget()
  windowRef.devicePixelRatio = 1
  windowRef.performance = { now: () => 0 }
  windowRef.requestAnimationFrame = (callback) => {
    scheduledFrameId += 1
    scheduledFrames.set(scheduledFrameId, callback)
    return scheduledFrameId
  }
  windowRef.cancelAnimationFrame = (id) => {
    canceledFrameIds.push(id)
    scheduledFrames.delete(id)
  }
  windowRef.setTimeout = setTimeout
  windowRef.clearTimeout = clearTimeout

  const documentRef = { defaultView: windowRef }
  documentRef.createElement = (tagName) => {
    if (String(tagName).toLowerCase() === 'canvas') {
      const context = new FakeContext()
      contexts.push(context)
      return new FakeCanvas(documentRef, context)
    }
    if (String(tagName).toLowerCase() === 'video') {
      const video = new FakeVideo(documentRef)
      videos.push(video)
      return video
    }
    return new FakeNode(documentRef, tagName)
  }

  const state = {
    canvas: { width: 200, height: 100 },
    selectedLayerId: 'top',
    audioSourceLayerId: null,
    timeSec: 0,
    playing: false,
    layers: [{
      id: 'top', title: 'top', visible: true,
      source: {
        objectUrl: 'blob:top', fileName: 'top.mp4',
        probe: { displayWidth: 200, displayHeight: 100, durationSec: 2 },
      },
      transform: { centerX: 100, centerY: 50, scale: 1 },
    }],
  }
  const subscribers = []
  const store = {
    getState: () => state,
    subscribe(callback) { subscribers.push(callback); return () => {} },
    projectDurationSec: () => 2,
    setPlaying(value) {
      state.playing = Boolean(value)
      subscribers.forEach((callback) => callback(state, 'timeline-playing'))
    },
    setTime(value) {
      state.timeSec = Number(value)
      subscribers.forEach((callback) => callback(state, 'timeline-seek'))
    },
  }
  const surface = {
    strokes: [], extendedPoints: [], events: [], ended: 0,
    getCanvas: () => null,
    beginStroke(value) { this.strokes.push(value); this.events.push({ type: 'begin', value }) },
    extendStroke(value) { this.extendedPoints.push(value); this.events.push({ type: 'extend', value }) },
    endStroke() { this.ended += 1; this.events.push({ type: 'end' }) },
    debugState: () => ({ revision: 1 }),
  }
  const host = new FakeNode(documentRef, 'div')
  const sandbox = { module: { exports: {} }, exports: {}, console, URL, setTimeout, clearTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(previewSource, sandbox, { filename: 'ai-sequence-video-merge.preview.js' })
  const handle = sandbox.module.exports.mount({ host, store, getMaskSurface: () => surface })
  return {
    handle, host, state, surface, windowRef, canvas: handle.getCanvas(), context: handle.getCanvas().context, contexts, videos,
    canceledFrameIds,
    pendingFrameCount() { return scheduledFrames.size },
    runFrame(now = 0) {
      const callbacks = Array.from(scheduledFrames.entries())
      scheduledFrames.clear()
      assert.ok(callbacks.length > 0, 'an animation frame should be scheduled')
      callbacks.forEach((entry) => entry[1](now))
      return callbacks.map((entry) => entry[0])
    },
    runAllFrames(now = 0, maximum = 20) {
      let count = 0
      while (scheduledFrames.size && count < maximum) {
        this.runFrame(now + count * 16)
        count += 1
      }
      assert.ok(count < maximum, 'animation frame queue should settle')
      return count
    },
  }
}

function projectCenterBackingPoint(harness, debugState = harness.handle.debugSnapshot()) {
  const width = Math.max(1, harness.state.canvas.width)
  const height = Math.max(1, harness.state.canvas.height)
  const padding = Math.max(12, Math.min(harness.canvas.width, harness.canvas.height) * 0.045)
  const fitScale = Math.max(0.0001, Math.min(
    (harness.canvas.width - padding * 2) / width,
    (harness.canvas.height - padding * 2) / height,
  ))
  return {
    x: (harness.canvas.width - width * fitScale) / 2 + debugState.viewportPanX + width * fitScale * debugState.viewportZoom / 2,
    y: (harness.canvas.height - height * fitScale) / 2 + debugState.viewportPanY + height * fitScale * debugState.viewportZoom / 2,
  }
}

function assertPointClose(actual, expected, epsilon = 0.0001) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `expected x ${actual.x} to stay near ${expected.x}`)
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `expected y ${actual.y} to stay near ${expected.y}`)
}

test('wheel zoom keeps the project center fixed regardless of cursor position or prior pan', () => {
  const harness = createPreviewHarness()
  const initialCenter = projectCenterBackingPoint(harness)
  const cornerZoom = wheelEvent(24, 270, -240)
  harness.canvas.dispatchEvent(cornerZoom)
  assert.equal(cornerZoom.defaultPrevented, true)
  assertPointClose(projectCenterBackingPoint(harness), initialCenter)

  harness.canvas.dispatchEvent(pointerEvent('pointerdown', 200, 150, 19, 2))
  harness.canvas.dispatchEvent(pointerEvent('pointermove', 245, 178, 19, 2))
  harness.canvas.dispatchEvent(pointerEvent('pointerup', 245, 178, 19, 2))
  const pannedCenter = projectCenterBackingPoint(harness)
  assert.notDeepEqual(pannedCenter, initialCenter)

  harness.canvas.dispatchEvent(wheelEvent(390, 12, 180))
  assertPointClose(projectCenterBackingPoint(harness), pannedCenter)
  harness.handle.destroy()
})

test('window capture owns strict right-button pan and stops immediately after release', () => {
  const harness = createPreviewHarness()
  const listenerCountBeforeDestroy = harness.windowRef.listeners.get('pointerdown')?.length || 0
  assert.ok(listenerCountBeforeDestroy > 0)

  const start = pointerEvent('pointerdown', 180, 130, 27, 2)
  start.target = harness.canvas
  harness.windowRef.dispatchEvent(start)
  assert.equal(harness.handle.debugSnapshot().activeInteraction, 'pan')
  assert.equal(start.defaultPrevented, true)
  assert.equal(start.immediatePropagationStopped, true)

  const move = pointerEvent('pointermove', 230, 165, 27, 2)
  move.target = harness.canvas
  harness.windowRef.dispatchEvent(move)
  const moved = harness.handle.debugSnapshot()
  assert.notEqual(moved.viewportPanX, 0)
  assert.notEqual(moved.viewportPanY, 0)

  const releasedMove = pointerEvent('pointermove', 260, 190, 27, 0)
  releasedMove.buttons = 0
  releasedMove.target = harness.canvas
  harness.windowRef.dispatchEvent(releasedMove)
  const released = harness.handle.debugSnapshot()
  assert.equal(released.activeInteraction, '')
  assert.equal(released.viewportPanX, moved.viewportPanX)
  assert.equal(released.viewportPanY, moved.viewportPanY)

  const staleMove = pointerEvent('pointermove', 290, 220, 27, 2)
  staleMove.target = harness.canvas
  harness.windowRef.dispatchEvent(staleMove)
  assert.equal(harness.handle.debugSnapshot().viewportPanX, moved.viewportPanX)
  assert.equal(harness.handle.debugSnapshot().viewportPanY, moved.viewportPanY)

  harness.handle.destroy()
  assert.equal(harness.windowRef.listeners.get('pointerdown')?.length || 0, listenerCountBeforeDestroy - 1)
})

test('wheel zoom, right-button pan and auto-fit stay isolated from layer transforms', () => {
  const harness = createPreviewHarness()
  const originalTransform = { ...harness.state.layers[0].transform }
  const zoom = wheelEvent(200, 150, -240)
  harness.canvas.dispatchEvent(zoom)
  const zoomed = harness.handle.debugSnapshot()
  assert.equal(zoom.defaultPrevented, true)
  assert.ok(zoomed.viewportZoom > 1)
  assert.deepEqual(harness.state.layers[0].transform, originalTransform)

  harness.canvas.dispatchEvent(pointerEvent('pointerdown', 200, 150, 20, 2))
  assert.equal(harness.handle.debugSnapshot().activeInteraction, 'pan')
  assert.equal(harness.canvas.style.cursor, 'grabbing')
  harness.canvas.dispatchEvent(pointerEvent('pointermove', 240, 175, 20, 2))
  const panned = harness.handle.debugSnapshot()
  assert.notEqual(panned.viewportPanX, zoomed.viewportPanX)
  assert.notEqual(panned.viewportPanY, zoomed.viewportPanY)
  harness.canvas.dispatchEvent(pointerEvent('pointerup', 240, 175, 20, 2))
  assert.equal(harness.handle.debugSnapshot().activeInteraction, '')

  const contextMenu = { type: 'contextmenu', preventDefault() { this.defaultPrevented = true } }
  harness.canvas.dispatchEvent(contextMenu)
  assert.equal(contextMenu.defaultPrevented, true)
  assert.equal(harness.handle.fitToViewport(), true)
  const fitted = harness.handle.debugSnapshot()
  assert.equal(fitted.viewportZoom, 1)
  assert.equal(fitted.viewportPanX, 0)
  assert.equal(fitted.viewportPanY, 0)
  assert.deepEqual(harness.state.layers[0].transform, originalTransform)
  harness.handle.destroy()
})

test('independent brush overlay draws true radii and mode colors without repainting the preview on hover', () => {
  const harness = createPreviewHarness()
  const overlay = findByAttribute(harness.host, 'data-novaflow-ai-video-merge-brush-overlay')
  assert.ok(overlay, 'preview should mount an independent brush overlay')
  assert.notEqual(overlay, harness.canvas)
  assert.equal(overlay.style.pointerEvents, 'none')
  const core = findByAttribute(overlay, 'data-novaflow-ai-video-merge-brush-core')
  const feather = findByAttribute(overlay, 'data-novaflow-ai-video-merge-brush-feather')
  assert.ok(core, 'brush overlay should expose the hard-radius ring')
  assert.ok(feather, 'brush overlay should expose the feather-extent ring')

  harness.handle.setMaskEditing({
    enabled: true, layerId: 'top', surface: harness.surface,
    mode: 'erase', brushSize: 20, feather: 15,
  })

  const renderCountBeforeHover = harness.handle.debugSnapshot().renderCount
  harness.canvas.dispatchEvent(pointerEvent('pointermove', 200, 150))
  if (harness.pendingFrameCount()) harness.runAllFrames()
  assert.equal(harness.handle.debugSnapshot().renderCount, renderCountBeforeHover)
  assert.equal(overlay.style.display, 'block')
  assert.equal(overlay.style.transform, 'translate3d(200px, 150px, 0)')
  assert.equal(core.style.transform, 'translate3d(-10px, -10px, 0)')
  assert.equal(feather.style.transform, 'translate3d(-25px, -25px, 0)')
  assert.equal(core.style.width, '20px')
  assert.equal(core.style.height, '20px')
  assert.equal(core.style.borderColor, '#27c889')
  assert.equal(core.style.borderStyle, 'solid')
  assert.equal(feather.style.width, '50px')
  assert.equal(feather.style.height, '50px')
  assert.equal(feather.style.borderColor, '#27c889')
  assert.equal(feather.style.borderStyle, 'dashed')
  assert.notEqual(feather.style.display, 'none')

  harness.handle.updateMaskBrush({ mode: 'restore', feather: 0 })
  const restoreRenderCountBeforeHover = harness.handle.debugSnapshot().renderCount
  harness.canvas.dispatchEvent(pointerEvent('pointermove', 210, 150))
  if (harness.pendingFrameCount()) harness.runAllFrames()
  assert.equal(harness.handle.debugSnapshot().renderCount, restoreRenderCountBeforeHover)
  assert.equal(overlay.style.transform, 'translate3d(210px, 150px, 0)')
  assert.equal(core.style.transform, 'translate3d(-10px, -10px, 0)')
  assert.equal(core.style.width, '20px')
  assert.equal(core.style.height, '20px')
  assert.equal(core.style.borderColor, '#f7f7f7')
  assert.equal(core.style.borderStyle, 'solid')
  assert.equal(feather.style.display, 'none')
  harness.handle.destroy()
})

test('mask cursor presentation recovers immediately after strict right-button pan', () => {
  const harness = createPreviewHarness()
  const overlay = findByAttribute(harness.host, 'data-novaflow-ai-video-merge-brush-overlay')
  harness.handle.setMaskEditing({
    enabled: true, layerId: 'top', surface: harness.surface,
    mode: 'erase', brushSize: 20, feather: 15,
  })

  assert.equal(overlay.style.display, 'none')
  assert.equal(harness.canvas.style.cursor, 'crosshair')
  harness.canvas.dispatchEvent(pointerEvent('pointermove', 200, 150, 31))
  assert.equal(overlay.style.display, 'block')
  assert.equal(harness.canvas.style.cursor, 'none')

  const start = pointerEvent('pointerdown', 200, 150, 31, 2)
  start.target = harness.canvas
  harness.windowRef.dispatchEvent(start)
  assert.equal(harness.handle.debugSnapshot().activeInteraction, 'pan')
  assert.equal(overlay.style.display, 'none')
  assert.equal(harness.canvas.style.cursor, 'grabbing')

  const move = pointerEvent('pointermove', 235, 172, 31, 2)
  move.target = harness.canvas
  harness.windowRef.dispatchEvent(move)
  const end = pointerEvent('pointerup', 235, 172, 31, 2)
  end.target = harness.canvas
  harness.windowRef.dispatchEvent(end)

  assert.equal(harness.handle.debugSnapshot().activeInteraction, '')
  assert.equal(overlay.style.display, 'block')
  assert.equal(overlay.style.transform, 'translate3d(235px, 172px, 0)')
  assert.equal(harness.canvas.style.cursor, 'none')

  harness.canvas.dispatchEvent(pointerEvent('pointerleave', 235, 172, 31))
  assert.equal(overlay.style.display, 'none')
  assert.equal(harness.canvas.style.cursor, 'crosshair')
  harness.handle.destroy()
})

test('mask pointer moves preserve every ordered sample while coalescing full preview renders to one per frame', () => {
  const harness = createPreviewHarness()
  harness.handle.setMaskEditing({
    enabled: true, layerId: 'top', surface: harness.surface,
    mode: 'erase', brushSize: 20, feather: 15,
  })
  harness.canvas.dispatchEvent(pointerEvent('pointerdown', 200, 150, 4))
  if (harness.pendingFrameCount()) harness.runAllFrames()

  const debugBeforeMoves = harness.handle.debugSnapshot()
  const renderCountBeforeMoves = debugBeforeMoves.renderCount
  harness.surface.extendedPoints.length = 0
  for (let index = 0; index < 120; index += 1) {
    harness.canvas.dispatchEvent(pointerEvent('pointermove', 201 + index, 150 + (index % 5) * 0.1, 4))
  }

  assert.equal(harness.surface.extendedPoints.length, 120)
  for (let index = 1; index < harness.surface.extendedPoints.length; index += 1) {
    assert.ok(harness.surface.extendedPoints[index - 1].x < harness.surface.extendedPoints[index].x)
  }
  const debugBeforeFrame = harness.handle.debugSnapshot()
  assert.equal(debugBeforeFrame.renderCount, renderCountBeforeMoves)
  assert.equal(debugBeforeFrame.maskRenderRequestCount - debugBeforeMoves.maskRenderRequestCount, 120)
  assert.equal(debugBeforeFrame.maskRenderFrameCount, debugBeforeMoves.maskRenderFrameCount)
  assert.equal(debugBeforeFrame.maskRenderCoalescedCount - debugBeforeMoves.maskRenderCoalescedCount, 119)
  assert.equal(debugBeforeFrame.maskRenderPending, true)
  assert.ok(harness.pendingFrameCount() > 0)

  harness.runFrame(16)
  const debugAfterFrame = harness.handle.debugSnapshot()
  assert.equal(debugAfterFrame.renderCount - renderCountBeforeMoves, 1)
  assert.equal(debugAfterFrame.maskRenderFrameCount - debugBeforeMoves.maskRenderFrameCount, 1)
  assert.equal(debugAfterFrame.maskRenderPending, false)
  const renderCountBeforePointerUp = debugAfterFrame.renderCount
  const syncFlushCountBeforePointerUp = debugAfterFrame.maskRenderSyncFlushCount
  harness.canvas.dispatchEvent(pointerEvent('pointerup', 320, 150.4, 4))
  assert.equal(harness.surface.ended, 1)
  assert.equal(harness.handle.debugSnapshot().renderCount, renderCountBeforePointerUp)
  assert.equal(harness.handle.debugSnapshot().maskRenderSyncFlushCount, syncFlushCountBeforePointerUp)
  harness.handle.destroy()
})

test('pointerup flushes the pending mask render once before the stroke completes', () => {
  const harness = createPreviewHarness()
  harness.handle.setMaskEditing({
    enabled: true, layerId: 'top', surface: harness.surface,
    mode: 'erase', brushSize: 20, feather: 15,
  })
  harness.canvas.dispatchEvent(pointerEvent('pointerdown', 200, 150, 5))
  if (harness.pendingFrameCount()) harness.runAllFrames()
  const debugBeforeMove = harness.handle.debugSnapshot()
  const renderCountBeforeMove = debugBeforeMove.renderCount

  harness.canvas.dispatchEvent(pointerEvent('pointermove', 225, 160, 5))
  assert.equal(harness.handle.debugSnapshot().renderCount, renderCountBeforeMove)
  assert.ok(harness.pendingFrameCount() > 0)
  harness.canvas.dispatchEvent(pointerEvent('pointerup', 225, 160, 5))

  const debugAfterPointerUp = harness.handle.debugSnapshot()
  assert.equal(harness.surface.ended, 1)
  assert.deepEqual(harness.surface.events.map((entry) => entry.type), ['begin', 'extend', 'end'])
  assert.equal(debugAfterPointerUp.renderCount - renderCountBeforeMove, 1)
  assert.equal(debugAfterPointerUp.maskRenderSyncFlushCount - debugBeforeMove.maskRenderSyncFlushCount, 1)
  assert.equal(debugAfterPointerUp.maskRenderPending, false)
  assert.equal(harness.pendingFrameCount(), 0)
  harness.handle.destroy()
})

test('destroy cancels a pending mask animation frame', () => {
  const harness = createPreviewHarness()
  harness.handle.setMaskEditing({
    enabled: true, layerId: 'top', surface: harness.surface,
    mode: 'erase', brushSize: 20, feather: 15,
  })
  harness.canvas.dispatchEvent(pointerEvent('pointerdown', 200, 150, 6))
  if (harness.pendingFrameCount()) harness.runAllFrames()
  harness.canvas.dispatchEvent(pointerEvent('pointermove', 220, 150, 6))
  assert.ok(harness.pendingFrameCount() > 0)
  const renderCountBeforeDestroy = harness.handle.debugSnapshot().renderCount

  harness.handle.destroy()

  assert.equal(harness.pendingFrameCount(), 0)
  assert.ok(harness.canceledFrameIds.length > 0)
  assert.equal(harness.handle.debugSnapshot().renderCount, renderCountBeforeDestroy)
})

test('preview playback advances the merge clock and only a valid mask stroke pauses it', async () => {
  const harness = createPreviewHarness()
  harness.handle.setMaskEditing({
    enabled: true, layerId: 'top', surface: harness.surface,
    mode: 'erase', brushSize: 20, feather: 15,
  })

  assert.equal(await harness.handle.play(), true)
  assert.equal(harness.state.playing, true)
  assert.equal(harness.videos[0].playCalls, 1)
  harness.videos[0].currentTime = 0.5
  harness.runFrame(500)
  assert.equal(harness.state.timeSec, 0.5)

  harness.canvas.dispatchEvent(pointerEvent('pointerdown', 0, 0, 7))
  assert.equal(harness.state.playing, true)
  assert.equal(harness.surface.strokes.length, 0)

  const pauseCallsBeforeStroke = harness.videos[0].pauseCalls
  harness.canvas.dispatchEvent(pointerEvent('pointerdown', 200, 150, 8))
  assert.equal(harness.state.playing, false)
  assert.ok(harness.videos[0].pauseCalls > pauseCallsBeforeStroke)
  assert.equal(harness.surface.strokes.length, 1)
  assert.ok(harness.surface.strokes[0].featherPx > 0)
  assert.equal(harness.canvas.focusCalls.length, 2)

  harness.canvas.dispatchEvent(pointerEvent('pointerup', 200, 150, 8))
  assert.equal(harness.surface.ended, 1)
  harness.handle.destroy()
})

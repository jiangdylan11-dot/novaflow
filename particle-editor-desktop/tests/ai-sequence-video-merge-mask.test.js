const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

const toolPath = path.resolve(__dirname, '../../particle-editor/ai-sequence-video-merge.mask.tool.js')
const source = fs.readFileSync(toolPath, 'utf8')
const sandbox = { module: { exports: {} }, exports: {} }
sandbox.document = {
  createElement(tagName) {
    assert.equal(tagName, 'canvas')
    const canvas = { width: 0, height: 0, writes: [] }
    const context = {
      createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) } },
      putImageData(value, x, y) { canvas.writes.push({ width: value.width, height: value.height, x, y }) },
    }
    canvas.getContext = () => context
    return canvas
  },
}
sandbox.globalThis = sandbox
vm.runInNewContext(source, sandbox, { filename: toolPath })
const tool = sandbox.module.exports

function stroke(surface, options, end) {
  surface.beginStroke(options)
  if (end) surface.extendStroke(end)
  surface.endStroke()
}

test('mask tool exports one frozen browser-global and CommonJS API', () => {
  assert.equal(sandbox.NovaFlowAiSequenceVideoMergeMaskTool, tool)
  assert.equal(Object.isFrozen(tool), true)
  assert.equal(typeof tool.createSurface, 'function')
})

test('global coverage surfaces are isolated and never expose mutable storage', () => {
  const first = tool.createSurface({ width: 16, height: 16 })
  const second = tool.createSurface({ width: 16, height: 16 })
  stroke(first, { mode: 'erase', radiusPx: 2, featherPx: 0, x: 8, y: 8 })
  assert.equal(first.sample(8, 8), 0)
  assert.equal(second.sample(8, 8), 255)

  const copy = first.getCoverage()
  copy[8 * 16 + 8] = 255
  assert.equal(first.sample(8, 8), 0)
})

test('hard and feathered brushes use erase-min and restore-max coverage semantics', () => {
  const hard = tool.createSurface({ width: 24, height: 24 })
  stroke(hard, { mode: 'erase', radiusPx: 2, featherPx: 0, x: 10, y: 10 })
  assert.equal(hard.sample(10, 10), 0)
  assert.equal(hard.sample(12, 10), 0)
  assert.equal(hard.sample(13, 10), 255)

  const soft = tool.createSurface({ width: 24, height: 24 })
  stroke(soft, { mode: 'erase', radiusPx: 2, featherPx: 4, x: 10, y: 10 })
  const edge = soft.sample(14, 10)
  assert.equal(soft.sample(10, 10), 0)
  assert.ok(edge > 0 && edge < 255)
  assert.equal(soft.sample(16, 10), 255)

  stroke(soft, { mode: 'restore', radiusPx: 2, featherPx: 0, x: 10, y: 10 })
  assert.equal(soft.sample(10, 10), 255)
  assert.equal(soft.sample(14, 10), edge)
})

test('continuous strokes interpolate without holes and create one history entry', () => {
  const surface = tool.createSurface({ width: 64, height: 16, tileSize: 8 })
  stroke(surface, { mode: 'erase', radiusPx: 1, featherPx: 0, x: 4, y: 8 }, { x: 59, y: 8 })
  for (let x = 4; x <= 59; x += 1) assert.equal(surface.sample(x, 8), 0)
  assert.equal(surface.sample(32, 11), 255)
  assert.equal(surface.debugState().undoEntries, 1)
})

test('continuous strokes remain gap-free in reverse, vertical, and diagonal directions', () => {
  const reverse = tool.createSurface({ width: 40, height: 40, tileSize: 8 })
  stroke(reverse, { mode: 'erase', radiusPx: 1, featherPx: 2, x: 35, y: 8 }, { x: 4, y: 8 })
  for (let x = 4; x <= 35; x += 1) assert.equal(reverse.sample(x, 8), 0)

  const vertical = tool.createSurface({ width: 40, height: 40, tileSize: 8 })
  stroke(vertical, { mode: 'erase', radiusPx: 1, featherPx: 2, x: 20, y: 35 }, { x: 20, y: 4 })
  for (let y = 4; y <= 35; y += 1) assert.equal(vertical.sample(20, y), 0)

  const diagonal = tool.createSurface({ width: 40, height: 40, tileSize: 8 })
  stroke(diagonal, { mode: 'erase', radiusPx: 1, featherPx: 2, x: 35, y: 35 }, { x: 4, y: 4 })
  for (let value = 4; value <= 35; value += 1) assert.equal(diagonal.sample(value, value), 0)
  assert.equal(diagonal.sample(4, 12), 255)
})

test('tile history restores exact bytes through undo and redo', () => {
  const surface = tool.createSurface({ width: 32, height: 24, tileSize: 8 })
  const before = surface.copyCoverage()
  stroke(surface, { mode: 'erase', radiusPx: 3, featherPx: 3, x: 4, y: 5 }, { x: 27, y: 18 })
  const after = surface.copyCoverage()
  assert.notDeepEqual(after, before)
  assert.equal(surface.canUndo(), true)
  assert.equal(surface.undo(), true)
  assert.deepEqual(surface.copyCoverage(), before)
  assert.equal(surface.canRedo(), true)
  assert.equal(surface.redo(), true)
  assert.deepEqual(surface.copyCoverage(), after)

  surface.undo()
  stroke(surface, { mode: 'erase', radiusPx: 1, featherPx: 0, x: 1, y: 1 })
  assert.equal(surface.canRedo(), false)
})

test('history obeys byte and entry budgets using single-channel tile diffs', () => {
  const bytesLimited = tool.createSurface({ width: 16, height: 8, tileSize: 4, maxHistoryEntries: 100, maxHistoryBytes: 64 })
  stroke(bytesLimited, { mode: 'erase', radiusPx: 0.25, featherPx: 0, x: 1, y: 1 })
  stroke(bytesLimited, { mode: 'erase', radiusPx: 0.25, featherPx: 0, x: 5, y: 1 })
  stroke(bytesLimited, { mode: 'erase', radiusPx: 0.25, featherPx: 0, x: 9, y: 1 })
  assert.equal(bytesLimited.debugState().historyBytes, 64)
  assert.equal(bytesLimited.debugState().undoEntries, 2)
  assert.equal(bytesLimited.undo(), true)
  assert.equal(bytesLimited.undo(), true)
  assert.equal(bytesLimited.undo(), false)

  const entriesLimited = tool.createSurface({ width: 16, height: 8, tileSize: 4, maxHistoryEntries: 2, maxHistoryBytes: 1024 })
  stroke(entriesLimited, { mode: 'erase', radiusPx: 0.25, featherPx: 0, x: 1, y: 1 })
  stroke(entriesLimited, { mode: 'erase', radiusPx: 0.25, featherPx: 0, x: 5, y: 1 })
  stroke(entriesLimited, { mode: 'erase', radiusPx: 0.25, featherPx: 0, x: 9, y: 1 })
  assert.equal(entriesLimited.debugState().undoEntries, 2)
})

test('clear is undoable while reset replaces coverage and discards history', () => {
  const surface = tool.createSurface({ width: 12, height: 12, tileSize: 4 })
  stroke(surface, { mode: 'erase', radiusPx: 2, featherPx: 0, x: 6, y: 6 })
  const erased = surface.copyCoverage()
  assert.equal(surface.clear(), true)
  assert.equal(surface.sample(6, 6), 255)
  assert.equal(surface.undo(), true)
  assert.deepEqual(surface.copyCoverage(), erased)

  const replacement = new Uint8Array(12 * 12)
  replacement.fill(73)
  surface.reset(replacement)
  assert.equal(surface.sample(6, 6), 73)
  assert.equal(surface.canUndo(), false)
  assert.equal(surface.canRedo(), false)
  surface.reset()
  assert.equal(surface.sample(6, 6), 255)
})

test('RGBA output keeps white RGB and stores coverage only in alpha', () => {
  const surface = tool.createSurface({ width: 4, height: 4 })
  stroke(surface, { mode: 'erase', radiusPx: 0.25, featherPx: 0, x: 2, y: 2 })
  const image = surface.toRgbaImageData()
  const offset = (2 * 4 + 2) * 4
  assert.deepEqual(Array.from(image.data.slice(offset, offset + 4)), [255, 255, 255, 0])

  let written = null
  const context = {
    createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) } },
    putImageData(value, x, y) { written = { value, x, y } },
  }
  surface.putImageData(context, 3, 5)
  assert.equal(written.x, 3)
  assert.equal(written.y, 5)
  assert.equal(written.value.data[offset + 3], 0)
})

test('cached canvas refreshes only dirty mask tiles after a stroke', () => {
  const surface = tool.createSurface({ width: 256, height: 256, tileSize: 64 })
  const canvas = surface.getCanvas()
  assert.deepEqual(canvas.writes, [{ width: 256, height: 256, x: 0, y: 0 }])
  stroke(surface, { mode: 'erase', radiusPx: 2, featherPx: 0, x: 10, y: 10 })
  surface.getCanvas()
  assert.deepEqual(canvas.writes[1], { width: 64, height: 64, x: 0, y: 0 })
})

test('module contract contains no frame-key, frame-map, checkbox, or data-URL state', () => {
  assert.doesNotMatch(source, /manualFrames|manualGlobal|tKey|frameMap|dataURL/i)
  assert.match(source, /kind: 'global-coverage'/)
})

test('destroy releases storage and is idempotent', () => {
  const surface = tool.createSurface({ width: 4, height: 4 })
  assert.equal(surface.destroy(), true)
  assert.equal(surface.destroy(), false)
  assert.equal(surface.debugState().destroyed, true)
  assert.throws(() => surface.copyCoverage(), /destroyed/)
})

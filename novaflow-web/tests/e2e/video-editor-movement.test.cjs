const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
const previewSource = fs.readFileSync(path.join(renderer, 'video-editor.preview.js'), 'utf8')
const workspaceSource = fs.readFileSync(path.join(renderer, 'video-editor.workspace.js'), 'utf8')

function fixture() {
  const listeners = new Map()
  let focused = false, selected = true, masking = false, alive = true
  const clip = { id: 'clip', source: { width: 400, height: 400 }, transform: { centerX: 500, centerY: 500, scale: 1 } }
  const editor = { state: { canvas: { width: 1000, height: 1000 } },
    selectedClip: () => selected ? clip : null, activeClips: () => [{ clip, kind: 'video' }],
    select: id => { selected = id === clip.id }, setTransform: (_id, patch) => Object.assign(clip.transform, patch) }
  const document = { createElement: () => ({ style: {}, appendChild() {}, remove() {}, getContext: () => ({}),
    addEventListener: (type, fn) => listeners.set(type, fn), getBoundingClientRect: () => ({ left: 0, top: 0 }),
    focus: () => { focused = true }, setPointerCapture() {}, releasePointerCapture() {} }), addEventListener() {}, removeEventListener() {} }
  const ctx = vm.createContext({ document, setTimeout() {}, editor, console })
  vm.runInContext(previewSource, ctx)
  const preview = ctx.NovaFlowVideoEditorPreview.mount({ host: { clientWidth: 1032, clientHeight: 1032, appendChild() {} }, editor })
  const start = workspaceSource.indexOf('    function isTextTarget(')
  const end = workspaceSource.indexOf("    windowRef.addEventListener('keydown', handleKey", start)
  Object.assign(ctx, { preview, syncClipBox() {} })
  Object.defineProperty(ctx, 'maskEdit', { get: () => masking })
  Object.defineProperty(ctx, 'alive', { get: () => alive })
  vm.runInContext(workspaceSource.slice(start, end), ctx)
  const pointer = (type, x, y, shift = false, button = 0) => listeners.get(type)({ clientX: x, clientY: y, pointerId: 1, button, shiftKey: shift })
  const key = (key, options = {}) => {
    const event = { key, target: { tagName: 'CANVAS' }, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }, ...options }
    ctx.handleKey(event)
    return event
  }
  return { clip, pointer, key, preview, focused: () => focused, select: v => { selected = v }, mask: v => { masking = v }, close: () => { alive = false } }
}

test('Shift drag locks horizontal and stays on that axis even if vertical displacement grows', () => {
  const f = fixture()
  f.pointer('pointerdown', 516, 516, true)
  assert(f.focused())
  f.pointer('pointermove', 556, 526, true)
  assert.deepEqual(f.clip.transform, { centerX: 540, centerY: 500, scale: 1 })
  f.pointer('pointermove', 536, 616, true)
  assert.deepEqual(f.clip.transform, { centerX: 520, centerY: 500, scale: 1 })
})

test('Shift drag locks vertical; releasing Shift restores free movement and pressing it again chooses an axis', () => {
  const f = fixture()
  f.pointer('pointerdown', 516, 516)
  f.pointer('pointermove', 526, 556, true)
  assert.deepEqual(f.clip.transform, { centerX: 500, centerY: 540, scale: 1 })
  f.pointer('pointermove', 546, 556)
  assert.deepEqual(f.clip.transform, { centerX: 530, centerY: 540, scale: 1 })
  f.pointer('pointermove', 576, 536, true)
  assert.deepEqual(f.clip.transform, { centerX: 560, centerY: 500, scale: 1 })
})

test('normal drag and panning remain free; locked drags respect the preview zoom', () => {
  const f = fixture()
  f.preview.setViewZoom(2)
  f.pointer('pointerdown', 516, 516)
  f.pointer('pointermove', 556, 536)
  assert.deepEqual(f.clip.transform, { centerX: 520, centerY: 510, scale: 1 })
  f.pointer('pointerup', 556, 536)
  f.pointer('pointerdown', 516, 516, true, 2)
  f.pointer('pointermove', 546, 556, true, 2)
  assert.deepEqual(f.clip.transform, { centerX: 520, centerY: 510, scale: 1 })
})

test('arrows nudge by project pixels, Shift uses 10 pixels, and repeated presses continue moving', () => {
  const f = fixture()
  f.preview.setViewZoom(2)
  for (const key of ['ArrowLeft', 'ArrowUp']) { const e = f.key(key); assert(e.prevented && e.stopped) }
  f.key('ArrowRight', { shiftKey: true })
  f.key('ArrowDown', { shiftKey: true })
  f.key('ArrowDown', { repeat: true })
  assert.deepEqual(f.clip.transform, { centerX: 509, centerY: 510, scale: 1 })
})

test('typing, mask editing, modifiers, absent selection, audio clips and closed workspace do not move the image', () => {
  const f = fixture()
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert(!f.key('ArrowUp', { target: { tagName } }).prevented)
  assert(!f.key('ArrowUp', { target: { isContentEditable: true } }).prevented)
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) assert(!f.key('ArrowUp', { [modifier]: true }).prevented)
  f.mask(true); assert(!f.key('ArrowUp').prevented); f.mask(false)
  f.select(false); assert(!f.key('ArrowUp').prevented); f.select(true)
  const transform = f.clip.transform; f.clip.transform = null
  assert(!f.key('ArrowUp').prevented); f.clip.transform = transform
  f.close(); assert(!f.key('ArrowUp').prevented)
  assert.deepEqual(transform, { centerX: 500, centerY: 500, scale: 1 })
})

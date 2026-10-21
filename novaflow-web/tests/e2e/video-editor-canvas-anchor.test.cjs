const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.resolve(__dirname, '../../renderer/video-editor.timeline.js'), 'utf8')
const start = source.indexOf('    function setCanvas(')
const end = source.indexOf('    // ---- public', start)

function fixture() {
  const state = { canvas: { width: 800, height: 800, fps: 30 } }
  const clips = [
    { transform: { centerX: 350, centerY: 410, scale: 0.7 }, mask: { revision: 2 }, start: 0 },
    { transform: { centerX: 100, centerY: 220, scale: 1.4 }, visible: false, start: 12 },
    { kind: 'audio', start: 3 }
  ]
  let changes = 0
  const ctx = vm.createContext({ state, allClips: () => clips, clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)), changed: () => changes++ })
  vm.runInContext(source.slice(start, end), ctx)
  return { state, clips, resize: ctx.setCanvas, changes: () => changes }
}

for (const x of [0, 0.5, 1]) for (const y of [0, 0.5, 1]) {
  test(`canvas anchor (${x}, ${y}) keeps the chosen point fixed on growth and crop`, () => {
    const f = fixture(), before = JSON.stringify(f.clips), mask = f.clips[0].mask
    f.resize(1000, 1200, undefined, { x, y })
    assert.deepEqual(f.clips[0].transform, { centerX: 350 + 200*x, centerY: 410 + 400*y, scale: 0.7 })
    assert.deepEqual(f.clips[1].transform, { centerX: 100 + 200*x, centerY: 220 + 400*y, scale: 1.4 })
    assert.equal(f.clips[0].mask, mask)
    assert.deepEqual(f.clips[2], { kind: 'audio', start: 3 })
    f.resize(800, 800, undefined, { x, y })
    assert.equal(JSON.stringify(f.clips), before, 'cropping back restores original positions without losing content')
    assert.equal(f.changes(), 2)
  })
}

test('single-axis resize, even-pixel rounding and FPS changes use the same model', () => {
  const f = fixture()
  f.resize(999, 800, undefined, { x: 1, y: 1 })
  assert.equal(f.state.canvas.width, 1000)
  assert.equal(f.clips[0].transform.centerX, 550)
  assert.equal(f.clips[0].transform.centerY, 410)
  const before = JSON.stringify(f.clips)
  f.resize(1000, 800, 60)
  assert.equal(f.state.canvas.fps, 60)
  assert.equal(JSON.stringify(f.clips), before)
})

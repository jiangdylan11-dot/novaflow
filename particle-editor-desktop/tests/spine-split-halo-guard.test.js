const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'

function loadRuntime() {
  const s = loadSpine(RUNTIME)
  s.PRESETS = []
  return s
}

function rgbaCanvas(width, height) {
  return new Uint8ClampedArray(width * height * 4)
}

function paint(rgba, width, x0, x1, y0, y1, color) {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) rgba.set(color, (y * width + x) * 4)
}

test('one-click split removes source-guided dark halos before splitting feet or merging the face', () => {
  const source = read(RUNTIME)
  assert.match(source, /clean = await removeSeeThroughDarkHalos\(clean\)/, 'halo removal must run on the raw See-through layers')
  assert.match(source, /catch \(error\) \{\s*console\.warn\('\[NovaFlow\] dark halo removal skipped:'/)
  assert.match(source, /cropped\.seeThroughDepth = Number\.isFinite\(Number\(layer\.depth_median\)\)/, 'the model depth must stay on each layer record')
})

test('dark halo pixels are recoloured from the layer core only where the source underneath is bright', () => {
  const s = loadRuntime()
  const width = 24
  const height = 24
  const layer = rgbaCanvas(width, height)
  paint(layer, width, 6, 17, 6, 17, [255, 240, 230, 255])
  paint(layer, width, 5, 18, 5, 5, [40, 40, 40, 120])
  paint(layer, width, 5, 18, 18, 18, [40, 40, 40, 120])
  paint(layer, width, 5, 5, 5, 18, [40, 40, 40, 120])
  paint(layer, width, 18, 18, 5, 18, [40, 40, 40, 120])
  const brightSource = rgbaCanvas(width, height)
  paint(brightSource, width, 0, width - 1, 0, height - 1, [210, 200, 190, 255])
  const fixed = s.removeForeignDarkHalo(layer, brightSource, width, height, { radius: 8, darkGap: 25 })
  assert.ok(fixed >= 50, `halo ring must be recoloured (${fixed})`)
  const ring = (5 * width + 10) * 4
  assert.ok(layer[ring] > 200 && layer[ring + 3] === 120, 'halo pixel takes the core colour and keeps its alpha')
  const core = (10 * width + 10) * 4
  assert.deepEqual([...layer.slice(core, core + 4)], [255, 240, 230, 255], 'opaque pixels are never touched')

  const lineArt = rgbaCanvas(width, height)
  paint(lineArt, width, 6, 17, 6, 17, [255, 240, 230, 255])
  paint(lineArt, width, 5, 18, 5, 5, [40, 40, 40, 120])
  const darkSource = rgbaCanvas(width, height)
  paint(darkSource, width, 0, width - 1, 0, height - 1, [30, 30, 30, 255])
  assert.equal(s.removeForeignDarkHalo(lineArt, darkSource, width, height, { radius: 8, darkGap: 25 }), 0, 'dark edge that exists in the source is line art and stays')
  assert.equal(lineArt[(5 * width + 10) * 4], 40)
})

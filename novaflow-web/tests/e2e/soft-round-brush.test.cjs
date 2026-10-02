const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
function load(file) {
  const sandbox = {module: {exports: {}}}; sandbox.globalThis = sandbox
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../renderer', file), 'utf8'), sandbox)
  return sandbox.module.exports
}
const brush = load('soft-round-brush.js')
const mask = load('ai-sequence-video-merge.mask.tool.js')

test('soft round falloff is monotonic with smooth centre and edge', () => {
  let previous = 1
  for (let distance = 0; distance <= 40; distance += 0.1) {
    const value = brush.strength(distance, 0, 40)
    assert(value <= previous + 1e-12)
    assert(value >= 0 && value <= 1)
    previous = value
  }
  assert.equal(brush.strength(20, 0, 40), 0.5)
  assert(brush.strength(0.1, 0, 40) > 0.99999)
  assert(brush.strength(39.9, 0, 40) < 0.00001)
})

test('merge mask is circular, agrees with the shared falloff, and supports undo/restore', () => {
  const surface = mask.createSurface({width: 101, height: 101})
  surface.beginStroke({x:50, y:50, radiusPx:20, featherPx:20, mode:'erase'})
  surface.endStroke()
  const coverage = surface.getCoverage()
  const at = (x,y) => coverage[y * 101 + x]
  for (let d = 0; d <= 40; d++) {
    assert.equal(at(50+d,50), at(50,50+d))
    assert(Math.abs(at(50+d,50) - Math.round(255*(1-brush.strength(d,0,40)))) <= 1)
  }
  assert.equal(at(65,70), at(75,50)) // identical Euclidean radius, diagonal versus axis
  surface.undo()
  assert(surface.getCoverage().every(value => value === 255))
  surface.redo()
  surface.beginStroke({x:50,y:50,radiusPx:20,featherPx:20,mode:'restore'})
  surface.endStroke()
  assert.equal(surface.getCoverage()[50*101+50],255)
})

test('canvas brush paints a real circular alpha ramp without a blur filter', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  const document = {createElement() { const canvas = createCanvas(1,1); canvas.ownerDocument = document; return canvas }}
  const canvas = document.createElement('canvas'); canvas.width=101; canvas.height=101
  const ctx = canvas.getContext('2d')
  brush.paintCanvas(ctx,50.5,50.5,50.5,50.5,20,20,true)
  const pixels=ctx.getImageData(0,0,101,101).data
  const alpha=(x,y)=>pixels[(y*101+x)*4+3]
  assert.equal(alpha(50,50),255)
  assert.equal(alpha(90,50),0)
  assert.equal(alpha(65,70),alpha(75,50))
  assert(Math.abs(alpha(70,50)-128)<=1)
  brush.paintCanvas(ctx,50.5,50.5,50.5,50.5,20,20,true)
  assert(ctx.getImageData(70,50,1,1).data[3]>128)
  if (process.env.NOVAFLOW_BRUSH_PREVIEW) require('node:fs').writeFileSync(process.env.NOVAFLOW_BRUSH_PREVIEW, canvas.toBuffer('image/png'))
})

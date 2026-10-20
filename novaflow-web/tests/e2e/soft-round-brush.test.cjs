const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
function load(file) {
  const sandbox = {module: {exports: {}}}; sandbox.globalThis = sandbox
  if (process.env.NOVAFLOW_CANVAS) sandbox.document = { createElement() { return require(process.env.NOVAFLOW_CANVAS).createCanvas(1, 1) } }
  if(file!=='soft-round-brush.js') sandbox.NovaFlowSoftBrush=load('soft-round-brush.js')
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
  surface.beginStroke({x:50.5, y:50.5, radiusPx:20, featherPx:20, mode:'erase'})
  surface.endStroke()
  const coverage = surface.getCoverage()
  const at = (x,y) => coverage[y * 101 + x]
  for (let d = 0; d <= 40; d++) {
    assert.equal(at(50+d,50), at(50,50+d))
    assert(Math.abs(at(50+d,50) - Math.round(255*(1-brush.strength(d,20,40)))) <= 1)
  }
  assert.equal(at(65,70), at(75,50)) // identical Euclidean radius, diagonal versus axis
  surface.undo()
  assert(surface.getCoverage().every(value => value === 255))
  surface.redo()
  surface.beginStroke({x:50.5,y:50.5,radiusPx:20,featherPx:20,mode:'restore'})
  surface.endStroke()
  assert(surface.getCoverage()[50*101+50]>coverage[50*101+50])
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
  assert(Math.abs(alpha(80,50)-128)<=1)
  brush.paintCanvas(ctx,50.5,50.5,50.5,50.5,20,20,true)
  assert(ctx.getImageData(80,50,1,1).data[3]>128)
  if (process.env.NOVAFLOW_BRUSH_PREVIEW) require('node:fs').writeFileSync(process.env.NOVAFLOW_BRUSH_PREVIEW, canvas.toBuffer('image/png'))
})

test('feather extends outside the core and continuous paths do not depend on event density', () => {
  function draw(step) {
    const surface = mask.createSurface({width:151,height:101})
    surface.beginStroke({x:30,y:50,radiusPx:20,featherPx:20,mode:'erase'})
    for(let x=30+step;x<=120;x+=step) surface.extendStroke({x,y:50})
    surface.extendStroke({x:120,y:50}); surface.endStroke()
    return surface.getCoverage()
  }
  const sparse=draw(90), dense=draw(1)
  assert.deepEqual(sparse,dense)
  assert.equal(sparse[91*151+60],255)
  assert(sparse[75*151+60]<255)
  assert(sparse[50*151+60]<200)
})

test('feather strokes accumulate smoothly and resampling keeps turns stable across event rates',()=>{
  const stateA={},stateB={}
  const sparse=brush.sampleStroke(stateA,0,0,80,0,20)
  const dense=[]
  for(let x=0;x<80;x++)dense.push(...brush.sampleStroke(stateB,x,0,x+1,0,20))
  assert.equal(sparse.length,dense.length)
  sparse.forEach((p,i)=>assert(Math.abs(p.x-dense[i].x)<1e-8))
  const surface=mask.createSurface({width:101,height:101})
  function dab(){surface.beginStroke({x:50.5,y:50.5,radiusPx:20,featherPx:20,mode:'erase'});surface.endStroke();return surface.getCoverage()[50*101+80]}
  const first=dab(),second=dab()
  assert(first>120 && first<135 && second<first && second>55)
})

test('production image-mask brush gives matching curved strokes at different event densities', {skip:!process.env.NOVAFLOW_CANVAS},()=>{
  const {createCanvas}=require(process.env.NOVAFLOW_CANVAS)
  const source=fs.readFileSync(path.join(__dirname,'../../renderer/spine-split-runtime.js'),'utf8')
  const begin=source.indexOf('  function maskEditorStrokeStampPoints(')
  const end=source.indexOf('  function queueMaskEditorStrokePoint(',begin)
  const sandbox={window:{NovaFlowSoftBrush:brush},state:{maskEditor:{mode:'erase'}},maskBrushMetrics:()=>({radius:20,coreRadius:0,feather:20}),unionPaintBounds:(a,b)=>a?{left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)}:b}
  vm.createContext(sandbox);vm.runInContext(source.slice(begin,end),sandbox)
  function draw(density){
    const canvas=createCanvas(150,150),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,150,150)
    const session={width:150,height:150,maskCanvas:canvas,lastPoint:null}
    const vertices=[{x:25,y:30},{x:110,y:30},{x:110,y:110},{x:25,y:110},{x:25,y:30}]
    const points=[vertices[0]]
    for(let i=1;i<vertices.length;i++)for(let k=1;k<=density;k++)points.push({x:vertices[i-1].x+(vertices[i].x-vertices[i-1].x)*k/density,y:vertices[i-1].y+(vertices[i].y-vertices[i-1].y)*k/density})
    for(const point of points)sandbox.paintMaskEditorStampBatch(session,sandbox.maskEditorStrokeStampPoints(session,[point]))
    return ctx.getImageData(0,0,150,150).data
  }
  const slow=draw(50),fast=draw(1)
  let maxDifference=0
  for(let i=0;i<slow.length;i++)maxDifference=Math.max(maxDifference,Math.abs(slow[i]-fast[i]))
  assert(maxDifference<=1,'event-rate dependent opacity: '+maxDifference)
})

test('shrinking the core preserves the independently specified feather width',()=>{
  for (const core of [5,20,40]) {
    assert.equal(brush.strength(core,core,core+30),1)
    assert.equal(brush.strength(core+15,core,core+30),0.5)
    assert.equal(brush.strength(core+30,core,core+30),0)
  }
})

test('image-mask cursor and painting keep independent screen widths at every zoom', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/spine-split-runtime.js'), 'utf8')
  const begin = source.indexOf('  function maskBrushMetrics('), end = source.indexOf('  function canvasOfSize(', begin)
  for (const zoom of [0.1, 1, 5.58]) for (const diameter of [1, 34, 150]) {
    const sandbox = {state: {maskEditor: {brushSize: diameter, feather: 18}}, activeMaskToolCanvas: () => ({width: 200}),
      visibleCanvasRect: () => ({width: 200 * zoom}), normalizeMaskFeatherValue: value => value}
    vm.createContext(sandbox); vm.runInContext(source.slice(begin, end), sandbox)
    const metrics = sandbox.maskBrushMetrics()
    assert(Math.abs(metrics.coreRadius * zoom * 2 - diameter) < 1e-8)
    assert(Math.abs(metrics.feather * zoom - 18) < 1e-8)
  }
})

test('a heavily zoomed-out brush uses a bounded stamp raster', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  const canvas = createCanvas(30, 30), ctx = canvas.getContext('2d')
  const dimensions = [], draw = ctx.drawImage.bind(ctx)
  ctx.drawImage = function (stamp, ...args) { dimensions.push([stamp.width, stamp.height]); return draw(stamp, ...args) }
  brush.paintCanvas(ctx, 15.5, 15.5, 15.5, 15.5, 15000, 30000, true)
  assert(dimensions.every(([width, height]) => width <= 1027 && height <= 1027))
  assert.equal(ctx.getImageData(15, 15, 1, 1).data[3], 255)
})

test('real cutout, image-mask and video-mask pixels share a continuous core/feather join', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/spine-split-runtime.js'), 'utf8')
  const begin = source.indexOf('  function paintMaskEditorStampBatch(')
  const end = source.indexOf('  function queueMaskEditorStrokePoint(', begin)
  for (const core of [4, 20, 50]) for (const feather of [0, 8, 32]) for (const restore of [false, true]) {
    const size = 201, center = 100.5
    const cutout = createCanvas(size, size), image = createCanvas(size, size)
    const ctx = cutout.getContext('2d'), imageCtx = image.getContext('2d')
    imageCtx.fillStyle = restore ? 'black' : 'white'; imageCtx.fillRect(0, 0, size, size)
    if (!restore) { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, size, size) }
    ctx.globalCompositeOperation = restore ? 'source-over' : 'destination-out'
    brush.paintCanvas(ctx, center, center, center, center, core, feather, true)
    const sandbox = {window: {NovaFlowSoftBrush: brush}, state: {maskEditor: {mode: restore ? 'restore' : 'erase'}},
      maskBrushMetrics: () => ({coreRadius: core, feather, radius: core + feather}), unionPaintBounds: (a, b) => b}
    vm.createContext(sandbox); vm.runInContext(source.slice(begin, end), sandbox)
    sandbox.paintMaskEditorStampBatch({maskCanvas: image, width: size, height: size}, [{x: center, y: center}])
    const surface = mask.createSurface({width: size, height: size, coverage: new Uint8Array(size * size).fill(restore ? 0 : 255)})
    surface.beginStroke({x: center, y: center, radiusPx: core, featherPx: feather, mode: restore ? 'restore' : 'erase'}); surface.endStroke()
    const a = ctx.getImageData(0, 0, size, size).data, b = imageCtx.getImageData(0, 0, size, size).data, c = surface.getCoverage()
    for (let d = 0; d <= core + feather + 1; d++) {
      const i = 100 * size + 100 + d
      const expected = Math.round(255 * (restore ? brush.strength(d, core, core + feather) : 1 - brush.strength(d, core, core + feather)))
      for (const value of [a[i * 4 + 3], b[i * 4], c[i]]) assert(Math.abs(value - expected) <= 1, `core ${core}, feather ${feather}, restore ${restore}, distance ${d}: ${value} vs ${expected}`)
    }
    if (feather >= 8) {
      const at = d => a[((100 * size + 100 + d) * 4) + 3]
      assert(Math.abs(at(core) - at(core + 1)) < 5, 'no sudden strength drop at the solid-core boundary')
    }
  }
})

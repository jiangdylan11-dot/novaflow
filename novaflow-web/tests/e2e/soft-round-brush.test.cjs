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

test('a dragged stroke keeps exactly the same transverse feather as a click, including retracing', () => {
  const click = mask.createSurface({width: 401, height: 241})
  click.beginStroke({mode:'erase', x:200.5,y:120.5,radiusPx:10,featherPx:60}); click.endStroke()
  const line = mask.createSurface({width: 401, height: 241})
  line.beginStroke({mode:'erase',x:50.5,y:120.5,radiusPx:10,featherPx:60})
  line.extendStroke({x:350.5,y:120.5})
  for (let d=0;d<=71;d++) assert.equal(line.sample(200,120+d),click.sample(200,120+d),`drag/click feather differs at ${d}px`)
  const before = line.getCoverage()
  line.extendStroke({x:50.5,y:120.5})
  assert.deepEqual(line.getCoverage(),before,'retracing within the same pointer stroke must not harden its feather')
  line.endStroke()
})

test('canvas cutout and production image-mask strokes keep the click feather along a long drag', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/spine-split-runtime.js'), 'utf8')
  const begin = source.indexOf('  function maskEditorStrokeStampPoints('), end = source.indexOf('  function queueMaskEditorStrokePoint(', begin)
  const sandbox = {window:{NovaFlowSoftBrush:brush},state:{maskEditor:{mode:'erase'}},maskBrushMetrics:()=>({coreRadius:10,feather:60,radius:70}),unionPaintBounds:(a,b)=>b}
  vm.createContext(sandbox); vm.runInContext(source.slice(begin,end), sandbox)
  const cutout = createCanvas(401,241), maskCanvas = createCanvas(401,241)
  const ctx = cutout.getContext('2d'), maskCtx = maskCanvas.getContext('2d')
  ctx.fillStyle = 'white'; ctx.fillRect(0,0,401,241); ctx.globalCompositeOperation = 'destination-out'
  maskCtx.fillStyle = 'white'; maskCtx.fillRect(0,0,401,241)
  brush.paintCanvas(ctx,50.5,120.5,50.5,120.5,10,60,true)
  brush.paintCanvas(ctx,50.5,120.5,350.5,120.5,10,60,true)
  const session = {width:401,height:241,maskCanvas,lastPoint:null}
  const segments = sandbox.maskEditorStrokeStampPoints(session,[{x:50.5,y:120.5},{x:350.5,y:120.5}])
  sandbox.paintMaskEditorStampBatch(session,segments)
  for (let d=0;d<=71;d++) {
    const expected = 255 - brush.alphaByte(brush.strength(d,10,70))
    assert.equal(ctx.getImageData(200,120+d,1,1).data[3],expected)
    assert.equal(maskCtx.getImageData(200,120+d,1,1).data[0],expected)
  }
})

test('a stable pointer id ignores duplicate stationary events but a new click builds opacity', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  const ctx = createCanvas(101,101).getContext('2d')
  const dab = id => brush.paintCanvas(ctx,50.5,50.5,50.5,50.5,10,30,true,id)
  dab('stroke-1'); const first = ctx.getImageData(0,0,101,101).data
  for(let i=0;i<10;i++) dab('stroke-1')
  assert.deepEqual(ctx.getImageData(0,0,101,101).data,first)
  dab('stroke-2')
  assert(ctx.getImageData(75,50,1,1).data[3] > first[(50*101+75)*4+3])
})

test('three separate overlapping strokes never brighten erased green pixels and preserve undo', () => {
  const surface = mask.createSurface({width:301,height:301})
  let previous = surface.getCoverage()
  for (const [x,y] of [[150.5,100.5],[105.5,175.5],[195.5,175.5]]) {
    surface.beginStroke({mode:'erase',x,y,radiusPx:5,featherPx:85}); surface.endStroke()
    const next = surface.getCoverage()
    for (let i=0;i<next.length;i++) assert(next[i] <= previous[i], 'overlap must only remove opacity')
    surface.undo(); assert.deepEqual(surface.getCoverage(),previous)
    surface.redo(); assert.deepEqual(surface.getCoverage(),next)
    previous = next
  }
  assert(surface.sample(150,150) < 128, 'the shared intersection blends the three feathers')
})

test('feather joins the solid core and untouched outside with no slope kink', () => {
  const epsilon = 0.0001
  assert((1 - brush.falloff(1 - epsilon)) / epsilon < 0.001, 'the core-to-feather slope must start at zero')
  assert(brush.falloff(epsilon) / epsilon < 0.001, 'the feather-to-outside slope must end at zero')
  assert(brush.falloff(0.1) >= 0.02, 'the outer tenth must retain visible strength')
})

test('green pixels stay within the source/background colour range through mask preview and export', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  const size = 361, sourceCanvas = createCanvas(size, size), maskCanvas = createCanvas(size, size)
  const sourceCtx = sourceCanvas.getContext('2d'), maskCtx = maskCanvas.getContext('2d')
  sourceCtx.fillStyle = '#019b0b'; sourceCtx.fillRect(0, 0, size, size)
  maskCtx.fillStyle = 'white'; maskCtx.fillRect(0, 0, size, size)
  brush.paintStamp(maskCtx, 180.5, 180.5, 68, 100, false)
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/spine-split-runtime.js'), 'utf8')
  const begin = source.indexOf('  function maskedLayerCanvas('), end = source.indexOf('  function maskEditorPoint(', begin)
  const sandbox = {canvasOfSize: createCanvas}; vm.createContext(sandbox); vm.runInContext(source.slice(begin, end), sandbox)
  const masked = sandbox.maskedLayerCanvas({width: size, height: size, sourceCanvas, maskCanvas})
  const displayed = createCanvas(size, size), ctx = displayed.getContext('2d')
  ctx.fillStyle = '#232323'; ctx.fillRect(0, 0, size, size); ctx.drawImage(masked, 0, 0)
  const pixels = ctx.getImageData(0, 0, size, size).data
  for (let i = 0; i < pixels.length; i += 4) {
    assert(pixels[i] >= 1 && pixels[i] <= 35, 'no extra red/white edge')
    assert(pixels[i + 1] >= 35 && pixels[i + 1] <= 155, 'no brightness overshoot at the feather edge')
    assert(pixels[i + 2] >= 11 && pixels[i + 2] <= 35, 'no extra blue/white edge')
  }
  assert.deepEqual(Array.from(sourceCtx.getImageData(180, 180, 1, 1).data), [1, 155, 11, 255])
})

test('soft round falloff is monotonic with smooth endpoints across the full feather', () => {
  let previous = 1
  for (let distance = 0; distance <= 40; distance += 0.1) {
    const value = brush.strength(distance, 0, 40)
    assert(value <= previous + 1e-12)
    assert(value >= 0 && value <= 1)
    previous = value
  }
  assert.equal(brush.strength(20, 0, 40), 0.5)
  assert(brush.strength(0.1, 0, 40) > 0.9999)
  assert(brush.strength(39.9, 0, 40) > 0 && brush.strength(39.9, 0, 40) < 0.0001)
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

test('the full feather width remains visible instead of flattening into a transparent outer ring', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  // Match the reported geometry: 68 px solid radius and a separate 100 px feather.
  const canvas = createCanvas(361, 361), ctx = canvas.getContext('2d')
  brush.paintCanvas(ctx, 180.5, 180.5, 180.5, 180.5, 68, 100, true)
  const alpha = distance => ctx.getImageData(180 + distance, 180, 1, 1).data[3]
  for (const [offset, expected] of [[0,255], [10,248], [25,215], [50,128], [75,40], [90,7], [95,2], [99,1], [100,0]]) {
    assert(Math.abs(alpha(68 + offset) - expected) <= 1, `feather ${offset}%: ${alpha(68 + offset)} vs ${expected}`)
  }
  assert(alpha(167) > 0, 'the final interior pixel must still have an effect')
  for (let distance = 69; distance < 168; distance++) assert(alpha(distance) > 0, 'no empty annulus before the boundary')
  assert.equal(alpha(168), 0, 'only the outside boundary reaches zero')
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

test('a heavily zoomed-out stroke only allocates bounded tiles inside the image', {skip: !process.env.NOVAFLOW_CANVAS}, () => {
  const {createCanvas} = require(process.env.NOVAFLOW_CANVAS)
  const canvas = createCanvas(30, 30), ctx = canvas.getContext('2d')
  const dimensions = [], read = ctx.getImageData.bind(ctx)
  ctx.getImageData = function (x, y, width, height) { dimensions.push([width, height]); return read(x, y, width, height) }
  brush.paintCanvas(ctx, 15.5, 15.5, 15.5, 15.5, 15000, 30000, true)
  assert(dimensions.length > 0)
  assert(dimensions.every(([width, height]) => width <= 64 && height <= 64))
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
      assert(Math.abs(at(core) - at(core + 1)) <= Math.ceil(255 / feather) + 1, 'the join changes by one pixel of the same feather ramp, without an extra strength drop')
    }
  }
})

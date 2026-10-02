const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
function load(file) {
  const sandbox = {module: {exports: {}}}; sandbox.globalThis = sandbox
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
  surface.beginStroke({x:50, y:50, radiusPx:20, featherPx:20, mode:'erase'})
  surface.endStroke()
  const coverage = surface.getCoverage()
  const at = (x,y) => coverage[y * 101 + x]
  for (let d = 0; d <= 40; d++) {
    assert.equal(at(50+d,50), at(50,50+d))
    assert(Math.abs(at(50+d,50) - Math.round(255*(1-0.16*brush.strength(d,20,40)))) <= 1)
  }
  assert.equal(at(65,70), at(75,50)) // identical Euclidean radius, diagonal versus axis
  surface.undo()
  assert(surface.getCoverage().every(value => value === 255))
  surface.redo()
  surface.beginStroke({x:50,y:50,radiusPx:20,featherPx:20,mode:'restore'})
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
  assert.equal(alpha(50,50),41)
  assert.equal(alpha(90,50),0)
  assert.equal(alpha(65,70),alpha(75,50))
  assert(Math.abs(alpha(70,50)-20)<=1)
  brush.paintCanvas(ctx,50.5,50.5,50.5,50.5,20,20,true)
  assert(ctx.getImageData(70,50,1,1).data[3]>20)
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

test('soft strokes add opacity gently and resampling keeps turns stable across event rates',()=>{
  const stateA={},stateB={}
  const sparse=brush.sampleStroke(stateA,0,0,80,0,20)
  const dense=[]
  for(let x=0;x<80;x++)dense.push(...brush.sampleStroke(stateB,x,0,x+1,0,20))
  assert.equal(sparse.length,dense.length)
  sparse.forEach((p,i)=>assert(Math.abs(p.x-dense[i].x)<1e-8))
  const surface=mask.createSurface({width:101,height:101})
  function dab(){surface.beginStroke({x:50,y:50,radiusPx:20,featherPx:20,mode:'erase'});surface.endStroke();return surface.getCoverage()[50*101+50]}
  const first=dab(),second=dab()
  assert(first>200 && second<first && second>150)
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

test('soft centre continuously fades instead of leaving a solid disk',()=>{
  for (const core of [5,20,40]) {
    assert(brush.strength(core,core,core+30)<1)
    assert(brush.strength(core+15,core,core+30)<brush.strength(core,core,core+30))
    assert.equal(brush.strength(core+30,core,core+30),0)
  }
})

test('tiny brush with excessive feather remains bounded and has no solid core',()=>{
  const surface=mask.createSurface({width:101,height:101})
  surface.beginStroke({x:50,y:50,radiusPx:5,featherPx:100,mode:'erase'});surface.endStroke()
  const values=surface.getCoverage(),at=d=>values[50*101+50+d]
  assert(at(0)<at(2));assert(at(2)<at(5));assert.equal(at(11),255)
})

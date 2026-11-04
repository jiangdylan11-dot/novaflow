'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
require(path.resolve(__dirname,'../../renderer/spine-structure.ops.js'))
const Ops=globalThis.NovaFlowSpineStructureOps
function fixture(){
 const entries=Object.fromEntries(Array.from({length:10},(_,i)=>['image'+i,{path:'asset'+i,width:20+i,height:40,x:i}]))
 return {skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'child',parent:'root'}],slots:[{name:'A',bone:'root',attachment:'image0'},{name:'B',bone:'child',attachment:'other'}],
  skins:[{name:'default',attachments:{A:entries,B:{other:{path:'other-asset',width:15,height:12}}}},{name:'first',attachments:{}},{name:'chosen',attachments:{}}],
  animations:{idle:{slots:{A:{attachment:[{time:0,name:'image0'}]},B:{attachment:[{time:0,name:'other'}]}}}}}
}
const skin=(json,name)=>json.skins.find(s=>s.name===name)
const att=(json,sk,slot,name)=>skin(json,sk)?.attachments?.[slot]?.[name]
test('ten selected attachments move into the current skin only; attachment references stay',()=>{
 const src=fixture(),before=JSON.stringify(src),items=Array.from({length:10},(_,i)=>({skin:'default',slot:'A',name:'image'+i}))
 const out=Ops.convertToPlaceholders(src,items,'chosen').json
 assert.equal(JSON.stringify(src),before,'input must remain unmodified')
 for(const a of items){assert.equal(att(out,'default','A',a.name),undefined);assert.deepEqual(att(out,'chosen','A',a.name),att(src,'default','A',a.name));assert.equal(att(out,'first','A',a.name),undefined)}
 assert.equal(out.slots.find(s=>s.name==='A').attachment,'image0');assert.deepEqual(out.animations,src.animations)
})
test('multi-slot selection keeps each slot binding and selected skin receives originals',()=>{
 const src=fixture(),items=[{skin:'default',slot:'A',name:'image0'},{skin:'default',slot:'B',name:'other'}]
 const out=Ops.convertToPlaceholders(src,items,'chosen').json
 assert.deepEqual(att(out,'chosen','A','image0'),att(src,'default','A','image0'));assert.deepEqual(att(out,'chosen','B','other'),att(src,'default','B','other'))
 assert.deepEqual(out.slots,src.slots);assert.deepEqual(out.animations,src.animations)
})
test('mesh links and deform tracks follow selected owner without dropping payload',()=>{
 const src=fixture();skin(src,'default').attachments.A.mesh={type:'mesh',path:'mesh-src',uvs:[0,0,1,1],triangles:[0,1,0],vertices:[0,0,1,1],hull:2,width:8,height:8};skin(src,'default').attachments.A.link={type:'linkedmesh',parent:'mesh',path:'link-src'}
 src.animations.idle.deform={default:{A:{mesh:[{time:0,vertices:[1,2]}]}}}
 const out=Ops.convertToPlaceholders(src,[{skin:'default',slot:'A',name:'mesh'}],'chosen').json
 assert.equal(att(out,'chosen','A','mesh').path,'mesh-src');assert.equal(att(out,'default','A','link').skin,'chosen');assert.equal(att(out,'first','A','mesh'),undefined);assert.deepEqual(out.animations.idle.deform.chosen.A.mesh,[{time:0,vertices:[1,2]}])
})
test('conflicts, duplicate items, invalid slots, unsupported links and absent skin fail without partial mutation',()=>{
 for(const condition of ['conflict','duplicate','missing','link','no-skin']){
  const src=fixture();let items=[{skin:'default',slot:'A',name:'image0'},{skin:'default',slot:'B',name:'other'}]
  if(condition==='conflict')skin(src,'chosen').attachments.B={other:{path:'existing'}}
  if(condition==='duplicate')items=[items[0],items[0]]
  if(condition==='missing')items[1]={skin:'default',slot:'missing',name:'other'}
  if(condition==='link'){skin(src,'default').attachments.B.other={type:'linkedmesh',parent:'image0'}}
  if(condition==='no-skin')src.skins=src.skins.filter(s=>s.name==='default')
  const before=JSON.stringify(src);assert.throws(()=>Ops.convertToPlaceholders(src,items,'chosen'),condition);assert.equal(JSON.stringify(src),before,condition)
 }
})
test('a skin that already holds the name refuses the conversion and nothing is lost',()=>{
 const src=fixture();skin(src,'chosen').attachments.A={image0:{path:'two'}};const before=JSON.stringify(src)
 assert.throws(()=>Ops.convertToPlaceholder(src,'A','image0','chosen'));assert.equal(JSON.stringify(src),before)
})
test('single and batch both require an explicit non-default target and never fall back',()=>{
 const items=[{skin:'default',slot:'A',name:'image0'}]
 for(const target of [undefined,'','default','missing']){
  const src=fixture(), before=JSON.stringify(src)
  assert.throws(()=>Ops.convertToPlaceholders(src,items,target))
  assert.throws(()=>Ops.convertToPlaceholder(src,'A','image0',target))
  assert.equal(JSON.stringify(src),before)
 }
})
test('single conversion fills the current skin only, a later skin fills its own image',()=>{
 const src=fixture(), r=Ops.convertToPlaceholder(src,'A','image0','chosen')
 assert.equal(r.owner,'chosen');assert.deepEqual(att(r.json,'chosen','A','image0'),att(src,'default','A','image0'))
 assert.equal(att(r.json,'first','A','image0'),undefined);assert.equal(att(r.json,'default','A','image0'),undefined)
 assert.equal(Ops.isPlaceholder(r.json,'A','image0'),true)
 const filled=Ops.fillPlaceholder(r.json,'first','A','image0',{path:'first-art',width:5,height:6}).json
 assert.equal(att(filled,'first','A','image0').path,'first-art');assert.equal(att(filled,'chosen','A','image0').path,'asset0')
})

test('batch UI requires the active target skin and gives a selection hint',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),src=fs.readFileSync(path.join(__dirname,'../../renderer/spine-skeleton-editor.js'),'utf8').replace(/\r\n/g,'\n')
 const start=src.indexOf('  const hasPlaceholderTarget'),end=src.indexOf('  /** The picked image',start),part=src.slice(start,end)
 assert.ok(part.includes('function multiAttachmentBody'))
 const json=fixture(),state={json,skin:'default'},items=[{skin:'default',slot:'A',name:'image0'}]; let button
 const ctx={state,Ops,selectedAttachments:()=>items,skinOf:n=>skin(json,n),duplicateAttachments:()=>{},deleteSelection:()=>{},batchConvertToPlaceholders:()=>{},h:()=>({}),ibtn:()=>({}),btn:(label,fn,options)=>(button=options,{})}
 vm.runInNewContext(part+'\nmultiAttachmentBody()',ctx);assert.equal(button.disabled,true);assert.match(button.title,/先选择目标非 default 皮肤/)
 state.skin='chosen';vm.runInNewContext('multiAttachmentBody()',ctx);assert.equal(button.disabled,false)
 state.skin='missing';vm.runInNewContext('multiAttachmentBody()',ctx);assert.equal(button.disabled,true)
})
test('new skin activation uses the newly created skin as its active target',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),src=fs.readFileSync(path.join(__dirname,'../../renderer/spine-skeleton-editor.js'),'utf8').replace(/\r\n/g,'\n')
 const start=src.indexOf('  function newSkin()'),end=src.indexOf('  // ------------------------------------------------------------------ small widgets',start),part=src.slice(start,end)
 assert.ok(start>=0 && end>start)
 const state={json:fixture(),skin:'default'},ctx={state,Ops,setSkin:name=>{state.skin=name},edit:(_message,_operation,after)=>after({skin:'skin1'})}
 vm.runInNewContext(part+'\nnewSkin()',ctx);assert.equal(state.skin,'skin1')
})

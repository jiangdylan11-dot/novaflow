const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib')
require('../../renderer/spine-structure.ops.js');require('../../renderer/spine-sequence-atlas.js')
const Ops = globalThis.NovaFlowSpineStructureOps, A = globalThis.NovaFlowSequenceAtlas
const source = fs.readFileSync(path.resolve(__dirname,'../../renderer/spine-skeleton-editor.js'),'utf8').replace(/\r\n/g,'\n')
const fn = name => source.match(new RegExp('^  (?:async )?function '+name+'\\([^]*?^  \\}','m'))[0]
function project(name,color) { return { name, color, pma:false, offset:{x:color,y:0}, images:new Map(),atlasText:'', json:{skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:name+'Bone',parent:'root'}],slots:[{name:'art',bone:name+'Bone',attachment:'pic'}],skins:[{name:'default',attachments:{art:{pic:{path:'pic',width:2,height:2}}}}],animations:{[name+'Anim']:{}}} } }
function fixture() {
  const state=project('one.v1',200),other=project('two',50),projects=[{id:1,visible:false,exported:true},{id:2,snap:other,visible:true,exported:true}],files=new Map()
  const directory=(prefix='')=>({getDirectoryHandle:async n=>directory(prefix+n+'/'),getFileHandle:async n=>({createWritable:async()=>({write:async data=>files.set(prefix+n,data),close:async()=>{}})})})
  require('../../renderer/spine-audio.js');const AudioAssets=globalThis.NovaFlowSpineAudio;
  const c=vm.createContext({AudioAssets,state,projects,activeProject:0,Ops,window:{NovaFlowSequenceAtlas:A},status(){},renderTree(){},renderProps(){},
    projectName:i=>i===0?state.name:projects[i].snap.name,atlasSettings:()=>A.defaults,
    imageRgba:async(_name,_file,src)=>({width:2,height:2,rgba:Uint8Array.from(Array.from({length:4},()=>[src.color,0,0,255]).flat())}) })
  vm.runInContext(['setProjectExport','exportProjectName','selectedProjectEntries','mediaExportPlans','exportSelectedProjects','exportProject','exportImageNames'].map(fn).join('\n'),c)
  return {c,state,other,projects,files,export:()=>c.exportSelectedProjects({directory:directory(),mode:'atts',version:'3.8'})}
}
function firstRed(png) { const b=Buffer.from(png),parts=[];for(let i=8;i<b.length;){const n=b.readUInt32BE(i);if(b.subarray(i+4,i+8).toString()==='IDAT')parts.push(b.subarray(i+8,i+8+n));i+=n+12}const rows=zlib.inflateSync(Buffer.concat(parts)),w=b.readUInt32BE(16);for(let y=0;y<b.readUInt32BE(20);y++)for(let x=0;x<w;x++){const i=y*(w*4+1)+1+x*4;if(rows[i+3])return rows[i]} }
test('each checked project exports its own skeleton, animation and atlas under its exact project name',async()=>{
  const f=fixture(),before=JSON.stringify([f.state.json,f.other.json]);await f.export()
  assert(f.files.has('one.v1/one.v1.json'));assert(f.files.has('one.v1/one.v1.atlas'));assert(f.files.has('one.v1/one.v1.png'))
  const first=JSON.parse(f.files.get('one.v1/one.v1.json')),second=JSON.parse(f.files.get('two/two.json'))
  assert(first.bones.some(b=>b.name==='one.v1Bone'));assert(!first.bones.some(b=>b.name==='twoBone'));assert.deepEqual(Object.keys(second.animations),['twoAnim'])
  assert.match(f.files.get('one.v1/one.v1.atlas'),/^one\.v1\.png/)
  assert.equal(firstRed(f.files.get('one.v1/one.v1.png')),200);assert.equal(firstRed(f.files.get('two/two.png')),50)
  assert.equal(JSON.stringify([f.state.json,f.other.json]),before)
})
test('export flags are independent of visibility and exclude unchecked projects from both modes',async()=>{
  const f=fixture();f.c.setProjectExport(1,false);const p=f.c.mediaExportPlans('merged','combined')
  assert.equal(p[0].entries.length,1);assert.equal(p[0].entries[0].name,'one.v1')
  await f.export();assert(f.files.has('one.v1.json'));assert(![...f.files.keys()].some(n=>n.startsWith('two')))
})
test('independent media resets editor offsets; merged media keeps each checked project placement',()=>{
  const f=fixture(),independent=f.c.mediaExportPlans(),merged=f.c.mediaExportPlans('merged','combined')
  assert.equal(independent.length,2);assert.equal(independent[0].name,'one.v1');assert.equal(independent[0].entries[0].src.offset.x,0)
  assert.equal(merged.length,1);assert.equal(merged[0].entries[0].src.offset.x,200);assert.equal(merged[0].entries[1].src.offset.x,50)
})
test('duplicate project names are rejected without automatic renaming or overwriting',async()=>{
  const f=fixture();f.other.name='one.v1';await assert.rejects(f.export(),/同名/);assert.equal(f.files.size,0)
})
test('no selected projects is an explicit error instead of exporting the active project anyway',async()=>{
  const f=fixture();f.projects.forEach(p=>p.exported=false);await assert.rejects(f.export(),/勾选/);assert.equal(f.files.size,0)
})

test('audio resources export under each project alongside its skeleton with portable paths',async()=>{
 const f=fixture();f.state.audio=new Map([['voices/hit.wav','data:audio/wav;base64,AQID']]);
 f.state.json.events={hit:{audio:'voices/hit.wav'}};f.c.fetch=fetch;await f.export();
 assert.deepEqual([...f.files.get('one.v1/audio/voices/hit.wav')],[1,2,3]);
 const json=JSON.parse(f.files.get('one.v1/one.v1.json'));assert.equal(json.skeleton.audio,'audio/');assert.equal(json.events.hit.audio,'voices/hit.wav');
 assert(![...f.files.keys()].some(n=>n.startsWith('two/audio/')));
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const renderer=path.resolve(__dirname,'../../renderer');
require(path.join(renderer,'spine-audio.js'));const A=globalThis.NovaFlowSpineAudio;
require(path.join(renderer,'spine-structure.ops.js'));const O=globalThis.NovaFlowSpineStructureOps;
const ctx=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(renderer,'vendor/spine/spine-webgl-3.8.js'),'utf8')+';globalThis.spine=spine',ctx);const S=ctx.spine;
const j=()=>O.prepare({bones:[{name:'root',x:20,y:30}],slots:[{name:'hit',bone:'root'}],skins:[{name:'default',attachments:{}}],events:{impact:{audio:'hit.wav'}},animations:{idle:{}}});
test('bounding polygon keeps its own type, never clips, and replays deform keys in the real runtime',()=>{
 let json=O.createBoundingBox(j(),'hit',{vertices:[0,0,100,0,100,100,0,100]}).json;
 json=O.moveMeshVertices(json,'default','hit','boundingbox',[10,5,10,5,10,5,10,5]).json;
 json=O.keyDeform(json,'idle','default','hit','boundingbox',0,Array(8).fill(0)).json;
 json=O.keyDeform(json,'idle','default','hit','boundingbox',1,[20,10,40,10,40,30,20,30]).json;
 const data=new S.SkeletonJson({newBoundingBoxAttachment:(_,n)=>new S.BoundingBoxAttachment(n)}).readSkeletonData(json),sk=new S.Skeleton(data);
 sk.setToSetupPose();data.findAnimation('idle').apply(sk,0,1,false,null,1,S.MixBlend.setup,S.MixDirection.mixIn);sk.updateWorldTransform();
 const slot=sk.findSlot('hit'),a=slot.getAttachment(),v=new Float32Array(8);a.computeWorldVertices(slot,0,8,v,0,2);
 assert(a instanceof S.BoundingBoxAttachment);assert(!(a instanceof S.ClippingAttachment));assert(Array.from(v).every((x,i)=>Math.abs(x-[50,45,170,45,170,165,50,165][i])<.0001));
 assert.equal(O.exportable(json).skins[0].attachments.hit.boundingbox.type,'boundingbox');
 assert(json.animations.idle.deform.default.hit.boundingbox.length===2);
 json=O.setBoundingBox(json,'default','hit','boundingbox',{vertices:[1,1,101,1,101,101,1,101]}).json;
 assert.equal(json.animations.idle.deform.default.hit.boundingbox.length,2);
 json=O.setBoundingBox(json,'default','hit','boundingbox',{vertices:[0,0,100,0,50,100],end:'not-a-slot'}).json;
 assert(!json.skins[0].attachments.hit.boundingbox.end);assert(!json.animations.idle.deform?.default?.hit?.boundingbox);
});
test('audio event keys override values and preserve other events without duplicates',()=>{
 let json=O.keyEvent(j(),'idle','impact',.5,{volume:.35,balance:-.6,int:4}).json;
 json=O.keyEvent(json,'idle','impact',.5,{volume:.2}).json;
 const k=json.animations.idle.events;assert.equal(k.length,1);assert.deepEqual(k[0],{time:.5,name:'impact',volume:.2,balance:-.6,int:4});
 const data=new S.SkeletonJson({}).readSkeletonData(json),events=[];data.findAnimation('idle').apply(new S.Skeleton(data),0,.6,false,events,1,S.MixBlend.setup,S.MixDirection.mixIn);
 assert.equal(events[0].volume,.2);assert.equal(events[0].balance,-.6);assert.equal(events[0].data.audioPath,'hit.wav');
});
test('audio ticks fire each event once, including frame skips, loop boundaries and repeated loops',()=>{
 const e=[{name:'start'},{name:'hit',time:.5},{name:'end',time:1}];const n=x=>x.map(e=>e.name);
 assert.deepEqual(n(A.crossed(e,0,0,1,true,true)),['start']);
 assert.deepEqual(n(A.crossed(e,0,.6,1,true,false)),['hit']);
 assert.deepEqual(n(A.crossed(e,.6,.4,1,true,false)),['end','start']);
 assert.deepEqual(n(A.crossed(e,.6,1.1,1,true,false)),['end','start','hit']);
 assert.deepEqual(n(A.crossed(e,.6,2.4,1,true,false)),['end','start','hit','end','start','hit','end','start']);
 assert.deepEqual(n(A.crossed(e,.6,2.4,1,false,false)),['end']);
 assert.deepEqual(n(A.crossed(e,.5,.1,1,false,false)),[]);
});
test('audio matching keeps subdirectories and rejects external and escaping paths',()=>{
 const assets=new Map([['voices/hit.wav','data:audio/wav;base64,a']]);
 assert.equal(A.source(assets,'voices\\hit.wav'),assets.get('voices/hit.wav'));assert.equal(A.source(assets,'HIT.wav'),null);
 for(const p of ['../../secret.wav','https://example.com/a.wav','C:/local.wav','/absolute.wav'])assert.equal(A.path(p),'');
 assert.deepEqual(A.names({events:{hit:{audio:'voices/hit.wav'},missing:{audio:'missing.wav'}}},assets),['missing.wav','voices/hit.wav']);
});

test('a bounding-only project exports without requiring an unrelated image or atlas page',async()=>{
 require(path.join(renderer,'spine-sequence-atlas.js'));const A=globalThis.NovaFlowSequenceAtlas,files=new Map();
 const json=O.createBoundingBox(j(),'hit',{vertices:[0,0,100,0,50,100]}).json;
 const writer=A.createWriter({baseName:'bounds',packed:true,write:async(n,b)=>files.set(n,b)});
 const result=await writer.finish(json);assert.equal(result.pages,0);assert.equal(JSON.parse(files.get('bounds.json')).skins[0].attachments.hit.boundingbox.type,'boundingbox');
});

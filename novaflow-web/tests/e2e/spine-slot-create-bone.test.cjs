const test=require('node:test'),assert=require('node:assert/strict');
require('../../renderer/spine-structure.ops.js');
const Ops=globalThis.NovaFlowSpineStructureOps;
const parent={a:1.7,b:.35,c:.8,d:-.65,worldX:120,worldY:-70};
const sample=()=>({bones:[{name:'root'},{name:'arm',parent:'root',x:20},{name:'other',parent:'root'}],
  slots:[{name:'arm',bone:'arm',attachment:'picture'},{name:'other',bone:'root'}],
  skins:[{name:'default',attachments:{arm:{picture:{x:32,y:-19,rotation:25,scaleX:-1.1,width:90,height:48},mesh:{type:'mesh',uvs:[0,0,1,0,1,1],triangles:[0,1,2],vertices:[0,0,10,0,10,10],hull:3}}}},
    {name:'red',attachments:{arm:{picture:{x:40,y:12,width:90,height:48}}}}],
  animations:{walk:{bones:{arm:{rotate:[{angle:5},{time:1,angle:20}]}},deform:{}}}});
const near=(a,b)=>assert(Math.abs(a-b)<.03,`${a} != ${b}`);

test('one operation creates a zero-length child at the image centre and re-hangs the slot',()=>{
  const src=sample(),before=JSON.stringify(src),r=Ops.addBoneForSlot(src,'arm',{x:32,y:-19},{arm:parent});
  const bone=r.json.bones.at(-1);assert.deepEqual(bone,{name:'arm2',parent:'arm',x:32,y:-19});
  assert.equal(r.json.slots[0].bone,'arm2');assert.equal(r.bone,'arm2');
  const world=Ops.worldFromLocal(parent,bone),center=Ops.toWorld(parent,32,-19);
  near(world.worldX,center[0]);near(world.worldY,center[1]);
  assert.deepEqual(r.json.slots[1],src.slots[1]);assert.deepEqual(r.json.animations,src.animations);
  assert.equal(JSON.stringify(src),before,'immutable input for atomic undo');
});

test('regions and unweighted meshes across skins retain their world positions',()=>{
  const src=sample(),r=Ops.addBoneForSlot(src,'arm',{x:32,y:-19},{arm:parent});
  const world=Ops.worldFromLocal(parent,r.json.bones.at(-1));
  for(let i=0;i<src.skins.length;i++) for(const [key,a]of Object.entries(src.skins[i].attachments.arm)){
    const b=r.json.skins[i].attachments.arm[key];
    if(a.vertices){for(let j=0;j<a.vertices.length;j+=2){const p=Ops.toWorld(parent,a.vertices[j],a.vertices[j+1]),q=Ops.toWorld(world,b.vertices[j],b.vertices[j+1]);near(p[0],q[0]);near(p[1],q[1]);}}
    else {const p=Ops.toWorld(parent,a.x,a.y),q=Ops.toWorld(world,b.x,b.y);near(p[0],q[0]);near(p[1],q[1]);assert.equal(a.rotation||0,b.rotation||0);assert.equal(a.scaleX||1,b.scaleX||1);}
  }
});

test('appending the bone preserves imported weights, indices and deforms',()=>{
  const src=sample();const mesh=src.skins[0].attachments.arm.mesh;
  mesh.vertices=[1,1,0,0,1, 1,2,10,0,1, 1,1,10,10,1];
  src.animations.walk.deform={default:{arm:{mesh:[{time:0,vertices:[1,2,3,4,5,6]}]}}};
  const r=Ops.addBoneForSlot(src,'arm',{x:8,y:9},{arm:parent});
  assert.deepEqual(r.json.skins[0].attachments.arm.mesh,mesh);
  assert.deepEqual(r.json.animations,src.animations);assert.deepEqual(r.json.bones.slice(0,3),src.bones);
});

test('empty or singular centres cannot partially mutate the project',()=>{
  const src=sample(),before=JSON.stringify(src);
  for(const center of [null,{x:NaN,y:1}])assert.throws(()=>Ops.addBoneForSlot(src,'arm',center,{arm:parent}));
  assert.throws(()=>Ops.addBoneForSlot(src,'arm',{x:1,y:1},{arm:{...parent,a:0,b:0}}));
  assert.equal(JSON.stringify(src),before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../renderer/spine-structure.ops.js',import.meta.url),'utf8');
const sandbox={console};sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);vm.runInContext(source,sandbox);
const Ops=Object.values(sandbox).find(v=>v&&typeof v.mergeIntoPlaceholder==='function');
const plain=v=>JSON.parse(JSON.stringify(v));

const base=()=>({bones:[{name:'root'}],slots:[{name:'card',bone:'root',attachment:'draw_b_00'}],
  skins:[{name:'default',attachments:{card:{draw_b_00:{path:'JPG/draw_b_00'},draw_b_01:{path:'JPG/draw_b_01'},draw_b_02:{path:'JPG/draw_b_02'}}}},{name:'s1',attachments:{}},{name:'s2',attachments:{}}],animations:{}});
const items=[0,1,2].map(i=>({slot:'card',name:'draw_b_0'+i}));

test('plain images become one placeholder with one image per skin, creating missing skins',()=>{
  const r=Ops.mergeIntoPlaceholder(base(),items),skin=n=>plain(r.json.skins.find(s=>s.name===n));
  assert.equal(r.placeholder,'draw_b');
  assert.deepEqual(plain(Ops.placeholderList(r.json,'card')).map(p=>p.name),['draw_b']);
  assert.equal(skin('s1').attachments.card.draw_b.path,'JPG/draw_b_01');
  assert.equal(skin('s2').attachments.card.draw_b.path,'JPG/draw_b_02');
  assert.equal(r.created.length,1);assert.equal(skin(r.created[0]).attachments.card.draw_b.path,'JPG/draw_b_00');
  assert.equal(skin('default').attachments.card,undefined);
  assert.equal(r.json.slots[0].attachment,'draw_b');
});

test('per-image placeholders copied into every skin are repaired into one',()=>{
  const j=base();const def=j.skins[0].attachments.card;j.skins[0].attachments={};
  for(const s of j.skins.slice(1))s.attachments.card=plain(def);
  const r=Ops.mergeIntoPlaceholder(j,items);
  assert.deepEqual(plain(Ops.placeholderList(r.json,'card')).map(p=>p.name),['draw_b']);
  const paths=plain(r.json.skins.filter(s=>s.attachments.card).map(s=>s.attachments.card.draw_b.path)).sort();
  assert.deepEqual(paths,['JPG/draw_b_00','JPG/draw_b_01','JPG/draw_b_02']);
});

test('a skin holding only its own image keeps it, and animation keys follow',()=>{
  const j=base();j.skins[0].attachments={};j.skins[1].attachments.card={draw_b_02:{path:'JPG/draw_b_02'}};j.skins[2].attachments.card={draw_b_01:{path:'JPG/draw_b_01'}};
  j.animations.a={slots:{card:{attachment:[{time:0,name:'draw_b_01'}]}}};
  const r=Ops.mergeIntoPlaceholder(j,[{slot:'card',name:'draw_b_01'},{slot:'card',name:'draw_b_02'}]);
  assert.equal(r.json.skins.find(s=>s.name==='s1').attachments.card.draw_b.path,'JPG/draw_b_02');
  assert.equal(r.json.skins.find(s=>s.name==='s2').attachments.card.draw_b.path,'JPG/draw_b_01');
  assert.equal(r.json.animations.a.slots.card.attachment[0].name,'draw_b');
});

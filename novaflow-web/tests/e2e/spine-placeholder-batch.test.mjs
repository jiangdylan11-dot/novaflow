import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../renderer/spine-structure.ops.js',import.meta.url),'utf8');
const sandbox={console};sandbox.window=sandbox;sandbox.globalThis=sandbox;
vm.createContext(sandbox);vm.runInContext(source,sandbox);
const Ops=Object.values(sandbox).find(v=>v&&typeof v.convertToPlaceholders==='function');
const plain=v=>JSON.parse(JSON.stringify(v));

const base=()=>({bones:[{name:'root'}],slots:[{name:'arm',bone:'root',attachment:'arm_l'}],
  skins:[{name:'default',attachments:{arm:{arm_l:{path:'e/arm_l'},arm_r:{path:'e/arm_r'},body:{path:'e/body'}}}},{name:'skin1',attachments:{}},{name:'skin2',attachments:{}}]});
const items=['arm_l','arm_r','body'].map(name=>({slot:'arm',name,skin:'default'}));

test('each selected attachment becomes its own placeholder in the current skin only',()=>{
  const r=Ops.convertToPlaceholders(base(),items,'skin1'),json=plain(r.json);
  assert.deepEqual(json.skins.map(s=>s.name),['default','skin1','skin2']);
  assert.deepEqual(plain(Ops.placeholderList(r.json,'arm')).map(p=>p.name).sort(),['arm_l','arm_r','body']);
  assert.deepEqual(Object.keys(json.skins[1].attachments.arm).sort(),['arm_l','arm_r','body']);
  assert.equal(json.skins[2].attachments.arm,undefined);
  assert.equal(json.skins[0].attachments.arm,undefined);
});

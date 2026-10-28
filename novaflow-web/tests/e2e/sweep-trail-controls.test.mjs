import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
const sandbox = vm.createContext({});
for (const name of ['sweep-light.core.js','aifx-template-maker.core.js']) vm.runInContext(source(name), sandbox);
const FX = sandbox.NovaFlowFxMaker;
const legacy = ['edge-meteor','edge-twin','edge-meet','edge-counter'];
const added = ['edge-stardust','edge-firecomet','edge-bolt','edge-wideband','edge-innerflow','edge-diagonal'];
const project = id => { const p=FX.defaultProject();p.effect=id;p.params=FX.effectDefaults(id);return p; };
const energy = data => { let n=0;for(let i=0;i<data.length;i+=4)n+=data[i]+data[i+1]+data[i+2];return n; };

test('ten contour effects expose a working tail length; independent detail controls remain', () => {
  for(const id of [...legacy,...added]) {
    const effect=FX.effectOf(id),controls=effect.params.filter(p=>p.label==='拖尾长度');
    assert.equal(controls.length,1,id);
    assert.equal(controls[0].min,0);assert.equal(controls[0].max,5);
    if(added.includes(id)) assert(effect.params.some(p=>p.key==='extra'),id+' retains its detail control');
    const p=project(id),key=controls[0].key;
    const frames=value=>{p.params[key]=value;const ctx=FX.prepare(p,.25);return [3,13,27].map(i=>FX.renderFrame(ctx,i));};
    const short=frames(0),long=frames(3);
    assert(long.some((data,k)=>energy(data)>energy(short[k])*1.15),id+' visibly longer tail');
    assert(short.every(data=>energy(data)>0),id+' retains its head at zero');
    // The sweep itself wraps exactly; the maker can additionally fade the
    // opening of 分流汇合, so compare its underlying loop before that fade.
    p.params[key]=3;const ctx=FX.prepare(p,.25).sweep,L=sandbox.NovaFlowSweepLight;
    const a=L.renderSweepFrame(ctx.ctx,0,ctx.P).data,b=L.renderSweepFrame(ctx.ctx,1,ctx.P).data;
    assert(a.every((v,i)=>v===b[i]),id+' loop seam');
  }
});

test('old project defaults and unrelated contour effects render exactly as before', () => {
  const expected=JSON.parse(readFileSync(new URL('../fixtures/sweep-trail-defaults.json',import.meta.url),'utf8'));
  for(const [id,hashes] of Object.entries(expected)) {
    const p=project(id);delete p.params.trail;
    const ctx=FX.prepare(p,.25);
    assert.deepEqual([3,13,27].map(i=>createHash('sha256').update(FX.renderFrame(ctx,i)).digest('hex')),hashes,id);
  }
});

test('resource names keep Chinese and punctuation; invalid paths are rejected before rendering', () => {
  assert.equal(FX.resourceOutputName({resourceName:'星尘 拖尾-A_01'},'auto'),'星尘 拖尾-A_01');
  assert.equal(FX.resourceOutputName({resourceName:''},'星尘拖尾'),'星尘拖尾');
  for(const name of ['../escape','a/b','a\\b','NUL','room.','x'.repeat(121)]) assert.throws(()=>FX.resourceOutputName({resourceName:name},'auto'));
});

test('slice folders and prefixes preserve names and number only actual collisions', () => {
  const text=source('spine-skeleton-editor.js');
  const func=text.slice(text.indexOf('  function sweepFolderFor('),text.indexOf('  const sweepDataUrl'));
  const names=new Set();sandbox.rt={atlas:{findRegion:name=>names.has(name)}};sandbox.window={NovaFlowFxMaker:FX};
  vm.runInContext(func,sandbox);
  const paths=(...args)=>JSON.parse(JSON.stringify(sandbox.sweepFolderFor(...args)));
  const first=paths('images/room','edge-stardust','星尘-A');
  assert.deepEqual(first,{folder:'images/sweep/星尘-A',prefix:'星尘-A'});
  names.add('images/sweep/another/another_01');
  assert.deepEqual(paths('images/room','edge-stardust','星尘-A'),first);
  names.add(first.folder+'/'+first.prefix+'_01');
  assert.deepEqual(paths('images/room','edge-stardust','星尘-A'),{folder:'images/sweep/星尘-A_2',prefix:'星尘-A_2'});
});

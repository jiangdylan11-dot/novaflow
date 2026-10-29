import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../renderer/art-generate-mode.tool.js', import.meta.url), 'utf8');
function fixture() {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('  const PROVIDER_OPTIONS'), source.indexOf('  const mountedControls')) +
    source.slice(source.indexOf('  function normalizeProvider'), source.indexOf('  function ownsSelect')) +
    source.slice(source.indexOf('  function syncDisabled'), source.indexOf('  function syncControlLayout')) +
    source.slice(source.indexOf('  function syncModelChoices'), source.indexOf('  function mount(options')), context);
  let mutations = 0;
  const attributes = new Map();
  const select = { children:[], value:'',
    replaceChildren(...nodes) { this.children=nodes; mutations++; },
    getAttribute(key) { return attributes.get(key) ?? null; },
    setAttribute(key,value) { attributes.set(key,value); mutations++; },
    removeAttribute(key) { attributes.delete(key); mutations++; }
  };
  const documentRef = {createElement:tag=>({tagName:tag.toUpperCase(),value:'',textContent:''})};
  return {select, mutations:()=>mutations,
    sync(provider='local',disabled=false) {context.syncModelChoices(select,documentRef,{provider});context.syncDisabled(select,disabled);}
  };
}

test('an observer-triggered control sync settles instead of replacing identical model choices again', () => {
  const f=fixture();
  f.sync();
  const original=f.select.children.slice();
  for(let i=0;i<100;i++) f.sync();
  assert.equal(f.mutations(),1, 'the initial mount is the only structural mutation');
  assert.deepEqual(f.select.children,original);
  f.sync('gpt');
  assert.equal(f.select.value,'gpt');
  assert.equal(f.mutations(),1,'changing the selection must preserve option nodes');
  f.sync('gpt',true);
  for(let i=0;i<100;i++) f.sync('gpt',true);
  assert.equal(f.mutations(),2,'the disabled state must also settle');
  f.sync('gpt',false);
  f.sync('gpt',false);
  assert.equal(f.mutations(),3);
});

test('a corrupted or stale model list is repaired once and keeps the requested provider', () => {
  const f=fixture();f.sync();
  f.select.children[0].textContent='stale';
  f.sync('gpt');
  assert.deepEqual(f.select.children.map(o=>[o.value,o.textContent]),[['local','Qwen（本地）'],['gpt','GPT Image 2.5']]);
  assert.equal(f.select.value,'gpt');
  const before=f.mutations();f.sync('gpt');assert.equal(f.mutations(),before);
});

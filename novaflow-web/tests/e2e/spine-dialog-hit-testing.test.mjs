import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');
test('owned modal buttons never fall through to covered art action or layer hit boxes',()=>{
 const functions=[...source.matchAll(/function (\w+ElementFromPoint)\(event\) \{[\s\S]*?\n  \}/g)].filter(match=>match[0].includes('[data-novaflow-pose-reference="1"]'));
 assert.equal(functions.length,6);
 for(const match of functions){
  class Element {closest(selector){assert.ok(selector.includes('[role="dialog"][aria-modal="true"]'));return {};}}
  const result=vm.runInNewContext(match[0]+`;${match[1]}({target:new Element(),clientX:100,clientY:100})`,{Element,isMountedCardVisible:()=>{throw Error('covered workspace must not be queried');}});
  assert.equal(result,null,match[1]);
 }
});

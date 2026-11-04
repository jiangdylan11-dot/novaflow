import assert from 'node:assert/strict';
import {join} from 'node:path';
import test from 'node:test';
import {foartRuntimeJsonPath,foartRuntimeRoot} from '../worker/src/runtime-location.mjs';

const programData='C:/ProgramData';
const current=join(programData,'Foart','AI-Runtime'),legacy=join(programData,'NovaFlow','AI-Runtime');
const having=(...roots)=>path=>roots.some(root=>path===join(root,'runtime.json'));

test('the fixed Foart folder wins',()=>{
  assert.equal(foartRuntimeRoot('AI-Runtime',{programData,exists:having(current,legacy)}),current);
});

test('an environment not upgraded yet is still found in the old folder',()=>{
  assert.equal(foartRuntimeRoot('AI-Runtime',{programData,exists:having(legacy)}),legacy);
  assert.equal(foartRuntimeJsonPath({programData,exists:having(legacy)}),join(legacy,'runtime.json'));
});

test('a machine with no environment gets the fixed folder',()=>{
  assert.equal(foartRuntimeRoot('AI-Runtime',{programData,exists:having()}),current);
});

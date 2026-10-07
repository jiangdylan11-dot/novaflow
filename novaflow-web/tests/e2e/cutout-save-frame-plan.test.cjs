const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('novaflow-web/renderer/assets/index-BbIa-2NM.js', 'utf8');
const save = source.slice(source.indexOf('ni=async n=>'));
const fps = save.match(/h=(Z\(n\?\.finalAsset.*?),g=N&&V/)[1];
const plan = save.match(/nfSavedFrameTimes=.*?(?=,N=`)/)[0];
test('AI save keeps all 22 processed frames despite a stale 30 FPS source', () => {
  const times = Array.from({length:22}, (_,i)=>i/16);
  const context = {n:{finalAsset:true}, N:true,V:true,R:'ai',G:{current:{fps:16}},e:{sourceFps:30},w:30,l:30,Z:(v,a,b)=>Math.max(a,Math.min(b,v)),g:true,j:{times},v:false,_:1.375,u:false,d:0,f:0};
  const result = vm.runInNewContext(`const nfUseBoardPlan=false;const h=${fps};let ${plan};({h,y,A})`, context);
  assert.equal(result.h,16);
  assert.equal(result.y,22);
  assert.deepEqual(Array.from(result.A),times);
});
test('AI save preserves irregular processing timestamps and selected frame range', () => {
  const context = {n:{finalAsset:true}, N:true,V:true,R:'ai',G:{current:{fps:16}},e:{sourceFps:30},w:30,l:30,Z:(v,a,b)=>Math.max(a,Math.min(b,v)),g:true,j:{times:[0,.06,.13,.19]},v:false,_:.25,u:true,d:1,f:2};
  const result = vm.runInNewContext(`const nfUseBoardPlan=false;const h=${fps};let ${plan};({h,y,A})`, context);
  assert.deepEqual(Array.from(result.A),[.06,.13]);
});

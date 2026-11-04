import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../renderer/assets/index-BbIa-2NM.js',import.meta.url),'utf8');
test('native particle PNG and video loops deliver the requested frame rate without doubling playback duration',()=>{
 const png=source.match(/if\(e\.loopAnimation\)\{C=[^}]+F=b\/C\}/)?.[0],video=source.match(/if\(t\.loopAnimation\)\{p=[^}]+O=o\/p\}/)?.[0];assert.ok(png);assert.ok(video);
 for(const seconds of [.65,1,2])for(const fps of [12,24,30,60]){
  const a=vm.runInNewContext(png+';({frames:C,step:F})',{e:{loopAnimation:true},b:seconds,x:fps,C:0,S:0,F:0}),b=vm.runInNewContext(video+';({frames:p,step:O})',{t:{loopAnimation:true},o:seconds,u:fps,p:0,f:0,O:0});
  assert.equal(a.frames,Math.round(seconds*fps));assert.equal(b.frames,a.frames);assert.ok(Math.abs(a.frames/fps-seconds)<=.5/fps+1e-9);assert.ok(Math.abs(a.step*a.frames-seconds)<1e-9);
 }
});

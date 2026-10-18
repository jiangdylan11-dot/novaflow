import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../../renderer/'+f,import.meta.url),'utf8');
const source=read('novaflow-brand-runtime.js'),functions=new Map([...source.matchAll(/^  function (\w+)\([^]*?^  \}/gm)].map(m=>[m[1],m[0]])),selected=new Map();
function select(name){if(selected.has(name)||name==='getRibbonTimelineDuration')return;const f=functions.get(name);assert.ok(f,name);selected.set(name,f);for(const m of f.matchAll(/\b(\w+)\s*\(/g))if(functions.has(m[1]))select(m[1]);}
for(const name of ['getRibbonUniformWaveLayout','buildRibbonUniformWaveRotateMap','sparseRibbonRotateFrames'])select(name);
const code=[...selected.values()].join('\n'),constants=[...new Set(code.match(/\bRIBBON_[A-Z_]+\b/g))].map(name=>'const '+name+' = '+source.match(new RegExp('^  const '+name+' = ([^;]+);','m'))[1]+';');
const ctx=vm.createContext({console,getRibbonTimelineDuration:()=>2});ctx.window=ctx;
vm.runInContext(read('motion-calculation.animation.js'),ctx);const A=ctx.NovaFlowMotionAnimation;
vm.runInContext(constants.join('\n')+'\n'+code,ctx);
const presets=vm.runInNewContext(source.match(/^  const RIBBON_PARAMETER_PRESET_OVERRIDES = ([^]*?^  \]);/m)[1]);
const runtime=vm.createContext({console});vm.runInContext(read('vendor/spine/spine-webgl-3.8.js'),runtime);const spine=runtime.spine;
const plain=x=>JSON.parse(JSON.stringify(x));
function native(curves,bones){const data=new spine.SkeletonJson({}).readSkeletonData({skeleton:{spine:'3.8.99'},bones:[{name:'root'},...bones],slots:[],skins:{},animations:{idle:{bones:Object.fromEntries([...curves].map(([name,rotate])=>[name,{rotate:plain(rotate)}]))}}}),sk=new spine.Skeleton(data),animation=data.animations[0];return t=>{sk.setToSetupPose();animation.apply(sk,-1,t,false,[],1,spine.MixBlend.setup,spine.MixDirection.mixIn);sk.updateWorldTransform();return sk.bones;};}
let removed=0;
for(const preset of presets)test('ribbon generated keys: '+preset.label,()=>{
 const bones=Array.from({length:10},(_,i)=>({name:'b'+i,parent:i?'b'+(i-1):'root',length:32,x:i?32:0})),entries=bones.map((b,i)=>({name:b.name,sourceName:'b0',chainIndex:i}));
 const dense=ctx.buildRibbonUniformWaveRotateMap(ctx.getRibbonUniformWaveLayout({bones,entries},entries),{...preset.values,duration:2,fps:30,nativeSwingCount:1});
 ctx.NovaFlowMotionAnimation={...A,sparse:(samples,keys,tol,opts)=>A.sparse(samples,keys,tol,{...opts,merge:false})};
 const before=new Map([...dense].map(([name,frames])=>[name,ctx.sparseRibbonRotateFrames(frames)]));ctx.NovaFlowMotionAnimation=A;
 const after=new Map([...dense].map(([name,frames])=>[name,ctx.sparseRibbonRotateFrames(frames)]));
 for(const [name,frames]of after){const old=before.get(name);assert.ok(frames.length<=old.length);removed+=old.length-frames.length;assert.equal(frames[0].angle,old[0].angle);assert.equal(frames.at(-1).angle,old.at(-1).angle);for(const f of frames)assert.ok(Math.abs(f.time*30-Math.round(f.time*30))<.01,'integer-frame keys');}
 const previous=native(before,bones),next=native(after,bones);
 for(let i=0;i<=1200;i++){
  const t=i/600,x=previous(t),y=next(t);
  for(let b=1;b<x.length;b++){
   const input=dense.get(bones[b-1].name),tol=A.toleranceFor(input,['angle'],.1,.0015);
   assert.ok(Math.abs(x[b].rotation-y[b].rotation)<=tol*1.05+.002,`${preset.label}, bone ${b}, time ${t}`);
   assert.ok(Math.hypot(x[b].worldX-y[b].worldX,x[b].worldY-y[b].worldY)<1.5,'the accumulated chain pose stays within 1.5 px');
  }
 }
});
test('merging removes redundant generated keys and leaves authored curves alone',()=>{
 assert.ok(removed>0);
 assert.equal(ctx.sparseRibbonRotateFrames([{time:0,angle:0,curve:'stepped'},{time:1,angle:5},{time:2,angle:0},{time:3,angle:5}]),null);
 const native42=ctx.sparseRibbonRotateFrames(Array.from({length:121},(_,i)=>({time:i/60,value:Math.sin(i/60*Math.PI)*20})));
 assert.ok(native42.every(f=>typeof f.value==='number'&&f.angle===undefined));
});

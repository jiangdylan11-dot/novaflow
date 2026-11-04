import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=rel=>readFileSync(new URL('../../renderer/'+rel,import.meta.url),'utf8');
const sandbox=vm.createContext({console,TextDecoder,TextEncoder,Uint8Array,Float32Array,Int16Array,Uint16Array,DataView});
for(const file of ['vendor/spine/spine-webgl-3.8.js','spine-structure.ops.js','spine-version-convert.js','spine-binary-write.js'])vm.runInContext(source(file),sandbox);
const S=sandbox.spine,Ops=sandbox.NovaFlowSpineStructureOps;
const mixes={rotateMix:-.5,translateMix:2.5,scaleMix:-1.25,shearMix:3};
const fixture=()=>({skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'target',parent:'root',x:20,y:10,rotation:30,scaleX:1.5,scaleY:1.25,shearY:20},{name:'follower',parent:'root',length:40}],slots:[],skins:[],transform:[{name:'follow',bones:['follower'],target:'target',rotateMix:0,translateMix:0,scaleMix:0,shearMix:0}],animations:{idle:{}}});
const load=json=>new S.Skeleton(new S.SkeletonJson({}).readSkeletonData(json));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
test('negative and above-100% rotation, translation, scale and shear all affect the actual world/local solver',()=>{
 for(const local of [false,true])for(const relative of [false,true])for(const [key,targetValue] of Object.entries({rotateMix:30,translateMix:20,scaleMix:.5,shearMix:20}))for(const mix of [-.5,2]){
  const json=fixture();Object.assign(json.transform[0],{local,relative,[key]:mix});
  const rig=load(json);rig.updateWorldTransform();const b=rig.findBone('follower');
  if(key==='rotateMix')near(Math.atan2(b.c,b.a)*180/Math.PI,targetValue*mix);
  if(key==='translateMix'){near(b.worldX,20*mix);near(b.worldY,10*mix);}
  if(key==='scaleMix')near(Math.hypot(b.a,b.c),1+targetValue*mix);
  if(key==='shearMix')near(Math.atan2(b.d,b.b)*180/Math.PI,90+targetValue*mix);
  near(b.shearY,0); // Constraint evaluation must not mutate the setup shear and accumulate next frame.
 }
});
test('setup and keyed transform mixes survive original JSON version conversion and real binary readback',()=>{
 let json=fixture();json=Ops.setConstraintProps(json,'transform','follow',mixes).json;
 json=Ops.keyConstraint(json,'idle','transform','follow',0,mixes).json;
 const next={rotateMix:3,translateMix:-2,scaleMix:4,shearMix:-3};json=Ops.keyConstraint(json,'idle','transform','follow',1,next).json;
 for(const version of ['3.8','4.0','4.1','4.2']){
  const exported=version==='3.8'?json:sandbox.NovaFlowSpineVersion.fromSpine38(json,version);
  const back=version==='3.8'?exported:sandbox.NovaFlowSpineVersion.toSpine38(exported);
  const normalized=back.json||back;
  for(const [key,value] of Object.entries(mixes))near(normalized.transform[0][key],value);
  const runtimePath=version==='3.8'?'vendor/spine/spine-webgl-3.8.js':version==='4.0'?'vendor/spine/spine-webgl-4.0.js':null;
  const r=vm.createContext({console,TextDecoder,TextEncoder,Uint8Array,Float32Array,Int16Array,Uint16Array,DataView});
  vm.runInContext(runtimePath?source(runtimePath):readFileSync(new URL('../fixtures/spine-runtimes/spine-core-'+(version==='4.1'?'4.1.24':'4.2.120')+'.js',import.meta.url),'utf8'),r);
  const bytes=sandbox.NovaFlowSpineBinary.write(exported,version,{nonessential:true});
  const data=new r.spine.SkeletonBinary({}).readSkeletonData(bytes);
  const readConstraint=data.transformConstraints[0];
  const names=version==='3.8'?{rotateMix:'rotateMix',translateMix:'translateMix',scaleMix:'scaleMix',shearMix:'shearMix'}:{rotateMix:'mixRotate',translateMix:'mixX',scaleMix:'mixScaleX',shearMix:'mixShearY'};
  for(const [key,value] of Object.entries(mixes))near(readConstraint[names[key]],value);
  const rig=new r.spine.Skeleton(data),state=new r.spine.AnimationState(new r.spine.AnimationStateData(data));
  state.setAnimation(0,'idle',false);state.update(1);state.apply(rig);
  for(const [key,value] of Object.entries(next))near(rig.transformConstraints[0][names[key]],value);
 }
});
test('transform number boxes have no bounds and key their exact signed percentage through the native edit path',()=>{
 const text=source('spine-skeleton-editor.js'),elements=[];
 const h=(tag,attrs,...children)=>{const e={tag,...attrs,children,events:{},addEventListener(k,fn){this.events[k]=fn;},setAttribute(k,v){this[k]=v;}};elements.push(e);return e;};
 const json=fixture(),ctx=vm.createContext({h,Ops,state:{json,anim:'idle',frame:15},mode:false,animOn(){return this.mode;},pose(){},rt:{data:{findTransformConstraint:()=>({})},skeleton:{findTransformConstraint:()=>mixes}},transformNow:()=>mixes,timeSec:()=>.5,edit:(_label,fn)=>{const result=fn(ctx.state.json);ctx.state.json=result.json;return result;}});
 // Functions use global mode explicitly to mirror the editor's mode predicate.
 ctx.animOn=()=>ctx.mode;
 vm.runInContext(text.slice(text.indexOf('  function pathValue('),text.indexOf('  /**',text.indexOf('  function pathValue(')))+text.slice(text.indexOf('  function mixSlider('),text.indexOf("  /** An IK constraint's")),ctx);
 for(const [key,value] of Object.entries(mixes)){
  elements.length=0;ctx.mixSlider('transform','follow',key,1);
  const box=elements.find(e=>e.type==='number');assert.equal(box.min,undefined);assert.equal(box.max,undefined);
  box.value=String(value*100);box.events.change();near(ctx.state.json.transform[0][key],value);
  elements.length=0;ctx.mixSlider('transform','follow',key,value);
  const slider=elements.find(e=>e.type==='range');assert.ok(slider.min<=value*100&&slider.max>=value*100);
  ctx.mode=true;const keyedBox=elements.find(e=>e.type==='number');keyedBox.value=String(-value*100);keyedBox.events.change();ctx.mode=false;
  near(ctx.state.json.animations.idle.transform.follow[0][key],-value);
  for(const [other,kept] of Object.entries(mixes))if(other!==key)near(ctx.state.json.animations.idle.transform.follow[0][other],kept);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8');
const ctx=vm.createContext({console});
for(const name of ['spine-bones.editor.js','motion-calculation.engine.js','motion-calculation.animation.js','spine-structure.ops.js','spine-version-convert.js','spine-export-optimizer.js'])vm.runInContext(read(name),ctx);
const E=ctx.NovaFlowMotionEngine,A=ctx.NovaFlowMotionAnimation,M=ctx.NovaFlowBonesEditor,Ops=ctx.NovaFlowSpineStructureOps,V=ctx.NovaFlowSpineVersion;
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(frames=60,reverse=false){
 const duration=Number((frames/30).toFixed(4)),stack=E.freshStack();stack.shuttle.enabled=true;stack.shuttle.reverse=reverse;
 const project={skeleton:{spine:'3.8.99'},bones:[{name:'root',length:60}],slots:[],skins:[{name:'default',attachments:{}}],animations:{idle:{bones:{}}}};
 project.animations.idle=A.calculate(project,'idle',['root'],stack,{animationDuration:duration,boneDuration:duration,animationDelay:0},E,M).animation;
 return {project,stack,duration};
}
test('ellipse authoring stores five editable keys instead of playback samples',()=>{
 for(const frames of [30,40,60,84])for(const reverse of [false,true]){
  const {project,duration}=fixture(frames,reverse),snapshot=JSON.stringify(project),keys=project.animations.idle.bones.root.translate;
  assert.equal(keys.length,5,`authoring keys at ${frames} frames`);
  const restored=plain(project),runtime=Ops.editorData(restored);
  assert.equal(restored.animations.idle.bones.root.translate.length,5);
  assert.ok(runtime.animations.idle.bones.root.translate.length>5,'only the native 3.8 playback copy is sampled');
  for(let i=0;i<=240;i++)for(const key of ['x','y'])assert.ok(Math.abs(A.scalar(keys,duration*i/240,key,0)-A.scalar(runtime.animations.idle.bones.root.translate,duration*i/240,key,0))<.1);
  assert.equal(JSON.stringify(project),snapshot,'preview never writes sampled keys back to the project');
 }
});
test('editor key copy, paste, value edits and curve edits preserve or intentionally replace axis handles',()=>{
 const {project}=fixture(),key={path:['bones','root','translate'],time:0},source=plain(project.animations.idle.bones.root.translate[0].nfCurves);
 assert.equal(Ops.keyCurve(project,'idle',key),'ease');assert.equal(Ops.keyBezier(project,'idle',key).kind,'bezier');
 const clip=Ops.copyKeys(project,'idle',[key]),pasted=Ops.pasteKeys(project,'idle',clip,2.5).json;
 assert.deepEqual(plain(pasted.animations.idle.bones.root.translate.at(-1).nfCurves),source);
 const edited=Ops.keyBone(project,'idle','root',0,{x:20,y:30}).json;
 assert.deepEqual(plain(edited.animations.idle.bones.root.translate[0].nfCurves),source);
 const linear=Ops.setKeyCurve(project,'idle',[key],'linear').json;
 assert.equal(linear.animations.idle.bones.root.translate[0].nfCurves,undefined);
 assert.ok(project.animations.idle.bones.root.translate[0].nfCurves,'editing retains the original for undo');
});
test('3.8 and 4.0 exports contain native curves and reproduce the sparse authoring motion',()=>{
 const {project,duration}=fixture();
 for(const version of ['3.8','4.0']){
  const native=V.fromSpine38(project,version);
  assert.ok(!JSON.stringify(native).includes('nfCurves'),'authoring metadata never leaves in a native export');
  if(version==='4.0')assert.ok(Object.values(native.animations.idle.bones.root).reduce((n,keys)=>n+keys.length,0)<20,'native 4.x exports retain sparse Beziers');
  const runtime=vm.createContext({console});vm.runInContext(read('vendor/spine/spine-webgl-'+version+'.js'),runtime);
  const s=runtime.spine,data=new s.SkeletonJson({}).readSkeletonData(native),sk=new s.Skeleton(data),animation=data.animations[0];
  for(let i=0;i<=600;i++){
   const t=duration*i/600;sk.setToSetupPose();animation.apply(sk,-1,t,false,[],1,s.MixBlend.setup,s.MixDirection.mixIn);sk.updateWorldTransform();
   const keys=project.animations.idle.bones.root.translate;
   assert.ok(Math.hypot(sk.findBone('root').worldX-A.scalar(keys,t,'x',0),sk.findBone('root').worldY-A.scalar(keys,t,'y',0))<.65,version+' exported pose '+i);
  }
 }
});
test('constant and linear samples reduce to endpoints without altering sampled values',()=>{
 for(const constant of [false,true]){
  const samples=Array.from({length:121},(_,i)=>({time:i/60,x:constant?5:i*2})),keys=A.sparse(samples,['x'],.01);
  assert.equal(keys.length,2);
  for(const sample of samples)assert.ok(Math.abs(A.scalar(keys,sample.time,'x',0)-sample.x)<.01);
 }
});
test('formal editor loads curve support before structural operations',()=>{
 const html=read('spine-skeleton-editor.html');
 assert.ok(html.indexOf("'motion-calculation.animation.js'")<html.indexOf("'spine-structure.ops.js'"));
 assert.ok(read('spine-structure.ops.js').includes('NovaFlowMotionAnimation?.expandAxisCurves(json)'));
});

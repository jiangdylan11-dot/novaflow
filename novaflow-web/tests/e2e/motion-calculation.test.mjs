import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx=vm.createContext({console});
for(const file of ['spine-bones.editor.js','motion-calculation.engine.js','motion-calculation.animation.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),ctx);
const E=ctx.NovaFlowMotionEngine,A=ctx.NovaFlowMotionAnimation,M=ctx.NovaFlowBonesEditor;
const fixture=()=>({skeleton:{fps:60},bones:[{name:'root',rotation:30},{name:'ball',parent:'root',x:20,y:30},{name:'child',parent:'ball'},{name:'other',parent:'root'}],slots:[{name:'ballSlot',bone:'ball',color:'ff8040ff'},{name:'childSlot',bone:'child'},{name:'otherSlot',bone:'other'}],skins:{default:{ballSlot:{ball:{width:80,height:60}}}},animations:{idle:{duration:2,bones:{ball:{translate:[{time:0,x:5,y:2},{time:2,x:15,y:2}],rotate:[{time:0,angle:4}]},child:{rotate:[{time:0,angle:0},{time:2,angle:30}]},other:{translate:[{time:0,x:0},{time:2,x:30}]}},slots:{ballSlot:{color:[{time:0,color:'ff8040ff'}]}},drawOrder:[{time:1,offsets:[]}]},otherAnimation:{bones:{root:{rotate:[{time:1,angle:90}]}}}}});
const timing={animationDuration:2,boneDuration:1,animationDelay:.5};
const calc=(project,stack,t=timing)=>A.calculate(project,'idle',['ball'],stack,t,E,M);
test('native bake only changes selected bone and its own slot; inputs and other animation stay intact',()=>{
 const project=fixture(),before=JSON.stringify(project),stack=E.freshStack();stack.bounce.enabled=true;stack.expand.enabled=true;stack.opacity.opacity.from=0;
 const {animation}=calc(project,stack);
 assert.equal(JSON.stringify(project),before);
 assert.equal(animation.bones.other,project.animations.idle.bones.other);
 assert.equal(animation.bones.child,project.animations.idle.bones.child);
 assert.equal(animation.bones.ball.rotate,project.animations.idle.bones.ball.rotate);
 assert.equal(animation.drawOrder,project.animations.idle.drawOrder);
 assert.equal(animation.slots.childSlot,undefined);
 assert.equal(animation.slots.otherSlot,undefined);
 assert.equal(animation.slots.ballSlot.color.find(f=>f.time===.5).color,'ff804000');
 assert.equal(animation.slots.ballSlot.color.find(f=>f.time===1.5).color,'ff8040ff');
});
test('outer delay positions one full bone cycle; inner delay shifts phase without time compression',()=>{
 const stack=E.freshStack();stack.shuttle.enabled=true;stack.shuttle.axes.y.on=false;
 for(const p of Object.values(stack))p.duration=1;
 stack.shuttle.delay=.25;
 assert.equal(E.effectTime(stack.shuttle,0),.75);
 assert.equal(E.effectTime(stack.shuttle,.25),0);
 assert.equal(E.effectTime(stack.shuttle,.75),.5);
 assert.equal(E.sampleStack(stack,0).x,E.sampleStack(stack,1).x);
 const project=fixture(),out=calc(project,stack);
 assert.equal(out.start,.5);assert.equal(out.end,1.5);
 for(const time of [.5,.75,1,1.25,1.5]){
  const row=out.animation.bones.ball.translate.find(f=>Math.abs(f.time-time)<1e-9);
  const baseline=A.scalar(project.animations.idle.bones.ball.translate,time,'x',0);
  const worldX=(row.x-baseline)*Math.cos(Math.PI/6)-(row.y-2)*Math.sin(Math.PI/6);
  assert.ok(Math.abs(worldX-E.sampleStack(stack,time-.5).x)<1e-7);
 }
});
test('outside the calculation interval existing keyframes remain',()=>{
 const project=fixture(),stack=E.freshStack();stack.expand.enabled=true;
 const frames=calc(project,stack).animation.bones.ball.translate;
 assert.equal(frames[0],project.animations.idle.bones.ball.translate[0]);
 assert.equal(frames.at(-1),project.animations.idle.bones.ball.translate.at(-1));
});
test('existing Bezier timing outside the generated interval is preserved',()=>{
 const project=fixture(),stack=E.freshStack();stack.bounce.enabled=true;
 const old=project.animations.idle.bones.ball.translate;old[0].curve=[.2,.05,.7,.9];
 const out=calc(project,stack).animation.bones.ball.translate;
 for(const t of [.1,.2,.4,1.6,1.8,1.9])assert.ok(Math.abs(A.scalar(old,t,'x',0)-A.scalar(out,t,'x',0))<1e-6);
});
test('invalid timings never truncate other bones',()=>{
 const project=fixture(),stack=E.freshStack();
 assert.throws(()=>calc(project,stack,{...timing,animationDelay:1.2}),/不能超过/);
 assert.throws(()=>calc(project,stack,{animationDuration:1,boneDuration:1,animationDelay:0}),/已有关键帧/);
});
test('impact overshoots floor, zero impact stays above; owned effects do not leak scale',()=>{
 const stack=E.freshStack();stack.bounce.enabled=true;stack.bounce.impact=0;
 const sample=()=>Array.from({length:1001},(_,i)=>E.sampleStack(stack,i/1000));
 assert.ok(sample().every(v=>v.y>=0&&v.sx===1&&v.sy===1));
 stack.bounce.impact=.6;assert.ok(sample().some(v=>v.y<0));
});
test('scale pivot compensation fixes selected anchor under rotated parent',()=>{
 const project=fixture(),stack=E.freshStack();stack.expand.enabled=true;stack.expand.anchor='bottom-left';
 const result=calc(project,stack).animation,box=A.bounds(project,'ball',M),t=.75;
 const old=A.pose(project,project.animations.idle,t,M).world[1],next=A.pose(project,result,t,M).world[1];
 const xy=m=>[m.worldX+m.a*box.minX+m.b*box.minY,m.worldY+m.c*box.minX+m.d*box.minY];
 xy(old).forEach((v,i)=>assert.ok(Math.abs(v-xy(next)[i])<1e-6));
});
test('Spine 3.8 runtime reads saved tracks with matching displacement, scale, alpha and duration',()=>{
 const runtime=vm.createContext({console});
 vm.runInContext(readFileSync(new URL('../../renderer/vendor/spine/spine-webgl-3.8.js',import.meta.url),'utf8'),runtime);
 const spine=runtime.spine,project=fixture();project.skeleton.spine='3.8.99';project.skins={};
 const stack=E.freshStack();stack.shuttle.enabled=true;stack.expand.enabled=true;stack.opacity.opacity.from=0;
 const animation=calc(project,stack,{...timing,animationDuration:3}).animation;
 const reader=new spine.SkeletonJson({}),data=reader.readSkeletonData({...project,animations:{idle:animation}});
 assert.equal(data.animations[0].duration,3);
 const skeleton=new spine.Skeleton(data),state=new spine.AnimationState(new spine.AnimationStateData(data));
 state.setAnimation(0,'idle',false);state.update(1);state.apply(skeleton);skeleton.updateWorldTransform();
 const bone=skeleton.findBone('ball'),slot=skeleton.findSlot('ballSlot');
 assert.ok(Math.abs(bone.x-(20+A.scalar(animation.bones.ball.translate,1,'x',0)))<1e-4);
 assert.ok(Math.abs(bone.scaleX-A.scalar(animation.bones.ball.scale,1,'x',1))<1e-4);
 assert.ok(Math.abs(slot.color.a-128/255)<1e-5);
 assert.equal(JSON.stringify(animation.bones.other),JSON.stringify(project.animations.idle.bones.other));
});

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
test('scale uses the bone origin and preserves translation under a rotated parent, ignoring legacy anchors',()=>{
 const project=fixture(),stack=E.freshStack();stack.expand.enabled=true;stack.expand.anchor='bottom-left';
 const result=calc(project,stack).animation,t=.75;
 const old=A.pose(project,project.animations.idle,t,M).world[1],next=A.pose(project,result,t,M).world[1];
 assert.deepEqual(result.bones.ball.translate,project.animations.idle.bones.ball.translate);
 assert.notDeepEqual(result.bones.ball.scale,project.animations.idle.bones.ball.scale);
 const xy=m=>[m.worldX,m.worldY];
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

test('Bezier insertion preserves shape even with nonuniform time handles; interior deletion is reversible',()=>{
 const p=E.freshStack().opacity;p.opacity.from=0;
 const knots=E.curveFor(p,'alpha');assert.equal(knots.length,2);
 const edited=JSON.parse(JSON.stringify(knots));edited[0].out={u:.12,v:.8};edited[1].in={u:.75,v:.2};
 const before=Array.from({length:101},(_,i)=>E.evaluateCurve(edited,i/100));
 const split=JSON.parse(JSON.stringify(edited)),index=E.insertCurvePoint(split,.43);
 assert.equal(index,1);assert.equal(split.length,3);
 before.forEach((v,i)=>assert.ok(Math.abs(v-E.evaluateCurve(split,i/100))<1e-8));
 assert.equal(E.removeCurvePoint(split,0),false);assert.equal(E.removeCurvePoint(split,2),false);
 assert.equal(E.removeCurvePoint(split,1),true);assert.equal(split.length,2);
 E.storeCurve(p,'alpha',edited);
 assert.ok(Math.abs(E.sample(p,.43).alpha-before[43])<1e-8);
 const restored=JSON.parse(JSON.stringify(p));assert.equal(E.sample(restored,.43).alpha,E.sample(p,.43).alpha);
});

test('automatic Bezier nodes follow motion segments instead of a fixed sample grid',()=>{
 const stack=E.freshStack();
 for(const mode of Object.keys(E.ownedChannels))for(const key of E.ownedChannels[mode]){
  const p=stack[mode],before=JSON.stringify(p),knots=E.curveFor(p,key);
  assert.equal(JSON.stringify(p),before,'drawing the editor must not alter an untouched animation');
  assert.equal(knots[0].u,0);assert.equal(knots.at(-1).u,1);
  const values=Array.from({length:1001},(_,i)=>E.sample(p,i/1000,false,true)[key]);
  const allowed=Math.max((Math.max(...values)-Math.min(...values))*.0035,key==='alpha'||key.startsWith('s')?.0006:.06);
  values.forEach((v,i)=>assert.ok(Math.abs(E.evaluateCurve(knots,i/1000)-v)<allowed));
  for(let i=1;i<knots.length;i++)assert.ok(knots[i-1].u<=knots[i-1].out.u&&knots[i-1].out.u<=knots[i].in.u&&knots[i].in.u<=knots[i].u);
 }
 assert.ok(E.curveFor(stack.bounce,'y').length<17);
});

test('Bezier edits retain slider influence, owned channels and loop timing',()=>{
 const stack=E.freshStack(),p=stack.shuttle;p.enabled=true;p.duration=1;p.delay=.25;
 const knots=JSON.parse(JSON.stringify(E.curveFor(p,'x'))),i=E.insertCurvePoint(knots,.3);
 knots[i].v+=20;knots[i].in.v+=20;knots[i].out.v+=20;E.storeCurve(p,'x',knots);
 const old=E.sample(p,.3).x,oldBase=E.sample(p,.3,true).x;
 p.axes.x.amp+=40;
 assert.ok(Math.abs(E.sample(p,.3).x-old-(E.sample(p,.3,true).x-oldBase))<1e-5);
 assert.equal(E.sampleStack(stack,.55).sx,1);
 assert.ok(Math.abs(E.sampleStack(stack,.55).x-E.sample(p,.3).x)<1e-6);
 assert.equal(E.sampleStack(stack,0).x,E.sampleStack(stack,1).x);
});

test('saved native animation bakes edited Bezier scale and opacity, preserving other bones',()=>{
 const stack=E.freshStack();stack.expand.enabled=true;
 for(const [mode,key] of [['expand','sx'],['opacity','alpha']]){
  const p=stack[mode],knots=JSON.parse(JSON.stringify(E.curveFor(p,key)));
  const i=E.insertCurvePoint(knots,.5);assert.ok(i>0);
  knots[i].v=key==='alpha'?.35:1.7;knots[i].in.v=knots[i].out.v=knots[i].v;E.storeCurve(p,key,knots);
 }
 const project=fixture(),out=calc(project,stack).animation;
 assert.ok(Math.abs(A.scalar(out.bones.ball.scale,1,'x',1)-1.7)<1e-6);
 assert.equal(out.slots.ballSlot.color.find(f=>Math.abs(f.time-1)<1e-8).color,'ff804059');
 assert.equal(out.bones.other,project.animations.idle.bones.other);
 delete stack.expand.curves.sx;
 assert.equal(E.sample(stack.expand,.5).sx,E.sample(stack.expand,.5,true).sx);
});

test('timing edits keep the whole bone interval inside the animation',()=>{
 const timing={animationDuration:6,boneDuration:3,animationDelay:4.3,minimumDuration:2};
 E.fitTiming(timing);assert.equal(timing.animationDelay,3);
 timing.animationDuration=1;E.fitTiming(timing);
 assert.equal(timing.animationDuration,2);assert.equal(timing.boneDuration,2);assert.equal(timing.animationDelay,0);
});

test('linked scale curve edits lock the ratio; unchecked edits leave the other channel intact',()=>{
 const p=E.freshStack().expand;p.enabled=true;
 const knots=JSON.parse(JSON.stringify(E.curveFor(p,'sx'))),i=E.insertCurvePoint(knots,.5);
 knots[i].v=1.7;E.storeLinkedCurve(p,'sx',knots);
 for(const u of [0,.25,.5,.75,1])assert.ok(Math.abs(E.sample(p,u).sx-E.sample(p,u).sy)<1e-8);
 p.link=false;const other=JSON.stringify(p.curves.sy);knots[i].v=1.9;E.storeLinkedCurve(p,'sx',knots);
 assert.equal(JSON.stringify(p.curves.sy),other);assert.ok(Math.abs(E.sample(p,.5).sx-1.9)<1e-8);
});

test('looping subdivides the bone interval and never extends its placement',()=>{
 const stack=E.freshStack(),p=stack.expand;p.enabled=true;
 const single=E.sample(p,.3).sx;p.loop=true;p.loopCount=3;
 for(const u of [.1,.1+1/3,.1+2/3])assert.ok(Math.abs(E.sample(p,u).sx-single)<1e-7);
 const result=calc(fixture(),stack);assert.equal(result.start,.5);assert.equal(result.end,1.5);
 const shuttle=stack.shuttle;shuttle.axes.x.cycles=3;shuttle.loop=false;
 const once=E.sample(shuttle,.25).x;shuttle.axes.x.cycles=1;assert.equal(E.sample(shuttle,.25).x,once);
});

test('weighted mesh bounds follow influencing bones instead of slot attachment and image width',()=>{
 const project={bones:[{name:'root'},{name:'driver',parent:'root',x:100,length:10}],slots:[{name:'mesh',bone:'root'}],skins:[{attachments:{mesh:{shape:{type:'mesh',width:1,height:1,uvs:[0,0,1,1],vertices:[1,1,0,-20,1,1,1,200,30,1]}}}}],animations:{idle:{duration:2,bones:{}}}};
 const box=A.bounds(project,'driver',M);for(const [k,v]of Object.entries({minX:0,maxX:200,minY:-20,maxY:30}))assert.ok(Math.abs(box[k]-v)<1e-8);
 const stack=E.freshStack();stack.expand.enabled=true;stack.expand.anchor='bottom';
 const out=A.calculate(project,'idle',['driver'],stack,timing,E,M).animation;
 assert.ok(out.bones.driver.scale.length>20);assert.equal(out.bones.root,undefined);
});

const panelSource=readFileSync(new URL('../../renderer/motion-calculation.panel.js',import.meta.url),'utf8');
const presets=vm.runInNewContext('('+panelSource.match(/const presetSets = (\{[\s\S]*?\n  \});/)[1]+')');
function presetMotion(mode,index){const [name,values,axes]=presets[mode][index],p=E.freshStack()[mode];Object.assign(p,values);for(const key of E.ownedChannels[mode])p.axes[key].amp=axes[key];p.enabled=true;return p;}

test('scale and move keep their three original presets and add three one-way motions',()=>{
 assert.deepEqual(Array.from(presets.expand.slice(0,3),p=>p[0]),['弹性放大','受击压扁','柔和呼吸']);
 assert.deepEqual(Array.from(presets.shuttle.slice(0,3),p=>p[0]),['左右往返','上下浮动','椭圆运动']);
 for(const mode of ['expand','shuttle']){
  assert.equal(presets[mode].length,6);
  for(let i=0;i<3;i++)assert.equal(presetMotion(mode,i).oneWay,undefined);
  for(let i=3;i<6;i++){
   const p=presetMotion(mode,i);
   for(const key of E.ownedChannels[mode]){
    const base=key.startsWith('s')?1:0,amp=p.axes[key].amp;
    assert.ok(Math.abs(E.sample(p,0)[key]-base)<1e-8);
    assert.ok(Math.abs(E.sample(p,1)[key]-(base+amp))<1e-8,'single motion ends at target instead of returning');
    let previous=E.sample(p,0)[key];
    for(let j=1;j<=100;j++){const v=E.sample(p,j/100)[key];assert.ok((v-previous)*Math.sign(amp)>=-1e-8);previous=v;}
   }
  }
 }
});

test('reverse swaps full motion including edited Bezier handles without changing opacity or other effects',()=>{
 for(const mode of ['expand','shuttle'])for(let i=0;i<6;i++){
  const p=presetMotion(mode,i),key=mode==='expand'?'sx':'x';
  p.opacity.on=true;p.opacity.from=0;p.opacity.to=1;
  const knots=JSON.parse(JSON.stringify(E.curveFor(p,key))),at=E.insertCurvePoint(knots,.37);
  if(at>=0){knots[at].v+=key==='x'?17:.12;knots[at].in.v=knots[at].v;knots[at].out.v=knots[at].v;}
  E.storeCurve(p,key,knots);
  const original=Array.from({length:101},(_,j)=>E.sample(p,j/100)[key]);
  const alpha=E.sample(p,.2).alpha;p.reverse=true;
  for(let j=0;j<=100;j++)assert.ok(Math.abs(E.sample(p,j/100)[key]-original[100-j])<1e-6);
  assert.equal(E.sample(p,.2).alpha,alpha);
  const reversed=JSON.parse(JSON.stringify(E.curveFor(p,key)));E.storeCurve(p,key,reversed);
  p.reverse=false;
  for(let j=0;j<=100;j++)assert.ok(Math.abs(E.sample(p,j/100)[key]-original[j])<1e-6,'saving while reversed must not double-reverse');
 }
});

test('one-way and reversed curves bake to native tracks and hold their target after the bone interval',()=>{
 for(const mode of ['expand','shuttle'])for(const reverse of [false,true]){
  const stack=E.freshStack();stack[mode]=presetMotion(mode,3);stack[mode].reverse=reverse;
  const project=fixture();project.bones[0].rotation=0;delete project.animations.idle.bones.ball;
  const {animation}=calc(project,stack);
  const track=mode==='expand'?'scale':'translate',key=mode==='expand'?'sx':'x',fallback=mode==='expand'?1:0;
  for(const t of [.5,.7,1,1.5,1.8]){
   const expected=E.sampleStack(stack,Math.min(1,(t-.5)))[key];
   assert.ok(Math.abs(A.scalar(animation.bones.ball[track],t,'x',fallback)-expected)<.01);
  }
  assert.equal(animation.bones.other,project.animations.idle.bones.other);
 }
});

test('rotation presets swing, spin, step and spring; cycles multiply inside the bone interval',()=>{
 assert.deepEqual(Array.from(presets.rotate,p=>p[0]),['左右摇摆','匀速旋转','单向旋转','受击回正']);
 const at=(p,u)=>E.sample(p,u).r,near=(a,b)=>Math.abs(a-b)<1e-6;
 const swing=presetMotion('rotate',0);
 assert.ok(near(at(swing,0),0)&&near(at(swing,.25),25)&&near(at(swing,.75),-25)&&near(at(swing,1),0),'swing starts at rest and alternates');
 swing.reverse=true;assert.ok(near(at(swing,.25),-25),'reverse flips the swing direction');
 const spin=presetMotion('rotate',1);
 for(const u of [0,.25,.5,1])assert.ok(near(at(spin,u),360*u),'one linear turn per period');
 spin.cycles=3;assert.ok(near(at(spin,.5),540)&&near(at(spin,1),1080),'cycles are whole turns');
 const step=presetMotion('rotate',2);
 assert.ok(near(at(step,1),90));
 step.cycles=3;assert.ok(near(at(step,1/3),90)&&near(at(step,2/3),180)&&near(at(step,1),270),'cycles are consecutive eased steps');
 let previous=0;for(let j=1;j<=120;j++){const v=at(step,j/120);assert.ok(v-previous>=-1e-8,'steps never turn back');previous=v;}
 const spring=presetMotion('rotate',3);
 assert.ok(near(at(spring,0),0)&&near(at(spring,1),0)&&Math.max(...Array.from({length:101},(_,j)=>at(spring,j/100)))>30,'spring leaves and returns to rest');
 spring.cycles=2;assert.ok(near(at(spring,.5),0),'each hit returns to rest');
 assert.equal(E.curveFor(spin,'r').length,2,'a linear turn is a single Bezier segment');
});

test('rotation bakes only a rotate track on top of existing keys; other channels and bones stay intact',()=>{
 const stack=E.freshStack();stack.rotate=presetMotion('rotate',1);
 const project=fixture();
 const {animation}=calc(project,stack);
 const ball=animation.bones.ball,source=project.animations.idle.bones.ball;
 assert.equal(ball.translate,source.translate,'translate keys are untouched');
 assert.equal(ball.scale,undefined,'no scale track is invented');
 assert.ok(ball.rotate.every(f=>typeof f.angle==='number'),'Spine 3.8 rotate keys use angle');
 for(const t of [.5,.75,1,1.5]){const expected=4+E.sampleStack(stack,t-.5).r;assert.ok(Math.abs(A.scalar(ball.rotate,t,'angle',0)-expected)<.01,'existing 4° key plus the calculated angle at '+t);}
 assert.ok(Math.abs(A.scalar(ball.rotate,.2,'angle',0)-4)<1e-6,'before the interval the original key remains');
 assert.ok(Math.abs(A.scalar(ball.rotate,1.8,'angle',0)-364)<.01,'after the interval the reached angle holds');
 assert.equal(animation.bones.other,project.animations.idle.bones.other);
 assert.equal(animation.bones.child,project.animations.idle.bones.child);
 assert.equal(animation.slots.ballSlot,project.animations.idle.slots.ballSlot,'no opacity change means no slot keys');
});

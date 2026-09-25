import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function bridgeFixture(setup=()=>{}){
  const updates=[];
  const props={spineSubEditor:'bone',activeAnimationName:'idle',selectedBoneName:'ball',
    project:{bones:[{name:'ball'},{name:'other'}],slots:[],animations:{idle:{duration:2,bones:{ball:{translate:[{time:0,x:0}]},other:{translate:[{time:0,x:10}]}},slots:{}}}},
    setProject:update=>updates.push(update)};
  setup(props.project);
  const root={__reactContainer$test:{stateNode:{current:{memoizedProps:props}}}};
  const ctx=vm.createContext({console,document:{getElementById:()=>root},MutationObserver:class{observe(){}},addEventListener(){}});
  ctx.window=ctx;
  for(const file of ['spine-bones.editor.js','motion-calculation.engine.js','motion-calculation.animation.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),ctx);
  const source=readFileSync(new URL('../../renderer/motion-calculation.tool.js',import.meta.url),'utf8');
  // Exercise the real bridge with delayed React commits, without mounting UI.
  vm.runInContext(source.replace('  setInterval(refresh,350);refresh();','  window.bridgeTest={createSession,write,matchesExpected,calculationBaseline,playbackRange,playbackTime};'),ctx);
  const bridge=ctx.bridgeTest,session=bridge.createSession(props);session.channels.add('translate');
  const animation=x=>({...props.project.animations.idle,bones:{...props.project.animations.idle.bones,ball:{translate:[{time:0,x}]}}});
  const flush=()=>{props.project=updates.shift()(props.project);};
  return {bridge,session,props,updates,animation,flush,ctx};
}

test('rapid preview writes accept only their own pending React snapshots',()=>{
  const f=bridgeFixture();
  f.bridge.write(f.session,f.animation(1));f.bridge.write(f.session,f.animation(2));
  f.flush(); // React has committed frame 1, while frame 2 remains queued.
  f.bridge.write(f.session,f.animation(3));
  const latest=f.session.expected;
  assert.equal(f.bridge.createSession(f.props),f.session);
  assert.equal(f.session.expected,latest,'reopening must not replace the newest queued result with an old frame');
  while(f.updates.length)f.flush();
  assert.equal(f.props.project.animations.idle.bones.ball.translate[0].x,3);
  assert.equal(f.bridge.matchesExpected(f.props.project.animations.idle,f.session),true);
  assert.equal(f.session.pendingSignatures.size,0);
});

test('queued previews preserve other bones and still reject external target edits',()=>{
  const f=bridgeFixture();
  f.bridge.write(f.session,f.animation(1));
  f.props.project.animations.idle.bones.other={translate:[{time:0,x:99}]};
  f.bridge.write(f.session,f.animation(2));
  while(f.updates.length)f.flush();
  assert.equal(f.props.project.animations.idle.bones.other.translate[0].x,99);
  f.props.project.animations.idle.bones.ball={translate:[{time:0,x:777}]};
  assert.throws(()=>f.bridge.write(f.session,f.animation(3)),/其他工具修改/);
});

test('calculation replaces selected bone source motion, preserves other tracks and restores the original',()=>{
  const f=bridgeFixture(project=>{
    project.slots=[{name:'ballSlot',bone:'ball'},{name:'otherSlot',bone:'other'}];
    project.animations.idle.bones.ball={translate:[{time:0,x:90},{time:2,x:180}],rotate:[{time:0,angle:45}],scale:[{time:0,x:3,y:2}],shear:[{time:2,x:20}]};
    project.animations.idle.slots={ballSlot:{color:[{time:0,color:'ffffff00'}],attachment:[{time:0,name:'mesh'}]},otherSlot:{color:[{time:0,color:'ffffff80'}]}};
  });
  const original=JSON.stringify(f.session.base),E=f.ctx.NovaFlowMotionEngine,A=f.ctx.NovaFlowMotionAnimation,M=f.ctx.NovaFlowBonesEditor;
  const stack=E.freshStack();stack.expand.enabled=true;f.session.channels.add('scale');
  const preview=()=>{
    const baseline=f.bridge.calculationBaseline(f.props.project.animations.idle,f.session);
    const project={...f.props.project,animations:{idle:baseline}};
    const result=A.calculate(project,'idle',['ball'],stack,{animationDuration:2,boneDuration:1,animationDelay:.5},E,M).animation;
    f.bridge.write(f.session,result);f.flush();return result;
  };
  let result=preview();
  assert.equal(result.bones.ball.translate,undefined);
  assert.equal(result.bones.ball.rotate,undefined);
  assert.equal(result.bones.ball.shear,undefined);
  assert.equal(A.scalar(result.bones.ball.scale,.5,'x',1),1,'old scale must not multiply the calculation');
  assert.equal(result.slots.ballSlot.color,undefined);
  assert.equal(result.slots.ballSlot.attachment[0].name,'mesh');
  assert.equal(JSON.stringify(f.session.base),original,'restore baseline stays untouched');
  const other={translate:[{time:0,x:99}]};f.props.project.animations.idle.bones.other=other;
  stack.shuttle.enabled=true;f.session.channels.add('translate');result=preview();
  assert.ok(result.bones.ball.scale.length&&result.bones.ball.translate.length,'calculation effects keep composing');
  assert.equal(result.bones.other,other);
  assert.equal(result.slots.otherSlot.color[0].color,'ffffff80');
  f.bridge.write(f.session,f.session.base);f.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(f.props.project.animations.idle.bones.ball)),JSON.parse(original).bones.ball);
  assert.equal(f.props.project.animations.idle.slots.ballSlot.color[0].color,'ffffff00');
  assert.equal(f.props.project.animations.idle.bones.other,other);
});

test('bone playback controls the native clock inside its delayed range and releases full playback',()=>{
  const f=bridgeFixture();let time=0,wraps=0;
  const bundle=readFileSync(new URL('../../renderer/assets/index-BbIa-2NM.js',import.meta.url),'utf8');
  const clock=bundle.match(/B\(t=>(window\.__NovaFlowMotionPlaybackTime\?\.\(t\+i,e\)\?\?\$r\(t\+i,e\))\)/);
  assert.ok(clock,'the shipped native clock must use the playback range');
  const tick=vm.runInContext('(t,i,e)=>'+clock[1],f.ctx);
  f.ctx.$r=(t,d)=>t%d;
  f.bridge.playbackRange([2,3]);time=tick(time,.016,6);assert.equal(time,2);
  for(let i=0;i<200;i++){const next=tick(time,.016,6);if(next<time)wraps++;time=next;assert.ok(time>=2&&time<3);}
  assert.ok(wraps>=3);
  f.bridge.playbackRange(null);for(let i=0;i<100;i++)time=tick(time,.016,6);
  assert.ok(time>3);
  time=0;f.bridge.playbackRange([2,3]);assert.equal(time,0,'paused seeking is free');
  assert.equal(tick(time,.016,6),2,'resume starts inside bone interval');
  assert.ok(Math.abs(tick(2.99,.08,6)-2.07)<1e-9,'wrap preserves frame overshoot');
  f.bridge.playbackRange([5,6]);assert.ok(Math.abs(tick(5.99,.08,6)-5.07)<1e-9,'wrap precedes full animation wrap');
});

test('curve clock follows the native timeline through delayed bone playback and scrubbing',()=>{
  const f=bridgeFixture(),range={value:'0'};
  f.ctx.document.querySelector=()=>({querySelector:()=>range});
  f.ctx.__NovaFlowSkeletonTimelineOfficialProxy={timeSec:99};
  f.props.currentTimeSec=88;
  const start=.39,duration=.95,E=f.ctx.NovaFlowMotionEngine,p=E.fresh('bounce');p.duration=duration;
  for(const t of [0,.39,.58,.865,1.34,1.8,.39,.7]){
    range.value=String(t);
    const read=f.bridge.playbackTime();
    assert.equal(read,t,'cursor reads the displayed timeline, even if proxy/context lag');
    const progress=E.effectTime(p,E.clamp(read-start,0,duration)/duration);
    assert.ok(Math.abs(progress-E.clamp((t-start)/duration,0,1))<1e-9);
  }
  f.ctx.document.querySelector=()=>null;f.props.currentTimeSec=.61;
  assert.equal(f.bridge.playbackTime(),.61,'fresh React context is the fallback before timeline mounting');
});

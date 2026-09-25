import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function bridgeFixture(){
  const updates=[];
  const props={spineSubEditor:'bone',activeAnimationName:'idle',selectedBoneName:'ball',
    project:{bones:[{name:'ball'},{name:'other'}],slots:[],animations:{idle:{duration:2,bones:{ball:{translate:[{time:0,x:0}]},other:{translate:[{time:0,x:10}]}},slots:{}}}},
    setProject:update=>updates.push(update)};
  const root={__reactContainer$test:{stateNode:{current:{memoizedProps:props}}}};
  const ctx=vm.createContext({console,document:{getElementById:()=>root},MutationObserver:class{observe(){}},addEventListener(){}});
  ctx.window=ctx;
  for(const file of ['motion-calculation.engine.js','motion-calculation.animation.js'])vm.runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),ctx);
  const source=readFileSync(new URL('../../renderer/motion-calculation.tool.js',import.meta.url),'utf8');
  // Exercise the real bridge with delayed React commits, without mounting UI.
  vm.runInContext(source.replace('  setInterval(refresh,350);refresh();','  window.bridgeTest={createSession,write,matchesExpected};'),ctx);
  const bridge=ctx.bridgeTest,session=bridge.createSession(props);session.channels.add('translate');
  const animation=x=>({...props.project.animations.idle,bones:{...props.project.animations.idle.bones,ball:{translate:[{time:0,x}]}}});
  const flush=()=>{props.project=updates.shift()(props.project);};
  return {bridge,session,props,updates,animation,flush};
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

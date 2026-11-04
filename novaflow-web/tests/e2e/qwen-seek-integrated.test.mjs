import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

function setup({seekAvailable=true}={}) {
  let frame=4, preview=null, undo=null, active=true, calls=[], nativeRevision=0;
  const denied=()=>Object.assign(new Error('请在确认界面亲自点击，未更改帧位置'),{code:'qwen-seek-trusted-click-required'});
  const editor={
    agentPrepareCommunitySeek(target){preview={token:'private-preview',fromFrame:frame,target,revision:nativeRevision};return {token:preview.token,animation:'idle',fromFrame:frame,targetFrame:target,expiresAt:Date.now()+120000};},
    agentValidateCommunitySeek(token){return !!preview&&preview.token===token&&frame===preview.fromFrame&&nativeRevision===preview.revision;},
    agentCancelCommunitySeek(token){calls.push(['cancel',token]);if(preview?.token===token){preview=null;return true;}return false;},
    agentDiscardCommunitySeekUndo(token){calls.push(['discardUndo',token]);if(undo?.token===token){undo=null;return true;}return false;},
    agentCommitCommunitySeek(token,event){calls.push(['commit',token]);if(!event?.trusted)throw denied();if(!preview||preview.token!==token||frame!==preview.fromFrame)throw new Error('定位预览已失效，未更改帧位置');const p=preview;preview=null;frame=p.target;undo={token:'private-undo',from:p.fromFrame,target:p.target};return {operation:'seek',phase:'applied',animation:'idle',frame,undoToken:undo.token};},
    agentUndoCommunitySeek(token,event){calls.push(['undo',token]);if(!event?.trusted)throw denied();if(!undo||undo.token!==token||frame!==undo.target)throw new Error('定位撤销已失效，未更改帧位置');frame=undo.from;undo=null;return {operation:'seek_undo',phase:'applied',animation:'idle',frame};}
  };
  const root={console,TextEncoder,AbortController,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:()=>null,setItem(){}},atob:s=>Buffer.from(s,'base64').toString('binary')};root.window=root;
  root.NovaFlowSkeletonEditor={active:()=>active,api:()=>editor};
  let planData={mode:'foart',model:'qwen35-heretic',seekCandidateStatus:'candidate',seekCandidate:{targetFrame:30},toolTrace:[]};let released=true,requests=[];let mutate=null;
  root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA:'nf.foart.tool-plan.v1',foartUnsupportedMediaAnalysis:()=>false};
  root.NovaFlowFoartTools={capture:()=>({animation:{active:true,loaded:true,revision:1,name:'test',animation:'idle',animations:['idle'],selectedBones:[],bones:[],fps:30,frame,playing:false,mode:'animate'}})};

  const vm=createContext(root);runInContext(readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'),vm);
  const bridge={clearPrepared(){},hasResult:()=>false};
  const controller=root.NovaFlowXiaotaoArtAgent.createController({bridge,api:()=>({promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true,qwen35FoartSeek:seekAvailable}}}),artAgentChat:async p=>{requests.push(p);if(mutate)await mutate();return {ok:true,resourcesReleased:released,data:planData};}})});controller.state.modelId='qwen3.5-9b-heretic';controller.state.qwen35CpuTrialAvailable=true;controller.state.qwen35FoartSeekAvailable=seekAvailable;
  return {controller,calls,requests,set planData(v){planData=v},set released(v){released=v},set mutate(v){mutate=v},changeNativeOnly(){nativeRevision++},get frame(){return frame;},set frame(v){frame=v;},set active(v){active=v;}};
}

test('local model never runs software operations, even when the node advertises them',async()=>{
  const x=setup();assert.equal(await x.controller.send('跳到第30帧'),false);
  assert.equal(x.requests.length,0);assert.equal(x.frame,4);assert.match(x.controller.state.error,/只支持对话和提示词优化/);
});

test('proposal holds private token and requires a genuine native confirmation before changing frame',()=>{
  const x=setup();assert.equal(x.controller.prepareQwenSeek(30),true);assert.equal(x.frame,4);
  assert.equal(JSON.stringify(x.controller.state).includes('private-preview'),false);
  assert.equal(x.controller.confirmQwenSeek({trusted:false}),false);assert.equal(x.frame,4);assert.ok(x.controller.state.qwenSeekProposal);
  assert.equal(x.controller.confirmQwenSeek({trusted:true}),true);assert.equal(x.frame,30);assert.equal(x.controller.state.qwenSeekCanUndo,true);
  assert.equal(JSON.stringify(x.controller.state).includes('private-undo'),false);
  assert.equal(x.controller.confirmQwenSeek({trusted:true}),false);assert.equal(x.frame,30);
  assert.equal(x.controller.undoQwenSeek({trusted:false}),false);assert.equal(x.frame,30);assert.equal(x.controller.state.qwenSeekCanUndo,true);
  assert.equal(x.controller.undoQwenSeek({trusted:true}),true);assert.equal(x.frame,4);assert.equal(x.controller.undoQwenSeek({trusted:true}),false);
});

test('cancel, stale frame, model switch and reset do not commit an old proposal',()=>{
  let x=setup();assert.equal(x.controller.prepareQwenSeek(30),true);x.controller.cancelQwenSeek();assert.equal(x.controller.confirmQwenSeek({trusted:true}),false);assert.equal(x.frame,4);
  x=setup();assert.equal(x.controller.prepareQwenSeek(30),true);x.frame=5;assert.equal(x.controller.confirmQwenSeek({trusted:true}),false);assert.equal(x.frame,5);
  x=setup();assert.equal(x.controller.prepareQwenSeek(30),true);assert.equal(x.controller.reset(),true);assert.equal(x.controller.confirmQwenSeek({trusted:true}),false);assert.equal(x.frame,4);
  x=setup();assert.equal(x.controller.prepareQwenSeek(30),true);x.active=false;assert.equal(x.controller.confirmQwenSeek({trusted:true}),false);assert.equal(x.frame,4);
  x=setup();assert.equal(x.controller.prepareQwenSeek(30),true);assert.equal(x.controller.setModel('xai/grok-4.7'),true);assert.equal(x.controller.confirmQwenSeek({trusted:true}),false);assert.equal(x.frame,4);assert.equal(x.controller.state.qwenSeekProposal,null);
});

test('closing without a seek is a no-op; closing after commit discards native undo token',()=>{
  const x=setup();x.controller.state.status='原有状态';assert.equal(x.controller.cancelQwenSeek(),false);assert.equal(x.controller.state.status,'原有状态');
  assert.equal(x.controller.prepareQwenSeek(30),true);assert.equal(x.controller.confirmQwenSeek({trusted:true}),true);
  assert.equal(x.controller.cancelQwenSeek(),true);assert.deepEqual(x.calls.at(-1),['discardUndo','private-undo']);
  assert.equal(x.controller.undoQwenSeek({trusted:true}),false);assert.equal(x.frame,30);
});

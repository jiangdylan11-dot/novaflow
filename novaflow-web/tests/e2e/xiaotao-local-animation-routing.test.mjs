import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

function fixture(discussion,{realTask=false,active=true,communityEnabled=false}={}) {
  const requests=[],executed=[],opened=[];
  const root={console,TextEncoder,AbortController,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,
    localStorage:{getItem:()=>null,setItem(){}},atob:s=>Buffer.from(s,'base64').toString('binary')};
  root.window=root;
  const vm=createContext(root);
  if(realTask)runInContext(readFileSync(new URL('../../renderer/xiaotao-upload.js',import.meta.url),'utf8'),vm);
  else root.NovaFlowXiaotaoUpload={positiveTaskText:s=>s,inferTask:()=>({surface:'animation',mode:'native_edit',discussion,named:[]}),planRoutes:()=>({place:[],reject:[]})};
  root.NovaFlowSkeletonEditor={active:()=>active};
  runInContext(readFileSync(new URL('../../renderer/foart-tool-contract.js',import.meta.url),'utf8'),vm);
  root.NovaFlowFoartTools={capture:()=>({schema:'nf.foart.tool-plan.v1',controls:[],animation:{active:true,loaded:true,bones:[{name:'hair'}],animations:['idle'],animation:'idle'}}),
    images:async()=>[],settlePending:async()=>null,setUploads(){},open:async surface=>{opened.push(surface);return {action:'open',surface,phase:'opened',reused:true};},execute:async op=>{executed.push(op);return {action:op.action,phase:'applied'};}};
  runInContext(readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'),vm);
  const bridge={clearPrepared(){},captureChat:()=>({artContext:{surface:'animation'},images:[]}),captureAny:()=>({artContext:{surface:'animation'},images:[]}),hasResult:()=>false};
  const api=()=>({promptAssistantGetStatus:async()=>({ok:true,result:{available:true,features:{qwen35CpuTrial:communityEnabled}}}),artAgentChat:async payload=>{requests.push(JSON.parse(JSON.stringify(payload)));return payload.mode==='foart'
    ? {ok:true,data:{resourcesReleased:true,toolPlan:{schema:'nf.foart.tool-plan.v1',status:'clarify',reply:'请说明想怎样调整。',operations:[]}}}
    : {ok:true,data:{reply:'可以先讨论。',history:[]}};}});
  return {controller:root.NovaFlowXiaotaoArtAgent.createController({bridge,api}),requests,executed,opened,api:root.NovaFlowXiaotaoArtAgent};
}

test('Qwen refuses animation writes before model planning or execution',async()=>{
  const {controller,requests,executed}=fixture(false,{communityEnabled:true});
  await controller.calibrateLocalStatus();
  assert.equal(await controller.send('把头发摆动调大一点'),false);
  assert.match(controller.state.error,/只支持对话和提示词优化/);
  assert.equal(controller.state.modelId,'qwen3.5-9b-heretic');assert.equal(controller.state.provider,'local');
  assert.deepEqual(requests,[]);assert.deepEqual(executed,[]);
});

test('community models reject every non-image attachment and expose only attachment metadata',async()=>{
  const {controller,requests,api}=fixture(true,{communityEnabled:true});
  assert.equal(controller.state.modelId,'qwen3.5-9b-heretic');
  await controller.calibrateLocalStatus();
  for(const kind of ['video','audio','document','']){
    controller.state.staged=[{kind,name:'test.bin',dataUrl:'secret-content',file:{private:'bytes'}}];
    assert.equal(await controller.send('你好'),false,kind);assert.match(controller.state.error,/非图片附件/);
  }
  assert.equal(requests.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(api.communityAttachmentMetadata('qwen3.5-9b-heretic',
    [{kind:'image',name:'image.png',dataUrl:'secret'}],[{kind:'audio',name:'old.wav',file:{secret:'bytes'}}]))),
    [{kind:'image',name:'image.png'},{kind:'audio',name:'old.wav'}]);
  assert.equal(api.communityAttachmentMetadata('next',[{kind:'audio'}]),null);
});

test('local animation discussion remains chat and does not execute native tools',async()=>{
  const {controller,requests,executed}=fixture(true,{communityEnabled:true});
  await controller.calibrateLocalStatus();
  assert.equal(await controller.send('如何让头发更自然？'),true);
  assert.equal(requests.length,1);assert.equal(requests[0].mode,'chat');assert.deepEqual(executed,[]);
});

test('Qwen short editing requests do not execute unverified animation edits',async()=>{
  for(const text of ['头发再飘一点，身体别动','动作快点，但总时长不变']){
    const {controller,requests,opened,executed}=fixture(false,{realTask:true,communityEnabled:true});
    await controller.calibrateLocalStatus();
    assert.equal(await controller.send(text),false,text);
    assert.match(controller.state.error,/只支持对话和提示词优化/);assert.deepEqual(requests,[]);assert.deepEqual(opened,[]);assert.deepEqual(executed,[]);
  }
  const ambiguous=fixture(false,{realTask:true,communityEnabled:true});await ambiguous.controller.calibrateLocalStatus();
  assert.equal(await ambiguous.controller.send('让动作好看一点'),true);
  assert.equal(ambiguous.requests[0].mode,'chat');assert.deepEqual(ambiguous.opened,[]);assert.deepEqual(ambiguous.executed,[]);
  assert.match(ambiguous.controller.state.messages.at(-1).content,/未操作软件/);
});

test('community short animation edits are stopped before planning or execution',async()=>{
  for (const message of ['头发再飘一点，身体别动','当前 idle 动画的动作快一点，总时长不变']) {
    const {controller,requests,opened}=fixture(false,{realTask:true,communityEnabled:true});
    assert.equal(controller.state.modelId,'qwen3.5-9b-heretic');
    await controller.calibrateLocalStatus();
    assert.equal(await controller.send(message),false);
    assert.match(controller.state.error,/只支持对话和提示词优化/);
    assert.deepEqual(requests,[]);assert.deepEqual(opened,[]);
  }
});

test('discussion, unrelated chat and an explicitly targeted video do not become animation edits',async()=>{
  for(const text of ['如何让头发更自然？','今天天气很好']){
    const {controller,requests,opened}=fixture(false,{realTask:true,communityEnabled:true});
    await controller.calibrateLocalStatus();
    assert.equal(await controller.send(text),true,text);assert.equal(requests[0].mode,'chat',text);assert.deepEqual(opened,[]);
  }
  const video=fixture(false,{realTask:true,communityEnabled:true});await video.controller.calibrateLocalStatus();
  assert.equal(await video.controller.send('把视频音量调低'),true);
  assert.equal(video.requests[0].mode,'chat');assert.deepEqual(video.opened,[]);assert.deepEqual(video.executed,[]);
  assert.match(video.controller.state.messages.at(-1).content,/未操作软件/);
  const inactive=fixture(false,{realTask:true,active:false,communityEnabled:true});await inactive.controller.calibrateLocalStatus();
  assert.equal(await inactive.controller.send('头发再飘一点，身体别动'),false);
  assert.match(inactive.controller.state.error,/只支持对话和提示词优化/);assert.deepEqual(inactive.requests,[]);assert.deepEqual(inactive.opened,[]);
});

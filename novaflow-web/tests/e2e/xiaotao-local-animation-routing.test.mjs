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
  const controller=root.NovaFlowXiaotaoArtAgent.createController({bridge,api});controller.setModel('qwen3.5-9b-heretic');// 小桃 opens on 豆包; pick the local brain.
  return {controller,requests,executed,opened,api:root.NovaFlowXiaotaoArtAgent};
}

test('community models reject every non-image attachment and expose only attachment metadata',async()=>{
  const {controller,requests,api}=fixture(true,{communityEnabled:true});
  assert.equal(controller.state.modelId,'qwen3.5-9b-heretic');
  await controller.calibrateLocalStatus();
  for(const kind of ['video','audio','document','']){
    controller.state.staged=[{kind,name:'test.bin',dataUrl:'secret-content',file:{private:'bytes'}}];
    // The local brain never shows an error box; it answers in plain words.
    assert.equal(await controller.send('你好'),false,kind);assert.equal(controller.state.error,'');assert.match(controller.state.messages.at(-1).content,/非图片附件/);
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


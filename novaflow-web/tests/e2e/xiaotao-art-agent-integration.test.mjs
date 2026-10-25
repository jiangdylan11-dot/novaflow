import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';
import { computeArtAgentFingerprint } from '../../worker/src/flash-art-agent.mjs';

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const request=()=>{
  const payload={requestId:'agent-request-1234',message:'只改善鼻子和头发，保留已有光影。',history:[],
    artContext:{provider:'local',mode:'img2img',engine:'qwen-2.1',localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo',nsfw:false,
      prompt:'将图1按图2画风重绘',negativePrompt:'keep this, literally',width:1280,height:960,referenceRoles:['subject','style']},
    images:[{dataUrl:PNG,role:'subject'},{dataUrl:PNG,role:'style'}]};
  payload.contextFingerprint=computeArtAgentFingerprint(payload);return payload;
};
const native=(name,args,id)=>({model:'flash-fixture',requestId:id,finishReason:'tool_calls',
  message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}});
function fixture({releaseError=false,waitForAbort=false}={}){
  const events=[],entered={};entered.promise=new Promise(resolve=>{entered.resolve=resolve;});
  let round=0;
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['flash-fixture']}},comfyUrls:[],
    lifecycle:{load:async()=>({ok:true}),unload:async()=>({released:true})},legacyApi:{stop:async()=>{}},
    sessionFactory:()=>({withSession:async(callback,{signal})=>{
      events.push('load');
      try{
        const value=await callback({identity:{id:'flash-fixture'},inferConversation:async input=>{
          events.push('infer');round++;
          if(waitForAbort){entered.resolve();await new Promise((resolve,reject)=>{
            if(signal.aborted)return reject(signal.reason);
            signal.addEventListener('abort',()=>reject(signal.reason||Error('cancelled')),{once:true});
          });}
          if(round===1)return native('get_art_context',{},'call-context');
          const observed=JSON.parse(input.messages.findLast(message=>message.role==='tool').content);
          return native('propose_art_direction',{contextFingerprint:observed.contextFingerprint,
            prompt:'Redraw <image1> with the drawn form language of <image2>.',sourceContent:'A woman holds a coffee in an airport.',
            renderingClass:'anime',explanation:'只调整绘画塑造，保留光影。'},'call-proposal');
        }});
        assert.equal(value.data.proposal.resourcesReleased,undefined,'model/tool cannot grant handoff credentials');
        if(releaseError)throw Object.assign(Error('release pending'),{errorCode:'strata-release-unconfirmed'});
        return {value,identity:{id:'flash-fixture',verification:'server-model-id'},timing:{loadMs:1,callbackMs:2,unloadMs:1}};
      }finally{events.push('unload');}
    }})});
  return {assistant,events,entered};
}

test('Agent proposal becomes generation-ready only after release and retains raw negative/native text',async()=>{
  const {assistant,events}=fixture(),payload=request(),reply=await assistant.artAgentChat(payload);
  assert.equal(reply.ok,true);assert.deepEqual(events,['load','infer','infer','unload']);
  assert.equal(reply.data.proposal.resourcesReleased,true);assert.equal(reply.data.proposal.generationReady,true);
  assert.equal(reply.data.proposal.modelIdentity.id,'flash-fixture');assert.equal(reply.data.proposal.cfg,3);
  assert.equal(reply.data.proposal.prompt,'Redraw <image1> with the drawn form language of <image2>.');
  assert.equal(reply.data.proposal.negativePrompt,payload.artContext.negativePrompt);
  assert.deepEqual(reply.data.toolTrace.map(call=>call.name),['get_art_context','propose_art_direction']);
  assert.equal(assistant.status().artDirectionProtocol.version,'art-direction-v1');
  assert.equal(assistant.status().artDirectionProtocol.systemSHA256,'fac8d2aad6988ed1feffa0234ceef61a6269402c68b52f614098e894901ea4be');
  assert.equal(reply.data.proposal.styleProtocol.version,'agent-style-director-v1');
  assert.deepEqual(assistant.status().artAgent.styleProtocol,reply.data.proposal.styleProtocol);
});

test('unconfirmed release withholds the entire Agent proposal and blocks generation',async()=>{
  const {assistant}=fixture({releaseError:true});const reply=await assistant.artAgentChat(request());
  assert.equal(reply.ok,false);assert.equal(reply.errorCode,'strata-release-unconfirmed');assert.equal(reply.data,undefined);
  await assert.rejects(assistant.acquireGeneration('drawing'),/资源/);
});

test('Agent stop only cancels its matching current request',async()=>{
  const {assistant,events,entered}=fixture({waitForAbort:true}),payload=request();
  const running=assistant.artAgentChat(payload);await entered.promise;
  assert.equal((await assistant.artAgentStop({requestId:'another-request'})).ok,false);assert.equal(assistant.busy,true);
  const stopped=await assistant.artAgentStop({requestId:payload.requestId}),reply=await running;
  assert.equal(stopped.ok,true);assert.equal(stopped.released,true);assert.equal(reply.ok,false);
  assert.equal(events.at(-1),'unload');assert.equal(assistant.busy,false);
});

test('browser Agent API stays local and cannot silently dispatch to cloud compute',async()=>{
  const source=await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
  const requests=[],storage=new Map(),pair='a'.repeat(64);
  const make=local=>createDomSandbox({Response,Request,Blob,FormData,AbortSignal,Event,
    location:{hash:local?'#local-pair='+pair:'',pathname:'/',search:''},history:{replaceState(){}},
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    NOVAFLOW_WEB_CONFIG:{localAssistant:local,localOrigin:'http://127.0.0.1:4784',controlUrl:'https://control.test'},
    fetch:async(url,init)=>{requests.push({url:String(url),init});return Response.json({ok:true});}});
  const local=make(true);runInContext(source,createContext(local));
  await local.electronAPI.artAgentChat({message:'test'});
  assert.equal(requests.at(-1).url,'http://127.0.0.1:4784/local/prompt-assistant/art-agent-chat');
  assert.equal(requests.at(-1).init.headers['x-novaflow-local'],pair);
  await local.electronAPI.artAgentStop({requestId:'agent-request-1234'});
  assert.equal(requests.at(-1).url,'http://127.0.0.1:4784/local/prompt-assistant/art-agent-stop');
  const shared=make(false);runInContext(source,createContext(shared));const before=requests.length;
  assert.equal((await shared.electronAPI.artAgentChat({message:'test'})).ok,false);
  assert.equal((await shared.electronAPI.artAgentStop({})).ok,false);assert.equal(requests.length,before);
});

test('formal UI whole-source subject/background pair enters frozen v1 once instead of legacy analysis',async()=>{
  let nativeCalls=0,legacyCalls=0;
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['flash-fixture']}},comfyUrls:[],
    lifecycle:{load:async()=>({ok:true}),unload:async()=>({released:true})},
    legacyApi:{runWithFlashSession:async()=>{legacyCalls++;return {ok:false};}},
    sessionFactory:()=>({withSession:async callback=>({value:await callback({identity:{id:'flash-fixture'},infer:async input=>{
      nativeCalls++;assert.equal(input.stage,'art-style-native-art-direction-v1');
      return {model:'flash-fixture',requestId:'native-whole-source',text:JSON.stringify({sourceContent:'The source woman holds coffee in the airport.',
        prompt:'Redraw <image1> using the drawn language of <image2>. The source woman holds coffee in the airport.',renderingClass:'anime'})};}}),identity:{id:'flash-fixture'},timing:{}})})});
  const payload={surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',nsfw:false,currentPrompt:'图1人物与机场，图2画风',
    negativePrompt:'literal negative',images:[{dataUrl:PNG},{dataUrl:PNG}],artContext:{task:'auto',width:1280,height:960,
      references:[{source:1,role:'auto',roles:['background','subject']},{source:2,role:'auto',roles:['style']}]}};
  const result=await assistant.reverseImagePrompt(payload);
  assert.equal(result.ok,true);assert.equal(nativeCalls,1);assert.equal(legacyCalls,0);
  assert.equal(result.data.nativeAnalysis.systemSHA256,'fac8d2aad6988ed1feffa0234ceef61a6269402c68b52f614098e894901ea4be');
  assert.deepEqual(result.data.nativeAnalysis.inputRoleNormalization.references[0].roles,['background','subject']);
  assert.equal(result.data.artDirection.editEnhancer.generationReady,true);
  await assistant.reverseImagePrompt({...payload,artContext:{...payload.artContext,references:[{source:1,roles:['subject','pose']},payload.artContext.references[1]]}});
  assert.equal(legacyCalls,1,'an independent pose responsibility must keep its existing planner');
});

test('Xiaotao online intelligence uses the authenticated text gateway without sending images or local credentials',async()=>{
  const source=await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8'),requests=[];
  const storage=new Map([['novaflow.client.auth.session.v1',JSON.stringify({session:{token:'fixture-account-token'}})]]);
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,AbortSignal,AbortController,Event,
    crypto:{randomUUID:()=> 'cloud-conversation-1234'},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    NOVAFLOW_WEB_CONFIG:{localAssistant:false,authUrl:'https://auth.test',controlUrl:'https://control.test'},
    fetch:async(url,init)=>{requests.push({url:String(url),init});return Response.json({ok:true,quota:{remaining_count:9},
      grok:{result:{model:'cloud-fixture',choices:[{finish_reason:'stop',message:{role:'assistant',content:'你好，我是小桃AI。'}}]}}});}});
  runInContext(source,createContext(sandbox));
  const payload={provider:'api',mode:'chat',requestId:'cloud-request-1234',message:'你好',history:[],artContext:{surface:'drawing',prompt:'a painting',unrelatedSecret:'must not send'}};
  const reply=await sandbox.electronAPI.artAgentChat(payload);
  assert.equal(reply.ok,true);assert.equal(reply.data.reply,'你好，我是小桃AI。');assert.equal(reply.data.proposal,undefined);
  assert.equal(reply.data.capabilities.textOnly,true);assert.equal(reply.data.quota.remaining_count,9);
  const call=requests.at(-1);assert.equal(call.url,'https://auth.test/api/provider/grok/chat');
  assert.equal(call.init.headers.Authorization,'Bearer fixture-account-token');assert.equal(call.init.headers['x-novaflow-local'],undefined);
  const body=JSON.parse(call.init.body);assert.equal(body.messages.at(-1).content.includes('must not send'),false);
  assert.match(body.messages[0].content,/你是 NovaFlow 的小桃AI/);assert(!body.messages[0].content.includes('小猴'));
  assert.equal(JSON.stringify(body).includes('data:image'),false);
  const before=requests.length;
  assert.equal((await sandbox.electronAPI.artAgentChat({...payload,requestId:'cloud-images-1234',images:[{dataUrl:PNG}]})).ok,false);
  assert.equal(requests.length,before,'unsupported image chat must fail before a metered cloud call');
  assert.equal((await sandbox.electronAPI.artAgentChat(payload)).ok,false,'a duplicate request must not charge another call');
  assert.equal(requests.length,before);
});

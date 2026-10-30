import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
import {createFlashArtAgent,canonicalArtAgentJSON,prepareFlashArtAgentPayload} from '../../worker/src/flash-art-agent.mjs';
import {validateMediaOperations} from '../../worker/src/flash-media-agent.mjs';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';
const source=await readFile(new URL('../../renderer/xiaotao-media-agent.js',import.meta.url),'utf8');
const agentSource=await readFile(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
function request() {
  const artContext={surface:'media',sub:'audio',audio:{selected:'clip-1',tracks:[]}};
  return {requestId:randomUUID(),mode:'media',provider:'local',message:'把选中的音频音量设成 50%',history:[],artContext,images:[],
    contextFingerprint:createHash('sha256').update(canonicalArtAgentJSON({schema:'nf.flash.art-agent.snapshot.v1',artContext,images:[]})).digest('hex')};
}
function flash(payload,operations=[{action:'volume',target:'audio',clipId:'clip-1',value:.5}]) {
  return {identity:{id:'test-flash'},inferConversation:async()=>({model:'test-flash',requestId:randomUUID(),finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id:randomUUID(),type:'function',function:{name:'control_media',arguments:JSON.stringify({contextFingerprint:payload.contextFingerprint,explanation:'将调整选中的音频音量。',operations})}}]}})};
}
test('media preflight binds timeline to snapshot; native plan is pending, not a fabricated result',async()=>{
  const p=request(),agent=createFlashArtAgent();
  const result=await agent.run({payload:p,flash:flash(p)});
  assert.equal(result.mediaPlan.operations[0].value,.5);assert.equal(result.resourcesReleased,undefined);
  assert.equal(result.toolTrace[0].result.executionPending,true);
  assert.throws(()=>prepareFlashArtAgentPayload({...p,artContext:{...p.artContext,sub:'video'}}),/变化/);
  await assert.rejects(agent.run({payload:p,flash:flash(p)}),/请求/);
});
test('explicit media commands require a real tool while missing material may ask a question',async()=>{
  const p=request(),agent=createFlashArtAgent();
  let input;
  const model={identity:{id:'test-flash'},inferConversation:async value=>{input=value;return {model:'test-flash',requestId:randomUUID(),finishReason:'stop',message:{role:'assistant',content:'将调整音量。'}};}};
  await assert.rejects(agent.run({payload:p,flash:model}),/实际执行工具/);assert.equal(input.toolChoice,'required');
  model.inferConversation=async()=>({model:'test-flash',requestId:randomUUID(),finishReason:'tool_calls',message:{role:'assistant',tool_calls:[{id:randomUUID(),type:'function',function:{name:'ask_media_question',arguments:JSON.stringify({question:'请先选择一个音频片段。'})}}]}});
  const result=await agent.run({payload:{...p,requestId:randomUUID()},flash:model});assert.equal(result.needsInput,true);assert.equal(result.mediaPlan,undefined);
});
test('invalid, chained generation and unknown tool fields fail before application writes',()=>{
  for(const operations of [[],[{action:'shell',target:'audio'}],[{action:'rate',target:'video',value:0}],
    [{action:'trim',target:'video',start:4,end:1}],[{action:'generate_sfx',target:'audio',prompt:'wind',seconds:31}],
    [{action:'volume',target:'audio',value:.5,path:'C:/other'}],
    [{action:'generate_video',target:'video'},{action:'export',target:'video'}]])assert.throws(()=>validateMediaOperations(operations));
});
test('media actions become generation ready only after the owned model session releases',async()=>{
  const p=request(),events=[];
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['test-flash']}},comfyUrls:[],legacyApi:{stop:async()=>{}},
    lifecycle:{load:async()=>({ok:true}),unload:async()=>({released:true})},sessionFactory:()=>({withSession:async callback=>{
      events.push('load');const value=await callback(flash(p));assert.equal(value.data.resourcesReleased,undefined);events.push('release');
      return {value,identity:{id:'test-flash'},timing:{loadMs:1,callbackMs:1,unloadMs:1}};
    }})});
  const result=await assistant.artAgentChat(p);assert.equal(result.ok,true,result.error);assert.deepEqual(events,['load','release']);
  assert.equal(result.data.generationReady,true);assert.equal(result.data.resourcesReleased,true);
});
test('actual timeline edit adapter changes trims, movement and rate; rejects overlap without mutation',()=>{
  const ctx=vm.createContext({console,setTimeout});vm.runInContext(source,ctx);
  const clip={id:'clip-1',name:'clip',start:0,offset:0,end:6,length:6,rate:1,source:{durationSec:6}},other={id:'other',start:8,length:2};
  let selected=clip,commits=0;
  const editor={state:{tracks:[{id:'track',clips:[clip,other]}]},pause(){},selectedClip:()=>selected,select:id=>selected=id===clip.id?clip:null,
    syncLength:c=>c.length=(c.end-c.offset)/c.rate,commitEdit:()=>commits++};
  const edit=ctx.NovaFlowMediaAgent.edit;
  edit(editor,{action:'trim',target:'video',clipId:'clip-1',start:1,end:5});assert.equal(clip.length,4);
  edit(editor,{action:'rate',target:'video',clipId:'clip-1',value:2});assert.equal(clip.length,2);
  edit(editor,{action:'move',target:'video',clipId:'clip-1',at:3});assert.equal(clip.start,3);
  const before=JSON.stringify(clip);assert.throws(()=>edit(editor,{action:'move',target:'video',clipId:'clip-1',at:7}),/重叠/);
  assert.equal(JSON.stringify(clip),before);assert.equal(commits,3);
  assert.throws(()=>edit(editor,{action:'volume',target:'video',clipId:'clip-1',value:.5}),/音频编辑器/);
});
test('controller routes media before drawing consent and reports the actual execution receipt',async()=>{
  const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,atob,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController});
  vm.runInContext(source,ctx);vm.runInContext(agentSource,ctx);
  let executions=0,requestMode='';
  ctx.NovaFlowMediaAgent.capture=()=>({artContext:{surface:'media'},images:[]});
  ctx.NovaFlowMediaAgent.execute=async()=>{executions++;return {results:[{ok:true,action:'volume',target:'audio'}]};};
  const controller=ctx.NovaFlowXiaotaoArtAgent.createController({bridge:{},api:()=>({artAgentChat:async p=>{
    requestMode=p.mode;return {ok:true,data:{reply:'将调整音量。',resourcesReleased:true,generationReady:true,analysisBackend:'strata',
      mediaPlan:{contextFingerprint:p.contextFingerprint,operations:[{action:'volume',target:'audio',value:.5}]}}};
  }})});
  assert.equal(await controller.send('把音频音量调到50%'),true);assert.equal(requestMode,'media');assert.equal(executions,1);
  assert.match(controller.state.messages.at(-1).content,/已调整音量/);
  assert.equal(await controller.send('音频音量怎么调？'),true);assert.equal(executions,1);
});
test('execution rechecks actual timeline and refuses stale or replayed plans before a second write',async()=>{
  const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,atob,setTimeout,clearTimeout,setInterval,clearInterval,AbortController});
  vm.runInContext(source,ctx);vm.runInContext(agentSource,ctx);
  let writes=0;
  const clip={id:'audio-clip',name:'audio',kind:'import',start:0,offset:0,end:2,length:2,gain:1};
  const editor={state:{tracks:[{id:'track',kind:'audio',clips:[clip]}]},pause(){},selectedClip:()=>clip,setGain:(_id,value)=>{clip.gain=value;writes++;}};
  ctx.NovaFlowAudioStudio={editor:()=>editor,resources:()=>[],sub:()=> 'audio',open(){}};
  const media=ctx.NovaFlowMediaAgent,fingerprint=ctx.NovaFlowXiaotaoArtAgent.fingerprint;
  let snapshot=media.capture(),stamp=await fingerprint(snapshot);
  const plan={planId:'one',contextFingerprint:stamp,operations:[{action:'volume',target:'audio',clipId:clip.id,value:.5}]};
  assert.equal((await media.execute(plan,{snapshot,fingerprint})).ok,true);assert.equal(clip.gain,.5);
  await assert.rejects(media.execute(plan,{snapshot,fingerprint}),/已执行/);assert.equal(writes,1);
  snapshot=media.capture();stamp=await fingerprint(snapshot);clip.gain=.8;
  await assert.rejects(media.execute({...plan,planId:'two',contextFingerprint:stamp},{snapshot,fingerprint}),/已变化/);assert.equal(writes,1);
});
test('video completion receipt includes only outputs belonging to its actual prompt',async()=>{
  const ctx=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,atob,setTimeout,clearTimeout,setInterval,clearInterval,AbortController});
  vm.runInContext(source,ctx);vm.runInContext(agentSource,ctx);
  let status={state:'idle',promptId:''},resources=[];
  ctx.NovaFlowAudioStudio={sub:()=> 'video',open(){},resources:()=>[]};
  ctx.NovaFlowAiSequenceGeneration={capture:()=>({mode:'local'}),status:()=>status,resources:()=>resources,setRequest(){},submit:async()=>{
    status={state:'done',promptId:'owned-task'};resources=[{id:'local-unrelated-import',name:'unrelated.mp4'},{id:'owned-task:output:video.mp4',name:'actual.mp4'}];
  }};
  const media=ctx.NovaFlowMediaAgent,fingerprint=ctx.NovaFlowXiaotaoArtAgent.fingerprint,snapshot=media.capture();
  const result=await media.execute({planId:'video-plan',contextFingerprint:await fingerprint(snapshot),operations:[{action:'generate_video',target:'video'}]},{snapshot,fingerprint});
  assert.equal(result.results[0].resources.length,1);assert.equal(result.results[0].resources[0].name,'actual.mp4');
});
test('stopping during media fingerprinting cannot send a late model request',async()=>{
  let release,entered;
  const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const crypto={randomUUID,subtle:{digest:async(...args)=>{entered();await waiting;return webcrypto.subtle.digest(...args);}}};
  const ctx=vm.createContext({crypto,TextEncoder,Uint8Array,atob,setTimeout,clearTimeout,setInterval,clearInterval,AbortController});
  vm.runInContext(source,ctx);vm.runInContext(agentSource,ctx);
  let requests=0;
  const controller=ctx.NovaFlowXiaotaoArtAgent.createController({bridge:{},api:()=>({artAgentStop:async()=>({ok:true}),artAgentChat:async()=>{requests++;}})});
  const pending=controller.send('请导出视频时间轴');await started;await controller.stop();release();
  assert.equal(await pending,false);assert.equal(requests,0);assert.equal(controller.state.pending,false);
});

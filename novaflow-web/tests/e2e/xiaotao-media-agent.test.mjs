import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
import {createFlashArtAgent,canonicalArtAgentJSON,prepareFlashArtAgentPayload} from '../../worker/src/flash-art-agent.mjs';
import {validateMediaOperations} from '../../worker/src/flash-media-agent.mjs';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';
import {collectOutputs} from '../../worker/src/comfy/comfy-client.mjs';
const source=await readFile(new URL('../../renderer/xiaotao-media-agent.js',import.meta.url),'utf8');
const agentSource=await readFile(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');

test('reference video/image/audio previews cannot become generated task outputs',()=>{
  const outputs=collectOutputs({outputs:{14:{images:[{filename:'generated.mp4',subfolder:'video',type:'output'}]},
    20:{images:[{filename:'source.png',type:'input'}]},21:{images:[{filename:'source.mp4',type:'input'}]},
    25:{audio:[{filename:'source.wav',type:'input'}]},30:{images:[{filename:'preview.png',type:'temp'}]}}});
  assert.deepEqual(outputs.map(f=>f.filename),['generated.mp4','preview.png']);
  assert.equal(outputs[0].nodeId,'14');
});
test('the literal user loop-animation request is actionable on both client and planner',async()=>{
  const ctx=vm.createContext({console});vm.runInContext(source,ctx);
  assert.equal(ctx.NovaFlowMediaAgent.discussionOnly('做一个2秒的循环动画'),false);
  assert.equal(ctx.NovaFlowMediaAgent.discussionOnly('只讨论一个2秒的循环动画方案，不要生成'),true);
  const p=request();p.message='做一个2秒的循环动画';let input;const model=flash(p,[{action:'generate_video',target:'video',seconds:2,prompt:'A seamless loop.'}]),infer=model.inferConversation;
  model.inferConversation=async value=>{input=value;return infer(value);};
  const result=await createFlashArtAgent().run({payload:p,flash:model});assert.equal(input.toolChoice,'required');assert.equal(result.mediaPlan.operations[0].seconds,2);
});
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

test('multi-reference planning exposes original protocol and independent stable labels without leaking media bytes',async()=>{
  const ctx=vm.createContext({console});
  for(const file of ['h3-prompt-format.js','ai-sequence-minimax-h3-prompt.workflow.js','ai-sequence-h3-media.js'])vm.runInContext(await readFile(new URL('../../renderer/'+file,import.meta.url),'utf8'),ctx);
  vm.runInContext(source,ctx);
  const items=[{sourceId:'image-source',kind:'image',fileName:'ball.png',dataUrl:'data:image/png;base64,QQ=='},
    {sourceId:'video-source',kind:'video',fileName:'motion.mp4',dataUrl:'data:video/mp4;base64,Qg=='},
    {sourceId:'audio-source',kind:'audio',fileName:'tone.wav',durationSec:4,dataUrl:'data:audio/wav;base64,Qw=='}];
  const media=ctx.NovaFlowMediaAgent,refs=media.h3ReferenceContext(items);
  assert.equal(JSON.stringify(refs),JSON.stringify(media.h3ReferenceContext(items)));
  assert.deepEqual(Array.from(refs,r=>r.modelToken),['<Picture 1>','<Video 1>','<Audio 1>']);
  assert.equal(refs[2].seconds,4);assert.doesNotMatch(JSON.stringify(refs),/data:/);
  assert.equal(media.h3PromptProtocol('multi_reference').fields.length,6);assert.equal(media.h3PromptProtocol('first_last').fields.length,3);
  const p=request();p.artContext.generation=JSON.parse(JSON.stringify({mode:'minimax_h3_local',genType:'multi_reference',promptProtocol:media.h3PromptProtocol('multi_reference'),h3References:refs}));
  p.message='请用参考图1的外观、参考视频1的动作并复用参考音频1生成视频';
  p.contextFingerprint=createHash('sha256').update(canonicalArtAgentJSON({schema:'nf.flash.art-agent.snapshot.v1',artContext:p.artContext,images:[]})).digest('hex');
  const model=flash(p,[{action:'generate_video',target:'video',prompt:'Use <Picture 1>, <Video 1> and <Audio 1>.'}]),infer=model.inferConversation;let input;
  model.inferConversation=async value=>{input=value;return infer(value);};
  await createFlashArtAgent().run({payload:p,flash:model});
  assert.match(input.messages[0].content,/audio reuse\/reference/);assert.match(input.messages.at(-1).content,/audio-source/);
});

test('multi-reference audio reuse and audio reference preserve the original distinct generation routes',async()=>{
  const ctx=vm.createContext({console});for(const file of ['ai-sequence-minimax-h3.resource.js','ai-sequence-minimax-h3.workflow.js'])vm.runInContext(await readFile(new URL('../../renderer/'+file,import.meta.url),'utf8'),ctx);
  const bindings=[{key:'multi_ref_image_1',kind:'image',sourceId:'picture',modelToken:'<Picture 1>',fileName:'picture.png'},
    {key:'multi_ref_video_1',kind:'video',sourceId:'motion',modelToken:'<Video 1>',fileName:'motion.mp4'},
    {key:'multi_ref_audio_1',kind:'audio',sourceId:'sound',modelToken:'<Audio 1>',fileName:'sound.wav'}];
  const base={profile:'beta5_int8',mode:'r2v',width:480,height:864,durationSeconds:4,fps:24,steps:4,seed:12,
    resourceBindings:bindings,referenceImages:['picture.png'],referenceVideos:['motion.mp4'],referenceAudios:['sound.wav']};
  for(const [relation,retention,copy]of [['audio reuse','fully_copy',true],['audio reference','reference',false]]){
    const graph=ctx.NovaFlowAiSequenceMiniMaxH3Workflow.buildWorkflow({...base,prompt:`subject_definitions:\n<Subject 1> is a ball from <Picture 1>.\n<Audio 1> is a sound reference.\nsummary:\n[reference generation + ${relation}] Use <Subject 1>, <Video 1> and <Audio 1>.\nretention_analysis:\n<Audio 1>: ${retention} - Source sound.\ndetailed_description:\nA realistic style. [Shot 1] <Subject 1> rolls following <Video 1>.\noverall_soundscape:\n<Audio 1>\nnon_diegetic_music:\nN/A`});
    const nodes=Object.values(graph);assert.equal(nodes.filter(n=>n.class_type==='TrimAudioDuration').length,copy?1:0);
    assert.equal(nodes.filter(n=>n.class_type==='VAEDecodeAudio').length,copy?0:1);
    const condition=nodes.find(n=>n.class_type==='MiniMaxH3ReferenceToVideo');assert.equal(condition._meta.h3_bindings.length,3);
    assert.equal(nodes.filter(n=>['LoadImage','LoadVideo','LoadAudio'].includes(n.class_type)).length,3);
  }
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
  let status={state:'idle',promptId:''},resources=[],prompt='';
  ctx.__NovaFlowSmartAI={optimizeForAgent:async()=>({prompt:'Optimized video prompt.',displayPrompt:'优化后的视频提示词。',optimization:{framework:'minimax-h3'}})};
  ctx.NovaFlowAudioStudio={sub:()=> 'video',open(){},resources:()=>[]};
  ctx.NovaFlowAiSequenceGeneration={capture:()=>({mode:'local',prompt}),optimizationContext:async()=>({modelId:'minimax_h3_local',mode:'text_video',durationSeconds:2,resources:[]}),status:()=>status,resources:()=>resources,setRequest(op){prompt=op.prompt;},submit:async()=>{
    status={state:'done',promptId:'owned-task'};resources=[{id:'local-unrelated-import',name:'unrelated.mp4'},{id:'owned-task:output:video.mp4',name:'actual.mp4'}];
  }};
  const media=ctx.NovaFlowMediaAgent,fingerprint=ctx.NovaFlowXiaotaoArtAgent.fingerprint,snapshot=media.capture();
  const result=await media.execute({planId:'video-plan',contextFingerprint:await fingerprint(snapshot),operations:[{action:'generate_video',target:'video'}]},{snapshot,fingerprint});
  assert.equal(result.results[0].resources.length,1);assert.equal(result.results[0].resources[0].name,'actual.mp4');
  assert.equal(prompt,'优化后的视频提示词。');assert.equal(result.results[0].executedPrompt,'Optimized video prompt.');
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

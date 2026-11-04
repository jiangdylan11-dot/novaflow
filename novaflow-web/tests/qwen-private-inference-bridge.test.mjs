import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createPrivateInferenceBridge,createQwenPrivateInferenceBridge} from '../worker/src/qwen-private-inference-bridge.mjs';
import {createStrataPromptAssistant} from '../worker/src/strata-prompt-assistant.mjs';
import {createPromptAssistant,qwenBusinessPythonEnvironment} from '../worker/src/prompt-assistant.mjs';

const childEnvGuard=`import os
assert not any(k in os.environ for k in ('RUNNINGHUB_API_KEY','OPENAI_API_KEY','PYTHONPATH','FOART_FAKE_SECRET')), 'unsafe child environment'
`;
function fixtureChildEnvironment(extra={}) {
  const safe=qwenBusinessPythonEnvironment(process.env,{RUNNINGHUB_API_KEY:'fixture-sentinel',OPENAI_API_KEY:'fixture-sentinel',PYTHONPATH:'fixture-sentinel',FOART_FAKE_SECRET:'fixture-sentinel'});
  for(const key of ['RUNNINGHUB_API_KEY','OPENAI_API_KEY','PYTHONPATH','FOART_FAKE_SECRET'])assert.equal(Object.hasOwn(safe,key),false);
  return {...safe,PYTHONIOENCODING:'utf-8',...extra};
}
const system={role:'system',content:'保持图像顺序'}, user={role:'user',content:[{type:'text',text:'检查图片'}]};
const request=(callId='0123456789abcdef0123456789abcdef')=>({type:'qwen-infer-v1',requestId:1,callId,
  body:{model:'qwen35-heretic',messages:[system,user],stream:false,max_tokens:600,temperature:0,top_p:1,reasoning_effort:'none',reasoning_budget_tokens:0}});
const answer={model:'qwen35-heretic',requestId:'actual-model-id',finishReason:'stop',message:{role:'assistant',content:'可见一张图。'}};

test('private protocol preserves messages, role, sampling and rejects stale and extra operations',async()=>{
  const calls=[],writes=[];let current=true;
  const bridge=createQwenPrivateInferenceBridge({session:{identity:{id:'qwen35-heretic'},inferConversation:async value=>{calls.push(value);return answer;}},
    isCurrent:id=>current&&id===1,write:value=>writes.push(value)});
  await bridge(request());
  assert.deepEqual(calls[0].messages,[system,user]);assert.equal(calls[0].reasoningEffort,'none');
  assert.equal(writes[0].response.model,'qwen35-heretic');assert.equal(writes[0].response.choices[0].message.content,answer.message.content);
  await assert.rejects(bridge(request()));
  await bridge({...request('1123456789abcdef0123456789abcdef'),body:{...request().body,tools:[{}]}});
  assert.equal(writes[1].ok,false);assert.equal(calls.length,1);
  current=false;await assert.rejects(bridge(request('2123456789abcdef0123456789abcdef')));
});

test('late model result after cancellation is never written back',async()=>{
  let resolve,current=true,writes=0;
  const bridge=createQwenPrivateInferenceBridge({session:{identity:{id:'qwen35-heretic'},inferConversation:()=>new Promise(r=>resolve=r)},
    isCurrent:()=>current,write:()=>writes++});
  const pending=bridge(request());current=false;resolve(answer);await pending;assert.equal(writes,0);
});

test('opt-in business routes use Qwen owned lease and do not probe or unload Comfy',async()=>{
  const events=[];const flash={identity:{id:'qwen35-heretic'},infer:async()=>({text:'A calm soundscape',model:'qwen35-heretic'})};
  const qwenSession={withSession:async fn=>{events.push('load');try{return {value:await fn(flash),identity:flash.identity,timing:{callbackMs:5}};}finally{events.push('release');}}};
  const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},qwenSession,
    communityCpuTrialForDevelopment:true,qwenBusinessBridge:true,qwenBusinessReady:()=>true,comfyUrls:['http://127.0.0.1:8188'],
    fetchImpl:async()=>{events.push('unexpected-network');throw Error('not allowed');},
    legacyApi:{runWithFlashSession:async (received,method)=>{assert.equal(received.identity.id,'qwen35-heretic');events.push(method);return {ok:true,data:{method}};},stop:async()=>{}}});
  for(const method of ['optimizePrompt','reverseImagePrompt','describeArtStyle']){
    const result=await assistant[method]({requestId:`business-${method}`,assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'});assert.equal(result.ok,true);assert.equal(result.resourcesReleased,true);
    assert.equal(result.analysisBackend,'qwen-cpu');
  }
  const audio=await assistant.rewriteAudioPrompt({requestId:'business-audio',input:'平静的风声',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'});
  assert.equal(audio.ok,true);assert.equal(audio.analysisBackend,'qwen-cpu');assert.match(audio.prompt,/calm/);
  assert.equal(events.filter(x=>x==='load').length,4);assert.equal(events.filter(x=>x==='release').length,4);
  assert.ok(!events.includes('unexpected-network'));await assistant.stop();
});

test('missing Qwen fails explicitly without loading the former local model',async()=>{
  let called=false;const assistant=createStrataPromptAssistant({qwenBusinessBridge:true,qwenBusinessReady:()=>true,config:{},qwenConfig:{},gemmaConfig:{},sessionFactory:()=>({}),
    lifecycle:{load:async()=>{called=true;throw Error('unexpected');},unload:async()=>({ok:true,released:true})}});
  const result=await assistant.optimizePrompt({requestId:'missing-model-1',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'qwen-runtime-missing');assert.equal(called,false);
  await assistant.stop();
});

test('failed owned-model release never becomes a successful generation-ready response',async()=>{
  const error=Object.assign(new Error('release not confirmed'),{errorCode:'strata-release-unconfirmed',resourcesReleased:false});
  const assistant=createStrataPromptAssistant({worker:{getState:()=>({currentTaskId:null})},communityCpuTrialForDevelopment:true,
    qwenBusinessBridge:true,qwenBusinessReady:()=>true,qwenSession:{withSession:async fn=>{await fn({identity:{id:'qwen35-heretic'},infer:async()=>({text:'sound',model:'qwen35-heretic'})});throw error;}}});
  const result=await assistant.rewriteAudioPrompt({requestId:'release-fault-1',input:'风声',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'strata-release-unconfirmed');assert.notEqual(result.generationReady,true);
});

test('real Python FlashAdapter exchanges image and text over child pipes without a listening endpoint or key',async()=>{
  const python=`import os,sys,json\nos.environ['NOVAFLOW_PROMPT_ASSISTANT_BACKEND']='strata'\nos.environ['NOVAFLOW_QWEN_STDIO_BRIDGE']='v1'\nos.environ['NOVAFLOW_FLASH_MODEL_ID']='qwen35-heretic'\nos.environ['NOVAFLOW_FLASH_REASONING_EFFORT']='none'\nos.environ['NOVAFLOW_FLASH_REASONING_BUDGET_TOKENS']='0'\nfrom prompt_assistant.flash_adapter import FlashAdapter,begin_flash_request,end_flash_request\nfrom PIL import Image\nt=begin_flash_request(1)\ntry:\n result=FlashAdapter(max_new_tokens=600).generate_parts([Image.new('RGB',(2,2),'red'),'测试这张图'],system_text='用中文回答')\n print(json.dumps({'type':'done','result':result},ensure_ascii=False),flush=True)\nfinally:end_flash_request(t)`;
  const cwd=fileURLToPath(new URL('../../particle-editor-desktop/',import.meta.url));
  const child=spawn('python',['-u','-c',childEnvGuard+python],{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true,env:fixtureChildEnvironment()});
  let stderr='',received;child.stderr.setEncoding('utf8');child.stderr.on('data',s=>stderr+=s);
  const lines=createInterface({input:child.stdout});
  const bridge=createQwenPrivateInferenceBridge({session:{identity:{id:'qwen35-heretic'},inferConversation:async input=>{
    received=input;return answer;}},isCurrent:id=>id===1,write:frame=>child.stdin.write(JSON.stringify(frame)+'\n')});
  const done=new Promise((resolve,reject)=>{lines.on('line',line=>{let frame;try{frame=JSON.parse(line);}catch(e){reject(e);return;}
    if(frame.type==='qwen-infer-v1')void bridge(frame).catch(reject);else if(frame.type==='done')resolve(frame);});
    child.once('error',reject);child.once('exit',code=>{if(code!==0)reject(Error(`child exit ${code}: ${stderr}`));});});
  const timer=setTimeout(()=>child.kill(),10000);let result;try{result=await done;}finally{clearTimeout(timer);child.stdin.end();}
  assert.equal(result.result,answer.message.content);assert.deepEqual(received.messages[1].content.map(x=>x.type),['image_url','text']);
  assert.match(received.messages[1].content[0].image_url.url,/^data:image\/png;base64,/);
});

test('same Python business framing preserves context and image for two explicitly bound mock model adapters',async()=>{
  const service=fileURLToPath(new URL('./qwen-fake-business-service.py',import.meta.url));
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const seen=[];
  for(const id of ['qwen35-heretic','xai/grok-4.7']){
    let calls=0;
    const session={identity:{id},inferConversation:async input=>{calls++;seen.push(input.messages);return {...answer,model:id};}};
    assert.throws(()=>createPrivateInferenceBridge({session,expectedIdentity:'different-model',isCurrent:()=>true,write:()=>{}}));
    const runFixture=childEnvGuard+`import runpy,sys\nrunpy.run_path(sys.argv[1],run_name='__main__')\n`;
    const child=spawn('python',['-u','-c',runFixture,service],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:fixtureChildEnvironment({
      NOVAFLOW_PROMPT_ASSISTANT_BACKEND:'strata',NOVAFLOW_QWEN_STDIO_BRIDGE:'v1',NOVAFLOW_FLASH_MODEL_ID:id,
      NOVAFLOW_FLASH_REASONING_EFFORT:'none',NOVAFLOW_FLASH_REASONING_BUDGET_TOKENS:'0'})});
    let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',s=>stderr+=s);const lines=createInterface({input:child.stdout});
    const bridge=createPrivateInferenceBridge({session,expectedIdentity:id,isCurrent:n=>n===1,write:value=>child.stdin.write(JSON.stringify(value)+'\n')});
    const done=new Promise((resolve,reject)=>{lines.on('line',line=>{let frame;try{frame=JSON.parse(line);}catch(e){reject(e);return;}
      if(frame.type==='ready')child.stdin.write(JSON.stringify({id:1,command:'describeArtStyle',requirements:'保留轮廓和背景',images:[{dataUrl:image}]})+'\n');
      else if(frame.type==='qwen-infer-v1')void bridge(frame).catch(reject);else if(frame.id===1)resolve(frame);});
      child.once('error',reject);child.once('exit',code=>{if(code!==0)reject(Error(`child exit ${code}: ${stderr}`));});});
    const timer=setTimeout(()=>child.kill(),10000);let result;try{result=await done;}finally{clearTimeout(timer);child.stdin.end();}
    assert.equal(result.ok,true);assert.equal(result.data.model,id);assert.equal(result.data.style,answer.message.content);assert.equal(calls,1);
  }
  assert.deepEqual(seen[0],seen[1]);
  assert.equal(seen[0][1].content[1].text,'保留轮廓和背景');assert.match(seen[0][1].content[0].image_url.url,/^data:image\/png;base64,/);
});

test('worker stdout parser routes a Python business request through the owned Qwen session',async()=>{
  const serviceScript=fileURLToPath(new URL('./qwen-fake-business-service.py',import.meta.url)),events=[];
  const flash={identity:{id:'qwen35-heretic',path:serviceScript},infer:async()=>({text:'ok',model:'qwen35-heretic'}),
    inferConversation:async input=>{events.push(input);return answer;}};
  const qwenSession={withSession:async fn=>{events.push('load');try{return {value:await fn(flash),identity:flash.identity,timing:{callbackMs:2}};}finally{events.push('released');}}};
  const assistant=createPromptAssistant({worker:{getState:()=>({currentTaskId:null})},pythonPath:'python',serviceScript,
    runtimeJsonPath:fileURLToPath(new URL('./not-a-runtime.json',import.meta.url)),qwenSession,
    communityCpuTrialForDevelopment:true,qwenBusinessBridge:true,qwenBusinessReady:()=>true});
  const dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const result=await assistant.describeArtStyle({requestId:'bridge-describe-1',dataUrl,assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.analysisBackend,'qwen-cpu');assert.equal(result.resourcesReleased,true);
  assert.equal(result.style,answer.message.content);assert.equal(events[0],'load');assert.equal(events.at(-1),'released');
  assert.deepEqual(events[1].messages[1].content.map(x=>x.type),['image_url','text']);await assistant.stop();
});

test('four selected Qwen business methods preserve their existing output envelopes across the private bridge',async()=>{
  const serviceScript=fileURLToPath(new URL('./qwen-fake-business-service.py',import.meta.url));
  const flash={identity:{id:'qwen35-heretic',path:serviceScript},infer:async()=>({text:'soft wind sound',model:'qwen35-heretic'}),
    inferConversation:async()=>answer};
  const qwenSession={withSession:async fn=>({value:await fn(flash),identity:flash.identity,timing:{callbackMs:2}})};
  const assistant=createPromptAssistant({worker:{getState:()=>({currentTaskId:null})},pythonPath:'python',serviceScript,
    runtimeJsonPath:fileURLToPath(new URL('./not-a-runtime.json',import.meta.url)),qwenSession,
    communityCpuTrialForDevelopment:true,qwenBusinessBridge:true,qwenBusinessReady:()=>true});
  const selection={assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic'},dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const optimize=await assistant.optimizePrompt({...selection,prompt:'安静的湖',requirements:'保留构图'});
  assert.equal(optimize.ok,true,JSON.stringify(optimize));assert.equal(optimize.data.positivePrompt,answer.message.content);assert.equal(optimize.resourcesReleased,true);
  const reverse=await assistant.reverseImagePrompt({...selection,images:[{name:'test.png',dataUrl}],requirements:'描述图片'});
  assert.equal(reverse.ok,true,JSON.stringify(reverse));assert.equal(reverse.data.positivePrompt,answer.message.content);assert.equal(reverse.resourcesReleased,true);
  const style=await assistant.describeArtStyle({...selection,dataUrl});
  assert.equal(style.ok,true,JSON.stringify(style));assert.equal(style.style,answer.message.content);assert.equal(style.resourcesReleased,true);
  const audio=await assistant.rewriteAudioPrompt({...selection,input:'柔和的风声',kind:'sfx',seconds:2});
  assert.equal(audio.ok,true,JSON.stringify(audio));assert.match(audio.prompt,/soft wind/);assert.equal(audio.resourcesReleased,true);
  for(const result of [optimize,reverse,style,audio]){assert.equal(result.analysisBackend,'qwen-cpu');assert.match(result.learningWarning,/未读写经验/);}
  await assistant.stop();
});

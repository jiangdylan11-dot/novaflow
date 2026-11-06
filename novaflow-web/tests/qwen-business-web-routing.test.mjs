import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {validateTaskParameters} from '../packages/shared/src/control-plane.mjs';
import {validatePromptAssistantModelRoute} from '../worker/src/worker-core.mjs';
const source=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const start=source.indexOf('  async function selectedBusinessPrompt('), end=source.indexOf('  async function pooledPromptStatus(',start);
assert.ok(start>0 && end>start);const code=source.slice(start,end);
function harness({selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0},available=true,capabilitiesGate=null,postGate=null,uploadGate=null,waitGate=null,cancelFailure=false,sessionAvailable=true}={}) {
 let sessionEpoch=0;const listeners=new Set(),nodeListeners=new Set(),sessionListeners=new Set(),calls=[];
 const root={crypto:{randomUUID:()=> 'generated-1'},setTimeout,clearTimeout,addEventListener:(name,fn)=>{if(name==='novaflow:compute-node')nodeListeners.add(fn);if(name==='novaflow-client-auth-changed'||name==='storage')sessionListeners.add(fn)},removeEventListener:(name,fn)=>{nodeListeners.delete(fn);sessionListeners.delete(fn)},NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>selection && ({...selection}),subscribeBusinessModel:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)}}}}};
 const capture=()=>{if(!sessionAvailable)return null;const epoch=sessionEpoch;const guard=()=>epoch===sessionEpoch;guard.expiresAtMs=Date.now()+60000;return guard;};
 const scope={root,TextEncoder,TextDecoder,Map,Set,Date,Error,JSON,String,AbortController,typeof:undefined,SESSION_KEY:'primary',CLIENT_AUTH_KEY:'client',foartSessionObservers:new Set(),captureFoartSessionGuard:capture,computeNode:null,computeNodeEpoch:0,qwenBusinessAvailable:()=>available,pooledPromptRequests:new Map(),pooledConversationNodes:new Map(),tasks:new Map(),PROMPT_ASSISTANT_TIMEOUT_MS:1000,PROMPT_ASSISTANT_REFUSAL:'unavailable',taskMode:()=> 'shared',
   control:async(method,url,body)=>{calls.push({method,url,body});if(method==='GET'){if(capabilitiesGate)await capabilitiesGate;return {taskTypes:[{task_type:'prompt_assistant',available_workers:1}],features:{qwen35BusinessTrial:available}};}if(url==='/api/web/tasks'){if(postGate)await postGate;return {task:{id:'task-1'}};}if(url==='/api/web/tasks/task-1/cancel'){if(cancelFailure)throw Error('offline');return {ok:true};}throw Error('unexpected request');},
   putTaskInput:async(_id,_file,bytes,_type,guard)=>{calls.push({method:'PUT',url:'request.json'});if(uploadGate)await uploadGate;guard?.assertCurrent?.();scope.upload=JSON.parse(new TextDecoder().decode(bytes))},waitForTaskEnd:async()=>{if(waitGate)await waitGate;return {}},fetchTaskOutput:async()=>new TextEncoder().encode('{"ok":true}')};
 createContext(scope);runInContext(code+'\nglobalThis.invoke=selectedBusinessPrompt;',scope);const invoke=scope.invoke;scope.invoke=(action,payload={})=>invoke(action,action==='optimize-prompt' && payload.assistantSelectionScope==='xiaotao'?{surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',qwenPromptMode:'txt2img',...payload}:payload);return {scope,calls,change:()=>{for(const fn of [...listeners])fn();},switchNode:()=>{scope.computeNodeEpoch++;for(const fn of [...nodeListeners])fn();},switchSession:()=>{sessionEpoch++;for(const fn of [...scope.foartSessionObservers])fn();}};
}
const actions=['optimize-prompt','rewrite-audio-prompt'];
test('text-only web routes capture selected model and bind scheduler, payload and worker route',async()=>{
 for(const action of actions){const {scope,calls}=harness();const payload=action==='optimize-prompt'?{prompt:'safe sample'}:{kind:'sfx',input:'soft click',seconds:2};const result=await scope.invoke(action,{assistantSelectionScope:'xiaotao',...payload});assert.equal(result.ok,true);const created=calls.find(x=>x.url==='/api/web/tasks').body;
 assert.equal(created.parameters.assistant_model_id,'qwen3.5-9b-heretic');assert.equal(created.parameters.assistant_selection_scope,'xiaotao');const params=validateTaskParameters('prompt_assistant',{...created.parameters,references:created.references});
 assert.equal(params.model_id,'qwen3.5-9b-heretic-business-v1');assert.doesNotThrow(()=>validatePromptAssistantModelRoute({parameters:params,model_id:params.model_id},scope.upload));
 assert.equal(scope.upload.assistantProvider,'local');assert.equal(scope.upload.assistantModelId,'qwen3.5-9b-heretic');}
});
test('scoped image reverse and style requests fail before submitting a pool task',async()=>{
 for(const action of ['reverse-image-prompt','describe-art-style']){const {scope,calls}=harness();const result=await scope.invoke(action,{assistantSelectionScope:'xiaotao',dataUrl:'data:image/png;base64,YQ=='});assert.equal(result.ok,false);assert.equal(result.errorCode,action==='describe-art-style'?'style-analysis-unavailable':'qwen-business-text-only');assert.ok(!calls.some(x=>x.url==='/api/web/tasks'));assert.equal(scope.upload,undefined);}
});
test('scoped text routes reject non-text inputs and unsupported drawing contexts before submitting',async()=>{
 for(const extra of [{qwenPromptMode:'img2img'},{surface:'animation'},{images:[{dataUrl:'data:image/png;base64,YQ=='}]},{nested:{audio:{dataUrl:'data:audio/wav;base64,YQ=='}}},{prompt:'describe <image1>'},{prompt:'see @参考图1'}]){
  const {scope,calls}=harness();const result=await scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',prompt:'safe text',...extra});assert.equal(result.ok,false);assert.equal(result.errorCode,'qwen-business-text-only');assert.ok(!calls.some(x=>x.url==='/api/web/tasks'));assert.equal(scope.upload,undefined);
 }
 const {scope,calls}=harness();const result=await scope.invoke('rewrite-audio-prompt',{assistantSelectionScope:'xiaotao',kind:'sfx',input:'sound data:audio/wav;base64,YQ==',seconds:2});assert.equal(result.ok,false);assert.equal(result.errorCode,'qwen-business-text-only');assert.ok(!calls.some(x=>x.url==='/api/web/tasks'));
});
test('missing capability, absent selected model, paid selection and conflicting request never submit',async()=>{
 for(const opt of [{available:false},{selection:null},{selection:{provider:'api',modelId:'xai/grok-4.7',epoch:0}}]){const {scope,calls}=harness(opt);const result=await scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',prompt:'test'});assert.equal(result.ok,false);assert.ok(!calls.some(x=>x.url==='/api/web/tasks'));}
 const {scope,calls}=harness();const r=await scope.invoke('optimize-prompt',{assistantProvider:'api',assistantModelId:'xai/grok-4.7'});assert.equal(r.errorCode,'assistant-selection-mismatch');assert.equal(calls.length,0);
});
test('epoch-only scoped request without a selected model cannot take the legacy route',async()=>{
 const {scope,calls}=harness({selection:null});const result=await scope.invoke('optimize-prompt',{assistantSelectionEpoch:0,prompt:'safe text'});
 assert.equal(result.ok,false);assert.equal(result.errorCode,'assistant-selection-unavailable');assert.equal(calls.length,0);
});
test('invalid explicit selection scope cannot take a legacy or paid route',async()=>{
 const {scope,calls}=harness();const result=await scope.invoke('optimize-prompt',{assistantSelectionScope:'unknown',prompt:'safe text'});
 assert.equal(result.ok,false);assert.equal(result.errorCode,'invalid-request');assert.equal(calls.length,0);
});

test('controller captures an immutable per-tab selection rather than an archive or global preference',async()=>{
 const {webcrypto}=await import('node:crypto');const src=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
 const storage={getItem:()=>null,setItem(){}};const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:storage};root.window=root;
 createContext(root);runInContext(src,root);const controller=root.NovaFlowXiaotaoArtAgent.createController({bridge:{clearPrepared(){}},storage,api:()=>({})});
 controller.state.provider='local';controller.state.modelId='qwen3.5-9b-heretic';const snapshot=controller.businessModelSnapshot();
 let notifications=0;const unsubscribe=controller.subscribeBusinessModel(()=>notifications++);
 assert.equal(Object.isFrozen(snapshot),true);assert.equal(snapshot.epoch,0);
 assert.equal(controller.setModel('xai/grok-4.7'),true);assert.equal(controller.businessModelSnapshot().epoch,1);
 assert.equal(controller.setModel('qwen3.5-9b-heretic'),true);assert.equal(controller.businessModelSnapshot().epoch,2);
 assert.equal(snapshot.provider,'local');assert.equal(snapshot.modelId,'qwen3.5-9b-heretic');assert.equal(snapshot.epoch,0);assert.equal(notifications,2);unsubscribe();
});

test('actual Xiao optimization workflow accepts only the correct released Qwen identity and preserves backend',async()=>{
 const code=await readFile(new URL('../renderer/novaflow-smart-ai.js',import.meta.url),'utf8');const begin=code.indexOf('  function verifiedAgentPromptHandoff('),end=code.indexOf('  // H3 prompts kept in the prompt history',begin);assert.ok(begin>0&&end>begin);
 let sent;const reply={ok:true,modelPromptPolicy:'qwen21-native-rewrite-v3',data:{analysisBackend:'qwen-cpu',resourcesReleased:true,generationReady:true,modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},promptContract:'qwen21-native-rewrite-v3',translationValidation:'paired-prose-and-literals',displayPrompt:'红球',modelPromptLanguage:'en',modelPrompt:'a red ball'}};
 const sandbox={window:{crypto:{randomUUID:()=> 'id'},NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0})}}},electronAPI:{qwenBusinessAvailableSync:()=>true,qwen21NativeRewriteV3AvailableSync:()=>true,promptAssistantOptimizePrompt:async p=>{sent=p;return reply}}},
   shouldUseStructuredArtPromptContract:()=>false,protectSmartAiResourceMentions:text=>({text}),buildSmartAiRequirements:()=>'',
   readSmartAiResult:()=>({prompt:'红球',hasNegativePrompt:false}),restoreSmartAiResourceMentions:text=>({ok:true,text}),
   validateSmartAiArtPromptPreservation:()=>({ok:true})};createContext(sandbox);runInContext(code.slice(begin,end)+'\nglobalThis.run=optimizeForAgent;',sandbox);
 const result=await sandbox.run({surface:'art',assistantSelectionScope:'xiaotao',prompt:'红球',supportsNegativePrompt:false});assert.equal(sent.assistantSelectionScope,'xiaotao');assert.equal(sent.assistantProvider,'local');assert.equal(sent.assistantModelId,'qwen3.5-9b-heretic');assert.equal(sent.assistantSelectionEpoch,0);assert.equal(result.prompt,'a red ball');assert.equal(result.analysisBackend,'qwen-cpu');
 reply.data.modelIdentity.id='unverified-other';await assert.rejects(sandbox.run({surface:'art',assistantSelectionScope:'xiaotao',prompt:'红球',supportsNegativePrompt:false}));
 reply.data.modelIdentity.id='qwen35-heretic';reply.data.resourcesReleased=false;await assert.rejects(sandbox.run({surface:'art',assistantSelectionScope:'xiaotao',prompt:'红球',supportsNegativePrompt:false}));
});

test('unscoped existing feature calls preserve their legacy route without reading model selection',async()=>{
 const {scope,calls}=harness();const result=await scope.invoke('optimize-prompt',{prompt:'unscoped'});assert.equal(result.ok,true);
 const created=calls.find(x=>x.url==='/api/web/tasks').body;assert.equal(created.parameters.assistant_model_id,undefined);assert.equal(scope.upload.assistantModelId,undefined);
});

test('Xiao reverse and style report the text-only limitation without calling image APIs',async()=>{
 const {webcrypto}=await import('node:crypto');const src=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');const storage={getItem:()=>null,setItem(){}};const calls=[];
 const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:storage};root.window=root;createContext(root);runInContext(src,root);
 const api={qwenBusinessAvailableSync:()=>true,promptAssistantReverseImagePrompt:async()=>{calls.push('reverse')},promptAssistantDescribeArtStyle:async()=>{calls.push('style')}};
 const c=root.NovaFlowXiaotaoArtAgent.createController({bridge:{clearPrepared(){}},storage,api:()=>api});c.state.provider='local';c.state.modelId='qwen3.5-9b-heretic';c.state.staged=[{status:'ready',kind:'image',name:'one.png',previewUrl:'data:image/png;base64,YQ=='}];
 for(const action of ['reverse','style']){assert.equal(await c.analyzeStagedImage(action),false);// The local brain never shows an error box: the limitation arrives as its plain reply.
  assert.equal(c.state.error,'');const said=c.state.messages.at(-1).content;assert.match(said,/图片反推和画风分析尚未开放/);assert.match(said,/未提交/);assert.equal(calls.length,0);}
});

test('business model switch away and back during preflight stops before posting',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;});
 const selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0};
 const {scope,calls}=harness({selection,capabilitiesGate:gate});
 const pending=scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'switch-test',prompt:'sample'});
 selection.provider='api';selection.modelId='xai/grok-4.7';selection.epoch++;
 selection.provider='local';selection.modelId='qwen3.5-9b-heretic';selection.epoch++;resume();
 const result=await pending;assert.equal(result.ok,false);assert.equal(result.errorCode,'assistant-selection-changed');
 assert.ok(!calls.some(call=>call.url==='/api/web/tasks'));
});


test('business selection change while task creation is pending cancels before input upload',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;});
 const selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0};
 const {scope,calls}=harness({selection,postGate:gate});
 const pending=scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'posted-switch',prompt:'sample'});
 await new Promise(resolve=>setTimeout(resolve,0));assert.ok(calls.some(call=>call.url==='/api/web/tasks'));
 selection.epoch++;resume();const result=await pending;assert.equal(result.errorCode,'assistant-selection-changed');
 assert.ok(calls.some(call=>call.url==='/api/web/tasks/task-1/cancel'));assert.equal(scope.upload,undefined);
});


test('disabled Qwen business capability cannot fall back to the retired local or an online model',async()=>{
 const code=await readFile(new URL('../renderer/novaflow-smart-ai.js',import.meta.url),'utf8');
 const begin=code.indexOf('  function verifiedAgentPromptHandoff('),end=code.indexOf('  // H3 prompts kept in the prompt history',begin);let sent;
 const selected={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0};let available=false;
 const response={ok:true,modelPromptPolicy:'qwen21-task-policy-v1',data:{analysisBackend:'strata',resourcesReleased:true,generationReady:true,modelIdentity:{id:'legacy',verification:'server-weight-path'},modelPromptLanguage:'en',modelPrompt:'red ball'}};
 const sandbox={window:{crypto:{randomUUID:()=> 'id'},NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({...selected})}}},electronAPI:{qwenBusinessAvailableSync:()=>available,promptAssistantOptimizePrompt:async p=>{sent=p;return response}}},
   shouldUseStructuredArtPromptContract:()=>false,protectSmartAiResourceMentions:text=>({text}),buildSmartAiRequirements:()=>'',readSmartAiResult:()=>({prompt:'sample',hasNegativePrompt:false}),restoreSmartAiResourceMentions:text=>({ok:true,text}),validateSmartAiArtPromptPreservation:()=>({ok:true})};
 createContext(sandbox);runInContext(code.slice(begin,end)+'\nglobalThis.run=optimizeForAgent;',sandbox);
 await assert.rejects(sandbox.run({surface:'art',assistantSelectionScope:'xiaotao',prompt:'sample',supportsNegativePrompt:false}),/Qwen/);assert.equal(sent,undefined);
 await assert.rejects(sandbox.run({surface:'animation',assistantSelectionScope:'xiaotao',analysisProvider:'api',prompt:'sample'}),/\u672a\u5f00\u901a/);assert.equal(sent,undefined);
 selected.provider='api';selected.modelId='xai/grok-4.7';available=true;
 await sandbox.run({surface:'art',prompt:'sample',supportsNegativePrompt:false});assert.equal(sent.assistantSelectionScope,undefined);
});

test('disabled capability blocks new image actions before accessing their API',async()=>{
 const {webcrypto}=await import('node:crypto');const src=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');let called=0;
 const storage={getItem:()=>null,setItem(){}};const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:storage};root.window=root;createContext(root);runInContext(src,root);
 const c=root.NovaFlowXiaotaoArtAgent.createController({bridge:{clearPrepared(){}},storage,api:()=>({qwenBusinessAvailableSync:()=>false,promptAssistantDescribeArtStyle:async()=>{called++}})});
 c.state.provider='local';c.state.modelId='qwen3.5-9b-heretic';c.state.staged=[{status:'ready',kind:'image',name:'one.png',previewUrl:'data:image/png;base64,YQ=='}];
 assert.equal(await c.analyzeStagedImage('style'),false);assert.equal(called,0);
});


test('switching models after upload immediately requests cancellation and discards old result',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;});
 const selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0};
 const {scope,calls,change}=harness({selection,waitGate:gate});
 const pending=scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'running-switch',prompt:'sample'});
 await new Promise(resolve=>setTimeout(resolve,0));assert.ok(scope.upload);
 selection.provider='api';selection.modelId='xai/grok-4.7';selection.epoch++;change();
 const result=await pending;assert.equal(result.errorCode,'assistant-selection-changed');
 assert.ok(calls.some(call=>call.url==='/api/web/tasks/task-1/cancel'));resume();
});


test('switch reports unconfirmed cancellation when the cancel request fails',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;});
 const selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0};
 const {scope,change}=harness({selection,waitGate:gate,cancelFailure:true});
 const pending=scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'failed-cancel',prompt:'sample'});
 await new Promise(resolve=>setTimeout(resolve,0));assert.ok(scope.upload);
 selection.epoch++;change();const result=await pending;assert.equal(result.errorCode,'assistant-selection-cancel-unconfirmed');resume();
});


test('node switch during task creation cancels original task before uploading any input',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;});
 const selection={provider:'local',modelId:'qwen3.5-9b-heretic',epoch:0};
 const {scope,calls,switchNode}=harness({selection,postGate:gate});
 const pending=scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'node-post',prompt:'synthetic'});
 await new Promise(resolve=>setTimeout(resolve,0));assert.ok(calls.some(call=>call.url==='/api/web/tasks'));
 switchNode();const result=await pending;assert.equal(result.errorCode,'assistant-selection-changed');resume();
 await new Promise(resolve=>setTimeout(resolve,0));assert.ok(calls.some(call=>call.url==='/api/web/tasks/task-1/cancel'));assert.equal(scope.upload,undefined);
});

test('original selection epoch is validated before creating a pool task',async()=>{const {scope,calls}=harness();const r=await scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic',assistantSelectionEpoch:3,prompt:'test'});assert.equal(r.errorCode,'assistant-selection-mismatch');assert.equal(calls.length,0)});

test('matching epoch is checked locally and omitted from the node input',async()=>{const {scope}=harness();const r=await scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',assistantProvider:'local',assistantModelId:'qwen3.5-9b-heretic',assistantSelectionEpoch:0,prompt:'test'});assert.equal(r.ok,true);assert.equal(Object.hasOwn(scope.upload,'assistantSelectionEpoch'),false)});

test('missing account guard stops scoped Qwen before any task',async()=>{
 const {scope,calls}=harness({sessionAvailable:false});const result=await scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',prompt:'synthetic'});
 assert.equal(result.errorCode,'assistant-session-unavailable');assert.equal(calls.length,0);
});
test('account A to B to A during capability lookup invalidates the request',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;}),h=harness({capabilitiesGate:gate});
 const pending=h.scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'account-aba',prompt:'synthetic'});
 h.switchSession();h.switchSession();const result=await pending;resume();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(result.errorCode,'assistant-session-cancel-unconfirmed');assert.ok(!h.calls.some(call=>call.url==='/api/web/tasks'));assert.equal(h.scope.upload,undefined);
});
test('account changes while task creation is pending prevent upload and do not claim cancellation',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;}),h=harness({postGate:gate});
 const pending=h.scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'account-post',prompt:'synthetic'});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(h.calls.some(call=>call.url==='/api/web/tasks'));h.switchSession();
 const result=await pending;assert.equal(result.errorCode,'assistant-session-cancel-unconfirmed');resume();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.scope.upload,undefined);assert.ok(h.calls.some(call=>call.url==='/api/web/tasks/task-1/cancel'));
});
test('account changes during input upload invalidate the upload and late result',async()=>{
 let resume;const gate=new Promise(resolve=>{resume=resolve;}),h=harness({uploadGate:gate});
 const pending=h.scope.invoke('optimize-prompt',{assistantSelectionScope:'xiaotao',requestId:'account-upload',prompt:'synthetic'});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(h.calls.some(call=>call.method==='PUT'));h.switchSession();
 const result=await pending;assert.equal(result.errorCode,'assistant-session-cancel-unconfirmed');resume();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.scope.upload,undefined);assert.ok(h.calls.some(call=>call.url==='/api/web/tasks/task-1/cancel'));
});

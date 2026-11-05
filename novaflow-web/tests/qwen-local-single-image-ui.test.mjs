import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';import {TextEncoder} from 'node:util';import vm from 'node:vm';
const [toolsSource,agentSource,promptSource,smartSource]=await Promise.all([readFile(new URL('../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8'),readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'),readFile(new URL('../renderer/xiaotao-prompt-source.js',import.meta.url),'utf8'),readFile(new URL('../renderer/novaflow-smart-ai.js',import.meta.url),'utf8')]);
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aAAAAABJRU5ErkJggg==';
function fixture({capable=true,defer=false,realSmart=false,response=null}={}){
 let prepared=null,rev=0,route=1,referenceRevision=1,resolve,inference,runCount=0;const calls=[],refs=[{drawingRole:'auto',dataUrl:png,name:'subject.png'}];
 const rt={state:{active:true,provider:'local',mode:'img2img',prompt:'增加一朵花',negativePrompt:'水印',width:512,height:512,count:1,running:false},
  references:()=>refs,selectedResult:()=>null,capturePromptSourceGuard:()=>({isCurrent:()=>true}),captureContext(){return {state:this.state,generationSurface:'drawing',routeRevision:route,referenceRevision};},captureAgentPreparedSnapshot(){return {rev,prepared};},
  replaceAgentPrepared(handle,value){assert.equal(handle.rev,rev);const undo={rev:++rev,prepared:value,previous:prepared};prepared=value;return undo;},restoreAgentPrepared(undo){prepared=undo.previous;rev++;},
  isAgentPreparedReplacementCurrent:undo=>undo.rev===rev&&undo.prepared===prepared,render(){},run(){runCount++;}};
 const storage={getItem:()=>null,setItem(){}};const root={crypto:webcrypto,console,AbortController,TextEncoder,setTimeout,clearTimeout,localStorage:storage,__NovaFlowArtGenerate:rt,
 resolveReferenceDataUrl:ref=>Promise.resolve(ref.dataUrl),NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},
 electronAPI:{qwenBusinessAvailableSync:()=>true,qwen21LocalImageEditAvailableSync:()=>capable,captureFoartSessionGuard:()=>()=>true,promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true}}})},
 __NovaFlowSmartAI:{async optimizeForAgent(options){calls.push(options);inference=options;if(defer)await new Promise(r=>resolve=r);return {prompt:'为图中主体添加一朵花。',displayPrompt:'为图中主体添加一朵花。',negativePrompt:'水印',analysisBackend:'qwen-cpu',optimization:{modelPromptLanguage:'zh',modelPromptPolicy:'qwen21-native-rewrite-v3',modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'}}};}}};
 root.window=root;vm.createContext(root);if(realSmart){const a=smartSource.indexOf('  function verifiedAgentPromptHandoff('),b=smartSource.indexOf('  // H3 prompts kept in the prompt history',a);root.electronAPI.promptAssistantOptimizePrompt=async p=>{calls.push(p);return {ok:true,data:response};};vm.runInContext(smartSource.slice(a,b)+'\nwindow.__NovaFlowSmartAI={optimizeForAgent};',root);}for(const src of [promptSource,toolsSource,agentSource])vm.runInContext(src,root);
 const bridge={clearPrepared(){},capture(){throw Error('unexpected capture');},async captureChat(){return {artContext:{surface:'other'},images:[]};}};
 const controller=root.NovaFlowXiaotaoArtAgent.createController({bridge,storage,api:()=>root.electronAPI});root.NovaFlowXiaotaoArtAgent.panel={controller};
 return {controller,rt,refs,calls,root,get prepared(){return prepared;},get runCount(){return runCount;},get inference(){return inference;},release:()=>resolve(),changeRouteABA:()=>{route+=2;},changeRoleABA:()=>{const old=refs[0].drawingRole;refs[0].drawingRole='style';referenceRevision++;refs[0].drawingRole=old;referenceRevision++;},changeReferenceABA:()=>{const orig=refs[0];refs[0]={...orig,dataUrl:'data:image/png;base64,AAAA'};referenceRevision++;refs[0]=orig;referenceRevision++;}};
}
test('single image prompt optimization applies directly without generating',async()=>{const f=fixture();await f.controller.calibrateLocalStatus();assert.equal(await f.controller.send('优化当前绘图提示词'),true,f.controller.state.error);assert.equal(f.calls.length,1);assert.equal(f.calls[0].images.length,1);assert.equal(f.calls[0].images[0].role,'reference');assert.equal(f.calls[0].images[0].dataUrl,png);assert.equal(f.rt.state.prompt,'为图中主体添加一朵花。');assert.equal(f.rt.state.negativePrompt,'水印');assert.equal(f.prepared.promptSnapshot.prompt,'为图中主体添加一朵花。');assert.equal(f.runCount,0);});
test('old node and image or page ABA change never apply an old result',async()=>{const old=fixture({capable:false});await old.controller.calibrateLocalStatus();assert.equal(await old.controller.send('优化当前绘图提示词'),false);assert.equal(old.calls.length,0);
 for(const mutate of ['changeRouteABA','changeReferenceABA','changeRoleABA']){const f=fixture({defer:true});await f.controller.calibrateLocalStatus();const p=f.controller.send('优化当前绘图提示词');for(let i=0;i<50&&!f.inference;i++)await new Promise(r=>setTimeout(r,1));assert.ok(f.inference);f[mutate]();f.release();assert.equal(await p,false,mutate);assert.equal(f.rt.state.prompt,'增加一朵花');assert.equal(f.prepared,null);assert.equal(f.runCount,0);}});

test('cross-language lettering remains unchanged through real editor and smart contract',async()=>{
 for(const [prompt,rewritten,language] of [['Add a sign reading “春日”','Add a sign reading “春日” while preserving the rest.','en'],["添加写着'Hello'的牌子","添加写着'Hello'的牌子，其他内容不变。",'zh']]){
  const response={analysisBackend:'qwen-cpu',resourcesReleased:true,generationReady:true,modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},promptContract:'qwen21-native-rewrite-v3',modelPromptPolicy:'qwen21-native-rewrite-v3',translationValidation:'native-edit-and-literals',modelPromptLanguage:language,displayPrompt:rewritten,modelPrompt:rewritten,negativePrompt:'水印'};
  const f=fixture({realSmart:true,response});f.rt.state.prompt=prompt;await f.controller.calibrateLocalStatus();assert.equal(await f.controller.send('优化当前绘图提示词'),true,f.controller.state.error);assert.equal(f.calls[0].currentPrompt,prompt);assert.equal(f.rt.state.prompt,rewritten);assert.equal(f.rt.state.negativePrompt,'水印');assert.equal(f.prepared.promptSnapshot.prompt,rewritten);assert.equal(f.runCount,0);
 }
});

test('three explicit reference roles and slots reach the editor and preparation unchanged',async()=>{const f=fixture();f.refs[0].drawingRole='object';f.refs.push({drawingRole:'subject',dataUrl:'data:image/png;base64,YQ==',name:'a.png'},{drawingRole:'background',dataUrl:'data:image/png;base64,Yg==',name:'b.png'});await f.controller.calibrateLocalStatus();assert.equal(await f.controller.send('优化当前绘图提示词'),true,f.controller.state.error);assert.deepEqual(Array.from(f.calls[0].images,x=>x.role),['object','subject','background']);assert.deepEqual(Array.from(f.calls[0].images,x=>x.dataUrl),f.refs.map(x=>x.dataUrl));assert.deepEqual(Array.from(f.prepared.referenceRolePlan.roles),['object','subject','background']);assert.equal(f.runCount,0);});

test('two auto references stay reference unless existing page semantics identify roles',async()=>{
 for(const infer of [false,true]){const f=fixture();f.refs.push({drawingRole:'auto',dataUrl:'data:image/png;base64,YQ==',name:'second.png'});if(infer)f.root.NovaFlowArtPrepare={input:()=>({references:[{source:1,roles:['style']},{source:2,roles:['subject']}]})};await f.controller.calibrateLocalStatus();const sent=await f.controller.send('优化当前绘图提示词');if(infer){assert.equal(f.calls.length,0);assert.match(f.controller.state.messages.at(-1).content,/风格转换需要在线模型/);}else{assert.equal(sent,true,f.controller.state.error);assert.deepEqual(Array.from(f.calls[0].images,x=>x.role),['reference','reference']);}}
});
test('a style pair on the local brain is a plain switch suggestion, with no error box and no call',async()=>{const f=fixture();f.refs[0].drawingRole='subject';f.refs.push({drawingRole:'style',dataUrl:'data:image/png;base64,YQ==',name:'second.png'});await f.controller.calibrateLocalStatus();await f.controller.send('优化当前绘图提示词');assert.equal(f.calls.length,0);assert.equal(f.controller.state.error,'');assert.match(f.controller.state.messages.at(-1).content,/风格转换需要在线模型/);assert.equal(f.prepared,null);});

test('local prompt optimization refreshes a stale unavailable business capability before submitting',async()=>{
 const f=fixture();let available=false,checks=0;
 f.root.electronAPI.qwenBusinessAvailableSync=()=>available;
 f.root.electronAPI.runtimeFeatures=async()=>{checks++;available=true;};
 await f.controller.calibrateLocalStatus();
 assert.equal(await f.controller.send('优化当前绘图提示词'),true,f.controller.state.error);
 assert.equal(checks,1);assert.equal(f.calls.length,1);assert.equal(f.rt.state.prompt,'为图中主体添加一朵花。');
});

test('local prompt optimization rejects a changed account or node during capability refresh',async()=>{
 for(const changed of ['account','node']){
  const f=fixture();let session=true,release;f.root.NovaFlowWebRuntime={computeNode:{id:'node-a'}};
  f.root.electronAPI.captureFoartSessionGuard=()=>()=>session;
  f.root.electronAPI.runtimeFeatures=()=>new Promise(resolve=>{release=resolve;});
  await f.controller.calibrateLocalStatus();const pending=f.controller.send('优化当前绘图提示词');
  for(let i=0;i<50&&!release;i++)await new Promise(r=>setTimeout(r,1));assert.ok(release);
  if(changed==='account')session=false;else f.root.NovaFlowWebRuntime.computeNode={id:'node-b'};
  release();assert.equal(await pending,false,changed);assert.equal(f.calls.length,0);assert.equal(f.rt.state.prompt,'增加一朵花');
 }
});

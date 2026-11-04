import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createContext,runInContext} from 'node:vm';import {webcrypto} from 'node:crypto';
const agent=await readFile(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'),upload=await readFile(new URL('../../renderer/xiaotao-upload.js',import.meta.url),'utf8');
function fixture({reply,available=true}={}){
 const calls=[],storage={getItem:()=>null,setItem(){}};const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:storage,NovaFlowAudioStudio:{agentSettings:()=>({sfx:{seconds:5},music:{seconds:20}})}};root.window=root;createContext(root);runInContext(upload,root);runInContext(agent,root);
 const api={promptAssistantGetStatus:async()=>({ok:true,result:{features:{qwen35CpuTrial:true}}}),qwenBusinessAvailableSync:()=>available,promptAssistantRewriteAudioPrompt:async p=>{calls.push(['rewrite',p]);return reply?reply(p):{ok:true,prompt:'A soft wind.',analysisBackend:'qwen-cpu',modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},resourcesReleased:true,generationReady:true}},promptAssistantCancelRequest:async p=>{calls.push(['cancel',p]);return {ok:true}},artAgentChat:async p=>{calls.push(['chat',p]);return {ok:true,data:{reply:'chat',history:[],toolTrace:[]}}}};
 const c=root.NovaFlowXiaotaoArtAgent.createController({storage,bridge:{clearPrepared(){},captureChat(){throw Error('unexpected chat path')}},api:()=>api});return {root,c,calls,send:async message=>{await c.calibrateLocalStatus();assert.equal(c.state.qwen35CpuTrialAvailable,true);return c.send(message)}};
}
test('real Xiaotao send routes explicit audio text rewrite to selected Qwen only, with no generation',async()=>{
 for(const [message,kind,seconds] of [['帮我优化音效提示词：雨打屋檐','sfx',5],['请优化森林风声的音效提示词','sfx',5],['帮我整理音乐提示词：柔和钢琴','music',20],['音效提示词改写：5秒风声','sfx',5],['只改写音效提示词：窗外雨声，不生成','sfx',5]]){
  const f=fixture();assert.equal(await f.send(message),true,message+' '+f.c.state.error+' '+JSON.stringify(f.calls));assert.equal(f.calls.length,1);const [type,p]=f.calls[0];assert.equal(type,'rewrite');assert.equal(p.input,message);assert.equal(p.kind,kind);assert.equal(p.seconds,seconds);assert.equal(p.assistantModelId,'qwen3.5-9b-heretic');assert.equal(p.assistantSelectionScope,'xiaotao');assert.match(f.c.state.messages.at(-1).content,/仅处理文字，未分析或生成音频/);
 }
});
test('music BPM is forwarded to local text rewrite and invalid BPM never submits',async()=>{
 for(const bpm of [40,120,220]){
  const f=fixture();f.root.NovaFlowAudioStudio.agentSettings=()=>({music:{seconds:20,bpm},sfx:{seconds:5}});
  assert.equal(await f.send('\u8bf7\u6539\u5199\u97f3\u4e50\u63d0\u793a\u8bcd\uff1a\u6e05\u900f\u7684\u7b1b\u58f0'),true);assert.equal(f.calls[0][1].bpm,bpm);
 }
 for(const bpm of [39,221,100.5,'120',null]){
  const f=fixture();f.root.NovaFlowAudioStudio.agentSettings=()=>({music:{seconds:20,bpm}});
  assert.equal(await f.send('\u8bf7\u6539\u5199\u97f3\u4e50\u63d0\u793a\u8bcd\uff1a\u6e05\u900f\u7684\u7b1b\u58f0'),false);assert.equal(f.calls.length,0);
 }
 const f=fixture();f.root.NovaFlowAudioStudio.agentSettings=()=>({sfx:{seconds:5},music:{bpm:120}});
 assert.equal(await f.send('\u8bf7\u4f18\u5316\u97f3\u6548\u63d0\u793a\u8bcd\uff1a\u91d1\u5c5e\u78b0\u649e'),true);assert.equal(Object.hasOwn(f.calls[0][1],'bpm'),false);
});
test('missing description, missing duration, unavailable business and attachments fail before any rewrite',async()=>{
 let f=fixture();assert.equal(await f.send('优化音效提示词'),false);assert.equal(f.calls.length,0);
 f=fixture();f.root.NovaFlowAudioStudio.agentSettings=()=>({});assert.equal(await f.send('优化音效提示词：风声'),false);assert.equal(f.calls.length,0);
 f=fixture({available:false});assert.equal(await f.send('优化音效提示词：风声'),false);assert.equal(f.calls.length,0);
 f=fixture();f.c.state.staged=[{kind:'image',status:'ready',name:'x.png',previewUrl:'data:image/png;base64,YQ=='}];assert.equal(await f.send('优化音效提示词：风声'),false);assert.equal(f.calls.length,0);assert.match(f.c.state.error,/只处理文字/);
 f=fixture();f.c.state.staged=[{kind:'audio',status:'ready',name:'x.wav'}];assert.equal(await f.send('优化音效提示词：风声'),false);assert.equal(f.calls.length,0);
});
test('unverified or unreleased Qwen response is discarded and never claims audio generation',async()=>{
 for(const partial of [{modelIdentity:{id:'qwen35-heretic'}},{resourcesReleased:false},{generationReady:false}]){
  const f=fixture({reply:async()=>({ok:true,prompt:'forged',analysisBackend:'qwen-cpu',modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},resourcesReleased:true,generationReady:true,...partial})});assert.equal(await f.send('优化音效提示词：风声'),false);assert.equal(f.calls.length,1);assert.ok(!f.c.state.messages.some(x=>x.content?.includes('forged')));
 }
});
test('stop cancels exact text-rewrite request and ignores late response',async()=>{
 let resolve;const gate=new Promise(r=>resolve=r),f=fixture({reply:async()=>gate});const pending=f.send('优化音效提示词：风声');for(let i=0;i<100&&!f.calls.length;i++)await new Promise(r=>setTimeout(r,1));assert.ok(f.calls.length,'rewrite was not reached');const id=f.calls[0][1].requestId;await f.c.stop();assert.equal(f.calls.find(x=>x[0]==='cancel')[1].requestId,id);resolve({ok:true,prompt:'late',analysisBackend:'qwen-cpu',modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},resourcesReleased:true,generationReady:true});assert.equal(await pending,false);assert.ok(!f.c.state.messages.some(x=>x.content?.includes('late')));
});
test('model change during text rewrite discards the result and performs no other action',async()=>{
 let f;f=fixture({reply:async()=>{f.c.state.modelId='xai/grok-4.7';return {ok:true,prompt:'late wrong',analysisBackend:'qwen-cpu',modelIdentity:{id:'qwen35-heretic',verification:'server-weight-path'},resourcesReleased:true,generationReady:true}}});
 assert.equal(await f.send('优化音效提示词：风声'),false);assert.equal(f.calls.length,1);assert.ok(!f.c.state.messages.some(x=>x.content?.includes('late wrong')));
});

test('requests to hear or analyze source audio do not reach text rewrite',async()=>{
 for(const message of ['听这段音频并优化音效提示词','请先试听这个录音再整理声音提示词']){const f=fixture();assert.equal(await f.send(message),false);assert.equal(f.calls.length,0);assert.match(f.c.state.error,/音频|文字|附件/);}
});

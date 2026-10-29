import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {computeArtAgentFingerprint} from '../../worker/src/flash-art-agent.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};

test('natural result feedback is silent, result-bound and never starts an extra inference or generation',async()=>{
  const e=env({cfg:3}),commands=[];let inference=0;
  const api={artAgentChat:async()=>{inference++;return {ok:false};}};
  e.state.results.push({id:'actual-result',imageUrl:png(30)});
  // The bridge hashes the same actual image bytes as the task receipt.
  const bytes=Buffer.from(png(30).split(',')[1],'base64');
  const resultSHA256=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
  api.artLearning=async command=>{commands.push(plain(command));return {ok:true,data:command.action==='list'?{tasks:[{id:'task-result',resultId:'actual-result',resultSHA256,execution:'succeeded'}]}:{feedback:'satisfied'}};};
  const controller=e.api.createController({bridge:e.bridge,api:()=>api});
  for(const message of ['这次效果很好。','这张图做的挺好的。','不太满意']) {
    await controller.send(message);await new Promise(r=>setTimeout(r,10));
    const feedback=commands.findLast(c=>c.action==='feedback');assert.equal(feedback.taskId,'task-result');assert.equal(feedback.resultId,'actual-result');assert.equal(feedback.message,message);
  }
  assert.equal(inference,0);assert.equal(e.calls.length,0);
  assert(!controller.state.messages.some(m=>/经验|入库|归档/.test(m.content)));
  api.artLearning=async()=>{throw Error('journal unavailable');};
  assert.equal(await controller.send('满意'),true);assert.equal(inference,0);
});
function png(red) {
  const chunk = (name, value) => {const type = Buffer.from(name), data = Buffer.concat([type, value]); let crc = 0xffffffff;
    for (const byte of data) {crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);}
    const size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(value.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([size, data, sum]);};
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,red,0,0,255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
function env({cfg=5} = {}) {
  const saved = new Map(), calls = [], refs = [{name:'主体.png', drawingRole:'subject', dataUrl:png(160)}, {name:'画风.png', drawingRole:'style', dataUrl:png(80)}];
  const state = {active:true, provider:'local', mode:'img2img', nsfw:false, prompt:'图1用图2画风', negativePrompt:'  不要文字，保留原负向  ', width:1280, height:960, seed:54792256, randomSeed:false, count:4,
    localDrawEngine:'qwen-2.1', localQwen21Variant:'turbo', drawingAnalysisEngine:'local', samplingOverrides:{'qwen-2.1-turbo:img2img':{cfg, steps:8}}, results:[]};
  let prepared = null, surface = 'drawing';
  const runtime = {state, capturePrompt() {}, captureContext:() => ({state, references:refs, referenceLimit:10, generationSurface:surface}), render() {}, selectedResult:() => state.results[0],
    stageAgentPrepared(p) {p.assertCurrent(); prepared = p;}, clearAgentPrepared() {prepared = null;}, async cancel() {calls.push('cancel-generation');},
    async run() {const p = prepared; prepared = null; assert(p, 'Original generate consumes one staged proposal'); p.assertCurrent(); state.running = true; calls.push({prepared:p}); state.results.unshift({id:'actual-' + calls.length, imageUrl:png(30), name:'actual.png'}); state.running = false;}};
  const sandbox = {console, TextEncoder, AbortController, crypto:webcrypto, atob:s => Buffer.from(s, 'base64').toString('binary'), setTimeout, clearTimeout,
    localStorage:{getItem:k => saved.get(k), setItem:(k, v) => saved.set(k, v)}, __NovaFlowArtGenerate:runtime,
    NovaFlowArtGenerateModels:{capabilityFor:() => ({engine:'qwen-2.1'}), localSamplingFor:() => ({cfg:5, steps:8})}};
  sandbox.window = sandbox; const vm = createContext(sandbox);
  runInContext(readFileSync(new URL('../../renderer/art-generate-model.resource.js',import.meta.url),'utf8'),vm);
  sandbox.NovaFlowArtGenerateModels={...sandbox.NovaFlowArtGenerateModels};
  for (const file of ['art-direction.workflow.js', 'xiaotao-art-agent.js']) runInContext(readFileSync(new URL('../../renderer/' + file, import.meta.url), 'utf8'), vm);
  const api = sandbox.NovaFlowXiaotaoArtAgent, bridge = api.createBridge();
  return {api, bridge, sandbox, runtime, state, refs, saved, calls, setSurface:v => {surface = v;}, getPrepared:() => prepared};
}
async function proposal(e, snapshot = e.bridge.capture()) {
  return {prompt:'Redraw <image1> using the painted style of <image2>.', negativePrompt:snapshot.artContext.negativePrompt, cfg:3,
    contextFingerprint:await e.api.fingerprint(snapshot), model:'flash-fixture', promptIds:['actual-native-id'], kind:'qwen21-strata-native', version:'flash-native-v1', sourceOrder:[1,2],
    providerPolicy:{schema:'nf.qwen21-native-provider.v1',cfg:3}, analysisBackend:'strata', modelIdentity:{id:'flash-fixture',verification:'server-model-id'}, resourcesReleased:true, generationReady:true};
}
async function creationProposal(e,{action='generate',generationMode='txt2img',includeResult=false,...extra}={}) {
  const snapshot=e.bridge.captureCreation({includeResult});
  return {prompt:generationMode==='img2img'?'Improve the lighting in <image1>.':'A refined anime illustration of a sunny garden.',negativePrompt:snapshot.artContext.negativePrompt,
    action,generationMode,settings:{},kind:'qwen21-agent-direct',version:'agent-direct-v1',contextFingerprint:await e.api.fingerprint(snapshot),promptIds:['actual-native-id'],
    resourcesReleased:true,generationReady:true,analysisBackend:'strata',modelIdentity:{id:'flash-fixture',verification:'server-model-id'},...extra};
}

test('native application actions distinguish prompt-only, writing to the field, and a requested visual revision', async () => {
  const e=env({cfg:3}), payloads=[]; let action='prompt';
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p));return {ok:true,data:{reply:'准备好了',history:[],proposal:{...await proposal(e,e.bridge.capture({includeResult:p.images.length===3})),action}}};}})});
  const original=e.state.prompt; await controller.send('给我完整提示词'); assert.equal(e.state.prompt,original); assert.equal(e.calls.length,0); assert(controller.state.messages.at(-1).content.includes('完整提示词：'));
  action='apply'; await controller.send('把它写到提示框里'); assert.match(e.state.prompt,/Redraw/); assert.equal(e.calls.length,0); assert.equal(controller.state.applied,true);
  action='generate'; await controller.send('按照刚才的想法做一张图'); assert(controller.state.confirmation); await controller.confirmSampling('current'); assert.equal(e.calls.length,1); const result=e.state.results[0].imageUrl;
  await controller.send('头发还是太真实了，改成参考那种动漫发束'); assert.equal(payloads.at(-1).images[2].dataUrl,result); assert.equal(e.calls.length,2); assert.equal(controller.state.proposal,null);
});

test('questions and prompt-only requests cannot accidentally execute a model generation action',async()=>{
  for(const message of ['你现在能生成图片吗？','只给我提示词，不要生成']) {
    const e=env(), controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>({ok:true,data:{reply:'完整方案',history:[],proposal:{...await proposal(e),action:'generate'}}})})});
    assert.equal(await controller.send(message),true); assert.equal(e.calls.length,0); assert.equal(e.state.prompt,'图1用图2画风'); assert(controller.state.messages.at(-1).content.includes('完整提示词：'));
  }
});

test('text-to-image can execute without references and a feedback revision uses the actual current result as its edit input', async () => {
  const e=env(), payloads=[]; e.refs.splice(0); e.state.mode='txt2img'; let revision=false;
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p));return {ok:true,data:{reply:'交给绘图执行',history:[],proposal:await creationProposal(e,{generationMode:revision?'img2img':'txt2img',includeResult:revision})}};}})});
  await controller.send('帮我画一个阳光花园'); assert.equal(payloads.length,0); assert.equal(await controller.confirmSampling('current'),true,controller.state.error); assert.equal(payloads[0].mode,'creation'); assert.deepEqual(payloads[0].images,[]); assert.equal(e.calls.length,1); assert.equal(e.calls[0].prepared.references.length,0);
  const actual=e.state.results[0].imageUrl; revision=true; await controller.send('颜色太黄了，调整得更自然一点');
  assert.equal(payloads[1].images[0].role,'result'); assert.equal(payloads[1].images[0].dataUrl,actual);
  assert.equal(e.calls.length,2); assert.equal(e.calls[1].prepared.references[0].dataUrl,actual); assert.equal(e.calls[1].prepared.state.mode,'img2img'); assert.equal(e.calls[1].prepared.state.count,1);
});

test('an explicit new creation can navigate into drawing while ordinary conversation stays on its page', async () => {
  const e=env(); e.refs.splice(0); e.state.mode='txt2img'; e.state.active=false; e.setSurface('other'); let navigations=0;
  e.sandbox.document={querySelector:()=>({click(){navigations++;e.setSurface('drawing');}}),querySelectorAll:()=>[{textContent:'绘图',getAttribute:()=> 'true'}]};
  e.runtime.activate=mode=>{e.state.active=true;e.state.mode=mode;};
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>({ok:true,data:{reply:'准备制作',history:[],proposal:await creationProposal(e)}})})});
  assert.equal(await controller.send('帮我画一个阳光花园'),true); assert.equal(navigations,0); assert.equal(await controller.confirmSampling('current'),true,controller.state.error); assert.equal(navigations,1); assert.equal(e.calls.length,1); assert.equal(e.state.active,true);
});

test('browser and backend agree on canonical full-byte fingerprints, including same-size pixel and manual setting changes', async () => {
  const e = env(), snapshot = e.bridge.capture();
  assert.equal(await e.api.fingerprint(snapshot), computeArtAgentFingerprint(plain(snapshot)));
  const reordered = {...plain(snapshot), artContext:Object.fromEntries(Object.entries(plain(snapshot.artContext)).reverse())};
  assert.equal(await e.api.fingerprint(snapshot), await e.api.fingerprint(reordered));
  const changed = plain(snapshot); changed.images[0].dataUrl = png(161);
  assert.equal(changed.images[0].dataUrl.length, snapshot.images[0].dataUrl.length); assert.notEqual(await e.api.fingerprint(changed), await e.api.fingerprint(snapshot));
  e.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg = 7; assert.notEqual(await e.api.fingerprint(e.bridge.capture()), await e.api.fingerprint(snapshot));
  assert.equal(snapshot.artContext.engine,'qwen-2.1'); assert.equal(snapshot.artContext.nsfw,false); assert.equal(snapshot.images[0].dataUrl,e.refs[0].dataUrl);
});

test('a trusted proposal uses existing native compiler, original single-run entry and preserves manual CFG/negative/count', async () => {
  const e = env(), snapshot = e.bridge.capture(), p = await proposal(e, snapshot);
  await e.bridge.applyProposal(p, snapshot);
  const prepared = e.getPrepared(); assert(prepared); assert.equal(prepared.promptSnapshot.prompt,p.prompt); assert.equal(prepared.promptSnapshot.negativePrompt,e.state.negativePrompt);
  assert.equal(prepared.state.count,1); assert.equal(e.state.count,4); assert.equal(e.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg,5);
  assert.deepEqual(plain(e.sandbox.NovaFlowArtDirection.generationOptions(prepared)), {taskProfile:'art-direction',referenceRoles:['subject','style'],styleReferencePriority:true,qwen21NativeGuidance:{kind:p.kind,version:p.version,cfg:3}});
  const review = await e.sandbox.NovaFlowArtDirection.review(prepared,png(30)); assert.equal(review.skipped,true);
  const result = await e.bridge.generateApplied(); assert.equal(result.imageUrl,png(30)); assert.equal(e.calls.length,1);
  await assert.rejects(e.bridge.generateApplied(),/先应用/); assert.equal(e.calls.length,1);
});

test('Chinese proposals enter the original editable field and manual Chinese edits use the direct path without another analysis',async()=>{
  const e=env({cfg:3}),snapshot=e.bridge.capture(),p=await proposal(e,snapshot);
  p.prompt='以<image1>为内容原图、<image2>为画风参考，保留闭嘴微笑，招牌写 OPEN。';
  await e.bridge.applyProposal(p,snapshot);
  assert.equal(e.state.prompt,'以@参考图1为内容原图、@参考图2为画风参考，保留闭嘴微笑，招牌写 OPEN。');
  e.runtime.clearAgentPrepared();e.state.prompt='以@参考图1为内容原图、@参考图2为画风参考，肤色保留暖调，背景稍暗，招牌写 OPEN。';
  await e.sandbox.NovaFlowArtDirection.selectManual(e.state);
  const prepared=await e.sandbox.NovaFlowArtDirection.prepare({state:e.state,references:e.refs,referenceLimit:10,generationSurface:'drawing'});
  assert.equal(prepared.promptSnapshot.prompt,'以<image1>为内容原图、<image2>为画风参考，肤色保留暖调，背景稍暗，招牌写 OPEN。');
  assert.equal(prepared.promptSnapshot.negativePrompt,e.state.negativePrompt.trim());assert.equal(prepared.direct,true);assert.equal(e.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg,3);assert.equal(e.calls.length,0);
});

test('both local and online Xiaotao default to English execution prompts while retaining Chinese user messages and no generation',async()=>{
  const e=env(),payloads=[],controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p));return {ok:true,data:{reply:'中文提示词说明',history:[]}};}})});
  await controller.send('只给我提示词');controller.setProvider('api');await controller.send('只给我提示词');
  assert.equal(payloads.length,2);assert(payloads.every(p=>p.promptLanguage==='en'));assert(payloads.every(p=>p.message==='只给我提示词'));assert.equal(payloads[1].mode,'chat');assert.equal(e.calls.length,0);
});

test('missing release credentials and changed negative cannot be bypassed by proposal prose', async () => {
  const e = env(), snapshot = e.bridge.capture(), p = await proposal(e, snapshot); delete p.resourcesReleased;
  await assert.rejects(e.bridge.applyProposal(p,snapshot),/交接凭据/); assert.equal(e.state.prompt,snapshot.artContext.prompt); assert.equal(e.getPrepared(),null);
  const different = await proposal(e,snapshot); different.negativePrompt = 'new negative';
  await assert.rejects(e.bridge.applyProposal(different,snapshot),/保留当前负向/); assert.equal(e.calls.length,0);
});

test('actual image bytes, sampling changes and leaving drawing invalidate a staged proposal before generation', async () => {
  for (const change of [e => {e.refs[0] = {...e.refs[0],dataUrl:png(161)};}, e => {e.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg = 7;}, e => {e.setSurface('ui');}, e => {const state = plain(e.state); e.runtime.captureContext = () => ({state,references:e.refs,referenceLimit:10,generationSurface:'drawing'});}]) {
    const e = env(), s = e.bridge.capture(); await e.bridge.applyProposal(await proposal(e,s),s); change(e);
    await assert.rejects(e.bridge.generateApplied(),/已变化|回到绘图/); assert.equal(e.calls.length,0);
  }
});

test('source/style slots may be sparse or reversed while full bytes and original display numbering are preserved', async () => {
  const e = env(), subject = e.refs[0], style = e.refs[1]; e.refs.splice(0,e.refs.length,null,style,null,null,subject); e.state.prompt = '图5用图2画风';
  const snapshot = e.bridge.capture(); assert.deepEqual(plain(snapshot.images.map(x => [x.source,x.role])),[[5,'subject'],[2,'style']]);
  await e.bridge.applyProposal(await proposal(e,snapshot),snapshot); const p = e.getPrepared();
  assert.deepEqual(plain(p.nativeExecution.sourceOrder),[5,2]); assert.equal(p.references[0].dataUrl,subject.dataUrl); assert.equal(p.references[1].dataUrl,style.dataUrl); assert.match(e.state.prompt,/@参考图5.*@参考图2/);
});

test('other models/NSFW cannot receive Qwen-native execution suggestions', () => {
  const e = env(); e.sandbox.NovaFlowArtGenerateModels.capabilityFor = () => ({engine:'flux'}); assert.throws(() => e.bridge.capture(),/Qwen 2.1/);
  e.state.nsfw = true; assert.throws(() => e.bridge.capture(),/本地绘图/);
});

test('chat retains authoritative text history, sends full images and stops only its own request', async () => {
  const e = env(), entered = deferred(), gate = deferred(), calls = [], stops = [];
  const controller = e.api.createController({bridge:e.bridge, api:() => ({artAgentChat:async p => {calls.push(plain(p)); entered.resolve(); return gate.promise;}, artAgentStop:async p => {stops.push(plain(p)); return {ok:true};}})});
  const running = controller.send('减少摄影感'); await entered.promise; const payload = calls[0]; assert.match(payload.requestId,/^[\da-f-]{36}$/); assert.equal(payload.contextFingerprint,computeArtAgentFingerprint(payload));
  await controller.stop(); assert.deepEqual(stops,[{requestId:payload.requestId,provider:'local'}]);
  gate.resolve({ok:true,data:{conversationId:'fixture-id',reply:'已完成',history:[],proposal:await proposal(e)}}); await running;
  assert.equal(controller.state.proposal,null); assert.equal(controller.state.status,'已停止'); assert.equal(e.calls.length,0);
});

test('only explicit generation returns a real image; double clicks cannot submit twice or auto-review it', async () => {
  const e = env({cfg:3}), payloads = [], history = [{role:'user',content:'更像参考'}, {role:'assistant',content:'已准备建议'}];
  const controller = e.api.createController({bridge:e.bridge, api:() => ({artAgentChat:async payload => {payloads.push(plain(payload)); return {ok:true,data:{conversationId:'fixture-id',reply:'已准备建议',history,toolTrace:[{name:'get_art_context'},{name:'propose_art_direction'}],proposal:await proposal(e)}};}})});
  await controller.send('更像参考'); assert.equal(e.calls.length,0); assert.equal(controller.state.proposal.prompt,'Redraw <image1> using the painted style of <image2>.');
  await controller.apply({generate:true}); assert(controller.state.confirmation); const first = controller.confirmSampling('current'), second = controller.confirmSampling('current'); assert.equal(await second,false); assert.equal(await first,true); assert.equal(e.calls.length,1); assert.equal(payloads.length,1);
  assert.equal(controller.state.messages.at(-1).imageUrl,png(30));
  const stored = Array.from(e.saved.values()).join(''); assert(!stored.includes('data:image')); assert(!stored.includes('modelIdentity')); assert.deepEqual(plain(controller.state.history),history);
});

test('explicit chat execution commands are distinguished from questions, refusals and plan-only requests', () => {
  const {api}=env();
  for (const text of ['按这个方案生成','请按当前方案生成一张','确认生成','直接生成一张','生成一张']) assert.equal(api.executionIntent(text)?.generate,true,text);
  assert.equal(api.executionIntent('用图2画风重绘图1，保留机场并生成一张')?.fresh,true);
  assert.equal(api.executionIntent('应用到绘图')?.generate,false);
  for (const text of ['现在可以生成吗？','为什么不能生成','不要生成','先不生成，给我方案','帮我分析画风并生成方案','解释“按这个方案生成”是什么意思','如果满意就按这个方案生成','生成的图好看吗']) assert.equal(api.executionIntent(text),null,text);
});

test('a chat command applies the current proposal and generates once without a second model call or button click', async () => {
  const e=env({cfg:3}); let analyses=0;
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>{analyses++;return {ok:true,data:{reply:'方案已准备',history:[],proposal:await proposal(e)}};}})});
  await controller.send('按参考调整头发，先给我方案'); assert.equal(analyses,1); assert.equal(e.calls.length,0);
  await controller.send('按这个方案生成'); assert.equal(e.calls.length,0); const first=controller.confirmSampling('current'), duplicate=controller.confirmSampling('current');
  assert.equal(await duplicate,false); assert.equal(await first,true); assert.equal(analyses,1); assert.equal(e.calls.length,1);
  assert.equal(e.calls[0].prepared.state.count,1); assert.equal(controller.state.messages.at(-1).imageUrl,png(30)); assert.equal(controller.state.proposal,null);
  assert.equal(await controller.send('按这个方案生成'),false); assert.equal(e.calls.length,1); assert.match(controller.state.error,/没有有效/);
});

test('a first explicit redraw-and-generate instruction awaits the validated proposal then uses the original single generation flow', async () => {
  const e=env({cfg:3}); let analyses=0;
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>{analyses++;assert.equal(e.calls.length,0);return {ok:true,data:{reply:'已准备',history:[],proposal:await proposal(e)}};}})});
  assert.equal(await controller.send('请用图2画风重绘图1并生成一张'),true);
  assert.equal(analyses,0); assert.equal(e.calls.length,0); assert.equal(await controller.send('按当前参数'),true);
  assert.equal(analyses,1); assert.equal(e.calls.length,1); assert.equal(controller.state.status,'已生成，等待你的评价');
  assert.equal(controller.state.pending,false); assert.equal(controller.state.generating,false); assert.equal(e.state.count,4);
});

test('chat execution cannot use stale images, missing release credentials, online mode or missing drawing context', async () => {
  const e=env({cfg:3}), controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>({ok:true,data:{reply:'方案',history:[],proposal:await proposal(e)}})})});
  await controller.send('先给方案'); e.refs[0].dataUrl=png(17);
  assert.equal(await controller.send('按这个方案生成'),true); assert.equal(await controller.confirmSampling('current'),false); assert.equal(e.calls.length,0); assert.match(controller.state.error,/已变化/);
  const unverified=env({cfg:3}), bad=await proposal(unverified); delete bad.resourcesReleased;
  const unsafe=unverified.api.createController({bridge:unverified.bridge,api:()=>({artAgentChat:async()=>({ok:true,data:{reply:'方案',history:[],proposal:bad}})})});
  assert.equal(await unsafe.send('请重绘并生成'),true); assert.equal(await unsafe.confirmSampling('current'),false); assert.equal(unverified.calls.length,0); assert.match(unsafe.state.error,/交接凭据/);
  const noContext=env(); noContext.refs.splice(0); noContext.sandbox.NovaFlowArtGenerateModels.capabilityFor=()=>({engine:'unsupported'}); let requests=0;
  const empty=noContext.api.createController({bridge:noContext.bridge,api:()=>({artAgentChat:async()=>{requests++;throw Error('must not call');}})});
  assert.equal(await empty.send('请重绘并生成'),false); assert.match(empty.state.error,/Qwen 2.1/); assert.equal(requests,0);
  empty.setProvider('api'); assert.equal(await empty.send('生成一张'),false); assert.match(empty.state.error,/在线智能/); assert.equal(requests,0);
});

test('stale chat replies do not yield executable proposals; explicit result review includes only an actual third image', async () => {
  const e = env(), entered = deferred(), gate = deferred();
  const controller = e.api.createController({bridge:e.bridge,api:() => ({artAgentChat:async () => {entered.resolve(); return gate.promise;}})});
  const running = controller.send('修改光影'); await entered.promise; const p = await proposal(e); e.state.negativePrompt += '变更'; gate.resolve({ok:true,data:{reply:'建议如下',history:[],proposal:p}}); await running;
  assert.equal(controller.state.proposal,null); assert.equal(e.calls.length,0);
  await assert.rejects(Promise.resolve().then(() => e.bridge.capture({includeResult:true})),/没有实际成图/);
  e.state.results.unshift({id:'actual',imageUrl:png(25),name:'actual.png'}); const withResult = e.bridge.capture({includeResult:true}); assert.equal(withResult.images[2].role,'output'); assert.equal(withResult.images[2].dataUrl,png(25));
  assert.equal(await e.api.fingerprint(withResult),computeArtAgentFingerprint(plain(withResult)));
});

test('service restart preserves text and waits for a new explicit send instead of hidden inference retry', async () => {
  const e = env(), calls = [], history = [{role:'user',content:'old'}, {role:'assistant',content:'reply'}];
  e.saved.set('novaflow.xiaotao-art.chat.v1',JSON.stringify({conversationId:'old-session',history,messages:history}));
  const controller = e.api.createController({bridge:e.bridge,api:() => ({artAgentChat:async p => {calls.push(plain(p)); return calls.length === 1 ? {ok:false,errorCode:'flash-agent-unknown-conversation'} : {ok:true,data:{conversationId:'new-session',reply:'已恢复',history}};}})});
  await controller.send('继续'); assert.equal(calls.length,1); assert.match(controller.state.error,/服务已重启/); assert.deepEqual(plain(controller.state.history),history);
  await controller.send('重新连接'); assert.equal(calls.length,2); assert.equal(calls[1].conversationId,undefined); assert.deepEqual(calls[1].history,history);
});

test('drawer layer clears actual workspace resource panels while staying below system modals', () => {
  const css = readFileSync(new URL('../../renderer/xiaotao-art-agent.css',import.meta.url),'utf8');
  const layer = Number(css.match(/#nf-xiaotao-art-root\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  const side = readFileSync(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');
  assert(side.includes("zIndex: '2147483201'")); assert(layer > 2147483201);
  const brand = readFileSync(new URL('../../renderer/novaflow-brand-runtime.js',import.meta.url),'utf8');
  assert(brand.includes('z-index: 2147483646')); assert(layer < 2147483646);
});

test('drawer clamp handles all viewport edges and a viewport smaller than the previous drawer', () => {
  const {api} = env(), clamp = api.clampPanelPosition;
  assert.deepEqual(plain(clamp({left:-100,top:-50},{width:390,height:600},{width:1024,height:768})),{left:8,top:8});
  assert.deepEqual(plain(clamp({left:2000,top:900},{width:390,height:600},{width:1024,height:768})),{left:626,top:160});
  assert.deepEqual(plain(clamp({left:200,top:300},{width:390,height:600},{width:200,height:400})),{left:0,top:0});
});

test('opening beside the robot prefers its left, falls back right and keeps the bottom aligned within the viewport', () => {
  const anchor = env().api.anchoredPanelPosition, size = {width:390,height:600}, viewport = {width:1400,height:900};
  assert.deepEqual(plain(anchor({left:1250,right:1318,bottom:850},size,viewport)),{left:848,top:250});
  assert.deepEqual(plain(anchor({left:40,right:108,bottom:700},size,viewport)),{left:120,top:100});
  assert.deepEqual(plain(anchor({left:600,right:668,bottom:90},size,viewport)),{left:198,top:8});
  assert.deepEqual(plain(anchor({left:100,right:168,bottom:280},size,{width:350,height:430})),{left:0,top:0});
});

test('robot drag anchors the open drawer once after its final position commits and leaves drawer dragging independent', () => {
  const {api} = env(), docEvents = {}, events = {}, classes = {add() {},remove() {}}, win = {innerWidth:1400,innerHeight:900,addEventListener() {},requestAnimationFrame:() => 1,cancelAnimationFrame() {}};
  const panel = {style:{},classList:classes,getBoundingClientRect:() => ({left:Number.parseFloat(panel.style.left) || 800,top:Number.parseFloat(panel.style.top) || 200,width:390,height:600})};
  const headerEvents = {}, header = {classList:classes,addEventListener:(k,fn) => {headerEvents[k] = fn;}};
  const panelDoc = {}, drawer = api.bindPanelDrag(panel,header,{window:win,document:{addEventListener:(k,fn) => {panelDoc[k] = fn;}}});
  const robot = {style:{},classList:classes,getBoundingClientRect:() => ({left:1200,top:700,width:68,height:88}),addEventListener:(k,fn) => {events[k] = fn;}};
  let anchored = 0;
  api.bindPanelDrag(robot,robot,{window:win,document:{addEventListener:(k,fn) => {docEvents[k] = fn;}},threshold:5,ignoreInteractive:false,onEnd:() => {anchored++; const left=parseFloat(robot.style.left),top=parseFloat(robot.style.top); drawer.place(api.anchoredPanelPosition({left,right:left+68,bottom:top+88},{width:390,height:600},{width:1400,height:900}),{width:390,height:600});}});
  const event = (x,y) => ({button:0,pointerId:2,clientX:x,clientY:y,target:{closest:() => null},preventDefault() {},stopPropagation() {}});
  events.pointerdown(event(1230,730)); docEvents.pointermove(event(500,400)); assert.equal(anchored,0);
  docEvents.pointerup(event(400,350)); assert.equal(anchored,1); assert.deepEqual(plain(drawer.position()),{left:450,top:8});
  headerEvents.pointerdown(event(460,20)); panelDoc.pointerup(event(560,120)); assert.deepEqual(plain(drawer.position()),{left:550,top:108});
});

test('header pointer drag clamps and survives close/reopen/resize without stealing close or input interactions', () => {
  const {api} = env(), handleEvents = {}, docEvents = {}, windowEvents = {}, classes = new Set();
  let captured = 0, prevented = 0, hidden = false;
  const panel = {style:{}, getBoundingClientRect:() => ({left:parseFloat(panel.style.left) || 600,top:parseFloat(panel.style.top) || 160,width:hidden ? 0 : 390,height:hidden ? 0 : 600})};
  const handle = {addEventListener:(k, fn) => {handleEvents[k] = fn;},classList:{add:n => classes.add(n),remove:n => classes.delete(n)},setPointerCapture:() => {captured++;},releasePointerCapture:() => {}};
  const doc = {addEventListener:(k, fn) => {docEvents[k] = fn;}}, win = {innerWidth:1024,innerHeight:768,addEventListener:(k, fn) => {windowEvents[k] = fn;}};
  const drag = api.bindPanelDrag(panel,handle,{document:doc,window:win});
  const pointer = (values = {}) => ({button:0,pointerId:9,clientX:650,clientY:180,target:{closest:() => null},preventDefault:() => {prevented++;},stopPropagation() {},...values});
  handleEvents.pointerdown(pointer({target:{closest:() => ({tagName:'BUTTON'})}}));
  handleEvents.pointerdown(pointer({target:{closest:() => ({tagName:'TEXTAREA'})}}));
  assert.equal(captured,0); assert.equal(prevented,0);
  handleEvents.pointerdown(pointer()); assert.equal(captured,1); assert(api.bindPanelDrag);
  docEvents.pointermove(pointer({pointerId:10,clientX:0,clientY:0})); assert.equal(drag.position(),null);
  docEvents.pointermove(pointer({clientX:-100,clientY:-100})); assert.deepEqual(plain(drag.position()),{left:8,top:8}); assert(classes.has('nf-xiaotao-dragging'));
  docEvents.pointerup(pointer({clientX:-100,clientY:-100})); assert.equal(classes.size,0); assert.equal(panel.style.position,'fixed');
  hidden = true; win.innerWidth = 350; win.innerHeight = 430; windowEvents.resize();
  hidden = false; drag.reclamp(); assert.deepEqual(plain(drag.position()),{left:0,top:0});
  docEvents.pointermove(pointer({clientX:1000,clientY:1000})); assert.deepEqual(plain(drag.position()),{left:0,top:0});
});

test('drag reads layout once, coalesces moves in one frame and commits the final pointer-up coordinate', () => {
  const {api} = env(), events = {}, docEvents = {}, frames = new Map(); let layouts = 0, frameId = 0;
  const classes = {add() {},remove() {}}, panel = {style:{},classList:classes,getBoundingClientRect:() => {layouts++; return {left:900,top:400,width:390,height:600};}};
  const handle = {classList:classes,addEventListener:(k, fn) => {events[k] = fn;},setPointerCapture() {},releasePointerCapture() {}};
  const win = {innerWidth:2200,innerHeight:1300,requestAnimationFrame:fn => {frames.set(++frameId,fn); return frameId;},cancelAnimationFrame:id => frames.delete(id),addEventListener() {}};
  const drag = api.bindPanelDrag(panel,handle,{window:win,document:{addEventListener:(k, fn) => {docEvents[k] = fn;}}});
  const event = (x, y) => ({button:0,pointerId:1,clientX:x,clientY:y,target:{closest:() => null},preventDefault() {},stopPropagation() {}});
  events.pointerdown(event(1000,450));
  for (let i = 1; i <= 30; i++) docEvents.pointermove(event(1000 - i * 5,450 - i * 3));
  assert.equal(layouts,1); assert.equal(frames.size,1); assert.equal(panel.style.left,undefined);
  const paint = Array.from(frames.values())[0]; frames.clear(); paint(); assert.equal(panel.style.transform,'translate3d(-150px,-90px,0)');
  docEvents.pointermove(event(700,200)); assert.equal(frames.size,1);
  docEvents.pointerup(event(400,100));
  assert.equal(layouts,1); assert.equal(frames.size,0); assert.equal(panel.style.left,'300px'); assert.equal(panel.style.top,'50px'); assert.equal(panel.style.transform,'');
  assert.deepEqual(plain(drag.position()),{left:300,top:50});
});

test('robot movement threshold distinguishes a normal click from dragging and never opens on drag completion', () => {
  const {api} = env(), events = {}, docEvents = {}, classes = {add() {},remove() {}};
  const robot = {style:{},classList:classes,getBoundingClientRect:() => ({left:900,top:600,width:68,height:88}),addEventListener:(k, fn) => {events[k] = fn;},setPointerCapture() {},releasePointerCapture() {}};
  const win = {innerWidth:1024,innerHeight:768,addEventListener() {},requestAnimationFrame:() => 1,cancelAnimationFrame() {}};
  const drag = api.bindPanelDrag(robot,robot,{window:win,document:{addEventListener:(k, fn) => {docEvents[k] = fn;}},threshold:5,ignoreInteractive:false});
  const event = (x, y) => ({button:0,pointerId:2,clientX:x,clientY:y,target:{closest:() => robot},preventDefault() {},stopPropagation() {}});
  events.pointerdown(event(930,630)); docEvents.pointerup(event(932,632)); assert.equal(drag.consumeClick(),false);
  events.pointerdown(event(930,630)); docEvents.pointermove(event(500,300)); docEvents.pointerup(event(400,200));
  assert.equal(drag.consumeClick(),true); assert.equal(drag.consumeClick(),false); assert.equal(robot.style.left,'370px'); assert.equal(robot.style.top,'170px');
});

test('no images or a non-drawing page can chat without a fingerprint or an executable proposal', async () => {
  const e = env(), payloads = []; e.refs.splice(0); e.state.active = false; e.setSurface('other');
  const controller = e.api.createController({bridge:e.bridge,api:() => ({artAgentChat:async p => {payloads.push(plain(p)); return {ok:true,data:{mode:'chat',reply:'你好，我可以陪你讨论想法。',history:[{role:'user',content:p.message},{role:'assistant',content:'你好'}],proposal:{prompt:'must not execute'}}};}})});
  assert.equal(await controller.send('你好'),true); assert.equal(payloads[0].mode,'chat'); assert.equal(payloads[0].provider,'local'); assert.equal(payloads[0].contextFingerprint,undefined); assert.deepEqual(payloads[0].images,[]);
  assert.equal(controller.state.proposal,null); assert.equal(e.calls.length,0); assert.equal(controller.state.messages.at(-1).content,'你好，我可以陪你讨论想法。');
});

test('same full source may preserve its airport background without being mistaken for a separate background donor', async () => {
  const e = env(); for (const r of e.refs) r.drawingRole = 'auto';
  e.state.prompt = '参考图1中的人物和机场场景，采用图2画风';
  const input = e.sandbox.NovaFlowArtDirection.input(e.runtime.captureContext()); assert(input.references[0].roles.includes('subject')); assert(input.references[0].roles.includes('background'));
  const snapshot = e.bridge.capture(); assert.deepEqual(plain(snapshot.images.map(x => x.role)),['subject','style']);
  await e.bridge.applyProposal(await proposal(e,snapshot),snapshot); assert(e.getPrepared());
  const rejected = env(); rejected.refs[0].drawingRole = 'background'; assert.throws(() => rejected.bridge.capture(),/参考图用途/);
});

test('one companion keeps text across brain switches without reusing provider conversation IDs', async () => {
  const e = env(), payloads = []; e.refs.splice(0);
  const controller = e.api.createController({bridge:e.bridge,api:() => ({artAgentChat:async p => {payloads.push(plain(p)); return {ok:true,data:{mode:'chat',conversationId:p.provider+'-session',reply:'已回复',history:[...p.history,{role:'user',content:p.message},{role:'assistant',content:'已回复'}]}};}})});
  await controller.send('本地聊聊'); assert.equal(payloads[0].mode,'creation'); assert.equal(controller.state.conversationId,'local-session');
  const messages = plain(controller.state.messages); controller.setProvider('api'); assert.deepEqual(plain(controller.state.messages),messages);
  await controller.send('API聊聊'); assert.equal(payloads[1].mode,'chat'); assert.equal(payloads[1].provider,'api'); assert.deepEqual(payloads[1].images,[]); assert.equal(payloads[1].contextFingerprint,undefined); assert.equal(payloads[1].conversationId,undefined); assert.equal(payloads[1].history[0].content,'本地聊聊');
  controller.setProvider('local'); assert.equal(controller.state.conversationId,''); assert.equal(controller.state.history[2].content,'API聊聊');
  await controller.send('继续'); assert.equal(payloads[2].conversationId,undefined); assert.equal(payloads[2].history[2].content,'API聊聊');
});

test('opening defaults to local and retains latest text from an online archive without its backend identity', () => {
  const e=env(), saved={provider:'api',sessions:{local:{messages:[],history:[],conversationId:'old-local'},api:{messages:[{role:'assistant',content:'最近的回复'}],history:[{role:'assistant',content:'最近的回复'}],conversationId:'online-session'}}};
  const controller=e.api.createController({bridge:e.bridge,storage:{getItem:()=>JSON.stringify(saved)}});
  assert.equal(controller.state.provider,'local'); assert.equal(controller.state.conversationId,''); assert.equal(controller.state.messages[0].content,'最近的回复'); assert.equal(controller.state.history[0].content,'最近的回复');
});

test('current drawing results are attached as actual feedback pixels and new-conversation requests work through chat', async () => {
  const e=env(), payloads=[]; e.state.results.unshift({id:'actual',imageUrl:png(25),name:'actual.png'});
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p)); return {ok:true,data:{reply:'已回复',conversationId:'local-session',history:[...p.history,{role:'user',content:p.message},{role:'assistant',content:'已回复'}]}};}})});
  await controller.send('评价当前成图'); assert.equal(payloads[0].images[2].role,'output'); assert.equal(payloads[0].images[2].dataUrl,png(25));
  await controller.send('不要评价当前成图，只聊画风'); assert.equal(payloads[1].images.length,3); assert.equal(payloads[1].images[2].dataUrl,png(25));
  controller.setProvider('api'); await controller.send('评价当前成图'); assert.equal(payloads.length,3); assert.equal(payloads[2].images[2].role,'result'); assert.equal(payloads[2].images[2].dataUrl,png(25));assert.equal(payloads[2].mode,'chat');assert.equal(payloads[2].executionApproval,undefined);
  await controller.send('新对话'); assert.equal(payloads.length,3); assert.equal(controller.state.messages.length,0); assert.equal(controller.state.history.length,0); assert.equal(controller.state.conversationId,'');
  controller.setProvider('local'); assert.equal(controller.state.messages.length,0); assert.equal(e.calls.length,0);
});

test('capture, captureChat, fingerprint and companion chat send data urls for an uploaded reference', async () => {
  const e = env();
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6]);
  const uploaded = (name, role) => {
    const file = new File([bytes], name, { type: 'image/png' });
    return { name, dataUrl: 'blob:preview/' + name, mimeType: 'image/png', file, drawingRole: role };
  };
  e.refs[0] = uploaded('subject.png', 'subject');
  e.refs[1] = uploaded('style.png', 'style');
  const captured = await e.bridge.capture();
  const chat = await e.bridge.captureChat();
  for (const image of [...captured.images, ...chat.images]) {
    assert.match(image.dataUrl, /^data:image\/png;base64,/);
    assert.equal(image.dataUrl.includes('blob:'), false);
  }
  assert.equal(JSON.stringify(captured).includes('blob:'), false);
  assert.equal(JSON.stringify(chat).includes('blob:'), false);
  const digest = await e.api.fingerprint(captured);
  assert.equal(digest, await e.api.fingerprint(chat.images.length ? { ...captured, images: captured.images } : captured));
  assert.equal(typeof digest, 'string');
  assert.equal(digest.length, 64);
  const payloads = [];
  const controller = e.api.createController({ bridge: e.bridge, api: () => ({
    artAgentChat: async (payload) => {
      payloads.push(JSON.parse(JSON.stringify(payload)));
      return { ok: true, data: { reply: '看到了。', history: [], quota: { billing_mode: 'token', settled_credits: 8, estimated_credits: 21 } } };
    }
  }) });
  controller.setProvider('api');
  assert.equal(await controller.send('看看这两张参考'), true);
  assert.ok(payloads[0].images.length >= 1);
  for (const image of payloads[0].images) assert.match(image.dataUrl, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(payloads[0]).includes('blob:'), false);
  const calls = [];
  e.sandbox.electronAPI = {
    promptAssistantGetStatus: async () => ({ ok: true, result: { ok: true, analysisBackend: 'strata', supportsOriginalImages: true } }),
    promptAssistantReverseImagePrompt: async (payload) => { calls.push(JSON.parse(JSON.stringify(payload))); return { ok: false }; }
  };
  await assert.rejects(e.sandbox.NovaFlowArtDirection.prepare({
    state: { ...e.state, prompt: '图1用图2画风', mode: 'img2img', drawingAnalysisEngine: 'local', provider: 'local' },
    references: e.refs, referenceLimit: 10, generationSurface: 'drawing', onProgress() {}
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].images.length, 2);
  for (const image of calls[0].images) {
    assert.match(image.dataUrl, /^data:image\/png;base64,/);
    assert.equal(image.dataUrl.includes('blob:'), false);
  }
  assert.equal(JSON.stringify(calls[0]).includes('blob:'), false);
});

test('an online reply shows the settled credits and writes a transcript receipt', async () => {
  const e = env();
  const controller = e.api.createController({bridge:e.bridge, api:() => ({
    artAgentChat: async () => ({ok:true, data:{
      reply:'好的。', history:[], mode:'chat', provider:'api',
      quota:{billing_mode:'token', settled_credits:8, estimated_credits:21, balance_after:90}
    }})
  })});
  controller.setProvider('api');
  assert.equal(await controller.send('你好'), true);
  assert.match(controller.state.status, /实扣 8 分/);
  assert.match(controller.state.status, /剩余 90/);
  const receipt = controller.state.messages.find(item => item.role === 'status' && /本次实扣/.test(item.content));
  assert.equal(receipt.content, '本次实扣 8 分（预估 21）');
});

test('an unconfigured API shows an actual error and cancelling cloud wait does not claim to undo usage', async () => {
  const e = env();
  const unavailable = e.api.createController({bridge:e.bridge,api:() => ({artAgentChat:async () => ({ok:false,error:'尚未配置小猴API'})})}); unavailable.setProvider('api'); await unavailable.send('你好'); assert.match(unavailable.state.error,/未配置/); assert.equal(unavailable.state.proposal,null);
  const entered = deferred(), gate = deferred(), stops = [];
  const waiting = e.api.createController({bridge:e.bridge,api:() => ({artAgentChat:async () => {entered.resolve(); return gate.promise;},artAgentStop:async p => {stops.push(p); return {ok:true};}})});
  waiting.setProvider('api'); const run = waiting.send('你好'); await entered.promise; await waiting.stop(); assert.equal(stops.length,1); assert.equal(stops[0].provider,'api'); assert.match(stops[0].requestId,/^[\da-f-]{36}$/); assert.match(waiting.state.status,/停止等待/); assert.match(waiting.state.status,/计次可能已发生/); gate.resolve({ok:true,data:{reply:'late',history:[]}}); await run;
});

function manualTimers() {
  const pending = new Map(); let id = 0;
  return {pending,setTimeout(fn, delay) {pending.set(++id,{fn,delay}); return id;},clearTimeout(key) {pending.delete(key);},async next() {const [key, timer] = pending.entries().next().value; pending.delete(key); await timer.fn();}};
}

test('local pending status distinguishes cold loading and answering, then uses confirmed warm metadata without idle or API polling', async () => {
  const e = env(); e.refs.splice(0); e.setSurface('other');
  const timers = manualTimers(), gate = deferred(), entered = deferred(), loading = deferred(); let calls = 0;
  const sessions = [{state:'loading',modelLoaded:false},{state:'answering',modelLoaded:true}];
  const controller = e.api.createController({bridge:e.bridge,timers,onChange:s => {if (s.localSession?.state === 'loading') loading.resolve();},api:() => ({artAgentChat:async () => {entered.resolve(); return gate.promise;},promptAssistantGetStatus:async () => ({ok:true,chatSession:sessions[calls++]})})});
  const running = controller.send('你好'); await entered.promise; await loading.promise;
  assert.match(controller.state.status,/加载本地模型/); assert.match(controller.state.status,/等待主要来自模型载入/); assert.equal(calls,1); assert.equal(timers.pending.size,1); assert.equal([...timers.pending.values()][0].delay,1500);
  await timers.next(); assert.match(controller.state.status,/正在回答/); assert.equal(calls,2); assert.equal(timers.pending.size,1);
  gate.resolve({ok:true,data:{reply:'你好',history:[],chatSession:{state:'warm',modelLoaded:true,idleExpiresAt:Date.now()+120000}}}); await running;
  assert.equal(controller.state.localSession.state,'warm'); assert.equal(controller.state.localSession.modelLoaded,true); assert.equal(timers.pending.size,0); assert.equal(calls,2);
  controller.state.localSession.idleExpiresAt=Date.now()-1; controller.refreshContext(); assert.equal(controller.state.localSession,null); assert.equal(calls,2);
  controller.setProvider('api'); await controller.send('你好'); assert.equal(calls,2); assert.equal(timers.pending.size,0);
});

test('an old or foreign status reply cannot replace a stopped task or a later local request', async () => {
  const e = env(); e.refs.splice(0); const timers = manualTimers(), oldStatus = deferred(), oldReply = deferred(), newReply = deferred(), firstEntered = deferred(), secondEntered = deferred(); let requests = 0, statusCalls = 0;
  const controller = e.api.createController({bridge:e.bridge,timers,api:() => ({artAgentChat:async () => {if (++requests === 1) {firstEntered.resolve(); return oldReply.promise;} secondEntered.resolve(); return newReply.promise;},artAgentStop:async () => ({ok:true}),promptAssistantGetStatus:async () => ++statusCalls === 1 ? oldStatus.promise : ({ok:true,chatSession:{state:'loading',modelLoaded:false,activeRequestId:'a-different-request'}})})});
  const first = controller.send('第一条'); await firstEntered.promise; await controller.stop();
  const second = controller.send('第二条'); await secondEntered.promise; await Promise.resolve();
  const currentStatus=controller.state.status; assert.match(currentStatus,/正在连接本地助手|正在等待本地分析启动/);
  oldStatus.resolve({ok:true,chatSession:{state:'loading',modelLoaded:false}}); await Promise.resolve(); await Promise.resolve();
  assert.equal(controller.state.status,currentStatus); assert.equal(controller.state.localSession,null); assert.equal(timers.pending.size,1);
  newReply.resolve({ok:true,data:{reply:'第二条回复',history:[]}}); await second;
  oldReply.resolve({ok:true,data:{reply:'旧回复',history:[]}}); await first;
  assert.equal(controller.state.messages.at(-1).content,'第二条回复'); assert.equal(timers.pending.size,0);
});

test('basic Markdown renders as safe text nodes and structured lists without executing HTML or model links', () => {
  const {api}=env();
  class Node {
    constructor(tag, text='') {this.tagName=tag.toUpperCase(); this.children=[]; this.value=text;}
    append(...nodes) {this.children.push(...nodes);}
    set textContent(text) {this.value=text; this.children=[];}
    get textContent() {return this.value+this.children.map(n=>n.textContent).join('');}
    set innerHTML(_) {assert.fail('Model text must never enter innerHTML');}
  }
  const doc={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
  const body=api.renderMessageMarkdown(doc,'### 建议\n\n**光影**更清楚，使用 `CFG 3`。\n\n- 第一项\n- 第二项\n\n1. 准备\n2. 绘图\n\n```js\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(1)</script> [点击](javascript:alert(1))');
  assert.deepEqual(body.children.map(n=>n.tagName),['H4','P','UL','OL','PRE','P']);
  assert.equal(body.children[1].children[0].tagName,'STRONG'); assert.equal(body.children[1].children[2].tagName,'CODE');
  assert.equal(body.children[2].children.length,2); assert.equal(body.children[3].children.length,2);
  assert.equal(body.children[4].children[0].textContent,'<img src=x onerror=alert(1)>\n');
  const tags=node=>[node.tagName,...node.children.flatMap(tags)]; assert(!tags(body).some(tag=>['SCRIPT','IMG','A'].includes(tag))); assert(body.textContent.includes('<script>alert(1)</script>')); assert(!body.textContent.includes('**光影**'));
});

test('tabs sharing localStorage keep independent conversations and refresh their own archives, importing only text into a new tab', async () => {
  const e=env(); e.refs.splice(0); const globalKey='novaflow.xiaotao-art.chat.v1', values=new Map(), tabA=new Map(), tabB=new Map();
  const storage=map=>({getItem:key=>map.get(key) ?? null,setItem:(key,value)=>map.set(key,value)});
  const legacy=JSON.stringify({provider:'local',sessions:{local:{messages:[{role:'assistant',content:'之前的文字',imageUrl:'data:must-not-import'}],history:[{role:'user',content:'之前的问题'}],conversationId:'legacy-local'},api:{messages:[],history:[],conversationId:'legacy-api'}}}); values.set(globalKey,legacy);
  const shared=storage(values), aStorage=e.api.createTabScopedStorage(shared,storage(tabA)); let calls=0;
  const api=()=>({artAgentChat:async p=>({ok:true,data:{reply:'回复'+(++calls),conversationId:'new-session-'+calls,history:[...p.history,{role:'user',content:p.message},{role:'assistant',content:'回复'+calls}]}})});
  const a=e.api.createController({bridge:e.bridge,storage:aStorage,api});
  assert.equal(a.state.conversationId,''); assert.equal(a.state.messages[0].imageUrl,undefined); a.setProvider('api'); assert.equal(a.state.conversationId,''); a.setProvider('local'); await a.send('A页消息');
  const aKey=[...values.keys()].find(key=>key.startsWith(globalKey+':tab:')), aArchive=values.get(aKey); assert.equal(a.state.conversationId,'new-session-1');
  const bStorage=e.api.createTabScopedStorage(shared,storage(tabB)), b=e.api.createController({bridge:e.bridge,storage:bStorage,api});
  assert.notEqual(tabA.get(globalKey+':tab-id'),tabB.get(globalKey+':tab-id')); assert.equal(b.state.messages.at(-1).content,'回复1'); assert.equal(b.state.conversationId,'');
  await b.send('B页消息'); assert.equal(values.get(aKey),aArchive); assert.equal(values.get(globalKey),legacy);
  const bKey=[...values.keys()].find(key=>key.startsWith(globalKey+':tab:') && key!==aKey), bArchive=values.get(bKey);
  const aReload=e.api.createController({bridge:e.bridge,storage:e.api.createTabScopedStorage(shared,storage(tabA)),api});
  assert.equal(aReload.state.conversationId,'new-session-1'); assert.equal(aReload.state.messages.at(-1).content,'回复1');
  aReload.reset(); assert.equal(values.get(bKey),bArchive); assert.equal(values.get(globalKey),legacy);
  const bReload=e.api.createController({bridge:e.bridge,storage:e.api.createTabScopedStorage(shared,storage(tabB)),api}); assert.equal(bReload.state.conversationId,'new-session-2'); assert.equal(bReload.state.messages.at(-1).content,'回复2');
});

test('new conversation clears previous tool claims and names drawing context only in drawing mode', () => {
  const e=env(), controller=e.api.createController({bridge:e.bridge}); controller.state.toolTrace=[{name:'get_art_context'},{name:'propose_art_direction'}];
  controller.reset(); assert.deepEqual(plain(controller.state.toolTrace),[]); assert.equal(controller.state.status,'新对话，可以直接聊天');
  controller.state.mode='drawing'; controller.state.toolTrace=[{name:'get_art_context'}]; controller.reset(); assert.deepEqual(plain(controller.state.toolTrace),[]); assert.equal(controller.state.status,'新对话，将使用当前绘图内容');
});

test('opening calibration is one local status request, and an older calibration cannot undo a new conversation or provider change', async () => {
  const e=env(), timers=manualTimers(); let calls=0, next={ok:true,chatSession:{state:'warm',modelLoaded:true,idleExpiresAt:Date.now()+120000}};
  const controller=e.api.createController({bridge:e.bridge,timers,api:()=>({promptAssistantGetStatus:async()=>{calls++;return next;}})});
  await controller.calibrateLocalStatus(); assert.equal(calls,1); assert.equal(controller.state.localSession.state,'warm'); assert.equal(timers.pending.size,0);
  next={ok:true,chatSession:{state:'cold',modelLoaded:false}}; await controller.calibrateLocalStatus(); assert.equal(calls,2); assert.equal(controller.state.localSession.state,'cold');
  const old=deferred(); next=old.promise; const pending=controller.calibrateLocalStatus(); controller.reset(); old.resolve({ok:true,chatSession:{state:'warm',modelLoaded:true}}); await pending; assert.equal(controller.state.localSession.state,'cold');
  controller.setProvider('api'); await controller.calibrateLocalStatus(); assert.equal(calls,3); assert.equal(timers.pending.size,0);
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'); assert(source.includes('上次已就绪')); assert(!source.includes('待机·已加载'));
});

test('a first style replacement asks sampling before any Flash request, then uses the explicitly chosen Turbo 8 CFG3 once',async()=>{
  const e=env(),payloads=[];e.state.localQwen21Variant='standard';e.state.negativePrompt='';e.state.samplingOverrides={};
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async payload=>{payloads.push(plain(payload));return {ok:true,data:{reply:'重绘方案',history:[],proposal:{...await proposal(e),action:'generate'}}};}})});
  assert.equal(await controller.send('帮我把图1的风格换成图2'),true);
  assert.equal(payloads.length,0);assert.equal(e.calls.length,0);assert.equal(controller.state.pending,false);
  assert.deepEqual([controller.state.confirmation.sampling.variant,controller.state.confirmation.sampling.steps,controller.state.confirmation.sampling.cfg],['standard',25,1]);
  assert.match(controller.state.messages.at(-1).content,/执行|确认/);assert.match(controller.state.messages.at(-1).content,/使用 CFG3/);assert.equal(controller.state.messages.at(-1).role,'status');
  assert.equal(await controller.send('加速8步CFG3'),true,controller.state.error);
  assert.equal(payloads.length,1);assert.equal(e.calls.length,1);assert.deepEqual([payloads[0].artContext.localQwen21Variant,payloads[0].artContext.steps,payloads[0].artContext.cfg],['turbo',8,3]);
  assert.deepEqual([e.bridge.readSampling().steps,e.bridge.readSampling().cfg],[8,3]);assert.equal(controller.state.confirmation,null);
});

test('current style settings disclose CFG3 and pin it before analysis while generic creation retains its chosen CFG',async()=>{
  const e=env();e.state.localQwen21Variant='standard';e.state.negativePrompt='';e.state.samplingOverrides={};let actual;
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{actual=p;return {ok:true,data:{reply:'准备好了',history:[],proposal:await proposal(e)}};}})});
  await controller.send('帮我把图1的风格换成图2');assert.match(controller.state.messages.at(-1).content,/当前是 普通版 · 25 步 · CFG 1/);assert.match(controller.state.messages.at(-1).content,/设为 CFG3/);
  assert.equal(await controller.send('按当前参数'),true,controller.state.error);assert.equal(actual.artContext.cfg,3);assert.equal(actual.artContext.steps,25);assert.equal(actual.artContext.localQwen21Variant,'standard');assert.equal(e.calls.length,1);
  const single=env();single.refs.splice(1);single.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg=2;
  const sampling=single.bridge.setSampling('current');assert.equal(sampling.styleTransfer,false);assert.equal(sampling.cfg,2);assert.equal(single.state.negativePrompt,'  不要文字，保留原负向  ');
});

test('questions, refusals, quoted execution, prompt-only requests and discussion never become pre-analysis generation consent',async()=>{
  for(const message of ['帮我把图1的风格换成图2好吗？','不要生成，只给我提示词','请解释按当前参数是什么意思','先不生成，聊聊画风','给我完整提示词','这个图的颜色为什么不对？']) {
    const e=env(),controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>({ok:true,data:{reply:'讨论回复',history:[],proposal:{...await proposal(e),action:'generate'}}})})});
    await controller.send(message);assert.equal(e.calls.length,0,message);assert.equal(controller.state.confirmation,null,message);assert.equal(e.state.prompt,'图1用图2画风',message);
  }
  const e=env();let modelCalls=0;const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>{modelCalls++;return {ok:true,data:{reply:'只讨论',history:[]}};}})});
  await controller.send('帮我把图1的风格换成图2');assert.equal(await controller.send('取消'),true);assert.equal(modelCalls,0);assert.equal(e.calls.length,0);assert.equal(controller.state.confirmation,null);
  await controller.send('你好');assert.equal(modelCalls,1);assert.equal(controller.state.confirmation,null);assert.equal(e.calls.length,0);
});

test('changing manual sampling, references, negative or resolution invalidates an unanswered confirmation without loading Flash',async()=>{
  for(const change of [e=>{e.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg=4;},e=>{e.refs[1].dataUrl=png(71);},e=>{e.state.negativePrompt+='changed';},e=>{e.state.width=1024;}]) {
    const e=env({cfg:3});let modelCalls=0;const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>{modelCalls++;throw Error('must not infer');}})});
    await controller.send('帮我把图1的风格换成图2');change(e);controller.refreshContext();assert.equal(controller.state.confirmation,null);assert.equal(await controller.confirmSampling('turbo'),false);assert.equal(modelCalls,0);assert.equal(e.calls.length,0);
  }
});

test('a changed reference detected at confirmation asks again and cannot reinterpret the old click as consent for new input',async()=>{
  const e=env({cfg:3});let requests=0;const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>{requests++;throw Error('must not infer');}})});
  await controller.send('帮我把图1的风格换成图2');const before=controller.state.confirmation;e.refs[0].dataUrl=png(155);
  assert.equal(await controller.confirmSampling('current'),true);assert.notEqual(controller.state.confirmation,before);assert.equal(requests,0);assert.equal(controller.state.samplingApproval,null);
});

test('explicit visual feedback without prior consent asks before analysis; unchanged approved feedback reuses sampling visibly',async()=>{
  const e=env({cfg:3}),payloads=[];e.state.results.unshift({id:'old',imageUrl:png(44),name:'old.png'});
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p));return {ok:true,data:{reply:'修改完成方案',history:[],proposal:{...await proposal(e,e.bridge.capture({includeResult:true})),action:'generate'}}};}})});
  await controller.send('这张太蓝，请改成参考图那种颜色');assert.equal(payloads.length,0);assert(controller.state.confirmation);
  assert.equal(await controller.confirmSampling('current'),true,controller.state.error);assert.equal(payloads.length,1);assert.equal(e.calls.length,1);
  await controller.send('头发还是太写实，改成更明确的动漫发束');assert.equal(payloads.length,2);assert.equal(e.calls.length,2);assert.equal(controller.state.confirmation,null);
  assert(controller.state.messages.some(m=>m.role==='status' && /本次使用 Turbo 加速版 · 8 步 · CFG 3/.test(m.content)));
  e.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg=4;
  await controller.send('这张太蓝，请改成参考图的冷色');assert.equal(payloads.length,2);assert.equal(e.calls.length,2);assert.equal(controller.state.confirmation.sampling.cfg,4);
});

test('ordinary discussion of an actual result does not inherit old permission to execute a rogue model action',async()=>{
  const e=env({cfg:3});e.state.results.unshift({id:'old',imageUrl:png(44),name:'old.png'});
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async()=>({ok:true,data:{reply:'讨论',history:[],proposal:{...await proposal(e,e.bridge.capture({includeResult:true})),action:'generate'}}})})});
  controller.state.samplingApproval=e.bridge.readSampling();await controller.send('这张的画法为什么这样？');assert.equal(e.calls.length,0);assert.equal(controller.state.confirmation,null);
});

test('sampling setters reject arbitrary routes, use original API and do not alter references or negative text',()=>{
  const e=env();const before=plain(e.refs),negative=e.state.negativePrompt;let writes=0;const setter=e.sandbox.NovaFlowArtGenerateModels.setLocalSamplingValue;
  e.sandbox.NovaFlowArtGenerateModels.setLocalSamplingValue=(...args)=>{writes++;return setter(...args);};
  assert.throws(()=>e.bridge.setSampling('flux'),/请选择/);assert.equal(writes,0);
  const standard=e.bridge.setSampling('standard');assert.deepEqual([standard.variant,standard.steps,standard.cfg],['standard',25,3]);assert.equal(writes,2);
  assert.deepEqual(plain(e.refs),before);assert.equal(e.state.negativePrompt,negative);
});

test('drawing progress uses the matching operation phase and elapsed time instead of cold ordinary-chat metadata',async()=>{
  const e=env({cfg:3}),timers=manualTimers(),entered=deferred(),gate=deferred(),firstStatus=deferred();let payload,statusCalls=0,phase='loading';
  const controller=e.api.createController({bridge:e.bridge,timers,onChange:s=>{if(s.operation)firstStatus.resolve();},api:()=>({artAgentChat:async p=>{payload=p;entered.resolve();return gate.promise;},
    promptAssistantGetStatus:async()=>{statusCalls++;return {ok:true,chatSession:{state:'cold',modelLoaded:false},operation:{requestId:payload.requestId,phase,startedAt:Date.now()-42000}};}})});
  await controller.send('帮我把图1的风格换成图2');assert.equal(statusCalls,0);const running=controller.confirmSampling('turbo');await entered.promise;await firstStatus.promise;
  assert.match(controller.state.status,/正在加载本地模型.*42 秒/);assert.equal(controller.state.operation.phase,'loading');
  phase='analyzing';await timers.next();assert.match(controller.state.status,/正在分析当前绘图.*42 秒/);assert.equal(controller.state.localSession,null);
  phase='releasing';await timers.next();assert.match(controller.state.status,/正在释放模型资源，准备生图/);
  gate.resolve({ok:true,data:{reply:'已分析',history:[],proposal:await proposal(e)}});assert.equal(await running,true,controller.state.error);assert.equal(timers.pending.size,0);assert.equal(controller.state.operation,null);assert.equal(e.calls.length,1);
  assert(controller.state.messages.some(m=>m.role==='status' && /请求已收到/.test(m.content)));
});

test('real sampling confirmation supplies a request-bound approval separately from the unchanged snapshot and user history',async()=>{
  const e=env({cfg:3}),payloads=[],history=[{role:'user',content:'之前的实际需求'},{role:'assistant',content:'之前的实际回复'}];
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p));return {ok:true,data:{reply:'准备生成',history,proposal:await proposal(e)}};}})});controller.state.history=plain(history);
  const message='帮我把图1的风格换成图2';await controller.send(message);assert.equal(payloads.length,0);
  assert.equal(await controller.confirmSampling('turbo'),true,controller.state.error);assert.equal(payloads.length,1);const p=payloads[0];
  assert.deepEqual(p.executionApproval,{schema:'nf.art.execution-approval.v1',requestId:p.requestId,contextFingerprint:p.contextFingerprint,action:'generate',imageCount:1,sampling:{variant:'turbo',steps:8,cfg:3},basis:'sampling-confirmation'});
  assert.equal(p.message,message);assert.deepEqual(p.history,history);assert.equal(Object.hasOwn(p.artContext,'executionApproval'),false);assert.equal(computeArtAgentFingerprint(p),p.contextFingerprint);assert.equal(e.calls.length,1);
});

test('approved feedback rebinds consent to this actual result request; discussion and prompt-only requests do not transmit approval',async()=>{
  const e=env({cfg:3}),payloads=[];e.state.results.unshift({id:'old',imageUrl:png(44),name:'old.png'});
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p));return {ok:true,data:{reply:'实际回复',history:[],proposal:{...await proposal(e,e.bridge.capture({includeResult:true})),action:p.executionApproval?'generate':'prompt'}}};}})});
  controller.state.samplingApproval=e.bridge.readSampling();await controller.send('这张太蓝，请改成参考图的颜色');const feedback=payloads[0];
  assert.equal(feedback.executionApproval.basis,'approved-feedback');assert.equal(feedback.executionApproval.requestId,feedback.requestId);assert.equal(feedback.executionApproval.contextFingerprint,feedback.contextFingerprint);assert.equal(feedback.images[2].dataUrl,png(44));assert.equal(e.calls.length,1);
  await controller.send('这张的画法为什么这样？');assert.equal(Object.hasOwn(payloads[1],'executionApproval'),false);
  await controller.send('只给我提示词');assert.equal(Object.hasOwn(payloads[2],'executionApproval'),false);assert.equal(e.calls.length,1);
  e.setSurface('other');e.refs.splice(0);e.state.active=false;await controller.send('你好');assert.equal(payloads[3].mode,'chat');assert.equal(Object.hasOwn(payloads[3],'executionApproval'),false);
});

test('generic creation confirmation carries the actual chosen sampling without synthesizing a user confirmation in history',async()=>{
  const e=env(),payloads=[];e.refs.splice(0);e.state.mode='txt2img';
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p));return {ok:true,data:{reply:'准备创作',history:[],proposal:await creationProposal(e)}};}})});
  await controller.send('帮我画一个阳光花园');assert.equal(await controller.confirmSampling('current'),true,controller.state.error);const p=payloads[0],sampling=e.bridge.readSampling();
  assert.equal(p.mode,'creation');assert.deepEqual(p.history,[]);assert.equal(p.executionApproval.basis,'sampling-confirmation');assert.deepEqual(p.executionApproval.sampling,{variant:sampling.variant,steps:sampling.steps,cfg:sampling.cfg});assert.deepEqual(p.executionApproval.sampling,{variant:p.artContext.localQwen21Variant,steps:p.artContext.steps,cfg:p.artContext.cfg});assert.equal(p.executionApproval.contextFingerprint,computeArtAgentFingerprint(p));assert.equal(payloads.length,1);
});

test('creation snapshots expose actual mode-specific sampling and a standard default without changing saved manual fields',async()=>{
  const e=env();e.refs.splice(1);delete e.state.localQwen21Variant;e.state.mode='img2img';e.state.samplingOverrides={'qwen-2.1:img2img':{steps:32,cfg:4}};
  const before=plain(e.state),snapshot=e.bridge.captureCreation(),again=e.bridge.captureCreation();
  assert.deepEqual([snapshot.artContext.localQwen21Variant,snapshot.artContext.steps,snapshot.artContext.cfg],['standard',32,4]);assert.equal(e.api.sameSnapshot(snapshot,again),true);assert.deepEqual(plain(e.state),before);assert.equal(Object.hasOwn(e.state,'localQwen21Variant'),false);
  assert.equal(await e.api.fingerprint(snapshot),computeArtAgentFingerprint(plain(snapshot)));
  e.state.samplingOverrides['qwen-2.1:img2img'].cfg=5;const changed=e.bridge.captureCreation();assert.equal(changed.artContext.cfg,5);assert.equal(e.api.sameSnapshot(snapshot,changed),false);
});

test('a sampling change during asynchronous fingerprinting cannot send a stale execution approval or start inference',async()=>{
  const e=env({cfg:3});let mutate=false,calls=0;
  const controller=e.api.createController({bridge:e.bridge,onChange:state=>{if(mutate && state.pending){mutate=false;e.state.samplingOverrides['qwen-2.1-turbo:img2img'].cfg=4;}},api:()=>({artAgentChat:async()=>{calls++;throw Error('must not infer');}})});
  await controller.send('帮我把图1的风格换成图2');mutate=true;assert.equal(await controller.confirmSampling('turbo'),false);assert.equal(calls,0);assert.equal(e.calls.length,0);assert.match(controller.state.error,/已变化/);
});

test('new conversation clears the entire conversation context while keeping drawing settings, references and selected intelligence',()=>{
  const e=env({cfg:3}),controller=e.api.createController({bridge:e.bridge}),drawing=plain(e.state),references=plain(e.refs);controller.setProvider('api');
  Object.assign(controller.state,{messages:[{role:'user',content:'old message'}],history:[{role:'assistant',content:'old history'}],conversationId:'old-conversation',proposal:{prompt:'old proposal'},proposalSnapshot:{old:true},applied:true,
    confirmation:{old:true},samplingApproval:{old:true},operation:{old:true},toolTrace:[{name:'old-tool'}],error:'old error'});
  for(const flag of ['pending','applying','generating']) {controller.state[flag]=true;assert.equal(controller.reset(),false);assert.equal(controller.state.conversationId,'old-conversation');controller.state[flag]=false;}
  assert.equal(controller.reset(),true);assert.deepEqual(plain(controller.state.messages),[]);assert.deepEqual(plain(controller.state.history),[]);assert.equal(controller.state.conversationId,'');
  for(const key of ['proposal','proposalSnapshot','confirmation','samplingApproval','operation'])assert.equal(controller.state[key],null,key);
  assert.deepEqual(plain(controller.state.toolTrace),[]);assert.equal(controller.state.error,'');assert.equal(controller.state.applied,false);assert.equal(controller.state.provider,'api');assert.deepEqual(plain(e.state),drawing);assert.deepEqual(plain(e.refs),references);
});

test('mounted new-dialog button clears its draft and navigation closes only on a changed section, preserving chat and active requests',async()=>{
  const e=env({cfg:3}),events={},scheduled=[],intervals=[],nodes=[],attrs=node=>node.attributes;
  const matches=(node,selector)=>selector.split(',').some(part=>[...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([,key,value])=>attrs(node).has(key)&&(value===undefined||attrs(node).get(key)===value)));
  class Node {
    constructor(tag,text=''){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.dataset={};this.attributes=new Map();this.value='';this.ownText=text;this.hidden=false;this.classList={add(){},remove(){}};nodes.push(this);}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.ownText='';this.append(...children);}
    set textContent(value){this.children=[];this.ownText=String(value);}get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
    setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}
    addEventListener(){}getBoundingClientRect(){return {left:700,top:100,right:1090,bottom:750,width:390,height:650};}getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
    closest(selector){return matches(this,selector)?this:this.parentElement?.closest(selector)||null;}
    focus(){doc.activeElement=this;}click(){if(this.disabled)return;const event={target:this,preventDefault(){},stopPropagation(){}};for(const fn of events.click||[])fn(event);this.onclick?.(event);}
  }
  const doc={readyState:'complete',hidden:false,createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text),getElementById:id=>nodes.find(node=>node.id===id)||null,
    querySelectorAll:selector=>nodes.filter(node=>matches(node,selector)),addEventListener:(name,fn)=>(events[name]??=[]).push(fn)};doc.body=new Node('body');
  Object.assign(e.sandbox,{document:doc,innerWidth:1400,innerHeight:900,addEventListener(){},setTimeout:(fn,delay)=>{scheduled.push({fn,delay});return scheduled.length;},clearTimeout(){},setInterval:(fn,delay)=>{intervals.push({fn,delay});return intervals.length;}});
  const nav=(kind,label,active)=>{const node=doc.createElement('button');node.textContent=label;node.setAttribute(`data-novaflow-${kind}-entry`,'1');node.setAttribute(`data-novaflow-${kind}-active`,active?'1':'0');node.setAttribute('aria-pressed',String(active));if(kind==='primary')node.setAttribute('data-novaflow-primary-label',label);doc.body.append(node);return node;};
  const art=nav('primary','美工',true),animation=nav('primary','动画',false),drawing=nav('secondary','绘图',true),ui=nav('secondary','UI',false);
  for(const [node,kind,peers]of[[art,'primary',[art,animation]],[animation,'primary',[art,animation]],[drawing,'secondary',[drawing,ui]],[ui,'secondary',[drawing,ui]]])node.onclick=()=>{for(const peer of peers){const active=peer===node;peer.setAttribute('aria-pressed',String(active));peer.setAttribute(`data-novaflow-${kind}-active`,active?'1':'0');}};
  const gate=deferred(),entered=deferred();let waiting=false,stops=0;e.sandbox.electronAPI={artAgentChat:async p=>{if(waiting){entered.resolve();return gate.promise;}return {ok:true,data:{reply:'旧回复',conversationId:'old-session',history:[{role:'user',content:p.message},{role:'assistant',content:'旧回复'}]}};},artAgentStop:async()=>{stops++;return {ok:true};}};
  e.api.mount();const panel=e.api.panel,controller=panel.controller,button=nodes.find(node=>node.tagName==='BUTTON'&&node.textContent==='新对话'),input=nodes.find(node=>node.getAttribute('aria-label')==='给智能助手的消息'),aside=nodes.find(node=>node.id==='nf-xiaotao-art-panel'),log=nodes.find(node=>node.getAttribute('role')==='log');
  assert(button);assert.equal(button.type,'button');await controller.send('旧消息');input.value='未发送的旧草稿';const before=plain(e.state);button.click();assert.equal(controller.state.messages.length,0);assert.equal(controller.state.history.length,0);assert.equal(controller.state.conversationId,'');assert.equal(log.textContent.includes('旧消息'),false);assert.equal(input.value,'');assert.equal(doc.activeElement,input);assert.deepEqual(plain(e.state),before);
  panel.open();const flush=()=>{for(const timer of scheduled.splice(0)){if(timer.delay===0)timer.fn();}};art.click();flush();assert.equal(aside.hidden,false);const random=doc.createElement('button');doc.body.append(random);random.click();flush();assert.equal(aside.hidden,false);
  ui.click();flush();assert.equal(aside.hidden,true);panel.open();animation.click();flush();assert.equal(aside.hidden,true);assert.equal(doc.getElementById('nf-xiaotao-art-root').hidden,false);
  panel.open();e.state.seed++;for(const timer of intervals)if(timer.delay===500)timer.fn();assert.equal(aside.hidden,false);
  e.setSurface('editing');for(const timer of intervals)if(timer.delay===500)timer.fn();assert.equal(aside.hidden,true);
  controller.setProvider('api');waiting=true;const pending=controller.send('正在等待的消息');await entered.promise;panel.open();const count=controller.state.messages.length;assert.equal(button.disabled,true);button.click();assert.equal(controller.state.messages.length,count);art.click();flush();assert.equal(aside.hidden,true);assert.equal(controller.state.pending,true);assert.equal(stops,0);assert.equal(controller.state.messages.length,count);
  gate.resolve({ok:true,data:{reply:'等待结束',history:[]}});await pending;assert.equal(button.disabled,false);button.click();assert.equal(controller.state.provider,'api');assert.equal(controller.state.messages.length,0);
});

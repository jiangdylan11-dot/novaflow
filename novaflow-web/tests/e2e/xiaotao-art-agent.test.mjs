import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {computeArtAgentFingerprint} from '../../worker/src/flash-art-agent.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
function png(red) {
  const chunk = (name, value) => {const type = Buffer.from(name), data = Buffer.concat([type, value]); let crc = 0xffffffff;
    for (const byte of data) {crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);}
    const size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(value.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([size, data, sum]);};
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,red,0,0,255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
function env() {
  const saved = new Map(), calls = [], refs = [{name:'主体.png', drawingRole:'subject', dataUrl:png(160)}, {name:'画风.png', drawingRole:'style', dataUrl:png(80)}];
  const state = {active:true, provider:'local', mode:'img2img', nsfw:false, prompt:'图1用图2画风', negativePrompt:'  不要文字，保留原负向  ', width:1280, height:960, seed:54792256, randomSeed:false, count:4,
    localDrawEngine:'qwen-2.1', localQwen21Variant:'turbo', drawingAnalysisEngine:'local', samplingOverrides:{'qwen-2.1-turbo:img2img':{cfg:5, steps:8}}, results:[]};
  let prepared = null, surface = 'drawing';
  const runtime = {state, capturePrompt() {}, captureContext:() => ({state, references:refs, referenceLimit:10, generationSurface:surface}), render() {}, selectedResult:() => state.results[0],
    stageAgentPrepared(p) {p.assertCurrent(); prepared = p;}, clearAgentPrepared() {prepared = null;}, async cancel() {calls.push('cancel-generation');},
    async run() {const p = prepared; prepared = null; assert(p, 'Original generate consumes one staged proposal'); p.assertCurrent(); state.running = true; calls.push({prepared:p}); state.results.unshift({id:'actual-' + calls.length, imageUrl:png(30), name:'actual.png'}); state.running = false;}};
  const sandbox = {console, TextEncoder, crypto:webcrypto, atob:s => Buffer.from(s, 'base64').toString('binary'), setTimeout, clearTimeout,
    localStorage:{getItem:k => saved.get(k), setItem:(k, v) => saved.set(k, v)}, __NovaFlowArtGenerate:runtime,
    NovaFlowArtGenerateModels:{capabilityFor:() => ({engine:'qwen-2.1'}), localSamplingFor:() => ({cfg:5, steps:8})}};
  sandbox.window = sandbox; const vm = createContext(sandbox);
  for (const file of ['art-direction.workflow.js', 'xiaotao-art-agent.js']) runInContext(readFileSync(new URL('../../renderer/' + file, import.meta.url), 'utf8'), vm);
  const api = sandbox.NovaFlowXiaotaoArtAgent, bridge = api.createBridge();
  return {api, bridge, sandbox, runtime, state, refs, saved, calls, setSurface:v => {surface = v;}, getPrepared:() => prepared};
}
async function proposal(e, snapshot = e.bridge.capture()) {
  return {prompt:'Redraw <image1> using the painted style of <image2>.', negativePrompt:snapshot.artContext.negativePrompt, cfg:3,
    contextFingerprint:await e.api.fingerprint(snapshot), model:'flash-fixture', promptIds:['actual-native-id'], kind:'qwen21-strata-native', version:'flash-native-v1', sourceOrder:[1,2],
    providerPolicy:{schema:'nf.qwen21-native-provider.v1',cfg:3}, analysisBackend:'strata', modelIdentity:{id:'flash-fixture',verification:'server-model-id'}, resourcesReleased:true, generationReady:true};
}

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
  const e = env(), payloads = [], history = [{role:'user',content:'更像参考'}, {role:'assistant',content:'已准备建议'}];
  const controller = e.api.createController({bridge:e.bridge, api:() => ({artAgentChat:async payload => {payloads.push(plain(payload)); return {ok:true,data:{conversationId:'fixture-id',reply:'已准备建议',history,toolTrace:[{name:'get_art_context'},{name:'propose_art_direction'}],proposal:await proposal(e)}};}})});
  await controller.send('更像参考'); assert.equal(e.calls.length,0); assert.equal(controller.state.proposal.prompt,'Redraw <image1> using the painted style of <image2>.');
  const first = controller.apply({generate:true}), second = controller.apply({generate:true}); assert.equal(await second,false); assert.equal(await first,true); assert.equal(e.calls.length,1); assert.equal(payloads.length,1);
  assert.equal(controller.state.messages.at(-1).imageUrl,png(30));
  const stored = Array.from(e.saved.values()).join(''); assert(!stored.includes('data:image')); assert(!stored.includes('modelIdentity')); assert.deepEqual(plain(controller.state.history),history);
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

test('one companion keeps text across brain switches without reusing provider conversation IDs or sending cloud images', async () => {
  const e = env(), payloads = []; e.refs.splice(0);
  const controller = e.api.createController({bridge:e.bridge,api:() => ({artAgentChat:async p => {payloads.push(plain(p)); return {ok:true,data:{mode:'chat',conversationId:p.provider+'-session',reply:'已回复',history:[...p.history,{role:'user',content:p.message},{role:'assistant',content:'已回复'}]}};}})});
  await controller.send('本地聊聊'); assert.match(controller.state.status,/当前仅对话/); assert.equal(controller.state.conversationId,'local-session');
  const messages = plain(controller.state.messages); controller.setProvider('api'); assert.deepEqual(plain(controller.state.messages),messages);
  await controller.send('API聊聊'); assert.equal(payloads[1].mode,'chat'); assert.equal(payloads[1].provider,'api'); assert.equal(Object.hasOwn(payloads[1],'images'),false); assert.equal(payloads[1].contextFingerprint,undefined); assert.equal(payloads[1].conversationId,undefined); assert.equal(payloads[1].history[0].content,'本地聊聊');
  controller.setProvider('local'); assert.equal(controller.state.conversationId,''); assert.equal(controller.state.history[2].content,'API聊聊');
  await controller.send('继续'); assert.equal(payloads[2].conversationId,undefined); assert.equal(payloads[2].history[2].content,'API聊聊');
});

test('opening defaults to local and retains latest text from an online archive without its backend identity', () => {
  const e=env(), saved={provider:'api',sessions:{local:{messages:[],history:[],conversationId:'old-local'},api:{messages:[{role:'assistant',content:'最近的回复'}],history:[{role:'assistant',content:'最近的回复'}],conversationId:'online-session'}}};
  const controller=e.api.createController({bridge:e.bridge,storage:{getItem:()=>JSON.stringify(saved)}});
  assert.equal(controller.state.provider,'local'); assert.equal(controller.state.conversationId,''); assert.equal(controller.state.messages[0].content,'最近的回复'); assert.equal(controller.state.history[0].content,'最近的回复');
});

test('review and new-conversation requests work through chat, while ordinary chat does not attach a result', async () => {
  const e=env(), payloads=[]; e.state.results.unshift({id:'actual',imageUrl:png(25),name:'actual.png'});
  const controller=e.api.createController({bridge:e.bridge,api:()=>({artAgentChat:async p=>{payloads.push(plain(p)); return {ok:true,data:{reply:'已回复',conversationId:'local-session',history:[...p.history,{role:'user',content:p.message},{role:'assistant',content:'已回复'}]}};}})});
  await controller.send('评价当前成图'); assert.equal(payloads[0].images[2].role,'output'); assert.equal(payloads[0].images[2].dataUrl,png(25));
  await controller.send('不要评价当前成图，只聊画风'); assert.equal(payloads[1].images.length,2);
  controller.setProvider('api'); await controller.send('评价当前成图'); assert.equal(payloads.length,2); assert.match(controller.state.error,/在线智能当前只支持文字/);
  await controller.send('新对话'); assert.equal(payloads.length,2); assert.equal(controller.state.messages.length,0); assert.equal(controller.state.history.length,0); assert.equal(controller.state.conversationId,'');
  controller.setProvider('local'); assert.equal(controller.state.messages.length,0); assert.equal(e.calls.length,0);
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
  const currentStatus=controller.state.status; assert.equal(currentStatus,'正在连接本地助手…');
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

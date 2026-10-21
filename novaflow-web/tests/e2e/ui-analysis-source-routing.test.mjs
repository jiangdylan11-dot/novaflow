import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const renderer = process.env.NOVAFLOW_TEST_RENDERER_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../renderer');
const source = name => readFileSync(join(renderer, name), 'utf8');
class Node {
  constructor(doc, tag = 'div') { this.ownerDocument=doc; this.tagName=tag; this.style={}; this.attrs={}; this.children=[]; this.listeners={}; }
  setAttribute(k,v) { this.attrs[k]=String(v); }
  getAttribute(k) { return this.attrs[k]??null; }
  appendChild(n) { n.remove();this.children.push(n);n.parentElement=this;return n; }
  append(...nodes) { nodes.forEach(n=>this.appendChild(n)); }
  replaceChildren(...nodes) { this.children.forEach(n=>n.parentElement=null);this.children=[];this.append(...nodes); }
  remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null; }
  after(n) { n.remove();const p=this.parentElement;p.children.splice(p.children.indexOf(this)+1,0,n);n.parentElement=p; }
  get previousElementSibling() { const p=this.parentElement;return p?.children[p.children.indexOf(this)-1]??null; }
  get isConnected() { return !!(this.connected||this.parentElement?.isConnected); }
  contains(n) { return this===n||this.children.some(c=>c.contains(n)); }
  addEventListener(n,f) { this.listeners[n]=f; }
  removeEventListener(n) { delete this.listeners[n]; }
  matches(s) { if(s.startsWith('#'))return this.attrs.id===s.slice(1);const m=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);return !!m&&this.attrs[m[1]]!==undefined&&(m[2]===undefined||this.attrs[m[1]]===m[2]); }
  querySelectorAll(s) { return this.children.flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)]); }
  querySelector(s) { return this.querySelectorAll(s)[0]??null; }
  getBoundingClientRect() { return {width:0,height:0}; }
}
const tick=()=>new Promise(r=>setImmediate(r));
function environment(settings={}) {
  const storage=new Map(), listeners=new Set(), patches=[], calls=[];
  const doc={createElement:t=>new Node(doc,t)};doc.body=new Node(doc);doc.body.connected=true;doc.body.classList={contains:()=>true};
  doc.querySelector=s=>doc.body.querySelector(s);doc.querySelectorAll=s=>doc.body.querySelectorAll(s);doc.getElementById=id=>doc.querySelector('#'+id);
  const left=new Node(doc);left.setAttribute('data-psd-fusion-ui','1');left.setAttribute('data-novaflow-art-ui-host','1');doc.body.appendChild(left);
  const generate=new Node(doc);generate.setAttribute('data-novaflow-spine-split-control-category','generate');left.appendChild(generate);
  const canvas=new Node(doc);canvas.setAttribute('id','novaflow-spine-split-workspace-content');doc.body.appendChild(canvas);
  const project={settings:{...settings},project:{},resources:[],results:[]};
  const store={getState:()=>project,patchSettings:p=>{patches.push(p);Object.assign(project.settings,p);listeners.forEach(f=>f());},subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},serializeProject:()=>project};
  const state={provider:'local',mode:'img2img',prompt:'@参考图1参考布局。换成迪士尼风格，白雪公主主题的老虎机',width:758,height:1640,running:false};
  const refs=[{id:'layout',role:'layout',dataUrl:'data:image/png;base64,YWJj'}];
  const context={console,document:doc,AbortController,setTimeout,clearTimeout,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},removeEventListener(){},MutationObserver:class{observe(){}disconnect(){}},
    NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},
    NovaFlowLeftPanelAccordion:{...Object.fromEntries(['headerStyle','titleStyle','iconStyle','labelStyle','chevronStyle','panelStyle','bodyStyle'].map(k=>[k,()=>({})])),chevronClass:()=>'',syncExpanded(){}},
    NovaFlowUiDesignWorkbench:{mount:()=>({getSelection:()=>null,getLayout:()=>null,destroy(){}})},NovaFlowUiDesignInspectorTool:{mount:()=>({update(){},destroy(){}})},
    __NovaFlowArtGenerate:{state,references:()=>refs,activate(){},referenceLimit:()=>10},electronAPI:{}};
  context.window=context;vm.createContext(context);
  for(const n of ['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js','ui-design.drawing.js'])vm.runInContext(source(n),context,{filename:n});
  const adapter=context.NovaFlowUiDesignDrawing,mounted=adapter.mount({leftHost:left,store,getSessionToken:()=> 'CPU_ONLY_TEST'});
  const group=adapter.renderAnalysisSelector(doc);left.appendChild(group);
  const click=e=>group.querySelector(`[data-novaflow-ui-analysis-engine="${e}"]`).listeners.click({preventDefault(){},stopPropagation(){}});
  const input=()=>adapter.inputFor({state,references:refs,referenceLimit:10});
  return {context,doc,state,refs,store,project,storage,patches,calls,adapter,mounted,group,click,input};
}
const plan=()=>({version:1,layoutMode:'preserve',layoutReference:1,visualMode:'style-transfer',references:[{index:1,role:'layout'}],layoutChanges:[],preserve:[]});
function installAnalysis(e, result) {
  for(const [method,provider] of [['promptAssistantReverseImagePrompt','local'],['smartAiImageReverse','grok']]) e.context.electronAPI[method]=async payload=>{e.calls.push({provider,payload});return typeof result==='function'?result(payload):result;};
}

test('visible source buttons default local, preserve an explicit project choice and never alter the generation provider',()=>{
  for(const saved of [undefined,'local','grok']) {
    const e=environment(saved?{assistantEngine:saved}:{});
    assert.equal(e.input().engine,saved||'local');assert.equal(e.group.children.length,2);
    assert.deepEqual(Array.from(e.group.children,b=>b.textContent),['本地分析','Grok 分析']);
    e.click('grok');assert.equal(e.input().engine,'grok');assert.equal(e.state.provider,'local');
    e.state.provider='gpt';assert.equal(e.input().engine,'grok');e.click('local');assert.equal(e.input().engine,'local');assert.equal(e.state.provider,'gpt');
    assert.equal(e.group.children.filter(b=>b.getAttribute('aria-checked')==='true').length,1);
    assert.equal(JSON.parse(e.storage.get('novaflow-ui-design-project-v1')).settings.assistantEngine,'local');
    assert.equal(e.calls.length,0);e.mounted.destroy();
  }
});

test('the actual design-demand header renders the source selector beside its title, only on UI positive input',()=>{
  const e=environment();e.context.ART_GENERATE_STATE={promptHistoryOpenKey:''};e.context.NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR='data-prompt-action';
  e.context.createArtEl=(tag,attrs,children=[])=>{const n=e.doc.createElement(tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(typeof children==='string')n.textContent=children;else n.append(...children);return n;};
  e.context.renderArtGeneratePromptAssistantActions=()=>new Node(e.doc);
  const s=source('novaflow-brand-runtime.js'),a=s.indexOf('  function renderArtGeneratePromptHistory(key)'),z=s.indexOf('  function renderArtGeneratePromptHistoryPopoverRow',a);vm.runInContext(s.slice(a,z),e.context);
  const header=e.context.renderArtGeneratePromptHistory('prompt');assert.equal(header.children[0].children[0].textContent,'设计需求');assert.equal(header.children[0].children[1].getAttribute('role'),'radiogroup');
  const negative=e.context.renderArtGeneratePromptHistory('negativePrompt');assert.equal(negative.children[0].children.length,1);e.mounted.destroy();
});

for(const prompt of ['@参考图1参考布局。换成迪士尼风格，白雪公主主题的老虎机','参考布局，改成水彩画风；森林精灵主题的游戏界面','参考布局。换成卡通风格\n海盗主题的老虎机','参考布局，白雪公主主题的老虎机，迪士尼画风','参考布局，目标主题：白雪公主','参考布局，完整重做为霓虹都市主题，保留玩法金额']) {
  test('explicit target theme enters the accepted catalog route: '+prompt,async()=>{
    const e=environment();e.state.prompt=prompt;
    installAnalysis(e,()=>({ok:true,prompt:'按新主题重设计人物背景与符号',uiCatalog:{schema:'nf.ui.structure-catalog.v1'},uiPlan:{...plan(),visualMode:'theme-redesign'}}));
    const i=e.input();assert.equal(i.generationIntent,'redesign');const r=await e.context.NovaFlowUiDesignAssistantWorkflow.run(i);
    assert.equal(e.calls.length,1);assert.equal(e.calls[0].payload.uiPlanner,'structure-catalog-v1');assert.equal(e.calls[0].payload.uiDesignIntent,'redesign');assert.equal(e.calls[0].payload.images[0].role,'layout');
    assert.ok(r.uiCatalog);e.mounted.destroy();
  });
}

test('style-only edits retain identities while an explicit new theme releases the old identity',()=>{
  const e=environment(),p=e.context.NovaFlowUiDesignPromptPipeline;
  for(const prompt of ['参考布局，不换主题，只换成迪士尼画风','海洋主题的老虎机，只把风格换成水彩','保留原有海洋主题，只换风格为水彩']) {
    e.state.prompt=prompt;const i=e.input();assert.equal(p.requestsThemeRedesign(i),false);
    const c=p.compileQwenPlan({prompt,uiPlan:plan()},i);assert.equal(c.plan.visualMode,'style-transfer');assert.match(c.prompt,/保留画布内的原人物与物品身份/);
  }
  e.state.prompt='换成迪士尼风格，白雪公主主题的老虎机';const i=e.input(),c=p.compileQwenPlan({prompt:e.state.prompt,uiPlan:plan()},i);
  assert.equal(c.plan.visualMode,'theme-redesign');assert.match(c.prompt,/人物、背景、玩法物品和标题按用户的新主题要求重做/);assert.doesNotMatch(c.prompt,/保留画布内的原人物与物品身份|保留原内容/);e.mounted.destroy();
});

test('selected Grok is passed to the real analysis workflow independently of local generation',async()=>{
  const e=environment({assistantEngine:'grok'});e.state.prompt='参考布局，换成水彩风格';installAnalysis(e,{ok:true,prompt:'水彩画风',uiPlan:plan()});
  const r=await e.context.NovaFlowUiDesignAssistantWorkflow.run(e.input());assert.equal(r.engine,'grok');assert.equal(e.calls.length,1);assert.equal(e.calls[0].provider,'grok');assert.equal(e.state.provider,'local');e.mounted.destroy();
});

test('invalid analysis contracts stop with the selected provider and never invent a conservative prompt',async()=>{
  for(const engine of ['local','grok'])for(const response of [{ok:false,error:'Qwen 2.1 UI 设计规划JSON无效，本次未提交生成'},{ok:true,prompt:'some text'},{ok:true,prompt:'some text',uiPlan:{...plan(),references:[]}}]) {
    const e=environment({assistantEngine:engine});e.state.prompt='参考布局，换成水彩风格';installAnalysis(e,response);
    await assert.rejects(()=>e.adapter.prepare({state:e.state,references:e.refs,referenceLimit:10}),/JSON无效|规划不完整/);
    assert.equal(e.calls.length,1);assert.equal(e.calls[0].provider,engine);assert.equal(e.project.settings.assistantEngine,engine);e.mounted.destroy();
  }
});

test('analysis failure exits loading; duplicate clicks and cancellation cannot submit a sampling task',async()=>{
  const e=environment();e.state.prompt='参考布局，换成水彩风格';let release;
  installAnalysis(e,()=>new Promise(r=>{release=r;}));
  Object.assign(e.context,{ART_GENERATE_STATE:e.state,artGenerateReferences:()=>e.refs,artGenerateReferenceLimit:()=>10,captureArtGeneratePromptSnapshot(){},setArtGenerateProgress(){},setArtGenerateStatus:(text,error)=>{e.state.status=text;e.state.error=error?text:'';},resetArtGenerateProgress:(text,pct)=>{e.state.progressLabel=text;e.state.progressPct=pct;},artRequestJson:()=>{throw new Error('sampling must not be submitted');}});
  const s=source('novaflow-brand-runtime.js'),a=s.indexOf('  async function runArtGenerate(options'),z=s.indexOf('  function createArtGenerateExecutionBridge()',a);vm.runInContext(s.slice(a,z),e.context);
  const first=e.context.runArtGenerate();await tick();await e.context.runArtGenerate();assert.equal(e.calls.length,1);
  e.click('grok');assert.equal(e.input().engine,'local');release({ok:false,error:'Qwen 2.1 UI 设计规划JSON无效，本次未提交生成'});await first;
  assert.equal(e.state.running,false);assert.equal(e.state.progressLabel,'分析失败，未提交生成');assert.match(e.state.error,/JSON无效/);
  const second=e.context.runArtGenerate();await tick();assert.equal(e.adapter.cancelPreparation(),true);await second;
  release({ok:true,prompt:'late response',uiPlan:plan()});await tick();assert.equal(e.state.running,false);assert.equal(e.state.progressLabel,'任务已中止');assert.equal(e.calls.length,2);e.mounted.destroy();
});

test('LoRA errors identify the list, expire and clear after a successful read without altering runtime health',async()=>{
  const e=environment();let now=100000,reads=0;
  e.context.Date=class extends Date{static now(){return now;}};vm.runInContext(source('art-generate-lora.js'),e.context);
  const host=new Node(e.doc),options={host,state:{provider:'local',mode:'img2img',loras:[],running:false},loadCatalog:async()=>{reads++;if(reads===1)throw new Error('暂时无生图节点');return{ok:true,items:[{name:'qwen/example.safetensors'}]};}};
  e.context.NovaFlowArtGenerateLora.mount(options);await tick();assert.ok(host.children[0].children.some(n=>String(n.textContent).startsWith('LoRA 列表读取失败：')));
  assert.doesNotMatch(e.storage.get('nf_art_lora_catalog_v1'),/error|暂时无/);
  now+=16000;e.context.NovaFlowArtGenerateLora.mount(options);await tick();assert.equal(reads,2);assert.ok(!host.children[0].children.some(n=>String(n.textContent).includes('失败')));e.mounted.destroy();
});

test('pool connection and image-node availability report different facts without a false image green light',async()=>{
  const e=environment();e.context.api={};e.context.root=e.context;e.context.runtime={control:async()=>({available_workers:1,taskTypes:[{task_type:'prompt_assistant',available_workers:1},{task_type:'qwen_t2i',available_workers:0}]})};
  let s=source('novaflow-web-capabilities.js');vm.runInContext(s.slice(s.indexOf('  let lastCaps ='),s.indexOf('  // A browser cannot start')),e.context);
  const status=await e.context.api.runtimeGetStatus();assert.equal(status.connected,true);assert.match(status.detail,/生图节点 0/);
  s=source('novaflow-brand-runtime.js');vm.runInContext(s.slice(s.indexOf('  function isTopbarAiRuntimeConnected'),s.indexOf('  function noteTopbarAiRuntimeStatus')),e.context);assert.equal(e.context.topbarAiRuntimeStatusPresentation(status).label,'算力池在线');
  e.context.poolHas=async()=>0;s=source('novaflow-web-runtime.js');const a=s.indexOf('    async runtimeGetSystemStats(payload)'),z=s.indexOf('    async runtimeRequestJson',a);vm.runInContext('var stats = ({'+s.slice(a,z)+'});',e.context);
  const image=await e.context.stats.runtimeGetSystemStats({});assert.equal(image.ok,false);assert.match(image.error,/无可用生图节点/);e.mounted.destroy();
});

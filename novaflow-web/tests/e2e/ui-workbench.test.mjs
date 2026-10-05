import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const renderer = name => require('../../renderer/' + name);
renderer('ui-design-prompt.pipeline.js');
renderer('ui-design-assistant.workflow.js');
renderer('ui-design.structure.tool.js');
const pipeline = globalThis.NovaFlowUiDesignPromptPipeline;
const assistant = globalThis.NovaFlowUiDesignAssistantWorkflow;
const structure = globalThis.NovaFlowUiDesignStructureTool;
renderer('ui-design.workbench.js');
const input = () => ({provider:'local',engine:'local',prompt:'保持布局，更换木质风格',negativePrompt:'不要模糊',size:{width:1024,height:1024},structure:{regions:[]},references:[{id:'layout',role:'layout',dataUrl:'data:image/png;base64,AA=='}]});

test('optimization reuse invalidates with prompt, image contents, layout or model changes', async () => {
  let calls = 0;
  const service = {run:async () => { calls++; return {prompt:'优化后的指令'}; }};
  const original = input();
  await pipeline.run({id:'cache',input:original,assistant:service});
  assert.equal((await pipeline.run({id:'cache',input:original,assistant:service})).reused,true);
  for (const patch of [{prompt:'另一种风格'},{references:[{id:'same',dataUrl:'a'}]},{references:[{id:'same',dataUrl:'b'}]},{structure:{regions:[{x:10}]}},{provider:'gpt'}]) {
    assert.equal((await pipeline.run({id:'cache',input:{...original,...patch},assistant:service})).reused,false);
  }
  assert.equal(calls,6);
});
test('cancel and failure stop the pipeline; late optimization never enters cache', async () => {
  const controller = new AbortController();
  let resolve;
  const pending = pipeline.run({id:'cancel',input:input(),signal:controller.signal,assistant:{run:()=>new Promise(r=>{resolve=r;})}});
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  resolve({prompt:'迟到结果'});
  await assert.rejects(pipeline.run({id:'cancel',input:input(),assistant:{run:async()=>{throw Error('service unavailable');}}}),/service unavailable/);
});
test('manual optimization is reusable for both original and applied text', async () => {
  const initial = input(), applied = {...initial,prompt:'用户已应用优化内容'};
  pipeline.remember('manual',initial,{prompt:applied.prompt},applied);
  assert.equal((await pipeline.run({id:'manual',input:applied,assistant:{run:()=>assert.fail('double optimization')}})).reused,true);
});
test('UI assistant ignores retired style controls, protects natural image numbers and retains layout geometry', async () => {
  let request;
  const result = await assistant.run({
    ...input(), prompt:'图1用于布局，图2只参考风格', targetStyle:'dark', qualityTendency:'commercial',
    references:[1,2].map(id=>({id:String(id),dataUrl:'data:image/png;base64,AA=='})),
    structure:{width:1024,height:1024,regions:[{name:'角色',x:12,y:34,width:400,height:500,purpose:'显示角色'}]},
    electronAPI:{promptAssistantReverseImagePrompt:async r=>{request=r;return {ok:true,prompt:r.prompt};}},
  });
  assert.equal(result.prompt,'@参考图1用于布局，@参考图2只参考风格');
  assert.match(request.requirements,/"x":12/);
  assert.doesNotMatch(request.requirements,/暗黑史诗|稳妥商业化/);
  assert.equal(assistant.referenceSnapshot(Array(16).fill({dataUrl:'data:image/png;base64,AA=='}), 'local').length, 16);
  assert.throws(()=>assistant.buildRequirements({requirements:'长'.repeat(3000)},{regions:[]},[]),/未截断/);
});

test('cloud UI references use UI instructions while drawing retains its existing output contract', () => {
  const source=readFileSync(new URL('../../admin/admin-server/server.js',import.meta.url),'utf8');
  const helpers=source.slice(source.indexOf('function isUiDesignPromptPayload('),source.indexOf('function buildGrokPromptOptimizeRequest('));
  const fn=helpers+source.slice(source.indexOf('function buildGrokImageReverseRequest('),source.indexOf('function isGrokResponseAttemptResultUsable('));
  const context={
    miniMaxH3ReverseMode:()=>false,miniMaxH3ChildSensitiveRequest:()=>false,smartAiSupportsNegativePrompt:()=>true,isSmartAiAnimationPayload:()=>false,
    smartAiCurrentPrompt:p=>p.prompt,normalizeSmartAiText:v=>String(v || ''),
    selectGrokSmartAiImageScenario:p=>({scenario:'role_reference',images:p.images,sourceCount:p.images.length,targetIndex:0}),
    smartAiInputText:text=>({text}),smartAiImageInput:image=>({image}),artReferenceImageLabel:(_,i)=>'图'+(i+1),
    smartAiChinesePromptOutputRules:()=>'',adminData:{readAdminGrokEnv:()=>({model:'test'})},
    ART_REFERENCE_CONTENT_SAFETY_RULE:'drawing-safety',ART_FIVE_SECTION_OUTPUT_RULE:'drawing-five-sections',ART_PROMPT_CRAFT_RULE:'drawing-craft',
    artReferenceResultFormat:()=>({format:'drawing'}),artReferenceUserContentState:()=>({}),artReferenceUserLabels:()=>({}),
  };
  vm.createContext(context);vm.runInContext(fn,context);
  const payload={prompt:'图1提供风格，保留按钮文字',images:[{role:'style'}]};
  const ui=context.buildGrokImageReverseRequest({...payload,surface:'ui-design'});
  const drawing=context.buildGrokImageReverseRequest({...payload,surface:'art-generate'});
  const text=JSON.stringify(ui.body);
  assert.match(text,/目标界面中的按钮、菜单和文字是有效设计内容/);
  assert.doesNotMatch(text,/drawing-five-sections|drawing-craft/);
  assert.equal(drawing.resultOptions.artFiveSectionPrompt,true);
  assert.equal(drawing.body.text.format,'drawing');
});

class Element {
  constructor(tag, doc) { this.tagName=tag;this.ownerDocument=doc;this.style={};this.children=[];this.attributes={};this.listeners={};this.textContent=''; }
  setAttribute(k,v){this.attributes[k]=String(v)}
  appendChild(n){if(n.parentElement)n.remove();n.parentElement=this;this.children.push(n);return n}
  append(...items){items.forEach(n=>this.appendChild(n))}
  replaceChildren(...items){this.children.forEach(n=>n.parentElement=null);this.children=[];this.append(...items)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null}
  addEventListener(k,fn){this.listeners[k]=fn}
  getBoundingClientRect(){return {width:900,height:500,left:0,top:0}}
  querySelectorAll(){return []}
}

test('module description preserves both legacy fields and clears retired requirements on edit', () => {
  renderer('ui-design.inspector.tool.js');
  const inspector = globalThis.NovaFlowUiDesignInspectorTool;
  const doc = { createElement: tag => new Element(tag, doc) };
  const host = doc.createElement('main');
  const block = { id: 'module', purpose: '辅助导航和版权信息', requirements: '版权居中，使用小号灰字' };
  const handle = inspector.mount({ host, compact: true,
    getSelection: () => ({ kind: 'block', block, blockId: block.id }),
    onPatchSelection: (_, patch) => Object.assign(block, patch),
  });
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const fields = () => descendants(host).filter(node => node.tagName === 'textarea');
  assert.equal(fields().length, 1);
  assert.equal(descendants(host).filter(node => node.attributes.type === 'checkbox').length, 0);
  assert.equal(fields()[0].attributes['aria-label'], '模块说明');
  assert.equal(fields()[0].value, '辅助导航和版权信息\n版权居中，使用小号灰字');
  fields()[0].value = '只保留导航';
  fields()[0].listeners.change();
  assert.equal(block.purpose, '只保留导航');
  assert.equal(block.requirements, '');
  handle.update();
  assert.equal(fields()[0].value, '只保留导航');
  fields()[0].value = ''; fields()[0].listeners.blur(); handle.update();
  assert.equal(fields()[0].value, '', 'clearing the description must not restore legacy text');
  handle.destroy();
});
function workbench(project) {
  const doc={createElement:tag=>new Element(tag,doc)};
  const host=doc.createElement('main');
  let current=structure.normalize(project);
  globalThis.NovaFlowUiDesignGenerateTool={mount:()=>({setStatus(){},destroy(){}})};
  globalThis.NovaFlowUiDesignLayoutGuide={createCleanLayoutGuide:()=>({dataUrl:'data:image/png;base64,AA=='})};
  const handle=globalThis.NovaFlowUiDesignWorkbench.mount({host,getProject:()=>current,getResources:()=>[{id:'r',dataUrl:'data:image/png;base64,AA=='}],getResults:()=>[],getGenerationState:()=>({provider:'local'}),onProjectChange:value=>current=value,onSelectionChange(){}});
  return {handle,project:()=>current};
}
test('optional layout draft, module edits, one reference, removal and undo preserve saved data',()=>{
  const {handle,project}=workbench({width:1024,height:1024,blocks:[],graph:{nodes:[],edges:[]}});
  assert.equal(project().graph.nodes.filter(n=>n.type==='generator').length,1);
  assert.equal(project().graph.edges.length,0);
  handle.addBlock();
  assert.equal(project().graph.edges.length,0,'draft not forced into generation');
  const selected=handle.getSelection();
  handle.patchSelection(selected,{name:'角色区',x:200});
  assert.equal(handle.getSelection().block.x,200);
  handle.patchGeneratorOutput(handle.getActiveGeneratorId(),{width:2048,height:1024});
  assert.equal(handle.getSelection().block.x,400,'changing output maps geometry proportionally');
  handle.useLayout();handle.useLayout();
  assert.equal(project().graph.edges.filter(e=>e.kind==='layout').length,1);
  assert.equal(handle.addReferenceResource({id:'r'}).ok,true);
  assert.equal(project().graph.edges.filter(e=>e.kind==='reference').length,1);
  handle.removeSelection();
  assert.equal(handle.getSelection(),null);
  handle.undo();
  assert.equal(project().graph.nodes.find(n=>n.type==='layout').data.blocks[0].name,'角色区');
  const saved=project();handle.destroy();
  const restored=workbench(saved);
  assert.equal(restored.project().graph.edges.length,2);
  assert.equal(restored.project().graph.nodes.find(n=>n.type==='layout').data.blocks[0].name,'角色区');
  restored.handle.destroy();
});

test('legacy excluded and locked modules remain included, editable and removable after reopen', () => {
  const initial = workbench({width:1024,height:1024,blocks:[],graph:{nodes:[],edges:[]}});
  initial.handle.addBlock();
  const saved = initial.project();
  const layout = saved.graph.nodes.find(n => n.type === 'layout');
  layout.data.blocks[0].participates = false;
  layout.data.blocks[0].locked = true;
  initial.handle.destroy();
  const {handle,project} = workbench(saved);
  handle.showLayout(); handle.useLayout();
  assert.equal(project().graph.edges.filter(e => e.kind === 'layout').length, 1);
  const block = handle.getLayout().data.blocks[0];
  assert.equal(block.participates, true);
  assert.equal(block.locked, false);
  const selection = {nodeId:layout.id,blockId:block.id};
  handle.patchSelection(selection,{x:150,width:420});
  assert.equal(handle.getSelection().block.x,150);
  assert.equal(handle.getSelection().block.width,420);
  assert.equal(handle.removeSelection(),true);
  assert.equal(handle.getLayout().data.blocks.length,0);
  handle.destroy();
});

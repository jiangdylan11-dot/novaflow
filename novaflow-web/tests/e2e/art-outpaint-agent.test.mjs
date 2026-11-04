import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';
const source=await readFile(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');

test('opening local selection may create a working layer but is never a completed generation',async()=>{
 const state={source:{dataUrl:'original'},parts:[]};let calls=0;
 const root={state,window:{},getSourceResources:()=>[],async runSplitControlAction(){calls++;if(calls===1){state.selectionTool={active:true,mode:'inpaint'};state.parts=[{id:'working',dataUrl:'original'}];}else{state.selectionTool.active=false;state.parts.push({id:'actual-patch',dataUrl:'generated'});}}};
 vm.createContext(root);const start=source.indexOf('    async agentAction('),end=source.indexOf('    supportsSilentSourceResourceRegistration:',start);vm.runInContext('globalThis.bridge={'+source.slice(start,end)+'};',root);
 const opened=await root.bridge.agentAction('inpaintEdit');assert.equal(opened.layersChanged,true);assert.equal(opened.phase,'opened');
 const completed=await root.bridge.agentAction('inpaintEdit');assert.equal(completed.phase,'completed');assert.equal(completed.layersChanged,true);
 const context={schema:FOART_TOOL_SCHEMA,controls:[],artEditor:{editingTool:'selection',editingAction:'inpaintEdit'}};
 const plan=name=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'继续当前局部编辑',operations:[{action:'art_action',name}]});
 assert.doesNotThrow(()=>validateFoartPlan(plan('inpaintEdit'),context));assert.throws(()=>validateFoartPlan(plan('imageUpscale'),context),/退出当前/);
});

test('explicit outpaint dimensions run the existing native generator and commit its actual resource while preserving the original',async()=>{
 const state={source:{fileName:'original.png',dataUrl:'data:image/png;base64,source'},parts:[]},resources=[{id:'original',name:'original.png'}],requests=[],commits=[];
 const root={state,window:{},sourceSize:async()=>({width:512,height:512}),getSourceResources:()=>resources,outpaintImageDataUrl:async request=>{requests.push(request);return {fileName:'actual_outpaint.png',dataUrl:'data:image/png;base64,actual',delta:{left:64,right:64,top:0,bottom:0},width:640,height:512}},commitImageOutpaintResult:async(name,url,delta,size)=>{commits.push({name,url,delta,size});state.source={fileName:name,dataUrl:url};resources.push({id:'actual',name});},runSplitControlAction(){throw Error('Explicit dimensions must not reopen a dialog')}};
 vm.createContext(root);const start=source.indexOf('    async agentAction('),end=source.indexOf('    supportsSilentSourceResourceRegistration:',start);vm.runInContext('globalThis.bridge={'+source.slice(start,end)+'};',root);
 const result=await root.bridge.agentAction('imageOutpaint',{canvasResize:{width:640,height:512,anchor:'center'},outpaintPrompt:'把两侧灰区补成纯白色背景'});
 assert.equal(requests.length,1);assert.equal(requests[0].confirm,false);assert.equal(requests[0].prompt,'把两侧灰区补成纯白色背景');assert.equal(requests[0].dataUrl,'data:image/png;base64,source');assert.deepEqual(JSON.parse(JSON.stringify(requests[0].targetSize)),{width:640,height:512});assert.equal(commits[0].url,'data:image/png;base64,actual');assert.equal(result.sourceChanged,true);assert.equal(result.phase,'completed');assert.equal(result.resources[0].id,'actual');assert.equal(resources[0].id,'original');
 const context={schema:FOART_TOOL_SCHEMA,controls:[]},plan=op=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'原生无限扩图',operations:[op]});
 validateFoartPlan(plan({action:'art_action',name:'imageOutpaint',width:640,height:512,anchor:'center',prompt:'把两侧灰区补成纯白色背景'}),context);
 assert.throws(()=>validateFoartPlan(plan({action:'art_action',name:'cutout',width:640,height:512}),context));
 assert.throws(()=>validateFoartPlan(plan({action:'art_action',name:'canvasResize',width:640,height:512,prompt:'白色背景'}),context));
 assert.throws(()=>validateFoartPlan(plan({action:'art_action',name:'imageOutpaint',prompt:'白色背景'}),context));
 assert.throws(()=>validateFoartPlan(plan({action:'art_action',name:'imageOutpaint'}),context));
 assert.throws(()=>validateFoartPlan(plan({action:'art_action',name:'imageOutpaint',width:640,height:512}),context));
 root.outpaintImageDataUrl=async()=>{state.source.dataUrl='manual-replacement';return {fileName:'stale.png',dataUrl:'stale',width:640,height:512}};
 await assert.rejects(root.bridge.agentAction('imageOutpaint',{canvasResize:{width:640,height:512}}),/原图已变化/);assert.equal(commits.length,1);
});

test('the original outpaint compiler uses a concrete assistant intent while retaining its native constraints and manual default',()=>{
 const root={};vm.createContext(root);const start=source.indexOf('  function imageOutpaintPromptText('),end=source.indexOf('  const IMAGE_OUTPAINT_SEAM_REDRAW_PX',start);vm.runInContext(source.slice(start,end),root);
 assert.match(root.imageOutpaintPromptText(),/flat grey border/);
 const optimized=root.imageOutpaintPromptText({prompt:'把左右灰区补成纯白色背景'});assert.match(optimized,/纯白色背景/);assert.match(optimized,/原有画面.*保持不变/);assert.doesNotMatch(optimized,/flat grey border/);
});

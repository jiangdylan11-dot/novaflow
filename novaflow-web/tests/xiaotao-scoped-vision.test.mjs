import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const source=await readFile(new URL('../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
function fixture(modelId='openai/gpt-6.1-sol-saver'){
  let selection=true,session=true,prepared=null,revision=0,runCount=0;const calls=[];
  const references=[{role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgo='},{role:'style',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];
  const rt={state:{active:true,provider:'local',mode:'img2img',prompt:'original',negativePrompt:'old-negative',width:512,height:512,count:1,running:false},references:()=>references,selectedResult:()=>null,captureContext:()=>({generationSurface:root.testSurface||'drawing',routeRevision:root.testRouteRevision||1}),
    captureAgentPreparedSnapshot(){return {revision,prepared};},replaceAgentPrepared(handle,value){if(handle.revision!==revision||handle.prepared!==prepared)throw Error('stale');const undo={revision:++revision,prepared:value,previous:prepared};prepared=value;return undo;},
    restoreAgentPrepared(undo){if(undo.revision!==revision||undo.prepared!==prepared)throw Error('stale');prepared=undo.previous;revision++;},isAgentPreparedReplacementCurrent:undo=>undo.revision===revision&&undo.prepared===prepared,render(){},run(){runCount++;}};
  const root={crypto:webcrypto,setTimeout,clearTimeout,__NovaFlowArtGenerate:rt,NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'api',modelId,epoch:1})}}},
    electronAPI:{onlineBusinessAvailableSync:()=>true,onlineVisionArtAvailableSync:()=>true,captureFoartSessionGuard:()=>()=>session},
    __NovaFlowSmartAI:{optimizeForAgent:async options=>{calls.push(options);return {displayPrompt:'review draft',prompt:'english draft',negativePrompt:'new-negative',optimization:{reviewRequired:true,modelPromptLanguage:'en'}};}}};
  vm.createContext(root);vm.runInContext(source,root);
  const options={referenceRoles:root.NovaFlowFoartTools.captureDrawingReferenceRoles(),provider:'api',modelId,onlineBusiness:{confirmPricingQuote:async()=>true},selectionStillCurrent:()=>selection,onStatus(){}};
  return {root,rt,references,calls,tools:root.NovaFlowFoartTools,options,changeSelection:()=>{selection=false;},changeSession:()=>{session=false;},get runCount(){return runCount;},get prepared(){return prepared;}};
}
async function review(f){return f.tools.execute({action:'image_optimize',prompt:'user text',generationMode:'img2img'},f.options);}
test('selected online image stays a draft until confirmation and can undo without generating',async()=>{
  const f=fixture(),result=await review(f);assert.equal(result.phase,'review');assert.equal(f.rt.state.prompt,'original');assert.equal(f.runCount,0);
  assert.equal(f.calls[0].assistantSelectionScope,'xiaotao');assert.deepEqual(Array.from(f.calls[0].images,x=>x.role),['subject','style']);
  assert.equal(f.tools.confirmImageReview(result.reviewId).phase,'applied');assert.equal(f.rt.state.prompt,'review draft');assert.ok(f.prepared);
  assert.equal(f.tools.undoImageReview(result.reviewId).phase,'undone');assert.equal(f.rt.state.prompt,'original');assert.equal(f.prepared,null);assert.equal(f.runCount,0);
});
test('cancel, changed reference, selection or account session rejects stale draft before any write',async()=>{
  for(const change of ['cancel','reference','selection','session']){
    const f=fixture(),result=await review(f);
    if(change==='cancel')assert.equal(f.tools.cancelImageReview(result.reviewId),true);
    if(change==='reference')f.references[0].role='style';if(change==='selection')f.changeSelection();if(change==='session')f.changeSession();
    assert.throws(()=>f.tools.confirmImageReview(result.reviewId));assert.equal(f.rt.state.prompt,'original');assert.equal(f.prepared,null);assert.equal(f.runCount,0);
  }
});

test('scoped page image optimization preserves role/source, selected model, and requires user review',async()=>{
  for(const model of ['deepseek/deepseek-v4.1-flash','xai/grok-4.7','openai/gpt-6.1-sol-saver']){
    const f=fixture(model),options={...f.options,currentDrawingVisionOnly:true,referenceSource:'page',projectStillCurrent:()=>true};
    const result=await f.tools.execute({action:'image_optimize',prompt:'user text',generationMode:'img2img'},options);
    assert.equal(result.phase,'review');assert.equal(f.calls.length,1);assert.equal(f.calls[0].currentDrawingVisionOnly,true);
    assert.deepEqual(Array.from(f.calls[0].images,x=>x.role),['subject','style']);assert.equal(f.rt.state.prompt,'original');assert.equal(f.runCount,0);
    assert.equal(f.tools.confirmImageReview(result.reviewId).phase,'applied');assert.equal(f.rt.state.prompt,'review draft');
    assert.equal(f.tools.undoImageReview(result.reviewId).phase,'undone');assert.equal(f.rt.state.prompt,'original');assert.equal(f.runCount,0);
  }
});
test('scoped image path rejects ambiguous roles, wrong source and generation without model calls',async()=>{
  for(const kind of ['roles','source','generate','disabled']){
    const f=fixture(), options={...f.options,currentDrawingVisionOnly:true,projectStillCurrent:()=>true,referenceSource:kind==='source'?'uploads':'page'};
    if(kind==='roles')f.references[0].role='reference';
    if(kind==='disabled')f.root.electronAPI.onlineVisionArtAvailableSync=()=>false;
    await assert.rejects(f.tools.execute({action:kind==='generate'?'image_generate':'image_optimize',prompt:'user text',generationMode:'img2img'},options));
    assert.equal(f.calls.length,0);assert.equal(f.runCount,0);assert.equal(f.rt.state.prompt,'original');
  }
});
test('scoped page images refuse application after the visible surface changes',async()=>{
 const f=fixture(),result=await f.tools.execute({action:'image_optimize',prompt:'user text',generationMode:'img2img'},{...f.options,currentDrawingVisionOnly:true,referenceSource:'page',projectStillCurrent:()=>true});
 f.root.testSurface='other';assert.throws(()=>f.tools.confirmImageReview(result.reviewId));assert.equal(f.rt.state.prompt,'original');assert.equal(f.runCount,0);
});

test('scoped page images refuse after leaving and returning to same surface',async()=>{
 const f=fixture(),result=await f.tools.execute({action:'image_optimize',prompt:'user text',generationMode:'img2img'},{...f.options,currentDrawingVisionOnly:true,referenceSource:'page',projectStillCurrent:()=>true});
 f.root.testRouteRevision=3;assert.throws(()=>f.tools.confirmImageReview(result.reviewId));assert.equal(f.rt.state.prompt,'original');
});
test('scoped page images refuse reference metadata mutation before apply',async()=>{
 const f=fixture(),result=await f.tools.execute({action:'image_optimize',prompt:'user text',generationMode:'img2img'},{...f.options,currentDrawingVisionOnly:true,referenceSource:'page',projectStillCurrent:()=>true});
 f.references[0].width=17;assert.throws(()=>f.tools.confirmImageReview(result.reviewId));assert.equal(f.rt.state.prompt,'original');
});

test('scoped reference path requires a live project guard',async()=>{const f=fixture();await assert.rejects(f.tools.execute({action:'image_optimize',prompt:'x',generationMode:'img2img'},{...f.options,currentDrawingVisionOnly:true,referenceSource:'page'}));assert.equal(f.calls.length,0);
 let current=true;const result=await f.tools.execute({action:'image_optimize',prompt:'x',generationMode:'img2img'},{...f.options,currentDrawingVisionOnly:true,referenceSource:'page',projectStillCurrent:()=>current});current=false;assert.throws(()=>f.tools.confirmImageReview(result.reviewId));assert.equal(f.rt.state.prompt,'original');});

test('unlabelled references need explicit identity-bound roles without changing page data',async()=>{
 const f=fixture();delete f.references[0].role;delete f.references[1].role;
 const refs=f.tools.captureDrawingReferenceRoles();const roles=Array.from(refs,(x,i)=>({...x,role:i?'style':'subject'}));
 const options={...f.options,currentDrawingVisionOnly:true,referenceSource:'page',projectStillCurrent:()=>true,referenceRoles:roles};
 const result=await f.tools.execute({action:'image_optimize',prompt:'x',generationMode:'img2img'},options);
 assert.equal(result.phase,'review');assert.deepEqual(Array.from(f.calls[0].images,x=>x.role),['subject','style']);assert.equal(f.references[0].role,undefined);assert.equal(f.references[1].role,undefined);
});
test('wrong role identity or mismatched explicit role fails before model request',async()=>{
 for(const change of ['identity','explicit','missing']){const f=fixture(),roles=Array.from(f.options.referenceRoles,x=>({...x}));if(change==='identity')roles[0].identity='stale';if(change==='explicit')roles[0].role='style';if(change==='missing')roles.pop();
 await assert.rejects(f.tools.execute({action:'image_optimize',prompt:'x',generationMode:'img2img'},{...f.options,currentDrawingVisionOnly:true,referenceSource:'page',projectStillCurrent:()=>true,referenceRoles:roles}));assert.equal(f.calls.length,0);}
});

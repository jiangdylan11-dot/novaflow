import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const source=await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
function fixture(modelId='openai/gpt-6.1-sol-saver'){
  let selection=true,session=true,prepared=null,revision=0,runCount=0;const calls=[];
  const references=[{role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgo='},{role:'style',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];
  const rt={state:{provider:'local',mode:'img2img',prompt:'original',negativePrompt:'old-negative',width:512,height:512,count:1,running:false},references:()=>references,selectedResult:()=>null,
    captureAgentPreparedSnapshot(){return {revision,prepared};},replaceAgentPrepared(handle,value){if(handle.revision!==revision||handle.prepared!==prepared)throw Error('stale');const undo={revision:++revision,prepared:value,previous:prepared};prepared=value;return undo;},
    restoreAgentPrepared(undo){if(undo.revision!==revision||undo.prepared!==prepared)throw Error('stale');prepared=undo.previous;revision++;},isAgentPreparedReplacementCurrent:undo=>undo.revision===revision&&undo.prepared===prepared,render(){},run(){runCount++;}};
  const root={crypto:webcrypto,setTimeout,clearTimeout,__NovaFlowArtGenerate:rt,NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'api',modelId,epoch:1})}}},
    electronAPI:{onlineBusinessAvailableSync:()=>true,captureFoartSessionGuard:()=>()=>session},
    __NovaFlowSmartAI:{optimizeForAgent:async options=>{calls.push(options);return {displayPrompt:'review draft',prompt:'english draft',negativePrompt:'new-negative',optimization:{reviewRequired:true,modelPromptLanguage:'en'}};}}};
  vm.createContext(root);vm.runInContext(source,root);
  const options={provider:'api',modelId,onlineBusiness:{confirmPricingQuote:async()=>true},selectionStillCurrent:()=>selection,onStatus(){}};
  return {rt,references,calls,tools:root.NovaFlowFoartTools,options,changeSelection:()=>{selection=false;},changeSession:()=>{session=false;},get runCount(){return runCount;},get prepared(){return prepared;}};
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

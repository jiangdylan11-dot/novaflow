import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const source=await readFile(new URL('../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
function fixture(modelId='openai/gpt-6.1-sol-saver'){
  let selection=true,session=true,prepared=null,revision=0,runCount=0;const calls=[];
  const references=[{role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgo='},{role:'style',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];
  const rt={state:{active:true,provider:'local',mode:'img2img',prompt:'original',negativePrompt:'old-negative',width:512,height:512,count:1,running:false,references,reference:references[0]},references:()=>rt.state.references,referenceLimit:()=>3,isReferenceSizePending:()=>false,setReference(i,v){rt.state.references[i]=v;rt.state.reference=rt.state.references[0]||null;if(i===0)rt.state.referenceSizeFillPending=v?.dataUrl||'';},selectedResult:()=>null,captureContext:()=>({generationSurface:root.testSurface||'drawing',routeRevision:root.testRouteRevision||1}),
    captureAgentPreparedSnapshot(){return {revision,prepared};},isAgentPreparedSnapshotEmptyAndCurrent(handle){return handle.revision===revision&&handle.prepared===null&&prepared===null},replaceAgentPrepared(handle,value){if(handle.revision!==revision||handle.prepared!==prepared)throw Error('stale');const undo={revision:++revision,prepared:value,previous:prepared};prepared=value;return undo;},
    restoreAgentPrepared(undo){if(undo.revision!==revision||undo.prepared!==prepared)throw Error('stale');prepared=undo.previous;revision++;},isAgentPreparedReplacementCurrent:undo=>undo.revision===revision&&undo.prepared===prepared,render(){},run(){runCount++;}};
  const root={crypto:webcrypto,setTimeout,clearTimeout,Image:class{set src(v){this.naturalWidth=1;this.naturalHeight=1;queueMicrotask(()=>this.onload())}},__NovaFlowArtGenerate:rt,NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'api',modelId,epoch:1})}}},
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

function uploadFixture(){const f=fixture();f.rt.state.references=[null,null,null];f.rt.state.reference=null;f.rt.state.referenceSizeFillPending='';let intact=true;const uploads=[{id:'up-1',previewUrl:'data:image/png;base64,iVBORw0KGgo=',name:'one.png',mimeType:'image/png',size:8}];
 const roles=[{index:1,id:'up-1',role:'subject'}];return {...f,uploads,roles,invalidate:()=>{intact=false},uploadOptions:{...f.options,currentDrawingVisionOnly:true,referenceSource:'uploads',projectStillCurrent:()=>true,attachmentStillCurrent:()=>intact,uploadReferences:uploads,referenceRoles:roles}};}
async function reviewUpload(f){return f.tools.execute({action:'image_optimize',prompt:'input',generationMode:'img2img'},f.uploadOptions)}
test('upload review applies prompt and empty-slot image together and undoes',async()=>{const f=uploadFixture(),result=await reviewUpload(f);assert.equal(result.phase,'review');assert.equal(f.rt.state.references[0],null);assert.equal(f.rt.state.prompt,'original');assert.equal(f.tools.confirmImageReview(result.reviewId).phase,'applied');assert.equal(f.rt.state.prompt,'review draft');assert.equal(f.rt.state.references[0].role,'subject');assert.equal(f.rt.state.references[0].width,1);assert.equal(f.rt.state.width,512);f.invalidate();assert.equal(f.tools.undoImageReview(result.reviewId).phase,'undone');assert.equal(f.rt.state.prompt,'original');assert.equal(f.rt.state.references[0],null);assert.equal(f.runCount,0)});
test('upload change after optimization blocks apply; existing page reference blocks requests',async()=>{let f=uploadFixture(),result=await reviewUpload(f);f.invalidate();assert.throws(()=>f.tools.confirmImageReview(result.reviewId));assert.equal(f.rt.state.references[0],null);f=uploadFixture();f.rt.state.references[0]={dataUrl:'blob:kept',role:'subject'};f.rt.state.reference=f.rt.state.references[0];await assert.rejects(reviewUpload(f));assert.equal(f.calls.length,0);assert.equal(f.rt.state.reference.dataUrl,'blob:kept')});
test('mismatched upload identity or MIME is rejected before provider',async()=>{for(const field of ['id','mime']){const f=uploadFixture();if(field==='id')f.roles[0].id='other';else f.uploads[0].mimeType='image/jpeg';await assert.rejects(reviewUpload(f));assert.equal(f.calls.length,0);assert.equal(f.rt.state.references[0],null)}});
test('post-apply page edit blocks undo without overwriting it',async()=>{const f=uploadFixture(),result=await reviewUpload(f);f.tools.confirmImageReview(result.reviewId);f.rt.state.prompt='human';assert.throws(()=>f.tools.undoImageReview(result.reviewId));assert.equal(f.rt.state.prompt,'human');assert.ok(f.rt.state.references[0])});

test('explicit replacement preserves original images, metadata, dimensions and undo',async()=>{const f=uploadFixture(),first={name:'old-1',dataUrl:'data:image/png;base64,iVBORw0KGgo=',role:'subject',width:111,height:222,meta:{detail:'keep'}},second={name:'old-2',dataUrl:'data:image/png;base64,iVBORw0KGgo=',role:'style',width:333,height:444};f.rt.state.references=[first,second,null];f.rt.state.reference=first;f.uploadOptions.replacePageReferencesConfirmed=true;const result=await reviewUpload(f);assert.equal(f.rt.state.references[0],first);assert.equal(f.rt.state.references[1],second);f.tools.confirmImageReview(result.reviewId);assert.equal(f.rt.state.references[0].name,'one.png');assert.equal(f.rt.state.references[1],null);assert.equal(f.rt.state.width,512);f.tools.undoImageReview(result.reviewId);assert.equal(f.rt.state.references[0],first);assert.equal(f.rt.state.references[1],second);assert.equal(f.rt.state.references[0].meta.detail,'keep');assert.equal(f.rt.state.references[0].width,111);assert.equal(f.rt.state.references[1].height,444);assert.equal(f.rt.state.prompt,'original')});
test('replacement refuses blob originals before provider and retains blob identity',async()=>{const f=uploadFixture(),old={dataUrl:'blob:kept',role:'subject'};f.rt.state.references=[old,null,null];f.rt.state.reference=old;f.uploadOptions.replacePageReferencesConfirmed=true;await assert.rejects(reviewUpload(f));assert.equal(f.calls.length,0);assert.equal(f.rt.state.reference,old)});
test('replacement refuses if old reference metadata changes before apply',async()=>{const f=uploadFixture(),old={dataUrl:'data:image/png;base64,iVBORw0KGgo=',role:'subject',meta:{detail:'before'}};f.rt.state.references=[old,null,null];f.rt.state.reference=old;f.uploadOptions.replacePageReferencesConfirmed=true;const result=await reviewUpload(f);old.meta.detail='after';assert.throws(()=>f.tools.confirmImageReview(result.reviewId));assert.equal(f.rt.state.reference,old);assert.equal(old.meta.detail,'after')});
test('no replacement confirmation is a pre-provider refusal',async()=>{const f=uploadFixture(),old={dataUrl:'data:image/png;base64,iVBORw0KGgo=',role:'subject'};f.rt.state.references=[old,null,null];f.rt.state.reference=old;await assert.rejects(reviewUpload(f));assert.equal(f.calls.length,0);assert.equal(f.rt.state.reference,old)});

test('pending previous measurement prevents unsafe replacement before provider',async()=>{const f=uploadFixture(),old={dataUrl:'data:image/png;base64,iVBORw0KGgo=',role:'subject'};f.rt.state.references=[old,null,null];f.rt.state.reference=old;f.rt.isReferenceSizePending=()=>true;f.uploadOptions.replacePageReferencesConfirmed=true;await assert.rejects(reviewUpload(f));assert.equal(f.calls.length,0);assert.equal(f.rt.state.reference,old)});

test('changed saved original metadata blocks undo without replacing user data',async()=>{const f=uploadFixture(),old={dataUrl:'data:image/png;base64,iVBORw0KGgo=',role:'subject',meta:{label:'old'}};f.rt.state.references=[old,null,null];f.rt.state.reference=old;f.uploadOptions.replacePageReferencesConfirmed=true;const result=await reviewUpload(f);f.tools.confirmImageReview(result.reviewId);const current=f.rt.state.references[0];old.meta.label='new';assert.throws(()=>f.tools.undoImageReview(result.reviewId));assert.equal(f.rt.state.reference,current);assert.equal(old.meta.label,'new')});

function uiFixture(){const f=uploadFixture();let active=true;f.root.NovaFlowUiDesignDrawing={isActive:()=>active};f.rt.captureContext=()=>({generationSurface:active?'ui':'drawing',routeRevision:1});f.deactivate=()=>{active=false};f.uiUploads=[{id:'ui-ref-1',name:'layout.png',role:'combined',dataUrl:'data:image/png;base64,iVBORw0KGgo='}];f.uiOptions={runtime:f.rt,uploads:f.uiUploads,isProjectCurrent:()=>active,decodeImage:async()=>({width:1,height:1}),uiReferenceOnly:true};return f;}
test('UI-only applies and undoes without installing or restoring drawing prepared',async()=>{const f=uiFixture(),tx=await f.tools.prepareUploadReferenceTransaction(f.uiOptions);assert.equal(Object.isFrozen(tx.requestReferences),true);assert.equal(Object.isFrozen(tx.requestReferences[0]),true);assert.equal(tx.requestReferences[0].role,'combined');let replace=0,restore=0;const oldReplace=f.rt.replaceAgentPrepared,oldRestore=f.rt.restoreAgentPrepared;f.rt.replaceAgentPrepared=(...a)=>{replace++;return oldReplace.apply(f.rt,a)};f.rt.restoreAgentPrepared=(...a)=>{restore++;return oldRestore.apply(f.rt,a)};tx.apply({prompt:'UI optimized',negativePrompt:'No text'});assert.equal(f.rt.state.prompt,'UI optimized');assert.equal(f.rt.state.negativePrompt,'No text');assert.equal(f.rt.state.reference.dataUrl,tx.requestReferences[0].dataUrl);assert.equal(f.rt.state.reference.id,tx.requestReferences[0].id);assert.equal(f.prepared,null);tx.undo();assert.equal(f.rt.state.prompt,'original');assert.equal(f.rt.state.negativePrompt,'old-negative');assert.equal(f.rt.state.reference,null);assert.equal(replace,0);assert.equal(restore,0)});
test('UI-only refuses nonempty or changed drawing prepared without mutating it',async()=>{const f=uiFixture();f.rt.replaceAgentPrepared(f.rt.captureAgentPreparedSnapshot(),{existing:true});await assert.rejects(f.tools.prepareUploadReferenceTransaction(f.uiOptions));assert.equal(f.rt.captureAgentPreparedSnapshot().prepared.existing,true);assert.equal(f.rt.state.reference,null);const g=uiFixture(),tx=await g.tools.prepareUploadReferenceTransaction(g.uiOptions);tx.apply({prompt:'UI',negativePrompt:''});g.rt.replaceAgentPrepared(g.rt.captureAgentPreparedSnapshot(),{external:true});assert.throws(()=>tx.undo());assert.equal(g.rt.captureAgentPreparedSnapshot().prepared.external,true);assert.equal(g.rt.state.prompt,'UI')});
test('UI-only rejects drawing surface, wrong UI role, duplicate identity and changed project',async()=>{const f=uiFixture();f.deactivate();await assert.rejects(f.tools.prepareUploadReferenceTransaction(f.uiOptions));const g=uiFixture();g.uiUploads[0].role='pose';await assert.rejects(g.tools.prepareUploadReferenceTransaction(g.uiOptions));const h=uiFixture();h.uiUploads.push({...h.uiUploads[0]});await assert.rejects(h.tools.prepareUploadReferenceTransaction(h.uiOptions));const j=uiFixture(),tx=await j.tools.prepareUploadReferenceTransaction(j.uiOptions);j.deactivate();assert.throws(()=>tx.apply({prompt:'UI',negativePrompt:''}));assert.equal(j.rt.state.reference,null)});

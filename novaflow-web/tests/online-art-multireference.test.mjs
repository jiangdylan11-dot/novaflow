import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedArtPhases} from '../packages/shared/src/companion-art-business.mjs';

const model='xai/grok-4.7';
const actor={userId:'u1',sessionId:'s1',epoch:0};
const intentId='0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee';
const png=n=>'data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,n]).toString('base64');
const images=[{role:'subject',dataUrl:png(1)},{role:'style',dataUrl:png(2)},{role:'reference',dataUrl:png(3)}];
const input={currentPrompt:'synthetic image prompt',requirements:'',qwenPromptMode:'txt2img'};
function setup({visionModels=[model],quoteHook=async()=>{},executeHook}={}){
 let calls=0,lastBody,quotedCount;
 const compiler={buildGrokPromptOptimizeRequest(_p,m){return {body:{model:m,input:[{role:'system',content:[{type:'input_text',text:'system'}]},{role:'user',content:[{type:'input_text',text:'prompt'}]}],max_output_tokens:6144},resultOptions:{ordinaryArtStructuredPrompt:true}};},grokResponsesPublicResult(){return {};}};
 const phases=createTrustedArtPhases({secret:Buffer.alloc(32,7),models:[model],visionModels,compiler,policyFor:()=> 'policy',
  quote:async args=>{quotedCount=args.imageCount;await quoteHook(args);return {pricingVersion:'v1',estimatedCredits:2};},
  assessUsage:async()=>({pricingVersion:'v1',usageMissing:false,credits:1,usdCost:.001}),isCurrent:async()=>true,
  infer:async({body})=>{calls++;lastBody=body;return {model,usage:{input_tokens:1,output_tokens:1},status:'completed',finish_reason:'stop',output:[]};},
  executeAtomic:executeHook|| (async({run,requestHash,pricingVersion})=>{const {answer,decision}=await run({markProviderDispatched:async()=>{}});return {status:'settled',settledCredits:1,decision,response:answer,requestHash,pricingVersion,model};})});
 return {phases,get calls(){return calls;},get lastBody(){return lastBody;},get quotedCount(){return quotedCount;}};
}

test('three images are priced and delivered in order, with no bytes in the signed quote',async()=>{
 const s=setup();const q=await s.phases.quoteStructure({actor,model,intentId,input,images});
 assert.equal(q.imageCount,3);assert.equal(s.quotedCount,3);
 const decoded=Buffer.from(q.quoteToken.split('.')[0],'base64url').toString('utf8');
 for(const image of images)assert.equal(decoded.includes(image.dataUrl),false);
 const signed=JSON.parse(decoded);assert.deepEqual(signed.imageManifest.map(x=>x.role),['subject','style','reference']);
 assert.deepEqual(signed.imageManifest.map(x=>x.index),[0,1,2]);
 await s.phases.submit({actor,quoteToken:q.quoteToken,images});
 assert.equal(s.calls,1);const parts=s.lastBody.input.find(x=>x.role==='user').content;
 assert.deepEqual(parts.filter(x=>x.type==='input_image').map(x=>x.image_url),images.map(x=>x.dataUrl));
 assert.deepEqual(parts.filter(x=>/Reference image/.test(x.text||'')).map(x=>x.text),['Reference image 1; role: subject.','Reference image 2; role: style.','Reference image 3; role: reference.']);
});
test('changed bytes, roles, order, missing image, other user and unsupported vision never dispatch',async()=>{
 const s=setup();const q=await s.phases.quoteStructure({actor,model,intentId,input,images});
 for(const changed of [[{...images[0],dataUrl:png(4)},...images.slice(1)],[{...images[0],role:'style'},...images.slice(1)],[images[1],images[0],images[2]],images.slice(0,2)])
  await assert.rejects(s.phases.submit({actor,quoteToken:q.quoteToken,images:changed}));
 await assert.rejects(s.phases.submit({actor:{...actor,userId:'u2'},quoteToken:q.quoteToken,images}));
 await assert.rejects(setup({visionModels:[]}).phases.quoteStructure({actor,model,intentId,input,images}));
 assert.equal(s.calls,0);
});
test('all explicit drawing roles survive the signed manifest and excluded roles fail',async()=>{
 for(const role of ['subject','style','pose','background','material','color','composition','lighting','object']){
  const s=setup(),q=await s.phases.quoteStructure({actor,model,intentId,input,images:[{role,dataUrl:png(1)}]});
  assert.equal(JSON.parse(Buffer.from(q.quoteToken.split('.')[0],'base64url').toString()).imageManifest[0].role,role);
 }
 const s=setup();await assert.rejects(s.phases.quoteStructure({actor,model,intentId,input,images:[{role:'none',dataUrl:png(1)}]}));
});
test('bad, partial, oversized and too many uploads fail before quote or execution',async()=>{
 let quotes=0;const s=setup({quoteHook:async()=>{quotes++;}});
 const tooBig='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(20*1024*1024)]).toString('base64');
 for(const bad of [[...images,images[0]],[images[0],null],[{role:'subject',dataUrl:'data:image/png;base64,AAAA'}],[{role:'subject',dataUrl:tooBig}]])
  await assert.rejects(s.phases.quoteStructure({actor,model,intentId,input,images:bad}));
 assert.equal(quotes,0);assert.equal(s.calls,0);
});
test('cancelled execution and failed quote never call provider',async()=>{
 const s=setup();const q=await s.phases.quoteStructure({actor,model,intentId,input,images});const ac=new AbortController();ac.abort();
 await assert.rejects(s.phases.submit({actor,quoteToken:q.quoteToken,images,signal:ac.signal}));assert.equal(s.calls,0);
 const failed=setup({quoteHook:async()=>{throw Error('upload failed');}});
 await assert.rejects(failed.phases.quoteStructure({actor,model,intentId,input,images}));assert.equal(failed.calls,0);
});

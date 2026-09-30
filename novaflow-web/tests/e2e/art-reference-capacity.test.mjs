import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeReverseRequest } from '../../worker/src/prompt-assistant.mjs';

const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
const e = {setTimeout, clearTimeout};
for (const file of ['art-generate-model.resource.js','art-generate-provider.workflow.js','ui-design-assistant.workflow.js']) vm.runInNewContext(source(file),e);
const models=e.NovaFlowArtGenerateModels, workflow=e.NovaFlowArtGenerateProviderWorkflow;
const refs=count=>Array.from({length:count},(_,i)=>({name:`ref${i+1}.png`,label:`图${i+1}`,dataUrl:`data:image/png;base64,${Buffer.from(String(i+1)).toString('base64')}`}));

for (const [provider,limit] of [['gpt',16],['google',14]]) {
  test(`${provider} default workflow accepts its full node capacity and rejects one extra`,()=>{
    assert.equal(models.capabilityFor(provider,'img2img',{}).referenceLimit,limit);
    const options={provider,mode:'img2img',uploadedNames:refs(limit).map(r=>r.name),prompt:'设计 UI'};
    const built=workflow.buildRunWorkflow(options);
    const loads=Object.values(built.workflow).filter(n=>n.class_type==='LoadImage');
    assert.equal(loads.length,limit);
    assert.deepEqual(Array.from(loads,n=>n.inputs.image),options.uploadedNames);
    const node=Object.values(built.workflow).find(n=>n.class_type===(provider==='gpt'?'OpenAIGPTImageNodeV2':'BatchImagesNode'));
    const keys=Object.keys(node.inputs).filter(k=>k.startsWith(provider==='gpt'?'model.images.':'images.image'));
    assert.equal(keys.length,limit);
    assert.throws(()=>workflow.buildRunWorkflow({...options,uploadedNames:refs(limit+1).map(r=>r.name)}),new RegExp(`maximum is ${limit}`));
  });
}

test('local generation capacity follows the actual local route',()=>{
  assert.equal(models.capabilityFor('local','img2img',{nsfw:false}).referenceLimit,10);
  assert.equal(models.capabilityFor('local','img2img',{nsfw:true}).referenceLimit,3);
});

for (const engine of ['grok','local']) test(`${engine} UI analysis receives all sixteen images in order`,async()=>{
  let request;
  const api=async r=>{request=r;return {ok:true,prompt:'完整设计'};};
  const result=await e.NovaFlowUiDesignAssistantWorkflow.run({engine,provider:'gpt',prompt:'融合全部参考',references:refs(16),sessionToken:'test',electronAPI:{smartAiImageReverse:api,promptAssistantReverseImagePrompt:api}});
  assert.equal(result.referenceCount,16);
  assert.deepEqual(Array.from(request.images,r=>r.imageUrl||r.dataUrl),refs(16).map(r=>r.dataUrl));
  assert.match(request.requirements,/图16/);
});

test('worker preserves image order and rejects an invalid member instead of dropping it',()=>{
  const images=refs(16);
  assert.deepEqual(normalizeReverseRequest({images}).request.images.map(r=>r.dataUrl),images.map(r=>r.dataUrl));
  assert.throws(()=>normalizeReverseRequest({images:[images[0],{}]}),/未截断/);
});

test('cloud admin normalization keeps sixteen role references without truncation',()=>{
  const server=readFileSync(new URL('../../admin/admin-server/server.js',import.meta.url),'utf8');
  const context={normalizeSmartAiText:v=>String(v||'')};
  vm.runInNewContext(server.slice(server.indexOf('function normalizeGrokSmartAiImage('),server.indexOf('function selectGrokSmartAiImageScenario(')),context);
  const normalized=context.normalizeGrokSmartAiImages({images:refs(16)});
  assert.deepEqual(Array.from(normalized,r=>r.imageUrl),refs(16).map(r=>r.dataUrl));
  assert.throws(()=>context.normalizeGrokSmartAiImages({images:[refs(1)[0],{}]}),/未截断/);
});

test('model switches retain and display overflow so it can be removed',()=>{
  const brand=source('novaflow-brand-runtime.js');
  const state={provider:'gpt',references:refs(16)};
  const context={ART_GENERATE_STATE:state,window:{NovaFlowArtGenerateModels:models}};
  vm.runInNewContext(brand.slice(brand.indexOf('  const ART_GENERATE_MAX_REFERENCES ='),brand.indexOf('  function artGenerateResourceMentionSnapshot()')),context);
  assert.equal(context.artGenerateReferenceLimit(),16);
  state.provider='google';
  assert.equal(context.artGenerateReferenceLimit(),14);
  assert.equal(context.artGenerateVisibleReferenceCount(),16);
  context.setArtGenerateReference(15,null);context.setArtGenerateReference(14,null);
  assert.equal(context.artGenerateVisibleReferenceCount(),14);
  assert.equal(context.artGenerateReferences().filter(Boolean).length,14);
  state.provider='local';state.nsfw=true;
  assert.equal(context.artGenerateVisibleReferenceCount(),14);
});

test('drawing assistant collects every populated reference tile',async()=>{
  const smart=source('novaflow-smart-ai.js');
  class Element {querySelector(){return this.img;}}
  const slots=refs(16).map(r=>Object.assign(new Element(),{img:{src:r.dataUrl}}));
  const workspace=Object.assign(new Element(),{querySelectorAll:()=>slots});
  const context={HTMLElement:Element,document:{getElementById:()=>workspace},isFilledImage:()=>true,normalizeImageUrl:async v=>v,labelFromSlot:(_,i)=>`图${i+1}`};
  vm.runInNewContext(smart.slice(smart.indexOf('  async function collectArtImages('),smart.indexOf('  function getImageScenario(')),context);
  assert.equal((await context.collectArtImages()).length,16);
});

test('cloud analysis budgets total encoded size for sixteen images without dropping any',async()=>{
  let encodings=0;
  const context={
    fetch:async()=>({blob:async()=>({size:1.4*1024*1024})}),
    createImageBitmap:async()=>({width:1024,height:1024,close(){}}),
    FileReader:class {readAsDataURL(blob){this.result='data:image/jpeg;base64,'+'A'.repeat(Math.ceil(blob.size/3)*4);this.onload();}},
    document:{createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toBlob:callback=>{encodings++;callback({size:300000});}})},
  };
  vm.runInNewContext(source('ui-design-assistant-image.helper.js'),context);
  const helper=context.NovaFlowUiDesignAssistantImageHelper;
  const result=await helper.normalizeReferencesForGrok(refs(16));
  assert.equal(encodings,16,'images below the former per-image cap still obey the total budget');
  assert.deepEqual(Array.from(result,r=>r.label),refs(16).map(r=>r.label));
  const payload={images:result.map(r=>({imageUrl:r.imageUrl,label:r.label})),requirements:'设计 UI'};
  assert.ok(Buffer.byteLength(JSON.stringify(payload))<10*1024*1024);
});

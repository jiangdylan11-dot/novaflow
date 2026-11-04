import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {artBusinessDependencies,policyFor} from '../supabase/functions/novaflow-companion/art-dependencies.mjs';
import {createCompanionArtBusiness} from '../packages/shared/src/companion-art-business.mjs';

test('companion uses the existing Qwen Image policy for both supported modes',()=>{
  const env={};for(const key of ['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','PATHEXT'])if(process.env[key])env[key]=process.env[key];
  env.PYTHONDONTWRITEBYTECODE='1';
  const result=spawnSync('python',[fileURLToPath(new URL('../tools/emit-companion-art-policy.py',import.meta.url))],{encoding:'utf8',env,windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stderr);const expected=JSON.parse(result.stdout);
  assert.equal(policyFor('txt2img'),expected.txt2img);assert.equal(policyFor('img2img'),expected.img2img);assert.equal(policyFor('other'),'');
});

test('real compiler is available but server-owned dependencies do not enable art',async()=>{
  const ports=artBusinessDependencies(Buffer.alloc(32,1));
  assert.equal(typeof ports.compiler.buildGrokPromptOptimizeRequest,'function');assert.equal(typeof ports.compiler.grokResponsesPublicResult,'function');
  assert.equal(ports.enabled,false);assert.equal(ports.accountingReady,false);
  const service=await createCompanionArtBusiness(ports);
  assert.throws(()=>service.quote({}),e=>e.code==='art-business-unavailable');assert.throws(()=>service.execute({}),e=>e.code==='art-business-unavailable');
});
test('DeepSeek text art uses its exact policy while an unverified image is rejected before billing',async()=>{
  const ds='deepseek/deepseek-v4.1-flash',ports=artBusinessDependencies(Buffer.alloc(32,1));let calls=0;
  const provider={apiKey:'synthetic',baseUrl:'https://llm.runninghub.ai/v1',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true,operationTextChatV3:true,
    creditConfig:{xiaotao_online:{enabled_models:[ds]}}};
  const business=await createCompanionArtBusiness({...ports,enabled:true,accountingReady:true,provider,charge:async()=>{calls++;},isCurrent:async()=>true});
  const user={id:'fixture-user'},sessionId='fixture-session',payload={stage:'structure',modelId:ds,epoch:1,intentId:'0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee',input:{currentPrompt:'A red ball',targetEngine:'gpt-image-2.5'}};
  const quote=await business.quote({user,sessionId,payload});assert.equal(quote.model,ds);assert.ok(quote.estimatedCredits>0);assert.equal(calls,0);
  const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64');
  await assert.rejects(business.quote({user,sessionId,payload:{...payload,images:[{role:'subject',dataUrl:png}]}}),e=>e.code==='model-vision-unavailable');assert.equal(calls,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const source=await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
const a=source.indexOf('  async function selectedOnlineBusinessPrompt('),b=source.indexOf('  async function localPromptAssistant(',a);
assert.ok(a>0&&b>a);

test('DeepSeek reference images stop before confirmation, quote or upload',async()=>{
  const selected={provider:'api',modelId:'deepseek/deepseek-v4.1-flash',epoch:1};let network=0,confirm=0;
  const controller={businessModelSnapshot:()=>selected,subscribeBusinessModel:()=>()=>{}};
  const root={XIAOTAO_ONLINE_ART_RELEASE_ENABLED:true,AbortController,crypto:webcrypto,CONFIG:{},currentSession:()=>({token:'fixture'}),captureFoartSessionGuard:()=>()=>true,
    companionCloudRequests:new Map(),companionCloudUsed:new Set(),NovaFlowXiaotaoArtAgent:{panel:{controller}},api:async()=>{network++;throw Error('unexpected');}};
  root.root=root;vm.createContext(root);vm.runInContext(source.slice(a,b)+'\nglobalThis.online=selectedOnlineBusinessPrompt;',root);
  const payload={requestId:'0d2aa225-e027-4d20-8ef3-7b5d1a9bbfee',surface:'art',purpose:'optimize',prompt:'safe',targetEngine:'gpt-image-2.5',qwenPromptMode:'img2img',supportsNegativePrompt:false,
    images:[{role:'subject',dataUrl:'data:image/png;base64,iVBORw0KGgo='}],onPricingQuote(){},confirmPricingQuote:async()=>true,onBillingNotice(){},confirmImageUpload:async()=>{confirm++;return true;},isImageInputCurrent:()=>true};
  const result=await root.online('optimize-prompt',payload,selected,controller);
  assert.equal(result.errorCode,'model-vision-unavailable');assert.equal(network,0);assert.equal(confirm,0);
});

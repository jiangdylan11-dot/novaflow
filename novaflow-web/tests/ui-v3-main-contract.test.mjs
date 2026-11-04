import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalizeXiaotaoV3OperationIntent} from '../packages/shared/src/xiaotao-operation-v3-prepare.mjs';
import {inspectXiaotaoV3UiReply,createUiIntentPrototype} from '../packages/shared/src/xiaotao-ui-framework-v3.mjs';
import {assistant,pipeline} from '../packages/shared/src/xiaotao-ui-professional.generated.mjs';
import {companionPricingPolicy} from '../packages/shared/src/companion-pricing.mjs';
const dataUrl='data:image/png;base64,'+(await readFile(new URL('./style-canvas-synthetic.png',import.meta.url))).toString('base64');
const actor={userId:'fixture-user',sessionId:'fixture-session'},model='xai/grok-4.7';
const request={requestId:'fixture_request_123',revision:'visible-project-revision',prompt:'Keep the layout in @参考图1',requirements:'Keep the button label',negativePrompt:'No logos',generationIntent:'redesign',preserveLayout:true,size:{width:768,height:512},structure:{name:'Menu',width:768,height:512,regions:[]},references:[{id:'layout',role:'combined',dataUrl},{id:'style',role:'style',dataUrl}]};
const intent={mode:'ui-draft',epoch:3,request},opts={actor,model,isCurrent:async()=>true,visionEnabled:true,uiDraftEnabled:true};
test('UI draft stays disabled without trusted opt-in and vision',async()=>{await assert.rejects(canonicalizeXiaotaoV3OperationIntent(intent,{...opts,uiDraftEnabled:false}),{code:'operation-intent-unsupported'});await assert.rejects(canonicalizeXiaotaoV3OperationIntent(intent,{...opts,visionEnabled:false}),{code:'model-vision-unavailable'});});
test('UI draft preserves role bindings and returns preview only',async()=>{const {uiPrepared,uiAdapter,compiled}=await canonicalizeXiaotaoV3OperationIntent(intent,opts);assert.equal(compiled.imageCount,2);assert.deepEqual(uiPrepared.canonical.manifest.map(x=>x.role),['combined','style']);const reply={prompt:uiPrepared.markers.map(x=>x.placeholder).join(' '),negativePrompt:'No logos',uiPlan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'},{index:2,role:'style'}],layoutChanges:[],preserve:[]}};const preview=await inspectXiaotaoV3UiReply({uiPrepared,uiAdapter,reply:JSON.stringify(reply)});assert.equal(preview.status,'preview-only');assert.equal(preview.applyAvailable,false);assert.deepEqual(preview.sourceManifest.map(x=>x.role),['combined','style']);await assert.rejects(inspectXiaotaoV3UiReply({uiPrepared,uiAdapter,reply:JSON.stringify({...reply,prompt:'lost marker'})}),{code:'ui-reference-restoration-failed'});});
test('UI policy is default closed and enabled terms are hash-bound',async()=>{const base={apiKey:'synthetic',model,configRevision:'1',operationTextChatV3:true,operationVisionChatV3:true,creditConfig:{}},closed=await companionPricingPolicy(base),open=await companionPricingPolicy({...base,operationUiDraftV3:true});assert.equal(closed.config.xiaotao_online.operation_ui_draft_v3,undefined);assert.equal(open.config.xiaotao_online.operation_ui_draft_v3,true);assert.notEqual(closed.version,open.version);});
test('UI draft accepts fractional receipt only when trusted frozen receipt proves decimal policy',async()=>{
  const {uiPrepared}=await canonicalizeXiaotaoV3OperationIntent(intent,opts);
  const current={actor:uiPrepared.canonical.actor,model,revision:request.revision,intentHash:uiPrepared.intentHash};
  const args={prepared:uiPrepared,current,receipt:{operationId:'synthetic'},reply:uiPrepared.markers.map(x=>x.placeholder).join(' '),negativeReply:'No logos',
    plan:{version:1,layoutMode:'preserve',layoutReference:1,visualMode:'theme-redesign',references:[{index:1,role:'layout'},{index:2,role:'style'}],layoutChanges:[],preserve:[]}};
  const use=verified=>createUiIntentPrototype({assistant,pipeline,isCurrent:async()=>true,verifyReceipt:async()=>verified}).draft(args);
  const markers={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
  assert.equal((await use({status:'settled',charged:0.000001,...markers})).status,'preview-only');
  assert.equal((await use({status:'settled',charged:1})).status,'preview-only');
  for(const verified of [{status:'settled',charged:0.000001},{status:'settled',charged:0.000001,credit_amount_policy:'decimal-v1'},
    {status:'settled',charged:0.0000001,...markers},{status:'settled',charged:0.000001,...markers,minimum_positive_credits:1}])
    await assert.rejects(use(verified),{code:'ui-billing-unconfirmed'});
});

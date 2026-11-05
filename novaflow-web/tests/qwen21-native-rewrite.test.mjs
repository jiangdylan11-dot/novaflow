import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQwen21NativeRewrite,compileQwen21NativeRewrite,QWEN21_NATIVE_REWRITE} from '../packages/shared/src/qwen21-native-rewrite.mjs';
import {createTrustedArtPhases} from '../packages/shared/src/companion-art-business.mjs';
import * as compiler from '../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
const model='deepseek/deepseek-v4.1-flash',actor={userId:'fixture',sessionId:'fixture',epoch:1};
const input={targetEngine:'qwen-2.1',promptContract:QWEN21_NATIVE_REWRITE,currentPrompt:'森林中的小木屋，暖色灯光，水彩风格',requirements:'',qwenPromptMode:'txt2img',negativePrompt:'文字水印',supportsNegativePrompt:true};
const pair={display_prompt:'森林中的小木屋采用水彩风格，木质墙面与窗框保持自然纹理，暖色灯光从窗内透出，照亮林间地面；周围树木形成前后层次，整体宁静温暖。',model_prompt:'A watercolor illustration of a small wooden cabin in a forest. Warm light shines through the windows onto the forest floor, contrasting with the cool green trees. Natural wood grain and soft watercolor edges define the cabin, with layered trees creating depth and a quiet, welcoming atmosphere.'};
function compile(value=pair,source=input){return compileQwen21NativeRewrite({output_text:JSON.stringify(value)},buildQwen21NativeRewrite(source,model),compiler.validateQwen21NativePreservation);}
test('native prose preserves the brief and the existing negative prompt',()=>{
 const result=compile();assert.equal(result.modelPrompt,pair.model_prompt);assert.equal(result.negativePrompt,input.negativePrompt);assert.equal(result.promptContract,QWEN21_NATIVE_REWRITE);
 const body=buildQwen21NativeRewrite(input,model).body;assert.equal(body.max_output_tokens,4096);assert.ok(JSON.stringify(body.text).length<500);assert.equal(body.text.format.schema.additionalProperties,false);
});
test('literal Chinese artwork text is preserved inside English prose',()=>{
 const source={...input,currentPrompt:'白色海报，标题“夏日特惠”'},value={display_prompt:'白色海报中央以红色文字呈现标题“夏日特惠”，背景干净留白。',model_prompt:'A clean white poster with the exact red headline "夏日特惠" centered in the frame, with generous white space and a minimal layout.'};
 assert.equal(compile(value,source).modelPrompt,value.model_prompt);assert.throws(()=>compile({...value,model_prompt:value.model_prompt.replace('夏日特惠','Summer Sale')},source),/lettering/);
});
test('source constraints, image tags, full JSON and translated prose remain checked',()=>{
 assert.throws(()=>compile({...pair,display_prompt:'一辆蓝色赛车停在城市街道中央，冷色灯光照射路面。'}),/source constraints/);
 const source={...input,currentPrompt:'把<image1>的木屋置于森林，保持木屋不变',qwenPromptMode:'img2img'};
 assert.throws(()=>compile(pair,source));
 assert.throws(()=>compile({...pair,model_prompt:pair.model_prompt+' 暖色灯光'}),/not English/);
 assert.throws(()=>compile({...pair,extra:'unexpected'}),/fields invalid/);
 assert.throws(()=>compileQwen21NativeRewrite({output_text:'{"display_prompt":'},buildQwen21NativeRewrite(input,model),compiler.validateQwen21NativePreservation),/complete JSON/);
});
test('explicit quantities, colors and corner positions cannot silently disappear',()=>{
 const source={...input,currentPrompt:'白色背景，左下角两只蓝色玻璃杯'},value={display_prompt:'白色背景中，左下角摆放两只蓝色玻璃杯，光线柔和。',model_prompt:'Two blue glass cups sit in the lower-left corner of a white background, with soft lighting and ample empty space.'};
 assert.equal(compile(value,source).modelPrompt,value.model_prompt);
 for(const [a,b]of [['Two','Three'],['blue','green'],['lower-left','upper-left']])assert.throws(()=>compile({...value,model_prompt:value.model_prompt.replace(a,b)},source));
});
test('one trusted native phase binds, validates and settles once without English dispatch',async()=>{
 const events=[],operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',version='sha256:'+'a'.repeat(64);
 const amount={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
 const phases=createTrustedArtPhases({secret:Buffer.alloc(32,7),models:[model],compiler,policyFor:()=> 'unused',isCurrent:async()=>true,
   pricingConfig:{xiaotao_online:amount},quote:async()=>({pricingVersion:version,estimatedCredits:0.5}),assessUsage:async()=>({pricingVersion:version,usageMissing:false,credits:1,usdCost:.001}),
   infer:async()=>{events.push('infer');return {model,status:'completed',finish_reason:'stop',usage:{input_tokens:1,output_tokens:1},output:[],output_text:JSON.stringify(pair)};},
   executeAtomic:async()=>{throw Error('legacy forbidden');},operationV3:{enabled:true,begin:async()=>({operationId,intentHash:'a'.repeat(64)}),
     executePhase:async a=>{events.push(a.stage);const {answer,decision}=await a.run({markProviderDispatched:async()=>{}});return {status:'recorded',response:answer,decision,requestHash:a.requestHash,pricingVersion:a.pricingVersion,model:a.model};},
     ports:{bindArtPlan:async a=>{assert.equal(a.artMode,'art_single');return{status:'bound'};},acceptArtStructure:async()=>({status:'accepted'}),registerArtEnglish:async()=>{throw Error('English forbidden');},acceptArtEnglish:async()=>{throw Error('English forbidden');},finalize:async a=>{events.push('settle');return {status:'settled',outcome:a.outcome,charged:.001,uncollected:0,...amount};}}}});
 const quote=await phases.quoteStructure({actor,model,input,intentId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
 assert.equal(quote.maxOutputTokens,4096);const result=await phases.submit({actor,quoteToken:quote.quoteToken});assert.equal(result.ok,true);
 assert.deepEqual(events,['structure','infer','settle']);assert.equal(result.stageToken,undefined);assert.equal(result.modelPromptPolicy,QWEN21_NATIVE_REWRITE);
});
test('豆包-style answers: fenced JSON and "做一张图" requests are not rejected',()=>{
 const source={...input,currentPrompt:'小女孩走在海边',requirements:'做一张图小女孩走在海边',supportsNegativePrompt:false,negativePrompt:''};
 const value={display_prompt:'写实风格摄影：小女孩走在海边，身穿浅色连衣裙，赤脚踩着湿润的沙子，海浪在脚边泛起白色泡沫。远处海天相接，天空染成橙粉色，暖色逆光勾勒出她的轮廓。',
  model_prompt:'A realistic photograph of a little girl walking along the seaside in a light dress, barefoot on wet sand while waves foam around her feet. Sea and sky meet far away under an orange pink sky, and warm backlight outlines her silhouette.'};
 const prepared=buildQwen21NativeRewrite(source,'bytedance/doubao-seed-2.1-lite');
 for(const text of [JSON.stringify(value),'```json\n'+JSON.stringify(value,null,2)+'\n```','以下是结果：\n'+JSON.stringify(value)])
  assert.equal(compileQwen21NativeRewrite({output_text:text},prepared,compiler.validateQwen21NativePreservation).displayPrompt,value.display_prompt);
 // The picture count is not an object count, but a real object count still is.
 const two={...source,requirements:'做一张图，两只小狗在海边'};
 assert.throws(()=>compileQwen21NativeRewrite({output_text:JSON.stringify(value)},buildQwen21NativeRewrite(two,'x'),()=>true),/quantity/);
 assert.match(buildQwen21NativeRewrite(source,'x').body.input[0].content[0].text,/keep the user's own words/);
});

// GENERATED COPY - source: packages/shared/src/companion-art-business.mjs
// Default-closed online art workflow. Injected ports are server-owned; a node
// or browser must never supply compiler, billing, model, or policy functions.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {estimateXiaotaoOnlineCredits,settleXiaotaoOnlineCredits} from './feature-credits.mjs';
import {companionPricingPolicy} from './companion-pricing.mjs';
import {postRunningHubResponses} from './runninghub-llm.mjs';
import {hasXiaotaoDecimalV1,isXiaotaoCreditAmount} from './xiaotao-decimal-usage.mjs';
import {QWEN21_NATIVE_REWRITE,QWEN21_NATIVE_CONTRACTS,buildQwen21NativeRewrite,compileQwen21NativeRewrite} from './qwen21-native-rewrite.mjs';

const VERSION='foart-art-phases-prototype-v1';
const ENGLISH_SYSTEM='Translate the supplied validated image prompt into English for Qwen Image 2.1. Translate only; do not optimize again, summarize, add or remove facts. Preserve every object count, color, relative position, negative statement, material, lighting and camera constraint. Translate quoted descriptive field values too. Keep artwork lettering verbatim, including its original language, spelling and punctuation. Preserve reference placeholders and program identifiers exactly. Return all six sections in this order with these exact headings: [Style], [Subjects], [Environment], [Lighting], [Camera], [Requirements]. Return only the complete English prompt.';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const IMAGE_LIMIT=20*1024*1024;
const IMAGE_ROLES=new Set(['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference']);
// Match the existing companion image contract. The manifest contains no image
// data and is the only image material included in signed quotes or metadata.
function readImages(images){
  if(images==null)images=[];
  if(!Array.isArray(images)||images.length>3)fail('invalid-images');
  let total=0;
  return images.map((image,index)=>{
    if(!image||typeof image!=='object'||Array.isArray(image)||Object.keys(image).some(k=>!['role','dataUrl'].includes(k)))fail('invalid-images');
    const role=image.role==null?'attachment':image.role;
    if(!IMAGE_ROLES.has(role)||typeof image.dataUrl!=='string')fail('invalid-images');
    const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if(!m||m[2].length%4!==0||m[2].length>Math.ceil(IMAGE_LIMIT/3)*4)fail('invalid-images');
    const bytes=Buffer.from(m[2],'base64');
    if(bytes.toString('base64')!==m[2])fail('invalid-images');
    total+=bytes.length;
    const png=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const webp=bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(total>IMAGE_LIMIT||!(m[1]==='png'?png:m[1]==='jpeg'?jpeg:webp))fail('invalid-images');
    return {manifest:{index,role,mime:'image/'+m[1],byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},dataUrl:image.dataUrl};
  });
}
function attachImages(body,images){
  const result=structuredClone(body);
  const user=[...result.input].reverse().find(row=>row.role==='user'&&Array.isArray(row.content));
  if(!user)fail('compiler-unavailable');
  for(const image of images)user.content.push({type:'input_text',text:`Reference image ${image.manifest.index+1}; role: ${image.manifest.role}.`},{type:'input_image',image_url:image.dataUrl});
  return result;
}
function frozenCopy(value) {
  const copy=structuredClone(value);
  const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;};
  return freeze(copy);
}
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
function validActor(actor) {
  return actor && typeof actor.userId==='string' && actor.userId.length>0 && actor.userId.length<=128
    && typeof actor.sessionId==='string' && actor.sessionId.length>0 && actor.sessionId.length<=128
    && Number.isSafeInteger(actor.epoch) && actor.epoch>=0;
}
function sameActor(a,b){return validActor(a)&&validActor(b)&&a.userId===b.userId&&a.sessionId===b.sessionId&&a.epoch===b.epoch;}
function text(value,max){return typeof value==='string'&&value.length<=max?value:fail('invalid-input');}
function makeSigner(secret) {
  if(!Buffer.isBuffer(secret)||secret.length<32)fail('invalid-server-key');
  const mac=value=>createHmac('sha256',secret).update(VERSION+'\0'+value).digest('base64url');
  return {
    sign(payload){const value=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');return value+'.'+mac(value);},
    verify(token){
      if(typeof token!=='string'||token.length>180000)fail('invalid-token');
      const parts=token.split('.');if(parts.length!==2)fail('invalid-token');
      const expected=Buffer.from(mac(parts[0]),'ascii'),actual=Buffer.from(parts[1],'ascii');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail('invalid-token');
      try{return JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{return fail('invalid-token');}
    }
  };
}
function structureBody(input,model,policy,compiler,images=[]) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid-input');
  const allowed=['currentPrompt','requirements','negativePrompt','supportsNegativePrompt','nsfw','qwenPromptMode','targetEngine','promptContract'];
  if(Object.keys(input).some(k=>!allowed.includes(k)))fail('invalid-input');
  const currentPrompt=text(input.currentPrompt,20000);
  if(!currentPrompt.trim())fail('invalid-input');
  const requirements=text(input.requirements??'',4000),negativePrompt=text(input.negativePrompt??'',12000);
  for(const key of ['supportsNegativePrompt','nsfw'])if(input[key]!==undefined&&typeof input[key]!=='boolean')fail('invalid-input');
  const qwenPromptMode=input.qwenPromptMode??'txt2img';
  if(!['txt2img','img2img'].includes(qwenPromptMode))fail('invalid-input');
  if(input.targetEngine!==undefined&&input.targetEngine!=='qwen-2.1'&&input.targetEngine!=='gpt-image-2.5')fail('invalid-input');
  if(input.promptContract!==undefined){
    if(!QWEN21_NATIVE_CONTRACTS.includes(input.promptContract)||input.targetEngine!=='qwen-2.1')fail('invalid-input');
    return buildQwen21NativeRewrite({...input,currentPrompt,requirements,negativePrompt,qwenPromptMode},model,images.map(image=>image.manifest.role));
  }
  if(input.targetEngine==='gpt-image-2.5'){
    if(input.supportsNegativePrompt===true||input.nsfw===true||negativePrompt)fail('invalid-input');
    const payload={surface:'art',purpose:'optimize',targetEngine:'gpt-image-2.5',completeVisualBrief:true,
      prompt:currentPrompt,currentPrompt,requirements,negativePrompt:'',supportsNegativePrompt:false,nsfw:false};
    const prepared=compiler.buildGrokPromptOptimizeRequest(payload,model);
    if(prepared.resultOptions?.artSemanticFusion!==true||prepared.resultOptions?.targetEngine!=='gpt-image-2.5'||
      prepared.resultOptions?.completeVisualBrief!==true||prepared.body?.max_output_tokens!==1536||prepared.body?.model!==model)fail('compiler-unavailable');
    return {body:prepared.body,options:prepared.resultOptions,kind:'gpt-image-2.5'};
  }
  const payload={surface:'art',purpose:'optimize',targetEngine:'qwen-2.1',agentModelLanguage:'en',promptSchema:'nf.art.prompt.v1',
    currentPrompt,requirements,negativePrompt,supportsNegativePrompt:input.supportsNegativePrompt===true,nsfw:input.nsfw===true,qwenPromptMode};
  const policyText=policy(qwenPromptMode);
  if(typeof policyText!=='string'||!policyText.trim())fail('policy-unavailable');
  const prepared=compiler.buildGrokPromptOptimizeRequest(payload,model);
  if(prepared.resultOptions?.ordinaryArtStructuredPrompt!==true || prepared.body?.max_output_tokens!==6144||prepared.body?.model!==model)fail('compiler-unavailable');
  prepared.body.input[0].content[0].text+='\n'+policyText;
  return {body:prepared.body,options:prepared.resultOptions};
}
function englishBody(display,model) {
  const length=Array.from(display).length;
  return {model,store:false,input:[{role:'system',content:[{type:'input_text',text:ENGLISH_SYSTEM}]},
    {role:'user',content:[{type:'input_text',text:display}]}],temperature:0,max_output_tokens:Math.min(4096,Math.max(1536,length*3))};
}
function validateEnglish(display,output) {
  if(typeof output!=='string')fail('english-invalid');
  // Providers sometimes translate the source section labels literally despite
  // the requested English headings. Canonicalize only equivalent headings;
  // the complete six-section order and all content checks still apply below.
  const trimmed=output.trim().replace(/^[ \t]*\[(Lighting (?:and|&) Colou?r|User Additional Requirements|Additional Requirements|User Requirements)\][ \t]*$/gim,
    (_heading,label)=>/^lighting/i.test(label)?'[Lighting]':'[Requirements]');
  const refs=display.match(/<image\d+>|@参考图\s*\d+|__NF[A-Za-z0-9_]+__/g)||[];
  const literals=[...display.matchAll(/(?:文字|写着|字样|标签|lettering|text)[^\n]{0,30}?[「“"]([^」”"\n]+)[」”"]/gi)].map(m=>m[1]);
  if(!trimmed||[...refs,...literals].some(s=>!trimmed.includes(s))||(trimmed.match(/[A-Za-z]+/g)||[]).length<8)fail('english-invalid');
  // Explicit artwork lettering and reference tokens may intentionally remain
  // Chinese. Other CJK text is an unfinished translation, not an English draft.
  let translated=trimmed;
  for(const literal of [...refs,...literals]) translated=translated.replace(literal,'');
  if(/[\u3400-\u9fff\uf900-\ufaff]/u.test(translated))fail('english-invalid');
  // Structured art is compiled as six sections. Require a corresponding
  // nonempty translated section for each; this is not a semantic proof.
  const sourceHeadings=display.match(/^[ \t]*\[[^\]\r\n]+\][ \t]*$/gm)||[];
  if(sourceHeadings.length===6){
    const expected=['style','subjects','environment','lighting','camera','requirements'];
    const sections=[...trimmed.matchAll(/^[ \t]*\[(style|subjects|environment|lighting|camera|requirements)\][ \t]*$/gim)];
    if(sections.length!==6||trimmed.slice(0,sections[0].index).trim()||
       sections.some((section,i)=>section[1].toLowerCase()!==expected[i]||
        !trimmed.slice(section.index+section[0].length,i<5?sections[i+1].index:trimmed.length).trim()))fail('english-invalid');
  }
  return trimmed;
}

// executeAtomic must bind the quoted fingerprint, pricingVersion, userId and
// usageKey inside the existing atomic ledger before run(), call run at most
// once, and resolve only a confirmed settled receipt. Unknown outcomes fail
// closed and stay recoverable. This prototype does not implement that port.
export function createTrustedArtPhases({secret,models,visionModels=[],compiler,policyFor,quote,assessUsage,executeAtomic,infer,isCurrent,now=()=>Date.now(),operationV3=null,pricingConfig={}}={}) {
  if(!Array.isArray(models)||!models.length||models.some(x=>typeof x!=='string'||!x))fail('invalid-models');
  if(typeof compiler?.buildGrokPromptOptimizeRequest!=='function'||typeof compiler?.grokResponsesPublicResult!=='function')fail('compiler-unavailable');
  for(const fn of [policyFor,quote,assessUsage,executeAtomic,infer,isCurrent,now])if(typeof fn!=='function')fail('missing-server-port');
  const useV3=operationV3?.enabled===true;
  if(useV3&&(typeof operationV3.begin!=='function'||typeof operationV3.executePhase!=='function'||
    ['bindArtPlan','acceptArtStructure','registerArtEnglish','acceptArtEnglish','finalize'].some(k=>typeof operationV3.ports?.[k]!=='function')))fail('missing-server-port');
  if(!Array.isArray(visionModels)||visionModels.some(x=>!models.includes(x)))fail('invalid-models');
  const permitted=new Set(models),vision=new Set(visionModels),signer=makeSigner(secret);
  async function check(actor,model){if(!validActor(actor)||!permitted.has(model)||await isCurrent(actor,model)!==true)fail('selection-stale');}
  const opIdentity=(actor,model,pricingVersion,operation)=>({actor:{...actor,model,policyVersion:pricingVersion,...operation},operationId:operation.operationId});
  const checkStatus=(result,status)=>{if(result?.status!==status)fail('billing-unconfirmed');};
  const v3Settlement=(requestId,receipt,outcome)=>{
    // Recovery may run after the current price policy changes. Only the
    // authenticated SQL receipt's frozen policy can classify this amount.
    const amount={};for(const key of ['credit_amount_policy','credit_precision','credit_rounding','minimum_positive_credits'])
      if(Object.hasOwn(receipt||{},key))amount[key]=receipt[key];
    const frozen={xiaotao_online:amount},options={allowZero:true,max:14000000};
    if(receipt?.status!=='settled'||receipt.outcome!==outcome||!isXiaotaoCreditAmount(receipt.charged,frozen,options)||
      !isXiaotaoCreditAmount(receipt.uncollected,frozen,options))fail('billing-unconfirmed');
    return {requestId,status:'settled',settledCredits:Number(receipt.charged),
      ...(Number(receipt.uncollected)>0?{uncollectedCredits:Number(receipt.uncollected)}:{}),
      ...(hasXiaotaoDecimalV1(frozen)?amount:{})};
  };
  async function makeQuote(actor,model,stage,prepared,parent,intentId,images=[]) {
    const boundActor=frozenCopy(actor);
    await check(boundActor,model);
    // Every English quote derived from one completed structure phase uses the
    // same ledger key, even across tabs, refreshes and repeated quotation.
    const requestId=stage==='english' ? parent.parentRequestId+'-english' : hash({v:VERSION,userId:boundActor.userId,intentId});
    const imageManifest=images.map(image=>image.manifest);
    const terms={version:VERSION,stage,model,body:prepared.body,parent:parent||null,...(imageManifest.length?{imageManifest}:{})};
    const requestHash=hash(terms);
    const priced=await quote({actor:boundActor,model,stage,body:frozenCopy(images.length?attachImages(prepared.body,images):prepared.body),imageCount:images.length,requestHash});
    if(!priced||typeof priced.pricingVersion!=='string'||!priced.pricingVersion||
      !isXiaotaoCreditAmount(priced.estimatedCredits,useV3?pricingConfig:{}))fail('pricing-unavailable');
    if(!sameActor(actor,boundActor)||hash(terms)!==requestHash)fail('quote-changed');
    await check(boundActor,model);
    if(!sameActor(actor,boundActor))fail('selection-stale');
    let operation=null;
    if(useV3){
      if(stage==='structure'){
        operation=await operationV3.begin({actor:boundActor,model,nonce:intentId,pricingVersion:priced.pricingVersion,structureHash:requestHash});
        if(!operation||Object.keys(operation).length!==2||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation.operationId||'')||!/^[a-f0-9]{64}$/.test(operation.intentHash||''))fail('billing-unconfirmed');
        operation=frozenCopy(operation);
        checkStatus(await operationV3.ports.bindArtPlan({...opIdentity(boundActor,model,priced.pricingVersion,operation),artMode:['gpt-image-2.5','qwen21-native'].includes(prepared.kind)?'art_single':'art_dual',structureHash:requestHash}),'bound');
      } else {
        operation=parent?.operation;
        if(!operation||parent.pricingVersion!==priced.pricingVersion||!/^[a-f0-9]{64}$/.test(parent?.parentHash||''))fail('invalid-stage');
        checkStatus(await operationV3.ports.registerArtEnglish({...opIdentity(boundActor,model,priced.pricingVersion,operation),parentHash:parent.parentHash,englishHash:requestHash}),'bound');
      }
      await check(boundActor,model);
      if(!sameActor(actor,boundActor))fail('selection-stale');
    } else if(parent?.operation)fail('invalid-stage');
    const data={v:VERSION,kind:'quote',actor:boundActor,model,stage,prepared,parent:parent||null,...(imageManifest.length?{imageManifest}:{}),requestId,requestHash,
      pricingVersion:priced.pricingVersion,estimatedCredits:priced.estimatedCredits,...(operation?{operation}:{}),expiresAt:now()+5*60*1000};
    return {quoteToken:signer.sign(data),requestId,stage,model,requestHash,pricingVersion:data.pricingVersion,
      ...(operation?{billingScope:'operation-v3',recoveryOperationId:operation.operationId}:{}),
      estimatedCredits:data.estimatedCredits,maxOutputTokens:prepared.body.max_output_tokens,imageCount:imageManifest.length};
  }
  return {
    async quoteStructure({actor,model,input,intentId,images}) {
      if(typeof intentId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intentId))fail('invalid-intent');
      const parsed=readImages(images);
      if(input?.promptContract===QWEN21_NATIVE_REWRITE&&input?.qwenPromptMode==='img2img'&&!parsed.length)fail('invalid-images');
      if(parsed.length&&!vision.has(model))fail('model-vision-unavailable');
      return makeQuote(actor,model,'structure',structureBody(input,model,policyFor,compiler,parsed),null,intentId,parsed);
    },
    async quoteEnglish({actor,stageToken}) {
      const boundActor=frozenCopy(actor);
      const parent=signer.verify(stageToken);
      if(parent.v!==VERSION||parent.kind!=='validated-structure'||!sameActor(parent.actor,boundActor)||parent.expiresAt<now())fail('invalid-stage');
      await check(boundActor,parent.model);
      if(!sameActor(actor,boundActor))fail('selection-stale');
      const quoted=await makeQuote(boundActor,parent.model,'english',{body:englishBody(parent.display,parent.model),display:parent.display},parent);
      if(!sameActor(actor,boundActor))fail('selection-stale');
      return quoted;
    },
    async cancelPending({actor,stageToken}) {
      if(!useV3)throw Object.assign(new Error('operation-billing-disabled'),{code:'operation-billing-disabled',status:503});
      const boundActor=frozenCopy(actor),parent=signer.verify(stageToken);
      // Unlike an English quote, cancellation does not dispatch a provider.
      // A previously signed stage token remains usable for authenticated
      // reconciliation after expiry; SQL still validates the operation owner.
      if(parent?.v!==VERSION||parent.kind!=='validated-structure'||!sameActor(parent.actor,boundActor)||
        !parent.operation||!/^[a-f0-9]{64}$/.test(parent.parentHash||'')||typeof parent.pricingVersion!=='string')fail('invalid-stage');
      await check(boundActor,parent.model);
      if(!sameActor(actor,boundActor))fail('selection-stale');
      const receipt=await operationV3.ports.finalize({...opIdentity(boundActor,parent.model,parent.pricingVersion,parent.operation),outcome:'cancel'});
      await check(boundActor,parent.model);
      if(!sameActor(actor,boundActor))fail('selection-stale');
      // A dispatched phase with unknown result must remain held for review.
      if(receipt?.status==='pending-reconciliation')return {ok:false,errorCode:'operation-status-unknown'};
      const settlement=v3Settlement(parent.parentRequestId,receipt,'cancel');
      return {ok:false,errorCode:'operation-cancelled',settlement};
    },
    async submit({actor,quoteToken,images,signal}) {
      const boundActor=frozenCopy(actor);
      const q=signer.verify(quoteToken);
      if(q.v!==VERSION||q.kind!=='quote'||!sameActor(q.actor,boundActor)||q.expiresAt<now())fail('invalid-quote');
      const parsed=readImages(images),manifest=parsed.map(image=>image.manifest);
      if((parsed.length&&!vision.has(q.model))||JSON.stringify(manifest)!==JSON.stringify(q.imageManifest||[]))fail('quote-changed');
      if(q.requestHash!==hash({version:VERSION,stage:q.stage,model:q.model,body:q.prepared.body,parent:q.parent||null,...(manifest.length?{imageManifest:manifest}:{})}))fail('quote-changed');
      // Quotes signed before referenceCount was introduced remain valid only
      // after their signed manifest has matched the supplied image digests.
      const validatedPrepared=q.prepared.nativeEdit&&q.prepared.referenceCount===undefined
        ?{...q.prepared,referenceCount:manifest.length}:q.prepared;
      await check(boundActor,q.model);
      if(!sameActor(actor,boundActor))fail('selection-stale');
      if(signal?.aborted)fail('cancelled-before-submit');
      if(useV3!==!!q.operation)fail('invalid-quote');
      let result;
      try {result=await (useV3?operationV3.executePhase:executeAtomic)({userId:boundActor.userId,sessionId:boundActor.sessionId,usageKey:'art-phase:'+q.requestId,
        model:q.model,stage:q.stage,imageCount:manifest.length,requestHash:q.requestHash,pricingVersion:q.pricingVersion,estimatedCredits:q.estimatedCredits,
        ...(useV3?{...opIdentity(boundActor,q.model,q.pricingVersion,q.operation),operation:q.operation}:{}),
        signal,run:async({markProviderDispatched}={})=>{
          await check(boundActor,q.model);
          if(!sameActor(actor,boundActor))fail('selection-stale');
          if(signal?.aborted)fail('cancelled-before-provider');
          if(typeof markProviderDispatched!=='function')fail('dispatch-guard-unavailable');
          await markProviderDispatched();
          // A cancellation or selection change may happen while the durable
          // dispatch marker is in flight. It is now an unknown hold, but must
          // not become a late provider request.
          if(signal?.aborted)fail('cancelled-before-provider');
          await check(boundActor,q.model);
          if(signal?.aborted||!sameActor(actor,boundActor))fail('selection-stale');
          const inferStart=now();
          const inferred=await infer({body:frozenCopy(parsed.length?attachImages(q.prepared.body,parsed):q.prepared.body),signal});
          const answer=inferred&&{...inferred,_foartProviderMs:Math.max(0,now()-inferStart)};
          if(!answer||answer.model!==q.model)
            throw Object.assign(new Error('provider-model-unconfirmed'),{code:'provider-model-unconfirmed',providerMayHaveCharged:true});
          if(!answer.usage||typeof answer.usage!=='object'||!Object.keys(answer.usage).length)
            throw Object.assign(new Error('provider-usage-unconfirmed'),{code:'provider-usage-unconfirmed',providerMayHaveCharged:true});
          const decision=await assessUsage({model:q.model,stage:q.stage,usage:answer.usage,pricingVersion:q.pricingVersion});
          if(!decision||decision.pricingVersion!==q.pricingVersion||decision.usageMissing!==false||!Number.isSafeInteger(decision.credits)||decision.credits<0||
            !Number.isFinite(decision.usdCost)||decision.usdCost<0||(decision.credits===0&&decision.usdCost!==0))
            throw Object.assign(new Error('provider-usage-unconfirmed'),{code:'provider-usage-unconfirmed',providerMayHaveCharged:true});
          return {answer,decision};
        }});} catch(error) {
          // Only a trusted, confirmed cancellation receipt may cross this
          // boundary. Unknown reservations remain pending and are rethrown.
          if(!useV3||!error?.receipt)throw error;
          const settlement=v3Settlement(q.requestId,error.receipt,'cancel');
          let current=false;try{current=sameActor(actor,boundActor)&&await isCurrent(boundActor,q.model)===true;}catch{}
          if(!current)fail('selection-stale');
          return {ok:false,errorCode:'cancelled-before-dispatch',settlement};
        }
      if(useV3){
        if(result?.status!=='recorded'||result.requestHash!==q.requestHash||result.pricingVersion!==q.pricingVersion||result.model!==q.model||
          result.response?.model!==q.model||result.decision?.pricingVersion!==q.pricingVersion||result.decision?.usageMissing!==false)fail('billing-unconfirmed');
        const identity=opIdentity(boundActor,q.model,q.pricingVersion,q.operation);
        const finish=async outcome=>{
          const receipt=await operationV3.ports.finalize({...identity,outcome});
          return v3Settlement(q.requestId,receipt,outcome);
        };
        const sessionFresh=async()=>{try{return sameActor(actor,boundActor)&&await isCurrent(boundActor,q.model)===true;}catch{return false;}};
        const cancel=async(errorCode,validationIssue)=>{const settlement=await finish('cancel');if(!await sessionFresh())fail('selection-stale');return {ok:false,errorCode,settlement,...(validationIssue?{validationIssue:String(validationIssue).slice(0,200)}:{})};};
        const fresh=async()=>!signal?.aborted&&await sessionFresh();
        if(!await fresh())return cancel('cancelled-after-dispatch');
        if(result.response?.status!=='completed'||result.response?.finish_reason!=='stop'||!Array.isArray(result.response?.output)||
          result.response.output.some(item=>item?.type==='function_call'))return cancel('provider-incomplete');
        if(q.stage==='structure'){
          if(q.prepared.kind==='qwen21-native'){
            let compiled;const validationStart=now();
            try{compiled=compileQwen21NativeRewrite(result.response,validatedPrepared,compiler.validateQwen21NativePreservation);}
            catch(error){return cancel('structure-invalid',error?.message);}
            const validationMs=Math.max(0,now()-validationStart);
            const parentHash=hash({actor:boundActor,model:q.model,operation:q.operation,structureHash:q.requestHash,...compiled});
            checkStatus(await operationV3.ports.acceptArtStructure({...identity,structureHash:q.requestHash,parentHash}),'accepted');
            if(!await fresh())return cancel('cancelled-after-dispatch');
            const settlement=await finish('success');
            if(settlement.uncollectedCredits)return {ok:false,errorCode:'billing-mismatch',settlement};
            if(!await sessionFresh())fail('selection-stale');
            if(signal?.aborted)return {ok:false,errorCode:'cancelled-after-settlement',settlement};
            return {ok:true,stage:'structure',settlement,releaseEligible:true,reviewRequired:true,...compiled,
              timings:{providerMs:result.response._foartProviderMs,validationMs}};
          }
          let compiled;try{compiled=compiler.grokResponsesPublicResult(result.response,q.prepared.options);}catch(error){return cancel('structure-invalid',error?.message);}
          if(q.prepared.kind==='gpt-image-2.5'){
            if(typeof compiled.output_text!=='string'||!compiled.output_text.trim()||compiled.has_negative_prompt===true)return cancel('structure-invalid');
            const parentHash=hash({actor:boundActor,model:q.model,operation:q.operation,structureHash:q.requestHash,display:compiled.output_text});
            checkStatus(await operationV3.ports.acceptArtStructure({...identity,structureHash:q.requestHash,parentHash}),'accepted');
            if(!await fresh())return cancel('cancelled-after-dispatch');
            const settlement=await finish('success');
            if(settlement.uncollectedCredits)return {ok:false,errorCode:'billing-mismatch',settlement};
            if(!await sessionFresh())fail('selection-stale');
            if(signal?.aborted)return {ok:false,errorCode:'cancelled-after-settlement',settlement};
            return {ok:true,stage:'structure',settlement,releaseEligible:true,reviewRequired:true,targetEngine:'gpt-image-2.5',
              promptContract:'gpt-image-semantic-fusion-v1',displayPrompt:compiled.output_text,modelPrompt:compiled.output_text};
          }
          if(compiled.editContract!=='structured-recompile-v1'||compiled.promptSchema!=='nf.art.prompt.v1'||
            typeof compiled.output_text!=='string'||!compiled.output_text.trim())return cancel('structure-invalid');
          const parent={v:VERSION,kind:'validated-structure',actor:boundActor,model:q.model,display:compiled.output_text,
            negativePrompt:compiled.negative_prompt,hasNegativePrompt:compiled.has_negative_prompt,editContract:compiled.editContract,
            promptSchema:compiled.promptSchema,modelPromptPolicy:'qwen21-task-policy-v1',parentRequestId:q.requestId,
            operation:q.operation,pricingVersion:q.pricingVersion};
          const parentHash=hash(parent);
          checkStatus(await operationV3.ports.acceptArtStructure({...identity,structureHash:q.requestHash,parentHash}),'accepted');
          if(!await fresh())return cancel('cancelled-after-dispatch');
          return {ok:true,stage:'structure',settlement:{requestId:q.requestId,status:'pending'},stageToken:signer.sign({...parent,parentHash,expiresAt:now()+5*60*1000})};
        }
        if(q.stage!=='english'||!q.parent||q.parent.kind!=='validated-structure'||q.parent.pricingVersion!==q.pricingVersion||
          q.parent.editContract!=='structured-recompile-v1'||q.parent.promptSchema!=='nf.art.prompt.v1'||q.parent.modelPromptPolicy!=='qwen21-task-policy-v1')return cancel('invalid-stage');
        let modelPrompt;try{modelPrompt=validateEnglish(q.prepared.display,result.response.output_text);}catch{return cancel('english-invalid');}
        checkStatus(await operationV3.ports.acceptArtEnglish({...identity,parentHash:q.parent.parentHash,englishHash:q.requestHash}),'accepted');
        if(!await fresh())return cancel('cancelled-after-dispatch');
        const settlement=await finish('success');
        if(settlement.uncollectedCredits)return {ok:false,errorCode:'billing-mismatch',settlement};
        if(!await sessionFresh())fail('selection-stale');
        if(signal?.aborted)return {ok:false,errorCode:'cancelled-after-settlement',settlement};
        return {ok:true,stage:'english',settlement,releaseEligible:true,reviewRequired:true,
          translationValidation:'structure-and-literals',editContract:q.parent.editContract,promptSchema:q.parent.promptSchema,
          modelPromptPolicy:q.parent.modelPromptPolicy,displayPrompt:q.parent.display,modelPrompt,modelPromptLanguage:'en',
          ...(q.parent.hasNegativePrompt===true?{negativePrompt:q.parent.negativePrompt,hasNegativePrompt:true}:{})};
      }
      if(result?.status!=='settled'||!Number.isSafeInteger(result.settledCredits)||result.settledCredits<0)fail('billing-unconfirmed');
      const settlement={requestId:q.requestId,settledCredits:result.settledCredits,
        ...(result.decision?.pricingSource==='token_rate_estimate' ? {pricingSource:'token_rate_estimate',
          cacheKnown:result.decision?.tokenRateEstimate?.cacheKnown===true} : {}),
        ...(result.balanceShort===true?{balanceShort:true}:{}),
        ...(Number.isFinite(result.uncollectedCredits)&&result.uncollectedCredits>0?{uncollectedCredits:result.uncollectedCredits}:{})};
      if(result.settledCredits!==result.decision?.credits||result.decision?.usageMissing!==false||
        result.requestHash!==q.requestHash||result.pricingVersion!==q.pricingVersion||result.model!==q.model||
        result.response?.model!==q.model||result.decision?.pricingVersion!==q.pricingVersion||
        result.balanceShort===true||Number(result.uncollectedCredits)>0)
        return {ok:false,errorCode:'billing-mismatch',settlement};
      const stillCurrent=await isCurrent(boundActor,q.model);
      if(signal?.aborted||!sameActor(actor,boundActor)||stillCurrent!==true)return {ok:false,errorCode:'cancelled-after-settlement',settlement};
      if(result.response?.status!=='completed'||result.response?.finish_reason!=='stop'||
        !Array.isArray(result.response?.output)||result.response.output.some(item=>item?.type==='function_call'))
        return {ok:false,errorCode:'provider-incomplete',settlement};
      if(q.stage==='structure'){
        let compiled;
        try {compiled=compiler.grokResponsesPublicResult(result.response,q.prepared.options);}
        catch {return {ok:false,errorCode:'structure-invalid',settlement};}
        if(q.prepared.kind==='gpt-image-2.5'){
          if(typeof compiled.output_text!=='string'||!compiled.output_text.trim()||compiled.has_negative_prompt===true)
            return {ok:false,errorCode:'structure-invalid',settlement};
          return {ok:true,stage:'structure',settlement,releaseEligible:true,reviewRequired:true,
            targetEngine:'gpt-image-2.5',promptContract:'gpt-image-semantic-fusion-v1',
            displayPrompt:compiled.output_text,modelPrompt:compiled.output_text};
        }
        if(compiled.editContract!=='structured-recompile-v1'||compiled.promptSchema!=='nf.art.prompt.v1')
          return {ok:false,errorCode:'structure-invalid',settlement};
        const data={v:VERSION,kind:'validated-structure',actor:boundActor,model:q.model,display:compiled.output_text,
          negativePrompt:compiled.negative_prompt,hasNegativePrompt:compiled.has_negative_prompt,
          editContract:compiled.editContract,promptSchema:compiled.promptSchema,modelPromptPolicy:'qwen21-task-policy-v1',
          parentRequestId:q.requestId,expiresAt:now()+5*60*1000};
        return {ok:true,stage:'structure',settlement,stageToken:signer.sign(data)};
      }
      if(q.stage!=='english'||!q.parent||q.parent.kind!=='validated-structure')fail('invalid-stage');
      let modelPrompt;
      try {modelPrompt=validateEnglish(q.prepared.display,result.response.output_text);}
      catch {return {ok:false,errorCode:'english-invalid',settlement};}
      if(q.parent.editContract!=='structured-recompile-v1'||q.parent.promptSchema!=='nf.art.prompt.v1'||
        q.parent.modelPromptPolicy!=='qwen21-task-policy-v1')fail('invalid-stage');
      // The labels come from the trusted compiler and applied policy, never
      // from model output. Translation checks do not prove semantic accuracy.
      return {ok:true,stage:'english',settlement,releaseEligible:true,reviewRequired:true,
        translationValidation:'structure-and-literals',editContract:q.parent.editContract,promptSchema:q.parent.promptSchema,
        modelPromptPolicy:q.parent.modelPromptPolicy,displayPrompt:q.parent.display,modelPrompt,modelPromptLanguage:'en',
        ...(q.parent.hasNegativePrompt===true?{negativePrompt:q.parent.negativePrompt,hasNegativePrompt:true}:{})};
    }
  };
}

// The live entry deliberately never supplies accountingReady:true until v2
// persists a dispatched/unknown outcome and binds the signed request terms.
// The true branch is exercised only with non-billing injected test ports.
export async function createCompanionArtBusiness({enabled=false,accountingReady=false,provider,charge,compiler,policyFor,secret,isCurrent,fetchImpl=fetch,operationV3=null}={}) {
  if(enabled!==true||accountingReady!==true) {
    const unavailable=()=>{throw Object.assign(new Error('在线美工尚未安全开通，本次没有提交或扣费。'),{status:503,code:'art-business-unavailable'});};
    return {quote:unavailable,execute:unavailable,cancel:unavailable};
  }
  if(!provider?.apiKey||provider.pricingSnapshotReady!==true||typeof charge!=='function'||typeof isCurrent!=='function')fail('accounting-unavailable');
  const snapshot=await companionPricingPolicy(provider);
  const models=snapshot.models.filter(row=>row.available&&['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash'].includes(row.id)).map(row=>row.id);
  if(!models.length)fail('model-unavailable');
  const phases=createTrustedArtPhases({secret,models,visionModels:models.filter(id=>operationV3?.enabled===true
      ?snapshot.config?.xiaotao_online?.operation_art_v3===true&&snapshot.config?.xiaotao_online?.operation_vision_chat_v3===true&&hasXiaotaoDecimalV1(snapshot.config)&&['xai/grok-4.7','openai/gpt-6.1-sol-saver','deepseek/deepseek-v4.1-flash'].includes(id)
      :['xai/grok-4.7','openai/gpt-6.1-sol-saver'].includes(id)),compiler,policyFor,isCurrent,operationV3,pricingConfig:snapshot.config,
    quote:async({model,body,imageCount})=>{
      const text=body.input.filter(row=>row.role==='user').flatMap(row=>row.content||[]).map(part=>part.text||'').join('\n');
      const system=body.input.filter(row=>row.role==='system').flatMap(row=>row.content||[]).map(part=>part.text||'').join('\n')
        +'\n'+JSON.stringify(body.text||{});
      const estimateConfig=operationV3?.enabled===true?snapshot.config:provider.creditConfig;
      const estimate=estimateXiaotaoOnlineCredits({text,system,history:'',files:Array.from({length:imageCount||0},()=>({kind:'image'})),outputTokens:body.max_output_tokens,config:estimateConfig,model,
        ...(operationV3?.enabled===true&&hasXiaotaoDecimalV1(estimateConfig)?{amountPolicy:'decimal-v1'}:{})});
      return {pricingVersion:snapshot.version,estimatedCredits:estimate.credits};
    },
    assessUsage:async({model,usage,pricingVersion})=>{
      // Only this guarded path opts into raw provider counter validation. Money
      // fields have no verified currency contract; use the shared model-rate
      // policy instead, retaining its explicit cache-unknown estimate.
      if(pricingVersion!==snapshot.version || usage?.billing_token_usage_invalid!==false)return null;
      const {thirdPartyConsumeMoney,consumeMoney,...tokenUsage}=usage;
      const decision=settleXiaotaoOnlineCredits({usage:tokenUsage,model,config:provider.creditConfig});
      if(decision.pricingSource!=='token_rate_estimate')return null;
      return {...decision,pricingVersion};
    },
    infer:async({body,signal})=>{
      const posted=await postRunningHubResponses({body,config:{apiKey:provider.apiKey,baseUrl:provider.baseUrl,model:body.model},
        fetchImpl,timeoutMs:60000,maxRetries:0,signal,includeBillingIntegrity:true});
      return posted.data;
    },
    executeAtomic:async({userId,sessionId,usageKey,model,stage,imageCount,requestHash,pricingVersion,estimatedCredits,run})=>{
      const charged=await charge({userId,feature:imageCount?'xiaotao-vision':'xiaotao-text',amount:1,usageKey,estimatedCredits,
        metadata:{model,art_stage:stage,art_request_hash:requestHash,art_session_id:sessionId,pricing_version:pricingVersion,pricing_policy:snapshot.config},
        run:async({markProviderDispatched})=>{
          const {answer,decision}=await run({markProviderDispatched});
          return {amount:1,response:answer,decision,settledCredits:decision.credits,rhCostUsd:decision.usdCost,
            pricingSource:decision.pricingSource,metadata:{model,art_stage:stage,art_request_hash:requestHash,art_session_id:sessionId,usage:answer.usage}};
        }});
      return {status:charged.quota?.status,settledCredits:charged.quota?.settled_credits,
        balanceShort:charged.quota?.balance_short,uncollectedCredits:charged.quota?.uncollected_credits,
        response:charged.response,decision:charged.decision,requestHash,pricingVersion,model};
    }});
  const actor=(user,sessionId,payload)=>({userId:String(user?.id||''),sessionId:String(sessionId||''),epoch:payload?.epoch});
  return {
    quote:({user,sessionId,payload})=>payload?.stage==='structure'
      ? phases.quoteStructure({actor:actor(user,sessionId,payload),model:payload.modelId,input:payload.input,intentId:payload.intentId,images:payload.images})
      : payload?.stage==='english'
        ? phases.quoteEnglish({actor:actor(user,sessionId,payload),stageToken:payload.stageToken})
        : fail('invalid-stage'),
    execute:({user,sessionId,payload,signal})=>phases.submit({actor:actor(user,sessionId,payload),quoteToken:payload?.quoteToken,images:payload?.images,signal}),
    cancel:({user,sessionId,payload})=>phases.cancelPending({actor:actor(user,sessionId,payload),stageToken:payload?.stageToken})
  };
}

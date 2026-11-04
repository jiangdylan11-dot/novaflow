// Default-closed UI draft compiler. It has no provider, ledger or UI side
// effects. Callers must authenticate the actor, use the selected-model V3
// ticket and settle trusted provider usage before returning any draft.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {isXiaotaoCreditAmount} from './xiaotao-decimal-usage.mjs';
import {assistant as trustedAssistant,pipeline as trustedPipeline,sourceHashes as trustedSourceHashes} from './xiaotao-ui-professional.generated.mjs';
import {XIAOTAO_ONLINE_MODEL_IDS} from './xiaotao-online-models.mjs';

export const UI_DRAFT_OUTPUT_TOKENS=2048;
const UI_OUTPUT_FRAME='Return exactly one JSON object with fields prompt, negativePrompt and uiPlan. Both prompt fields must be strings; preserve every __NOVAFLOW_UI_REFERENCE_...__ placeholder exactly once in its own corresponding field.\nuiPlan must contain version:1, layoutMode (preserve, partial or reflow), layoutReference (the 1-based layout anchor), visualMode (style-transfer, theme-redesign, partial or create), references (one {index,role} for each image), layoutChanges (string array) and preserve (string array). Use only the assigned reference roles. Do not perform or claim any UI action.';
const UI_TEXT_OUTPUT_FRAME='Return exactly one JSON object with fields prompt, negativePrompt and uiPlan. Both prompt fields must be strings. No image was supplied: never claim to have seen one or invent image facts. uiPlan must contain version:1, layoutMode (preserve, partial or reflow), layoutReference:0, visualMode (style-transfer, theme-redesign, partial or create), references:[], layoutChanges (string array) and preserve (string array). Do not perform or claim any UI action.';

const MODELS = new Set(['qwen3.5-9b-heretic',...XIAOTAO_ONLINE_MODEL_IDS]);
const ROLES = new Set(['layout','style','content','asset','combined','color','material','character','subject','reference']);
const FIELDS = new Set(['requestId','revision','prompt','requirements','negativePrompt','generationIntent','preserveLayout','size','structure','references']);
const LIMIT = 20 * 1024 * 1024;
const fail = code => {throw Object.assign(new Error(code),{code});};
const digest = value => createHash('sha256').update(value).digest('hex');
const plain = value => !!value && typeof value==='object' && !Array.isArray(value);
const bounded = (value,max,nonempty=false) => {if(typeof value!=='string'||value.length>max||(nonempty&&!value.trim()))fail('ui-invalid-input');return value;};
const protectMentions=(source,list,label,intentHash,referenceCount)=>source.replace(/(?<!@\u53c2\u8003)(?:\u53c2\u8003\u56fe|\u56fe)\s*([1-9][0-9]*)/g,(token,n,offset,full)=>full.slice(Math.max(0,offset-1),offset)==='@'?token:`@\u53c2\u8003\u56fe${n}`)
  .replace(/@\u53c2\u8003\u56fe([1-9][0-9]*)/g,(_,n)=>{
    if(Number(n)>referenceCount)fail('ui-reference-out-of-range');const placeholder=`__NOVAFLOW_UI_REFERENCE_${intentHash.slice(0,16)}_${label}_${list.length}__`;
    list.push({placeholder,token:`@\u53c2\u8003\u56fe${n}`});return placeholder;
  });
const identity = actor => {
  if(!plain(actor)||typeof actor.userId!=='string'||!actor.userId||actor.userId.length>128||typeof actor.sessionId!=='string'||!actor.sessionId||actor.sessionId.length>128||!Number.isSafeInteger(actor.epoch)||actor.epoch<0)fail('ui-invalid-actor');
  return {userId:actor.userId,sessionId:actor.sessionId,epoch:actor.epoch};
};
const checkedImage = item => {
  if(!plain(item)||Object.keys(item).some(k=>!['id','role','dataUrl','uiLayoutId'].includes(k))||
    typeof item.id!=='string'||!item.id.trim()||item.id.length>128||/[\u0000-\u001f\u007f]/.test(item.id)||!ROLES.has(item.role)||
    (item.uiLayoutId!==undefined&&(typeof item.uiLayoutId!=='string'||!item.uiLayoutId||item.uiLayoutId.length>128))||typeof item.dataUrl!=='string')fail('ui-invalid-reference');
  const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.dataUrl);
  if(!m||m[2].length%4||m[2].length>Math.ceil(LIMIT/3)*4)fail('ui-invalid-reference');
  const bytes=Buffer.from(m[2],'base64');if(bytes.toString('base64')!==m[2])fail('ui-invalid-reference');
  const png=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!(m[1]==='png'?png:m[1]==='jpeg'?jpeg:webp))fail('ui-invalid-reference');
  return {id:item.id,role:item.role,...(item.uiLayoutId?{uiLayoutId:item.uiLayoutId}:{}),mime:'image/'+m[1],bytes:bytes.length,sha256:digest(bytes),dataUrl:item.dataUrl};
};

// maxReferences matches the existing V3 vision transport, not the older UI
// workflow. Reject explicitly rather than silently drop or shrink references.
export function createUiIntentPrototype({assistant,pipeline,isCurrent,verifyReceipt,maxReferences=3}={}) {
  if(typeof assistant?.structureSnapshot!=='function'||typeof assistant?.buildRequirements!=='function'||typeof assistant?.restoreText!=='function'||
    typeof pipeline?.requireLayoutReferences!=='function'||typeof pipeline?.normalizeQwenPlan!=='function'||typeof isCurrent!=='function'||typeof verifyReceipt!=='function'||
    !Number.isSafeInteger(maxReferences)||maxReferences<1||maxReferences>3)fail('ui-compiler-unavailable');
  async function prepare({actor,model,request,signal}) {
    const who=identity(actor);
    if(signal?.aborted)fail('ui-cancelled');
    try {request=structuredClone(request);} catch {fail('ui-invalid-input');}
    if(!MODELS.has(model)||!plain(request)||Object.keys(request).some(k=>!FIELDS.has(k))||
      !/^[A-Za-z0-9_-]{8,128}$/.test(request.requestId||'')||typeof request.revision!=='string'||!request.revision||request.revision.length>512||
      !['redesign','style-transfer','iteration'].includes(request.generationIntent)||typeof request.preserveLayout!=='boolean'||
      !plain(request.size)||Object.keys(request.size).some(k=>!['width','height'].includes(k))||
      ![request.size.width,request.size.height].every(v=>Number.isSafeInteger(v)&&v>=1&&v<=16384)||
      !plain(request.structure)||!Array.isArray(request.references))fail('ui-invalid-input');
    if(await isCurrent({actor:who,model,revision:request.revision})!==true)fail('ui-selection-stale');if(signal?.aborted)fail('ui-cancelled');
    if(request.references.length>maxReferences)fail('ui-reference-limit-unavailable');
    const structureBytes=Buffer.byteLength(JSON.stringify(request.structure),'utf8');
    if(structureBytes>12000||(['regions','blocks'].some(k=>Array.isArray(request.structure[k])&&request.structure[k].length>128)))fail('ui-structure-limit');
    const prompt=bounded(request.prompt,18000,true),requirements=bounded(request.requirements??'',4000),negativePrompt=bounded(request.negativePrompt??'',10000);
    if([prompt,requirements,negativePrompt].some(x=>x.includes('__NOVAFLOW_UI_REFERENCE_')))fail('ui-placeholder-collision');
    const refs=request.references.map(checkedImage);if(refs.reduce((n,r)=>n+r.bytes,0)>LIMIT)fail('ui-reference-byte-limit');
    if(new Set(refs.map(r=>r.id)).size!==refs.length||refs.filter(r=>r.uiLayoutId).length>1)fail('ui-ambiguous-reference');
    for(const match of requirements.matchAll(/(?:@?\u53c2\u8003\u56fe|\u56fe)\s*([1-9][0-9]*)/g))if(Number(match[1])>refs.length)fail('ui-reference-out-of-range');
    const textOnly=refs.length===0;
    const effective=textOnly?[]:pipeline.requireLayoutReferences(refs.map(({id,role,uiLayoutId})=>({id,role,...(uiLayoutId?{uiLayoutId}:{})})));
    const anchor=textOnly?-1:effective.findIndex(r=>r.role==='layout');if(!textOnly&&anchor<0)fail('ui-layout-missing');
    const structure=assistant.structureSnapshot(request.structure);
    const options={prompt,requirements,generationIntent:request.generationIntent,preserveLayout:request.preserveLayout,size:request.size};
    // Use the unchanged project UI rules; the input role manifest is preserved
    // separately because the old pipeline rewrites an anchor combined->layout.
    if(textOnly&&typeof assistant.buildTextOnlyRequirements!=='function')fail('ui-compiler-unavailable');
    const rules=textOnly?assistant.buildTextOnlyRequirements(options,structure):assistant.buildRequirements(options,structure,refs);
    const manifest=refs.map(({id,role,uiLayoutId,mime,bytes,sha256},index)=>({index:index+1,id,role,...(uiLayoutId?{uiLayoutId}:{}),mime,bytes,sha256}));
    const outputFrame=textOnly?UI_TEXT_OUTPUT_FRAME:UI_OUTPUT_FRAME;
    const system=(textOnly?[rules,outputFrame]:[rules,`Reference roles are assigned by the user and cannot be changed. Image ${anchor+1} is the only layout authority.`,
      ...manifest.map(m=>`Image ${m.index} has original user role ${m.role}${m.index===anchor+1?' and is the layout anchor':''}.`),outputFrame]).join('\n');
    const canonical={schema:'nf.xiaotao.operation.ui-draft.v1',compilerSources:trustedSourceHashes,systemHash:digest(system),outputFrameHash:digest(outputFrame),outputTokens:UI_DRAFT_OUTPUT_TOKENS,actor:who,model,requestId:request.requestId,revision:request.revision,prompt,requirements,negativePrompt,
      generationIntent:request.generationIntent,preserveLayout:request.preserveLayout,size:request.size,structure,anchor:anchor+1,manifest};
    const intentHash=digest(JSON.stringify(canonical));
    const markers=[],negativeMarkers=[];
    const protectedPrompt=protectMentions(prompt,markers,'p',intentHash,refs.length),protectedNegative=protectMentions(negativePrompt,negativeMarkers,'n',intentHash,refs.length);
    const user=[{type:'input_text',text:`Current prompt: ${protectedPrompt}\nNegative constraints: ${protectedNegative}`},...refs.flatMap((r,i)=>[{type:'input_text',text:`Image ${i+1}; user role ${r.role}.`},{type:'input_image',image_url:r.dataUrl}])];
    if(await isCurrent({actor:who,model,revision:request.revision})!==true)fail('ui-selection-stale');if(signal?.aborted)fail('ui-cancelled');
    return {model,intentHash,canonical,markers,negativeMarkers,system,input:[{role:'system',content:[{type:'input_text',text:system}]},{role:'user',content:user}],
      // Internal-only raw refs required for the existing validator. They must
      // never be included in a DB row, log, public policy or error message.
      internalRefs:refs,effectiveRefs:effective};
  }
  async function inspect({prepared,current,reply,negativeReply,plan,signal}) {
    if(signal?.aborted)fail('ui-cancelled');
    if(!plain(prepared)||!plain(prepared.canonical)||digest(JSON.stringify(prepared.canonical))!==prepared.intentHash||!plain(current)||JSON.stringify(identity(current.actor))!==JSON.stringify(prepared.canonical.actor)||
      current.model!==prepared.canonical.model||current.revision!==prepared.canonical.revision||current.intentHash!==prepared.intentHash)fail('ui-selection-stale');
    if(await isCurrent({actor:prepared.canonical.actor,model:prepared.canonical.model,revision:prepared.canonical.revision})!==true)fail('ui-selection-stale');if(signal?.aborted)fail('ui-cancelled');
    if(typeof reply!=='string'||!reply.trim()||reply.length>30000)fail('ui-invalid-result');
    const expectedMarkers=[],expectedNegative=[];
    protectMentions(prepared.canonical.prompt,expectedMarkers,'p',prepared.intentHash,prepared.canonical.manifest.length);
    protectMentions(prepared.canonical.negativePrompt,expectedNegative,'n',prepared.intentHash,prepared.canonical.manifest.length);
    const restored=assistant.restoreText(reply,{tokens:expectedMarkers});if(!restored?.ok||/__NOVAFLOW_UI_REFERENCE_/.test(restored.text))fail('ui-reference-restoration-failed');
    if(prepared.canonical.negativePrompt && (typeof negativeReply!=='string'||!negativeReply.trim()||negativeReply.length>15000))fail('ui-negative-constraints-missing');
    const restoredNegative=assistant.restoreText(negativeReply||'',{tokens:expectedNegative});
    if(!restoredNegative?.ok||/__NOVAFLOW_UI_REFERENCE_/.test(restoredNegative.text))fail('ui-reference-restoration-failed');
    for(const text of [restored.text,restoredNegative.text])for(const match of text.matchAll(/(?:@?\u53c2\u8003\u56fe|\u56fe)\s*([1-9][0-9]*)/g))
      if(Number(match[1])>prepared.canonical.manifest.length)fail('ui-reference-out-of-range');
    const trustedRefs=prepared.canonical.manifest.map(({id,role,uiLayoutId})=>({id,role,...(uiLayoutId?{uiLayoutId}:{})}));
    let checked;
    if(trustedRefs.length===0){
      const claimedVision=/(?:根据|按照|基于|如|从|看到|显示在).{0,8}(?:参考图|布局图|图片|截图|图像)|(?:参考图|布局图|图片|截图|图像)(?:中|上|里|所示).{0,12}(?:显示|可见|有|是)|(?:as shown|seen|depicted|visible)\s+in\s+(?:the|this)\s+(?:image|photo|picture|screenshot)/iu;
      if(claimedVision.test(restored.text)||claimedVision.test(restoredNegative.text))fail('ui-unprovided-image-claim');
      if(!plain(plan)||Object.keys(plan).some(k=>!['version','layoutMode','layoutReference','visualMode','references','layoutChanges','preserve'].includes(k))||
        plan.version!==1||!['preserve','partial','reflow'].includes(plan.layoutMode)||plan.layoutReference!==0||
        !['style-transfer','theme-redesign','partial','create'].includes(plan.visualMode)||!Array.isArray(plan.references)||plan.references.length!==0||
        ['layoutChanges','preserve'].some(k=>!Array.isArray(plan[k])||plan[k].length>30||plan[k].some(v=>typeof v!=='string'||!v.trim()||v.length>800)))fail('ui-invalid-result');
      checked={version:1,layoutMode:plan.layoutMode,layoutReference:0,visualMode:plan.visualMode,references:[],layoutChanges:plan.layoutChanges.map(v=>v.trim()),preserve:plan.preserve.map(v=>v.trim())};
    } else {
      const input={references:pipeline.requireLayoutReferences(trustedRefs),prompt:prepared.canonical.prompt,preserveLayout:prepared.canonical.preserveLayout,generationIntent:prepared.canonical.generationIntent};
      checked=pipeline.normalizeQwenPlan(plan,input);if(checked.layoutReference!==prepared.canonical.anchor)fail('ui-layout-changed');
    }
    if(await isCurrent({actor:prepared.canonical.actor,model:prepared.canonical.model,revision:prepared.canonical.revision})!==true)fail('ui-selection-stale');if(signal?.aborted)fail('ui-cancelled');
    // No apply or undo is implemented: existing UI dialog writes immediately.
    // Combined/asset role degradation in the downstream generator is an
    // outstanding blocker; a successful draft is not approval to apply it.
    return {status:'preview-only',prompt:restored.text,negativePrompt:restoredNegative.text,originalConstraints:{prompt:prepared.canonical.prompt,negativePrompt:prepared.canonical.negativePrompt,requirements:prepared.canonical.requirements},plan:checked,sourceManifest:prepared.canonical.manifest,layoutAnchor:prepared.canonical.anchor,
      applyAvailable:false,reason:'ui-confirm-undo-and-role-mapping-not-integrated'};
  }
  async function draft(args) {
    if(!plain(args?.prepared?.canonical))fail('ui-selection-stale');
    if(args.prepared.canonical.model!=='qwen3.5-9b-heretic') {
      const verified=await verifyReceipt(args.receipt,{actor:args.prepared.canonical.actor,model:args.prepared.canonical.model,intentHash:args.prepared.intentHash});
      // Only the verified receipt can attest to its frozen amount policy.
      // Missing markers retain the old integer rule; partial/contradictory
      // markers must not be inferred from the current model configuration.
      const online={};
      for(const key of ['credit_amount_policy','credit_precision','credit_rounding','minimum_positive_credits'])
        if(verified && Object.hasOwn(verified,key))online[key]=verified[key];
      if(verified?.status!=='settled'||!isXiaotaoCreditAmount(verified.charged,{xiaotao_online:online},{allowZero:true,max:14000000}))fail('ui-billing-unconfirmed');
    }
    return inspect(args);
  }
  return Object.freeze({prepare,inspect,draft});
}

// The authenticated server supplies actor/model/session freshness. The client
// supplies the immutable snapshot including its selection epoch and revision;
// the signed operation hash binds both, while the UI must re-check them before
// showing a draft. Raw image bytes never belong in the ledger or policy.
export async function canonicalizeXiaotaoV3UiIntent(input,{actor,model,isCurrent}={}) {
  if(!plain(input)||Object.keys(input).some(k=>!['mode','epoch','request'].includes(k))||input.mode!=='ui-draft'||
    !Number.isSafeInteger(input.epoch)||input.epoch<0||typeof isCurrent!=='function'||!plain(actor))fail('ui-invalid-input');
  const uiActor={userId:actor.userId,sessionId:actor.sessionId,epoch:input.epoch};
  const adapter=createUiIntentPrototype({assistant:trustedAssistant,pipeline:trustedPipeline,
    isCurrent:async()=>await isCurrent(actor)===true,verifyReceipt:async()=>({status:'unverified'})});
  const prepared=await adapter.prepare({actor:uiActor,model,request:input.request});
  const userText=prepared.input[1].content.filter(x=>x.type==='input_text').map(x=>x.text).join('\n');
  return {intent:{mode:'ui-draft',epoch:input.epoch,request:input.request},intentHash:prepared.intentHash,uiPrepared:prepared,uiAdapter:adapter,
    compiled:{input:prepared.input,imageCount:prepared.canonical.manifest.length,textOnly:prepared.canonical.manifest.length===0,systemText:prepared.system,userText,outputTokens:UI_DRAFT_OUTPUT_TOKENS}};
}

export async function inspectXiaotaoV3UiReply({uiPrepared,uiAdapter,reply,signal}={}) {
  let parsed;try {parsed=JSON.parse(reply);} catch {fail('ui-invalid-result');}
  if(!plain(parsed)||Object.keys(parsed).some(k=>!['prompt','negativePrompt','uiPlan'].includes(k))||
    typeof parsed.prompt!=='string'||typeof parsed.negativePrompt!=='string'||!plain(parsed.uiPlan))fail('ui-invalid-result');
  const canonical=uiPrepared?.canonical;
  return uiAdapter.inspect({prepared:uiPrepared,current:{actor:canonical?.actor,model:canonical?.model,revision:canonical?.revision,intentHash:uiPrepared?.intentHash},
    reply:parsed.prompt,negativeReply:parsed.negativePrompt,plan:parsed.uiPlan,signal});
}

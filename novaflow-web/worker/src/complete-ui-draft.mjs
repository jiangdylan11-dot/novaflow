import { randomUUID, createHash } from 'node:crypto';
import { UI_CATALOG_MODEL, buildUiCatalogGraph, parseCatalogFields } from './ui-catalog-planner.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
export const NATURAL_DRAFT_METHOD = 'complete-natural-reference-v1';

// Keep the accepted PE design task and its theme/style slots. Do not replace
// its identity and per-cell design instruction with a generic summary request.
export function naturalDraftDesignInput(request, projection) {
  const clauses=String(request).split(/[，,。；;\n]+/).map(x=>x.trim()).filter(Boolean);
  const clean=x=>x.replace(/^\s*(?:请|帮我|帮忙|再)?\s*(?:做一个|制作一个|创作一个|设计一个|换成|改为|改成|创作|设计|制作|做)\s*/,'').trim();
  const themeClause=clauses.find(x=>/主题|题材/.test(x)&&!/^不要|^不做|^禁止/.test(x));
  const theme=themeClause?clean(themeClause.split(/主题|题材/)[0]).replace(/^(?:以|采用)/,'').trim():String(request);
  const styleClause=clauses.find(x=>/风格|美术/.test(x)&&!/^不要|^不做|^禁止/.test(x));
  const style=styleClause?clean(styleClause).replace(/^采用/,'').trim():'手绘厚涂游戏美术';
  const system='本组主题：'+theme+'。指定画风：'+style+(/手绘厚涂/.test(style)?'，可辨而有秩序的笔触、边缘虚实和绘画色块，体积与材料通过手绘明暗组织。':'。')+'\n'+DESIGN_SYSTEM_BODY+'\n用户主题可能是作品或角色名。必须按该名称的通行语义落实主题；具体角色或作品名保留其明确的身份与物种，不能拆字联想成另一题材，不能另造一个同名但无关的角色。自主选择物种与身份只适用于用户未指定的角色，用户明确的角色身份、作品与画风要求优先。';
  const simpleTheme=themeClause&&/^(?:的)?(?:手机)?(?:老虎机|游戏|游戏UI|UI|界面|游戏界面)?$/.test(themeClause.split(/主题|题材/).slice(1).join(''));
  const remaining=clauses.filter(x=>(x!==themeClause||!simpleTheme)&&x!==styleClause&&!/^@?(?:参考|保持|保留|沿用)\s*@?(?:参考图|图)?[0-9]*\s*(?:的|参考)?\s*(?:布局|排版)$/.test(x));
  // Avoid restating the complete brief in a new competing task. Keep every
  // additional constraint; the full original is retained in the audit result.
  const context={task:'根据本轮独立UI参考的新鲜自然语言结构，创作完整'+theme+'主题游戏美术。新人物的物种、身份与造型以及新物件均由你自主设计，没有人工逐格目标名单；每对头像/格外全身共享各自一个身份锚点，保持区域与识别到的业务字面，直接描述成品。',theme,style_request:style,mode:'coarse_layout_free_icon_art',original_repeat_topology_preserved:false,layout_zh:projection.design_layout_zh,recognition_uncertainty:projection.warnings.join('；'),...(remaining.length?{user_requirements:remaining.join('；')}:{})};
  return {system,context};
}

export function buildNaturalDraftGraph({ system, user, image, design = false }) {
  const graph = { '1': { class_type:'CLIPLoader', inputs:{ clip_name:UI_CATALOG_MODEL, type:'qwen_image', device:'default' } } };
  if (image) graph['10'] = { class_type:'LoadImage', inputs:{ image } };
  graph['3'] = { class_type:'TextGenerate', inputs:{
    clip:['1',0], system_prompt:'',
    prompt:'<|im_start|>system\n'+system+'<|im_end|>\n<|im_start|>user\n'+(image?'<|vision_start|><|image_pad|><|vision_end|>':'')+user+'<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'+(design?' {"rewritten_prompt":"'.trimStart():''),
    max_length:design?3072:768, sampling_mode:'on', thinking:false, use_default_template:false, mtp:'off',
    'sampling_mode.temperature':1, 'sampling_mode.top_k':20, 'sampling_mode.top_p':.95, 'sampling_mode.min_p':0,
    'sampling_mode.repetition_penalty':1, 'sampling_mode.seed':0, 'sampling_mode.presence_penalty':0,
    ...(image?{image:['10',0]}:{})
  }};
  graph['4'] = { class_type:'PreviewAny', inputs:{ source:['3',0] } };
  graph['5'] = { class_type:'PreviewAny', inputs:{ source:['3',1] } };
  return graph;
}

export function parseNaturalDraft(raw) {
  const original=String(raw||'').trim();
  if (!original || original.includes('</think>')) throw new Error('PE未返回完整设计稿，本次未提交生图');
  const source=original.startsWith('{')?original:'{"rewritten_prompt":"'+original;
  let depth=0, quoted=false, escaped=false;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
    else if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0){
      let object;try{object=JSON.parse(source.slice(0,i+1));}catch{break;}
      if(typeof object.rewritten_prompt!=='string'||!object.rewritten_prompt.trim())break;
      return {prompt:object.rewritten_prompt, extraction:{rawSha256:sha(original), promptSha256:sha(object.rewritten_prompt), suffixQuarantinedChars:source.length-i-1, artWordEdits:0}};
    }
  }
  throw new Error('PE设计稿返回不完整，本次未提交生图');
}

export function parseRepairFields(raw,keys,prefix='') {
  const text=String(raw||''),candidates=[text,...(prefix?['{'+prefix+text]:[])];
  for(const source of candidates){
    for(let start=source.indexOf('{');start>=0;start=source.indexOf('{',start+1)){
      let depth=0,quoted=false,escaped=false;
      for(let i=start;i<source.length;i++){
        const c=source[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
        else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){
          let object;try{object=JSON.parse(source.slice(start,i+1));}catch{break;}
          if(object&&keys.every(k=>Object.hasOwn(object,k)&&typeof object[k]==='string'&&object[k].trim()))return {value:Object.fromEntries(keys.map(k=>[k,object[k]])),proof:{firstCompleteValidObject:true,jsonSpan:[start,i+1],actualRawSha256:sha(text),ignoredFields:Object.keys(object).filter(k=>!keys.includes(k)),artWordEdits:0}};
          break;
        }
      }
    }
  }
  return parseCatalogFields('{'+prefix+text,keys);
}

export async function planNaturalUiDraft({baseUrl,payload,cpu,fetchImpl=fetch,pollMs=1000,timeoutMs=180000}) {
  const base=String(baseUrl).replace(/\/+$/,''),images=payload.images;
  if(payload.uiCatalogResume||payload.uiDraftResume)throw new Error('快速设计请求不接受旧分析答案');
  if(!Array.isArray(images)||!images.length||images.length>10)throw new Error('请提供有效的布局参考图');
  const layouts=images.map((x,i)=>x.role==='layout'?i:-1).filter(i=>i>=0);
  if(layouts.length!==1)throw new Error('快速设计需要一张明确的布局参考图');
  const index=layouts[0],request=String(payload.currentPrompt||'').trim();
  if(!request||request.length>18000)throw new Error('请填写有效的主题与设计要求');
  const ids=[],timings=[];let stage='prepare-reference',dispatchClientId='';
  const json=async(path,init)=>{
    const response=await fetchImpl(base+path,{...init,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('PE本地接口请求失败：HTTP '+response.status);
    return response.json();
  };
  const idle=async()=>{
    const q=await json('/queue');
    if(!Array.isArray(q.queue_running)||!Array.isArray(q.queue_pending))throw new Error('无法确认GPU队列，本次未提交');
    if(q.queue_running.length||q.queue_pending.length)throw new Error('其他任务正在使用GPU，请等待完成；本次未重复提交');
  };
  const execute=async graph=>{
    if(ids.length>=3)throw new Error('完整设计已达到本次有界分析上限，本次未提交生图');
    await idle();dispatchClientId='novaflow-ui-draft-'+randomUUID();const started=Date.now();
    const sent=await json('/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:dispatchClientId,prompt:graph})});
    if(!sent.prompt_id)throw new Error('PE提交状态未确认，请先核对任务；本次不重复提交');
    ids.push(sent.prompt_id);
    while(Date.now()-started<timeoutMs){
      const history=(await json('/history/'+sent.prompt_id))[sent.prompt_id];
      if(history?.status?.status_str==='error')throw new Error('PE分析失败，任务ID：'+sent.prompt_id);
      if(history?.status?.completed){
        const text=history.outputs?.['4']?.text;timings.push({stage,promptId:sent.prompt_id,wallMs:Date.now()-started});
        return Array.isArray(text)?text.join(''):String(text||'');
      }
      await new Promise(resolve=>setTimeout(resolve,pollMs));
    }
    throw new Error('PE等待超时，请核对任务 '+sent.prompt_id+'；勿重复提交');
  };
  try{
    await idle();const available=await json('/object_info/CLIPLoader');
    if(!available.CLIPLoader?.input?.required?.clip_name?.[0]?.includes(UI_CATALOG_MODEL))throw new Error('缺少已验证PE模型，不会下载或更换模型');
    const prepared=await cpu({action:'natural-draft-image',image:images[index]});
    const bytes=Buffer.from(prepared.dataUrl.split(',')[1],'base64'),form=new FormData();
    form.append('image',new Blob([bytes],{type:'image/png'}),'NF_UI_DRAFT_'+randomUUID()+'.png');form.append('overwrite','false');
    const uploaded=await json('/upload/image',{method:'POST',body:form});if(!uploaded.name)throw new Error('布局图上传状态未确认');
    const name=(uploaded.subfolder?uploaded.subfolder+'/':'')+uploaded.name;
    stage='natural-recognition';
    const raw=await execute(buildNaturalDraftGraph({system:RECOGNITION_SYSTEM,user:'观察这张本地原图，仅返回上述五行结构记录。',image:name}));
    stage='neutral-projection';const projection=await cpu({action:'natural-draft-project',raw});
    const job=await cpu({action:'complete-natural-job',projection,request});
    const artNames=[],artRoles=[];
    for(const [i,ref] of images.entries()) {
      if(i===index)continue;
      if(!['style','color','material','content','character_identity','identity'].includes(ref.role))throw new Error('未识别的美术参考职责，本次未丢弃图片或生成');
      const copy=await cpu({action:'natural-draft-image',image:ref});
      const form=new FormData();form.append('image',new Blob([Buffer.from(copy.dataUrl.split(',')[1],'base64')],{type:'image/png'}),'NF_UI_ART_'+randomUUID()+'.png');form.append('overwrite','false');
      const uploaded=await json('/upload/image',{method:'POST',body:form});if(!uploaded.name)throw new Error('美术参考上传状态未确认');
      artNames.push((uploaded.subfolder?uploaded.subfolder+'/':'')+uploaded.name);artRoles.push({art_image_index:artNames.length,original_reference_index:i+1,role:ref.role});
    }
    job.context.art_reference_roles=artRoles;
    stage='single-catalog-design';
    const designRaw=await execute(buildUiCatalogGraph({system:job.systemInstruction,context:job.context,images:artNames,maxLength:3072}));
    const fields=parseCatalogFields(designRaw,job.output_keys);
    let catalog=fields.value,fieldRepair=null;
    const firstAudit=await cpu({action:'inspect-complete-natural',case:job.case,catalog});
    if(!firstAudit.ok){
      const keys=job.output_keys.filter(k=>firstAudit.invalid_fields.includes(k));
      if(!keys.length||keys.length>3)throw new Error('本地分析未能保持组件职责，本次未提交生图；不会扩大重试');
      stage='bounded-field-repair';
      const repairContext={user_request:request,style_context:catalog.ENVIRONMENT_ART,fields_to_write:keys,
        field_roles:Object.fromEntries(keys.map(k=>[k,{source:job.context.carrier_bindings?.[k]||null,violations:firstAudit.errors.filter(e=>e.field===k).map(e=>e.detail)}])),
        actual_auxiliaries:keys.includes('AUXILIARY_ART')?job.context.actual_auxiliaries:undefined};
      // Do not show invalid prose as an example: the observed failure copied it verbatim.
      const repairSystem='只创作所列UI外观字段，每字段约70至110字。只返回顶层JSON字符串字段，不用output_keys等包装，不添加其他字段，不解释。\n按field_roles指定的真实职责设计，名称、造型、固有色和材料由你创作，延续style_context的主题与画风。独立information_display只承载它自己的字面，不能写购买动作、操作按钮、连接长栏或其他区域；共享长栏只有一个购买动作和一个连续信息显示，多个词句印在同一个信息面，不能拆成多个独立显示。文字字面逐字保留。不要重排区域、人物、读数或控件，不新增业务文字。';
      const repairGraph=buildUiCatalogGraph({system:repairSystem,context:repairContext,images:artNames,maxLength:768});
      const firstKey=keys[0],prefix=JSON.stringify(firstKey)+':"';
      repairGraph['3'].inputs.prompt+=prefix;
      const repairedRaw=await execute(repairGraph);
      const repaired=parseRepairFields(repairedRaw,keys,prefix);
      repaired.proof.schemaPrefixOnly=prefix;repaired.proof.actualRawSha256=sha(repairedRaw);
      const unchanged=Object.fromEntries(Object.entries(catalog).filter(([k])=>!keys.includes(k)).map(([k,v])=>[k,sha(v)]));
      catalog={...catalog,...repaired.value};
      const finalAudit=await cpu({action:'inspect-complete-natural',case:job.case,catalog});
      if(!finalAudit.ok)throw new Error('本地分析修正后仍存在组件职责冲突，本次未提交生图；未切换分析来源');
      fieldRepair={attempts:1,keys,promptId:ids.at(-1),sourceErrors:firstAudit.errors,unchangedFieldSha256:unchanged,extraction:repaired.proof};
    }
    stage='compile-catalog';const bound=await cpu({action:'compile-complete-natural',case:job.case,catalog});
    const extracted={prompt:bound.prompt,extraction:{...fields.proof,...bound.proof}};
    return {prompt:extracted.prompt,negativePrompt:'',uiCatalog:{schema:'nf.ui.structure-catalog.v1',recognitionMethod:NATURAL_DRAFT_METHOD,analysisProvider:'local',promptIds:ids,providerCallCount:ids.length,timings,projection,fieldRepair,catalogAudit:bound.catalogAudit,compileProof:bound.proof,promptSha256:sha(extracted.prompt)},uiDraft:{method:NATURAL_DRAFT_METHOD,model:UI_CATALOG_MODEL,originalRequirements:request,promptIds:ids,providerCallCount:ids.length,timings,recognitionChars:raw.length,designChars:extracted.prompt.length,projection,source:{index:index+1,role:'layout',...prepared.proof},extraction:extracted.extraction,promptSha256:sha(extracted.prompt)},
      uiPlan:{version:1,layoutMode:'preserve',layoutReference:index+1,visualMode:'theme-redesign',references:images.map((x,i)=>({index:i+1,role:x.role==='layout'?'layout':['style','color','material'].includes(x.role)?'style':'content'})),layoutChanges:[],preserve:[],grids:[]}};
  }catch(error){error.uiDraftDiagnostics={stage,model:UI_CATALOG_MODEL,promptIds:[...ids],dispatchClientId,samplingSubmitted:false};throw error;}
}
export const RECOGNITION_SYSTEM = "只观察输入游戏图的结构，不重新设计，不描述旧人物物件的身份、物种、衣服、颜色、材质或故事。不列普通物件类别和重复关系。只输出以下五行短自然描述，保留行首名称；看不清写“未知”，不能猜补。\n区域关系：从上到下说明真实存在的主要区域及相对位置，区分玩法网格、格外大主角、信息栏和控件区。\n网格：实际几行几列。\n角色关联：按不同身份说明实体数量和各自格外位置、对应头像的第几行第几列，用自然相对位置指代，不编角色编号。确认同一身份时，头像与格外全身是同一角色的两种展示，不是两名角色；两个展示仍占各自区域。没有或无法确认就直说。\n业务文字：逐字抄真实功能标签、金额与数值、按钮字面和调节符号，附其自然位置；相同值在不同宿主出现也分别保留，不把用途解释当成印字。网格中的固定字母数字也附格位保留；不抄旧物装饰题字。\n玩法文字：只抄实际可见特殊玩法标签的原字面及第几行第几列；载体外貌不写，位置不清就写未知。\n不输出区域数字索引、嵌套schema、逐格普通物件名单、思考或候选。全文尽量不超过350字，必需业务字面可以使全文略长。";
export const DESIGN_SYSTEM_BODY = "你是完整游戏UI的美术设计师。依据本轮已经识别的结构与功能，创作一套完整的新主题成品画面，而不是只给旧按钮换颜色。你不会看到旧外观；context只含去除旧外观后的功能语义、文字、区域关系和明确记录的未知。只设计，不再次识别，不把未知内容宣称为已识别事实。\n整体采用context指定主题和画风。人物、格内头像、普通玩法符号、特殊玩法标签载体、主旋转、调节按钮、购买入口、信息显示、金额数字和辅助功能图标都属于同一套整体设计，完成度要一致。人物与物件的具体身份、轮廓、服饰装备、动作、颜色及材料由你自主创造；不恢复旧身份或原物件。构思有近中远空间的真实主题地点，人物动作自然，图标主轮廓、主次体块、独立构造和细节都完整；通过统一主辅光、受光面、接触阴影与自然反射形成层次，不靠全体描光边或统一压暗。采用手绘厚涂游戏美术，有秩序的色块与笔触，不做低完成度素材陈列。\n保留各功能职责、已识别区域顺序、网格行列与总格数、独立人物展示数及全部业务字面。原普通图标种类和重复不约束新设计。保持格内头像与格外人物各自展示职责；对应关系未知，不填成原图识别结论。你可自主构思新角色及其头像表现，但不能删除头像区域或扩展额外人物区。逐行描述网格中各格的新成品，避免空格、编号占位、厚卡片墙。\n主控必须有完整的旋转视觉主体：具体描述中央主按钮的独立轮廓、足够显著的旋转箭头或环动图案、主题构造和体积层次，让人看得出它是主旋转操作。还要具体设计一对减/加调节组件，保留各自符号及与读数的功能关系。实际识别的辅助按钮仍有各自功能图标和已识别文字，不得用普通文字按钮替代主旋转或±。购买入口和信息显示同样需要完整主题造型，不能缺项或合并读数。\n每类主要文字都必须给出具体的主题字形设计，而非泛称“清晰粗体/无衬线/镶金边”：说明字母或数字的笔画骨架与端部特征、字腔/字宽/间距、所选主题材料如何构成字身，以及字面、侧面与阴影的层次。分别落实到格内字母数字、特殊玩法大字、购买入口、信息标题与中奖数值、金额读数、辅助功能中文标签；让它们属于一个字形家族又有主次。材料和字形由你按主题自主设计，不预置任何固定模板。具体方案必须写进最终完整画面描述，不能只提要求。保留识别原字面及实际重复显示，不新起标题、不新增口号、数值、标签或业务文案，也不把字段名/解释/未知等印进画面。\n最终直接给一个JSON字符串字段rewritten_prompt，约1500至2100字，值为能独立交给绘图模型执行的完整中文成品画面描述。将人物、玩法、文字和全部控制融入连续整体方案，不另附旧功能清单、不写修补附录或追加提示尾句。不输出分析、候选或中间方案。原图只作布局参考，全部新视觉造型按这套完整方案重设计。";

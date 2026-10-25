import { randomUUID, createHash } from 'node:crypto';
import { UI_CATALOG_MODEL, inferUiGraph } from './ui-catalog-planner.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
export const NATURAL_DRAFT_METHOD = 'natural-structure-draft-v1';

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
    max_length:design?1536:768, sampling_mode:'on', thinking:false, use_default_template:false, mtp:'off',
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

export async function planNaturalUiDraft({baseUrl,payload,cpu,infer,fetchImpl=fetch,pollMs=1000,timeoutMs=180000,isCancelled=()=>false}) {
  if(infer!==undefined&&typeof infer!=='function')throw new Error('UI 原生推理接口无效');
  const base=String(baseUrl).replace(/\/+$/,''),images=payload.images;
  if(payload.uiCatalogResume||payload.uiDraftResume)throw new Error('快速设计请求不接受旧分析答案');
  if(!Array.isArray(images)||!images.length||images.length>10)throw new Error('请提供有效的布局参考图');
  const layouts=images.map((x,i)=>x.role==='layout'?i:-1).filter(i=>i>=0);
  if(layouts.length!==1)throw new Error('快速设计需要一张明确的布局参考图');
  const index=layouts[0],request=String(payload.currentPrompt||'').trim();
  if(!request||request.length>18000)throw new Error('请填写有效的主题与设计要求');
  const ids=[],timings=[],nativeImages=new Map();let stage='prepare-reference',dispatchClientId='',analysisModel=infer?'':UI_CATALOG_MODEL;
  const active=()=>{if(isCancelled()||payload.signal?.aborted)throw new Error('任务已中止；未提交后续分析或生图');};
  const remember=dataUrl=>{const name='native-ui-'+randomUUID();nativeImages.set(name,dataUrl);return name;};
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
    if(ids.length>=2)throw new Error('快速设计已达到两次分析上限，本次未提交生图');
    active();
    if(infer){
      const result=await inferUiGraph(infer,graph,{resolveImage:name=>nativeImages.get(name),stage,signal:payload.signal,isCancelled});
      if(analysisModel&&analysisModel!==result.model)throw new Error('UI 分析会话的实际模型发生变化；未提交生图');
      analysisModel=result.model;ids.push(result.requestId);
      timings.push({stage,promptId:result.requestId,requestId:result.requestId,model:result.model,wallMs:result.wallMs,budget:result.budget,...(result.syntaxProjection?{syntaxProjection:result.syntaxProjection}:{}),...(result.usage?{usage:result.usage}:{}),...(result.timing?{timing:result.timing}:{})});
      return result.text;
    }
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
    active();if(!infer){await idle();const available=await json('/object_info/CLIPLoader');
      if(!available.CLIPLoader?.input?.required?.clip_name?.[0]?.includes(UI_CATALOG_MODEL))throw new Error('缺少已验证PE模型，不会下载或更换模型');}
    const prepared=await cpu({action:'natural-draft-image',image:images[index]});
    let name;
    if(infer)name=remember(prepared.dataUrl);
    else {
    const bytes=Buffer.from(prepared.dataUrl.split(',')[1],'base64'),form=new FormData();
    form.append('image',new Blob([bytes],{type:'image/png'}),'NF_UI_DRAFT_'+randomUUID()+'.png');form.append('overwrite','false');
    const uploaded=await json('/upload/image',{method:'POST',body:form});if(!uploaded.name)throw new Error('布局图上传状态未确认');
    name=(uploaded.subfolder?uploaded.subfolder+'/':'')+uploaded.name;
    }
    stage='natural-recognition';
    const raw=await execute(buildNaturalDraftGraph({system:RECOGNITION_SYSTEM,user:'观察这张本地原图，仅返回上述五行结构记录。',image:name}));
    stage='neutral-projection';const projection=await cpu({action:'natural-draft-project',raw});
    const {system,context}=naturalDraftDesignInput(request,projection);
    stage='single-draft-design';const designRaw=await execute(buildNaturalDraftGraph({system,user:JSON.stringify(context),design:true}));
    active();stage='extract-draft';const extracted=parseNaturalDraft(designRaw);
    return {prompt:extracted.prompt,negativePrompt:'',uiDraft:{method:NATURAL_DRAFT_METHOD,model:analysisModel,...(infer?{analysisBackend:'strata'}:{}),originalRequirements:request,promptIds:ids,providerCallCount:ids.length,timings,recognitionChars:raw.length,designChars:extracted.prompt.length,projection,source:{index:index+1,role:'layout',...prepared.proof},extraction:extracted.extraction,promptSha256:sha(extracted.prompt)},
      uiPlan:{version:1,layoutMode:'preserve',layoutReference:index+1,visualMode:'theme-redesign',references:images.map((x,i)=>({index:i+1,role:x.role==='layout'?'layout':['style','color','material'].includes(x.role)?'style':'content'})),layoutChanges:[],preserve:[],grids:[]}};
  }catch(error){error.uiDraftDiagnostics={stage,model:analysisModel,...(infer?{analysisBackend:'strata'}:{}),promptIds:[...ids],dispatchClientId,samplingSubmitted:false};throw error;}
}
export const RECOGNITION_SYSTEM = "只观察输入游戏图的结构，不重新设计，不描述旧人物物件的身份、物种、衣服、颜色、材质或故事。不列普通物件类别和重复关系。只输出以下五行短自然描述，保留行首名称；看不清写“未知”，不能猜补。\n区域关系：从上到下说明真实存在的主要区域及相对位置，区分玩法网格、格外大主角、信息栏和控件区。\n网格：实际几行几列。\n角色关联：按不同身份说明实体数量和各自格外位置、对应头像的第几行第几列，用自然相对位置指代，不编角色编号。确认同一身份时，头像与格外全身是同一角色的两种展示，不是两名角色；两个展示仍占各自区域。没有或无法确认就直说。\n业务文字：逐字抄真实功能标签、金额与数值、按钮字面和调节符号，附其自然位置；相同值在不同宿主出现也分别保留，不把用途解释当成印字。网格中的固定字母数字也附格位保留；不抄旧物装饰题字。\n玩法文字：只抄实际可见特殊玩法标签的原字面及第几行第几列；载体外貌不写，位置不清就写未知。\n不输出区域数字索引、嵌套schema、逐格普通物件名单、思考或候选。全文尽量不超过350字，必需业务字面可以使全文略长。";
export const DESIGN_SYSTEM_BODY = "你是全新主题的成品美术设计师，只负责设计，不重新识别布局。context.layout_zh来自本轮PE看同一原图一次后的短描述，经通用句式白名单只保留明确结构和业务文字。你不会收到原图、旧人物物件身份或旧外貌。普通图标类别与原重复关系不在保留范围，所有新对象由你自主创作。\ncontext.layout_zh是本轮真实识别中可直接定位的结构原文片段。保持区域顺序、格外主角与格内头像的各自占位、网格行列和功能文字职责。通用实体规则：关联的格内头像和格外全身像，是同一角色身份的两种展示，不是两名角色；只为该身份设计一个新人物并复用于这两个展示，不能按头像与全身各新增一名角色。每个已识别的头像/格外全身对应对作为一个身份锚点，由你自主设计该身份；不能把对应对拆成两名角色，也不能把不同对应对的展示合并占位或遮挡玩法与状态栏。未给出的几何信息不冒充已识别事实。\n自主选择符合本组主题的全新角色身份与物种、服装、装备和一个自然可执行动作；关联头像与主角必须为同一人。自主创作一套契合主题、轮廓鲜明且各有完整造型意图的新图标，并逐格安排在给定网格内。原普通物件种类和重复关系均不约束你；是否重复及重复哪个新图标由你自行决定。所有格位都应有清楚成品，不能用文字编号或空格代替设计，没有手工目标物清单。\ncontext.layout_zh中引号内的状态文字和玩法标签必须逐字呈现，按规定的区域与角色承载。状态栏为完整可读成品，不用空载体或后补文字；不把字段名、序号或职责说明印进图中，不添加新业务区或按钮。\n背景应有完整地点与近中远空间，主体清楚，图标采用轻分隔，不做厚卡片墙。只设计一套高完成度成品，没有备选或修补阶段；所有可见造型与空间用中文描述。\n\n整体遵循本组指定画风，保持高完成度、可读体积与精致层次。人物和每个玩法图标都要有完整、可读、值得单独看的成品设计：先形成清楚主轮廓、主次体块、独立造型意图和贴合对象身份的构造，再以精细但有秩序的材料层次完成。远看能认出，近看有讲究；不要把物件做成一排只展示表面贴图的材质样本。\n每个图标都保留清楚固有色、可读中间调、亮面、暗面与有用的局部细节。主次通过轮廓、构图间距、体块对比和选择性的视觉重点组织，不通过统一降低次要图标饱和度、压暗或削减设计完成度组织。各对象可以有不同而协调的颜色和材料，其具体类别、配色与工艺由你决定。\n锈蚀、破损、附着物只在对象故事和使用逻辑确有需要时局部采用，不以全面做旧、全面腐蚀、统一脏暗代替设计；也不把所有物件磨平为同一材质或靠巨大倒角、均匀塑料高光取代造型。完整换题材的原则保持，不重新引入原物件身份或纹章。\n整体环境光和局部主辅光由本组题材决定，色温、方向与强弱有组织地呼应，并在人物、物件和场景之间统一。人物面部、主要材质和关键图标保留明亮、丰富、清楚的亮暗层次，不埋在黑色暗部。主光和补光应真实照到衣料、金属、道具和地面，形成受光面、投影、接触阴影、反射和衰减；不是每个物体各自描一圈发光边。\n局部照明有组织地引导视线并丰富材质，环境光连通全画面，不默认任何其他题材的蓝色或水下气氛。仅确有主题或功能理由的对象使用自发光，保持可信亮度和周围响应；不要把所有图标变成灯具，不堆满光点、霓虹边框或发光装饰。所有对象有清楚体积与层次，并以指定画风表现。手绘可用有组织的笔触和概括色块，卡通可夸张形体；不把所有风格强制画成照片式PBR，也不以低完成度简化代替设计。\n背景保持本组题材的完整地点、近中远空间和空气透视，通过远近边缘、局部对比和亮点密度自然退后，主角与玩法内容清楚。背景不能抢戏，也不是删空、铺纯色、变一片黑或把全图压暗。框体与显示面服务内容，保留本轮固定的功能关系，不扩展新功能区。\n角色保持符合其所选身份和物种的准确形体、可辨面貌与装备层次，通过自然重心和可同时完成的手部操作形成一个清楚的动作瞬间。主角和头像共享同一身份，画面有情境与叙事，避免呆立的器材陈列感。所有具体人物、物件、色彩和照明写进完整目标画面描述，由你自主设计。\n\n直接返回一个JSON字符串字段rewritten_prompt，值为约900至1200字的完整目标画面自然描述，能够独立交给绘图模型执行。写清各格新设计、主角头像关联、区域顺序和全部保留文字，不能引用未提供给绘图模型的结构字段。不另交结构JSON、分析或候选。形式为{\"rewritten_prompt\":\"完整目标画面描述\"}。\n本轮结构含固定字母数字、读数与控件字面。所有已识别业务字面及重复出现的值必须在各自识别位置逐字保留；玩法特殊标签的图案载体按新主题完整重设计，标签本身与识别格位保留，不能因普通图标自由设计而删除标签。控件的造型、材料和层次同样由你全新设计，不能仅换色；没有识别到的精确字值或符号不凭旧任务猜补。若识别有角色职责/格位冲突，保留独立展示和业务文字优先，不自增区域或人物，不能声称已修复识别。";

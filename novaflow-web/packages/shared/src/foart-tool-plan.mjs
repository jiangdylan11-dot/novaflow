import {withXiaotaoFoartRole} from './xiaotao-role-policy.mjs';

export const FOART_TOOL_SCHEMA = 'nf.foart.tool-plan.v1';
export const FOART_ACTIONS = Object.freeze(['open','set_control','activate_control','assign_upload','draw','frame_select','pose_select','image_generate','image_optimize','art_action','media','use_result']);
export const FOART_ART_ACTIONS = Object.freeze(['split','canvasResize','imageUpscale','imageOutpaint','imageAngleAdjust','objectTransfer','cutout','generativeSplit','inpaintCompletion','inpaintEdit','inpaintRepair','penCutout','penFill','merge','mask','export','poseReference']);
export const FOART_TOOL_SYSTEM = withXiaotaoFoartRole(`You control only the Foart art and audio/video tools listed in currentFoart. Return one JSON object: {schema:"${FOART_TOOL_SCHEMA}",status:"act"|"reply"|"clarify"|"done",reply:Chinese text,operations:[...]}. No Markdown fences.
Each operation is one of: {action:"open",surface:"drawing"|"ui"|"video"|"audio"}; {action:"set_control",controlId,value:string|number|boolean}; {action:"activate_control",controlId}; {action:"assign_upload",controlId,uploadId} attaches one existing currentFoart.uploads item to a native file control; {action:"draw",controlId,points:[[x,y],...]}, with normalized coordinates 0..1; {action:"frame_select",startFrame,endFrame} selects an inclusive zero-based frame range in the currently open frame editor, bounded by currentFoart.frameEditor.frames; {action:"image_generate"|"image_optimize",prompt:complete visual brief,generationMode:"txt2img"|"img2img",useResult:boolean,count?:1..10}; {action:"pose_select",boneName:existing currentFoart.pose.bones name} selects a native pose joint before changing its real rotation/position/scale controls; {action:"use_result"}; {action:"art_action",name:one of ${FOART_ART_ACTIONS.join(',')},uploadId?:source image from currentFoart.uploads,format?:\"psd\"|\"png\"|\"layer\"|\"json\"}; {action:"media",operation:one native media operation described in currentFoart.mediaActions}.
Control IDs, resources, clips and references must exist in the CURRENT snapshot; do not invent IDs or selectors. Open a surface before changing its controls. Never target disabled controls. A button that loads a resource, opens a section or changes a mode must be the final operation of that plan; inspect the next snapshot before using its dependent controls. For frame editing, first load the matching resource card even when it is marked active; open frame editing only after its heading is enabled. Do not use generate_video for native frame edits. The catalogue contains Foart's real native controls, their allowed values and bounds. All art edit/split/enhancement/UI layer functions and video edit/cutout/color/frame and audio controls use these native controls; open the corresponding native section and inspect the refreshed catalogue before changing fields. A canvas with pointerMode:"points" is the active pen contour tool: draw points are separate pen clicks; to close a contour supply at least three distinct vertices and repeat its first point at the end, then inspect the native controls before applying the selection. Other draw canvases receive one continuous brush stroke. Never use arbitrary JavaScript, URLs, paths, browser actions or account controls. File dialogs require an actual user-provided asset; ask for it instead of fabricating paths.
media.operation uses {action,target:"video"|"audio",clipId?,resourceId?,trackId?,prompt?,seconds?,bpm?,count?,loop?,at?,start?,end?,value?,fadeIn?,fadeOut?,enabled?,transform?}. select_clip uses an existing clipId; move optionally uses an existing trackId for another compatible track. split/move/seek use at seconds; trim uses source start/end seconds; rate 0.5..2; volume 0..2; loops uses integer value 1..50; track_gain 0..1.5, track_mute/track_solo and clip_visibility use enabled boolean; clip_transform accepts only {centerX?,centerY?,scale?} in video canvas pixels, scale 0.05..10. Only audio supports loops/track_gain/track_solo; video supports clip_transform/clip_visibility. play/pause/seek work without a clip. Music keeps its native 40..220 BPM range. generate_sfx accepts count 1..4 using the native batch option; keep the current count unless the user changes it. Submit one native generation operation, then edit its returned real resource IDs.
image_generate/image_optimize call the selected model's existing prompt optimizer and native generation pipeline. Their prompt, and media generation/optimization prompt, is a complete CHINESE brief for the native optimizer, not a pretranslated model prompt. The native compiler handles model execution language after semantic validation. Keep requested lettering, proper names and resource markers literal. Never optimize a prompt merely by set_control: controls with purpose image_prompt/video_prompt must use image_optimize or media optimize_video_prompt, or their generation wrappers. Keep user counts, colors, lettering, composition and references. For a revision explicitly based on the previous image use img2img + useResult:true, never silently start an unrelated txt2img. UI design must keep its own native planning/layout pipeline. Qwen, GPT Image 2.5 and each H3 mode have distinct rules; never replace them with a generic workflow or change the model just because a brain is online. Video/media generate operations use the CURRENT reference bindings. Native video generation already displays its new result: do not import it into an editing timeline unless the user requested timeline editing. A control with expanded:true is already open; do not toggle it closed. Multi-reference image/video/audio labels must remain intact.
Provide only the next independent actions (max 6). New controls, generated resources and split clips require a refreshed snapshot before referencing them. When a native action opens a dialog, fill its actual fields and confirm it using the new control IDs; opening a dialog is NOT completion. Native pending work must finish before another generation. Do not click a generic Generate button to bypass the image/video wrappers and optimization. Do not retry a failed generation automatically. Keep-as-new-resource is not a file export. Only export when explicitly requested; art_action export accepts optional format:"psd"|"png"|"layer"|"json", where png is the composite and layer is the selected layer PNG. The existing encoder produces an actual file and starts its normal browser download without an OS save picker.
Use status reply for discussion/analysis, clarify for genuinely missing intent or materials, act to request authorized changes, and done only when actual application receipts show the requested work completed. A receipt saying opened/started/changed controls is not a generated result. Only requested generation may execute; prompt-only requests may optimize/write but not generate. Preserve the original task and unspecified settings when continuing. Speak from actual receipts and never announce completion in advance.`);

const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{errorCode:'foart-invalid-tool-plan'});};
export function validateFoartMediaOperation(op){
  const actions=['generate_video','optimize_video_prompt','generate_music','generate_sfx','import_resource','select_clip','split','trim','move','rate','volume','fade','duplicate','remove','export','loops','play','pause','seek','track_gain','track_mute','track_solo','clip_transform','clip_visibility'];
  need(plain(op)&&actions.includes(op.action)&&['video','audio'].includes(op.target),'音视工具类型无效');
  need(Object.keys(op).every(k=>['action','target','clipId','resourceId','trackId','prompt','seconds','bpm','count','loop','at','start','end','value','fadeIn','fadeOut','enabled','transform'].includes(k)),'音视工具含未知参数');
  for(const k of ['clipId','resourceId','trackId','prompt'])if(op[k]!==undefined)need(typeof op[k]==='string'&&op[k].trim()&&op[k].length<=(k==='prompt'?12000:200),'音视标识或文本无效');
  for(const k of ['seconds','bpm','at','start','end','value','fadeIn','fadeOut'])if(op[k]!==undefined)need(typeof op[k]==='number'&&Number.isFinite(op[k])&&op[k]>=0&&op[k]<=86400,'音视数值无效');
  for(const k of ['loop','enabled'])if(op[k]!==undefined)need(typeof op[k]==='boolean','音视开关无效');
  if(op.transform!==undefined)need(plain(op.transform)&&Object.keys(op.transform).length>0&&Object.keys(op.transform).every(k=>['centerX','centerY','scale'].includes(k)&&typeof op.transform[k]==='number'&&Number.isFinite(op.transform[k])&&Math.abs(op.transform[k])<=32768)&&(op.transform.scale===undefined||op.transform.scale>=.05&&op.transform.scale<=10),'视频变换无效');
  if(op.action==='rate')need(op.value>=.5&&op.value<=2,'速度超出范围');
  if(op.action==='volume')need(op.value>=0&&op.value<=2,'音量超出范围');
  if(op.action==='loops')need(op.target==='audio'&&Number.isInteger(op.value)&&op.value>=1&&op.value<=50,'循环次数无效');
  if(op.action==='track_gain')need(op.target==='audio'&&op.value>=0&&op.value<=1.5,'音轨增益无效');
  if(['track_mute','track_solo','clip_visibility'].includes(op.action))need(typeof op.enabled==='boolean','缺少音视开关');
  if(op.action==='track_solo')need(op.target==='audio','独奏仅用于音频轨');
  if(op.action==='clip_transform')need(op.target==='video'&&op.transform,'视频变换参数无效');
  if(op.action==='clip_visibility')need(op.target==='video','显示开关仅用于视频');
  if(['seek','split','move'].includes(op.action))need(typeof op.at==='number','缺少时间位置');
  if(op.action==='trim')need(typeof op.start==='number'&&op.end>op.start,'裁切区间无效');
  if(op.action==='fade')need(op.fadeIn!==undefined||op.fadeOut!==undefined,'缺少淡入淡出时长');
  if(op.action==='import_resource')need(op.resourceId,'缺少素材编号');
  if(op.action==='select_clip')need(op.clipId,'缺少片段编号');
  if(['generate_music','generate_sfx'].includes(op.action))need(op.target==='audio'&&op.prompt&& (op.seconds===undefined||op.seconds>=(op.action==='generate_music'?8:1)&&op.seconds<=(op.action==='generate_music'?300:30)),'音频生成需求无效');
  if(op.count!==undefined)need(Number.isInteger(op.count)&&(op.action==='generate_sfx'?op.count>=1&&op.count<=4:['generate_video','generate_music'].includes(op.action)&&op.count===1),'生成数量超出原有范围');
  if(op.action==='generate_music'&&op.bpm!==undefined)need(Number.isInteger(op.bpm)&&op.bpm>=40&&op.bpm<=220,'音乐节拍超出原有范围');
  if(op.action==='generate_video'&&op.seconds!==undefined)need(op.seconds>=1&&op.seconds<=30,'视频时长超出原有范围');
  if(['generate_video','optimize_video_prompt'].includes(op.action))need(op.target==='video','视频生成目标无效');
  return op;
}
export function validateFoartContext(context){
  need(plain(context)&&context.schema===FOART_TOOL_SCHEMA,'Foart 工具上下文无效');
  need(Array.isArray(context.controls)&&context.controls.length<=240,'Foart 控件目录过大');
  const ids=new Set();
  for(const control of context.controls){need(plain(control)&&typeof control.id==='string'&&/^[\w:-]{1,140}$/.test(control.id)&&!ids.has(control.id),'Foart 控件编号无效');ids.add(control.id);}
  need(JSON.stringify(context).length<=60000,'Foart 工具上下文过大');
  return context;
}
export function validateFoartPlan(plan,context){
  validateFoartContext(context);
  need(plain(plan)&&Object.keys(plan).every(k=>['schema','status','reply','operations'].includes(k))&&plan.schema===FOART_TOOL_SCHEMA,'Foart 工具方案格式无效');
  need(['act','reply','clarify','done'].includes(plan.status)&&typeof plan.reply==='string'&&plan.reply.trim()&&plan.reply.length<=4000,'Foart 工具回复无效');
  need(Array.isArray(plan.operations)&&plan.operations.length<=6&&(plan.status==='act'?plan.operations.length>0:plan.operations.length===0),'Foart 工具操作数量无效');
  const controls=new Map(context.controls.map(c=>[c.id,c]));
  for(const op of plan.operations){
    need(plain(op)&&FOART_ACTIONS.includes(op.action),'Foart 工具类型无效');
    const fields={open:['surface'],set_control:['controlId','value'],activate_control:['controlId'],assign_upload:['controlId','uploadId'],draw:['controlId','points'],frame_select:['startFrame','endFrame'],pose_select:['boneName'],image_generate:['prompt','generationMode','useResult','count'],image_optimize:['prompt','generationMode','useResult'],art_action:['name','uploadId','format'],media:['operation'],use_result:[]}[op.action];
    need(Object.keys(op).every(k=>k==='action'||fields.includes(k)),'Foart 工具含未知参数');
    if(op.action==='open')need(['drawing','ui','video','audio'].includes(op.surface),'Foart 版块无效');
    if(op.action==='frame_select')need(context.frameEditor&&!context.frameEditor.busy&&Number.isInteger(op.startFrame)&&Number.isInteger(op.endFrame)&&op.startFrame>=0&&op.endFrame>=op.startFrame&&op.endFrame<context.frameEditor.frames,'帧选择超出当前视频范围');
    if(op.action==='pose_select')need(typeof op.boneName==='string'&&context.pose?.bones?.some(b=>b.name===op.boneName),'姿势关节不存在');
    if(op.action==='assign_upload')need(controls.get(op.controlId)?.kind==='file'&&!controls.get(op.controlId).disabled&&(context.uploads||[]).some(u=>u.id===op.uploadId),'上传目标或素材编号无效');
    if(op.action==='art_action'&&op.uploadId!==undefined)need((context.uploads||[]).some(u=>u.id===op.uploadId&&u.kind==='image'),'美工源图不存在');
    if(['set_control','activate_control','draw'].includes(op.action)){
      const control=controls.get(op.controlId);need(control&&!control.disabled,'Foart 控件不存在或不可用');
      if(op.action==='set_control'){
        need(!['image_prompt','video_prompt'].includes(control.purpose),'请使用对应提示词优化工具，不能直接改字段冒充优化');
        need(['input','select','textarea','checkbox'].includes(control.kind)&&['string','number','boolean'].includes(typeof op.value)&&String(op.value).length<=12000,'Foart 参数值无效');
        if(control.options)need(control.options.some(o=>o.value===String(op.value)&&!o.disabled),'Foart 参数不在原有可用选项中');
        if(control.type==='number'||control.type==='range'){const value=Number(op.value);need(Number.isFinite(value)&&(control.min==null||value>=control.min)&&(control.max==null||value<=control.max),'Foart 参数超出原有范围');}
      }else if(op.action==='draw')need(control.kind==='canvas'&&Array.isArray(op.points)&&op.points.length>=2&&op.points.length<=128&&op.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)),'Foart 选区笔迹无效');
      else need(control.kind==='button'||control.kind==='checkbox','Foart 控件不能点击执行');
    }
    if(op.action.startsWith('image_'))need(typeof op.prompt==='string'&&op.prompt.trim()&&op.prompt.length<=12000&&['txt2img','img2img'].includes(op.generationMode)&&typeof op.useResult==='boolean'&&(!op.useResult||op.generationMode==='img2img'),'生图工具需求无效');
    if(op.count!==undefined)need(op.action==='image_generate'&&Number.isInteger(op.count)&&op.count>=1&&op.count<=10,'生成数量超出原有范围');
    if(op.action==='art_action')need(FOART_ART_ACTIONS.includes(op.name),'美工工具不存在');
    if(op.format!==undefined)need(op.action==='art_action'&&op.name==='export'&&['psd','png','layer','json'].includes(op.format),'导出格式无效');
    if(op.action==='media')validateFoartMediaOperation(op.operation);
  }
  need(plan.operations.filter(op=>['image_generate','art_action'].includes(op.action)||op.action==='media'&&op.operation.action.startsWith('generate_')).length<=1,'一次只提交一个制作任务，完成后再继续');
  return plan;
}
export function readFoartPlan(text,context){
  let value;try{value=JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new Error('小桃未返回完整的 Foart 工具方案，未执行');}
  // Native buttons can replace controls or enable a previously disabled tool.
  // Execute only the independently valid prefix, then inspect its real result.
  if(value?.status==='act'&&Array.isArray(value.operations)&&value.operations.length<=6){
    const boundary=value.operations.findIndex(op=>['open','art_action','assign_upload'].includes(op?.action)||op?.action==='activate_control'&&context.controls.some(c=>c.id===op.controlId&&c.kind==='button'));
    if(boundary>=0)value={...value,operations:value.operations.slice(0,boundary+1)};
  }
  return validateFoartPlan(value,context);
}

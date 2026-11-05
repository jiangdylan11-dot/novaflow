// Prepares a drawing run from the page: which reference plays which role, in what slot order,
// and the prompt with its @参考图N mentions compiled to <imageN>. No model is called here.
(function (root) {
  'use strict';
  const ROLES = Object.freeze({ subject: '主体', style: '风格', pose: '姿势', background: '背景', material: '材质', color: '配色', composition: '构图', lighting: '光影', object: '物件', none: '不使用' });
  const GENERATION_SETTINGS=['provider','mode','prompt','negativePrompt','width','height','count','seed','randomSeed','nsfw','nsfwLoraEnabled','nsfwLoraName','loras','samplingOverrides','gptQualityTxt2img','gptQualityImg2img','gptSize','gptCustomWidth','gptCustomHeight','googleAspectRatioTxt2img','googleAspectRatioImg2img','googleResolution','localDrawEngine','localQwen21Variant','drawingTask'];
  const ROLE_WORDS = [['style',/风格|画风|笔触|上色|渲染方式/i],['pose',/姿势|姿态|动作|骨架/i],['background',/背景|环境|场景/i],['material',/材质|质感|纹理|面料/i],['color',/配色|色彩|颜色|色板/i],['composition',/构图|镜头|透视|景别/i],['lighting',/光影|光照|光线|光感|打光|照明/i],['object',/武器|道具|物件|物品|帽子|鞋子|服装款式|衣服款式|衣服造型/i],['subject',/身份|长相|脸部|(?:主体|人物|角色)(?:和|与|、|及)|(?:主体|人物|角色)(?![^，。；]*?(?:风格|画风|笔触|上色|渲染|姿势|姿态|动作|骨架|衣服|服装|材质|质感|纹理|配色|色彩|颜色|背景|环境|构图|光影|光照|镜头))/i]];
  const text = value => String(value ?? '').trim();
  const copy = value => JSON.parse(JSON.stringify(value));
  function requestedRoles(prompt, references) {
    const matches=Array.from(prompt.matchAll(/(?:@?参考图|图片|图|image)\s*(\d+)/gi)),states=new Map();
    const rolesIn=clause=>ROLE_WORDS.filter(([,pattern])=>pattern.test(clause)).map(([role])=>role);
    const preserve=/保留|保持|不变|不动|别动|不改变|不更换|不要改|不要变|不得改|不许改|原有|原来/;
    const negative=/(?:不要|不用|不参考|不采用|不使用|不引入|不带入|不希望|不允许|忽略|排除|别用|别带|勿用|勿将)/;
    const negativeTail=/(?:不要|不用|不参考|不采用|不使用|不希望|不允许|忽略|排除|别用|别把|别让|勿将|勿用)(?:把|将|用|让|带入|引入|带|参考|采用|使用)?\s*$/;
    for(let i=0;i<matches.length;i++){
      const m=matches[i],number=Number(m[1]);
      if(!references.some(r=>r.source===number))throw new Error(`参考图${number}尚未添加，请补充图片或修改图号`);
      const before=prompt.slice(i?matches[i-1].index+matches[i-1][0].length:0,m.index).split(/[，,。；;\n]/).at(-1)||'';
      const leadingNegative=negativeTail.test(before);
      const preservingReference=/(?:保留|保持|不改变|不更换|不要改(?:变)?|别动|不动)\s*$/.test(before);
      const segment=prompt.slice(m.index+m[0].length,matches[i+1]?.index??prompt.length);
      const after=matches[i+1]?segment.replace(negativeTail,''):segment;
      // Later sentences describe the overall edit unless they name a reference
      // again; do not assign their character/scene nouns to this last donor.
      const clauses=after.split(/[。！？!?]/,1)[0].replace(/但是|但|而|只要|只用|只参考|仅参考|仅用|仅采用/g,word=>'，'+word).split(/[，,；;\n]/);
      const state=states.get(number)||new Map();states.set(number,state);
      // “图5用图2画风” identifies the editing target even when it was not
      // uploaded first. Do not let the first donor become the default subject.
      const next=matches[i+1],nextUse=next?prompt.slice(next.index+next[0].length,matches[i+2]?.index??prompt.length).split(/[，,。；;\n]/)[0]:'';
      if(next&&!leadingNegative&&/^(?:的主体|主体|的人物|人物)?\s*(?:用|按|采用|参考|换成|改成|转成|转为|变成)\s*$/.test(segment)&&rolesIn(nextUse).some(role=>role!=='subject'))state.set('subject',true);
      // A role can precede the image number: “背景用图4，保持原配色”.
      // The later preservation clause must not turn that donor into a palette.
      const prefixRoles=/(?:用|参考|采用|来自|取自)\s*$/.test(before)?rolesIn(before).filter(role=>role!=='subject'):[];
      if(!leadingNegative)prefixRoles.forEach(role=>state.set(role,true));
      let first=!prefixRoles.length,found=prefixRoles.length>0;
      for(const raw of clauses){
        const clause=raw.trim();if(!clause)continue;
        let roles=rolesIn(clause);
        const preservingCommand=/不要改|不要变|不得改|不许改/.test(clause);
        const negated=first&&leadingNegative||negative.test(clause)&&!preservingCommand;
        if(!negated&&(preserve.test(clause)||first&&preservingReference)){
          // Keeping the original subject's pose/background does not request
          // these attributes from the most recently named style donor.
          if(first){if(roles.includes('subject'))roles=['subject'];else if(number===references[0]?.source||state.get('subject'))roles=[];else if(!/和|与|、|及/.test(clause))roles=roles.slice(0,1);}else roles=[];
        }else if(!first&&!negated&&!/采用|参考|使用|借用|只要|只用|仅用|取用|换成|改成|沿用|应用/.test(clause))roles=[];
        if(negated){
          roles.forEach(role=>state.set(role,false));found ||= roles.length>0;
          if(first&&leadingNegative&&!roles.length){for(const role of state.keys())state.set(role,false);state.set('none',true);found=true;}
        }else if(roles.length){
          if(/只要|只用|只参考|仅参考|仅用|仅采用/.test(clause))for(const role of state.keys())if(!roles.includes(role))state.set(role,false);
          state.set('none',false);roles.forEach(role=>state.set(role,true));found=true;
        }
        first=false;
      }
      if(!found&&leadingNegative){for(const role of state.keys())state.set(role,false);state.set('none',true);}
      if(!state.size&&!after.trim())rolesIn(before).forEach(role=>state.set(role,true));
    }
    return references.map((r,index)=>{
      const state=states.get(r.source),excludedRoles=state?[...state].filter(([role,on])=>!on&&role!=='none').map(([role])=>role):[];
      let roles=state?[...state].filter(([,on])=>on).map(([role])=>role):[];
      if(roles.some(role=>role!=='none'))roles=roles.filter(role=>role!=='none');
      if(!roles.length&&r.role!=='auto'&&!excludedRoles.includes(r.role))roles=[r.role];
      if(!roles.length&&index===0&&!excludedRoles.includes('subject')&&!/^\s*(?:生成|画一|设计一)/.test(prompt))roles=['subject'];
      if(!roles.length&&matches.length&&(!states.has(r.source)||excludedRoles.length))roles=['none'];
      return {...r,roles,...(excludedRoles.length?{excludedRoles}:{} )};
    });
  }
  function input(context) {
    const s = context.state;
    const prompt=text(s.prompt);
    return { prompt, mode:s.mode||'img2img', negativePrompt: text(s.negativePrompt), provider: s.provider || 'local', nsfw: s.nsfw === true,
      references: requestedRoles(prompt,(s.mode==='txt2img'?[]:context.references || []).map((ref, index) => ref?.dataUrl ? { ...ref, source: index + 1, role: Object.hasOwn(ROLES,ref.drawingRole) ? ref.drawingRole : 'auto' } : null).filter(Boolean)) };
  }
  // A local subject with pure style references runs subject first, whatever slots they sit in.
  function subjectFirst(source, references) {
    const subjects=references.filter(ref=>ref.roles?.length===1&&ref.roles[0]==='subject').length;
    const styles=references.filter(ref=>ref.roles?.length===1&&ref.roles[0]==='style').length;
    if(source.provider!=='local'||source.nsfw||subjects!==1||!styles||subjects+styles!==references.length)return references;
    return [...references].sort((a,b)=>Number(b.roles[0]==='subject')-Number(a.roles[0]==='subject'));
  }
  function referenceImageMime(ref) {
    const fromData = String(ref?.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));/i)?.[1]?.toLowerCase();
    if (fromData) return fromData;
    const hinted = String(ref?.mimeType || ref?.file?.type || '').split(';')[0].trim().toLowerCase();
    return /^image\/(?:png|jpeg|webp)$/.test(hinted) ? hinted : '';
  }
  function preparedReferences(source) {
    return subjectFirst(source,source.references).map(ref=>{
      const mimeType=referenceImageMime(ref);
      if(!mimeType)throw new Error(`图${ref.source}的图片格式不受支持，请使用 PNG、JPEG 或 WebP`);
      const extension=mimeType==='image/jpeg'?'jpg':mimeType==='image/webp'?'webp':'png';
      return {name:`reference_${ref.source}_direct.${extension}`,mimeType,dataUrl:ref.dataUrl,...(ref.file?{file:ref.file}:{}),sourceIndex:ref.source-1,sourceNumber:ref.source,role:ref.roles[0]||'auto',roles:ref.roles};
    });
  }
  function compiledPrompt(source, references) {
    if(!source.references.length)return source.prompt;
    return source.prompt.replace(/<image\s*(\d+)>|(?:@?参考图|图片|图|image)\s*(\d+)/gi,(mention,tag,number)=>{
      const wanted=Number(tag||number),index=references.findIndex(ref=>ref.sourceNumber===wanted);
      if(index<0)throw new Error(`图${wanted}不存在，请检查参考图编号`);
      return `<image${index+1}>`;
    });
  }
  async function prepare(context) {
    const source=input(context),limit=context.referenceLimit||10;
    if(!source.prompt)throw new Error('请写一句要求，例如“换成白色衬衫”');
    if(source.references.length>limit)throw new Error(`当前模型支持 ${limit} 张参考图，请减少图片或切换模型；本次未截断提交`);
    const references=preparedReferences(source);
    const state=copy(Object.fromEntries(GENERATION_SETTINGS.filter(k=>Object.hasOwn(context.state,k)).map(k=>[k,context.state[k]])));
    state.mode=references.length?'img2img':'txt2img';
    state.localDrawEngine=root.NovaFlowArtGenerateModels?.capabilityFor?.(state.provider,state.mode,state)?.engine||'';
    const prepared={references,promptSnapshot:{prompt:compiledPrompt(source,references),negativePrompt:source.negativePrompt}};
    if(generationOptions(prepared).styleRedraw)state.uiPreserveLayout=false;
    return {...prepared,state,originalPrompt:source.prompt,
      assertCurrent:()=>{if(typeof context.isOwnerCurrent==='function'&&context.isOwnerCurrent()!==true)throw new Error('当前会话已变化，准备已停止');}};
  }
  function generationOptions(prepared){
    // A reference asked to do two jobs (画风和姿势) is not a pure style reference.
    const referenceRoles=prepared.referenceRolePlan?.roles?.slice()||prepared.references.map(r=>r.roles?.length>1?'mixed':r.role);
    const policy={taskProfile:'art-direction',referenceRoles};
    return {...policy,styleRedraw:root.NovaFlowArtGenerateModels?.isStyleRedraw?.(policy)===true};
  }
  // The panel reads the same roles an ordinary run will use.
  function samplingOptions(context){
    const source=input(context);
    return generationOptions({references:subjectFirst(source,source.references).map(ref=>({role:ref.roles[0]||'auto',roles:ref.roles}))});
  }
  root.NovaFlowArtPrepare=Object.freeze({input,prepare,generationOptions,samplingOptions});
})(typeof window !== 'undefined' ? window : globalThis);

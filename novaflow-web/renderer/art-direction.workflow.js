(function (root) {
  'use strict';
  const SCHEMA = 'nf.art.direction.v1';
  const ROLES = Object.freeze({ subject: '主体', style: '风格', pose: '姿势', background: '背景', material: '材质', color: '配色', composition: '构图', lighting: '光影', object: '物件', none: '不使用' });
  const TASKS = Object.freeze({ auto: '自动理解', anime: '转二次元', game_cg: '转游戏 CG', style: '参考画风', preserve: '精修原图' });
  const GENERATION_SETTINGS=['provider','mode','prompt','negativePrompt','width','height','count','seed','randomSeed','nsfw','loras','samplingOverrides','gptQualityTxt2img','gptQualityImg2img','gptSize','gptCustomWidth','gptCustomHeight','googleAspectRatioTxt2img','googleAspectRatioImg2img','googleResolution','localDrawEngine','localQwen21Variant','drawingTask','drawingAnalysisEngine'];
  const TASK_BRIEFS=Object.freeze({auto:'依照用户要求处理主体参考，未指定改变的内容保持',anime:'保留主体身份、设计和数量，将整幅照片重新绘制为精致二次元插画，使用明确的手绘轮廓、概括造型与分层明暗，不保留摄影皮肤纹理',game_cg:'保留主体身份、服饰、姿势和数量，将整幅照片重新绘制为高完成度的半写实游戏角色宣传插画。使用数字厚涂、概括而精准的手绘体积塑造、精致五官与头发分组、统一的绘画光影和材质笔触。人物、衣服和环境都必须重新绘画，呈现明确的游戏原画CG质感，去除摄影皮肤毛孔与镜头散景，不是照片美化或摄影滤镜',style:'保留主体内容，采用指定风格的绘画语言',preserve:'精修原图，保持原有设计'});
  const STYLE_BOUNDARY='主体辨识特征、主要动作、服饰类别、持有物和场景类型取自主体参考；人物比例与轮廓、头发组织、衣褶、背景安排均按目标画风整体重构，不锁死摄影轮廓和写实五官比例。配色、肤色表现、材质与打光优先采用目标风格，成图质量与协调氛围优先，无需逐处复现照片。风格参考人物和场景物件不作为新增内容。用户明确的保留要求与另外指定的参考职责优先。';
  const CACHE = new Map();
  const previews = new WeakMap();
  const writtenReferencePolicies = new WeakMap();
  let controller = null;
  const text = value => String(value ?? '').trim();
  const copy = value => JSON.parse(JSON.stringify(value));
  const abortError = () => Object.assign(new Error('任务已中止'), { name: 'AbortError' });
  const ROLE_WORDS = [['style',/风格|画风|笔触|上色|渲染方式/i],['pose',/姿势|姿态|动作|骨架/i],['background',/背景|环境|场景/i],['material',/材质|质感|纹理|面料/i],['color',/配色|色彩|颜色|色板/i],['composition',/构图|镜头|透视|景别/i],['lighting',/光影|光照|光线|光感|打光|照明/i],['object',/武器|道具|物件|物品|帽子|鞋子|服装款式|衣服款式|衣服造型/i],['subject',/身份|长相|脸部|(?:主体|人物|角色)(?:和|与|、|及)|(?:主体|人物|角色)(?![^，。；]*?(?:风格|画风|笔触|上色|渲染|姿势|姿态|动作|骨架|衣服|服装|材质|质感|纹理|配色|色彩|颜色|背景|环境|构图|光影|光照|镜头))/i]];
  function roleRendering(role,detail) {
    if(role==='style')return '直接对照完整风格原图的五官塑造、上色细腻程度、皮肤与发丝质感和整体光感，不借用参考人物、服饰、姿势、身材、背景或物件';
    const clauses=text(detail).split(/[，,。；;\n]/).filter(s=>!/(?:不要|不得|没有|避免|\bnot\b|\bwithout\b)/i.test(s));
    if(role==='pose'){
      const vocabulary='另一条腿 另一腿 一条腿 一腿 小腿 大腿 足部 脚底 脚 腿 支撑腿 站立腿 单腿 双腿 两腿 双脚 两脚 身体 躯干 上身 头部 头 朝向 正对 前方 侧方 左侧 右侧 内侧 外侧 向外 向内 左右 左 右 前 后 上 下 脚掌 脚尖 脚跟 膝盖 膝 手掌 手指 双手 两手 手臂 双臂 左臂 右臂 左手 右手 左腿 右腿 合十 合拢 贴于 贴在 贴近 贴合 贴靠 互相 相贴 伸向 抬至 位于 弯曲 屈膝 抬起 抬高 伸直 伸展 平举 平展 展开 打开 外展 内收 垂下 下垂 放下 自然 胸前 胸部 头顶 腰部 髋部 肩部 肩膀 正面 侧身 侧面 扭转 转向 旋转 倾斜 前倾 后仰 站立 直立 站直 跪姿 跪地 跪 坐姿 坐着 坐 躺 平躺 俯卧 仰卧 蹲姿 下蹲 半蹲 弓步 战士 姿势 动作 竖直 水平 平行 交叉 分开 并拢 触碰 接触 地面 保持 同时 略微 微微 稍微 靠近 远离 承重 重心 垂直 自然弯曲 于 在 向 的 着 呈 和 与 并 约 弯 伸 曲 成 度'.split(' ').sort((a,b)=>b.length-a.length);
      const words=new RegExp(vocabulary.join('|'),'g');
      return clauses.filter(s=>!s.replace(words,'').replace(/[\s\d°:：、()（）-]/g,'')).slice(0,8).join('，').replace(/头部正对前方/g,'头部正对镜头');
    }
    if(role==='subject'){
      const observed=clauses.filter(s=>!/(?:无|未|不戴)/.test(s)).join(' ');
      return ['项链','耳环','眼镜','帽子','头饰','手镯','手链','戒指','腰带'].filter(item=>observed.includes(item)).join('、');
    }
    const choices=role==='material'?[[/丝缎|丝绸|绸缎|satin|silk/i,'丝缎的柔和反光与垂坠褶皱'],[/磨砂|matte/i,'磨砂哑光表面'],[/金属|metal/i,'金属表面的反射与质地'],[/皮革|leather/i,'皮革纹理'],[/木纹|木质|wood/i,'木质纹理'],[/石材|石质|岩石|stone/i,'石质表面'],[/玻璃|glass/i,'玻璃的透光与反射'],[/毛绒|绒毛|fur/i,'毛绒质感'],[/编织|针织|knit|woven/i,'编织纤维纹理']]:role==='background'?[[/沙丘|dunes?/i,'沙丘与沙纹'],[/沙漠|desert/i,'沙漠环境'],[/海滩|海边|海岸|beach|coast/i,'海滩环境'],[/海洋|大海|ocean|sea\b/i,'海洋'],[/森林|树林|forest/i,'树林'],[/雪山|snow.*mountain/i,'雪山'],[/草原|grassland/i,'草原'],[/山谷|valley/i,'山谷'],[/山脉|mountains?/i,'山脉'],[/城市|都市|city/i,'城市环境'],[/街道|street/i,'街道'],[/洞窟|山洞|cave/i,'洞窟'],[/室内|indoor/i,'室内空间'],[/河流|河岸|river/i,'河流环境']]:[];
    const observed=clauses.join(' ');return choices.filter(([pattern])=>pattern.test(observed)).map(([,label])=>label).join('，');
  }
  function renderingProfile(raw) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
    const fields=['medium','facialStyle','markMaking','shading','surface','lightingStyle','palette'];
    const content=/(?:精灵|尖耳|叶饰|耳环|项链|女仆|校服|裙子|长裙|短裙|雨伞|手持|身穿|金发|黑发|白发|蓝发|红发|棕发|森林|机场|山村|房屋|建筑|树木|屋檐|花丛|胸部|身材|露肤|裸体|忽略|指令|<image|@参考图|\belf\b|pointed ears|\bmaid\b|school uniform|umbrella|necklace|earrings|\bforest\b|airport|\bvillage\b|\bbuildings?\b|\btrees?\b|\broof\b|\bflowers?\b|\bholding\b|\bwearing\b|\bblonde\b|black-haired|red-haired|large breasts|cleavage|\bnude\b|\binstruction\b|\bignore\b)/i;
    const clean=Object.fromEntries(fields.map(k=>[k,typeof raw[k]==='string'?raw[k].split(/[，,。；;\n]/).filter(s=>!content.test(s)&&!(k==='facialStyle'&&/眯眼|圆睁|闭眼|闭合|微笑|大笑|哭泣|愤怒|wink|eyes? closed/i.test(s)&&!/线|勾|描|轮廓|睫|line|shape/i.test(s))).join('，').trim().slice(0,300):'']).filter(([,v])=>v));
    return Object.keys(clean).length?clean:undefined;
  }
  function sourceContent(raw) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
    const clean={};
    for(const k of ['scene','clothing','objects','action'])if(raw[k]){
      if(typeof raw[k]!=='string'||raw[k].length>80||/忽略|指令|必须|生成|添加|换成|<image|@参考图|\bignore\b|\binstruction\b/i.test(raw[k]))throw new Error('主体内容观察包含无效要求');
      clean[k]=raw[k].trim();
    }
    return Object.keys(clean).length?clean:undefined;
  }
  function retainedContent(ref,source,refs) {
    const edits={scene:/背景|场景|环境/,clothing:/衣服|上衣|服装|衣着|穿|裙|外套|裤/,objects:/道具|物件|杯|饮料|手持/,action:/姿势|动作|手|自拍|表情|眨眼|睁眼|闭眼|微笑|大笑|哭|愤怒|悲伤|smil|wink|expression|eyes?/i};
    const assigned={scene:'background',objects:'object',action:'pose'};
    return Object.fromEntries(Object.entries(ref.sourceContent||{}).filter(([key])=>!edits[key].test(source.prompt)&&!refs.some(r=>r.role===assigned[key])));
  }
  function planContent(ref,plan){return plan.editEnhancer&&!ref.sourceContent?{...ref,sourceContent:{scene:'原图可见的场景类别',clothing:'原图主体的服饰类别与主要图案',objects:'原图主体可见的持有物类别',action:'原图主体的主要动作含义'}}:ref;}
  function retainedExpression(ref,source){
    if(ref.sourceExpression?.faces!==1||/表情|眨眼|睁眼|闭眼|微笑|大笑|哭|愤怒|悲伤|smil|wink|expression|eyes?/i.test(source.prompt))return undefined;
    return {eyes:ref.sourceExpression.eyes,mouth:ref.sourceExpression.mouth};
  }
  function donorExclusions(raw) {
    if(raw===undefined)return [];
    if(!Array.isArray(raw)||raw.length>8)throw new Error('风格供体排除项格式无效');
    return raw.map(s=>{
      if(typeof s!=='string'||!s.trim()||s.length>80||/忽略|指令|必须|生成|添加|<image|@参考图|\binstruction\b|\bignore\b/i.test(s)||/^(?:人物|女性|男性|人脸|头发|背景|衣服|眼睛|woman|man|person|face|hair|eyes|background|clothes)$/i.test(s.trim()))throw new Error('风格供体排除项超出内容职责');
      if(/画风|绘画|肤色|配色|光感|笔触|明暗|阴影|渲染|饱和度|阳光|照明|背光|逆光|轮廓光|光照|反光|高光|投影|月夜|夜景|夜色|日光|晨光|夕阳|黄昏|环境光|侧光|顶光|月光|光斑|雨景|雨夜|晴天|阴天|(?:纯)?(?:红|黑|蓝|紫|青|绿|黄|橙|灰|白|粉|金|银)(?:色|黑|红|蓝|白|灰|紫|黄|绿|粉){0,4}(?:调)?(?:背景|底色|色块)|水墨|彩墨|水彩|油画|厚涂|工笔|素描|线稿|版画|像素画|点彩|水粉|粉彩|蜡笔|卡通|动漫|动画|插画|晕染|平涂|赛璐璐|纸感|纸纹|纹理|质感|材质|写实|摄影|\b(?:watercolou?r|ink wash|oil paint(?:ing)?|impasto|cel.shad(?:ed|ing)|brushwork|painterly|rendering|texture|photorealis\w*|3d|2d|cg)\b/i.test(s))return '';
      return s.trim();
    }).filter(Boolean);
  }
  function applicationTarget(prompt,number,offered) {
    if(offered&&prompt.includes(offered))return offered;
    const mentions=Array.from(prompt.matchAll(/(?:@?参考图|图片|图|image)\s*(\d+)/gi));
    for(const m of mentions.filter(m=>Number(m[1])===number)){
      const prior=mentions.findLast(item=>item.index<m.index);
      const before=prompt.slice(prior?prior.index+prior[0].length:0,m.index).split(/[，,。；;\n]/).at(-1)||'';
      const target=before.match(/^(.{1,20}?)(?:的表面|表面)?(?:用|采用|参考|使用|借用)\s*$/)?.[1];
      if(target&&!/图|参考|不要|不变|\d/.test(target))return target;
    }
    return '';
  }
  function requestedRoles(prompt, references) {
    // The application's own writeback boundary describes all visual dimensions;
    // it does not assign those dimensions as extra roles to the preceding image.
    prompt=prompt.split(STYLE_BOUNDARY).join('');
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
      const clauses=after.replace(/但是|但|而|只要|只用|只参考|仅参考|仅用|仅采用/g,word=>'，'+word).split(/[，,。；;\n]/);
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

  function engine(state) {
    if (['direct', 'local', 'grok'].includes(state.drawingAnalysisEngine)) return state.drawingAnalysisEngine;
    try { const saved=root.localStorage.getItem('novaflow.drawing.analysis.v2');return ['direct','local','grok'].includes(saved)?saved:'direct'; } catch { return 'direct'; }
  }
  function input(context) {
    const s = context.state;
    const prompt=text(s.prompt);
    return { prompt, mode:s.mode||'img2img', negativePrompt: text(s.negativePrompt), task: TASKS[s.drawingTask] ? s.drawingTask : 'auto', engine: engine(s),
      provider: s.provider || 'local', width: s.width, height: s.height, nsfw: s.nsfw === true,
      references: requestedRoles(prompt,(s.mode==='txt2img'?[]:context.references || []).map((ref, index) => ref?.dataUrl ? { ...ref, source: index + 1, role: Object.hasOwn(ROLES,ref.drawingRole) ? ref.drawingRole : 'auto' } : null).filter(Boolean)) };
  }
  function same(a, b) {
    return ['prompt', 'mode', 'negativePrompt', 'task', 'engine', 'provider', 'width', 'height', 'nsfw'].every(k => a[k] === b[k])
      && a.references.length === b.references.length && a.references.every((r, i) => r.source === b.references[i].source && r.dataUrl === b.references[i].dataUrl && r.role === b.references[i].role);
  }
  async function key(value) {
    const parts = await Promise.all(value.references.map(async r => {
      const hash = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(r.dataUrl));
      return { source: r.source, role: r.role, hash: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') };
    }));
    return JSON.stringify({ ...value, references: parts });
  }
  function box(value) {
    if (!Array.isArray(value) || value.length !== 4 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000) || value[2] <= value[0] || value[3] <= value[1]) throw new Error('参考图分析返回了无效区域，未提交生成');
    return value.map(Math.round);
  }
  function validate(raw, source) {
    if (typeof raw === 'string') raw = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!raw || raw.schema !== SCHEMA || !text(raw.prompt) || !Array.isArray(raw.references)) throw new Error('绘图分析结果不完整，未提交生成；请重试或更换分析线路');
    const sources = new Set(source.references.map(r => r.source)), seen = new Set();
    const references = raw.references.map(r => {
      if (!sources.has(r.source) || seen.has(r.source) || !Array.isArray(r.uses) || !r.uses.length) throw new Error('参考图职责缺失或编号不匹配，未提交生成');
      seen.add(r.source);
      const used = new Set();
      const declared=source.references.find(item=>item.source===r.source),allowed=declared?.roles||[];
      const offered=r.uses.filter(u=>!(declared?.excludedRoles||[]).includes(u.role));
      const candidates=allowed.includes('none')?[{role:'none',detail:'未指定采用，不参与生成',target:'',samples:[]}]:allowed.length?offered.filter(u=>allowed.includes(u.role)):offered.slice(0,1);
      if(allowed.some(role=>!candidates.some(u=>u.role===role)))throw new Error(`图${r.source}的分析遗漏了指定用途，未提交生成`);
      const uses = candidates.map(u => {
        if (!Object.hasOwn(ROLES,u.role) || used.has(u.role) || !text(u.detail)) throw new Error('参考图用途无效，未提交生成');
        used.add(u.role);
        const samples = (u.samples || []).map(box);
        // The base is the user's complete input, not an automatically selected
        // subject thumbnail. Requested reframing belongs to the edit instruction.
        return { role: u.role, detail: text(u.detail).slice(0, 1600), target: text(u.target).slice(0, 200), box: u.role==='subject'?[0,0,1000,1000]:u.box ? box(u.box) : [0, 0, 1000, 1000], samples,
          ...(u.role==='style'&&renderingProfile(u.renderingProfile)?{renderingProfile:renderingProfile(u.renderingProfile)}:{}),
          ...(u.role==='style'?{donorExclusions:donorExclusions(u.donorExclusions)}:{}),
          ...(u.role==='subject'&&u.sourceExpression?.faces===1?{sourceExpression:{faces:1,eyes:['both-open','both-closed','one-closed'].includes(u.sourceExpression.eyes)?u.sourceExpression.eyes:'unclear',mouth:['closed-smile','open-smile','neutral','open','frown'].includes(u.sourceExpression.mouth)?u.sourceExpression.mouth:'unclear'}}:{}),
          ...(u.role==='subject'&&sourceContent(u.sourceContent)?{sourceContent:sourceContent(u.sourceContent)}:{}),
          ...(Array.isArray(u.omit)?{omit:u.omit.map(box)}:{}) };
      });
      const hint = source.references.find(item => item.source === r.source)?.role;
      if (!source.prompt && hint && hint !== 'auto' && !uses.some(u => u.role === hint)) throw new Error(`图${r.source}的分析没有采用已选用途，未提交生成`);
      return { source: r.source, uses, omit: (r.omit || []).map(box) };
    });
    if (seen.size !== sources.size) throw new Error('分析遗漏了参考图，未提交生成');
    let editEnhancer;
    if(raw.editEnhancer){
      const e=raw.editEnhancer,order=e.sourceOrder,slots=[...text(e.prompt).matchAll(/<image(\d+)>/g)].map(m=>Number(m[1]));
      const supported=e.kind==='qwen21-pe-i2i'&&e.version==='drawing-style-v1'||e.kind==='qwen21-style-observation'&&e.version==='drawing-style-observation-v1';
      if(source.engine!=='local'||source.provider!=='local'||!supported||!Array.isArray(order)||order.length!==2||new Set(order).size!==2||order.some(n=>!sources.has(n))||text(e.prompt).length>12000||slots.some(n=>n<1||n>2)||new Set(slots).size!==2||references.flatMap(r=>r.uses.map(u=>u.role)).sort().join(',')!=='style,subject')throw new Error('PE 编辑指令或参考编号无效，未提交生成');
      editEnhancer={kind:e.kind,model:text(e.model),version:e.version,prompt:text(e.prompt),renderingClass:['anime','animated-3d','painterly'].includes(e.renderingClass)?e.renderingClass:'other',sourceOrder:order.slice(),promptIds:Array.isArray(e.promptIds)?e.promptIds.map(text).slice(0,2):[]};
    }
    return { schema: SCHEMA, prompt: source.references.length ? source.prompt || TASKS[source.task] || '' : text(raw.prompt).slice(0, 12000), summary: source.references.length ? references.map(r=>`图${r.source}：${r.uses.map(u=>ROLES[u.role]).join('、')}`).join('；') : text(raw.summary).slice(0, 2000), references,
      ...(editEnhancer?{editEnhancer}:{}),preserve: (raw.preserve || []).map(text).filter(Boolean).slice(0, 24), exclude: source.references.length ? [] : (raw.exclude || []).map(text).filter(Boolean).slice(0, 24), clarification: text(raw.clarification).slice(0, 500) };
  }
  function unwrap(result) {
    if (!result || result.ok === false) throw new Error(result?.error || '绘图分析失败，未提交生成');
    const data = result.data || result.result || result;
    if (data.ok === false) throw new Error(data.error || '绘图分析失败');
    if (data.validationError || Object.hasOwn(data,'artDirection') && !data.artDirection) throw new Error(`绘图分析未通过检查：${text(data.validationError)||'参考用途或区域不完整'}；请重试或更换分析线路`);
    return data.artDirection || data.art_direction || data.plan || data.rawOutput || data.prompt || data.positivePrompt;
  }
  async function analyze(source, signal) {
    const api = root.electronAPI || {};
    const analysisImages = [];
    const usePe=source.engine==='local'&&source.provider==='local'&&!source.nsfw&&source.references.length===2&&source.references.every(r=>r.roles.length===1)&&source.references.map(r=>r.roles[0]).sort().join(',')==='style,subject';
    for (const r of source.references) {
      if (signal.aborted) throw abortError();
      analysisImages.push({ dataUrl: await analysisImage(r.dataUrl, Math.min(450000, Math.floor(6000000 / source.references.length)),usePe?1024:r.roles.includes('style')?1536:1024,usePe), name: r.name || `reference_${r.source}.png`, label: `图${r.source}`, role: r.role });
    }
    const payload = { surface: 'art', purpose: 'art-director', visualSchema: SCHEMA, currentPrompt: source.prompt, requirements: source.prompt,
      negativePrompt: source.negativePrompt, nsfw: source.nsfw, supportsNegativePrompt: false,
      artContext: { task: source.task, width: source.width, height: source.height,...(usePe?{editEnhancer:'qwen21-pe-i2i'}:{}),references: source.references.map(r => ({ source: r.source, role: r.role, roles:r.roles,...(r.excludedRoles?{excludedRoles:r.excludedRoles}:{}) })) },
      images: analysisImages };
    const fn = source.engine === 'grok' ? api.smartAiImageReverse : api.promptAssistantReverseImagePrompt;
    if (typeof fn !== 'function') throw new Error('所选绘图分析线路未就绪');
    let cancel;
    const stopped = new Promise((_, reject) => { cancel = () => reject(abortError()); signal.addEventListener('abort', cancel, { once: true }); });
    try {
      const result=validate(unwrap(await Promise.race([fn.call(api, payload), stopped])),source);
      return result;
    }
    catch(error){if(error?.name==='SyntaxError')throw new Error(source.engine==='grok'?'当前 Grok 服务未返回绘图参考分析协议；本次未提交生成，请更新服务或切换本地分析':'绘图分析返回格式无效，本次未提交生成，请重试');throw error;}
    finally { signal.removeEventListener('abort', cancel); }
  }

  function image(url) {
    return new Promise((resolve, reject) => { const i = new root.Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('参考图片读取失败')); i.src = url; });
  }
  function canvas(width, height) {
    const c = root.document.createElement('canvas'); c.width = Math.max(32, Math.round(width)); c.height = Math.max(32, Math.round(height));
    return c;
  }
  async function analysisImage(url, budget, maxSide=1024, square=false) {
    const img = await image(url);
    let size = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    for (let pass = 0; pass < 10; pass++) {
      const w=img.naturalWidth*size,h=img.naturalHeight*size,c = canvas(square?maxSide:w,square?maxSide:h), ctx = c.getContext('2d');
      ctx.fillStyle=square?'#ffffff':'#808080';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,square?(c.width-w)/2:0,square?(c.height-h)/2:0,w,h);
      const value = c.toDataURL('image/jpeg',square?Math.max(.22,.85-pass*.07):pass < 2 ? .85 - pass * .15 : .65);
      if (value.length <= budget) return value;
      if(!square)size *= .8;
    }
    throw new Error('参考图分析数据过大，请减少图片数量；本次未截断提交');
  }
  async function styleValueProfile(url) {
    const img=await image(url),c=canvas(64,64),ctx=c.getContext('2d');ctx.drawImage(img,0,0,64,64);
    const data=ctx.getImageData(0,0,64,64).data,values=[];
    for(let i=0;i<data.length;i+=4)if(data[i+3]>=128)values.push((.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255);
    if(!values.length||values.length<data.length/8)return undefined;
    values.sort((a,b)=>a-b);
    const mean=values.reduce((a,b)=>a+b,0)/values.length,median=values[Math.floor(values.length*.5)],highlight=values[Math.floor(values.length*.85)];
    const shadow=values[Math.floor(values.length*.1)],peak=values[Math.min(values.length-1,Math.floor(values.length*.95))],contrast=peak-shadow;
    const key=mean<.28||median<.22?'low':mean>.65&&median>.6?'high':'mid';
    const baseDescription=key==='low'?'整体低调，以深暗中间调和大面积暗部为主，亮部局部集中':key==='high'?'整体高调，以大面积明亮色层为主，阴影轻盈':mean>.5&&highlight>.75?'整体中高调，明亮通透的中间调与清晰暗部形成层次':'整体中间调，保留暗部、过渡色层与亮部的层次关系';
    const strongContrast=contrast>.6&&shadow<.2&&peak>.7;
    const description=baseDescription+(strongContrast?'；实测亮暗跨度较大，保留深暗部与局部亮部的鲜明反差，不把暗面均匀填亮':'');
    return {mean,median,highlight,shadow,peak,contrast,strongContrast,key,description};
  }
  function crop(ctx, img, b, x, y, w, h) {
    ctx.drawImage(img, b[0] / 1000 * img.naturalWidth, b[1] / 1000 * img.naturalHeight, (b[2] - b[0]) / 1000 * img.naturalWidth, (b[3] - b[1]) / 1000 * img.naturalHeight, x, y, w, h);
  }
  function overlaps(a, b) { return Math.max(a[0], b[0]) < Math.min(a[2], b[2]) && Math.max(a[1], b[1]) < Math.min(a[3], b[3]); }
  function styleSamples(img, proposed, omit, domain=[0,0,1000,1000], minSplit=1, maxSide=250) {
    const candidates=[], seen=new Set();
    const minimumSide=Math.min(40,(domain[2]-domain[0])/2,(domain[3]-domain[1])/2);
    // Small independent patches cannot carry a donor's whole composition. Prefer
    // visually observed regions, subdividing oversized model proposals ourselves.
    const regions=proposed.length?proposed:[domain];
    const excluded=omit.map(b=>[Math.max(0,b[0]-15),Math.max(0,b[1]-15),Math.min(1000,b[2]+15),Math.min(1000,b[3]+15)]);
    function add(region, preferred) {
      region=[Math.max(region[0],domain[0]),Math.max(region[1],domain[1]),Math.min(region[2],domain[2]),Math.min(region[3],domain[3])];
      if(region[2]<=region[0]||region[3]<=region[1])return;
      const nx=Math.max(minSplit,Math.ceil((region[2]-region[0])/maxSide)),ny=Math.max(minSplit,Math.ceil((region[3]-region[1])/maxSide));
      for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
        const b=[region[0]+x*(region[2]-region[0])/nx,region[1]+y*(region[3]-region[1])/ny,region[0]+(x+1)*(region[2]-region[0])/nx,region[1]+(y+1)*(region[3]-region[1])/ny].map(Math.round),id=b.join(',');
        if(seen.has(id)||excluded.some(o=>overlaps(b,o))||b[2]-b[0]<minimumSide||b[3]-b[1]<minimumSide)continue;seen.add(id);
        const sample=canvas(32,32),ctx=sample.getContext('2d');crop(ctx,img,b,0,0,32,32);const pixels=ctx.getImageData(0,0,32,32).data;
        let sum=0,squares=0;for(let i=0;i<pixels.length;i+=4){const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;sum+=v;squares+=v*v;}
        const variance=squares/(pixels.length/4)-Math.pow(sum/(pixels.length/4),2);
        candidates.push({b,score:variance,preferred});
      }
    }
    regions.forEach(r=>add(r,true));if(candidates.length<3)add(domain,false);
    return candidates.sort((a,b)=>Number(b.preferred)-Number(a.preferred)||b.score-a.score).slice(0,6).map(c=>c.b);
  }
  async function renderReference(ref, use, omit, status) {
    if (use.role === 'subject' && use.box.join(',') === '0,0,1000,1000') return { dataUrl: ref.dataUrl, treatment: 'subject-original' };
    if(root.navigator&&['material','background'].includes(use.role)&&typeof root.Worker!=='function')throw new Error('当前浏览器不支持参考图隔离处理，请使用新版 Chrome 或 Edge；本次未使用未隔离原图');
    if(use.role==='style')return {dataUrl:ref.dataUrl,treatment:'complete-style-reference'};
    const img = await image(ref.dataUrl), w = img.naturalWidth, h = img.naturalHeight;
    if (use.role === 'pose') {
      const { createImagePoseRecognizer, detectedPeople } = await import('./pose-reference-image.js');
      const recognizer = createImagePoseRecognizer();
      const cropped = canvas((use.box[2] - use.box[0]) / 1000 * w, (use.box[3] - use.box[1]) / 1000 * h);
      crop(cropped.getContext('2d'), img, use.box, 0, 0, cropped.width, cropped.height);
      const blob = await new Promise(resolve => cropped.toBlob(resolve, 'image/png'));
      let people;
      try { people = detectedPeople(await recognizer.detect(new File([blob], 'pose.png', { type: 'image/png' }), status)); }
      finally { recognizer.close(); }
      const {capturePose,reliablePosePeople}=await import('./art-pose-validation.js');
      people=reliablePosePeople(people);
      if (!people.length) throw new Error(`图${ref.source}未识别出可靠姿势，本次未使用人物原图代替骨架；请换用清晰姿势图`);
      const c = canvas(768 * Math.min(1, cropped.width / cropped.height), 768 * Math.min(1, cropped.height / cropped.width)), ctx = c.getContext('2d');
      ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, c.width, c.height); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, Math.min(c.width, c.height) / 100);
      const edges = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32]];
      for (const person of people) {
        edges.forEach(([a,b], i) => { const p = person.points[a], q = person.points[b]; if (Math.min(p.visibility ?? 1, q.visibility ?? 1) < .25) return; ctx.strokeStyle = ['#f5856c','#efc84a','#6ee0ac','#70bfe8'][i % 4]; ctx.beginPath(); ctx.moveTo(p.x*c.width,p.y*c.height); ctx.lineTo(q.x*c.width,q.y*c.height); ctx.stroke(); });
        const p = person.points[0]; if ((p.visibility ?? 1) >= .25) { ctx.strokeStyle='#dedede'; ctx.beginPath(); ctx.arc(p.x*c.width,p.y*c.height,Math.max(6,person.torso*Math.min(c.width,c.height)*.17),0,Math.PI*2);ctx.stroke(); }
      }
      return { dataUrl: c.toDataURL('image/png'), treatment: 'recognized-pose-skeleton', people: people.length, poseGeometry:capturePose(people) };
    }
    if (use.role === 'material') {
      if (typeof root.Worker === 'function') {
        status(`正在隔离${ROLES[use.role]}参考中的脸部…`);
        const { protectedFaceRegions } = await import('./art-reference-safety.js');
        omit=[...omit,...await protectedFaceRegions(ref.dataUrl)];
      }
      const samples = styleSamples(img,use.samples,omit,use.box,2,250);
      if (samples.length < 1) throw new Error(`图${ref.source}的${ROLES[use.role]}样本不足，无法排除脸部或文字，请重新分析`);
      const columns = Math.ceil(Math.sqrt(samples.length)), rows = Math.ceil(samples.length/columns);
      const ratios=samples.map(b=>(b[2]-b[0])*w/((b[3]-b[1])*h)).sort((a,b)=>a-b);
      const cellWidth=384,cellHeight=Math.round(cellWidth/Math.max(.4,Math.min(2.5,ratios[Math.floor(ratios.length/2)])));
      const c = canvas(columns*cellWidth,rows*cellHeight), ctx = c.getContext('2d'); ctx.fillStyle='#808080';ctx.fillRect(0,0,c.width,c.height);
      samples.forEach((b,i) => { const sw=(b[2]-b[0])*w, sh=(b[3]-b[1])*h, scale=Math.min((cellWidth-8)/sw,(cellHeight-8)/sh); crop(ctx,img,b,(i%columns)*cellWidth+(cellWidth-sw*scale)/2,Math.floor(i/columns)*cellHeight+(cellHeight-sh*scale)/2,sw*scale,sh*scale); });
      return { dataUrl: c.toDataURL('image/png'), treatment:'isolated-material-samples', samples, protectedRegions:omit };
    }
    if (use.role === 'color') {
      const sample=canvas(32,32),ctx=sample.getContext('2d'),bins=new Map(),c=canvas(512,128),out=c.getContext('2d');
      for(const b of (use.samples.length?use.samples:[use.box]).slice(0,8)){
        crop(ctx,img,b,0,0,32,32);const pixels=ctx.getImageData(0,0,32,32).data;
        for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<16)continue;const rgb=Array.from(pixels.slice(i,i+3)),key=rgb.map(v=>Math.floor(v/32)).join(',');let bin=bins.get(key);if(!bin){bin={count:0,sum:[0,0,0]};bins.set(key,bin);}bin.count++;rgb.forEach((v,n)=>bin.sum[n]+=v);}
      }
      const colors=[];
      for(const bin of [...bins.values()].sort((a,b)=>b.count-a.count)){const rgb=bin.sum.map(v=>Math.round(v/bin.count));if(colors.every(p=>p.rgb.reduce((sum,v,n)=>sum+(v-rgb[n])**2,0)>45**2))colors.push({rgb,count:bin.count});if(colors.length===6)break;}
      if(!colors.length)throw new Error(`图${ref.source}未提取出有效配色`);
      const total=colors.reduce((sum,p)=>sum+p.count,0);let x=0;
      for(const p of colors){const width=p.count/total*512;out.fillStyle=`rgb(${p.rgb.join(',')})`;out.fillRect(Math.floor(x),0,Math.ceil(width)+1,128);x+=width;}
      return {dataUrl:c.toDataURL('image/png'),treatment:'palette-only',colors:colors.map(p=>p.rgb)};
    }
    const bw=(use.box[2]-use.box[0])/1000*w,bh=(use.box[3]-use.box[1])/1000*h, scale=Math.min(1,1024/Math.max(bw,bh));
    const c=canvas(bw*scale,bh*scale),ctx=c.getContext('2d');
    if (use.role==='composition') {
      ctx.fillStyle='#808080';ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#e8e8e8';ctx.lineWidth=3;
      const shapes=use.samples.length?use.samples:[use.box]; shapes.forEach(b => ctx.strokeRect((b[0]-use.box[0])/(use.box[2]-use.box[0])*c.width,(b[1]-use.box[1])/(use.box[3]-use.box[1])*c.height,(b[2]-b[0])/(use.box[2]-use.box[0])*c.width,(b[3]-b[1])/(use.box[3]-use.box[1])*c.height));
      return {dataUrl:c.toDataURL('image/png'),treatment:'layout-geometry'};
    }
    if (use.role==='lighting') {
      const low=canvas(32,32),lc=low.getContext('2d');lc.filter='grayscale(1) blur(2px)';crop(lc,img,use.box,0,0,32,32);ctx.drawImage(low,0,0,c.width,c.height);
      return {dataUrl:c.toDataURL('image/png'),treatment:'lighting-map'};
    }
    crop(ctx,img,use.box,0,0,c.width,c.height);
    if (use.role==='background' && typeof root.Worker==='function') {
      status('正在识别背景参考的无关前景…');
      const { protectedFaceRegions }=await import('./art-reference-safety.js');
      // Saliency alone may call an empty landscape's mountain "foreground".
      // Only remove it when vision identified an unwanted region or a person.
      if(omit.length||(await protectedFaceRegions(ref.dataUrl)).length){
        const { backgroundForegroundMask }=await import('./art-reference-foreground.js');
        const mask=await backgroundForegroundMask(ref.dataUrl),layer=canvas(mask.width,mask.height),lc=layer.getContext('2d');
        const data=lc.createImageData(mask.width,mask.height);
        for(let i=0;i<mask.alpha.length;i++){data.data[i*4]=128;data.data[i*4+1]=128;data.data[i*4+2]=128;data.data[i*4+3]=mask.alpha[i];}
        lc.putImageData(data,0,0);
        ctx.drawImage(layer,use.box[0]/1000*mask.width,use.box[1]/1000*mask.height,(use.box[2]-use.box[0])/1000*mask.width,(use.box[3]-use.box[1])/1000*mask.height,0,0,c.width,c.height);
      }
    }
    if (use.role==='background' || use.role==='material') {
      ctx.fillStyle='#808080';
      omit.forEach(b => { const x=(b[0]-use.box[0])/(use.box[2]-use.box[0])*c.width,y=(b[1]-use.box[1])/(use.box[3]-use.box[1])*c.height;ctx.fillRect(x,y,(b[2]-b[0])/(use.box[2]-use.box[0])*c.width,(b[3]-b[1])/(use.box[3]-use.box[1])*c.height); });
    }
    return {dataUrl:c.toDataURL('image/png'),treatment:use.role==='background'?'background-with-foreground-removed':`${use.role}-region`};
  }
  function localStylePair(source, references) {
    if(source.provider!=='local'||source.nsfw||source.task==='preserve'||references.length!==2
      ||references.map(r=>r.role).sort().join(',')!=='style,subject')return false;
    return references.every(r=>{
      const original=source.references.find(s=>s.source===(r.sourceNumber||r.source));
      const allowed=r.role==='subject'?['subject']:['style','material','color','lighting'];
      return !original||original.roles.every(role=>allowed.includes(role));
    });
  }
  async function compile(plan, source, status, check, limit) {
    const refs=[];
    // The base content precedes its controls even if it was uploaded into a later slot.
    const uses=plan.references.flatMap(r => r.uses.filter(u=>u.role!=='none').map(u => ({r,u}))).sort((a,b) => Number(b.u.role==='subject')-Number(a.u.role==='subject'));
    if (uses.length>limit) throw new Error(`本次需 ${uses.length} 张独立参考条件，当前模型支持 ${limit} 张；请减少参考用途或切换模型。本次未丢弃图片。`);
    for (const {r,u} of uses) {
      status(`正在提取图${r.source}的${ROLES[u.role]}…`);check();
      const original=source.references.find(ref => ref.source===r.source);
      const rendered=await renderReference(original,u,u.omit||r.omit,status);check();
      const mimeType=rendered.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));/i)?.[1]?.toLowerCase();
      if(!mimeType)throw new Error(`图${r.source}的图片格式不受支持，请使用 PNG、JPEG 或 WebP`);
      const extension=mimeType==='image/jpeg'?'jpg':mimeType==='image/webp'?'webp':'png';
      const valueProfile=u.role==='style'?await styleValueProfile(rendered.dataUrl):undefined;check();
      let skinProfile,skinWarning;
      if(u.role==='style'&&(u.renderingProfile?.facialStyle||plan.editEnhancer)&&typeof root.Worker==='function'){
        status(`正在核对图${r.source}完整风格的脸部色层…`);
        try{const {observeStyleSkin}=await import('./art-style-color.js');skinProfile=await observeStyleSkin(rendered.dataUrl);}catch{skinWarning='脸部色层未能量化，保留完整参考与视觉分析';}
        check();
      }
      const profile=u.renderingProfile?{...u.renderingProfile}:undefined;
      if(profile&&skinProfile){
        const otherColors=text(profile.palette).split(/[，,；;。]/).filter(s=>!/肤色|肌肤|\bskin\b/i.test(s)).join('，');
        profile.palette=[otherColors,`脸部实测为${skinProfile.description}，不以头发或高光颜色覆盖皮肤中间调`].filter(Boolean).join('，');
      }
      const target=u.role==='material'?applicationTarget(source.prompt,r.source,u.target):u.target&&source.prompt.includes(u.target)?u.target:'';
      refs.push({name:`reference_${r.source}_${u.role}.${extension}`,mimeType,dataUrl:rendered.dataUrl,sourceIndex:r.source-1,sourceNumber:r.source,role:u.role,detail:(profile?Object.values(profile).join('；'):u.detail)+(valueProfile?`；${valueProfile.description}`:'')+(skinProfile?`；脸部像素中间调 RGB ${skinProfile.rgb.join('/')}`:'')+(skinWarning?`；${skinWarning}`:''),target,treatment:rendered.treatment,...(profile?{renderingProfile:profile}:{}),...(skinProfile?{skinProfile}:{}),...(u.donorExclusions?{donorExclusions:u.donorExclusions}:{}),...(u.sourceExpression?{sourceExpression:u.sourceExpression}:{}),...(u.sourceContent?{sourceContent:u.sourceContent}:{}),...(valueProfile?{valueProfile}:{}),...(rendered.poseGeometry?{poseGeometry:rendered.poseGeometry}:{})});
    }
    const restyle=refs.some(r=>r.role==='style');
    const rules={subject:restyle?'提供创作内容，造型由目标画风重建':'提供主体身份和设计；仅保留未被用户指定修改的内容',style:'提供完整画风，包括五官构建、线条上色、材质和整体光感；参考人物和场景物件不作为新增内容',pose:'实际识别的姿势骨架，只采用关节方向和肢体关系；不画骨架、彩线或原姿势图人物',background:'只采用环境与空间；灰色遮挡区表示被移除的无关前景，需要自然补全，不能画成灰色块',material:'只向指定目标应用表面材质，不借用原物件形状、人物或背景；未明确要求改变颜色时保留目标原有颜色',color:'只采用色彩关系，不画色块或色板；配色参考优先于风格参考的色调',composition:'只采用区域位置、尺度和空间层次，不画矩形框',lighting:'只采用明暗和光照方向，不复制参考内容；光影参考优先于风格参考的明暗组织',object:'只采用指定物件，排除周围人物与背景'};
    // Style captions often mingle drawing technique with depicted effects or
    // scenery. Its isolated pixels carry the technique; never promote such a
    // caption into requested content.
    // Bind the displayed original number to its actual encoded slot. Qwen 2.1
    // is trained on <imageN> markers, not natural-language image numbering.
    const imageLabel=i=>source.provider==='local'&&refs.length>1?`<image${i+1}>`:`输入图片${i+1}`;
    const instructions=refs.map((r,i)=>`${imageLabel(i)}（原图${r.sourceNumber}，${ROLES[r.role]}${r.target?`，用于${r.target}`:''}）：${rules[r.role]}`).join('\n');
    const request=source.prompt.replace(/(?:@?参考图|图片|图|image)\s*(\d+)/gi,(_,n)=>{
      const bindings=refs.flatMap((r,i)=>r.sourceNumber===Number(n)?[imageLabel(i)]:[]);
      return bindings.length?bindings.join('、'):`未采用的原图${n}`;
    });
    const taskText=TASK_BRIEFS[source.task]||TASK_BRIEFS.auto;
    const actions=refs.flatMap(r=>{
      const rendering=roleRendering(r.role,r.detail);if(!rendering)return [];
      return r.role==='pose'?[`将主体的实际动作改为：${rendering}。直接替换原动作，清除骨架和彩色辅助线。`]:r.role==='material'?[`将${r.target||'用户指定部位'}的表面改为${rendering}，保留未要求改变的款式与配色。`]:r.role==='background'?[`将主体原背景替换为${rendering}，原背景不再出现。`]:[];
    }).join('\n');
    const accessories=refs.filter(r=>r.role==='subject').map(r=>roleRendering('subject',r.detail)).filter(Boolean).join('、');
    const sourcePreserve=accessories&&!restyle?`未被用户明确要求修改的主体配饰必须保留，包括主体原有的${accessories}；不要因改变姿势、背景或衣物材质而删除这些原有配饰。`:'';
    // A vision caption may over-describe a donor. For reference work the
    // executable brief comes from the user's words and scoped visual uses,
    // rather than accepting an unconstrained merged caption as new intent.
    const brief=source.references.length?`${restyle?'':taskText+'。'}${request?`用户要求：${request}。`:''}`:plan.prompt;
    const styleInputs=refs.flatMap((r,i)=>r.role==='style'?[imageLabel(i)]:[]).join('、');
    const subjectInputs=refs.flatMap((r,i)=>r.role==='subject'?[imageLabel(i)]:[]).join('、');
    const styleBoundary=STYLE_BOUNDARY;
    const styleDirective=styleInputs?`以${subjectInputs||'用户要求的画面'}为内容参考，用${styleInputs}的完整画风整体重新绘画。五官比例、面部体积、轮廓概括、线条上色、皮肤与发丝质感及全画面光感均由目标画风重新构建。${styleBoundary}` : '';
    const profileLabels={medium:'媒介',facialStyle:'五官画法',markMaking:'线条与造型',shading:'上色明暗',surface:'质感',lightingStyle:'照明',palette:'整体配色与肤色色层'};
    const separateLighting=refs.some(x=>x.role==='lighting')||/(?:保持|保留|不改|不改变).{0,8}(?:光感|光线|照明|光照|打光)|(?:光感|光线|照明|光照|打光).{0,5}不变/.test(source.prompt);
    const separateColor=refs.some(x=>x.role==='color')||/(?:保持|保留|不改|不改变).{0,8}(?:配色|色调|颜色)|(?:配色|色调|颜色).{0,5}不变/.test(source.prompt);
    const preserveSkin=/(?:保持|保留|不改|不改变).{0,8}(?:肤色|皮肤颜色)|(?:肤色|皮肤颜色).{0,5}不变/.test(source.prompt);
    const volumeRequested=source.prompt.split(/[，,。；;\n]/).some(s=>/半写实|\b3d\b|三维|立体(?:渲染|质感)/i.test(s)&&!/(?:不要|不采用|禁止|拒绝|非).{0,4}(?:半写实|3d|三维|立体)/i.test(s));
    const conflictsWithVolume=r=>volumeRequested&&/(?:二维|\b2d\b|赛璐璐)/i.test(r.renderingProfile?.medium||'')&&!/3d|三维|半写实/i.test(r.renderingProfile?.medium||'');
    const styleMethods=refs.flatMap((r,i)=>r.role==='style'?[`${imageLabel(i)}的实际视觉属性：${Object.entries(r.renderingProfile||{}).filter(([k])=>!(k==='lightingStyle'&&separateLighting||k==='palette'&&separateColor)&&(!conflictsWithVolume(r)||['lightingStyle','palette'].includes(k))).map(([k,v])=>{
      if(k==='palette')v=v.split(/[，,；;。]/).filter(s=>!(preserveSkin&&/肤色|皮肤颜色|skin/i.test(s))&&!(separateLighting&&/高光|阴影|亮部|暗部|光色|highlight|shadow/i.test(s))).join('，');
      return `${profileLabels[k]}：${k==='lightingStyle'&&r.valueProfile&&r.valueProfile.key!=='mid'?v.replace(/高调|低调/g,''):v}`;
    }).concat(!separateLighting&&r.valueProfile?[`整体明暗：${r.valueProfile.description}`]:[]).join('；')}`]:[]).join('\n');
    const expressions=restyle&&!/表情|眨眼|睁眼|闭眼|微笑|大笑|哭|愤怒|悲伤|smil|wink|expression|eyes?/i.test(source.prompt)?refs.flatMap((r,i)=>{
      if(r.role!=='subject'||r.sourceExpression?.faces!==1)return [];
      const eyes={'both-open':'双眼睁开','both-closed':'双眼闭合','one-closed':'一只眼闭合眨眼、另一只眼睁开'}[r.sourceExpression.eyes];
      const mouth={'closed-smile':'闭口微笑','open-smile':'张嘴微笑','neutral':'嘴部自然放松','open':'嘴部张开','frown':'嘴角下垂'}[r.sourceExpression.mouth];
      return eyes||mouth?[`保持${imageLabel(i)}原有的${[eyes,mouth].filter(Boolean).join('、')}表情；五官比例仍按目标画风重绘。`]:[];
    }).join('\n'):'';
    const contentLabels={scene:'场景',clothing:'服饰款式与图案',objects:'持有物',action:'动作'};
    const sourceFacts=restyle?refs.flatMap((r,i)=>{
      if(r.role!=='subject'||!r.sourceContent)return [];
      const facts=Object.entries(retainedContent(r,source,refs)).map(([k,v])=>`${contentLabels[k]}：${v}`);
      return facts.length?[`${imageLabel(i)}主要内容：${facts.join('；')}。保留类别与含义，具体造型和细节交给目标画风重构。`]:[];
    }).join('\n'):'';
    const replacements=[refs.some(r=>r.role==='pose')?'将主体原来的人物直接重绘为指定骨架姿势，替换原姿势；保持原人物数量，只改变原人物，不追加人物、分身、残影，不保留旧姿势的人物。':'',refs.some(r=>r.role==='background')?`用指定环境替换主体原背景，保持主体身份和数量${refs.some(r=>r.role==='pose')?'，姿势按指定骨架执行':'及未指定修改的姿势'}；原背景不再出现，不添加背景参考中的人物或动物。`:''].filter(Boolean).join('\n');
    const lockedFraming=/(?:保持|保留|不改变|不要改变|不改).{0,8}(?:构图|取景|轮廓)|(?:构图|取景|轮廓).{0,5}(?:不变|保持|保留)/.test(source.prompt);
    const framing=refs.some(r=>r.role==='subject')&&!refs.some(r=>r.role==='pose'||r.role==='composition')&&(!restyle||lockedFraming)?'保持主体的相对位置、大小与原有取景，不裁掉原图已显示的头、手或脚；输出比例改变时自然延展背景适配。':'';
    const pairStyle=refs.length===2&&refs[0].role==='subject'&&refs[1].role==='style'&&refs[1].renderingProfile?.medium;
    const operation=pairStyle?conflictsWithVolume(refs[1])?`以${imageLabel(1)}为视觉参考，按照用户指定的立体材质与体积表现整体重新塑造和渲染${imageLabel(0)}；不执行与此要求冲突的二维简化标签。`:`将${imageLabel(0)}整幅重绘成${imageLabel(1)}的${refs[1].renderingProfile.medium}。`:styleDirective;
    const contentBoundary=pairStyle?styleBoundary:'';
    // Local Qwen receives negative text through its conditioning input. Cloud
    // providers without that input still need their exclusions in the request.
    const negativeInstruction=source.provider==='local'&&!source.nsfw?'':source.negativePrompt&&`必须避免：${source.negativePrompt}`;
    let prompt=[operation,styleMethods,contentBoundary,sourceFacts,expressions,actions,brief,sourcePreserve,replacements,framing,instructions&&`图片职责（括号内原图编号对应原始参考编号）：\n${pairStyle?refs.map((r,i)=>`${imageLabel(i)}（原图${r.sourceNumber}，${ROLES[r.role]}）`).join('\n'):instructions}`,negativeInstruction,
      '只输出一张完整成图。遵循指定画风精修构图、结构、边缘、光影与材质；不增加需求以外的人物、物件、装饰、文字、拼图或采样板。'].filter(Boolean).join('\n\n');
    if(plan.editEnhancer){
      const edited=plan.editEnhancer.prompt.replace(/<image(\d+)>/g,(_,n)=>imageLabel(refs.findIndex(r=>r.sourceNumber===plan.editEnhancer.sourceOrder[Number(n)-1])));
      const drawnPe=plan.editEnhancer.kind==='qwen21-pe-i2i'&&plan.editEnhancer.renderingClass==='anime';
      const valueEvidence=!separateLighting?refs.flatMap((r,i)=>{
        if(r.role!=='style'||!r.valueProfile)return [];
        // The approved PE drawing contract needs a correction only when its
        // exposure claim contradicts the pixels, not another global grade.
        if(drawnPe&&!(/整体低调/.test(r.valueProfile.description)&&/明亮|高调|通透/.test(edited)||/整体中高调|整体高调/.test(r.valueProfile.description)&&/整体低调|整体昏暗|整体阴暗/.test(edited)))return [];
        return [`${imageLabel(i)}完整参考像素的整体明暗校验：${r.valueProfile.description}。该校验优先于文字分析中不一致的明暗判断；只约束整体曝光，不压平参考中的光影反差，具体照明与视觉表现仍采用完整风格原图。`];
      }).join('\n'):'';
      // A lit skin color is not a material's diffuse color. Do not flatten a
      // volumetric target's colored light and shadow to one measured midtone.
      const colorEvidence=plan.editEnhancer.renderingClass==='anime'&&!volumeRequested&&!separateColor&&!separateLighting&&!preserveSkin?refs.flatMap((r,i)=>r.role==='style'&&r.skinProfile?[`${imageLabel(i)}完整风格的皮肤实测为${r.skinProfile.description}；${drawnPe?'采用该肤色色层':'只校验皮肤中间调，不统一铺色，受光高光与阴影的冷暖和深浅仍按完整参考'}，不继承照片的暖黄色偏色。`]:[]).join('\n'):'';
      prompt=[edited,styleBoundary,valueEvidence,colorEvidence,plan.editEnhancer.kind==='qwen21-style-observation'?expressions:'',brief,negativeInstruction,'只输出一张完整成图，不增加需求以外的人物、文字或采样板。'].filter(Boolean).join('\n\n');
    }
    // PE has its own editing contract rather than seven observer fields. Keep
    // the same rendering-only guidance when PE actually names an anime target.
    const anime=refs.filter(r=>r.role==='style').map(r=>r.renderingProfile).filter(Boolean);
    if(!anime.length&&plan.editEnhancer?.renderingClass==='anime')anime.push({medium:'二维动漫'});
    let renderingNegative='';
    const faceLocked=source.prompt.split(/[，,。；;\n]/).some(s=>!/(?:不要|不必|无需|不要求|不强制).{0,4}(?:保持|保留)/.test(s)&&/(?:保持|保留|不改|不改变|不要改|不要改变).{0,8}(?:摄影|写实|真实五官|脸型|面部轮廓|五官比例|眼型)|(?:五官|脸型).{0,5}不变/.test(s));
    if(source.provider==='local'&&!source.nsfw&&plan.editEnhancer?.renderingClass==='animated-3d'&&!faceLocked)renderingNegative='photographic facial proportions, live action human face';
    if(source.provider==='local'&&!source.nsfw&&!volumeRequested&&anime.length===1&&/(?:anime|动漫|动画|二次元)/i.test(anime[0].medium||'')&&!/3D|三维|半写实|写实|\bcg\b|厚涂|油画|水墨|水彩|semi.?real/i.test(anime[0].medium||'')&&!faceLocked){
      const avoid=['photograph','photorealistic facial proportions','realistic nose and lips','photographic skin texture'];
      if(/团块|成组|大束|分组|grouped|broad.*mass/i.test(anime[0].markMaking||''))avoid.push('dense individually rendered hair strands');
      if(/无(?:明显)?(?:纸纹|笔触)|无纸纹或笔触|无笔触或纸纹|无毛边|no.*(?:grain|brush)/i.test(anime[0].surface||''))avoid.push('rough painterly hatching','sketchy outlines','paper grain');
      if(!separateColor&&!preserveSkin&&!separateLighting&&(/肤色[^，；。]*(?:米白|粉白|浅粉|淡粉|桃粉|白皙|奶白|象牙白)|skin[^,;.]*(?:ivory|pale pink|rosy)/i.test(anime[0].palette||'')||refs.some(r=>r.role==='style'&&r.skinProfile?.value>.65&&['粉','桃粉'].includes(r.skinProfile.hue))))avoid.push('yellow-orange skin color cast','oversaturated orange skin','monochromatic warm color grading');
      renderingNegative=avoid.join(', ');
    }
    const approvedPe=plan.editEnhancer?.kind==='qwen21-pe-i2i'&&['anime','painterly'].includes(plan.editEnhancer.renderingClass);
    const isolatedDonor=!approvedPe&&source.provider==='local'&&!source.nsfw&&(pairStyle||plan.editEnhancer)?refs.find(r=>r.role==='style')?.donorExclusions||[]:[];
    const automaticNegative=[renderingNegative,...isolatedDonor].filter(Boolean).join(', ');
    // This opt-in is narrower than renderingPolicy: animated 3D and donor-only
    // exclusions also use that policy, but retain Turbo's default CFG 1.
    const turboGuidance=renderingNegative&&plan.editEnhancer?.renderingClass==='anime'&&localStylePair(source,refs)?{renderingClass:'anime',cfg:3}:null;
    return {references:refs,promptSnapshot:{prompt,negativePrompt:[source.negativePrompt,automaticNegative].filter(Boolean).join(', ')},...(automaticNegative?{renderingPolicy:{cfg:3,negativePrompt:automaticNegative}}:{}),...(turboGuidance?{turboGuidance}:{}),...(localStylePair(source,refs)||(isolatedDonor.length||plan.editEnhancer)&&!lockedFraming&&!separateColor&&!preserveSkin&&!separateLighting?{referencePolicy:{stylePriority:true}}:{})};
  }
  function directPreparation(source, written) {
    if(!source.prompt)throw new Error('请写一句要求，例如“换成白色衬衫”；需要自动理解参考图时可选择本地AI');
    // An unchanged compiled prompt still addresses the slots selected by AI.
    // Explicit local subject/style pairs use the same slot order and image
    // budgets with or without AI. Other edits retain their upload order.
    let inputs=written?written.order.map(({sourceNumber,role})=>({...source.references.find(ref=>ref.source===sourceNumber),roles:[role]})):source.references;
    if(localStylePair(source,inputs.map(r=>({source:r.source,role:r.roles[0]}))))inputs=[...inputs].sort((a,b)=>Number(b.roles[0]==='subject')-Number(a.roles[0]==='subject'));
    const references=inputs.map(ref=>{
      const mimeType=ref.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));/i)?.[1]?.toLowerCase();
      if(!mimeType)throw new Error(`图${ref.source}的图片格式不受支持，请使用 PNG、JPEG 或 WebP`);
      const extension=mimeType==='image/jpeg'?'jpg':mimeType==='image/webp'?'webp':'png';
      return {name:`reference_${ref.source}_direct.${extension}`,mimeType,dataUrl:ref.dataUrl,sourceIndex:ref.source-1,sourceNumber:ref.source,role:ref.roles[0]||'auto',detail:'原始完整参考图',treatment:'direct-original'};
    });
    const prompt=source.references.length?source.prompt.replace(/(?:@?参考图|图片|图|image)\s*(\d+)/gi,(mention,number)=>{
      const index=references.findIndex(ref=>ref.sourceNumber===Number(number));
      if(index<0)throw new Error(`图${number}不存在，请检查参考图编号`);
      return `<image${index+1}>`;
    }):source.prompt;
    return {direct:true,references,promptSnapshot:{prompt,negativePrompt:source.negativePrompt},...(localStylePair(source,references)?{referencePolicy:{stylePriority:true}}:written?.policy?{referencePolicy:copy(written.policy)}:{}),...(written?.turboGuidance?{turboGuidance:copy(written.turboGuidance)}:{}),plan:{schema:SCHEMA,summary:'无AI · 未进行提示词分析或优化',prompt:source.prompt,preserve:[],exclude:[],clarification:'',references:[]}};
  }
  async function prepare(context) {
    if (controller) throw new Error('请等待当前绘图分析结束');
    const current=new AbortController();controller=current;
    const source=input(context),status=context.onProgress||(()=>{});let preparing=true,expectedSource=source;
    previews.delete(context.state);
    const check=()=>{if(current.signal.aborted)throw abortError();if(!same(expectedSource,input(context.getCurrentContext?context.getCurrentContext():context)))throw new Error('参考图、用途、需求或尺寸已变化，旧分析未提交，请重新生成');if(preparing&&context.getCurrentContext?.().generationSurface && context.getCurrentContext().generationSurface!=='drawing')throw new Error('绘图页面已切换，旧任务未提交');};
    try {
      if(!source.prompt&&!source.references.length)throw new Error('请写一句需求，或添加参考图后直接生成');
      if(source.references.length>(context.referenceLimit||10))throw new Error(`当前模型支持 ${context.referenceLimit||10} 张参考图，请减少图片或切换模型；本次未截断提交`);
      let written=writtenReferencePolicies.get(context.state);
      // Choosing 无AI is expected after writeback. Every actual input change
      // invalidates the saved policy, including pixels, roles and source order.
      if(written&&!same({...written.source,engine:source.engine},source)){
        writtenReferencePolicies.delete(context.state);written=null;
      }
      const cacheKey=await key(source);check();
      let prepared=CACHE.get(cacheKey);
      if(!prepared){
        if(source.engine==='direct'){
          status('正在准备直接生成…');prepared=directPreparation(source);check();
        }else{
          status(source.references.length?'正在理解需求与参考图片…':'正在完善画面表现…');
          const plan=await analyze(source,current.signal);check();
          if(plan.clarification)throw new Error(`需要补充一句：${plan.clarification}`);
          prepared={...(await compile(plan,source,status,check,context.referenceLimit||10)),plan};check();
        }
        CACHE.set(cacheKey,prepared);if(CACHE.size>4)CACHE.delete(CACHE.keys().next().value);
      }
      // Apply state-specific replay outside CACHE: a new direct request with the
      // same text must not inherit another state object's AI routing policy.
      if(source.engine==='direct'&&written)prepared=directPreparation(source,written);
      previews.set(context.state,{...prepared,originalPrompt:source.prompt});
      const state=copy(Object.fromEntries(GENERATION_SETTINGS.filter(k=>Object.hasOwn(context.state,k)).map(k=>[k,context.state[k]])));
      // A complete restyle must be free to rebuild facial planes and illumination.
      if(!prepared.direct&&prepared.references.some(r=>r.role==='style')||localStylePair(source,prepared.references))state.uiPreserveLayout=false;
      if(prepared.direct&&written&&typeof written.uiPreserveLayout==='boolean')state.uiPreserveLayout=written.uiPreserveLayout;
      state.mode=prepared.references.length?'img2img':'txt2img';state.localDrawEngine=root.NovaFlowArtGenerateModels?.capabilityFor?.(state.provider,state.mode,state)?.engine||'';
      if(prepared.renderingPolicy&&state.localDrawEngine==='qwen-2.1'&&state.localQwen21Variant!=='turbo'){
        state.negativePrompt=prepared.promptSnapshot.negativePrompt;
        const route=`qwen-2.1:${state.mode}`,overrides=state.samplingOverrides||{},manual=overrides[route]||{};
        state.samplingOverrides={...overrides,[route]:{...manual,cfg:Number(manual.cfg)>0?manual.cfg:prepared.renderingPolicy.cfg}};
      }
      if(prepared.turboGuidance&&state.localDrawEngine==='qwen-2.1'&&state.localQwen21Variant==='turbo')state.negativePrompt=prepared.promptSnapshot.negativePrompt;
      preparing=false;
      return {...prepared,state,analysisInput:source,originalPrompt:source.prompt,assertCurrent:check,
        applyPromptToState:()=>{
          check();if(prepared.direct)return false;
          context.state.prompt=prepared.promptSnapshot.prompt.replace(/<image(\d+)>/g,(tag,n)=>{
            const ref=prepared.references[Number(n)-1];return ref?`@参考图${ref.sourceNumber||Number(n)}`:tag;
          });
          context.state.negativePrompt=prepared.promptSnapshot.negativePrompt;
          if(prepared.renderingPolicy&&state.localDrawEngine==='qwen-2.1'&&state.localQwen21Variant!=='turbo'){
            const route=`qwen-2.1:${state.mode}`,overrides=context.state.samplingOverrides||{},manual=overrides[route]||{},requestedCfg=Number(manual.cfg);
            const cfg=Number.isFinite(requestedCfg)&&requestedCfg>0?manual.cfg:state.samplingOverrides[route].cfg;
            context.state.samplingOverrides={...overrides,[route]:{...manual,cfg}};
            state.samplingOverrides={...state.samplingOverrides,[route]:{...state.samplingOverrides[route],cfg}};
          }
          // An automatic style default is run metadata, never a persistent
          // manual override. Preserve any CFG the user typed during analysis.
          if(state.localDrawEngine==='qwen-2.1'&&state.localQwen21Variant==='turbo')state.samplingOverrides=copy(context.state.samplingOverrides||{});
          expectedSource=input(context.getCurrentContext?context.getCurrentContext():context);
          if(prepared.references.length===2&&prepared.references[0].role==='subject'&&prepared.references[1].role==='style'){
            writtenReferencePolicies.set(context.state,{source:expectedSource,...(prepared.referencePolicy?{policy:copy(prepared.referencePolicy)}:{}),...(prepared.turboGuidance?{turboGuidance:copy(prepared.turboGuidance)}:{}),uiPreserveLayout:state.uiPreserveLayout,order:prepared.references.map(ref=>({sourceNumber:ref.sourceNumber,role:ref.role}))});
          }else writtenReferencePolicies.delete(context.state);
          return true;
        },
        recordReview:review=>{const previous=previews.get(context.state);if(previous)previous.review=review;}};
    } finally {if(controller===current)controller=null;}
  }
  async function review(prepared, outputUrl, onProgress = () => {}) {
    if(prepared.direct){
      prepared.assertCurrent();
      const result={schema:'nf.art.review.v1',pass:null,skipped:true,issues:[],repair:'',reason:'直接生成未调用分析或复审模型'};
      prepared.recordReview?.(result);return result;
    }
    if(prepared.analysisInput.engine==='local'&&(!prepared.references.length||prepared.plan.editEnhancer?.kind==='qwen21-pe-i2i')){
      prepared.assertCurrent();
      const result={schema:'nf.art.review.v1',pass:null,skipped:true,issues:[],repair:'',reason:'PE 单次分析线路不再调用额外模型复审'};
      prepared.recordReview?.(result);return result;
    }
    if(controller)throw new Error('请等待当前绘图分析结束');
    const current=new AbortController();controller=current;
    let stop;
    try {
      prepared.assertCurrent();onProgress('正在检查成图与参考需求…');
      let poseCheck;
      const poseReference=prepared.references.find(r=>r.role==='pose');
      if(poseReference){
        onProgress('正在独立核对成图的实际肢体方向…');
        const {comparePose,observePose}=await import('./art-pose-validation.js');
        const geometry=await observePose(outputUrl,onProgress);
        if(current.signal.aborted)throw abortError();prepared.assertCurrent();
        poseCheck=comparePose(poseReference.poseGeometry||[],geometry);
      }
      const source=prepared.analysisInput, images=[];
      const activeSources=new Set(prepared.references.map(r=>r.sourceNumber));
      const originals=[{source:0,dataUrl:outputUrl,role:'output'},...source.references.filter(r=>activeSources.has(r.source)).map(r=>({...r,role:prepared.plan.references.find(p=>p.source===r.source)?.uses[0]?.role||r.role}))];
      for(const r of originals){if(current.signal.aborted)throw abortError();images.push({dataUrl:await analysisImage(r.dataUrl,Math.min(450000,Math.floor(6000000/originals.length))),name:`review_${r.source}.jpg`,label:r.source?`原始图${r.source}`:'生成结果',role:r.role});}
      // Review the user's contract, not a model caption that may itself have
      // introduced an unrequested motif. Original pixels remain available.
      const actualUses=new Map();
      for(const ref of prepared.references){
        if(!actualUses.has(ref.sourceNumber))actualUses.set(ref.sourceNumber,[]);
        actualUses.get(ref.sourceNumber).push({role:ref.role,target:ref.target,...(ref.renderingProfile?{renderingProfile:ref.renderingProfile}:{}),...(ref.donorExclusions?.length?{forbiddenDonorContent:ref.donorExclusions}:{}),...(ref.role==='subject'?{retainedContent:retainedContent(planContent(ref,prepared.plan),source,prepared.references),retainedExpression:retainedExpression(ref,source)}:{})});
      }
      const contract={styleBoundary:'主体提供辨识特征与主要内容：主要动作、服饰类别、持有物与场景类型仍可辨认。造型比例、轮廓、衣褶、背景安排和具体细节允许整体重构，成图质量与协调氛围优先，无需逐处对应原照片。五官构建、线条、上色、质感、整体配色、肤色色层和照明都以风格参考为准。必须比较目标参考的色相、饱和度与冷暖层次；原照片的暖棕色不能覆盖目标配色。不能替换成供体人物或供体服饰、场景物件；精灵耳、叶饰、露肤程度不是画风，其缺失绝不能判错或要求补入。用户明确保留要求或独立参考职责优先',task:source.task,rendering:TASK_BRIEFS[source.task]||TASK_BRIEFS.auto,references:[...actualUses].map(([source,uses])=>({source,uses}))};
      const payload={surface:'art',purpose:'art-director-review',visualSchema:'nf.art.review.v1',currentPrompt:source.prompt,nsfw:source.nsfw,
        artContext:{task:source.task,references:originals.map(r=>({source:r.source,role:r.role})),plan:contract},images};
      const fn=source.engine==='grok'?root.electronAPI?.smartAiImageReverse:root.electronAPI?.promptAssistantReverseImagePrompt;
      const stopped=new Promise((_,reject)=>{stop=()=>reject(abortError());current.signal.addEventListener('abort',stop,{once:true});});
      let response;
      for(let attempt=0;attempt<4;attempt++){
        if(current.signal.aborted)throw abortError();prepared.assertCurrent();
        response=await Promise.race([fn.call(root.electronAPI,payload),stopped]);
        if(source.engine!=='local'||response?.ok!==false||!['runtime-generation-busy','prompt-assistant-busy'].includes(response.errorCode)||attempt===3)break;
        onProgress('正在等待本地生成结束交接，再检查成图…');
        await Promise.race([new Promise(resolve=>setTimeout(resolve,1000*2**attempt)),stopped]);
      }
      prepared.assertCurrent();
      if(response?.ok===false)throw new Error(response.error||'成图检查失败');
      const data=response?.data||response?.result||response;
      const checked=data?.artReview||data?.art_review;
      if(!checked||checked.schema!=='nf.art.review.v1'||typeof checked.pass!=='boolean'||!Array.isArray(checked.issues)||(!checked.pass&&(!checked.issues.length||!text(checked.repair))))throw new Error('成图检查未返回有效结论');
      const result={schema:checked.schema,pass:checked.pass,issues:checked.issues.map(text).slice(0,12),repair:text(checked.repair).slice(0,1800)};
      // Review prose is not new user intent. Rebuild a style correction from
      // the already approved reference roles instead of executing donor nouns.
      if(!result.pass&&prepared.references.some(r=>r.role==='style')){
        result.repair='以主体图的辨识特征与主要内容为参考，严格对照完整风格参考重构五官比例、轮廓概括、线条上色、皮肤与发丝质感、整体配色与全画面光感。造型与细节无需逐处对应照片，配色、肤色色层和协调氛围以目标风格为准；其他参考按指定职责执行，不得替换成供体人物或补入供体服饰、场景物件或无关特效。';
        result.repairOrigin='reference-contract';
      }
      if(poseCheck){
        result.poseCheck=poseCheck;
        if(!poseCheck.pass){result.pass=false;result.issues.unshift(poseCheck.issue);result.repair=[result.repair,'将同一主体的实际肢体改为姿势参考的方向和弯曲关系，替换原动作；清除骨架和彩色辅助线，保留正确身份、服饰与其他已完成要求'].filter(Boolean).join('；');}
      }
      prepared.recordReview?.(result);return result;
    } finally {if(stop)current.signal.removeEventListener('abort',stop);if(controller===current)controller=null;}
  }
  function cancelPreparation(){if(!controller)return false;controller.abort();return true;}
  function controls(create,state,refresh) {
    const row=create('div',{className:'nf-art-direction-controls'});
    const titles={direct:'不调用提示词分析模型；使用原始提示词和完整参考图直接生图',local:'使用本地 PE 理解需求与参考，自动整理生图指令',grok:'使用云端 Grok 理解参考并检查成图，会使用现有 Grok 分析次数'};
    for(const [value,label]of [['direct','无AI'],['local','本地AI'],['grok','云端AI']])row.appendChild(create('button',{type:'button',title:titles[value],'data-active':engine(state)===value?'1':'0','aria-pressed':engine(state)===value?'true':'false',text:label,onclick:()=>{state.drawingAnalysisEngine=value;try{root.localStorage.setItem('novaflow.drawing.analysis.v2',value);}catch{}refresh();}}));
    return row;
  }
  function analysisControl(create,state) {
    return null;
  }
  function referenceControl(create,ref,number) {
    return create('span',{className:'nf-art-direction-reference',text:`图${number}`});
  }
  function generationOptions(prepared){
    const referenceRoles=prepared.references.map(r=>r.role),styleReferencePriority=prepared.referencePolicy?.stylePriority===true;
    const guided=styleReferencePriority&&referenceRoles.length===2&&referenceRoles[0]==='subject'&&referenceRoles[1]==='style'
      &&prepared.turboGuidance?.renderingClass==='anime'&&Number(prepared.turboGuidance.cfg)===3;
    return {taskProfile:'art-direction',referenceRoles,styleReferencePriority,...(guided?{qwen21TurboGuidance:{renderingClass:'anime',cfg:3}}:{})};
  }
  // The panel and a reused NoAI run consult the same validated writeback. A
  // changed prompt, negative, image or role cannot inherit a stale style CFG.
  function samplingOptions(context){
    const written=writtenReferencePolicies.get(context.state),source=input(context);
    if(!written||!same({...written.source,engine:source.engine},source))return {};
    return generationOptions({references:written.order,referencePolicy:written.policy,turboGuidance:written.turboGuidance});
  }
  root.NovaFlowArtDirection=Object.freeze({schema:SCHEMA,roles:ROLES,prepare,review,cancelPreparation,controls,analysisControl,referenceControl,generationOptions,samplingOptions,validate,compile,input,same,renderReference,roleRendering});
})(typeof window!=='undefined'?window:globalThis);

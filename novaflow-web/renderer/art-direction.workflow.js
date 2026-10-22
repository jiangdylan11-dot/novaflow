(function (root) {
  'use strict';
  const SCHEMA = 'nf.art.direction.v1';
  const ROLES = Object.freeze({ subject: '主体', style: '风格', pose: '姿势', background: '背景', material: '材质', color: '配色', composition: '构图', lighting: '光影', object: '物件', none: '不使用' });
  const TASKS = Object.freeze({ auto: '自动理解', anime: '转二次元', game_cg: '转游戏 CG', style: '参考画风', preserve: '精修原图' });
  const GENERATION_SETTINGS=['provider','mode','prompt','negativePrompt','width','height','count','seed','randomSeed','nsfw','loras','samplingOverrides','gptQualityTxt2img','gptQualityImg2img','gptSize','gptCustomWidth','gptCustomHeight','googleAspectRatioTxt2img','googleAspectRatioImg2img','googleResolution','localDrawEngine','drawingTask','drawingAnalysisEngine'];
  const TASK_BRIEFS=Object.freeze({auto:'依照用户要求处理主体参考，未指定改变的内容保持',anime:'保留主体身份、设计和数量，将整幅照片重新绘制为精致二次元插画，使用明确的手绘轮廓、概括造型与分层明暗，不保留摄影皮肤纹理',game_cg:'保留主体身份、服饰、姿势和数量，将整幅照片重新绘制为高完成度的半写实游戏角色宣传插画。使用数字厚涂、概括而精准的手绘体积塑造、精致五官与头发分组、统一的绘画光影和材质笔触。人物、衣服和环境都必须重新绘画，呈现明确的游戏原画CG质感，去除摄影皮肤毛孔与镜头散景，不是照片美化或摄影滤镜',style:'保留主体内容，采用指定风格的绘画语言',preserve:'精修原图，保持原有设计'});
  const CACHE = new Map();
  const previews = new WeakMap();
  let controller = null;
  let previewNumber=0;
  const text = value => String(value ?? '').trim();
  const copy = value => JSON.parse(JSON.stringify(value));
  const abortError = () => Object.assign(new Error('任务已中止'), { name: 'AbortError' });
  const ROLE_WORDS = [['style',/风格|画风|笔触|上色|渲染方式/i],['pose',/姿势|姿态|动作|骨架/i],['background',/背景|环境|场景/i],['material',/材质|质感|纹理|面料/i],['color',/配色|色彩|颜色|色板/i],['composition',/构图|镜头|透视|景别/i],['lighting',/光影|光照|光线|光感|打光|照明/i],['object',/武器|道具|物件|物品|帽子|鞋子|服装款式|衣服款式|衣服造型/i],['subject',/身份|长相|脸部|(?:主体|人物|角色)(?:和|与|、|及)|(?:主体|人物|角色)(?![^，。；]*?(?:风格|画风|笔触|上色|渲染|姿势|姿态|动作|骨架|衣服|服装|材质|质感|纹理|配色|色彩|颜色|背景|环境|构图|光影|光照|镜头))/i]];
  function styleRendering(detail) {
    // Only a finite vocabulary of drawing methods can enter from a caption.
    // Depicted nouns/effects, however plausible, never become new intent.
    const observed=text(detail).split(/[，,。；;\n]/).filter(s=>!/(?:不是|不属于|不要|非|\bnot\b|\bwithout\b)/i.test(s)).join(' ');
    return [[/二次元|动漫|漫画|anime|manga/i,'二维动漫造型与明确的手绘轮廓'],[/水墨|墨色|墨迹|墨绘|\bink\b/i,'水墨浓淡、干湿笔触与墨色塑形'],[/水彩|watercolou?r/i,'透明水彩晕染、纸面肌理与柔和色层'],[/赛璐璐|cel.?shad/i,'清晰轮廓与分层平涂阴影'],[/油画|oil.paint/i,'油画色层与笔刷块面塑形'],[/厚涂|impasto|painterly/i,'可见厚涂笔刷与绘画体积'],[/素描|铅笔|pencil|sketch/i,'素描线条与笔迹塑形'],[/排线|hatch/i,'排线塑形与交叠笔迹'],[/扁平|flat.illustration/i,'扁平造型与概括色块'],[/像素|pixel.art/i,'像素造型与像素级色块'],[/粗犷|粗粝|rough|coarse/i,'粗犷笔触与概括形体'],[/暗黑|暗调|dark.fantasy|moody/i,'深暗色调与明确明暗对比']].filter(([pattern])=>pattern.test(observed)).map(([,label])=>label).slice(0,4).join('，');
  }
  function roleRendering(role,detail) {
    if(role==='style')return styleRendering(detail);
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
    if (['local', 'grok'].includes(state.drawingAnalysisEngine)) return state.drawingAnalysisEngine;
    try { return root.localStorage.getItem('novaflow.drawing.analysis.v1') === 'grok' ? 'grok' : 'local'; } catch { return 'local'; }
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
        return { role: u.role, detail: text(u.detail).slice(0, 1600), target: text(u.target).slice(0, 200), box: u.box ? box(u.box) : [0, 0, 1000, 1000], samples,
          ...(Array.isArray(u.omit)?{omit:u.omit.map(box)}:{}) };
      });
      const hint = source.references.find(item => item.source === r.source)?.role;
      if (!source.prompt && hint && hint !== 'auto' && !uses.some(u => u.role === hint)) throw new Error(`图${r.source}的分析没有采用已选用途，未提交生成`);
      return { source: r.source, uses, omit: (r.omit || []).map(box) };
    });
    if (seen.size !== sources.size) throw new Error('分析遗漏了参考图，未提交生成');
    return { schema: SCHEMA, prompt: source.references.length ? source.prompt || TASKS[source.task] || '' : text(raw.prompt).slice(0, 12000), summary: source.references.length ? references.map(r=>`图${r.source}：${r.uses.map(u=>ROLES[u.role]).join('、')}`).join('；') : text(raw.summary).slice(0, 2000), references,
      preserve: (raw.preserve || []).map(text).filter(Boolean).slice(0, 24), exclude: source.references.length ? [] : (raw.exclude || []).map(text).filter(Boolean).slice(0, 24), clarification: text(raw.clarification).slice(0, 500) };
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
    for (const r of source.references) {
      if (signal.aborted) throw abortError();
      analysisImages.push({ dataUrl: await analysisImage(r.dataUrl, Math.min(450000, Math.floor(6000000 / source.references.length))), name: r.name || `reference_${r.source}.png`, label: `图${r.source}`, role: r.role });
    }
    const payload = { surface: 'art', purpose: 'art-director', visualSchema: SCHEMA, currentPrompt: source.prompt, requirements: source.prompt,
      negativePrompt: source.negativePrompt, nsfw: source.nsfw, supportsNegativePrompt: false,
      artContext: { task: source.task, width: source.width, height: source.height, references: source.references.map(r => ({ source: r.source, role: r.role, roles:r.roles,...(r.excludedRoles?{excludedRoles:r.excludedRoles}:{}) })) },
      images: analysisImages };
    const fn = source.engine === 'grok' ? api.smartAiImageReverse : api.promptAssistantReverseImagePrompt;
    if (typeof fn !== 'function') throw new Error('所选绘图分析线路未就绪');
    let cancel;
    const stopped = new Promise((_, reject) => { cancel = () => reject(abortError()); signal.addEventListener('abort', cancel, { once: true }); });
    try { return validate(unwrap(await Promise.race([fn.call(api, payload), stopped])), source); }
    finally { signal.removeEventListener('abort', cancel); }
  }

  function image(url) {
    return new Promise((resolve, reject) => { const i = new root.Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('参考图片读取失败')); i.src = url; });
  }
  function canvas(width, height) {
    const c = root.document.createElement('canvas'); c.width = Math.max(32, Math.round(width)); c.height = Math.max(32, Math.round(height));
    return c;
  }
  async function analysisImage(url, budget) {
    const img = await image(url);
    let size = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    for (let pass = 0; pass < 10; pass++) {
      const c = canvas(img.naturalWidth * size, img.naturalHeight * size), ctx = c.getContext('2d');
      ctx.fillStyle='#808080';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
      const value = c.toDataURL('image/jpeg', pass < 2 ? .85 - pass * .15 : .65);
      if (value.length <= budget) return value;
      size *= .8;
    }
    throw new Error('参考图分析数据过大，请减少图片数量；本次未截断提交');
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
    if(root.navigator&&['style','material','background'].includes(use.role)&&typeof root.Worker!=='function')throw new Error('当前浏览器不支持参考图隔离处理，请使用新版 Chrome 或 Edge；本次未使用未隔离原图');
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
    if (use.role === 'style' || use.role === 'material') {
      if (typeof root.Worker === 'function') {
        status(`正在隔离${ROLES[use.role]}参考中的脸部…`);
        const { protectedFaceRegions } = await import('./art-reference-safety.js');
        omit=[...omit,...await protectedFaceRegions(ref.dataUrl)];
      }
      const samples = styleSamples(img, use.samples, omit, use.role==='material'?use.box:[0,0,1000,1000],use.role==='material'?2:1,use.role==='style'?125:250);
      if (samples.length < (use.role==='material'?1:3)) throw new Error(`图${ref.source}的${ROLES[use.role]}样本不足，无法排除脸部或文字，请重新分析`);
      const columns = Math.ceil(Math.sqrt(samples.length)), rows = Math.ceil(samples.length/columns);
      const ratios=samples.map(b=>(b[2]-b[0])*w/((b[3]-b[1])*h)).sort((a,b)=>a-b);
      const cellWidth=384,cellHeight=Math.round(cellWidth/Math.max(.4,Math.min(2.5,ratios[Math.floor(ratios.length/2)])));
      const c = canvas(columns*cellWidth,rows*cellHeight), ctx = c.getContext('2d'); ctx.fillStyle='#808080';ctx.fillRect(0,0,c.width,c.height);
      samples.forEach((b,i) => { const sw=(b[2]-b[0])*w, sh=(b[3]-b[1])*h, scale=Math.min((cellWidth-8)/sw,(cellHeight-8)/sh); crop(ctx,img,b,(i%columns)*cellWidth+(cellWidth-sw*scale)/2,Math.floor(i/columns)*cellHeight+(cellHeight-sh*scale)/2,sw*scale,sh*scale); });
      return { dataUrl: c.toDataURL('image/png'), treatment: use.role==='style'?'isolated-style-samples':'isolated-material-samples', samples, protectedRegions:omit };
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
      const target=u.role==='material'?applicationTarget(source.prompt,r.source,u.target):u.target&&source.prompt.includes(u.target)?u.target:'';
      refs.push({name:`reference_${r.source}_${u.role}.${extension}`,mimeType,dataUrl:rendered.dataUrl,sourceIndex:r.source-1,sourceNumber:r.source,role:u.role,detail:u.detail,target,treatment:rendered.treatment,...(rendered.poseGeometry?{poseGeometry:rendered.poseGeometry}:{})});
    }
    const rules={subject:'提供主体身份和设计；仅保留未被用户指定修改的内容',style:'局部风格样本板，采用其线条、笔触、造型概括、上色方法、整体色调关系和明暗组织；不复制样本排列、边框、人物或物件，不新增风格图中的特效、道具或装饰',pose:'实际识别的姿势骨架，只采用关节方向和肢体关系；不画骨架、彩线或原姿势图人物',background:'只采用环境与空间；灰色遮挡区表示被移除的无关前景，需要自然补全，不能画成灰色块',material:'只向指定目标应用表面材质，不借用原物件形状、人物或背景；未明确要求改变颜色时保留目标原有颜色',color:'只采用色彩关系，不画色块或色板；配色参考优先于风格参考的色调',composition:'只采用区域位置、尺度和空间层次，不画矩形框',lighting:'只采用明暗和光照方向，不复制参考内容；光影参考优先于风格参考的明暗组织',object:'只采用指定物件，排除周围人物与背景'};
    // Style captions often mingle drawing technique with depicted effects or
    // scenery. Its isolated pixels carry the technique; never promote such a
    // caption into requested content.
    const instructions=refs.map((r,i)=>`输入图片${i+1}（原图${r.sourceNumber}，${ROLES[r.role]}${r.target?`，用于${r.target}`:''}）：${rules[r.role]}${r.role==='style'&&styleRendering(r.detail)?`。绘画方法：${styleRendering(r.detail)}`:''}`).join('\n');
    const request=source.prompt.replace(/(?:@?参考图|图片|图|image)\s*(\d+)/gi,(_,n)=>`原始参考${n}`);
    const taskText=TASK_BRIEFS[source.task]||TASK_BRIEFS.auto;
    const actions=refs.flatMap(r=>{
      const rendering=roleRendering(r.role,r.detail);if(!rendering)return [];
      return r.role==='pose'?[`将主体的实际动作改为：${rendering}。直接替换原动作，清除骨架和彩色辅助线。`]:r.role==='material'?[`将${r.target||'用户指定部位'}的表面改为${rendering}，保留未要求改变的款式与配色。`]:r.role==='background'?[`将主体原背景替换为${rendering}，原背景不再出现。`]:[];
    }).join('\n');
    const accessories=refs.filter(r=>r.role==='subject').map(r=>roleRendering('subject',r.detail)).filter(Boolean).join('、');
    const sourcePreserve=accessories?`未被用户明确要求修改的主体配饰必须保留，包括主体原有的${accessories}；不要因改变姿势、背景或衣物材质而删除这些原有配饰。`:'';
    // A vision caption may over-describe a donor. For reference work the
    // executable brief comes from the user's words and scoped visual uses,
    // rather than accepting an unconstrained merged caption as new intent.
    const brief=source.references.length?`${taskText}。${request?`用户要求：${request}。`:''}`:plan.prompt;
    const styleDirective=refs.some(r=>r.role==='style')?'将整幅画面的绘画方法、色调关系、明暗对比和造型概括完整转换为风格参考的表现。主体身份与关键设计保持；服饰款式、姿势和场景内容按用户及各参考用途执行，未指定改变则保持。原照片的摄影质感、原有色调和明暗组织应按目标风格重新绘制。不要只叠加纹理或少量线条；不要添加风格图中描绘的人物、物件、画框、魔法、光效或其他内容。用户明确只采用某种笔触或局部效果时，仅改变其指定维度与范围。':'';
    const replacements=[refs.some(r=>r.role==='pose')?'将主体原来的人物直接重绘为指定骨架姿势，替换原姿势；保持原人物数量，只改变原人物，不追加人物、分身、残影，不保留旧姿势的人物。':'',refs.some(r=>r.role==='background')?`用指定环境替换主体原背景，保持主体身份和数量${refs.some(r=>r.role==='pose')?'，姿势按指定骨架执行':'及未指定修改的姿势'}；原背景不再出现，不添加背景参考中的人物或动物。`:''].filter(Boolean).join('\n');
    const framing=refs.some(r=>r.role==='subject')&&!refs.some(r=>r.role==='pose'||r.role==='composition')?'用户未明确改变构图时，保持主体的相对位置、大小与原有取景，不因转换画风放大主体，不裁掉原图已显示的头、手或脚；输出比例改变时自然延展背景适配，不擅自添加原图未展示的身体部位。':'';
    const prompt=[actions,sourcePreserve,brief,styleDirective,replacements,framing,instructions&&`图片职责（括号内原图编号对应原始参考编号）：\n${instructions}`,source.negativePrompt&&`必须避免：${source.negativePrompt}`,
      '只输出一张完整成图。遵循指定画风精修构图、结构、边缘、光影与材质；不增加需求以外的人物、物件、装饰、文字、拼图或采样板。'].filter(Boolean).join('\n\n');
    return {references:refs,promptSnapshot:{prompt,negativePrompt:source.negativePrompt}};
  }
  async function prepare(context) {
    if (controller) throw new Error('请等待当前绘图分析结束');
    const current=new AbortController();controller=current;
    const source=input(context),status=context.onProgress||(()=>{});let preparing=true;
    const check=()=>{if(current.signal.aborted)throw abortError();if(!same(source,input(context.getCurrentContext?context.getCurrentContext():context)))throw new Error('参考图、用途、需求或尺寸已变化，旧分析未提交，请重新生成');if(preparing&&context.getCurrentContext?.().generationSurface && context.getCurrentContext().generationSurface!=='drawing')throw new Error('绘图页面已切换，旧任务未提交');};
    try {
      if(!source.prompt&&!source.references.length)throw new Error('请写一句需求，或添加参考图后直接生成');
      if(source.references.length>(context.referenceLimit||10))throw new Error(`当前模型支持 ${context.referenceLimit||10} 张参考图，请减少图片或切换模型；本次未截断提交`);
      const cacheKey=await key(source);check();
      let prepared=CACHE.get(cacheKey);
      if(!prepared){
        status(source.references.length?'正在理解需求与参考图片…':'正在完善画面表现…');
        const plan=await analyze(source,current.signal);check();
        if(plan.clarification)throw new Error(`需要补充一句：${plan.clarification}`);
        prepared={...(await compile(plan,source,status,check,context.referenceLimit||10)),plan};check();
        CACHE.set(cacheKey,prepared);if(CACHE.size>4)CACHE.delete(CACHE.keys().next().value);
      }
      previews.set(context.state,{...prepared,originalPrompt:source.prompt});
      const state=copy(Object.fromEntries(GENERATION_SETTINGS.filter(k=>Object.hasOwn(context.state,k)).map(k=>[k,context.state[k]])));
      state.mode=prepared.references.length?'img2img':'txt2img';state.localDrawEngine=root.NovaFlowArtGenerateModels?.capabilityFor?.(state.provider,state.mode,state)?.engine||'';
      preparing=false;
      return {...prepared,state,analysisInput:source,originalPrompt:source.prompt,assertCurrent:check,
        recordReview:review=>{const previous=previews.get(context.state);if(previous)previous.review=review;}};
    } finally {if(controller===current)controller=null;}
  }
  async function review(prepared, outputUrl, onProgress = () => {}) {
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
      const originals=[{source:0,dataUrl:outputUrl,role:'output'},...source.references.filter(r=>activeSources.has(r.source))];
      for(const r of originals){if(current.signal.aborted)throw abortError();images.push({dataUrl:await analysisImage(r.dataUrl,Math.min(450000,Math.floor(6000000/originals.length))),name:`review_${r.source}.jpg`,label:r.source?`原始图${r.source}`:'生成结果',role:r.role});}
      // Review the user's contract, not a model caption that may itself have
      // introduced an unrequested motif. Original pixels remain available.
      const contract={task:source.task,rendering:TASK_BRIEFS[source.task]||TASK_BRIEFS.auto,references:prepared.plan.references.map(r=>({source:r.source,uses:r.uses.map(u=>({role:u.role,target:u.target}))}))};
      const payload={surface:'art',purpose:'art-director-review',visualSchema:'nf.art.review.v1',currentPrompt:source.prompt,nsfw:source.nsfw,
        artContext:{task:source.task,references:originals.map(r=>({source:r.source,role:r.role})),plan:contract},images};
      const fn=source.engine==='grok'?root.electronAPI?.smartAiImageReverse:root.electronAPI?.promptAssistantReverseImagePrompt;
      const stopped=new Promise((_,reject)=>{stop=()=>reject(abortError());current.signal.addEventListener('abort',stop,{once:true});});
      const response=await Promise.race([fn.call(root.electronAPI,payload),stopped]);prepared.assertCurrent();
      if(response?.ok===false)throw new Error(response.error||'成图检查失败');
      const data=response?.data||response?.result||response;
      const checked=data?.artReview||data?.art_review;
      if(!checked||checked.schema!=='nf.art.review.v1'||typeof checked.pass!=='boolean'||!Array.isArray(checked.issues)||(!checked.pass&&(!checked.issues.length||!text(checked.repair))))throw new Error('成图检查未返回有效结论');
      const result={schema:checked.schema,pass:checked.pass,issues:checked.issues.map(text).slice(0,12),repair:text(checked.repair).slice(0,1800)};
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
    row.appendChild(create('span',{text:'需求分析'}));
    for(const [value,label]of [['local','本地分析'],['grok','Grok 分析']])row.appendChild(create('button',{type:'button',title:value==='grok'?'生成前理解参考，成图后检查；会使用现有 Grok 分析次数':'使用本地视觉模型理解参考并检查成图；本地生成存在偏差时自动纠偏一次','data-active':engine(state)===value?'1':'0','aria-pressed':engine(state)===value?'true':'false',text:label,onclick:()=>{state.drawingAnalysisEngine=value;try{root.localStorage.setItem('novaflow.drawing.analysis.v1',value);}catch{}refresh();}}));
    const select=create('select',{'aria-label':'绘图任务',onchange:e=>{state.drawingTask=e.currentTarget.value;refresh();}});
    for(const [value,label]of Object.entries(TASKS))select.appendChild(create('option',{value,text:label,selected:(state.drawingTask||'auto')===value?'':null}));
    row.appendChild(select);
    const data=previews.get(state);
    if(data){
      const panel=create('div',{id:`nf-art-analysis-${++previewNumber}`,className:'nf-art-direction-analysis-panel',popover:'auto'}),nativePopover=typeof panel.togglePopover==='function';panel.hidden=!nativePopover;
      const button=create('button',{type:'button',className:'nf-art-direction-analysis-button',text:'查看分析','aria-expanded':'false',...(nativePopover?{popovertarget:panel.id}:{onclick:()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));}})});
      panel.addEventListener('toggle',event=>button.setAttribute('aria-expanded',String(event.newState==='open')));
      panel.appendChild(create('p',{text:data.plan.summary||'已按参考用途生成画面要求'}));
      if(data.review)panel.appendChild(create('p',{text:data.review.pass===true?'成图需求检查通过':`成图检查：${data.review.issues.join('；')}`}));
      for(const ref of data.references){const item=create('div',{className:'nf-art-direction-preview'});item.appendChild(create('img',{src:ref.dataUrl,alt:`图${ref.sourceNumber}实际采用的${ROLES[ref.role]}`}));item.appendChild(create('span',{text:`图${ref.sourceNumber} · ${ROLES[ref.role]}${ref.target?` → ${ref.target}`:''}：${ref.detail}`}));panel.appendChild(item);}
      panel.appendChild(create('pre',{text:data.promptSnapshot.prompt}));row.appendChild(button);row.appendChild(panel);
    }
    return row;
  }
  function referenceControl(create,ref,number,onChange) {
    const row=create('div',{className:'nf-art-direction-reference',onclick:e=>e.stopPropagation(),onkeydown:e=>e.stopPropagation()});
    row.appendChild(create('span',{text:`图${number}`}));
    const select=create('select',{'aria-label':`图${number}参考用途`,onchange:e=>onChange(e.currentTarget.value)});
    for(const [value,label]of Object.entries({auto:'自动',...ROLES}))select.appendChild(create('option',{value,text:label,selected:(ref.drawingRole||'auto')===value?'':null}));row.appendChild(select);return row;
  }
  root.NovaFlowArtDirection=Object.freeze({schema:SCHEMA,roles:ROLES,prepare,review,cancelPreparation,controls,referenceControl,validate,compile,input,same,renderReference,roleRendering});
})(typeof window!=='undefined'?window:globalThis);

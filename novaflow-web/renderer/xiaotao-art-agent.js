(function (root) {
  'use strict';
  const STORAGE_KEY = 'novaflow.xiaotao-art.chat.v1';
  // Retain retired identifiers only for history and billing notices.
  const CHAT_MODELS = Object.freeze({
    next: {label:'此前模型已移除', provider:'local', retired:true, available:false, detail:'此前选择的模型已移除，旧对话仅供查看；请主动选择其他模型，未提交、不扣积分'},
    // Keep the retired identifier solely to preserve existing conversations.
    'gemma-4-12b-it': {label:'此前模型已移除', provider:'local', retired:true, available:false, detail:'此前选择的模型已从列表移除，请主动选择其他模型；未提交，不扣积分'},
    'qwen3.5-9b-heretic': {label:'Qwen3.5 9B（本地·免费）· Ultra Heretic', provider:'local', available:false, detail:'支持对话和提示词优化。操作软件请切换在线模型。'},
    'deepseek/deepseek-v4.1-flash': {label:'DeepSeek V4.1 Flash', provider:'api', available:false, detail:'在线收费 · 峰闲价格规则待确认，暂未开通；未提交，不扣积分'},
    'glm/glm-5.3-flash': {label:'GLM-5.3 Flash（已移除）', provider:'api', retired:true, available:false, detail:'GLM 已移除，旧对话仅供查看；请主动选择其他模型，未提交、不扣积分'},
    'xai/grok-4.7': {label:'Grok 4.7', provider:'api', available:true, detail:'在线收费 · 发送前显示预估积分，按实际用量结算；音视频直接分析尚未接入'},
    'openai/gpt-6.1-sol-saver': {label:'GPT-6.1 Sol Saver', provider:'api', available:false, detail:'在线收费 · 线路或积分价格尚未开通验证，不能发送'},
    'legacy-online': {label:'原在线智能（旧记录）', provider:'api', retired:true, available:false, detail:'原在线线路已合并为 Grok 4.7；旧对话仅供查看，请主动选择模型，未提交、不扣积分'}
  });
  function selectedModelPayload(id) {
    return ['gemma-4-12b-it','qwen3.5-9b-heretic','deepseek/deepseek-v4.1-flash','xai/grok-4.7','openai/gpt-6.1-sol-saver'].includes(id) ? {modelId:id} : {};
  }
  const communityModel=id=>['gemma-4-12b-it','qwen3.5-9b-heretic'].includes(id);
  // This capability remains closed until the full real-page flow is accepted.
  const COMMUNITY_SELECTION_VERIFIED = false;
  // The retired dedicated rotation route must not reopen through an old capability.
  const QWEN_ROTATION_CANDIDATE_RELEASE_ENABLED = false;
  const LOCAL_CHAT_ONLY_NOTICE = '本地模型只支持对话和提示词优化，不能操作软件。需要操作时请切换到在线模型。';
  // Review-only: requires the matching server planner and create-once RPC.
  const ONLINE_AUDIO_ACTION_RELEASE_ENABLED = false;
  // Availability starts false; the server checks the selected node and owner.
  function qwenCandidateHasMedia(value) {
    const media=new Set(['images','image','imageurl','imageurls','imagedata','imagedataurl','previewimage','photo','photos','picture','pictures','uploads','attachments','files','references','referenceimages','referenceimage','referenceimageurl','referenceframes','h3referenceframes','videoframes','audio','video','audiodataurl','videodataurl','dataurl']);
    const stack=[[value,0]],seen=new Set();let nodes=0;
    while(stack.length){const [item,depth]=stack.pop();if(++nodes>10000||depth>20)return true;
      if(typeof item==='string'){if(/data:(?:image|audio|video)\/|blob:/i.test(item))return true;continue;}
      if(!item||typeof item!=='object')continue;if(seen.has(item))return true;seen.add(item);
      if(Array.isArray(item)){for(const child of item)stack.push([child,depth+1]);continue;}
      for(const [key,child] of Object.entries(item)){const k=key.toLowerCase().replace(/[_-]/g,'');
        if(media.has(k)&&child!=null&&child!==''&&(!Array.isArray(child)||child.length>0))return true;
        if((k==='type'||k==='kind')&&typeof child==='string'&&/^(?:image|audio|video)(?:\/|$)/i.test(child))return true;
        stack.push([child,depth+1]);}}
    return false;
  }
  function communityAttachmentMetadata(id,...lists) {
    if (!['gemma-4-12b-it','qwen3.5-9b-heretic'].includes(id)) return null;
    return lists.flatMap(items=>Array.isArray(items)?items:[]).map(item=>({kind:String(item?.kind || ''),name:String(item?.name || '').slice(0,200)}));
  }
  function communityClaimsToolAccess(text) {
    const subject='(?:我|小桃|本模型|当前模型|本地模型)',ability='(?<!不)(?:可以|能够|支持|会|能)',action='(?:调用|操作|执行|使用|运行)',target='(?:Foart|工具|软件|平台)';
    const forward=new RegExp(subject+'.{0,18}'+ability+'.{0,16}'+action+'.{0,18}'+target,'i');
    const reverse=new RegExp(subject+'.{0,18}'+ability+'.{0,16}'+target+'.{0,12}'+action,'i');
    return String(text||'').split(/[，,。；;！？!?\n]+/).some(clause=>forward.test(clause)||reverse.test(clause));
  }
  const SETTINGS = ['provider','mode','prompt','negativePrompt','width','height','seed','randomSeed','count','nsfw','samplingOverrides','loras','localDrawEngine','localQwen21Variant','drawingTask','drawingAnalysisEngine'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const hasDecimalCreditsFields = online => !!online && ['credit_amount_policy','credit_precision','credit_rounding'].some(key=>Object.hasOwn(online,key));
  const decimalCreditsPolicy = online => online?.billing_scope==='operation' && online.credit_amount_policy==='decimal-v1' && online.credit_precision===6 && online.credit_rounding==='ceil' && online.minimum_positive_credits===0;
  const legacyOperationCreditsPolicy = online => online?.billing_scope==='operation' && online.minimum_positive_credits===1 && !hasDecimalCreditsFields(online);
  const operationCreditsPolicy = online => online?.billing_scope==='operation' && (legacyOperationCreditsPolicy(online) || decimalCreditsPolicy(online));
  // Monetary values use integer millionths; model tokens, frames and IDs keep
  // their existing integer validation. Reject excess precision and unsafe sums.
  function creditUnits(value) {
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
    const match=/^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(String(value));
    if(!match)return null;
    const units=BigInt(match[1])*1000000n+BigInt((match[2]||'').padEnd(6,'0'));
    return units<=BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : null;
  }
  function sumCredits(left,right) {
    const a=creditUnits(left),b=creditUnits(right);
    if(a===null||b===null||!Number.isSafeInteger(a+b))return null;
    return (a+b)/1e6;
  }
  function displayCredits(value) {
    if(value==null||value==='')return null;
    const amount=Number(value);
    if(!Number.isFinite(amount)||amount<0)return null;
    if(amount>0&&amount<1e-6)return '<0.000001';
    return amount.toFixed(6).replace(/\.?0+$/,'');
  }
  const cleanBillingNotices = rows => (Array.isArray(rows)?rows:[]).filter(row=>row && typeof row.id==='string' && row.id.length<=100 && CHAT_MODELS[row.modelId]?.provider==='api' && typeof row.unknown==='boolean' && (row.confirmed===null || creditUnits(row.confirmed)!==null) && (row.unknown || row.confirmed!==null) && (row.owner===undefined || typeof row.owner==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.owner))).slice(-20).map(({id,modelId,confirmed,unknown,owner})=>({id,modelId,confirmed,unknown,...(owner===undefined?{}:{owner})}));
  function billingNoticeText(row,provider) {return row.unknown?(provider==='local'?'此前在线扣费待核对':'本次扣费待核对'):`本次扣费 ${displayCredits(row.confirmed)} 积分`;}
  function billingNoticeForView(provider,business,art) {
    const pending=[...business,...art].filter(row=>row?.unknown===true).at(-1);
    return pending || (provider==='api' ? business.at(-1)||art.at(-1)||null : null);
  }
  function appendBillingNotice(rows,row) {return cleanBillingNotices([...rows.filter(item=>item.id!==row.id&&(item.unknown||item.owner!==row.owner)),row]);}
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const fail = message => { throw new Error(message); };
  // The root field is supplied by the owned runtime after it has verified the
  // actual backend; model-generated text and a configured preference are not
  // evidence that a GPU was used. Older workers omit it and remain unknown.
  function verifiedQwenExecutionDevice(response) {
    const identity=response?.modelIdentity;
    if(response?.ok!==true || response.analysisBackend!=='qwen-cpu' || identity?.id!=='qwen35-heretic' ||
      !['server-model-id','server-weight-path'].includes(identity.verification))return null;
    return ['cpu','gpu'].includes(response.executionDevice) ? response.executionDevice : null;
  }
  const qwenExecutionDeviceLabel=device => ['cpu','gpu'].includes(device) ? `上次 ${device.toUpperCase()} 推理` : '设备待检测';
  // Community models are read-only until a verifiable preview and explicit
  // confirmation flow exists. Never treat the model's prose as approval.
  async function enforceCommunityReadOnly({modelId,op,receipts,inspect}) {
    if(!communityModel(modelId))return;
    if(op?.action==='animation'&&op.operation==='inspect_bones')return;
    if(op?.action==='animation'&&op.operation==='key_bones'){
      const names=[...new Set((Array.isArray(op.keys)?op.keys:[]).map(key=>key?.boneName))];
      const valid=s=>s&&s.name===op.name&&s.complete===true&&s.truncated===false&&s.durationAvailable===true&&Number.isFinite(s.durationSeconds)&&Number.isFinite(s.fps)&&Array.isArray(s.bones)&&names.length>0&&names.length<=4&&names.every(name=>s.bones.some(b=>b.boneName===name&&b.complete===true&&b.tracks&&typeof b.tracks==='object'&&!Array.isArray(b.tracks)));
      const baseline=[...(receipts||[])].reverse().find(row=>row?.action==='animation'&&row.operation==='inspect_bones'&&row.phase==='observed'&&valid(row.inspection))?.inspection;
      if(!baseline){const error=new Error('社区模型写入关键帧前需要本轮完整只读检查；未修改作品');error.code='community-inspection-required';throw error;}
      if(typeof inspect!=='function')fail('无法重新核对动画基线；未修改作品');
      const reread=await inspect({action:'animation',operation:'inspect_bones',name:op.name,boneNames:names});
      const live=reread?.inspection;
      const relevant=s=>({name:s.name,fps:s.fps,durationSeconds:s.durationSeconds,durationAvailable:s.durationAvailable,bones:names.map(name=>s.bones.find(b=>b.boneName===name))});
      if(reread?.action!=='animation'||reread.operation!=='inspect_bones'||reread.phase!=='observed'||!valid(live)||JSON.stringify(canonical(relevant(live)))!==JSON.stringify(canonical(relevant(baseline))))fail('动画关键帧或时长已变化，不能使用旧基线；未修改作品');
    }
    fail('社区模型当前只支持只读检查；可核验的修改预览和确认尚未接入，未修改作品');
  }
  async function sha256(bytes) {return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');}
  function imageBytes(url) {
    const match = String(url || '').match(/^data:image\/(?:png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) fail('请使用完整的 PNG、JPEG 或 WebP 参考图');
    return Uint8Array.from(root.atob(match[1].replace(/\s/g, '')), c => c.charCodeAt(0));
  }
  function encodeReferenceBase64(bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const triple = (a << 16) | (b << 8) | c;
      out += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63]
        + (i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=')
        + (i + 2 < bytes.length ? alphabet[triple & 63] : '=');
    }
    return out;
  }
  const resolvedFiles = new WeakMap();
  const referencePreviews = new WeakMap();
  const referenceDimensions = new WeakMap();
  function imageDimensions(ref) {
    const cached = ref?.file && referenceDimensions.get(ref.file);
    return {width:Number(ref?.width || cached?.width) || 0, height:Number(ref?.height || cached?.height) || 0};
  }
  async function readImageDimensions(file, url) {
    if (referenceDimensions.has(file) || typeof root.Image !== 'function') return;
    const dimensions = await new Promise(resolve => {
      const img = new root.Image();
      img.onload = () => resolve({width:img.naturalWidth || img.width, height:img.naturalHeight || img.height});
      img.onerror = () => resolve({width:0,height:0});
      img.src = url;
    });
    referenceDimensions.set(file, dimensions);
  }
  // One resolver for every path that serializes or sends a reference. The slot
  // may keep a blob: URL for display; File does not survive JSON.stringify.
  async function resolveReferenceDataUrl(ref) {
    const current = String(ref?.dataUrl || '');
    if (/^data:[^;,]+;base64,/i.test(current)) {
      if (ref?.file) referencePreviews.set(ref.file, current);
      return current;
    }
    const file = ref?.file;
    const mimeOf = (blob) => String(blob?.type || ref?.mimeType || 'image/png').split(';')[0] || 'image/png';
    if (file && referencePreviews.has(file)) return referencePreviews.get(file);
    if (file && resolvedFiles.has(file)) return resolvedFiles.get(file);
    let dataUrl = '';
    if (file && typeof file.arrayBuffer === 'function') {
      // Cache the in-flight read too: chat, analysis and fingerprint can request
      // the same file together. A failed read must remain retryable.
      const pending = (async () => {
        if (typeof root.FileReader === 'function') return new Promise((resolve, reject) => {
          const reader = new root.FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('参考图读取失败'));
          reader.onabort = () => reject(new Error('参考图读取已取消'));
          reader.readAsDataURL(file);
        });
        return `data:${mimeOf(file)};base64,${encodeReferenceBase64(new Uint8Array(await file.arrayBuffer()))}`;
      })();
      resolvedFiles.set(file, pending);
      try { const resolved = await pending; referencePreviews.set(file, resolved); return resolved; }
      catch (error) { if (resolvedFiles.get(file) === pending) resolvedFiles.delete(file); throw error; }
    }
    if (current.startsWith('blob:') && typeof root.fetch === 'function') {
      const response = await root.fetch(current);
      const blob = await response.blob();
      dataUrl = `data:${mimeOf(blob)};base64,${encodeReferenceBase64(new Uint8Array(await blob.arrayBuffer()))}`;
      return dataUrl;
    }
    fail('参考图格式不受支持');
  }
  if (typeof root.resolveReferenceDataUrl !== 'function') root.resolveReferenceDataUrl = resolveReferenceDataUrl;
  async function fingerprint(snapshot) {
    const artContext = copy(snapshot.artContext);
    const images = await Promise.all(snapshot.images.map(async (img, i) => ({source:i + 1, role:artContext.task === 'creation' ? img.role : i === 0 ? 'subject' : i === 1 ? 'style' : 'result', sha256:await sha256(imageBytes(await resolveReferenceDataUrl(img)))})));
    return sha256(new TextEncoder().encode(JSON.stringify(canonical({schema:'nf.flash.art-agent.snapshot.v1', artContext, images}))));
  }
  function referenceIdentity(ref) {
    if (!ref || typeof ref !== 'object') return '';
    const current = String(ref.dataUrl || ref.imageUrl || '');
    if (!ref.referenceIdentity || ref.referenceIdentityFor !== current) {
      ref.referenceIdentity = 'ref-' + Math.random().toString(36).slice(2);
      ref.referenceIdentityFor = current;
    }
    return ref.referenceIdentity;
  }
  function imageIdentity(img) { return img?.referenceIdentity || img?.sourceUrl || img?.dataUrl; }
  function chatReferenceIdentity(image) {
    return (image?.file && referencePreviews.get(image.file)) || image?.previewUrl
      || (/^data:/i.test(image?.dataUrl || '') ? image.dataUrl : image?.file || image?.dataUrl);
  }
  // Current reference slots retain their roles, even when they use the same
  // image. Only attachment copies already present in those slots are omitted.
  function chatImagesWithUploads(current, uploads) {
    const images = current.slice();
    for (const file of uploads) {
      const dataUrl = file.previewUrl || file.dataUrl;
      if (file.kind !== 'image' || !dataUrl || images.length >= 3) continue;
      const image = {dataUrl, file:file.file, mimeType:file.mimeType, role:'attachment', source:images.length + 1, name:file.name, ...imageDimensions(file)};
      if (!images.some(existing => chatReferenceIdentity(existing) === chatReferenceIdentity(image))) images.push(image);
    }
    return images;
  }
  function chatRequestsCurrentResult(message, includeResult = false) {
    if (includeResult) return true;
    return !/(?:不要|不用|别|无需|不必).*(?:评价|评估|点评|分析|检查|看看)/.test(message)
      && /(?:评价|评估|点评|分析|检查|看看|看一下|看下).{0,10}(?:当前|这张|本次|刚生成|最新).{0,6}(?:成图|出图|结果|图片|图)|(?:当前|这张|本次|刚生成|最新).{0,6}(?:成图|出图|结果|图片|图).{0,10}(?:怎么样|如何|问题|不足|评价|评估|点评|分析|检查)/.test(message);
  }
  function sameSnapshot(a, b) {
    return !!a && !!b && JSON.stringify(canonical(a.artContext)) === JSON.stringify(canonical(b.artContext))
      && a.images.length === b.images.length && a.images.every((img, i) => imageIdentity(img) === imageIdentity(b.images[i]) && img.source === b.images[i].source && img.role === b.images[i].role);
  }
  function forbidsGeneration(message){return /(?:不要|不用|不需要|不必|无需|不能|别|先不|暂不)(?:再|实际|立即|直接|马上|自动|开始|继续|重新|帮我|给我|为我|\s)*(?:生成|生图|出图)|\b(?:do not|don't|never)\s+(?:generate|render)\b/i.test(message);}
  function discussionOnly(message){
    const clauses=String(message||'').split(/[，,。；;！？!?\n]+/);
    const restricted=clause=>/(?:只|仅)(?:做|需要|进行|要|给我|提供|\s)*(?:讨论|方案|建议|分析)|(?:不要|不用|别|先不|暂不)(?:再|实际|立即|直接|自动|开始|继续|重新|帮我|\s)*(?:执行|修改|处理)/.test(clause);
    // A restriction on one item cannot erase an explicit task in another
    // clause: “先不处理查看器，请压缩PNG” still authorizes PNG compression.
    const actionable=clause=>!restricted(clause)&&!/^\s*(?:不要|不用|无需|别|先不|暂不|不(?=生成|执行|修改|处理))/.test(clause)&&/(?:生成|制作|生图|绘制|压缩|去黑|转换|转成|转为|打开|切换|设置|调整|改为|改成|只改|修改|导入|导出|播放|暂停|分割|裁切|合并|填充|抠图|拆图|处理)/.test(clause);
    return clauses.some(restricted)&&!clauses.some(actionable);
  }
  // Qwen's first tool capability is deliberately limited to questions about
  // the already-open animation project. Never infer permission to edit from a
  // question, or route a mixed read/write request through the read-only path.
  function qwenExplicitWriteIntent(message) {
    const text=String(message||'').replace(/但是|不过|然而|而是|但/g,'，').replace(/(?:不要|不用|无需|别|不必)(?:再|自动|直接)?(?:修改|改动|编辑|执行|生成|操作)[^，。；;\n]*/g,'');
    return /隐藏|锁定|解锁|重命名|重设|重置|挪动|摆动|撤销|重做|复制|粘贴|覆盖|保存|变更|改成|调成|切换|(?:把|将).{0,30}(?:旋转|缩放|选中|选择)|(?:旋转|缩放)\s*[-+\d]|生成|生图|出图|绘制|制作|压缩|去黑|转换|裁切|分割|导入|导出|播放|暂停|删(?:除|掉|去|了)?|移除|创建|新建|移动|修改|调整|编辑|写入|应用|设置|填充|抠图|拆图|调用工具|执行|(?:再|更).{0,8}(?:一点|一些|点)|(?:旋转|缩放)(?:一下|一点|一些|到|至)/.test(text);
  }
  function qwenPromptDiscussion(message) {
    if(!/(?:提示词|prompt|画风|风格)/i.test(message)||!/(?:分析|讨论|建议|优化|整理|改写|润色|解释|对比|评价|看看|查看|什么|如何|怎么|多少|[？?])/i.test(message))return false;
    const remaining=String(message).replace(/(?:生成|制作|绘制)(?:图片|图像|动画|视频)?(?:的)?(?:提示词|prompt)/gi,'提示词')
      .replace(/(?:优化|整理|改写|润色|调整|修改|生成|制作|编辑)(?:一下|当前|这段|这条|这个|的)?(?:提示词|prompt)/gi,'提示词')
      .replace(/(?:生成|制作|绘制)的(?:图片|图像|作品)/g,'图片');
    return !qwenExplicitWriteIntent(remaining);
  }
  // A general topic question is not consent to send the current canvas.
  // Answer capability questions from verified feature flags, without asking a
  // model to guess what the current Foart integration can actually execute.
  function qwenCapabilityQuestion(message) {
    const text=String(message||'').trim();
    if(text.length>80 || /(?:帮我|请|给我|麻烦|直接|顺便|然后|并且|同时).{0,15}(?:打开|进入|切换|执行|修改|调整|编辑|生成|查看|读取|定位|跳转|删除|导入|导出|保存|播放|暂停|选择|选中|移动|旋转|缩放|设置|应用|写入)/.test(text) || /(?:把|将).{0,30}(?:修改|调整|编辑|删除|生成|执行|移动|旋转|缩放|设置|应用|写入)/.test(text) || /(?:这张|那张|这幅|当前|我上传|刚才的).{0,6}(?:图|画面|作品|工程)/.test(text))return false;
    // A follow-up command in the same message must retain the normal tool
    // route and its confirmation/charging gates, even if the first clause is a question.
    if (/(?:^|[，,。；;！？!?\n]|然后|并且|同时|顺便|接着|继续)\s*(?:(?:请|帮我|麻烦|直接|再|给我|为我)\s*)*(?:打开|进入|切换|修改|调整|编辑|删除|生成|制作|执行|导入|导出|保存|播放|暂停|选择|选中|移动|旋转|缩放|设置|应用|写入|调大|调小|加大|缩小|加快|放慢)/.test(text) ||
      /(?:^|[，,。；;！？!?\n]|然后|并且|同时|顺便)\s*(?:请|帮我|麻烦|直接|再)?\s*(?:把|将).{0,30}(?:打开|修改|调整|编辑|删除|生成|执行|移动|旋转|缩放|设置|应用|写入)/.test(text))return false;
    if(text.split(/[，,。；;！？!?\n]+/).slice(1).some(qwenExplicitWriteIntent))return false;
    return /(?:只能|只会|只支持|仅能|仅支持).{0,12}(?:聊天|对话|文字|图片)|(?:你|小桃|这个模型|本地模型).{0,12}(?:能|会|可以|支持|有没有).{0,15}(?:做.{0,3}(?:什么|啥)|干.{0,3}(?:什么|啥)|什么|啥|哪些|工具|操作|功能|图片|图像|识图|聊天|对话)|(?:能|可以|会|支持).{0,5}(?:看|分析|识别|理解).{0,4}(?:图片|图像)|(?:能|可以|会).{0,8}(?:调用|使用|操作|控制|操控).{0,8}(?:工具|软件|工程|项目|Foart)|(?:能|可以|会).{0,8}(?:执行|完成).{0,8}(?:任务|操作|工作)/i.test(text);
  }
  // Poll only while the open panel needs a Qwen node, with a bounded number of
  // attempts. An in-flight check is never duplicated by a render or reopen.
  function createQwenNodeRecheck({isNeeded,refresh,timers=root,intervalMs=10000,maxAttempts=12}) {
    let timer=null,inFlight=false,queued=false,attempts=0,stopped=false;
    const needed=()=>!stopped&&isNeeded()===true;
    const clear=()=>{if(timer!==null)timers.clearTimeout(timer);timer=null;};
    async function refreshNow(){
      clear();if(stopped)return;
      if(inFlight){queued=true;return;}
      inFlight=true;
      try{await refresh();}catch{/* A failed check will be retried within the bound. */}
      finally{inFlight=false;if(queued){queued=false;if(needed()){void refreshNow();return;}}update();}
    }
    function update(){
      if(!needed()){clear();return;}
      if(timer!==null||inFlight||attempts>=maxAttempts)return;
      timer=timers.setTimeout(()=>{timer=null;if(!needed())return;attempts++;void refreshNow();},intervalMs);
    }
    return Object.freeze({update,refreshNow,reset(){clear();attempts=0;update();},stop(){stopped=true;queued=false;clear();},start(){stopped=false;update();}});
  }
  function qwenVisualIntent(message) {
    const text=String(message || '');
    if(/(?:这张|那张|这幅|那幅|当前|刚才|刚刚|上次|上一张|之前|刚上传|我上传|上传的|我发的|画布上|画布里|绘图里|槽位里).{0,12}(?:图|画面|照片|截图|素材|结果|左|右|颜色|色彩|构图|画风|风格)/.test(text) ||
      /(?:图中|图里|图上|图片中|图片里|画面中|画面里|截图里|照片中)/.test(text))return true;
    if(/什么是|什么叫|一般|通常|常见|概念|定义|原理|如何理解|怎么理解|区别|作用|教程|有哪些(?:方法|方式|技巧|风格)/.test(text))return false;
    return /(?:看|分析|识别|描述|比较|对比|评估|点评|观察|检查).{0,10}(?:参考图|参照图|成图|结果图|上传图片|附件图|图一|图二|主体图|风格图)|(?:参考图|参照图|成图|结果图|上传图片|附件图|图一|图二|主体图|风格图).{0,12}(?:怎么样|如何|颜色|内容|细节|问题|比较|对比)/.test(text);
  }
  function qwenCurrentResultIntent(message) {
    const text=String(message || '');
    return !/(?:不要|不用|无需|别).{0,12}(?:成图|出图|结果)/.test(text) && /(?:当前|刚生成|最新|本次|这张).{0,6}(?:成图|出图|结果)/.test(text);
  }
  // A quoted example can describe an edit without asking Foart to perform it.
  // Only treat it as discussion when the request expressly excludes tools and
  // asks for an explanation; a separate unquoted write command stays blocked.
  function qwenNoToolExplanation(message) {
    const text=String(message||'');
    const noTools=/(?:没有工具|(?:不要|不用|无需|别)(?:使用|调用)工具)/;
    const noAction=/(?:不要声称(?:已经|已)?(?:操作|执行)|(?:也)?(?:不要|不用|无需|别)(?:实际|直接|真的)?(?:操作|执行))/;
    if(!/请[^。；;\n]{0,50}(?:说明|解释|复述|总结)/.test(text)||!noTools.test(text)||!noAction.test(text))return false;
    const remaining=text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g,'')
      .replace(noTools,'').replace(noAction,'');
    return !qwenExplicitWriteIntent(remaining);
  }
  // An explicit request for the currently open drawing's text, not a request
  // to infer a prompt from an attachment or to generate an image.
  function qwenCurrentDrawingPromptIntent(message) {
    return /^(?:(?:请|麻烦|劳驾)\s*)?(?:帮我\s*)?(?:优化|润色|整理|改写)(?:一下)?(?:当前|现在的|这条|这段)(?:绘图|画图|生图)?(?:的)?(?:提示词|prompt)(?:一下|吧)?[。.!！\s]*$/i.test(String(message||'').trim());
  }
  // Only explicit current-prompt requests enter the UI draft path; combined
  // generation or project changes must be requested separately.
  function currentUiPromptIntent(message) {
    const text=String(message||'').trim();
    if(!text||text.length>4000)return 'none';
    const head=text.split(/[，,；;。.!！?？\n]/u,1)[0].trim();
    const prefix='(?:(?:请|麻烦|劳驾|烦请|能否|可以|帮我|给我)\\s*)*';
    const action='(?:优化|润色|整理|改写|完善)';
    const target='(?:当前|现在|目前|这条|这段|这份|这个)(?:的)?\\s*(?:绘图|画图|生图)?(?:的)?\\s*(?:提示词|prompt)';
    const intent=new RegExp(`^${prefix}(?:(?:把|将)\\s*)?(?:${action}(?:一下)?\\s*${target}|${target}\\s*(?:来|去|进行)?\\s*${action})`,'iu').exec(head);
    if(!intent)return 'none';
    const tail=text.slice(intent[0].length).replace(/(?:不需要|不必|不要|不用|无需|禁止|切勿|避免|别|不)(?:再|直接|自动)?\s*(?:生成|制作|绘制|出图|执行|应用|保存|导出|上传|发布|提交|删除|清空)/gu,'');
    return /生成|制作|绘制|出图|执行|应用|保存|导出|上传|发布|提交|删除|清空|(?:修改|调整|编辑|替换).{0,8}(?:画布|工程|作品|原图)/u.test(tail)?'compound':'optimize';
  }
  function qwenExplicitSeekFrame(message) {
    const pattern=/^(?:(?:请|麻烦|劳驾)\s*)?(?:帮我\s*)?(?:把|将)?\s*(?:(?:时间轴|播放头|当前动画)\s*)?(?:跳转|跳|移动|移|定位|切换|转)(?:到|至)\s*第?\s*(\d{1,5})\s*帧(?:位置)?(?:\s*(?:吧|一下|看看|看一下))?\s*[。.!！]?$/u;
    const match=pattern.exec(String(message||'').trim());if(!match)return null;
    const frame=Number(match[1]);return Number.isSafeInteger(frame)&&frame>=0&&frame<=18000?frame:null;
  }
  // Accept only one selected bone, one existing frame and an explicit absolute angle.
  function qwenExplicitSelectedRotation(message) {
    const pattern=/^(?:(?:请|麻烦|劳驾)\s*)?(?:帮我\s*)?(?:把|将)?\s*(?:当前)?(?:选中|选定)(?:的)?(?:骨骼|关节)\s*(?:在)?\s*第?\s*(\d{1,5})\s*帧(?:的)?\s*(?:旋转|角度)\s*(?:设置为|设定为|设为|设成|改为|改成|调整为|调整到|调为|调成|转到|到|至)\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:度|°)\s*(?:吧|一下)?\s*[。.!！]?$/u;
    const match=pattern.exec(String(message||'').trim());if(!match)return null;
    const frame=Number(match[1]),rotation=Number(match[2]);
    return Number.isSafeInteger(frame)&&frame>=0&&frame<=18000&&Number.isFinite(rotation)&&Math.abs(rotation)<=100000?{frame,rotation}:null;
  }
  function qwenAnimationReadIntent(message) {
    const text=String(message||'').replace(/(?:不要|不用|无需|别|不必)(?:再|自动|直接)?(?:修改|改动|编辑|执行|生成|操作)[^，。；;\n]*/g,'');
    if(qwenExplicitWriteIntent(message))return false;
    if(/生成|生图|出图|绘制|制作|压缩|去黑|转换|裁切|分割|导入|导出|播放|暂停|删除|移除|创建|新建|移动|修改|调整|编辑|写入|应用|设置|填充|抠图|拆图|调用工具|执行|(?:再|更).{0,8}(?:一点|一些|点)|(?:旋转|缩放)(?:一下|一点|一些|到|至)/.test(text))return false;
    const target=/工程|项目|动画|骨骼|关节|选中|选择|帧率|帧数|关键帧|轨道|时长|参数|时间线/.test(text);
    return target&&/(?:查询|查看|读取|检查|显示|列出|告诉我|看一下|看下|看看|比较|对比|比一比|区别|差异|是什么|有哪些|有没有|多少|几个|几根|几帧|几秒|哪个|哪些|什么|如何|怎样|\?|？)/.test(text);
  }
  // Compare only authored rotation key data actually returned by native reads.
  // This does not evaluate interpolation, bone hierarchy or world transforms.
  function qwenRotationComparison(receipts,names) {
    if(!Array.isArray(names)||names.length!==2||names[0]===names[1])return null;
    const tracks=new Map();
    for(const row of receipts){
      if(row.operation!=='inspect_bones')continue;
      const data=row.inspection;
      if(!data||data.complete!==true||data.truncated!==false||!Array.isArray(data.bones))return null;
      for(const bone of data.bones){
        if(!names.includes(bone.boneName))continue;
        if(tracks.has(bone.boneName)||bone.complete!==true||!Array.isArray(bone.tracks?.rotate)||!bone.tracks.rotate.length)return null;
        const values=bone.tracks.rotate;
        if(values.some((key,i)=>!key||typeof key.time!=='number'||!Number.isFinite(key.time)||key.time<0||typeof key.angle!=='number'||!Number.isFinite(key.angle)||(i>0&&key.time<=values[i-1].time)))return null;
        tracks.set(bone.boneName,values);
      }
    }
    if(names.some(name=>!tracks.has(name)))return null;
    const [a,b]=names.map(name=>tracks.get(name));
    const keyed=keys=>keys.map(key=>key.time), aTimes=keyed(a),bTimes=keyed(b);
    const common=aTimes.filter(time=>bTimes.includes(time));
    const describe=(name,keys)=>{const angles=keys.map(key=>key.angle);return name+'：'+keys.length+' 个关键帧，时间 '+keyed(keys).join('、')+' 秒；关键帧角度范围 '+Math.min(...angles)+' 至 '+Math.max(...angles)+' 度。';};
    const shared=common.map(time=>{const ka=a.find(key=>key.time===time),kb=b.find(key=>key.time===time);return time+' 秒：'+names[0]+' '+ka.angle+' 度，'+names[1]+' '+kb.angle+' 度';});
    const only=(left,right)=>left.filter(time=>!right.includes(time));
    const fmt=times=>times.length?times.join('、')+' 秒':'无';
    return ['旋转关键帧比较（时间为秒，角度为相对设置姿态的度数）：',describe(names[0],a),describe(names[1],b),
      '共同关键帧：'+(shared.length?shared.join('；'):'无')+'。',
      '仅 '+names[0]+' 有关键帧的时间：'+fmt(only(aTimes,bTimes))+'；仅 '+names[1]+' 有关键帧的时间：'+fmt(only(bTimes,aTimes))+'。',
      '这里只比较原始关键帧，不推断帧间插值、世界角度或整段动画的极值。'].join('\n');
  }
  function qwenComparisonTargets(message,animation) {
    if(!/比较|对比|比一比|区别|差异/.test(message))return null;
    const entries=animation?.bones, count=animation?.boneCount;
    if(!Array.isArray(entries)||!Number.isInteger(count)||count!==entries.length)return {ambiguous:true,names:[]};
    const names=entries.map(item=>item?.name);
    if(names.some(name=>typeof name!=='string'||!name)||new Set(names).size!==names.length)return {ambiguous:true,names:[]};
    const spans=[];
    for(const name of names){
      let from=0,index;
      while((index=message.indexOf(name,from))!==-1){
        const before=message[index-1]||'',after=message[index+name.length]||'';
        if(!(/[A-Za-z0-9_]/.test(name[0])&&/[A-Za-z0-9_]/.test(before))&&!(/[A-Za-z0-9_]/.test(name[name.length-1])&&/[A-Za-z0-9_]/.test(after)))spans.push({name,start:index,end:index+name.length});
        from=index+name.length;
      }
    }
    if(spans.some((a,i)=>spans.some((b,j)=>i<j&&a.name!==b.name&&a.start<b.end&&b.start<a.end)))return {ambiguous:true,names:[]};
    const targets=new Set(spans.map(span=>span.name));
    if(/(?:选中|选择)(?:的|了)?(?:骨骼|骨头|关节)/.test(message)){
      if(!Array.isArray(animation.selectedBones)||!animation.selectedBones.length||animation.selectedBones.some(name=>!names.includes(name)))return {ambiguous:true,names:[]};
      for(const name of animation.selectedBones)targets.add(name);
    }
    return {ambiguous:targets.size<2,names:[...targets]};
  }
  function executionIntent(message) {
    const text = String(message || '').trim().replace(/^(?:那就|就)(?=按|用|生成|生图|出图)/,'');
    // Execute only explicit user commands; questions, discussion and refusals
    // stay in the model's normal proposal/reply path.
    if (/[?？]|(?:能不能|可不可以|能否|是否|怎么|如何|为什么|什么|假如|如果)|吗[。！!]?\s*$/.test(text)
      || forbidsGeneration(text)||/(?:不要|不用|别|先不|暂不)(?:再|直接|开始|自动|\s)*(?:执行|应用)/.test(text)) return null;
    const existing = '(?:按|用)(?:这个|当前|刚才|上面)(?:方案|建议)';
    if (new RegExp('^(?:请)?(?:' + existing + '[，, ]*)?(?:现在|直接|确认|开始|帮我|给我)?(?:生成(?:一张(?:图|图片)?)?|生图|出图)(?:吧|一下|一张)?[。！!]*$').test(text))
      return {generate:true, existingOnly:new RegExp(existing).test(text), fresh:false};
    if (/^(?:请|帮我|给我|用|按|参考|将|把)/.test(text) && /重绘|绘制|绘图|优化|分析/.test(text)
      && /(?:并|然后|直接)(?:帮我|给我)?生成(?:一张(?:图|图片)?)?[。！!]*$/.test(text)) return {generate:true, existingOnly:false, fresh:true};
    if (/^(?:请|帮我)?(?:把|将)?(?:这个|当前|刚才|上面)?(?:方案|建议|提示词)?(?:应用到绘图|应用|(?:写入|填入|写到|填到|写进|填进)(?:绘图)?(?:提示词?框|提示框)(?:里)?|写进去)(?:吧|一下)?[。！!]*$/.test(text))
      return {generate:false, existingOnly:true, fresh:false};
    return null;
  }
  function samplingRequest(message) {
    const text = String(message || '').trim(), execution = executionIntent(text);
    if (/[?？]|(?:能不能|可不可以|能否|是否|怎么|如何|为什么|假如|如果)|吗[。！!]?\s*$/.test(text)
      || /(?:不要|不用|别|先不|暂不|不必|无需|不需要|不能).{0,10}(?:生成|生图|出图|执行|应用|换|改|画)/.test(text)
      || /提示词|提示框|方案|只聊|讨论|解释/.test(text)) return false;
    if (execution?.generate) return true;
    // These phrases only open an explicit confirmation. They never grant
    // generation permission or select sampling values on the user's behalf.
    return /^(?:请|帮我|麻烦|把|将|用|参考)/.test(text)
      && /(?:风格|画风).{0,12}(?:换成|改成|变成|迁移)|(?:画|做|生成|制作|绘制)(?:一个|一张|个|张)|重绘/.test(text);
  }
  function samplingChoice(message) {
    const text = String(message || '').trim().replace(/[\s：:，,、。！!]/g,'').toLowerCase();
    if (/^(?:按|用)?当前参数(?:生成|开始)?$/.test(text)) return 'current';
    if (/^(?:用|按)?(?:turbo|加速(?:版)?)(?:8步)?cfg3(?:生成|开始)?$/.test(text)) return 'turbo';
    if (/^(?:用|按)?普通(?:版)?(?:25步)?cfg3(?:生成|开始)?$/.test(text)) return 'standard';
    return null;
  }
  function feedbackRequest(message) {
    const text = String(message || '').trim();
    if (/[?？]|(?:能不能|可不可以|能否|是否|怎么|如何|为什么|假如|如果)|吗[。！!]?\s*$|(?:不要|不用|别|先不|暂不|不必|无需).{0,10}(?:生成|生图|出图|改|调|修)|提示词|方案|讨论|解释/.test(text)) return false;
    return /调整|修改|改善|修正|修好|重做|重绘|改成|改一下|调一下|优化|请改|帮我改|降低|增强|减少|去掉/.test(text);
  }
  const samplingLabel = sampling => `${sampling.variant === 'turbo' ? 'Turbo 加速版' : '普通版'} · ${sampling.steps} 步 · CFG ${sampling.cfg}`;
  function clampPanelPosition(position, size, viewport, margin = 8) {
    const axis = (value, length, available) => {
      const max = Math.max(0, Number(available) - Number(length) - margin), min = Math.min(margin, max);
      return Math.max(min, Math.min(max, Number(value) || 0));
    };
    return {left:axis(position.left, size.width, viewport.width), top:axis(position.top, size.height, viewport.height)};
  }
  function anchoredPanelPosition(robot, size, viewport, gap = 12) {
    const left = robot.left - size.width - gap;
    return clampPanelPosition({left:left >= 8 ? left : robot.right + gap, top:robot.bottom - size.height}, size, viewport);
  }
  function renderMessageMarkdown(document, text) {
    const body = document.createElement('div'); body.className = 'nf-xiaotao-message-body';
    function inline(target, value) {
      const pattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`/g; let start = 0, match;
      while ((match = pattern.exec(value))) {if (match.index > start) target.append(document.createTextNode(value.slice(start, match.index))); const node = document.createElement(match[3] !== undefined ? 'code' : 'strong'); node.textContent = match[3] ?? match[1] ?? match[2]; target.append(node); start = pattern.lastIndex;}
      if (start < value.length) target.append(document.createTextNode(value.slice(start)));
    }
    let paragraph = [], list = null, fenced = null;
    const flush = () => {if (paragraph.length) {const p = document.createElement('p'); inline(p, paragraph.join('\n')); body.append(p); paragraph = [];} list = null;};
    for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      if (/^\s*```/.test(line)) {flush(); if (fenced) fenced = null; else {const pre = document.createElement('pre'); fenced = document.createElement('code'); pre.append(fenced); body.append(pre);} continue;}
      if (fenced) {fenced.append(document.createTextNode(line + '\n')); continue;}
      if (!line.trim()) {flush(); continue;}
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/), item = line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
      if (heading) {flush(); const node = document.createElement('h4'); inline(node, heading[1]); body.append(node);}
      else if (item) {if (paragraph.length) flush(); const tag = item[1] ? 'ul' : 'ol'; if (!list || list.tagName.toLowerCase() !== tag) {list = document.createElement(tag); body.append(list);} const li = document.createElement('li'); inline(li, item[2]); list.append(li);}
      else {if (list) flush(); paragraph.push(line);}
    }
    flush(); return body;
  }
  function conversationRows(messages) {
    const rows = [];
    for (const message of messages) {
      const raw = String(message.content || '');
      const content = message.role==='assistant' ? raw.replace(/^本次为文字或图片对话，未操作软件。\n\n/, '') : raw;
      if (message.role === 'status' && /^(?:消息已发送，正在等待小桃回复|请求已收到，开始分析当前绘图)/.test(content)) continue;
      const receipt = message.role === 'status' && /^(?:本次)?实扣\s*(?:\d+(?:\.\d+)?|<0\.000001)\s*(?:分|积分)/.test(content);
      const previous = rows[rows.length - 1];
      if (receipt && previous?.role === 'assistant') {
        previous.receipts.push(content);
        continue;
      }
      rows.push({...message, content, receipts:typeof message.receipt === 'string' && message.receipt ? [message.receipt] : [], ...(receipt ? {receiptOnly:true} : {})});
    }
    return rows;
  }
  async function copyMessageText(text, button, doc, environment, selectionTarget) {
    let copied=false;
    try {
      if(typeof environment.navigator?.clipboard?.writeText==='function') {
        try {await environment.navigator.clipboard.writeText(String(text));copied=true;} catch {/* Try the synchronous browser fallback. */}
      }
      if(!copied && typeof doc.execCommand==='function') {
        const helper=doc.createElement('textarea');helper.value=String(text);helper.setAttribute('readonly','');
        Object.assign(helper.style,{position:'fixed',left:'-10000px',top:'0'});doc.body.append(helper);
        try {helper.focus();helper.select();copied=doc.execCommand('copy')===true;} finally {helper.remove();}
      }
    } catch {/* Offer a visible, selectable fallback below. */}
    if(copied){button.textContent='已复制';return true;}
    try {
      const selection=environment.getSelection?.(),range=doc.createRange?.();
      if(selection&&range&&selectionTarget){range.selectNodeContents(selectionTarget);selection.removeAllRanges();selection.addRange(range);}
    } catch {/* Keep the failure message even if selection is unavailable. */}
    button.textContent='请选中文字按 Ctrl+C';return false;
  }
  function renderConversationRow(doc, message, {copyText = () => {}, chooseUploadDestination = () => {}} = {}) {
    const el = (tag, className = '', text) => {const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;};
    if (message.role === 'status') {
      const failed = !message.receiptOnly && (message.level === 'error' || /失败|未成功|无法|不能|不支持|未放入|不可用|已失效|未完成/.test(message.content));
      const note = el('div', `nf-xiaotao-note${message.receiptOnly ? ' nf-xiaotao-receipt' : failed ? ' nf-xiaotao-note-error' : ''}`, message.content);
      note.setAttribute('role', failed ? 'alert' : 'note');
      return note;
    }
    const bubble = el('div', 'nf-xiaotao-message nf-xiaotao-' + message.role + (message.level === 'error' ? ' nf-xiaotao-message-error' : ''));
    if (message.level === 'error') bubble.setAttribute('role', 'alert');
    const label = el('div', 'nf-xiaotao-message-label');
    const textPrompt = message.content.match(/完整提示词：\n```text\n([\s\S]*?)\n```/);
    const copy = el('button', 'nf-xiaotao-copy', textPrompt ? '复制提示词' : '复制');
    copy.type = 'button';
    copy.setAttribute('aria-label', message.role === 'user' ? '复制你的消息' : textPrompt ? '复制小桃的完整提示词' : '复制小桃的回复');
    copy.onclick = () => void copyText(textPrompt ? textPrompt[1] : message.content, copy, body);
    label.append(el('span', '', message.role === 'user' ? '你' : '小桃AI'), copy);
    const body=renderMessageMarkdown(doc, message.content);
    bubble.append(label, body);
    if (message.attachments?.length) {
      const strip = el('div', 'nf-xiaotao-message-attachments');
      for (const resource of message.attachments) {
        if (resource.dataUrl) {const image = el('img'); image.src = resource.dataUrl; image.alt = resource.name; strip.append(image);}
        else strip.append(el('span', 'nf-xiaotao-message-file', resource.name));
      }
      bubble.append(strip);
    }
    // Old slot-choice messages may exist in this tab's history. Routing is now
    // automatic, so never revive those stale navigation buttons.
    if (message.imageUrl && /^data:image\//.test(message.imageUrl)) {
      const link = el('a'); link.href = message.imageUrl; link.target = '_blank'; link.rel = 'noopener';
      const image = el('img'); image.src = message.imageUrl; image.alt = '本次实际成图，待评价'; link.append(image); bubble.append(link);
    }
    for (const id of message.downloads || []) {
      const file=root.NovaFlowFoartTools?.downloadFile?.(id);if(!file)continue;
      const link=el('a','nf-xiaotao-download','下载 '+file.name);link.href=file.url;link.download=file.name;link.setAttribute('aria-label','下载实际文件：'+file.name);bubble.append(link);
    }
    for (const receipt of message.receipts || []) {const note = el('small', 'nf-xiaotao-receipt', receipt); note.setAttribute('role', 'note'); bubble.append(note);}
    return bubble;
  }
  function createTabScopedStorage(localStorage, sessionStorage) {
    const tabKey = STORAGE_KEY + ':billing-tab-id', prefix = STORAGE_KEY + ':billing-tab:',
      legacyTabKey = STORAGE_KEY + ':tab-id', legacyPrefix = STORAGE_KEY + ':tab:', latestKey = STORAGE_KEY + ':latest-archive';
    const read = (storage, key) => {try {return storage?.getItem(key) ?? null;} catch {return null;}};
    const write = (storage, key, value) => {try {storage?.setItem(key, value);} catch {}};
    let tabId = read(sessionStorage, tabKey);
    if (!/^[\da-f-]{36}$/i.test(tabId || '')) {tabId = root.crypto.randomUUID(); write(sessionStorage, tabKey, tabId);}
    const archiveKey = prefix + tabId;
    // Keep per-request notices separate so concurrent tabs cannot overwrite one
    // another. The owner is the non-secret account id from the current session.
    const artPrefix=STORAGE_KEY+':art-billing-v1:';
    const validOwner=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
    const validBillingId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(id);
    const validBillingModel=id=>['xai/grok-4.7','openai/gpt-6.1-sol-saver'].includes(id);
    const artKey=(owner,id,kind)=>artPrefix+owner+':'+kind+':'+id;
    function listArtBilling(owner) {
      try {
        if(!validOwner(owner)||!localStorage||!Number.isSafeInteger(localStorage.length)||typeof localStorage.key!=='function')return null;
        const prefix=artPrefix+owner+':',pending=new Map(),settled=new Map();
        for(let i=0;i<localStorage.length;i++){
          const key=localStorage.key(i);if(typeof key!=='string'||!key.startsWith(prefix))continue;
          const suffix=key.slice(prefix.length),match=/^(pending|settled):([A-Za-z0-9_-]{8,100})$/.exec(suffix);if(!match)return null;
          const row=JSON.parse(localStorage.getItem(key)),id=match[2];
          if(!row||row.id!==id||!validBillingModel(row.modelId)||Object.keys(row).some(k=>!['id','modelId','confirmed','unknown','pricingSource','cacheKnown'].includes(k)))return null;
          if(match[1]==='pending') {if(row.confirmed!==null||row.unknown!==true||row.pricingSource!==undefined||row.cacheKnown!==undefined)return null;pending.set(id,row);}
          else {if(creditUnits(row.confirmed)===null||row.unknown!==false||row.pricingSource!=='token_rate_estimate'||typeof row.cacheKnown!=='boolean')return null;settled.set(id,row);}
        }
        for(const [id,row] of settled)if(!pending.has(id)||pending.get(id).modelId!==row.modelId)return null;
        return [...pending].map(([id,row])=>settled.get(id)||row);
      }catch{return null;}
    }
    function persistArtPending(owner,row) {
      try {
        const rows=listArtBilling(owner);if(!rows||rows.length>=20||!validBillingId(row?.id)||!validBillingModel(row?.modelId))return false;
        const key=artKey(owner,row.id,'pending');if(localStorage.getItem(key)!==null||localStorage.getItem(artKey(owner,row.id,'settled'))!==null)return false;
        const value=JSON.stringify({id:row.id,modelId:row.modelId,confirmed:null,unknown:true});localStorage.setItem(key,value);
        const check=listArtBilling(owner);return localStorage.getItem(key)===value&&Array.isArray(check)&&check.some(x=>x.id===row.id&&x.modelId===row.modelId&&x.unknown===true);
      }catch{return false;}
    }
    function persistArtSettlement(owner,row) {
      try {
        const pending=listArtBilling(owner)?.find(x=>x.id===row?.id);
        if(!pending||pending.modelId!==row.modelId||creditUnits(row.confirmed)===null||row.pricingSource!=='token_rate_estimate'||typeof row.cacheKnown!=='boolean')return false;
        const key=artKey(owner,row.id,'settled'),value=JSON.stringify({id:row.id,modelId:row.modelId,confirmed:row.confirmed,unknown:false,pricingSource:row.pricingSource,cacheKnown:row.cacheKnown}),old=localStorage.getItem(key);
        if(old!==null&&old!==value)return false;if(old===null)localStorage.setItem(key,value);
        const check=listArtBilling(owner);return localStorage.getItem(key)===value&&Array.isArray(check)&&check.some(x=>x.id===row.id&&x.confirmed===row.confirmed&&x.cacheKnown===row.cacheKnown&&!x.unknown);
      }catch{return false;}
    }
    function dismissArtBilling(owner,id) {
      try {if(!validBillingId(id)||!listArtBilling(owner))return false;localStorage.removeItem(artKey(owner,id,'settled'));localStorage.removeItem(artKey(owner,id,'pending'));return localStorage.getItem(artKey(owner,id,'settled'))===null&&localStorage.getItem(artKey(owner,id,'pending'))===null;}catch{return false;}
    }
    // Conversation text and attachments stay in the controller's memory.
    // Legacy archives are left untouched; only their billing notices may be
    // read so already-submitted requests remain visible for reconciliation.
    const billingOnly = value => {
      if (!value) return null;
      try {return JSON.stringify({billingNotices:cleanBillingNotices(JSON.parse(value)?.billingNotices)});} catch {return null;}
    };
    return Object.freeze({
      getItem(key) {
        if (key !== STORAGE_KEY) return null;
        const own = billingOnly(read(localStorage, archiveKey)); if (own !== null) return own;
        const oldTabId=read(sessionStorage,legacyTabKey), latest=read(localStorage,latestKey);
        const legacyOwn=/^[\da-f-]{36}$/i.test(oldTabId || '') ? read(localStorage,legacyPrefix+oldTabId) : null;
        const recent=latest?.startsWith(legacyPrefix) ? read(localStorage,latest) : null;
        for (const candidate of [legacyOwn,recent,read(localStorage,STORAGE_KEY)]) {
          const safe=billingOnly(candidate);if(safe!==null)return safe;
        }
        return null;
      },
      // The durable record contains billing metadata only, never conversation text.
      getDurableItem(key) {return key === STORAGE_KEY ? localStorage?.getItem(archiveKey) ?? null : null;},
      setItem(key, value) {if (key === STORAGE_KEY) {const safe=billingOnly(value);if(safe!==null)write(localStorage, archiveKey, safe);}},
      listArtBilling,persistArtPending,persistArtSettlement,dismissArtBilling
    });
  }
  function bindPanelDrag(panel, handle, {document = root.document, window = root, threshold = 0, ignoreInteractive = true, onStart = () => {}, onEnd = () => {}} = {}) {
    let position = null, drag = null, frame = null, suppressClick = false, lastSize = {width:390, height:600};
    const raf = window.requestAnimationFrame?.bind(window) || (fn => root.setTimeout(fn, 16));
    const cancel = window.cancelAnimationFrame?.bind(window) || root.clearTimeout;
    const viewport = () => ({width:window.innerWidth, height:window.innerHeight});
    function commit(value) {
      position = value;
      Object.assign(panel.style, {position:'fixed', left:value.left + 'px', top:value.top + 'px', right:'auto', bottom:'auto', transform:''});
    }
    function update(event) {
      drag.x = event.clientX; drag.y = event.clientY;
      if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < threshold) return false;
      if (!drag.moved) {drag.moved = true; suppressClick = true; handle.classList.add('nf-xiaotao-dragging'); panel.classList?.add('nf-xiaotao-moving'); onStart();}
      drag.next = clampPanelPosition({left:drag.left + drag.x - drag.startX, top:drag.top + drag.y - drag.startY}, drag.size, viewport());
      return true;
    }
    function paint() {frame = null; if (drag?.moved) panel.style.transform = `translate3d(${drag.next.left - drag.left}px,${drag.next.top - drag.top}px,0)`;}
    function finish(event) {
      if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.id) return;
      if (event?.type !== 'pointercancel' && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) update(event);
      if (frame !== null) {cancel(frame); frame = null;}
      const moved = drag.moved;
      if (moved) commit(drag.next);
      try {handle.releasePointerCapture?.(drag.id);} catch {}
      drag = null; handle.classList.remove('nf-xiaotao-dragging'); panel.classList?.remove('nf-xiaotao-moving');
      if (moved) onEnd();
    }
    handle.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0 || ignoreInteractive && event.target?.closest?.('button,a,input,textarea,select,summary,[role="button"]')) return;
      const rect = panel.getBoundingClientRect();
      lastSize = {width:rect.width || lastSize.width, height:rect.height || lastSize.height}; suppressClick = false;
      drag = {id:event.pointerId, startX:event.clientX, startY:event.clientY, x:event.clientX, y:event.clientY, left:rect.left, top:rect.top, size:lastSize, moved:false};
      try {handle.setPointerCapture?.(event.pointerId);} catch {}
      event.preventDefault(); event.stopPropagation();
    });
    document.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (update(event) && frame === null) frame = raf(paint); event.preventDefault();
    }, {passive:false});
    document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', finish);
    const reclamp = () => {
      if (drag) {if (drag.moved) {update({clientX:drag.x, clientY:drag.y}); if (frame === null) frame = raf(paint);} return;}
      const rect = panel.getBoundingClientRect(); lastSize = {width:rect.width || lastSize.width, height:rect.height || lastSize.height};
      if (position || rect.width && rect.height) commit(clampPanelPosition(position || {left:rect.left, top:rect.top}, lastSize, viewport()));
    };
    window.addEventListener('resize', reclamp);
    return Object.freeze({reclamp, place:(value, size) => {if (!drag) {if (size) lastSize = size; commit(clampPanelPosition(value, lastSize, viewport()));}}, dragging:() => !!drag, position:() => drag?.next ? {...drag.next} : position && {...position}, consumeClick:() => {const value = suppressClick; suppressClick = false; return value;}});
  }
  function createBridge(options = {}) {
    const runtime = () => options.runtime || root.__NovaFlowArtGenerate;
    const direction = () => options.direction || root.NovaFlowArtDirection;
    let applied = null, fixedRoles = null;
    const snapshotOwners = new WeakMap(), creationSettings = new WeakMap(), optimizedCreations = new WeakMap();
    function context() {
      const rt = runtime(); if (!rt?.captureContext || !direction()) fail('绘图页面尚未就绪，请稍后再试');
      rt.capturePrompt?.(); const value = rt.captureContext();
      if (value.generationSurface !== 'drawing' || !value.state.active) fail('请回到绘图页面使用小桃AI');
      return value;
    }
    function capture({includeResult = false} = {}) {
      const ctx = context(), s = ctx.state;
      if ((s.provider || 'local') !== 'local' || s.nsfw) fail('小桃AI当前支持本地绘图的主体与风格双图');
      if (s.mode !== 'img2img') fail('请切换到图生图，并添加主体与风格两张参考图');
      const selectedEngine = root.NovaFlowArtGenerateModels?.capabilityFor?.('local', s.mode, s)?.engine || s.localDrawEngine;
      if (!['qwen-2.1', 'qwen-2.1-turbo'].includes(selectedEngine)) fail('小桃AI当前支持 Qwen 2.1 绘图模型，请先切换模型');
      const filled = ctx.references.map((ref, i) => ref?.dataUrl ? {...ref, source:i + 1, referenceIdentity:referenceIdentity(ref)} : null).filter(Boolean);
      if (filled.length !== 2) fail('请保留两张参考图：一张主体，一张画风');
      const observed = direction().input({...ctx, state:{...s, drawingAnalysisEngine:'local'}}).references;
      let images = filled.map((ref, i) => {
        const seen = observed.find(r => r.source === ref.source), explicit = ref.drawingRole;
        const roles = explicit && explicit !== 'auto' ? [explicit] : seen?.roles || [];
        const completeContent = roles.includes('subject') && roles.every(r => ['subject','background','composition'].includes(r));
        let role = roles.includes('style') && !roles.includes('subject') ? 'style' : completeContent ? 'subject' : '';
        if (explicit === 'none' || seen?.excludedRoles?.length || roles.includes('subject') && roles.includes('style') || !completeContent && roles.some(r => ['pose','background','object','composition'].includes(r))) fail('这一版小桃AI只处理主体与画风参考，请先调整参考图用途');
        if (!role) role = i === 0 ? 'subject' : 'style';
        return {dataUrl:ref.dataUrl, referenceIdentity:ref.referenceIdentity, file:ref.file, mimeType:ref.mimeType, name:ref.name || `参考图${ref.source}`, role, source:ref.source};
      });
      if (fixedRoles && s.prompt === fixedRoles.prompt && images.every((img, i) => img.dataUrl === fixedRoles.original[i].dataUrl && img.source === fixedRoles.original[i].source)) images = images.map((img, i) => ({...img, role:fixedRoles.original[i].role}));
      if (images.filter(i => i.role === 'subject').length !== 1 || images.filter(i => i.role === 'style').length !== 1) fail('请明确一张主体和一张画风参考');
      images.sort((a, b) => Number(b.role === 'subject') - Number(a.role === 'subject'));
      const sampling = root.NovaFlowArtGenerateModels?.localSamplingFor?.(s, s.mode, s.negativePrompt, 'qwen-2.1', 'drawing') || {};
      const artContext = copy(Object.fromEntries(SETTINGS.filter(k => s[k] !== undefined).map(k => [k, s[k]])));
      Object.assign(artContext, {surface:'drawing', engine:'qwen-2.1', nsfw:s.nsfw === true, localDrawEngine:s.localDrawEngine || selectedEngine, localQwen21Variant:s.localQwen21Variant || 'standard', cfg:sampling.cfg ?? 1, steps:sampling.steps ?? 8, referenceRoles:images.map(({source, role}) => ({source, role})), task:s.drawingTask || 'style'});
      if (ctx.projectId !== undefined) artContext.projectId = ctx.projectId;
      const lastResult = runtime().selectedResult?.() || null;
      if (includeResult) {
        if (!lastResult?.imageUrl) fail('还没有实际成图，请先生成一张再评价');
        images.push({dataUrl:lastResult.imageUrl, referenceIdentity:referenceIdentity(lastResult), name:lastResult.name || '实际成图', role:'output', source:0});
      }
      const snapshot = {artContext, images, lastResult}; snapshotOwners.set(snapshot, s); return publish(snapshot);
    }
    function clearPrepared() {applied = null; fixedRoles = null; runtime()?.clearAgentPrepared?.();}
    function captureCreation({includeResult = false} = {}) {
      const rt=runtime(), ctx=rt?.captureContext?.();
      if (!ctx?.state) fail('绘图组件尚未就绪，请稍后再试');
      rt.capturePrompt?.(); const s=ctx.state;
      if ((s.provider || 'local') !== 'local' || s.nsfw) fail('当前小桃执行绘图需要本地模型，并关闭 NSFW');
      const engine=root.NovaFlowArtGenerateModels?.capabilityFor?.('local',s.mode,s)?.engine || s.localDrawEngine;
      if (!['qwen-2.1','qwen-2.1-turbo'].includes(engine)) fail('当前小桃执行绘图支持 Qwen 2.1，请先选择该模型');
      const sampling=root.NovaFlowArtGenerateModels?.localSamplingFor?.(s,s.mode,s.negativePrompt,engine,'drawing');
      if (!Number.isFinite(sampling?.steps) || !Number.isFinite(sampling?.cfg)) fail('未能读取当前创作的实际采样参数，请先打开绘图页面');
      const refs=ctx.generationSurface === 'drawing' && s.mode === 'img2img' ? ctx.references.map((r,i)=>r?.dataUrl?{...r,source:i+1,referenceIdentity:referenceIdentity(r)}:null).filter(Boolean) : [];
      if (refs.length>1) fail('多参考图请明确主体与画风用途');
      const lastResult=ctx.generationSurface === 'drawing' ? rt.selectedResult?.() || null : null;
      const images=refs.map(r=>({dataUrl:r.dataUrl,referenceIdentity:r.referenceIdentity,file:r.file,mimeType:r.mimeType,name:r.name || '原图',source:r.source,role:'subject'}));
      if (includeResult && lastResult?.imageUrl) images.push({dataUrl:lastResult.imageUrl,referenceIdentity:referenceIdentity(lastResult),name:lastResult.name || '当前成图',source:0,role:'result'});
      const artContext=copy(Object.fromEntries(SETTINGS.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])));
      Object.assign(artContext,{surface:'drawing',sourceSurface:ctx.generationSurface,task:'creation',engine:'qwen-2.1',provider:'local',nsfw:false,
        localQwen21Variant:s.localQwen21Variant || 'standard',steps:sampling.steps,cfg:sampling.cfg,
        mode:refs.length || s.mode==='img2img' && lastResult ? 'img2img' : 'txt2img',prompt:s.prompt || '',negativePrompt:s.negativePrompt || '',referenceRoles:refs.map(r=>({source:r.source,role:'subject'}))});
      const snapshot={artContext,images,lastResult}; snapshotOwners.set(snapshot,s); creationSettings.set(snapshot,copy(Object.fromEntries(SETTINGS.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])))); return publish(snapshot);
    }
    function captureAny(options) {
      const ctx=runtime()?.captureContext?.();
      return ctx?.generationSurface === 'drawing' && ctx.state.mode === 'img2img' && ctx.references.filter(r=>r?.dataUrl).length>=2 ? capture(options) : captureCreation(options);
    }
    async function openDrawing(mode) {
      const doc=root.document;
      const current=runtime()?.captureContext?.();
      if(current?.generationSurface==='drawing' && current.state.active && (!mode || current.state.mode===mode))return current;
      if (runtime()?.captureContext?.().generationSurface !== 'drawing') {
        const primary=doc?.querySelector('[data-novaflow-primary-entry="1"][data-novaflow-primary-label="美工"]');
        if (!primary) fail('未找到绘图入口，请先打开美工页面');
        primary.click();
        for(let i=0;i<40;i++) {
          const entry=Array.from(doc.querySelectorAll('[data-novaflow-secondary-entry="1"]')).find(e=>e.textContent.trim()==='绘图');
          if(entry) {if(entry.getAttribute('aria-pressed')!=='true') entry.click(); break;}
          await new Promise(resolve=>root.setTimeout(resolve,50));
        }
      }
      runtime()?.activate?.(mode);
      for(let i=0;i<40;i++) {const ctx=runtime()?.captureContext?.(); if(ctx?.generationSurface==='drawing') {if(ctx.state.active) return ctx; runtime()?.activate?.(mode);} await new Promise(resolve=>root.setTimeout(resolve,50));}
      fail('绘图页面未就绪，未写入或生成');
    }
    function captureChat({includeResult=false, drawingPreview=false, includeDrawingReferences=true}={}) {
      let ctx; try {ctx = runtime()?.captureContext?.();} catch {}
      const artContext = {surface:ctx?.generationSurface || 'other'};
      if (ctx?.generationSurface === 'drawing') {
        runtime()?.capturePrompt?.();
        Object.assign(artContext, copy(Object.fromEntries(SETTINGS.filter(k => ctx.state[k] !== undefined).map(k => [k, ctx.state[k]]))));
      }
      const images=includeDrawingReferences&&ctx&&(ctx.generationSurface==='drawing'||drawingPreview)?(ctx.references||[]).map((ref,i)=>ref?.dataUrl?{source:i+1,role:ref.drawingRole&&ref.drawingRole!=='auto'?ref.drawingRole:'attachment',dataUrl:ref.dataUrl,referenceIdentity:referenceIdentity(ref),file:ref.file,mimeType:ref.mimeType,name:ref.name||'参考图',...imageDimensions(ref)}:null).filter(Boolean):[];
      if(includeResult){const result=rtResult();if(result?.imageUrl)images.push({source:0,role:'result',dataUrl:result.imageUrl,referenceIdentity:referenceIdentity(result),name:'当前成图',...imageDimensions(result)});}
      if(images.length>3)fail('小桃一次可分析三张完整图片，请移除多余参考后发送');
      return publish({artContext, images});
    }
    function publish(snapshot) {
      // The 500ms UI tick and credit estimate only inspect metadata. Reading
      // bytes here made those passive checks start full image conversions.
      let pending;
      Object.defineProperty(snapshot, 'then', { value(resolve, reject) {
        if (!pending) pending = materializeSnapshot(snapshot).then(resolved => {
          const owner = snapshotOwners.get(snapshot);
          if (owner) snapshotOwners.set(resolved, owner);
          if (creationSettings.has(snapshot)) creationSettings.set(resolved, creationSettings.get(snapshot));
          return resolved;
        });
        return pending.then(resolve, reject);
      } });
      return snapshot;
    }
    async function materializeSnapshot(snapshot) {
      const images = [];
      for (const img of snapshot.images || []) {
        const dataUrl = await resolveReferenceDataUrl({ dataUrl: img.dataUrl, file: img.file, mimeType: img.mimeType });
        images.push({ dataUrl, referenceIdentity: img.referenceIdentity, name: img.name, role: img.role, source: img.source, ...imageDimensions(img) });
      }
      return { artContext: snapshot.artContext, images, lastResult: snapshot.lastResult };
    }
    function rtResult(){return runtime()?.selectedResult?.();}
    function readSampling() {
      const rt = runtime(), ctx = rt?.captureContext?.(), s = ctx?.state, models = root.NovaFlowArtGenerateModels;
      if (!s || (s.provider || 'local') !== 'local' || s.nsfw) fail('请先选择本地 Qwen 2.1 绘图并关闭 NSFW');
      const engine = models?.capabilityFor?.('local', s.mode, s)?.engine || s.localDrawEngine;
      if (!['qwen-2.1','qwen-2.1-turbo'].includes(engine)) fail('当前采样确认支持 Qwen 2.1 绘图，请先选择该模型');
      const policy = ctx.generationSurface === 'drawing' && s.mode === 'img2img' && (ctx.references || []).filter(ref=>ref?.dataUrl).length === 2 ? direction()?.samplingOptions?.(ctx) : undefined;
      const sampling = models?.localSamplingFor?.(s, s.mode, s.negativePrompt, 'qwen-2.1', 'drawing', policy);
      if (!Number.isFinite(sampling?.steps) || !Number.isFinite(sampling?.cfg)) fail('未能读取实际生图参数，请先打开绘图页面');
      const binding = {artContext:copy(Object.fromEntries(SETTINGS.filter(k => k !== 'prompt' && s[k] !== undefined).map(k => [k,s[k]]))),
        images:(ctx.references || []).map((ref,i) => ref?.dataUrl ? {source:i+1,role:ref.drawingRole || 'auto',dataUrl:ref.dataUrl} : null).filter(Boolean)};
      Object.assign(binding.artContext,{surface:ctx.generationSurface,steps:sampling.steps,cfg:sampling.cfg});
      if (ctx.projectId !== undefined) binding.artContext.projectId = ctx.projectId;
      return {variant:sampling.route === 'qwen-2.1-turbo' || s.localQwen21Variant === 'turbo' ? 'turbo' : 'standard',steps:sampling.steps,cfg:sampling.cfg,
        styleTransfer:ctx.generationSurface === 'drawing' && s.mode === 'img2img' && binding.images.length === 2,binding};
    }
    function setSampling(choice) {
      if (!['current','turbo','standard'].includes(choice)) fail('请选择当前参数、Turbo 8 步 CFG3，或普通 25 步 CFG3');
      const before = readSampling(), rt = runtime(), s = rt.captureContext().state;
      if (s.running) fail('当前正在生成，请等待结束');
      const currentKey = `${before.variant === 'turbo' ? 'qwen-2.1-turbo' : 'qwen-2.1'}:${s.mode === 'img2img' ? 'img2img' : 'txt2img'}`;
      const confirmedCfg = before.styleTransfer ? 3 : before.cfg;
      if (choice === 'current' && s.samplingOverrides?.[currentKey]?.cfg === confirmedCfg) return before;
      {
        const models = root.NovaFlowArtGenerateModels;
        if (typeof models?.setLocalSamplingValue !== 'function') fail('采样接口未就绪，未修改绘图参数');
        const previous = {localQwen21Variant:s.localQwen21Variant,samplingOverrides:copy(s.samplingOverrides || {})};
        try {
          if (choice !== 'current') s.localQwen21Variant = choice === 'turbo' ? 'turbo' : 'standard';
          const steps = choice === 'current' ? before.steps : choice === 'turbo' ? 8 : 25, cfg = choice === 'current' ? confirmedCfg : 3;
          if (choice !== 'current') models.setLocalSamplingValue(s,s.mode,'steps',String(steps));
          models.setLocalSamplingValue(s,s.mode,'cfg',String(cfg));
          // A user's explicit confirmation is manual even when equal to today's
          // default. Native guidance registered later must not silently change it.
          const route = readSampling().variant === 'turbo' ? 'qwen-2.1-turbo' : 'qwen-2.1', key = `${route}:${s.mode === 'img2img' ? 'img2img' : 'txt2img'}`;
          s.samplingOverrides = {...s.samplingOverrides,[key]:{...s.samplingOverrides?.[key],cfg}};
          const actual = readSampling();
          if (actual.variant !== (choice === 'current' ? before.variant : choice) || actual.steps !== steps || actual.cfg !== cfg) fail('实际采样参数未与选择一致，未开始分析');
        } catch (error) {Object.assign(s,previous); throw error;}
        rt.render?.({forceBottom:true});
      }
      return readSampling();
    }
    async function optimizeProposal(proposal, snapshot, message, options = {}) {
      if(snapshot.artContext.task!=='creation')return proposal;
      const current=captureCreation({includeResult:snapshot.images.some(i=>i.role==='result')});
      if(!sameSnapshot(snapshot,current) || proposal.contextFingerprint!==await fingerprint(current))fail('绘图内容已变化，未优化旧方案');
      if(typeof root.__NovaFlowSmartAI?.optimizeForAgent!=='function')fail('原有生图提示词优化框架尚未加载');
      const model=root.NovaFlowArtGenerateModels?.capabilityFor?.('local',proposal.generationMode,current.artContext);
      const result=await root.__NovaFlowSmartAI.optimizeForAgent({...options,surface:'art',prompt:proposal.prompt,negativePrompt:proposal.negativePrompt,
        requirements:message,engine:current.artContext.localQwen21Variant==='turbo'?'qwen-2.1-turbo':'qwen-2.1',generationMode:proposal.generationMode,
        supportsNegativePrompt:model?.negativePrompt!==false});
      if(options.signal?.aborted || !sameSnapshot(snapshot,captureCreation({includeResult:snapshot.images.some(i=>i.role==='result')})))fail('绘图内容已变化或优化已停止，未写入或生成');
      const slots=[...result.prompt.matchAll(/<image(\d+)>/g)].map(m=>m[1]);
      if(proposal.generationMode==='img2img' && !slots.includes('1') || slots.some(n=>n!=='1'))fail('生图优化未保留当前原图引用，未写入或生成');
      const next={...proposal,prompt:result.displayPrompt || result.prompt,modelPrompt:result.prompt,negativePrompt:result.negativePrompt,promptOptimization:result.optimization,
        analysisBackend:result.analysisBackend,resourcesReleased:result.resourcesReleased,generationReady:result.generationReady};
      optimizedCreations.set(next,{prompt:next.prompt,modelPrompt:next.modelPrompt,negativePrompt:next.negativePrompt,contextFingerprint:proposal.contextFingerprint});
      return next;
    }
    async function applyProposal(proposal, snapshot, {sampling} = {}) {
      if (runtime()?.state.running) fail('当前正在生成，请等待结束');
      if (sampling && !sameSnapshot(sampling.binding,readSampling().binding)) fail('已确认参数或参考内容已变化，请重新确认');
      if (snapshot.artContext.task === 'creation') {
        const withResult=snapshot.images.some(i=>i.role==='result'), current=captureCreation({includeResult:withResult});
        if (!sameSnapshot(snapshot,current) || proposal.contextFingerprint!==await fingerprint(current)) fail('绘图内容已变化，旧方案未执行');
        if (proposal.kind!=='qwen21-agent-direct' || proposal.resourcesReleased!==true || proposal.generationReady!==true || proposal.analysisBackend!=='strata'
          || !['server-model-id','server-weight-path'].includes(proposal.modelIdentity?.verification) || !proposal.modelIdentity.id || !Array.isArray(proposal.promptIds) || !proposal.promptIds.length) fail('缺少已核验的模型资源交接凭据');
        const optimized=optimizedCreations.get(proposal);
        if(proposal.promptOptimization && (!optimized || optimized.prompt!==proposal.prompt || optimized.modelPrompt!==proposal.modelPrompt || optimized.negativePrompt!==proposal.negativePrompt || optimized.contextFingerprint!==proposal.contextFingerprint))fail('原有优化结果已变化或未经过本次校验');
        if(typeof proposal.prompt!=='string' || !proposal.prompt.trim() || !optimized && proposal.negativePrompt!==current.artContext.negativePrompt || !['txt2img','img2img'].includes(proposal.generationMode)) fail('创作方案内容无效');
        const refs=proposal.generationMode==='txt2img' ? [] : current.images.filter(i=>i.role==='subject');
        if(proposal.generationMode==='img2img' && !refs.length && current.lastResult?.imageUrl) refs.push({dataUrl:current.lastResult.imageUrl,name:current.lastResult.name || '当前成图',source:1,role:'subject'});
        if(proposal.generationMode==='img2img' && refs.length!==1) fail('没有可供修改的完整原图或成图');
        const owner=snapshotOwners.get(snapshot), ctx=await openDrawing(proposal.generationMode), state=ctx.state, rt=runtime();
        if(owner && owner!==state || state.running || (state.prompt || '')!==current.artContext.prompt || (state.negativePrompt || '')!==current.artContext.negativePrompt) fail('绘图工作区已变化，未执行旧方案');
        if(Object.entries(creationSettings.get(current) || {}).some(([key,value])=>key!=='mode' && JSON.stringify(canonical(state[key]))!==JSON.stringify(canonical(value)))) fail('绘图参数已变化，未执行旧方案');
        const settings=proposal.settings || {};
        if(Object.keys(settings).some(k=>!['width','height'].includes(k) || !Number.isInteger(settings[k]) || settings[k]<64 || settings[k]>4096)) fail('绘图尺寸无效');
        Object.assign(state,settings,{mode:proposal.generationMode,prompt:proposal.prompt,negativePrompt:proposal.negativePrompt});
        if (sampling) {
          const models = root.NovaFlowArtGenerateModels;
          models.setLocalSamplingValue(state,state.mode,'steps',String(sampling.steps));
          models.setLocalSamplingValue(state,state.mode,'cfg',String(sampling.cfg));
          const actual = readSampling();
          if (actual.variant !== sampling.variant || actual.steps !== sampling.steps || actual.cfg !== sampling.cfg) fail('模式切换后的实际采样与确认不一致，未生成');
        }
        rt.render?.({forceBottom:true});
        const expected=captureCreation({includeResult:withResult}), runState=copy(Object.fromEntries(SETTINGS.filter(k=>state[k]!==undefined).map(k=>[k,state[k]])));
        const prepared={state:{...runState,count:1},promptSnapshot:{prompt:optimized ? proposal.modelPrompt : proposal.prompt,negativePrompt:proposal.negativePrompt},references:refs.map((r,i)=>({...r,role:'subject',sourceNumber:i+1})),direct:true,agentRun:true,
          plan:{schema:'nf.art.agent-creation.v1',prompt:proposal.prompt,modelPrompt:optimized ? proposal.modelPrompt : proposal.prompt},
          originalPrompt:current.artContext.prompt,agentContextFingerprint:proposal.contextFingerprint,agentInputFingerprint:await fingerprint(expected),
          assertCurrent:()=>{if(context().state!==state || !sameSnapshot(expected,captureCreation({includeResult:withResult}))) fail('绘图内容已变化，旧方案已失效');},recordReview:()=>{}};
        applied={prepared,snapshot:expected}; rt.stageAgentPrepared?.(prepared); return {snapshot:expected};
      }
      if (snapshotOwners.has(snapshot) && snapshotOwners.get(snapshot) !== context().state) fail('绘图工作区已变化，请重新发送当前内容');
      const current = capture({includeResult:snapshot.images.length === 3});
      if (!sameSnapshot(snapshot, current) || proposal.contextFingerprint !== await fingerprint(current)) fail('绘图内容已变化，请让小桃根据当前内容重新建议');
      if (typeof proposal.prompt !== 'string' || !proposal.prompt.trim() || proposal.negativePrompt !== current.artContext.negativePrompt) fail('建议未保留当前负向内容，请重新分析');
      const ctx = context(), rt = runtime(), state = ctx.state, api = direction();
      const source = api.input({...ctx, state:{...state, drawingAnalysisEngine:'local'}});
      source.references = current.images.slice(0, 2).map(img => ({...source.references.find(ref => ref.source === img.source), source:img.source, role:img.role, roles:[img.role]}));
      const order = proposal.sourceOrder;
      if (!Array.isArray(order) || order.join(',') !== '1,2') fail('参考图顺序不完整，请重新分析');
      const enhancer = {...copy(proposal), sourceOrder:order.map(n => current.images[n - 1].source)};
      const raw = {schema:api.schema, prompt:proposal.prompt, summary:'小桃AI绘图建议', preserve:[], exclude:[], clarification:'', editEnhancer:enhancer,
        references:source.references.map(ref => ({source:ref.source, uses:[{role:ref.role, detail:ref.role === 'subject' ? '完整主体原图' : '完整画风原图', box:[0,0,1000,1000], samples:[]}], omit:[]}))};
      const plan = api.validate(raw, source);
      const checkBeforeWrite = () => {if (!sameSnapshot(current, capture({includeResult:current.images.length === 3}))) fail('绘图内容已变化，旧建议未应用');};
      const compiled = await api.compile(plan, source, () => {}, checkBeforeWrite, ctx.referenceLimit || 10); checkBeforeWrite();
      state.prompt = compiled.promptSnapshot.prompt.replace(/<image(\d+)>/g, (tag, n) => `@参考图${compiled.references[Number(n) - 1]?.sourceNumber || n}`);
      fixedRoles = {prompt:state.prompt, original:ctx.references.map((ref, i) => ref?.dataUrl ? {dataUrl:ref.dataUrl, source:i + 1, role:current.images.find(img => img.source === i + 1)?.role} : null).filter(Boolean)};
      api.registerAgentWriteback?.({...ctx,state},compiled);
      rt.render?.({forceBottom:true});
      const expected = capture({includeResult:current.images.length === 3});
      const runState = copy(Object.fromEntries(SETTINGS.filter(k => state[k] !== undefined).map(k => [k, state[k]])));
      Object.assign(runState, {count:1, mode:'img2img', localDrawEngine:'qwen-2.1', uiPreserveLayout:false});
      const prepared = {...compiled, state:runState, plan, analysisInput:source, originalPrompt:current.artContext.prompt, direct:false, agentRun:true,
        agentContextFingerprint:proposal.contextFingerprint, agentInputFingerprint:await fingerprint(expected),
        assertCurrent:() => {if (context().state !== state || !sameSnapshot(expected, capture({includeResult:expected.images.length === 3}))) fail('绘图内容已变化，旧建议已失效');}, recordReview:() => {}};
      applied = {prepared, snapshot:expected}; rt.stageAgentPrepared?.(prepared);
      return {snapshot:expected};
    }
    async function generateApplied() {
      if (!applied) fail('请先应用当前建议');
      const rt = runtime(); if (rt.state.running) fail('当前正在生成，请勿重复提交');
      applied.prepared.assertCurrent(); const previous = rt.selectedResult?.()?.id; applied = null;
      await rt.run();
      const result = rt.selectedResult?.();
      if (result?.id && result.id !== previous && result.imageUrl) return copy(result);
      fail(rt.state.error || rt.state.status || '未取得新的实际成图');
    }
    return Object.freeze({capture, captureAny, captureCreation, captureChat, openDrawing, readSampling, setSampling, optimizeProposal, currentResult:()=>runtime()?.selectedResult?.(), hasResult:()=>Boolean(runtime()?.selectedResult?.()?.imageUrl), applyProposal, generateApplied, clearPrepared, cancelGeneration:() => runtime()?.cancel?.()});
  }
  function roundedCredits(value) {return displayCredits(value);}
  function creditReceipt(quota) {
    if (!quota || quota.local) return '';
    const settled = roundedCredits(quota.settled_credits ?? quota.charged_credits);
    if (settled == null) return '';
    const unit = quota.billing_mode === 'token' ? '分' : '积分';
    const quoted = roundedCredits(quota.quote_estimated_credits);
    const estimated = roundedCredits(quota.expected_credits ?? quota.estimated_credits);
    return `本次实扣 ${settled} ${unit}${quoted != null ? `（${quota.quote_estimate_label || '提交时估算预留'} ${quoted}）` : estimated == null ? '' : `（预估 ${estimated}）`}`;
  }
  // Keep all user wording and the assistant's factual answer, but do not feed
  // execution prompts, full editor snapshots and duplicate images back into the planner.
  function compactFoartHistory(history) {
    return (history||[]).map(row=>row.role==='assistant'?{...row,content:String(row.content||'').split('\n实际工具回执：')[0].split('\n实际执行事实：')[0]}:{...row});
  }
  function compactFoartReceipt(row) {
    const fields=['action','phase','surface','provider','modelLabel','name','id','fileName','taskId','target','mode','modeLabel','operation','control','value','message','blockId','pointCount','keyCount','width','height','seconds','bytes','format','sourceResultId','nativePromptApplied','optimizationReused','downloadInitiated','saved','placedInSource','selectedLayerIds','selectedLayerNames','editRegions','changed','constraintKind','constraint','previousConstraint','bone','previousBone','attachment','nativeResult','resourceId','publishedId','clipId','trackId','placement','previousPlacement','strokeBounds','weightChanges','vertexChanges','slot','previousSlot','skin'];
    const value=Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
    for(const key of ['inputs','outputs','resources','layers','sources'])if(Array.isArray(row[key]))value[key]=row[key].map(item=>Object.fromEntries(['id','name','label','kind','fileName','width','height','seconds','bytes','frames','fps','count','keptOriginal','downloadId','uploadId','sourceMaterialId','promptId','downloadInitiated','saved'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]])));
    if(Array.isArray(row.results))value.results=row.results.map(compactFoartReceipt);
    if(row.inspection)value.inspection=row.inspection;
    if(row.context?.selectedKeys)value.context={name:row.context.name,revision:row.context.revision,animation:row.context.animation,frame:row.context.frame,selectedBones:row.context.selectedBones,selectedKeys:row.context.selectedKeys};
    return value;
  }
  function createController({bridge, api: getApi = () => root.electronAPI, storage = root.localStorage, onChange = () => {}, timers = root, uploadHost = null} = {}) {
    let retired = false;
    const api = () => retired ? null : getApi();
    if (storage === root.localStorage) storage = createTabScopedStorage(root.localStorage, root.sessionStorage);
    const state = {provider:'local', modelId:'qwen3.5-9b-heretic', mode:'chat', activeTask:null,messages:[], history:[], conversationId:'', proposal:null, proposalSnapshot:null, applied:false, applying:false, pending:false, generating:false, uploading:false, staging:false, confirmation:null, samplingApproval:null, operation:null, status:'', error:'', model:'Qwen3.5 9B', toolTrace:[], localSession:null, localModelStatus:null, qwenExecutionDevice:null, qwen35CpuTrialChecked:false, pricingPolicy:null, pricingError:'',billingNotices:[]};
    const operationRecoveryStates=new Map();
    let pendingFoartImageReview=null,foartImageReviewUndo=null;
    state.foartImageReviewCanUndo=false;
    const pricingKey = 'novaflow.xiaotao-pricing.v1';
    let metering = null;
    const pricingTtl = 15 * 60 * 1000;
    try {const saved = JSON.parse(root.localStorage?.getItem(pricingKey) || 'null'); if (saved && Date.now()-saved.updatedAt < pricingTtl) metering = saved;} catch {}
    let pricingRequest = null;
    function currentPricingPolicy() {
      const policy=state.pricingPolicy;
      return policy && /^sha256:[a-f0-9]{64}$/.test(policy.version || '') && Number.isFinite(policy.expiresAt) && Date.now()<policy.expiresAt &&
        policy.config && typeof policy.config==='object' && Array.isArray(policy.models) ? policy : null;
    }
    function selectedOnlineModel(policy=currentPricingPolicy()) {return state.modelId==='legacy-online' ? policy?.defaultModel : state.modelId;}
    // A quote must be fresh before submission. Its cache expiry does not
    // invalidate a result that is already paid for, or a pending prompt review.
    // Still invalidate on a real policy/version, account, model or workspace change.
    function pricingBindingCurrent(version) {return !!version&&state.pricingPolicy?.version===version;}
    // Any operation-level price must come from the same current, versioned
    // policy as the quote; historic one-credit policies remain valid in flight.
    function onlineOperationMinimumConfirmed() {
      const online=currentPricingPolicy()?.config?.xiaotao_online;
      return legacyOperationCreditsPolicy(online);
    }
    function onlineOperationDecimalConfirmed() {
      const online=currentPricingPolicy()?.config?.xiaotao_online;
      return online?.billing_scope==='operation' && decimalCreditsPolicy(online);
    }
    function policyAllowsOnline(id, requireAvailable=true) {
      const policy=currentPricingPolicy();
      if(!policy)return false;
      const selected=id==='legacy-online' ? policy.defaultModel : id;
      if(!['deepseek/deepseek-v4.1-flash','xai/grok-4.7','openai/gpt-6.1-sol-saver'].includes(selected))return false;
      const online=policy.config?.xiaotao_online, rates=selected==='xai/grok-4.7' ? online?.grok_4_7_rates : online?.model_rates?.[selected];
      if(hasDecimalCreditsFields(online) && !decimalCreditsPolicy(online) || online?.billing_scope==='operation' && !operationCreditsPolicy(online))return false;
      if(selected==='deepseek/deepseek-v4.1-flash'&&requireAvailable&&(!operationCreditsPolicy(online)||online?.operation_text_chat_v3!==true))return false;
      const tokenBilling=policy.config?.token_billing;
      const valid=value=>typeof value==='number' && Number.isFinite(value) && value>=0;
      if(!online || !(Number(policy.config.credits_per_usd)>0) || !(Number(online.markup)>0) || !Number.isSafeInteger(online.message_cap_credits) || online.message_cap_credits<1 || !tokenBilling || !['ceil','floor','round'].includes(tokenBilling.round) || !Number.isSafeInteger(tokenBilling.min_credits_per_image) || tokenBilling.min_credits_per_image<0 || !rates || !valid(rates.input) || !valid(rates.output))return false;
      if(selected==='xai/grok-4.7' && (!valid(rates.cached_input) || !valid(rates.high_input) || !valid(rates.high_output) || !valid(rates.high_cached_input) || !Number.isSafeInteger(rates.high_input_threshold)))return false;
      if(selected!=='xai/grok-4.7' && !valid(rates.cached))return false;
      if(selected==='deepseek/deepseek-v4.1-flash'&&(rates.input<=0||rates.output<=0))return false;
      if(selected==='openai/gpt-6.1-sol-saver' && (!valid(rates.highInput) || !valid(rates.highOutput) || !Number.isSafeInteger(rates.highAbove)))return false;
      return policy.models.some(item=>item?.id===id && (!requireAvailable || item.available===true));
    }
    function modelAvailable(id) {
      const model=CHAT_MODELS[id];if(!model || model.retired)return false;
      return model.provider==='api' ? id!=='legacy-online' && policyAllowsOnline(id) : id==='qwen3.5-9b-heretic' ? state.qwen35CpuTrialAvailable===true : model.available===true;
    }
    function hideLegacyOnlineOption() {return true;}
    // Use the live quote policy; rounded=true changes display only.
    function modelRateSummary(id, rounded=false) {
      // A disabled model may still have a current published rate. Display it
      // as a reference without changing whether that model can be submitted.
      if(id==='legacy-online'||!policyAllowsOnline(id,false))return '';
      const policy=currentPricingPolicy(),online=policy.config.xiaotao_online;
      const rates=id==='xai/grok-4.7'?online.grok_4_7_rates:online.model_rates[id];
      const factor=Number(policy.config.credits_per_usd)*Number(online.markup),points=value=>rounded ? String(Math.round(value*factor)) : decimalCreditsPolicy(online) ? displayCredits(value*factor) : Number((value*factor).toFixed(4)).toString();
      return `1M 输入约 ${points(rates.input)} / 输出约 ${points(rates.output)} 积分`;
    }
    function onlinePriceDetails(id=state.modelId) {
      if(id==='legacy-online')return '旧在线线路型号由后台配置，按旧计费规则结算；价格未同步，发送前估算仅供参考。';
      const policy=currentPricingPolicy();if(!policy || !policyAllowsOnline(id))return id==='legacy-online'?'原在线线路按服务端规则结算，当前无法同步价格。':'';
      const model=id==='legacy-online'?policy.defaultModel:id, online=policy.config.xiaotao_online;
      const rates=model==='xai/grok-4.7'?online.grok_4_7_rates:online.model_rates[model];
      const factor=Number(policy.config.credits_per_usd)*Number(online.markup);
      const points=n=>decimalCreditsPolicy(online) ? displayCredits(n*factor) : Number((n*factor).toFixed(4)).toString();
      let text=`缺少接口金额时的参考单价（每百万 token）：输入约 ${points(rates.input)} 积分，输出约 ${points(rates.output)} 积分，缓存命中约 ${points(model==='xai/grok-4.7'?rates.cached_input:rates.cached)} 积分。`;
      if(model==='xai/grok-4.7')text+=`\n单次请求输入达到 ${rates.high_input_threshold} token：输入约 ${points(rates.high_input)}、输出约 ${points(rates.high_output)}、缓存约 ${points(rates.high_cached_input)} 积分/百万 token。`;
      if(model==='openai/gpt-6.1-sol-saver')text+=`\n单次请求输入超过 ${rates.highAbove} token：输入约 ${points(rates.highInput)}、输出约 ${points(rates.highOutput)}、缓存约 ${points(rates.cached)} 积分/百万 token。`;
      const rounding={ceil:'向上取整',floor:'向下取整',round:'四舍五入'}[policy.config.token_billing.round];
      const settlement=onlineOperationDecimalConfirmed()
        ? `各阶段按各自上限 ${online.message_cap_credits} 积分封顶后汇总，按实际用量结算至小数点后6位；操作合计可超过单阶段上限。`
        : onlineOperationMinimumConfirmed()
        ? `各阶段按各自上限 ${online.message_cap_credits} 积分封顶后汇总，按${rounding}结算，成功操作最低 ${online.minimum_positive_credits} 积分；操作合计可超过单阶段上限。`
        : `非零金额${rounding}，最低 ${policy.config.token_billing.min_credits_per_image} 积分，再按每次小桃请求最高 ${online.message_cap_credits} 积分封顶。工具任务可能发起多次小桃请求，合计可超过该上限。`;
      const pricingBasis=(onlineOperationMinimumConfirmed() || onlineOperationDecimalConfirmed()) && online.operation_text_chat_v3===true
        ? '按返回用量和上述费率快照计算，不使用币种尚未核实的接口金额；缓存用量缺失按线路规则处理。已提交但用量无法核实的请求保留预留待核对，不自动重试。'
        : '结算优先使用接口返回的金额；缺金额时按返回用量和上述费率快照估算，缓存用量缺失按线路规则处理。金额和用量都不足以计价时不扣积分，但供应商可能仍产生费用。';
      const zeroCost=onlineOperationDecimalConfirmed() && online.operation_text_chat_v3===true
        ? '成功操作按实际用量结算；取消或失败按已确认用量处理，全程未派发不扣，未知用量待核对。'
        : onlineOperationMinimumConfirmed() && online.operation_text_chat_v3===true
        ? '成功操作即使用量成本为零也至少扣 1 积分；取消或失败按已确认用量和原取整规则结算，全程未派发不扣，未知用量待核对。'
        : '金额为零扣 0 积分；';
      return text+`\n${pricingBasis}多次请求分别判档后汇总；这不是供应商账单。\n${zeroCost}${settlement}其他收费工具另计。\n发送前为估算预留${onlineOperationDecimalConfirmed()?'':'（有内容时至少 1 积分）'}，结算多退少补；最终以回执实扣为准。`;
    }
    function visiblePricingDetails() {
      const model=CHAT_MODELS[state.modelId];
      if(model?.retired)return model.detail;
      if(model?.provider==='local')return '本地大脑对话免费；使用收费生图、视频等工具按各自价格另计。';
      if(state.modelId==='legacy-online')return onlinePriceDetails();
      if(!currentPricingPolicy())return (model?.detail||'在线模型暂不可用')+'；'+(state.pricingError||'当前价格策略未取得，不能提交');
      return onlinePriceDetails()||(model?.detail||'当前型号未开通，不能提交');
    }
    function pricingPolicyKey(){return currentPricingPolicy()?.version||'';}
    async function refreshPricingPolicy() {
      if(pricingRequest)return pricingRequest;
      pricingRequest=(async()=>{
        try {
          const response=await api()?.companionPricing?.();
          const policy=response?.ok===true ? response.policy : null;
          state.pricingPolicy=policy && /^sha256:[a-f0-9]{64}$/.test(policy.version || '') && Number.isFinite(policy.expiresAt) && policy.expiresAt>Date.now() && policy.config && typeof policy.config==='object' && Array.isArray(policy.models) ? copy(policy) : null;
          state.pricingError=state.pricingPolicy ? '' : String(response?.error || '在线积分价格暂不可用');
        } catch(error) {state.pricingPolicy=null;state.pricingError=String(error?.message || error);}
      finally {pricingRequest=null;if(state.provider==='api' && !state.pending && !state.error)state.status=modelAvailable(state.modelId) ? '' : state.pricingError || CHAT_MODELS[state.modelId]?.detail || '在线模型尚未开通';if(state.provider==='api'&&!state.pending&&!state.error&&state.promptSourceCancelledNotice&&!state.status.includes(state.promptSourceCancelledNotice))state.status=[state.status,state.promptSourceCancelledNotice].filter(Boolean).join(' ');notify();}
        return currentPricingPolicy();
      })();
      return pricingRequest;
    }
    function prefetchPricingPolicy(){if(!currentPricingPolicy()&&typeof api()?.companionPricing==='function')void refreshPricingPolicy();}
    function selectedPricingPayload() {
      const policy=currentPricingPolicy();
      if(state.provider!=='api' || state.modelId==='legacy-online' || !policy || !policyAllowsOnline(state.modelId))return {};
      const selected=state.modelId;
      const terms=policy.config?.xiaotao_online;
      const operationBillingV3=operationCreditsPolicy(terms) && terms?.operation_text_chat_v3===true;
      const operationVisionBillingV3=operationBillingV3 && terms?.operation_vision_chat_v3===true;
      const operationFoartOpenV3=operationBillingV3 && terms?.operation_foart_open_v3===true;
      const operationFoartRotationV3=operationBillingV3 && terms?.operation_foart_rotation_v3===true;
      const operationFoartGeneralV3=operationFoartOpenV3 && terms?.operation_foart_general_v3===true;
      return {pricingVersion:policy.version,pricingExpiresAt:policy.expiresAt,expectedModelId:selectedOnlineModel(policy),...(operationBillingV3?{operationBillingV3:true}:{}),...(operationVisionBillingV3?{operationVisionBillingV3:true}:{}),...(operationFoartOpenV3?{operationFoartOpenV3:true}:{}),...(operationFoartRotationV3?{operationFoartRotationV3:true}:{}),...(operationFoartGeneralV3?{operationFoartGeneralV3:true}:{}),onPricingQuote:quote=>{
        if(state.pending && state.modelId===selected && activeRequest===quote?.requestId) {state.status=`本轮估算预留 ${displayCredits(quote.estimatedCredits)} 分；最终按返回用量计算`;notify();}
      }};
    }
    function handlePricingFailure(response) {
      if(response?.errorCode==='companion-pricing-changed') {state.pricingPolicy=null;void refreshPricingPolicy();}
    }
    function predictOnline(input) {
      const policy=currentPricingPolicy(), model=selectedOnlineModel(policy), prices=root.NovaFlowFeatureCreditPrices;
      if(metering && Date.now()-metering.updatedAt>=pricingTtl)metering=null;
      if(state.modelId==='legacy-online')return prices?.predictXiaotaoOnline?.({...input,model:metering?.model,config:metering?.config,samples:metering?.samples}) || prices?.estimateXiaotaoOnline?.(input) || null;
      if(!policy || !policyAllowsOnline(state.modelId))return null;
      const samples=metering?.model===model && metering?.pricingVersion===policy.version ? metering.samples : [];
      return prices?.predictXiaotaoOnline?.({...input,model,config:policy.config,samples}) || null;
    }
    function onlineQuote(message) {return predictOnline(onlineEstimateInput(message));}
    let serial = 0, activeRequest = '', activeSnapshot = null, activeMode = 'chat', activeChatHasImages = false, stopped = false, statusTimer = null, activeStartedAt = 0, lastRequestMessage = '';
    let mediaAbort = null, promptAbort = null, foartAbort = null, activeFoartBilling=null, activeChatBilling=null;
    // Tokens stay in this controller only; never persist them or send them to a model.
    let selectionTicket=null, selectionUndo=null, selectionEpoch=0;
    state.selectionPreview=null; state.selectionUndoAvailable=false;
    function clearSelectionTickets() {
      selectionEpoch++;
      if(selectionTicket) {try {root.NovaFlowFoartTools?.cancelCommunitySelection?.(selectionTicket.token);} catch {}}
      selectionTicket=null;selectionUndo=null;state.selectionPreview=null;state.selectionUndoAvailable=false;
    }
    function cancelCommunitySelection() {
      if(!selectionTicket)return false;
      clearSelectionTickets();state.status='已取消骨骼选择，未修改作品';state.error='';notify();return true;
    }
    function confirmCommunitySelection(event) {
      if(event?.isTrusted!==true || !selectionTicket || state.pending || !communityModel(state.modelId) || selectionTicket.modelId!==state.modelId)return false;
      const ticket=selectionTicket;selectionTicket=null;state.selectionPreview=null;
      try {
        const result=root.NovaFlowFoartTools.confirmCommunitySelection(ticket.token,event);
        if(result?.boneName!==ticket.boneName || typeof result.undoToken!=='string')throw new Error('原生骨骼选择未返回可核验的结果');
        selectionUndo={token:result.undoToken,modelId:state.modelId};state.selectionUndoAvailable=true;
        state.messages.push({role:'assistant',content:'已选中骨骼：'+result.boneName+'。仅改变选区，未写入关键帧。'});
        state.status='已选中骨骼，可撤销选择';state.error='';notify();return true;
      } catch(error) {selectionUndo=null;state.selectionUndoAvailable=false;state.error=String(error?.message||error);state.status='选择未确认，请重新检查当前画面';notify();return false;}
    }
    function undoCommunitySelection(event) {
      if(event?.isTrusted!==true || !selectionUndo || state.pending || selectionUndo.modelId!==state.modelId)return false;
      const ticket=selectionUndo;selectionUndo=null;state.selectionUndoAvailable=false;
      try {root.NovaFlowFoartTools.undoCommunitySelection(ticket.token,event);state.status='已撤销本次骨骼选择';state.error='';notify();return true;}
      catch(error) {state.error=String(error?.message||error);state.status='当前状态已变化，未撤销选择';notify();return false;}
    }
    let qwenSeekPreview = null, qwenSeekUndo = null;
    state.qwenSeekProposal = null; state.qwenSeekCanUndo = false;
    const qwenSeekEditor = () => root.NovaFlowSkeletonEditor?.active?.() && root.NovaFlowSkeletonEditor.api?.();
    function clearQwenSeek() {
      const preview=qwenSeekPreview, undo=qwenSeekUndo; qwenSeekPreview=null; qwenSeekUndo=null;
      state.qwenSeekProposal=null; state.qwenSeekCanUndo=false;
      if(preview) {try { preview.editor.agentCancelCommunitySeek?.(preview.token); } catch { /* already stale */ }}
      if(undo) {try { undo.editor.agentDiscardCommunitySeekUndo?.(undo.token); } catch { /* already stale */ }}
    }
    function prepareQwenSeek(frame,{publish=true}={}) {
      if(state.modelId!=='qwen3.5-9b-heretic'||state.generating||state.applying||state.uploading||state.staging) return false;
      clearSelectionTickets();clearQwenSeek();
      try {
        const editor=qwenSeekEditor();
        if(!editor || typeof editor.agentPrepareCommunitySeek!=='function' || typeof editor.agentValidateCommunitySeek!=='function')throw new Error('动画定位预览尚未就绪');
        const prepared=editor.agentPrepareCommunitySeek(frame);
        if(!prepared || typeof prepared.token!=='string' || !Number.isSafeInteger(prepared.fromFrame) || prepared.fromFrame<0 || !Number.isSafeInteger(prepared.targetFrame) || prepared.targetFrame!==frame || typeof prepared.animation!=='string' || !prepared.animation || !Number.isFinite(prepared.expiresAt) || prepared.expiresAt<=Date.now()) {if(typeof prepared?.token==='string')try {editor.agentCancelCommunitySeek?.(prepared.token);} catch {} throw new Error('动画定位预览不完整');}
        qwenSeekPreview={editor,token:prepared.token,expiresAt:prepared.expiresAt,animation:prepared.animation,fromFrame:prepared.fromFrame,targetFrame:prepared.targetFrame};
        if(publish){state.qwenSeekProposal={animation:String(prepared.animation||''),fromFrame:prepared.fromFrame,targetFrame:prepared.targetFrame};state.error=''; state.status='请确认是否定位到目标帧；确认前不会改变帧位置';notify();}
        return true;
      } catch(error) {clearQwenSeek();state.error=String(error?.message||error);state.status='未改变帧位置';notify();return false;}
    }
    function cancelQwenSeek() {if(!qwenSeekPreview&&!qwenSeekUndo)return false;const hadPreview=!!qwenSeekPreview;clearQwenSeek();state.status=hadPreview?'已取消定位，未改变帧位置':'已关闭撤销，当前帧保持不变';notify();return true;}
    function confirmQwenSeek(event) {
      const preview=qwenSeekPreview;
      if(!preview || state.modelId!=='qwen3.5-9b-heretic' || state.pending || state.generating || state.applying || state.uploading || state.staging) return false;
      if(qwenSeekEditor()!==preview.editor || Date.now()>preview.expiresAt) {clearQwenSeek();state.error='定位预览已失效，请重新发起';notify();return false;}
      try {
        const receipt=preview.editor.agentCommitCommunitySeek(preview.token,event);
        qwenSeekPreview=null;state.qwenSeekProposal=null;
        if(!receipt || receipt.operation!=='seek' || receipt.phase!=='applied' || typeof receipt.undoToken!=='string' || receipt.frame!==preview.targetFrame || receipt.animation!==preview.animation)throw new Error('定位未返回可验证回执');
        qwenSeekUndo={editor:preview.editor,token:receipt.undoToken,frame:preview.fromFrame,animation:preview.animation};state.qwenSeekCanUndo=true;
        state.messages.push({role:'assistant',content:`已定位到动画“${receipt.animation}”第 ${receipt.frame} 帧；未修改工程。`});
        state.error='';state.status='已定位，可撤销本次定位';notify();return true;
      } catch(error) {if(error?.code!=='qwen-seek-trusted-click-required') {qwenSeekPreview=null;state.qwenSeekProposal=null;qwenSeekUndo=null;state.qwenSeekCanUndo=false;} state.error=String(error?.message||error);state.status='定位未完成，请检查当前帧';notify();return false;}
    }
    function undoQwenSeek(event) {
      const undo=qwenSeekUndo;
      if(!undo || state.modelId!=='qwen3.5-9b-heretic' || state.pending || state.generating || state.applying) return false;
      if(qwenSeekEditor()!==undo.editor) {clearQwenSeek();state.error='定位撤销已失效，请检查当前帧';notify();return false;}
      try {
        const receipt=undo.editor.agentUndoCommunitySeek(undo.token,event);
        qwenSeekUndo=null;state.qwenSeekCanUndo=false;
        if(!receipt || receipt.operation!=='seek_undo' || receipt.phase!=='applied' || receipt.frame!==undo.frame || receipt.animation!==undo.animation)throw new Error('撤销未返回可验证回执');
        state.messages.push({role:'assistant',content:`已撤销本次定位，回到第 ${receipt.frame} 帧；未修改工程。`});state.error='';state.status='定位已撤销';notify();return true;
      } catch(error) {if(error?.code!=='qwen-seek-trusted-click-required'){qwenSeekUndo=null;state.qwenSeekCanUndo=false;}state.error=String(error?.message||error);state.status='撤销未完成，请检查当前帧';notify();return false;}
    }
    // A single selected-bone rotation can be proposed by an online planner,
    // but only the native editor's trusted-click bridge can apply or undo it.
    let foartAudioPreview=null;
    state.foartAudioProposal=null;
    function settleFoartAudio(preview,{receipt,error}={}) {
      if(!preview||foartAudioPreview!==preview)return false;
      foartAudioPreview=null;state.foartAudioProposal=null;
      if(error)try{preview.studio.cancelAssistantAudioReview?.(preview.planId);}catch{}
      if(preview.timer!=null)timers.clearTimeout(preview.timer);
      preview.signal?.removeEventListener?.('abort',preview.abort);
      if(error)preview.reject(error);else preview.resolve(receipt);
      notify();void Promise.resolve().then(()=>refreshFoartAudioRecoveries()).catch(()=>{});return true;
    }
    async function prepareFoartAudio(op,signal,operation,sessionCurrent,selection,planningQuota) {
      const media=root.NovaFlowMediaAgent,studio=root.NovaFlowAudioStudio;
      if(!planningQuota||planningQuota.status!=='settled'||!Number.isFinite(planningQuota.settled_credits)||planningQuota.settled_credits<0||
        (planningQuota.uncollected_credits!==undefined&&planningQuota.uncollected_credits!==0))throw new Error('规划费用尚未结算，未提交音频生成');
      if(!ONLINE_AUDIO_ACTION_RELEASE_ENABLED||foartAudioPreview||typeof sessionCurrent!=='function'||sessionCurrent()!==true||
        !media||!studio||studio.isOpen?.()!==true||studio.sub?.()!=='audio'||op?.action!=='media'||op.operation?.target!=='audio'||
        op.operation.action!=='generate_music'||typeof op.operation.prompt!=='string'||!op.operation.prompt.trim()||op.operation.prompt.length>4000||
        (op.operation.count!==undefined&&op.operation.count!==1))throw new Error('音频操作尚不可确认，未提交');
      const kind=op.operation.action==='generate_music'?'music':'sfx',settings=studio.agentSettings?.();
      const seconds=op.operation.seconds??settings?.[kind]?.seconds;
      if(!Number.isFinite(seconds)||seconds<(kind==='music'?8:1)||seconds>(kind==='music'?300:30)||typeof settings?.[kind]?.rewrite!=='boolean')
        throw new Error('请先确认音频参数和提示词，未提交');
      const action={...copy(op.operation),seconds:Math.round(seconds*10)/10,count:1};
      if(typeof studio.previewAssistantAudioParameters!=='function')throw new Error('音频生成参数不可预览，未提交');
      const expectedParameters=studio.previewAssistantAudioParameters(action);
      const snapshot=media.capture(),snapshotText=JSON.stringify(snapshot),contextFingerprint=await fingerprint(snapshot);
      if(signal?.aborted||operation!==serial||sessionCurrent()!==true||JSON.stringify(media.capture())!==snapshotText)throw new Error('音频工作区已变化，未提交');
      const planId=root.crypto?.randomUUID?.();if(typeof planId!=='string')throw new Error('音频操作不可确认，未提交');
      const plan={planId,contextFingerprint,operations:[action]};
      if(typeof studio.stageAssistantAudioReview!=='function'||studio.stageAssistantAudioReview({plan,snapshot,fingerprint,signal,selectionStillCurrent:sessionCurrent,sessionCurrent,selection,expectedParameters})!==true)
        throw new Error('音频确认状态不可绑定，未提交');
      return new Promise((resolve,reject)=>{
        const preview={media,studio,action,snapshot,snapshotText,contextFingerprint,planId,signal,operation,sessionCurrent,selection,resolve,reject,timer:null,abort:null,running:false};
        preview.abort=()=>settleFoartAudio(preview,{error:new Error('音频操作已停止，请核对任务状态')});
        foartAudioPreview=preview;state.foartAudioProposal={kind,prompt:action.prompt,seconds:action.seconds,modelId:selection.modelId,
          effectivePrompt:expectedParameters.parameters.prompt,bpm:expectedParameters.parameters.bpm,loop:expectedParameters.parameters.loop,rewritePolicy:expectedParameters.rewritePolicy};
        state.error='';state.status='请确认音频任务；确认前不会生成';
        signal?.addEventListener?.('abort',preview.abort,{once:true});
        preview.timer=timers.setTimeout(()=>settleFoartAudio(preview,{error:new Error('音频确认已过期，未提交')}),300000);
        if(signal?.aborted||operation!==serial)preview.abort();else notify();
      });
    }
    function confirmFoartAudio(event) {
      const preview=foartAudioPreview,owner=event?.view,button=event?.currentTarget,attr='data-novaflow-audio-action-confirm';
      let trusted=false;try{const getter=Object.getOwnPropertyDescriptor(new owner.MouseEvent('click'),'isTrusted')?.get;trusted=typeof getter==='function'&&getter.call(event)===true;}catch{}
      if(!preview||preview.running||preview.signal?.aborted||preview.operation!==serial||!owner||owner!==root||owner.document!==root.document||
        typeof owner.MouseEvent!=='function'||!(event instanceof owner.MouseEvent)||event.type!=='click'||!trusted||!button?.isConnected||
        button.ownerDocument!==owner.document||!button.contains(event.target)||button.getAttribute?.(attr)!=='1'||
        owner.document?.querySelectorAll?.('['+attr+'="1"]').length!==1||owner.navigator?.userActivation?.isActive!==true)return false;
      if(preview.sessionCurrent()!==true||preview.studio!==root.NovaFlowAudioStudio||preview.media!==root.NovaFlowMediaAgent||
        preview.studio.isOpen?.()!==true||preview.studio.sub?.()!=='audio'||JSON.stringify(preview.media.capture())!==preview.snapshotText){
        settleFoartAudio(preview,{error:new Error('账号、模型或音频工作区已变化，未提交')});return false;
      }
      let execution;
      try{execution=preview.studio.executeAssistantAudioReview(event,preview.planId);}
      catch(error){settleFoartAudio(preview,{error});return false;}
      preview.running=true;state.foartAudioProposal=null;if(preview.timer!=null)timers.clearTimeout(preview.timer);preview.timer=null;
      state.status='正在提交已确认的音频任务';notify();
      Promise.resolve(execution).then(result=>{
        if(result?.ok!==true||!Array.isArray(result.results)||result.results.length!==1)throw new Error('音频任务状态待核对');
        settleFoartAudio(preview,{receipt:{action:'media',phase:'completed',results:result.results}});
      }).catch(error=>settleFoartAudio(preview,{error}));
      return true;
    }
    function cancelFoartAudio(){const preview=foartAudioPreview;if(!preview||preview.running)return false;return settleFoartAudio(preview,{error:new Error('已取消音频任务，未提交')});}
    state.foartAudioRecoveries=[];
    async function refreshFoartAudioRecoveries(){
      const studio=root.NovaFlowAudioStudio,owner=api()?.captureFoartBillingOwner?.();
      if(!studio||typeof studio.pendingAssistantAudioTasks!=='function'||typeof studio.checkAssistantAudioTask!=='function'||!owner?.current?.())return;
      const rows=studio.pendingAssistantAudioTasks().slice(0,8),results=[];
      for(const row of rows){
        if(!owner.current()||studio!==root.NovaFlowAudioStudio)return;
        try{const task=await studio.checkAssistantAudioTask(row.taskId);results.push({...row,status:String(task.status||'unknown'),creditSettled:task.credit_settled===true});}
        catch{results.push({...row,status:'unknown'});}
      }
      if(owner.current()&&studio===root.NovaFlowAudioStudio){state.foartAudioRecoveries=results;notify();}
    }
    async function acknowledgeFoartAudioRecovery(taskId){
      const studio=root.NovaFlowAudioStudio;
      try{if(await studio?.acknowledgeAssistantAudioTask?.(taskId)!==true)return false;await refreshFoartAudioRecoveries();return true;}
      catch{state.error='音频任务状态待核对，未清除记录';notify();return false;}
    }
    let foartRotationPreview=null,foartRotationUndo=null;
    state.foartRotationProposal=null;state.foartRotationCanUndo=false;
    function settleFoartRotation(preview,{receipt,error}={}) {
      if(!preview||foartRotationPreview!==preview)return false;
      foartRotationPreview=null;state.foartRotationProposal=null;
      if(preview.timer!=null)timers.clearTimeout(preview.timer);
      preview.signal?.removeEventListener?.('abort',preview.abort);
      if(error){try{preview.editor.agentDiscardSingleBoneRotation?.(preview.token);}catch{}preview.reject(error);}
      else preview.resolve(receipt);
      notify();return true;
    }
    function prepareFoartRotation(op,baseline,signal,operation,sessionCurrent,localBinding=null,verifyCurrent=null) {
      if(foartRotationPreview)throw new Error('已有旋转预览等待确认');
      if(typeof sessionCurrent!=='function'||sessionCurrent()!==true)throw new Error('登录会话或模型已变化，未修改作品');
      const editor=root.NovaFlowSkeletonEditor?.active?.()&&root.NovaFlowSkeletonEditor.api?.();
      if(!editor||typeof editor.agentPrepareSingleBoneRotation!=='function'||typeof editor.agentCommitSingleBoneRotation!=='function')throw new Error('单骨骼旋转预览尚未就绪，未修改作品');
      const prepared=editor.agentPrepareSingleBoneRotation(op,baseline);
      if(!prepared||typeof prepared.token!=='string'||!Number.isFinite(prepared.expiresAt)||prepared.expiresAt<=Date.now()||
        typeof prepared.animation!=='string'||typeof prepared.boneName!=='string'||!Number.isInteger(prepared.frame)||
        !Number.isFinite(prepared.fromRotation)||!Number.isFinite(prepared.toRotation)){
        if(typeof prepared?.token==='string')try{editor.agentDiscardSingleBoneRotation?.(prepared.token);}catch{}
        throw new Error('旋转预览无效，未修改作品');
      }
      if(foartRotationUndo){try{foartRotationUndo.editor.agentDiscardSingleBoneRotationUndo?.(foartRotationUndo.token);}catch{}foartRotationUndo=null;state.foartRotationCanUndo=false;}
      return new Promise((resolve,reject)=>{
        const preview={editor,token:prepared.token,expiresAt:prepared.expiresAt,animation:prepared.animation,boneName:prepared.boneName,
          frame:prepared.frame,fromRotation:prepared.fromRotation,toRotation:prepared.toRotation,signal,operation,sessionCurrent,localBinding,resolve,reject,timer:null,abort:null,
          verifyCurrent,verifiedUntil:0,verifying:false};
        preview.abort=()=>settleFoartRotation(preview,{error:new Error('旋转预览已停止，未修改作品')});
        foartRotationPreview=preview;state.foartRotationProposal={animation:preview.animation,boneName:preview.boneName,frame:preview.frame,
          fromRotation:preview.fromRotation,toRotation:preview.toRotation,warning:String(prepared.warning||'')};
        state.error='';state.status='请核对旋转变化；确认前不会修改作品';
        signal?.addEventListener?.('abort',preview.abort,{once:true});
        preview.timer=timers.setTimeout(()=>settleFoartRotation(preview,{error:new Error('旋转预览已过期，未修改作品')}),Math.max(1,prepared.expiresAt-Date.now()));
        if(signal?.aborted||operation!==serial)preview.abort();else notify();
      });
    }
    function confirmFoartRotation(event) {
      const preview=foartRotationPreview;if(!preview||preview.operation!==serial||preview.signal?.aborted)return false;
      // A trusted click cannot be held across an asynchronous fetch: the DOM
      // clears currentTarget and user activation may expire. Revalidate first,
      // then require a fresh real click instead of synthesizing an event.
      if(preview.verifyCurrent && Date.now()>preview.verifiedUntil){
        if(!preview.verifying){
          preview.verifying=true;state.error='';state.status='正在核对当前会话与任务，请稍后再次确认';notify();
          Promise.resolve().then(()=>preview.verifyCurrent()).then(valid=>{
            if(foartRotationPreview!==preview)return;
            preview.verifying=false;
            if(valid!==true || preview.sessionCurrent()!==true || preview.signal?.aborted || preview.operation!==serial){
              settleFoartRotation(preview,{error:new Error('登录会话或任务已失效，未修改作品')});return;
            }
            preview.verifiedUntil=Date.now()+2000;state.error='';state.status='会话核验通过，请再次点击确认';notify();
          }).catch(()=>{if(foartRotationPreview===preview)settleFoartRotation(preview,{error:new Error('无法核对当前会话，未修改作品')});});
        }
        return false;
      }
      try {
        if(preview.sessionCurrent()!==true)throw new Error('登录会话或模型已变化，未修改作品');
        if(!root.NovaFlowSkeletonEditor?.active?.()||root.NovaFlowSkeletonEditor.api?.()!==preview.editor)throw new Error('动画编辑器已变化，未修改作品');
        const result=preview.editor.agentCommitSingleBoneRotation(preview.token,event);
        if(!result||result.phase!=='applied'||result.operation!=='key_bones'||typeof result.undoToken!=='string'||
          result.animation!==preview.animation||result.boneName!==preview.boneName||result.frame!==preview.frame)throw new Error('旋转操作未返回可核对的回执');
        foartRotationUndo={editor:preview.editor,token:result.undoToken,animation:preview.animation,boneName:preview.boneName,frame:preview.frame,localBinding:preview.localBinding};state.foartRotationCanUndo=true;
        return settleFoartRotation(preview,{receipt:{action:'animation',operation:'key_bones',phase:'applied',message:`已修改骨骼 ${preview.boneName} 第 ${preview.frame} 帧的旋转；可撤销本次修改。`}});
      } catch(error) {state.error=String(error?.message||error);notify();if(error?.code!=='single-rotation-trusted-click-required')settleFoartRotation(preview,{error});return false;}
    }
    function cancelFoartRotation(event) {
      const preview=foartRotationPreview;if(!preview)return false;
      try {const result=preview.editor.agentCancelSingleBoneRotation(preview.token,event);if(result?.phase!=='cancelled')throw new Error('旋转预览未取消');
        return settleFoartRotation(preview,{error:new Error('已取消旋转预览，未修改作品')});
      } catch(error) {state.error=String(error?.message||error);notify();if(error?.code!=='single-rotation-trusted-click-required')settleFoartRotation(preview,{error});return false;}
    }
    function undoFoartRotation(event) {
      const undo=foartRotationUndo;if(!undo||state.pending||state.generating||state.applying)return false;
      const binding=undo.localBinding;
      let bindingCurrent=!binding;
      if(binding)try {bindingCurrent=state.provider==='local'&&state.modelId===binding.modelId&&businessModelEpoch===binding.epoch&&
        (!binding.sessionGuard || binding.sessionGuard()===true);} catch {bindingCurrent=false;}
      if(!bindingCurrent) {
        try{undo.editor.agentDiscardSingleBoneRotationUndo?.(undo.token);}catch{}
        foartRotationUndo=null;state.foartRotationCanUndo=false;state.error='模型或登录会话已变化，撤销已失效；未修改作品';notify();return false;
      }
      try {if(!root.NovaFlowSkeletonEditor?.active?.()||root.NovaFlowSkeletonEditor.api?.()!==undo.editor)throw new Error('动画编辑器已变化，不能撤销');
        const result=undo.editor.agentUndoSingleBoneRotation(undo.token,event);
        if(!result||result.phase!=='undone'||result.operation!=='key_bones'||result.animation!==undo.animation||result.boneName!==undo.boneName||result.frame!==undo.frame)throw new Error('未返回可核对的撤销回执');
        foartRotationUndo=null;state.foartRotationCanUndo=false;state.error='';state.status='已撤销本次骨骼旋转';notify();return true;
      } catch(error){if(error?.code!=='single-rotation-trusted-click-required'){foartRotationUndo=null;state.foartRotationCanUndo=false;}state.error=String(error?.message||error);notify();return false;}
    }
    const recapture = snapshot => snapshot.artContext.task === 'creation' ? bridge.captureCreation({includeResult:snapshot.images.some(i=>i.role==='result')}) : bridge.capture({includeResult:snapshot.images.length===3});
    const sessions = {local:{messages:[],history:[],conversationId:''}, api:{messages:[],history:[],conversationId:''}};
    const modelSessions = Object.create(null), transientSessions = Object.create(null);
    const cancelledPromptSourceModels = new Set();
    let legacyArchive=null;
    state.learningTask = null; state.learningWarning = '';
    async function learningCommand(command) {
      if (typeof api()?.artLearning !== 'function') throw new Error('请更新 Foart后使用任务反馈');
      const response = await api().artLearning(command);
      if (!response?.ok) throw new Error(response?.error || '任务反馈操作失败');
      return response.data;
    }
    async function recordReceipt(execution, result, proposal = state.proposal) {
      if (!state.learningTask || !proposal?.proposalId) return;
      try {await learningCommand({action:'receipt',taskId:state.learningTask.taskId,proposalId:proposal.proposalId,execution,
        ...(proposal.promptOptimization && execution==='applied' ? {executedPrompt:proposal.modelPrompt,displayPrompt:proposal.prompt,executedNegativePrompt:proposal.negativePrompt,promptFramework:proposal.promptOptimization.framework} : {}),
        ...(result ? {resultId:result.id,resultSHA256:await sha256(imageBytes(result.imageUrl))} : {})});}
      catch (error) {state.learningWarning = '本次结果未写入任务记录：' + String(error.message || error);}
    }
    async function recordFeedback(message, {feedback} = {}) {
      const current = bridge.currentResult?.();
      if (!current?.id || !current.imageUrl) {return false;}
      try {
        const digest = await sha256(imageBytes(current.imageUrl)), data = await learningCommand({action:'list'});
        const task = data.tasks.find(item => item.resultId === current.id && item.resultSHA256 === digest && item.execution === 'succeeded');
        if (!task) throw new Error('当前成图没有关联的小桃执行记录；不会把反馈记到其他图片');
        const receipt = await learningCommand({action:'feedback',taskId:task.id,resultId:current.id,message,feedback});
        return Boolean(receipt);
      } catch {return false;}
    }
    // Billing reconciliation survives reload; conversations never do.
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      state.billingNotices=cleanBillingNotices(saved?.billingNotices);
    } catch {}
    state.staged = []; state.pendingUploads = []; state.pendingUploadId = '';
    let stagedSeq = 0, carryAttachments = null, carryAsk = null, lastUploads = [], lastPreparedTask='', pendingIntent=null, pendingPromptSource=null;
    const uploadApi = () => root.NovaFlowXiaotaoUpload;
    const communityUploads = () => communityAttachmentMetadata(state.modelId,state.staged,lastUploads);
    // Read only the active surface's current prompt. A source-choice question
    // never submits a provider request or scans old chat/project contents.
    function activePromptSource() {
      try {
        const studio=root.NovaFlowAudioStudio,routeRevision=root.__NovaFlowArtGenerate?.captureContext?.()?.routeRevision;
        if(studio?.isOpen?.()===true && studio.sub?.()==='video') {
          const video=root.NovaFlowAiSequenceGeneration?.capture?.();
          return video?.mode==='minimax_h3_local'?{surface:'video',pagePrompt:String(video.prompt||''),routeRevision}:null;
        }
        if(studio?.isOpen?.()===true && studio.sub?.()==='audio') {
          const settings=studio.agentSettings?.(),kind=settings?.mode;
          return ['music','sfx'].includes(kind)?{surface:'audio',kind,pagePrompt:String(settings?.[kind]?.text||''),routeRevision}:null;
        }
        const rt=root.__NovaFlowArtGenerate;
        if(root.NovaFlowUiDesignDrawing?.isActive?.()===true){rt?.capturePrompt?.();return {surface:'ui',pagePrompt:String(rt?.state?.prompt||''),routeRevision};}
        const context=rt?.captureContext?.();
        if(context?.generationSurface==='drawing'&&context.state===rt?.state&&context.state.active===true){rt.capturePrompt?.();return {surface:'drawing',pagePrompt:String(rt.state.prompt||''),routeRevision};}
      } catch {}
      return null;
    }
    function sourceBindingCurrent(pending,info) {
      try {const selected=businessModelSnapshot();
        return !!info && info.surface===pending.info.surface && info.kind===pending.info.kind && info.pagePrompt===pending.info.pagePrompt && Number.isSafeInteger(info.routeRevision) && info.routeRevision===pending.info.routeRevision &&
          selected.provider===pending.selected.provider && selected.modelId===pending.selected.modelId && selected.epoch===pending.selected.epoch &&
          (!pending.workspaceGuard || pending.workspaceGuard()===true) && (!pending.attachmentStillCurrent || pending.attachmentStillCurrent()===true) && (!pending.sessionGuard || pending.sessionGuard()===true);
      } catch{return false;}
    }
    function capturePromptWorkspace(info) {
      if(!Number.isSafeInteger(info.routeRevision))throw Error('无法确认当前板块状态');
      let workspaceSnapshot=null,guard;
      if(info.surface==='audio') {workspaceSnapshot=root.NovaFlowAudioStudio?.captureTextReview?.(info.kind);guard=workspaceSnapshot;}
      else {const provider=info.surface==='video'?root.NovaFlowMediaAgent:info.surface==='ui'?root.NovaFlowUiDesignDrawing:root.__NovaFlowArtGenerate;
        guard=info.surface==='video'?provider?.captureH3PromptSourceGuard?.():provider?.capturePromptSourceGuard?.();}
      if(typeof guard?.isCurrent!=='function'||guard.isCurrent()!==true)throw Error('工作区尚未就绪');
      const selection=businessModelSnapshot(),session=selection.provider==='api'?api()?.captureFoartSessionGuard?.():null;
      if(selection.provider==='api'&&(typeof session!=='function'||session()!==true))throw Error('账号状态不可用');
      // Bind only this turn's staged objects. Never silently reuse lastUploads.
      const stagedItems=state.staged.slice(),fields=['id','name','status','kind','mimeType','size','previewUrl'];
      const saved=stagedItems.map(item=>Object.fromEntries(fields.map(key=>[key,item?.[key]])));
      const attachmentStillCurrent=()=>{try{return state.staged.length===stagedItems.length&&stagedItems.every((item,index)=>state.staged[index]===item&&fields.every(key=>item?.[key]===saved[index][key]));}catch{return false;}};
      return {workspaceSnapshot,stagedItems,attachmentStillCurrent,workspaceGuard:()=>{const now=businessModelSnapshot();return guard.isCurrent()===true&&now.provider===selection.provider&&now.modelId===selection.modelId&&now.epoch===selection.epoch&&(!session||session()===true);}};
    }
    function askPromptSource(message,info,resolution,recordMessage,workspace) {
      const helper=root.NovaFlowXiaotaoPromptSource,sessionGuard=state.provider==='api'?api()?.captureFoartSessionGuard?.():null;
      if(state.provider==='api'&&(typeof sessionGuard!=='function'||sessionGuard()!==true)){state.error='无法确认当前账号，未提交或扣费。';notify();return false;}
      pendingPromptSource={info:{...info},message,conversationPrompt:helper.extractTurnPrompt(message),reason:resolution.reason,selected:businessModelSnapshot(),sessionGuard,...workspace};
      if(recordMessage)pushUser(message);
      const text=resolution.reason==='different-prompts'||resolution.reason==='ambiguous-explicit-source'
        ?'页面与本条消息的提示词不同，请回复“页面”或“对话”，选择要优化的内容。'
        :resolution.reason==='page-prompt-empty'?'当前页面没有提示词，请先填写页面内容，或直接发送要优化的完整提示词。'
        :resolution.reason==='conversation-prompt-empty'?'本条消息没有完整提示词，请直接发送要优化的内容。':'页面和本条消息都没有完整提示词，请发送要优化的内容。';
      state.messages.push({role:'assistant',content:text});state.error='';state.status='等待选择提示词来源；未提交，不扣积分';notify();return false;
    }
    function preparePromptSource(message,{recordMessage=true}={}) {
      const helper=root.NovaFlowXiaotaoPromptSource,info=activePromptSource();
      if(pendingPromptSource){
        const pending=pendingPromptSource;
        if(!sourceBindingCurrent(pending,info)){pendingPromptSource=null;state.error='页面、账号或模型已变化，请重新提出优化请求；未提交或扣费。';state.status='未提交';notify();return {stop:true};}
        const answer=String(message||'').trim();
        if(/^(?:取消|算了|不用了)[。.!！]?$/u.test(answer)){pendingPromptSource=null;if(recordMessage)pushUser(answer);state.status='已取消；未提交，不扣积分';notify();return {stop:true};}
        const page=/^(?:(?:就|请|我)?(?:用|选|选择|按照))?(?:当前)?(?:页面|下面|下方|输入框)(?:的)?(?:提示词|内容)?[。.!！]?$/u.test(answer);
        const chat=/^(?:(?:就|请|我)?(?:用|选|选择|按照))?(?:本条)?(?:对话|聊天|我发的|我写的)(?:提示词|内容)?[。.!！]?$/u.test(answer);
        let source;
        if(page&&pending.info.pagePrompt.trim())source={status:'ready',source:'page',prompt:pending.info.pagePrompt.trim(),requirements:''};
        else if(chat&&pending.conversationPrompt)source={status:'ready',source:'conversation',prompt:pending.conversationPrompt,requirements:''};
        else if(!page&&!chat&&!pending.conversationPrompt)source=helper?.resolvePromptSource?.({pagePrompt:'',conversationPrompt:answer,instruction:pending.message});
        if(!source||source.status!=='ready'){state.error='请明确回复“页面”或“对话”，也可以发送完整提示词；未提交或扣费。';notify();return {stop:true};}
        source={...source,workspaceSnapshot:pending.workspaceSnapshot,workspaceGuard:pending.workspaceGuard,stagedItems:pending.stagedItems,attachmentStillCurrent:pending.attachmentStillCurrent};
        pendingPromptSource=null;if(recordMessage)pushUser(answer);return {info,source,message:pending.message,recordMessage:false};
      }
      if(!info)return null;
      if(!helper?.classifyPromptAction||!helper?.resolvePromptSource){
        if(/优化|润色|改写|整理|完善/.test(message)){state.error='提示词来源组件尚未就绪，未提交或扣费。';notify();return {stop:true};}return null;
      }
      const action=helper.classifyPromptAction(message);if(action==='none')return null;
      if(action==='compound'){state.error='请先单独优化提示词，再提出生成或其他操作；本次未提交或扣费。';state.status='未提交';notify();return {stop:true};}
      let workspace;try{workspace=capturePromptWorkspace(info);}catch{state.error='无法确认当前工作区，请稍后重试；未提交或扣费。';state.status='未提交';notify();return {stop:true};}
      const source=helper.resolvePromptSource({pagePrompt:info.pagePrompt,instruction:message});
      if(source.status!=='ready'){askPromptSource(message,info,source,recordMessage,workspace);return {stop:true};}
      return {info,source:{...source,...workspace},message,recordMessage};
    }
    function recoverActiveTask() {
      if(state.activeTask || state.historyOriginUnknown)return;
      const resources=root.NovaFlowAiSequenceGeneration?.resources?.() || [];
      for(let i=state.messages.length-1;i>=0;i--){
        const entry=state.messages[i];if(entry.role!=='assistant' || !entry.content.startsWith('生成完成：'))continue;
        const resource=resources.find(r=>r.name && entry.content.includes(r.name));if(!resource)continue;
        const requests=state.messages.slice(0,i).filter(m=>m.role==='user');
        const original=requests.findLast(m=>uploadApi()?.inferTask?.(m.content,[])?.surface==='video');if(!original)continue;
        const inferred=uploadApi().inferTask(original.content,[]);
        const task=root.NovaFlowWebRuntime?.tasks?.get?.(resource.promptId || resource.id?.split(':')[0]);
        const actual=({fl2v:'first_last',i2v:'image_video',r2v:'multi_reference',t2v:'text_video'})[task?.parameters?.mode];
        state.activeTask={...inferred,baseRequest:original.content,revisions:requests.slice(requests.indexOf(original)+1).map(m=>m.content).slice(-8),
          ...(actual?{mode:actual}:{}),status:'completed',outputs:[{id:resource.id,name:resource.name,promptId:resource.promptId}]};return;
      }
    }
    let cachedHost = null;
    const host = () => uploadHost || (cachedHost ||= uploadApi()?.createUploadHost?.(root));
    function pushUser(content) {
      const entry = {role:'user', content};
      if (carryAttachments?.length) {entry.attachments = carryAttachments; carryAttachments = null;}
      state.messages.push(entry);
      if (carryAsk) {state.messages.push(carryAsk); carryAsk = null;}
    }
    function note(content, failed = false) {if (content) state.messages.push({role:'status', content:String(content), ...(failed ? {level:'error'} : {})}); }
    async function readPreview(file) {
      if (typeof file?.arrayBuffer !== 'function') return '';
      if(typeof root.FileReader==='function')return new Promise((resolve,reject)=>{
        const reader=new root.FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('文件读取失败'));reader.readAsDataURL(file);
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks=[];for(let offset=0;offset<bytes.length;offset+=8192)chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+8192)));
      return `data:${file.type || 'application/octet-stream'};base64,${root.btoa(chunks.join(''))}`;
    }
    async function stageUploads(files) {
      if (retired) return false;
      if (CHAT_MODELS[state.modelId]?.retired) return false;
      if (state.pending || state.generating || state.applying || state.uploading || state.staging) return false;
      const uploads = uploadApi(); if (!uploads) {state.error = '上传模块未加载'; notify(); return false;}
      state.staging=true;notify();
      try {
      for (const file of Array.from(files || [])) {
        const id = 'up-' + (++stagedSeq);
        const item = {id, name:String(file?.name || '未命名文件'), status:'reading', file, kind:'', mimeType:'', previewUrl:'', size:Number(file?.size) || 0};
        state.staged.push(item); notify();
        const verdict = uploads.inspectUpload(file);
        if (!verdict.ok) {state.staged = state.staged.filter(entry => entry !== item); note(verdict.message,true); notify(); continue;}
        item.kind = verdict.kind; item.mimeType = verdict.mimeType; item.ext = verdict.ext;
        if (verdict.kind === 'image') {try {item.previewUrl = await readPreview(file); referencePreviews.set(file, item.previewUrl); await readImageDimensions(file,item.previewUrl); Object.assign(item,imageDimensions(item));} catch {state.staged = state.staged.filter(entry => entry !== item); note(`${item.name} 读取失败`,true); notify(); continue;}}
        else if (typeof root.URL?.createObjectURL === 'function') {try {item.previewUrl = root.URL.createObjectURL(file);} catch {}}
        if(retired){releasePreview(item);return false;}
        item.status = 'ready'; notify();
      }
      return true;
      } finally {state.staging=false;notify();}
    }
    function releasePreview(item) {
      const url = item?.previewUrl;
      if (url && String(url).startsWith('blob:') && typeof root.URL?.revokeObjectURL === 'function') {
        try { root.URL.revokeObjectURL(url); } catch {}
        item.previewUrl = '';
      }
    }
    function releasePreviews(items) { for (const item of items || []) releasePreview(item); }
    function removeStaged(id) {
      const gone = state.staged.filter(item => item.id === id);
      releasePreviews(gone);
      state.staged = state.staged.filter(item => item.id !== id); notify(); return true;
    }
    async function consumeStaged(message) {
      if (retired) return false;
      if (state.staged.some(item => item.status === 'reading')) {state.error = '文件还在读取，请稍后再发送'; notify(); return false;}
      const ready = state.staged.filter(item => item.status === 'ready');
      if (!ready.length) return true;
      state.uploading=true;state.error='';state.status='正在根据需求准备素材…';notify();
      try {
      lastUploads = ready.map(item => ({kind:item.kind, name:item.name, file:item.file, mimeType:item.mimeType, ...imageDimensions(item), ...(item.kind === 'image' && item.previewUrl ? {dataUrl:item.previewUrl} : {})}));
      const uploads = uploadApi(); if (!uploads) {state.error = '上传模块未加载'; notify(); return false;}
      const taskText=uploads.positiveTaskText?.(message)??message;
      const nativeArtRequest=/抠图|拆图|钢笔|放大|扩图|画布|去背|姿势参考|智能补图|局部编辑|蒙版|对象替换/.test(taskText)&&!/视频|音视|音频|音效|音乐/.test(taskText);
      const productionRequest=communityModel(state.modelId)||nativeArtRequest||/压缩|去黑|图集|查看器|特效|粒子|模板|(?:转换|转为|转成).{0,8}(?:MP4|GIF|WEBM|MOV|AVI|MKV|格式)/i.test(taskText)||ready.some(item=>item.kind==='tool')||['tools','effects','particle','animation'].includes(state.activeTask?.surface);
      const plan = productionRequest?{place:[],reject:[]}:uploads.planRoutes(message, ready,state.activeTask);
      const notes = []; let failed = plan.reject.length > 0;
      for (const item of plan.place) {
        if(retired)return false;
        try {const receipt = await host().place(item); notes.push(`已放入${item.destination.label}：${item.name}`); item.receipt = receipt;}
        catch (error) {failed = true; notes.push(String(error?.message || error));}
        if(retired)return false;
      }
      if(retired)return false;
      for (const item of plan.reject) notes.push(item.message);
      carryAttachments = ready.map(item => ({name:item.name, kind:item.kind, dataUrl:item.kind === 'image' ? item.previewUrl : '', mimeType:item.mimeType}));
      if (failed) {state.error=notes.join('\n');notify();return false;}
      releasePreviews(ready.filter(item => item.kind !== 'image'));
      state.pendingUploads=[];state.pendingUploadId='';
      if (notes.length) carryAsk = {role:'status', content:notes.join('\n')};
      state.staged = state.staged.filter(item => !ready.includes(item));
      const task=uploads.inferTask?.(message,ready,state.activeTask);lastPreparedTask=task?task.surface+':'+task.mode:'';
      return true;
      } finally {state.uploading=false;notify();}
    }
    async function chooseUploadDestination(destinationId, pendingId) {
      if(state.uploading || state.staging || state.pending || state.generating)return false;
      const uploads = uploadApi();
      const destination = uploads?.destinationById?.(destinationId);
      if (!destination || !state.pendingUploads.length || pendingId !== state.pendingUploadId) return false;
      const batch = state.pendingUploads.filter(item => item.pendingId === pendingId);
      const notes = []; const done = []; let failed = false;
      state.uploading=true;notify();
      try {
      for (const item of batch) {
        if (!uploads.acceptsKind(destination, item.kind)) {failed = true; notes.push(`${item.name} 不能放到${destination.label}`); continue;}
        try {await host().place({...item, destination}); done.push(item); notes.push(`已放入${destination.label}：${item.name}`);}
        catch (error) {failed = true; notes.push(String(error?.message || error));}
      }
      releasePreviews(done);
      state.pendingUploads = state.pendingUploads.filter(item => !done.includes(item));
      if (!state.pendingUploads.length) state.pendingUploadId = '';
      note(notes.join('\n') || '没有放入文件',failed || !done.length); return done.length > 0;
      } finally {state.uploading=false;notify();}
    }
    function notify() {
      if (retired) return;
      sessions[state.provider] = {messages:state.messages.slice(-60),history:state.history,conversationId:state.conversationId};
      modelSessions[state.modelId]={messages:state.messages.slice(-60),history:state.history,conversationId:state.conversationId,activeTask:state.activeTask,historyOriginUnknown:state.historyOriginUnknown===true};
      try {storage?.setItem(STORAGE_KEY, JSON.stringify({billingNotices:cleanBillingNotices(state.billingNotices)}));} catch {}
      onChange(state);
    }
    // A boolean here proves only that the notice was durably stored, never
    // that an unknown or partially collected operation succeeded.
    function recordBusinessBillingNotice(notice,{selection,owner,sessionGuard}={}) {
      try {
        const id=notice?.requestId,modelId=notice?.modelId,quota=notice?.quota;
        const activeOwner=()=>{const current=api()?.captureFoartBillingOwner?.();return typeof owner?.owner==='string' &&
          /^[A-Za-z0-9_-]{1,128}$/.test(owner.owner) && typeof owner.current==='function' && owner.current()===true &&
          typeof sessionGuard==='function' && sessionGuard()===true && current?.owner===owner.owner &&
          typeof current.current==='function' && current.current()===true;};
        if(!activeOwner() || notice?.submitted!==true || typeof notice.unknown!=='boolean' || typeof id!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(id) ||
          selection?.provider!=='api' || selection.modelId!==modelId || !Number.isSafeInteger(selection.epoch) ||
          CHAT_MODELS[modelId]?.provider!=='api' || CHAT_MODELS[modelId]?.retired) return false;
        if(quota!==undefined && (quota?.status!=='settled' || creditUnits(quota.settled_credits)===null ||
          quota.uncollected_credits!==undefined && creditUnits(quota.uncollected_credits)===null)) return false;
        const unknown=notice.unknown===true || (quota?.uncollected_credits||0)>0;
        if(quota===undefined && !unknown)return false;
        const row={id,modelId,owner:owner.owner,confirmed:quota===undefined?null:quota.settled_credits,unknown};
        const old=state.billingNotices.find(item=>item.id===id);
        // Never evict an existing notice merely to acknowledge another receipt.
        if(!old && state.billingNotices.filter(item=>item.unknown).length>=20)return false;
        if(old && (old.owner!==row.owner || old.modelId!==row.modelId ||
          old.confirmed!==null && old.confirmed!==row.confirmed || !old.unknown && row.unknown))return false;
        state.billingNotices=appendBillingNotice(state.billingNotices,row);notify();
        if(!activeOwner())return false;
        const raw=typeof storage?.getDurableItem==='function' ? storage.getDurableItem(STORAGE_KEY) :
          storage===root.localStorage && typeof storage?.getItem==='function' ? storage.getItem(STORAGE_KEY) : null;
        const saved=JSON.parse(raw||'null')?.billingNotices;
        return activeOwner() && Array.isArray(saved) && saved.some(item=>item.id===id && item.owner===row.owner &&
          item.modelId===modelId && item.confirmed===row.confirmed && item.unknown===row.unknown);
      } catch {return false;}
    }
    function visibleBillingNotices() {
      let currentOwner='';try {const binding=api()?.captureFoartBillingOwner?.();if(binding?.current?.()===true)currentOwner=binding.owner;}catch {}
      return state.billingNotices.filter(row=>row.owner===undefined || row.owner===currentOwner);
    }
    function dismissBillingNotice(id) {state.billingNotices=state.billingNotices.filter(item=>item.id!==id);notify();}
    function artBillingNotices() {
      const binding=api()?.captureFoartBillingOwner?.();
      if(!binding || typeof binding.current!=='function' || binding.current()!==true)return [];
      return storage?.listArtBilling?.(binding.owner) || [];
    }
    function operationRecoveryNotices() {
      const client=api(),binding=client?.captureFoartBillingOwner?.();
      if(!binding||typeof binding.current!=='function'||binding.current()!==true)return [];
      if(typeof client?.listCompanionOperationRecovery!=='function')return [];
      const rows=client.listCompanionOperationRecovery();if(!Array.isArray(rows))return null;
      return rows.map(row=>({...row,recovery:operationRecoveryStates.get(binding.owner+':'+row.operationId)||null}));
    }
    async function checkOperationRecovery(operationId,dismiss=false) {
      const client=api(),binding=client?.captureFoartBillingOwner?.();
      if(!binding||typeof binding.current!=='function'||binding.current()!==true)return false;
      const rows=client?.listCompanionOperationRecovery?.();if(!Array.isArray(rows)||!rows.some(row=>row.operationId===operationId))return false;
      const fn=dismiss?client?.dismissCompanionOperationRecovery:client?.checkCompanionOperationRecovery;
      if(typeof fn!=='function')return false;
      let response;try{response=await fn(operationId);}catch{response={ok:false};}
      if(!binding.current())return false;
      const key=binding.owner+':'+operationId;
      if(dismiss&&response?.ok===true){operationRecoveryStates.delete(key);notify();return true;}
      operationRecoveryStates.set(key,response?.ok===true?response.operation:{status:'unavailable'});notify();return response?.ok===true;
    }
    function dismissArtBillingNotice(id) {
      const binding=api()?.captureFoartBillingOwner?.();
      if(!binding || typeof binding.current!=='function' || binding.current()!==true)return false;
      const rows=storage?.listArtBilling?.(binding.owner),row=Array.isArray(rows)?rows.find(item=>item.id===id):null;
      if(!row)return false;
      if(row.unknown && (typeof root.confirm!=='function'||root.confirm('这笔账单仍待核对。确认已经核对并关闭提示？')!==true))return false;
      if(binding.current()!==true||storage?.dismissArtBilling?.(binding.owner,id)!==true)return false;
      notify();return true;
    }
    function onlineBusinessUi(modelId,imageUploadGrant=null,selectionStillCurrent=()=>true) {
      const binding=api()?.captureFoartBillingOwner?.();
      const decimal=onlineOperationDecimalConfirmed();
      const operationBound=currentPricingPolicy()?.config?.xiaotao_online?.operation_art_v3===true;
      const acceptedCredits=value=>decimal ? creditUnits(value)!==null : Number.isSafeInteger(value)&&value>=0;
      const current=()=>!retired&&!!binding&&typeof binding.current==='function'&&binding.current()===true&&state.provider==='api'&&state.modelId===modelId&&selectionStillCurrent()===true;
      return {
        confirmImageUpload:async info=>{
          if(!current())return false;
          const accepted=typeof imageUploadGrant==='function'?await imageUploadGrant(info):typeof root.confirm==='function'&&root.confirm(`将上传所选 ${info.count} 张参考图片用于本次分析。确认继续？`)===true;
          return current()&&accepted===true;
        },
        onPricingQuote:()=>{if(current()){state.status='正在准备请求…';notify();}},
        confirmPricingQuote:async()=>current(),
        onBillingNotice:row=>{
          if(!binding?.current?.()||row?.submitted!==true||row.modelId!==modelId||typeof row.requestId!=='string')return false;
          const settled=row.quota?.status==='settled'&&acceptedCredits(row.quota.settled_credits);
          if(operationBound&&settled){publishBilling({id:row.requestId,modelId,owner:binding.owner,confirmed:row.quota.settled_credits,confirmedCount:1,unknown:row.unknown===true||(row.quota.uncollected_credits||0)>0,inFlight:false});return true;}
          if(!current())return false;
          const ok=settled?storage?.persistArtSettlement?.(binding.owner,{id:row.requestId,modelId,confirmed:row.quota.settled_credits,pricingSource:row.quota.pricing_source,cacheKnown:row.quota.cache_known})
            :storage?.persistArtPending?.(binding.owner,{id:row.requestId,modelId});
          if(ok!==true){state.error=settled?'账单回执未能安全保存，请核对实际扣分。':'无法安全保存待核对账单，未提交。';notify();return false;}
          notify();return true;
        }
      };
    }
    function publishBilling(billing) {
      if(!billing)return;
      // Operation-level requests have a durable account-bound record in the
      // runtime. Do not write their interim state into the unscoped tab archive.
      if(billing.recoveryBound&&(billing.unknown||billing.inFlight||!billing.confirmedCount)){notify();return;}
      const row={id:billing.id,modelId:billing.modelId,confirmed:billing.confirmedCount?billing.confirmed:null,unknown:billing.unknown||billing.inFlight,...(billing.owner?{owner:billing.owner}:{})};
      state.billingNotices=appendBillingNotice(state.billingNotices,row);notify();
    }
    function billingOwner() {
      try {const b=api()?.captureFoartBillingOwner?.();return b?.current?.()===true && typeof b.owner==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(b.owner) ? b.owner : undefined;} catch {return undefined;}
    }
    function collectBilling(billing,response) {
      if(!billing)return;
      if(response?.providerSubmitted===false){
        billing.inFlight=false;
        if(!billing.unknown&&!billing.confirmedCount){clearBillingNotice(billing);notify();}
        else publishBilling(billing);
        return;
      }
      billing.inFlight=false;const quota=response?.ok===true||response?.billingConfirmed===true?response?.data?.quota:null,amount=quota?.settled_credits;
      const total=(billing.decimal || Number.isSafeInteger(amount)) ? sumCredits(billing.confirmed,amount) : null;
      if(quota?.status!=='settled'||total===null)billing.unknown=true;
      else {billing.confirmed=total;billing.confirmedCount++;const quoted=(billing.decimal || Number.isSafeInteger(quota.quote_estimated_credits)) ? sumCredits(billing.quoted,quota.quote_estimated_credits) : null;if(quoted!==null)billing.quoted=quoted;else billing.allQuoted=false;}
      publishBilling(billing);
    }
    function billingReceipt(billing) {
      return billing&&!billing.unknown&&billing.confirmedCount?{status:'settled',settled_credits:billing.confirmed,billing_mode:'token',...(billing.allQuoted?{quote_estimated_credits:billing.quoted,quote_estimate_label:billing.confirmedCount>1?'各轮预留估算合计':'提交时估算预留'}:{})}:null;
    }
    function clearBillingNotice(billing) {if(billing)state.billingNotices=state.billingNotices.filter(item=>item.id!==billing.id);}
    function stopStatusPolling() {if (statusTimer !== null) {timers.clearTimeout(statusTimer); statusTimer = null;}}
    const samplingUnchanged = sampling => !!sampling && sameSnapshot(sampling.binding,bridge.readSampling().binding);
    function askSampling(message, includeResult, kind = 'send') {
      const sampling = bridge.readSampling();
      state.confirmation = {message,includeResult,kind,sampling}; state.error = ''; state.operation = null; state.toolTrace = [];
      state.status = '请确认本次生图参数，确认后才开始分析和生成';
      state.messages.push({role:'status',content:`已收到做图请求。当前是 ${samplingLabel(sampling)}。${sampling.styleTransfer ? '当前双图风格迁移使用 CFG3；“按当前参数”会保留当前版本和步数，并明确设为 CFG3。' : ''}请选择本次参数；确认前不会加载分析模型或提交生图。`}); notify(); return true;
    }
    async function confirmSampling(choice) {
      if (CHAT_MODELS[state.modelId]?.retired) return false;
      if (!state.confirmation || state.pending || state.applying || state.generating) return false;
      if (communityModel(state.modelId)) {state.error='社区模型当前仅支持只读，尚不能应用或生成；未修改作品';notify();return false;}
      const confirmation = state.confirmation;
      try {
        if (!samplingUnchanged(confirmation.sampling)) {state.samplingApproval = null; state.confirmation = null; return askSampling(confirmation.message,confirmation.includeResult,confirmation.kind);}
        const sampling = bridge.setSampling(choice), changed = !sameSnapshot(confirmation.sampling.binding,sampling.binding);
        state.confirmation = null; state.samplingApproval = sampling;
        state.messages.push({role:'user',content:choice === 'current' ? '按当前参数' : choice === 'turbo' ? 'Turbo：8 步、CFG3' : '普通：25 步、CFG3'});
        state.messages.push({role:'status',content:`本次已确认：${samplingLabel(sampling)}。将分析一次并生成一张。`}); notify();
        if (confirmation.kind === 'apply' && !changed) return apply({generate:true});
        return send(confirmation.kind === 'apply' ? lastRequestMessage || confirmation.message : confirmation.message,{includeResult:confirmation.includeResult,confirmed:true,recordMessage:false});
      } catch (error) {state.error = String(error?.message || error); state.status = '参数尚未确认，未开始分析或生成'; notify(); return false;}
    }
    function cancelConfirmation() {state.confirmation = null; state.samplingApproval = null; state.status = '已取消本次做图，未开始分析或生成'; notify(); return true;}
    function updateLocalSession(session, pending = false) {
      if (state.modelId !== 'next') return;
      if (!session || !['cold','loading','answering','warm','releasing','fault'].includes(session.state)) return;
      state.localSession = copy(session);
      if (pending) {
        const label = {cold:'正在准备本地模型…',loading:'加载本地模型… 首次启动的等待主要来自模型载入',answering:state.mode === 'chat' ? '小桃正在回答…' : '小桃正在分析当前绘图…',warm:'本地模型已就绪，正在等待回答…',releasing:'正在释放本地模型资源…',fault:'本地模型状态异常，等待任务返回具体信息'}[session.state];
        if (state.status !== label) {state.status = label; onChange(state);}
      }
    }
    function updateSelectedLocalStatus(data) {
      if (state.modelId === 'next') {state.localModelStatus=null; updateLocalSession(data?.chatSession); return;}
      const selected=Array.isArray(data?.localModels) ? data.localModels.find(item=>item?.id===state.modelId) : null;
      state.localSession=null;
      state.localModelStatus=selected && typeof selected.modelLoaded==='boolean' ? {id:selected.id,modelLoaded:selected.modelLoaded} : null;
      if(state.modelId==='qwen3.5-9b-heretic' && selected?.identityVerified===true && ['cpu','gpu'].includes(selected.executionDevice))
        state.qwenExecutionDevice=selected.executionDevice;
    }
    function startStatusPolling(operation, requestId) {
      stopStatusPolling();
      if (state.provider !== 'local' || typeof api()?.promptAssistantGetStatus !== 'function') return;
      const current = () => operation === serial && activeRequest === requestId && state.pending && state.provider === 'local' && !stopped;
      const poll = async () => {
        statusTimer = null; if (!current()) return;
        try {
          const response = await api().promptAssistantGetStatus({requestId});
          if (!current()) return;
          const data = response?.result || response?.data || response, session = data?.chatSession, progress = data?.operation;
          if (response?.ok !== false && data?.ok !== false) {
            if (state.modelId !== 'next') updateSelectedLocalStatus(data);
            if (progress?.requestId === requestId && ['connecting','queued','assigned','uploading','preparing','loading','analyzing','processing','releasing','completed'].includes(progress.phase)) {
              state.operation = copy(progress);
              const elapsed = Math.max(0,Math.floor((Date.now() - Math.min(activeStartedAt,Number(progress.startedAt)||activeStartedAt)) / 1000));
              const activity=progress.stage==='compile'?'编译模型执行提示词':progress.stage==='optimize'?'优化提示词':activeMode==='foart'?'规划工具操作':activeMode==='media'?'分析音视任务':activeMode==='chat'?(activeChatHasImages?'分析图片':'回答问题'):'分析当前绘图';
              const labels={connecting:'正在连接算力节点',queued:'正在排队等待算力节点',assigned:'已分配算力节点',uploading:'正在传输任务素材',preparing:'正在准备'+activity,loading:'正在加载本地模型',analyzing:'正在'+activity,processing:'算力节点处理中，详细阶段尚未回传',releasing:'正在释放模型资源，准备'+(activeMode==='foart'?'执行工具':activeMode==='media'?'音视操作':activeMode==='chat'?'回复':'生图'),completed:activeMode==='chat'?'本轮回复已完成':'本轮分析已完成'};
              state.status = `${labels[progress.phase]} · 本次已用 ${elapsed} 秒`; onChange(state);
            } else if (activeMode === 'chat' && (!session?.activeRequestId || session.activeRequestId === requestId)) updateLocalSession(session,true);
            else if (!progress && (!session?.activeRequestId || session.activeRequestId === requestId)) {
              state.operation = null; state.status = `请求处理中，正在获取算力节点状态 · 本次已用 ${Math.max(0,Math.floor((Date.now()-activeStartedAt)/1000))} 秒`; onChange(state);
            }
          }
        } catch {}
        if (current()) statusTimer = timers.setTimeout(poll, 1500);
      };
      void poll();
    }
    let localCapabilityEpoch = 0, localCapabilitySequence = 0;
    function clearQwenExecutionDevice() {localCapabilityEpoch++;localCapabilitySequence++;state.qwenExecutionDevice=null;onChange(state);}
    function rememberQwenExecutionDevice(response,epoch) {
      if(epoch!==localCapabilityEpoch || state.provider!=='local' || state.modelId!=='qwen3.5-9b-heretic')return;
      state.qwenExecutionDevice=verifiedQwenExecutionDevice(response);
    }
    function clearLocalCapability() {state.qwenExecutionDevice=null;state.qwen35CpuTrialAvailable=false;state.qwen35CpuTrialChecked=false;state.qwen35FoartReadonlyAvailable=false;state.qwen35FoartSeekAvailable=false;state.qwen35FoartRotationCandidateAvailable=false;state.qwen35FoartPlanAvailable=false;}
    function invalidateLocalCapability() {localCapabilityEpoch++;localCapabilitySequence++;clearLocalCapability();onChange(state);}
    async function calibrateLocalStatus() {
      if (state.provider !== 'local' || CHAT_MODELS[state.modelId]?.retired || state.pending || state.generating || state.applying) return;
      if (typeof api()?.promptAssistantGetStatus !== 'function') {invalidateLocalCapability();return;}
      const operation = serial, capabilityEpoch = localCapabilityEpoch, sequence=++localCapabilitySequence;
      const current=()=>operation===serial && capabilityEpoch===localCapabilityEpoch && sequence===localCapabilitySequence && state.provider==='local' && !state.pending && !state.generating && !state.applying;
      try {
        const response = await api().promptAssistantGetStatus();
        if (!current()) return;
        const data = response?.result || response?.data || response;
        if (response?.ok === false || data?.ok === false || typeof data?.features?.qwen35CpuTrial !== 'boolean') {clearLocalCapability();onChange(state);return;}
        state.qwen35CpuTrialAvailable=data?.features?.qwen35CpuTrial===true;
        state.qwen35CpuTrialChecked=true;
        state.qwen35FoartReadonlyAvailable=data?.features?.qwen35FoartReadonly===true;
        state.qwen35FoartSeekAvailable=data?.features?.qwen35FoartSeek===true;
        state.qwen35FoartRotationCandidateAvailable=QWEN_ROTATION_CANDIDATE_RELEASE_ENABLED && data?.features?.qwen35FoartRotationCandidate===true;
        state.qwen35FoartPlanAvailable=data?.features?.qwen35FoartPlan===true;
         updateSelectedLocalStatus(data); onChange(state);
      } catch {if(current()){clearLocalCapability();onChange(state);}}
    }
    function invalidate(message = '绘图内容已变化，原建议已失效') {if (state.proposal || state.applied) {bridge.clearPrepared(); state.proposal = null; state.proposalSnapshot = null; state.applied = false; state.status = message; notify();}}
    function refreshContext() {
      if (state.localSession?.state === 'warm' && Number.isFinite(state.localSession.idleExpiresAt) && state.localSession.idleExpiresAt <= Date.now()) {state.localSession = null; onChange(state);}
      if(activeMode==='media')return; // Media execution validates its own complete snapshot.
      if (state.applying) return;
      try {
        if (state.confirmation && !samplingUnchanged(state.confirmation.sampling)) {state.confirmation = null; state.samplingApproval = null; state.status = '绘图参数、参考图或负向已变化，请重新发送做图请求并确认参数'; notify();}
        if (state.samplingApproval && !samplingUnchanged(state.samplingApproval)) {state.samplingApproval = null;}
      } catch {state.confirmation = null; state.samplingApproval = null;}
      try {const old = state.proposalSnapshot || (activeMode !== 'chat' ? activeSnapshot : null); if (old && !sameSnapshot(old, recapture(old))) {invalidate(); if (state.pending && !stopped) void stop();}}
      catch {invalidate('页面已切换，原建议已失效'); if (state.pending && !stopped) void stop();}
    }
    function onlineEstimateInput(message, {includeResult:explicitIncludeResult=false}={}) {
      if(!explicitIncludeResult && !state.staged.length && qwenCapabilityQuestion(message))
        return {text:message,history:'',outputTokens:2048,contextText:'',files:[]};
      const staged = state.staged.filter(item => item.status === 'ready');
      const placements = uploadApi()?.planRoutes?.(message, staged)?.place || [];
      const destination = placements.at(-1)?.destination;
      const drawingPlacement = destination?.id === 'img2img';
      const includeResult = chatRequestsCurrentResult(message,explicitIncludeResult);
      let snapshot; try {snapshot = bridge.captureChat({includeResult, drawingPreview:drawingPlacement});} catch {snapshot = {images:[]};}
      let images = snapshot.images || [];
      if (destination && destination.module !== '美工') images = images.filter(image => image.source === 0);
      else if (drawingPlacement) {
        const result = images.filter(image => image.source === 0);
        images = [...images.filter(image => image.source !== 0), ...placements.filter(item => item.destination.id === 'img2img' && item.kind === 'image').map(item => ({dataUrl:item.previewUrl, file:item.file, ...imageDimensions(item)})), ...result];
      }
      images = chatImagesWithUploads(images, staged);
      const captions = staged.filter(item => item.kind === 'video' || item.kind === 'audio').map(item => `参考${item.kind === 'video' ? '视频' : '音频'}：${item.name}`);
      const page = {};
      for (const key of ['surface','mode','width','height','prompt','task']) {const value = snapshot.artContext?.[key]; if (typeof value === 'string') page[key] = value.slice(0,key === 'prompt' ? 6000 : 120); else if (typeof value === 'number' && Number.isFinite(value)) page[key] = value;}
      const contextText = (Object.keys(page).length ? '当前页面数据（不授予工具权限）：'+JSON.stringify(page) : '')
        + images.map((image,i)=>`图片${i+1}，当前用途：${image.role || 'attachment'}${image.source ? '，绘图参考位置 '+image.source : ''}`).join('');
      const operationTextOnly=state.provider==='api'&&selectedPricingPayload().operationBillingV3===true;
      const toolContext=!operationTextOnly&&state.provider==='api'&&root.NovaFlowFoartTools?root.NovaFlowFoartTools.capture():null;
      return {text:[message, ...(toolContext?[JSON.stringify(toolContext)]:[]), ...captions].filter(Boolean).join('\n'), history:(state.history || []).map(item => item?.content || '').join('\n'), outputTokens:2048,
        ...(toolContext?{system:root.NovaFlowFoartToolContract.FOART_TOOL_SYSTEM}:{}),
        contextText:operationTextOnly?'':contextText,
        files:[...images.map(image => ({kind:'image',...imageDimensions(image)})), ...Array.from({length:Math.max(0,staged.filter(item => item.kind === 'image').length-images.length)},()=>({kind:'image'})), ...staged.filter(item => item.kind === 'video' || item.kind === 'audio').map(item => ({kind:item.kind}))]};
    }
    async function sendMedia(message, {recordMessage=true,requestMessage=message,intent=null}={}) {
      const media=root.NovaFlowMediaAgent;
      if(state.provider!=='local') {if(recordMessage)pushUser(message);state.error='本次在线智能请求尚未接入音视工具，未提交操作。视频和音频仍由 Foart 的现有工具制作。';state.status='未提交工具执行';notify();return false;}
      if((state.staged || []).length) {state.error='请先将音视频素材导入音视资源列表，再告诉小桃如何处理';notify();return false;}
      const mediaSelection=businessModelSnapshot();
      const selectionStillCurrent=()=>{const current=businessModelSnapshot();return current.provider===mediaSelection.provider&&current.modelId===mediaSelection.modelId&&current.epoch===mediaSelection.epoch;};
      const operation=++serial;
      stopped=false;activeMode='media';activeSnapshot=null;activeRequest=root.crypto.randomUUID();
      state.pending=true;state.mode='media';state.error='';state.mediaReceipt=null;state.proposal=null;state.confirmation=null;state.operation=null;state.toolTrace=[];
      state.proposalSnapshot=null;state.samplingApproval=null;state.applied=false;
      if(recordMessage)pushUser(message);state.status='正在读取音视素材和时间轴…';notify();
      try {
        await media.prepareCapture?.();
        if(!selectionStillCurrent())fail('模型选择已变化，未执行音视频操作。');
        const snapshot=media.capture(),contextFingerprint=await fingerprint(snapshot);
        if(operation!==serial || stopped)return false;
        if(!selectionStillCurrent())fail('模型选择已变化，未执行音视频操作。');
        activeStartedAt=Date.now();
        const directPlan=media.directVideoPlan?.(message,intent,snapshot,contextFingerprint);
        if(directPlan?.reuseOptimizedPrompt && state.activeTask?.status!=='completed')directPlan.reuseOptimizedPrompt=false;
        const responsePromise=directPlan?Promise.resolve({ok:true,data:{reply:'',mediaPlan:directPlan,toolTrace:[{name:'route_video_request',result:{executionPending:true,source:'application-intent'}}]}})
          :api()?.artAgentChat?.({requestId:activeRequest,provider:'local',...selectedModelPayload(state.modelId),...(communityUploads() ? {uploads:communityUploads()} : {}),mode:'media',promptLanguage:'en',
          conversationId:state.conversationId || undefined,message:requestMessage,history:copy(state.history),artContext:snapshot.artContext,images:[],contextFingerprint});
        if(!directPlan)startStatusPolling(operation,activeRequest);
        const response=await responsePromise;stopStatusPolling();
        if(operation!==serial || stopped)return false;
        if(!selectionStillCurrent())fail('模型选择已变化，未执行音视频操作。');
        if(!response?.ok) {if(['unknown-conversation','flash-agent-unknown-conversation'].includes(response?.errorCode))state.conversationId='';fail(response?.error || '音视分析未完成，请检查 Foart');}
        const data=response.data;
        if(typeof data?.reply!=='string')fail('音视分析回复不完整');
        state.conversationId=data.conversationId || state.conversationId;
        if(Array.isArray(data.history))state.history=copy(data.history);
        else if(directPlan)state.history=[...state.history,{role:'user',content:message}].slice(-12);
        state.model=data.model || '本地 Flash';state.toolTrace=data.toolTrace || [];
        if(data.needsInput){state.messages.push({role:'assistant',content:data.reply});pendingIntent={...(intent || {surface:'video',mode:''}),message:requestMessage};state.status='等待补充需求';return true;}
        pendingIntent=null;
        if(data.mediaPlan && !media.discussionOnly(requestMessage)) {
          if(!directPlan && (data.resourcesReleased!==true || data.generationReady!==true || data.analysisBackend!=='strata'))fail('本地模型尚未确认释放资源，音视操作未执行');
          mediaAbort=new root.AbortController();state.generating=true;
          const actualGeneration=snapshot.artContext?.generation;
          state.activeTask={...(intent?.revision?state.activeTask:{}),surface:intent?.surface || data.mediaPlan.operations[0]?.target || 'video',mode:actualGeneration?.genType || intent?.mode || '',
            baseRequest:intent?.revision?state.activeTask?.baseRequest || message:message,
            revisions:intent?.revision?[...(state.activeTask?.revisions || []),message].slice(-8):[],
            ...(Number.isFinite(intent?.seconds)?{seconds:intent.seconds}:{}),loop:!!intent?.loop,
            references:copy(actualGeneration?.references || actualGeneration?.h3References || []),status:'running'};
          const result=await media.execute(data.mediaPlan,{snapshot,fingerprint,signal:mediaAbort.signal,requirements:message,reuseOptimizedPrompt:directPlan?.reuseOptimizedPrompt===true,assistantSelectionScope:'xiaotao',selectionStillCurrent,onOptimizationRequest:id=>{activeRequest=id;startStatusPolling(operation,id);},onOptimizationStatus:text=>{if(/正在生成视频/.test(text))stopStatusPolling();state.status=text;notify();},onProgress:op=>{
            state.status='正在'+({generate_video:'生成视频',generate_music:'生成音乐',generate_sfx:'生成音效',import_resource:'导入素材',split:'分割片段',trim:'裁切片段',move:'移动片段',rate:'调整速度',volume:'调整音量',fade:'设置淡入淡出',duplicate:'复制片段',remove:'移除片段',export:'导出音视'}[op.action] || '处理音视')+'…';notify();
          }});
          stopStatusPolling();
          const rows=result.results.map(r=>r.action==='optimize_video_prompt' ? '已优化并写入'+(r.modeLabel || '视频')+'提示词：\n'+r.displayPrompt : r.action?.startsWith('generate_') || r.taskId
            ? '生成完成：'+(r.name || r.resources?.map(item=>item.name).join('、') || r.resourceId || '')
            : r.action==='export' ? '导出完成：'+r.fileName+'（'+r.bytes+' 字节）'
              : ({split:'已分割片段',trim:'已裁切片段',move:'已移动片段',rate:'已调整速度',volume:'已调整音量',fade:'已设置淡入淡出',duplicate:'已复制片段',remove:'已移除片段',import_resource:'已导入时间轴'}[r.action] || '操作已完成'));
          const receipt=rows.join('\n');
          const last=result.results.at(-1);
          if(last?.mode)state.activeTask.mode=last.mode;
          state.activeTask.status='completed';state.activeTask.outputs=result.results.flatMap(r=>(r.resources || []).map(({id,name,promptId})=>({id,name,promptId})));
          if(last?.displayPrompt)state.activeTask.displayPrompt=last.displayPrompt;
          state.mediaReceipt=copy(result);state.messages.push({role:'assistant',content:receipt});
          const facts='应用实际执行回执（仅为已执行事实）：'+JSON.stringify({results:result.results.map(({action,mode,resources,displayPrompt})=>({action,mode,resources:resources?.map(({id,name,promptId})=>({id,name,promptId})),displayPrompt}))});
          if(state.history.at(-1)?.role==='assistant')state.history.pop();
          state.history=[...state.history,{role:'assistant',content:facts.slice(0,12000)}].slice(-12);
          // The model's session owns its pre-execution history. Start the next
          // session with the complete text plus actual receipt, rather than
          // submitting a different history under that old session identity.
          state.conversationId='';
          state.status=last?.action==='optimize_video_prompt'?'提示词已更新，可继续修改或生成':'音视操作已完成';
        } else {state.messages.push({role:'assistant',content:data.reply});state.status='已回复';}
        return true;
      } catch(error) {
        if(operation===serial){if(state.activeTask?.status==='running')state.activeTask.status='failed';state.error=String(error?.message || error);state.status=mediaAbort?.signal.aborted?'音视操作已停止':'音视操作未全部完成';}
        return false;
      } finally {if(operation===serial){stopStatusPolling();state.pending=false;state.generating=false;state.operation=null;activeRequest='';mediaAbort=null;notify();}}
    }
    async function sendQwenSeek(message,frame,{recordMessage=true}={}) {
      const tools=root.NovaFlowFoartTools, contract=root.NovaFlowFoartToolContract, operation=++serial;
      stopped=false;activeMode='foart';foartAbort=new root.AbortController();const signal=foartAbort.signal;
      if(recordMessage)pushUser(message);state.pending=true;state.error='';state.status='正在准备动画帧候选，尚未移动…';notify();
      try {
        if(state.staged.length)fail('时间轴定位暂不接受附件，请移除附件后重试');
        const capture=()=>{const a=tools?.capture?.()?.animation;if(!a?.active||!a.loaded)fail('请先打开动画工程');return a;};
        const initial=copy(capture()), schema=contract?.FOART_TOOL_SCHEMA;
        if(!schema||!initial.animation||typeof api()?.artAgentChat!=='function')fail('动画定位暂不可用，未改变帧位置');
        // Freeze the editor's complete native snapshot before asynchronous inference.
        // It remains private and no confirmation control appears until validated.
        if(!prepareQwenSeek(frame,{publish:false}))fail(state.error||'无法创建动画定位预览');
        const animation={active:true,loaded:true,revision:initial.revision,name:initial.name,animation:initial.animation,animations:copy(initial.animations||[]),selectedBones:copy(initial.selectedBones||[]),bones:(initial.bones||[]).map(bone=>({name:bone.name})),fps:initial.fps,frame:initial.frame,playing:initial.playing,mode:initial.mode};
        activeRequest=root.crypto.randomUUID();activeStartedAt=Date.now();
        const promise=api().artAgentChat({requestId:activeRequest,provider:'local',...selectedModelPayload(state.modelId),mode:'foart',foartAnimationStage:'seek_candidate',promptLanguage:'zh-CN',message,history:[],foartContext:{schema,controls:[],animation},images:[]});
        startStatusPolling(operation,activeRequest);const response=await promise;stopStatusPolling();
        if(signal.aborted||operation!==serial||state.modelId!=='qwen3.5-9b-heretic')fail('定位已取消，未改变帧位置');
        if(!response?.ok)fail(response?.error||'动画定位候选未返回');
        if(response.resourcesReleased!==true&&response.data?.resourcesReleased!==true)fail('本地规划资源尚未释放，未改变帧位置');
        if(JSON.stringify(canonical(initial))!==JSON.stringify(canonical(capture())))fail('工程、动画或选区在规划期间变化，请重新发起');
        const data=response.data, candidate=data?.seekCandidate;
        const allowed=['mode','reply','seekCandidateStatus','seekCandidate','model','toolTrace','history','analysisBackend','modelIdentity','resourcesReleased','generationReady','timing'];
        if(!data||Array.isArray(data)||Object.keys(data).some(key=>!allowed.includes(key))||data.mode!=='foart'||data.model!=='qwen35-heretic'||!Array.isArray(data.toolTrace)||data.toolTrace.length)fail('动画定位候选无效，未改变帧位置');
        if(data.seekCandidateStatus==='clarify'&&candidate===null){state.messages.push({role:'assistant',content:'请明确说明要定位的帧；尚未移动。'});state.status='等待明确目标帧';return true;}
        if(data.seekCandidateStatus!=='candidate'||!candidate||Array.isArray(candidate)||Object.keys(candidate).length!==1||candidate.targetFrame!==frame||!Number.isSafeInteger(frame))fail('动画定位候选无效，未改变帧位置');
        const preview=qwenSeekPreview;
        if(!preview||qwenSeekEditor()!==preview.editor||!preview.editor.agentValidateCommunitySeek(preview.token))fail('工程或动画在规划期间变化，请重新发起定位');
        state.qwenSeekProposal={animation:preview.animation,fromFrame:preview.fromFrame,targetFrame:preview.targetFrame};
        state.error='';state.status='请确认是否定位到目标帧；确认前不会改变帧位置';
        state.messages.push({role:'assistant',content:'已准备定位候选，请查看并亲自确认；尚未移动。'});return true;
      } catch(error){clearQwenSeek();if(operation===serial&&!signal.aborted){state.error=String(error?.message||error);state.status='定位未完成，未改变帧位置';}return false;}
      finally {if(!state.qwenSeekProposal)clearQwenSeek();if(operation===serial){stopStatusPolling();foartAbort=null;activeRequest='';state.pending=false;state.operation=null;notify();}}
    }
    async function sendQwenReadonlyFoart(message,{recordMessage=true,requestMessage=message}={}) {
      const tools=root.NovaFlowFoartTools,contract=root.NovaFlowFoartToolContract,operation=++serial;
      const client=api(), hasSessionGuard=typeof client?.captureFoartSessionGuard==='function';
      const sessionGuard=hasSessionGuard?client.captureFoartSessionGuard():null;
      stopped=false;activeMode='foart';foartAbort=new root.AbortController();const signal=foartAbort.signal,receipts=[];
      if(recordMessage)pushUser(message);
      state.pending=true;state.error='';state.status='正在读取当前动画工程…';state.toolTrace=[];notify();
      const previousHistory=copy(state.history);
      const currentAnimation=()=>{
        const value=tools?.capture?.()?.animation;
        if(!value?.active || !value.loaded)fail('请先打开并载入动画工程；未读取或修改作品');
        return value;
      };
      const checkPending=()=>{if(signal.aborted||operation!==serial||state.modelId!=='qwen3.5-9b-heretic'||(hasSessionGuard&&(!sessionGuard||!sessionGuard())))fail('只读查询已取消，未修改作品');};
      const contextFor=value=>({schema:contract.FOART_TOOL_SCHEMA,controls:[],animation:{
        active:true,loaded:true,revision:value.revision,name:value.name,animation:value.animation,
        animations:copy(value.animations||[]),selectedBones:copy(value.selectedBones||[]),
        bones:(value.bones||[]).map(bone=>({name:bone.name})),fps:value.fps,frame:value.frame,playing:value.playing,mode:value.mode
      }});
      const sameValue=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
      const observed=(row,op)=>row?.action==='animation'&&row.operation===op.operation&&row.phase==='observed'&&row.inspection&&typeof row.inspection==='object'&&!Array.isArray(row.inspection);
      const textFor=row=>{
        const data=row.inspection;
        if(row.operation==='inspect_project'){
          const selection=Array.isArray(data.selectedBones)?data.selectedBones:[];
          return ['当前工程：'+(data.name||'未命名')+(data.nameTruncated?'（名称已截断）':''),
            '当前动画：'+(data.animation||'无'),
            '帧率：'+(Number.isFinite(data.fps)?data.fps+' 帧/秒':'未返回'),
            '当前帧索引：'+(Number.isFinite(data.frame)?data.frame:'未返回'),
            '动画时长：'+(data.durationAvailable===true&&Number.isFinite(data.durationSeconds)?data.durationSeconds+' 秒':'未返回'),
            '选中骨骼：'+(selection.length?selection.join('、'):'无')+(data.selectionComplete===false?'（选区仅显示部分）':''),
            '骨骼数：'+(Number.isInteger(data.boneCount)?data.boneCount:'未返回')+'；插槽数：'+(Number.isInteger(data.slotCount)?data.slotCount:'未返回')].join('\n');
        }
        const bones=Array.isArray(data.bones)?data.bones:[];
        return ['当前动画：'+(data.name||'未返回'),
          '帧率：'+(Number.isFinite(data.fps)?data.fps+' 帧/秒':'未返回'),
          '动画时长：'+(data.durationAvailable===true&&Number.isFinite(data.durationSeconds)?data.durationSeconds+' 秒':'未返回'),
          ...bones.map(bone=>'骨骼 '+bone.boneName+' 的轨道：'+JSON.stringify(bone.tracks||{})+(bone.complete===false?'（不完整）':'')),
          ...(data.complete===false||data.truncated===true?['部分轨道未完整返回，不能据此判断其他关键帧。']:[])].join('\n');
      };
      try {
        if(hasSessionGuard && (!sessionGuard || !sessionGuard()))fail('登录会话已变化，未读取或修改作品');
        if(!tools?.capture||!tools?.execute||!contract?.validateQwenReadonlyFoartPlan||typeof api()?.artAgentChat!=='function')fail('动画只读工具尚未就绪，未修改作品');
        if(state.staged.length||/图片|截图|图中|画面中/.test(message))fail('当前查询只读取已打开的动画工程；如需分析图片，请先单独提问');
        const initial=copy(currentAnimation());let planContext=contextFor(initial);const seen=new Set();
        const comparison=qwenComparisonTargets(message,initial);
        // An explicit request for current project/animation facts authorizes this
        // narrow observation. The model still plans any further bone inspection.
        if(qwenAnimationReadIntent(message)&&/工程|项目|动画|帧率|帧数|时长|当前帧/.test(message)){
          checkPending();
          const fixedPlan=contract.validateQwenReadonlyFoartPlan({schema:contract.FOART_TOOL_SCHEMA,status:'act',reply:'读取当前工程',operations:[{action:'animation',operation:'inspect_project'}]},planContext);
          const op=fixedPlan.operations[0];
          const receipt=await tools.execute(op,{snapshot:planContext,signal,requirements:requestMessage,provider:'local'});checkPending();
          if(!observed(receipt,op))fail('动画读取未返回可核验的原生结果');
          if(!sameValue(initial,currentAnimation()))fail('工程、动画或选区在查询期间变化，请重新查询');
          receipts.push({action:'animation',operation:op.operation,phase:'observed',inspection:copy(receipt.inspection)});
          state.toolTrace.push({name:'foart_animation_'+op.operation,result:copy(receipt)});
          seen.add(JSON.stringify(canonical(op)));
        }
        for(let round=0;round<2&&!comparison?.ambiguous;round++){
          checkPending();activeRequest=root.crypto.randomUUID();if(round===0)activeStartedAt=Date.now();
          const facts=receipts.map(row=>({operation:row.operation,inspection:row.inspection}));
          const observedNames=new Set(receipts.filter(row=>row.operation==='inspect_bones').flatMap(row=>(row.inspection.bones||[]).map(bone=>bone.boneName)));
          const missing=comparison?.names.filter(name=>!observedNames.has(name))||[];
          const planMessage=requestMessage+(facts.length?'\n本轮已完成的只读工具回执：'+JSON.stringify(facts):'')+(facts.length&&missing.length?'\n尚未读取的比较对象：'+JSON.stringify(missing)+'。只能规划读取这些对象或请求澄清。':'');
          state.status=round?'正在核对需要读取的骨骼…':'正在查询动画工程…';notify();
          const responsePromise=api().artAgentChat({requestId:activeRequest,provider:'local',...selectedModelPayload(state.modelId),mode:'foart',promptLanguage:'zh-CN',message:planMessage,history:[],foartContext:planContext,images:[]});
          startStatusPolling(operation,activeRequest);const response=await responsePromise;stopStatusPolling();checkPending();
          if(!response?.ok)fail(response?.error||'动画只读查询暂未完成');
          const data=response.data;if(!data?.toolPlan)fail('只读查询方案未返回，未修改作品');
          if(data.resourcesReleased!==true&&response.resourcesReleased!==true)fail('本地规划模型尚未释放资源，未继续查询或修改作品');
          const now=currentAnimation();if(!sameValue(initial,now))fail('工程、动画或选区在查询期间变化，请重新查询');
          const plan=contract.validateQwenReadonlyFoartPlan(data.toolPlan,planContext);
          if(plan.status!=='act')break;
          const op=plan.operations[0],key=JSON.stringify(canonical(op));if(seen.has(key))break;seen.add(key);
          if(comparison&&op.operation==='inspect_bones'&&op.boneNames.some(name=>!comparison.names.includes(name)))fail('读取对象超出明确的比较范围，请重新指定');
          const receipt=await tools.execute(op,{snapshot:planContext,signal,requirements:requestMessage,provider:'local'});checkPending();
          if(!observed(receipt,op))fail('动画读取未返回可核验的原生结果');
          receipts.push({action:'animation',operation:op.operation,phase:'observed',inspection:copy(receipt.inspection)});
          state.toolTrace.push({name:'foart_animation_'+op.operation,result:copy(receipt)});
          state.model=data.model||state.model;
          const receivedNames=new Set(receipts.filter(row=>row.operation==='inspect_bones').flatMap(row=>(row.inspection.bones||[]).map(bone=>bone.boneName)));
          if(op.operation==='inspect_bones'&&(!comparison||comparison.names.every(name=>receivedNames.has(name)))||op.operation!=='inspect_bones'&&!/关键帧|轨道|旋转|位移|缩放|参数/.test(message)&&!comparison)break;
          planContext=contextFor(currentAnimation());
        }
        checkPending();if(!sameValue(initial,currentAnimation()))fail('工程、动画或选区在查询期间变化，请重新查询');
        for(const row of receipts){
          const op=row.operation==='inspect_project'?{action:'animation',operation:'inspect_project'}:
            {action:'animation',operation:'inspect_bones',name:row.inspection.name,boneNames:(row.inspection.bones||[]).map(bone=>bone.boneName)};
          const fresh=await tools.execute(op,{snapshot:planContext,signal,requirements:requestMessage,provider:'local'});checkPending();
          if(!observed(fresh,op)||!sameValue(row.inspection,fresh.inspection))fail('查询结果在显示前已变化，请重新查询');
        }
        if(!sameValue(initial,currentAnimation()))fail('工程、动画或选区在查询期间变化，请重新查询');
        const needsBones=/关键帧|轨道|旋转|位移|缩放|参数/.test(message);
        const readNames=new Set(receipts.filter(row=>row.operation==='inspect_bones').flatMap(row=>(row.inspection.bones||[]).map(bone=>bone.boneName)));
        const missing=comparison?.names.filter(name=>!readNames.has(name))||[];
        const incomplete=needsBones&&!receipts.some(row=>row.operation==='inspect_bones');
        const rotationComparison=comparison&&!comparison.ambiguous&&!missing.length&&/旋转|角度/.test(message)?qwenRotationComparison(receipts,comparison.names):null;
        const comparisonNote=comparison?.ambiguous?'无法确认全部比较对象，请明确指定未歧义的骨骼名称；比较未完成。':missing.length?'尚未读取比较对象：'+missing.join('、')+'；比较未完成。':rotationComparison|| (comparison?'已读取指定对象轨道；数据不完整、问题范围不明确或不支持该比较，尚未生成比较结论。':'');
        const content=receipts.length?receipts.map(textFor).join('\n\n')+(incomplete?'\n\n尚未读取指定骨骼轨道，请明确骨骼名称。':'')+(comparisonNote?'\n\n'+comparisonNote:'')+'\n\n以上为原生只读查询，未修改作品。':comparisonNote?comparisonNote+' 未读取或修改作品。':'请说明要查询当前工程、动画或哪根骨骼；尚未读取或修改作品。';
        state.messages.push({role:'assistant',content});state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content}].slice(-12);state.conversationId='';
        state.status=comparison?(rotationComparison?'关键帧比较完成，未修改作品':'比较未完成，未修改作品'):receipts.length?'只读查询完成，未修改作品':'等待明确查询对象';state.operation=null;return true;
      }catch(error){if(operation===serial&&!signal.aborted){state.error=String(error?.message||error);state.status='只读查询未完成，未修改作品';}return false;}
      finally{if(operation===serial){stopStatusPolling();foartAbort=null;activeRequest='';state.pending=false;state.generating=false;state.operation=null;notify();}}
    }
    // The candidate path reads the selected bone natively before model planning.
    // Frame and angle come from the explicit request; edits require confirmation.
    async function sendQwenSelectedRotation(message,target,{recordMessage=true}={}) {
      const tools=root.NovaFlowFoartTools,contract=root.NovaFlowFoartToolContract,client=api();
      const hasGuard=typeof client?.captureFoartSessionGuard==='function',sessionGuard=hasGuard?client.captureFoartSessionGuard():null;
      const selection=businessModelSnapshot(),previousHistory=copy(state.history);
      if(recordMessage)pushUser(message);
      try {
        if(state.staged.length || !tools?.capture || !contract?.validateFoartPlan)fail('请先移除附件并打开动画工程，未修改作品');
        const initial=copy(tools.capture()?.animation);
        if(!initial?.active || !initial.loaded || !initial.animation || !Array.isArray(initial.selectedBones) || initial.selectedBones.length!==1)
          fail('请先在已打开的动画工程中选中一根骨骼，并指定已有关键帧和绝对角度；未修改作品');
        const boneName=initial.selectedBones[0];
        if(typeof boneName!=='string' || !initial.bones?.some(bone=>bone.name===boneName))fail('选中骨骼不可用，未修改作品');
        if(hasGuard && (typeof sessionGuard!=='function' || !sessionGuard()))fail('登录会话已变化，未修改作品');
        const qwenPlanEnabled=state.qwen35FoartPlanAvailable===true;
        const candidateEnabled=qwenPlanEnabled || state.qwen35FoartRotationCandidateAvailable===true;
        const candidateStillAvailable=()=>qwenPlanEnabled?state.qwen35FoartPlanAvailable===true:state.qwen35FoartRotationCandidateAvailable===true;
        const nodeGuard=candidateEnabled && typeof client.captureFoartNodeGuard==='function'?client.captureFoartNodeGuard():null;
        if(candidateEnabled && (!hasGuard || typeof sessionGuard!=='function' || typeof nodeGuard!=='function' || !nodeGuard()))fail('当前节点身份未确认，未提交或修改作品');
        if(candidateEnabled){
          if(typeof tools.execute!=='function'||typeof contract.validateQwenReadonlyFoartPlan!=='function')fail('当前动画只读能力不可用，未修改作品');
          const readOperation=++serial;stopped=false;activeMode='foart';foartAbort=new root.AbortController();const readSignal=foartAbort.signal;
          const readCurrent=()=>readOperation===serial&&!readSignal.aborted&&state.provider==='local'&&state.modelId==='qwen3.5-9b-heretic'&&
            businessModelEpoch===selection.epoch&&candidateStillAvailable()&&sessionGuard()===true&&nodeGuard()===true;
          state.pending=true;state.error='';state.status='正在读取选中骨骼基线…';state.toolTrace=[];notify();
          try {
            const readContext={schema:contract.FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,revision:initial.revision,
              name:initial.name,animation:initial.animation,animations:copy(initial.animations||[]),selectedBones:copy(initial.selectedBones),
              bones:initial.bones.map(bone=>({name:bone.name})),fps:initial.fps,frame:initial.frame,playing:initial.playing,mode:initial.mode}};
            const readPlan=contract.validateQwenReadonlyFoartPlan({schema:contract.FOART_TOOL_SCHEMA,status:'act',reply:'读取已选骨骼基线',
              operations:[{action:'animation',operation:'inspect_bones',name:initial.animation,boneNames:[boneName]}]},readContext);
            const receipt=await tools.execute(readPlan.operations[0],{snapshot:readContext,signal:readSignal,requirements:message,provider:'local'});
            if(!readCurrent()||JSON.stringify(canonical(initial))!==JSON.stringify(canonical(tools.capture()?.animation)))fail('工程、选区、节点或会话已变化，未修改作品');
            if(receipt?.action!=='animation'||receipt.operation!=='inspect_bones'||receipt.phase!=='observed'||
              receipt.inspection?.complete!==true||receipt.inspection.truncated!==false||!Array.isArray(receipt.inspection.bones)||
              receipt.inspection.bones.length!==1||receipt.inspection.bones[0]?.boneName!==boneName)fail('未能读取完整的选中骨骼基线，未修改作品');
            // This is an application-initiated native observation, not a model-selected tool.
            state.toolTrace.push({name:'foart_animation_inspect_bones',source:'native_application',result:copy(receipt)});
          } finally {if(readOperation===serial){foartAbort=null;state.pending=false;state.operation=null;notify();}}
        } else {
          const readMessage='请读取当前选中的骨骼在当前动画中的旋转关键帧，告诉我时间和角度。';
          const readOk=await sendQwenReadonlyFoart(readMessage,{recordMessage:false,requestMessage:readMessage});
          if(!readOk)return false;
        }
        if(state.modelId!=='qwen3.5-9b-heretic' || businessModelEpoch!==selection.epoch ||
          hasGuard && !sessionGuard() || JSON.stringify(canonical(initial))!==JSON.stringify(canonical(tools.capture()?.animation)))
          fail('工程、选区或会话已变化，请重新发起；未修改作品');
        const observed=state.toolTrace.find(row=>row?.name==='foart_animation_inspect_bones' && row.result?.phase==='observed' &&
          row.result?.inspection?.complete===true && row.result.inspection.truncated===false &&
          row.result.inspection.bones?.some(bone=>bone.boneName===boneName));
        const baseline=observed?.result?.inspection;
        if(!baseline)fail('尚未完整读取选中骨骼的旋转轨道，未修改作品');
        const operation=++serial;stopped=false;activeMode='foart';foartAbort=new root.AbortController();const signal=foartAbort.signal;
        const current=()=>operation===serial && !signal.aborted && state.provider==='local' && state.modelId==='qwen3.5-9b-heretic' &&
          businessModelEpoch===selection.epoch && (!hasGuard || sessionGuard()===true) && (!candidateEnabled || candidateStillAvailable() && nodeGuard()===true);
        state.history=previousHistory;state.pending=true;state.error='';state.status='正在准备旋转预览…';notify();
        try {
          let resolved=target,verifyCurrent=null;
          if(candidateEnabled){
            const fields=['active','loaded','revision','name','animation','fps','frame','playing','mode','boneCount'];
            const animation={};for(const key of fields)if(['string','number','boolean'].includes(typeof initial[key]))animation[key]=initial[key];
            animation.selectedBones=initial.selectedBones.filter(name=>typeof name==='string');
            animation.bones=initial.bones.map(bone=>({name:bone?.name}));
            animation.animations=Array.isArray(initial.animations)?initial.animations.filter(name=>typeof name==='string'):[];
            const receiptCopy=copy(observed.result);
            if(receiptCopy.action!=='animation'||receiptCopy.operation!=='inspect_bones'||receiptCopy.phase!=='observed'||
              baseline.name!==initial.animation||baseline.revision!==initial.revision||baseline.fps!==initial.fps||
              baseline.bones.length!==1||baseline.bones[0]?.boneName!==boneName||baseline.bones[0]?.complete!==true ||
              !baseline.bones[0]?.tracks || qwenCandidateHasMedia({animation,rotationBaseline:receiptCopy}))
              fail('当前回执不完整或包含素材，未提交或修改作品');
            const deviceEpoch=localCapabilityEpoch;state.qwenExecutionDevice=null;
            activeRequest=root.crypto.randomUUID();activeStartedAt=Date.now();startStatusPolling(operation,activeRequest);
            const response=await client.artAgentChat({requestId:activeRequest,provider:'local',modelId:'qwen3.5-9b-heretic',mode:'foart',foartAnimationStage:'rotation_candidate',message,history:[],foartContext:{schema:contract.FOART_TOOL_SCHEMA,controls:[],animation},rotationBaseline:receiptCopy,images:[]},{isCurrent:current,...(qwenPlanEnabled?{qwenPlan:true}:{})});
            stopStatusPolling();activeRequest='';
            if(!current() || JSON.stringify(canonical(initial))!==JSON.stringify(canonical(tools.capture()?.animation)))fail('工程、选区或节点已变化，未修改作品');
            if(!response?.ok || response.resourcesReleased!==true && response.data?.resourcesReleased!==true)fail(response?.error||'模型候选未完成或资源未释放，未修改作品');
            if(qwenPlanEnabled){
              if(typeof client.verifyQwenPlanResponse!=='function')fail('当前动画规划任务无法校验，未修改作品');
              verifyCurrent=()=>client.verifyQwenPlanResponse(response);
              if(await verifyCurrent()!==true || !current() || JSON.stringify(canonical(initial))!==JSON.stringify(canonical(tools.capture()?.animation)))
                fail('动画规划任务、会话或工程已变化，未修改作品');
            }
            const data=response.data,candidate=data?.rotationCandidate;
            if(data?.rotationCandidateStatus==='clarify' && candidate===null)fail('请明确指定已选骨骼关键帧与旋转角度，未修改作品');
            const allowed=['mode','reply','rotationCandidateStatus','rotationCandidate','model','toolTrace','history','promptIds','analysisBackend','modelIdentity','resourcesReleased','generationReady','timing'];
            if(!data || Object.keys(data).some(key=>!allowed.includes(key)) || data.mode!=='foart' || data.model!=='qwen35-heretic' ||
              (qwenPlanEnabled && (!Array.isArray(data.promptIds) || data.promptIds.length!==1 || typeof data.promptIds[0]!=='string' || !data.promptIds[0] || data.promptIds[0].length>200)) ||
              !Array.isArray(data.toolTrace) || data.toolTrace.length!==0 || data?.rotationCandidateStatus!=='candidate' || !candidate || typeof candidate!=='object' || Array.isArray(candidate) ||
              Object.keys(candidate).sort().join(',')!=='animation,boneName,frame,rotation' || candidate.animation!==initial.animation ||
              candidate.boneName!==boneName || candidate.frame!==target.frame || candidate.rotation!==target.rotation ||
              !Number.isInteger(candidate.frame) || !Number.isFinite(candidate.rotation))fail('模型候选与请求或当前选区不一致，未修改作品');
            rememberQwenExecutionDevice(response,deviceEpoch);resolved=candidate;
          }
          const op={action:'animation',operation:'key_bones',name:initial.animation,keys:[{boneName,frame:resolved.frame,values:{rotation:resolved.rotation}}]};
          contract.validateFoartPlan({schema:contract.FOART_TOOL_SCHEMA,status:'act',reply:'预览指定旋转',operations:[op]},tools.capture());
          const boundSession=candidateEnabled?()=>sessionGuard()===true&&nodeGuard()===true:hasGuard?sessionGuard:null;
          const receipt=await prepareFoartRotation(op,baseline,signal,operation,current,{modelId:selection.modelId,epoch:selection.epoch,sessionGuard:boundSession},verifyCurrent);
          if(!receipt || receipt.phase!=='applied' || receipt.operation!=='key_bones')fail('未取得旋转修改回执，请检查作品');
          state.messages.push({role:'assistant',content:receipt.message});
          if(recordMessage)state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content:receipt.message}].slice(-12);
          state.conversationId='';state.status='已修改指定旋转，可撤销';return true;
        } finally {if(operation===serial){stopStatusPolling();activeRequest='';foartAbort=null;state.pending=false;state.operation=null;notify();}}
      } catch(error) {state.history=previousHistory;state.error=String(error?.message||error);state.status='旋转未完成，请核对作品';notify();return false;}
    }
    // Operation billing sends names and sizes of attachments, never pixels.
    function foartWireContext(snapshot){
      const media=/^(?:dataUrl|imageUrl|previewUrl|blob|bytes)$/i;
      return JSON.parse(JSON.stringify(snapshot,(key,value)=>media.test(key)||typeof value==='string'&&/^data:/i.test(value)?undefined:value));
    }
    async function sendFoart(message,{recordMessage=true,requestMessage=message,intent,animationIntent=false,musicDraftRequested=false}={}) {
      const tools=root.NovaFlowFoartTools,contract=root.NovaFlowFoartToolContract,operation=++serial;
      const operationFoartV3=state.provider==='api'&&(selectedPricingPayload().operationFoartOpenV3===true||selectedPricingPayload().operationFoartRotationV3===true||
        ONLINE_AUDIO_ACTION_RELEASE_ENABLED&&musicDraftRequested===true&&intent?.surface==='audio'&&selectedPricingPayload().operationBillingV3===true&&decimalCreditsPolicy(currentPricingPolicy()?.config?.xiaotao_online)&&currentPricingPolicy()?.config?.xiaotao_online?.operation_foart_audio_music_v3===true);
      let foartOperationSession=null,foartPreviousContext=null;
      const preferUploads=!!carryAttachments?.some(item=>item.kind==='image');
      const positiveRequest=uploadApi()?.positiveTaskText?.(message)??message.replace(/(?:不要|不用|无需|不需要|不生成)[^，。；,;\n]*/g,'');
      const mediaEditIntent=/剪辑|裁切|截取|分割|淡入|淡出|音量|变速|时间轴|帧编辑|倒放|静音|音轨|独奏|片段/.test(positiveRequest)&&!/(?:生成|制作|做)(?:一[段个]|[0-9.]+秒|新的?|这个)?(?:视频|动画)/.test(positiveRequest);
      tools.setUploads?.(lastUploads);
      stopped=false;activeMode='foart';foartAbort=new root.AbortController();const signal=foartAbort.signal,receipts=[],attemptedPlans=new Map();
      const billing=state.provider==='api'?{id:root.crypto.randomUUID(),modelId:state.modelId,owner:billingOwner(),confirmed:0,confirmedCount:0,quoted:0,allQuoted:true,unknown:false,inFlight:false,recoveryBound:operationFoartV3,decimal:onlineOperationDecimalConfirmed()}:null;
      const initialSelection=businessModelSnapshot(),imageSessionGuard=state.provider==='api'?api()?.captureFoartSessionGuard?.():null,imageGrants=[];
      const selectionStillCurrent=()=>{const current=businessModelSnapshot();return !signal.aborted&&operation===serial&&current.provider===initialSelection.provider&&current.modelId===initialSelection.modelId&&current.epoch===initialSelection.epoch;};
      const imageGuard=()=>{const current=businessModelSnapshot();return !signal.aborted&&operation===serial&&state.provider==='api'&&
        current.provider===initialSelection.provider&&current.modelId===initialSelection.modelId&&current.epoch===initialSelection.epoch&&
        typeof imageSessionGuard==='function'&&imageSessionGuard()===true;};
      const imageSourceBinding=context=>JSON.stringify({uploads:context?.uploads,art:context?.art&&{references:context.art.references,result:context.art.result},
        artEditor:context?.artEditor&&{source:context.artEditor.source,layers:context.artEditor.layers},media:context?.media,
        animation:context?.animation,effects:context?.effects,particle:context?.particle,pose:context?.pose,frameEditor:context?.frameEditor},
        (key,value)=>/^(?:dataUrl|imageUrl|previewUrl|blob|file|bytes)$/i.test(key)||typeof value==='string'&&/^data:/i.test(value)?undefined:value);
      const sameImages=(a,b)=>a.length===b.length&&a.every((item,i)=>item.role===b[i].role&&item.dataUrl===b[i].dataUrl);
      const authorizeImages=async ({images})=>{
        if(!imageGuard()||!Array.isArray(images)||!images.length||images.length>3)return false;
        const roleNames={subject:'主体',style:'风格',pose:'姿势',background:'背景',material:'材质',color:'配色',composition:'构图',lighting:'光影',object:'物件',result:'结果',output:'输出',attachment:'附件',reference:'参考图',layout:'布局',asset:'素材',combined:'组合',content:'内容',character:'角色'};
        const candidate=[];let bytes=0;
        for(const item of images){
          const role=item?.role||'reference';
          if(!Object.hasOwn(roleNames,role)||typeof item?.dataUrl!=='string'||item.dataUrl.length>Math.ceil(20*1024*1024/3)*4+64)return false;
          const match=/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(item.dataUrl);
          if(!match||match[1].length%4!==0)return false;
          bytes+=match[1].length/4*3-(match[1].endsWith('==')?2:match[1].endsWith('=')?1:0);
          if(bytes>20*1024*1024)return false;candidate.push({role,dataUrl:item.dataUrl});
        }
        const source=imageSourceBinding(tools.capture());
        if(imageGrants.some(grant=>grant.source===source&&sameImages(grant.images,candidate)))return imageGuard();
        const labels=candidate.map((item,i)=>`第 ${i+1} 张：${roleNames[item.role]}`).join('、');
        if(typeof root.confirm!=='function'||root.confirm(`将上传以下已选图片用于在线规划、报价与分析：${labels}。图片费用按当前策略估算（默认每张 2500 token），并非上限，实际按接口用量结算。确认继续吗？`)!==true)return false;
        if(!imageGuard()||imageSourceBinding(tools.capture())!==source)return false;
        if(!sameImages(candidate,images.map(item=>({role:item.role||'reference',dataUrl:item.dataUrl}))))return false;
        imageGrants.push({source,images:candidate});return true;
      };
      activeFoartBilling=billing;
      if(recordMessage)pushUser(message);
      state.pending=true;state.error='';state.status='正在读取 Foart 工具、素材和当前结果…';state.proposal=null;state.confirmation=null;state.toolTrace=[];notify();
      const previousHistory=copy(state.history),priorTask=state.activeTask;
      const imageReceipt=row=>{
        const outputs=row.outputs?.length?row.outputs:[row],model=row.modelLabel||(row.provider==='gpt'?'GPT Image 2.5':'当前绘图模型');
        const size=Number(row.width)>0&&Number(row.height)>0?'（'+row.width+'×'+row.height+'）':'';
        const action=row.surface==='ui'?(row.editRegions?.length?'完成所选 UI 区域的制作':'完成 UI 制作'):'生成 '+outputs.length+' 张图片';
        return '已用 '+model+' '+action+size+'。'+(row.placedInSource===true?'结果已放到画板。':'')+'\n实际文件：'+outputs.map(r=>r.name).join('、');
      };
      const mediaGenerationReceipt=result=>{
        const outputs=result.resources?.length?result.resources:[{name:result.name||result.resourceId}],video=result.action==='generate_video';
        const tool=video?(result.modeLabel||'视频生成'):result.action==='generate_music'?'音乐生成':'音效生成';
        return '已调用'+tool+'工具，生成 '+outputs.length+(video?' 个新视频。':' 段音频。')+'\n实际文件：'+outputs.map(item=>(item.name||item.id)+(Number(item.seconds)>0?'（'+Number(Number(item.seconds).toFixed(2))+' 秒）':'')).join('、');
      };
      const summarize=rows=>rows.map(row=>row.action==='image_generate'?imageReceipt(row)
        :row.action==='image_optimize'?row.phase==='applied'?'已按当前模型优化并写入提示词':row.message||'已打开原有优化入口，尚未应用结果'
        :row.action==='use_result'?'已将上次真实成图设为修改输入：'+row.name
        :row.action==='media'?row.results.map(r=>r.action?.startsWith('generate_')?mediaGenerationReceipt(r):r.action==='save_mix'?'已将实际混音保存到资源列表：'+r.name+'（'+Number(r.seconds||0).toFixed(2)+' 秒）':r.fileName?'导出完成：'+r.fileName:r.action==='optimize_video_prompt'?'已优化并写入'+r.modeLabel+'提示词':'已执行音视操作：'+({trim:'裁切',split:'分割',move:'移动',rate:'变速',volume:'音量调整',fade:'淡入淡出',duplicate:'复制片段',remove:'移除片段',import_resource:'导入时间轴',save_mix:'保存实际混音资源',select_clip:'选择片段',loops:'片段循环',track_gain:'音轨音量',track_mute:'静音',track_solo:'独奏',clip_transform:'画面变换',clip_visibility:'画面显示',play:'播放',pause:'暂停',seek:'调整播放位置'}[r.action]||r.action)).join('\n')
        :row.action==='tool'?row.operation==='run'?'工具处理结果：'+row.outputs.map(o=>o.name+'（'+o.bytes+' 字节'+(o.keptOriginal?'，原文件更小，已保留原文件':'')+'）').join('、'):row.message
        :row.action==='particle'?row.message
        :row.action==='effect_generate'?row.message||'AI特效生成完成：'+row.outputs.map(o=>o.id+'，'+o.frames+' 帧').join('；')
        :row.action==='effect_export'?row.message
        :row.action==='art_action'?row.fileName?'已发起文件下载：'+row.fileName:row.phase==='completed'?'已完成'+(row.label||row.name)+'，实际结果已更新':row.phase==='returned'?'美工工具已返回：'+row.message:'已打开'+(row.label||row.name)
        :row.action==='open'?row.message:row.action==='set_control'?'已设置'+row.control+'：'+row.value:row.action==='draw'?(row.surface==='animation'?row.message:'已绘制选区'):row.message||'已操作'+row.control).join('\n');
      const onStatus=text=>{state.status=text;notify();};
      const toolBinding=(context,controlIds)=>{
        const mediaActive=!!context.media?.active,audioOnly=mediaActive&&context.media.sub==='audio';
        const videoEditing=mediaEditIntent&&mediaActive&&context.media.sub==='video';
        const media=context.media?.active===false?null:videoEditing?{active:true,sub:'video',video:context.media.video,videoResources:context.media.videoResources,generation:{boardId:context.media.generation?.boardId}}:audioOnly?{active:true,sub:'audio',audio:context.media.audio,audioResources:context.media.audioResources,videoResources:context.media.videoResources,audioSettings:context.media.audioSettings}:context.media;
        return JSON.stringify({art:!mediaActive&&context.art?{...context.art,error:undefined}:null,artEditor:!mediaActive&&context.artEditor?{editingTool:context.artEditor.editingTool,editingAction:context.artEditor.editingAction,objectTransfer:context.artEditor.objectTransfer,source:context.artEditor.source,size:context.artEditor.size,selected:context.artEditor.selected,layers:context.artEditor.layers}:null,media,animation:context.animation?{...context.animation,frame:undefined}:null,uiLayout:context.uiLayout,particle:context.particle,effects:context.effects,productionTools:context.productionTools,lastToolOutput:context.lastToolOutput,pose:context.pose,frameEditor:context.frameEditor,fields:context.controls.filter(c=>!(videoEditing&&c.scope==='video_generation')&&!c.disabled&&['input','textarea','select','checkbox'].includes(c.kind)&&(!controlIds||controlIds.has(c.id))).map(({id,label,section,kind,value})=>({id,label,section,kind,value})).sort((a,b)=>a.id.localeCompare(b.id))});
      };
      try{
        // A community model may suggest one bone from the exact current image.
        // It never receives a native token and cannot commit the selection.
        if(communityModel(state.modelId) && (intent?.surface==='animation'||animationIntent) && /选中|选择|选取|帮我选|\bselect\b/i.test(positiveRequest)) {
          if(!COMMUNITY_SELECTION_VERIFIED)fail('社区模型的骨骼选择尚未开放；当前仅支持只读检查，未改变选区');
          if(preferUploads || /(?:不要|别|无需|不必|不需要|禁止|不想).{0,8}(?:选|select)|怎么|如何|能否|能不能|是否|(?:可以|能).{0,20}(?:吗|么)|[?？]/i.test(message) || /然后|并且|同时|旋转|移动|缩放|关键帧|修改|调整|删除|新建|播放|暂停|导出|生成|写入|撤销|重做/.test(positiveRequest))fail('请单独明确说明要选中的骨骼；此步骤不会修改动画');
          const epoch=selectionEpoch,image=tools.captureCommunitySelectionImage(),snapshot=tools.capture(),animation=snapshot.animation;
          const bones=animation?.bones;
          if(!animation?.active || !animation.loaded || !Array.isArray(bones) || !Number.isSafeInteger(animation.boneCount) || bones.length!==animation.boneCount || !bones.length || new Set(bones.map(b=>b.name)).size!==bones.length || bones.some(b=>typeof b.name!=='string'||!b.name))fail('当前骨骼列表不完整，无法安全选择；请明确骨骼名称');
          if(typeof image?.token!=='string' || !/^data:image\/png;base64,/.test(image?.dataUrl||''))fail('无法取得当前骨骼画板，未选择骨骼');
          activeRequest=root.crypto.randomUUID();activeStartedAt=Date.now();state.status='正在根据当前画板查找骨骼候选…';notify();
          startStatusPolling(operation,activeRequest);
          const response=await api()?.artAgentChat?.({requestId:activeRequest,provider:'local',...selectedModelPayload(state.modelId),mode:'foart',foartAnimationStage:'select_candidate',message:requestMessage,history:[],foartContext:snapshot,images:[{role:'result',dataUrl:image.dataUrl}]});
          stopStatusPolling();if(signal.aborted||operation!==serial||epoch!==selectionEpoch)return false;
          if(!response?.ok)fail(response?.error||'骨骼候选分析未完成');
          if(response.data?.resourcesReleased!==true && response.resourcesReleased!==true)fail('本地规划模型尚未释放资源，未预览选择');
          const candidate=response.data?.selectionCandidate;
          if(!candidate || !['candidate','clarify'].includes(candidate.status) || response.data?.toolPlan)fail('骨骼候选结果无效，未选择骨骼');
          if(candidate.status==='clarify') {
            const content='无法确定要选择的骨骼，请说明具体部位或骨骼名称。未修改作品。';
            state.messages.push({role:'assistant',content});state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content}].slice(-12);state.status='等待补充骨骼信息';return true;
          }
          if(typeof candidate.boneName!=='string'||!bones.some(b=>b.name===candidate.boneName))fail('候选骨骼不在当前完整列表中，未选择骨骼');
          const preview=tools.previewCommunitySelection(candidate.boneName,image.token);
          if(preview?.boneName!==candidate.boneName || typeof preview.token!=='string')fail('原生选择预览无效，未选择骨骼');
          selectionTicket={token:preview.token,boneName:preview.boneName,modelId:state.modelId};
          state.selectionPreview={boneName:preview.boneName,previous:Array.isArray(preview.previous)?preview.previous.slice():[]};
          const content='模型建议选择骨骼：'+preview.boneName+'。请核对画面并点击确认；确认前不会改变选区。';
          state.messages.push({role:'assistant',content});state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content}].slice(-12);state.status='等待确认骨骼选择';return true;
        }
        // A global request must be planned against the requested editor, not
        // the unrelated editor that happened to be open before the user spoke.
        // Otherwise an art attachment can be offered to a skeleton file input.
        const uiRequest=/\bUI\b|UI设计|UI版块|界面设计/i.test(positiveRequest);
        const specialized=/特效|粒子|压缩|去黑|图集|查看器|格式转换|模板制作|风格库/.test(positiveRequest);
        const explicitTools=/(?:工具(?:版块|板块|模块)|(?:PNG|JPG|MP4)\s*压缩|PNG\s*去黑|视频格式转换|图集.{0,8}WebP|Spine\s*查看器)/i.test(positiveRequest);
        const explicitEffects=/AI\s*特效|特效(?:版块|板块|模块).{0,12}(?:材质|视频|风格)/i.test(positiveRequest);
        const explicitParticle=/粒子(?:特效|编辑|系统)|发射器|发射率/.test(positiveRequest);
        const requestedSurface=!intent?.discussion&&!discussionOnly(message)
          ?animationIntent?'animation':explicitTools?'tools':explicitEffects?'effects':explicitParticle?'particle':(!specialized||uiRequest)
            ?intent?.surface==='image'?(uiRequest||intent.revision&&root.NovaFlowUiDesignDrawing?.isActive?.()?'ui':'drawing')
              :['animation','video','audio'].includes(intent?.surface)?intent.surface:null:null:null;
        if(requestedSurface&&!communityModel(state.modelId)&&!operationFoartV3&&typeof tools.open==='function')receipts.push(await tools.open(requestedSurface));
        let planningLimit=10,mixHandoffBudget=false,exportScopeRetries=0,mixRemovalRetries=0,artActionRetries=0,communityInspectionRetries=0;
        const enhancementNames={imageOutpaint:'无限扩图',imageUpscale:'高清放大',objectTransfer:'万物迁移',imageAngleAdjust:'角度调整',poseReference:'姿势参考'};
        const namedEnhancements=Object.keys(enhancementNames).filter(name=>positiveRequest.includes(enhancementNames[name]));
        for(let round=0;round<planningLimit;round++){
          if(signal.aborted||operation!==serial)return false;
          const pending=await tools.settlePending({signal,onStatus});if(pending)receipts.push(pending);
          if(signal.aborted||operation!==serial||billing&&(state.provider!=='api'||state.modelId!==billing.modelId))return false;
          // Reading the current video frame can finish native metadata loading
          // (including its real FPS). Bind the plan after that work settles.
          const hasCurrentImage=receipts.some(row=>row.outputs?.some(output=>output.imageUrl||output.dataUrl||/\.(png|jpe?g|webp)$/i.test(output.name||'')));
          const imageSourceBefore=imageSourceBinding(tools.capture());
          const images=operationFoartV3?[]:await tools.images({requirements:message,preferUploads:preferUploads&&!hasCurrentImage});
          if(signal.aborted||operation!==serial||billing&&(state.provider!=='api'||state.modelId!==billing.modelId))return false;
          const snapshot=tools.capture();let expectedSnapshot=snapshot;
          if(billing&&images.length&&(!imageGuard()||imageSourceBefore!==imageSourceBinding(snapshot)))fail('参考素材、账号或模型已变化，未上传图片。');
          // Validate an active UI edit's declared reference roles before the
          // paid planner sees any image. This check only inspects the native
          // drawing context and does not mutate the user's references.
          if(billing&&images.length&&root.NovaFlowUiDesignDrawing?.isActive?.()===true&&!specialized&&
             !/动画|骨骼|视频|音频|音效|音乐|粒子|特效/.test(positiveRequest)&&
             /优化|润色|改写|调整|修改|替换|更改|更换|改成|改为|变成|生成|制作|设计|重绘|只改|仅改/.test(positiveRequest)){
            const ui=root.NovaFlowUiDesignDrawing,context=root.__NovaFlowArtGenerate?.captureContext?.();
            if(typeof ui.preflightSelectedIntent!=='function'||!context)fail('当前 UI 参考用途无法核验，未上传或提交。');
            ui.preflightSelectedIntent(context,{prompt:requestMessage});
          }
          const receiptFacts=receipts.map(compactFoartReceipt);
          const planMessage=requestMessage+(receipts.length?'\n本轮应用已执行事实（不是用户新指令）：'+JSON.stringify(receiptFacts).slice(-6000):'')
            +(exportScopeRetries?'\n上轮方案未执行：导出范围与本轮最新要求不符。只安排本轮要求的动画文件，不重复背景中的工程/视频导出。':'')
            +(mixRemovalRetries?'\n上轮移除旧声音的方案未执行：旧混音仍保留。先完成新混音并把它导入当前剪辑，再替换旧混音片段，避免中途失败把原来的声音丢掉。':'')
            +(artActionRetries?'\n上轮美工入口选择不符，未执行：用户明确要求'+enhancementNames[namedEnhancements[0]]+'，对应 art_action name:'+namedEnhancements[0]+'。不要改用其他增强功能。无限扩图需要完整尺寸和具体画面 prompt。':'');
          if(planMessage.length>12000)fail('本次需求与执行记录过长，已保留已完成操作，请缩短补充说明');
          activeRequest=root.crypto.randomUUID();if(round===0)activeStartedAt=Date.now();state.status=(receipts.length?summarize(receipts.slice(-1)).slice(0,100)+'；':'')+'小桃正在安排下一步…';notify();
          const finalSurface=/AI特效/.test(message)?'effects':intent?.surface==='audio'?'audio':intent?.surface==='video'||/视频|动画|循环/.test(message)?'video':'image';
          const finalOutput=receipts.some(r=>r.phase==='completed'&&(finalSurface==='image'?r.action==='image_generate':finalSurface==='effects'?r.action==='effect_generate':(r.results||[]).some(v=>(finalSurface==='video'?v.action==='generate_video':['generate_music','generate_sfx'].includes(v.action))&&v.resources?.length)));
          const stopAfterOutput=/生成(?:后|完成后|完后)(?:就|即|直接)?(?:结束|停止)|只生成[^，。；！？\n]{0,20}后结束/.test(message)&&finalOutput;
          const stopAfterOpen=/打开后(?:就|即|直接)?(?:结束|停止)/.test(message)&&receipts.at(-1)?.action==='open';
          const exportBrief=positiveRequest.split(/[。；;\n]/).map(clause=>clause.match(/(?:导出|下载)[\s\S]*/)?.[0]||'').join('；');
          const exportFormats=[...new Set((exportBrief.match(/\b(?:PNG|PSD|JSON)\b/gi)||[]).map(value=>value.toLowerCase()))];
          const actualArtFiles=receipts.filter(r=>r.action==='art_action'&&r.name==='export'&&r.phase==='completed'&&r.fileName);
          const stopAfterArtExport=!!exportBrief&&actualArtFiles.length>0&&!snapshot.artEditor?.editingTool&&(!exportFormats.length||exportFormats.every(format=>actualArtFiles.some(file=>file.fileName.toLowerCase().endsWith('.'+format))))&&!/导出[^。；;\n]{0,60}(?:之后|以后|后再|然后|再(?:把|将|做|改|合并|处理|编辑|打开|切换))/.test(exportBrief);
          const finishNow=!operationFoartV3&&(stopAfterOutput||stopAfterOpen||stopAfterArtExport);
          const terminalFacts=receipts.filter(r=>r.phase==='completed'||r.action==='image_optimize'&&r.phase==='applied');
          const inspected=receipts.some(row=>{const value=row?.inspection;return row?.action==='animation'&&row.operation==='inspect_bones'&&row.phase==='observed'&&value?.name===snapshot.animation?.animation&&value.complete===true&&value.truncated===false&&value.durationAvailable===true&&Number.isFinite(value.durationSeconds)&&Number.isFinite(value.fps)&&Array.isArray(value.bones)&&value.bones.length>0&&value.bones.every(bone=>bone.complete===true);});
          const animationStage=communityModel(state.modelId)&&(intent?.surface==='animation'||animationIntent)&&snapshot.animation?.active?(inspected?'plan':'inspect'):null;
          if(signal.aborted||operation!==serial||billing&&(state.provider!=='api'||state.modelId!==billing.modelId))return false;
          if(!finishNow&&billing){billing.inFlight=true;publishBilling(billing);}
          const plannerSource=imageSourceBinding(snapshot),plannerImages=images.map(item=>({role:item?.role||'reference',dataUrl:item?.dataUrl}));
          const plannerImageGuard=()=>imageGuard()&&imageSourceBinding(tools.capture())===plannerSource&&sameImages(plannerImages,images.map(item=>({role:item?.role||'reference',dataUrl:item?.dataUrl})));
          const responsePromise=finishNow?Promise.resolve({ok:true,data:{toolPlan:{schema:contract.FOART_TOOL_SCHEMA,status:'done',reply:summarize(terminalFacts.length?terminalFacts:receipts),operations:[]}}}):operationFoartV3
            ?foartOperationSession?api()?.foartOperationResume?.({requestId:activeRequest,session:foartOperationSession,previousContext:foartPreviousContext,receipt:receipts.at(-1),context:foartWireContext(snapshot),signal})
              :api()?.foartOperationStart?.({requestId:activeRequest,modelId:state.modelId,...selectedPricingPayload(),...(musicDraftRequested===true?{musicDraftRequested:true}:{}),message:planMessage,history:compactFoartHistory(previousHistory),promptLanguage:'en',foartContext:foartWireContext(snapshot),signal})
            :api()?.artAgentChat?.({requestId:activeRequest,provider:state.provider,...selectedModelPayload(state.modelId),...selectedPricingPayload(),...(communityUploads() ? {uploads:communityUploads()} : {}),...(animationStage?{foartAnimationStage:animationStage}:{}),mode:'foart',promptLanguage:'en',message:planMessage,history:compactFoartHistory(previousHistory),foartContext:snapshot,images,...(billing&&images.length?{confirmImageUpload:authorizeImages,imageSessionGuard:plannerImageGuard}:{})});
          if(!finishNow)startStatusPolling(operation,activeRequest);const response=await responsePromise;stopStatusPolling();
          if(operationFoartV3&&(response?.data?.foartOperationSession||response?.session)){foartOperationSession=response.data?.foartOperationSession||response.session;foartPreviousContext=foartWireContext(snapshot);billing.inFlight=false;billing.unknown=true;publishBilling(billing);}
          else if(!finishNow){if(operationFoartV3&&response?.data?.quota?.status==='settled'){billing.unknown=false;foartOperationSession=null;}collectBilling(billing,response);}
          if(signal.aborted||operation!==serial)return false;
          if(!response?.ok){handlePricingFailure(response);fail(response?.error||'Foart 工具规划未完成');}
          const data=response.data;if(!data?.toolPlan)fail('工具规划服务尚未更新，未提交操作');
          if(!finishNow&&state.provider==='local'&&data.resourcesReleased!==true&&response.resourcesReleased!==true)fail('本地规划模型尚未释放资源，未调用制作工具');
          let plan=contract.validateFoartPlan(data.toolPlan,snapshot);
          if(namedEnhancements.length===1&&plan.operations.some(op=>{const name=op.action==='art_action'?op.name:op.action==='activate_control'?Object.keys(enhancementNames).find(key=>snapshot.controls.find(control=>control.id===op.controlId)?.label===enhancementNames[key]):null;return name&&enhancementNames[name]&&name!==namedEnhancements[0];})){
            if(++artActionRetries>2)fail('方案仍未选择本次要求的'+enhancementNames[namedEnhancements[0]]+'，未执行其他增强功能');
            continue;
          }
          if(plan.operations.some(op=>!contract.foartAnimationExportAllowed(op,message))){
            if(++exportScopeRetries>2)fail('动画导出方案仍不符合本轮要求，未执行额外导出');
            continue;
          }
          const audioRevision=priorTask?.executor==='foart'&&['video','audio'].includes(priorTask.surface)&&/声音|音量|混音|音轨/.test(positiveRequest)&&/改|调|更新|替换|接着|继续/.test(positiveRequest)&&!/删除|移除|清空/.test(positiveRequest);
          const savedMixes=receipts.flatMap(row=>row.results||[]).filter(result=>result.action==='save_mix'&&result.publishedId);
          const importedMix=receipts.some(row=>row.results?.some(result=>result.action==='import_resource'&&savedMixes.some(mix=>mix.publishedId===result.resourceId)));
          if(audioRevision&&!importedMix&&plan.operations.some(op=>op.action==='media'&&op.operation.action==='remove'&&(op.operation.target==='audio'||snapshot.media?.video?.tracks?.some(track=>track.clips?.some(clip=>clip.id===op.operation.clipId&&clip.kind==='audio'))))){
            if(++mixRemovalRetries>2)fail('新混音尚未准备并导入，原有声音片段已保留，未执行提前移除');
            continue;
          }
          const generated=receipts.some(r=>r.phase==='completed'&&(r.action==='image_generate'||(r.results||[]).some(v=>v.action?.startsWith('generate_')&&v.resources?.length)));
          if(generated&&plan.status==='act'&&plan.operations.some(op=>op.action==='image_generate'||op.action==='media'&&op.operation.action.startsWith('generate_'))){
            plan={...plan,operations:plan.operations.filter(op=>!(op.action==='image_generate'||op.action==='media'&&op.operation.action.startsWith('generate_')||op.action==='use_result'))};
            if(!plan.operations.length)plan={...plan,status:'done',reply:'本次生成已有实际结果。'};
          }
          // A model may repeat its previous export instead of closing the turn.
          // Once that native encoder returned a real file, never download it again
          // merely because the planner repeated the same finished operation.
          const latestFile=receipts.findLast(r=>r.action==='art_action'&&r.name==='export'&&r.phase==='completed'&&r.fileName);
          const wantedFormats=[...new Set((requestMessage.split('本次最新要求优先，替换与它冲突的旧描述：').at(-1).replace(/(?:不要|不用|无需|别)(?:导出|保存)?(?:为|成)?\s*(?:PNG|PSD|JSON)\b/gi,'').match(/\b(?:PNG|PSD|JSON)\b/gi)||[]).map(v=>v.toLowerCase()))];
          if(latestFile&&receipts.findLast(r=>['completed','applied','activated'].includes(r.phase))===latestFile&&wantedFormats.length<=1&&plan.status==='act'&&plan.operations.every(op=>op.action==='art_action'&&op.name==='export')&&(!wantedFormats.length||latestFile.fileName.toLowerCase().endsWith('.'+wantedFormats[0])))plan={...plan,status:'done',reply:'文件已由原生工具导出。',operations:[]};
          const generatedVideo=receipts.some(r=>(r.results||[]).some(v=>v.action==='generate_video'&&v.resources?.length));
          if(generatedVideo&&plan.status==='act'&&!/时间轴|剪辑|裁切|分割|截取|导入|变速|淡入|淡出|音轨|视频编辑/.test(requestMessage.split('本次最新要求优先，替换与它冲突的旧描述：').at(-1))){
            plan={...plan,operations:plan.operations.filter(op=>!(op.action==='media'&&op.operation.action==='import_resource'&&op.operation.target==='video'))};
            if(!plan.operations.length)plan={...plan,status:'done',reply:'新视频已生成并显示在视频工具中。'};
          }
          state.model=data.model||state.model;
          if(plan.status!=='act'){
            const actual=summarize(receipts),done=receipts.some(r=>r.phase==='completed');
            if(plan.status==='done'&&!actual)fail('尚无实际工具回执，不能报告制作完成');
            if(plan.status==='done'&&tools.capture().pending?.state==='running')fail('原生制作任务仍在运行，尚不能报告完成');
            if(plan.status==='done'&&receipts.some(r=>r.action==='particle'&&r.phase==='opened')&&!receipts.some(r=>r.outputs?.length))fail('粒子导出仅打开了参数，尚未返回实际文件，未报告导出完成');
            if(plan.status==='done'&&receipts.some(r=>r.action==='image_optimize'&&r.phase==='opened')&&!receipts.some(r=>r.nativePromptApplied))fail('优化入口仅已打开，结果尚未应用，未报告优化完成');
            const artifactRows=receipts.filter(r=>r.phase==='completed'||['image_optimize','animation','art_layer'].includes(r.action)&&r.phase==='applied');
            const meaningfulRows=receipts.filter(r=>r.action==='set_control'||r.action==='draw'||r.action==='pose_select'||r.action==='use_result'||r.message&&!/已操作原生控件；/.test(r.message)&&!['open','activate_control','assign_upload'].includes(r.action));
            const auditRows=artifactRows.length?artifactRows:meaningfulRows.length?[...new Map(meaningfulRows.map(row=>[row.action+'|'+row.control+'|'+String(row.value),row])).values()]:receipts;
            const receiptText=summarize(auditRows).split('\n').filter(text=>text&&!/已操作原生控件；/.test(text)).filter((text,index,all)=>all.indexOf(text)===index).slice(-8).join('\n');
            const knownNames=new Set(receipts.flatMap(r=>[r.name,r.fileName,...(r.outputs||[]).map(v=>v.name),...(r.resources||[]).map(v=>v.name),...(r.results||[]).flatMap(v=>[v.name,v.fileName,...(v.resources||[]).map(w=>w.name)])]).filter(Boolean));
            const mentioned=plan.reply.match(/[^\s，。；：:（）()“”"<>]+\.(?:png|jpe?g|webp|mp4|webm|wav|mp3|psd)/gi)||[];
            const mediaModes=receipts.flatMap(r=>(r.results||[]).map(v=>v.mode).filter(Boolean));
            const hasOutput=receipts.some(r=>r.phase==='completed'&&(['image_generate','art_action','tool','effect_generate','effect_export'].includes(r.action)||r.resources?.length||(r.results||[]).some(v=>v.action?.startsWith('generate_')||v.fileName||v.resources?.length)));
            const claimsOutput=/生成(?:好了|完成|成功)|(?:已经|已)(?:生成|制作完成|完成制作|导出)|制作(?:好了|完成|成功)|导出(?:好了|完成|成功)/.test(plan.reply);
            const contextNames=new Set([...knownNames,...(snapshot.uploads||[]).map(v=>v.name),...(snapshot.media?.videoResources||[]).map(v=>v.name),...(snapshot.media?.audioResources||[]).map(v=>v.name),...(snapshot.media?.generation?.h3References||[]).map(v=>v.name||v.fileName),...(snapshot.media?.generation?.referenceSlots||[]).map(v=>v.name)]);
            const replyMatches=!mentioned.some(name=>!(claimsOutput?knownNames:contextNames).has(name))&&(!claimsOutput||hasOutput)&&(!/首尾帧/.test(plan.reply)||!mediaModes.length||mediaModes.every(mode=>mode==='first_last'))&&!(receipts.some(r=>r.outputs?.some(o=>o.downloadInitiated))&&/已保存|导出完成|已导出/.test(plan.reply));
            const content=communityModel(state.modelId)
              ? ((plan.status==='clarify'&&plan.reply?'模型需要进一步确认：'+plan.reply+'\n\n':!receipts.length?plan.reply+'\n\n':'')+receiptText+(receipts.some(row=>row.phase==='observed')?'\n本次仅作只读检查，未修改作品。':'\n本次未修改作品。')).trim()
              : (receipts.length?(!finishNow&&replyMatches&&plan.reply!==receiptText?plan.reply+'\n\n':'')+receiptText:plan.reply).trim()||actual;
            const quota=billingReceipt(billing);
            const downloads=receipts.flatMap(r=>(r.outputs||[]).map(output=>output.downloadId).filter(Boolean));
            state.messages.push({role:'assistant',content,...(downloads.length?{downloads}:{}),...(quota?{receipt:creditReceipt(quota)}:{})});
            if(quota)clearBillingNotice(billing);
            state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content:content+'\n实际工具回执：'+JSON.stringify(receipts.map(compactFoartReceipt)).slice(-8000)}].slice(-12);state.conversationId='';
            const mediaFacts=receipts.flatMap(r=>r.results||[]),lastMedia=mediaFacts.at(-1),generatedMedia=mediaFacts.findLast(r=>r.action?.startsWith('generate_'));
            const nativeVideoResult=receipts.some(r=>r.resources?.some(v=>/\.(mp4|webm)$/i.test(v.name||'')));
            const openedSurface=receipts.findLast(r=>r.action==='open')?.surface;
            const actualSurface=(receipts.some(r=>r.action==='animation')?'animation':receipts.some(r=>r.action==='particle'||r.particle)?'particle':receipts.some(r=>r.action==='tool')?'tools':receipts.some(r=>r.action==='effect_generate'||r.action==='effect_export')?'effects':lastMedia?(lastMedia.target||(/^generate_(music|sfx)$/.test(lastMedia.action)?'audio':lastMedia.action==='generate_video'?'video':null)):nativeVideoResult?'video':receipts.some(r=>['image_generate','image_optimize','art_action','ui_layout','use_result'].includes(r.action)||r.layers?.length)?'image':null)||({drawing:'image',ui:'image',video:'video',audio:'audio',tools:'tools',effects:'effects',particle:'particle',animation:'animation'}[openedSurface]||null);
            const actualMode=actualSurface==='animation'?(receipts.findLast(r=>r.context?.animation)?.context.animation||'spine'):generatedMedia?.mode||(generatedMedia?.action==='generate_music'?'music':generatedMedia?.action==='generate_sfx'?'sfx':'')||(actualSurface==='image'?receipts.findLast(r=>r.action==='image_generate')?.mode:priorTask?.surface===actualSurface?priorTask?.mode:actualSurface==='audio'?'audio_edit':actualSurface==='video'?'video_edit':'')||'';
            if(receipts.length&&!communityModel(state.modelId))state.activeTask={...(intent?.revision?priorTask:{}),...(ONLINE_AUDIO_ACTION_RELEASE_ENABLED?{lastAction:null,navigationBillingSettled:false,...(operationFoartV3&&quota?.status==='settled'&&receipts.length===1&&receipts[0].action==='open'&&receipts[0].phase==='opened'&&receipts[0].surface==='audio'?{lastAction:'open',navigationBillingSettled:true}:{})}:{}),executor:'foart',surface:actualSurface||intent?.surface||priorTask?.surface||'image',mode:actualMode,baseRequest:intent?.revision?priorTask?.baseRequest||message:message,revisions:intent?.revision?[...(priorTask?.revisions||[]),message].slice(-8):[],status:done?'completed':'applied',outputs:receipts.flatMap(r=>r.outputs?.length?r.outputs:r.resources?.length?r.resources:r.result?.resources?.length?r.result.resources:r.id?[{id:r.id,name:r.name}]:r.results?.flatMap(v=>v.resources||[])||[])};
            state.status=communityModel(state.modelId)&&receipts.length?(plan.status==='clarify'?'等待补充需求；未修改作品':'已只读检查；未修改作品'):plan.status==='clarify'?'等待补充需求':done?'工具执行已完成':receipts.length?'已按实际回执更新':'已回复';state.operation=null;return true;
          }
          if(discussionOnly(requestMessage))fail('本次仅讨论，未授权工具修改');
          const stableControls=new Set(snapshot.controls.filter(c=>!c.volatile).map(c=>c.id));
          const attemptKey=JSON.stringify(plan.operations)+'|'+toolBinding(snapshot,stableControls),attempts=(attemptedPlans.get(attemptKey)||0)+1;attemptedPlans.set(attemptKey,attempts);
          if(attempts>2)fail('当前操作没有改变工具状态，已停止重复执行；请求尚未完成');
          if(selectedPricingPayload().operationFoartGeneralV3!==true&&!/(?:请|帮我|给我|把|将|做|画|让|换|改|生成|制作|开始|执行|设置|优化|调整|导入|导出|分割|复制|删除|移除|播放|暂停|继续|确认|应用|打开|切换|进入|选择|选中|闭合|合并|填充|放大|扩|提取|抠图|拆图|凶悍|需要|压缩|去黑|转换|转成|转为|粒子|发射|贴图|更.{0,8}(?:点|些)|再.{0,8}(?:点|些))|\b(?:make|generate|create|set|change|edit|apply|export|import|play|pause|open|select|merge|fill|compress|convert)\b/i.test(message))fail('本次没有明确的工具操作要求，未执行修改');
          if((forbidsGeneration(message)||/只优化|只修改提示词/.test(message))&&plan.operations.some(op=>['image_generate','effect_generate'].includes(op.action)||op.action==='media'&&op.operation?.action?.startsWith('generate_')))fail('本次未授权生成，未提交任务');
          for(const op of plan.operations){
            if(signal.aborted)fail('Foart 操作已停止');
            const onlineAudioAllowed=ONLINE_AUDIO_ACTION_RELEASE_ENABLED&&musicDraftRequested===true&&operationFoartV3&&decimalCreditsPolicy(currentPricingPolicy()?.config?.xiaotao_online)&&
              currentPricingPolicy()?.config?.xiaotao_online?.operation_foart_audio_music_v3===true&&
              op.action==='media'&&op.operation?.target==='audio'&&op.operation.action==='generate_music';
            if(operationFoartV3 && !(selectedPricingPayload().operationFoartGeneralV3===true||op.action==='open'||onlineAudioAllowed||selectedPricingPayload().operationFoartRotationV3===true&&op.action==='animation'&&['inspect_bones','key_bones'].includes(op.operation)))
              fail('本次操作级计费尚未开放该工具；未执行修改。');
            // Playback clocks move during planning. Keep every editable value
            // guarded, excluding only native clocks unless this plan edits one.
            const current=tools.capture(),currentIds=new Set(current.controls.filter(c=>!c.disabled).map(c=>c.id)),plannedIds=new Set(plan.operations.map(item=>item.controlId).filter(Boolean)),stableIds=new Set(expectedSnapshot.controls.filter(c=>!c.disabled&&currentIds.has(c.id)&&(!c.volatile||plannedIds.has(c.id))).map(c=>c.id));
            if(toolBinding(current,stableIds)!==toolBinding(expectedSnapshot,stableIds)){
              const before=JSON.parse(toolBinding(expectedSnapshot,stableIds)),after=JSON.parse(toolBinding(current,stableIds));
              const changed=(a,b,path='')=>JSON.stringify(a)===JSON.stringify(b)?[]:a&&b&&typeof a==='object'&&typeof b==='object'?[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>changed(a[k],b[k],path?path+'.'+k:k)).slice(0,12):[path];
              root.console?.warn?.('[Foart tools] changed binding fields:',changed(before,after).map(path=>{const index=/^fields\.(\d+)/.exec(path)?.[1];return index===undefined?path:path+' ['+before.fields[index]?.id+' '+before.fields[index]?.label+']';}).join(', '));
              fail('Foart 参数、素材或选区在规划期间变化，未应用旧方案');
            }
            if(op.controlId&&!current.controls.some(c=>c.id===op.controlId))break;
            contract.validateFoartPlan({...plan,operations:[op]},current);
            try {
              await enforceCommunityReadOnly({modelId:state.modelId,op,receipts,inspect:read=>tools.execute(read,{snapshot:current,fingerprint,signal,requirements:requestMessage,onStatus,provider:state.provider})});
            } catch(error) {
              if(!communityModel(state.modelId)||error?.code!=='community-inspection-required'||++communityInspectionRetries>2)throw error;
              const targets=[...new Set(op.keys.map(key=>key.boneName))];
              const rejected={action:'animation',operation:'key_bones',phase:'rejected',name:op.name,message:'写入已拒绝，未修改作品。请先单独调用 inspect_bones 读取当前动画中拟修改的骨骼 '+JSON.stringify(targets)+'；无法确定目标时应向用户澄清。当前仅支持只读检查。'};
              receipts.push(rejected);state.toolTrace.push({name:'foart_animation',result:copy(rejected)});state.status=rejected.message;notify();
              break;
            }
            if(signal.aborted||operation!==serial)fail('Foart 操作已停止');
            root.console?.debug?.('[Foart tools] execute',op.action,op.name||op.operation?.action||op.operation||current.controls.find(control=>control.id===op.controlId)?.label||op.resourceId||'',op.value??'');
            let receipt;
            if(onlineAudioAllowed){
              if(response?.ok!==true||data?.audioDraft!==true||plan.operations.length!==1||foartOperationSession||data?.quota?.status!=='settled'||
                !Number.isFinite(data.quota.settled_credits)||data.quota.settled_credits<0||(data.quota.uncollected_credits!==undefined&&data.quota.uncollected_credits!==0))
                fail('规划费用尚未结算，未提交音频生成');
              const expectedPolicy=currentPricingPolicy()?.version;
              const bound=()=>selectionStillCurrent()&&typeof imageSessionGuard==='function'&&imageSessionGuard()===true&&
                currentPricingPolicy()?.version===expectedPolicy&&Number(currentPricingPolicy()?.expiresAt)>Date.now();
              receipt=await prepareFoartAudio(op,signal,operation,bound,initialSelection,data.quota);
            } else if(operationFoartV3&&selectedPricingPayload().operationFoartGeneralV3!==true&&op.action==='animation'&&op.operation==='key_bones'){
              const observation=receipts.findLast(row=>row?.action==='animation'&&row.operation==='inspect_bones'&&row.phase==='observed');
              if(!observation?.inspection)fail('尚未读取完整骨骼轨道，未修改作品。');
              receipt=await prepareFoartRotation(op,observation.inspection,signal,operation,()=>selectionStillCurrent()&&typeof imageSessionGuard==='function'&&imageSessionGuard()===true);
            } else if(operationFoartV3&&state.provider==='api'&&['image_optimize','image_generate'].includes(op.action)){
              receipt=await plannerDrawingPrompt(op,message);
            } else receipt=await tools.execute(op,{snapshot:current,fingerprint,signal,requirements:requestMessage,optimizerRequirements:message,onStatus,provider:state.provider,modelId:initialSelection.modelId,selectionStillCurrent,...(state.provider==='api'?{onlineBusiness:onlineBusinessUi(state.modelId,authorizeImages)}:{})});
            receipts.push(receipt);
            if(receipt.phase==='review'&&receipt.optimization?.reviewRequired===true){
              if(typeof receipt.prompt!=='string'||typeof receipt.modelPrompt!=='string'||typeof receipt.reviewId!=='string'||!selectionStillCurrent())fail('优化草稿或模型状态无效，未应用。');
              pendingFoartImageReview={id:receipt.reviewId,selection:initialSelection};foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;
              state.proposal={kind:'foart-online-review',surface:'drawing',prompt:receipt.prompt,promptOptimization:{reviewRequired:true}};state.proposalSnapshot=null;state.applied=false;
              const label=receipt.optimization?.modelPromptLanguage==='en'?'英文执行稿':receipt.optimization?.modelPromptLanguage==='zh-CN'?'中文执行稿':'执行稿';
              state.messages.push({role:'assistant',content:'请核对优化草稿；当前未写入或生成。确认后可应用到绘图，生成需另行手动操作。\n\n'+receipt.prompt+'\n\n'+label+'：\n'+receipt.modelPrompt});
              state.status='等待核对草稿';state.error='';return true;
            }
            if(!mixHandoffBudget && receipt.results?.some(result=>result.action==='save_mix'&&result.publishedId)){
              planningLimit+=4;mixHandoffBudget=true;
            }
            expectedSnapshot=tools.capture();
            state.toolTrace.push({name:'foart_'+op.action,result:copy(receipt)});state.status=summarize([receipt]);notify();
            if(onlineAudioAllowed){
              const content=(summarize([receipt])||'音乐任务已完成，请查看音频工作区。')+(receipt.results?.some(result=>result.autoPublicationDeferred===true)?'\n已生成，未自动发布到其他板块或素材库。':''),quota=billingReceipt(billing);
              state.messages.push({role:'assistant',content,...(quota?{receipt:creditReceipt(quota)}:{})});
              state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content}].slice(-12);
              if(quota)clearBillingNotice(billing);state.status='音乐任务已完成';state.error='';return true;
            }
            if(op.action==='art_action'||op.action==='ui_layout'||op.action==='assign_upload'||op.action==='frame_open'||op.action==='media'&&['import_resource','save_mix'].includes(op.operation.action))break;
          }
        }
        fail('本轮已到工具规划步数上限，已完成的操作已保留，请继续说明下一步');
      }catch(error){
        if(billing?.inFlight){billing.inFlight=false;billing.unknown=true;publishBilling(billing);}
        if(operation===serial){state.error=String(error?.message||error);state.status=signal.aborted?'已停止等待；请按工具当前状态确认未结束任务':'工具操作未全部完成';
          if(receipts.length){
            const meaningful=receipts.filter(row=>row.phase==='completed'||row.action==='set_control'||row.action==='draw'||row.action==='ui_layout'||row.action==='image_optimize'&&row.phase==='applied');
            const rows=[...new Map(meaningful.map(row=>[row.action+'|'+row.control+'|'+String(row.value)+'|'+row.id,row])).values()];
            const facts=communityModel(state.modelId)?'已只读检查，未修改作品。':rows.length?summarize(rows.slice(-8)):'已打开工具，但实际修改尚未完成。';
            const downloads=receipts.flatMap(row=>(row.outputs||[]).map(output=>output.downloadId).filter(Boolean));
            state.messages.push({role:'assistant',content:facts,...(downloads.length?{downloads}:{})});state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content:'实际执行事实：'+JSON.stringify(receipts.map(compactFoartReceipt)).slice(-8000)+'\n未完成：'+state.error}].slice(-12);
          }
        }return false;
      }finally{if(operationFoartV3&&foartOperationSession&&typeof api()?.foartOperationCancel==='function'){
        try{const cancelled=await api().foartOperationCancel({session:foartOperationSession});if(cancelled?.billingConfirmed&&cancelled?.data?.quota?.status==='settled'){billing.unknown=false;collectBilling(billing,cancelled);}}
        catch{/* Unknown billed state remains visible for reconciliation. */}}
        if(billing?.inFlight){billing.inFlight=false;billing.unknown=true;publishBilling(billing);}if(activeFoartBilling===billing)activeFoartBilling=null;if(operation===serial){root.NovaFlowAgentExportSession=null;stopStatusPolling();foartAbort=null;activeRequest='';state.pending=false;state.generating=false;state.operation=null;notify();}}
    }
    async function send(message, {includeResult = false, confirmed = false, recordMessage = true} = {}) {
      if (retired) return false;
      if (CHAT_MODELS[state.modelId]?.retired || state.modelId==='legacy-online') {state.error=CHAT_MODELS[state.modelId]?.detail||'该线路已移除';state.status='未提交，不扣积分';notify();return false;}
      if(state.uploading || state.staging)return false;
      if (state.pending || state.generating || state.applying) return false;
      message = String(message || '').trim();
      if(message && state.promptSourceCancelledNotice){state.status=state.status.replace(state.promptSourceCancelledNotice,'').trim();state.promptSourceCancelledNotice='';}
      if (!message) {if ((state.staged || []).length) {state.error = '请先说明这些文件的用途，再发送'; notify();} return false;}
      const explicitResultRequested=includeResult;
      const explicitNewQwenImage=state.modelId==='qwen3.5-9b-heretic' && state.staged.some(item=>item.kind==='image');
      clearSelectionTickets();clearQwenSeek();
      const newConversation=/^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$/.test(message);
      if(newConversation){reset();lastUploads=[];return true;}
      // This is deliberately narrow: the user explicitly asks to optimize the
      // CURRENT drawing prompt AND generate. Other source-choice and compound
      // requests continue through their existing paths.
      const explicitDrawingGeneration=state.provider==='api'&&!confirmed&&!state.confirmation&&!pendingPromptSource&&!forbidsGeneration(message)&&
        /^(?:请|帮我)?\s*(?:先)?优化(?:一下)?(?:当前|页面(?:上|里)?的?)?提示词[，,\s]*(?:然后|并且?|再)(?:帮我|给我)?(?:生成|生图|出图)(?:一张)?(?:图片|图)?[。.!！\s]*$/i.test(message);
      if(explicitDrawingGeneration){const info=activePromptSource();if(!info||info.surface!=='drawing'||!info.pagePrompt.trim()){
        state.error='请先在绘图页面填写当前提示词；本次未提交或扣费。';state.status='未提交';notify();return false;}}
      let promptSelection=!confirmed&&!state.confirmation?preparePromptSource(explicitDrawingGeneration?'优化当前提示词':message,{recordMessage}):null;
      if(promptSelection?.stop)return false;
      if(explicitDrawingGeneration&&promptSelection)promptSelection={...promptSelection,message,generateAfterReview:true};
      if(state.provider==='api' && state.modelId!=='legacy-online' && !currentPricingPolicy()) {
        const selected=state.modelId,operation=serial;await refreshPricingPolicy();
        if(state.modelId!==selected || serial!==operation || state.pending || state.generating || state.applying)return false;
        state.error=state.pricingError || '积分价格已刷新，请确认后重新发送';state.status='未提交，不扣积分';notify();return false;
      }
      if (!modelAvailable(state.modelId)) {state.error = state.modelId==='qwen3.5-9b-heretic' ? (state.qwen35CpuTrialChecked===true?'当前算力节点没有可用的 Qwen3.5 9B 本地服务，未提交任务。':'本地模型设备待检测，请稍后重试；未提交任务。')+CHAT_MODELS[state.modelId].detail : CHAT_MODELS[state.modelId]?.detail || '所选模型尚未接入'; state.status = '未提交，不扣积分'; notify(); return false;}
      if(promptSelection){
        const {info,source,message:original,recordMessage:record}=promptSelection;
        if(info.surface==='video')return prepareSelectedH3TextDraft(original,{recordMessage:record,source});
        if(info.surface==='audio')return rewriteQwenAudioText(original,{surface:'audio'},{recordMessage:record,source,kind:info.kind});
        if(info.surface==='ui'){
          if((state.provider==='api'&&currentPricingPolicy()?.config?.xiaotao_online?.operation_ui_draft_v3!==true)||
            (state.provider!=='api'&&!(state.provider==='local'&&state.modelId==='qwen3.5-9b-heretic'))){state.error='当前所选模型尚不支持 UI 提示词草稿，未提交或扣费。';state.status='未提交';notify();return false;}
          return prepareSelectedUiDraft(original,{recordMessage:record,source});
        }
        if(info.surface==='drawing'){
          if(state.provider==='api')return prepareOnlineCurrentDrawingPrompt(original,{recordMessage:record,source,generateAfterReview:promptSelection.generateAfterReview===true});
          if(state.provider==='local'&&state.modelId==='qwen3.5-9b-heretic')return prepareQwenCurrentDrawingPrompt(original,{recordMessage:record,source});
          state.error='当前所选模型的绘图提示词优化尚未接通，未提交。';state.status='未提交';notify();return false;
        }
      }
      const h3VideoActive=root.NovaFlowAudioStudio?.isOpen?.()===true&&root.NovaFlowAudioStudio?.sub?.()==='video'&&root.NovaFlowAiSequenceGeneration?.capture?.()?.mode==='minimax_h3_local';
      const h3TextRequest=!root.NovaFlowXiaotaoPromptSource&&h3VideoActive&&/(?:提示词|prompt)/i.test(message)&&/(?:优化|润色|整理|改写|完善)/.test(message);
      if(h3TextRequest&&!confirmed) {
        const remainder=message.replace(/(?:不要|不用|无需|别|不)(?:再|直接|自动)?\s*(?:生成|制作|分析|执行|应用|保存|导出|提交)(?:视频|音频|素材)?/g,'');
        if(/生成|制作|分析|观看|识别|收听|试听|执行|应用|保存|导出|提交|删除/.test(remainder)) {
          state.error='此入口只提供视频文字草稿，不能分析素材、修改作品或生成视频；请分别提出其他操作。';state.status='未提交';notify();return false;
        }
        return prepareSelectedH3TextDraft(message,{recordMessage});
      }
      const uiPromptIntent=currentUiPromptIntent(message);
      if(!root.NovaFlowXiaotaoPromptSource&&!confirmed&&root.NovaFlowUiDesignDrawing?.isActive?.()===true&&uiPromptIntent!=='none') {
        if(uiPromptIntent==='compound'){state.error='这条请求同时包含提示词优化和其他操作，请分别提出；本次未提交或扣费。';state.status='未提交';notify();return false;}
        if((state.provider==='api'&&currentPricingPolicy()?.config?.xiaotao_online?.operation_ui_draft_v3!==true)||
          (state.provider!=='api'&&!(state.provider==='local'&&state.modelId==='qwen3.5-9b-heretic'))){state.error='当前所选模型尚不支持 UI 提示词草稿，未提交或扣费。';state.status='未提交';notify();return false;}
        return prepareSelectedUiDraft(message,{recordMessage});
      }
      const communityChatOnly=state.modelId==='qwen3.5-9b-heretic';
      if(pendingLocalPromptOffer&&!confirmed){const offer=pendingLocalPromptOffer;pendingLocalPromptOffer=null;
        if(communityChatOnly&&/^(?:要|是|是的|好|好的|可以|行|嗯|写吧|来吧|直接写|生成吧?)[。.!！\s]*$/.test(message.trim()))return runLocalPromptOffer(offer,message,{recordMessage});}
      // An operation-billed message includes only explicitly selected uploads;
      // an old image is reused only when the user refers back to it.
      const operationUploadScope=state.provider==='api' && selectedPricingPayload().operationBillingV3===true;
      const explicitPreviousImage=/(?:\u521a\u624d|\u521a\u521a|\u4e0a\u4f20|\u4e4b\u524d|\u4e0a\u4e00\u5f20|\u90a3\u5f20|\u8fd9\u5f20).{0,8}(?:\u56fe|\u56fe\u7247|\u7167\u7247)/.test(message);
      const freshInvocationUploads=state.staged.slice();
      const invocationUploads=freshInvocationUploads.length ? freshInvocationUploads : operationUploadScope && !explicitPreviousImage ? [] : lastUploads;
      const promptConversation=!confirmed&&!includeResult&&!invocationUploads.length&&root.NovaFlowXiaotaoPromptSource?.isPromptConversation?.(message)===true;
      const capabilityOnly=!confirmed && !includeResult && !invocationUploads.length && (promptConversation||qwenCapabilityQuestion(message));
      const capabilityHistory=capabilityOnly?copy(state.history):null;
      const promptDiscussion=communityChatOnly&&(qwenPromptDiscussion(message)||qwenNoToolExplanation(message));
      // A specifically requested text-only drawing draft has its own operation;
      // do not run an additional paid general-purpose tool planner beforehand.
      if(!root.NovaFlowXiaotaoPromptSource&&state.provider==='api'&&onlineOperationDecimalConfirmed()&&!confirmed&&!includeResult&&qwenCurrentDrawingPromptIntent(message))
        return prepareOnlineCurrentDrawingPrompt(message,{recordMessage});
      if(!root.NovaFlowXiaotaoPromptSource&&communityChatOnly&&!confirmed&&qwenCurrentDrawingPromptIntent(message))return prepareQwenCurrentDrawingPrompt(message,{recordMessage});
      if (!capabilityOnly && communityUploads()?.some(item=>item.kind!=='image')) {
        state.error='当前本地社区模型暂不支持分析非图片附件，请移除附件后再试';state.status='未提交，不扣积分';notify();return false;
      }
      if (!capabilityOnly && root.NovaFlowFoartToolContract?.foartUnsupportedMediaAnalysis(message,invocationUploads)) {
        state.error='当前小桃模型尚未接入音频或视频内容分析，不能声称已听到或看过；请明确描述要执行的剪辑或生成操作。'; state.status='未提交分析，不扣积分'; notify(); return false;
      }
      if(communityChatOnly && capabilityOnly && !promptConversation) {
        const reply='我可以对话和优化提示词。需要操作软件时，请切换到在线模型。本次只说明能力，没有执行操作。';
        if(recordMessage){pushUser(message);state.history=[...state.history,{role:'user',content:message},{role:'assistant',content:reply}].slice(-12);state.conversationId='';}
        state.messages.push({role:'assistant',content:reply});state.error='';state.status='能力说明，未执行工具操作';notify();return true;
      }
      const qwenAudioDiscussion=(communityChatOnly||state.provider==='api')&&(promptDiscussion||qwenPromptDiscussion(message.replace(/(?:不要|不用|无需|别|不)(?:再|直接|自动)?(?:生成|制作)(?:音频|音效|音乐)?/g,'')));
      const qwenAudioIntent=qwenAudioDiscussion ? uploadApi()?.inferTask?.(message,[],null) : null;
      if(qwenAudioIntent && (qwenAudioIntent.surface==='audio'||qwenAudioIntent.discussion===true&&/音效|音乐|配乐|声音/.test(message)) &&
        /提示词|prompt/i.test(message)&&/优化|改写|整理|润色/.test(message)&&!/(?:不要|不用|无需|别|不必).{0,5}(?:优化|改写|整理|润色)/.test(message))
        return rewriteQwenAudioText(message,qwenAudioIntent,{recordMessage});
      recoverActiveTask();
      const priorAudioNavigation=ONLINE_AUDIO_ACTION_RELEASE_ENABLED&&state.activeTask?.executor==='foart'&&state.activeTask?.surface==='audio'&&state.activeTask?.status==='applied'&&
        state.activeTask?.lastAction==='open'&&state.activeTask?.navigationBillingSettled===true&&Array.isArray(state.activeTask.outputs)&&state.activeTask.outputs.length===0&&
        !visibleBillingNotices().some(row=>row.unknown===true);
      let task=capabilityOnly?{surface:'chat',mode:'chat',discussion:true,named:[]}:uploadApi()?.inferTask?.(message,invocationUploads,priorAudioNavigation?null:state.activeTask);
      // The local model only chats and rewrites prompts; every software
      // operation belongs to an online model.
      if(communityChatOnly && !promptDiscussion && !confirmed && (qwenExplicitSelectedRotation(message) || qwenExplicitSeekFrame(message)!==null || qwenAnimationReadIntent(message) ||
        /(?:骨骼|关节).{0,30}(?:旋转|角度)|(?:旋转|角度).{0,30}(?:骨骼|关节)/.test(message) && /(?:设|改|调整|转到|增加|减少|加|减)/.test(message) ||
        /(?:时间轴|播放头|帧).*(?:跳|移动|移到|定位|转到|切换到)|(?:跳|移动|移到|定位|转到|切换到).*(?:帧|时间轴|播放头)/.test(message))) {
        return offerLocalPrompt(message,{recordMessage});
      }
      // In an open animation editor, short follow-up edit requests may lack
      // an explicit bone or keyframe noun and be classified as chat/video.
      // Route those to the existing planner only; it still must inspect the
      // current project and clarify or validate any proposed operation.
      const activeAnimationIntent=(()=>{try {
        const positive=uploadApi()?.positiveTaskText?.(message) ?? message;
        return !capabilityOnly && state.provider==='local' && root.NovaFlowSkeletonEditor?.active?.()===true && !task?.discussion
          && ['chat','video'].includes(task?.surface || 'chat')
          && !/视频|音频|音效|音乐|图生|文生|首尾帧|多参|镜头|图层|画布|UI设计|特效/i.test(positive)
          && /调整|修改|更改|改变|增加|减少|提高|降低|加快|放慢|快(?:一点|点|一些)|慢(?:一点|点|一些)|(?:再|更).{0,8}(?:一点|一些|点)|让.{1,32}(?:一点|一些|点)|选中|选择|编辑|移动|旋转|缩放|新增|删除|改成/.test(positive);
      } catch {return false;}})();
      if(activeAnimationIntent)task={...task,surface:'animation',mode:'native_edit'};
      // The lightweight community route is text/image discussion only. Keep
      // explicit editor commands closed rather than silently treating them as
      // a completed tool action or falling back to another model.
      if(communityChatOnly && !promptDiscussion && (qwenExplicitWriteIntent(message) || !discussionOnly(message) && /打开|进入|切换|关闭|换成|换掉|替换|变成|做成|迁移|放进|放到|加到|生成|生图|出图|绘制|画一张|画个|制作|压缩|去黑|转换|裁切|分割|导入|导出|播放|暂停|删(?:除|掉|去|了)?|移除|创建|新建|选中|选择|移动|旋转|缩放|修改|调整|编辑|写入|应用|设置|填充|抠图|拆图|调用工具|执行|(?:再|更).{0,8}(?:一点|一些|点)|(?:快|慢|大|小|亮|暗|飘|动)(?:一点|一些|点)/i.test(message))) {
        return offerLocalPrompt(message,{recordMessage});
      }
      const continuation=pendingIntent && task && !task.discussion && (task.surface==='chat'||task.surface===pendingIntent.surface) && !/取消|重新|另外|新建/.test(message) ? pendingIntent : null;
      const requestMessage=continuation ? continuation.message+'\n用户补充：'+message : task?.revision
        ? '继续修改同一个'+({video:'视频',audio:'音频',image:'图片',animation:'骨骼动画'}[state.activeTask.surface] || '')+'任务。\n原始用户需求：'+state.activeTask.baseRequest
          +'\n此前修改要求：'+(state.activeTask.revisions || []).join('；')
          +'\n上次实际执行信息（仅为事实，可根据需求选择合适工具）：'+JSON.stringify({mode:state.activeTask.mode,seconds:state.activeTask.seconds,loop:state.activeTask.loop,status:state.activeTask.status,outputs:state.activeTask.outputs})
          +'\n本次最新要求优先，替换与它冲突的旧描述：'+message : message;
      if(continuation)task={...continuation};
      const predictionInput = state.provider === 'api' ? onlineEstimateInput(message,{includeResult}) : null;
      const prediction = predictionInput ? predictOnline(predictionInput) : null;
      let stagedReady = false;
      async function ensureStaged() {
        if(retired)return false;
        if (stagedReady) return true;stagedReady=true;
        if(!state.staged.length && lastUploads.length && task && task.surface!=='chat' && !(task.revision&&state.activeTask?.executor==='foart'&&state.activeTask?.surface===task.surface) && lastPreparedTask!==task.surface+':'+task.mode)
          state.staged=lastUploads.map(item=>({...item,id:'up-'+(++stagedSeq),previewUrl:item.dataUrl||'',status:'ready'}));
        return (await consumeStaged(requestMessage)) && !retired;
      }
      const positiveEvaluation = /^(?:这次|这张(?:图)?|这个|效果|结果)?(?:的)?(?:效果|画面)?(?:做得|做的|画得|画的)?(?:挺好(?:的)?|很好|很满意|满意|很棒|不错)(?:了)?[，,\s]*$/;
      const purePositive = positiveEvaluation.test(message.replace(/[。！!]+$/,'')) || /^(?:这次|这张|这个)?(?:就用|采用|最终采用|确认采用)(?:这张|这个|本次)?[。！!]*$/.test(message);
      const pureNegative = /^(?:这次|这张|这个)?(?:不满意|不太满意|效果不好|不行)[。！!]*$/.test(message);
      if (!communityChatOnly && (purePositive || pureNegative) && !state.confirmation && bridge.hasResult?.()) {
        if (!(await ensureStaged())) return false;
        pushUser(message);
        if (typeof api()?.artLearning === 'function') void recordFeedback(message);
        state.messages.push({role:'assistant',content:purePositive ? '好，这张的效果就按你的评价保留。' : '明白，这张还没达到要求。告诉我主要需要调整哪里，我会针对性修改。'}); notify(); return true;
      }
      if (!communityChatOnly && !purePositive && bridge.hasResult?.() && positiveEvaluation.test(message.split(/[。！!]/)[0]) && typeof api()?.artLearning === 'function') void recordFeedback(message);
      if (/^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$/.test(message)) {reset(); return true;}
      if (state.confirmation && !confirmed) {
        const choice = samplingChoice(message); if (choice) return confirmSampling(choice);
        if (/^(?:取消|算了|先不做|先不生成|不要生成|只聊天|只聊聊)[。！!]*$/.test(message)) {if (!(await ensureStaged())) return false; pushUser(message); return cancelConfirmation();}
        state.confirmation = null;
      }
      if (communityModel(state.modelId) && confirmed) {state.error='社区模型的修改预览与确认尚未接入，未修改作品';notify();return false;}
      if (communityModel(state.modelId) && task && !task.discussion && task.surface!=='chat' && !root.NovaFlowFoartTools) {state.error='只读工具不可用，未修改作品';notify();return false;}
      const operationTextOnly=state.provider==='api' && selectedPricingPayload().operationBillingV3===true;
      const operationVision=operationTextOnly && selectedPricingPayload().operationVisionBillingV3===true;
      const visionUploads=operationVision && invocationUploads.length>0 && invocationUploads.every(item=>item?.kind==='image');
      const operationOpen=operationTextOnly && selectedPricingPayload().operationFoartOpenV3===true && !confirmed&&!includeResult&&!state.activeTask&&!invocationUploads.length &&
        /^(?:请|帮我|麻烦|先|给我|\s)*(?:打开|进入|切换到)(?:动画|美工|视频|音频|特效|粒子|工具|\s*UI\s*(?:设计)?)(?:模块|板块|页面|编辑器)?(?:后告诉我|然后告诉我|并告诉我|即可|就好|[。！!\s])*$/i.test(message);
      const operationRotation=operationTextOnly && selectedPricingPayload().operationFoartRotationV3===true && !confirmed&&!includeResult&&!invocationUploads.length &&
        task?.surface==='animation'&&!task.discussion&&/(?:旋转|角度)/.test(message)&&/\d+\s*帧/.test(message)&&/[-+]?\d+(?:\.\d+)?\s*(?:度|°)/.test(message)&&
        !/删除|新建|导出|生成|复制|移动|缩放|平移|多个|全部|其他骨骼|撤销|重做/.test(message);
      if(ONLINE_AUDIO_ACTION_RELEASE_ENABLED&&operationTextOnly&&task?.surface==='audio'&&!task.discussion&&
        /(?:生成|制作|创建|合成|generate|create).{0,12}(?:音效|sound effect)|(?:音效|sound effect).{0,12}(?:生成|制作|创建|合成|generate|create)/i.test(message)&&!forbidsGeneration(message)){
        state.error='在线音效生成尚未开放，本次未提交。';state.status='未提交';notify();return false;
      }
      const operationAudio=ONLINE_AUDIO_ACTION_RELEASE_ENABLED&&operationTextOnly&&decimalCreditsPolicy(currentPricingPolicy()?.config?.xiaotao_online)&&
        currentPricingPolicy()?.config?.xiaotao_online?.operation_foart_audio_music_v3===true&&
        !confirmed&&!includeResult&&(!state.activeTask||priorAudioNavigation)&&!invocationUploads.length&&task?.surface==='audio'&&!task.discussion&&
        /(?:生成|制作|创建|合成|generate|create).{0,12}(?:音乐|music)|(?:音乐|music).{0,12}(?:生成|制作|创建|合成|generate|create)/i.test(message)&&!forbidsGeneration(message);
      const operationNeedsTools=confirmed||includeResult||!task||task.surface!=='chat'||task.revision||state.activeTask||(!visionUploads&&invocationUploads.length)||
        /打开|关闭|进入|切换|操作|执行|调用|生成|制作|修改|调整|编辑|删除|导入|导出|保存|播放|暂停|选择|选中|移动|旋转|缩放|画布|图层|时间轴|当前(?:页面|作品|工程|画面|图片|视频)|放(?:进|到|入)|加(?:进|到|入)|作为.{0,4}(?:参考|素材)|参考图|用这|拿这|做成|变成/.test(message);
      const operationGeneral=operationTextOnly&&selectedPricingPayload().operationFoartGeneralV3===true&&!capabilityOnly&&!confirmed&&!includeResult&&!!operationNeedsTools;
      if(operationTextOnly && !capabilityOnly && !operationOpen && !operationRotation && !operationAudio && !operationGeneral && operationNeedsTools) {
        state.error=operationVision?'当前操作级计费仅支持独立的文字和图片聊天；工具、作品上下文及音视频附件尚未接入。':'当前操作级计费仅支持独立的纯文字聊天；工具、作品上下文和附件尚未接入。';state.status='未提交，不扣积分';notify();return false;
      }
      if (!(await ensureStaged())) return false;
      if(operationOpen||operationRotation||operationAudio||operationGeneral){if(!root.NovaFlowFoartTools){state.error='工具尚未就绪，本次未提交。';notify();return false;}
        if(operationRotation&&!operationGeneral){const editor=root.NovaFlowSkeletonEditor?.active?.()&&root.NovaFlowSkeletonEditor.api?.(),animation=editor?.agentContext?.();
          if(!animation?.loaded||!Array.isArray(animation.selectedBones)||animation.selectedBones.length!==1){state.error='请先在动画编辑器中选中唯一目标骨骼，本次未提交。';state.status='未修改作品';notify();return false;}}
        return sendFoart(message,{recordMessage,requestMessage,intent:task,animationIntent:task?.surface==='animation',musicDraftRequested:operationAudio});}
      if(!capabilityOnly && !communityChatOnly && root.NovaFlowFoartTools && !confirmed && ((!operationTextOnly && state.provider==='api') || communityModel(state.modelId)&&task&&!task.discussion&&task.surface!=='chat' || state.activeTask?.executor==='foart'
        || root.NovaFlowUiDesignDrawing?.isActive?.() || task?.surface==='audio' || task?.surface==='animation' && !task.discussion || activeAnimationIntent || task?.surface==='image'&&(root.__NovaFlowArtGenerate?.state?.provider==='gpt'||root.__NovaFlowArtGenerate?.state?.nsfw===true||root.__NovaFlowArtGenerate?.state?.count>1||/批量|[2-9两三四五六七八九十]\s*张/.test(message))
        || /特效|模板|压缩|去黑|图集|查看器|格式转换|抠图|拆图|扩图|放大|画布|蒙版|选区|去除物体|擦除|图层|角度|UI|界面|剪辑|时间轴|裁切|淡入|淡出|音量|变速|帧编辑|色键|音轨|独奏|静音|跨轨|选择.{0,8}片段|移动|复制/.test(message)))return sendFoart(message,{recordMessage,requestMessage,intent:task,animationIntent:activeAnimationIntent});
      const mediaTask=task ? ['video','audio'].includes(task.surface) : root.NovaFlowMediaAgent?.wantsMedia(message);
      if(!communityChatOnly && mediaTask && root.NovaFlowMediaAgent) {
        if(communityModel(state.modelId)){state.error='社区模型当前仅支持只读检查，尚不能执行音视频操作';notify();return false;}
        if(state.provider==='local')root.NovaFlowAudioStudio?.open(task?.surface==='audio'?'audio':'video');
        return sendMedia(message,{recordMessage,requestMessage,intent:task});
      }
      if(!communityChatOnly && task?.surface==='image' && !task.named.length && state.provider==='local') {
        try {if(typeof bridge.openDrawing==='function')await bridge.openDrawing(task.mode || 'txt2img');}
        catch(error){state.error=String(error?.message||error);notify();return false;}
      }
      if (recordMessage) {pushUser(message); recordMessage = false;}
      let execution = communityChatOnly || promptConversation ? null : executionIntent(message);
      if (execution && state.provider !== 'local') {state.error = '本次在线智能请求尚未接入绘图工具，未提交操作。请在 Foart 生图版块使用当前模型。';state.status='未提交工具执行'; notify(); return false;}
      const requestedGeneration = !communityChatOnly && !promptConversation && (samplingRequest(message) || task?.surface==='image' && !task.discussion && !task.named.length);
      const requestedFeedback = !communityChatOnly && state.provider === 'local' && bridge.hasResult?.() && feedbackRequest(message);
      if (!communityChatOnly && state.provider === 'local' && bridge.hasResult?.() && typeof api()?.artLearning === 'function'
        && /不满意|效果不好|画风不对|人物.{0,6}(?:不错|没问题|可以).{0,12}(?:但是|主要|只是)|画风不够|光影不对|上次的画风更准确|调整|修改|改成|太蓝|太黄/.test(message))
        void recordFeedback(message);
      if (state.provider === 'local' && (requestedGeneration || requestedFeedback) && !confirmed) {
        if (recordMessage) {if (!(await ensureStaged())) return false; pushUser(message);}
        try {
          if (!(requestedFeedback && state.samplingApproval && samplingUnchanged(state.samplingApproval))) return askSampling(message,includeResult || requestedFeedback,state.proposal && execution && !execution.fresh ? 'apply' : 'send');
          recordMessage = false;
        }
        catch (error) {state.error = String(error?.message || error); state.status = '参数未确认，未开始分析或生成'; notify(); return false;}
      }
      if (confirmed && (!state.samplingApproval || !samplingUnchanged(state.samplingApproval))) return askSampling(message,includeResult);
      if (confirmed) execution = {generate:true,existingOnly:false,fresh:true};
      if (execution && !execution.fresh && state.proposal) {++serial; activeSnapshot = null; if (recordMessage) {if (!(await ensureStaged())) return false; pushUser(message);} notify(); return apply({generate:execution.generate});}
      if (execution?.existingOnly) {state.error = '当前没有有效的绘图方案。请提供主体与画风双图，再告诉小桃怎样重绘并生成。'; notify(); return false;}
      const page=capabilityOnly?{artContext:{surface:'other'},images:[]}:await bridge.captureChat({includeDrawingReferences:!communityChatOnly}), artRequest=!capabilityOnly&&/提示词|提示框|绘图|生图|出图|重绘|画图|画一|画个|画张|生成|做图|操作软件|控制软件|调用软件|(?:制作|做|画|设计|修改|给我|来).{0,12}(?:图|海报|插画|画面)/.test(message);
      if(retired)return false;
      if(state.provider==='local' && !communityChatOnly && page.artContext.surface==='drawing' && bridge.hasResult?.()) includeResult=true;
      includeResult = chatRequestsCurrentResult(message, includeResult);
      if(communityChatOnly && /参考图|参照图/.test(message) && !qwenCurrentResultIntent(message) && !explicitResultRequested)includeResult=false;
      if(communityChatOnly && qwenCurrentResultIntent(message))includeResult=true;
      const qwenWantsVisual=communityChatOnly && (includeResult || explicitNewQwenImage || qwenVisualIntent(message));
      // A fresh upload does not also authorize sending an old canvas reference.
      const compareReferences=/(?:对比|比较|结合).{0,20}(?:参考|参照)|(?:参考|参照).{0,20}(?:对比|比较|结合)/.test(message);
      const hasPreviousImage=lastUploads.some(item=>item.kind==='image');
      const previousUploadIntent=/(?:上传|发给你|附件)/.test(message) || (hasPreviousImage && /(?:刚才|刚刚|上次|之前|上一张|那张|这张).{0,8}(?:图|图片|照片)/.test(message));
      const drawingReferenceIntent=/参考图|参照图|(?:当前|绘图|画布|槽位).{0,8}参考/.test(message);
      const qwenWantsDrawingReferences=qwenWantsVisual && (compareReferences || (!includeResult && !previousUploadIntent && (!explicitNewQwenImage || /(?:当前|绘图|画布|槽位).{0,8}参考/.test(message))));
      const qwenUsesUploads=qwenWantsVisual && (explicitNewQwenImage || previousUploadIntent || (!includeResult && !drawingReferenceIntent));
      const operation = ++serial; stopped = false; state.error = ''; state.operation = null; state.toolTrace = []; if(!communityChatOnly&&!capabilityOnly)bridge.clearPrepared(); state.proposal = null; state.proposalSnapshot = null; state.applied = false;
      const billing=state.provider==='api'?{id:root.crypto.randomUUID(),modelId:state.modelId,owner:billingOwner(),confirmed:0,confirmedCount:0,quoted:0,allQuoted:true,unknown:false,inFlight:false,recoveryBound:operationTextOnly,decimal:onlineOperationDecimalConfirmed()}:null;activeChatBilling=billing;
      try {
        let snapshot, mode = 'chat';
        if (state.provider === 'local' && !communityChatOnly) {try {
          snapshot = await (bridge.captureAny && (page.artContext.surface==='drawing' || artRequest || execution) ? bridge.captureAny({includeResult}) : bridge.capture({includeResult}));
          mode=snapshot.artContext.task==='creation'?'creation':'drawing';
        } catch (error) {if (includeResult || artRequest || execution) throw error;}}
        if (!snapshot) snapshot = capabilityOnly?{artContext:{},images:[]}:await bridge.captureChat({includeResult,includeDrawingReferences:!communityChatOnly || qwenWantsDrawingReferences});
        if (execution && mode === 'chat') fail('还缺少可执行的绘图上下文，请先打开绘图页面');
        if(retired || operation!==serial)return false;
        activeSnapshot = snapshot; activeMode = mode; state.mode = mode; state.pending = true;
        state.status = includeResult ? '正在查看实际成图…' : state.provider === 'api' ? '小桃正在连接在线智能…' : '正在连接 Foart…';
        lastRequestMessage = message; activeStartedAt = Date.now();
        if (recordMessage) {if (!(await ensureStaged())) return false; pushUser(message);}
        notify();
        const contextFingerprint = mode !== 'chat' ? await fingerprint(snapshot) : undefined; if (operation !== serial || stopped) return false;
        activeRequest = root.crypto.randomUUID();
        let executionApproval;
        if (state.provider === 'local' && mode !== 'chat' && (confirmed || requestedFeedback)) {
          const sampling = bridge.readSampling();
          if (!state.samplingApproval || !sameSnapshot(state.samplingApproval.binding,sampling.binding) || !sameSnapshot(snapshot,recapture(snapshot))) fail('已确认参数或绘图内容已变化，请重新确认后再分析');
          executionApproval = {schema:'nf.art.execution-approval.v1',requestId:activeRequest,contextFingerprint,action:'generate',imageCount:1,
            sampling:{variant:sampling.variant,steps:sampling.steps,cfg:sampling.cfg},basis:confirmed ? 'sampling-confirmation' : 'approved-feedback'};
        }
        const images = [];
        for (const img of snapshot.images || []) {
          const dataUrl = await resolveReferenceDataUrl(img);
          images.push({ dataUrl, referenceIdentity: img.referenceIdentity, name: img.name, role: img.role, source: img.source, ...imageDimensions(img) });
        }
        const requestUploads=operationUploadScope ? invocationUploads : lastUploads;
        if (state.provider === 'api' || mode==='chat') for (const image of chatImagesWithUploads(images, capabilityOnly || communityChatOnly && !qwenUsesUploads ? [] : requestUploads).slice(images.length)) {
          const dataUrl = await resolveReferenceDataUrl(image);
          images.push({dataUrl, role:image.role, source:image.source, name:image.name, ...imageDimensions(image)});
        }
        const uploadOwner=operationVision&&images.length?api()?.captureFoartBillingOwner?.():null;
        const uploadModel=state.modelId;
        const uploadCurrent=()=>operation===serial&&!stopped&&state.provider==='api'&&state.modelId===uploadModel&&typeof uploadOwner?.current==='function'&&uploadOwner.current()===true;
        activeChatHasImages=mode==='chat' && images.length>0;
        const payload = {requestId:activeRequest, provider:state.provider, ...selectedModelPayload(state.modelId), ...selectedPricingPayload(), mode, promptLanguage:mode==='creation'?'zh-CN':'en', conversationId:capabilityOnly?undefined:state.conversationId || undefined, message:requestMessage, history:capabilityOnly&&!promptConversation?[]:copy(state.history), artContext:operationTextOnly?{}:copy(snapshot.artContext), images, ...(state.provider === 'api' ? {uploads:capabilityOnly?[]:requestUploads.map(({kind, name}) => ({kind, name}))} : communityUploads() ? {uploads:qwenUsesUploads ? communityUploads() : []} : {}), ...(contextFingerprint ? {contextFingerprint} : {}), ...(executionApproval ? {executionApproval} : {}),
          ...(operationVision&&images.length?{imageSessionGuard:uploadCurrent,confirmImageUpload:async info=>uploadCurrent()&&await onlineBusinessUi(uploadModel).confirmImageUpload(info)&&uploadCurrent()}:{})};
        if (typeof api()?.artAgentChat !== 'function') fail('小桃AI接口尚未就绪，请刷新官网页面并检查 Foart状态');
        const deviceEpoch=localCapabilityEpoch;
        if(state.provider==='local' && state.modelId==='qwen3.5-9b-heretic')state.qwenExecutionDevice=null;
        if(billing){billing.inFlight=true;publishBilling(billing);}
        const responsePromise = api().artAgentChat(payload); startStatusPolling(operation, activeRequest);
        const response = await responsePromise;
        collectBilling(billing,response);
        if (operation !== serial || stopped) return false;
        if (!response?.ok) {
          // A confirmed pre-dispatch failure must leave the user's new uploads
          // available for correction/retry; an unknown or submitted request is
          // never auto-replayed or treated as unsent.
          if(response?.providerSubmitted===false && freshInvocationUploads.length && operation===serial && !stopped) {
            state.staged=freshInvocationUploads;carryAttachments=null;lastUploads=[];lastPreparedTask='';
          }
          handlePricingFailure(response);
          if (['unknown-conversation', 'flash-agent-unknown-conversation'].includes(response?.errorCode)) {state.conversationId = ''; fail('服务已重启，文字对话已保留。再次发送可重新连接小桃。');}
          fail(response?.error || '小桃暂时未能完成分析，请稍后再试');
        }
        const data = response.data; if (!data || typeof data.reply !== 'string') fail('小桃没有返回完整回复，请重试');
        if (communityModel(state.modelId) && (data.proposal || data.toolPlan || data.mediaPlan || (Array.isArray(data.toolTrace) && data.toolTrace.length))) fail('社区模型仅支持对话，未执行工具操作');
        if(communityChatOnly && communityClaimsToolAccess(data.reply))fail('模型回答包含当前不可用的工具操作能力，未操作软件，请重新提问');
        if(communityChatOnly && /(?:已|已经|完成|成功).{0,24}(?:修改|调整|生成|设置|选中|删(?:除|掉|去|了)?|导出|导入|绘制|写入|应用|执行|处理)|(?:我|小桃).{0,24}删(?:除|掉|去)?[^。！？!?；;\n]{0,12}了|(?:修改|调整|生成|设置|选中|删(?:除|掉|去)?|导出|导入|绘制|写入|应用|执行|处理).{0,8}(?:好了|完成|成功)/.test(data.reply))fail('模型回复包含未经执行的操作声明，未修改作品，请重新提问');
        rememberQwenExecutionDevice(response,deviceEpoch);
        if(data.needsInput){
          state.messages.push({role:'assistant',content:data.reply});state.conversationId=data.conversationId || state.conversationId;
          if(Array.isArray(data.history))state.history=copy(data.history);
          state.toolTrace=copy(data.toolTrace || []);state.model=String(data.model || state.model);state.localSession=null;
          pendingIntent={...(task || {surface:'image',mode:'img2img'}),message:requestMessage};state.confirmation=null;state.samplingApproval=null;state.status='等待补充需求';return true;
        }
        pendingIntent=null;
        if (state.provider === 'api') {
          if (prediction?.credits != null && data.quota) data.quota = {...data.quota,expected_credits:prediction.credits};
          if (data.billingSample) {
            const actualInput = {...predictionInput,files:[...images.map(image=>({kind:'image',...imageDimensions(image)})),...lastUploads.filter(file=>file.kind!=='image')]};
            const next = root.NovaFlowFeatureCreditPrices?.recordXiaotaoOnlineSample?.(actualInput,data.billingSample,metering);
            if (next && next !== metering) {metering = {...next,...(state.modelId!=='legacy-online' && currentPricingPolicy()?{pricingVersion:currentPricingPolicy().version}:{}),updatedAt:Date.now()}; try {root.localStorage?.setItem(pricingKey,JSON.stringify(metering));} catch {}}
          }
        }
        state.learningTask = data.learning || null; state.learningWarning = response.learningWarning || '';
        if (state.provider === 'local') {state.localSession = null; updateLocalSession(data.chatSession);}
        let finalProposal=data.proposal;
        if(mode==='creation' && data.proposal && sameSnapshot(snapshot,recapture(snapshot))) {
          state.conversationId=data.conversationId || state.conversationId;if(Array.isArray(data.history))state.history=copy(data.history);
          if(typeof bridge.optimizeProposal!=='function')fail('原有生图优化入口尚未就绪');
          stopStatusPolling();promptAbort=new root.AbortController();state.status='正在按当前生图模型调用原有优化框架…';notify();
          finalProposal=await bridge.optimizeProposal(copy(data.proposal),snapshot,requestMessage,{signal:promptAbort.signal,onRequest:id=>{activeRequest=id;startStatusPolling(operation,id);},onProgress:text=>{state.status=text;notify();}});
          if(operation!==serial || stopped || promptAbort.signal.aborted)return false;
          promptAbort=null;stopStatusPolling();
          data.toolTrace=[...(data.toolTrace || []),{name:'optimize_generation_prompt',result:finalProposal.promptOptimization}];
          state.promptOptimization=copy(finalProposal.promptOptimization);
        }
        const discussionOnly=/[?？]|吗[。！!]?\s*$|解释|讨论|聊聊|什么意思|为什么|如何|怎么|(?:不要|不用|别|先不|暂不).{0,6}(?:生成|生图|出图|执行|应用)|(?:只|仅).{0,8}(?:提示词|方案|讨论|解释)/.test(message)
          || /(?:给我|提供|输出).{0,12}提示词/.test(message) && !/写入|填入|写到|写进|填进|填到|应用|生成一张|直接生成|生图/.test(message);
        const promptOnly=discussionOnly || !data.proposal?.action || data.proposal.action==='prompt';
        const reply=!communityChatOnly && mode!=='chat' && finalProposal && promptOnly ? data.reply+'\n\n完整提示词：\n```text\n'+finalProposal.prompt+'\n```' : data.reply;
        const settled=billingReceipt(billing),receipt=settled?creditReceipt({...settled,...(prediction?.credits!=null?{expected_credits:prediction.credits}:{})}):'';
        state.messages.push({role:'assistant', content:reply, ...(receipt ? {receipt} : {})});
        // Keep the latest settled amount in the shared, quiet billing line.
        if (!capabilityOnly) state.conversationId = data.conversationId || state.conversationId;
        if (Array.isArray(data.history)) state.history = capabilityOnly?[...capabilityHistory,{role:'user',content:message},{role:'assistant',content:data.reply}].slice(-12):copy(data.history);
        state.toolTrace = Array.isArray(data.toolTrace) ? copy(data.toolTrace) : []; state.model = String(data.proposal?.model || data.model || '本地 Flash');
        const unchanged = mode === 'chat' || sameSnapshot(snapshot, recapture(snapshot));
        if (mode !== 'chat' && finalProposal && unchanged && finalProposal.contextFingerprint === contextFingerprint) {state.proposal = finalProposal===data.proposal?copy(finalProposal):finalProposal; state.proposalSnapshot = snapshot; state.status = '方案已准备，可直接说“按这个方案生成”';}
        else state.status = communityChatOnly ? '已回复' : !unchanged ? '当前绘图已变化，这次回复中的建议未应用' : mode === 'chat' && state.provider === 'local' && snapshot.artContext.surface === 'drawing' ? '已回复 · 当前仅对话，尚未形成可生图双图上下文' : '已回复';
        const action=execution || (!discussionOnly && ['apply','generate'].includes(data.proposal?.action) ? {generate:data.proposal.action==='generate'} : null);
        if (action) {
          state.activeTask={surface:'image',mode:finalProposal?.generationMode || task?.mode || 'txt2img',baseRequest:task?.revision?state.activeTask?.baseRequest || message:message,
            revisions:task?.revision?[...(state.activeTask?.revisions || []),message].slice(-8):[],status:'prepared'};
          if (!state.proposal) {state.error = unchanged ? '本次未取得可执行的绘图方案，尚未生成。' : '绘图内容已变化，本次未生成。'; return false;}
          stopStatusPolling(); state.pending = false;
          const approvedFeedback = includeResult && state.samplingApproval && requestedFeedback;
          if (action.generate && !confirmed && !approvedFeedback) return askSampling('按这个方案生成',includeResult,'apply');
          return await apply({generate:action.generate});
        }
        return true;
      } catch (error) {if(billing?.inFlight){billing.inFlight=false;billing.unknown=true;publishBilling(billing);}if (operation === serial && !stopped) {state.error = String(error?.message || error); state.status = billing?.unknown ? '请求未完成，积分状态待核对' : billing?.confirmedCount ? '回复未完成，已按实际用量结算' : '未提交生成';} return false;}
      finally {if(billing?.inFlight){billing.inFlight=false;billing.unknown=true;publishBilling(billing);}if(activeChatBilling===billing)activeChatBilling=null;if (operation === serial) {stopStatusPolling();promptAbort=null; state.pending = false; state.operation = null; activeRequest = ''; activeSnapshot = null; notify();}}
    }
    // A media review owns a prompt write only; it never starts generation.
    // The bridge independently validates the complete captured workspace.
    let pendingMediaPromptReview=null,mediaPromptUndo=null;
    state.mediaPromptProposal=null;state.mediaPromptCanUndo=false;
    function clearMediaPromptReview(){try{pendingMediaPromptReview?.snapshot?.cancelDraft?.();}catch{}pendingMediaPromptReview=null;mediaPromptUndo=null;state.mediaPromptProposal=null;state.mediaPromptCanUndo=false;}
    function trustedMediaPromptClick(event,action) {
      const owner=event?.view,button=event?.currentTarget,attr=({'apply':'data-novaflow-media-prompt-apply','cancel':'data-novaflow-media-prompt-cancel','undo':'data-novaflow-media-prompt-undo'})[action];
      let trusted=false;try{const getter=Object.getOwnPropertyDescriptor(new owner.MouseEvent('click'),'isTrusted')?.get;trusted=typeof getter==='function'&&getter.call(event)===true;}catch{}
      if(!attr||!owner||owner!==root||owner.document!==root.document||typeof owner.MouseEvent!=='function'||!(event instanceof owner.MouseEvent)||event.type!=='click'||!trusted||
        !button?.isConnected||button.ownerDocument!==owner.document||!button.contains(event.target)||button.getAttribute?.(attr)!=='1'||
        owner.document?.querySelectorAll?.('['+attr+'="1"]').length!==1||owner.navigator?.userActivation?.isActive!==true)
        throw Error('请在草稿界面亲自点击，未修改提示词。');
    }
    async function applyOptimizedMediaPrompt({surface,prompt,snapshot,bindingCurrent}) {
      if(!['video','audio','ui'].includes(surface)||!snapshot||typeof snapshot.applyDraft!=='function'||typeof bindingCurrent!=='function'||bindingCurrent()!==true)
        throw Error('提示词或当前页面已变化，未更新。');
      const result=await snapshot.applyDraft(prompt,{userConfirmed:true,bindingCurrent});
      if(result?.phase!=='applied')throw Error('提示词更新未能确认，请检查当前输入框。');
      pendingMediaPromptReview=null;mediaPromptUndo=null;state.mediaPromptProposal=null;state.mediaPromptCanUndo=false;
    }
    function applyOptimizedDrawingPrompt(receipt,current) {
      const tools=root.NovaFlowFoartTools;
      if(typeof current!=='function'||current()!==true||typeof tools?.confirmImageReview!=='function')throw Error('绘图页面已变化，未更新提示词。');
      const result=tools.confirmImageReview(receipt.reviewId);
      if(result?.phase!=='applied'||result.reviewId!==receipt.reviewId)throw Error('绘图提示词更新未能确认。');
      pendingFoartImageReview=null;foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;state.proposal=null;state.proposalSnapshot=null;state.applied=true;
      const quota=receipt.optimization?.quota;
      if(state.provider==='api'&&quota?.status==='settled'&&creditUnits(quota.settled_credits)!==null)publishBilling({id:'prompt-'+receipt.reviewId,modelId:state.modelId,owner:billingOwner(),confirmed:quota.settled_credits,confirmedCount:1,unknown:false,inFlight:false});
    }
    async function applyMediaPromptReview(event) {
      const review=pendingMediaPromptReview;if(!review||state.pending||state.applying)return false;
      try {trustedMediaPromptClick(event,'apply');if(review.bindingCurrent()!==true)throw Error('账号、模型或页面已变化，未应用。');
        state.applying=true;notify();const result=await review.snapshot.applyDraft(review.prompt,{userConfirmed:true,bindingCurrent:review.bindingCurrent});
        if(result?.phase!=='applied')throw Error('未能确认提示词已应用，请检查页面。');
        pendingMediaPromptReview=null;mediaPromptUndo=review;state.mediaPromptProposal=null;state.mediaPromptCanUndo=true;
        state.error='';state.status='提示词已应用，可撤销；未生成素材。';return true;
      }catch(error){state.error=String(error?.message||error);state.status='提示词未确认应用，请检查页面。';return false;}
      finally{state.applying=false;notify();}
    }
    function cancelMediaPromptReview(event) {
      if(!pendingMediaPromptReview||state.pending||state.applying)return false;
      try{trustedMediaPromptClick(event,'cancel');if(pendingMediaPromptReview.snapshot?.cancelDraft?.()===false)throw Error('草稿取消状态未确认');pendingMediaPromptReview=null;state.mediaPromptProposal=null;state.error='';state.status='已取消应用；已产生的模型费用按回执结算。';notify();return true;}
      catch(error){state.error=String(error?.message||error);notify();return false;}
    }
    async function undoMediaPromptReview(event) {
      const review=mediaPromptUndo;if(!review||state.pending||state.applying)return false;
      try{trustedMediaPromptClick(event,'undo');if(review.bindingCurrent()!==true)throw Error('账号、模型或页面已变化，无法撤销草稿。');
        state.applying=true;notify();const result=await review.snapshot.undoDraft({userConfirmed:true,bindingCurrent:review.bindingCurrent});
        if(result?.phase!=='undone')throw Error('未能确认撤销，请检查页面。');
        mediaPromptUndo=null;state.mediaPromptCanUndo=false;state.error='';state.status='已撤销提示词应用。';return true;
      }catch(error){state.error=String(error?.message||error);return false;}
      finally{state.applying=false;notify();}
    }
    // A node can finish its model probe after the page's initial feature
    // snapshot. Refresh immediately before a local business operation and
    // reject the result if the selected model, account or node changed.
    async function refreshQwenBusinessBeforeUse({requiresImage=false,isInputCurrent=()=>true,signal=null}={}) {
      const service=api(),selected=businessModelSnapshot(),operation=serial;
      const getGuard=service?.captureFoartSessionGuard;
      const guard=typeof getGuard==='function' ? getGuard.call(service) : null;
      if(typeof getGuard==='function' && (typeof guard!=='function'||guard()!==true))return false;
      const runtime=root.NovaFlowWebRuntime,nodeId=runtime?.computeNode?.id || '',getNodeGuard=requiresImage?service?.captureFoartNodeGuard:null;
      const nodeGuard=typeof getNodeGuard==='function'?getNodeGuard.call(service):null;
      if(typeof getNodeGuard==='function' && (typeof nodeGuard!=='function'||nodeGuard()!==true))return false;
      const current=()=>!retired && serial===operation && !signal?.aborted && state.provider===selected.provider && state.modelId===selected.modelId &&
        businessModelEpoch===selected.epoch && (!guard||guard()===true) && (!nodeGuard||nodeGuard()===true) && (runtime?.computeNode?.id || '')===nodeId && isInputCurrent()===true;
      const wait=ms=>new Promise((resolve,reject)=>{let timer;const done=()=>{signal?.removeEventListener('abort',cancel);resolve();},cancel=()=>{root.clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(Error('cancelled'));};if(signal?.aborted)return cancel();timer=root.setTimeout(done,ms);signal?.addEventListener('abort',cancel,{once:true});});
      const boundedRefresh=()=>new Promise((resolve,reject)=>{let finished=false,timer;const finish=(error)=>{if(finished)return;finished=true;root.clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();},cancel=()=>finish(Error('cancelled'));if(signal?.aborted)return cancel();timer=root.setTimeout(()=>finish(Error('capability timeout')),1500);signal?.addEventListener('abort',cancel,{once:true});Promise.resolve().then(()=>service.runtimeFeatures()).then(()=>finish(),finish);});
      state.pending=true;state.status='正在确认本地节点…';notify();
      try {
        const attempts=requiresImage?3:1;
        for(let i=0;i<attempts;i++){
          if(!current())return false;
          let refreshed=false;
          try {if(typeof service?.runtimeFeatures==='function'){if(requiresImage)await boundedRefresh();else await service.runtimeFeatures();}refreshed=true;}catch{}
          if(!current())return false;
          if(refreshed&&service?.qwenBusinessAvailableSync?.()===true&&(!requiresImage||service?.qwen21LocalImageEditAvailableSync?.()===true))return true;
          if(!requiresImage||typeof service?.runtimeFeatures!=='function'||i+1>=attempts)return false;
          await wait(i===0?300:600);
        }
      } catch {/* cancellation or stale context: no model request */}
      finally {if(serial===operation){state.pending=false;notify();}}
      return false;
    }
    // The selected Qwen optimizer supports text or an explicit subject/style
    // pair; confirmation and undo reuse the existing image review path.
    async function prepareSelectedH3TextDraft(message,{recordMessage=true,source}={}) {
      if(pendingMediaPromptReview){state.error='请先应用或取消上一次提示词草稿。';notify();return false;}
      const local=state.provider==='local'&&state.modelId==='qwen3.5-9b-heretic';
      if(local&&!(await refreshQwenBusinessBeforeUse())){state.error='当前本地节点的视频文字优化尚未就绪，未提交。';state.status='未提交';notify();return false;}
      if(local&&api()?.qwen21NativeRewriteV3AvailableSync?.()!==true){state.error='当前本人节点尚未确认支持视频文字优化，请更新算力助手后重试。';state.status='未提交';notify();return false;}
      if(!local&&(state.provider!=='api'||currentPricingPolicy()?.config?.xiaotao_online?.operation_video_rewrite_v3!==true||!policyAllowsOnline(state.modelId))) {
        state.error='当前所选大脑的视频文字草稿尚未开放，未提交或扣费。';state.status='未提交';notify();return false;
      }
      if((state.staged||[]).length||(communityUploads()||[]).length) {state.error='视频草稿仅处理文字，请先移除小桃附件；参考槽仅记录角色，不读取素材。';notify();return false;}
      const capture=root.NovaFlowMediaAgent?.captureH3TextDraft,method=api()?.promptAssistantVideoDraft;
      const selected=businessModelSnapshot(),requestId=root.crypto?.randomUUID?.();
      if(typeof capture!=='function'||(!local&&typeof method!=='function')||(local&&typeof root.__NovaFlowSmartAI?.optimizeForAgent!=='function')||!requestId) {state.error='视频文字草稿接口不可用，未提交或扣费。';notify();return false;}
      const owner=local?null:api()?.captureFoartBillingOwner?.(),sessionGuard=api()?.captureFoartSessionGuard?.();
      if((!local&&owner?.current?.()!==true) || typeof sessionGuard!=='function' || sessionGuard()!==true) {state.error='无法确认当前账号，未提交或扣费。';notify();return false;}
      const policyVersion=local?null:currentPricingPolicy()?.version;
      const abort=new root.AbortController();promptAbort=abort;state.pending=true;state.error='';state.status='正在优化视频提示词…';
      if(recordMessage)pushUser(message);notify();
      let snapshot;
      const bindingCurrent=()=>!abort.signal.aborted&&state.provider===selected.provider&&state.modelId===selected.modelId&&businessModelEpoch===selected.epoch&&
        sessionGuard()===true&&(local||owner.current()===true&&pricingBindingCurrent(policyVersion));
      const current=()=>promptAbort===abort&&bindingCurrent()&&(!source?.workspaceGuard||source.workspaceGuard()===true)&&(!source?.attachmentStillCurrent||source.attachmentStillCurrent()===true)&&(!snapshot||snapshot.isCurrent()===true);
      try {
        const video=root.NovaFlowAiSequenceGeneration?.capture?.(),textOnly=/(?:只|仅).{0,6}(?:文字|文本)|(?:不要|不用|无需|别).{0,6}(?:看|分析).{0,6}(?:图片|首尾帧|参考图)/.test(message);
        const includeReferenceImages=!local&&video?.genType==='first_last'&&!textOnly;
        if(includeReferenceImages&&api()?.onlineVideoVisionAvailableSync?.()!==true)throw Error('首尾帧图片分析尚未通过验收，未上传或扣费；可明确要求只优化文字。');
        snapshot=await capture({requestId,requirements:source?.requirements??message,...(source?{sourcePrompt:source.prompt}:{}),includeReferenceImages});
        if(!current())throw Error('模型或视频上下文已变化，未提交。');
        if(local){
          const context=await root.NovaFlowAiSequenceGeneration?.optimizationContext?.();
          if(!current()||!context||context.mode!==snapshot.request.h3Mode||context.durationSeconds!==snapshot.request.durationSeconds)throw Error('视频模式或页面已变化，未提交。');
          const optimized=await root.__NovaFlowSmartAI.optimizeForAgent({surface:'animation',analysisProvider:'local',assistantSelectionScope:'xiaotao',selectionStillCurrent:current,
            videoContext:context,prompt:snapshot.request.prompt,requirements:snapshot.request.requirements,signal:abort.signal});
          if(!current()||optimized?.analysisBackend!=='qwen-cpu'||optimized?.modelIdentity?.id!=='qwen35-heretic'||optimized.resourcesReleased!==true||optimized.generationReady!==true||typeof optimized.displayPrompt!=='string'||!optimized.displayPrompt.trim())throw Error('本地视频优化结果或资源释放未确认，未应用。');
          await applyOptimizedMediaPrompt({surface:'video',prompt:optimized.displayPrompt,snapshot,bindingCurrent});
          state.messages.push({role:'assistant',content:'视频提示词已优化并更新到输入框。本次依据文字和参考槽信息，未读取素材内容。'});
          state.status='视频提示词已优化并更新。';return true;
        }
        const {onPricingQuote,confirmPricingQuote,confirmImageUpload}=onlineBusinessUi(selected.modelId,includeReferenceImages?()=>typeof root.confirm==='function'&&root.confirm('将上传当前首帧和尾帧图片用于本次视频提示词分析，确认继续？')===true:null,current);
        const result=await method({request:snapshot.request,assistantSelectionScope:'xiaotao',assistantProvider:selected.provider,assistantModelId:selected.modelId,assistantSelectionEpoch:selected.epoch,signal:abort.signal,isInputCurrent:current,onPricingQuote,confirmPricingQuote,...(includeReferenceImages?{confirmImageUpload}:{}),
          onBillingNotice:notice=>notice?.requestId===requestId && recordBusinessBillingNotice(notice,{selection:selected,owner,sessionGuard})});
        if(!current())throw Error('模型或视频上下文已变化，草稿未显示；如已提交请核对账单。');
        if(result?.ok!==true)throw Error(result?.error||'视频草稿未完成，请核对账单。');
        const draft=result.draft;
        if(draft?.status!=='preview-only'||draft.applyAvailable!==false||draft.textOnly!==!includeReferenceImages||typeof draft.displayPrompt!=='string'||typeof draft.modelPrompt!=='string'||draft.h3Mode!==snapshot.request.h3Mode||draft.durationSeconds!==snapshot.request.durationSeconds)throw Error('视频草稿格式无效，未应用。');
        await applyOptimizedMediaPrompt({surface:'video',prompt:draft.displayPrompt,snapshot,bindingCurrent});
        state.messages.push({role:'assistant',content:'视频提示词已优化并更新到输入框。',receipts:[`本次实扣 ${displayCredits(result.quota.settled_credits)} 积分。`]});
        state.status='视频提示词已优化并更新。';return true;
      }catch(error){state.error=String(error?.message||error);state.status='视频草稿未完成，未回填或生成。';return false;}
      finally{if(promptAbort===abort)promptAbort=null;state.pending=false;notify();}
    }
    async function prepareSelectedUiDraft(message,{recordMessage=true,source}={}) {
      if(pendingMediaPromptReview){state.error='请先应用或取消上一次提示词草稿。';notify();return false;}
      const staged=source?.stagedItems||[],rt=root.__NovaFlowArtGenerate,tools=root.NovaFlowFoartTools;
      const pageRefs=Array.from(rt?.references?.()||[]).filter(Boolean);let referenceSource=staged.length?'uploads':'page',replaceExisting=false;
      if(staged.length&&pageRefs.length){
        if(typeof root.prompt!=='function'){state.error='页面与本次上传都有图片，请先选择来源；未上传或扣费。';notify();return false;}
        const answer=root.prompt('页面和本次上传都有图片。请输入“页面”或“上传”；取消则不提交。','');
        if(answer===null){state.status='已取消；未上传或扣费。';notify();return false;}
        if(!['页面','上传'].includes(String(answer).trim())||source?.workspaceGuard?.()!==true||source?.attachmentStillCurrent?.()!==true){state.error='来源无效或页面已变化，未上传或扣费。';notify();return false;}
        referenceSource=String(answer).trim()==='页面'?'page':'uploads';
      }
      if(referenceSource==='uploads'&&(staged.length<1||staged.length>3||staged.some(item=>item.status!=='ready'||item.kind!=='image'||typeof item.previewUrl!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,/.test(item.previewUrl)))){state.error='请选择 1–3 张已就绪图片，未上传或扣费。';notify();return false;}
      if(referenceSource==='uploads'&&pageRefs.length){
        if(typeof root.confirm!=='function'||root.confirm('确认应用草稿时会临时替换页面参考图，并可撤销恢复原图；取消则不提交。')!==true){state.status='已取消；未上传或扣费。';notify();return false;}
        if(source?.workspaceGuard?.()!==true||source?.attachmentStillCurrent?.()!==true){state.error='页面或附件已变化，未上传或扣费。';notify();return false;}
        replaceExisting=true;
      }
      const capture=root.NovaFlowUiDesignDrawing?.captureUiDraftSnapshot,method=api()?.promptAssistantUiDraft;
      const selected=businessModelSnapshot(),requestId=root.crypto?.randomUUID?.();
      const local=selected.provider==='local'&&selected.modelId==='qwen3.5-9b-heretic';
      if(typeof capture!=='function'||typeof method!=='function'||!requestId||(!local&&selected.provider!=='api')){state.error='UI 草稿接口不可用，未提交。';notify();return false;}
      const owner=local?null:api()?.captureFoartBillingOwner?.(),sessionGuard=local?null:api()?.captureFoartSessionGuard?.();
      if(!local && (owner?.current?.()!==true || typeof sessionGuard!=='function' || sessionGuard()!==true)){state.error='无法确认当前账号，未提交或扣费。';notify();return false;}
      const abort=new root.AbortController();promptAbort=abort;state.pending=true;state.error='';state.status='正在优化 UI 提示词…';
      if(recordMessage)pushUser(message);notify();
      let snapshot,referenceTransaction,queued=false;
      const policyVersion=local?null:currentPricingPolicy()?.version;
      const bindingCurrent=()=>!abort.signal.aborted&&state.provider===selected.provider&&state.modelId===selected.modelId&&businessModelEpoch===selected.epoch&&
        (local||sessionGuard()===true&&owner.current()===true&&pricingBindingCurrent(policyVersion));
      const current=()=>promptAbort===abort&&bindingCurrent()&&(!source?.workspaceGuard||source.workspaceGuard()===true)&&(!source?.attachmentStillCurrent||source.attachmentStillCurrent()===true)&&(!snapshot||snapshot.isCurrent()===true);
      try {
        if(referenceSource==='uploads'){
          if(rt?.state?.mode!=='img2img'||typeof tools?.prepareUploadReferenceTransaction!=='function'||typeof root.Image!=='function'||typeof root.prompt!=='function')throw Error('UI 参考图工作区尚未就绪，请重新打开后重试；未上传或扣费。');
          const aliases={'布局':'layout','风格':'style','内容':'content','素材':'asset','综合':'combined','颜色':'color','材质':'material','角色':'character','主体':'subject','参考':'reference'};
          const allowed=new Set(Object.values(aliases)),uploads=[];
          for(const item of staged){
            const answer=root.prompt('请选择图 '+(uploads.length+1)+' 的用途：布局、风格、内容、素材、综合、颜色、材质、角色、主体或参考。取消则不提交。','');
            if(answer===null)throw Error('已取消参考图选择，未上传或扣费。');
            const role=aliases[String(answer).trim()]||String(answer).trim().toLowerCase();
            if(!allowed.has(role)||source.workspaceGuard()!==true||source.attachmentStillCurrent()!==true||!bindingCurrent())throw Error('参考图用途无效或当前状态已变化，未上传或扣费。');
            uploads.push({id:item.id,role,dataUrl:item.previewUrl,name:item.name});
          }
          const decodeImage=dataUrl=>new Promise((resolve,reject)=>{const image=new root.Image();image.onload=()=>resolve({width:image.naturalWidth||image.width,height:image.naturalHeight||image.height});image.onerror=()=>reject(Error('参考图无法解码，未上传或扣费。'));image.src=dataUrl;});
          let committed=false;
          const tx=await tools.prepareUploadReferenceTransaction({runtime:rt,uploads,isProjectCurrent:()=>bindingCurrent()&&source.workspaceGuard()===true&&(committed||source.attachmentStillCurrent()===true),decodeImage,replaceExisting,uiReferenceOnly:true});
          referenceTransaction=Object.freeze({requestReferences:tx.requestReferences,apply(value){const result=tx.apply(value);committed=true;return result;},undo:()=>tx.undo(),isCurrent:()=>tx.isCurrent(),cancel:()=>tx.cancel()});
        }
        snapshot=await capture({requestId,requirements:source?.requirements??message,...(source?{sourcePrompt:source.prompt}:{}),signal:abort.signal,...(referenceTransaction?{referenceTransaction}:{})});
        if(!current())throw Error('模型或 UI 已变化，未提交。');
        const ui=local?{confirmNodeUpload:async info=>current()&&typeof root.confirm==='function'&&root.confirm(`将 ${info.count} 张参考图发送并暂存在自有节点“${info.nodeName}”（${info.nodeIdSuffix}）。该节点不一定是当前电脑。默认约 24 小时后由运行中的节点定期清理；实际时间受节点配置与运行状态影响。确认继续？`)===true&&current()}:onlineBusinessUi(selected.modelId,null,current);
        const result=await method({request:snapshot.request,assistantSelectionScope:'xiaotao',assistantProvider:selected.provider,assistantModelId:selected.modelId,assistantSelectionEpoch:selected.epoch,signal:abort.signal,isInputCurrent:current,...ui,...(!local?{
          onBillingNotice:notice=>notice?.requestId===requestId && recordBusinessBillingNotice(notice,{selection:selected,owner,sessionGuard})}:{})});
        if(!current())throw Error(local?'模型或 UI 已变化，草稿未显示。':'模型或 UI 已变化，草稿未显示；如已提交请核对账单。');
        if(result?.ok!==true)throw Error(result?.error||(local?'UI 草稿未完成，未应用。':'UI 草稿未完成，请核对账单。'));
        const draft=result.draft;if(draft?.status!=='preview-only'||draft.applyAvailable!==false||typeof draft.prompt!=='string'||typeof draft.negativePrompt!=='string')throw Error('UI 草稿格式无效，未应用。');
        if(!Array.isArray(draft.sourceManifest))throw Error('UI 草稿参考角色无效，未应用。');
        await applyOptimizedMediaPrompt({surface:'ui',prompt:Object.freeze({prompt:draft.prompt,negativePrompt:draft.negativePrompt}),snapshot,bindingCurrent});queued=true;
        state.messages.push({role:'assistant',content:'UI 提示词已优化并更新到输入框。'});
        state.status='UI 提示词已优化并更新。';return true;
      } catch(error) {state.error=String(error?.message||error);state.status='UI 草稿未完成，未应用。';return false;}
      finally {if(!queued){try{if(snapshot?.cancelDraft)snapshot.cancelDraft();else referenceTransaction?.cancel?.();}catch{}}if(promptAbort===abort)promptAbort=null;state.pending=false;notify();}
    }
    async function prepareOnlineCurrentDrawingPrompt(message,{recordMessage=true,source,generateAfterReview=false}={}) {
      const tools=root.NovaFlowFoartTools,rt=root.__NovaFlowArtGenerate,client=api();
      const policy=currentPricingPolicy(),terms=policy?.config?.xiaotao_online;
      const pageRefs=Array.from(rt?.references?.()||[]).filter(Boolean),staged=source?.stagedItems||[];
      let referenceSource=staged.length?'uploads':'page';
      if(staged.length&&pageRefs.length){
        if(typeof root.prompt!=='function'){state.error='页面与本次上传都有图片，请明确选择来源；未上传或扣费。';notify();return false;}
        const answer=root.prompt('页面和本次上传都有图片。请输入“页面”使用页面参考，或输入“上传”使用本次上传；取消则不提交。','');
        if(answer===null){state.status='已取消；未上传或扣费。';notify();return false;}
        if(!['页面','上传'].includes(String(answer).trim())||source?.workspaceGuard?.()!==true){state.error='来源无效或页面已变化，请重试；未上传或扣费。';notify();return false;}
        referenceSource=String(answer).trim()==='页面'?'page':'uploads';
      }
      const visual=rt?.state?.mode==='img2img'||staged.length>0;
      if((visual?client?.onlineVisionArtAvailableSync?.()!==true:client?.onlineTextArtAvailableSync?.()!==true)||terms?.operation_art_v3!==true||!onlineOperationDecimalConfirmed()||(visual&&terms?.operation_vision_chat_v3!==true)) {
        state.error=visual?'当前参考图提示词优化尚未开通，未上传或扣费。':'当前在线绘图优化尚未开通，未提交或扣费。';notify();return false;
      }
      if(pendingFoartImageReview){state.error='请先应用或取消上一次绘图草稿。';notify();return false;}
      if(generateAfterReview===true&&(typeof source?.workspaceGuard!=='function'||source.workspaceGuard()!==true||rt?.state?.count!==1)){state.error='请先确认当前绘图工程及单张生成设置；本次未提交或扣费。';notify();return false;}
      const drawingCurrent=()=>{
        try {const context=rt?.captureContext?.();return root.__NovaFlowArtGenerate===rt && context?.generationSurface==='drawing' && context.state===rt?.state && context.state.active===true;}
        catch{return false;}
      };
      if(!drawingCurrent()){state.error='请回到当前绘图页面后再优化提示词，未提交或扣费。';notify();return false;}
      try {rt.capturePrompt?.();} catch {state.error='当前绘图提示词不可读取，未提交或扣费。';notify();return false;}
      if(!drawingCurrent()){state.error='绘图页面已变化，未提交或扣费。';notify();return false;}
      let replacePageReferencesConfirmed=false;
      if(referenceSource==='uploads'&&pageRefs.length){
        let oldRefs;try{oldRefs=tools.captureDrawingReferenceRoles?.();}catch{oldRefs=null;}
        if(!Array.isArray(oldRefs)||oldRefs.length!==pageRefs.length||typeof root.confirm!=='function'){state.error='当前页面参考无法安全核验，未上传或扣费。';notify();return false;}
        if(root.confirm('本次使用上传图片。确认应用草稿时会临时替换页面参考图，并可撤销恢复原图；取消则不提交。')!==true){state.status='已取消；未上传或扣费。';notify();return false;}
        let refsStillCurrent=false;try{refsStillCurrent=JSON.stringify(tools.captureDrawingReferenceRoles?.())===JSON.stringify(oldRefs);}catch{}
        if(!refsStillCurrent||source?.workspaceGuard?.()!==true){state.error='页面参考已变化，请重新选择；未上传或扣费。';notify();return false;}
        replacePageReferencesConfirmed=true;
      }
      if(visual&&rt.state.mode!=='img2img'){state.error='请先在绘图页选择图生图，本次上传保留；未上传或扣费。';notify();return false;}
      if(referenceSource==='uploads'&&(staged.length<1||staged.length>3||staged.some(item=>item.status!=='ready'||item.kind!=='image'||typeof item.previewUrl!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,/.test(item.previewUrl)))){state.error='请确认本次上传为 1–3 张已就绪的图片；未上传或扣费。';notify();return false;}
      if(referenceSource==='page'&&((visual&&(pageRefs.length<1||pageRefs.length>3))||(!visual&&pageRefs.length))){state.error='请在当前图生图页面确认 1–3 张参考图；未上传或扣费。';notify();return false;}
      const selectedPrompt=source?.prompt??rt?.state?.prompt;
      if(!tools?.execute||!rt?.state||typeof selectedPrompt!=='string'||!selectedPrompt.trim()) {
        state.error='请先打开绘图并填写要优化的提示词。';notify();return false;
      }
      if(!['txt2img','img2img'].includes(rt.state.mode)){state.error='当前绘图模式尚不支持提示词优化，未提交或扣费。';notify();return false;}
      if(visual&&(typeof source?.workspaceGuard!=='function'||source.workspaceGuard()!==true)){state.error='当前绘图工程无法核验，未上传或扣费。';notify();return false;}
      const selected=businessModelSnapshot(),sessionGuard=client?.captureFoartSessionGuard?.(),owner=client?.captureFoartBillingOwner?.();
      if(typeof sessionGuard!=='function'||sessionGuard()!==true||owner?.current?.()!==true) {
        state.error='无法确认当前账号会话，未提交或扣费。';notify();return false;
      }
      let referenceRoles;
      if(visual){
        const aliases={'主体':'subject','风格':'style','姿势':'pose','背景':'background','材质':'material','色彩':'color','构图':'composition','光线':'lighting','物件':'object','参考':'reference'};
        const valid=new Set([...Object.values(aliases),'result','output','attachment']);
        let before;try{before=referenceSource==='page'?tools.captureDrawingReferenceRoles?.():staged.map((item,index)=>({index:index+1,id:item.id,role:'auto'}));}catch{before=null;}
        const expectedCount=referenceSource==='page'?pageRefs.length:staged.length;
        if(!Array.isArray(before)||before.length!==expectedCount||before.some((ref,i)=>ref.index!==i+1||typeof (referenceSource==='page'?ref.identity:ref.id)!=='string'||!(referenceSource==='page'?ref.identity:ref.id))) {state.error='无法核验参考图，请重新选择；未上传或扣费。';notify();return false;}
        const referencesCurrent=()=>{try{return referenceSource==='uploads'?source.attachmentStillCurrent?.()===true:JSON.stringify(tools.captureDrawingReferenceRoles?.())===JSON.stringify(before);}catch{return false;}};
        referenceRoles=[];
        for(const ref of before){
          const original=ref.drawingRole??ref.role??'',known=original&&original!=='auto'?original:'';
          let role=known||((expectedCount===1)?'subject':'');
          if(!role){if(typeof root.prompt!=='function'){state.error='请先明确每张参考图的用途；未上传或扣费。';notify();return false;}
            const answer=root.prompt('请选择图 '+ref.index+' 的用途：主体、风格、姿势、背景、材质、色彩、构图、光线、物件或参考。取消则不提交。','');
            if(answer===null){state.status='已取消；未上传或扣费。';notify();return false;}
            role=aliases[String(answer).trim()]||String(answer).trim().toLowerCase();}
          if(!valid.has(role)||!source.workspaceGuard()||state.provider!==selected.provider||state.modelId!==selected.modelId||businessModelEpoch!==selected.epoch||sessionGuard()!==true||owner.current()!==true||!referencesCurrent()){
            state.error='参考图用途无效或当前页面已变化，请重新选择；未上传或扣费。';notify();return false;}
          referenceRoles.push(Object.freeze({index:ref.index,...(referenceSource==='page'?{identity:ref.identity}:{id:ref.id}),role}));
        }
        Object.freeze(referenceRoles);
      }
      const abort=new AbortController();promptAbort=abort;
      const selectionCurrent=()=>!abort.signal.aborted&&state.provider===selected.provider&&state.modelId===selected.modelId&&businessModelEpoch===selected.epoch;
      // The review outlives the in-flight request. Keep its binding valid after
      // promptAbort is cleared, while continuing to enforce model/session/policy.
      const bindingCurrent=()=>drawingCurrent()&&(!source?.workspaceGuard||source.workspaceGuard()===true)&&selectionCurrent()&&sessionGuard()===true&&owner.current()===true&&
        pricingBindingCurrent(policy.version)&&terms.operation_art_v3===true&&(!visual||terms.operation_vision_chat_v3===true)&&terms.billing_scope==='operation'&&decimalCreditsPolicy(terms);
      const current=()=>promptAbort===abort&&bindingCurrent()&&(!source?.attachmentStillCurrent||source.attachmentStillCurrent()===true);
      state.pending=true;state.error='';state.status='正在优化绘图提示词…';if(recordMessage)pushUser(message);notify();
      try {
        const receipt=await tools.execute({action:'image_optimize',prompt:selectedPrompt,generationMode:visual?'img2img':'txt2img'},
          // The exact intent is an operation request, not a visual edit brief.
          {provider:selected.provider,modelId:selected.modelId,requirements:source?.requirements??'',signal:abort.signal,selectionStillCurrent:bindingCurrent,
            ...(visual?{currentDrawingVisionOnly:true,referenceSource,projectStillCurrent:source.workspaceGuard,referenceRoles,...(referenceSource==='uploads'?{uploadReferences:staged.map(({id,previewUrl,name,mimeType,size})=>({id,previewUrl,name,mimeType,size})),attachmentStillCurrent:source.attachmentStillCurrent,...(replacePageReferencesConfirmed?{replacePageReferencesConfirmed:true}:{})}:{})}:{currentDrawingTextOnly:true}),
            onlineBusiness:onlineBusinessUi(selected.modelId,visual?info=>current()&&info?.count===referenceRoles.length:null,current),onStatus:text=>{if(current()){state.status=text;notify();}}});
        const quota=receipt?.optimization?.quota;
        if(!current()||receipt?.phase!=='review'||receipt.optimization?.reviewRequired!==true||typeof receipt.reviewId!=='string'||typeof receipt.prompt!=='string'||typeof receipt.modelPrompt!=='string'||
          quota?.status!=='settled'||creditUnits(quota.settled_credits)===null||(quota.uncollected_credits!==undefined&&quota.uncollected_credits!==0)) {
          if(typeof receipt?.reviewId==='string')tools.cancelImageReview?.(receipt.reviewId);
          throw Error('优化草稿或模型状态无效，未应用。');
        }
        if(generateAfterReview!==true){
          applyOptimizedDrawingPrompt(receipt,current);
          state.messages.push({role:'assistant',content:'绘图提示词已优化并更新到输入框。'});
          state.status='绘图提示词已优化并更新。';return true;
        }
        pendingFoartImageReview={id:receipt.reviewId,selection:selected};foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;
        state.proposal={kind:'foart-online-review',surface:'drawing',prompt:receipt.prompt,generateRequested:generateAfterReview===true&&receipt.generationAvailable===true,promptOptimization:{reviewRequired:true}};state.proposalSnapshot=null;state.applied=false;
        state.messages.push({role:'assistant',content:'请核对本次优化草稿；当前未写入或生成，确认后才应用到绘图。\n\n'+receipt.prompt+'\n\n模型执行稿：\n'+receipt.modelPrompt+
          '\n\n本次实扣 '+displayCredits(quota.settled_credits)+' 积分；取消草稿不会退回已结算的费用。'});
        state.status=generateAfterReview===true&&receipt.generationAvailable===true?'请核对草稿；确认生成将按当前绘图模型另计费':generateAfterReview===true?'当前安全生成入口未就绪，可应用草稿。':'等待核对草稿';return true;
      }catch(error){state.error=String(error?.message||error);state.status='未应用或生成图片；如已提交，请核对账单。';return false;}
      finally{if(promptAbort===abort)promptAbort=null;state.pending=false;notify();}
    }
    // The local brain only chats and writes prompts. An operation request gets
    // the switch notice plus an offer to write the prompt into the drawing box.
    let pendingLocalPromptOffer=null;
    function offerLocalPrompt(message,{recordMessage=true}={}){
      if(recordMessage)pushUser(message);
      const drawing=activePromptSource()?.surface==='drawing'&&!/打开|进入|切换|关闭|跳到|帧|播放|暂停|导出|导入|保存/.test(message);
      pendingLocalPromptOffer=drawing?{message}:null;
      state.messages.push({role:'assistant',content:LOCAL_CHAT_ONLY_NOTICE+(drawing?'\n\n也可以由我按这句话直接写一版提示词填进绘图输入框，你自己点生成。要吗？回复“要”即可。':'')});
      state.error='';state.status=drawing?'等待回复':'未执行操作';notify();return true;
    }
    async function runLocalPromptOffer(offer,message,{recordMessage=true}={}){
      const tools=root.NovaFlowFoartTools,rt=root.__NovaFlowArtGenerate,info=activePromptSource();
      if(recordMessage)pushUser(message);
      const say=text=>{state.messages.push({role:'assistant',content:text});state.error='';state.status='未执行操作';state.pending=false;notify();return false;};
      if(!info||info.surface!=='drawing'||!tools?.execute||!rt?.state)return say('请先打开绘图页面，再让我写提示词。');
      const images=state.staged.filter(item=>item.status==='ready'&&item.kind==='image');
      if(images.length){
        const control=(tools.capture().controls||[]).find(c=>c.kind==='file'&&!c.disabled&&/image/.test(c.accept||'')&&(c.multiple||images.length===1));
        if(!control)return say('当前绘图页没有可放参考图的位置，请先切到图生图再试。');
        tools.setUploads?.(images.map(item=>({kind:item.kind,name:item.name,file:item.file,mimeType:item.mimeType,dataUrl:item.previewUrl})));
        const ids=images.map((_,i)=>'upload-'+i);
        state.pending=true;state.status='正在放入参考图…';notify();
        try{await tools.execute({action:'assign_upload',controlId:control.id,...(ids.length===1?{uploadId:ids[0]}:{uploadIds:ids})},{snapshot:tools.capture(),requirements:offer.message,provider:'local'});}
        catch(error){return say('参考图没有放进去：'+String(error?.message||error));}
        state.staged=state.staged.filter(item=>!images.includes(item));
        for(let i=0;i<30&&Array.from(rt.references?.()||[]).filter(Boolean).length<images.length;i++)await new Promise(r=>root.setTimeout(r,100));
        state.pending=false;notify();
      }
      let workspace;try{workspace=capturePromptWorkspace(activePromptSource());}catch(error){return say('当前绘图页面还没准备好：'+String(error?.message||error));}
      return prepareQwenCurrentDrawingPrompt(offer.message,{recordMessage:false,source:{status:'ready',source:'conversation',prompt:offer.message,requirements:'',...workspace}});
    }
    // Online planner: write the prompt through the billed online drawing
    // optimizer; generation stays with the user.
    async function plannerDrawingPrompt(op,message){
      const info=activePromptSource(),rt=root.__NovaFlowArtGenerate;
      if(!info||info.surface!=='drawing')throw Error('请先打开绘图页面，再优化提示词');
      if(rt?.state?.mode==='img2img'){
        const refs=Array.from(rt.references?.()||[]).filter(Boolean),style=/风格|画风|style/i.test(message);
        refs.forEach((ref,i)=>{if(ref&&!ref.drawingRole)ref.drawingRole=i===0?'subject':style?'style':'reference';});
      }
      let workspace;try{workspace=capturePromptWorkspace(info);}catch(error){throw Error('当前绘图页面还没准备好：'+String(error?.message||error));}
      const prompt=String(op.prompt||'').trim()||info.pagePrompt.trim()||message;
      const ok=await prepareOnlineCurrentDrawingPrompt(message,{recordMessage:false,source:{status:'ready',source:'conversation',prompt,requirements:message,...workspace}});
      state.pending=true;
      if(!ok)throw Error(state.error||'提示词优化未完成');
      return {action:op.action,phase:'applied',prompt:String(rt?.state?.prompt||''),message:'提示词已优化并写入绘图输入框'+(op.action==='image_generate'?'；生成由用户自行点击，未自动提交':'')};
    }
    async function prepareQwenCurrentDrawingPrompt(message,{recordMessage=true,source}={}) {
      const tools=root.NovaFlowFoartTools,rt=root.__NovaFlowArtGenerate;
      if((communityUploads()||[]).length){state.error='此入口只优化当前绘图文字，不分析附件；请先移除附件。';notify();return false;}
      const selectedPrompt=source?.prompt??rt?.state?.prompt;
      if(!tools?.execute||!rt?.state||typeof selectedPrompt!=='string'||!selectedPrompt.trim()) {state.error='请先提供要优化的提示词。';notify();return false;}
      const selected=businessModelSnapshot(),abort=new AbortController();promptAbort=abort;
      const mode=rt.state.mode==='img2img'?'img2img':'txt2img',context=mode==='img2img'?rt.captureContext?.():null;
      const refs=mode==='img2img'?Array.from(rt.references?.()||[]).filter(Boolean):[];
      if(mode==='img2img'&&(refs.length<1||refs.length>3||!Number.isSafeInteger(context?.routeRevision)||!Number.isSafeInteger(context?.referenceRevision))){if(promptAbort===abort)promptAbort=null;state.error='请在当前绘图页选择 1–3 张参考图后重试。';notify();return false;}
      const pagePrompt=rt.state.prompt;
      const selectionCurrent=()=>!abort.signal.aborted&&state.provider===selected.provider&&state.modelId===selected.modelId&&businessModelEpoch===selected.epoch&&(!source?.workspaceGuard||source.workspaceGuard()===true);
      const preflightCurrent=()=>selectionCurrent()&&root.__NovaFlowArtGenerate===rt&&rt.state.mode===mode&&rt.state.prompt===pagePrompt&&(mode!=='img2img'||(rt.captureContext?.()?.routeRevision===context.routeRevision&&rt.captureContext?.()?.referenceRevision===context.referenceRevision));
      if(!(await refreshQwenBusinessBeforeUse({requiresImage:mode==='img2img',isInputCurrent:preflightCurrent,signal:abort.signal}))){if(promptAbort===abort)promptAbort=null;state.error=abort.signal.aborted?'已取消本次提示词优化。':preflightCurrent()?'当前 Qwen 节点的参考图优化暂未就绪，请稍后重试。':'模型、账号、节点或绘图内容已变化，未提交。';notify();return false;}
      const current=()=>promptAbort===abort&&selectionCurrent();
      state.pending=true;state.error='';state.status=mode==='img2img'?'正在用本地 Qwen 根据参考图优化提示词。':'正在用本地 Qwen 优化当前绘图文字。';if(recordMessage)pushUser(message);notify();
      try {
        const receipt=await tools.execute({action:'image_optimize',prompt:selectedPrompt,generationMode:mode},
          {provider:selected.provider,modelId:selected.modelId,requirements:source?.requirements??message,signal:abort.signal,selectionStillCurrent:selectionCurrent,onStatus:text=>{if(current()){state.status=text;notify();}}});
        if(!current()||receipt?.phase!=='review'||receipt.optimization?.reviewRequired!==true||typeof receipt.reviewId!=='string'||typeof receipt.prompt!=='string'||typeof receipt.modelPrompt!=='string')throw Error('本地优化草稿或模型状态无效，未应用。');
        applyOptimizedDrawingPrompt(receipt,current);
        state.messages.push({role:'assistant',content:'绘图提示词已优化并更新到输入框。'});
        state.status='绘图提示词已优化并更新。';return true;
      }catch(error){state.error=String(error?.message||error);state.status='未应用或生成图片。';return false;}
      finally{if(promptAbort===abort)promptAbort=null;state.pending=false;notify();}
    }
    // Text-only audio prompt rewriting uses the existing selected Qwen business
    // route. It never reads audio media or submits an audio generation task.
    async function rewriteQwenAudioText(message,intent,{recordMessage=true,source,kind:sourceKind}={}) {
      if(pendingMediaPromptReview){state.error='请先应用或取消上一次提示词草稿。';notify();return false;}
      if(/(?:听|试听|收听|播放|辨听).{0,16}(?:音频|音效|音乐|声音|录音|音轨|声轨|素材|片段)/.test(message)){state.error='当前只支持文字改写，不能听取或分析音频内容；请直接描述声音。';state.status='未提交分析，不扣积分';notify();return false;}
      if(state.provider==='local'&&!(await refreshQwenBusinessBeforeUse())){state.error='当前所选模型的音频文字改写尚未开通，未提交。';notify();return false;}
      if(state.provider==='api'&&(currentPricingPolicy()?.config?.xiaotao_online?.operation_audio_rewrite_v3!==true||!policyAllowsOnline(state.modelId))){state.error='所选在线模型的音频文字改写尚未开通，未提交或扣费。';notify();return false;}
      if((state.staged||[]).length||(communityUploads()||[]).length){state.error='此次只处理文字，不能读取附件，请移除附件后重试。';notify();return false;}
      const kind=sourceKind||(/音乐|配乐/.test(message)?'music':/音效|声音/.test(message)?'sfx':'');
      if(!kind){state.error='请说明要改写音乐还是音效的文字提示词。';notify();return false;}
      const described=String(message).replace(/(?:请|麻烦|帮我|给我|一下|只|仅|优化|改写|整理|润色|音效|音乐|配乐|声音|提示词|prompt|的|不生成|不要生成|不用生成|不要制作|不制作|[，。,:：\s])/gi,'');
      if(!source?.prompt&&!described){state.error='请写出要改写的声音或音乐描述；不会自动读取素材。';notify();return false;}
      let review=null,input=source?.prompt??message;
      try {if(source){review=source.workspaceSnapshot||root.NovaFlowAudioStudio?.captureTextReview?.(kind);if(!review?.isCurrent?.())throw Error('音频页面已变化，未提交。');input=review.compileInput(source.prompt);}}
      catch(error){state.error=String(error?.message||error);state.status='未提交，不扣积分';notify();return false;}
      const settings=root.NovaFlowAudioStudio?.agentSettings?.(), seconds=Number.isFinite(intent?.seconds)?intent.seconds:settings?.[kind]?.seconds;
      if(!Number.isFinite(seconds)||seconds<(kind==='music'?8:1)||seconds>(kind==='music'?300:30)){state.error='请提供有效的音频时长后再改写文字。';notify();return false;}
      const method=api()?.promptAssistantRewriteAudioPrompt;if(typeof method!=='function'){state.error='音频文字改写尚未接通，未提交。';notify();return false;}
      const selected=businessModelSnapshot(),requestId=root.crypto.randomUUID(),abort=new AbortController();
      const owner=selected.provider==='api'?api()?.captureFoartBillingOwner?.():null,sessionGuard=selected.provider==='api'?api()?.captureFoartSessionGuard?.():null;
      if(selected.provider==='api'&&(owner?.current?.()!==true||typeof sessionGuard!=='function'||sessionGuard()!==true)){state.error='无法确认当前账号，未提交或扣费。';notify();return false;}
      const policyVersion=selected.provider==='api'?currentPricingPolicy()?.version:null;
      promptAbort=abort;state.pending=true;state.error='';state.status='正在优化音频提示词…';
      if(recordMessage)pushUser(message);notify();
      const bindingCurrent=()=>!abort.signal.aborted&&state.provider===selected.provider&&state.modelId===selected.modelId&&businessModelEpoch===selected.epoch&&
        (selected.provider!=='api'||sessionGuard()===true&&owner.current()===true&&pricingBindingCurrent(policyVersion));
      const current=()=>promptAbort===abort&&bindingCurrent()&&(!review||review.isCurrent()===true);
      const cancel=()=>{if(selected.provider==='local')void Promise.resolve(api()?.promptAssistantCancelRequest?.({requestId})).catch(()=>{});};
      abort.signal.addEventListener('abort',cancel,{once:true});
      try{
        const bpm=settings?.music?.bpm;
        if((selected.provider==='api'&&!Number.isSafeInteger(seconds))||(kind==='music'&&bpm!==undefined&&(!Number.isSafeInteger(bpm)||bpm<40||bpm>220)))throw Error('音频参数无效，请检查时长和节拍。');
        const result=await method({requestId,kind,input,...(source?{requirements:source.requirements}:{}),seconds,assistantSelectionScope:'xiaotao',assistantProvider:selected.provider,assistantModelId:selected.modelId,assistantSelectionEpoch:selected.epoch,...(kind==='music'&&bpm!==undefined?{bpm}:{}),...(selected.provider==='api'?{signal:abort.signal,...onlineBusinessUi(selected.modelId,null,current),onBillingNotice:notice=>notice?.requestId===requestId&&recordBusinessBillingNotice(notice,{selection:selected,owner,sessionGuard})}:{})});
        if(!current())throw Error('模型选择已变化或任务已停止，结果未采用。');
        const data=result?.result||result?.data||result,handoff={...result,...data};
        if(result?.ok===false)throw Error(result.error||'音频文字改写失败。');
        if(selected.provider==='local'&&(handoff.analysisBackend!=='qwen-cpu'||handoff.modelIdentity?.id!=='qwen35-heretic'||!['server-model-id','server-weight-path'].includes(handoff.modelIdentity?.verification)||handoff.resourcesReleased!==true||handoff.generationReady!==true))throw Error('本地模型身份或资源释放未确认，结果未采用。');
        if(selected.provider==='api'&&(handoff.analysisBackend!=='runninghub'||handoff.modelIdentity?.id!==selected.modelId))throw Error('在线模型身份未确认，结果未采用，请核对账单。');
        const text=String(data?.prompt||'').trim();if(!text||text.length>4000)throw Error('音频文字改写没有返回有效内容。');
        if(selected.provider==='api'&&(data.quota?.status!=='settled'||creditUnits(data.quota.settled_credits)===null||(data.quota.uncollected_credits||0)>0))throw Error('账单状态未确认，请勿重复提交。');
        if(review)await applyOptimizedMediaPrompt({surface:'audio',prompt:text,snapshot:review,bindingCurrent});
        state.messages.push({role:'assistant',content:review?'音频提示词已优化并更新到输入框。':'音频提示词已优化：\n'+text,...(selected.provider==='api'?{receipts:['本次实扣 '+displayCredits(data.quota.settled_credits)+' 积分。']}:{})});
        state.status=review?'音频提示词已优化并更新。':'音频提示词已优化。';return true;
      }catch(error){state.error=String(error?.message||error);state.status='文字改写未完成，未生成音频。';return false;}
      finally{abort.signal.removeEventListener('abort',cancel);if(promptAbort===abort)promptAbort=null;state.pending=false;notify();}
    }
    // Explicit user actions over one staged image. They never change the work
    // or silently substitute a paid/other model.
    async function analyzeStagedImage(kind) {
      if (!['reverse','style'].includes(kind) || state.pending || state.generating || state.applying || state.uploading || state.staging) return false;
      if (!(await refreshQwenBusinessBeforeUse())) {state.error='本地图片分析节点尚未就绪，未提交请求。';notify();return false;}
      if (state.provider!=='local' || state.modelId!=='qwen3.5-9b-heretic') {state.error='此操作暂只支持本地 Qwen 免费模型；未切换模型或扣费。';notify();return false;}
      if (api()?.qwenBusinessImageAvailableSync?.()!==true) {state.error='当前 Qwen 业务试用仅支持文字，图片反推和画风分析尚未开放；本次未提交。';notify();return false;}
      if (state.staged.length!==1 || state.staged[0]?.status!=='ready' || state.staged[0]?.kind!=='image' || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(state.staged[0]?.previewUrl || '')) {
        state.error='请先上传一张要分析的图片；不会自动读取其他图片。';notify();return false;
      }
      const item=state.staged[0], image={name:item.name || 'image.png',dataUrl:item.previewUrl}, selected=businessModelSnapshot();
      const method=kind==='reverse' ? api()?.promptAssistantReverseImagePrompt : api()?.promptAssistantDescribeArtStyle;
      if(typeof method!=='function'){state.error='图片分析功能尚未接通，未提交请求。';notify();return false;}
      const requestId=root.crypto.randomUUID(), abort=new AbortController();promptAbort=abort;state.pending=true;state.error='';state.status='正在用本地免费模型分析上传图片。';
      state.messages.push({role:'user',content:kind==='reverse'?'请反推这张上传图片的提示词。':'请分析这张上传图片的画风。'});notify();
      const cancel=()=>{void Promise.resolve(api()?.promptAssistantCancelRequest?.({requestId})).catch(()=>{});};abort.signal.addEventListener('abort',cancel,{once:true});
      try {
        const payload=kind==='reverse' ? {requestId,assistantSelectionScope:'xiaotao',images:[image],requirements:'描述图片内容，整理为提示词。'} : {requestId,assistantSelectionScope:'xiaotao',...image};
        const result=await method(payload);if(abort.signal.aborted)throw Error('已停止等待，未写入作品。');
        if(state.modelId!==selected.modelId || state.provider!==selected.provider || businessModelEpoch!==selected.epoch)throw Error('模型选择已变化，结果未采用。');
        const data=result?.data || result, handoff={...result,...data};
        if(result?.ok===false)throw Error(result.error || '图片分析失败，未修改作品。');
        if(handoff.analysisBackend!=='qwen-cpu' || handoff.modelIdentity?.id!=='qwen35-heretic' || !['server-model-id','server-weight-path'].includes(handoff.modelIdentity?.verification) || handoff.resourcesReleased!==true || handoff.generationReady!==true)throw Error('本地模型的身份或资源释放未确认，结果未采用。');
        const text=kind==='reverse' ? String(data?.positivePrompt || data?.prompt || '').trim() : String(result?.style || data?.style || '').trim();
        if(!text)throw Error('图片分析没有返回内容，未修改作品。');
        state.messages.push({role:'assistant',content:(kind==='reverse'?'图片反推提示词：\n':'图片画风分析：\n')+text});state.status='分析完成；本地模型免费，未修改作品。';return true;
      } catch(error) {state.error=String(error?.message || error);state.status='图片分析未完成；未修改作品。';return false;}
      finally {abort.signal.removeEventListener('abort',cancel);if(promptAbort===abort)promptAbort=null;state.pending=false;notify();}
    }
    let businessModelEpoch=0; const businessModelListeners=new Set();
    function businessModelSnapshot(){return Object.freeze({provider:state.provider,modelId:state.modelId,epoch:businessModelEpoch});}
    function subscribeBusinessModel(listener){if(typeof listener!=='function')throw Error('invalid listener');businessModelListeners.add(listener);return ()=>businessModelListeners.delete(listener);}
    async function stop() {
      if(foartAbort){clearQwenSeek();if(activeFoartBilling?.inFlight)publishBilling(activeFoartBilling);foartAbort.abort();state.status='正在停止本次工具等待…';const requestId=activeRequest;if(requestId)await api()?.artAgentStop?.({requestId,provider:state.provider});notify();return;}
      if(promptAbort) {state.status='正在停止本次提示词优化…';promptAbort.abort();notify();return;}
      if(mediaAbort) {state.status='正在停止本次音视任务…';mediaAbort.abort();notify();return;}
      if(selectionTicket)return cancelCommunitySelection();
      if (state.confirmation && !state.pending && !state.generating) return cancelConfirmation();
      if (state.generating) {state.status = '正在停止生成…'; notify(); await bridge.cancelGeneration(); return;}
      if (!state.pending || stopped) return;
      stopped = true; stopStatusPolling(); const requestId = activeRequest; if(activeChatBilling?.inFlight)publishBilling(activeChatBilling);state.localSession = null; state.status = state.provider === 'api' ? '正在停止等待在线回复…' : '正在停止小桃…'; notify();
      try {if (requestId) {const result = await api()?.artAgentStop?.({requestId,provider:state.provider}); if (!result?.ok) fail(result?.error || '停止尚未确认，请等待当前任务退出');} ++serial; state.pending = false; activeRequest = ''; activeSnapshot = null; state.status = state.provider === 'api' ? '已停止等待本次回复；结算状态待核对，请勿重复提交' : '已停止';}
      catch (error) {state.error = String(error?.message || error); state.status = '停止尚未确认';}
      notify();
    }
    function cancelFoartImageReview(){
      const review=pendingFoartImageReview;if(!review||state.pending||state.applying||state.generating)return false;
      if(root.NovaFlowFoartTools?.cancelImageReview?.(review.id)!==true){state.error='审核取消未确认，请重新打开绘图界面核对。';notify();return false;}
      pendingFoartImageReview=null;
      state.proposal=null;state.proposalSnapshot=null;state.applied=false;state.error='';state.status='已取消审核，未写入绘图。';notify();return true;
    }
    function undoFoartImageReview(){
      const undo=foartImageReviewUndo,tools=root.NovaFlowFoartTools;
      if(!undo||state.pending||state.applying||state.generating||typeof tools?.undoImageReview!=='function')return false;
      try{
        const result=tools.undoImageReview(undo.id);if(result?.phase!=='undone'||result.reviewId!==undo.id)fail('撤销结果未确认。');
        foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;state.proposal=null;state.applied=false;
        state.error=String(result.warning||'');state.status='已撤销本次审核稿应用。';notify();return true;
      }catch(error){foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;state.error=String(error?.message||error);state.status=error?.code==='foart-review-state-uncertain'?'撤销状态待核对':'未撤销，当前内容保持不变。';notify();return false;}
    }
    async function apply({generate = false,event = null} = {}) {
      if (CHAT_MODELS[state.modelId]?.retired) return false;
      if (!state.proposal || state.pending || state.generating || state.applying || state.uploading) return false;
      if(state.proposal.kind==='foart-online-review'){
        if(generate&&state.proposal.generateRequested!==true){state.error='当前草稿只用于优化，未提交生成。';notify();return false;}
        const review=pendingFoartImageReview,actual=businessModelSnapshot(),tools=root.NovaFlowFoartTools;
        if(!review||state.applied||review.selection.provider!==actual.provider||review.selection.modelId!==actual.modelId||review.selection.epoch!==actual.epoch||typeof tools?.confirmImageReview!=='function'){
          state.error='审核稿或模型选择已失效，请重新优化。';notify();return false;
        }
        state.applying=true;state.error='';notify();
        try{
          if(generate){
            state.generating=true;notify();
            const generated=await tools.confirmImageReviewAndGenerate(review.id,event);
            if(generated?.phase==='cancelled-before-dispatch'&&generated.reviewId===review.id){
              pendingFoartImageReview=null;foartImageReviewUndo={id:review.id};state.foartImageReviewCanUndo=true;state.applied=true;
              state.error='';state.status='已取消生图，未提交；提示词草稿已应用，可撤销。';return false;
            }
            if(generated?.phase==='applied-not-started'&&generated.reviewId===review.id){
              pendingFoartImageReview=null;foartImageReviewUndo={id:review.id};state.foartImageReviewCanUndo=true;state.applied=true;
              state.error='当前页面或账号已变化；生成未开始，请核对已应用的草稿。';state.status='草稿已应用，未开始生成';return false;
            }
            pendingFoartImageReview=null;foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;state.proposal=null;
            if(['completed','completed-not-placed'].includes(generated?.phase)&&generated.reviewId===review.id){const placed=generated.phase==='completed';state.messages.push({role:'assistant',content:placed?'图片已由原绘图工具生成。':'图片已生成，但未写入画布；请查看绘图结果列表。',imageUrl:generated.imageUrl,name:generated.name});state.status=placed?'已生成':'图片已生成，未写入画布';return placed;}
            state.error='生成状态待核对，请查看绘图任务和账单，勿重复发送。';state.status='生成状态待核对';return false;
          }
          const result=tools.confirmImageReview(review.id);
          if(result?.phase!=='applied'||result.reviewId!==review.id)fail('审核稿应用未确认。');
          pendingFoartImageReview=null;foartImageReviewUndo={id:review.id};state.foartImageReviewCanUndo=true;state.applied=true;
          state.status=result.surface==='ui'?'已暂存下次 UI 生成方案，尚未生成；可撤销暂存。':'已应用审核稿，尚未生成；可撤销本次应用。';return true;
        }catch(error){state.error=String(error?.message||error);state.status=error?.code==='foart-review-state-uncertain'?'审核状态待核对':'审核稿未应用';return false;}
        finally{state.generating=false;state.applying=false;notify();}
      }
      if (communityModel(state.modelId)) {state.error='社区模型当前仅支持只读，尚不能应用或生成；未修改作品';notify();return false;}
      if (generate) {
        try {if (!state.samplingApproval || !samplingUnchanged(state.samplingApproval)) {state.samplingApproval = null; return askSampling('按这个方案生成',state.proposalSnapshot?.images.some(i=>i.source===0),'apply');}}
        catch (error) {state.error = String(error?.message || error); notify(); return false;}
      }
      state.error = ''; state.applying = true; notify();
      try {
        if (!state.applied) {const result = await bridge.applyProposal(state.proposal, state.proposalSnapshot,{sampling:state.samplingApproval}); state.proposalSnapshot = result.snapshot; state.applied = true; state.toolTrace.push({name:'apply_prompt_completed'});
          await recordReceipt('applied');
          if (state.samplingApproval) {const actual = bridge.readSampling(); if (actual.variant === state.samplingApproval.variant && actual.steps === state.samplingApproval.steps && actual.cfg === state.samplingApproval.cfg) state.samplingApproval = actual;}
        }
        state.status = state.proposal.promptOptimization ? '已应用优化后的提示词，保留手动参数' : '已应用到绘图，保留原负向和手动参数'; notify();
        if (generate) {
          if (!samplingUnchanged(state.samplingApproval)) fail('实际采样或参考内容已变化，请重新确认后生成');
          state.generating = true; state.localSession = null; state.status = '正在通过绘图流程生成一张…'; notify();
          const result = await bridge.generateApplied(); state.messages.push({role:'assistant', content:'这张是本次实际成图，请告诉我哪里还需要修改。', imageUrl:result.imageUrl, name:result.name}); state.toolTrace.push({name:'generate_completed'});
          await recordReceipt('succeeded',result);
          state.proposal = null; state.proposalSnapshot = null; state.applied = false; state.status = '已生成，等待你的评价';
        }
        return true;
      } catch (error) {await recordReceipt('failed'); state.error = String(error?.message || error); state.status = '未完成生成'; invalidate(); return false;}
      finally {state.generating = false; state.applying = false; notify();}
    }
    function releaseCurrentStagedMedia() { releasePreviews(state.staged); releasePreviews(state.pendingUploads); }
    function releaseStagedMedia() { releaseCurrentStagedMedia(); for(const session of Object.values(transientSessions)){releasePreviews(session.staged);releasePreviews(session.pendingUploads);} }
    // Detach this UI session without cancelling work already submitted.
    function retire() {
      if(retired)return false;
      if(activeChatBilling?.inFlight){activeChatBilling.unknown=true;publishBilling(activeChatBilling);}
      if(activeFoartBilling?.inFlight){activeFoartBilling.unknown=true;publishBilling(activeFoartBilling);}
      retired=true; ++serial; ++businessModelEpoch;
      for(const listener of businessModelListeners){try{listener();}catch{}}
      stopStatusPolling(); releaseStagedMedia();
      return true;
    }
    function reset() {if (CHAT_MODELS[state.modelId]?.retired || state.pending || state.generating || state.applying || state.uploading || state.staging || state.staged.some(item=>item.status==='reading')) return false; clearSelectionTickets();clearQwenSeek(); if(pendingFoartImageReview)root.NovaFlowFoartTools?.cancelImageReview?.(pendingFoartImageReview.id);pendingFoartImageReview=null;foartImageReviewUndo=null;state.foartImageReviewCanUndo=false; ++serial; stopStatusPolling(); activeRequest = ''; activeSnapshot = null; activeMode = 'chat'; lastRequestMessage = ''; carryAttachments = null; carryAsk = null; lastUploads=[];lastPreparedTask='';pendingIntent=null;pendingPromptSource=null;state.promptSourceCancelledNotice='';clearMediaPromptReview();bridge.clearPrepared(); releaseCurrentStagedMedia(); sessions[state.provider]={messages:[],history:[],conversationId:''}; delete modelSessions[state.modelId];delete transientSessions[state.modelId]; Object.assign(state, {activeTask:null,messages:[], history:[],historyOriginUnknown:false, conversationId:'', proposal:null, proposalSnapshot:null, applied:false, confirmation:null,samplingApproval:null,operation:null,error:'', toolTrace:[], staged:[], pendingUploads:[], pendingUploadId:'', learningTask:null, learningWarning:'', status:state.mode === 'drawing' ? '当前模型的新对话，将使用当前绘图内容' : '当前模型的新对话，可以直接聊天'}); notify(); return true;}
    function setProvider(provider) {
      if (!['local','api'].includes(provider) || provider === state.provider || state.pending || state.generating || state.applying || state.uploading) return false;
      return setModel(provider === 'local' ? 'qwen3.5-9b-heretic' : 'xai/grok-4.7');
    }
    function setModel(modelId) {
      const model = CHAT_MODELS[modelId];
      if (!model || model.retired || modelId==='legacy-online' || modelId === state.modelId || state.pending || state.generating || state.applying || state.uploading || state.staging || state.staged.some(item=>item.status==='reading')) return false;
      if(pendingFoartImageReview)root.NovaFlowFoartTools?.cancelImageReview?.(pendingFoartImageReview.id);
      pendingFoartImageReview=null;foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;
      clearSelectionTickets();clearQwenSeek();clearMediaPromptReview();
      const wasPendingPromptSource=!!pendingPromptSource;
      if(wasPendingPromptSource){cancelledPromptSourceModels.add(state.modelId);pendingPromptSource=null;}
      businessModelEpoch++;
      for(const listener of businessModelListeners){try{listener();}catch{}}
      ++serial; notify();
      transientSessions[state.modelId]={staged:state.staged,pendingUploads:state.pendingUploads,pendingUploadId:state.pendingUploadId,carryAttachments,carryAsk,lastUploads,lastPreparedTask,pendingIntent,lastRequestMessage,learningTask:state.learningTask,learningWarning:state.learningWarning};
      bridge.clearPrepared(); activeSnapshot = null; activeMode='chat';
      const saved=modelSessions[modelId] || {}, transient=transientSessions[modelId] || {};
      carryAttachments=transient.carryAttachments || null;carryAsk=transient.carryAsk || null;lastUploads=transient.lastUploads || [];lastPreparedTask=transient.lastPreparedTask || '';pendingIntent=transient.pendingIntent || null;lastRequestMessage=transient.lastRequestMessage || '';
      Object.assign(state, {provider:model.provider,modelId,messages:saved.messages || [],history:saved.history || [],historyOriginUnknown:saved.historyOriginUnknown===true,activeTask:saved.activeTask || null,conversationId:'',staged:transient.staged || [],pendingUploads:transient.pendingUploads || [],pendingUploadId:transient.pendingUploadId || '',learningTask:transient.learningTask || null,learningWarning:transient.learningWarning || '',mode:'chat',proposal:null,proposalSnapshot:null,applied:false,confirmation:null,samplingApproval:null,operation:null,error:'',toolTrace:[],model:model.label,localSession:null,localModelStatus:null,qwenExecutionDevice:null,status:model.provider==='api'?(currentPricingPolicy()?(modelAvailable(modelId)?'':model.detail):'正在获取在线模型状态…'):model.detail});
      const showCancelledPromptSource=wasPendingPromptSource || cancelledPromptSourceModels.has(modelId);
      cancelledPromptSourceModels.delete(modelId);
      state.promptSourceCancelledNotice=showCancelledPromptSource?'先前的提示词来源选择已因切换模型取消，请重新发送需要优化的内容；未提交或扣费。':'';
      if(state.promptSourceCancelledNotice)state.status=[state.status,state.promptSourceCancelledNotice].filter(Boolean).join(' ');
      notify(); if(model.provider==='api')void refreshPricingPolicy(); return true;
    }
    function viewLegacyArchive(provider) {
      const row=provider==='legacy-online' ? modelSessions['legacy-online'] : provider==='retired-local' ? modelSessions.next : provider==='retired-glm' ? modelSessions['glm/glm-5.3-flash'] : legacyArchive?.[provider];if(!['local','api','legacy-online','retired-local','retired-glm'].includes(provider) || !row || typeof row!=='object')return null;
      const clean=(items,roles,limit)=>(Array.isArray(items)?items:[]).filter(item=>roles.includes(item?.role)&&typeof item.content==='string').slice(-limit).map(({role,content,receipt})=>({role,content,...(typeof receipt==='string'&&receipt?{receipt}: {})}));
      return {messages:clean(row.messages,['user','assistant','status'],Number.MAX_SAFE_INTEGER),history:clean(row.history,['user','assistant'],Number.MAX_SAFE_INTEGER),readOnly:row.readOnly===true || ['local','api','legacy-online','retired-local','retired-glm'].includes(provider),...(row.activeTask ? {activeTask:copy(row.activeTask)} : {})};
    }
    function legacyArchiveSources() {return ['local','api','legacy-online','retired-local','retired-glm'].filter(provider=>{const row=viewLegacyArchive(provider);return row && (row.messages.length || row.history.length || row.activeTask);});}
    function restoreLegacyArchive(provider) {
      if(CHAT_MODELS[state.modelId]?.retired || viewLegacyArchive(provider)?.readOnly || state.pending || state.generating || state.applying || state.uploading || state.staging || state.staged.some(item=>item.status==='reading'))return false;
      const row=viewLegacyArchive(provider);if(!row || !legacyArchiveSources().includes(provider))return false;
      const alreadyShown=row.messages.every((item,i)=>state.messages[i]?.role===item.role && state.messages[i]?.content===item.content);
      if(!alreadyShown)state.messages=[...row.messages,...state.messages].slice(-60);
      state.history=[...row.history,...state.history].slice(-12);state.historyOriginUnknown=true;state.conversationId='';
      state.status='已恢复旧文字；下次发送会把所保留的历史交给当前模型。旧任务和附件不会自动恢复。';state.error='';notify();return true;
    }
    return Object.freeze({state, retire, businessModelSnapshot, subscribeBusinessModel, analyzeStagedImage, prepareQwenSeek, cancelQwenSeek, confirmQwenSeek, undoQwenSeek, confirmFoartRotation, cancelFoartRotation, undoFoartRotation, confirmFoartAudio, cancelFoartAudio, refreshFoartAudioRecoveries, acknowledgeFoartAudioRecovery, applyMediaPromptReview, cancelMediaPromptReview, undoMediaPromptReview, send, apply, confirmSampling, cancelConfirmation, confirmCommunitySelection, cancelCommunitySelection, undoCommunitySelection, clearSelectionTickets, stop, reset, setProvider, setModel, refreshContext, onlineEstimateInput, onlineQuote, modelAvailable, hideLegacyOnlineOption, modelRateSummary, onlinePriceDetails, visiblePricingDetails, onlineOperationMinimumConfirmed, onlineOperationDecimalConfirmed, pricingPolicyKey, refreshPricingPolicy, prefetchPricingPolicy, calibrateLocalStatus, invalidateLocalCapability, clearQwenExecutionDevice, recordFeedback, stageUploads, removeStaged, chooseUploadDestination, releaseStagedMedia,cancelFoartImageReview,undoFoartImageReview,recordBusinessBillingNotice,visibleBillingNotices,dismissBillingNotice,artBillingNotices,dismissArtBillingNotice,operationRecoveryNotices,checkOperationRecovery,onlineBusinessUi,legacyArchiveSources,viewLegacyArchive,restoreLegacyArchive});
  }
  function mount() {
    if (!root.document?.body || root.document.getElementById('nf-xiaotao-art-root')) return;
    const doc = root.document, host = doc.createElement('div'); host.id = 'nf-xiaotao-art-root'; host.setAttribute('data-novaflow-runtime-ignore', '1');
    const el = (tag, cls, text) => {const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;};
    const fab = el('button', 'nf-xiaotao-launcher nf-xiaotao-robot'); fab.type = 'button'; fab.setAttribute('data-novaflow-keep-radius', '1'); fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'nf-xiaotao-art-panel');
    fab.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6v7M13 32H7v13h7m37-13h6v13h-7M23 54v5m18-5v5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle class="nf-xiaotao-antenna" cx="32" cy="5" r="3"/><rect x="12" y="14" width="40" height="41" rx="14" fill="#3b3b3b" stroke="currentColor" stroke-width="2"/><rect x="18" y="23" width="28" height="20" rx="8" fill="#202020"/><g class="nf-xiaotao-eyes"><circle cx="25" cy="32" r="3"/><circle cx="39" cy="32" r="3"/></g><path d="M27 47h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const robotLabel = el('span', 'nf-xiaotao-robot-label', '小桃AI'), robotState = el('span', 'nf-xiaotao-robot-state', '待机'); fab.append(robotLabel, robotState);
    const panel = el('aside', 'nf-xiaotao-panel'); panel.id = 'nf-xiaotao-art-panel'; panel.hidden = true; panel.setAttribute('aria-label', '小桃AI对话');
    const header = el('header', 'nf-xiaotao-header'), title = el('div','nf-xiaotao-title'), titleText = el('strong','','小桃AI'), close = el('button', 'nf-xiaotao-icon', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭对话');
    title.append(titleText); header.append(title, close);
    const context = el('div', 'nf-xiaotao-context'), contextLabel = el('span'), thumbs = el('div', 'nf-xiaotao-thumbs'); context.append(contextLabel, thumbs);
    const legacyPanel=el('details','nf-xiaotao-legacy'),legacySummary=el('summary','','查看旧对话记录'),legacyHelp=el('p','','旧记录不会自动发送。查看后可选择将文字历史加入当前模型；下次发送最多携带最近 12 条历史。旧任务和附件不会自动恢复。'),legacySelect=el('select'),legacyText=el('pre'),legacyRestore=el('button','','将旧文字加入当前模型');
    legacySelect.setAttribute('aria-label','选择旧对话来源');legacyRestore.type='button';legacyPanel.hidden=true;legacyPanel.append(legacySummary,legacyHelp,legacySelect,legacyText,legacyRestore);
    const messages = el('div', 'nf-xiaotao-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-label', '小桃全局对话');
    const intro = el('p', 'nf-xiaotao-intro', '上传素材并描述想要的结果，我会根据需求调用美工、音视、特效、动画或工具；拿不准你的意思时，会先向你问清楚。'); messages.append(intro);
    const proposal = el('details', 'nf-xiaotao-proposal'), summary = el('summary', '', '提示词与执行'), proposalText = el('pre'), copyPrompt=el('button','','复制完整提示词'); copyPrompt.type='button'; copyPrompt.onclick=()=>void copyText(controller.state.proposal?.prompt || '',copyPrompt); proposal.hidden = true; proposal.append(summary,copyPrompt,proposalText);
    const actions = el('div', 'nf-xiaotao-actions'), applyButton = el('button', '', '应用到绘图'), generateButton = el('button', 'nf-xiaotao-primary', '应用并生成一张'); for (const b of [applyButton, generateButton]) b.type = 'button'; generateButton.setAttribute('data-nf-xiaotao-art-generate','1'); const cancelImageReviewButton=el('button','','\u53d6\u6d88\u8349\u7a3f'),undoImageReviewButton=el('button','','\u64a4\u9500\u5e94\u7528');cancelImageReviewButton.type=undoImageReviewButton.type='button';cancelImageReviewButton.hidden=undoImageReviewButton.hidden=true;actions.append(applyButton, generateButton,cancelImageReviewButton,undoImageReviewButton); proposal.append(actions);
    const confirmation = el('section','nf-xiaotao-proposal'), confirmationText = el('p'), samplingActions = el('div','nf-xiaotao-actions'); confirmation.hidden = true; confirmation.setAttribute('aria-label','确认本次生图参数'); samplingActions.style.flexWrap = 'wrap';
    for (const [choice,label] of [['current','按当前参数'],['turbo','Turbo · 8 步 · CFG3'],['standard','普通 · 25 步 · CFG3'],['cancel','取消']]) {const button = el('button','',label); button.type = 'button'; button.onclick = () => void (choice === 'cancel' ? controller.cancelConfirmation() : controller.confirmSampling(choice)); samplingActions.append(button);}
    confirmation.append(confirmationText,samplingActions);
    const selectionConfirmation=el('section','nf-xiaotao-proposal'),selectionText=el('p'),selectionActions=el('div','nf-xiaotao-actions'),selectionConfirm=el('button','','确认选择'),selectionCancel=el('button','','取消'),selectionUndo=el('button','','撤销本次选择');
    selectionConfirmation.hidden=true;selectionConfirmation.setAttribute('aria-label','确认骨骼选择');
    for(const button of [selectionConfirm,selectionCancel,selectionUndo])button.type='button';
    selectionConfirm.setAttribute('data-novaflow-community-selection-confirm','1');selectionUndo.setAttribute('data-novaflow-community-selection-undo','1');
    selectionConfirm.onclick=event=>controller.confirmCommunitySelection(event);selectionCancel.onclick=()=>controller.cancelCommunitySelection();selectionUndo.onclick=event=>controller.undoCommunitySelection(event);
    selectionActions.append(selectionConfirm,selectionCancel,selectionUndo);selectionConfirmation.append(selectionText,selectionActions);
    const qwenSeekPanel=el('section','nf-xiaotao-proposal'),qwenSeekText=el('p'),qwenSeekActions=el('div','nf-xiaotao-actions');
    const qwenSeekConfirm=el('button','','确认定位'),qwenSeekCancel=el('button','','取消'),qwenSeekUndo=el('button','','撤销本次定位');
    qwenSeekPanel.hidden=true;qwenSeekPanel.setAttribute('aria-label','确认动画帧定位');
    for(const button of [qwenSeekConfirm,qwenSeekCancel,qwenSeekUndo])button.type='button';
    qwenSeekConfirm.setAttribute('data-novaflow-qwen-seek-confirm','1');qwenSeekUndo.setAttribute('data-novaflow-qwen-seek-undo','1');
    qwenSeekConfirm.onclick=event=>controller.confirmQwenSeek(event);qwenSeekCancel.onclick=()=>controller.cancelQwenSeek();qwenSeekUndo.onclick=event=>controller.undoQwenSeek(event);
    qwenSeekActions.append(qwenSeekConfirm,qwenSeekCancel,qwenSeekUndo);qwenSeekPanel.append(qwenSeekText,qwenSeekActions);
    const rotationPanel=el('section','nf-xiaotao-proposal'),rotationText=el('p'),rotationActions=el('div','nf-xiaotao-actions');
    const rotationConfirm=el('button','','确认旋转'),rotationCancel=el('button','','取消'),rotationUndo=el('button','','撤销本次旋转');
    rotationPanel.hidden=true;rotationPanel.setAttribute('aria-label','确认骨骼旋转');
    for(const button of [rotationConfirm,rotationCancel,rotationUndo])button.type='button';
    rotationConfirm.setAttribute('data-novaflow-single-rotation-confirm','1');rotationCancel.setAttribute('data-novaflow-single-rotation-cancel','1');rotationUndo.setAttribute('data-novaflow-single-rotation-undo','1');
    rotationConfirm.onclick=event=>controller.confirmFoartRotation(event);rotationCancel.onclick=event=>controller.cancelFoartRotation(event);rotationUndo.onclick=event=>controller.undoFoartRotation(event);
    rotationActions.append(rotationConfirm,rotationCancel,rotationUndo);rotationPanel.append(rotationText,rotationActions);
    const audioActionPanel=el('section','nf-xiaotao-proposal'),audioActionText=el('p'),audioActionActions=el('div','nf-xiaotao-actions');
    const audioActionConfirm=el('button','','确认生成音频'),audioActionCancel=el('button','','取消');
    audioActionPanel.hidden=true;audioActionPanel.setAttribute('aria-label','确认音频任务');
    audioActionConfirm.type=audioActionCancel.type='button';audioActionConfirm.setAttribute('data-novaflow-audio-action-confirm','1');
    audioActionConfirm.onclick=event=>controller.confirmFoartAudio(event);audioActionCancel.onclick=()=>controller.cancelFoartAudio();
    audioActionActions.append(audioActionConfirm,audioActionCancel);audioActionPanel.append(audioActionText,audioActionActions);
    const audioRecoveryPanel=el('section','nf-xiaotao-proposal');audioRecoveryPanel.hidden=true;audioRecoveryPanel.setAttribute('aria-label','待核对音频任务');
    const mediaPromptPanel=el('section','nf-xiaotao-proposal'),mediaPromptText=el('p'),mediaPromptActions=el('div','nf-xiaotao-actions');
    const mediaPromptApply=el('button','','应用提示词'),mediaPromptCancel=el('button','','取消'),mediaPromptUndo=el('button','','撤销应用');
    mediaPromptPanel.hidden=true;mediaPromptPanel.setAttribute('aria-label','确认应用提示词');
    for(const button of [mediaPromptApply,mediaPromptCancel,mediaPromptUndo])button.type='button';
    mediaPromptApply.setAttribute('data-novaflow-media-prompt-apply','1');mediaPromptCancel.setAttribute('data-novaflow-media-prompt-cancel','1');mediaPromptUndo.setAttribute('data-novaflow-media-prompt-undo','1');
    mediaPromptApply.onclick=event=>void controller.applyMediaPromptReview(event);mediaPromptCancel.onclick=event=>controller.cancelMediaPromptReview(event);mediaPromptUndo.onclick=event=>void controller.undoMediaPromptReview(event);
    mediaPromptActions.append(mediaPromptApply,mediaPromptCancel,mediaPromptUndo);mediaPromptPanel.append(mediaPromptText,mediaPromptActions);
    const tools = el('div', 'nf-xiaotao-tools');
    const billingAlerts=el('div','nf-xiaotao-billing-alerts');billingAlerts.setAttribute('role','status');billingAlerts.setAttribute('aria-live','polite');billingAlerts.setAttribute('aria-label','小桃模型积分提示');Object.assign(billingAlerts.style,{flex:'0 0 auto'});
    const status = el('div', 'nf-xiaotao-status'); status.setAttribute('role', 'status'); const error = el('p', 'nf-xiaotao-error'); error.setAttribute('role', 'alert');
    const footer = el('form', 'nf-xiaotao-compose'), input = el('textarea'); input.rows = 3; input.placeholder = '有什么需要我帮助的？'; input.setAttribute('aria-label', '给智能助手的消息');
    const footerActions = el('div', 'nf-xiaotao-compose-actions'), providers = el('div', 'nf-xiaotao-brains'), modelSelect = el('select', 'nf-xiaotao-model-select'), newConversation = el('button', '', '新对话'), stop = el('button', '', '停止'), send = el('button', 'nf-xiaotao-primary', '发送');
    modelSelect.setAttribute('aria-label','选择小桃AI模型');
    // The native select stays as an internal compatibility mirror.  The visible
    // listbox is rendered inside the panel, avoiding the embedded editor's
    // native-popup compositor ordering issue.
    modelSelect.hidden=true;modelSelect.tabIndex=-1;modelSelect.setAttribute('aria-hidden','true');
    const modelTrigger=el('button','nf-xiaotao-model-trigger'),modelMenu=el('div','nf-xiaotao-model-popup'),modelBackdrop=el('div','nf-xiaotao-model-backdrop');
    modelTrigger.type='button';modelTrigger.setAttribute('role','combobox');modelTrigger.setAttribute('aria-label','选择小桃AI模型');
    modelTrigger.setAttribute('aria-haspopup','listbox');modelTrigger.setAttribute('aria-controls','nf-xiaotao-model-listbox');modelTrigger.setAttribute('aria-expanded','false');
    // Keep these nodes stable across focus and asynchronous policy refreshes:
    // replacing the pointer-down target before pointer-up can swallow a click.
    const triggerName=el('span','nf-xiaotao-model-name'),triggerNote=el('span','nf-xiaotao-model-note');
    modelTrigger.append(triggerName,triggerNote);
    modelMenu.id='nf-xiaotao-model-listbox';modelMenu.setAttribute('role','listbox');modelMenu.setAttribute('aria-label','小桃AI模型');modelMenu.hidden=true;modelBackdrop.hidden=true;modelBackdrop.setAttribute('aria-hidden','true');
    const modelOptions=new Map(),modelButtons=new Map(),modelParts=new Map(),modelIds=[];let onlinePricingGroup=null;
    for (const [label, ids] of [['免费 · 本地', ['qwen3.5-9b-heretic']], ['收费 · 在线', ['deepseek/deepseek-v4.1-flash','xai/grok-4.7','openai/gpt-6.1-sol-saver']]]) {
      const group=el('optgroup'); group.label=label;
      const menuGroup=el('div','nf-xiaotao-model-group');menuGroup.setAttribute('role','group');menuGroup.setAttribute('aria-label',label);
      const groupTitle=el('div','nf-xiaotao-model-group-label',label);groupTitle.setAttribute('aria-hidden','true');menuGroup.append(groupTitle);
      if(ids[0]==='deepseek/deepseek-v4.1-flash')onlinePricingGroup={group,menuGroup,groupTitle};
      for (const id of ids) {const model=CHAT_MODELS[id], option=el('option','',model.label + (model.available ? '' : ' · 未开通')); option.value=id;modelOptions.set(id,option);group.append(option);
        const item=el('button','nf-xiaotao-model-option'),name=el('span','nf-xiaotao-model-name',model.label),note=el('span','nf-xiaotao-model-note');item.append(name,note);item.type='button';item.tabIndex=-1;item.id='nf-xiaotao-model-option-'+modelIds.length;item.setAttribute('role','option');item.setAttribute('data-model-id',id);item.setAttribute('aria-selected','false');modelIds.push(id);modelButtons.set(id,item);modelParts.set(id,{name,note});menuGroup.append(item);}
      modelSelect.append(group);
      modelMenu.append(menuGroup);
    }
    const retiredSelection=el('option','','此前模型已移除 · 请选择');
    retiredSelection.value='gemma-4-12b-it'; retiredSelection.disabled=true; retiredSelection.hidden=true;
    const upload=el('button','nf-xiaotao-upload','上传'),stagedRow=el('div','nf-xiaotao-staged');upload.type='button';upload.setAttribute('aria-label','上传参考资源');stagedRow.hidden=true;
    function pickBrowserFiles() {
      const accept = root.NovaFlowXiaotaoUpload?.fileAccept?.() || '';
      return new Promise(resolve => {
        const picker = doc.createElement('input');
        picker.type = 'file';
        picker.multiple = true;
        picker.accept = accept;
        picker.setAttribute('accept', accept);
        picker.setAttribute('multiple', 'multiple');
        picker.setAttribute('aria-hidden', 'true');
        picker.style.display = 'none';
        let settled = false;
        const finish = files => { if (settled) return; settled = true; picker.remove?.(); resolve(Array.from(files || [])); };
        picker.onchange = () => finish(picker.files);
        if (typeof picker.addEventListener === 'function') picker.addEventListener('cancel', () => finish([]));
        doc.body.append(picker);
        picker.click();
      });
    }
    upload.onclick=async()=>{
      const activeController=controller;
      const pick=root.electronAPI?.pickXiaotaoUploads;
      if(typeof pick==='function'){
        let result; try{result=await pick();}catch(error){if(!sessionRetired&&controller===activeController){activeController.state.error=String(error?.message||error);render(activeController.state);}return;}
        if(sessionRetired||controller!==activeController)return;
        if(!result||result.canceled)return;
        const converted=root.NovaFlowXiaotaoUpload?.filesFromIpc?.(result)||{files:[],notes:[]};
        for(const note of converted.notes)activeController.state.messages.push({role:'assistant',content:note});
        if(await activeController.stageUploads(converted.files)&&!sessionRetired&&controller===activeController){navigation=navigationSelection();contextStamp='';setOpen(true);}
        return;
      }
      let chosen=[]; try{chosen=await pickBrowserFiles();}catch(error){if(!sessionRetired&&controller===activeController){activeController.state.error=String(error?.message||error);render(activeController.state);}return;}
      if(sessionRetired||controller!==activeController)return;
      if(!chosen.length)return;
      if(await activeController.stageUploads(chosen)&&!sessionRetired&&controller===activeController){navigation=navigationSelection();contextStamp='';setOpen(true);}
    };
    const listen=(node,type,fn)=>{if(typeof node.addEventListener==='function')node.addEventListener(type,fn);else node['on'+type]=fn;};
    const takeFiles=list=>{if(list?.length)void controller.stageUploads(list);};
    listen(footer,'dragover',event=>{if(event?.dataTransfer)event.preventDefault?.();});
    listen(footer,'drop',event=>{event?.preventDefault?.();takeFiles(Array.from(event?.dataTransfer?.files||[]));});
    listen(input,'paste',event=>{const files=Array.from(event?.clipboardData?.files||[]);if(files.length){event.preventDefault?.();takeFiles(files);}});
    for (const b of [newConversation, stop]) b.type = 'button'; newConversation.title = '清空当前模型的聊天记录并开始新会话'; newConversation.setAttribute('aria-label','清空当前模型的聊天记录并开启新对话'); send.type = 'submit'; const estimateLabel=el('span','nf-xiaotao-estimate',''); estimateLabel.setAttribute('data-idle','1'); providers.append(modelSelect);title.append(providers);footerActions.append(upload,newConversation, stop, estimateLabel, send); footer.append(stagedRow,input,footerActions);
    providers.append(modelTrigger);
    panel.append(header, modelMenu, context, messages, confirmation, qwenSeekPanel, rotationPanel, audioActionPanel, audioRecoveryPanel, mediaPromptPanel, selectionConfirmation, proposal, tools, billingAlerts, status, error, footer); host.append(modelBackdrop, fab, panel); doc.body.append(host);
    const mentionSurface=()=>root.NovaFlowUiDesignDrawing?.isActive?.()===true?'ui-design':(root.NovaFlowAudioStudio?.isOpen?.()===true&&root.NovaFlowAudioStudio?.sub?.()==='video'&&root.NovaFlowAiSequenceGeneration?.capture?.()?.mode)||'art-generate';
    const mountMentions=()=>{try{root.NovaFlowResourceMentionTool?.mountTextarea?.({textarea:input,surface:mentionSurface()});}catch{}};
    mountMentions();
    const drag = bindPanelDrag(panel, header, {onStart:()=>{if(modelMenu.hidden)return;const rect=panel.getBoundingClientRect();Object.assign(panel.style,{left:rect.left+'px',top:rect.top+'px'});modelMenu.hidden=true;modelBackdrop.hidden=true;panel.classList.remove('nf-xiaotao-menu-open');modelTrigger.setAttribute('aria-expanded','false');modelTrigger.removeAttribute('aria-activedescendant');}});
    const robotDrag = bindPanelDrag(fab, fab, {threshold:5,ignoreInteractive:false,onEnd:() => {if (open) anchorPanel();}});
    const bridge = createBridge(); let rendered = [], renderedProposal = null, contextStamp = '', previewImages = [], open = false, lastPricingKey=null,nodeRecheck=null;
    let controller, controllerEpoch=0, sessionRetired=false;
    const makeController=()=>{
      const epoch=++controllerEpoch;
      return createController({bridge,storage:createTabScopedStorage(root.localStorage,root.sessionStorage),onChange:state=>{if(epoch===controllerEpoch)render(state);}});
    };
    controller=makeController();
    const authIdentity=()=>{
      try {
        const auth=root.NovaFlowClientAuth?.state?.();
        if(!auth || typeof auth.loggedIn!=='boolean')return null;
        if(!auth.loggedIn)return 'signed-out';
        const account=String(auth.account||'').trim().toLowerCase();
        return account ? `account:${account}` : null;
      } catch {return null;}
    };
    let lastAuthIdentity=authIdentity();
    const retireSession=()=>{
      if(sessionRetired)return;
      sessionRetired=true;
      ++controllerEpoch;
      controller.retire();
    };
    const restoreSession=()=>{
      if(!sessionRetired)return;
      controller=makeController();sessionRetired=false;
      input.value='';rendered=[null];renderedProposal=null;contextStamp='';previewImages=[];thumbs.replaceChildren();lastPricingKey=null;
      render(controller.state);
      nodeRecheck?.reset();
    };
    const replaceSession=()=>{retireSession();restoreSession();};
    const qwenRecheckEligible=()=>open&&!doc.hidden&&controller.state.modelId==='qwen3.5-9b-heretic'&&!controller.state.pending&&!controller.state.generating&&!controller.state.applying&&!controller.state.uploading&&!controller.state.staging;
    nodeRecheck=createQwenNodeRecheck({isNeeded:()=>qwenRecheckEligible()&&!controller.modelAvailable('qwen3.5-9b-heretic'),refresh:()=>controller.calibrateLocalStatus()});
    root.addEventListener?.('novaflow-client-auth-changed',()=>{
      const next=authIdentity();
      if(next!==lastAuthIdentity){lastAuthIdentity=next;replaceSession();}
      controller.invalidateLocalCapability();nodeRecheck.reset();if(qwenRecheckEligible())void nodeRecheck.refreshNow();
    });
    const storedAccount=value=>{
      if(!value)return 'signed-out';
      try {
        const user=JSON.parse(value)?.user;
        const identity=String(user?.account||user?.email||user?.id||'').trim().toLowerCase();
        return identity?`account:${identity}`:null;
      } catch {return null;}
    };
    root.addEventListener?.('storage',event=>{
      if(event?.key==='novaflow.client.auth.session.v1'){
        const before=storedAccount(event.oldValue),after=storedAccount(event.newValue);
        if(!before||!after||before!==after){lastAuthIdentity=null;replaceSession();return;}
      }
      render(controller.state);
    });
    for(const provider of controller.legacyArchiveSources()){const option=el('option','',provider==='local'?'旧本地对话（只读）':provider==='legacy-online'?'原在线智能对话（只读）':provider==='retired-local'?'已移除本地模型对话（只读）':provider==='retired-glm'?'GLM 对话（只读）':'旧在线对话');option.value=provider;legacySelect.append(option);}
    function renderLegacyPreview(){const row=controller.viewLegacyArchive(legacySelect.value);legacyText.textContent=row ? [...row.messages.map(item=>`${item.role==='user'?'你':item.role==='assistant'?'小桃':'记录'}：${item.content}${item.receipt?'\n'+item.receipt:''}`),...(row.history.length?[row.readOnly?'\n旧历史（只读）：':'\n可恢复的历史：',...row.history.map(item=>`${item.role==='user'?'你':'小桃'}：${item.content}`)]:[]),...(row.activeTask?['\n旧任务记录（仅查看，不会自动恢复）：',JSON.stringify(row.activeTask,null,2)]:[])].join('\n') : '';}
    legacySelect.onchange=()=>{renderLegacyPreview();const readonly=CHAT_MODELS[controller.state.modelId]?.retired===true||controller.viewLegacyArchive(legacySelect.value)?.readOnly===true;legacyRestore.disabled=readonly;legacyHelp.textContent=readonly?'这条旧记录仅供查看，不会自动发送；请使用当前模型开始新对话。':'旧记录不会自动发送。查看后可选择将文字历史加入当前模型；下次发送最多携带最近 12 条历史。旧任务和附件不会自动恢复。';};legacyPanel.ontoggle=()=>{if(legacyPanel.open)legacySelect.onchange();};
    legacyRestore.onclick=()=>{if(typeof root.confirm!=='function'||!root.confirm('将旧文字历史加入当前模型？下次发送时，最多最近 12 条历史会传给该模型提供方。旧任务和附件不会自动恢复。'))return;if(controller.restoreLegacyArchive(legacySelect.value))legacyPanel.open=false;};
    if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', () => {nodeRecheck.stop();retireSession();});
    if (typeof root.addEventListener === 'function') root.addEventListener('pageshow', () => {restoreSession();nodeRecheck.start();if(qwenRecheckEligible())void nodeRecheck.refreshNow();});
    if (typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => {if(qwenRecheckEligible())void nodeRecheck.refreshNow();else nodeRecheck.update();});
    if (typeof root.addEventListener === 'function') root.addEventListener('novaflow:compute-node', () => {controller.invalidateLocalCapability();nodeRecheck.reset();if(qwenRecheckEligible())void nodeRecheck.refreshNow();});
    if (typeof root.addEventListener === 'function') root.addEventListener('novaflow:runtime-features', () => render(controller.state));
    async function copyText(text, button, target) {return copyMessageText(text,button,doc,root,target);}
    function syncModelOptions() {
      if(onlinePricingGroup){const label=controller.onlineOperationDecimalConfirmed()?'收费 · 在线（按实际用量结算）':controller.onlineOperationMinimumConfirmed()?'收费 · 在线（成功操作最低 1 积分）':'收费 · 在线（计费规则待确认）';if(onlinePricingGroup.group.label!==label)onlinePricingGroup.group.label=label;if(onlinePricingGroup.groupTitle.textContent!==label)onlinePricingGroup.groupTitle.textContent=label;if(onlinePricingGroup.menuGroup.getAttribute('aria-label')!==label)onlinePricingGroup.menuGroup.setAttribute('aria-label',label);}
      let selected=null;
      for(const [id,option] of modelOptions){
        const model=CHAT_MODELS[id],rate=model.provider==='api'?controller.modelRateSummary(id,true):'',displayLabel=model.provider==='local'?model.label.replace('（本地·免费）',''):model.label;
        const status=controller.modelAvailable(id)?'':id==='qwen3.5-9b-heretic'?(controller.state.qwen35CpuTrialChecked===true?'无可用节点':'设备待检测'):model.provider==='api' && !controller.pricingPolicyKey()?'价格待确认':'未开通';
        const device=id==='qwen3.5-9b-heretic' && !status ? qwenExecutionDeviceLabel(controller.state.qwenExecutionDevice) : '';
        const note=[model.provider==='local'?'本地对话免费':rate,device,status].filter(Boolean).join(' · ');
        const optionText=model.label+(rate?' · '+rate:'')+(status?' · '+status:'');if(option.textContent!==optionText)option.textContent=optionText;
        const item=modelButtons.get(id),parts=modelParts.get(id),ariaLabel=`${displayLabel}${note?'，'+note:''}`,ariaSelected=String(id===controller.state.modelId);if(parts.name.textContent!==displayLabel)parts.name.textContent=displayLabel;if(parts.note.textContent!==note)parts.note.textContent=note;if(item.getAttribute('aria-label')!==ariaLabel)item.setAttribute('aria-label',ariaLabel);if(item.getAttribute('aria-selected')!==ariaSelected)item.setAttribute('aria-selected',ariaSelected);
        if(id===controller.state.modelId)selected={label:id==='qwen3.5-9b-heretic'?'Qwen3.5 9B':displayLabel,note:model.provider==='local'?['本地·免费',status].filter(Boolean).join(' · '):note};
      }
      const label=selected?.label||retiredSelection.textContent,note=selected?.note||'';
      if(triggerName.textContent!==label)triggerName.textContent=label;if(triggerNote.textContent!==note)triggerNote.textContent=note;
      const ariaLabel=selected?`选择小桃AI模型，当前${label}${note?'，'+note:''}`:'选择小桃AI模型，此前模型已移除';if(modelTrigger.getAttribute('aria-label')!==ariaLabel)modelTrigger.setAttribute('aria-label',ariaLabel);
    }
    function render(state) {
      lastPricingKey=controller.pricingPolicyKey();
      const artNotices=controller.artBillingNotices(),operationNotices=state.pending?[]:controller.operationRecoveryNotices(),businessNotices=controller.visibleBillingNotices();
      const latestNotice=billingNoticeForView(state.provider,businessNotices,artNotices);
      billingAlerts.replaceChildren();billingAlerts.hidden=!latestNotice&&Array.isArray(operationNotices)&&!operationNotices.length;
      if(latestNotice)billingAlerts.append(el('p','nf-xiaotao-billing-note',billingNoticeText(latestNotice,state.provider)));
      if(operationNotices===null)billingAlerts.append(el('p','nf-xiaotao-error','无法读取待核对账单记录，在线操作暂不可提交。'));
      for(const row of operationNotices||[]){
        const status=row.recovery?.status,settled=status==='settled',detail=settled
          ? `已确认扣 ${row.recovery.charged} 积分${row.recovery.uncollected?`，仍有 ${row.recovery.uncollected} 积分未结算`:''}。`
          : status==='in-progress'?'操作仍在处理中，请勿重复提交。':status==='pending-settlement'?'用量已记录，结算状态待核对，请勿重复提交。'
          : status==='unavailable'?'暂时无法查询账单状态，请稍后再试，勿重复提交。':'操作或账单状态待核对，请勿重复提交。';
        const item=el('p','nf-xiaotao-error',`${CHAT_MODELS[row.modelId]?.label||'在线模型'}：${detail}`),check=el('button','','查询状态');
        check.type='button';check.onclick=()=>void controller.checkOperationRecovery(row.operationId);item.append(check);
        if(settled&&row.recovery.uncollected===0){const dismiss=el('button','','关闭');dismiss.type='button';dismiss.onclick=()=>void controller.checkOperationRecovery(row.operationId,true);item.append(dismiss);}
        billingAlerts.append(item);
      }
      if (CHAT_MODELS[state.modelId]?.retired) {retiredSelection.value=state.modelId;if (!retiredSelection.parentNode) modelSelect.prepend(retiredSelection);}
      else if (retiredSelection.parentNode) retiredSelection.remove();
      syncModelOptions();
      if (state.messages.length !== rendered.length || state.messages.some((m, i) => m !== rendered[i])) {
        rendered = state.messages.slice(); messages.replaceChildren();
        const rows = conversationRows(state.messages);
        if (!rows.length) messages.append(intro);
        for (const row of rows) messages.append(renderConversationRow(doc, {...row,receipts:[]}, {copyText, chooseUploadDestination:controller.chooseUploadDestination}));
        messages.scrollTop = messages.scrollHeight;
      }
      const stagedItems = state.staged || []; stagedRow.hidden = !stagedItems.length; stagedRow.replaceChildren(); for (const item of stagedItems) {const card=el('div','nf-xiaotao-staged-item');card.setAttribute('data-status',item.status);if(item.status==='reading')card.setAttribute('aria-busy','true');const imagePreview=item.kind==='image' && item.previewUrl;const thumb=imagePreview?el('img','nf-xiaotao-staged-thumb'):el('div','nf-xiaotao-staged-fallback',item.kind==='video'?'视频':item.kind==='audio'?'音频':'文件');if(imagePreview){thumb.src=item.previewUrl;thumb.alt=item.name;thumb.setAttribute('alt',item.name);}if(item.status==='reading')card.append(el('span','nf-xiaotao-staged-spinner'));const remove=el('button','nf-xiaotao-staged-remove','×');remove.type='button';remove.setAttribute('aria-label','移除 '+item.name);remove.onclick=event=>{event.preventDefault?.();event.stopPropagation?.();controller.removeStaged(item.id);};card.append(thumb,remove);stagedRow.append(card);}
      const warm = state.localSession?.state === 'warm' && state.localSession.modelLoaded === true;
      titleText.title = state.provider === 'api' ? '在线智能' : state.modelId !== 'next' ? CHAT_MODELS[state.modelId]?.label || '本地模型' : warm ? '本地智能 · 上次已就绪' : '本地智能';
      const activity = state.generating || state.applying ? 'working' : state.pending ? 'thinking' : 'idle';
      fab.dataset.state = activity; robotState.textContent = activity === 'working' ? '工作中' : state.provider === 'local' && state.pending ? ({loading:'加载中',analyzing:'分析中',releasing:'释放中'}[state.operation?.phase] || {loading:'加载中',answering:'回答中',releasing:'释放中',warm:'准备回答'}[state.localSession?.state] || '连接中') : state.pending ? '回答中' : state.confirmation ? '等待确认' : state.provider === 'local' && warm ? '上次已就绪' : '待机'; fab.setAttribute('aria-label','小桃AI，'+robotState.textContent+'，点击聊天，可拖动');
      tools.textContent = [...new Set(state.toolTrace.map(step => ({get_art_context:'已读取当前绘图',propose_art_direction:'已整理完整提示词',apply_art_direction:'模型请求写入提示框',generate_art_image:'模型请求绘图执行',apply_prompt_completed:'已写入提示框',generate_completed:'已完成实际生图'}[step.name] || '')).filter(Boolean))].join(' · ');
      status.textContent = state.modelId==='qwen3.5-9b-heretic' && !controller.modelAvailable(state.modelId) && !state.pending
        ? (state.qwen35CpuTrialChecked===true?'当前无可用节点 · 未提交，不扣积分。':'设备待检测 · 未提交，不扣积分。')
        : state.status || (state.provider==='api' && controller.modelAvailable(state.modelId)?'':CHAT_MODELS[state.modelId]?.detail) || '';
      error.textContent = state.error; error.hidden = !state.error; proposal.hidden = !state.proposal;
      confirmation.hidden = !state.confirmation; confirmationText.textContent = state.confirmation ? `当前为 ${samplingLabel(state.confirmation.sampling)}。${state.confirmation.sampling.styleTransfer ? '双图风格迁移使用 CFG3；按当前参数会保留版本和步数，并设为 CFG3。' : ''}确认后才分析并生成一张。` : '';
      selectionConfirmation.hidden=!state.selectionPreview&&!state.selectionUndoAvailable;
      selectionText.textContent=state.selectionPreview ? `当前选中：${state.selectionPreview.previous.join('、')||'无'}；建议选中：${state.selectionPreview.boneName}。请核对画面，确认后仅改变选区。` : '已选择骨骼，可以撤销本次选择。';
      selectionConfirm.hidden=selectionCancel.hidden=!state.selectionPreview;selectionUndo.hidden=!state.selectionUndoAvailable;
      qwenSeekPanel.hidden=!state.qwenSeekProposal&&!state.qwenSeekCanUndo;
      qwenSeekConfirm.hidden=qwenSeekCancel.hidden=!state.qwenSeekProposal;qwenSeekUndo.hidden=!state.qwenSeekCanUndo;
      qwenSeekText.textContent=state.qwenSeekProposal ? `将动画“${state.qwenSeekProposal.animation}”从第 ${state.qwenSeekProposal.fromFrame} 帧定位到第 ${state.qwenSeekProposal.targetFrame} 帧；只改变当前预览位置，不修改工程。` : state.qwenSeekCanUndo ? '可撤销刚才的定位，返回原帧。' : '';
      rotationPanel.hidden=!state.foartRotationProposal&&!state.foartRotationCanUndo;
      audioActionPanel.hidden=!state.foartAudioProposal;
      audioActionText.textContent=state.foartAudioProposal?`请确认生成${state.foartAudioProposal.kind==='music'?'音乐':'音效'}，时长 ${state.foartAudioProposal.seconds} 秒${state.foartAudioProposal.kind==='music'?`，BPM ${state.foartAudioProposal.bpm}，循环${state.foartAudioProposal.loop?'开启':'关闭'}`:''}。描述：${state.foartAudioProposal.prompt}。实际生成描述：${state.foartAudioProposal.effectivePrompt}。${state.foartAudioProposal.rewritePolicy==='skip-for-confirmed-task'?'本次不执行自动二次改写，页面开关保持原样。':''}规划费用已结算。生成费用按任务实际结算。确认后会提交生成任务。`:'';
      audioRecoveryPanel.replaceChildren();audioRecoveryPanel.hidden=!state.foartAudioRecoveries?.length;
      if(state.foartAudioRecoveries?.length){const refresh=el('button','','检查任务状态');refresh.type='button';refresh.onclick=()=>void controller.refreshFoartAudioRecoveries();audioRecoveryPanel.append(refresh);}
      for(const row of state.foartAudioRecoveries||[]){const item=el('div'),label=el('span');label.textContent=`音频任务 ${row.taskId.slice(-8)}：${row.status==='unknown'?'状态待核对':row.status}${row.status==='completed'&&!row.creditSettled?'，积分待核对':''}`;item.append(label);
        if(['failed','cancelled','expired'].includes(row.status)||(row.status==='completed'&&row.creditSettled)){const ack=el('button','','已查看');ack.type='button';ack.onclick=()=>void controller.acknowledgeFoartAudioRecovery(row.taskId);item.append(ack);}audioRecoveryPanel.append(item);}
      rotationConfirm.hidden=rotationCancel.hidden=!state.foartRotationProposal;rotationUndo.hidden=!state.foartRotationCanUndo;
      rotationText.textContent=state.foartRotationProposal ? `动画“${state.foartRotationProposal.animation}”，骨骼 ${state.foartRotationProposal.boneName} 第 ${state.foartRotationProposal.frame} 帧：旋转 ${state.foartRotationProposal.fromRotation}° → ${state.foartRotationProposal.toRotation}°。确认前不修改作品。${state.foartRotationProposal.warning||''}` : state.foartRotationCanUndo ? '可撤销刚才的单骨骼旋转。' : '';
      const busy = state.pending || state.generating || state.applying || state.uploading || state.staging,retired=CHAT_MODELS[state.modelId]?.retired===true;
      mediaPromptPanel.hidden=!state.mediaPromptProposal&&!state.mediaPromptCanUndo;
      mediaPromptApply.hidden=mediaPromptCancel.hidden=!state.mediaPromptProposal;mediaPromptUndo.hidden=!state.mediaPromptCanUndo;
      mediaPromptApply.disabled=mediaPromptCancel.disabled=mediaPromptUndo.disabled=busy;
      mediaPromptText.textContent=state.mediaPromptProposal?`确认将上方草稿应用到${state.mediaPromptProposal.surface==='video'?'视频':state.mediaPromptProposal.surface==='ui'?'UI':'音频'}提示词？不会自动生成。`:'可撤销本次提示词应用。';
      if(state.proposal!==renderedProposal) {renderedProposal=state.proposal; proposal.open=Boolean(state.proposal); copyPrompt.textContent='复制完整提示词';}
      proposalText.textContent = state.proposal?.prompt || ''; applyButton.disabled = retired || busy || state.applied; generateButton.disabled = retired || busy; newConversation.disabled = retired || busy; upload.disabled=retired || busy; send.disabled = retired || busy || (state.provider==='api' && !controller.modelAvailable(state.modelId)); stop.hidden = !state.pending && !state.generating; input.disabled = retired || busy;
      const imageReview=state.proposal?.kind==='foart-online-review';generateButton.hidden=imageReview&&(state.proposal?.generateRequested!==true||state.applied);generateButton.textContent=imageReview?'确认并生成（另计费）':'应用并生成一张';cancelImageReviewButton.hidden=!imageReview||state.applied;undoImageReviewButton.hidden=!imageReview||!state.foartImageReviewCanUndo;cancelImageReviewButton.disabled=busy;undoImageReviewButton.disabled=busy;
      legacyPanel.hidden=controller.legacyArchiveSources().length===0;legacyRestore.disabled=retired || busy || controller.viewLegacyArchive(legacySelect.value)?.readOnly===true || state.staged.some(item=>item.status==='reading');
      modelSelect.disabled = busy || state.staged.some(item=>item.status==='reading'); modelSelect.value = state.modelId; modelSelect.title = (state.provider==='api' && !retired ? (controller.modelAvailable(state.modelId) ? '在线收费 · 按实际用量结算' : controller.pricingPolicyKey() ? '在线收费 · 当前线路或积分价格不可用，不能发送' : '在线收费 · 价格状态暂不可用，不能发送') : (CHAT_MODELS[state.modelId]?.detail || ''))+(state.localModelStatus?.id===state.modelId ? (state.localModelStatus.modelLoaded ? ' · 节点报告已加载' : ' · 节点报告未加载') : '');
      modelTrigger.disabled=modelSelect.disabled;modelTrigger.title=modelSelect.title;
      if(modelTrigger.disabled){if(!modelMenu.hidden)drag.reclamp();modelMenu.hidden=true;modelBackdrop.hidden=true;panel.classList.remove('nf-xiaotao-menu-open');modelTrigger.setAttribute('aria-expanded','false');}
      paintEstimate();
      if(!open || state.modelId!=='qwen3.5-9b-heretic' || controller.modelAvailable('qwen3.5-9b-heretic'))nodeRecheck?.reset();else nodeRecheck?.update();
    }
    function paintEstimate() {
      const prices = root.NovaFlowFeatureCreditPrices;
      let text = '';
      if (controller.state.provider === 'api' && controller.modelAvailable(controller.state.modelId) && typeof prices?.estimateXiaotaoOnline === 'function') {
        const quote = controller.onlineQuote(input.value);
        text = quote?.credits ? `预估${quote.credits}分` : '';
        const title = quote?.credits ? `粗略预估 ${quote.low ?? quote.credits}–${quote.high ?? quote.credits} 分；${controller.state.modelId==='legacy-online'?'旧线路价格未同步，此预估仅供参考；':'提交后按实际请求重新估算预留，'}按返回用量计算，预估不是供应商账单。${controller.onlinePriceDetails()}` : controller.onlinePriceDetails();
        if (estimateLabel.title !== title) estimateLabel.title = title;
      }
      estimateLabel.hidden = false;
      if (estimateLabel.textContent !== text) estimateLabel.textContent = text;
      if (text) estimateLabel.removeAttribute('data-idle');
      else estimateLabel.setAttribute('data-idle', '1');
    }
    function anchorPanel() {
      const robot = fab.getBoundingClientRect(), box = panel.getBoundingClientRect(), size = {width:box.width,height:box.height};
      drag.place(anchoredPanelPosition(robot, size, {width:root.innerWidth,height:root.innerHeight}), size);
    }
    const setOpen = value => {open = value; panel.hidden = !value; fab.setAttribute('aria-expanded', String(value)); if (value) {mountMentions();anchorPanel(); tick();if(ONLINE_AUDIO_ACTION_RELEASE_ENABLED)void controller.refreshFoartAudioRecoveries();if(qwenRecheckEligible())void nodeRecheck.refreshNow();if(controller.state.provider==='api')void controller.refreshPricingPolicy();else controller.prefetchPricingPolicy();input.focus();} else {nodeRecheck.reset();modelMenu.hidden=true;modelBackdrop.hidden=true;panel.classList.remove('nf-xiaotao-menu-open');modelTrigger.setAttribute('aria-expanded','false');controller.clearSelectionTickets();controller.cancelQwenSeek();render(controller.state);}};
    function navigationSelection() {
      const selected = (kind) => Array.from(doc.querySelectorAll(`[data-novaflow-${kind}-entry="1"]`)).find(node => (node.getAttribute(`data-novaflow-${kind}-active`) === '1' || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('aria-current') === 'page') && node.getClientRects().length);
      const primary = selected('primary'), secondary = selected('secondary');
      let surface = ''; try {surface = bridge.captureChat().artContext.surface;} catch {}
      return {primary:primary?.getAttribute('data-novaflow-primary-label') || primary?.getAttribute('aria-label') || primary?.textContent.trim() || '',secondary:secondary?.getAttribute('aria-label') || secondary?.textContent.trim() || '',surface};
    }
    let navigation = navigationSelection();
    function closeOnNavigation() {
      const next = navigationSelection(), changedPrimary = navigation.primary && next.primary && navigation.primary !== next.primary,
        changedSecondary = navigation.primary === next.primary && navigation.secondary && next.secondary && navigation.secondary !== next.secondary,
        changedSurface = navigation.surface && next.surface && navigation.surface !== next.surface;
      // 小桃 is global. Its own routing and user navigation must not dismiss the
      // conversation or orphan an in-flight upload.
      navigation = {primary:next.primary || navigation.primary,secondary:next.secondary || ((!next.primary || next.primary === navigation.primary) ? navigation.secondary : ''),surface:next.surface || navigation.surface};
    }
    doc.addEventListener('click',event => {if (event.target?.closest?.('[data-novaflow-primary-entry="1"], [data-novaflow-secondary-entry="1"]')) root.setTimeout(closeOnNavigation,0);},true);
    fab.onclick = event => {if (robotDrag.consumeClick()) {event.preventDefault(); return;} setOpen(!open);}; close.onclick = () => setOpen(false); stop.onclick = () => void controller.stop(); applyButton.onclick = () => void controller.apply(); generateButton.onclick = event => void controller.apply({generate:true,event});cancelImageReviewButton.onclick=()=>controller.cancelFoartImageReview();undoImageReviewButton.onclick=()=>controller.undoFoartImageReview();
    newConversation.onclick = () => {if (controller.reset()) {input.value = ''; input.focus();}};
    // A DOM listbox stays in the same stacking context as the assistant. Keep
    // focus on its trigger while moving the active option for screen readers.
    let modelMenuIndex=0,suppressOutsideClick=false,suppressTimer=null;
    const refreshModelOptions=()=>{syncModelOptions();controller.prefetchPricingPolicy();};
    const closeModelMenu=(focus=false,retainBackdrop=false)=>{if(!modelMenu.hidden)drag.reclamp();modelMenu.hidden=true;modelBackdrop.hidden=!retainBackdrop;panel.classList.remove('nf-xiaotao-menu-open');modelTrigger.setAttribute('aria-expanded','false');modelTrigger.removeAttribute('aria-activedescendant');if(focus)modelTrigger.focus();};
    const paintModelActive=()=>{modelIds.forEach((id,index)=>{const item=modelButtons.get(id);item.classList.toggle('is-active',index===modelMenuIndex);});const item=modelButtons.get(modelIds[modelMenuIndex]);if(item){modelTrigger.setAttribute('aria-activedescendant',item.id);item.scrollIntoView?.({block:'nearest'});}};
    const positionModelMenu=()=>{const box=panel.getBoundingClientRect(),anchor=modelTrigger.getBoundingClientRect(),width=Math.max(0,Math.min(340,box.width-16));Object.assign(modelMenu.style,{width:width+'px',left:'8px',top:Math.max(0,anchor.bottom-box.top+4)+'px'});};
    let modelViewportWidth=root.innerWidth,modelViewportHeight=root.innerHeight;
    const refreshModelViewport=()=>{if(!open||modelMenu.hidden)return;const width=root.innerWidth,height=root.innerHeight;if(width===modelViewportWidth&&height===modelViewportHeight)return;modelViewportWidth=width;modelViewportHeight=height;drag.reclamp();positionModelMenu();};
    root.addEventListener?.('resize',refreshModelViewport);root.visualViewport?.addEventListener?.('resize',refreshModelViewport);
    if(typeof root.ResizeObserver==='function'&&doc.documentElement){const observer=new root.ResizeObserver(refreshModelViewport);observer.observe(doc.documentElement);}
    const openModelMenu=()=>{
      if(modelTrigger.disabled)return;refreshModelOptions();modelMenuIndex=Math.max(0,modelIds.indexOf(controller.state.modelId));
      const rect=panel.getBoundingClientRect();panel.style.setProperty('--nf-xiaotao-menu-left',rect.left+'px');panel.style.setProperty('--nf-xiaotao-menu-top',rect.top+'px');panel.classList.add('nf-xiaotao-menu-open');
      modelViewportWidth=root.innerWidth;modelViewportHeight=root.innerHeight;positionModelMenu();
      modelBackdrop.hidden=false;modelMenu.hidden=false;modelTrigger.setAttribute('aria-expanded','true');paintModelActive();
    };
    const chooseModel=id=>{closeModelMenu();modelSelect.value=id;if(controller.setModel(id)){contextStamp='';if(controller.state.provider==='local')void controller.calibrateLocalStatus();input.focus();}else{modelSelect.value=controller.state.modelId;modelTrigger.focus();}};
    modelTrigger.onclick=()=>{if(modelMenu.hidden)openModelMenu();else closeModelMenu();};
    modelTrigger.onkeydown=event=>{
      if(event.key==='Tab'){closeModelMenu();return;}
      if(event.key==='Escape'){if(!modelMenu.hidden){event.preventDefault();closeModelMenu(true);}return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();if(modelMenu.hidden){openModelMenu();return;}
        modelMenuIndex=event.key==='Home'?0:event.key==='End'?modelIds.length-1:(modelMenuIndex+(event.key==='ArrowDown'?1:-1)+modelIds.length)%modelIds.length;paintModelActive();return;
      }
      if(event.key==='Enter'||event.key===' '){event.preventDefault();if(modelMenu.hidden)openModelMenu();else chooseModel(modelIds[modelMenuIndex]);}
    };
    for(const [id,item] of modelButtons){item.onpointerdown=event=>event.preventDefault();item.onclick=()=>chooseModel(id);}
    if(typeof doc.addEventListener==='function'){
      doc.addEventListener('pointerdown',event=>{
        // The editor reactivates its current tool with synthetic pointers on
        // resize/zoom. Only a real outside pointer should dismiss this menu.
        if(event.isTrusted===false)return;
        if(suppressOutsideClick){suppressOutsideClick=false;modelBackdrop.hidden=true;if(suppressTimer!==null)root.clearTimeout(suppressTimer);suppressTimer=null;}
        if(modelMenu.hidden||!open||modelTrigger.contains(event.target)||modelMenu.contains(event.target))return;
        closeModelMenu(false,true);suppressOutsideClick=true;event.preventDefault();event.stopImmediatePropagation();
        if(suppressTimer!==null)root.clearTimeout(suppressTimer);
        suppressTimer=root.setTimeout(()=>{suppressOutsideClick=false;modelBackdrop.hidden=true;suppressTimer=null;},1000);
      },true);
      doc.addEventListener('pointerup',event=>{if(!suppressOutsideClick)return;modelBackdrop.hidden=true;event.preventDefault();event.stopImmediatePropagation();},true);
      doc.addEventListener('pointercancel',()=>{if(suppressOutsideClick)modelBackdrop.hidden=true;},true);
      doc.addEventListener('click',event=>{if(!suppressOutsideClick)return;suppressOutsideClick=false;modelBackdrop.hidden=true;if(suppressTimer!==null)root.clearTimeout(suppressTimer);suppressTimer=null;event.preventDefault();event.stopImmediatePropagation();},true);
    }
    modelSelect.onchange=()=>chooseModel(modelSelect.value);
    footer.onsubmit = async event => {
      event.preventDefault();const text=input.value;if(!text.trim())return;
      const activeController=controller, before=activeController.state.messages.length;input.value='';
      try{await activeController.send(text);}catch(failure){if(!sessionRetired&&controller===activeController){activeController.state.error='本次操作未能提交：'+String(failure?.message||failure);activeController.state.status='未提交生成';render(activeController.state);}}
      if(sessionRetired||controller!==activeController)return;
      if(!input.value&&!activeController.state.messages.slice(before).some(row=>row.role==='user'&&row.content===text)){input.value=text;input.focus();}
    };
    input.onkeydown = event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); footer.requestSubmit();}};
    input.oninput = () => {try{paintEstimate();}catch{estimateLabel.textContent='用量暂无法预估';}};
    function tick() {
      if (drag.dragging() || robotDrag.dragging()) return;
      closeOnNavigation();
      controller.refreshContext(); if (!open) return;
      const policyKey=controller.pricingPolicyKey();if(policyKey!==lastPricingKey){lastPricingKey=policyKey;render(controller.state);if(!policyKey)controller.prefetchPricingPolicy();}
      if(root.NovaFlowAudioStudio?.isOpen?.()) {
        const media=root.NovaFlowMediaAgent?.capture?.().artContext;
        contextLabel.textContent='全局助手 · 调用美工、音视、特效、动画和工具';
        if(previewImages.length){thumbs.replaceChildren();previewImages=[];}
        return;
      }
      try {const snapshot = bridge.captureAny({includeResult:bridge.hasResult()}), stamp = JSON.stringify(snapshot.artContext); if (stamp !== contextStamp || snapshot.images.some((img, i) => img.dataUrl !== previewImages[i]) || snapshot.images.length!==previewImages.length) {contextStamp = stamp; previewImages = snapshot.images.map(img => img.dataUrl); contextLabel.textContent = '全局助手 · 调用美工、音视、特效、动画和工具'; thumbs.replaceChildren(); for (const ref of snapshot.images) {const item = el('span'), img = el('img'), name=ref.role==='subject'?'主体':ref.role==='style'?'画风':'当前成图'; img.src = ref.dataUrl; img.alt=name; item.append(img, el('small', '',ref.source?`图${ref.source} · ${name}`:name)); thumbs.append(item);}}}
      catch {contextLabel.textContent = '全局助手 · 调用美工、音视、特效、动画和工具'; if (previewImages.length) {thumbs.replaceChildren(); previewImages = [];}}
    }
    render(controller.state); root.setInterval(tick, 500); tick();
    root.NovaFlowXiaotaoArtAgent.panel = Object.freeze({open:() => setOpen(true), close:() => setOpen(false), get controller(){return controller;}});
  }
  root.NovaFlowXiaotaoArtAgent = {selectedModelPayload, communityAttachmentMetadata, enforceCommunityReadOnly, compactFoartHistory, compactFoartReceipt, fingerprint, sameSnapshot, executionIntent, samplingRequest, samplingChoice, feedbackRequest, clampPanelPosition, anchoredPanelPosition, renderMessageMarkdown, conversationRows, renderConversationRow, createTabScopedStorage, createQwenNodeRecheck, qwenExecutionDeviceLabel, bindPanelDrag, createBridge, createController, mount};
  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, {once:true}); else if (root.document?.body) mount();
})(typeof window !== 'undefined' ? window : globalThis);

(function (root) {
  'use strict';
  // BEGIN GENERATED xiaotao-online-models (run tools/sync-xiaotao-online-models.mjs)
  const XIAOTAO_ONLINE_MODELS = Object.freeze([{"id":"deepseek/deepseek-v4.1-flash","label":"DeepSeek V4.1 Flash","flatRate":true,"vision":true},{"id":"bytedance/doubao-seed-2.1-lite","label":"豆包 Seed 2.1 Lite","flatRate":true,"vision":true},{"id":"xai/grok-4.7","label":"Grok 4.7","flatRate":false,"vision":true},{"id":"openai/gpt-6.1-sol-saver","label":"GPT-6.1 Sol Saver","flatRate":false,"vision":true}].map(model => Object.freeze(model)));
  const XIAOTAO_ONLINE_MODEL_IDS = Object.freeze(XIAOTAO_ONLINE_MODELS.map(model => model.id));
  const isXiaotaoOnlineModel = id => XIAOTAO_ONLINE_MODEL_IDS.includes(id);
  const isXiaotaoFlatRateModel = id => XIAOTAO_ONLINE_MODELS.some(model => model.id === id && model.flatRate);
  // END GENERATED xiaotao-online-models
  // Retain retired identifiers only for history and billing notices.
  const CHAT_MODELS = Object.freeze({
    next: {label:'此前模型已移除', provider:'local', retired:true, available:false, detail:'此前选择的模型已移除，旧对话仅供查看；请主动选择其他模型，未提交、不扣积分'},
    // Keep the retired identifier solely to preserve existing conversations.
    'gemma-4-12b-it': {label:'此前模型已移除', provider:'local', retired:true, available:false, detail:'此前选择的模型已从列表移除，请主动选择其他模型；未提交，不扣积分'},
    'qwen3.5-9b-heretic': {label:'Qwen3.5 9B（本地·免费）· Ultra Heretic', provider:'local', available:false, detail:'支持对话和提示词优化。操作软件请切换在线模型。'},
    // Online brains come from the one shared list; they differ only by model id.
    ...Object.fromEntries(XIAOTAO_ONLINE_MODELS.map(model=>[model.id,{label:model.label, provider:'api', available:model.id==='xai/grok-4.7', detail:'在线收费 · 线路或积分价格尚未开通验证，不能发送；未提交，不扣积分'}])),
    'legacy-online': {label:'原在线智能（旧记录）', provider:'api', retired:true, available:false, detail:'原在线线路已合并为 Grok 4.7；旧对话仅供查看，请主动选择模型，未提交、不扣积分'}
  });
  function selectedModelPayload(id) {
    return id==='gemma-4-12b-it' || id==='qwen3.5-9b-heretic' || isXiaotaoOnlineModel(id) ? {modelId:id} : {};
  }
  // 小桃 opens on 豆包; a user without credits is told to switch to the free
  // local model or ask the admin to top up.
  const DEFAULT_XIAOTAO_MODEL_ID = 'bytedance/doubao-seed-2.1-lite';
  const CREDIT_SHORTAGE_REPLY = '你的积分不足，这次没有完成。可以在上方模型选择里切换到免费的本地模型（Qwen3.5 9B）继续对话和优化提示词，或联系管理员充值后再使用在线模型。';
  const isCreditShortage = text => /积分不足|insufficient_credits/i.test(String(text || '')) && !/计费池/.test(String(text || ''));
  const LOCAL_CHAT_ONLY_NOTICE = '本地模型只支持对话和提示词优化，不能操作软件。需要操作时请切换到在线模型。';
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
  const SETTINGS = ['provider','mode','prompt','negativePrompt','width','height','seed','randomSeed','count','nsfw','samplingOverrides','loras','localDrawEngine','localQwen21Variant','drawingTask'];
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
  const cleanBillingNotices = rows => (Array.isArray(rows)?rows:[]).filter(row=>row && typeof row.id==='string' && row.id.length<=100 && CHAT_MODELS[row.modelId]?.provider==='api' && typeof row.unknown==='boolean' && (row.confirmed===null || creditUnits(row.confirmed)!==null) && (row.unknown || row.confirmed!==null) && (row.owner===undefined || typeof row.owner==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.owner))).slice(-40).map(({id,modelId,confirmed,unknown,owner,turn})=>({id,modelId,confirmed,unknown,...(owner===undefined?{}:{owner}),...(Number.isSafeInteger(turn)&&turn>0?{turn}:{})}));
  const billingNoticeText=row=>`本次扣费 ${displayCredits(row.confirmed)} 积分`;
  // This session's confirmed charge, online models only. Nothing outlives the page.
  const billingNoticeForView=(provider,rows)=>provider==='api'?rows.filter(row=>!row.unknown).at(-1)||null:null;
  // A charge stays with the turn that spent it, so every reply keeps its own amount.
  function appendBillingNotice(rows,row,turn) {const old=rows.find(item=>item.id===row.id),bound=old?.turn??turn;return cleanBillingNotices([...rows.filter(item=>item.id!==row.id),{...row,...(Number.isSafeInteger(bound)&&bound>0?{turn:bound}:{})}]);}
  // Settled charges per turn (one sum per user message), confirmed amounts only.
  function billingByTurn(rows) {const totals=new Map();for(const row of rows||[]){if(row.unknown||row.confirmed==null||!Number.isSafeInteger(row.turn))continue;const sum=sumCredits(totals.get(row.turn)??0,row.confirmed);if(sum!==null)totals.set(row.turn,sum);}return totals;}
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
  // The tool planner only sees file names, so 反推 runs as image chat, where the model sees the picture.
  function imageReverseRequest(message){const text=String(message||'').trim();return /反推/.test(text)&&!/(?:不要|不用|别|无需|不需要)反推|视频|音频|音乐|[?？吗]$/.test(text);}
  function endsWithQuestion(reply){return /[?？]|请确认|确认后|请(?:告诉|说明|提供|补充|描述|选择)|告诉我/.test(String(reply||'').trim().split('\n').at(-1).slice(-160));}
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
  // Pictures attached this turn are what the user means: a previous result must not replace them.
  function keepTurnPictures(op){
    if(op.action==='use_result')return null;
    return op.useResult===true?{...op,useResult:false}:op;
  }

  // Which pictures a request names as style. "图1的风格换成图2的风格" names both, but the first is the
  // one being changed: a request always leaves one subject.
  function styleSlots(message,count){
    const slots=new Set([...message.matchAll(/图\s*([1-9])\s*(?:的)?(?:风格|画风)/g)].map(m=>Number(m[1])-1));
    if(!slots.size&&/风格|画风|style/i.test(message)&&count>1)slots.add(count-1);
    if(count>1&&slots.size>=count)slots.delete([...slots][0]);
    return slots;
  }

  // The @ list keeps counting across a conversation, while the page holds this turn's pictures from 1:
  // the last labels named are this turn's, in order; earlier ones are pictures from before.
  function turnLabels(text,count){
    const named=[...new Set([...String(text).matchAll(/(?:@参考图\s*|<image)(\d+)/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b);
    const slotOf=label=>{const index=named.slice(-count).indexOf(label);return named.length>=count&&index>=0?index:named.length<count&&label<=count?label-1:-1;};
    return {named,slotOf};
  }
  function renumberTurnMentions(text,count){
    const {named,slotOf}=turnLabels(text,count);
    if(!count||!named.length||named.at(-1)<=count)return text;
    return String(text).replace(/(@参考图\s*|<image)(\d+)>?/g,(tag,head,n)=>{const slot=slotOf(Number(n));return slot<0?'之前的主体图':head+(slot+1)+(head==='<image'?'>':'');});
  }
  // What a sentence asks beyond which pictures to use: the clauses that name no picture and no 分别/各自.
  const EACH_WORDS=/分别|各自|各种|每张|每个|逐张|逐个|挨个|依次|轮流|一张一张|one by one|each|respectively|separately/i;
  function styleExtras(message){
    return String(message||'').split(/[，。；,;\n]+/).map(part=>part.trim()).filter(part=>part&&!/@参考图|<image/.test(part)&&!EACH_WORDS.test(part)).join('，');
  }
  // Who is who in a style request. The brain's parameters decide; wording is only read when it sent none.
  // Returns null for anything that is not a style run, {ask} for one short question, or the run itself.
  function planStyleRun(op,message,count,hasSubject,turnPictures){
    const {slotOf}=turnLabels(message,count),unique=list=>[...new Set(list)].filter(slot=>slot>=0&&slot<count);
    const explicit=op.subjectRef!==undefined||op.styleRefs!==undefined||op.perStyle!==undefined;
    let subjectSlot=-1,styleSlots=[],perStyle=op.perStyle===true;
    if(explicit){
      if(!count||op.generationMode==='txt2img')return null;
      if(op.subjectRef!==undefined)subjectSlot=slotOf(op.subjectRef);
      styleSlots=unique((op.styleRefs||[]).map(slotOf));
    }else{
      if(!turnPictures||!count)return null;
      const each=count>1&&EACH_WORDS.test(message),swap=count===1&&/(?:换成|转成|改成|变成|转换成)\s*@?参考图\s*\d+\s*(?:的)?(?:风格|画风)/.test(message);
      if(!each&&!swap)return null;
      const named=/(?:把|将|主体(?:是|为)?)\s*(?:@参考图\s*|<image)(\d+)|(?:@参考图\s*|<image)(\d+)>?\s*(?:是|为|作为|当)\s*主体/.exec(message);
      if(named)subjectSlot=slotOf(Number(named[1]||named[2]));
      if(named&&subjectSlot>=0&&count<3)return null;
      perStyle=each||swap;
    }
    if(!styleSlots.length)styleSlots=unique(Array.from({length:count},(_,slot)=>slot).filter(slot=>slot!==subjectSlot));
    styleSlots=styleSlots.filter(slot=>slot!==subjectSlot);
    if(!styleSlots.length)return null;
    if(subjectSlot<0&&!hasSubject)return {ask:'这些是风格图，还缺一张要转换的主体图。请先发主体图。'};
    if(styleSlots.length>4)return {ask:'一次最多用 4 张风格图，现在有 '+styleSlots.length+' 张。请告诉我用哪 4 张。'};
    if(!perStyle&&styleSlots.length>2)return {ask:'这 '+styleSlots.length+' 张风格图是混合成一张，还是每张各生成一张？'};
    return {subjectSlot,styleSlots,perStyle,extras:typeof op.extraInstructions==='string'&&op.extraInstructions.trim()?op.extraInstructions.trim():styleExtras(message)};
  }

  const pageLimitQuestion=(op,count)=>op?.generationMode==='img2img'&&count>3?'一次最多用 3 张参考图，现在有 '+count+' 张。请告诉我用哪 3 张。':'';
  // Internal check wording is no use to the person at the keyboard.
  function plainFoartError(error){
    const text=String(error?.message||error);
    return /未知参数|工具需求无效|完整性校验|工具类型无效|规划/.test(text)?'这一步没做成，已完成的部分已保留。可以换个说法，或告诉我要改哪张图。':text;
  }

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
  function localOperationIntent(message) {
    const text=String(message||'');
    return qwenExplicitWriteIntent(text)||!discussionOnly(text)&&/打开|进入|切换|关闭|换成|换掉|替换|变成|做成|迁移|放进|放到|加到|生成|生图|出图|绘制|画一张|画个|(?:做|来|整|弄)\s*(?:一|两|几|[0-9])?\s*(?:张|幅)|制作|压缩|去黑|转换|裁切|分割|导入|导出|播放|暂停|跳到|定位|第\s*\d+\s*帧|删(?:除|掉|去|了)?|移除|创建|新建|选中|选择|移动|旋转|缩放|修改|调整|编辑|写入|应用|设置|填充|抠图|拆图|调用工具|执行|(?:再|更).{0,8}(?:一点|一些|点)|(?:快|慢|大|小|亮|暗|飘|动)(?:一点|一些|点)/i.test(text);
  }
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
  // Accept only one selected bone, one existing frame and an explicit absolute angle.
  // Compare only authored rotation key data actually returned by native reads.
  // This does not evaluate interpolation, bone hierarchy or world transforms.
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
    return null;
  }
  function feedbackRequest(message) {
    const text = String(message || '').trim();
    if (/[?？]|(?:能不能|可不可以|能否|是否|怎么|如何|为什么|假如|如果)|吗[。！!]?\s*$|(?:不要|不用|别|先不|暂不|不必|无需).{0,10}(?:生成|生图|出图|改|调|修)|提示词|方案|讨论|解释/.test(text)) return false;
    return /调整|修改|改善|修正|修好|重做|重绘|改成|改一下|调一下|优化|请改|帮我改|降低|增强|减少|去掉/.test(text);
  }
  const samplingLabel = sampling => `Turbo 加速版 · ${sampling.steps} 步 · CFG ${sampling.cfg}`;
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
    let applied = null;
    const snapshotOwners = new WeakMap(), creationSettings = new WeakMap(), optimizedCreations = new WeakMap();
    function context() {
      const rt = runtime(); if (!rt?.captureContext) fail('绘图页面尚未就绪，请稍后再试');
      rt.capturePrompt?.(); const value = rt.captureContext();
      if (value.generationSurface !== 'drawing' || !value.state.active) fail('请回到绘图页面使用小桃AI');
      return value;
    }
    function clearPrepared() {applied = null; runtime()?.clearAgentPrepared?.();}
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
        localQwen21Variant:'turbo',steps:sampling.steps,cfg:sampling.cfg,
        mode:refs.length || s.mode==='img2img' && lastResult ? 'img2img' : 'txt2img',prompt:s.prompt || '',negativePrompt:s.negativePrompt || '',referenceRoles:refs.map(r=>({source:r.source,role:'subject'}))});
      const snapshot={artContext,images,lastResult}; snapshotOwners.set(snapshot,s); creationSettings.set(snapshot,copy(Object.fromEntries(SETTINGS.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])))); return publish(snapshot);
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
      return {variant:'turbo',steps:sampling.steps,cfg:sampling.cfg,
        styleTransfer:ctx.generationSurface === 'drawing' && s.mode === 'img2img' && binding.images.length === 2,binding};
    }
    function setSampling(choice) {
      if (!['current','turbo'].includes(choice)) fail('请选择当前参数或 Turbo 8 步 CFG3');
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
          s.localQwen21Variant = 'turbo';
          const steps = choice === 'current' ? before.steps : 8, cfg = choice === 'current' ? confirmedCfg : 3;
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
        requirements:message,engine:'qwen-2.1-turbo',generationMode:proposal.generationMode,
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
      fail('当前方案已失效，请重新发送需求');
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
    return Object.freeze({captureCreation, captureChat, openDrawing, readSampling, setSampling, optimizeProposal, currentResult:()=>runtime()?.selectedResult?.(), hasResult:()=>Boolean(runtime()?.selectedResult?.()?.imageUrl), applyProposal, generateApplied, clearPrepared, cancelGeneration:() => runtime()?.cancel?.()});
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
  function createController({bridge, api: getApi = () => root.electronAPI, onChange = () => {}, timers = root, uploadHost = null} = {}) {
    let retired = false;
    const api = () => retired ? null : getApi();
    const state = {provider:'api', modelId:DEFAULT_XIAOTAO_MODEL_ID, mode:'chat', activeTask:null,messages:[], history:[], conversationId:'', proposal:null, proposalSnapshot:null, applied:false, applying:false, pending:false, generating:false, uploading:false, staging:false, confirmation:null, samplingApproval:null, operation:null, status:'正在获取在线模型状态…', error:'', model:CHAT_MODELS[DEFAULT_XIAOTAO_MODEL_ID].label, toolTrace:[], localSession:null, localModelStatus:null, qwenExecutionDevice:null, qwen35CpuTrialChecked:false, pricingPolicy:null, pricingError:'',billingNotices:[]};
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
    function selectedOnlineModel() {return state.modelId;}
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
      const selected=id;
      if(!isXiaotaoOnlineModel(selected))return false;
      const online=policy.config?.xiaotao_online, rates=selected==='xai/grok-4.7' ? online?.grok_4_7_rates : online?.model_rates?.[selected];
      if(hasDecimalCreditsFields(online) && !decimalCreditsPolicy(online) || online?.billing_scope==='operation' && !operationCreditsPolicy(online))return false;
      if(isXiaotaoFlatRateModel(selected)&&requireAvailable&&(!operationCreditsPolicy(online)||online?.operation_text_chat_v3!==true))return false;
      const tokenBilling=policy.config?.token_billing;
      const valid=value=>typeof value==='number' && Number.isFinite(value) && value>=0;
      if(!online || !(Number(policy.config.credits_per_usd)>0) || !(Number(online.markup)>0) || !Number.isSafeInteger(online.message_cap_credits) || online.message_cap_credits<1 || !tokenBilling || !['ceil','floor','round'].includes(tokenBilling.round) || !Number.isSafeInteger(tokenBilling.min_credits_per_image) || tokenBilling.min_credits_per_image<0 || !rates || !valid(rates.input) || !valid(rates.output))return false;
      if(selected==='xai/grok-4.7' && (!valid(rates.cached_input) || !valid(rates.high_input) || !valid(rates.high_output) || !valid(rates.high_cached_input) || !Number.isSafeInteger(rates.high_input_threshold)))return false;
      if(selected!=='xai/grok-4.7' && !valid(rates.cached))return false;
      if(isXiaotaoFlatRateModel(selected)&&(rates.input<=0||rates.output<=0))return false;
      if(selected==='openai/gpt-6.1-sol-saver' && (!valid(rates.highInput) || !valid(rates.highOutput) || !Number.isSafeInteger(rates.highAbove)))return false;
      return policy.models.some(item=>item?.id===id && (!requireAvailable || item.available===true));
    }
    function modelAvailable(id) {
      const model=CHAT_MODELS[id];if(!model || model.retired)return false;
      return model.provider==='api' ? policyAllowsOnline(id) : id==='qwen3.5-9b-heretic' ? state.qwen35CpuTrialAvailable===true : model.available===true;
    }
    function hideLegacyOnlineOption() {return true;}
    // Use the live quote policy; rounded=true changes display only.
    function modelRateSummary(id, rounded=false) {
      // A disabled model may still have a current published rate. Display it
      // as a reference without changing whether that model can be submitted.
      if(!policyAllowsOnline(id,false))return '';
      const policy=currentPricingPolicy(),online=policy.config.xiaotao_online;
      const rates=id==='xai/grok-4.7'?online.grok_4_7_rates:online.model_rates[id];
      const factor=Number(policy.config.credits_per_usd)*Number(online.markup),points=value=>rounded ? String(Math.round(value*factor)) : decimalCreditsPolicy(online) ? displayCredits(value*factor) : Number((value*factor).toFixed(4)).toString();
      return `1M 输入约 ${points(rates.input)} / 输出约 ${points(rates.output)} 积分`;
    }
    function onlinePriceDetails(id=state.modelId) {
      const policy=currentPricingPolicy();if(!policy || !policyAllowsOnline(id))return '';
      const model=id, online=policy.config.xiaotao_online;
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
    // A quote lives 60 s. Renew it just before it lapses so Send is never left disabled.
    let lastPricingPrefetch=0;
    function prefetchPricingPolicy(){
      const policy=currentPricingPolicy();
      if((policy&&policy.expiresAt-Date.now()>8000)||Date.now()-lastPricingPrefetch<5000||typeof api()?.companionPricing!=='function')return;
      lastPricingPrefetch=Date.now();void refreshPricingPolicy();
    }
    function selectedPricingPayload() {
      const policy=currentPricingPolicy();
      if(state.provider!=='api' || !policy || !policyAllowsOnline(state.modelId))return {};
      const selected=state.modelId;
      const terms=policy.config?.xiaotao_online;
      const operationBillingV3=operationCreditsPolicy(terms) && terms?.operation_text_chat_v3===true;
      const operationVisionBillingV3=operationBillingV3 && terms?.operation_vision_chat_v3===true;
      return {pricingVersion:policy.version,pricingExpiresAt:policy.expiresAt,expectedModelId:selectedOnlineModel(policy),...(operationBillingV3?{operationBillingV3:true}:{}),...(operationVisionBillingV3?{operationVisionBillingV3:true}:{}),onPricingQuote:quote=>{
        if(state.pending && state.modelId===selected && activeRequest===quote?.requestId) {state.status=`本轮估算预留 ${displayCredits(quote.estimatedCredits)} 分；最终按返回用量计算`;notify();}
      }};
    }
    function handlePricingFailure(response) {
      if(response?.errorCode==='companion-pricing-changed') {state.pricingPolicy=null;void refreshPricingPolicy();}
    }
    function predictOnline(input) {
      const policy=currentPricingPolicy(), model=selectedOnlineModel(policy), prices=root.NovaFlowFeatureCreditPrices;
      if(metering && Date.now()-metering.updatedAt>=pricingTtl)metering=null;
      if(!policy || !policyAllowsOnline(state.modelId))return null;
      const samples=metering?.model===model && metering?.pricingVersion===policy.version ? metering.samples : [];
      return prices?.predictXiaotaoOnline?.({...input,model,config:policy.config,samples}) || null;
    }
    function onlineQuote(message) {return predictOnline(onlineEstimateInput(message));}
    // One fixed operation outside the chat (no history), e.g. the 特效 material read:
    // the same prediction the chat box shows, for any online model the page allows.
    function operationEstimate({modelId,promptChars=0,images=[],outputTokens}={}) {
      const policy=currentPricingPolicy(),prices=root.NovaFlowFeatureCreditPrices;
      if(!policy||!policyAllowsOnline(modelId))return null;
      return prices?.predictXiaotaoOnline?.({model:modelId,config:policy.config,samples:[],text:'',system:' '.repeat(Math.max(0,promptChars)),
        files:images.map(image=>({kind:'image',width:image.width,height:image.height})),outputTokens})||null;
    }
    // Image reading (style analysis) is switched on per model by the server.
    function styleReadAvailable(modelId) {
      const terms=currentPricingPolicy()?.config?.xiaotao_online;
      return policyAllowsOnline(modelId)&&terms?.operation_style_v3===true&&terms?.operation_vision_chat_v3===true&&Array.isArray(terms.operation_style_vision_models)&&terms.operation_style_vision_models.includes(modelId);
    }
    let serial = 0, activeRequest = '', activeSnapshot = null, activeMode = 'chat', activeChatHasImages = false, stopped = false, statusTimer = null, activeStartedAt = 0, lastRequestMessage = '';
    let mediaAbort = null, promptAbort = null, foartAbort = null, activeFoartBilling=null, activeChatBilling=null;
    const recapture = snapshot => bridge.captureCreation({includeResult:snapshot.images.some(i=>i.role==='result')});
    const sessions = {local:{messages:[],history:[],conversationId:''}, api:{messages:[],history:[],conversationId:''}};
    const modelSessions = Object.create(null), transientSessions = Object.create(null);
    const cancelledPromptSourceModels = new Set();
    state.staged = []; state.pendingUploads = []; state.pendingUploadId = '';
    // The one picture kept across messages: the subject of the last style transfer, until a new subject or 新对话.
    let currentSubject = null;
    const styleRuns = new WeakMap();
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
    // Xiaotao asked and the user replied: the reply continues the earlier request.
    function answersQuestion(message){return !!pendingIntent&&(!pendingIntent.foart||state.provider==='api')&&!/取消|重新|另外|新建|优化|润色/.test(message);}
    function preparePromptSource(message,{recordMessage=true}={}) {
      const helper=root.NovaFlowXiaotaoPromptSource,info=activePromptSource();
      // A page that moved on, or a reply that picks no source, simply ends the
      // wait; the message is then read as a new request, never refused.
      if(pendingPromptSource&&!sourceBindingCurrent(pendingPromptSource,info))pendingPromptSource=null;
      if(pendingPromptSource){
        const pending=pendingPromptSource;
        const answer=String(message||'').trim();
        if(/^(?:取消|算了|不用了)[。.!！]?$/u.test(answer)){pendingPromptSource=null;if(recordMessage)pushUser(answer);state.status='已取消；未提交，不扣积分';notify();return {stop:true};}
        const page=/^(?:(?:就|请|我)?(?:用|选|选择|按照))?(?:当前)?(?:页面|下面|下方|输入框)(?:的)?(?:提示词|内容)?[。.!！]?$/u.test(answer);
        const chat=/^(?:(?:就|请|我)?(?:用|选|选择|按照))?(?:本条)?(?:对话|聊天|我发的|我写的)(?:提示词|内容)?[。.!！]?$/u.test(answer);
        let source;
        if(page&&pending.info.pagePrompt.trim())source={status:'ready',source:'page',prompt:pending.info.pagePrompt.trim(),requirements:''};
        else if(chat&&pending.conversationPrompt)source={status:'ready',source:'conversation',prompt:pending.conversationPrompt,requirements:''};
        else if(!page&&!chat&&!pending.conversationPrompt)source=helper?.resolvePromptSource?.({pagePrompt:'',conversationPrompt:answer,instruction:pending.message});
        pendingPromptSource=null;
        if(source?.status==='ready'){
          source={...source,workspaceSnapshot:pending.workspaceSnapshot,workspaceGuard:pending.workspaceGuard,stagedItems:pending.stagedItems,attachmentStillCurrent:pending.attachmentStillCurrent};
          if(recordMessage)pushUser(answer);return {info,source,message:pending.message,recordMessage:false};
        }
      }
      // Attachments outside drawing mean placing them first: that is tool work, not a text draft.
      if(!info||answersQuestion(message)||(state.provider==='api'&&state.staged.length&&info.surface!=='drawing'))return null;
      if(!helper?.classifyPromptAction||!helper?.resolvePromptSource){
        if(/优化|润色|改写|整理|完善/.test(message)){state.error='提示词来源组件尚未就绪，未提交或扣费。';notify();return {stop:true};}return null;
      }
      const action=helper.classifyPromptAction(message);if(action==='none')return null;
      // "改成…再生成" is one request for the planner, never a reason to refuse.
      if(action==='compound')return null;
      let workspace;try{workspace=capturePromptWorkspace(info);}catch{state.error='无法确认当前工作区，请稍后重试；未提交或扣费。';state.status='未提交';notify();return {stop:true};}
      const source=helper.resolvePromptSource({pagePrompt:info.pagePrompt,instruction:message});
      // With no prompt anywhere, only a bare "优化提示词" needs asking; anything with content is a request.
      if(source.reason==='both-prompts-empty'&&!/^(?:请|帮我|给我|把|将|再|一下|当前|页面|这段|的|提示词|提示语|prompt|优化|润色|改写|整理|完善|增强|[\s，,。.!！])*$/i.test(message))return null;
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
    let turnSeq=0;
    function pushUser(content) {
      // Each user message opens a turn; charges settled during it render under its reply.
      const entry = {role:'user', content, turn:++turnSeq};
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
    async function consumeStaged(message,{place=true}={}) {
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
      const productionRequest=nativeArtRequest||uploads.effectsPanelRequest?.(message)===true||/压缩|去黑|图集|查看器|粒子|模板|(?:转换|转为|转成).{0,8}(?:MP4|GIF|WEBM|MOV|AVI|MKV|格式)/i.test(taskText)||ready.some(item=>item.kind==='tool')||['tools','effects','particle','animation'].includes(state.activeTask?.surface);
      const plan = productionRequest||!place?{place:[],reject:[]}:uploads.planRoutes(message, ready,state.activeTask);
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
    // The local brain never shows an error box: whatever stopped it is said
    // as an ordinary reply. Runtime faults become a plain retry/switch hint.
    function localErrorAsReply() {
      if (state.provider !== 'local' || !state.error || state.pending) return;
      const text = String(state.error);
      const fault = /显存|内存|GPU|CPU|节点|算力|模型.{0,6}(?:未启动|不可用|退出|释放|交接|加载)|安全退出|超时|失败|无效|异常|交接|凭据|回执|资源|busy|error/i.test(text);
      state.messages.push({role:'assistant', content: fault ? '本地模型这次没能处理，可能是本机正在切换或释放资源。请稍后再发一次；需要操作软件或生成时，可以切换到在线模型。' : text});
      state.error = ''; state.status = '';
    }
    // No credits: say so as a plain reply that points to the free model or a top-up.
    function creditShortageAsReply() {
      if (state.provider !== 'api' || !state.error || state.pending || !isCreditShortage(state.error)) return;
      state.messages.push({role:'assistant', content:CREDIT_SHORTAGE_REPLY});
      state.error = ''; state.status = '积分不足';
    }
    function notify() {
      if (retired) return;
      localErrorAsReply();
      creditShortageAsReply();
      sessions[state.provider] = {messages:state.messages.slice(-60),history:state.history,conversationId:state.conversationId};
      modelSessions[state.modelId]={messages:state.messages.slice(-60),history:state.history,conversationId:state.conversationId,activeTask:state.activeTask,historyOriginUnknown:state.historyOriginUnknown===true};
      onChange(state);
    }
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
        state.billingNotices=appendBillingNotice(state.billingNotices,row,turnSeq);notify();
        return activeOwner();
      } catch {return false;}
    }
    function visibleBillingNotices() {
      let currentOwner='';try {const binding=api()?.captureFoartBillingOwner?.();if(binding?.current?.()===true)currentOwner=binding.owner;}catch {}
      return state.billingNotices.filter(row=>row.owner===undefined || row.owner===currentOwner);
    }
    function dismissBillingNotice(id) {state.billingNotices=state.billingNotices.filter(item=>item.id!==id);notify();}
    function onlineBusinessUi(modelId,imageUploadGrant=null,selectionStillCurrent=()=>true) {
      const binding=api()?.captureFoartBillingOwner?.();
      const decimal=onlineOperationDecimalConfirmed();
      const operationBound=currentPricingPolicy()?.config?.xiaotao_online?.operation_art_v3===true;
      const acceptedCredits=value=>decimal ? creditUnits(value)!==null : Number.isSafeInteger(value)&&value>=0;
      const current=()=>!retired&&!!binding&&typeof binding.current==='function'&&binding.current()===true&&state.provider==='api'&&state.modelId===modelId&&selectionStillCurrent()===true;
      return {
        confirmImageUpload:async info=>{
          if(!current())return false;
          const accepted=typeof imageUploadGrant==='function'?await imageUploadGrant(info):true;
          return current()&&accepted===true;
        },
        onPricingQuote:()=>{if(current()){state.status='正在准备请求…';notify();}},
        confirmPricingQuote:async()=>current(),
        onBillingNotice:row=>{
          if(!binding?.current?.()||row?.submitted!==true||row.modelId!==modelId||typeof row.requestId!=='string')return false;
          const settled=row.quota?.status==='settled'&&acceptedCredits(row.quota.settled_credits);
          if(operationBound&&settled){publishBilling({id:row.requestId,modelId,owner:binding.owner,confirmed:row.quota.settled_credits,confirmedCount:1,unknown:row.unknown===true||(row.quota.uncollected_credits||0)>0,inFlight:false});return true;}
          if(!current())return false;
          if(settled)publishBilling({id:row.requestId,modelId,owner:binding.owner,confirmed:row.quota.settled_credits,confirmedCount:1,unknown:false,inFlight:false});
          return true;
        }
      };
    }
    function publishBilling(billing) {
      if(!billing)return;
      const row={id:billing.id,modelId:billing.modelId,confirmed:billing.confirmedCount?billing.confirmed:null,unknown:billing.unknown||billing.inFlight,...(billing.owner?{owner:billing.owner}:{})};
      state.billingNotices=appendBillingNotice(state.billingNotices,row,turnSeq);notify();
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
    function clearLocalCapability() {state.qwenExecutionDevice=null;state.qwen35CpuTrialAvailable=false;state.qwen35CpuTrialChecked=false;}
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
        
         updateSelectedLocalStatus(data); onChange(state);
      } catch {if(current()){clearLocalCapability();onChange(state);}}
    }
    function invalidate(message = '绘图内容已变化，原建议已失效') {if (state.proposal || state.applied) {bridge.clearPrepared(); state.proposal = null; state.proposalSnapshot = null; state.applied = false; state.status = message; notify();}}
    function refreshContext() {
      if (state.localSession?.state === 'warm' && Number.isFinite(state.localSession.idleExpiresAt) && state.localSession.idleExpiresAt <= Date.now()) {state.localSession = null; onChange(state);}
      if(activeMode==='media')return; // Media execution validates its own complete snapshot.
      if (state.applying) return;
      try {
      } catch { }
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
    // The candidate path reads the selected bone natively before model planning.
    // Frame and angle come from the explicit request; edits require confirmation.
    // Operation billing sends names and sizes of attachments, never pixels.
    function foartWireContext(snapshot){
      const media=/^(?:dataUrl|imageUrl|previewUrl|blob|bytes)$/i;
      return JSON.parse(JSON.stringify(snapshot,(key,value)=>media.test(key)||typeof value==='string'&&/^data:/i.test(value)?undefined:value));
    }
    async function sendFoart(message,{recordMessage=true,requestMessage=message,intent,animationIntent=false}={}) {
      const tools=root.NovaFlowFoartTools,contract=root.NovaFlowFoartToolContract,operation=++serial;
      let foartOperationSession=null,foartPreviousContext=null;
      const preferUploads=!!carryAttachments?.some(item=>item.kind==='image'),freshPictures=(carryAttachments||[]).filter(item=>item.kind==='image'&&item.dataUrl).slice(0,3);
      const positiveRequest=uploadApi()?.positiveTaskText?.(message)??message.replace(/(?:不要|不用|无需|不需要|不生成)[^，。；,;\n]*/g,'');
      const mediaEditIntent=/剪辑|裁切|截取|分割|淡入|淡出|音量|变速|时间轴|帧编辑|倒放|静音|音轨|独奏|片段/.test(positiveRequest)&&!/(?:生成|制作|做)(?:一[段个]|[0-9.]+秒|新的?|这个)?(?:视频|动画)/.test(positiveRequest);
      tools.setUploads?.(lastUploads);
      stopped=false;activeMode='foart';foartAbort=new root.AbortController();const signal=foartAbort.signal,receipts=[],attemptedPlans=new Map();
      const billing=state.provider==='api'?{id:root.crypto.randomUUID(),modelId:state.modelId,owner:billingOwner(),confirmed:0,confirmedCount:0,quoted:0,allQuoted:true,unknown:false,inFlight:false,decimal:onlineOperationDecimalConfirmed()}:null;
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
        if(!imageGuard()||imageSourceBinding(tools.capture())!==source)return false;
        if(!sameImages(candidate,images.map(item=>({role:item.role||'reference',dataUrl:item.dataUrl}))))return false;
        imageGrants.push({source,images:candidate});return true;
      };
      activeFoartBilling=billing;
      if(recordMessage)pushUser(message);
      state.pending=true;state.error='';state.status='正在读取 Foart 工具、素材和当前结果…';state.proposal=null;state.toolTrace=[];notify();
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
        :row.action==='art_action'?row.plannerPrompt?row.message:row.fileName?'已发起文件下载：'+row.fileName:row.phase==='completed'?'已完成'+(row.label||row.name)+'，实际结果已更新':row.phase==='returned'?'美工工具已返回：'+row.message:'已打开'+(row.label||row.name)
        :row.action==='open'?row.message:row.action==='set_control'?'已设置'+row.control+'：'+row.value:row.action==='draw'?(row.surface==='animation'?row.message:'已绘制选区'):row.message||'已操作'+row.control).join('\n');
      const onStatus=text=>{state.status=text;notify();};
      const toolBinding=(context,controlIds)=>{
        const mediaActive=!!context.media?.active,audioOnly=mediaActive&&context.media.sub==='audio';
        const videoEditing=mediaEditIntent&&mediaActive&&context.media.sub==='video';
        const media=context.media?.active===false?null:videoEditing?{active:true,sub:'video',video:context.media.video,videoResources:context.media.videoResources,generation:{boardId:context.media.generation?.boardId}}:audioOnly?{active:true,sub:'audio',audio:context.media.audio,audioResources:context.media.audioResources,videoResources:context.media.videoResources,audioSettings:context.media.audioSettings}:context.media;
        return JSON.stringify({art:!mediaActive&&context.art?{...context.art,error:undefined}:null,artEditor:!mediaActive&&context.artEditor?{editingTool:context.artEditor.editingTool,editingAction:context.artEditor.editingAction,objectTransfer:context.artEditor.objectTransfer,source:context.artEditor.source,size:context.artEditor.size,selected:context.artEditor.selected,layers:context.artEditor.layers}:null,media,animation:context.animation?{...context.animation,frame:undefined}:null,uiLayout:context.uiLayout,particle:context.particle,effects:context.effects,productionTools:context.productionTools,lastToolOutput:context.lastToolOutput,pose:context.pose,frameEditor:context.frameEditor,fields:context.controls.filter(c=>!(videoEditing&&c.scope==='video_generation')&&!c.disabled&&['input','textarea','select','checkbox'].includes(c.kind)&&(!controlIds||controlIds.has(c.id))).map(({id,label,section,kind,value})=>({id,label,section,kind,value})).sort((a,b)=>a.id.localeCompare(b.id))});
      };
      // Placed references finish loading after their receipt and then update the
      // native controls. Bind a plan only once those values have stopped moving.
      const settledCapture=async()=>{
        const read=()=>{const value=tools.capture();return {value,binding:toolBinding(value,new Set(value.controls.filter(c=>!c.volatile).map(c=>c.id)))};};
        let last=read(),same=0;
        for(let i=0;i<16&&same<2&&!signal.aborted;i++){
          await new Promise(resolve=>setTimeout(resolve,300));
          const next=read();same=next.binding===last.binding?same+1:0;last=next;
        }
        return last.value;
      };
      try{
        // A global request must be planned against the requested editor, not
        // the unrelated editor that happened to be open before the user spoke.
        // Otherwise an art attachment can be offered to a skeleton file input.
        const uiRequest=/\bUI\b|UI设计|UI版块|界面设计/i.test(positiveRequest);
        const specialized=uploadApi()?.effectsPanelRequest?.(message)===true||/粒子|压缩|去黑|图集|查看器|格式转换|模板制作|风格库/.test(positiveRequest);
        const explicitTools=/(?:工具(?:版块|板块|模块)|(?:PNG|JPG|MP4)\s*压缩|PNG\s*去黑|视频格式转换|图集.{0,8}WebP|Spine\s*查看器)/i.test(positiveRequest);
        const explicitEffects=/AI\s*特效|特效(?:版块|板块|模块).{0,12}(?:材质|视频|风格)/i.test(positiveRequest);
        const explicitParticle=/粒子(?:特效|编辑|系统)|发射器|发射率/.test(positiveRequest);
        const requestedSurface=!intent?.discussion&&!discussionOnly(message)
          ?animationIntent?'animation':explicitTools?'tools':explicitEffects?'effects':explicitParticle?'particle':(!specialized||uiRequest)
            ?intent?.surface==='image'?(uiRequest||intent.revision&&root.NovaFlowUiDesignDrawing?.isActive?.()?'ui':'drawing')
              :['animation','video','audio'].includes(intent?.surface)?intent.surface:null:null:null;
        // The planner never sees pixels. One billed look fills that gap; helpful, not required,
        // so a slow or failed look never holds up the request itself.
        const lookAt=async(pictures,question)=>{
          const lookId=root.crypto.randomUUID();
          const seen=await Promise.race([api()?.artAgentChat?.({requestId:lookId,provider:'api',...selectedModelPayload(state.modelId),...selectedPricingPayload(),mode:'chat',promptLanguage:'en',
            message:question,history:[],artContext:{},images:pictures.map((item,index)=>({dataUrl:item.dataUrl,role:'attachment',source:index+1,name:item.name})),uploads:[],
            imageSessionGuard:imageGuard,confirmImageUpload:async()=>imageGuard()}),new Promise(resolve=>setTimeout(()=>resolve(null),60000))]);
          if(seen)collectBilling(billing,seen);else await api()?.artAgentStop?.({requestId:lookId,provider:'api'});
          return seen?.ok===true?String(seen.data?.reply||''):'';
        };
        // Mask tools need a painted region: find the target by eye, then paint its box.
        let maskPainted=false;
        const paintTarget=async()=>{
          const dataUrl=root.NovaFlowSpineSplitBridge?.getState?.()?.source?.dataUrl,canvas=tools.capture().controls.find(control=>/选区画布/.test(control.label||'')&&!control.disabled);
          if(state.provider!=='api'||!dataUrl||!canvas||selectedPricingPayload().operationVisionBillingV3!==true)return false;
          const reply=await lookAt([{dataUrl,name:'image'}],'用户要求：'+message+'\n找到图片里要处理的目标。只输出 JSON：{"box":[左,上,右,下]}，四个数都是 0 到 1 的比例，框紧贴目标。');
          const box=(/\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/.exec(reply)||[]).slice(1).map(Number);
          if(box.length!==4||box.some(value=>!(value>=0&&value<=1))||box[2]<=box[0]||box[3]<=box[1])return false;
          const points=[];let left=true;
          for(let y=box[1];y<=box[3];y+=.02){points.push([left?box[0]:box[2],y],[left?box[2]:box[0],y]);left=!left;}
          await tools.execute({action:'draw',controlId:canvas.id,points},{snapshot:tools.capture(),signal});
          return true;
        };
        // A plan's prompt is only a brief. Every online brain sends it through the same per-mode
        // framework the panel uses, so the model never decides the final format.
        let videoDraft='';
        const frameworkPrompt=async op=>{
          const action=op.operation?.action,selected=businessModelSnapshot(),requestId=root.crypto.randomUUID(),terms=currentPricingPolicy()?.config?.xiaotao_online;
          const same=()=>{const now=businessModelSnapshot();return !signal.aborted&&now.provider===selected.provider&&now.modelId===selected.modelId&&now.epoch===selected.epoch;};
          const brief=String(op.operation?.prompt||'').trim().slice(0,1500),scope={assistantSelectionScope:'xiaotao',assistantProvider:selected.provider,assistantModelId:selected.modelId,assistantSelectionEpoch:selected.epoch,signal};
          if(!brief)return op;
          try{
            if(['generate_video','optimize_video_prompt'].includes(action)){
              if(videoDraft)return {...op,operation:{...op.operation,prompt:videoDraft}};
              // "好的，开始生成" changes nothing: the finished draft on the page goes out as it is.
              const h3=root.NovaFlowAiSequenceMiniMaxH3PromptWorkflow,page=root.NovaFlowAiSequenceGeneration?.capture?.();
              if(action==='generate_video'&&h3?.hasDraft?.(page?.genType,page?.prompt)&&uploadApi()?.bareGenerateCommand?.(message)===true)return {...op,operation:{...op.operation,prompt:page.prompt}};
              const capture=root.NovaFlowMediaAgent?.captureH3TextDraft,method=api()?.promptAssistantVideoDraft;
              if(terms?.operation_video_rewrite_v3!==true||typeof capture!=='function'||typeof method!=='function')return op;
              onStatus('正在按视频框架整理提示词…');
              if(root.NovaFlowAudioStudio?.isOpen?.()!==true||root.NovaFlowAudioStudio?.sub?.()!=='video')await tools.execute({action:'open',surface:'video'},{signal});
              // A mode the user names wins over the one the page was left on.
              if(intent?.mode&&/文生|图生|首尾帧|多参/.test(positiveRequest)&&root.NovaFlowAiSequenceGeneration?.capture?.()?.genType!==intent.mode){
                uploadApi()?.switchMode?.(root.document,intent.mode);
                for(let i=0;i<20&&root.NovaFlowAiSequenceGeneration?.capture?.()?.genType!==intent.mode;i++)await new Promise(resolve=>root.setTimeout(resolve,100));
              }
              const includeReferenceImages=['first_last','image_video'].includes(root.NovaFlowAiSequenceGeneration?.capture?.()?.genType)&&api()?.onlineVideoVisionAvailableSync?.()===true;
              // The framework binds pictures by @参考图N; a brief with model tokens fails its checks.
              const bindMaterials=source=>{
                const text=source.replace(/(?:@?参考图\s*(\d+))?[（(]?<Picture\s*(\d+)>[）)]?/g,(_,a,b)=>'@参考图'+(a||b)).replace(/(^|[^@参考])图\s*(\d+)/g,'$1@参考图$2').replace(/(^|[^@])参考图\s*(\d+)/g,'$1@参考图$2').replace(/(^|[^@])(?:参考)?视频\s*(\d+)/g,'$1@视频参考$2').replace(/(^|[^@])(?:参考音频|音频|声音参考)\s*(\d+)/g,'$1@声音参考$2');
                // Every attached 多参 material must be named, or H3 is handed a file the prompt never uses.
                const missing=(root.NovaFlowFoartTools.capture().media?.generation?.h3References||[]).map(ref=>/^multi_ref_(image|video|audio)_(\d+)$/.exec(ref.key||'')).filter(Boolean)
                  .map(match=>({image:'@参考图',video:'@视频参考',audio:'@声音参考'}[match[1]]+match[2])).filter(label=>!text.includes(label));
                return (missing.length?text+'。同时使用 '+missing.join('、')+'。':text).slice(0,1500);
              };
              let result=null,text='';
              let draftIssue='';
              for(const firstSource of [bindMaterials(brief),bindMaterials(message)]){
                // The retry is told what the last draft got wrong, the way the planner retry is.
                const sourcePrompt=draftIssue?(firstSource+'\n上一稿被退回的原因：'+draftIssue+'。这次必须改正。').slice(0,1500):firstSource;
                // 多参 checks its result against the requirement text word by word; the brief already carries everything.
                const multi=root.NovaFlowAiSequenceGeneration?.capture?.()?.genType==='multi_reference';
                const snapshot=await capture({requestId:root.crypto.randomUUID(),requirements:multi?'':(message+(pictureFacts?'\n'+pictureFacts:'')).slice(0,1000),sourcePrompt,includeReferenceImages});
                const current=()=>same()&&snapshot.isCurrent()===true;
                const {onPricingQuote,confirmPricingQuote,confirmImageUpload}=onlineBusinessUi(selected.modelId,includeReferenceImages?()=>true:null,current);
                result=await method({request:snapshot.request,...scope,isInputCurrent:current,onPricingQuote,confirmPricingQuote,confirmImageUpload,onBillingNotice:()=>true});
                if(result?.quota)collectBilling(billing,{ok:true,data:{quota:result.quota}});
                text=result?.ok===true?String(result.draft?.displayPrompt||'').trim():'';
                if(text)break;
                draftIssue=String(result?.draftIssue||'');
              }
              if(!text)return op;
              h3?.rememberDraft?.({mode:result.draft.h3Mode,prompt:text,modelText:result.draft.modelPrompt});
              videoDraft=text;return {...op,operation:{...op.operation,prompt:text}};
            }
            if(['generate_music','generate_sfx'].includes(action)){
              const kind=action==='generate_music'?'music':'sfx',method=api()?.promptAssistantRewriteAudioPrompt,settings=root.NovaFlowAudioStudio?.agentSettings?.();
              if(terms?.operation_audio_rewrite_v3!==true||typeof method!=='function')return op;
              onStatus('正在按音频框架整理提示词…');
              const seconds=Math.max(1,Math.round(op.operation.seconds??settings?.[kind]?.seconds??(kind==='music'?30:2))),bpm=op.operation.bpm??settings?.music?.bpm;
              const result=await method({requestId,kind,input:brief,seconds,...(kind==='music'&&bpm!==undefined?{bpm}:{}),...scope,...onlineBusinessUi(selected.modelId,null,same),onBillingNotice:()=>true});
              const data=result?.result||result?.data||result;
              if(data?.quota)collectBilling(billing,{ok:true,data:{quota:data.quota}});
              const text=result?.ok===false?'':String(data?.prompt||'').trim();
              return text?{...op,operation:{...op.operation,prompt:text}}:op;
            }
          }catch(error){root.console?.warn?.('[Foart tools] framework prompt skipped:',String(error?.message||error));}
          return op;
        };
        let pictureFacts='';
        // 图生 and 首尾帧 hand their frames to the framework itself, so they need no separate look.
        const framesInDraft=['image_video','first_last'].includes(intent?.mode)&&api()?.onlineVideoVisionAvailableSync?.()===true;
        const videoPictures=state.provider==='api'&&intent?.surface==='video'&&!framesInDraft?freshPictures:[];
        if(videoPictures.length&&selectedPricingPayload().operationVisionBillingV3===true){
          onStatus('正在看图…');
          // One picture per look: several in one request run past the edge function's limit.
          const facts=[];
          for(const [index,picture] of videoPictures.entries()){const seen=(await lookAt([picture],'用不超过六十字客观描述图片：人物朝向、姿势、服饰、场景和画风。只输出描述。')).trim();if(!seen)break;facts.push('图'+(index+1)+'：'+seen);}
          pictureFacts=facts.join('\n').slice(0,500);
        }
        let planningLimit=10,mixHandoffBudget=false,exportScopeRetries=0,mixRemovalRetries=0,artActionRetries=0,invalidPlanRetries=0,invalidPlanIssue='';const finishedOps=new Set(),opKey=op=>op.action==='media'&&op.operation?.action==='optimize_video_prompt'?'optimize_video_prompt':JSON.stringify(op);
        const enhancementNames={split:'一键拆图',generativeSplit:'对象分离',imageOutpaint:'无限扩图',imageUpscale:'高清放大',objectTransfer:'万物迁移',imageAngleAdjust:'角度调整',poseReference:'姿势参考'};
        const namedEnhancements=Object.keys(enhancementNames).filter(name=>positiveRequest.includes(enhancementNames[name]));
        for(let round=0;round<planningLimit;round++){
          if(signal.aborted||operation!==serial)return false;
          const pending=await tools.settlePending({signal,onStatus});if(pending)receipts.push(pending);
          // The planner cannot see the picture, so a mask tool stops here and hands the brush to the user.
          if(['returned','opened'].includes(pending?.phase)&&/遮罩|涂抹|涂满|框选/.test(pending.message||'')){
            if(!maskPainted&&await paintTarget()){maskPainted=true;finishedOps.clear();const selection=root.NovaFlowSpineSplitBridge?.getState?.()?.selectionTool;if(['inpaintEdit','inpaintCompletion'].includes(pending.name)&&selection&&!String(selection.inpaintPrompt||'').trim())selection.inpaintPrompt=String(message).trim().slice(0,300);pending.message='已按看图结果涂好目标区域，不要再绘制。局部编辑先写好修改说明，然后再次执行同一个工具。';}
            else{pending.plannerPrompt=true;pending.message='已打开'+({cutout:'智能抠图',penCutout:'钢笔抠图',generativeSplit:'对象分离',inpaintCompletion:'智能补图',inpaintEdit:'局部编辑',inpaintRepair:'去除物体'}[pending.name]||'工具')+'。请在画板上涂出要处理的区域，再点一次工具按钮执行。';}}
          if(signal.aborted||operation!==serial||billing&&(state.provider!=='api'||state.modelId!==billing.modelId))return false;
          // Reading the current video frame can finish native metadata loading
          // (including its real FPS). Bind the plan after that work settles.
          const hasCurrentImage=receipts.some(row=>row.outputs?.some(output=>output.imageUrl||output.dataUrl||/\.(png|jpe?g|webp)$/i.test(output.name||'')));
          const imageSourceBefore=imageSourceBinding(tools.capture());
          const images=[];
          if(signal.aborted||operation!==serial||billing&&(state.provider!=='api'||state.modelId!==billing.modelId))return false;
          const snapshot=await settledCapture();let expectedSnapshot=snapshot;
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
            +(/音乐|音效|配乐|声音/.test(positiveRequest)?'\n音频直接用一个 generate_music 或 generate_sfx 操作，把时长放在 seconds 里，不要先 set_control。':'')
            // The framework adds sound and music itself; a brief saying "no music" would switch that off.
            +(/视频|首尾帧|多参|图生|文生/.test(positiveRequest)||intent?.surface==='video'?'\n视频 prompt 只写画面和动作，用户没提声音就不要写声音或音乐。':'')
            +(pictureFacts?'\n图片实际内容（看图结果，写提示词时以此为准）：'+pictureFacts:'')
            +(invalidPlanRetries?'\n上一步方案不符合工具规则，未执行'+(invalidPlanIssue?'（'+invalidPlanIssue+'）':'')+'。只用 currentFoart 里真实存在的 ID；提示词不要用 set_control 写入，视频用 media 的 optimize_video_prompt 或 generate_video，绘图用 image_optimize 或 image_generate。这次只输出一个合法操作。':'')
            +(exportScopeRetries?'\n上轮方案未执行：导出范围与本轮最新要求不符。只安排本轮要求的动画文件，不重复背景中的工程/视频导出。':'')
            +(mixRemovalRetries?'\n上轮移除旧声音的方案未执行：旧混音仍保留。先完成新混音并把它导入当前剪辑，再替换旧混音片段，避免中途失败把原来的声音丢掉。':'')
            +(artActionRetries?'\n上轮美工入口选择不符，未执行：用户明确要求'+enhancementNames[namedEnhancements[0]]+'，对应 art_action name:'+namedEnhancements[0]+'。不要改用其他增强功能。无限扩图需要完整尺寸和具体画面 prompt。':'');
          if(planMessage.length>12000)fail('本次需求与执行记录过长，已保留已完成操作，请缩短补充说明');
          activeRequest=root.crypto.randomUUID();if(round===0)activeStartedAt=Date.now();state.status=(receipts.length?summarize(receipts.slice(-1)).slice(0,100)+'；':'')+'小桃正在安排下一步…';notify();
          const finalSurface=/AI特效/.test(message)?'effects':intent?.surface==='audio'?'audio':intent?.surface==='video'||/视频|动画|循环/.test(message)?'video':'image';
          const finalOutput=receipts.some(r=>r.phase==='completed'&&(finalSurface==='image'?r.action==='image_generate':finalSurface==='effects'?r.action==='effect_generate':(r.results||[]).some(v=>(finalSurface==='video'?v.action==='generate_video':['generate_music','generate_sfx'].includes(v.action))&&v.resources?.length)));
          const exportBrief=positiveRequest.split(/[。；;\n]/).map(clause=>clause.match(/(?:导出|下载)[\s\S]*/)?.[0]||'').join('；');
          const exportFormats=[...new Set((exportBrief.match(/\b(?:PNG|PSD|JSON)\b/gi)||[]).map(value=>value.toLowerCase()))];
          const actualArtFiles=receipts.filter(r=>r.action==='art_action'&&r.name==='export'&&r.phase==='completed'&&r.fileName);
          // A prompt written through the online optimizer ends the run here; the pending operation settles in finally.
          const finishNow=receipts.some(r=>r?.plannerPrompt===true);
          const terminalFacts=receipts.filter(r=>r.phase==='completed'||r.action==='image_optimize'&&r.phase==='applied');
          if(signal.aborted||operation!==serial||billing&&(state.provider!=='api'||state.modelId!==billing.modelId))return false;
          if(!finishNow&&billing){billing.inFlight=true;publishBilling(billing);}
          const plannerSource=imageSourceBinding(snapshot),plannerImages=images.map(item=>({role:item?.role||'reference',dataUrl:item?.dataUrl}));
          const plannerImageGuard=()=>imageGuard()&&imageSourceBinding(tools.capture())===plannerSource&&sameImages(plannerImages,images.map(item=>({role:item?.role||'reference',dataUrl:item?.dataUrl})));
          const responsePromise=finishNow?Promise.resolve({ok:true,data:{toolPlan:{schema:contract.FOART_TOOL_SCHEMA,status:'done',reply:receipts.find(r=>r?.plannerPrompt===true)?.message||summarize(terminalFacts.length?terminalFacts:receipts),operations:[]}}}):foartOperationSession?api()?.foartOperationResume?.({requestId:activeRequest,session:foartOperationSession,previousContext:foartPreviousContext,receipt:receipts.at(-1),context:foartWireContext(snapshot),signal})
              :api()?.foartOperationStart?.({requestId:activeRequest,modelId:state.modelId,...selectedPricingPayload(),message:planMessage,history:compactFoartHistory(previousHistory),promptLanguage:'en',foartContext:foartWireContext(snapshot),signal})
          if(!finishNow)startStatusPolling(operation,activeRequest);let response=await responsePromise;stopStatusPolling();
          // The tool already finished; a planner round that times out or outlives its ticket must not turn real work into an error.
          if(response&&response.ok!==true&&response.errorCode!=='operation-planner-incomplete'&&receipts.at(-1)?.phase==='completed'){if(response.errorCode==='invalid-operation-ticket')foartOperationSession=null;response={ok:true,data:{toolPlan:{schema:contract.FOART_TOOL_SCHEMA,status:'done',reply:summarize(receipts.slice(-1)),operations:[]}}};billing.inFlight=false;billing.unknown=false;}
          if(response?.data?.foartOperationSession||response?.session){foartOperationSession=response.data?.foartOperationSession||response.session;foartPreviousContext=foartWireContext(snapshot);billing.inFlight=false;billing.unknown=true;publishBilling(billing);}
          else if(!finishNow){if(response?.data?.quota?.status==='settled'){billing.unknown=false;foartOperationSession=null;}collectBilling(billing,response);}
          if(signal.aborted||operation!==serial)return false;
          // The server settles a rejected plan; a fresh operation gets one more chance with the rules spelled out.
          if(response?.errorCode==='operation-planner-incomplete'&&invalidPlanRetries<2){invalidPlanRetries++;invalidPlanIssue=response.planIssue||'';foartOperationSession=null;foartPreviousContext=null;continue;}
          if(!response?.ok){handlePricingFailure(response);fail(response?.errorCode==='operation-planner-incomplete'?'小桃这一步没有给出可执行的方案，已完成的操作已保留，请换个说法再试。':response?.error||'Foart 工具规划未完成');}
          const data=response.data;if(!data?.toolPlan)fail('工具规划服务尚未更新，未提交操作');
          let plan=contract.validateFoartPlan(data.toolPlan,snapshot);
          // A brain that answers a video prompt request in prose skips the H3 framework: send it through.
          if(plan.status!=='act'&&!receipts.length&&forbidsGeneration(message)&&/视频/.test(positiveRequest)&&/提示词/.test(message))plan={...plan,status:'act',reply:'已按视频框架写好提示词。',operations:[{action:'media',operation:{action:'optimize_video_prompt',target:'video',prompt:positiveRequest.slice(0,1500)}}]};
          // "帮我生成…视频" writes the prompt AND submits; a brain that stops at the prompt step would leave the user waiting.
          if(plan.status==='act'&&uploadApi()?.videoRequestKind?.(message)==='generate')plan={...plan,operations:plan.operations.map(op=>op.action==='media'&&op.operation?.action==='optimize_video_prompt'?{...op,operation:{...op.operation,action:'generate_video'}}:op)};
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
          // Only a repeat of a generation that already finished is dropped; a picture made first does not block the video asked for next.
          const generatedKinds=new Set(receipts.filter(r=>r.phase==='completed').flatMap(r=>r.action==='image_generate'?['image_generate']:(r.results||[]).filter(v=>v.action?.startsWith('generate_')&&v.resources?.length).map(v=>v.action)));
          const repeatsGeneration=op=>op.action==='image_generate'?generatedKinds.has('image_generate'):op.action==='media'&&op.operation.action.startsWith('generate_')&&generatedKinds.has(op.operation.action);
          if(generatedKinds.size&&plan.status==='act'&&plan.operations.some(repeatsGeneration)){
            plan={...plan,operations:plan.operations.filter(op=>!(repeatsGeneration(op)||op.action==='use_result'&&generatedKinds.has('image_generate')))};
            if(!plan.operations.length)plan={...plan,status:'done',reply:'本次生成已有实际结果。'};
          }
          if(plan.status==='act'&&(preferUploads||lastUploads.some(item=>item.kind==='image'))&&!generatedKinds.has('image_generate')){
            plan={...plan,operations:plan.operations.map(keepTurnPictures).filter(Boolean)};
            if(!plan.operations.length)plan={...plan,status:'done',reply:'已保留本轮参考图，没有使用上一张结果。'};
          }
          const pagePictures=Array.from(root.__NovaFlowArtGenerate?.references?.()||[]).filter(Boolean).length;
          const imageOp=plan.status==='act'?plan.operations.find(op=>['image_optimize','image_generate'].includes(op.action)):null;
          const styleRun=imageOp?planStyleRun(imageOp,positiveRequest,pagePictures,!!currentSubject,preferUploads||lastUploads.some(item=>item.kind==='image')):null;
          if(styleRun?.ask)plan={...plan,status:'clarify',reply:styleRun.ask,operations:[]};
          else if(styleRun){const single={...imageOp,action:'image_generate',generationMode:'img2img',useResult:false};styleRuns.set(single,styleRun);plan={...plan,operations:[single]};}
          else if(pageLimitQuestion(imageOp,pagePictures))plan={...plan,status:'clarify',reply:pageLimitQuestion(imageOp,pagePictures),operations:[]};
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
          // A planner that repeats a step this turn already ran has finished; running it again would export twice.
          if(plan.status==='act'){
            const fresh=plan.operations.filter(op=>!finishedOps.has(opKey(op)));
            plan=fresh.length?{...plan,operations:fresh}:{...plan,status:'done',reply:summarize(receipts),operations:[]};
          }
          state.model=data.model||state.model;
          if(plan.status!=='act'){
            const actual=summarize(receipts),done=receipts.some(r=>r.phase==='completed');
            // Attachment placement runs before planning, so "already in place" is a fair answer; only a claimed output needs a receipt.
            if(plan.status==='done'&&!actual&&/生成(?:好了|完成|成功)|(?:已经|已)(?:生成|制作完成|完成制作|导出)|制作(?:好了|完成|成功)|导出(?:好了|完成|成功)/.test(plan.reply))fail('尚无实际工具回执，不能报告制作完成');
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
            const content=(receipts.length?(!finishNow&&replyMatches&&plan.reply!==receiptText?plan.reply+'\n\n':'')+receiptText:plan.reply).trim()||actual;
            const quota=billingReceipt(billing);
            const downloads=receipts.flatMap(r=>(r.outputs||[]).map(output=>output.downloadId).filter(Boolean));
            state.messages.push({role:'assistant',content,...(downloads.length?{downloads}:{}),...(quota?{receipt:creditReceipt(quota)}:{})});
            if(quota)clearBillingNotice(billing);
            state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content:content+'\n实际工具回执：'+JSON.stringify(receipts.map(compactFoartReceipt)).slice(-8000)}].slice(-12);state.conversationId='';
            const mediaFacts=receipts.flatMap(r=>r.results||[]),lastMedia=mediaFacts.at(-1),generatedMedia=mediaFacts.findLast(r=>r.action?.startsWith('generate_'));
            const nativeVideoResult=receipts.some(r=>r.resources?.some(v=>/\.(mp4|webm)$/i.test(v.name||'')));
            const openedSurface=receipts.findLast(r=>r.action==='open')?.surface;
            const actualSurface=(receipts.some(r=>r.action==='animation')?'animation':receipts.some(r=>r.action==='particle'||r.particle)?'particle':receipts.some(r=>r.action==='tool')?'tools':receipts.some(r=>r.action==='effect_generate'||r.action==='effect_export')?'effects':lastMedia?(lastMedia.target||(/^generate_(music|sfx)$/.test(lastMedia.action)?'audio':lastMedia.action==='generate_video'?'video':null)):nativeVideoResult?'video':receipts.some(r=>['image_generate','image_optimize','art_action','ui_layout','use_result'].includes(r.action)||r.layers?.length)?'image':null)||({drawing:'image',ui:'image',video:'video',audio:'audio',tools:'tools',effects:'effects',particle:'particle',animation:'animation'}[openedSurface]||null);
            const actualMode=actualSurface==='animation'?(receipts.findLast(r=>r.context?.animation)?.context.animation||'spine'):generatedMedia?.mode||(generatedMedia?.action==='generate_music'?'music':generatedMedia?.action==='generate_sfx'?'sfx':'')||(actualSurface==='image'?receipts.findLast(r=>r.action==='image_generate')?.mode:priorTask?.surface===actualSurface?priorTask?.mode:actualSurface==='audio'?'audio_edit':(actualSurface||intent?.surface)==='video'?(['text_video','image_video','first_last','multi_reference'].includes(root.NovaFlowAiSequenceGeneration?.capture?.()?.genType)?root.NovaFlowAiSequenceGeneration.capture().genType:'video_edit'):'')||'';
            if(receipts.length)state.activeTask={...(intent?.revision?priorTask:{}),executor:'foart',surface:actualSurface||intent?.surface||priorTask?.surface||'image',mode:actualMode,baseRequest:intent?.revision?priorTask?.baseRequest||message:message,revisions:intent?.revision?[...(priorTask?.revisions||[]),message].slice(-8):[],status:done?'completed':'applied',outputs:receipts.flatMap(r=>r.outputs?.length?r.outputs:r.resources?.length?r.resources:r.result?.resources?.length?r.result.resources:r.id?[{id:r.id,name:r.name}]:r.results?.flatMap(v=>v.resources||[])||[])};
            pendingIntent=!done&&(plan.status==='clarify'||endsWithQuestion(plan.reply))?{...(intent&&intent.surface!=='chat'?intent:{surface:'foart',mode:''}),foart:true,message:requestMessage}:null;
            state.status=plan.status==='clarify'?'等待补充需求':done?'工具执行已完成':receipts.length?'已按实际回执更新':'已回复';state.operation=null;return true;
          }
          if(discussionOnly(requestMessage))fail('本次仅讨论，未授权工具修改');
          const stableControls=new Set(snapshot.controls.filter(c=>!c.volatile).map(c=>c.id));
          const attemptKey=JSON.stringify(plan.operations)+'|'+toolBinding(snapshot,stableControls),attempts=(attemptedPlans.get(attemptKey)||0)+1;attemptedPlans.set(attemptKey,attempts);
          if(attempts>2)fail('当前操作没有改变工具状态，已停止重复执行；请求尚未完成');
          if((forbidsGeneration(message)||/只优化|只修改提示词/.test(message))&&plan.operations.some(op=>['image_generate','effect_generate'].includes(op.action)||op.action==='media'&&op.operation?.action?.startsWith('generate_')))fail('本次未授权生成，未提交任务');
          const receiptsBefore=receipts.length;
          for(const op of plan.operations){
            if(signal.aborted)fail('Foart 操作已停止');
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
            // The upload step already chose the video mode for these frames; a plan
            // may only change it when the user named another mode.
            const modeLabel=current.controls.find(c=>c.id===op.controlId)?.label;
            if(/^(?:文生视频|图生视频|首尾帧视频|多参视频)$/.test(modeLabel||'')&&lastPreparedTask.startsWith('video:')&&!positiveRequest.includes(modeLabel.replace('视频','')))continue;
            contract.validateFoartPlan({...plan,operations:[op]},current);
            if(signal.aborted||operation!==serial)fail('Foart 操作已停止');
            // "先画…再做成视频": the picture made earlier in this turn becomes the 图生视频 frame, the way an attached picture would.
            if(op.action==='media'&&op.operation?.action==='generate_video'&&!/文生视频/.test(positiveRequest)){
              const picture=receipts.findLast(r=>r.action==='image_generate'&&r.phase==='completed'&&r.outputs?.length),video=root.NovaFlowAiSequenceGeneration?.capture?.();
              const made=picture&&Array.from(root.__NovaFlowArtGenerate?.state?.results||[]).find(item=>item?.id===picture.outputs[0].id);
              if(made?.imageUrl&&!(video?.h3References||[]).length&&!(video?.references||[]).some(Boolean)){
                const blob=await (await root.fetch(made.imageUrl)).blob(),name=String(picture.outputs[0].name||'成图.png').replace(/(\.(?:png|jpe?g|webp))?$/i,m=>m||'.png');
                const file=new root.File([blob],name,{type:blob.type||'image/png'});
                await host().place({destination:uploadApi().destinationById('image_video'),file,kind:'image',name});
                receipts.push({action:'assign_upload',phase:'applied',name,message:'已把本轮生成的 '+name+' 放入图生视频参考'});
              }
            }
            root.console?.debug?.('[Foart tools] execute',op.action,op.name||op.operation?.action||op.operation||current.controls.find(control=>control.id===op.controlId)?.label||op.resourceId||'',op.value??'');
            let receipt;
            if(styleRuns.has(op))receipt=await runStyle(styleRuns.get(op),signal);
            else if(['image_optimize','image_generate'].includes(op.action)){
              const pictures=Array.from(root.__NovaFlowArtGenerate?.references?.()||[]).filter(Boolean).length;
              receipt=await plannerDrawingPrompt({...op,prompt:renumberTurnMentions(op.prompt,pictures)},renumberTurnMentions(message,pictures));
              // "先画…然后做成视频": a finished picture is one step of the request, so the planner gets the next round.
              if(op.action==='image_generate'&&receipt?.phase==='completed'&&/然后|接着|之后|再把|再用|再做|做成|转成|导出|保存|配乐|配音|视频|动画/.test(positiveRequest))delete receipt.plannerPrompt;
            } else receipt=await tools.execute(state.provider==='api'&&op.action==='media'?await frameworkPrompt(op):op,{snapshot:current,fingerprint,signal,requirements:requestMessage,optimizerRequirements:message,onStatus,provider:state.provider,modelId:initialSelection.modelId,selectionStillCurrent,...(state.provider==='api'?{onlineBusiness:onlineBusinessUi(state.modelId,authorizeImages)}:{})});
            receipts.push(receipt);if(!['set_control','activate_control','open'].includes(op.action))finishedOps.add(opKey(op));
            // A finished generation with nothing queued after it needs no paid planner round to say so.
            if(op.action==='media'&&/^(?:generate_|optimize_video_prompt$)/.test(op.operation?.action||'')&&receipt.phase==='completed'&&!/然后|接着|之后|导出|保存|裁|剪|配乐|配音|加音|合成/.test(positiveRequest.replace(/^[\s，,。]*(?:然后|接着|之后)/,'')))receipt.plannerPrompt=true;
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
            if(op.action==='art_action'||op.action==='ui_layout'||op.action==='assign_upload'||op.action==='frame_open'||op.action==='media'&&['import_resource','save_mix'].includes(op.operation.action))break;
          }
          // Every skipped step still answers the planner, or its next round has nothing to read.
          if(receipts.length===receiptsBefore)receipts.push({action:'skipped',phase:'applied',message:'这一步无需执行：视频模式已按上传素材选好。请继续下一步。'});
        }
        fail('本轮已到工具规划步数上限，已完成的操作已保留，请继续说明下一步');
      }catch(error){
        if(billing?.inFlight){billing.inFlight=false;billing.unknown=true;publishBilling(billing);}
        if(operation===serial){state.error=plainFoartError(error);state.status=signal.aborted?'已停止等待；请按工具当前状态确认未结束任务':'工具操作未全部完成';
          if(receipts.length){
            const meaningful=receipts.filter(row=>row.phase==='completed'||row.action==='set_control'||row.action==='draw'||row.action==='ui_layout'||row.action==='image_optimize'&&row.phase==='applied');
            const rows=[...new Map(meaningful.map(row=>[row.action+'|'+row.control+'|'+String(row.value)+'|'+row.id,row])).values()];
            const facts=rows.length?summarize(rows.slice(-8)):'已打开工具，但实际修改尚未完成。';
            const downloads=receipts.flatMap(row=>(row.outputs||[]).map(output=>output.downloadId).filter(Boolean));
            state.messages.push({role:'assistant',content:facts,...(downloads.length?{downloads}:{})});state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content:'实际执行事实：'+JSON.stringify(receipts.map(compactFoartReceipt)).slice(-8000)+'\n未完成：'+state.error}].slice(-12);
          } else state.history=[...previousHistory,{role:'user',content:message},{role:'assistant',content:'未完成：'+state.error}].slice(-12);
        }return false;
      }finally{if(foartOperationSession&&typeof api()?.foartOperationCancel==='function'){
        try{const cancelled=await api().foartOperationCancel({session:foartOperationSession});if(cancelled?.billingConfirmed&&cancelled?.data?.quota?.status==='settled'){billing.unknown=false;collectBilling(billing,cancelled);}}
        catch{/* Unknown billed state remains visible for reconciliation. */}}
        if(billing?.inFlight){billing.inFlight=false;billing.unknown=true;publishBilling(billing);}if(activeFoartBilling===billing)activeFoartBilling=null;if(operation===serial){root.NovaFlowAgentExportSession=null;stopStatusPolling();foartAbort=null;activeRequest='';state.pending=false;state.generating=false;state.operation=null;notify();}}
    }
    async function send(message, {includeResult = false, recordMessage = true} = {}) {
      if (retired) return false;
      if (CHAT_MODELS[state.modelId]?.retired) {state.error=CHAT_MODELS[state.modelId]?.detail||'该线路已移除';state.status='未提交，不扣积分';notify();return false;}
      if(state.uploading || state.staging)return false;
      if (state.pending || state.generating || state.applying) return false;
      message = String(message || '').trim();
      if(message && state.promptSourceCancelledNotice){state.status=state.status.replace(state.promptSourceCancelledNotice,'').trim();state.promptSourceCancelledNotice='';}
      if (!message) {if ((state.staged || []).length) {state.messages.push({role:'assistant',content:'请先说明这些文件的用途，再发送'}); state.error = ''; notify();} return false;}
      // 附件只属于发送它的那一条消息：新一条消息不再暗中带上之前发过的附件。
      // 只有在回答小桃刚才的提问时，才继续使用那条消息的附件。
      if(!answersQuestion(message)){lastUploads=[];lastPreparedTask='';}
      const explicitResultRequested=includeResult;
      const explicitNewQwenImage=state.modelId==='qwen3.5-9b-heretic' && state.staged.some(item=>item.kind==='image');
      
      const newConversation=/^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$/.test(message);
      if(newConversation){reset();lastUploads=[];currentSubject=null;return true;}
      // This is deliberately narrow: the user explicitly asks to optimize the
      // CURRENT drawing prompt AND generate. Other source-choice and compound
      // requests continue through their existing paths.
      const explicitDrawingGeneration=state.provider==='api'&&!pendingPromptSource&&!forbidsGeneration(message)&&
        /^(?:请|帮我)?\s*(?:先)?优化(?:一下)?(?:当前|页面(?:上|里)?的?)?提示词[，,\s]*(?:然后|并且?|再)(?:帮我|给我)?(?:生成|生图|出图)(?:一张)?(?:图片|图)?[。.!！\s]*$/i.test(message);
      if(explicitDrawingGeneration){const info=activePromptSource();if(!info||info.surface!=='drawing'||!info.pagePrompt.trim()){
        state.error='请先在绘图页面填写当前提示词；本次未提交或扣费。';state.status='未提交';notify();return false;}}
      const reverseImage=state.provider==='api'&&imageReverseRequest(message);
      // 本地反推走和"优化提示词"同一条路：提示词节点读参考图，结果写进提示词框。没有图才建议切换在线模型。
      if(state.provider==='local'&&imageReverseRequest(message)){
        const hasPicture=state.staged.some(item=>item.kind==='image')||Array.from(root.__NovaFlowArtGenerate?.references?.()||[]).some(Boolean);
        if(activePromptSource()?.surface==='drawing'&&hasPicture)return runLocalPromptOffer({message:'根据参考图反推提示词：写清主体、外观、服装、动作、场景、光线和画风，要能重新生成这张图。'},message,{recordMessage});
        const reply='本地模型看不到图片，没法反推。请在上方切换到在线模型（例如 DeepSeek V4.1 Flash），再发一次“反推一下图片”，在线模型会读取图片写出提示词。';
        if(recordMessage)pushUser(message);state.messages.push({role:'assistant',content:reply});state.error='';state.status='本地模型不读取图片，未执行。';notify();return true;
      }
      if(reverseImage)pendingPromptSource=null;
      let promptSelection=reverseImage?null:preparePromptSource(explicitDrawingGeneration?'优化当前提示词':message,{recordMessage});
      if(promptSelection?.stop)return false;
      if(explicitDrawingGeneration&&promptSelection)promptSelection={...promptSelection,message,generateAfterReview:true};
      if(state.provider==='api' && !currentPricingPolicy()) {
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
      if(h3TextRequest) {
        const remainder=message.replace(/(?:不要|不用|无需|别|不)(?:再|直接|自动)?\s*(?:生成|制作|分析|执行|应用|保存|导出|提交)(?:视频|音频|素材)?/g,'');
        if(/生成|制作|分析|观看|识别|收听|试听|执行|应用|保存|导出|提交|删除/.test(remainder)) {
          state.error='此入口只提供视频文字草稿，不能分析素材、修改作品或生成视频；请分别提出其他操作。';state.status='未提交';notify();return false;
        }
        return prepareSelectedH3TextDraft(message,{recordMessage});
      }
      const uiPromptIntent=currentUiPromptIntent(message);
      if(!root.NovaFlowXiaotaoPromptSource&&root.NovaFlowUiDesignDrawing?.isActive?.()===true&&uiPromptIntent!=='none') {
        if(uiPromptIntent==='compound'){state.error='这条请求同时包含提示词优化和其他操作，请分别提出；本次未提交或扣费。';state.status='未提交';notify();return false;}
        if((state.provider==='api'&&currentPricingPolicy()?.config?.xiaotao_online?.operation_ui_draft_v3!==true)||
          (state.provider!=='api'&&!(state.provider==='local'&&state.modelId==='qwen3.5-9b-heretic'))){state.error='当前所选模型尚不支持 UI 提示词草稿，未提交或扣费。';state.status='未提交';notify();return false;}
        return prepareSelectedUiDraft(message,{recordMessage});
      }
      const communityChatOnly=state.modelId==='qwen3.5-9b-heretic';
      if(pendingLocalPromptOffer){const offer=pendingLocalPromptOffer;pendingLocalPromptOffer=null;
        if(communityChatOnly&&/^(?:要|是|是的|好|好的|可以|行|嗯|写吧|来吧|直接写|生成吧?)[。.!！\s]*$/.test(message.trim()))return runLocalPromptOffer(offer,message,{recordMessage});}
      // An operation-billed message includes only explicitly selected uploads;
      // an old image is reused only when the user refers back to it.
      const operationUploadScope=state.provider==='api' && selectedPricingPayload().operationBillingV3===true;
      const explicitPreviousImage=/(?:\u521a\u624d|\u521a\u521a|\u4e0a\u4f20|\u4e4b\u524d|\u4e0a\u4e00\u5f20|\u90a3\u5f20|\u8fd9\u5f20).{0,8}(?:\u56fe|\u56fe\u7247|\u7167\u7247)/.test(message);
      const freshInvocationUploads=state.staged.slice();
      const invocationUploads=freshInvocationUploads.length ? freshInvocationUploads : operationUploadScope && !explicitPreviousImage && !reverseImage ? [] : lastUploads;
      const promptConversation=!includeResult&&!invocationUploads.length&&root.NovaFlowXiaotaoPromptSource?.isPromptConversation?.(message)===true;
      const capabilityOnly=!reverseImage && !includeResult && !invocationUploads.length && (promptConversation||qwenCapabilityQuestion(message));
      const capabilityHistory=capabilityOnly?copy(state.history):null;
      const promptDiscussion=communityChatOnly&&(qwenPromptDiscussion(message)||qwenNoToolExplanation(message));
      // A specifically requested text-only drawing draft has its own operation;
      // do not run an additional paid general-purpose tool planner beforehand.
      if(!root.NovaFlowXiaotaoPromptSource&&state.provider==='api'&&onlineOperationDecimalConfirmed()&&!includeResult&&qwenCurrentDrawingPromptIntent(message))
        return prepareOnlineCurrentDrawingPrompt(message,{recordMessage});
      if(!root.NovaFlowXiaotaoPromptSource&&communityChatOnly&&qwenCurrentDrawingPromptIntent(message))return prepareQwenCurrentDrawingPrompt(message,{recordMessage});
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
      if(qwenAudioIntent && !(state.provider==='api'&&state.staged.length) && (qwenAudioIntent.surface==='audio'||qwenAudioIntent.discussion===true&&/音效|音乐|配乐|声音/.test(message)) &&
        /提示词|prompt/i.test(message)&&/优化|改写|整理|润色/.test(message)&&!/(?:不要|不用|无需|别|不必).{0,5}(?:优化|改写|整理|润色)/.test(message))
        return rewriteQwenAudioText(message,qwenAudioIntent,{recordMessage});
      recoverActiveTask();
      let task=capabilityOnly||reverseImage?{surface:'chat',mode:'chat',discussion:true,named:[]}:uploadApi()?.inferTask?.(message,invocationUploads,state.activeTask);
      // The local model only chats and rewrites prompts; every software
      // operation belongs to an online model.
      if(communityChatOnly && !promptDiscussion && localOperationIntent(message))return offerLocalPrompt(message,{recordMessage});
      // 和在线大脑同一套框架：在线大脑会去写页面提示词的请求（视频 H3 / 绘图页面上的画面描述，
      // 或带着素材的描述），本地大脑也直接写进提示词框，不在对话里回一段方案。
      if(communityChatOnly && !capabilityOnly && !promptDiscussion && localPagePromptRequest(message,task))return writeLocalPagePrompt(message,{recordMessage});
      const continuation=answersQuestion(message) && !task?.discussion ? pendingIntent : null;
      const requestMessage=reverseImage ? '用户要求：'+message+'\n请看图片，写出能重新生成这张图的完整中文提示词，写清主体、动作、服饰、场景、构图、光线和画风。只输出提示词，不解释、不提问。' : continuation?.foart ? continuation.message+'\n用户回答：'+message+'\n这是对上一条提问的回答，结合上文现在直接执行，不要再询问。' : continuation ? continuation.message+'\n用户补充：'+message : task?.revision
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
        return (await consumeStaged(requestMessage,{place:!reverseImage})) && !retired;
      }
      const positiveEvaluation = /^(?:这次|这张(?:图)?|这个|效果|结果)?(?:的)?(?:效果|画面)?(?:做得|做的|画得|画的)?(?:挺好(?:的)?|很好|很满意|满意|很棒|不错)(?:了)?[，,\s]*$/;
      const purePositive = positiveEvaluation.test(message.replace(/[。！!]+$/,'')) || /^(?:这次|这张|这个)?(?:就用|采用|最终采用|确认采用)(?:这张|这个|本次)?[。！!]*$/.test(message);
      const pureNegative = /^(?:这次|这张|这个)?(?:不满意|不太满意|效果不好|不行)[。！!]*$/.test(message);
      if (!communityChatOnly && (purePositive || pureNegative) && (bridge.hasResult?.()||state.activeTask)) {
        if (!(await ensureStaged())) return false;
        pushUser(message);
        if(pureNegative&&state.provider==='api')pendingIntent={surface:'foart',mode:'',foart:true,message:requestMessage};
        state.messages.push({role:'assistant',content:purePositive ? '好，这一版的效果就按你的评价保留。' : '明白，这一版还没达到要求。告诉我主要想改哪里，我接着改。'}); notify(); return true;
      }
      if (/^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$/.test(message)) {reset(); return true;}
      const operationTextOnly=state.provider==='api' && selectedPricingPayload().operationBillingV3===true;
      const operationVision=operationTextOnly && selectedPricingPayload().operationVisionBillingV3===true;
      const visionUploads=operationVision && invocationUploads.length>0 && invocationUploads.every(item=>item?.kind==='image');
      const operationNeedsTools=!reverseImage&&(includeResult||!task||task.surface!=='chat'||task.revision||state.activeTask||(!visionUploads&&invocationUploads.length)||
        /打开|关闭|进入|切换|操作|执行|调用|生成|制作|设计|新建|创建|建立|添加|增加|做(?:一|个|张|段|套)|来(?:一|个|张|段)|配乐|配音|转成|转换|合成|渲染|改|换|抠|去掉|去除|擦|放大|扩|拆|补|裁|压缩|画|加上|加个|调整|编辑|删除|导入|导出|保存|播放|暂停|选择|选中|移动|旋转|缩放|画布|图层|时间轴|当前(?:页面|作品|工程|画面|图片|视频)|放(?:进|到|入)|加(?:进|到|入)|作为.{0,4}(?:参考|素材)|参考图|用这|拿这|做成|变成|换成|换掉|替换|迁移|(?:图|第)\s*[1-9一二三四五六七八九].{0,12}(?:风格|画风)/.test(message));
      const operationGeneral=state.provider==='api'&&!capabilityOnly&&!!operationNeedsTools;
      if (!(await ensureStaged())) return false;
      if(operationGeneral){if(!root.NovaFlowFoartTools){state.error='工具尚未就绪，本次未提交。';notify();return false;}
        return sendFoart(message,{recordMessage,requestMessage,intent:task,animationIntent:task?.surface==='animation'});}
      if (recordMessage) {pushUser(message); recordMessage = false;}
      const page=capabilityOnly?{artContext:{surface:'other'},images:[]}:await bridge.captureChat({includeDrawingReferences:!communityChatOnly}), artRequest=!capabilityOnly&&/提示词|提示框|绘图|生图|出图|重绘|画图|画一|画个|画张|生成|做图|操作软件|控制软件|调用软件|(?:制作|做|画|设计|修改|给我|来).{0,12}(?:图|海报|插画|画面)/.test(message);
      if(retired)return false;
      includeResult = chatRequestsCurrentResult(message, includeResult);
      const reverseResult=reverseImage&&/成图|出图|结果/.test(message);if(reverseResult)includeResult=true;
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
      const billing=state.provider==='api'?{id:root.crypto.randomUUID(),modelId:state.modelId,owner:billingOwner(),confirmed:0,confirmedCount:0,quoted:0,allQuoted:true,unknown:false,inFlight:false,decimal:onlineOperationDecimalConfirmed()}:null;activeChatBilling=billing;
      try {
        let snapshot, mode = 'chat';
        if (!snapshot) snapshot = capabilityOnly?{artContext:{},images:[]}:await bridge.captureChat({includeResult,drawingPreview:reverseImage,includeDrawingReferences:!communityChatOnly || qwenWantsDrawingReferences});
        if(retired || operation!==serial)return false;
        activeSnapshot = snapshot; activeMode = mode; state.mode = mode; state.pending = true;
        state.status = includeResult ? '正在查看实际成图…' : state.provider === 'api' ? '小桃正在连接在线智能…' : '正在连接 Foart…';
        lastRequestMessage = message; activeStartedAt = Date.now();
        if (recordMessage) {if (!(await ensureStaged())) return false; pushUser(message);}
        notify();
        const contextFingerprint = mode !== 'chat' ? await fingerprint(snapshot) : undefined; if (operation !== serial || stopped) return false;
        activeRequest = root.crypto.randomUUID();
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
        if(reverseImage){
          const named=[...new Set([...message.matchAll(/图\s*([1-9])/g)].map(match=>Number(match[1])))].map(number=>images[number-1]);
          const picked=reverseResult?images.filter(image=>image.role==='result'):named.length?named:images;
          if(!picked.length||picked.includes(undefined))fail('没有找到要反推的图片，请先放入图片；未提交，不扣积分');
          images.splice(0,images.length,...picked);
        }
        const uploadOwner=operationVision&&images.length?api()?.captureFoartBillingOwner?.():null;
        const uploadModel=state.modelId;
        const uploadCurrent=()=>operation===serial&&!stopped&&state.provider==='api'&&state.modelId===uploadModel&&typeof uploadOwner?.current==='function'&&uploadOwner.current()===true;
        activeChatHasImages=mode==='chat' && images.length>0;
        const payload = {requestId:activeRequest, provider:state.provider, ...selectedModelPayload(state.modelId), ...selectedPricingPayload(), mode, promptLanguage:mode==='creation'?'zh-CN':'en', conversationId:capabilityOnly?undefined:state.conversationId || undefined, message:requestMessage, history:capabilityOnly&&!promptConversation?[]:copy(state.history), artContext:operationTextOnly?{}:copy(snapshot.artContext), images, ...(state.provider === 'api' ? {uploads:capabilityOnly?[]:requestUploads.filter(file=>!reverseImage||images.some(image=>image.name===file.name)).map(({kind, name}) => ({kind, name}))} : communityUploads() ? {uploads:qwenUsesUploads ? communityUploads() : []} : {}), ...(contextFingerprint ? {contextFingerprint} : {}), ...(operationVision&&images.length?{imageSessionGuard:uploadCurrent,confirmImageUpload:async info=>uploadCurrent()&&await onlineBusinessUi(uploadModel).confirmImageUpload(info)&&uploadCurrent()}:{})};
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
        if(communityChatOnly && communityClaimsToolAccess(data.reply))fail('模型回答包含当前不可用的工具操作能力，未操作软件，请重新提问');
        if(communityChatOnly && /(?:已|已经|完成|成功).{0,24}(?:修改|调整|生成|设置|选中|删(?:除|掉|去|了)?|导出|导入|绘制|写入|应用|执行|处理)|(?:我|小桃).{0,24}删(?:除|掉|去)?[^。！？!?；;\n]{0,12}了|(?:修改|调整|生成|设置|选中|删(?:除|掉|去)?|导出|导入|绘制|写入|应用|执行|处理).{0,8}(?:好了|完成|成功)/.test(data.reply))fail('模型回复包含未经执行的操作声明，未修改作品，请重新提问');
        rememberQwenExecutionDevice(response,deviceEpoch);
        if(data.needsInput){
          state.messages.push({role:'assistant',content:data.reply});state.conversationId=data.conversationId || state.conversationId;
          if(Array.isArray(data.history))state.history=copy(data.history);
          state.toolTrace=copy(data.toolTrace || []);state.model=String(data.model || state.model);state.localSession=null;
          pendingIntent={...(task || {surface:'image',mode:'img2img'}),message:requestMessage};state.status='等待补充需求';return true;
        }
        pendingIntent=state.provider==='api'&&!capabilityOnly&&!reverseImage&&endsWithQuestion(data.reply)?{surface:'foart',mode:'',foart:true,message:requestMessage}:null;
        if (state.provider === 'api') {
          if (prediction?.credits != null && data.quota) data.quota = {...data.quota,expected_credits:prediction.credits};
          if (data.billingSample) {
            const actualInput = {...predictionInput,files:[...images.map(image=>({kind:'image',...imageDimensions(image)})),...lastUploads.filter(file=>file.kind!=='image')]};
            const next = root.NovaFlowFeatureCreditPrices?.recordXiaotaoOnlineSample?.(actualInput,data.billingSample,metering);
            if (next && next !== metering) {metering = {...next,...(currentPricingPolicy()?{pricingVersion:currentPricingPolicy().version}:{}),updatedAt:Date.now()}; try {root.localStorage?.setItem(pricingKey,JSON.stringify(metering));} catch {}}
          }
        }
        if (state.provider === 'local') {state.localSession = null; updateLocalSession(data.chatSession);}
        const reply=data.reply;
        const settled=billingReceipt(billing),receipt=settled?creditReceipt({...settled,...(prediction?.credits!=null?{expected_credits:prediction.credits}:{})}):'';
        state.messages.push({role:'assistant', content:reply, ...(receipt ? {receipt} : {})});
        // Keep the latest settled amount in the shared, quiet billing line.
        if (!capabilityOnly) state.conversationId = data.conversationId || state.conversationId;
        if (Array.isArray(data.history)) state.history = capabilityOnly?[...capabilityHistory,{role:'user',content:message},{role:'assistant',content:data.reply}].slice(-12):copy(data.history);
        state.toolTrace = Array.isArray(data.toolTrace) ? copy(data.toolTrace) : []; state.model = String(data.proposal?.model || data.model || '本地 Flash');
        state.status='已回复';
        return true;
      } catch (error) {if(billing?.inFlight){billing.inFlight=false;billing.unknown=true;publishBilling(billing);}if (operation === serial && !stopped) {state.error = String(error?.message || error); if(!capabilityOnly)state.history=[...state.history,{role:'user',content:message},{role:'assistant',content:'未完成：'+state.error}].slice(-12); state.status = billing?.unknown ? '请求未完成' : billing?.confirmedCount ? '回复未完成，已按实际用量结算' : '未提交生成';} return false;}
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
      // 小桃附件不参与视频草稿：草稿只读页面提示词和参考槽，附件保留给下一条消息使用。
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
        const includeReferenceImages=!local&&['first_last','image_video'].includes(video?.genType)&&!textOnly;
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
        const {onPricingQuote,confirmPricingQuote,confirmImageUpload}=onlineBusinessUi(selected.modelId,includeReferenceImages?()=>true:null,current);
        const result=await method({request:snapshot.request,assistantSelectionScope:'xiaotao',assistantProvider:selected.provider,assistantModelId:selected.modelId,assistantSelectionEpoch:selected.epoch,signal:abort.signal,isInputCurrent:current,onPricingQuote,confirmPricingQuote,...(includeReferenceImages?{confirmImageUpload}:{}),
          onBillingNotice:notice=>notice?.requestId===requestId && recordBusinessBillingNotice(notice,{selection:selected,owner,sessionGuard})});
        if(!current())throw Error('模型或视频上下文已变化，草稿未显示。');
        if(result?.ok!==true)throw Error(result?.error||'视频草稿未完成。');
        const draft=result.draft;
        if(draft?.status!=='preview-only'||draft.applyAvailable!==false||draft.textOnly!==!includeReferenceImages||typeof draft.displayPrompt!=='string'||typeof draft.modelPrompt!=='string'||draft.h3Mode!==snapshot.request.h3Mode||draft.durationSeconds!==snapshot.request.durationSeconds)throw Error('视频草稿格式无效，未应用。');
        root.NovaFlowAiSequenceMiniMaxH3PromptWorkflow?.rememberDraft?.({mode:draft.h3Mode,prompt:draft.displayPrompt,modelText:draft.modelPrompt});
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
        referenceSource='uploads';
      }
      if(referenceSource==='uploads'&&(staged.length<1||staged.length>3||staged.some(item=>item.status!=='ready'||item.kind!=='image'||typeof item.previewUrl!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,/.test(item.previewUrl)))){state.error='请选择 1–3 张已就绪图片，未上传或扣费。';notify();return false;}
      if(referenceSource==='uploads'&&pageRefs.length){
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
            const role=uploads.length===0?'subject':/风格|画风/.test(message)?'style':'reference';
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
        const ui=local?{confirmNodeUpload:async()=>current()}:onlineBusinessUi(selected.modelId,null,current);
        const result=await method({request:snapshot.request,assistantSelectionScope:'xiaotao',assistantProvider:selected.provider,assistantModelId:selected.modelId,assistantSelectionEpoch:selected.epoch,signal:abort.signal,isInputCurrent:current,...ui,...(!local?{
          onBillingNotice:notice=>notice?.requestId===requestId && recordBusinessBillingNotice(notice,{selection:selected,owner,sessionGuard})}:{})});
        if(!current())throw Error(local?'模型或 UI 已变化，草稿未显示。':'模型或 UI 已变化，草稿未显示。');
        if(result?.ok!==true)throw Error(result?.error||(local?'UI 草稿未完成，未应用。':'UI 草稿未完成。'));
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
        referenceSource='uploads';
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
        if(!Array.isArray(oldRefs)||oldRefs.length!==pageRefs.length){state.error='当前页面参考无法安全核验，未上传或扣费。';notify();return false;}
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
          if(!role)role=ref.index===1?'subject':/风格|画风/.test(message)?'style':'reference';
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
        const receipt=await tools.execute({action:'image_optimize',prompt:selectedPrompt,generationMode:visual?'img2img':'txt2img',plannerBrief:source?.plannerBrief===true},
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
      }catch(error){state.error=String(error?.message||error);state.status='未应用或生成图片。';return false;}
      finally{if(promptAbort===abort)promptAbort=null;state.pending=false;notify();}
    }
    // The local brain only chats and writes prompts. An operation request gets
    // the switch notice plus an offer to write the prompt into the drawing box.
    let pendingLocalPromptOffer=null;
    function offerLocalPrompt(message,{recordMessage=true}={}){
      if(recordMessage)pushUser(message);
      const surface=activePromptSource()?.surface,writable=['drawing','video'].includes(surface)&&!/打开|进入|切换|关闭|跳到|帧|播放|暂停|导出|导入|保存/.test(message);
      pendingLocalPromptOffer=writable?{message,surface}:null;
      state.messages.push({role:'assistant',content:LOCAL_CHAT_ONLY_NOTICE+(writable?'\n\n也可以由我按这句话直接写一版提示词填进'+(surface==='video'?'视频':'绘图')+'输入框，你自己点生成。要吗？回复“要”即可。':'')});
      state.error='';state.status=writable?'等待回复':'未执行操作';notify();return true;
    }
    // A description on the video H3 or drawing page (or one sent with
    // material) is a prompt to write, the same request an online brain takes
    // to the page. Questions and talk about the picture stay in chat.
    function localPagePromptRequest(message,task){
      const surface=activePromptSource()?.surface,text=String(message||'').trim();
      if(!['video','drawing'].includes(surface)||!text||text.length>1500)return false;
      if(/[？?]|吗[。！!～~]*$|呢[。！!～~]*$|什么|怎么|如何|为什么|为何|哪(?:个|些|种|里)|是否|能不能|可不可以|行不行/.test(text)||/(?:看|分析|识别|描述|评价|点评|对比|比较|检查).{0,8}(?:图|画面|照片|截图|素材)/.test(text)||discussionOnly(text))return false;
      if(/^(?:你好|您好|嗨|哈喽|hi|hello|谢谢|多谢|好的|好|嗯|ok|收到|再见)[。！!～~\s]*$/i.test(text))return false;
      const files=state.staged.filter(item=>item.status==='ready');
      if(files.length)return surface==='video'||files.every(item=>item.kind==='image');
      return !!task&&!task.discussion&&task.surface===(surface==='video'?'video':'image');
    }
    async function writeLocalPagePrompt(message,{recordMessage=true}={}){
      if(activePromptSource()?.surface==='drawing')return runLocalPromptOffer({message},message,{recordMessage});
      return writeLocalVideoPrompt(message,{recordMessage});
    }
    // The video box gets an H3 draft from the local optimizer. This message's
    // attachments go where an online brain would put them (首尾帧 etc.) first.
    async function writeLocalVideoPrompt(message,{recordMessage=true}={}){
      const say=text=>{if(recordMessage)pushUser(message);state.messages.push({role:'assistant',content:text});state.error='';state.status='未执行操作';notify();return false;};
      if(state.staged.some(item=>item.status==='ready')&&!(await consumeStaged(message)))return false;
      if(retired)return false;
      const info=activePromptSource();
      if(info?.surface!=='video')return say('请先打开视频 H3 页面，再让我写提示词。');
      let workspace;try{workspace=capturePromptWorkspace(info);}catch{return say('视频页面还没准备好，请稍后再发一次。');}
      return prepareSelectedH3TextDraft(message,{recordMessage,source:{status:'ready',source:'conversation',prompt:message,requirements:'',...workspace}});
    }
    async function runLocalPromptOffer(offer,message,{recordMessage=true}={}){
      if(offer.surface==='video'||activePromptSource()?.surface==='video'){
        if(recordMessage)pushUser(message);
        return writeLocalVideoPrompt(offer.message,{recordMessage:false});
      }
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
    // A hand-edited draft with no prompt node online: the cheapest online model translates it,
    // whichever brain is selected. Empty means it could not (no credits, signed out, refused),
    // and the prompt then goes out as written.
    async function translateH3Online(text){
      const policy=currentPricingPolicy()||await refreshPricingPolicy();
      const modelId=[...XIAOTAO_ONLINE_MODELS.filter(model=>model.flatRate).map(model=>model.id),'openai/gpt-6.1-sol-saver'].find(id=>policyAllowsOnline(id));
      if(!policy||!modelId)return '';
      const terms=policy.config.xiaotao_online,operation=operationCreditsPolicy(terms)&&terms.operation_text_chat_v3===true;
      const reply=await api()?.artAgentChat?.({requestId:root.crypto.randomUUID(),provider:'api',modelId,expectedModelId:modelId,pricingVersion:policy.version,pricingExpiresAt:policy.expiresAt,
        ...(operation?{operationBillingV3:true}:{}),mode:'chat',promptLanguage:'en',message:String(text||'').slice(0,12000),history:[],artContext:{},images:[],uploads:[]});
      return reply?.ok===true?String(reply.data?.reply||'').trim().replace(/^```\w*\s*|\s*```$/g,''):'';
    }
    async function plannerDrawingPrompt(op,message,{rolesSet=false}={}){
      const rt=root.__NovaFlowArtGenerate;let info=activePromptSource();
      // A collapsed 生图 panel or another section is no reason to stop: the planner chose drawing.
      if(!info){await root.NovaFlowFoartTools?.execute?.({action:'open',surface:'drawing'},{});info=activePromptSource();}
      if(info?.surface==='ui'){
        let uiWorkspace;try{uiWorkspace=capturePromptWorkspace(info);}catch(error){throw Error('当前 UI 页面还没准备好：'+String(error?.message||error));}
        const prompt=String(op.prompt||'').trim()||info.pagePrompt.trim()||message;
        await prepareSelectedUiDraft(message,{recordMessage:false,source:{status:'ready',source:'conversation',prompt,requirements:message,...uiWorkspace}});state.pending=true;
        if(state.error)throw Error(state.error);
        if(op.action!=='image_generate')return {action:op.action,phase:'applied',plannerPrompt:true,message:'UI 提示词已优化并写入输入框。'};
        // "设计一个界面" asks for the picture, not only its prompt: run the same generation the 生成 button runs.
        state.status='UI 提示词已写入，正在生成…';notify();
        const earlier=new Set(Array.from(rt.state.results||[],item=>item?.id));
        await rt.run();
        if(rt.state.error)throw Error('UI 提示词已写入，但生成没有完成：'+rt.state.error);
        const fresh=Array.from(rt.state.results||[]).filter(item=>item&&!earlier.has(item.id)).reverse();
        return {action:op.action,phase:'completed',plannerPrompt:true,surface:'ui',provider:rt.state.provider,modelLabel:rt.state.provider==='gpt'?'GPT Image 2.5':'Qwen',outputs:fresh.map((item,index)=>({id:item.id,name:item.name||item.fileName||'UI成图'+(index+1)})),message:'已写入 UI 提示词并完成生成。'};
      }
      if(!info||info.surface!=='drawing')throw Error('请先打开绘图页面，再优化提示词');
      // "改上一张": the previous picture becomes the 图生图 reference before the brief is written, so the edit is made on it and not on a fresh picture.
      // No previous picture to change is not a stop: the page's own pictures, if any, carry the request.
      if(op.useResult===true&&op.generationMode==='img2img'){
        try{await root.NovaFlowFoartTools.execute({action:'use_result'},{});}
        catch(error){if(!Array.from(rt?.references?.()||[]).some(Boolean))throw error;root.console?.warn?.('[Foart tools] use_result skipped:',String(error?.message||error));}
      }
      // The planner picked 文生图 or 图生图 for this request; switch the page the way the mode buttons do, as long as its references fit that mode.
      const pageRefCount=Array.from(rt?.references?.()||[]).filter(Boolean).length;
      if(['txt2img','img2img'].includes(op.generationMode)&&rt?.state&&rt.state.mode!==op.generationMode&&typeof rt.setMode==='function'&&(op.generationMode==='img2img'?pageRefCount>0:pageRefCount===0))rt.setMode(op.generationMode);
      if(rt?.state?.mode==='img2img'&&!rolesSet){
        // Roles the router defaulted (every picture a subject) are retyped from the request: "图2的风格" marks picture 2 as style, one subject remains.
        const refs=Array.from(rt.references?.()||[]).filter(Boolean),styleAt=styleSlots(message,refs.length);
        const subjects=refs.filter(ref=>ref.drawingRole==='subject').length;
        if(styleAt.size||subjects!==1||refs.some(ref=>!ref.drawingRole)){let subjectSeen=false;refs.forEach((ref,i)=>{
          if(styleAt.has(i))ref.drawingRole='style';else if(!subjectSeen){ref.drawingRole='subject';subjectSeen=true;}else if(!ref.drawingRole||ref.drawingRole==='subject')ref.drawingRole='reference';});}
      }
      let workspace;try{workspace=capturePromptWorkspace(info);}catch(error){throw Error('当前绘图页面还没准备好：'+String(error?.message||error));}
      const prompt=String(op.prompt||'').trim()||info.pagePrompt.trim()||message;
      const ok=await prepareOnlineCurrentDrawingPrompt(message,{recordMessage:false,source:{status:'ready',source:'conversation',prompt,plannerBrief:!!String(op.prompt||'').trim(),requirements:message,...workspace}});
      state.pending=true;
      if(!ok)throw Error(state.error||'提示词优化未完成');
      if(op.action!=='image_generate')return {action:op.action,phase:'applied',plannerPrompt:true,prompt:String(rt?.state?.prompt||''),message:'提示词已优化并写入绘图输入框。'};
      state.status='提示词已写入，正在生成…';notify();
      const earlier=new Set(Array.from(rt.state.results||[],item=>item?.id));
      await rt.run();
      if(rt.state.error)throw Error('提示词已写入，但生成没有完成：'+rt.state.error);
      // Every picture of this run is reported, with the drawing model that made it, not only the selected one.
      const fresh=Array.from(rt.state.results||[]).filter(item=>item&&!earlier.has(item.id)),made=rt.selectedResult?.();
      const outputs=(fresh.length?fresh.reverse():made?[made]:[]).map((item,index)=>({id:item.id,name:item.name||item.fileName||'成图'+(index+1)}));
      const drawn=Array.from(rt.references?.()||[]).filter(Boolean),subject=drawn.find(ref=>ref.drawingRole==='subject');
      if(subject&&drawn.some(ref=>ref.drawingRole==='style'))currentSubject={...subject};
      return {action:op.action,phase:'completed',plannerPrompt:true,provider:rt.state.provider,modelLabel:rt.state.provider==='gpt'?'GPT Image 2.5':'Qwen',prompt:String(rt.state.prompt||''),outputs,message:'已写入提示词并完成生成，请在绘图页查看结果。'};
    }
    // A style run from planStyleRun: one full style redraw per group of style pictures, each writing its own texts and billed on its own.
    async function runStyle({subjectSlot,styleSlots,perStyle,extras},signal){
      const rt=root.__NovaFlowArtGenerate,page=Array.from(rt.references?.()||[]).filter(Boolean).map(ref=>({...ref})),outputs=[];let last=null;
      const subject=subjectSlot>=0?page[subjectSlot]:currentSubject,styles=styleSlots.map(slot=>page[slot]),groups=perStyle?styles.map(style=>[style]):[styles];
      // Clearing a slot revokes its preview, so every placement takes a new one from the file.
      const fresh=ref=>ref.file&&root.URL?.createObjectURL?{...ref,dataUrl:root.URL.createObjectURL(ref.file)}:ref;
      const place=list=>{const slots=Math.max(list.length,Array.from(rt.references?.()||[]).length);for(let index=0;index<slots;index++)rt.setReference(index,list[index]?fresh(list[index]):null);rt.refreshReferences?.();};
      // One style picture failing (model timeout, invalid draft) must not drop the others: every group gets its run,
      // and the failures are named at the end. Only a stop or an all-fail turn becomes an error.
      const failed=[];
      try{
        for(const [index,group] of groups.entries()){
          if(signal?.aborted)throw Error('已停止');
          place([{...subject,drawingRole:'subject'},...group.map(style=>({...style,drawingRole:'style'}))]);
          const request='@参考图1换成'+group.map((_,slot)=>'@参考图'+(slot+2)).join('和')+'的风格'+(extras?'，'+extras:'');
          state.status='正在生成第 '+(index+1)+'/'+groups.length+' 张…';notify();
          try{last=await plannerDrawingPrompt({action:'image_generate',generationMode:'img2img',useResult:false,prompt:request},request,{rolesSet:true});outputs.push(...(last.outputs||[]));}
          catch(error){if(signal?.aborted||groups.length===1)throw error;failed.push('第 '+(index+1)+' 张：'+String(error?.message||error));}
        }
      }finally{place(page);}
      if(!outputs.length)throw Error(failed.length>1?failed.join('；'):String(failed[0]||'未生成'));
      const summary=perStyle&&groups.length>1?'已按 '+groups.length+' 张风格图各生成一张':last.message;
      return {...last,outputs,message:failed.length?'已生成 '+outputs.length+' 张；未完成：'+failed.join('；'):summary};
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
        if(selected.provider==='api'&&(handoff.analysisBackend!=='runninghub'||handoff.modelIdentity?.id!==selected.modelId))throw Error('在线模型身份未确认，结果未采用。');
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
      if(foartAbort){if(activeFoartBilling?.inFlight)publishBilling(activeFoartBilling);foartAbort.abort();state.status='正在停止本次工具等待…';const requestId=activeRequest;if(requestId)await api()?.artAgentStop?.({requestId,provider:state.provider});notify();return;}
      if(promptAbort) {state.status='正在停止本次提示词优化…';promptAbort.abort();notify();return;}
      if(mediaAbort) {state.status='正在停止本次音视任务…';mediaAbort.abort();notify();return;}
      if (state.generating) {state.status = '正在停止生成…'; notify(); await bridge.cancelGeneration(); return;}
      if (!state.pending || stopped) return;
      stopped = true; stopStatusPolling(); const requestId = activeRequest; if(activeChatBilling?.inFlight)publishBilling(activeChatBilling);state.localSession = null; state.status = state.provider === 'api' ? '正在停止等待在线回复…' : '正在停止小桃…'; notify();
      try {if (requestId) {const result = await api()?.artAgentStop?.({requestId,provider:state.provider}); if (!result?.ok) fail(result?.error || '停止尚未确认，请等待当前任务退出');} ++serial; state.pending = false; activeRequest = ''; activeSnapshot = null; state.status = '已停止';}
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
            state.error='生成状态未确认，请查看绘图任务，勿重复发送。';state.status='生成状态未确认';return false;
          }
          const result=tools.confirmImageReview(review.id);
          if(result?.phase!=='applied'||result.reviewId!==review.id)fail('审核稿应用未确认。');
          pendingFoartImageReview=null;foartImageReviewUndo={id:review.id};state.foartImageReviewCanUndo=true;state.applied=true;
          state.status=result.surface==='ui'?'已暂存下次 UI 生成方案，尚未生成；可撤销暂存。':'已应用审核稿，尚未生成；可撤销本次应用。';return true;
        }catch(error){state.error=String(error?.message||error);state.status=error?.code==='foart-review-state-uncertain'?'审核状态待核对':'审核稿未应用';return false;}
        finally{state.generating=false;state.applying=false;notify();}
      }
      return false;
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
    function reset() {if (CHAT_MODELS[state.modelId]?.retired || state.pending || state.generating || state.applying || state.uploading || state.staging || state.staged.some(item=>item.status==='reading')) return false;  if(pendingFoartImageReview)root.NovaFlowFoartTools?.cancelImageReview?.(pendingFoartImageReview.id);pendingFoartImageReview=null;foartImageReviewUndo=null;state.foartImageReviewCanUndo=false; ++serial; stopStatusPolling(); activeRequest = ''; activeSnapshot = null; activeMode = 'chat'; lastRequestMessage = ''; carryAttachments = null; carryAsk = null; lastUploads=[];lastPreparedTask='';pendingIntent=null;pendingPromptSource=null;state.promptSourceCancelledNotice='';clearMediaPromptReview();bridge.clearPrepared(); releaseCurrentStagedMedia(); sessions[state.provider]={messages:[],history:[],conversationId:''}; delete modelSessions[state.modelId];delete transientSessions[state.modelId]; Object.assign(state, {activeTask:null,messages:[], history:[],historyOriginUnknown:false, conversationId:'', proposal:null, proposalSnapshot:null, applied:false, confirmation:null,samplingApproval:null,operation:null,error:'', toolTrace:[], staged:[], pendingUploads:[], pendingUploadId:'', status:state.mode === 'drawing' ? '当前模型的新对话，将使用当前绘图内容' : '当前模型的新对话，可以直接聊天'}); notify(); return true;}
    function setProvider(provider) {
      if (!['local','api'].includes(provider) || provider === state.provider || state.pending || state.generating || state.applying || state.uploading) return false;
      return setModel(provider === 'local' ? 'qwen3.5-9b-heretic' : DEFAULT_XIAOTAO_MODEL_ID);
    }
    function setModel(modelId) {
      const model = CHAT_MODELS[modelId];
      if (!model || model.retired || modelId === state.modelId || state.pending || state.generating || state.applying || state.uploading || state.staging || state.staged.some(item=>item.status==='reading')) return false;
      if(pendingFoartImageReview)root.NovaFlowFoartTools?.cancelImageReview?.(pendingFoartImageReview.id);
      pendingFoartImageReview=null;foartImageReviewUndo=null;state.foartImageReviewCanUndo=false;
      clearMediaPromptReview();
      const wasPendingPromptSource=!!pendingPromptSource;
      if(wasPendingPromptSource){cancelledPromptSourceModels.add(state.modelId);pendingPromptSource=null;}
      businessModelEpoch++;
      for(const listener of businessModelListeners){try{listener();}catch{}}
      ++serial; notify();
      transientSessions[state.modelId]={staged:state.staged,pendingUploads:state.pendingUploads,pendingUploadId:state.pendingUploadId,carryAttachments,carryAsk,lastUploads,lastPreparedTask,pendingIntent,lastRequestMessage};
      bridge.clearPrepared(); activeSnapshot = null; activeMode='chat';
      const saved=modelSessions[modelId] || {}, transient=transientSessions[modelId] || {};
      carryAttachments=transient.carryAttachments || null;carryAsk=transient.carryAsk || null;lastUploads=transient.lastUploads || [];lastPreparedTask=transient.lastPreparedTask || '';pendingIntent=transient.pendingIntent || null;lastRequestMessage=transient.lastRequestMessage || '';
      Object.assign(state, {provider:model.provider,modelId,messages:saved.messages || [],history:saved.history || [],historyOriginUnknown:saved.historyOriginUnknown===true,activeTask:saved.activeTask || null,conversationId:'',staged:transient.staged || [],pendingUploads:transient.pendingUploads || [],pendingUploadId:transient.pendingUploadId || '',mode:'chat',proposal:null,proposalSnapshot:null,applied:false,confirmation:null,samplingApproval:null,operation:null,error:'',toolTrace:[],model:model.label,localSession:null,localModelStatus:null,qwenExecutionDevice:null,status:model.provider==='api'?(currentPricingPolicy()?(modelAvailable(modelId)?'':model.detail):'正在获取在线模型状态…'):model.detail});
      const showCancelledPromptSource=wasPendingPromptSource || cancelledPromptSourceModels.has(modelId);
      cancelledPromptSourceModels.delete(modelId);
      state.promptSourceCancelledNotice=showCancelledPromptSource?'先前的提示词来源选择已因切换模型取消，请重新发送需要优化的内容；未提交或扣费。':'';
      if(state.promptSourceCancelledNotice)state.status=[state.status,state.promptSourceCancelledNotice].filter(Boolean).join(' ');
      notify(); if(model.provider==='api')void refreshPricingPolicy(); return true;
    }
    return Object.freeze({state, retire, businessModelSnapshot, translateH3Online, subscribeBusinessModel, analyzeStagedImage, applyMediaPromptReview, cancelMediaPromptReview, undoMediaPromptReview, send, apply, stop, reset, setProvider, setModel, refreshContext, onlineEstimateInput, onlineQuote, operationEstimate, styleReadAvailable, modelAvailable, hideLegacyOnlineOption, modelRateSummary, onlinePriceDetails, visiblePricingDetails, onlineOperationMinimumConfirmed, onlineOperationDecimalConfirmed, pricingPolicyKey, refreshPricingPolicy, prefetchPricingPolicy, calibrateLocalStatus, invalidateLocalCapability, clearQwenExecutionDevice, stageUploads, removeStaged, chooseUploadDestination, releaseStagedMedia,cancelFoartImageReview,undoFoartImageReview,recordBusinessBillingNotice,visibleBillingNotices,dismissBillingNotice,onlineBusinessUi});
  }
  // The one model picker. The 小桃 panel and the 特效 material reader both build
  // it here, so the list, its notes, its look and its keys cannot drift apart.
  const MODEL_PICKER_GROUPS = Object.freeze([
    Object.freeze({key:'local', label:'免费 · 本地', ids:Object.freeze(['qwen3.5-9b-heretic'])}),
    Object.freeze({key:'online', label:'收费 · 在线', ids:XIAOTAO_ONLINE_MODEL_IDS})
  ]);
  function onlineGroupLabel(controller) {
    return controller.onlineOperationDecimalConfirmed()?'收费 · 在线（按实际用量结算）':controller.onlineOperationMinimumConfirmed()?'收费 · 在线（成功操作最低 1 积分）':'收费 · 在线（计费规则待确认）';
  }
  // localChecks=false: the caller runs the local model its own way, so the 小桃
  // node trial status does not apply. available overrides whether an online row
  // can be used (a caller may need more than chat, e.g. image reading).
  function modelOptionInfo(controller, id, {localNote='本地对话免费', localChecks=true, available:isAvailable}={}) {
    const model=CHAT_MODELS[id], local=model.provider==='local';
    const rate=local?'':controller.modelRateSummary(id,true), name=local?model.label.replace('（本地·免费）',''):model.label;
    const available=local&&!localChecks?true:!local&&typeof isAvailable==='function'?isAvailable(id)===true:controller.modelAvailable(id);
    const status=available?'':id==='qwen3.5-9b-heretic'?(controller.state.qwen35CpuTrialChecked===true?'无可用节点':'设备待检测'):!local&&!controller.pricingPolicyKey()?'价格待确认':'未开通';
    const device=id==='qwen3.5-9b-heretic'&&localChecks&&!status?qwenExecutionDeviceLabel(controller.state.qwenExecutionDevice):'';
    const note=[local?localNote:rate,device,status].filter(Boolean).join(' · ');
    return {name,note,available,optionText:model.label+(rate?' · '+rate:'')+(status?' · '+status:''),
      triggerName:id==='qwen3.5-9b-heretic'?'Qwen3.5 9B':name,triggerNote:local?['本地·免费',status].filter(Boolean).join(' · '):note};
  }
  // A DOM listbox stays in the caller's stacking context. Focus stays on the
  // trigger while the active option moves, for screen readers.
  function createModelPicker(doc, {label, menuLabel=label, listboxId, optionIdPrefix, describe, current, choose, emptyName='', emptyAria=label,
    isShown=()=>true, beforeOpen=()=>{}, beforeClose=()=>{}, onClose=()=>{}}) {
    const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
    const put=(node,key,value)=>{if(node[key]!==value)node[key]=value;}, attr=(node,key,value)=>{if(node.getAttribute(key)!==value)node.setAttribute(key,value);};
    const trigger=el('button','nf-xiaotao-model-trigger'),menu=el('div','nf-xiaotao-model-popup'),backdrop=el('div','nf-xiaotao-model-backdrop');
    trigger.type='button';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label',label);
    trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-controls',listboxId);trigger.setAttribute('aria-expanded','false');
    // Keep these nodes stable across focus and asynchronous policy refreshes:
    // replacing the pointer-down target before pointer-up can swallow a click.
    const triggerName=el('span','nf-xiaotao-model-name'),triggerNote=el('span','nf-xiaotao-model-note'),triggerSizer=el('span','nf-xiaotao-model-sizer');
    // Invisible copies of every option size the trigger to the longest one, so switching models never changes its width.
    triggerSizer.setAttribute('aria-hidden','true');trigger.append(triggerName,triggerNote,triggerSizer);
    menu.id=listboxId;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',menuLabel);menu.hidden=true;backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');
    const ids=[],buttons=new Map(),parts=new Map(),sizers=new Map(),groups=new Map();
    for (const group of MODEL_PICKER_GROUPS) {
      const node=el('div','nf-xiaotao-model-group');node.setAttribute('role','group');node.setAttribute('aria-label',group.label);
      const title=el('div','nf-xiaotao-model-group-label',group.label);title.setAttribute('aria-hidden','true');node.append(title);groups.set(group.key,{node,title});
      for (const id of group.ids) {
        const item=el('button','nf-xiaotao-model-option'),name=el('span','nf-xiaotao-model-name',CHAT_MODELS[id].label),note=el('span','nf-xiaotao-model-note');item.append(name,note);
        item.type='button';item.tabIndex=-1;item.id=optionIdPrefix+ids.length;item.setAttribute('role','option');item.setAttribute('data-model-id',id);item.setAttribute('aria-selected','false');
        ids.push(id);buttons.set(id,item);parts.set(id,{name,note});node.append(item);
        const sizeName=el('span','nf-xiaotao-model-name'),sizeNote=el('span','nf-xiaotao-model-note');triggerSizer.append(sizeName,sizeNote);sizers.set(id,{name:sizeName,note:sizeNote});
      }
      menu.append(node);
    }
    function sync() {
      const selectedId=current();let selected=null;
      for (const id of ids) {
        const info=describe(id),p=parts.get(id),z=sizers.get(id),item=buttons.get(id);
        put(p.name,'textContent',info.name);put(p.note,'textContent',info.note);put(z.name,'textContent',info.name);put(z.note,'textContent',info.note);
        attr(item,'aria-label',`${info.name}${info.note?'，'+info.note:''}`);attr(item,'aria-selected',String(id===selectedId));
        if(id===selectedId)selected=info;
      }
      const name=selected?selected.triggerName:emptyName,note=selected?selected.triggerNote:'';
      put(triggerName,'textContent',name);put(triggerNote,'textContent',note);
      attr(trigger,'aria-label',selected?`${label}，当前${name}${note?'，'+note:''}`:emptyAria);
    }
    function setGroupLabel(key,text) {const group=groups.get(key);if(!group)return;put(group.title,'textContent',text);attr(group.node,'aria-label',text);}
    let index=0,suppressOutsideClick=false,suppressTimer=null;
    const paintActive=()=>{ids.forEach((id,i)=>buttons.get(id).classList.toggle('is-active',i===index));const item=buttons.get(ids[index]);if(item){trigger.setAttribute('aria-activedescendant',item.id);item.scrollIntoView?.({block:'nearest'});}};
    // quiet: the caller is already moving or hiding its own panel.
    function close({focus=false,retainBackdrop=false,quiet=false}={}) {
      if(!menu.hidden&&!quiet)beforeClose();
      menu.hidden=true;backdrop.hidden=!retainBackdrop;onClose();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute?.('aria-activedescendant');if(focus)trigger.focus();
    }
    function open() {
      if(trigger.disabled)return;beforeOpen();sync();index=Math.max(0,ids.indexOf(current()));
      backdrop.hidden=false;menu.hidden=false;trigger.setAttribute('aria-expanded','true');paintActive();
    }
    const pick=id=>{close();choose(id);};
    trigger.onclick=()=>{if(menu.hidden)open();else close();};
    trigger.onkeydown=event=>{
      if(event.key==='Tab'){close();return;}
      if(event.key==='Escape'){if(!menu.hidden){event.preventDefault();close({focus:true});}return;}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();if(menu.hidden){open();return;}
        index=event.key==='Home'?0:event.key==='End'?ids.length-1:(index+(event.key==='ArrowDown'?1:-1)+ids.length)%ids.length;paintActive();return;
      }
      if(event.key==='Enter'||event.key===' '){event.preventDefault();if(menu.hidden)open();else pick(ids[index]);}
    };
    for(const [id,item] of buttons){item.onpointerdown=event=>event.preventDefault();item.onclick=()=>pick(id);}
    if(typeof doc.addEventListener==='function'){
      const view=doc.defaultView||root;
      doc.addEventListener('pointerdown',event=>{
        // The editor reactivates its current tool with synthetic pointers on
        // resize/zoom. Only a real outside pointer should dismiss this menu.
        if(event.isTrusted===false)return;
        if(suppressOutsideClick){suppressOutsideClick=false;backdrop.hidden=true;if(suppressTimer!==null)view.clearTimeout(suppressTimer);suppressTimer=null;}
        if(menu.hidden||!isShown()||trigger.contains(event.target)||menu.contains(event.target))return;
        close({retainBackdrop:true});suppressOutsideClick=true;event.preventDefault();event.stopImmediatePropagation();
        if(suppressTimer!==null)view.clearTimeout(suppressTimer);
        suppressTimer=view.setTimeout(()=>{suppressOutsideClick=false;backdrop.hidden=true;suppressTimer=null;},1000);
      },true);
      doc.addEventListener('pointerup',event=>{if(!suppressOutsideClick)return;backdrop.hidden=true;event.preventDefault();event.stopImmediatePropagation();},true);
      doc.addEventListener('pointercancel',()=>{if(suppressOutsideClick)backdrop.hidden=true;},true);
      doc.addEventListener('click',event=>{if(!suppressOutsideClick)return;suppressOutsideClick=false;backdrop.hidden=true;if(suppressTimer!==null)view.clearTimeout(suppressTimer);suppressTimer=null;event.preventDefault();event.stopImmediatePropagation();},true);
    }
    return Object.freeze({trigger,menu,backdrop,sync,setGroupLabel,open,close,isOpen:()=>!menu.hidden});
  }
  function mount() {
    if (!root.document?.body || root.document.getElementById('nf-xiaotao-art-root')) return;
    // Xiaotao keeps no records: drop anything older builds left in this browser.
    try {for(const key of Object.keys(root.localStorage))if(/^novaflow\.xiaotao-(?:art\.chat|operation-recovery)\.v1/.test(key))root.localStorage.removeItem(key);} catch {}
    const doc = root.document, host = doc.createElement('div'); host.id = 'nf-xiaotao-art-root'; host.setAttribute('data-novaflow-runtime-ignore', '1');
    // The panel styles itself: page skins (e.g. 特效's field rule) skip source-owned layouts, so its input looks the same on every page.
    host.setAttribute('data-novaflow-source-layout', '1');
    const el = (tag, cls, text) => {const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;};
    const fab = el('button', 'nf-xiaotao-launcher nf-xiaotao-robot'); fab.type = 'button'; fab.setAttribute('data-novaflow-keep-radius', '1'); fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'nf-xiaotao-art-panel');
    fab.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6v7M13 32H7v13h7m37-13h6v13h-7M23 54v5m18-5v5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle class="nf-xiaotao-antenna" cx="32" cy="5" r="3"/><rect x="12" y="14" width="40" height="41" rx="14" fill="#3b3b3b" stroke="currentColor" stroke-width="2"/><rect x="18" y="23" width="28" height="20" rx="8" fill="#202020"/><g class="nf-xiaotao-eyes"><circle cx="25" cy="32" r="3"/><circle cx="39" cy="32" r="3"/></g><path d="M27 47h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const robotLabel = el('span', 'nf-xiaotao-robot-label', '小桃AI'), robotState = el('span', 'nf-xiaotao-robot-state', '待机'); fab.append(robotLabel, robotState);
    const ICONS={upload:'<path d="M12 5v14M5 12h14"/>',newChat:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',send:'<path d="M21.5 2.5 10.8 13.2"/><path d="M21.5 2.5 14.7 21.5l-3.9-8.3-8.3-3.9Z" fill="currentColor"/>'};
    const iconButton=(button,name,label)=>{button.classList.add('nf-xiaotao-icon-button');button.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICONS[name]+'</svg>';button.title=label;button.setAttribute('aria-label',label);return button;};
    const panel = el('aside', 'nf-xiaotao-panel'); panel.id = 'nf-xiaotao-art-panel'; panel.hidden = true; panel.setAttribute('aria-label', '小桃AI对话');
    const header = el('header', 'nf-xiaotao-header'), title = el('div','nf-xiaotao-title'), titleText = el('strong','','小桃AI'), close = el('button', 'nf-xiaotao-icon', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭对话');
    title.append(titleText); header.append(title, close);
    const messages = el('div', 'nf-xiaotao-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-label', '小桃全局对话');
    const intro = el('p', 'nf-xiaotao-intro', '上传素材并描述想要的结果，我会根据需求调用美工、音视、特效、动画或工具；拿不准你的意思时，会先向你问清楚。'); messages.append(intro);
    const proposal = el('details', 'nf-xiaotao-proposal'), summary = el('summary', '', '提示词与执行'), proposalText = el('pre'), copyPrompt=el('button','','复制完整提示词'); copyPrompt.type='button'; copyPrompt.onclick=()=>void copyText(controller.state.proposal?.prompt || '',copyPrompt); proposal.hidden = true; proposal.append(summary,copyPrompt,proposalText);
    const actions = el('div', 'nf-xiaotao-actions'), applyButton = el('button', '', '应用到绘图'), generateButton = el('button', 'nf-xiaotao-primary', '应用并生成一张'); for (const b of [applyButton, generateButton]) b.type = 'button'; generateButton.setAttribute('data-nf-xiaotao-art-generate','1'); const cancelImageReviewButton=el('button','','\u53d6\u6d88\u8349\u7a3f'),undoImageReviewButton=el('button','','\u64a4\u9500\u5e94\u7528');cancelImageReviewButton.type=undoImageReviewButton.type='button';cancelImageReviewButton.hidden=undoImageReviewButton.hidden=true;actions.append(applyButton, generateButton,cancelImageReviewButton,undoImageReviewButton); proposal.append(actions);
    const mediaPromptPanel=el('section','nf-xiaotao-proposal'),mediaPromptText=el('p'),mediaPromptActions=el('div','nf-xiaotao-actions');
    const mediaPromptApply=el('button','','应用提示词'),mediaPromptCancel=el('button','','取消'),mediaPromptUndo=el('button','','撤销应用');
    mediaPromptPanel.hidden=true;mediaPromptPanel.setAttribute('aria-label','确认应用提示词');
    for(const button of [mediaPromptApply,mediaPromptCancel,mediaPromptUndo])button.type='button';
    mediaPromptApply.setAttribute('data-novaflow-media-prompt-apply','1');mediaPromptCancel.setAttribute('data-novaflow-media-prompt-cancel','1');mediaPromptUndo.setAttribute('data-novaflow-media-prompt-undo','1');
    mediaPromptApply.onclick=event=>void controller.applyMediaPromptReview(event);mediaPromptCancel.onclick=event=>controller.cancelMediaPromptReview(event);mediaPromptUndo.onclick=event=>void controller.undoMediaPromptReview(event);
    mediaPromptActions.append(mediaPromptApply,mediaPromptCancel,mediaPromptUndo);mediaPromptPanel.append(mediaPromptText,mediaPromptActions);
    const tools = el('div', 'nf-xiaotao-tools');
    const status = el('div', 'nf-xiaotao-status'); status.setAttribute('role', 'status'); const error = el('p', 'nf-xiaotao-error'); error.setAttribute('role', 'alert');
    const footer = el('form', 'nf-xiaotao-compose'), input = el('textarea'); input.rows = 3; input.placeholder = '有什么需要我帮助的？'; input.setAttribute('aria-label', '给智能助手的消息');
    const footerActions = el('div', 'nf-xiaotao-compose-actions'), providers = el('div', 'nf-xiaotao-brains'), modelSelect = el('select', 'nf-xiaotao-model-select'), newConversation = el('button', ''), stop = el('button', ''), send = el('button', 'nf-xiaotao-primary nf-xiaotao-send');
    modelSelect.setAttribute('aria-label','选择小桃AI模型');
    // The native select stays as an internal compatibility mirror.  The visible
    // listbox is rendered inside the panel, avoiding the embedded editor's
    // native-popup compositor ordering issue.
    modelSelect.hidden=true;modelSelect.tabIndex=-1;modelSelect.setAttribute('aria-hidden','true');
    const modelOptions=new Map();let onlinePricingGroup=null;
    for (const group of MODEL_PICKER_GROUPS) {
      const node=el('optgroup'); node.label=group.label; if(group.key==='online')onlinePricingGroup=node;
      for (const id of group.ids) {const model=CHAT_MODELS[id], option=el('option','',model.label + (model.available ? '' : ' · 未开通')); option.value=id;modelOptions.set(id,option);node.append(option);}
      modelSelect.append(node);
    }
    const picker=createModelPicker(doc,{label:'选择小桃AI模型',menuLabel:'小桃AI模型',listboxId:'nf-xiaotao-model-listbox',optionIdPrefix:'nf-xiaotao-model-option-',
      describe:id=>modelOptionInfo(controller,id),current:()=>controller.state.modelId,emptyName:'此前模型已移除 · 请选择',emptyAria:'选择小桃AI模型，此前模型已移除',
      isShown:()=>open,choose:id=>chooseModel(id),
      beforeOpen:()=>{refreshModelOptions();const rect=panel.getBoundingClientRect();panel.style.setProperty('--nf-xiaotao-menu-left',rect.left+'px');panel.style.setProperty('--nf-xiaotao-menu-top',rect.top+'px');panel.classList.add('nf-xiaotao-menu-open');modelViewportWidth=root.innerWidth;modelViewportHeight=root.innerHeight;positionModelMenu();},
      beforeClose:()=>drag.reclamp(),onClose:()=>panel.classList.remove('nf-xiaotao-menu-open')});
    const modelTrigger=picker.trigger,modelMenu=picker.menu,modelBackdrop=picker.backdrop;
    const retiredSelection=el('option','','此前模型已移除 · 请选择');
    retiredSelection.value='gemma-4-12b-it'; retiredSelection.disabled=true; retiredSelection.hidden=true;
    const upload=iconButton(el('button','nf-xiaotao-upload'),'upload','上传参考资源'),stagedRow=el('div','nf-xiaotao-staged');upload.type='button';stagedRow.hidden=true;
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
        if(await activeController.stageUploads(converted.files)&&!sessionRetired&&controller===activeController){navigation=navigationSelection();setOpen(true);}
        return;
      }
      let chosen=[]; try{chosen=await pickBrowserFiles();}catch(error){if(!sessionRetired&&controller===activeController){activeController.state.error=String(error?.message||error);render(activeController.state);}return;}
      if(sessionRetired||controller!==activeController)return;
      if(!chosen.length)return;
      if(await activeController.stageUploads(chosen)&&!sessionRetired&&controller===activeController){navigation=navigationSelection();setOpen(true);}
    };
    const listen=(node,type,fn)=>{if(typeof node.addEventListener==='function')node.addEventListener(type,fn);else node['on'+type]=fn;};
    const takeFiles=list=>{if(list?.length)void controller.stageUploads(list);};
    listen(panel,'dragover',event=>{if(event?.dataTransfer)event.preventDefault?.();});
    listen(panel,'drop',event=>{event?.preventDefault?.();takeFiles(Array.from(event?.dataTransfer?.files||[]));});
    listen(input,'paste',event=>{const files=Array.from(event?.clipboardData?.files||[]);if(files.length){event.preventDefault?.();takeFiles(files);}});
    for (const b of [newConversation, stop]) b.type = 'button'; iconButton(newConversation,'newChat','新对话（清空当前聊天记录）'); iconButton(stop,'stop','停止'); iconButton(send,'send','发送'); send.type = 'submit'; const estimateLabel=el('span','nf-xiaotao-estimate',''); estimateLabel.setAttribute('data-idle','1'); providers.append(modelSelect);title.append(providers);footerActions.append(upload,newConversation, stop, estimateLabel, send); const inputBox=el('div','nf-xiaotao-input-box'),inputField=el('div','nf-xiaotao-input-field');inputField.append(input);inputBox.append(stagedRow,inputField);footer.append(inputBox,footerActions);
    providers.append(modelTrigger);
    panel.append(header, modelMenu, messages, mediaPromptPanel, proposal, tools, status, error, footer); host.append(modelBackdrop, fab, panel); doc.body.append(host);
    // Same @ references as the prompt boxes: page references first, then this turn's attachments.
    let mentionHandle=null;
    const mentionResources=()=>{
      const page=Array.from(root.__NovaFlowArtGenerate?.references?.()||[]).filter(Boolean).map(ref=>({id:ref.identity||ref.name,name:ref.name||ref.file?.name||'',previewUrl:ref.previewUrl||ref.dataUrl||''}));
      const staged=(controller.state.staged||[]).filter(item=>item.kind==='image').map(item=>({id:item.id,name:item.name,previewUrl:item.previewUrl||''}));
      return [...page,...staged].map((row,index)=>({key:'art_reference_'+(index+1),sourceId:String(row.id||index),occupied:true,kind:'image',fileName:row.name,previewUrl:row.previewUrl}));
    };
    const mountMentions=()=>{try{mentionHandle=root.NovaFlowResourceMentionTool?.mountTextarea?.({textarea:input,surface:'art-generate',getResources:mentionResources})||mentionHandle;}catch{}};
    const syncMentions=()=>{try{mentionHandle?.refresh?.();}catch{}};
    const focusInput=()=>{if(mentionHandle?.focus)mentionHandle.focus();else input.focus();};
    listen(inputField,'keydown',event=>{if(event.target!==input&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.defaultPrevented){event.preventDefault();footer.requestSubmit();}});
    const drag = bindPanelDrag(panel, header, {onStart:()=>{if(!picker.isOpen())return;const rect=panel.getBoundingClientRect();Object.assign(panel.style,{left:rect.left+'px',top:rect.top+'px'});picker.close({quiet:true});}});
    const robotDrag = bindPanelDrag(fab, fab, {threshold:5,ignoreInteractive:false,onEnd:() => {if (open) anchorPanel();}});
    const bridge = createBridge(); let rendered = [], renderedCharges = '', renderedProposal = null, open = false, lastPricingKey=null,nodeRecheck=null;
    let controller, controllerEpoch=0, sessionRetired=false;
    const makeController=()=>{
      const epoch=++controllerEpoch;
      return createController({bridge,onChange:state=>{if(epoch===controllerEpoch)render(state);}});
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
      input.value='';syncMentions();rendered=[null];renderedProposal=null;lastPricingKey=null;
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
    if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', () => {nodeRecheck.stop();retireSession();});
    if (typeof root.addEventListener === 'function') root.addEventListener('pageshow', () => {restoreSession();nodeRecheck.start();if(qwenRecheckEligible())void nodeRecheck.refreshNow();});
    if (typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => {if(qwenRecheckEligible())void nodeRecheck.refreshNow();else nodeRecheck.update();});
    if (typeof root.addEventListener === 'function') root.addEventListener('novaflow:compute-node', () => {controller.invalidateLocalCapability();nodeRecheck.reset();if(qwenRecheckEligible())void nodeRecheck.refreshNow();});
    if (typeof root.addEventListener === 'function') root.addEventListener('novaflow:runtime-features', () => render(controller.state));
    async function copyText(text, button, target) {return copyMessageText(text,button,doc,root,target);}
    function syncModelOptions() {
      if(onlinePricingGroup){const label=onlineGroupLabel(controller);if(onlinePricingGroup.label!==label)onlinePricingGroup.label=label;picker.setGroupLabel('online',label);}
      for(const [id,option] of modelOptions){const text=modelOptionInfo(controller,id).optionText;if(option.textContent!==text)option.textContent=text;}
      picker.sync();
    }
    function render(state) {
      lastPricingKey=controller.pricingPolicyKey();
      const charges=billingByTurn(controller.visibleBillingNotices()),chargeKey=[...charges].join(';');
      if (CHAT_MODELS[state.modelId]?.retired) {retiredSelection.value=state.modelId;if (!retiredSelection.parentNode) modelSelect.prepend(retiredSelection);}
      else if (retiredSelection.parentNode) retiredSelection.remove();
      syncModelOptions();
      if (chargeKey !== renderedCharges || state.messages.length !== rendered.length || state.messages.some((m, i) => m !== rendered[i])) {
        rendered = state.messages.slice(); renderedCharges = chargeKey; messages.replaceChildren();
        let turn = 0; const rows = conversationRows(state.messages.map(m => {if (m.role === 'user' && Number.isSafeInteger(m.turn)) turn = m.turn; return {...m, chargeTurn:turn};}));
        // The charge goes under the last reply of its turn, so each amount sits with what it bought.
        const lastOfTurn = new Map(); rows.forEach((row, index) => {if (row.chargeTurn && (row.role !== 'user' || !lastOfTurn.has(row.chargeTurn))) lastOfTurn.set(row.chargeTurn, index);});
        if (!rows.length) messages.append(intro);
        rows.forEach((row, index) => {
          const node = renderConversationRow(doc, {...row,receipts:[]}, {copyText, chooseUploadDestination:controller.chooseUploadDestination}); messages.append(node);
          const amount = lastOfTurn.get(row.chargeTurn) === index ? charges.get(row.chargeTurn) : undefined;
          if (amount !== undefined && Number(amount) > 0) {const charge = el('div', 'nf-xiaotao-charge nf-xiaotao-charge-' + (row.role === 'user' ? 'user' : 'reply'), billingNoticeText({confirmed:amount})); charge.setAttribute('role','note'); messages.append(charge);}
        });
        messages.scrollTop = messages.scrollHeight;
      }
      const stagedItems = state.staged || []; if(stagedItems.length!==stagedRow.childElementCount)syncMentions(); stagedRow.hidden = !stagedItems.length; stagedRow.replaceChildren(); for (const item of stagedItems) {const card=el('div','nf-xiaotao-staged-item');card.setAttribute('data-status',item.status);if(item.status==='reading')card.setAttribute('aria-busy','true');const imagePreview=item.kind==='image' && item.previewUrl;const thumb=imagePreview?el('img','nf-xiaotao-staged-thumb'):el('div','nf-xiaotao-staged-fallback',item.kind==='video'?'视频':item.kind==='audio'?'音频':'文件');if(imagePreview){thumb.src=item.previewUrl;thumb.alt=item.name;thumb.setAttribute('alt',item.name);}if(item.status==='reading')card.append(el('span','nf-xiaotao-staged-spinner'));const remove=el('button','nf-xiaotao-staged-remove','×');remove.type='button';remove.setAttribute('aria-label','移除 '+item.name);remove.onclick=event=>{event.preventDefault?.();event.stopPropagation?.();controller.removeStaged(item.id);};card.append(thumb,remove);stagedRow.append(card);}
      const warm = state.localSession?.state === 'warm' && state.localSession.modelLoaded === true;
      titleText.title = state.provider === 'api' ? '在线智能' : state.modelId !== 'next' ? CHAT_MODELS[state.modelId]?.label || '本地模型' : warm ? '本地智能 · 上次已就绪' : '本地智能';
      const activity = state.generating || state.applying ? 'working' : state.pending ? 'thinking' : 'idle';
      fab.dataset.state = activity; robotState.textContent = activity === 'working' ? '工作中' : state.provider === 'local' && state.pending ? ({loading:'加载中',analyzing:'分析中',releasing:'释放中'}[state.operation?.phase] || {loading:'加载中',answering:'回答中',releasing:'释放中',warm:'准备回答'}[state.localSession?.state] || '连接中') : state.pending ? '回答中' : state.confirmation ? '等待确认' : state.provider === 'local' && warm ? '上次已就绪' : '待机'; fab.setAttribute('aria-label','小桃AI，'+robotState.textContent+'，点击聊天，可拖动');
      tools.textContent = [...new Set(state.toolTrace.map(step => ({get_art_context:'已读取当前绘图',propose_art_direction:'已整理完整提示词',apply_art_direction:'模型请求写入提示框',generate_art_image:'模型请求绘图执行',apply_prompt_completed:'已写入提示框',generate_completed:'已完成实际生图'}[step.name] || '')).filter(Boolean))].join(' · ');
      status.textContent = state.modelId==='qwen3.5-9b-heretic' && !controller.modelAvailable(state.modelId) && !state.pending
        ? (state.qwen35CpuTrialChecked===true?'当前无可用节点 · 未提交，不扣积分。':'设备待检测 · 未提交，不扣积分。')
        : state.status || (state.provider==='api' && controller.modelAvailable(state.modelId)?'':CHAT_MODELS[state.modelId]?.detail) || '';
      error.textContent = state.error; error.hidden = !state.error; proposal.hidden = !state.proposal;
      const busy = state.pending || state.generating || state.applying || state.uploading || state.staging,retired=CHAT_MODELS[state.modelId]?.retired===true;
      mediaPromptPanel.hidden=!state.mediaPromptProposal&&!state.mediaPromptCanUndo;
      mediaPromptApply.hidden=mediaPromptCancel.hidden=!state.mediaPromptProposal;mediaPromptUndo.hidden=!state.mediaPromptCanUndo;
      mediaPromptApply.disabled=mediaPromptCancel.disabled=mediaPromptUndo.disabled=busy;
      mediaPromptText.textContent=state.mediaPromptProposal?`确认将上方草稿应用到${state.mediaPromptProposal.surface==='video'?'视频':state.mediaPromptProposal.surface==='ui'?'UI':'音频'}提示词？不会自动生成。`:'可撤销本次提示词应用。';
      if(state.proposal!==renderedProposal) {renderedProposal=state.proposal; proposal.open=Boolean(state.proposal); copyPrompt.textContent='复制完整提示词';}
      proposalText.textContent = state.proposal?.prompt || ''; applyButton.disabled = retired || busy || state.applied; generateButton.disabled = retired || busy; newConversation.disabled = retired || busy; upload.disabled=retired || busy; send.disabled = retired || busy || (state.provider==='api' && !controller.modelAvailable(state.modelId)); stop.hidden = !state.pending && !state.generating; input.disabled = retired || busy;
      const imageReview=state.proposal?.kind==='foart-online-review';generateButton.hidden=imageReview&&(state.proposal?.generateRequested!==true||state.applied);generateButton.textContent=imageReview?'确认并生成（另计费）':'应用并生成一张';cancelImageReviewButton.hidden=!imageReview||state.applied;undoImageReviewButton.hidden=!imageReview||!state.foartImageReviewCanUndo;cancelImageReviewButton.disabled=busy;undoImageReviewButton.disabled=busy;
      modelSelect.disabled = busy || state.staged.some(item=>item.status==='reading'); modelSelect.value = state.modelId; modelSelect.title = (state.provider==='api' && !retired ? (controller.modelAvailable(state.modelId) ? '在线收费 · 按实际用量结算' : controller.pricingPolicyKey() ? '在线收费 · 当前线路或积分价格不可用，不能发送' : '在线收费 · 价格状态暂不可用，不能发送') : (CHAT_MODELS[state.modelId]?.detail || ''))+(state.localModelStatus?.id===state.modelId ? (state.localModelStatus.modelLoaded ? ' · 节点报告已加载' : ' · 节点报告未加载') : '');
      modelTrigger.disabled=modelSelect.disabled;modelTrigger.title=modelSelect.title;
      if(modelTrigger.disabled)picker.close();
      paintEstimate();
      if(!open || state.modelId!=='qwen3.5-9b-heretic' || controller.modelAvailable('qwen3.5-9b-heretic'))nodeRecheck?.reset();else nodeRecheck?.update();
    }
    function paintEstimate() {
      const prices = root.NovaFlowFeatureCreditPrices;
      let text = '';
      if (controller.state.provider === 'api' && controller.modelAvailable(controller.state.modelId) && typeof prices?.estimateXiaotaoOnline === 'function') {
        const quote = controller.onlineQuote(input.value);
        text = quote?.credits ? `预估${quote.credits}分` : '';
        const title = quote?.credits ? `粗略预估 ${quote.low ?? quote.credits}–${quote.high ?? quote.credits} 分；按返回用量计算，预估不是供应商账单。${controller.onlinePriceDetails()}` : controller.onlinePriceDetails();
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
    const setOpen = value => {open = value; panel.hidden = !value; fab.setAttribute('aria-expanded', String(value)); if (value) {mountMentions();anchorPanel(); tick();if(qwenRecheckEligible())void nodeRecheck.refreshNow();if(controller.state.provider==='api')void controller.refreshPricingPolicy();else controller.prefetchPricingPolicy();input.focus();} else {nodeRecheck.reset();picker.close({quiet:true});controller.clearSelectionTickets();controller.cancelQwenSeek();render(controller.state);}};
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
    newConversation.onclick = () => {if (controller.reset()) {input.value = ''; syncMentions(); focusInput();}};
    const refreshModelOptions=()=>{syncModelOptions();controller.prefetchPricingPolicy();};
    const closeModelMenu=(focus=false,retainBackdrop=false)=>picker.close({focus,retainBackdrop});
    const positionModelMenu=()=>{const box=panel.getBoundingClientRect(),anchor=modelTrigger.getBoundingClientRect(),width=Math.max(0,Math.min(340,box.width-16));Object.assign(modelMenu.style,{width:width+'px',left:'8px',top:Math.max(0,anchor.bottom-box.top+4)+'px'});};
    let modelViewportWidth=root.innerWidth,modelViewportHeight=root.innerHeight;
    const refreshModelViewport=()=>{if(!open||!picker.isOpen())return;const width=root.innerWidth,height=root.innerHeight;if(width===modelViewportWidth&&height===modelViewportHeight)return;modelViewportWidth=width;modelViewportHeight=height;drag.reclamp();positionModelMenu();};
    root.addEventListener?.('resize',refreshModelViewport);root.visualViewport?.addEventListener?.('resize',refreshModelViewport);
    if(typeof root.ResizeObserver==='function'&&doc.documentElement){const observer=new root.ResizeObserver(refreshModelViewport);observer.observe(doc.documentElement);}
    const chooseModel=id=>{closeModelMenu();modelSelect.value=id;if(controller.setModel(id)){if(controller.state.provider==='local')void controller.calibrateLocalStatus();input.focus();}else{modelSelect.value=controller.state.modelId;modelTrigger.focus();}};
    modelSelect.onchange=()=>chooseModel(modelSelect.value);
    footer.onsubmit = async event => {
      event.preventDefault();const text=input.value;if(!text.trim())return;
      const activeController=controller, before=activeController.state.messages.length;input.value='';syncMentions();
      try{await activeController.send(text);}catch(failure){if(!sessionRetired&&controller===activeController){activeController.state.error='本次操作未能提交：'+String(failure?.message||failure);activeController.state.status='未提交生成';render(activeController.state);}}
      if(sessionRetired||controller!==activeController)return;
      if(!input.value&&!activeController.state.messages.slice(before).some(row=>row.role==='user'&&row.content===text)){input.value=text;syncMentions();focusInput();}
    };
    input.onkeydown = event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); footer.requestSubmit();}};
    input.oninput = () => {try{paintEstimate();}catch{estimateLabel.textContent='用量暂无法预估';}};
    function tick() {
      if (drag.dragging() || robotDrag.dragging()) return;
      closeOnNavigation();
      controller.refreshContext(); if (!open) return;
      const policyKey=controller.pricingPolicyKey();if(policyKey!==lastPricingKey){lastPricingKey=policyKey;render(controller.state);}if(controller.state.provider==='api')controller.prefetchPricingPolicy();
    }
    render(controller.state); root.setInterval(tick, 500); tick();
    root.NovaFlowXiaotaoArtAgent.panel = Object.freeze({open:() => setOpen(true), close:() => setOpen(false), get controller(){return controller;}});
  }
  root.NovaFlowXiaotaoArtAgent = {MODEL_PICKER_GROUPS, modelOptionInfo, onlineGroupLabel, createModelPicker, selectedModelPayload, communityAttachmentMetadata, compactFoartHistory, compactFoartReceipt, fingerprint, sameSnapshot, executionIntent, samplingRequest, samplingChoice, feedbackRequest, clampPanelPosition, anchoredPanelPosition, renderMessageMarkdown, conversationRows, renderConversationRow, createQwenNodeRecheck, qwenExecutionDeviceLabel, bindPanelDrag, createBridge, createController, mount};
  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, {once:true}); else if (root.document?.body) mount();
})(typeof window !== 'undefined' ? window : globalThis);

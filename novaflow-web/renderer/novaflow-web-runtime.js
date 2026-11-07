// NovaFlow Web Runtime.
//
// This loads AFTER proxy-electron-api.js, which has already installed the
// renderer's own browser implementation of electronAPI - the one 4783 runs on
// every day. We do not replace it. We OVERRIDE the handful of methods that
// point at a local ComfyUI and at the desktop's local client API, and leave
// everything else exactly as the renderer expects.
//
// Loading first was wrong: publishing electronAPI early makes
// proxy-electron-api.js stand down, and the renderer then takes its DESKTOP
// path on the strength of whatever capabilities we happen to advertise.
//
// What it translates:
//
//   renderer                          web runtime              elsewhere
//   ------------------------------    ---------------------    ------------------
//   getWorkflowJson(options)          records an intent        (graph never built)
//   POST /prompt {prompt: intent}     creates a task           control plane
//   GET  /history/<id>                task status -> history   control plane
//   GET  /queue                       synthesised              control plane
//   GET  /view?filename=              signed gateway URL       worker gateway
//   runtimeUploadImage(name, bytes)   grant + PUT              worker gateway
//   clientAuth*                       unchanged                novaflow-backend
//
// The browser never holds a ComfyUI graph: the redacted workflow modules hand
// back {__novaflowServerOnly, module, fn, options}, and that is what travels.

(function (root) {
  'use strict';

  // Operation-v3 can use the legacy whole-credit contract or the explicit
  // decimal-v1 contract. Unknown or partially deployed policies never opt in.
  function decimalCreditPolicy(terms) {
    return terms?.credit_amount_policy==='decimal-v1' && terms?.credit_precision===6 && terms?.credit_rounding==='ceil' && terms?.minimum_positive_credits===0;
  }
  function operationCreditPolicy(terms) {
    if(terms?.billing_scope!=='operation') return false;
    const hasDecimalMarker=['credit_amount_policy','credit_precision','credit_rounding'].some(key=>Object.hasOwn(terms,key));
    return hasDecimalMarker ? decimalCreditPolicy(terms) : terms.minimum_positive_credits===1;
  }
  // Parse the number's canonical decimal form rather than tolerating binary
  // rounding error: values beyond six decimal places must fail closed.
  function validCreditAmount(value, decimal=false) {
    if(typeof value!=='number' || !Number.isFinite(value) || value<0) return false;
    if(!decimal) return Number.isSafeInteger(value);
    const match=/^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(String(value));
    if(!match) return false;
    const micros=BigInt(match[1])*1000000n+BigInt((match[2]||'').padEnd(6,'0'));
    return micros<=BigInt(Number.MAX_SAFE_INTEGER);
  }
  function validOperationQuote(value, terms) {
    return validCreditAmount(value, decimalCreditPolicy(terms)) && (decimalCreditPolicy(terms) || value>=1);
  }
  function validOperationReceipt(receipt, terms) {
    const decimal=decimalCreditPolicy(terms);
    return receipt?.status==='settled' && ['success','cancel'].includes(receipt.outcome) &&
      validCreditAmount(receipt.charged,decimal) && (decimal || receipt.outcome!=='success' || receipt.charged>=1) &&
      validCreditAmount(receipt.uncollected,decimal);
  }

  // Vision requests send the picture in every stage; full PNGs ran past the request window.
  // Several pictures in one request hit the edge function's resource limit (546), so they go smaller.
  async function onlineVisionImage(dataUrl,count=1) {
    if(typeof root.Image!=='function')return dataUrl;
    try {const next=await prepareOnlineStyleImage(dataUrl,{maxSide:count>1?640:1024,type:'image/jpeg'});return next.length<dataUrl.length?next:dataUrl;}catch{return dataUrl;}
  }
  // BEGIN GENERATED xiaotao-online-models (run tools/sync-xiaotao-online-models.mjs)
  const XIAOTAO_ONLINE_MODELS = Object.freeze([{"id":"deepseek/deepseek-v4.1-flash","label":"DeepSeek V4.1 Flash","flatRate":true,"vision":true},{"id":"bytedance/doubao-seed-2.1-lite","label":"豆包 Seed 2.1 Lite","flatRate":true,"vision":true},{"id":"xai/grok-4.7","label":"Grok 4.7","flatRate":false,"vision":true},{"id":"openai/gpt-6.1-sol-saver","label":"GPT-6.1 Sol Saver","flatRate":false,"vision":true}].map(model => Object.freeze(model)));
  const XIAOTAO_ONLINE_MODEL_IDS = Object.freeze(XIAOTAO_ONLINE_MODELS.map(model => model.id));
  const isXiaotaoOnlineModel = id => XIAOTAO_ONLINE_MODEL_IDS.includes(id);
  const isXiaotaoFlatRateModel = id => XIAOTAO_ONLINE_MODELS.some(model => model.id === id && model.flatRate);
  // END GENERATED xiaotao-online-models
  const onlineOperationModel=isXiaotaoOnlineModel;
  const flatRateOnlineModel=isXiaotaoFlatRateModel;
  const XIAOTAO_ONLINE_ART_RELEASE_ENABLED = false;
  // H3 first/last-frame vision remains closed until real-page and ledger
  // acceptance; its independent video and vision policies must also agree.
  const XIAOTAO_H3_VISION_RELEASE_ENABLED = true;
  // The selected-model text-only draft uses the existing art operation and
  // remains independently constrained by server policy and decimal readiness.
  const XIAOTAO_ONLINE_TEXT_ART_RELEASE_ENABLED = true;
  // Scoped visual art still requires server policy, user consent and session binding.
  const XIAOTAO_ONLINE_VISION_ART_RELEASE_ENABLED = true;
  // The control-plane and installed worker must both support frozen reference
  // manifests before this opt-in is changed. Existing H3 submissions remain
  // on their original route while the capability is closed.
  const H3_IDEMPOTENT_TASK_RELEASE_ENABLED = false;
  // A model-proposed rotation must not use a generic or read-only node route.
  // Availability remains false unless the authenticated control plane confirms
  // the selected owned node and the separately enabled candidate route.
  const QWEN_ROTATION_CANDIDATE_ID = /^fa047a0a-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const QWEN_ROTATION_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const QWEN_PLAN_SCOPE = 'qwen-foart-plan-v1';
  const QWEN_PLAN_REQUEST_FILE = 'qwen-foart-plan-request.json';
  const QWEN_IMAGE_EDIT_SCOPE = 'qwen21-local-image-edit-v1';
  const QWEN_IMAGE_EDIT_CAPABILITY = 'qwen3.5-9b-heretic-qwen21-local-image-edit-v1';
  const QWEN_IMAGE_EDIT_REQUEST_FILE = 'qwen21-local-image-edit-request.json';
  function qwenImageEditLanguage(prompt,requirements){
    const instruction=String(requirements||'').trim()||String(prompt||'');
    const descriptive=instruction.replace(/[“「『][^”」』\r\n]*[”」』]|“[^”]*”|‘[^’]*’|"[^"\r\n]*"|(?<![A-Za-z0-9])'[^'\r\n]+'(?![A-Za-z0-9])|<image\d+>|@参考图\s*\d+|__NF[A-Za-z0-9_]+__/gu,'');
    return /[\u3400-\u9fff]/u.test(descriptive)?'zh':'en';
  }
  // Result objects can only acquire this binding after a server-authenticated
  // task roundtrip; model-provided fields are never treated as task identity.
  const qwenPlanBindings = new WeakMap();
  const CONFIG = Object.assign({
    controlUrl: 'http://127.0.0.1:4890',
    authUrl: 'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend',
    pollIntervalMs: 900
  }, root.NOVAFLOW_WEB_CONFIG || {});

  // Anti-copy rule: no text the user sees names a model, engine or plugin; it says what is being
  // done. Every status line, progress box and error the panels show passes through this, and so
  // does every failure a compute node reports.
  const MODEL_WORDS = /\bMiniMax[ _-]?H3\b|\bMiniMax\b|\bQwen[\w.-]*(?:\s+Rapid\s+AIO(?:\s+NSFW)?(?:\s+V?\d+)?)?|\bRapid[ -]AIO(?:[ -]NSFW)?\b|\bFlux(?:\s+Fill)?\b|\bFLUX\b|\bSeedVR2?(?:\s+3B)?(?:\s+FP8)?\b|\bSee-?through\b|\bComfyUI\b|\bBiRefNet\w*|\bRMBG\b|\bSAM\b|\bWan\s?2[._]?2\b|\bGrok\b|\bIdeogram(?:\s+\d)?\b|\bH3\b/g;
  function neutralText(value) {
    const text = String(value == null ? '' : value);
    MODEL_WORDS.lastIndex = 0;
    if (!MODEL_WORDS.test(text)) return text;
    MODEL_WORDS.lastIndex = 0;
    return text.replace(MODEL_WORDS, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/([\u4e00-\u9fff]) (?=[\u4e00-\u9fff])/g, '$1')
      .replace(/ +([，。；：、）,.;:])/g, '$1')
      .replace(/（ +/g, '（')
      .replace(/(^|\n)[ \t]*[·:：,，/+-][ \t]*/g, '$1')
      .trim() || '处理中';
  }
  root.NovaFlowNeutralText = neutralText;
  // A compute node's failure text is its engine's own exception (node class names, file names,
  // stack lines); only a message the node wrote for people is passed on, neutralised.
  function taskErrorText(task) {
    const raw = String((task && (task.error_message || task.error_code)) || '');
    // Only a terminal task carrying the server's explicit confirmation may
    // say the compute was closed. A dropped heartbeat or worker abort by
    // itself is ambiguous and must keep its existing message.
    if (task && ['failed','cancelled','expired'].includes(task.status) && task.error_code === 'compute_closed_confirmed') return '算力已关闭';
    if (task && task.status === 'failed' && task.error_code === 'h3_result_unknown') return '任务结果还没有确认，请稍后查看任务列表';
    if (task && task.status === 'failed' && task.error_code === 'compute_lease_expired') return '算力连接已失效，任务已中断';
    if (task && task.status === 'cancelled') return '任务已中止';
    if (task && task.status === 'expired') return '任务超时，请重试';
    if (/out of memory|CUDA|显存/i.test(raw)) return '算力节点显存不足，请降低分辨率或数量后重试';
    if (!/[\u4e00-\u9fff]/.test(raw)) return '生成失败，请重试';
    return neutralText(raw);
  }

  const SESSION_KEY = 'novaflow_web_session_v1';
  const CLIENT_AUTH_KEY = 'novaflow.client.auth.session.v1';
  const SIGNOUT_REASON_KEY = 'novaflow.web.signout-reason';
  // The launcher chooses the DEFAULT endpoint: the local assistant's own machine, or the shared pool on
  // the hosted site. Prompt-assistant and licence calls follow this and nothing else.
  const computeMode = CONFIG.localAssistant ? 'local' : 'shared';
  const taskModes = new Map();
  // 算力源: the pool node the user pinned in the topbar (novaflow-web-compute-node.js). Pinned work
  // always goes through the control plane, carries the node id, and asks capabilities about that
  // node alone - also from a page the local assistant opened, whose own machine is the default.
  const NODE_KEY = 'novaflow.web.compute.node.v1';
  const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let computeNode = null, computeNodeEpoch = 0;
  try {
    const saved = JSON.parse(root.localStorage.getItem(NODE_KEY) || 'null');
    if (saved && NODE_ID.test(String(saved.id))) computeNode = { id: String(saved.id), name: String(saved.name || '') };
  } catch (_) { /* private mode: nothing pinned */ }
  const taskMode = () => (CONFIG.localAssistant && !computeNode ? 'local' : 'shared');
  let localKey = '';
  if (CONFIG.localAssistant && root.location) {
    try {
      const pair = new URLSearchParams(root.location.hash.slice(1)).get('local-pair');
      if (pair && /^[a-f0-9]{64}$/.test(pair)) {
        root.sessionStorage.setItem('novaflow.local.pair', pair);
        root.history.replaceState(null, '', root.location.pathname + root.location.search);
      }
      localKey = root.sessionStorage.getItem('novaflow.local.pair') || '';
    } catch (_) {}
  }

  // ---------------------------------------------------------------- session
  let session = null, foartSessionEpoch = 0;
  const foartSessionObservers=new Set();
  function invalidateFoartSession(){
    foartSessionEpoch++;
    for(const observer of [...foartSessionObservers]){try{observer();}catch{/* Never interrupt login or logout. */}}
  }
  function currentSession() {
    const previousToken=session?.token || '';
    try {
      const savedRaw = root.localStorage.getItem(CLIENT_AUTH_KEY);
      const primaryRaw = root.localStorage.getItem(SESSION_KEY);
      let saved = null, primary = null;
      try { saved = JSON.parse(savedRaw || 'null'); } catch (_) {}
      try { primary = JSON.parse(primaryRaw || 'null'); } catch (_) {}
      // The shared account panel can retain a valid login after an older Web
      // status probe removed only SESSION_KEY. Re-read on each request so an
      // editor opened before login also sees a login made in another tab.
      session = saved?.session?.token
        ? { token: saved.session.token, user: saved.user || primary?.user || null }
        : primary?.token ? primary : null;
    } catch (_) { /* private mode may only retain the in-memory session */ }
    if((session?.token||'')!==previousToken)foartSessionEpoch++;
    return session;
  }
  currentSession();
  root.addEventListener?.('storage',event=>{
    if(event.key===SESSION_KEY||event.key===CLIENT_AUTH_KEY||event.key===null)invalidateFoartSession();
  });
  root.addEventListener?.('novaflow-client-auth-changed',invalidateFoartSession);
  function foartStoredIdentity(){
    try {
      const saved=JSON.parse(root.localStorage.getItem(CLIENT_AUTH_KEY)||'null');
      const primary=JSON.parse(root.localStorage.getItem(SESSION_KEY)||'null');
      const value=saved?.session?.token?saved.session:primary?.token?primary:null;
      if(!value||typeof value.token!=='string'||!value.token.startsWith('nfs_'))return null;
      if(value.refreshToken!=null&&typeof value.refreshToken!=='string')return null;
      if(value.expiresAt!=null&&value.expiresAt!==''&&!['string','number'].includes(typeof value.expiresAt))return null;
      return {token:value.token,refreshToken:value.refreshToken||'',expiresAt:value.expiresAt??''};
    } catch{return null;}
  }
  function captureFoartSessionGuard(){
    if(typeof root.addEventListener!=='function'||typeof root.removeEventListener!=='function')return null;
    const persisted=()=>{try{return root.NovaFlowClientAuth?.hasPersistedSessionIdentity?.()===true;}catch{return false;}};
    if(!persisted())return null;
    const identity=foartStoredIdentity(),active=currentSession(),epoch=foartSessionEpoch;
    if(!identity||active?.token!==identity.token)return null;
    let expiresAtMs;
    try {
      const part=identity.token.slice(4).split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
      const exp=Number(JSON.parse(root.atob(part.padEnd(Math.ceil(part.length/4)*4,'='))).exp);
      if(!Number.isSafeInteger(exp)||exp<=0)return null;
      expiresAtMs=exp*1000;if(!Number.isSafeInteger(expiresAtMs))return null;
      if(identity.expiresAt!==''){
        const numeric=Number(identity.expiresAt);
        const stored=Number.isFinite(numeric)&&numeric>0?(numeric<1_000_000_000_000?numeric*1000:numeric):Date.parse(String(identity.expiresAt));
        if(!Number.isFinite(stored)||stored<=0)return null;
        expiresAtMs=Math.min(expiresAtMs,stored);
      }
    } catch{return null;}
    if(expiresAtMs<=Date.now())return null;
    const guard=()=>{
      const now=foartStoredIdentity(),current=currentSession();
      return persisted()&&!!now&&current?.token===identity.token&&now.token===identity.token&&now.refreshToken===identity.refreshToken&&
        now.expiresAt===identity.expiresAt&&foartSessionEpoch===epoch&&Date.now()<expiresAtMs;
    };
    Object.defineProperty(guard,'expiresAtMs',{value:expiresAtMs});return guard;
  }
  function captureFoartBillingOwner(){
    const current=captureFoartSessionGuard(),token=currentSession()?.token;
    if(typeof current!=='function'||!current()||typeof token!=='string')return null;
    try {
      const part=token.slice(4).split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
      const owner=JSON.parse(root.atob(part.padEnd(Math.ceil(part.length/4)*4,'=')))?.sub;
      return typeof owner==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(owner) ? {owner,current} : null;
    }catch{return null;}
  }
  const validOperationId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

  // The published site can run behind a Cloudflare Pages gate (deploy/_worker.js)
  // that serves the application code only to a logged-in browser. A <script src>
  // or an importScripts() worker request cannot carry an Authorization header,
  // but it does carry same-origin cookies, so the signed session token is
  // mirrored into a cookie the edge can read. Off the gate this cookie is simply
  // ignored. Kept in sync with the session at its single choke points.
  const SESSION_COOKIE = 'nf_sess';
  function syncAuthCookie(token) {
    try {
      const doc = root.document;
      if (!doc || typeof doc.cookie !== 'string') return;
      const secure = (root.location && root.location.protocol === 'https:') ? '; Secure' : '';
      if (token) doc.cookie = SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; Max-Age=86400; SameSite=Lax' + secure;
      else doc.cookie = SESSION_COOKIE + '=; Path=/; Max-Age=0; SameSite=Lax' + secure;
    } catch (_) { /* document/cookies unavailable (worker scope, private mode) */ }
  }

  function saveSession(next) {
    invalidateFoartSession();
    session = next;
    try {
      if (next) root.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else root.localStorage.removeItem(SESSION_KEY);
    } catch (_) { /* private mode */ }
    syncAuthCookie(next && next.token);
  }

  // A returning visitor already carries the cookie (its lifetime matches the
  // token's), but if it was cleared while the stored session is still valid,
  // reinstate it now so the next navigation can load the gated code.
  syncAuthCookie(session && session.token);

  function authHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const active = currentSession();
    if (active?.token) headers.Authorization = 'Bearer ' + active.token;
    return headers;
  }

  async function api(base, method, path, body, timeoutMs = 20000, signal) {
    const res = await fetch(base.replace(/\/+$/, '') + path, {
      method: method,
      signal: signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined),
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch (_) { parsed = { error: text.slice(0, 300) }; }
    if (!res.ok) {
      const error = new Error(String(parsed.error || (res.status === 546 ? '在线服务达到运行限制，本次未完成，请稍后重试' : res.status === 504 ? '在线服务响应超时，本次未完成' : 'request failed ' + res.status)));
      error.status = res.status;
      error.code = parsed.code;
      throw error;
    }
    noteChargeBalance(path, parsed);
    return parsed;
  }

  // A charge or a refund answers with the balance it left behind. Profile
  // reads are the header's own refresh, so they must not schedule another one.
  function balanceFromPayload(parsed) {
    if (!parsed || typeof parsed !== 'object') return undefined;
    const nested = parsed.result && typeof parsed.result === 'object' ? parsed.result
      : (parsed.data && typeof parsed.data === 'object' ? parsed.data : null);
    const spots = [parsed, nested];
    for (const spot of spots) {
      if (!spot) continue;
      const quota = spot.quota && typeof spot.quota === 'object' ? spot.quota : null;
      const billing = spot.billing && typeof spot.billing === 'object' ? spot.billing : null;
      const candidates = [
        quota && quota.balance_after,
        billing && (billing.balanceAfter ?? billing.balance_after)
      ];
      for (const value of candidates) {
        if (value != null && value !== '') return value;
      }
    }
    return undefined;
  }

  function notifyAccountBalance(balance, source) {
    if (typeof root.dispatchEvent !== 'function') return;
    const detail = { source: source || 'charge' };
    if (balance != null && balance !== '') detail.balance = balance;
    try {
      const event = typeof root.CustomEvent === 'function'
        ? new root.CustomEvent('novaflow:account-balance', { detail: detail })
        : { type: 'novaflow:account-balance', detail: detail };
      root.dispatchEvent(event);
    } catch (_) {}
  }

  function noteChargeBalance(path, parsed) {
    const clean = String(path || '').split('?')[0];
    if (/\/api\/client\/bootstrap$|\/api\/web\/me$/.test(clean)) return;
    const balance = balanceFromPayload(parsed);
    if (balance == null || balance === '') return;
    // The response can belong to an older account/session, including when a
    // cross-tab storage event has not yet been delivered. Refresh the current
    // account instead of painting a balance from this response.
    if (currentSession()?.token) notifyAccountBalance(undefined, 'charge');
  }

  async function localControl(method, path, body, timeoutMs = 30000) {
    if (!CONFIG.localAssistant) throw new Error('请从 Foart 官网进入工作区，并连接 Foart');
    const res = await fetch(CONFIG.localOrigin + path, { method,
      headers: { 'content-type': 'application/json', 'x-novaflow-local': localKey },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const value = await res.json();
    if (!res.ok) throw Object.assign(new Error(value.error || '本机服务请求失败'), { status: res.status });
    return value;
  }
  // 提示词助手 runs on the machine 启动NovaFlow opened this page from: the
  // assistant starts the desktop's own Python service and answers in the
  // desktop bridge's shape. The hosted site has no such machine, so there the
  // buttons say so and 智能 AI's Grok path stays. A run can load a 7B model
  // and, for H3, look at a dozen frames, hence the long wait.
  const PROMPT_ASSISTANT_REFUSAL = '提示词助手在 Web 版通过智能 AI 提供';
  const PROMPT_ASSISTANT_TIMEOUT_MS = 16 * 60 * 1000;
  const pooledPromptRequests = new Map();
  const pooledConversationNodes = new Map();
  // Capture the selected brain from this tab only. No fallback to another
  // local model or a paid provider when the selection is unavailable.
  async function selectedBusinessPrompt(action, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {ok:false,errorCode:'invalid-request',error:'请求格式不正确。'};
    // 'aifx-material': the 特效 material reader keeps its own model choice (same list as 小桃)
    // and may only read a reference picture online. Everything else follows 小桃's choice.
    if (payload.assistantSelectionScope === 'aifx-material') {
      const owner = root.FoartAifxMaterialModel, read = owner?.businessModelSnapshot;
      const selected = typeof read === 'function' ? read() : null;
      if (action !== 'describe-art-style' || payload.purpose !== 'aifx-material' || selected?.provider !== 'api' || typeof selected.modelId !== 'string' || !Number.isSafeInteger(selected.epoch))
        return {ok:false,errorCode:'invalid-request',error:'材质识别请求无效，本次未提交。'};
      if (payload.assistantSelectionEpoch !== selected.epoch) return {ok:false,errorCode:'assistant-selection-mismatch',error:'模型选择已变化，请重新识别。'};
      return selectedOnlineStyleAnalysis(payload,selected,owner);
    }
    if (Object.hasOwn(payload,'assistantSelectionScope') && payload.assistantSelectionScope !== 'xiaotao') return {ok:false,errorCode:'invalid-request',error:'模型选择范围无效，本次未提交。'};
    const scoped = payload.assistantSelectionScope === 'xiaotao' || Object.hasOwn(payload,'assistantProvider') || Object.hasOwn(payload,'assistantModelId') || Object.hasOwn(payload,'assistantSelectionEpoch');
    if (!scoped) return localPromptAssistant(action,payload);
    const {assistantSelectionScope,assistantSelectionEpoch,...request} = payload;
    const nodeEpoch=computeNodeEpoch;
    const controller = root.NovaFlowXiaotaoArtAgent?.panel?.controller;
    const read = controller?.businessModelSnapshot;
    const selected = typeof read === 'function' ? read() : null;
    if (!selected || typeof selected.modelId !== 'string' || typeof selected.provider !== 'string' || !Number.isSafeInteger(selected.epoch))
      return {ok:false,errorCode:'assistant-selection-unavailable',error:'请先打开小桃并选择模型，再使用此功能。'};
    if (payload.assistantSelectionEpoch !== undefined && payload.assistantSelectionEpoch !== selected.epoch)
      return {ok:false,errorCode:'assistant-selection-mismatch',error:'模型选择已变化，请重新操作。'};
    if(selected.provider==='api'&&action==='video-draft-prompt')return selectedOnlineVideoDraft(payload,selected,controller);
    if(action==='video-draft-prompt')return {ok:false,errorCode:'video-draft-unavailable',error:'当前模型尚未接通视频文字草稿，未提交或扣费。'};
    if(selected.provider==='api'&&action==='ui-draft-prompt')return selectedOnlineUiDraft(payload,selected,controller);
    if(selected.provider==='local'&&selected.modelId==='qwen3.5-9b-heretic'&&action==='ui-draft-prompt')return selectedQwenUiDraft(payload,selected,controller);
    if(selected.provider==='api'&&action==='rewrite-audio-prompt')return selectedOnlineAudioRewrite(payload,selected,controller);
    if(selected.provider==='api'&&action==='describe-art-style')return selectedOnlineStyleAnalysis(payload,selected,controller);
    if(selected.provider==='local'&&selected.modelId==='qwen3.5-9b-heretic'&&action==='describe-art-style')return selectedQwenStyleAnalysis(payload,selected,controller);
    if(selected.provider==='api')return selectedOnlineBusinessPrompt(action,payload,selected,controller);
    if(!qwenBusinessAvailable())return {ok:false,errorCode:'qwen-business-unavailable',error:'本地业务试用未开放或当前节点未就绪，未提交。'};
    if (selected.provider !== 'local' || selected.modelId !== 'qwen3.5-9b-heretic')
      return {ok:false,errorCode:'assistant-business-model-unavailable',error:'所选模型暂未接通此功能；没有切换模型或扣费。'};
    if ((payload.assistantProvider !== undefined && payload.assistantProvider !== selected.provider)
      || (payload.assistantModelId !== undefined && payload.assistantModelId !== selected.modelId))
      return {ok:false,errorCode:'assistant-selection-mismatch',error:'模型选择已变化，请重新发起。'};
    if(action==='optimize-prompt' && payload.localImageEdit===true)
      return selectedQwenImageEdit(payload,selected,controller);
    // The installed Qwen business trial currently supports only two text
    // tasks. Reject media before creating or uploading a task, not after the
    // node receives private inputs.
    const textOnlyFailure={ok:false,errorCode:'qwen-business-text-only',error:'当前 Qwen 仅支持纯文字绘图、视频提示词优化和音频文字改写；图片或音视频素材分析尚未开放，本次未提交。'};
    if (!['optimize-prompt','rewrite-audio-prompt'].includes(action)) return textOnlyFailure;
    const artText=payload.surface==='art' && payload.purpose==='optimize' && payload.targetEngine==='qwen-2.1' && payload.qwenPromptMode==='txt2img';
    const h3Text=payload.surface==='animation' && payload.purpose==='minimax-h3-prompt-enhance' &&
      ['text_video','image_video','first_last','multi_reference'].includes(payload.h3Mode);
    if (action==='optimize-prompt' && !artText && !h3Text) return textOnlyFailure;
    if (action==='optimize-prompt' && h3Text && !qwen21NativeRewriteV3Available())
      return {ok:false,errorCode:'qwen-h3-node-unavailable',error:'当前本人节点尚未确认支持视频文字优化，请更新算力助手后重试。'};
    const mediaKeys=new Set(['uploads','attachments','files','images','image','imageurl','imageurls','imagedata','imagedataurl','imagedataurls','photo','photos','picture','pictures','references','referenceimages','referenceimage','referenceimageurl','referenceimageurls','referenceframes','h3referenceframes','videoframes','audio','video','audiodataurl','videodataurl','media','mediadataurl']);
    const stack=[[payload,0]],seen=new Set();let nodes=0;
    while(stack.length){
      const [value,depth]=stack.pop();if(++nodes>1000 || depth>16)return textOnlyFailure;
      if(typeof value==='string'){if(/data:(?:image|audio|video)\//i.test(value)||/<image\s*\d+>|@(?:参考图|reference\s*image)\s*\d+|__NOVAFLOW_RESOURCE_MENTION_[A-Z0-9_:-]+__/i.test(value))return textOnlyFailure;continue;}
      if(!value || typeof value!=='object')continue;
      if(seen.has(value))return textOnlyFailure;seen.add(value);
      if(Array.isArray(value)){for(const item of value)stack.push([item,depth+1]);continue;}
      for(const [key,item] of Object.entries(value)){const normalized=key.toLowerCase().replace(/[_-]/g,'');
        if(mediaKeys.has(normalized) && item!=null && item!=='' && (!Array.isArray(item)||item.length>0))return textOnlyFailure;
        if((normalized==='type'||normalized==='kind') && typeof item==='string' && /^(?:image|audio|video)(?:\/|$)/i.test(item))return textOnlyFailure;
        stack.push([item,depth+1]);}
    }
    const sessionGuard=taskMode()==='local'?null:captureFoartSessionGuard();
    if(taskMode()!=='local'&&(!sessionGuard||typeof root.setTimeout!=='function'||typeof root.clearTimeout!=='function'))
      return {ok:false,errorCode:'assistant-session-unavailable',error:'账号会话无法核验或已过期，本次未提交。'};
    const isCurrent=()=>{
      if(computeNodeEpoch!==nodeEpoch || root.NovaFlowXiaotaoArtAgent?.panel?.controller!==controller || (sessionGuard&&!sessionGuard()))return false;
      const current=read();return current?.provider===selected.provider && current?.modelId===selected.modelId && current?.epoch===selected.epoch;
    };
    if(typeof controller?.subscribeBusinessModel!=='function')return {ok:false,errorCode:'assistant-selection-unavailable',error:'模型状态不可核验，未提交。'};
    const requestId=typeof request.requestId==='string' && request.requestId ? request.requestId : root.crypto?.randomUUID?.();
    if(!requestId)return {ok:false,errorCode:'invalid-request',error:'无法创建请求编号，未提交。'};
    let cancelPromise=null,notifyChanged,sessionInvalidated=false,sessionTimer=null;
    const changed=new Promise(resolve=>{notifyChanged=resolve;});
    const onChange=()=>{if(!cancelPromise){cancelPromise=cancelPromptAssistantRequest({requestId});notifyChanged();}};
    const onSessionChange=()=>{
      if(sessionGuard&&!sessionGuard()){sessionInvalidated=true;onChange();}
    };
    const checkSessionExpiry=()=>{
      if(!sessionGuard)return;
      if(!sessionGuard()){sessionInvalidated=true;onChange();return;}
      sessionTimer=root.setTimeout(checkSessionExpiry,Math.min(2_147_483_647,Math.max(1,sessionGuard.expiresAtMs-Date.now())));
      sessionTimer?.unref?.();
    };
    const unsubscribe=controller.subscribeBusinessModel(onChange);
    if(typeof root.addEventListener==='function')root.addEventListener('novaflow:compute-node',onChange);
    if(sessionGuard){foartSessionObservers.add(onSessionChange);checkSessionExpiry();}
    try {
      if(!isCurrent())return sessionGuard&&!sessionGuard()
        ? {ok:false,errorCode:'assistant-session-unavailable',error:'账号会话已变化或过期，本次未提交。'}
        : {ok:false,errorCode:'assistant-selection-changed',error:'模型选择已变化，未提交。'};
      const work=localPromptAssistant(action,{...request,requestId,assistantProvider:selected.provider,assistantModelId:selected.modelId},{isCurrent});
      const result=await Promise.race([work,changed.then(()=>null)]);
      if(sessionGuard&&!sessionGuard()){sessionInvalidated=true;onChange();}
      if(!isCurrent() || cancelPromise){
        const cancellation=cancelPromise ? await cancelPromise : null;
        if(sessionInvalidated)return {ok:false,errorCode:'assistant-session-cancel-unconfirmed',error:'账号会话已变化或过期，旧任务取消和资源释放尚未确认，请稍后查看节点状态。'};
        return {ok:false,errorCode: cancellation && cancellation.ok===false ? 'assistant-selection-cancel-unconfirmed':'assistant-selection-changed',
          error:cancellation && cancellation.ok===false ? '模型或节点已切换；取消未确认，请稍后查看节点状态。' : '模型或节点已切换，正在尝试取消旧任务；停止和资源释放尚未确认。'};
      }
      return result;
    } finally {unsubscribe();if(sessionTimer!==null)root.clearTimeout(sessionTimer);if(typeof root.removeEventListener==='function'){
      root.removeEventListener('novaflow:compute-node',onChange);
      if(sessionGuard)foartSessionObservers.delete(onSessionChange);
    }}
  }
  async function selectedQwenImageEdit(payload,selected,controller) {
    const fail=message=>({ok:false,errorCode:'qwen-image-edit-unavailable',error:message});
    if(!qwen21LocalImageEditAvailable() || selected.provider!=='local' || selected.modelId!=='qwen3.5-9b-heretic')
      return fail('当前本人节点尚未确认支持参考图优化，请更新算力助手后重试。');
    const images=payload.images,roles=['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference'];
    if(payload.surface!=='art'||payload.purpose!=='optimize'||payload.targetEngine!=='qwen-2.1'||payload.qwenPromptMode!=='img2img'||payload.nsfw===true||
      !Array.isArray(images)||images.length<1||images.length>3||images.some(image=>!image||!roles.includes(image.role)||typeof image.dataUrl!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))||
      typeof payload.currentPrompt!=='string'||!payload.currentPrompt.trim()||payload.currentPrompt.length>4000||
      typeof payload.requirements!=='string'||payload.requirements.length>2000||typeof payload.negativePrompt!=='string'||payload.negativePrompt.length>12000||
      typeof payload.isImageInputCurrent!=='function'||typeof payload.selectionStillCurrent!=='function'||!QWEN_ROTATION_REQUEST_ID.test(String(payload.requestId||'')))
      return fail('参考图优化输入无效，请检查 1–3 张图片和提示词。');
    const originals=images.map(image=>({role:image.role,dataUrl:image.dataUrl}));
    const epoch=computeNodeEpoch,session=captureFoartSessionGuard(),node=computeNode?.id;
    if(typeof session!=='function'||session()!==true||!node||typeof controller?.subscribeBusinessModel!=='function')return fail('当前账号或节点无法确认。');
    const current=()=>{try {const now=controller.businessModelSnapshot();return !payload.signal?.aborted && session()===true && computeNodeEpoch===epoch && computeNode?.id===node &&
      qwen21LocalImageEditAvailable() && root.NovaFlowXiaotaoArtAgent?.panel?.controller===controller && now?.provider===selected.provider && now?.modelId===selected.modelId && now?.epoch===selected.epoch &&
      payload.isImageInputCurrent()===true && payload.selectionStillCurrent()===true && images.length===originals.length && originals.every((image,index)=>images[index]?.role===image.role&&images[index]?.dataUrl===image.dataUrl);}catch{return false;}};
    if(!current())return fail('图片、模型或节点已变化，请重试。');
    const request={requestId:payload.requestId,mode:'image-edit',images:originals,currentPrompt:payload.currentPrompt,
      requirements:payload.requirements,negativePrompt:payload.negativePrompt,promptContract:'qwen21-native-rewrite-v3'};
    if(new TextEncoder().encode(JSON.stringify(request)).byteLength>16*1024*1024)
      return fail('参考图片和文字合计超过 16 MiB，请缩小图片后重试。');
    if(typeof root.Image!=='function')return fail('无法读取参考图尺寸，请刷新页面后重试。');
    let cancelled=false,notifyChanged,timer=null;
    const changed=new Promise(resolve=>{notifyChanged=resolve;});
    const cancel=()=>{if(!cancelled){cancelled=true;void Promise.resolve(cancelPromptAssistantRequest({requestId:request.requestId})).catch(()=>{});notifyChanged();}};
    const sessionChanged=()=>{if(session()!==true)cancel();};
    const watchExpiry=()=>{if(session()!==true){cancel();return;}timer=root.setTimeout(watchExpiry,Math.min(2_147_483_647,Math.max(1,session.expiresAtMs-Date.now())));timer?.unref?.();};
    if(typeof root.addEventListener!=='function'||typeof root.removeEventListener!=='function'||typeof root.setTimeout!=='function'||typeof root.clearTimeout!=='function'||!Number.isSafeInteger(session.expiresAtMs))
      return fail('当前会话无法持续核验，未提交。');
    const unsubscribe=controller.subscribeBusinessModel(cancel);
    root.addEventListener('novaflow:compute-node',cancel);foartSessionObservers.add(sessionChanged);watchExpiry();
    payload.signal?.addEventListener('abort',cancel,{once:true});
    try {
      const work=(async()=>{
        for(const image of originals){
          const size=await new Promise((resolve,reject)=>{const decoded=new root.Image();
            decoded.onload=()=>resolve({width:decoded.naturalWidth,height:decoded.naturalHeight});
            decoded.onerror=()=>reject(new Error('参考图无法解码，请重新选择。'));decoded.src=image.dataUrl;});
          if(!current())throw new Error('图片、模型或节点已变化，请重试。');
          if(!Number.isSafeInteger(size.width)||!Number.isSafeInteger(size.height)||size.width<1||size.height<1||size.width>8192||size.height>8192||size.width*size.height>24000000)
            throw new Error('单张参考图不得超过 8192×8192 或 2400 万像素。');
        }
        return pooledPromptAssistant('optimize-prompt',request,{qwenImageEdit:true,isCurrent:current});
      })();
      const result=await Promise.race([work,changed.then(()=>null)]);
      if(cancelled||!current())return fail('图片、模型、节点或会话已变化，正在尝试取消旧任务；资源释放尚未确认。');
      return result;
    }
    catch(error){return fail(String(error?.message||error));}
    finally {if(timer!==null)root.clearTimeout(timer);unsubscribe?.();root.removeEventListener('novaflow:compute-node',cancel);foartSessionObservers.delete(sessionChanged);payload.signal?.removeEventListener('abort',cancel);}
  }

  // Said when a request may have reached the model and no settlement came back: no amount is claimed and nothing is asked of the person.
  const ONLINE_RESULT_UNCONFIRMED='这次没有拿到在线结果，可以再试一次。';
  const ONLINE_MODEL_NO_ANSWER='在线模型这次没有返回结果，本次未扣费，可以再试一次。';
  // A lost response is not a lost settlement: the server may have closed the operation, so read it a few times before saying anything about money.
  async function settledOperation(base,operationId,isCurrent,decimal,waits=[0,2000,4000]) {
    for(const wait of waits){
      if(wait)await new Promise(done=>setTimeout(done,wait));
      if(!isCurrent())return null;
      try {
        const status=await api(base,'POST','/api/web/companion/operation/status',{operationId},10000),op=status?.ok===true?status.operation:null;
        if(op?.operationId===operationId&&op.status==='settled'&&validCreditAmount(op.charged,decimal)&&(op.uncollected===undefined||validCreditAmount(op.uncollected,decimal)))return op;
      }catch{/* the next look decides */}
    }
    return null;
  }

  // Standalone text rewrite only. Never call this inside a multi-step tool operation.
  function incompleteSettlementMessage(receipt) {
    return `本次已扣 ${receipt.charged} 积分，另有 ${receipt.uncollected} 积分未结算。`;
  }
  async function selectedQwenStyleAnalysis(payload,selected,controller) {
    const no=(errorCode,error)=>({ok:false,errorCode,error});
    const keys=['requestId','name','purpose','dataUrl','supplement','assistantSelectionScope','assistantProvider','assistantModelId','assistantSelectionEpoch','signal','confirmNodeUpload','isInputCurrent'];
    if(Object.keys(payload).some(k=>!keys.includes(k))||payload.assistantSelectionScope!=='xiaotao'||payload.assistantProvider!==selected.provider||payload.assistantModelId!==selected.modelId||payload.assistantSelectionEpoch!==selected.epoch||typeof payload.isInputCurrent!=='function'||typeof controller?.subscribeBusinessModel!=='function')
      return no('style-analysis-unavailable','模型或素材状态检查不可用，未提交。');
    const id=payload.requestId,kind=payload.purpose||'style',hasImage=kind!=='aifx-supplement';
    if(!NODE_ID.test(String(id||''))||!['style','aifx-material','aifx-supplement'].includes(kind))return no('invalid-request','风格分析请求无效，未提交。');
    if(hasImage&&(typeof payload.confirmNodeUpload!=='function'||typeof payload.name!=='string'||payload.name.length>120||typeof payload.dataUrl!=='string'||payload.dataUrl.length>Math.ceil(20*1024*1024/3)*4+128||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.dataUrl)||payload.supplement!==undefined))
      return no('style-reference-invalid','请选择一张有效的参考图并确认发送，未提交。');
    if(!hasImage&&(payload.dataUrl!==undefined||payload.name!==undefined||typeof payload.supplement!=='string'||!payload.supplement.trim()||payload.supplement.length>20000))return no('invalid-request','补充说明无效，未提交。');
    const request={mode:'style-analysis',kind,assistantProvider:'local',assistantModelId:selected.modelId,requestId:id,...(hasImage?{image:{role:kind==='style'?'style':'material',name:payload.name,dataUrl:payload.dataUrl}}:{supplement:Array.from(payload.supplement.replace(/\s+/g,' ').trim()).slice(0,400).join('')})};
    const nodeId=computeNode?.id||'',nodeEpoch=computeNodeEpoch,sessionGuard=captureFoartSessionGuard();
    if(taskMode()!=='shared'||!NODE_ID.test(nodeId)||!sessionGuard||!sessionGuard())return no('style-node-required','请选择当前账号自己的在线节点并登录，未提交。');
    let cancelled=false,cancelPromise=null,timer=null;
    const current=()=>{try{const x=controller.businessModelSnapshot();return !cancelled&&!payload.signal?.aborted&&sessionGuard()&&payload.isInputCurrent()===true&&root.NovaFlowXiaotaoArtAgent?.panel?.controller===controller&&x?.provider===selected.provider&&x?.modelId===selected.modelId&&x?.epoch===selected.epoch&&computeNodeEpoch===nodeEpoch&&computeNode?.id===nodeId;}catch{return false;}};
    const onChange=()=>{cancelled=true;if(!cancelPromise)cancelPromise=cancelPromptAssistantRequest({requestId:id});};
    const unsubscribe=controller.subscribeBusinessModel(onChange);if(typeof unsubscribe!=='function')return no('style-analysis-unavailable','模型状态不可核验，未提交。');
    root.addEventListener('novaflow:compute-node',onChange);foartSessionObservers.add(onChange);payload.signal?.addEventListener?.('abort',onChange,{once:true});
    timer=root.setTimeout(onChange,Math.min(2147483647,Math.max(1,sessionGuard.expiresAtMs-Date.now())));
    try {
      const ownNode=async()=>{const response=await control('GET','/api/web/nodes');if(!current())return null;const nodes=(response?.nodes||[]).filter(n=>n?.id===nodeId&&n.is_owner===true&&n.can_use===true&&n.online===true);return nodes.length===1?nodes[0]:null;};
      const node=await ownNode();if(!node)return no('style-node-unavailable','所选节点不是当前账号可用的自有节点，未提交。');
      const caps=await control('GET','/api/web/capabilities');if(!current()||caps?.features?.qwen35StyleAnalysisKinds?.[kind]!==true||caps?.features?.qwen35StyleOwnerLeaseBound!==true)return no('style-analysis-unavailable','当前节点尚不支持此类 Qwen 风格分析，未提交。');
      if(hasImage){const name=String(node.name||'未命名节点').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80);
        if(await payload.confirmNodeUpload({nodeName:name,nodeIdSuffix:nodeId.slice(-8),count:1,retentionHours:24,retentionGuarantee:false,storage:'owned-node-task-directory'})!==true||!current())return no('style-upload-declined','已取消参考图发送，未提交。');
        const confirmed=await ownNode();if(!confirmed||String(confirmed.name||'未命名节点').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80)!==name||!current())return no('style-node-changed','节点状态已变化，请重新确认，未提交。');}
      const result=await pooledPromptAssistant('describe-art-style',request,{isCurrent:current});
      if(!current())return no('style-selection-changed','模型、节点或素材已变化，结果未显示。');
      if(result?.ok!==true||result.modelIdentity?.id!=='qwen35-heretic'||result.modelIdentity?.verification!=='server-weight-path'||result.resourcesReleased!==true)
        return no('style-analysis-incomplete',result?.error||'风格分析未完成，未应用结果。');
      if(kind==='style'&&(typeof result.style!=='string'||!result.style.trim()))return no('style-analysis-incomplete','风格分析结果不完整。');
      if(kind==='aifx-material'&&(!result.material||typeof result.material!=='object'))return no('style-analysis-incomplete','材质分析结果不完整。');
      if(kind==='aifx-supplement'&&(typeof result.supplement!=='string'||!result.supplement.trim()))return no('style-analysis-incomplete','补充说明结果不完整。');
      return {...result,free:true};
    }catch(error){return no('style-analysis-failed',String(error?.message||error));}
    finally{if(timer!==null)root.clearTimeout(timer);unsubscribe();root.removeEventListener('novaflow:compute-node',onChange);foartSessionObservers.delete(onChange);payload.signal?.removeEventListener?.('abort',onChange);}
  }
  async function selectedQwenUiDraft(payload,selected,controller) {
    const no=(errorCode,error)=>({ok:false,errorCode,error});
    const keys=['request','assistantSelectionScope','assistantProvider','assistantModelId','assistantSelectionEpoch','signal','confirmNodeUpload','isInputCurrent'];
    if(Object.keys(payload).some(k=>!keys.includes(k))||payload.assistantSelectionScope!=='xiaotao'||
      payload.assistantProvider!==selected.provider||payload.assistantModelId!==selected.modelId||payload.assistantSelectionEpoch!==selected.epoch||
      typeof payload.confirmNodeUpload!=='function'||typeof payload.isInputCurrent!=='function'||typeof controller?.subscribeBusinessModel!=='function')
      return no('ui-draft-unavailable','节点确认或状态检查不可用，未提交。');
    let request;try{request=structuredClone(payload.request);}catch{return no('invalid-request','UI 草稿输入无效，未提交。');}
    const refs=request?.references,id=request?.requestId;
    if(!NODE_ID.test(String(id||''))||!Array.isArray(refs)||refs.length<1||refs.length>3||
      !refs.every(x=>x&&typeof x.dataUrl==='string')||refs.reduce((n,x)=>n+x.dataUrl.length,0)>Math.ceil(20*1024*1024/3)*4+256)
      return no('ui-reference-limit','UI 草稿最多 3 张参考图、合计 20 MiB，未提交。');
    const nodeId=computeNode?.id||'',nodeEpoch=computeNodeEpoch,sessionGuard=captureFoartSessionGuard();
    if(taskMode()!=='shared'||!NODE_ID.test(nodeId)||!sessionGuard||!sessionGuard())
      return no('ui-node-required','请选择当前账号自己的算力节点并登录，未提交。');
    let cancelled=false,cancelPromise=null,timer=null;
    const current=()=>{try{const x=controller.businessModelSnapshot();return !cancelled&&!payload.signal?.aborted&&sessionGuard()&&payload.isInputCurrent()===true&&
      root.NovaFlowXiaotaoArtAgent?.panel?.controller===controller&&x?.provider===selected.provider&&x?.modelId===selected.modelId&&x?.epoch===selected.epoch&&
      computeNodeEpoch===nodeEpoch&&computeNode?.id===nodeId;}catch{return false;}};
    const onChange=()=>{cancelled=true;if(!cancelPromise)cancelPromise=cancelPromptAssistantRequest({requestId:id});};
    const unsubscribe=controller.subscribeBusinessModel(onChange);
    if(typeof unsubscribe!=='function')return no('ui-draft-unavailable','模型状态不可核验，未提交。');
    root.addEventListener('novaflow:compute-node',onChange);foartSessionObservers.add(onChange);
    payload.signal?.addEventListener?.('abort',onChange,{once:true});
    timer=root.setTimeout(onChange,Math.min(2147483647,Math.max(1,sessionGuard.expiresAtMs-Date.now())));
    try{
      const ownNode=async()=>{const response=await control('GET','/api/web/nodes');if(!current())return null;
        const nodes=(response?.nodes||[]).filter(n=>n?.id===nodeId&&n.is_owner===true&&n.can_use===true&&n.online===true);
        return nodes.length===1?nodes[0]:null;};
      const node=await ownNode();if(!node)return no('ui-node-unavailable','所选节点不是当前账号可用的自有节点，未提交。');
      const caps=await control('GET','/api/web/capabilities');
      if(!current()||caps?.features?.qwen35UiDraft!==true||caps?.features?.qwen35UiOwnerLeaseBound!==true)return no('ui-draft-unavailable','该自有节点尚未支持 Qwen UI 草稿，未提交。');
      const name=String(node.name||'未命名节点').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80);
      if(await payload.confirmNodeUpload({nodeName:name,nodeIdSuffix:nodeId.slice(-8),count:refs.length})!==true||!current())
        return no('ui-upload-declined','已取消参考图发送，未提交。');
      const confirmed=await ownNode();
      if(!confirmed||String(confirmed.name||'未命名节点').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80)!==name||!current())
        return no('ui-node-changed','节点状态已变化，请重新确认，未提交。');
      const result=await pooledPromptAssistant('reverse-image-prompt',{mode:'ui-draft',epoch:selected.epoch,request,requestId:id},{isCurrent:current});
      if(!current())return no('ui-selection-changed','模型、节点或 UI 已变化，未采用结果。');
      if(result?.ok!==true||result.draft?.status!=='preview-only'||result.draft?.applyAvailable!==false)
        return no('ui-draft-incomplete',result?.error||'UI 草稿未完成，未应用。');
      return {ok:true,draft:result.draft,modelIdentity:{id:selected.modelId},free:true};
    }catch(error){return no('ui-draft-failed',String(error?.message||error));}
    finally{if(timer!==null)root.clearTimeout(timer);unsubscribe();root.removeEventListener('novaflow:compute-node',onChange);
      foartSessionObservers.delete(onChange);payload.signal?.removeEventListener?.('abort',onChange);}
  }
  async function selectedOnlineVideoDraft(payload,selected,controller) {
    let submitted=false,settled=false;
    const no=(errorCode,error,extra={})=>({ok:false,errorCode,error,providerSubmitted:submitted,...(submitted&&!settled?{billingUnknown:true}:{}),...extra});
    const keys=['request','assistantSelectionScope','assistantProvider','assistantModelId','assistantSelectionEpoch','signal','onPricingQuote','confirmPricingQuote','onBillingNotice','confirmImageUpload','isInputCurrent'];
    if(Object.keys(payload).some(k=>!keys.includes(k))||payload.assistantSelectionScope!=='xiaotao'||payload.assistantProvider!==selected.provider||payload.assistantModelId!==selected.modelId||payload.assistantSelectionEpoch!==selected.epoch||
       typeof payload.onPricingQuote!=='function'||typeof payload.confirmPricingQuote!=='function'||typeof payload.onBillingNotice!=='function'||typeof payload.isInputCurrent!=='function'||typeof controller?.subscribeBusinessModel!=='function')
      return no('video-draft-unavailable','视频草稿确认或状态检查不可用，未提交。');
    let intent;try{intent=structuredClone(payload.request);}catch{return no('invalid-request','视频草稿输入无效，未提交。');}
    const id=intent?.requestId,fields=['mode','requestId','h3Mode','durationSeconds','prompt','requirements','references','images'];
    if(!intent||typeof intent!=='object'||Array.isArray(intent)||Object.keys(intent).some(k=>!fields.includes(k))||intent.mode!=='video-rewrite'||!validOperationId(id)||
      !['text_video','image_video','first_last','multi_reference'].includes(intent.h3Mode)||typeof intent.durationSeconds!=='number'||!Number.isFinite(intent.durationSeconds)||intent.durationSeconds<1||intent.durationSeconds>30||
      typeof intent.prompt!=='string'||!intent.prompt.trim()||intent.prompt.length>1500||(intent.requirements!==undefined&&(typeof intent.requirements!=='string'||intent.requirements.length>1000))||
      /data:(?:image|audio|video)\//i.test(intent.prompt+' '+(intent.requirements||''))||!Array.isArray(intent.references)||intent.references.length>15||
      !intent.references.every(ref=>ref&&typeof ref==='object'&&!Array.isArray(ref)&&Object.keys(ref).every(k=>['key','kind','sourceId'].includes(k))&&typeof ref.key==='string'&&ref.key.length>0&&ref.key.length<=80&&['image','video','audio'].includes(ref.kind)&&typeof ref.sourceId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(ref.sourceId)))
      return no('invalid-request','视频文字草稿输入无效，未提交。');
    const hasImages=Object.hasOwn(intent,'images');
    const frames=intent.h3Mode==='first_last'?['first_frame','last_frame']:intent.h3Mode==='image_video'?['first_frame']:null;
    if(hasImages&&(XIAOTAO_H3_VISION_RELEASE_ENABLED!==true||!frames||typeof payload.confirmImageUpload!=='function'||
      !Array.isArray(intent.images)||intent.images.length!==frames.length||intent.images.some((image,index)=>!image||typeof image!=='object'||Array.isArray(image)||
        Object.keys(image).some(key=>!['key','dataUrl'].includes(key))||image.key!==frames[index]||typeof image.dataUrl!=='string'||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))||
      intent.images.reduce((total,image)=>total+image.dataUrl.length,0)>Math.ceil(20*1024*1024/3)*4+256))
      return no('video-vision-unavailable','首尾帧图片分析尚未开通或素材无效，未上传或扣费。');
    if(!onlineOperationModel(selected.modelId)||companionCloudRequests.size||companionCloudUsed.has(id)||companionCloudUsed.size>=1024)
      return no('assistant-business-unavailable','所选模型或请求不可用，未提交。');
    if(hasImages)for(const image of intent.images)image.dataUrl=await onlineVisionImage(image.dataUrl,intent.images.length);
    const imageStamp=hasImages?JSON.stringify(intent.images):'';
    const owner=captureFoartBillingOwner(),guard=captureFoartSessionGuard();
    if(!owner||!guard||!owner.current()||!guard())return no('assistant-session-unavailable','登录状态不可用，未提交。');
    const abort=new AbortController();let cancelled=false;
    const current=()=>{try{const x=controller.businessModelSnapshot();return (!hasImages||JSON.stringify(intent.images)===imageStamp)&&!cancelled&&!abort.signal.aborted&&!payload.signal?.aborted&&owner.current()&&guard()&&payload.isInputCurrent()===true&&root.NovaFlowXiaotaoArtAgent?.panel?.controller===controller&&x?.provider===selected.provider&&x?.modelId===selected.modelId&&x?.epoch===selected.epoch;}catch{return false;}};
    const onChange=()=>{cancelled=true;abort.abort();};
    const unsubscribe=controller.subscribeBusinessModel(onChange);if(typeof unsubscribe!=='function')return no('assistant-selection-unavailable','模型状态不可用，未提交。');
    foartSessionObservers.add(onChange);payload.signal?.addEventListener?.('abort',onChange,{once:true});
    let timer;const expiry=setTimeout(onChange,Math.min(2147483647,Math.max(1,guard.expiresAtMs-Date.now())));
    companionCloudRequests.set(id,abort);
    try {
      if(!current())return no('assistant-selection-changed','模型、会话或视频内容已变化，未提交。');
      const pricing=await companionPricing(),policy=pricing?.policy,terms=policy?.config?.xiaotao_online;
      if(!current()||pricing?.ok!==true||!/^sha256:[a-f0-9]{64}$/.test(policy?.version||'')||!Number.isFinite(policy.expiresAt)||Date.now()>=policy.expiresAt||
        terms?.operation_video_rewrite_v3!==true||!operationCreditPolicy(terms)||
        !Array.isArray(policy.models)||!policy.models.some(m=>m.id===selected.modelId&&m.available===true))
        return no('video-draft-unavailable','所选模型的视频文字草稿未开通或价格不可用，未提交。');
      if(hasImages&&(terms.operation_vision_chat_v3!==true||!onlineOperationModel(selected.modelId)))
        return no('video-vision-unavailable','所选模型尚未开通首尾帧图片分析，未上传或扣费。');
      // prepare already transmits the signed image intent to the server, so
      // explicit user upload consent must occur before that first request.
      if(hasImages&&(await payload.confirmImageUpload({count:frames.length,images:intent.images,roles:frames})!==true||!current()))
        return no('assistant-business-upload-declined','已取消首尾帧上传，未提交或扣费。');
      if(Date.now()>=policy.expiresAt)return no('companion-pricing-changed','在线价格已过期，请重新发送；本次未上传或扣费。');
      timer=setTimeout(onChange,180000);
      const base=CONFIG.companionUrl||CONFIG.authUrl.replace(/\/novaflow-backend\/?$/,'/novaflow-companion');
      const prepared=await api(base,'POST','/api/web/companion/operation/prepare',{nonce:root.crypto.randomUUID(),model:selected.modelId,intent},65000,abort.signal),op=prepared?.operation;
      if(!current()||prepared?.ok!==true||op?.model!==selected.modelId||op?.policyVersion!==policy.version||!validOperationId(op?.operationId)||typeof op?.token!=='string'||op.token.length>4096||
        !/^[a-f0-9]{64}$/.test(op.intentHash||'')||!validOperationQuote(op.estimatedCredits,terms)||![1200,3000].includes(op.outputTokens)||Date.now()>=policy.expiresAt)
        return no('companion-pricing-changed','报价或视频内容已变化，未执行。');
      const quote={requestId:id,estimatedCredits:op.estimatedCredits,outputTokens:op.outputTokens};payload.onPricingQuote(quote);
      if(!current()||await payload.confirmPricingQuote(quote)!==true||!current()||Date.now()>=policy.expiresAt)return no('assistant-business-quote-declined','已取消报价或内容已变化，未执行。');
      if(!current())return no('assistant-selection-changed','请求状态已变化，未执行。');
      submitted=true;companionCloudUsed.add(id);
      const result=await api(base,'POST','/api/web/companion/operation/execute',{operationToken:op.token,intent},180000,abort.signal),receipt=result?.receipt;
      if(!owner.current()||!guard())return no('assistant-session-unavailable','会话已变化，本次结果未显示。');
      if(!validOperationReceipt(receipt,terms))
        return no('operation-status-unknown',ONLINE_RESULT_UNCONFIRMED);
      const quota={status:'settled',settled_credits:receipt.charged,quote_estimated_credits:op.estimatedCredits,...(receipt.uncollected>0?{uncollected_credits:receipt.uncollected}:{})};
      if(receipt.uncollected===0)settled=true;notifyAccountBalance(undefined,'companion-operation');
      let noted=false;try{noted=payload.onBillingNotice({requestId:id,modelId:selected.modelId,submitted:true,quota,unknown:receipt.uncollected>0})===true;}catch{}
      if(!noted)return no('billing-record-unavailable',receipt.uncollected>0?incompleteSettlementMessage(receipt):'已结算，但这次的账单提示没有更新。',{quota});
      if(!current())return no('assistant-selection-changed','模型或视频内容已变化，草稿未显示。',{quota});
      const draft=result?.videoDraft;
      if(result.ok!==true||result.model!==selected.modelId||receipt.outcome!=='success'||receipt.uncollected>0||!draft||draft.textOnly!==!hasImages||draft.h3Mode!==intent.h3Mode||draft.durationSeconds!==intent.durationSeconds||
        typeof draft.displayPrompt!=='string'||!draft.displayPrompt.trim()||draft.displayPrompt.length>12000||typeof draft.modelPrompt!=='string'||!draft.modelPrompt.trim()||draft.modelPrompt.length>12000) {
        // Only translate known server codes after the receipt and account guard
        // were verified; never show untrusted server text or retry a paid call.
        let message='视频草稿未通过校验，未回填或生成；已产生的费用按回执结算。';
        if(receipt.uncollected>0)message=incompleteSettlementMessage(receipt);
        else if(result.ok===false&&result.errorCode==='operation-video-draft-invalid'&&receipt.outcome==='cancel')message='模型已返回，但视频草稿未通过内容或格式校验；已产生的费用按回执结算，未回填或生成。';
        else if(result.ok===false&&result.errorCode==='operation-provider-output-invalid'&&receipt.outcome==='cancel')message='模型没有返回可用的视频草稿；已产生的费用按回执结算，未回填或生成。';
        else if(result.ok===false&&result.errorCode==='operation-cancelled-after-dispatch'&&receipt.outcome==='cancel')message='请求提交后被取消，草稿未应用；已产生的费用按回执结算。';
        return no('video-draft-incomplete',message,{quota,draftIssue:String(result?.draftIssue||'').slice(0,200)});
      }
      return {ok:true,draft:{displayPrompt:draft.displayPrompt,modelPrompt:draft.modelPrompt,h3Mode:draft.h3Mode,durationSeconds:draft.durationSeconds,textOnly:!hasImages,status:'preview-only',applyAvailable:false},modelIdentity:{id:selected.modelId},quota};
    }catch{return no('operation-unknown',submitted?ONLINE_RESULT_UNCONFIRMED:'请求未执行，请稍后重试。');}
    finally {clearTimeout(timer);clearTimeout(expiry);unsubscribe();foartSessionObservers.delete(onChange);payload.signal?.removeEventListener?.('abort',onChange);companionCloudRequests.delete(id);}
  }

  async function selectedOnlineUiDraft(payload,selected,controller) {
    let submitted=false,settled=false;
    const no=(errorCode,error,extra={})=>({ok:false,errorCode,error,providerSubmitted:submitted,...(submitted&&!settled?{billingUnknown:true}:{}),...extra});
    const keys=['request','assistantSelectionScope','assistantProvider','assistantModelId','assistantSelectionEpoch','signal','onPricingQuote','confirmPricingQuote','onBillingNotice','confirmImageUpload','isInputCurrent'];
    if(Object.keys(payload).some(k=>!keys.includes(k))||payload.assistantSelectionScope!=='xiaotao'||payload.assistantProvider!==selected.provider||payload.assistantModelId!==selected.modelId||payload.assistantSelectionEpoch!==selected.epoch||
       typeof payload.onPricingQuote!=='function'||typeof payload.confirmPricingQuote!=='function'||typeof payload.onBillingNotice!=='function'||typeof payload.isInputCurrent!=='function'||typeof controller?.subscribeBusinessModel!=='function')
      return no('ui-draft-unavailable','UI 草稿确认或状态检查不可用，未提交。');
    let request;try {request=structuredClone(payload.request);}catch{return no('invalid-request','UI 草稿输入无效，未提交。');}
    const id=request?.requestId,refs=request?.references;
    if(!validOperationId(id)||!Array.isArray(refs)||refs.length>3||!refs.every(x=>x&&typeof x.dataUrl==='string')||(refs.length&&typeof payload.confirmImageUpload!=='function')||
       refs.reduce((sum,x)=>sum+x.dataUrl.length,0)>Math.ceil(20*1024*1024/3)*4+256)
      return no('ui-reference-limit','UI 草稿最多 3 张参考图、合计 20 MiB，未提交。');
    if(!onlineOperationModel(selected.modelId)||companionCloudRequests.size||companionCloudUsed.has(id)||companionCloudUsed.size>=1024)
      return no('assistant-business-unavailable','所选模型或请求不可用，未提交。');
    for(const ref of refs)ref.dataUrl=await onlineVisionImage(ref.dataUrl,refs.length);
    const referencesStamp=JSON.stringify(refs);
    const owner=captureFoartBillingOwner(),guard=captureFoartSessionGuard();
    if(!owner||!guard||!owner.current()||!guard())return no('assistant-session-unavailable','登录状态不可用，未提交。');
    const abort=new AbortController();let cancelled=false;
    const current=()=>{try{const x=controller.businessModelSnapshot();return JSON.stringify(refs)===referencesStamp&&!cancelled&&!abort.signal.aborted&&!payload.signal?.aborted&&owner.current()&&guard()&&payload.isInputCurrent()===true&&root.NovaFlowXiaotaoArtAgent?.panel?.controller===controller&&x?.provider===selected.provider&&x?.modelId===selected.modelId&&x?.epoch===selected.epoch;}catch{return false;}};
    const onChange=()=>{cancelled=true;abort.abort();};
    const unsubscribe=controller.subscribeBusinessModel(onChange);if(typeof unsubscribe!=='function')return no('assistant-selection-unavailable','模型状态不可用，未提交。');
    foartSessionObservers.add(onChange);payload.signal?.addEventListener?.('abort',onChange,{once:true});
    const timer=setTimeout(onChange,180000),expiry=setTimeout(onChange,Math.min(2147483647,Math.max(1,guard.expiresAtMs-Date.now())));
    companionCloudRequests.set(id,abort);
    try {
      if(!current())return no('assistant-selection-changed','模型、会话或 UI 已变化，未提交。');
      const pricing=await companionPricing(),policy=pricing?.policy,terms=policy?.config?.xiaotao_online;
      if(!current()||pricing?.ok!==true||!/^sha256:[a-f0-9]{64}$/.test(policy?.version||'')||!Number.isFinite(policy.expiresAt)||Date.now()>=policy.expiresAt||
        terms?.operation_ui_draft_v3!==true||(refs.length>0&&terms?.operation_vision_chat_v3!==true)||!operationCreditPolicy(terms)||
        !Array.isArray(policy.models)||!policy.models.some(m=>m.id===selected.modelId&&m.available===true))return no('ui-draft-unavailable','所选模型的 UI 草稿未开通或价格不可用，未提交。');
      if(refs.length&&(await payload.confirmImageUpload({count:refs.length,images:refs})!==true||!current()))return no('assistant-business-upload-declined','已取消参考图上传，未提交。');
      const intent={mode:'ui-draft',epoch:selected.epoch,request};
      const base=CONFIG.companionUrl||CONFIG.authUrl.replace(/\/novaflow-backend\/?$/,'/novaflow-companion');
      const prepared=await api(base,'POST','/api/web/companion/operation/prepare',{nonce:root.crypto.randomUUID(),model:selected.modelId,intent},65000,abort.signal),op=prepared?.operation;
      if(!current()||prepared?.ok!==true||op?.model!==selected.modelId||op?.policyVersion!==policy.version||!validOperationId(op?.operationId)||typeof op?.token!=='string'||op.token.length>4096||
        !/^[a-f0-9]{64}$/.test(op.intentHash||'')||!validOperationQuote(op.estimatedCredits,terms)||op.outputTokens!==2048||Date.now()>=policy.expiresAt)
        return no('companion-pricing-changed','报价或上下文已变化，未执行。');
      const quote={requestId:id,estimatedCredits:op.estimatedCredits,outputTokens:op.outputTokens};payload.onPricingQuote(quote);
      if(!current()||await payload.confirmPricingQuote(quote)!==true||!current()||Date.now()>=policy.expiresAt)return no('assistant-business-quote-declined','已取消报价或上下文已变化，未执行。');
      if(!current())return no('assistant-selection-changed','上下文已变化，未执行。');
      submitted=true;companionCloudUsed.add(id);
      const result=await api(base,'POST','/api/web/companion/operation/execute',{operationToken:op.token,intent},180000,abort.signal),receipt=result?.receipt;
      if(!owner.current()||!guard())return no('assistant-session-unavailable','会话已变化，本次结果未显示。');
      if(!validOperationReceipt(receipt,terms))
        return no('operation-status-unknown',ONLINE_RESULT_UNCONFIRMED);
      const quota={status:'settled',settled_credits:receipt.charged,quote_estimated_credits:op.estimatedCredits,...(receipt.uncollected>0?{uncollected_credits:receipt.uncollected}:{})};
      if(receipt.uncollected===0)settled=true;notifyAccountBalance(undefined,'companion-operation');
      let noted=false;try{noted=payload.onBillingNotice({requestId:id,modelId:selected.modelId,submitted:true,quota,unknown:receipt.uncollected>0})===true;}catch{}
      if(!noted)return no('billing-record-unavailable',receipt.uncollected>0?incompleteSettlementMessage(receipt):'已结算，但这次的账单提示没有更新。',{quota});
      if(!current())return no('assistant-selection-changed','模型或 UI 已变化，草稿未显示。',{quota});
      if(result.ok!==true||result.model!==selected.modelId||receipt.outcome!=='success'||receipt.uncollected>0||result.uiDraft?.status!=='preview-only'||result.uiDraft?.applyAvailable!==false)
        return no('ui-draft-incomplete',receipt.uncollected>0?incompleteSettlementMessage(receipt):'草稿未完成。',{quota});
      return {ok:true,draft:result.uiDraft,modelIdentity:{id:selected.modelId},quota};
    } catch {return no('operation-unknown',submitted?ONLINE_RESULT_UNCONFIRMED:'请求未执行，请稍后再试。');}
    finally {clearTimeout(timer);clearTimeout(expiry);unsubscribe();foartSessionObservers.delete(onChange);payload.signal?.removeEventListener?.('abort',onChange);companionCloudRequests.delete(id);}
  }

  async function prepareOnlineStyleImage(dataUrl,{maxSide=768,type='image/png'}={}) {
    return await new Promise((resolve,reject)=>{
      const img=new root.Image();
      img.onerror=()=>reject(new Error('image-decode-failed'));
      img.onload=()=>{try{
        const width=img.naturalWidth||img.width,height=img.naturalHeight||img.height;
        if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>40000000)throw Error('image-size-invalid');
        const scale=Math.min(1,maxSide/Math.max(width,height)),canvas=root.document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
        const context=canvas.getContext('2d');if(!context)throw Error('image-canvas-unavailable');
        if(type==='image/jpeg'){context.fillStyle='#808080';context.fillRect(0,0,canvas.width,canvas.height);}
        context.drawImage(img,0,0,canvas.width,canvas.height);
        const result=canvas.toDataURL(type,.85);if(!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(result))throw Error('image-encode-failed');
        resolve(result);
      }catch(error){reject(error);}};
      img.src=dataUrl;
    });
  }
  async function selectedOnlineStyleAnalysis(payload,selected,controller) {
    let submitted=false,settled=false;
    const no=(errorCode,error,extra={})=>({ok:false,errorCode,error,providerSubmitted:submitted,...(submitted&&!settled?{billingUnknown:true}:{}),...extra});
    const keys=['requestId','name','purpose','dataUrl','supplement','assistantSelectionScope','assistantProvider','assistantModelId','assistantSelectionEpoch','signal','onPricingQuote','confirmPricingQuote','onBillingNotice','confirmImageUpload','isInputCurrent'];
    const scope=payload.assistantSelectionScope,selectionOwner=()=>scope==='aifx-material'?root.FoartAifxMaterialModel:root.NovaFlowXiaotaoArtAgent?.panel?.controller;
    if(Object.keys(payload).some(k=>!keys.includes(k))||!(scope==='xiaotao'||(scope==='aifx-material'&&payload.purpose==='aifx-material'))||payload.assistantProvider!==selected.provider||payload.assistantModelId!==selected.modelId||payload.assistantSelectionEpoch!==selected.epoch||
       typeof payload.onPricingQuote!=='function'||typeof payload.confirmPricingQuote!=='function'||typeof payload.onBillingNotice!=='function'||typeof payload.isInputCurrent!=='function'||typeof controller?.subscribeBusinessModel!=='function')
      return no('style-analysis-unavailable','风格分析确认或状态检查不可用，未提交。');
    const id=payload.requestId,kind=payload.purpose||'style',hasImage=kind!=='aifx-supplement',combined=kind==='aifx-material-supplement';
    if(!validOperationId(id)||!['style','aifx-material','aifx-supplement','aifx-material-supplement'].includes(kind)||!onlineOperationModel(selected.modelId)||companionCloudRequests.size||companionCloudUsed.has(id)||companionCloudUsed.size>=1024)
      return no('invalid-request','风格分析请求或模型不可用，未提交。');
    if(hasImage&&(typeof payload.confirmImageUpload!=='function'||typeof payload.dataUrl!=='string'||payload.dataUrl.length>Math.ceil(20*1024*1024/3)*4+128||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.dataUrl)||typeof payload.name!=='string'||payload.name.length>120||(!combined&&payload.supplement!==undefined)))
      return no('style-reference-invalid','请选择一张有效的 PNG、JPEG 或 WebP 参考图，未提交。');
    if((!hasImage||combined)&&((!hasImage&&(payload.dataUrl!==undefined||payload.name!==undefined))||typeof payload.supplement!=='string'||!payload.supplement.trim()||payload.supplement.length>20000))
      return no('invalid-request','补充说明无效，未提交。');
    const intent={mode:'style-analysis',requestId:id,kind,...(hasImage?{images:[{role:kind==='style'?'style':'material',dataUrl:payload.dataUrl}]}:{}),...(!hasImage||combined?{supplement:Array.from(payload.supplement.replace(/\s+/g,' ').trim()).slice(0,400).join('')}:{})};
    const owner=captureFoartBillingOwner(),guard=captureFoartSessionGuard();
    if(!owner||!guard||!owner.current()||!guard())return no('assistant-session-unavailable','登录状态不可用，未提交。');
    const abort=new AbortController();let cancelled=false;
    const current=()=>{try{const x=controller.businessModelSnapshot();return !cancelled&&!abort.signal.aborted&&!payload.signal?.aborted&&owner.current()&&guard()&&payload.isInputCurrent()===true&&selectionOwner()===controller&&x?.provider===selected.provider&&x?.modelId===selected.modelId&&x?.epoch===selected.epoch;}catch{return false;}};
    const onChange=()=>{cancelled=true;abort.abort();};
    const unsubscribe=controller.subscribeBusinessModel(onChange);if(typeof unsubscribe!=='function')return no('assistant-selection-unavailable','模型状态不可用，未提交。');
    foartSessionObservers.add(onChange);payload.signal?.addEventListener?.('abort',onChange,{once:true});
    const timer=setTimeout(onChange,180000),expiry=setTimeout(onChange,Math.min(2147483647,Math.max(1,guard.expiresAtMs-Date.now())));
    companionCloudRequests.set(id,abort);
    try {
      if(!current())return no('assistant-selection-changed','模型、会话或素材已变化，未提交。');
      if(hasImage){try{intent.images[0].dataUrl=await prepareOnlineStyleImage(intent.images[0].dataUrl);}catch{return no('style-reference-invalid','参考图无法安全解码和缩放，未提交。');}if(!current())return no('assistant-selection-changed','模型、会话或素材已变化，未提交。');Object.freeze(intent.images[0]);Object.freeze(intent.images);}
      Object.freeze(intent);
      const pricing=await companionPricing(),policy=pricing?.policy,terms=policy?.config?.xiaotao_online;
      if(!current()||pricing?.ok!==true||!/^sha256:[a-f0-9]{64}$/.test(policy?.version||'')||!Number.isFinite(policy.expiresAt)||Date.now()>=policy.expiresAt||
         terms?.operation_style_v3!==true||!operationCreditPolicy(terms)||
         (hasImage&&(terms?.operation_vision_chat_v3!==true||!Array.isArray(terms?.operation_style_vision_models)||!terms.operation_style_vision_models.includes(selected.modelId)))||
         !Array.isArray(policy.models)||!policy.models.some(m=>m.id===selected.modelId&&m.available===true))
        return no('style-analysis-unavailable','所选模型的风格分析或图片能力尚未开通，未提交。');
      if(hasImage&&(await payload.confirmImageUpload({count:1,images:intent.images})!==true||!current()))return no('assistant-business-upload-declined','已取消参考图上传，未提交。');
      const base=CONFIG.companionUrl||CONFIG.authUrl.replace(/\/novaflow-backend\/?$/,'/novaflow-companion');
      const prepared=await api(base,'POST','/api/web/companion/operation/prepare',{nonce:root.crypto.randomUUID(),model:selected.modelId,intent},65000,abort.signal),op=prepared?.operation;
      if(!current()||prepared?.ok!==true||op?.model!==selected.modelId||op?.policyVersion!==policy.version||!validOperationId(op?.operationId)||typeof op?.token!=='string'||op.token.length>4096||
         !/^[a-f0-9]{64}$/.test(op.intentHash||'')||!validOperationQuote(op.estimatedCredits,terms)||op.outputTokens!==(combined?420:kind==='aifx-material'?300:120)||Date.now()>=policy.expiresAt)
        return no('companion-pricing-changed','报价或模型状态已变化，未执行。');
      const quote={requestId:id,estimatedCredits:op.estimatedCredits,outputTokens:op.outputTokens};payload.onPricingQuote(quote);
      if(!current()||await payload.confirmPricingQuote(quote)!==true||!current()||Date.now()>=policy.expiresAt)return no('assistant-business-quote-declined','已取消报价或状态已变化，未执行。');
      if(!current())return no('assistant-selection-changed','上下文已变化，未执行。');
      submitted=true;companionCloudUsed.add(id);
      const result=await api(base,'POST','/api/web/companion/operation/execute',{operationToken:op.token,intent},180000,abort.signal),receipt=result?.receipt;
      if(!owner.current()||!guard())return no('assistant-session-unavailable','会话已变化，本次结果未显示。');
      if(!validOperationReceipt(receipt,terms))
        return no('operation-status-unknown',ONLINE_RESULT_UNCONFIRMED);
      const quota={status:'settled',settled_credits:receipt.charged,quote_estimated_credits:op.estimatedCredits,...(receipt.uncollected>0?{uncollected_credits:receipt.uncollected}:{})};
      if(receipt.uncollected===0)settled=true;notifyAccountBalance(undefined,'companion-operation');
      let noted=false;try{noted=payload.onBillingNotice({requestId:id,modelId:selected.modelId,submitted:true,quota,unknown:receipt.uncollected>0})===true;}catch{}
      if(!noted)return no('billing-record-unavailable',receipt.uncollected>0?incompleteSettlementMessage(receipt):'已结算，但这次的账单提示没有更新。',{quota});
      if(!current())return no('assistant-selection-changed','模型或素材已变化，结果未显示。',{quota});
      if(result.ok!==true||result.model!==selected.modelId||receipt.outcome!=='success'||receipt.uncollected>0)
        return no('style-analysis-incomplete',receipt.uncollected>0?incompleteSettlementMessage(receipt):'分析未完成。',{quota});
      const value=result.styleResult,only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k)),text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
      if(kind==='style'&&only(value,['style','rawStyle'])&&text(value.style,400)&&typeof value.rawStyle==='string')return {ok:true,style:value.style,rawStyle:value.rawStyle,model:selected.modelId,quota};
      if(kind==='aifx-supplement'&&only(value,['supplement'])&&text(value.supplement,600))return {ok:true,supplement:value.supplement,model:selected.modelId,quota};
      if(combined&&only(value,['material','rawMaterial','supplement'])&&text(value.supplement,600)&&typeof value.rawMaterial==='string'&&only(value.material,['name','material','elements','colours','breakup'])&&['name','material','elements','colours','breakup'].every(k=>typeof value.material[k]==='string'&&value.material[k].length<=1000)&&(value.material.material.trim()||value.material.elements.trim()))return {ok:true,material:value.material,rawMaterial:value.rawMaterial,supplement:value.supplement,model:selected.modelId,quota};
      if(kind==='aifx-material'&&only(value,['material','rawMaterial'])&&typeof value.rawMaterial==='string'&&only(value.material,['name','material','elements','colours','breakup'])&&['name','material','elements','colours','breakup'].every(k=>typeof value.material[k]==='string'&&value.material[k].length<=1000)&&(value.material.material.trim()||value.material.elements.trim()))return {ok:true,material:value.material,rawMaterial:value.rawMaterial,model:selected.modelId,quota};
      return no('style-analysis-incomplete','分析结果不符合所需格式。',{quota});
    }catch{return no('operation-unknown',submitted?ONLINE_RESULT_UNCONFIRMED:'请求未执行，请稍后重试。');}
    finally {clearTimeout(timer);clearTimeout(expiry);unsubscribe();foartSessionObservers.delete(onChange);payload.signal?.removeEventListener?.('abort',onChange);companionCloudRequests.delete(id);}
  }
  async function selectedOnlineAudioRewrite(payload,selected,controller) {
    let submitted=false, finalReceipt=false;
    const no=(errorCode,error,extra={})=>({ok:false,errorCode,error,providerSubmitted:submitted,...(submitted&&!finalReceipt?{billingUnknown:true}:{}),...extra});
    const allowed=['requestId','kind','input','seconds','bpm','requirements','assistantSelectionScope','assistantProvider','assistantModelId','assistantSelectionEpoch','signal','onPricingQuote','confirmPricingQuote','onBillingNotice','confirmImageUpload'];
    const id=payload.requestId;
    if(Object.keys(payload).some(k=>!allowed.includes(k))||!validOperationId(id)||!['music','sfx'].includes(payload.kind)||
      typeof payload.input!=='string'||!payload.input.trim()||payload.input.length>1500||/data:(?:image|audio|video)\//i.test(payload.input)||
      !Number.isSafeInteger(payload.seconds)||payload.seconds<(payload.kind==='music'?8:1)||payload.seconds>(payload.kind==='music'?300:30)||
      (payload.bpm!==undefined&&(payload.kind!=='music'||!Number.isSafeInteger(payload.bpm)||payload.bpm<40||payload.bpm>220))||
      (payload.requirements!==undefined&&(typeof payload.requirements!=='string'||payload.requirements.length>1000||/data:(?:image|audio|video)\//i.test(payload.requirements)))||
      payload.assistantProvider!==selected.provider||payload.assistantModelId!==selected.modelId||payload.assistantSelectionEpoch!==selected.epoch||
      typeof payload.onPricingQuote!=='function'||typeof payload.confirmPricingQuote!=='function'||typeof payload.onBillingNotice!=='function'||typeof controller?.subscribeBusinessModel!=='function')
      return no('invalid-request','音频文字改写请求无效，未提交。');
    if(!onlineOperationModel(selected.modelId)||companionCloudRequests.size||companionCloudUsed.has(id)||companionCloudUsed.size>=1024)
      return no('assistant-business-unavailable','所选模型或请求不可用，未提交。');
    const owner=captureFoartBillingOwner(),guard=captureFoartSessionGuard();
    if(!owner||!guard||!owner.current()||!guard())return no('assistant-session-unavailable','登录会话不可用，未提交。');
    const abort=new AbortController();let cancelled=false;
    const current=()=>{const x=controller.businessModelSnapshot();return !cancelled&&!abort.signal.aborted&&!payload.signal?.aborted&&owner.current()&&guard()&&root.NovaFlowXiaotaoArtAgent?.panel?.controller===controller&&x?.provider===selected.provider&&x?.modelId===selected.modelId&&x?.epoch===selected.epoch;};
    const onChange=()=>{cancelled=true;abort.abort();};
    const unsubscribe=controller.subscribeBusinessModel(onChange);if(typeof unsubscribe!=='function')return no('assistant-selection-unavailable','模型状态不可用，未提交。');foartSessionObservers.add(onChange);
    payload.signal?.addEventListener?.('abort',onChange,{once:true});
    const timer=setTimeout(onChange,180000),expiry=setTimeout(onChange,Math.min(2147483647,Math.max(1,guard.expiresAtMs-Date.now())));
    companionCloudRequests.set(id,abort);
    try {
      if(!current())return no('assistant-selection-changed','会话或模型已变，未提交。');
      const pricing=await companionPricing(),policy=pricing?.policy,terms=policy?.config?.xiaotao_online;
      const rates=selected.modelId==='xai/grok-4.7'?terms?.grok_4_7_rates:terms?.model_rates?.[selected.modelId];
      const rateValid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
      if(!current()||pricing?.ok!==true||!/^sha256:[a-f0-9]{64}$/.test(policy?.version||'')||!Number.isFinite(policy.expiresAt)||Date.now()>=policy.expiresAt||
        terms?.operation_audio_rewrite_v3!==true||!operationCreditPolicy(terms)||!Array.isArray(policy.models)||!policy.models.some(m=>m.id===selected.modelId&&m.available===true)||
        !rates||!rateValid(rates.input)||!rateValid(rates.output)||(selected.modelId==='xai/grok-4.7'?!rateValid(rates.cached_input):!rateValid(rates.cached))||
        (flatRateOnlineModel(selected.modelId)&&(rates.input<=0||rates.output<=0||terms.operation_text_chat_v3!==true)))
        return no('online-business-unavailable','所选模型的文字改写尚未开放或价格不可用，未提交。');
      const intent={mode:'audio-rewrite',requestId:id,kind:payload.kind,input:payload.input,seconds:payload.seconds,...(payload.bpm!==undefined?{bpm:payload.bpm}:{}),...(payload.requirements!==undefined?{requirements:payload.requirements}:{})};
      const base=CONFIG.companionUrl||CONFIG.authUrl.replace(/\/novaflow-backend\/?$/,'/novaflow-companion');
      const prepared=await api(base,'POST','/api/web/companion/operation/prepare',{nonce:root.crypto.randomUUID(),model:selected.modelId,intent},65000,abort.signal),op=prepared?.operation;
      if(!current()||prepared?.ok!==true||op?.model!==selected.modelId||op?.policyVersion!==policy.version||!validOperationId(op?.operationId)||typeof op?.token!=='string'||op.token.length>4096||
        !/^[a-f0-9]{64}$/.test(op.intentHash||'')||!validOperationQuote(op.estimatedCredits,terms)||op.outputTokens!==400||Date.now()>=policy.expiresAt)
        return no('companion-pricing-changed','报价已变化或不可用，未提交。');
      const quote={requestId:id,estimatedCredits:op.estimatedCredits,outputTokens:op.outputTokens};payload.onPricingQuote(quote);
      if(!current()||await payload.confirmPricingQuote(quote)!==true||!current()||Date.now()>=policy.expiresAt)return no('assistant-business-quote-declined','已取消或会话已变，未提交。');
      if(!current())return no('assistant-selection-changed','会话已变，未提交。');
      submitted=true;companionCloudUsed.add(id);
      const result=await api(base,'POST','/api/web/companion/operation/execute',{operationToken:op.token,intent},65000,abort.signal),receipt=result?.receipt;
      if(!current())return no('assistant-selection-changed','会话已变，本次结果未显示。');
      if(!validOperationReceipt(receipt,terms))
        return no('operation-status-unknown',ONLINE_RESULT_UNCONFIRMED);
      notifyAccountBalance(undefined,'companion-operation');
      const quota={status:'settled',settled_credits:receipt.charged,quote_estimated_credits:op.estimatedCredits,...(receipt.uncollected>0?{uncollected_credits:receipt.uncollected}:{})};
      if(receipt.uncollected===0)finalReceipt=true;
      let noted=false;try{noted=payload.onBillingNotice({requestId:id,modelId:selected.modelId,submitted:true,quota,unknown:receipt.uncollected>0})===true;}catch{}
      if(!noted)return no('billing-record-unavailable',receipt.uncollected>0?incompleteSettlementMessage(receipt):'已结算，但这次的账单提示没有更新。',{quota});
      if(!current())return no('assistant-selection-changed','模型或会话已变化，结果未应用。',{quota});
      if(result.ok!==true||receipt.outcome!=='success'||receipt.uncollected>0||result.model!==selected.modelId||typeof result.reply!=='string'||!result.reply.trim()||result.reply.length>4000)
        return no('operation-incomplete',receipt.uncollected>0?incompleteSettlementMessage(receipt):`本次改写未完成，实际扣 ${receipt.charged} 积分。`,{quota});
      return {ok:true,result:{prompt:result.reply,analysisBackend:'runninghub',modelIdentity:{id:selected.modelId},quota}};
    }catch(error){return no('operation-unknown',submitted?ONLINE_RESULT_UNCONFIRMED:'请求未提交，请稍后再试。');}
    finally {clearTimeout(timer);clearTimeout(expiry);unsubscribe();foartSessionObservers.delete(onChange);payload.signal?.removeEventListener?.('abort',onChange);companionCloudRequests.delete(id);}
  }

  // Online art is intentionally closed until billing and real-page acceptance.
  // The person picks the model. When its line answers nothing, a style redraw's one retry goes through this one.
  const STYLE_REDRAW_BACKUP_MODEL='deepseek/deepseek-v4.1-flash';
  // A style redraw cut off mid-call is sent once more by the tool layer; that send goes straight to the backup line.
  let styleLineInterruptedAt=0;
  async function selectedOnlineBusinessPrompt(action,payload,selected,controller) {
    const no=(errorCode,error)=>({ok:false,errorCode,error});
    const textOnly=payload.currentDrawingTextOnly===true && typeof XIAOTAO_ONLINE_TEXT_ART_RELEASE_ENABLED!=='undefined' && XIAOTAO_ONLINE_TEXT_ART_RELEASE_ENABLED===true;
    const visionOnly=payload.currentDrawingVisionOnly===true && XIAOTAO_ONLINE_VISION_ART_RELEASE_ENABLED===true;
    if(payload.currentDrawingTextOnly!==undefined && (payload.currentDrawingTextOnly!==true || !textOnly || payload.assistantSelectionScope!=='xiaotao' || payload.qwenPromptMode!=='txt2img' || !Array.isArray(payload.images) || payload.images.length!==0))
      return no('online-business-unavailable','当前仅支持纯文字生图提示词优化，未提交或扣费。');
    if(payload.currentDrawingVisionOnly!==undefined&&(payload.currentDrawingVisionOnly!==true||!visionOnly||payload.currentDrawingTextOnly!==undefined||payload.assistantSelectionScope!=='xiaotao'||!['txt2img','img2img'].includes(payload.qwenPromptMode)||!Array.isArray(payload.images)||payload.images.length<1||payload.images.length>3))return no('online-business-unavailable','当前图片提示词优化尚未开通，未上传或扣费。');
    if((typeof XIAOTAO_ONLINE_ART_RELEASE_ENABLED==='undefined'||!XIAOTAO_ONLINE_ART_RELEASE_ENABLED)&&!textOnly&&!visionOnly)return no('online-business-unavailable','\u5728\u7ebf\u7f8e\u5de5\u5c1a\u672a\u5f00\u901a\uff0c\u672a\u63d0\u4ea4\u6216\u6263\u8d39\u3002');
    if(!onlineOperationModel(selected.modelId) || action!=='optimize-prompt' || payload.surface!=='art')return no('assistant-business-model-unavailable','\u6240\u9009\u6a21\u578b\u5c1a\u672a\u63a5\u901a\u6b64\u4e1a\u52a1\uff0c\u672a\u5207\u6362\u6216\u6263\u8d39\u3002');
    if((payload.assistantProvider!==undefined&&payload.assistantProvider!==selected.provider)||(payload.assistantModelId!==undefined&&payload.assistantModelId!==selected.modelId))return no('assistant-selection-mismatch','\u6a21\u578b\u9009\u62e9\u5df2\u53d8\u5316\u3002');
    if(typeof payload.onPricingQuote!=='function'||typeof payload.confirmPricingQuote!=='function'||typeof payload.onBillingNotice!=='function'||typeof controller?.subscribeBusinessModel!=='function')return no('assistant-business-quote-unavailable','\u62a5\u4ef7\u6216\u6a21\u578b\u72b6\u6001\u4e0d\u53ef\u7528\uff0c\u672a\u63d0\u4ea4\u6216\u6263\u8d39\u3002');
    return selectedOnlineArtBusiness(payload,selected,controller);
  }

  async function selectedOnlineArtBusiness(payload,selected,controller) {
    let v3Submitted=false,v3FinalSettled=false,lastFailure=null,englishSubmitted=false,parentRequestId='';
    const no=(errorCode,error,extra={})=>(lastFailure={ok:false,errorCode,error,...(v3Submitted&&!v3FinalSettled?{billingUnknown:true}:{}),...extra});
    const gptImage=payload.targetEngine==='gpt-image-2.5';
    const nativeQwen=payload.targetEngine==='qwen-2.1'&&['qwen21-native-rewrite-v2','qwen21-native-rewrite-v3'].includes(payload.promptContract);
    const nativeEdit=nativeQwen&&payload.promptContract==='qwen21-native-rewrite-v3'&&payload.qwenPromptMode==='img2img';
    const allowed=['requestId','assistantSelectionScope','assistantProvider','assistantModelId','assistantSelectionEpoch','currentDrawingTextOnly','currentDrawingVisionOnly',
      'onPricingQuote','confirmPricingQuote','onBillingNotice','confirmImageUpload','isImageInputCurrent','images','signal','surface','purpose','prompt','currentPrompt',
      'negativePrompt','requirements','targetEngine','qwenPromptMode','agentModelLanguage','supportsNegativePrompt','promptSchema','promptContract','nsfw'];
    if(Object.keys(payload).some(k=>!allowed.includes(k)) || !['qwen-2.1','gpt-image-2.5'].includes(payload.targetEngine) ||
      (!gptImage&&!nativeQwen&&(payload.promptSchema!=='nf.art.prompt.v1' || payload.agentModelLanguage!=='en')) ||
      (payload.promptContract!==undefined&&!nativeQwen) ||
      (gptImage&&(payload.promptSchema!==undefined||payload.supportsNegativePrompt===true||payload.nsfw===true)) ||
      !['txt2img','img2img'].includes(payload.qwenPromptMode))
      return no('assistant-business-context-unavailable','当前美工输入尚不支持此模型，未提交或扣费。');
    const requestId=typeof payload.requestId==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(payload.requestId)?payload.requestId:'';
    // The existing business request UUID is the stable intent for every
    // retry/quote of this action, not a fresh identifier for each attempt.
    // The operation id is derived from this intent, so a retry after a refunded (settled) operation needs a fresh one.
    let intentId=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)?requestId:'';
    const session=currentSession()?.token;
    const sessionGuard=captureFoartSessionGuard();
    if(!requestId||!intentId||!session||typeof sessionGuard!=='function'||typeof AbortController!=='function')
      return no('assistant-selection-unavailable','会话或请求编号不可用，未提交或扣费。');
    if(companionCloudRequests.size||companionCloudUsed.has(requestId)||companionCloudUsed.size>=1024)
      return no('assistant-business-busy','已有在线请求，或此请求已使用。');
    const input={currentPrompt:String(payload.currentPrompt||payload.prompt||''),requirements:String(payload.requirements||''),
      negativePrompt:gptImage?'':String(payload.negativePrompt||''),supportsNegativePrompt:gptImage?false:payload.supportsNegativePrompt===true,
      nsfw:payload.nsfw===true,qwenPromptMode:payload.qwenPromptMode,...(gptImage?{targetEngine:'gpt-image-2.5'}:nativeQwen?{targetEngine:'qwen-2.1',promptContract:payload.promptContract}:{})};
    if(!input.currentPrompt.trim()||input.currentPrompt.length>20000||input.requirements.length>4000||input.negativePrompt.length>12000||
      (payload.prompt&&payload.currentPrompt&&payload.prompt!==payload.currentPrompt)||
      (payload.nsfw!==undefined&&typeof payload.nsfw!=='boolean')||
      (payload.supportsNegativePrompt!==undefined&&typeof payload.supportsNegativePrompt!=='boolean'))
      return no('invalid-request','美工输入无效，未提交或扣费。');
    if(payload.images!==undefined&&!Array.isArray(payload.images))return no('invalid-request','参考图片格式无效，未提交或扣费。');
    const images=[];let imageBytes=0;
    if((payload.images||[]).length>3)return no('invalid-request','最多支持三张参考图，未提交或扣费。');
    for(const image of payload.images||[]){
      if(!image||!['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference'].includes(image.role)||typeof image.dataUrl!=='string')
        return no('invalid-request','参考图片角色或格式无效，未提交或扣费。');
      if(image.dataUrl.length>Math.ceil(20*1024*1024/3)*4+64)return no('invalid-request','参考图片超过大小限制，未提交或扣费。');
      const match=/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
      if(!match||match[1].length%4!==0)return no('invalid-request','参考图片格式无效，未提交或扣费。');
      imageBytes+=match[1].length/4*3-(match[1].endsWith('==')?2:match[1].endsWith('=')?1:0);
      images.push(Object.freeze({role:image.role,dataUrl:await onlineVisionImage(image.dataUrl,payload.images.length)}));
    }
    if(images.length>3||imageBytes>20*1024*1024)return no('invalid-request','最多支持三张参考图且总计不超过 20 MiB，未提交或扣费。');
    if(images.length&&(typeof payload.confirmImageUpload!=='function'||typeof payload.isImageInputCurrent!=='function'))return no('assistant-business-consent-unavailable','参考图片上传确认或当前选择校验不可用，未提交或扣费。');
    if(images.length&&flatRateOnlineModel(selected.modelId)&&payload.currentDrawingVisionOnly!==true)return no('model-vision-unavailable','当前模型尚未确认支持参考图片，请选择支持图片的模型；未上传或扣费。');
    Object.freeze(images);
    const abort=new AbortController();let cancelled=false,submitted=false,lastQuota=null,stageToken='',pendingId='',accountOwner=null,recoveryId='',operationTerms=null;
    const current=()=>{const x=controller.businessModelSnapshot();return !cancelled&&!payload.signal?.aborted&&
      sessionGuard()===true&&currentSession()?.token===session&&root.NovaFlowXiaotaoArtAgent?.panel?.controller===controller&&
      x?.provider===selected.provider&&x?.modelId===selected.modelId&&x?.epoch===selected.epoch&&
      (!images.length||payload.isImageInputCurrent()===true);};
    const onChange=()=>{cancelled=true;abort.abort();};
    const unsubscribe=controller.subscribeBusinessModel(onChange);
    foartSessionObservers.add(onChange);
    const expiryTimer=Number.isFinite(sessionGuard.expiresAtMs)?setTimeout(onChange,Math.min(2147483647,Math.max(1,sessionGuard.expiresAtMs-Date.now()))):null;
    if(payload.signal?.aborted)onChange();else payload.signal?.addEventListener?.('abort',onChange,{once:true});
    let timer;companionCloudRequests.set(requestId,abort);
    const base=CONFIG.companionUrl||CONFIG.authUrl.replace(/\/novaflow-backend\/?$/,'/novaflow-companion');
    const notice=(id,quota,unknown)=>{try{return payload.onBillingNotice({requestId:id,modelId:selected.modelId,submitted:true,quota,unknown})===true;}catch{return false;}};
    const styleRun=nativeQwen&&images.length>=2&&images[0]?.role==='subject'&&images.slice(1).every(image=>image?.role==='style');
    let artModel=selected.modelId;
    try {
      if(!current())return no('assistant-selection-changed','模型或会话已变，未提交。');
      // The server's hashed policy is the trusted discriminator; omitting both
      // quote fields must never silently downgrade an enabled v3 art operation.
      const pricing=await companionPricing(),policy=pricing?.policy;
      if(!current())return no('assistant-selection-changed','模型或会话已变，未提交。');
      if(pricing?.ok!==true||!/^sha256:[a-f0-9]{64}$/.test(policy?.version||'')||!Number.isFinite(policy?.expiresAt)||Date.now()>=policy.expiresAt||
        !policy.config?.xiaotao_online||typeof policy.config.xiaotao_online!=='object')
        return no('companion-pricing-changed','在线积分策略不可用，本次未提交。');
      operationTerms=policy.config.xiaotao_online;
      if(operationTerms.operation_art_v3!==true || !operationCreditPolicy(operationTerms) || ((payload.currentDrawingTextOnly===true||payload.currentDrawingVisionOnly===true)&&!decimalCreditPolicy(operationTerms)) ||
        (payload.currentDrawingVisionOnly===true&&(operationTerms.operation_vision_chat_v3!==true||!images.length)) ||
        !Array.isArray(policy.models) || !policy.models.some(m=>m.id===artModel&&m.available===true))
        return no('online-business-unavailable','\u5728\u7ebf\u7f8e\u5de5\u8ba1\u8d39\u7b56\u7565\u672a\u5f00\u901a\uff0c\u672a\u63d0\u4ea4\u6216\u6263\u8d39\u3002');
      if(styleRun&&Date.now()-styleLineInterruptedAt<30000&&policy.models.some(m=>m.id===STYLE_REDRAW_BACKUP_MODEL&&m.available===true))artModel=STYLE_REDRAW_BACKUP_MODEL;
      styleLineInterruptedAt=0;
      if(images.length){
        const accepted=await payload.confirmImageUpload({count:images.length,images});
        if(!current())return no('assistant-selection-changed','模型或会话已变，未提交。');
        if(accepted!==true)return no('assistant-business-upload-declined','已取消参考图片上传，未提交或扣费。');
      }
      if(Date.now()>=policy.expiresAt)return no('companion-pricing-changed','在线价格已过期，请重新发送；本次未提交或扣费。');
      timer=setTimeout(onChange,240000);
      // The model answering nothing is refunded by the server (provider-failed, 0 credits); the structure stage then gets one more try before the person hears about it.
      let retried=false;const stages=gptImage||nativeQwen?['structure']:['structure','english'];
      for(let si=0;si<stages.length;si++){const stage=stages[si];
        if(!current())return no('assistant-selection-changed',submitted?'模型或会话已变，本次未完成。':'模型或会话已变，未提交。',{...(lastQuota?{quota:lastQuota}:{}),billingUnknown:submitted&&!lastQuota});
        const body=stage==='structure'?{stage,modelId:artModel,input,intentId,epoch:selected.epoch,...(images.length?{images}:{})}
          :{stage,stageToken,epoch:selected.epoch};
        const quoted=await api(base,'POST','/api/web/companion/art/quote',body,20000,abort.signal);
        if(!current())return no('assistant-selection-changed','模型或会话已变，未提交当前阶段。',{...(lastQuota?{quota:lastQuota}:{})});
        const quote=quoted?.quote;
        if(quoted?.ok!==true||quote?.stage!==stage||quote?.model!==artModel||
          !/^[A-Za-z0-9_-]{8,100}$/.test(quote?.requestId||'')||
          !/^sha256:[a-f0-9]{64}$/.test(quote?.pricingVersion||'')||quote.pricingVersion!==policy.version||
          !validOperationQuote(quote?.estimatedCredits,operationTerms)||
          (stage==='structure'&&quote.maxOutputTokens!==(gptImage?1536:nativeEdit?2048:nativeQwen?4096:6144))||
          typeof quote?.quoteToken!=='string'||quote.quoteToken.length>180000||
          (stage==='structure'&&images.length&&quote.imageCount!==images.length))
          return no('assistant-business-quote-unavailable','本阶段报价不可用，未提交。',{...(lastQuota?{quota:lastQuota}:{})});
        const hasScope=Object.hasOwn(quote,'billingScope'),hasRecoveryId=Object.hasOwn(quote,'recoveryOperationId');
        if(hasScope!==hasRecoveryId||!hasScope||quote.billingScope!=='operation-v3'||!validOperationId(quote.recoveryOperationId)||
          (recoveryId&&recoveryId!==quote.recoveryOperationId))
          return no('assistant-business-quote-unavailable','操作计费信息不匹配，未提交当前阶段。',{...(lastQuota?{quota:lastQuota}:{})});
        payload.onPricingQuote({...quote,quoteToken:undefined,stage});
        if(!current())return no('assistant-selection-changed','模型或会话已变，未提交当前阶段。',{...(lastQuota?{quota:lastQuota}:{})});
        if(await payload.confirmPricingQuote({...quote,quoteToken:undefined,stage})!==true)
          return no('assistant-business-quote-declined','已取消当前阶段。',{...(lastQuota?{quota:lastQuota}:{})});
        if(!current())return no('assistant-selection-changed','模型或会话已变，未提交当前阶段。',{...(lastQuota?{quota:lastQuota}:{})});
        accountOwner=accountOwner||captureFoartBillingOwner();
        if(!accountOwner?.current?.())return no('assistant-selection-changed','登录会话已变化，未提交当前阶段。',{...(lastQuota?{quota:lastQuota}:{})});
        recoveryId=quote.recoveryOperationId;
        pendingId=quote.requestId;
        if(!current())return no('assistant-selection-changed','模型或会话已变，本次未完成。',{...(lastQuota?{quota:lastQuota}:{})});
        submitted=true;v3Submitted=true;if(stage==='english')englishSubmitted=true;companionCloudUsed.add(requestId);
        const result=await api(base,'POST','/api/web/companion/art/execute',{quoteToken:quote.quoteToken,epoch:selected.epoch,...(stage==='structure'&&images.length?{images}:{})},180000,abort.signal);
        const stagePending=stage==='structure'&&!gptImage&&result?.ok===true&&result.stage==='structure'&&result.settlement?.requestId===quote.requestId&&result.settlement?.status==='pending'&&typeof result.stageToken==='string'&&result.stageToken.length>0&&result.stageToken.length<=180000;
        const settled=result?.settlement?.requestId===quote.requestId&&validCreditAmount(result.settlement.settledCredits,decimalCreditPolicy(operationTerms))&&
          result.settlement.status==='settled'&&(result.settlement.uncollectedCredits===undefined||validCreditAmount(result.settlement.uncollectedCredits,decimalCreditPolicy(operationTerms)));
        const quota=settled?{status:'settled',settled_credits:result.settlement.settledCredits,
          ...(result.settlement.balanceShort?{balance_short:true}:{}),...(result.settlement.uncollectedCredits?{uncollected_credits:result.settlement.uncollectedCredits}:{})}:null;
        if(settled){
          lastQuota=quota;
          if(!(result.settlement.uncollectedCredits>0))v3FinalSettled=true;
          if(!notice(quote.requestId,quota,false))
            return no('billing-record-unavailable','本阶段已结算，但账单记录未能更新。',{quota,billingUnknown:true});
          pendingId='';
        }
        if(stagePending){stageToken=result.stageToken;parentRequestId=quote.requestId;if(!current())return no('assistant-selection-changed','模型或会话已变，本次未完成。');continue;}
        if(!current())return no('assistant-selection-changed',settled?'模型或会话已变，本阶段已结算。':'模型或会话已变，本阶段未完成。',{...(quota?{quota}:{}),billingUnknown:!settled});
        if(settled&&result.settlement.uncollectedCredits>0)
          return no('operation-incomplete',incompleteSettlementMessage({charged:result.settlement.settledCredits,uncollected:result.settlement.uncollectedCredits}),{quota,billingUnknown:true});
        if(result?.errorCode==='provider-failed'&&settled&&result.settlement.settledCredits===0&&stage==='structure'&&!retried&&current()){
          console.warn('[NovaFlow] Xiaotao art model answered nothing, retrying once');
          if(styleRun&&policy.models.some(m=>m.id===STYLE_REDRAW_BACKUP_MODEL&&m.available===true))artModel=STYLE_REDRAW_BACKUP_MODEL;
          retried=true;recoveryId='';pendingId='';stageToken='';intentId=(root.crypto||crypto).randomUUID();si--;continue;
        }
        if(result?.ok!==true||!settled){
          console.warn('[NovaFlow] Xiaotao art phase rejected',stage,result?.errorCode||'assistant-business-invalid-result',result?.validationIssue||'');
          const message=({'structure-invalid':'模型返回的绘图提示词未通过完整性校验。','english-invalid':'模型返回的英文执行稿未通过校验。','provider-incomplete':'模型回复未完整返回。','provider-failed':ONLINE_MODEL_NO_ANSWER})[result?.errorCode]||'本阶段未完成。';
          return no(result?.errorCode||'assistant-business-invalid-result',message,{...(quota?{quota}:{}),billingUnknown:!settled});
        }
        if(stage==='structure'){
          if(nativeQwen){
            if(result.releaseEligible!==true||result.reviewRequired!==true||result.targetEngine!=='qwen-2.1'||result.promptContract!==payload.promptContract||
              (result.modelPromptPolicy!==payload.promptContract&&!(nativeEdit&&result.modelPromptPolicy==='qwen21-style-redraw-v1'))||(nativeEdit?!['zh','en'].includes(result.modelPromptLanguage):result.modelPromptLanguage!=='en')||result.translationValidation!==(nativeEdit?'native-edit-and-literals':'paired-prose-and-literals')||
              typeof result.displayPrompt!=='string'||!result.displayPrompt.trim()||typeof result.modelPrompt!=='string'||!result.modelPrompt.trim())
              return no('assistant-business-invalid-result','绘图提示词未通过验证。',{quota});
            console.info('[NovaFlow] Qwen 2.1 rewrite timing',JSON.stringify(result.timings||{}));
            return {...result,prompt:result.displayPrompt,analysisBackend:'runninghub',modelIdentity:{id:selected.modelId},quota};
          }
          if(gptImage){
            if(result.releaseEligible!==true||result.reviewRequired!==true||result.targetEngine!=='gpt-image-2.5'||
              result.promptContract!=='gpt-image-semantic-fusion-v1'||typeof result.displayPrompt!=='string'||!result.displayPrompt.trim()||
              result.modelPrompt!==result.displayPrompt)
              return no('assistant-business-invalid-result','绘图提示词未通过验证。',{quota});
            return {...result,prompt:result.displayPrompt,analysisBackend:'runninghub',modelIdentity:{id:selected.modelId},quota};
          }
          if(typeof result.stageToken!=='string'||!result.stageToken)return no('assistant-business-invalid-result','结构化结果无效。',{...(quota?{quota}:{}),billingUnknown:!settled});
          stageToken=result.stageToken;
        } else {
          if(result.releaseEligible!==true||result.reviewRequired!==true||result.translationValidation!=='structure-and-literals'||result.modelPromptPolicy!=='qwen21-task-policy-v1'||
            result.editContract!=='structured-recompile-v1'||result.promptSchema!=='nf.art.prompt.v1'||
            result.modelPromptLanguage!=='en'||typeof result.modelPrompt!=='string'||!result.modelPrompt.trim()||
            typeof result.displayPrompt!=='string'||!result.displayPrompt.trim())
            return no('assistant-business-invalid-result','英文结果尚未完成验证。',{...(quota?{quota}:{})});
          return {...result,prompt:result.displayPrompt,analysisBackend:'runninghub',modelIdentity:{id:selected.modelId},quota};
        }
      }
      return no('assistant-business-invalid-result','在线美工结果未完成。');
    } catch(error){
      if(!pendingId)return no(error?.code||'assistant-business-unavailable',String(error?.message||'在线美工暂不可用，未提交当前阶段。'),{...(lastQuota?{quota:lastQuota}:{})});
      // The request died in flight (gateway cut, network, our own timer). The server settles the hold on its own; read that
      // settlement instead of guessing, so the person sees what happened and the ledger shows no open hold.
      if(styleRun&&!cancelled)styleLineInterruptedAt=Date.now();
      const closed=recoveryId?await settledOperation(base,recoveryId,()=>sessionGuard()===true&&currentSession()?.token===session,decimalCreditPolicy(operationTerms),cancelled?[0]:undefined):null;
      if(closed){
        const quota={status:'settled',settled_credits:closed.charged};notice(pendingId,quota,false);pendingId='';v3FinalSettled=true;
        return no(closed.charged===0?'provider-failed':'assistant-business-interrupted',closed.charged===0?ONLINE_MODEL_NO_ANSWER:'在线请求中断，本次未完成，可以再试一次。',{quota});
      }
      // Not settled yet: the worker may have been killed mid-call, or the model is still answering a request the browser dropped
      // (live 2.0.341: settled 69 s later). Look again past the server's model limit so a late charge still reaches the bill.
      if(recoveryId&&pendingId){const lateId=pendingId,lateTerms=decimalCreditPolicy(operationTerms);
        void settledOperation(base,recoveryId,()=>sessionGuard()===true&&currentSession()?.token===session,lateTerms,[30000,30000,30000]).then(op=>{if(op)notice(lateId,{status:'settled',settled_credits:op.charged},false);});}
      // The caller may try once more; the next quote sweeps a hold a dead worker left.
      return no('assistant-business-interrupted','在线请求中断，本次未完成，可以再试一次。',{...(lastQuota?{quota:lastQuota}:{}),billingUnknown:true});
    } finally {
      // A known first stage can be closed without issuing another provider
      // request. Once English dispatch begins its result may be unknown, so
      // leave it to finish on the server.
      if(stageToken && parentRequestId && !englishSubmitted && !v3FinalSettled &&
        sessionGuard()===true && currentSession()?.token===session && accountOwner?.current?.()) {
        try {
          const cancelled=await api(base,'POST','/api/web/companion/art/cancel',{stageToken,epoch:selected.epoch},10000);
          const settled=cancelled?.errorCode==='operation-cancelled' && cancelled.settlement?.requestId===parentRequestId &&
            cancelled.settlement?.status==='settled' && validCreditAmount(cancelled.settlement.settledCredits,decimalCreditPolicy(operationTerms)) &&
            (cancelled.settlement.uncollectedCredits===undefined || cancelled.settlement.uncollectedCredits===0);
          if(settled){
            const quota={status:'settled',settled_credits:cancelled.settlement.settledCredits};
            if(lastFailure){lastFailure.quota=quota;lastFailure.billingUnknown=false;}
            notice(parentRequestId,quota,false);
          } else if(cancelled?.errorCode==='operation-cancelled'&&cancelled.settlement?.requestId===parentRequestId&&cancelled.settlement?.status==='settled'&&
            validCreditAmount(cancelled.settlement.settledCredits,decimalCreditPolicy(operationTerms))&&
            validCreditAmount(cancelled.settlement.uncollectedCredits,decimalCreditPolicy(operationTerms))&&cancelled.settlement.uncollectedCredits>0&&lastFailure){
            lastFailure.quota={status:'settled',settled_credits:cancelled.settlement.settledCredits,uncollected_credits:cancelled.settlement.uncollectedCredits};
            lastFailure.error=incompleteSettlementMessage({charged:cancelled.settlement.settledCredits,uncollected:cancelled.settlement.uncollectedCredits});
            lastFailure.billingUnknown=true;
          }
        } catch (_) { /* Keep the recovery record if closure is unknown. */ }
      }
      clearTimeout(timer);if(expiryTimer!==null)clearTimeout(expiryTimer);foartSessionObservers.delete(onChange);companionCloudRequests.delete(requestId);unsubscribe?.();payload.signal?.removeEventListener?.('abort',onChange);
    }
  }

  async function localPromptAssistant(action, payload, guard={}) {
    if (taskMode() === 'local') {
      try { return await localControl('POST', '/local/prompt-assistant/' + action, payload || {}, PROMPT_ASSISTANT_TIMEOUT_MS); }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    }
    // The shared pool: every compute node is a full copy of the desktop runtime, so
    // the same service answers from one of them - as a prompt_assistant task whose
    // request is one uploaded JSON file and whose reply is one output file.
    try { return await pooledPromptAssistant(action, payload || {}, guard); }
    catch (error) { return { ok: false, error: String(error.message || error) }; }
  }
  async function qwenCandidatePayloadDigest(bytes) {
    if(!root.crypto?.subtle || typeof root.crypto.subtle.digest!=='function' || !bytes || !Number.isSafeInteger(bytes.byteLength))
      throw new Error('无法验证候选请求摘要，未提交。');
    const digest=await root.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function pooledPromptAssistant(action, payload, guard={}) {
    const qwenImageEdit=guard.qwenImageEdit===true;
    const qwenNativeV3=!qwenImageEdit && payload?.promptContract==='qwen21-native-rewrite-v3';
    const qwenH3Text=action==='optimize-prompt'&&payload?.surface==='animation'&&payload?.purpose==='minimax-h3-prompt-enhance';
    const qwenBoundBusiness=qwenNativeV3||qwenH3Text;
    const rotationStage=payload?.foartAnimationStage==='rotation_candidate';
    const qwenPlan=action==='art-agent-chat' && rotationStage && guard.qwenPlan===true;
    const qwenRotationCandidate=action==='art-agent-chat' && rotationStage && !qwenPlan;
    if(guard.qwenPlan===true && !qwenPlan)throw new Error('Qwen 动画规划请求范围无效，未提交。');
    if(rotationStage && ((!qwenRotationCandidate && !qwenPlan) || taskMode()!=='shared' || payload?.provider!=='local' ||
        payload?.modelId!=='qwen3.5-9b-heretic' || payload?.mode!=='foart' ||
        !Array.isArray(payload.images) || payload.images.length!==0 ||
        typeof guard.isCurrent!=='function' || guard.isCurrent()!==true))
      throw new Error('Qwen 动画候选尚未安全开放，未提交或修改作品。');
    if(qwenRotationCandidate || qwenPlan || qwenImageEdit)candidateSecureBase(CONFIG.controlUrl);
    const candidateSession=qwenRotationCandidate || qwenPlan || qwenImageEdit?captureFoartSessionGuard():null;
    if((qwenRotationCandidate || qwenPlan || qwenImageEdit) && (typeof candidateSession!=='function' || candidateSession()!==true || !computeNode?.id))
      throw new Error('候选任务需要当前登录会话和已选本人节点，未提交。');
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    const owned = { taskId:'', cancelled:false,startedAt:Date.now(),candidate:qwenRotationCandidate,qwenPlan,candidateSession,stage:action==='art-agent-chat'?'analysis':/H3 compile: translate-only/.test(payload.requirements || '')?'compile':'optimize' };
    if(guard.isCurrent){if(typeof AbortController!=='function')throw new Error('无法安全取消素材上传，未提交。');owned.inputAbort=new AbortController();}
    const taskNodeEpoch=computeNodeEpoch;
    if (requestId && guard.isCurrent && pooledPromptRequests.has(requestId)) throw new Error('请求编号正在使用，请重新发起。');
    if (requestId) pooledPromptRequests.set(requestId, owned);
    const check = () => { if (owned.cancelled) throw new Error('本次提示词分析已取消'); if ((qwenBoundBusiness && !qwen21NativeRewriteV3Available()) || (qwenImageEdit&&!qwen21LocalImageEditAvailable()) || (guard.isCurrent && (computeNodeEpoch!==taskNodeEpoch || !guard.isCurrent() || ((qwenRotationCandidate || qwenPlan || qwenImageEdit) && !candidateSession())))) throw new Error('模型、节点或会话已变化，任务未继续。'); };
    try {
    const selectedNode=computeNode?.id || '';
    const conversationNode=action==='art-agent-chat' && !selectedNode ? pooledConversationNodes.get(payload.conversationId) : '';
    // For this owner-bound scope, ask about the exact captured node. Calling
    // control() here would implicitly append the current picker value; use the
    // same authenticated API directly so a later node change cannot silently
    // change the query or add a duplicate worker parameter.
    const caps = qwenPlan || qwenBoundBusiness || qwenImageEdit
      ? await api(CONFIG.controlUrl,'GET','/api/web/capabilities?worker='+encodeURIComponent(selectedNode))
      : await control('GET', '/api/web/capabilities'+(conversationNode?'?worker='+encodeURIComponent(conversationNode):''));
    check();
    if ((computeNode?.id || '') !== selectedNode) throw new Error('算力节点已切换，请重新发送本次请求');
    const type = (caps && caps.taskTypes || []).find((t) => t.task_type === 'prompt_assistant');
    const qwenStyle=action==='describe-art-style'&&payload.mode==='style-analysis';
    if(qwenStyle && (!selectedNode || caps?.features?.qwen35StyleAnalysisKinds?.[payload.kind]!==true || caps?.features?.qwen35StyleOwnerLeaseBound!==true)) throw new Error('Qwen style analysis is not enabled for this owned node.');
    const qwenBusiness = !qwenStyle && ['optimize-prompt','reverse-image-prompt','describe-art-style','rewrite-audio-prompt'].includes(action) && payload.assistantProvider === 'local' && payload.assistantModelId === 'qwen3.5-9b-heretic';
    if(qwenNativeV3 && (action!=='optimize-prompt' || !qwenBusiness || payload.surface!=='art' || payload.targetEngine!=='qwen-2.1' || payload.qwenPromptMode!=='txt2img' || typeof guard.isCurrent!=='function' || !selectedNode || !qwen21NativeRewriteV3Available() || caps?.features?.qwen21NativeRewriteV3!==true))
      throw new Error('当前节点未确认支持绘图优化，请重新选择节点后重试。');
    if(qwenH3Text && (!qwenBusiness || !['text_video','image_video','first_last','multi_reference'].includes(payload.h3Mode) || typeof guard.isCurrent!=='function' || !selectedNode || !qwen21NativeRewriteV3Available() || caps?.features?.qwen21NativeRewriteV3!==true))
      throw new Error('当前本人节点未确认支持视频文字优化，请更新算力助手后重试。');
    if(qwenImageEdit && (action!=='optimize-prompt'||payload.mode!=='image-edit'||typeof guard.isCurrent!=='function'||!selectedNode||
      caps?.features?.qwen21LocalImageEdit!==true||caps?.features?.qwen21LocalImageEditOwnerLeaseBound!==true))
      throw new Error('当前本人节点未确认支持参考图优化，请更新算力助手后重试。');
    const qwenTrial = action === 'art-agent-chat' && payload.modelId === 'qwen3.5-9b-heretic';
    if(qwenRotationCandidate && (!selectedNode || caps?.features?.qwen35FoartRotationCandidate!==true ||
        caps?.features?.qwen35FoartRotationOwnerLeaseBound!==true))
      throw new Error('当前自有节点尚未提供安全动画候选能力，未提交。');
    if(qwenPlan && (!selectedNode || caps?.features?.qwen35FoartPlan!==true || caps?.features?.qwen35FoartPlanOwnerBound!==true))
      throw new Error('当前自有节点尚未提供安全动画规划能力，未提交。');
    const qwenUi = action==='reverse-image-prompt' && payload.mode==='ui-draft';
    const uiCpu = action==='reverse-image-prompt' && payload.surface==='ui-design' && payload.uiPlanner==='grok-vision-cpu-v1' && ['capabilities','grok-vision-job','compile-grok-vision','native-ui-cloud','native-ui-compile'].includes(payload.action);
    if(qwenUi && (!selectedNode || caps?.features?.qwen35UiDraft!==true || caps?.features?.qwen35UiOwnerLeaseBound!==true)) throw new Error('Qwen UI draft is not enabled for this owned node.');
    if (qwenBusiness && caps?.features?.qwen35BusinessTrial !== true) throw new Error('当前没有支持该功能的 Qwen 节点，任务未提交。');
    if (qwenTrial && !qwenPlan && caps?.features?.qwen35CpuTrial !== true) throw new Error('当前算力节点没有可用的 Qwen3.5 9B 本地服务，未提交任务');
    if (!qwenImageEdit && !qwenTrial && !qwenBusiness && !qwenStyle && !qwenUi && !uiCpu && (!type || !(type.available_workers > 0))) throw new Error(action==='art-agent-chat'
      ? '当前算力节点没有就绪的小桃模型服务，请检查节点助手的模型状态；机器开机不代表模型服务已就绪'
      : PROMPT_ASSISTANT_REFUSAL + '：当前算力池没有带本地模型的节点');
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let created,qwenPlanDigest=null,qwenImageDigest=null;
    if(qwenRotationCandidate){
      if(!QWEN_ROTATION_REQUEST_ID.test(requestId) || bytes.byteLength<1 || bytes.byteLength>262144 ||
        typeof AbortSignal==='undefined' || typeof AbortSignal.any!=='function' || typeof AbortSignal.timeout!=='function')
        throw new Error('候选请求编号或大小无效，未提交。');
      const sha256=await qwenCandidatePayloadDigest(bytes);check();
      let response;
      try { response=await fetch(candidateSecureBase(CONFIG.controlUrl)+'/api/web/qwen-rotation/tasks',{
        method:'POST',headers:authHeaders(),body:JSON.stringify({requestId,workerId:selectedNode,sha256,bytes:bytes.byteLength}),
        redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.any([owned.inputAbort.signal,AbortSignal.timeout(20000)])
      }); } catch {throw new Error('候选创建结果未确认，请稍后查看任务列表再试。');}
      if(!response.ok)throw new Error(response.status>=500?'候选创建结果未确认，请稍后查看任务列表再试。':'候选任务创建未通过。');
      try {created=await response.json();} catch {throw new Error('候选创建结果未确认，请稍后查看任务列表再试。');}
      if(created?.ok!==true || !QWEN_ROTATION_CANDIDATE_ID.test(String(created?.task?.id||'')) || !Object.hasOwn(created.task,'assigned_worker_id') ||
        !['queued','assigned','uploading'].includes(created.task.status) || !Number.isSafeInteger(created.task.attempt_count) ||
        created.task.attempt_count<0 || (created.task.assigned_worker_id!=null && created.task.assigned_worker_id!==selectedNode))
        throw new Error('候选创建结果不匹配，请稍后查看任务列表再试。');
    } else if(qwenPlan){
      if(!QWEN_ROTATION_REQUEST_ID.test(requestId) || bytes.byteLength<1 || bytes.byteLength>262144 ||
        typeof AbortSignal==='undefined' || typeof AbortSignal.any!=='function' || typeof AbortSignal.timeout!=='function')
        throw new Error('动画规划请求编号或大小无效，未提交。');
      const sha256=await qwenCandidatePayloadDigest(bytes);qwenPlanDigest=sha256;check();
      created=await control('POST','/api/web/tasks',{
        task_type:'prompt_assistant',target_worker_id:selectedNode,
        parameters:{action,model_id:'qwen3.5-9b-heretic',assistant_tool_scope:QWEN_PLAN_SCOPE,
          request_id:requestId,request_sha256:sha256,request_bytes:bytes.byteLength},
        references:[{name:QWEN_PLAN_REQUEST_FILE,kind:'json',bytes:bytes.byteLength}]
      });
      if(created?.ok!==true || !NODE_ID.test(String(created?.task?.id||'')) || QWEN_ROTATION_CANDIDATE_ID.test(String(created.task.id).toLowerCase()) ||
        !['created','queued','assigned','uploading'].includes(created.task.status) || !Number.isSafeInteger(created.task.attempt_count) ||
        created.task.attempt_count<0 || (created.task.assigned_worker_id!=null && created.task.assigned_worker_id!==selectedNode))
        throw new Error('动画规划任务创建结果不匹配，请稍后查看任务列表再试。');
    } else if(qwenImageEdit){
      if(bytes.byteLength>16*1024*1024)throw new Error('参考图片和文字合计超过 16 MiB，请缩小图片后重试。');
      if(!QWEN_ROTATION_REQUEST_ID.test(requestId)||bytes.byteLength<1||
        typeof AbortSignal==='undefined'||typeof AbortSignal.any!=='function'||typeof AbortSignal.timeout!=='function')
        throw new Error('参考图优化请求编号或大小无效，未提交。');
      qwenImageDigest=await qwenCandidatePayloadDigest(bytes);check();
      created=await control('POST','/api/web/tasks',{task_type:'prompt_assistant',target_worker_id:selectedNode,
        parameters:{action,model_id:'qwen3.5-9b-heretic',assistant_tool_scope:QWEN_IMAGE_EDIT_SCOPE,request_id:requestId,
          request_sha256:qwenImageDigest,request_bytes:bytes.byteLength},references:[{name:QWEN_IMAGE_EDIT_REQUEST_FILE,kind:'json',bytes:bytes.byteLength}]});
      if(created?.ok!==true||!NODE_ID.test(String(created?.task?.id||''))||QWEN_ROTATION_CANDIDATE_ID.test(String(created.task.id).toLowerCase())||
        !['created','queued','assigned','uploading'].includes(created.task.status)||!Number.isSafeInteger(created.task.attempt_count)||created.task.attempt_count<0||
        (created.task.assigned_worker_id!=null&&created.task.assigned_worker_id!==selectedNode))throw new Error('参考图任务创建结果不匹配，请稍后查看任务列表。');
    } else created = await control('POST', '/api/web/tasks', {
      task_type: 'prompt_assistant',
      ...(qwenBoundBusiness ? {target_worker_id:selectedNode} : conversationNode ? {target_worker_id:conversationNode} : {}),
      parameters: { action, ...(uiCpu ? {ui_scope:'cpu-v1'} : {}), ...(qwenUi ? {ui_scope:'qwen-ui-draft-v1',model_id:'qwen3.5-9b-heretic'} : {}), ...(qwenStyle ? {style_scope:'qwen-style-analysis-v1',style_kind:payload.kind,model_id:'qwen3.5-9b-heretic',...(payload.kind!=='aifx-supplement'?{image_upload_confirmed:true}:{})} : {}), ...(qwenTrial ? {model_id:'qwen3.5-9b-heretic'} : {}), ...(qwenRotationCandidate ? {assistant_tool_scope:'qwen-foart-rotation-candidate-v1'} : {}), ...(qwenBusiness ? {assistant_selection_scope:'xiaotao',assistant_model_id:payload.assistantModelId} : {}) },
      references: [{ name: 'request.json', kind: 'json', bytes: bytes.length }]
    });
    if (!created || !created.task) throw new Error((created && created.error) || '提示词任务创建失败');
    owned.taskId = created.task.id;
    if(qwenRotationCandidate)taskModes.set(created.task.id,'shared');
    tasks.set(created.task.id, created.task);
    let assignedPlanAttempt=null;
    try {
      check();
      const assigned=await putTaskInput(created.task.id, qwenImageEdit?QWEN_IMAGE_EDIT_REQUEST_FILE:qwenPlan?QWEN_PLAN_REQUEST_FILE:'request.json', bytes, undefined, guard.isCurrent ? {assertCurrent:check,signal:owned.inputAbort.signal,
        ...(qwenRotationCandidate?{candidate:true,expectedNodeId:selectedNode}:qwenPlan||qwenImageEdit?{qwenPlan:true,expectedNodeId:selectedNode}:qwenBoundBusiness?{expectedNodeId:selectedNode}:{})} : undefined);
      if(qwenPlan||qwenImageEdit){
        if(assigned?.id!==created.task.id || assigned.assigned_worker_id!==selectedNode || !Number.isSafeInteger(assigned.attempt_count) || assigned.attempt_count<1 || assigned.attempt_count>20)
          throw new Error('动画规划任务节点或尝试次数不匹配，未修改作品。');
        assignedPlanAttempt=assigned.attempt_count;
      }
      check();
    } catch (error) {
      // The browser has stopped waiting or could not upload; leave no queued
      // request for the worker to claim after the user has gone away.
      if(qwenRotationCandidate) {
        if(candidateSession())await cancelQwenRotationTask(created.task.id,candidateSession).catch(()=>{});
      } else await control('POST', '/api/web/tasks/' + created.task.id + '/cancel').catch(() => {});
      throw error;
    }
    const finished = await waitForTaskEnd(created.task.id, PROMPT_ASSISTANT_TIMEOUT_MS,qwenRotationCandidate||qwenPlan||qwenBoundBusiness||qwenImageEdit?check:undefined);
    if(qwenBoundBusiness && finished?.assigned_worker_id!==selectedNode)throw new Error('优化结果所属节点已变化，未应用。');
    if(qwenPlan){
      const files=finished?.output_manifest?.files,expected='qwen-foart-plan-result-'+assignedPlanAttempt+'.json';
      if(finished.id!==created.task.id || finished.assigned_worker_id!==selectedNode || finished.attempt_count!==assignedPlanAttempt ||
        finished.result_expired!==false || !Array.isArray(files) || files.length!==1 || files[0]?.name!==expected || files[0]?.kind!=='json' ||
        !Number.isSafeInteger(files[0]?.bytes) || files[0].bytes<1 || files[0].bytes>262144)
        throw new Error('动画规划结果所属节点、尝试或文件已变化，未修改作品。');
    }
    if(qwenImageEdit){
      const files=finished?.output_manifest?.files,expected='qwen21-local-image-edit-result-'+assignedPlanAttempt+'.json';
      if(finished.id!==created.task.id||finished.assigned_worker_id!==selectedNode||finished.attempt_count!==assignedPlanAttempt||finished.result_expired!==false||
        !Array.isArray(files)||files.length!==1||files[0]?.name!==expected||files[0]?.kind!=='json'||!Number.isSafeInteger(files[0]?.bytes)||files[0].bytes<1||files[0].bytes>262144)
        throw new Error('参考图结果的节点、尝试或文件已变化，未应用。');
    }
    const reply = await fetchTaskOutput(finished, qwenImageEdit?'qwen21-local-image-edit-result-'+assignedPlanAttempt+'.json':qwenPlan?'qwen-foart-plan-result-'+assignedPlanAttempt+'.json':'result.json',qwenRotationCandidate?{candidate:true,expectedNodeId:selectedNode,assertCurrent:check,signal:owned.inputAbort.signal}:qwenPlan||qwenImageEdit?{qwenPlan:true,expectedNodeId:selectedNode,assertCurrent:check,signal:owned.inputAbort.signal}:undefined);
    check();
    if(qwenImageEdit && reply.byteLength!==finished.output_manifest.files[0].bytes)throw new Error('参考图结果文件大小不匹配，未应用。');
    const result=JSON.parse(new TextDecoder().decode(reply));
    if(qwenImageEdit){
      const proof=result?.imageEditBinding,data=result?.data;
      if(result?.ok!==true||!proof||Object.keys(proof).sort().join(',')!=='attempt,requestId,requestSha256,taskId,workerId'||
        proof.taskId!==created.task.id||proof.workerId!==selectedNode||proof.attempt!==assignedPlanAttempt||proof.requestId!==requestId||proof.requestSha256!==qwenImageDigest||
        !data||data.analysisBackend!=='qwen-cpu'||data.modelIdentity?.id!=='qwen35-heretic'||!['server-model-id','server-weight-path'].includes(data.modelIdentity?.verification)||
        data.resourcesReleased!==true||data.generationReady!==true||data.promptContract!=='qwen21-native-rewrite-v3'||data.modelPromptPolicy!=='qwen21-native-rewrite-v3'||
        data.translationValidation!=='native-edit-and-literals'||data.modelPromptLanguage!==qwenImageEditLanguage(payload.currentPrompt,payload.requirements)||
        typeof data.displayPrompt!=='string'||data.displayPrompt.trim().length<2||data.modelPrompt!==data.displayPrompt||data.negativePrompt!==payload.negativePrompt)
        throw new Error('参考图优化结果与请求或模型不匹配，未应用。');
      const latest=(await control('GET','/api/web/tasks/'+encodeURIComponent(created.task.id)))?.task;check();
      const files=latest?.output_manifest?.files,expected='qwen21-local-image-edit-result-'+assignedPlanAttempt+'.json';
      if(latest?.id!==created.task.id||latest.model_id!==QWEN_IMAGE_EDIT_CAPABILITY||latest.status!=='completed'||latest.assigned_worker_id!==selectedNode||latest.attempt_count!==assignedPlanAttempt||
        latest.parameters?.assistant_tool_scope!==QWEN_IMAGE_EDIT_SCOPE||latest.parameters?.request_id!==requestId||latest.parameters?.request_sha256!==qwenImageDigest||latest.parameters?.request_bytes!==bytes.byteLength||
        latest.result_expired!==false||!Array.isArray(files)||files.length!==1||files[0]?.name!==expected||files[0]?.kind!=='json'||files[0]?.bytes!==reply.byteLength)
        throw new Error('参考图任务已变化或结果已过期，未应用。');
    }
    if(qwenPlan){
      if(!result || typeof result!=='object' || Array.isArray(result))throw new Error('动画规划结果无效，未修改作品。');
      const proof=result.planBinding;
      if(!proof || typeof proof!=='object' || Array.isArray(proof) ||
        Object.keys(proof).sort().join(',')!=='attempt,requestId,requestSha256,taskId,workerId' ||
        proof.taskId!==created.task.id || proof.workerId!==selectedNode || proof.attempt!==assignedPlanAttempt ||
        proof.requestId!==requestId || proof.requestSha256!==qwenPlanDigest)
        throw new Error('动画规划结果与已提交的任务不匹配，未修改作品。');
      qwenPlanBindings.set(result,{taskId:created.task.id,nodeId:selectedNode,attempt:assignedPlanAttempt,
        requestId,requestSha256:qwenPlanDigest,requestBytes:bytes.byteLength,resultBytes:reply.byteLength,check,session:candidateSession});
      if(!await verifyQwenPlanResponse(result))throw new Error('动画规划任务或会话已失效，未修改作品。');
    }
    if(action==='art-agent-chat' && result?.data?.conversationId && finished.assigned_worker_id){
      pooledConversationNodes.set(result.data.conversationId,finished.assigned_worker_id);
      if(pooledConversationNodes.size>128)pooledConversationNodes.delete(pooledConversationNodes.keys().next().value);
    }
    return result;
    } finally { if (requestId && pooledPromptRequests.get(requestId) === owned) pooledPromptRequests.delete(requestId); }
  }
  async function cancelQwenRotationTask(taskId,sessionGuard) {
    if(typeof sessionGuard!=='function' || sessionGuard()!==true)throw new Error('登录会话已变化，无法确认候选取消。');
    const current=await control('GET','/api/web/tasks/'+encodeURIComponent(taskId));
    if(sessionGuard()!==true)throw new Error('登录会话已变化，无法确认候选取消。');
    const task=current?.task;
    if(!task || task.id!==taskId || !Number.isSafeInteger(task.attempt_count) || task.attempt_count<0)
      throw new Error('候选任务状态未确认，无法取消。');
    if(task.status==='cancelled')return {ok:true,cancelled:true};
    if(['completed','failed','expired'].includes(task.status))return {ok:true,cancelled:false,terminal:true};
    const result=await control('POST','/api/web/tasks/'+encodeURIComponent(taskId)+'/qwen-rotation-cancel',{attempt:task.attempt_count});
    if(sessionGuard()!==true || result?.ok!==true || result.cancelled!==true)throw new Error('候选取消结果未确认。');
    return result;
  }
  async function cancelPromptAssistantRequest(payload={}) {
    const requestId=typeof payload.requestId==='string' && payload.requestId.length<=160 ? payload.requestId : '';
    if (!requestId) return {ok:false,error:'缺少要取消的提示词分析请求'};
    if (!pooledPromptRequests.has(requestId) && taskMode() === 'local') {
      try { return await localControl('POST','/local/prompt-assistant/cancel-request',{requestId},PROMPT_ASSISTANT_TIMEOUT_MS); }
      catch(error) { return {ok:false,error:String(error.message || error)}; }
    }
    const owned=pooledPromptRequests.get(requestId);
    if (!owned) return {ok:true,cancelled:true,matched:false};
    owned.cancelled=true;
    owned.inputAbort?.abort();
    if (owned.taskId) {
      try {
        if(owned.candidate){
          const result=await cancelQwenRotationTask(owned.taskId,owned.candidateSession);
          return {ok:true,cancelled:result.cancelled===true,matched:true,...(result.terminal?{terminal:true}:{})};
        }
        await control('POST','/api/web/tasks/'+encodeURIComponent(owned.taskId)+'/cancel',{});
      }
      catch(error) { return {ok:false,error:String(error.message || error)}; }
    }
    return {ok:true,cancelled:true,matched:true};
  }
  async function pooledPromptStatus({requestId}={}) {
    try {
      const owned=pooledPromptRequests.get(requestId);
      if(owned){
        const task=owned.taskId?tasks.get(owned.taskId):null;
        const note=String(task?.progress_note || task?.note || '');
        const match=/^NFPA1:(preparing|loading|analyzing|releasing):(analysis|optimize|compile)$/.exec(note);
        const phase=match?.[1] || (!task?'connecting':['created','queued'].includes(task.status)?'queued':task.status==='uploading'?'uploading':task.status==='processing'?'processing':task.status==='completed'?'completed':'assigned');
        return {ok:true,result:{available:true,reason:'compute-node',operation:{requestId,phase,stage:match?.[2] || owned.stage,source:'pool',taskId:owned.taskId,startedAt:owned.startedAt}}};
      }
      const caps=await control('GET','/api/web/capabilities');
      return {ok:true,result:{available:(caps.taskTypes || []).some(t=>t.task_type==='prompt_assistant' && t.available_workers>0),reason:'compute-node',features:{qwen35CpuTrial:caps?.features?.qwen35CpuTrial === true,
        qwen35FoartPlan:!!computeNode?.id && caps?.features?.qwen35FoartPlan===true && caps?.features?.qwen35FoartPlanOwnerBound===true,
        qwen35FoartRotationCandidate:!!computeNode?.id && caps?.features?.qwen35FoartRotationCandidate===true && caps?.features?.qwen35FoartRotationOwnerLeaseBound===true}}};
    }catch(error){return {ok:false,error:String(error.message || error)};}
  }
  async function waitForTaskEnd(taskId, timeoutMs, assertCurrent) {
    const started = Date.now();
    for (;;) {
      assertCurrent?.();
      const res = await control('GET', '/api/web/tasks/' + taskId);
      assertCurrent?.();
      const task = (res && res.task) || {};
      tasks.set(taskId,task);
      if (task.status === 'completed') { tasks.set(taskId, task); return task; }
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
        throw new Error(taskErrorText(task));
      }
      if (Date.now() - started > timeoutMs) throw new Error('提示词助手等待超时，请检查算力节点后重试');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  async function verifyQwenPlanResponse(result) {
    const binding=result && typeof result==='object' ? qwenPlanBindings.get(result) : null;
    if(!binding)return false;
    try {
      binding.check();
      if(!binding.session() || computeNode?.id!==binding.nodeId)return false;
      const value=await control('GET','/api/web/tasks/'+encodeURIComponent(binding.taskId));
      binding.check();
      const task=value?.task, expected='qwen-foart-plan-result-'+binding.attempt+'.json';
      const files=task?.output_manifest?.files;
      return binding.session()===true && computeNode?.id===binding.nodeId && task?.id===binding.taskId &&
        task.model_id==='qwen3.5-9b-heretic-foart-plan-v1' && task.status==='completed' && task.result_expired===false &&
        task.assigned_worker_id===binding.nodeId && task.attempt_count===binding.attempt && Array.isArray(files) &&
        task.parameters?.assistant_tool_scope===QWEN_PLAN_SCOPE && task.parameters?.request_id===binding.requestId &&
        task.parameters?.request_sha256===binding.requestSha256 && task.parameters?.request_bytes===binding.requestBytes &&
        files.length===1 && files[0]?.name===expected && files[0]?.kind==='json' &&
        Number.isSafeInteger(files[0]?.bytes) && files[0].bytes===binding.resultBytes;
    } catch {return false;}
  }
  if (CONFIG.localAssistant) root.addEventListener?.('load', async () => {
    try {
      const response = await fetch(CONFIG.localOrigin + '/local/events', { headers: { 'x-novaflow-local': localKey } });
      if (!response.ok) return;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split('\n\n'); buffer = messages.pop();
        if (messages.includes('data: closed')) {
          await root.NovaFlowWebWarehouse?.clearTemporary?.();
          // Browsers may disallow closing an externally opened tab. In that
          // case cover the stopped editor rather than leave active controls.
          const panel = root.document.createElement('div');
          panel.setAttribute('role', 'status');
          panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#151515;color:#eee;font:16px system-ui;padding:32px;text-align:center';
          panel.textContent = '旧本地工作台入口已停止维护，请在 foart.net 使用官网并连接 Foart。';
          root.document.body.appendChild(panel);
          root.close?.();
          return;
        }
      }
    } catch (_) { /* A temporary transport loss never closes the editor. */ }
  }, { once: true });
  // ------------------------------------------------------------ queue notice
  //
  // 2026-10-15 (user): when the compute node is busy, a dialog says the run is waiting in line,
  // how long it has waited and roughly how long until it starts, and lets the wait be cancelled.
  // Every generation polls its task through control(), so this one place sees them all: a task
  // still waiting for a node (task.queue from the control plane or the local queue), or one a node
  // holds while its runtime finishes other prompts first (the "[queue ahead=N eta=S]" marker the
  // node adds to its note - stripped here, no panel ever shows it). Waits that are not tasks (the
  // AI 助手 waiting for the GPU) come in through NovaFlowQueueNotice.wait / done.
  const QUEUE_NOTE_RE = /\s*\[queue ahead=(\d+)(?: eta=(\d+))?\]\s*$/;
  const QUEUE_SHOW_AFTER_MS = 3000;   // a node that picks the task up within a poll or two shows nothing
  const QUEUE_STALE_MS = 15000;       // a task nobody polls any more is no longer anyone's wait
  const QUEUE_TERMINAL = ['completed', 'failed', 'cancelled', 'expired'];
  const waits = new Map();            // key -> { since, seen, label, ahead, workers, eta, etaAt, cancel, background, external }
  let queueRoot = null;
  let queueTimer = 0;

  function readQueueNote(task) {
    if (!task || typeof task !== 'object') return task;
    const match = QUEUE_NOTE_RE.exec(String(task.progress_note || ''));
    if (!match) return task;
    task.progress_note = String(task.progress_note).replace(QUEUE_NOTE_RE, '');
    if (!task.queue) task.queue = { ahead: Number(match[1]), eta_seconds: match[2] === undefined ? null : Number(match[2]), workers: 1 };
    return task;
  }

  const taskCreditSeen = new Map();
  function noteTaskCreditChange(task) {
    if (!task || !task.id) return;
    const signature = (task.credit_settled ? '1' : '0') + ':' + String(Number(task.charged_credit_cost || 0));
    const previous = taskCreditSeen.get(task.id);
    taskCreditSeen.set(task.id, signature);
    // The first sight of a task is not a charge. A later change is a charge or a refund.
    if (previous == null || previous === signature) return;
    notifyAccountBalance(null, 'task');
  }

  function observeTask(task) {
    if (!task || !task.id) return;
    noteTaskCreditChange(task);
    readQueueNote(task);
    const key = 'task:' + task.id;
    const waiting = !QUEUE_TERMINAL.includes(task.status)
      && (task.status === 'created' || task.status === 'queued' || Boolean(task.queue));
    if (!waiting) { endWait(key); return; }
    const queue = task.queue || {};
    noteWait(key, {
      ahead: queue.ahead,
      workers: queue.workers,
      eta: queue.eta_seconds,
      cancel: () => control('POST', '/api/web/tasks/' + task.id + '/cancel')
    });
  }

  const finite = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

  function noteWait(key, info) {
    const now = Date.now();
    let wait = waits.get(key);
    if (!wait) { wait = { since: now, background: false, eta: null, etaAt: now }; waits.set(key, wait); }
    wait.seen = now;
    wait.external = Boolean(info.external);
    if (info.label !== undefined) wait.label = String(info.label || '');
    wait.ahead = finite(info.ahead);
    wait.workers = finite(info.workers);
    const eta = finite(info.eta);
    // The same estimate again (a cached answer, a node's ten-second step) keeps counting down.
    if (eta !== wait.eta) { wait.eta = eta; wait.etaAt = now; }
    if (typeof info.cancel === 'function') wait.cancel = info.cancel;
    renderQueue();
  }

  function endWait(key) {
    if (waits.delete(key)) renderQueue();
  }

  function clock(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
  }

  function queueTexts(wait, now) {
    let line = '算力节点正忙，轮到后自动开始';
    if (wait.ahead > 0) line = '前面还有 ' + wait.ahead + ' 个任务，轮到后自动开始';
    else if (wait.ahead === 0 && wait.workers === 0) line = '暂时没有在线的算力节点，有节点上线后自动开始';
    else if (wait.ahead === 0) line = '马上轮到，正在等算力节点接手';
    let eta = wait.ahead === 0 ? '马上开始' : '暂时无法估算';
    if (wait.workers === 0) eta = '等节点上线';
    else if (wait.eta !== null) {
      const left = wait.eta - (now - wait.etaAt) / 1000;
      // Past the estimate with someone still ahead: the run ahead is slower than usual, not over.
      eta = left > 1 ? '约 ' + clock(left) : wait.ahead > 0 ? '稍等片刻' : '马上开始';
    }
    return { line, waited: clock((now - wait.since) / 1000), eta };
  }

  function ensureQueueRoot() {
    if (queueRoot && queueRoot.isConnected) return queueRoot;
    const doc = root.document;
    if (!doc || !doc.body) return null;
    if (!doc.getElementById('novaflow-queue-notice-style')) {
      const style = doc.createElement('style');
      style.id = 'novaflow-queue-notice-style';
      // Ids and !important: the host stylesheets flatten every button with selectors stronger than a class.
      style.textContent = [
        '#novaflow-queue-notice{position:fixed;inset:0;z-index:2147483630;pointer-events:none;color:#e9e9e9;font-family:inherit;font-size:12px;line-height:1.5}',
        '#novaflow-queue-notice[hidden],#novaflow-queue-notice[data-view="pill"] .nfq-mask,#novaflow-queue-notice[data-view="pill"] .nfq-dialog,#novaflow-queue-notice[data-view="dialog"] .nfq-pill{display:none !important}',
        '#novaflow-queue-notice .nfq-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);pointer-events:auto}',
        '#novaflow-queue-notice .nfq-dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:#1F1F1F;border:1px solid #2E2E2E;border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.45);pointer-events:auto}',
        '#novaflow-queue-notice .nfq-hd{display:flex;align-items:center;gap:8px;padding:14px 12px 0 16px}',
        '#novaflow-queue-notice .nfq-hd b{font-size:14px;font-weight:600;color:#fff}',
        '#novaflow-queue-notice .nfq-label{flex:1;min-width:0;color:#9a9a9a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '#novaflow-queue-notice .nfq-bd{padding:10px 16px 16px}',
        '#novaflow-queue-notice .nfq-line{margin:0 0 12px;font-size:13px;color:rgba(255,255,255,.86)}',
        '#novaflow-queue-notice .nfq-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
        '#novaflow-queue-notice .nfq-stats>div{padding:8px 10px;border-radius:6px;background:#262626}',
        '#novaflow-queue-notice .nfq-stats span{display:block;font-size:11px;color:#9a9a9a}',
        '#novaflow-queue-notice .nfq-stats strong{display:block;margin-top:2px;font-size:16px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}',
        '#novaflow-queue-notice .nfq-ft{display:flex;justify-content:flex-end;gap:8px;padding:0 16px 16px}',
        '#novaflow-queue-notice .nfq-ft button{height:30px !important;min-width:76px;padding:0 14px !important;border:0 !important;border-radius:6px !important;background:#2A2A2A !important;color:#e9e9e9 !important;font-size:12px !important;font-weight:500 !important;box-shadow:none !important;outline:none !important;cursor:pointer}',
        '#novaflow-queue-notice .nfq-ft button:hover:not(:disabled){background:#373737 !important;color:#fff !important}',
        '#novaflow-queue-notice .nfq-ft button[data-act="background"]{background:#1EA672 !important;color:#fff !important;font-weight:600 !important}',
        '#novaflow-queue-notice .nfq-ft button[data-act="background"]:hover{background:#22B980 !important}',
        '#novaflow-queue-notice .nfq-ft button:disabled{opacity:.6;cursor:default}',
        '#novaflow-queue-notice .nfq-x{width:24px;height:24px;padding:0;border:0;background:transparent;color:rgba(238,244,252,.6);font-size:16px;line-height:24px;cursor:pointer;outline:none}',
        '#novaflow-queue-notice .nfq-pill{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex !important;align-items:center;gap:8px;height:30px !important;padding:0 14px !important;border:1px solid #2E2E2E !important;border-radius:15px !important;background:#1F1F1F !important;color:#e9e9e9 !important;font-size:12px !important;box-shadow:0 6px 18px rgba(0,0,0,.4) !important;outline:none !important;pointer-events:auto;cursor:pointer;white-space:nowrap}',
        '#novaflow-queue-notice .nfq-pill:hover{background:#373737 !important;color:#fff !important}',
        '#novaflow-queue-notice .nfq-pill i{width:6px;height:6px;border-radius:50%;background:#1EA672}'
      ].join('\n');
      doc.head.appendChild(style);
    }
    const box = doc.createElement('div');
    box.id = 'novaflow-queue-notice';
    box.hidden = true;
    box.innerHTML = '<div class="nfq-mask" data-act="background"></div>'
      + '<div class="nfq-dialog" role="dialog" aria-label="排队中">'
      + '<div class="nfq-hd"><b>排队中</b><span class="nfq-label"></span><button type="button" class="nfq-x" data-act="background" title="后台等待">×</button></div>'
      + '<div class="nfq-bd"><p class="nfq-line"></p><div class="nfq-stats">'
      + '<div><span>已等</span><strong class="nfq-waited"></strong></div>'
      + '<div><span>预计还要</span><strong class="nfq-eta"></strong></div></div></div>'
      + '<div class="nfq-ft"><button type="button" data-act="cancel">取消排队</button><button type="button" data-act="background">后台等待</button></div>'
      + '</div>'
      + '<button type="button" class="nfq-pill" data-act="front" title="查看排队"><i></i><span class="nfq-pill-text"></span></button>';
    box.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      const key = box.dataset.key;
      const wait = key && waits.get(key);
      if (!act || !wait) return;
      if (act === 'background') wait.background = true;
      if (act === 'front') wait.background = false;
      if (act === 'cancel') {
        const button = event.target.closest('button');
        button.disabled = true;
        button.textContent = '正在取消…';
        Promise.resolve().then(() => wait.cancel && wait.cancel()).catch(() => {}).then(() => {
          button.disabled = false;
          button.textContent = '取消排队';
          endWait(key);
        });
        return;
      }
      renderQueue();
    });
    doc.body.appendChild(box);
    queueRoot = box;
    return box;
  }

  function renderQueue() {
    const now = Date.now();
    for (const [key, wait] of waits) if (!wait.external && now - wait.seen > QUEUE_STALE_MS) waits.delete(key);
    // The longest wait is the one shown; the others take their turn when it ends.
    let key = '';
    let wait = null;
    for (const [k, w] of waits) if (now - w.since >= QUEUE_SHOW_AFTER_MS && (!wait || w.since < wait.since)) { key = k; wait = w; }
    if (waits.size && !queueTimer) queueTimer = setInterval(renderQueue, 1000);
    if (!waits.size && queueTimer) { clearInterval(queueTimer); queueTimer = 0; }
    if (!wait) { if (queueRoot) queueRoot.hidden = true; return; }
    const box = ensureQueueRoot();
    if (!box) return;
    const text = queueTexts(wait, now);
    box.dataset.key = key;
    box.dataset.view = wait.background ? 'pill' : 'dialog';
    box.querySelector('.nfq-label').textContent = wait.label || '';
    box.querySelector('.nfq-line').textContent = text.line;
    box.querySelector('.nfq-waited').textContent = text.waited;
    box.querySelector('.nfq-eta').textContent = text.eta;
    box.querySelector('[data-act="cancel"]').style.display = typeof wait.cancel === 'function' ? '' : 'none';
    box.querySelector('.nfq-pill-text').textContent = '排队中 · 已等 ' + text.waited + ' · 预计 ' + text.eta;
    box.hidden = false;
  }

  root.NovaFlowQueueNotice = {
    /** A wait that is not a task: { label, ahead, workers, eta (seconds), onCancel }. Call again to update. */
    wait(key, info) {
      noteWait('x:' + key, Object.assign({}, info || {}, { external: true, cancel: info && info.onCancel }));
    },
    done(key) { endWait('x:' + key); },
    state() { return [...waits.entries()].map(([key, w]) => Object.assign({ key }, w)); }
  };

  async function control(method, path, body, options) {
    const taskId = /^\/api\/web\/tasks\/([^/]+)/.exec(path)?.[1];
    const recoveryMode=options?.assistantRecoveryMode;
    if(recoveryMode!==undefined&&(recoveryMode!=='shared'||method!=='GET'||!/^\/api\/web\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(path)))throw Error('Invalid assistant recovery route');
    const mode = recoveryMode==='shared' ? 'shared' : taskModes.get(taskId) || taskMode();
    const isCompute = /^\/api\/web\/(tasks|capabilities|workers|loras)(?:[/?]|$)/.test(path);
    if (mode === 'shared' && computeNode) {
      if (path === '/api/web/tasks' && method === 'POST' && body?.art_image_binding_scope !== 'art-image-binding-v1') body = Object.assign({}, body || {}, { target_worker_id: computeNode.id });
      if (/^\/api\/web\/capabilities(?:\?|$)/.test(path)) path += (path.includes('?') ? '&' : '?') + 'worker=' + encodeURIComponent(computeNode.id);
    }
    const value = mode === 'local' && isCompute ? await localControl(method, path, body) : await api(CONFIG.controlUrl, method, path, body);
    if (path === '/api/web/tasks' && method === 'POST' && value.task) taskModes.set(value.task.id, mode);
    if (value && value.task) observeTask(value.task);
    if (value && Array.isArray(value.tasks)) value.tasks.forEach(readQueueNote);
    return value;
  }
  // Background, opt-in, method-only upload. The rollout flag stays false until
  // cloud acceptance; no feedback or generation call waits for this network work.
  const auth = (method, path, body, timeoutMs) => api(CONFIG.authUrl, method, path, body, timeoutMs);
  // Grok reads reference frames for 反推 and 多参 compiles; the 20 s that suits a credit read is what
  // used to end those with "signal timed out".
  const SMART_AI_TIMEOUT_MS = 180000;

  // Online 小桃 always uses the metered RunningHub companion. The hold is an
  // estimate; the charge is settled from provider usage. Local chat never comes here.
  const companionCloudRequests = new Map();
  const companionCloudUsed = new Set();
  async function companionPricing() {
    if (!currentSession()?.token) return {ok:false,error:'请先登录 Foart 后查看在线积分价格'};
    try {
      const base = CONFIG.companionUrl || CONFIG.authUrl.replace(/\/novaflow-backend\/?$/, '/novaflow-companion');
      const result = await api(base, 'GET', '/api/web/companion/pricing');
      return result?.ok === true && result.policy ? result : {ok:false,error:'在线积分价格暂不可用'};
    } catch (error) {return {ok:false,error:String(error.message || error)};}
  }
  async function companionCloudChat(payload = {}) {
    const id = payload.requestId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(id) || !['chat','foart'].includes(payload.mode)
      || typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 12000)
      return { ok: false, error: '小桃AI对话请求格式无效' };
    const operationV3=payload.operationBillingV3===true;
    const visionV3=operationV3 && payload.operationVisionBillingV3===true;
    // A trusted pricing policy can separately opt in to image-only chat.
    // Never fall back to the legacy billed route for tools, time media, or
    // editor context when the operation contract was selected.
    if(operationV3 && (payload.mode!=='chat' || !payload.modelId || payload.modelId!==payload.expectedModelId ||
      (Array.isArray(payload.images)&&payload.images.length&&!visionV3) ||
      (Array.isArray(payload.uploads)&&payload.uploads.some(item=>item?.kind!=='image')) ||
      (Array.isArray(payload.uploads)&&payload.uploads.length>(Array.isArray(payload.images)?payload.images.length:0)) ||
      (payload.artContext && Object.keys(payload.artContext).length)))
      return {ok:false,providerSubmitted:false,errorCode:'operation-text-only',error:'当前操作级计费尚不支持此次工具、媒体或作品上下文，本次未提交。'};
    if (companionCloudRequests.size) return { ok: false, error: '小桃AI正在回复，请等待当前对话完成' };
    if (companionCloudUsed.has(id) || companionCloudUsed.size >= 1024)
      return { ok: false, error: '这次对话已发送，请刷新后使用新的请求编号' };
    if(payload.images!==undefined&&(!Array.isArray(payload.images)||payload.images.length>3))return {ok:false,error:'一次最多分析三张完整图片'};
    const foartImages=payload.mode==='foart'&&Array.isArray(payload.images)&&payload.images.length>0;
    const guardedImages=foartImages||(visionV3&&Array.isArray(payload.images)&&payload.images.length>0);
    const requestImages=guardedImages?await Promise.all(payload.images.map(async image=>image&&Object.freeze({...image,dataUrl:await onlineVisionImage(image.dataUrl,payload.images.length)}))):payload.images||[];
    const imageSessionGuard=guardedImages?payload.imageSessionGuard:null;
    if(guardedImages&&(typeof payload.confirmImageUpload!=='function'||typeof imageSessionGuard!=='function'))
      return {ok:false,providerSubmitted:false,errorCode:'assistant-business-consent-unavailable',error:'参考图片上传确认不可用，未提交。'};
    const safeImageCurrent=()=>{if(!guardedImages)return true;try{return imageSessionGuard()===true;}catch{return false;}};
    const history = payload.history || [];
    if (!Array.isArray(history) || history.length > 12 || history.some(item => !item
      || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 12000))
      return { ok: false, error: '小桃AI的文字对话历史无效' };
    const context = {};
    for (const key of ['surface', 'mode', 'width', 'height', 'prompt', 'negativePrompt', 'task']) {
      const value = payload.artContext?.[key];
      if (typeof value === 'string') context[key] = value.slice(0, key === 'prompt' ? 6000 : key === 'negativePrompt' ? 3000 : 120);
      else if (typeof value === 'number' && Number.isFinite(value)) context[key] = value;
    }
    const uploads = Array.isArray(payload.uploads) ? payload.uploads.filter(file => file && ['image', 'video', 'audio'].includes(file.kind)).slice(0, 16) : [];
    if ([...history.map(item => item.content), payload.message].join('\n').length > 24000)
      return { ok: false, error: '小桃AI的文字上下文过长，请发送“新对话”后重试，或缩短需求' };
    if (!currentSession()?.token) return { ok: false, error: '请先登录 Foart 后使用小桃AI云端AI' };
    if ((!/^sha256:[a-f0-9]{64}$/.test(payload.pricingVersion || '') || !Number.isFinite(payload.pricingExpiresAt) || Date.now() >= payload.pricingExpiresAt))
      return {ok:false,errorCode:'companion-pricing-changed',error:'在线积分价格已过期，请刷新价格后重新发送；本次未扣积分'};
    const accountOwner=operationV3?captureFoartBillingOwner():null;
    if(operationV3&&(!accountOwner||!accountOwner.current()))return {ok:false,providerSubmitted:false,errorCode:'assistant-selection-unavailable',error:'无法确认当前账户，操作未提交。'};
    const controller = new AbortController();let providerSubmitted=false,chatRecovery=null;
    const onFoartSessionChange=()=>controller.abort();
    if(guardedImages)foartSessionObservers.add(onFoartSessionChange);
    let timer;
    companionCloudUsed.add(id); companionCloudRequests.set(id, controller);
    try {
      const base = CONFIG.companionUrl || CONFIG.authUrl.replace(/\/novaflow-backend\/?$/, '/novaflow-companion');
      if(guardedImages){
        if(!safeImageCurrent()||controller.signal.aborted)throw Object.assign(Error('会话或参考素材已变，未上传图片。'),{code:'assistant-selection-changed'});
        const accepted=await payload.confirmImageUpload({count:requestImages.length,images:requestImages});
        if(!safeImageCurrent()||controller.signal.aborted)throw Object.assign(Error('会话或参考素材已变，未上传图片。'),{code:'assistant-selection-changed'});
        if(accepted!==true)throw Object.assign(Error('已取消图片上传，未提交。'),{code:'assistant-business-upload-declined'});
      }
      timer = setTimeout(() => controller.abort(), guardedImages?150000:125000);
      const request = {
        requestId: id, mode: payload.mode, promptLanguage: payload.promptLanguage, message: payload.message,
        ...(payload.modelId != null ? {modelId: payload.modelId} : {}),
        history, images: requestImages, uploads, artContext: context,
        ...(payload.mode==='foart'?{foartContext:payload.foartContext}:{})
      };
      let chatRequest=request, pricingQuote=null;
      {
        // User has explicitly submitted this message. Quote the same payload on
        // our own service first; this does not invoke a model or reserve credits.
        if(!safeImageCurrent()||controller.signal.aborted)throw Object.assign(Error('会话或参考素材已变，未上传图片。'),{code:'assistant-selection-changed'});
        const quoted = await api(base, 'POST', '/api/web/companion/quote', request, 65000, controller.signal);
        if(!safeImageCurrent()||controller.signal.aborted)throw Object.assign(Error('会话或参考素材已变，未提交模型请求。'),{code:'assistant-selection-changed'});
        if (quoted?.ok !== true || quoted.quote?.pricingVersion !== payload.pricingVersion || quoted.quote?.modelId !== payload.expectedModelId || !/^sha256:[a-f0-9]{64}$/.test(quoted.quote?.quoteFingerprint || '') || !validCreditAmount(quoted.quote?.estimatedCredits,operationV3))
          throw Object.assign(Error('在线积分价格已变化，请刷新价格后重新发送；本次未扣积分'),{code:'companion-pricing-changed'});
        if (Date.now() >= payload.pricingExpiresAt) throw Object.assign(Error('在线积分价格已过期，请刷新价格后重新发送；本次未扣积分'),{code:'companion-pricing-changed'});
        if(controller.signal.aborted)throw Error('请求已停止');
        pricingQuote={requestId:id,estimatedCredits:quoted.quote.estimatedCredits};
        if(typeof payload.onPricingQuote==='function')payload.onPricingQuote(pricingQuote);
        chatRequest={...request,pricingVersion:payload.pricingVersion,quoteFingerprint:quoted.quote.quoteFingerprint};
      }
      if(!safeImageCurrent()||controller.signal.aborted)throw Object.assign(Error('会话或参考素材已变，未提交模型请求。'),{code:'assistant-selection-changed'});
      let result;
      if(operationV3){
        if(typeof root.crypto?.randomUUID!=='function')throw Object.assign(Error('操作级计费尚不可用，本次未提交。'),{code:'operation-billing-disabled'});
        if(!accountOwner.current())throw Object.assign(Error('登录会话已变化，本次未提交。'),{code:'assistant-selection-changed'});
        const intent={mode:'chat',requestId:id,message:payload.message,history,...(payload.promptLanguage!==undefined?{promptLanguage:payload.promptLanguage}:{}),
          ...(guardedImages?{images:requestImages.map(({dataUrl,role,source})=>({dataUrl,...(role!==undefined?{role}:{}),...(source!==undefined?{source}:{})}))}:{})};
        const prepared=await api(base,'POST','/api/web/companion/operation/prepare',{nonce:root.crypto.randomUUID(),model:payload.expectedModelId,intent},65000,controller.signal);
        const op=prepared?.operation;chatRecovery={base,operationId:op?.operationId,quote:pricingQuote};
        if(prepared?.ok!==true||op?.model!==payload.expectedModelId||op?.policyVersion!==payload.pricingVersion||!validOperationId(op?.operationId)||typeof op?.token!=='string'||op.token.length>4096)
          throw Object.assign(Error('操作级计费信息不匹配，本次未提交。'),{code:'companion-pricing-changed'});
        if(controller.signal.aborted||Date.now()>=payload.pricingExpiresAt)throw Object.assign(Error('在线积分价格已过期，本次未提交。'),{code:'companion-pricing-changed'});
        if(!accountOwner.current()||controller.signal.aborted)throw Object.assign(Error('登录会话已变化，本次未提交。'),{code:'assistant-selection-changed'});
        providerSubmitted=true;
        result=await api(base,'POST','/api/web/companion/operation/execute',{operationToken:op.token,intent},65000,controller.signal);
        if(!accountOwner.current())throw Object.assign(Error('登录会话已变化，本次结果未显示。'),{code:'assistant-selection-changed'});
        const receipt=result?.receipt;
        if(receipt?.status!=='settled'||!['success','cancel'].includes(receipt.outcome)||!validCreditAmount(receipt.charged,true)||
          !validCreditAmount(receipt.uncollected,true))
          throw Object.assign(Error(ONLINE_RESULT_UNCONFIRMED),{code:'operation-status-unknown'});
        const quota={status:'settled',settled_credits:receipt.charged,billing_mode:'token',
          ...(pricingQuote?{quote_estimated_credits:pricingQuote.estimatedCredits}:{}),...(receipt.uncollected>0?{uncollected_credits:receipt.uncollected}:{})};
        // A v3 receipt does not contain a balance. Ask the account component
        // to refresh it rather than deriving one from the charge.
        notifyAccountBalance(undefined,'companion-operation');
        if(result.ok!==true||receipt.outcome!=='success'||receipt.uncollected>0){
          return {ok:false,providerSubmitted:true,billingConfirmed:true,data:{quota},errorCode:result.errorCode||'operation-incomplete',
            error:receipt.uncollected>0?incompleteSettlementMessage(receipt):receipt.charged===0&&result.errorCode==='provider-failed'?ONLINE_MODEL_NO_ANSWER:'本次回复未完成，已按实际用量结算。'};
        }
        result={...result,quota};
      } else {
        providerSubmitted=true;
        result=await api(base, 'POST', '/api/web/companion/chat', chatRequest, 65000, controller.signal);
      }
      if(!safeImageCurrent())throw Object.assign(Error('会话或参考素材已变化，本次结果未显示。'),{code:'assistant-selection-changed'});
      if (result?.ok !== true || typeof result.reply !== 'string' || !result.reply.trim()) throw Error('在线回复未完成，本次未自动重试');
      const hasMedia = Boolean(payload.images?.length || uploads.length);
      return { ok: true, data: { mode: payload.mode, provider: 'api', reply: result.reply,...(result.toolPlan?{toolPlan:result.toolPlan}:{}),
        conversationId: typeof payload.conversationId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(payload.conversationId) ? payload.conversationId : root.crypto.randomUUID(),
        history: [...history, { role: 'user', content: payload.message }, { role: 'assistant', content: result.reply }].slice(-12),
        model: result.model || '云端API', toolTrace: [], capabilities: { textOnly: !hasMedia, vision: hasMedia, tools: payload.mode==='foart' },
        ...(result.billingSample ? {billingSample:result.billingSample} : {}), quota: pricingQuote ? {...result.quota,quote_estimated_credits:pricingQuote.estimatedCredits} : result.quota } };
    } catch (error) {
      if(operationV3&&providerSubmitted){
        const closed=validOperationId(chatRecovery?.operationId)?await settledOperation(chatRecovery.base,chatRecovery.operationId,()=>accountOwner.current()===true,true,payload.signal?.aborted?[0]:undefined):null;
        if(closed){
          notifyAccountBalance(undefined,'companion-operation');
          return {ok:false,providerSubmitted:true,billingConfirmed:true,data:{quota:{status:'settled',settled_credits:closed.charged,billing_mode:'token',...(chatRecovery.quote?{quote_estimated_credits:chatRecovery.quote.estimatedCredits}:{})}},errorCode:'operation-incomplete',error:closed.charged===0?ONLINE_MODEL_NO_ANSWER:'本次回复未完成，已按实际用量结算。'};
        }
        return {ok:false,providerSubmitted:true,billingUnknown:true,errorCode:error.code||'operation-status-unknown',error:ONLINE_RESULT_UNCONFIRMED};
      }
      return { ok: false, ...((guardedImages||operationV3)&&!providerSubmitted?{providerSubmitted:false}:{}), ...(error.code ? {errorCode:error.code} : {}), error: controller.signal.aborted ? ((!guardedImages&&!operationV3)||providerSubmitted?'本次在线回复等待已结束；用量以服务器实际结算为准':'本次请求已停止，尚未提交模型。') : String(error.message || error) };
    }
    finally { clearTimeout(timer); companionCloudRequests.delete(id);if(guardedImages)foartSessionObservers.delete(onFoartSessionChange); }
  }
  function stopCompanionCloud(payload = {}) {
    const operation = companionCloudRequests.get(payload.requestId);
    if (!operation) return { ok: true, idle: true };
    operation.abort();
    return { ok: true, waitingCancelled: true, providerRequestAlreadySent: true };
  }

  // Foart operation-level billing is default closed and requires an explicit
  // server policy. Session handles are opaque, in-memory and account-bound;
  // neither tickets nor project snapshots are written to browser storage.
  const foartOperationSessions = new WeakMap();
  // Staged candidate only: a separate release gate must explicitly enable it.
  function foartOperationCopy(value) {
    const json=JSON.stringify(value);
    if(typeof json!=='string'||json.length>60000||/data:(?:image|audio|video)\//i.test(json))throw Error('操作上下文无效或含未开放的媒体');
    const copy=JSON.parse(json),stack=[[copy,'',0]];
    while(stack.length){const [item,key,depth]=stack.pop();if(depth>64)throw Error('操作上下文无效');
      if(typeof item==='string'&&(/^data:/i.test(item)||(/^(?:dataUrl|imageUrl|previewUrl|blob|bytes)$/i.test(key)&&item)))throw Error('操作上下文含未开放的媒体');
      if(item&&typeof item==='object')for(const [name,child] of Object.entries(item))stack.push([child,name,depth+1]);}
    return copy;
  }
  function foartOperationPolicy(policy,version,expiresAt,context) {
    const p=policy?.config?.xiaotao_online;
    return policy?.version===version && /^sha256:[a-f0-9]{64}$/.test(version||'') &&
      Number.isFinite(expiresAt)&&Date.now()<expiresAt&&Number.isFinite(policy?.expiresAt)&&Date.now()<policy.expiresAt&&
      operationCreditPolicy(p)&&p.operation_text_chat_v3===true&&
      p.operation_foart_general_v3===true;
  }
  function foartOperationHandle(record,continuationToken,previousContext,state='pending') {
    const handle=Object.freeze({});
    foartOperationSessions.set(handle,{...record,continuationToken,previousContext:foartOperationCopy(previousContext),state});
    return handle;
  }
  function foartOperationQuota(receipt,quote,terms) {
    if(receipt?.status!=='settled'||!['success','cancel'].includes(receipt.outcome)||
      !validCreditAmount(receipt.charged,decimalCreditPolicy(terms))||!validCreditAmount(receipt.uncollected,decimalCreditPolicy(terms)))return null;
    return {status:'settled',settled_credits:receipt.charged,billing_mode:'token',
      ...(quote?{quote_estimated_credits:quote.estimatedCredits}:{}),...(receipt.uncollected>0?{uncollected_credits:receipt.uncollected}:{})};
  }
  // A settled provider result is still untrusted input, not authorization to
  // edit. Bind a narrowly scoped idle-animation draft to the captured editor
  // snapshot; the editor must separately preview and require a trusted click.
  function foartOperationAction(plan) {
    if(plan?.schema!=='nf.foart.tool-plan.v1'||plan.status!=='act'||typeof plan.reply!=='string'||!plan.reply.trim()||plan.reply.length>4000||
      !Array.isArray(plan.operations)||plan.operations.length!==1)return null;
    const op=plan.operations[0];
    return op&&typeof op==='object'&&!Array.isArray(op)&&typeof op.action==='string'&&op.action?{kind:'tool',surface:'tools'}:null;
  }
  // Receipts go back to the planner: no media bytes, and earlier steps stay
  // visible so the model never repeats work it already finished.
  function foartToolReceipt(incoming,steps) {
    const media=/^(?:dataUrl|imageUrl|previewUrl|blob|bytes|context)$/i;
    const clean=value=>JSON.parse(JSON.stringify(value,(key,item)=>media.test(key)||typeof item==='string'&&/^data:/i.test(item)?undefined:item)??'null');
    const brief=row=>({...(typeof row?.action==='string'?{action:row.action}:{}),...(typeof row?.phase==='string'?{phase:row.phase}:{}),...(typeof row?.message==='string'?{message:row.message.slice(0,300)}:{})});
    const latest=clean(incoming),earlierSteps=steps.slice(-8),full={...latest,earlierSteps};
    return {receipt:JSON.stringify(full).length<=2600?full:{...brief(latest),earlierSteps},step:brief(latest)};
  }
  function foartOperationResult(result,record,previousContext) {
    const quota=foartOperationQuota(result?.receipt||result,record.quote,record.creditTerms);
    if(quota){
      notifyAccountBalance(undefined,'companion-operation');
      if(result?.ok!==true||(result.receipt||result).outcome!=='success'||(result.receipt||result).uncollected>0)
        return {ok:false,providerSubmitted:true,billingConfirmed:true,data:{quota},errorCode:result?.errorCode||'operation-incomplete',planIssue:String(result?.planIssue||'').slice(0,200),error:(result.receipt||result).uncollected>0?incompleteSettlementMessage(result.receipt||result):result?.errorCode==='provider-failed'?ONLINE_MODEL_NO_ANSWER:'操作未完成。'};
      return {ok:true,data:{toolPlan:result.toolPlan,quota}};
    }
    const plan=result?.toolPlan,action=foartOperationAction(plan);
    if(result?.ok===true&&result?.billing?.status==='pending'&&action&&typeof result.continuationToken==='string'&&result.continuationToken.length<=4096&&
      Number.isSafeInteger(result.sequence)&&result.sequence>=1&&result.sequence<14){
      const session=foartOperationHandle({...record,sequence:result.sequence,surface:action.surface,actionKind:action.kind},result.continuationToken,previousContext);
      return {ok:true,data:{toolPlan:plan,foartOperationSession:session}};
    }
    throw Object.assign(Error(ONLINE_RESULT_UNCONFIRMED),{code:'operation-status-unknown'});
  }
  // The answer never arrived but the server closed the operation: report what it settled.
  async function foartClosedOperation(record,signal) {
    const closed=await settledOperation(record.base,record.operationId,record.guard,decimalCreditPolicy(record.creditTerms),signal?.aborted?[0]:undefined);
    const quota=closed&&foartOperationQuota({status:'settled',outcome:closed.outcome,charged:closed.charged,uncollected:closed.uncollected??0},record.quote,record.creditTerms);
    if(!quota)return null;
    notifyAccountBalance(undefined,'companion-operation');
    return {ok:false,providerSubmitted:true,billingConfirmed:true,data:{quota},errorCode:'provider-failed',error:closed.charged===0?ONLINE_MODEL_NO_ANSWER:'在线请求中断，本次未完成，可以再试一次。'};
  }
  function foartOperationRequest(id,signal,guard) {
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(id)||companionCloudRequests.size||companionCloudUsed.has(id)||companionCloudUsed.size>=1024)
      throw Object.assign(Error('请求已发送或另一操作正在运行。'),{code:'operation-busy'});
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener?.('abort',abort,{once:true});
    foartSessionObservers.add(abort);
    const timer=setTimeout(abort,125000),expiryTimer=Number.isFinite(guard.expiresAtMs)?setTimeout(abort,Math.min(2147483647,Math.max(1,guard.expiresAtMs-Date.now()))):null;
    companionCloudUsed.add(id);companionCloudRequests.set(id,controller);
    return {controller,close(){clearTimeout(timer);if(expiryTimer!==null)clearTimeout(expiryTimer);foartSessionObservers.delete(abort);signal?.removeEventListener?.('abort',abort);companionCloudRequests.delete(id);}};
  }
  const FOART_OPERATION_MESSAGES={'foart-operation-unsupported':'小桃这次没有给出可执行的操作，请换个说法再试。','foart-media-consent-required':'本次请求夹带了图片数据，未提交。','operation-planner-incomplete':'小桃没有给出完整的操作方案，请再试一次。','phase-limit':'这次操作步骤太多，请拆开分几次说。','operation-model-unavailable':'所选模型暂不可用。','operation-pricing-unavailable':'价格已变化，请重新发送。'};
  const foartOperationMessage=error=>FOART_OPERATION_MESSAGES[error?.code]||FOART_OPERATION_MESSAGES[error?.message]||String(error?.message||'操作未提交。');
  async function foartOperationStart(payload={}) {
    const guard=captureFoartSessionGuard(),accountOwner=captureFoartBillingOwner();
    if(typeof guard!=='function'||!guard()||!accountOwner?.current?.())return {ok:false,providerSubmitted:false,errorCode:'assistant-selection-unavailable',error:'登录会话不可用，操作未提交。'};
    let request,record,providerSubmitted=false,session;
    try {
      if(!isXiaotaoOnlineModel(payload.modelId)||(payload.mode!==undefined&&payload.mode!=='foart')||(payload.provider!==undefined&&payload.provider!=='api')||
        (payload.expectedModelId!==undefined&&payload.expectedModelId!==payload.modelId)||
        ['images','uploads','attachments','files'].some(key=>payload[key]!=null&&(!Array.isArray(payload[key])||payload[key].length>0))||
        (payload.artContext!=null&&(typeof payload.artContext!=='object'||Array.isArray(payload.artContext)||Object.keys(payload.artContext).length>0))||
        payload.audioDataUrl||payload.videoDataUrl||typeof payload.message!=='string'||!payload.message.trim()||payload.message.length>12000||
        !Array.isArray(payload.history)||payload.history.length>12||payload.history.some(x=>!x||!['user','assistant'].includes(x.role)||typeof x.content!=='string'||x.content.length>12000)||
        (payload.promptLanguage!==undefined&&typeof payload.promptLanguage!=='string')||typeof root.crypto?.randomUUID!=='function')throw Error('操作参数无效');
      const initialContext=foartOperationCopy(payload.foartContext);
      if(initialContext?.schema!=='nf.foart.tool-plan.v1'||!Array.isArray(initialContext.controls))throw Error('操作上下文无效');
      const originalIntent=foartOperationCopy({message:payload.message,history:payload.history,...(payload.promptLanguage!==undefined?{promptLanguage:payload.promptLanguage}:{})});
      request=foartOperationRequest(payload.requestId,payload.signal,guard);
      const policy=await companionPricing();
      if(!guard()||request.controller.signal.aborted)throw Object.assign(Error('登录会话已变化，未提交操作。'),{code:'assistant-selection-changed'});
      if(!foartOperationPolicy(policy?.policy,payload.pricingVersion,payload.pricingExpiresAt,initialContext)||!policy.policy.models?.some(x=>x.id===payload.modelId&&x.available===true))
        throw Object.assign(Error('操作级计费尚未开通或报价已变化，未提交。'),{code:'operation-billing-disabled'});
      const base=CONFIG.companionUrl||CONFIG.authUrl.replace(/\/novaflow-backend\/?$/,'/novaflow-companion');
      const quoteRequest={requestId:payload.requestId,mode:'foart',modelId:payload.modelId,...originalIntent,foartContext:initialContext,images:[],uploads:[],artContext:{}};
      const quoted=await api(base,'POST','/api/web/companion/quote',quoteRequest,65000,request.controller.signal),quote=quoted?.quote;
      if(!guard()||request.controller.signal.aborted||Date.now()>=payload.pricingExpiresAt)throw Object.assign(Error('会话或报价已变化，未提交操作。'),{code:'assistant-selection-changed'});
      if(quoted?.ok!==true||quote?.pricingVersion!==payload.pricingVersion||quote?.modelId!==payload.modelId||
        !/^sha256:[a-f0-9]{64}$/.test(quote?.quoteFingerprint||'')||!validCreditAmount(quote?.estimatedCredits,decimalCreditPolicy(policy.policy.config.xiaotao_online)))
        throw Object.assign(Error('操作报价不可用，未提交。'),{code:'companion-pricing-changed'});
      const pricingQuote={requestId:payload.requestId,estimatedCredits:quote.estimatedCredits};
      if(typeof payload.onPricingQuote==='function')payload.onPricingQuote(pricingQuote);
      if(!guard()||request.controller.signal.aborted)throw Object.assign(Error('会话已变化，未提交操作。'),{code:'assistant-selection-changed'});
      const prepared=await api(base,'POST','/api/web/companion/operation/foart/prepare',{nonce:root.crypto.randomUUID(),model:payload.modelId,originalIntent,initialContext},65000,request.controller.signal);
      if(prepared?.ok!==true||prepared.model!==payload.modelId||prepared.policyVersion!==payload.pricingVersion||!validOperationId(prepared.operationId)||typeof prepared.token!=='string'||prepared.token.length>4096)
        throw Object.assign(Error('操作票据与报价不一致，未提交。'),{code:'companion-pricing-changed'});
      if(!guard()||!accountOwner.current())throw Object.assign(Error('登录会话已变化，未提交操作。'),{code:'assistant-selection-changed'});
      record={base,guard,operationId:prepared.operationId,modelId:payload.modelId,originalIntent,initialContext,operationToken:prepared.token,quote:pricingQuote,
        creditTerms:policy.policy.config.xiaotao_online,
      };
      session=foartOperationHandle(record,'',initialContext,'unknown');
      if(!guard()||request.controller.signal.aborted||Date.now()>=payload.pricingExpiresAt)throw Object.assign(Error('会话或报价已变化，未提交操作。'),{code:'assistant-selection-changed'});
      providerSubmitted=true;
      const result=await api(base,'POST','/api/web/companion/operation/foart/start',{operationToken:record.operationToken,originalIntent,initialContext},65000,request.controller.signal);
      if(!guard())throw Object.assign(Error('登录会话已变化，本次结果未显示。'),{code:'assistant-selection-changed'});
      return foartOperationResult(result,record,initialContext);
    } catch(error) {
      const known=FOART_OPERATION_MESSAGES[error?.code]||FOART_OPERATION_MESSAGES[error?.message];
      const closed=providerSubmitted&&record&&!known?await foartClosedOperation(record,payload.signal):null;
      if(closed)return closed;
      return {ok:false,providerSubmitted,billingUnknown:providerSubmitted,...(providerSubmitted&&session?{session}:{}),errorCode:error?.code||'operation-unavailable',error:providerSubmitted?(known||ONLINE_RESULT_UNCONFIRMED):foartOperationMessage(error)};
    } finally {request?.close();}
  }
  async function foartOperationResume(payload={}) {
    const record=payload.session&&foartOperationSessions.get(payload.session);
    if(!record||record.state!=='pending')return {ok:false,providerSubmitted:false,errorCode:'operation-session-unavailable',error:'操作会话不可用。'};
    if(!record.guard())return {ok:false,providerSubmitted:false,billingUnknown:true,session:payload.session,errorCode:'operation-session-unavailable',error:'登录会话已变化，本次结果未显示。'};
    let request,providerSubmitted=false;
    try {
      const previousContext=foartOperationCopy(payload.previousContext),context=foartOperationCopy(payload.context),incoming=payload.receipt;
      if(JSON.stringify(previousContext)!==JSON.stringify(record.previousContext))throw Object.assign(Error('操作状态已变化，未提交下一步。'),{code:'assistant-selection-changed'});
      let receipt;
      if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw Object.assign(Error('工具回执无效，未提交下一步。'),{code:'assistant-selection-changed'});
      const checked=foartToolReceipt(incoming,record.steps||[]);receipt=checked.receipt;record.steps=[...(record.steps||[]),checked.step];
      request=foartOperationRequest(payload.requestId,payload.signal,record.guard);record.state='inflight';
      if(!record.guard()||request.controller.signal.aborted)throw Object.assign(Error('登录会话已变化，未提交下一步。'),{code:'assistant-selection-changed'});
      providerSubmitted=true;
      const result=await api(record.base,'POST','/api/web/companion/operation/foart/resume',{operationToken:record.operationToken,originalIntent:record.originalIntent,
        initialContext:record.initialContext,previousContext:record.previousContext,continuationToken:record.continuationToken,receipt,context},65000,request.controller.signal);
      if(!record.guard())throw Object.assign(Error('登录会话已变化，本次结果未显示。'),{code:'assistant-selection-changed'});
      const value=foartOperationResult(result,record,context);record.state='closed';return value;
    } catch(error) {
      record.state=providerSubmitted?'unknown':'pending';
      const known=FOART_OPERATION_MESSAGES[error?.code]||FOART_OPERATION_MESSAGES[error?.message];
      const closed=providerSubmitted&&!known?await foartClosedOperation(record,payload.signal):null;
      if(closed){record.state='closed';return closed;}
      return {ok:false,providerSubmitted,billingUnknown:true,session:payload.session,errorCode:error?.code||'operation-unavailable',error:providerSubmitted?(known||ONLINE_RESULT_UNCONFIRMED):foartOperationMessage(error)};
    } finally {request?.close();}
  }
  async function foartOperationCancel(payload={}) {
    const record=payload.session&&foartOperationSessions.get(payload.session);
    if(!record||!['pending','unknown'].includes(record.state))return {ok:false,providerSubmitted:false,errorCode:'operation-session-unavailable',error:'操作会话不可用。'};
    if(!record.guard())return {ok:false,billingUnknown:true,session:payload.session,errorCode:'operation-session-unavailable',error:'登录会话已变化，本次结果未显示。'};
    if(companionCloudRequests.size)return {ok:false,billingUnknown:true,session:payload.session,errorCode:'operation-busy',error:'操作仍在处理中。'};
    let request;
    try {
      if(typeof root.crypto?.randomUUID!=='function')throw Error('操作不可用');
      request=foartOperationRequest('cancel_'+root.crypto.randomUUID(),null,record.guard);record.state='inflight';
      if(!record.guard()||request.controller.signal.aborted)throw Error('会话已变化');
      const result=await api(record.base,'POST','/api/web/companion/operation/foart/cancel',{operationToken:record.operationToken,originalIntent:record.originalIntent,initialContext:record.initialContext},65000,request.controller.signal);
      if(!record.guard())throw Error('会话已变化');
      const quota=foartOperationQuota(result,record.quote,record.creditTerms);
      if(!quota)throw Error('操作状态未知');
      record.state='closed';notifyAccountBalance(undefined,'companion-operation');
      if(result.uncollected>0)return {ok:false,billingConfirmed:true,data:{quota},errorCode:'operation-incomplete',error:incompleteSettlementMessage(result)};
      return {ok:true,billingConfirmed:true,data:{quota}};
    } catch(error){record.state='unknown';return {ok:false,billingUnknown:true,session:payload.session,errorCode:'operation-status-unknown',error:ONLINE_RESULT_UNCONFIRMED};}
    finally{request?.close();}
  }

  // ------------------------------------------------------- workflow intents
  //
  // A redacted builder calls serverOnly(); we remember the most recent intent
  // per module so the matching /prompt submission can pick it up. Keyed by
  // module because a panel may prepare one workflow while another is running.
  const intents = new Map();
  // 一键拆图 layers and AI 特效 frames are working material for their panels, not 仓库 entries.
  const splitTasks = new Set();
  let lastIntent = null;

  function recordIntent(intent) {
    const value = {
      module: intent.module,
      method: intent.method || intent.fn,
      options: intent.options,
      at: Date.now()
    };
    intents.set(value.module, value);
    lastIntent = value;
    return value;
  }

  function isIntent(value) {
    if (!value || typeof value !== 'object') return false;
    return value.__novaflowServerOnly === true || value.__novaflowWorkflowIntent === true;
  }

  /** Pull the intent out of whatever the renderer handed to /prompt. */
  function intentFrom(prompt) {
    if (isIntent(prompt)) {
      return {
        module: prompt.module,
        method: prompt.fn || prompt.method,
        options: prompt.options
      };
    }
    if (typeof prompt === 'string') {
      try {
        const parsed = JSON.parse(prompt);
        if (isIntent(parsed)) return intentFrom(parsed);
      } catch (_) { /* not our marker */ }
    }
    // A graph the renderer assembled from redacted pieces still carries the
    // marker somewhere inside it; find the first one.
    if (prompt && typeof prompt === 'object') {
      for (const key of Object.keys(prompt)) {
        const found = intentFrom(prompt[key]);
        if (found) return found;
      }
    }
    return null;
  }

  // ------------------------------------------------------------- task cache
  // ComfyUI's HTTP surface is polled, so the renderer will ask repeatedly for
  // the same task. Cache what the control plane says and let the poll refresh
  // it, rather than turning one ComfyUI poll into two network round trips.
  const tasks = new Map();      // promptId -> task
  const taskOrigins = new Map(); // promptId -> runtime origin it was sent to (8188 drawing, 8189 video)
  const grants = new Map();     // taskId -> download grant
  const uploads = new Map();    // filename -> { taskId, name }
  const pendingUploads = [];
  // Contains only this page session's unfinished guarded H3 submission. In
  // particular, raw reference bytes are never persisted across login/reload.
  let pendingH3Submission = null;
  // Account-specific locks live only in this page. An auth event discards staged
  // bytes, but must not forget an already dispatched request.
  const uncertainH3Owners = new Set();
  foartSessionObservers.add(() => { pendingH3Submission = null; });
  // Scoped art input candidate. An opaque ticket owns immutable bytes for one
  // confirmed action; it never persists in browser storage.
  const artBindingTickets = new WeakMap();
  const ART_BINDING_ROLES = new Set(['auto','subject','style','pose','background','material','color','composition','lighting','object','reference','result','output','attachment']);
  async function artImageBindingAvailable() {
    const guard=captureFoartSessionGuard(),epoch=computeNodeEpoch,nodeId=computeNode?.id||'';
    if (taskMode()!=='shared' || typeof guard!=='function' || !guard()) return false;
    try {
      const caps=await control('GET','/api/web/capabilities');
      return guard() && taskMode()==='shared' && epoch===computeNodeEpoch && nodeId===(computeNode?.id||'') && caps?.features?.artImageBindingV1===true;
    } catch {return false;}
  }
  async function prepareArtImageBinding({references,isCurrent,signal}={}) {
    if (!Array.isArray(references) || references.length<1 || references.length>20 || typeof isCurrent!=='function' ||
        !signal || typeof signal.addEventListener!=='function' || !root.crypto?.subtle || typeof root.crypto.randomUUID!=='function')
      throw new Error('参考图绑定不可用，未提交生成');
    // Capture strings synchronously: caller mutation during a capability
    // request must not change the values for which the user gave approval.
    const snapshot=references.map(item=>Object.freeze({dataUrl:item?.dataUrl,role:item?.role}));
    const guard=captureFoartSessionGuard(),epoch=computeNodeEpoch,nodeId=computeNode?.id||'';
    if (typeof guard!=='function' || !guard()) throw new Error('账户会话不可验证，未提交生成');
    const abort=new AbortController(),stop=()=>abort.abort();let committed=false;
    const dispose=()=>{signal.removeEventListener('abort',stop);foartSessionObservers.delete(stop);
      root.removeEventListener('novaflow:compute-node',stop);root.removeEventListener('pagehide',stop);};
    signal.addEventListener('abort',stop,{once:true});foartSessionObservers.add(stop);
    root.addEventListener('novaflow:compute-node',stop);root.addEventListener('pagehide',stop);
    try {
    const check=()=>{if(signal.aborted || abort.signal.aborted || !guard() || taskMode()!=='shared' || epoch!==computeNodeEpoch || nodeId!==(computeNode?.id||'') || isCurrent()!==true)
      throw new Error('账户或参考图已变化，未继续提交');};
    check();if(!await artImageBindingAvailable())throw new Error('当前节点安全协议尚未启用，未提交生成');check();
    const requestId=String(root.crypto.randomUUID()).toLowerCase();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId))throw new Error('生成标识无效');
    const files=[],refs=[];let total=0;
    for(const [i,item] of snapshot.entries()) {
      check();
      if(!item || typeof item.dataUrl!=='string' || !ART_BINDING_ROLES.has(item.role))throw new Error('参考图角色或内容不支持，未提交生成');
      const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.dataUrl);
      if(!match || match[2].length>Math.ceil(64*1024*1024/3)*4+4)throw new Error('参考图格式或大小无效，未提交生成');
      let binary;try{binary=root.atob(match[2]);}catch{throw new Error('参考图解码失败，未提交生成');}
      if(!binary.length || binary.length>64*1024*1024 || (total+=binary.length)>256*1024*1024)throw new Error('参考图过大，未提交生成');
      const bytes=new Uint8Array(binary.length);for(let j=0;j<binary.length;j++)bytes[j]=binary.charCodeAt(j);
      const digest=await root.crypto.subtle.digest('SHA-256',bytes);check();
      const name=`artbind-${requestId}-${i+1}.${match[1]==='jpeg'?'jpg':match[1]}`;
      refs.push(Object.freeze({name,kind:'image',bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),role:item.role}));
      files.push({bytes,mimeType:'image/'+match[1]});
    }
    const ticket=Object.freeze({});const binding={ticket,taskId:requestId,targetWorkerId:nodeId||null,refs:Object.freeze(refs),files,check,sessionCurrent:guard,signal:abort.signal,dispose,staged:new Set(),submitted:false};
    artBindingTickets.set(ticket,binding);committed=true;return Object.freeze({ticket,names:Object.freeze(refs.map(ref=>ref.name))});
    } finally {if(!committed)dispose();}
  }
  function stageArtBoundReference(ticket,index) {
    const binding=artBindingTickets.get(ticket);
    if(!binding || !Number.isSafeInteger(index) || index<0 || index>=binding.refs.length || binding.staged.has(index) || binding.submitted)
      throw new Error('参考图绑定已失效，未提交生成');
    binding.check();const ref=binding.refs[index],file=binding.files[index];
    if(uploads.has(ref.name))throw new Error('参考图名称冲突，未提交生成');
    uploads.set(ref.name,{bytes:file.bytes,mimeType:file.mimeType,kind:'image',slot:'img2img',artBinding:binding});
    pendingUploads.push(ref);binding.staged.add(index);return {ok:true,result:{name:ref.name}};
  }
  function discardArtImageBinding(ticket) {
    const binding=artBindingTickets.get(ticket);if(!binding)return false;
    for(const ref of binding.refs){if(uploads.get(ref.name)?.artBinding===binding)uploads.delete(ref.name);
      for(let i=pendingUploads.length-1;i>=0;i--)if(pendingUploads[i]===ref)pendingUploads.splice(i,1);}
    binding.dispose();binding.files.length=0;artBindingTickets.delete(ticket);return true;
  }

  // The server signs and revalidates the zero-price quote; browser state only
  // decides whether to ask for a confirmation and whether to send the request.
  function canonicalArtQuoteValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(canonicalArtQuoteValue);
    if (!value || typeof value !== 'object') throw new Error('绘图参数无效，未提交生成。');
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (['__proto__','constructor','prototype'].includes(key) || /^(authorization|access_?token|refresh_?token|session_?token|confirmationToken|quoteToken)$/i.test(key)) throw new Error('绘图参数无效，未提交生成。');
      result[key] = canonicalArtQuoteValue(value[key]);
    }
    return result;
  }
  function artQuoteSame(a,b) {return JSON.stringify(canonicalArtQuoteValue(a)) === JSON.stringify(canonicalArtQuoteValue(b));}
  function artQuoteCheck(q,request) {
    if (!q || q.task_id !== request.taskId || q.target_worker_id !== request.targetWorkerId || q.count !== 1 ||
        q.credit_cost !== 0 || q.source !== 'novaflow_web_self_hosted_v1' || !Number.isSafeInteger(q.expiry_epoch) ||
        q.expiry_epoch <= Math.floor(Date.now()/1000) || !/^[a-f0-9]{64}$/.test(q.quote_fingerprint || '') ||
        typeof q.model_id !== 'string' || !q.model_id || !artQuoteSame(q.workflow,request.workflow) ||
        !artQuoteSame(q.parameters,request.parameters) || !Array.isArray(q.references) || q.references.length!==request.references.length)
      throw new Error('生成报价不可用或已变化，未提交生成。');
    for (let i=0;i<request.references.length;i++) {
      const ref=request.references[i],quoted=q.references[i];
      const mime=/\.png$/.test(ref.name)?'image/png':/\.webp$/.test(ref.name)?'image/webp':'image/jpeg';
      if (!quoted || quoted.index!==i || quoted.mime!==mime ||
          !artQuoteSame({name:quoted.name,kind:quoted.kind,bytes:quoted.bytes,sha256:quoted.sha256,role:quoted.role},ref))
        throw new Error('参考图报价已变化，未提交生成。');
    }
  }
  function hasUnsafeArtPayload(value) {
    if (typeof value === 'string') return /^(?:data:image\/|blob:)/i.test(value);
    if (Array.isArray(value)) return value.some(hasUnsafeArtPayload);
    if (!value || typeof value!=='object') return false;
    return Object.keys(value).some(key => /^(authorization|access_?token|refresh_?token|session_?token|confirmationToken|quoteToken)$/i.test(key) || hasUnsafeArtPayload(value[key]));
  }

  // Session-only metadata for the existing H3 output-resource adapter. Its
  // legacy "local" schema is backed by signed Worker downloads on the Web.
  const videoOutputs = new Map();

  async function refreshTask(promptId) {
    const known = tasks.get(promptId);
    if (!known) return null;
    try {
      const res = await control('GET', '/api/web/tasks/' + known.id);
      tasks.set(promptId, res.task);
      return res.task;
    } catch (error) {
      if (error.status === 404) tasks.delete(promptId);
      return known;
    }
  }

  function checkCandidateTransport(options) {
    if(!options || typeof options.assertCurrent!=='function' || !options.signal || options.signal.aborted || options.assertCurrent()===false)
      throw new Error('候选任务或登录状态已变化，未继续提交。');
  }
  function candidateSecureBase(raw) {
    try {const endpoint=new URL(String(raw||''));
      if(endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !(endpoint.protocol==='https:' || (endpoint.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))))throw new Error('unsafe');
      return endpoint.href.replace(/\/+$/,'');
    } catch {throw new Error('候选服务地址不安全，未提交。');}
  }
  async function candidateGrantFor(task,op,{assertCurrent,signal,expectedNodeId}={}) {
    if(taskMode()!=='shared' ||
      !QWEN_ROTATION_CANDIDATE_ID.test(String(task?.id||'')) || !['upload','download'].includes(op) ||
      typeof expectedNodeId!=='string' || !expectedNodeId || task?.assigned_worker_id!==expectedNodeId ||
      typeof assertCurrent!=='function' || !signal || typeof AbortSignal==='undefined' || typeof AbortSignal.any!=='function' || typeof AbortSignal.timeout!=='function')
      throw new Error('候选任务授权不可用，未提交。');
    checkCandidateTransport({assertCurrent,signal});
    const res=await fetch(candidateSecureBase(CONFIG.controlUrl)+'/api/web/tasks/'+task.id+'/qwen-rotation-proof',{
      method:'POST',headers:authHeaders(),body:JSON.stringify({op}),redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])
    });
    if(!res.ok)throw Object.assign(new Error('候选任务授权未通过。'),{status:res.status});
    const value=await res.json();checkCandidateTransport({assertCurrent,signal});const g=value?.grant,p=value?.proof;
    if(value?.ok!==true || typeof p!=='string' || !p.startsWith('nfr_') || p.length>8192 ||
      !g || typeof g.token!=='string' || !g.token.startsWith('nfg_') || g.token.length>8192 ||
      g.taskId!==task.id || g.workerId!==expectedNodeId || g.op!==op || !Number.isFinite(Date.parse(g.expiresAt)) || Date.parse(g.expiresAt)<=Date.now())
      throw new Error('候选任务授权响应不匹配，未提交。');
    return {...g,endpoint:candidateSecureBase(g.endpoint),candidateProof:p};
  }
  async function grantFor(task, op, options={}) {
    const marked=QWEN_ROTATION_CANDIDATE_ID.test(String(task?.id||'').toLowerCase());
    if(options.qwenPlan===true){
      if(marked || taskMode()!=='shared' || !NODE_ID.test(String(task?.id||'')) ||
        !['upload','download'].includes(op) || task.assigned_worker_id!==options.expectedNodeId ||
        !Number.isSafeInteger(task.attempt_count) || task.attempt_count<1 || task.attempt_count>20 ||
        typeof options.assertCurrent!=='function' || !options.signal ||
        typeof AbortSignal==='undefined' || typeof AbortSignal.any!=='function' || typeof AbortSignal.timeout!=='function')
        throw new Error('动画规划任务授权不可用，未提交。');
      checkCandidateTransport(options);
      const res=await fetch(candidateSecureBase(CONFIG.controlUrl)+'/api/web/tasks/'+task.id+'/grant',{
        method:'POST',headers:authHeaders(),body:JSON.stringify({op,attempt:task.attempt_count}),
        redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.any([options.signal,AbortSignal.timeout(20000)])
      });
      if(!res.ok)throw Object.assign(new Error('动画规划任务授权未通过。'),{status:res.status});
      const value=await res.json();checkCandidateTransport(options);const g=value?.grant;
      if(value?.ok!==true || !g || typeof g.token!=='string' || !g.token.startsWith('nfg_') || g.token.length>8192 ||
        g.taskId!==task.id || g.workerId!==options.expectedNodeId || g.op!==op ||
        !Number.isFinite(Date.parse(g.expiresAt)) || Date.parse(g.expiresAt)<=Date.now())
        throw new Error('动画规划任务授权响应不匹配，未提交。');
      return {...g,endpoint:candidateSecureBase(g.endpoint)};
    }
    if(marked || options.candidate===true){
      if(!marked || task.id!==task.id.toLowerCase() || options.candidate!==true)throw new Error('候选任务授权范围不匹配。');
      return await candidateGrantFor(task,op,options);
    }
    if(task?.h3_idempotency_scope==='h3-idempotent-v1' && op==='download'){
      const filename=options.h3Filename, guard=captureFoartSessionGuard(), taskId=String(task.id||'');
      const files=Array.isArray(task.output_manifest?.files)?task.output_manifest.files:[];
      if(!NODE_ID.test(taskId))throw new Error('视频任务标识无效，请重新打开结果。');
      const expected=new RegExp('^h3-'+taskId+'-result-[1-8]\\.(mp4|webm)$');
      if(typeof filename!=='string'||!expected.test(filename)||
         files.filter(file=>file?.name===filename).length!==1||typeof guard!=='function'||!guard())
        throw new Error('视频文件或登录状态不可用，请重新打开结果。');
      // Each H3 token is bound to one output and one live session. Never use
      // the legacy per-task cache across filenames or account changes.
      const res=await control('POST','/api/web/tasks/'+task.id+'/grant',{op:'download',name:filename});
      if(!guard())throw new Error('登录状态已变化，请重新打开视频结果。');
      const grant=res?.grant;
      if(res?.ok!==true||!grant||typeof grant.token!=='string'||!grant.token.startsWith('nfg_')||
         grant.taskId!==task.id||grant.workerId!==task.assigned_worker_id||grant.op!=='download'||
         !Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now())
        throw new Error('视频授权已失效，请重新打开结果。');
      return grant;
    }
    const cached = grants.get(task.id);
    if (cached && op === 'download' && Date.parse(cached.expiresAt) - Date.now() > 60000) return cached;
    const res = await control('POST', '/api/web/tasks/' + task.id + '/grant', { op: op });
    if (op === 'download') grants.set(task.id, res.grant);
    return res.grant;
  }

  // --------------------------------------------------- ComfyUI shape mapping
  const RUNNING = ['created', 'queued', 'assigned', 'uploading', 'processing'];

  /** Present a control-plane task the way ComfyUI's /history presents a prompt. */
  function asHistoryEntry(task) {
    const files = (task.output_manifest && task.output_manifest.files) || [];
    const outputs = {};
    if (files.length) {
      outputs['nf-output'] = {
        images: files.filter((f) => f.kind !== 'video').map((f) => ({
          filename: f.name, subfolder: '', type: 'output'
        })),
        gifs: files.filter((f) => f.kind === 'video').map((f) => ({
          filename: f.name, subfolder: '', type: 'output', format: 'video/mp4'
        }))
      };
    }

    const failed = task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired';
    // A resource card's 生成用时 is read from these two, the way ComfyUI reports a run. It counts from
    // the submit to the result, the wait for a node included: that is the time the user waited.
    const submittedAt = Date.parse(task.created_at || '');
    const completedAt = Date.parse(task.completed_at || '');
    const timed = task.status === 'completed' && Number.isFinite(submittedAt) && Number.isFinite(completedAt) && completedAt >= submittedAt;
    return {
      prompt: [0, task.id, {}, {}, []],
      outputs: outputs,
      status: {
        completed: task.status === 'completed',
        status_str: task.status === 'completed' ? 'success' : (failed ? 'error' : 'running'),
        messages: failed
          ? [['execution_error', { exception_message: taskErrorText(task) }]]
          : timed
            ? [['execution_start', { prompt_id: task.id, timestamp: submittedAt }], ['execution_success', { prompt_id: task.id, timestamp: completedAt }]]
            : []
      },
      // Extra, beyond ComfyUI's shape: the 动画 panel shows the node's percentage from `progress`
      // (a page has no ComfyUI websocket here) and reads a cancel from `status`, which the
      // 'error' above cannot tell apart from a failure.
      novaflow: {
        taskId: task.id,
        status: task.status,
        progress: task.progress,
        note: task.progress_note,
        worker: task.assigned_worker_id,
        attempt: task.attempt_count,
        charged: task.charged_credit_cost
      }
    };
  }

  function asQueueState() {
    const running = [];
    const pending = [];
    for (const [promptId, task] of tasks) {
      if (!RUNNING.includes(task.status)) continue;
      const row = [0, promptId, {}, {}, []];
      if (task.status === 'queued' || task.status === 'created') pending.push(row);
      else running.push(row);
    }
    return { queue_running: running, queue_pending: pending };
  }

  // ------------------------------------------------- reference images in
  //
  // Straight to the machine that will run the task, through the same tunnel
  // the results come back on. Nothing about a task's files touches any
  // storage: they were made on that disk and the references join them there.
  //
  // This is why the upload has to wait. A reference belongs to ONE worker -
  // whichever the scheduler picked - so there is nobody to send it to until
  // the task is assigned, and the grant that authorises the write is minted
  // against that worker.
  // Two minutes, the same the node then gives the browser to upload: a node that claims late
  // (a 60s limit gave up just before the claim) must still find the upload coming.
  async function waitForAssignment(taskId, { timeoutMs = 120000, onWait, assertCurrent, signal } = {}) {
    const started = Date.now();
    let consecutiveNetworkFailures = 0;
    const check = () => {
      if (signal?.aborted) throw Object.assign(new Error('本次请求已取消'), {name:'AbortError'});
      if (assertCurrent) assertCurrent();
    };
    const pause = ms => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(Object.assign(new Error('本次请求已取消'), {name:'AbortError'}));
      let timer;
      const abort = () => {clearTimeout(timer);signal?.removeEventListener('abort', abort);reject(Object.assign(new Error('本次请求已取消'), {name:'AbortError'}));};
      timer = setTimeout(() => {signal?.removeEventListener('abort', abort);resolve();}, ms);
      signal?.addEventListener('abort', abort, {once:true});
    });
    for (;;) {
      check();
      if (Date.now() - started > timeoutMs) throw new Error('等不到空闲算力节点，参考图没能送出');
      let res;
      try {
        res = await control('GET', '/api/web/tasks/' + taskId);
      } catch (error) {
        check();
        const transient = !error?.status && error?.name !== 'AbortError' &&
          (error?.name === 'TimeoutError' || /failed to fetch|fetch failed|network|load failed/i.test(String(error?.message || error)));
        if (!transient || consecutiveNetworkFailures >= 3 || Date.now() - started >= timeoutMs) throw error;
        const delay = Math.min(600 * (2 ** consecutiveNetworkFailures++), Math.max(0, timeoutMs - (Date.now() - started)));
        await pause(delay);check();
        continue;
      }
      check();
      consecutiveNetworkFailures = 0;
      const task = res.task || {};
      tasks.set(taskId, task);
      if (task.assigned_worker_id) return task;
      // A panel that shows progress needs to say something during this wait;
      // 60s of a frozen bar reads as a hang. The callback is optional so the
      // existing callers are unchanged.
      if (typeof onWait === 'function') {
        try { onWait(Math.round((Date.now() - started) / 1000)); } catch (_) { /* a listener must not break the wait */ }
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        throw new Error('任务在上传参考图前就结束了：' + taskErrorText(task));
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error('等不到空闲算力节点，参考图没能送出');
      }
      await pause(700);
    }
  }

  async function putReferences(taskId, refs, artBinding=null) {
    // Panels that submit through the /prompt shim have no callback to pass; they listen for this.
    const task = await waitForAssignment(taskId, {
      onWait: (seconds) => root.dispatchEvent && root.dispatchEvent(new CustomEvent('novaflow:web-task-wait', { detail: { taskId, seconds } })),
      ...(artBinding ? {assertCurrent:artBinding.check} : {})
    });
    if (artBinding) artBinding.check();
    const grant = await grantFor(task, 'upload');
    if (artBinding) artBinding.check();
    const base = String(grant.endpoint || '').replace(/\/+$/, '');
    if (!base) throw new Error('算力节点没有可用地址');

    for (const ref of refs) {
      if (artBinding) artBinding.check();
      const held = uploads.get(ref.name);
      if (artBinding && held?.artBinding !== artBinding) throw new Error('参考图会话已变化，未继续上传');
      if (!held) throw new Error('找不到 ' + ref.name + ' 的图像数据');
      const res = await fetch(
        base + '/gw/tasks/' + taskId + '/input/' + encodeURIComponent(ref.name),
        {
          method: 'PUT',
          headers: {
            'content-type': held.mimeType || mimeFor(ref.name),
            'x-novaflow-grant': grant.token,
            ...(held.slot ? { 'x-novaflow-upload-slot': held.slot } : {})
          },
          body: held.bytes,
          ...(artBinding ? {signal:artBinding.signal,redirect:'error',credentials:'omit'} : {})
        }
      );
      if (artBinding) artBinding.check();
      if (!res.ok) {
        let message = ref.name + ' 上传返回 ' + res.status;
        try { const body = await res.json(); if (body && body.error) message = String(body.error); } catch (_) {}
        throw new Error(message);
      }
      uploads.delete(ref.name);
    }
  }

  // The same three steps for bytes a panel never staged under a name.
  //
  // putReferences can only send what went through `uploads`, which is how the
  // art panels work: they prepare a named image and submit later. The cutout
  // shim holds one blob it made itself and has nowhere to stage it, so it
  // needs wait-for-worker / mint-grant / PUT without the staging. Same wire
  // format, same tunnel, same grant - only the source of the bytes differs.
  async function putTaskInput(taskId, name, bytes, onWait, options = {}) {
    const check=()=>options.candidate===true || options.qwenPlan===true ? checkCandidateTransport(options) : options.assertCurrent?.();
    check();
    if(options.candidate===true || options.qwenPlan===true)candidateSecureBase(CONFIG.controlUrl);
    const task = await waitForAssignment(taskId, { onWait: onWait, assertCurrent: check, signal: options.signal });
    check();
    if(options.expectedNodeId && task?.assigned_worker_id!==options.expectedNodeId)throw new Error('任务分配节点不匹配，未上传。');
    const attempts = options.candidate===true || options.qwenPlan===true ? 1 : options.retryConnection ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        // The same task/file PUT is safe to repeat. Refresh the grant on each
        // attempt because restarting a node can change its tunnel address.
        check();
        const grant = await grantFor(task, 'upload',options);
        check();
        const base = String(grant.endpoint || '').replace(/\/+$/, '');
        if (!base) throw new Error('算力节点没有可用地址');
        const headers = { 'content-type': mimeFor(name), 'x-novaflow-grant': grant.token };
        if(options.candidate===true)headers['x-novaflow-candidate-proof']=grant.candidateProof;
        if (options.slot) headers['x-novaflow-upload-slot'] = String(options.slot);
        const res = await fetch(base + '/gw/tasks/' + taskId + '/input/' + encodeURIComponent(name), {
          method: 'PUT',
          headers,
          body: bytes,
          ...(options.candidate===true || options.qwenPlan===true ? {redirect:'error',cache:'no-store',credentials:'omit'} : {}),
          ...(options.signal ? {signal:options.signal} : {})
        });
        check();
        if (!res.ok) throw Object.assign(new Error(name + ' 上传返回 ' + res.status), { status: res.status });
        return task;
      } catch (error) {
        const transient = [502, 503, 504].includes(error?.status)
          || (!error?.status && /failed to fetch|fetch failed|network|load failed/i.test(String(error?.message || error)));
        if (!transient || attempt + 1 >= attempts) throw error;
        options.onRetry?.(attempt + 1);
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
      }
    }
  }

  /** One finished output file, as raw bytes. The warehouse is the caller's business. */
  async function fetchTaskOutput(task, filename, options={}) {
    const check=()=>options.candidate===true || options.qwenPlan===true ? checkCandidateTransport(options) : options.assertCurrent?.();
    check();
    const grant = await grantFor(task, 'download',{...options,h3Filename:filename});
    check();
    const url = grant.endpoint.replace(/\/+$/, '') +
      '/gw/tasks/' + task.id + '/output/' + encodeURIComponent(filename) +
      (options.candidate===true || options.qwenPlan===true ? '' : '?grant=' + encodeURIComponent(grant.token));
    const res = options.candidate===true || options.qwenPlan===true ? await fetch(url,{headers:{'x-novaflow-grant':grant.token,
      ...(options.candidate===true?{'x-novaflow-candidate-proof':grant.candidateProof}:{})},signal:options.signal,redirect:'error',cache:'no-store',credentials:'omit'}) : await fetch(url);
    check();
    if (!res.ok) throw new Error('取回 ' + filename + ' 失败：' + res.status);
    const bytes=new Uint8Array(await res.arrayBuffer());check();
    if(options.qwenPlan===true && (bytes.length<1 || bytes.length>262144))throw new Error('动画规划结果大小无效，未修改作品。');
    return bytes;
  }

  // A file stored as octet-stream is fine for an <img>, which sniffs, and not
  // fine for a <video>, which does not - and a video that silently refuses to
  // play looks like a generation that failed.
  function mimeFor(name) {
    const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp', mp4: 'video/mp4', wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'video/webm'
    };
    return (ext && map[ext[1]]) || 'application/octet-stream';
  }

  // ------------------------------------------------------------- submission
  const originOf = (baseUrl) => { try { return new URL(String(baseUrl)).origin; } catch (_) { return String(baseUrl || ''); } };

  // Opt-in only after the control plane AND installed worker advertise the
  // same scoped contract. Never retry a submission whose outcome is unknown.
  async function submitIdempotentH3(intent, baseUrl) {
    if (taskMode() !== 'shared') throw new Error('当前节点不支持安全的视频任务提交。');
    const guard = captureFoartSessionGuard(), nodeEpoch = computeNodeEpoch, nodeId = computeNode?.id || '';
    const billingOwner = captureFoartBillingOwner();
    if (!billingOwner || !billingOwner.current()) throw new Error('登录状态无法验证，未提交。');
    if (uncertainH3Owners.has(billingOwner.owner)) throw new Error('上一次视频任务还没有确认，请稍后再试。');
    if (typeof guard !== 'function' || !guard()) throw new Error('登录状态无法验证，未提交视频任务。');
    const studio = root.NovaFlowAudioStudio, gen = root.NovaFlowAiSequenceGeneration;
    const route = root.__NovaFlowArtGenerate?.captureContext?.()?.routeRevision;
    const mediaRoute = studio?.routeRevision?.(), board = gen?.boardIdentity?.(), snapshot = gen?.capture?.();
    if (studio?.isOpen?.() !== true || studio?.sub?.() !== 'video' ||
        !Number.isSafeInteger(route) || route < 0 || !Number.isSafeInteger(mediaRoute) || mediaRoute < 0 ||
        typeof board !== 'symbol' || !Number.isSafeInteger(snapshot?.boardRevision) || snapshot.boardRevision < 0 ||
        snapshot.mode !== 'minimax_h3_local' || snapshot.genType !== 'first_last')
      throw new Error('无法确认当前视频画板，未提交视频任务。');
    const expectedSnapshot = JSON.stringify(snapshot);
    const check = () => {
      if (!guard() || taskMode() !== 'shared' || computeNodeEpoch !== nodeEpoch || (computeNode?.id || '') !== nodeId ||
          root.NovaFlowAudioStudio !== studio || studio.routeRevision?.() !== mediaRoute || studio.isOpen?.() !== true || studio.sub?.() !== 'video' ||
          root.__NovaFlowArtGenerate?.captureContext?.()?.routeRevision !== route ||
          root.NovaFlowAiSequenceGeneration?.boardIdentity?.() !== board || JSON.stringify(root.NovaFlowAiSequenceGeneration?.capture?.()) !== expectedSnapshot)
        throw new Error('账号、节点或视频画板已变化；已提交的任务请到任务列表查看。');
    };
    const originals = intent.options?.images;
    if (!Array.isArray(originals) || originals.length !== 2 || originals.some(name => typeof name !== 'string' || !name) || originals[0] === originals[1])
      throw new Error('首尾帧素材不完整，未提交视频任务。');
    if (!root.crypto?.subtle || typeof root.crypto.randomUUID !== 'function') throw new Error('当前浏览器无法安全绑定视频素材，未提交。');
    const options = JSON.parse(JSON.stringify(intent.options));
    const staged = [];
    for (const name of originals) {
      check();
      const ref = [...pendingUploads].reverse().find(item => item.name === name), held = uploads.get(name);
      if (!ref || !held || held.kind !== 'image') throw new Error('找不到首尾帧素材，未提交视频任务。');
      const source = held.bytes;
      const sourceLength = source?.byteLength ?? source?.size;
      if (!Number.isSafeInteger(sourceLength) || sourceLength < 1 || sourceLength > 64 * 1024 * 1024 || ref.bytes !== sourceLength)
        throw new Error('视频素材大小无效，未提交。');
      let bytes;
      if (source instanceof ArrayBuffer) bytes = new Uint8Array(source.slice(0));
      else if (ArrayBuffer.isView(source)) bytes = new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
      else if (source && typeof source.arrayBuffer === 'function') bytes = new Uint8Array(await source.arrayBuffer());
      else throw new Error('视频素材格式无效，未提交。');
      check();
      if (!bytes.length || bytes.byteLength > 64 * 1024 * 1024 || ref.bytes !== bytes.byteLength || uploads.get(name) !== held) throw new Error('视频素材大小无效或已变化，未提交。');
      const digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
      check();
      if (uploads.get(name) !== held) throw new Error('视频素材已变化，未提交。');
      const sha256 = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
      const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase();
      if (!['png','jpg','jpeg','webp'].includes(ext)) throw new Error('首尾帧格式不支持，未提交。');
      staged.push({ original: name, ref, held, bytes, sha256, ext });
    }
    const fingerprint = JSON.stringify({options, nodeId, refs: staged.map(item => ({name:item.original, bytes:item.bytes.byteLength, sha256:item.sha256}))});
    let operation = pendingH3Submission;
    if (operation) {
      throw new Error(operation.busy ? '视频任务正在提交，请稍候。' : '上一次视频任务还没有确认，请稍后再试。');
    } else {
      const id = String(root.crypto.randomUUID()).toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('无法创建安全的视频任务标识。');
      const names = staged.map((item, index) => 'h3-' + id + '-' + (index === 0 ? 'first' : 'last') + '.' + item.ext);
      const translated = JSON.parse(JSON.stringify(options));
      translated.images = names;
      // Some workflow profiles accept these synonymous fields; translate
      // only exact filename references, never prompt text or arbitrary values.
      for (const [field, index] of [['firstFrame',0],['firstImage',0],['lastFrame',1],['lastImage',1]]) {
        if (translated[field] === originals[index]) translated[field] = names[index];
      }
      if (Array.isArray(translated.referenceImages)) translated.referenceImages = translated.referenceImages.map(name => name === originals[0] ? names[0] : name === originals[1] ? names[1] : name);
      const refs = staged.map((item, index) => ({name:names[index],bytes:item.bytes.byteLength,kind:'image',sha256:item.sha256}));
      operation = {id, fingerprint, current:check, busy:false, task:null, staged, refs,
        body:{task_type:'renderer_workflow',workflow:{module:intent.module,method:intent.method},parameters:translated,references:refs,video_request_id:id}};
      pendingH3Submission = operation;
    }
    operation.busy = true;
    try {
      const finish = task => {
        // Do not delete a replacement staged after this submission.
        // Do not delete a later replacement with the same display filename.
        for (const item of [...operation.staged, ...staged]) {
          const index = pendingUploads.indexOf(item.ref);
          if (index >= 0) pendingUploads.splice(index, 1);
          if (uploads.get(item.original) === item.held) uploads.delete(item.original);
        }
        root.NovaFlowWebRuntime.lastTask = task;
        if (pendingH3Submission === operation) pendingH3Submission = null;
        uncertainH3Owners.delete(billingOwner.owner);
        return {prompt_id:operation.id,number:tasks.size,node_errors:{}};
      };
      if (!operation.task) {
        let result;
        operation.current();
        uncertainH3Owners.add(billingOwner.owner);
        try { result = await control('POST', '/api/web/tasks', operation.body); operation.current(); }
        catch (error) {
          operation.current();
          if (error?.status && ![502,503,504].includes(error.status)) throw error;
          throw new Error('视频任务还没有确认，请稍后查看任务列表。');
        }
        if (!result?.task || result.task.id !== operation.id) throw new Error('视频任务返回的标识不匹配，未继续上传。');
        operation.task = result.task;
        tasks.set(operation.id, result.task); taskOrigins.set(operation.id, originOf(baseUrl));
      }
      const started = Date.now();
      let assigned;
      for (;;) {
        operation.current();
        let res;
        try { res = await control('GET', '/api/web/tasks/' + operation.id); }
        catch { operation.current(); throw new Error('视频任务还没有确认，请稍后查看任务列表。'); }
        operation.current();
        assigned = res.task || {};
        if (assigned.id !== operation.id) throw new Error('视频任务状态不匹配，已停止上传。');
        tasks.set(operation.id, assigned);
        if (assigned.status === 'completed') return finish(assigned);
        if (['failed','cancelled','expired'].includes(assigned.status)) {
          if (assigned.error_code === 'h3_result_unknown') throw new Error('视频任务结果还没有确认，请稍后查看任务列表。');
          // The server has positively identified the same request as terminal.
          // Keep the staged inputs for an explicit new submission; never retry
          // a new task automatically or modify the old task's accounting.
          if (pendingH3Submission === operation) pendingH3Submission = null;
          uncertainH3Owners.delete(billingOwner.owner);
          throw new Error('视频任务已结束：' + taskErrorText(assigned));
        }
        if (assigned.assigned_worker_id) {
          if (nodeId && assigned.assigned_worker_id !== nodeId) throw new Error('视频任务分配节点已变化，未上传素材。');
          break;
        }
        if (Date.now() - started > 120000) throw new Error('视频任务还没有确认，请稍后查看任务列表。');
        await new Promise(resolve => setTimeout(resolve, 700));
      }
      operation.current();
      const grant = await grantFor(assigned, 'upload');
      operation.current();
      const base = String(grant.endpoint || '').replace(/\/+$/, '');
      if (!base) throw new Error('算力节点没有可用地址，未继续上传。');
      for (let index = 0; index < operation.refs.length; index++) {
        operation.current();
        const ref = operation.refs[index], item = operation.staged[index];
        let res;
        try {
          res = await fetch(base + '/gw/tasks/' + operation.id + '/input/' + encodeURIComponent(ref.name), {
            method:'PUT', headers:{'content-type':item.held.mimeType || mimeFor(ref.name),'x-novaflow-grant':grant.token}, body:item.bytes
          });
        } catch { operation.current(); throw new Error('视频素材上传还没有确认，请稍后再试。'); }
        operation.current();
        if (!res.ok) throw new Error('视频素材上传还没有确认，请稍后再试。');
      }
      operation.current();
      return finish(assigned);
    } finally { operation.busy = false; }
  }

  async function submitPrompt(body, baseUrl) {
    const intent = intentFrom(body && body.prompt);
    if (!intent) {
      // Nothing recorded means a panel tried to submit a graph it built
      // itself. On the desktop that works; here it is exactly what spec 10
      // forbids, so it fails loudly rather than silently doing nothing.
      throw new Error(
        'Foart Web 不接受浏览器直接提交工作流。' +
        '该功能的图构建尚未迁移到算力节点，请在 docs/LIMITATIONS.md 查看已迁移的功能。'
      );
    }

    if (H3_IDEMPOTENT_TASK_RELEASE_ENABLED && intent.module === 'NovaFlowAiSequenceMiniMaxH3Workflow' &&
        intent.method === 'buildWorkflow' && intent.options?.mode === 'fl2v') return submitIdempotentH3(intent, baseUrl);

    // Other panels may prepare uploads without submitting a task. Attach only
    // filenames actually used by this intent, otherwise an earlier inpaint
    // preview becomes a reference image on a later text-to-video request.
    const usedNames = new Set();
    const collectNames = (value) => {
      if (typeof value === 'string') usedNames.add(value);
      else if (Array.isArray(value)) value.forEach(collectNames);
      else if (value && typeof value === 'object') Object.values(value).forEach(collectNames);
    };
    collectNames(intent.options);
    const selected = new Map();
    for (let i = 0; i < pendingUploads.length;) {
      const ref = pendingUploads[i];
      if (usedNames.has(ref.name)) {
        selected.set(ref.name, ref);
        pendingUploads.splice(i, 1);
      } else i += 1;
    }
    const refs = [...selected.values()];
    const artBindings = refs.map(ref=>uploads.get(ref.name)?.artBinding).filter(Boolean);
    let artBinding = null;
    if (artBindings.length || refs.some(ref=>ref.name.startsWith('artbind-')) || [...usedNames].some(name=>/^artbind-/i.test(name))) {
      artBinding = artBindings[0];
      if (!artBinding || artBindings.length!==refs.length || artBindings.some(x=>x!==artBinding) ||
          intent.module!=='novaflow-brand-runtime' || intent.method!=='buildArtGenerateRunWorkflow' ||
          JSON.stringify(refs)!==JSON.stringify(artBinding.refs) ||
          JSON.stringify(intent.options?.__args?.[2])!==JSON.stringify(artBinding.refs.map(ref=>ref.name)))
        throw new Error('参考图绑定不完整，未提交生成');
      const roles=intent.options?.__args?.[10]?.referenceRoles;
      if (roles===undefined ? artBinding.refs.some(ref=>ref.role!=='auto') :
          JSON.stringify(roles)!==JSON.stringify(artBinding.refs.map(ref=>ref.role)))
        throw new Error('参考图角色已变化，未提交生成');
      artBinding.check();
      if (artBinding.submitted) throw new Error('此生成请求已提交，请勿重复提交');
      artBinding.submitted=true;
    }

    let confirmedRequest=null, confirmationToken=null;
    if (artBinding) {
      try {
        artBinding.check();
        confirmedRequest=JSON.parse(JSON.stringify({taskId:artBinding.taskId,count:1,targetWorkerId:artBinding.targetWorkerId,
          workflow:{module:intent.module,method:intent.method},parameters:intent.options || {},references:artBinding.refs}));
        if (hasUnsafeArtPayload(confirmedRequest.parameters)) throw new Error('绘图参数包含不能提交的内容。');
        const quoted=await control('POST','/api/web/art-image/quote',{request:confirmedRequest});
        artBinding.check();
        if (quoted?.ok!==true || typeof quoted.quoteToken!=='string' || !quoted.quoteToken) throw new Error('生成报价不可用，未提交生成。');
        artQuoteCheck(quoted.quote,confirmedRequest);
        artBinding.check();artQuoteCheck(quoted.quote,confirmedRequest);
        const accepted=await control('POST','/api/web/art-image/confirm',{request:confirmedRequest,quoteToken:quoted.quoteToken,accepted:true});
        artBinding.check();artQuoteCheck(quoted.quote,confirmedRequest);
        if (accepted?.ok!==true || typeof accepted.confirmationToken!=='string' || !accepted.confirmationToken)
          throw new Error('生成确认失败，未提交生成。');
        confirmationToken=accepted.confirmationToken;
      } catch (error) {
        discardArtImageBinding(artBinding.ticket);
        throw error;
      }
    }
    let task;
    try { task = await control('POST', '/api/web/tasks', artBinding ? {
      art_image_binding_scope:'art-image-binding-v1',request:confirmedRequest,confirmationToken
    } : {
      task_type: 'renderer_workflow',
      workflow: { module: intent.module, method: intent.method },
      parameters: intent.options || {},
      references: refs
    }); } catch (error) {
      if (artBinding) { discardArtImageBinding(artBinding.ticket); throw new Error('任务创建结果未确认，请稍后查看任务列表再试'); }
      throw error;
    }

    if (artBinding && task?.task?.id !== artBinding.taskId) { discardArtImageBinding(artBinding.ticket); throw new Error('任务创建还没有确认，请稍后查看任务列表。'); }
    const promptId = task.task.id;
    tasks.set(promptId, task.task);
    taskOrigins.set(promptId, originOf(baseUrl));
    if (intent.method === 'buildSeeThroughSplitWorkflow' || intent.module === 'NovaFlowAifxRestyleWorkflow') splitTasks.add(promptId);
    root.NovaFlowWebRuntime.lastTask = task.task;

    // Send the reference images.
    //
    // This used to queue the bytes in `uploads` and never read the map again:
    // the task carried the NAMES of the references and the pixels stayed in
    // the browser, so a worker running 图生图 waited two minutes for an upload
    // that was never coming and then failed the task. Text-to-image has no
    // references, which is why every run that was ever verified worked.
    if (refs.length) {
      try {
        if (artBinding) artBinding.check();
        await putReferences(promptId, refs, artBinding);
        if (artBinding) artBinding.check();
      } catch (error) {
        // Say which step failed. "timed out waiting for the browser to upload"
        // arrives from the worker two minutes later and points at the wrong
        // side of the wire. Cancel the task too: otherwise a node claims it later and sits two
        // minutes waiting for bytes this page will never send, failing every run queued behind it.
        // A new account must never cancel a task belonging to the prior one.
        if (artBinding) {
          let cancelled=false;
          if (artBinding.sessionCurrent()) try { const value=await control('POST', '/api/web/tasks/' + promptId + '/cancel'); cancelled=value?.task?.status==='cancelled'; } catch {}
          discardArtImageBinding(artBinding.ticket);
          if (!cancelled) throw new Error('任务停止还没有确认，未继续上传');
        } else await control('POST', '/api/web/tasks/' + promptId + '/cancel').catch(() => {});
        throw new Error('参考图上传失败：' + String(error.message || error));
      }
    }

    if (artBinding) discardArtImageBinding(artBinding.ticket);
    return { prompt_id: promptId, number: tasks.size, node_errors: {} };
  }

  // The renderer calls these with a SINGLE payload object:
  //
  //   runtimeRequestJson({ baseUrl, path, init })
  //   runtimeUploadImage({ baseUrl, fileName, dataBase64, type, subfolder })
  //
  // I wrote them as positional parameters, so `path` arrived undefined and the
  // shim answered "NovaFlow Web does not proxy " - with nothing after the
  // space, which is what gave it away. 美工 and 绘图 were dead for every user
  // because of it. The shapes below are taken from proxy-electron-api.js,
  // which is the contract, and a test now asserts they still match it.
  //
  // Positional calls are accepted too: this file's own fetch interceptor uses
  // them, and tolerating both costs nothing.
  function asPayload(args, names) {
    const first = args[0];
    if (first && typeof first === 'object' && !ArrayBuffer.isView(first) && !(first instanceof ArrayBuffer)) {
      return first;
    }
    const out = {};
    names.forEach((n, i) => { out[n] = args[i]; });
    return out;
  }

  // What the compute node's image runtime offers beyond the fixed task types,
  // e.g. { qwenImage21: true }: the local assistant, or on the website the
  // shared pool (true while a node that can build 2.1 is online). The website
  // draws on 2.1, so its panel starts from that layout (steps, CFG, ten
  // references, the 2.1 LoRA list) whatever the pool reports at the moment.
  let runtimeFeatureCache = taskMode() === 'shared' ? { qwenImage21: true } : {};
  let runtimeFeatureSequence = 0, qwenBusinessVerified = false, qwenNativeV3Binding = null, qwenImageEditBinding = null;
  function qwenBusinessAvailable(){return CONFIG.xiaotaoQwenBusinessEnabled===true && qwenBusinessVerified;}
  function qwen21NativeRewriteV3Available(){
    const binding=qwenNativeV3Binding;
    return !!binding && taskMode()==='shared' && computeNodeEpoch===binding.epoch && (computeNode?.id||'')===binding.nodeId && binding.sessionGuard()===true && qwenBusinessAvailable();
  }
  function qwen21LocalImageEditAvailable(){
    const binding=qwenImageEditBinding;
    return !!binding && taskMode()==='shared' && computeNodeEpoch===binding.epoch && (computeNode?.id||'')===binding.nodeId && binding.sessionGuard()===true && qwenBusinessAvailable();
  }
  function setRuntimeFeatureCache(next){
    const changed=JSON.stringify(next)!==JSON.stringify(runtimeFeatureCache);runtimeFeatureCache=next;
    if(changed && typeof root.dispatchEvent==='function' && typeof root.CustomEvent==='function')root.dispatchEvent(new root.CustomEvent('novaflow:runtime-features',{detail:{...next}}));
  }
  // The answer can be missing on the first try (a page opened while the assistant restarts, a model
  // probe that timed out at start): until the node reports 2.1, ask again every 15 s for a while and
  // when the window regains focus, so the drawing panel does not stay on its fallback layout.
  let runtimeFeatureRetry = null;
  let runtimeFeatureRetries = 0;
  let runtimeFeatureCheckedAt = 0;
  function scheduleRuntimeFeatureRetry() {
    if (runtimeFeatureRetry || runtimeFeatureRetries >= 40 || typeof root.setTimeout !== 'function') return;
    runtimeFeatureRetry = root.setTimeout(() => {
      runtimeFeatureRetry = null;
      runtimeFeatureRetries += 1;
      electronAPI.runtimeFeatures();
    }, 15000);
    // Never keeps a Node test process alive.
    if (runtimeFeatureRetry && typeof runtimeFeatureRetry.unref === 'function') runtimeFeatureRetry.unref();
  }

  // ------------------------------------------------------------ the adapter
  //
  // Mirrors the shape proxy-electron-api.js probes for, so the renderer's
  // capability check passes and it never installs its loopback fallback.
  const electronAPI = {
    // ---- ComfyUI runtime proxy -------------------------------------------
    async runtimeGetSystemStats(payload) {
      try {
        const video = /:8189(?:\/|$)/.test(String(payload && payload.baseUrl || ''));
        const probeType = video ? 'h3_i2v' : selectedImageProbeType();
        const count = await poolHas(probeType);
        if (!video && probeType!==selectedImageProbeType()) return {ok:false,status:409,error:'绘图模型已变化，请重试'};
        if (!count) return { ok: false, status: 503, error: video ? '当前无可用视频节点，请稍后重试' : '当前无可用生图节点，请稍后重试' };
        return {
          ok: true,
          status: 200,
          result: {
            system: {
              os: 'web',
              comfyui_version: 'novaflow-web-pool',
              ram_total: 0, ram_free: 0
            },
            devices: [{ name: count + ' 台算力节点', type: 'cuda', index: 0, vram_total: 0, vram_free: 0 }]
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    async runtimeRequestJson(...args) {
      const { baseUrl, path, init } = asPayload(args, ['baseUrl', 'path', 'init']);
      const method = String((init && init.method) || 'GET').toUpperCase();
      const clean = String(path || '').split('?')[0].replace(/^\/api\//, '/').replace(/\/+$/, '');
      const query = String(path || '').includes('?')
        ? new URLSearchParams(String(path).split('?')[1])
        : new URLSearchParams();

      try {
        let body = null;
        if (init && init.body) {
          try { body = JSON.parse(init.body); } catch (_) { body = null; }
        }

        if (method === 'POST' && (clean === '/prompt' || clean === '/api/prompt')) {
          return { ok: true, status: 200, result: await submitPrompt(body, baseUrl) };
        }

        if (clean.startsWith('/history')) {
          const promptId = clean.split('/')[2];
          if (!promptId) return { ok: true, status: 200, result: {} };
          const task = await refreshTask(promptId);
          if (!task) return { ok: true, status: 200, result: {} };
          const out = {};
          out[promptId] = asHistoryEntry(task);
          return { ok: true, status: 200, result: out };
        }

        if (clean === '/queue') {
          await Promise.all([...tasks.keys()].map(refreshTask));
          return { ok: true, status: 200, result: asQueueState() };
        }

        if (method === 'POST' && clean === '/interrupt') {
          // Stop the caller's own task: the one it names (ComfyUI's /interrupt takes a prompt_id too),
          // else the newest this page sent to the same runtime. An 动画 run left going in the
          // background must survive a 任务中止 pressed in 美工, and the reverse.
          const named = body && body.prompt_id && tasks.has(String(body.prompt_id)) ? [String(body.prompt_id)] : null;
          const ids = (named || [...tasks.keys()].filter((id) => taskOrigins.get(id) === originOf(baseUrl)))
            .filter((id) => RUNNING.includes(tasks.get(id)?.status));
          // The cache can be stale (a panel stops polling once it asks for a stop): ask first.
          await Promise.all(ids.map(refreshTask));
          const promptId = ids.filter((id) => RUNNING.includes(tasks.get(id)?.status)).pop();
          if (promptId) {
            const task = tasks.get(promptId);
            try {
              const res = await control('POST', '/api/web/tasks/' + task.id + '/cancel');
              tasks.set(promptId, res && res.task ? res.task : Object.assign({}, task, { status: 'cancelled' }));
            } catch (error) {
              // It ended on its own (or was stopped elsewhere) in between: nothing is left to stop.
              if (RUNNING.includes((await refreshTask(promptId))?.status)) throw error;
            }
          }
          return { ok: true, status: 200, result: {} };
        }

        if (clean.startsWith('/object_info')) {
          // The node catalogue lives on a compute node, not here. Answering
          // with an empty object would be worse than saying so: a caller that
          // believes it holds a catalogue then builds from nothing, and the
          // renderer has paths that generate a Web Worker's source from it -
          // which is how an empty success became a SyntaxError in a worker.
          //
          // Reporting "no runtime" makes callers take the same branch they
          // take on the desktop when ComfyUI is not running.
          return {
            ok: false,
            status: 503,
            error: 'Foart Web 不在浏览器里暴露节点目录；节点信息由算力节点持有'
          };
        }

        if (clean === '/system_stats') {
          return await electronAPI.runtimeGetSystemStats({ baseUrl });
        }

        void query;
        return { ok: false, status: 404, error: 'Foart Web does not proxy ' + clean };
      } catch (error) {
        // "missing session token" is the control plane's own wording and it
        // surfaced raw in three different panels, none of which told anyone to
        // log in. Say the thing that can be acted on.
        const status = error.status || 500;
        if(root.NovaFlowWebRuntime)root.NovaFlowWebRuntime.lastFailure={at:Date.now(),path:clean,status,message:String(error.message||error)};
        if (status === 401 || /session token|unauthor/i.test(String(error.message || ''))) {
          return {
            ok: false,
            status: 401,
            error: '请先登录 Foart 账号（点顶栏右上角的「登录」）'
          };
        }
        return { ok: false, status, error: String(error.message || error) };
      }
    },

    async runtimeRequestBinary(...args) {
      const { baseUrl, path } = asPayload(args, ['baseUrl', 'path', 'init']);
      const query = new URLSearchParams(String(path).split('?')[1] || '');
      const filename = query.get('filename');
      if (!filename) return { ok: false, error: 'missing filename' };

      // Newest task first: 一键拆图's seethrough_psd_info.log keeps one name across runs, and the
      // page wants the run it just made.
      const entry = [...tasks.values()].reverse().find(
        (t) => ((t.output_manifest && t.output_manifest.files) || []).some((f) => f.name === filename)
      );
      if (!entry) return { ok: false, error: 'unknown output file: ' + filename };

      try {
        // Straight from the worker's disk. grant.endpoint is its tunnel
        // address when it has one, so this reaches the machine that made the
        // file from anywhere - without the bytes passing through any storage.
        const scoped=entry.h3_idempotency_scope==='h3-idempotent-v1';
        const h3Guard=scoped?captureFoartSessionGuard():null;
        if(scoped && (typeof h3Guard!=='function'||!h3Guard()))throw new Error('登录状态已变化，请重新打开视频结果。');
        const grant = await grantFor(entry, 'download',{h3Filename:filename});
        if(scoped && !h3Guard())throw new Error('登录状态已变化，请重新打开视频结果。');
        const url = grant.endpoint.replace(/\/+$/, '') +
          '/gw/tasks/' + entry.id + '/output/' + encodeURIComponent(filename) +
          '?grant=' + encodeURIComponent(grant.token);
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: '取回结果失败：' + res.status };
        const buffer = await res.arrayBuffer();
        if(scoped && !h3Guard())throw new Error('登录状态已变化，请重新打开视频结果。');
        // The shared legacy warehouse is not account-scoped. Do not copy a
        // session-bound video into that store when the account can change.
        if (!scoped && root.NovaFlowWebWarehouse && !splitTasks.has(entry.id)) {
          await root.NovaFlowWebWarehouse.save({ blob: new Blob([buffer], { type: mimeFor(filename) }), name: filename });
        }
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        const contentType = res.headers.get('content-type') || mimeFor(filename);
        return {
          ok: true,
          status: 200,
          dataBase64: btoa(binary),
          contentType,
          result: {
            data: buffer,
            contentType,
            url: url
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    /** A URL an <img>/<video> can use directly, with the grant in the query. */
    async runtimeFileUrl(filename) {
      const entry = [...tasks.values()].reverse().find(
        (t) => ((t.output_manifest && t.output_manifest.files) || []).some((f) => f.name === filename)
      );
      if (!entry) return '';
      const grant = await grantFor(entry, 'download',{h3Filename:filename});
      return grant.endpoint.replace(/\/+$/, '') +
        '/gw/tasks/' + entry.id + '/output/' + encodeURIComponent(filename) +
        '?grant=' + encodeURIComponent(grant.token);
    },

    async runtimeUploadImage(...args) {
      // Canonical: { baseUrl, fileName, dataBase64, type, subfolder }.
      // Positional (name, bytes) is what this file's interceptor passes.
      const payload = asPayload(args, ['fileName', 'dataBase64']);
      const name = payload.fileName ?? payload.name;
      let bytes = payload.bytes;
      if (bytes == null && typeof payload.dataBase64 === 'string') {
        const bin = atob(payload.dataBase64.replace(/^data:[^,]*,/, ''));
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
        bytes = buf.buffer;
      } else if (bytes == null) {
        bytes = payload.dataBase64;
      }
      // Uploads happen before the task exists, so they are queued here and
      // attached when the task is created. The gateway PUT then targets the
      // worker the scheduler picked.
      // Sanitising a name can destroy it: 参考图.png and 背景图.png both become
      // ___.png, and the second would silently overwrite the first. When the
      // name actually changed, give it a short suffix derived from the original
      // so two different files stay two different files.
      const raw = String(name || 'reference.png');
      const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      let safe = cleaned;
      if (cleaned !== raw) {
        let h = 0;
        for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
        const tag = h.toString(36).slice(0, 6);
        const dot = cleaned.lastIndexOf('.');
        safe = dot > 0
          ? cleaned.slice(0, dot) + '_' + tag + cleaned.slice(dot)
          : cleaned + '_' + tag;
      }
      // The gateway stores and serves only names that start with a letter or digit (isSafeFilename).
      // A name with no ASCII at all, 白衣女.png say, cleaned to ____<tag>.png: the control plane took
      // the task, every upload of the file came back 400, the node waited two minutes for it, and the
      // panel said only 下发失败. Give such a name an ASCII head instead.
      if (!/^[A-Za-z0-9]/.test(safe)) safe = 'ref-' + safe.replace(/^[._-]+/, '');
      const slot = String(payload.slot || '');
      pendingUploads.push({ name: safe, bytes: (bytes && bytes.byteLength) || 0, kind: 'image' });
      uploads.set(safe, { bytes: bytes, kind: 'image', mimeType: payload.mimeType || mimeFor(safe), slot });
      return { ok: true, status: 200, result: { name: safe, subfolder: '', type: 'input', kind: 'image' } };
    },

    // Video and audio use this path. runtimeUploadImage stays an image upload
    // and must not be given those files.
    async runtimeUploadFile(payload = {}) {
      const name = payload.fileName || payload.name;
      const kind = String(payload.kind || '');
      if (!['image', 'video', 'audio'].includes(kind)) return { ok: false, error: '不支持的文件类型' };
      const bytes = payload.bytes;
      const raw = String(name || 'reference.bin');
      const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      let safe = cleaned;
      if (cleaned !== raw) {
        let h = 0;
        for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
        const tag = h.toString(36).slice(0, 6);
        const dot = cleaned.lastIndexOf('.');
        safe = dot > 0 ? cleaned.slice(0, dot) + '_' + tag + cleaned.slice(dot) : cleaned + '_' + tag;
      }
      if (!/^[A-Za-z0-9]/.test(safe)) safe = 'ref-' + safe.replace(/^[._-]+/, '');
      const mimeType = String(payload.mimeType || mimeFor(safe));
      const slot = String(payload.slot || '');
      pendingUploads.push({ name: safe, bytes: (bytes && bytes.byteLength) || 0, kind });
      uploads.set(safe, { bytes, kind, mimeType, slot });
      return { ok: true, status: 200, result: { name: safe, kind, slot } };
    },

    // ---- account ----------------------------------------------------------
    async clientAuthStatus() {
      const checkedSession = currentSession();
      if (!checkedSession) return { ok: true, result: { authenticated: false } };
      try {
        // A missing control address must not send this bearer token to a
        // loopback pairing endpoint, whose 401 is unrelated to account login.
        if (!/^https?:\/\//i.test(String(CONFIG.controlUrl || '').trim())) {
          throw new Error('账号校验服务地址未配置');
        }
        const me = await control('GET', '/api/web/me');
        // A successful old response must not be displayed after an account
        // switch while the request was in flight.
        const latest = currentSession();
        if (!latest?.token) return { ok: true, result: { authenticated: false } };
        if (latest.token !== checkedSession.token) {
          return { ok: true, result: { authenticated: true, user: null, temporarilyUnavailable: true } };
        }
        return {
          ok: true,
          result: { authenticated: true, user: me.user, credits: me.credits }
        };
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          const latest = currentSession();
          if (latest?.token && latest.token !== checkedSession.token) {
            return { ok: true, result: { authenticated: true, user: null, temporarilyUnavailable: true } };
          }
          saveSession(null);
          try { root.localStorage.removeItem(CLIENT_AUTH_KEY); } catch (_) {}
          // Pushed out by a newer login on the account, or the account ran out:
          // the login screen that follows says which.
          if (error.code === 'session_replaced' || error.code === 'account_expired') {
            try { root.sessionStorage.setItem(SIGNOUT_REASON_KEY, String(error.message || '')); } catch (_) {}
          }
          return { ok: true, result: { authenticated: false } };
        }
        // A temporary control-plane/network failure is not a logout. The
        // next status probe can retry with the same signed session.
        const active = currentSession();
        return { ok: true, result: { authenticated: !!active, user: active?.user || null, temporarilyUnavailable: true } };
      }
    },

    async clientAuthLogin(payload) {
      try {
        const res = await auth('POST', '/api/auth/login', {
          account: (payload && (payload.account || payload.email)) || '',
          password: (payload && payload.password) || ''
        });
        saveSession({ token: res.session.token, user: res.user });
        try { root.localStorage.setItem(CLIENT_AUTH_KEY, JSON.stringify(res)); } catch (_) {}
        return { ok: true, result: res };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    async clientAuthLogout() {
      saveSession(null);
      try { root.localStorage.removeItem(CLIENT_AUTH_KEY); } catch (_) {}
      return { ok: true, result: { authenticated: false } };
    },

    // Header balance: the account service's credit snapshot, not the compute
    // control plane's capability snapshot. The header re-reads this after charges.
    async clientAuthAccountDetails() {
      const checkedSession = currentSession();
      if (!checkedSession) return { ok: false, httpStatus: 401, error: '请先登录账号' };
      try {
        const profile = await auth('GET', '/api/client/bootstrap');
        if (currentSession()?.token !== checkedSession.token)
          return { ok: false, errorCode: 'account-session-changed', error: '登录状态已变化，请重新刷新账号信息' };
        if (profile.ok === false) return { ok: false, error: profile.error || '账户信息读取失败' };
        // The header applies returned prices only after its independently
        // authenticated /me response matches this profile's account ID.
        return { ok: true, result: { user: profile.user, credits: profile.credits, providerQuotas: profile.providerQuotas, featureCreditPrices: profile.featureCreditPrices || null } };
      } catch (error) {
        return { ok: false, httpStatus: error.status, error: String(error.message || error) };
      }
    },

    async runtimeFeatures() {
      runtimeFeatureCheckedAt = Date.now();
      const epoch=computeNodeEpoch,nodeId=computeNode?.id || '',mode=taskMode(),sequence=++runtimeFeatureSequence;
      const sessionGuard=captureFoartSessionGuard();
      const current=()=>epoch===computeNodeEpoch && nodeId===(computeNode?.id || '') && mode===taskMode() && sequence===runtimeFeatureSequence;
      let answered = false;
      try {
        const caps = await control('GET', '/api/web/capabilities');
        const next = caps && caps.features && typeof caps.features === 'object' ? { ...caps.features } : {};
        const hasBusiness=Object.hasOwn(next,'qwen35BusinessTrial');
        if(current()){
          qwenBusinessVerified=next.qwen35BusinessTrial===true;
          qwenNativeV3Binding=mode==='shared' && !!nodeId && typeof sessionGuard==='function' && sessionGuard() && next.qwen21NativeRewriteV3===true ? {nodeId,epoch,sessionGuard} : null;
          qwenImageEditBinding=mode==='shared' && !!nodeId && typeof sessionGuard==='function' && sessionGuard() && next.qwen21LocalImageEdit===true && next.qwen21LocalImageEditOwnerLeaseBound===true ? {nodeId,epoch,sessionGuard} : null;
        }
        delete next.qwen21NativeRewriteV3;
        delete next.qwen21LocalImageEdit; delete next.qwen21LocalImageEditOwnerLeaseBound;
        // Only the new business field gets strict source/sequence ordering.
        // Existing capability fields retain their previous response semantics.
        delete next.qwen35BusinessTrial;
        if(qwenBusinessVerified || hasBusiness)next.qwen35BusinessTrial=qwenBusinessVerified;
        if (taskMode() === 'shared') next.qwenImage21 = true;
        answered = true;
        setRuntimeFeatureCache(next);
      } catch (_) {
        if(current()){
          qwenBusinessVerified=false;
          qwenNativeV3Binding=null;
          qwenImageEditBinding=null;
          const next={...runtimeFeatureCache};delete next.qwen35BusinessTrial;setRuntimeFeatureCache(next);
        }
      }
      if (answered && runtimeFeatureCache.qwenImage21 === true) runtimeFeatureRetries = 0;
      else scheduleRuntimeFeatureRetry();
      return { ...runtimeFeatureCache };
    },
    runtimeFeaturesSync() {
      return { ...runtimeFeatureCache };
    },
    qwenBusinessAvailableSync(){return qwenBusinessAvailable();},
    qwen21NativeRewriteV3AvailableSync(){return qwen21NativeRewriteV3Available();},
    qwen21LocalImageEditAvailableSync(){return qwen21LocalImageEditAvailable();},
    onlineBusinessAvailableSync(){return XIAOTAO_ONLINE_ART_RELEASE_ENABLED;},
    onlineTextArtAvailableSync(){return XIAOTAO_ONLINE_TEXT_ART_RELEASE_ENABLED;},
    onlineVisionArtAvailableSync(){return XIAOTAO_ONLINE_VISION_ART_RELEASE_ENABLED;},
    onlineVideoVisionAvailableSync(){return XIAOTAO_H3_VISION_RELEASE_ENABLED;},
    captureFoartSessionGuard,
    artImageBindingAvailable,
    prepareArtImageBinding,
    stageArtBoundReference,
    discardArtImageBinding,
    verifyQwenPlanResponse,
    captureFoartNodeGuard(){
      const id=computeNode?.id,epoch=computeNodeEpoch,mode=taskMode();
      return id && mode==='shared' ? ()=>taskMode()===mode && computeNode?.id===id && computeNodeEpoch===epoch : null;
    },
    captureFoartBillingOwner,

    async clientAuthBootstrap() {
      try {
        const me = await control('GET', '/api/web/me');
        const caps = await control('GET', '/api/web/capabilities');
        return {
          ok: true,
          result: {
            user: me.user,
            credits: me.credits,
            ai: { ok: true, result: { providers: [], models: caps.models || [], settings: {} } }
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    // ---- capabilities the Web line does not have --------------------------
    // Declared so the renderer's feature checks pass, and answered honestly so
    // a panel that depends on one says why instead of hanging.
    licenseGetState: async () => computeMode === 'local' ? localControl('GET', '/local/license') : ({
      ok: true,
      result: { state: 'web', authorized: true, permissions: ['web'] }
    }),
    runtimeOpenOutputFolder: async () => root.NovaFlowWebWarehouse
      ? root.NovaFlowWebWarehouse.open() : ({ ok: false, error: '仓库组件未加载，请刷新网页后重试' }),
    runtimeFreeMemory: async () => ({ ok: true, result: {} }),
    promptAssistantGetStatus: async (payload={}) => taskMode() === 'local' && !pooledPromptRequests.has(payload.requestId)
      ? localControl('GET', '/local/prompt-assistant/status').catch(error => ({ ok: false, enabled: false, error: String(error.message || error) }))
      : pooledPromptStatus(payload),
    promptAssistantOptimizePrompt: async (payload) => selectedBusinessPrompt('optimize-prompt', payload),
    promptAssistantUiDesignCpu: async (payload) => {
      // The old node rejects the deliberately empty image record during normalization, before any model work.
      // Reuse the supported task action, without adding a control-plane permission.
      const scope={surface:'ui-design',uiPlanner:'grok-vision-cpu-v1'};
      const hello=await localPromptAssistant('reverse-image-prompt',{...scope,action:'capabilities',images:[{dataUrl:''}]});
      if(hello?.data?.protocol!=='nf.ui.grok-cpu.v1')return {ok:false,error:'请更新 Foart后使用完整在线分析；本次未调用云模型或本地推理'};
      if(payload?.action==='capabilities')return hello;
      return localPromptAssistant('reverse-image-prompt',{...payload,...scope});
    },
    promptAssistantReverseImagePrompt: async (payload) => selectedBusinessPrompt('reverse-image-prompt', payload),
    promptAssistantCancelRequest: async (payload) => cancelPromptAssistantRequest(payload),
    companionPricing,
    foartOperationStart,
    foartOperationResume,
    foartOperationCancel,
    artAgentChat: async (payload, guard={}) => payload?.foartAnimationStage==='rotation_candidate' && (taskMode()!=='shared' || payload?.provider!=='local' || payload?.modelId!=='qwen3.5-9b-heretic' || payload?.mode!=='foart' || !Array.isArray(payload?.images) || payload.images.length!==0 || typeof guard.isCurrent!=='function' || guard.isCurrent()!==true)
      ? {ok:false,error:'Qwen 动画候选尚未安全开放，未提交或修改作品。'} : payload?.provider === 'api' ? companionCloudChat(payload) : taskMode() === 'local'
      ? localControl('POST', '/local/prompt-assistant/art-agent-chat', {...payload,accountId:currentSession()?.user?.id || '',accountToken:currentSession()?.token || ''}, PROMPT_ASSISTANT_TIMEOUT_MS)
          .catch(error => ({ ok: false, error: String(error.message || error) }))
      : localPromptAssistant('art-agent-chat',payload || {},guard),
    artAgentStop: async (payload) => payload?.provider === 'api' ? stopCompanionCloud(payload) : !pooledPromptRequests.has(payload?.requestId) && taskMode() === 'local'
      ? localControl('POST', '/local/prompt-assistant/art-agent-stop', payload || {}, PROMPT_ASSISTANT_TIMEOUT_MS)
          .catch(error => ({ ok: false, error: String(error.message || error) }))
      : cancelPromptAssistantRequest(payload || {}),
    // 万物迁移 names the scene's style from this when it exists and paints without it otherwise.
    promptAssistantDescribeArtStyle: async (payload) => selectedBusinessPrompt('describe-art-style', payload),
    promptAssistantRewriteAudioPrompt: async (payload) => selectedBusinessPrompt('rewrite-audio-prompt', {...payload,assistantSelectionScope:'xiaotao'}),
    promptAssistantUiDraft: async (payload) => selectedBusinessPrompt('ui-draft-prompt', {...payload,assistantSelectionScope:'xiaotao'}),
    promptAssistantVideoDraft: async (payload) => selectedBusinessPrompt('video-draft-prompt', {...payload,assistantSelectionScope:'xiaotao'}),

    async smartAiPromptOptimize(payload) {
      try { return { ok: true, result: await auth('POST', '/api/client/grok/prompt-optimize', payload, SMART_AI_TIMEOUT_MS) }; }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },
    async smartAiImageReverse(payload) {
      try { return { ok: true, result: await auth('POST', '/api/client/grok/image-reverse', payload, SMART_AI_TIMEOUT_MS) }; }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },
    // Disabled until the corresponding server contract and auth are deployed.
    confirmedArtImageAvailableSync(){return false;},
    async runningHubGptImageQuote(payload, options={}) {
      try {
        if(payload?.contract==='confirmed-reference-v1'){
          const signal=options.signal;
          if(!signal || typeof AbortSignal?.any!=='function'||typeof AbortSignal?.timeout!=='function')throw Error('confirmed-art-cancellation-unavailable');
          return {ok:true,result:await api(CONFIG.authUrl,'POST','/api/client/runninghub/gpt-image/quote',payload,20000,AbortSignal.any([signal,AbortSignal.timeout(20000)]))};
        }
        return {ok:true,result:await auth('POST','/api/client/runninghub/gpt-image/quote',payload||{},20000)};
      }catch(error){return {ok:false,error:String(error.message||error)};}
    },
    async runningHubGptImage(payload, options={}) {
      try {
        if(payload?.contract==='confirmed-reference-v1'){
          const signal=options.signal;
          if(!signal || typeof AbortSignal?.any!=='function'||typeof AbortSignal?.timeout!=='function')throw Error('confirmed-art-cancellation-unavailable');
          return {ok:true,result:await api(CONFIG.authUrl,'POST','/api/client/runninghub/gpt-image',payload,180000,AbortSignal.any([signal,AbortSignal.timeout(180000)]))};
        }
        return {ok:true,result:await auth('POST','/api/client/runninghub/gpt-image',payload||{},180000)};
      }catch(error){return {ok:false,error:String(error.message||error)};}
    },

    async qwenLoraCatalog(payload = {}) {
      try { return await control('GET', '/api/web/loras/qwen?nsfw=' + (payload.nsfw === true) + '&engine=qwen-2.1' + (payload.variant === 'turbo' ? '&variant=turbo' : '')); }
      catch (error) { return { ok: false, error: String(error.message || error), items: [] }; }
    },
    async minimaxH3LoraCatalog(payload = {}) {
      try { return await control('GET', '/api/web/loras/h3?mode=' + encodeURIComponent(payload.mode || 'i2v') + '&steps=' + encodeURIComponent(payload.steps || 4)); }
      catch (error) { return { ok: false, error: String(error.message || error), items: [] }; }
    },
    async minimaxH3LoraValidate(payload) {
      try { return await control('POST', '/api/web/loras/h3/validate', payload); }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },
    async minimaxH3OutputPublish(payload) {
      const task = tasks.get(String(payload && payload.promptId || ''));
      const filename = String(payload && payload.filename || '');
      const file = task && ((task.output_manifest && task.output_manifest.files) || []).find(f => f.name === filename);
      if (!file || !/\.(mp4|webm)$/i.test(filename)) return { ok: false, error: '找不到当前任务的视频结果' };
      // Match the history preview identity so publishing updates its resource
      // card instead of displaying a second copy of the same output.
      const id = task.id + ':output::' + filename;
      const item = {
        id, runtimeKind: 'minimax_h3_local', type: 'local', promptId: task.id,
        fileName: filename, localPath: 'web-output://' + task.id + '/' + encodeURIComponent(filename),
        mimeType: mimeFor(filename), sourceKind: 'minimax_h3_output', createdAt: Date.now(),
        mediaDurationSec: payload.mediaDurationSec, generationElapsedSec: payload.generationElapsedSec
      };
      videoOutputs.delete(id);
      videoOutputs.set(id, item);
      while (videoOutputs.size > 30) videoOutputs.delete(videoOutputs.keys().next().value);
      return { ok: true, item };
    },
    async minimaxH3OutputList() {
      return { ok: true, items: [...videoOutputs.values()].reverse() };
    },
    async aiSeqReadTempFile(payload) {
      const item = [...videoOutputs.values()].find(value => value.localPath === String(payload && payload.path || ''));
      if (!item) return { ok: false, error: '当前页面没有此临时视频' };
      const reply = await electronAPI.runtimeRequestBinary({ path: '/view?filename=' + encodeURIComponent(item.fileName) });
      return reply.ok ? { ok: true, bytes: new Uint8Array(reply.result.data), mimeType: item.mimeType } : reply;
    },

    runtimeProviderUsageSettlement: 'web-control-plane-v1'
  };

  // ------------------------------------------------- local runtime probes
  //
  // The AI-sequence panel checks whether a ComfyUI is up before it lets you
  // generate. For images it asks through electronAPI, which we override. For
  // VIDEO it does not: it fetches http://127.0.0.1:8189/system_stats straight
  // from the page. On the desktop that is the right question. On the Web it
  // asks the VIEWER's machine - which has no runtime, and never will - so a
  // friend opening the site was told "未找到 MiniMax H3 Runtime（8189），
  // 请确认已安装并启动" about software they are not supposed to install.
  //
  // The honest answer to "is there a runtime" on the Web is "is there a
  // capable machine in the pool", so that is what these probes are answered
  // with. Only the two runtime ports are intercepted; the worker gateway on
  // 8790 and everything else goes through untouched.
  const LOCAL_RUNTIME = /^https?:\/\/(?:127\.0\.0\.1|localhost):(8188|8189)(\/|$)/i;
  const IMAGE_PROBE = 'image';
  const PORT_TASK_TYPE = { 8188: IMAGE_PROBE, 8189: 'h3_i2v' };

  function selectedImageProbeType() {
    return 'qwen21-turbo'; // the 普通 (BF16) line was removed on 2026-11-06
  }
  let capsCache = { at: 0, byTaskType: {} };
  async function poolHas(taskType) {
    const epoch=computeNodeEpoch,nodeId=computeNode?.id || '',mode=taskMode(),token=currentSession()?.token || '';
    const current=()=>epoch===computeNodeEpoch && nodeId===(computeNode?.id || '') && mode===taskMode() && token===(currentSession()?.token || '');
    const old=capsCache.context;
    if (Date.now() - capsCache.at > 8000 || !old || old.epoch!==epoch || old.nodeId!==nodeId || old.mode!==mode || old.token!==token) {
      const context={epoch,nodeId,mode,token};
      try {
        const caps = await control('GET', '/api/web/capabilities');
        if(!current())return 0;
        const byTaskType = {};
        for (const t of caps.taskTypes || []) byTaskType[t.task_type] = Number(t.available_workers || 0);
        const features=caps.features || {};
        byTaskType['qwen21-standard']=Number.isSafeInteger(features.qwenImage21Workers) && features.qwenImage21Workers>=0 ? features.qwenImage21Workers : features.qwenImage21===true ? 1 : 0;
        byTaskType['qwen21-turbo']=Number.isSafeInteger(features.qwenImage21TurboWorkers) && features.qwenImage21TurboWorkers>=0 ? features.qwenImage21TurboWorkers : features.qwenImage21Turbo===true ? 1 : 0;
        capsCache = { at: Date.now(), byTaskType, context };
      } catch (_) {
        if(current())capsCache = { at: Date.now(), byTaskType: {}, context };
        else return 0;
      }
    }
    return Number(capsCache.byTaskType[taskType] || 0);
  }

  const nativeFetch = root.fetch.bind(root);
  root.fetch = async function (input, init) {
    const url = String(input && input.url ? input.url : input || '');
    const m = LOCAL_RUNTIME.exec(url);
    if (!m) return nativeFetch(input, init);

    const port = m[1];
    const taskType = PORT_TASK_TYPE[port];
    const path = url.slice(url.indexOf(port) + port.length).split('?')[0] || '/';

    // Reference images. Same shape of bug as the probe: the panel POSTs the
    // file straight to http://127.0.0.1:8189/upload/image instead of going
    // through electronAPI.runtimeUploadImage, so the override never applied
    // and the file was offered to a ComfyUI on the viewer's machine - which
    // is not where the task will run even when one is there.
    //
    // Route it to the same queue runtimeUploadImage feeds, so the bytes end up
    // on whichever worker the scheduler picks, and answer in the shape the
    // caller reads back ({ data: { name } }).
    if (path === '/upload/image' || path === '/api/upload/image' || path === '/upload/mask') {
      try {
        const form = init && init.body ? init.body : (input && input.body);
        let file = null;
        let filename = 'reference.png';
        if (form && typeof form.get === 'function') {
          file = form.get('image') || form.get('file') || form.get('mask');
          if (file && file.name) filename = file.name;
        }
        if (!file || typeof file.arrayBuffer !== 'function') {
          return new Response(JSON.stringify({ error: '上传内容读不出来（没有找到图片字段）' }),
            { status: 400, headers: { 'content-type': 'application/json' } });
        }
        const bytes = await file.arrayBuffer();
        const res = await electronAPI.runtimeUploadImage(filename, bytes);
        if (!res || !res.ok) {
          return new Response(JSON.stringify({ error: String((res && res.error) || '上传失败') }),
            { status: 502, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          name: res.result.name,
          subfolder: res.result.subfolder || '',
          type: res.result.type || 'input'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error && error.message ? error.message : error) }),
          { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }

    if (path === '/system_stats' || path === '/') {
      const probeType = taskType===IMAGE_PROBE ? selectedImageProbeType() : taskType;
      const workers = await poolHas(probeType);
      if(taskType===IMAGE_PROBE && probeType!==selectedImageProbeType()) return new Response(JSON.stringify({ok:false,error:'绘图模型已变化，请重试'}),{status:409,headers:{'content-type':'application/json'}});
      if (!workers) {
        // Fail the probe, so the panel does not offer to generate on compute
        // that is not there. The wording the panel shows is rewritten for the
        // Web build; see tools/build-web-renderer.mjs.
        return new Response(JSON.stringify({ ok: false, error: 'no capable compute node online' }),
          { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        system: {
          os: 'novaflow-web',
          comfyui_version: 'novaflow-web-pool',
          python_version: '',
          ram_total: 0,
          ram_free: 0
        },
        devices: [{ name: workers + ' 台算力节点', type: 'cuda', index: 0, vram_total: 0, vram_free: 0 }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // Video panels use fetch directly. Route submission, polling and output
    // downloads through the same adapter as the image tools, keeping queries.
    const target = new URL(url);
    const cleanPath = target.pathname.replace(/^\/api\//, '/');
    if (cleanPath === '/view') {
      const reply = await electronAPI.runtimeRequestBinary({ baseUrl: target.origin, path: target.pathname + target.search });
      return new Response(reply.ok ? reply.result.data : JSON.stringify({ error: reply.error }), {
        status: reply.ok ? 200 : (reply.status || 502),
        headers: { 'content-type': reply.ok ? reply.contentType : 'application/json' }
      });
    }
    if (/^\/(?:prompt|history(?:\/[^/]+)?|queue|interrupt)$/.test(cleanPath)) {
      let requestInit = init || {};
      if (input && typeof input.clone === 'function' && !init) {
        requestInit = { method: input.method };
        if (!/^(GET|HEAD)$/i.test(input.method)) requestInit.body = await input.clone().text();
      }
      const reply = await electronAPI.runtimeRequestJson({ baseUrl: target.origin, path: target.pathname + target.search, init: requestInit });
      return new Response(JSON.stringify(reply.ok ? reply.data : { error: reply.error }), {
        status: reply.status || (reply.ok ? 200 : 502), headers: { 'content-type': 'application/json' }
      });
    }

    // Anything else aimed at a local runtime is a request this browser has no
    // business making. Say so rather than letting it hang on a dead port.
    return new Response(JSON.stringify({
      ok: false,
      error: '该请求应由算力节点执行'
    }), { status: 503, headers: { 'content-type': 'application/json' } });
  };

  // ------------------------------------------------------------------ expose
  // These are the proxy-electron-api contracts the existing UI consumes.
  // Keep result for compatibility, but data is what the editor actually reads.
  for (const name of ['runtimeRequestJson', 'runtimeGetSystemStats', 'runtimeUploadImage']) {
    const implementation = electronAPI[name];
    electronAPI[name] = async function (...args) {
      const reply = await implementation(...args);
      if (reply && reply.ok && reply.result !== undefined) reply.data = reply.result;
      return reply;
    };
  }
  // Override, never replace. Anything the renderer's own implementation
  // provides and we do not is left alone.
  const existing = root.electronAPI || (root.electronAPI = {});
  const overridden = [];
  for (const [key, value] of Object.entries(electronAPI)) {
    if (typeof existing[key] !== 'undefined') overridden.push(key);
    existing[key] = value;
  }
  root.__novaflowWebOverrides = overridden;

  root.NovaFlowWebRuntime = {
    config: CONFIG,
    version: '0.2.0',
    // Aliases to the same guarded helpers already exposed on electronAPI.
    artImageBindingAvailable,
    prepareArtImageBinding,
    stageArtBoundReference,
    discardArtImageBinding,

    /** Called by every redacted graph builder. */
    serverOnly(module, fn, args) {
      const options = module === 'spine-split-runtime' || module === 'novaflow-brand-runtime'
        ? { __args: Array.from(args || []) }
        : args && args[0];
      const intent = recordIntent({ module: module, method: fn, options });
      const marker = {
        __novaflowServerOnly: true,
        module: intent.module,
        fn: intent.method,
        options: intent.options
      };

      // Callers disagree about what a builder returns, because on the desktop
      // getWorkflowJson() hands back a JSON STRING while other paths use the
      // graph object. A plain object broke the video panel with
      //   workflow JSON 解析失败："[object Object]" is not valid JSON
      // because it does JSON.parse on the result.
      //
      // So this is both: a String carrying the JSON text, with the marker's
      // own properties on it. JSON.parse(result) works, result.module works,
      // and isIntent() still recognises it.
      let out;
      try {
        out = new String(JSON.stringify(marker));
        Object.assign(out, marker);
      } catch (_) {
        return marker;
      }
      return out;
    },

    /** Called by the generated stubs. */
    recordWorkflowIntent(intent) {
      return recordIntent(intent);
    },

    recordArtReferenceControl(workflow, uploadedNames, rolePlan) {
      if (!isIntent(workflow)) throw new Error('missing Web art workflow intent');
      // The graph builder only needs the reference roles and ControlNet model
      // names. The original plan also carries each image's dataUrl, which is
      // uploaded separately and must never be embedded in the task JSON.
      if (!Array.isArray(rolePlan?.conditioning) || !rolePlan.conditioning.length) {
        if (workflow.options) delete workflow.options.__controlNet;
        return { applied: 0 };
      }
      const shortText = (value, limit) => typeof value === 'string' && !/^data:/i.test(value)
        ? value.slice(0, limit) : '';
      workflow.options.__controlNet = {
        capabilities: {
          controlNetNames: Array.isArray(rolePlan.capabilities?.controlNetNames)
            ? rolePlan.capabilities.controlNetNames.map((name) => shortText(name, 256)).filter(Boolean).slice(0, 32)
            : []
        },
        conditioning: rolePlan.conditioning.map((item) => ({
          sourceIndex: Number.isInteger(item?.sourceIndex) ? item.sourceIndex : null,
          role: shortText(item?.role, 64),
          processor: shortText(item?.processor, 64)
        }))
      };
      return { applied: 0 };
    },

    get lastWorkflowIntent() { return lastIntent; },
    get session() { return session; },
    setSession: saveSession,
    tasks: tasks,
    control: control,
    localControl,
    // Exposed for capability shims that submit their own tasks rather than a
    // recorded graph intent - novaflow-web-capabilities.js's AI 抠图 is the
    // first. They are the module's own helpers, not a new protocol.
    waitForAssignment,
    grantFor,
    putTaskInput,
    fetchTaskOutput,
    get computeMode() { return taskMode(); },
    get localAssistant() { return !!CONFIG.localAssistant; },
    get computeNode() { return computeNode ? { id: computeNode.id, name: computeNode.name } : null; },
    // Pin work to one pool node (null: back to the launcher's default). Remembered per browser.
    setComputeNode(node) {
      const next = node && NODE_ID.test(String(node.id)) ? { id: String(node.id), name: String(node.name || '') } : null;
      computeNodeEpoch++;
      computeNode = next;
      try {
        if (next) root.localStorage.setItem(NODE_KEY, JSON.stringify(next));
        else root.localStorage.removeItem(NODE_KEY);
      } catch (_) { /* private mode */ }
      // Every cached answer spoke for the previous source.
      capsCache = { at: 0, byTaskType: {} };
      runtimeFeatureCache = taskMode() === 'shared' ? { qwenImage21: true } : {};
      qwenBusinessVerified=false;
      qwenNativeV3Binding=null;
      runtimeFeatureRetries = 0;
      electronAPI.runtimeFeatures();
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('novaflow:compute-node', { detail: next }));
      }
      return next;
    },
    listComputeNodes: () => control('GET', '/api/web/nodes'),
    auth: auth,
    fileUrl: (name) => electronAPI.runtimeFileUrl(name),
    isWeb: true
  };
  // Warm the feature snapshot so panels that size themselves synchronously
  // (the UI-design reference limit) see the node's answer; runs re-check it.
  if (root.NOVAFLOW_LIGHT_HOME !== true) electronAPI.runtimeFeatures();
  if (root.NOVAFLOW_LIGHT_HOME !== true && typeof root.addEventListener === 'function') {
    root.addEventListener('focus', () => {
      if (Date.now() - runtimeFeatureCheckedAt > 10000) electronAPI.runtimeFeatures();
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

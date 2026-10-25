(function (root) {
  'use strict';
  const STORAGE_KEY = 'novaflow.xiaotao-art.chat.v1';
  const SETTINGS = ['provider','mode','prompt','negativePrompt','width','height','seed','randomSeed','count','nsfw','samplingOverrides','loras','localDrawEngine','localQwen21Variant','drawingTask','drawingAnalysisEngine'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const fail = message => { throw new Error(message); };
  async function sha256(bytes) {return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');}
  function imageBytes(url) {
    const match = String(url || '').match(/^data:image\/(?:png|jpe?g|webp);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) fail('请使用完整的 PNG、JPEG 或 WebP 参考图');
    return Uint8Array.from(root.atob(match[1].replace(/\s/g, '')), c => c.charCodeAt(0));
  }
  async function fingerprint(snapshot) {
    const artContext = copy(snapshot.artContext);
    const images = await Promise.all(snapshot.images.map(async (img, i) => ({source:i + 1, role:i === 0 ? 'subject' : i === 1 ? 'style' : 'result', sha256:await sha256(imageBytes(img.dataUrl))})));
    return sha256(new TextEncoder().encode(JSON.stringify(canonical({schema:'nf.flash.art-agent.snapshot.v1', artContext, images}))));
  }
  function sameSnapshot(a, b) {
    return !!a && !!b && JSON.stringify(canonical(a.artContext)) === JSON.stringify(canonical(b.artContext))
      && a.images.length === b.images.length && a.images.every((img, i) => img.dataUrl === b.images[i].dataUrl && img.source === b.images[i].source && img.role === b.images[i].role);
  }
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
  function createTabScopedStorage(localStorage, sessionStorage) {
    const tabKey = STORAGE_KEY + ':tab-id', prefix = STORAGE_KEY + ':tab:', latestKey = STORAGE_KEY + ':latest-archive';
    const read = (storage, key) => {try {return storage?.getItem(key) ?? null;} catch {return null;}};
    const write = (storage, key, value) => {try {storage?.setItem(key, value);} catch {}};
    let tabId = read(sessionStorage, tabKey);
    if (!/^[\da-f-]{36}$/i.test(tabId || '')) {tabId = root.crypto.randomUUID(); write(sessionStorage, tabKey, tabId);}
    const archiveKey = prefix + tabId; let cached = null;
    const textOnly = (items, limit) => (Array.isArray(items) ? items : []).filter(m => ['user','assistant'].includes(m?.role) && typeof m.content === 'string').slice(-limit).map(({role, content}) => ({role, content}));
    return Object.freeze({
      getItem(key) {
        if (key !== STORAGE_KEY) return null;
        const own = read(localStorage, archiveKey) ?? cached; if (own !== null) return own;
        const latest = read(localStorage, latestKey), recent = latest?.startsWith(prefix) ? read(localStorage, latest) : null;
        for (const candidate of [recent, read(localStorage, STORAGE_KEY)]) {
          if (!candidate) continue;
          try {
            const source = JSON.parse(candidate), sessions = source.sessions || {local:source};
            cached = JSON.stringify({provider:source.provider === 'api' ? 'api' : 'local',sessions:Object.fromEntries(['local','api'].map(provider => [provider,{messages:textOnly(sessions[provider]?.messages,40),history:textOnly(sessions[provider]?.history,12),conversationId:''}]))});
            write(localStorage, archiveKey, cached); return cached;
          } catch {}
        }
        return null;
      },
      setItem(key, value) {if (key === STORAGE_KEY) {cached = value; write(localStorage, archiveKey, value); write(localStorage, latestKey, archiveKey);}}
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
    const snapshotOwners = new WeakMap();
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
      const filled = ctx.references.map((ref, i) => ref?.dataUrl ? {...ref, source:i + 1} : null).filter(Boolean);
      if (filled.length !== 2) fail('请保留两张参考图：一张主体，一张画风');
      const observed = direction().input({...ctx, state:{...s, drawingAnalysisEngine:'local'}}).references;
      let images = filled.map((ref, i) => {
        const seen = observed.find(r => r.source === ref.source), explicit = ref.drawingRole;
        const roles = explicit && explicit !== 'auto' ? [explicit] : seen?.roles || [];
        const completeContent = roles.includes('subject') && roles.every(r => ['subject','background','composition'].includes(r));
        let role = roles.includes('style') && !roles.includes('subject') ? 'style' : completeContent ? 'subject' : '';
        if (explicit === 'none' || seen?.excludedRoles?.length || roles.includes('subject') && roles.includes('style') || !completeContent && roles.some(r => ['pose','background','object','composition'].includes(r))) fail('这一版小桃AI只处理主体与画风参考，请先调整参考图用途');
        if (!role) role = i === 0 ? 'subject' : 'style';
        return {dataUrl:ref.dataUrl, name:ref.name || `参考图${ref.source}`, role, source:ref.source};
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
        images.push({dataUrl:lastResult.imageUrl, name:lastResult.name || '实际成图', role:'output', source:0});
      }
      const snapshot = {artContext, images, lastResult}; snapshotOwners.set(snapshot, s); return snapshot;
    }
    function clearPrepared() {applied = null; fixedRoles = null; runtime()?.clearAgentPrepared?.();}
    function captureChat() {
      let ctx; try {ctx = runtime()?.captureContext?.();} catch {}
      const artContext = {surface:ctx?.generationSurface || 'other'};
      if (ctx?.generationSurface === 'drawing') {
        runtime()?.capturePrompt?.();
        Object.assign(artContext, copy(Object.fromEntries(SETTINGS.filter(k => ctx.state[k] !== undefined).map(k => [k, ctx.state[k]]))));
      }
      return {artContext, images:[]};
    }
    async function applyProposal(proposal, snapshot) {
      if (runtime()?.state.running) fail('当前正在生成，请等待结束');
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
    return Object.freeze({capture, captureChat, applyProposal, generateApplied, clearPrepared, cancelGeneration:() => runtime()?.cancel?.()});
  }
  function createController({bridge, api = () => root.electronAPI, storage = root.localStorage, onChange = () => {}, timers = root}) {
    const state = {provider:'local', mode:'chat', messages:[], history:[], conversationId:'', proposal:null, proposalSnapshot:null, applied:false, applying:false, pending:false, generating:false, status:'', error:'', model:'本地 Flash', toolTrace:[], localSession:null};
    let serial = 0, activeRequest = '', activeSnapshot = null, activeMode = 'chat', stopped = false, statusTimer = null;
    const sessions = {local:{messages:[],history:[],conversationId:''}, api:{messages:[],history:[],conversationId:''}};
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (saved) {if (saved.sessions) Object.assign(sessions, saved.sessions); else sessions.local = saved;}
      for (const item of Object.values(sessions)) item.messages = (item.messages || []).filter(m => ['user','assistant'].includes(m.role) && typeof m.content === 'string').slice(-40);
      const previousProvider = saved?.provider === 'api' ? 'api' : 'local';
      Object.assign(state, sessions[previousProvider]);
      if (previousProvider !== state.provider) state.conversationId = '';
    } catch {}
    function notify() {
      sessions[state.provider] = {messages:state.messages.slice(-60),history:state.history,conversationId:state.conversationId};
      try {storage?.setItem(STORAGE_KEY, JSON.stringify({provider:state.provider, sessions:Object.fromEntries(Object.entries(sessions).map(([key, value]) => [key,{...value,messages:value.messages.map(({role, content}) => ({role, content}))}]))}));} catch {}
      onChange(state);
    }
    function stopStatusPolling() {if (statusTimer !== null) {timers.clearTimeout(statusTimer); statusTimer = null;}}
    function updateLocalSession(session, pending = false) {
      if (!session || !['cold','loading','answering','warm','releasing','fault'].includes(session.state)) return;
      state.localSession = copy(session);
      if (pending) {
        const label = {cold:'正在准备本地模型…',loading:'加载本地模型… 首次启动的等待主要来自模型载入',answering:state.mode === 'chat' ? '小桃正在回答…' : '小桃正在分析当前绘图…',warm:'本地模型已就绪，正在等待回答…',releasing:'正在释放本地模型资源…',fault:'本地模型状态异常，等待任务返回具体信息'}[session.state];
        if (state.status !== label) {state.status = label; onChange(state);}
      }
    }
    function startStatusPolling(operation, requestId) {
      stopStatusPolling();
      if (state.provider !== 'local' || typeof api()?.promptAssistantGetStatus !== 'function') return;
      const current = () => operation === serial && activeRequest === requestId && state.pending && state.provider === 'local' && !stopped;
      const poll = async () => {
        statusTimer = null; if (!current()) return;
        try {
          const response = await api().promptAssistantGetStatus();
          if (!current()) return;
          const data = response?.result || response?.data || response, session = data?.chatSession;
          if (response?.ok !== false && data?.ok !== false && (!session?.activeRequestId || session.activeRequestId === requestId)) updateLocalSession(session, true);
        } catch {}
        if (current()) statusTimer = timers.setTimeout(poll, 1500);
      };
      void poll();
    }
    async function calibrateLocalStatus() {
      if (state.provider !== 'local' || state.pending || state.generating || state.applying || typeof api()?.promptAssistantGetStatus !== 'function') return;
      const operation = serial;
      try {
        const response = await api().promptAssistantGetStatus();
        if (operation !== serial || state.provider !== 'local' || state.pending || state.generating || state.applying) return;
        const data = response?.result || response?.data || response;
        if (response?.ok === false || data?.ok === false) return;
        updateLocalSession(data?.chatSession); onChange(state);
      } catch {}
    }
    function invalidate(message = '绘图内容已变化，原建议已失效') {if (state.proposal || state.applied) {bridge.clearPrepared(); state.proposal = null; state.proposalSnapshot = null; state.applied = false; state.status = message; notify();}}
    function refreshContext() {
      if (state.localSession?.state === 'warm' && Number.isFinite(state.localSession.idleExpiresAt) && state.localSession.idleExpiresAt <= Date.now()) {state.localSession = null; onChange(state);}
      try {const old = state.proposalSnapshot || (activeMode === 'drawing' ? activeSnapshot : null); if (old && !sameSnapshot(old, bridge.capture({includeResult:old.images.length === 3}))) {invalidate(); if (state.pending && !stopped) void stop();}}
      catch {invalidate('页面已切换，原建议已失效'); if (state.pending && !stopped) void stop();}
    }
    async function send(message, {includeResult = false} = {}) {
      if (state.pending || state.generating || state.applying) return false;
      message = String(message || '').trim(); if (!message) return false;
      if (/^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$/.test(message)) {reset(); return true;}
      if (!includeResult && !/(?:不要|不用|别|无需|不必).*(?:评价|评估|点评|分析|检查|看看)/.test(message)) includeResult = /(?:评价|评估|点评|分析|检查|看看|看一下|看下).{0,10}(?:当前|这张|本次|刚生成|最新).{0,6}(?:成图|出图|结果|图片|图)|(?:当前|这张|本次|刚生成|最新).{0,6}(?:成图|出图|结果|图片|图).{0,10}(?:怎么样|如何|问题|不足|评价|评估|点评|分析|检查)/.test(message);
      const operation = ++serial; stopped = false; state.error = ''; bridge.clearPrepared(); state.proposal = null; state.proposalSnapshot = null; state.applied = false;
      try {
        let snapshot, mode = 'chat';
        if (state.provider === 'local') {try {snapshot = bridge.capture({includeResult}); mode = 'drawing';} catch (error) {if (includeResult) throw error;}}
        if (!snapshot) snapshot = bridge.captureChat();
        activeSnapshot = snapshot; activeMode = mode; state.mode = mode; state.pending = true;
        if (includeResult && state.provider === 'api') fail('在线智能当前只支持文字对话；请切换本地智能查看实际成图');
        state.status = includeResult ? '正在查看实际成图…' : state.provider === 'api' ? '小桃正在连接在线智能…' : '正在连接本地助手…';
        state.messages.push({role:'user', content:message}); notify();
        const contextFingerprint = mode === 'drawing' ? await fingerprint(snapshot) : undefined; if (operation !== serial || stopped) return false;
        activeRequest = root.crypto.randomUUID();
        const payload = {requestId:activeRequest, provider:state.provider, mode, conversationId:state.conversationId || undefined, message, history:copy(state.history), artContext:copy(snapshot.artContext), ...(state.provider === 'local' ? {images:copy(snapshot.images)} : {}), ...(contextFingerprint ? {contextFingerprint} : {})};
        if (typeof api()?.artAgentChat !== 'function') fail('小桃AI接口尚未就绪，请刷新页面或启动本地助手');
        const responsePromise = api().artAgentChat(payload); startStatusPolling(operation, activeRequest);
        const response = await responsePromise;
        if (operation !== serial || stopped) return false;
        if (!response?.ok) {
          if (['unknown-conversation', 'flash-agent-unknown-conversation'].includes(response?.errorCode)) {state.conversationId = ''; fail('服务已重启，文字对话已保留。再次发送可重新连接小桃。');}
          fail(response?.error || '小桃暂时未能完成分析，请稍后再试');
        }
        const data = response.data; if (!data || typeof data.reply !== 'string') fail('小桃没有返回完整回复，请重试');
        if (state.provider === 'local') {state.localSession = null; updateLocalSession(data.chatSession);}
        state.messages.push({role:'assistant', content:data.reply}); state.conversationId = data.conversationId || state.conversationId;
        if (Array.isArray(data.history)) state.history = copy(data.history);
        state.toolTrace = Array.isArray(data.toolTrace) ? copy(data.toolTrace) : []; state.model = String(data.proposal?.model || data.model || '本地 Flash');
        const unchanged = mode === 'chat' || sameSnapshot(snapshot, bridge.capture({includeResult}));
        if (mode === 'drawing' && data.proposal && unchanged && data.proposal.contextFingerprint === contextFingerprint) {state.proposal = copy(data.proposal); state.proposalSnapshot = snapshot; state.status = '建议已准备，可查看或应用';}
        else state.status = !unchanged ? '当前绘图已变化，这次回复中的建议未应用' : mode === 'chat' && state.provider === 'local' && snapshot.artContext.surface === 'drawing' ? '已回复 · 当前仅对话，尚未形成可生图双图上下文' : '已回复';
        return true;
      } catch (error) {if (operation === serial && !stopped) {state.error = String(error?.message || error); state.status = '未提交生成';} return false;}
      finally {if (operation === serial) {stopStatusPolling(); state.pending = false; activeRequest = ''; activeSnapshot = null; notify();}}
    }
    async function stop() {
      if (state.generating) {state.status = '正在停止生成…'; notify(); await bridge.cancelGeneration(); return;}
      if (!state.pending || stopped) return;
      stopped = true; stopStatusPolling(); const requestId = activeRequest; state.localSession = null; state.status = state.provider === 'api' ? '正在停止等待在线回复…' : '正在停止小桃…'; notify();
      try {if (requestId) {const result = await api()?.artAgentStop?.({requestId,provider:state.provider}); if (!result?.ok) fail(result?.error || '停止尚未确认，请等待当前任务退出');} ++serial; state.pending = false; activeRequest = ''; activeSnapshot = null; state.status = state.provider === 'api' ? '已停止等待本次回复；云端请求和计次可能已发生' : '已停止';}
      catch (error) {state.error = String(error?.message || error); state.status = '停止尚未确认';}
      notify();
    }
    async function apply({generate = false} = {}) {
      if (!state.proposal || state.pending || state.generating || state.applying) return false;
      state.error = ''; state.applying = true; notify();
      try {
        if (!state.applied) {const result = await bridge.applyProposal(state.proposal, state.proposalSnapshot); state.proposalSnapshot = result.snapshot; state.applied = true;}
        state.status = '已应用到绘图，保留原负向和手动参数'; notify();
        if (generate) {
          state.generating = true; state.localSession = null; state.status = '正在通过绘图流程生成一张…'; notify();
          const result = await bridge.generateApplied(); state.messages.push({role:'assistant', content:'这张是本次实际成图，请看画面效果。', imageUrl:result.imageUrl, name:result.name});
          state.proposal = null; state.proposalSnapshot = null; state.applied = false; state.status = '已生成，等待你的评价';
        }
        return true;
      } catch (error) {state.error = String(error?.message || error); state.status = '未完成生成'; invalidate(); return false;}
      finally {state.generating = false; state.applying = false; notify();}
    }
    function reset() {if (state.pending || state.generating || state.applying) return; ++serial; bridge.clearPrepared(); for (const provider of ['local','api']) sessions[provider] = {messages:[],history:[],conversationId:''}; Object.assign(state, {messages:[], history:[], conversationId:'', proposal:null, proposalSnapshot:null, applied:false, error:'', toolTrace:[], status:state.mode === 'drawing' ? '新对话，将使用当前绘图内容' : '新对话，可以直接聊天'}); notify();}
    function setProvider(provider) {
      if (!['local','api'].includes(provider) || provider === state.provider || state.pending || state.generating || state.applying) return false;
      ++serial; notify(); bridge.clearPrepared(); activeSnapshot = null;
      Object.assign(state, {provider,conversationId:'',mode:'chat',proposal:null,proposalSnapshot:null,applied:false,error:'',toolTrace:[],model:provider === 'local' ? '本地 Flash' : 'API',status:provider === 'local' ? '已切换本地智能' : '已切换在线智能 · 文字对话，每次计入云AI次数'}); notify(); return true;
    }
    return Object.freeze({state, send, apply, stop, reset, setProvider, refreshContext, calibrateLocalStatus});
  }
  function mount() {
    if (!root.document?.body || root.document.getElementById('nf-xiaotao-art-root')) return;
    const doc = root.document, host = doc.createElement('div'); host.id = 'nf-xiaotao-art-root';
    const el = (tag, cls, text) => {const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;};
    const fab = el('button', 'nf-xiaotao-launcher nf-xiaotao-robot'); fab.type = 'button'; fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'nf-xiaotao-art-panel');
    fab.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6v7M13 32H7v13h7m37-13h6v13h-7M23 54v5m18-5v5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle class="nf-xiaotao-antenna" cx="32" cy="5" r="3"/><rect x="12" y="14" width="40" height="41" rx="14" fill="#3b3b3b" stroke="currentColor" stroke-width="2"/><rect x="18" y="23" width="28" height="20" rx="8" fill="#202020"/><g class="nf-xiaotao-eyes"><circle cx="25" cy="32" r="3"/><circle cx="39" cy="32" r="3"/></g><path d="M27 47h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const robotLabel = el('span', 'nf-xiaotao-robot-label', '小桃AI'), robotState = el('span', 'nf-xiaotao-robot-state', '待机'); fab.append(robotLabel, robotState);
    const greeting = el('div', 'nf-xiaotao-greeting'), greetingClose = el('button', '', '×'); greeting.hidden = true; greeting.setAttribute('role','status'); greeting.append(el('span','','你好，我是小桃AI，需要我帮助吗？'),greetingClose); greetingClose.type = 'button'; greetingClose.setAttribute('aria-label','关闭欢迎提示'); greetingClose.onclick = () => {greeting.hidden = true;};
    const panel = el('aside', 'nf-xiaotao-panel'); panel.id = 'nf-xiaotao-art-panel'; panel.hidden = true; panel.setAttribute('aria-label', '小桃AI对话');
    const header = el('header', 'nf-xiaotao-header'), title = el('div'), titleText = el('strong','','小桃AI'), model = el('small', '', '本地智能'), close = el('button', 'nf-xiaotao-icon', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭对话');
    title.append(titleText, model); header.append(title, close);
    const context = el('div', 'nf-xiaotao-context'), contextLabel = el('span'), thumbs = el('div', 'nf-xiaotao-thumbs'); context.append(contextLabel, thumbs);
    const messages = el('div', 'nf-xiaotao-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-label', '绘图对话');
    const intro = el('p', 'nf-xiaotao-intro', '你好，有什么需要我帮忙的吗？没有参考图也可以聊天。在绘图页添加主体与画风双图后，小桃还能给出可应用的绘图建议。'); messages.append(intro);
    const proposal = el('details', 'nf-xiaotao-proposal'), summary = el('summary', '', '查看绘图建议'), proposalText = el('pre'); proposal.hidden = true; proposal.append(summary, proposalText);
    const actions = el('div', 'nf-xiaotao-actions'), applyButton = el('button', '', '应用到绘图'), generateButton = el('button', 'nf-xiaotao-primary', '应用并生成一张'); for (const b of [applyButton, generateButton]) b.type = 'button'; actions.append(applyButton, generateButton); proposal.append(actions);
    const tools = el('div', 'nf-xiaotao-tools');
    const status = el('div', 'nf-xiaotao-status'); status.setAttribute('role', 'status'); const error = el('p', 'nf-xiaotao-error'); error.setAttribute('role', 'alert');
    const footer = el('form', 'nf-xiaotao-compose'), input = el('textarea'); input.rows = 3; input.placeholder = '有什么需要我帮助的？'; input.setAttribute('aria-label', '给智能助手的消息');
    const footerActions = el('div', 'nf-xiaotao-compose-actions'), providers = el('div', 'nf-xiaotao-brains'), localBrain = el('button', '', '本地智能'), onlineBrain = el('button', '', '在线智能'), stop = el('button', '', '停止'), send = el('button', 'nf-xiaotao-primary', '发送');
    providers.setAttribute('role','group'); providers.setAttribute('aria-label','切换AI大脑');
    for (const b of [localBrain, onlineBrain, stop]) b.type = 'button'; send.type = 'submit'; providers.append(localBrain, onlineBrain); footerActions.append(providers, stop, send); footer.append(input, footerActions);
    panel.append(header, context, messages, proposal, tools, status, error, footer); host.append(fab, greeting, panel); doc.body.append(host);
    const drag = bindPanelDrag(panel, header);
    const robotDrag = bindPanelDrag(fab, fab, {threshold:5,ignoreInteractive:false,onStart:() => {greeting.hidden = true;},onEnd:() => {if (open) anchorPanel();}});
    const bridge = createBridge(); let rendered = [], contextStamp = '', previewImages = [], open = false;
    const controller = createController({bridge, storage:createTabScopedStorage(root.localStorage, root.sessionStorage), onChange:render});
    function render(state) {
      if (state.messages.length !== rendered.length || state.messages.some((m, i) => m !== rendered[i])) {rendered = state.messages.slice(); messages.replaceChildren(); if (!state.messages.length) messages.append(intro); for (const m of state.messages) {const bubble = el('div', 'nf-xiaotao-message nf-xiaotao-' + m.role); bubble.append(renderMessageMarkdown(doc, m.content)); if (m.imageUrl && /^data:image\//.test(m.imageUrl)) {const link = el('a'); link.href = m.imageUrl; link.target = '_blank'; link.rel = 'noopener'; const image = el('img'); image.src = m.imageUrl; image.alt = '本次实际成图，待评价'; link.append(image); bubble.append(link);} messages.append(bubble);} messages.scrollTop = messages.scrollHeight;}
      const warm = state.localSession?.state === 'warm' && state.localSession.modelLoaded === true;
      model.textContent = state.provider === 'api' ? '在线智能 · 文字对话 · 每次计入云AI次数' : warm ? '本地智能 · 上次已就绪' : '本地智能';
      const activity = state.generating || state.applying ? 'working' : state.pending ? 'thinking' : 'idle';
      fab.dataset.state = activity; robotState.textContent = activity === 'working' ? '工作中' : state.provider === 'local' && state.pending ? ({loading:'加载中',answering:'回答中',releasing:'释放中',warm:'准备回答'}[state.localSession?.state] || '连接中') : state.pending ? '回答中' : state.provider === 'local' && warm ? '上次已就绪' : '待机'; fab.setAttribute('aria-label','小桃AI，'+robotState.textContent+'，点击聊天，可拖动');
      tools.textContent = [...new Set(state.toolTrace.map(step => step.name === 'get_art_context' ? '已读取当前绘图' : step.name === 'propose_art_direction' ? '已整理绘图建议' : '').filter(Boolean))].join(' · ');
      status.textContent = state.status; error.textContent = state.error; error.hidden = !state.error; proposal.hidden = !state.proposal;
      proposalText.textContent = state.proposal?.prompt || ''; const busy = state.pending || state.generating || state.applying; applyButton.disabled = busy || state.applied; generateButton.disabled = busy; send.disabled = busy; stop.hidden = !state.pending && !state.generating; input.disabled = busy;
      for (const [button, value] of [[localBrain,'local'],[onlineBrain,'api']]) {button.disabled = busy; button.setAttribute('aria-pressed',String(state.provider === value));}
    }
    function anchorPanel() {
      const robot = fab.getBoundingClientRect(), box = panel.getBoundingClientRect(), size = {width:box.width,height:box.height};
      drag.place(anchoredPanelPosition(robot, size, {width:root.innerWidth,height:root.innerHeight}), size);
    }
    const setOpen = value => {open = value; greeting.hidden = true; panel.hidden = !value; fab.setAttribute('aria-expanded', String(value)); if (value) {anchorPanel(); tick(); void controller.calibrateLocalStatus(); input.focus();}};
    fab.onclick = event => {if (robotDrag.consumeClick()) {event.preventDefault(); return;} setOpen(!open);}; close.onclick = () => setOpen(false); stop.onclick = () => void controller.stop(); applyButton.onclick = () => void controller.apply(); generateButton.onclick = () => void controller.apply({generate:true});
    for (const [button, value] of [[localBrain,'local'],[onlineBrain,'api']]) button.onclick = () => {if (controller.setProvider(value)) {contextStamp = ''; tick(); if (value === 'local') void controller.calibrateLocalStatus(); input.focus();}};
    footer.onsubmit = event => {event.preventDefault(); const text = input.value; if (text.trim()) {input.value = ''; void controller.send(text);}};
    input.onkeydown = event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); footer.requestSubmit();}};
    function tick() {
      if (drag.dragging() || robotDrag.dragging()) return;
      controller.refreshContext(); if (!open) return;
      if (controller.state.provider === 'api') {contextLabel.textContent = '在线智能当前仅支持文字对话，不会上传参考图。'; thumbs.replaceChildren(); previewImages = []; return;}
      try {const snapshot = bridge.capture(), stamp = JSON.stringify(snapshot.artContext); if (stamp !== contextStamp || snapshot.images.some((img, i) => img.dataUrl !== previewImages[i])) {contextStamp = stamp; previewImages = snapshot.images.map(img => img.dataUrl); contextLabel.textContent = `当前绘图 · ${snapshot.artContext.width} × ${snapshot.artContext.height} · 原负向与手动参数保留`; thumbs.replaceChildren(); for (const ref of snapshot.images) {const item = el('span'), img = el('img'); img.src = ref.dataUrl; img.alt = ref.role === 'subject' ? '当前主体原图' : '当前完整画风参考'; item.append(img, el('small', '', `图${ref.source} · ${ref.role === 'subject' ? '主体' : '画风'}`)); thumbs.append(item);}}}
      catch {const current = bridge.captureChat(); contextLabel.textContent = current.artContext.surface === 'drawing' ? '当前仅对话，尚未形成可生图双图上下文' : '普通对话 · 无需参考图'; if (previewImages.length) {thumbs.replaceChildren(); previewImages = [];}}
    }
    let greetingCount = 0;
    function greet() {
      if (open || doc.hidden || controller.state.pending || controller.state.generating || robotDrag.dragging() || greetingCount >= 3) return;
      greetingCount++; greeting.hidden = false; const rect = fab.getBoundingClientRect(), box = greeting.getBoundingClientRect();
      const at = clampPanelPosition({left:rect.right - box.width,top:rect.top - box.height - 10},{width:box.width,height:box.height},{width:root.innerWidth,height:root.innerHeight});
      Object.assign(greeting.style,{position:'fixed',left:at.left+'px',top:at.top+'px'}); root.setTimeout(() => {greeting.hidden = true;},6500);
    }
    root.setTimeout(greet,12000); root.setInterval(greet,300000);
    render(controller.state); root.setInterval(tick, 500); tick();
    root.NovaFlowXiaotaoArtAgent.panel = Object.freeze({open:() => setOpen(true), close:() => setOpen(false), controller});
  }
  root.NovaFlowXiaotaoArtAgent = {fingerprint, sameSnapshot, clampPanelPosition, anchoredPanelPosition, renderMessageMarkdown, createTabScopedStorage, bindPanelDrag, createBridge, createController, mount};
  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, {once:true}); else if (root.document?.body) mount();
})(typeof window !== 'undefined' ? window : globalThis);

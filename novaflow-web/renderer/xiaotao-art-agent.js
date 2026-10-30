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
  function executionIntent(message) {
    const text = String(message || '').trim().replace(/^(?:那就|就)(?=按|用|生成|生图|出图)/,'');
    // Execute only explicit user commands; questions, discussion and refusals
    // stay in the model's normal proposal/reply path.
    if (/[?？]|(?:能不能|可不可以|能否|是否|怎么|如何|为什么|什么|假如|如果)|吗[。！!]?\s*$/.test(text)
      || /(?:不要|不用|别|先不|暂不|不必|无需|不需要|不能).{0,8}(?:生成|生图|出图|执行|应用)/.test(text)) return null;
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
      const content = String(message.content || '');
      if (message.role === 'status' && /^(?:消息已发送，正在等待小桃回复|请求已收到，开始分析当前绘图)/.test(content)) continue;
      const receipt = message.role === 'status' && /^(?:本次)?实扣\s*\d+\s*(?:分|积分)/.test(content);
      const previous = rows[rows.length - 1];
      if (receipt && previous?.role === 'assistant') {
        previous.receipts.push(content);
        continue;
      }
      rows.push({...message, content, receipts:typeof message.receipt === 'string' && message.receipt ? [message.receipt] : [], ...(receipt ? {receiptOnly:true} : {})});
    }
    return rows;
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
    copy.onclick = () => void copyText(textPrompt ? textPrompt[1] : message.content, copy);
    label.append(el('span', '', message.role === 'user' ? '你' : '小桃AI'), copy);
    bubble.append(label, renderMessageMarkdown(doc, message.content));
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
    for (const receipt of message.receipts || []) {const note = el('small', 'nf-xiaotao-receipt', receipt); note.setAttribute('role', 'note'); bubble.append(note);}
    return bubble;
  }
  function createTabScopedStorage(localStorage, sessionStorage) {
    const tabKey = STORAGE_KEY + ':tab-id', prefix = STORAGE_KEY + ':tab:', latestKey = STORAGE_KEY + ':latest-archive';
    const read = (storage, key) => {try {return storage?.getItem(key) ?? null;} catch {return null;}};
    const write = (storage, key, value) => {try {storage?.setItem(key, value);} catch {}};
    let tabId = read(sessionStorage, tabKey);
    if (!/^[\da-f-]{36}$/i.test(tabId || '')) {tabId = root.crypto.randomUUID(); write(sessionStorage, tabKey, tabId);}
    const archiveKey = prefix + tabId; let cached = null;
    const textOnly = (items, limit, receipts = false) => (Array.isArray(items) ? items : []).filter(m => (receipts ? ['user','assistant','status'] : ['user','assistant']).includes(m?.role) && typeof m.content === 'string').slice(-limit).map(({role, content, receipt, level}) => ({role, content, ...(receipts && typeof receipt === 'string' && receipt ? {receipt} : {}), ...(receipts && level === 'error' ? {level} : {})}));
    return Object.freeze({
      getItem(key) {
        if (key !== STORAGE_KEY) return null;
        const own = read(localStorage, archiveKey) ?? cached; if (own !== null) return own;
        const latest = read(localStorage, latestKey), recent = latest?.startsWith(prefix) ? read(localStorage, latest) : null;
        for (const candidate of [recent, read(localStorage, STORAGE_KEY)]) {
          if (!candidate) continue;
          try {
            const source = JSON.parse(candidate), sessions = source.sessions || {local:source};
            cached = JSON.stringify({provider:source.provider === 'api' ? 'api' : 'local',sessions:Object.fromEntries(['local','api'].map(provider => [provider,{messages:textOnly(sessions[provider]?.messages,40,true),history:textOnly(sessions[provider]?.history,12),conversationId:''}]))});
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
    function captureChat({includeResult=false, drawingPreview=false}={}) {
      let ctx; try {ctx = runtime()?.captureContext?.();} catch {}
      const artContext = {surface:ctx?.generationSurface || 'other'};
      if (ctx?.generationSurface === 'drawing') {
        runtime()?.capturePrompt?.();
        Object.assign(artContext, copy(Object.fromEntries(SETTINGS.filter(k => ctx.state[k] !== undefined).map(k => [k, ctx.state[k]]))));
      }
      const images=ctx&&(ctx.generationSurface==='drawing'||drawingPreview)?(ctx.references||[]).map((ref,i)=>ref?.dataUrl?{source:i+1,role:ref.drawingRole&&ref.drawingRole!=='auto'?ref.drawingRole:'attachment',dataUrl:ref.dataUrl,referenceIdentity:referenceIdentity(ref),file:ref.file,mimeType:ref.mimeType,name:ref.name||'参考图',...imageDimensions(ref)}:null).filter(Boolean):[];
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
  function roundedCredits(value) {
    if (value == null || value === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount) : null;
  }
  function creditReceipt(quota) {
    if (!quota || quota.local) return '';
    const settled = roundedCredits(quota.settled_credits ?? quota.charged_credits);
    if (settled == null) return '';
    const unit = quota.billing_mode === 'token' ? '分' : '积分';
    const estimated = roundedCredits(quota.expected_credits ?? quota.estimated_credits);
    return `本次实扣 ${settled} ${unit}${estimated == null ? '' : `（预估 ${estimated}）`}`;
  }
  function createController({bridge, api = () => root.electronAPI, storage = root.localStorage, onChange = () => {}, timers = root, uploadHost = null} = {}) {
    const state = {provider:'local', mode:'chat', activeTask:null,messages:[], history:[], conversationId:'', proposal:null, proposalSnapshot:null, applied:false, applying:false, pending:false, generating:false, uploading:false, confirmation:null, samplingApproval:null, operation:null, status:'', error:'', model:'本地 Flash', toolTrace:[], localSession:null};
    const pricingKey = 'novaflow.xiaotao-pricing.v1';
    let metering = null;
    const pricingTtl = 15 * 60 * 1000;
    try {const saved = JSON.parse(root.localStorage?.getItem(pricingKey) || 'null'); if (saved && Date.now()-saved.updatedAt < pricingTtl) metering = saved;} catch {}
    function predictOnline(input) {
      if (metering && Date.now()-metering.updatedAt >= pricingTtl) metering = null;
      const prices = root.NovaFlowFeatureCreditPrices;
      return prices?.predictXiaotaoOnline?.({...input,model:metering?.model,config:metering?.config,samples:metering?.samples}) || prices?.estimateXiaotaoOnline?.(input);
    }
    function onlineQuote(message) {return predictOnline(onlineEstimateInput(message));}
    let serial = 0, activeRequest = '', activeSnapshot = null, activeMode = 'chat', stopped = false, statusTimer = null, activeStartedAt = 0, lastRequestMessage = '';
    let mediaAbort = null, promptAbort = null;
    const recapture = snapshot => snapshot.artContext.task === 'creation' ? bridge.captureCreation({includeResult:snapshot.images.some(i=>i.role==='result')}) : bridge.capture({includeResult:snapshot.images.length===3});
    const sessions = {local:{messages:[],history:[],conversationId:''}, api:{messages:[],history:[],conversationId:''}};
    state.learningTask = null; state.learningWarning = '';
    async function learningCommand(command) {
      if (typeof api()?.artLearning !== 'function') throw new Error('请更新本地助手后使用任务反馈');
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
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (saved) {if (saved.sessions) Object.assign(sessions, saved.sessions); else sessions.local = saved;}
      for (const item of Object.values(sessions)) item.messages = (item.messages || []).filter(m => ['user','assistant','status'].includes(m.role) && typeof m.content === 'string' && !/要放到哪里？请选择一个位置/.test(m.content)).slice(-40);
      const previousProvider = saved?.provider === 'api' ? 'api' : 'local';
      Object.assign(state, sessions[previousProvider]);
      if(saved?.activeTask && ['image','video','audio'].includes(saved.activeTask.surface))state.activeTask=copy(saved.activeTask);
      if (previousProvider !== state.provider) state.conversationId = '';
    } catch {}
    state.staged = []; state.pendingUploads = []; state.pendingUploadId = '';
    let stagedSeq = 0, carryAttachments = null, carryAsk = null, lastUploads = [], lastPreparedTask='', pendingIntent=null;
    const uploadApi = () => root.NovaFlowXiaotaoUpload;
    function recoverActiveTask() {
      if(state.activeTask)return;
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
      if (state.pending || state.generating || state.applying) return false;
      const uploads = uploadApi(); if (!uploads) {state.error = '上传模块未加载'; notify(); return false;}
      for (const file of Array.from(files || [])) {
        const id = 'up-' + (++stagedSeq);
        const item = {id, name:String(file?.name || '未命名文件'), status:'reading', file, kind:'', mimeType:'', previewUrl:'', size:Number(file?.size) || 0};
        state.staged.push(item); notify();
        const verdict = uploads.inspectUpload(file);
        if (!verdict.ok) {state.staged = state.staged.filter(entry => entry !== item); note(verdict.message,true); notify(); continue;}
        item.kind = verdict.kind; item.mimeType = verdict.mimeType; item.ext = verdict.ext;
        if (verdict.kind === 'image') {try {item.previewUrl = await readPreview(file); referencePreviews.set(file, item.previewUrl); await readImageDimensions(file,item.previewUrl); Object.assign(item,imageDimensions(item));} catch {state.staged = state.staged.filter(entry => entry !== item); note(`${item.name} 读取失败`,true); notify(); continue;}}
        else if (typeof root.URL?.createObjectURL === 'function') {try {item.previewUrl = root.URL.createObjectURL(file);} catch {}}
        item.status = 'ready'; notify();
      }
      return true;
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
      if (state.staged.some(item => item.status === 'reading')) {state.error = '文件还在读取，请稍后再发送'; notify(); return false;}
      const ready = state.staged.filter(item => item.status === 'ready');
      if (!ready.length) return true;
      state.uploading=true;state.error='';state.status='正在根据需求准备素材…';notify();
      try {
      lastUploads = ready.map(item => ({kind:item.kind, name:item.name, file:item.file, mimeType:item.mimeType, ...imageDimensions(item), ...(item.kind === 'image' && item.previewUrl ? {dataUrl:item.previewUrl} : {})}));
      const uploads = uploadApi(); if (!uploads) {state.error = '上传模块未加载'; notify(); return false;}
      const plan = uploads.planRoutes(message, ready,state.activeTask);
      const notes = []; let failed = plan.reject.length > 0;
      for (const item of plan.place) {
        try {const receipt = await host().place(item); notes.push(`已放入${item.destination.label}：${item.name}`); item.receipt = receipt;}
        catch (error) {failed = true; notes.push(String(error?.message || error));}
      }
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
      if(state.uploading || state.pending || state.generating)return false;
      const uploads = uploadApi();
      const destination = uploads?.destinationById?.(destinationId);
      if (!destination || !state.pendingUploads.length || pendingId !== state.pendingUploadId) return false;
      const batch = state.pendingUploads.filter(item => item.pendingId === pendingId);
      const notes = []; const done = []; let failed = false;
      for (const item of batch) {
        if (!uploads.acceptsKind(destination, item.kind)) {failed = true; notes.push(`${item.name} 不能放到${destination.label}`); continue;}
        try {await host().place({...item, destination}); done.push(item); notes.push(`已放入${destination.label}：${item.name}`);}
        catch (error) {failed = true; notes.push(String(error?.message || error));}
      }
      releasePreviews(done);
      state.pendingUploads = state.pendingUploads.filter(item => !done.includes(item));
      if (!state.pendingUploads.length) state.pendingUploadId = '';
      note(notes.join('\n') || '没有放入文件',failed || !done.length); notify(); return done.length > 0;
    }
    function notify() {
      sessions[state.provider] = {messages:state.messages.slice(-60),history:state.history,conversationId:state.conversationId};
      try {storage?.setItem(STORAGE_KEY, JSON.stringify({provider:state.provider,activeTask:state.activeTask,sessions:Object.fromEntries(Object.entries(sessions).map(([key, value]) => [key,{...value,messages:value.messages.map(({role, content, receipt, level}) => ({role, content, ...(typeof receipt === 'string' && receipt ? {receipt} : {}), ...(level === 'error' ? {level} : {})}))}]))}));} catch {}
      onChange(state);
    }
    function stopStatusPolling() {if (statusTimer !== null) {timers.clearTimeout(statusTimer); statusTimer = null;}}
    const samplingUnchanged = sampling => !!sampling && sameSnapshot(sampling.binding,bridge.readSampling().binding);
    function askSampling(message, includeResult, kind = 'send') {
      const sampling = bridge.readSampling();
      state.confirmation = {message,includeResult,kind,sampling}; state.error = ''; state.operation = null; state.toolTrace = [];
      state.status = '请确认本次生图参数，确认后才开始分析和生成';
      state.messages.push({role:'status',content:`已收到做图请求。当前是 ${samplingLabel(sampling)}。${sampling.styleTransfer ? '当前双图风格迁移使用 CFG3；“按当前参数”会保留当前版本和步数，并明确设为 CFG3。' : ''}请选择本次参数；确认前不会加载分析模型或提交生图。`}); notify(); return true;
    }
    async function confirmSampling(choice) {
      if (!state.confirmation || state.pending || state.applying || state.generating) return false;
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
          const response = await api().promptAssistantGetStatus({requestId});
          if (!current()) return;
          const data = response?.result || response?.data || response, session = data?.chatSession, progress = data?.operation;
          if (response?.ok !== false && data?.ok !== false) {
            if (progress?.requestId === requestId && ['connecting','queued','assigned','uploading','preparing','loading','analyzing','processing','releasing','completed'].includes(progress.phase)) {
              state.operation = copy(progress);
              const elapsed = Math.max(0,Math.floor((Date.now() - Math.min(activeStartedAt,Number(progress.startedAt)||activeStartedAt)) / 1000));
              const activity=progress.stage==='compile'?'编译模型执行提示词':progress.stage==='optimize'?'优化提示词':activeMode==='media'?'分析音视任务':'分析当前绘图';
              const labels={connecting:'正在连接算力节点',queued:'正在排队等待算力节点',assigned:'已分配算力节点',uploading:'正在传输任务素材',preparing:'正在准备'+activity,loading:'正在加载本地模型',analyzing:'正在'+activity,processing:'算力节点处理中，详细阶段尚未回传',releasing:'正在释放模型资源，准备'+(activeMode==='media'?'音视操作':'生图'),completed:'本轮分析已完成'};
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
      if(activeMode==='media')return; // Media execution validates its own complete snapshot.
      if (state.applying) return;
      try {
        if (state.confirmation && !samplingUnchanged(state.confirmation.sampling)) {state.confirmation = null; state.samplingApproval = null; state.status = '绘图参数、参考图或负向已变化，请重新发送做图请求并确认参数'; notify();}
        if (state.samplingApproval && !samplingUnchanged(state.samplingApproval)) {state.samplingApproval = null;}
      } catch {state.confirmation = null; state.samplingApproval = null;}
      try {const old = state.proposalSnapshot || (activeMode !== 'chat' ? activeSnapshot : null); if (old && !sameSnapshot(old, recapture(old))) {invalidate(); if (state.pending && !stopped) void stop();}}
      catch {invalidate('页面已切换，原建议已失效'); if (state.pending && !stopped) void stop();}
    }
    function onlineEstimateInput(message) {
      const staged = state.staged.filter(item => item.status === 'ready');
      const placements = uploadApi()?.planRoutes?.(message, staged)?.place || [];
      const destination = placements.at(-1)?.destination;
      const drawingPlacement = destination?.id === 'img2img';
      const includeResult = chatRequestsCurrentResult(message);
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
      return {text:[message, ...captions].filter(Boolean).join('\n'), history:(state.history || []).map(item => item?.content || '').join('\n'), outputTokens:2048,
        contextText,
        files:[...images.map(image => ({kind:'image',...imageDimensions(image)})), ...Array.from({length:Math.max(0,staged.filter(item => item.kind === 'image').length-images.length)},()=>({kind:'image'})), ...staged.filter(item => item.kind === 'video' || item.kind === 'audio').map(item => ({kind:item.kind}))]};
    }
    async function sendMedia(message, {recordMessage=true,requestMessage=message,intent=null}={}) {
      const media=root.NovaFlowMediaAgent;
      if(state.provider!=='local') {state.error='执行音视操作请切换“本地智能”，在线智能目前提供对话建议';notify();return false;}
      if((state.staged || []).length) {state.error='请先将音视频素材导入音视资源列表，再告诉小桃如何处理';notify();return false;}
      const operation=++serial;
      stopped=false;activeMode='media';activeSnapshot=null;activeRequest=root.crypto.randomUUID();
      state.pending=true;state.mode='media';state.error='';state.mediaReceipt=null;state.proposal=null;state.confirmation=null;state.operation=null;state.toolTrace=[];
      state.proposalSnapshot=null;state.samplingApproval=null;state.applied=false;
      if(recordMessage)pushUser(message);state.status='正在读取音视素材和时间轴…';notify();
      try {
        const snapshot=media.capture(),contextFingerprint=await fingerprint(snapshot);
        if(operation!==serial || stopped)return false;
        activeStartedAt=Date.now();
        const directPlan=media.directVideoPlan?.(message,intent,snapshot,contextFingerprint);
        if(directPlan?.reuseOptimizedPrompt && state.activeTask?.status!=='completed')directPlan.reuseOptimizedPrompt=false;
        const responsePromise=directPlan?Promise.resolve({ok:true,data:{reply:'',mediaPlan:directPlan,toolTrace:[{name:'route_video_request',result:{executionPending:true,source:'application-intent'}}]}})
          :api()?.artAgentChat?.({requestId:activeRequest,provider:'local',mode:'media',promptLanguage:'en',
          conversationId:state.conversationId || undefined,message:requestMessage,history:copy(state.history),artContext:snapshot.artContext,images:[],contextFingerprint});
        if(!directPlan)startStatusPolling(operation,activeRequest);
        const response=await responsePromise;stopStatusPolling();
        if(operation!==serial || stopped)return false;
        if(!response?.ok) {if(['unknown-conversation','flash-agent-unknown-conversation'].includes(response?.errorCode))state.conversationId='';fail(response?.error || '音视分析未完成，请检查本地助手');}
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
          const result=await media.execute(data.mediaPlan,{snapshot,fingerprint,signal:mediaAbort.signal,requirements:message,reuseOptimizedPrompt:directPlan?.reuseOptimizedPrompt===true,onOptimizationRequest:id=>{activeRequest=id;startStatusPolling(operation,id);},onOptimizationStatus:text=>{if(/正在生成视频/.test(text))stopStatusPolling();state.status=text;notify();},onProgress:op=>{
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
    async function send(message, {includeResult = false, confirmed = false, recordMessage = true} = {}) {
      if(state.uploading)return false;
      if (state.pending || state.generating || state.applying) return false;
      message = String(message || '').trim();
      if (!message) {if ((state.staged || []).length) {state.error = '请先说明这些文件的用途，再发送'; notify();} return false;}
      const newConversation=/^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$/.test(message);
      if(newConversation){reset();lastUploads=[];return true;}
      recoverActiveTask();
      let task=uploadApi()?.inferTask?.(message,state.staged.length?state.staged:lastUploads,state.activeTask);
      const continuation=pendingIntent && task && !task.discussion && (task.surface==='chat'||task.surface===pendingIntent.surface) && !/取消|重新|另外|新建/.test(message) ? pendingIntent : null;
      const requestMessage=continuation ? continuation.message+'\n用户补充：'+message : task?.revision
        ? '继续修改同一个'+({video:'视频',audio:'音频',image:'图片'}[state.activeTask.surface] || '')+'任务。\n原始用户需求：'+state.activeTask.baseRequest
          +'\n此前修改要求：'+(state.activeTask.revisions || []).join('；')
          +'\n上次实际执行信息（仅为事实，可根据需求选择合适工具）：'+JSON.stringify({mode:state.activeTask.mode,seconds:state.activeTask.seconds,loop:state.activeTask.loop,status:state.activeTask.status,outputs:state.activeTask.outputs})
          +'\n本次最新要求优先，替换与它冲突的旧描述：'+message : message;
      if(continuation)task={...continuation};
      const predictionInput = state.provider === 'api' ? onlineEstimateInput(message) : null;
      const prediction = predictionInput ? predictOnline(predictionInput) : null;
      let stagedReady = false;
      async function ensureStaged() {
        if (stagedReady) return true;stagedReady=true;
        if(!state.staged.length && lastUploads.length && task && task.surface!=='chat' && lastPreparedTask!==task.surface+':'+task.mode)
          state.staged=lastUploads.map(item=>({...item,id:'up-'+(++stagedSeq),previewUrl:item.dataUrl||'',status:'ready'}));
        return consumeStaged(requestMessage);
      }
      const positiveEvaluation = /^(?:这次|这张(?:图)?|这个|效果|结果)?(?:的)?(?:效果|画面)?(?:做得|做的|画得|画的)?(?:挺好(?:的)?|很好|很满意|满意|很棒|不错)(?:了)?[，,\s]*$/;
      const purePositive = positiveEvaluation.test(message.replace(/[。！!]+$/,'')) || /^(?:这次|这张|这个)?(?:就用|采用|最终采用|确认采用)(?:这张|这个|本次)?[。！!]*$/.test(message);
      const pureNegative = /^(?:这次|这张|这个)?(?:不满意|不太满意|效果不好|不行)[。！!]*$/.test(message);
      if ((purePositive || pureNegative) && !state.confirmation && bridge.hasResult?.()) {
        if (!(await ensureStaged())) return false;
        pushUser(message);
        if (typeof api()?.artLearning === 'function') void recordFeedback(message);
        state.messages.push({role:'assistant',content:purePositive ? '好，这张的效果就按你的评价保留。' : '明白，这张还没达到要求。告诉我主要需要调整哪里，我会针对性修改。'}); notify(); return true;
      }
      if (!purePositive && bridge.hasResult?.() && positiveEvaluation.test(message.split(/[。！!]/)[0]) && typeof api()?.artLearning === 'function') void recordFeedback(message);
      if (/^(?:请)?(?:开始|开启|新建|重新开始)?(?:一个)?新对话[。.!！]?$|^(?:请)?(?:清空|重置)(?:当前)?对话[。.!！]?$/.test(message)) {reset(); return true;}
      if (state.confirmation && !confirmed) {
        const choice = samplingChoice(message); if (choice) return confirmSampling(choice);
        if (/^(?:取消|算了|先不做|先不生成|不要生成|只聊天|只聊聊)[。！!]*$/.test(message)) {if (!(await ensureStaged())) return false; pushUser(message); return cancelConfirmation();}
        state.confirmation = null;
      }
      if (!(await ensureStaged())) return false;
      const mediaTask=task ? ['video','audio'].includes(task.surface) : root.NovaFlowMediaAgent?.wantsMedia(message);
      if(mediaTask && root.NovaFlowMediaAgent) {
        if(state.provider==='local')root.NovaFlowAudioStudio?.open(task?.surface==='audio'?'audio':'video');
        return sendMedia(message,{recordMessage,requestMessage,intent:task});
      }
      if(task?.surface==='image' && !task.named.length && state.provider==='local') {
        try {if(typeof bridge.openDrawing==='function')await bridge.openDrawing(task.mode || 'txt2img');}
        catch(error){state.error=String(error?.message||error);notify();return false;}
      }
      if (recordMessage) {pushUser(message); recordMessage = false;}
      let execution = executionIntent(message);
      if (execution && state.provider !== 'local') {state.error = '在线智能可以分析参考图片；执行绘图请切换本地智能'; notify(); return false;}
      const requestedGeneration = samplingRequest(message) || task?.surface==='image' && !task.discussion && !task.named.length;
      const requestedFeedback = state.provider === 'local' && bridge.hasResult?.() && feedbackRequest(message);
      if (state.provider === 'local' && bridge.hasResult?.() && typeof api()?.artLearning === 'function'
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
      const page=await bridge.captureChat(), artRequest=/提示词|提示框|绘图|生图|出图|重绘|画图|画一|画个|画张|生成|做图|操作软件|控制软件|调用软件|(?:制作|做|画|设计|修改|给我|来).{0,12}(?:图|海报|插画|画面)/.test(message);
      if(state.provider==='local' && page.artContext.surface==='drawing' && bridge.hasResult?.()) includeResult=true;
      includeResult = chatRequestsCurrentResult(message, includeResult);
      const operation = ++serial; stopped = false; state.error = ''; state.operation = null; state.toolTrace = []; bridge.clearPrepared(); state.proposal = null; state.proposalSnapshot = null; state.applied = false;
      try {
        let snapshot, mode = 'chat';
        if (state.provider === 'local') {try {
          snapshot = await (bridge.captureAny && (page.artContext.surface==='drawing' || artRequest || execution) ? bridge.captureAny({includeResult}) : bridge.capture({includeResult}));
          mode=snapshot.artContext.task==='creation'?'creation':'drawing';
        } catch (error) {if (includeResult || artRequest || execution) throw error;}}
        if (!snapshot) snapshot = await bridge.captureChat({includeResult});
        if (execution && mode === 'chat') fail('还缺少可执行的绘图上下文，请先打开绘图页面');
        activeSnapshot = snapshot; activeMode = mode; state.mode = mode; state.pending = true;
        state.status = includeResult ? '正在查看实际成图…' : state.provider === 'api' ? '小桃正在连接在线智能…' : '正在连接本地助手…';
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
        if (state.provider === 'api' || mode==='chat') for (const image of chatImagesWithUploads(images, lastUploads).slice(images.length)) {
          const dataUrl = await resolveReferenceDataUrl(image);
          images.push({dataUrl, role:image.role, source:image.source, name:image.name, ...imageDimensions(image)});
        }
        const payload = {requestId:activeRequest, provider:state.provider, mode, promptLanguage:mode==='creation'?'zh-CN':'en', conversationId:state.conversationId || undefined, message:requestMessage, history:copy(state.history), artContext:copy(snapshot.artContext), images, ...(state.provider === 'api' ? {uploads:lastUploads.map(({kind, name}) => ({kind, name}))} : {}), ...(contextFingerprint ? {contextFingerprint} : {}), ...(executionApproval ? {executionApproval} : {})};
        if (typeof api()?.artAgentChat !== 'function') fail('小桃AI接口尚未就绪，请刷新页面或启动本地助手');
        const responsePromise = api().artAgentChat(payload); startStatusPolling(operation, activeRequest);
        const response = await responsePromise;
        if (operation !== serial || stopped) return false;
        if (!response?.ok) {
          if (['unknown-conversation', 'flash-agent-unknown-conversation'].includes(response?.errorCode)) {state.conversationId = ''; fail('服务已重启，文字对话已保留。再次发送可重新连接小桃。');}
          fail(response?.error || '小桃暂时未能完成分析，请稍后再试');
        }
        const data = response.data; if (!data || typeof data.reply !== 'string') fail('小桃没有返回完整回复，请重试');
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
            if (next && next !== metering) {metering = {...next,updatedAt:Date.now()}; try {root.localStorage?.setItem(pricingKey,JSON.stringify(metering));} catch {}}
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
        const reply=mode!=='chat' && finalProposal && promptOnly ? data.reply+'\n\n完整提示词：\n```text\n'+finalProposal.prompt+'\n```' : data.reply;
        const receipt = state.provider === 'api' ? creditReceipt(data.quota) : '';
        state.messages.push({role:'assistant', content:reply, ...(receipt ? {receipt} : {})});
        state.conversationId = data.conversationId || state.conversationId;
        if (Array.isArray(data.history)) state.history = copy(data.history);
        state.toolTrace = Array.isArray(data.toolTrace) ? copy(data.toolTrace) : []; state.model = String(data.proposal?.model || data.model || '本地 Flash');
        const unchanged = mode === 'chat' || sameSnapshot(snapshot, recapture(snapshot));
        if (mode !== 'chat' && finalProposal && unchanged && finalProposal.contextFingerprint === contextFingerprint) {state.proposal = finalProposal===data.proposal?copy(finalProposal):finalProposal; state.proposalSnapshot = snapshot; state.status = '方案已准备，可直接说“按这个方案生成”';}
        else state.status = !unchanged ? '当前绘图已变化，这次回复中的建议未应用' : mode === 'chat' && state.provider === 'local' && snapshot.artContext.surface === 'drawing' ? '已回复 · 当前仅对话，尚未形成可生图双图上下文' : '已回复';
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
      } catch (error) {if (operation === serial && !stopped) {state.error = String(error?.message || error); state.status = '未提交生成';} return false;}
      finally {if (operation === serial) {stopStatusPolling();promptAbort=null; state.pending = false; state.operation = null; activeRequest = ''; activeSnapshot = null; notify();}}
    }
    async function stop() {
      if(promptAbort) {state.status='正在停止本次提示词优化…';promptAbort.abort();notify();return;}
      if(mediaAbort) {state.status='正在停止本次音视任务…';mediaAbort.abort();notify();return;}
      if (state.confirmation && !state.pending && !state.generating) return cancelConfirmation();
      if (state.generating) {state.status = '正在停止生成…'; notify(); await bridge.cancelGeneration(); return;}
      if (!state.pending || stopped) return;
      stopped = true; stopStatusPolling(); const requestId = activeRequest; state.localSession = null; state.status = state.provider === 'api' ? '正在停止等待在线回复…' : '正在停止小桃…'; notify();
      try {if (requestId) {const result = await api()?.artAgentStop?.({requestId,provider:state.provider}); if (!result?.ok) fail(result?.error || '停止尚未确认，请等待当前任务退出');} ++serial; state.pending = false; activeRequest = ''; activeSnapshot = null; state.status = state.provider === 'api' ? '已停止等待本次回复；未完成的在线请求不扣积分' : '已停止';}
      catch (error) {state.error = String(error?.message || error); state.status = '停止尚未确认';}
      notify();
    }
    async function apply({generate = false} = {}) {
      if (!state.proposal || state.pending || state.generating || state.applying || state.uploading) return false;
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
    function releaseStagedMedia() { releasePreviews(state.staged); releasePreviews(state.pendingUploads); }
    function reset() {if (state.pending || state.generating || state.applying || state.uploading) return false; ++serial; stopStatusPolling(); activeRequest = ''; activeSnapshot = null; activeMode = 'chat'; lastRequestMessage = ''; carryAttachments = null; carryAsk = null; lastUploads=[];lastPreparedTask='';pendingIntent=null;bridge.clearPrepared(); releaseStagedMedia(); for (const provider of ['local','api']) sessions[provider] = {messages:[],history:[],conversationId:''}; Object.assign(state, {activeTask:null,messages:[], history:[], conversationId:'', proposal:null, proposalSnapshot:null, applied:false, confirmation:null,samplingApproval:null,operation:null,error:'', toolTrace:[], staged:[], pendingUploads:[], pendingUploadId:'', status:state.mode === 'drawing' ? '新对话，将使用当前绘图内容' : '新对话，可以直接聊天'}); notify(); return true;}
    function setProvider(provider) {
      if (!['local','api'].includes(provider) || provider === state.provider || state.pending || state.generating || state.applying || state.uploading) return false;
      ++serial; notify(); bridge.clearPrepared(); activeSnapshot = null; pendingIntent=null;
      Object.assign(state, {provider,conversationId:'',mode:'chat',proposal:null,proposalSnapshot:null,applied:false,confirmation:null,samplingApproval:null,operation:null,error:'',toolTrace:[],model:provider === 'local' ? '本地 Flash' : 'API',status:provider === 'local' ? '已切换本地智能 · 不扣积分' : '已切换在线智能 · 按实际用量计费'}); notify(); return true;
    }
    return Object.freeze({state, send, apply, confirmSampling, cancelConfirmation, stop, reset, setProvider, refreshContext, onlineEstimateInput, onlineQuote, calibrateLocalStatus, recordFeedback, stageUploads, removeStaged, chooseUploadDestination, releaseStagedMedia});
  }
  function mount() {
    if (!root.document?.body || root.document.getElementById('nf-xiaotao-art-root')) return;
    const doc = root.document, host = doc.createElement('div'); host.id = 'nf-xiaotao-art-root'; host.setAttribute('data-novaflow-runtime-ignore', '1');
    const el = (tag, cls, text) => {const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n;};
    const fab = el('button', 'nf-xiaotao-launcher nf-xiaotao-robot'); fab.type = 'button'; fab.setAttribute('data-novaflow-keep-radius', '1'); fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'nf-xiaotao-art-panel');
    fab.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6v7M13 32H7v13h7m37-13h6v13h-7M23 54v5m18-5v5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle class="nf-xiaotao-antenna" cx="32" cy="5" r="3"/><rect x="12" y="14" width="40" height="41" rx="14" fill="#3b3b3b" stroke="currentColor" stroke-width="2"/><rect x="18" y="23" width="28" height="20" rx="8" fill="#202020"/><g class="nf-xiaotao-eyes"><circle cx="25" cy="32" r="3"/><circle cx="39" cy="32" r="3"/></g><path d="M27 47h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const robotLabel = el('span', 'nf-xiaotao-robot-label', '小桃AI'), robotState = el('span', 'nf-xiaotao-robot-state', '待机'); fab.append(robotLabel, robotState);
    const greeting = el('div', 'nf-xiaotao-greeting'), greetingClose = el('button', '', '×'); greeting.hidden = true; greeting.setAttribute('role','status'); greeting.append(el('span','','你好，我是小桃AI，需要我帮助吗？'),greetingClose); greetingClose.type = 'button'; greetingClose.setAttribute('aria-label','关闭欢迎提示'); greetingClose.onclick = () => {greeting.hidden = true;};
    const panel = el('aside', 'nf-xiaotao-panel'); panel.id = 'nf-xiaotao-art-panel'; panel.hidden = true; panel.setAttribute('aria-label', '小桃AI对话');
    const header = el('header', 'nf-xiaotao-header'), title = el('div','nf-xiaotao-title'), titleText = el('strong','','小桃AI'), close = el('button', 'nf-xiaotao-icon', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭对话');
    title.append(titleText); header.append(title, close);
    const context = el('div', 'nf-xiaotao-context'), contextLabel = el('span'), thumbs = el('div', 'nf-xiaotao-thumbs'); context.append(contextLabel, thumbs);
    const messages = el('div', 'nf-xiaotao-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-label', '小桃全局对话');
    const intro = el('p', 'nf-xiaotao-intro', '上传素材并描述想要的结果，我会根据需求选择绘图、视频或音频工具；拿不准你的意思时，会先向你问清楚。'); messages.append(intro);
    const proposal = el('details', 'nf-xiaotao-proposal'), summary = el('summary', '', '提示词与执行'), proposalText = el('pre'), copyPrompt=el('button','','复制完整提示词'); copyPrompt.type='button'; copyPrompt.onclick=()=>void copyText(controller.state.proposal?.prompt || '',copyPrompt); proposal.hidden = true; proposal.append(summary,copyPrompt,proposalText);
    const actions = el('div', 'nf-xiaotao-actions'), applyButton = el('button', '', '应用到绘图'), generateButton = el('button', 'nf-xiaotao-primary', '应用并生成一张'); for (const b of [applyButton, generateButton]) b.type = 'button'; actions.append(applyButton, generateButton); proposal.append(actions);
    const confirmation = el('section','nf-xiaotao-proposal'), confirmationText = el('p'), samplingActions = el('div','nf-xiaotao-actions'); confirmation.hidden = true; confirmation.setAttribute('aria-label','确认本次生图参数'); samplingActions.style.flexWrap = 'wrap';
    for (const [choice,label] of [['current','按当前参数'],['turbo','Turbo · 8 步 · CFG3'],['standard','普通 · 25 步 · CFG3'],['cancel','取消']]) {const button = el('button','',label); button.type = 'button'; button.onclick = () => void (choice === 'cancel' ? controller.cancelConfirmation() : controller.confirmSampling(choice)); samplingActions.append(button);}
    confirmation.append(confirmationText,samplingActions);
    const tools = el('div', 'nf-xiaotao-tools');
    const status = el('div', 'nf-xiaotao-status'); status.setAttribute('role', 'status'); const error = el('p', 'nf-xiaotao-error'); error.setAttribute('role', 'alert');
    const footer = el('form', 'nf-xiaotao-compose'), input = el('textarea'); input.rows = 3; input.placeholder = '有什么需要我帮助的？'; input.setAttribute('aria-label', '给智能助手的消息');
    const footerActions = el('div', 'nf-xiaotao-compose-actions'), providers = el('div', 'nf-xiaotao-brains'), localBrain = el('button', '', '本地智能'), onlineBrain = el('button', '', '在线智能'), newConversation = el('button', '', '新对话'), stop = el('button', '', '停止'), send = el('button', 'nf-xiaotao-primary', '发送');
    providers.setAttribute('role','group'); providers.setAttribute('aria-label','切换AI大脑');
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
      const pick=root.electronAPI?.pickXiaotaoUploads;
      if(typeof pick==='function'){
        let result; try{result=await pick();}catch(error){controller.state.error=String(error?.message||error);render(controller.state);return;}
        if(!result||result.canceled)return;
        const converted=root.NovaFlowXiaotaoUpload?.filesFromIpc?.(result)||{files:[],notes:[]};
        for(const note of converted.notes)controller.state.messages.push({role:'assistant',content:note});
        if(await controller.stageUploads(converted.files)){navigation=navigationSelection();contextStamp='';setOpen(true);}
        return;
      }
      let chosen=[]; try{chosen=await pickBrowserFiles();}catch(error){controller.state.error=String(error?.message||error);render(controller.state);return;}
      if(!chosen.length)return;
      if(await controller.stageUploads(chosen)){navigation=navigationSelection();contextStamp='';setOpen(true);}
    };
    const listen=(node,type,fn)=>{if(typeof node.addEventListener==='function')node.addEventListener(type,fn);else node['on'+type]=fn;};
    const takeFiles=list=>{if(list?.length)void controller.stageUploads(list);};
    listen(footer,'dragover',event=>{if(event?.dataTransfer)event.preventDefault?.();});
    listen(footer,'drop',event=>{event?.preventDefault?.();takeFiles(Array.from(event?.dataTransfer?.files||[]));});
    listen(input,'paste',event=>{const files=Array.from(event?.clipboardData?.files||[]);if(files.length){event.preventDefault?.();takeFiles(files);}});
    for (const b of [localBrain, onlineBrain, newConversation, stop]) b.type = 'button'; newConversation.title = '清空聊天记录并开始新会话'; newConversation.setAttribute('aria-label','清空聊天记录并开启新对话'); onlineBrain.title='在线智能按实际用量计费，发送前显示约计积分';send.type = 'submit'; const estimateLabel=el('span','nf-xiaotao-estimate',''); estimateLabel.setAttribute('data-idle','1'); providers.append(localBrain, onlineBrain);title.append(providers);footerActions.append(upload,newConversation, stop, estimateLabel, send); footer.append(stagedRow,input,footerActions);
    panel.append(header, context, messages, confirmation, proposal, tools, status, error, footer); host.append(fab, greeting, panel); doc.body.append(host);
    const drag = bindPanelDrag(panel, header);
    const robotDrag = bindPanelDrag(fab, fab, {threshold:5,ignoreInteractive:false,onStart:() => {greeting.hidden = true;},onEnd:() => {if (open) anchorPanel();}});
    const bridge = createBridge(); let rendered = [], renderedProposal = null, contextStamp = '', previewImages = [], open = false;
    const controller = createController({bridge, storage:createTabScopedStorage(root.localStorage, root.sessionStorage), onChange:render});
    const releasePanel = () => controller.releaseStagedMedia();
    if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', releasePanel);
    async function copyText(text, button) {
      try {
        if (root.navigator?.clipboard?.writeText) await root.navigator.clipboard.writeText(text);
        else {const helper=el('textarea'); helper.value=text; Object.assign(helper.style,{position:'fixed',left:'-10000px'}); doc.body.append(helper); helper.select(); try {if (!doc.execCommand('copy')) throw new Error('复制失败');} finally {helper.remove();}}
        button.textContent='已复制';
      } catch {button.textContent='请选中文字复制';}
    }
    function render(state) {
      if (state.messages.length !== rendered.length || state.messages.some((m, i) => m !== rendered[i])) {
        rendered = state.messages.slice(); messages.replaceChildren();
        const rows = conversationRows(state.messages);
        if (!rows.length) messages.append(intro);
        for (const row of rows) messages.append(renderConversationRow(doc, row, {copyText, chooseUploadDestination:controller.chooseUploadDestination}));
        messages.scrollTop = messages.scrollHeight;
      }
      const stagedItems = state.staged || []; stagedRow.hidden = !stagedItems.length; stagedRow.replaceChildren(); for (const item of stagedItems) {const card=el('div','nf-xiaotao-staged-item');card.setAttribute('data-status',item.status);if(item.status==='reading')card.setAttribute('aria-busy','true');const thumb=item.previewUrl?el('img','nf-xiaotao-staged-thumb'):el('div','nf-xiaotao-staged-fallback',item.kind==='video'?'视频':item.kind==='audio'?'音频':'文件');if(item.previewUrl){thumb.src=item.previewUrl;thumb.alt=item.name;thumb.setAttribute('alt',item.name);}if(item.status==='reading')card.append(el('span','nf-xiaotao-staged-spinner'));const remove=el('button','nf-xiaotao-staged-remove','×');remove.type='button';remove.setAttribute('aria-label','移除 '+item.name);remove.onclick=event=>{event.preventDefault?.();event.stopPropagation?.();controller.removeStaged(item.id);};card.append(thumb,remove);stagedRow.append(card);} 
      const warm = state.localSession?.state === 'warm' && state.localSession.modelLoaded === true;
      titleText.title = state.provider === 'api' ? '在线智能' : warm ? '本地智能 · 上次已就绪' : '本地智能';
      const activity = state.generating || state.applying ? 'working' : state.pending ? 'thinking' : 'idle';
      fab.dataset.state = activity; robotState.textContent = activity === 'working' ? '工作中' : state.provider === 'local' && state.pending ? ({loading:'加载中',analyzing:'分析中',releasing:'释放中'}[state.operation?.phase] || {loading:'加载中',answering:'回答中',releasing:'释放中',warm:'准备回答'}[state.localSession?.state] || '连接中') : state.pending ? '回答中' : state.confirmation ? '等待确认' : state.provider === 'local' && warm ? '上次已就绪' : '待机'; fab.setAttribute('aria-label','小桃AI，'+robotState.textContent+'，点击聊天，可拖动');
      tools.textContent = [...new Set(state.toolTrace.map(step => ({get_art_context:'已读取当前绘图',propose_art_direction:'已整理完整提示词',apply_art_direction:'模型请求写入提示框',generate_art_image:'模型请求绘图执行',apply_prompt_completed:'已写入提示框',generate_completed:'已完成实际生图'}[step.name] || '')).filter(Boolean))].join(' · ');
      status.textContent = state.status; error.textContent = state.error; error.hidden = !state.error; proposal.hidden = !state.proposal;
      confirmation.hidden = !state.confirmation; confirmationText.textContent = state.confirmation ? `当前为 ${samplingLabel(state.confirmation.sampling)}。${state.confirmation.sampling.styleTransfer ? '双图风格迁移使用 CFG3；按当前参数会保留版本和步数，并设为 CFG3。' : ''}确认后才分析并生成一张。` : '';
      if(state.proposal!==renderedProposal) {renderedProposal=state.proposal; proposal.open=Boolean(state.proposal); copyPrompt.textContent='复制完整提示词';}
      proposalText.textContent = state.proposal?.prompt || ''; const busy = state.pending || state.generating || state.applying || state.uploading; applyButton.disabled = busy || state.applied; generateButton.disabled = busy; newConversation.disabled = busy; upload.disabled=busy; send.disabled = busy; stop.hidden = !state.pending && !state.generating; input.disabled = busy;
      for (const [button, value] of [[localBrain,'local'],[onlineBrain,'api']]) {button.disabled = busy; button.setAttribute('aria-pressed',String(state.provider === value));}
      paintEstimate();
    }
    function paintEstimate() {
      const prices = root.NovaFlowFeatureCreditPrices;
      let text = '';
      if (controller.state.provider === 'api' && typeof prices?.estimateXiaotaoOnline === 'function') {
        const quote = controller.onlineQuote(input.value);
        text = quote?.credits ? `约${quote.credits}分` : '';
        const title = quote?.credits ? `预计 ${quote.low ?? quote.credits}–${quote.high ?? quote.credits} 分${quote.sampleCount ? `，参考 ${quote.sampleCount} 次同类用量` : '，尚未积累同类用量'}；暂预扣 ${quote.reservedCredits ?? quote.credits} 分，按实际结算；单次最高 ${quote.cap} 分` : '';
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
    const setOpen = value => {open = value; greeting.hidden = true; panel.hidden = !value; fab.setAttribute('aria-expanded', String(value)); if (value) {anchorPanel(); tick(); void controller.calibrateLocalStatus(); input.focus();}};
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
    fab.onclick = event => {if (robotDrag.consumeClick()) {event.preventDefault(); return;} setOpen(!open);}; close.onclick = () => setOpen(false); stop.onclick = () => void controller.stop(); applyButton.onclick = () => void controller.apply(); generateButton.onclick = () => void controller.apply({generate:true});
    newConversation.onclick = () => {if (controller.reset()) {input.value = ''; input.focus();}};
    for (const [button, value] of [[localBrain,'local'],[onlineBrain,'api']]) button.onclick = () => {if (controller.setProvider(value)) {contextStamp = ''; tick(); if (value === 'local') void controller.calibrateLocalStatus(); input.focus();}};
    footer.onsubmit = event => {event.preventDefault(); const text = input.value; if (text.trim()) {input.value = ''; void controller.send(text);}};
    input.onkeydown = event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); footer.requestSubmit();}};
    input.oninput = () => paintEstimate();
    function tick() {
      if (drag.dragging() || robotDrag.dragging()) return;
      closeOnNavigation();
      controller.refreshContext(); if (!open) return;
      if(root.NovaFlowAudioStudio?.isOpen?.()) {
        const media=root.NovaFlowMediaAgent?.capture?.().artContext;
        contextLabel.textContent='全局助手 · 根据需求选择绘图、视频或音频';
        if(previewImages.length){thumbs.replaceChildren();previewImages=[];}
        return;
      }
      try {const snapshot = bridge.captureAny({includeResult:bridge.hasResult()}), stamp = JSON.stringify(snapshot.artContext); if (stamp !== contextStamp || snapshot.images.some((img, i) => img.dataUrl !== previewImages[i]) || snapshot.images.length!==previewImages.length) {contextStamp = stamp; previewImages = snapshot.images.map(img => img.dataUrl); contextLabel.textContent = '全局助手 · 根据需求选择绘图、视频或音频'; thumbs.replaceChildren(); for (const ref of snapshot.images) {const item = el('span'), img = el('img'), name=ref.role==='subject'?'主体':ref.role==='style'?'画风':'当前成图'; img.src = ref.dataUrl; img.alt=name; item.append(img, el('small', '',ref.source?`图${ref.source} · ${name}`:name)); thumbs.append(item);}}}
      catch {contextLabel.textContent = '全局助手 · 根据需求选择绘图、视频或音频'; if (previewImages.length) {thumbs.replaceChildren(); previewImages = [];}}
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
  root.NovaFlowXiaotaoArtAgent = {fingerprint, sameSnapshot, executionIntent, samplingRequest, samplingChoice, feedbackRequest, clampPanelPosition, anchoredPanelPosition, renderMessageMarkdown, conversationRows, renderConversationRow, createTabScopedStorage, bindPanelDrag, createBridge, createController, mount};
  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount, {once:true}); else if (root.document?.body) mount();
})(typeof window !== 'undefined' ? window : globalThis);

(function (root) {
  'use strict';
  // Formats the reference slots and the local pipelines actually accept.
  // Images: art file inputs and the Flash image pipeline take PNG/JPEG/WebP,
  // each at most 24MB (worker/src/flash-art-agent.mjs, flash-art-direction.mjs).
  // Video and audio: the animation picker (getAiSequenceFilePickerTypes) intersected
  // with MiniMax H3 slot extensions. Bytes stop at the worker upload cap
  // (worker/src/gateway/gateway.mjs MAX_UPLOAD_BYTES). Audio is only valid on 多参.
  const IMAGE_MAX_BYTES = 24 * 1024 * 1024;
  const MEDIA_MAX_BYTES = 64 * 1024 * 1024;
  const FORMATS = Object.freeze([
    format('png', 'image', ['image/png'], IMAGE_MAX_BYTES, '24MB'),
    format('jpg', 'image', ['image/jpeg'], IMAGE_MAX_BYTES, '24MB'),
    format('jpeg', 'image', ['image/jpeg'], IMAGE_MAX_BYTES, '24MB'),
    format('webp', 'image', ['image/webp'], IMAGE_MAX_BYTES, '24MB'),
    format('mp4', 'video', ['video/mp4'], MEDIA_MAX_BYTES, '64MB'),
    format('mov', 'video', ['video/quicktime', 'video/mp4'], MEDIA_MAX_BYTES, '64MB'),
    format('webm', 'video', ['video/webm'], MEDIA_MAX_BYTES, '64MB'),
    format('mp3', 'audio', ['audio/mpeg', 'audio/mp3'], MEDIA_MAX_BYTES, '64MB'),
    format('wav', 'audio', ['audio/wav', 'audio/wave', 'audio/x-wav'], MEDIA_MAX_BYTES, '64MB'),
    format('m4a', 'audio', ['audio/mp4', 'audio/x-m4a', 'audio/m4a'], MEDIA_MAX_BYTES, '64MB'),
    format('aac', 'audio', ['audio/aac', 'audio/x-aac'], MEDIA_MAX_BYTES, '64MB'),
    format('ogg', 'audio', ['audio/ogg'], MEDIA_MAX_BYTES, '64MB'),
    format('flac', 'audio', ['audio/flac', 'audio/x-flac'], MEDIA_MAX_BYTES, '64MB')
  ]);
  const DESTINATIONS = Object.freeze([
    destination('image_video', '图生视频参考', '动画', 'image_video', ['image'], ['参考图', '首帧', '参考图1'], 1),
    destination('first_frame', '首尾帧首帧', '动画', 'first_last', ['image'], ['首帧'], 1),
    destination('last_frame', '首尾帧尾帧', '动画', 'first_last', ['image'], ['尾帧'], 1),
    destination('multi_reference', '多参视频参考', '动画', 'multi_reference', ['image', 'video', 'audio'], [], 0),
    destination('img2img', '图生图参考图', '美工', 'img2img', ['image'], [], 16)
  ]);
  const MULTI_LIMITS = Object.freeze({image:9, video:3, audio:3});
  const EXTENSIONS = Object.freeze(FORMATS.map(item => item.ext));

  function format(ext, kind, mimes, maxBytes, maxLabel) {
    return Object.freeze({ext, kind, mimes:Object.freeze(mimes), maxBytes, maxLabel});
  }
  function destination(id, label, module, mode, accepts, slots, limit) {
    return Object.freeze({id, label, module, mode, accepts:Object.freeze(accepts), slots:Object.freeze(slots), limit});
  }
  function destinationById(id) {
    return DESTINATIONS.find(item => item.id === id) || null;
  }
  function extensionOf(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }
  function mimeOf(value) {
    return String(value || '').split(';', 1)[0].trim().toLowerCase();
  }
  function formatByExtension(ext) {
    return FORMATS.find(item => item.ext === ext) || null;
  }
  function dialogFilters() {
    const images = FORMATS.filter(item => item.kind === 'image').map(item => item.ext);
    const videos = FORMATS.filter(item => item.kind === 'video').map(item => item.ext);
    const audios = FORMATS.filter(item => item.kind === 'audio').map(item => item.ext);
    return Object.freeze([
      Object.freeze({name:'参考资源', extensions:EXTENSIONS.slice()}),
      Object.freeze({name:'图片', extensions:images}),
      Object.freeze({name:'视频', extensions:videos}),
      Object.freeze({name:'音频', extensions:audios})
    ]);
  }
  function inspectUpload(file) {
    const name = String(file?.name || '未命名文件');
    const ext = extensionOf(name);
    const known = formatByExtension(ext);
    if (!known) return {ok:false, message:`不支持 ${name}：只能上传 PNG、JPG、JPEG、WEBP、MP4、MOV、WEBM、MP3、WAV、M4A、AAC、OGG、FLAC`};
    const mime = mimeOf(file?.type);
    if (!mime || !known.mimes.includes(mime)) return {ok:false, message:`${name} 的扩展名和文件类型不一致`};
    const size = Number(file?.size);
    if (!Number.isFinite(size) || size <= 0) return {ok:false, message:`${name} 是空文件`};
    if (size > known.maxBytes) return {ok:false, message:`${name} 超过 ${known.maxLabel}`};
    return {ok:true, name, ext, kind:known.kind, mimeType:mime, size, maxBytes:known.maxBytes};
  }
  function acceptsKind(destination, kind) {
    return Boolean(destination && destination.accepts.includes(kind));
  }
  function question(text) {
    return /[?？]|吗[。！!]?\s*$/.test(text);
  }
  function namedDestinations(text) {
    const first = /首帧|第一帧|开始帧/.test(text);
    const last = /(?<!首)尾帧|最后一帧|结束帧|末帧/.test(text);
    const frames = /首尾帧/.test(text);
    const hits = [];
    if (first && last) hits.push('first_last_pair');
    else if (last) hits.push('last_frame');
    else if (first) hits.push('first_frame');
    else if (frames) hits.push('first_last_unspecified');
    if (/图生视频/.test(text)) hits.push('image_video');
    if (/多参/.test(text)) hits.push('multi_reference');
    if (/图生图/.test(text)) hits.push('img2img');
    return hits;
  }
  function planRoutes(message, files) {
    const text = String(message || '').trim();
    const asking = question(text);
    const named = asking ? [] : namedDestinations(text);
    const place = [];
    const ask = [];
    const reject = [];
    const list = Array.from(files || []);
    const images = list.filter(file => file?.kind === 'image');
    const imageHits = [...new Set(named.filter(id => ['image_video', 'first_frame', 'last_frame', 'multi_reference', 'img2img', 'first_last_pair', 'first_last_unspecified'].includes(id)))];
    const imageDecision = imageHits.length !== 1 || imageHits[0] === 'first_last_unspecified' ? 'ask' : imageHits[0] === 'first_last_pair' ? (images.length === 2 ? 'pair' : 'ask') : 'place';
    let pairIndex = 0;
    for (const file of list) {
      if (file?.kind === 'video' || file?.kind === 'audio') {
        const blocked = named.filter(id => id !== 'multi_reference' && id !== 'first_last_pair' && id !== 'first_last_unspecified' && !acceptsKind(destinationById(id), file.kind));
        if (blocked.length && !named.includes('multi_reference')) {
          const label = destinationById(blocked[0])?.label || '该位置';
          reject.push({file, name:file.name, message:`${file.name} 不能放到${label}，${file.kind === 'audio' ? '音频' : '视频'}请放到多参视频`});
        } else place.push(carried(file, destinationById('multi_reference')));
        continue;
      }
      if (file?.kind !== 'image') continue;
      if (imageDecision === 'ask') ask.push(file);
      else if (imageDecision === 'pair') place.push(imagePlace(file, pairIndex++ === 0 ? 'first_frame' : 'last_frame'));
      else place.push(imagePlace(file, imageHits[0]));
    }
    return {place, ask, reject};
  }
  function carried(file, destination) {
    const blob = file?.file && typeof file.file === 'object' ? file.file : file;
    return {file:blob, name:file.name, kind:file.kind, mimeType:file.mimeType || blob?.type || '', previewUrl:file.previewUrl || '', destination};
  }
  function imagePlace(file, id) {
    return carried(file, destinationById(id));
  }
  function choiceList() {
    return DESTINATIONS.map(item => ({id:item.id, label:item.label}));
  }
  function askText(files) {
    const names = Array.from(files || []).map(file => file.name).filter(Boolean).join('、');
    return (names ? `${names} 要放到哪里？` : '这些图片要放到哪里？') + '请选择一个位置。';
  }
  function filesFromIpc(payload) {
    const files = [];
    const notes = [];
    for (const item of Array.isArray(payload?.files) ? payload.files : []) {
      if (item?.error) {notes.push(String(item.error)); continue;}
      const name = String(item?.name || '');
      const mimeType = mimeOf(item?.mimeType);
      let bytes;
      try {bytes = Uint8Array.from(root.atob(String(item?.base64 || '')), char => char.charCodeAt(0));}
      catch {notes.push(`${name || '文件'} 读取失败`); continue;}
      const file = typeof root.File === 'function'
        ? new root.File([bytes], name, {type:mimeType})
        : {name, type:mimeType, size:bytes.byteLength, arrayBuffer:async () => bytes.buffer};
      files.push(file);
    }
    return {files, notes};
  }
  function press(button) {
    if (!button) return false;
    if (typeof button.click === 'function') button.click();
    else if (typeof button.onclick === 'function') button.onclick({target:button, preventDefault() {}, stopPropagation() {}});
    return true;
  }
  function switchPrimary(doc, label) {
    const buttons = Array.from(doc?.querySelectorAll?.('[data-novaflow-primary-entry="1"]') || []);
    const current = buttons.find(button => button.getAttribute('aria-pressed') === 'true' || button.getAttribute('data-novaflow-primary-active') === '1');
    if (current?.getAttribute('data-novaflow-primary-label') === label) return true;
    return press(buttons.find(button => button.getAttribute('data-novaflow-primary-label') === label));
  }
  function switchMode(doc, mode) {
    const buttons = Array.from(doc?.querySelectorAll?.('[data-novaflow-ai-generation-mode]') || []);
    return press(buttons.find(button => button.getAttribute('data-novaflow-ai-generation-mode') === mode));
  }
  function assignFiles(input, files, replace) {
    if (!input) return false;
    const list = Array.from(files || []).filter(Boolean);
    try {
      if (typeof root.DataTransfer === 'function' && typeof root.File === 'function' && list.every(file => file instanceof root.File)) {
        const transfer = new root.DataTransfer();
        for (const file of list) transfer.items.add(file);
        input.files = transfer.files;
      }
    } catch {}
    const previous = Array.isArray(input.__novaflowFiles) ? input.__novaflowFiles : [];
    input.__novaflowFiles = replace ? list.slice() : previous.concat(list);
    if (typeof input.dispatchEvent === 'function' && typeof root.Event === 'function') input.dispatchEvent(new root.Event('change', {bubbles:true}));
    else if (typeof input.onchange === 'function') input.onchange({target:input, type:'change'});
    return true;
  }
  function addResource(doc, file) {
    const input = doc?.getElementById?.('novaflow-ai-sequence-upload-input');
    if (!input) return false;
    return assignFiles(input, [file], false);
  }
  function slotNode(doc, names) {
    for (const name of names) {
      const node = doc?.querySelector?.(`[data-ais-import="${name}"]`);
      if (node) return node;
    }
    return null;
  }
  function createUploadHost(target) {
    const scope = target || root;
    const placed = [];
    return {
      placed,
      async place(item) {
        const destination = item?.destination;
        const file = item?.file;
        if (!destination || !file) throw new Error('没有可放入的文件');
        if (!acceptsKind(destination, item.kind)) throw new Error(`${item.name} 不能放到${destination.label}`);
        const doc = scope.document;
        switchPrimary(doc, destination.module);
        if (destination.id === 'img2img') {
          const runtime = scope.__NovaFlowArtGenerate;
          if (typeof runtime?.setReference !== 'function') throw new Error('图生图参考位置不可用');
          runtime.activate?.('img2img');
          runtime.setMode?.('img2img');
          const refs = runtime.references?.() || [];
          const limit = Math.max(1, Number(runtime.referenceLimit?.()) || destination.limit);
          const index = refs.findIndex(ref => !ref?.dataUrl);
          const slot = index >= 0 ? index : refs.length;
          if (slot >= limit) throw new Error('图生图参考图已满');
          runtime.setReference(slot, {name:item.name, dataUrl:item.previewUrl || '', mimeType:item.mimeType, drawingRole:'subject', source:'xiaotao-upload'});
          runtime.render?.({forceBottom:true});
        } else if (destination.id === 'multi_reference') {
          switchMode(doc, destination.mode);
          const limit = MULTI_LIMITS[item.kind] || 1;
          if (placed.filter(entry => entry.id === destination.id && entry.kind === item.kind).length >= limit) throw new Error(`${item.kind === 'video' ? '参考视频' : item.kind === 'audio' ? '参考音频' : '参考图'}已满`);
          const media = scope.NovaFlowH3Media;
          if (typeof media?.importFiles === 'function') await media.importFiles(item.kind, [file]);
          else {
            const fallback = item.kind === 'video' ? ['视频参考'] : item.kind === 'audio' ? ['声音参考'] : ['参考图1', '参考图'];
            const node = slotNode(doc, fallback);
            if (!node) throw new Error('多参视频参考位置还没准备好');
            assignFiles(node.querySelector?.('input') || node, [file], false);
          }
        } else {
          switchMode(doc, destination.mode);
          if (placed.filter(entry => entry.id === destination.id).length >= 1) throw new Error(`${destination.label}已满`);
          const node = slotNode(doc, destination.slots);
          if (!node) throw new Error(`${destination.label}的参考位置还没准备好`);
          if (node.getAttribute?.('data-novaflow-resource-occupied') === '1') throw new Error(`${destination.label}已有文件，请先清除`);
          assignFiles(node.querySelector?.('input') || node, [file], true);
          node.setAttribute?.('data-novaflow-resource-occupied', '1');
        }
        addResource(doc, file);
        placed.push({id:destination.id, kind:item.kind, name:item.name, module:destination.module, mode:destination.mode});
        return placed[placed.length - 1];
      }
    };
  }

  const api = Object.freeze({
    FORMATS, DESTINATIONS, EXTENSIONS, MULTI_LIMITS, IMAGE_MAX_BYTES, MEDIA_MAX_BYTES,
    dialogFilters, inspectUpload, planRoutes, destinationById, choiceList, askText, acceptsKind, filesFromIpc, createUploadHost
  });
  root.NovaFlowXiaotaoUpload = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

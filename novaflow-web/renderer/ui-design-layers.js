;(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.NovaFlowUiDesignLayers = api
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict'
  const clone = value => JSON.parse(JSON.stringify(value))
  const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback
  const id = () => 'layer_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  function normalize(value = {}) {
    const used = new Set()
    return { version: 1, width: Math.max(64, finite(value.width, 1024)), height: Math.max(64, finite(value.height, 1024)), layers: (value.layers || []).map((item, index) => {
      let key = String(item.id || id()); if (used.has(key)) key = id(); used.add(key)
      return { ...clone(item), id: key, type: item.type === 'text' ? 'text' : 'image', name: String(item.name || '图层 ' + (index + 1)), x: finite(item.x, 0), y: finite(item.y, 0), width: Math.max(1, finite(item.width, 512)), height: Math.max(1, finite(item.height, 512)), opacity: Math.max(0, Math.min(1, finite(item.opacity, 1))), visible: item.visible !== false, locked: item.locked === true, dataUrl: String(item.dataUrl || ''), text: String(item.text || ''), fontSize: Math.max(1, finite(item.fontSize, 48)), fontFamily: String(item.fontFamily || 'Arial'), fontWeight: /^(normal|bold|[1-9]00)$/.test(String(item.fontWeight)) ? String(item.fontWeight) : 'normal', textAlign: ['left','center','right'].includes(item.textAlign) ? item.textAlign : 'left', color: String(item.color || '#ffffff'), prompt: String(item.prompt || ''), kind: item.kind === 'background' ? 'background' : 'asset' }
    }) }
  }
  function controller(initial, persist = () => {}) {
    let state = normalize(initial), selected = state.layers.at(-1)?.id || '', pending = null, revision = 0
    const undo = [], redo = []
    const save = () => { revision++; persist(clone(state)); return state }
    const history = () => { undo.push(clone(state)); if (undo.length > 30) undo.shift(); redo.length = 0 }
    function edit(fn) { if (pending) throw new Error('请先取消当前生成'); history(); fn(state); save() }
    return {
      get snapshot() { return clone(state) }, get selected() { return selected }, get busy() { return !!pending },
      select(key) { if (state.layers.some(l => l.id === key)) selected = key },
      replaceProject(value) { if (pending) throw new Error('请先取消当前生成'); if (!value || value.version !== 1 || !Array.isArray(value.layers) || !Number.isFinite(Number(value.width)) || !Number.isFinite(Number(value.height)) || value.layers.length > 500 || value.width < 64 || value.height < 64 || value.width > 8192 || value.height > 8192) throw new Error('图层项目格式无效'); const next = normalize(value); history(); state = next; selected = state.layers.at(-1)?.id || ''; save() },
      add(layer) { edit(s => { const next = normalize({ layers: [layer] }).layers[0]; if (s.layers.some(l => l.id === next.id)) next.id = id(); s.layers.push(next); selected = next.id }); return selected },
      patch(key, patch) { edit(s => { const layer = s.layers.find(l => l.id === key); if (!layer) throw new Error('图层不存在'); if (layer.locked && Object.keys(patch).some(k => k !== 'locked')) throw new Error('图层已锁定'); Object.assign(layer, normalize({ layers: [{ ...layer, ...patch, id: key }] }).layers[0]) }) },
      remove(key) { edit(s => { if (s.layers.find(l => l.id === key)?.locked) throw new Error('图层已锁定'); s.layers = s.layers.filter(l => l.id !== key); selected = s.layers.at(-1)?.id || '' }) },
      move(key, offset) { edit(s => { const i = s.layers.findIndex(l => l.id === key), j = Math.max(0, Math.min(s.layers.length - 1, i + offset)); if (i < 0 || s.layers[i].locked) throw new Error('图层已锁定或不存在'); const [layer] = s.layers.splice(i, 1); s.layers.splice(j, 0, layer) }) },
      undo() { if (pending || !undo.length) return; redo.push(clone(state)); state = undo.pop(); save() },
      redo() { if (pending || !redo.length) return; undo.push(clone(state)); state = redo.pop(); save() },
      async regenerate(key, generate) {
        if (pending) throw new Error('已有图层正在生成')
        const layer = state.layers.find(l => l.id === key)
        if (!layer || layer.type !== 'image' || layer.locked) throw new Error('请选择未锁定的图片层')
        const abort = new AbortController(), token = { abort, revision, key }; pending = token
        try {
          const result = await generate(clone(layer), clone(state), abort.signal)
          if (abort.signal.aborted || pending !== token || revision !== token.revision) throw new Error('生成已取消，原图层保留')
          if (!result?.dataUrl) throw new Error('未收到图片，原图层保留')
          history(); Object.assign(layer, { dataUrl: result.dataUrl, provenance: clone(result.provenance || {}), alpha: result.alpha || null }); save(); return clone(layer)
        } finally { if (pending === token) pending = null }
      },
      cancel() { if (pending) { pending.abort.abort(); pending = null } }
    }
  }
  function graph({ names = [], width = 512, height = 512, prompt, seed = 1, runtime, roles = [] }) {
    if (names.length > 10) throw new Error('最多十张参考图，不自动丢弃参考')
    const pixels = width * height, factor = Math.min(1, Math.sqrt(1048576 / pixels))
    const w = Math.max(64, Math.floor(width * factor / 32) * 32), h = Math.max(64, Math.floor(height * factor / 32) * 32)
    const g = {
      '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: runtime.unet } },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: runtime.clip, type: 'qwen_image', device: 'default' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: runtime.vae } },
      '4': { class_type: 'QwenImage21Cache', inputs: { model: ['1', 0], device: 'auto', dtype: 'default' } },
      '5': { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['2', 0], vae: ['3', 0], resolution: 0, prompt: prompt + '\n' + roles.map((r, i) => 'Image ' + (i + 1) + ': ' + r).join('\n'), negative_prompt: '' } },
      '6': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: 1 } },
      '7': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['5', 0], negative: ['5', 1], latent_image: ['6', 0], seed, steps: 28, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'NovaFlow_UI_Layer_' + seed } }
    }
    names.forEach((name, i) => {
      const n = String(100 + i), scale = String(200 + i)
      g[n] = { class_type: 'LoadImage', inputs: { image: name } }
      // A bounded reference budget keeps this path suitable for the existing 16 GB runtime.
      g[scale] = { class_type: 'ImageScaleToTotalPixels', inputs: { image: [n, 0], upscale_method: 'lanczos', megapixels: Math.min(0.35, 1.5 / Math.max(1, names.length)), resolution_steps: 32 } }
      g['5'].inputs['images.image_' + (i + 1)] = [scale, 0]
    })
    return g
  }
  const load = (url, documentRef) => new Promise((resolve, reject) => { const image = new (documentRef.defaultView || root).Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片读取失败')); image.src = url })
  async function composite(model, doc, omit) {
    const canvas = doc.createElement('canvas'); canvas.width = model.width; canvas.height = model.height
    const ctx = canvas.getContext('2d')
    for (const layer of model.layers) {
      if (!layer.visible || layer.id === omit) continue
      ctx.save(); ctx.globalAlpha = layer.opacity
      if (layer.type === 'text') { ctx.font = layer.fontWeight + ' ' + layer.fontSize + 'px ' + layer.fontFamily; ctx.fillStyle = layer.color; ctx.textBaseline = 'top'; ctx.textAlign = layer.textAlign; const textX = layer.x + (layer.textAlign === 'center' ? layer.width / 2 : layer.textAlign === 'right' ? layer.width : 0); layer.text.split('\n').forEach((line, i) => ctx.fillText(line, textX, layer.y + i * layer.fontSize * 1.2, layer.width)) }
      else if (layer.dataUrl) ctx.drawImage(await load(layer.dataUrl, doc), layer.x, layer.y, layer.width, layer.height)
      ctx.restore()
    }
    return canvas
  }
  async function alphaStats(dataUrl, doc) {
    const image = await load(dataUrl, doc), c = doc.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight; const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height).data; let clear = 0, partial = 0, solid = 0
    for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) clear++; else if (data[i] === 255) solid++; else partial++ }
    return { width: c.width, height: c.height, clear, partial, solid }
  }
  const unwrap = value => value?.data || value
  async function localGenerate(layer, model, signal, options = {}) {
    const bridge = options.bridge || root.NovaFlowArtGenerateExecutionBridge, doc = options.document || root.document
    if (!bridge) throw new Error('本地执行桥未就绪')
    const base = await bridge.detectBaseUrl(); if (!base) throw new Error('本地运行环境未连接')
    const queue = unwrap(await bridge.requestJson(base, '/queue'))
    if (queue.queue_running?.length || queue.queue_pending?.length) throw new Error('本地已有任务，请等待完成；未提交图层任务')
    if (signal.aborted) throw new Error('已取消')
    const capability = root.NovaFlowArtGenerateModels?.capabilityFor?.('local', 'img2img', { provider: 'local', nsfw: false })
    if (capability?.engine !== 'qwen-2.1') throw new Error('当前算力未报告 Qwen 2.1；未下载或切换模型')
    const refs = []
    if (layer.dataUrl) refs.push({ dataUrl: layer.dataUrl, role: 'target asset: keep this identity and silhouette unless explicitly requested otherwise' })
    if (layer.kind !== 'background') refs.push({ dataUrl: (await composite(model, doc, layer.id)).toDataURL('image/png'), role: 'scene context only; do not copy the screen, text, background or other controls into this isolated asset' })
    refs.push(...(options.references || []).filter(r => r?.dataUrl).map(r => ({ dataUrl: r.dataUrl, role: r.role || 'reference' })))
    if (!refs.length) { const blank = doc.createElement('canvas'); blank.width = Math.max(64, layer.width); blank.height = Math.max(64, layer.height); refs.push({ dataUrl: blank.toDataURL('image/png'), role: 'empty canvas only; create the requested independent asset or background' }) }
    if (refs.length > 10) throw new Error('图层与场景参考也占名额，请减少参考至十张以内')
    const names = []
    for (let i = 0; i < refs.length; i++) { if (signal.aborted) throw new Error('已取消'); const upload = unwrap(await bridge.uploadDataUrl(base, 'ui_layer_' + Date.now() + '_' + i + '.png', refs[i].dataUrl)); names.push(upload.name || upload.filename) }
    const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) : Math.floor(Math.random() * 1000000000)
    const prompt = layer.kind === 'background'
      ? 'Create only one continuous finished background plate. Opaque complete scene. No UI, controls, panels, icons, letters or numbers. ' + layer.prompt
      : 'Create exactly ONE independent complete game UI art asset on actual transparent alpha. Native RGBA, transparent outer margins, no opaque scene or painted checkerboard. No letters or numbers: text is a separate editable layer. Do not output an entire interface or multiple assets. ' + layer.prompt
    const numberedPrompt = prompt + '\n' + refs.map((r, i) => 'Image ' + (i + 1) + ': ' + r.role).join('\n')
    const built = await bridge.buildRunWorkflow({ provider: 'local', mode: 'img2img', taskProfile: 'ui-layer', uploadedNames: names, referenceRoles: refs.map(r => ({ role: r.role })), referenceSizes: await Promise.all(refs.map(async r => { const image = await load(r.dataUrl, doc); return { width: image.naturalWidth, height: image.naturalHeight } })), maxReferences: 10, prompt: numberedPrompt, outputPrefix: 'NovaFlow_UI_Layer_' + seed, state: { provider: 'local', mode: 'img2img', width: Math.max(64, Math.min(1024, layer.width)), height: Math.max(64, Math.min(1024, layer.height)), nsfw: false, randomSeed: false, seed, localDrawEngine: 'qwen-2.1', samplingOverrides: { 'qwen-2.1:img2img': { steps: 28, cfg: 1 } }, uiRunIntent: 'redesign' } })
    const workflow = built?.workflow || built
    if (!workflow || (built.modelKey && !String(built.modelKey).includes('2.1'))) throw new Error('未匹配 Qwen 2.1 资产工作流，原图层保留')
    await bridge.validateWorkflowNodes(base, workflow)
    if (signal.aborted) throw new Error('已取消')
    const sent = unwrap(await bridge.requestJson(base, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'novaflow_ui_layer_' + seed }) }))
    if (!sent.prompt_id) throw new Error('提交失败，原图层保留')
    const cancelOwn = async () => { try { const q = unwrap(await bridge.requestJson(base, '/queue')); if (q.queue_running?.some(entry => entry[1] === sent.prompt_id)) await bridge.requestJson(base, '/interrupt', { method: 'POST' }); else if (q.queue_pending?.some(entry => entry[1] === sent.prompt_id)) await bridge.requestJson(base, '/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [sent.prompt_id] }) }) } catch {} }
    signal.addEventListener('abort', cancelOwn, { once: true })
    try {
      const start = Date.now()
      while (Date.now() - start < 15 * 60 * 1000) {
        if (signal.aborted) { await cancelOwn(); throw new Error('已取消，原图层保留') }
        const history = unwrap(await bridge.requestJson(base, '/history/' + sent.prompt_id)), item = history[sent.prompt_id]
        const error = item && bridge.historyErrorMessage(item); if (error) throw new Error(error)
        const files = item && bridge.extractFiles(item)
        if (files?.length) {
          const file = files[0], url = '/view?' + new URLSearchParams({ filename: file.filename || file.name, subfolder: file.subfolder || '', type: file.type || 'output' })
          const dataUrl = await bridge.blobToDataUrl(await bridge.fetchBlob(base, url))
          const alpha = await alphaStats(dataUrl, doc)
          if (!alpha.solid && !alpha.partial) throw new Error('生成为空透明图，原图层保留')
          if (layer.kind !== 'background' && (!alpha.clear || alpha.clear / (alpha.width * alpha.height) < 0.02)) throw new Error('模型未输出真实透明资产，原图层保留；可重试或导入透明素材')
          return { dataUrl, alpha, provenance: { promptId: sent.prompt_id, seed, workflow: built.modelKey, prompt: numberedPrompt, referenceRoles: refs.map(r => r.role), elapsedMs: Date.now() - start } }
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      await cancelOwn(); throw new Error('生成超时，原图层保留')
    } finally { signal.removeEventListener('abort', cancelOwn) }
  }
  function validateProject(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.layers) || value.layers.length > 500 || !Number.isFinite(Number(value.width)) || !Number.isFinite(Number(value.height)) || value.width < 64 || value.height < 64 || value.width > 8192 || value.height > 8192) throw new Error('旧图层项目格式无效，原数据未修改')
    const next = normalize(value)
    if (next.layers.some(layer => layer.width > 8192 || layer.height > 8192 || (layer.type === 'image' && layer.dataUrl && !/^data:image\//i.test(layer.dataUrl)))) throw new Error('旧图层素材格式无效，原数据未修改')
    return next
  }
  // Compatibility is data-only. The existing resource tree, canvas and export own the UI.
  async function prepareProject(value, doc) {
    const project = validateProject(value), parts = []
    for (let index = 0; index < project.layers.length; index++) {
      const layer = project.layers[index], bounds = { x: Math.floor(layer.x), y: Math.floor(layer.y), width: Math.ceil(layer.x + layer.width) - Math.floor(layer.x), height: Math.ceil(layer.y + layer.height) - Math.floor(layer.y) }
      const raster = await composite({ width: bounds.width, height: bounds.height, layers: [{ ...layer, x: layer.x - bounds.x, y: layer.y - bounds.y, visible: true }] }, doc)
      const dataUrl = raster.toDataURL('image/png')
      parts.push({ id: layer.id, name: layer.name, label: layer.name, prompt: layer.prompt, x: bounds.x, y: bounds.y, width: raster.width, height: raster.height, layer: index, manualLayer: true, visible: layer.visible, locked: layer.locked, pivot: { x: 0.5, y: 0.5 }, dataUrl, imageDataUrl: dataUrl, needsInpaint: false, metadata: { kind: 'legacy-ui-project', legacyLayerIndex: index, legacyUiLayer: clone(layer), legacyNativeBounds: bounds, legacyRenderedDataUrl: dataUrl } })
    }
    return { width: project.width, height: project.height, parts, previewDataUrl: (await composite(project, doc)).toDataURL('image/png'), originalProject: clone(value) }
  }
  function projectFromParts(project, parts) {
    const next = clone(project)
    next.layers = parts.map(part => {
      const base = clone(part.metadata?.legacyUiLayer || { id: part.id, type: 'image', opacity: 1, dataUrl: part.dataUrl })
      if (part.metadata?.legacyRenderedDataUrl !== part.dataUrl) {
        base.provenance = { ...(base.provenance || {}), legacySource: clone(base), kind: 'shared-layer-edit' }
        base.type = 'image'; base.dataUrl = part.dataUrl; base.opacity = 1
      }
      const bounds = part.metadata?.legacyNativeBounds, originalRaster = part.metadata?.legacyRenderedDataUrl === part.dataUrl
      const geometry = originalRaster && bounds ? { x: base.x + (part.x - bounds.x), y: base.y + (part.y - bounds.y), width: part.width === bounds.width ? base.width : part.width, height: part.height === bounds.height ? base.height : part.height } : { x: part.x, y: part.y, width: part.width, height: part.height }
      return { ...base, ...geometry, id: part.id, name: part.name || part.label || base.name, visible: part.visible !== false, locked: part.locked === true }
    })
    return next
  }
  function mount({ leftHost, store }) {
    const doc = leftHost.ownerDocument, bridge = () => root.NovaFlowSpineSplitBridge, scales = new Map()
    let alive = true, pending = null, last = '', error = '', unsubscribeLayers = null, unsubscribeState = null, section = null, fieldBody = null, status = null, signature = '', snapshot = null
    const make = (tag, text, attrs = {}) => { const node = doc.createElement(tag); if (text) node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node }
    const inputStyle = { width: '100%', minWidth: '0', boxSizing: 'border-box', padding: '4px 6px', border: '1px solid #343434', borderRadius: '6px', background: '#262626', color: '#ddd', fontSize: '11px', height: '28px' }
    const report = reason => { error = reason?.message || String(reason); if (status) status.textContent = error; bridge()?.reportUiLayerProjectError?.(error) }
    function build() {
      if (section || !bridge()?.getUiLayerEditingSnapshot || !doc.createElement) return
      section = make('section', '', { class: 'nf-ui-layer-properties', 'data-novaflow-ui-layer-properties': '1' })
      Object.assign(section.style, { padding: '0', border: '0', minWidth: '0', width: 'max-content', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'thin', pointerEvents: 'auto' })
      fieldBody = make('div'); Object.assign(fieldBody.style, { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 'max-content', height: '28px' })
      status = make('div', '', { 'aria-live': 'polite', 'data-ui-layer-status': '1' }); Object.assign(status.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' })
      section.append(fieldBody, status)
    }
    function numberField(key, value, apply) {
      const node = make('input', '', { type: 'number', 'data-ui-layer-field': key, 'data-novaflow-number-fill': '1', 'aria-label': key === 'scale' ? '\u7b49\u6bd4\u7f29\u653e' : key })
      Object.assign(node.style, inputStyle, { width: '52px', minWidth: '52px', maxWidth: '52px' }); node.value = value; node.step = key === 'scale' ? '1' : 'any'; node.disabled = snapshot.busy || snapshot.selected.locked
      node.addEventListener('change', async () => { const id = snapshot?.selected?.id; if (!id) return; try { await apply(id, Number(node.value)); error = ''; status.textContent = ''; refresh() } catch (reason) { report(reason); signature = ''; refresh() } })
      return node
    }
    function fields() {
      fieldBody.replaceChildren()
      if (!snapshot.selected) return
      const selected = snapshot.selected, key = snapshot.setId + ':' + selected.id
      if (!scales.has(key)) scales.set(key, { width: selected.width, height: selected.height })
      const base = scales.get(key)
      const position = make('div'); Object.assign(position.style, { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' })
      for (const axis of ['x', 'y']) {
        const label = make('label', axis.toUpperCase()); Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '4px', color: '#999', fontSize: '11px', flex: '0 0 auto', textAlign: 'left', whiteSpace: 'nowrap' })
        label.append(numberField(axis, selected[axis], (id, value) => bridge().patchUiLayer(id, { [axis]: value }))); position.append(label)
      }
      fieldBody.append(position)
      const scale = make('label', '\u7f29\u653e'); Object.assign(scale.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#999', textAlign: 'left', flex: '0 0 auto', whiteSpace: 'nowrap' })
      const scaleInput = numberField('scale', Math.round(selected.width / base.width * 1000) / 10, (id, value) => bridge().patchUiLayer(id, { width: base.width * value / 100, height: base.height * value / 100 })); scaleInput.min = '0.1'; scale.append(scaleInput, make('span', '%')); fieldBody.append(scale)
      const opacity = make('label', '\u900f\u660e\u5ea6'); Object.assign(opacity.style, { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#999', textAlign: 'left', flex: '0 0 auto', whiteSpace: 'nowrap' })
      const slider = make('input', '', { type: 'range', min: '0', max: '1', step: '0.01', 'data-ui-layer-field': 'opacity', 'aria-label': '\u900f\u660e\u5ea6' }), value = make('span', Math.round(selected.opacity * 100) + '%')
      Object.assign(slider.style, { width: '78px', minWidth: '78px', margin: '0', accentColor: '#23a47b' }); slider.value = selected.opacity; slider.disabled = snapshot.busy || selected.locked
      slider.addEventListener('input', () => { value.textContent = Math.round(Number(slider.value) * 100) + '%' })
      slider.addEventListener('change', async () => { const id = snapshot?.selected?.id; if (!id) return; try { await bridge().patchUiLayer(id, { opacity: Number(slider.value) }); error = ''; status.textContent = ''; refresh() } catch (reason) { report(reason); signature = ''; refresh() } })
      opacity.append(slider, value); fieldBody.append(opacity)
    }
    function refresh(next) {
      if (!alive) return
      build(); if (!section) return
      const host = bridge().getUiLayerToolbarHost?.(); if (host && section.parentElement !== host) host.appendChild(section)
      snapshot = next?.selected !== undefined ? next : bridge().getUiLayerEditingSnapshot()
      section.style.display = snapshot.selected ? 'block' : 'none'
      status.style.display = error ? 'block' : 'none'; status.textContent = error
      const selected = snapshot.selected, nextSignature = JSON.stringify({ setId: snapshot.setId, busy: snapshot.busy, selected: selected ? { id: selected.id, x: selected.x, y: selected.y, width: selected.width, height: selected.height, opacity: selected.opacity, locked: selected.locked } : null })
      if (signature !== nextSignature) { signature = nextSignature; fields() }
    }
    function bind() {
      if (!unsubscribeLayers && bridge()?.subscribeUiLayerProjects) unsubscribeLayers = bridge().subscribeUiLayerProjects(event => { if (!alive || !event?.project) return; last = JSON.stringify(event.project); store.patchProject({ uiLayers: clone(event.project) }); refresh() })
      if (!unsubscribeState && bridge()?.subscribeUiLayerState) unsubscribeState = bridge().subscribeUiLayerState(refresh)
    }
    function sync() {
      if (!alive) return pending
      bind(); refresh(); if (pending) return pending
      const project = store.getState().project, legacy = project.uiLayers
      if (!legacy?.layers?.length || !bridge()?.importUiLayerProject) return
      const serialized = JSON.stringify(legacy); if (serialized === last) return; last = serialized
      if (!project.uiLayersOriginal) store.patchProject({ uiLayersOriginal: clone(legacy) })
      pending = Promise.resolve().then(() => bridge().importUiLayerProject(legacy, { name: project.title || project.name || '\u56fe\u5c42\u9879\u76ee', activateIfEmpty: true })).catch(report).finally(() => { pending = null; refresh() }); return pending
    }
    const unsubscribeStore = store.subscribe(sync), onResize = () => refresh()
    root.addEventListener?.('resize', onResize); sync()
    return { sync, get pending() { return pending }, get error() { return error }, destroy() { alive = false; unsubscribeStore?.(); unsubscribeLayers?.(); unsubscribeState?.(); root.removeEventListener?.('resize', onResize); section?.remove() } }
  }


  return Object.freeze({ normalize, controller, graph, composite, alphaStats, localGenerate, validateProject, prepareProject, projectFromParts, mount })
})

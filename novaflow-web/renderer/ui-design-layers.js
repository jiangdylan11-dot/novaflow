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
    const doc = leftHost.ownerDocument, bridge = () => root.NovaFlowSpineSplitBridge
    let alive = true, pending = null, last = '', error = '', unsubscribeLayers = null, unsubscribeState = null, section = null, toolbar = null, toolbarHost = null, fieldBody = null, status = null, fieldSignature = '', snapshot = null
    const report = reason => { error = reason?.message || String(reason); if (status) status.textContent = error; bridge()?.reportUiLayerProjectError?.(error) }
    const make = (tag, text, attrs = {}) => { const node = doc.createElement(tag); if (text) node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node }
    const inputStyle = { width: '100%', minWidth: '0', boxSizing: 'border-box', padding: '5px 6px', border: '1px solid #3b3b3b', borderRadius: '5px', background: '#242424', color: '#ddd', fontSize: '11px' }
    const button = (text, action, attrs = {}) => {
      const node = make('button', text, { type: 'button', ...attrs }); Object.assign(node.style, inputStyle, { cursor: 'pointer', minHeight: '28px', whiteSpace: 'nowrap' })
      node.addEventListener('click', async () => { try { await action(); refreshControls() } catch (reason) { report(reason) } }); return node
    }
    const readDataUrl = file => new Promise((resolve, reject) => { const reader = new (doc.defaultView || root).FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) })
    const pickFile = (accept, action) => {
      const picker = make('input', '', { type: 'file', accept }); picker.style.display = 'none'; doc.body.appendChild(picker)
      picker.addEventListener('change', async () => { try { if (picker.files[0]) { await action(picker.files[0]); refreshControls() } } catch (reason) { report(reason) } finally { picker.remove() } }, { once: true }); picker.addEventListener('cancel', () => picker.remove(), { once: true }); picker.click()
    }
    const importImage = async file => { const dataUrl = await readDataUrl(file), size = await alphaStats(dataUrl, doc); await bridge().addUiLayer({ type: 'image', name: file.name, dataUrl, width: size.width, height: size.height, provenance: { kind: 'import', fileName: file.name } }) }
    const openProject = async file => { if (file.size > 32 * 1024 * 1024) throw new Error('图层项目超过32MB'); await bridge().importUiLayerProject(JSON.parse(await file.text()), { name: file.name.replace(/\.json$/i, ''), activate: true }) }
    const download = async format => { const result = await bridge().getUiLayerExport(format), link = make('a', '', { href: result.dataUrl, download: result.name }); doc.body.appendChild(link); link.click(); link.remove(); if (status) status.textContent = '已导出 ' + result.name }
    const latestResult = async () => { const result = store.getState().results.at(-1); if (!result) throw new Error('尚无生成结果'); const dataUrl = result.imageUrl || result.dataUrl, size = await alphaStats(dataUrl, doc); await bridge().addUiLayer({ type: 'image', kind: 'background', name: '整图（未拆层）', dataUrl, provenance: { kind: 'flat-result', resultId: result.id } }) }
    function menu(label, entries, name) {
      const select = make('select', '', { 'aria-label': label, 'data-ui-layer-menu': name }); Object.assign(select.style, inputStyle, { width: 'auto', minWidth: '66px', height: '30px', cursor: 'pointer' })
      select.appendChild(make('option', label, { value: '' }))
      for (const [value, text] of entries) select.appendChild(make('option', text, { value }))
      select.addEventListener('change', async () => { const action = select.value; select.value = ''; try {
        if (name === 'add') {
          if (action === 'image') return pickFile('image/png,image/jpeg,image/webp', importImage)
          if (action === 'latest') return await latestResult()
          if (action === 'text') await bridge().addUiLayer({ type: 'text', name: '文字', text: '文字', x: 24, y: 24, width: 240, height: 64, fontSize: 36, fontFamily: 'Arial', fontWeight: 'normal', textAlign: 'left', color: '#ffffff' })
          else if (action) await bridge().addUiLayer({ type: 'image', kind: action === 'background' ? 'background' : 'asset', name: action === 'background' ? '背景' : '透明资产', prompt: '' })
        } else if (name === 'project') {
          if (action === 'open') return pickFile('application/json,.json', openProject)
          if (action === 'save') await download('json')
        } else if (action) await download(action)
        refreshControls()
      } catch (reason) { report(reason) } }); return select
    }
    function buildControls() {
      if (section || !bridge()?.getUiLayerEditingSnapshot || !doc.createElement) return
      const accordion = root.NovaFlowLeftPanelAccordion
      section = make('section', '', { class: 'nf-ui-layer-properties', 'data-novaflow-ui-layer-properties': '1', 'data-open': '1' }); Object.assign(section.style, accordion?.panelStyle?.() || { padding: '8px 0', borderTop: '1px solid #333' })
      const header = make('div', '图层属性'); Object.assign(header.style, { padding: '8px', color: '#ccc', fontSize: '11px', fontWeight: '500' })
      fieldBody = make('div'); Object.assign(fieldBody.style, { display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: '8px', padding: '0 8px 10px', minWidth: '0' })
      status = make('div', '', { 'aria-live': 'polite', 'data-ui-layer-status': '1' }); Object.assign(status.style, { fontSize: '10px', color: '#a8a8a8', lineHeight: '1.5', overflowWrap: 'anywhere', padding: '0 8px 8px' }); section.append(header, fieldBody, status)
      toolbar = make('div', '', { 'data-ui-layer-toolbar': '1', 'aria-label': '图层操作' }); Object.assign(toolbar.style, { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'nowrap', maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden', pointerEvents: 'auto' })
      toolbar.append(menu('添加', [['asset', '透明资产层'], ['background', '背景层'], ['text', '文字层'], ['image', '导入独立图片'], ['latest', '使用最新整图']], 'add'), menu('项目', [['open', '打开图层项目'], ['save', '保存图层项目 JSON']], 'project'))
      const undo = button('↶', () => bridge().undoUiLayerEdit(), { title: '撤销图层操作（Ctrl+Z）', 'aria-label': '撤销图层操作', 'data-ui-layer-action': 'undo' }), redo = button('↷', () => bridge().redoUiLayerEdit(), { title: '重做图层操作（Ctrl+Y）', 'aria-label': '重做图层操作', 'data-ui-layer-action': 'redo' })
      for (const node of [undo, redo]) Object.assign(node.style, { width: '30px', minWidth: '30px', fontSize: '16px', padding: '0' })
      toolbar.append(undo, redo, menu('导出', [['png', '整图 PNG'], ['layer', '选层 PNG'], ['psd', '图层 PSD'], ['json', '图层 JSON']], 'export'))
    }
    function field(label, key, type = 'text', options) {
      const wrap = make('label', label), node = make(options ? 'select' : type === 'textarea' ? 'textarea' : 'input', '', { 'data-ui-layer-field': key, 'aria-label': label, ...(options || type === 'textarea' ? {} : { type }) })
      Object.assign(wrap.style, { display: 'grid', gap: '4px', color: '#999', fontSize: '10px', minWidth: '0', textAlign: 'left' }); Object.assign(node.style, inputStyle)
      if (options) for (const value of options) node.appendChild(make('option', value, { value }))
      node.value = snapshot.selected[key] ?? ''; node.disabled = snapshot.busy || snapshot.selected.locked
      if (type === 'textarea') { node.rows = key === 'text' ? 3 : 4; Object.assign(node.style, { resize: 'vertical', minHeight: '52px' }) }
      if (type === 'number') { node.setAttribute('data-novaflow-number-fill', '1'); node.step = key === 'opacity' ? '0.05' : 'any'; if (['width', 'height', 'fontSize'].includes(key)) node.min = '1'; if (key === 'opacity') { node.min = '0'; node.max = '1' } }
      const selectedId = snapshot.selected.id
      node.addEventListener('change', async () => { const id = selectedId; if (!id) return; try { await bridge().patchUiLayer(id, { [key]: type === 'number' ? Number(node.value) : node.value }); refreshControls() } catch (reason) { report(reason); fieldSignature = ''; refreshControls() } }); wrap.append(node); return wrap
    }
    function renderFields() {
      if (!fieldBody) return
      fieldBody.replaceChildren()
      if (!snapshot.selected) { fieldBody.append(make('div', '在右侧选择图层后编辑；顶部“添加”可创建图层。')); return }
      const selected = snapshot.selected, locked = selected.locked, id = selected.id
      fieldBody.append(field('名称', 'name'))
      const geometry = make('div'); Object.assign(geometry.style, { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '6px' }); geometry.append(field('X', 'x', 'number'), field('Y', 'y', 'number'), field('宽', 'width', 'number'), field('高', 'height', 'number')); fieldBody.append(geometry, field('透明度', 'opacity', 'number'))
      if (selected.type === 'text') {
        fieldBody.append(field('文字内容', 'text', 'textarea'), field('字体', 'fontFamily'), field('字号', 'fontSize', 'number'), field('字重', 'fontWeight', 'text', ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900']), field('对齐', 'textAlign', 'text', ['left', 'center', 'right']), field('颜色', 'color', 'color'))
      } else {
        fieldBody.append(field('仅此图层的设计需求', 'prompt', 'textarea'))
        const regenerate = button(snapshot.generating ? '正在生成选中层…' : '本地重生选中层', () => bridge().regenerateUiLayer(id), { 'data-ui-layer-action': 'regenerate' }); regenerate.disabled = snapshot.busy || locked; fieldBody.append(regenerate)
        if (snapshot.generating) fieldBody.append(button('取消图层生成', () => bridge().cancelUiLayerGeneration(), { 'data-ui-layer-action': 'cancel' }))
        const replace = button('替换选层图片', () => pickFile('image/png,image/jpeg,image/webp', async file => { const dataUrl = await readDataUrl(file); await bridge().patchUiLayer(id, { dataUrl, provenance: { kind: 'import-replacement', fileName: file.name, previous: selected.provenance || null } }) }), { 'data-ui-layer-action': 'replace' }); replace.disabled = snapshot.busy || locked; fieldBody.append(replace)
      }
      const actions = make('div'); Object.assign(actions.style, { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '5px' })
      for (const [text, action, disabled] of [[selected.visible === false ? '显示' : '隐藏', () => bridge().patchUiLayer(id, { visible: selected.visible === false }), snapshot.busy || locked], [locked ? '解锁' : '锁定', () => bridge().patchUiLayer(id, { locked: !locked }), snapshot.busy], ['上移', () => bridge().moveUiLayer(id, 1), snapshot.busy || locked], ['下移', () => bridge().moveUiLayer(id, -1), snapshot.busy || locked]]) { const node = button(text, action); node.disabled = disabled; actions.append(node) }
      fieldBody.append(actions); const remove = button('删除图层', () => bridge().removeUiLayer(id), { 'data-ui-layer-action': 'delete' }); remove.disabled = snapshot.busy || locked; fieldBody.append(remove)
    }
    function refreshControls(next) {
      if (!alive) return
      buildControls(); if (!section) return
      const layout = leftHost.querySelector('[data-novaflow-ui-layout-section="1"]'); if (layout && section.previousElementSibling !== layout) layout.after(section)
      const host = bridge().getUiLayerToolbarHost?.(); if (host && toolbarHost !== host) { host.appendChild(toolbar); toolbarHost = host }
      snapshot = next?.selected !== undefined ? next : bridge().getUiLayerEditingSnapshot()
      const { dataUrl, provenance, ...selectedFields } = snapshot.selected || {}, signature = JSON.stringify({ ...snapshot, selected: selectedFields })
      if (signature !== fieldSignature) { fieldSignature = signature; renderFields() }
      toolbar.querySelectorAll('select').forEach(node => { node.disabled = snapshot.busy })
      toolbar.querySelector('[data-ui-layer-action="undo"]').disabled = snapshot.busy || !snapshot.canUndo
      toolbar.querySelector('[data-ui-layer-action="redo"]').disabled = snapshot.busy || !snapshot.canRedo
    }
    function bind() {
      if (!unsubscribeLayers && bridge()?.subscribeUiLayerProjects) unsubscribeLayers = bridge().subscribeUiLayerProjects(event => {
        if (!alive || !event?.project) return
        last = JSON.stringify(event.project); store.patchProject({ uiLayers: clone(event.project) }); refreshControls()
      })
      if (!unsubscribeState && bridge()?.subscribeUiLayerState) unsubscribeState = bridge().subscribeUiLayerState(refreshControls)
    }
    function sync() {
      if (!alive) return pending
      bind(); refreshControls()
      if (pending) return pending
      const project = store.getState().project, legacy = project.uiLayers
      if (!legacy?.layers?.length || !bridge()?.importUiLayerProject) return
      const serialized = JSON.stringify(legacy); if (serialized === last) return
      last = serialized
      if (!project.uiLayersOriginal) store.patchProject({ uiLayersOriginal: clone(legacy) })
      pending = Promise.resolve().then(() => bridge().importUiLayerProject(legacy, { name: project.title || project.name || '图层项目', activateIfEmpty: true })).catch(report).finally(() => { pending = null; refreshControls() })
      return pending
    }
    const unsubscribeStore = store.subscribe(sync), onResize = () => refreshControls()
    root.addEventListener?.('resize', onResize); sync()
    return { sync, get pending() { return pending }, get error() { return error }, destroy() { alive = false; unsubscribeStore?.(); unsubscribeLayers?.(); unsubscribeState?.(); root.removeEventListener?.('resize', onResize); section?.remove(); toolbar?.remove() } }
  }

  return Object.freeze({ normalize, controller, graph, composite, alphaStats, localGenerate, validateProject, prepareProject, projectFromParts, mount })
})

(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateLora = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const mounts = new WeakMap()
  // The catalogue per context, kept across mounts: 模式 collapses and re-opens rebuild the slot,
  // and showing "正在读取兼容 LoRA…" again each time shifted the panel; a known list renders at
  // once and only refreshes quietly.
  const catalogCache = new Map()
  const activeMounts = new Set()
  const requests = new Map()
  let connected = false
  let connectionSource = ''
  let connectionEpoch = 0

  // Use the existing runtime health probe. Repainting a panel is not a reason
  // to query compute, and a failed catalogue waits for the next connection.
  function setConnection(online, source = '') {
    online = Boolean(online)
    source = String(source)
    if (online === connected && source === connectionSource) return
    connected = online
    connectionSource = source
    connectionEpoch += 1
    requests.clear()
    for (const record of activeMounts) {
      if (!record.slot.isConnected) activeMounts.delete(record)
      else mount(record.options)
    }
  }
  globalThis.addEventListener?.('novaflow:compute-node', () => setConnection(false))
  // ...and across page loads: the successful names are what set the
  // block's height, and on a fresh page it arrived after the panel's first frame
  const STORAGE_KEY = 'nf_art_lora_catalog_v1'
  function readStore() {
    try { return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '{}') || {} } catch { return {} }
  }
  function remember(context, entry) {
    try { const store = readStore(); store[context] = entry; globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store)) } catch { /* no storage */ }
  }
  const MAX_LORAS = 8
  // Stable public capability; only the node resolves its target.
  const NSFW_LORA_FEATURE = 'qwen21-nsfw-lora-v1'
  const NSFW_LORA = 'qwen/qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors'
  const UC_LORA_FEATURE = 'qwen21-uc-lora-v1'
  const UC_LORA = 'qwen/qwen-image-2.1-uncensored-lora.safetensors'
  const managed = /lightning|(?:^|[\\/_-])(?:4|8)steps?|(?:^|[\\/])(?:qwen[-_ ]?image[-_ ]?2\.1[-_ ])?(?:viggle[-_ ])?turbo(?:[-_ .]|$)/i
  const key = (name) => String(name || '').replace(/\\/g, '/').toLowerCase()
  // What the page shows for a LoRA: its own file name, never the folder (it names the model) or the
  // extension. The full name stays the value that is sent.
  const displayName = (name) => String(name || '').split(/[\\/]/).pop().replace(/\.safetensors$/i, '')

  function supports(state = {}) {
    return state.provider === 'local' && (state.mode === 'img2img' || state.nsfw === true || qwen21Route(state))
  }

  // Non-NSFW drawing (txt2img and img2img) runs on Qwen-Image-2.1 everywhere, and the list offers
  // only LoRAs the node found to fit 2.1 (header names and shapes against its 2.1 model; the Qwen
  // LoRAs for 2509-2512 never do). NSFW runs on Rapid AIO (2511) and keeps that list.
  function qwen21Route(state = {}) {
    return state.nsfw !== true
  }

  function isSelectable(name) {
    return /^qwen[\\/]/i.test(name) && !String(name).split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part.includes(':')) && /\.safetensors$/i.test(name) && !managed.test(name)
  }

  function catalogFromInfo(info) {
    if (Array.isArray(info?.items)) {
      if (!info.ok) throw new Error(info.error || '读取兼容 LoRA 失败')
      return info.items.map(item => item.name).filter(isSelectable)
    }
    const field = info?.LoraLoaderModelOnly?.input?.required?.lora_name
    const names = Array.isArray(field?.[0]) ? field[0] : field?.[1]?.options
    if (!Array.isArray(names)) throw new Error('Runtime 未返回 LoRA 列表，请刷新重试')
    return Array.from(new Set(names.filter((name) => typeof name === 'string' && isSelectable(name))))
      .sort((a, b) => a.localeCompare(b))
  }

  // Keep the verified catalogue intact: the switch and existing projects use
  // it even though the switch-managed adapter is not offered in the picker.
  // The switch's own adapters, by name; only an unredacted (node/local) build knows them.
  function knownManaged(names) {
    return NSFW_LORA === '<server-side>' ? [] : names.filter(name => [key(NSFW_LORA), key(UC_LORA)].includes(key(name)))
  }

  function managedCatalogFromInfo(info, requiresMetadata) {
    const names = catalogFromInfo(info)
    if (!requiresMetadata) return { names, managedNames: [], metadataReady: true }
    const marked = Array.isArray(info?.items)
      ? info.items.filter(item => item?.autoManaged === NSFW_LORA_FEATURE && typeof item.name === 'string').map(item => item.name)
      : []
    const feature = info?.features?.qwen21_nsfw_lora
    if (typeof feature === 'boolean') {
      const consistent = feature ? marked.length === 1 && names.some(name => key(name) === key(marked[0])) : marked.length === 0
      const uc = Array.isArray(info.items) ? info.items.filter(item => item?.autoManaged === UC_LORA_FEATURE).map(item => item.name) : []
      return { names, managedNames: [...(consistent ? marked : []), ...uc], metadataReady: consistent }
    }
    // The unredacted node/local catalogue can identify its own fixed adapter.
    // Public web builds use a placeholder and wait for trusted node metadata.
    if (NSFW_LORA !== '<server-side>') return { names, managedNames: knownManaged(names), metadataReady: true }
    return { names, managedNames: [], metadataReady: false }
  }

  function selection(items) {
    const active = []
    const seen = new Set()
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.enabled === false || !String(item?.name || '').trim()) continue
      const name = String(item.name).trim()
      const strength = Number(item.strength ?? 1)
      if (!isSelectable(name)) throw new Error(`请选择风格或角色 LoRA：${displayName(name)}`)
      if (!Number.isFinite(strength) || strength < -2 || strength > 2) throw new Error(`LoRA 权重需在 -2 到 2 之间：${displayName(name)}`)
      if (seen.has(key(name))) throw new Error(`LoRA 重复选择：${displayName(name)}`)
      seen.add(key(name))
      if (strength !== 0) active.push({ name, strength })
    }
    if (active.length > MAX_LORAS) throw new Error(`最多添加 ${MAX_LORAS} 个 LoRA`)
    return active
  }

  // A Qwen-Image-2.1 drawing graph; the worker builds it without the page's features, so the graph
  // itself says so.
  function isQwen21Graph(workflow) {
    return Object.values(workflow || {}).some(node => ['UnetLoaderGGUF', 'NovaFlowGGUFBF16Loader', 'UNETLoader'].includes(node?.class_type) &&
      /qwen[-_ ]?image[-_ ]?2\.1/i.test(String(node.inputs?.unet_name || '')))
  }

  // The switch is independent of the manually edited list. Reuse a manually
  // selected copy at its chosen strength; never remove or rewrite that list.
  function effectiveSelection(state = {}) {
    const active = selection(state.loras)
    if (!state.nsfwLoraEnabled) return active
    if (state.provider !== 'local' || !qwen21Route(state)) throw new Error('该 LoRA 仅支持当前本地 Qwen 2.1 生图路线')
    const requested = String(state.nsfwLoraName || '')
    const name = requested === NSFW_LORA_FEATURE ? NSFW_LORA : requested
    if (key(name) !== key(NSFW_LORA)) throw new Error('破限 LoRA 尚未验证，请重新开启开关')
    if (!active.some(item => key(item.name) === key(UC_LORA))) active.unshift({ name: UC_LORA, strength: 1 })
    if (!active.some(item => key(item.name) === key(name))) active.push({ name, strength: 1 })
    if (active.length > MAX_LORAS) throw new Error(`最多添加 ${MAX_LORAS} 个 LoRA`)
    return active
  }

  function verifiedNsfwName(info) {
    if (info?.ok === false) throw new Error(info.error || '无法读取 Qwen 2.1 LoRA 目录')
    if (info?.features && Object.prototype.hasOwnProperty.call(info.features, 'qwen21_nsfw_lora')) {
      if (info.features.qwen21_nsfw_lora === true && info.features.qwen21_uc_lora === true) return NSFW_LORA_FEATURE
      throw new Error('当前算力节点缺少破限所需的 LoRA，或与 Qwen 2.1 不兼容；未提交任务')
    }
    const names = catalogFromInfo(info).map(key)
    if (!names.includes(key(NSFW_LORA)) || !names.includes(key(UC_LORA))) throw new Error('当前算力节点缺少破限所需的 LoRA，或与 Qwen 2.1 不兼容；未提交任务')
    return NSFW_LORA_FEATURE
  }

  // Insert after the Qwen model loader so existing sampling/Lightning patches remain downstream (on
  // 2.1: UnetLoaderGGUF -> LoRAs -> QwenImage21Cache -> KSampler).
  function apply(workflow, state) {
    if (!supports(state) && !(state?.provider === 'local' && isQwen21Graph(workflow))) return workflow
    const selected = effectiveSelection(state)
    if (!selected.length) return workflow
    const bases = Object.entries(workflow).filter(([, node]) =>
      ['UNETLoader', 'UnetLoaderGGUF', 'NovaFlowGGUFBF16Loader', 'CheckpointLoaderSimple'].includes(node?.class_type) &&
      /qwen/i.test(String(node.inputs?.unet_name || node.inputs?.ckpt_name || '')))
    if (bases.length !== 1) throw new Error('当前生成流程无法添加 LoRA')
    const [baseId] = bases[0]
    const targets = []
    for (const node of Object.values(workflow)) {
      for (const [input, link] of Object.entries(node.inputs || {})) {
        if (Array.isArray(link) && String(link[0]) === baseId && link[1] === 0) targets.push([node.inputs, input])
      }
    }
    if (!targets.length) throw new Error('模型没有连接到生成流程')
    let model = [baseId, 0]
    for (const [index, item] of selected.entries()) {
      let id = `nf_art_lora_${index + 1}`
      while (workflow[id]) id += '_'
      workflow[id] = {
        class_type: 'LoraLoaderModelOnly',
        inputs: { model, lora_name: item.name, strength_model: item.strength },
        _meta: { title: `LoRA ${index + 1}: ${item.name}` },
      }
      model = [id, 0]
    }
    targets.forEach(([inputs, input]) => { inputs[input] = model.slice() })
    return workflow
  }

  function validate(workflow, info) {
    const requested = Object.entries(workflow).filter(([id]) => /^nf_art_lora_/.test(id))
    if (!requested.length) return
    const available = new Set(catalogFromInfo(info).map(key))
    for (const [, node] of requested) {
      if (!available.has(key(node.inputs.lora_name))) throw new Error(`LoRA 文件不可用，请刷新列表并重新选择：${node.inputs.lora_name}`)
    }
  }

  function mount(options) {
    const { host, state } = options
    const modelState = options.modelState || state
    if (!host) return
    let record = mounts.get(host)
    if (!record) {
      const slot = host.ownerDocument.createElement('div')
      slot.setAttribute('data-novaflow-art-lora', '1')
      // The brand spec's final spacing, so a rebuilt slot does not move the rows below it.
      slot.style.cssText = 'display:grid;gap:5px;min-width:0;margin:0;text-align:left;'
      host.appendChild(slot)
      record = { slot, options, names: [], managedNames: [], metadataReady: false, loading: false, fetching: false, loadedKey: '', signature: '' }
      mounts.set(host, record)
    }
    record.options = options
    activeMounts.add(record)
    const context = `${modelState.provider}:${modelState.mode}:${!!modelState.nsfw}:${qwen21Route(modelState)}`
    if (record.context !== context) {
      record.context = context; record.loadedKey = ''; record.signature = ''
      const cached = catalogCache.get(context) || readStore()[context]
      record.names = cached && Array.isArray(cached.names) ? cached.names.slice() : []
      record.managedNames = [...new Set([...(cached && Array.isArray(cached.managedNames) ? cached.managedNames : []), ...knownManaged(record.names)])]
      record.metadataReady = cached?.metadataReady === true
      record.quiet = Boolean(cached)
    }
    const supported = supports(modelState)
    if (record.slot.hidden !== !supported) record.slot.hidden = !supported
    const display = supported ? 'grid' : 'none'
    if (record.slot.style.display !== display) record.slot.style.display = display
    if (!supported) return
    const signature = JSON.stringify([state.loras, state.running, record.names, record.managedNames, record.metadataReady, record.loading])
    if (signature !== record.signature) {
      record.signature = signature
      render(record)
    }
    if (connected && record.loadedKey !== `${connectionEpoch}:${context}` && !record.fetching && !state.running) void refresh(record)
  }

  async function refresh(record) {
    if (record.fetching) return
    record.fetching = true
    const context = record.context
    const epoch = connectionEpoch
    const modelState = record.options.modelState || record.options.state
    const request = qwen21Route(modelState) ? { nsfw: false, engine: 'qwen-2.1' } : { nsfw: !!modelState.nsfw }
    let dropped = false
    // A quiet refresh keeps the cached names on screen instead of the loading placeholder.
    record.loading = !record.quiet
    record.loadedKey = `${epoch}:${context}`
    mount(record.options)
    try {
      // Share both success and failure across rebuilt hosts in this connection.
      if (!requests.has(context)) requests.set(context, Promise.resolve().then(() => record.options.loadCatalog(request)).then(info => managedCatalogFromInfo(info, request.engine === 'qwen-2.1')))
      const result = await requests.get(context)
      const { names, managedNames, metadataReady } = result
      if (!connected || epoch !== connectionEpoch || context !== record.context) return
      const entry = { names: names.slice(), managedNames: managedNames.slice(), metadataReady, at: Date.now() }
      catalogCache.set(context, entry)
      remember(context, entry)
      if (context === record.context) {
        record.names = names
        record.managedNames = managedNames
        record.metadataReady = metadataReady
        const before = (record.options.state.loras || []).length
        record.options.state.loras = (record.options.state.loras || []).filter(item => names.includes(item.name))
        dropped = record.options.state.loras.length !== before
      }
    } catch (_) {
      // Keep the last successful list and selected LoRAs. Connection failures
      // belong to compute status, not an error/retry row in this sidebar.
    } finally {
      record.fetching = false
      record.loading = false
      record.quiet = false
      mount(record.options)
      if (dropped) record.options.onChange?.()
    }
  }

  function render(record) {
    const { slot, options } = record
    const { state } = options
    const doc = slot.ownerDocument
    const items = Array.isArray(state.loras) ? state.loras : (state.loras = [])
    const element = (tag, text, css) => {
      const el = doc.createElement(tag)
      if (text) el.textContent = text
      if (css) el.style.cssText = css
      return el
    }
    // The chosen LoRAs can change the route, and with it the reference grid and steps / CFG.
    const change = () => { mount(record.options); record.options.onChange?.() }
    const children = [element('div', '添加兼容 LoRA', 'font-size:11px;color:#999;line-height:16px;')]
    const select = element('select', '', 'box-sizing:border-box;width:100%;min-width:0;height:32px;min-height:32px;max-height:32px;background:#262626;color:#e9e9e9;border:1px solid #343434;border-radius:6px;padding:0 26px 0 10px;font-size:12px;appearance:none;-webkit-appearance:none;')
    select.setAttribute('data-novaflow-art-generate-select-field', '1')
    select.setAttribute('aria-label', '添加兼容 LoRA')
    const available = record.names.filter(name => !record.managedNames.some(managedName => key(managedName) === key(name)) && !items.some(item => key(item.name) === key(name)))
    const placeholder = element('option', record.loading ? '正在读取兼容 LoRA…' : !record.metadataReady && record.names.length ? '目录待更新，自动管理项可能仍显示' : available.length ? '请选择兼容 LoRA' : record.names.length ? '所有兼容 LoRA 已添加' : '暂无 LoRA 可用')
    placeholder.value = ''
    select.appendChild(placeholder)
    available.forEach(name => {
      const option = element('option', displayName(name))
      option.value = name
      select.appendChild(option)
    })
    select.value = ''
    select.disabled = Boolean(state.running) || record.loading || !available.length || items.length >= MAX_LORAS
    select.addEventListener('change', () => {
      if (state.running || !available.includes(select.value) || items.length >= MAX_LORAS) return
      items.push({ name: select.value, strength: 1, enabled: true })
      change()
    })
    children.push(select)
    items.forEach((item, index) => {
      const card = element('div', '', 'box-sizing:border-box;display:grid;gap:2px;min-width:0;padding:6px 8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:8px;')
      card.setAttribute('data-novaflow-art-lora-card', '1')
      const filename = element('div', displayName(item.name), 'font-size:11px;color:rgba(244,247,251,.92);overflow-wrap:anywhere;line-height:14px;')
      filename.title = displayName(item.name)
      const row = element('div', '', 'display:flex;align-items:center;gap:10px;min-width:0;')
      const control = element('div', '', 'flex:1;min-width:0;')
      const label = element('div', `强度: ${Number(item.strength).toFixed(2)}`, 'font-size:11px;color:#999;line-height:14px;')
      const range = element('input', '', 'display:block;box-sizing:border-box;width:100%;height:16px;margin:2px 0 0;accent-color:#1ca879;')
      range.type = 'range'
      range.min = '0'; range.max = '2'; range.step = '0.05'; range.value = String(item.strength)
      range.disabled = Boolean(state.running)
      range.setAttribute('aria-label', `LoRA ${index + 1} 强度`)
      range.addEventListener('input', () => {
        if (state.running) return
        const value = Number(range.value)
        if (!Number.isFinite(value)) return
        item.strength = Math.max(-2, Math.min(2, value))
        label.textContent = `强度: ${item.strength.toFixed(2)}`
        record.signature = JSON.stringify([state.loras, state.running, record.names, record.managedNames, record.metadataReady, record.loading])
      })
      control.append(label, range)
      const remove = element('button', '×', 'flex:none;width:28px;height:28px;padding:0;border-radius:8px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fca5a5;cursor:pointer;font-weight:600;font-size:14px;line-height:26px;')
      remove.type = 'button'
      remove.disabled = Boolean(state.running)
      remove.setAttribute('aria-label', `移除 ${displayName(item.name)}`)
      remove.addEventListener('click', () => { if (!state.running) { items.splice(index, 1); change() } })
      row.append(control, remove)
      card.append(filename, row)
      children.push(card)
    })
    slot.replaceChildren(...children)
  }

  return Object.freeze({ supports, qwen21Route, isQwen21Graph, catalogFromInfo, selection, effectiveSelection, verifiedNsfwName, NSFW_LORA, apply, validate, mount, setConnection, displayName })
})

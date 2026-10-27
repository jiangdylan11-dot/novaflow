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
  const managed = /lightning|turbo|(?:^|[\\/_-])(?:4|8)steps?/i
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
    return Object.values(workflow || {}).some(node => ['UnetLoaderGGUF', 'UNETLoader'].includes(node?.class_type) &&
      /qwen[-_ ]?image[-_ ]?2\.1/i.test(String(node.inputs?.unet_name || '')))
  }

  // Insert after the Qwen model loader so existing sampling/Lightning patches remain downstream (on
  // 2.1: UnetLoaderGGUF -> LoRAs -> QwenImage21Cache -> KSampler).
  function apply(workflow, state) {
    if (!supports(state) && !(state?.provider === 'local' && isQwen21Graph(workflow))) return workflow
    const selected = selection(state.loras)
    if (!selected.length) return workflow
    const bases = Object.entries(workflow).filter(([, node]) =>
      ['UNETLoader', 'UnetLoaderGGUF', 'CheckpointLoaderSimple'].includes(node?.class_type) &&
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
    const available = new Set(catalogFromInfo(info))
    for (const [, node] of requested) {
      if (!available.has(node.inputs.lora_name)) throw new Error(`LoRA 文件不可用，请刷新列表并重新选择：${node.inputs.lora_name}`)
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
      record = { slot, options, names: [], loading: false, fetching: false, loadedKey: '', signature: '' }
      mounts.set(host, record)
    }
    record.options = options
    activeMounts.add(record)
    const context = `${modelState.provider}:${modelState.mode}:${!!modelState.nsfw}:${qwen21Route(modelState)}`
    if (record.context !== context) {
      record.context = context; record.loadedKey = ''; record.signature = ''
      const cached = catalogCache.get(context) || readStore()[context]
      record.names = cached && Array.isArray(cached.names) ? cached.names.slice() : []
      record.quiet = Boolean(cached)
    }
    const supported = supports(modelState)
    if (record.slot.hidden !== !supported) record.slot.hidden = !supported
    const display = supported ? 'grid' : 'none'
    if (record.slot.style.display !== display) record.slot.style.display = display
    if (!supported) return
    const signature = JSON.stringify([state.loras, state.running, record.names, record.loading])
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
      if (!requests.has(context)) requests.set(context, Promise.resolve().then(() => record.options.loadCatalog(request)).then(catalogFromInfo))
      const names = await requests.get(context)
      if (!connected || epoch !== connectionEpoch || context !== record.context) return
      catalogCache.set(context, { names: names.slice(), at: Date.now() })
      remember(context, { names: names.slice(), at: Date.now() })
      if (context === record.context) {
        record.names = names
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
    const available = record.names.filter(name => !items.some(item => key(item.name) === key(name)))
    const placeholder = element('option', record.loading ? '正在读取兼容 LoRA…' : available.length ? '请选择兼容 LoRA' : record.names.length ? '所有兼容 LoRA 已添加' : '暂无 LoRA 可用')
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
        record.signature = JSON.stringify([state.loras, state.running, record.names, record.loading])
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

  return Object.freeze({ supports, qwen21Route, isQwen21Graph, catalogFromInfo, selection, apply, validate, mount, setConnection, displayName })
})

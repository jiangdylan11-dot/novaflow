(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateLora = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const mounts = new WeakMap()
  const MAX_LORAS = 8
  const managed = /lightning|turbo|(?:^|[\\/_-])(?:4|8)steps?/i
  const key = (name) => String(name || '').replace(/\\/g, '/').toLowerCase()

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
      if (!isSelectable(name)) throw new Error(`请选择 Qwen 风格或角色 LoRA：${name}`)
      if (!Number.isFinite(strength) || strength < -2 || strength > 2) throw new Error(`LoRA 权重需在 -2 到 2 之间：${name}`)
      if (seen.has(key(name))) throw new Error(`LoRA 重复选择：${name}`)
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
    if (bases.length !== 1) throw new Error('当前工作流没有唯一的 Qwen 模型，无法添加 LoRA')
    const [baseId] = bases[0]
    const targets = []
    for (const node of Object.values(workflow)) {
      for (const [input, link] of Object.entries(node.inputs || {})) {
        if (Array.isArray(link) && String(link[0]) === baseId && link[1] === 0) targets.push([node.inputs, input])
      }
    }
    if (!targets.length) throw new Error('Qwen 模型没有连接到生成流程')
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
    if (!host) return
    let record = mounts.get(host)
    if (!record) {
      const slot = host.ownerDocument.createElement('div')
      slot.setAttribute('data-novaflow-art-lora', '1')
      slot.style.cssText = 'display:grid;gap:6px;min-width:0;margin-top:10px;text-align:left;'
      host.appendChild(slot)
      record = { slot, options, names: [], loaded: false, loading: false, error: '', signature: '' }
      mounts.set(host, record)
    }
    record.options = options
    const context = `${state.provider}:${state.mode}:${!!state.nsfw}:${qwen21Route(state)}`
    if (record.context !== context) { record.context = context; record.loaded = false; record.names = []; record.signature = '' }
    const supported = supports(state)
    if (record.slot.hidden !== !supported) record.slot.hidden = !supported
    const display = supported ? 'grid' : 'none'
    if (record.slot.style.display !== display) record.slot.style.display = display
    if (!supported) return
    const signature = JSON.stringify([state.loras, state.running, record.names, record.loading, record.error])
    if (signature !== record.signature) {
      record.signature = signature
      render(record)
    }
    if (!record.loaded && !record.loading) void refresh(record)
  }

  async function refresh(record) {
    if (record.loading) return
    const context = record.context
    const request = qwen21Route(record.options.state) ? { nsfw: false, engine: 'qwen-2.1' } : { nsfw: !!record.options.state.nsfw }
    let dropped = false
    record.loading = true
    record.loaded = true
    record.error = ''
    mount(record.options)
    try {
      const names = catalogFromInfo(await record.options.loadCatalog(request))
      if (context === record.context) {
        record.names = names
        const before = (record.options.state.loras || []).length
        record.options.state.loras = (record.options.state.loras || []).filter(item => names.includes(item.name))
        dropped = record.options.state.loras.length !== before
      }
    } catch (error) {
      if (context === record.context) record.error = String(error?.message || error)
    } finally {
      record.loading = false
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
    const select = element('select', '', 'box-sizing:border-box;width:100%;min-width:0;height:36px;background:#090909;color:#ddd;border:1px solid #333;border-radius:8px;padding:0 10px;font-size:12px;')
    select.setAttribute('data-novaflow-art-generate-select-field', '1')
    select.setAttribute('aria-label', '添加兼容 LoRA')
    const available = record.names.filter(name => !items.some(item => key(item.name) === key(name)))
    const placeholder = element('option', record.loading ? '正在读取兼容 LoRA…' : available.length ? '请选择兼容 LoRA' : record.names.length ? '所有兼容 LoRA 已添加' : qwen21Route(state) ? '暂无 Qwen-Image-2.1 可用 LoRA' : '暂无兼容 LoRA')
    placeholder.value = ''
    select.appendChild(placeholder)
    available.forEach(name => {
      const option = element('option', name)
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
    if (record.error) {
      const retry = element('button', `${record.error} · 重试`, 'color:#fca5a5;font-size:11px;background:transparent;border:0;padding:0;text-align:left;overflow-wrap:anywhere;cursor:pointer;')
      retry.type = 'button'
      retry.disabled = Boolean(state.running) || record.loading
      retry.addEventListener('click', () => { if (!state.running) void refresh(record) })
      children.push(retry)
    }
    items.forEach((item, index) => {
      const card = element('div', '', 'box-sizing:border-box;display:grid;gap:2px;min-width:0;padding:6px 8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:8px;')
      card.setAttribute('data-novaflow-art-lora-card', '1')
      const filename = element('div', item.name, 'font-size:11px;color:rgba(244,247,251,.92);overflow-wrap:anywhere;line-height:14px;')
      filename.title = item.name
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
        record.signature = JSON.stringify([state.loras, state.running, record.names, record.loading, record.error])
      })
      control.append(label, range)
      const remove = element('button', '×', 'flex:none;width:28px;height:28px;padding:0;border-radius:8px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fca5a5;cursor:pointer;font-weight:900;font-size:14px;line-height:26px;')
      remove.type = 'button'
      remove.disabled = Boolean(state.running)
      remove.setAttribute('aria-label', `移除 ${item.name}`)
      remove.addEventListener('click', () => { if (!state.running) { items.splice(index, 1); change() } })
      row.append(control, remove)
      card.append(filename, row)
      children.push(card)
    })
    slot.replaceChildren(...children)
  }

  return Object.freeze({ supports, qwen21Route, isQwen21Graph, catalogFromInfo, selection, apply, validate, mount })
})

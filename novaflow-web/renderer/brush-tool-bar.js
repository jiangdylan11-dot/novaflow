/*
 * 画板上方居中的笔刷工具条（视频抠图、视频编辑蒙版）
 *
 * 和美工的选区 / 蒙版工具条一个样子、一个位置：
 *   擦除 | 修复 | 画笔 N（按钮，点它切换 画笔 / 钢笔）+ 滑条 | 羽化 N + 滑条 | 全局（视频抠图）/ 退出（视频编辑蒙版）
 * 切到钢笔后，笔刷滑条换成 应用 / 清除 和一句提示（brush-pen-mode.js 的工具条约定）。
 *
 * 这两处原来的控件在左侧面板里（视频抠图是打包好的界面，视频编辑是自己的面板）。
 * 这里不另存一份状态：工具条上的每个控件都去操作面板里原来的那个控件，
 * 再把面板里的这几行收起来，所以快捷键（[ ] ; ' E R）、撤销和保存的设置都照旧。
 */
(function (root) {
  'use strict'
  if (!root || !root.document || root.FoartBrushToolBar) return
  const doc = root.document
  const text = (node) => String(node && node.textContent || '').replace(/\s+/g, '')

  function setInput(input, value) {
    if (!input) return
    const proto = root.HTMLInputElement && root.HTMLInputElement.prototype
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(input, String(value)); else input.value = String(value)
    input.dispatchEvent(new root.Event('input', { bubbles: true }))
    input.dispatchEvent(new root.Event('change', { bubbles: true }))
  }

  const visible = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 }

  // ---- 视频抠图：左侧「单帧 / 全局、擦除 / 修复、笔刷、羽化」那一块
  const cutout = {
    key: 'cutout',
    panel() { return doc.querySelector('[data-novaflow-manual-brush="1"]') },
    canvas() { return doc.querySelector('[data-novaflow-ai-cutout-edit-canvas]') },
    active() { const p = this.panel(); return !!p && p.isConnected && visible(this.canvas()) },
    // 画板这一栏最上面那一行（左边是动画页签，右边是缩放）：工具条放在这一行的正中
    place(height) {
      const c = this.canvas()
      const column = c && (c.closest('[data-novaflow-ai-preview-bg]') || c.closest('[data-novaflow-ai-preview-viewport]'))
      if (!column) return null
      const r = column.getBoundingClientRect()
      const side = doc.querySelector('[data-novaflow-ai-resource-sidebar-panel]')
      const sr = side && side.isConnected ? side.getBoundingClientRect() : null
      const right = sr && sr.left > r.left + 200 && sr.left < r.right ? sr.left - 10 : r.right
      return { cx: (r.left + right) / 2, top: r.top + 8 }
    },
    modeButtons() { const p = this.panel(); return p ? Array.from(p.querySelectorAll('button')).filter((b) => /^(擦除|修复|去色)$/.test(text(b))) : [] },
    modes() {
      return this.modeButtons().map((b) => ({ label: text(b), disabled: b.disabled,
        active: b.getAttribute('data-novaflow-ai-cutout-brush-mode-active') === '1' || b.getAttribute('aria-pressed') === 'true', pick: () => b.click() }))
    },
    ranges() { const p = this.panel(); return p ? Array.from(p.querySelectorAll('input[type="range"]')) : [] },
    size() { const r = this.ranges()[0]; return r ? { value: Number(r.value), min: Number(r.min) || 1, max: Number(r.max) || 300, set: (v) => setInput(r, v) } : null },
    feather() { const r = this.ranges()[1]; return r ? { value: Number(r.value), min: Number(r.min) || 0, max: Number(r.max) || 300, set: (v) => setInput(r, v) } : null },
    global() { const p = this.panel(); const box = p && p.querySelector('input[type="checkbox"]'); return box ? { on: box.checked, disabled: box.disabled, toggle: () => box.click() } : null },
    hide: '[data-novaflow-manual-brush="1"] > [data-novaflow-ai-brush-scope-row],[data-novaflow-manual-brush="1"] > [data-novaflow-ai-cutout-brush-mode-row],[data-novaflow-manual-brush="1"] > [data-novaflow-ai-brush-param-row]'
  }

  // ---- 视频编辑蒙版：左侧「擦除 / 修复、笔刷、羽化」（撤销 / 清除 / 确定 / 取消 留在面板里）
  const videoEdit = {
    key: 'video-edit',
    box() { return doc.getElementById('ve-mask-box') },
    active() { const b = this.box(); return !!b && b.isConnected && doc.body.getAttribute('data-nf-ve-masking') === '1' },
    // 退出 = 不要这次的改动（左侧的「应用蒙版」才是保留）
    exit() { const n = doc.getElementById('ve-mask-cancel'); if (n) n.click() },
    // 蒙版编辑期间画板让出上面一条（样式里的 margin-top），工具条放在让出来的这条里
    place(height) {
      const stage = doc.querySelector('.nf-vm-stage')
      if (!stage || !stage.isConnected) return null
      const r = stage.getBoundingClientRect()
      return { cx: r.left + r.width / 2, top: r.top - height - 6 }
    },
    modes() {
      return ['ve-mask-erase', 've-mask-restore'].map((id) => doc.getElementById(id)).filter(Boolean)
        .map((b) => ({ label: text(b), disabled: b.disabled, active: b.getAttribute('aria-pressed') === 'true', pick: () => b.click() }))
    },
    field(id) { const n = doc.getElementById(id); return n ? { value: Number(n.value), min: Number(n.min) || 0, max: Number(n.max) || 300, set: (v) => setInput(n, v) } : null },
    size() { return this.field('ve-mask-brush') },
    feather() { return this.field('ve-mask-feather') },
    global() { return null },
    hide: '#ve-mask-box'
  }

  const hosts = [cutout, videoEdit]
  let bar = null, parts = null, host = null

  // 左侧面板里的这几行从第一帧起就不显示（等工具条出现后再收起会先闪一下老样子）
  const earlyStyle = doc.createElement('style')
  earlyStyle.setAttribute('data-foart-brush-bar-early', '1')
  earlyStyle.textContent = '[data-novaflow-manual-brush="1"] > :has(input[type="range"]),[data-novaflow-manual-brush="1"] > :has(input[type="checkbox"]),[data-novaflow-manual-brush="1"] > :has(button){display:none!important}#ve-mask-box{display:none!important}'
  ;(doc.head || doc.documentElement).appendChild(earlyStyle)

  function build() {
    const style = doc.createElement('style')
    style.textContent = `
      .foart-brush-bar{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:4px;border-radius:10px;background:#1a1a1a;box-shadow:0 0 0 1px #2a2a2a;font:400 12px/1 system-ui,"Microsoft YaHei",sans-serif;color:#e6e6e6;user-select:none;white-space:nowrap}
      .foart-brush-bar[hidden],.foart-brush-bar [hidden]{display:none!important}
      .foart-brush-bar button{all:unset;box-sizing:border-box;height:28px;padding:0 10px;border-radius:6px;font:400 12px/28px system-ui,"Microsoft YaHei",sans-serif;color:#e6e6e6;cursor:pointer;white-space:nowrap}
      .foart-brush-bar button:hover{background:#2a2a2a}
      .foart-brush-bar button[aria-pressed="true"]{background:#1c4136;color:#9be4cd}
      .foart-brush-bar button[aria-pressed="true"]:hover{background:#215043}
      .foart-brush-bar button[disabled]{opacity:.45;cursor:default}
      .foart-brush-bar button[data-foart-brush-toggle]{background:#242424}
      .foart-brush-bar button[data-foart-brush-toggle]:hover{background:#2e2e2e}
      .foart-brush-bar label{display:flex;align-items:center;gap:7px;height:28px;padding:0 4px}
      .foart-brush-bar input[type=range]{-webkit-appearance:none;appearance:none;width:92px;height:4px;margin:0;border-radius:2px;outline:none;cursor:pointer;background:linear-gradient(to right,#1ea672 var(--fill,0%),#3a3a3a var(--fill,0%))}
      .foart-brush-bar input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;background:#1ea672;border:0}
      .foart-brush-bar .hint{padding:0 4px;color:#8c8c8c;min-width:156px}
      body[data-foart-brush-bar="video-edit"] .nf-vm-stage{margin-top:42px!important}
      ${hosts.map((h) => `body[data-foart-brush-bar="${h.key}"] :is(${h.hide})`).join(',')}{display:none!important}`
    ;(doc.head || doc.documentElement).appendChild(style)
    bar = doc.createElement('div')
    bar.className = 'foart-brush-bar'
    bar.hidden = true
    bar.setAttribute('data-foart-brush-pen-bar', '1') // 视频编辑蒙版期间只放行带这个标记的控件
    bar.setAttribute('data-novaflow-source-layout', '1')
    const el = (tag, props, children) => { const n = doc.createElement(tag); Object.entries(props || {}).forEach(([k, v]) => { if (k === 'text') n.textContent = v; else n.setAttribute(k, v) }); (children || []).forEach((c) => n.appendChild(c)); if (tag === 'button') { n.type = 'button'; n.setAttribute('data-novaflow-source-layout', '1') } return n }
    const pen = (name) => () => { const api = root.FoartBrushPen; if (api && typeof api[name] === 'function') api[name]() }
    parts = {
      modes: el('span', { style: 'display:flex;gap:4px' }),
      toggle: el('button', { 'data-foart-brush-toggle': 'brush' }, [el('span', { 'data-foart-pen-when': 'brush', 'data-part': 'size-text' }), el('span', { 'data-foart-pen-when': 'pen', text: '钢笔' })]),
      sizeRange: el('input', { type: 'range', step: '1' }),
      apply: el('button', { 'data-foart-pen-when': 'pen', 'data-foart-pen-need': 'path', text: '应用', title: '把钢笔圈出的区域按当前模式处理（Enter）' }),
      clear: el('button', { 'data-foart-pen-when': 'pen', text: '清除', title: '清除钢笔路径（Esc）' }),
      hint: el('span', { 'data-foart-pen-when': 'pen', 'data-foart-pen-hint': '1', class: 'hint' }),
      featherText: el('span', {}),
      featherRange: el('input', { type: 'range', step: '1' }),
      global: el('button', { text: '全局', title: '开启后这一笔作用到所有帧；关闭时只改当前帧', 'aria-pressed': 'false' }),
      exit: el('button', { text: '退出', title: '退出蒙版编辑，不保留这次的改动（Esc）' })
    }
    parts.sizeLabel = el('label', { 'data-foart-pen-when': 'brush' }, [parts.sizeRange])
    parts.featherLabel = el('label', {}, [parts.featherText, parts.featherRange])
    ;[parts.modes, parts.toggle, parts.sizeLabel, parts.apply, parts.clear, parts.hint, parts.featherLabel, parts.global, parts.exit].forEach((n) => bar.appendChild(n))
    parts.exit.addEventListener('click', () => { if (host && typeof host.exit === 'function') host.exit(); root.setTimeout(sync, 0) })
    parts.toggle.addEventListener('click', pen('toggle'))
    parts.apply.addEventListener('click', pen('apply'))
    parts.clear.addEventListener('click', pen('clear'))
    parts.sizeRange.addEventListener('input', () => { const f = host && host.size(); if (f) f.set(parts.sizeRange.value); sync() })
    parts.featherRange.addEventListener('input', () => { const f = host && host.feather(); if (f) f.set(parts.featherRange.value); sync() })
    parts.global.addEventListener('click', () => { const g = host && host.global(); if (g && !g.disabled) g.toggle(); root.setTimeout(sync, 0) })
    ;['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'wheel'].forEach((type) => bar.addEventListener(type, (ev) => ev.stopPropagation()))
    doc.body.appendChild(bar)
  }

  function fillRange(range, field) {
    if (String(range.min) !== String(field.min)) range.min = String(field.min)
    if (String(range.max) !== String(field.max)) range.max = String(field.max)
    if (doc.activeElement !== range && String(range.value) !== String(field.value)) range.value = String(field.value)
    const pct = (Number(range.value) - field.min) / Math.max(1, field.max - field.min) * 100
    range.style.setProperty('--fill', pct + '%')
  }

  function sync() {
    const next = hosts.find((h) => { try { return h.active() } catch { return false } }) || null
    if (!next) {
      if (bar && !bar.hidden) bar.hidden = true
      if (doc.body.hasAttribute('data-foart-brush-bar')) doc.body.removeAttribute('data-foart-brush-bar')
      host = null
      return
    }
    if (!bar) build()
    host = next
    if (doc.body.getAttribute('data-foart-brush-bar') !== host.key) doc.body.setAttribute('data-foart-brush-bar', host.key)
    // 擦除 / 修复
    const modes = host.modes()
    const sig = modes.map((m) => m.label).join('|')
    if (parts.modes.getAttribute('data-sig') !== sig) {
      parts.modes.textContent = ''
      modes.forEach((m, i) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = m.label; b.setAttribute('data-novaflow-source-layout', '1'); b.addEventListener('click', () => { const now = host && host.modes()[i]; if (now && !now.disabled) now.pick(); root.setTimeout(sync, 0) }); parts.modes.appendChild(b) })
      parts.modes.setAttribute('data-sig', sig)
    }
    modes.forEach((m, i) => { const b = parts.modes.children[i]; if (!b) return; const p = String(!!m.active); if (b.getAttribute('aria-pressed') !== p) b.setAttribute('aria-pressed', p); if (b.disabled !== !!m.disabled) b.disabled = !!m.disabled })
    // 画笔大小、羽化
    const size = host.size(), feather = host.feather()
    const sizeText = parts.toggle.querySelector('[data-part="size-text"]')
    const st = `画笔 ${size ? Math.round(size.value) : ''}`
    if (sizeText.textContent !== st) sizeText.textContent = st
    if (size) fillRange(parts.sizeRange, size)
    const ft = `羽化 ${feather ? Math.round(feather.value) : ''}`
    if (parts.featherText.textContent !== ft) parts.featherText.textContent = ft
    if (feather) fillRange(parts.featherRange, feather)
    // 全局（只有视频抠图有）
    const g = host.global()
    if (parts.global.hidden !== !g) parts.global.hidden = !g
    const canExit = typeof host.exit === 'function'
    if (parts.exit.hidden !== !canExit) parts.exit.hidden = !canExit
    if (g) { const p = String(!!g.on); if (parts.global.getAttribute('aria-pressed') !== p) parts.global.setAttribute('aria-pressed', p); if (parts.global.disabled !== !!g.disabled) parts.global.disabled = !!g.disabled }
    if (root.FoartBrushPen && typeof root.FoartBrushPen.syncControls === 'function') root.FoartBrushPen.syncControls()
    // 位置：画板上方居中
    bar.hidden = false
    const at = host.place(bar.offsetHeight)
    if (!at) { bar.hidden = true; return }
    const vw = root.innerWidth || doc.documentElement.clientWidth
    const left = Math.round(Math.max(4, Math.min(vw - bar.offsetWidth - 4, at.cx - bar.offsetWidth / 2)))
    const top = Math.round(Math.max(4, at.top))
    if (bar.style.left !== left + 'px') bar.style.left = left + 'px'
    if (bar.style.top !== top + 'px') bar.style.top = top + 'px'
  }

  root.setInterval(sync, 200)
  // 面板一出现就摆好工具条，不等下一次轮询
  let queued = false
  try {
    new root.MutationObserver(() => {
      if (queued) return
      const need = (!host && (cutout.panel() || doc.body.getAttribute('data-nf-ve-masking') === '1')) || (host && !host.active())
      if (!need) return
      queued = true
      root.requestAnimationFrame(() => { queued = false; sync() })
    }).observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-nf-ve-masking', 'data-novaflow-manual-brush'] })
  } catch { /* 轮询兜底 */ }
  root.addEventListener('resize', sync)
  root.FoartBrushToolBar = { sync }
})(typeof window !== 'undefined' ? window : null)

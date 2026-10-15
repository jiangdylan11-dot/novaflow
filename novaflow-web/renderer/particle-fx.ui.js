// 骨骼动画「粒子特效」面板（2026-10-16 用户：粒子特效不必独立一页，它就是给 Spine 动画用的；面板像飘带那样停在旁边，
// 粒子直接作用在画布里、底下是原有动画；「你把这些重要的功能都给精简掉了」——功能和粒子页一样，不精简）。
// 这里是右侧停靠的参数面板：模板管理（模板库弹框 / 导入 / 保存）、粒子系统列表、发射模式、发射器形状、基础属性、缩放与旋转、
// 外观与资源，控件、范围、显示条件、打开开关时写的默认值都照粒子页（粒子页的 React 包里逐项对出来的）。
// 再加三块骨骼动画用的：播放（起 / 时长）、位置（骨骼 / 跟随图层 / 发射点）、写入动画（混合 / 帧数 / 切片大小）。
// 粒子画在骨骼动画舞台上由编辑器负责（spine-skeleton-editor.js）。引擎和模板库：renderer/assets/particle-fx.js（NovaFlowParticleFx）。
// NovaFlowParticleFxUI.openDock({ host, last, settings, setSettings, place, onChange, onGenerateSequence, onGenerateSpine, onClose })
;(function (root) {
  'use strict'
  const GREEN = '#1EA672'
  const PFX = () => root.NovaFlowParticleFx
  const STYLE_ID = 'pfx-dock-style'
  const STYLE = `
.pfx-dock{position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;background:#1F1F1F;color:#d6d6d6;font-size:12px;font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif}
.pfx-dock *{box-sizing:border-box}
.pfx-hd{flex:none;height:46px;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;border-bottom:1px solid #2A2A2A}
.pfx-title{font-size:13px;font-weight:600;color:#f0f0f0}
.pfx-x{margin-left:auto;width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:rgba(238,244,252,.6);font-size:16px;line-height:24px;cursor:pointer;padding:0}
.pfx-x:hover{background:#373737;color:#fff}
.pfx-body{flex:1;min-height:0;overflow-y:auto;padding:0 0 12px}
.pfx-ft{flex:none;display:flex;gap:8px;padding:10px 12px;border-top:1px solid #2A2A2A}
.pfx-ft .fxm-btn{flex:1;height:30px}
.pfx-sec{border-bottom:1px solid #2A2A2A}
.pfx-sec-hd{width:100%;height:38px;display:flex;align-items:center;gap:8px;padding:0 12px;border:0;background:transparent;color:#e6e6e6;font:inherit;font-size:12px;font-weight:500;cursor:pointer;text-align:left}
.pfx-sec-hd:hover{background:#262626}
.pfx-sec-hd i{margin-left:auto;width:0;height:0;border-left:4px solid #8a8e93;border-top:3.5px solid transparent;border-bottom:3.5px solid transparent;transition:transform .12s}
.pfx-sec[data-open="1"] .pfx-sec-hd i{transform:rotate(90deg)}
.pfx-sec-bd{padding:4px 12px 12px;display:none}
.pfx-sec[data-open="1"] .pfx-sec-bd{display:block}
.pfx-sl{margin:6px 0 2px}
.pfx-sl-top{display:flex;align-items:center;gap:6px;min-height:22px}
.pfx-sl-top label{flex:1;color:#b9bcbf;font-size:12px}
.pfx-sl-num{width:64px;height:22px;background:#2B2B2B;border:0;border-radius:5px;color:#eee;font:inherit;font-size:11px;padding:0 4px 0 6px}
.pfx-sl-num::-webkit-inner-spin-button{opacity:.35}
.pfx-sl-suf{color:#7d8186;font-size:11px;min-width:22px}
.pfx-sl input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:3px;margin:6px 0 4px;padding:0;border:0;border-radius:3px;outline:0;background:linear-gradient(90deg,${GREEN} 0,${GREEN} var(--pct,0%),#3a3a3a var(--pct,0%),#3a3a3a 100%)}
.pfx-sl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;background:${GREEN};border:0;cursor:pointer}
.pfx-lbl{display:block;color:#b9bcbf;font-size:11px;margin:8px 0 4px}
.pfx-seg{display:flex;gap:4px;margin:6px 0}
.pfx-seg .fxm-btn{flex:1;height:28px;padding:0 4px}
.pfx-grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:6px 0}
.pfx-grid5 .fxm-btn{height:30px;padding:0 2px;font-size:11px}
.pfx-tog{margin:6px 0;border-radius:7px;border:1px solid transparent;background:#2B2B2B}
.pfx-tog[data-on="1"]{background:rgba(30,166,114,.10);border-color:rgba(30,166,114,.25)}
.pfx-tog.l2{background:rgba(30,166,114,.08)}
.pfx-tog.l2[data-on="1"]{background:rgba(20,184,166,.30);border-color:rgba(20,184,166,.6)}
.pfx-tog-hd{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border:0;background:transparent;color:#e6e6e6;font:inherit;font-size:12px;cursor:pointer;text-align:left}
.pfx-tog-hd span:last-child{font-size:11px;color:#7d8186}
.pfx-tog[data-on="1"] .pfx-tog-hd span:last-child{color:#7fe0b6}
.pfx-tog-bd{padding:0 10px 8px}
.pfx-help{font-size:11px;color:#7d8186;line-height:1.5;margin:6px 0}
.pfx-sel{width:100%;height:28px;background:#2B2B2B;color:#ddd;border:0;border-radius:6px;font:inherit;font-size:12px;padding:0 6px}
.pfx-row{display:flex;align-items:center;gap:6px;margin:6px 0}
.pfx-sys{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:7px;background:#1d1d1d;margin:4px 0;cursor:pointer}
.pfx-sys[data-on="1"]{background:#333333}
.pfx-sys .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pfx-ib{width:26px;height:24px;border:0;border-radius:6px;background:#2B2B2B;color:#cfd2d6;cursor:pointer;font:inherit;font-size:12px;padding:0}
.pfx-ib:hover{background:#373737;color:#fff}
.pfx-ib:disabled{opacity:.4;cursor:default}
.pfx-ib.on{background:rgba(34,197,94,.18);color:#9be4c4}
.pfx-tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:6px 0}
.pfx-tile{position:relative;border:0;border-radius:6px;background:#2B2B2B;cursor:pointer;padding:3px;display:flex;flex-direction:column;align-items:center;gap:2px;color:#9a9ea3;font:inherit;font-size:10px;min-width:0}
.pfx-tile:hover{background:#373737}
.pfx-tile[data-on="1"]{background:#17223a;color:#e6e6e6}
.pfx-tile img{width:100%;aspect-ratio:1;object-fit:contain}
.pfx-tile span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pfx-tile .del{position:absolute;right:1px;top:1px;width:15px;height:15px;border:0;border-radius:4px;background:rgba(0,0,0,.6);color:#ddd;font-size:10px;line-height:15px;padding:0;cursor:pointer;display:none}
.pfx-tile:hover .del{display:block}
.pfx-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:60px;border:1px dashed #3A3A3A;border-radius:8px;background:#1B1B1B;color:#bdbdbd;cursor:pointer;margin:6px 0;font-size:12px}
.pfx-drop:hover{border-color:${GREEN}}
.pfx-drop small{color:#7d8186;font-size:11px}
.pfx-card{border-radius:8px;overflow:hidden;margin:6px 0;border:1px solid #2A2A2A}
.pfx-card-hd{display:flex;align-items:center;gap:6px;padding:5px 6px;background:#0b0f14}
.pfx-card:first-child .pfx-card-hd,.pfx-card[data-first="1"] .pfx-card-hd{background:#17223a}
.pfx-card-hd img{width:34px;height:34px;object-fit:contain;background:#000;border-radius:4px}
.pfx-card-hd .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pfx-card-bd{padding:6px 8px 8px;background:#1d1d1d}
.pfx-del{width:100%;height:26px;border:0;border-radius:6px;background:rgba(239,68,68,.14);color:#f6a5a5;font:inherit;font-size:12px;cursor:pointer;margin-top:6px}
.pfx-del:hover{background:rgba(239,68,68,.24)}
.pfx-colour{display:flex;align-items:center;gap:6px;margin:4px 0}
.pfx-colour input[type=color]{width:28px;height:26px;border:0;padding:0;background:transparent;cursor:pointer}
.pfx-colour input[type=text]{flex:1;height:24px;background:#151515;border:0;border-radius:5px;color:#bbb;font:inherit;font-size:11px;padding:0 6px}
.pfx-colour button{height:24px;border:0;border-radius:5px;background:#2B2B2B;color:#ccc;font:inherit;font-size:11px;cursor:pointer;padding:0 8px}
.pfx-curve{background:#171717;border:1px solid #333;border-radius:8px;padding:4px;margin:4px 0}
.pfx-curve svg{display:block;width:100%;height:100px;cursor:crosshair;user-select:none}
.pfx-preset{position:relative;margin:4px 0}
.pfx-preset-btn{width:100%;height:28px;display:flex;align-items:center;gap:6px;border:0;border-radius:6px;background:#070707;color:#ddd;font:inherit;font-size:12px;padding:0 8px;cursor:pointer}
.pfx-preset-list{position:absolute;left:0;right:0;top:30px;z-index:5;max-height:220px;overflow-y:auto;background:#1b1b1b;border:1px solid #333;border-radius:6px;padding:4px}
.pfx-preset-item{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;cursor:pointer}
.pfx-preset-item:hover{background:#2B2B2B}
.pfx-preset-item .x{margin-left:auto;border:0;background:transparent;color:#999;cursor:pointer;display:none}
.pfx-preset-item:hover .x{display:block}
.pfx-info{font-size:11px;color:#7d8186;padding:8px 12px 0;line-height:1.5}
.pfx-dock :focus,.pfx-dock :focus-visible,.pfx-lib :focus,.pfx-lib :focus-visible{outline:none}
.pfx-lib{position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;font-size:12px;color:#d6d6d6}
.pfx-lib-win{width:min(1080px,94vw);max-height:90vh;display:flex;flex-direction:column;background:#1F1F1F;border:1px solid #2E2E2E;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.45)}
.pfx-lib-hd{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #2A2A2A}
.pfx-lib-hd b{font-size:14px;color:#f0f0f0;margin-right:auto}
.pfx-lib-hd .fxm-btn{min-width:72px}
.pfx-lib-grid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:14px}
.pfx-lib-card{position:relative;background:#151515;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px;cursor:pointer}
.pfx-lib-card:hover{border-color:rgba(30,166,114,.6)}
.pfx-lib-card canvas{display:block;width:100%;aspect-ratio:16/10;background:#000;border-radius:6px}
.pfx-lib-card .nm{margin-top:6px;font-size:12px;color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pfx-lib-card .badge{position:absolute;left:14px;top:14px;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.2);font-size:11px}
.pfx-lib-card .x{position:absolute;right:12px;top:12px;width:22px;height:22px;border:0;border-radius:6px;background:rgba(0,0,0,.55);color:#ddd;cursor:pointer;display:none}
.pfx-lib-card:hover .x{display:block}
.pfx-lib-add{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:150px;border:1px dashed rgba(255,255,255,.2)}
.pfx-lib-add .plus{font-size:44px;font-weight:200;line-height:1;color:#fff}
.pfx-lib-dlg{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;border-radius:10px}
.pfx-lib-dlg>div{background:#1F1F1F;border:1px solid #2E2E2E;border-radius:8px;padding:16px;width:340px}
.pfx-lib-dlg input{width:100%;height:30px;background:#2B2B2B;border:0;border-radius:6px;color:#eee;font:inherit;padding:0 8px;margin:8px 0 12px}
.pfx-lib-dlg .btns{display:flex;gap:8px;justify-content:flex-end}
`
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const clamp01 = (v) => clamp(Number(v) || 0, 0, 1)
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k === 'class') n.className = v
      else if (k === 'html') n.innerHTML = v
      else if (k === 'style') n.style.cssText = v
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
      else if (k in n && k !== 'list') n[k] = v
      else n.setAttribute(k, v === true ? '' : v)
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k))
    return n
  }
  const decimals = (step) => { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0 }
  const fmt = (v, step) => { const n = Number(v) || 0; const d = decimals(step); return d ? n.toFixed(Math.min(3, d)) : String(Math.round(n)) }
  const pct = (v, min, max) => ((clamp(Number(v) || 0, min, max) - min) / ((max - min) || 1)) * 100 + '%'
  const firstSeqIndex = (sprites) => (sprites || []).findIndex((s) => s && s.mode === 'sequence')
  const userData = () => { const own = root.electronAPI; if (own && own.loadUserData) return own; try { const p = root.parent; if (p && p !== root && p.electronAPI && p.electronAPI.loadUserData) return p.electronAPI } catch (_) { /* ignore */ } return null }

  function openDock(options = {}) {
    const P = PFX()
    if (!P) throw new Error('粒子核心没有加载（particle-fx.js）')
    if (root.NovaFlowFxMakerUI && root.NovaFlowFxMakerUI.ensureStyle) root.NovaFlowFxMakerUI.ensureStyle()
    if (!document.getElementById(STYLE_ID)) document.head.appendChild(h('style', { id: STYLE_ID }, STYLE))
    const last = options.last || {}
    const S = {
      systems: Array.isArray(last.systems) && last.systems.length ? last.systems.map((c) => P.normalizeConfig(c)) : [P.normalizeConfig({})],
      active: Math.max(0, Number(last.active) || 0), tplName: last.tplName || '', blend: last.blend || '',
      open: new Set(last.open || ['play', 'place', 'write']), closed: false, busy: false, rename: -1,
      pathEdit: last.pathEdit !== false, library: null, presets: P.loadCurvePresets(), sizeOne: {},
    }
    if (S.active >= S.systems.length) S.active = 0
    const cfg = () => S.systems[S.active]
    const firstBlend = () => { const s = (cfg().sprites || [])[0]; const b = (s && s.blendMode) || 'add'; return b === 'add' ? 'add' : b === 'screen' ? 'screen' : b === 'multiply' ? 'multiply' : 'normal' }
    if (!S.blend) S.blend = firstBlend()

    const dock = h('div', { class: 'pfx-dock', 'data-novaflow-runtime-ignore': '1' },
      h('div', { class: 'pfx-hd' }, h('span', { class: 'pfx-title' }, '粒子特效'), h('button', { class: 'pfx-x', type: 'button', title: '关闭', onclick: () => close() }, '×')),
      h('div', { class: 'pfx-body', 'data-body': '' }),
      h('div', { class: 'pfx-ft' },
        h('button', { class: 'fxm-btn', type: 'button', title: '每个粒子一个插槽打关键帧（和粒子页导出的 Spine 工程一样），直接并进当前工程', onclick: () => run('spine') }, '生成 Spine 动画'),
        h('button', { class: 'fxm-btn fxm-primary', type: 'button', title: '渲染成切片进图片文件夹，一个插槽逐帧换图写进动画', onclick: () => run('sequence') }, '生成序列')))
    ;(options.host || document.body).appendChild(dock)
    const body = dock.querySelector('[data-body]')
    let infoText = '拖画布上的绿点移动发射位置；动画够长就跟着播放，空动画时粒子自己循环播。'
    let infoEl = null
    const setInfo = (t) => { infoText = t; if (infoEl) infoEl.textContent = t }
    let busyEl = null
    function busy(text, frac) {
      if (text == null) { if (busyEl) busyEl.remove(); busyEl = null; return }
      if (!busyEl) { busyEl = h('div', { class: 'fxm-busy' }, h('div', {}, h('div', { 'data-bt': '' }), h('div', { class: 'fxm-bar' }, h('i')))); dock.appendChild(busyEl) }
      busyEl.querySelector('[data-bt]').textContent = text
      busyEl.querySelector('.fxm-bar>i').style.width = Math.round(clamp(frac || 0, 0, 1) * 100) + '%'
    }
    const settings = () => (options.settings ? options.settings() : { frames: 24, duration: 60, fps: 30, start: 0, width: 512, height: 512 })
    const setSettings = (patch) => { if (options.setSettings) options.setSettings(patch) }
    let changeTimer = 0
    const changed = (now) => { clearTimeout(changeTimer); if (now) { if (options.onChange && !S.closed) options.onChange(api) } else changeTimer = setTimeout(() => { if (options.onChange && !S.closed) options.onChange(api) }, 50) }
    const update = (patch, structural = true) => { Object.assign(cfg(), patch); if (structural) render(); changed(structural) }
    const updateShape = (patch, structural = true) => update({ shape: { ...(cfg().shape || {}), ...patch } }, structural)

    // ---------------------------------------------------------------- 控件
    function slider(label, value, min, max, step, suffix, onChange, opts = {}) {
      const v = value == null || !Number.isFinite(Number(value)) ? min : Number(value)
      const range = h('input', { type: 'range', min, max, step, value: v })
      const num = h('input', { class: 'pfx-sl-num', type: 'number', step, value: fmt(v, step) })
      if (opts.field) num.dataset.field = opts.field
      range.style.setProperty('--pct', pct(v, min, max))
      const set = (x, fromNum) => { range.style.setProperty('--pct', pct(x, min, max)); if (fromNum) range.value = x; else num.value = fmt(x, step); onChange(x) }
      range.oninput = () => set(Number(range.value), false)
      num.onchange = () => { const x = Number(num.value); if (Number.isFinite(x)) set(x, true) }
      return h('div', { class: 'pfx-sl' }, h('div', { class: 'pfx-sl-top' }, h('label', {}, label), num, suffix ? h('span', { class: 'pfx-sl-suf' }, suffix) : null), range)
    }
    // 滑条直接改当前系统的字段（拖的时候不整页重画）
    const fs = (label, field, min, max, step, suffix, def) => slider(label, cfg()[field] ?? def ?? min, min, max, step, suffix, (x) => { cfg()[field] = x; changed() }, { field })
    const shapeSlider = (label, field, min, max, step, suffix, def) => slider(label, (cfg().shape || {})[field] ?? def, min, max, step, suffix, (x) => { cfg().shape = { ...(cfg().shape || {}), [field]: x }; changed() })
    function seg(items, value, pick) {
      return h('div', { class: 'pfx-seg' }, items.map(([v, label]) => h('button', { class: 'fxm-btn', type: 'button', 'data-on': v === value ? '1' : '0', onclick: () => pick(v) }, label)))
    }
    function toggle(title, on, flip, children, level = 1) {
      return h('div', { class: 'pfx-tog' + (level === 2 ? ' l2' : ''), 'data-on': on ? '1' : '0' },
        h('button', { class: 'pfx-tog-hd', type: 'button', onclick: () => flip(!on) }, h('span', {}, title), h('span', {}, on ? '已开启' : '未开启')),
        on && children && children.length ? h('div', { class: 'pfx-tog-bd' }, children) : null)
    }
    function select(label, items, value, pick) {
      return h('div', {}, label ? h('span', { class: 'pfx-lbl' }, label) : null,
        h('select', { class: 'pfx-sel', onchange: (e) => pick(e.target.value) }, items.map(([v, l]) => h('option', { value: v, selected: v === value }, l))))
    }
    const help = (text) => h('div', { class: 'pfx-help' }, text)
    function section(id, title, build) {
      const open = S.open.has(id)
      const sec = h('div', { class: 'pfx-sec', 'data-open': open ? '1' : '0', 'data-sec': id },
        h('button', { class: 'pfx-sec-hd', type: 'button', onclick: () => { if (S.open.has(id)) S.open.delete(id); else S.open.add(id); sec.dataset.open = S.open.has(id) ? '1' : '0'; if (S.open.has(id) && !sec.querySelector('.pfx-sec-bd').childElementCount) sec.querySelector('.pfx-sec-bd').append(...[build()].flat()) } }, title, h('i')),
        h('div', { class: 'pfx-sec-bd' }, open ? build() : []))
      return sec
    }

    // ---------------------------------------------------------------- 曲线编辑器（大小 / 透明度 / S形强度 / 节点分布），预设和粒子页同一份
    function miniCurve(points) {
      const pts = (points || []).map((p) => `${(2 + clamp01(p.t) * 38).toFixed(1)},${(16 - (clamp(Number(p.v) || 0, 0, 1.3) / 1.3) * 14).toFixed(1)}`).join(' ')
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 42 18'); svg.setAttribute('width', '42'); svg.setAttribute('height', '18')
      svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${GREEN}" stroke-width="1.4"/>`
      return svg
    }
    const normCurve = (pts) => P.normalizeKey1DCurve((pts || []).map((p) => ({ t: clamp01(p.t), v: clamp01(p.v) })))
    function curveEditor(title, points, onChange, presetKey, colour = GREEN, opts = {}) {
      let pts = normCurve(points)
      const wrap = h('div', {})
      // 预设
      let selected = ''
      const presetBox = h('div', { class: 'pfx-preset' })
      const nameIn = h('input', { class: 'pfx-sl-num', style: 'flex:1;width:auto;height:26px', placeholder: '预设名称' })
      const drawPreset = () => {
        presetBox.textContent = ''
        const value = selected && S.presets[presetKey] && S.presets[presetKey][selected]
        const vpts = value ? (Array.isArray(value) ? value : value.points) : null
        const btn = h('button', { class: 'pfx-preset-btn', type: 'button' }, vpts ? miniCurve(vpts) : null, h('span', {}, selected || '选择预设'), h('span', { style: 'margin-left:auto;color:#888' }, '▾'))
        presetBox.append(btn)
        btn.onclick = () => {
          if (presetBox.querySelector('.pfx-preset-list')) { presetBox.querySelector('.pfx-preset-list').remove(); return }
          const list = h('div', { class: 'pfx-preset-list', role: 'listbox' })
          list.append(h('div', { class: 'pfx-preset-item', onclick: () => { selected = ''; drawPreset() } }, '不选择'))
          const map = S.presets[presetKey] || {}
          const names = Object.keys(map).sort((a, b) => a.localeCompare(b))
          if (!names.length) list.append(h('div', { class: 'pfx-help' }, '暂无预存'))
          for (const n of names) {
            const v = map[n], vp = Array.isArray(v) ? v : v.points
            list.append(h('div', { class: 'pfx-preset-item', onclick: () => {
              selected = n
              if (opts.applyPresetValue) opts.applyPresetValue(v)
              else { pts = normCurve(vp); onChange(pts); drawCurve() }
              drawPreset()
            } }, miniCurve(vp), h('span', {}, n), h('button', { class: 'x', type: 'button', title: `删除预存 ${n}`, onclick: (e) => { e.stopPropagation(); delete S.presets[presetKey][n]; P.saveCurvePresets(S.presets); if (selected === n) selected = ''; drawPreset() } }, '×')))
          }
          presetBox.append(list)
          const off = (e) => { if (!presetBox.contains(e.target)) { list.remove(); document.removeEventListener('pointerdown', off, true) } }
          setTimeout(() => document.addEventListener('pointerdown', off, true), 0)
        }
      }
      drawPreset()
      const saveBtn = h('button', { class: 'fxm-btn', type: 'button', onclick: () => {
        const name = nameIn.value.trim() || selected
        if (!name) return
        S.presets[presetKey] = { ...(S.presets[presetKey] || {}), [name]: opts.getPresetValue ? opts.getPresetValue(pts) : normCurve(pts) }
        P.saveCurvePresets(S.presets)
        selected = name; nameIn.value = ''; drawPreset()
      } }, '保存')
      // 画布：x = 10 + t·200，y = 10 + (1 − v)·80；双击空白加点，双击点删点（两头不删），拖点（两头只动 v）
      const box = h('div', { class: 'pfx-curve' })
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 220 100')
      box.append(svg)
      let drag = -1
      const toTV = (ev) => { const r = svg.getBoundingClientRect(); const x = ((ev.clientX - r.left) / r.width) * 220, y = ((ev.clientY - r.top) / r.height) * 100; return { t: clamp01((x - 10) / 200), v: clamp01(1 - (y - 10) / 80) } }
      function drawCurve() {
        const X = (t) => 10 + t * 200, Y = (v) => 10 + (1 - v) * 80
        let g = ''
        for (const k of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${X(k)}" y1="10" x2="${X(k)}" y2="90" stroke="#2a2a2a" stroke-dasharray="2 3"/><line x1="10" y1="${Y(k)}" x2="210" y2="${Y(k)}" stroke="#2a2a2a" stroke-dasharray="2 3"/>`
        g += `<polyline points="${pts.map((p) => `${X(p.t)},${Y(opts.flat ? 0.5 : p.v)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="2"/>`
        g += pts.map((p, i) => `<circle data-i="${i}" cx="${X(p.t)}" cy="${Y(opts.flat ? 0.5 : p.v)}" r="5" fill="${drag === i ? '#fff' : colour}" style="cursor:grab"/>`).join('')
        svg.innerHTML = g
      }
      svg.addEventListener('mousedown', (ev) => { const i = ev.target.getAttribute && ev.target.getAttribute('data-i'); if (i != null) { drag = Number(i); drawCurve() } })
      svg.addEventListener('mousemove', (ev) => {
        if (drag < 0) return
        const tv = toTV(ev), ends = drag === 0 || drag === pts.length - 1
        pts[drag] = { t: ends ? pts[drag].t : tv.t, v: opts.flat ? 0.5 : tv.v }
        const moved = pts[drag]
        pts = normCurve(pts)
        drag = pts.indexOf(pts.find((p) => p.t === moved.t && p.v === moved.v))
        drawCurve(); onChange(pts)
      })
      const end = () => { if (drag >= 0) { drag = -1; drawCurve() } }
      svg.addEventListener('mouseup', end); svg.addEventListener('mouseleave', end)
      svg.addEventListener('dblclick', (ev) => {
        const i = ev.target.getAttribute && ev.target.getAttribute('data-i')
        if (i != null) { const k = Number(i); if (k === 0 || k === pts.length - 1) return; pts = pts.filter((_, j) => j !== k) }
        else { const tv = toTV(ev); pts = normCurve([...pts, { t: tv.t, v: opts.flat ? 0.5 : tv.v }]) }
        drawCurve(); onChange(pts)
      })
      drawCurve()
      wrap.append(presetBox, h('div', { class: 'pfx-row' }, nameIn, saveBtn), title ? h('div', { class: 'pfx-help', style: 'margin:4px 0 2px;color:#9a9a9a' }, title) : null, box)
      wrap.setPoints = (next) => { pts = normCurve(next); drawCurve() }
      return wrap
    }

    // ---------------------------------------------------------------- 1. 模板管理（模板库 / 导入 / 保存）
    function buildTemplateManager() {
      return h('div', { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:6px 0' },
        h('button', { class: 'fxm-btn', type: 'button', onclick: () => openLibrary() }, '模板库'),
        h('button', { class: 'fxm-btn', type: 'button', title: '导入粒子项目 JSON：作为一个新的粒子系统', onclick: () => importProject() }, '导入'),
        h('button', { class: 'fxm-btn', type: 'button', title: '把当前粒子系统存成 JSON 文件（贴图一起存进去）', onclick: () => saveProject() }, '保存'))
    }
    async function importProject() {
      const f = await new Promise((res) => { const i = h('input', { type: 'file', accept: '.json,application/json' }); i.onchange = () => res(i.files && i.files[0]); i.click() })
      if (!f) return
      try {
        const json = JSON.parse(await f.text())
        if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('不是粒子项目 JSON')
        const c = P.normalizeConfig({ ...json, systemName: json.systemName || `导入的系统 ${S.systems.length + 1}` })
        S.systems.push(c); S.active = S.systems.length - 1
        render(); changed(true); setInfo('已导入项目 JSON 为一个新的粒子系统')
      } catch (e) { setInfo('导入失败：' + e.message) }
    }
    function saveProject() {
      const c = cfg(), name = String(c.systemName || 'particle').replace(/[\\/:*?"<>|\s]+/g, '_')
      const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' })
      const a = h('a', { href: URL.createObjectURL(blob), download: `NovaFlow项目_${name}.json` })
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      setInfo(`已保存：NovaFlow项目_${name}.json`)
    }

    // ---------------------------------------------------------------- 模板库弹框（和粒子页同一份模板：卡片动画预览、点击存储、删除、重置）
    async function openLibrary() {
      if (document.querySelector('.pfx-lib')) return
      const lib = h('div', { class: 'pfx-lib', 'data-novaflow-runtime-ignore': '1' })
      const grid = h('div', { class: 'pfx-lib-grid' }, h('div', { class: 'pfx-help' }, '读取模板库…'))
      const win = h('div', { class: 'pfx-lib-win', style: 'position:relative' },
        h('div', { class: 'pfx-lib-hd' }, h('b', {}, '模板库'),
          h('button', { class: 'fxm-btn', type: 'button', onclick: () => confirmBox('将清空当前模板库，并重置为安装包内置模板。是否继续？', async () => { try { list = await P.resetTemplates(); drawCards(); setInfo('已重置模板库') } catch (e) { setInfo('重置失败：' + e.message) } }) }, '重置'),
          h('button', { class: 'fxm-btn', type: 'button', onclick: () => shut() }, '关闭')),
        grid)
      lib.append(win)
      document.body.append(lib)
      let list = [], previews = [], raf = 0, lastT = 0, acc = 0
      const shut = () => { cancelAnimationFrame(raf); lib.remove(); document.removeEventListener('keydown', onKey, true) }
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (win.querySelector('.pfx-lib-dlg')) win.querySelector('.pfx-lib-dlg').remove(); else shut() } }
      document.addEventListener('keydown', onKey, true)
      lib.addEventListener('pointerdown', (e) => { if (e.target === lib) shut() })
      function confirmBox(text, ok) {
        const dlg = h('div', { class: 'pfx-lib-dlg' }, h('div', {}, h('div', { style: 'line-height:1.6;margin-bottom:12px' }, text),
          h('div', { class: 'btns' }, h('button', { class: 'fxm-btn', type: 'button', onclick: () => dlg.remove() }, '取消'), h('button', { class: 'fxm-btn fxm-primary', type: 'button', onclick: () => { dlg.remove(); ok() } }, '确定'))))
        win.append(dlg)
      }
      const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40) || '模板'
      function saveDialog() {
        const input = h('input', { value: S.systems[S.active].systemName || '模板', placeholder: '请输入模板名称' })
        const save = async (group) => {
          const name = cleanName(input.value), id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const item = group ? { id, name, systems: clone(S.systems), createdAt: Date.now() } : { id, name, config: clone(cfg()), createdAt: Date.now() }
          list = [item, ...list]
          try { await P.saveTemplates(list); dlg.remove(); drawCards(); setInfo(`已存入模板库：「${name}」`) } catch (e) { setInfo('存储失败：' + e.message) }
        }
        input.onkeydown = (e) => { if (e.key === 'Enter') save(false) }
        const dlg = h('div', { class: 'pfx-lib-dlg' }, h('div', {}, h('b', {}, '存储模板'), input,
          h('div', { class: 'btns' }, h('button', { class: 'fxm-btn', type: 'button', onclick: () => dlg.remove() }, '取消'),
            h('button', { class: 'fxm-btn', type: 'button', onclick: () => save(false) }, '存当前'),
            h('button', { class: 'fxm-btn fxm-primary', type: 'button', onclick: () => save(true) }, '存整组'))))
        win.append(dlg); setTimeout(() => { input.focus(); input.select() }, 0)
      }
      async function drawCards() {
        previews = []
        grid.textContent = ''
        grid.append(h('div', { class: 'pfx-lib-card pfx-lib-add', onclick: () => saveDialog() }, h('div', { class: 'plus' }, '+'), h('div', { style: 'font-weight:600;margin-top:8px' }, '点击存储'), h('div', { class: 'pfx-help', style: 'margin:4px 0 0' }, '支持存当前系统或整组叠加')))
        if (!list.length) grid.append(h('div', { class: 'pfx-help' }, '暂无模板'))
        for (const t of list) {
          const canvas = h('canvas', { width: 240, height: 150 })
          const systems = Array.isArray(t.systems) ? t.systems : null
          const card = h('div', { class: 'pfx-lib-card', title: t.name || '模板', onclick: () => applyTemplate(t) }, canvas,
            systems && systems.length > 1 ? h('span', { class: 'badge' }, `×${systems.length}`) : null,
            h('button', { class: 'x', type: 'button', title: '删除', onclick: async (e) => { e.stopPropagation(); list = list.filter((x) => x !== t); try { await P.saveTemplates(list) } catch (err) { setInfo('删除失败：' + err.message) } drawCards() } }, '×'),
            h('div', { class: 'nm' }, t.name || '模板'))
          grid.append(card)
          P.createPreview(P.systemsOf(t), canvas, 0.3).then((p) => previews.push(p)).catch(() => {})
        }
      }
      function applyTemplate(t) {
        const go = () => {
          if (Array.isArray(t.systems) && t.systems.length) { S.systems = t.systems.map((c) => P.normalizeConfig(c)); S.active = 0 }
          else {
            const cur = cfg(), next = P.normalizeConfig({ ...t.config })
            if (!t.config || !('sprites' in t.config)) next.sprites = cur.sprites   // 模板没带贴图：保留现在的
            next.enabled = cur.enabled; next.id = cur.id; next.systemName = t.name || next.systemName
            S.systems[S.active] = next
          }
          S.tplName = t.name || ''
          S.blend = firstBlend()
          // 循环的模板：时长用模板的循环长度
          const c0 = S.systems[0]
          if (c0 && c0.loopAnimation && Number(c0.loopDurationSec) > 0) setSettings({ duration: Math.max(2, Math.round(Number(c0.loopDurationSec) * (settings().fps || 30))) })
          shut(); render(); changed(true)
          setInfo(`已应用模板「${S.tplName}」`)
        }
        if (Array.isArray(t.systems) && t.systems.length > 1) confirmBox('将用该模板替换当前所有粒子系统（叠加效果）。是否继续？', go)
        else go()
      }
      const tick = (now) => {
        raf = requestAnimationFrame(tick)
        const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0
        lastT = now; acc += dt
        if (acc < 1 / 24) return
        const step = acc; acc = 0
        for (const p of previews) p.step(step)
      }
      raf = requestAnimationFrame(tick)
      try { list = await P.loadTemplates() } catch (e) { list = []; setInfo('模板库读取失败：' + e.message) }
      drawCards()
    }

    // ---------------------------------------------------------------- 2. 粒子系统列表
    function buildSystems() {
      const box = h('div', {})
      const n = S.systems.length
      box.append(h('div', { class: 'pfx-row', style: 'justify-content:flex-end' },
        h('button', { class: 'pfx-ib', type: 'button', title: '新建粒子系统', style: `background:${GREEN};color:#fff`, onclick: () => { S.systems.push(P.normalizeConfig({ systemName: `Particle System ${n + 1}` })); S.active = S.systems.length - 1; render(); changed(true) } }, '+'),
        h('button', { class: 'pfx-ib', type: 'button', title: '复制', onclick: () => { const c = clone(cfg()); c.systemName = `${c.systemName || '系统'} (副本)`; S.systems.splice(S.active + 1, 0, c); S.active++; render(); changed(true) } }, '⧉'),
        h('button', { class: 'pfx-ib', type: 'button', title: '下移一层', disabled: S.active >= n - 1, onclick: () => { const a = S.active; [S.systems[a], S.systems[a + 1]] = [S.systems[a + 1], S.systems[a]]; S.active = a + 1; render(); changed(true) } }, '↓'),
        h('button', { class: 'pfx-ib', type: 'button', title: '上移一层', disabled: S.active <= 0, onclick: () => { const a = S.active; [S.systems[a], S.systems[a - 1]] = [S.systems[a - 1], S.systems[a]]; S.active = a - 1; render(); changed(true) } }, '↑')))
      S.systems.forEach((c, i) => {
        const on = c.enabled !== false
        const nameEl = S.rename === i
          ? h('input', { class: 'pfx-sl-num', style: 'flex:1;width:auto', value: c.systemName || '', onclick: (e) => e.stopPropagation(), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { S.rename = -1; render() } }, onblur: (e) => { if (S.rename !== i) return; const v = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 40); c.systemName = v || c.systemName || '未命名'; S.rename = -1; render() } })
          : h('span', { class: 'nm' }, c.systemName || '未命名')
        box.append(h('div', { class: 'pfx-sys', 'data-on': i === S.active ? '1' : '0', onclick: () => { if (S.active !== i) { S.active = i; render(); changed(true) } }, ondblclick: () => { S.active = i; S.rename = i; render(); const inp = body.querySelector('.pfx-sys input'); if (inp) { inp.focus(); inp.select() } } },
          h('button', { class: 'pfx-ib' + (on ? ' on' : ''), type: 'button', title: on ? '停用（从画布隐藏）' : '激活（显示在画布）', onclick: (e) => { e.stopPropagation(); c.enabled = !on; render(); changed(true) } }, on ? '👁' : '—'),
          nameEl,
          h('button', { class: 'pfx-ib', type: 'button', title: n <= 1 ? '至少保留 1 个系统' : '删除', disabled: n <= 1, onclick: (e) => { e.stopPropagation(); S.systems.splice(i, 1); if (S.active >= S.systems.length) S.active = S.systems.length - 1; else if (S.active > i) S.active--; render(); changed(true) } }, '×')))
      })
      box.append(fs('系统 X', 'systemX', -500, 500, 1, ''), fs('系统 Y', 'systemY', -500, 500, 1, ''), fs('旋转偏移', 'systemRotationDeg', 0, 360, 1, '°'))
      return box
    }

    // ---------------------------------------------------------------- 3. 发射模式
    function buildEmit() {
      const c = cfg(), stream = c.mode === 'stream', out = [seg([['burst', '爆发'], ['stream', '持续']], stream ? 'stream' : 'burst', (v) => update({ mode: v }))]
      if (!stream) out.push(fs('单次粒子数量', 'burstCount', 1, 500, 1, ''), fs('循环周期', 'loopIntervalSec', 0.1, 10, 0.1, 's'))
      else {
        out.push(fs('每秒发射速率', 'rate', 1, 300, 1, '/s'), fs('发射持续时间', 'streamDurationSec', 0, 30, 0.1, 's'))
        out.push(toggle('预热 (Warm-up)', !!c.warmupEnabled, (on) => update({ warmupEnabled: on }), [help('预热会在显示第一帧前先模拟一段时间，让流式特效直接进入稳定态。'), fs('预热秒数（0=自动）', 'warmupSeconds', 0, 10, 0.1, 's', 0)]))
        out.push(toggle('首尾循环 (Loop)', !!c.loopAnimation, (on) => {
          if (!on) { update({ loopAnimation: false }); return }
          const maxLife = Math.max(0, Number(c.lifetimeMin) || 0, Number(c.lifetimeMax) || 0)
          const L = Math.max(0.01, maxLife > 0 ? maxLife : settings().duration / (settings().fps || 30))
          update({ loopAnimation: true, loopDurationSec: L, streamLoopEnabled: true, spriteSequenceLoop: true })
        }, []))
        out.push(help('写进骨骼动画时，循环长度和不循环时的时长都按下面「播放」里的时长。'))
      }
      return out
    }

    // ---------------------------------------------------------------- 4. 发射器形状
    function buildShape() {
      const c = cfg(), sh = c.shape || { type: 'point' }, out = []
      out.push(h('div', { class: 'pfx-grid5' }, [['point', '点'], ['circle', '圆形'], ['rect', '矩形'], ['cone', '锥体'], ['custom_path', '路径']].map(([t, l]) =>
        h('button', { class: 'fxm-btn', type: 'button', 'data-on': sh.type === t ? '1' : '0', onclick: () => {
          if (t !== 'custom_path') { updateShape({ type: t }); return }
          update({ pathEnabled: false, pathPoints: Array.isArray(c.pathPoints) && c.pathPoints.length ? c.pathPoints : [{ x: -120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }, { x: 120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }],
            pathClosed: c.pathClosed ?? false, pathReverse: !!c.pathReverse, pathEmitSampleCount: Math.max(1, Math.round(c.pathEmitSampleCount ?? 50)), pathEmitSideMode: c.pathEmitSideMode ?? 'left',
            pathEmitBothSideRatioLeft: clamp01(c.pathEmitBothSideRatioLeft ?? 0.5), shape: { ...sh, type: 'custom_path' } })
          S.pathEdit = true
        } }, l))))
      out.push(toggle('固定贴图朝向', !!c.lockSpriteRotation, (on) => update({ lockSpriteRotation: on }), []))
      if (sh.type === 'circle') out.push(toggle('向内收缩', !!sh.emitInward, (on) => updateShape({ emitInward: on }), []), shapeSlider('内半径', 'innerRadius', 0, 500, 1, 'px', 0), shapeSlider('外半径', 'outerRadius', 10, 800, 1, 'px', 120))
      if (sh.type === 'rect') out.push(toggle('随机方向', !!sh.rectRandomDirection, (on) => updateShape({ rectRandomDirection: on }), []), toggle('边缘发射（区域外）', !!sh.rectEdgeOnly, (on) => updateShape({ rectEdgeOnly: on }), []), shapeSlider('宽度', 'width', 10, 800, 1, 'px', 200), shapeSlider('高度', 'height', 10, 800, 1, 'px', 200))
      if (sh.type === 'cone') out.push(toggle('向内收缩', !!sh.emitInward, (on) => updateShape({ emitInward: on }), []), shapeSlider('锥角', 'coneAngleDeg', 1, 180, 1, '°', 45), shapeSlider('发射半径', 'coneRadius', 10, 800, 1, 'px', 150))
      if (sh.type === 'custom_path') {
        out.push(toggle('画布编辑（锁定坐标）', S.pathEdit, (on) => { S.pathEdit = on; render(); changed(true) }, []))
        out.push(help('路径编辑：开启「画布编辑」后在画布上拖黄色方块（路径点）；双击方块删点；「加点」在路径末尾添一个点。'))
        out.push(h('div', { class: 'pfx-row' }, h('button', { class: 'fxm-btn', type: 'button', style: 'flex:1', onclick: () => addPathPoint() }, '加点')))
        out.push(toggle('闭环', c.pathClosed !== false, (on) => update({ pathClosed: on }), []), toggle('反向', !!c.pathReverse, (on) => update({ pathReverse: on }), []))
        out.push(toggle('喷发朝向', !!c.pathEmitFacingEnabled, (on) => update({ pathEmitFacingEnabled: on }), [slider('朝向角度', c.pathEmitFacingDeg ?? 0, 0, 360, 1, '°', (x) => { c.pathEmitFacingDeg = clamp(Math.round(x), 0, 360); changed() })]))
        out.push(slider('发射点数量', c.pathEmitSampleCount ?? 50, 1, 500, 1, '', (x) => { c.pathEmitSampleCount = Math.max(1, Math.round(x)); changed() }))
        out.push(h('span', { class: 'pfx-lbl' }, '喷发方向'), seg([['left', '左侧'], ['right', '右侧'], ['both', '双侧']], c.pathEmitSideMode || 'left', (v) => update({ pathEmitSideMode: v })))
        if ((c.pathEmitSideMode || 'left') === 'both') out.push(slider('左侧比例', c.pathEmitBothSideRatioLeft ?? 0.5, 0, 1, 0.01, '', (x) => { c.pathEmitBothSideRatioLeft = clamp01(x); changed() }))
      }
      return out
    }
    function addPathPoint() {
      const c = cfg(), pts = Array.isArray(c.pathPoints) ? c.pathPoints : (c.pathPoints = [])
      const lastP = pts[pts.length - 1] || { x: 0, y: 0 }, prev = pts[pts.length - 2] || { x: lastP.x - 120, y: lastP.y }
      pts.push({ x: Math.round(lastP.x + (lastP.x - prev.x) * 0.6 || 80), y: Math.round(lastP.y + (lastP.y - prev.y) * 0.6), in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })
      render(); changed(true)
    }

    // ---------------------------------------------------------------- 5. 基础属性
    function buildBase() {
      const c = cfg(), out = [fs('最小速度', 'speedMin', 0, 1000, 1, ''), fs('最大速度', 'speedMax', 0, 1000, 1, ''), fs('最小寿命', 'lifetimeMin', 0.1, 10, 0.1, 's'), fs('最大寿命', 'lifetimeMax', 0.1, 10, 0.1, 's')]
      out.push(toggle('重力 (Gravity)', !!c.gravityEnabled, (on) => update({ gravityEnabled: on }), [fs('重力 X', 'gravityX', -2000, 2000, 1, ''), fs('重力 Y', 'gravityY', -2000, 2000, 1, '')]))
      out.push(toggle('放射角度 (Emission)', !!c.emissionAngleEnabled, (on) => update({ emissionAngleEnabled: on }), [slider('放射角度', c.emissionAngleDeg || 0, 0, 360, 1, '°', (x) => { c.emissionAngleDeg = x; changed() }), slider('角度偏移', c.emissionOffsetDeg || 0, -180, 180, 1, '°', (x) => { c.emissionOffsetDeg = x; changed() })]))
      // 路径 (Path)
      const pathOn = !!c.pathEnabled, type = c.pathType || 'circle', custom = type === 'custom'
      const def2 = () => [{ x: -120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }, { x: 120, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }]
      const pathKids = []
      if (pathOn) {
        pathKids.push(select('模式', [['lock', '锁定粒子（环绕）'], ['emitter', '路径（拖尾）']], c.pathMode || 'lock', (v) => update({ pathMode: v })))
        pathKids.push(select('路径类型', [['circle', '圆'], ['ellipse', '椭圆'], ['custom', '自定义']], type, (v) => {
          if (v === 'circle') update({ pathType: v, pathRadiusX: c.pathRadiusX ?? 120, pathRadiusY: c.pathRadiusX ?? 120 })
          else if (v === 'ellipse') update({ pathType: v, pathRadiusX: c.pathRadiusX ?? 160, pathRadiusY: c.pathRadiusY ?? c.pathRadiusX ?? 120 })
          else { S.pathEdit = true; update({ pathType: v, pathClosed: true, pathPoints: def2(), pathSpeedPxPerSec: c.pathSpeedPxPerSec ?? 360, pathThickness: c.pathThickness ?? 0 }) }
        }))
        if (custom) {
          pathKids.push(toggle('闭环（关闭=来回走）', c.pathClosed !== false, (on) => update({ pathClosed: on }), [], 2))
          pathKids.push(fs('速度', 'pathSpeedPxPerSec', 0, 2000, 1, 'px/s', 360), fs('厚度', 'pathThickness', 0, 500, 1, 'px', 0))
          pathKids.push(toggle('随机起点', c.pathRandomStartAngle !== false, (on) => update({ pathRandomStartAngle: on }), [], 2))
          if (c.pathRandomStartAngle === false) pathKids.push(fs('起点', 'pathStartT', 0, 1, 0.001, '', 0))
          pathKids.push(help('路径编辑：在画布上拖黄色方块（路径点）；双击方块删点；「加点」在路径末尾添一个点。'), h('div', { class: 'pfx-row' }, h('button', { class: 'fxm-btn', type: 'button', style: 'flex:1', onclick: () => addPathPoint() }, '加点')))
          pathKids.push(buildContour())
        } else {
          if (type === 'circle') pathKids.push(slider('半径', c.pathRadiusX ?? 120, 0, 2000, 1, 'px', (x) => { c.pathRadiusX = x; c.pathRadiusY = x; changed() }))
          else pathKids.push(fs('半径 X', 'pathRadiusX', 0, 2000, 1, 'px', 160), fs('半径 Y', 'pathRadiusY', 0, 2000, 1, 'px', 120))
          pathKids.push(fs('厚度', 'pathThickness', 0, 500, 1, 'px', 0), fs('速度', 'pathSpeedDegPerSec', -720, 720, 1, '°/s', 180))
        }
        pathKids.push(toggle('反向', !!c.pathReverse, (on) => update({ pathReverse: on }), [], 2))
        if (!custom) {
          pathKids.push(toggle('随机起始角', c.pathRandomStartAngle !== false, (on) => update({ pathRandomStartAngle: on }), [], 2))
          if (c.pathRandomStartAngle === false) pathKids.push(fs('起始角', 'pathStartAngleDeg', -180, 180, 1, '°', 0))
        }
      }
      out.push(toggle('路径 (Path)', pathOn, (on) => {
        if (!on) { update({ pathEnabled: false }); return }
        if (type === 'custom') { S.pathEdit = true; update({ pathEnabled: true, pathClosed: true, pathPoints: def2() }); return }
        const off = Number(c.pathRadiusOffset) || 0
        if (Math.abs(off) > 1e-6) { const nx = (c.pathRadiusX ?? 120) + off; update({ pathEnabled: true, pathRadiusX: nx, pathRadiusY: (c.pathRadiusY ?? nx) + off, pathRadiusOffset: 0 }); return }
        update({ pathEnabled: true })
      }, pathKids))
      // 放射力 (Radial)
      const spiral = c.attractorMode === 'spiral', radKids = []
      if (c.attractorEnabled) {
        radKids.push(select('运行轨迹', [['linear', '直线'], ['spiral', '螺旋']], spiral ? 'spiral' : 'linear', (v) => {
          if (v === 'spiral') update({ attractorMode: 'spiral', ...(Math.abs(Number(c.attractorStrength) || 0) < 10 ? { attractorStrength: 1000 } : {}), ...(Math.abs(Number(c.swirlStrength) || 0) < 10 ? { swirlStrength: 500 } : {}) })
          else update({ attractorMode: 'linear' })
        }))
        radKids.push(slider(spiral && c.spiralInward ? '圈数强度' : '放射强度', c.attractorStrength || 0, -2000, 2000, 1, '', (x) => { c.attractorStrength = x; changed() }))
        radKids.push(slider('作用半径（0=全画布）', c.attractorRadius ?? 200, 0, 2000, 1, '', (x) => { c.attractorRadius = x; changed() }))
        if (spiral) {
          radKids.push(toggle('向内收缩（螺旋反向）', !!c.spiralInward, (on) => update(on ? { spiralInward: true, attractorStrength: 1000, swirlStrength: 2000, spiralStartRadius: 2000, spiralEndRadius: 0 } : { spiralInward: false, attractorStrength: 1000, swirlStrength: 500 }),
            [...((c.shape || {}).type === 'point' ? [slider('螺旋起始半径', c.spiralStartRadius ?? c.attractorRadius ?? 200, 0, 2000, 1, 'px', (x) => { c.spiralStartRadius = x; changed() })] : []),
              slider('螺旋结束半径', c.spiralEndRadius ?? 0, 0, 2000, 1, 'px', (x) => { c.spiralEndRadius = x; changed() })], 2))
          radKids.push(slider('螺旋强度(±)', c.swirlStrength || 0, -2000, 2000, 1, '', (x) => { c.swirlStrength = x; changed() }))
        }
      }
      out.push(toggle('放射力 (Radial)', !!c.attractorEnabled, (on) => {
        if (!on) { update({ attractorEnabled: false }); return }
        const p = { attractorEnabled: true }
        if (Math.abs(Number(c.attractorStrength) || 0) < 10) p.attractorStrength = spiral ? 1000 : 800
        if ((Number(c.attractorRadius) || 0) < 10) p.attractorRadius = 800
        if (spiral && Math.abs(Number(c.swirlStrength) || 0) < 10) p.swirlStrength = 500
        update(p)
      }, radKids))
      out.push(toggle('速度抑制 (Damping)', !!c.dampingEnabled, (on) => update({ dampingEnabled: on }), [slider('抑制比率', c.targetSpeedRatio || 0.5, 0, 1, 0.01, '', (x) => { c.targetSpeedRatio = x; changed() })]))
      // 移动噪声 (Noise)
      const sc = (c.noiseMode || 'random') === 's_curve', noiseKids = []
      if (c.noiseEnabled) {
        noiseKids.push(select('噪声模式', [['random', '随机扰动'], ['s_curve', 'S形路径']], sc ? 's_curve' : 'random', (v) => update({ noiseMode: v })))
        noiseKids.push(slider(sc ? '弯曲强度' : '噪声强度', c.noiseIntensity ?? 100, 0, 500, 1, '', (x) => { c.noiseIntensity = x; changed() }))
        if (sc) {
          noiseKids.push(select('强度模式', [['linear', '线性'], ['curve', '曲线']], c.sNoiseStrengthMode || 'linear', (v) => update(v === 'curve' ? { sNoiseStrengthMode: 'curve', sNoiseCurve: normCurve(c.sNoiseCurve || [{ t: 0, v: 1 }, { t: 1, v: 1 }]) } : { sNoiseStrengthMode: 'linear' })))
          if (c.sNoiseStrengthMode === 'curve') noiseKids.push(curveEditor('S形强度曲线', c.sNoiseCurve, (pts) => { c.sNoiseCurve = pts; changed() }, 'noise_scurve_strength'))
          noiseKids.push(slider('摆动次数（生命周期）', c.noiseFrequency ?? 0, 0, 10, 0.1, '', (x) => { c.noiseFrequency = x; changed() }), slider('运动距离', c.minTravelY ?? 0, 0, 2000, 1, 'px', (x) => { c.minTravelY = x; changed() }))
        } else noiseKids.push(slider('噪声频率', c.noiseFrequency ?? 0.5, 0.1, 5, 0.1, '', (x) => { c.noiseFrequency = x; changed() }))
      }
      out.push(toggle('移动噪声 (Noise)', !!c.noiseEnabled, (on) => update({ noiseEnabled: on }), noiseKids))
      return out
    }
    // PNG 轮廓 → 路径
    const contour = { file: null, alpha: 60, size: 360, smooth: 2, simplify: 1.8, busy: false, err: '', timer: 0 }
    function buildContour() {
      const run = async () => {
        if (!contour.file) return
        contour.busy = true; contour.err = ''
        try {
          const pts = await P.contourToNormalizedPoints(contour.file, { alphaThreshold: contour.alpha, smoothIterations: contour.smooth, simplifyEpsilon: contour.simplify, targetSize: contour.size })
          if (!pts || pts.length < 3) throw new Error('未识别到有效轮廓（可尝试降低阈值或提高目标尺寸）')
          const c = cfg()
          S.pathEdit = true
          update({ pathEnabled: true, pathMode: 'emitter', pathType: 'custom', pathClosed: true, pathRandomStartAngle: true, pathSpeedPxPerSec: Math.max(10, c.pathSpeedPxPerSec ?? 360), pathThickness: Math.max(0, c.pathThickness ?? 12), pathPoints: pts.map((p) => ({ x: p.x, y: p.y })) })
        } catch (e) { contour.err = String(e.message || e); render() } finally { contour.busy = false }
      }
      const later = () => { clearTimeout(contour.timer); contour.timer = setTimeout(run, 180) }
      const plain = (label, key, min, max, step, show) => slider(label, contour[key], min, max, step, '', (x) => { contour[key] = x; later() })
      const box = h('div', { style: 'border:1px solid #2A2A2A;border-radius:7px;padding:6px 8px;margin:6px 0' }, h('div', { style: 'color:#ddd;margin:2px 0 4px' }, 'PNG 轮廓 → 路径'),
        h('button', { class: 'fxm-btn', type: 'button', style: 'width:100%', onclick: async () => {
          const f = await new Promise((res) => { const i = h('input', { type: 'file', accept: 'image/png' }); i.onchange = () => res(i.files && i.files[0]); i.click() })
          if (!f) return
          if (!/png$/i.test(f.type) && !/\.png$/i.test(f.name)) { contour.err = '请上传 PNG（需要透明通道以识别轮廓）'; render(); return }
          contour.file = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
          render(); run()
        } }, contour.busy ? '处理中…' : '上传 PNG 并生成'),
        plain('Alpha 阈值', 'alpha', 1, 255, 1), plain('目标尺寸', 'size', 80, 1200, 1), plain('平滑', 'smooth', 0, 5, 1), plain('简化', 'simplify', 0, 8, 0.2),
        contour.file ? h('div', { class: 'pfx-row' }, h('img', { src: contour.file, style: 'width:48px;height:48px;object-fit:contain;background:#000;border-radius:4px' }), h('span', { class: 'pfx-help', style: 'margin:0' }, '已选择 PNG，调整参数将自动更新路径')) : null,
        contour.err ? h('div', { style: 'color:#fca5a5;font-size:11px;margin:4px 0' }, contour.err) : null)
      return box
    }

    // ---------------------------------------------------------------- 6. 缩放与旋转
    function buildScale() {
      const c = cfg(), out = [fs('粒子自旋速度', 'particleSpinDegPerSec', -720, 720, 1, '°/s')]
      out.push(seg([['0', '等比'], ['1', '分离XY']], c.sizeSeparate ? '1' : '0', (v) => {
        if (v === '1' && !c.sizeSeparate) update({ sizeSeparate: true, sizeStartX: c.sizeStart, sizeStartY: c.sizeStart, sizeEndX: c.sizeEnd, sizeEndY: c.sizeEnd })
        else if (v === '0' && c.sizeSeparate) update({ sizeSeparate: false, sizeStart: ((c.sizeStartX ?? c.sizeStart) + (c.sizeStartY ?? c.sizeStart)) / 2, sizeEnd: ((c.sizeEndX ?? c.sizeEnd) + (c.sizeEndY ?? c.sizeEnd)) / 2 })
      }))
      if (!c.sizeSeparate) out.push(fs('初始大小', 'sizeStart', 0, 500, 0.1, ''), fs('结束大小', 'sizeEnd', 0, 500, 0.1, ''))
      else out.push(slider('初始大小X', c.sizeStartX ?? c.sizeStart, 0, 500, 0.1, '', (x) => { c.sizeStartX = x; changed() }), slider('初始大小Y', c.sizeStartY ?? c.sizeStart, 0, 500, 0.1, '', (x) => { c.sizeStartY = x; changed() }),
        slider('结束大小X', c.sizeEndX ?? c.sizeEnd, 0, 500, 0.1, '', (x) => { c.sizeEndX = x; changed() }), slider('结束大小Y', c.sizeEndY ?? c.sizeEnd, 0, 500, 0.1, '', (x) => { c.sizeEndY = x; changed() }))
      out.push(seg([['0', '线性'], ['1', '曲线']], c.useSizeCurve ? '1' : '0', (v) => update({ useSizeCurve: v === '1' })))
      if (c.useSizeCurve) out.push(curveEditor('大小曲线', c.sizeCurve || [{ t: 0, v: 1 }, { t: 1, v: 1 }], (pts) => { c.sizeCurve = pts; changed() }, 'size_curve'))
      // 粒子页舞台底栏的「整体缩放」，这里没有底栏，放在这
      out.push(slider('整体缩放', c.systemScaleSeparate ? ((Number(c.systemScaleX) || 1) + (Number(c.systemScaleY) || 1)) / 2 : (c.systemScale ?? 1), 0.1, 3, 0.01, '', (x) => { c.systemScaleSeparate = false; c.systemScale = x; changed() }))
      return out
    }

    // ---------------------------------------------------------------- 7. 外观与资源
    const newSprite = (extra) => ({ weight: 1, mode: 'single', colorMode: 'fixed', colorStops: [{ t: 0, color: '#ffffff' }, { t: 1, color: '#ffffff' }], blendMode: 'normal', color: '#ffffff', ...extra })
    const randomLike = () => { const c = cfg(); return c.spritePlayback === 'random' || (c.spritePlayback === 'sequence' && !!c.spriteSequenceRandom) }
    const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
    const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    async function loadLibrary() {
      if (S.library) return S.library
      let data = null
      try { const api = userData(); if (api) { const r = await api.loadUserData('spriteLibrary'); if (r && r.ok !== false && Array.isArray(r.data)) data = r.data } } catch (_) { /* ignore */ }
      if (!data) { try { data = JSON.parse(localStorage.getItem('particle-editor-sprite-library-v1') || 'null') } catch (_) { data = null } }
      S.library = Array.isArray(data) ? data : []
      return S.library
    }
    async function saveLibrary() {
      S.library = S.library.slice(0, 200)
      try { const api = userData(); if (api && api.saveUserData) { await api.saveUserData({ key: 'spriteLibrary', data: S.library }); return } } catch (_) { /* ignore */ }
      try { localStorage.setItem('particle-editor-sprite-library-v1', JSON.stringify(S.library)) } catch (_) { /* full */ }
    }
    const hashOf = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i += Math.max(1, Math.floor(s.length / 4096))) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0 } return x.toString(36) }
    function addToLibrary(item) { const lib = S.library || []; S.library = [item, ...lib.filter((x) => x.id !== item.id)] }
    // 新贴图进系统（粒子页 nc / rc）：同图去重；序列且不随机 → 插在序列贴图后；随机 → 放最前；单张 → 只留它
    function placeSprites(add) {
      const c = cfg(), urls = new Set(add.map((s) => s.dataUrl))
      let rest = (c.sprites || []).filter((s) => !urls.has(s.dataUrl))
      if (c.spritePlayback === 'sequence' && !c.spriteSequenceRandom) { const k = firstSeqIndex(rest); if (k >= 0) { const seqS = rest[k]; rest = rest.filter((_, i) => i !== k); c.sprites = [seqS, ...add, ...rest]; return } }
      c.sprites = [...add, ...rest]
    }
    async function uploadSprites() {
      const files = await new Promise((res) => { const i = h('input', { type: 'file', accept: 'image/*', multiple: true }); i.onchange = () => res([...(i.files || [])]); i.click() })
      if (!files.length) return
      try {
        await loadLibrary()
        const add = []
        for (const f of files) {
          const dataUrl = await readFile(f), name = f.name.replace(/\.[^.]+$/, '')
          addToLibrary({ id: 'sp_' + hashOf(dataUrl), name, dataUrl, type: 'single' })
          add.push(newSprite({ id: Math.random().toString(36).slice(2, 11), name, dataUrl, path: 'particles/' }))
        }
        await saveLibrary()
        placeSprites(add); render(); changed(true)
      } catch (e) { setInfo('上传失败：' + e.message) }
    }
    async function uploadSequenceFolder() {
      const files = await new Promise((res) => { const i = h('input', { type: 'file', accept: 'image/*', multiple: true }); i.setAttribute('webkitdirectory', ''); i.setAttribute('directory', ''); i.onchange = () => res([...(i.files || [])]); i.click() })
      const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name)).sort((a, b) => natural(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name))
      if (!imgs.length) { if (files.length) setInfo('上传失败：未找到可用的序列帧图片'); return }
      const folder = ((imgs[0].webkitRelativePath || '').split('/')[0]) || 'sequence'
      const frames = []
      for (const f of imgs) frames.push({ name: f.name, dataUrl: await readFile(f) })
      await loadLibrary()
      addToLibrary({ id: 'seq_' + hashOf(frames.map((x) => x.dataUrl.length).join('|') + folder), name: folder, dataUrl: frames[0].dataUrl, type: 'sequence', frames })
      await saveLibrary()
      const c = cfg(), sp = newSprite({ id: `sequence_${folder}_${Date.now() % 100000}`, name: folder, dataUrl: frames[0].dataUrl, path: `sequence/${folder}/`, mode: 'sequence', frames })
      if (c.spriteSequenceRandom) update({ sprites: [sp, ...(c.sprites || []).filter((s) => s.mode === 'sequence')] })
      else update({ sprites: [sp], spriteSequenceRandom: false })
    }
    function addFromLibrary(item) {
      const c = cfg(), first = (c.sprites || [])[0], rl = randomLike()
      if (item.type === 'sequence' && Array.isArray(item.frames)) {
        const base = !rl && first ? { ...first } : newSprite({ id: 'user_' + Math.random().toString(36).slice(2, 9) })
        const it = { ...base, id: base.id || 'user_' + Math.random().toString(36).slice(2, 9), name: item.name, dataUrl: item.dataUrl, mode: 'sequence', frames: clone(item.frames), path: 'user/' }
        if (rl) update({ sprites: [it, ...(c.sprites || []).filter((s) => s.mode === 'sequence' && s.id !== it.id)], spritePlayback: 'sequence' })
        else update({ sprites: [it], spritePlayback: 'sequence', spriteSequenceRandom: false })
        return
      }
      let it
      if (c.spritePlayback !== 'random' && first) it = { ...first, name: item.name, dataUrl: item.dataUrl, mode: 'single', path: 'user/', frames: undefined }
      else it = newSprite({ id: 'user_' + Math.random().toString(36).slice(2, 9), name: item.name, dataUrl: item.dataUrl, path: 'user/', scale: 1, opacity: 1 })
      if (rl) { placeSprites([it]); render(); changed(true) }
      else if (c.spritePlayback === 'sequence') { placeSprites([it]); render(); changed(true) }
      else update({ sprites: [it], spritePlayback: 'single', spriteSequenceRandom: false })
    }
    function addBuiltin(key) {
      const c = cfg(), def = P.getBuiltinSprites().find((d) => d.key === key)
      if (!def) return
      const sprites = c.sprites || []
      const isKey = (s) => new RegExp(`^builtin_${key}_\\d+$`).test(String(s.id || ''))
      let n = 1
      while (sprites.some((s) => s.id === `builtin_${key}_${n}`)) n++
      const existing = sprites.find(isKey)
      const fresh = newSprite({ id: `builtin_${key}_${n}`, name: def.label, dataUrl: def.dataUrl, path: 'built-in/' })
      if (c.spritePlayback === 'sequence' && !c.spriteSequenceRandom) {
        const k = firstSeqIndex(sprites), seqS = k >= 0 ? sprites[k] : null
        const rest = sprites.filter((s) => s !== seqS && s !== existing)
        update({ sprites: seqS ? [seqS, existing || fresh, ...rest] : [existing || fresh, ...rest] })
      } else if (randomLike()) update({ sprites: [existing || fresh, ...sprites.filter((s) => s !== existing)] })
      else {
        const first = sprites[0] || {}
        const it = { ...(existing || fresh), mode: 'single' }
        for (const k of ['weight', 'scale', 'scaleX', 'scaleY', 'scaleSeparate', 'opacity', 'colorStops', 'colorMode', 'blendMode', 'color']) if (first[k] !== undefined) it[k] = clone(first[k])
        if (it.colorMode === 'lifecycle') it.colorStops = P.normalizeColorStops(it.colorStops, it.color || '#ffffff')
        update({ sprites: [it, ...sprites.filter((s) => !String(s.id || '').startsWith('builtin_'))], spritePlayback: 'single', spriteSequenceRandom: false })
      }
    }
    function buildLook() {
      const c = cfg(), out = []
      // 透明度
      out.push(seg([['0', '线性'], ['1', '曲线']], c.useOpacityCurve ? '1' : '0', (v) => update({ useOpacityCurve: v === '1' })))
      if (!c.useOpacityCurve) out.push(fs('起始透明度', 'opacityStart', 0, 1, 0.01, ''), fs('结束透明度', 'opacityEnd', 0, 1, 0.01, ''))
      else out.push(curveEditor('透明度曲线', c.opacityCurve || [{ t: 0, v: 1 }, { t: 1, v: 0 }], (pts) => { c.opacityCurve = pts; changed() }, 'opacity_curve'))
      // 播放方式
      out.push(seg([['single', '单张'], ['random', '随机'], ['sequence', '序列']], c.spritePlayback || 'single', (v) => {
        if (v !== 'sequence') { update({ spritePlayback: v }); return }
        const sprites = [...(c.sprites || [])], k = firstSeqIndex(sprites)
        if (k > 0) sprites.unshift(sprites.splice(k, 1)[0])
        update({ spritePlayback: 'sequence', spriteSequenceLoop: true, spriteSequenceRandom: false, sprites })
      }))
      if (c.spritePlayback === 'sequence') {
        out.push(fs('序列帧率', 'spriteSequenceFps', 1, 60, 1, 'fps', 12))
        out.push(toggle('随机', !!c.spriteSequenceRandom, (on) => {
          if (on) { update({ spriteSequenceRandom: true }); return }
          const sprites = [...(c.sprites || [])], k = firstSeqIndex(sprites)
          if (k > 0) sprites.unshift(sprites.splice(k, 1)[0])
          update({ spriteSequenceRandom: false, sprites })
        }, []))
      }
      // 上传
      out.push(c.spritePlayback === 'sequence'
        ? h('div', { class: 'pfx-drop', onclick: () => uploadSequenceFolder() }, h('span', {}, '上传序列'), h('small', {}, '选文件夹（自动识别排序）'))
        : h('div', { class: 'pfx-drop', onclick: () => uploadSprites() }, h('span', {}, '上传素材'), h('small', {}, 'PNG/JPG/WEBP')))
      // 自定义贴图库
      const libBox = h('div', { class: 'pfx-tiles' })
      out.push(libBox)
      loadLibrary().then((lib) => {
        libBox.textContent = ''
        for (const item of lib) libBox.append(h('button', { class: 'pfx-tile', type: 'button', title: '点击添加到当前粒子', onclick: () => addFromLibrary(item) },
          h('img', { alt: '', src: item.dataUrl }), h('span', {}, item.name || ''),
          h('button', { class: 'del', type: 'button', title: '从自定义贴图库删除该贴图', onclick: (e) => { e.stopPropagation(); S.library = S.library.filter((x) => x !== item); saveLibrary(); render() } }, '×')))
        if (!lib.length) libBox.style.display = 'none'
      })
      // 内置贴图（羽化圆形不列）
      const ids = (c.sprites || []).map((s) => String(s.id || ''))
      out.push(h('span', { class: 'pfx-lbl' }, '内置贴图'))
      out.push(h('div', { class: 'pfx-tiles' }, P.builtinSpriteList().filter((d) => d.key !== 'feather_circle').map((d) => {
        const re = new RegExp(`^builtin_${d.key}_\\d+$`), on = randomLike() ? ids.some((x) => re.test(x)) : re.test(ids[0] || '')
        return h('button', { class: 'pfx-tile', type: 'button', 'data-on': on ? '1' : '0', title: d.label, onclick: () => addBuiltin(d.key) }, h('img', { alt: '', src: d.dataUrl }), h('span', {}, d.label))
      })))
      // 每张贴图一张卡片
      ;(c.sprites || []).forEach((sp, i) => out.push(spriteCard(sp, i)))
      return out
    }
    function spriteCard(sp, i) {
      const c = cfg(), n = (c.sprites || []).length, rl = randomLike()
      const move = (to) => { const arr = [...c.sprites]; arr.splice(to, 0, arr.splice(i, 1)[0]); update({ sprites: arr }) }
      const setSp = (patch, structural = true) => { Object.assign(sp, patch); if (structural) render(); changed(structural) }
      const thumb = h('img', { alt: '', src: sp.dataUrl || (sp.frames && sp.frames[0] && sp.frames[0].dataUrl) || '' })
      if (sp.mode === 'sequence' && Array.isArray(sp.frames) && sp.frames.length > 1) {
        let k = 0
        const t = setInterval(() => { if (!thumb.isConnected) { clearInterval(t); return } k = (k + 1) % sp.frames.length; thumb.src = sp.frames[k].dataUrl }, 1000 / Math.max(1, c.spriteSequenceFps || 12))
      }
      const bd = h('div', { class: 'pfx-card-bd' })
      if (sp.mode === 'sequence' && Array.isArray(sp.frames)) bd.append(h('div', { class: 'pfx-help', style: 'margin:0 0 4px' }, `序列帧：${sp.frames.length}`))
      bd.append(select('着色模式', [['fixed', '固定'], ['lifecycle', '生命周期']], sp.colorMode || 'fixed', (v) => {
        if (v === 'lifecycle') { const stops = P.normalizeColorStops(sp.colorStops, sp.color || '#ffffff'); setSp({ colorMode: 'lifecycle', colorStops: stops, color: stops[0].color }) }
        else setSp({ colorMode: 'fixed' })
      }))
      bd.append(select('混合', [['normal', '正常'], ['add', '相加'], ['screen', '滤色'], ['overlay', '叠加'], ['multiply', '相乘']], sp.blendMode || 'normal', (v) => setSp({ blendMode: v })))
      if ((sp.colorMode || 'fixed') === 'fixed') {
        const hex = h('input', { type: 'text', readOnly: true, value: sp.color || '#ffffff' })
        bd.append(h('span', { class: 'pfx-lbl' }, '着色'), h('div', { class: 'pfx-colour' }, h('input', { type: 'color', value: sp.color || '#ffffff', oninput: (e) => { hex.value = e.target.value; setSp({ color: e.target.value }, false) } }), hex))
      } else bd.append(gradientEditor(sp))
      if (rl) {
        bd.append(seg([['0', '等比'], ['1', '分离XY']], sp.scaleSeparate ? '1' : '0', (v) => {
          if (v === '1' && !sp.scaleSeparate) setSp({ scaleSeparate: true, scaleX: sp.scale ?? 1, scaleY: sp.scale ?? 1 })
          else if (v === '0' && sp.scaleSeparate) setSp({ scaleSeparate: false, scale: ((sp.scaleX ?? sp.scale ?? 1) + (sp.scaleY ?? sp.scale ?? 1)) / 2 })
        }))
        if (!sp.scaleSeparate) bd.append(slider('缩放', sp.scale ?? 1, 0.1, 4, 0.01, '', (x) => setSp({ scale: x }, false)))
        else bd.append(slider('缩放X', sp.scaleX ?? sp.scale ?? 1, 0.1, 4, 0.01, '', (x) => setSp({ scaleX: x }, false)), slider('缩放Y', sp.scaleY ?? sp.scale ?? 1, 0.1, 4, 0.01, '', (x) => setSp({ scaleY: x }, false)))
        bd.append(slider('透明度', sp.opacity ?? 1, 0, 1, 0.01, '', (x) => setSp({ opacity: x }, false)), slider('权重', sp.weight ?? 1, 0, 10, 0.1, '', (x) => setSp({ weight: x }, false)))
      }
      bd.append(h('button', { class: 'pfx-del', type: 'button', onclick: () => update({ sprites: c.sprites.filter((s) => s !== sp) }) }, '删除素材'))
      return h('div', { class: 'pfx-card', 'data-first': i === 0 ? '1' : '0' },
        h('div', { class: 'pfx-card-hd' }, thumb, h('span', { class: 'nm' }, sp.name || '贴图'),
          h('button', { class: 'pfx-ib', type: 'button', title: '上移', disabled: i === 0, onclick: () => move(i - 1) }, '▲'),
          h('button', { class: 'pfx-ib', type: 'button', title: '下移', disabled: i >= n - 1, onclick: () => move(i + 1) }, '▼')),
        bd)
    }
    // 生命周期着色：节点分布曲线（只看位置）+ 每个节点的颜色
    function gradientEditor(sp) {
      const box = h('div', {}, h('span', { class: 'pfx-lbl' }, '生命周期着色'))
      const stops = () => P.normalizeColorStops(sp.colorStops, sp.color || '#ffffff')
      const write = (next) => { const st = P.normalizeColorStops(next, sp.color || '#ffffff'); sp.colorStops = st; sp.color = st[0].color; changed() }
      const rows = h('div', {})
      const drawRows = () => {
        rows.textContent = ''
        const st = stops()
        st.forEach((s, i) => {
          const label = i === 0 ? '起始' : i === st.length - 1 ? '结束' : `节点 ${Math.round(s.t * 100)}%`
          const hex = h('input', { type: 'text', readOnly: true, value: s.color })
          rows.append(h('div', { class: 'pfx-colour' }, h('span', { style: 'width:62px;color:#aaa;font-size:11px' }, label),
            h('input', { type: 'color', value: s.color, oninput: (e) => { hex.value = e.target.value; write(stops().map((x) => (Math.abs(x.t - s.t) < 1e-6 ? { ...x, color: e.target.value } : x))) } }), hex,
            i > 0 && i < st.length - 1 ? h('button', { type: 'button', onclick: () => { write(stops().filter((x) => Math.abs(x.t - s.t) >= 1e-6)); ed.setPoints(stops().map((x) => ({ t: x.t, v: 0.5 }))); drawRows() } }, '删除') : null))
        })
      }
      const ed = curveEditor('节点分布曲线', stops().map((s) => ({ t: s.t, v: 0.5 })), (pts) => { write(P.mergeStopsWithCurve(stops(), pts, sp.color || '#ffffff')); drawRows() }, 'sprite_color_lifecycle_stops', '#9ca3af', {
        flat: true,
        getPresetValue: (pts) => ({ points: normCurve(pts), colorStops: stops() }),
        applyPresetValue: (v) => {
          if (v && v.colorStops) write(v.colorStops)
          else write(P.mergeStopsWithCurve(stops(), Array.isArray(v) ? v : v.points, sp.color || '#ffffff'))
          ed.setPoints(stops().map((x) => ({ t: x.t, v: 0.5 }))); drawRows()
        },
      })
      box.append(ed, rows, help('双击曲线区域添加节点，双击节点删除'))
      drawRows()
      return box
    }

    // ---------------------------------------------------------------- 骨骼动画这边的三块
    function buildPlay() {
      const st = settings()
      const num = (label, key, value, min, max, note) => h('div', { class: 'pfx-row' }, h('span', { style: 'width:44px;color:#b9bcbf' }, label),
        h('input', { class: 'pfx-sl-num', type: 'number', min, max, step: 1, value: Math.round(value), onchange: (e) => { const v = clamp(Math.round(Number(e.target.value) || min), min, max); e.target.value = v; setSettings({ [key]: v }); render() } }),
        h('span', { class: 'pfx-help', style: 'margin:0' }, note))
      return [num('起', 'start', st.start, 0, 18000, '帧开始写'), num('时长', 'duration', st.duration, 2, 18000, `帧，${(st.duration / (st.fps || 30)).toFixed(2)} 秒`),
        help('时长 = 写进动画的长度；开了「首尾循环」的系统按这个长度首尾相接。动画够长时粒子跟着时间轴播，动画比它短（比如空动画）时粒子自己循环播。')]
    }
    function buildWrite() {
      const st = settings()
      const num = (label, key, value, min, max, note) => h('div', { class: 'pfx-row' }, h('span', { style: 'width:44px;color:#b9bcbf' }, label),
        h('input', { class: 'pfx-sl-num', type: 'number', min, max, step: 1, value: Math.round(value), onchange: (e) => { const v = clamp(Math.round(Number(e.target.value) || min), min, max); e.target.value = v; setSettings({ [key]: v }); render() } }),
        h('span', { class: 'pfx-help', style: 'margin:0' }, note))
      return [h('span', { class: 'pfx-lbl' }, '插槽混合'), seg([['add', '相加'], ['normal', '正常'], ['screen', '滤色'], ['multiply', '相乘']], S.blend, (v) => { S.blend = v; render(); changed(true) }),
        num('帧数', 'frames', st.frames, 2, 240, '生成序列切多少张'), num('宽', 'width', st.width, 64, 4096, '切片宽'), num('高', 'height', st.height, 64, 4096, '切片高（画布上虚线框）')]
    }

    function render() {
      const top = body.scrollTop
      body.textContent = ''
      body.append(
        section('tpl', '模板管理', buildTemplateManager),
        section('systems', '粒子系统列表', buildSystems),
        section('emit', '发射模式', buildEmit),
        section('shape', '发射器形状', buildShape),
        section('base', '基础属性', buildBase),
        section('scale', '缩放与旋转', buildScale),
        section('look', '外观与资源', buildLook),
        section('play', '播放（写进动画的时间）', buildPlay),
        section('place', '位置', () => { const el = h('div', {}); if (options.place) options.place(el, api); return el }),
        section('write', '写入动画', buildWrite))
      infoEl = h('div', { class: 'pfx-info' }, infoText)
      body.append(infoEl)
      body.scrollTop = top
    }
    // 画布上拖发射点：只更新系统 X / Y 的数值框
    function rerenderLight() {
      for (const [f, v] of [['systemX', cfg().systemX], ['systemY', cfg().systemY]]) {
        const num = body.querySelector(`[data-field="${f}"]`)
        if (num) { num.value = String(Math.round(v || 0)); const range = num.closest('.pfx-sl').querySelector('input[type=range]'); range.value = v; range.style.setProperty('--pct', pct(v, -500, 500)) }
      }
    }

    async function run(kind) {
      if (S.busy) return
      S.busy = true
      try {
        const st = settings(), on = S.systems.filter((c) => c.enabled !== false)
        if (!on.length) throw new Error('没有启用的粒子系统')
        const info = { systems: clone(on), config: clone(cfg()), width: st.width, height: st.height, frames: st.frames, duration: Math.max(0.1, st.duration / (st.fps || 30)), blend: S.blend, template: S.tplName || cfg().systemName || 'particle', setInfo, busy }
        if (kind === 'sequence') await options.onGenerateSequence(info)
        else await options.onGenerateSpine(info)
      } catch (error) {
        busy(null); setInfo('生成失败：' + error.message); console.error(error)
      } finally { S.busy = false }
    }

    function close() {
      if (S.closed) return
      S.closed = true
      clearTimeout(changeTimer)
      const lib = document.querySelector('.pfx-lib'); if (lib) lib.remove()
      dock.remove()
      if (options.onClose) options.onClose({ systems: clone(S.systems), active: S.active, tplName: S.tplName, blend: S.blend, open: [...S.open], pathEdit: S.pathEdit })
    }

    const api = {
      close, state: S, element: dock, setInfo, busy, openLibrary,
      get systems() { return S.systems.filter((c) => c.enabled !== false) },
      get config() { return cfg() }, get blend() { return S.blend }, get pathEdit() { return S.pathEdit },
      rerender: () => render(), rerenderLight, changed: () => changed(true),
    }
    root.__NovaFlowParticleFxOpen = api
    render()
    // 第一次打开：用模板库的第一个模板（和粒子页一样）
    if (!last.systems) {
      P.loadTemplates().then((list) => {
        const t = list && list[0]
        if (!t || S.closed) return
        S.systems = P.systemsOf(t); S.active = 0; S.tplName = t.name || ''; S.blend = firstBlend()
        const c0 = S.systems[0]
        if (c0 && c0.loopAnimation && Number(c0.loopDurationSec) > 0) setSettings({ duration: Math.max(2, Math.round(Number(c0.loopDurationSec) * (settings().fps || 30))) })
        render(); changed(true)
      }).catch(() => {})
    }
    return api
  }

  root.NovaFlowParticleFxUI = { openDock }
})(typeof window !== 'undefined' ? window : globalThis)

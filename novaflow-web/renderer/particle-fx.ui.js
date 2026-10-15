// 骨骼动画「粒子特效」面板（2026-10-16 用户：粒子特效不必独立一页，它就是给 Spine 动画用的；面板最好像飘带那样，
// 粒子直接作用在画布里、底下是原有动画）。这里只管右侧停靠的参数面板；粒子画在骨骼动画舞台上由编辑器负责（跟着播放时间和骨骼走）。
// 粒子用粒子页同一个引擎和模板库（renderer/assets/particle-fx.js → NovaFlowParticleFx）；参数只留常用的（用户：不重要的可以精简掉），
// 模板里其余设置（噪声、阻尼、吸引、路径…）原样带着。
// NovaFlowParticleFxUI.openDock({ host, last, settings, setSettings, place, onChange, onGenerateSequence, onGenerateSpine, onClose })
;(function (root) {
  'use strict'
  const GREEN = '#1EA672'
  const PFX = () => root.NovaFlowParticleFx
  const STYLE_ID = 'pfx-dock-style'
  const STYLE = `
.pfx-dock{position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;background:#1F1F1F;color:#d6d6d6;font-size:12px;font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif}
.pfx-dock .pfx-hd{flex:none;height:46px;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;border-bottom:1px solid #2A2A2A}
.pfx-dock .pfx-title{font-size:13px;font-weight:600;color:#f0f0f0}
.pfx-dock .pfx-x{margin-left:auto;width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:rgba(238,244,252,.6);font-size:16px;line-height:24px;cursor:pointer;padding:0}
.pfx-dock .pfx-x:hover{background:#373737;color:#fff}
.pfx-dock .pfx-body{flex:1;min-height:0;overflow-y:auto;padding:4px 12px 12px}
.pfx-dock .pfx-ft{flex:none;display:flex;gap:8px;padding:10px 12px;border-top:1px solid #2A2A2A}
.pfx-dock .pfx-ft .fxm-btn{flex:1;height:30px}
.pfx-dock .fxm-row{grid-template-columns:56px minmax(0,1fr) 46px}
.pfx-dock .fxm-sec-title{font-size:12px}
.pfx-dock .pfx-info{font-size:11px;color:#7d8186;padding:6px 0 0;line-height:1.5}
.pfx-sprites{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin:2px 0 6px}
.pfx-sprite{height:30px;border:0;border-radius:6px;background:#2B2B2B;cursor:pointer;padding:3px;display:flex;align-items:center;justify-content:center}
.pfx-sprite:hover{background:#373737}
.pfx-sprite img{max-width:100%;max-height:100%;object-fit:contain}
.pfx-sprite[data-on="1"]{box-shadow:inset 0 0 0 1px ${GREEN};background:#26332D}
.pfx-sprite.pfx-up{font-size:16px;color:#9a9ea3}
.pfx-dock :focus,.pfx-dock :focus-visible{outline:none}
`
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : (Math.round(v * 100) / 100).toFixed(2))
  const pct = (v, d) => ((clamp(v, d.min, d.max) - d.min) / ((d.max - d.min) || 1)) * 100 + '%'
  function setFill(input, value) {
    if (input.style.getPropertyValue('--pct') !== value) input.style.setProperty('--pct', value)
    if (input.style.getPropertyValue('--nf-range-pct') !== value) input.style.setProperty('--nf-range-pct', value)
  }
  const spriteBlend = (cfg) => { const s = (cfg.sprites || [])[0]; const b = (s && s.blendMode) || cfg.blendMode || 'add'; return b === 'add' || b === 'lighter' ? 'add' : b === 'screen' ? 'screen' : 'normal' }

  function openDock(options = {}) {
    const P = PFX()
    if (!P) throw new Error('粒子核心没有加载（particle-fx.js）')
    if (root.NovaFlowFxMakerUI && root.NovaFlowFxMakerUI.ensureStyle) root.NovaFlowFxMakerUI.ensureStyle()
    if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = STYLE; document.head.appendChild(st) }
    const tpls = P.templates()
    const last = options.last || {}
    const tplOf = (id) => tpls.find((t) => t.id === id) || tpls[0]
    // 第一次打开用「火焰·喷射」（第一个「基础·点爆发」的粒子只有 1 像素，画布上几乎看不见）
    const firstTpl = tpls.find((t) => t.name === '火焰·喷射') || tpls[0]
    const S = { tplId: last.tplId && tpls.some((t) => t.id === last.tplId) ? last.tplId : firstTpl && firstTpl.id, cfg: null, loop: last.loop !== false, blend: 'add', closed: false, busy: false }
    S.cfg = last.cfg ? P.normalizeConfig(last.cfg) : clone(tplOf(S.tplId).config)
    S.blend = last.blend || spriteBlend(S.cfg)

    const dock = document.createElement('div')
    dock.className = 'pfx-dock'
    dock.setAttribute('data-novaflow-runtime-ignore', '1')
    dock.innerHTML = `<div class="pfx-hd"><span class="pfx-title">粒子特效</span><button class="pfx-x" type="button" data-act="close" title="关闭">×</button></div>
      <div class="pfx-body fxm-params" data-params></div>
      <div class="pfx-ft"><button class="fxm-btn" type="button" data-act="spine" title="每个粒子一个插槽打关键帧（和粒子页导出的 Spine 工程一样），直接并进当前工程">生成 Spine 动画</button><button class="fxm-btn fxm-primary" type="button" data-act="sequence" title="渲染成切片进图片文件夹，一个插槽逐帧换图写进动画">生成序列</button></div>`
    ;(options.host || document.body).appendChild(dock)
    const E = { params: dock.querySelector('[data-params]') }
    let infoEl = null
    const setInfo = (t) => { if (infoEl) infoEl.textContent = t }
    let busyEl = null
    function busy(text, frac) {
      if (text == null) { if (busyEl) busyEl.remove(); busyEl = null; return }
      if (!busyEl) { busyEl = document.createElement('div'); busyEl.className = 'fxm-busy'; busyEl.innerHTML = '<div><div data-bt></div><div class="fxm-bar"><i></i></div></div>'; dock.appendChild(busyEl) }
      busyEl.querySelector('[data-bt]').textContent = text
      busyEl.querySelector('.fxm-bar>i').style.width = Math.round(clamp(frac || 0, 0, 1) * 100) + '%'
    }
    const settings = () => (options.settings ? options.settings() : { frames: 24, duration: 60, fps: 30, start: 0, width: 512, height: 512 })
    const set = (patch) => { if (options.setSettings) options.setSettings(patch) }
    let changeTimer = 0
    const changed = (now) => { clearTimeout(changeTimer); if (now) { if (options.onChange) options.onChange(api) } else changeTimer = setTimeout(() => { if (options.onChange && !S.closed) options.onChange(api) }, 40) }

    // ---------------------------------------------------------------- 控件
    function slider(key, d, value, apply) {
      const v = value == null ? d.def : value
      return { html: `<div class="fxm-row" data-key="${key}"><label>${esc(d.label)}</label><input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" style="--pct:${pct(v, d)};--nf-range-pct:${pct(v, d)}"><span class="fxm-val">${esc(d.format ? d.format(v) : fmt(v, d.step))}</span></div>`,
        bind(host) {
          const row = host.querySelector(`[data-key="${key}"]`), input = row.querySelector('input'), val = row.querySelector('.fxm-val')
          input.oninput = () => { const x = Number(input.value); setFill(input, pct(x, d)); val.textContent = d.format ? d.format(x) : fmt(x, d.step); apply(x); changed() }
        } }
    }
    function seg(key, label, items, value, pick) {
      return { html: `<div class="fxm-line" data-seg="${key}"><label>${esc(label)}</label><div class="fxm-seg">` + items.map((it) => `<button class="fxm-btn" type="button" data-v="${esc(it.id)}" data-on="${it.id === value ? 1 : 0}">${esc(it.label)}</button>`).join('') + '</div></div>',
        bind(host) { host.querySelectorAll(`[data-seg="${key}"] [data-v]`).forEach((b) => { b.onclick = () => { pick(b.dataset.v); render(); changed(true) } }) } }
    }
    function num(key, label, value, min, max, apply, note) {
      return { html: `<div class="fxm-line" data-num="${key}"><label>${esc(label)}</label><div><input class="fxm-num" type="number" min="${min}" max="${max}" step="1" value="${Math.round(value)}">${note ? `<span class="fxm-note">${esc(note)}</span>` : ''}</div></div>`,
        bind(host) { const i = host.querySelector(`[data-num="${key}"] input`); i.onchange = () => { const v = clamp(Math.round(Number(i.value) || min), min, max); i.value = v; apply(v); render(); changed(true) } } }
    }
    const pair = (a, b) => ({ get: () => ((Number(S.cfg[a]) || 0) + (Number(S.cfg[b]) || 0)) / 2, set: (v) => { const lo = Number(S.cfg[a]) || 0, hi = Number(S.cfg[b]) || 0, m = (lo + hi) / 2; if (m <= 0) { S.cfg[a] = v * 0.8; S.cfg[b] = v * 1.2; return } const r = v / m; S.cfg[a] = Math.round(lo * r * 100) / 100; S.cfg[b] = Math.round(hi * r * 100) / 100 } })

    function render() {
      const c = S.cfg, sh = c.shape || (c.shape = { type: 'point', x: 0, y: 0 }), st = settings(), items = [], html = []
      const sec = (title, list) => { items.push(...list); html.push(`<div class="fxm-sec"><div class="fxm-sec-title">${esc(title)}</div>${list.map((x) => x.html).join('')}</div>`) }
      // 模板
      const mine = tpls.filter((t) => !t.builtin), builtin = tpls.filter((t) => t.builtin)
      const opts = (list) => list.map((t) => `<option value="${esc(t.id)}" ${t.id === S.tplId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')
      sec('模板', [{ html: `<div class="fxm-line"><label>模板</label><select class="fxm-select" data-tpl>${mine.length ? `<optgroup label="我的模板">${opts(mine)}</optgroup><optgroup label="内置模板">${opts(builtin)}</optgroup>` : opts(builtin)}</select></div>`,
        bind: (host) => { const s = host.querySelector('[data-tpl]'); s.onchange = () => pickTemplate(s.value) } }])
      sec('播放', [
        num('start', '起', st.start, 0, 18000, (v) => set({ start: v }), '帧开始'),
        num('duration', '时长', st.duration, 2, 18000, (v) => set({ duration: v }), `帧，${(st.duration / (st.fps || 30)).toFixed(1)} 秒`),
        seg('loop', '播放', [{ id: '1', label: '循环' }, { id: '0', label: '一次性' }], S.loop ? '1' : '0', (v) => { S.loop = v === '1' }),
      ])
      const burst = c.mode !== 'stream'
      sec('发射', [
        seg('mode', '模式', [{ id: 'burst', label: '爆发' }, { id: 'stream', label: '持续' }], burst ? 'burst' : 'stream', (v) => { c.mode = v }),
        burst ? slider('burstCount', { label: '数量', min: 1, max: 300, step: 1, def: 20 }, c.burstCount, (v) => { c.burstCount = v })
          : slider('rate', { label: '每秒', min: 1, max: 600, step: 1, def: 100 }, c.rate, (v) => { c.rate = v }),
        ...(burst && S.loop ? [slider('loopIntervalSec', { label: '间隔', min: 0.1, max: 5, step: 0.05, def: 1, format: (v) => v.toFixed(2) + ' 秒' }, c.loopIntervalSec, (v) => { c.loopIntervalSec = v })] : []),
      ])
      const shapeItems = [seg('shape', '形状', [{ id: 'point', label: '点' }, { id: 'circle', label: '圆' }, { id: 'rect', label: '矩形' }, { id: 'cone', label: '锥体' }], ['point', 'circle', 'rect', 'cone'].includes(sh.type) ? sh.type : '', (v) => { c.shape = { ...sh, type: v } })]
      if (sh.type === 'circle') shapeItems.push(slider('outerRadius', { label: '半径', min: 0, max: 600, step: 1, def: 60 }, sh.outerRadius ?? 60, (v) => { sh.outerRadius = v; if ((sh.innerRadius || 0) > v) sh.innerRadius = v }))
      if (sh.type === 'rect') {
        shapeItems.push(slider('width', { label: '宽', min: 0, max: 1200, step: 1, def: 200 }, sh.width ?? 200, (v) => { sh.width = v }))
        shapeItems.push(slider('height', { label: '高', min: 0, max: 1200, step: 1, def: 200 }, sh.height ?? 200, (v) => { sh.height = v }))
      }
      if (sh.type === 'cone') {
        shapeItems.push(slider('coneAngleDeg', { label: '锥角', min: 0, max: 180, step: 1, def: 30, format: (v) => Math.round(v) + '°' }, sh.coneAngleDeg ?? 30, (v) => { sh.coneAngleDeg = v }))
        shapeItems.push(slider('coneRadius', { label: '口径', min: 0, max: 400, step: 1, def: 10 }, sh.coneRadius ?? 10, (v) => { sh.coneRadius = v }))
      }
      sec('形状', shapeItems)
      const sp = pair('speedMin', 'speedMax'), life = pair('lifetimeMin', 'lifetimeMax')
      sec('运动', [
        slider('rot', { label: '方向', min: -180, max: 180, step: 1, def: 0, format: (v) => Math.round(v) + '°' }, c.systemRotationDeg || 0, (v) => { c.systemRotationDeg = v }),
        slider('spread', { label: '扩散', min: 0, max: 360, step: 1, def: 360, format: (v) => Math.round(v) + '°' }, c.emissionAngleEnabled ? (c.emissionAngleDeg ?? 360) : 360, (v) => { c.emissionAngleEnabled = v < 360; c.emissionAngleDeg = v }),
        slider('speed', { label: '速度', min: 0, max: 1200, step: 1, def: 200 }, sp.get(), sp.set),
        slider('life', { label: '寿命', min: 0.05, max: 6, step: 0.05, def: 1, format: (v) => v.toFixed(2) + ' 秒' }, life.get(), life.set),
        slider('gravity', { label: '重力', min: -1500, max: 1500, step: 10, def: 0 }, c.gravityEnabled ? (c.gravityY || 0) : 0, (v) => { c.gravityEnabled = Math.abs(v) > 0.5; c.gravityY = v }),
      ])
      const s0 = (c.sprites || [])[0], one = !!(s0 && s0.colorMode === 'fixed' && s0.color && s0.color.toLowerCase() !== '#ffffff')
      sec('外观', [
        { html: '<div class="fxm-line" style="align-items:start"><label style="padding-top:6px">贴图</label><div class="pfx-sprites" data-sprites></div></div>', bind: bindSprites },
        seg('colour', '颜色', [{ id: 'tpl', label: s0 && s0.colorMode === 'lifecycle' ? '渐变' : '原色' }, { id: 'one', label: '单色' }], one ? 'one' : 'tpl', (v) => {
          if (!s0) return
          if (v === 'one') { s0.colorMode = 'fixed'; if (!s0.color || s0.color.toLowerCase() === '#ffffff') s0.color = '#ffd173' }
          else { const orig = (tplOf(S.tplId).config.sprites || [])[0]; s0.colorMode = orig ? orig.colorMode : 'fixed'; s0.color = orig ? orig.color : '#ffffff'; s0.colorStops = orig ? clone(orig.colorStops || []) : s0.colorStops }
        }),
        ...(one ? [{ html: `<div class="fxm-line"><label></label><div><input class="fxm-colour" type="color" value="${esc(s0.color)}" data-color></div></div>`, bind: (host) => { const i = host.querySelector('[data-color]'); i.oninput = () => { s0.color = i.value; changed() } } }] : []),
        slider('sizeStart', { label: '开始大小', min: 0, max: 400, step: 1, def: 32 }, c.sizeStart || 0, (v) => { c.sizeStart = v }),
        slider('sizeEnd', { label: '结束大小', min: 0, max: 400, step: 1, def: 32 }, c.sizeEnd || 0, (v) => { c.sizeEnd = v }),
        slider('spin', { label: '自旋', min: -720, max: 720, step: 5, def: 0, format: (v) => Math.round(v) + '°' }, c.particleSpinDegPerSec || 0, (v) => { c.particleSpinDegPerSec = v }),
        slider('scale', { label: '整体缩放', min: 0.1, max: 4, step: 0.01, def: 1 }, c.systemScale ?? 1, (v) => { c.systemScale = v; c.systemScaleSeparate = false }),
      ])
      // 位置：编辑器给（骨骼 / 跟哪个图层 / 发射点）
      sec('位置', [{ html: '<div data-place></div>', bind: (host) => { if (options.place) options.place(host.querySelector('[data-place]'), api) } }])
      sec('写入动画', [
        seg('blend', '混合', [{ id: 'add', label: '相加' }, { id: 'normal', label: '正常' }, { id: 'screen', label: '滤色' }], S.blend, (v) => { S.blend = v }),
        num('frames', '帧数', st.frames, 2, 240, (v) => set({ frames: v }), '生成序列切多少张'),
        num('cw', '切片宽', st.width, 64, 4096, (v) => set({ width: v })),
        num('ch', '切片高', st.height, 64, 4096, (v) => set({ height: v }), '画布上虚线框'),
        { html: '<div class="pfx-info" data-info></div>' },
      ])
      E.params.innerHTML = html.join('')
      infoEl = E.params.querySelector('[data-info]')
      for (const x of items) if (x.bind) x.bind(E.params)
      setInfo('拖画布上的绿点移动发射位置；播放动画看粒子跟着动。模板里没列出的设置原样带着。')
    }
    function pickTemplate(id) {
      const keep = { x: S.cfg.systemX || 0, y: S.cfg.systemY || 0 }
      S.tplId = id
      S.cfg = clone(tplOf(id).config)
      S.cfg.systemX = keep.x; S.cfg.systemY = keep.y
      S.blend = spriteBlend(S.cfg)
      render(); changed(true)
    }
    function bindSprites(host) {
      const box = host.querySelector('[data-sprites]'), s0 = (S.cfg.sprites || [])[0]
      const own = (tplOf(S.tplId).config.sprites || [])[0]
      const list = P.builtinSpriteList().map((d) => ({ id: 'b:' + d.key, label: d.label, dataUrl: d.dataUrl }))
      if (own && !String(own.id || '').startsWith('builtin_')) list.unshift({ id: 'own', label: own.name || '模板贴图', dataUrl: own.dataUrl })
      if (s0 && String(s0.id || '').startsWith('upload_')) list.unshift({ id: 'up', label: s0.name, dataUrl: s0.dataUrl })
      const cur = !s0 ? '' : String(s0.id || '').startsWith('upload_') ? 'up' : String(s0.id || '').startsWith('builtin_') ? 'b:' + String(s0.id).replace(/^builtin_/, '').replace(/_1$/, '') : 'own'
      box.innerHTML = list.map((x) => `<button class="pfx-sprite" type="button" data-sp="${esc(x.id)}" data-on="${x.id === cur ? 1 : 0}" title="${esc(x.label)}"><img alt="" src="${x.dataUrl}"></button>`).join('')
        + '<button class="pfx-sprite pfx-up" type="button" data-sp="upload" title="上传贴图（PNG / JPG / WEBP）">+</button>'
      box.querySelectorAll('[data-sp]').forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.sp
          const keep = s0 ? { colorMode: s0.colorMode, color: s0.color, colorStops: s0.colorStops, blendMode: s0.blendMode, scale: s0.scale, opacity: s0.opacity } : {}
          let next = null
          if (id === 'upload') {
            const f = await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp'; i.onchange = () => res(i.files && i.files[0]); i.click() })
            if (!f) return
            const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
            next = { id: 'upload_' + Date.now(), name: f.name.replace(/\.[^.]+$/, '').replace(/[^\w一-龥-]+/g, '_') || 'particle', dataUrl, path: '', weight: 1, mode: 'single' }
          } else if (id === 'own') next = clone(own)
          else if (id === 'up') return
          else next = P.builtinSprite(id.slice(2))
          if (!next) return
          S.cfg.sprites = [{ ...next, ...keep, colorMode: keep.colorMode || 'fixed', color: keep.color || '#ffffff', blendMode: keep.blendMode || next.blendMode || 'normal' }]
          S.cfg.spritePlayback = 'single'
          render(); changed(true)
        }
      })
    }

    async function run(kind) {
      if (S.busy) return
      S.busy = true
      try {
        const st = settings()
        const info = { config: clone(S.cfg), width: st.width, height: st.height, frames: st.frames, duration: Math.max(0.1, st.duration / (st.fps || 30)), loop: S.loop, blend: S.blend, template: tplOf(S.tplId).name, setInfo, busy }
        if (kind === 'sequence') await options.onGenerateSequence(info)
        else await options.onGenerateSpine(info)
      } catch (error) {
        busy(null); setInfo('生成失败：' + error.message); console.error(error)
      } finally { S.busy = false }
    }
    dock.querySelector('[data-act="sequence"]').onclick = () => run('sequence')
    dock.querySelector('[data-act="spine"]').onclick = () => run('spine')

    function close() {
      if (S.closed) return
      S.closed = true
      clearTimeout(changeTimer)
      dock.remove()
      if (options.onClose) options.onClose({ tplId: S.tplId, cfg: clone(S.cfg), loop: S.loop, blend: S.blend })
    }
    dock.querySelector('[data-act="close"]').onclick = close

    const api = { close, state: S, get config() { return S.cfg }, get loop() { return S.loop }, get blend() { return S.blend }, rerender: () => render(), changed: () => changed(true), setInfo, busy, element: dock }
    root.__NovaFlowParticleFxOpen = api
    render()
    return api
  }

  root.NovaFlowParticleFxUI = { openDock }
})(typeof window !== 'undefined' ? window : globalThis)

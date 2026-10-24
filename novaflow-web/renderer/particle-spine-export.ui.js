/*
 * 粒子特效 → 导出 → Spine: the same row 骨骼动画's export has (版本 / 格式 JSON·SKEL / 打包图集 / 打包设置…),
 * without 附件 / 文件夹 - a packed particle package takes the pictures its attachments use; with
 * 打包图集 off it is the skeleton plus an images folder, one PNG per picture
 * (user 2026-10-12: "要和动画版块一样", "粒子不需要文件夹和附件，默认附件", "只有勾选了才是打包").
 *
 * The row drives the dialog's own Spine 版本 select (kept, hidden) and publishes the format on
 * `window.__NovaFlowParticleSpineExport`, which assets/particle-spine-export.js reads when it packs
 * the package with the shared packer (spine-sequence-atlas.js) and writes .skel (spine-binary-write.js).
 * The saved 图集打包设置 are the ones every other export uses.
 */
(function () {
  'use strict'
  const KEY = 'nf-particle-spine-export'
  const ATLAS_KEY = 'novaflow.sequenceAtlas.settings.v1'
  const VERSIONS = ['3.8', '4.0', '4.1', '4.2']
  const pref = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} } }
  const save = (patch) => { try { localStorage.setItem(KEY, JSON.stringify({ ...pref(), ...patch })) } catch { /* storage blocked */ } }
  const skel = () => pref().skel === true
  const packed = () => pref().packed !== false
  const version = () => (VERSIONS.includes(pref().version) ? pref().version : '3.8')
  const publish = () => { window.__NovaFlowParticleSpineExport = Object.assign(window.__NovaFlowParticleSpineExport || {}, { skel: skel(), pack: packed() }) }
  publish()

  /** The export dialog when it is the particle one (never 骨骼动画's, AI 特效's or AI 序列's). */
  function particleScope() {
    const root = document.querySelector('[data-novaflow-export-modal-root="1"]')
    if (!root) return null
    const kind = root.getAttribute('data-novaflow-export-context-kind') || ''
    if (kind) return kind === 'particle' ? root : null
    const skeleton = window.NovaFlowSkeletonEditor
    return skeleton && typeof skeleton.active === 'function' && skeleton.active() ? null : root
  }
  // the Spine tab's own run button ("导出 SPINE 工程（JSON+ATLAS+PNG）", or as relabelled below) - never the
  // 序列帧 tab's "导出粒子序列 PNG + Spine 工程（选文件夹）", which has its own 打包图集 row
  const runButton = (scope) => Array.from(scope.querySelectorAll('button')).find((b) => /^(导出\s*(粒子特效\s*)?SPINE 工程|导出(?:粒子)?动画工程)/i.test((b.textContent || '').trim()))
  const versionSelect = (scope) => Array.from(scope.querySelectorAll('select')).find((x) => Array.from(x.options).some((o) => o.value === '3.8'))

  /** The dialog's React select takes the value through its own setter plus a change event. */
  function setSelect(select, value) {
    if (!select || select.value === value || !Array.from(select.options).some((o) => o.value === value)) return
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
    if (setter && setter.set) setter.set.call(select, value); else select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function packRow() {
    const scope = particleScope()
    if (!scope) return
    // only while the Spine tab is up: it alone has the plain "Spine 3.8" version picker
    const run = versionSelect(scope) ? runButton(scope) : null
    const old = scope.querySelector('[data-nf-particle-pack]')
    if (!run) { if (old) old.remove(); return }
    if (old && old.nextElementSibling === run) { sync(old, scope); return }
    if (old) old.remove()
    const row = document.createElement('div')
    row.setAttribute('data-nf-particle-pack', '1')
    row.className = 'nf-atlas-controls'
    row.style.cssText = 'margin:0 0 10px'
    const label = (t, extra) => `<span style="font-size:12px;color:rgba(255,255,255,.72);margin-right:2px${extra || ''}">${t}</span>`
    row.innerHTML = '<div class="nf-atlas-row" style="display:flex;align-items:center;justify-content:flex-start;gap:6px;flex-wrap:wrap;margin-bottom:8px">' + label('版本')
      + VERSIONS.map((v) => `<button type="button" class="nf-atlas-button" data-version="${v}">${v}</button>`).join('')
      + '</div><div class="nf-atlas-row" style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;margin-bottom:8px">' + label('格式') + '<button type="button" class="nf-atlas-button" data-format="json">JSON</button><button type="button" class="nf-atlas-button" data-format="skel">SKEL</button></div>'
      + '<div class="nf-atlas-row" style="display:flex;align-items:center;justify-content:flex-start;gap:6px;flex-wrap:wrap"><label class="nf-atlas-check" style="margin:0"><input type="checkbox" data-packed="1">打包图集</label>'
      + '<button type="button" class="nf-atlas-button" data-settings="1" style="margin-left:auto">打包设置…</button></div><p class="nf-atlas-hint" data-pack-hint style="margin:6px 0 0"></p>'
    row.querySelector('[data-packed]').addEventListener('change', (e) => { save({ packed: !!e.target.checked }); sync(row, scope) })
    row.querySelectorAll('[data-version]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); save({ version: b.getAttribute('data-version') }); sync(row, scope) }))
    row.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); save({ skel: b.getAttribute('data-format') === 'skel' }); sync(row, scope) }))
    row.querySelector('[data-settings]').addEventListener('click', (e) => { e.preventDefault(); openAtlasSettings() })
    // the dialog's own version picker stays the source of truth for the export; the row drives it
    const sel = versionSelect(scope)
    if (sel) {
      const prev = sel.previousElementSibling
      const hide = [sel, prev && /^(?:Spine\s*)?版本$|^工程版本$/.test((prev.textContent || '').trim()) ? prev : null, ...Array.from(sel.parentElement ? sel.parentElement.querySelectorAll('p') : []).filter((p) => /小版本号/.test(p.textContent || ''))]
      for (const el of hide) if (el && !el.hasAttribute('data-nf-particle-hidden')) { el.setAttribute('data-nf-particle-hidden', '1'); el.style.setProperty('display', 'none', 'important') }
    }
    run.parentNode.insertBefore(row, run)
    sync(row, scope)
  }

  function sync(row, scope) {
    const ver = version(), fmt = skel() ? 'SKEL' : 'JSON', pack = packed()
    publish()
    setSelect(versionSelect(scope), ver)
    const box = row.querySelector('[data-packed]')
    if (box.checked !== pack) box.checked = pack
    const settings = row.querySelector('[data-settings]')
    const show = pack ? '' : 'none'
    if (settings.style.display !== show) settings.style.display = show
    row.querySelectorAll('[data-version]').forEach((b) => b.classList.toggle('primary', b.getAttribute('data-version') === ver))
    row.querySelectorAll('[data-format]').forEach((b) => b.classList.toggle('primary', (b.getAttribute('data-format') === 'skel') === skel()))
    const run = runButton(scope)
    if (run) {
      const wanted = '导出动画工程'
      if (run.textContent !== wanted) run.textContent = wanted
    }
    const hint = row.querySelector('[data-pack-hint]')
    const t = pack ? `按 ${ver} 导出，${fmt}＋atlas＋图集 PNG，只打包粒子用到的图片。` : `按 ${ver} 导出，${fmt}＋images 文件夹（每张图一个 PNG）。`
    if (hint.textContent !== t) hint.textContent = t
  }

  /** 图集打包设置: the same fields and the same saved values as the other exports. */
  function openAtlasSettings() {
    const A = window.NovaFlowSequenceAtlas
    if (!A) return
    if (document.querySelector('.nf-atlas-overlay[data-nf-particle-settings]')) return
    let d
    try { d = A.normalizeSettings(JSON.parse(localStorage.getItem(ATLAS_KEY) || '{}')) } catch { d = { ...A.defaults } }
    const overlay = document.createElement('div')
    overlay.className = 'nf-atlas-overlay'
    overlay.setAttribute('data-novaflow-runtime-ignore', '1')
    overlay.setAttribute('data-nf-particle-settings', '1')
    // above the app's export dialog (its root sits at 2147483640)
    overlay.style.zIndex = '2147483646'
    const close = () => overlay.remove()
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
    const dialog = document.createElement('div')
    dialog.className = 'nf-atlas-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-label', '图集打包设置')
    const fill = () => {
      const size = (k, label) => `<label class="nf-atlas-field">${label}<select data-k="${k}">${[1024, 2048, 4096].map((v) => `<option value="${v}"${Number(d[k]) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`
      const num = (k, label, min, max) => `<label class="nf-atlas-field">${label}<input type="number" data-k="${k}" min="${min}" max="${max}" value="${d[k]}"></label>`
      const tog = (k, label) => `<label class="nf-atlas-check"><input type="checkbox" data-k="${k}"${d[k] ? ' checked' : ''}>${label}</label>`
      dialog.innerHTML = '<h3>图集打包设置</h3><div class="nf-atlas-grid">' + size('maxWidth', '最大宽度') + size('maxHeight', '最大高度')
        + num('paddingX', '横向间距（px）', 0, 32) + num('paddingY', '纵向间距（px）', 0, 32) + num('alphaThreshold', 'Alpha 阈值', 0, 254) + num('scale', '缩放（%）', 10, 100) + '</div>'
        + tog('trim', '去除透明空白') + tog('premultiplyAlpha', '预乘 Alpha（PMA）')
        + '<p class="nf-atlas-hint">缩放只缩小图集像素，骨架里的尺寸不变；超出容量自动分为多张图集。PMA 需与目标运行时的混合设置一致。</p>'
        + '<div class="nf-atlas-actions"><button type="button" class="nf-atlas-button" data-a="reset">恢复默认</button><button type="button" class="nf-atlas-button" data-a="cancel">取消</button><button type="button" class="nf-atlas-button primary" data-a="save">保存</button></div>'
      dialog.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
        const k = inp.getAttribute('data-k')
        d[k] = inp.type === 'checkbox' ? inp.checked : Number(inp.value)
      }))
      dialog.querySelector('[data-a="reset"]').onclick = () => { d = { ...A.defaults }; fill() }
      dialog.querySelector('[data-a="cancel"]').onclick = close
      dialog.querySelector('[data-a="save"]').onclick = () => {
        // 合并重复帧 belongs to the sequence exports and keeps whatever they saved
        try { localStorage.setItem(ATLAS_KEY, JSON.stringify(A.normalizeSettings(d))) } catch { window.alert('无法保存设置，请检查浏览器存储权限'); return }
        close()
      }
    }
    fill()
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)
  }

  // The row follows the dialog in the mutation's own microtask, before the page paints: on the
  // 150 ms timer alone the dialog's plain Spine layout showed first and the row lingered over the
  // 序列帧 / 视频 tabs for a frame, the dialog jumping in height each time (user 2026-10-12:
  // 视频和 Spine 切换弹框会各种跳闪). The timer stays as a fallback.
  let syncing = false
  const onMutations = () => {
    if (syncing || !document.body || !document.body.classList.contains('novaflow-export-modal-open')) return
    syncing = true
    try { packRow() } catch { /* the dialog is changing */ }
    syncing = false
  }
  const start = () => { if (document.body) new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }) }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start)
  setInterval(() => { try { packRow() } catch { /* the dialog is changing */ } }, 150)
  window.NovaFlowParticleSpineExportUI = Object.freeze({ version, skel, packed, openAtlasSettings })
})()

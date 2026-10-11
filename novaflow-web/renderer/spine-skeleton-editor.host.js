/*
 * 骨骼动画: the Spine-style editor (spine-skeleton-editor.html) in place of the section's own
 * stage, right column and playbar. The left column stays the app's: 导入工程 feeds the editor,
 * 骨骼架设 / 蒙皮 / 权重 drive it (spine-auto-mesh.panel.js asks `enabled()` and routes its
 * buttons here), 动画工具 keeps working on the app's own project, which this file keeps in step
 * with the editor while that panel is open: the editor's project goes into the app before the
 * tools read it, and what the tools write (their previews, 保存动画, 飘带) comes back as an edit.
 *
 * The editor runs in a same-origin iframe: its styles and DOM stay out of the app's layout
 * passes, and the app's never reach into it.
 */
(() => {
  'use strict'

  const FRAME_ID = 'novaflow-skeleton-editor-frame'
  const WORKSPACE = '[data-novaflow-skeleton-workspace]'
  const MOTION_PANEL = '[data-panel-id="bone-motion"]'
  const TIMELINE_ANCHOR = 'data-novaflow-skeleton-editor-timeline'

  let frame = null
  let api = null
  const waiting = []
  let workspace = null
  let lastSource = null
  let anchor = null
  // 动画工具 sync
  let motionOpen = false
  let lastReact = null
  let pushedAnimations = null
  const pushedSig = {}
  const durations = new Map()

  // the section's editor, always (there is no way back to the old stage)
  const enabled = () => true
  const ready = () => (api ? Promise.resolve(api) : new Promise((resolve) => waiting.push(resolve)))

  // ---------------------------------------------------------------- the frame over the workspace

  function pageUrl() {
    // index.html carries the page as a text/plain tag only so the build stamps its ?v= hash
    const tag = document.querySelector('script[data-nf-skeleton-editor-page]')
    return (tag && tag.getAttribute('src')) || './spine-skeleton-editor.html'
  }

  function ensureFrame() {
    if (frame && frame.isConnected) return frame
    frame = document.createElement('iframe')
    frame.id = FRAME_ID
    frame.title = '骨骼动画编辑'
    frame.setAttribute('data-novaflow-runtime-ignore', '1')
    frame.setAttribute('allow', 'clipboard-read; clipboard-write')
    // above the section's own floats (the zoom bar sits at 46), under the 动画工具 editor (60) and dialogs
    frame.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;border:0;margin:0;padding:0;background:transparent;z-index:15;display:none;color-scheme:dark'
    // the page goes in as srcdoc: a server that answers every file with X-Frame-Options (the
    // 启动助手's local server, some hosts) would refuse to frame it by URL; a srcdoc document is
    // ours, same origin, relative URLs resolve against this page (the scripts sit beside it)
    fetch(pageUrl(), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then((html) => {
      if (frame.isConnected) frame.srcdoc = html
    }).catch((error) => { console.warn('[skeleton editor] page', error); if (frame.isConnected) frame.src = pageUrl() })
    document.body.appendChild(frame)
    return frame
  }

  /** The editor page calls this once it is up. */
  function attach(win, editorApi) {
    api = editorApi
    api.on(onEditorEvent)
    waiting.splice(0).forEach((resolve) => resolve(api))
    lastSource = null
    tick()
  }

  function visible(el) {
    if (!el || !el.isConnected) return false
    const r = el.getBoundingClientRect()
    return r.width > 300 && r.height > 200
  }

  function place(r) {
    const s = frame.style
    const px = (v) => `${Math.round(v)}px`
    if (s.left !== px(r.left)) s.left = px(r.left)
    if (s.top !== px(r.top)) s.top = px(r.top)
    if (s.width !== px(r.width)) s.width = px(r.width)
    if (s.height !== px(r.height)) s.height = px(r.height)
  }

  function releaseWorkspace() {
    if (workspace) { workspace.style.removeProperty('opacity'); workspace.style.removeProperty('pointer-events') }
    workspace = null
    if (document.body.hasAttribute('data-novaflow-skeleton-editor')) document.body.removeAttribute('data-novaflow-skeleton-editor')
  }

  // the section's own zoom bar floats outside the workspace: it goes too while the editor shows
  function installStyle() {
    if (document.getElementById('nf-skeleton-editor-style')) return
    const style = document.createElement('style')
    style.id = 'nf-skeleton-editor-style'
    style.textContent = 'body[data-novaflow-skeleton-editor="1"] [data-novaflow-zoom-controls="1"]{opacity:0!important;pointer-events:none!important}'
      // the 飘带 panel docked into 动画工具's box lives in the left column's stacking context
      // (z 20), so this frame stays below that (z 15) and the box (z 60, pointer-events none in
      // ribbon mode) above both; with no z-index the panel was under the frame
      + 'body[data-novaflow-skeleton-editor="1"] [data-novaflow-ribbon-panel="1"][data-novaflow-ribbon-docked="1"]{z-index:55!important}'
    document.head.appendChild(style)
  }

  /**
   * The section's workspace: the element the brand runtime marks, or, before its pass runs,
   * the parent of the section's own right column (the bundle renders it with data-preview-ui).
   */
  function findWorkspace() {
    const marked = document.querySelector(WORKSPACE)
    if (marked) return marked
    for (const side of document.querySelectorAll('[data-preview-ui="1"]')) {
      const text = side.textContent || ''
      if (text.includes('骨骼') && text.includes('动画') && side.parentElement && side.parentElement.querySelector('canvas')) return side.parentElement
    }
    return null
  }

  function tick() {
    const ws = enabled() ? findWorkspace() : null
    if (!ws || !visible(ws)) {
      if (frame) frame.style.display = 'none'
      releaseWorkspace()
      setMotionOpen(false)
      return
    }
    ensureFrame()
    installStyle()
    if (workspace !== ws) { releaseWorkspace(); workspace = ws }
    if (document.body.getAttribute('data-novaflow-skeleton-editor') !== '1') document.body.setAttribute('data-novaflow-skeleton-editor', '1')
    // the app's stage, right column and playbar stay mounted (the tools read them), unseen. Not
    // visibility:hidden: the app's layout pass reads its own sidebar's visibility and would drop
    // the section's layout (and with it this workspace) on every pass
    if (ws.style.getPropertyValue('opacity') !== '0') { ws.style.setProperty('opacity', '0', 'important'); ws.style.setProperty('pointer-events', 'none', 'important') }
    place(ws.getBoundingClientRect())
    if (frame.style.display !== 'block') frame.style.display = 'block'
    syncSource()
    motionTick()
    placeAnchor()
  }

  // ---------------------------------------------------------------- the imported project

  /** What makes two imports the same project (the app copies its source object around). */
  const sourceKey = (src) => {
    const imgs = Array.isArray(src.images) ? src.images.map((i) => (i && (i.fileName || i.name)) || '').join('|') : Object.keys(src.images || {}).join('|')
    return [src.skeleton && src.skeleton.text, src.atlas && src.atlas.text, imgs].join('\u0000')
  }
  let lastKey = null

  function syncSource() {
    const src = window.__NOVA_SPINE_LAST_SOURCE
    if (!api || !src || src === lastSource) return
    lastSource = src
    // the project the editor itself handed the app for 导出: nothing new to load
    if (ownText && src.skeleton && src.skeleton.text === ownText) { forgetReact(); return }
    // the same import in a new object (the app's 保存动画 and write-backs do that): keep the editor's work
    const key = sourceKey(src)
    if (key === lastKey) { forgetReact(); return }
    lastKey = key
    forgetReact()
    durations.clear()
    appJson = null
    chosenVersion = null
    api.loadSource(src).catch((error) => console.warn('[skeleton editor] load', error))
  }

  /** The app's project was rebuilt: nothing in it is ours any more. */
  function forgetReact() {
    lastReact = null
    pushedAnimations = null
    for (const k of Object.keys(pushedSig)) delete pushedSig[k]
  }

  // ---------------------------------------------------------------- the app's React state

  /** The bone editor's props (project, setProject, the selection) — the 动画工具 read the same. */
  function reactProps(test) {
    const root = document.getElementById('root')
    const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer$'))
    const current = key && root[key] && root[key].stateNode && root[key].stateNode.current
    if (!current) return null
    const todo = [current]
    let count = 0
    while (todo.length && count++ < 20000) {
      const fiber = todo.pop()
      const p = fiber.memoizedProps
      if (p && test(p)) return p
      if (fiber.sibling) todo.push(fiber.sibling)
      if (fiber.child) todo.push(fiber.child)
    }
    return null
  }
  const projectProps = () => reactProps((p) => p.spineSubEditor === 'bone' && p.project && p.project.animations && typeof p.setProject === 'function' && 'activeAnimationName' in p && 'selectedBoneName' in p)
  const workspaceProps = () => reactProps((p) => typeof p.onSelectedBoneNameChange === 'function' && typeof p.onActiveAnimationNameChange === 'function')

  const signature = (v) => { try { return JSON.stringify(v === undefined ? null : v) } catch { return '' } }

  /** 3.8 curves and colour keys, whatever the tools wrote (their own [c1, c2, c3, c4] form). */
  function normalizeAnimations(animations) {
    const out = {}
    const fixKeys = (list) => (Array.isArray(list) ? list.map((k) => {
      if (!k || typeof k !== 'object' || !Array.isArray(k.curve)) return k
      const [c1, c2, c3, c4] = k.curve
      const n = { ...k, curve: Number(c1) || 0, c2: Number(c2) || 0, c3: Number(c3) || 0, c4: c4 == null ? 1 : Number(c4) }
      return n
    }) : list)
    for (const [name, a] of Object.entries(animations || {})) {
      if (!a || typeof a !== 'object') continue
      const next = {}
      for (const [section, v] of Object.entries(a)) {
        if (section === 'duration') { durations.set(name, v); continue }
        if (section === 'bones' || section === 'slots') {
          const sec = {}
          for (const [item, tl] of Object.entries(v || {})) {
            const t = {}
            for (const [kind, list] of Object.entries(tl || {})) t[kind === 'rgba' && section === 'slots' && !tl.color ? 'color' : kind] = fixKeys(list)
            sec[item] = t
          }
          next[section] = sec
        } else next[section] = v
      }
      out[name] = next
    }
    return out
  }

  /** Durations the tools keep on their animations (a 3.8 file has none) go back with them. */
  function withDurations(animations) {
    if (!durations.size) return animations
    const out = {}
    for (const [name, a] of Object.entries(animations || {})) out[name] = durations.has(name) ? { ...a, duration: durations.get(name) } : a
    return out
  }

  /**
   * The editor's project into the app's. Unchanged parts keep their identity: the tools key
   * their sessions on `project.bones`, a new array would read as another project.
   */
  function pushToReact(json) {
    const ctx = projectProps()
    if (!ctx || !json) return false
    const patch = {}
    const empty = { ik: [], transform: [], path: [] }
    for (const key of ['skeleton', 'bones', 'slots', 'skins', 'ik', 'transform', 'path', 'events']) {
      const sig = signature(json[key] === undefined ? empty[key] : json[key])
      // first time round, against what the app has now: only real differences go in
      if (pushedSig[key] === undefined) pushedSig[key] = signature(ctx.project[key] === undefined ? empty[key] : ctx.project[key])
      if (pushedSig[key] !== sig) { patch[key] = json[key] === undefined ? empty[key] : json[key]; pushedSig[key] = sig }
    }
    const sig = signature(json.animations)
    if (pushedSig.animations === undefined) pushedSig.animations = signature(normalizeAnimations(ctx.project.animations))
    if (pushedSig.animations !== sig) {
      const anims = withDurations(json.animations || {})
      patch.animations = anims; pushedSig.animations = sig; pushedAnimations = anims
    }
    if (!Object.keys(patch).length) return false
    ctx.setProject((prev) => ({ ...prev, ...patch }))
    return true
  }

  /** The bone the tools work on: the picked bone, or the picked slot's bone (透明度计算). */
  const pickedBone = () => api.selectedBone() || ((api.selectedSlot && api.selectedSlot()) || {}).bone || null

  function pushSelection() {
    if (!api) return false
    const ws = workspaceProps()
    if (!ws) return false
    let changed = false
    const bone = pickedBone()
    const ctx = projectProps()
    if (ctx && ctx.selectedBoneName !== bone && bone) {
      changed = true
      try { ws.onSelectedBoneNameChange(bone) } catch { /* the app moved on */ }
      try { if (typeof ws.onSelectedBoneNamesChange === 'function') ws.onSelectedBoneNamesChange([bone]) } catch { /* optional */ }
    }
    const anim = api.anim()
    if (ctx && anim && ctx.activeAnimationName !== anim) { changed = true; try { ws.onActiveAnimationNameChange(anim) } catch { /* the app moved on */ } }
    if (typeof ws.onCurrentTimeSecChange === 'function') { try { ws.onCurrentTimeSecChange(api.time()) } catch { /* optional */ } }
    return changed
  }

  /** What the tools wrote into the app's project comes into the editor (one undo step a run). */
  function pullFromReact() {
    if (!api || !api.loaded()) return
    const ctx = projectProps()
    if (!ctx || ctx.project === lastReact) return
    lastReact = ctx.project
    const anims = ctx.project.animations
    if (!anims || anims === pushedAnimations) return
    const json = api.json()
    const next = normalizeAnimations(anims)
    if (signature(next) === signature(json.animations)) { pushedAnimations = anims; return }
    pushedAnimations = anims
    pushedSig.animations = signature(next)
    api.applyExternal({ ...json, animations: next }, '动画工具')
  }

  // ---------------------------------------------------------------- 动画工具

  function motionPanelOpen() {
    const panel = document.querySelector(MOTION_PANEL)
    return !!(panel && panel.getAttribute('data-open') === '1')
  }

  function setMotionOpen(open) {
    if (open === motionOpen) return
    motionOpen = open
    if (!api) return
    // the dopesheet folds to one row while the tools are open (their box takes the room)
    if (api.setTimelineCompact) api.setTimelineCompact(open)
    if (open) {
      api.setPanel('motion', true)
      pushToReact(api.json())
      pushSelection()
    } else {
      api.reserveBottom(0)
    }
  }

  function motionTick() {
    setMotionOpen(motionPanelOpen())
    if (!motionOpen) return
    pullFromReact()
    // the app sometimes puts its selection back (root) right after the open-time push: while
    // the tools are open the editor's picked bone / animation is the one they work on
    const ctx = api && api.loaded() ? projectProps() : null
    if (ctx && ((pickedBone() && ctx.selectedBoneName !== pickedBone()) || (api.anim() && ctx.activeAnimationName !== api.anim()))) pushSelection()
    syncRibbonChain()
  }

  /** 飘带计算 with 自动链条 on: the chain the runtime solves (its last pass's targets) shows as picked. */
  function syncRibbonChain() {
    if (!api || !api.loaded() || !api.selectChain) return
    const ribbonOn = document.querySelector('[data-panel-id="bone-motion"] [data-motion-mode="ribbon"][aria-pressed="true"]')
    const toggle = document.querySelector('[data-novaflow-ribbon-chain-toggle-card] input[type=checkbox]')
    const bone = api.selectedBone(), ctx = ribbonOn && toggle && toggle.checked && bone ? projectProps() : null
    let names = []
    try { if (ctx && typeof window.NovaFlowRibbonChain === 'function') names = window.NovaFlowRibbonChain(ctx.project, bone) } catch { /* the runtime moved on */ }
    api.selectChain(names)
  }

  /**
   * Called by motion-calculation.tool.js right before it opens. True when the app's state had to
   * change: React applies that a moment later, so the tool waits a frame before reading it.
   */
  function beforeMotion() {
    if (!api || !api.loaded()) return false
    api.setPanel('motion', true)
    const a = pushToReact(api.json())
    const b = pushSelection()
    return a || b
  }

  function onEditorEvent(type, data) {
    // 设置 has no animation to work on: the 动画工具 group folds when the editor goes there
    if (type === 'mode' && data.mode === 'setup' && motionPanelOpen()) {
      try { if (window.NovaFlowMotionEditing) window.NovaFlowMotionEditing.collapse() } catch { /* not loaded */ }
    }
    if (!motionOpen) {
      if (type === 'panel' && !data.panel) closeLeftPanels()
      return
    }
    if (type === 'change' && !data.external) pushToReact(data.json)
    if (type === 'select' || type === 'anim') pushSelection()
  }

  function closeLeftPanels() {
    // the editor's layer cards were closed (×): fold 蒙皮 / 权重 too
    try {
      const open = document.querySelector('[data-novaflow-auto-mesh-panel="1"][data-open="1"], [data-novaflow-auto-weights-panel="1"][data-open="1"]')
      if (open && window.NovaFlowAutoMeshPanel && window.NovaFlowAutoMeshPanel.closePanels) window.NovaFlowAutoMeshPanel.closePanels()
    } catch { /* the panels are not mounted */ }
  }

  /**
   * Where the floating 动画工具 editor docks: a fixed, invisible box over the editor's timeline
   * (motion-calculation.panel.js measures it instead of the app's hidden playbar).
   */
  function placeAnchor() {
    if (!api || !frame) return
    if (!anchor || !anchor.isConnected) {
      anchor = document.createElement('div')
      anchor.setAttribute(TIMELINE_ANCHOR, '1')
      anchor.setAttribute('data-novaflow-runtime-ignore', '1')
      anchor.style.cssText = 'position:fixed;pointer-events:none;visibility:hidden;z-index:-1'
      document.body.appendChild(anchor)
    }
    const f = frame.getBoundingClientRect()
    const r = api.timelineRect()
    const s = anchor.style
    s.left = Math.round(f.left + r.left) + 'px'
    s.top = Math.round(f.top + r.top) + 'px'
    s.width = Math.round(r.width) + 'px'
    s.height = Math.max(1, Math.round(r.height)) + 'px'
  }

  /** The editor's stage leaves this much room at its bottom for the floating editor. */
  function reserveForMotion(px) {
    if (api) api.reserveBottom(px)
  }

  // ---------------------------------------------------------------- the left panels' buttons

  async function call(name, ...args) {
    const a = await ready()
    if (!a.loaded()) throw new Error('先在「导入工程」里导入工程')
    return a[name](...args)
  }

  // ---------------------------------------------------------------- 导出
  //
  // The export dialog's 序列帧 / 视频 render with the app's own player and its Spine export writes
  // the app's source, so right before one of them runs the editor's project goes into the app
  // through the import bridge: packed (附件 = the pictures in use, 图片文件夹 = all of them) with
  // the shared 图集打包设置, the same package the editor would write itself.

  const PACK_KEY = 'nf-skel-export'
  const ATLAS_KEY = 'novaflow.sequenceAtlas.settings.v1'
  let ownText = null
  let appJson = null
  let appMode = null
  let syncing = false
  let syncPromise = null
  let bypass = false
  const packMode = () => { try { return JSON.parse(localStorage.getItem(PACK_KEY) || '{}').mode === 'folder' ? 'folder' : 'atts' } catch { return 'atts' } }
  // the Spine version to export as: the project's own until the user picks another (per project)
  let chosenVersion = null
  const exportVersion = () => (!api || !api.loaded() ? '3.8' : chosenVersion || api.ownVersion())
  const setExportVersion = (v) => { chosenVersion = v }
  // what the app renders with (序列帧 / 视频) is the exact 3.8 data; the Spine package goes out as chosen
  let wantVersion = '3.8'
  const setPackMode = (m) => { try { const o = JSON.parse(localStorage.getItem(PACK_KEY) || '{}'); o.mode = m; localStorage.setItem(PACK_KEY, JSON.stringify(o)) } catch { /* storage blocked */ } }

  let appVersion = null
  async function syncApp() {
    const a = await ready()
    if (!a.loaded()) throw new Error('先在「导入工程」里导入工程')
    const mode = packMode()
    const version = wantVersion === 'spine' ? exportVersion() : '3.8'
    if (appJson === a.json() && appMode === mode && appVersion === version) return
    const cache = window.__NovaFlowSpineImportInlineBridgeCache
    const bridge = window.__NovaFlowSpineImportInlineBridge
    if (!cache || !bridge || typeof bridge.start !== 'function') throw new Error('导入通道不可用')
    const json = a.json()
    const { source } = await a.packForApp({ mode, version })
    ownText = source.json.text
    // fill the bridge's own object field by field (the bundle holds on to that object)
    cache.json = source.json; cache.atlas = source.atlas; cache.images = source.images
    const ok = await bridge.start()
    if (ok === false) throw new Error('工程没能交给导出')
    appJson = json; appMode = mode; appVersion = version
  }

  const exportRoot = (el) => {
    const root = el && el.closest && el.closest('[data-novaflow-export-modal-root="1"]')
    if (!root) return null
    const kind = root.getAttribute('data-novaflow-export-context-kind')
    return !kind || kind === 'skeleton' ? root : null
  }
  /** The dialog's run buttons (导出…), not its tabs. */
  function isExportRun(b) {
    if (!(b instanceof HTMLButtonElement) || !exportRoot(b) || b.closest('[data-nf-skeleton-pack]')) return false
    return /^导出/.test((b.textContent || '').trim())
  }
  const inSync = () => !!(api && appJson === api.json() && appMode === packMode() && appVersion === (wantVersion === 'spine' ? exportVersion() : '3.8'))
  const exportName = (root) => { const i = root && root.querySelector('input[type=text], input:not([type])'); return i ? i.value : '' }
  const setExportName = (root, v) => {
    const i = root && root.querySelector('input[type=text], input:not([type])')
    if (!i || !v || i.value === v) return
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v)
    i.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function onExportClick(e) {
    if (bypass || !window.NovaFlowSkeletonEditor.active()) return
    const b = e.target instanceof Element ? e.target.closest('button') : null
    if (!b || !isExportRun(b)) return
    wantVersion = /Spine 工程/.test(b.textContent || '') ? 'spine' : '3.8'
    if (inSync() && !syncing) return
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
    // the app rebuilds its project (and with it this dialog): run the button that is there then
    const label = (b.textContent || '').trim()
    const name = exportName(exportRoot(b))
    b.textContent = '准备工程…'
    // a click while the dialog's own sync still runs waits for it instead of being lost
    const pending = syncing && syncPromise ? syncPromise.catch(() => {}) : Promise.resolve()
    syncing = true
    syncPromise = pending.then(() => syncApp())
    syncPromise.then(() => new Promise((r) => setTimeout(r, 120))).then(() => {
      const root = document.querySelector('[data-novaflow-export-modal-root="1"]')
      const again = root && Array.from(root.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === label || (x.textContent || '').trim() === '准备工程…')
      if (!again) return
      if (again.textContent.trim() !== label) again.textContent = label
      setExportName(root, name)
      bypass = true
      try { again.click() } finally { bypass = false }
    }).catch((error) => {
      b.textContent = label
      window.alert('导出前准备工程失败：' + (error && error.message ? error.message : String(error)))
    }).finally(() => { syncing = false })
  }

  /** The dialog opened: hand the editor's project over right away, while a name is typed. */
  function presync() {
    if (!window.NovaFlowSkeletonEditor.active() || !api || !api.loaded()) return
    const root = document.querySelector('[data-novaflow-export-modal-root="1"]')
    if (!root || !exportRoot(root)) return
    // on the Spine tab the package version is what counts, elsewhere the exact 3.8 data renders
    wantVersion = root.querySelector('[data-nf-skeleton-pack]') ? 'spine' : '3.8'
    // the dialog's run buttons wait until the app holds the project as it will go out
    const ready = inSync() && !syncing
    for (const b of root.querySelectorAll('button')) {
      if (!isExportRun(b)) continue
      if (ready) { if (b.hasAttribute('data-nf-skeleton-wait')) { b.removeAttribute('data-nf-skeleton-wait'); b.disabled = false; b.textContent = b.getAttribute('data-nf-skeleton-label') || b.textContent } }
      else if (!b.hasAttribute('data-nf-skeleton-wait')) { b.setAttribute('data-nf-skeleton-wait', '1'); b.setAttribute('data-nf-skeleton-label', b.textContent); b.disabled = true; b.textContent = '准备工程…' }
    }
    if (syncing || ready) return
    const name = exportName(root)
    syncing = true
    syncPromise = syncApp()
    syncPromise.then(() => setExportName(document.querySelector('[data-novaflow-export-modal-root="1"]'), name), () => {}).finally(() => { syncing = false })
  }

  /** The Spine tab gets the editor's 打包 choice and the shared 图集打包设置. */
  let packCounts = null
  function packRow() {
    const root = document.querySelector('[data-novaflow-export-modal-root="1"]')
    const scope = root ? exportRoot(root) : null
    if (!scope || !window.NovaFlowSkeletonEditor.active() || !api || !api.loaded()) return
    const run = Array.from(scope.querySelectorAll('button')).find((b) => /Spine 工程/.test(b.textContent || '') && /^导出/.test((b.textContent || '').trim()))
    const old = scope.querySelector('[data-nf-skeleton-pack]')
    if (!run) { if (old) old.remove(); return }
    if (old && old.nextElementSibling === run) { syncPackRow(old); return }
    if (old) old.remove()
    const row = document.createElement('div')
    row.setAttribute('data-nf-skeleton-pack', '1')
    row.className = 'nf-atlas-controls'
    row.style.cssText = 'margin:0 0 10px'
    row.innerHTML = '<div class="nf-atlas-row" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px"><span style="font-size:12px;color:rgba(255,255,255,.72);margin-right:4px">Spine 版本</span>'
      + api.versions().map((v) => `<button type="button" class="nf-atlas-button" data-version="${v}">Spine ${v}</button>`).join('') + '</div>'
      + '<p class="nf-atlas-hint" data-version-hint style="margin:0 0 10px"></p>'
      + '<div class="nf-atlas-row" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-size:12px;color:rgba(255,255,255,.72);margin-right:4px">打包图集</span>'
      + '<button type="button" class="nf-atlas-button" data-mode="atts"></button><button type="button" class="nf-atlas-button" data-mode="folder"></button>'
      + '<button type="button" class="nf-atlas-button" data-settings="1" style="margin-left:auto">打包设置…</button></div><p class="nf-atlas-hint" data-pack-hint style="margin:6px 0 0"></p>'
    row.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); setPackMode(b.getAttribute('data-mode')); syncPackRow(row) }))
    row.querySelectorAll('[data-version]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); setExportVersion(b.getAttribute('data-version')); syncPackRow(row) }))
    // the app's own version picker is pinned to the project's version (it never converted); ours does
    const sel = Array.from(scope.querySelectorAll('select')).find((x) => Array.from(x.options).some((o) => o.textContent === 'Spine 3.8'))
    if (sel) {
      // the select, its label right before it and the app's hint under it (the dialog's other rows stay)
      const hide = [sel, sel.previousElementSibling && sel.previousElementSibling.tagName === 'LABEL' ? sel.previousElementSibling : null, sel.parentElement && sel.parentElement.querySelector('p[data-novaflow-native-export-version]')]
      for (const el of hide) if (el && !el.hasAttribute('data-nf-skeleton-hidden')) { el.setAttribute('data-nf-skeleton-hidden', '1'); el.style.setProperty('display', 'none', 'important') }
    }
    row.querySelector('[data-settings]').addEventListener('click', (e) => { e.preventDefault(); openAtlasSettings() })
    run.parentNode.insertBefore(row, run)
    syncPackRow(row)
    api.packCounts().then((c) => { packCounts = c; syncPackRow(row) }, () => {})
  }
  function syncPackRow(row) {
    const mode = packMode()
    const own = api.ownVersion(), ver = exportVersion()
    row.querySelectorAll('[data-version]').forEach((b) => b.classList.toggle('primary', b.getAttribute('data-version') === ver))
    const vh = row.querySelector('[data-version-hint]')
    const vt = ver === own ? `工程原版本 Spine ${own}，按原版本导出，保留骨架和曲线格式。` : `工程原版本 Spine ${own}，导出时自动转成 Spine ${ver}（动画、曲线、约束一起转换）。`
    if (vh && vh.textContent !== vt) vh.textContent = vt
    row.querySelectorAll('[data-mode]').forEach((b) => {
      const m = b.getAttribute('data-mode')
      const n = packCounts ? packCounts[m] : null
      const text = (m === 'atts' ? '附件' : '图片文件夹') + (n == null ? '' : `（${n}）`)
      if (b.textContent !== text) b.textContent = text
      b.classList.toggle('primary', m === mode)
    })
    const hint = row.querySelector('[data-pack-hint]')
    const t = mode === 'atts' ? '只打包附件用到的图片：JSON＋atlas＋图集 PNG。' : '图片文件夹里的图片全部打包，没用到的也带上：JSON＋atlas＋图集 PNG。'
    if (hint.textContent !== t) hint.textContent = t
  }

  /** 图集打包设置: the same fields and the same saved values as the other exports. */
  function openAtlasSettings() {
    const A = window.NovaFlowSequenceAtlas
    if (!A) return
    let d
    try { d = A.normalizeSettings(JSON.parse(localStorage.getItem(ATLAS_KEY) || '{}')) } catch { d = { ...A.defaults } }
    const overlay = document.createElement('div')
    overlay.className = 'nf-atlas-overlay'
    overlay.setAttribute('data-novaflow-runtime-ignore', '1')
    overlay.style.zIndex = '2147483600'
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
        try { localStorage.setItem(ATLAS_KEY, JSON.stringify(A.normalizeSettings({ ...d, dedupe: true }))) } catch { window.alert('无法保存设置，请检查浏览器存储权限'); return }
        appJson = null
        close()
      }
    }
    fill()
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)
  }

  // ---------------------------------------------------------------- keyboard
  //
  // The editor's shortcuts (Space, A / D, the tools, Ctrl+Z…) work wherever the focus is: a key
  // pressed with the focus on the app's own panels is handed to the editor, unless something is
  // being typed into (a text box, a select, an editable).
  const TYPING = 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color]),textarea,select,[contenteditable=""],[contenteditable="true"]'
  function forwardKey(e) {
    if (!api || !window.NovaFlowSkeletonEditor.active()) return
    const t = e.composedPath()[0]
    if (t instanceof Element && t.closest(TYPING)) return
    if (t === frame) return
    const handled = api.key(e.type, { key: e.key, code: e.code, keyCode: e.keyCode, which: e.which, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat })
    if (handled) { e.preventDefault(); e.stopImmediatePropagation() }
  }

  // ---------------------------------------------------------------- lifecycle

  window.NovaFlowSkeletonEditor = {
    enabled,
    active: () => !!(frame && frame.style.display === 'block' && api),
    attach,
    ready,
    call,
    api: () => api,
    setPanel: (kind, open) => { ready().then((a) => a.setPanel(kind, open)) },
    beforeMotion,
    reserveForMotion,
    timeline: () => (anchor && anchor.isConnected ? anchor : null),
    time: () => (api ? api.time() : 0),
    seek: (sec) => { if (api) api.setTime(sec) },
    openExport: () => { if (api && api.loaded()) { api.openExport(); return true } return false },
    _debug: () => ({ syncing, appVersion, appMode, wantVersion, chosenVersion, inSync: inSync(), own: api && api.loaded() ? api.ownVersion() : null, motionOpen, bone: api && api.selectedBone(), ws: !!workspaceProps(), ctxBone: (projectProps() || {}).selectedBoneName }),
    _pushSelection: () => pushSelection(),
    /** A message in the editor's toast (the tools say what they wrote). */
    toast: (msg, kind) => { try { if (api && api.toast) api.toast(msg, kind) } catch { /* the editor is gone */ } },
  }

  // registered before the app's own export handlers (this file loads ahead of the brand runtime)
  window.addEventListener('click', onExportClick, true)
  window.addEventListener('keydown', forwardKey, true)
  window.addEventListener('keyup', forwardKey, true)
  window.addEventListener('resize', () => { if (frame && frame.style.display === 'block') tick() })
  setInterval(() => { tick(); try { packRow(); presync() } catch { /* the dialog is changing */ } }, 150)
  // the section mounting or leaving: cover / uncover in the same task, before the page paints
  const root = document.getElementById('root') || document.body
  new MutationObserver(() => { try { tick() } catch { /* mid-change */ } }).observe(root, { childList: true, subtree: true })
  tick()
})()

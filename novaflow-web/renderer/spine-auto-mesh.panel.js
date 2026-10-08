/*
 * NovaFlow — 自动蒙皮 panel for the 骨骼动画 section.
 *
 * The brand runtime only manipulates the skeleton panels at DOM level, so this
 * follows the same pattern instead of trying to add a React panel: it clones the
 * native `.nf-panel` shape and drives everything through the import bridge the
 * bundle already exposes.
 *
 * Reading the imported project needs no bundle patch —
 * `window.__NOVA_SPINE_LAST_SOURCE` holds the skeleton text plus the layer
 * images, and `window.__NovaFlowSpineImportInlineBridgeCache` is the same object
 * `start()` reads, so writing a rebuilt skeleton back is a cache write plus a
 * reload rather than a patched setter.
 *
 * Meshing is opt-in per layer: a 立绘 has a couple of dozen layers and not all of
 * them want a mesh, so the list is a checklist and only ticked layers are built,
 * written back and given a density. Every layer is always listed — the tick means
 * "editable", not "visible", and hiding rows would leave no way to reach a layer.
 *
 * It also imports a PhotoshopToSpine export directly. That export is a skeleton
 * JSON plus a folder of per-layer PNGs with no .atlas, which the normal 导入工程
 * will not take; rather than making the user round-trip through Spine just to get
 * an atlas, we synthesise one (each layer PNG is its own single-region page).
 *
 * Every apply rebuilds from the ORIGINAL skeleton text, never from the last
 * applied one: `applyMeshes` only converts `region` attachments, so re-applying
 * on top of a meshed skeleton would silently convert nothing.
 */
(function () {
  'use strict'

  const PANEL_ID = 'bone-auto-mesh'
  // The shipped bundle's panels carry no data-panel-id; the brand runtime tags
  // them instead, so anchor on those marks rather than on the src/ component.
  // The brand runtime keeps 导入工程 immediately before 飘带计算 and re-asserts it
  // a few times a second, so the only positions that do not start a tug-of-war
  // are first and last. We take last.
  const IMPORT_PANEL_SELECTOR = '[data-novaflow-spine-inline-import-panel="1"]'
  const RIBBON_PANEL_SELECTOR = '[data-novaflow-ribbon-panel="1"]'
  const MARK = 'data-novaflow-auto-mesh-panel'
  const TITLE = '自动蒙皮'
  const STORAGE_DENSITY = 'novaflow.autoMesh.density'
  // 自动权重 is a panel of its own (user decision 2026-09-21): meshing and binding
  // are different jobs with different things to restore
  const WEIGHTS_PANEL_ID = 'bone-auto-weights'
  const WMARK = 'data-novaflow-auto-weights-panel'
  const WTITLE = '自动权重'
  // 骨骼架设 is a panel of its own as well (user decision 2026-09-21): rigging comes
  // before meshing and binding, and its switch turns the preview into a bone editor
  const BONES_PANEL_ID = 'bone-rigging'
  const BMARK = 'data-novaflow-bones-panel'
  const BTITLE = '骨骼架设'

  const state = {
    density: 22,
    open: false,
    busy: false,
    /** attachment name -> {slot, hasImage, selected, imageData, mesh, density, edited} */
    layers: new Map(),
    baseSkeleton: null,
    atlasText: null,
    atlasRegions: new Map(),
    pages: new Map(),
    unpacking: false,
    unpackTried: null,
    /** the skeleton text we last handed the bridge, so our own reload is not mistaken for a new project */
    sentText: null,
    source: null,
    lastReport: null,
    /** skeleton text the list was built from, so we can notice a new import */
    listedFrom: null
  }

  const readStore = (key, fallback) => {
    try {
      const v = window.localStorage.getItem(key)
      return v === null ? fallback : v
    } catch { return fallback }
  }
  const writeStore = (key, value) => {
    try { window.localStorage.setItem(key, String(value)) } catch { /* private mode */ }
  }

  state.density = Math.max(8, Math.min(40, Number(readStore(STORAGE_DENSITY, 22)) || 22))
  // every panel is collapsed when the section is first entered (用户: 首次进入应该都是闭合状态);
  // a toggle is remembered for the session only, never across launches
  state.open = false
  state.openWeights = false
  state.openBones = false

  /** alpha at or below this is background, same floor the mesh builder uses */
  const ALPHA_FLOOR = 8
  const PREVIEW_CANVAS_MARK = 'data-novaflow-skeleton-preview-canvas'
  /** a layer already this densely packed is not worth re-encoding */
  const TRIM_FLOOR = 0.9

  let renderMeshList = () => {}
  let renderWeightList = () => {}
  const renderList = () => { renderMeshList(); renderWeightList() }
  /** every button and list of both panels, greyed together while something runs */
  const busyButtons = []
  const busyLists = []
  function setBusy(busy) {
    state.busy = busy
    for (const b of busyButtons) { b.disabled = busy; b.style.opacity = busy ? '0.6' : '1'; b.style.cursor = busy ? 'default' : 'pointer' }
    for (const l of busyLists) { l.style.pointerEvents = busy ? 'none' : 'auto'; l.style.opacity = busy ? '0.6' : '1' }
  }
  const guardWith = (setStatus, forRigging) => async (fn) => {
    if (state.busy) return
    // a rig with UNSAVED edits and a mesh being written would race for the same skeleton.
    // Having 骨骼架设 open is not itself a reason to refuse — the panel being open is what
    // turns editing on now, and meshing while nothing has been changed is harmless.
    const rigDirty = !!(bones.editing && bones.ctl && bones.ctl.getState().dirty)
    if (!forRigging && rigDirty) { setStatus('骨骼架设 里还有未保存的修改:先 应用到工程 或 放弃修改', 'error'); return }
    setBusy(true)
    try { await fn() } catch (err) {
      setStatus(String((err && err.message) || err || '操作失败'), 'error')
    } finally { setBusy(false) }
  }
  let setStatusFn = () => {}

  // ------------------------------------------------------- hover coupling ---
  // The list and the preview point at the same thing, so hovering either one
  // lights up both. The canvas side lives in the picker; this is the list side.

  /** attachment name -> its row element in the current list render */
  const rowEls = new Map()
  // the 自动权重 list is a second list of the same layers: hover and focus have to reach
  // both, or the weights panel just sits there while the preview points somewhere else
  const weightRowEls = new Map()
  let hoverName = null
  // the layer the tree / preview last pointed at: both lists scroll to it and keep it
  // outlined until something else is focused (hover is transient, this is not)
  let focusName = null

  // Hover is the outline only (user decision): a green fill on the card, for hover
  // or for the tick, was too loud next to the tick itself.
  function paintRow(name, on) {
    for (const map of [rowEls, weightRowEls]) {
      const row = map.get(name)
      if (row) row.style.borderColor = on ? 'rgba(34,201,138,0.65)' : 'rgba(255,255,255,0.08)'
    }
  }

  /** Called from the list rows. Mirrors onto the preview. */
  function hoverLayer(name, on) {
    const next = on ? name : (hoverName === name ? null : hoverName)
    if (next === hoverName) return
    if (hoverName) paintRow(hoverName, false)
    hoverName = next
    if (hoverName) paintRow(hoverName, true)
    const picker = window.NovaFlowAutoMeshPicker
    if (picker && typeof picker.highlight === 'function') picker.highlight(hoverName)
  }

  /**
   * Bring a list row into view WITHOUT touching any other scroll box: `scrollIntoView`
   * scrolls every scrollable ancestor, and in the left column that pushed the panel
   * headers above the top edge (the 导入工程 header could no longer be clicked shut).
   */
  function scrollRowIntoView(row) {
    const box = row && row.parentElement
    if (!box || !row.isConnected) return
    // measured, not offsetTop: offsetTop is relative to the nearest POSITIONED ancestor,
    // which is rarely the scrolling box, and the list then jumped to the wrong place
    const r = row.getBoundingClientRect(), b = box.getBoundingClientRect()
    if (r.top < b.top) box.scrollTop -= b.top - r.top
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
  }
  function focusPaint(name) {
    if (focusName && focusName !== name && focusName !== hoverName) paintRow(focusName, false)
    focusName = name || null
    if (focusName) paintRow(focusName, true)
  }
  /** Called from the picker when the pointer moves over the preview. */
  function hoverFromCanvas(name) {
    if (name === hoverName) return
    if (hoverName && hoverName !== focusName) paintRow(hoverName, false)
    hoverName = name || null
    if (hoverName) {
      paintRow(hoverName, true)
      scrollRowIntoView(rowEls.get(hoverName))
      scrollRowIntoView(weightRowEls.get(hoverName))
    } else if (focusName) paintRow(focusName, true)
    try { paintHierLayer(hoverName) } catch { /* the tree is not up yet */ }
  }

  // ------------------------------------------------------------- bridging ---

  function importedSource() {
    const src = window.__NOVA_SPINE_LAST_SOURCE
    if (!src || !src.skeleton || !src.skeleton.text) return null
    const images = Array.isArray(src.images) ? src.images : []
    if (!images.length) return null
    return src
  }

  function decodeImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(img, 0, 0)
          resolve(ctx.getImageData(0, 0, canvas.width, canvas.height))
        } catch (err) { reject(err) }
      }
      img.onerror = () => reject(new Error('图片解码失败'))
      img.src = dataUrl
    })
  }

  /**
   * Yield so the status line can paint. Races rAF against a timer on purpose:
   * a hidden or minimised window stops firing rAF entirely, and waiting on it
   * alone would stall a run that is already half way through.
   */
  function imageSize(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('图片读取失败'))
      img.src = dataUrl
    })
  }

  /**
   * PhotoshopToSpine can hand back a layer at full document size with the
   * artwork sitting in one corner -- hand_r in the test rig is 958x1350 for
   * 200x198 of drawing, 3% of its pixels. The preview keeps several full-size
   * canvas copies per attachment (region crop, padded mesh copy, texture copy,
   * and a premultiplied one of each when 预乘 is on), so that padding is paid
   * for many times over in memory and in every triangle it draws. Crop each
   * image to its own alpha bounds and move the attachment to match, which is
   * exactly what a trimmed export would have produced.
   */
  async function trimToArtwork(dataUrl, width, height) {
    const img = await decodeImage(dataUrl)
    const { data } = img
    let x0 = width, y0 = height, x1 = -1, y1 = -1
    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        if (data[(row + x) * 4 + 3] <= ALPHA_FLOOR) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (x1 < x0 || y1 < y0) return null                    // fully transparent
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    // Re-encoding costs a PNG round trip per layer, so only pay it where the
    // padding is actually worth removing. On the test rig this trims 9 of 26
    // layers and still lands at 33% of the pixels, versus 32% for trimming all.
    if ((w * h) / (width * height) > TRIM_FLOOR) return null
    const src = document.createElement('canvas')
    src.width = width
    src.height = height
    src.getContext('2d').putImageData(img, 0, 0)
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d').drawImage(src, x0, y0, w, h, 0, 0, w, h)
    return { dataUrl: out.toDataURL('image/png'), x0, y0, width: w, height: h, origW: width, origH: height }
  }

  const readFileAsText = (file) => file.text()
  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('读取失败'))
    r.onload = () => resolve(String(r.result || ''))
    r.readAsDataURL(file)
  })

  /**
   * Take a PhotoshopToSpine export folder (skeleton JSON + per-layer PNGs, no
   * atlas) and load it through the import bridge with a synthesised atlas.
   */
  async function importPhotoshopProject(files, setStatus) {
    const Attach = window.NovaFlowAutoMeshAttach
    const bridge = window.__NovaFlowSpineImportInlineBridge
    const cache = window.__NovaFlowSpineImportInlineBridgeCache
    if (!Attach || !bridge || !cache) throw new Error('导入桥接不可用')
    const list = Array.from(files || [])
    const jsonFiles = list.filter((f) => /\.json$/i.test(f.name))
    const imageFiles = list.filter((f) => /\.(png|jpe?g)$/i.test(f.name))
    if (!jsonFiles.length) throw new Error('这个文件夹里没有 JSON')
    if (!imageFiles.length) throw new Error('这个文件夹里没有 PNG/JPG 贴图')
    // the skeleton sits at the top of the export; prefer the shallowest json
    jsonFiles.sort((a, b) => (a.webkitRelativePath || a.name).split('/').length
                           - (b.webkitRelativePath || b.name).split('/').length)
    const jsonFile = jsonFiles[0]
    setStatus('读取骨架…')
    let text = await readFileAsText(jsonFile)
    let skeleton
    try { skeleton = JSON.parse(text) } catch { throw new Error('骨架 JSON 解析失败') }

    // only keep images an attachment actually refers to, so a stray template.png
    // does not become a page
    const wanted = new Set()
    const collect = (attachments) => {
      for (const slot of Object.keys(attachments || {})) {
        for (const att of Object.keys(attachments[slot] || {})) wanted.add(att.toLowerCase())
      }
    }
    if (Array.isArray(skeleton.skins)) for (const sk of skeleton.skins) collect(sk && sk.attachments)
    else if (skeleton.skins) for (const k of Object.keys(skeleton.skins)) collect(skeleton.skins[k])

    const images = []
    /** image stem -> crop, so the attachments can be moved to match */
    const trims = new Map()
    const total = imageFiles.filter((f) => {
      const stem = f.name.replace(/\.[^.]+$/, '')
      return !wanted.size || wanted.has(stem.toLowerCase())
    }).length
    let done = 0
    for (const f of imageFiles) {
      const stem = f.name.replace(/\.[^.]+$/, '')
      if (wanted.size && !wanted.has(stem.toLowerCase())) continue
      done++
      setStatus(`读取并裁切贴图 ${done}/${total}…`)
      await nextFrame()
      const dataUrl = await readFileAsDataUrl(f)
      const size = await imageSize(dataUrl)
      let trimmed = null
      try { trimmed = await trimToArtwork(dataUrl, size.width, size.height) } catch { trimmed = null }
      if (trimmed) {
        trims.set(stem.toLowerCase(), trimmed)
        images.push({ fileName: f.name, dataUrl: trimmed.dataUrl, width: trimmed.width, height: trimmed.height })
      } else {
        images.push({ fileName: f.name, dataUrl, width: size.width, height: size.height })
      }
    }
    const moved = trims.size ? Attach.retargetTrimmed(skeleton, trims) : 0
    const upgraded = Attach.normalizeToSpine38(skeleton)
    if (moved || upgraded) text = JSON.stringify(skeleton)
    if (!images.length) throw new Error('贴图名和附件名对不上')

    setStatus('合成图集…')
    await nextFrame()
    const atlasText = Attach.synthesizeAtlas(images)
    cache.json = { fileName: jsonFile.name, text }
    cache.atlas = { fileName: jsonFile.name.replace(/\.json$/i, '') + '.atlas', text: atlasText }
    cache.images = images.map((i) => ({ fileName: i.fileName, dataUrl: i.dataUrl }))
    const ok = await bridge.start()
    if (!ok) throw new Error('载入工程失败')
    // a fresh project invalidates anything we had meshed
    state.baseSkeleton = null
    state.source = null
    state.listedFrom = null
    state.layers.clear()
    state.lastReport = null
    syncLayersFromSource()
    return images.length
  }

  const nextFrame = () => new Promise((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    try { window.requestAnimationFrame(done) } catch { /* fall through to the timer */ }
    window.setTimeout(done, 32)
  })

  /**
   * Is the preview actually painting? Watch for real draws rather than sampling
   * pixels: an empty project is legitimately blank and would look the same.
   */
  async function previewIsDrawing(ms = 260) {
    const canvas = document.querySelector(`canvas[${PREVIEW_CANVAS_MARK}="1"]`)
    if (!canvas) return true                        // nothing to judge; leave it alone
    let ctx = null
    try { ctx = canvas.getContext('2d') } catch { return true }
    if (!ctx) return true
    const proto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype
    if (!proto) return true
    const original = proto.drawImage
    let drew = 0
    proto.drawImage = function () { if (this === ctx) drew++; return original.apply(this, arguments) }
    try {
      await new Promise((resolve) => window.setTimeout(resolve, ms))
    } finally {
      if (proto.drawImage !== original) proto.drawImage = original
    }
    return drew > 0
  }

  /**
   * The app's skeleton preview does not survive a second `bridge.start()`. The
   * canvas element stays put but nothing ever draws to it again -- measured in the
   * packaged app at 1534 draws/s before a reload and 0 after, with nothing logged.
   * Leaving the section and coming back re-mounts it, which is exactly what users
   * were doing by hand to get their preview back. Do it for them, and only when the
   * preview really is dead, so this costs nothing once the app itself is fixed.
   */
  async function remountSkeletonSection() {
    const norm = (t) => String(t || '').replace(/\s+/g, '')
    const entry = (label) => Array.from(document.querySelectorAll('button'))
      .find((b) => norm(b.textContent) === label) || null
    const back = entry('骨骼动画')
    const away = entry('AI序列动画')
    if (!back || !away) return false
    away.click()
    await new Promise((resolve) => window.setTimeout(resolve, 360))
    back.click()
    await new Promise((resolve) => window.setTimeout(resolve, 900))
    return true
  }

  /** Push a rebuilt skeleton back through the import bridge and reload the preview. */
  async function reloadWithSkeleton(skeletonText) {
    const bridge = window.__NovaFlowSpineImportInlineBridge
    const cache = window.__NovaFlowSpineImportInlineBridgeCache
    const source = state.source
    if (!bridge || typeof bridge.start !== 'function' || !cache || !source) {
      throw new Error('导入桥接不可用')
    }
    cache.json = { fileName: source.skeleton.fileName || 'skeleton.json', text: skeletonText }
    state.sentText = skeletonText
    if (source.atlas) cache.atlas = { fileName: source.atlas.fileName, text: source.atlas.text }
    cache.images = Array.isArray(source.images) ? source.images.slice() : cache.images
    const ok = await bridge.start()
    if (!ok) throw new Error('重新载入工程失败')
    await nextFrame()
    try { window.dispatchEvent(new Event('resize')) } catch { /* not fatal */ }
    if (!(await previewIsDrawing())) await remountSkeletonSection()
  }

  /** Write every selected layer's mesh into a fresh copy of the original skeleton. */
  /**
   * Capture the pristine skeleton once. After the first apply the live source holds
   * meshes, and re-applying onto those would convert nothing. Any write-back path
   * may be the first one -- 编辑 on a ticked layer no longer waits for 生成网格.
   */
  function captureSource() {
    const source = importedSource()
    if (!source) throw new Error('请先在「导入工程」里载入 JSON / ATLAS / 贴图')
    if (!state.baseSkeleton) state.baseSkeleton = source.skeleton.text
    state.source = {
      skeleton: { fileName: source.skeleton.fileName },
      atlas: source.atlas ? { fileName: source.atlas.fileName, text: source.atlas.text } : null,
      images: source.images.slice()
    }
    return source
  }

  async function applyAll() {
    const Attach = window.NovaFlowAutoMeshAttach
    if (!Attach) throw new Error('自动蒙皮模块未加载')
    if (!state.baseSkeleton || !state.source) captureSource()
    const skeleton = JSON.parse(state.baseSkeleton)
    const applied = Attach.applyMeshes(skeleton, (attName) => {
      const layer = state.layers.get(attName)
      // an unticked layer stays a plain region
      if (!layer || !layer.selected || !layer.mesh) return null
      return {
        vertices: layer.mesh.vertices,
        triangles: layer.mesh.triangles,
        hull: layer.mesh.hull,
        width: layer.imageData.width,
        height: layer.imageData.height
      }
    })
    let verts = 0
    for (const name of applied.converted) {
      const l = state.layers.get(name)
      if (l && l.mesh) verts += l.mesh.vertices.length / 2
    }
    // weights ride on top: every bound layer's mesh (just converted, or its own) gets
    // weighted vertices encoded against the bind-pose bone transforms
    let bound = 0
    const AW = window.NovaFlowAutoWeights
    if (AW && Array.from(state.layers.values()).some((l) => l.selected && l.weights)) {
      const mats = boneMatrices(applied.skeleton)
      const res = AW.applyWeights(applied.skeleton, (attName, slotName, att) => {
        const layer = state.layers.get(attName)
        if (!layer || !layer.selected || !layer.weights) return null
        const n = att.uvs.length / 2
        // weights belong to one specific mesh; a stale set must never be encoded
        if (layer.weights.weights.length !== n * layer.weights.boneIds.length) return null
        return layer.weights
      }, mats)
      applied.skeleton = res.skeleton
      bound = res.written.length
    }
    // Handing a freshly meshed rig to the preview stalls it for a long moment --
    // observed around 25s for a 26 layer rig -- and it recovers on its own. The
    // mechanism is not pinned down: the preview rasterises a mesh one triangle at
    // a time, but a warm context does that in ~5us per triangle, so triangle
    // count alone does not account for it. Nothing of ours can run during the
    // stall, so say it beforehand and give the browser two frames to paint it.
    if (applied.converted.length) {
      setStatusFn(`正在重建预览（${applied.converted.length} 层）…首帧可能要等十几秒`)
      await nextFrame()
      await nextFrame()
    }
    await reloadWithSkeleton(JSON.stringify(applied.skeleton))
    state.lastReport = { converted: applied.converted.length, verts, bound }
    return state.lastReport
  }

  // ------------------------------------------------------------- weights ---

  /**
   * Bone transforms must match what the preview binds against. The official player
   * keeps its runtime namespace private, so remember the last player the app
   * created and pose a throwaway Skeleton from its own data (constraints and all).
   * Without a player, fall back to the plain bone tree -- which ignores IK, transform
   * constraints and inherit modes, so an auto-rigged skeleton binds scrambled.
   */
  let livePlayer = null
  function hookPlayerFactory() {
    const key = '__NOVA_SPINE_CREATE_PLAYER'
    const factory = window[key]
    if (typeof factory !== 'function' || factory.__novaflowAutoWeightsHook) return
    const wrapped = function (...args) {
      const player = factory.apply(this, args)
      if (player) livePlayer = player
      return player
    }
    wrapped.__novaflowAutoWeightsHook = true
    wrapped.__novaflowOriginalSpineCreatePlayer = factory
    window[key] = wrapped
  }

  function boneMatrices(skeletonJson) {
    const AW = window.NovaFlowAutoWeights
    if (!AW) throw new Error('自动权重模块未加载')
    // the factory hands out a proxy; the runtime namespace sits on its inner player
    const usable = (pl) => (pl && !pl.disposed && pl.spine && pl.spine.SkeletonJson ? pl : null)
    const proxy = window.__NovaFlowSkeletonTimelineOfficialProxy
    const p = usable(proxy && proxy.player) || usable(livePlayer && livePlayer.player) || usable(livePlayer)
    if (p) {
      try { return AW.matricesFromRuntime(p.spine, skeletonJson) } catch { /* plain tree below */ }
    }
    return AW.setupPoseMatrices(skeletonJson)
  }

  /** The attachment (and its slot) of a name in a skeleton JSON. */
  function placementOf(skeleton, attName) {
    let found = null
    const visit = (attachments) => {
      for (const slot of Object.keys(attachments || {})) {
        const a = (attachments[slot] || {})[attName]
        if (a && !found) found = { slot, att: a }
      }
    }
    if (Array.isArray(skeleton.skins)) for (const s of skeleton.skins) visit(s && s.attachments)
    else if (skeleton.skins) for (const k of Object.keys(skeleton.skins)) visit(skeleton.skins[k])
    return found
  }

  /** Least-squares affine map (x,y) -> (u,v) from paired lists. */
  function fitAffine(from, to) {
    const n = from.length / 2
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rx = [0, 0, 0], ry = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const r = [from[2 * i], from[2 * i + 1], 1]
      for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b]; rx[a] += r[a] * to[2 * i]; ry[a] += r[a] * to[2 * i + 1] }
    }
    const solve = (A, bvec) => {
      const m = A.map((row, i) => [...row, bvec[i]])
      for (let c = 0; c < 3; c++) {
        let p = c
        for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
        const tmp = m[c]; m[c] = m[p]; m[p] = tmp
        if (Math.abs(m[c][c]) < 1e-12) return null
        for (let r = 0; r < 3; r++) { if (r === c) continue; const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k] }
      }
      return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]]
    }
    const X = solve(M, rx), Y = solve(M, ry)
    if (!X || !Y) return null
    return (x, y) => [X[0] * x + X[1] * y + X[2], Y[0] * x + Y[1] * y + Y[2]]
  }

  /**
   * A layer's mesh in world space plus a world -> image px map (for drawing bones
   * over the layer). Generated meshes sit where the region attachment places the
   * image; an attachment that was already a mesh keeps its own binding.
   */
  function layerGeometry(skeleton, mats, name, layer) {
    const AW = window.NovaFlowAutoWeights
    const found = placementOf(skeleton, name)
    if (!found || !layer.mesh) return null
    const att = found.att
    const boneIndex = new Map(skeleton.bones.map((b, i) => [b.name, i]))
    const slotDef = (skeleton.slots || []).find((s) => s.name === found.slot)
    const slotBone = slotDef ? boneIndex.get(slotDef.bone) : undefined
    const V = layer.mesh.vertices, n = V.length / 2
    if (layer.fromMesh && att.type === 'mesh') {
      const world = AW.attachmentWorld(att, mats, slotBone)
      const map = fitAffine(world, V)
      const toImage = map || ((wx, wy) => [wx, wy])
      return { world, tris: layer.mesh.triangles, toImage, slot: found.slot }
    }
    const W = layer.imageData.width, H = layer.imageData.height
    const rw = Number(att.width) || W, rh = Number(att.height) || H
    const rx = Number(att.x) || 0, ry = Number(att.y) || 0
    // same placement as the mesh write-back: the region's rotation and scale count
    const rot = (Number(att.rotation) || 0) * Math.PI / 180
    const cos = Math.cos(rot), sin = Math.sin(rot)
    const sx = att.scaleX !== undefined ? Number(att.scaleX) || 1 : 1
    const sy = att.scaleY !== undefined ? Number(att.scaleY) || 1 : 1
    const m = (slotBone !== undefined && mats[slotBone]) || { a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }
    const inv = AW.invertBone(m)
    const world = new Float64Array(2 * n)
    for (let i = 0; i < n; i++) {
      const qx = (V[2 * i] - rw / 2) * sx, qy = (rh / 2 - V[2 * i + 1]) * sy
      const lx = rx + qx * cos - qy * sin, ly = ry + qx * sin + qy * cos
      world[2 * i] = m.a * lx + m.b * ly + m.worldX
      world[2 * i + 1] = m.c * lx + m.d * ly + m.worldY
    }
    const toImage = (wx, wy) => {
      const dx = wx - inv.wx, dy = wy - inv.wy
      const lx = inv.ia * dx + inv.ib * dy - rx, ly = inv.ic * dx + inv.id * dy - ry
      const qx = lx * cos + ly * sin, qy = -lx * sin + ly * cos
      return [qx / sx + rw / 2, rh / 2 - qy / sy]
    }
    return { world, tris: layer.mesh.triangles, toImage, slot: found.slot }
  }

  // The artist paints eyelids compact, strong and rigid (the lid slides over the
  // eye) and lips wide and faint; geometry cannot tell them apart, the names can.
  const CONTROLLER_PRESETS = [
    { pattern: /eye|lid|眼/i, radiusFrac: 0.08, peak: 0.85, pin: 5 },
    { pattern: /mouth|lip|嘴|唇/i, radiusFrac: 0.16, peak: 0.3, pin: 0 }
  ]

  /** Everything the solver needs for the current base skeleton. */
  function bindContext() {
    const AW = window.NovaFlowAutoWeights
    if (!AW) throw new Error('自动权重模块未加载')
    if (!state.baseSkeleton) captureSource()
    const skeleton = JSON.parse(state.baseSkeleton)
    const mats = boneMatrices(skeleton)
    const skip = AW.mechanismBones(skeleton)
    const segs = mats.map((m, i) => {
      const s = AW.boneSegment(m)
      if (skip.has(i)) s.skip = true
      if (!(m.length > 0)) for (const p of CONTROLLER_PRESETS) if (p.pattern.test(m.name)) Object.assign(s, { radiusFrac: p.radiusFrac, peak: p.peak, pin: p.pin })
      return s
    })
    const parents = Array.from(AW.logicalParents(skeleton))
    const drawIndex = new Map((skeleton.slots || []).map((s, i) => [s.name, i]))
    return { skeleton, mats, skip, segs, parents, drawIndex }
  }

  /** Solve one layer for a bone list; drops bones nothing binds to. */
  function solveLayer(ctx, geom, boneIds) {
    const AW = window.NovaFlowAutoWeights
    const n = geom.world.length / 2
    const r = AW.heatWeights(geom.world, geom.tris, boneIds.map((id) => ctx.segs[id]))
    const keep = []
    boneIds.forEach((id, j) => { let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, r.weights[i * boneIds.length + j]); if (mx > 1e-4) keep.push(j) })
    const ids = keep.map((j) => boneIds[j])
    const weights = new Float64Array(n * ids.length)
    for (let i = 0; i < n; i++) {
      let s = 0
      keep.forEach((j, k) => { weights[i * ids.length + k] = r.weights[i * boneIds.length + j]; s += weights[i * ids.length + k] })
      if (s > 0) for (let k = 0; k < ids.length; k++) weights[i * ids.length + k] /= s
    }
    return { boneIds: ids, weights }
  }

  /**
   * Make sure a layer has a mesh to bind: a generated one for a region, or the
   * attachment's own vertices when it already is a mesh (its weights come along).
   */
  async function ensureMeshForWeights(name) {
    const layer = state.layers.get(name)
    if (!layer || !layer.hasImage) throw new Error(`${name} 没有同名贴图`)
    const imageData = await ensurePixels(name)
    if (layer.mesh) return layer
    const skeleton = JSON.parse(state.baseSkeleton)
    const found = placementOf(skeleton, name)
    if (found && found.att && found.att.type === 'mesh' && Array.isArray(found.att.uvs)) {
      const att = found.att, n = att.uvs.length / 2
      const vertices = new Float64Array(2 * n)
      for (let i = 0; i < n; i++) { vertices[2 * i] = att.uvs[2 * i] * imageData.width; vertices[2 * i + 1] = att.uvs[2 * i + 1] * imageData.height }
      layer.mesh = { vertices, triangles: Array.from(att.triangles || []), hull: att.hull || n }
      layer.fromMesh = true
      const existing = window.NovaFlowAutoWeights.weightsOfAttachment(att)
      if (existing && !layer.weights) layer.weights = existing
      layer.selected = true
      return layer
    }
    const AutoMesh = window.NovaFlowAutoMesh
    const built = AutoMesh.buildMesh(imageData.data, imageData.width, imageData.height, { density: layer.density })
    if (!built) throw new Error(`${name} 生成失败`)
    layer.mesh = built
    layer.selected = true
    return layer
  }

  /** Re-solve a layer on its current mesh with the bone set it already had (after a mesh edit). */
  function rebindLayer(name, boneIds) {
    const layer = state.layers.get(name)
    if (!layer || !layer.mesh || !boneIds || !boneIds.length) { if (layer) layer.weights = null; return }
    try {
      const ctx = bindContext()
      const g = layerGeometry(ctx.skeleton, ctx.mats, name, layer)
      layer.weights = g ? solveLayer(ctx, g, boneIds) : null
    } catch { layer.weights = null }
  }

  /**
   * Auto weights for the ticked layers: assign every bone of the skeleton to the
   * layer it belongs to (chains vote as one, controllers to the smallest layer
   * holding them, IK helpers and pivots skipped), then diffuse.
   */
  async function autoWeights(names, setStatus) {
    if (typeof setStatus !== 'function') setStatus = () => {}
    const AW = window.NovaFlowAutoWeights
    if (!AW) throw new Error('自动权重模块未加载')
    captureSource()
    syncLayersFromSource()
    const targets = (Array.isArray(names) && names.length ? names : selectedNames()).filter((n) => state.layers.get(n) && state.layers.get(n).hasImage)
    if (!targets.length) throw new Error('请先勾选要绑定的图层')
    for (const n of targets) { setStatus(`准备 ${n}…`); await nextFrame(); await ensureMeshForWeights(n) }
    const ctx = bindContext()
    if (!ctx.skeleton.bones || ctx.skeleton.bones.length <= 1) throw new Error('骨架只有 root,先在 Spine 里建好骨骼再自动绑定')
    const geoms = new Map()
    for (const n of targets) {
      const g = layerGeometry(ctx.skeleton, ctx.mats, n, state.layers.get(n))
      if (g) geoms.set(n, g)
    }
    const layersGeom = Array.from(geoms.entries()).map(([n, g]) => ({ name: n, vertices: g.world, triangles: g.tris, drawIndex: ctx.drawIndex.get(g.slot) }))
    setStatus('分配骨骼…')
    await nextFrame()
    const assigned = AW.assignBones(layersGeom, ctx.segs, ctx.parents)
    let done = 0
    for (const [n, g] of geoms) {
      done++
      setStatus(`计算权重 ${done}/${geoms.size} · ${n}`)
      await nextFrame()
      const ids = assigned.layers.get(n) || []
      const layer = state.layers.get(n)
      if (!ids.length) { layer.weights = null; continue }
      layer.weights = solveLayer(ctx, g, ids)
      layer.weightsEdited = false
    }
    setStatus('写回骨架…')
    await nextFrame()
    const report = await applyAll()
    renderList()
    return report
  }

  /** Open the weight editor on one layer and write the result back. */
  /**
   * What the weight editor needs to pose a layer under the running preview: every
   * vertex expressed in each bone's bind-pose frame, the live bones by name, the
   * world->image map of the layer, and the player's transport. Null when no
   * official player is up.
   */
  function liveAnimation(ctx, g) {
    const AW = window.NovaFlowAutoWeights
    // the factory hook does not always catch the player; the proxy always has it
    const usable = (pl) => pl && !pl.disposed && pl.skeleton && pl.animationState ? pl : null
    const proxy = window.__NovaFlowSkeletonTimelineOfficialProxy
    const p = usable(livePlayer) || usable(proxy && proxy.player)
    if (!p || !AW) return null
    const byName = new Map((p.skeleton.bones || []).map((b) => [b.data && b.data.name, b]))
    const timeScale0 = p.animationState.timeScale
    const track = () => (p.animationState.tracks && p.animationState.tracks[0]) || null
    const liveBone = (index) => { const m = ctx.mats[index]; return m ? byName.get(m.name) || null : null }
    return {
      world: g.world,
      toImage: g.toImage,
      localOf: (index) => {
        const inv = AW.invertBone(ctx.mats[index])
        const n = g.world.length / 2
        const out = new Float64Array(2 * n)
        for (let i = 0; i < n; i++) {
          const dx = g.world[2 * i] - inv.wx, dy = g.world[2 * i + 1] - inv.wy
          out[2 * i] = inv.ia * dx + inv.ib * dy
          out[2 * i + 1] = inv.ic * dx + inv.id * dy
        }
        return out
      },
      boneWorld: (index) => { const b = liveBone(index); return b ? { a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY } : null },
      bonePose: (index) => {
        const b = liveBone(index)
        if (!b) return null
        const len = Number(ctx.mats[index].length) || 0
        const o = g.toImage(b.worldX, b.worldY)
        const t = g.toImage(b.a * len + b.worldX, b.c * len + b.worldY)
        return { ax: o[0], ay: o[1], bx: t[0], by: t[1] }
      },
      playing: () => p.animationState.timeScale !== 0,
      play: () => { p.animationState.timeScale = 1 },
      pause: () => { p.animationState.timeScale = 0 },
      time: () => { const t = track(); if (!t) return 0; const d = t.animation ? t.animation.duration : 0; return t.loop && d > 0 ? t.trackTime % d : t.trackTime },
      duration: () => { const t = track(); return t && t.animation ? t.animation.duration : 0 },
      setTime: (v) => { const t = track(); if (t) t.trackTime = v },
      restore: () => { p.animationState.timeScale = timeScale0 }
    }
  }

  async function editWeights(name, setStatus) {
    if (typeof setStatus !== 'function') setStatus = () => {}
    const Editor = window.NovaFlowAutoWeightsEditor
    const AW = window.NovaFlowAutoWeights
    if (!Editor || !AW) throw new Error('权重编辑器未加载')
    const layer = state.layers.get(name)
    if (!layer || !layer.hasImage) throw new Error('该图层没有同名贴图')
    captureSource()
    await ensureMeshForWeights(name)
    // an unbound layer gets the automatic result first, together with the other ticked layers
    if (!layer.weights) await autoWeights(selectedNames().includes(name) ? selectedNames() : [name], setStatus)
    const ctx = bindContext()
    const g = layerGeometry(ctx.skeleton, ctx.mats, name, layer)
    if (!g) throw new Error('找不到该图层的摆放信息')
    const bones = []
    ctx.mats.forEach((m, i) => {
      if (ctx.skip.has(i)) return
      const s = ctx.segs[i]
      const [ax, ay] = g.toImage(s.ax, s.ay)
      const [bx, by] = g.toImage(s.bx, s.by)
      bones.push({ index: i, name: m.name, ax, ay, bx, by, length: m.length })
    })
    const result = await Editor.open(layer.imageData, layer.mesh, {
      name,
      bones,
      boneIds: layer.weights ? layer.weights.boneIds : [],
      weights: layer.weights ? layer.weights.weights : null,
      auto: (ids) => { const r = solveLayer(ctx, g, ids); if (r.boneIds.length !== ids.length) return null; return r.weights },
      live: liveAnimation(ctx, g)
    })
    if (!result) return false
    layer.weights = result
    layer.weightsEdited = true
    setStatus(`写回 ${name}…`)
    await nextFrame()
    await applyAll()
    renderList()
    return true
  }

  // ---------------------------------------------------------------- work ---

  function attachmentEntries(skeleton) {
    const out = []
    const collect = (attachments) => {
      for (const slot of Object.keys(attachments || {})) {
        for (const att of Object.keys(attachments[slot] || {})) {
          const a = attachments[slot][att]
          out.push({ name: att, slot, path: a && typeof a === 'object' && a.path ? String(a.path) : null })
        }
      }
    }
    if (Array.isArray(skeleton.skins)) for (const s of skeleton.skins) collect(s && s.attachments)
    else if (skeleton.skins) for (const k of Object.keys(skeleton.skins)) collect(skeleton.skins[k])
    return out
  }

  /**
   * Build the checklist from whatever project is loaded. Called on a timer, so it
   * must be cheap and must not disturb selections or meshes already in hand.
   */
  function syncLayersFromSource() {
    const source = importedSource()
    if (!source) {
      if (state.layers.size) { state.layers.clear(); state.listedFrom = null; renderList() }
      return
    }
    // A different project came in through 导入工程 while we still held a meshed one:
    // the live text is neither what we last sent nor the original we keep. Forget
    // the old one, or the list would go on showing it and a packed atlas would
    // never be unpacked. (The bridge keeps the text we hand it verbatim.)
    const live = source.skeleton.text
    if (state.baseSkeleton && live !== state.baseSkeleton && live !== state.sentText) {
      state.baseSkeleton = null
      state.source = null
      state.listedFrom = null
      state.layers.clear()
      state.lastReport = null
    }
    // a project straight out of Spine is unpacked first; the reload brings it back here per layer
    if (!state.baseSkeleton && packedAtlas(source)) { unpackIfNeeded(source); return }
    // once meshes exist the live skeleton is the meshed one; keep listing the original
    const text = state.baseSkeleton || source.skeleton.text
    if (state.listedFrom === text) return
    let skeleton
    try { skeleton = JSON.parse(text) } catch { return }
    const images = new Set()
    for (const img of source.images) {
      const key = String(img.fileName || '').replace(/\.[^.]+$/, '').toLowerCase()
      if (key) images.add(key)
    }
    const hasImage = (name) => images.has(String(name).toLowerCase())
    const next = new Map()
    for (const { name, slot, path } of attachmentEntries(skeleton)) {
      const prev = state.layers.get(name)
      next.set(name, prev || {
        slot,
        path,
        hasImage: hasImage(name),
        selected: false,
        imageData: null,
        mesh: null,
        density: state.density,
        edited: false,
        /** {boneIds, weights} for this mesh, or null while unbound */
        weights: null,
        weightsEdited: false,
        /** the attachment was already a mesh: its own vertices are edited, never rebuilt */
        fromMesh: false
      })
      if (prev) { prev.path = path; prev.hasImage = hasImage(name) }
    }
    state.layers = next
    state.listedFrom = text
    renderList()
  }

  function selectedNames() {
    const out = []
    for (const [name, l] of state.layers) if (l.selected && l.hasImage) out.push(name)
    return out
  }

  // ---- projects straight out of Spine: one packed page, not a PNG per layer
  // Unpack it the way Spine's own 纹理解包 does -- every region back into a
  // full-size image of its own -- and reload. From then on it is the same kind
  // of project as a PS export, and nothing downstream has to know about atlas
  // offsets or rotation. This happens on every import, automatically (user
  // decision 2026-09-20).

  const imageKey = (fileName) => String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase()

  function directImage(source, name) {
    return source.images.find((i) => imageKey(i.fileName) === String(name).toLowerCase()) || null
  }

  /** the atlas regions of the loaded project, re-parsed only when the text changes */
  function atlasRegions(source) {
    const text = source && source.atlas && source.atlas.text ? String(source.atlas.text) : ''
    if (state.atlasText !== text) {
      const Attach = window.NovaFlowAutoMeshAttach
      state.atlasText = text
      state.atlasRegions = Attach && text ? Attach.parseAtlas(text) : new Map()
      state.pages = new Map()
    }
    return state.atlasRegions
  }

  /** true when the atlas packs several regions on a page, or trims, offsets or rotates any */
  function packedAtlas(source) {
    const regions = atlasRegions(source)
    if (!regions.size) return false
    const pages = new Set()
    for (const r of regions.values()) {
      pages.add(imageKey(r.page))
      if (r.rotate || r.offX || r.offY || r.w !== r.origW || r.h !== r.origH) return true
    }
    return regions.size > pages.size
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片解码失败'))
      img.src = dataUrl
    })
  }

  function pageElement(page) {
    const key = String(page.fileName || '')
    if (!state.pages.has(key)) state.pages.set(key, loadImage(page.dataUrl))
    return state.pages.get(key)
  }

  /**
   * One region back into its original, full-size image. A rotated region lies in
   * the page turned a quarter turn counter-clockwise (its packed box is h wide and
   * w tall), so it comes back with a clockwise quarter turn -- checked against the
   * PS export of the same layers: alpha IoU 1.000 this way, 0.25-0.56 the other.
   */
  function unpackRegion(page, region) {
    const canvas = document.createElement('canvas')
    canvas.width = region.origW
    canvas.height = region.origH
    const ctx = canvas.getContext('2d')
    ctx.translate(region.offX, region.offTop)
    if (region.rotate) {
      ctx.translate(region.w, 0)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(page, region.x, region.y, region.h, region.w, 0, 0, region.h, region.w)
    } else {
      ctx.drawImage(page, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h)
    }
    return canvas
  }

  async function unpackAtlasProject(source, setStatus) {
    const Attach = window.NovaFlowAutoMeshAttach
    const bridge = window.__NovaFlowSpineImportInlineBridge
    const cache = window.__NovaFlowSpineImportInlineBridgeCache
    if (!Attach || !bridge || !cache) throw new Error('导入桥接不可用')
    const regions = atlasRegions(source)
    let skeleton
    try { skeleton = JSON.parse(source.skeleton.text) } catch { throw new Error('骨架 JSON 解析失败') }
    // which image each attachment draws (by path, else by name), and whether that
    // image may be trimmed: a plain region attachment is moved to follow the crop
    // and a mesh has its uvs remapped; a rotated or scaled region cannot be moved
    // exactly, so its image stays full size
    const uses = new Map()
    const visit = (attachments) => {
      for (const slot of Object.keys(attachments || {})) {
        for (const key of Object.keys(attachments[slot] || {})) {
          const att = attachments[slot][key]
          if (!att || typeof att !== 'object') continue
          const type = att.type || 'region'
          if (type !== 'region' && type !== 'mesh') continue
          const stem = String(att.path || att.name || key)
          const region = regions.get(stem)
          if (!region) continue
          const plain = type === 'mesh' || (!Number(att.rotation)
            && (att.scaleX === undefined || Number(att.scaleX) === 1)
            && (att.scaleY === undefined || Number(att.scaleY) === 1))
          const u = uses.get(stem) || { region, trimmable: true }
          if (!plain) u.trimmable = false
          uses.set(stem, u)
        }
      }
    }
    if (Array.isArray(skeleton.skins)) for (const sk of skeleton.skins) visit(sk && sk.attachments)
    else if (skeleton.skins) for (const k of Object.keys(skeleton.skins)) visit(skeleton.skins[k])
    if (!uses.size) throw new Error('图集里没有和附件对应的区域')

    const images = []
    const trims = new Map()
    let done = 0
    for (const [stem, u] of uses) {
      done++
      setStatus(`纹理解包 ${done}/${uses.size}…`)
      await nextFrame()
      const page = source.images.find((i) => imageKey(i.fileName) === imageKey(u.region.page))
      if (!page) continue
      const full = unpackRegion(await pageElement(page), u.region)
      const dataUrl = full.toDataURL('image/png')
      let trimmed = null
      if (u.trimmable) { try { trimmed = await trimToArtwork(dataUrl, full.width, full.height) } catch { trimmed = null } }
      if (trimmed) {
        trims.set(stem.toLowerCase(), trimmed)
        images.push({ fileName: stem + '.png', dataUrl: trimmed.dataUrl, width: trimmed.width, height: trimmed.height })
      } else {
        images.push({ fileName: stem + '.png', dataUrl, width: full.width, height: full.height })
      }
    }
    if (!images.length) throw new Error('图集的页图不在手')
    const moved = trims.size ? Attach.retargetTrimmed(skeleton, trims) : 0
    const upgraded = Attach.normalizeToSpine38(skeleton)
    const text = (moved || upgraded) ? JSON.stringify(skeleton) : source.skeleton.text
    setStatus('合成图集…')
    await nextFrame()
    cache.json = { fileName: source.skeleton.fileName || 'skeleton.json', text }
    cache.atlas = { fileName: source.atlas.fileName || 'skeleton.atlas', text: Attach.synthesizeAtlas(images) }
    state.sentText = text
    cache.images = images.map((i) => ({ fileName: i.fileName, dataUrl: i.dataUrl }))
    const ok = await bridge.start()
    if (!ok) throw new Error('重新载入工程失败')
    // a fresh project invalidates anything we had meshed
    state.baseSkeleton = null
    state.source = null
    state.listedFrom = null
    state.layers.clear()
    state.lastReport = null
    return images.length
  }

  /** run the unpack once per loaded skeleton, off the sync timer */
  function unpackIfNeeded(source) {
    const key = source.skeleton.text
    if (state.unpacking || state.unpackTried === key) return
    state.unpacking = true
    state.unpackTried = key
    const say = typeof setStatusFn === 'function' ? setStatusFn : () => {}
    unpackAtlasProject(source, say)
      .then((n) => { say(`已解包 ${n} 张贴图,可以勾选图层了`, 'ok') })
      .catch((err) => { say('纹理解包失败: ' + (err && err.message ? err.message : err), 'error') })
      .then(() => { state.unpacking = false; try { syncLayersFromSource() } catch { /* next tick */ } })
  }

  async function ensurePixels(name) {
    const layer = state.layers.get(name)
    if (!layer) throw new Error('图层不存在')
    if (layer.imageData) return layer.imageData
    const source = importedSource()
    if (!source) throw new Error('当前没有已载入的工程')
    const img = directImage(source, name)
    if (!img) throw new Error(`${name} 没有对应贴图`)
    layer.imageData = await decodeImage(img.dataUrl)
    return layer.imageData
  }

  /**
   * A layer whose attachment already is a mesh -- a rig out of Spine, with the
   * artist's own vertices and bone weights -- keeps that mesh. Building a new one
   * over it made a mesh the write-back could not place (applyMeshes only converts
   * regions), and 自动权重 then bound it to whatever bones sat near the slot's
   * origin: the face came out weighted to hip bones.
   */
  function adoptExistingMesh(name, layer, imageData) {
    const text = state.baseSkeleton || (importedSource() && importedSource().skeleton.text)
    if (!text) return false
    let skeleton
    try { skeleton = JSON.parse(text) } catch { return false }
    const found = placementOf(skeleton, name)
    const att = found && found.att
    if (!att || att.type !== 'mesh' || !Array.isArray(att.uvs) || !Array.isArray(att.triangles)) return false
    const n = att.uvs.length / 2
    const vertices = new Float64Array(2 * n)
    for (let i = 0; i < n; i++) {
      vertices[2 * i] = att.uvs[2 * i] * imageData.width
      vertices[2 * i + 1] = att.uvs[2 * i + 1] * imageData.height
    }
    layer.mesh = { vertices, triangles: Array.from(att.triangles), hull: att.hull || n }
    layer.fromMesh = true
    layer.edited = false
    const AW = window.NovaFlowAutoWeights
    if (AW && !layer.weights) {
      const existing = AW.weightsOfAttachment(att)
      if (existing) layer.weights = existing
    }
    return true
  }

  async function generate(setStatus) {
    // a public entry point: a caller without a status line must not blow up half way
    if (typeof setStatus !== 'function') setStatus = () => {}
    const AutoMesh = window.NovaFlowAutoMesh
    if (!AutoMesh || !window.NovaFlowAutoMeshAttach) throw new Error('自动蒙皮模块未加载')
    captureSource()
    syncLayersFromSource()

    const names = selectedNames()
    if (!names.length) throw new Error('请先勾选要蒙皮的图层')

    let done = 0
    for (const name of names) {
      const layer = state.layers.get(name)
      done++
      setStatus(`计算网格 ${done}/${names.length} · ${name}`)
      await nextFrame()
      let imageData
      try { imageData = await ensurePixels(name) } catch { continue }
      if (adoptExistingMesh(name, layer, imageData)) continue
      const mesh = AutoMesh.buildMesh(imageData.data, imageData.width, imageData.height, { density: layer.density })
      if (mesh) { layer.mesh = mesh; layer.edited = false }
    }
    const built = names.filter((n) => state.layers.get(n).mesh)
    if (!built.length) throw new Error('勾选的图层都没能生成网格')

    setStatus('写回骨架…')
    await nextFrame()
    const report = await applyAll()
    renderList()
    return report
  }

  async function regenerateLayer(name, density, setStatus) {
    // a public entry point: a caller without a status line must not blow up half way
    if (typeof setStatus !== 'function') setStatus = () => {}
    const AutoMesh = window.NovaFlowAutoMesh
    const layer = state.layers.get(name)
    if (!layer) throw new Error('图层不存在')
    setStatus(`重算 ${name}…`)
    await nextFrame()
    const imageData = await ensurePixels(name)
    // the artist's mesh is never rebuilt; density only means something for a region
    if (adoptExistingMesh(name, layer, imageData)) { layer.density = density; await applyAll(); renderList(); return }
    const mesh = AutoMesh.buildMesh(imageData.data, imageData.width, imageData.height, { density })
    if (!mesh) throw new Error(`${name} 生成失败`)
    const prevIds = layer.weights ? layer.weights.boneIds.slice() : null
    layer.mesh = mesh
    layer.density = density
    layer.edited = false
    // a new mesh needs new weights; keep the bone set the layer already had
    if (prevIds) rebindLayer(name, prevIds)
    await applyAll()
    renderList()
  }

  async function editLayer(name, setStatus) {
    // a public entry point: a caller without a status line must not blow up half way
    if (typeof setStatus !== 'function') setStatus = () => {}
    const Editor = window.NovaFlowAutoMeshEditor
    if (!Editor) throw new Error('网格编辑器未加载')
    const layer = state.layers.get(name)
    if (!layer || !layer.hasImage) throw new Error('该图层没有同名贴图')
    const AutoMesh = window.NovaFlowAutoMesh
    // A ticked layer can be edited before anything was generated: build its mesh at
    // the row's density first. A greyed-out 编辑 that only woke up after 生成网格
    // read as a broken button.
    const fresh = !layer.mesh
    if (fresh) {
      setStatus(`生成 ${name}…`)
      await nextFrame()
      const imageData = await ensurePixels(name)
      if (!adoptExistingMesh(name, layer, imageData)) {
        const built = AutoMesh.buildMesh(imageData.data, imageData.width, imageData.height, { density: layer.density })
        if (!built) throw new Error(`${name} 生成失败`)
        layer.mesh = built
      }
      renderList()
    }
    const edited = await Editor.open(layer.imageData, layer.mesh, {
      name,
      density: layer.density,
      minDensity: 8,
      maxDensity: 40,
      rebuild: (density) => {
        const m = AutoMesh.buildMesh(layer.imageData.data, layer.imageData.width, layer.imageData.height, { density })
        if (m) layer.density = density
        return m
      }
    })
    if (!edited) {
      // nothing was written back, so a mesh built only for this edit must not linger
      if (fresh) { layer.mesh = null; renderList() }
      return false
    }
    const prevIds = layer.weights ? layer.weights.boneIds.slice() : null
    layer.mesh = edited
    layer.edited = true
    if (prevIds) rebindLayer(name, prevIds)
    setStatus(`写回 ${name}…`)
    await nextFrame()
    await applyAll()
    renderList()
    return true
  }

  /** Ticking a layer off drops its mesh from the write-back straight away. */
  async function setSelected(name, selected) {
    const layer = state.layers.get(name)
    if (!layer) return
    layer.selected = selected
    // Ticking is only a choice: the project is rewritten by 生成网格, 自动权重 and the
    // editors, not by the checkbox. Only unticking a layer that carries a mesh
    // changes what is written, so only that reloads the preview -- every reload
    // rebuilds the skeleton tree, animations and skins on the right, visibly.
    const hadMesh = !!layer.mesh
    if (!selected) { layer.mesh = null; layer.edited = false; layer.weights = null; layer.weightsEdited = false; layer.fromMesh = false }
    renderList()
    try { renderHierarchy(true) } catch { /* the tree is not up yet */ }
    if (!selected && hadMesh && state.baseSkeleton && state.source) await applyAll()
  }

  /**
   * Back to the weights each layer had when it was imported: a mesh that came out
   * of Spine keeps its own binding, everything bound here is dropped. The meshes stay.
   */
  async function restoreWeights() {
    const AW = window.NovaFlowAutoWeights
    if (!state.baseSkeleton) throw new Error('还没有可还原的权重')
    const skeleton = JSON.parse(state.baseSkeleton)
    let n = 0
    for (const [name, l] of state.layers) {
      if (!l.weights && !l.weightsEdited) continue
      const found = l.fromMesh ? placementOf(skeleton, name) : null
      const original = found && found.att && found.att.type === 'mesh' && AW ? AW.weightsOfAttachment(found.att) : null
      l.weights = original || null
      l.weightsEdited = false
      n++
    }
    if (n) await applyAll()
    renderList()
    return n
  }

  async function restore() {
    if (!state.baseSkeleton) throw new Error('没有可还原的原始骨架')
    await reloadWithSkeleton(state.baseSkeleton)
    for (const l of state.layers.values()) { l.mesh = null; l.edited = false; l.weights = null; l.weightsEdited = false; l.fromMesh = false }
    state.lastReport = null
    renderList()
  }

  // ------------------------------------------------------------------ UI ---

  function el(tag, style, text) {
    const n = document.createElement(tag)
    if (style) Object.assign(n.style, style)
    if (text != null) n.textContent = text
    return n
  }

  function styleButton(btn, primary) {
    Object.assign(btn.style, {
      width: '100%', height: '30px', borderRadius: '6px', border: '0',
      cursor: 'pointer', fontSize: '12px', fontWeight: '600',
      color: primary ? '#ffffff' : 'rgba(255,255,255,0.86)',
      background: primary ? '#1EA672' : '#3a3a3a'
    })
    if (primary) btn.setAttribute('data-novaflow-solid-green', '1')
  }

  // The app's own small-button look: #333 at rest, the green accent on hover. The
  // old #3a3a3a on the row background read as disabled, and the button could
  // shrink in its flex row until 编辑 broke into two lines. No border and no radius
  // here: the app forces both on every button (`border: none`, 8px) with !important.
  function smallButton(label) {
    const b = el('button', {
      height: '22px', padding: '0 10px', background: '#333333',
      color: 'rgba(255,255,255,0.92)', cursor: 'pointer', fontSize: '11px', lineHeight: '22px',
      whiteSpace: 'nowrap', flex: '0 0 auto', boxSizing: 'border-box',
      transition: 'background 90ms linear, color 90ms linear'
    }, label)
    b.type = 'button'
    b.addEventListener('mouseenter', () => {
      if (b.disabled) return
      b.style.background = 'rgba(30,166,114,0.18)'
      b.style.color = '#7ce8b5'
    })
    b.addEventListener('mouseleave', () => {
      b.style.background = '#333333'
      b.style.color = 'rgba(255,255,255,0.92)'
    })
    return b
  }

  // The brand runtime's left-shell layout pass (which data-novaflow-editor-panel opts
  // into) rewrites every direct child of a panel body to margin: 5px 0 0 one frame
  // after mount. Bodies authored with any other spacing shrink on that frame -- the
  // 自动蒙皮 body lost 11px and everything below it jumped up. So author exactly that.
  const STACK_GAP = '5px'

  function buildMeshBody() {
    const body = el('div')
    body.className = 'nf-panel-body'
    body.style.padding = '14px'
    // the layout pass stacks the panel's own children too: header first, body 5px under it
    body.style.marginTop = STACK_GAP
    body.style.display = state.open ? 'block' : 'none'

    const row = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' })
    row.appendChild(el('span', { fontSize: '12px', color: 'rgba(255,255,255,0.72)' }, '默认密度'))
    const value = el('span', { fontSize: '12px', color: '#22c98a', fontWeight: '600' }, String(state.density))
    row.appendChild(value)

    const slider = el('input')
    slider.type = 'range'; slider.min = '8'; slider.max = '40'; slider.step = '1'
    slider.value = String(state.density)
    Object.assign(slider.style, { width: '100%', marginTop: STACK_GAP, marginBottom: '0', accentColor: '#22c98a' })
    slider.addEventListener('input', () => {
      state.density = Number(slider.value)
      value.textContent = slider.value
      writeStore(STORAGE_DENSITY, state.density)
      // layers that have not been built yet follow the default
      for (const l of state.layers.values()) if (!l.mesh) l.density = state.density
    })

    const hint = el('div', {
      fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: STACK_GAP, lineHeight: '1.5'
    }, '越高越密。20~24 通常够用,再高收益很小。')

    const genBtn = el('button', null, '生成网格'); genBtn.type = 'button'; styleButton(genBtn, true)
    genBtn.style.marginTop = STACK_GAP
    const restoreBtn = el('button', null, '还原为导入时的图层'); restoreBtn.type = 'button'
    styleButton(restoreBtn, false); restoreBtn.style.marginTop = STACK_GAP
    restoreBtn.title = '去掉这里生成的网格和加上的权重,预览回到刚导入时的样子'

    const status = el('div', {
      fontSize: '11px', color: 'rgba(255,255,255,0.55)', margin: STACK_GAP + ' 0 0', minHeight: '15px', lineHeight: '1.5'
    })

    const listWrap = el('div', { marginTop: STACK_GAP })

    const setStatus = (text, tone) => {
      status.textContent = text || ''
      status.style.color = tone === 'error' ? '#ff8a7a' : (tone === 'ok' ? '#22c98a' : 'rgba(255,255,255,0.55)')
    }
    setStatusFn = setStatus
    busyButtons.push(genBtn, restoreBtn)
    busyLists.push(listWrap)
    const guard = guardWith(setStatus)

    genBtn.addEventListener('click', () => guard(async () => {
      const report = await generate((t) => setStatus(t))
      setStatus(`完成 · ${report.converted} 层 · ${report.verts} 顶点`, 'ok')
    }))

    restoreBtn.addEventListener('click', () => guard(async () => {
      setStatus('还原中…')
      await restore()
      setStatus('已还原', 'ok')
    }))

    // ---- per-layer checklist
    renderMeshList = () => {
      listWrap.textContent = ''
      if (!state.layers.size) {
        listWrap.appendChild(el('div', {
          fontSize: '11px', color: 'rgba(255,255,255,0.35)', lineHeight: '1.5'
        }, '载入工程后在这里勾选要蒙皮的图层'))
        return
      }
      const chosen = selectedNames()
      const meshable = Array.from(state.layers.values()).filter((l) => l.hasImage).length

      const head = el('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '6px', margin: '2px 0 6px'
      })
      head.appendChild(el('span', { fontSize: '11px', color: 'rgba(255,255,255,0.5)' },
        `已选 ${chosen.length} / ${meshable}`))
      const headBtns = el('div', { display: 'flex', gap: '4px' })
      const allBtn = smallButton('全选')
      allBtn.addEventListener('click', () => {
        for (const l of state.layers.values()) if (l.hasImage) l.selected = true
        renderList()
      })
      const noneBtn = smallButton('清空')
      noneBtn.addEventListener('click', () => guard(async () => {
        let dropped = false
        for (const l of state.layers.values()) {
          if (l.mesh) dropped = true
          l.selected = false; l.mesh = null; l.edited = false; l.weights = null; l.weightsEdited = false; l.fromMesh = false
        }
        renderList()
        // only a mesh actually leaving the project is worth a reload
        if (dropped && state.baseSkeleton && state.source) await applyAll()
      }))
      headBtns.appendChild(allBtn); headBtns.appendChild(noneBtn)
      head.appendChild(headBtns)
      listWrap.appendChild(head)

      // Every layer stays listed: the tick means "participates in meshing", not
      // "visible". Hiding the unticked ones left no way to reach a layer at all,
      // since the preview canvas has no layer picking either.
      const visible = Array.from(state.layers.entries())

      const scroll = el('div', { overflowY: 'auto', overflowX: 'hidden' })
      // The list used to be pinned at 260px, so a taller window just left empty
      // space below it. Measure instead, and re-measure whenever the window moves.
      state.fitList = () => {
        if (!scroll.isConnected) return
        const top = scroll.getBoundingClientRect().top
        const room = window.innerHeight - top - 16
        // the weights panel sits below and needs room of its own while it is open
        const share = state.openWeights && document.querySelector(`[${WMARK}="1"]`) ? 0.55 : 1
        scroll.style.maxHeight = Math.max(140, Math.round(room * share)) + 'px'
        if (typeof state.fitWeightList === 'function') state.fitWeightList()
      }
      rowEls.clear()
      for (const [name, layer] of visible) {
        const item = el('div', {
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
          padding: '6px 8px', marginBottom: '4px',
          background: 'rgba(255,255,255,0.03)',
          opacity: layer.hasImage ? '1' : '0.45',
          transition: 'background 90ms linear, border-color 90ms linear'
        })
        item.dataset.autoMeshRow = name
        rowEls.set(name, item)
        if (layer.hasImage) {
          item.addEventListener('mouseenter', () => hoverLayer(name, true))
          item.addEventListener('mouseleave', () => hoverLayer(name, false))
        }
        const top = el('div', { display: 'flex', alignItems: 'center', gap: '6px' })
        const cb = el('input'); cb.type = 'checkbox'
        cb.checked = !!layer.selected
        cb.disabled = !layer.hasImage
        cb.style.accentColor = '#22c98a'
        cb.style.flex = '0 0 auto'
        cb.addEventListener('change', () => guard(() => setSelected(name, cb.checked)))
        const nameEl = el('span', {
          fontSize: '11px', color: 'rgba(255,255,255,0.82)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto'
        }, name + (layer.edited ? ' ·改' : '') + (layer.weights ? (layer.weightsEdited ? ' ·权改' : ' ·权') : ''))
        nameEl.title = layer.hasImage
          ? name + (layer.edited ? '（已手动编辑）' : '') + (layer.weights ? `（${layer.weights.boneIds.length} 根骨${layer.weightsEdited ? ',权重已手工调整' : ',自动权重'}）` : '')
          : name + '（没有同名贴图,无法蒙皮）'
        top.appendChild(cb); top.appendChild(nameEl)
        // the vertex count only exists once there is a mesh; a placeholder dash said nothing
        if (layer.mesh) {
          top.appendChild(el('span', { fontSize: '11px', color: 'rgba(255,255,255,0.5)', flex: '0 0 auto' },
            String(layer.mesh.vertices.length / 2)))
        }
        item.appendChild(top)

        // density + edit only matter once the layer is in play
        if (layer.selected && layer.hasImage) {
          const ctrl = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' })
          const dens = el('input')
          dens.type = 'range'; dens.min = '8'; dens.max = '40'; dens.step = '1'
          dens.value = String(layer.density)
          Object.assign(dens.style, { flex: '1 1 auto', accentColor: '#22c98a', minWidth: '0' })
          dens.title = '该层密度'
          const densVal = el('span', { fontSize: '11px', color: '#22c98a', width: '18px', textAlign: 'right' },
            String(layer.density))
          dens.addEventListener('input', () => { densVal.textContent = dens.value })
          dens.addEventListener('change', () => guard(async () => {
            if (!layer.mesh) { layer.density = Number(dens.value); renderList(); return }
            await regenerateLayer(name, Number(dens.value), (t) => setStatus(t))
            setStatus(`${name} 已重算`, 'ok')
          }))
          const editBtn = smallButton('编辑')
          editBtn.title = layer.mesh ? '手动调整这一层的网格' : '按当前密度生成这一层的网格,然后打开编辑'
          editBtn.addEventListener('click', () => guard(async () => {
            const ok = await editLayer(name, (t) => setStatus(t))
            setStatus(ok ? `${name} 已更新` : '已取消', ok ? 'ok' : undefined)
          }))
          ctrl.appendChild(dens); ctrl.appendChild(densVal); ctrl.appendChild(editBtn)
          item.appendChild(ctrl)
        }
        scroll.appendChild(item)
      }
      listWrap.appendChild(scroll)
      if (hoverName && rowEls.has(hoverName)) paintRow(hoverName, true)
      state.fitList()
    }

    body.appendChild(row)
    body.appendChild(slider)
    body.appendChild(hint)
    body.appendChild(genBtn)
    body.appendChild(restoreBtn)
    body.appendChild(status)
    body.appendChild(listWrap)
    renderList()
    return body
  }

  /**
   * The 自动权重 panel: bind the ticked layers, restore the imported binding, and a
   * list of the same layers showing what each one is bound to, with its 权重 editor.
   */
  function buildWeightsBody() {
    const body = el('div')
    body.className = 'nf-panel-body'
    body.style.padding = '14px'
    // the layout pass stacks the panel's own children too: header first, body 5px under it
    body.style.marginTop = STACK_GAP
    body.style.display = state.openWeights ? 'block' : 'none'

    const weightsBtn = el('button', null, '自动权重'); weightsBtn.type = 'button'; styleButton(weightsBtn, true)
    weightsBtn.title = '给勾选的图层自动分配骨骼并求解权重（需要工程里已有骨骼）;每层的「权重」按钮可以手工细调'
    const restoreWBtn = el('button', null, '还原原始权重'); restoreWBtn.type = 'button'
    styleButton(restoreWBtn, false); restoreWBtn.style.marginTop = STACK_GAP
    restoreWBtn.title = '回到导入时的权重:Spine 里绑好的保留,这里自动或手动加的去掉;网格不动'
    const status = el('div', {
      fontSize: '11px', color: 'rgba(255,255,255,0.55)', margin: STACK_GAP + ' 0 0', minHeight: '15px', lineHeight: '1.5'
    })
    const setStatus = (text, tone) => {
      status.textContent = text || ''
      status.style.color = tone === 'error' ? '#ff8a7a' : (tone === 'ok' ? '#22c98a' : 'rgba(255,255,255,0.55)')
    }
    const listWrap = el('div', { marginTop: STACK_GAP })
    busyButtons.push(weightsBtn, restoreWBtn)
    busyLists.push(listWrap)
    const guard = guardWith(setStatus)

    weightsBtn.addEventListener('click', () => guard(async () => {
      const report = await autoWeights(selectedNames(), (t) => setStatus(t))
      setStatus(`绑定完成 · ${report.bound} 层已加权重`, 'ok')
    }))
    restoreWBtn.addEventListener('click', () => guard(async () => {
      setStatus('还原权重中…')
      const n = await restoreWeights()
      setStatus(n ? `已还原 ${n} 层的权重` : '没有这里加的权重', 'ok')
    }))

    renderWeightList = () => {
      listWrap.textContent = ''
      weightRowEls.clear()
      if (!state.layers.size) {
        listWrap.appendChild(el('div', { fontSize: '11px', color: 'rgba(255,255,255,0.4)' }, '导入工程后,这里列出每一层绑到了哪些骨骼'))
        return
      }
      // the same header as 自动蒙皮: the tick is one and the same choice in both panels
      const usable = Array.from(state.layers.values()).filter((l) => l.hasImage)
      const head = el('div', {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '6px', margin: '2px 0 6px'
      })
      head.appendChild(el('span', { fontSize: '11px', color: 'rgba(255,255,255,0.5)' },
        `已选 ${usable.filter((l) => l.selected).length} / ${usable.length}`))
      const headBtns = el('div', { display: 'flex', gap: '4px' })
      const allBtn = smallButton('全选')
      allBtn.addEventListener('click', () => {
        for (const l of state.layers.values()) if (l.hasImage) l.selected = true
        renderList()
      })
      const noneBtn = smallButton('清空')
      noneBtn.addEventListener('click', () => guard(async () => {
        let dropped = false
        for (const l of state.layers.values()) {
          if (l.mesh) dropped = true
          l.selected = false; l.mesh = null; l.edited = false; l.weights = null; l.weightsEdited = false; l.fromMesh = false
        }
        renderList()
        if (dropped && state.baseSkeleton && state.source) await applyAll()
      }))
      headBtns.appendChild(allBtn); headBtns.appendChild(noneBtn)
      head.appendChild(headBtns)
      listWrap.appendChild(head)
      const scroll = el('div', { overflowY: 'auto', overflowX: 'hidden' })
      state.fitWeightList = () => {
        if (!scroll.isConnected) return
        const top = scroll.getBoundingClientRect().top
        scroll.style.maxHeight = Math.max(120, Math.round(window.innerHeight - top - 16)) + 'px'
      }
      for (const [name, layer] of state.layers) {
        const item = el('div', {
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
          padding: '6px 8px', marginBottom: '4px', background: 'rgba(255,255,255,0.03)',
          opacity: layer.hasImage ? '1' : '0.45',
          transition: 'border-color 90ms linear'
        })
        if (layer.hasImage) {
          item.addEventListener('mouseenter', () => { item.style.borderColor = 'rgba(34,201,138,0.65)'; hoverLayer(name, true) })
          item.addEventListener('mouseleave', () => { item.style.borderColor = 'rgba(255,255,255,0.08)'; hoverLayer(name, false) })
        }
        const top = el('div', { display: 'flex', alignItems: 'center', gap: '6px' })
        const cb = el('input'); cb.type = 'checkbox'
        cb.checked = !!layer.selected
        cb.disabled = !layer.hasImage
        cb.style.accentColor = '#22c98a'
        cb.style.flex = '0 0 auto'
        cb.title = '勾选 = 参与自动权重(和自动蒙皮里的勾选是同一个)'
        cb.addEventListener('change', () => guard(() => setSelected(name, cb.checked)))
        const nameEl = el('span', {
          fontSize: '11px', color: 'rgba(255,255,255,0.82)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto'
        }, name)
        // what it is bound to right now
        const bound = layer.weights ? `${layer.weights.boneIds.length} 骨${layer.weightsEdited ? ' ·改' : ''}` : (layer.mesh ? '未加权重' : '')
        const boundEl = el('span', { fontSize: '11px', color: layer.weights ? '#22c98a' : 'rgba(255,255,255,0.4)', flex: '0 0 auto' }, bound)
        top.appendChild(cb); top.appendChild(nameEl); top.appendChild(boundEl)
        if (layer.selected && layer.hasImage) {
          const weightBtn = smallButton('权重')
          weightBtn.style.marginLeft = '6px'
          weightBtn.title = layer.weights ? '手工调整这一层的骨骼权重（Spine 式刷子）' : '先自动求解这一层的权重,然后打开权重编辑'
          weightBtn.addEventListener('click', () => guard(async () => {
            const ok = await editWeights(name, (t) => setStatus(t))
            setStatus(ok ? `${name} 权重已更新` : '已取消', ok ? 'ok' : undefined)
          }))
          top.appendChild(weightBtn)
        }
        item.appendChild(top)
        weightRowEls.set(name, item)
        scroll.appendChild(item)
      }
      listWrap.appendChild(scroll)
      if (hoverName && weightRowEls.has(hoverName)) paintRow(hoverName, true)
      if (focusName && weightRowEls.has(focusName)) paintRow(focusName, true)
      state.fitWeightList()
    }

    body.appendChild(weightsBtn)
    body.appendChild(restoreWBtn)
    body.appendChild(status)
    body.appendChild(listWrap)
    renderWeightList()
    return body
  }

  // ---------------------------------------------------------- bone rigging ---
  // The editor itself (Spine-style tools over the preview) lives in
  // spine-bones.editor.js; this is its panel: the switch, the tools, the bone tree,
  // 自动架设 and the write-back.
  const bones = {
    ctl: null, editing: false, frozen: null, lastText: null, mechCache: null, treeRow: null, treeToken: 0, treeMaxH: 0,
    setStatus: () => {}, renderTree: () => {}, syncUi: () => {}, focusName: () => {}
  }

  function previewPlayer() {
    const usable = (pl) => (pl && !pl.disposed && pl.skeleton && pl.renderer && pl.renderer.camera && typeof pl.renderer.camera.screenToWorld === 'function' ? pl : null)
    const proxy = window.__NovaFlowSkeletonTimelineOfficialProxy
    // the proxy holds the player the app is showing; the factory hook may remember an
    // older one whose camera no longer matches the canvas (two skeletons on screen)
    return usable(proxy && proxy.player) || usable(livePlayer)
  }
  function previewCanvas() {
    // the player's own canvas first: the camera is fitted to it
    const p = previewPlayer()
    if (p && p.canvas instanceof HTMLCanvasElement && p.canvas.isConnected) return p.canvas
    const marked = document.querySelector(`canvas[${PREVIEW_CANVAS_MARK}="1"]`)
    const ours = (c) => c.hasAttribute('data-novaflow-bones-editor-overlay') || c.hasAttribute('data-novaflow-auto-mesh-pick-overlay')
    if (marked instanceof HTMLCanvasElement && !ours(marked)) return marked
    const stage = document.querySelector('[data-novaflow-skeleton-preview-stage="1"]')
    if (!stage) return null
    return Array.from(stage.querySelectorAll('canvas')).find((c) => !ours(c) && c.width > 40 && c.height > 40) || null
  }
  /** World → preview canvas pixels; the camera is orthographic, three probes pin it down. */
  function bonesToScreen() {
    const p = previewPlayer(), canvas = previewCanvas()
    if (!p || !canvas) return null
    const Vector3 = (p.spine && p.spine.Vector3) || (p.webgl && p.webgl.Vector3)
    if (!Vector3) return null
    const camera = p.renderer.camera, width = canvas.width, height = canvas.height
    const at = (sx, sy) => { const v = camera.screenToWorld(new Vector3(sx, sy, 0), width, height); return [Number(v.x), Number(v.y)] }
    const o = at(0, 0), px = at(width, 0), py = at(0, height)
    if (![...o, ...px, ...py].every(Number.isFinite)) return null
    const a = (px[0] - o[0]) / width, b = (px[1] - o[1]) / width, c = (py[0] - o[0]) / height, d = (py[1] - o[1]) / height
    const det = a * d - b * c
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det
    return [ia, ib, ic, id, -(ia * o[0] + ic * o[1]), -(ib * o[0] + id * o[1])]
  }
  /** Hold the preview at the setup pose while the rig is edited: the bones are drawn over the setup artwork. */
  /** Draw the pose we just set NOW: the app repaints on its own frame, and until it does
   * the artwork is one pose behind the bones drawn over it. */
  function repaintPreview(p) {
    try { if (p && typeof p.renderCurrentPose === 'function') p.renderCurrentPose() } catch { /* mid-rebuild */ }
  }
  function freezePreview() {
    const p = previewPlayer()
    if (!p || !p.animationState || (bones.frozen && bones.frozen.player === p)) return
    const st = p.animationState
    const tr = st.tracks && st.tracks[0]
    bones.frozen = { player: p, timeScale: st.timeScale, anim: tr && tr.animation ? tr.animation.name : null, loop: tr ? !!tr.loop : false, time: tr ? tr.trackTime : 0 }
    try { st.timeScale = 0; st.clearTracks(); p.skeleton.setToSetupPose(); p.skeleton.updateWorldTransform() } catch { /* the preview may be mid-rebuild */ }
    repaintPreview(p)
    hideAppBones(p)
  }
  /**
   * The app draws its own bones (显示骨骼) from the LOADED project. While the rig is
   * edited only the editor's skeleton may show — the app's copy cannot follow an edit,
   * so the two would split apart on the first drag. The player's setter is wrapped so
   * the app's own toggling (and the facade re-applying it after a reload) is remembered
   * and put back when editing ends.
   */
  /**
   * The app draws bones as thin lines with dots; the rigging overlay draws Spine-style
   * bones with a colour per role. Two pictures for one skeleton is confusing, so 显示骨骼
   * is taken over: the app's own drawing stays off and our overlay renders it (following
   * the running animation frame by frame), whether or not 编辑骨骼 is on.
   */
  function syncBonePreview() {
    const ctl = bones.ctl
    if (!ctl) return   // the editor is not up: leave the app's own drawing alone
    const p = previewPlayer()
    if (p) hideAppBones(p)
    ctl.setPreview(!bones.editing && !!bones.appBonesWant && !!p)
  }
  function hideAppBones(p) {
    if (!p || typeof p.setDebugOverlays !== 'function' || p.__nfBonesHidden) return
    const original = p.setDebugOverlays
    // a player made by a reload starts with no overlay setting at all ({}): the app's
    // toggle is still on but nothing re-applies it, so the intent carries over from
    // the player before it and the bones come back when editing ends
    const explicit = !!p.debugOverlays && Object.prototype.hasOwnProperty.call(p.debugOverlays, 'bones')
    const hidden = { original, own: Object.prototype.hasOwnProperty.call(p, 'setDebugOverlays'), want: explicit ? !!p.debugOverlays.bones : !!bones.appBonesWant }
    bones.appBonesWant = hidden.want
    p.__nfBonesHidden = hidden
    p.setDebugOverlays = function (overlays) {
      hidden.want = !!(overlays && overlays.bones)
      bones.appBonesWant = hidden.want
      const res = original.call(this, Object.assign({}, overlays || {}, { bones: false }))
      window.setTimeout(syncBonePreview, 0)
      return res
    }
    if (hidden.want) { try { original.call(p, Object.assign({}, p.debugOverlays, { bones: false })) } catch { /* mid-rebuild */ } }
  }
  function showAppBones(p, force) {
    const hidden = p && p.__nfBonesHidden
    if (!hidden || !force) return
    delete p.__nfBonesHidden
    if (hidden.own) p.setDebugOverlays = hidden.original; else delete p.setDebugOverlays
    if (p.disposed) return
    try { hidden.original.call(p, Object.assign({}, p.debugOverlays, { bones: hidden.want })) } catch { /* the preview may be gone */ }
  }
  /**
   * While the rig is edited the preview must stay at the setup pose: the app's playbar
   * (or its timeline proxy after a reload) restarts the animation on its own, and then
   * the app's bones animate away from the editor's — two skeletons on screen.
   */
  function holdFrozen() {
    const p = previewPlayer()
    if (!p || !p.animationState) return
    if (!bones.frozen || bones.frozen.player !== p) { freezePreview(); return }
    const st = p.animationState
    const playing = st.timeScale !== 0 || (st.tracks && st.tracks.some(Boolean))
    if (!playing) return
    try { st.timeScale = 0; st.clearTracks(); p.skeleton.setToSetupPose(); p.skeleton.updateWorldTransform() } catch { /* mid-rebuild */ }
    repaintPreview(p)
  }
  function thawPreview() {
    const f = bones.frozen
    bones.frozen = null
    if (!f) return
    const p = f.player
    showAppBones(p)   // only forced when the section is left; the overlay keeps drawing
    if (!p || p.disposed || !p.animationState) return
    try {
      if (f.anim) { const e = p.animationState.setAnimation(0, f.anim, f.loop); if (e) e.trackTime = f.time }
      p.animationState.timeScale = f.timeScale
      p.animationState.apply(p.skeleton); p.skeleton.updateWorldTransform()
      repaintPreview(p)
    } catch { /* the preview may be gone */ }
    window.setTimeout(syncBonePreview, 0)
  }
  function ensureController() {
    if (bones.ctl) return bones.ctl
    const E = window.NovaFlowBonesEditor
    if (!E) throw new Error('骨骼编辑器未加载')
    bones.ctl = E.createController({
      getCanvas: previewCanvas,
      getToScreen: bonesToScreen,
      getSkeleton: () => { const s = importedSource(); return s ? JSON.parse(s.skeleton.text) : null },
      // the pose the runtime shows for the working copy (constraints applied): an IK target
      // dragged in the editor pulls its chain on screen exactly as it will in the app
      liveWorld: () => {
        const p = previewPlayer()
        const skeleton = p && p.skeleton
        if (!skeleton || !Array.isArray(skeleton.bones)) return null
        const out = new Map()
        for (const b of skeleton.bones) out.set(b.data ? b.data.name : b.name, { a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY })
        return out
      },
      poseWorld: (skel) => {
        const p = previewPlayer(), AW = window.NovaFlowAutoWeights
        if (!p || !p.spine || !AW) return null
        // bones + constraints are all the pose needs; slots/skins only matter for path constraints
        const hasPath = Array.isArray(skel.path) && skel.path.length > 0
        const bare = { skeleton: skel.skeleton, bones: skel.bones, ik: skel.ik || [], transform: skel.transform || [], path: skel.path || [], slots: hasPath ? skel.slots : [], skins: hasPath ? skel.skins : [], animations: {} }
        return AW.matricesFromRuntime(p.spine, bare)
      },
      isMechanism: (i, skel) => {
        const AW = window.NovaFlowAutoWeights
        if (!AW || !skel || i === 0) return false
        try {
          if (!bones.mechCache || bones.mechCache.skel !== skel) bones.mechCache = { skel, set: AW.mechanismBones(skel) }
          return bones.mechCache.set.has(i)
        } catch { return false }
      },
      onSelect: (i, opts) => {
        bones.syncUi()
        const list = bones.ctl ? bones.ctl.peekBones() : []
        const name = i >= 0 && list[i] ? list[i].name : null
        // Ctrl-clicking a bone in the preview builds the same multi-selection as the tree
        if (!name) { hier.bones.clear(); hier.boneAnchor = null } else if (opts && opts.additive) {
          hier.bones.add(name)
          hier.boneAnchor = name
        } else if (!hier.bones.has(name) || hier.bones.size > 1) { hier.bones = new Set([name]); hier.boneAnchor = name }
        if (bones.ctl && typeof bones.ctl.setPicked === 'function') bones.ctl.setPicked([...hier.bones])
        pushBonePicks()
        renderHierarchy(true)
        revealInTree(name)
        syncAppSelection(name)
      },
      onPickParent: (on) => {
        bones.setStatus(on ? '点一根骨作为新的父骨(Esc 取消)' : '', on ? 'ok' : '')
        tuneSkeletonSidebar()
      },
      onFrame: () => { if (bones.editing) holdFrozen() },
      onChange: () => { bones.renderTree(); bones.syncUi(); renderHierarchy(true) },
      onTool: () => bones.syncUi(),
      // no auto-focus on the name field: the next drag continues the chain, and a focused
      // input would swallow the tool shortcuts (rename from the 名称 field when you want to)
      onCreate: () => { bones.renderTree(); bones.syncUi(); renderHierarchy(true) }
    })
    return bones.ctl
  }
  /**
   * The app's own bone tree (right sidebar) doubles as the re-parent target: with 编辑骨骼 on,
   * drag one row onto another and the dragged bone hangs under it. Rows are the app's DOM, so
   * we only listen — the bone is identified by the row's text, and a plain click still selects
   * the way the app intends (we claim the gesture only once the pointer has actually moved).
   */
  // ------------------------------------------------- the project hierarchy ---
  /**
   * One tree for the whole project, the way Spine shows it: 骨架 / 约束 / 皮肤 / 动画 / 图层
   * under the project's name, each group collapsible and closed until it is opened. It
   * replaces the app's three fixed blocks (a bone tree with a capped height plus skin and
   * animation lists that ate the rest), and it reads the EDITOR's working copy, so bones
   * drawn in this session are in it before they are written back.
   */
  const HIER_MARK = 'data-novaflow-bones-hierarchy'
  /**
   * The app paints its own sidebar blocks as soon as the section mounts, so waiting for a
   * tick to hide them showed the old layout for a frame or two. This rule is installed
   * when the script loads: the app's blocks never paint, ours (tagged HIER_MARK, which the
   * app also labels as one of its sections) always does.
   */
  function installSidebarStyle() {
    if (!document.head || document.getElementById('novaflow-bones-sidebar-style')) return
    const style = document.createElement('style')
    style.id = 'novaflow-bones-sidebar-style'
    // parked off-screen, NOT display:none: the app strips its own data markers off a
    // block it considers hidden, and then its bone rows can no longer be clicked — which
    // is how the app's 当前选择骨骼 is set for everything else it does.
    style.textContent = '[data-novaflow-skeleton-sidebar-body="1"] > [data-novaflow-skeleton-sidebar-section="1"]:not([' + HIER_MARK + '])'
      + '{position:absolute !important;left:-10000px !important;top:0 !important;width:240px !important;max-height:300px !important;overflow:hidden !important;opacity:0 !important;pointer-events:none !important}'
    document.head.appendChild(style)
  }
  installSidebarStyle()
  const BONE_ROW_SEL = '[data-nf-hier-bone]'
  const APP_SECTION_SEL = '[data-novaflow-skeleton-sidebar-section="1"]'
  const hier = { box: null, scroll: null, open: new Set(), rows: new Map(), sig: '', selected: null, layer: null, pick: new Set(), anchor: null, appToken: 0, bones: new Set(), boneAnchor: null }
  const orderDrag = { on: false, id: -1, over: null, before: null, moved: false }
  const treeDrag = { from: null, name: '', over: null, moved: false, id: -1 }
  const rowName = (row) => String(row && row.dataset && row.dataset.nfHierBone || '')
  const treeRowFor = (name) => (name && hier.rows.get('b:' + name)) || null
  /** Scroll `row` into `box` and nothing else (see scrollRowIntoView); sideways too, to its name. */
  function scrollIntoBox(row, box) {
    if (!row || !box) return
    const rr = row.getBoundingClientRect(), br = box.getBoundingClientRect()
    if (rr.top < br.top) box.scrollTop -= br.top - rr.top
    else if (rr.bottom > br.bottom) box.scrollTop += rr.bottom - br.bottom
    const label = row.querySelector('[data-nf-hier-label]')
    const lr = label ? label.getBoundingClientRect() : rr
    if (lr.right > br.right) box.scrollLeft += lr.right - br.right + 6
    if (lr.left < br.left) box.scrollLeft -= br.left - lr.left + 6
  }
  const hierApp = (sel) => Array.from(document.querySelectorAll(sel))
  function appSectionByTitle(text) {
    return hierApp(APP_SECTION_SEL).find((sec) => String((sec.querySelector('[data-novaflow-skeleton-sidebar-title="1"]') || {}).textContent || '').replace(/\s+/g, '').startsWith(text)) || null
  }
  /**
   * Skins and animations are listed from the project itself (the app strips its own item
   * markers off a hidden block, so its DOM cannot be the source of truth); switching one
   * is still the app's job, so the row clicks its button, found by name inside that block.
   */
  function appButton(title, name) {
    const sec = appSectionByTitle(title)
    if (!sec) return null
    const byData = sec.querySelector(`[data-novaflow-spine-animation-name="${name}"]`)
    if (byData) return byData
    return Array.from(sec.querySelectorAll('button')).find((b) => String(b.textContent || '').replace(/\s+/g, ' ').trim() === name) || null
  }
  function activeSkinName() {
    const p = previewPlayer()
    const skin = p && p.skeleton && p.skeleton.skin
    const proxy = window.__NovaFlowSkeletonTimelineOfficialProxy
    return (skin && skin.name) || (proxy && proxy.skinName) || 'default'
  }
  function activeAnimationName() {
    const p = previewPlayer()
    const track = p && p.animationState && p.animationState.tracks && p.animationState.tracks[0]
    const proxy = window.__NovaFlowSkeletonTimelineOfficialProxy
    return (track && track.animation && track.animation.name) || (proxy && proxy.animationName) || ''
  }
  function hierProjectName() {
    const src = importedSource()
    const file = src && src.skeleton && src.skeleton.fileName
    return file ? String(file).replace(/\.(json|skel)$/i, '') : '未导入工程'
  }
  /** Everything the tree draws, flattened to the rows that are actually visible. */
  function hierModel() {
    const ctl = bones.ctl
    const live = ctl && typeof ctl.peek === 'function' ? ctl.peek() : null
    // with nothing imported the tree is the same tree, every group empty and closed
    const skel = live && Array.isArray(live.bones) ? live : { bones: [], slots: [], skins: [], animations: {} }
    const rows = []
    const list = skel.bones
    const kidsOf = new Map()
    list.forEach((b, i) => {
      const key = b.parent === undefined || b.parent === null ? '' : b.parent
      if (!kidsOf.has(key)) kidsOf.set(key, [])
      kidsOf.get(key).push(i)
    })
    // a bone's slots are part of the skeleton tree (Spine shows them under the bone);
    // the same rows appear in 绘制顺序, which is the order they are drawn in
    const allSlots = Array.isArray(skel.slots) ? skel.slots : []
    const slotsOf = new Map()
    for (const sl of allSlots) {
      if (!slotsOf.has(sl.bone)) slotsOf.set(sl.bone, [])
      slotsOf.get(sl.bone).push(sl)
    }
    const layerNote = (name) => {
      const layer = state.layers.get(name)
      if (!layer) return ''
      return layer.mesh ? (layer.weights ? '网格 · 权重' : '网格') : (layer.selected ? '已勾选' : '')
    }
    const group = (key, label, count, depth) => {
      const open = hier.open.has(key)
      rows.push({ key, depth, label, count, open, group: true })
      return open
    }
    rows.push({ key: 'project', depth: 0, label: hierProjectName(), group: true, open: true, fixed: true })
    if (group('g:bones', '骨架', list.length, 1)) {
      const walk = (i, depth) => {
        const b = list[i]
        const kids = kidsOf.get(b.name) || []
        const mine = slotsOf.get(b.name) || []
        const key = 'b:' + b.name
        const open = hier.open.has(key)
        rows.push({ key, depth, label: b.name, bone: i, group: kids.length > 0 || mine.length > 0, open, role: ctl && typeof ctl.roleOf === 'function' ? ctl.roleOf(i) : 'bone' })
        if (!open) return
        for (const sl of mine) {
          const layer = state.layers.get(sl.name)
          rows.push({ key: 'bs:' + sl.name, depth: depth + 1, label: sl.name, layer: sl.name, slot: true, note: layerNote(sl.name), active: !!(layer && layer.selected), picked: hier.pick.has(sl.name) })
        }
        for (const k of kids) walk(k, depth + 1)
      }
      for (const i of (kidsOf.get('') || [])) walk(i, 2)
    }
    const cons = []
    for (const [kind, label] of [['ik', 'IK'], ['transform', '变换'], ['path', '路径']]) {
      for (const c of (Array.isArray(skel[kind]) ? skel[kind] : [])) cons.push({ name: c.name, target: c.target, kind: label })
    }
    if (group('g:cons', '约束', cons.length, 1)) {
      for (const c of cons) rows.push({ key: 'c:' + c.kind + ':' + c.name, depth: 2, label: `${c.name}`, note: `${c.kind} → ${c.target}`, target: c.target })
    }
    const skins = Array.isArray(skel.skins) ? skel.skins.map((x) => x && x.name).filter(Boolean) : Object.keys(skel.skins || {})
    const skinNow = activeSkinName()
    if (group('g:skins', '皮肤', skins.length, 1)) {
      for (const name of skins) rows.push({ key: 's:' + name, depth: 2, label: name, pick: ['皮肤', name], active: name === skinNow })
    }
    const anims = Object.keys(skel.animations || {})
    const animNow = activeAnimationName()
    if (group('g:anims', '动画', anims.length, 1)) {
      for (const name of anims) rows.push({ key: 'a:' + name, depth: 2, label: name, pick: ['动画', name], active: name === animNow })
    }
    const slots = Array.isArray(skel.slots) ? skel.slots : []
    if (group('g:order', '绘制顺序', slots.length, 1)) {
      if (slots.length) rows.push({ key: 'l-hint', depth: 2, label: '拖动 · Ctrl/Shift 多选 · +/- 移动', fixed: true, hint: true })
      // the last slot is drawn on top, so the list reads top-down like the artwork
      for (let i = slots.length - 1; i >= 0; i--) {
        const sl = slots[i]
        const layer = state.layers.get(sl.name)
        const note = layer ? (layer.mesh ? (layer.weights ? '网格 · 权重' : '网格') : (layer.selected ? '已勾选' : '')) : ''
        rows.push({ key: 'l:' + sl.name, depth: 2, label: sl.name, note: note || sl.bone, layer: sl.name, boneName: sl.bone, active: !!(layer && layer.selected), picked: hier.pick.has(sl.name) })
      }
    }
    return rows
  }
  function hierSignature(rows) {
    const ctl = bones.ctl
    const st = ctl ? ctl.getState() : null
    return rows.map((r) => `${r.key}|${r.open ? 1 : 0}|${r.active ? 1 : 0}|${r.picked ? 1 : 0}|${r.bone !== undefined && hier.bones.has(r.label) ? 1 : 0}|${r.count || ''}|${r.role || ''}|${r.note || ''}`).join(';') + '#' + (st ? st.bones : 0)
  }
  function ensureHierarchy() {
    const body = document.querySelector('[data-novaflow-skeleton-sidebar-body="1"]')
    if (!body) return null
    // the tree is there whether or not the rig is being edited, so its pointer and key
    // handlers are bound with it (not from 编辑骨骼, which used to leave 绘制顺序 inert)
    bindTreeDrag()
    // the app's own blocks stay in the DOM (their buttons are what skins / animations click)
    installSidebarStyle()
    for (const sec of hierApp(APP_SECTION_SEL)) {
      if (!sec.hasAttribute(HIER_MARK)) continue
      if (sec.style.display !== 'flex') sec.style.setProperty('display', 'flex', 'important')
    }
    let box = body.querySelector(`[${HIER_MARK}="1"]`)
    if (!box) {
      box = el('div', { display: 'flex', flexDirection: 'column', minHeight: '0', gap: '6px' })
      box.setAttribute(HIER_MARK, '1')
      const title = el('div', { fontSize: '12px', fontWeight: '600', color: 'rgba(255,255,255,0.86)' }, '工程')
      // a deep chain outgrows the sidebar: the rows keep their indent and the box scrolls sideways
      const scroll = el('div', { overflowY: 'auto', overflowX: 'auto', minHeight: '0', display: 'grid', gap: '1px', alignContent: 'start' })
      scroll.setAttribute('data-nf-hier-scroll', '1')
      box.appendChild(title); box.appendChild(scroll)
      body.insertBefore(box, body.firstChild)
      hier.scroll = scroll
      hier.sig = ''
    }
    hier.box = box
    hier.scroll = box.querySelector('[data-nf-hier-scroll="1"]')
    return box
  }
  function renderHierarchy(force) {
    if (!ensureHierarchy() || !hier.scroll) return
    const rows = hierModel()
    const sig = hierSignature(rows)
    if (!force && sig === hier.sig) { paintHierSelection(); return }
    hier.sig = sig
    hier.rows.clear()
    const frag = document.createDocumentFragment()
    const ctl = bones.ctl
    for (const r of rows) {
      const picked = !!(r.picked || (r.bone !== undefined && hier.bones.has(r.label)))
      const row = el('div', {
        display: 'flex', alignItems: 'center', gap: '6px', height: '22px', flex: '0 0 auto',
        // as wide as its deepest row, never narrower than the box: the sidebar keeps its
        // size and a long chain scrolls sideways instead of losing its indent
        width: 'max-content', minWidth: '100%', boxSizing: 'border-box',
        paddingLeft: (r.depth * 16) + 'px', paddingRight: '6px', borderRadius: '5px',
        cursor: r.fixed ? 'default' : 'pointer', border: '1px solid transparent',
        color: r.hint ? 'rgba(255,255,255,0.45)' : 'inherit'
      })
      row.dataset.nfHierKey = r.key
      // depth / state / fixed / active: the brand runtime's spec owns the row's paint and
      // reads these (its inline !important used to flatten every row to one look)
      row.dataset.nfHierDepth = String(r.depth)
      if (r.fixed) row.dataset.nfHierFixed = '1'
      if (r.active) row.dataset.nfHierActive = '1'
      if (r.layer) row.dataset.nfHierLayer = r.layer
      setHierRowState(row, picked ? 'picked' : '')
      const expandable = !!r.group && !r.fixed
      const chev = el('i', { width: '12px', fontSize: '9px', opacity: expandable ? '0.75' : '0', flex: '0 0 auto', textAlign: 'center', cursor: expandable ? 'pointer' : 'default' })
      chev.className = `fas fa-chevron-${r.open ? 'down' : 'right'}`
      // Spine's split: the arrow folds, the name selects (a bone with children does both)
      if (expandable) chev.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggleHierKey(r.key) })
      row.appendChild(chev)
      if (r.slot) { const g = el('i', { width: '10px', fontSize: '9px', color: 'rgba(143,211,255,0.75)', flex: '0 0 auto', textAlign: 'center' }); g.className = 'fas fa-layer-group'; row.appendChild(g) }
      if (r.bone !== undefined) {
        row.dataset.nfHierBone = r.label
        const roles = (window.NovaFlowBonesEditor || {}).ROLE_COLORS || {}
        const color = (roles[r.role] && roles[r.role].line) || '#8fd3ff'
        row.appendChild(el('span', { width: '8px', height: '8px', borderRadius: '2px', background: color, flex: '0 0 auto' }))
      }
      const label = el('span', { fontSize: '11px', color: r.active ? '#7ce8b5' : 'rgba(255,255,255,0.88)', fontWeight: r.group && r.depth <= 1 ? '600' : '400', flex: '0 0 auto', whiteSpace: 'nowrap' }, r.label)
      label.dataset.nfHierLabel = '1'
      row.appendChild(label)
      if (r.count !== undefined) { const c = el('span', { fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginLeft: 'auto', flex: '0 0 auto' }, String(r.count)); c.dataset.nfHierTrail = '1'; row.appendChild(c) }
      if (r.note) { const nt = el('span', { fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginLeft: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap' }, r.note); nt.dataset.nfHierTrail = '1'; row.appendChild(nt) }
      row.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation()
        if (r.pick) {
          const btn = appButton(r.pick[0], r.pick[1])
          if (btn) { try { btn.click() } catch { /* the app re-rendered it away */ } } else bones.setStatus(`${r.pick[1]} 切换按钮不在了`, 'error')
          window.setTimeout(() => renderHierarchy(true), 200)
          return
        }
        if (r.layer) { pickLayerRow(r.layer, ev); return }
        const name = r.bone !== undefined ? r.label : r.target || r.boneName
        if (name && ctl) {
          const i = ctl.peekBones().findIndex((b) => b.name === name)
          if (i >= 0) { pickBoneRow(name, i, ev); return }
        }
        if (expandable) toggleHierKey(r.key)
      })
      if (expandable) row.addEventListener('dblclick', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggleHierKey(r.key) })
      hier.rows.set(r.key, row)
      frag.appendChild(row)
    }
    hier.scroll.textContent = ''
    hier.scroll.appendChild(frag)
    paintHierSelection()
    // the rows were rebuilt: put the focused layer's outline back on the new ones
    if (hier.layer) { const keep = hier.layer; hier.layer = null; paintHierLayer(keep) }
  }
  function toggleHierKey(key) {
    if (hier.open.has(key)) hier.open.delete(key); else hier.open.add(key)
    renderHierarchy(true)
  }
  /**
   * The draw order mirrors what the preview points at: hovering a layer marks its row,
   * clicking one (here or on the art) ticks the layer and brings the row into view. It
   * never opens an editor — 生成网格 / 编辑 / 权重 are the buttons for that.
   */
  function focusLayer(name, activate) {
    if (!name) return
    if (activate) {
      const layer = state.layers.get(name)
      if (layer && !layer.selected) { Promise.resolve(setSelected(name, true)).catch(() => {}) }
    }
    // both lists jump to it, whether it was picked in the tree, on the art or in a list
    try { scrollRowIntoView(rowEls.get(name)); scrollRowIntoView(weightRowEls.get(name)) } catch { /* the list may be collapsed */ }
    focusPaint(name)
    paintHierLayer(name)
  }
  function paintHierLayer(name) {
    for (const prefix of ['l:', 'bs:']) {
      const prev = hier.layer && hier.rows.get(prefix + hier.layer)
      if (prev) prev.style.outline = ''
    }
    hier.layer = name || null
    // a selected row already has the solid green frame; the dashed outline is only for
    // pointing at a row that is NOT selected (hovering the art, say)
    const selected = !!name && hier.pick.has(name)
    let first = null
    for (const prefix of ['l:', 'bs:']) {
      const row = name && hier.rows.get(prefix + name)
      if (!row) continue
      row.style.outline = selected ? '' : '1px dashed rgba(34,201,138,0.8)'
      if (!first) first = row
    }
    if (first) scrollIntoBox(first, hier.scroll)
  }
  /**
   * Bones select like a file list: a plain click picks one, Ctrl adds or removes, Shift
   * takes the run between the anchor and this row (in the order the tree shows them).
   * The last one clicked stays the EDITED bone; the rest are highlighted alongside it and
   * handed to the app, whose own 已选骨骼 works the same way.
   */
  function boneRowOrder() {
    return Array.from(hier.rows.keys()).filter((k) => k.startsWith('b:')).map((k) => k.slice(2))
  }
  function pickBoneRow(name, index, ev) {
    const ctl = bones.ctl
    if (!ctl) return
    if (ev && (ev.ctrlKey || ev.metaKey)) {
      // Ctrl toggles: a bone taken out of the set hands the edit to the last one left in it
      if (hier.bones.has(name) && hier.bones.size > 1) {
        hier.bones.delete(name)
        name = [...hier.bones].pop()
        index = ctl.peekBones().findIndex((b) => b.name === name)
      } else hier.bones.add(name)
      hier.boneAnchor = name
    } else if (ev && ev.shiftKey && hier.boneAnchor) {
      const list = boneRowOrder()
      const a = list.indexOf(hier.boneAnchor), b = list.indexOf(name)
      if (a >= 0 && b >= 0) hier.bones = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1))
      else hier.bones = new Set([name])
    } else {
      hier.bones = new Set([name])
      hier.boneAnchor = name
    }
    hier.bones.add(name)
    // additive: the editor's onSelect keeps the set built here; a plain select() reported
    // the click as a single pick and collapsed a Ctrl / Shift selection to one bone
    ctl.select(index, { additive: true })
    if (typeof ctl.setPicked === 'function') ctl.setPicked([...hier.bones])
    pushBonePicks()
    bones.syncUi()
    renderHierarchy(true)
  }
  /** The runtime carries the whole set; the app's tree gets the one being edited. */
  function pushBonePicks() {
    const p = previewPlayer()
    if (!p || typeof p.setSelectedBoneNames !== 'function' || hier.bones.size < 2) return
    try { p.setSelectedBoneNames([...hier.bones]) } catch { /* not that kind of player */ }
  }
  /** The draw order as the tree shows it: top of the list is drawn on top. */
  function orderNames() {
    const ctl = bones.ctl
    const skel = ctl && typeof ctl.peek === 'function' ? ctl.peek() : null
    const slots = skel && Array.isArray(skel.slots) ? skel.slots : []
    return slots.map((s) => s.name).reverse()
  }
  /**
   * A layer row selects, it does not tick (user decision 2026-09-21): the first click is
   * a plain selection, clicking the SAME row again ticks it — which is what puts it in
   * 自动蒙皮 / 自动权重 — and a third click unticks it. Ctrl / Shift still build the
   * multi-selection that 绘制顺序 reorders.
   */
  function pickLayerRow(name, ev) {
    const list = orderNames()
    if (ev && (ev.ctrlKey || ev.metaKey)) {
      if (hier.pick.has(name)) hier.pick.delete(name); else hier.pick.add(name)
      hier.anchor = name
    } else if (ev && ev.shiftKey && hier.anchor && list.includes(hier.anchor)) {
      const a = list.indexOf(hier.anchor), b = list.indexOf(name)
      hier.pick = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1))
    } else {
      const again = hier.layer === name && hier.pick.size === 1 && hier.pick.has(name)
      hier.pick = new Set([name])
      hier.anchor = name
      if (again) toggleLayerTick(name)
    }
    focusLayer(name)
    renderHierarchy(true)
  }
  function toggleLayerTick(name) {
    const layer = state.layers.get(name)
    if (!layer) return
    if (!layer.hasImage) { bones.setStatus(`${name} 没有贴图,不能参与蒙皮/权重`, 'error'); return }
    const next = !layer.selected
    Promise.resolve(setSelected(name, next)).catch(() => {})
    bones.setStatus(next ? `${name} 已勾选(参与蒙皮/权重)` : `${name} 已取消勾选`, next ? 'ok' : '')
  }
  /** Move the picked layers one step (+1 up = drawn later / on top, -1 down). */
  function nudgeOrder(dir) {
    const ctl = bones.ctl
    if (!ctl || typeof ctl.setSlotOrder !== 'function' || !hier.pick.size) return false
    const list = orderNames()
    const picked = list.filter((n) => hier.pick.has(n))
    if (!picked.length) return false
    const next = list.slice()
    if (dir > 0) {
      for (let i = 0; i < next.length; i++) {
        if (!hier.pick.has(next[i])) continue
        if (i === 0 || hier.pick.has(next[i - 1])) continue
        const tmp = next[i - 1]; next[i - 1] = next[i]; next[i] = tmp
      }
    } else {
      for (let i = next.length - 1; i >= 0; i--) {
        if (!hier.pick.has(next[i])) continue
        if (i === next.length - 1 || hier.pick.has(next[i + 1])) continue
        const tmp = next[i + 1]; next[i + 1] = next[i]; next[i] = tmp
      }
    }
    return commitOrder(next)
  }
  function commitOrder(displayOrder) {
    const ctl = bones.ctl
    if (!ctl || typeof ctl.setSlotOrder !== 'function') return false
    // the tree shows the topmost layer first; the skeleton stores the opposite
    if (!ctl.setSlotOrder(displayOrder.slice().reverse())) return false
    renderHierarchy(true)
    bones.syncUi()
    bones.setStatus(`绘制顺序已改(${hier.pick.size} 层) · 应用到工程 后生效`, 'ok')
    return true
  }
  /** Drop the picked layers in front of `before` (null = to the bottom of the list). */
  function dropOrder(before) {
    const list = orderNames()
    const picked = list.filter((n) => hier.pick.has(n))
    if (!picked.length) return false
    const rest = list.filter((n) => !hier.pick.has(n))
    let at = before && rest.includes(before) ? rest.indexOf(before) : rest.length
    const next = rest.slice(0, at).concat(picked, rest.slice(at))
    return commitOrder(next)
  }
  const markDrop = (row, on) => { if (row) row.style.boxShadow = on ? 'inset 0 2px 0 0 rgba(34,201,138,0.95)' : '' }
  function endOrderDrag() {
    markDrop(orderDrag.over, false)
    orderDrag.on = false; orderDrag.id = -1; orderDrag.over = null; orderDrag.before = null; orderDrag.moved = false
  }
  function onOrderPointerDown(ev) {
    const row = ev.target instanceof Element ? ev.target.closest('[data-nf-hier-layer]') : null
    if (!row || ev.button !== 0) return
    const name = row.dataset.nfHierLayer
    if (!hier.pick.has(name)) pickLayerRow(name, ev)
    orderDrag.on = true; orderDrag.id = ev.pointerId; orderDrag.moved = false; orderDrag.before = null
  }
  function onOrderPointerMove(ev) {
    if (!orderDrag.on || ev.pointerId !== orderDrag.id) return
    orderDrag.moved = true
    const under = document.elementFromPoint(ev.clientX, ev.clientY)
    const row = under instanceof Element ? under.closest('[data-nf-hier-layer]') : null
    if (row === orderDrag.over) return
    markDrop(orderDrag.over, false)
    orderDrag.over = row || null
    orderDrag.before = row ? row.dataset.nfHierLayer : null
    markDrop(orderDrag.over, true)
  }
  function onOrderPointerUp(ev) {
    if (!orderDrag.on || ev.pointerId !== orderDrag.id) return
    const before = orderDrag.before, moved = orderDrag.moved
    endOrderDrag()
    if (!moved) return
    ev.preventDefault(); ev.stopImmediatePropagation()
    if (before && hier.pick.has(before)) return   // dropped on itself
    dropOrder(before)
  }
  /** + / = raises the picked layers, - / _ lowers them (Spine's draw-order keys). */
  function onOrderKey(ev) {
    if (!hier.pick.size) return
    const t = ev.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    const k = ev.key
    if (k !== '+' && k !== '=' && k !== '-' && k !== '_') return
    ev.preventDefault(); ev.stopImmediatePropagation()
    nudgeOrder(k === '+' || k === '=' ? 1 : -1)
  }
  /** 'selected' (the bone being edited) / 'picked' (the rest of a multi-selection) / ''. */
  function setHierRowState(row, state) {
    if (!row) return
    row.dataset.nfHierState = state
    // the look when the brand runtime is not there to paint it; its spec overrides this
    row.style.background = state ? 'rgba(34,201,138,' + (state === 'selected' ? '0.16' : '0.12') + ')' : ''
    row.style.borderColor = state === 'selected' ? 'rgba(34,201,138,0.9)' : state ? 'rgba(34,201,138,0.5)' : 'transparent'
  }
  /** The edited bone's row: marked, and scrolled into view (the last one clicked is what the tree shows). */
  function paintHierSelection() {
    const ctl = bones.ctl
    const st = ctl ? ctl.getState() : null
    const list = ctl ? ctl.peekBones() : []
    const name = st && st.selected >= 0 && list[st.selected] ? list[st.selected].name : null
    const row = name && hier.rows.get('b:' + name)
    if (name === hier.selected && (!name || (row && row.dataset.nfHierState === 'selected'))) return
    const prev = hier.selected && hier.rows.get('b:' + hier.selected)
    if (prev && prev !== row) setHierRowState(prev, hier.bones.has(hier.selected) ? 'picked' : '')
    hier.selected = name
    if (row) {
      setHierRowState(row, 'selected')
      scrollIntoBox(row, hier.scroll)
      // once more after the brand runtime's pass has sized the rebuilt rows
      window.setTimeout(() => { if (hier.selected === name && row.isConnected) scrollIntoBox(row, hier.scroll) }, 80)
    }
  }
  /**
   * The app keeps its own selected-bone set, and its (now hidden) tree is what sets it —
   * everything the app does with 当前选择骨骼 depends on it. So a selection made here is
   * pushed into that tree: open the ancestors, click the row. `click()` raises no pointer
   * events, so our own handlers cannot loop through it.
   */
  const appBoneRows = () => Array.from(document.querySelectorAll('[data-novaflow-skeleton-bone-row="1"]'))
  const appBoneRow = (name) => appBoneRows().find((r) => String(r.textContent || '').replace(/\s+/g, ' ').trim() === name) || null
  function expandAppAncestor(name) {
    const ctl = bones.ctl
    if (!ctl) return false
    const byName = new Map(ctl.peekBones().map((b) => [b.name, b]))
    const chain = []
    let cur = byName.get(name)
    for (let i = 0; i < 200 && cur && cur.parent && byName.has(cur.parent); i++) { chain.unshift(cur.parent); cur = byName.get(cur.parent) }
    for (let i = chain.length - 1; i >= 0; i--) {
      const row = appBoneRow(chain[i])
      if (!row) continue
      const toggle = row.firstElementChild
      const chevron = toggle && toggle.querySelector('i')
      if (chevron && /chevron-right/.test(String(chevron.className))) { toggle.click(); return true }
      return false
    }
    return false
  }
  async function syncAppSelection(name) {
    const token = ++hier.appToken
    if (!name) return
    const p = previewPlayer()
    const cur = p && Array.isArray(p.selectedBoneNames) ? p.selectedBoneNames : null
    if (cur && cur.length === 1 && cur[0] === name) return
    for (let pass = 0; pass < 8; pass++) {
      if (token !== hier.appToken) return
      const row = appBoneRow(name)
      if (row) {
        try { row.click() } catch { /* re-rendered away */ }
        // that click set the app's selection to this one bone; a multi-selection has to
        // be put back on the runtime afterwards
        if (hier.bones.size > 1) window.setTimeout(pushBonePicks, 60)
        return
      }
      if (!expandAppAncestor(name) && pass > 0) break
      await new Promise((r) => window.setTimeout(r, 120))
    }
    // a bone drawn in this session is not in the project's tree yet; the runtime can still
    // be told, so 当前链条 and the selected-bone overlay follow
    try { if (p && typeof p.setSelectedBoneNames === 'function') p.setSelectedBoneNames(hier.bones.size > 1 ? [...hier.bones] : [name]) } catch { /* not that kind of player */ }
  }

  /** Open every ancestor so the selected bone has a row, then highlight it. */
  function revealInTree(name) {
    if (!name) { paintHierSelection(); return }
    const ctl = bones.ctl
    if (!ctl) return
    const byName = new Map(ctl.peekBones().map((b) => [b.name, b]))
    let cur = byName.get(name), grew = false
    if (!cur) return
    hier.open.add('g:bones')
    for (let i = 0; i < 200 && cur && cur.parent && byName.has(cur.parent); i++) {
      const key = 'b:' + cur.parent
      if (!hier.open.has(key)) { hier.open.add(key); grew = true }
      cur = byName.get(cur.parent)
    }
    renderHierarchy(grew)
  }
  const markRow = (row, on) => { if (row) row.style.outline = on ? '2px solid rgba(34,201,138,0.9)' : '' }
  function endTreeDrag() {
    markRow(treeDrag.from, false); markRow(treeDrag.over, false)
    treeDrag.from = null; treeDrag.over = null; treeDrag.moved = false; treeDrag.id = -1
  }
  function onTreePointerDown(ev) {
    if (!bones.editing || ev.button !== 0) return
    if (ev.target instanceof Element && ev.target.closest('[data-nf-hier-layer]')) return
    const row = ev.target instanceof Element ? ev.target.closest(BONE_ROW_SEL) : null
    if (!row) return
    endTreeDrag()
    treeDrag.from = row; treeDrag.name = rowName(row); treeDrag.id = ev.pointerId
  }
  function onTreePointerMove(ev) {
    if (!treeDrag.from || ev.pointerId !== treeDrag.id) return
    if (!treeDrag.moved) { treeDrag.moved = true; markRow(treeDrag.from, true) }
    const el2 = document.elementFromPoint(ev.clientX, ev.clientY)
    const over = el2 instanceof Element ? el2.closest(BONE_ROW_SEL) : null
    if (over === treeDrag.over) return
    markRow(treeDrag.over, false)
    treeDrag.over = over && over !== treeDrag.from ? over : null
    markRow(treeDrag.over, true)
  }
  function onTreePointerUp(ev) {
    if (!treeDrag.from || ev.pointerId !== treeDrag.id) return
    const child = treeDrag.name, parentRow = treeDrag.over
    const moved = treeDrag.moved
    endTreeDrag()
    if (!moved || !parentRow) return
    ev.preventDefault(); ev.stopImmediatePropagation()
    const parent = rowName(parentRow)
    const ctl = ensureController()
    const names = new Set(ctl.peekBones().map((b) => b.name))
    if (!names.has(child) || !names.has(parent)) { bones.setStatus(`工作副本里找不到 ${names.has(child) ? parent : child}`, 'error'); return }
    if (!ctl.reparentNamed(child, parent)) { bones.setStatus(`${child} 不能挂到 ${parent} 下(不能挂到自己或自己的子骨)`, 'error'); return }
    bones.setStatus(`${child} → 父骨 ${parent}`, 'ok')
    renderHierarchy(true)
    bones.syncUi()
  }
  /**
   * The app's skeleton sidebar, tuned for rigging: its own blocks are replaced by one
   * project hierarchy that fills the whole sidebar (user decision 2026-09-21 — a capped
   * bone tree with fixed skin / animation lists under it runs out of room as soon as a
   * project has more than a couple of each).
   */
  /**
   * Move 导入 PS 工程 into the app's 导入工程 panel: one place for "bring a project in".
   * The app owns that panel, so the button is re-homed whenever it reappears, and it
   * keeps working from wherever it sits (the file picker travels with it).
   */
  /**
   * 导入 PS 工程 belongs with the app's other imports (user decision 2026-09-21). It is
   * built here, not in 自动蒙皮's body, so that it can go into the app's panel in the very
   * frame that panel appears instead of blinking in when the mesh panel mounts.
   */
  /**
   * Import trace, OFF by default: a click that opens nothing looks identical to one that
   * opens a chooser (a page sees no blur, no visibilitychange, and keeps focus), so when
   * the import misbehaves somewhere we cannot reach, turn this on from the console:
   *   window.__NOVAFLOW_IMPORT_DIAG = true   (optionally ...= 'http://127.0.0.1:4799/d')
   * Nothing is sent until it is set.
   */
  function diagOn() {
    if (window.__NOVAFLOW_IMPORT_DIAG) return window.__NOVAFLOW_IMPORT_DIAG
    try { if (/[?&]diag=1/.test(location.search)) return true } catch { /* no location here */ }
    return false
  }
  /** A box in the corner: the trace has to survive being screenshotted, not just logged. */
  function diagBox() {
    let box = document.getElementById('novaflow-import-diag')
    if (box) return box
    box = el('div', {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '2147483647', maxWidth: '380px',
      maxHeight: '220px', overflow: 'auto', background: 'rgba(0,0,0,0.82)', color: '#9fe8a0',
      font: '11px/1.5 Consolas, monospace', padding: '6px 8px', borderRadius: '6px',
      border: '1px solid rgba(126,231,135,0.5)', whiteSpace: 'pre-wrap', pointerEvents: 'none'
    })
    box.id = 'novaflow-import-diag'
    document.body.appendChild(box)
    return box
  }
  function diag(stage, info) {
    const on = diagOn()
    if (!on) return
    const line = stage + ' ' + Object.entries(info || {}).map(([k, v]) => k + '=' + String(v)).join(' ')
    try {
      const box = diagBox()
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0')
      box.textContent = (box.textContent ? box.textContent + '\n' : '') + hh + '  ' + line
      box.scrollTop = box.scrollHeight
    } catch { /* the box is optional */ }
    try {
      const url = typeof on === 'string' ? on : 'http://127.0.0.1:4799/d'
      const q = Object.entries(info || {}).map(([k, v]) => k + '=' + encodeURIComponent(String(v))).join('&')
      new Image().src = url + '?stage=' + encodeURIComponent(stage) + (q ? '&' + q : '') + '&t=' + Date.now()
    } catch { /* the sink is optional */ }
  }
  function panelBuild() {
    try {
      const tag = document.querySelector('script[src*="spine-auto-mesh.panel.js"]')
      const m = tag && /[?&]v=([^"&]+)/.exec(tag.getAttribute('src') || '')
      return m ? m[1] : 'unknown'
    } catch { return 'unknown' }
  }
  /** Who would actually receive a click on each import button, and why it is not the button. */
  function diagHitTest() {
    try {
      const panels = Array.from(document.querySelectorAll('.nf-panel')).filter((p) => {
        const head = p.querySelector('.nf-panel-header')
        return head && String(head.textContent || '').replace(/\s+/g, '').startsWith('导入工程')
      })
      // more than one means the app mounted twice and half the UI on screen is dead
      diag('hit', { panels: panels.length, roots: document.querySelectorAll('.nf-panel').length })
      const panel = panels[0]
      const body = panel && panel.querySelector('.nf-panel-body')
      if (!body) { diag('hit', { panel: 'not found' }); return }
      if (window.getComputedStyle(body).display === 'none') { diag('hit', { panel: '未展开' }); return }
      const describe = (e) => {
        if (!e) return 'null'
        const st = window.getComputedStyle(e)
        const cls = typeof e.className === 'string' && e.className ? '.' + e.className.split(' ').filter(Boolean)[0] : ''
        return e.tagName + (e.id ? '#' + e.id : '') + cls + '/' + st.position + '/z' + st.zIndex + '/pe' + st.pointerEvents
      }
      const buttons = Array.from(body.querySelectorAll('button')).slice(0, 8)
      for (const btn of buttons) {
        const r = btn.getBoundingClientRect()
        if (!r.width || !r.height) { diag('hit', { b: (btn.textContent || '').trim().slice(0, 8), rect: '0x0' }); continue }
        const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
        const mine = top === btn || btn.contains(top)
        diag('hit', { b: (btn.textContent || '').trim().slice(0, 8), ok: mine, top: mine ? 'self' : describe(top) })
      }
    } catch (err) {
      diag('hit', { error: String((err && err.message) || err).slice(0, 50) })
    }
  }
  function diagEnv() {
    const api0 = window.electronAPI
    diag('boot', {
      build: panelBuild(),
      href: String(location.href).slice(-42),
      api: typeof api0,
      ps: api0 ? typeof api0.openPhotoshopProject : 'none',
      keys: api0 ? Object.keys(api0).length : 0,
      ua: navigator.userAgent.includes('Electron') ? 'electron' : 'browser'
    })
  }
  try {
    // Ctrl+Alt+D turns the trace on anywhere, including the desktop app where no URL can be typed
    window.addEventListener('keydown', (ev) => {
      if (!ev.ctrlKey || !ev.altKey || String(ev.key).toLowerCase() !== 'd') return
      window.__NOVAFLOW_IMPORT_DIAG = !window.__NOVAFLOW_IMPORT_DIAG
      if (window.__NOVAFLOW_IMPORT_DIAG) { diagEnv(); diagHitTest() }
      else { const box = document.getElementById('novaflow-import-diag'); if (box) box.remove() }
    }, true)
    if (diagOn()) setTimeout(() => { diagEnv(); diagHitTest() }, 1200)
    document.addEventListener('click', (ev) => {
      if (!diagOn()) return
      const b = ev.target && ev.target.closest ? ev.target.closest('button') : null
      const t = b ? (b.textContent || '').trim().slice(0, 16) : ''
      if (t && /导入|清空|开始/.test(t)) { diag('anyclick', { t, trusted: ev.isTrusted }); return }
      // a click that lands anywhere else still proves the page receives clicks at all
      const el2 = ev.target
      const tag = el2 && el2.tagName ? el2.tagName + (el2.id ? '#' + el2.id : '') : String(el2)
      diag('click', { on: b ? 'button:' + t : tag, at: Math.round(ev.clientX) + ',' + Math.round(ev.clientY), trusted: ev.isTrusted })
    }, true)
  } catch { /* diagnostics never break the panel */ }

  function ensurePsImport() {
    if (state.psImport) return state.psImport
    const button = el('button', null, '导入PS工程')
    button.type = 'button'
    styleButton(button, false)
    button.title = 'PhotoshopToSpine 导出的文件夹可以直接用,不需要先过一遍 Spine;也可以直接把那个文件夹拖到这个按钮上'
    // the panel this button lives in is the app's 导入工程; the status line it used to write to
    // sits inside 自动蒙皮, which is collapsed on entry — so a click looked like nothing happened
    const psStatus = el('div', {
      display: 'none', marginTop: '6px', fontSize: '11px', lineHeight: '1.5',
      color: 'rgba(255,255,255,0.72)', wordBreak: 'break-word', overflowWrap: 'anywhere'
    })
    const showHere = (text, tone) => {
      if (!text) { psStatus.style.display = 'none'; psStatus.textContent = ''; return }
      psStatus.style.display = 'block'
      psStatus.textContent = text
      psStatus.style.color = tone === 'err' ? '#ff8f8f' : tone === 'ok' ? '#7ee787' : 'rgba(255,255,255,0.72)'
    }
    const sayHere = (text, tone) => { setStatusFn(text, tone); showHere(text, tone) }
    // parked off-screen rather than display:none: a hidden input still opens the dialog,
    // but a rendered one does it in every embedder we have seen
    const picker = el('input', { position: 'fixed', left: '-10000px', top: '0', width: '1px', height: '1px', opacity: '0' })
    picker.type = 'file'
    picker.multiple = true
    try { picker.webkitdirectory = true } catch { /* plain multi-select instead */ }
    picker.setAttribute('webkitdirectory', '')
    picker.setAttribute('directory', '')
    const openPicker = (say) => {
      // the browser's own folder picker, and the only route when there is no IPC
      if (!picker.isConnected) document.body.appendChild(picker)
      say('已打开文件夹选择框;没弹出来就把文件夹直接拖到这个按钮上')
      diag('pickerclick', { display: (window.getComputedStyle(picker) || {}).display })
      picker.click()
    }
    button.addEventListener('click', () => {
      diagEnv()
      diag('psclick', { busy: state.busy, api: typeof window.electronAPI, ps: window.electronAPI ? typeof window.electronAPI.openPhotoshopProject : 'none', connected: picker.isConnected })
      if (state.busy) return
      const say = sayHere
      // the desktop app opens folders through Electron's dialog (its own 导入 buttons do the
      // same); an <input webkitdirectory> only works in a plain browser
      const api = window.electronAPI
      if (api && typeof api.openPhotoshopProject === 'function') {
        guardWith(say)(async () => {
          say('选择 PhotoshopToSpine 导出的文件夹…')
          let res = null
          diag('ipcstart', {})
          try {
            res = await api.openPhotoshopProject()
            diag('ipcdone', { canceled: res && res.canceled, files: res && res.files ? res.files.length : -1, error: res && res.error ? String(res.error).slice(0, 40) : '' })
          } catch (err) {
            diag('ipcreject', { msg: String((err && err.message) || err).slice(0, 60) })
            // refreshing the window reloads this code but not the main process: an app that
            // was only refreshed has no handler for it yet
            say('这个应用还在用旧的主进程(退出后重新打开即可),先用浏览器的选择框', 'warn')
            openPicker(say)
            return
          }
          const selected = res?.result || res
          if (!selected || selected.canceled) { say('已取消'); return }
          if (res?.error || selected.error) throw new Error(res?.error || selected.error)
          const files = (selected.files || []).map((f) => {
            // Browser directory pickers return File objects; Electron IPC returns base64.
            if (f.file && typeof f.file.arrayBuffer === 'function') {
              const file = f.file
              try { Object.defineProperty(file, 'webkitRelativePath', { value: f.relativePath || f.name }) } catch { /* read-only in some engines */ }
              return file
            }
            if (typeof f.base64 !== 'string') return null
            const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0))
            const file = new File([bytes], f.name, { type: f.mime })
            try { Object.defineProperty(file, 'webkitRelativePath', { value: f.relativePath || f.name }) } catch { /* read-only in some engines */ }
            return file
          }).filter(Boolean)
          if (!files.length) throw new Error('这个文件夹里没有 JSON 和贴图')
          const n = await importPhotoshopProject(files, (t) => say(t))
          say(`已载入 ${n} 张贴图,勾选图层后生成`, 'ok')
        })
        return
      }
      openPicker(say)
    })
    // A folder dropped on the button is read through the entries API, so importing works
    // even where the environment refuses to open a folder chooser.
    const entryFiles = async (roots) => {
      const files = []
      const readDir = (dir) => new Promise((resolve) => {
        const reader = dir.createReader()
        const out = []
        const step = () => reader.readEntries((batch) => {
          if (!batch || !batch.length) { resolve(out); return }
          for (const b of batch) out.push(b)
          step()
        }, () => resolve(out))
        step()
      })
      const fileOf = (entry) => new Promise((resolve) => entry.file((f) => resolve(f), () => resolve(null)))
      const walk = async (entry, prefix, depth) => {
        if (!entry || depth > 4) return
        if (entry.isFile) {
          const f = await fileOf(entry)
          if (!f) return
          try { Object.defineProperty(f, 'webkitRelativePath', { value: prefix + f.name }) } catch { /* read-only here and there */ }
          files.push(f)
          return
        }
        if (entry.isDirectory) {
          const kids = await readDir(entry)
          for (const kid of kids) await walk(kid, prefix + entry.name + '/', depth + 1)
        }
      }
      for (const root of roots) await walk(root, '', 0)
      return files
    }
    const dropHint = (on) => {
      button.style.outline = on ? '1px dashed #7ee787' : ''
      button.style.outlineOffset = on ? '2px' : ''
    }
    button.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; dropHint(true) })
    button.addEventListener('dragleave', () => dropHint(false))
    button.addEventListener('drop', (ev) => {
      ev.preventDefault()
      dropHint(false)
      if (state.busy) return
      // the item list is emptied as soon as the handler returns, so take the entries NOW
      const roots = []
      const items = (ev.dataTransfer && ev.dataTransfer.items) || []
      for (const item of items) {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
        if (entry) roots.push(entry)
      }
      const plain = Array.from((ev.dataTransfer && ev.dataTransfer.files) || [])
      diag('drop', { roots: roots.length, plain: plain.length })
      guardWith(sayHere)(async () => {
        sayHere('读取拖进来的文件夹…')
        const files = roots.length ? await entryFiles(roots) : plain
        if (!files.length) throw new Error('这里面没有 JSON 和贴图')
        const n = await importPhotoshopProject(files, (t) => sayHere(t))
        sayHere(`已载入 ${n} 张贴图,勾选图层后生成`, 'ok')
      })
    })
    picker.addEventListener('change', () => {
      // `picker.files` is LIVE: resetting picker.value empties the very list we
      // are holding, so snapshot first or the pick silently turns into nothing.
      const files = Array.from(picker.files || [])
      diag('picked', { n: files.length })
      picker.value = ''
      const say = sayHere
      if (!files.length) { say('没有选到文件'); return }
      guardWith(say)(async () => {
        const n = await importPhotoshopProject(files, (t) => say(t))
        say(`已载入 ${n} 张贴图,勾选图层后生成`, 'ok')
      })
    })
    document.body.appendChild(picker)
    // What to pick, under the button (the name alone is short now).
    // no top margin: the brand runtime's rhythm pass sets the panel's spacing and zeroed it a frame later
    const psNote = el('div', { marginTop: '0', fontSize: '11px', lineHeight: '1.5', color: 'rgba(255,255,255,0.45)' },
      '选择 PhotoshopToSpine 导出的文件夹（JSON + 贴图），也可以直接拖到按钮上')
    psNote.setAttribute('data-novaflow-ps-import-note', '1')
    state.psImport = { button, picker, status: psStatus, note: psNote }
    busyButtons.push(button)
    return state.psImport
  }
  function homePsImport() {
    const kit = ensurePsImport()
    if (!kit || !kit.button) return
    const panel = Array.from(document.querySelectorAll('.nf-panel')).find((pn) => {
      const head = pn.querySelector('.nf-panel-header')
      return head && String(head.textContent || '').replace(/\s+/g, '').startsWith('导入工程')
    })
    const body = panel && panel.querySelector('.nf-panel-body')
    if (!body) return
    if (kit.button.parentElement !== body) body.appendChild(kit.button)
    if (kit.note && kit.note.previousElementSibling !== kit.button) kit.button.after(kit.note)
    if (kit.status && kit.status.parentElement !== body) body.appendChild(kit.status)
    if (!kit.picker.isConnected) document.body.appendChild(kit.picker)
    dressLikePanel(kit.button, body)
  }
  /**
   * Wear the panel's own button style: this row sits among the app's buttons, and its
   * look is the app's (class + inline style), not ours. Re-applied whenever the app
   * rebuilds them, guarded by a signature so nothing is written when nothing changed.
   */
  function dressLikePanel(btn, body) {
    const buttons = Array.from(body.querySelectorAll('button')).filter((b) => b !== btn)
    const model = buttons.find((b) => String(b.textContent || '').replace(/\s+/g, '') === '清空') || buttons[buttons.length - 1]
    if (!model) return
    // copied from the COMPUTED style: the app styles these buttons from its own sheet as
    // often as inline, so copying the style attribute alone left ours looking like a
    // browser default button
    const c = window.getComputedStyle(model)
    const props = ['height', 'minHeight', 'padding', 'borderRadius', 'backgroundColor', 'color', 'borderWidth', 'borderStyle', 'borderColor', 'fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'boxShadow', 'cursor']
    const sig = props.map((k) => c[k]).join('|')
    if (btn.dataset.nfStyleSig === sig) return
    btn.dataset.nfStyleSig = sig
    for (const k of props) { const v = c[k]; if (v && v !== 'auto' && v !== 'none' && v !== '0px') btn.style[k] = v }
    btn.style.width = '100%'
    btn.style.marginTop = '0'
    btn.style.display = 'block'
    btn.style.boxSizing = 'border-box'
  }
  function tuneSkeletonSidebar() {
    const box = ensureHierarchy()
    if (!box) return
    const body = document.querySelector('[data-novaflow-skeleton-sidebar-body="1"]')
    const sidebar = document.querySelector('[data-novaflow-skeleton-sidebar="1"]')
    if (!body || !sidebar || !hier.scroll) return
    const cs = window.getComputedStyle(body)
    const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    const chrome = box.getBoundingClientRect().height - hier.scroll.getBoundingClientRect().height
    const avail = Math.round(sidebar.getBoundingClientRect().height - padding - chrome - 6)
    const maxH = Math.max(220, Math.min(4000, avail))
    if (Math.abs(maxH - (bones.treeMaxH || 0)) > 6) {
      bones.treeMaxH = maxH
      hier.scroll.style.maxHeight = maxH + 'px'
    }
    renderHierarchy(false)
  }

  /** The working copy follows the loaded project unless there are unsaved edits. */
  function loadBonesFromSource(force) {
    const src = importedSource()
    if (!src) return false
    const text = src.skeleton.text
    if (!force && text === bones.lastText) return false
    const ctl = ensureController()
    if (!force && ctl.getState().dirty) return false
    bones.lastText = text
    ctl.load(JSON.parse(text))
    return true
  }
  let treeBound = false
  function bindTreeDrag() {
    if (treeBound) return
    treeBound = true
    document.addEventListener('pointerdown', onTreePointerDown, true)
    document.addEventListener('pointermove', onTreePointerMove, true)
    document.addEventListener('pointerup', onTreePointerUp, true)
    document.addEventListener('pointercancel', endTreeDrag, true)
    document.addEventListener('pointerdown', onOrderPointerDown, true)
    document.addEventListener('pointermove', onOrderPointerMove, true)
    document.addEventListener('pointerup', onOrderPointerUp, true)
    document.addEventListener('pointercancel', endOrderDrag, true)
    window.addEventListener('keydown', onOrderKey, true)
  }
  function setBonesEditing(on) {
    bindTreeDrag()
    tuneSkeletonSidebar()
    const ctl = ensureController()
    ctl.setPreview(false)
    bones.editing = !!on
    if (bones.editing) {
      loadBonesFromSource(false)
      freezePreview()
      ctl.setEnabled(true)
      // the layer picker claims the same clicks
      try { const pk = window.NovaFlowAutoMeshPicker; if (pk && pk.isEnabled && pk.isEnabled()) pk.setEnabled(false) } catch { /* optional */ }
    } else {
      ctl.setEnabled(false)
      thawPreview()
    }
    bones.syncUi()
  }
  function bonesTick() {
    if (!bones.ctl) return
    if (bones.editing) {
      const p = previewPlayer()
      if (p && (!bones.frozen || bones.frozen.player !== p)) freezePreview()
    }
    tuneSkeletonSidebar()
    homePsImport()
    syncBonePreview()
    if (loadBonesFromSource(false)) { bones.renderTree(); bones.syncUi(); renderHierarchy(true) }
  }
  const ourMeshes = () => Array.from(state.layers.values()).some((l) => l.mesh && !l.fromMesh)
  /** Write the edited rig into the project and reload the preview. */
  async function applyBones(setStatus) {
    if (typeof setStatus !== 'function') setStatus = () => {}
    const ctl = ensureController()
    const skel = ctl.getSkeleton()
    if (!skel) throw new Error('没有骨架可写回')
    if (ourMeshes()) throw new Error('这里生成的网格会跟着旧骨骼:先在 自动蒙皮 里「还原为导入时的图层」,改完骨骼再蒙皮')
    captureSource()
    const text = JSON.stringify(skel)
    for (const l of state.layers.values()) { l.weights = null; l.weightsEdited = false }
    setStatus('写回骨架…')
    await nextFrame()
    thawPreview()
    // reloadWithSkeleton records the text as sent; only then may it become the base, or
    // the sync tick reads the live text as a new project and wipes the panel state
    await reloadWithSkeleton(text)
    state.baseSkeleton = text
    bones.lastText = text
    ctl.load(skel, true)
    if (bones.editing) freezePreview()
    renderList()
    return skel.bones.length
  }
  /** Run spine-auto-bones on the loaded layers and write the result into the project. */
  async function autoRig(setStatus) {
    if (typeof setStatus !== 'function') setStatus = () => {}
    const AB = window.NovaFlowAutoBones
    if (!AB) throw new Error('自动骨架模块未加载')
    const src = captureSource()
    const skel = JSON.parse(src.skeleton.text)
    const hasMesh = (attachments) => Object.keys(attachments || {}).some((slot) => Object.values(attachments[slot] || {}).some((a) => a && a.type === 'mesh'))
    const meshed = Array.isArray(skel.skins) ? skel.skins.some((k) => hasMesh(k && k.attachments)) : Object.keys(skel.skins || {}).some((k) => hasMesh(skel.skins[k]))
    if (meshed || ourMeshes()) throw new Error('工程里已有网格:先在 自动蒙皮 里「还原为导入时的图层」,再自动架设')
    const AW = window.NovaFlowAutoWeights
    const mats = AW ? AW.setupPoseMatrices(skel) : null
    const boneIndex = new Map((skel.bones || []).map((b, i) => [b.name, i]))
    const attachmentsOf = (slotName) => {
      const pick = (attachments) => (attachments && attachments[slotName]) || null
      if (Array.isArray(skel.skins)) { for (const k of skel.skins) { const a = pick(k && k.attachments); if (a) return a } return null }
      for (const k of Object.keys(skel.skins || {})) { const a = pick(skel.skins[k]); if (a) return a }
      return null
    }
    const layers = []
    for (const slot of skel.slots || []) {
      const atts = attachmentsOf(slot.name)
      if (!atts) continue
      const attName = slot.attachment || Object.keys(atts)[0]
      const att = atts[attName]
      if (!att || (att.type && att.type !== 'region')) continue
      const layer = state.layers.get(attName)
      if (!layer || !layer.hasImage) continue
      setStatus(`读取图层 ${layers.length + 1}…`)
      await ensurePixels(attName)
      if (!layer.imageData) continue
      const m = mats && boneIndex.has(slot.bone) ? mats[boneIndex.get(slot.bone)] : null
      const ax = Number(att.x) || 0, ay = Number(att.y) || 0
      const place = m ? { x: m.a * ax + m.b * ay + m.worldX, y: m.c * ax + m.d * ay + m.worldY } : { x: ax, y: ay }
      layers.push({ name: slot.name, att: attName, width: layer.imageData.width, height: layer.imageData.height, rgba: layer.imageData.data, place })
    }
    if (!layers.length) throw new Error('没有可分析的图层(需要有贴图的 region 附件)')
    setStatus(`分析 ${layers.length} 层的中轴并搭建骨架…`)
    await nextFrame(); await nextFrame()
    const built = AB.buildSkeleton(layers)
    const next = AB.applyToSkeleton(skel, built)
    const text = JSON.stringify(next)
    for (const l of state.layers.values()) { l.weights = null; l.weightsEdited = false }
    setStatus(`写回 ${built.bones.length} 根骨…`)
    await nextFrame()
    thawPreview()
    await reloadWithSkeleton(text)
    state.baseSkeleton = text
    bones.lastText = text
    const ctl = ensureController()
    ctl.load(next)
    if (bones.editing) freezePreview()
    renderList()
    return { bones: built.bones.length, ik: built.json.ik.length, layers: layers.length }
  }

  function buildBonesBody() {
    const E = window.NovaFlowBonesEditor
    const body = el('div')
    body.className = 'nf-panel-body'
    body.style.padding = '14px'
    body.style.marginTop = STACK_GAP
    body.style.display = state.openBones ? 'block' : 'none'

    const status = el('div', { fontSize: '11px', color: 'rgba(255,255,255,0.55)', margin: STACK_GAP + ' 0 0', minHeight: '15px', lineHeight: '1.5' })
    const setStatus = (text, tone) => {
      status.textContent = text || ''
      status.style.color = tone === 'error' ? '#ff8a7a' : (tone === 'ok' ? '#22c98a' : 'rgba(255,255,255,0.55)')
    }
    bones.setStatus = setStatus
    const guard = guardWith(setStatus, true)

    // the switch
    // no 编辑骨骼 checkbox: opening this panel IS the edit mode (user decision 2026-09-21),
    // collapsing it hands the preview back
    // wraps: the whole note is read, not cut at the column's edge
    const swHint = el('div', { fontSize: '11px', lineHeight: '1.5', color: 'rgba(255,255,255,0.4)', marginTop: STACK_GAP, whiteSpace: 'normal', wordBreak: 'break-word' }, '展开=编辑(预览停在设置姿势),收起=恢复播放')
    swHint.title = '展开本面板即进入编辑:预览停在设置姿势,可直接选、拖、画骨骼;收起即恢复播放'

    // tools
    // one row that shares the column evenly and can narrow with it (a scrollbar
    // took a few px and 新建 wrapped, or the row ran past the edge)
    const toolsRow = el('div', { display: 'flex', flexWrap: 'nowrap', gap: '4px', marginTop: STACK_GAP, width: '100%', minWidth: '0', boxSizing: 'border-box' })
    const toolBtns = {}
    for (const t of (E ? E.TOOLS : [])) {
      const b = smallButton(t.label)
      b.title = `${t.hint}(快捷键 ${t.key.toUpperCase()})`
      b.style.flex = '1 1 0'
      b.style.minWidth = '0'
      b.style.padding = '0 4px'
      b.addEventListener('click', () => { ensureController().setTool(t.id); bones.syncUi() })
      toolBtns[t.id] = b
      toolsRow.appendChild(b)
    }

    // actions
    const autoBtn = el('button', null, '自动架设'); autoBtn.type = 'button'; styleButton(autoBtn, true); autoBtn.style.marginTop = STACK_GAP
    autoBtn.title = '按每层的中轴自动搭一套骨架(躯干、四肢带 IK、头发、飘带);搭完展开本面板即可手动修'
    const resetBtn = el('button', null, '还原初始骨架'); resetBtn.type = 'button'; styleButton(resetBtn, false); resetBtn.style.marginTop = STACK_GAP
    resetBtn.title = '丢掉这里的所有改动,回到工程里的骨架(撤销 Ctrl+Z · 重做 Ctrl+Y · 删除选中骨 Delete)'
    const applyBtn = el('button', null, '应用到工程'); applyBtn.type = 'button'; styleButton(applyBtn, true); applyBtn.style.marginTop = STACK_GAP
    applyBtn.title = '把编辑好的骨架写回工程并重建预览;之后再做 自动蒙皮 / 自动权重'

    // the selected bone
    const selBox = el('div', { marginTop: STACK_GAP, border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '6px 8px', background: 'rgba(255,255,255,0.03)', display: 'none' })
    const field = (label) => {
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' })
      row.appendChild(el('span', { fontSize: '11px', color: 'rgba(255,255,255,0.5)', flex: '0 0 32px' }, label))
      return row
    }
    const inputStyle = { flex: '1 1 auto', minWidth: '0', height: '22px', background: '#2a2a2a', color: 'rgba(255,255,255,0.9)', border: '0', borderRadius: '4px', fontSize: '11px', padding: '0 6px', boxSizing: 'border-box' }
    const nameRow = field('名称'); const nameIn = el('input', inputStyle); nameIn.type = 'text'; nameIn.spellcheck = false; nameRow.appendChild(nameIn)
    const parentRow = field('父骨'); const parentSel = el('select', inputStyle); parentRow.appendChild(parentSel)
    // the pair of numbers belongs to the ACTIVE TOOL (user 2026-09-22): 移动 → X/Y,
    // 旋转 → 角度/长度, 缩放 → 缩放X/缩放Y, and typing one applies that tool's edit
    const poseRow = field('角度'); const poseLabelA = poseRow.firstChild
    const rotIn = el('input', Object.assign({}, inputStyle, { flex: '1 1 0' })); rotIn.type = 'number'; rotIn.step = '0.1'
    const poseLabelB = el('span', { fontSize: '11px', color: 'rgba(255,255,255,0.5)', flex: '0 0 auto' }, '长度')
    poseRow.appendChild(rotIn); poseRow.appendChild(poseLabelB)
    const lenIn = el('input', Object.assign({}, inputStyle, { flex: '1 1 0' })); lenIn.type = 'number'; lenIn.step = '1'; lenIn.min = '0'; poseRow.appendChild(lenIn)
    /** What the two fields mean under each tool: label, step, and where the value comes from. */
    const POSE_FIELDS = {
      move: { a: { label: 'X', step: '1', min: '' }, b: { label: 'Y', step: '1', min: '' }, title: '骨骼原点的世界坐标' },
      rotate: { a: { label: '角度', step: '0.1', min: '' }, b: { label: '长度', step: '1', min: '0' }, title: '世界角度与骨骼长度' },
      scale: { a: { label: '缩放X', step: '0.01', min: '' }, b: { label: '缩放Y', step: '0.01', min: '' }, title: '骨骼自身的缩放,子骨和图片跟着变' },
      create: { a: { label: '角度', step: '0.1', min: '' }, b: { label: '长度', step: '1', min: '0' }, title: '世界角度与骨骼长度' }
    }
    const poseSpec = () => POSE_FIELDS[(bones.ctl ? bones.ctl.getState().tool : 'move')] || POSE_FIELDS.move
    const mechNote = el('div', { fontSize: '10px', color: 'rgba(255,170,90,0.85)', marginTop: '4px', display: 'none' }, '控制骨(IK/约束目标、零长度骨、枢轴):拖动或旋转=摆姿势,约束联动、图片跟着走;辅助链跟着关节走,不单独编辑')
    const legend = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', marginTop: '2px', fontSize: '10px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', width: '100%', minWidth: '0' })
    legend.title = '蓝=普通变形骨 · 紫=被约束驱动 · 琥珀=控制骨(IK/约束目标、零长度枢轴) · 绿=选中'
    for (const [color, text] of [['#8fd3ff', '普通'], ['#c79bff', '受约束'], ['#ffb454', '控制骨'], ['#22c98a', '选中']]) {
      const chip = el('span', { display: 'inline-flex', alignItems: 'center', gap: '2px', flex: '0 1 auto', minWidth: '0' })
      chip.appendChild(el('span', { width: '6px', height: '6px', borderRadius: '2px', background: color, flex: '0 0 auto' }))
      chip.appendChild(el('span', null, text))
      legend.appendChild(chip)
    }
    selBox.appendChild(nameRow); selBox.appendChild(parentRow); selBox.appendChild(poseRow); selBox.appendChild(mechNote)
    const commitName = () => { const ctl = ensureController(); const st = ctl.getState(); if (st.selected < 0) return; const cur = ctl.getSkeleton().bones[st.selected].name; if (nameIn.value.trim() === cur) return; if (!ctl.renameSelected(nameIn.value)) { setStatus('名字为空或已被占用', 'error'); nameIn.value = cur } else setStatus(`已改名为 ${nameIn.value.trim()}`, 'ok') }
    nameIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitName(); nameIn.blur() } else if (ev.key === 'Escape') { ev.preventDefault(); bones.syncUi(); nameIn.blur() } ev.stopPropagation() })
    nameIn.addEventListener('blur', commitName)
    // a bone cannot hang under itself or its own subtree: those options are disabled when
    // the dropdown OPENS (toggling 200 options' disabled on every selection dirtied layout,
    // and the next layout read cost ~7 ms per click)
    const refreshParentOptions = () => {
      const ctl = bones.ctl
      if (!ctl) return
      const st = ctl.getState(), list = ctl.peekBones()
      const key = st.selected + '|' + (parentSel.dataset.optionsKey || '')
      if (parentSel.dataset.disabledFor === key) return
      parentSel.dataset.disabledFor = key
      const index = new Map(list.map((x, i) => [x.name, i]))
      const descendants = new Set([st.selected])
      let grew = true
      while (grew) { grew = false; list.forEach((x, i) => { if (!descendants.has(i) && x.parent !== undefined && index.has(x.parent) && descendants.has(index.get(x.parent))) { descendants.add(i); grew = true } }) }
      const opts = parentSel.options
      for (let k = 1; k < opts.length; k++) { const dis = descendants.has(k - 1); if (opts[k].disabled !== dis) opts[k].disabled = dis }
    }
    for (const evName of ['pointerdown', 'focus', 'keydown']) parentSel.addEventListener(evName, refreshParentOptions)
    parentSel.addEventListener('change', () => { const ctl = ensureController(); const i = Number(parentSel.value); if (!ctl.reparentSelected(i)) { setStatus('不能挂到自己或自己的子骨下', 'error'); bones.syncUi() } })
    const commitPose = () => {
      const ctl = ensureController()
      const st = ctl.getState()
      if (st.selected < 0) return
      const tool = st.tool
      if (tool === 'move') ctl.setSelectedPose({ x: Number(rotIn.value), y: Number(lenIn.value) })
      else if (tool === 'scale') ctl.setSelectedPose({ scaleX: Number(rotIn.value), scaleY: Number(lenIn.value) })
      else ctl.setSelectedPose({ rotation: Number(rotIn.value), length: Number(lenIn.value) })
      bones.syncUi()
    }
    for (const inp of [rotIn, lenIn]) { inp.addEventListener('change', commitPose); inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitPose(); inp.blur() } ev.stopPropagation() }) }
    bones.focusName = () => { window.setTimeout(() => { try { nameIn.focus(); nameIn.select() } catch { /* hidden */ } }, 0) }

    // The project's bone tree lives in the right-hand sidebar (the app's own); a second
    // copy here was the same list twice, so this is only the pointer to it.
    const listWrap = el('div', { marginTop: STACK_GAP, fontSize: '11px', color: 'rgba(255,255,255,0.45)', lineHeight: '1.5' })
    bones.renderTree = () => {
      const ctl = bones.ctl
      const n = ctl ? ctl.peekBones().length : 0
      listWrap.title = '换父骨:选中后按 P 再点新父骨(Shift+P 挂到 root),或在右侧树里把一根骨拖到另一根上'
      listWrap.textContent = n
        ? `骨骼树在右侧(${n} 根) · 换父骨 P / Shift+P`
        : (importedSource() ? '还没有骨骼:点 自动架设,或用 新建 画' : '导入工程后右侧列出骨骼树')
    }

    // writes that would invalidate layout are skipped when nothing changes: the next
    // layout read (scrollIntoView, the editor's canvas rect) would otherwise force a
    // synchronous relayout of the whole shell on every click
    const setText = (node, text) => { if (node.textContent !== text) node.textContent = text }
    const setDisabled = (node, v) => { if (node.disabled !== !!v) node.disabled = !!v }
    const setDisplay = (node, v) => { if (node.style.display !== v) node.style.display = v }
    const setStyle = (node, prop, v) => { if (node.style[prop] !== v) node.style[prop] = v }
    bones.syncUi = () => {
      const ctl = bones.ctl
      const st = ctl ? ctl.getState() : { enabled: false, tool: 'move', selected: -1, dirty: false, canUndo: false, canRedo: false, bones: 0 }
      const ready = !bones.editing || !!previewPlayer()
      setText(swHint, ready ? '展开=编辑(预览停在设置姿势),收起=恢复播放' : '预览还没就绪,等骨骼预览出来再编辑')
      setStyle(swHint, 'color', ready ? 'rgba(255,255,255,0.4)' : '#ff8a7a')
      for (const id of Object.keys(toolBtns)) {
        const b = toolBtns[id]
        const on = bones.editing && st.tool === id
        setStyle(b, 'background', on ? '#1EA672' : '#333333')
        setStyle(b, 'color', on ? '#ffffff' : 'rgba(255,255,255,0.92)')
        setDisabled(b, !bones.editing)
        setStyle(b, 'opacity', bones.editing ? '1' : '0.5')
      }
      setDisabled(resetBtn, !st.dirty)
      setStyle(resetBtn, 'opacity', resetBtn.disabled ? '0.5' : '1')
      setDisabled(applyBtn, !st.dirty)
      setStyle(applyBtn, 'opacity', st.dirty ? '1' : '0.6')
      setText(applyBtn, st.dirty ? '应用到工程(有未保存的修改)' : '应用到工程')
      // selected bone fields
      const skel = ctl && st.selected >= 0 ? { bones: ctl.peekBones() } : null
      if (skel && skel.bones[st.selected]) {
        const b = skel.bones[st.selected]
        setDisplay(selBox, 'block')
        if (document.activeElement !== nameIn) nameIn.value = b.name
        const W = ctl.getWorld()
        const m = W[st.selected]
        const spec = poseSpec()
        setText(poseLabelA, spec.a.label)
        setText(poseLabelB, spec.b.label)
        if (poseRow.title !== spec.title) poseRow.title = spec.title
        for (const [inp, cell] of [[rotIn, spec.a], [lenIn, spec.b]]) {
          if (inp.step !== cell.step) inp.step = cell.step
          if ((inp.getAttribute('min') || '') !== cell.min) { if (cell.min) inp.setAttribute('min', cell.min); else inp.removeAttribute('min') }
        }
        const round1 = (v) => String(Math.round(v * 10) / 10)
        let va = '0', vb = '0'
        if (st.tool === 'move') { va = m ? round1(m.worldX) : '0'; vb = m ? round1(m.worldY) : '0' } else if (st.tool === 'scale') {
          const sx = b.scaleX === undefined ? 1 : Number(b.scaleX)
          const sy = b.scaleY === undefined ? 1 : Number(b.scaleY)
          va = String(Math.round(sx * 1000) / 1000); vb = String(Math.round(sy * 1000) / 1000)
        } else { va = m ? (Math.atan2(m.c, m.a) * 180 / Math.PI).toFixed(1) : '0'; vb = m ? round1(m.length) : '0' }
        if (document.activeElement !== rotIn) rotIn.value = va
        if (document.activeElement !== lenIn) lenIn.value = vb
        const index = new Map(skel.bones.map((x, i) => [x.name, i]))
        const optionsKey = skel.bones.map((x) => x.name + '<' + (x.parent || '')).join('\n')
        if (parentSel.dataset.optionsKey !== optionsKey) {
          parentSel.dataset.optionsKey = optionsKey
          parentSel.innerHTML = ''
          const none = el('option', null, '(无)'); none.value = '-1'; parentSel.appendChild(none)
          const frag = document.createDocumentFragment()
          skel.bones.forEach((x, i) => { const o = el('option', null, x.name); o.value = String(i); frag.appendChild(o) })
          parentSel.appendChild(frag)
          parentSel.dataset.disabledFor = ''
        }
        parentSel.value = b.parent !== undefined && index.has(b.parent) ? String(index.get(b.parent)) : '-1'
        const owned = ctl.isOwned(st.selected)
        setDisplay(mechNote, owned ? 'block' : 'none')
        for (const inp of [nameIn, rotIn, lenIn, parentSel]) setDisabled(inp, owned || !bones.editing)
      } else setDisplay(selBox, 'none')
    }

    // a project that already has a rig and animation keys: replacing the rig makes every
    // animation curve point at bones that no longer exist, so it takes a second click
    let armedUntil = 0
    const AUTO_LABEL = '自动架设'
    autoBtn.addEventListener('click', () => {
      let rigged = false
      try {
        const src = importedSource()
        if (src) {
          const sk = JSON.parse(src.skeleton.text)
          const anim = sk.animations || {}
          rigged = (sk.bones || []).length > 1 && Object.keys(anim).some((k) => anim[k] && anim[k].bones && Object.keys(anim[k].bones).length > 0)
        }
      } catch { rigged = false }
      if (rigged && Date.now() > armedUntil) {
        armedUntil = Date.now() + 8000
        autoBtn.textContent = '再点一次：替换现有骨架（动画会失效）'
        setStatus('这个工程已经有骨架和动画。自动架设会整套换掉骨骼，原动画曲线会失效;只是修骨骼请打开 编辑骨骼 直接改。', 'error')
        window.setTimeout(() => { if (Date.now() >= armedUntil) { autoBtn.textContent = AUTO_LABEL } }, 8200)
        return
      }
      armedUntil = 0
      autoBtn.textContent = AUTO_LABEL
      guard(async () => {
        setStatus('准备图层…')
        const r = await autoRig((t) => setStatus(t))
        setStatus(`自动架设完成 · ${r.bones} 根骨 · ${r.ik} 个 IK · ${r.layers} 层`, 'ok')
      })()
    })
    resetBtn.addEventListener('click', () => { loadBonesFromSource(true); renderHierarchy(true); setStatus('已还原为工程里的骨架') })
    applyBtn.addEventListener('click', () => guard(async () => {
      const n = await applyBones((t) => setStatus(t))
      setStatus(`已写回 ${n} 根骨`, 'ok')
    }))
    busyButtons.push(autoBtn, applyBtn)
    busyLists.push(listWrap)

    body.appendChild(autoBtn)
    body.appendChild(swHint)
    body.appendChild(toolsRow)
    body.appendChild(applyBtn)
    body.appendChild(resetBtn)
    body.appendChild(status)
    body.appendChild(legend)
    body.appendChild(selBox)
    body.appendChild(listWrap)
    try { ensureController(); loadBonesFromSource(false) } catch { /* the editor script may be missing */ }
    bones.renderTree(); bones.syncUi()
    return body
  }
  function bonesSpec() {
    return {
      id: BONES_PANEL_ID, mark: BMARK, title: BTITLE, icon: 'fas fa-bone', body: buildBonesBody,
      isOpen: () => state.openBones,
      setOpen: (v) => {
        state.openBones = v
        if (state.fitList) state.fitList()
        try { setBonesEditing(v) } catch { /* the preview may not be up yet */ }
      }
    }
  }

  function meshSpec() {
    return {
      id: PANEL_ID, mark: MARK, title: TITLE, icon: 'fas fa-vector-square', body: buildMeshBody,
      isOpen: () => state.open,
      setOpen: (v) => { state.open = v }
    }
  }
  function weightsSpec() {
    return {
      id: WEIGHTS_PANEL_ID, mark: WMARK, title: WTITLE, icon: 'fas fa-project-diagram', body: buildWeightsBody,
      isOpen: () => state.openWeights,
      setOpen: (v) => { state.openWeights = v; if (state.fitList) state.fitList() }
    }
  }

  function buildPanel(spec) {
    const panel = el('div')
    panel.className = 'nf-panel'
    panel.setAttribute('data-panel-id', spec.id)
    panel.setAttribute(spec.mark, '1')
    panel.setAttribute('data-open', spec.isOpen() ? '1' : '0')
    // let the brand runtime's left-shell layout pass size us like the native panels
    panel.setAttribute('data-novaflow-editor-panel', '1')
    panel.setAttribute('data-novaflow-source-layout', '1')
    panel.style.marginBottom = '0'
    panel.style.overflow = 'hidden'

    // Copied from the rules the brand runtime gives 导入工程, the panel directly above
    // this one. `.nf-panel-header` itself only carries colours; the geometry comes from
    // per-panel rules keyed on markers we do not carry, so without these the header is
    // whatever its content happens to be. Hand-picked padding put it at 46px against
    // everyone else's 35, with the icon and label in their own wrapper at their own
    // spacing. SECONDARY_ENTRY_HEIGHT is 35.
    const header = el('div', {
      height: '35px', minHeight: '35px', maxHeight: '35px', boxSizing: 'border-box',
      padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
      gap: '10px', cursor: 'pointer', userSelect: 'none', fontSize: '13px',
    })
    header.className = 'nf-panel-header'
    const icon = el('i', {
      width: '16px', minWidth: '16px', maxWidth: '16px',
      fontSize: '14px', lineHeight: '1', textAlign: 'center', pointerEvents: 'none',
    })
    icon.className = spec.icon
    icon.setAttribute('aria-hidden', 'true')
    const label = el('span', {
      minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis',
      whiteSpace: 'nowrap', pointerEvents: 'none',
    })
    label.textContent = spec.title
    const chevron = el('i', { marginLeft: 'auto', fontSize: '12px', opacity: '0.7', pointerEvents: 'none' })
    chevron.className = `fas fa-chevron-${spec.isOpen() ? 'down' : 'right'}`
    chevron.setAttribute('aria-hidden', 'true')
    header.appendChild(icon); header.appendChild(label); header.appendChild(chevron)

    const body = spec.body()
    header.addEventListener('click', (ev) => {
      // something in the app clicks a freshly inserted panel header for us (an
      // untrusted event, seen on 自动权重 right after mount); only a person may fold it
      if (ev && ev.isTrusted === false) return
      spec.setOpen(!spec.isOpen())
      const open = spec.isOpen()
      panel.setAttribute('data-open', open ? '1' : '0')
      body.style.display = open ? 'block' : 'none'
      chevron.className = `fas fa-chevron-${open ? 'down' : 'right'}`
    })

    panel.appendChild(header)
    panel.appendChild(body)
    return panel
  }

  // ------------------------------------------------------------- mounting ---

  /** Last native panel of the 骨骼动画 shell; we mount after it. */
  function findAnchor() {
    const ribbon = document.querySelector(RIBBON_PANEL_SELECTOR)
    if (ribbon && ribbon.parentElement) return ribbon
    // the ribbon mark is applied asynchronously, so fall back to the shell that
    // holds 导入工程 and take its last native panel
    const imp = document.querySelector(IMPORT_PANEL_SELECTOR)
    if (!imp || !imp.parentElement) return null
    const siblings = Array.from(imp.parentElement.children).filter(
      (n) => n.classList && n.classList.contains('nf-panel') && !n.hasAttribute(MARK)
    )
    return siblings.length ? siblings[siblings.length - 1] : null
  }

  /** The brand runtime pins the native panels to a fixed width; follow it. */
  function matchAnchorWidth(panel, anchor) {
    const w = anchor.style && anchor.style.width
    if (!w || panel.style.width === w) return
    panel.style.setProperty('width', w, 'important')
    panel.style.setProperty('min-width', w, 'important')
    panel.style.setProperty('max-width', w, 'important')
    panel.style.setProperty('margin', '0', 'important')
    panel.style.setProperty('box-sizing', 'border-box', 'important')
  }

  /**
   * `allowReorder` is only ever true on the slow interval tick. Re-ordering from
   * the MutationObserver would react to our own insert and livelock against the
   * brand runtime, which reflows this shell on its own observers.
   */
  function mount(allowReorder) {
    const anchor = findAnchor()
    const specs = [
      { mark: BMARK, spec: bonesSpec },
      { mark: MARK, spec: meshSpec },
      { mark: WMARK, spec: weightsSpec }
    ]
    if (!anchor) {
      // the 骨骼动画 section is gone; take our panels with it
      for (const s of specs) { const e = document.querySelector(`[${s.mark}="1"]`); if (e && e.parentElement) e.parentElement.removeChild(e) }
      if (bones.editing) { try { setBonesEditing(false) } catch { /* nothing to restore */ } }
      return
    }
    // 骨骼架设 → 自动蒙皮 → 自动权重, in the order the work is done, each right after
    // the one before; the first follows the last native panel
    let prev = anchor
    for (const s of specs) {
      let panel = document.querySelector(`[${s.mark}="1"]`)
      if (panel && panel.isConnected) {
        const misplaced = panel.previousElementSibling !== prev
        if (allowReorder && misplaced && prev.parentElement) prev.parentElement.insertBefore(panel, prev.nextSibling)
        matchAnchorWidth(panel, anchor)
      } else if (prev.parentElement) {
        panel = buildPanel(s.spec())
        prev.parentElement.insertBefore(panel, prev.nextSibling)
        matchAnchorWidth(panel, anchor)
      }
      if (panel) prev = panel
    }
  }

  function mutationAddsElement(mutations) {
    for (const m of mutations) {
      if (m.type !== 'childList') continue
      for (const node of m.addedNodes) if (node && node.nodeType === 1) return true
      for (const node of m.removedNodes) if (node && node.nodeType === 1) return true
    }
    return false
  }

  function start() {
    hookPlayerFactory()
    let scheduled = false
    const schedule = () => {
      if (scheduled || state.busy) return
      // a shell that just appeared gets its panels right now, in the same frame as the
      // native ones; the insert is idempotent, so the mutation it causes is harmless
      if (!document.querySelector(`[${MARK}="1"]`) && findAnchor()) {
        try { mount(false) } catch { /* fall through to the frame below */ }
      }
      scheduled = true
      window.requestAnimationFrame(() => { scheduled = false; try { mount(false) } catch { /* keep observing */ } })
    }
    mount(true)
    // The list is measured against the window, so it has to be re-measured when
    // the window changes -- that is what kept it stuck at its first height.
    const refit = () => { try { if (state.fitList) state.fitList() } catch { /* not built yet */ } }
    window.addEventListener('resize', refit)
    window.setInterval(() => { if (!document.hidden) refit() }, 1000)
    // the picker may not have loaded yet, so keep trying until it answers
    let hoverBound = false
    const bindHover = () => {
      if (hoverBound) return
      const picker = window.NovaFlowAutoMeshPicker
      if (!picker || typeof picker.setHoverListener !== 'function') return
      picker.setHoverListener(hoverFromCanvas)
      hoverBound = true
    }
    bindHover()
    // Only element add/remove can mount or orphan the panel; attribute churn cannot,
    // and reacting to it is what turns this into a loop.
    const observer = new MutationObserver((mutations) => {
      if (!mutationAddsElement(mutations)) return
      schedule()
      // the sidebar is the app's; as soon as it (re)appears the tree goes in, in the same
      // frame, so entering 骨骼动画 never shows the app's own blocks
      const body = document.querySelector('[data-novaflow-skeleton-sidebar-body="1"]')
      if (body && !body.querySelector(`[${HIER_MARK}="1"]`)) { try { tuneSkeletonSidebar() } catch { /* not ready */ } }
      // the app rebuilds its 导入工程 panel; put our button back in the same frame, or it
      // blinks out and returns on the next tick
      try { homePsImport() } catch { /* the panel is not up */ }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    window.setInterval(() => {
      if (state.busy || document.hidden) return
      try { mount(true) } catch { /* keep polling */ }
      hookPlayerFactory()
      try { syncLayersFromSource() } catch { /* keep polling */ }
      try { bonesTick() } catch { /* keep polling */ }
      bindHover()
    }, 1000)
    try { syncLayersFromSource() } catch { /* nothing imported yet */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  window.NovaFlowAutoMeshPanel = {
    getState: () => ({
      density: state.density,
      open: state.open,
      busy: state.busy,
      layers: Array.from(state.layers.keys()),
      selected: selectedNames(),
      lastReport: state.lastReport
    }),
    setDensity: (v) => { state.density = Math.max(8, Math.min(40, Number(v) || 22)) },
    setSelected,
    syncLayersFromSource,
    importPhotoshopProject,
    /** decode a layer's pixels on demand, so a hover can show its real shape */
    ensurePixels,
    generate,
    regenerateLayer,
    editLayer,
    autoWeights,
    editWeights,
    restoreWeights,
    restore,
    applyAll,
    mount: () => mount(true),
    focusLayer,
    _order: { pick: (name, ev) => pickLayerRow(name, ev), nudge: (d) => nudgeOrder(d), drop: (before) => dropOrder(before), names: orderNames, picked: () => [...hier.pick] },
    autoRig,
    applyBones,
    setBonesEditing,
    bonesController: () => bones.ctl,
    _state: state,
    _bones: bones
  }
})()

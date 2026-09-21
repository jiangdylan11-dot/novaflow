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
    // a rig being edited and a mesh being written would race for the same skeleton
    if (!forRigging && bones.editing) { setStatus('先在「骨骼架设」里应用或关闭 编辑骨骼', 'error'); return }
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
  let hoverName = null

  // Hover is the outline only (user decision): a green fill on the card, for hover
  // or for the tick, was too loud next to the tick itself.
  function paintRow(name, on) {
    const row = rowEls.get(name)
    if (!row) return
    row.style.borderColor = on ? 'rgba(34,201,138,0.65)' : 'rgba(255,255,255,0.08)'
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
    const top = row.offsetTop, bottom = top + row.offsetHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
  }
  /** Called from the picker when the pointer moves over the preview. */
  function hoverFromCanvas(name) {
    if (name === hoverName) return
    if (hoverName) paintRow(hoverName, false)
    hoverName = name || null
    if (hoverName) {
      paintRow(hoverName, true)
      scrollRowIntoView(rowEls.get(hoverName))
    }
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
   * Without a player, fall back to the plain bone tree.
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
    const p = livePlayer
    if (p && !p.disposed && p.spine && p.spine.SkeletonJson) {
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
    const m = (slotBone !== undefined && mats[slotBone]) || { a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }
    const inv = AW.invertBone(m)
    const world = new Float64Array(2 * n)
    for (let i = 0; i < n; i++) {
      const lx = rx + V[2 * i] - rw / 2, ly = ry + rh / 2 - V[2 * i + 1]
      world[2 * i] = m.a * lx + m.b * ly + m.worldX
      world[2 * i + 1] = m.c * lx + m.d * ly + m.worldY
    }
    const toImage = (wx, wy) => {
      const dx = wx - inv.wx, dy = wy - inv.wy
      const lx = inv.ia * dx + inv.ib * dy, ly = inv.ic * dx + inv.id * dy
      return [lx - rx + rw / 2, rh / 2 - (ly - ry)]
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
      color: primary ? '#062a18' : 'rgba(255,255,255,0.86)',
      background: primary ? '#22c98a' : '#3a3a3a'
    })
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
    const value = el('span', { fontSize: '12px', color: '#22c98a', fontWeight: '700' }, String(state.density))
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

    const importBtn = el('button', null, '导入 PS 工程（JSON + 贴图文件夹）')
    importBtn.type = 'button'; styleButton(importBtn, false)
    importBtn.style.marginTop = STACK_GAP
    importBtn.title = 'PhotoshopToSpine 导出的文件夹可以直接用,不需要先过一遍 Spine'

    const picker = el('input', { display: 'none' })
    picker.type = 'file'
    picker.multiple = true
    try { picker.webkitdirectory = true } catch { /* plain multi-select instead */ }
    picker.setAttribute('webkitdirectory', '')
    picker.setAttribute('directory', '')

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
    busyButtons.push(importBtn, genBtn, restoreBtn)
    busyLists.push(listWrap)
    const guard = guardWith(setStatus)

    importBtn.addEventListener('click', () => { if (!state.busy) picker.click() })
    picker.addEventListener('change', () => {
      // `picker.files` is LIVE: resetting picker.value empties the very list we
      // are holding, so snapshot first or the pick silently turns into nothing.
      const files = Array.from(picker.files || [])
      picker.value = ''
      if (!files.length) { setStatus('没有选到文件'); return }
      guard(async () => {
        const n = await importPhotoshopProject(files, (t) => setStatus(t))
        setStatus(`已载入 ${n} 张贴图,勾选图层后生成`, 'ok')
      })
    })

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
    body.appendChild(importBtn)
    body.appendChild(picker)
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
      if (!state.layers.size) {
        listWrap.appendChild(el('div', { fontSize: '11px', color: 'rgba(255,255,255,0.4)' }, '导入工程后,这里列出每一层绑到了哪些骨骼'))
        return
      }
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
        scroll.appendChild(item)
      }
      listWrap.appendChild(scroll)
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
    ctl: null, editing: false, frozen: null, lastText: null, mechCache: null,
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
  function freezePreview() {
    const p = previewPlayer()
    if (!p || !p.animationState || (bones.frozen && bones.frozen.player === p)) return
    const st = p.animationState
    const tr = st.tracks && st.tracks[0]
    bones.frozen = { player: p, timeScale: st.timeScale, anim: tr && tr.animation ? tr.animation.name : null, loop: tr ? !!tr.loop : false, time: tr ? tr.trackTime : 0 }
    try { st.timeScale = 0; st.clearTracks(); p.skeleton.setToSetupPose(); p.skeleton.updateWorldTransform() } catch { /* the preview may be mid-rebuild */ }
    hideAppBones(p)
  }
  /**
   * The app draws its own bones (显示骨骼) from the LOADED project. While the rig is
   * edited only the editor's skeleton may show — the app's copy cannot follow an edit,
   * so the two would split apart on the first drag. The player's setter is wrapped so
   * the app's own toggling (and the facade re-applying it after a reload) is remembered
   * and put back when editing ends.
   */
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
      return original.call(this, Object.assign({}, overlays || {}, { bones: false }))
    }
    if (hidden.want) { try { original.call(p, Object.assign({}, p.debugOverlays, { bones: false })) } catch { /* mid-rebuild */ } }
  }
  function showAppBones(p) {
    const hidden = p && p.__nfBonesHidden
    if (!hidden) return
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
  }
  function thawPreview() {
    const f = bones.frozen
    bones.frozen = null
    if (!f) return
    const p = f.player
    showAppBones(p)
    if (!p || p.disposed || !p.animationState) return
    try {
      if (f.anim) { const e = p.animationState.setAnimation(0, f.anim, f.loop); if (e) e.trackTime = f.time }
      p.animationState.timeScale = f.timeScale
    } catch { /* the preview may be gone */ }
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
      onSelect: () => bones.syncUi(),
      onPickParent: (on) => {
        bones.setStatus(on ? '点一根骨作为新的父骨(Esc 取消)' : '', on ? 'ok' : '')
        tuneSkeletonSidebar()
      },
      onFrame: () => { if (bones.editing) holdFrozen() },
      onChange: () => { bones.renderTree(); bones.syncUi() },
      onTool: () => bones.syncUi(),
      // no auto-focus on the name field: the next drag continues the chain, and a focused
      // input would swallow the tool shortcuts (rename from the 名称 field when you want to)
      onCreate: () => { bones.renderTree(); bones.syncUi() }
    })
    return bones.ctl
  }
  /**
   * The app's own bone tree (right sidebar) doubles as the re-parent target: with 编辑骨骼 on,
   * drag one row onto another and the dragged bone hangs under it. Rows are the app's DOM, so
   * we only listen — the bone is identified by the row's text, and a plain click still selects
   * the way the app intends (we claim the gesture only once the pointer has actually moved).
   */
  const BONE_ROW_SEL = '[data-novaflow-skeleton-bone-row="1"]'
  const treeDrag = { from: null, name: '', over: null, moved: false, id: -1 }
  const rowName = (row) => String(row && row.textContent || '').replace(/\s+/g, ' ').trim()
  const markRow = (row, on) => { if (row) row.style.outline = on ? '2px solid rgba(34,201,138,0.9)' : '' }
  function endTreeDrag() {
    markRow(treeDrag.from, false); markRow(treeDrag.over, false)
    treeDrag.from = null; treeDrag.over = null; treeDrag.moved = false; treeDrag.id = -1
  }
  function onTreePointerDown(ev) {
    if (!bones.editing || ev.button !== 0) return
    const row = ev.target instanceof Element ? ev.target.closest(BONE_ROW_SEL) : null
    if (!row) return
    endTreeDrag()
    treeDrag.from = row; treeDrag.name = rowName(row); treeDrag.id = ev.pointerId
  }
  function onTreePointerMove(ev) {
    if (!treeDrag.from || ev.pointerId !== treeDrag.id) return
    if (!treeDrag.moved) {
      treeDrag.moved = true
      markRow(treeDrag.from, true)
    }
    const row = document.elementFromPoint(ev.clientX, ev.clientY)
    const over = row instanceof Element ? row.closest(BONE_ROW_SEL) : null
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
    if (!names.has(child) || !names.has(parent)) { bones.setStatus(`工作副本里找不到 ${names.has(child) ? parent : child}(右侧树显示的是工程,新建的骨要先 应用到工程)`, 'error'); return }
    if (!ctl.reparentNamed(child, parent)) { bones.setStatus(`${child} 不能挂到 ${parent} 下(不能挂到自己或自己的子骨)`, 'error'); return }
    bones.setStatus(`${child} → 父骨 ${parent}`, 'ok')
    bones.renderTree(); bones.syncUi()
  }
  /**
   * The app's skeleton sidebar, tuned for rigging (user decisions 2026-09-21): the particle
   * attachment block is gone and the bone tree is half again as tall. The tree's own height
   * is set through a stylesheet so the element keeps the inline `max-height: 240px` the
   * app's stylesheet keys on.
   */
  function tuneSkeletonSidebar() {
    const sections = document.querySelectorAll('[data-novaflow-skeleton-sidebar-section="1"]')
    if (!sections.length) return
    for (const sec of sections) {
      const title = sec.querySelector('[data-novaflow-skeleton-sidebar-title="1"]')
      const text = String(title && title.textContent || '').replace(/\s+/g, '')
      if (text.startsWith('粒子挂点') && sec.style.display !== 'none') sec.style.display = 'none'
    }
    if (document.getElementById('novaflow-bones-sidebar-style')) return
    const style = document.createElement('style')
    style.id = 'novaflow-bones-sidebar-style'
    style.textContent = '[data-novaflow-skeleton-tree-list="1"]{max-height:360px !important}'
    document.head.appendChild(style)
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
  }
  function setBonesEditing(on) {
    bindTreeDrag()
    tuneSkeletonSidebar()
    const ctl = ensureController()
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
    if (loadBonesFromSource(false)) { bones.renderTree(); bones.syncUi() }
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
    const switchRow = el('label', { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: 'rgba(255,255,255,0.85)', marginTop: STACK_GAP })
    const sw = el('input'); sw.type = 'checkbox'; sw.style.accentColor = '#22c98a'; sw.style.flex = '0 0 auto'
    sw.title = '打开后在预览里直接选、拖、画骨骼(预览停在设置姿势);关闭则预览恢复'
    const swLabel = el('span', null, '编辑骨骼')
    const swHint = el('span', { marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }, '关')
    switchRow.appendChild(sw); switchRow.appendChild(swLabel); switchRow.appendChild(swHint)
    sw.addEventListener('change', () => {
      try { setBonesEditing(sw.checked) } catch (err) { sw.checked = false; setStatus(String((err && err.message) || err), 'error') }
    })

    // tools
    const toolsRow = el('div', { display: 'flex', gap: '4px', marginTop: STACK_GAP })
    const toolBtns = {}
    for (const t of (E ? E.TOOLS : [])) {
      const b = smallButton(t.label)
      b.title = `${t.hint}(快捷键 ${t.key.toUpperCase()})`
      b.style.flex = '1 1 0'
      b.addEventListener('click', () => { ensureController().setTool(t.id); bones.syncUi() })
      toolBtns[t.id] = b
      toolsRow.appendChild(b)
    }
    let showNames = false
    const namesBtn = smallButton('名称')
    namesBtn.title = '在预览里标出每根骨骼的名字'
    namesBtn.addEventListener('click', () => { showNames = !showNames; ensureController().setShowNames(showNames); bones.syncUi() })
    toolsRow.appendChild(namesBtn)

    // actions
    const autoBtn = el('button', null, '自动架设'); autoBtn.type = 'button'; styleButton(autoBtn, true); autoBtn.style.marginTop = STACK_GAP
    autoBtn.title = '按每层的中轴自动搭一套骨架(躯干、四肢带 IK、头发、飘带);搭完打开 编辑骨骼 手动修'
    const row2 = el('div', { display: 'flex', gap: '4px', marginTop: STACK_GAP })
    const undoBtn = smallButton('撤销'), redoBtn = smallButton('重做'), delBtn = smallButton('删除'), resetBtn = smallButton('放弃修改')
    undoBtn.title = 'Ctrl+Z'; redoBtn.title = 'Ctrl+Y'; delBtn.title = '删除选中的骨骼:它的子骨挂到它的父骨,图层保持原位(Delete)'; resetBtn.title = '丢掉没应用的修改,回到工程里现在的骨架'
    for (const b of [undoBtn, redoBtn, delBtn, resetBtn]) { b.style.flex = '1 1 0'; row2.appendChild(b) }
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
    const poseRow = field('角度'); const rotIn = el('input', Object.assign({}, inputStyle, { flex: '1 1 0' })); rotIn.type = 'number'; rotIn.step = '0.1'
    poseRow.appendChild(rotIn); poseRow.appendChild(el('span', { fontSize: '11px', color: 'rgba(255,255,255,0.5)', flex: '0 0 auto' }, '长度'))
    const lenIn = el('input', Object.assign({}, inputStyle, { flex: '1 1 0' })); lenIn.type = 'number'; lenIn.step = '1'; lenIn.min = '0'; poseRow.appendChild(lenIn)
    const mechNote = el('div', { fontSize: '10px', color: 'rgba(255,170,90,0.85)', marginTop: '4px', display: 'none' }, '控制骨(IK/约束目标、零长度骨、枢轴):拖动或旋转=摆姿势,约束联动、图片跟着走;辅助链跟着关节走,不单独编辑')
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
    const commitPose = () => { const ctl = ensureController(); if (ctl.getState().selected < 0) return; ctl.setSelectedPose({ rotation: Number(rotIn.value), length: Number(lenIn.value) }) }
    for (const inp of [rotIn, lenIn]) { inp.addEventListener('change', commitPose); inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitPose(); inp.blur() } ev.stopPropagation() }) }
    bones.focusName = () => { window.setTimeout(() => { try { nameIn.focus(); nameIn.select() } catch { /* hidden */ } }, 0) }

    // The project's bone tree lives in the right-hand sidebar (the app's own); a second
    // copy here was the same list twice, so this is only the pointer to it.
    const listWrap = el('div', { marginTop: STACK_GAP, fontSize: '11px', color: 'rgba(255,255,255,0.45)', lineHeight: '1.5' })
    bones.renderTree = () => {
      const ctl = bones.ctl
      const n = ctl ? ctl.peekBones().length : 0
      listWrap.textContent = n
        ? `骨骼树在右侧面板(${n} 根)。换父骨:选中后按 P 再点新父骨(Shift+P 挂到 root),或在右侧树里把一根骨拖到另一根上。`
        : (importedSource() ? '工程里还没有骨骼:点 自动架设,或打开 编辑骨骼 后用 新建 画' : '导入工程后,右侧面板会列出骨骼树')
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
      const st = ctl ? ctl.getState() : { enabled: false, tool: 'select', selected: -1, dirty: false, canUndo: false, canRedo: false, bones: 0 }
      if (sw.checked !== !!bones.editing) sw.checked = !!bones.editing
      const ready = !bones.editing || !!previewPlayer()
      setText(swHint, bones.editing ? (ready ? '开' : '预览未就绪') : '关')
      setStyle(swHint, 'color', bones.editing && !ready ? '#ff8a7a' : 'rgba(255,255,255,0.4)')
      for (const id of Object.keys(toolBtns)) {
        const b = toolBtns[id]
        const on = bones.editing && st.tool === id
        setStyle(b, 'background', on ? '#22c98a' : '#333333')
        setStyle(b, 'color', on ? '#062a18' : 'rgba(255,255,255,0.92)')
        setDisabled(b, !bones.editing)
        setStyle(b, 'opacity', bones.editing ? '1' : '0.5')
      }
      setStyle(namesBtn, 'background', showNames ? 'rgba(30,166,114,0.18)' : '#333333')
      setStyle(namesBtn, 'color', showNames ? '#7ce8b5' : 'rgba(255,255,255,0.92)')
      setDisabled(undoBtn, !st.canUndo); setDisabled(redoBtn, !st.canRedo)
      setDisabled(delBtn, st.selected < 0 || (ctl && ctl.isOwned(st.selected)))
      setDisabled(resetBtn, !st.dirty)
      for (const b of [undoBtn, redoBtn, delBtn, resetBtn]) setStyle(b, 'opacity', b.disabled ? '0.5' : '1')
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
        if (document.activeElement !== rotIn) rotIn.value = m ? (Math.atan2(m.c, m.a) * 180 / Math.PI).toFixed(1) : '0'
        if (document.activeElement !== lenIn) lenIn.value = m ? String(Math.round(m.length * 10) / 10) : '0'
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
    undoBtn.addEventListener('click', () => { ensureController().undo() })
    redoBtn.addEventListener('click', () => { ensureController().redo() })
    delBtn.addEventListener('click', () => { const ctl = ensureController(); const st = ctl.getState(); const name = st.selected >= 0 ? ctl.getSkeleton().bones[st.selected].name : null; if (ctl.deleteSelected()) setStatus(`已删除 ${name}`, 'ok') })
    resetBtn.addEventListener('click', () => { loadBonesFromSource(true); setStatus('已回到工程里的骨架') })
    applyBtn.addEventListener('click', () => guard(async () => {
      const n = await applyBones((t) => setStatus(t))
      setStatus(`已写回 ${n} 根骨`, 'ok')
    }))
    busyButtons.push(autoBtn, applyBtn)
    busyLists.push(listWrap)

    body.appendChild(switchRow)
    body.appendChild(toolsRow)
    body.appendChild(autoBtn)
    body.appendChild(row2)
    body.appendChild(applyBtn)
    body.appendChild(status)
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
      setOpen: (v) => { state.openBones = v; if (state.fitList) state.fitList() }
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
    window.setInterval(refit, 1000)
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
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    window.setInterval(() => {
      if (state.busy) return
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
    autoRig,
    applyBones,
    setBonesEditing,
    bonesController: () => bones.ctl,
    _state: state,
    _bones: bones
  }
})()

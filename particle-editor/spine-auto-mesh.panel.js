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
  const STORAGE_OPEN = 'novaflow.autoMesh.open'
  // 自动权重 is a panel of its own (user decision 2026-09-21): meshing and binding
  // are different jobs with different things to restore
  const WEIGHTS_PANEL_ID = 'bone-auto-weights'
  const WMARK = 'data-novaflow-auto-weights-panel'
  const WTITLE = '自动权重'
  const STORAGE_OPEN_W = 'novaflow.autoWeights.panelOpen'   // not .open: an earlier build left a stale '0' there

  const state = {
    density: 22,
    open: true,
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
  state.open = readStore(STORAGE_OPEN, '1') !== '0'
  state.openWeights = readStore(STORAGE_OPEN_W, '1') !== '0'

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
  const guardWith = (setStatus) => async (fn) => {
    if (state.busy) return
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

  /** Called from the picker when the pointer moves over the preview. */
  function hoverFromCanvas(name) {
    if (name === hoverName) return
    if (hoverName) paintRow(hoverName, false)
    hoverName = name || null
    if (hoverName) {
      paintRow(hoverName, true)
      const row = rowEls.get(hoverName)
      if (row && typeof row.scrollIntoView === 'function') {
        try { row.scrollIntoView({ block: 'nearest' }) } catch { /* older engines */ }
      }
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

  function meshSpec() {
    return {
      id: PANEL_ID, mark: MARK, title: TITLE, icon: 'fas fa-vector-square', body: buildMeshBody,
      isOpen: () => state.open,
      setOpen: (v) => { state.open = v; writeStore(STORAGE_OPEN, v ? '1' : '0') }
    }
  }
  function weightsSpec() {
    return {
      id: WEIGHTS_PANEL_ID, mark: WMARK, title: WTITLE, icon: 'fas fa-project-diagram', body: buildWeightsBody,
      isOpen: () => state.openWeights,
      setOpen: (v) => { state.openWeights = v; writeStore(STORAGE_OPEN_W, v ? '1' : '0'); if (state.fitList) state.fitList() }
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
    const existing = document.querySelector(`[${MARK}="1"]`)
    const existingW = document.querySelector(`[${WMARK}="1"]`)
    if (!anchor) {
      // the 骨骼动画 section is gone; take our panels with it
      for (const e of [existing, existingW]) if (e && e.parentElement) e.parentElement.removeChild(e)
      return
    }
    let meshPanel = existing
    if (existing && existing.isConnected) {
      const misplaced = existing.previousElementSibling !== anchor
      if (allowReorder && misplaced && anchor.parentElement) {
        anchor.parentElement.insertBefore(existing, anchor.nextSibling)
      }
      matchAnchorWidth(existing, anchor)
    } else {
      meshPanel = buildPanel(meshSpec())
      anchor.parentElement.insertBefore(meshPanel, anchor.nextSibling)
      matchAnchorWidth(meshPanel, anchor)
    }
    // 自动权重 follows 自动蒙皮 the way 自动蒙皮 follows the last native panel
    if (existingW && existingW.isConnected) {
      const misplaced = existingW.previousElementSibling !== meshPanel
      if (allowReorder && misplaced && meshPanel.parentElement) {
        meshPanel.parentElement.insertBefore(existingW, meshPanel.nextSibling)
      }
      matchAnchorWidth(existingW, anchor)
    } else if (meshPanel.parentElement) {
      const wp = buildPanel(weightsSpec())
      meshPanel.parentElement.insertBefore(wp, meshPanel.nextSibling)
      matchAnchorWidth(wp, anchor)
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
    _state: state
  }
})()

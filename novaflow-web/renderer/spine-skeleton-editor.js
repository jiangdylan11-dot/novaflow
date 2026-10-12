/*
 * 骨骼动画 editor — the 动画 section's Spine-style editing workspace.
 *
 * Runs in spine-skeleton-editor.html, which spine-skeleton-editor.host.js lays over the
 * section's stage, right column and playbar (the left panels stay the app's own). The page
 * also opens on its own (the lab layout with its 导入工程 column) for development.
 *
 * Stage on the left, the 工程 tree with the properties of the picked item under it
 * on the right (Spine's layout), the 文件 menu at the top left of the stage. Content follows Spine:
 * 骨架 → 插槽 → 附件 / 皮肤占位符, 绘制顺序, 皮肤, 约束, 动画; 设置 mode edits the
 * setup pose, 动画 mode keys attachments, colours and constraint mixes.
 *
 * Every edit is a NovaFlowSpineStructureOps call on the skeleton JSON, then the
 * skeleton is rebuilt from that JSON (how the 动画 section reloads after a
 * write-back).
 */
(() => {
  'use strict'

  const Ops = window.NovaFlowSpineStructureOps
  const Attach = window.NovaFlowAutoMeshAttach
  const spine = window.spine
  const FPS = 30
  const DEG = 180 / Math.PI

  const $ = (s) => document.querySelector(s)
  // inside the 骨骼动画 section (the host's iframe): no rail / left column of its own
  const EMBED = document.documentElement.hasAttribute('data-embed')
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k === 'class') n.className = v
      else if (k === 'html') n.innerHTML = v
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
      else if (k in n && k !== 'list') n[k] = v
      else n.setAttribute(k, v === true ? '' : v)
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k))
    return n
  }

  const state = {
    name: '',
    fileName: 'skeleton.json',
    json: null,
    atlasText: '',
    atlasName: 'skeleton.atlas',
    atlasChanged: false,
    images: new Map(), // lower-case file name -> { img, fileName, blob }
    addedImages: [],
    history: [],
    future: [],
    mode: 'setup',
    anim: '',
    frame: 0,
    playing: false,
    skin: 'default',
    sel: null, // { kind: 'bone'|'slot'|'att'|'ph'|'ik'|'transform'|'path'|'skin', name, slot?, skin? }
    multi: [], // bone names (Ctrl+click)
    multiSlots: [], // slot names (Ctrl / Shift in the tree): edited together
    multiCons: [], // constraints (Ctrl in the tree): { kind, name }, together in the dopesheet
    panel: 'import',
    pick: null,
    tool: 'rotate',
    lastTool: 'move',
    autoKey: true, // 自动关键帧 is always on
    opt: { boneSel: true, boneVis: true, boneName: false, imgSel: true, imgVis: true, imgName: false, otherSel: true, otherVis: true, otherName: false },
    importFiles: { json: null, atlas: null, images: [] },
    vsel: { slot: null, indices: new Set() }, // picked mesh vertices (animate mode)
    jointEdit: false, // 改关节: drag a bone's start / end, the bones on that joint follow (also Shift)
    dope: { pxf: 0, f0: 0, scrollY: 0, keySel: [], clip: null, rows: [], tracks: new Map(), focus: false, curveDrag: null,
      // 筛选: which kinds of rows the dopesheet shows; keyedOnly hides rows without keys
      filter: { rotate: true, translate: true, scale: true, shear: true, attachment: true, color: true, deform: true, cons: true, events: true, drawOrder: true, keyedOnly: true }, shift: false, offset: false, adjust: false },
    hiddenBones: new Set(),
    hiddenSlots: new Set(),
    search: '',
    box: null,
    anchor: null,
    axes: 'local', // Spine axes: local / parent / world
    comp: { bones: false, images: false }, // Spine compensate
    createAtts: [], // create tool: slots Ctrl-picked to go onto the new bone
    selHistory: [],
    selIdx: -1,
    groups: {},
    alwaysName: new Set(),
    unselectable: new Set(),
    filter: { bones: true, slots: true, region: true, mesh: true, bbox: true, clipping: true, path: true, point: true, placeholder: true },
    temp: new Map(), // bone -> { x, y, rotation, scaleX, scaleY } local, preview only
    collapsed: new Set(),
    sections: new Set(['order']),
    dup: { children: true, slots: true, constraints: true, animation: true },
    pma: false,
    hover: null,
    hoverImg: null, // 选择图层: the slot whose image is under the pointer
    imageFolder: null, // Spine's images folder: { name, list() } (指定文件夹 in the image picker)
    offset: { x: 0, y: 0 }, // where this project sits on the stage, beside the others (view only, not exported)
    loop: true, // 循环 (the 动画 section's transport): off = playback stops on the last frame
    meshEdit: null, // 编辑网格: { skin, slot, name, tool, isolate, deform, sel, draft }
    weightEdit: null, // 编辑权重: { skin, slot, name, bone, mode, strength, size, feather, overlay, onlySel, isolate, direct, vsel, binding, order, extra }
    traceOpts: null,  // 描绘 settings, kept for the session (Spine keeps them too)
    clipEdit: null,   // 编辑剪裁: { skin, slot, name, tool: 'create' | 'delete' }
    clipDrag: null,
    leftOpen: 'import', // the left column: one panel open at a time
    initialJson: null, // the project as imported (还原初始图层 / 还原原始权重)
    unticked: new Set(), // 自动蒙皮 / 自动权重: layers (slot names) left out; one tick for both panels
    frameSet: null, // 序列K帧 / 序列扫光: the pictures on the cards (null = the image folder's root), [{ name, file?, region? }]
    imgOpen: new Set(), // 工程树 图片 node: the subfolders unfolded (paths)
    frameUnticked: { sequence: new Set(), sweep: new Set() }, // pictures (names) left out, one tick a tool
    seqGap: 1, // 序列K帧: frames between two pictures (1 = one picture a frame)
    sweepStart: 0, // 序列扫光: the sweep runs from this frame…
    sweepEnd: 0, // …to this one (0 = the animation's last frame; empty animation: 5 frames a picture)
    sweepParams: null, // 序列扫光 generator: the dialog's last parameters (this session)
    sweepGen: null, // 序列扫光 generator: the last generated set { base, baseSlot, bone, blend, wrap, names } (写入 places its slots)
    frameBone: 'root', // 序列K帧 / 序列扫光: the bone the frames' slots hang on (user: root by default)
    meshDensity: 18, // 自动蒙皮 密度 (the production default)
    meshDrag: null,
    meshPointer: null,
    roles: new Map(),
    drag: null,
    creating: null,
  }

  const rt = { gl: null, renderer: null, atlas: null, atlasKey: null, data: null, skeleton: null, cam: { x: 0, y: 0, zoom: 1 }, w: 1, h: 1, dpr: 1, missingPages: new Set(), missingRegions: new Set() }

  // ------------------------------------------------------------------ icons

  const ICON = {
    import: '<svg viewBox="0 0 16 16"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 11v2.5h11V11" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    bone: '<svg viewBox="0 0 16 16"><path d="M2 14 5 7l4 4z M5 7l9-5-5 9" fill="currentColor"/></svg>',
    slot: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    region: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 12l3-4 2 2.5 1.5-1.5 2 3z" fill="currentColor"/></svg>',
    mesh: '<svg viewBox="0 0 16 16"><path d="M2.5 3h11v10h-11z M2.5 3l5.5 5 5.5-5 M2.5 13l5.5-5 5.5 5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    placeholder: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 1.6"/><path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.3"/></svg>',
    other: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/></svg>',
    ik: '<svg viewBox="0 0 16 16"><circle cx="11" cy="5" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 14l5-5 2 2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    transform: '<svg viewBox="0 0 16 16"><path d="M8 1.5v13M1.5 8h13M8 1.5l-2 2M8 1.5l2 2M14.5 8l-2-2M14.5 8l-2 2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    path: '<svg viewBox="0 0 16 16"><path d="M2 12c3-8 9 0 12-8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    skin: '<svg viewBox="0 0 16 16"><path d="M5 2 2 4.5 3.5 7 5 6v8h6V6l1.5 1L14 4.5 11 2c-.5 1.2-1.6 2-3 2S5.5 3.2 5 2z" fill="currentColor"/></svg>',
    anim: '<svg viewBox="0 0 16 16"><path d="M5 3v10l8-5z" fill="currentColor"/></svg>',
    event: '<svg viewBox="0 0 16 16"><path d="M3 2.5h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5l-3 2.5V11H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 4.6v3.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="9.3" r=".85" fill="currentColor"/></svg>',
    order: '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.5"/></svg>',
    project: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4.5l1.5 1.5h6v7.5H2z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    cons: '<svg viewBox="0 0 16 16"><circle cx="4" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 10.5l5-5" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.5"/></svg>',
    chev: '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    right: '<svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    down: '<svg viewBox="0 0 16 16"><path d="M4.5 6.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shear: '<svg viewBox="0 0 16 16"><path d="M5.5 3h8l-3 10h-8z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    pose: '<svg viewBox="0 0 16 16"><circle cx="8" cy="3.2" r="1.8" fill="currentColor"/><path d="M8 5.5v4.5M8 6.8 4 9M8 6.8l4-2.3M8 10l-3 4.3M8 10l3 4.3" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    key: '<svg viewBox="0 0 16 16"><circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8h6.5M12.2 8v3M14.5 8v2.2" stroke="currentColor" stroke-width="1.7" fill="none"/></svg>',
    link: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.8 9.2 9.2 6.8"/><path d="M7.6 4.6 9 3.2a2.6 2.6 0 0 1 3.8 3.8l-1.4 1.4"/><path d="M8.4 11.4 7 12.8a2.6 2.6 0 0 1-3.8-3.8l1.4-1.4"/></svg>',
    folder: '<svg viewBox="0 0 16 16"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 10.5v-7a1 1 0 0 1 1-1h7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    slotdot: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>',
    move: '<svg viewBox="0 0 16 16"><path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    rotate: '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    scale: '<svg viewBox="0 0 16 16"><path d="M2 14 14 2M9 2h5v5M7 14H2V9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    joint: '<svg viewBox="0 0 16 16"><path d="M2.5 13.5 7.5 8.5M8.5 7.5 13.5 2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    create: '<svg viewBox="0 0 16 16"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.8"/></svg>',
    clip: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="4.5" cy="11.8" r="2"/><circle cx="11.5" cy="11.8" r="2"/><path d="M5.8 10.3 12.5 2.5M10.2 10.3 3.5 2.5"/></svg>',
    // Spine's mode marks: a figure standing in the setup pose, a running figure for 动画
    standing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2.2" fill="currentColor" stroke="none"/><path d="M4 9.5 8 8h8l4 1.5M12 8v6.5M12 14.5l-2.6 7M12 14.5l2.6 7"/></svg>',
    running: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="15.5" cy="3.8" r="2.2" fill="currentColor" stroke="none"/><path d="M13.8 7.6 11 13.6M13.4 8.6l4.4 2.4M13.4 8.6 9.4 9.8 7 8.2M11 13.6l4.2 2.6-.6 5.2M11 13.6l-3 3.6-4.2.4"/></svg>',
    // Spine's options columns: 选择 / 显示 / 名称
    optSel: '<svg viewBox="0 0 16 16"><path d="M4 2.2v10.9l2.9-2.7 2 4.4 1.9-.9-2-4.2 4-.3Z" fill="currentColor"/></svg>',
    optVis: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/></svg>',
    optName: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 2.5h5.3l5.7 5.7-5.3 5.3-5.7-5.7Z"/><circle cx="5.6" cy="5.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
    // the 动画 section's transport
    toStart: '<svg viewBox="0 0 16 16"><path d="M4 3v10M12.5 3.5 6.5 8l6 4.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    stepBack: '<svg viewBox="0 0 16 16"><path d="M10.5 3.5 4.5 8l6 4.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12.5 3v10" stroke="currentColor" stroke-width="1.5"/></svg>',
    stepFwd: '<svg viewBox="0 0 16 16"><path d="M5.5 3.5l6 4.5-6 4.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3.5 3v10" stroke="currentColor" stroke-width="1.5"/></svg>',
    toEnd: '<svg viewBox="0 0 16 16"><path d="M12 3v10M3.5 3.5l6 4.5-6 4.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    loop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M5 3.2 12.5 8 5 12.8Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  }
  const icon = (k, cls = 'ico') => h('span', { class: cls, html: ICON[k] || ICON.other })

  // ------------------------------------------------------------------ status (toast)

  let toastTimer = 0
  function status(msg, kind) {
    const t = $('#toast')
    if (!msg) { t.dataset.show = ''; return }
    t.textContent = msg
    t.dataset.kind = kind || ''
    t.dataset.show = '1'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { t.dataset.show = '' }, kind === 'error' ? 5000 : 2600)
  }

  // ------------------------------------------------------------------ loading

  const lower = (s) => String(s || '').toLowerCase()
  const baseName = (p) => String(p || '').split(/[\\/]/).pop()
  const stem = (p) => baseName(p).replace(/\.[^.]+$/, '')

  async function imageFromBlob(blob) {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  }

  /** Straight-alpha PNGs show colour > alpha on soft edges; PMA ones never do. */
  function looksPremultiplied(img) {
    try {
      const c = document.createElement('canvas')
      const w = Math.min(256, img.naturalWidth)
      const hh = Math.min(256, img.naturalHeight)
      c.width = w; c.height = hh
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, w, hh)
      const d = ctx.getImageData(0, 0, w, hh).data
      let soft = 0, over = 0
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3]
        if (a === 0 || a === 255) continue
        soft++
        if (Math.max(d[i], d[i + 1], d[i + 2]) > a + 6) over++
      }
      return soft > 50 && over / soft < 0.02
    } catch { return false }
  }

  /**
   * The app's imported project (`__NOVA_SPINE_LAST_SOURCE`): { skeleton: { fileName, text },
   * atlas: { fileName, text }, images: [{ fileName, dataUrl }] }.
   */
  async function loadSource(src, opts) {
    if (!src || !src.skeleton || !src.skeleton.text) throw new Error('没有工程')
    const json = JSON.parse(src.skeleton.text)
    const raw = Array.isArray(src.images) ? src.images
      : Object.entries(src.images || {}).map(([fileName, v]) => ({ fileName, dataUrl: typeof v === 'string' ? v : v && (v.dataUrl || v.url) }))
    const files = []
    const seen = new Set()
    for (const it of raw) {
      const url = it && (it.dataUrl || it.url || it.src)
      const fileName = String((it && (it.fileName || it.name)) || '').replace(/\\/g, '/')
      if (!url || !fileName || seen.has(lower(fileName))) continue
      seen.add(lower(fileName))
      try { files.push({ fileName, blob: await (await fetch(url)).blob() }) } catch { /* an image that does not decode is left out */ }
    }
    const name = String(src.skeleton.fileName || 'skeleton.json')
    // a project opened from a folder (the app's 导入PS工程 keeps the folder handle): its image folder,
    // listed live from disk; loose files (JSON + atlas + PNG) have no folder to watch
    // (the app's PS import synthesizes an atlas and keeps only the pictures attachments use, so the
    // folder is the only place the unused ones show up)
    let imageFolder = null
    const dir = opts && opts.directory
    if (dir && dir.handle) { try { imageFolder = await folderForProject(dir.handle, json, name) } catch { imageFolder = null } }
    if (!imageFolder && dir && Array.isArray(dir.files) && dir.files.length) { try { imageFolder = folderFromProjectFiles(dir.files, json, name) } catch { imageFolder = null } }
    // the same skeleton file again (a write-back, a re-import of that file) replaces the picked project; another one is added
    const replace = !!(state.json && projects[activeProject] && lower(state.fileName) === lower(name))
    await loadParts({ json, jsonName: name, atlasText: (src.atlas && src.atlas.text) || '', atlasName: src.atlas && src.atlas.fileName, images: files, imageFolder, label: stem(name), replace })
  }

  async function loadFiles(files, label) {
    const list = Array.from(files || [])
    const jsons = list.filter((f) => /\.json$/i.test(f.name))
    const atlases = list.filter((f) => /\.(atlas|atlas\.txt)$/i.test(f.name))
    const imgs = list.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
    if (!jsons.length) throw new Error('没有找到骨架 JSON')
    let json = null, jsonFile = null
    for (const f of jsons) {
      try {
        const parsed = JSON.parse(await f.text())
        if (parsed && parsed.bones) { json = parsed; jsonFile = f; break }
      } catch {}
    }
    if (!json) throw new Error('JSON 不是 Spine 骨架')
    // images keep their folders: relative to the skeleton's image folder (or the JSON's folder)
    const dirOf = (p) => String(p || '').split('/').slice(0, -1).join('/')
    const norm = (p) => p.split('/').filter((x) => x && x !== '.').join('/')
    const jsonDir = dirOf(jsonFile.webkitRelativePath || '')
    const imgRoot = norm(jsonDir + '/' + String((json.skeleton && json.skeleton.images) || ''))
    const relName = (f) => {
      const rel = norm(f.webkitRelativePath || '')
      if (!rel) return f.name
      for (const root of [imgRoot, jsonDir]) if (root && rel.startsWith(root + '/')) return rel.slice(root.length + 1)
      return f.name
    }
    let atlasText = '', atlasName = ''
    if (atlases.length) {
      const pick = atlases.find((a) => stem(a.name) === stem(jsonFile.name)) || atlases[0]
      atlasText = await pick.text()
      atlasName = pick.name
    }
    // a project opened as a folder brings its image folder (Spine's images path) along
    const rooted = imgs.filter((f) => f.webkitRelativePath)
    // (only loose images: with an atlas the PNGs next to it are atlas pages, not the pictures)
    const imageFolder = rooted.length && !atlases.length ? folderFromFiles((imgRoot || jsonDir).split('/').pop() || '图片', rooted.map((f) => ({ rel: relName(f), file: f }))) : null
    await loadParts({ json, jsonName: jsonFile.name, atlasText, atlasName, images: imgs.map((f) => ({ fileName: relName(f), blob: f })), imageFolder, label })
  }

  /** One project from its parts: the JSON, the atlas text (none = one page per picture), the images. */
  async function loadParts(p) {
    let json = p.json
    // a Spine 4.x project is edited as 3.8 and goes back to its own version on export
    const SV = window.NovaFlowSpineVersion
    const fromVersion = SV && SV.is4(json) ? SV.versionOf(json) : ''
    if (fromVersion) json = SV.toSpine38(json)
    Attach.normalizeToSpine38(json)
    const jsonFile = { name: p.jsonName || 'skeleton.json' }
    const label = p.label
    const imageFolder = p.imageFolder || null
    const images = new Map()
    for (const f of p.images || []) images.set(lower(f.fileName), { img: await imageFromBlob(f.blob), fileName: f.fileName, blob: f.blob })
    let atlasText = p.atlasText || ''
    let atlasName = p.atlasName || stem(jsonFile.name) + '.atlas'
    let atlasChanged = false
    let atlasPma = null
    if (atlasText && SV && SV.atlasToSpine38) {
      // any atlas layout (4.x bounds / offsets / pma lines) as the one the 3.8 runtime reads
      const a = SV.atlasToSpine38(atlasText)
      if (a.pages) { atlasText = a.text; atlasPma = a.pma }
    }
    if (!atlasText) {
      // a PhotoshopToSpine export: every layer PNG is its own atlas page
      atlasText = Attach.synthesizeAtlas([...images.values()].map((i) => ({ fileName: i.fileName, width: i.img.naturalWidth, height: i.img.naturalHeight })))
      atlasChanged = true
    }
    // several projects side by side (Spine's hierarchy): the one open so far keeps its whole state
    if (state.json && projects[activeProject] && !p.replace) projects[activeProject].snap = snapProject()
    leaveProjectEdits()
    Object.assign(state, {
      imageFolder,
      name: label || stem(jsonFile.name), fileName: jsonFile.name, atlasName, atlasChanged, images,
      addedImages: [], atlasText, history: [], future: [], sel: null, multi: [], multiSlots: [], multiCons: [], pick: null,
      offset: p.offset && Number.isFinite(p.offset.x) && Number.isFinite(p.offset.y) ? { x: p.offset.x, y: p.offset.y } : { x: 0, y: 0 },
      skin: 'default', frame: 0, playing: false, mode: 'setup', panel: 'bone',
    })
    state.temp.clear()
    state.collapsed.clear()
    const first = [...images.values()][0]
    state.pma = atlasPma != null && atlasPma ? true : first ? looksPremultiplied(first.img) : false
    rt.atlasKey = null
    rt.missingPages = new Set()
    rt.missingRegions = new Set()
    applyJson(Ops.tidy(Ops.prepare(json)))
    state.initialJson = state.json
    state.unticked = new Set()
    state.frameSet = null; state.frameUnticked = { sequence: new Set(), sweep: new Set() }; state.sweepStart = 0; state.sweepEnd = 0; state.sweepGen = null
    state.imgOpen = new Set(); imgTree = { key: '', nodes: new Map(), pending: new Set() }
    frameRoot = null; frameRootPending = null; frameThumbs.clear()
    state.frameBone = state.json.bones.some((b) => b.name === 'root') ? 'root' : (state.json.bones[0] || {}).name || ''
    state.anim = Object.keys(state.json.animations || {})[0] || ''
    // big rigs open readable: deep bones and every slot start collapsed (Spine opens at the root)
    for (const b of state.json.bones) if (depthOf(b.name) >= 2) state.collapsed.add('b:' + b.name)
    for (const s of state.json.slots) state.collapsed.add('s:' + s.name)
    // every import is a project of its own, after the ones already open; it is the one picked
    if (!(p.replace && projects[activeProject])) {
      if (projects[activeProject]) projects[activeProject].open = false
      projects.push({ id: ++projectSerial, snap: null, visible: p.visible !== false, open: true })
      activeProject = projects.length - 1
    }
    fit()
    $('#dropHint').hidden = true
    $('#tree').scrollTop = 0
    refresh()
    const lost = [...rt.missingPages, ...rt.missingRegions]
    if (lost.length) status(`已载入 ${state.name}，缺少图片：${lost.slice(0, 4).join('、')}${lost.length > 4 ? ` 等 ${lost.length} 张` : ''}（这些附件先显示为空）`, 'error')
    else status(`已载入 ${state.name}：${state.json.bones.length} 骨骼，${state.json.slots.length} 插槽${fromVersion ? `（Spine ${fromVersion} 工程，导出时保持 ${fromVersion}）` : ''}`, 'ok')
  }

  // ------------------------------------------------------------------ several projects (Spine's hierarchy)
  // Spine keeps several skeletons in one hierarchy. Here every import adds a project; the picked one
  // is on the stage and unfolded in the tree, the others are rows that keep their whole editing state
  // (undo included) until they are picked again. They can be renamed, moved and deleted.
  const PROJECT_KEYS = ['name', 'fileName', 'json', 'atlasText', 'atlasName', 'atlasChanged', 'images', 'addedImages', 'history', 'future', 'offset',
    'mode', 'anim', 'frame', 'skin', 'sel', 'multi', 'multiSlots', 'multiCons', 'hiddenBones', 'hiddenSlots', 'collapsed', 'sections',
    'initialJson', 'unticked', 'frameSet', 'frameUnticked', 'imgOpen', 'imageFolder', 'pma', 'frameBone', 'sweepStart', 'sweepEnd',
    'sweepGen', 'seqGap', 'selHistory', 'selIdx', 'groups', 'alwaysName', 'unselectable', 'dopeExtra', 'vsel']
  const projects = [] // { id, snap }: the picked project's snap is null (state holds it)
  let activeProject = -1, projectSerial = 0

  function snapProject() {
    const snap = {}
    for (const k of PROJECT_KEYS) snap[k] = state[k]
    snap.cam = { ...rt.cam }
    snap.temp = new Map(state.temp)
    return snap
  }

  /** Out of the edit modes that hold a project's attachment (编辑网格 / 权重 / 剪裁), before it changes. */
  function leaveProjectEdits() {
    state.meshEdit = null; state.weightEdit = null; state.clipEdit = null; state.clipDrag = null
    state.pick = null; state.playing = false; state.drag = null
  }

  function restoreProject(snap) {
    leaveProjectEdits()
    for (const k of PROJECT_KEYS) state[k] = snap[k]
    state.temp.clear()
    for (const [k, v] of snap.temp || []) state.temp.set(k, v)
    rt.atlasKey = null
    rt.missingPages = new Set()
    rt.missingRegions = new Set()
    imgTree = { key: '', nodes: new Map(), pending: new Set() }
    frameRoot = null; frameRootPending = null; frameThumbs.clear()
    if (!state.offset) state.offset = { x: 0, y: 0 }
    dropProjectRuntime(projects[activeProject] && projects[activeProject].id)
    applyJson(state.json)
    $('#dropHint').hidden = true
    refresh()
  }

  const projectName = (i) => (i === activeProject ? state.name : (projects[i] && projects[i].snap ? projects[i].snap.name : ''))

  // the projects that are not picked are drawn too (Spine shows every skeleton of its hierarchy): each has
  // its own atlas and skeleton, rebuilt when its data changed, posed as it was left (setup, or its frame)
  const otherRt = new Map() // project id -> { json, atlasText, atlas, data, skeleton }
  function pageImageFrom(images, name) {
    const hit = images.get(lower(name)) || images.get(lower(baseName(name))) || [...images.values()].find((i) => lower(stem(i.fileName)) === lower(stem(name)))
    if (hit) return hit.img
    const c = document.createElement('canvas')
    c.width = 1; c.height = 1
    return c
  }
  function readProjectData(json, atlas, gl) {
    const copy = Ops.editorData(json)
    const v = String(copy.skeleton && copy.skeleton.spine || '')
    if (!v.startsWith('3.8') || v === '3.8.75') copy.skeleton = { ...(copy.skeleton || {}), spine: '3.8.99' }
    return new spine.SkeletonJson(tolerantLoader(atlas, gl)).readSkeletonData(copy)
  }
  function projectRuntime(p) {
    const s = p.snap
    let r = otherRt.get(p.id)
    if (r && r.json === s.json && r.atlasText === s.atlasText) return r
    dropProjectRuntime(p.id)
    const gl = rt.renderer.context || rt.gl
    const atlas = new spine.TextureAtlas(s.atlasText, (path) => new spine.webgl.GLTexture(gl, pageImageFrom(s.images, path)))
    const data = readProjectData(s.json, atlas, gl)
    r = { json: s.json, atlasText: s.atlasText, atlas, data, skeleton: new spine.Skeleton(data) }
    otherRt.set(p.id, r)
    return r
  }
  function dropProjectRuntime(id) {
    const r = otherRt.get(id)
    if (r && r.atlas) try { r.atlas.dispose() } catch { /* the context went away */ }
    otherRt.delete(id)
  }
  function drawOtherProject(i) {
    const p = projects[i]
    if (!p || !p.snap || !p.snap.json || p.visible === false) return
    let r
    try { r = projectRuntime(p) } catch { return }
    const s = p.snap, sk = r.skeleton
    sk.setSkin(null)
    if (s.skin && s.skin !== 'default' && r.data.findSkin(s.skin)) sk.setSkinByName(s.skin)
    sk.setToSetupPose()
    const an = s.mode === 'animate' && s.anim ? r.data.findAnimation(s.anim) : null
    if (an) an.apply(sk, 0, (s.frame || 0) / FPS, false, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
    sk.updateWorldTransform()
    const saved = []
    for (const n of s.hiddenSlots || []) { const sl = sk.findSlot(n); if (sl && sl.attachment) { saved.push([sl, sl.attachment]); sl.attachment = null } }
    for (const sl of sk.slots) if (sl.attachment instanceof spine.ClippingAttachment && sl.attachment.worldVerticesLength < 6) { saved.push([sl, sl.attachment]); sl.attachment = null }
    const off = s.offset || { x: 0, y: 0 }, rr = rt.renderer
    rr.camera.position.x = rt.cam.x - off.x
    rr.camera.position.y = rt.cam.y - off.y
    rr.camera.setViewport($('#gl').width, $('#gl').height)
    rr.camera.zoom = rt.cam.zoom / rt.dpr
    rr.begin()
    rr.drawSkeleton(sk, !!s.pma)
    rr.end()
    for (let k = saved.length - 1; k >= 0; k--) saved[k][0].attachment = saved[k][1]
  }

  function setProjectVisible(i, on) {
    if (!projects[i]) return
    projects[i].visible = !!on
    renderTree()
  }

  /** The picked project's place on the stage (属性 X / Y, or a drag with the project picked). */
  function setProjectOffset(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    state.offset = { x, y }
  }

  function switchProject(i) {
    if (i === activeProject || !projects[i] || !projects[i].snap) return
    if (projects[activeProject]) { projects[activeProject].snap = snapProject(); projects[activeProject].open = false }
    const snap = projects[i].snap
    activeProject = i
    projects[i].snap = null
    restoreProject(snap)
    status(`已切换到工程 ${state.name}`, 'ok')
  }

  /** A copy of a project's state that edits apart from the original (pictures are shared, they never change in place). */
  function cloneProjectSnap(src) {
    const out = {}
    for (const [k, v] of Object.entries(src)) {
      if (v instanceof Set) out[k] = new Set(v)
      else if (v instanceof Map) out[k] = new Map(v)
      else if (v && typeof v === 'object') { try { out[k] = structuredClone(v) } catch { out[k] = Array.isArray(v) ? v.slice() : { ...v } } }
      else out[k] = v
    }
    return out
  }

  /** 复制工程 (Spine's Duplicate on a skeleton): the copy comes right below, at the same place, and is picked. */
  function duplicateProject(i) {
    if (!projects[i]) return
    const src = i === activeProject ? snapProject() : projects[i].snap
    if (!src || !src.json) return
    const copy = cloneProjectSnap(src)
    const taken = new Set(projects.map((_, k) => projectName(k)))
    const base = String(src.name || '').replace(/ 副本( \d+)?$/, '')
    let name = `${base} 副本`
    for (let n = 2; taken.has(name); n++) name = `${base} 副本 ${n}`
    copy.name = name
    copy.history = []; copy.future = []
    copy.sel = { kind: 'project', name }
    projects.splice(i + 1, 0, { id: ++projectSerial, snap: copy, visible: projects[i].visible !== false, open: true })
    if (activeProject > i) activeProject++
    switchProject(i + 1)
    projects[i + 1].open = true
    renderTree()
    status(`已复制工程 ${src.name} → ${name}`, 'ok')
  }

  function renameProject(i, name) {
    const v = String(name || '').trim()
    if (!v || !projects[i]) return
    if (i === activeProject) state.name = v
    else projects[i].snap.name = v
    renderTree()
    status(`工程已改名为 ${v}`, 'ok')
  }

  function moveProject(from, to) {
    if (from === to || !projects[from] || to < 0 || to > projects.length) return
    const activeId = projects[activeProject] && projects[activeProject].id
    const [p] = projects.splice(from, 1)
    projects.splice(to > from ? to - 1 : to, 0, p)
    activeProject = projects.findIndex((x) => x.id === activeId)
    renderTree()
  }

  function deleteProject(i) {
    if (!projects[i]) return
    const name = projectName(i)
    if (!window.confirm(`删除工程「${name}」？没保存的改动会丢失（可以先用 保存工程 存一份）。`)) return
    const activeId = projects[activeProject] && projects[activeProject].id
    const wasActive = i === activeProject
    dropProjectRuntime(projects[i].id)
    projects.splice(i, 1)
    if (!wasActive) { activeProject = projects.findIndex((x) => x.id === activeId); renderTree(); status(`已删除工程 ${name}`, 'ok'); return }
    if (projects.length) {
      // the neighbour below (or above, for the last one) becomes the picked project
      const next = Math.min(i, projects.length - 1)
      const snap = projects[next].snap
      activeProject = next
      projects[next].snap = null
      restoreProject(snap)
    } else {
      leaveProjectEdits()
      activeProject = -1
      state.json = null; state.history = []; state.future = []; state.sel = null
      rt.data = null; rt.skeleton = null
      $('#dropHint').hidden = false
      refresh()
    }
    status(`已删除工程 ${name}`, 'ok')
  }

  // NovaFlow's own project file (.nfproj): every open project in one file - skeleton (the editor's
  // data, the original Spine version kept inside), atlas, pictures, names, order and the picked one.
  // gzip-compressed JSON; 导入工程 opens it, 保存工程 writes it.
  const PROJECT_FILE_FORMAT = 'novaflow-spine-projects'
  const blobToDataUrl = (b) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(b) })

  async function projectFileBytes() {
    const list = []
    for (let i = 0; i < projects.length; i++) {
      const s = i === activeProject ? state : projects[i].snap
      if (!s || !s.json) continue
      const images = []
      for (const im of s.images.values()) if (im.blob) images.push({ fileName: im.fileName, dataUrl: await blobToDataUrl(im.blob) })
      list.push({ name: s.name, fileName: s.fileName, atlasName: s.atlasName, atlasText: s.atlasText, json: s.json, images, offset: s.offset || { x: 0, y: 0 }, visible: projects[i].visible !== false })
    }
    if (!list.length) throw new Error('没有可保存的工程')
    const text = JSON.stringify({ format: PROJECT_FILE_FORMAT, version: 1, active: Math.max(0, activeProject), projects: list })
    const gz = new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')))
    return { bytes: new Uint8Array(await gz.arrayBuffer()), count: list.length }
  }

  /** 保存工程: every open project into one .nfproj, straight to a save dialog named after the picked project. */
  async function saveProjectFileNow() {
    const A = window.NovaFlowSequenceAtlas
    const name = (A && A.safeName ? A.safeName(state.name) : String(state.name || '').replace(/[\\/:*?"<>|]+/g, '_')) || 'project'
    const { bytes, count } = await projectFileBytes()
    const file = new Blob([bytes], { type: 'application/octet-stream' })
    if (window.showSaveFilePicker) {
      let handle
      try { handle = await window.showSaveFilePicker({ suggestedName: name + '.nfproj', types: [{ description: 'NovaFlow 工程', accept: { 'application/octet-stream': ['.nfproj'] } }] }) } catch { return null }
      const w = await handle.createWritable(); await w.write(file); await w.close()
    } else {
      const a = h('a', { href: URL.createObjectURL(file), download: name + '.nfproj' })
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
    }
    status(`已保存 NovaFlow 工程 ${name}.nfproj：${count} 个工程`, 'ok')
    return { name: name + '.nfproj', count }
  }

  /** Opens a .nfproj: its projects come in after the ones already open; its picked one is picked. */
  async function openProjectFile(data) {
    const blob = data instanceof Blob ? data : new Blob([data])
    let d
    try { d = JSON.parse(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()) } catch { throw new Error('不是 NovaFlow 工程文件') }
    if (!d || d.format !== PROJECT_FILE_FORMAT || !Array.isArray(d.projects) || !d.projects.length) throw new Error('不是 NovaFlow 工程文件')
    const first = projects.length
    for (const p of d.projects) {
      const images = await Promise.all((p.images || []).map(async (im) => ({ fileName: im.fileName, blob: await (await fetch(im.dataUrl)).blob() })))
      await loadParts({ json: p.json, jsonName: p.fileName, atlasText: p.atlasText, atlasName: p.atlasName, images, label: p.name, offset: p.offset, visible: p.visible })
    }
    switchProject(first + Math.max(0, Math.min(d.projects.length - 1, Number(d.active) || 0)))
    status(`已打开 NovaFlow 工程：${d.projects.length} 个工程`, 'ok')
    return d.projects.length
  }

  /** The 工程 属性 X / Y boxes follow a drag (the rest of the panel stays). */
  function syncProjectFields() {
    const boxes = document.querySelectorAll('#props [data-offset]')
    for (const i of boxes) if (document.activeElement !== i) i.value = String(Math.round(state.offset[i.dataset.offset] * 100) / 100)
  }

  /** 工程 属性: name, its place on the stage (X / Y, view only), shown or not. */
  function projectBody() {
    const num = (k) => {
      const i = numInput(Math.round(state.offset[k] * 100) / 100, (v) => { setProjectOffset(k === 'x' ? v : state.offset.x, k === 'y' ? v : state.offset.y); renderProps() })
      i.dataset.offset = k
      return field(k.toUpperCase(), i)
    }
    const shown = projects[activeProject] ? projects[activeProject].visible !== false : true
    return [
      h('div', { class: 'name-row' },
        textInput(state.name, (v) => renameProject(activeProject, v), { rename: true }),
        ibtn('copy', '复制工程（Ctrl+D）', () => duplicateProject(activeProject)),
        ibtn('trash', '删除工程（Delete）', () => deleteProject(activeProject))),
      h('div', { class: 'grid2' }, num('x'), num('y')),
      field('显示', h('div', { class: 'inline' }, h('label', { class: 'checks', style: 'margin:0' }, check('', shown, (v) => setProjectVisible(activeProject, v))))),
      h('div', { class: 'hint' }, '位置只影响编辑器里的摆放，不写进导出的骨架；选中工程后在画面上拖动也能移动它。'),
    ]
  }

  /** The project rows of the tree: the picked one unfolded (its content follows), the others folded. */
  function projectRow(i, pad) {
    const active = i === activeProject
    const name = projectName(i)
    const row = h('div', { class: 'row node project', style: pad(0), 'data-project': String(i), 'data-active': active ? '1' : null,
      'data-selected': active && state.sel && state.sel.kind === 'project' ? '1' : null,
      title: `${name}（双击改名，拖动排序，左边箭头展开 / 收起）`,
      onclick: () => { if (!active) switchProject(i); select({ kind: 'project', name: projectName(i) }) },
      ondblclick: (e) => {
        e.stopPropagation()
        const label = row.querySelector('.label')
        const input = h('input', { class: 'rename', value: name })
        const done = (ok) => { if (ok) renameProject(i, input.value); else renderTree() }
        input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false) })
        input.addEventListener('blur', () => done(true))
        input.addEventListener('click', (ev) => ev.stopPropagation())
        label.replaceWith(input)
        input.focus(); input.select()
      } },
      visDot(projects[i].visible !== false, () => setProjectVisible(i, projects[i].visible === false), null, true),
      caret(active && projects[i].open !== false, () => {
        if (active) { projects[i].open = projects[i].open === false; renderTree(); return }
        switchProject(i)
        projects[i].open = true
        renderTree()
      }), h('span', { class: 'ico', html: ICON.project }), h('span', { class: 'label' }, name),
      h('span', { class: 'end' }, h('button', { class: 'act', title: `删除工程 ${name}`, onclick: (e) => { e.stopPropagation(); deleteProject(i) } }, '删除')))
    // drag a project row onto another one to move it there (above / below)
    row.draggable = true
    row.addEventListener('dragstart', (e) => { state.drag = { type: 'project', index: i }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', name) })
    row.addEventListener('dragend', () => { state.drag = null; for (const r of document.querySelectorAll('.row[data-drop]')) r.removeAttribute('data-drop') })
    row.addEventListener('dragover', (e) => {
      if (!state.drag || state.drag.type !== 'project' || state.drag.index === i) return
      e.preventDefault()
      const r = row.getBoundingClientRect()
      row.dataset.drop = e.clientY > r.top + r.height / 2 ? 'below' : 'above'
    })
    row.addEventListener('dragleave', () => row.removeAttribute('data-drop'))
    row.addEventListener('drop', (e) => {
      const d = state.drag, below = row.dataset.drop === 'below'
      row.removeAttribute('data-drop')
      state.drag = null
      if (!d || d.type !== 'project') return
      e.preventDefault()
      moveProject(d.index, i + (below ? 1 : 0))
    })
    return row
  }

  async function loadSample(key) {
    const sets = {
      jiaye: ['samples/jiaye/a.json', 'samples/jiaye/a.atlas', 'samples/jiaye/a.png'],
      wild: ['samples/wild/wild.json', 'samples/wild/wild.atlas', 'samples/wild/wild.png', 'samples/wild/wild_0.png'],
      cloud: ['samples/cloud/cloud.json', 'samples/cloud/cloud.atlas', 'samples/cloud/cloud.png'],
    }
    const files = []
    for (const p of sets[key] || []) {
      const r = await fetch(p)
      if (!r.ok) throw new Error('缺少示例文件 ' + p)
      files.push(new File([await r.blob()], baseName(p)))
    }
    await loadFiles(files, { jiaye: '伽夜' }[key] || key)
  }

  // ------------------------------------------------------------------ runtime

  function initGl() {
    const canvas = $('#gl')
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true })
    rt.gl = gl
    rt.renderer = new spine.webgl.SceneRenderer(canvas, gl, true)
    keepAlphaUnderAdditive(rt.renderer, gl)
  }

  /**
   * The stage canvas is transparent (the page's checkerboard shows through). An additive slot
   * (叠加) drawn from a JPG has alpha 1 on its black pixels: with the runtime's blendFunc(ONE, ONE)
   * that alpha lands in the canvas and the browser paints an opaque black box. Spine's viewport is
   * opaque, so black adds nothing there; here the colour adds and the alpha stays what is underneath.
   */
  function keepAlphaUnderAdditive(renderer, gl) {
    const b = renderer.batcher, orig = b.setBlendMode.bind(b)
    b.setBlendMode = (src, dst) => { orig(src, dst); if (dst === gl.ONE) gl.blendFuncSeparate(src, gl.ONE, gl.ZERO, gl.ONE) }
  }

  // ------------------------------------------------------------------ 预览 (Spine's Preview view)
  //
  // Its own canvas, skeleton and AnimationState, apart from the editing stage: click an
  // animation to play it on the chosen track (0-4, tracks layer like in Spine), 混合 = the
  // crossfade between animations, 速度 = time scale, 循环, 重置 = back to the setup pose.
  // It follows the project: an edit or a skin switch rebuilds it and keeps what was playing.

  // Every shown project plays here at once, each where it stands on the stage, each with its own
  // skeleton and AnimationState (Spine's preview). 骨架 picks the one the list, tracks and 重置 work on.
  const pv = { open: false, gl: null, renderer: null, items: new Map(), track: 0, speed: 100, mix: 0.25, loop: true,
    cam: { x: 0, y: 0, zoom: 1 }, fitted: false, drag: null, projectId: null }

  /** The projects the preview knows: the picked one live, the others as they were left. */
  function pvEntries() {
    const live = () => ({ json: state.json, atlasText: state.atlasText, images: state.images, skin: state.skin, pma: state.pma, offset: state.offset || { x: 0, y: 0 } })
    if (!projects.length) return state.json ? [{ id: 0, visible: true, src: live() }] : []
    return projects.map((p, i) => {
      const s = i === activeProject ? null : p.snap
      const src = i === activeProject ? live() : s && { json: s.json, atlasText: s.atlasText, images: s.images, skin: s.skin || 'default', pma: !!s.pma, offset: s.offset || { x: 0, y: 0 } }
      return { id: p.id, visible: p.visible !== false, src }
    }).filter((e) => e.src && e.src.json)
  }

  /** The project 骨架 points at (the picked one until another is chosen). */
  function pvChosenId(list) {
    const ids = (list || pvEntries()).map((e) => e.id)
    if (pv.projectId != null && ids.includes(pv.projectId)) return pv.projectId
    return projects[activeProject] ? projects[activeProject].id : ids[0]
  }
  const pvChosen = () => pv.items.get(pvChosenId())

  function pvItem(e) {
    const src = e.src
    let it = pv.items.get(e.id)
    if (!it) { it = { atlasText: null, atlas: null, data: null, json: null, skinName: null, skeleton: null, anim: null }; pv.items.set(e.id, it) }
    if (it.atlasText !== src.atlasText) {
      if (it.atlas) try { it.atlas.dispose() } catch {}
      it.atlas = new spine.TextureAtlas(src.atlasText, (path) => new spine.webgl.GLTexture(pv.gl, pageImageFrom(src.images, path)))
      it.atlasText = src.atlasText
      it.json = null
    }
    if (it.json === src.json && it.skinName === src.skin && it.skeleton) return it
    // what plays now, to play again on the rebuilt skeleton
    const playing = it.anim ? it.anim.tracks.map((t) => t && { name: t.animation.name, loop: t.loop }) : []
    it.data = readProjectData(src.json, it.atlas, pv.gl)
    it.skeleton = new spine.Skeleton(it.data)
    if (src.skin !== 'default' && it.data.findSkin(src.skin)) it.skeleton.setSkinByName(src.skin)
    it.skeleton.setToSetupPose()
    const sd = new spine.AnimationStateData(it.data)
    sd.defaultMix = pv.mix
    it.anim = new spine.AnimationState(sd)
    playing.forEach((t, i) => { if (t && it.data.findAnimation(t.name)) it.anim.setAnimation(i, t.name, t.loop) })
    it.json = src.json
    it.skinName = src.skin
    return it
  }

  function pvBuild() {
    const c = $('#pvGl')
    if (!pv.gl) {
      pv.gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true })
      pv.renderer = new spine.webgl.SceneRenderer(c, pv.gl, true)
      keepAlphaUnderAdditive(pv.renderer, pv.gl)
    }
    const list = pvEntries()
    // projects that went away
    for (const [id, it] of pv.items) if (!list.some((e) => e.id === id)) { if (it.atlas) try { it.atlas.dispose() } catch {} pv.items.delete(id) }
    for (const e of list) try { pvItem(e) } catch { /* a project that does not read: the others still play */ }
    if (!pv.fitted && list.length) { pvFit(); pv.fitted = true }
    return list
  }

  /** Frames every shown project (setup pose, each at its place). */
  function pvFit() {
    const c = $('#pvGl')
    if (!c.clientWidth) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const e of pvEntries()) {
      const it = pv.items.get(e.id)
      if (!e.visible || !it || !it.data) continue
      const sk = new spine.Skeleton(it.data)
      if (e.src.skin !== 'default' && it.data.findSkin(e.src.skin)) sk.setSkinByName(e.src.skin)
      sk.setToSetupPose(); sk.updateWorldTransform()
      const off = new spine.Vector2(), size = new spine.Vector2()
      sk.getBounds(off, size, [])
      if (!Number.isFinite(off.x) || !Number.isFinite(size.x)) continue
      x0 = Math.min(x0, off.x + e.src.offset.x); y0 = Math.min(y0, off.y + e.src.offset.y)
      x1 = Math.max(x1, off.x + size.x + e.src.offset.x); y1 = Math.max(y1, off.y + size.y + e.src.offset.y)
    }
    if (!Number.isFinite(x0)) return
    pv.cam.x = (x0 + x1) / 2
    pv.cam.y = (y0 + y1) / 2
    pv.cam.zoom = Math.max((x1 - x0) / (c.clientWidth * 0.85), (y1 - y0) / (c.clientHeight * 0.85), 0.01)
  }

  /** The stage's inside (the window is placed inside its border). */
  function stageInner() {
    const el = $('#stage'), r = el.getBoundingClientRect()
    return { left: r.left + el.clientLeft, top: r.top + el.clientTop, width: el.clientWidth, height: el.clientHeight }
  }

  /** Keep the window inside the stage (the stage shrinks when the timeline shows). */
  function pvClamp() {
    const box = $('#preview')
    if (box.hidden) return
    const st = stageInner(), b = box.getBoundingClientRect()
    let left = b.left - st.left, top = b.top - st.top
    const w = Math.min(b.width, st.width - 20), hh = Math.min(b.height, st.height - 20)
    if (w !== b.width) box.style.width = w + 'px'
    if (hh !== b.height) box.style.height = hh + 'px'
    const nl = Math.max(0, Math.min(st.width - w, left)), nt = Math.max(0, Math.min(st.height - hh, top))
    if (Math.abs(nl - left) > 0.5 || Math.abs(nt - top) > 0.5) { box.style.left = nl + 'px'; box.style.top = nt + 'px'; box.style.right = 'auto' }
  }

  function pvDraw(dt) {
    if (!pv.open || !state.json) return
    pvClamp()
    const c = $('#pvGl')
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), hh = Math.max(1, Math.round(c.clientHeight * dpr))
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh }
    let list
    try { list = pvBuild() } catch (e) { return }
    const gl = pv.gl, r = pv.renderer
    gl.viewport(0, 0, w, hh)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    r.camera.setViewport(w, hh)
    r.camera.zoom = pv.cam.zoom / dpr
    for (const e of list) {
      const it = pv.items.get(e.id)
      if (!it || !it.skeleton) continue
      it.anim.timeScale = pv.speed / 100
      it.anim.update(dt)
      if (!e.visible) continue
      it.skeleton.setToSetupPose()
      it.anim.apply(it.skeleton)
      it.skeleton.updateWorldTransform()
      r.camera.position.x = pv.cam.x - e.src.offset.x
      r.camera.position.y = pv.cam.y - e.src.offset.y
      r.begin()
      r.drawSkeleton(it.skeleton, !!e.src.pma)
      r.end()
    }
  }

  function pvPlay(name) {
    pvBuild()
    const it = pvChosen()
    if (!it || !it.anim) return
    it.anim.data.defaultMix = pv.mix
    it.anim.setAnimation(pv.track, name, pv.loop)
    renderPreview()
  }

  function pvReset() {
    const it = pvChosen()
    if (!it || !it.anim) return
    it.anim.clearTracks()
    it.skeleton.setToSetupPose()
    renderPreview()
  }

  /** The list and the controls (the canvas draws itself every frame). */
  function renderPreview() {
    const box = $('#preview')
    box.hidden = !pv.open || !state.json
    $('#pvOpen').setAttribute('aria-pressed', String(pv.open))
    if (box.hidden) return
    // a project that went away: back to the picked one
    if (pv.projectId != null && !projects.some((x) => x.id === pv.projectId)) pv.projectId = null
    let entries = []
    try { entries = pvBuild() } catch {}
    const chosenId = pvChosenId(entries)
    const it = pv.items.get(chosenId)
    const anim = it && it.anim
    const cur = anim && anim.tracks[pv.track]
    const list = $('#pvList')
    list.textContent = ''
    // 骨架: with several projects any of them plays here (Spine's skeleton list)
    if (projects.length > 1) {
      list.append(h('label', { class: 'pv-sk' }, h('span', {}, '骨架'), selectInput(projects.map((x, i) => [String(x.id), projectName(i)]), String(chosenId), (v) => {
        pv.projectId = Number(v)
        renderPreview()
      })))
    }
    const ce = entries.find((e) => e.id === chosenId)
    const anims = (ce && ce.src.json || {}).animations || {}
    for (const n of Object.keys(anims)) {
      list.append(h('button', { class: 'pv-a', 'aria-pressed': String(!!(cur && cur.animation.name === n)), title: `在轨道 ${pv.track} 上播放`, onclick: () => pvPlay(n) },
        h('span', { class: 'ico', html: ICON.anim }), n))
    }
    if (!list.childElementCount) list.append(h('div', { class: 'hint' }, '还没有动画'))
    $('#pvSpeed').value = pv.speed; $('#pvSpeedV').textContent = String(pv.speed)
    $('#pvMix').value = pv.mix; $('#pvMixV').textContent = pv.mix.toFixed(2)
    $('#pvLoop').setAttribute('aria-pressed', String(pv.loop))
    for (const b of document.querySelectorAll('#pvTracks button')) {
      const i = Number(b.dataset.t)
      b.setAttribute('aria-pressed', String(i === pv.track))
      b.dataset.busy = anim && anim.tracks[i] ? '1' : ''
      b.title = anim && anim.tracks[i] ? `轨道 ${i}：${anim.tracks[i].animation.name}` : `轨道 ${i}`
    }
  }

  function bindPreview() {
    $('#pvOpen').onclick = () => { pv.open = !pv.open; if (pv.open) pv.fitted = false; renderPreview() }
    $('#pvClose').onclick = () => { pv.open = false; renderPreview() }
    $('#pvFit').onclick = pvFit
    $('#pvReset').onclick = pvReset
    $('#pvLoop').onclick = () => {
      pv.loop = !pv.loop
      const it = pvChosen()
      const e = it && it.anim && it.anim.tracks[pv.track]
      if (e) e.loop = pv.loop
      renderPreview()
    }
    $('#pvSpeed').oninput = (e) => { pv.speed = Number(e.target.value); $('#pvSpeedV').textContent = String(pv.speed) }
    $('#pvMix').oninput = (e) => { pv.mix = Number(e.target.value); $('#pvMixV').textContent = pv.mix.toFixed(2); for (const it of pv.items.values()) if (it.anim) it.anim.data.defaultMix = pv.mix }
    for (const b of document.querySelectorAll('#pvTracks button')) b.onclick = () => { pv.track = Number(b.dataset.t); renderPreview() }
    // the canvas: wheel zooms at the pointer, a drag pans
    const c = $('#pvGl')
    const toW = (sx, sy) => [(sx - c.clientWidth / 2) * pv.cam.zoom + pv.cam.x, (c.clientHeight / 2 - sy) * pv.cam.zoom + pv.cam.y]
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = c.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top
      const before = toW(sx, sy)
      pv.cam.zoom = Math.min(50, Math.max(0.005, pv.cam.zoom * Math.min(1.25, Math.max(0.8, Math.pow(1.0015, e.deltaY)))))
      const after = toW(sx, sy)
      pv.cam.x += before[0] - after[0]; pv.cam.y += before[1] - after[1]
    }, { passive: false })
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    c.addEventListener('pointerdown', (e) => { pv.drag = { x: e.clientX, y: e.clientY, cx: pv.cam.x, cy: pv.cam.y }; c.setPointerCapture(e.pointerId) })
    c.addEventListener('pointermove', (e) => { if (!pv.drag) return; pv.cam.x = pv.drag.cx - (e.clientX - pv.drag.x) * pv.cam.zoom; pv.cam.y = pv.drag.cy + (e.clientY - pv.drag.y) * pv.cam.zoom })
    c.addEventListener('pointerup', () => { pv.drag = null })
    // the window moves by its title bar
    const box = $('#preview'), hd = box.querySelector('.pv-hd')
    hd.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return
      const st = stageInner(), b = box.getBoundingClientRect()
      const d = { x: e.clientX - b.left, y: e.clientY - b.top }
      hd.setPointerCapture(e.pointerId)
      // the whole window stays inside the stage
      const mv = (ev) => {
        box.style.left = Math.max(0, Math.min(st.width - b.width, ev.clientX - st.left - d.x)) + 'px'
        box.style.top = Math.max(0, Math.min(st.height - b.height, ev.clientY - st.top - d.y)) + 'px'
        box.style.right = 'auto'
      }
      const upH = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', upH) }
      hd.addEventListener('pointermove', mv)
      hd.addEventListener('pointerup', upH)
    })
  }

  function imageForPage(name) {
    // the full relative path first (images in folders), then the bare file name
    const hit = state.images.get(lower(name)) || state.images.get(lower(baseName(name)))
      || [...state.images.values()].find((i) => lower(stem(i.fileName)) === lower(stem(name)))
    if (hit) return hit.img
    // a page that did not come with the project: an empty one, so the rest still opens
    rt.missingPages.add(name)
    const c = document.createElement('canvas')
    c.width = 1; c.height = 1
    return c
  }

  /**
   * The atlas loader, except that a picture the atlas lacks does not stop the project from
   * opening: its attachment loads with an empty picture (and is reported once).
   */
  function tolerantLoader(atlas, gl) {
    const base = new spine.AtlasAttachmentLoader(atlas)
    let blank = null
    const blankRegion = () => {
      if (!blank) {
        const c = document.createElement('canvas')
        c.width = 1; c.height = 1
        const r = new spine.TextureAtlasRegion()
        r.renderObject = r
        r.texture = new spine.webgl.GLTexture(gl, c)
        r.u = 0; r.v = 0; r.u2 = 1; r.v2 = 1
        r.width = r.height = r.originalWidth = r.originalHeight = 1
        r.offsetX = r.offsetY = 0; r.rotate = false; r.degrees = 0; r.name = ''
        blank = r
      }
      return blank
    }
    return {
      newRegionAttachment(skin, name, path) {
        if (atlas.findRegion(path)) return base.newRegionAttachment(skin, name, path)
        rt.missingRegions.add(path)
        const a = new spine.RegionAttachment(name)
        a.setRegion(blankRegion())
        return a
      },
      newMeshAttachment(skin, name, path) {
        if (atlas.findRegion(path)) return base.newMeshAttachment(skin, name, path)
        rt.missingRegions.add(path)
        const a = new spine.MeshAttachment(name)
        a.region = blankRegion()
        return a
      },
      newBoundingBoxAttachment: (skin, name) => base.newBoundingBoxAttachment(skin, name),
      newPathAttachment: (skin, name) => base.newPathAttachment(skin, name),
      newPointAttachment: (skin, name) => base.newPointAttachment(skin, name),
      newClippingAttachment: (skin, name) => base.newClippingAttachment(skin, name),
    }
  }

  function ensureAtlas() {
    if (rt.atlasKey === state.atlasText && rt.atlas) return
    if (rt.atlas) try { rt.atlas.dispose() } catch {}
    rt.atlas = new spine.TextureAtlas(state.atlasText, (path) => new spine.webgl.GLTexture(rt.renderer.context || rt.gl, imageForPage(path)))
    rt.atlasKey = state.atlasText
  }

  function readData(json) {
    ensureAtlas()
    // the editor shows every image, also the ones left out of the export
    const copy = Ops.editorData(json)
    const v = String(copy.skeleton && copy.skeleton.spine || '')
    // the 3.8 reader refuses its own placeholder version; it only gates the parse
    if (!v.startsWith('3.8') || v === '3.8.75') copy.skeleton = { ...(copy.skeleton || {}), spine: '3.8.99' }
    const reader = new spine.SkeletonJson(tolerantLoader(rt.atlas, rt.renderer.context || rt.gl))
    return reader.readSkeletonData(copy)
  }

  function applyJson(json) {
    const data = readData(json)
    state.json = json
    rt.data = data
    rt.skeleton = new spine.Skeleton(data)
    if (!data.findSkin(state.skin)) state.skin = 'default'
    computeRoles()
    setSkin(state.skin)
  }

  /** 控制骨 = a constraint target, 受约束 = driven by a constraint (the 动画 section's legend). */
  function computeRoles() {
    const roles = new Map()
    for (const k of ['ik', 'transform', 'path']) {
      for (const c of state.json[k] || []) {
        for (const b of c.bones || []) if (!roles.has(b)) roles.set(b, 'cons')
        if (k !== 'path' && c.target) roles.set(c.target, 'ctrl')
      }
    }
    state.roles = roles
  }

  function setSkin(name) {
    state.skin = name
    const sk = rt.skeleton
    sk.setSkin(null)
    if (name && name !== 'default' && rt.data.findSkin(name)) sk.setSkinByName(name)
    sk.setSlotsToSetupPose()
    pose()
  }

  function currentAnimation() {
    return state.mode === 'animate' && state.anim ? rt.data.findAnimation(state.anim) : null
  }

  function duration() {
    const a = rt.data && state.anim ? rt.data.findAnimation(state.anim) : null
    return a ? a.duration : 0
  }

  // playing: the pose is taken at the continuous time (frame + the fraction since the last
  // whole frame), as Spine plays - whole frames alone looked like a stutter on a 60 Hz display
  const timeSec = () => (state.frame + (state.playing && state.playFrac ? state.playFrac : 0)) / FPS

  /** Setup pose, the current animation frame, then any preview drags. */
  function pose() {
    const sk = rt.skeleton
    if (!sk) return
    sk.setToSetupPose()
    const a = currentAnimation()
    // a hair past the frame: keys are stored with 4 decimals (5/30 → 0.1667)
    if (a) a.apply(sk, 0, timeSec() + 1e-4, false, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
    for (const [name, t] of state.temp) {
      const b = sk.findBone(name)
      if (!b) continue
      for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY']) if (t[k] != null) b[k] = t[k]
    }
    sk.updateWorldTransform()
  }

  /** Setup-pose world matrices of every bone (what the structural ops keep in place). */
  function setupMatrices() {
    const sk = new spine.Skeleton(rt.data)
    if (state.skin !== 'default' && rt.data.findSkin(state.skin)) sk.setSkinByName(state.skin)
    sk.setToSetupPose()
    sk.updateWorldTransform()
    const out = {}
    for (const b of sk.bones) out[b.data.name] = { a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length }
    return out
  }

  // ------------------------------------------------------------------ edits

  function snapshot() { return { json: state.json, atlasText: state.atlasText, atlasChanged: state.atlasChanged } }

  function restore(s) {
    state.atlasText = s.atlasText
    state.atlasChanged = s.atlasChanged
    applyJson(s.json)
  }

  /**
   * Run one op: `fn(json)` returns `{ json, ... }`. The new JSON must load in
   * the runtime or nothing changes. `after(result)` picks the new selection.
   */
  function edit(label, fn, after) {
    if (!state.json) return null
    const before = snapshot()
    let result
    try {
      result = fn(state.json)
      applyJson(result.json)
    } catch (e) {
      try { restore(before) } catch {}
      status(`${typeof label === 'function' ? '操作' : label.replace(/^已/, '')}失败：${e.message}`, 'error')
      refresh()
      return null
    }
    state.history.push(before)
    if (state.history.length > 200) state.history.shift()
    state.future = []
    if (after) after(result)
    validateSelection()
    refresh()
    status(typeof label === 'function' ? label(result) : label, 'ok')
    return result
  }

  function undo() {
    if (!state.history.length) return
    state.future.push(snapshot())
    restore(state.history.pop())
    validateSelection()
    refresh()
    status('已撤销')
  }

  function redo() {
    if (!state.future.length) return
    state.history.push(snapshot())
    restore(state.future.pop())
    validateSelection()
    refresh()
    status('已重做')
  }

  function validateSelection() {
    const j = state.json
    const s = state.sel
    const has = (kind, name) => (kind === 'bone' ? j.bones.some((b) => b.name === name)
      : kind === 'slot' ? j.slots.some((x) => x.name === name)
      : kind === 'skin' ? j.skins.some((x) => x.name === name)
      : kind === 'event' ? !!(j.events || {})[name]
      : kind === 'section' || kind === 'project' ? true
      : (j[kind] || []).some((c) => c.name === name))
    if (s) {
      if (s.kind === 'att') {
        const sk = j.skins.find((x) => x.name === s.skin)
        if (!sk || !sk.attachments[s.slot] || !sk.attachments[s.slot][s.name]) state.sel = j.slots.some((x) => x.name === s.slot) ? { kind: 'slot', name: s.slot } : null
      } else if (s.kind === 'ph') {
        if (!j.slots.some((x) => x.name === s.slot) || !Ops.isPlaceholder(j, s.slot, s.name)) state.sel = null
      } else if (s.kind === 'anim') {
        if (!j.animations[s.name]) state.sel = null
      } else if (!has(s.kind, s.name)) state.sel = null
    }
    state.multi = state.multi.filter((n) => has('bone', n))
    state.multiSlots = state.multiSlots.filter((n) => has('slot', n))
    state.multiCons = (state.multiCons || []).filter((c) => has(c.kind, c.name))
    if (state.multiSlots.length && !(state.sel && state.sel.kind === 'slot')) state.multiSlots = []
    for (const n of [...state.temp.keys()]) if (!has('bone', n)) state.temp.delete(n)
    if (state.anim && !j.animations[state.anim]) state.anim = Object.keys(j.animations)[0] || ''
  }

  const PANEL_OF = { bone: 'bone', slot: 'slot', att: 'slot', ph: 'slot', ik: 'cons', transform: 'cons', path: 'cons', skin: 'skin', event: 'event' }

  /** Pick something; the properties under the tree follow it (Spine). */
  function select(sel, additive, opts) {
    state.dopeExtra = null
    if (state.weightEdit && state.weightEdit.binding && sel && sel.kind === 'bone' && rt.skeleton && rt.skeleton.findBone(sel.name)) {
      toggleBind(rt.skeleton.findBone(sel.name).data.index)
      return
    }
    const me = state.meshEdit
    if (me && !(sel && sel.kind === 'att' && sel.slot === me.slot && sel.name === me.name)) { state.meshEdit = null; state.meshDrag = null; meCache = null }
    const ce = state.clipEdit
    if (ce && !(sel && sel.kind === 'att' && sel.slot === ce.slot && sel.name === ce.name)) { state.clipEdit = null; state.clipDrag = null }
    const we = state.weightEdit
    if (we && !(sel && ((sel.kind === 'att' && sel.slot === we.slot && sel.name === we.name) || sel.kind === 'bone')) && !state.pick) { state.weightEdit = null; state.weightStroke = null; weCache = null }
    // 飘带's 自动链条 overlays the picked chain on the selection (selectChain); a new pick starts
    // from the bones the user chose, never from that overlay
    const chainRoots = state.chainPick ? (state.chainRoots || []).slice() : null
    state.chainPick = null
    state.chainRoots = null
    if (additive && sel && sel.kind === 'bone') {
      const set = new Set(chainRoots ? chainRoots : (state.multi.length ? state.multi : (state.sel && state.sel.kind === 'bone' ? [state.sel.name] : [])))
      if (set.has(sel.name)) set.delete(sel.name)
      else set.add(sel.name)
      state.multi = [...set]
      state.sel = state.multi.length ? { kind: 'bone', name: state.multi[state.multi.length - 1] } : (state.multiSlots.length ? { kind: 'slot', name: state.multiSlots[state.multiSlots.length - 1] } : null)
    } else if (additive && sel && sel.kind === 'slot') {
      // Spine: Ctrl+click adds layers too; they are edited together
      const set = new Set(state.multiSlots.length ? state.multiSlots : (state.sel && state.sel.kind === 'slot' ? [state.sel.name] : []))
      if (set.has(sel.name)) set.delete(sel.name)
      else set.add(sel.name)
      state.multiSlots = [...set]
      state.sel = state.multiSlots.length ? { kind: 'slot', name: state.multiSlots[state.multiSlots.length - 1] } : (state.multi.length ? { kind: 'bone', name: state.multi[state.multi.length - 1] } : null)
    } else if (additive && sel && (sel.kind === 'ik' || sel.kind === 'transform' || sel.kind === 'path')) {
      const list = state.multiCons.length ? state.multiCons.slice() : (state.sel && (state.sel.kind === 'ik' || state.sel.kind === 'transform' || state.sel.kind === 'path') ? [{ kind: state.sel.kind, name: state.sel.name }] : [])
      const i = list.findIndex((c) => c.kind === sel.kind && c.name === sel.name)
      if (i >= 0) list.splice(i, 1); else list.push({ kind: sel.kind, name: sel.name })
      state.multiCons = list
      state.sel = list.length ? { kind: list[list.length - 1].kind, name: list[list.length - 1].name } : null
    } else {
      state.sel = sel
      state.multi = sel && sel.kind === 'bone' ? [sel.name] : []
      state.multiSlots = sel && sel.kind === 'slot' ? [sel.name] : []
      state.multiCons = sel && (sel.kind === 'ik' || sel.kind === 'transform' || sel.kind === 'path') ? [{ kind: sel.kind, name: sel.name }] : []
    }
    if (sel && (sel.kind === 'bone' || sel.kind === 'slot' || sel.kind === 'att' || sel.kind === 'ph' || sel.kind === 'ik' || sel.kind === 'transform' || sel.kind === 'path' || sel.kind === 'event') && !(opts && opts.noReveal)) revealInTree(sel)
    // 序列K帧 / 序列扫光: the cards' 骨骼 follows the bone picked in the tree or on the stage at
    // once (user 2026-10-12: 骨骼树点击骨骼，下面没有实时变化)
    if ((state.leftOpen === 'sequence' || state.leftOpen === 'sweep') && state.sel && state.sel.kind === 'bone' && state.frameBone !== state.sel.name && state.json && state.json.bones.some((b) => b.name === state.sel.name)) {
      state.frameBone = state.sel.name
      const boneSel = document.querySelector('#layerDock select[data-frame-bone]')
      if (boneSel) boneSel.value = state.frameBone
    }
    if (!(opts && opts.fromHistory)) pushHistory()
    refresh()
  }

  /** Spine: Page Up / Page Down walk the selection history. */
  function pushHistory() {
    const entry = JSON.stringify({ sel: state.sel, multi: state.multi, multiSlots: state.multiSlots })
    const h0 = state.selHistory
    if (h0[state.selIdx] === entry) return
    h0.splice(state.selIdx + 1)
    h0.push(entry)
    if (h0.length > 60) h0.shift()
    state.selIdx = h0.length - 1
  }

  function restoreSelection(entry) {
    const e = JSON.parse(entry)
    state.sel = e.sel
    state.multi = e.multi
    state.multiSlots = e.multiSlots || []
    validateSelection()
    if (state.sel) revealInTree(state.sel)
    refresh()
  }

  function selectedBones() {
    if (state.multi.length) return state.multi.slice()
    return state.sel && state.sel.kind === 'bone' ? [state.sel.name] : []
  }

  // ------------------------------------------------------------------ pick mode

  function startPick(pick) { state.pick = pick; refresh() }
  function endPick() { state.pick = null; refresh() }

  function resolvePick(kind, name) {
    const p = state.pick
    if (!p || p.want !== kind) return false
    state.pick = null
    p.done(name)
    return true
  }

  // ------------------------------------------------------------------ actions

  const bone = (name) => state.json.bones.find((b) => b.name === name)
  const slotOf = (name) => state.json.slots.find((s) => s.name === name)
  const skinOf = (name) => state.json.skins.find((s) => s.name === name)

  function depthOf(name) {
    let d = 0
    let b = bone(name)
    while (b && b.parent) { d++; b = bone(b.parent) }
    return d
  }

  function nextBoneName() {
    const taken = new Set(state.json.bones.map((b) => b.name))
    let i = 1
    while (taken.has('bone' + i)) i++
    return 'bone' + i
  }

  /**
   * Spine's duplicate: a bone comes with its children, slots and constraints; when any of
   * that has keys in an animation a dialog asks whether to copy the keys too.
   */
  function duplicateSelection() {
    const s = state.sel
    if (!s) return
    if (s.kind === 'project') { duplicateProject(activeProject); return }
    if (s.kind === 'bone') {
      const run = (animation) => edit((r) => `已复制骨骼 ${s.name} → ${r.bone}（${r.bones.length} 骨骼 / ${r.slots.length} 插槽 / ${r.constraints.length} 约束${animation ? '，带关键帧' : ''}）`,
        (j) => Ops.duplicateBone(j, s.name, { ...state.dup, animation }),
        (r) => { state.sel = { kind: 'bone', name: r.bone }; state.multi = [r.bone]; revealInTree(state.sel) })
      if (!copiesKeys((j, animation) => Ops.duplicateBone(j, s.name, { ...state.dup, animation }))) { run(false); return }
      askDialog('复制', ['此骨骼已在动画中设为关键帧。', '要复制这些关键帧吗？'], run)
    } else if (s.kind === 'att') {
      duplicateAttachmentSel(s, false)
    } else if (s.kind === 'slot') {
      const run = (animation) => edit((r) => `已复制插槽 ${s.name} → ${r.slot}${animation ? '（带关键帧）' : ''}`,
        (j) => Ops.duplicateSlot(j, s.name, { animation }),
        (r) => { state.sel = { kind: 'slot', name: r.slot }; revealInTree(state.sel) })
      if (!copiesKeys((j, animation) => Ops.duplicateSlot(j, s.name, { animation }))) { run(false); return }
      askDialog('复制', ['此插槽已在动画中设为关键帧。', '要复制这些关键帧吗？'], run)
    }
  }

  /**
   * Spine's attachment 复制 in the same slot: a mesh either as an independent mesh (asks about
   * its deform keys, like a bone copy) or as a linked mesh that uses the same vertices and deform.
   */
  function duplicateAttachmentSel(sel, linked) {
    const run = (animation) => edit((r) => linked ? `已创建链接网格 ${r.attachment}（和 ${sel.name} 共用顶点和变形）` : `已复制 ${sel.name} → ${r.attachment}${r.keys ? '（带关键帧）' : ''}`,
      (j) => Ops.duplicateAttachment(j, sel.skin, sel.slot, sel.name, { linked, animation }),
      (r) => { state.sel = { kind: 'att', name: r.attachment, slot: sel.slot, skin: sel.skin } })
    if (linked || !Ops.hasDeformKeys(state.json, sel.skin, sel.slot, sel.name)) { run(false); return }
    askDialog('复制', ['此网格已在动画中设为关键帧。', '要复制这些关键帧吗？'], run)
  }

  /** Whether a copy would carry animation keys: the copy with and without them differ. */
  function copiesKeys(copy) {
    try {
      return JSON.stringify(copy(state.json, true).json.animations || {}) !== JSON.stringify(copy(state.json, false).json.animations || {})
    } catch { return false }
  }

  /** A small 是 / 否 question; × or Esc cancels, Enter = 是. `onAnswer(true | false)`. */
  function askDialog(title, lines, onAnswer) {
    if (document.querySelector('.dialog.ask')) return
    const done = (v) => { mask.remove(); window.removeEventListener('keydown', onKey, true); if (v != null) onAnswer(v) }
    // modal: while it is open no other shortcut runs
    const onKey = (e) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') done(null)
      else if (e.key === 'Enter') done(true)
    }
    const mask = h('div', { class: 'mask', onclick: (e) => { if (e.target === mask) done(null) } },
      h('div', { class: 'dialog ask' },
        h('div', { class: 'hd' }, h('b', {}, title), h('button', { class: 'xx', title: '取消', onclick: () => done(null) }, '×')),
        h('div', { class: 'msg' }, lines.map((l) => h('div', {}, l))),
        h('div', { class: 'ft' }, btn('否', () => done(false)), btn('是', () => done(true), { primary: true }))))
    document.body.append(mask)
    window.addEventListener('keydown', onKey, true)
  }

  function deleteSelection() {
    const s = state.sel
    if (!s) return
    if (s.kind === 'project') { deleteProject(activeProject); return }
    if (s.kind === 'bone') edit(`已删除骨骼 ${s.name}`, (j) => Ops.deleteBone(j, s.name), () => { state.sel = null })
    else if (s.kind === 'slot' && state.multiSlots.length > 1) {
      const names = state.multiSlots.slice()
      edit(`已删除 ${names.length} 个插槽`, (j) => names.reduce((r, n) => Ops.deleteSlot(r.json, n), { json: j }), () => { state.sel = null; state.multiSlots = [] })
    } else if (s.kind === 'slot') edit(`已删除插槽 ${s.name}`, (j) => Ops.deleteSlot(j, s.name), () => { state.sel = null })
    else if (s.kind === 'att' && s.skin !== 'default' && Ops.isPlaceholder(state.json, s.slot, s.name)) {
      edit(`已清空皮肤 ${s.skin} 的「${s.name}」`, (j) => Ops.clearPlaceholder(j, s.skin, s.slot, s.name), () => { state.sel = { kind: 'ph', name: s.name, slot: s.slot } })
    } else if (s.kind === 'att') edit(`已删除图片 ${s.name}`, (j) => Ops.deleteAttachment(j, s.skin, s.slot, s.name), () => { state.sel = { kind: 'slot', name: s.slot } })
    else if (s.kind === 'ph') edit(`已删除占位符 ${s.name}`, (j) => Ops.deletePlaceholder(j, s.slot, s.name), () => { state.sel = { kind: 'slot', name: s.slot } })
    else if (s.kind === 'ik' || s.kind === 'transform') edit(`已删除约束 ${s.name}`, (j) => Ops.deleteConstraint(j, s.kind, s.name), () => { state.sel = null })
    else if (s.kind === 'event') edit((r) => `已删除事件 ${s.name}${r.keys ? `（含动画里 ${r.keys} 个关键帧）` : ''}`, (j) => Ops.deleteEvent(j, s.name), () => { state.sel = null })
    else if (s.kind === 'skin') edit(`已删除皮肤 ${s.name}`, (j) => Ops.deleteSkin(j, s.name), () => { state.sel = null; if (state.skin === s.name) state.skin = 'default' })
  }

  function newChildBone(parent) {
    const m = setupMatrices()[parent]
    const len = m ? m.length || 0 : 0
    const name = nextBoneName()
    edit(`已新建骨骼 ${name}`, (j) => Ops.addBone(j, { name, parent, x: len, length: 40 }),
      () => { state.sel = { kind: 'bone', name }; state.multi = [name]; revealInTree(state.sel) })
  }

  function newSlot(boneName) {
    edit((r) => `已新建插槽 ${r.slot}`, (j) => Ops.addSlot(j, boneName),
      (r) => { state.sel = { kind: 'slot', name: r.slot }; revealInTree(state.sel) })
  }

  /** 自动排序: every constraint after the ones that move its target or its bones' parents. */
  function autoOrder() {
    const r = Ops.autoOrderConstraints(state.json)
    const loop = r.cycles.length ? `；循环依赖保持原顺序：${r.cycles.join('、')}` : ''
    if (!r.changed) { status(`约束顺序已经是对的${loop}`, loop ? 'error' : 'ok'); return }
    edit(`约束顺序已整理：${r.changed} 个换了位置${loop}`, (j) => Ops.autoOrderConstraints(j))
  }

  /**
   * Run a constraint-related op, then put the constraints back in a valid solve
   * order (自动排序 on every change, so a new constraint lands in the right place).
   */
  function withOrder(r) {
    const o = Ops.autoOrderConstraints(r.json)
    return { ...r, json: o.json, reordered: o.changed }
  }
  const orderNote = (r) => (r && r.reordered ? '，求解顺序已自动排好' : '')

  /** IK from the selection: 1 bone, or the bone + its parent ("双骨"). */
  function newIk(bones) {
    startPick({
      want: 'bone',
      text: `IK「${bones.join(' → ')}」：在画面或工程树里点目标骨骼`,
      extra: { label: '在末端新建目标', run: () => {
        state.pick = null
        const m = setupMatrices()
        const end = m[bones[bones.length - 1]]
        const tip = [end.worldX + end.length * end.a, end.worldY + end.length * end.c]
        const root = state.json.bones[0].name
        const local = Ops.toLocal(m[root], tip[0], tip[1])
        edit((r) => `已新建 IK ${r.constraint}，目标 ${r.target}${orderNote(r)}`,
          (j) => withOrder(Ops.createIk(j, { bones, targetParent: root, targetAt: { x: local[0], y: local[1] } })),
          (r) => { state.sel = { kind: 'ik', name: r.constraint } })
      } },
      done: (target) => edit((r) => `已新建 IK ${r.constraint}${orderNote(r)}`,
        (j) => withOrder(Ops.createIk(j, { bones, target })),
        (r) => { state.sel = { kind: 'ik', name: r.constraint } }),
    })
  }

  function newTransform(bones) {
    startPick({
      want: 'bone',
      text: `变换约束（${bones.length} 根骨骼）：在画面或工程树里点目标骨骼`,
      done: (target) => {
        const m = setupMatrices()
        const off = m[bones[0]] && m[target] ? Ops.transformOffsets(m[bones[0]], m[target]) : {}
        edit((r) => `已新建变换约束 ${r.constraint}${orderNote(r)}`,
          (j) => withOrder(Ops.createTransform(j, { bones, target, ...off })),
          (r) => { state.sel = { kind: 'transform', name: r.constraint } })
      },
    })
  }

  function reparent(name, parent) {
    edit((r) => `已把 ${name} 挂到 ${parent} 下${orderNote(r)}`, (j) => withOrder(Ops.reparentBone(j, name, parent, setupMatrices())))
  }

  function setParent(name) {
    startPick({ want: 'bone', text: `「${name}」挂到哪根骨骼下：点父骨骼`, done: (parent) => reparent(name, parent) })
  }

  function setSlotBone(name, boneName) {
    edit(`已把插槽 ${name} 挂到 ${boneName}`, (j) => Ops.setSlotProps(j, name, { bone: boneName }, setupMatrices()))
  }

  function transferAtt(sel, move, toSlot) {
    const go = (to) => edit((r) => `已${move ? '移动' : '复制'}到插槽 ${to}`,
      (j) => Ops.transferAttachment(j, sel.skin, sel.slot, sel.name, to, { move }, setupMatrices()),
      (r) => { state.sel = { kind: 'att', skin: sel.skin, slot: to, name: r.attachment }; revealInTree(state.sel) })
    if (toSlot) return go(toSlot)
    startPick({ want: 'slot', text: `${move ? '移动' : '复制'}「${sel.name}」：在工程树里点目标插槽`, done: go })
  }

  /** The visible-attachment dot: setup value in 设置, an attachment key in 动画. */
  function showAttachment(slot, name) {
    if (state.mode === 'animate' && state.anim) {
      edit(`已在第 ${state.frame} 帧设置「${slot}」显示 ${name || '无'}`, (j) => Ops.keyAttachment(j, state.anim, slot, timeSec(), name))
    } else {
      edit(`「${slot}」默认显示 ${name || '无'}`, (j) => Ops.setSlotProps(j, slot, { attachment: name }))
    }
  }

  function regionList() {
    if (!rt.atlas) return []
    return rt.atlas.regions.map((r) => ({ name: r.name, region: r }))
  }

  function regionSize(name) {
    const r = rt.atlas && rt.atlas.findRegion(name)
    return r ? { width: r.originalWidth, height: r.originalHeight } : null
  }

  /** Upright on screen at the slot's bone origin, like dropping an image in Spine. */
  function uprightRotation(slot) {
    const m = setupMatrices()[slotOf(slot).bone]
    return m ? -Math.atan2(m.c, m.a) * DEG : 0
  }

  /** Add PNGs as new atlas pages (one region each); resolves the new region names. */
  /** One image from the image folder into the project, named by its path in the folder (Spine). */
  async function addImageFile(file, name) {
    const img = await imageFromBlob(file)
    const fileName = name + '.png'
    state.images.set(lower(fileName), { img, fileName, blob: file })
    state.addedImages.push({ fileName, blob: file })
    state.atlasText = state.atlasText.replace(/\s+$/, '') + '\n\n' + Attach.synthesizeAtlas([{ fileName, width: img.naturalWidth, height: img.naturalHeight }]) + '\n'
    state.atlasChanged = true
    rt.atlasKey = null
  }

  // ------------------------------------------------------------------ the image folder (Spine's images path)
  //
  // Always set, nothing to choose: a project opened as a folder (a PhotoshopToSpine export)
  // brings its image folder; a JSON + atlas + PNG project uses the images in its atlas.
  // A folder node lists its subfolders and images.

  const IMG_RX = /\.(png|jpe?g|webp)$/i
  const byName = (x, y) => x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' })
  const sortList = (dirs, files) => ({ dirs: dirs.sort(byName), files: files.sort(byName) })

  /**
   * A folder on disk (File System Access handle): listed anew on every list(), so pictures the
   * user drops into it show up. Files imported in the session (the handle is read-only) are kept
   * beside them. Same shape as folderFromFiles's nodes, plus `live`.
   */
  function folderFromHandle(handle, name, path, extras) {
    const extra = extras || new Map()   // dir path → files added in-session
    const here = path || ''
    const node = {
      name, path: here, live: true,
      async list() {
        const dirs = [], files = []
        for await (const [n, h] of handle.entries()) {
          const rel = here ? here + '/' + n : n
          if (h.kind === 'directory') dirs.push(folderFromHandle(h, n, rel, extra))
          else if (h.kind === 'file' && IMG_RX.test(n)) files.push({ name: n, rel, region: null, file: async () => h.getFile() })
        }
        for (const f of extra.get(here) || []) if (!files.some((x) => x.name === f.name)) files.push(f)
        return sortList(dirs, files)
      },
      add(rel, file) {
        const parts = String(rel).split('/').filter(Boolean)
        const dir = parts.slice(0, -1).join('/'), n = parts[parts.length - 1]
        if (!extra.has(dir)) extra.set(dir, [])
        extra.get(dir).push({ name: n, rel: parts.join('/'), region: null, file: async () => file })
      },
    }
    return node
  }

  /** The picture names a raw Spine JSON's attachments show (path, else name; regions and meshes). */
  function attachmentPictureNames(json) {
    const names = new Set()
    const skins = Array.isArray(json && json.skins) ? json.skins
      : Object.entries((json && json.skins) || {}).map(([name, attachments]) => ({ name, attachments }))
    for (const sk of skins) for (const slot of Object.values((sk && sk.attachments) || {})) for (const [name, a] of Object.entries(slot || {})) {
      if (a && (a.type === 'boundingbox' || a.type === 'clipping' || a.type === 'path' || a.type === 'point')) continue
      names.add(String((a && a.path) || name))
    }
    return names
  }

  /**
   * The folder (a path among `rels`' folders, '' = where they are listed from) whose pictures,
   * named relative to it, match the most attachments. Pictures one or two folders down (e/arm_l.png
   * beside skeleton.json, attachments named arm_l) were listed as e/arm_l: the 图片 tree never
   * marked them in use, and dragging one in made a second attachment e/arm_l. Only ever descends.
   */
  function bestPictureRoot(rels, names) {
    const bare = (p) => p.replace(/\.[^.]+$/, '')
    const score = (root) => {
      let n = 0
      for (const r of rels) {
        if (root && !r.startsWith(root + '/')) continue
        if (names.has(bare(root ? r.slice(root.length + 1) : r))) n++
      }
      return n
    }
    const dirs = new Set()
    for (const r of rels) { const parts = r.split('/'); for (let i = 1; i < parts.length && i <= 3; i++) dirs.add(parts.slice(0, i).join('/')) }
    let best = '', bestScore = score('')
    for (const d of [...dirs].sort((a, b) => a.split('/').length - b.split('/').length)) { const s = score(d); if (s > bestScore) { best = d; bestScore = s } }
    return best
  }

  /** The project's image folder inside the picked folder: the JSON's folder + skeleton.images. */
  async function folderForProject(dirHandle, json, jsonFileName) {
    const base = String(jsonFileName || '').split('/').pop().toLowerCase()
    const find = async (h, depth) => {
      if (depth > 4) return null
      const subs = []
      for await (const [n, c] of h.entries()) { if (c.kind === 'file' && n.toLowerCase() === base) return h; if (c.kind === 'directory') subs.push(c) }
      for (const c of subs) { const r = await find(c, depth + 1); if (r) return r }
      return null
    }
    const jsonDir = await find(dirHandle, 0)
    if (!jsonDir) return null
    // skeleton.images (./images/): that folder; not there (or pointing above the JSON) → the JSON's folder
    let dir = jsonDir
    try {
      for (const seg of String((json.skeleton && json.skeleton.images) || '').split('/').filter((x) => x && x !== '.')) {
        if (seg === '..') { dir = null; break }
        dir = await dir.getDirectoryHandle(seg)
      }
    } catch { dir = null }
    if (!dir) {
      // the JSON's folder — or its one picture subfolder (img/ beside skeleton.json): the PS import
      // names attachments by file name, so the folder must be rooted where the pictures are
      dir = jsonDir
      const subs = []; let pics = 0
      for await (const [n, c] of jsonDir.entries()) { if (c.kind === 'directory') subs.push(c); else if (IMG_RX.test(n)) pics++ }
      if (!pics && subs.length === 1) dir = subs[0]
    }
    // root it where the pictures' names match the attachments (their folder may be further down)
    const rels = []
    const collect = async (h, prefix, depth) => {
      for await (const [n, c] of h.entries()) {
        const rel = prefix ? prefix + '/' + n : n
        if (c.kind === 'directory') { if (depth < 3) await collect(c, rel, depth + 1) } else if (IMG_RX.test(n)) rels.push(rel)
      }
    }
    await collect(dir, '', 0)
    const best = bestPictureRoot(rels, attachmentPictureNames(json))
    if (best) for (const seg of best.split('/')) dir = await dir.getDirectoryHandle(seg)
    return folderFromHandle(dir, dir.name || '图片')
  }

  /** The same from a folder's files (no handle: a snapshot), rooted at skeleton.images, else the JSON's folder. */
  function folderFromProjectFiles(files, json, jsonFileName) {
    const list = Array.from(files || [])
    const norm = (p) => String(p || '').split('/').filter((x) => x && x !== '.').join('/')
    const base = String(jsonFileName || '').split('/').pop().toLowerCase()
    const jsonFile = list.find((f) => f.name.toLowerCase() === base) || list.find((f) => /\.json$/i.test(f.name))
    if (!jsonFile) return null
    const jsonDir = norm(jsonFile.webkitRelativePath || '').split('/').slice(0, -1).join('/')
    const imgRoot = norm(jsonDir + '/' + String((json.skeleton && json.skeleton.images) || ''))
    const under = (root) => list.filter((f) => IMG_RX.test(f.name) && (root ? norm(f.webkitRelativePath || '').startsWith(root + '/') : true))
    let root = imgRoot, imgs = imgRoot ? under(imgRoot) : []
    if (!imgs.length) { root = jsonDir; imgs = under(jsonDir) }
    if (!imgs.length) return null
    // every picture in one subfolder of the JSON's folder (img/): root there, so names match the attachments
    const firsts = new Set(imgs.map((f) => norm(f.webkitRelativePath || f.name).slice(root ? root.length + 1 : 0).split('/')[0]))
    if (firsts.size === 1 && imgs.every((f) => norm(f.webkitRelativePath || f.name).slice(root ? root.length + 1 : 0).includes('/'))) root = (root ? root + '/' : '') + [...firsts][0]
    imgs = under(root)
    // root it where the pictures' names match the attachments (their folder may be further down)
    const best = bestPictureRoot(imgs.map((f) => norm(f.webkitRelativePath || f.name).slice(root ? root.length + 1 : 0)), attachmentPictureNames(json))
    if (best) { root = (root ? root + '/' : '') + best; imgs = under(root) }
    return folderFromFiles((root || jsonDir).split('/').pop() || '图片', imgs.map((f) => ({ rel: norm(f.webkitRelativePath || f.name).slice(root ? root.length + 1 : 0), file: f })))
  }

  /** `items` = [{ rel: path inside the folder, file }]. */
  function folderFromFiles(name, items) {
    const root = { name, path: '', dirs: new Map(), files: [] }
    for (const it of items) {
      if (!IMG_RX.test(it.rel)) continue
      const parts = it.rel.split('/').filter(Boolean)
      let n = root
      for (let i = 0; i < parts.length - 1; i++) {
        if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] })
        n = n.dirs.get(parts[i])
      }
      n.files.push({ name: parts[parts.length - 1], rel: parts.join('/'), region: it.region || null, file: async () => it.file })
    }
    const wrap = (n) => ({ name: n.name, path: n.path, async list() { return sortList([...n.dirs.values()].map(wrap), n.files.slice()) } })
    const add = (rel, file) => {
      const parts = rel.split('/').filter(Boolean)
      let n = root
      for (let i = 0; i < parts.length - 1; i++) {
        if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] })
        n = n.dirs.get(parts[i])
      }
      n.files.push({ name: parts[parts.length - 1], rel: parts.join('/'), region: null, file: async () => file })
    }
    return Object.assign(wrap(root), { add })
  }

  /**
   * New material into the image folder: images (or a folder, which keeps its name and
   * subfolders) under `folder`, into the project right away. Returns the new image names.
   */
  async function importIntoFolder(files, folder) {
    const clean = (x) => x.replace(/\s+/g, '_').replace(/[<>:"\\|?*\x00-\x1f]/g, '_')
    const added = []
    const taken = (n) => (rt.atlas && rt.atlas.findRegion(n)) || added.includes(n)
    for (const f of [...files].filter((x) => IMG_RX.test(x.name))) {
      const rel = (f.webkitRelativePath || f.name).split('/').filter(Boolean).map(clean)
      rel[rel.length - 1] = stem(rel[rel.length - 1])
      const base = [...(folder ? folder.split('/') : []), ...rel].join('/')
      let name = base, k = 2
      while (taken(name)) name = base + k++
      await addImageFile(f, name)
      if (state.imageFolder && state.imageFolder.add) state.imageFolder.add(name + '.png', f)
      added.push(name)
    }
    return added
  }

  /** The project's image folder: the PS export's folder, or the atlas images grouped by their folders. */
  function imageFolder() {
    if (state.imageFolder) return state.imageFolder
    return folderFromFiles(state.name || '图片', regionList().map((r) => ({ rel: r.name + '.png', region: r.region })))
  }

  /**
   * Pick an image from the project's image folder (Spine): subfolders first, open one to see
   * its content, the path on top goes back. An image of the folder that is not in the project
   * yet comes in under its path in the folder.
   */
  function openImagePicker(title, onPick, opts) {
    const multi = !!(opts && opts.multi)
    const close = () => { token++; mask.remove() }
    let stack = [], token = 0
    const crumbs = h('div', { class: 'crumbs' })
    const body = h('div', { class: 'bd' })
    const picked = new Map() // multi: rel → file entry, in pick order
    const count = h('span', { class: 'pk-count' })
    let listed = [] // the files of the folder on show, in their order
    // 添加所选: the ticked pictures in the folder's order (name order), not the order they were clicked in
    const pickedInOrder = () => [...listed.filter((f) => picked.has(f.rel)), ...[...picked.values()].filter((f) => !listed.includes(f))]
    const addBtn = h('button', { class: 'btn small primary', disabled: true, onclick: () => confirmMulti(pickedInOrder()) }, '添加所选')
    const syncCount = () => { count.textContent = picked.size ? `已选 ${picked.size} 张` : ''; addBtn.disabled = !picked.size }
    /** the images into the project (the ones not there yet), then the names out */
    const bringIn = async (list) => {
      const names = []
      const before = snapshot()
      let added = false
      try {
        for (const f of list) {
          const name = f.rel.replace(/\.[^.]+$/, '')
          if (!(rt.atlas && rt.atlas.findRegion(name))) { await addImageFile(await f.file(), name); added = true }
          names.push(name)
        }
        if (added) { ensureAtlas(); applyJson(state.json); state.history.push(before); state.future = [] }
      } catch (e) { restore(before); status('导入图片失败：' + e.message, 'error'); return null }
      return names
    }
    const confirmMulti = async (list) => {
      if (!list.length) return
      const names = await bringIn(list)
      if (!names) return
      close()
      onPick(names)
    }
    const pickFile = async (f, tile) => {
      if (multi) {
        if (picked.has(f.rel)) { picked.delete(f.rel); tile.classList.remove('picked') } else { picked.set(f.rel, f); tile.classList.add('picked') }
        syncCount()
        return
      }
      const names = await bringIn([f])
      if (!names) return
      close()
      onPick(names[0])
    }
    const thumbOf = (f, c) => {
      if (f.region) { drawRegionThumb(c, f.region); return }
      f.file().then((file) => createImageBitmap(file)).then((bm) => {
        const k = Math.min(88 / bm.width, 88 / bm.height, 1)
        c.getContext('2d').drawImage(bm, (88 - bm.width * k) / 2, (88 - bm.height * k) / 2, bm.width * k, bm.height * k)
        bm.close()
      }).catch(() => {})
    }
    const fill = async () => {
      const my = ++token
      body.textContent = ''
      crumbs.textContent = ''
      if (!stack.length) stack = [imageFolder()]
      stack.forEach((n, i) => {
        if (i) crumbs.append(h('span', { class: 'sep' }, '/'))
        crumbs.append(h('button', { class: 'crumb', onclick: () => { stack = stack.slice(0, i + 1); fill() } }, n.name))
      })
      let list
      try { list = await stack[stack.length - 1].list() } catch (e) { body.append(h('div', { class: 'hint' }, '读不到这个文件夹：' + e.message)); return }
      if (my !== token) return
      for (const d of list.dirs) {
        body.append(h('div', { class: 'tile folder', title: d.path, onclick: () => { stack = [...stack, d]; fill() } }, h('div', { class: 'fold', html: ICON.folder }), h('span', {}, d.name)))
      }
      for (const f of list.files) {
        const c = h('canvas', { width: 88, height: 88 })
        const tile = h('div', { class: 'tile' + (picked.has(f.rel) ? ' picked' : ''), title: f.rel.replace(/\.[^.]+$/, '') }, c, h('span', {}, f.name.replace(/\.[^.]+$/, '')))
        tile.onclick = () => pickFile(f, tile)
        body.append(tile)
        thumbOf(f, c)
      }
      listed = list.files.slice()
      if (multi) { allBtn.disabled = !list.files.length; allBtn.onclick = () => confirmMulti(list.files.slice()) }
      if (!list.dirs.length && !list.files.length) body.append(h('div', { class: 'hint' }, '这个文件夹里没有图片'))
    }
    const importFrom = (dir) => {
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true })
      if (dir) input.webkitdirectory = true
      input.onchange = async () => {
        const here = stack.length ? stack[stack.length - 1].path : ''
        const before = snapshot()
        try {
          const names = await importIntoFolder(input.files, here)
          if (!names.length) { status('没有可导入的图片（PNG / JPG / WebP）'); return }
          ensureAtlas()
          applyJson(state.json)
          state.history.push(before)
          state.future = []
          status(`已导入 ${names.length} 张图片到「${here || stack[0].name}」`, 'ok')
          // a folder: open it
          if (dir) {
            const top = names[0].slice(here ? here.length + 1 : 0).split('/')[0]
            const l = await stack[stack.length - 1].list()
            const d = l.dirs.find((x) => x.name === top)
            if (d) stack = [...stack, d]
          }
          fill()
        } catch (e) { restore(before); status('导入图片失败：' + e.message, 'error') }
      }
      input.click()
    }
    const allBtn = h('button', { class: 'btn small', title: '当前文件夹里的图片全部加进来（按名字顺序）' }, '本文件夹全部')
    const mask = h('div', { class: 'mask', onclick: (e) => { if (e.target === mask) close() } },
      h('div', { class: 'dialog' },
        h('div', { class: 'hd' }, h('b', {}, title),
          multi ? count : null,
          multi ? addBtn : null,
          multi ? allBtn : null,
          h('button', { class: 'btn small', title: '加新素材：图片导进当前文件夹', onclick: () => importFrom(false) }, '导入图片…'),
          h('button', { class: 'btn small', title: '加新素材：整个文件夹（带子文件夹）导进当前文件夹', onclick: () => importFrom(true) }, '导入文件夹…'),
          h('button', { class: 'xx', onclick: close }, '×')),
        multi ? h('div', { class: 'hint', style: 'padding:8px 14px 0' }, '点图片勾选（再点取消），或「本文件夹全部」；加进来的图片各成一个插槽，挂在卡片栏选的骨骼上') : null,
        crumbs, body))
    document.body.append(mask)
    fill()
  }

  /** 换图: the attachment shows another picture (a region takes its size; a mesh keeps its vertices). */
  function swapImage(sel, name) {
    const size = regionSize(name) || {}
    edit(`已给「${sel.name}」换图：${name}`, (j) => {
      const sk = j.skins.find((x) => x.name === sel.skin)
      const a = sk && sk.attachments[sel.slot] && sk.attachments[sel.slot][sel.name]
      const mesh = a && (a.type === 'mesh' || a.type === 'linkedmesh')
      return Ops.setAttachmentProps(j, sel.skin, sel.slot, sel.name, mesh ? { path: name } : { path: name, ...size })
    })
  }

  /** 放图: a picture into a skin placeholder. */
  function fillPlaceholder(skin, slot, name, image) {
    edit(`已给「${name}」放图：${image}`, (j) => Ops.fillPlaceholder(j, skin, slot, name, { path: image, ...(regionSize(image) || {}) }))
  }

  function drawRegionThumb(canvas, r) {
    const img = r.page && r.texture && r.texture.getImage ? r.texture.getImage() : null
    if (!img) return
    const ctx = canvas.getContext('2d')
    const w = r.rotate ? r.height : r.width
    const hh = r.rotate ? r.width : r.height
    const S = canvas.width || 88
    const s = Math.min(S / r.width, S / r.height, 1)
    ctx.save()
    ctx.translate(S / 2, S / 2)
    // a rotated region sits on the page turned counter-clockwise: turn it back clockwise
    if (r.rotate) ctx.rotate(Math.PI / 2)
    const dw = w * s, dh = hh * s
    ctx.drawImage(img, r.x, r.y, w, hh, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  }

  // ------------------------------------------------------------------ export (Spine 3.8: JSON + images, or JSON + atlas + pages)
  //
  // 打包图集 packs with the production packer (NovaFlowSequenceAtlas: trim, padding, scale, PMA,
  // pages split when full; 合并重复 stays off so every image keeps its own region). Spine's two
  // ways to choose what goes in: 附件 = the images the attachments use, 图片文件夹 = every image
  // in the project's image folder. Unpacked: JSON + images/<name>.png.

  const ATLAS_KEY = 'novaflow.sequenceAtlas.settings.v1' // shared with the production export
  function atlasSettings() {
    const A = window.NovaFlowSequenceAtlas
    let v = {}
    try { v = JSON.parse(localStorage.getItem(ATLAS_KEY) || '{}') } catch {}
    return { ...A.normalizeSettings(v), dedupe: false }
  }

  /** Every image of the project's image folder (subfolders included): [{ name, file }]. */
  async function folderImages() {
    const out = []
    const walk = async (node) => {
      const l = await node.list()
      for (const f of l.files) out.push({ name: f.rel.replace(/\.[^.]+$/, ''), file: f.file })
      for (const d of l.dirs) await walk(d)
    }
    await walk(imageFolder())
    return out
  }

  /** The images the attachments use (附件). */
  function exportImageNames(json) {
    const names = new Set()
    for (const skin of json.skins || []) for (const map of Object.values(skin.attachments || {})) for (const [n, att] of Object.entries(map)) {
      const type = att.type || 'region'
      // Spine 3.8 reads the picture from path, then the attachment's own name field, then the key
      if (type === 'region' || type === 'mesh' || type === 'linkedmesh') names.add(att.path || att.name || n)
    }
    return [...names]
  }

  /** One image's pixels at its original size, straight alpha (from the atlas, or a folder file not used yet). */
  async function imageRgba(name, file) {
    const r = rt.atlas && rt.atlas.findRegion(name)
    if (!r && file) {
      try {
        const bm = await createImageBitmap(await file())
        const c = document.createElement('canvas')
        c.width = bm.width; c.height = bm.height
        const g = c.getContext('2d', { willReadFrequently: true })
        g.drawImage(bm, 0, 0)
        bm.close()
        return { rgba: g.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height }
      } catch { return null }
    }
    if (!r) return null
    const w = r.originalWidth || r.width, hh = r.originalHeight || r.height
    const px = regionPixels(r, w, hh)
    if (!px) return null
    if (state.pma) for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]; if (a && a < 255) { px[i] = Math.min(255, px[i] * 255 / a); px[i + 1] = Math.min(255, px[i + 1] * 255 / a); px[i + 2] = Math.min(255, px[i + 2] * 255 / a) } }
    return { rgba: px, width: w, height: hh }
  }

  /** Writes the export through `write(relativeName, data)`; returns what went out. */
  async function exportProject(opts, write) {
    const A = window.NovaFlowSequenceAtlas
    const SV = window.NovaFlowSpineVersion
    const edited = Ops.exportable(state.json)
    const stash = SV && edited[SV.STASH]
    // out as the version asked for (none = the one the project came in as; 3.8 for a 3.8 file)
    const version = SV ? SV.short(opts.version || (stash ? stash.version : '3.8')) : '3.8'
    const json = SV ? SV.fromSpine38(edited, version) : edited
    const items = opts.mode === 'folder' ? await folderImages() : exportImageNames(json).map((name) => ({ name }))
    if (stash && opts.mode !== 'folder' && version !== '3.8') {
      // 4.1 sequences: every frame, not only the one the editor shows
      const have = new Set(items.map((i) => i.name))
      for (const seq of Object.values(stash.sequences || {})) {
        const sq = seq.sequence || {}
        for (let k = 0; k < Number(sq.count || 0); k++) {
          const base = String(seq.basePath || '')
          if (!base) continue
          const n = base + String(Number(sq.start == null ? 1 : sq.start) + k).padStart(Number(sq.digits || 0), '0')
          if (!have.has(n)) { have.add(n); items.push({ name: n }) }
        }
      }
    }
    // SKEL: the skeleton as Spine binary of the chosen version (renderer/spine-binary-write.js)
    const skel = !!opts.skel
    const writer = A.createWriter({ baseName: opts.name, packed: !!opts.packed, skel, settings: { ...opts.settings, dedupe: false }, version, write })
    const missing = []
    for (const it of items) {
      const img = await imageRgba(it.name, it.file)
      if (!img) { missing.push(it.name); continue }
      await writer.addRgba(img.rgba, img.width, img.height, it.name)
    }
    const out = await writer.finish(json)
    return { ...out, skel, images: items.length - missing.length, missing }
  }

  function openExportDialog(opts) {
    if (!state.json) return
    // 保存工程 (the left column) opens the same dialog: Spine data in the chosen version, written to a folder
    const saving = !!(opts && opts.title)
    const pref = (() => { try { return JSON.parse(localStorage.getItem('nf-skel-export') || '{}') } catch { return {} } })()
    const SV = window.NovaFlowSpineVersion
    const own = ownVersion()
    const o = { name: pref.name || stem(state.fileName) || 'skeleton', packed: pref.packed !== false, mode: pref.mode === 'folder' ? 'folder' : 'atts', version: own, skel: pref.skel === true, kind: saving && pref.kind === 'novaflow' ? 'novaflow' : 'spine' }
    let folderN = null
    folderImages().then((l) => { folderN = l.length; if (mask.isConnected) fill() }, () => {})
    const close = () => mask.remove()
    const body = h('div', { class: 'fm' })
    const fill = () => {
      body.textContent = ''
      const nameIn = h('input', { type: 'text', value: o.name, oninput: (e) => { o.name = e.target.value } })
      const seg = (val, label) => h('button', { 'aria-pressed': String(o.mode === val), onclick: () => { o.mode = val; fill() } }, label)
      const usedN = exportImageNames(Ops.exportable(state.json)).length
      const vseg = (v) => h('button', { 'aria-pressed': String(o.version === v), onclick: () => { o.version = v; fill() } }, v)
      const fseg = (val, label) => h('button', { 'aria-pressed': String(!!o.skel === val), onclick: () => { o.skel = val; fill() } }, label)
      const fmt = o.skel ? 'SKEL' : 'JSON'
      // 保存工程: Spine data (a folder Spine opens with 导入数据) or NovaFlow's own file with every open project
      const kseg = (val, label) => h('button', { 'aria-pressed': String(o.kind === val), onclick: () => { o.kind = val; fill() } }, label)
      if (saving && o.kind === 'novaflow') {
        body.append(
          h('label', { class: 'fl' }, '工程名称'), nameIn,
          h('div', { class: 'pk' }, h('span', { class: 'fl' }, '保存为'), h('div', { class: 'seg' }, kseg('spine', 'Spine 工程'), kseg('novaflow', 'NovaFlow 工程'))),
          h('div', { class: 'hint' }, `工程树里的 ${projects.length} 个工程（骨架、图集、图片、名字和顺序）存成一个 .nfproj 文件，下次用 导入工程 打开。`),
          h('button', { class: 'btn primary big', onclick: runNovaflow }, `保存 NovaFlow 工程（${o.name || '工程'}.nfproj）`))
        return
      }
      body.append(
        h('label', { class: 'fl' }, saving ? '工程名称' : '导出名称'), nameIn,
        saving ? h('div', { class: 'pk' }, h('span', { class: 'fl' }, '保存为'), h('div', { class: 'seg' }, kseg('spine', 'Spine 工程'), kseg('novaflow', 'NovaFlow 工程'))) : null,
        SV ? h('div', { class: 'pk' }, h('span', { class: 'fl' }, '版本'), h('div', { class: 'seg' }, SV.TARGETS.map(vseg))) : null,
        // SKEL = Spine's binary skeleton (the version chosen above); JSON = text
        h('div', { class: 'pk' }, h('span', { class: 'fl' }, '格式'), h('div', { class: 'seg' }, fseg(false, 'JSON'), fseg(true, 'SKEL'))),
        h('label', { class: 'checks', style: 'margin:4px 0 0' }, h('input', { type: 'checkbox', checked: o.packed, onchange: (e) => { o.packed = e.target.checked; fill() } }), '打包图集'),
        o.packed ? h('div', { class: 'pk' },
          h('span', { class: 'fl' }, '打包'),
          h('div', { class: 'seg' }, seg('atts', `附件（${usedN}）`), seg('folder', folderN == null ? '文件夹' : `文件夹（${folderN}）`)),
          btn('打包设置…', openAtlasSettings)) : null,
        h('div', { class: 'hint' }, (o.version === own ? `按工程原版本 ${own} 导出` : `从 ${own} 转成 ${o.version}`) + (o.packed
          ? `，${fmt}＋atlas＋图集 PNG` + (o.mode === 'atts' ? '，只打包附件用到的图片。' : '，文件夹里的图片全部打包。')
          : `，${fmt}＋images 文件夹（每张图一个 PNG）。`)),
        h('button', { class: 'btn primary big', onclick: run }, (saving ? '保存' : '导出') + (o.packed ? ` Spine 工程（${fmt}+ATLAS+PNG，选文件夹）` : ` Spine 工程（${fmt}+images，选文件夹）`)))
    }
    const runNovaflow = async () => {
      const A = window.NovaFlowSequenceAtlas
      o.name = A.safeName(o.name) || 'project'
      try { localStorage.setItem('nf-skel-export', JSON.stringify(o)) } catch {}
      try {
        const { bytes, count } = await projectFileBytes()
        const file = new Blob([bytes], { type: 'application/octet-stream' })
        if (window.showSaveFilePicker) {
          let handle
          try { handle = await window.showSaveFilePicker({ suggestedName: o.name + '.nfproj', types: [{ description: 'NovaFlow 工程', accept: { 'application/octet-stream': ['.nfproj'] } }] }) } catch { return }
          const w = await handle.createWritable(); await w.write(file); await w.close()
        } else {
          const a = h('a', { href: URL.createObjectURL(file), download: o.name + '.nfproj' })
          document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
        }
        close()
        status(`已保存 NovaFlow 工程 ${o.name}.nfproj：${count} 个工程`, 'ok')
      } catch (e) { status('保存失败：' + e.message, 'error') }
    }
    const run = async () => {
      const A = window.NovaFlowSequenceAtlas
      o.name = A.safeName(o.name)
      try { localStorage.setItem('nf-skel-export', JSON.stringify(o)) } catch {}
      let write
      if (window.showDirectoryPicker) {
        let handle
        try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }) } catch { return }
        write = A.createFileWriter({ handle })
      } else {
        // no folder access: each file downloads on its own
        write = async (rel, data) => {
          const a = h('a', { href: URL.createObjectURL(data instanceof Blob ? data : new Blob([data])), download: rel.replace(/\//g, '_') })
          document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
        }
      }
      try {
        const r = await exportProject({ ...o, settings: atlasSettings() }, write)
        close()
        status(`已${saving ? '保存' : '导出'} ${o.name}：${r.images} 张图片${r.packed ? `，${r.pages} 张图集` : ''}${r.missing.length ? `（缺 ${r.missing.length} 张：${r.missing.slice(0, 3).join('、')}）` : ''}`, r.missing.length ? 'error' : 'ok')
      } catch (e) { status((saving ? '保存' : '导出') + '失败：' + e.message, 'error') }
    }
    const mask = h('div', { class: 'mask', onclick: (e) => { if (e.target === mask) close() } },
      h('div', { class: 'dialog export' }, h('div', { class: 'hd' }, h('b', {}, saving ? opts.title : '导出'), h('button', { class: 'xx', onclick: close }, '×')), body))
    document.body.append(mask)
    fill()
  }

  /** The version the project came in as, as the export dialogs show it ('3.8', '4.0' …). */
  function ownVersion() {
    const SV = window.NovaFlowSpineVersion
    const st = state.json && SV && state.json[SV.STASH]
    return SV ? SV.short(st ? st.version : '3.8') || '3.8' : '3.8'
  }

  /** The production 图集打包设置 (same fields, same saved values). */
  function openAtlasSettings() {
    const A = window.NovaFlowSequenceAtlas
    let d = atlasSettings()
    const close = () => mask.remove()
    const body = h('div', { class: 'fm' })
    const num = (k, label, min, max) => h('label', { class: 'nf' }, label, h('input', { type: 'number', min, max, value: d[k], onchange: (e) => { d[k] = Number(e.target.value) } }))
    const size = (k, label) => h('label', { class: 'nf' }, label, selectInput([1024, 2048, 4096].map((v) => [String(v), String(v)]), String(d[k]), (v) => { d[k] = Number(v) }))
    const tog = (k, label) => check(label, d[k], (v) => { d[k] = v })
    const fill = () => {
      body.textContent = ''
      body.append(
        h('div', { class: 'grid2' }, size('maxWidth', '最大宽度'), size('maxHeight', '最大高度'), num('paddingX', '横向间距（px）', 0, 32), num('paddingY', '纵向间距（px）', 0, 32), num('alphaThreshold', 'Alpha 阈值', 0, 254), num('scale', '缩放（%）', 10, 100)),
        h('div', { class: 'checks' }, tog('trim', '去除透明空白'), tog('premultiplyAlpha', '预乘 Alpha（PMA）')),
        h('div', { class: 'hint' }, '缩放只缩小图集像素，骨架里的尺寸不变；超出容量自动分为多张图集。PMA 需与目标运行时的混合设置一致。'),
        h('div', { class: 'btns', style: 'justify-content:flex-end' },
          btn('恢复默认', () => { d = { ...A.defaults, dedupe: false }; fill() }), btn('取消', close),
          btn('保存', () => { try { localStorage.setItem(ATLAS_KEY, JSON.stringify(A.normalizeSettings({ ...d, dedupe: true }))) } catch {} close(); status('打包设置已保存') }, { primary: true })))
    }
    const mask = h('div', { class: 'mask', style: 'z-index:60', onclick: (e) => { if (e.target === mask) close() } },
      h('div', { class: 'dialog export' }, h('div', { class: 'hd' }, h('b', {}, '图集打包设置'), h('button', { class: 'xx', onclick: close }, '×')), body))
    document.body.append(mask)
    fill()
  }

  // ------------------------------------------------------------------ camera + drawing

  function resize() {
    const stage = $('#stage')
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, stage.clientWidth)
    const hh = Math.max(1, stage.clientHeight)
    // the stage's bottom edge moves (动画工具's box, the one-row timeline): the picture stays put
    // under its top edge instead of re-centring - a jump at every step of the layout otherwise
    if (rt.h && hh !== rt.h && rt.cam && !rt.fitLater) rt.cam.y -= (hh - rt.h) * rt.cam.zoom / 2
    rt.w = w; rt.h = hh; rt.dpr = dpr
    if (rt.fitLater && w >= 20 && hh >= 20) { rt.fitLater = false; setTimeout(fit, 0) }
    for (const c of [$('#gl'), $('#overlay')]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(hh * dpr)
      }
    }
  }

  // the picked project's own coordinates on screen: its offset places it beside the other projects
  const toScreen = (wx, wy) => [(wx + state.offset.x - rt.cam.x) / rt.cam.zoom + rt.w / 2, rt.h / 2 - (wy + state.offset.y - rt.cam.y) / rt.cam.zoom]
  const toWorld = (sx, sy) => [(sx - rt.w / 2) * rt.cam.zoom + rt.cam.x - state.offset.x, (rt.h / 2 - sy) * rt.cam.zoom + rt.cam.y - state.offset.y]

  function fit() {
    if (!rt.skeleton) return
    resize()
    // a page that is not laid out yet (the host shows it a moment later) fits once it has a size
    if ($('#stage').clientWidth < 20 || $('#stage').clientHeight < 20) { rt.fitLater = true; return }
    rt.fitLater = false
    const sk = new spine.Skeleton(rt.data)
    sk.setToSetupPose()
    sk.updateWorldTransform()
    const off = new spine.Vector2(), size = new spine.Vector2()
    sk.getBounds(off, size, [])
    let minX = off.x, minY = off.y, maxX = off.x + size.x, maxY = off.y + size.y
    if (!Number.isFinite(minX) || size.x <= 0 || size.y <= 0) {
      minX = minY = Infinity; maxX = maxY = -Infinity
      for (const b of sk.bones) {
        minX = Math.min(minX, b.worldX); maxX = Math.max(maxX, b.worldX)
        minY = Math.min(minY, b.worldY); maxY = Math.max(maxY, b.worldY)
      }
      minX -= 100; maxX += 100; minY -= 100; maxY += 100
    }
    // leave room for the transform panel at the bottom left
    rt.cam.x = (minX + maxX) / 2 + state.offset.x
    rt.cam.y = (minY + maxY) / 2 + state.offset.y
    rt.cam.zoom = Math.max((maxX - minX) / (rt.w * 0.8), (maxY - minY) / (rt.h - 190), 0.01)
    rt.cam.y -= 40 * rt.cam.zoom
  }

  function draw() {
    resize()
    const gl = rt.gl
    gl.viewport(0, 0, $('#gl').width, $('#gl').height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const activeShown = !projects[activeProject] || projects[activeProject].visible !== false
    if (state.opt.imgVis) for (let i = 0; i < activeProject; i++) drawOtherProject(i)
    if (rt.skeleton && state.opt.imgVis && activeShown) {
      // slots hidden with the tree's visibility dot are an editor-only hide
      const saved = []
      for (const n of state.hiddenSlots) {
        const s = rt.skeleton.findSlot(n)
        if (s && s.attachment) { saved.push([s, s.attachment]); s.attachment = null }
      }
      // 编辑网格: its slot shows the edited mesh; 隔离 leaves only that slot
      const editing = state.meshEdit || state.weightEdit
      const R = editing ? meshEditRuntime() : null
      if (R) {
        if (R.slot.attachment !== R.att) { saved.push([R.slot, R.slot.attachment]); R.slot.attachment = R.att }
        if (editing.isolate) for (const s of rt.skeleton.slots) if (s !== R.slot && s.attachment) { saved.push([s, s.attachment]); s.attachment = null }
      }
      const CR = state.clipEdit ? clipRuntime() : null
      if (CR && CR.slot.attachment !== CR.att) { saved.push([CR.slot, CR.slot.attachment]); CR.slot.attachment = CR.att }
      for (const s of rt.skeleton.slots) {
        if (s.attachment instanceof spine.ClippingAttachment && s.attachment.worldVerticesLength < 6) { saved.push([s, s.attachment]); s.attachment = null }
      }
      const r = rt.renderer
      r.camera.position.x = rt.cam.x - state.offset.x
      r.camera.position.y = rt.cam.y - state.offset.y
      r.camera.setViewport($('#gl').width, $('#gl').height)
      r.camera.zoom = rt.cam.zoom / rt.dpr
      r.begin()
      r.drawSkeleton(rt.skeleton, state.pma)
      r.end()
      for (let i = saved.length - 1; i >= 0; i--) saved[i][0].attachment = saved[i][1]
    }
    if (state.opt.imgVis) for (let i = activeProject + 1; i < projects.length; i++) drawOtherProject(i)
    if (activeShown) drawOverlay()
    else $('#overlay').getContext('2d').clearRect(0, 0, $('#overlay').width, $('#overlay').height)
    $('#zoomText').textContent = rt.skeleton ? Math.round(100 / rt.cam.zoom) + '%' : ''
  }

  function boneSegments() {
    const out = []
    if (!rt.skeleton) return out
    for (const b of rt.skeleton.bones) {
      if (!b.active || state.hiddenBones.has(b.data.name)) continue
      const len = b.data.length
      const o = toScreen(b.worldX, b.worldY)
      const t = toScreen(b.worldX + len * b.a, b.worldY + len * b.c)
      out.push({ name: b.data.name, o, t, len: Math.hypot(t[0] - o[0], t[1] - o[1]) })
    }
    return out
  }

  function hitBone(sx, sy) {
    let best = null
    for (const s of boneSegments()) {
      let d
      if (s.len < 8) d = Math.hypot(sx - s.o[0], sy - s.o[1]) - 2
      else {
        const vx = s.t[0] - s.o[0], vy = s.t[1] - s.o[1]
        const u = Math.max(0, Math.min(1, ((sx - s.o[0]) * vx + (sy - s.o[1]) * vy) / (s.len * s.len)))
        d = Math.hypot(sx - (s.o[0] + vx * u), sy - (s.o[1] + vy * u))
      }
      if (state.unselectable.has(s.name)) continue
      if (d <= 7 && (!best || d <= best.d)) best = { name: s.name, d }
    }
    return best && best.name
  }

  /** World polygon of what a slot draws (region quad or mesh triangles). */
  function attachmentWorld(slot) {
    const att = slot.getAttachment()
    if (!att) return null
    if (att instanceof spine.RegionAttachment) {
      const v = new Float32Array(8)
      att.computeWorldVertices(slot.bone, v, 0, 2)
      return { att, v, tris: [0, 1, 2, 2, 3, 0], hull: 4 }
    }
    if (att instanceof spine.MeshAttachment) {
      const n = att.worldVerticesLength
      const v = new Float32Array(n)
      att.computeWorldVertices(slot, 0, n, v, 0, 2)
      return { att, v, tris: att.triangles, hull: att.hullLength / 2 }
    }
    return null
  }

  // ------------------------------------------------------------------ 编辑网格 (Spine's Edit Mesh, in place)
  //
  // The mesh is edited over the real picture; 隔离 shows only its slot. 修改 drags vertices
  // (变形 on: the picture bends with them; off: they slide over it), 创建 adds a vertex where
  // you click (outside the outline the outline grows), 删除 removes one. 新建 starts an outline
  // from clicks, 重置 goes back to the image rectangle, 生成 fills the inside, 描绘 follows the
  // picture's opaque edge. Every change is one undo step.

  const ME = () => window.NovaFlowMeshEdit
  const CORE = () => window.NovaFlowAutoMeshCore
  let meCache = null

  /** The edited mesh as a model (setup pose), with the setup bone matrices to write it back. */
  function meshEditContext() {
    const me = state.meshEdit
    if (!me || !rt.data || !state.json) return null
    const key = `${me.skin}/${me.slot}/${me.name}/${state.skin}`
    if (meCache && meCache.json === state.json && meCache.key === key) return meCache
    meCache = null
    const sj = skinOf(me.skin) && (skinOf(me.skin).attachments[me.slot] || {})[me.name]
    if (!sj) return null
    const owner = sj.type === 'linkedmesh' ? (skinOf(sj.skin || 'default').attachments[me.slot] || {})[sj.parent] : sj
    if (!owner || owner.type !== 'mesh') return null
    const sk = new spine.Skeleton(rt.data)
    if (state.skin !== 'default' && rt.data.findSkin(state.skin)) sk.setSkinByName(state.skin)
    sk.setToSetupPose()
    sk.updateWorldTransform()
    const slot = sk.findSlot(me.slot)
    const skin = rt.data.findSkin(me.skin) || rt.data.defaultSkin
    const att = slot && skin && skin.getAttachment(slot.data.index, me.name)
    if (!(att instanceof spine.MeshAttachment)) return null
    slot.setAttachment(att)
    const n = att.worldVerticesLength
    const world = new Float32Array(n)
    att.computeWorldVertices(slot, 0, n, world, 0, 2)
    const r = att.region
    const size = { width: owner.width || (r && r.originalWidth) || 1, height: owner.height || (r && r.originalHeight) || 1 }
    meCache = {
      json: state.json, key, model: ME().fromAttachment(owner, world, size), slotBone: slot.bone.data.index,
      mats: sk.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY })),
    }
    return meCache
  }

  /** A mesh of any project state as a model (setup pose), with what writing it back needs. */
  function meshModelOf(json, skin, slotName, name) {
    const data = readData(json)
    const sk = new spine.Skeleton(data)
    if (state.skin !== 'default' && data.findSkin(state.skin)) sk.setSkinByName(state.skin)
    sk.setToSetupPose()
    sk.updateWorldTransform()
    const slot = sk.findSlot(slotName)
    const sko = data.findSkin(skin) || data.defaultSkin
    const att = slot && sko && sko.getAttachment(slot.data.index, name)
    if (!(att instanceof spine.MeshAttachment)) throw new Error('不是网格')
    slot.setAttachment(att)
    const n = att.worldVerticesLength
    const world = new Float32Array(n)
    att.computeWorldVertices(slot, 0, n, world, 0, 2)
    const skinJ = (k) => json.skins.find((x) => x.name === k)
    const sj = skinJ(skin).attachments[slotName][name]
    const owner = sj.type === 'linkedmesh' ? skinJ(sj.skin || 'default').attachments[slotName][sj.parent] : sj
    const r = att.region
    const size = { width: owner.width || (r && r.originalWidth) || 1, height: owner.height || (r && r.originalHeight) || 1 }
    return {
      model: ME().fromAttachment(owner, world, size), slotBone: slot.bone.data.index, region: r, bones: sk.bones,
      mats: sk.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY })),
    }
  }

  /** The picked layer's image: { skin, slot, name } (a picked slot means the image it shows). */
  function layerSel() {
    const s = state.sel
    if (!s || !state.json) return null
    if (s.kind === 'att') return { skin: s.skin, slot: s.slot, name: s.name }
    if (s.kind === 'slot' && rt.skeleton) {
      const live = rt.skeleton.findSlot(s.name)
      const att = live && live.getAttachment()
      const key = att && attachmentKey(s.name, att)
      if (key) return { skin: key.skin, slot: s.name, name: key.name }
    }
    return null
  }

  const attJson = (L) => ((skinOf(L.skin) || { attachments: {} }).attachments[L.slot] || {})[L.name]

  // ------------------------------------------------------------------ 编辑权重 (Spine's Weights, in place)
  //
  // Brush on the real picture: 增加 / 减少 pull the picked bone's weight up or down under the
  // brush, 直接 sets it to the 强度 value; every vertex keeps summing to one. The mesh shows the
  // picked bone's weight as heat (blue 0 → red 1). 自动 re-solves with the listed bones,
  // 平滑 / 修剪 clean the whole mesh, 隔离 shows only this picture. One undo step per stroke.

  let weCache = null
  // 动画 mode shows the posed mesh: a setup-space model point is skinned by the current pose
  // (setup inverse of each bone, then its posed matrix) so the brush lands on what is seen
  let weSetupInv = null
  function weScreen(ctx, p) {
    if (state.mode === 'setup' || !rt.skeleton || !rt.data) return toScreen(p.x, p.y)
    if (!weSetupInv) { const sk = new spine.Skeleton(rt.data); sk.setToSetupPose(); sk.updateWorldTransform(); weSetupInv = sk.bones.map((b) => { const det = b.a * b.d - b.b * b.c || 1e-9; return { a: b.d / det, b: -b.b / det, c: -b.c / det, d: b.a / det, x: b.worldX, y: b.worldY } }) }
    const bones = rt.skeleton.bones
    const index = (v) => (typeof v === 'number' ? v : (rt.skeleton.findBone(v) || { data: { index: -1 } }).data.index)
    const w = p.w && p.w.length ? p.w : [[index(ctx && ctx.slotBone), 1]]
    let x = 0, y = 0, sum = 0
    for (const [bi, wt] of w) { const m = weSetupInv[bi], b = bones[bi]; if (!m || !b) continue; const lx = m.a * (p.x - m.x) + m.b * (p.y - m.y), ly = m.c * (p.x - m.x) + m.d * (p.y - m.y); x += (b.a * lx + b.b * ly + b.worldX) * wt; y += (b.c * lx + b.d * ly + b.worldY) * wt; sum += wt }
    return sum > 1e-6 ? toScreen(x / sum, y / sum) : toScreen(p.x, p.y)
  }
  function weightContext() {
    const we = state.weightEdit
    if (!we || !rt.data || !state.json) return null
    const key = `${we.skin}/${we.slot}/${we.name}/${state.skin}`
    if (weCache && weCache.json === state.json && weCache.key === key) return weCache
    weCache = null
    let ctx
    try { ctx = meshModelOf(state.json, we.skin, we.slot, we.name) } catch { return null }
    ctx.model = ME().toWeighted(ctx.model, ctx.slotBone)
    weCache = { ...ctx, json: state.json, key }
    return weCache
  }

  /**
   * The bones on this mesh in list order (the order every vertex lists them in, which is how
   * the order is kept in the file), plus bones bound with no weight yet. Dragging rows reorders.
   */
  function weightBones(ctx) {
    const we = state.weightEdit
    const list = ME().boneOrder(ctx.model)
    for (const b of we.extra) if (!list.includes(b)) list.push(b)
    if (we.order) {
      const r = new Map(we.order.map((b, i) => [b, i]))
      const at = (b) => (r.has(b) ? r.get(b) : 1e6 + list.indexOf(b))
      list.sort((a, b) => at(a) - at(b))
    }
    return list
  }

  function enterWeightEdit(L) {
    weSetupInv = null
    const a = attJson(L)
    if (!a) return
    if ((a.type || 'region') === 'region') {
      if (!edit(`「${L.name}」已转成网格`, (j) => Ops.regionToMesh(j, L.skin, L.slot, L.name))) return
    } else if (a.type !== 'mesh' && a.type !== 'linkedmesh') { status('只有图片和网格能编辑权重'); return }
    state.meshEdit = null
    // 模式 starts on 直接 (user's pick): pick vertices, drag up / down to set the weight
    state.weightEdit = { skin: L.skin, slot: L.slot, name: L.name, bone: null, mode: 'direct', strength: 50, size: 60, feather: 60, overlay: false, onlySel: false, isolate: false,
      direct: true, vsel: new Set(), binding: null, order: null, extra: [] }
    weCache = null
    const ctx = weightContext()
    if (ctx) state.weightEdit.bone = weightBones(ctx)[0]
    if (!(state.sel && state.sel.kind === 'att' && state.sel.slot === L.slot && state.sel.name === L.name)) state.sel = { kind: 'att', skin: L.skin, slot: L.slot, name: L.name }
    refresh()
  }

  function exitWeightEdit() {
    if (!state.weightEdit) return
    state.weightEdit = null
    state.weightStroke = null
    weCache = null
    refresh()
  }

  function commitWeights(model, label) {
    const we = state.weightEdit, ctx = weightContext()
    if (!we || !ctx) return
    // every vertex lists its bones in the list's order: that is the order the file keeps
    const m = ME().orderInfluences(model, weightBones(ctx))
    edit(label, (j) => Ops.setMesh(j, we.skin, we.slot, we.name, ME().toAttachment(m, ctx.mats, ctx.slotBone), ME().remapOf(m)))
  }

  /** The vertex under the pointer (within its pie), or -1. */
  function weightVertexAt(ctx, sx, sy) {
    let best = -1, bd = 9
    ctx.model.points.forEach((p, i) => { const q = weScreen(ctx, p); const d = Math.hypot(q[0] - sx, q[1] - sy); if (d < bd) { bd = d; best = i } })
    return best
  }

  /** 直接: a box drag picks the vertices inside it (Ctrl / Shift add to the picked ones). */
  function finishWeightBox() {
    const b = state.wbox, we = state.weightEdit, ctx = weightContext()
    state.wbox = null
    if (!b || !we || !ctx) return
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1)
    if (x1 - x0 < 3 && y1 - y0 < 3) { if (!b.add) we.vsel = new Set(); renderWeightPanel(); return }
    const hits = []
    ctx.model.points.forEach((p, i) => { const q = weScreen(ctx, p); if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) hits.push(i) })
    we.vsel = new Set(b.add ? [...we.vsel, ...hits] : hits)
    renderWeightPanel()
  }

  /** 绑定 (Spine): a bone clicked in the viewport or the tree joins / leaves the binding. */
  function toggleBind(bone) {
    const we = state.weightEdit
    if (!we || !we.binding) return
    const i = we.binding.indexOf(bone)
    if (i >= 0) we.binding.splice(i, 1)
    else we.binding.push(bone)
    renderWeightPanel()
  }

  /**
   * 绑定 again: the picked bones are the binding. A mesh bound for the first time gets its
   * weights worked out (like Spine); otherwise kept bones keep their weights, new ones start
   * at 0 and a dropped bone hands its weight to the nearest bone still bound.
   */
  function finishBind() {
    const we = state.weightEdit, ctx = weightContext()
    if (!we || !we.binding || !ctx) return
    const next = we.binding.slice()
    if (!next.length) { status('至少要绑定一根骨骼'); return }
    const had = ME().boneOrder(ctx.model)
    const was = weightBones(ctx)
    we.binding = null
    const added = next.filter((b) => !was.includes(b)), removed = was.filter((b) => !next.includes(b))
    we.order = next
    we.extra = next.filter((b) => !had.includes(b))
    if (we.bone == null || !next.includes(we.bone)) we.bone = next[0]
    if (!added.length && !removed.length) { renderWeightPanel(); return }
    const L = { skin: we.skin, slot: we.slot, name: we.name }
    if (had.length <= 1 && next.length > 1) {
      we.extra = []
      batchEdit([L], `已绑定 ${next.length} 根骨骼并自动算好权重`, (j, x) => weighOneLayer(j, x, next))
      return
    }
    let model = ctx.model
    if (removed.length) {
      const near = (p) => {
        let best = next[0], bd = Infinity
        for (const i of next) {
          const b = rt.skeleton.bones[i]
          const ax = b.worldX, ay = b.worldY, dx = b.data.length * b.a, dy = b.data.length * b.c
          const l2 = dx * dx + dy * dy
          const t = l2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0
          const d = Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy)
          if (d < bd) { bd = d; best = i }
        }
        return best
      }
      for (const b of removed) model = ME().removeBone(model, b, near)
      we.extra = we.extra.filter((b) => !removed.includes(b))
      commitWeights(model, `绑定：${next.length} 根骨骼（去掉 ${removed.length} 根${added.length ? `，加入 ${added.length} 根，权重为 0` : ''}）`)
      return
    }
    renderWeightPanel()
    status(`已加入 ${added.length} 根骨骼，权重为 0：用笔刷、「直接」或「自动」分配`)
  }

  /** The list rows' picked mark, without rebuilding the list (a rebuild would eat a double-click). */
  function markWeightRows() {
    const we = state.weightEdit
    for (const r of document.querySelectorAll('#weightPanel .wrow')) r.setAttribute('aria-pressed', String(!we.binding && Number(r.dataset.bone) === we.bone))
  }

  /** A press on a bone row: a click picks the bone, a drag moves it in the list. */
  function weightRowDown(e, bone) {
    const we = state.weightEdit
    if (e.button !== 0 || !we) return
    if (we.binding) { toggleBind(bone); return }
    const row = e.currentTarget, list = row.parentElement
    const y0 = e.clientY
    let dragging = false, target = null
    row.setPointerCapture(e.pointerId)
    const clear = () => list.querySelectorAll('.wrow').forEach((r) => r.classList.remove('drop-a', 'drop-b', 'dragging'))
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientY - y0) < 4) return
      dragging = true
      clear()
      row.classList.add('dragging')
      const rs = [...list.querySelectorAll('.wrow')]
      target = null
      for (const r of rs) { const b = r.getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { target = [r, 'a']; break } }
      if (!target) target = [rs[rs.length - 1], 'b']
      target[0].classList.add(target[1] === 'a' ? 'drop-a' : 'drop-b')
    }
    const up = () => {
      row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', up); row.removeEventListener('pointercancel', up)
      clear()
      if (!dragging) { we.bone = bone; markWeightRows(); return }
      const tb = Number(target[0].dataset.bone)
      if (tb === bone) return
      const order = weightBones(weightContext()).filter((b) => b !== bone)
      order.splice(order.indexOf(tb) + (target[1] === 'b' ? 1 : 0), 0, bone)
      reorderWeightBones(order)
    }
    row.addEventListener('pointermove', move); row.addEventListener('pointerup', up); row.addEventListener('pointercancel', up)
  }

  function reorderWeightBones(order) {
    const we = state.weightEdit, ctx = weightContext()
    we.order = order
    const sig = (m) => JSON.stringify(m.points.map((p) => p.w.map(([b]) => b)))
    if (sig(ME().orderInfluences(ctx.model, order)) === sig(ctx.model)) { renderWeightPanel(); return }
    commitWeights(ctx.model, '已调整骨骼顺序')
  }

  const pctText = (w) => (w == null ? '—' : `${Math.round(w * 1000) / 10}%`)

  /** 直接: drag a percentage left / right to move that bone's weight on the picked vertices. */
  function scrubWeight(e, bone) {
    e.stopPropagation()
    const we = state.weightEdit, ctx = weightContext()
    if (e.button !== 0 || !we || !ctx) return
    const idxs = [...we.vsel], base = ctx.model, el = e.currentTarget, x0 = e.clientX, y0 = e.clientY
    el.setPointerCapture(e.pointerId)
    we.bone = bone
    markWeightRows()
    let changed = false
    const move = (ev) => {
      const d = (ev.clientX - x0) - (ev.clientY - y0)
      if (!changed && Math.abs(d) < 2) return
      changed = true
      state.weightStroke = { model: ME().nudgeWeights(base, idxs, bone, d / 200), changed: true }
      el.textContent = pctText(ME().meanWeight(state.weightStroke.model, idxs, bone))
    }
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      const st = state.weightStroke
      state.weightStroke = null
      if (changed && st) commitWeights(st.model, `已调整 ${idxs.length} 个顶点的「${rt.skeleton.bones[bone].data.name}」权重`)
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }

  /** 直接: double-click a percentage to type the weight for every picked vertex. */
  function typeWeight(e, bone) {
    e.stopPropagation()
    const we = state.weightEdit, ctx = weightContext()
    if (!we || !ctx) return
    const idxs = [...we.vsel], el = e.currentTarget
    const cur = ME().meanWeight(ctx.model, idxs, bone)
    const inp = h('input', { type: 'number', class: 'pin', min: 0, max: 100, step: 'any', value: cur == null ? 0 : Math.round(cur * 1000) / 10 })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      const v = Number(inp.value)
      if (!ok || !Number.isFinite(v)) { renderWeightPanel(); return }
      commitWeights(ME().nudgeWeights(ctx.model, idxs, bone, 0, Math.max(0, Math.min(100, v)) / 100), `已把 ${idxs.length} 个顶点的「${rt.skeleton.bones[bone].data.name}」权重设为 ${Math.round(v * 10) / 10}%`)
    }
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false) })
    inp.addEventListener('blur', () => finish(true))
    inp.addEventListener('pointerdown', (ev) => ev.stopPropagation())
    el.replaceWith(inp)
    inp.focus(); inp.select()
  }

  /** Vertices under the brush with their falloff: full inside, fading over the 羽化 part of the edge. */
  function weightHits(model, sx, sy, size, feather) {
    const out = []
    const inner = size * (1 - feather / 100), wctx = weightContext()
    model.points.forEach((p, i) => {
      const q = weScreen(wctx, p)
      const d = Math.hypot(q[0] - sx, q[1] - sy)
      if (d <= size) out.push([i, d <= inner ? 1 : 1 - (d - inner) / Math.max(1e-6, size - inner)])
    })
    return out
  }

  function weightDab(sx, sy) {
    const we = state.weightEdit, st = state.weightStroke
    if (!st || we.bone == null) return
    const hits = weightHits(st.model, sx, sy, we.size, we.feather)
    if (!hits.length) return
    // 替换 moves toward 力度 itself; 增加 / 减少 a little per step, 力度 setting how much
    st.model = we.mode === 'set'
      ? ME().paintWeights(st.model, hits, we.bone, 'set', we.strength / 100)
      : ME().paintWeights(st.model, hits, we.bone, we.mode, we.strength / 100 * 0.25)
    st.changed = true
  }

  // the production weight editor's palette, one colour per bone
  const BONE_PALETTE = ['#4cc9f0', '#f72585', '#7b5cff', '#ff7f11', '#7ae582', '#ffd166', '#ef476f', '#06d6a0', '#c77dff', '#ff9e00', '#48bfe3', '#f9c74f', '#90be6d', '#f8961e', '#577590', '#e07a5f']
  const boneColor = (i) => BONE_PALETTE[Math.abs(i | 0) % BONE_PALETTE.length]

  function weightAction(kind) {
    const we = state.weightEdit, ctx = weightContext()
    if (!we || !ctx) return
    if (kind === 'bind') {
      if (we.binding) { finishBind(); return }
      // Spine: the pies go, the bones clicked in the viewport or the tree join / leave the binding
      we.binding = weightBones(ctx).slice()
      we.vsel = new Set()
      status('绑定：在画面或工程树里点骨骼加入 / 移出，再点「绑定」完成（Esc 取消）')
      renderWeightPanel()
      return
    }
    if (kind === 'delete') {
      if (we.bone == null) return
      const rest = weightBones(ctx).filter((b) => b !== we.bone)
      we.extra = we.extra.filter((b) => b !== we.bone)
      const gone = we.bone
      we.bone = rest[0] != null ? rest[0] : null
      commitWeights(ME().removeBone(ctx.model, gone, rest[0] != null ? rest[0] : ctx.slotBone), `已从绑定里删除「${rt.skeleton.bones[gone].data.name}」`)
      return
    }
    if (kind === 'auto') { const ids = weightBones(ctx); batchEdit([{ skin: we.skin, slot: we.slot, name: we.name }], '自动权重', (j, L) => weighOneLayer(j, L, ids)); return }
    // with 直接 and picked vertices, 平滑 / 修剪 work on those only
    const only = we.direct && we.vsel.size ? [...we.vsel] : null
    if (kind === 'smooth') commitWeights(ME().smoothWeights(ctx.model, only), only ? `${only.length} 个顶点的权重已平滑` : '权重已平滑')
    if (kind === 'prune') commitWeights(ME().pruneWeights(ctx.model, 0.05, only), '已修剪低于 5% 的权重')
  }

  /**
   * The mesh with its weights: 饼图 = every vertex a pie of its bones' colours, 叠加 = the
   * triangles tinted by the picked bone's weight, 已选 = only the picked bone's part shows.
   * The bound bones are drawn in their colours, the picked one thicker; the brush shows its 羽化.
   */
  function drawWeightEdit(g) {
    const we = state.weightEdit, ctx = weightContext()
    if (!ctx) return
    const model = state.weightStroke ? state.weightStroke.model : ctx.model
    const order = weightBones(ctx)
    const rank = new Map(order.map((b, i) => [b, i]))
    const rk = (b) => (rank.has(b) ? rank.get(b) : 1e6 + b)
    const wOf = (p) => { const e = p.w.find(([b]) => b === we.bone); return e ? e[1] : 0 }
    const pts = model.points.map((p) => weScreen(ctx, p))
    const T = model.tris
    const sel = we.bone != null ? boneColor(we.bone) : '#1EA672'
    // Spine: the bones bound to this mesh solid in their colours, every other bone faint
    const bound = new Set(we.binding || order)
    const blade = (b) => {
      const o = toScreen(b.worldX, b.worldY), t = toScreen(b.worldX + b.data.length * b.a, b.worldY + b.data.length * b.c)
      const len = Math.hypot(t[0] - o[0], t[1] - o[1])
      g.beginPath()
      if (len < 8) { g.arc(o[0], o[1], 5, 0, Math.PI * 2); return }
      const vx = (t[0] - o[0]) / len, vy = (t[1] - o[1]) / len
      const w = Math.min(7, Math.max(3, len * 0.09)), k = Math.min(len * 0.18, 14)
      const mx = o[0] + vx * k, my = o[1] + vy * k
      g.moveTo(o[0], o[1]); g.lineTo(mx - vy * w, my + vx * w); g.lineTo(t[0], t[1]); g.lineTo(mx + vy * w, my - vx * w); g.closePath()
    }
    g.save()
    for (const b of rt.skeleton.bones) {
      if (bound.has(b.data.index) || state.hiddenBones.has(b.data.name)) continue
      blade(b)
      if (we.binding) {
        const own = bone(b.data.name) && bone(b.data.name).color
        g.fillStyle = state.hover === b.data.name ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.3)'; g.fill()
        g.strokeStyle = own ? '#' + String(own).slice(0, 6) : ROLE_COLOR[state.roles.get(b.data.name) || 'normal']
        g.lineWidth = state.hover === b.data.name ? 2 : 1.3; g.stroke()
      } else { g.fillStyle = 'rgba(190,190,190,.1)'; g.fill(); g.strokeStyle = 'rgba(190,190,190,.22)'; g.lineWidth = 1; g.stroke() }
    }
    g.lineWidth = 0.7
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], c = T[t + 2]
      g.beginPath(); g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]); g.lineTo(pts[c][0], pts[c][1]); g.closePath()
      if (we.overlay && !we.binding) {
        const w = (wOf(model.points[a]) + wOf(model.points[b]) + wOf(model.points[c])) / 3
        g.globalAlpha = 0.12 + 0.6 * w; g.fillStyle = sel; g.fill(); g.globalAlpha = 1
      }
      g.strokeStyle = 'rgba(34,201,138,.55)'; g.stroke()
    }
    // the bound bones (while binding: the bones picked so far), solid; the picked one ringed white
    for (const i of bound) {
      const bn = rt.skeleton.bones[i]
      if (!bn) continue
      const on = !we.binding && i === we.bone
      blade(bn); g.fillStyle = boneColor(i); g.fill()
      g.lineWidth = on ? 2.5 : 1.2; g.strokeStyle = on ? '#fff' : 'rgba(0,0,0,.6)'; g.stroke()
      const o = toScreen(bn.worldX, bn.worldY)
      g.beginPath(); g.arc(o[0], o[1], on ? 3.4 : 2.6, 0, Math.PI * 2); g.fillStyle = on ? '#fff' : 'rgba(0,0,0,.55)'; g.fill()
    }
    if (we.binding) {
      // binding: no pies, only the mesh's vertices
      g.fillStyle = '#2fd5e8'
      for (const [x, y] of pts) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill() }
    } else {
      // every vertex a pie of its bones' colours, in the list's order
      const R = 7
      model.points.forEach((p, i) => {
        const [x, y] = pts[i]
        let a0 = -Math.PI / 2
        for (const [bone, w] of p.w.slice().sort((a, b) => rk(a[0]) - rk(b[0]))) {
          const a1 = a0 + w * Math.PI * 2
          g.beginPath(); g.moveTo(x, y); g.arc(x, y, R, a0, a1); g.closePath()
          g.fillStyle = we.onlySel && bone !== we.bone ? 'rgba(60,60,60,.9)' : boneColor(bone); g.fill()
          a0 = a1
        }
        g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1.2; g.stroke()
        if (we.direct && we.vsel.has(i)) { g.beginPath(); g.arc(x, y, R + 2.5, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke() }
      })
    }
    if (state.meshPointer && !we.direct && !we.binding) {
      const [mx, my] = state.meshPointer
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1
      g.beginPath(); g.arc(mx, my, we.size, 0, Math.PI * 2); g.stroke()
      if (we.feather > 0) { g.setLineDash([3, 3]); g.beginPath(); g.arc(mx, my, we.size * (1 - we.feather / 100), 0, Math.PI * 2); g.stroke(); g.setLineDash([]) }
    }
    if (state.wbox) {
      const b = state.wbox
      g.setLineDash([4, 3]); g.strokeStyle = '#fff'; g.lineWidth = 1; g.fillStyle = 'rgba(255,255,255,.06)'
      g.beginPath(); g.rect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); g.fill(); g.stroke(); g.setLineDash([])
    }
    g.restore()
  }

  /**
   * Spine's 权重 view: 模式 / 力度 / 大小 / 羽化 for the brush, 平滑 自动 修剪, 直接 叠加 已选 隔离,
   * the bones (drag to reorder; with 直接 and picked vertices each shows its weight there, drag
   * it to change it), 绑定 / 删除.
   */
  function renderWeightPanel() {
    const p = $('#weightPanel')
    const we = state.weightEdit
    const ctx = we && weightContext()
    p.hidden = !ctx
    if (!ctx) { p.textContent = ''; return }
    const keepScroll = p.querySelector('.wl') ? p.querySelector('.wl').scrollTop : 0
    p.textContent = ''
    const binding = !!we.binding
    const bones = binding ? we.binding : weightBones(ctx)
    const model = state.weightStroke ? state.weightStroke.model : ctx.model
    const counts = ME().boneCounts(model)
    const picked = we.direct ? [...we.vsel].filter((i) => i < model.points.length) : []
    const name = (i) => (rt.skeleton && rt.skeleton.bones[i] ? rt.skeleton.bones[i].data.name : String(i))
    const brushOff = we.direct || binding ? ' off' : ''
    const setMode = (v) => { we.mode = v; we.direct = v === 'direct'; if (!we.direct) we.vsel = new Set(); renderWeightPanel() }
    const slider = (key, min, max, label, title) => {
      const v = h('b', {}, String(we[key]))
      return h('label', { class: 'wsl' + brushOff, title }, h('span', {}, label), h('input', { type: 'range', min, max, step: 1, value: we[key], oninput: (e) => { we[key] = Number(e.target.value); v.textContent = String(we[key]) } }), v)
    }
    const tg = (key, label, title) => h('label', { class: 'mc' + (binding ? ' off' : ''), title }, h('input', { type: 'checkbox', checked: !!we[key], onchange: (e) => { we[key] = e.target.checked; renderWeightPanel() } }), label)
    const act = (id, label, title) => h('button', { class: 'mt', title, disabled: binding, onclick: () => weightAction(id) }, label)
    const right = (i) => {
      if (binding) return null
      if (!picked.length) return h('span', { class: 'c' }, String(counts.get(i) || 0))
      const mw = ME().meanWeight(model, picked, i)
      return h('span', { class: 'pct' + (mw == null ? ' none' : ''), title: '按住上下拖：改选中顶点的这根骨骼权重（往上加）；双击输入',
        onpointerdown: (e) => scrubWeight(e, i), ondblclick: (e) => typeWeight(e, i) }, pctText(mw))
    }
    p.append(
      h('div', { class: 'mhd' }, h('b', {}, '权重'), h('span', { class: 'wn' }, we.name), h('button', { class: 'xx', title: '完成（Enter / Esc）', onclick: exitWeightEdit }, '×')),
      h('label', { class: 'wsl' + (binding ? ' off' : ''), title: '直接 = 不用笔刷：点 / 框选顶点（Ctrl / Shift 加选），按住顶点上下拖改选中骨骼的权重' }, h('span', {}, '模式'),
        selectInput([['add', '增加'], ['sub', '减少'], ['set', '替换'], ['direct', '直接']], we.mode, setMode)),
      slider('strength', 0, 100, '力度', '增加 / 减少：每一笔加减多少；替换：把权重设成这个百分比'),
      slider('size', 4, 200, '大小', '笔刷半径（屏幕像素）'),
      slider('feather', 0, 100, '羽化', '笔刷边缘渐弱的比例：0 = 硬边'),
      h('div', { class: 'mrow' },
        act('smooth', '平滑', '和相邻顶点平均一下（直接模式下只平滑选中的顶点）'),
        act('auto', '自动', '用下面这些骨骼重新算一遍（骨骼热扩散）'),
        act('prune', '修剪', '去掉低于 5% 的权重（直接模式下只修剪选中的顶点）')),
      h('div', { class: 'mrow mopts' },
        tg('overlay', '叠加', '网格按选中骨骼的权重染色'),
        tg('onlySel', '已选', '饼图里只显示选中骨骼那一块'),
        tg('isolate', '隔离', '只显示这张图')),
      h('div', { class: 'wcap' }, binding ? `绑定（${bones.length}）` : `骨骼（${bones.length}）`,
        h('span', { class: 'wv' }, binding ? '点骨骼加入 / 移出' : picked.length ? `已选 ${picked.length} / ${model.points.length} 顶点` : `顶点 ${model.points.length}`)),
      h('div', { class: 'wl' }, bones.map((i) => h('div', { class: 'wrow', 'data-bone': i, 'aria-pressed': String(!binding && we.bone === i),
        title: binding ? `点一下把「${name(i)}」移出绑定` : `「${name(i)}」：点一下选中刷它的权重，上下拖动调整顺序`, onpointerdown: (e) => weightRowDown(e, i) },
        h('i', { style: `background:${boneColor(i)}` }), h('span', { class: 'n' }, name(i)), right(i)))),
      h('div', { class: 'mrow' },
        h('button', { class: 'mt', 'aria-pressed': String(binding), title: binding ? '完成绑定（Enter）' : '选择要绑定的骨骼：点了以后在画面或工程树里点骨骼加入 / 移出，再点一次完成', onclick: () => weightAction('bind') }, '绑定'),
        h('button', { class: 'mt', title: '把列表里选中的骨骼从这张网格上去掉，它的权重分给其它骨骼', disabled: binding || we.bone == null || bones.length <= 1, onclick: () => weightAction('delete') }, '删除')))
    const wl = p.querySelector('.wl')
    if (wl) wl.scrollTop = keepScroll
  }

  /** The edited attachment in the live skeleton (drawn in its slot while editing). */
  function meshEditRuntime() {
    const me = state.meshEdit || state.weightEdit
    const slot = me && rt.skeleton && rt.skeleton.findSlot(me.slot)
    const skin = slot && (rt.data.findSkin(me.skin) || rt.data.defaultSkin)
    const att = skin && skin.getAttachment(slot.data.index, me.name)
    return att instanceof spine.MeshAttachment ? { slot, att } : null
  }

  function enterMeshEdit(sel) {
    if (state.mode !== 'setup') { status('编辑网格在「设置」模式下用'); return }
    const att = skinOf(sel.skin).attachments[sel.slot][sel.name]
    const type = att.type || 'region'
    if (type === 'region') {
      // Spine: an image becomes a mesh first (its rectangle, four vertices)
      if (!edit(`「${sel.name}」已转成网格`, (j) => Ops.regionToMesh(j, sel.skin, sel.slot, sel.name))) return
    } else if (type !== 'mesh' && type !== 'linkedmesh') { status('只有图片和网格能编辑网格'); return }
    state.meshEdit = { skin: sel.skin, slot: sel.slot, name: sel.name, tool: 'modify', isolate: false, sel: new Set(), draft: null, trace: null }
    meCache = null
    refresh()
  }

  function exitMeshEdit() {
    if (!state.meshEdit) return
    if (state.meshEdit.trace) state.traceOpts = { ...state.meshEdit.trace.opts }
    state.meshEdit = null
    state.meshDrag = null
    meCache = null
    refresh()
  }

  function commitMesh(model, label, after) {
    const me = state.meshEdit, ctx = meshEditContext()
    if (!me || !ctx) return
    edit(label, (j) => Ops.setMesh(j, me.skin, me.slot, me.name, ME().toAttachment(model, ctx.mats, ctx.slotBone), ME().remapOf(model)), () => { if (after) after() })
  }

  /** The image's own pixels at its original size (for 描绘). */
  /**
   * The image's own pixels at its original size, cut out of the page's pixels (one read per
   * page, cached). A canvas per picture, as before, left hundreds of big canvases behind on a
   * large rig: the export of 抽卡 (197 pictures) stalled the whole page for minutes.
   */
  function regionPixels(region, W, H) {
    const img = region && region.texture && region.texture.getImage ? region.texture.getImage() : null
    if (!img) return null
    const w = Math.max(1, Math.round(W)), hh = Math.max(1, Math.round(H))
    const ow = region.originalWidth || w, oh = region.originalHeight || hh
    const pg = w === ow && hh === oh ? pageOf({ region }) : null
    if (!pg || !pg.data) return regionPixelsCanvas(region, W, H)
    const src = pg.data, pw = pg.w, ph = pg.h
    const out = new Uint8ClampedArray(w * hh * 4)
    const left = region.offsetX || 0, top = oh - (region.offsetY || 0) - region.height
    const rw = region.width, rh = region.height, rx = region.x, ry = region.y
    if (!region.rotate) {
      for (let y = 0; y < rh; y++) {
        const dy = top + y, sy = ry + y
        if (dy < 0 || dy >= hh || sy < 0 || sy >= ph) continue
        const x0 = Math.max(0, -left, -rx), x1 = Math.min(rw, w - left, pw - rx)
        if (x1 <= x0) continue
        out.set(src.subarray((sy * pw + rx + x0) * 4, (sy * pw + rx + x1) * 4), ((dy * w) + left + x0) * 4)
      }
    } else {
      // the page holds the picture turned 90° counter-clockwise (rh wide, rw tall on the page):
      // picture (u, v) = page (rx + v, ry + rw - 1 - u)... as the canvas path draws it
      for (let v = 0; v < rh; v++) {
        const dy = top + v
        if (dy < 0 || dy >= hh) continue
        for (let u = 0; u < rw; u++) {
          const dx = left + u
          if (dx < 0 || dx >= w) continue
          const sx = rx + v, sy = ry + rw - 1 - u
          if (sx < 0 || sx >= pw || sy < 0 || sy >= ph) continue
          const si = (sy * pw + sx) * 4, di = (dy * w + dx) * 4
          out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3]
        }
      }
    }
    return out
  }

  /** The same through a canvas (pictures shown at another size than their original). */
  function regionPixelsCanvas(region, W, H) {
    const img = region && region.texture && region.texture.getImage ? region.texture.getImage() : null
    if (!img) return null
    const w = Math.max(1, Math.round(W)), hh = Math.max(1, Math.round(H))
    const ow = region.originalWidth || w, oh = region.originalHeight || hh
    const c = document.createElement('canvas')
    c.width = w; c.height = hh
    const g = c.getContext('2d', { willReadFrequently: true })
    g.scale(w / ow, hh / oh)
    const left = region.offsetX || 0, top = oh - (region.offsetY || 0) - region.height
    if (region.rotate) {
      // Spine 3.8 packs a rotated region turned 90° counter-clockwise (height × width on the page);
      // turning the page rect 90° clockwise gives the picture back
      g.translate(left + region.width, top)
      g.rotate(Math.PI / 2)
      g.drawImage(img, region.x, region.y, region.height, region.width, 0, 0, region.height, region.width)
    } else g.drawImage(img, region.x, region.y, region.width, region.height, left, top, region.width, region.height)
    try { return g.getImageData(0, 0, w, hh).data } catch { return null }
  }

  function meshAction(kind) {
    const me = state.meshEdit, ctx = meshEditContext()
    if (!me || !ctx) return
    try {
      if (kind === 'new') {
        me.draft = []
        me.sel = new Set()
        status('新建：在画面里依次点外圈的点，点回第一个点或按 Enter 完成，Esc 取消')
        renderMeshPanel()
      } else if (kind === 'reset') {
        commitMesh(ME().reset(ctx.model, CORE()), '已重置网格（图片的矩形）', () => { me.sel = new Set() })
      } else if (kind === 'generate') {
        const m = ME().generate(ctx.model, CORE())
        commitMesh(m, `已生成 ${m.points.length - ctx.model.points.length} 个内部顶点（再点继续加密）`)
      } else if (kind === 'trace') {
        openTrace()
      }
    } catch (e) { status(e.message, 'error') }
  }

  // ---------- 描绘 (Spine's Trace dialog): settings, a live outline over the picture, 确定 applies

  function openTrace() {
    const me = state.meshEdit, ctx = meshEditContext()
    const R = meshEditRuntime()
    const px = R && regionPixels(R.att.region, ctx.model.width, ctx.model.height)
    if (!px) { status('读不到这张图的像素', 'error'); return }
    me.draft = null
    me.trace = { opts: { ...ME().TRACE_DEFAULTS, ...(state.traceOpts || {}) }, px, W: Math.round(ctx.model.width), H: Math.round(ctx.model.height), pts: null, err: '' }
    computeTrace()
    renderTracePanel()
    renderMeshPanel()
  }

  function computeTrace() {
    const t = state.meshEdit && state.meshEdit.trace
    if (!t) return
    try { t.pts = ME().traceOutline(t.px, t.W, t.H, CORE(), t.opts); t.err = '' } catch (e) { t.pts = null; t.err = e.message }
  }

  function closeTrace(apply) {
    const me = state.meshEdit, ctx = meshEditContext()
    const t = me && me.trace
    if (!t) return
    me.trace = null
    state.traceOpts = { ...t.opts }
    renderTracePanel()
    if (!apply || !ctx) { renderMeshPanel(); return }
    if (!t.pts) { status(t.err || '没有描出轮廓', 'error'); renderMeshPanel(); return }
    try {
      const m = ME().trace(ctx.model, t.px, CORE(), t.opts)
      commitMesh(m, `已描绘外圈（${m.hull} 个顶点）`, () => { me.sel = new Set() })
    } catch (e) { status(e.message, 'error'); renderMeshPanel() }
  }

  /** The 描绘 window: 细节 / 凹度 / 精致度 / Alpha 阈值 / 填充, 刷新, the vertex count, 取消 / 确定. */
  function renderTracePanel() {
    const p = $('#tracePanel')
    const t = state.meshEdit && state.meshEdit.trace
    p.hidden = !t
    p.textContent = ''
    if (!t) return
    const count = h('span', { class: 'wv' }, t.pts ? `顶点：${t.pts.length}` : t.err)
    let queued = false
    const live = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; computeTrace(); count.textContent = t.pts ? `顶点：${t.pts.length}` : t.err })
    }
    const slider = (key, min, max, step, label, title) => {
      const v = h('b', {}, String(t.opts[key]))
      return h('label', { class: 'wsl', title }, h('span', {}, label),
        h('input', { type: 'range', min, max, step, value: t.opts[key], oninput: (e) => { t.opts[key] = Number(e.target.value); v.textContent = String(t.opts[key]); live() } }), v)
    }
    p.append(
      h('div', { class: 'mhd' }, h('b', {}, '编辑网格：描绘'), h('button', { class: 'xx', title: '取消（Esc）', onclick: () => closeTrace(false) }, '×')),
      slider('detail', 0, 100, 0.5, '细节', '外圈贴着边缘的程度：越高顶点越多'),
      slider('concavity', 0, 100, 1, '凹度', '往凹进去的地方走多深：0 = 凸包，100 = 每个缝都跟进去'),
      slider('refine', 0, 100, 1, '精致度', '把边往外推、盖住被直边切掉的像素：100 = 不丢像素'),
      slider('threshold', 0, 255, 1, 'Alpha阈值', '透明度不超过这个值的像素算空白'),
      slider('padding', 0, 30, 1, '填充', '外圈离图片边缘多少像素'),
      h('div', { class: 'mrow tcount' }, h('button', { class: 'mt', title: '按当前设置重新描一次', onclick: () => { computeTrace(); count.textContent = t.pts ? `顶点：${t.pts.length}` : t.err } }, '刷新'), count),
      h('div', { class: 'mrow' },
        h('button', { class: 'mt', onclick: () => closeTrace(false) }, '取消'),
        h('button', { class: 'mt primary', onclick: () => closeTrace(true) }, '确定')))
  }

  function finishDraft() {
    const me = state.meshEdit, ctx = meshEditContext()
    const pts = me.draft || []
    me.draft = null
    if (!ctx || pts.length < 3) { status('外圈至少要 3 个点'); renderMeshPanel(); return }
    try { commitMesh(ME().newHull(ctx.model, pts, CORE()), `已新建外圈（${pts.length} 个顶点）`, () => { me.sel = new Set() }) } catch (e) { status(e.message, 'error') }
  }

  function deleteMeshVertices() {
    const me = state.meshEdit, ctx = meshEditContext()
    if (!me || !ctx || !me.sel.size) return
    try { commitMesh(ME().removePoints(ctx.model, [...me.sel].filter((i) => i < ctx.model.points.length), CORE()), `已删除 ${me.sel.size} 个顶点`, () => { me.sel = new Set() }) } catch (e) { status(e.message, 'error') }
  }

  function meshVertexAt(ctx, sx, sy) {
    let best = -1, bd = 8
    ctx.model.points.forEach((p, i) => { const q = weScreen(ctx, p); const d = Math.hypot(q[0] - sx, q[1] - sy); if (d < bd) { bd = d; best = i } })
    return best
  }

  /** A left press while editing the mesh: returns a drag, or null when the press did its job. */
  function meshPointerDown(e, sx, sy) {
    const me = state.meshEdit, ctx = meshEditContext()
    if (!ctx || me.trace) return null
    const [wx, wy] = toWorld(sx, sy)
    const vi = meshVertexAt(ctx, sx, sy)
    if (me.draft) {
      // 新建: a click on the first point (three or more placed) closes the outline
      if (me.draft.length >= 3) {
        const f = toScreen(me.draft[0][0], me.draft[0][1])
        if (Math.hypot(f[0] - sx, f[1] - sy) < 9) { finishDraft(); return null }
      }
      me.draft.push([wx, wy])
      return null
    }
    if (me.tool === 'create') {
      // Spine: drag from a vertex to another = an edge (to empty space = a new vertex joined to it)
      if (vi >= 0) return { kind: 'meshEdge', from: vi, sx, sy }
      try {
        const m = ME().addPoint(ctx.model, wx, wy, CORE())
        const ni = m.points.findIndex((p) => p.src === -1)
        commitMesh(m, '已添加顶点', () => { me.sel = new Set([ni]) })
      } catch (err) { status(err.message, 'error') }
      return null
    }
    if (me.tool === 'delete') {
      if (vi < 0) {
        const ei = meshEdgeAt(ctx, sx, sy)
        if (ei >= 0) commitMesh(ME().removeEdge(ctx.model, ei, CORE()), '已删除边')
        return null
      }
      try { commitMesh(ME().removePoints(ctx.model, [vi], CORE()), '已删除顶点', () => { me.sel = new Set() }) } catch (err) { status(err.message, 'error') }
      return null
    }
    // 修改
    if (vi >= 0) {
      if (e.ctrlKey || e.metaKey) { me.sel.has(vi) ? me.sel.delete(vi) : me.sel.add(vi); renderMeshPanel(); return null }
      if (!me.sel.has(vi)) me.sel = new Set([vi])
      return { kind: 'meshMove', w0: [wx, wy], sx, sy, moved: false, dx: 0, dy: 0 }
    }
    state.box = { x0: sx, y0: sy, x1: sx, y1: sy, add: e.ctrlKey || e.metaKey, meshVerts: true }
    return { kind: 'box' }
  }

  /** The user edge (not the outline) under the pointer, or -1. */
  function meshEdgeAt(ctx, sx, sy) {
    const P = ctx.model.points
    let best = -1, bd = 6
    ;(ctx.model.edges || []).forEach(([a, b], k) => {
      const p = toScreen(P[a].x, P[a].y), q = toScreen(P[b].x, P[b].y)
      const dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy
      const t = l2 ? Math.max(0, Math.min(1, ((sx - p[0]) * dx + (sy - p[1]) * dy) / l2)) : 0
      const d = Math.hypot(sx - p[0] - t * dx, sy - p[1] - t * dy)
      if (d < bd) { bd = d; best = k }
    })
    return best
  }

  function finishMeshEdge(d) {
    const dr = state.meshEdgeDraft
    state.meshEdgeDraft = null
    const ctx = meshEditContext()
    if (!dr || !ctx) return
    const [sx, sy] = dr.p
    if (Math.hypot(sx - d.sx, sy - d.sy) < 5) return
    const vt = meshVertexAt(ctx, sx, sy)
    try {
      if (vt >= 0) {
        if (vt !== d.from) commitMesh(ME().addEdge(ctx.model, d.from, vt, CORE()), '已连一条边')
        return
      }
      const [wx, wy] = toWorld(sx, sy)
      const m1 = ME().addPoint(ctx.model, wx, wy, CORE())
      const ni = m1.points.findIndex((p) => p.src === -1)
      if (ni < m1.hull) { commitMesh(m1, '已添加顶点（在外圈上，没连边）'); return }
      commitMesh(ME().addEdge(m1, d.from, ni, CORE()), '已添加顶点并连边')
    } catch (e) { status(e.message, 'error') }
  }

  function applyMeshMove(drag, sx, sy) {
    const [wx, wy] = toWorld(sx, sy)
    drag.dx = wx - drag.w0[0]
    drag.dy = wy - drag.w0[1]
    state.meshDrag = { dx: drag.dx, dy: drag.dy }
  }

  function finishMeshMove(d) {
    const me = state.meshEdit, ctx = meshEditContext()
    state.meshDrag = null
    if (!ctx || (!d.dx && !d.dy)) return
    // Spine: in 编辑网格 a vertex slides over the image; the picture itself never bends
    const m = ME().movePoints(ctx.model, [...me.sel].filter((i) => i < ctx.model.points.length), d.dx, d.dy, false, CORE())
    commitMesh(m, `已移动 ${me.sel.size} 个顶点`)
  }

  /** The mesh over the picture: inner edges dashed, the outline solid, vertices (picked ones bigger). */
  function drawMeshEdit(g) {
    const me = state.meshEdit, ctx = meshEditContext()
    if (!ctx) return
    const md = state.meshDrag
    const pts = ctx.model.points.map((p, i) => toScreen(p.x + (md && me.sel.has(i) ? md.dx : 0), p.y + (md && me.sel.has(i) ? md.dy : 0)))
    const H = ctx.model.hull, T = ctx.model.tris
    g.save()
    if (me.trace) g.globalAlpha = 0.3
    g.setLineDash([4, 3]); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.6)'
    g.beginPath()
    const seen = new Set()
    for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = T[t + e], b = T[t + (e + 1) % 3]
      const k = a < b ? a + ':' + b : b + ':' + a
      if (seen.has(k)) continue
      seen.add(k)
      if (a < H && b < H && (Math.abs(a - b) === 1 || Math.abs(a - b) === H - 1)) continue
      g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1])
    }
    g.stroke()
    g.setLineDash([])
    g.strokeStyle = '#ff9a3c'; g.lineWidth = 1.8
    g.beginPath()
    for (const [a, b] of ctx.model.edges || []) { g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]) }
    g.stroke()
    const ed = state.meshEdgeDraft
    if (ed && pts[ed.from]) {
      g.setLineDash([5, 4]); g.beginPath(); g.moveTo(pts[ed.from][0], pts[ed.from][1]); g.lineTo(ed.p[0], ed.p[1]); g.stroke(); g.setLineDash([])
    }
    g.strokeStyle = '#2fd5e8'; g.lineWidth = 1.5
    g.beginPath()
    for (let i = 0; i < H; i++) { if (i) g.lineTo(pts[i][0], pts[i][1]); else g.moveTo(pts[i][0], pts[i][1]) }
    g.closePath(); g.stroke()
    pts.forEach((q, i) => {
      const on = me.sel.has(i)
      g.beginPath(); g.arc(q[0], q[1], on ? 4.5 : 3, 0, Math.PI * 2)
      g.fillStyle = on ? '#ffe066' : '#2fd5e8'; g.fill()
      if (on) { g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke() }
    })
    if (me.draft) {
      g.strokeStyle = '#ffb454'; g.fillStyle = '#ffb454'; g.lineWidth = 1.5
      g.beginPath()
      me.draft.forEach(([x, y], i) => { const q = toScreen(x, y); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]) })
      if (state.meshPointer && me.draft.length) g.lineTo(state.meshPointer[0], state.meshPointer[1])
      g.stroke()
      me.draft.forEach(([x, y], i) => { const q = toScreen(x, y); g.beginPath(); g.arc(q[0], q[1], i ? 3 : 4.5, 0, Math.PI * 2); g.fill() })
    }
    g.globalAlpha = 1
    if (me.trace && me.trace.pts) {
      // the outline 确定 would give, placed through the current mesh
      const q = me.trace.pts.map(([u, v]) => { const s0 = ME().sampleAt(ctx.model, u, v, 'uv'); return toScreen(s0.x, s0.y) })
      g.strokeStyle = '#ffb454'; g.fillStyle = '#ffb454'; g.lineWidth = 1.5
      g.beginPath()
      q.forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y) })
      g.closePath(); g.stroke()
      for (const [x, y] of q) { g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill() }
    }
    g.restore()
  }

  /** Spine's 编辑网格 panel, bottom centre of the stage, the image's name above it. */
  function renderMeshPanel() {
    const p = $('#meshPanel')
    const me = state.meshEdit
    const ctx = me && meshEditContext()
    p.hidden = !ctx
    p.textContent = ''
    if (!ctx) return
    const tool = (id, label, title) => h('button', { class: 'mt', 'aria-pressed': String(me.tool === id && !me.draft), title, onclick: () => { me.tool = id; me.draft = null; renderMeshPanel() } }, label)
    const act = (id, label, title) => h('button', { class: 'mt', 'aria-pressed': String((id === 'new' && !!me.draft) || (id === 'trace' && !!me.trace)), title, onclick: () => meshAction(id) }, label)
    const tg = (key, label, title) => h('label', { class: 'mc', title }, h('input', { type: 'checkbox', checked: !!me[key], onchange: (e) => { me[key] = e.target.checked } }), label)
    p.append(
      h('div', { class: 'mname' }, me.name),
      h('div', { class: 'mhd' }, h('b', {}, '编辑网格'), h('button', { class: 'xx', title: '完成（Enter / Esc）', onclick: exitMeshEdit }, '×')),
      h('div', { class: 'mrow' },
        tool('modify', '修改', '拖顶点；空白处拖 = 框选，Ctrl 加选，Delete 删除选中的'),
        tool('create', '创建', '点空白处加顶点（点在外圈外 = 外圈多一个点）；从一个顶点拖到另一个顶点 = 连一条边（橙色），拖到空白处 = 新顶点并连上'),
        tool('delete', '删除', '点顶点删顶点；点橙色的边删边')),
      h('div', { class: 'mrow' },
        act('new', '新建', '清空，重新点出外圈'),
        act('reset', '重置', '回到图片的矩形'),
        act('generate', '生成', '在外圈里均匀加内部顶点；再点一次更密'),
        act('trace', '描绘', '按图片不透明的边缘描外圈（可调细节 / 凹度 / 精致度 / Alpha 阈值 / 填充）')),
      h('div', { class: 'mrow mopts' },
        tg('isolate', '隔离', '只显示这张图'),
        h('span', { class: 'mcount' }, `顶点：${ctx.model.points.length}${(ctx.model.edges || []).length ? `　边：${ctx.model.edges.length}` : ''}`)))
    layoutFloats()
  }

  // ------------------------------------------------------------------ 选择图层 (the production 自动蒙皮 picker)
  //
  // With 图层 · 选择 on, the image under the pointer is the topmost one whose own pixel there
  // is opaque (alpha > 16); it shows as a green silhouette with its name and a click picks it.

  const pagePixels = new Map() // atlas page image -> { data, w, h, tint }

  function pageOf(att) {
    const r = att.region
    const img = r && r.texture && r.texture.getImage ? r.texture.getImage() : null
    if (!img || !img.width) return null
    let pg = pagePixels.get(img)
    if (!pg) {
      const w = img.width, hh = img.height
      const c = document.createElement('canvas')
      c.width = w; c.height = hh
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0)
      let data = null
      try { data = g.getImageData(0, 0, w, hh).data } catch {}
      const t = document.createElement('canvas')
      t.width = w; t.height = hh
      const tg = t.getContext('2d')
      tg.drawImage(img, 0, 0)
      tg.globalCompositeOperation = 'source-in'
      tg.fillStyle = '#22c98a'
      tg.fillRect(0, 0, w, hh)
      pg = { data, w, h: hh, tint: t }
      pagePixels.set(img, pg)
    }
    return pg
  }

  /** The image's own alpha at a world point inside triangle `t` (page pixels via the UVs). */
  function alphaAt(w, t, wx, wy) {
    const pg = pageOf(w.att)
    if (!pg || !pg.data || !w.att.uvs) return 255
    const uv = w.att.uvs, v = w.v
    const a = w.tris[t], b = w.tris[t + 1], c = w.tris[t + 2]
    const ax = v[a * 2], ay = v[a * 2 + 1], bx = v[b * 2], by = v[b * 2 + 1], cx = v[c * 2], cy = v[c * 2 + 1]
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (!den) return 0
    const l1 = ((by - cy) * (wx - cx) + (cx - bx) * (wy - cy)) / den
    const l2 = ((cy - ay) * (wx - cx) + (ax - cx) * (wy - cy)) / den
    const l3 = 1 - l1 - l2
    const u = uv[a * 2] * l1 + uv[b * 2] * l2 + uv[c * 2] * l3
    const vv = uv[a * 2 + 1] * l1 + uv[b * 2 + 1] * l2 + uv[c * 2 + 1] * l3
    const px = Math.min(pg.w - 1, Math.max(0, Math.floor(u * pg.w)))
    const py = Math.min(pg.h - 1, Math.max(0, Math.floor(vv * pg.h)))
    return pg.data[(py * pg.w + px) * 4 + 3]
  }

  /** Affine that maps page pixels q[0..2] onto screen points s[0..2]. */
  function triAffine(q, sp) {
    const [u0, v0] = q[0], [u1, v1] = q[1], [u2, v2] = q[2]
    const [x0, y0] = sp[0], [x1, y1] = sp[1], [x2, y2] = sp[2]
    const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    if (Math.abs(den) < 1e-9) return null
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den
    const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den
    const d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den
    return [a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0]
  }

  /** The hovered layer: its own pixels tinted green, its name at its top left (as in production). */
  function drawLayerHover(ctx) {
    const slot = state.hoverImg && rt.skeleton.findSlot(state.hoverImg)
    const w = slot && attachmentWorld(slot)
    if (!w) return
    const pg = pageOf(w.att)
    const uv = w.att.uvs
    ctx.save()
    for (let t = 0; t + 2 < w.tris.length; t += 3) {
      const ids = [w.tris[t], w.tris[t + 1], w.tris[t + 2]]
      const sp = ids.map((i) => toScreen(w.v[i * 2], w.v[i * 2 + 1]))
      ctx.save()
      ctx.beginPath(); ctx.moveTo(sp[0][0], sp[0][1]); ctx.lineTo(sp[1][0], sp[1][1]); ctx.lineTo(sp[2][0], sp[2][1]); ctx.closePath()
      const m = pg && uv ? triAffine(ids.map((i) => [uv[i * 2] * pg.w, uv[i * 2 + 1] * pg.h]), sp) : null
      if (m) {
        ctx.clip()
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
        ctx.globalAlpha = 0.45
        ctx.drawImage(pg.tint, 0, 0)
      } else { ctx.fillStyle = 'rgba(34,201,138,0.18)'; ctx.fill() }
      ctx.restore()
    }
    let x0 = Infinity, y0 = Infinity
    for (let i = 0; i < w.v.length / 2; i++) { const q = toScreen(w.v[i * 2], w.v[i * 2 + 1]); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]) }
    const label = w.att.name
    ctx.font = '600 13px Inter, "Microsoft YaHei", sans-serif'
    const tw = ctx.measureText(label).width
    const lx = Math.min(Math.max(x0, 6), rt.w - tw - 14), ly = Math.max(y0 - 8, 18)
    ctx.fillStyle = 'rgba(8,20,16,0.85)'; ctx.fillRect(lx - 5, ly - 14, tw + 10, 20)
    ctx.fillStyle = '#22c98a'; ctx.fillText(label, lx, ly)
    ctx.restore()
  }

  function inTri(px, py, v, a, b, c) {
    const ax = v[a * 2], ay = v[a * 2 + 1], bx = v[b * 2], by = v[b * 2 + 1], cx = v[c * 2], cy = v[c * 2 + 1]
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))
  }

  /** The topmost image under the cursor (Spine lets you click images, not only bones). */
  function hitImage(sx, sy) {
    if (!rt.skeleton) return null
    const [wx, wy] = toWorld(sx, sy)
    const order = rt.skeleton.drawOrder
    for (let i = order.length - 1; i >= 0; i--) {
      const slot = order[i]
      if (state.hiddenSlots.has(slot.data.name) || slot.color.a < 0.02) continue
      const w = attachmentWorld(slot)
      if (!w) continue
      for (let t = 0; t + 2 < w.tris.length; t += 3) {
        // only the image's opaque pixels count, like the production 选择图层
        if (inTri(wx, wy, w.v, w.tris[t], w.tris[t + 1], w.tris[t + 2]) && alphaAt(w, t, wx, wy) > 16) {
          const key = attachmentKey(slot.data.name, w.att)
          if (key) return { slot: slot.data.name, ...key, region: w.att instanceof spine.RegionAttachment }
        }
      }
    }
    return null
  }

  /** Which skin + key holds a runtime attachment. */
  function attachmentKey(slotName, att) {
    const idx = rt.data.findSlotIndex(slotName)
    for (const skin of [rt.skeleton.skin, rt.data.defaultSkin]) {
      if (!skin) continue
      for (const e of skin.getAttachments()) if (e.slotIndex === idx && e.attachment === att) return { skin: skin.name, name: e.name }
    }
    return null
  }

  const ROLE_COLOR = { normal: '#4fb3e8', cons: '#a78bfa', ctrl: '#f0a63a' }

  /**
   * The tree's bone icon, drawn like the bone on the canvas: a blade with its origin dot,
   * a ring for a zero-length bone, an outer ring on a control bone; the canvas colour too
   * (the bone's own colour, else its role), green when picked.
   */
  function boneIcon(b, role, picked) {
    const col = picked ? '#1EA672' : b.color ? '#' + String(b.color).slice(0, 6) : ROLE_COLOR[role]
    const body = num0(b.length) >= 1
      ? '<path d="M3 13 3.8 9.1 13.5 2.5 6.9 12.2Z" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="3.4" cy="12.6" r="1.7" fill="currentColor"/>'
      : '<circle cx="8" cy="8" r="3.6" fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1.3"/>'
    const ring = role === 'ctrl' ? '<circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.2"/>' : ''
    return h('span', { class: 'ico bico', style: `color:${col}`, html: `<svg viewBox="0 0 16 16">${body}${ring}</svg>` })
  }
  const num0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

  function drawOverlay() {
    const c = $('#overlay')
    const ctx = c.getContext('2d')
    ctx.setTransform(rt.dpr, 0, 0, rt.dpr, 0, 0)
    ctx.clearRect(0, 0, rt.w, rt.h)
    if (!rt.skeleton) return
    // Spine's axes: a thin cross through the world origin (0, 0)
    const [ox, oy] = toScreen(0, 0)
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, Math.round(oy) + .5); ctx.lineTo(rt.w, Math.round(oy) + .5); ctx.moveTo(Math.round(ox) + .5, 0); ctx.lineTo(Math.round(ox) + .5, rt.h); ctx.stroke()
    const picked = new Set(selectedBones())
    const sel = state.sel
    if (state.opt.imgSel && state.hoverImg && !state.meshEdit) drawLayerHover(ctx)
    if (state.meshEdit) drawMeshEdit(ctx)
    if (state.weightEdit) drawWeightEdit(ctx)
    drawClips(ctx)
    // the picked image's outline (the mesh editors draw their own)
    if (sel && sel.kind === 'att' && !state.meshEdit && !state.weightEdit) {
      const slot = rt.skeleton.findSlot(sel.slot)
      const w = slot && attachmentWorld(slot)
      if (w) {
        ctx.strokeStyle = '#1EA672'; ctx.lineWidth = 1.5
        ctx.beginPath()
        for (let i = 0; i < w.hull; i++) {
          const p = toScreen(w.v[i * 2], w.v[i * 2 + 1])
          if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1])
        }
        ctx.closePath(); ctx.stroke()
      }
    }
    if (state.opt.imgName) {
      ctx.font = '11px Inter, "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      for (const slot of rt.skeleton.drawOrder) {
        if (state.hiddenSlots.has(slot.data.name) || slot.color.a < 0.02) continue
        const w = attachmentWorld(slot)
        if (!w) continue
        let x = 0, y = 0
        const n = w.v.length / 2
        for (let i = 0; i < n; i++) { x += w.v[i * 2] / n; y += w.v[i * 2 + 1] / n }
        const p = toScreen(x, y)
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(w.att.name, p[0] + 1, p[1] + 1)
        ctx.fillStyle = 'rgba(230,230,230,.9)'; ctx.fillText(w.att.name, p[0], p[1])
      }
      ctx.textAlign = 'start'
    }
    const cons = sel && (sel.kind === 'ik' || sel.kind === 'transform') ? (state.json[sel.kind] || []).find((x) => x.name === sel.name) : null
    if (cons) {
      const t = rt.skeleton.findBone(cons.target)
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#f0c36a'
      ctx.lineWidth = 1.2
      for (const n of cons.bones) {
        const b = rt.skeleton.findBone(n)
        if (!b || !t) continue
        const end = sel.kind === 'ik' && n === cons.bones[cons.bones.length - 1]
          ? toScreen(b.worldX + b.data.length * b.a, b.worldY + b.data.length * b.c) : toScreen(b.worldX, b.worldY)
        const tt = toScreen(t.worldX, t.worldY)
        ctx.beginPath(); ctx.moveTo(end[0], end[1]); ctx.lineTo(tt[0], tt[1]); ctx.stroke()
      }
      ctx.restore()
    }
    const consBones = new Set(cons ? [...cons.bones, cons.target] : [])
    ctx.font = '11px Inter, "Microsoft YaHei", sans-serif'
    // 编辑网格: only the mesh is drawn over the picture
    for (const s of state.meshEdit || state.weightEdit ? [] : boneSegments()) {
      const on = picked.has(s.name)
      const hover = state.hover === s.name
      // Spine: hidden bones still show under the cursor and when picked
      if (!state.opt.boneVis && !on && !hover) continue
      const role = state.roles.get(s.name) || 'normal'
      const own = bone(s.name) && bone(s.name).color
      const base = consBones.has(s.name) ? '#f0c36a' : own ? '#' + own.slice(0, 6) : ROLE_COLOR[role]
      ctx.lineWidth = on ? 1.6 : 1.2
      ctx.strokeStyle = on ? '#1EA672' : base
      ctx.fillStyle = on ? 'rgba(30,166,114,.55)' : hover ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)'
      if (s.len < 8) {
        ctx.beginPath(); ctx.arc(s.o[0], s.o[1], 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      } else {
        const vx = (s.t[0] - s.o[0]) / s.len, vy = (s.t[1] - s.o[1]) / s.len
        const w = Math.min(6, Math.max(2.5, s.len * 0.08))
        const k = Math.min(s.len * 0.18, 12)
        const mx = s.o[0] + vx * k, my = s.o[1] + vy * k
        ctx.beginPath()
        ctx.moveTo(s.o[0], s.o[1])
        ctx.lineTo(mx - vy * w, my + vx * w)
        ctx.lineTo(s.t[0], s.t[1])
        ctx.lineTo(mx + vy * w, my - vx * w)
        ctx.closePath()
        ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(s.o[0], s.o[1], 2.4, 0, Math.PI * 2); ctx.fillStyle = on ? '#fff' : base; ctx.fill()
      }
      if (role === 'ctrl') {
        ctx.beginPath(); ctx.arc(s.o[0], s.o[1], 7.5, 0, Math.PI * 2)
        ctx.strokeStyle = on ? '#1EA672' : ROLE_COLOR.ctrl; ctx.lineWidth = 1.4; ctx.stroke()
      }
      if ((state.opt.boneName || state.alwaysName.has(s.name)) && !hover && !on) {
        ctx.fillStyle = 'rgba(220,220,220,.75)'
        ctx.fillText(s.name, s.o[0] + 6, s.o[1] - 6)
      }
    }
    // name tag of the hovered / picked bone
    // the picked bone's tag gives way to its X / Y handles (its name is in the transform panel)
    const tagFor = state.hover || (state.sel && state.sel.kind === 'bone' && !handles() ? state.sel.name : null)
    const tb = tagFor && rt.skeleton.findBone(tagFor)
    if (tb) {
      const p = toScreen(tb.worldX, tb.worldY)
      const w = ctx.measureText(tagFor).width + 10
      ctx.fillStyle = 'rgba(14,40,31,.92)'
      ctx.strokeStyle = '#1EA672'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.rect(p[0] + 8, p[1] - 22, w, 17); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#c8f5e2'
      ctx.fillText(tagFor, p[0] + 13, p[1] - 9.5)
    }
    for (const n of state.createAtts) {
      const slot = rt.skeleton.findSlot(n)
      const w = slot && attachmentWorld(slot)
      if (!w) continue
      ctx.strokeStyle = '#5fd3e6'; ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < w.hull; i++) { const p = toScreen(w.v[i * 2], w.v[i * 2 + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]) }
      ctx.closePath(); ctx.stroke()
    }
    // the picked image's pivot (bones show their origin; an image shows its centre in every tool)
    if (state.mode === 'setup' && state.sel && state.sel.kind === 'att' && !state.meshEdit && !state.weightEdit) {
      const c = attCentre(rt.skeleton.findSlot(state.sel.slot))
      if (c) {
        const q = toScreen(c[0], c[1])
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.fillStyle = 'rgba(30,166,114,.9)'
        ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        if (state.tool === 'rotate') { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(q[0], q[1], 46, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
      }
    }
    const hd = handles()
    if (hd) {
      for (const [axis, col] of [['x', '#e5534b'], ['y', '#1EA672']]) {
        const t = hd[axis]
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = state.handleHover === axis ? 3 : 2
        ctx.beginPath(); ctx.moveTo(hd.o[0], hd.o[1]); ctx.lineTo(t[0], t[1]); ctx.stroke()
        if (state.tool === 'move') {
          const ang = Math.atan2(t[1] - hd.o[1], t[0] - hd.o[0])
          ctx.beginPath(); ctx.moveTo(t[0] + Math.cos(ang) * 8, t[1] + Math.sin(ang) * 8)
          ctx.lineTo(t[0] + Math.cos(ang + 2.5) * 7, t[1] + Math.sin(ang + 2.5) * 7)
          ctx.lineTo(t[0] + Math.cos(ang - 2.5) * 7, t[1] + Math.sin(ang - 2.5) * 7); ctx.closePath(); ctx.fill()
        } else if (state.tool === 'scale') ctx.fillRect(t[0] - 4, t[1] - 4, 8, 8)
        else { ctx.beginPath(); ctx.arc(t[0], t[1], 4.5, 0, Math.PI * 2); ctx.fill() }
      }
    }
    if (state.mode === 'setup' && (state.jointEdit || state.shiftHeld) && (state.tool === 'move' || state.tool === 'pose')) {
      ctx.lineWidth = 1.5
      for (const b of rt.skeleton.bones) {
        if (!b.active || state.hiddenBones.has(b.data.name)) continue
        const ends = [[b.worldX, b.worldY]]
        if (b.data.length > 0) ends.push([b.worldX + b.data.length * b.a, b.worldY + b.data.length * b.c])
        for (const w of ends) {
          const q = toScreen(w[0], w[1])
          ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.strokeStyle = '#ffe066'; ctx.stroke()
        }
      }
    }
    const MT = meshTarget()
    if (MT) {
      const v = worldVerts(MT)
      const tris = MT.att.triangles || []
      ctx.strokeStyle = 'rgba(95,211,230,.45)'; ctx.lineWidth = 1
      ctx.beginPath()
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const a = toScreen(v[tris[t] * 2], v[tris[t] * 2 + 1]), b = toScreen(v[tris[t + 1] * 2], v[tris[t + 1] * 2 + 1]), c2 = toScreen(v[tris[t + 2] * 2], v[tris[t + 2] * 2 + 1])
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.closePath()
      }
      ctx.stroke()
      const picked = vSel()
      for (let i = 0; i < v.length / 2; i++) {
        const p = toScreen(v[i * 2], v[i * 2 + 1])
        const on = picked.has(i)
        ctx.beginPath(); ctx.arc(p[0], p[1], on ? 4 : 3, 0, Math.PI * 2)
        ctx.fillStyle = on ? '#1EA672' : '#e6e6e6'; ctx.fill()
        ctx.lineWidth = 1; ctx.strokeStyle = on ? '#0e3a2a' : 'rgba(0,0,0,.6)'; ctx.stroke()
      }
    }
    if (state.creating && state.creating.p1) {
      const a = toScreen(...state.creating.p0), b = toScreen(...state.creating.p1)
      ctx.strokeStyle = '#1EA672'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
      ctx.beginPath(); ctx.arc(a[0], a[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#1EA672'; ctx.fill()
    }
    if (state.box) {
      const b = state.box
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#9be4cd'; ctx.lineWidth = 1
      ctx.fillStyle = 'rgba(30,166,114,.08)'
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
      ctx.setLineDash([])
    }
  }

  function hostPlaybackTime(t, dur) {
    try {
      const f = window.parent !== window && window.parent.__NovaFlowMotionPlaybackTime
      const r = typeof f === 'function' ? f(t, dur) : null
      return Number.isFinite(r) ? r : null
    } catch { return null }
  }

  function loop(ts) {
    if (state.playing && rt.skeleton) {
      const dt = loop.last ? (ts - loop.last) / 1000 : 0
      const dur = duration()
      loop.acc = (loop.acc || 0) + dt * FPS
      const step = Math.floor(loop.acc)
      if (step) {
        loop.acc -= step
        const frames = Math.max(1, Math.round(dur * FPS))
        if (!state.loop && state.frame + step >= frames) { state.frame = frames; state.playing = false; loop.acc = 0 }
        else state.frame = (state.frame + step) % frames
        // 动画工具's 骨骼片段: the app clamps playback to the picked bone's span
        const span = hostPlaybackTime(state.frame / FPS, dur)
        if (span != null) state.frame = Math.round(span * FPS)
        syncTimeline()
      }
      // every display frame poses at the continuous time; the last frame of a one-shot holds
      state.playFrac = state.playing && !(!state.loop && state.frame >= Math.round(dur * FPS)) ? Math.min(0.999, loop.acc) : 0
      pose()
    }
    if (pv.open) pvDraw(loop.last ? Math.min(0.1, (ts - loop.last) / 1000) : 0)
    loop.last = ts
    draw()
    if (animOn()) { drawDope(); drawCurve() }
    requestAnimationFrame(loop)
  }

  // ------------------------------------------------------------------ viewport input (Spine habits)

  const normDeg = (v) => Math.round((((v % 360) + 540) % 360 - 180) * 100) / 100
  const matrixOf = (b) => (b ? { a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY } : null)
  const TOOL_PROPS = { move: ['x', 'y'], rotate: ['rotation'], scale: ['scaleX', 'scaleY'], shear: ['shearX', 'shearY'], pose: ['x', 'y', 'rotation'] }

  /** Unit axes (world space) of the picked item for the current Spine axes setting. */
  function axesOf(b) {
    const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l] }
    if (state.axes === 'world' || !b) return { x: [1, 0], y: [0, 1] }
    const m = state.axes === 'parent' ? b.parent : b
    if (!m) return { x: [1, 0], y: [0, 1] }
    return { x: norm(m.a, m.c), y: norm(m.b, m.d) }
  }

  /** X / Y handles of the translate, scale and shear tools (Spine): limit a drag to one axis. */
  function handles() {
    if (!rt.skeleton || !['move', 'scale', 'shear'].includes(state.tool)) return null
    const t = xformTarget()
    if (!t) return null
    let ox, oy, b
    if (t.kind === 'bone') {
      b = rt.skeleton.findBone(t.name)
      if (!b || state.hiddenBones.has(t.name)) return null
      ox = b.worldX; oy = b.worldY
    } else {
      const slot = rt.skeleton.findSlot(t.sel.slot)
      const a = slot && slot.getAttachment()
      b = slot && slot.bone
      if (a instanceof spine.RegionAttachment) {
        if (state.tool === 'shear') return null
        ox = b.a * a.x + b.b * a.y + b.worldX; oy = b.c * a.x + b.d * a.y + b.worldY
      } else if (a instanceof spine.MeshAttachment || a instanceof spine.ClippingAttachment) {
        const c = attCentre(slot)
        if (!c) return null
        ox = c[0]; oy = c[1]
      } else return null
    }
    const ax = axesOf(b)
    const o = toScreen(ox, oy)
    const L = 46
    return { o, ow: [ox, oy], ax, x: [o[0] + ax.x[0] * L, o[1] - ax.x[1] * L], y: [o[0] + ax.y[0] * L, o[1] - ax.y[1] * L] }
  }

  /** The picked vertices of this slot's mesh / clipping (a set of vertex indices), or null for the whole shape. */
  function pickedVerts(slotName) {
    const set = state.vsel && state.vsel.slot === slotName ? state.vsel.indices : null
    return set && set.size ? set : null
  }

  /** The picked image's centre in world space: a region's x / y on its bone, a mesh's vertices' centre
   * (with vertices picked, theirs: Spine puts the handles on the selection). */
  function attCentre(slot) {
    const a = slot && slot.getAttachment()
    if (!a) return null
    const b = slot.bone
    if (a instanceof spine.RegionAttachment) return [b.a * a.x + b.b * a.y + b.worldX, b.c * a.x + b.d * a.y + b.worldY]
    if (a instanceof spine.MeshAttachment || a instanceof spine.ClippingAttachment) {
      const n = a.worldVerticesLength
      if (!n) return null
      const v = new Float32Array(n)
      a.computeWorldVertices(slot, 0, n, v, 0, 2)
      const only = pickedVerts(slot.data.name)
      let x = 0, y = 0, c = 0
      for (let i = 0; i < n; i += 2) { if (only && !only.has(i / 2)) continue; x += v[i]; y += v[i + 1]; c++ }
      return c ? [x / c, y / c] : null
    }
    return null
  }

  function hitHandle(sx, sy) {
    const hd = handles()
    if (!hd) return null
    for (const axis of ['x', 'y']) {
      const t = hd[axis]
      const vx = t[0] - hd.o[0], vy = t[1] - hd.o[1]
      const len = Math.hypot(vx, vy)
      const u = ((sx - hd.o[0]) * vx + (sy - hd.o[1]) * vy) / (len * len)
      if (u < 0.3 || u > 1.25) continue
      if (Math.hypot(sx - (hd.o[0] + vx * u), sy - (hd.o[1] + vy * u)) <= 6) return { axis, hd }
    }
    return null
  }

  function setTool(id) {
    if (id === 'create' && state.mode !== 'setup') return
    if (id !== 'create') state.createAtts = []
    if (id !== state.tool) { state.lastTool = state.tool; state.tool = id }
    renderStage()
    $('#stage').dataset.tool = state.tool
  }

  /** Drag state for the picked bones: each keeps its own start, the pivot is the bone that was grabbed. */
  function boneDrag(primary, sx, sy, opts) {
    const names = state.multi.includes(primary) ? state.multi.slice() : [primary]
    const items = names.map((n) => {
      const b = rt.skeleton.findBone(n)
      return {
        name: n,
        start: { x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY, shearX: b.shearX, shearY: b.shearY },
        originW: [b.worldX, b.worldY],
        parentM: matrixOf(b.parent),
        flip: b.parent ? Math.sign(b.parent.a * b.parent.d - b.parent.b * b.parent.c) || 1 : 1,
      }
    })
    const p = rt.skeleton.findBone(primary)
    let tool = state.tool
    let chain = null
    if (tool === 'pose') {
      // Spine's pose tool: grab the origin to move, anywhere else to aim the bone at the cursor;
      // with a chain of bones picked, IK turns them together
      const o = toScreen(p.worldX, p.worldY)
      tool = Math.hypot(sx - o[0], sy - o[1]) < 9 ? 'move' : 'aim'
      if (tool === 'aim' && names.length > 1) chain = poseChain(names, primary)
      if (chain) tool = 'chain'
    }
    const drag = { kind: 'bones', tool, items, pivot: [p.worldX, p.worldY], sx, sy, moved: false, axis: opts && opts.axis, chain }
    // Spine compensation (setup mode): children / images keep their place while their bone moves
    if (state.mode === 'setup' && (state.comp.bones || state.comp.images)) {
      const moving = new Set(names)
      drag.kids = []
      drag.imgs = []
      for (const it of items) {
        const b = rt.skeleton.findBone(it.name)
        if (state.comp.bones) {
          for (const c of b.children) if (!moving.has(c.data.name)) drag.kids.push({ name: c.data.name, parent: it.name, world: matrixOf(c) })
        }
        if (state.comp.images) {
          for (const slot of rt.skeleton.slots) {
            if (slot.bone !== b) continue
            const a = slot.getAttachment()
            if (a instanceof spine.RegionAttachment) drag.imgs.push({ slot: slot.data.name, bone: it.name, att: a, start: { x: a.x, y: a.y, rotation: a.rotation, scaleX: a.scaleX, scaleY: a.scaleY }, from: matrixOf(b) })
            else if (a instanceof spine.MeshAttachment && !a.bones) drag.imgs.push({ slot: slot.data.name, bone: it.name, att: a, start: { vertices: Array.from(a.vertices) }, from: matrixOf(b) })
          }
        }
      }
    }
    return drag
  }

  /** The picked bones as a parent → child chain ending at the grabbed bone (pose tool IK), or null. */
  function poseChain(names, end) {
    const set = new Set(names)
    const chain = []
    let b = rt.skeleton.findBone(end)
    while (b && set.has(b.data.name)) { chain.unshift(b.data.name); b = b.parent }
    return chain.length > 1 ? chain : null
  }

  function applyBoneDrag(drag, sx, sy, shift) {
    const [wx, wy] = toWorld(sx, sy)
    const [w0x, w0y] = toWorld(drag.sx, drag.sy)
    const P = drag.pivot
    let delta = (Math.atan2(wy - P[1], wx - P[0]) - Math.atan2(w0y - P[1], w0x - P[0])) * DEG
    delta = ((delta + 540) % 360) - 180
    if (shift) delta = Math.round(delta / 15) * 15
    let f = Math.max(0.01, Math.hypot(wx - P[0], wy - P[1]) / (Math.hypot(w0x - P[0], w0y - P[1]) || 1))
    // an X / Y handle limits the drag to that axis
    const ax = drag.axis ? drag.axisDir : null
    let dx = wx - w0x, dy = wy - w0y
    if (ax) {
      const along = dx * ax[0] + dy * ax[1]
      dx = ax[0] * along; dy = ax[1] * along
      const p0 = (w0x - P[0]) * ax[0] + (w0y - P[1]) * ax[1]
      const p1 = (wx - P[0]) * ax[0] + (wy - P[1]) * ax[1]
      f = Math.abs(p0) > 1e-6 ? p1 / p0 : 1
    }
    if (drag.tool === 'chain') { applyChain(drag, wx, wy); return }
    for (const it of drag.items) {
      const t = { ...(state.temp.get(it.name) || {}) }
      if (drag.tool === 'move') {
        const nx = it.originW[0] + dx, ny = it.originW[1] + dy
        const p = it.parentM ? Ops.toLocal(it.parentM, nx, ny) : [nx, ny]
        t.x = p[0]; t.y = p[1]
      } else if (drag.tool === 'rotate') {
        t.rotation = it.start.rotation + delta * it.flip
      } else if (drag.tool === 'scale') {
        if (drag.axis !== 'y') t.scaleX = it.start.scaleX * f
        if (drag.axis !== 'x') t.scaleY = shift && !drag.axis ? it.start.scaleY : it.start.scaleY * f
      } else if (drag.tool === 'shear') {
        if (drag.axis === 'x') t.shearX = it.start.shearX + delta * it.flip
        else t.shearY = it.start.shearY + delta * it.flip
      } else if (drag.tool === 'aim') {
        const pa = it.parentM ? Math.atan2(it.parentM.c, it.parentM.a) : 0
        t.rotation = (Math.atan2(wy - it.originW[1], wx - it.originW[0]) - pa) * DEG * it.flip
        if (shift) t.rotation = Math.round(t.rotation / 15) * 15
      }
      state.temp.set(it.name, t)
    }
    pose()
    compensate(drag)
    syncXformValues()
  }

  /** Keep children / images where they were while their bone moves (Spine compensate). */
  function compensate(drag) {
    if (!drag.kids && !drag.imgs) return
    let changed = false
    for (const k of drag.kids || []) {
      const P = matrixOf(rt.skeleton.findBone(k.parent))
      state.temp.set(k.name, Ops.localFromWorld(k.world, P))
      changed = true
    }
    if (changed) pose()
    for (const im of drag.imgs || []) {
      const to = matrixOf(rt.skeleton.findBone(im.bone))
      if (im.att instanceof spine.RegionAttachment) {
        const o = { ...im.start }
        Ops.rebaseAttachment(o, im.from, to)
        Object.assign(im.att, { x: o.x, y: o.y, rotation: o.rotation, scaleX: o.scaleX == null ? im.start.scaleX : o.scaleX, scaleY: o.scaleY == null ? im.start.scaleY : o.scaleY })
        im.att.updateOffset()
      } else {
        const o = { type: 'mesh', uvs: new Array(im.start.vertices.length).fill(0), vertices: im.start.vertices.slice() }
        Ops.rebaseAttachment(o, im.from, to)
        im.att.vertices.set(o.vertices)
      }
      im.to = to
    }
  }

  /** Pose tool with a picked chain: CCD so the tip of the grabbed bone follows the cursor. */
  function applyChain(drag, wx, wy) {
    const names = drag.chain
    for (let iter = 0; iter < 12; iter++) {
      for (let i = names.length - 1; i >= 0; i--) {
        const end = rt.skeleton.findBone(names[names.length - 1])
        const tip = [end.worldX + end.data.length * end.a, end.worldY + end.data.length * end.c]
        const b = rt.skeleton.findBone(names[i])
        const a0 = Math.atan2(tip[1] - b.worldY, tip[0] - b.worldX)
        const a1 = Math.atan2(wy - b.worldY, wx - b.worldX)
        const flip = b.parent ? Math.sign(b.parent.a * b.parent.d - b.parent.b * b.parent.c) || 1 : 1
        const t = { ...(state.temp.get(names[i]) || {}) }
        t.rotation = (t.rotation == null ? b.rotation : t.rotation) + (((a1 - a0) * DEG + 540) % 360 - 180) * flip
        state.temp.set(names[i], t)
        pose()
      }
    }
    syncXformValues()
  }

  /** Release: setup mode writes the setup pose; animate mode leaves an unkeyed (orange) change, or keys it with 自动关键帧. */
  function finishBoneDrag(drag) {
    const props = drag.tool === 'aim' || drag.tool === 'chain' ? ['rotation'] : TOOL_PROPS[drag.tool]
    const label = { move: '移动', rotate: '旋转', scale: '缩放', shear: '斜切', aim: '旋转', chain: '摆动' }[drag.tool]
    const names = drag.chain || drag.items.map((it) => it.name)
    if (state.mode === 'setup') {
      const changes = names.map((n) => {
        const t = state.temp.get(n) || {}
        state.temp.delete(n)
        const p = {}
        for (const k of props) if (t[k] != null) p[k] = k === 'rotation' ? normDeg(t[k]) : t[k]
        return [n, p]
      })
      for (const k of drag.kids || []) {
        const t = state.temp.get(k.name) || {}
        state.temp.delete(k.name)
        changes.push([k.name, { ...t, rotation: normDeg(t.rotation || 0) }])
      }
      const imgs = (drag.imgs || []).filter((im) => im.to)
      edit(`已${label} ${names.length > 1 ? names.length + ' 根骨骼' : names[0]}${drag.kids && drag.kids.length ? '，子骨骼已补偿' : ''}${imgs.length ? '，图片已补偿' : ''}`, (j) => {
        let r = { json: j }
        for (const [n, p] of changes) r = Ops.setBoneProps(r.json, n, p)
        for (const im of imgs) r = Ops.compensateImages(r.json, [im.slot], im.from, im.to)
        return r
      })
    } else if (state.dope.adjust && !drag.chain && state.dope.keySel.some((k) => k.path[0] === 'bones')) {
      // Spine's 调整: the same change goes onto every picked key instead of keying this frame
      const deltas = {}
      for (const it of drag.items) {
        const t = state.temp.get(it.name) || {}
        state.temp.delete(it.name)
        const dlt = {}
        for (const k of ['rotation', 'x', 'y', 'scaleX', 'scaleY', 'shearX', 'shearY']) if (t[k] != null) dlt[k] = t[k] - it.start[k]
        deltas[it.name] = dlt
      }
      adjustPicked(deltas)
    } else if (state.autoKey) keyEdited()
    else refresh()
  }

  function adjustPicked(deltas) {
    const keys = state.dope.keySel.slice()
    edit((r) => (r.adjusted ? `调整：${r.adjusted} 个关键帧一起改了` : '调整：选中的关键帧里没有这一项（比如选的是旋转帧却拖了平移）'), (j) => Ops.adjustKeys(j, state.anim, keys, deltas))
  }

  /**
   * 改关节 (the 动画 section's Shift-drag): move the joint under the pointer - every bone end on
   * it follows, so the parent re-aims and stretches, children keep their place, the art stays.
   * Uses the production bone editor's moveJoint on the skeleton JSON.
   */
  function jointHit(sx, sy) {
    let best = null
    for (const b of rt.skeleton.bones) {
      if (!b.active || state.hiddenBones.has(b.data.name) || state.unselectable.has(b.data.name)) continue
      const ends = [[b.worldX, b.worldY]]
      if (b.data.length > 0) ends.push([b.worldX + b.data.length * b.a, b.worldY + b.data.length * b.c])
      for (const w of ends) {
        const p = toScreen(w[0], w[1])
        const d = Math.hypot(p[0] - sx, p[1] - sy)
        if (d <= 9 && (!best || d < best.d)) best = { d, w, bone: b.data.name }
      }
    }
    return best
  }

  function jointDrag(hit, sx, sy) {
    return { kind: 'joint', base: state.json, from: hit.w, w0: toWorld(sx, sy), sx, sy, moved: false, result: null, bone: hit.bone }
  }

  let jointFramePending = false
  function applyJointDrag(drag, sx, sy) {
    const BE = window.NovaFlowBonesEditor
    const [wx, wy] = toWorld(sx, sy)
    const to = [drag.from[0] + wx - drag.w0[0], drag.from[1] + wy - drag.w0[1]]
    const res = BE.moveJoint(drag.base, drag.from, to, { tol: 9 * rt.cam.zoom })
    drag.result = res.skeleton
    if (jointFramePending) return
    jointFramePending = true
    requestAnimationFrame(() => {
      jointFramePending = false
      if (!drag.result) return
      try { applyJson(drag.result) } catch {}
    })
  }

  function finishJointDrag(drag) {
    const final = drag.result
    if (!final) return
    // the preview already shows `final`; put the start back so undo returns to it
    applyJson(drag.base)
    edit(`已移动关节（${drag.bone}）`, () => ({ json: Ops.tidy(Ops.prepare(final)) }))
  }

  /**
   * The picked slot's image: translate / rotate / scale it relative to its bone (setup mode). A region
   * changes its x / y / rotation / scale; a mesh moves as a whole - every vertex (each bone entry of
   * a weighted one) takes the same world transform, so the picture keeps its shape (Spine).
   */
  function attDrag(sel, sx, sy) {
    const slot = rt.skeleton.findSlot(sel.slot)
    const att = slot && slot.getAttachment()
    // a clipping is a polygon of vertices: it moves / turns / scales / shears as a whole like a mesh
    const region = att instanceof spine.RegionAttachment, mesh = att instanceof spine.MeshAttachment || att instanceof spine.ClippingAttachment
    if (!region && !mesh) return null
    // 动画: a mesh moves / turns / scales / shears as a whole too, written as its shape key on this frame
    const animT = mesh && animOn() ? meshRowTarget(sel.slot, sel.name) : null
    if (state.mode !== 'setup' && !animT) return null
    const B = matrixOf(slot.bone)
    const tool = state.tool === 'pose' ? 'move' : state.tool
    if (!['move', 'rotate', 'scale', 'shear'].includes(tool)) return null
    // a region has no shear (Spine's region attachment: x / y / rotation / scale only); a mesh shears
    if (tool === 'shear' && region) { status('区域图片没有斜切属性（Spine）：转成网格后可以斜切'); return null }
    let centre
    if (region) centre = [B.a * att.x + B.b * att.y + B.worldX, B.c * att.x + B.d * att.y + B.worldY]
    else centre = attCentre(slot) || [B.worldX, B.worldY]
    return { kind: 'att', sel, att, mesh, B, tool, sx, sy, moved: false, centre,
      animT, base: animT ? currentOffsets(animT) : null, only: mesh ? pickedVerts(sel.slot) : null,
      start: region ? { x: att.x, y: att.y, rotation: att.rotation, scaleX: att.scaleX, scaleY: att.scaleY } : { vertices: Array.from(att.vertices) },
      flip: Math.sign(B.a * B.d - B.b * B.c) || 1 }
  }

  /** The world transform a mesh drag applies: { a, b, c, d, tx, ty } (world → world). */
  function meshDragTransform(drag, wx, wy, w0x, w0y, shift) {
    const { B, centre } = drag
    const M = (a, b, c, d, tx, ty) => ({ a, b, c, d, tx, ty })
    const mul = (P, Q) => M(P.a * Q.a + P.b * Q.c, P.a * Q.b + P.b * Q.d, P.c * Q.a + P.d * Q.c, P.c * Q.b + P.d * Q.d, P.a * Q.tx + P.b * Q.ty + P.tx, P.c * Q.tx + P.d * Q.ty + P.ty)
    const about = (T) => mul(M(1, 0, 0, 1, centre[0], centre[1]), mul(T, M(1, 0, 0, 1, -centre[0], -centre[1])))
    if (drag.tool === 'move') {
      let dx = wx - w0x, dy = wy - w0y
      if (drag.axisDir) { const al = dx * drag.axisDir[0] + dy * drag.axisDir[1]; dx = drag.axisDir[0] * al; dy = drag.axisDir[1] * al }
      return M(1, 0, 0, 1, dx, dy)
    }
    if (drag.tool === 'rotate') {
      let d = Math.atan2(wy - centre[1], wx - centre[0]) - Math.atan2(w0y - centre[1], w0x - centre[0])
      if (shift) d = Math.round(d * DEG / 15) * 15 / DEG
      const co = Math.cos(d), si = Math.sin(d)
      return about(M(co, -si, si, co, 0, 0))
    }
    if (drag.tool === 'shear') {
      // Spine's shear: the bone-local X axis turns by shearX, the Y axis by shearY; here from the
      // drag's screen travel (horizontal → X, vertical → Y; an axis handle keeps one)
      const sx1 = (wx - w0x) / rt.cam.zoom, sy1 = (wy - w0y) / rt.cam.zoom
      let tx = drag.axis === 'y' ? 0 : sx1 * 0.4 / DEG, ty = drag.axis === 'x' ? 0 : -sy1 * 0.4 / DEG
      if (shift) { tx = Math.round(tx * DEG / 15) * 15 / DEG; ty = Math.round(ty * DEG / 15) * 15 / DEG }
      const det = B.a * B.d - B.b * B.c || 1
      const Binv = M(B.d / det, -B.b / det, -B.c / det, B.a / det, 0, 0)
      const Sh = M(Math.cos(tx), -Math.sin(ty), Math.sin(tx), Math.cos(ty), 0, 0)
      return about(mul(M(B.a, B.b, B.c, B.d, 0, 0), mul(Sh, Binv)))
    }
    // scale: along the bone's axes (uniform without an axis), like a region's scaleX / scaleY
    let f = Math.max(0.01, Math.hypot(wx - centre[0], wy - centre[1]) / (Math.hypot(w0x - centre[0], w0y - centre[1]) || 1))
    if (drag.axisDir) {
      const p0 = (w0x - centre[0]) * drag.axisDir[0] + (w0y - centre[1]) * drag.axisDir[1]
      const p1 = (wx - centre[0]) * drag.axisDir[0] + (wy - centre[1]) * drag.axisDir[1]
      f = Math.abs(p0) > 1e-6 ? p1 / p0 : 1
    }
    const fx = drag.axis !== 'y' ? f : 1, fy = drag.axis !== 'x' ? (shift && !drag.axis ? 1 : f) : 1
    const det = B.a * B.d - B.b * B.c || 1
    const Binv = M(B.d / det, -B.b / det, -B.c / det, B.a / det, 0, 0)
    return about(mul(M(B.a, B.b, B.c, B.d, 0, 0), mul(M(fx, 0, 0, fy, 0, 0), Binv)))
  }

  /**
   * 动画: a mesh's deform offsets after the world transform `W` is applied to its posed shape
   * (setup vertices + `base` offsets), entry by entry through each entry's bone. A weighted vertex is
   * an affine mix of its entries, so moving every entry by W moves the vertex by W.
   */
  function meshOffsetsAfter(T, base, W, only) {
    const att = T.att, v = att.vertices, bones = rt.skeleton.bones, out = base.slice()
    const through = (bone, x, y) => {
      const wx = bone.a * x + bone.b * y + bone.worldX, wy = bone.c * x + bone.d * y + bone.worldY
      const tx = W.a * wx + W.b * wy + W.tx, ty = W.c * wx + W.d * wy + W.ty
      const det = bone.a * bone.d - bone.b * bone.c || 1, dx = tx - bone.worldX, dy = ty - bone.worldY
      return [(bone.d * dx - bone.b * dy) / det, (bone.a * dy - bone.c * dx) / det]
    }
    if (att.bones) {
      let e = 0
      for (let i = 0, vi = 0; i < att.bones.length; vi++) {
        const n = att.bones[i++]
        if (only && !only.has(vi)) { i += n; e += n; continue }
        for (let k = 0; k < n; k++, i++, e++) {
          const sx = v[e * 3], sy = v[e * 3 + 1]
          const [x, y] = through(bones[att.bones[i]], sx + base[e * 2], sy + base[e * 2 + 1])
          out[e * 2] = x - sx; out[e * 2 + 1] = y - sy
        }
      }
    } else {
      const bone = T.slot.bone
      for (let i = 0; i < v.length; i += 2) { if (only && !only.has(i / 2)) continue; const [x, y] = through(bone, v[i] + base[i], v[i + 1] + base[i + 1]); out[i] = x - v[i]; out[i + 1] = y - v[i + 1] }
    }
    return out
  }

  /**
   * A typed value of the transform panel for a picked mesh, as a world transform about its centre:
   * the values are changes to its current shape (the panel shows 0 / 1), moves along the panel's axes,
   * rotation in degrees, scale and shear along its bone's axes (as the stage handles do).
   */
  function meshPanelTransform(slot, k, v) {
    const c = attCentre(slot)
    if (!c || !Number.isFinite(v)) return null
    const B = matrixOf(slot.bone)
    const M = (a, b, cc, d, tx, ty) => ({ a, b, c: cc, d, tx, ty })
    const mul = (P, Q) => M(P.a * Q.a + P.b * Q.c, P.a * Q.b + P.b * Q.d, P.c * Q.a + P.d * Q.c, P.c * Q.b + P.d * Q.d, P.a * Q.tx + P.b * Q.ty + P.tx, P.c * Q.tx + P.d * Q.ty + P.ty)
    const about = (T) => mul(M(1, 0, 0, 1, c[0], c[1]), mul(T, M(1, 0, 0, 1, -c[0], -c[1])))
    const det = B.a * B.d - B.b * B.c || 1
    const inBone = (T) => about(mul(M(B.a, B.b, B.c, B.d, 0, 0), mul(T, M(B.d / det, -B.b / det, -B.c / det, B.a / det, 0, 0))))
    if (k === 'x' || k === 'y') { const ax = axesOf(slot.bone)[k]; return M(1, 0, 0, 1, ax[0] * v, ax[1] * v) }
    if (k === 'rotation') { const r = v / DEG, co = Math.cos(r), si = Math.sin(r); return about(M(co, -si, si, co, 0, 0)) }
    if (k === 'scaleX' || k === 'scaleY') { if (Math.abs(v) < 1e-4) return null; return inBone(k === 'scaleX' ? M(v, 0, 0, 1, 0, 0) : M(1, 0, 0, v, 0, 0)) }
    if (k === 'shearX' || k === 'shearY') { const r = v / DEG; return inBone(k === 'shearX' ? M(Math.cos(r), 0, Math.sin(r), 1, 0, 0) : M(1, -Math.sin(r), 0, Math.cos(r), 0, 0)) }
    return null
  }

  /** The mesh's vertices after `T`, from the drag's start copy: p' = Bone⁻¹ · T · Bone · p, bone by bone. */
  function applyMeshTransform(drag, T) {
    const att = drag.att, src = drag.start.vertices, out = att.vertices
    const bones = rt.skeleton.bones
    const through = (bone, x, y) => {
      const wx = bone.a * x + bone.b * y + bone.worldX, wy = bone.c * x + bone.d * y + bone.worldY
      const tx = T.a * wx + T.b * wy + T.tx, ty = T.c * wx + T.d * wy + T.ty
      const det = bone.a * bone.d - bone.b * bone.c || 1
      const dx = tx - bone.worldX, dy = ty - bone.worldY
      return [(bone.d * dx - bone.b * dy) / det, (bone.a * dy - bone.c * dx) / det]
    }
    if (att.bones) {
      // weighted: vertices = x, y, weight per bone entry; bones = count, index…
      let v = 0
      for (let i = 0, vi = 0; i < att.bones.length; vi++) {
        const n = att.bones[i++]
        const skip = drag.only && !drag.only.has(vi)
        for (let k = 0; k < n; k++, i++, v += 3) {
          if (skip) { out[v] = src[v]; out[v + 1] = src[v + 1]; continue }
          const [x, y] = through(bones[att.bones[i]], src[v], src[v + 1])
          out[v] = x; out[v + 1] = y
        }
      }
    } else {
      const bone = rt.skeleton.findSlot(drag.sel.slot).bone
      for (let v = 0; v < src.length; v += 2) {
        if (drag.only && !drag.only.has(v / 2)) { out[v] = src[v]; out[v + 1] = src[v + 1]; continue }
        const [x, y] = through(bone, src[v], src[v + 1]); out[v] = x; out[v + 1] = y
      }
    }
  }

  function applyAttDrag(drag, sx, sy, shift) {
    const [wx, wy] = toWorld(sx, sy)
    const [w0x, w0y] = toWorld(drag.sx, drag.sy)
    const { att, B, start, centre } = drag
    if (drag.animT) { drag.offsets = meshOffsetsAfter(drag.animT, drag.base, meshDragTransform(drag, wx, wy, w0x, w0y, shift), drag.only); applyOffsets(drag.animT, drag.offsets); return }
    if (drag.mesh) { applyMeshTransform(drag, meshDragTransform(drag, wx, wy, w0x, w0y, shift)); syncXformValues(); return }
    if (drag.tool === 'move') {
      const det = B.a * B.d - B.b * B.c || 1
      let dx = wx - w0x, dy = wy - w0y
      if (drag.axisDir) { const al = dx * drag.axisDir[0] + dy * drag.axisDir[1]; dx = drag.axisDir[0] * al; dy = drag.axisDir[1] * al }
      att.x = start.x + (B.d * dx - B.b * dy) / det
      att.y = start.y + (B.a * dy - B.c * dx) / det
    } else if (drag.tool === 'rotate') {
      let d = (Math.atan2(wy - centre[1], wx - centre[0]) - Math.atan2(w0y - centre[1], w0x - centre[0])) * DEG
      d = ((d + 540) % 360) - 180
      if (shift) d = Math.round(d / 15) * 15
      att.rotation = start.rotation + d * drag.flip
    } else if (drag.tool === 'scale') {
      let f = Math.max(0.01, Math.hypot(wx - centre[0], wy - centre[1]) / (Math.hypot(w0x - centre[0], w0y - centre[1]) || 1))
      if (drag.axisDir) {
        const p0 = (w0x - centre[0]) * drag.axisDir[0] + (w0y - centre[1]) * drag.axisDir[1]
        const p1 = (wx - centre[0]) * drag.axisDir[0] + (wy - centre[1]) * drag.axisDir[1]
        f = Math.abs(p0) > 1e-6 ? p1 / p0 : 1
      }
      if (drag.axis !== 'y') att.scaleX = start.scaleX * f
      if (drag.axis !== 'x') att.scaleY = shift && !drag.axis ? start.scaleY : start.scaleY * f
    }
    att.updateOffset()
    syncXformValues()
  }

  function finishAttDrag(drag) {
    const { att, sel } = drag
    const verb = { move: '移动', rotate: '旋转', scale: '缩放', shear: '斜切' }[drag.tool]
    if (drag.animT) {
      const T = drag.animT, off = drag.offsets
      if (!off || off.every((x, i) => Math.abs(x - drag.base[i]) < 1e-6)) { pose(); return }
      edit(`第 ${state.frame} 帧：已${verb}${shapeWord(att)} ${sel.name}（形状已打关键帧）`, (j) => Ops.keyDeform(j, state.anim, T.skin, T.slotName, T.attName, timeSec(), off))
      return
    }
    if (drag.mesh) {
      const moved = Array.from(att.vertices)
      // the preview changed the runtime mesh only; the JSON (and so undo) starts from the untouched one
      edit(`已${verb}${shapeWord(att)} ${sel.name}`, (j) => {
        const json = Ops.prepare(j)
        let skin = sel.skin, name = sel.name
        let map = (json.skins.find((x) => x.name === skin) || {}).attachments
        let a = map && map[sel.slot] && map[sel.slot][name]
        if (a && a.type === 'linkedmesh') { skin = a.skin || 'default'; name = a.parent; map = (json.skins.find((x) => x.name === skin) || {}).attachments; a = map && map[sel.slot] && map[sel.slot][name] }
        if (!a || (a.type !== 'mesh' && a.type !== 'clipping')) throw new Error('找不到网格')
        const r3 = (x) => Math.round(x * 1000) / 1000
        const v = a.vertices
        if (att.bones) {
          // JSON: count, (bone, x, y, weight)…; runtime: (x, y, weight)…
          let t = 0
          for (let i = 0; i < v.length;) { const n = v[i++]; for (let k = 0; k < n; k++, i += 4, t += 3) { v[i + 1] = r3(moved[t]); v[i + 2] = r3(moved[t + 1]) } }
        } else for (let i = 0; i < v.length; i++) v[i] = r3(moved[i])
        return { json: Ops.tidy(json) }
      })
      return
    }
    const props = drag.tool === 'move' ? { x: att.x, y: att.y } : drag.tool === 'rotate' ? { rotation: normDeg(att.rotation) } : { scaleX: att.scaleX, scaleY: att.scaleY }
    edit(`已${verb}图片 ${sel.name}`, (j) => Ops.setAttachmentProps(j, sel.skin, sel.slot, sel.name, props))
  }

  function bindViewport() {
    const c = $('#overlay')
    let drag = null
    const at = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    c.addEventListener('dblclick', (e) => {
      const [sx, sy] = at(e)
      if (!hitBone(sx, sy) && !hitImage(sx, sy)) select(null)
    })
    c.addEventListener('pointerdown', (e) => {
      if (!rt.skeleton) return
      const [sx, sy] = at(e)
      if (e.button === 2) {
        drag = { kind: 'pan', sx, sy, cx: rt.cam.x, cy: rt.cam.y, moved: false }
        c.setPointerCapture(e.pointerId)
        return
      }
      if (e.button === 1) {
        e.preventDefault()
        state.box = { x0: sx, y0: sy, x1: sx, y1: sy, add: e.ctrlKey || e.metaKey }
        drag = { kind: 'box' }
        c.setPointerCapture(e.pointerId)
        return
      }
      if (e.button !== 0) return
      if (state.meshEdit) {
        drag = meshPointerDown(e, sx, sy)
        if (drag) c.setPointerCapture(e.pointerId)
        return
      }
      if (state.clipEdit) {
        drag = clipPointerDown(e, sx, sy)
        if (drag) c.setPointerCapture(e.pointerId)
        return
      }
      if (state.weightEdit) {
        const we = state.weightEdit
        const ctx = weightContext()
        if (!ctx) return
        if (we.binding) {
          const bh = hitBone(sx, sy)
          if (bh) toggleBind(rt.skeleton.findBone(bh).data.index)
          return
        }
        if (we.direct) {
          const vi = weightVertexAt(ctx, sx, sy)
          if (vi >= 0) {
            if (e.ctrlKey || e.metaKey) { if (we.vsel.has(vi)) we.vsel.delete(vi); else we.vsel.add(vi); renderWeightPanel(); return }
            if (e.shiftKey) we.vsel.add(vi)
            else if (!we.vsel.has(vi)) we.vsel = new Set([vi])
            renderWeightPanel()
            drag = { kind: 'wdirect', sy, base: ctx.model, idxs: [...we.vsel], moved: false }
            c.setPointerCapture(e.pointerId)
            return
          }
        }
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+click a bound bone: paint with it
          const bh = hitBone(sx, sy)
          if (bh) {
            const bi = rt.skeleton.findBone(bh).data.index
            if (weightBones(ctx).includes(bi)) { we.bone = bi; renderWeightPanel() } else status(`「${bh}」没有绑定到这张网格：先点「绑定」把它加进来`)
            return
          }
        }
        if (we.direct) {
          state.wbox = { x0: sx, y0: sy, x1: sx, y1: sy, add: e.ctrlKey || e.metaKey || e.shiftKey }
          drag = { kind: 'wbox' }
          c.setPointerCapture(e.pointerId)
          return
        }
        state.weightStroke = { model: ctx.model, changed: false }
        weightDab(sx, sy)
        drag = { kind: 'weights', sx, sy, moved: true }
        c.setPointerCapture(e.pointerId)
        return
      }
      // an X / Y handle of the picked item: drag limited to that axis
      const hh = !state.pick && hitHandle(sx, sy)
      if (hh) {
        const t = xformTarget()
        drag = t.kind === 'bone' ? boneDrag(t.name, sx, sy, { axis: hh.axis }) : attDrag(state.sel, sx, sy)
        if (drag) {
          drag.axis = hh.axis
          drag.axisDir = hh.hd.ax[hh.axis]
          c.setPointerCapture(e.pointerId)
        }
        return
      }
      if (!state.pick && state.mode === 'setup' && (state.jointEdit || e.shiftKey) && (state.tool === 'move' || state.tool === 'pose') && window.NovaFlowBonesEditor) {
        const jh = jointHit(sx, sy)
        if (jh) {
          if (!(state.sel && state.sel.kind === 'bone' && state.sel.name === jh.bone)) select({ kind: 'bone', name: jh.bone }, false, { quiet: true })
          drag = jointDrag(jh, sx, sy)
          c.setPointerCapture(e.pointerId)
          return
        }
      }
      const pickSlot = !!(state.pick && state.pick.want === 'slot')
      const bh = state.opt.boneSel && !pickSlot ? hitBone(sx, sy) : null
      const oh = !bh && !pickSlot && state.opt.otherSel && state.opt.otherVis ? hitClip(sx, sy) : null
      const ih = !bh && !oh && (state.opt.imgSel || pickSlot) ? hitImage(sx, sy) : null
      if (state.pick) {
        if (bh && state.pick.want === 'bone') resolvePick('bone', bh)
        else if (ih && state.pick.want === 'slot') resolvePick('slot', ih.slot)
        return
      }
      // the project picked in the tree: a drag anywhere moves it on the stage (its view offset)
      if (state.sel && state.sel.kind === 'project' && !(e.ctrlKey || e.metaKey) && (state.tool === 'move' || state.tool === 'pose')) {
        drag = { kind: 'projectMove', sx, sy, ox: state.offset.x, oy: state.offset.y, moved: false }
        c.setPointerCapture(e.pointerId)
        return
      }
      const MT = meshTarget()
      if (MT && !(state.tool === 'create')) {
        const vi = hitVertex(MT, sx, sy)
        if (vi < 0 && (e.ctrlKey || e.metaKey)) {
          // Ctrl+drag always box-picks vertices, even over a bone (Spine's box select)
          state.box = { x0: sx, y0: sy, x1: sx, y1: sy, add: true, verts: MT.slotName }
          drag = { kind: 'box' }
          c.setPointerCapture(e.pointerId)
          return
        }
        if (vi >= 0) {
          const cur = vSel()
          if (state.vsel.slot !== MT.slotName) state.vsel = { slot: MT.slotName, indices: new Set() }
          if (e.ctrlKey || e.metaKey) { cur.has(vi) ? state.vsel.indices.delete(vi) : state.vsel.indices.add(vi); return }
          if (!cur.has(vi)) {
            // 设置: the whole-mesh drag is decided before the press picks the vertex (it moves the whole mesh)
            state.vsel.indices = new Set()
            const wholeFirst = state.mode === 'setup' ? attDrag(state.sel, sx, sy) : null
            state.vsel.indices = new Set([vi])
            // 设置: a dense mesh has a vertex under every press - the first drag moves the whole mesh
            // (the vertex gets picked); dragging a picked vertex moves that vertex (user: 图片要能拖动，包括网格)
            if (wholeFirst) { drag = wholeFirst; c.setPointerCapture(e.pointerId); return }
          }
          drag = vertexDrag(MT, sx, sy)
          c.setPointerCapture(e.pointerId)
          return
        }
        // a press on the picked mesh's own pixels (not on a vertex) moves / turns / scales the whole
        // mesh in 设置, as a region does (Spine; the vertices are edited by their handles or 编辑网格)
        if ((state.mode === 'setup' || animOn()) && !(e.ctrlKey || e.metaKey)) {
          const own = hitImage(sx, sy)
          // a clipping has no pixels: inside its polygon is its own area
          const inClip = MT.att instanceof spine.ClippingAttachment && (() => {
            const q = clipWorld(MT.slot, MT.att).map(([x, y]) => toScreen(x, y))
            let inside = false
            for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > sy) !== (q[j][1] > sy) && sx < (q[j][0] - q[i][0]) * (sy - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) inside = !inside
            return inside
          })()
          if (inClip || (own && own.slot === MT.slotName)) {
            const whole = attDrag(state.sel, sx, sy)
            if (whole) { drag = whole; c.setPointerCapture(e.pointerId); return }
          }
        }
        // another image under the pointer: that one is picked instead (the mesh's box select
        // only starts on empty space - with a mesh picked, clicks on other layers went nowhere)
        if (!bh && !(ih && ih.slot !== MT.slotName)) {
          // 设置: empty space drags the whole mesh too (rotate / scale about its centre, as a region does);
          // Ctrl+drag box-picks vertices
          if ((state.mode === 'setup' || animOn()) && !(e.ctrlKey || e.metaKey)) { const whole = attDrag(state.sel, sx, sy); if (whole) { drag = whole; c.setPointerCapture(e.pointerId); return } }
          // empty space: box-pick vertices (Ctrl adds); a click clears them
          state.box = { x0: sx, y0: sy, x1: sx, y1: sy, add: e.ctrlKey || e.metaKey, verts: MT.slotName }
          drag = { kind: 'box' }
          c.setPointerCapture(e.pointerId)
          return
        }
      }
      if (state.tool === 'create' && state.mode === 'setup') {
        if (e.ctrlKey || e.metaKey) {
          // Spine: Ctrl-click images first; the new bone takes their slots
          const img = hitImage(sx, sy)
          if (img) {
            const i = state.createAtts.indexOf(img.slot)
            if (i >= 0) state.createAtts.splice(i, 1)
            else state.createAtts.push(img.slot)
            status(state.createAtts.length ? `新骨骼会带上 ${state.createAtts.length} 个插槽：${state.createAtts.join('、')}` : '已清空')
          }
          return
        }
        // a press on a bone that is not picked picks it (the next bone's parent); on the picked bone or
        // elsewhere it draws: click = zero-length bone, drag = bone with length
        if (bh && !(state.sel && state.sel.kind === 'bone' && state.sel.name === bh && state.multi.length <= 1)) { select({ kind: 'bone', name: bh }); return }
        const parent = (state.sel && state.sel.kind === 'bone' && state.sel.name) || state.json.bones[0].name
        state.creating = { parent, p0: toWorld(sx, sy), p1: null, sx, sy, keepSel: e.shiftKey }
        c.setPointerCapture(e.pointerId)
        return
      }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click adds, Ctrl+drag box selects
        if (bh) { select({ kind: 'bone', name: bh }, true); return }
        state.box = { x0: sx, y0: sy, x1: sx, y1: sy, add: true }
        drag = { kind: 'box' }
        c.setPointerCapture(e.pointerId)
        return
      }
      // the picked image under the cursor drags, bones underneath or not (its handles are what Spine shows)
      const onPicked = state.sel && state.sel.kind === 'att' && state.mode === 'setup' ? (() => { const hit = hitImage(sx, sy); return !!(hit && hit.slot === state.sel.slot && hit.name === state.sel.name) })() : false
      if (onPicked && attDrag(state.sel, sx, sy)) {
        drag = attDrag(state.sel, sx, sy)
      } else if (bh) {
        if (!state.multi.includes(bh)) select({ kind: 'bone', name: bh }, false, { quiet: true })
        drag = boneDrag(bh, sx, sy)
      } else if (oh) {
        select({ kind: 'att', name: oh.name, slot: oh.slot, skin: oh.skin })
      } else if (ih) {
        const s = state.sel
        if (!(s && s.kind === 'att' && s.slot === ih.slot && s.name === ih.name)) select({ kind: 'att', name: ih.name, slot: ih.slot, skin: ih.skin }, false, { quiet: true })
        drag = attDrag(state.sel, sx, sy)
      } else if (state.tool === 'pose') {
        // Spine's pose tool: empty space = deselect on click, box select on drag
        state.box = { x0: sx, y0: sy, x1: sx, y1: sy, add: false, clickClears: true }
        drag = { kind: 'box' }
      } else if (state.multi.length) {
        // Spine: dragging in empty space adjusts what is picked
        drag = boneDrag(state.sel && state.sel.kind === 'bone' && state.multi.includes(state.sel.name) ? state.sel.name : state.multi[0], sx, sy)
      } else if (state.sel && state.sel.kind === 'att') {
        drag = attDrag(state.sel, sx, sy)
      } else {
        state.box = { x0: sx, y0: sy, x1: sx, y1: sy, add: false }
        drag = { kind: 'box' }
      }
      if (drag) c.setPointerCapture(e.pointerId)
    })
    c.addEventListener('pointerleave', () => { state.hoverImg = null })
    c.addEventListener('pointermove', (e) => {
      const [sx, sy] = at(e)
      if (state.creating) {
        if (Math.hypot(sx - state.creating.sx, sy - state.creating.sy) >= 4) state.creating.p1 = toWorld(sx, sy)
        return
      }
      if (state.meshEdit || state.weightEdit) state.meshPointer = [sx, sy]
      if (drag && drag.kind === 'wbox') { state.wbox.x1 = sx; state.wbox.y1 = sy; return }
      if (drag && drag.kind === 'meshEdge') { state.meshEdgeDraft = { from: drag.from, p: [sx, sy] }; return }
      if (drag && drag.kind === 'wdirect') {
        const we = state.weightEdit
        if (!drag.moved && Math.abs(sy - drag.sy) < 3) return
        if (we.bone == null) { status('先在列表里点一根骨骼'); return }
        drag.moved = true
        // up = more weight on the picked bone; 200 px = 100 %
        state.weightStroke = { model: ME().nudgeWeights(drag.base, drag.idxs, we.bone, (drag.sy - sy) / 200), changed: true }
        renderWeightPanel()
        return
      }
      if (drag && drag.kind === 'clipMove') { drag.moved = drag.moved || Math.hypot(sx - drag.sx, sy - drag.sy) > 2; state.clipDrag = { vi: drag.vi, p: toWorld(sx, sy) }; return }
      if (!drag && state.clipEdit) { state.meshPointer = [sx, sy]; return }
      if (!drag && state.weightEdit && state.weightEdit.binding) { const hov = rt.skeleton ? hitBone(sx, sy) : null; if (hov !== state.hover) state.hover = hov; return }
      if (!drag && (state.meshEdit || state.weightEdit)) return
      if (drag && drag.kind === 'weights') { weightDab(sx, sy); return }
      if (!drag) {
        const hov = rt.skeleton && state.opt.boneSel ? hitBone(sx, sy) : null
        if (hov !== state.hover) state.hover = hov
        const ih = !hov && rt.skeleton && state.opt.imgSel && !state.pick ? hitImage(sx, sy) : null
        state.hoverImg = ih ? ih.slot : null
        const hh = rt.skeleton ? hitHandle(sx, sy) : null
        state.handleHover = hh ? hh.axis : null
        return
      }
      if (drag.kind === 'pan') {
        if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moved = true
        rt.cam.x = drag.cx - (sx - drag.sx) * rt.cam.zoom
        rt.cam.y = drag.cy + (sy - drag.sy) * rt.cam.zoom
        return
      }
      if (drag.kind === 'box') { state.box.x1 = sx; state.box.y1 = sy; return }
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 3) return
      drag.moved = true
      if (drag.kind === 'bones') applyBoneDrag(drag, sx, sy, e.shiftKey)
      else if (drag.kind === 'att') applyAttDrag(drag, sx, sy, e.shiftKey)
      else if (drag.kind === 'projectMove') { setProjectOffset(drag.ox + (sx - drag.sx) * rt.cam.zoom, drag.oy - (sy - drag.sy) * rt.cam.zoom); if (state.sel && state.sel.kind === 'project') syncProjectFields() }
      else if (drag.kind === 'verts') applyVertexDrag(drag, sx, sy, e.shiftKey)
      else if (drag.kind === 'joint') applyJointDrag(drag, sx, sy)
      else if (drag.kind === 'meshMove') applyMeshMove(drag, sx, sy)
    })
    const up = () => {
      if (state.creating) {
        const cr = state.creating
        state.creating = null
        const P = matrixOf(rt.skeleton.findBone(cr.parent))
        const [x, y] = Ops.toLocal(P, cr.p0[0], cr.p0[1])
        const flip = Math.sign(P.a * P.d - P.b * P.c) || 1
        const rotation = cr.p1 ? normDeg((Math.atan2(cr.p1[1] - cr.p0[1], cr.p1[0] - cr.p0[0]) - Math.atan2(P.c, P.a)) * DEG * flip) : 0
        const length = cr.p1 ? Math.hypot(cr.p1[0] - cr.p0[0], cr.p1[1] - cr.p0[1]) / (Math.hypot(P.a, P.c) || 1) : 0
        const name = nextBoneName()
        const slots = state.createAtts.slice()
        state.createAtts = []
        edit(`已新建骨骼 ${name}（父骨骼 ${cr.parent}）${slots.length ? `，带上 ${slots.length} 个插槽` : ''}`, (j) => {
          let r = Ops.addBone(j, { name, parent: cr.parent, x, y, rotation, length })
          if (slots.length) {
            const m = setupMatrices()
            m[name] = Ops.worldFromLocal(m[cr.parent], { x, y, rotation })
            for (const sl of slots) r = Ops.setSlotProps(r.json, sl, { bone: name }, m)
          }
          return r
        }, () => { if (!cr.keepSel) { state.sel = { kind: 'bone', name }; state.multi = [name]; revealInTree(state.sel) } })
        return
      }
      if (!drag) return
      const d = drag
      drag = null
      if (d.kind === 'pan') {
        // Spine: a right click (no drag) switches back to the last tool
        if (!d.moved) setTool(state.lastTool)
        return
      }
      if (d.kind === 'box') {
        const b = state.box
        state.box = null
        const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1)
        if (b.meshVerts) {
          const me = state.meshEdit, ctx = meshEditContext()
          if (!me || !ctx) return
          if (x1 - x0 < 3 && y1 - y0 < 3) { if (!b.add) me.sel = new Set(); renderMeshPanel(); return }
          const inside = []
          ctx.model.points.forEach((p, i) => { const q = weScreen(ctx, p); if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) inside.push(i) })
          me.sel = new Set(b.add ? [...me.sel, ...inside] : inside)
          status(`已选 ${me.sel.size} 个顶点`)
          return
        }
        if (b.verts) {
          const T = meshTarget()
          if (state.vsel.slot !== b.verts) state.vsel = { slot: b.verts, indices: new Set() }
          if (!T || (x1 - x0 < 3 && y1 - y0 < 3)) { if (!b.add) state.vsel.indices = new Set(); return }
          const v = worldVerts(T)
          const inside = []
          for (let i = 0; i < v.length / 2; i++) { const p = toScreen(v[i * 2], v[i * 2 + 1]); if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) inside.push(i) }
          state.vsel.indices = new Set(b.add ? [...state.vsel.indices, ...inside] : inside)
          status(`已选 ${state.vsel.indices.size} 个顶点`)
          return
        }
        if (x1 - x0 < 3 && y1 - y0 < 3) { if (b.clickClears) select(null); return }
        const inside = boneSegments().filter((s) => s.o[0] >= x0 && s.o[0] <= x1 && s.o[1] >= y0 && s.o[1] <= y1).map((s) => s.name)
        const names = b.add ? [...new Set([...state.multi, ...inside])] : inside
        if (!names.length) { if (!b.add) select(null); return }
        state.multi = names
        state.sel = { kind: 'bone', name: names[names.length - 1] }
            refresh()
        status(`已框选 ${names.length} 根骨骼`)
        return
      }
      if (d.kind === 'meshEdge') { finishMeshEdge(d); return }
      if (d.kind === 'meshMove') { if (d.moved) finishMeshMove(d); else state.meshDrag = null; return }
      if (d.kind === 'wbox') { finishWeightBox(); return }
      if (d.kind === 'wdirect') {
        const st = state.weightStroke
        state.weightStroke = null
        if (d.moved && st) commitWeights(st.model, `已调整 ${d.idxs.length} 个顶点的「${rt.skeleton.bones[state.weightEdit.bone].data.name}」权重`)
        else renderWeightPanel()
        return
      }
      if (d.kind === 'clipMove') { finishClipMove(d); return }
      if (d.kind === 'weights') {
        const st = state.weightStroke
        state.weightStroke = null
        if (st && st.changed) commitWeights(st.model, `已刷「${rt.skeleton.bones[state.weightEdit.bone].data.name}」的权重`)
        return
      }
      if (!d.moved) { refresh(); return }
      if (d.kind === 'verts') { finishVertexDrag(d); return }
      if (d.kind === 'joint') { finishJointDrag(d); return }
      if (d.kind === 'bones') finishBoneDrag(d)
      else if (d.kind === 'att') finishAttDrag(d)
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('wheel', (e) => {
      if (!rt.skeleton) return
      e.preventDefault()
      const [sx, sy] = at(e)
      const before = toWorld(sx, sy)
      const f = Math.min(1.25, Math.max(0.8, Math.pow(1.0015, e.deltaY)))
      rt.cam.zoom = Math.min(50, Math.max(0.005, rt.cam.zoom * f))
      const after = toWorld(sx, sy)
      rt.cam.x += before[0] - after[0]
      rt.cam.y += before[1] - after[1]
    }, { passive: false })

    const stage = $('#stage')
    stage.addEventListener('dragover', (e) => { if (!state.drag || state.drag.type === 'image') e.preventDefault() })
    stage.addEventListener('drop', async (e) => {
      if (state.drag && state.drag.type === 'image') {
        // a picture from the 图片 node: a new slot on root, the picture centred where it was dropped
        const payload = state.drag
        state.drag = null
        e.preventDefault()
        const r = stage.getBoundingClientRect()
        placeImage(payload, { bone: state.json && state.json.bones.some((b) => b.name === 'root') ? 'root' : (state.json.bones[0] || {}).name, world: toWorld(e.clientX - r.left, e.clientY - r.top) })
        return
      }
      if (state.drag) return
      e.preventDefault()
      // in the section a project comes in through the app's 导入工程 (the left panel)
      if (EMBED) { status('在左侧「导入工程」里导入 Spine 工程'); return }
      const files = await filesFromDrop(e.dataTransfer)
      run(() => loadFiles(files))
    })
  }

  async function filesFromDrop(dt) {
    const out = []
    const walk = async (entry) => {
      if (!entry) return
      if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)))
      else if (entry.isDirectory) {
        const reader = entry.createReader()
        for (;;) {
          const batch = await new Promise((res) => reader.readEntries(res))
          if (!batch.length) break
          for (const x of batch) await walk(x)
        }
      }
    }
    const items = Array.from(dt.items || [])
    if (items.length && items[0].webkitGetAsEntry) for (const it of items) await walk(it.webkitGetAsEntry())
    else out.push(...Array.from(dt.files || []))
    return out
  }

  async function run(fn) {
    try { await fn() } catch (e) { status(e.message || String(e), 'error'); console.error(e) }
  }

  // ------------------------------------------------------------------ keys (Spine: green / orange / red)

  const KEY_ROWS = { rotate: ['rotation'], translate: ['x', 'y'], scale: ['scaleX', 'scaleY'], shear: ['shearX', 'shearY'] }
  const KEY_LABEL = { rotate: '旋转', translate: '平移', scale: '缩放', shear: '斜切' }

  function keyState(name, row) {
    if (!animOn()) return null
    const t = state.temp.get(name)
    if (t && KEY_ROWS[row].some((k) => t[k] != null)) return 'pending'
    const keys = Ops.boneKeys(state.json, state.anim, name)[row]
    return keys.some((x) => Math.abs(x - timeSec()) < 1e-3) ? 'keyed' : 'none'
  }

  /** Key one row (旋转 / 平移 / 缩放 / 斜切) of one or several bones at their current values. */
  function keyBoneRow(nameOrNames, row) {
    const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames]
    const vals = names.map((name) => {
      const b = rt.skeleton.findBone(name)
      const v = {}
      for (const k of KEY_ROWS[row]) v[k] = b[k]
      const t = state.temp.get(name)
      if (t) { for (const k of KEY_ROWS[row]) delete t[k]; if (!Object.keys(t).length) state.temp.delete(name) }
      return [name, v]
    })
    edit(`第 ${state.frame} 帧：${names.length > 1 ? names.length + ' 根骨骼' : names[0]} ${KEY_LABEL[row]}已打关键帧`,
      (j) => vals.reduce((r, [name, v]) => Ops.keyBone(r.json, state.anim, name, timeSec(), v), { json: j }))
  }

  /** K — key every changed property (Spine's Key Edited). */
  function keyEdited() {
    if (!animOn()) return
    if (!state.temp.size && state.sel && state.sel.kind === 'event') { keyEventNow(state.sel.name); return }
    if (!state.temp.size && meshTarget()) { keyDeformNow(); return }
    const jobs = []
    for (const [name, t] of state.temp) {
      const b = rt.skeleton.findBone(name)
      if (!b) continue
      const v = {}
      for (const props of Object.values(KEY_ROWS)) if (props.some((k) => t[k] != null)) for (const k of props) v[k] = b[k]
      if (Object.keys(v).length) jobs.push([name, v])
    }
    if (!jobs.length) {
      // nothing changed: K keys the picked bones' current pose on this frame
      for (const name of selectedBones()) {
        const b = rt.skeleton.findBone(name)
        if (b) jobs.push([name, { rotation: b.rotation, x: b.x, y: b.y, scaleX: b.scaleX, scaleY: b.scaleY }])
      }
      if (!jobs.length) { status('先选骨骼再按 K'); return }
    }
    state.temp.clear()
    edit(`第 ${state.frame} 帧：${jobs.length} 根骨骼已打关键帧`, (j) => {
      let r = { json: j }
      for (const [n, v] of jobs) r = Ops.keyBone(r.json, state.anim, n, timeSec(), v)
      return r
    })
  }

  // ------------------------------------------------------------------ mesh vertices (Spine: move mesh vertices)
  //
  // With a mesh image picked, its vertices show; click / Ctrl+click / box picks them,
  // 平移 / 旋转 / 缩放 drags them. In 设置姿势 that changes the mesh itself (the image
  // follows); in an animation every change is a deform key on the current frame.
  // A weighted vertex's move is split over the bones it is weighted to, so it lands exactly
  // where it was dragged (Spine does the same).

  function meshTarget() {
    if (!rt.skeleton || state.meshEdit || state.weightEdit || state.clipEdit) return null
    const s = state.sel
    if (!s || (s.kind !== 'att' && s.kind !== 'ph')) return null
    const slot = rt.skeleton.findSlot(s.slot)
    const att = slot && slot.getAttachment()
    if (!(att instanceof spine.MeshAttachment) && !(att instanceof spine.ClippingAttachment)) return null
    if (att instanceof spine.ClippingAttachment && s.name !== (attachmentKey(s.slot, att) || {}).name) return null
    const deformAtt = att.deformAttachment || att
    const key = attachmentKey(s.slot, deformAtt) || attachmentKey(s.slot, att)
    if (!key) return null
    return { slotName: s.slot, slot, att, skin: key.skin, attName: key.name }
  }

  const deformLength = (att) => (att.bones ? att.vertices.length / 3 * 2 : att.vertices.length)

  /** The mesh's current deform as Spine 3.8 key values (offsets from the setup mesh). */
  function currentOffsets(T) {
    const n = deformLength(T.att)
    const d = T.slot.deform
    if (!d || d.length !== n) return new Array(n).fill(0)
    return T.att.bones ? Array.from(d) : Array.from(d, (v, i) => v - T.att.vertices[i])
  }

  function worldVerts(T) {
    const n = T.att.worldVerticesLength
    const v = new Float32Array(n)
    T.att.computeWorldVertices(T.slot, 0, n, v, 0, 2)
    return v
  }

  /** For a weighted mesh: each vertex's influences [{ f, bone }] (f = index into the deform pairs). */
  function influences(att) {
    if (!att.bones) return null
    const out = []
    let f = 0
    for (let b = 0; b < att.bones.length;) {
      const n = att.bones[b++]
      const list = []
      for (let k = 0; k < n; k++) list.push({ f: f++, bone: att.bones[b + k] })
      b += n
      out.push(list)
    }
    return out
  }

  const vSel = () => (meshTarget() && state.vsel.slot === meshTarget().slotName ? state.vsel.indices : new Set())

  function hitVertex(T, sx, sy) {
    const v = worldVerts(T)
    let best = -1, bd = 7
    for (let i = 0; i < v.length / 2; i++) {
      const p = toScreen(v[i * 2], v[i * 2 + 1])
      const d = Math.hypot(p[0] - sx, p[1] - sy)
      if (d < bd) { bd = d; best = i }
    }
    return best
  }

  function applyOffsets(T, off) {
    const d = T.slot.deform
    d.length = off.length
    if (T.att.bones) for (let i = 0; i < off.length; i++) d[i] = off[i]
    else for (let i = 0; i < off.length; i++) d[i] = T.att.vertices[i] + off[i]
  }

  function vertexDrag(T, sx, sy) {
    const sel = [...vSel()]
    const v = worldVerts(T)
    const start = sel.map((i) => [v[i * 2], v[i * 2 + 1]])
    const c = start.reduce((a, p) => [a[0] + p[0] / start.length, a[1] + p[1] / start.length], [0, 0])
    // one vertex has nothing to turn or scale around: it moves whatever the tool
    const tool = sel.length > 1 && (state.tool === 'rotate' || state.tool === 'scale') ? state.tool : 'move'
    return { kind: 'verts', T, sel, start, centre: c, base: currentOffsets(T), infl: influences(T.att), sx, sy, tool, moved: false }
  }

  function applyVertexDrag(drag, sx, sy, shift) {
    const [wx, wy] = toWorld(sx, sy)
    const [w0x, w0y] = toWorld(drag.sx, drag.sy)
    const C = drag.centre
    let ang = Math.atan2(wy - C[1], wx - C[0]) - Math.atan2(w0y - C[1], w0x - C[0])
    if (shift) ang = Math.round(ang * DEG / 15) * 15 / DEG
    const f = Math.max(0.01, Math.hypot(wx - C[0], wy - C[1]) / (Math.hypot(w0x - C[0], w0y - C[1]) || 1))
    const off = drag.base.slice()
    const inv = (m, x, y) => { const det = m.a * m.d - m.b * m.c || 1; return [(m.d * x - m.b * y) / det, (m.a * y - m.c * x) / det] }
    drag.sel.forEach((i, n) => {
      const [px, py] = drag.start[n]
      let nx = px, ny = py
      if (drag.tool === 'move') { nx = px + wx - w0x; ny = py + wy - w0y }
      else if (drag.tool === 'rotate') {
        const cs = Math.cos(ang), sn = Math.sin(ang), dx = px - C[0], dy = py - C[1]
        nx = C[0] + dx * cs - dy * sn; ny = C[1] + dx * sn + dy * cs
      } else { nx = C[0] + (px - C[0]) * f; ny = C[1] + (py - C[1]) * f }
      const dx = nx - px, dy = ny - py
      if (drag.infl) {
        for (const { f: k, bone: bi } of drag.infl[i]) {
          const o = inv(rt.skeleton.bones[bi], dx, dy)
          off[k * 2] += o[0]; off[k * 2 + 1] += o[1]
        }
      } else {
        const o = inv(drag.T.slot.bone, dx, dy)
        off[i * 2] += o[0]; off[i * 2 + 1] += o[1]
      }
    })
    drag.offsets = off
    applyOffsets(drag.T, off)
  }

  const shapeWord = (att) => (att instanceof spine.ClippingAttachment || (att && att.type === 'clipping') ? '剪裁' : '网格')
  const deformKind = (path) => { const a = (((skinOf(path[1]) || {}).attachments || {})[path[2]] || {})[path[3]]; return a && a.type === 'clipping' ? '剪裁' : '网格' }

  function finishVertexDrag(drag) {
    if (!drag.offsets || drag.offsets.every((v, i) => Math.abs(v - drag.base[i]) < 1e-6)) { pose(); return }
    const T = drag.T, off = drag.offsets
    if (!animOn()) {
      // 设置姿势: the moved vertices become the mesh's (clipping's) own shape
      const own = attachmentKey(T.slotName, T.att) || { skin: T.skin, name: T.attName }
      edit(`已修改 ${T.slotName} 的${shapeWord(T.att)}形状（${drag.sel.length} 个顶点）`, (j) => Ops.moveMeshVertices(j, own.skin, T.slotName, own.name, off))
      return
    }
    edit(`第 ${state.frame} 帧：${T.slotName} ${shapeWord(T.att)}变形已打关键帧（${drag.sel.length} 个顶点）`, (j) => Ops.keyDeform(j, state.anim, T.skin, T.slotName, T.attName, timeSec(), off))
  }

  function keyDeformNow(target) {
    const T = target || meshTarget()
    if (!T) return false
    const off = deformAt(T)
    edit(`第 ${state.frame} 帧：${T.slotName} ${shapeWord(T.att)}已打关键帧`, (j) => Ops.keyDeform(j, state.anim, T.skin, T.slotName, T.attName, timeSec(), off))
    return true
  }

  /** The deform key target of a mesh in a slot by attachment name (the tree's mesh rows). */
  function meshRowTarget(slotName, attName) {
    const slot = rt.skeleton && rt.skeleton.findSlot(slotName)
    if (!slot) return null
    let att = null
    for (const skin of [rt.skeleton.skin, rt.data.defaultSkin]) if (skin && !att) att = skin.getAttachment(slot.data.index, attName)
    if (!(att instanceof spine.MeshAttachment) && !(att instanceof spine.ClippingAttachment)) return null
    const key = attachmentKey(slotName, att.deformAttachment || att) || attachmentKey(slotName, att)
    return key ? { slotName, slot, att, skin: key.skin, attName: key.name } : null
  }

  /** A mesh's deform on the current frame, also when its slot shows another image right now. */
  function deformAt(T) {
    if (T.slot.getAttachment() === T.att) return currentOffsets(T)
    const keep = T.slot.getAttachment()
    T.slot.setAttachment(T.att)
    const an = rt.data.findAnimation(state.anim)
    const tl = an && an.timelines.find((x) => x instanceof spine.DeformTimeline && x.slotIndex === T.slot.data.index && x.attachment === (T.att.deformAttachment || T.att))
    if (tl) tl.apply(rt.skeleton, timeSec() + 1e-4, timeSec() + 1e-4, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
    const off = currentOffsets(T)
    T.slot.setAttachment(keep)
    pose()
    return off
  }

  // ------------------------------------------------------------------ key buttons (Spine: key without changing anything)

  /** Red = a key on this frame on one of these tracks, green = none (Spine's key colours). */
  function keyedNow(paths) {
    const t = timeSec()
    return paths.some((p) => { const tr = state.dope.tracks.get(JSON.stringify(p)); return tr && tr.times.some((x) => Math.abs(x - t) < 1e-3) })
  }

  function keyBtn(paths, onKey, title) {
    if (!animOn()) return null
    const k = keyedNow(paths) ? 'keyed' : 'none'
    return h('button', { class: 'key', 'data-k': k, html: ICON.key, title: (title || '在当前帧打关键帧') + (k === 'keyed' ? '（这一帧已有关键帧）' : ''),
      onclick: (e) => { e.stopPropagation(); onKey() } })
  }

  /** The key button of a mesh row (tree) / mesh card: keys that mesh's current shape. */
  function meshKeyEnd(slotName, attName, cls) {
    const T = meshRowTarget(slotName, attName)
    if (!T) return null
    return h('span', { class: cls || 'end' }, keyBtn([['deform', T.skin, slotName, T.attName]], () => keyDeformNow(T), `给 ${attName} 的${shapeWord(T.att)}形状打关键帧`))
  }

  const BONE_TRACKS = (name) => ['rotate', 'translate', 'scale', 'shear'].map((k) => ['bones', name, k])
  const SLOT_TRACKS = (name) => [['slots', name, 'attachment'], ['slots', name, 'color']]

  /** Key a bone's current (posed) values; `rows` = which of rotate / translate / scale / shear. */
  function keyBoneNow(name, rows) {
    const b = rt.skeleton.findBone(name)
    if (!b) return
    const want = rows || ['rotate', 'translate', 'scale', ...(keyedTrack(['bones', name, 'shear']) ? ['shear'] : [])]
    const v = {}
    for (const r of want) for (const k of KEY_ROWS[r]) v[k] = b[k]
    const t = state.temp.get(name)
    if (t) { for (const r of want) for (const k of KEY_ROWS[r]) delete t[k]; if (!Object.keys(t).length) state.temp.delete(name) }
    edit(`第 ${state.frame} 帧：${name} ${want.map((r) => KEY_LABEL[r]).join(' / ')}已打关键帧`, (j) => Ops.keyBone(j, state.anim, name, timeSec(), v))
  }

  const keyedTrack = (path) => state.dope.tracks.has(JSON.stringify(path))

  function liveColorHex(slot) {
    const c = rt.skeleton.findSlot(slot).color
    return [c.r, c.g, c.b, c.a].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
  }

  function liveAttachmentName(slot) {
    const sl = rt.skeleton.findSlot(slot)
    const a = sl && sl.getAttachment()
    if (!a) return null
    const k = attachmentKey(slot, a)
    return k ? k.name : a.name
  }

  /** Key a slot's current attachment and / or colour. */
  function keySlotNow(name, what) {
    const parts = what || ['attachment', 'color']
    const att = liveAttachmentName(name)
    const col = liveColorHex(name)
    edit(`第 ${state.frame} 帧：${name} ${parts.map((x) => (x === 'color' ? '颜色' : '附件')).join(' / ')}已打关键帧`, (j) => {
      let r = { json: j }
      if (parts.includes('attachment')) r = Ops.keyAttachment(r.json, state.anim, name, timeSec(), att)
      if (parts.includes('color')) r = Ops.keyColor(r.json, state.anim, name, timeSec(), col)
      return r
    })
  }

  /** Key a constraint's current mixes (IK: mix + bend + softness; transform: the four mixes). */
  function keyConstraintNow(kind, name) {
    const live = kind === 'ik' ? rt.skeleton.findIkConstraint(name) : rt.skeleton.findTransformConstraint(name)
    if (!live) return
    const v = kind === 'ik'
      ? { mix: live.mix, softness: live.softness, bendPositive: live.bendDirection > 0, compress: live.compress, stretch: live.stretch }
      : { rotateMix: live.rotateMix, translateMix: live.translateMix, scaleMix: live.scaleMix, shearMix: live.shearMix }
    edit(`第 ${state.frame} 帧：${name} 已打关键帧`, (j) => Ops.keyConstraint(j, state.anim, kind, name, timeSec(), v))
  }

  /** Key everything an item has, from its tree row. */
  function keyItemNow(kind, name) {
    if (kind === 'bone') keyBoneNow(name)
    else if (kind === 'slot') keySlotNow(name)
    else keyConstraintNow(kind, name)
  }

  /** Key colours follow the frame: repaint the tree / properties once per frame change. */
  let keyPaintPending = false
  function scheduleKeyPaint() {
    if (keyPaintPending || !animOn()) return
    keyPaintPending = true
    requestAnimationFrame(() => { keyPaintPending = false; if (!state.playing) { renderTree(); renderProps() } })
  }

  // ------------------------------------------------------------------ tree (right, 工程)

  function revealInTree(sel) {
    if (!state.json) return
    if (sel.kind !== 'project' && projects[activeProject]) projects[activeProject].open = true
    const open = (name) => { let b = bone(name); while (b) { state.collapsed.delete('b:' + b.name); b = b.parent ? bone(b.parent) : null } }
    state.sections.delete('bones')
    if (sel.kind === 'bone') open(bone(sel.name) && bone(sel.name).parent)
    if (sel.kind === 'slot' || sel.kind === 'att' || sel.kind === 'ph') {
      const s = slotOf(sel.slot || sel.name)
      if (s) open(s.bone)
      if (sel.kind !== 'slot') state.collapsed.delete('s:' + sel.slot)
    }
    // a constraint / event: its section opens and the tree scrolls to its row
    if (sel.kind === 'ik' || sel.kind === 'transform' || sel.kind === 'path') state.sections.delete('cons')
    if (sel.kind === 'event') state.sections.delete('events')
    state.scrollToSel = true
  }

  function isSel(kind, name, extra) {
    const s = state.sel
    if (!s || s.kind !== kind || s.name !== name) return false
    if (kind === 'att') return s.slot === extra.slot && s.skin === extra.skin
    if (kind === 'ph') return s.slot === extra.slot
    return true
  }

  /**
   * What sits under a slot, the Spine way: plain images (default skin) and skin
   * placeholders; a placeholder's `current` is what the current skin draws there
   * (the default skin is the fallback, as in the runtime).
   */
  function slotContents(slot) {
    const atts = []
    const def = skinOf('default')
    for (const [k, att] of Object.entries((def && def.attachments[slot]) || {})) {
      if (!Ops.isPlaceholder(state.json, slot, k)) atts.push({ name: k, skin: 'default', type: (att && att.type) || 'region', image: (att && att.path) || k })
    }
    const phs = Ops.placeholderList(state.json, slot).map((ph) => {
      const skin = state.skin !== 'default' && ph.skins[state.skin] ? state.skin : ph.skins.default ? 'default' : null
      const att = skin ? ph.skins[skin] : null
      return { name: ph.name, skins: ph.skins, current: att ? { skin, type: att.type || 'region', image: att.path || att.name || ph.name } : null }
    })
    return { atts, phs }
  }

  const attIcon = (type) => (type === 'region' ? 'region' : type === 'mesh' || type === 'linkedmesh' ? 'mesh' : type === 'clipping' ? 'clip' : 'other')

  /** Drag & drop in the tree, Spine-style: onto a new parent node, or up/down in 绘制顺序 and 约束. */
  function dropRules(payload, target) {
    if (!payload || !target) return null
    if (payload.type === 'bone' && target.type === 'bone') {
      if (payload.name === target.name || Ops.branch(state.json, payload.name).includes(target.name)) return null
      if (bone(payload.name).parent === target.name || !bone(payload.name).parent) return null
      return { mode: 'in', run: () => reparent(payload.name, target.name) }
    }
    if (payload.type === 'slot' && target.type === 'bone') {
      if (slotOf(payload.name).bone === target.name) return null
      return { mode: 'in', run: () => setSlotBone(payload.name, target.name) }
    }
    if (payload.type === 'att' && target.type === 'slot' && target.name !== payload.slot) {
      return { mode: 'in', run: (e) => transferAtt(payload, !(e && (e.ctrlKey || e.altKey)), target.name) }
    }
    // a picture from the 图片 node: onto a bone = a new slot there, onto a slot = a new attachment in it (Spine)
    if (payload.type === 'image' && target.type === 'bone') return { mode: 'in', run: () => placeImage(payload, { bone: target.name }) }
    if (payload.type === 'image' && target.type === 'slot') return { mode: 'in', run: () => placeImage(payload, { slot: target.name }) }
    if (payload.type === 'order' && target.type === 'order' && target.name !== payload.name) {
      const block = state.multiSlots.includes(payload.name) ? state.multiSlots : [payload.name]
      if (block.includes(target.name)) return null
      return { mode: 'line', run: (e, below) => {
        const cur = drawOrderNow()
        const moving = cur.filter((n) => block.includes(n))
        const rest = cur.filter((n) => !block.includes(n))
        // the list shows the top slot first: "above" in the list = later in the array
        const at = rest.indexOf(target.name) + (below ? 0 : 1)
        const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
        const what = moving.length > 1 ? `${moving.length} 个插槽` : moving[0]
        if (animOn()) edit(`第 ${state.frame} 帧：${what} 的绘制顺序已打关键帧`, (j) => Ops.keyDrawOrder(j, state.anim, timeSec(), order))
        else edit(`已调整 ${what} 的绘制顺序`, (j) => Ops.reorderSlots(j, order))
      } }
    }
    if (payload.type === 'cons' && target.type === 'cons' && target.name !== payload.name) {
      return { mode: 'line', run: (e, below) => {
        const all = allConstraints()
        const from = all.findIndex((x) => x.c.name === payload.name && x.kind === payload.kind)
        let to = all.findIndex((x) => x.c.name === target.name && x.kind === target.kind) + (below ? 1 : 0)
        if (from < to) to -= 1
        edit(`已调整 ${payload.name} 的求解顺序`, (j) => Ops.setConstraintProps(j, payload.kind, payload.name, { order: to }))
      } }
    }
    return null
  }

  function wireDrag(row, payload, target) {
    // the draw order drags in an animation too (it keys the order on that frame)
    if (payload && (state.mode === 'setup' || payload.type === 'order')) {
      row.draggable = true
      row.addEventListener('dragstart', (e) => {
        state.drag = payload
        e.dataTransfer.effectAllowed = 'copyMove'
        e.dataTransfer.setData('text/plain', payload.name)
      })
      row.addEventListener('dragend', () => { state.drag = null; for (const r of document.querySelectorAll('.row[data-drop]')) r.removeAttribute('data-drop') })
    }
    if (target) {
      row.addEventListener('dragover', (e) => {
        const rule = dropRules(state.drag, target)
        if (!rule) return
        e.preventDefault()
        if (rule.mode === 'line') {
          const r = row.getBoundingClientRect()
          row.dataset.drop = e.clientY > r.top + r.height / 2 ? 'below' : 'above'
        } else row.dataset.drop = 'in'
      })
      row.addEventListener('dragleave', () => row.removeAttribute('data-drop'))
      row.addEventListener('drop', (e) => {
        const rule = dropRules(state.drag, target)
        const below = row.dataset.drop === 'below'
        row.removeAttribute('data-drop')
        state.drag = null
        if (!rule) return
        e.preventDefault()
        rule.run(e, below)
      })
    }
  }

  const CONS_KIND = { ik: 'IK', transform: '变换', path: '路径' }
  function consRowEnd(list) {
    if (!list.length) return null
    const go = (kind, name) => { state.sections.delete('cons'); select({ kind, name }, false, { noReveal: false }) }
    if (list.length <= 2) return h('span', { class: 'end' }, ...list.map(({ kind, c }) => h('button', { class: 'cjump', title: `${c.name}（${CONS_KIND[kind]}）`, html: ICON[kind], onclick: (e) => { e.stopPropagation(); go(kind, c.name) } })))
    return h('span', { class: 'end' }, h('button', { class: 'cjump many', title: `${list.length} 个约束`, onclick: (e) => {
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      mountMenu(h('div', { class: 'menu', id: 'menu', style: `left:${Math.round(Math.min(r.left, innerWidth - 170))}px;top:${Math.round(r.bottom + 4)}px` },
        list.map(({ kind, c }) => h('button', { onclick: () => { closeMenu(); go(kind, c.name) } }, h('span', { html: ICON[kind], style: 'display:inline-flex' }), c.name, h('span', { class: 'kb' }, CONS_KIND[kind])))))
    } }, h('span', { html: ICON[list[0].kind], style: 'display:inline-flex' }), h('span', { class: 'cnt' }, String(list.length))))
  }
  /** The constraints a bone takes part in: as one of their bones or as the target. */
  function consOf(name) { return allConstraints().filter(({ c }) => (c.bones || []).includes(name) || c.target === name) }
  function allConstraints() {
    const all = []
    for (const k of ['ik', 'transform', 'path']) for (const c of state.json[k] || []) all.push({ kind: k, c })
    all.sort((a, b) => (a.c.order || 0) - (b.c.order || 0))
    return all
  }

  const caret = (open, onToggle) => h('span', { class: 'caret', html: open == null ? '' : (open ? ICON.down : ICON.right),
    onclick: (e) => { e.stopPropagation(); if (onToggle) onToggle() } })

  /** Visibility dot on the left edge (Spine): click toggles, right click applies to everything below. */
  function visDot(on, toggle, toggleAll, offStyle) {
    return h('span', { class: 'vis', 'data-on': on ? '1' : null, 'data-off': !on && offStyle ? '1' : null, title: on ? '隐藏' : '显示',
      onclick: (e) => { e.stopPropagation(); toggle() },
      oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); (toggleAll || toggle)() } })
  }

  /** Text search like Spine's tree search: matches and their parents stay, the rest hides. */
  function searchMatches() {
    const q = state.search.trim().toLowerCase()
    if (!q || !state.json) return null
    const j = state.json
    const hit = (s) => String(s || '').toLowerCase().includes(q)
    const slots = new Set()
    const atts = new Set()
    for (const s of j.slots) {
      const c = slotContents(s.name)
      let any = hit(s.name)
      for (const a of c.atts) if (hit(a.name) || hit(a.image)) { atts.add(s.name + '/' + a.name); any = true }
      for (const p of c.phs) if (hit(p.name) || (p.current && hit(p.current.image))) { atts.add(s.name + '/' + p.name); any = true }
      if (any) slots.add(s.name)
    }
    const bones = new Set()
    const keep = (name) => { let b = bone(name); while (b && !bones.has(b.name)) { bones.add(b.name); b = b.parent ? bone(b.parent) : null } }
    const direct = new Set()
    for (const b of j.bones) if (hit(b.name)) { keep(b.name); direct.add('b:' + b.name) }
    for (const s of j.slots) if (slots.has(s.name)) keep(s.bone)
    for (const s of slots) if (hit(s)) direct.add('s:' + s)
    for (const a of atts) direct.add('a:' + a)
    return { bones, slots, atts, direct }
  }

  function focusRename() {
    const s = state.sel
    if (!s || !PANEL_OF[s.kind]) return
    renderProps()
    const i = document.querySelector('#props input[data-rename="1"]')
    if (i) { i.focus(); i.select() }
  }

  function selectSlotRange(name, prefix) {
    const pre = prefix || 'slot:'
    const rows = [...document.querySelectorAll(`#tree .row[data-key^="${pre}"]`)].map((r) => r.dataset.key.slice(pre.length))
    const from = state.sel && state.sel.kind === 'slot' ? state.sel.name : name
    const a = rows.indexOf(from), b = rows.indexOf(name)
    if (a < 0 || b < 0) { select({ kind: 'slot', name }); return }
    state.multiSlots = rows.slice(Math.min(a, b), Math.max(a, b) + 1)
    state.multi = []
    state.sel = { kind: 'slot', name }
    refresh()
  }

  function selectRange(name) {
    // Shift+click: everything between the last picked bone and this one, in tree order
    const rows = [...document.querySelectorAll('#tree .row[data-key^="b:"]')].map((r) => r.dataset.key.slice(2))
    const a = rows.indexOf(state.anchor || (state.sel && state.sel.kind === 'bone' ? state.sel.name : name))
    const b = rows.indexOf(name)
    if (a < 0 || b < 0) { select({ kind: 'bone', name }); return }
    state.multi = rows.slice(Math.min(a, b), Math.max(a, b) + 1)
    state.sel = { kind: 'bone', name }
    refresh()
  }

  function renderTree() {
    const tree = $('#tree')
    const scroll = tree.scrollTop
    tree.textContent = ''
    if (!state.json) return
    const j = state.json
    const pick = state.pick
    const m = searchMatches()
    const rows = []
    // in an animation the key column sits left of the names, next to the visibility dots (Spine)
    const pad = (depth) => `padding-left:${(animOn() ? 46 : 24) + depth * 12}px`
    const F = state.filter
    const node = (key, label, iconKey, count, depth, onDbl, lkey) => {
      const closed = !m && state.sections.has(key)
      const toggle = () => { state.sections.has(key) ? state.sections.delete(key) : state.sections.add(key); renderTree() }
      // a section things are made in (皮肤 / 事件 / 动画) is picked by a click, its panel has the 新建 button (Spine)
      const pickable = !!onDbl
      rows.push(h('div', { class: 'row node', style: pad(depth), 'data-selected': pickable && isSel('section', key) ? '1' : null,
        onclick: pickable ? () => { state.sections.delete(key); select({ kind: 'section', name: key }) } : toggle,
        ondblclick: onDbl ? (e) => { e.stopPropagation(); onDbl() } : null },
        lkey ? h('span', { class: 'lkey' }, lkey) : null,
        caret(!closed, toggle), h('span', { class: 'ico', html: ICON[iconKey] }), h('span', { class: 'label' }, label),
        h('span', { class: 'end' }, count != null ? h('span', { class: 'cnt' }, String(count)) : null)))
      return !closed
    }

    // the projects (Spine's hierarchy): the ones above the picked one, the picked one (its content follows), the rest at the end
    if (projects[activeProject]) { for (let i = 0; i < activeProject; i++) rows.push(projectRow(i, pad)); rows.push(projectRow(activeProject, pad)) }
    else rows.push(h('div', { class: 'row node', style: pad(0) }, caret(true), h('span', { class: 'ico', html: ICON.project }), h('span', { class: 'label' }, state.name)))
    const contentFrom = rows.length

    // the attachment each slot shows right now (the dot on its row)
    const posed = new Map()
    if (rt.skeleton) for (const s of rt.skeleton.slots) posed.set(s.data.name, s.getAttachment() ? s.getAttachment().name : null)
    // which attachment kinds the filter shows (Spine's viewport filter)
    const attKind = (t) => (t === 'mesh' || t === 'linkedmesh' ? 'mesh' : t === 'boundingbox' ? 'bbox' : t === 'clipping' ? 'clipping' : t === 'path' ? 'path' : t === 'point' ? 'point' : 'region')
    const shownContents = (name) => { const c = slotContents(name); return { atts: c.atts.filter((a) => F[attKind(a.type)] !== false), phs: F.placeholder ? c.phs : [] } }
    // a slot row with its attachments and placeholders; under a bone, or in the flat draw-order
    // list when bones are filtered out (same keys, same multi-select, drag = draw order there)
    const pushSlotRows = (s, depth, inOrder) => {
      const sk = 's:' + s.name
      const content = shownContents(s.name)
      const sClosed = !m && state.collapsed.has(sk)
      const sVisible = !state.hiddenSlots.has(s.name)
      const srow = h('div', {
        class: 'row', 'data-selected': isSel('slot', s.name) ? '1' : null, 'data-key': 'slot:' + s.name,
        'data-multi': state.multiSlots.includes(s.name) && !isSel('slot', s.name) ? '1' : null,
        'data-pickable': pick && pick.want === 'slot' ? '1' : null, 'data-hidden': sVisible ? null : '1',
        'data-match': m && m.direct.has('s:' + s.name) ? '1' : null, style: pad(depth),
        onclick: (e) => {
          if (pick) { resolvePick('slot', s.name); return }
          if (e.shiftKey) { selectSlotRange(s.name); return }
          select({ kind: 'slot', name: s.name }, e.ctrlKey || e.metaKey, { noReveal: !state.search })
        },
        ondblclick: () => focusRename(),
        oncontextmenu: (e) => { e.preventDefault(); sClosed ? state.collapsed.delete(sk) : state.collapsed.add(sk); renderTree() },
      },
      visDot(sVisible, () => { sVisible ? state.hiddenSlots.add(s.name) : state.hiddenSlots.delete(s.name); refresh() }),
      caret(content.atts.length + content.phs.length ? !sClosed : null, () => { sClosed ? state.collapsed.delete(sk) : state.collapsed.add(sk); renderTree() }),
      h('span', { class: 'ico', html: ICON.slotdot }), h('span', { class: 'label' }, s.name),
      inOrder ? h('span', { class: 'meta' }, s.bone) : null,
      animOn() ? h('span', { class: 'lkey' }, keyBtn(SLOT_TRACKS(s.name), () => keySlotNow(s.name), `给 ${s.name} 打关键帧（附件 / 颜色）`)) : null)
      if (inOrder) wireDrag(srow, { type: 'order', name: s.name }, { type: 'order', name: s.name })
      else wireDrag(srow, { type: 'slot', name: s.name }, { type: 'slot', name: s.name })
      rows.push(srow)
      if (sClosed) return
      for (const a of content.atts) {
        if (m && !m.atts.has(s.name + '/' + a.name) && !m.direct.has('s:' + s.name)) continue
        const shown = posed.get(s.name) === a.name
        const arow = h('div', {
          class: 'row', 'data-selected': isSel('att', a.name, { slot: s.name, skin: 'default' }) ? '1' : null,
          'data-key': `att:default:${s.name}:${a.name}`, 'data-match': m && m.direct.has('a:' + s.name + '/' + a.name) ? '1' : null, style: pad(depth + 1),
          'data-noexport': Ops.isExported(j, 'default', s.name, a.name) ? null : '1', title: Ops.isExported(j, 'default', s.name, a.name) ? null : '不导出',
          onclick: () => { if (pick) return; select({ kind: 'att', name: a.name, slot: s.name, skin: 'default' }, false, { noReveal: true }) },
          ondblclick: () => focusRename(),
        },
        visDot(shown, () => showAttachment(s.name, shown ? null : a.name), null, true),
        caret(null), h('span', { class: 'ico', html: ICON[attIcon(a.type)], style: a.type === 'region' ? null : a.type === 'clipping' ? 'color:#e06a6a' : 'color:#5fd3e6' }), h('span', { class: 'label' }, a.name),
        animOn() && (a.type === 'mesh' || a.type === 'linkedmesh' || a.type === 'clipping') ? meshKeyEnd(s.name, a.name, 'lkey') : null)
        wireDrag(arow, { type: 'att', name: a.name, slot: s.name, skin: 'default' }, null)
        rows.push(arow)
      }
      for (const ph of content.phs) {
        if (m && !m.atts.has(s.name + '/' + ph.name) && !m.direct.has('s:' + s.name)) continue
        const shown = posed.get(s.name) === ph.name
        rows.push(h('div', {
          class: 'row', 'data-selected': isSel('ph', ph.name, { slot: s.name }) ? '1' : null,
          'data-key': `ph:${s.name}:${ph.name}`, 'data-match': m && m.direct.has('a:' + s.name + '/' + ph.name) ? '1' : null, style: pad(depth + 1),
          onclick: () => { if (pick) return; select({ kind: 'ph', name: ph.name, slot: s.name }, false, { noReveal: true }) },
          ondblclick: () => focusRename(),
        },
        visDot(shown, () => showAttachment(s.name, shown ? null : ph.name), null, true),
        caret(null), h('span', { class: 'ico', html: ICON.placeholder }), h('span', { class: 'label' }, ph.name),
        h('span', { class: 'meta' }, ph.current ? ph.current.image : '空')))
      }
    }
    // Spine: with bones filtered out, the slots are listed in draw order (drag to reorder)
    if (!F.bones && F.slots && !m) {
      if (node('bones', '插槽（绘制顺序）', 'order', j.slots.length, 1)) for (const s of j.slots.slice().reverse()) pushSlotRows(s, 2, true)
    }

    // the bones: root sits right under the skeleton, beside 约束 / 皮肤 / 动画 (Spine)
    if (F.bones) {
      const kids = new Map()
      for (const b of j.bones) {
        if (!kids.has(b.parent || '')) kids.set(b.parent || '', [])
        kids.get(b.parent || '').push(b)
      }
      const slotsBy = new Map()
      for (const s of j.slots) {
        if (!slotsBy.has(s.bone)) slotsBy.set(s.bone, [])
        slotsBy.get(s.bone).push(s)
      }
      const toggleBranch = (name, on) => { for (const n of Ops.branch(j, name)) on ? state.hiddenBones.delete(n) : state.hiddenBones.add(n); refresh() }
      const walk = (b, depth) => {
        if (m && !m.bones.has(b.name)) return
        const key = 'b:' + b.name
        const own = F.slots ? (slotsBy.get(b.name) || []).filter((s) => !m || m.slots.has(s.name)) : []
        const sub = (kids.get(b.name) || []).filter((x) => !m || m.bones.has(x.name))
        const closed = !m && state.collapsed.has(key)
        const multi = state.multi.includes(b.name) && !isSel('bone', b.name)
        const role = state.roles.get(b.name) || 'normal'
        const visible = !state.hiddenBones.has(b.name)
        const toggleOpen = () => { closed ? state.collapsed.delete(key) : state.collapsed.add(key); renderTree() }
        const row = h('div', {
          class: 'row', 'data-selected': isSel('bone', b.name) ? '1' : null, 'data-multi': multi ? '1' : null,
          'data-pickable': pick && pick.want === 'bone' ? '1' : null, 'data-key': key, 'data-hidden': visible ? null : '1',
          'data-match': m && m.direct.has(key) ? '1' : null, style: pad(depth),
          onclick: (e) => {
            if (pick) { resolvePick('bone', b.name); return }
            if (e.shiftKey) { selectRange(b.name); return }
            state.anchor = b.name
            // a pick from search results opens its parents, so it stays in view once the search is cleared
            select({ kind: 'bone', name: b.name }, e.ctrlKey || e.metaKey, { noReveal: !state.search })
          },
          ondblclick: () => focusRename(),
          oncontextmenu: (e) => {
            // Spine: right click expands / collapses the node and everything below it
            e.preventDefault()
            const open = closed
            for (const n of Ops.branch(j, b.name)) open ? state.collapsed.delete('b:' + n) : state.collapsed.add('b:' + n)
            for (const s of j.slots) if (Ops.branch(j, b.name).includes(s.bone)) open ? state.collapsed.delete('s:' + s.name) : state.collapsed.add('s:' + s.name)
            renderTree()
          },
        },
        visDot(visible, () => { visible ? state.hiddenBones.add(b.name) : state.hiddenBones.delete(b.name); refresh() }, () => toggleBranch(b.name, !visible)),
        caret(own.length + sub.length ? !closed : null, toggleOpen),
        boneIcon(b, role, isSel('bone', b.name) || multi),
        h('span', { class: 'label' }, b.name),
        animOn() ? h('span', { class: 'lkey' }, keyBtn(BONE_TRACKS(b.name), () => keyBoneNow(b.name), `给 ${b.name} 打关键帧（旋转 / 平移 / 缩放）`)) : null,
        // Spine: the constraints this bone is in (as a bone or the target) at the row's end - a click goes to them
        // (more than two: one button with the count, a menu lists them - a row of icons hid the name)
        consRowEnd(consOf(b.name)))
        wireDrag(row, b.parent ? { type: 'bone', name: b.name } : null, { type: 'bone', name: b.name })
        rows.push(row)
        if (closed) return
        for (const s of own) pushSlotRows(s, depth + 1, false)
        for (const c of sub) walk(c, depth + 1)
      }
      for (const r of kids.get('') || []) walk(r, 1)
    }

    if (!m) {
      // 约束（上下拖动 = 求解顺序）
      const allCons = allConstraints()
      if (node('cons', '约束', 'cons', allCons.length, 1)) {
        allCons.forEach(({ kind, c }) => {
          const row = h('div', {
            class: 'row', 'data-selected': isSel(kind, c.name) ? '1' : null, 'data-multi': !isSel(kind, c.name) && ((state.multiCons || []).some((x) => x.kind === kind && x.name === c.name) || (state.dopeExtra && state.dopeExtra.cons.some((x) => x.kind === kind && x.name === c.name))) ? '1' : null, style: pad(2),
            onclick: (e) => select({ kind, name: c.name }, e.ctrlKey || e.metaKey),
            ondblclick: () => focusRename(),
          }, caret(null), h('span', { class: 'ico', html: ICON[kind] }), h('span', { class: 'label' }, c.name),
          h('span', { class: 'meta' }, { ik: 'IK', transform: '变换', path: '路径' }[kind]),
          animOn() && kind !== 'path' ? h('span', { class: 'lkey' }, keyBtn([[kind, c.name]], () => keyConstraintNow(kind, c.name), `给 ${c.name} 打关键帧`)) : null)
          wireDrag(row, { type: 'cons', kind, name: c.name }, { type: 'cons', kind, name: c.name })
          rows.push(row)
        })
      }

      // 绘制顺序（上面的盖住下面的，和 Spine 一样；上下拖动，Ctrl / Shift 多选一起拖；动画里拖 = 这一帧的绘制顺序关键帧）
      const order = drawOrderNow()
      if (F.bones && F.slots && node('order', '绘制顺序', 'order', order.length, 1, null,
        animOn() ? keyBtn([['drawOrder']], () => keyDrawOrderNow(order), `第 ${state.frame} 帧：给当前绘制顺序打关键帧`) : null)) {
        const clipped = clipRanges(order)
        for (const name of order.slice().reverse()) {
          const sl = slotOf(name)
          const cl = clipped.get(name)
          const row = h('div', {
            class: 'row', 'data-selected': isSel('slot', name) ? '1' : null, 'data-key': 'order:' + name,
            'data-multi': state.multiSlots.includes(name) && !isSel('slot', name) ? '1' : null,
            'data-pickable': pick && pick.want === 'slot' ? '1' : null, 'data-clip': cl ? '1' : null,
            title: cl ? `在剪裁「${cl.name}」里` : null, style: pad(2) + (cl ? `;--clip:${cl.tint}` : ''),
            onclick: (e) => {
              if (pick) { resolvePick('slot', name); return }
              if (e.shiftKey) { selectSlotRange(name, 'order:'); return }
              select({ kind: 'slot', name }, e.ctrlKey || e.metaKey, { noReveal: true })
            },
          }, caret(null), h('span', { class: 'ico', html: ICON.slotdot }), h('span', { class: 'label' }, name), h('span', { class: 'meta' }, sl ? sl.bone : ''))
          wireDrag(row, { type: 'order', name }, { type: 'order', name })
          rows.push(row)
        }
      }

      // 皮肤（双击「皮肤」新建，和 Spine 一样）
      // Spine: the default skin (what shows without a skin) is not listed; the active skin's dot turns it off again
      const named = j.skins.filter((x) => x.name !== 'default')
      if (node('skins', '皮肤', 'skin', named.length, 1, newSkin)) {
        for (const s of named) {
          const active = state.skin === s.name
          rows.push(h('div', {
            class: 'row', 'data-selected': isSel('skin', s.name) ? '1' : null, style: pad(2),
            onclick: () => { setSkin(s.name); select({ kind: 'skin', name: s.name }) },
            ondblclick: () => focusRename(),
          }, visDot(active, () => { setSkin(active ? 'default' : s.name); refresh(); status(active ? '不用皮肤' : `当前皮肤：${s.name}`) }, null, true),
          caret(null), h('span', { class: 'ico', html: ICON.skin }), h('span', { class: 'label' }, s.name)))
        }
      }

      // 事件 (Spine): double-click creates one; in an animation its key fires it at the current frame
      const evNames = Object.keys(j.events || {})
      if (node('events', '事件', 'event', evNames.length, 1, newEvent)) {
        for (const n of evNames) {
          rows.push(h('div', {
            class: 'row', style: pad(2), 'data-selected': isSel('event', n) ? '1' : null, 'data-multi': !isSel('event', n) && state.dopeExtra && state.dopeExtra.events.includes(n) ? '1' : null, 'data-key': 'event:' + n,
            onclick: () => select({ kind: 'event', name: n }),
            ondblclick: () => focusRename(),
          }, animOn() ? h('span', { class: 'lkey' }, keyBtn([['events', n]], () => keyEventNow(n), `在第 ${state.frame} 帧放事件 ${n}`)) : null,
          caret(null), h('span', { class: 'ico', html: ICON.event, style: `color:${KEY_COLOR.event}` }), h('span', { class: 'label' }, n)))
        }
      }

      // 动画
      const names = Object.keys(j.animations)
      // Spine: double-click 「动画」 creates an animation; the dot = the animation being played
      if (node('anims', '动画', 'anim', names.length, 1, newAnimation)) {
        for (const n of names) {
          const active = state.anim === n
          rows.push(h('div', {
            class: 'row', style: pad(2), 'data-selected': isSel('anim', n) ? '1' : null,
            onclick: () => { state.anim = n; state.frame = 0; state.temp.clear(); state.mode = 'animate'; state.playing = false; if (state.tool === 'create') state.tool = 'rotate'; select({ kind: 'anim', name: n }) },
            ondblclick: () => focusRename(),
          }, visDot(active, () => { state.anim = n; state.frame = 0; setMode('animate') }, null, true),
          caret(null), h('span', { class: 'ico', html: ICON.anim }), h('span', { class: 'label' }, n)))
        }
      }

      // 图片 (Spine's Images node): the project's image folder, pictures drag onto a bone / slot / the stage
      if (!m) renderImagesNode(rows, pad)
    }

    if (projects[activeProject] && projects[activeProject].open === false && !m) rows.length = contentFrom
    if (projects[activeProject]) for (let i = activeProject + 1; i < projects.length; i++) rows.push(projectRow(i, pad))
    tree.append(h('div', { class: 'tree-in' }, rows))
    tree.scrollTop = scroll
    if (state.scrollToSel) {
      state.scrollToSel = false
      const r = tree.querySelector('.row[data-selected="1"]')
      if (r) {
        const top = r.offsetTop
        if (top < tree.scrollTop || top > tree.scrollTop + tree.clientHeight - 40) tree.scrollTop = top - tree.clientHeight / 3
      }
    }
  }

  /** Enter in the search box: pick the next match (Spine's F3 / Enter). */
  function searchNext(back) {
    const rows = [...document.querySelectorAll('#tree .row[data-match="1"]')]
    if (!rows.length) return
    state.searchIdx = ((state.searchIdx == null ? -1 : state.searchIdx) + (back ? -1 : 1) + rows.length) % rows.length
    rows[state.searchIdx].click()
  }

  /** Spine: double-click 「事件」 creates one. */
  function newEvent() {
    edit((r) => `已新建事件 ${r.event}`, (x) => Ops.createEvent(x, 'event'), (r) => { state.sel = { kind: 'event', name: r.event }; state.sections.delete('events') })
  }

  /** The event fires at the current frame (Spine's event key). */
  function keyEventNow(name) {
    edit(`第 ${state.frame} 帧：放事件 ${name}`, (j) => Ops.keyEvent(j, state.anim, name, timeSec()))
  }

  function newAnimation() {
    edit((r) => `已新建动画 ${r.animation}`, (x) => Ops.createAnimation(x), (r) => {
      state.anim = r.animation; state.frame = 0; state.mode = 'animate'; state.sel = { kind: 'anim', name: r.animation }
    })
  }

  /** Spine's tree toolbar: expand / collapse (the picked nodes or everything), and the node-type filter. */
  function treeExpand(open) {
    const j = state.json
    if (!j) return
    const picked = selectedBones()
    const bones = picked.length ? [...new Set(picked.flatMap((b) => Ops.branch(j, b)))] : j.bones.map((b) => b.name)
    for (const b of bones) open ? state.collapsed.delete('b:' + b) : state.collapsed.add('b:' + b)
    const set = new Set(bones)
    for (const s of j.slots) if (set.has(s.bone)) open ? state.collapsed.delete('s:' + s.name) : state.collapsed.add('s:' + s.name)
    if (!picked.length) for (const k of ['bones', 'order', 'skins', 'cons', 'anims']) open ? state.sections.delete(k) : state.sections.add(k)
    if (!open && !picked.length) state.sections.delete('bones')
    renderTree()
  }

  function filterMenu(btnEl) {
    const F = state.filter
    const items = [['bones', '骨骼'], ['slots', '插槽'], ['region', '区域'], ['mesh', '网格'], ['bbox', '边界框'], ['clipping', '剪裁'], ['path', '路径'], ['point', '端点'], ['placeholder', '皮肤占位符']]
    closeMenu()
    const r = btnEl.getBoundingClientRect()
    const menu = h('div', { class: 'menu', id: 'menu', style: `left:${Math.round(r.right - 160)}px;top:${Math.round(r.bottom + 4)}px` },
      items.map(([k, label]) => h('button', { onclick: (e) => { e.stopPropagation(); F[k] = !F[k]; renderTree(); filterMenu(btnEl) } },
        h('span', { class: 'dot', 'data-on': F[k] ? '1' : null }), label)),
      h('button', { onclick: () => { for (const [k] of items) F[k] = true; closeMenu(); renderTree() } }, h('span', { style: 'width:16px' }), '全部显示'))
    mountMenu(menu)
  }

  /**
   * Which slots a clipping covers right now (Spine tints them in 绘制顺序): walking the draw
   * order from the bottom, a slot showing a clipping (3+ vertices) starts a range that runs to
   * its 结束插槽 (inclusive) or the top; the clipping's own slot is in it. One clip at a time, as
   * the runtime does. Map(slot → { name, tint }).
   */
  function clipRanges(order) {
    const out = new Map()
    if (!rt.skeleton) return out
    let cur = null
    for (const n of order) {
      const slot = rt.skeleton.findSlot(n)
      const a = slot && slot.getAttachment()
      if (!cur && a instanceof spine.ClippingAttachment && a.worldVerticesLength >= 6) {
        const c = a.color
        const plain = Math.abs(c.r - 0.2275) < 0.01 && Math.abs(c.g - 0.2275) < 0.01 && Math.abs(c.b - 0.8078) < 0.01
        const rgb = plain ? '206,58,58' : `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`
        cur = { name: a.name, tint: `rgba(${rgb},.2)`, end: a.endSlot ? a.endSlot.name : null }
        out.set(n, cur)
        continue
      }
      if (!cur) continue
      out.set(n, cur)
      if (cur.end === n) cur = null
    }
    return out
  }

  /** The draw order now (slot names, bottom first): the posed one in an animation, else the setup. */
  function drawOrderNow() {
    if (animOn() && rt.skeleton) return rt.skeleton.drawOrder.map((s) => s.data.name)
    return state.json ? state.json.slots.map((s) => s.name) : []
  }

  function keyDrawOrderNow(order) {
    const o = order || drawOrderNow()
    edit(`第 ${state.frame} 帧：绘制顺序已打关键帧`, (j) => Ops.keyDrawOrder(j, state.anim, timeSec(), o))
  }

  /** The dopesheet's 筛选: which rows show (Spine's dopesheet filter). */
  function dopeFilterMenu(btnEl) {
    const F = state.dope.filter
    const groups = [
      ['骨骼', [['rotate', '旋转'], ['translate', '平移'], ['scale', '缩放'], ['shear', '斜切']]],
      ['插槽', [['attachment', '附件'], ['color', '颜色'], ['deform', '网格 / 剪裁变形']]],
      ['其它', [['cons', '约束'], ['events', '事件'], ['drawOrder', '绘制顺序']]],
    ]
    closeMenu()
    const r = btnEl.getBoundingClientRect()
    const toggle = (k) => (e) => { e.stopPropagation(); F[k] = !F[k]; buildDope(); syncTimeline(); dopeFilterMenu(btnEl) }
    const menu = h('div', { class: 'menu', id: 'menu', style: `left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px` },
      groups.flatMap(([g, items]) => [h('div', { class: 'mh' }, g), ...items.map(([k, label]) => h('button', { onclick: toggle(k) }, h('span', { class: 'dot', 'data-on': F[k] ? '1' : null }), label))]),
      h('div', { class: 'msep' }),
      h('button', { onclick: toggle('keyedOnly') }, h('span', { class: 'dot', 'data-on': F.keyedOnly ? '1' : null }), '只显示有关键帧的行'),
      h('button', { onclick: (e) => { e.stopPropagation(); for (const k of Object.keys(F)) F[k] = k !== 'keyedOnly'; buildDope(); syncTimeline(); closeMenu() } }, h('span', { style: 'width:16px' }), '全部显示'))
    mountMenu(menu)
    const mr = menu.getBoundingClientRect()
    if (mr.bottom > innerHeight - 8) menu.style.top = Math.round(r.top - mr.height - 4) + 'px'
  }

  function newSkin() {
    const taken = new Set(state.json.skins.map((s) => s.name))
    let i = 1
    while (taken.has('skin' + i)) i++
    edit(`已新建皮肤 skin${i}`, (x) => Ops.createSkin(x, 'skin' + i), (r) => { state.sel = { kind: 'skin', name: r.skin }; setSkin(r.skin) })
  }

  // ------------------------------------------------------------------ small widgets

  function field(label, input) { return h('div', { class: 'f' }, h('label', {}, label), input) }

  function numInput(value, onCommit, opts) {
    const o = opts || {}
    const i = h('input', { type: 'number', step: o.step || 'any', value: Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '', disabled: !!o.disabled })
    const commit = () => {
      const v = Number(i.value)
      if (!Number.isFinite(v) || Math.abs(v - value) < 1e-9) return
      onCommit(v)
    }
    i.addEventListener('change', commit)
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur() })
    return i
  }

  function textInput(value, onCommit, opts) {
    const i = h('input', { type: 'text', value, disabled: !!(opts && opts.disabled), 'data-rename': opts && opts.rename ? '1' : null })
    i.addEventListener('change', () => { const v = i.value.trim(); if (v && v !== value) onCommit(v); else i.value = value })
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); if (e.key === 'Escape') { i.value = value; i.blur() } })
    return i
  }

  function sliderInput(value, onPreview, onCommit, opts) {
    const o = opts || {}
    const fmt = o.fmt || ((v) => v.toFixed(2))
    const out = h('span', { style: 'flex:0 0 34px;text-align:right;color:#9a9a9a;font-size:11px' }, fmt(value))
    const i = h('input', { type: 'range', min: o.min != null ? o.min : 0, max: o.max != null ? o.max : 1, step: o.step || 0.01, value })
    i.addEventListener('input', () => { out.textContent = fmt(Number(i.value)); onPreview(Number(i.value)) })
    i.addEventListener('change', () => onCommit(Number(i.value)))
    return h('div', { class: 'inline' }, i, out)
  }

  function check(label, value, onChange, opts) {
    const i = h('input', { type: 'checkbox', checked: !!value, disabled: !!(opts && opts.disabled), onchange: () => onChange(i.checked) })
    return h('label', { title: opts && opts.title }, i, label)
  }

  function selectInput(options, value, onChange) {
    const s = h('select', { class: 'select', onchange: () => onChange(s.value) },
      options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)))
    return s
  }

  function btn(label, onClick, opts) {
    const o = opts || {}
    return h('button', { class: 'btn small' + (o.primary ? ' primary' : '') + (o.full ? ' full' : ''), disabled: o.disabled, title: o.title, onclick: onClick }, label)
  }

  /** Spine's small buttons at the upper right of a property block (duplicate / delete). */
  function ibtn(iconKey, title, onClick, disabled) {
    return h('button', { class: 'ibtn', title, disabled, html: ICON[iconKey], onclick: (e) => { e.stopPropagation(); onClick() } })
  }

  /** Spine's 「新建…」: one button, a menu of what can be created here. */
  function menuButton(label, items, opts) {
    const b = h('button', { class: 'btn small' + (opts && opts.primary ? ' primary' : ''), onclick: (e) => {
      e.stopPropagation()
      closeMenu()
      const r = b.getBoundingClientRect()
      const menu = h('div', { class: 'menu', id: 'menu', style: `left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px` },
        items.filter(Boolean).map((it) => h('button', { disabled: it.disabled, title: it.title, onclick: () => { closeMenu(); it.run() } },
          it.icon ? h('span', { html: ICON[it.icon], style: 'display:inline-flex' }) : null, it.label, it.kb ? h('span', { class: 'kb' }, it.kb) : null)))
      mountMenu(menu)
      const mr = menu.getBoundingClientRect()
      if (mr.bottom > innerHeight - 8) menu.style.top = Math.round(r.top - mr.height - 4) + 'px'
    } }, label, h('span', { class: 'chev' }))
    return b
  }
  function closeMenu() { const m = document.getElementById('menu'); if (m) m.remove(); const k = document.getElementById('menuMask'); if (k) k.remove() }
  /** A menu over a transparent mask: a click anywhere else closes it and goes no further (the app's dropdowns). */
  function mountMenu(menu) { closeMenu(); document.body.append(h('div', { class: 'menu-mask', id: 'menuMask', onpointerdown: (e) => { e.stopPropagation(); closeMenu() } }), menu) }

  function grp(title, right, ...kids) {
    return h('div', { class: 'grp' }, title ? h('div', { class: 't' }, title, right ? h('span', { class: 'r' }, right) : null) : null, ...kids)
  }

  function colorParts(hex) {
    const c = String(hex || 'ffffffff').padEnd(8, 'f')
    return { rgb: '#' + c.slice(0, 6), a: parseInt(c.slice(6, 8), 16) / 255 }
  }

  const animOn = () => state.mode === 'animate' && !!state.anim

  /** Spine 3.8 inherit checkboxes (旋转 / 缩放 / 翻转) ↔ transform mode. */
  const INHERIT = {
    normal: [1, 1, 1], onlyTranslation: [0, 0, 0], noRotationOrReflection: [0, 1, 0], noScale: [1, 0, 1], noScaleOrReflection: [1, 0, 0],
  }
  function inheritMode(r, s, f) {
    if (!r && !s) return 'onlyTranslation'
    if (!r) return 'noRotationOrReflection'
    if (!s) return f ? 'noScale' : 'noScaleOrReflection'
    return 'normal'
  }

  // ------------------------------------------------------------------ properties (right, under the tree — Spine)

  function currentSlot() {
    const s = state.sel
    if (!s) return null
    if (s.kind === 'slot') return s.name
    if (s.kind === 'att' || s.kind === 'ph') return s.slot
    return null
  }

  function propsKind() {
    const s = state.sel
    if (!state.json) return { title: '属性', body: () => [h('div', { class: 'hint' }, '先在左侧「导入工程」里导入。')] }
    if (state.multi.length > 1) return { title: `骨骼 · 已选 ${state.multi.length} 根`, body: boneBody }
    if (!s) return { title: '属性', body: () => [] }
    if (s.kind === 'bone') return { title: '骨骼', body: boneBody }
    if (s.kind === 'slot' && state.multiSlots.length > 1) return { title: `插槽 · 已选 ${state.multiSlots.length} 个`, body: multiSlotBody }
    if (s.kind === 'slot') return { title: '插槽', body: slotBody }
    if (s.kind === 'att') return { title: s.skin === 'default' ? '图片' : `图片 · 皮肤 ${s.skin}`, body: slotBody }
    if (s.kind === 'ph') return { title: '皮肤占位符', body: slotBody }
    if (s.kind === 'skin') return { title: '皮肤', body: skinBody }
    if (s.kind === 'anim') return { title: '动画', body: animBody }
    if (s.kind === 'event') return { title: '事件', body: eventBody }
    if (s.kind === 'section') return { title: { skins: '皮肤', events: '事件', anims: '动画' }[s.name] || '属性', body: sectionBody }
    if (s.kind === 'project') return { title: '工程', body: projectBody }
    return { title: { ik: 'IK 约束', transform: '变换约束', path: '路径约束' }[s.kind] || '属性', body: consBody }
  }

  function renderProps() {
    const box = $('#props')
    const scroll = box.scrollTop
    const keep = box.dataset.for
    const pk = propsKind()
    const key = state.sel ? `${state.sel.kind}:${state.sel.slot || ''}:${state.sel.name}` : 'none'
    box.textContent = ''
    $('#propsTitle').textContent = pk.title
    box.append(...pk.body())
    box.dataset.for = key
    if (keep === key) box.scrollTop = scroll
  }

  /** The 动画 section's left column: 导入工程 works here; the other panels are the production ones (not in this test line). */
  function renderLeft() {
    if (EMBED) return
    const left = $('#left')
    const f = state.importFiles
    const pickRow = (label, file, input) => h('div', { class: 'imp' },
      h('div', { class: 'imp-l' }, label),
      h('div', { class: 'imp-r' }, h('span', { class: 'imp-f' + (file ? ' on' : '') }, file || '未选择'),
        h('button', { class: 'btn small primary', onclick: () => { $(input).value = ''; $(input).click() } }, '导入')))
    const imgs = f.images.length ? (f.images.length === 1 ? f.images[0].name : `${f.images.length} 张`) : ''
    const sample = h('select', { class: 'select', onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) run(() => loadSample(v)) } },
      h('option', { value: '' }, '示例工程（测试线用）…'), h('option', { value: 'jiaye' }, '伽夜（骨骼蒙版模板）'), h('option', { value: 'wild' }, 'wild'), h('option', { value: 'cloud' }, 'cloud'))
    // one panel open at a time; the dim ones are production-only
    const panel = (title, icon, body, dim, key) => {
      const open = !dim && state.leftOpen === key
      return h('div', { class: 'pn', 'data-open': open ? '1' : null, 'data-dim': dim ? '1' : null, title: dim ? '正式版已有，测试线不含' : null },
        h('div', { class: 'pn-hd', onclick: dim ? null : () => { state.leftOpen = open ? null : key; renderLeft(); renderLayerDock(); renderStage() } },
          h('span', { class: 'ic', html: ICON[icon] }), h('b', {}, title), h('span', { class: 'chev', html: open ? ICON.chev : ICON.right })),
        open ? h('div', { class: 'pn-bd' }, ...body) : null)
    }
    left.textContent = ''
    left.append(
      panel('导入工程', 'import', [
        pickRow('JSON', f.json && f.json.name, '#pickJson'),
        pickRow('ATLAS 图集', f.atlas && f.atlas.name, '#pickAtlas'),
        pickRow('PNG/JPG/WEBP 贴图', imgs, '#pickPng'),
        h('div', { class: 'btns' }, btn('清空', () => { state.importFiles = { json: null, atlas: null, images: [] }; renderLeft() }, { full: true })),
        h('div', { class: 'btns' }, btn('开始导入', () => run(() => loadFiles([f.json, f.atlas, ...f.images].filter(Boolean))), { full: true, disabled: !f.json })),
        h('div', { class: 'btns' }, btn('导入PS工程', () => { $('#fileDir').value = ''; $('#fileDir').click() }, { full: true })),
        h('div', { class: 'hint', style: 'margin-top:6px' }, '选择 PhotoshopToSpine 导出的文件夹（JSON + 贴图），也可以直接拖到画面上'),
        h('div', { style: 'margin-top:8px' }, sample),
      ], false, 'import'),
      panel('骨骼架设', 'bone', null, true),
      panel('蒙皮', 'mesh', state.json ? skinPanelBody() : [h('div', { class: 'hint' }, '先导入工程')], false, 'mesh'),
      panel('权重', 'cons', state.json ? weightPanelBody() : [h('div', { class: 'hint' }, '先导入工程')], false, 'weights'),
      panel('动画工具', 'anim', null, true))
  }

  // ------------------------------------------------------------------ 自动蒙皮 / 自动权重 (the production panels)
  //
  // The left panel holds the settings and the batch buttons; the layers are cards over the
  // bottom of the stage (ticked = taking part, the same tick in both panels), each with its
  // picture, its count and its editor button.

  /** Every picture layer (slots, top of the draw order first). */
  /** `setup`: the slot's setup-pose attachment (序列帧 keys hide pictures on the current frame). */
  function imageLayers(setup) {
    const out = []
    if (!rt.skeleton) return out
    for (const slot of rt.skeleton.drawOrder.slice().reverse()) {
      const att = setup ? (slot.data.attachmentName ? rt.skeleton.getAttachment(slot.data.index, slot.data.attachmentName) : null) : slot.getAttachment()
      const key = att && attachmentKey(slot.data.name, att)
      if (!key) continue
      const mesh = att instanceof spine.MeshAttachment
      if (!mesh && !(att instanceof spine.RegionAttachment)) continue
      let bones = 0
      if (mesh && att.bones) { const set = new Set(); for (let i = 0; i < att.bones.length;) { const c = att.bones[i++]; for (let k = 0; k < c; k++) set.add(att.bones[i++]) } bones = set.size }
      out.push({ slot: slot.data.name, skin: key.skin, name: key.name, mesh, verts: mesh ? att.worldVerticesLength / 2 : 0, bones, region: att.region, bone: slot.data.boneData.name })
    }
    return out
  }
  const tickedLayers = () => imageLayers().filter((l) => !state.unticked.has(l.slot))

  /** Several layers in one undo step; each step works on the project the last one left. */
  function batchEdit(layers, label, each, after) {
    runBatch(layers, label, each).then((res) => { if (after) after(res) }, (e) => status(e.message, 'error'))
  }

  /** One undo step over the layers; resolves with { done, verts, skipped, why, text }. */
  function runBatch(layers, label, each) {
    if (!layers.length) return Promise.reject(new Error('先勾选图层（画面下方的图层卡片）'))
    status(`${label}中…（${layers.length} 层）`)
    return new Promise((resolve, reject) => setTimeout(() => {
      let n = 0
      const say = (r) => `${label}完成 · ${r.done} 层${r.verts ? ` · ${r.verts} 顶点` : ''}${r.skipped ? `（${r.skipped} 层没处理：${r.why}）` : ''}`
      const res = edit(say, (j) => {
        let json = j, verts = 0, skipped = 0, why = ''
        for (const L of layers) {
          try { const r = each(json, L); json = r.json; verts += r.verts || 0; n++ } catch (e) { skipped++; why = e.message }
        }
        return { json, done: n, verts, skipped, why }
      })
      if (res) resolve({ ...res, text: say(res) })
      else reject(new Error(`${label}没有完成`))
    }, 20))
  }

  /**
   * 自动蒙皮 for one picture. The production builder at a low 密度 grew the whole silhouette
   * (by about a fifth of an edge) to cover thin bits its coarse outline cut, which put the
   * outline far off the art. Here the outline is 描绘 with 精致度 100 (it covers the pixels by
   * pushing only the edges that cut them), its long edges split at the density's edge length,
   * and the builder only supplies the inside vertices; the triangles keep the outline's edges.
   */
  function autoMeshModel(model, px, W, Hh) {
    const gen = window.NovaFlowAutoMesh.buildMesh(px, W, Hh, { density: state.meshDensity, coverage: false })
    if (!gen) throw new Error('图片没有不透明的地方')
    const edge = gen.edge || Math.hypot(W, Hh) / state.meshDensity
    const outline = ME().traceOutline(px, W, Hh, CORE(), { eps: Math.max(0.8, 0.03 * edge), concavity: 92, refine: 100, padding: 1 })
    const hull = []
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]
      const k = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / edge)
      hull.push(a)
      for (let s0 = 1; s0 <= k; s0++) hull.push([a[0] + (b[0] - a[0]) * s0 / (k + 1), a[1] + (b[1] - a[1]) * s0 / (k + 1)])
    })
    const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0; return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) }
    const inner = []
    for (let i = gen.hull; i < gen.vertices.length / 2; i++) {
      const x = gen.vertices[2 * i], y = gen.vertices[2 * i + 1]
      if (!ME().pointInPoly(x, y, hull)) continue
      let d = Infinity
      for (let k = 0; k < hull.length; k++) d = Math.min(d, segD(x, y, hull[k], hull[(k + 1) % hull.length]))
      if (d >= edge * 0.35) inner.push(x, y)
    }
    const verts = [...hull.flat(), ...inner]
    const tmp = { ...model, hull: hull.length, points: [] }
    for (let i = 0; i < verts.length / 2; i++) tmp.points.push({ u: verts[2 * i], v: verts[2 * i + 1] })
    return ME().fromImageMesh(model, { vertices: verts, hull: hull.length, triangles: ME().triangulate(tmp, CORE()) })
  }

  /** One layer's mesh (a region becomes a mesh first). */
  function meshOneLayer(json, L) {
    let r = { json }
    const a = json.skins.find((x) => x.name === L.skin).attachments[L.slot][L.name]
    if ((a.type || 'region') === 'region') r = Ops.regionToMesh(json, L.skin, L.slot, L.name)
    else if (a.type !== 'mesh') throw new Error('链接网格跟着原网格')
    const ctx = meshModelOf(r.json, L.skin, L.slot, L.name)
    const W = Math.round(ctx.model.width), Hh = Math.round(ctx.model.height)
    const px = regionPixels(ctx.region, W, Hh)
    if (!px) throw new Error('读不到图片像素')
    const m = autoMeshModel(ctx.model, px, W, Hh)
    return { ...Ops.setMesh(r.json, L.skin, L.slot, L.name, ME().toAttachment(m, ctx.mats, ctx.slotBone), ME().remapOf(m)), verts: m.points.length }
  }

  /** One layer's bone-heat weights (the production solver); a region becomes a mesh first. */
  function weighOneLayer(json, L, boneIds) {
    const AW = window.NovaFlowAutoWeights
    let r = { json }
    const a = json.skins.find((x) => x.name === L.skin).attachments[L.slot][L.name]
    if ((a.type || 'region') === 'region') r = Ops.regionToMesh(json, L.skin, L.slot, L.name)
    else if (a.type !== 'mesh' && a.type !== 'linkedmesh') throw new Error('不是图片')
    const ctx = meshModelOf(r.json, L.skin, L.slot, L.name)
    if (ctx.bones.length <= 1) throw new Error('骨架只有 root，先建好骨骼')
    const V = ctx.model.points.flatMap((p) => [p.x, p.y]), T = ctx.model.tris
    const segs = ctx.bones.map((b) => ({ ax: b.worldX, ay: b.worldY, bx: b.worldX + b.data.length * b.a, by: b.worldY + b.data.length * b.c, skip: !(b.data.length >= 1) || !b.parent }))
    let pick = boneIds && boneIds.length ? boneIds.slice() : AW.selectBones(V, T, segs.map((g) => (g.skip ? { ...g, ax: 1e9, ay: 1e9, bx: 1e9, by: 1e9 } : g))).filter((i) => !segs[i].skip)
    if (!(boneIds && boneIds.length)) {
      // a picture hung on a bone (not the root) belongs to that bone's branch first
      const own = ctx.bones[ctx.slotBone]
      if (own && own.parent) {
        const inBranch = (i) => { for (let b = ctx.bones[i]; b; b = b.parent) if (b === own) return true; return false }
        pick = [ctx.slotBone, ...pick.filter(inBranch).filter((i) => i !== ctx.slotBone)]
      }
    }
    if (!pick.length) pick = [ctx.slotBone]
    const hw = AW.heatWeights(V, T, pick.map((i) => segs[i]))
    const nb = pick.length
    const m = ME().toWeighted(ctx.model, ctx.slotBone)
    m.points.forEach((p, i) => {
      const row = []
      for (let k = 0; k < nb; k++) { const w = hw.weights[i * nb + k]; if (w > 1e-3) row.push([pick[k], w]) }
      const tot = row.reduce((x, [, w]) => x + w, 0)
      p.w = tot > 0 ? row.map(([b, w]) => [b, w / tot]) : [[pick[0], 1]]
    })
    return Ops.setMesh(r.json, L.skin, L.slot, L.name, ME().toAttachment(m, ctx.mats, ctx.slotBone), ME().remapOf(m))
  }

  /** 还原初始图层: the picture as imported (its attachment and its deform keys). */
  function restoreOneLayer(json, L) {
    const init = state.initialJson
    const was = init && ((init.skins.find((x) => x.name === L.skin) || { attachments: {} }).attachments[L.slot] || {})[L.name]
    if (!was) throw new Error('导入时没有这张图')
    const out = Ops.prepare(json)
    out.skins.find((x) => x.name === L.skin).attachments[L.slot][L.name] = JSON.parse(JSON.stringify(was))
    for (const [an, a] of Object.entries(out.animations)) {
      const before = (((init.animations[an] || {}).deform || {})[L.skin] || {})[L.slot]
      const d = a.deform && a.deform[L.skin] && a.deform[L.skin][L.slot]
      if (d) { if (before && before[L.name]) d[L.name] = JSON.parse(JSON.stringify(before[L.name])); else delete d[L.name] }
    }
    return { json: Ops.tidy(out) }
  }

  /** 还原原始权重: the imported binding where the mesh is the imported one, else unbound (the mesh stays). */
  function unweighOneLayer(json, L) {
    const init = state.initialJson
    const was = init && ((init.skins.find((x) => x.name === L.skin) || { attachments: {} }).attachments[L.slot] || {})[L.name]
    const cur = json.skins.find((x) => x.name === L.skin).attachments[L.slot][L.name]
    if (cur.type !== 'mesh') throw new Error('没有网格')
    const same = was && was.type === 'mesh' && JSON.stringify(was.uvs) === JSON.stringify(cur.uvs)
    if (same) {
      const out = Ops.prepare(json)
      out.skins.find((x) => x.name === L.skin).attachments[L.slot][L.name].vertices = JSON.parse(JSON.stringify(was.vertices))
      return { json: Ops.tidy(out) }
    }
    const ctx = meshModelOf(json, L.skin, L.slot, L.name)
    const m = { ...ctx.model, weighted: false, points: ctx.model.points.map((p) => ({ ...p, w: null })) }
    return Ops.setMesh(json, L.skin, L.slot, L.name, ME().toAttachment(m, ctx.mats, ctx.slotBone), ME().remapOf(m))
  }

  /** 自动蒙皮 (left): 默认密度, 生成网格, 还原初始图层 — the layers are cards over the stage. */
  function skinPanelBody() {
    const dv = h('b', { class: 'dv' }, String(state.meshDensity))
    const setup = state.mode === 'setup'
    return [
      h('div', { class: 'dens' }, h('span', {}, '默认密度'), dv),
      h('input', { type: 'range', class: 'dens-r', min: 2, max: 40, step: 1, value: state.meshDensity, oninput: (e) => { state.meshDensity = Number(e.target.value); dv.textContent = String(state.meshDensity) } }),
      h('div', { class: 'hint' }, '越高越密。20~24 通常够用，再高收益很小。'),
      h('div', { class: 'btns' }, btn('自动蒙皮', () => batchEdit(tickedLayers(), '自动蒙皮', meshOneLayer), { primary: true, full: true, disabled: !setup, title: '给勾选的图层按默认密度生成网格' })),
      h('div', { class: 'btns' }, btn('还原初始图层', () => batchEdit(tickedLayers(), '还原初始图层', restoreOneLayer), { full: true, disabled: !setup, title: '勾选的图层回到刚导入时的样子（去掉这里生成的网格和权重）' })),
      setup ? null : h('div', { class: 'hint' }, '在「设置」模式下用'),
    ]
  }

  /** 自动权重 (left): 自动权重, 还原原始权重 — the same layer cards, with their 权重 editor. */
  function weightPanelBody() {
    const setup = state.mode === 'setup'
    return [
      h('div', { class: 'btns' }, btn('自动权重', () => batchEdit(tickedLayers(), '自动权重', (j, L) => weighOneLayer(j, L)), { primary: true, full: true, disabled: !setup, title: '给勾选的图层自动分配骨骼并求解权重（正式版的骨骼热扩散）；每层的「权重」按钮可以手工细调' })),
      h('div', { class: 'btns' }, btn('还原原始权重', () => batchEdit(tickedLayers().filter((l) => l.mesh), '还原原始权重', unweighOneLayer), { full: true, disabled: !setup, title: '回到导入时的权重：Spine 里绑好的保留，这里自动或手动加的去掉；网格不动' })),
      setup ? null : h('div', { class: 'hint' }, '在「设置」模式下用'),
    ]
  }

  /** The layer cards over the bottom of the stage while 自动蒙皮 / 自动权重 is open (序列K帧 / 序列扫光 show pictures there). */
  function renderLayerDock() {
    const dock = $('#layerDock')
    const frameTool = state.leftOpen === 'sequence' || state.leftOpen === 'sweep'
    const kind = state.leftOpen === 'mesh' || state.leftOpen === 'weights' || frameTool ? state.leftOpen : null
    const show = !!(kind && state.json && (frameTool ? animOn() : (state.mode === 'setup' || kind === 'weights')) && !state.meshEdit && !state.weightEdit)
    dock.hidden = !show
    if (!show) return
    if (frameTool) { renderFrameDock(dock, kind); return }
    const keep = dock.querySelector('.ld-grid') ? dock.querySelector('.ld-grid').scrollTop : 0
    dock.textContent = ''
    const layers = imageLayers()
    const U = state.unticked
    const ticked = layers.filter((l) => !U.has(l.slot))
    const L0 = layerSel()
    dock.append(h('div', { class: 'ld-hd' },
      h('span', {}, `已选 ${ticked.length} / ${layers.length}`),
      h('button', { class: 'tg', onclick: () => { U.clear(); renderLayerDock() } }, '全选'),
      h('button', { class: 'tg', title: '全部取消勾选', onclick: () => { U.clear(); for (const l of layers) U.add(l.slot); renderLayerDock() } }, '清空'),
      h('span', { class: 'sp' }),
      // × closes the cards and folds the 自动蒙皮 / 自动权重 panel on the left
      h('button', { class: 'xx', title: '关闭（左边的面板一起收起）', onclick: () => { state.leftOpen = null; renderLeft(); renderLayerDock(); renderStage(); layoutFloats() } }, '×')))
    const grid = h('div', { class: 'ld-grid' })
    for (const l of layers) {
      const c = h('canvas', { width: 32, height: 32 })
      if (l.region) drawRegionThumb(c, l.region)
      const on = !U.has(l.slot)
      const count = kind === 'mesh' ? (l.mesh ? String(l.verts) : '') : (l.bones ? `${l.bones} 骨` : '')
      const editBtn = kind === 'mesh'
        ? h('button', { class: 'ld-btn', title: l.mesh ? '在画面里改这一层的网格' : '按默认密度生成这一层的网格，然后打开编辑', onclick: (e) => {
            e.stopPropagation()
            const L = { skin: l.skin, slot: l.slot, name: l.name }
            if (l.mesh) enterMeshEdit({ kind: 'att', ...L })
            else batchEdit([L], '自动蒙皮', meshOneLayer, () => enterMeshEdit({ kind: 'att', ...L }))
          } }, '编辑')
        : h('button', { class: 'ld-btn', title: l.bones ? '在画面里刷这一层的权重' : '先自动求解这一层的权重，然后打开权重编辑', onclick: (e) => {
            e.stopPropagation()
            const L = { skin: l.skin, slot: l.slot, name: l.name }
            if (l.bones) enterWeightEdit(L)
            else batchEdit([L], '自动权重', (j, x) => weighOneLayer(j, x), () => enterWeightEdit(L))
          } }, '权重')
      grid.append(h('div', { class: 'ld-card', 'data-on': L0 && L0.slot === l.slot ? '1' : null, title: l.slot,
        onclick: () => select({ kind: 'att', skin: l.skin, slot: l.slot, name: l.name }, false, { noReveal: false }),
        // the card under the pointer lights its layer up on the stage, as hovering the layer does
        onmouseenter: () => { state.hoverImg = l.slot }, onmouseleave: () => { if (state.hoverImg === l.slot) state.hoverImg = null } },
        h('input', { type: 'checkbox', checked: on, title: '勾选 = 参与自动蒙皮 / 自动权重（两个面板是同一个勾选）',
          onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? U.delete(l.slot) : U.add(l.slot); renderLayerDock() } }),
        c, h('span', { class: 'ld-n' }, l.slot), h('span', { class: 'ld-c' }, count), editBtn))
    }
    dock.append(grid)
    grid.scrollTop = keep
    // a layer picked in the viewport or the tree: its card scrolls into view
    const card = grid.querySelector('.ld-card[data-on="1"]')
    const now = L0 ? `${L0.slot}/${L0.name}` : ''
    if (card && dock.dataset.last !== now) {
      const g = grid.getBoundingClientRect(), r = card.getBoundingClientRect()
      if (r.top < g.top) grid.scrollTop += r.top - g.top - 4
      else if (r.bottom > g.bottom) grid.scrollTop += r.bottom - g.bottom + 4
    }
    dock.dataset.last = now
  }

  // ---------- 图片 (the tree's Images node)
  //
  // The project's image folder in the tree (Spine): a PS export's folder, or the atlas pictures
  // grouped by the folders in their names. Subfolders unfold, a picture row drags onto a bone (a
  // new slot there), a slot (a new attachment) or the stage (a slot on root at the drop point).
  // 导入图片… / 导入文件夹… on the node bring new material into the folder (user: no folder to
  // set - "不用指定目录").

  let imgTree = { key: '', nodes: new Map(), pending: new Set() } // path → { dirs, files }, per image set

  /** The folder's content, from the cache; a miss loads it and redraws the tree when it is here. */
  function imagesListing(path) {
    const key = frameRootKey()
    if (imgTree.key !== key) imgTree = { key, nodes: new Map(), pending: new Set() }
    if (imgTree.nodes.has(path)) return imgTree.nodes.get(path)
    if (!imgTree.pending.has(path)) {
      imgTree.pending.add(path)
      ;(async () => {
        let node = imageFolder()
        for (const name of path.split('/').filter(Boolean)) {
          const l = await node.list()
          node = l.dirs.find((d) => d.name === name)
          if (!node) return { dirs: [], files: [] }
        }
        return node.list()
      })().then((l) => l, () => ({ dirs: [], files: [] })).then((l) => {
        if (imgTree.key !== key) return
        imgTree.nodes.set(path, l)
        imgTree.pending.delete(path)
        renderTree()
      })
    }
    return null
  }

  /** every picture an attachment shows (its path, else its name): the rest show dimmed */
  function imagesInUse() {
    const used = new Set()
    for (const sk of state.json.skins) for (const slot of Object.keys(sk.attachments)) for (const [name, a] of Object.entries(sk.attachments[slot])) {
      if (!a || a.type === 'boundingbox' || a.type === 'clipping' || a.type === 'path' || a.type === 'point') continue
      used.add(a.path || name)
    }
    return used
  }

  /** 导入图片… / 导入文件夹… of the 图片 node: into `here` (a folder path, '' = the root). */
  function importImagesInto(here, dir) {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true })
    if (dir) input.webkitdirectory = true
    input.onchange = async () => {
      const before = snapshot()
      try {
        const names = await importIntoFolder(input.files, here)
        if (!names.length) { status('没有可导入的图片（PNG / JPG / WebP）'); return }
        ensureAtlas()
        applyJson(state.json)
        state.history.push(before)
        state.future = []
        if (dir && names[0].includes('/')) state.imgOpen.add(names[0].split('/').slice(0, -1).join('/'))
        state.sections.delete('images')
        status(`已导入 ${names.length} 张图片到「${here || imageFolder().name}」`, 'ok')
        refresh()
      } catch (e) { restore(before); status('导入图片失败：' + e.message, 'error') }
    }
    input.click()
  }

  // a live folder (handle): re-listed every 2.5 s while the 图片 node is open; a change (a picture
  // dropped into the folder, a folder made) refreshes the tree and the frame cards
  let imgWatch = 0
  function watchImageFolder(on) {
    if (!on || !(state.imageFolder && state.imageFolder.live)) { if (imgWatch) { clearInterval(imgWatch); imgWatch = 0 } return }
    if (imgWatch) return
    const names = (l) => l.dirs.map((d) => 'd:' + d.name).concat(l.files.map((f) => 'f:' + f.name)).join('\n')
    imgWatch = setInterval(async () => {
      if (!state.json || !(state.imageFolder && state.imageFolder.live) || state.sections.has('images')) { watchImageFolder(false); return }
      try {
        for (const [path, cached] of [...imgTree.nodes]) {
          let node = state.imageFolder
          for (const seg of path.split('/').filter(Boolean)) { const l = await node.list(); node = l.dirs.find((d) => d.name === seg); if (!node) break }
          const fresh = node ? await node.list() : { dirs: [], files: [] }
          if (names(fresh) !== names(cached)) {
            state.imageFolderGen = (state.imageFolderGen || 0) + 1
            imgTree = { key: '', nodes: new Map(), pending: new Set() }
            renderTree(); renderLayerDock()
            return
          }
        }
      } catch { /* the folder went away: keep what is shown */ }
    }, 2500)
  }

  function renderImagesNode(rows, pad) {
    const closed = state.sections.has('images')
    watchImageFolder(!closed)
    const toggle = () => { state.sections.has('images') ? state.sections.delete('images') : state.sections.add('images'); renderTree() }
    const root = imagesListing('')
    const count = root ? root.files.length + (root.dirs.length ? ` + ${root.dirs.length} 夹` : '') : '…'
    rows.push(h('div', { class: 'row node', style: pad(1), onclick: toggle, title: '工程的图片文件夹：把图片拖到骨骼（新建插槽）、插槽（新建附件）或画板上（挂在 root，放在落点）' },
      caret(!closed, toggle), h('span', { class: 'ico', html: ICON.folder }), h('span', { class: 'label' }, '图片'),
      h('span', { class: 'end' },
        // one short button (two text buttons covered the row's name in a narrow tree): a menu picks 图片 / 文件夹
        h('button', { class: 'ld-btn tiny', title: '加新素材：图片或整个文件夹导进图片文件夹', onclick: (e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          mountMenu(h('div', { class: 'menu', id: 'menu', style: `left:${Math.round(Math.min(r.left, innerWidth - 170))}px;top:${Math.round(r.bottom + 4)}px` },
            h('button', { onclick: () => { closeMenu(); importImagesInto('', false) } }, '导入图片…'),
            h('button', { onclick: () => { closeMenu(); importImagesInto('', true) } }, '导入文件夹…（带子文件夹）')))
        } }, '导入…'),
        h('span', { class: 'cnt' }, String(count)))))
    if (closed) return
    const used = imagesInUse()
    const walk = (path, depth) => {
      const l = imagesListing(path)
      if (!l) { rows.push(h('div', { class: 'row', style: pad(depth) }, caret(null), h('span', { class: 'label dim' }, '读取中…'))); return }
      for (const d of l.dirs) {
        const open = state.imgOpen.has(d.path)
        const flip = () => { open ? state.imgOpen.delete(d.path) : state.imgOpen.add(d.path); renderTree() }
        rows.push(h('div', { class: 'row', style: pad(depth), onclick: flip, title: d.path },
          caret(open, flip), h('span', { class: 'ico', html: ICON.folder }), h('span', { class: 'label' }, d.name),
          h('span', { class: 'end' },
            h('button', { class: 'ld-btn tiny', title: '图片导进这个文件夹', onclick: (e) => { e.stopPropagation(); importImagesInto(d.path, false) } }, '导入'))))
        if (open) walk(d.path, depth + 1)
      }
      for (const f of l.files) {
        const name = f.rel.replace(/\.[^.]+$/, '')
        const row = h('div', { class: 'row', style: pad(depth), 'data-unused': used.has(name) ? null : '1', 'data-used': used.has(name) ? '1' : null, title: used.has(name) ? `${name}（工程里已用）` : `${name}（工程里还没用到：拖到骨骼 / 插槽 / 画板上）` },
          caret(null), h('span', { class: 'ico', html: ICON.region }), h('span', { class: 'label' }, f.name.replace(/\.[^.]+$/, '')))
        wireDrag(row, { type: 'image', name, rel: f.rel, file: f.file, region: f.region }, null)
        rows.push(row)
      }
      if (!l.dirs.length && !l.files.length) rows.push(h('div', { class: 'row', style: pad(depth) }, caret(null), h('span', { class: 'label dim' }, '（空）')))
    }
    walk('', 2)
  }

  /**
   * A picture into the project (Spine's drag from Images): `where.slot` = a new attachment shown by
   * that slot; `where.bone` = a new slot (named after the picture) on that bone, centred on it, or at
   * `where.world` (the stage drop point) in the bone's space.
   */
  /** 插槽 → 新建… → 图片…: a picture from the folder picker becomes a new attachment shown by the slot. */
  const addImageToSlot = (slot, image) => placeImage({ name: image }, { slot })

  async function placeImage(payload, where) {
    if (!state.json) return
    try { await bringFramesIn([payload]) } catch (e) { status(e.message, 'error'); return }
    const image = payload.name, short = image.split('/').pop()
    const size = regionSize(image) || { width: 1, height: 1 }
    const label = where.slot ? `已把 ${short} 放进插槽 ${where.slot}` : `已新建插槽 ${short}（挂在 ${where.bone}）`
    let madeSlot = where.slot || null
    edit(label, (j) => {
      let json = j, slot = where.slot
      if (!slot) {
        slot = uniqueSlotName(json, short)
        madeSlot = slot
        const r = Ops.addSlot(json, where.bone, slot); json = r.json
      }
      const sk = json.skins.find((x) => x.name === 'default')
      const have = sk && sk.attachments[slot] ? Object.entries(sk.attachments[slot]).find(([n, a]) => a && (a.path || n) === image && (!a.type || a.type === 'region')) : null
      if (have) return Ops.setSlotProps(json, slot, { attachment: have[0] })
      const o = { name: short, path: image, width: size.width, height: size.height }
      if (where.world) {
        // the drop point in the slot bone's setup space
        const bone = json.slots.find((x) => x.name === slot).bone
        const mt = setupMatrices()[bone]
        if (mt) {
          const det = mt.a * mt.d - mt.b * mt.c || 1
          const dx = where.world[0] - mt.worldX, dy = where.world[1] - mt.worldY
          o.x = (mt.d * dx - mt.b * dy) / det
          o.y = (-mt.c * dx + mt.a * dy) / det
        }
      }
      return Ops.addRegionAttachment(json, 'default', slot, o)
    }, (r) => { const name = r && r.attachment; if (name && madeSlot) { state.sel = { kind: 'att', skin: 'default', slot: madeSlot, name }; revealInTree(state.sel) } })
  }

  // ---------- 序列K帧 / 序列扫光 (动画工具): pictures as cards
  //
  // The cards hold pictures, not slots: the image folder's root by default (its pictures, no
  // subfolders); 从文件夹添加… opens the folder picker, and 添加所选 / 本文件夹全部 there puts those
  // pictures on the cards instead (user: 弹框选了子文件夹，点添加所选就是显示子文件夹里的东西).
  // The ticked cards are the frames, in order. 写入动画 reuses the slot that already shows a
  // picture, gives the others a new slot (named after the picture) on 骨骼, and keys them.

  let frameRoot = null // { key, files: [{ name, rel, file, region }] } the root folder's pictures
  let frameRootPending = null
  const frameThumbs = new Map() // name → 32 px canvas (a folder file decodes once)
  const frameRootKey = () => state.atlasText.length + '|' + (state.imageFolder ? 'folder' : 'atlas') + '|' + (state.imageFolderGen || 0)
  const frameUnticked = (kind) => state.frameUnticked[kind]

  /** the pictures on the cards: the picked set, else the root folder's (while it loads: none) */
  function framePictures() {
    if (state.frameSet) return state.frameSet
    const key = frameRootKey()
    if (frameRoot && frameRoot.key === key) return frameRoot.files
    if (!frameRootPending || frameRootPending.key !== key) {
      const p = { key }
      frameRootPending = p
      imageFolder().list().then((l) => l.files, () => []).then((files) => {
        if (frameRootPending !== p) return
        frameRootPending = null
        frameRoot = { key, files: files.map((f) => ({ name: f.rel.replace(/\.[^.]+$/, ''), rel: f.rel, file: f.file, region: f.region })) }
        renderLayerDock()
      })
    }
    return null
  }
  /** the pictures the tool writes: the ticked cards, in their order */
  const frameFiles = (kind) => (framePictures() || []).filter((f) => !frameUnticked(kind).has(f.name))

  function frameThumb(f) {
    const c = h('canvas', { width: 32, height: 32 })
    const region = f.region || (rt.atlas && rt.atlas.findRegion(f.name)) || null
    if (region) { drawRegionThumb(c, region); return c }
    const done = frameThumbs.get(f.name)
    if (done) { c.getContext('2d').drawImage(done, 0, 0); return c }
    if (typeof f.file !== 'function') return c
    f.file().then((file) => createImageBitmap(file)).then((bm) => {
      const k = Math.min(32 / bm.width, 32 / bm.height, 1)
      const keep = h('canvas', { width: 32, height: 32 })
      keep.getContext('2d').drawImage(bm, (32 - bm.width * k) / 2, (32 - bm.height * k) / 2, bm.width * k, bm.height * k)
      bm.close()
      frameThumbs.set(f.name, keep)
      c.getContext('2d').drawImage(keep, 0, 0)
    }).catch(() => {})
    return c
  }

  function renderFrameDock(dock, kind) {
    const keep = dock.querySelector('.ld-grid') ? dock.querySelector('.ld-grid').scrollTop : 0
    dock.textContent = ''
    const U = frameUnticked(kind)
    const pictures = framePictures()
    const files = pictures || [], ticked = files.filter((f) => !U.has(f.name))
    const bones = state.json.bones.map((b) => b.name)
    if (!bones.includes(state.frameBone)) state.frameBone = bones.includes('root') ? 'root' : bones[0] || ''
    const sel = h('select', { class: 'ld-sel', 'data-frame-bone': '1', title: '写入时勾选的图片挂到这根骨骼（已有插槽的位置不变，新图居中于骨骼）', onchange: (e) => { state.frameBone = e.target.value } },
      bones.map((b) => h('option', { value: b, selected: b === state.frameBone }, b)))
    const title = kind === 'sequence' ? '序列K帧：从图片文件夹挑图' : '序列扫光：从图片文件夹挑图'
    const head = [
      h('span', {}, `已选 ${ticked.length} / ${files.length}`),
      h('button', { class: 'tg', onclick: () => { for (const f of files) U.delete(f.name); renderLayerDock() } }, '全选'),
      h('button', { class: 'tg', title: '全部取消勾选', onclick: () => { for (const f of files) U.add(f.name); renderLayerDock() } }, '清空'),
      h('span', { class: 'ld-sep' }),
      h('label', { class: 'ld-f' }, '骨骼', sel),
      h('button', { class: 'tg', title: '在画面或工程树里点一根骨骼', onclick: () => startPick({ want: 'bone', text: '序列图片挂到哪根骨骼：点骨骼', done: (b) => { state.frameBone = b; renderLayerDock() } }) }, '点选'),
      h('button', { class: 'tg', title: '打开工程的图片文件夹：进子文件夹后「添加所选」或「本文件夹全部」，卡片就换成那些图片；文件夹里没有的图可以用「导入图片 / 导入文件夹」加进来', onclick: () => openImagePicker(title, (names) => { state.frameSet = names.map((n) => ({ name: n })); U.clear(); renderLayerDock() }, { multi: true }) }, '从文件夹添加…'),
      state.frameSet ? h('button', { class: 'tg', title: '卡片回到根目录的图片', onclick: () => { state.frameSet = null; U.clear(); renderLayerDock() } }, '根目录') : null,
      h('span', { class: 'ld-sep' }),
    ]
    if (kind === 'sequence') {
      const gap = h('input', { type: 'number', class: 'ld-num', min: 1, max: 600, step: 1, value: state.seqGap, title: '每张图停留几帧（1 = 逐帧）',
        onchange: (e) => { state.seqGap = Math.max(1, Math.min(600, Math.round(Number(e.target.value) || 1))); e.target.value = state.seqGap } })
      head.push(h('label', { class: 'ld-f' }, '间隔', gap, '帧'),
        h('button', { class: 'ld-go', title: '勾选的图片按顺序逐张显示：第 1 张在第 0 帧，之后每隔「间隔」帧换下一张；不循环，最后一张一直显示', onclick: writeSequence }, '写入动画'))
    } else {
      const from = h('input', { type: 'number', class: 'ld-num wide', min: 0, max: 18000, step: 1, value: state.sweepStart, title: '扫光从第几帧开始（之前全透明）',
        onchange: (e) => { state.sweepStart = Math.max(0, Math.min(18000, Math.round(Number(e.target.value) || 0))); e.target.value = state.sweepStart; renderLayerDock() } })
      const to = h('input', { type: 'number', class: 'ld-num wide', min: 1, max: 18000, step: 1, value: sweepEndFrame(ticked.length), title: '扫光到第几帧结束（之后全透明）；留空 = 动画的最后一帧',
        onchange: (e) => { const v = Math.round(Number(e.target.value) || 0); state.sweepEnd = v > 0 ? Math.min(18000, v) : 0; e.target.value = sweepEndFrame(ticked.length) } })
      head.push(h('label', { class: 'ld-f' }, '起', from, '止', to, '帧'),
        h('button', { class: 'ld-go', title: '勾一张图作底图：弹框选扫光方式，写入动画时生成切片并写入；勾的是自己准备的序列图（多张）：直接写入', onclick: openSweepGenerator }, '生成扫光'))
    }
    dock.append(h('div', { class: 'ld-hd' }, ...head, h('span', { class: 'sp' }),
      h('button', { class: 'xx', title: '关闭', onclick: () => { state.leftClosedByUser = kind; state.leftOpen = null; renderLeft(); refresh() } }, '×')))
    const grid = h('div', { class: 'ld-grid' })
    let order = 0
    for (const f of files) {
      const on = !U.has(f.name)
      const toggle = () => { if (U.has(f.name)) U.delete(f.name); else U.add(f.name); renderLayerDock() }
      grid.append(h('div', { class: 'ld-card', title: f.name, onclick: toggle },
        h('input', { type: 'checkbox', checked: on, title: '勾选 = 这张图是序列里的一帧（按顺序）', onclick: (e) => { e.stopPropagation(); toggle() } }),
        frameThumb(f), h('span', { class: 'ld-n' }, f.name.split('/').pop()), h('span', { class: 'ld-c' }, on ? `第 ${++order} 帧` : '')))
    }
    if (!pictures) grid.append(h('div', { class: 'hint' }, '读取图片文件夹…'))
    else if (!files.length) grid.append(h('div', { class: 'hint' }, kind === 'sweep' ? '根目录里没有图片：用「从文件夹添加…」挑图（勾一张作底图后「生成扫光…」，或勾自己准备的序列图直接写入）' : '根目录里没有图片：用「从文件夹添加…」挑图，或在弹框里「导入图片 / 导入文件夹」'))
    dock.append(grid)
    grid.scrollTop = keep
  }

  /** 序列扫光's last frame: the field's value, else the animation's last frame, else 5 frames a picture after 起. */
  function sweepEndFrame(n) {
    if (state.sweepEnd > 0) return state.sweepEnd
    const f = lastFrame()
    const wrap = !!(state.sweepGen && state.sweepGen.wrap)
    return f > state.sweepStart + 1 ? f : state.sweepStart + ((n || 1) + (wrap ? 0 : 1)) * 5
  }

  /** The slot whose setup attachment shows `image` (the picked skin first, then default). */
  function slotShowing(json, image) {
    const skins = [state.skin, 'default'].filter((v, i, a) => v && a.indexOf(v) === i).map((n) => json.skins.find((x) => x.name === n)).filter(Boolean)
    for (const sl of json.slots) {
      if (!sl.attachment) continue
      for (const sk of skins) {
        const a = sk.attachments[sl.name] && sk.attachments[sl.name][sl.attachment]
        if (a && (a.path || sl.attachment) === image) return sl.name
      }
    }
    return null
  }

  /** Pictures not in the project yet (root folder files) come into the atlas first (their own undo step, as the picker does). */
  async function bringFramesIn(files) {
    const fresh = files.filter((f) => typeof f.file === 'function' && !(rt.atlas && rt.atlas.findRegion(f.name)))
    if (!fresh.length) return
    const before = snapshot()
    try {
      for (const f of fresh) await addImageFile(await f.file(), f.name)
      ensureAtlas()
      applyJson(state.json)
      state.history.push(before)
      state.future = []
    } catch (e) { restore(before); throw new Error('导入图片失败：' + e.message) }
  }

  /**
   * Each picture → its slot and the attachment to show: the slot already showing it, else a new
   * slot (named after the picture) on 骨骼 with a region of the picture's size, centred on the bone.
   */
  function frameSlots(json, images, bone, place) {
    const out = []
    for (const image of images) {
      const existing = slotShowing(json, image)
      if (existing) { out.push({ slot: existing, name: json.slots.find((x) => x.name === existing).attachment }); continue }
      const slotName = uniqueSlotName(json, image.split('/').pop())
      let r = Ops.addSlot(json, bone, slotName); json = r.json
      const size = regionSize(image) || { width: 1, height: 1 }
      // `place`: the base picture's placement in this bone (生成的切片 sit exactly on the base)
      r = Ops.addRegionAttachment(json, 'default', slotName, { name: slotName, path: image, width: size.width, height: size.height, ...(place ? { x: place.x, y: place.y, rotation: place.rotation } : {}) }); json = r.json
      if (place) {
        const att = json.skins.find((x) => x.name === 'default').attachments[slotName][r.attachment || slotName]
        if (att && Math.abs(place.scaleX - 1) > 1e-4) att.scaleX = Math.round(place.scaleX * 10000) / 10000
        if (att && Math.abs(place.scaleY - 1) > 1e-4) att.scaleY = Math.round(place.scaleY * 10000) / 10000
      }
      out.push({ slot: slotName, name: slotName })
    }
    return { json, frames: out }
  }

  /**
   * Where the base picture sits in its slot's bone (the slices copy it; their centre is the picture's
   * centre): a region → its x / y / rotation / scale; a mesh → its vertices' bounds (in the bone for an
   * unweighted mesh, in the world — kept upright — for a weighted one), scale = bounds / picture size.
   */
  function baseAttachmentPlacement(json, slotName) {
    const sl = json.slots.find((x) => x.name === slotName)
    if (!sl || !sl.attachment) return null
    const skins = [state.skin, 'default'].filter((v, i, a) => v && a.indexOf(v) === i).map((n) => json.skins.find((x) => x.name === n)).filter(Boolean)
    let att = null
    for (const sk of skins) { const a = sk.attachments[sl.name] && sk.attachments[sl.name][sl.attachment]; if (a) { att = a; break } }
    if (!att) return null
    const type = att.type || 'region'
    if (type === 'region') return { x: att.x || 0, y: att.y || 0, rotation: att.rotation || 0, scaleX: att.scaleX == null ? 1 : att.scaleX, scaleY: att.scaleY == null ? 1 : att.scaleY }
    if (type !== 'mesh' && type !== 'linkedmesh') return null
    let mesh = att
    if (type === 'linkedmesh') {
      mesh = null
      for (const sk of json.skins) for (const atts of Object.values(sk.attachments)) { const p = atts[att.parent]; if (p && p.type === 'mesh') { mesh = p; break } }
      if (!mesh) return null
    }
    const w = att.width || mesh.width || 1, hh = att.height || mesh.height || 1
    const m = setupMatrices(), mt = m[sl.bone]
    const v = mesh.vertices || []
    if (!mt || !v.length) return null
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    const take = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    // the hull covers only part of the picture (its UV box): picture size / centre come from that box
    const uv = mesh.uvs || []
    let u0 = 1, u1 = 0, v0 = 1, v1 = 0
    for (let i = 0; i + 1 < uv.length; i += 2) { if (uv[i] < u0) u0 = uv[i]; if (uv[i] > u1) u1 = uv[i]; if (uv[i + 1] < v0) v0 = uv[i + 1]; if (uv[i + 1] > v1) v1 = uv[i + 1] }
    if (!(u1 > u0) || !(v1 > v0)) { u0 = 0; u1 = 1; v0 = 0; v1 = 1 }
    const fit = () => {   // scale so the hull's bounds match its UV box; centre of the whole picture (v runs down)
      const sx = (x1 - x0) / ((u1 - u0) * w), sy = (y1 - y0) / ((v1 - v0) * hh)
      return { cx: (x0 + x1) / 2 + (0.5 - (u0 + u1) / 2) * w * sx, cy: (y0 + y1) / 2 - (0.5 - (v0 + v1) / 2) * hh * sy, sx, sy }
    }
    if (!Ops.isWeighted(mesh)) {
      for (let i = 0; i + 1 < v.length; i += 2) take(v[i], v[i + 1])
      const f = fit()
      return { x: f.cx, y: f.cy, rotation: 0, scaleX: f.sx, scaleY: f.sy }
    }
    let i = 0
    while (i < v.length) {
      const n = v[i++]
      let x = 0, y = 0
      for (let k = 0; k < n; k++) { const b = json.bones[v[i]], bm = b && m[b.name]; if (bm) { const p = Ops.toWorld(bm, v[i + 1], v[i + 2]); x += p[0] * v[i + 3]; y += p[1] * v[i + 3] } i += 4 }
      take(x, y)
    }
    const f = fit()
    const c = Ops.toLocal(mt, f.cx, f.cy)
    const bsx = Math.hypot(mt.a, mt.c) || 1, bsy = Math.hypot(mt.b, mt.d) || 1
    return { x: c[0], y: c[1], rotation: -Math.atan2(mt.c, mt.a) * DEG, scaleX: f.sx / bsx, scaleY: f.sy / bsy }
  }

  /** The frames' slots move to 骨骼 (setup placement kept) before the keys go in. */
  function hangFrames(json, frames) {
    const bone = state.frameBone
    if (!bone || !json.bones.some((b) => b.name === bone)) return json
    const m = setupMatrices()
    let r = { json }
    for (const f of frames) { const sl = json.slots.find((x) => x.name === f.slot); if (sl && sl.bone !== bone) r = Ops.setSlotProps(r.json, f.slot, { bone }, m) }
    return r.json
  }

  /** The slot's own colour (RRGGBB) under the animated alpha keys. */
  const slotRgb = (json, slot) => { const s = json.slots.find((x) => x.name === slot); return String((s && s.color) || 'ffffffff').padEnd(8, 'f').slice(0, 6).toLowerCase() }

  /** the bone the frames hang on (the select's, else the first bone) */
  const frameBone = () => (state.frameBone && state.json.bones.some((b) => b.name === state.frameBone) ? state.frameBone : (state.json.bones[0] || {}).name)

  /**
   * 序列K帧 (Spine's frame-by-frame sequence): ONE slot holds every picture as an attachment and its
   * attachment keys switch them — picture i shows from frame i·gap, hiding the one before. No loop: the
   * last stays. The slot is the one already showing the first picture, else a new one named after it.
   */
  async function writeSequence() {
    if (!animOn()) { status('先选一个动画', 'error'); return }
    const files = frameFiles('sequence')
    if (files.length < 2) { status('先在卡片里勾选至少 2 张图片', 'error'); return }
    try { await bringFramesIn(files) } catch (e) { status(e.message, 'error'); return }
    const images = files.map((f) => f.name), bone = frameBone()
    const gap = Math.max(1, Math.round(state.seqGap || 1)), anim = state.anim
    const t4 = (t) => Math.round(t * 10000) / 10000
    // generated sweep slices as a sequence: placed on the base picture, above it, with the blend
    const gen = state.sweepGen && images.every((n) => state.sweepGen.names.includes(n)) ? state.sweepGen : null
    let made = null
    return edit(`序列K帧：${images.length} 张进一个插槽，每 ${gap} 帧一张，挂在 ${bone}（${anim}）`, (j) => {
      let json = j
      const first = images[0]
      const baseSlotObj = gen && gen.baseSlot ? json.slots.find((x) => x.name === gen.baseSlot) : null
      const place = baseSlotObj ? baseAttachmentPlacement(json, gen.baseSlot) : null
      let slot = slotShowing(json, first)
      if (!slot) {
        slot = uniqueSlotName(json, first.split('/').pop())
        json = Ops.addSlot(json, place ? baseSlotObj.bone : bone, slot).json
      }
      const skin = () => json.skins.find((x) => x.name === 'default')
      const names = []
      for (const image of images) {
        const atts = (skin() && skin().attachments[slot]) || {}
        // an attachment already showing this picture (a mesh too) is the frame; else a new region
        const have = Object.entries(atts).find(([n, a]) => a && (a.path || n) === image && a.type !== 'boundingbox' && a.type !== 'clipping' && a.type !== 'path' && a.type !== 'point')
        if (have) { names.push(have[0]); continue }
        const size = regionSize(image) || { width: 1, height: 1 }
        const r = Ops.addRegionAttachment(json, 'default', slot, { name: image.split('/').pop(), path: image, width: size.width, height: size.height, show: false, ...(place ? { x: place.x, y: place.y, rotation: place.rotation } : {}) })
        json = r.json
        const att = skin().attachments[slot][r.attachment]
        if (place && att) {
          if (Math.abs(place.scaleX - 1) > 1e-4) att.scaleX = Math.round(place.scaleX * 10000) / 10000
          if (Math.abs(place.scaleY - 1) > 1e-4) att.scaleY = Math.round(place.scaleY * 10000) / 10000
        }
        names.push(r.attachment)
      }
      json = Ops.setSlotProps(json, slot, { attachment: names[0] }).json
      json = Ops.prepare(hangFrames(json, [{ slot }]))
      if (gen) json = Ops.prepare(placeSweepSlots(json, [{ slot }], gen))
      const a = json.animations[anim]
      if (!a) throw new Error(`找不到动画：${anim}`)
      a.slots = a.slots || {}
      const row = { ...(a.slots[slot] || {}) }
      delete row.color   // a 序列扫光 written on this slot before left alpha keys (mostly 0)
      row.attachment = names.map((name, i) => ({ ...(i ? { time: t4((i * gap) / FPS) } : {}), name }))
      a.slots[slot] = row
      made = slot
      return { json: Ops.tidy(json) }
    }, () => { gotoFrame(0); if (made) { state.sel = { kind: 'slot', name: made }; revealInTree(state.sel) } })
  }

  /** 序列扫光: picture i goes 0 → 100 → 0 over 2 steps starting at i·step; step = 时长 / (N + 1). */
  async function writeSweep() {
    if (!animOn()) { status('先选一个动画', 'error'); return }
    const files = frameFiles('sweep')
    if (!files.length) { status('先在卡片里勾选图片', 'error'); return }
    try { await bringFramesIn(files) } catch (e) { status(e.message, 'error'); return }
    const images = files.map((f) => f.name), bone = frameBone()
    // slices the generator made: above the base slot, blend set, 绕一圈的 first/last joined
    const gen = state.sweepGen && images.every((n) => state.sweepGen.names.includes(n)) ? state.sweepGen : null
    const wrap = !!(gen && gen.wrap)
    const startFrame = Math.max(0, Math.round(state.sweepStart || 0)), endFrame = Math.max(startFrame + 2, sweepEndFrame(images.length))
    const start = startFrame / FPS, end = endFrame / FPS
    const step = (end - start) / (wrap ? images.length : images.length + 1), anim = state.anim, animEnd = lastFrame()
    const t4 = (t) => Math.round(t * 10000) / 10000
    const L = SweepLight()
    return edit(`序列扫光：${images.length} 张，第 ${startFrame} → ${endFrame} 帧，挂在 ${bone}（${anim}）`, (j) => {
      // generated slices: created on the base slot's bone with the base picture's placement, then
      // hangFrames moves them to the chosen bone (placement kept)
      const baseSlotObj = gen && gen.baseSlot ? j.slots.find((x) => x.name === gen.baseSlot) : null
      const place = baseSlotObj ? baseAttachmentPlacement(j, gen.baseSlot) : null
      const made = frameSlots(j, images, place ? baseSlotObj.bone : bone, place)
      const frames = made.frames
      let json = Ops.prepare(hangFrames(made.json, frames))
      if (gen) json = Ops.prepare(placeSweepSlots(json, frames, gen))
      const a = json.animations[anim]
      if (!a) throw new Error(`找不到动画：${anim}`)
      a.slots = a.slots || {}
      frames.forEach((f, i) => {
        const rgb = slotRgb(json, f.slot)
        const row = { ...(a.slots[f.slot] || {}) }
        delete row.attachment   // a 序列K帧 written on these slots before switched attachments on and off
        const at = (t, alpha) => ({ ...(t4(t) ? { time: t4(t) } : {}), color: rgb + (alpha ? 'ff' : '00') })
        // the curve inside [起, 止]; transparent before 起 and after 止
        let rel
        if (L && L.sweepAlphaKeys) rel = L.sweepAlphaKeys(i, frames.length, step, wrap)
        else { rel = [[0, 0]]; if (i > 0) rel.push([i * step, 0]); rel.push([(i + 1) * step, 1], [(i + 2) * step, 0]) }
        const keys = []
        if (start > 0) keys.push(at(0, 0))   // before 起: transparent (no key = the setup colour shows)
        for (const [t, alpha] of rel) keys.push(at(start + t, alpha))
        // a wrap set that ends before the animation does: off after 止 (ending with the animation keeps the loop seamless)
        if (rel[rel.length - 1][1] !== 0 && animEnd > endFrame) keys.push(at(end + 1 / FPS, 0))
        row.color = keys
        a.slots[f.slot] = row
      })
      return { json: Ops.tidy(json) }
    }, () => gotoFrame(0))
  }

  // ------------------------------------------------------------------ 序列扫光 生成器（底图 → 扫光切片）
  //
  // 序列扫光's cards are the one place to pick: tick one picture, 生成扫光… opens the panel（方案 /
  // 实时小预览 / 参数 / 挂到骨骼树）。生成的切片进图片文件夹 sweep/<底图名>/<方案>/，卡片换成它们并勾好；写入动画时插槽
  // 挂到选的骨骼、插到底图插槽的上一层、设叠加模式，绕一圈的方案首尾相接。
  // 算法在 sweep-light.core.js（页面里加载，Worker 里 importScripts 同一份）。

  const SweepLight = () => window.NovaFlowSweepLight
  const SWEEP_WORKER_SRC = `
let current = 0
self.onmessage = (e) => {
  const { id, rgba, w, h, params } = e.data || {}
  if (!rgba) return
  current = id
  const L = self.NovaFlowSweepLight
  const P = { ...L.DEFAULT_PARAMS, ...params }
  const n = Math.max(2, Math.min(240, Math.round(Number(P.frames) || 12)))
  let ctx
  try { ctx = L.analyzeBase(new Uint8ClampedArray(rgba), w, h, P) } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); return }
  const wrap = !!(L.SWEEP_SCHEMES.find((s) => s.id === P.scheme) || {}).wrap
  const frames = []
  for (let i = 0; i < n; i++) {
    if (current !== id) return
    frames.push(L.renderSweepFrame(ctx, wrap ? i / n : i / (n - 1), P))
    self.postMessage({ id, progress: i + 1, total: n })
  }
  self.postMessage({ id, done: true, w: ctx.W, h: ctx.H, pad: ctx.pad, frames: frames.map((f) => f.data.buffer) }, frames.map((f) => f.data.buffer))
}`
  let sweepWorker = null, sweepReq = 0
  const sweepPending = new Map()

  /** the core's URL as this page loaded it (hash-stamped inside the app) */
  function sweepCoreUrl() {
    const tag = [...document.querySelectorAll('script[src]')].find((s) => /(^|\/)sweep-light\.core\.js(\?|$)/.test(s.getAttribute('src') || ''))
    // the editor runs in a srcdoc iframe (location = about:srcdoc): resolve against the document's base URL
    return new URL(tag ? tag.getAttribute('src') : './sweep-light.core.js', document.baseURI).href
  }

  function sweepWorkerInstance() {
    if (sweepWorker) return sweepWorker
    const src = `importScripts(${JSON.stringify(sweepCoreUrl())});\n${SWEEP_WORKER_SRC}`
    sweepWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    sweepWorker.onmessage = (e) => {
      const m = e.data, r = sweepPending.get(m.id)
      if (!r) return
      if (m.error) { sweepPending.delete(m.id); r.reject(new Error(m.error)); return }
      if (m.progress) { if (r.onProgress) r.onProgress(m.progress, m.total); return }
      if (m.done) { sweepPending.delete(m.id); r.resolve({ w: m.w, h: m.h, pad: m.pad, frames: m.frames.map((buf) => new Uint8ClampedArray(buf)) }) }
    }
    sweepWorker.onerror = (e) => { for (const [id, r] of sweepPending) { sweepPending.delete(id); r.reject(new Error(e.message || 'Worker 出错')) } }
    return sweepWorker
  }

  /** frames out of the worker; a preview request is dropped when a newer one comes */
  function sweepGenerate(rgba, w, h, params, onProgress, preview) {
    const id = ++sweepReq
    for (const [k, v] of sweepPending) if (v.preview) { sweepPending.delete(k); v.reject(new Error('superseded')) }
    return new Promise((resolve, reject) => {
      sweepPending.set(id, { resolve, reject, onProgress, preview: !!preview })
      const copy = new Uint8ClampedArray(rgba)
      sweepWorkerInstance().postMessage({ id, rgba: copy.buffer, w, h, params }, [copy.buffer])
    })
  }

  /** the picture's own pixels at its original size */
  function basePixels(image) {
    const region = rt.atlas && rt.atlas.findRegion(image)
    if (!region) return null
    const w = region.originalWidth || region.width, h = region.originalHeight || region.height
    const rgba = regionPixels(region, w, h)
    return rgba ? { rgba, w, h } : null
  }

  /** every slot whose setup attachment shows `image` (draw order), with its bone */
  function slotsShowingAll(json, image) {
    const skins = [state.skin, 'default'].filter((v, i, a) => v && a.indexOf(v) === i).map((n) => json.skins.find((x) => x.name === n)).filter(Boolean)
    const out = []
    json.slots.forEach((sl, index) => {
      if (!sl.attachment) return
      for (const sk of skins) {
        const a = sk.attachments[sl.name] && sk.attachments[sl.name][sl.attachment]
        if (a && (a.path || sl.attachment) === image) { out.push({ name: sl.name, bone: sl.bone, index }); return }
      }
    })
    return out
  }

  /**
   * 生成扫光… (the cards' one button): one ticked card = the base → the panel (its 写入动画 generates
   * the slices and writes them); several ticked = a hand-made sequence → written as it is.
   */
  async function openSweepGenerator() {
    if (!state.json) return
    const files = frameFiles('sweep')
    if (!files.length) { status('先在卡片里勾一张图作底图（勾多张 = 自己准备的序列图，直接写入）', 'error'); return }
    if (files.length > 1) { writeSweep(); return }
    if (!animOn()) { status('先选一个动画', 'error'); return }
    try { await bringFramesIn(files) } catch (e) { status(e.message, 'error'); return }
    openSweepPanel(files[0].name)
  }

  /**
   * Where the slices go: folder sweep/<底图名>/<方案>, files <底图名>_<方案>_01.png … (the slot names);
   * a second run of the same scheme gets a number on the scheme.
   */
  function sweepFolderFor(image, scheme) {
    const stem = image.split('/').pop()
    // beside the base picture (a project keeping its pictures in img/ gets img/sweep/…, not a second root)
    const dir = image.includes('/') ? image.slice(0, image.lastIndexOf('/') + 1) : ''
    const taken = (n) => !!(rt.atlas && rt.atlas.findRegion(n))
    let k = 1
    while (taken(`${dir}sweep/${stem}/${scheme}${k > 1 ? k : ''}/${stem}_${scheme}${k > 1 ? k : ''}_01`)) k++
    const tag = scheme + (k > 1 ? k : '')
    return { folder: `${dir}sweep/${stem}/${tag}`, prefix: `${stem}_${tag.replace(/-/g, '')}` }
  }

  const SWEEP_PARAM_DEFS = [
    { key: 'angle', label: '角度', min: -180, max: 180, step: 1 },
    { key: 'width', label: '宽度', min: 0.4, max: 2.5, step: 0.05 },
    { key: 'intensity', label: '强度', min: 0.2, max: 2, step: 0.05 },
    { key: 'glow', label: '光晕', min: 0.3, max: 2.5, step: 0.05 },
    { key: 'rayLength', label: '放射长度', min: 0.3, max: 2.5, step: 0.05, only: 'rays' },
  ]
  const SWEEP_BLEND_OP = { add: 'lighter', screen: 'screen', normal: 'source-over' }

  /** 第二步：方案 / 预览 / 参数 / 挂到骨骼树 → 生成 */
  function openSweepPanel(image) {
    const L = SweepLight()
    if (!L) { status('扫光生成器没有加载（sweep-light.core.js）', 'error'); return }
    const px = basePixels(image)
    if (!px) { status(`读不到图片「${image}」的像素`, 'error'); return }
    const schemeOf = (id) => L.SWEEP_SCHEMES.find((s) => s.id === id) || L.SWEEP_SCHEMES[0]
    if (!state.sweepParams) { state.sweepParams = { ...L.DEFAULT_PARAMS }; state.sweepParams.frames = schemeOf(state.sweepParams.scheme).frames || state.sweepParams.frames }
    const P = state.sweepParams
    const bind = { bone: '', slot: '' }
    const stem = image.split('/').pop()
    // the picked bone is the default (the base slot's bone when none is picked or it is that one)
    const pickedBone = state.sel && state.sel.kind === 'bone' ? state.sel.name : (state.multi && state.multi[0]) || ''
    let preview = null, timer = 0, previewTimer = 0, previewBusy = false, previewAgain = false, clock = 0, last = performance.now()

    const close = () => { clearInterval(timer); clearTimeout(previewTimer); preview = null; mask.remove() }
    const showing = () => slotsShowingAll(state.json, image)
    const baseSlot = () => { const list = showing(); if (!list.length) return null; return list.find((s) => s.name === bind.slot) || list.find((s) => state.sel && (state.sel.name === s.name || state.sel.slot === s.name)) || list[list.length - 1] }
    { const bs0 = baseSlot(); const baseBone0 = bs0 ? bs0.bone : 'root'; if (pickedBone && pickedBone !== baseBone0 && state.json.bones.some((b) => b.name === pickedBone)) bind.bone = pickedBone }

    // preview: a small copy of the picture, 10 frames, replayed like 写入动画
    const pvCanvas = h('canvas', { width: 2, height: 2 }), pvTag = h('span', { class: 'tag' }), pvBar = h('i')
    const pv = h('div', { class: 'sw-pv' }, pvCanvas, pvTag, h('span', { class: 'note' }, '预览是缩小版，生成按原图尺寸'), h('div', { class: 'bar' }, pvBar))
    const drawPreview = () => {
      if (!preview) return
      const g = pvCanvas.getContext('2d'), n = preview.frames.length, wrap = preview.wrap
      const total = ((wrap ? n : n + 1) * 5) / FPS, step = total / (wrap ? n : n + 1), t = clock % total
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1
      g.clearRect(0, 0, pvCanvas.width, pvCanvas.height)
      if (preview.blend !== 'normal') g.drawImage(preview.base, preview.pad, preview.pad)
      g.globalCompositeOperation = SWEEP_BLEND_OP[preview.blend] || 'lighter'
      preview.frames.forEach((f, i) => { const a = L.sweepAlphaAt(i, n, t, step, wrap); if (a > 0.002) { g.globalAlpha = a; g.drawImage(f, 0, 0) } })
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'
    }
    timer = setInterval(() => { const now = performance.now(); clock += (now - last) / 1000; last = now; drawPreview() }, 1000 / 60)
    const toCanvas = (rgba, w, hh) => { const c = h('canvas', { width: w, height: hh }); c.getContext('2d').putImageData(new ImageData(rgba, w, hh), 0, 0); return c }
    const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(runPreview, 220) }
    async function runPreview() {
      if (!document.body.contains(mask)) return
      if (previewBusy) { previewAgain = true; return }
      previewBusy = true
      try {
        const s = Math.min(1, 300 / Math.max(px.w, px.h))
        const w = Math.max(2, Math.round(px.w * s)), hh = Math.max(2, Math.round(px.h * s))
        const full = h('canvas', { width: px.w, height: px.h }); full.getContext('2d').putImageData(new ImageData(px.rgba, px.w, px.h), 0, 0)
        const small = h('canvas', { width: w, height: hh }); small.getContext('2d').drawImage(full, 0, 0, w, hh)
        const data = small.getContext('2d').getImageData(0, 0, w, hh).data
        const Q = { ...P, frames: 10, pad: P.pad ? Math.round(P.pad * s) : 0 }
        pvTag.textContent = `${schemeOf(P.scheme).label} · 预览中…`
        const r = await sweepGenerate(data, w, hh, Q, (i, n) => { pvBar.style.width = `${(i / n) * 100}%` }, true)
        if (!document.body.contains(mask)) return
        pvCanvas.width = r.w; pvCanvas.height = r.h
        preview = { base: small, pad: r.pad, blend: P.blend, wrap: !!schemeOf(P.scheme).wrap, frames: r.frames.map((d) => toCanvas(d, r.w, r.h)) }
        pvTag.textContent = `${schemeOf(P.scheme).label} · ${(L.BLEND_MODES.find((b) => b.id === P.blend) || {}).label || ''}`
        pvBar.style.width = '0'
      } catch (e) {
        if (String(e.message) !== 'superseded') setStatus(e.message, true)
      } finally {
        previewBusy = false
        if (previewAgain) { previewAgain = false; runPreview() }
      }
    }

    // left: the schemes
    const types = h('div', { class: 'sw-types' })
    const buildTypes = () => {
      types.textContent = ''
      let g = null
      for (const s of L.SWEEP_SCHEMES) {
        if (s.group !== g) { g = s.group; types.append(h('div', { class: 'g' }, g)) }
        types.append(h('button', { class: 'ty', title: s.hint, 'aria-pressed': String(s.id === P.scheme), onclick: () => {
          P.scheme = s.id
          if (s.colorMode) { P.colorMode = s.colorMode; P.color = s.color }
          P.frames = s.frames || L.DEFAULT_PARAMS.frames
          buildTypes(); buildParams(); schedulePreview()
        } }, s.label))
      }
    }

    // right: the parameters
    const params = h('div', { class: 'sw-params' })
    const seg = (options, value, onPick) => h('div', { class: 'sw-seg' }, options.map((o) => h('button', { 'aria-pressed': String(o.id === value), onclick: () => { onPick(o.id); buildParams(); schedulePreview() } }, o.label)))
    const row = (label, ...ctl) => { const r = h('div', { class: 'sw-p' }, h('label', {}, label), ...ctl); params.append(r); return r }
    const buildParams = () => {
      params.textContent = ''
      for (const d of SWEEP_PARAM_DEFS) {
        if (d.only && d.only !== P.scheme) continue
        const range = h('input', { type: 'range', min: d.min, max: d.max, step: d.step, value: P[d.key] })
        const num = h('input', { type: 'number', min: d.min, max: d.max, step: d.step, value: P[d.key] })
        range.oninput = () => { P[d.key] = Number(range.value); num.value = range.value; if (d.key === 'width') buildParams(); schedulePreview() }
        num.onchange = () => { P[d.key] = Math.max(d.min, Math.min(d.max, Number(num.value) || d.min)); range.value = P[d.key]; num.value = P[d.key]; buildParams(); schedulePreview() }
        const r = row(d.label, range, num)
        if (d.key === 'angle') { r.append(h('div', { class: 'sw-tip' }, schemeOf(P.scheme).radial ? '径向类：起始位置' : '光带的前进方向')) }
      }
      const colorRow = h('div', { class: 'sw-seg' })
      colorRow.append(...seg([{ id: 'base', label: '底图色' }, { id: 'white', label: '白光' }, { id: 'custom', label: '自定义' }], P.colorMode, (v) => { P.colorMode = v }).children)
      if (P.colorMode === 'custom') { const c = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(P.color) ? P.color : '#ffffff' }); c.oninput = () => { P.color = c.value; schedulePreview() }; colorRow.append(c) }
      row('光色', colorRow)
      row('叠加模式', seg(L.BLEND_MODES, P.blend, (v) => { P.blend = v }))
      const ew = L.effectiveWidth(P)
      const fn = h('input', { type: 'number', min: 2, max: 120, step: 1, value: P.frames })
      fn.onchange = () => { P.frames = Math.max(2, Math.min(120, Math.round(Number(fn.value) || 12))); fn.value = P.frames; buildParams(); schedulePreview() }
      const widened = ew.floor > 1.1 * Math.max(0.2, Number(P.width) || 1)   // a few percent of widening is not worth a warning
      row('帧数', fn, h('span', { class: 'sw-inl', style: widened ? 'color:#e0b45a' : '' }, widened ? `少于 ${L.minFrames(P)} 帧会一步一闪：光带已自动加宽到 ${ew.floor.toFixed(2)}` : '生成多少张切片；多一些扫得更顺')).classList.add('num')
      const pn = h('input', { type: 'number', min: 0, max: 400, step: 1, value: P.pad })
      pn.onchange = () => { P.pad = Math.max(0, Math.min(400, Math.round(Number(pn.value) || 0))); pn.value = P.pad; schedulePreview() }
      row('边距', pn, h('span', { class: 'sw-inl' }, '切片四周留给光晕的像素，0 = 自动')).classList.add('num')
      // 挂到骨骼树
      params.append(h('div', { class: 'sw-sep' }))
      const list = showing(), bs = baseSlot()
      if (list.length > 1) {
        const sSel = h('select', { onchange: (e) => { bind.slot = e.target.value; buildParams() } },
          list.map((s) => h('option', { value: s.name, selected: bs && s.name === bs.name, title: `骨骼 ${s.bone} · 第 ${s.index + 1} 层` }, s.name)))
        row('底图插槽', sSel)
        params.append(h('div', { class: 'sw-wide' }, `这张图放了 ${list.length} 处，选哪一处当底图`))
      }
      const baseBone = bs ? bs.bone : 'root'
      const bones = state.json.bones.map((b) => b.name)
      const boneSel = h('select', { onchange: (e) => { bind.bone = e.target.value } },
        h('option', { value: '', selected: !bind.bone }, bs ? `${baseBone}（底图所在）` : (bones.includes('root') ? 'root' : bones[0] || '')),
        bones.filter((b) => b !== baseBone && (bs || b !== 'root')).map((b) => h('option', { value: b, selected: bind.bone === b }, b)))
      row('骨骼', boneSel)
      if (!bs) params.append(h('div', { class: 'sw-wide warn' }, '这张图还没放进骨骼：切片会挂到 root、画在最上层。'))
      params.append(h('div', { class: 'sw-wide' }, '写入动画时：切片插槽挂到这根骨骼、居中对齐底图、画在底图上一层，叠加模式一并设到插槽上。'))
    }

    const st = h('span', { class: 'st' })
    const setStatus = (msg, err) => { st.textContent = msg || ''; st.classList.toggle('err', !!err) }
    const go = h('button', { class: 'btn primary', title: '生成切片进图片文件夹，并按卡片栏的起止帧写入当前动画', onclick: () => generate() }, '写入动画')
    async function generate() {
      go.disabled = true; setStatus('')
      const t0 = performance.now()
      try {
        if (!animOn()) throw new Error('先在工程树里选一个动画（设置模式下不能写入）')
        const Q = { ...P }
        const scheme = schemeOf(Q.scheme)
        const r = await sweepGenerate(px.rgba, px.w, px.h, Q, (i, n) => setStatus(`生成中 ${i}/${n}`))
        if (!document.body.contains(mask)) return
        setStatus('写入图片文件夹…')
        const { folder, prefix } = sweepFolderFor(image, scheme.id)
        const files = []
        for (let i = 0; i < r.frames.length; i++) {
          const c = toCanvas(r.frames[i], r.w, r.h)
          const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 编码失败'))), 'image/png'))
          files.push(new File([blob], `${prefix}_${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' }))
        }
        const bs = baseSlot()
        const bone = bind.bone || (bs ? bs.bone : (state.json.bones.some((b) => b.name === 'root') ? 'root' : (state.json.bones[0] || {}).name))
        const before = snapshot()
        let names
        try {
          names = await importIntoFolder(files, folder)
          ensureAtlas()
          applyJson(state.json)
          state.history.push(before)
          state.future = []
        } catch (e) { restore(before); throw new Error('切片进图片文件夹失败：' + e.message) }
        // the cards: the slices, all ticked; 写入动画 then hangs them on the bone above the base
        state.frameSet = names.map((n) => ({ name: n }))
        frameUnticked('sweep').clear()
        state.frameBone = bone
        state.sweepGen = { base: image, baseSlot: bs ? bs.name : null, bone, blend: Q.blend, wrap: !!scheme.wrap, names: names.slice() }
        state.leftOpen = 'sweep'
        // straight into the animation (user: one button); the cards keep the slices for a re-write.
        // A failed write keeps the dialog open with the reason (the toast alone was missed).
        setStatus('写入动画…')
        const written = await writeSweep()
        if (!written) throw new Error(`切片已进「${folder}」并勾在卡片里，但写入动画失败：${$('#toast').textContent || '未知原因'}`)
        close()
        refresh()
        status(`已生成 ${names.length} 张扫光切片到「${folder}」并写入动画（${((performance.now() - t0) / 1000).toFixed(1)} s）`, 'ok')
      } catch (e) {
        setStatus(e.message, true)
      } finally { go.disabled = false }
    }

    const mask = h('div', { class: 'mask', onclick: (e) => { if (e.target === mask) close() } },
      h('div', { class: 'dialog sw' },
        h('div', { class: 'hd' }, h('b', {}, `序列扫光 · ${stem}`), h('button', { class: 'xx', onclick: close }, '×')),
        h('div', { class: 'sw-body' }, types, h('div', { class: 'sw-right' }, pv, params)),
        h('div', { class: 'sw-ft' }, st, go)))
    document.body.append(mask)
    buildTypes(); buildParams(); schedulePreview()
  }

  /** the generated slices' slots: drawn right above the base slot (or last), the blend set */
  function placeSweepSlots(json, frames, gen) {
    const blend = gen.blend === 'add' ? 'additive' : gen.blend === 'screen' ? 'screen' : 'normal'
    const mine = new Set(frames.map((f) => f.slot))
    const rest = json.slots.map((s) => s.name).filter((n) => !mine.has(n))
    const at = gen.baseSlot ? rest.indexOf(gen.baseSlot) : -1
    const order = at >= 0 ? [...rest.slice(0, at + 1), ...frames.map((f) => f.slot), ...rest.slice(at + 1)] : [...rest, ...frames.map((f) => f.slot)]
    let r = Ops.reorderSlots(json, order)
    for (const f of frames) r = Ops.setSlotProps(r.json, f.slot, { blend })
    return r.json
  }

  // ---------- 骨骼

  function pairOf(bones) {
    if (bones.length !== 2) return null
    if (bone(bones[1]).parent === bones[0]) return [bones[0], bones[1]]
    if (bone(bones[0]).parent === bones[1]) return [bones[1], bones[0]]
    return null
  }

  /** 设置父级 (P): bone → pick a bone, slot → pick a bone, image → pick a slot. */
  function setParentForSelection() {
    const s = state.sel
    if (!s) return
    if (s.kind === 'bone' && bone(s.name).parent) setParent(s.name)
    else if (s.kind === 'slot' && state.multiSlots.length > 1) {
      const names = state.multiSlots.slice()
      startPick({ want: 'bone', text: `${names.length} 个插槽挂到哪根骨骼：点骨骼`, done: (b) => { const m = setupMatrices(); edit(`已把 ${names.length} 个插槽挂到 ${b}`, (j) => names.reduce((r, n) => Ops.setSlotProps(r.json, n, { bone: b }, m), { json: j })) } })
    } else if (s.kind === 'slot') startPick({ want: 'bone', text: `插槽「${s.name}」挂到哪根骨骼：点骨骼`, done: (b) => setSlotBone(s.name, b) })
    else if (s.kind === 'att' && !Ops.isPlaceholder(state.json, s.slot, s.name)) transferAtt(s, true)
  }

  function boneBody() {
    const bones = selectedBones()
    if (!bones.length) return [h('div', { class: 'hint' }, '在画面或工程树里点骨骼；Ctrl 加选，Ctrl+拖动框选。')]
    if (bones.length > 1) {
      const pair = pairOf(bones)
      return [
        grp(`已选 ${bones.length} 根骨骼`, null, h('div', { class: 'list' }, bones.map((b) => h('div', { class: 'li', onclick: () => select({ kind: 'bone', name: b }) },
          h('span', { class: 'n' }, b),
          h('button', { class: 'x', title: '取消选择', onclick: (e) => { e.stopPropagation(); select({ kind: 'bone', name: b }, true) } }, '×'))))),
        h('div', { class: 'btns' }, menuButton('新建…', [
          { label: 'IK 约束', icon: 'ik', run: () => newIk(pair), disabled: !pair, title: pair ? '' : '需要一对父子骨骼' },
          { label: '变换约束', icon: 'transform', run: () => newTransform(bones) },
        ])),
      ]
    }
    const name = bones[0]
    const b = bone(name)
    const setup = state.mode === 'setup'
    const role = state.roles.get(name) || 'normal'
    const parent = b.parent
    const out = []
    out.push(h('div', { class: 'name-row' },
      textInput(name, (v) => edit(`已改名 ${name} → ${v}`, (j) => Ops.renameBone(j, name, v), (r) => { state.sel = { kind: 'bone', name: r.bone }; state.multi = [r.bone] }), { rename: true }),
      h('span', { class: 'tag ' + role }, { normal: '普通', cons: '受约束', ctrl: '控制骨' }[role]),
      ibtn('copy', '复制（Ctrl+D）', duplicateSelection, !parent),
      ibtn('trash', '删除（Delete）', deleteSelection, !parent)))
    const [ir, is, iff] = INHERIT[b.transform || 'normal'] || INHERIT.normal
    const setInherit = (r, s, f) => edit(`已修改 ${name} 继承`, (j) => Ops.setBoneProps(j, name, { transform: inheritMode(r, s, f) }))
    out.push(field('长度', numInput(b.length || 0, (v) => edit(`已修改 ${name}`, (j) => Ops.setBoneProps(j, name, { length: v })), { disabled: !setup })))
    // Spine bone properties: colour, always show the name, selectable in the viewport
    const colIn = h('input', { type: 'color', value: '#' + String(b.color || '989898ff').slice(0, 6) })
    colIn.addEventListener('change', () => edit(`已修改 ${name} 颜色`, (j) => Ops.setBoneProps(j, name, { color: colIn.value.slice(1) + 'ff' })))
    out.push(field('颜色', h('div', { class: 'cols3' }, colIn,
      check('名称', state.alwaysName.has(name), (v) => { v ? state.alwaysName.add(name) : state.alwaysName.delete(name) }, { title: '画面里一直显示名字' }),
      check('可选', !state.unselectable.has(name), (v) => { v ? state.unselectable.delete(name) : state.unselectable.add(name) }, { title: '取消后画面里点不到（工程树里还能选）' }))))
    out.push(field('继承', h('div', { class: 'cols3' },
      check('旋转', ir, (v) => setInherit(v, is, iff), { disabled: !setup }),
      check('缩放', is, (v) => setInherit(ir, v, iff), { disabled: !setup }),
      check('翻转', iff, (v) => setInherit(ir, is, v), { disabled: !setup || (ir && is), title: '旋转、缩放都继承时翻转跟着继承' }))))
    out.push(h('div', { class: 'btns g2' },
      menuButton('新建…', [
        { label: '骨骼', icon: 'bone', run: () => newChildBone(name) },
        { label: '插槽', icon: 'slot', run: () => newSlot(name) },
        { label: '剪裁', icon: 'clip', run: () => newClipping(null, name), disabled: state.mode !== 'setup', title: '在这根骨骼上新建一个插槽，里面放剪裁（遮罩）' },
        { label: 'IK 约束', icon: 'ik', run: () => newIk([name]), disabled: !parent, title: '这一根骨骼；两根请 Ctrl 选父子两根' },
        { label: '变换约束', icon: 'transform', run: () => newTransform([name]), disabled: !parent },
      ]),
      btn('设置父级', () => setParent(name), { disabled: !parent, title: 'P' })))
    if (state.skin !== 'default' && parent) {
      const sk = skinOf(state.skin)
      const inSkin = !!(sk && Array.isArray(sk.bones) && sk.bones.includes(name))
      out.push(h('div', { class: 'btns' }, btn(inSkin ? `从皮肤「${state.skin}」移除` : `加入皮肤「${state.skin}」`,
        () => edit(`已${inSkin ? '移出' : '加入'}皮肤 ${state.skin}`, (j) => Ops.setSkinMembership(j, state.skin, 'bones', name, !inSkin)), { full: true, title: 'Spine「加入皮肤」：只在这个皮肤里生效' })))
    }
    return out
  }

  // ---------- 插槽与图片

  function slotBody() {
    // an image / a placeholder shows only its own properties (Spine); the slot's are one click up in the tree
    const sel0 = state.sel
    if (sel0 && sel0.kind === 'att' && skinOf(sel0.skin) && (skinOf(sel0.skin).attachments[sel0.slot] || {})[sel0.name]) return attPanel(sel0)
    if (sel0 && sel0.kind === 'ph' && Ops.placeholderList(state.json, sel0.slot).some((p) => p.name === sel0.name)) return placeholderPanel(sel0)
    const name = currentSlot()
    if (!name || !slotOf(name)) return [h('div', { class: 'hint' }, '在画面上点图片，或在工程树里点插槽。')]
    const s = slotOf(name)
    const out = []
    out.push(h('div', { class: 'name-row' },
      textInput(name, (v) => edit(`已改名 ${name} → ${v}`, (j) => Ops.renameSlot(j, name, v), (r) => { state.sel = { kind: 'slot', name: r.slot } }), { rename: state.sel && state.sel.kind === 'slot' }),
      ibtn('copy', '复制插槽（Ctrl+D）', () => { state.sel = { kind: 'slot', name }; duplicateSelection() }),
      ibtn('trash', '删除插槽', () => { state.sel = { kind: 'slot', name }; deleteSelection() })))
    // colour: setup value in 设置, a colour key in 动画
    const live = rt.skeleton && rt.skeleton.findSlot(name)
    const cur = animOn() && live
      ? { rgb: '#' + [live.color.r, live.color.g, live.color.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), a: live.color.a }
      : colorParts(s.color)
    const colorIn = h('input', { type: 'color', value: cur.rgb })
    const alphaIn = h('input', { type: 'number', min: 0, max: 100, step: 1, value: Math.round(cur.a * 100), style: 'width:52px;height:26px;border:0;border-radius:6px;background:#262626;color:#fff;padding:0 6px' })
    const commitColor = () => {
      const a = Math.max(0, Math.min(100, Number(alphaIn.value) || 0))
      const hex = colorIn.value.slice(1) + Math.round(a / 100 * 255).toString(16).padStart(2, '0')
      if (animOn()) edit(`已在第 ${state.frame} 帧给「${name}」打颜色帧`, (j) => Ops.keyColor(j, state.anim, name, timeSec(), hex))
      else edit(`已修改 ${name} 颜色`, (j) => Ops.setSlotProps(j, name, { color: hex }))
    }
    colorIn.addEventListener('change', commitColor)
    alphaIn.addEventListener('change', commitColor)
    // Spine: 填入黑色 = tint black (a second, dark colour)
    const darkIn = h('input', { type: 'color', value: '#' + (s.dark || '000000'), disabled: !s.dark })
    darkIn.addEventListener('change', () => edit(`已修改 ${name} 填入黑色`, (j) => Ops.setSlotProps(j, name, { dark: darkIn.value.slice(1) })))
    out.push(field('颜色', h('div', { class: 'inline' }, colorIn, h('span', { style: 'flex:0 0 auto;color:#9a9a9a;font-size:11px' }, '不透明'), alphaIn,
      keyBtn([['slots', name, 'color']], () => keySlotNow(name, ['color']), '给颜色打关键帧'))))
    out.push(field('填入黑色', h('div', { class: 'inline' },
      h('label', { class: 'checks', style: 'margin:0' }, check('', !!s.dark, (v) => edit(`已${v ? '开启' : '关闭'} ${name} 填入黑色`, (j) => Ops.setSlotProps(j, name, { dark: v ? '000000' : '' })))), darkIn)))
    out.push(field('混合', selectInput([['normal', '正常'], ['additive', '相加'], ['multiply', '正片叠底'], ['screen', '滤色']], s.blend || 'normal',
      (v) => edit(`已修改 ${name} 混合`, (j) => Ops.setSlotProps(j, name, { blend: v })))))

    out.push(h('div', { class: 'btns g2' },
      menuButton('新建…', [
        { label: '图片…', icon: 'region', run: () => openImagePicker(`添加到插槽「${name}」`, (r) => addImageToSlot(name, r)) },
        { label: '皮肤占位符', icon: 'placeholder', run: () => edit((r) => `已新建皮肤占位符 ${r.placeholder}`, (j) => Ops.addPlaceholder(j, name),
          (r) => { state.sel = { kind: 'ph', name: r.placeholder, slot: name }; state.collapsed.delete('s:' + name); revealInTree(state.sel) }) },
        { label: '剪裁', icon: 'clip', run: () => newClipping(name), disabled: state.mode !== 'setup', title: '遮罩：画一个多边形，剪掉它后面绘制的插槽（到「结束插槽」为止）' },
      ]),
      btn('设置父级', () => { state.sel = { kind: 'slot', name }; setParentForSelection() }, { title: 'P' })))
    return out
  }

  /**
   * Several layers at once (Spine): colour / opacity, 填入黑色, 混合, 设置父级 and 删除 go to all of
   * them; in an animation the colour is keyed on every one. A value they do not share shows empty.
   */
  function multiSlotBody() {
    const names = state.multiSlots.filter((n) => slotOf(n))
    const slots = names.map(slotOf)
    const out = []
    const same = (f) => { const v = slots.map(f); return v.every((x) => x === v[0]) ? v[0] : null }
    out.push(h('div', { class: 'name-row' },
      h('span', { class: 'nm' }, `${names.length} 个插槽`),
      ibtn('trash', `删除这 ${names.length} 个插槽`, deleteSelection)))
    const col = same((sl) => (animOn() ? (() => { const l = rt.skeleton.findSlot(sl.name); return l ? [l.color.r, l.color.g, l.color.b, l.color.a].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : 'ffffffff' })() : String(sl.color || 'ffffffff')).toLowerCase())
    const parts = col ? colorParts(col) : { rgb: '#ffffff', a: 1 }
    const colorIn = h('input', { type: 'color', value: parts.rgb })
    const alphaIn = h('input', { type: 'number', min: 0, max: 100, step: 1, value: col ? Math.round(parts.a * 100) : '', placeholder: '—', style: 'width:52px;height:26px;border:0;border-radius:6px;background:#262626;color:#fff;padding:0 6px' })
    const commitColor = () => {
      const a = Math.max(0, Math.min(100, alphaIn.value === '' ? Math.round(parts.a * 100) : Number(alphaIn.value) || 0))
      const hex = colorIn.value.slice(1) + Math.round(a / 100 * 255).toString(16).padStart(2, '0')
      if (animOn()) edit(`已在第 ${state.frame} 帧给 ${names.length} 个插槽打颜色帧`, (j) => names.reduce((r, n) => Ops.keyColor(r.json, state.anim, n, timeSec(), hex), { json: j }))
      else edit(`已修改 ${names.length} 个插槽的颜色`, (j) => names.reduce((r, n) => Ops.setSlotProps(r.json, n, { color: hex }), { json: j }))
    }
    colorIn.addEventListener('change', commitColor)
    alphaIn.addEventListener('change', commitColor)
    out.push(field('颜色', h('div', { class: 'inline' }, colorIn, h('span', { style: 'flex:0 0 auto;color:#9a9a9a;font-size:11px' }, col ? '不透明' : '不透明（不一样）'), alphaIn,
      keyBtn(names.map((n) => ['slots', n, 'color']), () => edit(`第 ${state.frame} 帧：${names.length} 个插槽颜色已打关键帧`, (j) => names.reduce((r, n) => {
        const l = rt.skeleton.findSlot(n)
        const hex = [l.color.r, l.color.g, l.color.b, l.color.a].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
        return Ops.keyColor(r.json, state.anim, n, timeSec(), hex)
      }, { json: j })), `给 ${names.length} 个插槽的颜色打关键帧`))))
    const dark = same((sl) => !!sl.dark)
    out.push(field('填入黑色', h('div', { class: 'inline' },
      h('label', { class: 'checks', style: 'margin:0' }, check(dark == null ? '（不一样）' : '', !!dark, (v) => edit(`已${v ? '开启' : '关闭'} ${names.length} 个插槽的填入黑色`,
        (j) => names.reduce((r, n) => Ops.setSlotProps(r.json, n, { dark: v ? (slotOf(n).dark || '000000') : '' }), { json: j })))))))
    const blend = same((sl) => sl.blend || 'normal')
    const blendSel = selectInput([...(blend == null ? [['', '（不一样）']] : []), ['normal', '正常'], ['additive', '相加'], ['multiply', '正片叠底'], ['screen', '滤色']], blend == null ? '' : blend,
      (v) => { if (v) edit(`已修改 ${names.length} 个插槽的混合`, (j) => names.reduce((r, n) => Ops.setSlotProps(r.json, n, { blend: v }), { json: j })) })
    out.push(field('混合', blendSel))
    out.push(h('div', { class: 'btns' }, btn('设置父级', () => startPick({ want: 'bone', text: `${names.length} 个插槽挂到哪根骨骼：点骨骼`,
      done: (b) => { const m = setupMatrices(); edit(`已把 ${names.length} 个插槽挂到 ${b}`, (j) => names.reduce((r, n) => Ops.setSlotProps(r.json, n, { bone: b }, m), { json: j })) } }), { full: true, title: 'P：画面位置不变' })))
    return out
  }

  /** The picked image (an attachment in the default skin, or one skin's content of a placeholder). */
  function attPanel(sel) {
    const sk = skinOf(sel.skin)
    const att = sk.attachments[sel.slot][sel.name]
    const type = att.type || 'region'
    const mesh = type === 'mesh' || type === 'linkedmesh'
    const typeName = { region: '图片', mesh: '网格', linkedmesh: '链接网格', boundingbox: '包围盒', clipping: '裁剪', path: '路径', point: '点' }[type] || type
    if (type === 'clipping') return clipPanel(sel, att)
    const inPlaceholder = Ops.isPlaceholder(state.json, sel.slot, sel.name)
    const others = state.json.skins.filter((x) => x.name !== 'default').length
    const out = []
    out.push(h('div', { class: 'name-row' },
      inPlaceholder ? h('span', { class: 'nm' }, sel.name)
        : textInput(sel.name, (v) => edit(`已改名 → ${v}`, (j) => Ops.renameAttachment(j, sel.slot, sel.name, v), (r) => { state.sel = { ...sel, name: r.attachment } }), { rename: true }),
      h('span', { class: 'tag' }, typeName + (inPlaceholder ? ` · ${sel.skin}` : '')),
      animOn() && mesh ? meshKeyEnd(sel.slot, sel.name) : null,
      inPlaceholder ? null : ibtn('copy', mesh ? '复制：一份独立的网格，顶点归它自己，可以单独改形状（Ctrl+D）' : '复制（Ctrl+D）', () => duplicateAttachmentSel(sel, false)),
      !inPlaceholder && mesh ? ibtn('link', '链接网格：创建一个使用相同顶点和变形的链接网格，可以换图', () => duplicateAttachmentSel(sel, true)) : null,
      ibtn('trash', inPlaceholder ? '清空' : '删除', deleteSelection)))
    const img = type === 'region' || mesh
    // Spine's 导出: unticked = kept here, left out of the export; 网格: ticked = a mesh, unticked = a plain image again
    out.push(h('div', { class: 'checks' }, check('导出', Ops.isExported(state.json, sel.skin, sel.slot, sel.name),
      (v) => edit(v ? `「${sel.name}」会导出` : `「${sel.name}」不导出（工程里还在）`, (j) => Ops.setAttachmentExport(j, sel.skin, sel.slot, sel.name, v)),
      { title: '不勾 = 留在工程里，导出时不带它' }),
      img && !inPlaceholder ? check('网格', !!mesh,
        (v) => edit(v ? `「${sel.name}」已转成网格` : `「${sel.name}」已转回图片（网格和变形关键帧去掉）`, (j) => v ? Ops.regionToMesh(j, sel.skin, sel.slot, sel.name) : Ops.meshToRegion(j, sel.skin, sel.slot, sel.name)),
        { title: '勾 = 转成网格；不勾 = 转回普通图片（网格顶点、权重和变形关键帧都去掉）' }) : null))
    // the picture's name only when it differs from the attachment's (the title shows that one)
    if (img && att.path && att.path !== sel.name) out.push(field('图片', h('div', { class: 'inline' }, h('span', {}, att.path))))
    out.push(h('div', { class: 'btns g2' },
      img && (state.mode === 'setup' || state.leftOpen === 'weights') ? btn('编辑权重', () => enterWeightEdit(sel), { primary: !!(state.weightEdit && state.weightEdit.name === sel.name && state.weightEdit.slot === sel.slot), title: '在画面里刷这张网格的骨骼权重' }) : null,
      img && state.mode === 'setup' ? btn('编辑网格', () => enterMeshEdit(sel), { primary: !!(state.meshEdit && state.meshEdit.name === sel.name && state.meshEdit.slot === sel.slot), title: type === 'region' ? '先转成网格（图片的矩形），再编辑顶点' : '在画面里编辑这张网格的顶点' }) : null,
      img ? btn('换图', () => openImagePicker(`给「${sel.name}」换图`, (r) => swapImage(sel, r))) : null,
      !inPlaceholder && others ? btn('转为皮肤占位符', () => edit(`「${sel.name}」已转为皮肤占位符，每个皮肤先用原图`,
        (j) => Ops.convertToPlaceholder(j, sel.slot, sel.name),
        () => { state.sel = { kind: 'ph', name: sel.name, slot: sel.slot } }), { title: '每个皮肤在这里放自己的图' }) : null,
      !inPlaceholder ? btn('设置父级', () => transferAtt(sel, true), { title: 'P：移到别的插槽' }) : null))
    return out
  }

  // ---------- 剪裁 (Spine's clipping: a mask polygon over the slots drawn after it)

  /** 新建 → 剪裁: in this slot, or (from a bone) in a new slot on it; drawing the polygon starts right away. */
  function newClipping(slotName, boneName) {
    if (state.mode !== 'setup') { status('剪裁在「设置」模式下新建'); return }
    edit((r) => `已新建剪裁 ${r.attachment}：在画面里依次点出多边形`, (j) => {
      let slot = slotName, json = j
      if (!slot) { const a = Ops.addSlot(json, boneName, uniqueSlotName(json, 'clipping')); json = a.json; slot = a.slot }
      const r = Ops.createClipping(json, slot)
      return { ...r, slot }
    }, (r) => {
      state.sel = { kind: 'att', skin: 'default', slot: r.slot, name: r.attachment }
      state.collapsed.delete('s:' + r.slot)
      revealInTree(state.sel)
      state.clipEdit = { skin: 'default', slot: r.slot, name: r.attachment, tool: 'create' }
    })
  }
  const uniqueSlotName = (json, base) => { const t = new Set(json.slots.map((x) => x.name)); if (!t.has(base)) return base; let i = 2; while (t.has(base + i)) i++; return base + i }

  /**
   * The clipping's properties (Spine): 结束插槽 = the last slot it clips (the slots drawn after its
   * own slot, up to that one; 最上面 = all of them), 颜色, 导出, 编辑剪裁, 设置父级. Where it starts is
   * its slot's place in 绘制顺序.
   */
  function clipPanel(sel, att) {
    const out = []
    out.push(h('div', { class: 'name-row' },
      textInput(sel.name, (v) => edit(`已改名 → ${v}`, (j) => Ops.renameAttachment(j, sel.slot, sel.name, v), (r) => { state.sel = { ...sel, name: r.attachment } }), { rename: true }),
      h('span', { class: 'tag' }, '剪裁'),
      animOn() ? meshKeyEnd(sel.slot, sel.name) : null,
      ibtn('copy', '复制（Ctrl+D）', () => duplicateAttachmentSel(sel, false)),
      ibtn('trash', '删除', deleteSelection)))
    out.push(h('div', { class: 'checks' }, check('导出', Ops.isExported(state.json, sel.skin, sel.slot, sel.name),
      (v) => edit(v ? `「${sel.name}」会导出` : `「${sel.name}」不导出（工程里还在）`, (j) => Ops.setAttachmentExport(j, sel.skin, sel.slot, sel.name, v)))))
    // the slots it can reach: the ones drawn after its slot, listed top first like 绘制顺序
    const order = state.json.slots.map((x) => x.name)
    const after = order.slice(order.indexOf(sel.slot) + 1).reverse()
    const end = att.end && after.includes(att.end) ? att.end : ''
    const reach = end ? order.indexOf(end) - order.indexOf(sel.slot) : after.length
    out.push(field('结束插槽', selectInput([['', '（一直到最上面）'], ...after.map((n) => [n, n])], end,
      (v) => edit(v ? `「${sel.name}」剪到「${v}」为止` : `「${sel.name}」剪到最上面`, (j) => Ops.setClipping(j, sel.skin, sel.slot, sel.name, { end: v })))))
    out.push(h('div', { class: 'hint' }, after.length
      ? `剪裁「${sel.slot}」上面的 ${reach} 个插槽${end ? `（到「${end}」为止）` : ''}；列表里只有它上面的插槽，在「绘制顺序」里拖动「${sel.slot}」改它从哪一层开始`
      : `「${sel.slot}」在最上面，上面没有可剪的插槽：在「绘制顺序」里把它往下拖，列表里才有可选的层`))
    const colIn = h('input', { type: 'color', value: '#' + String(att.color || 'ce3a3aff').slice(0, 6) })
    colIn.addEventListener('change', () => edit(`已修改 ${sel.name} 颜色`, (j) => Ops.setClipping(j, sel.skin, sel.slot, sel.name, { color: colIn.value.slice(1) + 'ff' })))
    out.push(field('颜色', colIn))
    const editing = !!(state.clipEdit && state.clipEdit.slot === sel.slot && state.clipEdit.name === sel.name)
    out.push(h('div', { class: 'hint' }, animOn()
      ? '选中后直接在画面里拖顶点（框选 / Ctrl 加选，旋转、缩放工具也行）= 在这一帧打剪裁变形关键帧；钥匙 = 给当前形状打关键帧'
      : '选中后直接在画面里拖顶点（框选 / Ctrl 加选）= 改剪裁形状；加减顶点用「编辑剪裁」'))
    out.push(h('div', { class: 'btns g2' },
      btn('编辑剪裁', () => (editing ? exitClipEdit() : enterClipEdit(sel)), { primary: editing, disabled: state.mode !== 'setup', title: '在画面里点 / 拖 / 删多边形的顶点' }),
      btn('设置父级', () => transferAtt(sel, true), { title: 'P：移到别的插槽' })))
    return out
  }

  function enterClipEdit(sel) {
    if (state.mode !== 'setup') { status('编辑剪裁在「设置」模式下用'); return }
    state.meshEdit = null; state.weightEdit = null
    state.clipEdit = { skin: sel.skin, slot: sel.slot, name: sel.name, tool: 'create' }
    refresh()
  }

  function exitClipEdit() {
    if (!state.clipEdit) return
    state.clipEdit = null
    state.clipDrag = null
    refresh()
  }

  function clipRuntime() {
    const ce = state.clipEdit
    const slot = ce && rt.skeleton && rt.skeleton.findSlot(ce.slot)
    const skin = slot && (rt.data.findSkin(ce.skin) || rt.data.defaultSkin)
    const att = skin && skin.getAttachment(slot.data.index, ce.name)
    return att instanceof spine.ClippingAttachment ? { slot, att } : null
  }

  /** A clipping's polygon in the world (setup pose). */
  function clipWorld(slot, att) {
    const n = att.worldVerticesLength
    const v = new Float32Array(n)
    if (n) att.computeWorldVertices(slot, 0, n, v, 0, 2)
    const out = []
    for (let i = 0; i < n; i += 2) out.push([v[i], v[i + 1]])
    return out
  }

  /** World points → the clipping's vertices in its slot bone's space (one undo step). */
  function commitClip(pts, label) {
    const ce = state.clipEdit, R = clipRuntime()
    if (!ce || !R) return
    const b = R.slot.bone
    const det = b.a * b.d - b.b * b.c || 1
    const local = []
    for (const [x, y] of pts) { const dx = x - b.worldX, dy = y - b.worldY; local.push((b.d * dx - b.b * dy) / det, (b.a * dy - b.c * dx) / det) }
    edit(label, (j) => Ops.setClipping(j, ce.skin, ce.slot, ce.name, { vertices: local }))
  }

  function clipVertexAt(pts, sx, sy) {
    let best = -1, bd = 9
    pts.forEach(([x, y], i) => { const q = toScreen(x, y); const d = Math.hypot(q[0] - sx, q[1] - sy); if (d < bd) { bd = d; best = i } })
    return best
  }

  /** 创建: drag a vertex, or click to add one (into the nearest edge); 删除: click a vertex. */
  function clipPointerDown(e, sx, sy) {
    const ce = state.clipEdit, R = clipRuntime()
    if (!R) return null
    const pts = clipWorld(R.slot, R.att)
    const vi = clipVertexAt(pts, sx, sy)
    if (ce.tool === 'delete') {
      if (vi >= 0) commitClip(pts.filter((_, i) => i !== vi), '已删除剪裁顶点')
      return null
    }
    if (vi >= 0) return { kind: 'clipMove', vi, pts, sx, sy, moved: false }
    const [wx, wy] = toWorld(sx, sy)
    let next
    if (pts.length < 3) next = [...pts, [wx, wy]]
    else {
      let at = 0, d0 = Infinity
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length]
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
        const t = l2 ? Math.max(0, Math.min(1, ((wx - a[0]) * dx + (wy - a[1]) * dy) / l2)) : 0
        const d = Math.hypot(wx - a[0] - t * dx, wy - a[1] - t * dy)
        if (d < d0) { d0 = d; at = i }
      }
      next = [...pts.slice(0, at + 1), [wx, wy], ...pts.slice(at + 1)]
    }
    commitClip(next, `已添加剪裁顶点（${next.length}）`)
    return null
  }

  function finishClipMove(d) {
    const cd = state.clipDrag
    state.clipDrag = null
    if (!d.moved || !cd) return
    const next = d.pts.map((p, i) => (i === d.vi ? cd.p : p))
    commitClip(next, '已移动剪裁顶点')
  }

  /** Every clipping its slot shows, outlined in its colour; the edited / picked one with vertices. */
  function drawClips(g) {
    if (!rt.skeleton) return
    const ce = state.clipEdit, sel = state.sel
    const items = []
    for (const slot of rt.skeleton.drawOrder) {
      const a = slot.getAttachment()
      if (state.opt.otherVis && a instanceof spine.ClippingAttachment && !state.hiddenSlots.has(slot.data.name) && !(ce && slot.data.name === ce.slot)) items.push({ slot, att: a, edit: false })
    }
    const R = ce ? clipRuntime() : null
    if (R) items.push({ slot: R.slot, att: R.att, edit: true })
    g.save()
    for (const it of items) {
      let pts = clipWorld(it.slot, it.att)
      if (it.edit && state.clipDrag) pts = pts.map((p, i) => (i === state.clipDrag.vi ? state.clipDrag.p : p))
      const q = pts.map(([x, y]) => toScreen(x, y))
      // no colour in the file: Spine's editor red (the 3.8 runtime's own default is a blue)
      const c = it.att.color
      const plain = Math.abs(c.r - 0.2275) < 0.01 && Math.abs(c.g - 0.2275) < 0.01 && Math.abs(c.b - 0.8078) < 0.01
      const col = plain ? 'rgba(206,58,58,' : `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},`
      const picked = it.edit || (sel && sel.kind === 'att' && sel.slot === it.slot.data.name && rt.skeleton.findSlot(sel.slot).getAttachment() === it.att)
      g.strokeStyle = col + (picked ? '1)' : '.75)'); g.lineWidth = picked ? 1.8 : 1.2
      if (q.length) {
        g.beginPath()
        q.forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y) })
        if (q.length >= 3) g.closePath()
        g.stroke()
        if (it.edit && q.length < 3 && state.meshPointer) { g.setLineDash([4, 3]); g.beginPath(); g.moveTo(q[q.length - 1][0], q[q.length - 1][1]); g.lineTo(state.meshPointer[0], state.meshPointer[1]); g.stroke(); g.setLineDash([]) }
      }
      if (it.edit) {
        q.forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = col + '1)'; g.stroke() })
      }
      if (state.opt.otherName && q.length) {
        let cx = 0, cy = 0
        for (const [x, y] of q) { cx += x / q.length; cy += y / q.length }
        g.font = '11px Inter, "Microsoft YaHei", sans-serif'; g.textAlign = 'center'
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(it.att.name, cx + 1, cy + 1)
        g.fillStyle = col + '1)'; g.fillText(it.att.name, cx, cy)
        g.textAlign = 'start'
      }
    }
    g.restore()
  }

  /** The clipping whose outline is under the pointer (其他 · 选择). */
  function hitClip(sx, sy) {
    if (!rt.skeleton) return null
    for (let k = rt.skeleton.drawOrder.length - 1; k >= 0; k--) {
      const slot = rt.skeleton.drawOrder[k]
      const a = slot.getAttachment()
      if (!(a instanceof spine.ClippingAttachment) || state.hiddenSlots.has(slot.data.name)) continue
      const q = clipWorld(slot, a).map(([x, y]) => toScreen(x, y))
      for (let i = 0; i < q.length; i++) {
        const p0 = q[i], p1 = q[(i + 1) % q.length]
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l2 = dx * dx + dy * dy
        const t = l2 ? Math.max(0, Math.min(1, ((sx - p0[0]) * dx + (sy - p0[1]) * dy) / l2)) : 0
        if (Math.hypot(sx - p0[0] - t * dx, sy - p0[1] - t * dy) < 6) {
          const key = attachmentKey(slot.data.name, a)
          if (key) return { slot: slot.data.name, ...key }
        }
      }
    }
    return null
  }

  /** Spine's 编辑剪裁 panel: 创建 / 删除, 新建, 顶点 count. */
  function renderClipPanel() {
    const p = $('#clipPanel')
    const ce = state.clipEdit
    const R = ce && clipRuntime()
    p.hidden = !R
    p.textContent = ''
    if (!R) return
    const n = R.att.worldVerticesLength / 2
    const tool = (id, label, title) => h('button', { class: 'mt', 'aria-pressed': String(ce.tool === id), title, onclick: () => { ce.tool = id; renderClipPanel() } }, label)
    p.append(
      h('div', { class: 'mname' }, `${ce.slot} · ${ce.name}`),
      h('div', { class: 'mhd' }, h('b', {}, '编辑剪裁'), h('button', { class: 'xx', title: '完成（Enter / Esc）', onclick: exitClipEdit }, '×')),
      h('div', { class: 'mrow' },
        tool('create', '创建', '点空白处加顶点（3 个以后插进最近的边），拖顶点移动'),
        tool('delete', '删除', '点顶点删除')),
      h('div', { class: 'mrow' },
        h('button', { class: 'mt', title: '清空多边形，重新点', onclick: () => { ce.tool = 'create'; commitClip([], '已清空剪裁，重新点多边形') } }, '新建')),
      h('div', { class: 'mrow mopts' }, h('span', { class: 'mcount' }, n < 3 ? `顶点：${n}（至少 3 个才剪裁）` : `顶点：${n}`)))
    layoutFloats()
  }

  /** Spine's skin placeholder: one row per skin with what it puts here. */
  function placeholderPanel(sel) {
    const ph = Ops.placeholderList(state.json, sel.slot).find((p) => p.name === sel.name)
    const skins = state.json.skins.map((s) => s.name).filter((n) => n !== 'default' || ph.skins.default)
    const kids = []
    kids.push(h('div', { class: 'name-row' },
      textInput(sel.name, (v) => edit(`已改名占位符 → ${v}`, (j) => Ops.renameAttachment(j, sel.slot, sel.name, v), (r) => { state.sel = { ...sel, name: r.attachment } }), { rename: true }),
      ibtn('trash', '删除占位符', deleteSelection)))
    kids.push(skins.length ? h('div', { class: 'list' }, skins.map((skin) => {
      const att = ph.skins[skin]
      const current = state.skin === skin
      return h('div', { class: 'li', 'data-on': current ? '1' : null, onclick: () => { setSkin(skin); refresh(); status(`当前皮肤：${skin}`) } },
        h('span', { class: 'n', style: 'flex:0 0 52px' }, skin),
        h('span', { class: 'm' + (att ? '' : ' empty'), style: 'flex:1;max-width:none' }, att ? (att.path || att.name || sel.name) : '空'),
        btn(att ? '换图' : '放图', (e) => { e.stopPropagation(); openImagePicker(`「${sel.name}」· 皮肤 ${skin}`, (r) => fillPlaceholder(skin, sel.slot, sel.name, r)) }, { primary: !att }),
        att ? h('button', { class: 'x', title: '清空', onclick: (e) => { e.stopPropagation(); edit(`已清空皮肤 ${skin} 的「${sel.name}」`, (j) => Ops.clearPlaceholder(j, skin, sel.slot, sel.name)) } }, '×') : null)
    })) : h('div', { class: 'hint' }, '还没有皮肤：双击工程树里的「皮肤」新建'))
    return kids
  }

  // ---------- 动画

  function animBody() {
    const name = state.sel.name
    const out = []
    out.push(h('div', { class: 'name-row' },
      textInput(name, (v) => edit(`已改名动画 → ${v}`, (j) => Ops.renameAnimation(j, name, v), (r) => { state.sel = { kind: 'anim', name: r.animation }; if (state.anim === name) state.anim = r.animation }), { rename: true }),
      ibtn('copy', '复制动画', () => edit((r) => `已复制动画 → ${r.animation}`, (j) => Ops.duplicateAnimation(j, name), (r) => { state.sel = { kind: 'anim', name: r.animation }; state.anim = r.animation })),
      ibtn('trash', '删除动画', () => edit(`已删除动画 ${name}`, (j) => Ops.deleteAnimation(j, name), () => { state.sel = null }))))
    return out
  }

  /** A picked section: its 新建 (Spine's 新建… on the Skins / Events / Animations node). */
  function sectionBody() {
    const make = { skins: ['新建皮肤', newSkin], events: ['新建事件', newEvent], anims: ['新建动画', newAnimation] }[state.sel.name]
    return make ? [h('div', { class: 'btns' }, btn(make[0], make[1], { primary: true, full: true, title: `也可以双击工程树里的「${{ skins: '皮肤', events: '事件', anims: '动画' }[state.sel.name]}」` }))] : []
  }

  // ---------- 事件

  function eventBody() {
    const name = state.sel.name
    const e = (state.json.events || {})[name] || {}
    const set = (k) => (v) => edit(`已修改事件 ${name}`, (j) => Ops.setEventProps(j, name, { [k]: v }))
    // text values may be cleared, unlike names
    const strIn = (k) => {
      const i = h('input', { type: 'text', value: e[k] || '' })
      i.addEventListener('change', () => { if (i.value !== (e[k] || '')) set(k)(i.value) })
      i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') i.blur() })
      return i
    }
    const out = [h('div', { class: 'name-row' },
      textInput(name, (v) => edit(`已改名事件 → ${v}`, (j) => Ops.renameEvent(j, name, v), (r) => { state.sel = { kind: 'event', name: r.event } }), { rename: true }),
      ibtn('trash', '删除事件（动画里它的关键帧一起删掉）', deleteSelection))]
    out.push(field('整数', numInput(e.int || 0, set('int'), { step: 1 })))
    out.push(field('浮点', numInput(e.float || 0, set('float'))))
    out.push(field('字符串', strIn('string')))
    out.push(field('音频', strIn('audio')))
    if (e.audio) {
      out.push(field('音量', numInput(e.volume === undefined ? 1 : e.volume, set('volume'), { step: 0.1 })))
      out.push(field('平衡', numInput(e.balance || 0, set('balance'), { step: 0.1 })))
    }
    return out
  }

  // ---------- 皮肤

  function skinBody() {
    const j = state.json
    const out = []
    const name = state.sel && state.sel.kind === 'skin' ? state.sel.name : state.skin
    if (name !== 'default') {
      out.push(h('div', { class: 'name-row' },
        textInput(name, (v) => edit(`已改名皮肤 → ${v}`, (x) => Ops.renameSkin(x, name, v), (r) => { state.sel = { kind: 'skin', name: r.skin }; if (state.skin === name) state.skin = r.skin }), { rename: true }),
        ibtn('copy', '复制皮肤', () => {
          const taken = new Set(j.skins.map((x) => x.name))
          let i = 2
          while (taken.has(name + i)) i++
          edit(`已复制皮肤 ${name} → ${name + i}`, (x) => Ops.createSkin(x, name + i, { copyFrom: name }), (r) => { state.sel = { kind: 'skin', name: r.skin }; setSkin(r.skin) })
        }),
        ibtn('trash', '删除皮肤', () => { state.sel = { kind: 'skin', name }; deleteSelection() })))
    }
    const list = []
    for (const sl of j.slots) for (const ph of Ops.placeholderList(j, sl.name)) list.push({ slot: sl.name, ph })
    if (name === 'default') {
      out.push(h('div', { class: 'btns' }, btn('新建皮肤', newSkin, { full: true })))
    } else {
      out.push(grp(`皮肤占位符 · ${name}`, list.length ? `${list.filter((x) => x.ph.skins[name]).length}/${list.length}` : null,
        list.length ? h('div', { class: 'list' }, list.map(({ slot, ph }) => {
          const att = ph.skins[name]
          return h('div', { class: 'li', onclick: () => select({ kind: 'ph', name: ph.name, slot }, false, { keepPanel: true }) },
            h('span', { class: 'n' }, ph.name === slot ? slot : `${slot} / ${ph.name}`),
            h('span', { class: 'm' + (att ? '' : ' empty') }, att ? (att.path || ph.name) : '空'),
            btn(att ? '换图' : '放图', (e) => { e.stopPropagation(); openImagePicker(`「${ph.name}」· 皮肤 ${name}`, (r) => fillPlaceholder(name, slot, ph.name, r)) }, { primary: !att }))
        })) : h('div', { class: 'hint' }, '还没有占位符：插槽「新建…」→ 皮肤占位符，或把一张图「转为皮肤占位符」。')))
    }
    return out
  }

  // ---------- 约束

  function consBody() {
    const j = state.json
    const sel = state.sel
    const c = (j[sel.kind] || []).find((x) => x.name === sel.name)
    if (!c) return []
    // the solve order lives in the tree and sorts itself after every change
    if (sel.kind === 'ik') return ikCard(c)
    if (sel.kind === 'transform') return transformCard(c)
    return [h('div', { class: 'sub-card' }, h('div', { class: 't' }, c.name, h('span', { class: 'k' }, '路径约束（只显示）')))]
  }

  function constraintCommon(kind, c) {
    const name = c.name
    const out = []
    out.push(h('div', { class: 'name-row' },
      textInput(name, (v) => edit(`已改名约束 → ${v}`, (j) => Ops.renameConstraint(j, kind, name, v), (r) => { state.sel = { kind, name: r.constraint } }), { rename: true }),
      ibtn('trash', '删除约束', deleteSelection)))
    out.push(field('目标', h('div', { class: 'inline' }, h('span', {}, c.target),
      btn('更换', () => startPick({ want: 'bone', text: `「${name}」的新目标：点骨骼`,
        done: (t) => edit((r) => `已更换目标为 ${t}${orderNote(r)}`, (j) => withOrder(Ops.setConstraintProps(j, kind, name, { target: t }))) })))))
    if (state.skin !== 'default') {
      const sk = skinOf(state.skin)
      const inSkin = !!(sk && Array.isArray(sk[kind]) && sk[kind].includes(name))
      out.push(h('div', { class: 'btns' }, btn(inSkin ? `从皮肤「${state.skin}」移除` : `加入皮肤「${state.skin}」`,
        () => edit(`已${inSkin ? '移出' : '加入'}皮肤 ${state.skin}`, (j) => Ops.setSkinMembership(j, state.skin, kind, name, !inSkin)), { full: true })))
    }
    return out
  }

  /** Mix sliders, 0-100 like Spine: setup value in 设置, a key at the current frame in 动画. */
  function mixSlider(kind, name, key, value, opts) {
    const o = opts || { max: 100, step: 1, scale: 100, fmt: (v) => String(Math.round(v)) }
    const sc = o.scale || 1
    return sliderInput(value * sc,
      (v) => {
        if (animOn()) return
        const c = kind === 'ik' ? rt.data.findIkConstraint(name) : rt.data.findTransformConstraint(name)
        if (c) { c[key] = v / sc; pose() }
      },
      (v) => {
        if (animOn()) edit(`已在第 ${state.frame} 帧打约束关键帧`, (j) => Ops.keyConstraint(j, state.anim, kind, name, timeSec(), { ...(kind === 'ik' ? ikNow(name) : {}), [key]: v / sc }))
        else edit(`已修改 ${name}`, (j) => Ops.setConstraintProps(j, kind, name, { [key]: v / sc }))
      }, o)
  }

  /** An IK constraint's values on this frame (what a key at this frame keeps). */
  function ikNow(name) {
    const live = rt.skeleton && rt.skeleton.findIkConstraint(name)
    return live ? { mix: live.mix, softness: live.softness, bendPositive: live.bendDirection > 0, compress: live.compress, stretch: live.stretch } : {}
  }

  /**
   * Spine's IK panel: 父级 / 子级 / 目标 (each changeable; 子级 can be removed for a one-bone IK),
   * 选项 (two bones: 正向 伸展; one bone: 压缩 伸展 统一), 柔软度 (two bones), 混合 0-100.
   * In an animation every change is a key on this frame (统一 is setup only, as in 3.8).
   */
  function ikCard(c) {
    const name = c.name
    const live = rt.skeleton && rt.skeleton.findIkConstraint(name)
    const anim = animOn() && live
    const two = c.bones.length === 2
    const now = anim ? ikNow(name) : null
    const val = (k, d) => (now && k in now ? now[k] : c[k] === undefined ? d : c[k])
    const setOpt = (k, v) => {
      if (animOn() && k !== 'uniform') edit(`已在第 ${state.frame} 帧打约束关键帧`, (j) => Ops.keyConstraint(j, state.anim, 'ik', name, timeSec(), { ...ikNow(name), [k]: v }))
      else edit(`已修改 ${name}`, (j) => Ops.setConstraintProps(j, 'ik', name, { [k]: v }))
    }
    const parentOf = (b) => ((state.json.bones.find((x) => x.name === b) || {}).parent)
    const setBones = (bones, msg) => edit((r) => `${msg}${orderNote(r)}`, (j) => withOrder(Ops.setConstraintProps(j, 'ik', name, { bones })))
    const pickParent = () => startPick({ want: 'bone', text: `「${name}」的父级：点骨骼`, done: (b) => {
      const keep = two && parentOf(c.bones[1]) === b
      setBones(keep ? [b, c.bones[1]] : [b], keep ? `父级改为 ${b}` : `父级改为 ${b}${two ? '（原子级不是它的子骨骼，变成单骨骼 IK）' : ''}`)
    } })
    const pickChild = () => startPick({ want: 'bone', text: `「${name}」的子级：点「${c.bones[0]}」的子骨骼`, done: (b) => {
      if (parentOf(b) !== c.bones[0]) { status(`子级要是「${c.bones[0]}」的子骨骼`, 'error'); return }
      setBones([c.bones[0], b], `子级改为 ${b}`)
    } })
    const out = constraintCommon('ik', c)
    const boneRow = (label, value, actions) => field(label, h('div', { class: 'inline' }, h('span', { class: value ? null : 'dim' }, value || '—'), actions))
    out.splice(1, 0,
      boneRow('父级', c.bones[0], btn('更换', pickParent)),
      boneRow('子级', two ? c.bones[1] : '', [btn(two ? '更换' : '设置', pickChild),
        two ? btn('移除', () => setBones([c.bones[0]], '已移除子级，变成单骨骼 IK'), { title: '只留父级：单骨骼 IK' }) : null]))
    const opt = (k, label, d, title, disabled) => check(label, val(k, d), (v) => setOpt(k, v), { title, disabled })
    out.push(field('选项', h('div', { class: 'checks ik' }, two
      ? [opt('bendPositive', '正向', true, '弯曲方向：勾 = 正向，不勾 = 反向'),
         opt('stretch', '伸展', false, '目标够不着时把骨骼拉长')]
      : [opt('compress', '压缩', false, '目标比骨骼近时把骨骼缩短'),
         opt('stretch', '伸展', false, '目标比骨骼远时把骨骼拉长'),
         opt('uniform', '统一', false, '压缩 / 伸展时宽度一起缩放（只在设置里改，3.8 不能打关键帧）', !!animOn())])))
    if (two) {
      const len = (b) => Number((state.json.bones.find((x) => x.name === b) || {}).length) || 0
      const max = Math.max(50, Math.round((len(c.bones[0]) + len(c.bones[1])) / 2))
      out.push(field('柔软度', mixSlider('ik', name, 'softness', val('softness', 0), { min: 0, max, step: 0.5, scale: 1, fmt: (v) => String(Math.round(v * 10) / 10) })))
    }
    out.push(field('混合', h('div', { class: 'inline' }, mixSlider('ik', name, 'mix', val('mix', 1)),
      keyBtn([['ik', name]], () => keyConstraintNow('ik', name), '给混合 / 柔软度 / 选项打关键帧'))))
    return out
  }

  function transformCard(c) {
    const name = c.name
    const live = rt.skeleton && rt.skeleton.findTransformConstraint(name)
    const num = (k, d) => (c[k] === undefined ? d : c[k])
    const kids = [...constraintCommon('transform', c)]
    kids.push(grp('被约束的骨骼', null,
      h('div', { class: 'list' }, c.bones.map((b) => h('div', { class: 'li', onclick: () => select({ kind: 'bone', name: b }, false, { keepPanel: true }) },
        h('span', { class: 'n' }, b),
        h('button', { class: 'x', title: '移出', disabled: c.bones.length <= 1,
          onclick: (e) => { e.stopPropagation(); edit((r) => `已把 ${b} 移出约束${orderNote(r)}`, (j) => withOrder(Ops.setConstraintProps(j, 'transform', name, { bones: c.bones.filter((x) => x !== b) }))) } }, '×')))),
      h('div', { class: 'btns' },
        btn('加入骨骼', () => startPick({ want: 'bone', text: `加入「${name}」：点骨骼`,
          done: (b) => edit((r) => `已把 ${b} 加入约束${orderNote(r)}`, (j) => withOrder(Ops.setConstraintProps(j, 'transform', name, { bones: [...c.bones, b] }))) })))))
    const mixOf = (k) => (animOn() && live ? live[k] : num(k, 1))
    kids.push(grp('混合', keyBtn([['transform', name]], () => keyConstraintNow('transform', name), '给四个混合打关键帧'),
      field('旋转', mixSlider('transform', name, 'rotateMix', mixOf('rotateMix'))),
      field('平移', mixSlider('transform', name, 'translateMix', mixOf('translateMix'))),
      field('缩放', mixSlider('transform', name, 'scaleMix', mixOf('scaleMix'))),
      field('斜切', mixSlider('transform', name, 'shearMix', mixOf('shearMix')))))
    return kids
  }

  // ------------------------------------------------------------------ stage: mode label, transform panel, options

  /** What the transform panel edits: one bone, or a region image in 设置. */
  function xformTarget() {
    const s = state.sel
    // several bones: one panel for all of them (Spine)
    if (state.multi.length >= 1 && s && s.kind === 'bone') return { kind: 'bone', name: s.name, names: state.multi.includes(s.name) ? state.multi.slice() : [s.name] }
    if (s && s.kind === 'att' && state.mode === 'setup') {
      const att = skinOf(s.skin).attachments[s.slot][s.name]
      const type = att.type || 'region'
      if (type === 'region') return { kind: 'att', sel: s, att }
      // a mesh moves / turns / scales / shears as a whole, with the same handles at its centre
      if (type === 'mesh' || type === 'linkedmesh' || type === 'clipping') return { kind: 'att', sel: s, att, mesh: true }
    }
    // 动画: the picked mesh (shown in its slot) the same way, written as its shape key
    if (s && s.kind === 'att' && animOn()) {
      const slot = rt.skeleton && rt.skeleton.findSlot(s.slot)
      const shown = slot && slot.getAttachment()
      const T = shown instanceof spine.MeshAttachment || shown instanceof spine.ClippingAttachment ? meshRowTarget(s.slot, s.name) : null
      if (T && T.att === shown) return { kind: 'att', sel: s, att: shown, mesh: true, anim: T }
    }
    return null
  }

  const r2d = (a) => Math.atan2(a.c, a.a) * DEG

  /** Values shown in the transform panel for the current Spine axes (local / parent / world). */
  function xformValues(t) {
    if (!t) return {}
    // a mesh has no transform of its own: the boxes are changes to its current shape
    if (t.mesh) return { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 }
    if (t.kind === 'bone' && t.names && t.names.length > 1) {
      // a value the bones do not share shows empty
      const all = t.names.map((n) => xformValues({ kind: 'bone', name: n }))
      const out = {}
      for (const k of Object.keys(all[0])) out[k] = all.every((v) => Math.abs(v[k] - all[0][k]) < 1e-3) ? all[0][k] : NaN
      return out
    }
    if (t.kind === 'bone') {
      const b = rt.skeleton.findBone(t.name)
      const v = { rotation: b.rotation, x: b.x, y: b.y, scaleX: b.scaleX, scaleY: b.scaleY, shearX: b.shearX, shearY: b.shearY }
      if (state.axes === 'world') {
        v.rotation = r2d(b); v.x = b.worldX; v.y = b.worldY
        v.scaleX = Math.hypot(b.a, b.c); v.scaleY = Math.hypot(b.b, b.d)
      } else if (state.axes === 'local') {
        // translation measured along the bone's own axes
        const r = b.rotation / DEG
        v.x = b.x * Math.cos(r) + b.y * Math.sin(r)
        v.y = -b.x * Math.sin(r) + b.y * Math.cos(r)
      }
      return v
    }
    const slot = rt.skeleton.findSlot(t.sel.slot)
    const a = slot && slot.getAttachment()
    const src = a instanceof spine.RegionAttachment ? a : t.att
    return { rotation: src.rotation || 0, x: src.x || 0, y: src.y || 0, scaleX: src.scaleX == null ? 1 : src.scaleX, scaleY: src.scaleY == null ? 1 : src.scaleY }
  }

  /** A typed value in the current axes → the bone's local values. */
  function toLocalProps(t, k, v) {
    const b = rt.skeleton.findBone(t.name)
    const cur = xformValues(t)
    cur[k] = v
    if (k === 'rotation') {
      if (state.axes !== 'world') return { rotation: v }
      const pr = b.parent ? r2d(b.parent) : 0
      const flip = b.parent ? Math.sign(b.parent.a * b.parent.d - b.parent.b * b.parent.c) || 1 : 1
      return { rotation: normDeg((v - pr) * flip) }
    }
    if (k === 'x' || k === 'y') {
      if (state.axes === 'world') {
        const [x, y] = b.parent ? Ops.toLocal(matrixOf(b.parent), cur.x, cur.y) : [cur.x, cur.y]
        return { x, y }
      }
      if (state.axes === 'local') {
        const r = b.rotation / DEG
        return { x: cur.x * Math.cos(r) - cur.y * Math.sin(r), y: cur.x * Math.sin(r) + cur.y * Math.cos(r) }
      }
      return { [k]: v }
    }
    if ((k === 'scaleX' || k === 'scaleY') && state.axes === 'world' && b.parent) {
      const ps = k === 'scaleX' ? Math.hypot(b.parent.a, b.parent.c) : Math.hypot(b.parent.b, b.parent.d)
      return { [k]: ps ? v / ps : v }
    }
    return { [k]: v }
  }

  function commitXform(t, k, v) {
    if (t.mesh) {
      const slot = rt.skeleton.findSlot(t.sel.slot)
      const W = slot && meshPanelTransform(slot, k, v)
      if (!W) { renderStage(); return }
      const word = { x: '移动', y: '移动', rotation: '旋转', scaleX: '缩放', scaleY: '缩放', shearX: '斜切', shearY: '斜切' }[k]
      if (t.anim) {
        const T = t.anim
        const off = meshOffsetsAfter(T, currentOffsets(T), W, pickedVerts(t.sel.slot))
        edit(`第 ${state.frame} 帧：已${word}${shapeWord(t.att)} ${t.sel.name}（形状已打关键帧）`, (j) => Ops.keyDeform(j, state.anim, T.skin, T.slotName, T.attName, timeSec(), off))
        return
      }
      // 设置: the vertices take it, as a drag of the whole mesh does
      const att = slot.getAttachment()
      if (!(att instanceof spine.MeshAttachment) && !(att instanceof spine.ClippingAttachment)) return
      const drag = { att, sel: t.sel, mesh: true, tool: { x: 'move', y: 'move', rotation: 'rotate', scaleX: 'scale', scaleY: 'scale', shearX: 'shear', shearY: 'shear' }[k], start: { vertices: Array.from(att.vertices) }, only: pickedVerts(t.sel.slot) }
      applyMeshTransform(drag, W)
      finishAttDrag(drag)
      return
    }
    if (t.kind === 'att') {
      edit(`已修改图片 ${t.sel.name}`, (j) => Ops.setAttachmentProps(j, t.sel.skin, t.sel.slot, t.sel.name, { [k]: v }))
      return
    }
    const names = t.names || [t.name]
    // each bone gets the typed value in its own terms (the axes are per bone)
    const propsOf = new Map(names.map((n) => [n, toLocalProps({ kind: 'bone', name: n }, k, v)]))
    if (state.mode === 'setup') {
      edit(names.length > 1 ? `已修改 ${names.length} 根骨骼` : `已修改 ${t.name}`, (j) => names.reduce((r, n) => Ops.setBoneProps(r.json, n, propsOf.get(n)), { json: j }))
    } else {
      if (state.dope.adjust && state.dope.keySel.some((x) => x.path[0] === 'bones')) {
        const deltas = {}
        for (const n of names) {
          const b = rt.skeleton.findBone(n)
          const dlt = {}
          for (const [pk, pv] of Object.entries(propsOf.get(n))) dlt[pk] = pv - b[pk]
          deltas[n] = dlt
        }
        adjustPicked(deltas)
        return
      }
      // 动画: an unkeyed change (orange) until keyed, or keyed right away with 自动关键帧
      for (const n of names) state.temp.set(n, { ...(state.temp.get(n) || {}), ...propsOf.get(n) })
      pose()
      if (state.autoKey) keyEdited()
      else refresh()
    }
  }

  const fmt = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '')

  function syncXformValues() {
    const t = xformTarget()
    const v = xformValues(t)
    for (const i of document.querySelectorAll('#xform input[data-k]')) if (document.activeElement !== i) i.value = fmt(v[i.dataset.k])
  }

  function renderStage() {
    const mb = $('#modebar')
    mb.textContent = ''
    mb.hidden = !state.json
    const o = state.opt
    const animating = state.mode === 'animate'
    mb.append(h('button', { class: 'mode', 'data-mode': state.mode, html: (animating ? ICON.running : ICON.standing) + `<span>${animating ? '动画' : '设置'}</span>`,
      title: animating ? '动画模式：改动在当前帧打关键帧。点一下回到设置模式' : '设置模式：改的是默认姿势。点一下进入动画模式',
      onclick: toggleMode }))
    const xf = $('#xform')
    xf.textContent = ''
    xf.hidden = !state.json
    $('#selname').hidden = true
    if (!state.json) return
    const tool = (id, key, title) => h('button', { class: 'xt', 'aria-pressed': String(state.tool === id), title: `${title}（${key}）`, html: ICON[id],
      disabled: id === 'create' && state.mode !== 'setup', onclick: () => setTool(id) })
    const t = xformTarget()
    const v = xformValues(t)
    const setupOnly = t && t.kind === 'att'
    const input = (k, cls) => {
      const disabled = !t || (setupOnly && !t.mesh && (k === 'shearX' || k === 'shearY'))
      const i = h('input', { type: 'number', step: 'any', class: cls || null, 'data-k': k, value: disabled ? '' : fmt(v[k]), disabled,
        title: t && t.mesh ? (t.anim ? '相对当前形状：输入数值整体移动 / 旋转 / 缩放 / 斜切网格，写进这一帧的形状关键帧' : '相对当前形状：输入数值整体移动 / 旋转 / 缩放 / 斜切网格（写进顶点）') : null })
      i.addEventListener('change', () => { const n = Number(i.value); if (Number.isFinite(n) && t) commitXform(t, k, n) })
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); e.stopPropagation() })
      return i
    }
    const disp = (label, on, flip, title) => h('button', { class: 'xs', 'aria-pressed': String(!!on), title, onclick: () => { flip(); refresh() } }, label)
    const COL = ['选择', '显示', '名称']
    const optRow = (label, ...keys) => [h('span', { class: 'ol' }, label), ...keys.map((k, i) => k
      ? h('button', { class: 'od', 'data-on': o[k] ? '1' : null, title: k === 'imgSel' ? '选择图层：鼠标移到图层上高亮，点一下选中它' : label === '其他' ? `剪裁等非图片附件 · ${COL[i]}` : `${label} · ${COL[i]}`,
        onclick: () => { o[k] = !o[k]; if (k === 'imgSel') state.hoverImg = null; refresh() } })
      : h('span'))]
    // animation: a picked mesh / clipping is edited by its vertices; its key (the shape) shows on
    // every row, as a bone's keys do (user 2026-10-12: 能编辑的都应该能显示钥匙)
    const deformT = t && t.anim ? t.anim : !t && animOn() && state.sel && state.sel.kind === 'att' ? meshRowTarget(state.sel.slot, state.sel.name) : null
    const keyBtn = (row) => {
      if (deformT) {
        const k = keyedNow([['deform', deformT.skin, deformT.slotName, deformT.attName]]) ? 'keyed' : 'none'
        return h('button', { class: 'key', 'data-k': k, html: ICON.key,
          title: (k === 'keyed' ? '这一帧已有关键帧' : '这一帧没有关键帧：点一下打关键帧') + `（${state.sel.name} 的${shapeWord(deformT.att)}形状）`,
          onclick: () => keyDeformNow(deformT) })
      }
      if (!t || t.kind !== 'bone' || !animOn()) return null
      // several bones: pending if any is changed, keyed only when every one is keyed
      const states = (t.names || [t.name]).map((n) => keyState(n, row))
      const k = states.includes('pending') ? 'pending' : states.every((x) => x === 'keyed') ? 'keyed' : 'none'
      return h('button', { class: 'key', 'data-k': k, html: ICON.key,
        title: { none: '这一帧没有关键帧：点一下打关键帧', pending: '改动还没打关键帧（K）', keyed: '这一帧已有关键帧' }[k] + ((t.names || []).length > 1 ? `（${t.names.length} 根骨骼一起）` : ''),
        onclick: () => keyBoneRow(t.names || [t.name], row) })
    }
    xf.append(
      h('div', { class: 'xg' }, h('div', { class: 'cap' }, '工具'),
        h('div', { class: 'xr' }, tool('pose', 'B', '姿势：拖骨骼原点 = 移动，拖骨骼身 = 指向鼠标；选了一串父子骨骼时拖末端整串 IK 摆动')),
        h('div', { class: 'xr' }, tool('create', 'N', '新建骨骼：点骨骼 = 选它当父骨骼，点 / 拖空白处 = 新建')),
        h('div', { class: 'xr' }, h('button', { class: 'xt', 'aria-pressed': String(state.jointEdit), html: ICON.joint, disabled: state.mode !== 'setup',
          title: '改关节：用平移 / 姿势拖骨骼的起点或末端，父骨骼跟着转向、子骨骼和图片不动（也可以按住 Shift）',
          onclick: () => { state.jointEdit = !state.jointEdit; renderStage() } }))),
      h('div', { class: 'xg' }, h('div', { class: 'cap' }, t ? (t.kind === 'bone' ? ((t.names || []).length > 1 ? `已选 ${t.names.length} 根骨骼` : t.name) : t.mesh ? `${shapeWord(t.att)} ${t.sel.name}` : `图片 ${t.sel.name}`) : deformT ? `${shapeWord(deformT.att)} ${state.sel.name}` : '变换'),
        h('div', { class: 'xr' }, tool('rotate', 'C', '旋转'), input('rotation', 'wide'), keyBtn('rotate')),
        h('div', { class: 'xr' }, tool('move', 'V', '平移'), input('x'), input('y'), keyBtn('translate')),
        h('div', { class: 'xr' }, tool('scale', 'X', '缩放'), input('scaleX'), input('scaleY'), keyBtn('scale')),
        h('div', { class: 'xr' }, tool('shear', 'Z', '斜切'), input('shearX'), input('shearY'), keyBtn('shear'))),
      h('div', { class: 'xg' }, h('div', { class: 'cap' }, '轴向'),
        ...[['local', '局部'], ['parent', '父级'], ['world', '世界']].map(([id, label]) => h('button', { class: 'xs', 'aria-pressed': String(state.axes === id),
          title: { local: '旋转相对父骨骼，平移沿自身方向', parent: '平移沿父骨骼方向', world: '旋转、平移、缩放都按世界坐标' }[id],
          onclick: () => { state.axes = id; renderStage() } }, label))),
      h('div', { class: 'xg' },
        h('div', { class: 'og' },
          h('span', { class: 'oc' }, '显示'), ...[['optSel', '选择：画面里能点选'], ['optVis', '显示'], ['optName', '名称：一直显示名字']].map(([ic, title]) => h('span', { class: 'oh', title, html: ICON[ic] })),
          ...optRow('骨骼', 'boneSel', 'boneVis', 'boneName'),
          ...optRow('图层', 'imgSel', 'imgVis', 'imgName'),
          ...optRow('其他', 'otherSel', 'otherVis', 'otherName')),
        disp('预乘', state.pma, () => { state.pma = !state.pma }, '贴图是否预乘透明度')))
  }

  // ------------------------------------------------------------------ timeline

  /** Spine's mode button: 设置姿势 <-> 动画 (the animation picked in the timeline). */
  function toggleMode() {
    if (state.mode === 'animate') { setMode('setup'); return }
    const names = Object.keys((state.json && state.json.animations) || {})
    if (!names.length) { status('还没有动画：先在工程树「动画」里新建一个'); return }
    if (!names.includes(state.anim)) state.anim = names[0]
    state.frame = 0
    setMode('animate')
  }

  /** The 动画 section's transport: jump to a frame (clamped), playback stops. */
  function gotoFrame(f) {
    if (!animOn()) return
    const frames = Math.max(0, Math.round(duration() * FPS))
    state.playing = false
    state.temp.clear()
    state.frame = Math.max(0, Math.min(frames, Math.round(f)))
    pose()
    refresh()
  }
  const lastFrame = () => Math.max(0, Math.round(duration() * FPS))
  function togglePlay() {
    if (!animOn()) return
    // from the last frame with 循环 off, play starts over
    if (!state.playing && !state.loop && state.frame >= lastFrame()) state.frame = 0
    state.playing = !state.playing
    state.temp.clear()
    loop.acc = 0
    syncTimeline()
  }

  function setMode(mode) {
    state.mode = mode
    state.meshEdit = null
    state.weightEdit = null
    state.temp.clear()
    state.playing = false
    if (mode !== 'setup' && state.tool === 'create') state.tool = 'rotate'
    pose()
    refresh()
  }

  function syncTimeline() {
    const frames = Math.max(0, Math.round(duration() * FPS))
    $('#timeText').textContent = animOn() ? `${state.anim} · 第 ${state.frame} / ${frames} 帧` : ''
    $('#play').innerHTML = state.playing ? ICON.pause : ICON.play
    $('#play').title = state.playing ? '暂停（空格）' : '播放（空格）'
    for (const id of ['#tStart', '#tBack', '#play', '#tFwd', '#tEnd', '#tLoop']) $(id).disabled = !animOn()
    $('#tLoop').setAttribute('aria-pressed', String(!!state.loop))
    const tall = animOn(), compact = tall && !!state.compactTimeline
    $('.center').dataset.dope = tall ? '1' : ''
    // 动画工具 open: the dopesheet stays as it is (the tools' panels got compact instead)
    $('.center').dataset.compact = compact ? '1' : ''
    $('#tlBody').hidden = !tall
    $('#dopeModes').hidden = !tall
    for (const b of document.querySelectorAll('#dopeModes button[data-m]')) b.setAttribute('aria-pressed', String(!!state.dope[b.dataset.m]))
    const F = state.dope.filter
    $('#dopeFilter').hidden = !tall
    $('#dopeFilter').setAttribute('aria-pressed', String(F.keyedOnly || Object.entries(F).some(([k, v]) => k !== 'keyedOnly' && !v)))
    // Spine: the graph sits beside the dopesheet, always there in an animation
    $('#curvePanel').hidden = !tall
  }

  // ------------------------------------------------------------------ dopesheet (Spine)
  //
  // Rows: the picked bones (旋转 / 平移 / 缩放 / 斜切), slot (附件 / 颜色 / 网格), constraint
  // (混合); with nothing picked, every keyed item. Keys: click / Ctrl+click / box to select,
  // drag to move, double-click or Delete to remove, Ctrl+C / Ctrl+V, right click for the curve.
  // Ruler: click / drag = timeline position. Wheel = zoom, right drag = pan.

  // the ruler row is tall enough for the transport above the names (Spine)
  const DOPE = { nameW: 200, rulerH: 34, rowH: 22 }
  const KEY_COLOR = { rotate: '#4fd18b', translate: '#4fb3e8', scale: '#e5534b', shear: '#f0c36a', attachment: '#c79bff', color: '#ff9a3c', deform: '#5fd3e6', cons: '#ffb454', drawOrder: '#ababab', event: '#c084fc' }
  const pathId = (p) => JSON.stringify(p)

  /** The 筛选 kind of a track path (rotate / translate / … / events / drawOrder). */
  /** A 10 px glyph for a track kind at (x, cy): the function's symbol, not a plain square. */
  function drawTrackGlyph(ctx, kind, x, cy, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const c = [x + 5, cy]
    if (kind === 'rotate') { ctx.beginPath(); ctx.arc(c[0], c[1], 4, -Math.PI * 0.2, Math.PI * 1.35); ctx.stroke(); ctx.beginPath(); ctx.moveTo(c[0] + 5, c[1] - 3.5); ctx.lineTo(c[0] + 3.2, c[1] - 1.2); ctx.lineTo(c[0] + 1, c[1] - 3.2); ctx.stroke() }
    else if (kind === 'translate') { ctx.beginPath(); ctx.moveTo(c[0] - 4.5, c[1]); ctx.lineTo(c[0] + 4.5, c[1]); ctx.moveTo(c[0], c[1] - 4.5); ctx.lineTo(c[0], c[1] + 4.5); ctx.moveTo(c[0] + 2.5, c[1] - 2); ctx.lineTo(c[0] + 4.5, c[1]); ctx.lineTo(c[0] + 2.5, c[1] + 2); ctx.moveTo(c[0] - 2.5, c[1] - 2); ctx.lineTo(c[0] - 4.5, c[1]); ctx.lineTo(c[0] - 2.5, c[1] + 2); ctx.stroke() }
    else if (kind === 'scale') { ctx.beginPath(); ctx.rect(c[0] - 4.5, c[1] - 0.5, 5, 5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(c[0] - 1, c[1] - 1); ctx.lineTo(c[0] + 4.5, c[1] - 4.5); ctx.moveTo(c[0] + 1.5, c[1] - 4.5); ctx.lineTo(c[0] + 4.5, c[1] - 4.5); ctx.lineTo(c[0] + 4.5, c[1] - 1.5); ctx.stroke() }
    else if (kind === 'shear') { ctx.beginPath(); ctx.moveTo(c[0] - 4.5, c[1] + 4); ctx.lineTo(c[0] - 1.5, c[1] - 4); ctx.lineTo(c[0] + 4.5, c[1] - 4); ctx.lineTo(c[0] + 1.5, c[1] + 4); ctx.closePath(); ctx.stroke() }
    else if (kind === 'attachment') { ctx.beginPath(); ctx.rect(c[0] - 4.5, c[1] - 4, 9, 8); ctx.stroke(); ctx.beginPath(); ctx.arc(c[0] - 1.5, c[1] - 1.5, 1.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(c[0] - 4, c[1] + 3.5); ctx.lineTo(c[0] - 1, c[1] + 0.5); ctx.lineTo(c[0] + 1, c[1] + 2); ctx.lineTo(c[0] + 4, c[1] - 1); ctx.stroke() }
    else if (kind === 'color') { ctx.beginPath(); ctx.arc(c[0], c[1], 4.5, 0, Math.PI * 2); ctx.fill() }
    else if (kind === 'deform') { ctx.beginPath(); ctx.moveTo(c[0] - 4.5, c[1] + 4); ctx.lineTo(c[0] + 4.5, c[1] + 4); ctx.lineTo(c[0], c[1] - 4.5); ctx.closePath(); ctx.moveTo(c[0] - 4.5, c[1] + 4); ctx.lineTo(c[0] + 2, c[1] - 1); ctx.moveTo(c[0] + 4.5, c[1] + 4); ctx.lineTo(c[0] - 2, c[1] - 1); ctx.stroke() }
    else if (kind === 'events') { ctx.beginPath(); ctx.moveTo(c[0] - 3.5, c[1] + 5); ctx.lineTo(c[0] - 3.5, c[1] - 5); ctx.lineTo(c[0] + 4.5, c[1] - 2.5); ctx.lineTo(c[0] - 3.5, c[1]); ctx.stroke() }
    else if (kind === 'drawOrder') { ctx.beginPath(); for (const dy of [-3.5, 0, 3.5]) { ctx.moveTo(c[0] - 4.5, c[1] + dy); ctx.lineTo(c[0] + 4.5, c[1] + dy) } ctx.stroke() }
    else { ctx.beginPath(); ctx.arc(c[0] - 1.5, c[1], 3, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(c[0] + 1.5, c[1]); ctx.lineTo(c[0] + 5, c[1]); ctx.moveTo(c[0] + 3.5, c[1]); ctx.lineTo(c[0] + 3.5, c[1] + 2.5); ctx.stroke() }
    ctx.restore()
  }

  function trackKind(path) {
    if (path[0] === 'bones') return path[2]
    if (path[0] === 'slots') return path[2] === 'attachment' ? 'attachment' : 'color'
    if (path[0] === 'deform') return 'deform'
    if (path[0] === 'events') return 'events'
    if (path[0] === 'drawOrder') return 'drawOrder'
    return 'cons'
  }

  function buildDope() {
    const d = state.dope
    if (!animOn()) { d.rows = []; d.tracks = new Map(); return }
    const j = state.json, an = state.anim
    const tracks = Ops.keyTracks(j, an)
    d.tracks = new Map(tracks.map((t) => [pathId(t.path), t]))
    const F = d.filter
    const passes = (path) => F[trackKind(path)] !== false && (!F.keyedOnly || d.tracks.has(pathId(path)))
    const rows = []
    const bones = selectedBones()
    const slot = currentSlot(), extra = state.dopeExtra
    const cons = state.sel && (state.sel.kind === 'ik' || state.sel.kind === 'transform') ? state.sel : null
    const ev = state.sel && state.sel.kind === 'event' ? state.sel.name : null
    const slotList = [...new Set([...(slot ? [slot] : []), ...state.multiSlots, ...(extra ? extra.slots : [])])]
    const consAll = [...(cons ? [cons] : []), ...(state.multiCons || []), ...(extra ? extra.cons : [])]
    const consSeen = new Set(), consList = consAll.filter((c) => { const k = c.kind + ':' + c.name; if (consSeen.has(k)) return false; consSeen.add(k); return true })
    const evList = [...new Set([...(ev ? [ev] : []), ...(extra ? extra.events : [])])]
    if (bones.length || slotList.length || consList.length || evList.length) {
      for (const b of bones) {
        const props = [['rotate', '旋转'], ['translate', '平移'], ['scale', '缩放'], ['shear', '斜切']].map(([k, l]) => ({ label: l, path: ['bones', b, k], color: KEY_COLOR[k] }))
        rows.push({ label: b, paths: props.map((x) => x.path), head: true, sel: { kind: 'bone', name: b } })
        for (const x of props) rows.push({ label: x.label, paths: [x.path], color: x.color, indent: 1 })
      }
      for (const slot of slotList) {
        const deform = tracks.filter((t) => t.path[0] === 'deform' && t.path[2] === slot)
        const props = [{ label: '附件', path: ['slots', slot, 'attachment'], color: KEY_COLOR.attachment }, { label: '颜色', path: ['slots', slot, 'color'], color: KEY_COLOR.color },
          ...deform.map((t) => ({ label: `${deformKind(t.path) } ${t.path[3]}`, path: t.path, color: KEY_COLOR.deform }))]
        rows.push({ label: slot, paths: props.map((x) => x.path), head: true, sel: { kind: 'slot', name: slot } })
        for (const x of props) rows.push({ label: x.label, paths: [x.path], color: x.color, indent: 1 })
      }
      for (const c of consList) { rows.push({ label: c.name, paths: [[c.kind, c.name]], head: true, sel: { kind: c.kind, name: c.name } }); rows.push({ label: { ik: 'IK', transform: '变换', path: '路径' }[c.kind], paths: [[c.kind, c.name]], color: KEY_COLOR.cons, indent: 1 }) }
      for (const e of evList) { rows.push({ label: e, paths: [['events', e]], head: true, sel: { kind: 'event', name: e } }); rows.push({ label: '事件', paths: [['events', e]], color: KEY_COLOR.event, indent: 1 }) }
      // the draw order belongs to the whole skeleton: with bones / slots picked it shows under them
      // (Spine), so a reorder keyed in the 绘制顺序 list is seen (it never showed with a pick)
      if (bones.length || slotList.length) { rows.push({ label: '绘制顺序', paths: [['drawOrder']], head: true, sel: null }); rows.push({ label: '绘制顺序', paths: [['drawOrder']], color: KEY_COLOR.drawOrder, indent: 1 }) }
    } else {
      const items = new Map()
      for (const t of tracks) {
        const [k0, k1, , k3] = t.path
        const id = k0 === 'deform' ? 'slots:' + t.path[2] : k0 === 'drawOrder' ? 'drawOrder' : k0 + ':' + k1
        const label = k0 === 'deform' ? t.path[2] : k0 === 'drawOrder' ? '绘制顺序' : k1
        const sel = k0 === 'bones' ? { kind: 'bone', name: k1 } : k0 === 'slots' ? { kind: 'slot', name: k1 } : k0 === 'deform' ? { kind: 'slot', name: t.path[2] } : (k0 === 'ik' || k0 === 'transform') ? { kind: k0, name: k1 } : k0 === 'events' ? { kind: 'event', name: k1 } : null
        if (!items.has(id)) items.set(id, { label, paths: [], head: true, sel, kids: [] })
        items.get(id).paths.push(t.path)
        const kind = trackKind(t.path)
        const kidLabel = kind === 'deform' ? `网格 ${t.path[3]}` : { rotate: '旋转', translate: '平移', scale: '缩放', shear: '斜切', attachment: '附件', color: '颜色', events: '事件', drawOrder: '绘制顺序', cons: { ik: 'IK', transform: '变换', path: '路径' }[k0] || '约束' }[kind] || kind
        const kidColor = kind === 'cons' ? KEY_COLOR.cons : kind === 'events' ? KEY_COLOR.event : KEY_COLOR[kind] || KEY_COLOR.cons
        items.get(id).kids.push({ label: kidLabel, paths: [t.path], color: kidColor, indent: 1 })
        void k3
      }
      // every keyed item as a head row with its keyed tracks under it (the glyph says which)
      for (const it of items.values()) { const { kids, ...head } = it; rows.push(head, ...kids) }
    }
    // 筛选: property rows of a hidden kind go, and a head row keeps only the paths left
    const kept = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.indent) { if (r.paths.every(passes)) kept.push(r); continue }
      const paths = r.paths.filter(passes)
      if (!paths.length) { while (rows[i + 1] && rows[i + 1].indent) i++; continue }
      kept.push({ ...r, paths })
    }
    // Spine's animation row on top: a key wherever any track has one - picking or dragging a
    // key there takes every key of that column, on every track of the animation
    const all = [...new Set(kept.flatMap((r) => r.paths.map(pathId)))].map((id) => JSON.parse(id))
    if (kept.length) kept.unshift({ label: an, paths: all, head: true, anim: true })
    d.rows = kept
    // keys that no longer exist drop out of the selection
    d.keySel = d.keySel.filter((k) => { const t = d.tracks.get(pathId(k.path)); return t && t.times.some((x) => Math.abs(x - k.time) < 1e-4) })
  }

  function dopeEndFrame() { return Math.max(Math.round(duration() * FPS), 30) }

  // frame 0 sits on the divider between the names and the keys (Spine)
  function dopeX(f) { const d = state.dope; return DOPE.nameW + (f - d.f0) * d.pxf }
  function dopeF(x) { const d = state.dope; return (x - DOPE.nameW) / d.pxf + d.f0 }

  /** Keys of a row: [{ frame, keys: [{ path, time }] }]. */
  function rowKeys(row) {
    const byF = new Map()
    for (const path of row.paths) {
      const t = state.dope.tracks.get(pathId(path))
      if (!t) continue
      for (const time of t.times) {
        const f = Math.round(time * FPS * 1000) / 1000
        if (!byF.has(f)) byF.set(f, [])
        byF.get(f).push({ path, time })
      }
    }
    return [...byF.entries()].map(([frame, keys]) => ({ frame, keys }))
  }

  // a set of the picked keys, rebuilt when the pick changes (a scan per key per frame made a
  // drag with thousands of keys crawl)
  const keySelMemo = { list: null, size: -1, set: null }
  const keyId = (k) => pathId(k.path) + '@' + Math.round(k.time * 10000)
  function keySelSet() { const l = state.dope.keySel; if (keySelMemo.list !== l || keySelMemo.size !== l.length) { keySelMemo.list = l; keySelMemo.size = l.length; keySelMemo.set = new Set(l.map(keyId)) } return keySelMemo.set }
  const isKeySel = (k) => keySelSet().has(keyId(k))

  /** The keys of a track as written in the animation (events: that event's keys). */
  function keyList(path) {
    const a = state.json && state.json.animations[state.anim]
    if (!a) return null
    if (path[0] === 'events') { const l = (Array.isArray(a.events) ? a.events : []).filter((k) => k.name === path[1]); return l.length ? l : null }
    let node = a
    for (const q of path.slice(0, -1)) node = node && node[q]
    const v = node && node[path[path.length - 1]]
    return Array.isArray(v) ? v : null
  }

  /** What a key holds besides its time and curve: the part that decides whether a line is drawn. */
  const keyValue = (k) => { const o = {}; for (const [n, v] of Object.entries(k)) if (n !== 'time' && n !== 'curve' && n !== 'c2' && n !== 'c3' && n !== 'c4' && n !== 'nf4') o[n] = v; return JSON.stringify(o) }

  /**
   * Spine's dopesheet lines: between two keys of a track whose values differ, a line (dashed when
   * the first key is stepped); nothing between keys that hold the same value. [{ f1, f2, dashed }]
   */
  function rowSegments(row) {
    const out = []
    for (const path of row.paths) {
      const list = keyList(path)
      if (!list || list.length < 2 || path[0] === 'events') continue
      const sorted = list.slice().sort((a, b) => num0(a.time) - num0(b.time))
      for (let i = 0; i + 1 < sorted.length; i++) {
        const a = sorted[i], b = sorted[i + 1]
        if (keyValue(a) === keyValue(b)) continue
        out.push({ path, t1: num0(a.time), t2: num0(b.time), f1: Math.round(num0(a.time) * FPS * 1000) / 1000, f2: Math.round(num0(b.time) * FPS * 1000) / 1000, dashed: a.curve === 'stepped' })
      }
    }
    return out
  }

  function drawDope() {
    syncKeyButtons()
    const c = $('#dope')
    if (!c || c.hidden) return
    const d = state.dope
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(1, c.clientWidth), Hh = Math.max(1, c.clientHeight)
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(Hh * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr) }
    const end = dopeEndFrame()
    if (!d.pxf) d.pxf = Math.max(4, Math.min(40, (W - DOPE.nameW - 30) / (end + 4)))
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, Hh)
    ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, W, Hh)
    // past the animation's end
    const xe = dopeX(Math.round(duration() * FPS))
    if (xe < W) { ctx.fillStyle = '#121212'; ctx.fillRect(Math.max(DOPE.nameW, xe), DOPE.rulerH, W - xe, Hh) }
    // frame grid + ruler labels
    const step = [1, 2, 5, 10, 15, 30, 60, 120].find((n) => n * d.pxf >= 44) || 240
    ctx.font = '10px Inter, "Microsoft YaHei", sans-serif'
    const fStart = Math.max(0, Math.floor(dopeF(DOPE.nameW)))
    const fEnd = Math.ceil(dopeF(W))
    for (let f = fStart; f <= fEnd; f++) {
      const x = Math.round(dopeX(f)) + 0.5
      if (x < DOPE.nameW) continue
      const major = f % step === 0
      if (!major && d.pxf < 7) continue
      ctx.strokeStyle = major ? '#2c2c2c' : '#1e1e1e'
      ctx.beginPath(); ctx.moveTo(x, DOPE.rulerH); ctx.lineTo(x, Hh); ctx.stroke()
      ctx.strokeStyle = '#3a3a3a'
      ctx.beginPath(); ctx.moveTo(x, major ? 12 : 18); ctx.lineTo(x, DOPE.rulerH); ctx.stroke()
      if (major) { ctx.fillStyle = '#8a8a8a'; ctx.fillText(String(f), x + 3, 11) }
    }
    ctx.strokeStyle = '#2a2a2a'; ctx.beginPath(); ctx.moveTo(0, DOPE.rulerH + 0.5); ctx.lineTo(W, DOPE.rulerH + 0.5); ctx.stroke()
    // rows
    ctx.save()
    ctx.beginPath(); ctx.rect(0, DOPE.rulerH, W, Hh - DOPE.rulerH); ctx.clip()
    const sel = state.sel
    // a key drag in progress: 移位 carries the later keys of each track along, 偏移 wraps them round the loop
    const mv = d.drag && d.drag.kind === 'move' && !d.drag.dup ? d.drag : null
    const mvOffset = mv && (d.offset || mv.offset)
    const mvShift = mv && !mvOffset && (d.shift || mv.shift)
    // 移位: the last picked key per track (later keys follow); 偏移: every track with a picked key
    // (Spine offsets the whole timeline round the loop, like 动画延迟)
    const lastSel = new Map()
    if (mvShift || mvOffset) for (const x of d.keySel) lastSel.set(pathId(x.path), Math.max(lastSel.get(pathId(x.path)) ?? -1, x.time))
    const loopF = Math.round(duration() * FPS)
    // an end of the selection dragged: the picked keys stretch about the other end
    const sc = d.drag && d.drag.kind === 'scale' ? d.drag : null
    const scaled = (f) => Math.round(sc.pivot + (f - sc.pivot) * sc.factor)
    const rowsShown = d.rows
    rowsShown.forEach((r, i) => {
      const y = DOPE.rulerH + i * DOPE.rowH - d.scrollY
      if (y + DOPE.rowH < DOPE.rulerH || y > Hh) return
      const picked = r.sel && sel && sel.kind === r.sel.kind && sel.name === r.sel.name
      ctx.fillStyle = picked ? 'rgba(30,166,114,.14)' : r.anim ? '#1f2a26' : r.head ? '#1c1c1c' : '#181818'
      ctx.fillRect(0, y, W, DOPE.rowH)
      if (picked) { ctx.fillStyle = 'rgba(30,166,114,.92)'; ctx.fillRect(0, y, 3, DOPE.rowH) }
      ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.moveTo(0, y + DOPE.rowH - 0.5); ctx.lineTo(W, y + DOPE.rowH - 0.5); ctx.stroke()
      ctx.font = r.head ? '600 12px Inter, "Microsoft YaHei", sans-serif' : '12px Inter, "Microsoft YaHei", sans-serif'
      ctx.fillStyle = r.anim ? '#9be4cd' : r.head ? '#e6e6e6' : '#ababab'
      const tx = 10 + (r.indent ? 16 : 0)
      // a glyph for the row's function (rotate / translate / scale / shear / attachment / colour / mesh ...), in its colour
      if (r.color && r.indent) { drawTrackGlyph(ctx, trackKind(r.paths[0]), tx - 12, y + DOPE.rowH / 2, r.color); ctx.fillStyle = '#ababab' }
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, DOPE.nameW - 6, DOPE.rowH); ctx.clip()
      ctx.fillText(r.label, tx, y + 15)
      ctx.restore()
      // keys
      ctx.save(); ctx.beginPath(); ctx.rect(DOPE.nameW - 7, y, W - DOPE.nameW + 7, DOPE.rowH); ctx.clip()
      const shown = (k) => {
        // where a key sits while it is dragged (移位 carries the later keys, 偏移 wraps them round)
        const on = k.keys.some(isKeySel)
        let f = k.frame
        if (mv) {
          const after = mvShift && k.keys.some((kk) => lastSel.has(pathId(kk.path)) && kk.time > lastSel.get(pathId(kk.path)) + 1e-4)
          const whole = mvOffset && k.keys.some((kk) => lastSel.has(pathId(kk.path)))
          if (on || after || whole) {
            f += mv.df
            if (mvOffset && loopF > 0) f = ((f % loopF) + loopF) % loopF
          }
        }
        if (sc && on) f = scaled(f)
        return { on, f }
      }
      const keys = rowKeys(r)
      const frameOf = new Map(keys.map((k) => [k.frame, shown(k).f]))
      // the lines first, the keys over them
      const cyl = y + DOPE.rowH / 2
      ctx.lineWidth = 1
      for (const sg of rowSegments(r)) {
        const f1 = frameOf.has(sg.f1) ? frameOf.get(sg.f1) : sg.f1, f2 = frameOf.has(sg.f2) ? frameOf.get(sg.f2) : sg.f2
        if (f2 <= f1) continue
        ctx.strokeStyle = r.head ? 'rgba(201,201,201,.55)' : (r.color || '#c9c9c9')
        ctx.globalAlpha = r.head ? 1 : 0.75
        ctx.setLineDash(sg.dashed ? [3, 3] : [])
        ctx.beginPath(); ctx.moveTo(dopeX(f1) + 5, cyl + 0.5); ctx.lineTo(dopeX(f2) - 5, cyl + 0.5); ctx.stroke()
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1
      for (const k of keys) {
        const { on, f } = shown(k)
        const x = dopeX(f), cy = y + DOPE.rowH / 2, s0 = r.head ? 5.5 : 5
        ctx.beginPath(); ctx.moveTo(x, cy - s0); ctx.lineTo(x + s0, cy); ctx.lineTo(x, cy + s0); ctx.lineTo(x - s0, cy); ctx.closePath()
        ctx.fillStyle = on ? '#ffffff' : r.head ? '#c9c9c9' : (r.color || '#c9c9c9')
        ctx.fill()
        ctx.lineWidth = on ? 1.6 : 1; ctx.strokeStyle = on ? '#1EA672' : 'rgba(0,0,0,.6)'; ctx.stroke()
      }
      ctx.restore()
    })
    ctx.restore()
    // name column edge
    ctx.strokeStyle = '#2a2a2a'; ctx.beginPath(); ctx.moveTo(DOPE.nameW + 0.5, 0); ctx.lineTo(DOPE.nameW + 0.5, Hh); ctx.stroke()
    // the empty-sheet hint stays in the names column (two lines), never over the ruler's columns
    if (!d.rows.length) { ctx.save(); ctx.beginPath(); ctx.rect(0, DOPE.rulerH, DOPE.nameW - 8, Hh - DOPE.rulerH); ctx.clip(); ctx.fillStyle = '#777'; ctx.font = '12px Inter, "Microsoft YaHei", sans-serif'; ctx.fillText('这个动画还没有关键帧', 12, DOPE.rulerH + 18); ctx.fillText('选骨骼后在画面里改动，或按 K', 12, DOPE.rulerH + 36); ctx.restore() }
    // a key drag: where the picked keys were (dashed) and where they are now (solid) - Spine's
    // guide lines, so an 偏移 / 移位 drag shows where it lands
    if (mv && d.keySel.length) {
      let f1 = Infinity, f2 = -Infinity
      for (const k of d.keySel) { const f = Math.round(k.time * FPS); if (f < f1) f1 = f; if (f > f2) f2 = f }
      const wrap = (f) => (mvOffset && loopF > 0 ? ((f % loopF) + loopF) % loopF : f)
      ctx.save(); ctx.beginPath(); ctx.rect(DOPE.nameW, DOPE.rulerH, W - DOPE.nameW, Hh - DOPE.rulerH); ctx.clip(); ctx.lineWidth = 1
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.35)'
      for (const f of [f1, f2]) { const x = Math.round(dopeX(f)) + 0.5; ctx.beginPath(); ctx.moveTo(x, DOPE.rulerH); ctx.lineTo(x, Hh); ctx.stroke() }
      ctx.setLineDash([]); ctx.strokeStyle = '#e5534b'
      for (const f of [wrap(f1 + mv.df), wrap(f2 + mv.df)]) { const x = Math.round(dopeX(f)) + 0.5; ctx.beginPath(); ctx.moveTo(x, DOPE.rulerH); ctx.lineTo(x, Hh); ctx.stroke() }
      ctx.restore()
    }
    // the selection's span (two or more picked keys over a span): Spine's shaded range with a
    // handle at each end - drag one to stretch or squeeze the picked keys in time
    const span = selectionSpan()
    if (span) {
      const f1 = sc ? scaled(span.f1) : span.f1, f2 = sc ? scaled(span.f2) : span.f2
      const x1 = dopeX(Math.min(f1, f2)), x2 = dopeX(Math.max(f1, f2)), y1 = span.y
      ctx.save(); ctx.beginPath(); ctx.rect(DOPE.nameW, DOPE.rulerH, W - DOPE.nameW, Hh - DOPE.rulerH); ctx.clip()
      ctx.fillStyle = 'rgba(30,166,114,.07)'; ctx.fillRect(x1, y1, x2 - x1, Hh - y1)
      ctx.strokeStyle = 'rgba(30,166,114,.45)'; ctx.lineWidth = 1
      ctx.strokeRect(Math.round(x1) + 0.5, Math.round(y1) + 0.5, Math.round(x2 - x1), Hh - y1)
      ctx.fillStyle = '#9be4cd'
      for (const x of [x1, x2]) ctx.fillRect(Math.round(x) - 2, y1, 4, Hh - y1)
      ctx.restore()
    }
    // box selection
    if (d.drag && d.drag.kind === 'box' && d.drag.moved) {
      const b = d.drag
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#9be4cd'; ctx.fillStyle = 'rgba(30,166,114,.08)'
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0))
      ctx.setLineDash([])
    }
    // playhead
    const px = Math.round(dopeX(state.frame)) + 0.5
    if (px >= DOPE.nameW) {
      ctx.strokeStyle = '#1EA672'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, Hh); ctx.stroke()
      const label = String(state.frame)
      ctx.font = '10px Inter, sans-serif'
      const w = ctx.measureText(label).width + 8
      // the tag never slides under the transport over the names
      const lx = Math.max(DOPE.nameW, px - w / 2)
      ctx.fillStyle = '#1EA672'; ctx.fillRect(lx, 2, w, 14)
      ctx.fillStyle = '#fff'; ctx.fillText(label, lx + 4, 12.5)
    }
  }

  function dopeHit(x, y) {
    const d = state.dope
    if (y < DOPE.rulerH) return { kind: 'ruler' }
    const i = Math.floor((y - DOPE.rulerH + d.scrollY) / DOPE.rowH)
    const row = d.rows[i]
    if (x < DOPE.nameW - 7) return { kind: 'name', row }
    if (!row) return { kind: x < DOPE.nameW ? 'name' : 'empty' }
    let best = null
    for (const k of rowKeys(row)) {
      const dx = Math.abs(dopeX(k.frame) - x)
      if (dx <= 6 && (!best || dx < best.dx)) best = { dx, keys: k.keys, frame: k.frame }
    }
    if (best) return { kind: 'key', row, keys: best.keys, frame: best.frame }
    // an end handle of the selection's span (below the rows too, where no key is in the way)
    const span = selectionSpan()
    if (span && y >= span.y) {
      if (Math.abs(dopeX(span.f1) - x) <= 5) return { kind: 'scale', edge: 'start', span }
      if (Math.abs(dopeX(span.f2) - x) <= 5) return { kind: 'scale', edge: 'end', span }
    }
    return x < DOPE.nameW ? { kind: 'name', row } : { kind: 'empty', row }
  }

  /** The picked keys' span: first / last frame and the top of the first row that holds one; null below two frames. */
  function selectionSpan() {
    const d = state.dope
    if (d.keySel.length < 2) return null
    let f1 = Infinity, f2 = -Infinity
    for (const k of d.keySel) { const f = Math.round(k.time * FPS); if (f < f1) f1 = f; if (f > f2) f2 = f }
    if (f2 <= f1) return null
    const i = d.rows.findIndex((r) => rowKeys(r).some((k) => k.keys.some(isKeySel)))
    if (i < 0) return null
    return { f1, f2, y: DOPE.rulerH + i * DOPE.rowH - d.scrollY }
  }

  function setFrame(f) {
    const nf = Math.max(0, Math.round(f))
    if (nf === state.frame) return
    state.frame = nf
    state.playing = false
    state.temp.clear()
    pose()
    syncTimeline()
    syncXformValues()
    scheduleKeyPaint()
  }

  function copySelectedKeys() {
    const d = state.dope
    if (!animOn() || !d.keySel.length) return false
    d.clip = Ops.copyKeys(state.json, state.anim, d.keySel)
    status(`已复制 ${d.clip.length} 个关键帧（Ctrl+V 粘贴到当前帧）`)
    return true
  }

  function cutSelectedKeys() {
    const d = state.dope
    if (!animOn() || !d.keySel.length) return false
    d.clip = Ops.copyKeys(state.json, state.anim, d.keySel)
    const keys = d.keySel
    edit((r) => `已剪切 ${r.deleted} 个关键帧（Ctrl+V 粘贴到当前帧）`, (j) => Ops.deleteKeys(j, state.anim, keys), () => { d.keySel = [] })
    return true
  }

  /** 复制 / 剪切 / 删除 only work with keys picked. */
  let keyBtnsOn = null
  function syncKeyButtons() {
    const on = animOn() && state.dope.keySel.length > 0
    if (on === keyBtnsOn) return
    keyBtnsOn = on
    for (const id of ['#kCopy', '#kCut', '#kDel']) $(id).disabled = !on
  }

  function deleteSelectedKeys() {
    const keys = state.dope.keySel
    if (!keys.length) return false
    edit((r) => `已删除 ${r.deleted} 个关键帧`, (j) => Ops.deleteKeys(j, state.anim, keys), () => { state.dope.keySel = [] })
    return true
  }

  function keyCurveMenu(x, y) {
    const keys = state.dope.keySel
    if (!keys.length) return
    closeMenu()
    const cur = Ops.keyCurve(state.json, state.anim, keys[0])
    const item = (label, kind) => h('button', { onclick: () => { closeMenu(); edit(`已改为${label}`, (j) => Ops.setKeyCurve(j, state.anim, keys, kind)) } },
      h('span', { class: 'dot', 'data-on': cur === kind ? '1' : null }), label)
    const menu = h('div', { class: 'menu', id: 'menu', style: `left:${Math.round(x)}px;top:${Math.round(y)}px` },
      ...(keys.every((k) => k.path[0] === 'events') ? [] : [item('线性', 'linear'), item('阶梯', 'stepped'), item('贝塞尔', 'ease')]),
      h('button', { onclick: () => { closeMenu(); deleteSelectedKeys() } }, h('span', { style: 'width:16px' }), `删除（${keys.length}）`))
    mountMenu(menu)
    const mr = menu.getBoundingClientRect()
    if (mr.bottom > innerHeight - 8) menu.style.top = Math.round(y - mr.height) + 'px'
  }

  function bindDope() {
    const c = $('#dope')
    const at = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    c.addEventListener('pointerdown', (e) => {
      if (!animOn()) return
      const d = state.dope
      d.focus = true
      const [x, y] = at(e)
      c.setPointerCapture(e.pointerId)
      if (e.button === 2 || e.button === 1) { d.drag = { kind: 'pan', x0: x, f0: d.f0, moved: false, button: e.button }; return }
      const hit = dopeHit(x, y)
      if (hit.kind === 'ruler') { d.drag = { kind: 'scrub' }; setFrame(dopeF(x)); return }
      if (hit.kind === 'name') { if (hit.row && hit.row.sel) select(hit.row.sel, false, { noReveal: false }); return }
      if (hit.kind === 'scale') {
        const { f1, f2 } = hit.span
        d.drag = { kind: 'scale', edge: hit.edge, pivot: hit.edge === 'end' ? f1 : f2, from: hit.edge === 'end' ? f2 : f1, factor: 1, moved: false }
        return
      }
      if (hit.kind === 'key') {
        const mod = e.ctrlKey || e.metaKey
        if (mod && (e.altKey || e.shiftKey)) {
          // Spine: Ctrl+Alt drag = 偏移, Ctrl+Shift drag = duplicate the picked keys
          if (!hit.keys.every(isKeySel)) d.keySel = hit.keys.slice()
          d.drag = { kind: 'move', x0: x, df: 0, moved: false, offset: e.altKey, dup: e.shiftKey && !e.altKey }
          return
        }
        if (mod) {
          const all = hit.keys.every(isKeySel)
          d.keySel = all ? d.keySel.filter((k) => !hit.keys.some((h2) => pathId(h2.path) === pathId(k.path) && Math.abs(h2.time - k.time) < 1e-4)) : [...d.keySel, ...hit.keys.filter((k) => !isKeySel(k))]
        } else if (!hit.keys.every(isKeySel)) d.keySel = hit.keys.slice()
        d.drag = { kind: 'move', x0: x, df: 0, moved: false, shift: e.altKey }
        return
      }
      d.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, moved: false, add: e.ctrlKey || e.metaKey }
    })
    c.addEventListener('pointermove', (e) => {
      const d = state.dope
      const [x, y] = at(e)
      if (!d.drag) { const cursor = animOn() && dopeHit(x, y).kind === 'scale' ? 'ew-resize' : ''; if (c.style.cursor !== cursor) c.style.cursor = cursor; return }
      if (d.drag.kind === 'pan') { if (Math.abs(x - d.drag.x0) > 3) d.drag.moved = true; d.f0 = Math.max(0, d.drag.f0 - (x - d.drag.x0) / d.pxf); return }
      if (d.drag.kind === 'scrub') { setFrame(dopeF(x)); return }
      if (d.drag.kind === 'move') {
        let df = Math.round((x - d.drag.x0) / d.pxf)
        // no key goes before frame 0 (an 偏移 drag wraps round the loop instead)
        if (!(d.offset || d.drag.offset) && d.keySel.length) { const minF = Math.min(...d.keySel.map((k) => Math.round(k.time * FPS))); df = Math.max(df, -minF) }
        d.drag.df = df; if (d.drag.df) d.drag.moved = true; return
      }
      if (d.drag.kind === 'scale') {
        // the dragged end follows the cursor's frame; never shorter than a frame, never flipped
        const g = d.drag, span = g.from - g.pivot
        const factor = Math.max(1 / Math.abs(span), (Math.max(0, Math.round(dopeF(x))) - g.pivot) / span)
        if (factor !== g.factor) { g.factor = factor; g.moved = true }
        return
      }
      if (d.drag.kind === 'box') { d.drag.x1 = x; d.drag.y1 = y; if (Math.hypot(x - d.drag.x0, y - d.drag.y0) > 3) d.drag.moved = true }
    })
    const up = (e) => {
      const d = state.dope
      const g = d.drag
      d.drag = null
      setTimeout(renderCurvePanel, 0)
      if (!g) return
      if (g.kind === 'pan') { if (!g.moved && g.button === 2) { const [x, y] = at(e); const hit = dopeHit(x, y); if (hit.kind === 'key') { if (!hit.keys.every(isKeySel)) d.keySel = hit.keys.slice(); keyCurveMenu(e.clientX, e.clientY) } } return }
      if (g.kind === 'scale') {
        if (g.moved && Math.abs(g.factor - 1) > 1e-9) {
          const keys = d.keySel.slice()
          edit(`已缩放 ${keys.length} 个关键帧的时长 ×${g.factor.toFixed(2)}`, (j) => Ops.scaleKeys(j, state.anim, keys, g.pivot / FPS, g.factor, { snap: 1 / FPS }), (r) => { state.dope.keySel = r.keys })
        }
        return
      }
      if (g.kind === 'move') {
        if (g.df) {
          const keys = d.keySel.slice()
          if (g.dup) {
            const clip = Ops.copyKeys(state.json, state.anim, keys)
            const t0 = Math.min(...keys.map((k) => k.time))
            edit(`已复制 ${clip.length} 个关键帧到 ${g.df > 0 ? '+' : ''}${g.df} 帧`, (j) => Ops.pasteKeys(j, state.anim, clip, t0 + g.df / FPS), (r) => { state.dope.keySel = r.keys })
            return
          }
          const shift = d.shift || g.shift, offset = d.offset || g.offset
          const how = offset ? '（偏移）' : shift ? '（移位）' : ''
          // 偏移 turns the whole timeline of every picked key round the loop (Spine), not the picked keys alone
          const moving = offset ? [...new Set(keys.map((k) => pathId(k.path)))].flatMap((id) => { const path = JSON.parse(id); return (keyList(path) || []).map((k) => ({ path, time: k.time || 0 })) }) : keys
          edit(`已移动 ${moving.length} 个关键帧 ${g.df > 0 ? '+' : ''}${g.df} 帧${how}`, (j) => Ops.moveKeys(j, state.anim, moving, g.df / FPS, { shift, offset }), (r) => { state.dope.keySel = r.keys })
        }
        return
      }
      if (g.kind === 'box') {
        if (!g.moved) { if (!g.add) d.keySel = []; setFrame(dopeF(g.x0)); return }
        const fa = dopeF(Math.min(g.x0, g.x1)), fb = dopeF(Math.max(g.x0, g.x1))
        const ia = Math.floor((Math.min(g.y0, g.y1) - DOPE.rulerH + d.scrollY) / DOPE.rowH), ib = Math.floor((Math.max(g.y0, g.y1) - DOPE.rulerH + d.scrollY) / DOPE.rowH)
        const picked = []
        d.rows.forEach((r, i) => {
          if (i < ia || i > ib) return
          for (const k of rowKeys(r)) if (k.frame >= fa && k.frame <= fb) picked.push(...k.keys)
        })
        d.keySel = g.add ? [...d.keySel, ...picked.filter((k) => !isKeySel(k))] : picked
        status(`已选 ${d.keySel.length} 个关键帧`)
      }
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('dblclick', (e) => {
      const [x, y] = at(e)
      const hit = dopeHit(x, y)
      if (hit.kind === 'key') { state.dope.keySel = hit.keys.slice(); deleteSelectedKeys() }
    })
    c.addEventListener('wheel', (e) => {
      if (!animOn()) return
      e.preventDefault()
      const d = state.dope
      const [x] = at(e)
      if (x < DOPE.nameW || e.shiftKey) {
        const max = Math.max(0, d.rows.length * DOPE.rowH - (c.clientHeight - DOPE.rulerH) + 8)
        d.scrollY = Math.max(0, Math.min(max, d.scrollY + e.deltaY))
        return
      }
      // the left edge holds still and the sheet stretches to the right (user 2026-10-12: 滚轴拉长
      //应该是右边越来越长, not around the pointer); frame 0 never scrolls past the first column
      d.pxf = Math.max(2, Math.min(80, d.pxf * Math.pow(1.0015, -e.deltaY)))
      d.f0 = Math.max(0, d.f0)
      drawDope()
    }, { passive: false })
    // a press anywhere else hands the keyboard (Delete / Ctrl+C / Ctrl+V) back to the rest
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#dope')) state.dope.focus = false }, true)
  }

  // ------------------------------------------------------------------ curve editor (Spine 3.8 graph)
  //
  // Spine 3.8 keeps one bezier per key: from that key to the next one, in normalised time
  // and value, two handles (cx1, cy1) / (cx2, cy2). The panel shows the first picked key's
  // curve; dragging a handle or a preset sets it on every picked key that has a next key.

  const CURVE_PRESETS = [
    ['线性', 'linear', [0, 0, 1, 1], '<svg viewBox="0 0 16 16"><path d="M3 13 13 3" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="1.5" y="11.5" width="3" height="3" fill="currentColor"/><rect x="11.5" y="1.5" width="3" height="3" fill="currentColor"/></svg>'],
    ['阶梯', 'stepped', null, '<svg viewBox="0 0 16 16"><path d="M3 13h5V3h5" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="1.5" y="11.5" width="3" height="3" fill="currentColor"/><rect x="11.5" y="1.5" width="3" height="3" fill="currentColor"/></svg>'],
    ['贝塞尔', 'bezier', [0.25, 0, 0.75, 1], '<svg viewBox="0 0 16 16"><path d="M3 13C9 13 7 3 13 3" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="1.5" y="11.5" width="3" height="3" fill="currentColor"/><rect x="11.5" y="1.5" width="3" height="3" fill="currentColor"/></svg>'],
  ]
  const TRACK_LABEL = { rotate: '旋转', translate: '平移', scale: '缩放', shear: '斜切', attachment: '附件', color: '颜色' }

  function curveTarget() {
    const withCurve = state.dope.keySel.filter((x) => x.path[0] !== 'events')
    const k = withCurve[0]
    if (!k || !animOn()) return null
    const next = Ops.nextKeyTime(state.json, state.anim, k)
    const keys = withCurve.filter((x) => Ops.nextKeyTime(state.json, state.anim, x) !== null)
    return { key: k, next, keys, bez: Ops.keyBezier(state.json, state.anim, k) }
  }

  function trackName(path) {
    if (path[0] === 'bones') return `${path[1]} · ${TRACK_LABEL[path[2]] || path[2]}`
    if (path[0] === 'slots') return `${path[1]} · ${TRACK_LABEL[path[2]] || path[2]}`
    if (path[0] === 'deform') return `${path[2]} · 网格`
    if (path[0] === 'ik' || path[0] === 'transform') return `${path[1]} · 混合`
    if (path[0] === 'events') return `${path[1]} · 事件`
    return '绘制顺序'
  }

  function renderCurvePanel() {
    const panel = $('#curvePanel')
    if (!panel || panel.hidden) return
    const t = curveTarget()
    const title = $('#cpTitle')
    const presets = $('#cpPresets')
    presets.textContent = ''
    presets.append(h('span', { class: 'cl' }, '曲线：'))
    if (!t) title.textContent = '在摄影表里点一个关键帧'
    else {
      const f0 = Math.round(t.key.time * FPS), f1 = t.next == null ? null : Math.round(t.next * FPS)
      title.textContent = `${trackName(t.key.path)} · ${f1 == null ? `第 ${f0} 帧（最后一帧）` : `第 ${f0} → ${f1} 帧`}${state.dope.keySel.length > 1 ? ` · 已选 ${state.dope.keySel.length} 个` : ''}`
    }
    const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-3)
    const linear = t && t.bez.kind !== 'stepped' && same(t.bez.c, [0, 0, 1, 1])
    for (const [label, id, c, icon] of CURVE_PRESETS) {
      const on = t && (id === 'stepped' ? t.bez.kind === 'stepped' : id === 'linear' ? linear : t.bez.kind !== 'stepped' && !linear)
      presets.append(h('button', { class: 'cb', 'aria-pressed': String(!!on), title: label, html: icon, disabled: !t || !t.keys.length,
        onclick: () => applyCurve(id === 'stepped' ? 'stepped' : c, label) }))
    }
  }

  function applyCurve(c, label) {
    const t = curveTarget()
    if (!t || !t.keys.length) return
    const keys = t.keys
    if (c === 'stepped') edit(`${keys.length} 个关键帧改为阶梯`, (j) => Ops.setKeyCurve(j, state.anim, keys, 'stepped'))
    else edit(`${keys.length} 个关键帧改为${label || '自定义曲线'}`, (j) => Ops.setKeyBezier(j, state.anim, keys, c))
  }

  function curveBox() {
    const c = $('#curve')
    const W = c.clientWidth, Hh = c.clientHeight
    const t = curveTarget()
    const cc = state.dope.curveDrag ? state.dope.curveDrag.c : t ? t.bez.c : [0, 0, 1, 1]
    const ymin = Math.min(0, cc[1], cc[3]) - 0.1, ymax = Math.max(1, cc[1], cc[3]) + 0.1
    const m = 16
    return {
      W, Hh, cc, t,
      px: (x) => m + x * (W - 2 * m),
      py: (v) => Hh - m - (v - ymin) / (ymax - ymin) * (Hh - 2 * m),
      ix: (px) => (px - m) / (W - 2 * m),
      iy: (py) => ymin + (Hh - m - py) / (Hh - 2 * m) * (ymax - ymin),
    }
  }

  function drawCurve() {
    const c = $('#curve')
    if (!c || c.offsetParent === null) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.max(1, c.clientWidth), Hh = Math.max(1, c.clientHeight)
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(Hh * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr) }
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, W, Hh)
    const B = curveBox()
    const { px, py, cc, t } = B
    // grid + the 0..1 box
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const x = Math.round(px(i / 4)) + 0.5, y = Math.round(py(i / 4)) + 0.5
      ctx.beginPath(); ctx.moveTo(x, py(0)); ctx.lineTo(x, py(1)); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(px(0), y); ctx.lineTo(px(1), y); ctx.stroke()
    }
    ctx.strokeStyle = '#333'; ctx.strokeRect(px(0), py(1), px(1) - px(0), py(0) - py(1))
    ctx.setLineDash([3, 4]); ctx.strokeStyle = '#3a3a3a'
    ctx.beginPath(); ctx.moveTo(px(0), py(0)); ctx.lineTo(px(1), py(1)); ctx.stroke(); ctx.setLineDash([])
    if (!t || t.next == null) return
    const stepped = !state.dope.curveDrag && t.bez.kind === 'stepped'
    ctx.strokeStyle = '#e6e6e6'; ctx.lineWidth = 2
    ctx.beginPath()
    if (stepped) { ctx.moveTo(px(0), py(0)); ctx.lineTo(px(1), py(0)); ctx.lineTo(px(1), py(1)) }
    else {
      for (let i = 0; i <= 48; i++) {
        const u = i / 48, a = 1 - u
        const x = 3 * a * a * u * cc[0] + 3 * a * u * u * cc[2] + u * u * u
        const y = 3 * a * a * u * cc[1] + 3 * a * u * u * cc[3] + u * u * u
        if (i) ctx.lineTo(px(x), py(y)); else ctx.moveTo(px(x), py(y))
      }
    }
    ctx.stroke()
    // handles
    if (!stepped) {
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#1EA672'
      ctx.beginPath(); ctx.moveTo(px(0), py(0)); ctx.lineTo(px(cc[0]), py(cc[1])); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(px(1), py(1)); ctx.lineTo(px(cc[2]), py(cc[3])); ctx.stroke()
      for (const [hx, hy] of [[cc[0], cc[1]], [cc[2], cc[3]]]) {
        ctx.beginPath(); ctx.arc(px(hx), py(hy), 5.5, 0, Math.PI * 2); ctx.fillStyle = '#1EA672'; ctx.fill()
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#0e3a2a'; ctx.stroke()
      }
    }
    ctx.fillStyle = '#fff'
    for (const [x, y] of [[0, 0], [1, 1]]) ctx.fillRect(px(x) - 3, py(y) - 3, 6, 6)
  }

  function bindCurve() {
    const c = $('#curve')
    const at = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    c.addEventListener('pointerdown', (e) => {
      const t = curveTarget()
      if (!t || t.next == null || !t.keys.length) return
      const B = curveBox()
      const [x, y] = at(e)
      const start = t.bez.kind === 'bezier' ? t.bez.c.slice() : [0, 0, 1, 1]
      const d1 = Math.hypot(x - B.px(start[0]), y - B.py(start[1]))
      const d2 = Math.hypot(x - B.px(start[2]), y - B.py(start[3]))
      if (Math.min(d1, d2) > 12) return
      state.dope.curveDrag = { handle: d1 <= d2 ? 0 : 1, c: start }
      c.setPointerCapture(e.pointerId)
    })
    c.addEventListener('pointermove', (e) => {
      const g = state.dope.curveDrag
      if (!g) return
      const B = curveBox()
      const [x, y] = at(e)
      const nx = Math.max(0, Math.min(1, B.ix(x))), ny = Math.max(-1, Math.min(2, B.iy(y)))
      if (g.handle === 0) { g.c[0] = nx; g.c[1] = ny } else { g.c[2] = nx; g.c[3] = ny }
    })
    const up = () => {
      const g = state.dope.curveDrag
      if (!g) return
      state.dope.curveDrag = null
      applyCurve(g.c.map((v) => Math.round(v * 1000) / 1000))
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    $('#dopeFilter').onclick = (e) => { e.stopPropagation(); dopeFilterMenu($('#dopeFilter')) }
    $('#kCopy').onclick = copySelectedKeys
    $('#kCut').onclick = cutSelectedKeys
    $('#kDel').onclick = deleteSelectedKeys
    for (const b of document.querySelectorAll('#dopeModes button[data-m]')) {
      b.onclick = () => {
        const m = b.dataset.m
        state.dope[m] = !state.dope[m]
        // 移位 and 偏移 are two ways of moving keys: one at a time
        if (m === 'shift' && state.dope.shift) state.dope.offset = false
        if (m === 'offset' && state.dope.offset) state.dope.shift = false
        syncTimeline()
      }
    }
  }

  // ------------------------------------------------------------------ chrome

  function refresh() {
    $('#stage').dataset.tool = state.tool
    const pick = state.pick
    $('#pickbar').hidden = !pick
    $('#stage').dataset.pick = pick ? '1' : ''
    if (pick) {
      $('#pickText').textContent = pick.text
      const ex = $('#pickExtra')
      ex.hidden = !pick.extra
      if (pick.extra) { ex.textContent = pick.extra.label; ex.onclick = pick.extra.run }
    }
    if (state.meshEdit && !meshEditContext()) state.meshEdit = null
    if (state.weightEdit && !weightContext()) state.weightEdit = null
    pose()
    syncTimeline()
    buildDope()
    renderTree()
    renderProps()
    renderStage()
    renderCurvePanel()
    renderMeshPanel()
    renderWeightPanel()
    renderPreview()
    if (state.leftOpen === 'mesh' || state.leftOpen === 'weights') renderLeft()
    renderLayerDock()
    renderTracePanel()
    if (state.clipEdit && (state.mode !== 'setup' || !clipRuntime())) state.clipEdit = null
    renderClipPanel()
    layoutFloats()
    notifyHost()
  }

  /** The transform panel stays (Spine): it sits over the layer cards; the left panels stop above it. */
  function layoutFloats() {
    const xf = $('#xform'), dock = $('#layerDock')
    const stage = xf.parentElement
    stage.style.setProperty('--dockh', dock.hidden ? '0px' : `${dock.offsetHeight + 10}px`)
    stage.style.setProperty('--xfh', xf.hidden ? '0px' : `${xf.offsetHeight + 10}px`)
    // the 编辑网格 panel stays centred unless that would put it over the transform panel
    for (const mp of [$('#meshPanel'), $('#clipPanel')]) {
      if (mp.hidden) continue
      const xr = xf.hidden ? 0 : xf.offsetLeft + xf.offsetWidth + 10
      const left = Math.max(stage.clientWidth / 2 - mp.offsetWidth / 2, xr)
      mp.style.left = `${left}px`
      mp.style.transform = 'none'
    }
  }

  function bindChrome() {
    // the layer cards wrap into more rows after the first layout pass (thumbnails, width changes):
    // the transform panel sat under them until the next refresh — follow their size instead
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => layoutFloats()); ro.observe($('#layerDock')); ro.observe($('#xform')) }
    $('#fileDir').onchange = (e) => run(() => loadFiles(e.target.files))
    $('#fileMany').onchange = (e) => run(() => loadFiles(e.target.files))
    for (const [id, field, multi] of [['#pickJson', 'json'], ['#pickAtlas', 'atlas'], ['#pickPng', 'images', true]]) {
      $(id).onchange = (e) => { state.importFiles[field] = multi ? Array.from(e.target.files) : e.target.files[0] || null; renderLeft() }
    }
    $('#railExport').onclick = openExportDialog
    bindPreview()
    $('#fit').onclick = fit
    $('#pickCancel').onclick = endPick
    $('#play').onclick = togglePlay
    // 首帧 shows frame 0 at the left edge; 尾帧 puts the last frame at the right edge of the
    // visible sheet (user 2026-10-12), a few px in so its key stays whole
    $('#tStart').onclick = () => { state.dope.f0 = 0; gotoFrame(0); drawDope() }
    $('#tBack').onclick = () => gotoFrame(state.frame - 1)
    $('#tFwd').onclick = () => gotoFrame(state.frame + 1)
    $('#tEnd').onclick = () => {
      const c = $('#dope'), d = state.dope, last = lastFrame()
      const span = c ? Math.max(1, c.clientWidth - DOPE.nameW - 10) / d.pxf : 0
      d.f0 = Math.max(0, last - span)
      gotoFrame(last); drawDope()
    }
    $('#tLoop').onclick = () => { state.loop = !state.loop; syncTimeline() }
    for (const [id, ic] of [['#tStart', 'toStart'], ['#tBack', 'stepBack'], ['#tFwd', 'stepFwd'], ['#tEnd', 'toEnd'], ['#tLoop', 'loop']]) $(id).innerHTML = ICON[ic]
    // drag bar between the tree and the properties (remembered per browser)
    const right = $('.right')
    try { const hh = localStorage.getItem('nf-skel-props-h'); if (hh) right.style.setProperty('--props-h', hh) } catch {}
    $('#split').addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const box = right.getBoundingClientRect()
      const move = (ev) => {
        const px = Math.max(160, Math.min(box.height - 200, box.bottom - ev.clientY))
        right.style.setProperty('--props-h', px + 'px')
      }
      const done = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', done)
        try { localStorage.setItem('nf-skel-props-h', right.style.getPropertyValue('--props-h')) } catch {}
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', done)
    })
    $('#treeOpen').onclick = () => treeExpand(true)
    $('#treeClose').onclick = () => treeExpand(false)
    $('#treeFilter').onclick = (e) => { e.stopPropagation(); filterMenu(e.currentTarget) }
    const search = $('#search')
    search.addEventListener('input', () => { state.search = search.value; state.searchIdx = null; renderTree() })
    search.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' || e.key === 'F3') { e.preventDefault(); searchNext(e.shiftKey) }
      if (e.key === 'Escape') { search.value = ''; state.search = ''; renderTree(); search.blur() }
    })
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#menu')) closeMenu() }, true)
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift' && !state.shiftHeld) state.shiftHeld = true })
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') state.shiftHeld = false })
    window.addEventListener('blur', () => { state.shiftHeld = false })
    let frameKey = null
    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)
      // Ctrl+A: the picked bone and its whole branch; with a search on, only the branch rows the
      // tree shows (the matches and their ancestors)
      // (Ctrl+A never selects the page's text - with no bone picked it does nothing)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && e.key.toLowerCase() === 'a') e.preventDefault()
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && e.key.toLowerCase() === 'a' && state.json && state.sel && state.sel.kind === 'bone') {
        const m = searchMatches(), names = [state.sel.name], j = state.json
        const walk = (p) => { for (const b of j.bones) if (b.parent === p && (!m || m.bones.has(b.name))) { names.push(b.name); walk(b.name) } }
        walk(state.sel.name)
        // everything keyable under the branch comes along into the dopesheet: its slots, the
        // constraints on its bones, and (from a root bone) the events
        const set = new Set(names), F = state.filter
        const slots = F.slots === false ? [] : j.slots.filter((x) => set.has(x.bone) && (!m || m.slots.has(x.name) || m.bones.has(x.bone))).map((x) => x.name)
        const cons = ['ik', 'transform', 'path'].flatMap((kind) => (j[kind] || []).filter((c) => (c.bones || []).some((b) => set.has(b)) || set.has(c.target)).map((c) => ({ kind, name: c.name })))
        const root = !bone(state.sel.name).parent
        const events = root ? Object.keys(j.events || {}) : []
        // the slots show as picked in the tree too (多选 edits apply to them)
        state.multi = F.bones === false ? [] : names; state.multiSlots = slots
        state.dopeExtra = { slots, cons, events }
        pushHistory(); refresh()
        return
      }
      if (state.clipEdit && !typing && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); exitClipEdit(); return }
      if (state.weightEdit && !typing && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault()
        const we = state.weightEdit
        if (we.binding) { if (e.key === 'Enter') finishBind(); else { we.binding = null; renderWeightPanel() } return }
        if (e.key === 'Escape' && we.direct && we.vsel.size) { we.vsel = new Set(); renderWeightPanel(); return }
        exitWeightEdit()
        return
      }
      if (state.meshEdit && !typing) {
        const me = state.meshEdit
        if (e.key === 'Escape') { e.preventDefault(); if (me.trace) closeTrace(false); else if (me.draft) { me.draft = null; renderMeshPanel() } else exitMeshEdit(); return }
        if (e.key === 'Enter') { e.preventDefault(); if (me.trace) closeTrace(true); else if (me.draft) finishDraft(); else exitMeshEdit(); return }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteMeshVertices(); return }
      }
      if (e.key === 'Escape') {
        if (document.getElementById('menu')) { closeMenu(); return }
        if (state.pick) { endPick(); return }
        if (!typing) { select(null); return }
      }
      if (typing) return
      const k = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      else if (mod && k === 'c' && state.dope.focus && state.dope.keySel.length) { e.preventDefault(); copySelectedKeys() }
      else if (mod && k === 'x' && state.dope.focus && state.dope.keySel.length) { e.preventDefault(); cutSelectedKeys() }
      else if (mod && k === 'v' && state.dope.focus && state.dope.clip && animOn()) {
        e.preventDefault()
        const clip = state.dope.clip
        edit(`已在第 ${state.frame} 帧粘贴 ${clip.length} 个关键帧`, (j) => Ops.pasteKeys(j, state.anim, clip, timeSec()), (r) => { state.dope.keySel = r.keys })
      }
      else if (mod && k === 'd') { e.preventDefault(); duplicateSelection() }
      else if (mod && k === 'h') { e.preventDefault(); state.hiddenBones.clear(); state.hiddenSlots.clear(); refresh(); status('已显示全部骨骼和插槽') }
      else if (mod && /^[0-9]$/.test(e.key)) { e.preventDefault(); state.groups[e.key] = JSON.stringify({ sel: state.sel, multi: state.multi }); status(`选择已存到 ${e.key}`) }
      else if (mod) return
      else if (/^[0-9]$/.test(e.key)) { if (state.groups[e.key]) { restoreSelection(state.groups[e.key]); pushHistory() } }
      else if (e.key === 'PageUp') { e.preventDefault(); if (state.selIdx > 0) restoreSelection(state.selHistory[--state.selIdx]) }
      else if (e.key === 'PageDown') { e.preventDefault(); if (state.selIdx < state.selHistory.length - 1) restoreSelection(state.selHistory[++state.selIdx]) }
      else if (e.key === 'Delete') { if (!(state.dope.focus && deleteSelectedKeys())) deleteSelection() }
      else if (e.key === 'F2') { e.preventDefault(); focusRename() }
      else if (e.key === 'Enter') { e.preventDefault(); search.focus() }
      else if (e.key === ' ') { e.preventDefault(); if (animOn()) togglePlay(); else select(null) }
      else if ((k === 'a' || k === 'd') && animOn() && !e.altKey) {
        e.preventDefault()
        const now = performance.now(), prev = frameKey
        frameKey = { k, t: now }
        if (prev && prev.k === k && now - prev.t < 260) { frameKey = null; gotoFrame(k === 'a' ? 0 : lastFrame()) }
        else gotoFrame(state.frame + (k === 'a' ? -1 : 1))
      }
      else if (k === 'c') setTool('rotate')
      else if (k === 'v') setTool('move')
      else if (k === 'x') setTool('scale')
      else if (k === 'z') setTool('shear')
      else if (k === 'n') setTool('create')
      else if (k === 'b') setTool('pose')
      else if (k === 'p') setParentForSelection()
      else if (k === 'k') keyEdited()
    })
  }

  initGl()
  bindChrome()
  bindViewport()
  bindDope()
  bindCurve()
  refresh()
  requestAnimationFrame(loop)

  renderLeft()
  // ------------------------------------------------------------------ the 骨骼动画 section (host API)
  //
  // spine-skeleton-editor.host.js feeds the app's imported project in, its left panels
  // (骨骼架设 / 蒙皮 / 权重 / 动画工具) call these, and it hears every change so the app's
  // own project (动画工具, 飘带) keeps in step. Changes the host applies (the animation tools
  // writing the app's project) come back through applyExternal, one undo step per tool run.

  // var: refresh() runs during start-up, before this part of the file
  var hostListeners = new Set()
  var hostSeen = { json: null, bone: undefined, anim: undefined, mode: undefined, panel: undefined, external: null, modal: false }
  // a dialog's mask only dims this frame (the stage): the host dims the rest of the page while
  // one is open, as the other sections' dialogs do (user 2026-10-12: 黑色遮罩应该全屏)
  new MutationObserver(() => {
    const open = !!document.querySelector('body > .mask')
    if (open === hostSeen.modal) return
    hostSeen.modal = open
    for (const fn of hostListeners) { try { fn('modal', { open }) } catch (e) { console.warn('[skeleton editor] host', e) } }
  }).observe(document.body, { childList: true })
  function notifyHost() {
    if (!hostListeners || !hostListeners.size) return
    const send = (type, data) => { for (const fn of hostListeners) { try { fn(type, data) } catch (e) { console.warn('[skeleton editor] host', e) } } }
    const bone = state.sel && state.sel.kind === 'bone' ? state.sel.name : null
    if (state.json !== hostSeen.json) { hostSeen.json = state.json; send('change', { json: state.json, external: state.json === hostSeen.external }) }
    if (bone !== hostSeen.bone) { hostSeen.bone = bone; send('select', { bone }) }
    if (state.anim !== hostSeen.anim) { hostSeen.anim = state.anim; send('anim', { anim: state.anim }) }
    if (state.mode !== hostSeen.mode) { hostSeen.mode = state.mode; send('mode', { mode: state.mode }) }
    // `closed`: the cards' × (the host folds 动画工具 for 序列K帧 / 序列扫光); a tool switch closes them without it
    if (state.leftOpen !== hostSeen.panel) { hostSeen.panel = state.leftOpen; const closed = state.leftClosedByUser || null; state.leftClosedByUser = null; send('panel', { panel: state.leftOpen, closed }) }
  }

  // an outside change (the 动画工具 previews) — consecutive ones with the same label share one undo step
  let extStep = null
  function applyExternal(json, label) {
    if (!state.json || !json) return
    const next = Ops.tidy(Ops.prepare(json))
    const top = state.history[state.history.length - 1]
    if (!(extStep && extStep.label === label && top === extStep.snap)) {
      const before = snapshot()
      state.history.push(before)
      if (state.history.length > 200) state.history.shift()
      state.future = []
      extStep = { label, snap: before }
    }
    hostSeen.external = next
    applyJson(next)
    validateSelection()
    refresh()
  }

  /** 自动架设 (骨骼架设): the app's medial-axis rig builder on the region layers, one undo step. */
  async function autoRig(say) {
    const tell = typeof say === 'function' ? say : () => {}
    const json = state.json
    if (!json) throw new Error('先导入工程')
    const P = window.parent !== window ? window.parent : window
    const AB = P.NovaFlowAutoBones || window.NovaFlowAutoBones
    if (!AB) throw new Error('自动骨架模块未加载')
    const meshed = json.skins.some((k) => Object.values(k.attachments || {}).some((m) => Object.values(m || {}).some((a) => a && (a.type === 'mesh' || a.type === 'linkedmesh'))))
    if (meshed) throw new Error('工程里已有网格：先在「蒙皮」里「还原初始图层」，再自动架设')
    const mats = setupMatrices()
    const layers = []
    for (const slot of json.slots) {
      const name = slot.attachment
      if (!name) continue
      const a = attOf(json, 'default', slot.name, name)
      if (!a || (a.type && a.type !== 'region')) continue
      const live = rt.skeleton && rt.skeleton.findSlot(slot.name)
      const att = live && live.getAttachment()
      const region = att && att.region
      if (!region) continue
      const w = Math.round(region.originalWidth || region.width), hh = Math.round(region.originalHeight || region.height)
      tell(`读取图层 ${layers.length + 1}…`)
      const px = regionPixels(region, w, hh)
      if (!px) continue
      const m = mats[slot.bone]
      const ax = Number(a.x) || 0, ay = Number(a.y) || 0
      const place = m ? { x: m.a * ax + m.b * ay + m.worldX, y: m.c * ax + m.d * ay + m.worldY } : { x: ax, y: ay }
      layers.push({ name: slot.name, att: name, width: w, height: hh, rgba: px, place })
    }
    if (!layers.length) throw new Error('没有可分析的图层（需要有贴图的图片附件）')
    tell(`分析 ${layers.length} 层的中轴并搭建骨架…`)
    await new Promise((r) => setTimeout(r, 30))
    const pool = P.NovaFlowAutoMeshPanel && P.NovaFlowAutoMeshPanel._buildSkeletonOffThread
    const built = pool ? await pool(layers).catch(() => AB.buildSkeleton(layers)) : AB.buildSkeleton(layers)
    const next = JSON.parse(JSON.stringify(AB.applyToSkeleton(JSON.parse(JSON.stringify(json)), built)))
    const r = edit(`自动架设完成 · ${built.bones.length} 根骨`, () => ({ json: Ops.tidy(Ops.prepare(next)) }))
    if (!r) throw new Error('自动架设的结果没能载入')
    return { bones: built.bones.length, ik: ((built.json && built.json.ik) || []).length, layers: layers.length }
  }
  const attOf = (json, skin, slot, name) => (((json.skins.find((x) => x.name === skin) || { attachments: {} }).attachments || {})[slot] || {})[name]

  /** The left panels open / close (one at a time, the host enforces it). */
  function setPanel(kind, open) {
    if (!state.json) return
    if (kind === 'mesh' || kind === 'weights') {
      // 权重 works in 动画 mode too (the posed mesh is painted); 蒙皮 edits the mesh itself, in 设置
      if (open) { if (kind === 'mesh' && state.mode !== 'setup') setMode('setup'); state.meshEdit = null; state.weightEdit = null; state.leftOpen = kind }
      else if (state.leftOpen === kind) state.leftOpen = null
    } else if (kind === 'bones') {
      if (open) { state.leftOpen = null; if (state.mode !== 'setup') setMode('setup'); state.opt.boneVis = true }
    } else if (kind === 'sequence' || kind === 'sweep') {
      // 序列K帧 / 序列扫光 (动画工具): the layer cards over the stage, in 动画
      if (open) {
        state.meshEdit = null; state.weightEdit = null; state.leftOpen = kind
        // the picked bone is where the pictures go (user 2026-10-12: 选了哪个就默认放在哪个骨骼里)
        const picked = state.sel && state.sel.kind === 'bone' ? state.sel.name : (state.multi && state.multi[0]) || ''
        if (picked && state.json.bones.some((b) => b.name === picked)) state.frameBone = picked
        if (state.mode !== 'animate') {
          const names = Object.keys(state.json.animations || {})
          if (names.length) { if (!names.includes(state.anim)) state.anim = names[0]; setMode('animate') }
        }
        // the frame tools write keys: the full dopesheet stays up (user 2026-10-12), whether or not a
        // calculation tool folded it before
        unfoldTimeline()
      } else if (state.leftOpen === kind) state.leftOpen = null
    } else if (kind === 'frames') {
      // a calculation tool picked: 序列K帧 / 序列扫光's cards go
      if (!open && (state.leftOpen === 'sequence' || state.leftOpen === 'sweep')) state.leftOpen = null
    } else if (kind === 'motion') {
      if (!open && (state.leftOpen === 'sequence' || state.leftOpen === 'sweep')) state.leftOpen = null
      if (open) {
        // the frame tools are 动画工具 too: the host's open (it polls, so it may land after the
        // tool's own setPanel) must not take their cards away
        if (state.leftOpen !== 'sequence' && state.leftOpen !== 'sweep') state.leftOpen = null
        // (the timeline no longer folds for the tools — user 2026-10-12: 摄影表高度不要变 — so
        // nothing is promised here; the box positions itself against the full timeline)
        if (state.mode !== 'animate') {
          const names = Object.keys(state.json.animations || {})
          if (names.length) { if (!names.includes(state.anim)) state.anim = names[0]; setMode('animate') }
        }
      }
    }
    refresh()
  }

  /** The full dopesheet back (序列K帧 / 序列扫光 show their keys). */
  function unfoldTimeline() {
    state.compactPending = false
    if (!state.compactTimeline) return
    state.compactTimeline = false
    syncTimeline(); layoutFloats(); drawDope()
  }

  /** The timeline folded to its one row (动画工具): applied now, not promised. */
  function applyCompactTimeline() {
    if (state.compactTimeline) { state.compactPending = false; return }
    state.compactPending = false; state.compactTimeline = true
    const r = state.reservePending; state.reservePending = 0
    if (r) reserveBottom(r)
    syncTimeline(); layoutFloats(); drawDope()
  }

  /** Room above the timeline for the host's floating 动画工具 editor (the stage gets shorter). */
  function reserveBottom(px) {
    // the stage keeps its grid cell and leaves the bottom of it free
    const v = Math.max(0, Math.round(px || 0))
    // a promised fold (动画工具 opening): the reserve waits for the frame the box shows in
    // (the dopesheet no longer folds under the tools, so a promised fold never delays the reserve)
    state.reservePending = 0
    const st = $('#stage')
    if (st.style.marginBottom !== v + 'px') { st.style.marginBottom = v ? v + 'px' : ''; layoutFloats() }
  }

  const tickedOf = () => tickedLayers()
  window.NovaFlowSkeletonEditorAPI = {
    on(fn) { hostListeners.add(fn); return () => hostListeners.delete(fn) },
    loadSource: (src, opts) => loadSource(src, opts),
    json: () => state.json,
    loaded: () => !!state.json,
    selectedBone: () => (state.sel && state.sel.kind === 'bone' ? state.sel.name : null),
    /** The picked slot (a slot row, or an image's slot) with its bone; 透明度计算 works on it. */
    selectedSlot: () => {
      const sel = state.sel
      const name = sel && state.json ? (sel.kind === 'slot' ? sel.name : sel.kind === 'att' ? sel.slot : null) : null
      const slot = name ? state.json.slots.find((s) => s.name === name) : null
      return slot ? { name, bone: slot.bone } : null
    },
    selectBone: (name, additive) => { if (state.json && state.json.bones.some((b) => b.name === name)) select({ kind: 'bone', name }, !!additive) },
    /** The bones the user picked (Ctrl+click adds), without 自动链条's overlay: 飘带 solves one chain per root. */
    selectedBones: () => (state.chainPick && state.chainRoots ? state.chainRoots.slice() : selectedBones()),
    toast: (msg, kind) => status(msg, kind),
    /** 飘带's 自动链条: the picked bone's chain shows as picked with it (the pick itself stays the parent). */
    selectChain: (names) => {
      if (!state.json || !state.sel || state.sel.kind !== 'bone') return
      const same = (a, b) => a && b && a.length === b.length && a.every((n, i) => b[i] === n)
      if (!(names || []).length) {
        if (state.chainPick && same(state.multi, state.chainPick)) { state.multi = state.chainRoots && state.chainRoots.length ? state.chainRoots.slice() : [state.sel.name]; refresh() }
        state.chainPick = null; state.chainRoots = null
        return
      }
      // every picked root keeps its place; the chains come after them
      const roots = state.chainPick && state.chainRoots ? state.chainRoots.slice() : selectedBones()
      const ok = [...roots, ...names.filter((n) => !roots.includes(n) && bone(n))]
      if (same(ok, state.multi)) return
      state.chainRoots = roots; state.multi = ok; state.chainPick = ok
      refresh()
    },
    anim: () => state.anim,
    setAnim: (name) => { if (state.json && state.json.animations[name]) { state.anim = name; if (state.mode !== 'animate') setMode('animate'); else { state.frame = Math.min(state.frame, Math.round(duration() * FPS)); refresh() } } },
    mode: () => state.mode,
    time: () => timeSec(),
    setTime: (sec) => { if (!animOn()) return; const f = Math.max(0, Math.round((Number(sec) || 0) * FPS)); if (f !== state.frame || state.playing) gotoFrame(f) },
    playing: () => !!state.playing,
    applyExternal,
    setPanel,
    /** which left panel / layer-card tool is open (null = none) */
    panel: () => state.leftOpen,
    /** 序列扫光 generator: the picker (底图), then the scheme / parameter panel */
    openSweepGenerator,
    openSweepPanel,
    density: () => state.meshDensity,
    setDensity: (v) => { state.meshDensity = Math.max(2, Math.min(40, Math.round(Number(v) || 18))) },
    /** the batch tools of 蒙皮 / 权重 on the ticked layer cards (status shows the result) */
    autoMesh: () => runBatch(tickedOf(), '自动蒙皮', meshOneLayer),
    restoreMesh: () => runBatch(tickedOf(), '还原初始图层', restoreOneLayer),
    autoWeights: () => runBatch(tickedOf(), '自动权重', (j, L) => weighOneLayer(j, L)),
    restoreWeights: () => runBatch(tickedOf().filter((l) => l.mesh), '还原原始权重', unweighOneLayer),
    autoRig,
    /** whether 自动架设 would replace a rig that animations already use */
    rigUsed: () => !!(state.json && state.json.bones.length > 1 && Object.values(state.json.animations || {}).some((a) => a && a.bones && Object.keys(a.bones).length)),
    restoreProject: () => { if (state.initialJson && state.initialJson !== state.json) edit('已还原为导入时的工程', () => ({ json: state.initialJson })) },
    openExport: (opts) => openExportDialog(opts),
    /** NovaFlow's own project file (.nfproj): every project in it comes in after the open ones. */
    openProjectFile: (data) => openProjectFile(data),
    /** 保存工程: every open project into one .nfproj (a save dialog), no options. */
    saveProjectFile: () => saveProjectFileNow(),
    projectCount: () => projects.length,
    openAtlasSettings: () => openAtlasSettings(),
    /** how many pictures each 打包 choice takes: 附件 (used) / 图片文件夹 */
    packCounts: async () => ({ atts: exportImageNames(Ops.exportable(state.json)).length, folder: (await folderImages()).length }),
    /**
     * The project packed for the app (its player renders 序列帧 / 视频, its 导出 writes the Spine
     * package): JSON + a fresh atlas + page PNGs, as `__NovaFlowSpineImportInlineBridgeCache` takes them.
     */
    ownVersion,
    versions: () => (window.NovaFlowSpineVersion ? window.NovaFlowSpineVersion.TARGETS.slice() : ['3.8']),
    packForApp: async (opts) => {
      const A = window.NovaFlowSequenceAtlas
      const name = A.safeName(stem(state.fileName) || 'skeleton')
      const files = new Map()
      const r = await exportProject({ name, packed: true, mode: opts && opts.mode === 'folder' ? 'folder' : 'atts', version: opts && opts.version, settings: atlasSettings() }, async (rel, data) => { files.set(rel, data) })
      const text = async (d) => (typeof d === 'string' ? d : d instanceof Blob ? d.text() : new TextDecoder().decode(d))
      const dataUrl = (d) => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(d instanceof Blob ? d : new Blob([d], { type: 'image/png' }))
      })
      const images = []
      for (const [rel, d] of files) if (/\.png$/i.test(rel)) images.push({ fileName: rel, dataUrl: await dataUrl(d) })
      return {
        source: { json: { fileName: `${name}.json`, text: await text(files.get(`${name}.json`)) }, atlas: { fileName: `${name}.atlas`, text: await text(files.get(`${name}.atlas`)) }, images },
        missing: r.missing,
      }
    },
    reserveBottom,
    /** where the timeline starts (the host docks 动画工具 above it), in this page's coordinates */
    /** 动画工具 open: the timeline is one row (transport + ruler); off: the whole dopesheet. */
    // on: the fold is only promised (timelineRect already answers with the folded row, so the
    // tools' box is laid out for it) and applied by applyTimelineCompact when that box shows -
    // the timeline, the box and the stage then change in one frame
    setTimelineCompact: (on) => { const v = !!on; if (v) { if (!state.compactTimeline) state.compactPending = true; return } state.compactPending = false; if (!state.compactTimeline) return; state.compactTimeline = false; syncTimeline(); layoutFloats(); drawDope() },
    applyTimelineCompact: () => { if (!state.compactPending || state.compactTimeline) return; applyCompactTimeline() },
    timelineRect: () => {
      const tl = $('.timeline-wrap')
      const r = tl && !tl.closest('[hidden]') && getComputedStyle(tl).display !== 'none' ? tl.getBoundingClientRect() : null
      // a promised fold: the row it will become (42 px at the bottom of the centre column)
      // always the real timeline: the promised one-row bar made the host's anchor sit at the bottom
      // until the tool's box showed, so the box was drawn low for a frame and then jumped up
      // (user 2026-10-12: 展开飘带必闪)
      if (r && r.height) return { left: r.left, top: r.top, width: r.width, height: r.height }
      const st = $('#stage').getBoundingClientRect()
      return { left: st.left, top: st.bottom, width: st.width, height: 0 }
    },
    stageRect: () => { const r = $('#stage').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } },
    undo: () => undo(),
    redo: () => redo(),
    /** a key pressed outside the editor (the host forwards it): true when the editor used it */
    key: (type, init) => {
      if (!state.json) return false
      const ev = new KeyboardEvent(type, { ...init, bubbles: true, cancelable: true })
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)
      if (typing) document.activeElement.blur()
      document.body.dispatchEvent(ev)
      return ev.defaultPrevented
    },
  }

  // the host (the 骨骼动画 section) takes over once the page is set up
  setTimeout(() => {
    try {
      const H = window.parent !== window && window.parent.NovaFlowSkeletonEditor
      if (H && typeof H.attach === 'function') H.attach(window, window.NovaFlowSkeletonEditorAPI)
    } catch (e) { console.warn('[skeleton editor] attach', e) }
  }, 0)

  window.__SkeletonLab = { regionPixelsCanvas, newClipping, enterClipEdit, exitClipEdit, meshOneLayer, autoMeshModel, meshModelOf, regionPixels, enterMeshEdit, enterWeightEdit, meshAction, closeTrace, weightContext, weightBones, exportProject, exportImageNames, folderImages, importIntoFolder, openExportDialog, openImagePicker, addImageFile, folderFromFiles, ensureAtlas, applyJson, dopeX, DOPE, state, rt, loadSample, loadFiles, edit, select, setMode, setSkin, refresh, Ops, setupMatrices, pose, draw, fit, setTool, keyEdited }
})()

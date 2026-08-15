'use strict'

// NovaFlow AI Effect MVP.
// Clean runtime entry for AI VFX candidate generation.
;(() => {
  const APP_ID = 'novaflow-aifx-mvp'
  const STYLE_ID = 'novaflow-aifx-mvp-style'
  const PIPELINE_ID = 'AIFX_SPRITESHEET_CONDITIONED_REGEN_PIPELINE'
  const RUNTIME_SOURCE = 'particle-editor/aifx-repaint-runtime.js'
  const AIFX_PIPELINE_ENDPOINT = '/__aifx_spritesheet_conditioned_regen'
  const AIFX_CANDIDATE_COUNT = 4
  const BUILTIN_SLASH_COUNT = 9
  const BUILTIN_SLASH_DIR = './templates/templates/vfx/slash_basic_builtin/source'
  const COMFY_BASE_URL = 'http://127.0.0.1:8188'
  const HOST_LEFT_EDGE = 'rgba(154, 159, 165, 0.05)'
  const HOST_ENTRY_STACK_Z = 2147483605
  const AIFX_SHELL_STACK_Z = 2147483610
  const HOST_LEFT_FRAME_LEFT = 100
  const HOST_LEFT_FRAME_WIDTH = 334
  const HOST_LEFT_CONTENT_INSET = 11
  const HOST_LEFT_PANEL_WIDTH = 302
  const AIFX_SECTION_GAP = 8
  const AIFX_LEFT_PANEL_ACCORDION = window.NovaFlowLeftPanelAccordion || null
  const AIFX_LEFT_PANEL_TOKENS = AIFX_LEFT_PANEL_ACCORDION?.TOKENS || Object.freeze({
    panelGap: '5px',
    radius: '8px',
    headerHeight: '36px',
    headerPadding: '0 12px',
    headerBackground: '#2f2f2f',
    headerFontSize: '13px',
    headerFontWeight: '400',
    headerGap: '8px',
    bodyPadding: '6px 12px 8px',
    bodyGap: '6px',
  })
  const AIFX_ACCENT = '#1ea672'
  const AIFX_SLIDER_ACCENT = '#20c997'
  const AIFX_SURFACE_BASE = '#181818'
  const AIFX_SURFACE_ELEVATED = '#333333'
  const AIFX_SURFACE_MUTED = '#1b1b1b'
  const AIFX_OVERLAY_SURFACE = 'rgba(12, 12, 12, 0.84)'
  const AIFX_RUNTIME_BUDGET = Object.freeze({
    maxTemplateFrames: 48,
    maxInputFileBytes: 32 * 1024 * 1024,
    maxTemplateFileBytes: 192 * 1024 * 1024,
    maxFrameDimension: 4096,
    maxFramePixels: 4 * 1024 * 1024,
    maxTemplatePixels: 24 * 1024 * 1024,
    maxStyleDimension: 8192,
    maxStylePixels: 16 * 1024 * 1024,
    maxSheetDimension: 4096,
    maxSheetPixels: 8 * 1024 * 1024,
    maxOpaqueCoverageRatio: 0.985,
  })
  const SPRITESHEET_COMFY_SEED = 348713245
  const UI_TRACE_FILE = 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/aifx-repaint-runtime.js'
  const UI_TRACE_SEEN = new Set()
  const uiTraceTime = () => {
    try { return performance.now() } catch { return Date.now() }
  }
  const uiTraceCurrent = (component, detail = {}) => {
    const key = `current:${component}:${detail.phase || ''}`
    if (UI_TRACE_SEEN.has(key)) return
    UI_TRACE_SEEN.add(key)
    const payload = { file: UI_TRACE_FILE, component, time: uiTraceTime(), ...detail }
    if (window.NovaFlowUiTrace?.markCurrent) return window.NovaFlowUiTrace.markCurrent(UI_TRACE_FILE, component, detail)
    console.warn('[UI_TRACE][CURRENT_RENDERED]', payload)
  }
  const COMFY_STYLE_NODES = [
    'LoadImage',
    'CheckpointLoaderSimple',
    'CLIPTextEncode',
    'VAEEncode',
    'KSampler',
    'VAEDecode',
    'IPAdapterModelLoader',
    'CLIPVisionLoader',
    'SaveImage',
  ]
  const LEGACY_MARKERS = [
    'AIFX v2.1',
    'PathControl',
    '调试与缩略图',
    '1. 参考图',
    '2. 控制方式',
    '3. Prompt',
    'Mask',
    'Alpha',
    'RGBA',
  ]

  const state = {
    mounted: false,
    refs: {},
    shellInset: {
      top: 58,
      shellLeft: HOST_LEFT_FRAME_LEFT,
      shellWidth: HOST_LEFT_FRAME_WIDTH,
      shellRight: HOST_LEFT_FRAME_LEFT + HOST_LEFT_FRAME_WIDTH,
      sideOffset: 142,
    },
    templateFrames: [],
    templateGuides: [],
    templateName: '',
    styleReference: null,
    promptSupplement: '',
    materialStrength: 86,
    contourVariation: 32,
    providerState: {
      provider: 'local',
      styleStrength: 86,
      running: false,
      status: '',
      error: '',
    },
    providerHandle: null,
    activeFrameIndex: 0,
    previewMode: 'result',
    playing: false,
    fps: 12,
    comfyBaseUrl: COMFY_BASE_URL,
    comfyObjectInfo: null,
    status: '等待输入',
    detail: '载入模板和参考图后生成。',
    generatedFrames: [],
    candidates: [],
    selectedIndex: 0,
    bestIndex: -1,
    isGenerating: false,
    autoPrompt: null,
    lastPipelineSummary: null,
    spriteSheet: null,
    preparedTemplate: null,
    finalProduct: null,
    lastGeneration: null,
    generationAbort: null,
    generationToken: null,
    lastComfyDebug: null,
    styleValidationResult: null,
    lastExportDir: '',
    playTimer: 0,
    lastTick: 0,
    resumePlaybackOnVisible: false,
    hostScrollSnapshots: [],
    hostScrollFreezeEpoch: 0,
    hostScrollFreezeRafId: 0,
    hostScrollFreezeTimerId: 0,
    sectionOpen: { mode: false, template: false, generate: false },
  }

  window.__NOVA_AIFX_RUNTIME_SCOPE = {
    pipeline: PIPELINE_ID,
    source: RUNTIME_SOURCE,
    usesComfy: true,
    budgets: AIFX_RUNTIME_BUDGET,
    ownsOnly: 'AI特效',
  }

  const defaultPalette = {
    core: { r: 248, g: 253, b: 255 },
    glow: { r: 86, g: 182, b: 255 },
    dominant: { r: 48, g: 112, b: 255 },
    outer: { r: 44, g: 86, b: 255 },
    spark: { r: 194, g: 237, b: 255 },
    contrast: 0.78,
    branchDensity: 0.72,
    saturation: 0.88,
    edgeSoftness: 0.46,
    glowStrength: 0.72,
    textureStrength: 0.68,
    streakiness: 0.64,
    particleDensity: 0.58,
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  const lerp = (a, b, t) => a + (b - a) * t
  const normalize = (value) => String(value || '').replace(/\s+/g, '').trim()
  const isAiEffectLabel = (value) => normalize(value) === 'AI特效'
  const isParticleEffectLabel = (value) => normalize(value) === '粒子特效'
  const isTopMenuLabel = (value) => {
    const text = normalize(value)
    return text === '文件' || text === '帮助'
  }
  const pad = (value, length = 4) => String(value).padStart(length, '0')

  const colorCss = (color, alpha = 1) =>
    `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${clamp(alpha, 0, 1)})`

  const mixColor = (a, b, t) => ({
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  })

  const brighten = (color, amount) => mixColor(color, { r: 255, g: 255, b: 255 }, amount)
  const darken = (color, amount) => mixColor(color, { r: 0, g: 0, b: 0 }, amount)
  const boostSaturation = (color, amount) => {
    const gray = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722
    const scale = 1 + amount
    return {
      r: clamp(gray + (color.r - gray) * scale, 0, 255),
      g: clamp(gray + (color.g - gray) * scale, 0, 255),
      b: clamp(gray + (color.b - gray) * scale, 0, 255),
    }
  }

  const AifxPureHelpers = {
    clamp,
    lerp,
    normalize,
    pad,
    colorCss,
    mixColor,
    brighten,
    darken,
    boostSaturation,
  }

  const aifxRuntimeError = (code, message, details = {}) => {
    const error = new Error(message)
    error.code = code
    Object.assign(error, details)
    return error
  }

  const releaseAifxCanvas = (canvas, released) => {
    if (!canvas || typeof canvas !== 'object' || typeof canvas.getContext !== 'function' || released.has(canvas)) return
    released.add(canvas)
    try {
      canvas.width = 1
      canvas.height = 1
    } catch {}
  }

  const releaseAifxImage = (image, released) => {
    if (!image || typeof image !== 'object' || typeof image.src !== 'string' || released.has(image)) return
    released.add(image)
    try { image.src = '' } catch {}
  }

  const releaseAifxGeneratedResources = () => {
    const released = new Set()
    for (const frame of state.generatedFrames) releaseAifxCanvas(frame?.canvas, released)
    for (const candidate of state.candidates) {
      for (const frame of Array.isArray(candidate?.frames) ? candidate.frames : []) releaseAifxCanvas(frame?.canvas, released)
    }
    releaseAifxCanvas(state.spriteSheet?.inputCanvas, released)
    releaseAifxCanvas(state.spriteSheet?.outputCanvas, released)
    releaseAifxImage(state.spriteSheet?.outputCanvas, released)
    releaseAifxCanvas(state.preparedTemplate?.canvas, released)
    for (const frame of state.preparedTemplate?.motionGuide?.frames || []) {
      releaseAifxCanvas(frame?.canvas, released)
      releaseAifxImage(frame?.image, released)
    }
  }

  const clearGeneratedState = () => {
    releaseAifxGeneratedResources()
    state.generatedFrames = []
    state.candidates = []
    state.selectedIndex = 0
    state.bestIndex = -1
    state.spriteSheet = null
    state.preparedTemplate = null
    state.finalProduct = null
    state.lastGeneration = null
    state.lastPipelineSummary = null
    window.__NOVA_AIFX_LAST_PRODUCT = null
    window.__NOVA_AIFX_LAST_SEQUENCE = null
    window.__AIFX_LAST_TEMPLATE_PLAN__ = null
    window.__AIFX_LAST_PIPELINE_SUMMARY__ = null
    window.__AIFX_LAST_SEQUENCE_QUALITY__ = null
    window.__AIFX_LAST_TEMPORAL_CORRECTION__ = null
    window.__AIFX_LAST_TEMPLATE_MATERIALIZATION__ = null
  }

  const freezeAifxSnapshotValue = (value) => {
    if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeAifxSnapshotValue(entry)))
    if (ArrayBuffer.isView(value)) return new value.constructor(value)
    if (!value || typeof value !== 'object') return value
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezeAifxSnapshotValue(entry)]),
    ))
  }

  const createAifxGenerationSnapshot = (provider, controller) => {
    const token = Object.freeze({
      id: `aifx_generation_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    })
    return Object.freeze({
      token,
      signal: controller.signal,
      provider,
      templateFrames: Object.freeze(state.templateFrames.map((frame) => freezeAifxSnapshotValue(frame))),
      templateGuides: Object.freeze(state.templateGuides.map((guide) => freezeAifxSnapshotValue(guide))),
      styleReference: freezeAifxSnapshotValue(state.styleReference),
      promptSupplement: String(state.promptSupplement || '').slice(0, 400),
      materialStrength: Number(state.materialStrength) || 0,
      contourVariation: Number(state.contourVariation) || 0,
      fps: Math.max(1, Number(state.fps) || 12),
    })
  }

  const assertAifxGenerationCurrent = (snapshot) => {
    if (state.generationToken === snapshot?.token && !snapshot?.signal?.aborted) return snapshot
    const error = new Error('AI 特效生成已停止；旧任务结果不会写入当前面板。')
    error.name = 'AbortError'
    error.code = 'AIFX_ABORTED'
    throw error
  }

  const mulberry32 = (seed) => {
    let value = seed >>> 0
    return () => {
      value += 0x6d2b79f5
      let t = value
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const getActionElement = (target) => {
    if (!(target instanceof Element)) return null
    return target.closest('button,[role="button"],[tabindex]')
  }

  const findButtonsByText = (predicate) =>
    Array.from(document.querySelectorAll('button,[role="button"],[tabindex]')).filter((element) =>
      predicate(String(element.textContent || '')),
    )

  const restoreHostScroll = () => {
    for (const snapshot of state.hostScrollSnapshots) {
      if (!(snapshot.element instanceof HTMLElement)) continue
      snapshot.element.scrollTop = snapshot.scrollTop
      snapshot.element.scrollLeft = snapshot.scrollLeft
      snapshot.element.style.cssText = snapshot.cssText
    }
    state.hostScrollSnapshots = []
  }

  const cancelScheduledHostScrollFreeze = () => {
    state.hostScrollFreezeEpoch += 1
    if (state.hostScrollFreezeRafId) window.cancelAnimationFrame(state.hostScrollFreezeRafId)
    if (state.hostScrollFreezeTimerId) window.clearTimeout(state.hostScrollFreezeTimerId)
    state.hostScrollFreezeRafId = 0
    state.hostScrollFreezeTimerId = 0
  }

  const isHostScrollFreezeActive = (root, epoch) =>
    epoch === state.hostScrollFreezeEpoch &&
    root instanceof HTMLElement &&
    root === state.refs.root &&
    root.isConnected &&
    root.classList.contains('is-open') &&
    document.body instanceof HTMLElement &&
    document.body.classList.contains('novaflow-aifx-open')

  const scheduleHostScrollFreeze = (root) => {
    const epoch = state.hostScrollFreezeEpoch
    state.hostScrollFreezeRafId = window.requestAnimationFrame(() => {
      if (epoch !== state.hostScrollFreezeEpoch) return
      state.hostScrollFreezeRafId = 0
      if (!isHostScrollFreezeActive(root, epoch)) return
      freezeHostLeftScroll()
    })
    state.hostScrollFreezeTimerId = window.setTimeout(() => {
      if (epoch !== state.hostScrollFreezeEpoch) return
      state.hostScrollFreezeTimerId = 0
      if (!isHostScrollFreezeActive(root, epoch)) return
      freezeHostLeftScroll()
    }, 120)
  }

  const freezeHostLeftScroll = () => {
    restoreHostScroll()
    const nodes = [document.documentElement, document.body, ...Array.from(document.querySelectorAll('body *'))].filter((element) => {
      if (!(element instanceof HTMLElement)) return false
      if (element.id === APP_ID || element.closest(`#${APP_ID}`)) return false
      return element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2
    })
    nodes.forEach((element) => {
      state.hostScrollSnapshots.push({
        element,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        cssText: element.style.cssText || '',
      })
      element.scrollTop = 0
      element.scrollLeft = 0
      element.style.setProperty('overflow', 'hidden', 'important')
      element.style.setProperty('overflow-x', 'hidden', 'important')
      element.style.setProperty('overflow-y', 'hidden', 'important')
      element.style.setProperty('overscroll-behavior', 'contain', 'important')
    })
  }

  const setHostTabState = (activeLabel, aiAction) => {
    const aiEntry = aiAction instanceof HTMLElement ? aiAction : findButtonsByText(isAiEffectLabel)[0]
    const particleEntry = findButtonsByText(isParticleEffectLabel)[0]
    const aiActive = activeLabel === 'ai'
    if (particleEntry instanceof HTMLElement) {
      particleEntry.setAttribute('data-novaflow-secondary-entry', '1')
      particleEntry.setAttribute('data-novaflow-secondary-active', aiActive ? '0' : '1')
      particleEntry.setAttribute('aria-pressed', aiActive ? 'false' : 'true')
      if (!aiActive) particleEntry.setAttribute('aria-current', 'page')
      else particleEntry.removeAttribute('aria-current')
    }
    if (aiEntry instanceof HTMLElement) {
      if (aiActive) aiEntry.setAttribute('aria-current', 'page')
      else aiEntry.removeAttribute('aria-current')
      aiEntry.setAttribute('data-novaflow-secondary-entry', '1')
      aiEntry.setAttribute('data-novaflow-secondary-active', aiActive ? '1' : '0')
      aiEntry.setAttribute('aria-pressed', aiActive ? 'true' : 'false')
    }
    window.NovaFlowSecondaryEntries?.setActive?.(['粒子特效', 'AI特效'], aiActive ? 'AI特效' : '粒子特效')
  }

  const applyHostTabVisuals = (aiAction) => {
    const aiEntry = aiAction instanceof HTMLElement ? aiAction : findButtonsByText(isAiEffectLabel)[0]
    setHostTabState('ai', aiAction)
  }

  const hasLegacyPanel = () => {
    const bodyText = String(document.body?.textContent || '')
    return LEGACY_MARKERS.some((marker) => bodyText.includes(marker))
  }

  const createCanvas = (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width))
    canvas.height = Math.max(1, Math.round(height))
    return canvas
  }

  const estimateAifxDataUrlBytes = (dataUrl) => {
    const source = String(dataUrl || '')
    const comma = source.indexOf(',')
    if (comma < 0) return source.length
    const header = source.slice(0, comma)
    const payload = source.slice(comma + 1).replace(/\s+/g, '')
    return /;base64(?:;|$)/i.test(header) ? Math.ceil(payload.length * 0.75) : payload.length
  }

  const assertAifxFileByteBudget = (file, maxBytes, label) => {
    const size = Number(file?.size)
    if (!Number.isFinite(size) || size < 0) {
      throw aifxRuntimeError('AIFX_INPUT_FILE_SIZE_INVALID', `${label} file size is unavailable.`)
    }
    if (size > maxBytes) {
      throw aifxRuntimeError(
        'AIFX_INPUT_FILE_TOO_LARGE',
        `${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB input limit.`,
        { size, maxBytes },
      )
    }
    return size
  }

  const assertAifxDataUrlByteBudget = (dataUrl, maxBytes, label) => {
    const estimatedBytes = estimateAifxDataUrlBytes(dataUrl)
    if (estimatedBytes > maxBytes) {
      throw aifxRuntimeError(
        'AIFX_INPUT_DATA_TOO_LARGE',
        `${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB decoded input limit.`,
        { estimatedBytes, maxBytes },
      )
    }
    return estimatedBytes
  }

  const assertAifxImagePixelBudget = (widthValue, heightValue, options = {}) => {
    const width = Math.max(1, Math.round(Number(widthValue) || 0))
    const height = Math.max(1, Math.round(Number(heightValue) || 0))
    const maxDimension = Math.max(1, Math.round(Number(options.maxDimension) || AIFX_RUNTIME_BUDGET.maxFrameDimension))
    const maxPixels = Math.max(1, Math.round(Number(options.maxPixels) || AIFX_RUNTIME_BUDGET.maxFramePixels))
    const pixels = width * height
    if (width > maxDimension || height > maxDimension || !Number.isSafeInteger(pixels) || pixels > maxPixels) {
      throw aifxRuntimeError(
        options.code || 'AIFX_INPUT_PIXEL_BUDGET_EXCEEDED',
        `${options.label || 'Image'} ${width}x${height} exceeds the production pixel budget.`,
        { width, height, pixels, maxDimension, maxPixels },
      )
    }
    return pixels
  }

  const assertAifxProductionSheetBudget = (sheetSize) => assertAifxImagePixelBudget(
    sheetSize?.width,
    sheetSize?.height,
    {
      code: 'AIFX_SHEET_PRODUCTION_BUDGET_EXCEEDED',
      label: 'Sprite sheet',
      maxDimension: AIFX_RUNTIME_BUDGET.maxSheetDimension,
      maxPixels: AIFX_RUNTIME_BUDGET.maxSheetPixels,
    },
  )

  const canonicalAifxFrameName = (index) => `frame_${pad(Math.max(0, Math.round(Number(index) || 0)), 3)}.png`

  const sanitizeAifxExportName = (value, fallback = '') => {
    const normalized = String(value || '').normalize('NFKC')
    const cleaned = normalized
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
    const withoutKnownExtension = cleaned.replace(/\.(?:zip|png|atlas|json)$/i, '')
    const bounded = Array.from(withoutKnownExtension).slice(0, 80).join('').replace(/[. ]+$/g, '')
    const safe = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(bounded) ? `_${bounded}` : bounded
    if (safe) return safe
    if (!fallback) return ''
    return sanitizeAifxExportName(fallback, '') || 'asset'
  }

  let aifxExportSessionSerial = 0
  const buildAifxExportSessionDir = (parentDir, kind, token = '') => {
    const parent = String(parentDir || '').trim().replace(/[\\/]+$/, '')
    if (!parent) throw aifxRuntimeError('AIFX_EXPORT_DIRECTORY_REQUIRED', 'AIFX export directory is required.')
    const safeKind = sanitizeAifxExportName(kind, 'asset')
   aifxExportSessionSerial = (aifxExportSessionSerial + 1) % 0x1000000
   const generatedToken = `${Date.now().toString(36)}_${aifxExportSessionSerial.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const safeToken = sanitizeAifxExportName(token || generatedToken, generatedToken)
   return `${parent}\\${safeKind}_${safeToken}`
  }

  AifxPureHelpers.estimateAifxDataUrlBytes = estimateAifxDataUrlBytes
  AifxPureHelpers.assertAifxImagePixelBudget = assertAifxImagePixelBudget
  AifxPureHelpers.canonicalAifxFrameName = canonicalAifxFrameName
  AifxPureHelpers.sanitizeAifxExportName = sanitizeAifxExportName
  AifxPureHelpers.buildAifxExportSessionDir = buildAifxExportSessionDir

  const imageFromUrl = (dataUrl) =>
    new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片读取失败'))
      image.decoding = 'async'
      image.src = dataUrl
    })

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsDataURL(file)
    })

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsDataURL(blob)
    })

  const imageFileToFrame = async (file, index, options = {}) => {
    const dataUrl = await fileToDataUrl(file)
    return dataUrlToFrame(dataUrl, file.name || canonicalAifxFrameName(index), index, options)
  }

  const dataUrlToFrame = async (dataUrl, fileName, index, options = {}) => {
    const image = await imageFromUrl(dataUrl)
    const width = Math.max(1, image.naturalWidth || image.width || 1)
    const height = Math.max(1, image.naturalHeight || image.height || 1)
    const pixels = assertAifxImagePixelBudget(width, height, {
      code: options.code || 'AIFX_FRAME_PIXEL_BUDGET_EXCEEDED',
      label: options.label || `Frame ${index + 1}`,
      maxDimension: options.maxDimension || AIFX_RUNTIME_BUDGET.maxFrameDimension,
      maxPixels: options.maxPixels || AIFX_RUNTIME_BUDGET.maxFramePixels,
    })
    if (Number.isFinite(Number(options.remainingPixels)) && pixels > Number(options.remainingPixels)) {
      throw aifxRuntimeError(
        'AIFX_TEMPLATE_TOTAL_PIXELS_EXCEEDED',
        `Template frames exceed the ${AIFX_RUNTIME_BUDGET.maxTemplatePixels.toLocaleString()} pixel budget.`,
        { pixels, remainingPixels: Number(options.remainingPixels) },
      )
    }
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    return { index, fileName, dataUrl, canvas, width, height }
  }

  const readTemplateFiles = async (files) => {
    const imageFiles = Array.from(files || []).filter((file) => /^image\//i.test(file.type || ''))
    if (imageFiles.length > AIFX_RUNTIME_BUDGET.maxTemplateFrames) {
      throw aifxRuntimeError(
        'AIFX_TEMPLATE_FRAME_COUNT_EXCEEDED',
        `Template contains ${imageFiles.length} frames; the production limit is ${AIFX_RUNTIME_BUDGET.maxTemplateFrames}.`,
        { frameCount: imageFiles.length, maxFrames: AIFX_RUNTIME_BUDGET.maxTemplateFrames },
      )
    }
    let totalFileBytes = 0
    for (const file of imageFiles) {
      totalFileBytes += assertAifxFileByteBudget(file, AIFX_RUNTIME_BUDGET.maxInputFileBytes, `Template frame ${file.name || ''}`.trim())
    }
    if (totalFileBytes > AIFX_RUNTIME_BUDGET.maxTemplateFileBytes) {
      throw aifxRuntimeError(
        'AIFX_TEMPLATE_FILE_BUDGET_EXCEEDED',
        `Template files exceed the ${Math.floor(AIFX_RUNTIME_BUDGET.maxTemplateFileBytes / 1024 / 1024)} MiB total input limit.`,
        { totalFileBytes, maxBytes: AIFX_RUNTIME_BUDGET.maxTemplateFileBytes },
      )
    }
    imageFiles.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { numeric: true }))
    if (!imageFiles.length) throw new Error('没有读取到图片序列')
    const frames = []
    let totalPixels = 0
    for (let index = 0; index < imageFiles.length; index += 1) {
      const frame = await imageFileToFrame(imageFiles[index], index, {
        label: `Template frame ${index + 1}`,
        remainingPixels: AIFX_RUNTIME_BUDGET.maxTemplatePixels - totalPixels,
      })
      totalPixels += frame.width * frame.height
      frames.push(frame)
    }
    return frames
  }

  const normalizeFrameSize = (frames) => {
    const first = frames[0]
    if (!first) return frames
    const width = first.width
    const height = first.height
    return frames.map((frame, index) => {
      if (frame.width === width && frame.height === height) return { ...frame, index }
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(frame.canvas, 0, 0, width, height)
      return {
        ...frame,
        index,
        width,
        height,
        canvas,
        dataUrl: canvas.toDataURL('image/png'),
      }
    })
  }

  const loadBuiltinTemplate = async () => {
    setStatus('载入模板', '正在载入内置刀光模板。')
    const frames = []
    let totalPixels = 0
    for (let index = 0; index < BUILTIN_SLASH_COUNT; index += 1) {
      const fileName = `frame_${pad(index, 3)}.png`
      const response = await fetch(`${BUILTIN_SLASH_DIR}/${fileName}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`内置模板读取失败：${fileName}`)
      const blob = await response.blob()
      assertAifxFileByteBudget(blob, AIFX_RUNTIME_BUDGET.maxInputFileBytes, `Built-in template frame ${fileName}`)
      const dataUrl = await blobToDataUrl(blob)
      const frame = await dataUrlToFrame(dataUrl, fileName, index, {
        label: `Built-in template frame ${index + 1}`,
        remainingPixels: AIFX_RUNTIME_BUDGET.maxTemplatePixels - totalPixels,
      })
      totalPixels += frame.width * frame.height
      frames.push(frame)
    }
    setTemplateFrames(frames, '已载入内置刀光模板', '内置刀光')
  }

  const readStyleFile = async (file) => {
    if (state.isGenerating) return false
    if (!file || !/^image\//i.test(file.type || '')) throw new Error('请选择一张风格参考图')
    assertAifxFileByteBudget(file, AIFX_RUNTIME_BUDGET.maxInputFileBytes, 'Style reference')
    const dataUrl = await fileToDataUrl(file)
    assertAifxDataUrlByteBudget(dataUrl, AIFX_RUNTIME_BUDGET.maxInputFileBytes, 'Style reference')
    const image = await imageFromUrl(dataUrl)
    const width = Math.max(1, image.naturalWidth || image.width || 1)
    const height = Math.max(1, image.naturalHeight || image.height || 1)
    assertAifxImagePixelBudget(width, height, {
      code: 'AIFX_STYLE_PIXEL_BUDGET_EXCEEDED',
      label: 'Style reference',
      maxDimension: AIFX_RUNTIME_BUDGET.maxStyleDimension,
      maxPixels: AIFX_RUNTIME_BUDGET.maxStylePixels,
    })
    const sampleSize = 192
    const scale = Math.min(1, sampleSize / Math.max(width, height))
    const canvas = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const comfyScale = Math.min(1, 768 / Math.max(width, height))
    const comfyCanvas = createCanvas(Math.max(1, Math.round(width * comfyScale)), Math.max(1, Math.round(height * comfyScale)))
    comfyCanvas.getContext('2d').drawImage(image, 0, 0, comfyCanvas.width, comfyCanvas.height)
    const referenceImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const palette = extractPalette(referenceImageData)
    if (state.isGenerating) return false
    state.styleReference = {
      fileName: file.name || 'reference.png',
      dataUrl,
      comfyDataUrl: comfyCanvas.toDataURL('image/png'),
      width,
      height,
      palette,
      textureWidth: canvas.width,
      textureHeight: canvas.height,
      textureData: new Uint8ClampedArray(referenceImageData.data),
      styleModel: buildStyleModel(referenceImageData),
      materialMaps: buildAifxMaterialMaps(referenceImageData),
    }
    state.autoPrompt = null
    clearGeneratedState()
    setStatus('风格已载入', '参考图将控制颜色、材质、纹理、边缘过渡、光感和粒子特征。')
    refreshUi()
    drawPreview()
  }

  const readStyleDataUrl = async (dataUrl, fileName = 'reference.png') => {
    if (state.isGenerating) return false
    assertAifxDataUrlByteBudget(dataUrl, AIFX_RUNTIME_BUDGET.maxInputFileBytes, 'Style reference')
    const image = await imageFromUrl(dataUrl)
    const width = Math.max(1, image.naturalWidth || image.width || 1)
    const height = Math.max(1, image.naturalHeight || image.height || 1)
    assertAifxImagePixelBudget(width, height, {
      code: 'AIFX_STYLE_PIXEL_BUDGET_EXCEEDED',
      label: 'Style reference',
      maxDimension: AIFX_RUNTIME_BUDGET.maxStyleDimension,
      maxPixels: AIFX_RUNTIME_BUDGET.maxStylePixels,
    })
    const sampleSize = 192
    const scale = Math.min(1, sampleSize / Math.max(width, height))
    const canvas = createCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const comfyScale = Math.min(1, 768 / Math.max(width, height))
    const comfyCanvas = createCanvas(Math.max(1, Math.round(width * comfyScale)), Math.max(1, Math.round(height * comfyScale)))
    comfyCanvas.getContext('2d').drawImage(image, 0, 0, comfyCanvas.width, comfyCanvas.height)
    const referenceImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (state.isGenerating) return false
    state.styleReference = {
      fileName,
      dataUrl,
      comfyDataUrl: comfyCanvas.toDataURL('image/png'),
      width,
      height,
      palette: extractPalette(referenceImageData),
      textureWidth: canvas.width,
      textureHeight: canvas.height,
      textureData: new Uint8ClampedArray(referenceImageData.data),
      styleModel: buildStyleModel(referenceImageData),
      materialMaps: buildAifxMaterialMaps(referenceImageData),
    }
    state.autoPrompt = null
    clearGeneratedState()
    setStatus('风格已载入', '参考图将控制颜色、材质、纹理、边缘过渡、光感和粒子特征。')
    refreshUi()
    drawPreview()
  }

  const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const saturation = (r, g, b) => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return max <= 0 ? 0 : (max - min) / max
  }

  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
  }

  const measureAifxTemplateAlphaQuality = (canvas) => {
    const width = Math.max(1, Number(canvas?.width) || 1)
    const height = Math.max(1, Number(canvas?.height) || 1)
    const ctx = canvas?.getContext?.('2d', { willReadFrequently: true })
    if (!ctx) throw aifxRuntimeError('AIFX_TEMPLATE_CANVAS_INVALID', 'Template frame canvas is unavailable.')
    const data = ctx.getImageData(0, 0, width, height).data
    const totalPixels = width * height
    let sourceVisiblePixels = 0
    let sourceTransparentPixels = 0
    let maxLum = 0
    for (let index = 0; index < totalPixels; index += 1) {
      const offset = index * 4
      const alpha = data[offset + 3] / 255
      const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
      if (alpha > 0.035) sourceVisiblePixels += 1
      if (alpha < 0.985) sourceTransparentPixels += 1
      maxLum = Math.max(maxLum, lum)
    }
    const hasUsefulAlpha = sourceVisiblePixels > 12 && sourceTransparentPixels > totalPixels * 0.015
    const lumFloor = Math.max(0.015, Math.min(0.12, maxLum * 0.08))
    const lumCeil = Math.max(lumFloor + 0.08, maxLum * 0.74)
    let visiblePixels = 0
    let transparentPixels = 0
    let solidPixels = 0
    for (let index = 0; index < totalPixels; index += 1) {
      const offset = index * 4
      const alpha = data[offset + 3] / 255
      const mask = hasUsefulAlpha
        ? alpha
        : smoothstep(lumFloor, lumCeil, luminance(data[offset], data[offset + 1], data[offset + 2]))
      if (mask > 0.05) visiblePixels += 1
      else transparentPixels += 1
      if (mask >= 0.985) solidPixels += 1
    }
    return {
      width,
      height,
      sampledPixels: totalPixels,
      visiblePixels,
      alphaPixels: visiblePixels,
      transparentPixels,
      solidPixels,
      coverageRatio: visiblePixels / Math.max(1, totalPixels),
      transparentRatio: transparentPixels / Math.max(1, totalPixels),
      hasUsefulAlpha,
      alphaSource: hasUsefulAlpha ? 'template-alpha' : 'template-luminance-mask',
    }
  }

  const assertAifxLifecycleAlphaQuality = (quality, lifecycle = {}, prefix = 'AIFX_TEMPLATE') => {
    if (!Array.isArray(quality) || !quality.length) {
      throw aifxRuntimeError(`${prefix}_ALPHA_EMPTY`, 'AIFX sequence has no alpha quality samples.')
    }
    const startFrame = clamp(Math.round(Number(lifecycle.startFrame) || 0), 0, quality.length - 1)
    const endFrame = clamp(Math.round(Number(lifecycle.endFrame ?? quality.length - 1)), 0, quality.length - 1)
    const peakFrame = clamp(
      Math.round(Number(lifecycle.peakFrame ?? Math.round((quality.length - 1) * 0.45))),
      0,
      quality.length - 1,
    )
    const mode = String(lifecycle.mode || 'one-shot')
    let anyVisible = false
    quality.forEach((entry, index) => {
      const sampledPixels = Math.max(1, Math.round(Number(entry?.sampledPixels) || 0))
      const visiblePixels = Math.max(0, Math.round(Number(entry?.visiblePixels ?? entry?.alphaPixels) || 0))
      const coverageRatio = Number.isFinite(Number(entry?.coverageRatio))
        ? Number(entry.coverageRatio)
        : visiblePixels / sampledPixels
      if (visiblePixels > 0) anyVisible = true
      if (visiblePixels > 0 && coverageRatio >= AIFX_RUNTIME_BUDGET.maxOpaqueCoverageRatio) {
        throw aifxRuntimeError(
          `${prefix}_ALPHA_COVERAGE_INVALID`,
          `AIFX frame ${index + 1} is ${Math.round(coverageRatio * 1000) / 10}% opaque and cannot be accepted as transparent RGBA.`,
          { frameIndex: index, coverageRatio, maxCoverageRatio: AIFX_RUNTIME_BUDGET.maxOpaqueCoverageRatio },
        )
      }
      const endpointSlack = mode === 'one-shot' && (index === startFrame || index === endFrame) && index !== peakFrame
      if (visiblePixels < 1 && !endpointSlack) {
        throw aifxRuntimeError(
          `${prefix}_ALPHA_EMPTY`,
          `AIFX lifecycle frame ${index + 1} is fully transparent; only one-shot endpoints may be empty.`,
          { frameIndex: index, startFrame, endFrame, peakFrame, mode },
        )
      }
    })
    if (!anyVisible || Math.max(0, Number(quality[peakFrame]?.visiblePixels ?? quality[peakFrame]?.alphaPixels) || 0) < 1) {
      throw aifxRuntimeError(
        `${prefix}_ALPHA_EMPTY`,
        'AIFX peak lifecycle frame must contain a visible effect.',
        { peakFrame },
      )
    }
    return quality
  }

  AifxPureHelpers.assertAifxLifecycleAlphaQuality = assertAifxLifecycleAlphaQuality

  const hash01 = (x, y, seed = 0) => {
    let value = Math.imul((Math.round(x) + 0x9e3779b9) | 0, 0x85ebca6b)
    value ^= Math.imul((Math.round(y) + 0xc2b2ae35) | 0, 0x27d4eb2d)
    value ^= Math.imul((Math.round(seed) + 0x165667b1) | 0, 0x9e3779b1)
    value ^= value >>> 16
    value = Math.imul(value, 0x7feb352d)
    value ^= value >>> 15
    value = Math.imul(value, 0x846ca68b)
    value ^= value >>> 16
    return (value >>> 0) / 4294967296
  }

  const buildStyleModel = (imageData) => {
    const binCount = 18
    const bins = Array.from({ length: binCount }, () => [])
    const data = imageData.data
    const width = imageData.width
    const height = imageData.height
    let count = 0
    let sumLum = 0
    let sumLumSq = 0
    let sumSat = 0
    let edgeSum = 0
    let highLum = 0
    let highLumCount = 0
    let lowLum = 1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const alpha = data[offset + 3] / 255
        if (alpha < 0.05) continue
        const r = data[offset]
        const g = data[offset + 1]
        const b = data[offset + 2]
        const lum = luminance(r, g, b)
        if (lum < 0.025) continue
        const sat = saturation(r, g, b)
        const bin = clamp(Math.floor(lum * binCount), 0, binCount - 1)
        const sample = { r, g, b, lum, sat }
        bins[bin].push(sample)
        count += 1
        sumLum += lum
        sumLumSq += lum * lum
        sumSat += sat
        highLum = Math.max(highLum, lum)
        if (lum > 0.72) highLumCount += 1
        lowLum = Math.min(lowLum, lum)
        if (x + 1 < width) {
          const next = offset + 4
          edgeSum += Math.abs(lum - luminance(data[next], data[next + 1], data[next + 2]))
        }
        if (y + 1 < height) {
          const next = ((y + 1) * width + x) * 4
          edgeSum += Math.abs(lum - luminance(data[next], data[next + 1], data[next + 2]))
        }
      }
    }
    const averageSample = (items, fallback) => {
      if (!items.length) return fallback
      const total = items.reduce(
        (acc, item) => {
          const weight = 0.15 + item.lum * 0.55 + item.sat * 0.3
          acc.r += item.r * weight
          acc.g += item.g * weight
          acc.b += item.b * weight
          acc.lum += item.lum * weight
          acc.sat += item.sat * weight
          acc.w += weight
          return acc
        },
        { r: 0, g: 0, b: 0, lum: 0, sat: 0, w: 0 },
      )
      return total.w > 0
        ? { r: total.r / total.w, g: total.g / total.w, b: total.b / total.w, lum: total.lum / total.w, sat: total.sat / total.w }
        : fallback
    }
    const binAverages = bins.map((items, index) =>
      averageSample(items, {
        r: defaultPalette.glow.r,
        g: defaultPalette.glow.g,
        b: defaultPalette.glow.b,
        lum: (index + 0.5) / binCount,
        sat: defaultPalette.saturation,
      }),
    )
    const meanLum = count ? sumLum / count : 0.5
    const variance = count ? Math.max(0.0001, sumLumSq / count - meanLum * meanLum) : 0.08
    return {
      bins,
      binAverages,
      lumMean: meanLum,
      lumStd: Math.sqrt(variance),
      satMean: count ? sumSat / count : 0.65,
      edgeMean: count ? clamp(edgeSum / count * 4.8, 0.04, 1) : 0.42,
      coverage: count / Math.max(1, width * height),
      highLumRatio: highLumCount / Math.max(1, count),
      highLum,
      lowLum: count ? lowLum : 0,
    }
  }

  const extractPalette = (imageData) => {
    const bright = []
    const saturated = []
    const dominant = []
    const outer = []
    const data = imageData.data
    let sumLum = 0
    let sumSat = 0
    let count = 0
    let edgeSum = 0
    let highCount = 0
    let softCount = 0
    const width = imageData.width
    const height = imageData.height
    const step = Math.max(1, Math.floor(Math.max(imageData.width, imageData.height) / 96))

    for (let y = 0; y < imageData.height; y += step) {
      for (let x = 0; x < imageData.width; x += step) {
        const offset = (y * imageData.width + x) * 4
        const a = data[offset + 3] / 255
        if (a < 0.05) continue
        const r = data[offset]
        const g = data[offset + 1]
        const b = data[offset + 2]
        const lum = luminance(r, g, b)
        const sat = saturation(r, g, b)
        if (lum < 0.03) continue
        count += 1
        sumLum += lum
        sumSat += sat
        if (lum > 0.68) highCount += 1
        if (lum > 0.08 && lum < 0.45 && sat < 0.38) softCount += 1
        const item = { r, g, b, lum, sat, score: lum * 0.65 + sat * 0.35 }
        if (lum > 0.72) bright.push(item)
        if (sat > 0.24 && lum > 0.18) saturated.push(item)
        if (sat > 0.18 && lum > 0.04 && lum < 0.78) dominant.push(item)
        if (sat > 0.18 && lum <= 0.5 && lum > 0.08) outer.push(item)

        if (x + step < width) {
          const next = (y * imageData.width + Math.min(width - 1, x + step)) * 4
          edgeSum += Math.abs(luminance(r, g, b) - luminance(data[next], data[next + 1], data[next + 2]))
        }
        if (y + step < height) {
          const next = (Math.min(height - 1, y + step) * imageData.width + x) * 4
          edgeSum += Math.abs(luminance(r, g, b) - luminance(data[next], data[next + 1], data[next + 2]))
        }
      }
    }

    const averageTop = (items, fallback, ratio = 0.22) => {
      const sorted = items.slice().sort((a, b) => b.score - a.score)
      const take = Math.max(1, Math.ceil(sorted.length * ratio))
      const selected = sorted.slice(0, take)
      if (!selected.length) return fallback
      const total = selected.reduce(
        (acc, item) => {
          const weight = 0.2 + item.score
          acc.r += item.r * weight
          acc.g += item.g * weight
          acc.b += item.b * weight
          acc.w += weight
          return acc
        },
        { r: 0, g: 0, b: 0, w: 0 },
      )
      return total.w > 0 ? { r: total.r / total.w, g: total.g / total.w, b: total.b / total.w } : fallback
    }

    const glow = averageTop(saturated, defaultPalette.glow, 0.18)
    const core = averageTop(bright, brighten(glow, 0.72), 0.28)
    const outerColor = averageTop(outer, darken(glow, 0.35), 0.24)
    const dominantColor = dominant.length
      ? dominant.reduce(
        (acc, item) => {
          const weight = 0.15 + item.sat * (1 - item.lum * 0.55)
          acc.r += item.r * weight
          acc.g += item.g * weight
          acc.b += item.b * weight
          acc.w += weight
          return acc
        },
        { r: 0, g: 0, b: 0, w: 0 },
      )
      : { ...outerColor, w: 1 }
    const avgLum = count ? sumLum / count : 0.5
    const avgSat = count ? sumSat / count : 0.65
    const edgeContrast = clamp(edgeSum / Math.max(1, count) * 7, 0.08, 1)
    const highRatio = highCount / Math.max(1, count)
    const softRatio = softCount / Math.max(1, count)
    return {
      core: brighten(core, 0.2),
      glow,
      dominant: {
        r: dominantColor.r / dominantColor.w,
        g: dominantColor.g / dominantColor.w,
        b: dominantColor.b / dominantColor.w,
      },
      outer: outerColor,
      spark: brighten(glow, 0.55),
      contrast: clamp((avgLum * 0.45 + avgSat * 0.55), 0.35, 0.92),
      branchDensity: clamp(edgeContrast * 0.7 + avgSat * 0.45, 0.25, 1),
      saturation: clamp(avgSat, 0.3, 1),
      edgeSoftness: clamp(0.28 + softRatio * 0.82 + (1 - edgeContrast) * 0.22, 0.18, 0.82),
      glowStrength: clamp(avgLum * 0.36 + highRatio * 3.4 + avgSat * 0.28, 0.22, 1),
      textureStrength: clamp(edgeContrast * 0.72 + avgSat * 0.38 + highRatio * 1.2, 0.25, 1),
      streakiness: clamp(edgeContrast * 0.86 + highRatio * 2.2, 0.12, 1),
      particleDensity: clamp(avgSat * 0.42 + edgeContrast * 0.45 + highRatio * 1.4, 0.12, 1),
    }
  }

  AifxPureHelpers.extractPalette = extractPalette

  const setTemplateFrames = (frames, message, templateName = '自定义模板') => {
    if (state.isGenerating) return false
    state.templateFrames = frames
    state.templateGuides = analyzeSequence(frames)
    state.templateName = templateName
    state.autoPrompt = null
    clearGeneratedState()
    state.activeFrameIndex = 0
    const first = frames[0]
    state.status = message || '模板已载入'
    state.detail = first ? `${frames.length} 帧 · ${first.width} x ${first.height}` : ''
    refreshUi()
    drawPreview()
  }

  const analyzeSequence = (frames) => {
    const guides = frames.map((frame) => analyzeFrame(frame.canvas))
    const maxEnergy = Math.max(1, ...guides.map((guide) => guide.energy))
    return guides.map((guide) => ({ ...guide, energyNorm: clamp(guide.energy / maxEnergy, 0.005, 1) }))
  }

  const analyzeFrame = (canvas) => {
    const width = canvas.width
    const height = canvas.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    const step = Math.max(1, Math.floor(Math.max(width, height) / 360))
    const samples = []
    let sumW = 0
    let sumX = 0
    let sumY = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    let sampledActiveArea = 0

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4
        const alpha = data[offset + 3] / 255
        const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
        const sampleArea = Math.min(step, width - x) * Math.min(step, height - y)
        const weight = Math.max(alpha, clamp((lum - 0.035) / 0.965, 0, 1))
        if (weight < 0.05) continue
        sampledActiveArea += sampleArea
        samples.push({ x, y, weight })
        sumW += weight
        sumX += x * weight
        sumY += y * weight
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }

    if (sumW <= 0) {
      return fallbackGuide(width, height)
    }

    const cx = sumX / sumW
    const cy = sumY / sumW
    let covXX = 0
    let covYY = 0
    let covXY = 0
    for (const sample of samples) {
      const dx = sample.x - cx
      const dy = sample.y - cy
      covXX += dx * dx * sample.weight
      covYY += dy * dy * sample.weight
      covXY += dx * dy * sample.weight
    }
    covXX /= sumW
    covYY /= sumW
    covXY /= sumW
    const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY)
    const axis = { x: Math.cos(angle), y: Math.sin(angle) }
    const normal = { x: -axis.y, y: axis.x }
    let minProj = Infinity
    let maxProj = -Infinity
    let minorSum = 0
    for (const sample of samples) {
      const dx = sample.x - cx
      const dy = sample.y - cy
      const proj = dx * axis.x + dy * axis.y
      const side = dx * normal.x + dy * normal.y
      minProj = Math.min(minProj, proj)
      maxProj = Math.max(maxProj, proj)
      minorSum += Math.abs(side) * sample.weight
    }
    const length = Math.max(24, maxProj - minProj, maxX - minX, maxY - minY)
    const widthEstimate = clamp((minorSum / sumW) * 2.6, 4, Math.max(width, height) * 0.35)
    const points = buildCenterline(samples, { cx, cy, axis, normal, minProj, maxProj, length })
    return {
      center: { x: cx, y: cy },
      bbox: { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
      angle,
      axis,
      normal,
      length,
      width: widthEstimate,
      points,
      energy: sumW,
      coverageRatio: clamp(sampledActiveArea / Math.max(1, width * height), 0, 1),
      canvasWidth: width,
      canvasHeight: height,
    }
  }

  const fallbackGuide = (width, height) => {
    const cx = width * 0.5
    const cy = height * 0.5
    const length = Math.min(width, height) * 0.68
    const widthEstimate = Math.max(8, length * 0.12)
    return {
      center: { x: cx, y: cy },
      bbox: { x: cx - length * 0.5, y: cy - length * 0.12, width: length, height: length * 0.24 },
      angle: -0.25,
      axis: { x: Math.cos(-0.25), y: Math.sin(-0.25) },
      normal: { x: -Math.sin(-0.25), y: Math.cos(-0.25) },
      length,
      width: widthEstimate,
      points: [
        { x: cx - length * 0.5, y: cy + length * 0.08 },
        { x: cx, y: cy - length * 0.1 },
        { x: cx + length * 0.5, y: cy + length * 0.03 },
      ],
      energy: 1,
      energyNorm: 1,
      coverageRatio: clamp((length * widthEstimate) / Math.max(1, width * height), 0.01, 0.25),
      canvasWidth: width,
      canvasHeight: height,
    }
  }

  const buildCenterline = (samples, guide) => {
    const binCount = 24
    const bins = Array.from({ length: binCount }, () => ({ w: 0, side: 0 }))
    const range = Math.max(1, guide.maxProj - guide.minProj)
    for (const sample of samples) {
      const dx = sample.x - guide.cx
      const dy = sample.y - guide.cy
      const proj = dx * guide.axis.x + dy * guide.axis.y
      const side = dx * guide.normal.x + dy * guide.normal.y
      const bin = clamp(Math.floor(((proj - guide.minProj) / range) * binCount), 0, binCount - 1)
      bins[bin].w += sample.weight
      bins[bin].side += side * sample.weight
    }

    const points = []
    for (let i = 0; i < binCount; i += 1) {
      const t = binCount === 1 ? 0 : i / (binCount - 1)
      const proj = lerp(guide.minProj, guide.maxProj, t)
      const side = bins[i].w > 0 ? bins[i].side / bins[i].w : 0
      points.push({
        x: guide.cx + guide.axis.x * proj + guide.normal.x * side,
        y: guide.cy + guide.axis.y * proj + guide.normal.y * side,
        valid: bins[i].w > 0,
      })
    }

    const valid = points.filter((point) => point.valid)
    if (valid.length < 4) {
      return [
        {
          x: guide.cx + guide.axis.x * guide.minProj,
          y: guide.cy + guide.axis.y * guide.minProj,
        },
        { x: guide.cx, y: guide.cy },
        {
          x: guide.cx + guide.axis.x * guide.maxProj,
          y: guide.cy + guide.axis.y * guide.maxProj,
        },
      ]
    }

    for (let i = 0; i < points.length; i += 1) {
      if (points[i].valid) continue
      let left = i - 1
      let right = i + 1
      while (left >= 0 && !points[left].valid) left -= 1
      while (right < points.length && !points[right].valid) right += 1
      if (left >= 0 && right < points.length) {
        const t = (i - left) / (right - left)
        points[i].x = lerp(points[left].x, points[right].x, t)
        points[i].y = lerp(points[left].y, points[right].y, t)
      }
    }

    return smoothPoints(points.map(({ x, y }) => ({ x, y })), 1)
  }

  const smoothPoints = (points, passes) => {
    let result = points.slice()
    for (let pass = 0; pass < passes; pass += 1) {
      result = result.map((point, index) => {
        if (index === 0 || index === result.length - 1) return point
        const prev = result[index - 1]
        const next = result[index + 1]
        return {
          x: point.x * 0.5 + (prev.x + next.x) * 0.25,
          y: point.y * 0.5 + (prev.y + next.y) * 0.25,
        }
      })
    }
    return result
  }

  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

  const resamplePath = (points, count) => {
    if (!points || points.length < 2) return points || []
    const lengths = [0]
    let total = 0
    for (let i = 1; i < points.length; i += 1) {
      total += distance(points[i - 1], points[i])
      lengths.push(total)
    }
    if (total <= 0) return points.slice()
    const result = []
    for (let i = 0; i < count; i += 1) {
      const target = (i / Math.max(1, count - 1)) * total
      let segment = 1
      while (segment < lengths.length - 1 && lengths[segment] < target) segment += 1
      const prevLen = lengths[segment - 1]
      const nextLen = lengths[segment]
      const t = nextLen === prevLen ? 0 : (target - prevLen) / (nextLen - prevLen)
      result.push({
        x: lerp(points[segment - 1].x, points[segment].x, t),
        y: lerp(points[segment - 1].y, points[segment].y, t),
      })
    }
    return result
  }

  const normalAt = (points, index) => {
    const prev = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.max(0.001, Math.hypot(dx, dy))
    return { x: -dy / len, y: dx / len, tx: dx / len, ty: dy / len }
  }

  const jitterPath = (points, guide, frameIndex, materialStrength, contourVariation) => {
    const count = clamp(Math.round(guide.length / 18), 12, 48)
    const base = resamplePath(points, count)
    const random = mulberry32(0x9e3779b9 + Math.round(guide.center.x * 13 + guide.center.y * 7))
    const amplitude = guide.width * (0.08 + contourVariation * 0.48)
    const highFrequency = 1.5 + materialStrength * 4
    return base.map((point, index) => {
      if (index === 0 || index === base.length - 1) return point
      const normal = normalAt(base, index)
      const wave = Math.sin(index * highFrequency + frameIndex * 0.78) * amplitude * 0.22
      const noise = (random() - 0.5) * amplitude
      return {
        x: point.x + normal.x * (wave + noise),
        y: point.y + normal.y * (wave + noise),
      }
    })
  }

  const strokePath = (ctx, points) => {
    if (!points.length) return
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
  }

  const positiveMod = (value, size) => ((value % size) + size) % size

  const getStyleSample = (style, u, v) => {
    const palette = style?.palette || style || defaultPalette
    const width = style?.textureWidth || 0
    const height = style?.textureHeight || 0
    const data = style?.textureData
    if (!data || width <= 0 || height <= 0) {
      const fallback = mixColor(palette.outer || defaultPalette.outer, palette.glow || defaultPalette.glow, clamp(v, 0, 1))
      return { ...fallback, lum: luminance(fallback.r, fallback.g, fallback.b), sat: saturation(fallback.r, fallback.g, fallback.b), alpha: 1 }
    }
    const x = clamp(Math.floor(positiveMod(u, 1) * (width - 1)), 0, width - 1)
    const y = clamp(Math.floor(positiveMod(v, 1) * (height - 1)), 0, height - 1)
    const offset = (y * width + x) * 4
    const r = data[offset]
    const g = data[offset + 1]
    const b = data[offset + 2]
    const alpha = data[offset + 3] / 255
    const lum = luminance(r, g, b)
    const sat = saturation(r, g, b)
    if (alpha < 0.08 || lum < 0.055) {
      const fallback = mixColor(palette.glow || defaultPalette.glow, palette.core || defaultPalette.core, 0.22 + clamp(v, 0, 1) * 0.22)
      return { ...fallback, alpha: 1, lum: luminance(fallback.r, fallback.g, fallback.b), sat: saturation(fallback.r, fallback.g, fallback.b) }
    }
    return { r, g, b, alpha, lum, sat }
  }

  const nearestStyleBin = (bins, bin) => {
    if (!bins || !bins.length) return []
    for (let delta = 0; delta < bins.length; delta += 1) {
      const left = bin - delta
      const right = bin + delta
      if (left >= 0 && bins[left]?.length) return bins[left]
      if (right < bins.length && bins[right]?.length) return bins[right]
    }
    return []
  }

  const getStyleDistributionColor = (style, targetLum, seed, bias = 0) => {
    const palette = style?.palette || style || defaultPalette
    const model = style?.styleModel
    if (!model?.bins?.length) {
      const ramp = mixColor(palette.outer || defaultPalette.outer, palette.glow || defaultPalette.glow, smoothstep(0.12, 0.78, targetLum))
      return mixColor(ramp, palette.core || defaultPalette.core, smoothstep(0.62, 1, targetLum))
    }
    const binCount = model.bins.length
    const bin = clamp(Math.floor(clamp(targetLum + bias, 0, 1) * binCount), 0, binCount - 1)
    const samples = nearestStyleBin(model.bins, bin)
    const fallback = model.binAverages?.[bin] || { ...(palette.glow || defaultPalette.glow), lum: targetLum, sat: model.satMean || 0.65 }
    const sample = samples.length ? samples[Math.floor(clamp(seed, 0, 0.999999) * samples.length)] : fallback
    const desiredLum = clamp(0.04 + targetLum * 0.78, 0.04, 0.88)
    const gain = clamp((desiredLum + 0.045) / Math.max(0.045, sample.lum || luminance(sample.r, sample.g, sample.b)), 0.48, 1.72)
    let rr = sample.r * gain
    let gg = sample.g * gain
    let bb = sample.b * gain
    const maxChannel = Math.max(rr, gg, bb)
    if (maxChannel > 255) {
      const scale = 255 / maxChannel
      rr *= scale
      gg *= scale
      bb *= scale
    }
    let color = { r: clamp(rr, 0, 255), g: clamp(gg, 0, 255), b: clamp(bb, 0, 255) }
    const ramp = mixColor(palette.outer || defaultPalette.outer, palette.glow || defaultPalette.glow, smoothstep(0.08, 0.72, targetLum))
    color = mixColor(color, ramp, 0.22)
    color = mixColor(color, palette.core || defaultPalette.core, smoothstep(0.78, 1, targetLum) * 0.16)
    return color
  }

  const blurFloatField = (source, width, height, radius) => {
    const r = Math.max(1, Math.round(radius))
    const temp = new Float32Array(source.length)
    const output = new Float32Array(source.length)
    for (let y = 0; y < height; y += 1) {
      let sum = 0
      for (let x = -r; x <= r; x += 1) sum += source[y * width + clamp(x, 0, width - 1)]
      for (let x = 0; x < width; x += 1) {
        temp[y * width + x] = sum / (r * 2 + 1)
        const remove = clamp(x - r, 0, width - 1)
        const add = clamp(x + r + 1, 0, width - 1)
        sum += source[y * width + add] - source[y * width + remove]
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let y = -r; y <= r; y += 1) sum += temp[clamp(y, 0, height - 1) * width + x]
      for (let y = 0; y < height; y += 1) {
        output[y * width + x] = sum / (r * 2 + 1)
        const remove = clamp(y - r, 0, height - 1)
        const add = clamp(y + r + 1, 0, height - 1)
        sum += temp[add * width + x] - temp[remove * width + x]
      }
    }
    return output
  }

  const sampleFloatMap = (map, width, height, u, v) => {
    if (!map || width <= 0 || height <= 0) return 0
    const x = positiveMod(u, 1) * (width - 1)
    const y = positiveMod(v, 1) * (height - 1)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(width - 1, x0 + 1)
    const y1 = Math.min(height - 1, y0 + 1)
    const tx = x - x0
    const ty = y - y0
    const a = map[y0 * width + x0]
    const b = map[y0 * width + x1]
    const c = map[y1 * width + x0]
    const d = map[y1 * width + x1]
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
  }

  const buildAifxMaterialMaps = (imageData) => {
    const { width, height, data } = imageData
    const total = width * height
    const textureMap = new Uint8ClampedArray(data)
    const alphaMap = new Float32Array(total)
    const lumMap = new Float32Array(total)
    const satMap = new Float32Array(total)
    let lumSum = 0
    let lumCount = 0

    for (let index = 0; index < total; index += 1) {
      const offset = index * 4
      const alpha = data[offset + 3] / 255
      const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
      alphaMap[index] = alpha
      lumMap[index] = alpha < 0.04 ? 0 : lum
      satMap[index] = alpha < 0.04 ? 0 : saturation(data[offset], data[offset + 1], data[offset + 2])
      if (alpha > 0.04 && lum > 0.02) {
        lumSum += lum
        lumCount += 1
      }
    }

    const meanLum = lumCount ? lumSum / lumCount : 0.5
    const lowBlur = blurFloatField(lumMap, width, height, 2)
    const broadBlur = blurFloatField(lumMap, width, height, 7)
    const detailMap = new Float32Array(total)
    const highlightMap = new Float32Array(total)
    const edgeDetailMap = new Float32Array(total)
    const shadowMap = new Float32Array(total)
    const glowMap = new Float32Array(total)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const alpha = alphaMap[index]
        if (alpha < 0.04) continue
        const lum = lumMap[index]
        const left = lumMap[y * width + Math.max(0, x - 1)]
        const right = lumMap[y * width + Math.min(width - 1, x + 1)]
        const up = lumMap[Math.max(0, y - 1) * width + x]
        const down = lumMap[Math.min(height - 1, y + 1) * width + x]
        const edge = clamp(Math.hypot(right - left, down - up) * 4.2, 0, 1)
        const fine = clamp(0.5 + (lum - lowBlur[index]) * 4.4, 0, 1)
        const broad = clamp(0.5 + (lowBlur[index] - broadBlur[index]) * 3.2, 0, 1)
        const sat = satMap[index]
        detailMap[index] = clamp(fine * 0.52 + broad * 0.2 + edge * 0.2 + sat * 0.08, 0, 1)
        edgeDetailMap[index] = clamp(edge * 0.76 + fine * 0.16 + sat * 0.08, 0, 1)
        highlightMap[index] = clamp(smoothstep(meanLum + 0.08, Math.max(meanLum + 0.18, 0.92), lum) * 0.8 + edge * 0.14 + fine * 0.06, 0, 1)
        shadowMap[index] = clamp((1 - smoothstep(Math.max(0.001, meanLum - 0.26), meanLum + 0.04, lum)) * 0.72 + (1 - fine) * 0.16 + edge * 0.12, 0, 1)
      }
    }

    const glowBase = blurFloatField(highlightMap, width, height, 4)
    for (let index = 0; index < total; index += 1) {
      glowMap[index] = clamp(glowBase[index] * 0.78 + highlightMap[index] * 0.22, 0, 1)
    }

    return {
      width,
      height,
      textureMap,
      detailMap,
      highlightMap,
      edgeDetailMap,
      shadowMap,
      glowMap,
      alphaMap,
      lumMap,
      satMap,
    }
  }

  const sampleAifxMaterialMaps = (maps, u, v) => {
    if (!maps?.textureMap || !maps.width || !maps.height) return null
    const texture = sampleImageData(
      { width: maps.width, height: maps.height, data: maps.textureMap },
      positiveMod(u, 1) * (maps.width - 1),
      positiveMod(v, 1) * (maps.height - 1),
    )
    return {
      color: texture,
      detail: sampleFloatMap(maps.detailMap, maps.width, maps.height, u, v),
      highlight: sampleFloatMap(maps.highlightMap, maps.width, maps.height, u, v),
      edge: sampleFloatMap(maps.edgeDetailMap, maps.width, maps.height, u, v),
      shadow: sampleFloatMap(maps.shadowMap, maps.width, maps.height, u, v),
      glow: sampleFloatMap(maps.glowMap, maps.width, maps.height, u, v),
      alpha: sampleFloatMap(maps.alphaMap, maps.width, maps.height, u, v),
    }
  }

  const createTemplateStructure = (templateCanvas, guide, styleProfile) => {
    const width = templateCanvas.width
    const height = templateCanvas.height
    const ctx = templateCanvas.getContext('2d', { willReadFrequently: true })
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    const alpha = new Float32Array(width * height)
    const lum = new Float32Array(width * height)
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4
      const pixelLum = luminance(data[offset], data[offset + 1], data[offset + 2])
      const pixelAlpha = data[offset + 3] / 255
      const energyLum = clamp((pixelLum - 0.035) / 0.965, 0, 1)
      const alphaGuide = pixelAlpha < 0.98 ? pixelAlpha * (0.1 + Math.pow(energyLum, 0.72) * 0.9) : 0
      lum[index] = energyLum
      alpha[index] = clamp(Math.max(energyLum * 0.95, alphaGuide), 0, 1)
    }
    const softRadius = clamp(1.3 + (styleProfile.edgeSoftness || defaultPalette.edgeSoftness) * 4.2, 2, 5)
    const glowRadius = clamp(4.5 + (styleProfile.glowStrength || defaultPalette.glowStrength) * 12, 6, 18)
    const softAlpha = blurFloatField(alpha, width, height, softRadius)
    const glowAlpha = blurFloatField(alpha, width, height, glowRadius)
    const gradient = new Float32Array(width * height)
    const highlight = new Float32Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const left = alpha[y * width + Math.max(0, x - 1)]
        const right = alpha[y * width + Math.min(width - 1, x + 1)]
        const up = alpha[Math.max(0, y - 1) * width + x]
        const down = alpha[Math.min(height - 1, y + 1) * width + x]
        const lumLeft = lum[y * width + Math.max(0, x - 1)]
        const lumRight = lum[y * width + Math.min(width - 1, x + 1)]
        const lumUp = lum[Math.max(0, y - 1) * width + x]
        const lumDown = lum[Math.min(height - 1, y + 1) * width + x]
        gradient[index] = clamp(Math.hypot(right - left, down - up) * 2.2, 0, 1)
        highlight[index] = clamp(Math.max(lum[index] - 0.46, Math.hypot(lumRight - lumLeft, lumDown - lumUp) * 0.8) / 0.54, 0, 1)
      }
    }
    const axis = guide.axis || { x: 1, y: 0 }
    const normal = guide.normal || { x: 0, y: 1 }
    return { width, height, data, alpha, lum, softAlpha, glowAlpha, gradient, highlight, axis, normal }
  }

  const drawReferenceMaterialBody = (ctx, templateCanvas, guide, style, frameIndex, frameCount, materialStrength, contourVariation) => {
    if (!templateCanvas) return
    const palette = style?.palette || style || defaultPalette
    const structure = createTemplateStructure(templateCanvas, guide, palette)
    const { width, height, data, alpha, lum, softAlpha, glowAlpha, gradient, highlight, axis, normal } = structure
    const bodyCanvas = createCanvas(width, height)
    const bodyCtx = bodyCanvas.getContext('2d', { willReadFrequently: true })
    const output = bodyCtx.createImageData(width, height)
    const out = output.data
    const glow = palette.glow || defaultPalette.glow
    const outer = palette.outer || defaultPalette.outer
    const core = palette.core || defaultPalette.core
    const textureStrength = clamp((palette.textureStrength || defaultPalette.textureStrength) * (0.45 + materialStrength * 0.75), 0.15, 1)
    const edgeSoftness = palette.edgeSoftness || defaultPalette.edgeSoftness
    const glowStrength = palette.glowStrength || defaultPalette.glowStrength
    const length = Math.max(1, guide.length || Math.max(width, height))
    const bodyAlpha = 0.075 + materialStrength * 0.11

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const offset = index * 4
        const a = alpha[index]
        const soft = softAlpha[index]
        const glowField = glowAlpha[index]
        if (Math.max(a, soft, glowField) < 0.01) continue
        const dx = x - guide.center.x
        const dy = y - guide.center.y
        const proj = (dx * axis.x + dy * axis.y) / length
        const side = (dx * normal.x + dy * normal.y) / Math.max(1, guide.width * 2.8)
        const edge = clamp(Math.max(0, soft - a) * (0.42 + edgeSoftness * 0.24) + gradient[index] * (1.18 + edgeSoftness * 0.32), 0, 1)
        const hot = highlight[index]
        const templateEnergy = clamp(Math.pow(a, 1.28), 0, 1)
        const templateDetail = clamp(templateEnergy * 0.78 + hot * 0.38 + gradient[index] * 0.24, 0, 1)
        const sampleA = getStyleSample(style, proj * (1.1 + textureStrength * 0.55) + frameIndex * 0.026, side + 0.5)
        const sampleB = getStyleSample(style, proj * 2.6 - side * 0.34 + frameIndex * 0.018, side * 1.7 + 0.5)
        const refTexture = clamp(sampleA.lum * 0.58 + sampleB.sat * 0.22 + sampleB.lum * 0.2, 0, 1)
        const flow = 0.5 + Math.sin(proj * Math.PI * (8 + textureStrength * 12) + side * 4.4 + frameIndex * 0.7) * 0.5
        const micro = 0.5 + Math.sin((x * 0.041 - y * 0.027) + frameIndex * 0.53) * 0.5
        const materialTexture = clamp(0.54 + refTexture * 0.48 + flow * 0.18 * textureStrength + micro * 0.10, 0.25, 1.35)
        const edgeNoise = clamp(0.28 + refTexture * 0.42 + flow * 0.2 + micro * 0.16 + hot * 0.16, 0.05, 1)
        const edgeMaterial = clamp(0.24 + refTexture * 0.5 + flow * 0.18 + micro * 0.12 + hot * 0.28, 0.05, 1)
        const glowPresence = clamp(0.3 + refTexture * 0.34 + hot * 0.5 + a * 0.3 - edge * 0.16, 0.12, 1)
        const materialDissolve = clamp(
          (refTexture * 0.5 + flow * 0.22 + micro * 0.12 + hot * 0.42 + templateEnergy * 0.5 - 0.34 - edge * 0.18) / 0.58,
          0,
          1,
        )
        let color = mixColor(glow, outer, edge * 0.12)
        color = mixColor(color, glow, clamp(templateDetail * 0.72 + soft * 0.28, 0, 1))
        color = mixColor(color, sampleA, textureStrength * (0.35 + templateDetail * 0.28))
        color = mixColor(color, sampleB, textureStrength * edge * 0.2)
        color = mixColor(color, core, hot * (0.44 + materialStrength * 0.36))
        color = mixColor(color, glow, edge * (0.18 + edgeSoftness * 0.28))
        color = mixColor(color, outer, clamp((1 - templateEnergy) * 0.34 + edge * 0.12, 0, 0.5))
        const shapedAlpha = clamp(templateEnergy * 0.78 + hot * 0.28 + gradient[index] * 0.16 + soft * 0.08, 0, 1)
        const edgeDissolve = clamp(1 - edge * (0.82 + edgeSoftness * 0.3) * (1.05 - edgeMaterial * 0.48), 0.03, 1)
        const dissolveKeep = 0.18 + materialDissolve * 0.82
        const alphaBody = Math.pow(shapedAlpha, 1.36) * bodyAlpha * (0.46 + materialTexture * 0.22) * edgeDissolve * dissolveKeep
        const alphaEdge = gradient[index] * (0.012 + edgeSoftness * 0.04) * edgeMaterial * (0.45 + templateEnergy * 0.55) * (0.22 + materialDissolve * 0.78)
        const alphaGlow =
          Math.pow(glowField, 1.55) *
          (0.018 + glowStrength * 0.06) *
          glowPresence *
          (0.45 + edgeNoise * 0.28) *
          (0.3 + materialDissolve * 0.7)
        const finalAlpha = clamp((alphaBody + alphaEdge + alphaGlow + hot * 0.055) * (0.68 + contourVariation * 0.08), 0, 0.44)
        const shade = clamp(0.24 + materialTexture * 0.48 + templateDetail * 0.28 + hot * 0.45 - edge * 0.16, 0.08, 1.22)
        out[offset] = clamp(color.r * shade, 0, 255)
        out[offset + 1] = clamp(color.g * shade, 0, 255)
        out[offset + 2] = clamp(color.b * shade, 0, 255)
        out[offset + 3] = Math.round(finalAlpha * 255)
      }
    }

    bodyCtx.putImageData(output, 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.filter = `blur(${clamp(1.2 + edgeSoftness * 2.6, 1.4, 3.6)}px)`
    ctx.globalAlpha = clamp(0.1 + glowStrength * 0.1, 0.14, 0.28)
    ctx.drawImage(bodyCanvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 0.5
    ctx.drawImage(bodyCanvas, 0, 0)
    ctx.restore()
  }

  const drawReferenceStyleAccents = (ctx, path, guide, style, frameIndex, materialStrength, contourVariation, energy) => {
    const palette = style?.palette || style || defaultPalette
    const random = mulberry32(0x87c37b91 + Math.round(guide.center.x * 17))
    const accentCount = Math.round((5 + (palette.streakiness || 0.5) * 9 + materialStrength * 4) * energy)
    const glow = palette.glow || defaultPalette.glow
    const core = palette.core || defaultPalette.core
    const spark = palette.spark || brighten(glow, 0.5)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < accentCount; i += 1) {
      const offset = (random() - 0.5) * guide.width * (0.8 + contourVariation * 2.1)
      const start = clamp(Math.floor(random() * path.length * 0.42), 0, Math.max(0, path.length - 3))
      const end = clamp(start + 4 + Math.floor(random() * Math.max(3, path.length * 0.32)), start + 2, path.length - 1)
      const points = []
      for (let index = start; index <= end; index += 1) {
        const normal = normalAt(path, index)
        const wave = Math.sin(index * 1.7 + frameIndex * 0.9 + i) * guide.width * 0.08
        points.push({ x: path[index].x + normal.x * (offset + wave), y: path[index].y + normal.y * (offset + wave) })
      }
      ctx.shadowBlur = guide.width * (0.38 + materialStrength * 0.45)
      ctx.shadowColor = colorCss(glow, 0.65)
      ctx.strokeStyle = colorCss(i % 2 ? spark : core, 0.26 + materialStrength * 0.34)
      ctx.lineWidth = clamp(guide.width * (0.028 + random() * 0.062), 0.65, 4)
      strokePath(ctx, points)
    }
    const particleCount = Math.round((8 + (palette.particleDensity || 0.45) * 28 + materialStrength * 12) * energy)
    for (let i = 0; i < particleCount; i += 1) {
      const pathIndex = Math.floor(random() * path.length)
      const origin = path[pathIndex] || guide.center
      const normal = normalAt(path, clamp(pathIndex, 1, path.length - 2))
      const scatter = guide.width * (0.45 + contourVariation * 2.2) * (random() - 0.5)
      const drift = guide.length * 0.055 * (random() - 0.5)
      const radius = clamp(guide.width * (0.018 + random() * 0.052), 0.6, 4.2)
      const x = origin.x + normal.x * scatter + normal.tx * drift
      const y = origin.y + normal.y * scatter + normal.ty * drift
      const sample = getStyleSample(style, random(), random())
      const color = mixColor(sample, random() > 0.5 ? spark : glow, 0.55)
      ctx.shadowBlur = radius * (3.5 + materialStrength * 4)
      ctx.shadowColor = colorCss(color, 0.78)
      ctx.fillStyle = colorCss(color, 0.48 + materialStrength * 0.35)
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  const refineGeneratedAlphaFromLight = (canvas, style) => {
    const palette = style?.palette || style || defaultPalette
    const edgeSoftness = palette.edgeSoftness || defaultPalette.edgeSoftness
    const glowStrength = palette.glowStrength || defaultPalette.glowStrength
    const width = canvas.width
    const height = canvas.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const image = ctx.getImageData(0, 0, width, height)
    const data = image.data
    const alpha = new Float32Array(width * height)
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = data[index * 4 + 3] / 255
    const soft = blurFloatField(alpha, width, height, clamp(1.2 + edgeSoftness * 3, 2, 5))
    const glow = blurFloatField(alpha, width, height, clamp(3 + glowStrength * 7, 4, 10))
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4
      const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
      const lightKeep = clamp(0.24 + Math.pow(clamp(lum, 0, 1), 0.72) * 0.9, 0, 1)
      const feathered = Math.pow(alpha[index], 0.92) * 0.66 + soft[index] * 0.25 + Math.pow(glow[index], 1.65) * 0.07
      const finalAlpha = clamp(feathered * lightKeep, 0, 0.88)
      if (finalAlpha < 0.012) {
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
        data[offset + 3] = 0
      } else {
        data[offset + 3] = Math.round(finalAlpha * 255)
      }
    }
    ctx.putImageData(image, 0, 0)
  }

  const drawTemplateEnergyBody = (ctx, templateCanvas, palette, guide, energy, materialStrength, frameIndex) => {
    if (!templateCanvas) return
    const width = templateCanvas.width
    const height = templateCanvas.height
    const sourceCtx = templateCanvas.getContext('2d', { willReadFrequently: true })
    const source = sourceCtx.getImageData(0, 0, width, height)
    const bodyCanvas = createCanvas(width, height)
    const bodyCtx = bodyCanvas.getContext('2d', { willReadFrequently: true })
    const output = bodyCtx.createImageData(width, height)
    const src = source.data
    const out = output.data
    const glow = palette.glow || defaultPalette.glow
    const outer = palette.outer || defaultPalette.outer
    const core = palette.core || defaultPalette.core
    const bodyPower = 0.28 + materialStrength * 0.28

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const alpha = src[offset + 3] / 255
        const lum = luminance(src[offset], src[offset + 1], src[offset + 2])
        const intensity = Math.max(alpha * 0.92, lum * 1.08)
        if (intensity < 0.025) continue
        const hot = clamp((lum - 0.42) / 0.58, 0, 1)
        const mid = clamp(intensity * 1.32, 0, 1)
        const texture =
          0.84 +
          Math.sin(x * 0.075 + y * 0.039 + frameIndex * 0.72) * 0.08 +
          Math.sin(x * 0.021 - y * 0.067 - frameIndex * 0.38) * 0.08
        const color = mixColor(mixColor(outer, glow, mid), core, hot * 0.82)
        const edgeBoost = clamp((intensity - 0.18) / 0.82, 0, 1)
        out[offset] = clamp(color.r * texture + core.r * hot * 0.22, 0, 255)
        out[offset + 1] = clamp(color.g * texture + core.g * hot * 0.22, 0, 255)
        out[offset + 2] = clamp(color.b * texture + core.b * hot * 0.22, 0, 255)
        out[offset + 3] = Math.round(clamp((Math.pow(intensity, 0.88) * bodyPower + hot * 0.24 + edgeBoost * 0.08) * energy, 0, 0.86) * 255)
      }
    }

    bodyCtx.putImageData(output, 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.filter = `blur(${clamp(guide.width * 0.08, 3, 12)}px)`
    ctx.globalAlpha = 0.45
    ctx.drawImage(bodyCanvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 0.92
    ctx.drawImage(bodyCanvas, 0, 0)
    ctx.restore()
  }

  const drawReferenceGuidedFrame = (canvas, guide, frameIndex, frameCount, style, options = {}) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const width = canvas.width
    const height = canvas.height
    const templateCanvas = options.templateCanvas
    ctx.clearRect(0, 0, width, height)
    if (!templateCanvas) return

    const materialStrength = clamp((options.materialStrength ?? state.materialStrength) / 100, 0, 1)
    // The old "contour variation" slider is kept as texture-detail intensity only.
    // Pure style transfer must not add new paths, particles, or geometry.
    const textureDetail = clamp((options.contourVariation ?? state.contourVariation) / 100, 0, 1)
    const palette = style?.palette || style || defaultPalette
    const sourceCanvas =
      templateCanvas.width === width && templateCanvas.height === height
        ? templateCanvas
        : (() => {
            const normalized = createCanvas(width, height)
            normalized.getContext('2d').drawImage(templateCanvas, 0, 0, width, height)
            return normalized
          })()
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
    const sourceImage = sourceCtx.getImageData(0, 0, width, height)
    const src = sourceImage.data
    const total = width * height
    const rawAlpha = new Float32Array(total)
    const lumField = new Float32Array(total)
    const alphaField = new Float32Array(total)
    let transparentPixels = 0
    let maxLum = 0

    for (let index = 0; index < total; index += 1) {
      const offset = index * 4
      const alpha = src[offset + 3] / 255
      const lum = luminance(src[offset], src[offset + 1], src[offset + 2])
      rawAlpha[index] = alpha
      lumField[index] = lum
      if (alpha < 0.985) transparentPixels += 1
      maxLum = Math.max(maxLum, lum)
    }

    const hasUsefulAlpha = transparentPixels > total * 0.015
    const blackFloor = hasUsefulAlpha ? 0 : Math.min(0.06, maxLum * 0.08)
    for (let index = 0; index < total; index += 1) {
      const alpha = rawAlpha[index]
      const lum = lumField[index]
      const luminancePresence = clamp((lum - blackFloor) / Math.max(0.001, 1 - blackFloor), 0, 1)
      alphaField[index] = hasUsefulAlpha ? alpha : luminancePresence
    }

    const edgeSoftness = palette.edgeSoftness || defaultPalette.edgeSoftness
    const glowStrength = palette.glowStrength || defaultPalette.glowStrength
    const softAlpha = blurFloatField(alphaField, width, height, clamp(0.8 + edgeSoftness * 1.8, 1, 3))
    const glowAlpha = blurFloatField(alphaField, width, height, clamp(2.4 + glowStrength * 5.2, 3, 8))
    const smoothLum = blurFloatField(lumField, width, height, 2)
    const output = ctx.createImageData(width, height)
    const out = output.data
    const outer = palette.outer || defaultPalette.outer
    const glow = palette.glow || defaultPalette.glow
    const core = palette.core || defaultPalette.core
    const model = style?.styleModel
    const axis = guide?.axis || { x: 1, y: 0 }
    const normal = guide?.normal || { x: 0, y: 1 }
    const center = guide?.center || { x: width * 0.5, y: height * 0.5 }
    const length = Math.max(1, guide?.length || Math.max(width, height))
    const bodyWidth = Math.max(1, guide?.width || Math.max(width, height) * 0.12)
    const textureScale = 2.4 + textureDetail * 6.2 + (model?.edgeMean || 0.35) * 2.4
    const transferWeight = clamp(0.72 + materialStrength * 0.26, 0.72, 0.98)
    const glowWeight = clamp(0.02 + glowStrength * 0.045 + materialStrength * 0.025, 0.035, 0.105)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const offset = index * 4
        const alpha = alphaField[index]
        const glowField = glowAlpha[index]
        if (Math.max(alpha, glowField) < 0.006) continue

        const dx = x - center.x
        const dy = y - center.y
        const proj = (dx * axis.x + dy * axis.y) / length + 0.5
        const side = (dx * normal.x + dy * normal.y) / (bodyWidth * 3.2) + 0.5
        const lum = lumField[index]
        const soft = softAlpha[index]
        const hot = clamp((lum - 0.52) / 0.48, 0, 1)
        const leftAlpha = alphaField[y * width + Math.max(0, x - 1)]
        const rightAlpha = alphaField[y * width + Math.min(width - 1, x + 1)]
        const upAlpha = alphaField[Math.max(0, y - 1) * width + x]
        const downAlpha = alphaField[Math.min(height - 1, y + 1) * width + x]
        const alphaGradient = clamp(Math.hypot(rightAlpha - leftAlpha, downAlpha - upAlpha) * 2.4, 0, 1)
        const localContrast = clamp((lum - smoothLum[index]) * 2.9 + 0.5, 0, 1)
        const edge = clamp(Math.abs(soft - alpha) * 3.2 + (soft > 0 ? clamp((soft - alpha) / Math.max(0.001, soft), 0, 1) * 0.24 : 0), 0, 1)
        const seed = hash01(x, y, Math.round(materialStrength * 997))
        const flowU = proj * textureScale + seed * 0.37 + frameIndex * 0.021
        const flowV = side * (textureScale * 0.46 + textureDetail * 1.4) + hash01(y, x, 19) * 0.29
        const textureA = getStyleSample(style, flowU, flowV)
        const textureB = getStyleSample(style, proj * (textureScale * 1.73) - side * 0.41 + seed * 0.21, side * (textureScale * 0.8) + frameIndex * 0.013)
        const refMean = model?.lumMean ?? 0.5
        const refStd = Math.max(0.045, model?.lumStd ?? 0.18)
        const refHighFreq = clamp(((textureA.lum - refMean) / refStd) * 0.16 + ((textureB.lum - refMean) / refStd) * 0.1 + 0.5, 0, 1)
        const refChroma = clamp((textureA.sat + textureB.sat) * 0.5, 0, 1)
        const flowWave = 0.5 + Math.sin(proj * Math.PI * (12 + textureDetail * 22) + side * (4.6 + textureDetail * 8) + frameIndex * 0.72) * 0.5
        const fineWave = 0.5 + Math.sin(x * 0.047 - y * 0.031 + frameIndex * 0.67 + seed * 2.2) * 0.5
        const styleTexture = clamp(refHighFreq * 0.46 + refChroma * 0.16 + flowWave * 0.18 + fineWave * 0.1 + localContrast * 0.1, 0, 1)
        const bodyIntensity = clamp(alpha * 0.34 + lum * 0.92 + hot * 0.18 + localContrast * 0.1, 0, 1)
        const targetLum = clamp(Math.pow(bodyIntensity, 1.08) * 0.58 + hot * 0.22 + styleTexture * textureDetail * 0.12, 0, 0.92)
        const rampMid = Math.pow(bodyIntensity, 0.82)
        let color = mixColor(outer, glow, rampMid * 0.88)
        color = mixColor(color, core, hot * (0.14 + materialStrength * 0.12))
        const distColorA = getStyleDistributionColor(style, targetLum, seed)
        const distColorB = getStyleDistributionColor(style, clamp(targetLum + (styleTexture - 0.5) * 0.34, 0, 1), hash01(x + 37, y - 53, 193), (styleTexture - 0.5) * 0.14)
        color = mixColor(color, distColorA, transferWeight * (0.68 + materialStrength * 0.12))
        color = mixColor(color, distColorB, textureDetail * (0.22 + styleTexture * 0.22))
        color = mixColor(color, core, hot * materialStrength * 0.04)
        color = boostSaturation(color, 0.18 + materialStrength * 0.28 + textureDetail * 0.16)

        const vein = smoothstep(0.66, 0.96, styleTexture * 0.54 + localContrast * 0.2 + alphaGradient * 0.16 + hot * 0.16)
        const materialCut = smoothstep(0.18, 0.72, styleTexture * 0.62 + lum * 0.28 + localContrast * 0.14 - edge * 0.22)
        const sourceDetail = clamp(0.34 + lum * 0.46 + localContrast * (0.08 + textureDetail * 0.22) + styleTexture * (0.1 + textureDetail * 0.22) + vein * 0.14 + hot * 0.16, 0.08, 1.28)
        const edgeShade = clamp(1 - edge * (0.2 + edgeSoftness * 0.18) + vein * 0.08, 0.46, 1.08)
        out[offset] = clamp(color.r * sourceDetail * edgeShade, 0, 255)
        out[offset + 1] = clamp(color.g * sourceDetail * edgeShade, 0, 255)
        out[offset + 2] = clamp(color.b * sourceDetail * edgeShade, 0, 255)

        const baseAlpha = hasUsefulAlpha ? rawAlpha[index] : alpha
        const energyOpacity = clamp(0.2 + Math.pow(bodyIntensity, 0.78) * 0.76 + hot * 0.24, 0.08, 1)
        const textureOpacity = clamp(0.52 + materialCut * 0.4 + vein * 0.18 - edge * 0.22, 0.18, 1.05)
        const feather = soft * clamp(0.012 + edgeSoftness * 0.028, 0.018, 0.065) * clamp(0.35 + bodyIntensity, 0.25, 1.2)
        const glowFeather = Math.pow(glowField, 1.78) * glowWeight * clamp(0.18 + lum * 0.72 + hot * 0.82 + styleTexture * 0.22, 0.14, 1.18)
        const finalAlpha = clamp(baseAlpha * energyOpacity * textureOpacity + feather + glowFeather, 0, 0.96)
        out[offset + 3] = Math.round(finalAlpha * 255)
      }
    }

    ctx.putImageData(output, 0, 0)
    refineGeneratedAlphaFromLight(canvas, style)
    void frameCount
  }

  const drawSoftShadow = (ctx, guide, palette, energy) => {
    const radius = clamp(guide.width * (2.6 + energy * 0.8), 14, Math.max(guide.canvasWidth, guide.canvasHeight) * 0.12)
    const gradient = ctx.createRadialGradient(guide.center.x, guide.center.y, 0, guide.center.x, guide.center.y, radius)
    gradient.addColorStop(0, colorCss(palette.glow, 0.055 * energy))
    gradient.addColorStop(0.38, colorCss(palette.outer, 0.032 * energy))
    gradient.addColorStop(1, colorCss(palette.outer, 0))
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, guide.canvasWidth, guide.canvasHeight)
  }

  const drawBranches = (ctx, path, guide, palette, random, materialStrength, contourVariation, energy) => {
    const branchCount = Math.round((3 + palette.branchDensity * 7 + materialStrength * 6) * energy)
    const baseLength = guide.width * (1.2 + contourVariation * 3.2)
    for (let i = 0; i < branchCount; i += 1) {
      const pathIndex = clamp(Math.floor(random() * path.length), 1, path.length - 2)
      const origin = path[pathIndex]
      const normal = normalAt(path, pathIndex)
      const side = random() > 0.5 ? 1 : -1
      const length = baseLength * (0.45 + random() * 1.45)
      const segments = 2 + Math.floor(random() * 3)
      const points = [{ x: origin.x, y: origin.y }]
      let x = origin.x
      let y = origin.y
      for (let segment = 1; segment <= segments; segment += 1) {
        const forward = length * 0.25 * (0.3 + random())
        const spread = (length / segments) * side * (0.7 + random())
        x += normal.tx * forward + normal.x * spread
        y += normal.ty * forward + normal.y * spread
        points.push({ x, y })
      }
      ctx.shadowBlur = guide.width * 0.55
      ctx.shadowColor = colorCss(palette.glow, 0.65)
      ctx.strokeStyle = colorCss(palette.glow, 0.45 * energy)
      ctx.lineWidth = Math.max(1, guide.width * 0.11)
      strokePath(ctx, points)
      ctx.shadowBlur = guide.width * 0.18
      ctx.strokeStyle = colorCss(palette.core, 0.82 * energy)
      ctx.lineWidth = Math.max(0.8, guide.width * 0.045)
      strokePath(ctx, points)
    }
  }

  const drawParticles = (ctx, path, guide, palette, random, materialStrength, contourVariation, energy) => {
    const count = Math.round((12 + materialStrength * 30 + palette.branchDensity * 18) * energy)
    for (let i = 0; i < count; i += 1) {
      const pathIndex = Math.floor(random() * path.length)
      const origin = path[pathIndex] || guide.center
      const normal = normalAt(path, clamp(pathIndex, 1, path.length - 2))
      const scatter = guide.width * (0.75 + contourVariation * 3.4) * (random() - 0.5)
      const drift = guide.length * 0.08 * (random() - 0.5)
      const x = origin.x + normal.x * scatter + normal.tx * drift
      const y = origin.y + normal.y * scatter + normal.ty * drift
      const radius = clamp(guide.width * (0.025 + random() * 0.065), 0.8, 4)
      ctx.shadowBlur = radius * 5
      ctx.shadowColor = colorCss(palette.glow, 0.8)
      ctx.fillStyle = colorCss(random() > 0.35 ? palette.spark : palette.core, 0.82 * energy)
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()

      if (random() > 0.62) {
        const len = radius * (4 + random() * 7)
        ctx.strokeStyle = colorCss(palette.spark, 0.55 * energy)
        ctx.lineWidth = Math.max(0.7, radius * 0.45)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + normal.tx * len, y + normal.ty * len)
        ctx.stroke()
      }
    }
  }

  const drawHotCore = (ctx, guide, palette, energy, frameIndex, frameCount) => {
    const pulse = 0.72 + Math.sin((frameIndex / Math.max(1, frameCount - 1)) * Math.PI) * 0.38
    const radius = clamp(guide.width * (0.28 + pulse * 0.46), 5, Math.max(guide.canvasWidth, guide.canvasHeight) * 0.055)
    const gradient = ctx.createRadialGradient(guide.center.x, guide.center.y, 0, guide.center.x, guide.center.y, radius)
    gradient.addColorStop(0, colorCss({ r: 255, g: 255, b: 255 }, 0.42 * energy))
    gradient.addColorStop(0.26, colorCss(palette.core, 0.3 * energy))
    gradient.addColorStop(0.72, colorCss(palette.glow, 0.06 * energy))
    gradient.addColorStop(1, colorCss(palette.outer, 0))
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, guide.canvasWidth, guide.canvasHeight)
  }

  const validateFrame = (canvas) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    const sampledPixels = canvas.width * canvas.height
    let visiblePixels = 0
    let transparentPixels = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] / 255 > 0.05) visiblePixels += 1
      else transparentPixels += 1
    }
    let bright = 0
    let brightSamples = 0
    const step = Math.max(4, Math.floor(Math.max(canvas.width, canvas.height) / 128))
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const offset = (y * canvas.width + x) * 4
        const alpha = data[offset + 3] / 255
        if (alpha > 0.05) {
          brightSamples += 1
          bright += luminance(data[offset], data[offset + 1], data[offset + 2]) * alpha
        }
      }
    }
    return {
      alphaPixels: visiblePixels,
      visiblePixels,
      transparentPixels,
      sampledPixels,
      coverageRatio: visiblePixels / Math.max(1, sampledPixels),
      transparentRatio: transparentPixels / Math.max(1, sampledPixels),
      brightness: bright / Math.max(1, brightSamples),
    }
  }

  const analyzeAifxAnchorMaterialDetail = (frame) => {
    const canvas = frame?.canvas
    if (!canvas?.getContext) throw new Error('AI anchor material-detail analysis requires a decoded canvas.')
    const width = Math.max(1, canvas.width)
    const height = Math.max(1, canvas.height)
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data
    let visiblePixels = 0
    let luminanceTotal = 0
    let luminanceSquared = 0
    let detailTotal = 0
    let detailSamples = 0
    let structuredEdges = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const alpha = data[offset + 3] / 255
        if (alpha <= 0.05) continue
        const current = luminance(data[offset], data[offset + 1], data[offset + 2])
        visiblePixels += 1
        luminanceTotal += current
        luminanceSquared += current * current
        if (x + 1 < width) {
          const rightOffset = offset + 4
          if (data[rightOffset + 3] / 255 > 0.05) {
            const difference = Math.abs(current - luminance(data[rightOffset], data[rightOffset + 1], data[rightOffset + 2]))
            detailTotal += difference
            detailSamples += 1
            if (difference >= 0.035) structuredEdges += 1
          }
        }
        if (y + 1 < height) {
          const downOffset = offset + width * 4
          if (data[downOffset + 3] / 255 > 0.05) {
            const difference = Math.abs(current - luminance(data[downOffset], data[downOffset + 1], data[downOffset + 2]))
            detailTotal += difference
            detailSamples += 1
            if (difference >= 0.035) structuredEdges += 1
          }
        }
      }
    }
    const mean = luminanceTotal / Math.max(1, visiblePixels)
    return Object.freeze({
      visibleRatio: visiblePixels / Math.max(1, width * height),
      luminanceVariance: Math.max(0, luminanceSquared / Math.max(1, visiblePixels) - mean * mean),
      detail: detailTotal / Math.max(1, detailSamples),
      structuredEdgeRatio: structuredEdges / Math.max(1, detailSamples),
    })
  }

  const assertAifxAnchorMaterialReadable = (frame, materialType, anchorRole) => {
    const detail = analyzeAifxAnchorMaterialDetail(frame)
    const thresholds = {
      fire: { detail: 0.009, structuredEdgeRatio: 0.012 },
      lightning: { detail: 0.012, structuredEdgeRatio: 0.018 },
      ice: { detail: 0.009, structuredEdgeRatio: 0.012 },
      poison: { detail: 0.008, structuredEdgeRatio: 0.01 },
    }[materialType]
    if (!thresholds) return detail
    const featureless = detail.detail < thresholds.detail
      || detail.structuredEdgeRatio < thresholds.structuredEdgeRatio
    if (featureless) {
      throw aifxRuntimeError(
        'AIFX_ANCHOR_MATERIAL_UNREADABLE',
        `The generated ${anchorRole} ${materialType} anchor lost its readable material structure.`,
        { anchorRole, materialType, detail, thresholds },
      )
    }
    return detail
  }

  const fitAifxClippedAnchorToSafeMargin = (frame, geometry, safeScale = 0.8) => {
    if (!geometry?.boundaryClipped) return Object.freeze({ frame, repair: null })
    const width = Math.max(1, Math.round(Number(frame?.width || frame?.canvas?.width) || 1))
    const height = Math.max(1, Math.round(Number(frame?.height || frame?.canvas?.height) || 1))
    const sourceCanvas = frame?.canvas
    if (!sourceCanvas?.getContext) throw new Error('AI anchor boundary repair requires a decoded canvas.')
    const feathered = createCanvas(width, height)
    const featheredContext = feathered.getContext('2d', { willReadFrequently: true })
    featheredContext.clearRect(0, 0, width, height)
    featheredContext.drawImage(sourceCanvas, 0, 0, width, height)
    const image = featheredContext.getImageData(0, 0, width, height)
    const feather = Math.max(4, Math.round(Math.min(width, height) * 0.08))
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const edgeDistance = Math.min(x, y, width - 1 - x, height - 1 - y)
        const linear = clamp(edgeDistance / feather, 0, 1)
        const smooth = linear * linear * (3 - 2 * linear)
        const offset = (y * width + x) * 4
        image.data[offset + 3] = Math.round(image.data[offset + 3] * smooth)
      }
    }
    featheredContext.putImageData(image, 0, 0)
    const scale = clamp(Number(safeScale) || 0.8, 0.65, 0.9)
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))
    const targetX = Math.round((width - targetWidth) * 0.5)
    const targetY = Math.round((height - targetHeight) * 0.5)
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(feathered, targetX, targetY, targetWidth, targetHeight)
    return Object.freeze({
      frame: Object.freeze({
        ...frame,
        width,
        height,
        canvas,
        dataUrl: canvas.toDataURL('image/png'),
      }),
      repair: Object.freeze({
        applied: true,
        method: 'ai-alpha-edge-feather-and-uniform-contain',
        safeScale: scale,
        featherPixels: feather,
        templatePixelsUsed: false,
        nonUniformDeformationUsed: false,
      }),
    })
  }

  const removeAifxIsolatedCoreObjects = (frame, materialType) => {
    const canvas = frame?.canvas
    if (!canvas?.getContext) throw new Error('AI anchor content cleanup requires a decoded canvas.')
    const width = Math.max(1, Math.round(Number(frame.width || canvas.width) || 1))
    const height = Math.max(1, Math.round(Number(frame.height || canvas.height) || 1))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const image = context.getImageData(0, 0, width, height)
    const pixelCount = width * height
    const labels = new Int32Array(pixelCount)
    labels.fill(-1)
    const queue = new Int32Array(pixelCount)
    const components = []
    const alphaThreshold = 0.24
    const neighbors = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ]
    for (let start = 0; start < pixelCount; start += 1) {
      if (labels[start] !== -1 || image.data[start * 4 + 3] / 255 < alphaThreshold) continue
      const id = components.length
      let head = 0
      let tail = 0
      let area = 0
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1
      labels[start] = id
      queue[tail++] = start
      while (head < tail) {
        const index = queue[head++]
        const x = index % width
        const y = Math.floor(index / width)
        area += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        for (const [dx, dy] of neighbors) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (labels[next] !== -1 || image.data[next * 4 + 3] / 255 < alphaThreshold) continue
          labels[next] = id
          queue[tail++] = next
        }
      }
      components.push({ id, area, minX, minY, maxX, maxY })
    }
    if (components.length < 2) return Object.freeze({ frame, cleanup: null })
    const main = components.reduce((best, entry) => entry.area > best.area ? entry : best, components[0])
    const minimumAreaRatio = materialType === 'ice' ? 0.004 : 0.0015
    const minimumArea = Math.max(96, Math.round(pixelCount * minimumAreaRatio))
    const suspects = components.filter((entry) => (
      entry.id !== main.id
      && entry.area >= minimumArea
      && entry.area <= main.area * 0.45
      && entry.minX > main.minX
      && entry.minY > main.minY
      && entry.maxX < main.maxX
      && entry.maxY < main.maxY
    ))
    if (!suspects.length) return Object.freeze({ frame, cleanup: null })
    const cleaned = createCanvas(width, height)
    const cleanedContext = cleaned.getContext('2d', { willReadFrequently: true })
    cleanedContext.drawImage(canvas, 0, 0, width, height)
    const cleanedImage = cleanedContext.getImageData(0, 0, width, height)
    const margin = Math.max(3, Math.round(Math.min(width, height) * 0.015))
    const removed = suspects.map((entry) => {
      const x0 = Math.max(0, entry.minX - margin)
      const y0 = Math.max(0, entry.minY - margin)
      const x1 = Math.min(width - 1, entry.maxX + margin)
      const y1 = Math.min(height - 1, entry.maxY + margin)
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const offset = (y * width + x) * 4
          cleanedImage.data[offset] = 0
          cleanedImage.data[offset + 1] = 0
          cleanedImage.data[offset + 2] = 0
          cleanedImage.data[offset + 3] = 0
        }
      }
      return Object.freeze({ area: entry.area, x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    })
    cleanedContext.putImageData(cleanedImage, 0, 0)
    return Object.freeze({
      frame: Object.freeze({ ...frame, canvas: cleaned, dataUrl: cleaned.toDataURL('image/png') }),
      cleanup: Object.freeze({
        applied: true,
        method: 'isolated-core-object-rejection',
        alphaThreshold,
        removed: Object.freeze(removed),
        templatePixelsUsed: false,
      }),
    })
  }

  const dataUrlToBase64 = (dataUrl) => String(dataUrl || '').split(',')[1] || ''
  const base64ToBytes = (base64) => {
    const raw = atob(String(base64 || ''))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return bytes
  }

  const comfyError = (prefix, response) => {
    const message =
      response?.error ||
      response?.raw ||
      response?.data?.error ||
      response?.data?.detail ||
      response?.data?.message ||
      response?.status ||
      'unknown error'
    return new Error(`${prefix}: ${typeof message === 'string' ? message : JSON.stringify(message)}`)
  }

  const parseJsonOrRawText = (text) => {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  const runtimeRequestJson = async (path, init = { method: 'GET' }) => {
    const api = window.electronAPI
    if (api?.runtimeRequestJson) {
      const response = await api.runtimeRequestJson({ baseUrl: state.comfyBaseUrl, path, init })
      if (!response?.ok) throw comfyError(`NovaFlow AI Runtime ${path}`, response)
      return response.data
    }
    const res = await fetch(`${state.comfyBaseUrl}${path}`, init)
    const text = await res.text()
    const parsed = text ? parseJsonOrRawText(text) : null
    const data = parsed === text ? { raw: text } : parsed
    if (!res.ok) throw comfyError(`NovaFlow AI Runtime ${path}`, { status: res.status, data })
    return data
  }

  const runtimeRequestBinary = async (path) => {
    const api = window.electronAPI
    if (api?.runtimeRequestBinary) {
      const response = await api.runtimeRequestBinary({ baseUrl: state.comfyBaseUrl, path, init: { method: 'GET' } })
      if (!response?.ok) throw comfyError(`NovaFlow AI Runtime ${path}`, response)
      const contentType = response.contentType || 'image/png'
      return new Blob([base64ToBytes(response.dataBase64)], { type: contentType })
    }
    const res = await fetch(`${state.comfyBaseUrl}${path}`, { method: 'GET' })
    if (!res.ok) throw new Error(`NovaFlow AI Runtime image download failed: ${res.status}`)
    return await res.blob()
  }

  const uploadComfyImage = async (dataUrl, fileName) => {
    const api = window.electronAPI
    if (api?.runtimeUploadImage) {
      const response = await api.runtimeUploadImage({
        baseUrl: state.comfyBaseUrl,
        fileName,
        dataBase64: dataUrlToBase64(dataUrl),
        type: 'input',
        subfolder: '',
      })
      if (!response?.ok) throw comfyError('NovaFlow AI Runtime upload', response)
      return String(response.data?.name || fileName)
    }

    const form = new FormData()
    form.append('image', await (await fetch(dataUrl)).blob(), fileName)
    form.append('type', 'input')
    const res = await fetch(`${state.comfyBaseUrl}/upload/image`, { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw comfyError('NovaFlow AI Runtime upload', { status: res.status, data })
    return String(data?.name || fileName)
  }

  const getComfyObjectInfo = async () => {
    if (state.comfyObjectInfo) return state.comfyObjectInfo
    state.comfyObjectInfo = await runtimeRequestJson('/object_info', { method: 'GET' })
    return state.comfyObjectInfo
  }

  const requireComfyStyleNodes = async () => {
    const info = await getComfyObjectInfo()
    const missing = COMFY_STYLE_NODES.filter((name) => !info?.[name])
    const styleNode = pickComfyStyleAdapterNode(info)
    if (!styleNode) missing.push('IPAdapterStyleComposition or IPAdapterPreciseStyleTransfer or IPAdapter')
    if (missing.length) throw new Error(`NovaFlow AI Runtime missing required sprite-sheet style nodes: ${missing.join(', ')}. AIFX will not fall back to local material transfer.`)
    if (missing.length) {
      throw new Error(`NovaFlow AI Runtime 缺少风格迁移节点：${missing.join(', ')}`)
    }
    return info
  }

  const comboOptions = (nodeInfo, inputName) => {
    const input = nodeInfo?.input?.required?.[inputName] || nodeInfo?.input?.optional?.[inputName]
    const first = Array.isArray(input) ? input[0] : null
    return Array.isArray(first) ? first : []
  }

  const pickCombo = (nodeInfo, inputName, preferred) => {
    const options = comboOptions(nodeInfo, inputName)
    for (const item of preferred) {
      const found = options.find((option) => String(option).toLowerCase() === String(item).toLowerCase())
      if (found) return found
    }
    for (const item of preferred) {
      const found = options.find((option) => String(option).toLowerCase().includes(String(item).toLowerCase()))
      if (found) return found
    }
    return options[0]
  }

  const pickComfyStyleAdapterNode = (info) => {
    if (info?.IPAdapterStyleComposition) return 'IPAdapterStyleComposition'
    if (info?.IPAdapterPreciseStyleTransfer) return 'IPAdapterPreciseStyleTransfer'
    if (info?.IPAdapter) return 'IPAdapter'
    return ''
  }

  const pickSpritesheetComfyConfig = (info) => {
    const styleAdapterNode = pickComfyStyleAdapterNode(info)
    const useSdxlStyleComposition = styleAdapterNode === 'IPAdapterStyleComposition'
    const ckptName = pickCombo(info?.CheckpointLoaderSimple, 'ckpt_name', useSdxlStyleComposition
      ? ['realcartoonXL_v7.safetensors', '3moonNIReal_3moonNIRealV1.safetensors', '动漫SD_v1.5.safetensors']
      : ['动漫SD_v1.5.safetensors', 'realcartoonXL_v7.safetensors', '3moonNIReal_3moonNIRealV1.safetensors'])
    const ipadapterFile = pickCombo(info?.IPAdapterModelLoader, 'ipadapter_file', useSdxlStyleComposition
      ? ['ip-adapter_sdxl_vit-h.safetensors', 'ip-adapter_sd15.safetensors', 'clip-vit-h-14-laion2B-s32B-b79K.safetensors']
      : ['ip-adapter_sd15.safetensors', 'ip-adapter_sdxl_vit-h.safetensors', 'clip-vit-h-14-laion2B-s32B-b79K.safetensors'])
    const samplerName = pickCombo(info?.KSampler, 'sampler_name', ['dpmpp_2m', 'euler', 'ddim'])
    const scheduler = pickCombo(info?.KSampler, 'scheduler', ['karras', 'normal', 'simple'])
    const clipVisionName = pickCombo(info?.CLIPVisionLoader, 'clip_name', [
      'clip_vision_h.safetensors',
      'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors',
      'sigclip_vision_patch14_384.safetensors',
    ])
    if (!ckptName) throw new Error('NovaFlow AI Runtime has no checkpoint available for sprite-sheet style transfer.')
    if (!ipadapterFile) throw new Error('NovaFlow AI Runtime has no IPAdapter model file available for sprite-sheet style transfer.')
    if (!clipVisionName) throw new Error('NovaFlow AI Runtime has no CLIPVision model available for sprite-sheet style transfer.')
    if (!samplerName || !scheduler) throw new Error('NovaFlow AI Runtime KSampler options are unavailable.')
    return { ckptName, ipadapterFile, clipVisionName, samplerName, scheduler, styleAdapterNode }
  }

  const mapStyleTransferParams = () => {
    const material = clamp(state.materialStrength / 100, 0, 1)
    const detail = clamp(state.contourVariation / 100, 0, 1)
    return {
      colorStrength: clamp(0.85 + material * 1.15, 0.9, 2.2),
      detailBlend: clamp(0.22 + material * 0.36 + detail * 0.5, 0.28, 1.05),
      blurSigma: clamp(2.8 - detail * 1.9, 0.7, 2.8),
      bloomRadius: clamp(2.2 + material * 2.8 + detail * 1.4, 2.4, 6.4),
      bloomIntensity: clamp(0.08 + material * 0.18, 0.1, 0.32),
    }
  }

  const buildComfyStyleTransferWorkflow = (templateImage, styleImage, outputPrefix) => {
    const params = mapStyleTransferParams()
    const workflow = {
      '1': { class_type: 'LoadImage', inputs: { image: templateImage } },
      '2': { class_type: 'LoadImage', inputs: { image: styleImage } },
      '3': {
        class_type: 'ColorMatchV2',
        inputs: {
          image_target: ['1', 0],
          image_ref: ['2', 0],
          method: 'hm-mvgd-hm',
          strength: params.colorStrength,
          multithread: true,
        },
      },
      '4': {
        class_type: 'easy imageDetailTransfer',
        inputs: {
          target: ['3', 0],
          source: ['2', 0],
          mode: 'overlay',
          blur_sigma: params.blurSigma,
          blend_factor: params.detailBlend,
          image_output: 'Hide',
          save_prefix: `${outputPrefix}_detail`,
        },
      },
      '5': {
        class_type: 'Image Bloom Filter',
        inputs: {
          image: ['4', 0],
          radius: params.bloomRadius,
          intensity: params.bloomIntensity,
        },
      },
      '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: outputPrefix } },
    }
    return workflow
  }

  const alignTo = (value, step = 8) => Math.max(step, Math.ceil(Math.max(1, value) / step) * step)

  const buildAifxSpriteSheet = (frames) => {
    if (!frames?.length) throw new Error('No template frames for sprite-sheet style transfer.')
    const frameWidth = Math.max(1, frames[0].width)
    const frameHeight = Math.max(1, frames[0].height)
    const frameCount = frames.length
    const columns = Math.max(1, Math.ceil(Math.sqrt(frameCount)))
    const rows = Math.max(1, Math.ceil(frameCount / columns))
    const cellWidth = alignTo(frameWidth, 8)
    const cellHeight = alignTo(frameHeight, 8)
    const spriteSheetWidth = alignTo(columns * cellWidth, 8)
    const spriteSheetHeight = alignTo(rows * cellHeight, 8)
    const canvas = createCanvas(spriteSheetWidth, spriteSheetHeight)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, spriteSheetWidth, spriteSheetHeight)
    const frameRects = []
    frames.forEach((frame, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      const rect = {
        index,
        x: col * cellWidth,
        y: row * cellHeight,
        width: frameWidth,
        height: frameHeight,
        cellWidth,
        cellHeight,
      }
      frameRects.push(rect)
      ctx.drawImage(frame.canvas, rect.x, rect.y, rect.width, rect.height)
    })
    return {
      canvas,
      dataUrl: canvas.toDataURL('image/png'),
      frameRects,
      frameCount,
      frameWidth,
      frameHeight,
      columns,
      rows,
      cellWidth,
      cellHeight,
      spriteSheetWidth,
      spriteSheetHeight,
    }
  }

  const buildSpritesheetPrompt = () => ({
    positive: [
      'game VFX sprite sheet style transfer',
      'preserve the original sprite sheet grid, frame layout, timing, motion, composition, silhouette, and VFX category',
      'apply the uploaded reference image visual style only: color palette, glow behavior, material texture, edge quality, highlights, contrast, particles, and energy feeling',
      'consistent style across all frames, coherent animation sequence, no frame-to-frame random changes',
      'do not create a new scene, do not add characters, do not add objects, do not alter the frame grid',
      'high quality game effect sprites, crisp energy, natural glow, detailed material, clean edges',
    ].join(', '),
    negative: [
      'person, human, face, hand, body, character, anime character, girl, boy',
      'weapon object, scene, landscape, room, floor, wall, environment, photo, camera view',
      'text, logo, border, frame border, random composition, new layout, cropped sprite sheet',
      'flat color blob, white blob, gray blob, hard mask fill, alpha mask fill, sticker, cutout',
    ].join(', '),
  })

  const summarizeComfyWorkflow = (workflow) => {
    const summary = {}
    for (const [id, node] of Object.entries(workflow || {})) {
      const inputs = node.inputs || {}
      summary[id] = {
        class_type: node.class_type,
        refs: Object.fromEntries(
          Object.entries(inputs).filter(([, value]) => Array.isArray(value) && typeof value[0] === 'string'),
        ),
      }
      const scalarKeys = ['image', 'ckpt_name', 'ipadapter_file', 'clip_name', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'weight', 'weight_style', 'weight_composition', 'style_boost', 'weight_type', 'start_at', 'end_at']
      for (const key of scalarKeys) {
        if (Object.prototype.hasOwnProperty.call(inputs, key) && !Array.isArray(inputs[key])) summary[id][key] = inputs[key]
      }
      if (typeof inputs.text === 'string') summary[id].textPreview = inputs.text.slice(0, 180)
    }
    return summary
  }

  const styleReferenceConnectedToIpAdapter = (workflow, styleImageName) => {
    const loadStyle = workflow?.['2']?.class_type === 'LoadImage' && workflow?.['2']?.inputs?.image === styleImageName
    const adapter = workflow?.['5']
    const inputs = adapter?.inputs || {}
    const directStyle =
      (Array.isArray(inputs.image_style) && inputs.image_style[0] === '2') ||
      (Array.isArray(inputs.image) && inputs.image[0] === '2')
    return Boolean(loadStyle && directStyle)
  }

  const buildAifxSpritesheetComfyWorkflow = (sheetImage, styleImage, outputPrefix, info) => {
    const config = pickSpritesheetComfyConfig(info)
    const material = clamp(state.materialStrength / 100, 0, 1)
    const styleWeight = clamp(0.9 + material * 0.3, 0.9, 1.2)
    const denoise = clamp(0.24 + material * 0.1, 0.24, 0.34)
    const { positive, negative } = buildSpritesheetPrompt()
    const workflow = {
      '1': { class_type: 'LoadImage', inputs: { image: sheetImage } },
      '2': { class_type: 'LoadImage', inputs: { image: styleImage } },
      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: config.ckptName } },
      '4': { class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: config.ipadapterFile } },
      '12': { class_type: 'CLIPVisionLoader', inputs: { clip_name: config.clipVisionName } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['3', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['3', 1] } },
      '8': { class_type: 'VAEEncode', inputs: { pixels: ['1', 0], vae: ['3', 2] } },
      '9': {
        class_type: 'KSampler',
        inputs: {
          model: ['5', 0],
          seed: SPRITESHEET_COMFY_SEED,
          steps: 18,
          cfg: 6,
          sampler_name: config.samplerName,
          scheduler: config.scheduler,
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['8', 0],
          denoise,
        },
      },
      '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 2] } },
      '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: outputPrefix } },
    }
    if (config.styleAdapterNode === 'IPAdapterStyleComposition') {
      workflow['5'] = {
        class_type: 'IPAdapterStyleComposition',
        inputs: {
          model: ['3', 0],
          ipadapter: ['4', 0],
          image_style: ['2', 0],
          image_composition: ['1', 0],
          weight_style: styleWeight,
          weight_composition: 0.35,
          expand_style: false,
          combine_embeds: 'average',
          start_at: 0,
          end_at: 0.92,
          embeds_scaling: 'V only',
          clip_vision: ['12', 0],
        },
      }
    } else if (config.styleAdapterNode === 'IPAdapterPreciseStyleTransfer') {
      workflow['5'] = {
        class_type: 'IPAdapterPreciseStyleTransfer',
        inputs: {
          model: ['3', 0],
          ipadapter: ['4', 0],
          image: ['2', 0],
          weight: styleWeight,
          style_boost: clamp(1 + material * 0.55, 1, 1.55),
          combine_embeds: 'average',
          start_at: 0,
          end_at: 0.92,
          embeds_scaling: 'V only',
          clip_vision: ['12', 0],
        },
      }
    } else {
      workflow['5'] = {
        class_type: 'IPAdapter',
        inputs: {
          model: ['3', 0],
          ipadapter: ['4', 0],
          image: ['2', 0],
          weight: styleWeight,
          start_at: 0,
          end_at: 0.92,
          weight_type: 'style transfer',
        },
      }
    }
    const debug = {
      pipeline: PIPELINE_ID,
      checkpoint: config.ckptName,
      ipadapterModel: config.ipadapterFile,
      clipVision: config.clipVisionName,
      styleAdapterNode: config.styleAdapterNode,
      ipAdapterWeight: styleWeight,
      denoise,
      seed: SPRITESHEET_COMFY_SEED,
      styleReferenceUploadName: styleImage,
      templateSheetUploadName: sheetImage,
      styleReferenceConnectedToIPAdapter: styleReferenceConnectedToIpAdapter(workflow, styleImage),
      workflowSummary: summarizeComfyWorkflow(workflow),
    }
    return { workflow, debug }
  }

  const cutSpritesheetToFrames = async (sheetDataUrl, sheetPlan) => {
    const image = await imageFromUrl(sheetDataUrl)
    const sourceCanvas = createCanvas(sheetPlan.spriteSheetWidth, sheetPlan.spriteSheetHeight)
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
    sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height)
    sourceCtx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height)
    return sheetPlan.frameRects.map((rect, index) => {
      const canvas = createCanvas(rect.width, rect.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
      return {
        index,
        fileName: `aifx_spritesheet_style_${pad(index)}.png`,
        canvas,
        width: rect.width,
        height: rect.height,
        dataUrl: canvas.toDataURL('image/png'),
        pipeline: PIPELINE_ID,
      }
    })
  }

  const dataUrlToCanvas = async (dataUrl, width, height) => {
    const image = await imageFromUrl(dataUrl)
    const canvas = createCanvas(width || image.naturalWidth || image.width || 1, height || image.naturalHeight || image.height || 1)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  const evaluateSpritesheetStyleResult = (inputCanvas, outputCanvas) => {
    const width = Math.min(inputCanvas.width, outputCanvas.width)
    const height = Math.min(inputCanvas.height, outputCanvas.height)
    const inputCtx = inputCanvas.getContext('2d', { willReadFrequently: true })
    const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true })
    const input = inputCtx.getImageData(0, 0, width, height).data
    const output = outputCtx.getImageData(0, 0, width, height).data
    const step = Math.max(1, Math.floor(Math.max(width, height) / 192))
    let samples = 0
    let diff = 0
    let inputBright = 0
    let outputBright = 0
    let outputFlat = 0
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4
        const ia = input[offset + 3] / 255
        if (ia < 0.05 && luminance(input[offset], input[offset + 1], input[offset + 2]) < 0.03) continue
        const ir = input[offset]
        const ig = input[offset + 1]
        const ib = input[offset + 2]
        const or = output[offset]
        const og = output[offset + 1]
        const ob = output[offset + 2]
        const il = luminance(ir, ig, ib)
        const ol = luminance(or, og, ob)
        diff += (Math.abs(or - ir) + Math.abs(og - ig) + Math.abs(ob - ib)) / (255 * 3)
        inputBright += il
        outputBright += ol
        if (Math.max(or, og, ob) - Math.min(or, og, ob) < 8) outputFlat += 1
        samples += 1
      }
    }
    const averageDiff = diff / Math.max(1, samples)
    const brightnessRatio = outputBright / Math.max(0.001, inputBright)
    const flatRatio = outputFlat / Math.max(1, samples)
    return { samples, averageDiff, brightnessRatio, flatRatio }
  }

  const measureCanvasColor = (canvas) => {
    if (!canvas) return { r: 0, g: 0, b: 0, brightness: 0, samples: 0, dominant: 'none' }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = image.data
    const step = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) / 192))
    let r = 0
    let g = 0
    let b = 0
    let total = 0
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const offset = (y * canvas.width + x) * 4
        const alpha = data[offset + 3] / 255
        const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
        if (alpha < 0.05 && lum < 0.035) continue
        const weight = Math.max(alpha, lum)
        r += data[offset] * weight
        g += data[offset + 1] * weight
        b += data[offset + 2] * weight
        total += weight
      }
    }
    const color = {
      r: Math.round(r / Math.max(1e-6, total)),
      g: Math.round(g / Math.max(1e-6, total)),
      b: Math.round(b / Math.max(1e-6, total)),
      samples: Math.round(total),
    }
    color.brightness = Number(luminance(color.r, color.g, color.b).toFixed(4))
    color.dominant = color.r >= color.g && color.r >= color.b ? 'red' : color.g >= color.r && color.g >= color.b ? 'green' : 'blue'
    return color
  }

  const rgbToHsv = (r, g, b) => {
    const rr = r / 255
    const gg = g / 255
    const bb = b / 255
    const max = Math.max(rr, gg, bb)
    const min = Math.min(rr, gg, bb)
    const delta = max - min
    let h = 0
    if (delta > 0.00001) {
      if (max === rr) h = ((gg - bb) / delta) % 6
      else if (max === gg) h = (bb - rr) / delta + 2
      else h = (rr - gg) / delta + 4
      h *= 60
      if (h < 0) h += 360
    }
    const s = max <= 0 ? 0 : delta / max
    return { h, s, v: max }
  }

  const inferAifxEffectType = (stats) => {
    const { h, s, v, r, g, b, edge, brightRatio } = stats
    if (v < 0.22 && s < 0.52) return { type: 'dark', confidence: 0.72 }
    if (r > g * 1.15 && r > b * 1.18 && (h <= 35 || h >= 330)) return { type: 'fire', confidence: 0.82 }
    if (g > r * 1.14 && g > b * 1.06) return { type: 'poison', confidence: 0.76 }
    if (b > r * 1.14 && b >= g * 0.85 && v > 0.42) {
      if (edge > 0.18 || brightRatio > 0.12) return { type: 'lightning', confidence: 0.78 }
      return { type: h > 170 && h < 220 ? 'water' : 'ice', confidence: 0.68 }
    }
    if (r > 185 && g > 150 && b < 135 && v > 0.52) return { type: 'holy', confidence: 0.7 }
    if (Math.abs(r - g) < 22 && Math.abs(g - b) < 22 && v > 0.48 && edge > 0.14) return { type: 'metal', confidence: 0.65 }
    if (h > 245 && h < 305 && v < 0.42) return { type: 'dark', confidence: 0.62 }
    if (edge > 0.22 && v > 0.5) return { type: 'crystal', confidence: 0.6 }
    return { type: 'energy', confidence: 0.55 }
  }

  const createAifxPromptVariants = (baseParts, negativePrompt, inferredType, topologyDescription, colorDescription) => {
    const typeTopology = {
      fire: 'flame tongue topology, flowing S-curves, layered heat waves, broken ember trails, expanding and dissolving flame edges',
      lightning: 'branching lightning topology, jagged forks, sharp angular turns, high frequency electric patterns, forked edge breakup',
      ice: 'crystalline shard topology, faceted edges, sharp frozen streaks, cracked internal lines, transparent icy layers',
      water: 'fluid wave topology, curling flow, spiral eddies, transparent layered arcs, splashing droplets',
      poison: 'viscous tendril topology, sticky droplets, bubbling edges, uneven toxic trails, organic splatter breakup',
      dark: 'shadow wisp topology, smoky tendrils, torn edges, void-like gaps, dissolving dark trails',
      holy: 'radial light topology, ring arcs, clean luminous rays, central halo burst, layered sacred glow',
      metal: 'blade-like reflective topology, hard bevel highlights, sharp specular streaks, segmented metallic facets',
      crystal: 'crystal shard topology, angular fracture lines, prismatic edges, faceted internal structure',
      smoke: 'soft smoke topology, rolling wisps, translucent curls, dissipating layered plumes',
      magic: 'arcane circle topology, spiral runic flow, curved magical trails, clustered spark nodes',
      energy: 'structured energy topology, curved trails, central core burst, layered motion ribbons, readable internal flow',
    }
    const primaryTopology = topologyDescription || typeTopology[inferredType] || typeTopology.energy
    const commonControl = [
      'visible mid-tone detail',
      'controlled highlights',
      'avoid overexposed pure white blobs',
      'keep internal structure readable',
      'not a flat color fill',
    ].join(', ')
    const variantDefs = [
      {
        name: 'structured-topology',
        prompt: `${primaryTopology}, shape pattern and topology clearly follows the reference style`,
      },
      {
        name: 'curved-arc-flow',
        prompt: 'multiple curved energy trails, layered arcs, rotating flow pattern, spiral vortex energy when present in the reference, not a single plain slash',
      },
      {
        name: 'core-burst',
        prompt: 'central core burst, radial energy rays, expanding highlight rings, controlled bright center with detailed mid-tones',
      },
      {
        name: 'particle-heavy',
        prompt: 'fragmented sparks, fine particles, broken edge debris, small energy nodes, detailed trailing particles',
      },
    ]
    return variantDefs.map((variant) => {
      const positivePrompt = [
        ...baseParts,
        variant.prompt,
        commonControl,
        `style colors remain ${colorDescription}`,
      ].join(', ')
      return {
        name: variant.name,
        inferredEffectType: inferredType,
        positivePrompt,
        negativePrompt,
      }
    })
  }

  const buildAifxAutoPrompt = (styleReference) => {
    const width = Math.max(1, styleReference?.textureWidth || 1)
    const height = Math.max(1, styleReference?.textureHeight || 1)
    const data = styleReference?.textureData
    if (!data?.length) {
      const negativePrompt = [
        'person, human, face, body, hand, character, object, weapon',
        'scene, room, landscape, text, logo, realistic background, camera footage',
        'overexposed white blob, pure white fill, flat color fill, blurry blob',
      ].join(', ')
      const baseParts = [
        'A energy game VFX effect following the motion of the input video',
        'with bright high contrast glow, dynamic particles, sharp highlights',
        'preserve the input animation lifecycle, expansion, sparks, trailing particles, and dissipation',
        'black background, VFX only, no character, no human, no object, no scene',
      ]
      return {
        inferredEffectType: 'energy',
        confidence: 0.4,
        styleTags: ['default energy'],
        positivePrompt: baseParts.join(', '),
        negativePrompt,
        promptVariants: createAifxPromptVariants(baseParts, negativePrompt, 'energy', '', 'stylized high contrast energy colors'),
      }
    }

    const step = Math.max(1, Math.floor(Math.max(width, height) / 96))
    let r = 0
    let g = 0
    let b = 0
    let lum = 0
    let sat = 0
    let edge = 0
    let bright = 0
    let samples = 0
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4
        const alpha = data[offset + 3] / 255
        if (alpha < 0.05) continue
        const cr = data[offset]
        const cg = data[offset + 1]
        const cb = data[offset + 2]
        const cl = luminance(cr, cg, cb)
        const cs = saturation(cr, cg, cb)
        const weight = 0.2 + alpha * (0.4 + cl * 0.8 + cs * 0.35)
        r += cr * weight
        g += cg * weight
        b += cb * weight
        lum += cl * weight
        sat += cs * weight
        if (cl > 0.72) bright += weight
        const x2 = Math.min(width - 1, x + step)
        const y2 = Math.min(height - 1, y + step)
        const right = (y * width + x2) * 4
        const down = (y2 * width + x) * 4
        edge += (Math.abs(cr - data[right]) + Math.abs(cg - data[right + 1]) + Math.abs(cb - data[right + 2]) + Math.abs(cr - data[down]) + Math.abs(cg - data[down + 1]) + Math.abs(cb - data[down + 2])) / (255 * 6)
        samples += weight
      }
    }
    const inv = 1 / Math.max(0.0001, samples)
    const avg = { r: r * inv, g: g * inv, b: b * inv }
    const hsv = rgbToHsv(avg.r, avg.g, avg.b)
    const stats = {
      ...avg,
      h: hsv.h,
      s: sat * inv,
      v: Math.max(avg.r, avg.g, avg.b) / 255,
      lum: lum * inv,
      edge: edge / Math.max(1, samples / (0.2 + hsv.v)),
      brightRatio: bright * inv,
    }
    const inferred = inferAifxEffectType(stats)
    const colorDescription = stats.r > stats.g * 1.12 && stats.r > stats.b * 1.12
      ? 'red orange warm highlights and fiery glow'
      : stats.g > stats.r * 1.1 && stats.g > stats.b * 1.02
        ? 'green toxic luminous tones and acidic glow'
        : stats.b > stats.r * 1.08
          ? 'blue white cool highlights and electric glow'
          : stats.v > 0.62
            ? 'bright white gold highlights'
            : 'stylized high contrast energy colors'
    const materialDescription = {
      fire: 'flame-like flowing material',
      lightning: 'electric plasma material',
      ice: 'icy crystalline material',
      water: 'transparent flowing liquid material',
      poison: 'poisonous viscous energy material',
      dark: 'shadow smoky material',
      holy: 'holy radiant light material',
      metal: 'hard reflective metallic material',
      crystal: 'sharp crystalline material',
      energy: 'glowing energy material',
      smoke: 'soft smoky material',
      magic: 'arcane magic material',
    }[inferred.type] || 'glowing energy material'
    const textureDescription = stats.edge > 0.2
      ? 'sharp detailed texture, crisp edges, visible high frequency details'
      : stats.brightRatio > 0.14
        ? 'bright highlight streaks, strong glow blooms, luminous particles'
        : 'smooth layered texture, controlled glow, readable internal detail'
    const topologyDescription = {
      fire: 'flame tongue topology, flowing S-curves, layered heat waves, broken ember trails, expanding and dissolving flame edges',
      lightning: 'branching lightning topology, jagged forks, sharp angular turns, high frequency electric patterns, forked edge breakup',
      ice: 'crystalline shard topology, faceted edges, sharp frozen streaks, cracked internal lines, transparent icy layers',
      water: 'fluid wave topology, curling flow, spiral eddies, transparent layered arcs, splashing droplets',
      poison: 'viscous tendril topology, sticky droplets, bubbling edges, uneven toxic trails, organic splatter breakup',
      dark: 'shadow wisp topology, smoky tendrils, torn edges, void-like gaps, dissolving dark trails',
      holy: 'radial light topology, ring arcs, clean luminous rays, central halo burst, layered sacred glow',
      metal: 'blade-like reflective topology, hard bevel highlights, sharp specular streaks, segmented metallic facets',
      crystal: 'crystal shard topology, angular fracture lines, prismatic edges, faceted internal structure',
      smoke: 'soft smoke topology, rolling wisps, translucent curls, dissipating layered plumes',
      magic: 'arcane circle topology, spiral runic flow, curved magical trails, clustered spark nodes',
      energy: stats.edge > 0.18
        ? 'structured energy topology, layered sharp trails, visible internal flow, broken edge detail'
        : 'spiral vortex energy topology, rotating arcs, circular motion, central core burst, multiple curved energy trails, layered swirling structure',
    }[inferred.type] || 'structured energy topology, curved trails, central core burst, layered motion ribbons'
    const styleTags = [
      inferred.type,
      colorDescription,
      materialDescription,
      textureDescription,
      topologyDescription,
      `dominant rgb ${Math.round(avg.r)} ${Math.round(avg.g)} ${Math.round(avg.b)}`,
    ]
    const baseParts = [
      `A ${inferred.type} game VFX effect following the motion of the input video`,
      `with ${colorDescription}`,
      materialDescription,
      textureDescription,
      topologyDescription,
      'shape pattern, topology, and motion pattern are explicit and structured',
      'strong glow, dynamic particles, high contrast highlights, controlled highlights, visible mid-tone detail',
      'preserve the input animation lifecycle, shape evolution, expansion, deformation, fragmentation, sparks, trailing particles, and dissipation',
      'black background, VFX only',
      'no character, no human, no object, no scene',
    ]
    const positivePrompt = baseParts.join(', ')
    const negativePrompt = [
      'person, human, face, body, hand, character, object, weapon',
      'scene, room, landscape, floor, wall, text, logo',
      'realistic background, camera footage, unrelated composition',
      'flat color fill, blurry blob, hard cutout, sticker',
      'overexposed white blob, pure white fill, blown out highlights, no mid-tone detail',
    ].join(', ')
    const promptVariants = createAifxPromptVariants(baseParts, negativePrompt, inferred.type, topologyDescription, colorDescription)
    return {
      inferredEffectType: inferred.type,
      confidence: Number(inferred.confidence.toFixed(2)),
      styleTags,
      positivePrompt,
      negativePrompt,
      promptVariants,
      stats: {
        rgb: [Math.round(avg.r), Math.round(avg.g), Math.round(avg.b)],
        hue: Number(hsv.h.toFixed(1)),
        saturation: Number(stats.s.toFixed(3)),
        brightness: Number(stats.v.toFixed(3)),
        edge: Number(stats.edge.toFixed(3)),
        brightRatio: Number(stats.brightRatio.toFixed(3)),
      },
    }
  }

  const sendComfyPrompt = async (workflow) => {
    const payload = {
      client_id: `nf_styletransfer_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      prompt: workflow,
    }
    const response = await runtimeRequestJson('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const nodeErrors = response?.node_errors || {}
    if (Object.keys(nodeErrors).length) throw new Error(`NovaFlow AI Runtime workflow node error: ${JSON.stringify(nodeErrors)}`)
    const promptId = String(response?.prompt_id || '')
    if (!promptId) throw new Error('NovaFlow AI Runtime 未返回 prompt_id')
    return promptId
  }

  const waitForComfyHistory = async (promptId, timeoutMs = 160000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const history = await runtimeRequestJson(`/history/${encodeURIComponent(promptId)}`, { method: 'GET' })
      const item = history?.[promptId] || history
      if (item?.outputs) {
        if (item?.status?.status_str === 'error') throw new Error(`NovaFlow AI Runtime execution failed: ${JSON.stringify(item.status)}`)
        return item
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    throw new Error('NovaFlow AI Runtime 风格迁移超时')
  }

  const findComfyOutputImage = (historyItem) => {
    const outputs = historyItem?.outputs || {}
    const nodes = Object.keys(outputs).sort((a, b) => Number(b) - Number(a))
    for (const nodeId of nodes) {
      const images = outputs[nodeId]?.images
      if (Array.isArray(images) && images.length) return images[images.length - 1]
    }
    return null
  }

  const downloadComfyImageDataUrl = async (image) => {
    if (!image?.filename) throw new Error('NovaFlow AI Runtime 没有输出图片')
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder || '',
      type: image.type || 'output',
    })
    const blob = await runtimeRequestBinary(`/view?${params.toString()}`)
    return blobToDataUrl(blob)
  }

  const applyTemplateAlphaForPreview = (canvas, templateCanvas) => {
    if (!templateCanvas || templateCanvas.width !== canvas.width || templateCanvas.height !== canvas.height) return
    const width = canvas.width
    const height = canvas.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const out = ctx.getImageData(0, 0, width, height)
    const templateCtx = templateCanvas.getContext('2d', { willReadFrequently: true })
    const source = templateCtx.getImageData(0, 0, width, height)
    const alpha = new Float32Array(width * height)
    let transparent = 0
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4
      const sourceAlpha = source.data[offset + 3] / 255
      const sourceLum = luminance(source.data[offset], source.data[offset + 1], source.data[offset + 2])
      const presence = sourceAlpha < 0.98 ? sourceAlpha : clamp((sourceLum - 0.02) / 0.98, 0, 1)
      if (sourceAlpha < 0.98) transparent += 1
      alpha[index] = presence
    }
    if (transparent < alpha.length * 0.01) return
    const soft = blurFloatField(alpha, width, height, 1.4)
    const glow = blurFloatField(alpha, width, height, 4.2)
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4
      const originalAlpha = out.data[offset + 3] / 255
      const finalAlpha = clamp(alpha[index] * 0.78 + soft[index] * 0.17 + glow[index] * 0.05, 0, 1)
      const alphaValue = originalAlpha < 0.98 ? Math.min(originalAlpha, finalAlpha) : finalAlpha
      if (alphaValue < 0.01) {
        out.data[offset] = 0
        out.data[offset + 1] = 0
        out.data[offset + 2] = 0
        out.data[offset + 3] = 0
      } else {
        out.data[offset + 3] = Math.round(alphaValue * 255)
      }
    }
    ctx.putImageData(out, 0, 0)
  }

  const sampleImageData = (imageData, x, y) => {
    const width = imageData.width
    const height = imageData.height
    const data = imageData.data
    const px = clamp(x, 0, width - 1)
    const py = clamp(y, 0, height - 1)
    const x0 = Math.floor(px)
    const y0 = Math.floor(py)
    const x1 = Math.min(width - 1, x0 + 1)
    const y1 = Math.min(height - 1, y0 + 1)
    const tx = px - x0
    const ty = py - y0
    const read = (xx, yy) => {
      const offset = (yy * width + xx) * 4
      return {
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
        a: data[offset + 3] / 255,
      }
    }
    const a = read(x0, y0)
    const b = read(x1, y0)
    const c = read(x0, y1)
    const d = read(x1, y1)
    const top = mixColor(a, b, tx)
    const bottom = mixColor(c, d, tx)
    const color = mixColor(top, bottom, ty)
    const alpha = lerp(lerp(a.a, b.a, tx), lerp(c.a, d.a, tx), ty)
    const lum = luminance(color.r, color.g, color.b)
    const sat = saturation(color.r, color.g, color.b)
    return { ...color, a: alpha, lum, sat }
  }

  const buildMaterialLuminanceField = (imageData) => {
    const field = new Float32Array(imageData.width * imageData.height)
    const data = imageData.data
    for (let index = 0; index < field.length; index += 1) {
      const offset = index * 4
      field[index] = luminance(data[offset], data[offset + 1], data[offset + 2])
    }
    return field
  }

  const colorDistance01 = (a, b) => {
    const dr = (a.r - b.r) / 255
    const dg = (a.g - b.g) / 255
    const db = (a.b - b.b) / 255
    return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3)
  }

  const nearestStyleDistance = (style, color) => {
    const palette = style?.palette || defaultPalette
    const candidates = [palette.core, palette.glow, palette.outer, palette.spark, defaultPalette.core, defaultPalette.glow].filter(Boolean)
    let best = 1
    for (const candidate of candidates) best = Math.min(best, colorDistance01(color, candidate))
    return best
  }

  const AIFX_MATERIAL_FUSION_PROFILES = Object.freeze({
    fire: { progressionWeight: 0.13, textureReward: 0.08, aiColorWeight: 0.34, aiToneWeight: 0.62, energyFloor: 0.22, energyScale: 0.58, detailTone: 0.2, aiCoreWeight: 0.48, maxLuminance: 0.96 },
    lightning: { progressionWeight: 0.15, textureReward: 0.18, emissiveTextureReward: 0.28, aiColorWeight: 0.42, aiToneWeight: 0.7, energyFloor: 0.18, energyScale: 0.55, detailTone: 0.3, aiCoreWeight: 0.68, maxLuminance: 0.98 },
    ice: { progressionWeight: 0.1, textureReward: 0.1, aiColorWeight: 0.28, aiToneWeight: 0.46, energyFloor: 0.15, energyScale: 0.48, detailTone: 0.14, aiCoreWeight: 0.35, maxLuminance: 0.88 },
    default: { progressionWeight: 0.1, textureReward: 0.1, aiColorWeight: 0.32, aiToneWeight: 0.54, energyFloor: 0.18, energyScale: 0.52, detailTone: 0.18, aiCoreWeight: 0.42, maxLuminance: 0.92 },
  })

  const getAifxMaterialFusionProfile = (materialType) => AIFX_MATERIAL_FUSION_PROFILES[materialType] || AIFX_MATERIAL_FUSION_PROFILES.default

  const isAifxMaterialCandidateEligible = (metrics = {}, reference = {}, materialType = 'default') => {
    if (!Number.isFinite(metrics.activeSamples) || metrics.activeSamples < 16) return false
    if (materialType !== 'lightning') return true
    const contrastFloor = Math.max(0.24, (Number(reference.lumStd) || 0.18) * 1.02)
    const highlightFloor = Math.max(0.16, (Number(reference.highLumRatio) || 0.2) * 1.25)
    return (Number(metrics.luminanceStd) || 0) >= contrastFloor
      && (Number(metrics.highLumRatio) || 0) >= highlightFloor
  }

  const scoreAifxMaterialCandidate = (metrics = {}, reference = {}, materialType = 'default') => {
    if (!Number.isFinite(metrics.activeSamples) || metrics.activeSamples < 16) return Number.POSITIVE_INFINITY
    const profile = getAifxMaterialFusionProfile(materialType)
    const paletteDistance = clamp(Number(metrics.paletteDistance) || 1, 0, 1)
    const luminanceDrift = Math.abs((Number(metrics.meanLuminance) || 0) - (Number(reference.lumMean) || 0.5))
    const saturationDrift = Math.abs((Number(metrics.meanSaturation) || 0) - (Number(reference.satMean) || 0.5))
    const edgeDrift = Math.abs((Number(metrics.edgeMean) || 0) - (Number(reference.edgeMean) || 0.42))
    const contrastDrift = Math.abs((Number(metrics.luminanceStd) || 0) - (Number(reference.lumStd) || 0.18))
    const highLuminanceDrift = Math.abs((Number(metrics.highLumRatio) || 0) - (Number(reference.highLumRatio) || 0.2))
    const coverage = clamp(Number(metrics.coverage) || 0, 0, 1)
    const coverageDrift = Math.abs(coverage - clamp(Number(reference.coverage) || coverage, 0, 1))
    const sourceProgress = clamp(Number(metrics.sourceProgress) || 0, 0, 1)
    const textureEnergy = clamp(Number(metrics.edgeMean) || 0, 0, 0.5)
    const emissiveTexture = clamp((Number(metrics.luminanceStd) || 0) * 0.45
      + (Number(metrics.highLumRatio) || 0) * 0.35
      + (Number(metrics.edgeP90) || 0) * 0.2, 0, 1)
    const coveragePenalty = coverage < 0.002 ? 1 : coverage < 0.01 ? 0.25 : 0
    return paletteDistance * 0.38
      + luminanceDrift * 0.05
      + saturationDrift * 0.05
      + edgeDrift * 0.14
      + contrastDrift * 0.1
      + highLuminanceDrift * 0.08
      + coverageDrift * 0.06
      + coveragePenalty * 0.02
      - sourceProgress * profile.progressionWeight
      - textureEnergy * profile.textureReward
      - emissiveTexture * (profile.emissiveTextureReward || 0)
  }

  const fuseAifxReferencePaletteTexture = (options = {}) => {
    const palette = options.palette || defaultPalette
    const strength = clamp(Number(options.styleStrength) || 0, 0, 1)
    const energy = clamp(Number(options.energy) || 0, 0, 1)
    const hot = clamp(Number(options.hot) || 0, 0, 1)
    const aiLuminance = clamp(Number(options.aiLuminance) || 0, 0, 1)
    const aiDetail = clamp(Number(options.aiDetail) || 0, -1, 1)
    const profile = getAifxMaterialFusionProfile(options.materialType)
    const isLightning = options.materialType === 'lightning'
    const dominant = palette.dominant || palette.outer || defaultPalette.dominant
    const shadow = darken(dominant, 0.38)
    const glow = palette.glow || defaultPalette.glow
    const core = palette.core || defaultPalette.core

    let color = mixColor(shadow, dominant, smoothstep(0.05, 0.62, energy))
    const accentWeight = smoothstep(0.5, 0.94, energy) * (0.1 + smoothstep(0.55, 0.92, hot) * 0.2)
      + smoothstep(0.62, 0.94, aiLuminance) * 0.08
    color = mixColor(color, glow, clamp(accentWeight, 0, 0.34))

    const referenceColor = options.referenceColor
    if (referenceColor && [referenceColor.r, referenceColor.g, referenceColor.b].every(Number.isFinite)) {
      const referenceWeight = isLightning
        ? saturation(referenceColor.r, referenceColor.g, referenceColor.b) > 0.08 ? 0.02 + strength * 0.025 : 0.015
        : saturation(referenceColor.r, referenceColor.g, referenceColor.b) > 0.08 ? 0.05 + strength * 0.08 : 0.025
      color = mixColor(color, referenceColor, referenceWeight)
    }

    const aiColor = options.aiColor
    let chromaticHueTrust = 0
    let neutralWhiteTrust = 0
    let materialTrust = 0
    if (aiColor && [aiColor.r, aiColor.g, aiColor.b].every(Number.isFinite)) {
      const paletteCandidates = [dominant, palette.outer, glow, core].filter(Boolean)
      let paletteDistance = 1
      for (const candidate of paletteCandidates) paletteDistance = Math.min(paletteDistance, colorDistance01(aiColor, candidate))
      chromaticHueTrust = 1 - smoothstep(0.1, 0.34, paletteDistance)
      const aiSaturation = saturation(aiColor.r, aiColor.g, aiColor.b)
      neutralWhiteTrust = smoothstep(0.72, 0.92, aiLuminance) * (1 - smoothstep(0.12, 0.36, aiSaturation))
      materialTrust = isLightning ? Math.max(chromaticHueTrust, neutralWhiteTrust) : chromaticHueTrust
      const aiColorWeight = profile.aiColorWeight * (0.72 + strength * 0.28) * materialTrust
      color = mixColor(color, aiColor, clamp(aiColorWeight, 0, 0.46))
    }

    color = boostSaturation(color, 0.03 + strength * 0.05)
    const templateCore = smoothstep(0.82, 0.995, hot) * smoothstep(0.76, 0.99, energy) * 0.48
    const aiCore = materialTrust * smoothstep(0.68, 0.96, aiLuminance + Math.max(0, aiDetail) * 0.18)
    const coreWeight = clamp(Math.max(templateCore, aiCore * profile.aiCoreWeight), 0, 0.68)
    color = mixColor(color, core, coreWeight)

    const energyTarget = profile.energyFloor + energy * profile.energyScale
    const aiTone = clamp(aiLuminance + aiDetail * profile.detailTone, 0.04, 1)
    const toneWeight = aiColor ? profile.aiToneWeight * (0.55 + materialTrust * 0.45) : 0.18
    const targetLuminance = clamp(lerp(energyTarget, aiTone, toneWeight) + hot * 0.04 + aiCore * 0.06, 0.08, profile.maxLuminance)
    const colorLuminance = Math.max(0.025, luminance(color.r, color.g, color.b))
    const shade = clamp(targetLuminance / colorLuminance, 0.6, 3.2)
    const maxChannel = Math.max(1, color.r, color.g, color.b)
    const gain = Math.min(shade, 252 / maxChannel)
    let outputColor = {
      r: clamp(color.r * gain, 0, 252),
      g: clamp(color.g * gain, 0, 252),
      b: clamp(color.b * gain, 0, 252),
    }
    if (isLightning) {
      const positiveDetail = smoothstep(0.08, 0.42, Math.max(0, aiDetail))
      const branchWeight = clamp(materialTrust * positiveDetail * 0.52 + neutralWhiteTrust * 0.3, 0, 0.72)
      outputColor = mixColor(outputColor, brighten(core, 0.72), branchWeight)
    }
    return {
      r: clamp(outputColor.r, 0, 252),
      g: clamp(outputColor.g, 0, 252),
      b: clamp(outputColor.b, 0, 252),
    }
  }

  AifxPureHelpers.scoreAifxMaterialCandidate = scoreAifxMaterialCandidate
  AifxPureHelpers.isMaterialCandidateEligible = isAifxMaterialCandidateEligible
  AifxPureHelpers.fuseReferencePaletteTexture = fuseAifxReferencePaletteTexture

  const measureAifxMaterialCandidate = (canvas, style, sourceIndex, sourceCount, materialType) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    const palette = style?.palette || defaultPalette
    const chromaticPalette = [palette.dominant, palette.outer, palette.glow].filter(Boolean)
    const neutralPalette = [palette.core, palette.glow, palette.dominant].filter(Boolean)
    const step = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) / 128))
    let activeSamples = 0
    let paletteDistance = 0
    let paletteWeight = 0
    let sumLuminance = 0
    let sumLuminanceSquared = 0
    let sumSaturation = 0
    let edgeSum = 0
    const edgeSamples = []
    let highLuminanceSamples = 0
    let clipped = 0
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const offset = (y * canvas.width + x) * 4
        const alpha = data[offset + 3] / 255
        const r = data[offset]
        const g = data[offset + 1]
        const b = data[offset + 2]
        const lum = luminance(r, g, b)
        if (alpha < 0.05 || lum < 0.035) continue
        const sat = saturation(r, g, b)
        const candidates = sat > 0.18 ? chromaticPalette : neutralPalette
        let nearest = 1
        for (const candidate of candidates) nearest = Math.min(nearest, colorDistance01({ r, g, b }, candidate))
        const weight = 0.35 + sat * 0.65
        paletteDistance += nearest * weight
        paletteWeight += weight
        activeSamples += 1
        sumLuminance += lum
        sumLuminanceSquared += lum * lum
        sumSaturation += sat
        if (lum > 0.72) highLuminanceSamples += 1
        if (Math.max(r, g, b) >= 250 && [r, g, b].filter((value) => value >= 245).length >= 2) clipped += 1
        let localEdge = 0
        if (x + 1 < canvas.width) {
          const next = offset + 4
          localEdge += Math.abs(lum - luminance(data[next], data[next + 1], data[next + 2]))
        }
        if (y + 1 < canvas.height) {
          const next = ((y + 1) * canvas.width + x) * 4
          localEdge += Math.abs(lum - luminance(data[next], data[next + 1], data[next + 2]))
        }
        edgeSum += localEdge
        edgeSamples.push(localEdge * 0.5)
      }
    }
    const totalSamples = Math.ceil(canvas.width / step) * Math.ceil(canvas.height / step)
    const meanLuminance = activeSamples ? sumLuminance / activeSamples : 0
    edgeSamples.sort((a, b) => a - b)
    const edgeP90 = edgeSamples.length ? edgeSamples[Math.min(edgeSamples.length - 1, Math.floor(edgeSamples.length * 0.9))] : 0
    const metrics = {
      sourceIndex,
      sourceProgress: sourceCount > 1 ? sourceIndex / (sourceCount - 1) : 0,
      activeSamples,
      coverage: activeSamples / Math.max(1, totalSamples),
      paletteDistance: paletteWeight ? paletteDistance / paletteWeight : 1,
      meanLuminance,
      luminanceStd: activeSamples ? Math.sqrt(Math.max(0, sumLuminanceSquared / activeSamples - meanLuminance * meanLuminance)) : 0,
      highLumRatio: highLuminanceSamples / Math.max(1, activeSamples),
      meanSaturation: activeSamples ? sumSaturation / activeSamples : 0,
      edgeMean: activeSamples ? clamp(edgeSum / activeSamples * 4.8, 0, 1) : 0,
      edgeP90: clamp(edgeP90, 0, 1),
      clippedRatio: activeSamples ? clipped / activeSamples : 0,
    }
    metrics.score = scoreAifxMaterialCandidate(metrics, style?.styleModel || {}, materialType)
    return { canvas, imageData, metrics }
  }

  const mapAifxMaterialBankFrame = (sourceIndices, frameIndex, frameCount) => {
    const sources = Array.isArray(sourceIndices) && sourceIndices.length ? sourceIndices : [0]
    const safeFrameCount = Math.max(1, Math.round(Number(frameCount) || 1))
    const safeFrameIndex = clamp(Math.round(Number(frameIndex) || 0), 0, safeFrameCount - 1)
    const progress = safeFrameCount <= 1 ? 0 : safeFrameIndex / (safeFrameCount - 1)
    const position = progress * Math.max(0, sources.length - 1)
    const leftBankIndex = Math.floor(position)
    const rightBankIndex = Math.min(sources.length - 1, Math.ceil(position))
    return {
      progress,
      leftBankIndex,
      rightBankIndex,
      leftSourceIndex: sources[leftBankIndex],
      rightSourceIndex: sources[rightBankIndex],
      mix: rightBankIndex === leftBankIndex ? 0 : position - leftBankIndex,
    }
  }

  AifxPureHelpers.mapMaterialBankFrame = mapAifxMaterialBankFrame

  const selectAifxMaterialBank = async (rawFrames, style, materialType) => {
    const measured = await Promise.all(rawFrames.map(async (rawFrame, index) => {
      const canvas = await dataUrlToCanvas(rawFrame.dataUrl)
      return measureAifxMaterialCandidate(canvas, style, index, rawFrames.length, materialType)
    }))
    const usable = measured
      .filter((candidate) => Number.isFinite(candidate.metrics.score))
    const qualified = usable
      .filter((candidate) => isAifxMaterialCandidateEligible(candidate.metrics, style?.styleModel || {}, materialType))
      .sort((a, b) => a.metrics.score - b.metrics.score || a.metrics.sourceIndex - b.metrics.sourceIndex)
    if (qualified.length < 3) {
      const error = new Error(`AI ${materialType} material bank requires three qualified texture candidates; found ${qualified.length}`)
      error.code = 'AIFX_MATERIAL_BANK_INSUFFICIENT_TEXTURE'
      throw error
    }
    const selected = qualified.slice(0, 3).sort((a, b) => a.metrics.sourceIndex - b.metrics.sourceIndex)
    const candidates = selected.map((candidate) => {
      const lumField = buildMaterialLuminanceField(candidate.imageData)
      return {
        ...candidate,
        lumField,
        blurField: blurFloatField(lumField, candidate.imageData.width, candidate.imageData.height, 2),
      }
    })
    return {
      candidates,
      rawCandidateCount: rawFrames.length,
      qualifiedCandidateCount: qualified.length,
      selectionPolicy: materialType === 'lightning'
        ? 'top-3-lightning-emissive-texture'
        : 'top-3-reference-texture-progression',
      fallback: false,
      warning: '',
    }
  }

  const renderAifxReferencePaletteTexture = (canvas, templateCanvas, materialBank, guide, style, frameIndex, frameCount, options = {}) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const width = canvas.width
    const height = canvas.height
    const palette = style?.palette || defaultPalette
    const structure = createTemplateStructure(templateCanvas, guide || fallbackGuide(width, height), palette)
    const output = ctx.createImageData(width, height)
    const sourceIndices = materialBank.candidates.map((candidate) => candidate.metrics.sourceIndex)
    const materialMapping = mapAifxMaterialBankFrame(sourceIndices, frameIndex, frameCount)
    const leftCandidate = materialBank.candidates[materialMapping.leftBankIndex]
    const rightCandidate = materialBank.candidates[materialMapping.rightBankIndex]
    const strength = clamp((options.materialStrength ?? state.materialStrength) / 100, 0, 1)
    const detail = clamp((options.contourVariation ?? state.contourVariation) / 100, 0, 1)
    const center = guide?.center || { x: width * 0.5, y: height * 0.5 }
    const length = Math.max(1, guide?.length || Math.max(width, height))
    const bodyWidth = Math.max(1, guide?.width || Math.max(width, height) * 0.12)
    const axis = structure.axis
    const normal = structure.normal
    const sampleMaterialAt = (candidate, x, y) => {
      const materialImage = candidate.imageData
      const matX = x * (materialImage.width / width)
      const matY = y * (materialImage.height / height)
      const color = sampleImageData(materialImage, matX, matY)
      const materialIndex = clamp(Math.round(matY), 0, materialImage.height - 1) * materialImage.width
        + clamp(Math.round(matX), 0, materialImage.width - 1)
      const active = color.a >= 0.05 && color.lum >= 0.035
      return {
        active,
        color,
        luminance: active ? color.lum : 0.5,
        detail: active ? clamp((candidate.lumField[materialIndex] - candidate.blurField[materialIndex]) * 4, -1, 1) : 0,
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const base = structure.alpha[index]
        if (base < 0.004) continue
        const offset = index * 4
        const dx = x - center.x
        const dy = y - center.y
        const proj = (dx * axis.x + dy * axis.y) / length + 0.5
        const side = (dx * normal.x + dy * normal.y) / (bodyWidth * 3.4) + 0.5
        const seed = hash01(x, y, materialMapping.leftSourceIndex * 131 + materialMapping.rightSourceIndex * 17 + frameIndex)
        const styleA = getStyleSample(style, proj * (3.2 + detail * 4.8) + frameIndex * 0.031 + seed * 0.18, side * (2.1 + detail * 3.2) + frameIndex * 0.019)
        const leftMaterial = sampleMaterialAt(leftCandidate, x, y)
        const rightMaterial = rightCandidate === leftCandidate ? leftMaterial : sampleMaterialAt(rightCandidate, x, y)
        const bothActive = leftMaterial.active && rightMaterial.active
        const materialActive = leftMaterial.active || rightMaterial.active
        const material = bothActive
          ? mixColor(leftMaterial.color, rightMaterial.color, materialMapping.mix)
          : leftMaterial.active ? leftMaterial.color : rightMaterial.active ? rightMaterial.color : null
        const aiLuminance = bothActive
          ? lerp(leftMaterial.luminance, rightMaterial.luminance, materialMapping.mix)
          : leftMaterial.active ? leftMaterial.luminance : rightMaterial.active ? rightMaterial.luminance : 0.5
        const aiDetail = bothActive
          ? lerp(leftMaterial.detail, rightMaterial.detail, materialMapping.mix)
          : leftMaterial.active ? leftMaterial.detail : rightMaterial.active ? rightMaterial.detail : 0
        const energy = clamp(structure.lum[index] * 0.76 + base * 0.18 + structure.highlight[index] * 0.06, 0, 1)
        const color = fuseAifxReferencePaletteTexture({
          palette,
          referenceColor: styleA,
          aiColor: materialActive ? material : null,
          aiLuminance,
          aiDetail,
          energy,
          hot: structure.highlight[index],
          styleStrength: strength,
          materialType: options.materialType,
        })
        output.data[offset] = Math.round(color.r)
        output.data[offset + 1] = Math.round(color.g)
        output.data[offset + 2] = Math.round(color.b)
        output.data[offset + 3] = Math.round(base * 255)
      }
    }
    ctx.putImageData(output, 0, 0)
    return materialMapping
  }

  const renderLockedMaterialTransfer = (canvas, templateCanvas, materialCanvas, guide, style, frameIndex, frameCount, options = {}) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const width = canvas.width
    const height = canvas.height
    const palette = style?.palette || defaultPalette
    const materialStrength = clamp((options.materialStrength ?? state.materialStrength) / 100, 0, 1)
    const textureDetail = clamp((options.contourVariation ?? state.contourVariation) / 100, 0, 1)
    const qualityBoost = options.qualityBoost ? 1 : 0
    const structure = createTemplateStructure(templateCanvas, guide || fallbackGuide(width, height), palette)
    const materialCtx = materialCanvas.getContext('2d', { willReadFrequently: true })
    const materialImage = materialCtx.getImageData(0, 0, materialCanvas.width, materialCanvas.height)
    const materialLum = buildMaterialLuminanceField(materialImage)
    const materialBlur = blurFloatField(materialLum, materialImage.width, materialImage.height, clamp(1.2 + textureDetail * 3, 1, 4))
    const output = ctx.createImageData(width, height)
    const out = output.data
    const {
      alpha,
      lum,
      softAlpha,
      glowAlpha,
      gradient,
      highlight,
      axis,
      normal,
    } = structure
    const center = guide?.center || { x: width * 0.5, y: height * 0.5 }
    const length = Math.max(1, guide?.length || Math.max(width, height))
    const bodyWidth = Math.max(1, guide?.width || Math.max(width, height) * 0.12)
    const model = style?.styleModel
    const detailScale = 2.6 + textureDetail * 7.4 + (model?.edgeMean || 0.42) * 2.8 + qualityBoost * 2.2
    const transferWeight = clamp(0.78 + materialStrength * 0.2 + qualityBoost * 0.06, 0.78, 0.98)
    const edgeSoftness = palette.edgeSoftness || defaultPalette.edgeSoftness
    const glowStrength = palette.glowStrength || defaultPalette.glowStrength
    const core = palette.core || defaultPalette.core
    const glow = palette.glow || defaultPalette.glow
    const outer = palette.outer || defaultPalette.outer

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const offset = index * 4
        const base = alpha[index]
        const soft = softAlpha[index]
        const glowField = glowAlpha[index]
        if (Math.max(base, soft, glowField) < 0.004) continue

        const dx = x - center.x
        const dy = y - center.y
        const proj = (dx * axis.x + dy * axis.y) / length + 0.5
        const side = (dx * normal.x + dy * normal.y) / (bodyWidth * 3.4) + 0.5
        const hot = highlight[index]
        const localLum = lum[index]
        const edge = clamp(gradient[index] * 0.82 + Math.abs(soft - base) * 2.6, 0, 1)
        const seed = hash01(x, y, Math.round(materialStrength * 997))
        const flowU = proj * detailScale + frameIndex * 0.028 + seed * 0.45
        const flowV = side * (detailScale * 0.56) + seed * 0.31 + frameIndex * 0.017
        const styleA = getStyleSample(style, flowU, flowV)
        const styleB = getStyleSample(style, flowU * 1.71 - side * 0.66, flowV * 1.23 + proj * 0.42)
        const matX = x * (materialImage.width / width)
        const matY = y * (materialImage.height / height)
        const material = sampleImageData(materialImage, matX + (seed - 0.5) * textureDetail * 7, matY + (styleA.lum - 0.5) * textureDetail * 5)
        const matIndex = clamp(Math.round(matY), 0, materialImage.height - 1) * materialImage.width + clamp(Math.round(matX), 0, materialImage.width - 1)
        const materialHigh = clamp((materialLum[matIndex] - materialBlur[matIndex]) * 3.8 + 0.5, 0, 1)
        const refMean = model?.lumMean ?? 0.5
        const refStd = Math.max(0.05, model?.lumStd ?? 0.18)
        const styleContrast = clamp(((styleA.lum - refMean) / refStd) * 0.18 + ((styleB.lum - refMean) / refStd) * 0.12 + 0.5, 0, 1)
        const flowWave = 0.5 + Math.sin(proj * Math.PI * (10 + textureDetail * 26) + side * (5 + textureDetail * 10) + frameIndex * 0.73) * 0.5
        const crack = smoothstep(0.64, 0.97, styleContrast * 0.46 + materialHigh * 0.3 + flowWave * 0.18 + hot * 0.2 + edge * 0.1)
        const bodyEnergy = clamp(localLum * 0.76 + base * 0.24 + hot * 0.22 + material.lum * 0.12, 0, 1)
        const targetLum = clamp(Math.pow(bodyEnergy, 0.92) * 0.62 + styleContrast * 0.18 + hot * 0.25, 0.03, 0.96)
        const distColorA = getStyleDistributionColor(style, targetLum, seed, (styleContrast - 0.5) * 0.18)
        const distColorB = getStyleDistributionColor(style, clamp(targetLum + (materialHigh - 0.5) * 0.22, 0, 1), hash01(x + 19, y - 37, 211))

        let color = mixColor(outer, glow, smoothstep(0.04, 0.86, bodyEnergy))
        color = mixColor(color, material, clamp(0.2 + materialStrength * 0.22 + textureDetail * 0.18, 0.2, 0.52))
        color = mixColor(color, styleA, clamp(0.14 + textureDetail * 0.2 + crack * 0.2, 0.12, 0.48))
        color = mixColor(color, distColorA, transferWeight * (0.64 + styleA.sat * 0.18))
        color = mixColor(color, distColorB, clamp(0.16 + textureDetail * 0.34 + qualityBoost * 0.16, 0.16, 0.58))
        color = mixColor(color, core, clamp(hot * (0.32 + materialStrength * 0.28) + crack * 0.1, 0, 0.62))
        color = boostSaturation(color, clamp(0.16 + materialStrength * 0.22 + textureDetail * 0.22 + qualityBoost * 0.12, 0.16, 0.62))

        const materialShade = clamp(0.42 + bodyEnergy * 0.46 + materialHigh * 0.28 + styleContrast * 0.18 + crack * 0.22 - edge * 0.12, 0.08, 1.35)
        out[offset] = clamp(color.r * materialShade + core.r * hot * 0.12, 0, 255)
        out[offset + 1] = clamp(color.g * materialShade + core.g * hot * 0.12, 0, 255)
        out[offset + 2] = clamp(color.b * materialShade + core.b * hot * 0.12, 0, 255)

        const textureAlpha = clamp(0.55 + crack * 0.22 + materialHigh * 0.24 + styleContrast * 0.12 - edge * (0.14 + edgeSoftness * 0.16), 0.16, 1.08)
        const bodyAlpha = Math.pow(base, 0.86) * clamp(0.44 + bodyEnergy * 0.52 + hot * 0.16, 0.2, 1)
        const featherAlpha = soft * clamp(0.05 + edgeSoftness * 0.08 + textureDetail * 0.035, 0.05, 0.16) * clamp(0.55 + styleContrast + hot * 0.4, 0.35, 1.35)
        const glowOpacity = Math.pow(glowField, 1.72) * clamp(0.03 + glowStrength * 0.08 + materialStrength * 0.04, 0.04, 0.18) * clamp(0.45 + material.lum + hot * 0.5, 0.35, 1.4)
        const finalAlpha = clamp(bodyAlpha * textureAlpha + featherAlpha + glowOpacity, 0, 0.96)
        out[offset + 3] = Math.round(finalAlpha * 255)
      }
    }

    ctx.putImageData(output, 0, 0)
    const glowCanvas = createCanvas(width, height)
    glowCanvas.getContext('2d').drawImage(canvas, 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.filter = `blur(${clamp(1.5 + glowStrength * 4.5, 2, 7)}px)`
    ctx.globalAlpha = clamp(0.12 + materialStrength * 0.1 + textureDetail * 0.05, 0.12, 0.28)
    ctx.drawImage(glowCanvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(glowCanvas, 0, 0)
    ctx.restore()
    refineGeneratedAlphaFromLight(canvas, style)
    void frameCount
  }

  const validateMaterialTransferFrame = (canvas, templateCanvas, style) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    const templateCtx = templateCanvas.getContext('2d', { willReadFrequently: true })
    const templateData = templateCtx.getImageData(0, 0, templateCanvas.width, templateCanvas.height).data
    const step = Math.max(3, Math.floor(Math.max(canvas.width, canvas.height) / 160))
    let alphaPixels = 0
    let templatePixels = 0
    let midAlphaPixels = 0
    let bright = 0
    let lumSum = 0
    let lumSq = 0
    let styleDistance = 0
    let saturated = 0
    let minX = canvas.width
    let minY = canvas.height
    let maxX = 0
    let maxY = 0
    let tMinX = canvas.width
    let tMinY = canvas.height
    let tMaxX = 0
    let tMaxY = 0
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const offset = (y * canvas.width + x) * 4
        const alpha = data[offset + 3] / 255
        const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
        const tplAlpha = templateData[offset + 3] / 255
        const tplLum = luminance(templateData[offset], templateData[offset + 1], templateData[offset + 2])
        const tplPresence = Math.max(tplAlpha, clamp((tplLum - 0.035) / 0.965, 0, 1))
        if (tplPresence > 0.05) {
          templatePixels += 1
          tMinX = Math.min(tMinX, x)
          tMinY = Math.min(tMinY, y)
          tMaxX = Math.max(tMaxX, x)
          tMaxY = Math.max(tMaxY, y)
        }
        if (alpha > 0.05) {
          alphaPixels += 1
          bright += lum * alpha
          lumSum += lum
          lumSq += lum * lum
          const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] }
          styleDistance += nearestStyleDistance(style, color)
          if (saturation(color.r, color.g, color.b) > 0.22) saturated += 1
          if (alpha > 0.12 && alpha < 0.82) midAlphaPixels += 1
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }
    const meanLum = alphaPixels ? lumSum / alphaPixels : 0
    const variance = alphaPixels ? Math.max(0, lumSq / alphaPixels - meanLum * meanLum) : 0
    const coverageRatio = alphaPixels / Math.max(1, templatePixels)
    const edgeSoftRatio = midAlphaPixels / Math.max(1, alphaPixels)
    const avgStyleDistance = styleDistance / Math.max(1, alphaPixels)
    const resultW = Math.max(1, maxX - minX)
    const resultH = Math.max(1, maxY - minY)
    const templateW = Math.max(1, tMaxX - tMinX)
    const templateH = Math.max(1, tMaxY - tMinY)
    const bboxDrift = Math.abs(resultW - templateW) / Math.max(1, templateW) + Math.abs(resultH - templateH) / Math.max(1, templateH)
    const flatFill = alphaPixels > 12 && (variance < 0.006 || saturated / Math.max(1, alphaPixels) < 0.18 || edgeSoftRatio < 0.16)
    const lowStyle = alphaPixels > 12 && avgStyleDistance > 0.42
    return {
      alphaPixels,
      brightness: bright / Math.max(1, alphaPixels),
      variance,
      edgeSoftRatio,
      coverageRatio,
      bboxDrift,
      avgStyleDistance,
      flatFill,
      lowStyle,
    }
  }

  const percentile = (values, ratio, fallback = 0) => {
    if (!values.length) return fallback
    const sorted = values.slice().sort((a, b) => a - b)
    return sorted[clamp(Math.floor((sorted.length - 1) * ratio), 0, sorted.length - 1)]
  }

  const createAifxTemplateMaterialFields = (templateCanvas) => {
    const width = templateCanvas.width
    const height = templateCanvas.height
    const ctx = templateCanvas.getContext('2d', { willReadFrequently: true })
    const image = ctx.getImageData(0, 0, width, height)
    const data = image.data
    const total = width * height
    const rawAlpha = new Float32Array(total)
    const rawLum = new Float32Array(total)
    const presence = new Float32Array(total)
    const alphaMask = new Float32Array(total)
    let transparentPixels = 0
    let visibleAlphaPixels = 0
    let maxLum = 0

    for (let index = 0; index < total; index += 1) {
      const offset = index * 4
      const alpha = data[offset + 3] / 255
      const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
      rawAlpha[index] = alpha
      alphaMask[index] = alpha
      rawLum[index] = lum
      maxLum = Math.max(maxLum, lum)
      if (alpha < 0.985) transparentPixels += 1
      if (alpha > 0.035) visibleAlphaPixels += 1
    }

    const hasUsefulAlpha = visibleAlphaPixels > 12 && transparentPixels > total * 0.015
    const lumFloor = Math.max(0.015, Math.min(0.12, maxLum * 0.08))
    const lumCeil = Math.max(lumFloor + 0.08, maxLum * 0.74)
    const lumSamples = []

    for (let index = 0; index < total; index += 1) {
      const alphaPresence = rawAlpha[index]
      const lumPresence = smoothstep(lumFloor, lumCeil, rawLum[index])
      const value = hasUsefulAlpha ? alphaPresence : lumPresence
      presence[index] = value
      if (value > 0.05 && (index % 3 === 0 || lumSamples.length < 8000)) lumSamples.push(rawLum[index])
    }

    const lowLum = percentile(lumSamples, 0.06, 0.04)
    const highLum = Math.max(lowLum + 0.08, percentile(lumSamples, 0.94, 0.88))
    const lum = new Float32Array(total)
    for (let index = 0; index < total; index += 1) {
      const normalized = clamp((rawLum[index] - lowLum) / Math.max(0.001, highLum - lowLum), 0, 1)
      lum[index] = Math.pow(normalized, 0.86)
    }

    const softPresence = blurFloatField(presence, width, height, 1)
    const centerGlow = blurFloatField(lum.map ? lum : new Float32Array(lum), width, height, 2)
    const edge = new Float32Array(total)
    const localContrast = new Float32Array(total)
    const highlightMask = new Float32Array(total)
    const innerMask = new Float32Array(total)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const left = presence[y * width + Math.max(0, x - 1)]
        const right = presence[y * width + Math.min(width - 1, x + 1)]
        const up = presence[Math.max(0, y - 1) * width + x]
        const down = presence[Math.min(height - 1, y + 1) * width + x]
        const lumLeft = lum[y * width + Math.max(0, x - 1)]
        const lumRight = lum[y * width + Math.min(width - 1, x + 1)]
        const lumUp = lum[Math.max(0, y - 1) * width + x]
        const lumDown = lum[Math.min(height - 1, y + 1) * width + x]
        edge[index] = clamp(Math.hypot(right - left, down - up) * 2.8 + Math.max(0, softPresence[index] - presence[index]) * 1.2, 0, 1)
        localContrast[index] = clamp(Math.hypot(lumRight - lumLeft, lumDown - lumUp) * 1.4, 0, 1)
        highlightMask[index] = clamp(smoothstep(0.58, 0.98, lum[index] + centerGlow[index] * 0.12) * presence[index] + localContrast[index] * 0.16, 0, 1)
        innerMask[index] = clamp(presence[index] - edge[index] * 0.42, 0, 1)
      }
    }

    return {
      width,
      height,
      data,
      rawAlpha,
      alphaMask,
      rawLum,
      luminanceMap: lum,
      lum,
      presence,
      softPresence,
      centerGlow,
      edgeMask: edge,
      edge,
      localContrast,
      highlightMask,
      innerMask,
      hasUsefulAlpha,
    }
  }

  const makeAifxStyleImageData = (style) => {
    if (!style?.textureData || !style.textureWidth || !style.textureHeight) return null
    return {
      width: style.textureWidth,
      height: style.textureHeight,
      data: style.textureData,
    }
  }

  const renderAifxMaterialTransferFrame = (canvas, templateCanvas, guide, style, frameIndex, frameCount, options = {}) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const width = canvas.width
    const height = canvas.height
    const palette = style?.palette || defaultPalette
    const materialStrength = clamp((options.materialStrength ?? state.materialStrength) / 100, 0, 1)
    const textureAmount = clamp(0.42 + materialStrength * 0.5 + (options.qualityBoost ? 0.12 : 0), 0.42, 0.98)
    const fields = createAifxTemplateMaterialFields(templateCanvas)
    const styleImage = makeAifxStyleImageData(style)
    const materialMaps = style?.materialMaps || null
    const axis = guide?.axis || { x: 1, y: 0 }
    const normal = guide?.normal || { x: 0, y: 1 }
    const center = guide?.center || { x: width * 0.5, y: height * 0.5 }
    const length = Math.max(1, guide?.length || Math.max(width, height))
    const bodyWidth = Math.max(1, guide?.width || Math.max(width, height) * 0.12)
    const output = ctx.createImageData(width, height)
    const out = output.data
    const model = style?.styleModel
    const glow = palette.glow || defaultPalette.glow
    const outer = palette.outer || defaultPalette.outer
    const core = palette.core || defaultPalette.core
    const spark = palette.spark || brighten(glow, 0.55)
    const flowScale = 1.35 + textureAmount * 2.35 + (model?.edgeMean || 0.32) * 1.8
    const highPassStrength = clamp((model?.edgeMean || 0.32) * 1.6 + textureAmount * 0.55, 0.35, 1.25)
    const frameProgress = frameCount > 1 ? frameIndex / (frameCount - 1) : 0
    const flowOffset = frameProgress * (0.08 + textureAmount * 0.1)

    ctx.clearRect(0, 0, width, height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const offset = index * 4
        const base = fields.presence[index]
        if (base < 0.006) continue

        const dx = x - center.x
        const dy = y - center.y
        const proj = (dx * axis.x + dy * axis.y) / length + 0.5
        const side = (dx * normal.x + dy * normal.y) / (bodyWidth * 2.6) + 0.5
        const seed = hash01(x, y, Math.round(materialStrength * 1000))
        const templateLum = fields.lum[index]
        const hot = smoothstep(0.58, 0.98, templateLum + fields.centerGlow[index] * 0.22)
        const edge = fields.edge[index]
        const contrast = fields.localContrast[index]
        const inner = fields.innerMask[index]
        const templateHighlight = fields.highlightMask[index]
        const u = proj * flowScale + flowOffset + seed * 0.08
        const v =
          side * (0.9 + textureAmount * 1.3) +
          Math.sin(proj * Math.PI * 2.0 + flowOffset * Math.PI * 2) * 0.055
        const materialSample = sampleAifxMaterialMaps(materialMaps, u, v)
        const edgeSample = sampleAifxMaterialMaps(materialMaps, u + edge * 0.17 + seed * 0.03, v + side * 0.08)
        const highlightSample = sampleAifxMaterialMaps(materialMaps, u - hot * 0.11, v + flowOffset * 0.7)
        const texA = getStyleSample(style, u, v)
        const texB = getStyleSample(style, u * 1.91 + side * 0.27, v * 1.67 - proj * 0.22)
        const texC = getStyleSample(style, u * 0.57 - side * 0.41, v * 2.42 + seed * 0.2)
        const direct = materialSample?.color || (styleImage
          ? sampleImageData(
              styleImage,
              positiveMod(u, 1) * (styleImage.width - 1),
              positiveMod(v + seed * 0.05, 1) * (styleImage.height - 1),
            )
          : texA)
        const targetLum = clamp(templateLum * 0.72 + hot * 0.18 + contrast * 0.1, 0.02, 0.98)
        const ramp = getStyleDistributionColor(style, targetLum, seed, (texA.lum - 0.5) * 0.12)
        const refDetail = clamp(
          Math.abs(texA.lum - texB.lum) * 0.72 +
            Math.abs(texB.lum - texC.lum) * 0.45 +
            direct.sat * 0.18 +
            (materialSample?.detail || 0) * 0.56 +
            (edgeSample?.edge || 0) * edge * 0.42 +
            (highlightSample?.highlight || 0) * templateHighlight * 0.36 +
            contrast * 0.28 +
            edge * 0.12,
          0,
          1,
        )
        const materialEdge = edgeSample?.edge || refDetail
        const materialHighlight = highlightSample?.highlight || materialSample?.highlight || 0
        const materialShadow = materialSample?.shadow || 0
        const vein = smoothstep(0.5, 0.9, refDetail * highPassStrength + templateHighlight * 0.2 + contrast * 0.16)
        const shade = clamp(
          0.34 + templateLum * 0.56 + refDetail * 0.17 + templateHighlight * 0.34 - edge * 0.08 - materialShadow * inner * 0.16,
          0.1,
          1.38,
        )

        let color = mixColor(outer, glow, smoothstep(0.05, 0.92, templateLum))
        color = mixColor(color, ramp, 0.62 + materialStrength * 0.22)
        color = mixColor(color, direct, textureAmount * (0.35 + refDetail * 0.34) * clamp(0.45 + inner, 0.45, 1))
        color = mixColor(color, texA, textureAmount * 0.16)
        color = mixColor(color, texB, textureAmount * vein * 0.18)
        color = mixColor(color, edgeSample?.color || glow, edge * materialEdge * (0.24 + textureAmount * 0.26))
        color = mixColor(color, highlightSample?.color || core, templateHighlight * materialHighlight * (0.4 + materialStrength * 0.32))
        color = mixColor(color, core, templateHighlight * (0.2 + materialStrength * 0.18))
        color = mixColor(color, spark, vein * templateHighlight * 0.18)
        color = boostSaturation(color, 0.12 + materialStrength * 0.24 + textureAmount * 0.16)

        const textureShade = clamp(
          0.72 +
            (direct.lum - (model?.lumMean ?? 0.45)) * 0.48 +
            vein * 0.16 +
            refDetail * 0.14 +
            materialHighlight * templateHighlight * 0.24 -
            materialShadow * inner * 0.18,
          0.34,
          1.42,
        )
        out[offset] = clamp(color.r * shade * textureShade + core.r * hot * 0.08, 0, 255)
        out[offset + 1] = clamp(color.g * shade * textureShade + core.g * hot * 0.08, 0, 255)
        out[offset + 2] = clamp(color.b * shade * textureShade + core.b * hot * 0.08, 0, 255)

        const alphaBase = fields.hasUsefulAlpha ? fields.alphaMask[index] : base
        out[offset + 3] = Math.round(clamp(alphaBase, 0, 1) * 255)
      }
    }

    ctx.putImageData(output, 0, 0)

    const glowCanvas = createCanvas(width, height)
    const glowCtx = glowCanvas.getContext('2d')
    glowCtx.drawImage(canvas, 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.filter = `blur(${clamp(1.2 + (palette.glowStrength || defaultPalette.glowStrength) * 2.2, 1.6, 4)}px)`
    ctx.globalAlpha = clamp(0.05 + materialStrength * 0.08, 0.06, 0.14)
    ctx.drawImage(glowCanvas, 0, 0)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(glowCanvas, 0, 0)
    ctx.restore()
    const restored = ctx.getImageData(0, 0, width, height)
    for (let index = 0; index < width * height; index += 1) {
      restored.data[index * 4 + 3] = Math.round(clamp(fields.hasUsefulAlpha ? fields.alphaMask[index] : fields.presence[index], 0, 1) * 255)
    }
    ctx.putImageData(restored, 0, 0)
    void frameCount
  }

  const validateAifxMaterialFrame = (canvas, templateCanvas, style) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const template = templateCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, templateCanvas.width, templateCanvas.height)
    const data = image.data
    const tpl = template.data
    const step = Math.max(2, Math.floor(Math.max(canvas.width, canvas.height) / 160))
    let pixels = 0
    let tplPixels = 0
    let lumSum = 0
    let lumSq = 0
    let styleDistance = 0
    let detailSum = 0
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const offset = (y * canvas.width + x) * 4
        const alpha = data[offset + 3] / 255
        const tplAlpha = tpl[offset + 3] / 255
        const tplLum = luminance(tpl[offset], tpl[offset + 1], tpl[offset + 2])
        const tplPresence = Math.max(tplAlpha, smoothstep(0.02, 0.18, tplLum))
        if (tplPresence > 0.05) tplPixels += 1
        if (alpha > 0.05) {
          pixels += 1
          const lum = luminance(data[offset], data[offset + 1], data[offset + 2])
          lumSum += lum
          lumSq += lum * lum
          const color = { r: data[offset], g: data[offset + 1], b: data[offset + 2] }
          styleDistance += nearestStyleDistance(style, color)
          const rightOffset = (y * canvas.width + Math.min(canvas.width - 1, x + step)) * 4
          detailSum += Math.abs(lum - luminance(data[rightOffset], data[rightOffset + 1], data[rightOffset + 2]))
        }
      }
    }
    const meanLum = pixels ? lumSum / pixels : 0
    const variance = pixels ? Math.max(0, lumSq / pixels - meanLum * meanLum) : 0
    const detail = detailSum / Math.max(1, pixels)
    const coverageRatio = pixels / Math.max(1, tplPixels)
    const avgStyleDistance = styleDistance / Math.max(1, pixels)
    return {
      pixels,
      coverageRatio,
      variance,
      detail,
      avgStyleDistance,
      flatFill: pixels > 12 && (variance < 0.0045 || detail < 0.018),
      lowStyle: pixels > 12 && avgStyleDistance > 0.48,
    }
  }

  const normalizeComfyFrame = async (dataUrl, template, index) => {
    const image = await imageFromUrl(dataUrl)
    const materialCanvas = createCanvas(template.width, template.height)
    const materialCtx = materialCanvas.getContext('2d', { willReadFrequently: true })
    materialCtx.clearRect(0, 0, materialCanvas.width, materialCanvas.height)
    materialCtx.drawImage(image, 0, 0, materialCanvas.width, materialCanvas.height)
    const canvas = createCanvas(template.width, template.height)
    renderLockedMaterialTransfer(
      canvas,
      template.canvas,
      materialCanvas,
      state.templateGuides[index] || analyzeFrame(template.canvas),
      state.styleReference,
      index,
      state.templateFrames.length,
    )
    let quality = validateMaterialTransferFrame(canvas, template.canvas, state.styleReference)
    if (quality.flatFill || quality.lowStyle || quality.variance < 0.009) {
      renderLockedMaterialTransfer(
        canvas,
        template.canvas,
        materialCanvas,
        state.templateGuides[index] || analyzeFrame(template.canvas),
        state.styleReference,
        index,
        state.templateFrames.length,
        {
          materialStrength: Math.min(100, state.materialStrength + 10),
          contourVariation: Math.min(100, state.contourVariation + 28),
          qualityBoost: true,
        },
      )
      quality = validateMaterialTransferFrame(canvas, template.canvas, state.styleReference)
    }
    return {
      index,
      fileName: `comfy_material_transfer_${pad(index)}.png`,
      canvas,
      width: canvas.width,
      height: canvas.height,
      dataUrl: canvas.toDataURL('image/png'),
      quality,
    }
  }

  const runComfyStyleTransferFrame = async (template, styleImageName, index, sessionPrefix) => {
    const templateImageName = await uploadComfyImage(template.dataUrl, `nfst_template_${Date.now()}_${pad(index)}.png`)
    const outputPrefix = `${sessionPrefix}/frame_${pad(index)}`
    const workflow = buildComfyStyleTransferWorkflow(templateImageName, styleImageName, outputPrefix)
    const promptId = await sendComfyPrompt(workflow)
    const history = await waitForComfyHistory(promptId)
    const image = findComfyOutputImage(history)
    const dataUrl = await downloadComfyImageDataUrl(image)
    return normalizeComfyFrame(dataUrl, template, index)
  }

  const runAifxSpritesheetComfyStyleSequence = async () => {
    if (!state.templateFrames.length) {
      setStatus('需要模板', '请先载入模板序列帧。')
      return
    }
    if (!state.styleReference?.dataUrl) {
      setStatus('需要参考图', '请先拖入一张风格参考图。')
      return
    }

    setStatus('NovaFlow AI Runtime 整图风格迁移中', '正在合成 sprite sheet 并检查 IPAdapter/style 节点。')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const info = await requireComfyStyleNodes()
    const sheetPlan = buildAifxSpriteSheet(state.templateFrames)
    state.spriteSheet = {
      inputCanvas: sheetPlan.canvas,
      outputCanvas: null,
      frameRects: sheetPlan.frameRects,
      spriteSheetWidth: sheetPlan.spriteSheetWidth,
      spriteSheetHeight: sheetPlan.spriteSheetHeight,
    }
    const planLog = {
      pipeline: PIPELINE_ID,
      spriteSheetWidth: sheetPlan.spriteSheetWidth,
      spriteSheetHeight: sheetPlan.spriteSheetHeight,
      frameCount: sheetPlan.frameCount,
      frameRects: sheetPlan.frameRects.length,
      comfyuiRunCount: 1,
    }
    console.info(`[${PIPELINE_ID}] spritesheet plan ${JSON.stringify(planLog)}`)

    const sessionPrefix = `nf_spritesheet_style/${Date.now()}`
    const sheetImageName = await uploadComfyImage(sheetPlan.dataUrl, `nfst_sheet_${Date.now()}.png`)
    const styleImageName = await uploadComfyImage(state.styleReference.comfyDataUrl || state.styleReference.dataUrl, `nfst_style_${Date.now()}.png`)
    const { workflow, debug } = buildAifxSpritesheetComfyWorkflow(sheetImageName, styleImageName, `${sessionPrefix}/sheet`, info)
    const runDebug = {
      ...debug,
      referenceUploadSucceeded: Boolean(styleImageName),
      sheetUploadSucceeded: Boolean(sheetImageName),
      spriteSheetWidth: sheetPlan.spriteSheetWidth,
      spriteSheetHeight: sheetPlan.spriteSheetHeight,
      frameCount: sheetPlan.frameCount,
      frameRectsCount: sheetPlan.frameRects.length,
      comfyuiRunCount: 1,
    }
    state.lastComfyDebug = runDebug
    window.__AIFX_LAST_COMFY_DEBUG__ = runDebug
    console.info(`[${PIPELINE_ID}] comfy debug ${JSON.stringify(runDebug)}`)
    setStatus('NovaFlow AI Runtime 整图风格迁移中', `${PIPELINE_ID} · ${sheetPlan.frameCount} frames · one Runtime run`)
    refreshUi()
    const promptId = await sendComfyPrompt(workflow)
    const history = await waitForComfyHistory(promptId)
    const outputImage = findComfyOutputImage(history)
    const outputSheetDataUrl = await downloadComfyImageDataUrl(outputImage)
    const outputSheetCanvas = await dataUrlToCanvas(outputSheetDataUrl, sheetPlan.spriteSheetWidth, sheetPlan.spriteSheetHeight)
    const quality = evaluateSpritesheetStyleResult(sheetPlan.canvas, outputSheetCanvas)
    const outputColor = measureCanvasColor(outputSheetCanvas)
    state.lastComfyDebug = {
      ...state.lastComfyDebug,
      promptId,
      outputImage,
      outputColor,
      quality,
    }
    window.__AIFX_LAST_COMFY_DEBUG__ = state.lastComfyDebug
    if (quality.averageDiff < 0.045 || quality.flatRatio > 0.72 || quality.brightnessRatio < 0.28) {
      console.warn(`[${PIPELINE_ID}] quality warning; keeping Runtime sprite-sheet output and not falling back to material transfer ${JSON.stringify(quality)}`)
    }
    const frames = await cutSpritesheetToFrames(outputSheetDataUrl, sheetPlan)
    state.spriteSheet = {
      inputCanvas: sheetPlan.canvas,
      outputCanvas: outputSheetCanvas,
      frameRects: sheetPlan.frameRects,
      spriteSheetWidth: sheetPlan.spriteSheetWidth,
      spriteSheetHeight: sheetPlan.spriteSheetHeight,
      outputDataUrl: outputSheetDataUrl,
    }
    state.generatedFrames = frames
    state.activeFrameIndex = 0
    state.previewMode = 'result'
    console.info(`[${PIPELINE_ID}] spritesheet complete ${JSON.stringify({
      ...planLog,
      outputFrames: frames.length,
      outputWidth: frames[0]?.width,
      outputHeight: frames[0]?.height,
      quality,
    })}`)
    setStatus('已生成', `${frames.length} 帧 · ${frames[0].width} x ${frames[0].height} · ${PIPELINE_ID}`)
    refreshUi()
    drawPreview()
  }

  const generateAifxMaterialTransferSequence = async () => {
    if (!state.templateFrames.length) {
      setStatus('需要模板', '请先载入自定义模板，或点击“载入内置模板”。')
      return
    }
    if (!state.styleReference?.dataUrl) {
      setStatus('需要参考图', '请先拖入一张风格参考图。')
      return
    }

    console.info(`[${PIPELINE_ID}] start`, { source: RUNTIME_SOURCE, comfy: false, frames: state.templateFrames.length })
    setStatus('本地材质迁移中', `${PIPELINE_ID}：模板锁定 Alpha/动作，参考图提供颜色、纹理、光感。`)
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const frameCount = state.templateFrames.length
    const generated = []
    for (let index = 0; index < frameCount; index += 1) {
      const template = state.templateFrames[index]
      const canvas = createCanvas(template.width, template.height)
      state.status = '本地材质迁移中'
      state.detail = `正在生成第 ${index + 1} / ${frameCount} 帧；不调用 Runtime，不重绘构图。`
      refreshUi()

      renderAifxMaterialTransferFrame(
        canvas,
        template.canvas,
        state.templateGuides[index] || analyzeFrame(template.canvas),
        state.styleReference,
        index,
        frameCount,
      )
      let quality = validateAifxMaterialFrame(canvas, template.canvas, state.styleReference)
      if (quality.flatFill || quality.lowStyle) {
        renderAifxMaterialTransferFrame(
          canvas,
          template.canvas,
          state.templateGuides[index] || analyzeFrame(template.canvas),
          state.styleReference,
          index,
          frameCount,
          {
            materialStrength: Math.min(100, state.materialStrength + 12),
            qualityBoost: true,
          },
        )
        quality = validateAifxMaterialFrame(canvas, template.canvas, state.styleReference)
      }

      const frame = {
        index,
        fileName: `aifx_material_transfer_${pad(index)}.png`,
        canvas,
        width: canvas.width,
        height: canvas.height,
        dataUrl: canvas.toDataURL('image/png'),
        quality,
        pipeline: PIPELINE_ID,
      }
      generated.push(frame)
      state.generatedFrames = generated.slice()
      state.activeFrameIndex = index
      state.detail = `已完成 ${index + 1} / ${frameCount} 帧`
      refreshUi()
      drawPreview()
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    state.generatedFrames = generated
    state.activeFrameIndex = 0
    setStatus('已生成', `${generated.length} 帧 · ${generated[0].width} x ${generated[0].height} · ${PIPELINE_ID}`)
    drawPreview()
  }

  const createAifxSmokeStyleDataUrl = () => {
    const sparks = Array.from({ length: 34 }, (_, index) => {
      const x = (index * 67) % 244 + 6
      const y = (index * 41) % 238 + 9
      const r = 1 + (index % 4)
      const opacity = 0.28 + (index % 5) * 0.12
      return `<circle cx="${x}" cy="${y}" r="${r}" opacity="${opacity}"/>`
    }).join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#040712"/><defs><radialGradient id="g" cx="50%" cy="50%" r="62%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.18" stop-color="#bffbff"/><stop offset="0.45" stop-color="#18dcff"/><stop offset="1" stop-color="#1638ff" stop-opacity="0.22"/></radialGradient><filter id="blur"><feGaussianBlur stdDeviation="3"/></filter></defs><circle cx="128" cy="128" r="94" fill="url(#g)" filter="url(#blur)" opacity="0.9"/><path d="M20 151 C70 96 88 172 132 118 S190 62 238 100" fill="none" stroke="#a8fbff" stroke-width="9" stroke-linecap="round"/><path d="M38 177 L92 132 L84 164 L137 110 L121 151 L203 75" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/><path d="M28 58 L106 112 M165 35 L121 114 M232 163 L148 128 M77 221 L130 147" stroke="#19e9ff" stroke-width="3" opacity="0.8"/><g fill="#ffffff">${sparks}</g></svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }

  const createSolidStyleDataUrl = (name) => {
    const colors = {
      red: ['#ff0303', '#ffb0a0'],
      green: ['#00f050', '#c8ffd6'],
      blue: ['#006cff', '#c8ecff'],
    }
    const [main, hot] = colors[name] || colors.blue
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="${main}"/><circle cx="128" cy="128" r="82" fill="${hot}" opacity="0.9"/><path d="M18 130 C74 48 160 207 238 86" fill="none" stroke="${hot}" stroke-width="20" stroke-linecap="round" opacity="0.75"/></svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }

  const runAifxColorValidationFromQuery = async () => {
    await openApp()
    await loadBuiltinTemplate()
    const colors = ['red', 'blue', 'green']
    const runs = []
    for (const color of colors) {
      await readStyleDataUrl(createSolidStyleDataUrl(color), `aifx_validate_${color}.svg`)
      await runAifxSpritesheetComfyStyleSequence()
      const outputColor = measureCanvasColor(state.spriteSheet?.outputCanvas)
      const result = {
        reference: color,
        outputColor,
        dominantMatchesReference: outputColor.dominant === color,
        debug: state.lastComfyDebug,
      }
      runs.push(result)
      console.info(`[${PIPELINE_ID}] color validation ${color} ${JSON.stringify(result)}`)
    }
    const pass = runs.every((run) => run.dominantMatchesReference)
    state.styleValidationResult = { pipeline: PIPELINE_ID, pass, runs }
    window.__AIFX_STYLE_VALIDATION_RESULT__ = state.styleValidationResult
    const summary = runs.map((run) => `${run.reference}->${run.outputColor.dominant}(${run.outputColor.r},${run.outputColor.g},${run.outputColor.b})`).join(' | ')
    console.info(`[${PIPELINE_ID}] color validation summary ${JSON.stringify(state.styleValidationResult)}`)
    setStatus(pass ? '风格链路验证通过' : '风格链路验证失败', `${summary}; see console __AIFX_STYLE_VALIDATION_RESULT__`)
    refreshUi()
  }

  const runAifxSmokeTestFromQuery = () => {
    const params = new URLSearchParams(window.location.search || '')
    if (params.get('aifxValidateColors') === '1' || params.get('aifxSmoke') === '1') {
      console.info(`[${PIPELINE_ID}] legacy query auto-run disabled; product entry only runs after the user clicks generate.`)
    }
  }

  const syncSelectedCandidateFrames = () => {
    const candidate = state.candidates[state.selectedIndex]
    if (candidate?.frames?.length) {
      state.generatedFrames = candidate.frames
      return candidate
    }
    return null
  }

  const selectAifxCandidate = (index) => {
    if (!state.candidates.length) return
    state.selectedIndex = clamp(Math.round(index), 0, state.candidates.length - 1)
    syncSelectedCandidateFrames()
    state.activeFrameIndex = clamp(state.activeFrameIndex, 0, Math.max(0, state.generatedFrames.length - 1))
    state.previewMode = 'result'
    refreshUi()
    drawPreview()
  }

  const candidateResponseToFrames = async (candidate) => {
    const frames = []
    for (const payload of candidate.frames || []) {
      const frame = await dataUrlToFrame(payload.dataUrl, payload.fileName || `aifx_candidate_${candidate.id}_${pad(payload.index || frames.length)}.png`, payload.index ?? frames.length)
      frame.pipeline = PIPELINE_ID
      frame.candidateId = candidate.id
      frame.seed = candidate.seed
      frame.promptVariant = candidate.promptVariant || candidate.promptVariantName || ''
      frame.outputPath = candidate.outputPath || ''
      frame.score = candidate.score ?? null
      frames.push(frame)
    }
    return normalizeFrameSize(frames)
  }

  const callAifxSpritesheetConditionedRegenPipeline = async (autoPrompt) => {
    const payload = {
      pipeline: PIPELINE_ID,
      candidateCount: AIFX_CANDIDATE_COUNT,
      fps: state.fps,
      styleStrength: state.materialStrength,
      textureDetail: state.contourVariation,
      templateSequence: state.templateFrames.map((frame) => ({
        index: frame.index,
        fileName: frame.fileName,
        width: frame.width,
        height: frame.height,
        dataUrl: frame.dataUrl,
      })),
      styleReferenceImage: {
        fileName: state.styleReference?.fileName || 'reference.png',
        width: state.styleReference?.width || 0,
        height: state.styleReference?.height || 0,
        dataUrl: state.styleReference?.dataUrl || '',
      },
      autoPrompt,
    }
    const response = await fetch(AIFX_PIPELINE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `AIFX pipeline failed: HTTP ${response.status}`)
    }
    return data
  }

  const AIFX_MATERIAL_DIRECTIONS = Object.freeze({
    fire: 'production game directional fire material with layered asymmetric flame tongues, a narrow hot core, ember breakup, heat distortion and coherent trailing sparks',
    lightning: 'production game directional lightning discharge material, blue-white electric core, branching plasma filaments, sharp forked arcs, controlled bloom and coherent electric particles',
    ice: 'production game ice-and-snow material with an asymmetric one-directional fracture flow, translucent blue-white crystalline facets, incomplete broken wedges, separated angular chips, frosted shard edges, cold mist and snow particles',
    water: 'production game directional water-flow material, translucent cyan liquid ribbons, curling flow, droplets and coherent surface highlights',
    smoke: 'production game directional smoke-flow material, layered translucent wisps, rolling soft turbulence and coherent dissipating edges',
    poison: 'production game directional poison-flow material, toxic green viscous energy, bubbles, droplets and coherent organic edge breakup',
    energy: 'production game directional energy-flow material, luminous core, layered motion ribbons, controlled glow and coherent particles',
  })

  const buildAifxMaterialOnlyStyleContract = (detected, materialType, materialDirection, styleReference) => {
    const source = detected && typeof detected === 'object' ? detected : {}
    const stats = source.stats && typeof source.stats === 'object' ? source.stats : {}
    const textureData = styleReference?.textureData
    let materialWeight = 0
    let materialRed = 0
    let materialGreen = 0
    let materialBlue = 0
    let materialLuminance = 0
    let materialSaturation = 0
    if (textureData?.length) {
      for (let offset = 0; offset + 3 < textureData.length; offset += 4) {
        const alpha = textureData[offset + 3] / 255
        const pixelLuminance = luminance(textureData[offset], textureData[offset + 1], textureData[offset + 2])
        if (alpha < 0.08 || pixelLuminance < 0.045) continue
        const pixelSaturation = saturation(textureData[offset], textureData[offset + 1], textureData[offset + 2])
        const weight = alpha * (0.18 + pixelLuminance * 1.5 + pixelSaturation * 0.28)
        materialRed += textureData[offset] * weight
        materialGreen += textureData[offset + 1] * weight
        materialBlue += textureData[offset + 2] * weight
        materialLuminance += pixelLuminance * weight
        materialSaturation += pixelSaturation * weight
        materialWeight += weight
      }
    }
    const activeRgb = materialWeight > 0
      ? [materialRed, materialGreen, materialBlue].map((value) => Math.round(value / materialWeight))
      : null
    const rgb = activeRgb || (Array.isArray(stats.rgb) && stats.rgb.length >= 3
      ? stats.rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))))
      : null)
    const brightness = materialWeight > 0 ? materialLuminance / materialWeight : Number(stats.brightness)
    const saturationValue = materialWeight > 0 ? materialSaturation / materialWeight : Number(stats.saturation)
    const edge = Number(stats.edge)
    const brightRatio = Number(stats.brightRatio)
    const paletteSample = rgb
      ? `Palette: dominant material RGB ${rgb.join(' ')}, brightness ${Number.isFinite(brightness) ? brightness.toFixed(3) : 'unknown'}, saturation ${Number.isFinite(saturationValue) ? saturationValue.toFixed(3) : 'unknown'}.`
      : 'Reference palette sample: preserve the dominant, midtone and highlight color relationships visible in image2.'
    const surfaceSample = Number.isFinite(edge) && edge >= 0.2
      ? 'Surface sample: crisp high-frequency edge detail with readable internal texture.'
      : 'Surface sample: layered readable texture with controlled soft edge transitions.'
    const lightSample = Number.isFinite(brightRatio) && brightRatio >= 0.14
      ? 'Lighting sample: narrow luminous highlights, controlled bloom and visible mid-tones.'
      : 'Lighting sample: restrained glow, readable mid-tones and controlled highlights.'
    const positivePrompt = [
      materialDirection,
      paletteSample,
      surfaceSample,
      lightSample,
      'Read image2 only as spatially scrambled local material statistics.',
    ].filter(Boolean).join(' ')
    const styleTags = Object.freeze([
      `${materialType} material`,
      rgb ? `dominant rgb ${rgb.join(' ')}` : 'reference palette hierarchy',
      Number.isFinite(edge) && edge >= 0.2 ? 'crisp edge rendering' : 'controlled soft edge rendering',
      Number.isFinite(brightRatio) && brightRatio >= 0.14 ? 'narrow luminous highlights' : 'restrained glow',
      'material-only reference',
      'local material statistics',
    ])
    return Object.freeze({
      positivePrompt,
      styleDescription: styleTags.join(', '),
      styleTags,
      styleReferenceRole: 'material-only',
      referenceTopologyUsed: false,
      detectedPromptUsed: false,
    })
  }

  const AIFX_LOCAL_CONTROL_PROFILES = Object.freeze({
    fire: Object.freeze({ strength: 0.62, endPercent: 0.76 }),
    lightning: Object.freeze({ strength: 0.72, endPercent: 0.8 }),
    ice: Object.freeze({ strength: 0.66, endPercent: 0.78 }),
    water: Object.freeze({ strength: 0.6, endPercent: 0.75 }),
    smoke: Object.freeze({ strength: 0.42, endPercent: 0.64 }),
    poison: Object.freeze({ strength: 0.5, endPercent: 0.7 }),
    energy: Object.freeze({ strength: 0.52, endPercent: 0.7 }),
  })

  const aifxLocalControlProfile = (materialType, styleStrength) => {
    const profile = AIFX_LOCAL_CONTROL_PROFILES[materialType] || AIFX_LOCAL_CONTROL_PROFILES.energy
    const freedom = clamp((Number(styleStrength) || 0) / 100, 0, 1)
    return Object.freeze({
      strength: clamp(profile.strength - Math.max(0, freedom - 0.5) * 0.08, 0.3, 0.88),
      endPercent: clamp(profile.endPercent - Math.max(0, freedom - 0.5) * 0.04, 0.55, 0.94),
    })
  }

  const inferAifxMaterialHint = (styleReference, fallback = 'energy') => {
    const name = String(styleReference?.fileName || '').toLowerCase()
    const hints = [
      ['fire', /(?:fire|flame|burn|ember|火焰|火)/],
      ['lightning', /(?:lightning|electric|thunder|plasma|雷电|雷)/],
      ['ice', /(?:ice|snow|frost|crystal|冰雪|冰)/],
      ['water', /(?:water|aqua|wave|水)/],
      ['smoke', /(?:smoke|mist|fog|烟雾|烟)/],
      ['poison', /(?:poison|toxic|venom|毒)/],
    ]
    return hints.find(([, pattern]) => pattern.test(name))?.[0] || String(fallback || 'energy').toLowerCase()
  }

  const requireAifxPipelineModules = () => {
    const modules = {
      provider: window.NovaFlowAifxProviderResource,
      prompt: window.NovaFlowAifxPromptWorkflow,
      template: window.NovaFlowAifxTemplateResource,
      motionGuide: window.NovaFlowAifxMotionGuideResource,
      generate: window.NovaFlowAifxGenerateWorkflow,
      postprocess: window.NovaFlowAifxPostprocessWorkflow,
      temporalConform: window.NovaFlowAifxTemporalConformWorkflow,
      materialIdentity: window.NovaFlowAifxMaterialIdentityResource,
      materialReconstruct: window.NovaFlowAifxMaterialReconstructWorkflow,
      quality: window.NovaFlowAifxSequenceQualityWorkflow,
      export: window.NovaFlowAifxExportWorkflow,
    }
    const missing = Object.entries(modules).filter(([, api]) => !api).map(([name]) => name)
    if (missing.length) throw new Error(`AI 特效管线模块未就绪：${missing.join(', ')}`)
    return modules
  }

  const aifxLifecycleForFrames = (frameCount, guides = []) => {
    const safeFrameCount = Math.max(1, Math.round(Number(frameCount) || 1))
    const energies = Array.from({ length: safeFrameCount }, (_, index) => {
      const guide = guides[index]
      const energy = Number(guide?.energy)
      return Number.isFinite(energy) && energy >= 0 ? energy : 0
    })
    const maxEnergy = Math.max(0, ...energies)
    const measuredPeakFrame = maxEnergy > 0
      ? energies.reduce((best, energy, index) => (energy > energies[best] ? index : best), 0)
      : Math.max(0, Math.min(safeFrameCount - 1, Math.round((safeFrameCount - 1) * 0.45)))
    const peakFrame = safeFrameCount > 1
      ? Math.min(measuredPeakFrame, safeFrameCount - 2)
      : measuredPeakFrame
    return {
      mode: 'one-shot',
      startFrame: 0,
      endFrame: safeFrameCount - 1,
      peakFrame,
    }
  }

  const buildAifxSequencePlan = (snapshot, lifecycle, templateAlphaQuality = []) => {
    const guides = Array.isArray(snapshot?.templateGuides) ? snapshot.templateGuides : []
    const frameCount = Math.max(1, snapshot?.templateFrames?.length || guides.length || 1)
    const maxEnergy = Math.max(1, ...guides.map((guide) => Math.max(0, Number(guide?.energy) || 0)))
    const peakFrame = clamp(Math.round(Number(lifecycle?.peakFrame) || 0), 0, frameCount - 1)
    const postPeakPhases = ['follow-through', 'decay', 'breakup', 'dissipation']
    let previousPostPeakRank = 0
    return Array.from({ length: frameCount }, (_, index) => {
      const guide = guides[index] || fallbackGuide(
        snapshot?.templateFrames?.[index]?.width || 1,
        snapshot?.templateFrames?.[index]?.height || 1,
      )
      const canvasWidth = Math.max(1, Number(guide.canvasWidth) || snapshot?.templateFrames?.[index]?.width || 1)
      const canvasHeight = Math.max(1, Number(guide.canvasHeight) || snapshot?.templateFrames?.[index]?.height || 1)
      const energy = clamp((Number(guide.energy) || 0) / maxEnergy, 0, 1)
      const centerX = Number(guide.center?.x)
      const centerY = Number(guide.center?.y)
      const coverageRatio = Number(guide.coverageRatio)
      const templateCoverageRatio = Number(templateAlphaQuality[index]?.coverageRatio)
      const templateCoverageReliable = Number.isFinite(templateCoverageRatio)
        && templateCoverageRatio >= 0
        && templateCoverageRatio < 0.98
      const bboxOccupancy = (
        Math.max(1, Number(guide.bbox?.width) || 1) * Math.max(1, Number(guide.bbox?.height) || 1)
      ) / (canvasWidth * canvasHeight)
      let phase = 'follow-through'
      if (index === 0 && index < peakFrame) phase = 'onset'
      else if (index < peakFrame) phase = 'growth'
      else if (index === peakFrame) phase = 'peak'
      else {
        const candidatePhaseRank = energy >= 0.55 ? 0 : energy >= 0.25 ? 1 : energy >= 0.08 ? 2 : 3
        previousPostPeakRank = Math.max(previousPostPeakRank, candidatePhaseRank)
        phase = postPeakPhases[previousPostPeakRank]
      }
      return Object.freeze({
        index,
        phase,
        energy,
        centerX: clamp((Number.isFinite(centerX) ? centerX : canvasWidth * 0.5) / canvasWidth, 0, 1),
        centerY: clamp((Number.isFinite(centerY) ? centerY : canvasHeight * 0.5) / canvasHeight, 0, 1),
        directionDeg: Math.round((Number(guide.angle) || 0) * 180 / Math.PI),
        occupancy: clamp(
          templateCoverageReliable
            ? templateCoverageRatio
            : Number.isFinite(coverageRatio) ? coverageRatio : bboxOccupancy,
          0,
          1,
        ),
      })
    })
  }

  const materializeAifxTemplateSequence = (materializeWorkflow, snapshot, peakFrame, materialType, sequenceSeed) => {
    const result = materializeWorkflow.materialize({
      templateFrames: snapshot.templateFrames,
      materialFrame: peakFrame,
      materialType,
      styleStrength: snapshot.materialStrength,
      contourVariation: snapshot.contourVariation,
      seed: sequenceSeed,
    })
    const frames = result.frames.map((frame, index) => {
      const canvas = createCanvas(frame.width, frame.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      const imageData = context.createImageData(frame.width, frame.height)
      imageData.data.set(frame.data)
      context.putImageData(imageData, 0, 0)
      const name = canonicalAifxFrameName(index)
      return Object.freeze({
        index,
        globalIndex: index,
        timelineIndex: index,
        name,
        fileName: name,
        width: frame.width,
        height: frame.height,
        canvas,
        imageData,
        dataUrl: canvas.toDataURL('image/png'),
        mimeType: 'image/png',
        pixelFormat: 'rgba8',
        alphaMode: 'straight',
        materialType,
        matteMethod: peakFrame.matteMethod,
        shapeSource: 'template-frame-structure-materialization',
        motionConstraint: 'template-frame-structure-grammar',
        templateStructure: frame.structure,
      })
    })
    return Object.freeze({
      ...result,
      status: 'ready',
      frames: Object.freeze(frames),
      shapeSource: 'template-frame-structure-materialization',
      motionConstraint: 'template-frame-structure-grammar',
    })
  }

  const prepareAifxTemplateSheet = async (templateResource, motionGuideResource, snapshot) => {
    const frameCount = snapshot.templateFrames.length
    const plan = templateResource.createSpriteSheetPlan(snapshot.templateFrames, {
      columns: Math.ceil(Math.sqrt(frameCount)),
      gutter: 32,
      padding: 16,
      alignTo: 16,
      fps: snapshot.fps,
      lifecycle: aifxLifecycleForFrames(frameCount, snapshot.templateGuides),
    })
    assertAifxProductionSheetBudget(plan.sheetSize)
    const templateAlphaQuality = snapshot.templateFrames.map((frame) => measureAifxTemplateAlphaQuality(frame.canvas))
    assertAifxLifecycleAlphaQuality(templateAlphaQuality, plan.lifecycle, 'AIFX_TEMPLATE')
    const motionGuide = await motionGuideResource.createGuideFrames(
      snapshot.templateFrames,
      snapshot.templateGuides,
      { maxIntensity: 232 },
      { createCanvas },
    )
    assertAifxGenerationCurrent(snapshot)
    const packed = await templateResource.packFrames(motionGuide.frames, {
      plan,
      background: 'black',
    })
    assertAifxGenerationCurrent(snapshot)
    state.preparedTemplate = { ...packed, motionGuide, templateAlphaQuality }
    return { ...packed, motionGuide, templateAlphaQuality }
  }

  const aifxProgressText = (progress) => {
    const labels = {
      start: '准备生成',
      connect: '连接本地 Runtime',
      inspect: '检查本地模型',
      upload: '上传序列图集与风格参考',
      build: '构建序列图集工作流',
      validate: '校验工作流节点',
      submit: '提交本地生成',
      running: '生成连贯序列帧',
      download: '读取生成图集',
      complete: '图集生成完成',
    }
    const label = labels[progress?.phase] || String(progress?.label || '生成中')
    const percent = Math.max(0, Math.min(100, Math.round((Number(progress?.progress) || 0) * 100)))
    return `${label} · ${percent}%`
  }

  const enforceAifxTemplateAlpha = (canvas, templateCanvas) => {
    const fields = createAifxTemplateMaterialFields(templateCanvas)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = image.data
    for (let index = 0; index < canvas.width * canvas.height; index += 1) {
      const alpha = clamp(fields.hasUsefulAlpha ? fields.alphaMask[index] : fields.presence[index], 0, 1)
      const offset = index * 4
      data[offset + 3] = Math.round(alpha * 255)
      if (alpha <= 0.001) {
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
      }
    }
    ctx.putImageData(image, 0, 0)
    return fields.hasUsefulAlpha ? 'template-alpha' : 'template-luminance-mask'
  }

  const buildAifxGeometryLockedFrames = async (generatedSheet, packed, materialType, templateResource, snapshot) => {
    const plan = packed.plan
    const rawFrames = await templateResource.cutSpriteSheet(generatedSheet, plan, { renameFrames: true })
    const materialBank = await selectAifxMaterialBank(rawFrames, snapshot.styleReference, materialType)
    assertAifxGenerationCurrent(snapshot)
    const frames = []
    const quality = []
    for (let index = 0; index < rawFrames.length; index += 1) {
      const template = snapshot.templateFrames[index]
      const canvas = createCanvas(template.width, template.height)
      const guide = snapshot.templateGuides[index] || analyzeFrame(template.canvas)
      const materialMapping = renderAifxReferencePaletteTexture(
        canvas,
        template.canvas,
        materialBank,
        guide,
        snapshot.styleReference,
        index,
        snapshot.templateFrames.length,
        { materialStrength: snapshot.materialStrength, contourVariation: snapshot.contourVariation, materialType },
      )
      const alphaSource = enforceAifxTemplateAlpha(canvas, template.canvas)
      const frameQuality = {
        ...validateMaterialTransferFrame(canvas, template.canvas, snapshot.styleReference),
        materialSourceIndices: [...new Set([materialMapping.leftSourceIndex, materialMapping.rightSourceIndex])],
        materialBlend: materialMapping.mix,
        materialBankFallback: materialBank.fallback,
      }
      const name = canonicalAifxFrameName(index)
      frames.push({
        index,
        name,
        sourceName: rawFrames[index].sourceName || plan.frameRects[index]?.name || rawFrames[index].name,
        width: template.width,
        height: template.height,
        dataUrl: canvas.toDataURL('image/png'),
        pixelFormat: 'rgba8',
        alphaMode: 'straight',
        matteMethod: 'template-alpha-geometry-lock',
        materialType,
        materialSourceIndices: frameQuality.materialSourceIndices,
        materialBlend: materialMapping.mix,
        alphaSource,
        quality: frameQuality,
      })
      quality.push(frameQuality)
    }
    return {
      frames,
      rawFrames,
      quality,
      materialBank: {
        size: materialBank.candidates.length,
        sourceIndices: materialBank.candidates.map((candidate) => candidate.metrics.sourceIndex),
        scores: materialBank.candidates.map((candidate) => candidate.metrics.score),
        rawCandidateCount: materialBank.rawCandidateCount,
        qualifiedCandidateCount: materialBank.qualifiedCandidateCount,
        selectionPolicy: materialBank.selectionPolicy,
        metrics: materialBank.candidates.map((candidate) => ({
          sourceIndex: candidate.metrics.sourceIndex,
          score: candidate.metrics.score,
          paletteDistance: candidate.metrics.paletteDistance,
          edgeMean: candidate.metrics.edgeMean,
          luminanceStd: candidate.metrics.luminanceStd,
          highLumRatio: candidate.metrics.highLumRatio,
          sourceProgress: candidate.metrics.sourceProgress,
        })),
        fallback: materialBank.fallback,
        warning: materialBank.warning,
      },
    }
  }

  const runAifxProductionPipeline = async () => {
    if (state.isGenerating) return
    if (!state.templateFrames.length) {
      setStatus('需要模板', '请先载入模板序列帧。')
      return
    }
    if (!state.styleReference?.dataUrl) {
      setStatus('需要参考图', '请先载入一张风格参考图。')
      return
    }
    if (state.templateFrames.length < 2) {
      setStatus('需要序列模板', '材质形体演变至少需要 2 帧；单帧不具备 onset / peak / decay 生命周期。')
      return
    }

    const modules = requireAifxPipelineModules()
    const provider = modules.provider.assertRunnable(state.providerState.provider).provider
    const generationController = new AbortController()
    const snapshot = createAifxGenerationSnapshot(provider, generationController)
    state.isGenerating = true
    state.providerState.running = true
    state.providerState.error = ''
    state.generationAbort = generationController
    state.generationToken = snapshot.token
    clearGeneratedState()
    state.previewMode = 'template'
    setStatus('AI 特效生成中', '正在分析模板运动并准备单帧时间锚点。')
    refreshUi()
    drawPreview()

    try {
      const packed = await prepareAifxTemplateSheet(modules.template, modules.motionGuide, snapshot)
      const detected = buildAifxAutoPrompt(snapshot.styleReference)
      const inferredMaterialType = inferAifxMaterialHint(snapshot.styleReference, detected.inferredEffectType)
      const materialType = inferredMaterialType
      const materialDirection = AIFX_MATERIAL_DIRECTIONS[materialType] || AIFX_MATERIAL_DIRECTIONS.energy
      const materialStyle = modules.materialReconstruct.buildReferenceContract({
        materialOnly: buildAifxMaterialOnlyStyleContract(detected, materialType, materialDirection, snapshot.styleReference),
      })
      const localControl = aifxLocalControlProfile(materialType, snapshot.materialStrength)
      const autoPrompt = {
        ...detected,
        detectedStyleTags: detected.styleTags,
        inferredEffectType: materialType,
        confidence: detected.confidence,
        positivePrompt: materialStyle.positivePrompt,
        promptSupplement: snapshot.promptSupplement,
        styleDescription: materialStyle.styleDescription,
        styleTags: materialStyle.styleTags,
        styleReferenceRole: materialStyle.styleReferenceRole,
        referenceTopologyUsed: materialStyle.referenceTopologyUsed,
        detectedPromptUsed: materialStyle.detectedPromptUsed,
      }
      const plan = packed.plan
      const sequencePlan = buildAifxSequencePlan(snapshot, plan.lifecycle, packed.templateAlphaQuality)
      const compiled = modules.prompt.compile({
        provider,
        frameCount: plan.frameCount,
        rows: plan.rows,
        columns: plan.columns,
        cellWidth: plan.frameSize.width,
        cellHeight: plan.frameSize.height,
        gutter: plan.gutter,
        canvasWidth: plan.sheetSize.width,
        canvasHeight: plan.sheetSize.height,
        padding: plan.padding,
        trailingRight: plan.trailingPadding?.right || 0,
        trailingBottom: plan.trailingPadding?.bottom || 0,
        styleStrength: snapshot.materialStrength,
        materialPrompt: autoPrompt.positivePrompt,
        promptSupplement: snapshot.promptSupplement,
        styleDescription: autoPrompt.styleDescription,
        materialType,
        sequencePlan,
      })
      const normalizedSequencePlan = compiled.sequencePlan
      state.autoPrompt = { ...autoPrompt, compiled }
      window.__AIFX_LAST_AUTO_PROMPT__ = state.autoPrompt
      window.__AIFX_LAST_TEMPLATE_PLAN__ = plan
      state.spriteSheet = { inputCanvas: packed.canvas, outputCanvas: null, plan }
      state.previewMode = 'sheet'
      setStatus(
        'AI 特效生成中',
        `已识别为 ${materialType}，正在运行本地模型。`,
      )
      drawPreview()

      const initialSequenceSeed = Math.floor(Date.now() % 2147483647)
      const morphology = await modules.materialReconstruct.runAnchorPipeline({
        provider,
        sequencePlan: normalizedSequencePlan,
        packed,
        fps: snapshot.fps,
        lifecycle: plan.lifecycle,
        materialType,
        styleReference: snapshot.styleReference,
        styleStrength: snapshot.materialStrength,
        materialPrompt: autoPrompt.positivePrompt,
        promptSupplement: snapshot.promptSupplement,
        styleDescription: autoPrompt.styleDescription,
        localControl,
        signal: snapshot.signal,
        templateFrames: snapshot.templateFrames,
        initialSequenceSeed,
        maximumAnchorAttempts: 3,
      }, {
        templateResource: modules.template,
        promptWorkflow: modules.prompt,
        generateWorkflow: modules.generate,
        postprocessWorkflow: modules.postprocess,
        temporalConformWorkflow: modules.temporalConform,
        qualityWorkflow: modules.quality,
        materialIdentityResource: modules.materialIdentity,
        createCanvas,
        imageFromUrl,
        dataUrlToFrame,
        assertCurrent: () => assertAifxGenerationCurrent(snapshot),
        assertSheetBudget: assertAifxProductionSheetBudget,
        removeIsolatedCoreObjects: removeAifxIsolatedCoreObjects,
        fitClippedAnchorToSafeMargin: fitAifxClippedAnchorToSafeMargin,
        assertAnchorMaterialReadable: assertAifxAnchorMaterialReadable,
        validateFrame,
        assertLifecycleAlphaQuality: assertAifxLifecycleAlphaQuality,
        canonicalFrameName: canonicalAifxFrameName,
        backgroundRemoval: window.NovaFlowBackgroundRemoval,
        rmbg: window.NovaFlowAifxRmbgBridge,
        onStatus: setStatus,
        onProgress({ progress, anchorSpec, anchorPosition, anchorCount }) {
          if (state.generationToken !== snapshot.token || snapshot.signal.aborted) return
          state.providerState.status = `${anchorSpec.role}:${progress?.phase || ''}`
          const localProgress = Math.max(0, Math.min(1, Number(progress?.progress) || 0))
          const overall = Math.round(((anchorPosition + localProgress) / anchorCount) * 58)
          setStatus('AI 特效生成中', `材质形体锚点 · ${overall}%`)
        },
      })
      const finalProduct = await modules.export.buildFinalProduct(morphology.exportInput)
      assertAifxGenerationCurrent(snapshot)
      const pipelineResult = modules.materialReconstruct.buildPipelineResult(morphology, {
        finalProduct,
        lifecycle: plan.lifecycle,
        autoPrompt,
        compiled,
        localControl,
      })
      const { runtimeFrames, rawSequenceQuality, sequenceQuality, temporalCorrection } = morphology
      window.__AIFX_LAST_RAW_SEQUENCE_QUALITY__ = rawSequenceQuality
      window.__AIFX_LAST_SEQUENCE_QUALITY__ = sequenceQuality
      window.__AIFX_LAST_TEMPORAL_CORRECTION__ = temporalCorrection
      window.__AIFX_LAST_TEMPLATE_MATERIALIZATION__ = null
      state.generatedFrames = runtimeFrames
      state.candidates = [pipelineResult.candidateRecord]
      state.selectedIndex = 0
      state.bestIndex = 0
      state.finalProduct = finalProduct
      state.lastGeneration = pipelineResult.lastGeneration
      state.lastPipelineSummary = pipelineResult.pipelineSummary
      window.__AIFX_LAST_PIPELINE_SUMMARY__ = state.lastPipelineSummary
      window.__NOVA_AIFX_LAST_PRODUCT = finalProduct
      state.activeFrameIndex = 0
      state.previewMode = 'result'
      setStatus('成品已生成', `${runtimeFrames.length} 帧 · ${runtimeFrames[0].width} × ${runtimeFrames[0].height} · RGBA · 已生成 atlas.png 与清单`)
      refreshUi()
      drawPreview()
    } finally {
      if (state.generationAbort === generationController) {
        state.isGenerating = false
        state.providerState.running = false
        state.generationAbort = null
        state.generationToken = null
        refreshUi()
      }
    }
  }

  const runAifxSpritesheetConditionedRegenPipelineSequence = async () => {
    if (state.isGenerating) return
    if (!state.templateFrames.length) {
      setStatus('需要模板', '请先载入模板序列帧。')
      return
    }
    if (!state.styleReference?.dataUrl) {
      setStatus('需要参考图', '请先拖入一张风格参考图。')
      return
    }

    state.isGenerating = true
    clearGeneratedState()
    state.previewMode = 'template'
    const autoPrompt = buildAifxAutoPrompt(state.styleReference)
    state.autoPrompt = autoPrompt
    window.__AIFX_LAST_AUTO_PROMPT__ = autoPrompt
    setStatus('AI 特效生成中', `识别为：${autoPrompt.inferredEffectType}；正在生成 ${AIFX_CANDIDATE_COUNT} 个候选。`)
    refreshUi()
    drawPreview()
    try {
      const data = await callAifxSpritesheetConditionedRegenPipeline(autoPrompt)
      const candidates = []
      for (const candidate of data.candidates || []) {
        const frames = await candidateResponseToFrames(candidate)
        candidates.push({
          id: candidate.id,
          seed: candidate.seed,
          promptVariant: candidate.promptVariant || candidate.promptVariantName || '',
          promptVariantName: candidate.promptVariantName,
          outputPath: candidate.outputPath || '',
          score: candidate.score ?? null,
          positivePrompt: candidate.positivePrompt,
          negativePrompt: candidate.negativePrompt,
          inferredEffectType: candidate.inferredEffectType,
          style_semantic_match: candidate.style_semantic_match,
          usable: candidate.usable,
          metrics: candidate.metrics || {},
          frames,
          previewFrame: candidate.previewFrame || frames[0]?.dataUrl || '',
        })
      }
      if (!candidates.length) throw new Error('pipeline 没有返回候选结果')
      state.candidates = candidates
      const bestId = data.bestCandidateIndex ?? data.summary?.bestCandidateId
      const bestIndex = candidates.findIndex((candidate) => String(candidate.id) === String(bestId))
      state.bestIndex = bestIndex >= 0 ? bestIndex : 0
      state.selectedIndex = state.bestIndex
      state.lastPipelineSummary = data.summary || null
      window.__AIFX_LAST_PIPELINE_SUMMARY__ = data.summary || data
      syncSelectedCandidateFrames()
      state.activeFrameIndex = 0
      state.previewMode = 'result'
      const best = state.candidates[state.selectedIndex]
      setStatus('已生成', `AI 已生成 ${state.candidates.length} 个特效方案，请选择一个；当前候选 ${state.selectedIndex + 1}，seed ${best?.seed || '-'}`)
      refreshUi()
      drawPreview()
    } finally {
      state.isGenerating = false
      refreshUi()
    }
  }

  const generateReferenceGuidedSequence = async () => {
    if (!state.templateFrames.length) {
      setStatus('需要模板', '请先载入自定义模板，或手动点击“载入内置模板”。')
      return
    }
    if (!state.templateFrames.length) throw new Error('没有模板序列')

    if (!state.styleReference?.dataUrl) {
    setStatus('需要参考图', '请先拖入一张风格参考图，Runtime 风格迁移必须有参考素材。')
      return
    }

    setStatus('NovaFlow AI Runtime 风格迁移中', '正在检查 Runtime 节点并上传参考图。')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await requireComfyStyleNodes()

    const frameCount = state.templateFrames.length
    const sessionPrefix = `nf_styletransfer/${Date.now()}`
    const styleImageName = await uploadComfyImage(state.styleReference.comfyDataUrl || state.styleReference.dataUrl, `nfst_style_${Date.now()}.png`)
    const generated = []

    for (let index = 0; index < frameCount; index += 1) {
      state.status = 'NovaFlow AI Runtime 风格迁移中'
      state.detail = `上传并迁移第 ${index + 1} / ${frameCount} 帧`
      refreshUi()
      const frame = await runComfyStyleTransferFrame(state.templateFrames[index], styleImageName, index, sessionPrefix)
      const quality = frame.quality || validateFrame(frame.canvas)
      if (quality.alphaPixels < 1) {
        console.warn(`[AIFX MVP] 第 ${index + 1} 帧 Runtime 风格迁移结果较暗，保留该帧继续输出。`)
      }
      generated.push(frame)
      state.generatedFrames = generated.slice()
      state.activeFrameIndex = index
      state.detail = `已完成 ${index + 1} / ${frameCount} 帧`
      refreshUi()
      drawPreview()
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    state.generatedFrames = generated
    state.activeFrameIndex = 0
    setStatus('已生成', `${generated.length} 帧 · ${generated[0].width} x ${generated[0].height}`)
    drawPreview()
  }

  const dataUrlToBytes = async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob()
    return new Uint8Array(await blob.arrayBuffer())
  }

 const writeTextAsBinary = async (dir, fileName, text) => {
   const bytes = new TextEncoder().encode(text)
   const result = await window.electronAPI.writeBinaryFile({ dir, fileName, bytes })
    if (result?.ok !== true) throw new Error(String(result?.error || `${fileName} 写入失败`))
   return result
 }

  const downloadBrowserFinalProductZip = (product, options = {}) => {
    const exportWorkflow = window.NovaFlowAifxExportWorkflow
    if (!exportWorkflow || typeof exportWorkflow.buildBrowserZip !== 'function') {
      throw new Error('AIFX 浏览器 ZIP 导出模块不可用')
    }
    if (typeof Blob !== 'function' || typeof window.URL?.createObjectURL !== 'function') {
      throw new Error('当前浏览器无法创建 AIFX ZIP 下载')
    }
    const exportName = sanitizeAifxExportName(options.name, '')
    const archive = exportWorkflow.buildBrowserZip(product, {
      fileName: `${exportName || 'NovaFlow_AIFX_Final'}.zip`,
    })
    const blob = new Blob([archive.bytes], { type: archive.mimeType })
    const objectUrl = window.URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = archive.name
      ;(state.refs.root || document.body).appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000)
    }
    return archive
  }

  const exportPngSequence = async (options = {}) => {
    syncSelectedCandidateFrames()
    if (!state.generatedFrames.length || !state.finalProduct?.files) throw new Error('请先生成最终成品')
    const product = state.finalProduct
    const exportName = sanitizeAifxExportName(options.name, '')
    setStatus('导出中', '正在写入 RGBA 序列、atlas.png、atlas.json 与生成清单。')
    const api = window.electronAPI
    if (api?.pickDirectory && api?.writeBinaryFile) {
      const pick = await api.pickDirectory()
      if (pick?.canceled) {
        setStatus('已取消', '未导出文件。')
        return
      }
      const parentDir = String(pick?.dir || pick?.path || pick?.filePath || '').trim()
      if (!parentDir) throw new Error('未选择导出目录')
      const assetDir = buildAifxExportSessionDir(parentDir, exportName || 'NovaFlow_AIFX')
      const frameDir = `${assetDir}\\frames`
     for (const frame of product.files.frames) {
       const bytes = await dataUrlToBytes(frame.dataUrl)
       const fileName = String(frame.name || '').replace(/^frames[\\/]/, '')
       const result = await api.writeBinaryFile({ dir: frameDir, fileName, bytes })
        if (result?.ok !== true) throw new Error(String(result?.error || '写入失败'))
     }
     const atlasBytes = await dataUrlToBytes(product.files.atlas.dataUrl)
      const atlasResult = await api.writeBinaryFile({ dir: assetDir, fileName: product.files.atlas.name, bytes: atlasBytes })
      if (atlasResult?.ok !== true) throw new Error(String(atlasResult?.error || 'atlas.png 写入失败'))
      await writeTextAsBinary(assetDir, product.files.atlasMetadata.name, product.files.atlasMetadata.text)
      await writeTextAsBinary(assetDir, product.files.generationManifest.name, product.files.generationManifest.text)
      state.lastExportDir = assetDir
      setStatus('最终成品已导出', assetDir)
      return
    }

    const archive = downloadBrowserFinalProductZip(product, { name: exportName })
    setStatus('最终成品已导出', `浏览器已下载单个 ZIP：${archive.entryCount} 个完整文件。`)
  }

  const applyToProject = async () => {
    syncSelectedCandidateFrames()
    if (!state.generatedFrames.length || !state.finalProduct) throw new Error('请先生成最终成品')
    const bridge = window.NovaFlowAifxProjectBridge
    if (!bridge || typeof bridge.commitRgbaSequence !== 'function') {
      const error = new Error('当前主编辑器尚未提供粒子序列写入桥；请先使用“导出最终成品”。')
      error.code = 'AIFX_PROJECT_BRIDGE_UNAVAILABLE'
      throw error
    }
    const payload = {
      protocol: 'novaflow.aifx.rgba-sequence/v1',
      assetId: `aifx_${Date.now().toString(36)}`,
      name: `${state.templateName || 'AI特效'}_${state.lastGeneration?.materialType || 'effect'}`,
      target: 'active-particle-system',
      pipeline: PIPELINE_ID,
      source: RUNTIME_SOURCE,
      width: state.generatedFrames[0].width,
      height: state.generatedFrames[0].height,
      fps: state.fps,
      frames: state.generatedFrames.map((frame) => ({
        index: frame.index,
        fileName: frame.fileName,
          dataUrl: frame.dataUrl,
      })),
      atlas: {
        dataUrl: state.finalProduct.files.atlas.dataUrl,
        metadata: state.finalProduct.atlasJson,
        manifest: state.finalProduct.manifest,
      },
      generation: state.lastPipelineSummary,
    }
    const receipt = await bridge.commitRgbaSequence(payload)
    if (!receipt?.ok) throw new Error(String(receipt?.error || '主编辑器没有确认粒子序列写入。'))
    window.__NOVA_AIFX_LAST_SEQUENCE = { ...payload, receipt }
    window.dispatchEvent(new CustomEvent('novaflow:aifx-sequence-ready', { detail: window.__NOVA_AIFX_LAST_SEQUENCE }))
    setStatus('已应用到工程', `${payload.frames.length} 帧 · ${payload.fps} FPS · ${receipt.assetId || payload.assetId}`)
    return receipt
  }

  const exportSpineProject = async (options = {}) => {
    syncSelectedCandidateFrames()
    if (!state.generatedFrames.length || !state.finalProduct?.files?.atlas) throw new Error('请先生成最终成品')
    const exportName = sanitizeAifxExportName(options.name, '')
    const api = window.electronAPI
    if (!api?.pickDirectory || !api?.writeBinaryFile) {
      throw new Error('Spine 工程导出需要桌面版文件写入能力')
    }
    setStatus('导出中', '正在写入 Spine 工程。')
    const pick = await api.pickDirectory()
    if (pick?.canceled) {
      setStatus('已取消', '未导出 Spine 工程。')
      return
    }
    const parentDir = String(pick?.dir || pick?.path || pick?.filePath || '').trim()
    if (!parentDir) throw new Error('未选择导出目录')
    const assetDir = buildAifxExportSessionDir(parentDir, exportName || 'NovaFlow_AIFX_Spine')
   const first = state.generatedFrames[0]
   const base = exportName || 'aifx_conditioned_regen'
   const atlasBytes = await dataUrlToBytes(state.finalProduct.files.atlas.dataUrl)
    const atlasImageResult = await api.writeBinaryFile({ dir: assetDir, fileName: `${base}.png`, bytes: atlasBytes })
    if (atlasImageResult?.ok !== true) throw new Error(String(atlasImageResult?.error || 'Spine 图集写入失败'))
   const atlas = buildSpineAtlas(base, state.finalProduct)
   const json = buildSimpleSpineJson(base, first.width, first.height, state.generatedFrames.length, state.fps)
    await writeTextAsBinary(assetDir, `${base}.atlas`, atlas)
    await writeTextAsBinary(assetDir, `${base}.json`, JSON.stringify(json, null, 2))
    state.lastExportDir = assetDir
    setStatus('已导出 Spine', assetDir)
  }

  const buildSpineAtlas = (base, product) => {
    const atlas = product?.atlasJson
    if (!atlas?.size || !Array.isArray(atlas.sequence) || !atlas.frames) {
      throw new Error('最终成品缺少可逆图集元数据')
    }
    const lines = [
      `${base}.png`,
      `size: ${atlas.size.width},${atlas.size.height}`,
      'format: RGBA8888',
      'filter: Linear,Linear',
      'repeat: none',
    ]
    atlas.sequence.forEach((frameName, index) => {
      const entry = atlas.frames[frameName]
      if (!entry?.rect || !entry?.sourceSize) throw new Error(`图集帧元数据无效：${frameName}`)
      lines.push(
        `${base}_${pad(index)}`,
        '  rotate: false',
        `  xy: ${entry.rect.x}, ${entry.rect.y}`,
        `  size: ${entry.rect.width}, ${entry.rect.height}`,
        `  orig: ${entry.sourceSize.width}, ${entry.sourceSize.height}`,
        '  offset: 0, 0',
        '  index: -1',
      )
    })
    return `${lines.join('\n')}\n`
  }

  const buildSimpleSpineJson = (base, width, height, count, fps) => {
    const attachments = {}
    const timeline = []
    for (let index = 0; index < count; index += 1) {
      const name = `${base}_${pad(index)}`
      attachments[name] = { x: 0, y: 0, width, height }
      timeline.push({ time: index / Math.max(1, fps), name })
    }
    if (count > 0) timeline.push({ time: count / Math.max(1, fps), name: `${base}_${pad(count - 1)}` })
    return {
      skeleton: {
        hash: `aifx-${Date.now().toString(36)}`,
        spine: '4.1',
        fps,
        x: -width / 2,
        y: -height / 2,
        width,
        height,
        images: './',
        audio: '',
      },
      bones: [{ name: 'root' }],
      slots: [{ name: 'effect', bone: 'root', attachment: `${base}_0000`, blend: 'additive' }],
      skins: [{ name: 'default', attachments: { effect: attachments } }],
      animations: { animation: { slots: { effect: { attachment: timeline } } } },
    }
  }

  const setStatus = (status, detail) => {
    state.status = status
    state.detail = detail || ''
    refreshUi()
  }

  const installStyle = () => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${APP_ID} {
        position: fixed;
        top: var(--aifx-shell-top, 58px);
        left: var(--aifx-shell-left, ${HOST_LEFT_FRAME_LEFT}px);
        right: 0;
        bottom: 0;
        z-index: ${AIFX_SHELL_STACK_Z};
        display: none;
        grid-template-columns: var(--aifx-shell-width, ${HOST_LEFT_FRAME_WIDTH}px) minmax(420px, 1fr);
        grid-template-rows: 1fr;
        background: transparent;
        color: #e5edf8;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        pointer-events: none;
      }
      body.novaflow-aifx-open {
        overflow: hidden !important;
        overscroll-behavior: contain !important;
      }
      body.novaflow-aifx-open [data-novaflow-secondary-group="1"] {
        position: relative !important;
        z-index: ${HOST_ENTRY_STACK_Z} !important;
      }
      body.novaflow-aifx-open [data-novaflow-left-content-root="1"] * {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      body.novaflow-aifx-open [data-novaflow-left-content-root="1"] [data-novaflow-secondary-group="1"],
      body.novaflow-aifx-open [data-novaflow-left-content-root="1"] [data-novaflow-secondary-group="1"] * {
        visibility: visible !important;
        pointer-events: auto !important;
      }
      #${APP_ID}.is-open { display: grid; }
      #${APP_ID}.is-open::before {
        content: "";
        position: absolute;
        left: 0;
        top: var(--aifx-shield-offset, var(--aifx-side-offset, 132px));
        bottom: 0;
        width: var(--aifx-shell-width, ${HOST_LEFT_FRAME_WIDTH}px);
        box-sizing: border-box;
        background: ${AIFX_SURFACE_BASE};
        border-right: 0;
        pointer-events: auto;
        z-index: 0;
      }
      #${APP_ID} * { box-sizing: border-box; }
      .aifx-side {
        min-height: 0;
        overflow: auto;
        background: ${AIFX_SURFACE_BASE};
        pointer-events: auto;
      }
      .aifx-side, .aifx-main {
        position: relative;
        z-index: 1;
      }
      .aifx-side {
        grid-column: 1;
        margin-top: var(--aifx-side-offset, 142px);
        height: calc(100% - var(--aifx-side-offset, 142px));
        background: ${AIFX_SURFACE_BASE};
        border-right: none;
        overflow-x: hidden;
        overflow-y: auto;
        pointer-events: auto;
      }
      .aifx-main {
        grid-column: 2;
        min-width: 0;
        min-height: 0;
        position: relative;
        isolation: isolate;
        overflow: hidden;
        background: #000000;
        border-top: 1px solid rgba(148, 163, 184, 0.14);
        pointer-events: auto;
      }
      .aifx-main::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background:
          radial-gradient(120% 62% at 50% 70%, rgba(44, 44, 44, 0.18) 0%, rgba(28, 28, 28, 0.09) 36%, rgba(0, 0, 0, 0) 70%),
          radial-gradient(88% 56% at 50% 42%, rgba(40, 40, 40, 0.12) 0%, rgba(26, 26, 26, 0.08) 34%, rgba(0, 0, 0, 0) 68%),
          linear-gradient(180deg, rgba(10, 10, 10, 1) 0%, rgba(12, 12, 12, 0.995) 20%, rgba(14, 14, 14, 1) 48%, rgba(12, 12, 12, 1) 78%, rgba(9, 9, 9, 1) 100%);
      }
      .aifx-main::after {
        content: "";
        position: absolute;
        left: -10%;
        top: -44%;
        right: -10%;
        bottom: -12%;
        z-index: 1;
        pointer-events: none;
        transform-origin: center bottom;
        transform: perspective(640px) rotateX(34deg);
        opacity: 1;
        background-image:
          linear-gradient(rgba(130, 146, 164, 0.26) 1px, transparent 1px),
          linear-gradient(90deg, rgba(130, 146, 164, 0.26) 1px, transparent 1px),
          linear-gradient(90deg, transparent calc(50% - 1px), rgba(170, 184, 198, 0.34) 50%, transparent calc(50% + 1px));
        background-size: 72px 72px, 72px 72px, 100% 100%;
        background-position: center bottom;
        -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.72) 70%, transparent 100%);
        mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.72) 70%, transparent 100%);
      }
      .aifx-header {
        display: none;
        height: 0;
        align-items: center;
        gap: 12px;
        padding: 0 20px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      }
      .aifx-title { font-size: 15px; font-weight: 900; letter-spacing: 0; }
      .aifx-subtitle { font-size: 12px; color: rgba(226, 232, 240, 0.6); }
      .aifx-close {
        margin-left: auto;
        height: 32px;
        padding: 0 12px;
        border: 0;
        border-radius: 8px;
        background: ${AIFX_SURFACE_ELEVATED};
        color: #e5edf8;
        cursor: pointer;
        font-weight: 800;
      }
      .aifx-panel { padding: 18px 16px; display: grid; gap: 14px; max-height: none; overflow: visible; pointer-events: auto; }
      .aifx-side .aifx-panel {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        gap: ${AIFX_LEFT_PANEL_TOKENS.panelGap};
        min-height: 100%;
        width: var(--aifx-panel-width, ${HOST_LEFT_PANEL_WIDTH}px);
        min-width: var(--aifx-panel-width, ${HOST_LEFT_PANEL_WIDTH}px);
        max-width: var(--aifx-panel-width, ${HOST_LEFT_PANEL_WIDTH}px);
        margin-left: var(--aifx-content-inset, ${HOST_LEFT_CONTENT_INSET}px);
        padding: ${AIFX_LEFT_PANEL_TOKENS.panelGap} 0 28px;
        overflow-x: hidden;
      }
      .aifx-section {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        margin-bottom: ${AIFX_SECTION_GAP}px;
        border: 0 !important;
        border-radius: 0 !important;
        padding: 0;
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
        backdrop-filter: none;
        overflow: visible;
      }
      .aifx-side .aifx-section[data-aifx-section] {
        margin: 0;
        border-radius: ${AIFX_LEFT_PANEL_TOKENS.radius} !important;
        overflow: hidden;
      }
      body.novaflow-aifx-open #${APP_ID} .aifx-side .aifx-section.nf-panel[data-novaflow-editor-panel="1"] {
        border: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      .aifx-section:last-child {
        margin-bottom: 0;
      }
      .aifx-section[data-open="0"] {
        border-color: #0000;
      }
      .aifx-section-header {
        width: 100%;
        box-sizing: border-box;
        height: ${AIFX_LEFT_PANEL_TOKENS.headerHeight};
        min-height: ${AIFX_LEFT_PANEL_TOKENS.headerHeight};
        max-height: ${AIFX_LEFT_PANEL_TOKENS.headerHeight};
        padding: ${AIFX_LEFT_PANEL_TOKENS.headerPadding};
        border: 0 !important;
        border-bottom: none;
        border-radius: ${AIFX_LEFT_PANEL_TOKENS.radius};
        background: ${AIFX_LEFT_PANEL_TOKENS.headerBackground} !important;
        background-color: ${AIFX_LEFT_PANEL_TOKENS.headerBackground} !important;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: ${AIFX_LEFT_PANEL_TOKENS.headerGap};
        cursor: pointer;
        user-select: none;
        text-align: left;
        font-family: inherit;
        font-size: ${AIFX_LEFT_PANEL_TOKENS.headerFontSize};
        font-weight: ${AIFX_LEFT_PANEL_TOKENS.headerFontWeight};
        appearance: none;
      }
      .aifx-section[data-open="1"] .aifx-section-header {
        border-bottom: none;
        border-radius: ${AIFX_LEFT_PANEL_TOKENS.radius} ${AIFX_LEFT_PANEL_TOKENS.radius} 0 0;
      }
      .aifx-section-header:hover {
        background: #3b3b3b !important;
        background-color: #3b3b3b !important;
      }
      .aifx-section-title {
        font-size: 13px;
        font-weight: 700;
        margin: 0;
        color: #e5e7ebd9;
      }
      .aifx-side .aifx-section[data-aifx-section] .aifx-section-title {
        font-size: ${AIFX_LEFT_PANEL_TOKENS.headerFontSize};
        font-weight: ${AIFX_LEFT_PANEL_TOKENS.headerFontWeight};
        color: #fff;
      }
      .aifx-section-title-wrap {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .aifx-section-title-icon {
        width: 18px;
        margin-right: 8px;
        text-align: center;
        font-size: 14px;
        color: #e5e7ebd9;
      }
      .aifx-section-chevron {
        font-size: 12px;
        opacity: 0.7;
        color: #e5e7ebd9;
      }
      .aifx-section-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: ${AIFX_LEFT_PANEL_TOKENS.bodyGap};
        width: 100%;
        min-width: 0;
        max-width: 100%;
        margin: 0;
        padding: ${AIFX_LEFT_PANEL_TOKENS.bodyPadding};
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border-radius: 0;
        box-sizing: border-box;
      }
      .aifx-section-body > * {
        width: 100%;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      .aifx-section[data-open="0"] .aifx-section-body {
        display: none !important;
      }
      .aifx-template-current,
      .aifx-help {
        font-size: 11px;
        line-height: 1.45;
        color: rgba(203, 213, 225, 0.82);
      }
      .aifx-template-current {
        margin-bottom: 8px;
      }
      .aifx-help {
        margin-top: 10px;
      }
      .nf-upload-dropzone {
        position: relative;
        min-height: 120px;
        padding: 16px;
        border: 1px dashed #3A3A3A;
        border-radius: 12px;
        background: #1B1B1B;
        background-image: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        text-align: center;
        color: #E8E8E8;
        cursor: pointer;
        overflow: hidden;
        box-sizing: border-box;
        box-shadow: none;
        transition: background-color 120ms ease-out, border-color 120ms ease-out;
      }
      .nf-upload-dropzone:hover {
        border-color: #21C487;
        background: #242424;
      }
      .nf-upload-dropzone__icon {
        font-size: 24px;
        line-height: 1;
        font-weight: 800;
        color: #E8E8E8;
      }
      .nf-upload-dropzone[aria-disabled="true"] {
        pointer-events: none;
        opacity: 0.48;
        cursor: not-allowed;
      }
      .nf-upload-dropzone__title {
        font-size: 13px;
        line-height: 1.25;
        font-weight: 900;
        color: #E8E8E8;
      }
      .nf-upload-dropzone__hint {
        max-width: calc(100% - 32px);
        font-size: 11px;
        font-weight: 700;
        line-height: 1.35;
        color: #A0A0A0;
      }
      .nf-upload-dropzone:has(img) .nf-upload-dropzone__hint,
      .nf-upload-dropzone:has(img) .nf-upload-dropzone__title {
        display: none;
      }
      .nf-upload-dropzone img {
        max-width: 100%;
        max-height: 130px;
        object-fit: contain;
        display: block;
      }
      .nf-upload-dropzone__meta {
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 8px;
        padding: 5px 8px;
        border-radius: 6px;
        background: #202020;
        font-size: 11px;
        color: #A0A0A0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nf-upload-dropzone__meta:empty { display: none; }
      .aifx-row { display: flex; align-items: center; gap: 8px; }
      .aifx-row:has([data-action="contour"]) { display: none; }
      .aifx-row > label { min-width: 74px; font-size: 12px; color: rgba(226, 232, 240, 0.72); }
      .aifx-prompt-field { display: grid; gap: 6px; margin: 6px 0 12px; }
      .aifx-prompt-field > label { font-size: 12px; color: rgba(226, 232, 240, 0.72); }
      #${APP_ID} .aifx-side textarea.aifx-prompt-input {
        width: 100%;
        min-height: 64px;
        max-height: 140px;
        padding: 9px 10px;
        border: 1px solid #3a3a3a;
        border-radius: 8px;
        background: #1b1b1b;
        color: #e8e8e8;
        font: inherit;
        font-size: 12px;
        line-height: 1.5;
        resize: vertical;
        outline: none;
        box-sizing: border-box;
      }
      #${APP_ID} .aifx-side textarea.aifx-prompt-input:focus { border-color: #21c487; }
      .aifx-prompt-hint { font-size: 10px; line-height: 1.4; color: rgba(203, 213, 225, 0.58); }
      .aifx-slider,
      .aifx-timeline input {
        flex: 1;
        min-width: 0;
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        outline: 0;
        box-shadow: none !important;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        background: linear-gradient(90deg, #20c997 0%, #20c997 var(--aifx-range-pct, 0%), #303030 var(--aifx-range-pct, 0%), #303030 100%);
      }
      .aifx-slider::-webkit-slider-runnable-track,
      .aifx-timeline input::-webkit-slider-runnable-track {
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        background: transparent;
        box-shadow: none !important;
      }
      .aifx-slider::-webkit-slider-thumb,
      .aifx-timeline input::-webkit-slider-thumb {
        width: 12px;
        height: 12px;
        margin-top: -4px;
        border: 0 !important;
        border-radius: 999px;
        background: #dce3ea;
        box-shadow: none !important;
        -webkit-appearance: none;
        appearance: none;
      }
      .aifx-slider::-moz-range-track,
      .aifx-timeline input::-moz-range-track {
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        background: #303030;
        box-shadow: none !important;
      }
      .aifx-slider::-moz-range-progress,
      .aifx-timeline input::-moz-range-progress {
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        background: #20c997;
      }
      .aifx-slider::-moz-range-thumb,
      .aifx-timeline input::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border: 0 !important;
        border-radius: 999px;
        background: #dce3ea;
        box-shadow: none !important;
      }
      .aifx-value {
        width: 30px;
        min-height: 20px;
        border: 0;
        border-radius: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        font-size: 12px;
        color: rgba(238, 244, 252, 0.96);
        background: transparent;
      }
      .aifx-primary, .aifx-button {
        height: 36px;
        border: 0;
        border-radius: 8px;
        background: ${AIFX_ACCENT};
        color: white;
        cursor: pointer;
        font-weight: 900;
      }
      .aifx-button {
        background: ${AIFX_SURFACE_ELEVATED};
        border-color: transparent;
      }
      .aifx-timeline .aifx-icon-button {
        width: 36px;
        height: 36px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
      }
      .aifx-button:disabled, .aifx-primary:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      .aifx-preview-wrap {
        position: absolute;
        left: 0;
        top: 0;
        right: 0;
        bottom: 0;
        min-width: 0;
        min-height: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        overflow: hidden;
        background: transparent;
      }
      .aifx-preview-grid {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        display: none;
        pointer-events: none;
        background: transparent;
      }
      .aifx-preview-canvas {
        position: relative;
        z-index: 3;
        width: 100%;
        height: 100%;
        display: block;
        background: transparent;
      }
      .aifx-mode {
        position: absolute;
        top: 18px;
        right: 18px;
        z-index: 4;
        display: flex;
        gap: 6px;
        padding: 0;
        border-radius: 8px;
        background: transparent;
        border: 0;
      }
      .aifx-mode button {
        height: 34px;
        min-height: 34px;
        max-height: 34px;
        min-width: 58px;
        padding: 0 16px;
        border: 0;
        border-radius: 8px;
        background: #2a2a2a;
        color: #fff;
        cursor: pointer;
        font-weight: 800;
        font-size: 13px;
        letter-spacing: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        box-shadow: none;
      }
      .aifx-mode button.is-active { background: ${AIFX_ACCENT}; border: 0; color: white; }
      .aifx-preview-status {
        position: absolute;
        top: 18px;
        left: 18px;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        min-height: 34px;
        max-width: min(520px, calc(100% - 280px));
        padding: 7px 12px;
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 8px;
        background: rgba(18, 18, 18, 0.62);
        color: rgba(226, 232, 240, 0.64);
        opacity: 0.78;
        pointer-events: none;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      }
      .aifx-preview-status-title {
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.35;
        white-space: nowrap;
      }
      .aifx-preview-status-detail {
        min-width: 0;
        overflow: hidden;
        color: rgba(226, 232, 240, 0.56);
        font-size: 11px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .aifx-preview-status-detail:empty { display: none; }
      .aifx-preview-status[data-tone="working"] {
        border-color: rgba(30, 178, 132, 0.42);
        background: rgba(14, 54, 43, 0.9);
        color: rgba(228, 255, 247, 0.96);
        opacity: 1;
      }
      .aifx-preview-status[data-tone="success"] {
        border-color: rgba(30, 178, 132, 0.26);
        background: rgba(18, 46, 38, 0.82);
        color: rgba(224, 250, 242, 0.9);
        opacity: 0.94;
      }
      .aifx-preview-status[data-tone="warning"] {
        border-color: rgba(245, 190, 73, 0.42);
        background: rgba(61, 46, 17, 0.9);
        color: rgba(255, 241, 202, 0.96);
        opacity: 1;
      }
      .aifx-preview-status[data-tone="error"] {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(69, 22, 22, 0.92);
        color: rgba(255, 226, 226, 0.98);
        opacity: 1;
      }
      .aifx-timeline {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 18px;
        z-index: 5;
        margin: 0;
        border: 0;
        border-radius: 8px;
        padding: 14px 16px;
        background: #181818;
        display: grid;
        grid-template-columns: auto auto auto minmax(120px, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .aifx-timeline input { width: 100%; }
      @media (max-width: 1280px) {
        #${APP_ID} {
          grid-template-columns: var(--aifx-shell-width, ${HOST_LEFT_FRAME_WIDTH}px) minmax(360px, 1fr);
        }
      }
      @media (max-width: 900px) {
        .aifx-preview-status {
          top: 62px;
          right: 18px;
          max-width: none;
        }
      }
      .aifx-hidden { display: none !important; }
    `
    document.head.appendChild(style)
  }

  const mount = () => {
    uiTraceCurrent('AifxRuntimeOverlayMount', { phase: 'mount' })
    installStyle()
    let root = document.getElementById(APP_ID)
    if (!root) {
      root = document.createElement('div')
      root.id = APP_ID
      root.innerHTML = `
        <aside class="aifx-side">
          <div class="aifx-panel">
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="mode" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="mode" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-magic aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">模式</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="mode" hidden>
                <div data-aifx-provider-host style="display:grid; gap:8px"></div>
              </div>
            </div>
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="template" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="template" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-layer-group aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">自定义模板</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="template" hidden>
                <div class="nf-upload-dropzone nf-upload-dropzone--medium" data-nf-upload-dropzone="1" data-action="pick-template">
                  <span class="nf-upload-dropzone__icon" data-template-empty>+</span>
                  <div class="nf-upload-dropzone__title">上传素材</div>
                  <div class="nf-upload-dropzone__hint">点击选择，或直接把素材拖到这里</div>
                  <div class="nf-upload-dropzone__meta" data-template-meta></div>
                </div>
                <div class="aifx-help">内置模板可先用下方按钮载入；导入模板只在当前 AI 特效内生效。</div>
                <div class="aifx-row" style="margin-top:10px">
                  <button class="aifx-button" data-action="load-builtin" type="button" style="flex:1">载入内置模板</button>
                  <button class="aifx-button" data-action="clear-template" type="button">清空</button>
                </div>
              </div>
            </div>
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="generate" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="generate" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-magic aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">生成控制</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="generate" hidden>
                <div class="nf-upload-dropzone nf-upload-dropzone--medium" data-nf-upload-dropzone="1" data-action="pick-style">
                  <span class="nf-upload-dropzone__icon" data-style-empty>+</span>
                  <div class="nf-upload-dropzone__title">参考图</div>
                  <div class="nf-upload-dropzone__hint">点击选择，或直接把素材拖到这里</div>
                  <div class="nf-upload-dropzone__meta" data-style-meta></div>
                </div>
                <div class="aifx-prompt-field">
                  <label for="novaflow-aifx-prompt-supplement">提示词补充</label>
                  <textarea id="novaflow-aifx-prompt-supplement" class="aifx-prompt-input" data-action="prompt-supplement" rows="3" maxlength="400" placeholder="补充材质、颜色、光效、纹理或粒子细节（可选）"></textarea>
                  <div class="aifx-prompt-hint">只补充视觉细节，不改变模板结构与生命周期。</div>
                </div>
                <div class="aifx-row">
                  <label>材质强度</label>
                  <input class="aifx-slider" data-action="material" type="range" min="0" max="100" value="86">
                  <div class="aifx-value" data-material-value>86</div>
                </div>
                <div class="aifx-row" style="margin-top:12px">
                  <label>纹理细节</label>
                  <input class="aifx-slider" data-action="contour" type="range" min="0" max="100" value="32">
                  <div class="aifx-value" data-contour-value>32</div>
                </div>
                <div class="aifx-help" data-effect-type>AI 会自动识别参考图类型。</div>
                <button class="aifx-primary" data-action="generate" type="button" style="width:100%; margin-top:14px">生成特效</button>
              </div>
            </div>
          </div>
        </aside>
        <main class="aifx-main">
          <header class="aifx-header">
            <div>
              <div class="aifx-title">AI 特效 · 序列图集风格迁移</div>
              <div class="aifx-subtitle">模板锁定生命周期与帧布局，参考图控制材质，自动完成 RGBA、图集与成品清单。</div>
            </div>
            <button class="aifx-close" data-action="close" type="button">返回粒子特效</button>
          </header>
          <section class="aifx-preview-wrap">
            <canvas class="aifx-preview-grid" data-preview-grid></canvas>
            <canvas class="aifx-preview-canvas" data-preview></canvas>
            <div class="aifx-preview-status" data-preview-status data-tone="idle" role="status" aria-live="polite" aria-atomic="true">
              <span class="aifx-preview-status-title" data-preview-status-title>等待输入</span>
              <span class="aifx-preview-status-detail" data-preview-status-detail>载入模板和参考图后生成。</span>
            </div>
            <div class="aifx-mode">
              <button data-mode="template" type="button">模板</button>
              <button data-mode="result" type="button" class="is-active">结果</button>
              <button data-mode="compare" type="button">对比</button>
            </div>
          </section>
          <section class="aifx-timeline">
            <button class="aifx-button aifx-icon-button" data-action="prev" type="button" title="上一帧" aria-label="上一帧"><i class="fas fa-step-backward" aria-hidden="true"></i></button>
            <button class="aifx-button aifx-icon-button" data-action="play" type="button" title="播放" aria-label="播放"><i class="fas fa-play" aria-hidden="true"></i></button>
            <button class="aifx-button aifx-icon-button" data-action="next" type="button" title="下一帧" aria-label="下一帧"><i class="fas fa-step-forward" aria-hidden="true"></i></button>
            <input data-action="timeline" type="range" min="0" max="0" value="0">
            <div data-frame-label>0 / 0</div>
          </section>
        </main>
        <input class="aifx-hidden" data-template-input type="file" accept="image/*" multiple>
        <input class="aifx-hidden" data-style-input type="file" accept="image/*">
      `
      document.body.appendChild(root)
      wireUi(root)
    }
    state.mounted = true
    state.refs.root = root
    return root
  }

  const updateShellInset = (trigger) => {
    let top = 58
    let shellLeft = HOST_LEFT_FRAME_LEFT
    let shellWidth = HOST_LEFT_FRAME_WIDTH
    let contentInset = HOST_LEFT_CONTENT_INSET
    let sideOffset = 142
    let hasSecondaryEntryMetrics = false

    const leftColumn =
      document.querySelector('[data-novaflow-left-column="1"]') ||
      document.querySelector('.novaflow-app .nf-app-body > div:first-child')
    const hostShell =
      document.querySelector('[data-novaflow-left-content-shell="1"]') ||
      document.querySelector('[data-novaflow-left-content-root="1"]')
    const columnRect = leftColumn instanceof HTMLElement ? leftColumn.getBoundingClientRect() : null
    const shellRect = hostShell instanceof HTMLElement ? hostShell.getBoundingClientRect() : null
    if (columnRect && Number.isFinite(columnRect.left) && Number.isFinite(columnRect.right) && columnRect.width > 240) {
      const columnPaddingLeft = leftColumn instanceof HTMLElement ? Number.parseFloat(getComputedStyle(leftColumn).paddingLeft || '0') : 0
      const railWidth = Number.isFinite(columnPaddingLeft) && columnPaddingLeft > HOST_LEFT_CONTENT_INSET
        ? Math.max(0, Math.round(columnPaddingLeft - HOST_LEFT_CONTENT_INSET))
        : HOST_LEFT_FRAME_LEFT
      shellLeft = Math.max(0, Math.round(columnRect.left + railWidth))
      shellWidth = Math.max(240, Math.round(columnRect.right - shellLeft))
    } else if (shellRect && Number.isFinite(shellRect.left) && Number.isFinite(shellRect.width) && shellRect.width > 240) {
      shellLeft = Math.max(0, Math.round(shellRect.left - HOST_LEFT_CONTENT_INSET))
      shellWidth = Math.max(240, Math.round(shellRect.width + HOST_LEFT_CONTENT_INSET * 2))
    }
    if (shellRect && Number.isFinite(shellRect.left)) {
      contentInset = Math.max(0, Math.round(shellRect.left - shellLeft))
    }

    const topCandidate = Array.from(document.body.children)
      .map((element) => (element instanceof HTMLElement ? element.getBoundingClientRect() : null))
      .find((rect) => rect && rect.top <= 2 && rect.height >= 40 && rect.height <= 90)
    if (topCandidate) {
      top = Math.max(50, Math.min(90, Math.round(topCandidate.height)))
    }

    const secondaryEntries = [findButtonsByText(isParticleEffectLabel)[0], findButtonsByText(isAiEffectLabel)[0]]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => Number.isFinite(rect.left) && Number.isFinite(rect.right) && rect.width > 20)
    if (secondaryEntries.length) {
      hasSecondaryEntryMetrics = true
      const bottom = Math.max(...secondaryEntries.map((rect) => rect.bottom))
      if (Number.isFinite(bottom)) sideOffset = Math.max(0, Math.round(bottom - top))
    }

    const source =
      trigger instanceof Element && trigger !== document.body && trigger !== document.documentElement
        ? trigger
        : findButtonsByText(isAiEffectLabel)[0]
    if (!hasSecondaryEntryMetrics && source instanceof Element) {
      const rect = source.getBoundingClientRect()
      if (Number.isFinite(rect.bottom)) sideOffset = Math.max(88, Math.round(rect.bottom - top))
    }
    if (!hasSecondaryEntryMetrics && source instanceof Element) {
      const rect = source.getBoundingClientRect()
      if (Number.isFinite(rect.bottom)) sideOffset = Math.max(88, Math.round(rect.bottom - top))
    }

    const shellRight = shellLeft + shellWidth
    state.shellInset = { top, shellLeft, shellWidth, shellRight, sideOffset }
    const panelWidth = Math.max(240, Math.min(HOST_LEFT_PANEL_WIDTH, shellWidth))
    const root = state.refs.root
    if (root instanceof HTMLElement) {
      root.style.setProperty('--aifx-shell-top', `${top}px`)
      root.style.setProperty('--aifx-shell-left', `${shellLeft}px`)
      root.style.setProperty('--aifx-shell-width', `${shellWidth}px`)
      root.style.setProperty('--aifx-panel-width', `${panelWidth}px`)
      root.style.setProperty('--aifx-content-inset', `${contentInset}px`)
      root.style.setProperty('--aifx-side-offset', `${sideOffset}px`)
      root.style.setProperty('--aifx-shield-offset', `${sideOffset}px`)
    }
  }

  const syncSectionOpen = (root = state.refs.root) => {
    if (!(root instanceof HTMLElement)) return
    for (const section of Array.from(root.querySelectorAll('[data-aifx-section]'))) {
      if (!(section instanceof HTMLElement)) continue
      const key = section.getAttribute('data-aifx-section') || ''
      const open = state.sectionOpen?.[key] === true
      const toggle = section.querySelector('[data-section-toggle]')
      const chevron = section.querySelector('[data-section-chevron]')
      const body = section.querySelector('[data-section-body]')
      if (body instanceof HTMLElement) body.hidden = !open
      if (AIFX_LEFT_PANEL_ACCORDION?.syncExpanded) {
        AIFX_LEFT_PANEL_ACCORDION.syncExpanded(section, toggle, body, chevron, open)
        if (chevron instanceof HTMLElement) chevron.classList.add('aifx-section-chevron')
        continue
      }
      section.setAttribute('data-open', open ? '1' : '0')
      if (toggle instanceof HTMLElement) toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
      if (chevron instanceof HTMLElement) {
        chevron.classList.toggle('fa-chevron-down', open)
        chevron.classList.toggle('fa-chevron-right', !open)
      }
      if (body instanceof HTMLElement) {
        if (open) body.style.removeProperty('display')
        else body.style.setProperty('display', 'none', 'important')
      }
    }
  }

  const wireUi = (root) => {
    const refs = state.refs
    refs.main = root.querySelector('.aifx-main')
    refs.previewWrap = root.querySelector('.aifx-preview-wrap')
    refs.previewGrid = root.querySelector('[data-preview-grid]')
    refs.previewFrame = root.querySelector('[data-preview-frame]')
    refs.timelinePanel = root.querySelector('.aifx-timeline')
    refs.preview = root.querySelector('[data-preview]')
    refs.previewStatus = root.querySelector('[data-preview-status]')
    refs.previewStatusTitle = root.querySelector('[data-preview-status-title]')
    refs.previewStatusDetail = root.querySelector('[data-preview-status-detail]')
    refs.templateInput = root.querySelector('[data-template-input]')
    refs.styleInput = root.querySelector('[data-style-input]')
    refs.templateCurrent = root.querySelector('[data-template-current]')
    refs.templateMeta = root.querySelector('[data-template-meta]')
    refs.templateEmpty = root.querySelector('[data-template-empty]')
    refs.styleMeta = root.querySelector('[data-style-meta]')
    refs.styleEmpty = root.querySelector('[data-style-empty]')
    refs.effectType = root.querySelector('[data-effect-type]')
    refs.providerHost = root.querySelector('[data-aifx-provider-host]')
    refs.frameLabel = root.querySelector('[data-frame-label]')
    refs.timeline = root.querySelector('[data-action="timeline"]')
    refs.play = root.querySelector('[data-action="play"]')
    refs.promptSupplement = root.querySelector('[data-action="prompt-supplement"]')
    refs.material = root.querySelector('[data-action="material"]')
    refs.contour = root.querySelector('[data-action="contour"]')
    refs.materialValue = root.querySelector('[data-material-value]')
    refs.contourValue = root.querySelector('[data-contour-value]')
    refs.generate = root.querySelector('[data-action="generate"]')
    if (refs.material) {
      const label = refs.material.closest('.aifx-row')?.querySelector('label')
      if (label) label.textContent = '风格强度'
    }
    if (refs.generate) refs.generate.textContent = '生成特效'
    if (refs.providerHost && window.NovaFlowAifxProviderTool?.syncControlPanel) {
      window.NovaFlowAifxProviderTool.syncControlPanel({
        host: refs.providerHost,
        state: state.providerState,
        onChange() {
          clearGeneratedState()
          refreshUi()
          drawPreview()
        },
      })
    }
    syncSectionOpen(root)

    for (const toggle of Array.from(root.querySelectorAll('[data-section-toggle]'))) {
      toggle.addEventListener('click', () => {
        const key = toggle.getAttribute('data-section-toggle') || ''
        if (!key) return
        state.sectionOpen[key] = state.sectionOpen[key] === false
        syncSectionOpen(root)
      })
    }

    root.querySelector('[data-action="pick-template"]').addEventListener('click', () => {
      if (!state.isGenerating) refs.templateInput.click()
    })
    root.querySelector('[data-action="pick-style"]').addEventListener('click', () => {
      if (!state.isGenerating) refs.styleInput.click()
    })
    refs.templateInput.addEventListener('change', async (event) => runTask(async () => {
      if (state.isGenerating) return
      const frames = await readTemplateFiles(event.currentTarget.files)
      event.currentTarget.value = ''
      setTemplateFrames(frames, '模板已载入', '自定义模板')
    }))
    refs.styleInput.addEventListener('change', async (event) => runTask(async () => {
      if (state.isGenerating) return
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      await readStyleFile(file)
    }))

    root.querySelector('[data-action="load-builtin"]').addEventListener('click', () => {
      if (!state.isGenerating) runTask(loadBuiltinTemplate)
    })
    root.querySelector('[data-action="clear-template"]').addEventListener('click', () => {
      if (state.isGenerating) return
      state.templateFrames = []
      state.templateGuides = []
      state.templateName = ''
      clearGeneratedState()
      state.activeFrameIndex = 0
      setStatus('模板已清空', '')
      drawPreview()
    })
    refs.material.addEventListener('input', (event) => {
      if (state.isGenerating) return
      state.materialStrength = Number(event.currentTarget.value) || 0
      state.providerState.styleStrength = state.materialStrength
      clearGeneratedState()
      refreshUi()
      drawPreview()
    })
    refs.contour.addEventListener('input', (event) => {
      if (state.isGenerating) return
      state.contourVariation = Number(event.currentTarget.value) || 0
      clearGeneratedState()
      refreshUi()
      drawPreview()
    })
    refs.promptSupplement?.addEventListener('input', (event) => {
      if (state.isGenerating) return
      state.promptSupplement = String(event.currentTarget.value || '').slice(0, 400)
      state.autoPrompt = null
      window.__AIFX_LAST_AUTO_PROMPT__ = null
      clearGeneratedState()
      refreshUi()
      drawPreview()
    })
    root.querySelector('[data-action="generate"]').addEventListener('click', () => runTask(runAifxProductionPipeline))
    root.querySelector('[data-action="close"]').addEventListener('click', closeApp)
    root.querySelector('[data-action="prev"]').addEventListener('click', () => setFrame(state.activeFrameIndex - 1))
    root.querySelector('[data-action="next"]').addEventListener('click', () => setFrame(state.activeFrameIndex + 1))
    root.querySelector('[data-action="play"]').addEventListener('click', togglePlayback)
    refs.timeline.addEventListener('input', (event) => setFrame(Number(event.currentTarget.value) || 0))
    for (const button of Array.from(root.querySelectorAll('[data-mode]'))) {
      button.addEventListener('click', () => {
        state.previewMode = button.getAttribute('data-mode') || 'result'
        refreshUi()
        drawPreview()
      })
    }

    const wireDrop = (element, handler) => {
      element.addEventListener('dragover', (event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = state.isGenerating ? 'none' : 'copy'
      })
      element.addEventListener('drop', (event) => {
        event.preventDefault()
        if (state.isGenerating) return
        runTask(() => handler(event.dataTransfer.files))
      })
    }
    wireDrop(root.querySelector('[data-action="pick-template"]'), async (files) => {
      setTemplateFrames(await readTemplateFiles(files), '模板已载入', '自定义模板')
    })
    wireDrop(root.querySelector('[data-action="pick-style"]'), async (files) => {
      await readStyleFile(Array.from(files || [])[0])
    })

    window.addEventListener('resize', drawPreview)
  }

  const syncRangeProgress = (input) => {
    if (!(input instanceof HTMLInputElement)) return
    const min = Number(input.min || 0)
    const max = Number(input.max || 100)
    const value = Number(input.value || 0)
    const span = Math.max(1, max - min)
    const pct = clamp(((value - min) / span) * 100, 0, 100)
    input.style.setProperty('--aifx-range-pct', `${pct}%`)
  }

  const syncAllRangeProgress = (root = state.refs.root) => {
    if (!(root instanceof HTMLElement)) return
    for (const input of Array.from(root.querySelectorAll('input[type="range"]'))) {
      syncRangeProgress(input)
    }
  }

  const refreshUi = () => {
    const refs = state.refs
    if (!refs.root) return
    if (state.lastPipelineSummary) {
      refs.root.setAttribute('data-aifx-acceptance-summary', JSON.stringify(state.lastPipelineSummary))
    } else {
      refs.root.removeAttribute('data-aifx-acceptance-summary')
    }
    const firstTemplate = state.templateFrames[0]
    if (refs.templateCurrent) {
      refs.templateCurrent.textContent = firstTemplate
        ? `${state.templateName || '自定义模板'} · ${state.templateFrames.length} 帧 · ${firstTemplate.width}x${firstTemplate.height} · ${state.fps} FPS`
        : ''
    }
    if (refs.templateMeta) {
      refs.templateMeta.textContent = firstTemplate
        ? `${state.templateFrames.length} 帧 · ${firstTemplate.width} x ${firstTemplate.height}`
        : ''
    }
    if (refs.templateEmpty) {
      refs.templateEmpty.textContent = '+'
    }
    if (refs.styleMeta) {
      refs.styleMeta.textContent = state.styleReference
        ? `${state.styleReference.fileName} · ${state.styleReference.width} x ${state.styleReference.height}`
        : ''
    }
    if (refs.styleEmpty) {
      if (state.styleReference?.dataUrl) {
        refs.styleEmpty.innerHTML = `<img src="${state.styleReference.dataUrl}" alt="style reference">`
      } else {
        refs.styleEmpty.textContent = '+'
      }
    }
    const statusText = String(state.status || '等待输入').trim() || '等待输入'
    const detailText = String(state.detail || '').trim()
    const statusTone = state.isGenerating || /生成中|导出中|正在/.test(statusText)
      ? 'working'
      : /失败|错误/.test(statusText)
        ? 'error'
        : /取消|停止|撤单|需要/.test(statusText)
          ? 'warning'
          : /已生成|已导出|已载入|已应用|验证通过|成品/.test(statusText)
            ? 'success'
            : 'idle'
    if (refs.previewStatusTitle) refs.previewStatusTitle.textContent = statusText
    if (refs.previewStatusDetail) refs.previewStatusDetail.textContent = detailText
    if (refs.previewStatus) {
      refs.previewStatus.setAttribute('data-tone', statusTone)
      refs.previewStatus.setAttribute('title', [statusText, detailText].filter(Boolean).join(' · '))
    }
    if (refs.effectType) {
      refs.effectType.textContent = state.autoPrompt?.inferredEffectType
        ? `AI 已识别：${state.autoPrompt.inferredEffectType}（${Math.round((state.autoPrompt.confidence || 0) * 100)}%）`
        : 'AI 会自动识别参考图类型。'
    }
    if (refs.providerHost && window.NovaFlowAifxProviderTool?.syncControlPanel) {
      window.NovaFlowAifxProviderTool.syncControlPanel({
        host: refs.providerHost,
        state: state.providerState,
        onChange() {
          clearGeneratedState()
          drawPreview()
        },
      })
    }
    if (refs.promptSupplement && refs.promptSupplement.value !== state.promptSupplement) {
      refs.promptSupplement.value = String(state.promptSupplement || '')
    }
    if (refs.material) refs.material.value = String(state.materialStrength)
    if (refs.contour) refs.contour.value = String(state.contourVariation)
    if (refs.materialValue) refs.materialValue.textContent = String(state.materialStrength)
    if (refs.contourValue) refs.contourValue.textContent = String(state.contourVariation)

    const generationLocked = state.isGenerating === true
    refs.root.toggleAttribute('data-aifx-generation-locked', generationLocked)
    if (refs.templateInput) refs.templateInput.disabled = generationLocked
    if (refs.styleInput) refs.styleInput.disabled = generationLocked
    if (refs.promptSupplement) refs.promptSupplement.disabled = generationLocked
    if (refs.material) refs.material.disabled = generationLocked
    if (refs.contour) refs.contour.disabled = generationLocked
    for (const providerControl of Array.from(refs.providerHost?.querySelectorAll('[data-novaflow-aifx-provider]') || [])) {
      if (providerControl instanceof HTMLSelectElement) providerControl.disabled = generationLocked
    }
    for (const selector of ['[data-action="load-builtin"]', '[data-action="clear-template"]']) {
      const control = refs.root.querySelector(selector)
      if (control instanceof HTMLButtonElement) control.disabled = generationLocked
    }
    for (const selector of ['[data-action="pick-template"]', '[data-action="pick-style"]']) {
      const dropzone = refs.root.querySelector(selector)
      if (!(dropzone instanceof HTMLElement)) continue
      dropzone.setAttribute('aria-disabled', generationLocked ? 'true' : 'false')
    }

    const frameCount = Math.max(state.templateFrames.length, state.generatedFrames.length)
    if (refs.timeline) {
      refs.timeline.max = String(Math.max(0, frameCount - 1))
      refs.timeline.value = String(clamp(state.activeFrameIndex, 0, Math.max(0, frameCount - 1)))
    }
    if (refs.frameLabel) refs.frameLabel.textContent = frameCount ? `${state.activeFrameIndex + 1} / ${frameCount}` : '0 / 0'
    if (refs.play) {
      refs.play.innerHTML = state.playing
        ? '<i class="fas fa-pause" aria-hidden="true"></i>'
        : '<i class="fas fa-play" aria-hidden="true"></i>'
      refs.play.setAttribute('title', state.playing ? '暂停' : '播放')
      refs.play.setAttribute('aria-label', state.playing ? '暂停' : '播放')
    }
    syncAllRangeProgress()
    if (refs.generate) {
      refs.generate.disabled = state.isGenerating || !state.templateFrames.length || !state.styleReference
      refs.generate.textContent = state.isGenerating ? '生成中...' : '生成特效'
    }
    for (const button of Array.from(refs.root.querySelectorAll('[data-mode]'))) {
      button.classList.toggle('is-active', button.getAttribute('data-mode') === state.previewMode)
    }
  }

  const setFrame = (index) => {
    const frameCount = Math.max(state.templateFrames.length, state.generatedFrames.length)
    if (!frameCount) return
    state.activeFrameIndex = (Math.round(index) + frameCount) % frameCount
    refreshUi()
    drawPreview()
  }

  const isAifxAppOpen = () => !!state.refs.root?.classList.contains('is-open')

  const cancelPlaybackFrame = () => {
    if (state.playTimer) cancelAnimationFrame(state.playTimer)
    state.playTimer = 0
  }

  const pausePlayback = (options = {}) => {
    const wasPlaying = !!state.playing
    state.playing = false
    state.resumePlaybackOnVisible = !!options.resumeOnVisible && wasPlaying
    cancelPlaybackFrame()
    if (options.refresh !== false) refreshUi()
  }

  const startPlayback = (options = {}) => {
    if (document.hidden || !isAifxAppOpen()) {
      state.playing = false
      state.resumePlaybackOnVisible = !!options.resumeOnVisible
      cancelPlaybackFrame()
      if (options.refresh !== false) refreshUi()
      return
    }
    state.resumePlaybackOnVisible = false
    state.playing = true
    state.lastTick = performance.now()
    cancelPlaybackFrame()
    state.playTimer = requestAnimationFrame(playTick)
    if (options.refresh !== false) refreshUi()
  }

  const togglePlayback = () => {
    if (state.playing) pausePlayback()
    else startPlayback()
  }

  const playTick = (now) => {
    state.playTimer = 0
    if (!state.playing) return
    if (document.hidden || !isAifxAppOpen()) {
      pausePlayback({ resumeOnVisible: document.hidden })
      return
    }
    const frameMs = 1000 / Math.max(1, state.fps)
    if (now - state.lastTick >= frameMs) {
      state.lastTick = now
      setFrame(state.activeFrameIndex + 1)
    }
    state.playTimer = requestAnimationFrame(playTick)
  }

  const syncPreviewWorkspace = () => {
    const main = state.refs.main
    const previewWrap = state.refs.previewWrap
    const clearWorkspaceState = (element) => {
      if (!(element instanceof HTMLElement)) return
      element.removeAttribute('data-novaflow-preview-workspace')
      element.style.removeProperty('--novaflow-preview-left')
      element.style.removeProperty('--novaflow-preview-top')
      element.style.removeProperty('--novaflow-preview-right')
      element.style.removeProperty('--novaflow-preview-bottom')
    }
    clearWorkspaceState(previewWrap)
    clearWorkspaceState(main)
  }

  const ensurePreviewGridCanvas = () => {
    const previewWrap = state.refs.previewWrap
    if (!(previewWrap instanceof HTMLElement)) return null
    let gridCanvas = state.refs.previewGrid
    if (!(gridCanvas instanceof HTMLCanvasElement) || gridCanvas.parentElement !== previewWrap) {
      gridCanvas = previewWrap.querySelector('.aifx-preview-grid')
      if (!(gridCanvas instanceof HTMLCanvasElement)) {
        gridCanvas = document.createElement('canvas')
        gridCanvas.className = 'aifx-preview-grid'
        gridCanvas.setAttribute('data-preview-grid', '1')
        const previewCanvas = state.refs.preview
        if (previewCanvas instanceof HTMLCanvasElement && previewCanvas.parentElement === previewWrap) {
          previewWrap.insertBefore(gridCanvas, previewCanvas)
        } else {
          previewWrap.prepend(gridCanvas)
        }
      }
      state.refs.previewGrid = gridCanvas
    }
    return gridCanvas
  }

  const drawPreviewGrid = () => {}

  const drawParticlePreviewBackground = (ctx, width, height) => {
    const centerX = width / 2
    const gridTop = height * 0.35
    const gridBottom = height * 1.18
    const baseGradient = ctx.createLinearGradient(0, 0, 0, height)
    baseGradient.addColorStop(0, '#080808')
    baseGradient.addColorStop(0.48, '#0b0b0b')
    baseGradient.addColorStop(1, '#050505')
    ctx.fillStyle = baseGradient
    ctx.fillRect(0, 0, width, height)

    const glow = ctx.createRadialGradient(centerX, height * 0.58, 0, centerX, height * 0.58, Math.max(width, height) * 0.76)
    glow.addColorStop(0, 'rgba(70,70,70,0.10)')
    glow.addColorStop(0.52, 'rgba(24,24,24,0.06)')
    glow.addColorStop(1, 'rgba(0,0,0,0.56)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)

    ctx.save()
    ctx.lineWidth = 1
    const lineGradient = ctx.createLinearGradient(0, gridTop, 0, gridBottom)
    lineGradient.addColorStop(0, 'rgba(96,96,96,0)')
    lineGradient.addColorStop(0.34, 'rgba(96,96,96,0.12)')
    lineGradient.addColorStop(1, 'rgba(96,96,96,0.30)')
    ctx.strokeStyle = lineGradient
    for (let index = -30; index <= 30; index += 1) {
      const topX = centerX + index * 46
      const bottomX = centerX + index * 185
      ctx.globalAlpha = 0.68
      ctx.beginPath()
      ctx.moveTo(topX, gridTop)
      ctx.lineTo(bottomX, gridBottom)
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(96,96,96,0.30)'
    for (let index = 0; index < 36; index += 1) {
      const progress = index / 35
      const y = gridTop + (gridBottom - gridTop) * Math.pow(progress, 1.9)
      ctx.globalAlpha = 0.018 + 0.245 * Math.pow(progress, 1.55)
      ctx.beginPath()
      ctx.moveTo(-width * 0.28, y + 0.5)
      ctx.lineTo(width * 1.28, y + 0.5)
      ctx.stroke()
    }
    ctx.restore()
  }

  const resolvePreviewViewport = (canvas) => {
    const frame = state.refs.previewFrame
    if (!(frame instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
      return { x: 0, y: 0, width: canvas.width, height: canvas.height }
    }
    const ratio = Math.max(1, window.devicePixelRatio || 1)
    const canvasRect = canvas.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const x = Math.max(0, Math.round((frameRect.left - canvasRect.left) * ratio))
    const y = Math.max(0, Math.round((frameRect.top - canvasRect.top) * ratio))
    const width = Math.max(1, Math.min(canvas.width - x, Math.round(frameRect.width * ratio)))
    const height = Math.max(1, Math.min(canvas.height - y, Math.round(frameRect.height * ratio)))
    return { x, y, width, height }
  }

  const drawPreview = () => {
    const canvas = state.refs.preview
    if (!canvas) return
    syncPreviewWorkspace()
    drawPreviewGrid()
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.max(1, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.floor(rect.width * ratio))
    const height = Math.max(1, Math.floor(rect.height * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    drawParticlePreviewBackground(ctx, width, height)
    const viewport = resolvePreviewViewport(canvas)
    const template = state.templateFrames[state.activeFrameIndex]
    const result = state.generatedFrames[state.activeFrameIndex]
    if (!template && !result) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.5)'
      ctx.font = `${14 * ratio}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('载入模板后开始', viewport.x + viewport.width / 2, viewport.y + viewport.height / 2)
      return
    }
    if (state.previewMode === 'template') {
      drawImageContain(ctx, template?.canvas || result.canvas, viewport)
      return
    }
    if (state.previewMode === 'sheet' && state.spriteSheet) {
      drawImageContain(ctx, state.spriteSheet.outputCanvas || state.spriteSheet.inputCanvas, viewport)
      return
    }
    if (state.previewMode === 'compare' && template && result) {
      drawImageContain(ctx, template.canvas, viewport, { alpha: 0.55, dx: -viewport.width * 0.13 })
      drawImageContain(ctx, result.canvas, viewport, { alpha: 1, dx: viewport.width * 0.13 })
      return
    }
    drawImageContain(ctx, (result || template).canvas, viewport)
  }

  const drawImageContain = (ctx, imageCanvas, viewport, options = {}) => {
    const padding = 34 * Math.max(1, window.devicePixelRatio || 1)
    const scale = Math.min((viewport.width - padding * 2) / imageCanvas.width, (viewport.height - padding * 2) / imageCanvas.height)
    const drawW = imageCanvas.width * Math.max(0.01, scale)
    const drawH = imageCanvas.height * Math.max(0.01, scale)
    const x = viewport.x + (viewport.width - drawW) / 2 + (options.dx || 0)
    const y = viewport.y + (viewport.height - drawH) / 2
    ctx.save()
    ctx.globalAlpha = options.alpha ?? 1
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(imageCanvas, x, y, drawW, drawH)
    ctx.restore()
  }

  const runTask = async (task) => {
    try {
      await task()
    } catch (error) {
      console.error('[AIFX MVP]', error)
      if (error?.code === 'AIFX_ABORTED' || error?.code === 'AIFX_TIMEOUT' || error?.name === 'AbortError') {
        const cancellation = error?.runtimeCancellation
        const runtimeCancelled = cancellation?.confirmed === true
        const action = cancellation?.action === 'delete-pending'
          ? '已从 Runtime 待执行队列删除'
          : cancellation?.action === 'interrupt-running'
            ? '已中断 Runtime 中属于本次的任务'
            : ''
        setStatus(
          runtimeCancelled ? 'Runtime 已撤单' : '已停止等待',
          runtimeCancelled
            ? action
            : '前端已停止等待；未确认 Runtime 撤单，任务可能仍在后台结束。',
        )
        return
      }
      setStatus('失败', String(error?.message || error || '未知错误'))
    }
  }

  let activeExportDispatch = null
  const dispatchExport = (mode, options = {}) => {
    const normalizedMode = String(mode || '').trim().toLowerCase()
    const task = normalizedMode === 'final'
      ? exportPngSequence
      : normalizedMode === 'spine'
        ? exportSpineProject
        : null
    if (!task) {
      return runTask(async () => {
        throw new Error(`不支持的 AI 特效导出模式：${normalizedMode || 'empty'}`)
      })
    }
    if (activeExportDispatch) return activeExportDispatch
    const normalizedOptions = options && typeof options === 'object'
      ? { ...options, name: sanitizeAifxExportName(options.name, '') }
      : {}
    const tracked = runTask(() => task(normalizedOptions)).finally(() => {
      if (activeExportDispatch === tracked) activeExportDispatch = null
    })
    activeExportDispatch = tracked
    return tracked
  }

  const openApp = async (trigger) => {
    uiTraceCurrent('CurrentAifxRuntimePanel', { phase: 'openApp' })
    cancelScheduledHostScrollFreeze()
    const root = mount()
    if (!root.classList.contains('is-open')) {
      for (const key of Object.keys(state.sectionOpen)) state.sectionOpen[key] = false
      syncSectionOpen(root)
    }
    updateShellInset(trigger)
    freezeHostLeftScroll()
    applyHostTabVisuals(trigger)
    document.body.classList.add('novaflow-aifx-open')
    root.classList.add('is-open')
    scheduleHostScrollFreeze(root)
    refreshUi()
    drawPreview()
  }

  const hideApp = (options = {}) => {
    window.__NovaFlowAifxExportIntentUntil = 0
    cancelScheduledHostScrollFreeze()
    if (state.isGenerating && state.generationAbort && !state.generationAbort.signal.aborted) {
      setStatus('正在停止生成', '正在按本次 promptId 请求 Runtime 安全撤单。')
      state.generationAbort.abort('AIFX panel closed by user')
   }
   pausePlayback({ refresh: false })
   clearGeneratedState()
   state.previewMode = 'template'
   state.activeFrameIndex = clamp(state.activeFrameIndex, 0, Math.max(0, state.templateFrames.length - 1))
    if (!state.isGenerating) {
      state.status = state.templateFrames.length && state.styleReference ? '等待生成' : '等待输入'
      state.detail = state.templateFrames.length && state.styleReference ? '模板与风格参考图已保留，可重新生成。' : ''
    }
   state.refs.root?.classList.remove('is-open')
    document.body.classList.remove('novaflow-aifx-open')
    restoreHostScroll()
    if (options.activateParticle) setHostTabState('particle')
    refreshUi()
  }

  const closeApp = () => {
    hideApp({ activateParticle: true })
    const particleEntry = findButtonsByText(isParticleEffectLabel)[0]
    if (particleEntry instanceof HTMLElement) {
      particleEntry.click()
    }
  }

  const isProtectedExportInteraction = (target) => {
    const element = target instanceof Element ? target : null
    if (!element) return false
    if (element.closest([
      '[data-novaflow-primary-export-entry="1"]',
      '[data-novaflow-export-modal-root="1"][data-novaflow-export-context-kind="aifx"]',
      '[data-novaflow-license-modal-root="1"]',
      '[data-novaflow-license-dialog="1"]',
    ].join(', '))) return true
    const exportModalOpen = Boolean(document.querySelector(
      '[data-novaflow-export-modal-root="1"][data-novaflow-export-context-kind="aifx"]',
    ))
    const exportModalDropdownOpen = Boolean(document.querySelector(
      '[data-novaflow-export-modal-dropdown="1"]',
    ))
    if (exportModalOpen && (
      element.closest('[data-novaflow-export-modal-dropdown="1"]') ||
      (exportModalDropdownOpen && element.closest(
        '#novaflow-global-dropdown-overlay, #novaflow-global-dropdown-portal',
      ))
    )) return true
    const action = getActionElement(element)
    const actionText = normalize(action?.textContent)
    const topbarExportSurface = element.closest([
      '.nf-topbar',
      '#novaflow-global-dropdown-overlay',
      '#novaflow-global-dropdown-portal',
      '[data-novaflow-dropdown-panel="1"]',
      '[data-novaflow-topbar-layer="1"]',
      '[data-novaflow-topbar-menu-layer="1"]',
      '[data-novaflow-topbar-dropdown-layer="1"]',
    ].join(', '))
    if (topbarExportSurface && (actionText === '文件' || actionText.startsWith('导出'))) {
      window.__NovaFlowAifxExportIntentUntil = Date.now() + 4000
      return true
    }
    if (action) return false
    if (Number(window.__NovaFlowAifxExportIntentUntil || 0) <= Date.now()) return false
    return Boolean(topbarExportSurface)
  }

  document.addEventListener(
    'click',
    (event) => {
      const root = state.refs.root
      const action = getActionElement(event.target)
      if (root?.classList.contains('is-open') && isProtectedExportInteraction(event.target)) return
      if (action && isTopMenuLabel(action.textContent)) {
        hideApp()
        return
      }
      if (root?.classList.contains('is-open') && !root.contains(event.target)) {
        if (action && isParticleEffectLabel(action.textContent)) {
          hideApp({ activateParticle: true })
          return
        }
        if (!action || !isAiEffectLabel(action.textContent)) hideApp()
      }
      if (!action || !isAiEffectLabel(action.textContent)) return
      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
      openApp(action)
    },
    true,
  )

  document.addEventListener(
    'wheel',
    (event) => {
      const root = state.refs.root
      if (!root?.classList.contains('is-open')) return
      const shellLeft = state.shellInset?.shellLeft ?? HOST_LEFT_SHELL_LEFT
      const shellRight = state.shellInset?.shellRight ?? (HOST_LEFT_SHELL_LEFT + HOST_LEFT_SHELL_WIDTH)
      if (event.clientX < shellLeft || event.clientX > shellRight) return
      const panel = event.target instanceof Element ? event.target.closest(`#${APP_ID} .aifx-panel`) : null
      if (panel) return
      freezeHostLeftScroll()
      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
    },
    { capture: true, passive: false },
  )

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const action = getActionElement(event.target)
      if (!action || !isAiEffectLabel(action.textContent)) return
      event.preventDefault()
      event.stopPropagation()
      openApp(action)
    },
    true,
  )

  const handlePlaybackVisibilityChange = () => {
    if (document.hidden) {
      pausePlayback({ resumeOnVisible: true })
      return
    }
    if (state.resumePlaybackOnVisible && isAifxAppOpen()) startPlayback()
  }

  document.addEventListener('visibilitychange', handlePlaybackVisibilityChange)
  window.addEventListener('pagehide', () => pausePlayback({ resumeOnVisible: false }))

  const start = () => {
    installStyle()
    runAifxSmokeTestFromQuery()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  window.NovaFlowAifxMvp = {
    pipeline: PIPELINE_ID,
    source: RUNTIME_SOURCE,
    open: openApp,
    hide: hideApp,
    close: closeApp,
    runProductionPipeline: runAifxProductionPipeline,
    loadBuiltinTemplate,
    loadStyleDataUrl: readStyleDataUrl,
    dispatchExport,
    exportFinalProduct: (options = {}) => dispatchExport('final', options),
    exportSpineProject: (options = {}) => dispatchExport('spine', options),
    applyToProject,
    pureHelpers: Object.freeze({ ...AifxPureHelpers }),
    getState: () => state,
  }
})()

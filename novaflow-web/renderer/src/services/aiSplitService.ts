export type SplitMode = 'auto' | 'prompt' | 'manual'
export type SplitPurpose = 'spine'
export type SplitQuality = 'fast' | 'standard' | 'fine'
export type EdgeMode = 'keep' | 'feather1' | 'feather2' | 'removeWhite' | 'removeBlack'
export type InpaintMode = 'off' | 'light' | 'standard' | 'strong'
export type SplitReviewSeverity = 'warning' | 'reject'

export interface SplitReviewIssue {
  code: string
  severity: SplitReviewSeverity
  message: string
  value?: number
}

export interface SplitPart {
  id: string
  name: string
  prompt: string
  file?: string
  maskFile?: string
  x: number
  y: number
  width: number
  height: number
  pivot: {
    x: number
    y: number
  }
  layer: number
  visible: boolean
  needsInpaint: boolean
  spineReady?: boolean
  sourceFidelity?: number
  generatedRatio?: number
  reviewIssues?: SplitReviewIssue[]
}

export interface SplitManifest {
  version: string
  source: string
  purpose: SplitPurpose
  psd?: string
  createdAt: string
  status?: 'ready' | 'review_required'
  reviewIssues?: SplitReviewIssue[]
  parts: SplitPart[]
}

export interface AiSplitParams {
  sourceImage: string
  sourceFileName?: string
  prompt: string
  negativePrompt?: string
  mode: SplitMode
  purpose: SplitPurpose
  quality: SplitQuality
  edgeMode: EdgeMode
  inpaintMode: InpaintMode
  spineFix: boolean
  requestedParts?: string[]
}

export interface PsdLayerFusionOptions {
  featherPx?: number
  edgeMode?: EdgeMode
  sourcePriority?: 'high' | 'standard'
}

export interface SplitRuntimePart extends SplitPart {
  dataUrl?: string
  maskDataUrl?: string
  originalWidth?: number
  originalHeight?: number
}

type BackgroundRemovalRuntime = {
  removeMatteFromImageData?: (imageData: ImageData, mode: 'removeWhite' | 'removeBlack') => {
    imageData?: ImageData
    stats?: Record<string, number>
  } | ImageData
}

declare global {
  interface Window {
    NovaFlowBackgroundRemoval?: BackgroundRemovalRuntime
  }
}

type PartPreset = {
  id: string
  label: string
  prompt: string
  aliases: string[]
  pivot: { x: number; y: number }
  layer: number
}

const PART_PRESETS: PartPreset[] = [
  { id: 'background', label: '背景', prompt: 'background only, 背景', aliases: ['background', 'bg', '背景'], pivot: { x: 0.5, y: 0.5 }, layer: 0 },
  { id: 'character', label: '人物', prompt: 'full character, person, 人物, 全身角色', aliases: ['character', 'person', '人物', '角色'], pivot: { x: 0.5, y: 0.5 }, layer: 50 },
  { id: 'hair_back', label: '后发', prompt: 'back hair, rear hair, hair behind head, 后发', aliases: ['hair_back', '后发', '背发'], pivot: { x: 0.5, y: 0.1 }, layer: 10 },
  { id: 'cape', label: '披风', prompt: 'cape, cloak, 披风', aliases: ['cape', 'cloak', '披风'], pivot: { x: 0.5, y: 0.05 }, layer: 20 },
  { id: 'weapon_back', label: '后置武器', prompt: 'weapon behind body, back weapon, 背后武器', aliases: ['weapon_back', '背后武器', '后置武器'], pivot: { x: 0.5, y: 0.5 }, layer: 30 },
  { id: 'left_upper_arm', label: '左上臂', prompt: 'left upper arm from shoulder to elbow, 左上臂, 左大臂', aliases: ['left_upper_arm', 'left upper arm', 'upper left arm', '左上臂', '左大臂'], pivot: { x: 0.5, y: 0.12 }, layer: 78 },
  { id: 'left_forearm', label: '左前臂', prompt: 'left forearm from elbow to wrist, 左前臂, 左小臂', aliases: ['left_forearm', 'left lower arm', 'left forearm', '左前臂', '左小臂'], pivot: { x: 0.5, y: 0.12 }, layer: 80 },
  { id: 'left_hand', label: '左手', prompt: 'left hand, palm and fingers, 左手, 左手掌', aliases: ['left_hand', 'left hand', '左手', '左手掌'], pivot: { x: 0.5, y: 0.16 }, layer: 82 },
  { id: 'right_upper_arm', label: '右上臂', prompt: 'right upper arm from shoulder to elbow, 右上臂, 右大臂', aliases: ['right_upper_arm', 'right upper arm', 'upper right arm', '右上臂', '右大臂'], pivot: { x: 0.5, y: 0.12 }, layer: 83 },
  { id: 'right_forearm', label: '右前臂', prompt: 'right forearm from elbow to wrist, 右前臂, 右小臂', aliases: ['right_forearm', 'right lower arm', 'right forearm', '右前臂', '右小臂'], pivot: { x: 0.5, y: 0.12 }, layer: 85 },
  { id: 'right_hand', label: '右手', prompt: 'right hand, palm and fingers, 右手, 右手掌', aliases: ['right_hand', 'right hand', '右手', '右手掌'], pivot: { x: 0.5, y: 0.16 }, layer: 87 },
  { id: 'left_arm', label: '左臂', prompt: 'complete left arm fallback, 左臂整体', aliases: ['left_arm', '左臂'], pivot: { x: 0.5, y: 0.1 }, layer: 80 },
  { id: 'right_arm', label: '右臂', prompt: 'complete right arm fallback, 右臂整体', aliases: ['right_arm', '右臂'], pivot: { x: 0.5, y: 0.1 }, layer: 85 },
  { id: 'body', label: '身体', prompt: 'body, torso, chest, waist, 身体, 躯干', aliases: ['body', 'torso', '身体', '躯干', '胸部', '腰部'], pivot: { x: 0.5, y: 0.5 }, layer: 50 },
  { id: 'neck', label: '脖子', prompt: 'neck, 脖子', aliases: ['neck', '脖子'], pivot: { x: 0.5, y: 0.25 }, layer: 55 },
  { id: 'head', label: '头部', prompt: 'head, face, neck connection, 头部, 脸', aliases: ['head', 'face', '头部', '头', '脸'], pivot: { x: 0.5, y: 0.85 }, layer: 60 },
  { id: 'face', label: '脸部', prompt: 'face only, facial features, 脸部, 五官', aliases: ['face', '脸部', '五官'], pivot: { x: 0.5, y: 0.5 }, layer: 65 },
  { id: 'hair_front', label: '前发', prompt: 'front hair, bangs, hair in front of face, 前发, 刘海', aliases: ['hair_front', 'bangs', '前发', '刘海'], pivot: { x: 0.5, y: 0.1 }, layer: 70 },
  { id: 'hair', label: '头发', prompt: 'all hair, hair strands, 头发', aliases: ['hair', '头发', '发型'], pivot: { x: 0.5, y: 0.1 }, layer: 70 },
  { id: 'cloth_front', label: '前景服饰', prompt: 'front clothes, cloth front, clothing details, 前景服饰', aliases: ['cloth_front', 'front cloth', '前景服饰', '衣服前层'], pivot: { x: 0.5, y: 0.5 }, layer: 75 },
  { id: 'left_thigh', label: '左大腿', prompt: 'left thigh from hip to knee, 左大腿, 左上腿', aliases: ['left_thigh', 'left upper leg', '左大腿', '左上腿'], pivot: { x: 0.5, y: 0.1 }, layer: 42 },
  { id: 'left_shin', label: '左小腿', prompt: 'left lower leg from knee to ankle, left shin, 左小腿', aliases: ['left_shin', 'left lower leg', 'left calf', '左小腿', '左胫'], pivot: { x: 0.5, y: 0.1 }, layer: 44 },
  { id: 'left_foot', label: '左脚', prompt: 'left foot, ankle and shoe, 左脚, 左脚掌', aliases: ['left_foot', 'left foot', '左脚', '左脚掌'], pivot: { x: 0.35, y: 0.22 }, layer: 45 },
  { id: 'right_thigh', label: '右大腿', prompt: 'right thigh from hip to knee, 右大腿, 右上腿', aliases: ['right_thigh', 'right upper leg', '右大腿', '右上腿'], pivot: { x: 0.5, y: 0.1 }, layer: 46 },
  { id: 'right_shin', label: '右小腿', prompt: 'right lower leg from knee to ankle, right shin, 右小腿', aliases: ['right_shin', 'right lower leg', 'right calf', '右小腿', '右胫'], pivot: { x: 0.5, y: 0.1 }, layer: 48 },
  { id: 'right_foot', label: '右脚', prompt: 'right foot, ankle and shoe, 右脚, 右脚掌', aliases: ['right_foot', 'right foot', '右脚', '右脚掌'], pivot: { x: 0.35, y: 0.22 }, layer: 49 },
  { id: 'left_leg', label: '左腿', prompt: 'complete left leg fallback, 左腿整体', aliases: ['left_leg', '左腿'], pivot: { x: 0.5, y: 0.1 }, layer: 46 },
  { id: 'right_leg', label: '右腿', prompt: 'complete right leg fallback, 右腿整体', aliases: ['right_leg', '右腿'], pivot: { x: 0.5, y: 0.1 }, layer: 47 },
  { id: 'weapon', label: '武器', prompt: 'weapon, sword, blade, staff, gun, 武器', aliases: ['weapon', 'sword', 'blade', 'staff', 'gun', '武器', '刀', '剑', '枪'], pivot: { x: 0.5, y: 0.5 }, layer: 90 },
  { id: 'wing', label: '翅膀', prompt: 'wing, wings, 翅膀', aliases: ['wing', 'wings', '翅膀'], pivot: { x: 0.18, y: 0.5 }, layer: 25 },
  { id: 'skirt', label: '裙摆', prompt: 'skirt hem, dress hem, 裙摆', aliases: ['skirt', 'dress', '裙摆', '裙子'], pivot: { x: 0.5, y: 0.08 }, layer: 76 },
  { id: 'accessory', label: '饰品', prompt: 'accessory, ornament, jewelry, 饰品', aliases: ['accessory', 'ornament', 'jewelry', '饰品', '装饰'], pivot: { x: 0.5, y: 0.5 }, layer: 88 },
  { id: 'shadow', label: '阴影', prompt: 'character shadow, ground shadow, 阴影', aliases: ['shadow', '阴影', '影子'], pivot: { x: 0.5, y: 0.5 }, layer: 5 }
]

const SPINE_LAYER_ORDER: Record<string, number> = {
  background: 0,
  shadow: 5,
  hair_back: 58,
  cape: 20,
  skirt_back: 24,
  wing: 25,
  weapon_back: 30,
  left_leg: 40,
  right_leg: 41,
  left_thigh: 42,
  left_shin: 44,
  left_foot: 45,
  right_thigh: 46,
  right_shin: 48,
  right_foot: 49,
  body: 50,
  character: 52,
  neck: 55,
  head: 60,
  ears_l: 63,
  ears_r: 63,
  face: 65,
  eyewhite_l: 66,
  eyewhite_r: 66,
  irides_l: 67,
  irides_r: 67,
  nose: 68,
  mouth: 68,
  eyelash_l: 69,
  eyelash_r: 69,
  eyebrow_l: 69,
  eyebrow_r: 69,
  hair_front: 72,
  hair: 72,
  cloth_front: 75,
  skirt_front: 76,
  left_upper_arm: 78,
  left_forearm: 80,
  left_arm: 80,
  left_hand: 56,
  right_upper_arm: 83,
  right_forearm: 85,
  right_arm: 85,
  right_hand: 92,
  accessory: 88,
  weapon: 88,
  weapon_front: 88,
  effect_front: 100
}

const spineLayerRank = (part: Pick<SplitRuntimePart, 'id' | 'layer'>) => {
  const id = normalizePartId(part.id)
  if (Object.prototype.hasOwnProperty.call(SPINE_LAYER_ORDER, id)) return SPINE_LAYER_ORDER[id]
  if (/^eyewhite_/.test(id)) return 66
  if (/^irides_/.test(id)) return 67
  if (/^(nose|mouth)_?/.test(id)) return 68
  if (/^(eyelash|eyebrow)_/.test(id)) return 69
  if (/hair.*back|back.*hair/.test(id)) return 58
  if (/hair/.test(id)) return 72
  if (/skirt.*back|back.*skirt/.test(id)) return 49.5
  if (/skirt|dress/.test(id)) return 76
  if (/thigh/.test(id)) return id.startsWith('left') ? 42 : 46
  if (/shin|calf/.test(id)) return id.startsWith('left') ? 44 : 48
  if (/foot|shoe/.test(id)) return id.startsWith('left') ? 45 : 49
  if (/hand/.test(id)) return id.startsWith('left') ? 56 : 92
  if (/forearm/.test(id)) return id.startsWith('left') ? 80 : 85
  if (/arm/.test(id)) return id.startsWith('left') ? 78 : 83
  if (/accessory|ribbon/.test(id)) return 86
  return Number.isFinite(part.layer) ? part.layer : 80
}

const normalizeSpineLayerOrder = (parts: SplitRuntimePart[]) => {
  return parts
    .map((part) => ({ ...part, layer: spineLayerRank(part) }))
    .sort((a, b) => spineLayerRank(a) - spineLayerRank(b) || a.id.localeCompare(b.id))
}

const orderPartsForComposite = (parts: SplitRuntimePart[]) => {
  return normalizeSpineLayerOrder(parts).filter((part) => part.visible !== false && part.dataUrl)
}

const orderPartsForPsdStack = (parts: SplitRuntimePart[]) => orderPartsForComposite(parts).slice().reverse()

const SPINE_AUTO_PARTS = [
  'hair_back',
  'cape',
  'left_thigh',
  'left_shin',
  'left_foot',
  'right_thigh',
  'right_shin',
  'right_foot',
  'body',
  'neck',
  'head',
  'hair_front',
  'left_upper_arm',
  'left_forearm',
  'left_hand',
  'right_upper_arm',
  'right_forearm',
  'right_hand',
  'weapon'
]

const normalizePartId = (value: string) => {
  const raw = String(value || '').trim().toLowerCase()
  const preset = PART_PRESETS.find((part) => part.id === raw || part.aliases.some((alias) => raw === alias.toLowerCase()))
  if (preset) return preset.id
  if (raw === 'arm_l') return 'left_arm'
  if (raw === 'arm_r') return 'right_arm'
  if (raw === 'leg_l') return 'left_leg'
  if (raw === 'leg_r') return 'right_leg'
  if (raw === 'left lower arm') return 'left_forearm'
  if (raw === 'right lower arm') return 'right_forearm'
  if (raw === 'left lower leg') return 'left_shin'
  if (raw === 'right lower leg') return 'right_shin'
  return raw.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'custom_part'
}

const getPartPreset = (id: string, fallbackPrompt: string): PartPreset => {
  const normalized = normalizePartId(id)
  const hit = PART_PRESETS.find((part) => part.id === normalized)
  if (hit) return hit
  return {
    id: normalized,
    label: normalized,
    prompt: fallbackPrompt || normalized,
    aliases: [normalized],
    pivot: { x: 0.5, y: 0.5 },
    layer: 80
  }
}

const resolveRequestedParts = (params: AiSplitParams) => {
  if (params.requestedParts?.length) {
    return Array.from(new Set(params.requestedParts.map(normalizePartId))).map((id) => getPartPreset(id, params.prompt))
  }
  if (params.mode === 'auto') return SPINE_AUTO_PARTS.map((id) => getPartPreset(id, params.prompt))

  const prompt = String(params.prompt || '').trim()
  const hits = PART_PRESETS.filter((part) => {
    const haystack = [part.id, part.label, ...part.aliases].map((s) => String(s || '').toLowerCase())
    const low = prompt.toLowerCase()
    return haystack.some((alias) => alias && low.includes(alias))
  })
  if (hits.length) return hits

  const first = prompt.split(/[,，、\s]+/g).map((s) => s.trim()).filter(Boolean)[0] || 'custom_part'
  return [getPartPreset(first, prompt)]
}

const sanitizeFileStem = (value: string) => normalizePartId(value || 'part').replace(/_png$/i, '') || 'part'

const dataUrlToBlob = async (dataUrl: string) => {
  const res = await fetch(dataUrl)
  return await res.blob()
}

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('read file failed'))
  reader.onload = () => resolve(String(reader.result || ''))
  reader.readAsDataURL(file)
})

const fileToText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('read file failed'))
  reader.onload = () => resolve(String(reader.result || ''))
  reader.readAsText(file)
})

const loadImage = (src: string) => {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => reject(new Error('image load failed'))
    img.onload = () => resolve(img)
    img.src = src
  })
}

const canvasToDataUrl = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png')

const getSourceSize = async (sourceImage: string) => {
  const img = await loadImage(sourceImage)
  return { width: Math.max(1, img.naturalWidth || img.width || 1), height: Math.max(1, img.naturalHeight || img.height || 1) }
}

const trimBaseUrl = (value: string) => String(value || '').trim().replace(/\/+$/g, '')
const NOVAFLOW_RUNTIME_BASE_URL = 'http://127.0.0.1:8188'

const requestJson = async (baseUrl: string, path: string, init: RequestInit = { method: 'GET' }) => {
  const api = (window as any).electronAPI
  const normalized = trimBaseUrl(baseUrl)
  if (api?.runtimeRequestJson) {
    return await api.runtimeRequestJson({
      baseUrl: normalized,
      path,
      init: { method: init.method || 'GET', headers: init.headers || {}, body: init.body || null }
    })
  }
  const endpoint = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(new URL(endpoint, normalized).toString(), init)
  const text = await res.text()
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) }
  } catch {
    return { ok: res.ok, status: res.status, raw: text }
  }
}

const fetchComfyBlob = async (baseUrl: string, path: string) => {
  const api = (window as any).electronAPI
  const normalized = trimBaseUrl(baseUrl)
  if (api?.runtimeRequestBinary) {
    const out = await api.runtimeRequestBinary({ baseUrl: normalized, path, init: { method: 'GET' } })
    if (!out?.ok || !out?.dataBase64) throw new Error(`Foart AI Runtime file download failed: ${String(out?.status || out?.error || '')}`)
    const raw = atob(String(out.dataBase64 || ''))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return new Blob([bytes], { type: out.contentType || 'application/octet-stream' })
  }
  const endpoint = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(new URL(endpoint, normalized).toString(), { method: 'GET' })
  if (!res.ok) throw new Error(`Foart AI Runtime file download failed: HTTP ${res.status}`)
  return await res.blob()
}

const blobToText = async (blob: Blob) => await blob.text()

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('read blob failed'))
  reader.onload = () => resolve(String(reader.result || ''))
  reader.readAsDataURL(blob)
})

const uploadComfyImage = async (baseUrl: string, sourceImage: string, sourceFileName?: string) => {
  const fileName = sourceFileName || 'source.png'
  const api = (window as any).electronAPI
  if (api?.runtimeUploadImage) {
    const idx = sourceImage.indexOf('base64,')
    let dataBase64 = idx >= 0 ? sourceImage.slice(idx + 7) : ''
    if (!dataBase64) {
      const bytes = new Uint8Array(await (await dataUrlToBlob(sourceImage)).arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      dataBase64 = btoa(binary)
    }
    const result = await api.runtimeUploadImage({ baseUrl: trimBaseUrl(baseUrl), fileName, dataBase64, type: 'input', subfolder: '' })
    if (!result?.ok) throw new Error(`See-through upload failed: ${String(result?.error || result?.status || '')}`)
    const name = String(result?.data?.name || result?.data?.filename || '').trim()
    if (!name) throw new Error('See-through upload failed: empty Runtime filename')
    return name
  }
  const form = new FormData()
  form.append('image', await dataUrlToBlob(sourceImage), fileName)
  form.append('type', 'input')
  const res = await fetch(new URL('/upload/image', trimBaseUrl(baseUrl)).toString(), { method: 'POST', body: form })
  const text = await res.text()
  let data: any = null
  try { data = JSON.parse(text) } catch {}
  if (!res.ok) throw new Error(`See-through upload failed: HTTP ${res.status} ${text.slice(0, 160)}`)
  const name = String(data?.name || data?.filename || '').trim()
  if (!name) throw new Error('See-through upload failed: empty Runtime filename')
  return name
}

const detectComfyBaseUrl = async () => {
  const saved = [
    (() => { try { return String(localStorage.getItem('novaflow_runtime_last_connected_url') || '') } catch { return '' } })()
  ].map(trimBaseUrl).filter(Boolean)
  const candidates = [NOVAFLOW_RUNTIME_BASE_URL, ...saved]
  for (const url of Array.from(new Set(candidates))) {
    try {
      const res = await requestJson(url, '/system_stats', { method: 'GET' })
      if (res?.ok) {
        try { localStorage.setItem('novaflow_runtime_last_connected_url', url) } catch {}
        return url
      }
    } catch {}
  }
  throw new Error('See-through Foart AI Runtime is not connected.')
}

const assertSeeThroughAvailable = async (baseUrl: string) => {
  const res = await requestJson(baseUrl, '/object_info', { method: 'GET' })
  if (!res?.ok) throw new Error('Cannot read Runtime object_info for See-through nodes.')
  const info = res.data || {}
  const needed = ['SeeThrough_LoadLayerDiffModel', 'SeeThrough_LoadDepthModel', 'SeeThrough_GenerateLayers', 'SeeThrough_GenerateDepth', 'SeeThrough_PostProcess', 'SeeThrough_SavePSD']
  const missing = needed.filter((name) => !info[name])
  if (missing.length) {
    throw new Error(`See-through nodes are not loaded: ${missing.join(', ')}. Check Runtime plugin dependencies and restart Runtime.`)
  }
}

const seeThroughResolution = (params: AiSplitParams, sourceSize: { width: number; height: number }) => {
  const maxSide = Math.max(sourceSize.width, sourceSize.height)
  if (params.quality === 'fast') return Math.max(512, Math.min(1024, Math.ceil(maxSide / 64) * 64))
  if (params.quality === 'fine') return Math.max(1024, Math.min(2048, Math.ceil(maxSide / 64) * 64))
  return Math.max(768, Math.min(1280, Math.ceil(maxSide / 64) * 64))
}

const seeThroughSteps = (quality: SplitQuality) => {
  if (quality === 'fast') return 15
  if (quality === 'fine') return 50
  return 30
}

const buildSeeThroughWorkflow = (uploadedName: string, prefix: string, params: AiSplitParams, sourceSize: { width: number; height: number }) => {
  const seed = Math.floor(Math.random() * 1000000000)
  const resolution = seeThroughResolution(params, sourceSize)
  return {
    '1': { class_type: 'LoadImage', inputs: { image: uploadedName } },
    '2': { class_type: 'SeeThrough_LoadLayerDiffModel', inputs: { model: 'seethroughv0.0.2_layerdiff3d', vae_ckpt: '', unet_ckpt: '' } },
    '3': { class_type: 'SeeThrough_LoadDepthModel', inputs: { model: 'seethroughv0.0.1_marigold' } },
    '4': { class_type: 'SeeThrough_GenerateLayers', inputs: { image: ['1', 0], layerdiff_model: ['2', 0], seed, resolution, num_inference_steps: seeThroughSteps(params.quality) } },
    '5': { class_type: 'SeeThrough_GenerateDepth', inputs: { layers: ['4', 0], depth_model: ['3', 0], seed } },
    '6': { class_type: 'SeeThrough_PostProcess', inputs: { layers_depth: ['5', 0], tblr_split: true, use_lama: params.inpaintMode !== 'off' } },
    '7': { class_type: 'PreviewImage', inputs: { images: ['6', 1] } },
    '8': { class_type: 'SeeThrough_SavePSD', inputs: { parts: ['6', 0], filename_prefix: prefix } }
  }
}

type SeeThroughLayerEntry = {
  name: string
  filename: string
  left: number
  top: number
  right: number
  bottom: number
  depth_median?: number
  depth_filename?: string
}

type SeeThroughLayerInfo = {
  layers: SeeThroughLayerEntry[]
  width: number
  height: number
}

const outputViewPath = (filename: string) => {
  const qs = new URLSearchParams()
  qs.set('filename', filename)
  qs.set('type', 'output')
  return `/view?${qs.toString()}`
}

const readLatestSeeThroughInfo = async (baseUrl: string, prefix: string, startedAt: number) => {
  const logBlob = await fetchComfyBlob(baseUrl, outputViewPath('seethrough_psd_info.log'))
  const latest = (await blobToText(logBlob)).trim()
  if (!latest.startsWith(prefix) || !latest.endsWith('_layers.json')) {
    throw new Error('See-through finished, but the latest layer info does not match this run.')
  }
  const infoBlob = await fetchComfyBlob(baseUrl, outputViewPath(latest))
  const info = JSON.parse(await blobToText(infoBlob)) as SeeThroughLayerInfo
  if (!Array.isArray(info.layers) || !info.layers.length) throw new Error('See-through did not save any layers.')
  void startedAt
  return info
}

const runSeeThrough = async (params: AiSplitParams) => {
  const sourceSize = await getSourceSize(params.sourceImage)
  const baseUrl = await detectComfyBaseUrl()
  await assertSeeThroughAvailable(baseUrl)
  const uploadedName = await uploadComfyImage(baseUrl, params.sourceImage, params.sourceFileName)
  const prefix = `novaflow_spine_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const workflow = buildSeeThroughWorkflow(uploadedName, prefix, params, sourceSize)
  const startedAt = Date.now()
  const sent = await requestJson(baseUrl, '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: `novaflow_spine_${crypto.randomUUID()}`, prompt: workflow })
  })
  const promptId = String(sent?.data?.prompt_id || '').trim()
  if (!sent?.ok || !promptId) {
    const raw = typeof sent?.raw === 'string' ? sent.raw.slice(0, 240) : ''
    throw new Error(`See-through prompt failed: ${String(sent?.error || sent?.status || '')} ${raw}`)
  }

  const start = Date.now()
  let completed = false
  let failed = ''
  while (Date.now() - start < 30 * 60 * 1000) {
    await new Promise((resolve) => window.setTimeout(resolve, 1200))
    const history = await requestJson(baseUrl, `/history/${promptId}`, { method: 'GET' })
    const item = history?.data?.[promptId] || history?.data
    const status = item?.status
    if (status?.completed) {
      completed = true
      break
    }
    if (status?.status_str === 'error') {
      failed = JSON.stringify(status).slice(0, 400)
      break
    }
  }
  if (!completed) throw new Error(failed ? `See-through failed: ${failed}` : 'See-through timed out while generating layers.')
  const info = await readLatestSeeThroughInfo(baseUrl, prefix, startedAt)
  return { baseUrl, info, sourceSize }
}

const seeThroughNameToPart = (name: string): PartPreset => {
  const raw = String(name || '').trim()
  const low = raw.toLowerCase()
  const id = low
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'layer'
  const mapped = (() => {
    if (low === 'front hair') return 'hair_front'
    if (low === 'back hair') return 'hair_back'
    if (low === 'face') return 'face'
    if (low === 'neck') return 'neck'
    if (low === 'topwear') return 'body'
    if (low === 'bottomwear') return 'skirt'
    if (low === 'handwear-l') return 'left_hand'
    if (low === 'handwear-r') return 'right_hand'
    if (low === 'footwear-l') return 'left_foot'
    if (low === 'footwear-r') return 'right_foot'
    if (low === 'wings') return 'wing'
    if (low === 'objects') return 'weapon'
    return id
  })()
  const base = getPartPreset(mapped, raw)
  return {
    ...base,
    id: mapped,
    label: raw,
    prompt: `See-through layer: ${raw}`,
    aliases: [mapped, raw],
    layer: base.layer || 50
  }
}

const transformSeeThroughLayer = async (
  dataUrl: string,
  layer: SeeThroughLayerEntry,
  frame: { width: number; height: number },
  sourceSize: { width: number; height: number }
) => {
  const img = await loadImage(dataUrl)
  const frameW = Math.max(1, frame.width || img.naturalWidth || img.width || 1)
  const frameH = Math.max(1, frame.height || img.naturalHeight || img.height || 1)
  const scale = Math.min(frameW / sourceSize.width, frameH / sourceSize.height)
  const resizedW = sourceSize.width * scale
  const resizedH = sourceSize.height * scale
  const padX = (frameW - resizedW) / 2
  const padY = (frameH - resizedH) / 2
  const left = Number(layer.left || 0)
  const top = Number(layer.top || 0)
  const right = Number(layer.right || left + img.naturalWidth || img.width || 1)
  const bottom = Number(layer.bottom || top + img.naturalHeight || img.height || 1)
  const ix1 = Math.max(left, padX)
  const iy1 = Math.max(top, padY)
  const ix2 = Math.min(right, padX + resizedW)
  const iy2 = Math.min(bottom, padY + resizedH)
  if (ix2 <= ix1 || iy2 <= iy1 || scale <= 0) {
    return { dataUrl, offsetX: 0, offsetY: 0 }
  }
  const outW = Math.max(1, Math.round((ix2 - ix1) / scale))
  const outH = Math.max(1, Math.round((iy2 - iy1) / scale))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable while normalizing See-through layer.')
  ctx.clearRect(0, 0, outW, outH)
  ctx.drawImage(img, ix1 - left, iy1 - top, ix2 - ix1, iy2 - iy1, 0, 0, outW, outH)
  return {
    dataUrl: canvasToDataUrl(canvas),
    offsetX: Math.round((ix1 - padX) / scale),
    offsetY: Math.round((iy1 - padY) / scale)
  }
}

const prepareSeeThroughPart = async (
  part: PartPreset,
  rawDataUrl: string,
  baseOffset: { x: number; y: number },
  params: AiSplitParams
): Promise<SplitRuntimePart> => {
  const cleaned = await edgeCleanDataUrl(rawDataUrl, params.edgeMode, part.id)
  const cropped = await createMaskAndCrop(cleaned, part, params)
  const stem = sanitizeFileStem(part.id)
  return {
    id: stem,
    name: stem,
    prompt: part.prompt,
    file: `images/${stem}.png`,
    maskFile: `masks/${stem}_mask.png`,
    x: Math.max(0, baseOffset.x + cropped.x),
    y: Math.max(0, baseOffset.y + cropped.y),
    width: cropped.width,
    height: cropped.height,
    pivot: part.pivot,
    layer: part.layer,
    visible: true,
    needsInpaint: false,
    dataUrl: cropped.dataUrl,
    maskDataUrl: cropped.maskDataUrl,
    originalWidth: cropped.originalWidth,
    originalHeight: cropped.originalHeight
  }
}

const fusionBaseParams = (sourceImage: string, sourceFileName?: string, options?: PsdLayerFusionOptions): AiSplitParams => ({
  sourceImage,
  sourceFileName,
  prompt: '',
  mode: 'auto',
  purpose: 'spine',
  quality: 'fine',
  edgeMode: options?.edgeMode || 'removeWhite',
  inpaintMode: 'standard',
  spineFix: false
})

const filePathKey = (file: File) => String((file as any).webkitRelativePath || file.name || '').replace(/\\/g, '/').toLowerCase()
const fileBaseName = (value: string) => String(value || '').replace(/\\/g, '/').split('/').pop() || ''
const findImageFile = (files: File[], target: string) => {
  const normalized = String(target || '').replace(/\\/g, '/').toLowerCase()
  const base = fileBaseName(normalized)
  return files.find((file) => {
    const key = filePathKey(file)
    return key === normalized || key.endsWith(`/${normalized}`) || file.name.toLowerCase() === base
  })
}

const layerNameFromFile = (file: File) => String(file.name || 'layer').replace(/\.[^.]+$/g, '')

const partFromImportedName = (name: string, fallbackLayer?: number): PartPreset => {
  const mapped = seeThroughNameToPart(name)
  return { ...mapped, layer: Number.isFinite(fallbackLayer) ? Number(fallbackLayer) : spineLayerRank({ id: mapped.id, layer: mapped.layer }) }
}

const importedPartFromCroppedImage = async (
  file: File,
  meta: Partial<SplitRuntimePart> & { sourceName?: string },
  sourceSize: { width: number; height: number },
  params: AiSplitParams
) => {
  const dataUrl = await fileToDataUrl(file)
  const part = partFromImportedName(meta.id || meta.name || meta.sourceName || layerNameFromFile(file), meta.layer)
  const image = await loadImage(dataUrl)
  const imageWidth = Math.max(1, image.naturalWidth || image.width || meta.width || 1)
  const imageHeight = Math.max(1, image.naturalHeight || image.height || meta.height || 1)
  const hasExplicitOffset = Number.isFinite(meta.x) && Number.isFinite(meta.y)
  const baseOffset = hasExplicitOffset
    ? { x: Math.max(0, Math.round(Number(meta.x))), y: Math.max(0, Math.round(Number(meta.y))) }
    : { x: 0, y: 0 }
  const prepared = await prepareSeeThroughPart(part, dataUrl, baseOffset, params)
  const missingOffsetIssue = !hasExplicitOffset && (imageWidth !== sourceSize.width || imageHeight !== sourceSize.height)
    ? [{
      code: 'missing_layer_offset_metadata',
      severity: 'warning' as const,
      message: 'Imported cropped layer has no PSD/layer metadata, so its offset may need manual checking.'
    }]
    : undefined
  return {
    ...prepared,
    reviewIssues: missingOffsetIssue
  }
}

export async function importSeeThroughLayerFiles(params: {
  files: File[]
  sourceImage: string
  sourceFileName?: string
  options?: PsdLayerFusionOptions
}): Promise<SplitRuntimePart[]> {
  if (!params.sourceImage) throw new Error('没有导入原图')
  const allFiles = Array.from(params.files || []).filter(Boolean)
  const imageFiles = allFiles.filter((file) => /\.png$/i.test(file.name))
  if (!imageFiles.length) throw new Error('没有找到 See-through PNG 图层')
  const sourceSize = await getSourceSize(params.sourceImage)
  const baseParams = fusionBaseParams(params.sourceImage, params.sourceFileName, params.options)
  const jsonFiles = allFiles.filter((file) => /\.json$/i.test(file.name))
  const parsedJson = await Promise.all(jsonFiles.map(async (file) => {
    try {
      return { file, data: JSON.parse(await fileToText(file)) }
    } catch {
      return null
    }
  }))
  const manifests = parsedJson.filter(Boolean) as Array<{ file: File; data: any }>
  const splitManifest = manifests.find((item) => Array.isArray(item.data?.parts))
  if (splitManifest) {
    const parts = await Promise.all((splitManifest.data.parts as any[]).map(async (entry) => {
      const fileName = String(entry.file || entry.imageFileName || `${entry.id || entry.name || ''}.png`)
      const file = findImageFile(imageFiles, fileName)
      if (!file) return null
      return await importedPartFromCroppedImage(file, {
        id: entry.id || entry.name || layerNameFromFile(file),
        name: entry.name || entry.id || layerNameFromFile(file),
        x: Number(entry.x || 0),
        y: Number(entry.y || 0),
        width: Number(entry.width || 0),
        height: Number(entry.height || 0),
        layer: Number(entry.layer),
        sourceName: entry.prompt
      }, sourceSize, baseParams)
    }))
    return normalizeSpineLayerOrder(parts.filter(Boolean) as SplitRuntimePart[])
  }

  const seeThroughInfo = manifests.find((item) => Array.isArray(item.data?.layers) && Number(item.data?.width) && Number(item.data?.height))
  if (seeThroughInfo) {
    const info = seeThroughInfo.data as SeeThroughLayerInfo
    const parts = await Promise.all(info.layers.map(async (entry, index) => {
      const file = findImageFile(imageFiles, entry.filename)
      if (!file) return null
      const rawDataUrl = await fileToDataUrl(file)
      const normalized = await transformSeeThroughLayer(rawDataUrl, entry, { width: info.width, height: info.height }, sourceSize)
      const part = partFromImportedName(entry.name || layerNameFromFile(file))
      return await prepareSeeThroughPart({ ...part, layer: (part.layer || 50) + index * 0.01 }, normalized.dataUrl, { x: normalized.offsetX, y: normalized.offsetY }, baseParams)
    }))
    return normalizeSpineLayerOrder(parts.filter(Boolean) as SplitRuntimePart[])
  }

  const parts = await Promise.all(imageFiles.map(async (file, index) => {
    return await importedPartFromCroppedImage(file, {
      id: layerNameFromFile(file),
      name: layerNameFromFile(file),
      layer: spineLayerRank({ id: normalizePartId(layerNameFromFile(file)), layer: 50 }) + index * 0.01
    }, sourceSize, baseParams)
  }))
  return normalizeSpineLayerOrder(parts)
}

const fullAlphaFromPart = async (part: SplitRuntimePart, size: { width: number; height: number }) => {
  const alpha = new Uint8ClampedArray(size.width * size.height)
  if (!part.dataUrl) return alpha
  const img = await loadImage(part.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return alpha
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.drawImage(img, Math.round(part.x), Math.round(part.y), Math.max(1, Math.round(part.width)), Math.max(1, Math.round(part.height)))
  const data = ctx.getImageData(0, 0, size.width, size.height).data
  for (let i = 0, p = 3; i < alpha.length; i += 1, p += 4) alpha[i] = data[p]
  return alpha
}

const fullRgbaFromPart = async (part: SplitRuntimePart, size: { width: number; height: number }) => {
  const rgba = new Uint8ClampedArray(size.width * size.height * 4)
  if (!part.dataUrl) return rgba
  const img = await loadImage(part.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return rgba
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.drawImage(img, Math.round(part.x), Math.round(part.y), Math.max(1, Math.round(part.width)), Math.max(1, Math.round(part.height)))
  return ctx.getImageData(0, 0, size.width, size.height).data
}

const fullRgbaFromParts = async (
  parts: SplitRuntimePart[],
  ids: string[],
  size: { width: number; height: number }
) => {
  const wanted = new Set(ids)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return new Uint8ClampedArray(size.width * size.height * 4)
  ctx.clearRect(0, 0, size.width, size.height)
  for (const part of parts) {
    if (!wanted.has(part.id) || !part.dataUrl) continue
    const img = await loadImage(part.dataUrl)
    ctx.drawImage(img, Math.round(part.x), Math.round(part.y), Math.max(1, Math.round(part.width)), Math.max(1, Math.round(part.height)))
  }
  return ctx.getImageData(0, 0, size.width, size.height).data
}

const weaponPixelLooksValid = (
  data: Uint8ClampedArray,
  offset: number,
  y: number,
  size: { width: number; height: number }
) => {
  if (data[offset + 3] <= 8) return false
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const lum = (r + g + b) / 3
  const nearWhiteCloth = lum > 156 && chroma < 46
  const goldOrPommel = sourceLooksLikeGoldTone(data, offset) || (r > 116 && g > 66 && b < 150 && r > b + 18)
  const darkShaft = lum < 122 && !sourceLooksLikeSkinTone(data, offset) && !sourceLooksLikeLeg(data, offset, y, size)
  const redWrap = r > 92 && r > g * 1.22 && r > b * 1.22 && lum < 150
  return !nearWhiteCloth && (goldOrPommel || darkShaft || redWrap)
}

const cleanWeaponPart = async (
  part: SplitRuntimePart,
  params: AiSplitParams,
  size: { width: number; height: number }
) => {
  if (!/^(weapon|weapon_back|weapon_front)$/.test(normalizePartId(part.id)) || !part.dataUrl) return part
  const img = await loadImage(part.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return part
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.drawImage(img, Math.round(part.x), Math.round(part.y), Math.max(1, Math.round(part.width)), Math.max(1, Math.round(part.height)))
  const image = ctx.getImageData(0, 0, size.width, size.height)
  let kept = 0
  let original = 0
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const offset = (y * size.width + x) * 4
      if (image.data[offset + 3] <= 8) continue
      original += 1
      if (weaponPixelLooksValid(image.data, offset, y, size)) {
        kept += 1
        continue
      }
      image.data[offset + 3] = 0
    }
  }
  if (kept < 35 || original <= kept) return part
  ctx.putImageData(image, 0, 0)
  const base = getPartPreset(part.id, part.name)
  const next = await prepareSeeThroughPart(
    { ...base, id: part.id, label: part.name || part.id, prompt: part.prompt, layer: part.layer, pivot: part.pivot },
    canvasToDataUrl(canvas),
    { x: 0, y: 0 },
    params
  )
  return { ...part, ...next, prompt: part.prompt, layer: part.layer, pivot: part.pivot, visible: part.visible, needsInpaint: part.needsInpaint }
}

const mergeAlphaMasks = async (
  parts: SplitRuntimePart[],
  ids: string[],
  size: { width: number; height: number }
) => {
  const wanted = new Set(ids)
  const alpha = new Uint8ClampedArray(size.width * size.height)
  for (const part of parts) {
    if (!wanted.has(part.id)) continue
    const partAlpha = await fullAlphaFromPart(part, size)
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = Math.max(alpha[i], partAlpha[i])
  }
  return alpha
}

const countAlpha = (alpha: Uint8ClampedArray, threshold = 8) => {
  let count = 0
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i] > threshold) count += 1
  return count
}

const maskBounds = (alpha: Uint8ClampedArray, width: number, height: number, threshold = 8) => {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] <= threshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

const filterAlpha = (
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  predicate: (x: number, y: number, value: number) => boolean
) => {
  const out = new Uint8ClampedArray(alpha.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x
      const value = alpha[idx]
      if (value > 8 && predicate(x, y, value)) out[idx] = value
    }
  }
  return out
}

const pruneSmallAlphaComponents = (
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  minPixels = 180
) => {
  const total = Math.min(alpha.length, width * height)
  const visited = new Uint8Array(total)
  const removed = new Uint8ClampedArray(alpha.length)
  const queue: number[] = []
  const component: number[] = []
  for (let start = 0; start < total; start += 1) {
    if (visited[start]) continue
    visited[start] = 1
    if (alpha[start] <= 8) continue
    queue.length = 0
    component.length = 0
    queue.push(start)
    let cursor = 0
    while (cursor < queue.length) {
      const idx = queue[cursor]
      cursor += 1
      component.push(idx)
      const x = idx % width
      const y = Math.floor(idx / width)
      const neighbors = [idx - 1, idx + 1, idx - width, idx + width]
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || alpha[next] <= 8) continue
        const nx = next % width
        const ny = Math.floor(next / width)
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue
        visited[next] = 1
        queue.push(next)
      }
    }
    if (component.length < minPixels) {
      component.forEach((idx) => {
        removed[idx] = alpha[idx]
        alpha[idx] = 0
      })
    }
  }
  return removed
}

const sourceDataForSplit = async (sourceImage: string, size: { width: number; height: number }) => {
  const img = await loadImage(sourceImage)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable while reading source pixels.')
  ctx.drawImage(img, 0, 0, size.width, size.height)
  return ctx.getImageData(0, 0, size.width, size.height).data
}

const layerPartFromAlpha = async (
  parts: SplitRuntimePart[],
  baseIds: string[],
  alpha: Uint8ClampedArray,
  part: PartPreset,
  params: AiSplitParams,
  size: { width: number; height: number }
) => {
  const wanted = new Set(baseIds)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable while rebuilding layered part.')
  ctx.clearRect(0, 0, size.width, size.height)
  for (const base of parts) {
    if (!wanted.has(base.id) || !base.dataUrl) continue
    const img = await loadImage(base.dataUrl)
    ctx.drawImage(img, Math.round(base.x), Math.round(base.y), Math.max(1, Math.round(base.width)), Math.max(1, Math.round(base.height)))
  }
  const image = ctx.getImageData(0, 0, size.width, size.height)
  for (let i = 0, p = 0; i < alpha.length; i += 1, p += 4) {
    const maskAlpha = alpha[i]
    if (maskAlpha <= 8) {
      image.data[p + 3] = 0
      continue
    }
    image.data[p + 3] = Math.round(Math.min(image.data[p + 3], maskAlpha))
  }
  ctx.putImageData(image, 0, 0)
  return await prepareSeeThroughPart(part, canvasToDataUrl(canvas), { x: 0, y: 0 }, params)
}

const sourceLooksLikeLeg = (
  data: Uint8ClampedArray,
  pixelOffset: number,
  y: number,
  size: { width: number; height: number }
) => {
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const brightness = (r + g + b) / 3
  const isGoldTrim = r > 120 && g > 70 && b < 130 && r > b + 30 && g > b * 1.38 && r - g < 75
  const isBrightSkin = !isGoldTrim && r > 118 && g > 55 && b > 35 && r > g * 1.05 && g >= b * 0.72
  const isDarkSkin = !isGoldTrim && y > size.height * 0.34 && r > 82 && g > 38 && b > 25 && r > g + 12 && g >= b * 0.76 && brightness < 180
  const isSkin = isBrightSkin || isDarkSkin
  const isStockingOrShoe = y > size.height * 0.56 && brightness < 105 && chroma < 78 && r >= b * 0.62 && g >= b * 0.45
  return isSkin || isStockingOrShoe
}

const sourceLooksLikeLegFillTone = (data: Uint8ClampedArray, pixelOffset: number) => {
  if (data[pixelOffset + 3] <= 8) return false
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  const brightness = (r + g + b) / 3
  return brightness > 24
}

const sourceLooksLikeDarkLegAccessory = (
  sourceData: Uint8ClampedArray,
  layerData: Uint8ClampedArray,
  pixelOffset: number,
  y: number,
  size: { width: number; height: number }
) => {
  if (sourceData[pixelOffset + 3] <= 8 || layerData[pixelOffset + 3] <= 8 || sourceLooksLikeGoldTone(sourceData, pixelOffset)) return false
  const lum = (sourceData[pixelOffset] + sourceData[pixelOffset + 1] + sourceData[pixelOffset + 2]) / 3
  return y > size.height * 0.48 && lum < 105 && sourceRgbDistance(sourceData, layerData, pixelOffset) <= 118
}
void sourceLooksLikeDarkLegAccessory

const sourceRgbDistance = (a: Uint8ClampedArray, b: Uint8ClampedArray, offset: number) => {
  const dr = a[offset] - b[offset]
  const dg = a[offset + 1] - b[offset + 1]
  const db = a[offset + 2] - b[offset + 2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

const rgbDistanceToColor = (data: Uint8ClampedArray, offset: number, color: { r: number; g: number; b: number }) => {
  const dr = data[offset] - color.r
  const dg = data[offset + 1] - color.g
  const db = data[offset + 2] - color.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

const medianValue = (values: number[]) => {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const sampleAlphaBorderColor = (
  data: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  bounds: NonNullable<ReturnType<typeof maskBounds>>,
  size: { width: number; height: number }
) => {
  const samples: Array<[number, number, number]> = []
  const edge = 5
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const nearEdge = x - bounds.minX <= edge || bounds.maxX - x <= edge || y - bounds.minY <= edge || bounds.maxY - y <= edge
      if (!nearEdge) continue
      const idx = y * size.width + x
      const offset = idx * 4
      if (alpha[idx] <= 8 || data[offset + 3] <= 8) continue
      samples.push([data[offset], data[offset + 1], data[offset + 2]])
    }
  }
  if (samples.length < 12) return null
  return {
    r: medianValue(samples.map((sample) => sample[0])),
    g: medianValue(samples.map((sample) => sample[1])),
    b: medianValue(samples.map((sample) => sample[2]))
  }
}

const buildLegMaterialAlpha = (
  rawAlpha: Uint8ClampedArray,
  legData: Uint8ClampedArray,
  sourceData: Uint8ClampedArray,
  size: { width: number; height: number }
) => {
  const bounds = maskBounds(rawAlpha, size.width, size.height)
  if (!bounds) return rawAlpha
  const matte = sampleAlphaBorderColor(legData, rawAlpha, bounds, size)
  if (!matte) return rawAlpha
  const out = new Uint8ClampedArray(rawAlpha.length)
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const idx = y * size.width + x
      const offset = idx * 4
      if (rawAlpha[idx] <= 8 || legData[offset + 3] <= 8) continue
      const fromSource = sourceLooksLikeLeg(sourceData, offset, y, size)
      const fromLayer = sourceLooksLikeLeg(legData, offset, y, size)
      const separatedLegFill = rgbDistanceToColor(legData, offset, matte) > 18 && sourceLooksLikeLegFillTone(legData, offset)
      if (fromSource || fromLayer || separatedLegFill) out[idx] = rawAlpha[idx]
    }
  }
  pruneSmallAlphaComponents(out, size.width, size.height, 180)
  return countAlpha(out) >= 120 ? out : rawAlpha
}

const sourceLooksLikeSkinTone = (data: Uint8ClampedArray, pixelOffset: number) => {
  if (data[pixelOffset + 3] <= 8) return false
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lum = (r + g + b) / 3
  const goldLike = r > 112 && g > 62 && b < 154 && r > b + 22 && g > b + 6
  const nearWhiteDecor = lum > 202 && max - min < 42
  const redRibbon = r > 105 && r > g * 1.26 && r > b * 1.26 && lum < 156
  if (goldLike || nearWhiteDecor || redRibbon) return false
  return lum > 65 && max - min > 18 && r > g * 0.96 && r > b * 1.08 && g >= b * 0.58 && g < b * 1.72
}

const sourceLooksLikeHairTone = (data: Uint8ClampedArray, pixelOffset: number) => {
  if (data[pixelOffset + 3] <= 8 || sourceLooksLikeSkinTone(data, pixelOffset)) return false
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  const lum = (r + g + b) / 3
  const isDarkHair = lum < 112 && Math.abs(r - g) < 48 && Math.abs(g - b) < 58
  const isWarmTip = r > 48 && r > g + 12 && g >= b * 0.48 && lum < 145
  return isDarkHair || isWarmTip
}

const sourceLooksLikeGoldTone = (data: Uint8ClampedArray, pixelOffset: number) => {
  if (data[pixelOffset + 3] <= 8) return false
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  return r > 105 && g > 58 && b < 150 && r > b + 22 && g > b * 1.38
}

const sourceLooksLikeClothTone = (
  data: Uint8ClampedArray,
  pixelOffset: number,
  y: number,
  size: { width: number; height: number }
) => {
  if (data[pixelOffset + 3] <= 8 || sourceLooksLikeLeg(data, pixelOffset, y, size) || sourceLooksLikeSkinTone(data, pixelOffset)) return false
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const lum = (r + g + b) / 3
  const redRibbon = r > 88 && r > g * 1.18 && r > b * 1.24
  return sourceLooksLikeGoldTone(data, pixelOffset) || lum < 102 || (chroma <= 54 && lum >= 45 && lum <= 220) || redRibbon
}

const sourceRgbCompatibleWithPart = (
  partId: string,
  sourceData: Uint8ClampedArray,
  layerData: Uint8ClampedArray,
  pixelOffset: number,
  y: number,
  size: { width: number; height: number }
) => {
  if (sourceData[pixelOffset + 3] <= 8 || layerData[pixelOffset + 3] <= 8) return false
  const id = normalizePartId(partId)
  const distance = sourceRgbDistance(sourceData, layerData, pixelOffset)
  if (/^(face|neck|ears_l|ears_r)$/.test(id)) return sourceLooksLikeSkinTone(sourceData, pixelOffset)
  if (/^(left_hand|right_hand|left_arm|right_arm|left_upper_arm|right_upper_arm|left_forearm|right_forearm)$/.test(id)) {
    return sourceLooksLikeSkinTone(sourceData, pixelOffset) || (distance <= 118 && sourceLooksLikeClothTone(sourceData, pixelOffset, y, size))
  }
  if (/^(left_thigh|right_thigh)$/.test(id)) {
    return sourceLooksLikeSkinTone(sourceData, pixelOffset) && !sourceLooksLikeGoldTone(sourceData, pixelOffset)
  }
  if (/^(left_thigh|right_thigh|left_shin|right_shin|left_foot|right_foot|left_leg|right_leg)$/.test(id)) {
    return (sourceLooksLikeLeg(sourceData, pixelOffset, y, size) && !sourceLooksLikeGoldTone(sourceData, pixelOffset) && distance <= 74)
  }
  if (/^(skirt|skirt_front|skirt_back|body|cloth_front|cape)$/.test(id)) return sourceLooksLikeClothTone(sourceData, pixelOffset, y, size)
  if (/^(hair|hair_front|hair_back)$/.test(id)) return sourceLooksLikeHairTone(sourceData, pixelOffset) || distance <= 82
  if (id === 'headwear') return sourceLooksLikeHairTone(sourceData, pixelOffset) || sourceLooksLikeGoldTone(sourceData, pixelOffset) || distance <= 82
  if (/^(weapon|weapon_back|weapon_front)$/.test(id)) {
    return !sourceLooksLikeSkinTone(sourceData, pixelOffset) && (sourceLooksLikeGoldTone(sourceData, pixelOffset) || distance <= 128)
  }
  return distance <= 100
}

const drawPartOnSourceFrame = async (part: SplitRuntimePart, size: { width: number; height: number }) => {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable while preparing fusion layer.')
  ctx.clearRect(0, 0, size.width, size.height)
  if (part.dataUrl) {
    const img = await loadImage(part.dataUrl)
    ctx.drawImage(img, Math.round(part.x), Math.round(part.y), Math.max(1, Math.round(part.width)), Math.max(1, Math.round(part.height)))
  }
  return ctx.getImageData(0, 0, size.width, size.height)
}

const hasNearbyGeneratedPixel = (
  completeAlpha: Uint8ClampedArray,
  visibleMask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number
) => {
  if (radius <= 0) return false
  for (let dy = -radius; dy <= radius; dy += 1) {
    const ny = y + dy
    if (ny < 0 || ny >= height) continue
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue
      if (Math.abs(dx) + Math.abs(dy) > radius) continue
      const nx = x + dx
      if (nx < 0 || nx >= width) continue
      const idx = ny * width + nx
      if (completeAlpha[idx] > 8 && !visibleMask[idx]) return true
    }
  }
  return false
}

const fusePartWithSourcePixels = async (
  part: SplitRuntimePart,
  sourceData: Uint8ClampedArray,
  sourceImage: string,
  visibleAlpha?: Uint8ClampedArray,
  options?: PsdLayerFusionOptions
) => {
  if (!part.dataUrl) return part
  const size = await getSourceSize(sourceImage)
  const layer = await drawPartOnSourceFrame(part, size)
  const outCanvas = document.createElement('canvas')
  outCanvas.width = size.width
  outCanvas.height = size.height
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true })
  if (!outCtx) throw new Error('Canvas unavailable while fusing PSD layer.')
  const output = outCtx.createImageData(size.width, size.height)
  const completeAlpha = new Uint8ClampedArray(size.width * size.height)
  const visibleMask = new Uint8Array(size.width * size.height)
  let completePixels = 0
  let restoredPixels = 0
  const id = normalizePartId(part.id)
  const sourcePriority = options?.sourcePriority || 'high'
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const idx = y * size.width + x
      const offset = idx * 4
      const alpha = layer.data[offset + 3]
      if (alpha <= 8) continue
      completeAlpha[idx] = alpha
      completePixels += 1
      const distance = sourceRgbDistance(sourceData, layer.data, offset)
      const compatible = sourceRgbCompatibleWithPart(id, sourceData, layer.data, offset, y, size)
      const looseMatch = sourcePriority === 'high' && distance <= (/^(hair|hair_front|hair_back|weapon|skirt|skirt_front|skirt_back|body|cape)$/.test(id) ? 138 : 118)
      if (visibleAlpha && visibleAlpha[idx] > 8 && (compatible || looseMatch)) {
        visibleMask[idx] = 1
        restoredPixels += 1
      }
    }
  }

  const feather = Math.max(0, Math.min(12, Math.round(options?.featherPx ?? 4)))
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const idx = y * size.width + x
      const offset = idx * 4
      const alpha = completeAlpha[idx]
      if (alpha <= 8) continue
      if (visibleMask[idx]) {
        const seam = hasNearbyGeneratedPixel(completeAlpha, visibleMask, size.width, size.height, x, y, feather)
        const sourceWeight = seam ? 0.78 : 1
        output.data[offset] = Math.round(sourceData[offset] * sourceWeight + layer.data[offset] * (1 - sourceWeight))
        output.data[offset + 1] = Math.round(sourceData[offset + 1] * sourceWeight + layer.data[offset + 1] * (1 - sourceWeight))
        output.data[offset + 2] = Math.round(sourceData[offset + 2] * sourceWeight + layer.data[offset + 2] * (1 - sourceWeight))
        output.data[offset + 3] = Math.round(alpha * Math.min(255, sourceData[offset + 3] || 255) / 255)
      } else {
        output.data[offset] = layer.data[offset]
        output.data[offset + 1] = layer.data[offset + 1]
        output.data[offset + 2] = layer.data[offset + 2]
        output.data[offset + 3] = alpha
      }
    }
  }

  outCtx.putImageData(output, 0, 0)
  const baseParams = fusionBaseParams(sourceImage, undefined, options)
  const cleaned = options?.edgeMode === 'keep'
    ? canvasToDataUrl(outCanvas)
    : await edgeCleanDataUrl(canvasToDataUrl(outCanvas), options?.edgeMode || 'removeWhite', part.id)
  const preset = { ...partFromImportedName(part.id, part.layer), pivot: part.pivot, layer: part.layer }
  const cropped = await createMaskAndCrop(cleaned, preset, baseParams)
  const generatedRatio = completePixels > 0 ? 1 - restoredPixels / completePixels : 0
  const reviewIssues = [...(part.reviewIssues || [])]
  if (completePixels > 0 && restoredPixels / completePixels < 0.25) {
    reviewIssues.push({
      code: 'low_source_pixel_restore',
      severity: 'warning',
      message: 'Only a small part of this layer matched the original source pixels; check alignment or layer metadata.',
      value: restoredPixels / completePixels
    })
  }
  return {
    ...part,
    x: cropped.x,
    y: cropped.y,
    width: cropped.width,
    height: cropped.height,
    dataUrl: cropped.dataUrl,
    maskDataUrl: cropped.maskDataUrl,
    originalWidth: cropped.originalWidth,
    originalHeight: cropped.originalHeight,
    generatedRatio,
    sourceFidelity: completePixels > 0 ? restoredPixels / completePixels : 1,
    reviewIssues: reviewIssues.length ? reviewIssues : undefined
  }
}

export async function fuseSeeThroughPartsWithSource(params: {
  sourceImage: string
  parts: SplitRuntimePart[]
  options?: PsdLayerFusionOptions
}): Promise<SplitRuntimePart[]> {
  if (!params.sourceImage) throw new Error('没有导入原图')
  if (!params.parts.length) throw new Error('没有导入 See-through 图层')
  const size = await getSourceSize(params.sourceImage)
  const sourceData = await sourceDataForSplit(params.sourceImage, size)
  const ordered = normalizeSpineLayerOrder(params.parts)
  const visibleByPart = await buildSourceVisibleAlphaByPart(ordered, size)
  const fused = await Promise.all(ordered.map((part) => fusePartWithSourcePixels(part, sourceData, params.sourceImage, visibleByPart.get(part.id), params.options)))
  return normalizeSpineLayerOrder(fused)
}

const partAlphaOnSourceCanvas = async (part: SplitRuntimePart, size: { width: number; height: number }) => {
  const alpha = new Uint8ClampedArray(size.width * size.height)
  if (!part.dataUrl) return alpha
  const img = await loadImage(part.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return alpha
  ctx.drawImage(img, Math.round(part.x), Math.round(part.y), Math.max(1, Math.round(part.width)), Math.max(1, Math.round(part.height)))
  const image = ctx.getImageData(0, 0, size.width, size.height)
  for (let i = 0, p = 0; i < alpha.length; i += 1, p += 4) alpha[i] = image.data[p + 3]
  return alpha
}

const buildSourceVisibleAlphaByPart = async (
  parts: SplitRuntimePart[],
  size: { width: number; height: number }
) => {
  const ordered = orderPartsForComposite(parts)
  const alphas = await Promise.all(ordered.map((part) => partAlphaOnSourceCanvas(part, size)))
  const frontCoverage = new Uint8ClampedArray(size.width * size.height)
  const visibleByPart = new Map<string, Uint8ClampedArray>()
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const alpha = alphas[i]
    const visible = new Uint8ClampedArray(alpha.length)
    for (let p = 0; p < alpha.length; p += 1) {
      if (alpha[p] <= 8) continue
      if (frontCoverage[p] <= 8) visible[p] = 255
      frontCoverage[p] = 255
    }
    visibleByPart.set(ordered[i].id, visible)
  }
  return visibleByPart
}

const erodeAlpha = (alpha: Uint8ClampedArray, size: { width: number; height: number }, radius: number) => {
  if (radius <= 0) return alpha
  const out = new Uint8ClampedArray(alpha.length)
  const { width, height } = size
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x
      if (alpha[idx] <= 8) continue
      let keep = true
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || alpha[ny * width + nx] <= 8) {
            keep = false
            break
          }
        }
      }
      if (keep) out[idx] = alpha[idx]
    }
  }
  return out
}

const shouldInsetSourceRestore = (partId: string) => {
  const id = normalizePartId(partId)
  if (/^(eyewhite_l|eyewhite_r|irides_l|irides_r|eyelash_l|eyelash_r|eyebrow_l|eyebrow_r|mouth|nose)$/.test(id)) return false
  if (/^(weapon|weapon_back|weapon_front)$/.test(id)) return false
  return true
}

const countAlphaPixels = (alpha: Uint8ClampedArray) => {
  let count = 0
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i] > 8) count += 1
  return count
}
void buildSourceVisibleAlphaByPart
void erodeAlpha
void shouldInsetSourceRestore
void countAlphaPixels

const isLegSplitPart = (partId: string) => /^(left_thigh|right_thigh|left_shin|right_shin|left_foot|right_foot|left_leg|right_leg)$/.test(normalizePartId(partId))

const smoothHiddenLegPixels = (image: ImageData, partId: string, restoredMask: Uint8ClampedArray) => {
  if (!isLegSplitPart(partId)) return 0
  const { width, height, data } = image
  const globalSamples: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const offset = pixel * 4
      if (data[offset + 3] <= 24 || restoredMask[pixel] <= 8) continue
      globalSamples.push(data[offset], data[offset + 1], data[offset + 2])
    }
  }
  if (globalSamples.length < 9) return 0
  const fallback = {
    r: medianValue(globalSamples.filter((_, idx) => idx % 3 === 0)),
    g: medianValue(globalSamples.filter((_, idx) => idx % 3 === 1)),
    b: medianValue(globalSamples.filter((_, idx) => idx % 3 === 2))
  }
  const updates: Array<{ offset: number; r: number; g: number; b: number }> = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const offset = pixel * 4
      if (data[offset + 3] <= 8 || restoredMask[pixel] > 8) continue
      const lum = (data[offset] + data[offset + 1] + data[offset + 2]) / 3
      if (lum < 80 && y > height * 0.45) continue
      updates.push({
        offset,
        r: Math.round(data[offset] * 0.08 + fallback.r * 0.92),
        g: Math.round(data[offset + 1] * 0.08 + fallback.g * 0.92),
        b: Math.round(data[offset + 2] * 0.08 + fallback.b * 0.92)
      })
    }
  }
  for (const update of updates) {
    data[update.offset] = update.r
    data[update.offset + 1] = update.g
    data[update.offset + 2] = update.b
  }
  return updates.length
}
void smoothHiddenLegPixels

const cleanThighMaterial = (image: ImageData, partId: string) => {
  void image
  void partId
  return 0
}

const restoreVisibleSourcePixels = async (
  part: SplitRuntimePart,
  sourceData: Uint8ClampedArray,
  params: AiSplitParams,
  size: { width: number; height: number },
  sourceVisibleAlpha?: Uint8ClampedArray
) => {
  if (!part.dataUrl) return part
  if (!sourceVisibleAlpha) return part
  const restoreAlpha = sourceVisibleAlpha
  const img = await loadImage(part.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return part
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.drawImage(img, Math.round(part.x), Math.round(part.y), Math.max(1, Math.round(part.width)), Math.max(1, Math.round(part.height)))
  const image = ctx.getImageData(0, 0, size.width, size.height)
  let restored = 0
  const restoredMask = new Uint8ClampedArray(size.width * size.height)
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const pixel = y * size.width + x
      const offset = pixel * 4
      if (image.data[offset + 3] <= 8) continue
      if (restoreAlpha[pixel] <= 8) continue
      if (!sourceRgbCompatibleWithPart(part.id, sourceData, image.data, offset, y, size)) continue
      image.data[offset] = sourceData[offset]
      image.data[offset + 1] = sourceData[offset + 1]
      image.data[offset + 2] = sourceData[offset + 2]
      image.data[offset + 3] = Math.max(image.data[offset + 3], sourceData[offset + 3])
      restoredMask[pixel] = 255
      restored += 1
    }
  }
  void restoredMask
  const cleaned = cleanThighMaterial(image, part.id)
  if (!restored && !cleaned) return part
  cleanWhiteEdgeMatte(image, part.id)
  ctx.putImageData(image, 0, 0)
  const preset = { ...getPartPreset(part.id, part.prompt), id: part.id, label: part.name || part.id, prompt: part.prompt, layer: part.layer, pivot: part.pivot }
  const next = await prepareSeeThroughPart(preset, canvasToDataUrl(canvas), { x: 0, y: 0 }, params)
  return { ...part, ...next, prompt: part.prompt, layer: part.layer, pivot: part.pivot, visible: part.visible, needsInpaint: part.needsInpaint }
}

const restoreVisibleSourceForParts = async (
  parts: SplitRuntimePart[],
  sourceData: Uint8ClampedArray,
  params: AiSplitParams,
  size: { width: number; height: number }
) => {
  const visibleByPart = await buildSourceVisibleAlphaByPart(parts, size)
  const outputs: SplitRuntimePart[] = []
  for (const part of parts) outputs.push(await restoreVisibleSourcePixels(part, sourceData, params, size, visibleByPart.get(part.id)))
  return normalizeSpineLayerOrder(outputs)
}

const reviewIssue = (code: string, severity: SplitReviewSeverity, message: string, value?: number): SplitReviewIssue => ({
  code,
  severity,
  message,
  value: Number.isFinite(value) ? Math.round(Number(value) * 1000) / 1000 : undefined
})

const hasRejectIssue = (part: SplitRuntimePart) => Boolean(part.reviewIssues?.some((issue) => issue.severity === 'reject'))

const withReviewIssue = (part: SplitRuntimePart, issue: SplitReviewIssue): SplitRuntimePart => ({
  ...part,
  spineReady: false,
  reviewIssues: [...(part.reviewIssues || []), issue]
})

const reviewSpinePart = async (
  part: SplitRuntimePart,
  sourceData: Uint8ClampedArray,
  size: { width: number; height: number }
): Promise<SplitRuntimePart> => {
  if (!part.dataUrl) return part
  const data = await fullRgbaFromPart(part, size)
  const alpha = new Uint8ClampedArray(size.width * size.height)
  let opaque = 0
  let compatible = 0
  let whiteEdge = 0
  let skin = 0
  let leg = 0
  let cloth = 0
  let gold = 0
  let nonWeapon = 0
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const pixel = y * size.width + x
      const offset = pixel * 4
      const a = data[offset + 3]
      alpha[pixel] = a
      if (a <= 8) continue
      opaque += 1
      if (sourceRgbCompatibleWithPart(part.id, sourceData, data, offset, y, size)) compatible += 1
      if (isPartEdgeMattePixel(data, offset, part.id) && hasTransparentNeighbor(data, size.width, size.height, x, y, 2)) whiteEdge += 1
      if (sourceLooksLikeSkinTone(data, offset)) skin += 1
      if (sourceLooksLikeLeg(data, offset, y, size)) leg += 1
      if (sourceLooksLikeClothTone(data, offset, y, size)) cloth += 1
      if (sourceLooksLikeGoldTone(data, offset)) gold += 1
      if (/^(weapon|weapon_back|weapon_front)$/.test(normalizePartId(part.id)) && !weaponPixelLooksValid(data, offset, y, size)) nonWeapon += 1
    }
  }
  if (!opaque) return { ...part, spineReady: false, reviewIssues: [reviewIssue('empty_part', 'reject', 'Layer is empty after split.')] }

  const alphaForSpeckles = new Uint8ClampedArray(alpha)
  const removedSpeckles = pruneSmallAlphaComponents(alphaForSpeckles, size.width, size.height, Math.max(32, Math.round(opaque * 0.006)))
  const speckleRatio = countAlpha(removedSpeckles) / opaque
  const whiteEdgeRatio = whiteEdge / opaque
  const sourceFidelity = compatible / opaque
  const generatedRatio = 1 - sourceFidelity
  const id = normalizePartId(part.id)
  const issues: SplitReviewIssue[] = []
  const tinyFacePart = /^(ears_l|ears_r|eyewhite_l|eyewhite_r|irides_l|irides_r|eyelash_l|eyelash_r|eyebrow_l|eyebrow_r|mouth|nose|headwear|earwear|hair_ribbon|accessory.*)$/.test(id)

  if (!tinyFacePart && whiteEdgeRatio > 0.055) issues.push(reviewIssue('edge_matte', 'reject', 'Visible white/bright edge matte remains on the layer.', whiteEdgeRatio))
  else if (!tinyFacePart && whiteEdgeRatio > 0.022) issues.push(reviewIssue('edge_matte', 'warning', 'Layer edge still has visible matte pixels.', whiteEdgeRatio))

  if (!tinyFacePart && speckleRatio > 0.095) issues.push(reviewIssue('speckles', 'reject', 'Layer contains too many isolated fragments.', speckleRatio))
  else if (!tinyFacePart && speckleRatio > 0.045) issues.push(reviewIssue('speckles', 'warning', 'Layer contains isolated fragments that should be reviewed.', speckleRatio))

  if (isLegSplitPart(id)) {
    const foreignRatio = (cloth + gold) / opaque
    if (foreignRatio > 0.28) issues.push(reviewIssue('leg_foreign_material', 'reject', 'Leg split contains too much skirt/trim material.', foreignRatio))
    else if (foreignRatio > 0.045) issues.push(reviewIssue('leg_foreign_material', 'warning', 'Leg split may include skirt/trim material.', foreignRatio))
    if (sourceFidelity < 0.12) issues.push(reviewIssue('low_source_fidelity', 'warning', 'Most pixels are generated completion rather than source-preserved texture.', sourceFidelity))
  }

  if (/^(skirt_front|skirt_back|cape)$/.test(id)) {
    const skinRatio = (skin + leg) / opaque
    if (skinRatio > 0.18) issues.push(reviewIssue('cloth_skin_contamination', 'warning', 'Cloth layer may include skin/leg material.', skinRatio))
    else if (skinRatio > 0.075) issues.push(reviewIssue('cloth_skin_contamination', 'warning', 'Cloth layer may include skin/leg material.', skinRatio))
  }

  if (/^(weapon|weapon_back|weapon_front)$/.test(id)) {
    const nonWeaponRatio = nonWeapon / opaque
    if (nonWeaponRatio > 0.16) issues.push(reviewIssue('weapon_foreign_material', 'reject', 'Weapon layer contains too much cloth/skin/generated material.', nonWeaponRatio))
    else if (nonWeaponRatio > 0.06) issues.push(reviewIssue('weapon_foreign_material', 'warning', 'Weapon layer may include cloth/skin/generated material.', nonWeaponRatio))
  }

  return {
    ...part,
    spineReady: !issues.some((issue) => issue.severity === 'reject'),
    sourceFidelity,
    generatedRatio,
    reviewIssues: issues.length ? issues : undefined
  }
}

const reviewSpineParts = async (
  parts: SplitRuntimePart[],
  sourceData: Uint8ClampedArray,
  size: { width: number; height: number }
) => {
  const reviewed: SplitRuntimePart[] = []
  for (const part of parts) reviewed.push(await reviewSpinePart(part, sourceData, size))
  return normalizeSpineLayerOrder(reviewed)
}

const addFallbackReview = (parts: SplitRuntimePart[], ids: string[], code: string, message: string) => {
  const idSet = new Set(ids.map(normalizePartId))
  return parts.map((part) => idSet.has(normalizePartId(part.id))
    ? withReviewIssue(part, reviewIssue(code, 'warning', message))
    : part)
}

const skirtPixelLooksLikeBackLayer = (
  data: Uint8ClampedArray,
  pixelOffset: number,
  xNorm: number,
  yNorm: number,
  sourceIsLeg: boolean
) => {
  if (data[pixelOffset + 3] <= 8) return false
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const lum = (r + g + b) / 3
  const isWarmTrimOrSkin = r > g + 18 && r > b + 24
  const isDarkFrontCloth = lum < 78
  const isRearLiningTone = chroma <= 36 && lum >= 78 && lum <= 188 && !isWarmTrimOrSkin
  const isSideRearLining = yNorm >= 0.22 && (xNorm <= 0.28 || xNorm >= 0.68)
  const isCenterRearLining = yNorm >= 0.42
  const isHiddenBehindLegLining = sourceIsLeg && yNorm >= 0.18
  const isRearLiningRegion = isSideRearLining || isCenterRearLining || isHiddenBehindLegLining
  return isRearLiningTone && isRearLiningRegion && !isDarkFrontCloth
}

const skirtPixelLooksLikeLowerRearTrace = (
  data: Uint8ClampedArray,
  pixelOffset: number,
  xNorm: number,
  yNorm: number
) => {
  if (data[pixelOffset + 3] <= 8 || yNorm < 0.74 || xNorm < 0.18 || xNorm > 0.82) return false
  const r = data[pixelOffset]
  const g = data[pixelOffset + 1]
  const b = data[pixelOffset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const lum = (r + g + b) / 3
  const isGoldTrim = r > 116 && g > 70 && b < 125 && r > b + 28 && g > b + 4
  return !isGoldTrim && chroma <= 45 && lum >= 38 && lum <= 150
}

const splitSkirtForSpine = async (
  parts: SplitRuntimePart[],
  params: AiSplitParams,
  size: { width: number; height: number },
  sourceData: Uint8ClampedArray
) => {
  const skirtPart = parts.find((part) => part.id === 'skirt' && part.dataUrl)
  const skirtAlpha = await mergeAlphaMasks(parts, ['skirt'], size)
  if (!skirtPart || countAlpha(skirtAlpha) < 80) return null
  const skirtData = await fullRgbaFromPart(skirtPart, size)
  const bounds = maskBounds(skirtAlpha, size.width, size.height)
  if (!bounds) return null
  const backAlpha = filterAlpha(skirtAlpha, size.width, size.height, (x, y) => {
    const idx = y * size.width + x
    const yNorm = (y - bounds.minY) / Math.max(1, bounds.height)
    const xNorm = (x - bounds.minX) / Math.max(1, bounds.width)
    const sourceIsLeg = sourceLooksLikeLeg(sourceData, idx * 4, y, size)
    return skirtPixelLooksLikeBackLayer(skirtData, idx * 4, xNorm, yNorm, sourceIsLeg)
  })
  const removedBackNoise = pruneSmallAlphaComponents(backAlpha, size.width, size.height, 220)
  if (countAlpha(backAlpha) < 40) return null
  const frontAlpha = filterAlpha(skirtAlpha, size.width, size.height, (_x, _y, _value) => {
    const idx = _y * size.width + _x
    const yNorm = (_y - bounds.minY) / Math.max(1, bounds.height)
    const xNorm = (_x - bounds.minX) / Math.max(1, bounds.width)
    return backAlpha[idx] <= 8 && removedBackNoise[idx] <= 8 && !skirtPixelLooksLikeLowerRearTrace(skirtData, idx * 4, xNorm, yNorm)
  })
  const frontCount = countAlpha(frontAlpha)
  if (frontCount < 40) return null
  const backPreset = { ...getPartPreset('skirt', 'skirt_back'), id: 'skirt_back', label: 'skirt_back', layer: 24, pivot: { x: 0.5, y: 0.08 } }
  const frontPreset = { ...getPartPreset('skirt', 'skirt_front'), id: 'skirt_front', label: 'skirt_front', layer: 76, pivot: { x: 0.5, y: 0.08 } }
  return [
    await layerPartFromAlpha(parts, ['skirt'], backAlpha, { ...backPreset, prompt: 'rear skirt lining behind legs' }, params, size),
    await layerPartFromAlpha(parts, ['skirt'], frontAlpha, { ...frontPreset, prompt: 'front skirt panels above legs' }, params, size)
  ]
}

const splitLegsForSpine = async (
  parts: SplitRuntimePart[],
  params: AiSplitParams,
  size: { width: number; height: number },
  sourceData: Uint8ClampedArray
) => {
  const legBaseIds = ['legwear', 'left_leg', 'right_leg']
  const footBaseIds = ['footwear', 'left_foot', 'right_foot', ...legBaseIds]
  const rawLegAlpha = filterAlpha(await mergeAlphaMasks(parts, legBaseIds, size), size.width, size.height, (_x, _y, value) => value >= 48)
  const legData = await fullRgbaFromParts(parts, legBaseIds, size)
  const legAlpha = filterAlpha(buildLegMaterialAlpha(rawLegAlpha, legData, sourceData, size), size.width, size.height, (_x, _y, value) => value >= 48)
  if (countAlpha(legAlpha) < 120) return null
  const legAndFootAlpha = filterAlpha(await mergeAlphaMasks(parts, footBaseIds, size), size.width, size.height, (_x, _y, value) => value >= 48)
  const footwearAlpha = filterAlpha(await mergeAlphaMasks(parts, ['footwear', 'left_foot', 'right_foot'], size), size.width, size.height, (_x, _y, value) => value >= 32)
  const outputs: SplitRuntimePart[] = []
  const centerX = size.width * 0.5
  const sideDefs = [
    { side: 'left', keep: (x: number) => x < centerX, layers: { thigh: 42, shin: 44, foot: 45 } },
    { side: 'right', keep: (x: number) => x >= centerX, layers: { thigh: 46, shin: 48, foot: 49 } }
  ]
  for (const def of sideDefs) {
    const sideAlpha = filterAlpha(legAlpha, size.width, size.height, (x, y) => def.keep(x) && y > size.height * 0.38)
    pruneSmallAlphaComponents(sideAlpha, size.width, size.height, 900)
    const bounds = maskBounds(sideAlpha, size.width, size.height)
    if (!bounds || countAlpha(sideAlpha) < 60) continue
    const kneeY = bounds.minY + bounds.height * 0.47
    const footCutY = bounds.minY + bounds.height * 0.84
    const footAlpha = filterAlpha(legAndFootAlpha, size.width, size.height, (x, y) => {
      const idx = y * size.width + x
      return def.keep(x) && sideAlpha[idx] > 8 && (footwearAlpha[idx] > 8 || y >= footCutY)
    })
    const thighAlpha = filterAlpha(sideAlpha, size.width, size.height, (_x, y) => y < kneeY)
    const shinAlpha = filterAlpha(sideAlpha, size.width, size.height, (x, y) => {
      const idx = y * size.width + x
      return y >= kneeY && footAlpha[idx] <= 8
    })
    const specs = [
      { id: `${def.side}_thigh`, alpha: thighAlpha, layer: def.layers.thigh, baseIds: legBaseIds },
      { id: `${def.side}_shin`, alpha: shinAlpha, layer: def.layers.shin, baseIds: legBaseIds },
      { id: `${def.side}_foot`, alpha: footAlpha, layer: def.layers.foot, baseIds: footBaseIds }
    ]
    for (const spec of specs) {
      if (countAlpha(spec.alpha) < 30) continue
      const base = getPartPreset(spec.id, spec.id)
      outputs.push(await layerPartFromAlpha(parts, spec.baseIds, spec.alpha, { ...base, id: spec.id, label: spec.id, layer: spec.layer }, params, size))
    }
  }
  return outputs.length >= 4 ? outputs : null
}

const isLikelyWhiteArtifact = async (part: SplitRuntimePart) => {
  if (part.id !== 'wing' || !part.dataUrl) return false
  const img = await loadImage(part.dataUrl)
  const width = Math.max(1, img.naturalWidth || img.width || 1)
  const height = Math.max(1, img.naturalHeight || img.height || 1)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, width, height).data
  let opaque = 0
  let white = 0
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] <= 16) continue
    opaque += 1
    if (data[p] > 232 && data[p + 1] > 232 && data[p + 2] > 232) white += 1
  }
  return opaque > 80 && white / Math.max(1, opaque) > 0.48
}

const applySpineSplitPostProcess = async (
  parts: SplitRuntimePart[],
  sourceImage: string,
  params: AiSplitParams
) => {
  const size = await getSourceSize(sourceImage)
  const sourceData = await sourceDataForSplit(sourceImage, size)
  const cleaned: SplitRuntimePart[] = []
  for (const part of parts) {
    if (await isLikelyWhiteArtifact(part)) continue
    cleaned.push(await cleanWeaponPart(part, params, size))
  }
  const additions: SplitRuntimePart[] = []
  const splitSkirt = await splitSkirtForSpine(cleaned, params, size, sourceData)
  const splitLegs = await splitLegsForSpine(cleaned, params, size, sourceData)

  const buildReviewedOutput = async (
    skirtParts: SplitRuntimePart[] | null,
    legParts: SplitRuntimePart[] | null
  ) => {
    const removeIds = new Set<string>()
    additions.length = 0
    if (skirtParts) {
      removeIds.add('skirt')
      additions.push(...skirtParts)
    }
    if (legParts) {
      removeIds.add('legwear')
      removeIds.add('footwear')
      removeIds.add('left_leg')
      removeIds.add('right_leg')
      removeIds.add('left_foot')
      removeIds.add('right_foot')
      additions.push(...legParts)
    }
    const ordered = normalizeSpineLayerOrder([...cleaned.filter((part) => !removeIds.has(part.id)), ...additions])
    const restored = await restoreVisibleSourceForParts(ordered, sourceData, params, size)
    return await reviewSpineParts(restored, sourceData, size)
  }

  const primary = await buildReviewedOutput(splitSkirt, splitLegs)
  const legRejected = primary.some((part) => isLegSplitPart(part.id) && hasRejectIssue(part))
  if (!legRejected) return primary

  let fallback = await buildReviewedOutput(splitSkirt, null)
  if (legRejected) {
    fallback = addFallbackReview(fallback, ['legwear', 'left_foot', 'right_foot', 'footwear'], 'auto_leg_split_rejected', 'Automatic thigh/shin split was rejected by delivery QA; kept the cleaner base leg layer for review.')
  }
  return normalizeSpineLayerOrder(fallback)
}

const isNearWhitePixel = (data: Uint8ClampedArray, offset: number) => {
  if (data[offset + 3] <= 8) return false
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return r > 232 && g > 232 && b > 232 && max - min < 30
}

const removeIsolatedWhiteMattePixels = (image: ImageData, partId?: string) => {
  if (/^eyewhite/i.test(String(partId || ''))) return 0
  const { width, height, data } = image
  const total = width * height
  const visited = new Uint8Array(total)
  const remove = new Uint8Array(total)
  let removed = 0
  const queue: number[] = []
  const component: number[] = []

  for (let start = 0; start < total; start += 1) {
    if (visited[start]) continue
    const startOffset = start * 4
    if (!isNearWhitePixel(data, startOffset)) {
      visited[start] = 1
      continue
    }

    queue.length = 0
    component.length = 0
    queue.push(start)
    visited[start] = 1
    let cursor = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    let transparentNeighbors = 0

    while (cursor < queue.length) {
      const idx = queue[cursor]
      cursor += 1
      component.push(idx)
      const x = idx % width
      const y = Math.floor(idx / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            transparentNeighbors += 1
            continue
          }
          const n = ny * width + nx
          const nOffset = n * 4
          if (data[nOffset + 3] <= 8) {
            transparentNeighbors += 1
            continue
          }
          if (visited[n] || !isNearWhitePixel(data, nOffset)) continue
          visited[n] = 1
          queue.push(n)
        }
      }
    }

    const spanX = maxX - minX + 1
    const spanY = maxY - minY + 1
    if (component.length <= 64 && transparentNeighbors > 0 && (spanX <= 14 || spanY <= 14)) {
      component.forEach((idx) => { remove[idx] = 1 })
      removed += component.length
    }
  }

  for (let idx = 0; idx < total; idx += 1) {
    if (!remove[idx]) continue
    const offset = idx * 4
    data[offset] = 0
    data[offset + 1] = 0
    data[offset + 2] = 0
    data[offset + 3] = 0
  }
  return removed
}

const isWhiteMattePixel = (data: Uint8ClampedArray, offset: number) => {
  if (data[offset + 3] <= 8) return false
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lum = (r + g + b) / 3
  return lum > 204 && min > 178 && max - min < 76
}

const isPartEdgeMattePixel = (data: Uint8ClampedArray, offset: number, partId?: string) => {
  if (isWhiteMattePixel(data, offset)) return true
  const id = normalizePartId(String(partId || ''))
  if (!/^hair|hair_|headwear/.test(id)) return false
  if (data[offset + 3] <= 8) return false
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lum = (r + g + b) / 3
  return lum > 128 && min > 64 && max - min < 142
}

const hasTransparentNeighbor = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius = 1
) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true
      if (data[(ny * width + nx) * 4 + 3] <= 8) return true
    }
  }
  return false
}

const sampleInnerNonWhiteColor = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  partId?: string
) => {
  let r = 0
  let g = 0
  let b = 0
  let weight = 0
  for (let radius = 1; radius <= 4; radius += 1) {
    r = 0
    g = 0
    b = 0
    weight = 0
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const offset = (ny * width + nx) * 4
        const alpha = data[offset + 3]
        if (alpha <= 48 || isPartEdgeMattePixel(data, offset, partId)) continue
        const distance = Math.max(1, Math.abs(dx) + Math.abs(dy))
        const w = alpha / (255 * distance)
        r += data[offset] * w
        g += data[offset + 1] * w
        b += data[offset + 2] * w
        weight += w
      }
    }
    if (weight > 0) return { r: r / weight, g: g / weight, b: b / weight }
  }
  return null
}

const cleanWhiteEdgeMatte = (image: ImageData, partId?: string) => {
  if (/^eyewhite/i.test(String(partId || ''))) return 0
  const { width, height, data } = image
  const patches: Array<{ offset: number; r: number; g: number; b: number }> = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (!isPartEdgeMattePixel(data, offset, partId)) continue
      if (!hasTransparentNeighbor(data, width, height, x, y, 3) && data[offset + 3] >= 250) continue
      const sample = sampleInnerNonWhiteColor(data, width, height, x, y, partId)
      if (!sample) continue
      const lum = (data[offset] + data[offset + 1] + data[offset + 2]) / 3
      const sampleLum = (sample.r + sample.g + sample.b) / 3
      if (lum < sampleLum + 24) continue
      patches.push({ offset, r: sample.r, g: sample.g, b: sample.b })
    }
  }
  for (const patch of patches) {
    data[patch.offset] = Math.max(0, Math.min(255, Math.round(data[patch.offset] * 0.18 + patch.r * 0.82)))
    data[patch.offset + 1] = Math.max(0, Math.min(255, Math.round(data[patch.offset + 1] * 0.18 + patch.g * 0.82)))
    data[patch.offset + 2] = Math.max(0, Math.min(255, Math.round(data[patch.offset + 2] * 0.18 + patch.b * 0.82)))
  }
  return patches.length
}

const softenOuterAlphaEdge = (image: ImageData, partId?: string) => {
  void image
  void partId
  return 0
}

const edgeCleanDataUrl = async (dataUrl: string, edgeMode: EdgeMode, partId?: string) => {
  if (edgeMode === 'keep') return dataUrl
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, img.naturalWidth || img.width || 1)
  canvas.height = Math.max(1, img.naturalHeight || img.height || 1)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = image.data
  if ((edgeMode === 'removeWhite' || edgeMode === 'removeBlack') && typeof window !== 'undefined') {
    const runtime = window.NovaFlowBackgroundRemoval
    if (runtime && typeof runtime.removeMatteFromImageData === 'function') {
      const result = runtime.removeMatteFromImageData(image, edgeMode)
      const nextImage = result instanceof ImageData ? result : result && result.imageData ? result.imageData : image
      if (edgeMode === 'removeWhite') {
        removeIsolatedWhiteMattePixels(nextImage, partId)
        cleanWhiteEdgeMatte(nextImage, partId)
        softenOuterAlphaEdge(nextImage, partId)
      }
      ctx.putImageData(nextImage, 0, 0)
      return canvasToDataUrl(canvas)
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3]
    if (alpha < 4) {
      d[i + 3] = 0
      continue
    }
    if (edgeMode === 'feather1' && alpha < 255) d[i + 3] = Math.max(0, Math.min(255, Math.round(alpha * 0.88)))
    if (edgeMode === 'feather2' && alpha < 255) d[i + 3] = Math.max(0, Math.min(255, Math.round(alpha * 0.74)))
    if ((edgeMode === 'removeWhite' || edgeMode === 'removeBlack') && alpha > 0 && alpha < 255) {
      const a = alpha / 255
      for (let c = 0; c < 3; c += 1) {
        const value = d[i + c]
        const fixed = edgeMode === 'removeWhite'
          ? (value - 255 * (1 - a)) / a
          : value / a
        d[i + c] = Math.max(0, Math.min(255, Math.round(fixed)))
      }
    }
  }
  if (edgeMode === 'removeWhite') {
    removeIsolatedWhiteMattePixels(image, partId)
    cleanWhiteEdgeMatte(image, partId)
    softenOuterAlphaEdge(image, partId)
  }
  ctx.putImageData(image, 0, 0)
  return canvasToDataUrl(canvas)
}

const connectionPadding = (partId: string, params: AiSplitParams) => {
  if (!params.spineFix) return { left: 2, right: 2, top: 2, bottom: 2 }
  if (partId === 'head') return { left: 8, right: 8, top: 6, bottom: 28 }
  if (partId === 'left_arm' || partId === 'right_arm') return { left: 28, right: 28, top: 36, bottom: 12 }
  if (partId === 'left_upper_arm' || partId === 'right_upper_arm') return { left: 24, right: 24, top: 36, bottom: 18 }
  if (partId === 'left_forearm' || partId === 'right_forearm') return { left: 18, right: 18, top: 28, bottom: 18 }
  if (partId === 'left_hand' || partId === 'right_hand') return { left: 12, right: 12, top: 18, bottom: 18 }
  if (partId === 'left_leg' || partId === 'right_leg') return { left: 18, right: 18, top: 40, bottom: 10 }
  if (partId === 'left_thigh' || partId === 'right_thigh') return { left: 18, right: 18, top: 40, bottom: 20 }
  if (partId === 'left_shin' || partId === 'right_shin') return { left: 16, right: 16, top: 30, bottom: 18 }
  if (partId === 'left_foot' || partId === 'right_foot') return { left: 16, right: 18, top: 20, bottom: 12 }
  if (partId === 'cape' || partId === 'wing') return { left: 28, right: 28, top: 36, bottom: 28 }
  if (partId === 'hair' || partId === 'hair_front' || partId === 'hair_back') return { left: 14, right: 14, top: 14, bottom: 24 }
  if (partId === 'weapon' || partId === 'weapon_back') return { left: 18, right: 18, top: 18, bottom: 18 }
  return { left: 4, right: 4, top: 4, bottom: 4 }
}

const inpaintSensitivePart = (partId: string) => {
  return /^(head|left_arm|right_arm|left_upper_arm|right_upper_arm|left_forearm|right_forearm|left_hand|right_hand|left_leg|right_leg|left_thigh|right_thigh|left_shin|right_shin|left_foot|right_foot|hair|hair_front|hair_back|weapon|weapon_back|cape|wing|skirt)$/.test(partId)
}

type SourceSnapshot = {
  width: number
  height: number
  data: Uint8ClampedArray
  hasAlphaCutout: boolean
}

type RegionShape =
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'ellipse'; x: number; y: number; w: number; h: number }
  | { type: 'poly'; points: Array<[number, number]> }

const fullRegion: RegionShape = { type: 'rect', x: 0, y: 0, w: 1, h: 1 }

const PART_REGIONS: Record<string, RegionShape[]> = {
  background: [fullRegion],
  character: [fullRegion],
  hair_back: [
    { type: 'ellipse', x: 0.25, y: 0.01, w: 0.5, h: 0.34 },
    { type: 'poly', points: [[0.26, 0.12], [0.74, 0.12], [0.67, 0.56], [0.28, 0.56]] }
  ],
  hair: [
    { type: 'ellipse', x: 0.24, y: 0, w: 0.52, h: 0.36 },
    { type: 'poly', points: [[0.25, 0.12], [0.75, 0.12], [0.69, 0.57], [0.24, 0.58]] }
  ],
  hair_front: [
    { type: 'ellipse', x: 0.28, y: 0.02, w: 0.4, h: 0.24 },
    { type: 'rect', x: 0.3, y: 0.08, w: 0.33, h: 0.14 }
  ],
  head: [
    { type: 'ellipse', x: 0.3, y: 0.03, w: 0.36, h: 0.26 },
    { type: 'rect', x: 0.43, y: 0.25, w: 0.14, h: 0.06 }
  ],
  face: [{ type: 'ellipse', x: 0.37, y: 0.12, w: 0.26, h: 0.22 }],
  neck: [{ type: 'rect', x: 0.43, y: 0.26, w: 0.14, h: 0.13 }],
  body: [
    { type: 'poly', points: [[0.32, 0.27], [0.67, 0.27], [0.75, 0.63], [0.3, 0.64]] }
  ],
  cloth_front: [
    { type: 'poly', points: [[0.28, 0.42], [0.72, 0.42], [0.78, 0.82], [0.23, 0.82]] }
  ],
  cape: [
    { type: 'poly', points: [[0.18, 0.22], [0.82, 0.22], [0.91, 0.88], [0.08, 0.88]] }
  ],
  left_upper_arm: [
    { type: 'poly', points: [[0.22, 0.28], [0.43, 0.3], [0.43, 0.5], [0.17, 0.51]] }
  ],
  left_forearm: [
    { type: 'poly', points: [[0.2, 0.43], [0.47, 0.43], [0.49, 0.63], [0.15, 0.66]] }
  ],
  left_hand: [{ type: 'ellipse', x: 0.13, y: 0.55, w: 0.26, h: 0.2 }],
  left_arm: [
    { type: 'poly', points: [[0.18, 0.28], [0.45, 0.29], [0.49, 0.66], [0.12, 0.69]] }
  ],
  right_upper_arm: [
    { type: 'poly', points: [[0.58, 0.22], [0.78, 0.14], [0.85, 0.34], [0.61, 0.45]] }
  ],
  right_forearm: [
    { type: 'poly', points: [[0.58, 0.33], [0.88, 0.28], [0.9, 0.5], [0.63, 0.57]] }
  ],
  right_hand: [{ type: 'ellipse', x: 0.69, y: 0.19, w: 0.18, h: 0.16 }],
  right_arm: [
    { type: 'poly', points: [[0.56, 0.14], [0.88, 0.13], [0.91, 0.57], [0.58, 0.58]] }
  ],
  left_thigh: [
    { type: 'poly', points: [[0.16, 0.58], [0.48, 0.55], [0.47, 0.77], [0.07, 0.77]] }
  ],
  left_shin: [
    { type: 'poly', points: [[0.07, 0.71], [0.32, 0.69], [0.29, 0.91], [0.01, 0.93]] }
  ],
  left_foot: [{ type: 'ellipse', x: 0, y: 0.87, w: 0.25, h: 0.1 }],
  left_leg: [
    { type: 'poly', points: [[0.05, 0.56], [0.49, 0.54], [0.47, 0.91], [0, 0.94]] }
  ],
  right_thigh: [
    { type: 'poly', points: [[0.5, 0.55], [0.83, 0.57], [0.89, 0.76], [0.52, 0.78]] }
  ],
  right_shin: [
    { type: 'poly', points: [[0.68, 0.7], [0.93, 0.73], [0.99, 0.94], [0.69, 0.91]] }
  ],
  right_foot: [{ type: 'ellipse', x: 0.76, y: 0.88, w: 0.23, h: 0.1 }],
  right_leg: [
    { type: 'poly', points: [[0.49, 0.54], [0.87, 0.55], [1, 0.94], [0.58, 0.92]] }
  ],
  weapon: [
    { type: 'poly', points: [[0.56, 0.04], [0.7, 0.05], [0.72, 0.36], [0.58, 0.4]] },
    { type: 'poly', points: [[0.55, 0.25], [0.98, 0.26], [0.99, 0.36], [0.56, 0.36]] },
    { type: 'ellipse', x: 0.61, y: 0.06, w: 0.18, h: 0.26 }
  ],
  weapon_back: [
    { type: 'poly', points: [[0.56, 0.04], [0.7, 0.05], [0.72, 0.36], [0.58, 0.4]] },
    { type: 'poly', points: [[0.55, 0.25], [0.98, 0.26], [0.99, 0.36], [0.56, 0.36]] }
  ],
  wing: [
    { type: 'poly', points: [[0.08, 0.11], [0.92, 0.11], [0.86, 0.62], [0.13, 0.62]] }
  ],
  skirt: [
    { type: 'poly', points: [[0.24, 0.48], [0.75, 0.48], [0.82, 0.84], [0.18, 0.84]] }
  ],
  accessory: [
    { type: 'ellipse', x: 0.5, y: 0.34, w: 0.28, h: 0.28 },
    { type: 'rect', x: 0.25, y: 0.4, w: 0.5, h: 0.2 }
  ],
  shadow: [{ type: 'ellipse', x: 0.08, y: 0.86, w: 0.84, h: 0.12 }]
}

const getPartRegionShapes = (partId: string) => PART_REGIONS[partId] || [fullRegion]

const drawRegionShape = (ctx: CanvasRenderingContext2D, shape: RegionShape, width: number, height: number) => {
  ctx.beginPath()
  if (shape.type === 'rect') {
    ctx.rect(shape.x * width, shape.y * height, shape.w * width, shape.h * height)
  } else if (shape.type === 'ellipse') {
    ctx.ellipse((shape.x + shape.w / 2) * width, (shape.y + shape.h / 2) * height, Math.max(1, shape.w * width / 2), Math.max(1, shape.h * height / 2), 0, 0, Math.PI * 2)
  } else {
    shape.points.forEach(([px, py], index) => {
      const x = px * width
      const y = py * height
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
  }
  ctx.fill()
}

const buildRegionAlpha = (partId: string, width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable while creating split region')
  ctx.fillStyle = '#fff'
  getPartRegionShapes(partId).forEach((shape) => drawRegionShape(ctx, shape, width, height))
  return ctx.getImageData(0, 0, width, height).data
}

const getSourceSnapshot = async (sourceImage: string): Promise<SourceSnapshot> => {
  const img = await loadImage(sourceImage)
  const width = Math.max(1, img.naturalWidth || img.width || 1)
  const height = Math.max(1, img.naturalHeight || img.height || 1)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable while reading source image')
  ctx.drawImage(img, 0, 0)
  const image = ctx.getImageData(0, 0, width, height)
  let transparent = 0
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] < 245) transparent += 1
  }
  return {
    width,
    height,
    data: image.data,
    hasAlphaCutout: transparent > width * height * 0.02
  }
}

const partPixelAllowed = (partId: string, source: Uint8ClampedArray, offset: number, x: number, y: number, width: number, height: number) => {
  const r = source[offset]
  const g = source[offset + 1]
  const b = source[offset + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722)
  const nx = x / Math.max(1, width)
  const ny = y / Math.max(1, height)
  if (partId === 'shadow') return ny > 0.82 && lum < 95
  if (partId === 'head') return ny < 0.27 || lum > 60 || (nx > 0.4 && nx < 0.6 && ny < 0.34)
  if (partId === 'hair' || partId === 'hair_front' || partId === 'hair_back') return ny < 0.6 && (lum < 135 || max - min > 18)
  if (partId === 'weapon' || partId === 'weapon_back') {
    const gold = r > 92 && g > 55 && r > b + 22
    const metal = lum > 70 && max - min < 70
    const redWrap = r > 80 && r > g + 20 && r > b + 20
    return gold || metal || redWrap
  }
  if (partId === 'face') return lum > 65 || ny < 0.28
  return true
}

const buildSourceCutoutDataUrl = async (snapshot: SourceSnapshot, part: PartPreset, params: AiSplitParams) => {
  const { width, height, data } = snapshot
  const regionAlpha = buildRegionAlpha(part.id, width, height)
  const alphaThreshold = params.quality === 'fine' ? 2 : params.quality === 'fast' ? 20 : 8
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas unavailable while creating split PNG')
  const output = ctx.createImageData(width, height)
  const paint = (usePartFilter: boolean) => {
    output.data.fill(0)
    let kept = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const sourceAlpha = data[offset + 3]
        const inRegion = regionAlpha[offset + 3] > 0
        let keep = false
        if (part.id === 'background') {
          keep = snapshot.hasAlphaCutout ? sourceAlpha <= alphaThreshold : inRegion
        } else {
          keep = sourceAlpha > alphaThreshold && inRegion
          if (keep && usePartFilter) keep = partPixelAllowed(part.id, data, offset, x, y, width, height)
        }
        if (keep) {
          output.data[offset] = data[offset]
          output.data[offset + 1] = data[offset + 1]
          output.data[offset + 2] = data[offset + 2]
          output.data[offset + 3] = part.id === 'background' && snapshot.hasAlphaCutout ? 0 : sourceAlpha
          kept += 1
        }
      }
    }
    return kept
  }
  let kept = paint(true)
  if (kept < 8 && part.id !== 'background') kept = paint(false)
  ctx.putImageData(output, 0, 0)
  return canvasToDataUrl(canvas)
}

const createMaskAndCrop = async (dataUrl: string, part: PartPreset, params: AiSplitParams) => {
  const img = await loadImage(dataUrl)
  const w = Math.max(1, img.naturalWidth || img.width || 1)
  const h = Math.max(1, img.naturalHeight || img.height || 1)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 不可用，无法生成 mask')
  ctx.drawImage(img, 0, 0)
  const rgba = ctx.getImageData(0, 0, w, h)
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = w
  maskCanvas.height = h
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
  if (!maskCtx) throw new Error('Canvas 不可用，无法生成 mask')
  const mask = maskCtx.createImageData(w, h)
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4
      const keep = rgba.data[idx + 3] > 8
      const v = keep ? 255 : 0
      mask.data[idx] = v
      mask.data[idx + 1] = v
      mask.data[idx + 2] = v
      mask.data[idx + 3] = 255
      if (keep) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    const emptyPartCanvas = document.createElement('canvas')
    emptyPartCanvas.width = 1
    emptyPartCanvas.height = 1
    const emptyMaskCanvas = document.createElement('canvas')
    emptyMaskCanvas.width = 1
    emptyMaskCanvas.height = 1
    const emptyMaskCtx = emptyMaskCanvas.getContext('2d', { willReadFrequently: true })
    if (emptyMaskCtx) {
      const emptyMask = emptyMaskCtx.createImageData(1, 1)
      emptyMask.data[3] = 255
      emptyMaskCtx.putImageData(emptyMask, 0, 0)
    }
    return {
      dataUrl: canvasToDataUrl(emptyPartCanvas),
      maskDataUrl: canvasToDataUrl(emptyMaskCanvas),
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      originalWidth: w,
      originalHeight: h
    }
  }
  const pad = connectionPadding(part.id, params)
  const x = Math.max(0, minX - pad.left)
  const y = Math.max(0, minY - pad.top)
  const right = Math.min(w - 1, maxX + pad.right)
  const bottom = Math.min(h - 1, maxY + pad.bottom)
  const cropW = Math.max(1, right - x + 1)
  const cropH = Math.max(1, bottom - y + 1)
  maskCtx.putImageData(mask, 0, 0)

  const partCanvas = document.createElement('canvas')
  partCanvas.width = cropW
  partCanvas.height = cropH
  const partCtx = partCanvas.getContext('2d')
  if (!partCtx) throw new Error('Canvas 不可用，无法裁切 PNG')
  partCtx.drawImage(canvas, x, y, cropW, cropH, 0, 0, cropW, cropH)

  const croppedMaskCanvas = document.createElement('canvas')
  croppedMaskCanvas.width = cropW
  croppedMaskCanvas.height = cropH
  const croppedMaskCtx = croppedMaskCanvas.getContext('2d')
  if (!croppedMaskCtx) throw new Error('Canvas 不可用，无法裁切 mask')
  croppedMaskCtx.drawImage(maskCanvas, x, y, cropW, cropH, 0, 0, cropW, cropH)

  return {
    dataUrl: canvasToDataUrl(partCanvas),
    maskDataUrl: canvasToDataUrl(croppedMaskCanvas),
    x,
    y,
    width: cropW,
    height: cropH,
    originalWidth: w,
    originalHeight: h
  }
}

const preparePart = async (part: PartPreset, rawDataUrl: string, params: AiSplitParams): Promise<SplitRuntimePart> => {
  const cleaned = await edgeCleanDataUrl(rawDataUrl, params.edgeMode, part.id)
  const cropped = await createMaskAndCrop(cleaned, part, params)
  const stem = sanitizeFileStem(part.id)
  return {
    id: stem,
    name: stem,
    prompt: part.prompt,
    file: `images/${stem}.png`,
    maskFile: `masks/${stem}_mask.png`,
    x: cropped.x,
    y: cropped.y,
    width: cropped.width,
    height: cropped.height,
    pivot: part.pivot,
    layer: part.layer,
    visible: true,
    needsInpaint: params.inpaintMode === 'off' && inpaintSensitivePart(stem),
    dataUrl: cropped.dataUrl,
    maskDataUrl: cropped.maskDataUrl,
    originalWidth: cropped.originalWidth,
    originalHeight: cropped.originalHeight
  }
}

const legacyRegionSplitEnabled = () => false
void applySpineSplitPostProcess

export async function generateSplitMask(params: AiSplitParams): Promise<SplitRuntimePart[]> {
  if (!params.sourceImage) throw new Error('没有导入图片')
  if (params.mode === 'prompt' && !String(params.prompt || '').trim() && !params.requestedParts?.length) {
    throw new Error('没有输入提示词')
  }
  if (!legacyRegionSplitEnabled()) {
    const { baseUrl, info, sourceSize } = await runSeeThrough(params)
    const requested = params.mode === 'auto' ? [] : resolveRequestedParts(params).map((part) => part.id)
    const requestedSet = new Set(requested)
    const filtered = info.layers.filter((layer) => {
      if (!requestedSet.size) return true
      const part = seeThroughNameToPart(layer.name)
      const low = String(layer.name || '').toLowerCase()
      return requestedSet.has(part.id) || Array.from(requestedSet).some((id) => low.includes(id.replace(/_/g, ' ')) || low.includes(id))
    })
    const layers = filtered.length ? filtered : info.layers
    const outputs = await Promise.all(layers.map(async (layer, index) => {
      const blob = await fetchComfyBlob(baseUrl, outputViewPath(layer.filename))
      const rawDataUrl = await blobToDataUrl(blob)
      const normalized = await transformSeeThroughLayer(rawDataUrl, layer, { width: info.width, height: info.height }, sourceSize)
      const part = seeThroughNameToPart(layer.name)
      return await prepareSeeThroughPart({ ...part, layer: (part.layer || 50) + index * 0.01 }, normalized.dataUrl, { x: normalized.offsetX, y: normalized.offsetY }, params)
    }))
    if (!outputs.length) throw new Error('See-through layer generation failed.')
    return normalizeSpineLayerOrder(outputs)
  }
  const source = await getSourceSnapshot(params.sourceImage)
  const parts = resolveRequestedParts(params)
  const outputs: SplitRuntimePart[] = []
  for (const part of parts) {
    const dataUrl = await buildSourceCutoutDataUrl(source, part, params)
    outputs.push(await preparePart(part, dataUrl, params))
  }
  if (!outputs.length) throw new Error('mask 生成失败')
  return outputs.sort((a, b) => a.layer - b.layer)
}

export async function extractPartPng(params: AiSplitParams & { part?: SplitRuntimePart }): Promise<SplitRuntimePart> {
  if (params.part?.dataUrl && params.part.maskDataUrl) return params.part
  const parts = await generateSplitMask(params)
  const first = parts[0]
  if (!first) throw new Error('PNG 导出失败')
  return first
}

export async function inpaintMissingArea(params: AiSplitParams & { part: SplitRuntimePart }): Promise<SplitRuntimePart> {
  if (params.inpaintMode === 'off') return params.part
  return { ...params.part, needsInpaint: false }
}

export async function cleanPartEdge(params: AiSplitParams & { part: SplitRuntimePart }): Promise<SplitRuntimePart> {
  if (!params.part.dataUrl) return params.part
  const cleaned = await edgeCleanDataUrl(params.part.dataUrl, params.edgeMode, params.part.id)
  return { ...params.part, dataUrl: cleaned }
}

const buildPreviewPng = async (sourceImage: string, parts: SplitRuntimePart[]) => {
  const size = await getSourceSize(sourceImage)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用，无法生成 preview.png')
  const ordered = orderPartsForComposite(parts)
  for (const part of ordered) {
    const img = await loadImage(String(part.dataUrl || ''))
    ctx.drawImage(img, part.x, part.y)
  }
  return canvasToDataUrl(canvas)
}

class PsdWriter {
  private chunks: Uint8Array[] = []
  length = 0

  private push(chunk: Uint8Array) {
    this.chunks.push(chunk)
    this.length += chunk.length
  }

  u8(value: number) {
    this.push(Uint8Array.of(value & 0xff))
  }

  u16(value: number) {
    const b = new Uint8Array(2)
    new DataView(b.buffer).setUint16(0, value & 0xffff, false)
    this.push(b)
  }

  i16(value: number) {
    const b = new Uint8Array(2)
    new DataView(b.buffer).setInt16(0, value, false)
    this.push(b)
  }

  u32(value: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, value >>> 0, false)
    this.push(b)
  }

  i32(value: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setInt32(0, Math.trunc(value), false)
    this.push(b)
  }

  ascii(value: string) {
    const b = new Uint8Array(value.length)
    for (let i = 0; i < value.length; i += 1) b[i] = value.charCodeAt(i) & 0xff
    this.push(b)
  }

  bytes(value: Uint8Array) {
    this.push(value)
  }

  zeros(count: number) {
    if (count > 0) this.push(new Uint8Array(count))
  }

  concat() {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

const bytesToDataUrl = (bytes: Uint8Array, mime = 'image/vnd.adobe.photoshop') => {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return `data:${mime};base64,${btoa(binary)}`
}

const psdSafeName = (value: string) => String(value || 'layer').replace(/[^\w.-]+/g, '_').slice(0, 63) || 'layer'

const psdPascalName = (value: string) => {
  const encoded = new TextEncoder().encode(psdSafeName(value))
  const len = Math.min(255, encoded.length)
  const total = 1 + len
  const pad = (4 - (total % 4)) % 4
  const out = new Uint8Array(total + pad)
  out[0] = len
  out.set(encoded.slice(0, len), 1)
  return out
}

const imageDataFromDataUrl = async (dataUrl: string, width?: number, height?: number) => {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width || img.naturalWidth || img.width || 1))
  canvas.height = Math.max(1, Math.round(height || img.naturalHeight || img.height || 1))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 不可用，无法生成 PSD')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

const splitPlanes = (data: Uint8ClampedArray) => {
  const count = Math.floor(data.length / 4)
  const r = new Uint8Array(count)
  const g = new Uint8Array(count)
  const b = new Uint8Array(count)
  const a = new Uint8Array(count)
  for (let i = 0, p = 0; i < count; i += 1, p += 4) {
    r[i] = data[p]
    g[i] = data[p + 1]
    b[i] = data[p + 2]
    a[i] = data[p + 3]
  }
  return [r, g, b, a]
}

const buildPsdLayer = async (part: SplitRuntimePart) => {
  if (!part.dataUrl || part.width <= 0 || part.height <= 0) return null
  const imageData = await imageDataFromDataUrl(part.dataUrl, part.width, part.height)
  return {
    id: psdSafeName(part.id),
    x: Math.round(part.x),
    y: Math.round(part.y),
    width: imageData.width,
    height: imageData.height,
    planes: splitPlanes(imageData.data)
  }
}

export async function buildSplitPsdDataUrl(params: {
  sourceImage: string
  parts: SplitRuntimePart[]
  previewDataUrl?: string
}) {
  if (!params.parts.length) throw new Error('没有可导出的 PSD 图层')
  const size = await getSourceSize(params.sourceImage)
  const preview = params.previewDataUrl || await buildPreviewPng(params.sourceImage, params.parts)
  const composite = await imageDataFromDataUrl(preview, size.width, size.height)
  const compositePlanes = splitPlanes(composite.data)
  const layers = (await Promise.all(orderPartsForPsdStack(params.parts).map(buildPsdLayer))).filter(Boolean) as Array<NonNullable<Awaited<ReturnType<typeof buildPsdLayer>>>>
  if (!layers.length) throw new Error('没有可导出的 PSD 图层')

  const layerRecords = new PsdWriter()
  const layerPixels = new PsdWriter()
  layerRecords.i16(layers.length)
  for (const layer of layers) {
    const top = Math.max(0, layer.y)
    const left = Math.max(0, layer.x)
    layerRecords.i32(top)
    layerRecords.i32(left)
    layerRecords.i32(Math.max(top, top + layer.height))
    layerRecords.i32(Math.max(left, left + layer.width))
    layerRecords.u16(4)
    for (const channelId of [0, 1, 2, -1]) {
      layerRecords.i16(channelId)
      layerRecords.u32(2 + layer.width * layer.height)
    }
    layerRecords.ascii('8BIM')
    layerRecords.ascii('norm')
    layerRecords.u8(255)
    layerRecords.u8(0)
    layerRecords.u8(0)
    layerRecords.u8(0)
    const extra = new PsdWriter()
    extra.u32(0)
    extra.u32(0)
    extra.bytes(psdPascalName(layer.id))
    layerRecords.u32(extra.length)
    layerRecords.bytes(extra.concat())
  }
  for (const layer of layers) {
    for (const plane of layer.planes) {
      layerPixels.u16(0)
      layerPixels.bytes(plane)
    }
  }

  const layerInfo = new PsdWriter()
  layerInfo.bytes(layerRecords.concat())
  layerInfo.bytes(layerPixels.concat())
  if (layerInfo.length % 2) layerInfo.u8(0)

  const layerMaskSection = new PsdWriter()
  layerMaskSection.u32(layerInfo.length)
  layerMaskSection.bytes(layerInfo.concat())
  layerMaskSection.u32(0)

  const file = new PsdWriter()
  file.ascii('8BPS')
  file.u16(1)
  file.zeros(6)
  file.u16(4)
  file.u32(size.height)
  file.u32(size.width)
  file.u16(8)
  file.u16(3)
  file.u32(0)
  file.u32(0)
  file.u32(layerMaskSection.length)
  file.bytes(layerMaskSection.concat())
  file.u16(0)
  for (const plane of compositePlanes) file.bytes(plane)
  return bytesToDataUrl(file.concat())
}

const toManifestPart = (part: SplitRuntimePart): SplitPart => ({
  id: part.id,
  name: part.name,
  prompt: part.prompt,
  file: part.file,
  maskFile: part.maskFile,
  x: part.x,
  y: part.y,
  width: part.width,
  height: part.height,
  pivot: part.pivot,
  layer: part.layer,
  visible: part.visible,
  needsInpaint: part.needsInpaint,
  spineReady: part.spineReady,
  sourceFidelity: part.sourceFidelity,
  generatedRatio: part.generatedRatio,
  reviewIssues: part.reviewIssues
})

export function buildSplitManifest(params: {
  source: string
  purpose: SplitPurpose
  parts: SplitRuntimePart[]
  createdAt?: string
}): SplitManifest {
  const orderedParts = normalizeSpineLayerOrder(params.parts)
  const reviewIssues = orderedParts.flatMap((part) => part.reviewIssues || [])
  return {
    version: '1.0',
    source: params.source || 'source.png',
    purpose: params.purpose,
    psd: 'layers.psd',
    createdAt: params.createdAt || new Date().toISOString().replace('T', ' ').slice(0, 19),
    status: reviewIssues.some((issue) => issue.severity === 'reject') ? 'review_required' : 'ready',
    reviewIssues: reviewIssues.length ? reviewIssues : undefined,
    parts: orderedParts.map(toManifestPart)
  }
}

export async function exportSplitPackage(params: {
  sourceImage: string
  sourceFileName?: string
  purpose: SplitPurpose
  parts: SplitRuntimePart[]
}): Promise<string> {
  if (!params.parts.length) throw new Error('没有可导出的拆图结果')
  const manifest = buildSplitManifest({
    source: 'source.png',
    purpose: params.purpose,
    parts: params.parts
  })
  const orderedParts = normalizeSpineLayerOrder(params.parts)
  const previewDataUrl = await buildPreviewPng(params.sourceImage, orderedParts)
  const psdDataUrl = await buildSplitPsdDataUrl({ sourceImage: params.sourceImage, parts: orderedParts, previewDataUrl })
  const api = (window as any).electronAPI
  const baseName = 'spine_split_export'
  const payload = {
    baseName,
    sourceFileName: params.sourceFileName || 'source.png',
    sourceDataUrl: params.sourceImage,
    previewDataUrl,
    psdDataUrl,
    manifest: JSON.stringify(manifest, null, 2),
    parts: orderedParts.map((part) => ({
      id: part.id,
      imageFileName: `${part.id}.png`,
      maskFileName: `${part.id}_mask.png`,
      dataUrl: part.dataUrl,
      maskDataUrl: part.maskDataUrl
    }))
  }
  if (api?.saveSplitPackage) {
    const result = await api.saveSplitPackage(payload)
    if (result?.canceled) return ''
    if (!result?.ok && result?.error) throw new Error(String(result.error))
    return String(result?.dir || '')
  }

  const picker = (window as any).showDirectoryPicker
  if (typeof picker !== 'function') throw new Error('导出目录不可写：当前运行环境不支持拆图包导出')
  const root = await picker({ mode: 'readwrite' })
  const dir = await root.getDirectoryHandle(baseName, { create: true })
  const images = await dir.getDirectoryHandle('images', { create: true })
  const masks = await dir.getDirectoryHandle('masks', { create: true })
  const writeText = async (handle: any, name: string, text: string) => {
    const file = await handle.getFileHandle(name, { create: true })
    const writable = await file.createWritable()
    await writable.write(text)
    await writable.close()
  }
  const writeDataUrl = async (handle: any, name: string, dataUrl: string) => {
    const file = await handle.getFileHandle(name, { create: true })
    const writable = await file.createWritable()
    await writable.write(await dataUrlToBlob(dataUrl))
    await writable.close()
  }
  await writeText(dir, 'split_manifest.json', payload.manifest)
  await writeDataUrl(dir, 'source.png', params.sourceImage)
  await writeDataUrl(dir, 'preview.png', previewDataUrl)
  await writeDataUrl(dir, 'layers.psd', psdDataUrl)
  for (const part of orderedParts) {
    if (part.dataUrl) await writeDataUrl(images, `${part.id}.png`, part.dataUrl)
    if (part.maskDataUrl) await writeDataUrl(masks, `${part.id}_mask.png`, part.maskDataUrl)
  }
  return baseName
}

export async function exportSplitPsd(params: {
  sourceImage: string
  sourceFileName?: string
  parts: SplitRuntimePart[]
}): Promise<string> {
  if (!params.parts.length) throw new Error('没有可导出的 PSD 图层')
  const psdDataUrl = await buildSplitPsdDataUrl({
    sourceImage: params.sourceImage,
    parts: params.parts
  })
  const api = (window as any).electronAPI
  const baseName = `${String(params.sourceFileName || 'spine_layers').replace(/\.[^/.]+$/g, '') || 'spine_layers'}_layers`
  if (api?.saveSplitPsd) {
    const result = await api.saveSplitPsd({ baseName, psdDataUrl })
    if (result?.canceled) return ''
    if (!result?.ok && result?.error) throw new Error(String(result.error))
    return String(result?.filePath || '')
  }
  const picker = (window as any).showSaveFilePicker
  if (typeof picker !== 'function') throw new Error('导出目录不可写：当前运行环境不支持 PSD 导出')
  const handle = await picker({
    suggestedName: `${baseName}.psd`,
    types: [{ description: 'Photoshop PSD', accept: { 'image/vnd.adobe.photoshop': ['.psd'] } }]
  })
  const writable = await handle.createWritable()
  await writable.write(await dataUrlToBlob(psdDataUrl))
  await writable.close()
  return `${baseName}.psd`
}

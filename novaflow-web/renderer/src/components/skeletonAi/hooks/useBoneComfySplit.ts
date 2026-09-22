import { patchComfyWorkflow } from '../../aiSeq/utils/patchComfyWorkflow'
import { BONE_AI_SPLIT_WORKFLOW_V1_JSON } from '../builtinWorkflows'

const normalizeBaseUrl = (s: string) => String(s || '').trim().replace(/\/+$/, '')
const NOVAFLOW_RUNTIME_BASE_URL = 'http://127.0.0.1:8188'

const dataUrlToBlob = async (dataUrl: string) => {
  const res = await fetch(String(dataUrl || ''))
  return await res.blob()
}

const sanitizeComfyUploadFileName = (name: string, mimeType: string) => {
  const raw = String(name || '').trim()
  const pickExt = () => {
    const ext = (raw.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || '').toLowerCase()
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.gif') return ext
    const mt = String(mimeType || '').toLowerCase()
    if (mt.includes('png')) return '.png'
    if (mt.includes('jpeg') || mt.includes('jpg')) return '.jpg'
    if (mt.includes('webp')) return '.webp'
    if (mt.includes('gif')) return '.gif'
    return '.png'
  }
  const ext = pickExt()
  const base = raw.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
  const ts = Date.now()
  const rand = Math.random().toString(16).slice(2, 8)
  const stem = base ? `${base}_${ts}_${rand}` : `upload_${ts}_${rand}`
  return `${stem}${ext}`
}

type ComfyFile = { filename: string; subfolder: string; type: string }

const extractSaveImagePrefixes = (workflow: any) => {
  try {
    const obj = workflow?.prompt && typeof workflow.prompt === 'object' ? workflow.prompt : workflow
    const out: string[] = []
    for (const [, node] of Object.entries<any>(obj || {})) {
      if (String(node?.class_type || '') !== 'SaveImage') continue
      const p = node?.inputs?.filename_prefix
      const s = typeof p === 'string' ? p.trim() : ''
      if (s) out.push(s)
    }
    return Array.from(new Set(out))
  } catch {
    return []
  }
}

const extractComfyHistoryFiles = (history: any) => {
  const item = history && typeof history === 'object' ? history : null
  if (!item) return []

  const files: ComfyFile[] = []
  const seen = new WeakSet<any>()
  const seenKey = new Set<string>()

  const looksLikeFile = (s: string) => /\.(mp4|webm|mov|m4v|avi|gif|png|jpe?g|webp)$/i.test(String(s || '').trim())

  const push = (v: any) => {
    if (!v) return
    if (typeof v === 'string') {
      const s = String(v || '').trim()
      if (!looksLikeFile(s)) return
      const filename = s.split(/[\\/]/).pop() || s
      const type = 'output'
      const subfolder = ''
      const key = `${type}::${subfolder}::${filename}`
      if (seenKey.has(key)) return
      seenKey.add(key)
      files.push({ filename, subfolder, type })
      return
    }

    const rawName =
      (v as any)?.filename ??
      (v as any)?.file_name ??
      (v as any)?.fileName ??
      (v as any)?.name ??
      (v as any)?.path ??
      (v as any)?.fullpath ??
      ''

    const raw = String(rawName || '').trim()
    if (!raw) return
    if (!looksLikeFile(raw)) return

    const filename = raw.split(/[\\/]/).pop() || raw
    const subfolder = (v as any).subfolder ? String((v as any).subfolder) : ((v as any).sub_folder ? String((v as any).sub_folder) : '')
    const type = (v as any).type ? String((v as any).type) : 'output'
    const key = `${type}::${subfolder}::${filename}`
    if (seenKey.has(key)) return
    seenKey.add(key)
    files.push({ filename, subfolder, type })
  }

  const visit = (v: any) => {
    if (!v) return
    if (typeof v !== 'object') {
      push(v)
      return
    }
    if (seen.has(v)) return
    seen.add(v)

    if (Array.isArray(v)) {
      for (const x of v) visit(x)
      return
    }

    push(v)
    for (const x of Object.values<any>(v)) visit(x)
  }

  visit((item as any)?.outputs && typeof (item as any).outputs === 'object' ? (item as any).outputs : item)
  return files
}

const pickHistoryItem = (data: any, pid: string) => {
  if (!data || typeof data !== 'object') return data
  const direct = (data as any)[pid]
  if (direct && typeof direct === 'object') return direct
  try {
    const entries = Object.entries<any>(data as any)
    const byIncludes = entries.find(([k]) => String(k || '').includes(pid))
    if (byIncludes?.[1] && typeof byIncludes[1] === 'object') return byIncludes[1]
    if (entries.length === 1 && entries[0]?.[1] && typeof entries[0][1] === 'object') return entries[0][1]
  } catch { }
  return data
}

const requestJson = async (baseUrl: string, path: string, init: RequestInit) => {
  const base = normalizeBaseUrl(baseUrl)
  const electronApi = (window as any).electronAPI
  if (electronApi?.runtimeRequestJson) {
    return await electronApi.runtimeRequestJson({ baseUrl: base, path, init: { method: init.method || 'GET', headers: init.headers || {}, body: init.body || null } })
  }
  const basePath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`
  const buildUrl = (p: string) => import.meta.env.DEV ? `/__runtime_proxy${p}` : new URL(p, base).toString()
  const buildHeaders = () => ({ ...(init.headers || {}), ...(import.meta.env.DEV ? { 'x-runtime-base': base } : {}) } as any)
  const doFetch = async (p: string) => {
    const res = await fetch(buildUrl(p), { ...init, headers: buildHeaders() })
    const text = await res.text()
    try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } } catch { return { ok: res.ok, status: res.status, error: 'invalid json', raw: text } }
  }
  const first = await doFetch(basePath)
  if (first?.status === 404 && !basePath.startsWith('/api/')) return await doFetch(`/api${basePath}`)
  return first
}

const fetchBlob = async (baseUrl: string, path: string, init: RequestInit) => {
  const base = normalizeBaseUrl(baseUrl)
  const electronApi = (window as any).electronAPI
  if (electronApi?.runtimeRequestBinary) {
    const r = await electronApi.runtimeRequestBinary({ baseUrl: base, path, init: { method: init.method || 'GET' } })
    if (!r?.ok || !r?.dataBase64) return { ok: false, status: r?.status || 0, blob: new Blob() }
    const bytes = Uint8Array.from(atob(String(r.dataBase64)), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: String(r.contentType || '') || undefined })
    return { ok: true, status: Number(r.status || 200), blob }
  }
  const basePath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`
  const buildUrl = (p: string) => import.meta.env.DEV ? `/__runtime_proxy${p}` : new URL(p, base).toString()
  const buildHeaders = () => ({ ...(init.headers || {}), ...(import.meta.env.DEV ? { 'x-runtime-base': base } : {}) } as any)
  const doFetch = async (p: string) => {
    const res = await fetch(buildUrl(p), { ...init, headers: buildHeaders() })
    const blob = await res.blob()
    return { ok: res.ok, status: res.status, blob }
  }
  const first = await doFetch(basePath)
  if (first?.status === 404 && !basePath.startsWith('/api/')) return await doFetch(`/api${basePath}`)
  return first
}

const uploadImage = async (baseUrl: string, dataUrl: string, fileName: string) => {
  const base = normalizeBaseUrl(baseUrl)
  const electronApi = (window as any).electronAPI
  if (electronApi?.runtimeUploadImage) {
    const raw = String(dataUrl || '')
    const marker = 'base64,'
    const idx = raw.indexOf(marker)
    const b64 = idx >= 0 ? raw.slice(idx + marker.length) : ''
    if (b64) return await electronApi.runtimeUploadImage({ baseUrl: base, fileName, dataBase64: b64, type: 'input', subfolder: '' })
    const blob = await dataUrlToBlob(dataUrl)
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000) as any)
    return await electronApi.runtimeUploadImage({ baseUrl: base, fileName, dataBase64: btoa(bin), type: 'input', subfolder: '' })
  }

  const blob = await dataUrlToBlob(dataUrl)
  const safeName = sanitizeComfyUploadFileName(fileName, String((blob as any)?.type || ''))
  const form = new FormData()
  form.append('image', blob, safeName)
  form.append('type', 'input')
  const postForm = async (p: string) => {
    const url = import.meta.env.DEV ? `/__runtime_proxy${p}` : new URL(p, base).toString()
    const res = await fetch(url, { method: 'POST', body: form, headers: import.meta.env.DEV ? ({ 'x-runtime-base': base } as any) : undefined })
    const text = await res.text()
    try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } } catch { return { ok: res.ok, status: res.status, error: 'invalid json', raw: text } }
  }
  const first = await postForm('/upload/image')
  if (first?.status === 404 || first?.status === 403) return await postForm('/api/upload/image')
  return first
}

const detectComfyBaseUrl = async () => {
  const ports = [8188]
  const host = '127.0.0.1'
  const electronApi = (window as any).electronAPI
  const tryPort = async (port: number) => {
    const url = `http://${host}:${port}`
    if (electronApi?.runtimeGetSystemStats) {
      const timeout = new Promise<string>((_r, rej) => window.setTimeout(() => rej(new Error('timeout')), 1200))
      const req = Promise.resolve(electronApi.runtimeGetSystemStats({ baseUrl: url })).then((r: any) => {
        if (!r?.ok) throw new Error(String(r?.error || 'not ok'))
        return url
      })
      return await Promise.race([req, timeout])
    }
    const fetchUrl = import.meta.env.DEV ? '/__runtime_proxy/system_stats' : `${url}/system_stats`
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 1200)
    try {
      const res = await fetch(fetchUrl, { method: 'GET', signal: controller.signal, headers: import.meta.env.DEV ? ({ 'x-runtime-base': url } as any) : undefined })
      if (!res.ok) throw new Error('not ok')
      return url
    } finally {
      window.clearTimeout(timer)
    }
  }

  return await Promise.any(ports.map((p) => tryPort(p)))
}

export type BoneComfySplitOutput = { filename: string; objectUrl: string; blob: Blob }

const boneSplitWorkflowStorageKey = 'bone_ai_split_workflow_json'

const validateComfyBaseUrl = async (baseUrl: string) => {
  const u = normalizeBaseUrl(baseUrl)
  if (!u) return false
  try {
    const r = await requestJson(u, '/system_stats', { method: 'GET' })
    return !!r?.ok
  } catch {
    return false
  }
}

export async function runBoneComfySplit(args: {
  portraitDataUrl: string
  portraitFileName: string
  baseUrl?: string
  prompt?: string
  negative?: string
  layers?: number
  width?: number
  height?: number
  filenamePrefix?: string
}): Promise<{ baseUrl: string; promptId: string; outputs: BoneComfySplitOutput[] }> {
  const baseUrl =
    normalizeBaseUrl(String(args.baseUrl || '')) ||
    normalizeBaseUrl((() => { try { return String(localStorage.getItem('novaflow_runtime_last_connected_url') || '') } catch { return '' } })()) ||
    NOVAFLOW_RUNTIME_BASE_URL

  let connectedUrl = baseUrl
  if (connectedUrl) {
    const ok = await validateComfyBaseUrl(connectedUrl)
    if (!ok) connectedUrl = ''
  }
  if (!connectedUrl) {
    try {
      connectedUrl = await detectComfyBaseUrl()
    } catch {
      throw new Error('未找到 NovaFlow AI Runtime，请重新检测 Runtime')
    }
  }
  try { localStorage.setItem('novaflow_runtime_last_connected_url', connectedUrl) } catch { }

  const up = await uploadImage(connectedUrl, args.portraitDataUrl, args.portraitFileName || 'portrait.png')
  if (!up?.ok) {
    const statusHint = up?.status ? `（HTTP ${String(up.status)}）` : ''
    const raw = typeof up?.raw === 'string' ? String(up.raw || '').trim() : ''
    const rawHint = raw ? ` ${raw.slice(0, 240)}` : ''
    const hint = Number(up?.status || 0) === 502 && raw.toLowerCase().includes('proxy') ? '（Runtime 地址不可达/未启动）' : ''
    throw new Error(`上传失败：${String((up as any)?.error || (up as any)?.status || '')}${statusHint}${hint}${rawHint}`)
  }
  const uploadedName = String(up?.data?.name || up?.data?.filename || '').trim()
  if (!uploadedName) throw new Error('上传失败：未返回文件名')

  const workflowJson = (() => {
    try {
      const s = String(localStorage.getItem(boneSplitWorkflowStorageKey) || '').trim()
      if (s) return s
    } catch { }
    return BONE_AI_SPLIT_WORKFLOW_V1_JSON
  })()

  let workflow: any
  try {
    workflow = JSON.parse(workflowJson)
  } catch {
    throw new Error('拆图 workflow JSON 无效，请重新拖拽导入')
  }
  const promptObj = workflow?.prompt && typeof workflow.prompt === 'object' ? workflow.prompt : workflow
  const looksLikePromptObj = (() => {
    try {
      const vals = Object.values<any>(promptObj || {})
      return vals.some((n: any) => n && typeof n === 'object' && typeof n.class_type === 'string' && n.inputs && typeof n.inputs === 'object')
    } catch {
      return false
    }
  })()
  if (!looksLikePromptObj) throw new Error('拆图 workflow 不是 Runtime API 格式，请重新导入 API 格式 workflow')
  workflow = patchComfyWorkflow(workflow, {
    prompt: String(args.prompt || ''),
    negative: String(args.negative || ''),
    width: Math.max(1, Math.round(Number(args.width) || 1024)),
    height: Math.max(1, Math.round(Number(args.height) || 1024)),
    frames: 1,
    fps: 1,
    steps: 20,
    seed: Math.floor(Math.random() * 1_000_000_000),
    images: [uploadedName]
  })
  let savePrefixes = extractSaveImagePrefixes(workflow)
  try {
    const prefix = String(args.filenamePrefix || '').trim()
    if (prefix) {
      const obj = (workflow as any)?.prompt && typeof (workflow as any).prompt === 'object' ? (workflow as any).prompt : workflow
      for (const [, node] of Object.entries<any>(obj || {})) {
        if (String(node?.class_type || '') !== 'SaveImage') continue
        if (!node?.inputs || typeof node.inputs !== 'object') continue
        if ('filename_prefix' in node.inputs) node.inputs.filename_prefix = prefix
      }
      savePrefixes = [prefix]
    }
  } catch { }
  try {
    const obj = (workflow as any)?.prompt && typeof (workflow as any).prompt === 'object' ? (workflow as any).prompt : workflow
    for (const [, node] of Object.entries<any>(obj || {})) {
      if (String(node?.class_type || '') !== 'LoadImage') continue
      if (!node?.inputs || typeof node.inputs !== 'object') continue
      if ('image' in node.inputs) node.inputs.image = uploadedName
      if ('filename' in node.inputs) node.inputs.filename = uploadedName
    }
  } catch { }
  try {
    const v = Math.max(1, Math.min(24, Math.round(Number(args.layers ?? 8))))
    const obj = (workflow as any)?.prompt && typeof (workflow as any).prompt === 'object' ? (workflow as any).prompt : workflow
    for (const [, node] of Object.entries<any>(obj || {})) {
      if (String(node?.class_type || '') !== 'EmptyQwenImageLayeredLatentImage') continue
      if (!node?.inputs || typeof node.inputs !== 'object') continue
      if ('layers' in node.inputs) node.inputs.layers = v
    }
  } catch { }

  const clientId = `novaflow_bone_${crypto.randomUUID()}`
  const r = await requestJson(connectedUrl, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, prompt: workflow?.prompt || workflow }) })
  if (!r?.ok) {
    const statusHint = r?.status ? `（HTTP ${String(r.status)}）` : ''
    const raw = typeof r?.raw === 'string' ? String(r.raw || '').trim() : ''
    const rawHint = raw ? ` ${raw.slice(0, 240)}` : ''
    throw new Error(`下发失败：${String(r?.error || r?.status || '')}${statusHint}${rawHint}`)
  }
  const pid = String(r?.data?.prompt_id || '').trim()
  if (!pid) throw new Error('下发失败：未返回 prompt_id')

  const start = Date.now()
  let stable = 0
  let lastSig = ''
  let lastFiles: ComfyFile[] = []
  while (Date.now() - start < 180_000) {
    const h = await requestJson(connectedUrl, `/history/${pid}`, { method: 'GET' })
    if (h?.ok) {
      const one = pickHistoryItem(h?.data, pid)
      const files = extractComfyHistoryFiles(one)
      const imgs0 = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(String(f.filename || '')))
      const imgs = savePrefixes.length
        ? imgs0.filter((f) => savePrefixes.some((p) => String(f.filename || '').startsWith(`${p}_`) || String(f.filename || '').startsWith(p)))
        : imgs0
      const sig = imgs.map((x) => `${x.type}/${x.subfolder}/${x.filename}`).join('|')
      if (sig && sig === lastSig) {
        stable += 1
        if (stable >= 2) {
          lastFiles = imgs
          break
        }
      } else {
        stable = 0
        lastSig = sig
      }
      if (sig) lastFiles = imgs
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 800))
  }

  if (!lastFiles.length) throw new Error('未获取到输出图片（history为空或超时）')

  const outputs: BoneComfySplitOutput[] = []
  for (const f of lastFiles) {
    const qs = new URLSearchParams()
    qs.set('filename', f.filename)
    if (f.subfolder) qs.set('subfolder', f.subfolder)
    qs.set('type', f.type || 'output')
    const view = await fetchBlob(connectedUrl, `/view?${qs.toString()}`, { method: 'GET' })
    if (!view?.ok) continue
    const blob = view.blob
    if (!blob || blob.size <= 0) continue
    const objectUrl = URL.createObjectURL(blob)
    outputs.push({ filename: f.filename, objectUrl, blob })
  }

  if (!outputs.length) throw new Error('输出图片下载失败（view返回空）')
  return { baseUrl: connectedUrl, promptId: pid, outputs }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { buildSpineProject, type SpineProject } from '../engine/SpineMiniPlayer'
import { SpinePreview, type SpinePreviewHandle } from './SpinePreview'
import {
  SPINE_PARSE_WORKER_VERSION,
  type SpineParseWorkerRequest,
  type SpineParseWorkerResponse,
  type SpineSource
} from '../runtime/spine/SpineRuntimeTypes'
import { Panel } from './ui/Panel'
import { SliderControl } from './ui/controls'
import { PreviewZoomBar } from './preview/hud/PreviewZoomBar'
import { SimpleTimelineTransport } from '../timeline/SimpleTimelineTransport'
import {
  exportSplitPsd,
  fuseSeeThroughPartsWithSource,
  generateSplitMask,
  importSeeThroughLayerFiles,
  type AiSplitParams,
  type EdgeMode,
  type SplitRuntimePart
} from '../services/aiSplitService'

type ImportedSpineFiles = {
  portrait: { fileName: string; dataUrl: string } | null
  psd: { fileName: string } | null
  skeleton: { kind: 'json' | 'skel'; fileName: string; text?: string } | null
  atlas: { fileName: string; text: string } | null
  images: { fileName: string; dataUrl: string }[]
}

const readFileAsDataUrl = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => resolve(String(r.result || ''))
    r.readAsDataURL(file)
  })
}

const readFileAsText = (file: File) => {
  return file.text()
}

let spineImportWorkerRequestId = 0

const makeAbortError = (message: string) => {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError')
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

const isAbortError = (error: unknown) => {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError')
}

const parseSpineProjectInWorker = (source: SpineSource & { key: string }, signal: AbortSignal) => {
  if (signal.aborted) return Promise.reject(makeAbortError('Spine import aborted'))
  if (typeof Worker === 'undefined') {
    return Promise.resolve(buildSpineProject(source.jsonText, source.atlasText, source.images))
  }
  return new Promise<SpineProject>((resolve, reject) => {
    const id = ++spineImportWorkerRequestId
    const worker = new Worker(new URL('../runtime/spine/SpineParseWorker.ts', import.meta.url), {
      type: 'module',
      name: 'NovaFlowSpineImportWorker'
    })
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.terminate()
    }
    const onAbort = () => {
      cleanup()
      reject(makeAbortError('Spine import aborted'))
    }
    const onError = (event: ErrorEvent) => {
      cleanup()
      reject(event.error || new Error(event.message || 'Spine import worker failed'))
    }
    const onMessage = (event: MessageEvent<SpineParseWorkerResponse>) => {
      const response = event.data
      if (!response || response.id !== id) return
      cleanup()
      if (response.type === 'parsed') {
        resolve(response.resource.project)
        return
      }
      const error = new Error(response.error.message)
      error.name = response.error.name
      reject(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const request: SpineParseWorkerRequest = {
      id,
      type: 'parse',
      version: SPINE_PARSE_WORKER_VERSION,
      source
    }
    worker.postMessage(request)
  })
}

const listSkinNames = (skins: any) => {
  if (!skins) return []
  if (Array.isArray(skins)) return skins.map((s: any) => String(s?.name || '')).filter(Boolean)
  if (typeof skins === 'object') return Object.keys(skins).filter(Boolean)
  return []
}

const computeDurationSec = (project: SpineProject, animName: string) => {
  const anim: any = (project.animations || {})[animName]
  if (!anim) return 0
  if (typeof anim.duration === 'number' && anim.duration > 0) return anim.duration
  const timeOf = (k: any) => (typeof k?.time === 'number' ? k.time : 0)
  let maxT = 0
  const bones = anim.bones || {}
  const slots = anim.slots || {}
  for (const k of Object.keys(bones)) {
    const b = bones[k] || {}
    for (const list of [b.translate, b.rotate, b.scale, b.shear]) {
      const last = list?.[list.length - 1]
      if (last) maxT = Math.max(maxT, timeOf(last))
    }
  }
  for (const k of Object.keys(slots)) {
    const s = slots[k] || {}
    const last = s.color?.[s.color.length - 1]
    if (last) maxT = Math.max(maxT, timeOf(last))
    const lastAtt = s.attachment?.[s.attachment.length - 1]
    if (lastAtt) maxT = Math.max(maxT, timeOf(lastAtt))
  }
  const drawOrder = anim.drawOrder || []
  if (Array.isArray(drawOrder) && drawOrder.length) {
    const last = drawOrder[drawOrder.length - 1]
    if (last) maxT = Math.max(maxT, timeOf(last))
  }
  return maxT
}

const publishSplitPreviewState = (detail: {
  sourceImage?: string
  parts: SplitRuntimePart[]
  activePartId?: string
  viewMode?: 'source' | 'mask' | 'parts' | 'single'
}) => {
  try {
    window.dispatchEvent(new CustomEvent('novaflow:spine-split-preview', { detail }))
  } catch {
    void 0
  }
}

export function SkeletonAnimationSidebar({
  spineSubEditor,
  files,
  setFiles,
  project,
  setProject
}: {
  spineSubEditor: string
  files: ImportedSpineFiles
  setFiles: (next: ImportedSpineFiles) => void
  project: SpineProject | null
  setProject: (p: SpineProject | null) => void
}) {
  const portraitInputRef = useRef<HTMLInputElement | null>(null)
  const seeThroughLayerInputRef = useRef<HTMLInputElement | null>(null)
  const psdInputRef = useRef<HTMLInputElement | null>(null)
  const spineSkeletonInputRef = useRef<HTMLInputElement | null>(null)
  const spineAtlasInputRef = useRef<HTMLInputElement | null>(null)
  const spinePngInputRef = useRef<HTMLInputElement | null>(null)
  const filesRef = useRef<ImportedSpineFiles>(files)
  const [error, setError] = useState<string | null>(null)
  const [ribbonStiffness, setRibbonStiffness] = useState(50)
  const [ribbonAmplitude, setRibbonAmplitude] = useState(50)
  const [ribbonDecay, setRibbonDecay] = useState(50)
  const [ribbonWarmup, setRibbonWarmup] = useState(12)
  const [boneAiBusy, setBoneAiBusy] = useState(false)
  const [boneAiMessage, setBoneAiMessage] = useState<string | null>(null)
  const [boneAiOutputs, setBoneAiOutputs] = useState<Array<{ filename: string; objectUrl: string }>>([])
  const boneAiUrlsRef = useRef<string[]>([])
  const splitEdgeMode: EdgeMode = 'removeWhite'
  const splitFusionFeatherPx = 4
  const [splitLayerSourceName, setSplitLayerSourceName] = useState('')
  const [splitParts, setSplitParts] = useState<SplitRuntimePart[]>([])
  const [splitActivePartId, setSplitActivePartId] = useState('')
  const [splitPreviewMode, setSplitPreviewMode] = useState<'source' | 'mask' | 'parts' | 'single'>('parts')
  const splitSignatureRef = useRef('')
  const spineImportRunRef = useRef(0)
  const spineImportAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  useEffect(() => {
    return () => {
      spineImportAbortRef.current?.abort()
      spineImportAbortRef.current = null
      try {
        for (const u of boneAiUrlsRef.current) {
          try { URL.revokeObjectURL(u) } catch { }
        }
      } finally {
        boneAiUrlsRef.current = []
      }
    }
  }, [])

  useEffect(() => {
    splitSignatureRef.current = ''
    setSplitParts([])
    setSplitActivePartId('')
    setSplitLayerSourceName('')
    setBoneAiOutputs([])
    publishSplitPreviewState({
      sourceImage: files.portrait?.dataUrl || '',
      parts: [],
      activePartId: '',
      viewMode: 'source'
    })
  }, [files.portrait?.dataUrl])

  const rebuild = async (nextFiles: ImportedSpineFiles, opts?: { showMissingError?: boolean }) => {
    const runId = ++spineImportRunRef.current
    spineImportAbortRef.current?.abort()
    const controller = new AbortController()
    spineImportAbortRef.current = controller
    setError(null)
    if (!nextFiles.skeleton || !nextFiles.atlas || nextFiles.images.length === 0) {
      setProject(null)
      spineImportAbortRef.current = null
      if (opts?.showMissingError) setError('请先导入 Skeleton / Atlas / PNG')
      return
    }
    if (nextFiles.skeleton.kind !== 'json' || !nextFiles.skeleton.text) {
      setProject(null)
      spineImportAbortRef.current = null
      setError('暂不支持 .skel，请导入 .json')
      return
    }
    setProject(null)
    try {
      const p = await parseSpineProjectInWorker({
        key: [
          nextFiles.skeleton.fileName,
          nextFiles.atlas.fileName,
          nextFiles.images.map((image) => image.fileName).join(','),
          Date.now()
        ].join('::'),
        jsonText: nextFiles.skeleton.text,
        atlasText: nextFiles.atlas.text,
        images: nextFiles.images,
        fileName: nextFiles.skeleton.fileName,
        atlasFileName: nextFiles.atlas.fileName
      }, controller.signal)
      if (runId !== spineImportRunRef.current || controller.signal.aborted) return
      setProject(p)
    } catch (e: any) {
      if (isAbortError(e)) return
      if (runId !== spineImportRunRef.current) return
      setProject(null)
      setError(String(e?.message || '导入失败'))
    } finally {
      if (spineImportAbortRef.current === controller) spineImportAbortRef.current = null
    }
  }

  const applyFiles = (nextFiles: ImportedSpineFiles) => {
    setFiles(nextFiles)
  }

  const onPickPortrait = async (file: File) => {
    setError(null)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      applyFiles({ ...files, portrait: { fileName: String(file.name || ''), dataUrl } })
    } catch {
      setError('导入立绘失败')
    }
  }

  const onPickPsd = async (file: File) => {
    setError(null)
    applyFiles({ ...files, psd: { fileName: String(file.name || '') } })
  }

  const onPickSpineSkeleton = async (file: File) => {
    setError(null)
    setProject(null)
    const name = String(file.name || '')
    const lower = name.toLowerCase()
    if (lower.endsWith('.skel')) {
      applyFiles({ ...filesRef.current, skeleton: { kind: 'skel', fileName: name } })
      return
    }
    try {
      const text = await readFileAsText(file)
      applyFiles({ ...filesRef.current, skeleton: { kind: 'json', fileName: name, text } })
    } catch {
      setError('导入Skeleton失败')
    }
  }

  const onPickSpineAtlas = async (file: File) => {
    setError(null)
    setProject(null)
    try {
      const text = await readFileAsText(file)
      applyFiles({ ...filesRef.current, atlas: { fileName: String(file.name || ''), text } })
    } catch {
      setError('导入Atlas失败')
    }
  }

  const onPickSpinePng = async (file: File) => {
    setError(null)
    setProject(null)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      applyFiles({ ...filesRef.current, images: [{ fileName: String(file.name || ''), dataUrl }] })
    } catch {
      setError('导入PNG失败')
    }
  }

  const applySpineFilesFromList = async (list: File[]) => {
    setError(null)
    setProject(null)
    const picked = list.filter(Boolean)
    if (picked.length === 0) return
    const base = filesRef.current
    let next: ImportedSpineFiles = { ...base, images: [...(base.images || [])] } as any
    for (const f of picked) {
      const name = String(f.name || '')
      const lower = name.toLowerCase()
      if (lower.endsWith('.json') || lower.endsWith('.skel')) {
        if (lower.endsWith('.json')) {
          const text = await readFileAsText(f)
          next = { ...next, skeleton: { kind: 'json', fileName: name, text } }
        } else {
          next = { ...next, skeleton: { kind: 'skel', fileName: name } }
        }
      } else if (lower.endsWith('.atlas')) {
        const text = await readFileAsText(f)
        next = { ...next, atlas: { fileName: name, text } }
      } else if (String(f.type || '').toLowerCase().includes('png') || lower.endsWith('.png')) {
        const dataUrl = await readFileAsDataUrl(f)
        next = { ...next, images: [...next.images, { fileName: name, dataUrl }] }
      }
    }
    applyFiles(next)
  }

  const onDrop = (e: any) => {
    e.preventDefault()
    const list = Array.from(e.dataTransfer?.files || []) as File[]
    if (list.length === 0) return
    void (async () => {
      await applySpineFilesFromList(list)
    })()
  }

  const publishCurrentSplitPreview = (
    parts: SplitRuntimePart[],
    viewMode: 'source' | 'mask' | 'parts' | 'single',
    activePartId = splitActivePartId
  ) => {
    publishSplitPreviewState({
      sourceImage: filesRef.current.portrait?.dataUrl || '',
      parts,
      activePartId,
      viewMode
    })
  }

  const buildSplitSignature = () => {
    const portrait = filesRef.current.portrait
    const source = portrait?.dataUrl || ''
    return JSON.stringify({
      source: source ? `${portrait?.fileName || 'source'}:${source.length}:${source.slice(0, 96)}:${source.slice(-96)}` : '',
      workflow: 'psd-layer-fusion',
      layerSource: splitLayerSourceName,
      edgeMode: splitEdgeMode,
      featherPx: splitFusionFeatherPx
    })
  }

  const runSplitPipeline = async (viewMode: 'mask' | 'parts' | 'single' = 'parts') => {
    if (boneAiBusy) return splitParts
    const portrait = filesRef.current.portrait
    if (!portrait?.dataUrl) {
      setBoneAiMessage('没有导入图片')
      throw new Error('没有导入图片')
    }
    const requestSignature = buildSplitSignature()
    setBoneAiBusy(true)
    setBoneAiMessage('正在生成高清 See-through 拆图…')
    try {
      const baseParams: AiSplitParams = {
        sourceImage: portrait.dataUrl,
        sourceFileName: portrait.fileName,
        prompt: '',
        mode: 'auto',
        purpose: 'spine',
        quality: 'fine',
        edgeMode: splitEdgeMode,
        inpaintMode: 'standard',
        spineFix: false
      }
      const parts = await generateSplitMask(baseParams)
      const firstId = parts[0]?.id || ''
      splitSignatureRef.current = requestSignature
      setSplitLayerSourceName('See-through auto')
      setSplitParts(parts)
      setSplitActivePartId((prev) => prev || firstId)
      setSplitPreviewMode(viewMode)
      setBoneAiOutputs(parts.map((part) => ({ filename: `${part.id}.png`, objectUrl: String(part.dataUrl || '') })))
      applyFiles({
        ...filesRef.current,
        images: parts
          .filter((part) => part.dataUrl)
          .map((part) => ({ fileName: `${part.id}.png`, dataUrl: String(part.dataUrl || '') }))
      })
      publishCurrentSplitPreview(parts, viewMode, firstId)
      setBoneAiMessage(`完成：${parts.length} 个 PSD 融合图层`)
      return parts
    } catch (e: any) {
      const msg = String(e?.message || e || '拆图失败')
      setBoneAiMessage(msg)
      throw e
    } finally {
      setBoneAiBusy(false)
    }
  }

  const applyPsdFusionParts = (parts: SplitRuntimePart[], viewMode: 'source' | 'mask' | 'parts' | 'single' = 'parts') => {
    const firstId = parts[0]?.id || ''
    splitSignatureRef.current = buildSplitSignature()
    setSplitParts(parts)
    setSplitActivePartId((prev) => prev || firstId)
    setSplitPreviewMode(viewMode)
    setBoneAiOutputs(parts.map((part) => ({ filename: `${part.id}.png`, objectUrl: String(part.dataUrl || '') })))
    applyFiles({
      ...filesRef.current,
      images: parts
        .filter((part) => part.dataUrl)
        .map((part) => ({ fileName: `${part.id}.png`, dataUrl: String(part.dataUrl || '') }))
    })
    publishCurrentSplitPreview(parts, viewMode, firstId)
  }

  const onPickSeeThroughLayerFiles = async (list: File[]) => {
    const portrait = filesRef.current.portrait
    if (!portrait?.dataUrl) {
      setBoneAiMessage('请先导入原图')
      return
    }
    if (!list.length) return
    setBoneAiBusy(true)
    setBoneAiMessage('正在读取 See-through 图层并融合原图像素…')
    try {
      const imported = await importSeeThroughLayerFiles({
        files: list,
        sourceImage: portrait.dataUrl,
        sourceFileName: portrait.fileName,
        options: { edgeMode: splitEdgeMode, featherPx: splitFusionFeatherPx, sourcePriority: 'high' }
      })
      const fused = await fuseSeeThroughPartsWithSource({
        sourceImage: portrait.dataUrl,
        parts: imported,
        options: { edgeMode: splitEdgeMode, featherPx: splitFusionFeatherPx, sourcePriority: 'high' }
      })
      setSplitLayerSourceName(`${list.length} files`)
      applyPsdFusionParts(fused)
      setBoneAiMessage(`完成：${fused.length} 个 PSD 融合图层`)
    } catch (e: any) {
      setBoneAiMessage(String(e?.message || e || 'PSD 融合失败'))
    } finally {
      setBoneAiBusy(false)
    }
  }

  const ensureSplitParts = async () => {
    if (splitParts.length) return splitParts
    return await runSplitPipeline('parts')
  }

  const exportCurrentPsd = async () => {
    const portrait = filesRef.current.portrait
    if (!portrait?.dataUrl) {
      setBoneAiMessage('请先导入原图')
      return
    }
    try {
      const parts = await ensureSplitParts()
      setBoneAiMessage('正在导出 PSD 文件…')
      const filePath = await exportSplitPsd({
        sourceImage: portrait.dataUrl,
        sourceFileName: portrait.fileName,
        parts
      })
      setBoneAiMessage(filePath ? `已导出 PSD：${filePath}` : '已取消导出')
    } catch (e: any) {
      setBoneAiMessage(String(e?.message || e || 'PSD 导出失败'))
    }
  }

  if (spineSubEditor !== 'bone') return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Panel id="bone-import" title="导入文件" icon="file-import" defaultOpen={true}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => portraitInputRef.current?.click()}
              onDragOver={(e: any) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy' } catch { } }}
              onDrop={(e: any) => {
                e.preventDefault()
                const f = e.dataTransfer?.files?.[0] as File | undefined
                if (!f) return
                if (String(f.type || '').toLowerCase().startsWith('image/')) {
                  void onPickPortrait(f)
                }
              }}
              style={{ flex: 1, height: 34, borderRadius: 8, background: '#24282e', border: '1px solid transparent', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}
            >
              导入立绘（拖拽）
            </button>
            <button
              type="button"
              onClick={() => psdInputRef.current?.click()}
              style={{ flex: 1, height: 34, borderRadius: 8, background: '#24282e', border: '1px solid transparent', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}
            >
              导入 PSD
            </button>
          </div>

          <div
            className="nf-upload-dropzone nf-upload-dropzone--medium"
            data-nf-upload-dropzone="1"
            onDragOver={(e: any) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy' } catch { } }}
            onDrop={onDrop}
            style={{ alignItems: 'stretch', textAlign: 'left' }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.86)' }}>导入动画工程</div>
              <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.80)' }}>可拖拽到此处</div>
            </div>
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              {(
                [
                  { k: 'skeleton', label: 'Skeleton', v: files.skeleton ? files.skeleton.fileName : '未导入', onPick: () => spineSkeletonInputRef.current?.click() },
                  { k: 'atlas', label: 'Atlas', v: files.atlas ? files.atlas.fileName : '未导入', onPick: () => spineAtlasInputRef.current?.click() },
                  { k: 'png', label: 'PNG', v: files.images?.length ? files.images.map((x) => x.fileName).join(' , ') : '未导入', onPick: () => spinePngInputRef.current?.click() }
                ] as const
              ).map((it) => (
                <div key={it.k} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.95)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.label}：<span style={{ color: it.v === '未导入' ? 'rgba(148,163,184,0.95)' : '#60a5fa' }}>{it.v}</span>
                  </div>
                  <button
                    type="button"
                    onClick={it.onPick}
                    style={{ height: 28, padding: '0 12px', borderRadius: 8, background: 'rgba(30,166,114,0.12)', border: '1px solid rgba(30,166,114,0.26)', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12, flex: '0 0 auto' }}
                  >
                    导入
                  </button>
                </div>
              ))}
            </div>
          </div>

          <input
            ref={portraitInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onClick={(e: any) => { e.currentTarget.value = '' }}
            onChange={(e: any) => { const f = e.currentTarget.files?.[0] as File | undefined; if (!f) return; void onPickPortrait(f) }}
          />
          <input
            ref={seeThroughLayerInputRef}
            type="file"
            accept=".png,.json,image/png,application/json"
            multiple
            style={{ display: 'none' }}
            {...({ webkitdirectory: '', directory: '' } as any)}
            onClick={(e: any) => { e.currentTarget.value = '' }}
            onChange={(e: any) => { const list = Array.from(e.currentTarget.files || []) as File[]; void onPickSeeThroughLayerFiles(list) }}
          />
          <input
            ref={psdInputRef}
            type="file"
            accept=".psd"
            style={{ display: 'none' }}
            onClick={(e: any) => { e.currentTarget.value = '' }}
            onChange={(e: any) => { const f = e.currentTarget.files?.[0] as File | undefined; if (!f) return; void onPickPsd(f) }}
          />
          <input
            ref={spineSkeletonInputRef}
            type="file"
            accept=".json,.skel"
            style={{ display: 'none' }}
            onClick={(e: any) => { e.currentTarget.value = '' }}
            onChange={(e: any) => { const f = e.currentTarget.files?.[0] as File | undefined; if (!f) return; void onPickSpineSkeleton(f) }}
          />
          <input
            ref={spineAtlasInputRef}
            type="file"
            accept=".atlas"
            style={{ display: 'none' }}
            onClick={(e: any) => { e.currentTarget.value = '' }}
            onChange={(e: any) => { const f = e.currentTarget.files?.[0] as File | undefined; if (!f) return; void onPickSpineAtlas(f) }}
          />
          <input
            ref={spinePngInputRef}
            type="file"
            accept="image/png,.png"
            style={{ display: 'none' }}
            onClick={(e: any) => { e.currentTarget.value = '' }}
            onChange={(e: any) => { const f = e.currentTarget.files?.[0] as File | undefined; if (!f) return; void onPickSpinePng(f) }}
          />

          <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.95)', lineHeight: 1.6 }}>
            <div>立绘：{files.portrait ? files.portrait.fileName : '未导入'}</div>
            <div>PSD：{files.psd ? files.psd.fileName : '未导入'}</div>
            <div>Spine：{project ? '已置入' : '未置入'}</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                applyFiles({ portrait: null, psd: null, skeleton: null, atlas: null, images: [] })
                setProject(null)
                setError(null)
              }}
              style={{ flex: 1, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => { void rebuild(filesRef.current, { showMissingError: true }) }}
              style={{ flex: 1, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}
            >
              置入画板
            </button>
          </div>

          {!!error && <div style={{ fontSize: 11, color: 'rgba(239, 68, 68, 0.95)' }}>{error}</div>}
        </div>
      </Panel>

      <Panel id="bone-ai" title="拆图编辑" icon="layer-group" defaultOpen={true}>
        <div style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <div data-psd-fusion-ui="1" style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: '#0b0d10', padding: 8, display: 'grid', gap: 8, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
            <div style={{ borderRadius: 10, border: '1px dashed rgba(255,255,255,0.18)', background: 'transparent', padding: 8, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,0.86)' }}>融合流程</div>
                <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.85)' }}>PSD only</div>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(148,163,184,0.85)', lineHeight: 1.4 }}>
                See-through 负责补全结构；原图负责可见区域保真；接缝使用 4px 羽化融合。
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.92)' }}>PSD 分层融合</div>
                  <div style={{ marginTop: 3, fontSize: 10, color: 'rgba(148,163,184,0.85)' }}>原图像素 + See-through 补全部分</div>
                </div>
                <button
                  type="button"
                  onClick={() => portraitInputRef.current?.click()}
                  style={{ height: 28, padding: '0 10px', borderRadius: 8, background: 'rgba(30,166,114,0.12)', border: '1px solid rgba(30,166,114,0.26)', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 11 }}
                >
                  {files.portrait?.fileName || '导入原图'}
                </button>
              </div>

              <div style={{ height: 28, display: 'flex', alignItems: 'center', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(148,163,184,0.95)', padding: '0 8px', fontSize: 11, fontWeight: 800 }}>
                {splitLayerSourceName ? `图层：${splitLayerSourceName}` : '先导入原图，再导入 See-through 图层目录'}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" disabled={boneAiBusy} onClick={() => { void runSplitPipeline('parts') }} style={{ gridColumn: '1 / -1', height: 34, borderRadius: 8, background: 'rgba(30,166,114,0.14)', border: '1px solid rgba(30,166,114,0.30)', color: '#fff', cursor: boneAiBusy ? 'default' : 'pointer', fontWeight: 900, fontSize: 12 }}>{boneAiBusy ? '处理中…' : '自动生成并融合'}</button>
                <button type="button" disabled={boneAiBusy} onClick={() => seeThroughLayerInputRef.current?.click()} style={{ height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', cursor: boneAiBusy ? 'default' : 'pointer', fontWeight: 900, fontSize: 12 }}>导入图层目录</button>
                <button type="button" disabled={boneAiBusy} onClick={() => { void exportCurrentPsd() }} style={{ height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', cursor: boneAiBusy ? 'default' : 'pointer', fontWeight: 900, fontSize: 12 }}>导出 PSD</button>
              </div>

              {splitParts.length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,0.86)' }}>融合图层</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['source', 'mask', 'parts'] as const).map((mode) => (
                        <button key={mode} type="button" onClick={() => { setSplitPreviewMode(mode); publishCurrentSplitPreview(splitParts, mode) }} style={{ height: 24, padding: '0 8px', borderRadius: 8, background: splitPreviewMode === mode ? 'rgba(30,166,114,0.18)' : 'rgba(255,255,255,0.05)', border: splitPreviewMode === mode ? '1px solid rgba(30,166,114,0.34)' : '1px solid rgba(255,255,255,0.10)', color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 10 }}>
                          {mode === 'source' ? '原图' : mode === 'mask' ? 'Mask' : 'PNG'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {splitParts.map((part) => (
                      <button
                        key={part.id}
                        type="button"
                        onClick={() => {
                          setSplitActivePartId(part.id)
                          setSplitPreviewMode('single')
                          publishCurrentSplitPreview(splitParts, 'single', part.id)
                        }}
                        style={{ height: 26, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 8, background: splitActivePartId === part.id ? 'rgba(30,166,114,0.18)' : 'rgba(255,255,255,0.04)', border: splitActivePartId === part.id ? '1px solid rgba(30,166,114,0.32)' : '1px solid rgba(255,255,255,0.10)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 800, padding: '0 8px' }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{part.name}</span>
                        <span style={{ color: part.needsInpaint ? '#fbbf24' : 'rgba(148,163,184,0.85)', fontSize: 10 }}>L{part.layer}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {!!boneAiMessage && (
              <div style={{ fontSize: 11, color: boneAiMessage.includes('失败') ? 'rgba(239, 68, 68, 0.95)' : 'rgba(148,163,184,0.95)', lineHeight: 1.5 }}>
                {boneAiMessage}
              </div>
            )}

            {boneAiOutputs.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {boneAiOutputs.slice(0, 9).map((it) => (
                  <div key={it.objectUrl} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', padding: 6 }}>
                    <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
                      <img src={it.objectUrl} alt={it.filename} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(148,163,184,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.filename}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel id="bone-ribbon" title="飘带物理" icon="wave-square" defaultOpen={false}>
        <div style={{ fontSize: 11, color: 'rgba(148,163,184,0.95)', lineHeight: 1.6, marginBottom: 10 }}>
          选择骨骼链后调整参数
        </div>
        <SliderControl label="硬度/延迟" min={0} max={100} value={ribbonStiffness} onChange={(v: number) => setRibbonStiffness(v)} />
        <SliderControl label="振幅" min={0} max={100} value={ribbonAmplitude} onChange={(v: number) => setRibbonAmplitude(v)} />
        <SliderControl label="链衰减" min={0} max={100} value={ribbonDecay} onChange={(v: number) => setRibbonDecay(v)} />
        <SliderControl label="预热帧数" min={0} max={120} value={ribbonWarmup} onChange={(v: number) => setRibbonWarmup(v)} />
        <button
          type="button"
          onClick={() => window.alert('即将推出')}
          style={{ width: '100%', height: 34, borderRadius: 8, background: '#24282e', border: '1px solid transparent', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}
        >
          实时预览
        </button>
      </Panel>

    </div>
  )
}

export function SkeletonAnimationPreview({
  viewportW,
  viewportH,
  zoom,
  panX,
  panY,
  project,
  source,
  previewUiGutter,
  ribbonEventTimes = [],
  activeRibbonEventTimeSec = null,
  activeRibbonEventLabel = ''
}: {
  viewportW: number
  viewportH: number
  zoom: number
  panX: number
  panY: number
  onAutoFit: () => void
  project: SpineProject | null
  source?: SpineSource | null
  previewUiGutter: number
  ribbonEventTimes?: number[]
  activeRibbonEventTimeSec?: number | null
  activeRibbonEventLabel?: string
}) {
  const RIGHT_PANEL_W = 320
  const zoomUiRef = useRef<HTMLDivElement | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [bgBrightness, setBgBrightness] = useState(1)
  const [zoomUiW, setZoomUiW] = useState(0)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const previewRuntimeRef = useRef<SpinePreviewHandle | null>(null)
  const transformInteractionActiveRef = useRef(false)
  const transformInteractionTimerRef = useRef<number | null>(null)
  const animationSelectTokenRef = useRef(0)
  const animationSelectRafRef = useRef<number | null>(null)
  const animationSelectTimerRef = useRef<number | null>(null)
  const animationListRef = useRef<HTMLDivElement | null>(null)
  const previewAnimationNameRef = useRef('')
  const cameraDragRef = useRef<null | { pointerId: number; startX: number; startY: number; panX: number; panY: number }>(null)
  const [camera, setCamera] = useState(() => ({
    zoom: Math.max(0.05, Number(zoom) || 1),
    panX: Number(panX) || 0,
    panY: Number(panY) || 0
  }))

  const [animationName, setAnimationName] = useState<string>('')
  const [previewAnimationName, setPreviewAnimationName] = useState<string>('')
  const [skinName, setSkinName] = useState<string>('')
  const [playing, setPlaying] = useState(false)
  const [timeSec, setTimeSec] = useState(0)
  const playingRef = useRef(false)
  const timeSecRef = useRef(0)
  const durationSecRef = useRef(0.01)
  const [treeExpanded, setTreeExpanded] = useState<Record<string, boolean>>({ root: true })
  const [treeSelectedId, setTreeSelectedId] = useState<string>('root')
  const [splitPreview, setSplitPreview] = useState<{
    sourceImage: string
    parts: SplitRuntimePart[]
    activePartId: string
    viewMode: 'source' | 'mask' | 'parts' | 'single'
  }>({ sourceImage: '', parts: [], activePartId: '', viewMode: 'parts' })

  previewAnimationNameRef.current = previewAnimationName
  playingRef.current = playing
  timeSecRef.current = timeSec

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {}
      const parts = Array.isArray(detail.parts) ? detail.parts as SplitRuntimePart[] : []
      setSplitPreview({
        sourceImage: String(detail.sourceImage || ''),
        parts,
        activePartId: String(detail.activePartId || parts[0]?.id || ''),
        viewMode: detail.viewMode === 'source' || detail.viewMode === 'mask' || detail.viewMode === 'single' ? detail.viewMode : 'parts'
      })
    }
    window.addEventListener('novaflow:spine-split-preview', handler)
    return () => window.removeEventListener('novaflow:spine-split-preview', handler)
  }, [])

  const animNames = useMemo(() => {
    if (project) {
      const list = Object.keys(project.animations || {}).filter(Boolean)
      return list.length ? list : []
    }
    return ['idle', 'walk', 'attack']
  }, [project])

  const skinNames = useMemo(() => {
    if (project) {
      const list = listSkinNames(project.skins)
      return list.length ? list : []
    }
    return ['default']
  }, [project])

  const durationAnimationName = previewAnimationName || animationName || animNames[0] || ''
  const durationSec = useMemo(() => {
    if (!project) return 2
    if (!durationAnimationName) return 2
    return Math.max(0.01, computeDurationSec(project, durationAnimationName) || 0.01)
  }, [project, durationAnimationName])
  durationSecRef.current = Math.max(0.01, Number(durationSec) || 0.01)

  const fitCamera = () => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const availW = Math.max(1, rect.width)
    const availH = Math.max(1, rect.height)
    const contentW = Math.max(1, Number(viewportW) || 1)
    const contentH = Math.max(1, Number(viewportH) || 1)
    const fit = Math.min(availW / contentW, availH / contentH)
    setCamera({
      zoom: Math.max(0.05, Math.min(4, Math.floor(fit * 0.92 * 1000) / 1000 || 1)),
      panX: 0,
      panY: 0
    })
  }

  useEffect(() => {
    fitCamera()
  }, [project, viewportW, viewportH])

  const clampPreviewTime = (t: number) => {
    const dur = Math.max(0.01, Number(durationSec) || 0.01)
    return Math.max(0, Math.min(dur, Number(t) || 0))
  }

  const syncTimeFromRuntime = () => {
    const runtime = previewRuntimeRef.current
    if (!runtime) return
    const live = runtime.getTimeSec()
    if (!Number.isFinite(live)) return
    setTimeSec(clampPreviewTime(live))
  }

  const seekPreview = (nextTimeSec: number) => {
    const next = clampPreviewTime(nextTimeSec)
    previewRuntimeRef.current?.setPlaying(false)
    previewRuntimeRef.current?.seek(next)
    setPlaying(false)
    setTimeSec(next)
  }

  useEffect(() => {
    const owner = {}
    const host = window as any
    const bridge = {
      owner,
      getDurationSec: () => Math.max(0.01, previewRuntimeRef.current?.getDurationSec() || durationSecRef.current),
      getTimeSec: () => previewRuntimeRef.current?.getTimeSec() ?? timeSecRef.current,
      isPlaying: () => playingRef.current,
      getCanvas: () => stageRef.current?.querySelector('canvas') || null,
      seek: (nextTimeSec: number) => {
        const duration = Math.max(0.01, previewRuntimeRef.current?.getDurationSec() || durationSecRef.current)
        const next = Math.max(0, Math.min(duration, Number(nextTimeSec) || 0))
        previewRuntimeRef.current?.setPlaying(false)
        previewRuntimeRef.current?.seek(next)
        playingRef.current = false
        timeSecRef.current = next
        setPlaying(false)
        setTimeSec(next)
        return previewRuntimeRef.current?.getTimeSec() ?? next
      },
      restore: (snapshot: { timeSec?: number; playing?: boolean }) => {
        const duration = Math.max(0.01, previewRuntimeRef.current?.getDurationSec() || durationSecRef.current)
        const next = Math.max(0, Math.min(duration, Number(snapshot?.timeSec) || 0))
        const nextPlaying = snapshot?.playing === true
        previewRuntimeRef.current?.seek(next)
        previewRuntimeRef.current?.setPlaying(nextPlaying)
        playingRef.current = nextPlaying
        timeSecRef.current = next
        setPlaying(nextPlaying)
        setTimeSec(next)
      }
    }
    host.__NovaFlowSkeletonExportBridge = bridge
    return () => {
      if (host.__NovaFlowSkeletonExportBridge?.owner === owner) delete host.__NovaFlowSkeletonExportBridge
    }
  }, [])

  const clearPendingAnimationRuntimeSync = () => {
    if (animationSelectRafRef.current != null) {
      window.cancelAnimationFrame(animationSelectRafRef.current)
      animationSelectRafRef.current = null
    }
    if (animationSelectTimerRef.current != null) {
      window.clearTimeout(animationSelectTimerRef.current)
      animationSelectTimerRef.current = null
    }
  }

  const paintAnimationButtonSelection = (next: string) => {
    const root = animationListRef.current
    if (!root) return
    root.querySelectorAll<HTMLButtonElement>('[data-novaflow-spine-animation-button="1"]').forEach((button) => {
      const active = button.dataset.novaflowSpineAnimationName === next
      button.dataset.novaflowSpineAnimationActive = active ? '1' : '0'
      button.dataset.novaflowSkeletonSidebarItem = '1'
      if (active) button.dataset.novaflowSkeletonSidebarItemActive = '1'
      else delete button.dataset.novaflowSkeletonSidebarItemActive
      button.style.background = active ? 'rgba(30,166,114,0.18)' : 'rgba(255,255,255,0.06)'
      button.style.border = active ? '1px solid rgba(30,166,114,0.38)' : '1px solid rgba(255,255,255,0.12)'
    })
  }

  const selectAnimation = (name: string) => {
    const next = String(name || '').trim()
    if (!next) return
    const token = animationSelectTokenRef.current + 1
    animationSelectTokenRef.current = token
    clearPendingAnimationRuntimeSync()
    paintAnimationButtonSelection(next)
    flushSync(() => {
      setAnimationName(next)
    })
    previewRuntimeRef.current?.setAnimation(next)
    previewRuntimeRef.current?.seek(0)
    previewRuntimeRef.current?.setPlaying(false)
    animationSelectRafRef.current = window.requestAnimationFrame(() => {
      animationSelectRafRef.current = null
      animationSelectTimerRef.current = window.setTimeout(() => {
        animationSelectTimerRef.current = null
        if (animationSelectTokenRef.current !== token) return
        setPlaying(false)
        setTimeSec(0)
        setPreviewAnimationName(next)
      }, 0)
    })
  }

  useEffect(() => {
    if (!project) return
    const firstAnim = animNames[0] || ''
    const resolveAnimationName = (prev: string) => prev && (project.animations || {})[prev] ? prev : firstAnim
    setAnimationName(resolveAnimationName)
    setPreviewAnimationName(resolveAnimationName)
    const firstSkin = skinNames[0] || ''
    setSkinName((prev) => prev && skinNames.includes(prev) ? prev : firstSkin)
    previewRuntimeRef.current?.pause()
    previewRuntimeRef.current?.seek(0)
    setTimeSec(0)
    setPlaying(false)
  }, [project, animNames, skinNames])

  useEffect(() => {
    if (!playing) return
    previewRuntimeRef.current?.setPlaying(true)
    syncTimeFromRuntime()
    const id = window.setInterval(syncTimeFromRuntime, 250)
    return () => window.clearInterval(id)
  }, [playing, durationSec])

  useEffect(() => {
    if (!project) return
    const runtime = previewRuntimeRef.current
    if (!runtime) return
    if (!transformInteractionActiveRef.current) {
      transformInteractionActiveRef.current = true
      runtime.beginInteraction?.()
    }
    if (transformInteractionTimerRef.current != null) {
      window.clearTimeout(transformInteractionTimerRef.current)
    }
    transformInteractionTimerRef.current = window.setTimeout(() => {
      transformInteractionTimerRef.current = null
      if (!transformInteractionActiveRef.current) return
      transformInteractionActiveRef.current = false
      previewRuntimeRef.current?.endInteraction?.(220)
    }, 220)
  }, [project, camera.panX, camera.panY, camera.zoom, viewportW, viewportH])

  const beginCameraDrag = (event: any) => {
    if (event.button !== 2 || (event.pointerType && event.pointerType !== 'mouse')) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest?.('[data-preview-ui="1"],button,a,input,textarea,select,[role="button"],[role="slider"]')) return
    event.preventDefault()
    event.stopPropagation()
    try { event.nativeEvent?.stopImmediatePropagation?.() } catch { }
    cameraDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: camera.panX,
      panY: camera.panY
    }
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { }
  }

  const moveCameraDrag = (event: any) => {
    const drag = cameraDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    setCamera((prev) => ({
      ...prev,
      panX: Math.round(drag.panX + event.clientX - drag.startX),
      panY: Math.round(drag.panY + event.clientY - drag.startY)
    }))
  }

  const endCameraDrag = (event: any) => {
    const drag = cameraDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    cameraDragRef.current = null
    event.preventDefault()
    event.stopPropagation()
    try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { }
  }

  useEffect(() => {
    return () => {
      animationSelectTokenRef.current += 1
      clearPendingAnimationRuntimeSync()
      if (transformInteractionTimerRef.current != null) {
        window.clearTimeout(transformInteractionTimerRef.current)
        transformInteractionTimerRef.current = null
      }
      if (transformInteractionActiveRef.current) {
        transformInteractionActiveRef.current = false
        previewRuntimeRef.current?.endInteraction?.(0)
      }
    }
  }, [])

  useEffect(() => {
    const el = zoomUiRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setZoomUiW(el.clientWidth || 0))
    ro.observe(el)
    setZoomUiW(el.clientWidth || 0)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setTreeExpanded({ root: true })
    setTreeSelectedId('root')
  }, [project])

  type BoneTreeNode = {
    id: string
    kind: 'root' | 'bone' | 'slot' | 'image'
    label: string
    children?: BoneTreeNode[]
  }

  const resolveSkinAttachments = (skins: any, wantName: string | null) => {
    if (!skins) return {} as Record<string, Record<string, any>>
    const want = String(wantName || '').trim()
    if (typeof skins === 'object' && !Array.isArray(skins)) {
      const map = skins as Record<string, any>
      if (want && map[want] && typeof map[want] === 'object') return map[want] as any
      if (map.default && typeof map.default === 'object') return map.default as any
      const keys = Object.keys(map)
      for (const k of keys) {
        if (map[k] && typeof map[k] === 'object') return map[k] as any
      }
      return {} as any
    }
    if (Array.isArray(skins)) {
      if (want) {
        const hit = (skins as any[]).find((s) => String((s as any)?.name || '').trim() === want)
        if (hit?.attachments && typeof hit.attachments === 'object') return hit.attachments as any
      }
      const first = skins[0] as { attachments?: unknown } | undefined
      if (first?.attachments && typeof first.attachments === 'object') return first.attachments as any
    }
    return {} as Record<string, Record<string, any>>
  }

  const boneTree = useMemo(() => {
    if (!project) {
      return {
        id: 'root',
        kind: 'root',
        label: '动画工程',
        children: [
          {
            id: 'bone:root',
            kind: 'bone',
            label: 'root',
            children: [
              {
                id: 'bone:board_1',
                kind: 'bone',
                label: 'board_1',
                children: [
                  {
                    id: 'slot:slot_1',
                    kind: 'slot',
                    label: 'slot_1',
                    children: Array.from({ length: 8 }).map((_, i) => ({
                      id: `img:NF_1_${String(i).padStart(4, '0')}`,
                      kind: 'image',
                      label: `NF_1_${String(i).padStart(4, '0')}`
                    }))
                  }
                ]
              }
            ]
          }
        ]
      } as BoneTreeNode
    }

    const bones: any[] = Array.isArray((project as any).bones) ? (project as any).bones : []
    const slots: any[] = Array.isArray((project as any).slots) ? (project as any).slots : []
    const attachmentsBySlot = resolveSkinAttachments((project as any).skins, skinName || null)
    const boneChildren = new Map<string, any[]>()
    for (const b of bones) {
      const p = String(b?.parent || '')
      const list = boneChildren.get(p) || []
      list.push(b)
      boneChildren.set(p, list)
    }
    for (const list of boneChildren.values()) {
      list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
    }

    const slotsByBone = new Map<string, any[]>()
    for (const s of slots) {
      const bn = String(s?.bone || '')
      const list = slotsByBone.get(bn) || []
      list.push(s)
      slotsByBone.set(bn, list)
    }
    for (const list of slotsByBone.values()) {
      list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
    }

    const makeBoneNode = (bone: any): BoneTreeNode => {
      const name = String(bone?.name || 'bone')
      const kids: BoneTreeNode[] = []
      const childBones = boneChildren.get(name) || []
      for (const cb of childBones) kids.push(makeBoneNode(cb))
      const childSlots = slotsByBone.get(name) || []
      for (const s of childSlots) {
        const slotName = String(s?.name || 'slot')
        const attachments = attachmentsBySlot?.[slotName] && typeof attachmentsBySlot[slotName] === 'object' ? Object.keys(attachmentsBySlot[slotName] || {}) : []
        const attNames = attachments.length ? attachments : (s?.attachment ? [String(s.attachment)] : [])
        const children = attNames
          .filter(Boolean)
          .slice(0, 64)
          .map((a) => ({ id: `img:${slotName}:${a}`, kind: 'image' as const, label: a }))
        kids.push({
          id: `slot:${slotName}`,
          kind: 'slot',
          label: slotName,
          children: children.length ? children : undefined
        })
      }
      return { id: `bone:${name}`, kind: 'bone', label: name, children: kids.length ? kids : undefined }
    }

    const roots = boneChildren.get('') || []
    const rootChildren = roots.length ? roots.map(makeBoneNode) : bones.map(makeBoneNode)
    const projectName = String((project as any)?.skeleton?.spine || '') ? '动画工程' : '动画工程'
    return { id: 'root', kind: 'root', label: projectName, children: rootChildren.length ? rootChildren : undefined } as BoneTreeNode
  }, [project, skinName])

  const renderTreeNode = (node: BoneTreeNode, depth: number) => {
    const hasChildren = !!(node.children && node.children.length)
    const expanded = !!treeExpanded[node.id]
    const selected = treeSelectedId === node.id
    const iconClass = node.kind === 'root'
      ? 'fas fa-sitemap'
      : node.kind === 'bone'
        ? 'fas fa-bone'
        : node.kind === 'slot'
          ? 'fas fa-layer-group'
          : 'fas fa-image'
    const iconColor = node.kind === 'bone'
      ? 'rgba(255,255,255,0.86)'
      : node.kind === 'slot'
        ? 'rgba(203,213,225,0.92)'
        : node.kind === 'image'
          ? 'rgba(147,197,253,0.95)'
          : 'rgba(255,255,255,0.78)'
    return (
      <div key={node.id}>
        <div
          onClick={() => setTreeSelectedId(node.id)}
          style={{
            height: 26,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 8 + depth * 14,
            paddingRight: 8,
            borderRadius: 8,
            background: selected ? 'rgba(30,166,114,0.18)' : 'transparent',
            border: selected ? '1px solid rgba(30,166,114,0.30)' : '1px solid transparent',
            color: 'rgba(255,255,255,0.88)',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!hasChildren) return
              setTreeExpanded((cur) => ({ ...cur, [node.id]: !expanded }))
            }}
            style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hasChildren ? 0.9 : 0.25 }}
          >
            <i className="fas fa-chevron-right" style={{ fontSize: 10, transform: hasChildren && expanded ? 'rotate(90deg)' : 'none' }} />
          </div>
          <i className={iconClass} style={{ fontSize: 12, color: iconColor, width: 14, textAlign: 'center' }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {node.label}
          </div>
        </div>
        {hasChildren && expanded && (
          <div style={{ display: 'grid', gap: 2, marginTop: 2 }}>
            {node.children!.map((c) => renderTreeNode(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const tileCss = useMemo(() => {
    const tile = 18
    const clamp01 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
    const hexToRgb = (hex: string) => {
      const s = String(hex || '').replace('#', '').trim()
      const v = s.length === 3
        ? s.split('').map((c) => c + c).join('')
        : s
      const n = parseInt(v || '000000', 16)
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    }
    const rgbToHex = (r: number, g: number, b: number) => {
      const to2 = (n: number) => clamp01(n).toString(16).padStart(2, '0')
      return `#${to2(r)}${to2(g)}${to2(b)}`
    }
    const applyBrightness = (hex: string, k: number) => {
      const { r, g, b } = hexToRgb(hex)
      const kk = Math.max(0.2, Math.min(3, Number(k) || 1))
      return rgbToHex(r * kk, g * kk, b * kk)
    }
    const c0 = applyBrightness('#666666', bgBrightness)
    const c1 = applyBrightness('#6d6d6d', bgBrightness)
    const posX = `calc(50% + ${Math.round(camera.panX)}px)`
    const posY = `calc(50% + ${Math.round(camera.panY)}px)`
    return {
      backgroundColor: c0,
      backgroundImage: `conic-gradient(from 90deg, ${c0} 0 25%, ${c1} 0 50%, ${c0} 0 75%, ${c1} 0 100%)`,
      backgroundSize: `${tile * 2}px ${tile * 2}px`,
      backgroundPosition: `${posX} ${posY}`
    } as const
  }, [bgBrightness, camera.panX, camera.panY])

  const dur = Math.max(0.01, Number(durationSec) || 0.01)
  const selectedPreviewBoneName = treeSelectedId.startsWith('bone:')
    ? treeSelectedId.slice(5)
    : ''
  const splitStage = useMemo(() => {
    const part = splitPreview.parts.find((p) => p.originalWidth && p.originalHeight)
    return {
      width: Math.max(1, Number(part?.originalWidth || 1024)),
      height: Math.max(1, Number(part?.originalHeight || 1024))
    }
  }, [splitPreview.parts])
  const visibleSplitParts = useMemo(() => {
    const list = splitPreview.parts.filter((part) => part.visible !== false)
    if (splitPreview.viewMode === 'single') {
      const hit = list.find((part) => part.id === splitPreview.activePartId)
      return hit ? [hit] : list.slice(0, 1)
    }
    return list.sort((a, b) => a.layer - b.layer)
  }, [splitPreview.parts, splitPreview.activePartId, splitPreview.viewMode])

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: RIGHT_PANEL_W, background: '#0f1319', borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' }} data-preview-ui="1">
        <div style={{ padding: 12, overflow: 'auto', display: 'grid', gap: 10 }}>
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.86)', marginBottom: 8 }}>骨骼树</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, background: 'rgba(0,0,0,0.10)', padding: 6, maxHeight: 240, overflow: 'auto' }}>
              <div style={{ display: 'grid', gap: 2 }}>
                {renderTreeNode(boneTree, 0)}
              </div>
            </div>
          </div>

          {splitPreview.parts.length > 0 && (
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.86)' }}>拆图结果</div>
                <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.85)' }}>{splitPreview.viewMode}</div>
              </div>
              <div style={{ display: 'grid', gap: 4, maxHeight: 180, overflow: 'auto' }}>
                {splitPreview.parts.map((part) => {
                  const active = splitPreview.activePartId === part.id
                  return (
                    <button
                      key={part.id}
                      type="button"
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onClick={() => setSplitPreview((prev) => ({ ...prev, activePartId: part.id, viewMode: 'single' }))}
                      style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 8, background: active ? 'rgba(30,166,114,0.18)' : 'rgba(255,255,255,0.05)', border: active ? '1px solid rgba(30,166,114,0.34)' : '1px solid rgba(255,255,255,0.10)', color: '#fff', cursor: 'pointer', padding: '0 8px', fontSize: 11, fontWeight: 800 }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{part.name}</span>
                      <span style={{ color: 'rgba(148,163,184,0.85)', fontSize: 10 }}>L{part.layer}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div ref={animationListRef} style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.86)', marginBottom: 2 }}>动画</div>
            {animNames.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(148,163,184,0.95)' }}>暂无动画</div>
            ) : (
              animNames.map((n) => {
                const active = (animationName || animNames[0] || '') === n
                return (
                  <button
                    key={n}
                    type="button"
                    data-novaflow-spine-animation-button="1"
                    data-novaflow-spine-animation-name={n}
                    data-novaflow-spine-animation-active={active ? '1' : '0'}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); paintAnimationButtonSelection(n) }}
                    onClick={() => selectAnimation(n)}
                    style={{ height: 32, borderRadius: 8, background: active ? 'rgba(30,166,114,0.18)' : 'rgba(255,255,255,0.06)', border: active ? '1px solid rgba(30,166,114,0.38)' : '1px solid rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12, textAlign: 'left', padding: '0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {n}
                  </button>
                )
              })
            )}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.86)', marginBottom: 8 }}>皮肤</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {skinNames.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(148,163,184,0.95)' }}>暂无皮肤</div>
              ) : (
                skinNames.map((n) => {
                  const active = (skinName || skinNames[0] || '') === n
                  return (
                    <button
                      key={n}
                      type="button"
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onClick={() => {
                        previewRuntimeRef.current?.setSkin(n)
                        setSkinName(n)
                      }}
                      style={{ height: 32, borderRadius: 8, background: active ? 'rgba(30,166,114,0.18)' : 'rgba(255,255,255,0.06)', border: active ? '1px solid rgba(30,166,114,0.38)' : '1px solid rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12, textAlign: 'left', padding: '0 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {n}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.86)' }}>粒子挂点</div>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={() => window.alert('即将推出')}
                style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', cursor: 'pointer' }}
                title="新增挂点"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
              onClick={() => window.alert('即将推出')}
              style={{ width: '100%', height: 34, borderRadius: 8, background: '#24282e', border: '1px solid transparent', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}
            >
              置入当前粒子画板
            </button>
            <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(148,163,184,0.95)' }}>暂无挂点</div>
          </div>
        </div>
      </div>

      <div
        ref={stageRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={beginCameraDrag}
        onPointerMove={moveCameraDrag}
        onPointerUp={endCameraDrag}
        onPointerCancel={endCameraDrag}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: RIGHT_PANEL_W, overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', inset: 0, ...tileCss }} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
          <div
            style={{
              position: 'absolute',
              left: `calc(50% + ${Math.round(camera.panX)}px)`,
              top: `calc(50% + ${Math.round(camera.panY)}px)`,
              width: 2,
              height: 14,
              transform: 'translate(-1px, -7px)',
              background: 'rgba(0,0,0,0.45)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `calc(50% + ${Math.round(camera.panX)}px)`,
              top: `calc(50% + ${Math.round(camera.panY)}px)`,
              width: 14,
              height: 2,
              transform: 'translate(-7px, -1px)',
              background: 'rgba(0,0,0,0.45)'
            }}
          />
        </div>

        <PreviewZoomBar containerRef={zoomUiRef as any} zoom={camera.zoom} onAutoFit={fitCamera} />
        <div
          data-preview-ui="1"
          style={{
            position: 'absolute',
            right: 16,
            top: 72,
            zIndex: 46,
            width: Math.max(140, zoomUiW || 0),
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <input
            type="range"
            min={0.3}
            max={2.2}
            step={0.01}
            value={bgBrightness}
            onChange={(e) => setBgBrightness(+((e.target as HTMLInputElement).value || 1))}
            style={{
              width: Math.max(120, Math.round(Math.max(140, zoomUiW || 0) * 0.8)),
              accentColor: '#e5e7eb',
              cursor: 'pointer',
              opacity: 0.75
            }}
          />
        </div>

        {!templateOpen && (
          <div data-preview-ui="1" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 46 }}>
            <button className="nf-template-fab" onClick={() => setTemplateOpen(true)} style={{ height: 36, minWidth: 110, padding: '0 16px', background: 'rgba(15, 19, 25, 0.96)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 13, letterSpacing: 0 }}>
              模板库
            </button>
          </div>
        )}
        {templateOpen && (
          <div data-preview-ui="1" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 45 }}>
            <div style={{ position: 'relative', width: 860, maxWidth: 'calc(100vw - 64px)', background: 'rgba(15, 19, 25, 0.96)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 12, backdropFilter: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ height: 30, display: 'flex', alignItems: 'center', fontWeight: 900, fontSize: 14, color: 'rgba(255,255,255,0.92)' }}>
                  动画模板库
                </div>
                <button onClick={() => setTemplateOpen(false)} style={{ height: 30, minWidth: 86, padding: '0 12px', background: '#24282e', border: '1px solid transparent', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: 12 }}>关闭</button>
              </div>
              <div style={{ maxHeight: 5 * 150, overflowY: 'auto', paddingRight: 4 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
                  {(['idle', 'walk', 'run', 'attack', 'skill', 'hurt', 'death'] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => window.alert('即将推出')}
                      style={{ background: '#0b0d10', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 8, cursor: 'pointer', textAlign: 'left' }}
                    >
                      <div style={{ width: '100%', aspectRatio: '16 / 10', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px dashed rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.32)', fontSize: 12, fontWeight: 900 }}>
                        缩略图
                      </div>
                      <div style={{ marginTop: 6, color: '#cfcfcf', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ position: 'absolute', left: '50%', top: '50%', width: Math.max(1, Math.round(viewportW)), height: Math.max(1, Math.round(viewportH)), transform: `translate(-50%, -50%) translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})`, transformOrigin: 'center center' }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <SpinePreview
              ref={previewRuntimeRef}
              project={project}
              source={source}
              animationName={previewAnimationName || animationName || (animNames[0] || '')}
              skinName={skinName || null}
              playing={playing}
              renderScale={camera.zoom}
              selectedBoneName={selectedPreviewBoneName || null}
              selectedBoneNames={selectedPreviewBoneName ? [selectedPreviewBoneName] : []}
              showBoneOverlay={!!selectedPreviewBoneName}
              showHud={true}
            />
            {!!splitPreview.sourceImage && (
              <div data-preview-ui="1" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'relative', width: 'min(100%, 1024px)', maxHeight: '100%', aspectRatio: `${splitStage.width} / ${splitStage.height}` }}>
                  {splitPreview.viewMode === 'source' ? (
                    <img src={splitPreview.sourceImage} alt="source" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    visibleSplitParts.map((part) => {
                      const src = splitPreview.viewMode === 'mask' ? part.maskDataUrl : part.dataUrl
                      if (!src) return null
                      return (
                        <img
                          key={`${splitPreview.viewMode}-${part.id}`}
                          src={src}
                          alt={part.name}
                          style={{
                            position: 'absolute',
                            left: `${(part.x / splitStage.width) * 100}%`,
                            top: `${(part.y / splitStage.height) * 100}%`,
                            width: `${(part.width / splitStage.width) * 100}%`,
                            height: `${(part.height / splitStage.height) * 100}%`,
                            objectFit: 'contain'
                          }}
                        />
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div data-preview-ui="1" style={{ position: 'absolute', left: previewUiGutter, right: previewUiGutter, bottom: previewUiGutter, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: '#0f1319', padding: '10px 16px', borderRadius: 10, backdropFilter: 'none', border: '1px solid rgba(255,255,255,0.10)' }}>
            <SimpleTimelineTransport
              playing={playing}
              timeSec={timeSec}
              durationSec={dur}
              markerTimes={ribbonEventTimes}
              activeMarkerTimeSec={activeRibbonEventTimeSec}
              activeMarkerLabel={activeRibbonEventLabel}
              onTogglePlaying={() => {
                setPlaying((prev) => {
                  const next = !prev
                  previewRuntimeRef.current?.setPlaying(next)
                  if (!next) syncTimeFromRuntime()
                  return next
                })
              }}
              onTimeChange={(t) => {
                seekPreview(t)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

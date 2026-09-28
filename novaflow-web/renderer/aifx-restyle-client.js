(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxRestyleClient = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // Transport for AI 特效: talks to the MiniMax H3 runtime on 8189 directly.
  //
  // AI 序列 goes through the React app's fetch, which the brand runtime
  // intercepts and patches. AI 特效 has no reason to ride that path - it owns
  // its own graph - so it uploads, submits and polls here, and only borrows the
  // shared lifecycle bridge so the two features cannot fight over the runtime.

  const BASE_URL = 'http://127.0.0.1:8189'
  const POLL_INTERVAL_MS = 1200
  const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000
  // Measured on generated H3 output: the model leaves a faint haze around an
  // element that a hard threshold either keeps as a grey halo or eats along
  // with the glow. A smoothstep between these two lifts the haze and keeps the
  // soft edge.
  const ALPHA_FLOOR = 0.035
  const ALPHA_KNEE = 0.16

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  function electronApi() {
    const api = typeof window === 'object' ? window.electronAPI : null
    return api && typeof api === 'object' ? api : null
  }

  async function isRuntimeUp(timeoutMs = 4000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(BASE_URL + '/system_stats', { signal: controller.signal })
      return response.ok
    } catch (_) {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  async function ensureRuntime(options = {}) {
    if (await isRuntimeUp()) return true
    const bridge = electronApi()
    if (bridge && typeof bridge.minimaxH3RuntimeEnsureStarted === 'function') {
      await bridge.minimaxH3RuntimeEnsureStarted({ reason: options.reason || 'aifx-restyle' })
    }
    const deadline = Date.now() + (Number(options.timeoutMs) || 420000)
    while (Date.now() < deadline) {
      if (await isRuntimeUp()) return true
      await sleep(2000)
    }
    throw new Error('AI 特效：生成服务未能启动')
  }

  async function uploadFile(file, fileName) {
    if (!file) throw new TypeError('AI 特效 upload needs a file')
    const name = String(fileName || file.name || 'aifx-source')
    const form = new FormData()
    form.append('image', file, name)
    form.append('type', 'input')
    form.append('overwrite', 'true')
    form.append('subfolder', 'aifx')
    const response = await fetch(BASE_URL + '/upload/image', { method: 'POST', body: form })
    if (!response.ok) throw new Error('AI 特效：素材上传失败 (' + response.status + ')')
    const payload = await response.json()
    return payload.subfolder ? payload.subfolder + '/' + payload.name : payload.name
  }

  // SaveVideo reports its clip under `images` as well, flagged only by an
  // `animated` sibling, so the split has to be made on the filename. Feeding
  // an .mp4 to an <img> is how this first showed up.
  const VIDEO_FILE = /\.(mp4|webm|mov|m4v|gif|avi|mkv)$/i

  function collectOutputs(entry) {
    const images = []
    const videos = []
    for (const output of Object.values(entry.outputs || {})) {
      for (const key of ['images', 'video', 'videos', 'gifs']) {
        for (const item of output[key] || []) {
          (VIDEO_FILE.test(String(item.filename || '')) ? videos : images).push(item)
        }
      }
    }
    return { images, videos }
  }

  function viewUrl(item) {
    const params = new URLSearchParams({
      filename: item.filename,
      subfolder: item.subfolder || '',
      type: item.type || 'output',
    })
    return BASE_URL + '/view?' + params.toString()
  }

  function failureFrom(status) {
    for (const message of status.messages || []) {
      if (message[0] === 'execution_error') {
        const detail = message[1] || {}
        return new Error('AI 特效生成失败：' + (detail.exception_message || detail.node_type || '未知错误'))
      }
      if (message[0] === 'execution_interrupted') return new Error('AI 特效生成被中断')
    }
    return new Error('AI 特效生成失败')
  }

  async function submit(workflow, options = {}) {
    await ensureRuntime(options)
    const clientId = options.clientId || ('aifx-' + Math.random().toString(16).slice(2))
    const response = await fetch(BASE_URL + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    })
    if (!response.ok) {
      let detail = ''
      try { detail = JSON.stringify(await response.json()).slice(0, 400) } catch (_) {}
      throw new Error('AI 特效：工作流被拒绝 (' + response.status + ') ' + detail)
    }
    const { prompt_id: promptId } = await response.json()
    const deadline = Date.now() + (Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)
    while (Date.now() < deadline) {
      if (options.signal && options.signal.aborted) throw new Error('AI 特效生成已取消')
      let entry = null
      const historyResponse = await fetch(BASE_URL + '/history/' + promptId)
      if (historyResponse.ok) {
        const history = await historyResponse.json()
        entry = history[promptId]
        if (entry) {
          const status = entry.status || {}
          if (status.status_str === 'error') throw failureFrom(status)
          const outputs = collectOutputs(entry)
          if (outputs.images.length || outputs.videos.length) {
            return {
              promptId,
              frames: outputs.images.map(viewUrl),
              videos: outputs.videos.map(viewUrl),
            }
          }
          if (status.completed) throw new Error('AI 特效：生成完成但没有输出')
        }
      }
      // On the Web the history entry carries the node's reported percentage; ComfyUI's own has none.
      const progress = entry && entry.novaflow ? entry.novaflow.progress : null
      if (typeof options.onProgress === 'function') options.onProgress({ promptId, progress })
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error('AI 特效生成超时')
  }

  async function interrupt() {
    try { await fetch(BASE_URL + '/interrupt', { method: 'POST' }) } catch (_) {}
  }

  async function loadImage(src) {
    // On the Web the runtime's fetch shim is what reaches the compute node's output; an <img> src
    // never goes through it, so the bytes are fetched first and shown from a blob URL.
    let source = src
    const web = typeof window === 'object' && window.NovaFlowWebRuntime && window.NovaFlowWebRuntime.isWeb
    if (web) {
      const response = await fetch(src)
      if (!response.ok) throw new Error('AI 特效：帧读取失败 ' + src)
      source = URL.createObjectURL(await response.blob())
    }
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('AI 特效：帧读取失败 ' + src))
      image.src = source
    })
  }

  // A VFX element shot on black is already premultiplied against it, so the
  // pixel value IS the coverage. alpha = max(R,G,B) recovers the matte and
  // dividing the colour back out yields straight alpha, which is what a sprite
  // sheet or a Spine attachment expects.
  function keyFrameToRgba(image, options = {}) {
    const floor = Number.isFinite(options.floor) ? options.floor : ALPHA_FLOOR
    const knee = Number.isFinite(options.knee) ? options.knee : ALPHA_KNEE
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)
    const frame = context.getImageData(0, 0, canvas.width, canvas.height)
    const data = frame.data
    const span = Math.max(1e-6, knee - floor)
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] / 255
      const g = data[index + 1] / 255
      const b = data[index + 2] / 255
      const peak = Math.max(r, g, b)
      const ramp = Math.min(1, Math.max(0, (peak - floor) / span))
      const alpha = Math.min(1, peak * ramp * ramp * (3 - 2 * ramp))
      if (alpha <= 0.0039) {
        data[index] = 0; data[index + 1] = 0; data[index + 2] = 0; data[index + 3] = 0
        continue
      }
      data[index] = Math.min(255, Math.round((r / alpha) * 255))
      data[index + 1] = Math.min(255, Math.round((g / alpha) * 255))
      data[index + 2] = Math.min(255, Math.round((b / alpha) * 255))
      data[index + 3] = Math.round(alpha * 255)
    }
    context.putImageData(frame, 0, 0)
    return canvas
  }

  async function keyFrames(frameUrls, options = {}) {
    const canvases = []
    for (const url of frameUrls) {
      canvases.push(keyFrameToRgba(await loadImage(url), options))
    }
    return canvases
  }

  return Object.freeze({
    BASE_URL,
    ALPHA_FLOOR,
    ALPHA_KNEE,
    isRuntimeUp,
    ensureRuntime,
    uploadFile,
    submit,
    interrupt,
    loadImage,
    keyFrameToRgba,
    keyFrames,
  })
})

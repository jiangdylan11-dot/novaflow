(function () {
  const existingApi = (window && window.electronAPI) || {}
  const preloadOwnsProviderSettlement = existingApi.runtimeProviderUsageSettlement === 'preload-price-v1'
  const hasRuntimeProxy =
    typeof existingApi.runtimeGetSystemStats === 'function' &&
    typeof existingApi.runtimeRequestJson === 'function' &&
    typeof existingApi.runtimeRequestBinary === 'function' &&
    typeof existingApi.runtimeUploadImage === 'function'
  const hasLicenseApi = typeof existingApi.licenseGetState === 'function'
  const hasRuntimeShortcuts =
    typeof existingApi.runtimeOpenOutputFolder === 'function' &&
    typeof existingApi.runtimeFreeMemory === 'function'
  const hasPromptAssistant =
    typeof existingApi.promptAssistantGetStatus === 'function' &&
    typeof existingApi.promptAssistantOptimizePrompt === 'function' &&
    typeof existingApi.promptAssistantReverseImagePrompt === 'function'
  const hasArtAgent = typeof existingApi.artAgentChat === 'function' && typeof existingApi.artAgentStop === 'function'
  const hasSmartAi =
    typeof existingApi.smartAiPromptOptimize === 'function' &&
    typeof existingApi.smartAiImageReverse === 'function'
  const hasClientAuth =
    typeof existingApi.clientAuthStatus === 'function' &&
    typeof existingApi.clientAuthLogin === 'function' &&
    typeof existingApi.clientAuthBootstrap === 'function' &&
    typeof existingApi.clientAuthLogout === 'function'
  const hasAiSequenceLora =
    typeof existingApi.qwenLoraCatalog === 'function' &&
    typeof existingApi.minimaxH3LoraCatalog === 'function' &&
    typeof existingApi.minimaxH3LoraValidate === 'function'
  const hasMiniMaxH3OutputWarehouse =
    typeof existingApi.minimaxH3OutputPublish === 'function' &&
    typeof existingApi.minimaxH3OutputList === 'function'
  if (
    hasRuntimeProxy &&
    hasLicenseApi &&
    hasRuntimeShortcuts &&
    hasPromptAssistant &&
    hasArtAgent &&
    hasSmartAi &&
    hasClientAuth &&
    hasAiSequenceLora &&
    hasMiniMaxH3OutputWarehouse
  ) {
    return
  }

  const DEFAULT_BASE_URL = 'http://127.0.0.1:8188'
  const CLIENT_API_BASE_URL = 'http://127.0.0.1:4761'
  const CLIENT_AUTH_STORAGE_KEY = 'novaflow.client.auth.session.v1'
  const PROXY_PREFIX = '/__runtime_proxy'
  const PROMPT_ASSISTANT_PREFIX = '/__prompt_assistant'
  const AI_SEQUENCE_LORA_ENDPOINT = '/__ai_sequence_lora'
  const MINIMAX_H3_OUTPUT_ENDPOINT = '/__ai_sequence_h3_output'
  const PREVIEW_LICENSE_MACHINE_KEY = 'novaflow-preview-machine-id'

  const normalizeBaseUrl = (value) => {
    const raw = String(value || '').trim().replace(/\/+$/, '')
    if (!raw) return DEFAULT_BASE_URL
    return raw
  }
  const normalizePath = (value) => {
    const text = String(value || '')
    return text.startsWith('/') ? text : `/${text}`
  }
  const buildProxyUrl = (path) => `${PROXY_PREFIX}${normalizePath(path)}`
  const buildHeaders = (baseUrl, extraHeaders) => {
    const headers = new Headers(extraHeaders || {})
    headers.set('x-runtime-base', normalizeBaseUrl(baseUrl))
    return headers
  }
  const parseJsonResponse = async (res) => {
    const text = await res.text()
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) }
    } catch {
      return { ok: false, status: res.status, error: 'invalid json', raw: text }
    }
  }
  const bytesToBase64 = (bytes) => {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }
  const base64ToBlob = (base64, type) => {
    const raw = atob(String(base64 || ''))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return new Blob([bytes], { type: type || 'application/octet-stream' })
  }
  const getPreviewMachineId = () => {
    try {
      const existing = localStorage.getItem(PREVIEW_LICENSE_MACHINE_KEY)
      if (existing) return existing
      const seed = `preview-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
      localStorage.setItem(PREVIEW_LICENSE_MACHINE_KEY, seed)
      return seed
    } catch {
      return 'preview-runtime'
    }
  }
  const getPreviewLicenseState = () => ({
    ok: true,
    licensed: false,
    status: 'unlicensed',
    machineId: getPreviewMachineId(),
    preview: true,
  })
  const previewLicenseImportUnavailable = async () => ({
    ok: false,
    error: 'PREVIEW_LICENSE_IMPORT_UNAVAILABLE',
    state: getPreviewLicenseState(),
  })

  const doJsonFetch = async (baseUrl, path, init) => {
    const res = await fetch(buildProxyUrl(path), {
      ...(init || {}),
      headers: buildHeaders(baseUrl, init && init.headers),
    })
    return await parseJsonResponse(res)
  }

  const runtimeRequestJson = async (payload) => {
    const baseUrl = normalizeBaseUrl(payload && payload.baseUrl)
    const path = normalizePath(payload && payload.path)
    const init = (payload && payload.init) || { method: 'GET' }
    const first = await doJsonFetch(baseUrl, path, init)
    if (first && first.status === 404 && !path.startsWith('/api/')) {
      return await doJsonFetch(baseUrl, `/api${path}`, init)
    }
    return first
  }

  const runtimeGetSystemStats = async (payload) => {
    const baseUrl = normalizeBaseUrl(payload && payload.baseUrl)
    const init = { method: 'GET', cache: 'no-store' }
    const first = await doJsonFetch(baseUrl, '/system_stats', init)
    if (first && first.status === 404) {
      return await doJsonFetch(baseUrl, '/api/system_stats', init)
    }
    return first
  }

  const runtimeRequestBinary = async (payload) => {
    const baseUrl = normalizeBaseUrl(payload && payload.baseUrl)
    const path = normalizePath(payload && payload.path)
    const init = (payload && payload.init) || { method: 'GET' }
    const doFetch = async (targetPath) => {
      const res = await fetch(buildProxyUrl(targetPath), {
        ...(init || {}),
        headers: buildHeaders(baseUrl, init && init.headers),
      })
      const bytes = new Uint8Array(await res.arrayBuffer())
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        dataBase64: bytesToBase64(bytes),
      }
    }
    const first = await doFetch(path)
    if (first && first.status === 404 && !path.startsWith('/api/')) {
      return await doFetch(`/api${path}`)
    }
    return first
  }

  const runtimeUploadImage = async (payload) => {
    const baseUrl = normalizeBaseUrl(payload && payload.baseUrl)
    const safeName = String((payload && payload.fileName) || `upload_${Date.now()}.png`).trim() || `upload_${Date.now()}.png`
    const form = new FormData()
    form.append('image', base64ToBlob(payload && payload.dataBase64, 'image/png'), safeName)
    form.append('type', String((payload && payload.type) || 'input'))
    if (payload && payload.subfolder) form.append('subfolder', String(payload.subfolder))

    const postForm = async (path) => {
      const res = await fetch(buildProxyUrl(path), {
        method: 'POST',
        body: form,
        headers: buildHeaders(baseUrl),
      })
      return await parseJsonResponse(res)
    }

    const first = await postForm('/upload/image')
    if (first && (first.status === 404 || first.status === 403)) {
      return await postForm('/api/upload/image')
    }
    return first
  }

  const runtimeGetStatus = async () => {
    const stats = await runtimeGetSystemStats({ baseUrl: DEFAULT_BASE_URL })
    return {
      ok: !!stats?.ok,
      installed: true,
      running: !!stats?.ok,
      connected: !!stats?.ok,
      status: stats?.ok ? 'running' : 'stopped',
      name: 'Foart AI Runtime',
      version: '',
      port: 8188,
      baseUrl: DEFAULT_BASE_URL,
      health: stats?.ok ? { ok: true } : { ok: false, error: stats?.error || `preview_runtime_unavailable` },
      preview: true,
    }
  }
  const runtimeEnsureStarted = runtimeGetStatus
  const runtimeFreeMemory = async () => {
    const postFree = async (path) => {
      try {
        const res = await fetch(buildProxyUrl(path), {
          method: 'POST',
          headers: buildHeaders(DEFAULT_BASE_URL, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ unload_models: true, free_memory: true }),
          cache: 'no-store',
        })
        const text = await res.text()
        let data = null
        try { data = text ? JSON.parse(text) : null } catch { data = text || null }
        if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, data, preview: true, deletedOutput: false }
        return { ok: true, status: res.status, data, preview: true, deletedOutput: false }
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err), preview: true, deletedOutput: false }
      }
    }
    const first = await postFree('/free')
    if (first && first.status === 404) return await postFree('/api/free')
    return first
  }

  const promptAssistantRequest = async (path, payload) => {
    try {
      const res = await fetch(`${PROMPT_ASSISTANT_PREFIX}${path}`, {
        method: path === '/status' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: path === '/status' ? undefined : JSON.stringify(payload || {}),
        cache: 'no-store',
      })
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch {}
      if (data && typeof data === 'object') return data
      return { ok: false, status: res.status, error: 'invalid_prompt_assistant_response', preview: true }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), preview: true }
    }
  }
  const promptAssistantGetStatus = existingApi.promptAssistantGetStatus || (() => promptAssistantRequest('/status'))
  const promptAssistantOptimizePrompt = existingApi.promptAssistantOptimizePrompt || ((payload) => (
    promptAssistantRequest('/optimize-prompt', payload)
  ))
  const promptAssistantReverseImagePrompt = existingApi.promptAssistantReverseImagePrompt || ((payload) => (
    promptAssistantRequest('/reverse-image-prompt', payload)
  ))
  const artAgentChat = existingApi.artAgentChat || ((payload) => promptAssistantRequest('/art-agent-chat', payload))
  const artAgentStop = existingApi.artAgentStop || ((payload) => promptAssistantRequest('/art-agent-stop', payload))
  const aiSequenceLoraRequest = async (action, payload) => {
    try {
      const res = await fetch(AI_SEQUENCE_LORA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          payload: payload && typeof payload === 'object' ? payload : {},
        }),
        cache: 'no-store',
      })
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch {}
      if (data && typeof data === 'object') return data
      return { ok: false, status: res.status, error: 'invalid_ai_sequence_lora_response', preview: true }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), preview: true }
    }
  }
  const qwenLoraCatalog = existingApi.qwenLoraCatalog || ((payload) => aiSequenceLoraRequest('qwen-catalog', payload))
  const minimaxH3LoraCatalog = existingApi.minimaxH3LoraCatalog || ((payload) => (
    aiSequenceLoraRequest('minimax-h3-catalog', payload)
  ))
  const minimaxH3LoraValidate = existingApi.minimaxH3LoraValidate || ((payload) => (
    aiSequenceLoraRequest('minimax-h3-validate', payload)
  ))
  const minimaxH3OutputRequest = async (action, payload) => {
    try {
      const res = await fetch(MINIMAX_H3_OUTPUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          payload: payload && typeof payload === 'object' ? payload : {},
        }),
        cache: 'no-store',
      })
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch {}
      if (data && typeof data === 'object') return data
      return { ok: false, status: res.status, error: 'invalid_minimax_h3_output_response', preview: true }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), preview: true }
    }
  }
  const minimaxH3OutputPublish = existingApi.minimaxH3OutputPublish || ((payload) => (
    minimaxH3OutputRequest('publish', payload)
  ))
  const minimaxH3OutputList = existingApi.minimaxH3OutputList || (() => (
    minimaxH3OutputRequest('list', { runtimeKind: 'minimax_h3_local' })
  ))
  const clientApiRequest = async (path, payload, options = {}) => {
    const body = { ...((payload && typeof payload === 'object') ? payload : {}) }
    const token = String(body.token || body.sessionToken || body.accessToken || '').trim()
    delete body.token
    delete body.sessionToken
    delete body.accessToken
    try {
      const method = String(options.method || 'POST').toUpperCase()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${CLIENT_API_BASE_URL}${path}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch {}
      if (data && typeof data === 'object') return { ...data, httpStatus: res.status }
      return { ok: false, status: res.status, error: 'invalid_client_api_response', preview: true }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), preview: true }
    }
  }
  const smartAiPromptOptimize = existingApi.smartAiPromptOptimize || ((payload) => (
    clientApiRequest('/api/client/grok/prompt-optimize', payload)
  ))
  const smartAiImageReverse = existingApi.smartAiImageReverse || ((payload) => (
    clientApiRequest('/api/client/grok/image-reverse', {
      ...((payload && typeof payload === 'object') ? payload : {}),
      token: (() => {
        try {
          const raw = localStorage.getItem(CLIENT_AUTH_STORAGE_KEY)
          const stored = raw ? JSON.parse(raw) : null
          return String(stored?.session?.token || '').trim()
        } catch {
          return ''
        }
      })()
    })
  ))
  const clientAuthAiTaskAuthorize = existingApi.clientAuthAiTaskAuthorize || ((payload) => (
    clientApiRequest('/api/ai/tasks', payload)
  ))
  const clientAuthAiTaskCommitUsage = preloadOwnsProviderSettlement
    ? null
    : (existingApi.clientAuthAiTaskCommitUsage || ((payload) => (
      clientApiRequest('/api/ai/tasks/usage', payload)
    )))
  const clientAuthStatus = existingApi.clientAuthStatus || (async () => ({
    ...(await clientApiRequest('/health', null, { method: 'GET' })),
    baseUrl: CLIENT_API_BASE_URL,
  }))
  const clientAuthLogin = existingApi.clientAuthLogin || ((payload) => (
    clientApiRequest('/api/auth/login', payload)
  ))
  const clientAuthBootstrap = existingApi.clientAuthBootstrap || ((payload) => (
    clientApiRequest('/api/client/bootstrap', payload, { method: 'GET' })
  ))
  const clientAuthLogout = existingApi.clientAuthLogout || ((payload) => (
    clientApiRequest('/api/auth/logout', payload)
  ))

  window.electronAPI = {
    ...existingApi,
    runtimeGetStatus,
    runtimeEnsureStarted,
    runtimeRestart: async () => ({ ok: false, error: 'preview_runtime_restart_unavailable', preview: true }),
    runtimeStop: async () => ({ ok: false, error: 'preview_runtime_stop_unavailable', preview: true }),
    runtimeGetSystemStats,
    runtimeFreeMemory,
    runtimeRequestJson,
    runtimeRequestBinary,
    runtimeUploadImage,
    runtimeOpenAssetsFolder: async () => ({ ok: false, error: 'preview_runtime_open_assets_unavailable', preview: true }),
    runtimeOpenOutputFolder: async () => ({ ok: false, error: 'preview_runtime_open_output_unavailable', preview: true }),
    runtimeOpenLogsFolder: async () => ({ ok: false, error: 'preview_runtime_open_logs_unavailable', preview: true }),
    runtimeOpenInstallFolder: async () => ({ ok: false, error: 'preview_runtime_open_install_unavailable', preview: true }),
    licenseGetState: existingApi.licenseGetState || (async () => getPreviewLicenseState()),
    licenseGetMachineId: existingApi.licenseGetMachineId || (async () => ({ ok: true, machineId: getPreviewMachineId() })),
    licenseImportFile: existingApi.licenseImportFile || previewLicenseImportUnavailable,
    licenseImportText: existingApi.licenseImportText || previewLicenseImportUnavailable,
    licenseRemove: existingApi.licenseRemove || (async () => ({ ok: true, state: getPreviewLicenseState() })),
    licenseOpenMain: existingApi.licenseOpenMain || (async () => ({ ok: false, error: 'preview_license_open_main_unavailable', state: getPreviewLicenseState() })),
    clientAuthStatus,
    clientAuthLogin,
    clientAuthBootstrap,
    clientAuthLogout,
    clientAuthAiTaskAuthorize,
    ...(typeof clientAuthAiTaskCommitUsage === 'function' ? { clientAuthAiTaskCommitUsage } : {}),
    promptAssistantGetStatus,
    promptAssistantOptimizePrompt,
    promptAssistantReverseImagePrompt,
    artAgentChat,
    artAgentStop,
    qwenLoraCatalog,
    minimaxH3LoraCatalog,
    minimaxH3LoraValidate,
    minimaxH3OutputPublish,
    minimaxH3OutputList,
    smartAiPromptOptimize,
    smartAiImageReverse,
  }
})()

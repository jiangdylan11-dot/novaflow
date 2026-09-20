(function () {
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null
  if (!nativeFetch) return

  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])
  const LOOPBACK_PORTS = new Set(['8188', '8000'])
  const PROXY_PREFIX = '/__runtime_proxy'
  const JSON_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  const LEGACY_AIFX_BLOCK_RESPONSE = JSON.stringify({
    ok: false,
    blocked: true,
    reason: 'legacy_aifx_runtime_prompt_disabled',
  })
  const COMFYUI_PROVIDER_KEY = 'comfyui'
  const COMFYUI_USAGE_BASE_HOSTS = new Set(['cloud.comfy.org'])
  const workflowCreditCostApi = window.NovaFlowComfyWorkflowCreditCost
  const PROVIDER_WORKFLOW_NODE_TYPE_FALLBACK = Object.freeze([
    'KlingVideoNode',
    'KlingFirstLastFrameNode',
    'KlingOmniProImageToVideoNode',
    'ByteDance2ReferenceNode',
    'ByteDance2FirstLastFrameNode',
    'OpenAIGPTImage1',
    'OpenAIGPTImageNodeV2',
    'GeminiImageNode',
    'GeminiImage2Node',
  ])
  const IMAGE_PROVIDER_WORKFLOW_NODE_TYPES = new Set([
    'OpenAIGPTImage1',
    'OpenAIGPTImageNodeV2',
    'GeminiImageNode',
    'GeminiImage2Node',
  ])
  const PROVIDER_WORKFLOW_NODE_TYPES = Array.isArray(workflowCreditCostApi?.SUPPORTED_NODE_TYPES)
    ? workflowCreditCostApi.SUPPORTED_NODE_TYPES
    : PROVIDER_WORKFLOW_NODE_TYPE_FALLBACK
  const PROVIDER_PROMPT_STORAGE_PREFIX = 'novaflow.localWorkflow.providerPrompt.'
  const PROVIDER_PROMPT_CONTEXT_TTL_MS = 45 * 60 * 1000
  const providerUsageCommitsInFlight = new Set()
  const providerPromptAuthorizationContexts = new Map()
  const providerPromptAuthorizationContextTimers = new Map()

  const isDesktopFileRuntime = () => {
    try {
      const api = window.electronAPI
      return window.location.protocol === 'file:' &&
        !!api &&
        typeof api.runtimeRequestJson === 'function' &&
        typeof api.runtimeRequestBinary === 'function'
    } catch {
      return false
    }
  }

  const getUrl = (input) => {
    try {
      return typeof input === 'string' || input instanceof URL
        ? new URL(String(input), window.location.href)
        : new URL(String(input && input.url), window.location.href)
    } catch {
      return null
    }
  }

  const shouldProxy = (input) => {
    const url = getUrl(input)
    try {
      return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && LOOPBACK_PORTS.has(String(url.port || '80'))
    } catch {
      return false
    }
  }

  const isComfyUiUsageBaseUrl = (baseUrl) => {
    try {
      const url = new URL(String(baseUrl || ''), window.location.href)
      const host = String(url.hostname || '').toLowerCase()
      if (!host || LOOPBACK_HOSTS.has(host)) return false
      return COMFYUI_USAGE_BASE_HOSTS.has(host)
    } catch {
      return false
    }
  }

  const getMethod = (input, init) => String(
    (init && init.method) ||
    (input instanceof Request ? input.method : 'GET') ||
    'GET'
  ).toUpperCase()

  const getRequestHeaders = (input, init) => new Headers(
    init && init.headers
      ? init.headers
      : input instanceof Request
        ? input.headers
        : undefined
  )

  const headersToObject = (headers) => {
    const out = {}
    try {
      headers.forEach((value, key) => {
        out[key] = value
      })
    } catch {}
    return out
  }

  const runtimePathname = (url) => {
    const pathname = String(url && url.pathname)
    return pathname.startsWith(PROXY_PREFIX)
      ? pathname.slice(PROXY_PREFIX.length) || '/'
      : pathname
  }

  const isPromptPath = (url) => {
    const promptPath = runtimePathname(url)
    return /\/(?:api\/)?prompt\/?$/i.test(promptPath)
  }

  const isHistoryPath = (url) => /\/(?:api\/)?history\//i.test(runtimePathname(url))

  const getHistoryPromptId = (url) => {
    const match = runtimePathname(url).match(/\/(?:api\/)?history\/([^/?#]+)/i)
    try {
      return match ? decodeURIComponent(match[1]) : ''
    } catch {
      return match ? String(match[1] || '') : ''
    }
  }

  const readBodyText = async (input, init) => {
    try {
      const body = init && Object.prototype.hasOwnProperty.call(init, 'body')
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : ''
      if (typeof body === 'string') return body
      if (body instanceof URLSearchParams) return body.toString()
      if (body instanceof Blob) return body.text()
      if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
      if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
    } catch {
      return ''
    }
    return ''
  }

  const parseWorkflowJson = (bodyText) => {
    try {
      return JSON.parse(String(bodyText || ''))
    } catch {
      return null
    }
  }

  const detectProviderWorkflow = (bodyText, baseUrl) => {
    const text = String(bodyText || '')
    if (!text) return null
    const workflow = parseWorkflowJson(text)
    if (workflow && typeof workflowCreditCostApi?.estimateWorkflowCreditCost === 'function') {
      const pricing = workflowCreditCostApi.estimateWorkflowCreditCost(workflow, {
        allowCloudPrompt: isComfyUiUsageBaseUrl(baseUrl),
      })
      if (pricing) return pricing
    }
    for (const nodeType of PROVIDER_WORKFLOW_NODE_TYPES) {
      if (!text.includes(nodeType)) continue
      const nodes = workflow && typeof workflow === 'object' && workflow.prompt && typeof workflow.prompt === 'object'
        ? workflow.prompt
        : workflow
      const matchedNode = nodes && typeof nodes === 'object'
        ? Object.values(nodes).find((node) => String(node?.class_type || node?.classType || node?.type || '') === nodeType)
        : null
      const selectedModel = String(matchedNode?.inputs?.model || '').trim().toLowerCase()
      return {
        providerKey: COMFYUI_PROVIDER_KEY,
        modelKey: selectedModel || nodeType.toLowerCase(),
        taskType: IMAGE_PROVIDER_WORKFLOW_NODE_TYPES.has(nodeType) ? 'local_workflow_image' : 'local_workflow_video',
        workflowNodeType: nodeType,
        known: false,
        estimatedCreditCost: 0,
        creditCost: 0,
        pricingStatus: 'pending_pricing',
        pricingSource: 'unknown',
      }
    }
    return null
  }

  // The rebuilt AI 特效 chain restyles from a source latent, which the retired
  // pipeline had no node for. That one node tells the two apart, so the guard
  // can keep blocking the old chain without also blocking the new one - which
  // shares the NovaFlow_AIFX output prefix the pattern below matches.
  const REBUILT_AIFX_MARKER = 'NovaFlowH3VideoToVideoLatent'

  const shouldBlockLegacyAifxPrompt = async (input, init) => {
    const url = getUrl(input)
    if (!url || !isPromptPath(url) || getMethod(input, init) !== 'POST') return false
    const body = await readBodyText(input, init)
    if (!/novaflow[-_]aifx/i.test(body)) return false
    return !body.includes(REBUILT_AIFX_MARKER)
  }

  const toProxyRequest = (input, init) => {
    const original = typeof input === 'string' || input instanceof URL ? String(input) : String(input && input.url)
    const source = new URL(original, window.location.href)
    const proxyUrl = `${PROXY_PREFIX}${source.pathname}${source.search}`
    const headers = getRequestHeaders(input, init)
    headers.set('x-runtime-base', source.origin)

    const nextInit = {
      ...(init || {}),
      headers,
    }

    if (input instanceof Request && !init) {
      return [new Request(proxyUrl, {
        method: input.method,
        headers,
        body: input.body,
        mode: 'same-origin',
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal,
      })]
    }

    return [proxyUrl, nextInit]
  }

  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload ?? null), {
    status,
    headers: JSON_HEADERS,
  })

  const providerPromptStorageKey = (promptId) => `${PROVIDER_PROMPT_STORAGE_PREFIX}${String(promptId || '').trim()}`

  const readProviderPromptMeta = (promptId) => {
    try {
      const id = String(promptId || '').trim()
      const raw = sessionStorage.getItem(providerPromptStorageKey(id))
      const stored = raw ? JSON.parse(raw) : null
      return stored ? { ...stored, authorizationContext: providerPromptAuthorizationContexts.get(id) || null } : null
    } catch {
      return null
    }
  }

  const rememberProviderPrompt = (promptId, workflow) => {
    const id = String(promptId || '').trim()
    if (!id || !workflow) return
    const authorizationContext = workflow.authorizationContext
    if (authorizationContext && typeof authorizationContext.commitAiTaskUsage === 'function') {
      providerPromptAuthorizationContexts.set(id, authorizationContext)
      const timer = window.setTimeout(() => forgetProviderPrompt(id), PROVIDER_PROMPT_CONTEXT_TTL_MS)
      providerPromptAuthorizationContextTimers.set(id, timer)
    }
    try {
      const serializable = { ...workflow }
      delete serializable.authorizationContext
      sessionStorage.setItem(providerPromptStorageKey(id), JSON.stringify({
        ...serializable,
        promptId: id,
        authorizedAt: Date.now(),
      }))
    } catch {}
  }

  const forgetProviderPrompt = (promptId) => {
    const id = String(promptId || '').trim()
    const authorizationContext = providerPromptAuthorizationContexts.get(id)
    const timer = providerPromptAuthorizationContextTimers.get(id)
    if (timer) window.clearTimeout(timer)
    providerPromptAuthorizationContextTimers.delete(id)
    providerPromptAuthorizationContexts.delete(id)
    authorizationContext?.release?.()
    try {
      sessionStorage.removeItem(providerPromptStorageKey(id))
    } catch {}
  }

  const clientAuthApi = () => {
    try {
      return window.NovaFlowClientAuth && typeof window.NovaFlowClientAuth === 'object'
        ? window.NovaFlowClientAuth
        : null
    } catch {
      return null
    }
  }

  const providerErrorResponse = (result, workflow, fallback) => {
    const status = Number(result && (result.httpStatus || result.statusCode || result.status)) || 403
    return jsonResponse({
      ok: false,
      blocked: true,
      provider: workflow && workflow.providerKey,
      mode: 'local_workflow_authorize',
      error: String(result?.error || fallback || 'local workflow authorization failed'),
      result: result || null,
    }, status >= 400 && status < 600 ? status : 403)
  }

  const providerErrorResult = (result, workflow, fallback) => {
    const status = Number(result && (result.httpStatus || result.statusCode || result.status)) || 403
    return {
      ok: false,
      blocked: true,
      status: status >= 400 && status < 600 ? status : 403,
      provider: workflow && workflow.providerKey,
      mode: 'local_workflow_authorize',
      error: String(result?.error || fallback || 'local workflow authorization failed'),
      result: result || null,
    }
  }

  const authorizeProviderWorkflowBody = async (bodyText, baseUrl) => {
    const workflow = detectProviderWorkflow(bodyText, baseUrl)
    if (!workflow) return null
    const auth = clientAuthApi()
    if (!auth || typeof auth.createAuthorizationContext !== 'function') {
      return {
        blocked: true,
        workflow,
        error: providerErrorResult(null, workflow, 'client auth is not ready for local workflow authorization'),
      }
    }
    const authorizationContext = auth.createAuthorizationContext()
    if (!authorizationContext || typeof authorizationContext.authorizeAiTask !== 'function') {
      return {
        blocked: true,
        workflow,
        error: providerErrorResult(null, workflow, 'client auth session is unavailable'),
      }
    }
    const result = await authorizationContext.authorizeAiTask({
      providerKey: workflow.providerKey,
      provider: workflow.providerKey,
      modelKey: workflow.modelKey,
      taskType: workflow.taskType,
      estimatedCreditCost: workflow.estimatedCreditCost || 0,
      creditCost: workflow.creditCost || 0,
      parameters: {
        runtime: 'comfyui',
        workflowNodeType: workflow.workflowNodeType,
        estimatedCreditCost: workflow.estimatedCreditCost || 0,
        creditCost: workflow.creditCost || 0,
        pricingStatus: workflow.pricingStatus || 'pending_pricing',
        pricingSource: workflow.pricingSource || 'unknown',
        source: 'runtime-fetch-proxy',
      },
    })
    if (!result || result.ok === false) {
      authorizationContext.release?.()
      return {
        blocked: true,
        workflow,
        error: providerErrorResult(result, workflow),
      }
    }
    return { ...workflow, authorizationContext }
  }

  const authorizeProviderWorkflowPrompt = async (input, init) => {
    const url = getUrl(input)
    if (!url || !isPromptPath(url) || getMethod(input, init) !== 'POST') return null
    const bodyText = await readBodyText(input, init)
    const workflow = await authorizeProviderWorkflowBody(bodyText, url.origin)
    if (workflow && workflow.blocked) {
      return {
        blocked: true,
        response: providerErrorResponse(workflow.error, workflow.workflow),
      }
    }
    return workflow
  }

  const parseResponseJson = async (response) => {
    try {
      return await response.clone().json()
    } catch {
      return null
    }
  }

  const isMediaOutputName = (value) => /\.(mp4|webm|mov|m4v|avi|gif|png|jpe?g|webp)$/i.test(String(value || '').trim())

  const historyHasMediaOutput = (value) => {
    const seen = new WeakSet()
    const visit = (item) => {
      if (!item) return false
      if (typeof item === 'string') return isMediaOutputName(item)
      if (typeof item !== 'object') return false
      if (seen.has(item)) return false
      seen.add(item)
      const name = item.filename || item.file_name || item.fileName || item.name || item.path || item.fullpath
      if (name && isMediaOutputName(name)) return true
      if (Array.isArray(item)) return item.some(visit)
      return Object.values(item).some(visit)
    }
    return visit(value)
  }

  const historyHasCompletedOutput = (data, promptId) => {
    if (!data || typeof data !== 'object') return false
    const entry = data[promptId] && typeof data[promptId] === 'object' ? data[promptId] : data
    if (!entry || typeof entry !== 'object') return false
    return historyHasMediaOutput(entry.outputs && typeof entry.outputs === 'object' ? entry.outputs : entry)
  }

  const historyHasTerminalFailure = (data, promptId) => {
    if (!data || typeof data !== 'object') return false
    const entry = data[promptId] && typeof data[promptId] === 'object' ? data[promptId] : data
    const status = String(entry?.status?.status_str || entry?.status?.status || entry?.status_str || '').toLowerCase()
    return /(?:error|failed|cancelled|canceled)/.test(status)
  }

  const commitProviderWorkflowUsage = async (promptId, data) => {
    const id = String(promptId || '').trim()
    if (!id || providerUsageCommitsInFlight.has(id)) return
    if (!historyHasCompletedOutput(data, id)) {
      if (historyHasTerminalFailure(data, id)) forgetProviderPrompt(id)
      return
    }
    const meta = readProviderPromptMeta(id)
    if (!meta || !meta.providerKey) return
    const authorizationContext = meta.authorizationContext
    if (!authorizationContext || typeof authorizationContext.commitAiTaskUsage !== 'function') return
    providerUsageCommitsInFlight.add(id)
    try {
      const result = await authorizationContext.commitAiTaskUsage({
        providerKey: meta.providerKey,
        provider: meta.providerKey,
        modelKey: meta.modelKey,
        taskType: meta.taskType || 'local_workflow_video',
        promptId: id,
        usageKey: `comfyui:${id}`,
        estimatedCreditCost: meta.estimatedCreditCost || 0,
        creditCost: meta.creditCost || 0,
        parameters: {
          runtime: 'comfyui',
          workflowNodeType: meta.workflowNodeType || '',
          estimatedCreditCost: meta.estimatedCreditCost || 0,
          creditCost: meta.creditCost || 0,
          pricingStatus: meta.pricingStatus || 'pending_pricing',
          pricingSource: meta.pricingSource || 'unknown',
          source: 'runtime-fetch-proxy-history',
        },
      })
      if (result && result.ok !== false) forgetProviderPrompt(id)
    } catch {
      void 0
    } finally {
      providerUsageCommitsInFlight.delete(id)
    }
  }

  const runtimePayloadUrl = (payload) => {
    try {
      const baseUrl = String(payload && payload.baseUrl || window.location.origin || '')
      const path = String(payload && payload.path || '/')
      return new URL(path.startsWith('/') ? path : `/${path}`, `${baseUrl.replace(/\/$/, '')}/`)
    } catch {
      return null
    }
  }

  const runtimeResultData = (result) => (
    result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
      ? result.data
      : result
  )

  function wrapRuntimeRequestJsonForProviderUsage() {
    if (window.location.protocol === 'file:') return
    const api = window.electronAPI
    if (!api || typeof api.runtimeRequestJson !== 'function') return
    if (api.runtimeRequestJson.__novaflowProviderUsageWrapped) return
    const originalRuntimeRequestJson = api.runtimeRequestJson.bind(api)
    const wrappedRuntimeRequestJson = async (payload) => {
      const url = runtimePayloadUrl(payload)
      const init = payload && payload.init && typeof payload.init === 'object' ? payload.init : {}
      const method = String(init.method || 'GET').toUpperCase()
      let workflow = null

      if (url && method === 'POST' && isPromptPath(url)) {
        const bodyText = typeof init.body === 'string' ? init.body : ''
        const authorized = await authorizeProviderWorkflowBody(bodyText, String(payload?.baseUrl || url.origin))
        if (authorized && authorized.blocked) return authorized.error
        workflow = authorized
      }

      const result = await originalRuntimeRequestJson({
        ...(payload && typeof payload === 'object' ? payload : {}),
      })
      const data = runtimeResultData(result)
      if (workflow && result && result.ok !== false) {
        const promptId = String(data?.prompt_id || data?.data?.prompt_id || '').trim()
        if (promptId) rememberProviderPrompt(promptId, workflow)
        else workflow.authorizationContext?.release?.()
      } else if (workflow) {
        workflow.authorizationContext?.release?.()
      }
      if (url && method === 'GET' && isHistoryPath(url) && result && result.ok !== false) {
        const promptId = getHistoryPromptId(url)
        if (promptId && readProviderPromptMeta(promptId)) {
          await commitProviderWorkflowUsage(promptId, data)
        }
      }
      return result
    }
    wrappedRuntimeRequestJson.__novaflowProviderUsageWrapped = true
    api.runtimeRequestJson = wrappedRuntimeRequestJson
  }

  const finalizeProviderWorkflowResponse = async (input, init, response, workflow) => {
    const url = getUrl(input)
    if (!url || !(response instanceof Response)) return response
    const method = getMethod(input, init)
    if (workflow && method === 'POST' && isPromptPath(url) && response.ok) {
      const data = await parseResponseJson(response)
      const promptId = String(data?.prompt_id || data?.data?.prompt_id || '').trim()
      if (promptId) rememberProviderPrompt(promptId, workflow)
      else workflow.authorizationContext?.release?.()
    } else if (workflow && method === 'POST' && isPromptPath(url)) {
      workflow.authorizationContext?.release?.()
    }
    if (method === 'GET' && isHistoryPath(url) && response.ok) {
      const promptId = getHistoryPromptId(url)
      if (promptId && readProviderPromptMeta(promptId)) {
        const data = await parseResponseJson(response)
        await commitProviderWorkflowUsage(promptId, data)
      }
    }
    return response
  }

  const base64ToBytes = (base64) => {
    const raw = atob(String(base64 || ''))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return bytes
  }

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result || '')
        resolve(text.includes(',') ? text.slice(text.indexOf(',') + 1) : text)
      }
      reader.onerror = () => reject(reader.error || new Error('blob read failed'))
      reader.readAsDataURL(blob)
    } catch (err) {
      reject(err)
    }
  })

  const isRuntimeBinaryPath = (url) => /\/(?:api\/)?view\/?$/i.test(String(url && url.pathname))
  const isRuntimeUploadImagePath = (url) => /\/(?:api\/)?upload\/image\/?$/i.test(String(url && url.pathname))

  const readFormData = async (input, init) => {
    try {
      if (init && init.body instanceof FormData) return init.body
      if (input instanceof Request && typeof input.clone().formData === 'function') {
        return await input.clone().formData()
      }
    } catch {}
    return null
  }

  const uploadImageViaElectron = async (source, input, init) => {
    const api = window.electronAPI
    if (typeof api.runtimeUploadImage !== 'function') return null
    const form = await readFormData(input, init)
    if (!form) return null
    const image = form.get('image')
    if (!(image instanceof Blob)) return null
    const result = await api.runtimeUploadImage({
      baseUrl: source.origin,
      fileName: String(image.name || `upload_${Date.now()}.png`),
      dataBase64: await blobToBase64(image),
      type: String(form.get('type') || 'input'),
      subfolder: String(form.get('subfolder') || ''),
    })
    const status = Number(result && result.status) || (result && result.ok ? 200 : 500)
    return jsonResponse(result && result.ok && 'data' in result ? result.data : result, status)
  }

  const runtimeFetchViaElectron = async (input, init, providerWorkflow) => {
    const source = getUrl(input)
    const api = window.electronAPI
    if (!source || !api) return null
    const path = `${source.pathname}${source.search}`
    const method = getMethod(input, init)

    try {
      if (method === 'POST' && isRuntimeUploadImagePath(source)) {
        const uploaded = await uploadImageViaElectron(source, input, init)
        if (uploaded) return uploaded
      }

      if (method === 'GET' && isRuntimeBinaryPath(source)) {
        const result = await api.runtimeRequestBinary({
          baseUrl: source.origin,
          path,
          init: {
            method,
            headers: headersToObject(getRequestHeaders(input, init)),
          },
        })
        const status = Number(result && result.status) || (result && result.ok ? 200 : 500)
        if (!result || !result.ok) return jsonResponse(result || { ok: false, error: 'runtime binary request failed' }, status)
        return new Response(base64ToBytes(result.dataBase64), {
          status,
          headers: {
            'Content-Type': result.contentType || 'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        })
      }

      const body = method === 'GET' || method === 'HEAD' ? null : await readBodyText(input, init)
      const result = await api.runtimeRequestJson({
        baseUrl: source.origin,
        path,
        init: {
          method,
          headers: headersToObject(getRequestHeaders(input, init)),
          body,
        },
      })
      const status = Number(result && result.status) || (result && result.ok ? 200 : 500)
      return jsonResponse(result && result.ok && 'data' in result ? result.data : result, status)
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: String((err && err.message) || err || 'runtime electron proxy failed'),
      }, 500)
    }
  }

  wrapRuntimeRequestJsonForProviderUsage()

  window.fetch = async function proxiedFetch(input, init) {
    if (await shouldBlockLegacyAifxPrompt(input, init)) {
      return new Response(LEGACY_AIFX_BLOCK_RESPONSE, {
        status: 409,
        headers: JSON_HEADERS,
      })
    }
    if (!shouldProxy(input)) return nativeFetch(input, init)
    const desktopFileRuntime = isDesktopFileRuntime()
    const providerWorkflow = desktopFileRuntime ? null : await authorizeProviderWorkflowPrompt(input, init)
    if (providerWorkflow && providerWorkflow.blocked) return providerWorkflow.response
    if (desktopFileRuntime) {
      const desktopResponse = await runtimeFetchViaElectron(input, init, providerWorkflow)
      if (desktopResponse) return desktopResponse
    }
    try {
      const response = await nativeFetch.apply(window, toProxyRequest(input, init))
      return await finalizeProviderWorkflowResponse(input, init, response, providerWorkflow)
    } catch (error) {
      providerWorkflow?.authorizationContext?.release?.()
      throw error
    }
  }
})()

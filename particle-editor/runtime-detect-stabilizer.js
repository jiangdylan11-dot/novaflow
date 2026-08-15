(function () {
  const TEXT = {
    detect: '\u68c0\u6d4b',
    connected: '\u5df2\u8fde\u63a5',
    missing: '\u672a\u627e\u5230 NovaFlow AI Runtime',
    recovering: '\u5df2\u68c0\u6d4b\u5230 NovaFlow AI Runtime\uff0c\u6b63\u5728\u6062\u590d\u8fde\u63a5...',
    model: '\u4e3b\u6a21\u578b',
  }

  const DEFAULT_RUNTIME_BASE_URL = 'http://127.0.0.1:8188'
  const LAST_OK_KEY = 'novaflow-preview-runtime-last-ok-url'
  let retryTimer = 0
  let observer = null
  let activeRun = false
  let attempts = 0

  try {
    ;['comfyui_last_connected_url', 'bone_comfyui_last_connected_url'].forEach((key) => {
      localStorage.removeItem(key)
    })
    ;['novaflow_runtime_last_connected_url', LAST_OK_KEY].forEach((key) => {
      const value = String(localStorage.getItem(key) || '').trim().replace(/\/+$/, '')
      if (!value) localStorage.setItem(key, DEFAULT_RUNTIME_BASE_URL)
    })
  } catch {
    void 0
  }

  const textOf = (node) => String((node && node.textContent) || '').replace(/\s+/g, ' ').trim()
  const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '')

  const isLoopbackUrl = (value) => /^https?:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(normalizeUrl(value))

  const getStatusNode = (container) => {
    const nodes = Array.from(container.querySelectorAll('div, span, p'))
    return (
      nodes.find((node) => {
        const text = textOf(node)
        return text.includes(TEXT.missing) || text.includes(TEXT.connected) || text.includes(TEXT.recovering)
      }) || null
    )
  }

  const findDetectContext = () => {
    if (document.querySelector('[data-novaflow-ai-runtime-manager="1"]')) return null
    const inputs = Array.from(document.querySelectorAll('input')).filter((node) => isLoopbackUrl(node.value))
    for (const input of inputs) {
      let container = input.closest('div')
      for (let i = 0; i < 8 && container; i += 1) {
        const button = Array.from(container.querySelectorAll('button')).find((node) => textOf(node).includes(TEXT.detect))
        if (button) {
          const containerText = textOf(container)
          if (containerText.includes('NovaFlow AI Runtime') || containerText.includes(TEXT.model)) {
            const statusNode = getStatusNode(container)
            return {
              input,
              button,
              container,
              statusNode,
              statusText: statusNode ? textOf(statusNode) : '',
              baseUrl: normalizeUrl(input.value),
            }
          }
        }
        container = container.parentElement
      }
    }
    return null
  }

  const pingProxy = async (baseUrl) => {
    try {
      const res = await fetch('/__runtime_proxy/', {
        method: 'GET',
        headers: { 'x-runtime-base': baseUrl },
        cache: 'no-store',
      })
      return !!res.ok
    } catch {
      return false
    }
  }

  const clearRetry = () => {
    if (!retryTimer) return
    window.clearTimeout(retryTimer)
    retryTimer = 0
  }

  const scheduleRetry = (delayMs) => {
    clearRetry()
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      void stabilizeRuntimeStatus()
    }, delayMs)
  }

  const setRecoveringStatus = (ctx) => {
    if (!ctx || !ctx.statusNode) return
    if (textOf(ctx.statusNode) === TEXT.recovering) return
    ctx.statusNode.textContent = TEXT.recovering
    if (ctx.statusNode instanceof HTMLElement) {
      ctx.statusNode.style.color = 'rgba(250, 204, 21, 0.95)'
    }
  }

  const markConnected = (ctx) => {
    attempts = 0
    clearRetry()
    try {
      localStorage.setItem(LAST_OK_KEY, ctx.baseUrl)
    } catch {
      void 0
    }
  }

  const shouldRetryContext = (ctx) => {
    if (!ctx) return false
    const lastOk = (() => {
      try {
        return normalizeUrl(localStorage.getItem(LAST_OK_KEY) || '')
      } catch {
        return ''
      }
    })()
    if (!ctx.statusText) return lastOk === ctx.baseUrl
    return ctx.statusText.includes(TEXT.missing) || ctx.statusText.includes(TEXT.recovering) || lastOk === ctx.baseUrl
  }

  const stabilizeRuntimeStatus = async () => {
    if (activeRun) return
    const ctx = findDetectContext()
    if (!ctx || !ctx.baseUrl) return

    if (ctx.statusText.includes(TEXT.connected)) {
      markConnected(ctx)
      return
    }

    if (!shouldRetryContext(ctx)) return
    if (attempts >= 20) return

    if (ctx.button instanceof HTMLButtonElement && ctx.button.disabled) {
      setRecoveringStatus(ctx)
      scheduleRetry(700)
      return
    }

    activeRun = true
    try {
      const healthy = await pingProxy(ctx.baseUrl)
      if (!healthy) {
        scheduleRetry(1200)
        return
      }
      setRecoveringStatus(ctx)
      attempts += 1
      ctx.button.click()
      scheduleRetry(1000)
    } finally {
      activeRun = false
    }
  }

  const installObserver = () => {
    if (observer) return
    observer = new MutationObserver(() => {
      const ctx = findDetectContext()
      if (!ctx) return
      if (ctx.statusText.includes(TEXT.connected)) {
        markConnected(ctx)
        return
      }
      if (ctx.statusText.includes(TEXT.missing)) {
        void stabilizeRuntimeStatus()
      }
    })
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  }

  const boot = () => {
    attempts = 0
    installObserver()
    scheduleRetry(350)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }

  window.addEventListener('pageshow', () => {
    attempts = 0
    scheduleRetry(120)
  })
  window.addEventListener('focus', () => scheduleRetry(120))
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRetry(120)
  })
})()

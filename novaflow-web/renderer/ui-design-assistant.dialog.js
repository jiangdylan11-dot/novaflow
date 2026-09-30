(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignAssistantDialog = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260928-ui-design-assistant-dialog-4'
  const ROOT_ATTRIBUTE = 'data-novaflow-ui-design-assistant-dialog'
  let active = null

  function text(value) {
    return String(value == null ? '' : value)
  }

  function workflowFor(options) {
    return options?.workflow || root?.NovaFlowUiDesignAssistantWorkflow
  }

  function element(documentRef, tag, attributes = {}, children = []) {
    const node = documentRef.createElement(tag)
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'text') node.textContent = text(value)
      else if (key === 'className') node.className = text(value)
      else if (key === 'style' && value && typeof value === 'object') Object.assign(node.style, value)
      else if (value !== undefined && value !== null) node.setAttribute(key, text(value))
    })
    const items = Array.isArray(children) ? children : [children]
    items.filter(Boolean).forEach((child) => node.appendChild(child))
    return node
  }

  function close(reason = 'close') {
    if (!active) return false
    const record = active
    active = null
    record.session?.cancel?.()
    record.documentRef.removeEventListener?.('keydown', record.onKeyDown, true)
    record.host?.remove?.()
    try { record.options.onClose?.(reason) } catch {}
    return true
  }

  function normalizeReferences(values) {
    return (Array.isArray(values) ? values : []).map((reference, index) => ({
      ...reference,
      id: text(reference?.id || reference?.sourceId || reference?.resourceId) || `ui_reference_${index + 1}`,
      label: text(reference?.label || reference?.name || reference?.fileName) || `参考图${index + 1}`,
      role: text(reference?.role || reference?.referenceRole) || 'reference',
      selected: true,
    }))
  }

  function currentPrompt(record) {
    if (typeof record.options.getPrompt === 'function') return text(record.options.getPrompt())
    if (record.options.promptTextarea && 'value' in record.options.promptTextarea) return text(record.options.promptTextarea.value)
    return text(record.options.prompt)
  }

  function currentNegativePrompt(record) {
    if (typeof record.options.getNegativePrompt === 'function') return text(record.options.getNegativePrompt())
    if (record.options.negativePromptTextarea && 'value' in record.options.negativePromptTextarea) return text(record.options.negativePromptTextarea.value)
    return text(record.options.negativePrompt)
  }

  function revision(record) {
    return `${currentPrompt(record)}\u0000${currentNegativePrompt(record)}\u0000${record.options.getInputRevision?.() || ""}`
  }

  function setStatus(record, message, error = false) {
    if (!record.status) return
    record.status.textContent = text(message)
    record.status.setAttribute('data-error', error ? '1' : '0')
    record.status.style.color = error ? '#fecaca' : '#86efac'
  }

  function selectedReferences(record) {
    return record.references.filter((reference) => reference.selected).map((reference) => ({ ...reference }))
  }

  function referenceLimit(record) {
    const workflow = workflowFor(record.options)
    if (typeof workflow?.analysisReferenceLimit === 'function') return workflow.analysisReferenceLimit(record.engine)
    return Infinity
  }

  // Like the AI 助手: the design assistant writes from the user's own words (设计要求 or 补充要求).
  function userTextMissing(record) {
    return !currentPrompt(record).trim() && !text(record.requirements?.value).trim() && !record.references.length && !(record.structure.regions || record.structure.blocks || []).length
  }

  function syncSubmitState(record) {
    if (!record.submit) return
    const missing = userTextMissing(record)
    if (record.notice) record.notice.style.display = missing && !record.pending ? 'block' : 'none'
    record.submit.disabled = Boolean(record.pending || record.referenceLimitError || missing)
    if (record.stop) record.stop.style.display = record.pending ? 'block' : 'none'
  }

  function syncReferenceLimitState(record) {
    const selectedCount = selectedReferences(record).length
    const limit = referenceLimit(record)
    const wasLimitError = Boolean(record.referenceLimitError)
    record.referenceLimitError = selectedCount > limit
    if (record.referenceLimitError) {
      const label = record.engine === 'local' ? '本地模型' : '云端模型'
      setStatus(record, `${label}最多分析 ${limit} 张参考图；当前已选择 ${selectedCount} 张，请回到参考图条移除多余图片，或更换处理方式。`, true)
    } else if (wasLimitError) {
      setStatus(record, '')
    }
    syncSubmitState(record)
    return !record.referenceLimitError
  }

  function updateReferenceRows(record) {
    record.referencesHost.replaceChildren()
    for (const [index, ref] of record.references.entries()) {
      record.referencesHost.appendChild(element(record.documentRef, 'div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' } }, [
        element(record.documentRef, 'img', { src: ref.dataUrl || ref.imageUrl, alt: '', style: { width: '54px', height: '40px', objectFit: 'contain' } }),
        element(record.documentRef, 'span', { text: `图${index + 1} · ${ref.label}` }),
      ]))
    }
    syncReferenceLimitState(record)
  }

  async function loadContext(record) {
    try {
      const references = typeof record.options.getReferences === 'function'
        ? await record.options.getReferences()
        : record.options.references || []
      const structure = typeof record.options.getStructureContext === 'function'
        ? await record.options.getStructureContext()
        : record.options.structure || record.options.snapshot || {}
      if (active !== record) return
      record.references = normalizeReferences(references, referenceLimit(record))
      record.structure = structure && typeof structure === 'object' ? structure : {}
      updateReferenceRows(record)
      const width = Number(record.options.size?.width || record.structure.width || record.structure.canvas?.width) || 0
      const height = Number(record.options.size?.height || record.structure.height || record.structure.canvas?.height) || 0
      const blocks = Array.isArray(record.structure.regions) ? record.structure.regions : Array.isArray(record.structure.blocks) ? record.structure.blocks : []
      const workflow = workflowFor(record.options)
      record.scene = typeof workflow?.inferPageScene === 'function' ? workflow.inferPageScene(record.structure) : '通用页面'
      record.contextSummary.textContent = [
        `已识别场景：${record.scene}`,
        width && height ? `${Math.round(width)} × ${Math.round(height)}` : '',
        `${blocks.length} 个页面区块`,
        `${record.references.length} 张参考图`,
      ].filter(Boolean).join(' · ')
    } catch (error) {
      if (active === record) setStatus(record, error?.message || error || '读取 UI 上下文失败', true)
    }
  }

  async function submit(record) {
    if (record.pending || active !== record) return false
    if (!syncReferenceLimitState(record)) return false
    if (userTextMissing(record)) {
      syncSubmitState(record)
      return false
    }
    const workflow = workflowFor(record.options)
    if (!workflow?.createSession || !record.session) {
      setStatus(record, 'AI 助手工作流未就绪', true)
      return false
    }
    record.pending = true
    record.submit.textContent = '处理中…'
    syncSubmitState(record)
    setStatus(record, '')
    const startRevision = revision(record)
    // 任务中止 settles the wait at once; whatever the engine returns later is never written.
    const stopped = new Promise((_, reject) => {
      record.stopRun = () => {
        record.session?.cancel?.()
        const error = new Error('任务已中止')
        error.novaflowStopped = true
        reject(error)
      }
    })
    stopped.catch(() => {})
    try {
      const result = await Promise.race([stopped, record.session.run({
        electronAPI: record.options.electronAPI,
        engine: record.engine,
        provider: record.options.provider || record.options.state?.provider,
        prompt: currentPrompt(record),
        negativePrompt: currentNegativePrompt(record),
        requirements: record.requirements.value,
        references: selectedReferences(record),
        structure: record.structure,
        size: record.options.size || {
          width: record.options.state?.width,
          height: record.options.state?.height,
        },
        getSessionToken: record.options.getSessionToken,
        sessionToken: record.options.sessionToken,
        getRevision: () => revision(record),
        revision: startRevision,
        timeoutMs: record.options.timeoutMs,
      })])
      if (active !== record) return false
      const payload = {
        prompt: result.prompt,
        source: 'design-assistant',
        engine: result.engine,
        provider: result.provider,
        referenceCount: result.referenceCount,
        scene: result.scene,
      }
      if (result.provider === 'local' && result.hasNegativePrompt) {
        payload.negativePrompt = result.negativePrompt
        payload.negativePromptSource = 'assistant'
      }
      if (typeof record.options.apply === 'function') await record.options.apply(payload)
      else {
        if (record.options.promptTextarea && 'value' in record.options.promptTextarea) record.options.promptTextarea.value = payload.prompt
        if (payload.negativePrompt && record.options.negativePromptTextarea && 'value' in record.options.negativePromptTextarea) {
          record.options.negativePromptTextarea.value = payload.negativePrompt
        }
      }
      close('applied')
      return true
    } catch (error) {
      if (active === record && error?.novaflowStopped) setStatus(record, '任务已中止')
      else if (active === record && error?.name !== 'AbortError') setStatus(record, error?.message || error || 'AI 助手执行失败', true)
      return false
    } finally {
      record.stopRun = null
      if (active === record) {
        record.pending = false
        record.submit.textContent = '生成并写入设计要求'
        syncSubmitState(record)
      }
    }
  }

  function createEngineChoice(record, value, title, meta) {
    const input = element(record.documentRef, 'input', {
      type: 'radio', name: 'novaflow-ui-design-assistant-engine', value,
      style: { accentColor: '#23c489', flex: '0 0 auto', margin: '0' },
    })
    input.value = value
    input.checked = value === record.engine
    input.addEventListener('change', () => {
      if (!input.checked) return
      record.engine = value
      updateReferenceRows(record)
    })
    return element(record.documentRef, 'label', {
      'data-novaflow-ui-design-assistant-engine-card': value,
      style: {
        display: 'flex', alignItems: 'center', gap: '8px', minHeight: '48px', padding: '7px 10px',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: '7px', background: 'rgba(255,255,255,0.035)',
        color: 'rgba(232,237,242,0.88)', fontSize: '11px', cursor: 'pointer', boxSizing: 'border-box',
      },
    }, [input, element(record.documentRef, 'span', { text: title }, [
      element(record.documentRef, 'span', {
        text: meta,
        style: { display: 'block', marginTop: '2px', color: 'rgba(232,237,242,0.46)', fontSize: '9px' },
      }),
    ])])
  }

  function open(options = {}) {
    close('replace')
    const documentRef = options.documentRef || root?.document
    const workflow = workflowFor(options)
    if (!documentRef?.createElement || !workflow?.createSession) throw new Error('AI 助手工作流或文档环境未就绪')

    const host = element(documentRef, 'div', {
      [ROOT_ATTRIBUTE]: '1',
      'data-novaflow-runtime-ignore': '1',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'AI 助手',
      style: {
        position: 'fixed', inset: '0', zIndex: '2147483645', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', background: 'rgba(0,0,0,0.62)', color: '#fff', boxSizing: 'border-box', pointerEvents: 'auto',
      },
    })
    const panel = element(documentRef, 'div', {
      'data-nf-dialog': 'panel',
      style: {
        width: '520px', maxWidth: '100%', maxHeight: 'min(760px, calc(100vh - 48px))', overflow: 'hidden',
        display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) auto', background: '#1E1E1E',
        border: '1px solid rgba(52,211,153,0.38)', borderRadius: '12px', boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
      },
    })
    const closeButton = element(documentRef, 'button', {
      type: 'button', text: '×', 'aria-label': '关闭 AI 助手', 'data-nf-dialog': 'close',
      style: { border: '0', background: 'transparent', color: 'rgba(255,255,255,0.68)', fontSize: '20px', cursor: 'pointer' },
    })
    closeButton.addEventListener('click', () => { if (!active?.pending) close('close') })
    const contextSummary = element(documentRef, 'div', {
      text: '正在读取页面结构与参考图…',
      style: { color: 'rgba(255,255,255,0.48)', fontSize: '11px', marginTop: '2px' },
    })
    const header = element(documentRef, 'header', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '13px 15px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
    }, [
      element(documentRef, 'div', {}, [
        element(documentRef, 'div', { text: 'AI 助手', 'data-nf-dialog': 'title', style: { fontSize: '14px', fontWeight: '600' } }),
        contextSummary,
      ]),
      closeButton,
    ])
    const body = element(documentRef, 'div', {
      style: { overflow: 'auto', padding: '14px 15px', display: 'grid', gap: '13px' },
    })
    const record = {
      options, documentRef, host, panel, body, contextSummary,
      references: [], structure: {}, scene: '通用页面', engine: options.engine || 'grok',
      pending: false, referenceLimitError: false,
      requirements: element(documentRef, 'textarea', {
        rows: '3', placeholder: '补充视觉风格、配色、材质、信息层级或必须保留的要求。',
        style: {
          width: '100%', minHeight: '72px', resize: 'vertical', boxSizing: 'border-box', padding: '9px',
          borderRadius: '7px', border: '1px solid rgba(255,255,255,0.12)', background: '#141414', color: '#fff',
          font: 'inherit', fontSize: '11px', lineHeight: '1.5',
        },
      }),
      referencesHost: element(documentRef, 'div', { style: { display: 'grid', gap: '6px' } }),
      // The same neutral box the AI 助手 shows while neither text field has words.
      notice: element(documentRef, 'div', {
        'data-novaflow-ui-design-assistant-notice': '1', text: '请先在设计要求或补充要求里写想要的效果',
        style: {
          display: 'none', padding: '8px 10px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
          background: 'rgba(255,255,255,0.035)', color: 'rgba(160,160,160,0.96)', fontSize: '11px', lineHeight: '17px',
        },
      }),
      status: element(documentRef, 'div', { 'aria-live': 'polite', style: { minHeight: '16px', fontSize: '11px', lineHeight: '1.5' } }),
      session: workflow.createSession(),
    }
    record.requirements.addEventListener('input', () => syncSubmitState(record))
    const section = (label, content) => element(documentRef, 'section', { style: { display: 'grid', gap: '7px' } }, [
      element(documentRef, 'div', { text: label, style: { color: 'rgba(255,255,255,0.76)', fontSize: '11px', fontWeight: '850' } }),
      content,
    ])
    const engineGrid = element(documentRef, 'div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '6px' } })
    ;[['grok', '云端模型', '云端 · 深度处理'], ['local', '本地模型', '本地 · 快速处理']].forEach(([value, title, meta]) => {
      engineGrid.appendChild(createEngineChoice(record, value, title, meta))
    })
    body.append(
      section('处理方式', engineGrid),
      section('参考图', record.referencesHost),
      section('补充要求', record.requirements),
      record.notice,
      record.status,
    )
    const submit = element(documentRef, 'button', {
      type: 'button', text: '生成并写入设计要求',
      style: {
        width: 'min(320px, 100%)', height: '38px', border: '0', borderRadius: '8px', background: '#1ead7a', color: '#fff',
        fontSize: '12px', fontWeight: '600', cursor: 'pointer',
      },
    })
    record.submit = submit
    submit.addEventListener('click', () => submitDesign(record))
    const stop = element(documentRef, 'button', {
      type: 'button', text: '任务中止', 'data-novaflow-ui-design-assistant-stop': '1',
      style: {
        display: 'none', width: 'min(320px, 100%)', height: '38px', border: '1px solid rgba(239,68,68,0.55)', borderRadius: '8px',
        background: 'rgba(239,68,68,0.18)', color: '#fff', fontSize: '12px', fontWeight: '500', cursor: 'pointer',
      },
    })
    record.stop = stop
    stop.addEventListener('click', () => { if (record.pending) record.stopRun?.() })
    const footer = element(documentRef, 'footer', {
      style: { display: 'flex', justifyContent: 'center', gap: '8px', padding: '12px 15px', borderTop: '1px solid rgba(255,255,255,0.08)' },
    }, [submit, stop])
    panel.append(header, body, footer)
    host.appendChild(panel)
    host.addEventListener('pointerdown', (event) => { if (event.target === host && !record.pending) close('backdrop') })
    record.onKeyDown = (event) => {
      if (event.key === 'Escape' && active === record && !record.pending) {
        event.preventDefault?.()
        close('escape')
      }
    }
    documentRef.addEventListener?.('keydown', record.onKeyDown, true)
    ;(documentRef.body || documentRef.documentElement).appendChild(host)
    active = record
    updateReferenceRows(record)
    loadContext(record)
    syncSubmitState(record)
    return Object.freeze({
      close: () => close('api'),
      submit: () => submitDesign(record),
      snapshot: () => ({
        open: active === record,
        pending: record.pending,
        engine: record.engine,
        scene: record.scene,
        referenceLimit: referenceLimit(record),
        referenceCount: selectedReferences(record).length,
      }),
    })
  }

  // Kept separate from the submit element variable so Fake DOM tests and the
  // public handle can call the same guarded operation.
  function submitDesign(record) {
    return submit(record)
  }

  function snapshot() {
    return active
      ? { open: true, pending: active.pending, referenceCount: selectedReferences(active).length }
      : { open: false, pending: false, referenceCount: 0 }
  }

  return Object.freeze({ VERSION, open, close, snapshot })
})

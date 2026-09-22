(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignAssistantDialog = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260722-ui-design-assistant-dialog-3'
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

  function normalizeReferences(values, selectedLimit = 4) {
    const limit = Math.max(0, Number(selectedLimit) || 0)
    return (Array.isArray(values) ? values : []).map((reference, index) => ({
      ...reference,
      id: text(reference?.id || reference?.sourceId || reference?.resourceId) || `ui_reference_${index + 1}`,
      label: text(reference?.label || reference?.name || reference?.fileName) || `参考图${index + 1}`,
      role: text(reference?.role || reference?.referenceRole) || 'reference',
      selected: index < limit,
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
    return `${currentPrompt(record)}\u0000${currentNegativePrompt(record)}`
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
    return record.engine === 'local' ? 3 : 4
  }

  function syncSubmitState(record) {
    if (!record.submit) return
    record.submit.disabled = Boolean(record.pending || record.referenceLimitError)
  }

  function syncReferenceLimitState(record) {
    const selectedCount = selectedReferences(record).length
    const limit = referenceLimit(record)
    const wasLimitError = Boolean(record.referenceLimitError)
    record.referenceLimitError = selectedCount > limit
    if (record.referenceLimitError) {
      const label = record.engine === 'local' ? '本地设计助手' : 'Grok 设计助手'
      setStatus(record, `${label}最多分析 ${limit} 张参考图；当前已选择 ${selectedCount} 张，请取消多余选择。`, true)
    } else if (wasLimitError) {
      setStatus(record, '')
    }
    syncSubmitState(record)
    return !record.referenceLimitError
  }

  function updateReferenceRows(record) {
    if (!record.referencesHost) return
    record.referencesHost.replaceChildren()
    const selectedCount = selectedReferences(record).length
    const limit = referenceLimit(record)
    record.referencesHost.appendChild(element(record.documentRef, 'div', {
      'data-novaflow-ui-design-assistant-reference-note': '1',
      text: `${record.engine === 'local' ? '本地设计助手' : 'Grok 设计助手'}最多分析 ${limit} 张。未勾选的连接图仍会参与最终 UI 生成，只是不用于本次设计助手分析。`,
      style: { color: 'rgba(255,255,255,0.5)', fontSize: '10px', lineHeight: '1.5' },
    }))
    if (!record.references.length) {
      record.referencesHost.appendChild(element(record.documentRef, 'div', {
        text: '当前生成器没有已连接的参考图。仍可只根据页面结构优化设计要求。',
        style: { color: 'rgba(255,255,255,0.5)', fontSize: '11px', lineHeight: '1.5' },
      }))
      syncTargetStyleButtons(record)
      return
    }
    record.references.forEach((reference, index) => {
      const checkbox = element(record.documentRef, 'input', { type: 'checkbox' })
      checkbox.checked = reference.selected
      checkbox.disabled = !reference.selected && selectedCount >= limit
      checkbox.addEventListener('change', () => {
        const current = selectedReferences(record).length
        if (checkbox.checked && current >= referenceLimit(record)) {
          checkbox.checked = false
          setStatus(record, `${record.engine === 'local' ? '本地设计助手' : 'Grok 设计助手'}一次最多分析 ${referenceLimit(record)} 张参考图。`, true)
          return
        }
        reference.selected = checkbox.checked
        setStatus(record, '')
        updateReferenceRows(record)
      })
      const role = element(record.documentRef, 'select', {
        'aria-label': `${reference.label}本次分析职责`,
        style: {
          height: '28px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
          background: '#111416', color: '#fff', fontSize: '10px', padding: '0 6px',
        },
      })
      ;[
        ['reference', '普通参考'], ['style', '风格'], ['layout', '辅助布局'], ['color', '配色'],
        ['material', '材质'], ['content', '内容素材'], ['character', '角色'], ['subject', '主体'],
      ].forEach(([value, label]) => {
        const option = element(record.documentRef, 'option', { value, text: label })
        option.value = value
        role.appendChild(option)
      })
      role.value = reference.role
      role.disabled = !reference.selected
      role.addEventListener('change', () => {
        reference.role = role.value
        syncTargetStyleButtons(record)
      })
      record.referencesHost.appendChild(element(record.documentRef, 'label', {
        'data-novaflow-ui-design-assistant-reference': String(index + 1),
        style: {
          display: 'grid', gridTemplateColumns: '18px minmax(0,1fr) 104px', alignItems: 'center',
          gap: '8px', minWidth: '0', padding: '7px', borderRadius: '7px', background: 'rgba(255,255,255,0.035)',
        },
      }, [
        checkbox,
        element(record.documentRef, 'span', {
          text: `${index + 1}. ${reference.label}`,
          style: { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' },
        }),
        role,
      ]))
    })
    syncReferenceLimitState(record)
    syncTargetStyleButtons(record)
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
        `${record.references.length} 张已连接参考图`,
      ].filter(Boolean).join(' · ')
    } catch (error) {
      if (active === record) setStatus(record, error?.message || error || '读取 UI 上下文失败', true)
    }
  }

  async function submit(record) {
    if (record.pending || active !== record) return false
    if (!syncReferenceLimitState(record)) return false
    const workflow = workflowFor(record.options)
    if (!workflow?.createSession || !record.session) {
      setStatus(record, '设计助手工作流未就绪', true)
      return false
    }
    record.pending = true
    record.submit.disabled = true
    record.submit.textContent = '处理中…'
    setStatus(record, '')
    const startRevision = revision(record)
    try {
      const result = await record.session.run({
        electronAPI: record.options.electronAPI,
        engine: record.engine,
        provider: record.options.provider || record.options.state?.provider,
        action: record.action,
        targetStyle: record.targetStyle,
        contentType: record.contentType,
        contentPurpose: record.contentPurpose,
        qualityTendency: record.qualityTendency,
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
      })
      if (active !== record) return false
      const payload = {
        prompt: result.prompt,
        source: 'design-assistant',
        engine: result.engine,
        provider: result.provider,
        referenceCount: result.referenceCount,
        targetStyle: result.targetStyle,
        contentType: result.contentType,
        contentPurpose: result.contentPurpose,
        qualityTendency: result.qualityTendency,
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
      if (active === record && error?.name !== 'AbortError') setStatus(record, error?.message || error || '设计助手执行失败', true)
      return false
    } finally {
      if (active === record) {
        record.pending = false
        record.submit.textContent = '生成并写入设计要求'
        syncSubmitState(record)
      }
    }
  }

  function syncActionButtons(record) {
    for (const button of record.actionButtons || []) {
      const selected = button.getAttribute('data-action') === record.action
      button.setAttribute('aria-pressed', selected ? 'true' : 'false')
      button.style.borderColor = selected ? 'rgba(52,211,153,0.72)' : 'rgba(255,255,255,0.1)'
      button.style.background = selected ? 'rgba(30,173,122,0.2)' : 'rgba(255,255,255,0.045)'
      button.style.color = selected ? '#9ff6d4' : 'rgba(255,255,255,0.78)'
    }
  }

  function createActionChoice(record, value, label) {
    const button = element(record.documentRef, 'button', {
      type: 'button', text: label, 'data-action': value, 'aria-pressed': 'false',
      style: {
        minHeight: '32px', padding: '0 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px',
        background: 'rgba(255,255,255,0.045)', color: 'rgba(255,255,255,0.78)', fontSize: '10px', cursor: 'pointer',
      },
    })
    button.addEventListener('click', () => {
      record.action = value
      syncActionButtons(record)
    })
    record.actionButtons.push(button)
    return button
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

  function hasSelectedStyleReference(record) {
    return selectedReferences(record).some((reference) => text(reference.role).trim().toLowerCase() === 'style')
  }

  function syncTargetStyleButtons(record) {
    const canFollowReference = hasSelectedStyleReference(record)
    if (record.targetStyle === 'reference' && !canFollowReference) {
      record.targetStyle = 'auto'
      setStatus(record, '“跟随参考图”已恢复为“智能匹配”：当前没有已勾选的风格参考图。')
    }
    for (const button of record.targetStyleButtons || []) {
      const value = button.getAttribute('data-target-style')
      const selected = value === record.targetStyle
      const disabled = value === 'reference' && !canFollowReference
      button.disabled = disabled
      button.setAttribute('aria-pressed', selected ? 'true' : 'false')
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false')
      button.style.borderColor = selected ? 'rgba(52,211,153,0.72)' : 'rgba(255,255,255,0.1)'
      button.style.background = selected ? 'rgba(30,173,122,0.2)' : 'rgba(255,255,255,0.045)'
      button.style.color = selected ? '#9ff6d4' : 'rgba(255,255,255,0.78)'
      button.style.cursor = disabled ? 'not-allowed' : 'pointer'
      button.style.opacity = disabled ? '0.42' : '1'
      button.title = disabled ? '请先将至少一张已勾选参考图的职责设为“风格”' : ''
    }
  }

  function createTargetStyleButton(record, preset) {
    const button = element(record.documentRef, 'button', {
      type: 'button',
      text: preset.label,
      'data-target-style': preset.value,
      'aria-pressed': 'false',
      style: {
        minHeight: '32px', padding: '0 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px',
        background: 'rgba(255,255,255,0.045)', color: 'rgba(255,255,255,0.78)', fontSize: '10px', cursor: 'pointer',
      },
    })
    button.addEventListener('click', () => {
      if (button.disabled) return
      record.targetStyle = record.targetStyle === preset.value && preset.value !== 'auto' ? 'auto' : preset.value
      syncTargetStyleButtons(record)
    })
    record.targetStyleButtons.push(button)
    return button
  }

  function createSelect(documentRef, items, value, onChange, ariaLabel) {
    const select = element(documentRef, 'select', {
      'aria-label': ariaLabel,
      style: {
        width: '100%', height: '34px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px',
        background: '#111416', color: '#fff', fontSize: '11px', padding: '0 8px',
      },
    })
    for (const item of items || []) {
      const option = element(documentRef, 'option', { value: item.value, text: item.label })
      option.value = item.value
      select.appendChild(option)
    }
    select.value = value
    select.addEventListener('change', () => onChange(select.value))
    return select
  }

  function open(options = {}) {
    close('replace')
    const documentRef = options.documentRef || root?.document
    const workflow = workflowFor(options)
    if (!documentRef?.createElement || !workflow?.createSession) throw new Error('设计助手工作流或文档环境未就绪')

    const host = element(documentRef, 'div', {
      [ROOT_ATTRIBUTE]: '1',
      'data-novaflow-runtime-ignore': '1',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '设计助手',
      style: {
        position: 'fixed', inset: '0', zIndex: '2147483645', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', background: 'rgba(0,0,0,0.62)', color: '#fff', boxSizing: 'border-box', pointerEvents: 'auto',
      },
    })
    const panel = element(documentRef, 'div', {
      style: {
        width: '520px', maxWidth: '100%', maxHeight: 'min(760px, calc(100vh - 48px))', overflow: 'hidden',
        display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) auto', background: '#1b1f21',
        border: '1px solid rgba(52,211,153,0.38)', borderRadius: '12px', boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
      },
    })
    const closeButton = element(documentRef, 'button', {
      type: 'button', text: '×', 'aria-label': '关闭设计助手',
      style: { border: '0', background: 'transparent', color: 'rgba(255,255,255,0.68)', fontSize: '20px', cursor: 'pointer' },
    })
    closeButton.addEventListener('click', () => { if (!active?.pending) close('close') })
    const contextSummary = element(documentRef, 'div', {
      text: '正在读取页面结构与参考图…',
      style: { color: 'rgba(255,255,255,0.48)', fontSize: '10px', marginTop: '2px' },
    })
    const header = element(documentRef, 'header', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '13px 15px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
    }, [
      element(documentRef, 'div', {}, [
        element(documentRef, 'div', { text: '设计助手', style: { fontSize: '14px', fontWeight: '900' } }),
        contextSummary,
      ]),
      closeButton,
    ])
    const body = element(documentRef, 'div', {
      style: { overflow: 'auto', padding: '14px 15px', display: 'grid', gap: '13px' },
    })
    const record = {
      options, documentRef, host, panel, body, contextSummary,
      references: [], structure: {}, scene: '通用页面', action: 'preserve', actionButtons: [], engine: 'grok', targetStyle: 'auto', targetStyleButtons: [],
      contentType: 'auto', contentPurpose: 'auto', qualityTendency: 'commercial',
      pending: false, referenceLimitError: false,
      requirements: element(documentRef, 'textarea', {
        rows: '3', placeholder: '补充视觉风格、配色、材质、信息层级或必须保留的要求。',
        style: {
          width: '100%', minHeight: '72px', resize: 'vertical', boxSizing: 'border-box', padding: '9px',
          borderRadius: '7px', border: '1px solid rgba(255,255,255,0.12)', background: '#111416', color: '#fff',
          font: 'inherit', fontSize: '11px', lineHeight: '1.5',
        },
      }),
      referencesHost: element(documentRef, 'div', { style: { display: 'grid', gap: '6px' } }),
      status: element(documentRef, 'div', { 'aria-live': 'polite', style: { minHeight: '16px', fontSize: '10px', lineHeight: '1.5' } }),
      session: workflow.createSession(),
    }
    const section = (label, content) => element(documentRef, 'section', { style: { display: 'grid', gap: '7px' } }, [
      element(documentRef, 'div', { text: label, style: { color: 'rgba(255,255,255,0.76)', fontSize: '11px', fontWeight: '850' } }),
      content,
    ])
    const actionGrid = element(documentRef, 'div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '6px' } })
    ;[['preserve', '保持结构'], ['create', '新建设计'], ['style', '参考风格'], ['combine', '组合参考']].forEach(([value, label]) => {
      actionGrid.appendChild(createActionChoice(record, value, label))
    })
    syncActionButtons(record)
    const targetStyleGrid = element(documentRef, 'div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '6px' } })
    ;(workflow.UI_STYLE_PRESETS || []).forEach((preset) => targetStyleGrid.appendChild(createTargetStyleButton(record, preset)))
    const qualityProfile = root?.NovaFlowUiDesignQualityProfile
    const purposeHost = element(documentRef, 'div')
    const syncPurposeSelect = () => {
      const purposes = qualityProfile?.purposesFor?.(record.contentType) || [{ value: 'auto', label: '智能识别用途' }]
      record.contentPurpose = qualityProfile?.normalizePurpose?.(record.contentType, record.contentPurpose) || 'auto'
      purposeHost.replaceChildren(createSelect(documentRef, purposes, record.contentPurpose, (value) => {
        record.contentPurpose = value
      }, '内容用途'))
    }
    const contentTypeSelect = createSelect(
      documentRef,
      qualityProfile?.CONTENT_TYPES || [{ value: 'auto', label: '智能识别' }],
      record.contentType,
      (value) => {
        record.contentType = value
        record.contentPurpose = 'auto'
        syncPurposeSelect()
      },
      '内容类型',
    )
    const tendencySelect = createSelect(
      documentRef,
      qualityProfile?.QUALITY_TENDENCIES || [{ value: 'commercial', label: '稳妥商业化' }],
      record.qualityTendency,
      (value) => { record.qualityTendency = value },
      '质量倾向',
    )
    syncPurposeSelect()
    const contentProfileGrid = element(documentRef, 'div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '6px' },
    }, [contentTypeSelect, purposeHost, tendencySelect])
    const engineGrid = element(documentRef, 'div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '6px' } })
    ;[['grok', 'Grok AI', '云端 · 深度处理'], ['local', '本地模型', '本地 · 快速处理']].forEach(([value, title, meta]) => {
      engineGrid.appendChild(createEngineChoice(record, value, title, meta))
    })
    body.append(
      section('设计目标', actionGrid),
      section('内容类型 · 用途 · 质量倾向', contentProfileGrid),
      section('目标风格（单选，再次点击恢复智能匹配）', targetStyleGrid),
      section('处理方式', engineGrid),
      section('参考图 · 本次分析职责', record.referencesHost),
      section('补充要求', record.requirements),
      record.status,
    )
    const submit = element(documentRef, 'button', {
      type: 'button', text: '生成并写入设计要求',
      style: {
        width: 'min(320px, 100%)', height: '38px', border: '0', borderRadius: '8px', background: '#1ead7a', color: '#fff',
        fontSize: '12px', fontWeight: '900', cursor: 'pointer',
      },
    })
    record.submit = submit
    submit.addEventListener('click', () => submitDesign(record))
    const footer = element(documentRef, 'footer', {
      style: { display: 'flex', justifyContent: 'center', padding: '12px 15px', borderTop: '1px solid rgba(255,255,255,0.08)' },
    }, [submit])
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
    return Object.freeze({
      close: () => close('api'),
      submit: () => submitDesign(record),
      snapshot: () => ({
        open: active === record,
        pending: record.pending,
        engine: record.engine,
        targetStyle: record.targetStyle,
        contentType: record.contentType,
        contentPurpose: record.contentPurpose,
        qualityTendency: record.qualityTendency,
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

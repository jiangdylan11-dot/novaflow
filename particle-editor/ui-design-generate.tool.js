(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignGenerateTool = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const MODE = 'img2img'
  const AUTH_SURFACE_KEY = 'ui-design'
  const PROVIDER_OPTIONS = Object.freeze([
    Object.freeze({ value: 'local', label: '本地模型' }),
    Object.freeze({ value: 'gpt', label: 'GPT' }),
    Object.freeze({ value: 'google', label: 'Google' }),
  ])
  const GPT_EXACT_SIZES = new Set([
    '1024x1024', '1024x1536', '1536x1024', '2048x2048',
    '2048x1152', '1152x2048', '3840x2160', '2160x3840',
  ])
  const GOOGLE_ASPECTS = Object.freeze([
    ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3],
    ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9],
  ])
  const OUTPUT_SIZE_PRESETS = Object.freeze([
    Object.freeze({ value: '1024x1024', label: '1024 × 1024', width: 1024, height: 1024 }),
    Object.freeze({ value: '1280x720', label: '1280 × 720', width: 1280, height: 720 }),
    Object.freeze({ value: '720x1280', label: '720 × 1280', width: 720, height: 1280 }),
    Object.freeze({ value: '1920x1080', label: '1920 × 1080', width: 1920, height: 1080 }),
    Object.freeze({ value: '1080x1920', label: '1080 × 1920', width: 1080, height: 1920 }),
    Object.freeze({ value: '2048x1152', label: '2048 × 1152', width: 2048, height: 1152 }),
    Object.freeze({ value: '1152x2048', label: '1152 × 2048', width: 1152, height: 2048 }),
    Object.freeze({ value: '2048x2048', label: '2048 × 2048', width: 2048, height: 2048 }),
  ])
  const GPT_OUTPUT_SIZE_PRESETS = Object.freeze([
    Object.freeze({ value: '1024x1024', label: '1024 × 1024', width: 1024, height: 1024 }),
    Object.freeze({ value: '1536x1024', label: '1536 × 1024', width: 1536, height: 1024 }),
    Object.freeze({ value: '1024x1536', label: '1024 × 1536', width: 1024, height: 1536 }),
    Object.freeze({ value: '2048x1152', label: '2048 × 1152', width: 2048, height: 1152 }),
    Object.freeze({ value: '1152x2048', label: '1152 × 2048', width: 1152, height: 2048 }),
    Object.freeze({ value: '2048x2048', label: '2048 × 2048', width: 2048, height: 2048 }),
    Object.freeze({ value: '3840x2160', label: '3840 × 2160', width: 3840, height: 2160 }),
    Object.freeze({ value: '2160x3840', label: '2160 × 3840', width: 2160, height: 3840 }),
  ])
  const MIN_OUTPUT_SIZE = 320
  const MAX_OUTPUT_SIZE = 8192
  const GPT_MIN_OUTPUT_SIZE = 1024
  const GPT_MAX_OUTPUT_SIZE = 3840
  const GPT_MAX_OUTPUT_PIXELS = 8294400
  const DEFAULT_UI_NEGATIVE_PROMPT = '低清晰度，模糊，文字乱码，错别字，水印，未要求的源Logo，布局混乱，元素重叠，按钮变形，控件裁切，界面拉伸，重复控件，空白占位，标注框，连接线，端口，编辑器网格'
  const DEFAULT_PROMPT_ASSISTANT_REQUIREMENTS = '面向游戏 UI 设计，保持当前页面结构和区块职责，补充清晰的视觉风格、配色、材质、层级、可读性与交互状态要求。'
  const NEGATIVE_PROMPT_SOURCES = new Set(['default', 'assistant', 'user'])
  const mountedControls = new WeakMap()

  function setStyles(element, styles) {
    if (element?.style && styles) Object.assign(element.style, styles)
    return element
  }

  function createElement(documentRef, tagName, attributes = {}, children = []) {
    const element = documentRef.createElement(tagName)
    Object.entries(attributes).forEach(([name, value]) => {
      if (name === 'text') element.textContent = String(value == null ? '' : value)
      else if (name === 'style') setStyles(element, value)
      else if (name === 'className') element.className = String(value || '')
      else if (name === 'checked') element.checked = Boolean(value)
      else if (name === 'disabled') {
        element.disabled = Boolean(value)
        if (value) element.setAttribute('disabled', 'disabled')
      } else if (value != null) element.setAttribute(name, value)
    })
    const list = Array.isArray(children) ? children : [children]
    list.filter(Boolean).forEach((child) => element.appendChild(child))
    return element
  }

  function normalizeProvider(value) {
    const models = root && root.NovaFlowArtGenerateModels
    if (models && typeof models.normalizeProvider === 'function') return models.normalizeProvider(value)
    const provider = String(value || '').trim().toLowerCase()
    return provider === 'gpt' || provider === 'google' ? provider : 'local'
  }

  function ensureState(value) {
    const state = value && typeof value === 'object' ? value : {}
    const hasNegativePrompt = Object.prototype.hasOwnProperty.call(state, 'negativePrompt')
    const negativePromptSource = NEGATIVE_PROMPT_SOURCES.has(state.negativePromptSource)
      ? state.negativePromptSource
      : ''
    state.mode = MODE
    state.provider = normalizeProvider(state.provider)
    state.prompt = String(state.prompt == null ? '' : state.prompt)
    if (!hasNegativePrompt && negativePromptSource !== 'user') {
      state.negativePrompt = DEFAULT_UI_NEGATIVE_PROMPT
      state.negativePromptSource = 'default'
    } else {
      state.negativePrompt = String(state.negativePrompt == null ? '' : state.negativePrompt)
      state.negativePromptSource = negativePromptSource || 'user'
    }
    state.localEditStrength = state.localEditStrength === 'enhanced' ? 'enhanced' : 'faithful'
    const hasRandomSeed = Object.prototype.hasOwnProperty.call(state, 'randomSeed')
    state.randomSeed = hasRandomSeed ? state.randomSeed === true : true
    state.seed = Number.isFinite(Number(state.seed)) ? Math.round(Number(state.seed)) : 0
    if (!state.randomSeed && state.seed < 0) state.seed = 0
    state.nsfw = state.nsfw === true
    state.gptQualityImg2img = ['low', 'medium', 'high'].includes(state.gptQualityImg2img) ? state.gptQualityImg2img : 'low'
    state.googleResolution = ['1K', '2K', '4K'].includes(state.googleResolution) ? state.googleResolution : '1K'
    return state
  }

  function generatorRecordKey(options, host) {
    const explicit = String(options?.generatorId || options?.recordId || '').trim()
    if (explicit) return explicit
    const hostKey = String(host?.getAttribute?.('data-novaflow-ui-design-generator-controls') || '').trim()
    return hostKey || host
  }

  function invalidatePromptAssistant(record) {
    record.assistantToken += 1
    record.assistantPending = false
  }

  function positiveInteger(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? Math.max(1, Math.round(number)) : fallback
  }

  function outputDimension(value, fallback) {
    return Math.max(MIN_OUTPUT_SIZE, Math.min(MAX_OUTPUT_SIZE, positiveInteger(value, fallback)))
  }

  function variantOf(options) {
    const value = String(options?.variant || '').trim().toLowerCase()
    return value === 'node' || value === 'compact' ? 'node' : 'ordinary'
  }

  function presetForSize(width, height) {
    return OUTPUT_SIZE_PRESETS.find((item) => item.width === width && item.height === height) || null
  }

  function outputSizePresets(provider) {
    return normalizeProvider(provider) === 'gpt' ? GPT_OUTPUT_SIZE_PRESETS : OUTPUT_SIZE_PRESETS
  }

  function presetForProviderSize(provider, width, height) {
    return outputSizePresets(provider).find((item) => item.width === width && item.height === height) || null
  }

  function canvasSize(record) {
    if (record.outputSizeOverride) return { ...record.outputSizeOverride }
    let value = null
    try {
      value = typeof record.options.getCanvasSize === 'function' ? record.options.getCanvasSize() : null
    } catch {
      value = null
    }
    const width = positiveInteger(value?.width ?? value?.w, positiveInteger(record.state.width, 1024))
    const height = positiveInteger(value?.height ?? value?.h, positiveInteger(record.state.height, 1024))
    return { width, height }
  }

  function closestGoogleAspect(width, height) {
    const ratio = width / Math.max(1, height)
    return GOOGLE_ASPECTS.reduce((best, candidate) => (
      Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best
    ), GOOGLE_ASPECTS[0])[0]
  }

  function syncCanvasState(record) {
    const size = canvasSize(record)
    record.state.width = size.width
    record.state.height = size.height
    record.state.gptCustomWidth = size.width
    record.state.gptCustomHeight = size.height
    const exactSize = `${size.width}x${size.height}`
    record.state.gptSize = GPT_EXACT_SIZES.has(exactSize) ? exactSize : 'Custom'
    record.state.googleAspectRatioImg2img = closestGoogleAspect(size.width, size.height)
    record.state.mode = MODE
    return size
  }

  function optionNodes(documentRef, values, selectedValue) {
    return values.map((entry) => {
      const item = typeof entry === 'string' ? { value: entry, label: entry } : entry
      const option = createElement(documentRef, 'option', { value: item.value, text: item.label })
      option.value = String(item.value)
      if (String(item.value) === String(selectedValue)) option.setAttribute('selected', 'selected')
      return option
    })
  }

  function fieldShell(documentRef, label, control) {
    return createElement(documentRef, 'label', {
      style: { display: 'grid', gap: '6px', minWidth: '0', color: 'rgba(255,255,255,0.72)', fontSize: '11px', fontWeight: '700' },
    }, [
      createElement(documentRef, 'span', { text: label }),
      control,
    ])
  }

  function selectControl(record, key, label, values, value, attributeName) {
    const select = createElement(record.documentRef, 'select', {
      'aria-label': label,
      'data-novaflow-ui-design-select': '1',
      'data-novaflow-ui-design-param': key,
      ...(attributeName ? { [attributeName]: '1' } : {}),
      style: {
        width: '100%', height: '32px', minWidth: '0', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.12)', background: '#242424',
        color: '#fff', padding: '0 9px', boxSizing: 'border-box', cursor: 'pointer',
      },
    }, optionNodes(record.documentRef, values, value))
    select.value = String(value)
    select.addEventListener('change', () => {
      updateState(record, key, String(select.value || ''))
    })
    return fieldShell(record.documentRef, label, select)
  }

  function outputField(record, label, text, attributeName) {
    const output = createElement(record.documentRef, 'output', {
      ...(attributeName ? { [attributeName]: '1' } : {}),
      text,
      style: {
        display: 'flex', alignItems: 'center', height: '32px', minWidth: '0',
        padding: '0 9px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)',
        background: '#171717', color: 'rgba(255,255,255,0.9)', boxSizing: 'border-box',
        fontSize: '12px', fontWeight: '800',
      },
    })
    return fieldShell(record.documentRef, label, output)
  }

  function switchField(record, key, label, checked, options = {}) {
    const active = checked === true
    const knob = createElement(record.documentRef, 'span', {
      'aria-hidden': 'true',
      style: {
        position: 'absolute', top: '4px', left: active ? '20px' : '4px', width: '10px', height: '10px',
        borderRadius: '50%', background: active ? '#e8e8e8' : '#8f98a3', boxShadow: '0 1px 3px rgba(0,0,0,0.42)',
        transition: 'left 120ms ease', pointerEvents: 'none',
      },
    })
    const control = createElement(record.documentRef, 'button', {
      type: 'button',
      role: 'switch',
      'aria-label': label,
      'aria-checked': active ? 'true' : 'false',
      'data-novaflow-ui-design-param': key,
      style: {
        position: 'relative', flex: '0 0 34px', width: '34px', height: '18px', padding: '0',
        border: '0', borderRadius: '999px', background: active ? '#1ea672' : '#222',
        cursor: 'pointer', boxSizing: 'border-box', transition: 'background 120ms ease',
      },
    }, [knob])
    control.addEventListener('click', (event) => {
      event?.preventDefault?.()
      event?.stopPropagation?.()
      updateState(record, key, !active)
    })
    const children = [createElement(record.documentRef, 'span', { text: label }), control]
    if (options.trailing) children.push(options.trailing)
    return createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-switch-field': key,
      style: {
        display: 'grid', gridTemplateColumns: '48px 34px minmax(0, 1fr)', alignItems: 'center', gap: '5px',
        minWidth: '0', minHeight: '26px', color: 'rgba(255,255,255,0.78)', fontSize: '10px', fontWeight: '750',
      },
    }, children)
  }

  function resolveOutputContract(provider, size, state = {}) {
    const normalizedProvider = normalizeProvider(provider)
    const width = Number(size?.width ?? size?.w)
    const height = Number(size?.height ?? size?.h)
    const base = {
      provider: normalizedProvider,
      width,
      height,
      valid: true,
      exact: true,
      error: '',
      aspect: '',
      resolution: '',
      specification: '',
      note: '',
    }
    if (normalizedProvider === 'local') {
      return Object.freeze({
        ...base,
        specification: `${width} × ${height}`,
        note: '按设置尺寸生成',
      })
    }
    if (normalizedProvider === 'google') {
      const aspect = closestGoogleAspect(
        Number.isFinite(width) && width > 0 ? width : 1,
        Number.isFinite(height) && height > 0 ? height : 1,
      )
      const resolution = ['1K', '2K', '4K'].includes(state?.googleResolution)
        ? state.googleResolution
        : '1K'
      return Object.freeze({
        ...base,
        exact: false,
        aspect,
        resolution,
        specification: `画幅 ${aspect} · 分辨率 ${resolution}`,
        note: '实际像素由 Google 返回',
      })
    }

    const errors = []
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      errors.push('GPT 输出尺寸必须是正整数')
    } else {
      if (
        width < GPT_MIN_OUTPUT_SIZE || width > GPT_MAX_OUTPUT_SIZE ||
        height < GPT_MIN_OUTPUT_SIZE || height > GPT_MAX_OUTPUT_SIZE
      ) {
        errors.push(`GPT 输出尺寸的宽和高都必须在 ${GPT_MIN_OUTPUT_SIZE}–${GPT_MAX_OUTPUT_SIZE} 像素之间`)
      }
      if (width % 16 !== 0 || height % 16 !== 0) {
        errors.push('GPT 输出尺寸的宽和高都必须是 16 的倍数')
      }
      if (Math.max(width, height) / Math.max(1, Math.min(width, height)) > 3) {
        errors.push('GPT 输出尺寸的宽高比不能超过 3:1')
      }
      if (width * height > GPT_MAX_OUTPUT_PIXELS) {
        errors.push(`GPT 输出尺寸不能超过 ${GPT_MAX_OUTPUT_PIXELS.toLocaleString('en-US')} 总像素`)
      }
    }
    const valid = errors.length === 0
    return Object.freeze({
      ...base,
      valid,
      exact: valid,
      error: errors.join('；'),
      specification: valid ? `${width} × ${height}` : '',
      note: valid ? '按设置尺寸生成' : '请修改输出尺寸后再生成',
    })
  }

  function seedField(record, options = {}) {
    const disabled = options.disabled === true
    const input = createElement(record.documentRef, 'input', {
      type: 'number',
      value: record.state.seed,
      min: '0',
      max: '999999999',
      disabled,
      'aria-label': 'Seed',
      'data-novaflow-ui-design-param': 'seed',
      style: {
        width: options.inline ? '45px' : '100%', height: options.inline ? '26px' : '32px', minWidth: '0', borderRadius: '7px',
        border: '1px solid rgba(255,255,255,0.12)', background: '#242424',
        color: '#fff', padding: '0 6px', boxSizing: 'border-box', opacity: disabled ? '0.5' : '1',
      },
    })
    input.value = String(record.state.seed < 0 ? 0 : record.state.seed)
    input.addEventListener('change', () => {
      const value = Math.max(0, Math.min(999999999, Math.round(Number(input.value) || 0)))
      updateState(record, 'seed', value)
    })
    if (!options.inline) return fieldShell(record.documentRef, 'Seed', input)
    return createElement(record.documentRef, 'label', {
      'data-novaflow-ui-design-seed-field': 'inline',
      style: {
        display: 'flex', alignItems: 'center', gap: '4px', minWidth: '0', marginLeft: '0',
        color: 'rgba(255,255,255,0.58)', fontSize: '9px', fontWeight: '750',
      },
    }, [createElement(record.documentRef, 'span', { text: 'Seed' }), input])
  }

  function notifyChange(record, key, value) {
    const callback = record.options.onChange
    if (typeof callback !== 'function') return
    const size = canvasSize(record)
    callback({
      key,
      value,
      provider: record.state.provider,
      mode: MODE,
      canvasSize: size,
      state: record.state,
      snapshot: { ...record.state },
    })
  }

  function notifyOutputSizeChange(record, size, source) {
    const callback = record.options.onOutputSizeChange
    if (typeof callback !== 'function') return
    callback({ width: size.width, height: size.height })
  }

  function setExpanded(record, expanded, notify) {
    if (!record.active) return false
    if (record.variant === 'node') {
      record.expanded = true
      return true
    }
    const next = expanded === true
    const changed = record.expanded !== next
    record.expanded = next
    if (record.variant === 'node') renderFields(record)
    else syncExpanded(record)
    if (changed && notify !== false && typeof record.options.onExpandedChange === 'function') {
      record.options.onExpandedChange(next)
    }
    return next
  }

  function applyOutputSize(record, width, height, source) {
    if (!record.active) return canvasSize(record)
    const current = canvasSize(record)
    const size = {
      width: outputDimension(width, current.width),
      height: outputDimension(height, current.height),
    }
    record.outputSizeOverride = size
    record.customSizeMode = String(source || '').startsWith('custom') || !presetForProviderSize(record.state.provider, size.width, size.height)
    syncCanvasState(record)
    notifyOutputSizeChange(record, size, source)
    renderFields(record)
    return size
  }

  function updateState(record, key, value) {
    if (!record.active) return
    if (key === 'provider') record.state.provider = normalizeProvider(value)
    else if (key === 'randomSeed') {
      record.state.randomSeed = value === true
      if (!record.state.randomSeed && (!Number.isFinite(Number(record.state.seed)) || Number(record.state.seed) < 0)) {
        record.state.seed = 0
      }
    } else record.state[key] = value
    record.state.mode = MODE
    syncCanvasState(record)
    notifyChange(record, key, record.state[key])
    renderFields(record)
  }

  function dynamicParameterNodes(record) {
    const state = record.state
    if (state.provider === 'local') {
      return [
        selectControl(record, 'localEditStrength', '编辑强度', [
          { value: 'faithful', label: '保真' },
          { value: 'enhanced', label: '增强' },
        ], state.localEditStrength),
        createElement(record.documentRef, 'div', {
          'data-novaflow-ui-design-local-switches': '1',
          style: {
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '5px',
            minWidth: '0', alignItems: 'center',
          },
        }, [
          switchField(record, 'randomSeed', '随机种子', state.randomSeed, {
            trailing: seedField(record, { inline: true, disabled: state.randomSeed }),
          }),
          switchField(record, 'nsfw', 'NSFW', state.nsfw),
        ]),
      ]
    }
    if (state.provider === 'gpt') {
      return [selectControl(record, 'gptQualityImg2img', '质量', [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ], state.gptQualityImg2img)]
    }
    return [
      outputField(record, '画幅', state.googleAspectRatioImg2img),
      selectControl(record, 'googleResolution', '分辨率', ['1K', '2K', '4K'], state.googleResolution),
    ]
  }

  function compactSelectControl(record, key, label, values, value, attributeName, onChange) {
    const select = createElement(record.documentRef, 'select', {
      'aria-label': label,
      'data-novaflow-ui-design-select': '1',
      'data-novaflow-ui-design-param': key,
      ...(attributeName ? { [attributeName]: '1' } : {}),
      style: {
        width: '100%', height: '34px', minWidth: '0', borderRadius: '7px',
        border: '1px solid rgba(255,255,255,0.12)', background: '#24282b',
        color: '#fff', padding: '0 9px', boxSizing: 'border-box', cursor: 'pointer',
        fontSize: '11px', fontWeight: '800',
      },
    }, optionNodes(record.documentRef, values, value))
    select.value = String(value)
    select.addEventListener('change', () => {
      if (typeof onChange === 'function') onChange(select)
      else updateState(record, key, String(select.value || ''))
    })
    return select
  }

  function compactChip(record, label, value, attributeName) {
    return createElement(record.documentRef, 'div', {
      ...(attributeName ? { [attributeName]: '1' } : {}),
      title: `${label}：${value}`,
      style: {
        minWidth: '0', height: '30px', display: 'flex', alignItems: 'center', gap: '6px',
        padding: '0 8px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.08)',
        background: '#171a1c', boxSizing: 'border-box', overflow: 'hidden',
      },
    }, [
      createElement(record.documentRef, 'span', {
        text: label,
        style: { flex: '0 0 auto', color: 'rgba(255,255,255,0.46)', fontSize: '9px', fontWeight: '800' },
      }),
      createElement(record.documentRef, 'span', {
        text: value,
        style: { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.88)', fontSize: '10px', fontWeight: '850' },
      }),
    ])
  }

  function compactAccountStatus(record) {
    const source = record.options.accountStatus
    if (source == null || source === false || source === '') return null
    const value = typeof source === 'object' ? source : { label: source }
    const label = String(value.label || value.text || value.status || '').trim()
    if (!label) return null
    const tone = String(value.tone || value.kind || '').toLowerCase()
    const color = tone === 'error' ? '#fecaca' : tone === 'warn' ? '#fde68a' : tone === 'ok' ? '#86efac' : 'rgba(255,255,255,0.62)'
    return createElement(record.documentRef, 'span', {
      'data-novaflow-ui-design-account-status': '1',
      text: label,
      title: label,
      style: {
        flex: '0 1 auto', minWidth: '0', maxWidth: '46%', height: '20px', display: 'inline-flex',
        alignItems: 'center', padding: '0 7px', borderRadius: '999px',
        background: 'rgba(255,255,255,0.055)', color, fontSize: '9px', fontWeight: '850',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box',
      },
    })
  }

  function compactStatusRow(record) {
    const statusText = record.status || record.error
    const statusError = record.statusError || Boolean(record.error)
    const status = createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-generate-status': '1',
      'data-error': statusError ? '1' : '0',
      text: statusText,
      title: statusText,
      style: {
        flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: statusError ? '#fecaca' : 'rgba(255,255,255,0.5)', fontSize: '10px', lineHeight: '20px',
      },
    })
    const account = compactAccountStatus(record)
    const row = createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-node-meta': '1',
      style: {
        display: statusText || account ? 'flex' : 'none', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px', minWidth: '0', minHeight: statusText || account ? '20px' : '0',
      },
    }, [status, account])
    return row
  }

  function compactParameterSummary(record) {
    const state = record.state
    if (state.provider === 'gpt') return `质量 ${String(state.gptQualityImg2img || 'low').toUpperCase()}`
    if (state.provider === 'google') return `分辨率 ${state.googleResolution || '1K'} · 画幅 ${state.googleAspectRatioImg2img}`
    const strength = state.localEditStrength === 'enhanced' ? '增强' : '保真'
    const seed = state.randomSeed ? '随机种子' : `Seed ${Math.max(0, Number(state.seed) || 0)}`
    return `${strength} · ${seed} · NSFW${state.nsfw ? '开' : '关'}`
  }

  function compactOutputSizeRow(record, size) {
    const provider = record.state.provider
    const selectedPreset = !record.customSizeMode && presetForProviderSize(provider, size.width, size.height)
    const values = outputSizePresets(provider).map((item) => ({ value: item.value, label: item.label }))
      .concat({ value: 'custom', label: 'Custom 自定义' })
    const sizeLabel = provider === 'google' ? '构图画布' : '输出尺寸'
    const preset = compactSelectControl(
      record,
      'outputSizePreset',
      sizeLabel,
      values,
      selectedPreset?.value || 'custom',
      'data-novaflow-ui-design-output-size-preset',
      (control) => {
        const value = String(control.value || '')
        if (value === 'custom') {
          record.customSizeMode = true
          renderFields(record)
          return
        }
        const next = outputSizePresets(provider).find((item) => item.value === value)
        if (next) applyOutputSize(record, next.width, next.height, 'preset')
      },
    )
    const orientationButton = (orientation) => {
      const landscape = orientation === 'landscape'
      const active = landscape ? size.width > size.height : size.height > size.width
      const icon = createElement(record.documentRef, 'span', {
        'aria-hidden': 'true',
        style: {
          display: 'block', width: landscape ? '16px' : '10px', height: landscape ? '10px' : '16px',
          border: `1.5px solid ${active ? '#6ee7b7' : 'rgba(255,255,255,0.72)'}`,
          borderRadius: '2px', boxSizing: 'border-box', pointerEvents: 'none',
        },
      })
      const label = landscape ? '横屏' : '竖屏'
      const button = createElement(record.documentRef, 'button', {
        type: 'button',
        title: label,
        'aria-label': label,
        'aria-pressed': active ? 'true' : 'false',
        'data-novaflow-ui-design-output-orientation': orientation,
        style: {
          width: '34px', height: '34px', padding: '0', display: 'grid', placeItems: 'center',
          border: '0', borderLeft: landscape ? '0' : '1px solid rgba(255,255,255,0.1)', borderRadius: '0',
          background: active ? 'rgba(34,183,132,0.15)' : '#292d30',
          color: '#fff', cursor: 'pointer', boxSizing: 'border-box',
        },
      }, [icon])
      button.addEventListener('click', (event) => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        if (size.width === size.height) {
          if (provider === 'gpt') {
            applyOutputSize(record, landscape ? 1536 : 1024, landscape ? 1024 : 1536, `orientation-${orientation}`)
          } else {
            applyOutputSize(record, landscape ? 1920 : 1080, landscape ? 1080 : 1920, `orientation-${orientation}`)
          }
          return
        }
        const longSide = Math.max(size.width, size.height)
        const shortSide = Math.min(size.width, size.height)
        applyOutputSize(
          record,
          landscape ? longSide : shortSide,
          landscape ? shortSide : longSide,
          `orientation-${orientation}`,
        )
      })
      return button
    }
    const orientations = createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-output-orientations': '1',
      style: {
        height: '34px', display: 'grid', gridTemplateColumns: '34px 34px', overflow: 'hidden',
        borderRadius: '7px', border: '1px solid rgba(255,255,255,0.1)', boxSizing: 'border-box',
      },
    }, [orientationButton('landscape'), orientationButton('portrait')])
    return createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-output-size-row': '1',
      style: { minWidth: '0', display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) 70px', gap: '6px', alignItems: 'center' },
    }, [
      createElement(record.documentRef, 'span', {
        'data-novaflow-ui-design-output-size-label': '1',
        text: sizeLabel,
        style: { color: 'rgba(255,255,255,0.66)', fontSize: '9px', fontWeight: '800', whiteSpace: 'nowrap' },
      }),
      preset,
      orientations,
    ])
  }

  function outputContractNotice(record, size) {
    const contract = resolveOutputContract(record.state.provider, size, record.state)
    if (contract.provider !== 'google' && contract.valid) return null
    const error = !contract.valid
    const text = error
      ? contract.error
      : `输出规格：${contract.specification}，${contract.note}`
    return createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-output-contract': contract.provider,
      'data-error': error ? '1' : '0',
      text,
      title: text,
      style: {
        minWidth: '0', padding: '6px 8px', borderRadius: '7px',
        border: `1px solid ${error ? 'rgba(248,113,113,0.34)' : 'rgba(96,165,250,0.2)'}`,
        background: error ? 'rgba(127,29,29,0.2)' : 'rgba(30,64,175,0.12)',
        color: error ? '#fecaca' : '#bfdbfe', fontSize: '9px', fontWeight: error ? '800' : '700',
        lineHeight: '1.45', overflowWrap: 'anywhere', boxSizing: 'border-box',
      },
    })
  }

  function compactDimensionInput(record, axis, value, otherValue) {
    const input = createElement(record.documentRef, 'input', {
      type: 'number',
      value,
      min: String(MIN_OUTPUT_SIZE),
      max: String(MAX_OUTPUT_SIZE),
      'aria-label': axis === 'width' ? '自定义宽度' : '自定义高度',
      'data-novaflow-ui-design-dimension-input': axis,
      style: {
        width: '100%', height: '32px', minWidth: '0', borderRadius: '7px',
        border: '1px solid rgba(255,255,255,0.12)', background: '#24282b', color: '#fff',
        padding: '0 8px', boxSizing: 'border-box', fontSize: '11px',
      },
    })
    input.value = String(value)
    input.addEventListener('change', () => {
      const next = outputDimension(input.value, value)
      if (axis === 'width') applyOutputSize(record, next, otherValue, 'custom-width')
      else applyOutputSize(record, otherValue, next, 'custom-height')
    })
    return createElement(record.documentRef, 'label', {
      style: { minWidth: '0', display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: '5px', alignItems: 'center', color: 'rgba(255,255,255,0.52)', fontSize: '10px', fontWeight: '800' },
    }, [createElement(record.documentRef, 'span', { text: axis === 'width' ? 'W' : 'H' }), input])
  }

  function compactParameterSection(record) {
    const header = createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-node-params-header': '1',
      text: '生成参数',
      style: {
        minWidth: '0', color: 'rgba(255,255,255,0.82)', fontSize: '10px', fontWeight: '850',
      },
    })
    const parameterBody = createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-node-params-body': '1',
      style: {
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '8px', minWidth: '0',
        padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(8,11,14,0.28)', boxSizing: 'border-box',
      },
    }, dynamicParameterNodes(record))
    parameterBody.hidden = false
    return [header, parameterBody]
  }

  function negativePromptSourceLabel(source) {
    if (source === 'assistant') return '助手填写'
    if (source === 'user') return '用户填写'
    return '默认填写'
  }

  function disposePromptMentions(record) {
    const mounted = record.promptMentionsHandle
    record.promptMentionsHandle = null
    record.promptMentionsTextarea = null
    if (!mounted) return
    try {
      if (typeof mounted === 'function') mounted()
      else if (typeof mounted.destroy === 'function') mounted.destroy()
      else if (typeof mounted.unmount === 'function') mounted.unmount()
      else if (typeof mounted.dispose === 'function') mounted.dispose()
    } catch {
      // Mention cleanup is best-effort and must never block the generator redraw.
    }
  }

  function activatePromptMentions(record) {
    const textarea = record.nextPromptTextarea
    record.nextPromptTextarea = null
    const mountMentions = record.options.mountPromptMentions
    if (!textarea || typeof mountMentions !== 'function' || !record.active) return false
    try {
      record.promptMentionsHandle = mountMentions(textarea, {
        state: record.state,
        provider: record.state.provider,
        generatorKey: record.generatorKey,
      }) || null
      record.promptMentionsTextarea = textarea
      return true
    } catch {
      record.promptMentionsHandle = null
      record.promptMentionsTextarea = null
      return false
    }
  }

  function promptTextarea(record, key, label, placeholder, rows) {
    const isNegative = key === 'negativePrompt'
    const textarea = createElement(record.documentRef, 'textarea', {
      'aria-label': label,
      placeholder,
      rows: String(rows),
      'data-novaflow-ui-design-prompt-field': key,
      style: {
        width: '100%', minWidth: '0', minHeight: '88px', resize: record.variant === 'node' ? 'none' : 'vertical',
        padding: '8px 9px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.12)',
        background: '#171a1c', color: '#fff', boxSizing: 'border-box', outline: 'none',
        fontSize: '10px', lineHeight: '1.45', fontFamily: 'inherit',
      },
    })
    textarea.value = String(record.state[key] || '')
    textarea.addEventListener('input', () => {
      if (!record.active) return
      record.state[key] = String(textarea.value || '')
      if (isNegative) {
        record.state.negativePromptSource = 'user'
        record.negativePromptRevision += 1
      } else {
        record.promptRevision += 1
      }
      record.assistantMessage = ''
      record.assistantError = ''
    })
    textarea.addEventListener('change', () => {
      if (!record.active) return
      notifyChange(record, key, record.state[key])
      if (isNegative) renderFields(record)
    })
    return textarea
  }

  function promptAssistantRequirements(record) {
    let value = ''
    try {
      value = typeof record.options.getPromptAssistantRequirements === 'function'
        ? record.options.getPromptAssistantRequirements({ ...record.state })
        : record.options.promptAssistantRequirements
    } catch {
      value = ''
    }
    return String(value || DEFAULT_PROMPT_ASSISTANT_REQUIREMENTS).trim()
  }

  async function runPromptAssistant(record) {
    if (!record.active || record.assistantPending) return false
    const optimizePrompt = root?.electronAPI?.promptAssistantOptimizePrompt
    if (typeof optimizePrompt !== 'function') {
      record.assistantError = '提示词助手仅在 NovaFlow 桌面端可用'
      record.assistantMessage = ''
      renderFields(record)
      return false
    }

    const token = record.assistantToken + 1
    record.assistantToken = token
    record.assistantPending = true
    record.assistantError = ''
    record.assistantMessage = ''
    const recordKey = record.generatorKey
    const promptRevision = record.promptRevision
    const negativePromptRevision = record.negativePromptRevision
    const prompt = String(record.state.prompt || '')
    const negativePrompt = String(record.state.negativePrompt || '')
    renderFields(record)

    try {
      const result = await optimizePrompt({
        prompt,
        currentPrompt: prompt,
        negativePrompt,
        requirements: promptAssistantRequirements(record),
        surface: 'ui-design',
        purpose: 'ui-design-generation',
      })
      if (!record.active || record.assistantToken !== token || record.generatorKey !== recordKey) return false
      if (!result || result.ok === false) throw new Error(result?.error || '提示词助手执行失败')
      const output = result.data && typeof result.data === 'object' ? result.data : result
      const positive = String(output?.positivePrompt || output?.positive_prompt || output?.prompt || '').trim()
      const negative = String(output?.negativePrompt || output?.negative_prompt || '').trim()
      if (!positive) throw new Error('提示词助手未返回设计要求')

      const applied = {}
      if (record.promptRevision === promptRevision) {
        record.state.prompt = positive
        applied.prompt = positive
      }
      const keepUserNegative = record.state.negativePromptSource === 'user'
      if (negative && !keepUserNegative && record.negativePromptRevision === negativePromptRevision) {
        record.state.negativePrompt = negative
        record.state.negativePromptSource = 'assistant'
        applied.negativePrompt = negative
        applied.negativePromptSource = 'assistant'
      }
      if (Object.keys(applied).length) notifyChange(record, 'promptAssistant', applied)
      record.assistantMessage = keepUserNegative
        ? '设计要求已优化；已保留用户填写的负面要求'
        : '提示词助手已完成填写'
      return true
    } catch (error) {
      if (!record.active || record.assistantToken !== token || record.generatorKey !== recordKey) return false
      record.assistantError = String(error?.message || error || '提示词助手执行失败')
      record.assistantMessage = ''
      return false
    } finally {
      if (record.active && record.assistantToken === token && record.generatorKey === recordKey) {
        record.assistantPending = false
        renderFields(record)
      }
    }
  }

  function openDesignAssistant(record, promptTextarea) {
    if (!record.active) return false
    const callback = record.options.onOpenDesignAssistant
    if (typeof callback !== 'function') {
      record.assistantError = '设计助手暂不可用'
      record.assistantMessage = ''
      renderFields(record)
      return false
    }
    const generatorKey = record.generatorKey
    const promptRevision = record.promptRevision
    const negativePromptRevision = record.negativePromptRevision
    const provider = record.state.provider
    const apply = (result) => {
      if (!record.active || record.generatorKey !== generatorKey || !result || typeof result !== 'object') return false
      const applied = {}
      if (Object.prototype.hasOwnProperty.call(result, 'prompt') && record.promptRevision === promptRevision) {
        record.state.prompt = String(result.prompt == null ? '' : result.prompt)
        record.promptRevision += 1
        applied.prompt = record.state.prompt
      }
      if (
        provider === 'local' && record.state.provider === 'local' &&
        Object.prototype.hasOwnProperty.call(result, 'negativePrompt') &&
        record.negativePromptRevision === negativePromptRevision
      ) {
        record.state.negativePrompt = String(result.negativePrompt == null ? '' : result.negativePrompt)
        record.state.negativePromptSource = NEGATIVE_PROMPT_SOURCES.has(result.negativePromptSource)
          ? result.negativePromptSource
          : 'assistant'
        record.negativePromptRevision += 1
        applied.negativePrompt = record.state.negativePrompt
        applied.negativePromptSource = record.state.negativePromptSource
      }
      if (!Object.keys(applied).length) return false
      record.assistantError = ''
      record.assistantMessage = '设计助手已应用'
      notifyChange(record, 'designAssistant', applied)
      renderFields(record)
      return true
    }
    const payload = {
      state: record.state,
      snapshot: { ...record.state },
      provider,
      prompt: String(record.state.prompt || ''),
      negativePrompt: provider === 'local' ? String(record.state.negativePrompt || '') : '',
      promptTextarea,
      generatorKey,
      apply,
    }
    try {
      const result = callback(payload)
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then((value) => {
          if (value && typeof value === 'object') apply(value)
        }).catch((error) => {
          if (!record.active || record.generatorKey !== generatorKey) return
          record.assistantError = String(error?.message || error || '设计助手打开失败')
          record.assistantMessage = ''
          renderFields(record)
        })
      } else if (result && typeof result === 'object') {
        apply(result)
      }
      return true
    } catch (error) {
      if (!record.active || record.generatorKey !== generatorKey) return false
      record.assistantError = String(error?.message || error || '设计助手打开失败')
      record.assistantMessage = ''
      renderFields(record)
      return false
    }
  }

  function promptEditorSection(record) {
    const assistant = createElement(record.documentRef, 'button', {
      type: 'button',
      text: '设计助手',
      'data-novaflow-ui-design-design-assistant': '1',
      style: {
        height: '26px', padding: '0 9px', borderRadius: '6px',
        border: '1px solid rgba(34,197,139,0.34)', background: 'rgba(34,197,139,0.1)',
        color: '#6ee7b7', fontSize: '9px', fontWeight: '850',
        cursor: 'pointer',
      },
    })

    const positive = promptTextarea(
      record,
      'prompt',
      '设计要求',
      '补充视觉风格、配色、材质、层级和交互状态；页面结构由画布自动提供。',
      3,
    )
    record.nextPromptTextarea = positive
    assistant.addEventListener('click', (event) => {
      event?.preventDefault?.()
      event?.stopPropagation?.()
      openDesignAssistant(record, positive)
    })
    const feedback = record.assistantError || record.assistantMessage
    const children = [
      createElement(record.documentRef, 'div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: '0' },
      }, [
        createElement(record.documentRef, 'span', { text: '设计要求', style: { color: 'rgba(255,255,255,0.78)', fontSize: '10px', fontWeight: '850' } }),
        assistant,
      ]),
      positive,
    ]
    if (record.state.provider === 'local') {
      const negative = promptTextarea(
        record,
        'negativePrompt',
        '负面要求',
        '自动填写需要避免的画面问题，可继续修改或清空。',
        2,
      )
      children.push(
        createElement(record.documentRef, 'div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: '0' },
        }, [
          createElement(record.documentRef, 'span', { text: '负面要求（自动填写）', style: { color: 'rgba(255,255,255,0.72)', fontSize: '10px', fontWeight: '800' } }),
          createElement(record.documentRef, 'span', {
            'data-novaflow-ui-design-negative-source': record.state.negativePromptSource,
            text: negativePromptSourceLabel(record.state.negativePromptSource),
            style: { color: 'rgba(255,255,255,0.42)', fontSize: '9px', whiteSpace: 'nowrap' },
          }),
        ]),
        negative,
      )
    }
    children.push(createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-prompt-assistant-status': '1',
      'data-error': record.assistantError ? '1' : '0',
      text: feedback,
      style: {
        display: feedback ? 'block' : 'none', color: record.assistantError ? '#fecaca' : '#86efac',
        fontSize: '9px', lineHeight: '1.4', overflowWrap: 'anywhere',
      },
    }))

    return createElement(record.documentRef, 'section', {
      'data-novaflow-ui-design-prompt-editor': '1',
      style: {
        display: 'grid', gap: '6px', minWidth: '0', padding: '8px', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(8,11,14,0.34)',
      },
    }, children)
  }

  function renderNodeFields(record, size) {
    const outputContract = resolveOutputContract(record.state.provider, size, record.state)
    const generateDisabled = record.pending || record.state.running || !outputContract.valid
    const generate = createElement(record.documentRef, 'button', {
      type: 'button',
      text: record.pending || record.state.running ? '生成中…' : '生成 UI',
      disabled: generateDisabled,
      'data-novaflow-ui-design-node-generate-action': '1',
      style: {
        width: '100%', height: '34px', padding: '0 10px', border: '0', borderRadius: '7px',
        background: '#1ea672', color: '#fff', fontSize: '11px', fontWeight: '900',
        cursor: generateDisabled ? 'default' : 'pointer',
        opacity: generateDisabled ? '0.58' : '1', boxSizing: 'border-box',
      },
    })
    generate.addEventListener('click', (event) => {
      event?.preventDefault?.()
      event?.stopPropagation?.()
      handleGenerate(record)
    })
    const primary = createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-node-primary-row': '1',
      style: { minWidth: '0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '8px', alignItems: 'center' },
    }, [generate])
    const children = [
      compactStatusRow(record),
      primary,
      promptEditorSection(record),
      compactOutputSizeRow(record, size),
    ]
    const contractNotice = outputContractNotice(record, size)
    if (contractNotice) children.push(contractNotice)
    if (record.customSizeMode || !presetForProviderSize(record.state.provider, size.width, size.height)) {
      children.push(createElement(record.documentRef, 'div', {
        'data-novaflow-ui-design-custom-size': '1',
        style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', minWidth: '0' },
      }, [
        compactDimensionInput(record, 'width', size.width, size.height),
        compactDimensionInput(record, 'height', size.height, size.width),
      ]))
    }
    children.push(...compactParameterSection(record))
    record.fields.replaceChildren(...children)
    activatePromptMentions(record)
  }

  function handleGenerate(record) {
    if (!record.active || record.pending || record.state.running || typeof record.options.onGenerate !== 'function') return
    const size = syncCanvasState(record)
    const outputContract = resolveOutputContract(record.state.provider, size, record.state)
    if (!outputContract.valid) {
      record.pending = false
      record.error = outputContract.error
      record.status = outputContract.error
      record.statusError = true
      renderFields(record)
      return
    }
    record.pending = true
    record.error = ''
    record.status = ''
    record.statusError = false
    renderFields(record)
    let value
    try {
      value = record.options.onGenerate({
        state: record.state,
        snapshot: { ...record.state },
        provider: record.state.provider,
        mode: MODE,
        canvasSize: size,
      })
    } catch (error) {
      record.pending = false
      record.error = String(error?.message || error || '生成失败')
      record.status = record.error
      record.statusError = true
      renderFields(record)
      return
    }
    Promise.resolve(value).catch((error) => {
      record.error = String(error?.message || error || '生成失败')
      record.status = record.error
      record.statusError = true
    }).finally(() => {
      if (!record.active) return
      record.pending = false
      renderFields(record)
    })
  }

  function renderFields(record) {
    if (!record.active) return
    disposePromptMentions(record)
    record.nextPromptTextarea = null
    ensureState(record.state)
    const size = syncCanvasState(record)
    if (record.variant === 'node') {
      renderNodeFields(record, size)
      return
    }
    const provider = selectControl(
      record,
      'provider',
      '模型方式',
      PROVIDER_OPTIONS,
      record.state.provider,
      'data-novaflow-ui-design-provider',
    )
    const statusText = record.status || record.error
    const statusError = record.statusError || Boolean(record.error)
    const status = createElement(record.documentRef, 'div', {
      'data-novaflow-ui-design-generate-status': '1',
      'data-error': statusError ? '1' : '0',
      text: statusText,
      style: {
        display: statusText ? 'block' : 'none', color: statusError ? '#fecaca' : 'rgba(255,255,255,0.58)', fontSize: '11px',
        lineHeight: '1.4', overflowWrap: 'anywhere',
      },
    })
    const sizeLabel = record.state.provider === 'google' ? '构图画布' : '输出尺寸'
    const contractNotice = outputContractNotice(record, size)
    record.fields.replaceChildren(...[
      provider,
      promptEditorSection(record),
      outputField(record, sizeLabel, `${size.width} × ${size.height}`, 'data-novaflow-ui-design-canvas-size'),
      contractNotice,
      ...dynamicParameterNodes(record),
      status,
    ].filter(Boolean))
    activatePromptMentions(record)
  }

  function syncExpanded(record) {
    if (record.variant === 'node') {
      record.header.style.display = 'none'
      record.body.hidden = false
      record.body.style.display = 'grid'
      return
    }
    const expanded = record.options.accordion === false ? true : record.expanded
    record.header.style.display = record.options.accordion === false ? 'none' : 'flex'
    record.header.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    record.body.hidden = !expanded
    record.body.style.display = expanded ? 'grid' : 'none'
    record.chevron.textContent = expanded ? '⌃' : '⌄'
  }

  function mountAuth(record) {
    if (record.variant === 'node') return false
    if (record.authMounted) return true
    const auth = root && root.NovaFlowClientAuth
    if (!auth || typeof auth.mount !== 'function') return false
    auth.mount(AUTH_SURFACE_KEY, record.accountSlot)
    record.authMounted = true
    return true
  }

  function mount(options = {}) {
    const host = options.host
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('UI Design Generate host is required')
    const documentRef = host.ownerDocument || root?.document
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('UI Design Generate document is required')
    const requestedVariant = variantOf(options)

    const existing = mountedControls.get(host)
    if (existing?.active) {
      if (existing.variant !== requestedVariant) {
        existing.handle.destroy()
        return mount(options)
      }
      const nextGeneratorKey = generatorRecordKey(options, host)
      if ((options.state && options.state !== existing.state) || nextGeneratorKey !== existing.generatorKey) {
        invalidatePromptAssistant(existing)
      }
      existing.options = options
      existing.state = ensureState(options.state || existing.state)
      existing.generatorKey = nextGeneratorKey
      if (existing.variant !== 'node' && Object.prototype.hasOwnProperty.call(options, 'expanded')) {
        existing.expanded = options.expanded === true
      }
      existing.outputSizeOverride = null
      const nextSize = canvasSize(existing)
      existing.customSizeMode = !presetForSize(nextSize.width, nextSize.height)
      mountAuth(existing)
      syncExpanded(existing)
      renderFields(existing)
      return existing.handle
    }

    const state = ensureState(options.state)
    const section = createElement(documentRef, 'section', {
      'data-novaflow-ui-design-generate-tool': '1',
      'data-novaflow-ui-design-generate-variant': requestedVariant,
      style: { display: 'grid', gap: '0', width: '100%', minWidth: '0' },
    })
    const title = createElement(documentRef, 'span', { text: '模式选择' })
    const chevron = createElement(documentRef, 'span', { text: '⌄', 'aria-hidden': 'true' })
    const header = createElement(documentRef, 'button', {
      type: 'button',
      'data-novaflow-ui-design-generate-toggle': '1',
      style: {
        width: '100%', height: '38px', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 10px', border: '0', borderRadius: '8px', background: '#303030',
        color: '#fff', fontSize: '12px', fontWeight: '900', cursor: 'pointer',
      },
    }, [title, chevron])
    const accountSlot = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-account-slot': '1',
      style: { minWidth: '0', width: '100%' },
    })
    const fields = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-generate-fields': '1',
      style: { display: 'grid', gap: requestedVariant === 'node' ? '6px' : '8px', minWidth: '0', width: '100%' },
    })
    const body = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-generate-body': '1',
      style: {
        gap: requestedVariant === 'node' ? '6px' : '8px', minWidth: '0', width: '100%',
        padding: requestedVariant === 'node' ? '10px 12px 12px' : '8px 0 0',
        boxSizing: 'border-box',
      },
    }, requestedVariant === 'node' ? [fields] : [accountSlot, fields])
    section.appendChild(header)
    section.appendChild(body)
    host.replaceChildren(section)

    const record = {
      host,
      documentRef,
      options,
      variant: requestedVariant,
      state,
      section,
      header,
      chevron,
      body,
      accountSlot,
      fields,
      expanded: requestedVariant === 'node' || options.expanded === true,
      customSizeMode: false,
      outputSizeOverride: null,
      pending: false,
      error: '',
      status: '',
      statusError: false,
      generatorKey: generatorRecordKey(options, host),
      assistantToken: 0,
      assistantPending: false,
      assistantError: '',
      assistantMessage: '',
      promptRevision: 0,
      negativePromptRevision: 0,
      promptMentionsHandle: null,
      promptMentionsTextarea: null,
      nextPromptTextarea: null,
      authMounted: false,
      active: true,
      handle: null,
    }
    const initialSize = canvasSize(record)
    record.customSizeMode = !presetForSize(initialSize.width, initialSize.height)
    header.addEventListener('click', () => {
      if (!record.active || record.options.accordion === false) return
      setExpanded(record, !record.expanded, true)
    })

    record.handle = Object.freeze({
      refresh() {
        if (!record.active) return false
        record.outputSizeOverride = null
        mountAuth(record)
        renderFields(record)
        syncExpanded(record)
        return true
      },
      setExpanded(expanded) {
        if (!record.active) return false
        return setExpanded(record, expanded, true)
      },
      open() {
        if (!record.active) return false
        return setExpanded(record, true, true)
      },
      update(nextState) {
        if (!record.active) return false
        if (nextState && typeof nextState === 'object') {
          if (nextState !== record.state) invalidatePromptAssistant(record)
          record.state = ensureState(nextState)
        }
        record.outputSizeOverride = null
        const nextSize = canvasSize(record)
        record.customSizeMode = !presetForSize(nextSize.width, nextSize.height)
        mountAuth(record)
        renderFields(record)
        syncExpanded(record)
        return { ...record.state, mode: MODE }
      },
      setStatus(message, statusOptions = {}) {
        if (!record.active) return false
        record.status = String(message == null ? '' : message)
        record.statusError = statusOptions?.error === true
        record.error = record.statusError ? record.status : ''
        if (Object.prototype.hasOwnProperty.call(statusOptions || {}, 'running')) {
          record.state.running = statusOptions.running === true
        }
        renderFields(record)
        return true
      },
      getState() {
        syncCanvasState(record)
        return { ...record.state, mode: MODE }
      },
      destroy() {
        if (!record.active) return
        invalidatePromptAssistant(record)
        disposePromptMentions(record)
        record.active = false
        mountedControls.delete(host)
        if (record.authMounted) root?.NovaFlowClientAuth?.unmount?.(AUTH_SURFACE_KEY)
        record.authMounted = false
        record.section.remove?.()
      },
    })
    mountedControls.set(host, record)
    mountAuth(record)
    syncExpanded(record)
    renderFields(record)
    return record.handle
  }

  function ownsSelect(select) {
    return Boolean(
      select &&
      String(select.tagName || '').toUpperCase() === 'SELECT' &&
      select.getAttribute?.('data-novaflow-ui-design-select') === '1'
    )
  }

  return Object.freeze({
    MODE,
    AUTH_SURFACE_KEY,
    PROVIDER_OPTIONS,
    OUTPUT_SIZE_PRESETS,
    GPT_OUTPUT_SIZE_PRESETS,
    DEFAULT_UI_NEGATIVE_PROMPT,
    resolveOutputContract,
    mount,
    ownsSelect,
  })
})

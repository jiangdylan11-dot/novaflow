(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignInspectorTool = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const REFERENCE_ROLES = Object.freeze([
    ['layout', '布局参考'],
    ['style', '风格参考'],
    ['character', '角色参考'],
    ['subject', '内容参考'],
    ['asset', '素材参考'],
    ['material', '材质参考'],
    ['color', '色彩参考'],
    ['reference', '普通参考'],
  ])

  function style(node, values) {
    if (node && node.style && values) Object.assign(node.style, values)
    return node
  }

  function append(parent, children) {
    const list = Array.isArray(children) ? children : [children]
    list.filter(Boolean).forEach(function (child) { parent.appendChild(child) })
    return parent
  }

  function createElement(documentRef, tagName, attributes, children) {
    const node = documentRef.createElement(tagName)
    Object.entries(attributes || {}).forEach(function (entry) {
      const name = entry[0]
      const value = entry[1]
      if (name === 'style') style(node, value)
      else if (name === 'text') node.textContent = String(value == null ? '' : value)
      else if (name in node && name !== 'list') node[name] = value
      else if (value != null) node.setAttribute(name, String(value))
    })
    return append(node, children || [])
  }

  function legacySelection(options) {
    const project = typeof options.getProject === 'function' ? options.getProject() : null
    const selectedId = String(typeof options.getSelectedId === 'function' ? options.getSelectedId() || '' : '')
    const blocks = Array.isArray(project && project.blocks) ? project.blocks : []
    const block = blocks.find(function (item) { return item && String(item.id || '') === selectedId }) || null
    return block ? { kind: 'block', block: block, blockId: block.id, nodeId: '' } : null
  }

  function currentSelection(options) {
    if (typeof options.getSelection === 'function') {
      const value = options.getSelection()
      if (value && typeof value === 'object') return value
    }
    return legacySelection(options)
  }

  function mount(options) {
    options = options || {}
    const host = options.host
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('UI Design inspector host is required')
    const documentRef = host.ownerDocument || (root && root.document)
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('UI Design inspector document is required')
    let active = true
    const shell = createElement(documentRef, 'section', {
      'data-novaflow-ui-design-inspector': '1',
      style: {
        display: 'grid',
        gap: '10px',
        width: '100%',
        minWidth: '0',
        padding: options.compact ? '0' : '11px',
        textAlign: 'left',
        boxSizing: 'border-box',
        color: '#f8fafc',
      },
    })
    host.replaceChildren(shell)

    function emitPatch(selection, patch) {
      if (!active || !selection) return
      if (typeof options.onPatchSelection === 'function') {
        options.onPatchSelection(selection, patch)
        return
      }
      if (selection.blockId && typeof options.onPatch === 'function') options.onPatch(selection.blockId, patch)
    }

    function field(labelText, value, config) {
      config = config || {}
      const label = createElement(documentRef, 'label', {
        style: { display: 'grid', gap: '5px', minWidth: '0', ...(options.compact && !config.multiline ? { gridTemplateColumns: (['x', 'y', 'width', 'height'].includes(config.key) ? '24px' : '32px') + ' minmax(0,1fr)', alignItems: 'center' } : {}) },
      })
      label.appendChild(createElement(documentRef, 'span', {
        text: labelText,
        style: { fontSize: '11px', color: 'rgba(230,230,230,0.66)', fontWeight: '750' },
      }))
      const input = createElement(documentRef, config.multiline ? 'textarea' : 'input', {
        'data-novaflow-ui-design-inspector-field': config.key,
        'aria-label': labelText,
        style: {
          width: '100%',
          minWidth: '0',
          minHeight: config.multiline ? '64px' : '32px',
          resize: config.multiline ? 'vertical' : 'none',
          border: '1px solid rgba(255,255,255,0.11)',
          borderRadius: '7px',
          background: '#262626',
          color: '#fff',
          padding: config.multiline ? '7px 8px' : '0 8px',
          boxSizing: 'border-box',
          font: 'inherit',
          fontSize: '11px',
          outline: '0',
        },
      })
      input.value = value == null ? '' : String(value)
      let committedValue = input.value
      function commitValue() {
        const nextValue = String(input.value || '')
        if (nextValue === committedValue) return
        committedValue = nextValue
        emitPatch(config.selection, config.toPatch ? config.toPatch(nextValue) : config.nodeField
          ? { title: nextValue }
          : { [config.key]: nextValue })
      }
      input.addEventListener('change', commitValue)
      input.addEventListener('blur', commitValue)
      label.appendChild(input)
      return label
    }

    function selectField(labelText, value, entries, config) {
      const select = createElement(documentRef, 'select', {
        'data-novaflow-ui-design-inspector-field': config.key,
        'aria-label': labelText,
        style: {
          width: '100%',
          height: '32px',
          border: '1px solid rgba(255,255,255,0.11)',
          borderRadius: '7px',
          background: '#262626',
          color: '#fff',
          padding: '0 8px',
          boxSizing: 'border-box',
          fontSize: '11px',
        },
      })
      entries.forEach(function (entry) {
        const option = createElement(documentRef, 'option', { value: entry[0], text: entry[1] })
        option.value = entry[0]
        if (entry[0] === value) option.setAttribute('selected', 'selected')
        select.appendChild(option)
      })
      select.value = value
      select.addEventListener('change', function () {
        emitPatch(config.selection, { [config.key]: String(select.value || '') })
      })
      return createElement(documentRef, 'label', {
        style: { display: 'grid', gap: '5px', minWidth: '0' },
      }, [
        createElement(documentRef, 'span', {
          text: labelText,
          style: { fontSize: '11px', color: 'rgba(230,230,230,0.66)', fontWeight: '750' },
        }),
        select,
      ])
    }

    function action(label, attribute, callback, tone) {
      const compactDanger = options.compact && tone === 'danger'
      const button = createElement(documentRef, 'button', {
        type: 'button',
        text: label,
        [attribute]: '1',
        style: {
          width: '100%',
          minHeight: '33px',
          borderRadius: '7px',
          border: compactDanger ? '1px solid #343434' : tone === 'danger' ? '1px solid rgba(239,68,68,0.38)' : '1px solid rgba(255,255,255,0.1)',
          background: compactDanger ? '#262626' : tone === 'primary' ? '#1d7658' : tone === 'danger' ? 'rgba(127,29,29,0.18)' : '#292929',
          color: compactDanger ? '#bdbdbd' : tone === 'danger' ? '#fecaca' : '#f8fafc',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: '600',
        },
      })
      if (compactDanger) {
        const updateTone = function () {
          const emphasized = button.matches(':hover, :focus-visible')
          style(button, { background: emphasized ? '#2e2e2e' : '#262626', color: emphasized ? '#e6aaaa' : '#bdbdbd' })
        }
        for (const event of ['mouseenter', 'mouseleave', 'focus', 'blur']) button.addEventListener(event, updateTone)
      }
      button.addEventListener('click', function () {
        if (active && typeof callback === 'function') callback()
      })
      return button
    }

    function heading(title, subtitle) {
      shell.appendChild(createElement(documentRef, 'div', {
        text: title,
        style: { fontSize: '13px', lineHeight: '20px', fontWeight: '850', color: '#fff' },
      }))
      if (subtitle) {
        shell.appendChild(createElement(documentRef, 'div', {
          text: subtitle,
          style: { marginTop: '-6px', color: 'rgba(208,208,208,0.52)', fontSize: '11px', lineHeight: '1.45' },
        }))
      }
    }

    function renderBlock(selection) {
      const block = selection.block
      heading('布局块', '在中央画板拖动调整位置和大小')
      shell.appendChild(field('名称', block.name, { selection: selection, key: 'name' }))
      const geometry = createElement(documentRef, 'div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } })
      for (const [key, label] of [['x', 'X'], ['y', 'Y'], ['width', '宽度'], ['height', '高度']]) {
        geometry.appendChild(field(label, block[key], { selection, key }))
      }
      shell.appendChild(geometry)
      // Read both legacy fields; save the combined text once so removed requirements cannot reappear.
      const description = [...new Set([block.purpose, block.requirements].map(value => String(value || '').trim()).filter(Boolean))].join('\n')
      shell.appendChild(field('模块说明', description, {
        selection: selection, key: 'purpose', multiline: true,
        toPatch: value => ({ purpose: value, requirements: '' }),
      }))
      shell.appendChild(action('删除布局块', 'data-novaflow-ui-design-inspector-remove', function () {
        if (typeof options.onRemoveSelection === 'function') options.onRemoveSelection(selection)
        else if (typeof options.onRemove === 'function') options.onRemove(block.id)
      }, 'danger'))
    }

    function renderReference(selection) {
      const node = selection.node
      const data = node.data || {}
      heading('参考图', '连接到生成器后，可通过参考作用和 @引用控制其用途')
      shell.appendChild(field('节点名称', node.title, { selection: selection, key: 'title', nodeField: true }))
      shell.appendChild(selectField('参考作用', String(data.role || 'reference'), REFERENCE_ROLES, { selection: selection, key: 'role' }))
      shell.appendChild(action('删除参考图节点', 'data-novaflow-ui-design-inspector-remove', function () {
        if (typeof options.onRemoveSelection === 'function') options.onRemoveSelection(selection)
      }, 'danger'))
    }

    function renderLayout(selection) {
      const node = selection.node
      const data = node.data || {}
      const blocks = Array.isArray(data.blocks) ? data.blocks : []
      heading('页面结构', blocks.length + ' 个布局块 · 只用于控制构图，不会作为标注输出')
      shell.appendChild(field('节点名称', node.title, { selection: selection, key: 'title', nodeField: true }))
      shell.appendChild(field('页面目标', data.description, { selection: selection, key: 'description', multiline: true }))
      shell.appendChild(action('添加布局块', 'data-novaflow-ui-design-add-block', function () {
        if (typeof options.onActivateRegionTool === 'function') options.onActivateRegionTool(selection)
      }, 'primary'))
      shell.appendChild(action('删除页面结构节点', 'data-novaflow-ui-design-inspector-remove', function () {
        if (typeof options.onRemoveSelection === 'function') options.onRemoveSelection(selection)
      }, 'danger'))
    }

    function renderGenerator(selection) {
      heading('UI 生成器', '生成参数与生成操作均在画布中的生成器节点内完成')
      shell.appendChild(action('删除生成器节点', 'data-novaflow-ui-design-inspector-remove', function () {
        if (typeof options.onRemoveSelection === 'function') options.onRemoveSelection(selection)
      }, 'danger'))
    }

    function renderResult(selection) {
      heading('生成结果', '结果已进入公共资源，可继续设为生成器的修改底图')
      shell.appendChild(action('设为修改底图', 'data-novaflow-ui-design-result-iterate', function () {
        if (typeof options.onUseResultAsReference === 'function') options.onUseResultAsReference(selection)
      }, 'primary'))
      shell.appendChild(action('移除结果节点', 'data-novaflow-ui-design-inspector-remove', function () {
        if (typeof options.onRemoveSelection === 'function') options.onRemoveSelection(selection)
      }, 'danger'))
    }

    function render() {
      if (!active) return false
      const selection = currentSelection(options)
      shell.replaceChildren()
      if (!selection) {
        heading('布局设计')
        shell.appendChild(createElement(documentRef, 'div', {
          text: '点击画板上的模块编辑属性，或添加一个新模块。',
          'data-novaflow-ui-design-inspector-empty': '1',
          style: {
            padding: '12px',
            border: '1px dashed rgba(255,255,255,0.14)',
            borderRadius: '8px',
            color: 'rgba(208,208,208,0.62)',
            fontSize: '11px',
            lineHeight: '1.65',
          },
        }))
        return true
      }
      if (selection.kind === 'block' && selection.block) renderBlock(selection)
      else if (selection.kind === 'node' && selection.node && selection.node.type === 'reference') renderReference(selection)
      else if (selection.kind === 'node' && selection.node && selection.node.type === 'layout') renderLayout(selection)
      else if (selection.kind === 'node' && selection.node && selection.node.type === 'generator') renderGenerator(selection)
      else if (selection.kind === 'node' && selection.node && selection.node.type === 'result') renderResult(selection)
      else {
        heading('连接')
        shell.appendChild(createElement(documentRef, 'div', {
          text: '选择节点端口可重新建立工作流连接。',
          style: { color: 'rgba(208,208,208,0.62)', fontSize: '11px', lineHeight: '1.6' },
        }))
      }
      return true
    }

    render()
    return Object.freeze({
      update: render,
      destroy: function () {
        if (!active) return
        active = false
        if (shell.parentElement === host) shell.remove()
      },
    })
  }

  return Object.freeze({ mount: mount })
})

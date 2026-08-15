const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const toolPath = path.resolve(__dirname, '../../particle-editor/ui-design-mode.tool.js')
const accordionPath = path.resolve(__dirname, '../../particle-editor/left-panel-accordion.helper.js')

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.parentElement = null
    this.attributes = new Map()
    this.listeners = new Map()
    this.style = {}
    this.textContent = ''
    this.value = ''
    this.disabled = false
    this.className = ''
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  removeAttribute(name) { this.attributes.delete(name) }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null })
    this.children = []
    children.forEach((child) => this.appendChild(child))
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) || []
    list.push(handler)
    this.listeners.set(type, list)
  }

  dispatchEvent(event) {
    event.currentTarget = this
    event.target = this
    ;(this.listeners.get(event.type) || []).forEach((handler) => handler(event))
  }

  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this) }
}

function walk(root) {
  const output = []
  const visit = (node) => {
    output.push(node)
    node.children.forEach(visit)
  }
  visit(root)
  return output
}

function findByAttr(root, name, value = null) {
  return walk(root).find((node) => {
    const current = node.getAttribute?.(name)
    return value === null ? current !== null : current === String(value)
  }) || null
}

test('UI Mode owns account and edits the current generator provider without creating global model state', () => {
  const previousAuth = globalThis.NovaFlowClientAuth
  const previousGenerateTool = globalThis.NovaFlowUiDesignGenerateTool
  const previousModeTool = globalThis.NovaFlowUiDesignModeTool
  const previousAccordion = globalThis.NovaFlowLeftPanelAccordion
  const authMounts = []
  const authUnmounts = []
  globalThis.NovaFlowClientAuth = {
    mount(key, host) { authMounts.push({ key, host }) },
    unmount(key) { authUnmounts.push(key) },
  }
  globalThis.NovaFlowUiDesignGenerateTool = {
    PROVIDER_OPTIONS: [
      { value: 'local', label: '本地模型' },
      { value: 'gpt', label: 'GPT' },
      { value: 'google', label: 'Google' },
    ],
  }
  const resolvedToolPath = require.resolve(toolPath)
  const resolvedAccordionPath = require.resolve(accordionPath)
  delete require.cache[resolvedAccordionPath]
  require(resolvedAccordionPath)
  delete require.cache[resolvedToolPath]
  require(resolvedToolPath)
  const tool = globalThis.NovaFlowUiDesignModeTool
  const document = new FakeDocument()
  const host = document.createElement('div')
  let context = { id: 'generator-a', title: 'UI 生成器 A', provider: 'local' }
  const changes = []
  const handle = tool.mount({
    host,
    getContext: () => context,
    onProviderChange(provider, current) {
      changes.push({ provider, id: current.id })
      context = { ...context, provider }
    },
  })

  const header = findByAttr(host, 'data-novaflow-ui-design-mode-toggle', '1')
  const body = findByAttr(host, 'data-novaflow-ui-design-mode-body', '1')
  const select = findByAttr(host, 'data-novaflow-ui-design-mode-provider', '1')
  const target = findByAttr(host, 'data-novaflow-ui-design-mode-target', '1')
  const section = findByAttr(host, 'data-novaflow-ui-design-mode-tool', '1')
  assert.equal(section.getAttribute('data-novaflow-left-accordion-panel'), '1')
  const icon = walk(section).find((node) => node.className === 'fas fa-magic')
  const chevron = walk(section).find((node) => node.className === 'fas fa-chevron-right')
  assert.equal(header.getAttribute('aria-expanded'), 'false')
  assert.equal(section.getAttribute('data-open'), '0')
  assert.equal(body.style.display, 'none')
  assert.equal(header.style.height, '36px')
  assert.equal(header.style.padding, '0 12px')
  assert.equal(header.style.fontSize, '13px')
  assert.equal(header.style.fontWeight, '400')
  assert.equal(header.style.background, '#2f2f2f')
  assert.equal(body.style.padding, '6px 12px 8px')
  assert.equal(body.style.gap, '6px')
  assert.equal(body.style.marginTop, '0')
  assert.equal(body.style.marginBottom, '0')
  assert.ok(icon, 'Mode should use the shared magic icon')
  assert.ok(chevron, 'collapsed Mode should use the shared FontAwesome right chevron')
  assert.equal(authMounts.length, 0, 'collapsed Mode should defer account mounting')
  assert.deepEqual(select.children.map((option) => [option.value, option.textContent]), [
    ['local', '本地模型'],
    ['gpt', 'GPT'],
    ['google', 'Google'],
  ])
  assert.equal(select.value, 'local')
  assert.equal(target.textContent, '当前目标：UI 生成器 A')

  header.dispatchEvent({ type: 'click' })
  assert.equal(header.getAttribute('aria-expanded'), 'true')
  assert.equal(section.getAttribute('data-open'), '1')
  assert.equal(body.style.display, 'grid')
  assert.equal(header.style.borderRadius, '8px 8px 0 0')
  assert.equal(chevron.className, 'fas fa-chevron-down')
  assert.equal(authMounts.length, 1)
  assert.equal(authMounts[0].key, 'ui-design')

  select.value = 'gpt'
  select.dispatchEvent({ type: 'change' })
  assert.deepEqual(changes, [{ provider: 'gpt', id: 'generator-a' }])
  assert.equal(select.value, 'gpt')

  context = { id: 'generator-b', title: 'UI 生成器 B', provider: 'google' }
  handle.update()
  assert.equal(select.value, 'google')
  assert.equal(target.textContent, '当前目标：UI 生成器 B')

  context = {}
  handle.update()
  assert.equal(select.disabled, true)
  assert.equal(target.textContent, '请先添加 UI 生成器')

  handle.destroy()
  assert.deepEqual(authUnmounts, ['ui-design'])
  globalThis.NovaFlowClientAuth = previousAuth
  globalThis.NovaFlowUiDesignGenerateTool = previousGenerateTool
  globalThis.NovaFlowUiDesignModeTool = previousModeTool
  globalThis.NovaFlowLeftPanelAccordion = previousAccordion
})

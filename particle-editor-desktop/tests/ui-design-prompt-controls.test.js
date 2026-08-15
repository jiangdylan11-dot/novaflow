const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const toolPath = path.resolve(__dirname, '../../particle-editor/ui-design-generate.tool.js')

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.attributes = new Map()
    this.listeners = new Map()
    this.parentElement = null
    this.style = {}
    this.textContent = ''
    this.value = ''
    this.type = ''
    this.checked = false
    this.disabled = false
    this.hidden = false
  }

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

  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }

  setAttribute(name, value) {
    const key = String(name)
    const text = String(value)
    this.attributes.set(key, text)
    if (key === 'value') this.value = text
    if (key === 'type') this.type = text
    if (key === 'disabled') this.disabled = true
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event) {
    event.target = event.target || this
    event.currentTarget = this
    event.preventDefault = event.preventDefault || (() => {})
    event.stopPropagation = event.stopPropagation || (() => {})
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event)
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this)
  }
}

function walk(root) {
  const nodes = []
  const visit = (node) => {
    if (!node) return
    nodes.push(node)
    node.children.forEach(visit)
  }
  visit(root)
  return nodes
}

function findByAttr(root, name, value = null) {
  return walk(root).find((node) => {
    const current = node.getAttribute?.(name)
    return value === null ? current !== null : current === String(value)
  }) || null
}

function freshTool(electronAPI = {}) {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    electronAPI,
    NovaFlowArtGenerateModels: {
      normalizeProvider(value) {
        return value === 'gpt' || value === 'google' ? value : 'local'
      },
    },
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(toolPath, 'utf8'), context, { filename: toolPath })
  return context.module.exports
}

test('UI generator only shows negative requirements for local and preserves a user clear across provider changes', () => {
  const tool = freshTool()
  const document = new FakeDocument()
  const host = document.createElement('div')
  host.setAttribute('data-novaflow-ui-design-generator-controls', 'generator-a')
  const state = { provider: 'local' }
  const changes = []
  const handle = tool.mount({
    host,
    variant: 'node',
    state,
    getCanvasSize: () => ({ width: 1920, height: 1080 }),
    onChange(change) { changes.push(change) },
  })

  const initial = handle.getState()
  assert.equal(initial.prompt, '')
  assert.equal(initial.randomSeed, true)
  assert.equal(initial.seed, 0)
  assert.equal(initial.negativePrompt, tool.DEFAULT_UI_NEGATIVE_PROMPT)
  assert.equal(initial.negativePromptSource, 'default')
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-provider'), null, 'node model selection belongs in the left Mode panel')
  assert.ok(findByAttr(host, 'data-novaflow-ui-design-node-generate-action', '1'))
  assert.ok(findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'prompt'))

  const negative = findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'negativePrompt')
  negative.value = ''
  negative.dispatchEvent({ type: 'input' })
  negative.dispatchEvent({ type: 'change' })
  assert.equal(handle.getState().negativePrompt, '')
  assert.equal(handle.getState().negativePromptSource, 'user')
  assert.equal(changes.at(-1).snapshot.negativePromptSource, 'user')
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-negative-source', 'user').textContent, '用户填写')

  handle.update({ ...handle.getState(), provider: 'gpt' })
  assert.equal(handle.getState().negativePrompt, '', 'provider changes must not restore a user-cleared value')
  assert.equal(handle.getState().negativePromptSource, 'user')
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'negativePrompt'), null)
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-negative-source'), null)

  handle.update({ ...handle.getState(), provider: 'google' })
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'negativePrompt'), null)

  handle.update({ ...handle.getState(), provider: 'local' })
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'negativePrompt').value, '')
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-negative-source', 'user').textContent, '用户填写')
})

test('design assistant opens through the dedicated callback and applies revision-safe results', () => {
  const tool = freshTool()
  const document = new FakeDocument()
  const host = document.createElement('div')
  host.setAttribute('data-novaflow-ui-design-generator-controls', 'generator-b')
  const state = { provider: 'local', prompt: '暗色游戏商城' }
  const changes = []
  const openings = []
  const handle = tool.mount({
    host,
    variant: 'node',
    state,
    getCanvasSize: () => ({ width: 1280, height: 720 }),
    onChange(change) { changes.push(change) },
    onOpenDesignAssistant(payload) { openings.push(payload) },
  })

  const assistant = findByAttr(host, 'data-novaflow-ui-design-design-assistant', '1')
  assert.equal(assistant.textContent, '设计助手')
  assert.equal(findByAttr(host, 'data-novaflow-ui-design-prompt-assistant'), null)
  assistant.dispatchEvent({ type: 'click' })
  assert.equal(openings.length, 1)
  assert.equal(openings[0].provider, 'local')
  assert.equal(openings[0].prompt, '暗色游戏商城')
  assert.equal(openings[0].negativePrompt, tool.DEFAULT_UI_NEGATIVE_PROMPT)
  assert.equal(openings[0].promptTextarea, findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'prompt'))
  assert.equal(openings[0].apply({
    prompt: '暗色奇幻游戏商城，金属与玻璃材质，清晰信息层级',
    negativePrompt: '模糊，布局混乱，文字错乱，元素重叠',
  }), true)
  assert.equal(handle.getState().prompt, '暗色奇幻游戏商城，金属与玻璃材质，清晰信息层级')
  assert.equal(handle.getState().negativePrompt, '模糊，布局混乱，文字错乱，元素重叠')
  assert.equal(handle.getState().negativePromptSource, 'assistant')
  assert.equal(changes.at(-1).key, 'designAssistant')

  findByAttr(host, 'data-novaflow-ui-design-design-assistant', '1').dispatchEvent({ type: 'click' })
  const staleOpening = openings[1]
  const prompt = findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'prompt')
  prompt.value = '用户在助手打开后继续编辑'
  prompt.dispatchEvent({ type: 'input' })
  const negative = findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'negativePrompt')
  negative.value = '用户自己的负面要求'
  negative.dispatchEvent({ type: 'input' })
  assert.equal(staleOpening.apply({ prompt: '过期设计要求', negativePrompt: '过期负面要求' }), false)
  assert.equal(handle.getState().prompt, '用户在助手打开后继续编辑')
  assert.equal(handle.getState().negativePrompt, '用户自己的负面要求')
  assert.equal(handle.getState().negativePromptSource, 'user')
})

test('prompt mentions mount on the positive textarea and cleanly remount across redraw and destroy', () => {
  const tool = freshTool()
  const document = new FakeDocument()
  const host = document.createElement('div')
  host.setAttribute('data-novaflow-ui-design-generator-controls', 'generator-c')
  const mounts = []
  const destroyed = []
  const handle = tool.mount({
    host,
    variant: 'node',
    state: { provider: 'local', prompt: '@角色参考 设计商城界面' },
    getCanvasSize: () => ({ width: 1024, height: 1024 }),
    mountPromptMentions(textarea, context) {
      const index = mounts.length
      mounts.push({ textarea, context })
      return { destroy() { destroyed.push(index) } }
    },
  })

  assert.equal(mounts.length, 1)
  assert.equal(mounts[0].textarea, findByAttr(host, 'data-novaflow-ui-design-prompt-field', 'prompt'))
  assert.equal(mounts[0].context.provider, 'local')
  assert.equal(mounts[0].context.generatorKey, 'generator-c')

  handle.update({ ...handle.getState(), provider: 'gpt' })
  assert.deepEqual(destroyed, [0])
  assert.equal(mounts.length, 2)
  assert.equal(mounts[1].context.provider, 'gpt')
  assert.notEqual(mounts[1].textarea, mounts[0].textarea)

  handle.refresh()
  assert.deepEqual(destroyed, [0, 1])
  assert.equal(mounts.length, 3)
  handle.destroy()
  assert.deepEqual(destroyed, [0, 1, 2])
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../../renderer/novaflow-brand-runtime.js'), 'utf8')
const fn = name => source.match(new RegExp('^  function ' + name + '\\([^]*?^  \\}', 'm'))[0]

function fixture() {
  class Element {
    constructor() { this.attrs = new Map(); this.isConnected = true }
    getAttribute(key) { return this.attrs.get(key) ?? null }
    setAttribute(key, value) { this.attrs.set(key, value) }
    hasAttribute(key) { return this.attrs.has(key) }
  }
  class Input extends Element {
    constructor() { super(); this.value = 'generated'; this.events = {}; this.placeholder = '' }
    addEventListener(type, callback) { this.events[type] = callback }
    closest() { return root }
  }
  const root = new Element(), input = new Input(), timers = []
  const c = vm.createContext({ HTMLElement: Element, HTMLInputElement: Input, Date,
    window: { setTimeout: callback => timers.push(callback) },
    findNovaflowExportNameInput: () => input,
    setNovaflowInputValue: (field, value) => { field.value = value },
    setAttributeIfChanged: (element, key, value) => element.setAttribute(key, value),
    syncNovaflowExportModalActionButtons() {},
  })
  vm.runInContext(['sanitizeNovaflowManualExportName', 'getNovaflowProjectExportName', 'getNovaflowExportDialogManualName',
    'clearNovaflowExportNameInputValue', 'scheduleNovaflowExportNameInputClearLoop', 'markNovaflowExportNameInputUserIntent',
    'hasNovaflowExportNameInputUserIntent', 'normalizeNovaflowExportNameInput'].map(fn).join('\n'), c)
  return { root, input, c, timers, name: () => c.getNovaflowExportDialogManualName(root), normalize: () => c.normalizeNovaflowExportNameInput(root) }
}

test('independent exports accept the project name and pending manual-name clearing cannot erase it', () => {
  const f = fixture()
  f.normalize()
  assert.equal(f.input.value, '')
  f.root.setAttribute('data-nf-project-auto-name', 'skeleton')
  f.input.value = 'skeleton'
  for (const timer of f.timers) timer()
  for (let i = 0; i < 5; i++) f.normalize()
  assert.equal(f.input.value, 'skeleton')
  assert.equal(f.name(), 'skeleton')
})

test('merged exports accept their default name, keep edits, and treat a cleared name as empty', () => {
  const f = fixture()
  f.root.setAttribute('data-nf-project-auto-name', 'skeleton_合并')
  f.input.value = 'skeleton_合并'
  f.normalize()
  assert.equal(f.name(), 'skeleton_合并')
  f.input.value = '自定义合并'
  f.normalize()
  assert.equal(f.name(), '自定义合并')
  f.input.value = ''
  f.normalize()
  assert.equal(f.name(), '')
})

test('other export dialogs still require a user-entered name', () => {
  const f = fixture()
  f.normalize()
  assert.equal(f.input.value, '')
  assert.equal(f.name(), '')
  f.input.value = 'My export'
  f.root.__novaflowExportManualNameUserEdited = true
  assert.equal(f.name(), 'My export')
})

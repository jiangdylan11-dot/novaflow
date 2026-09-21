const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '../../particle-editor/novaflow-brand-runtime.js'), 'utf8')
const rowMark = 'data-novaflow-spine-inline-import-row'
const statusMark = 'data-novaflow-spine-inline-import-status'

class Element {
  constructor(attrs = {}) { this.attrs = attrs; this.children = []; this.hidden = false }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key) }
  getAttribute(key) { return this.attrs[key] ?? null }
  appendChild(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    this.children.push(child); child.parent = this; return child
  }
  replaceWith(next) {
    const parent = this.parent
    parent.children[parent.children.indexOf(this)] = next
    next.parent = parent; this.parent = null
  }
  querySelector(selector) {
    const [, key, value] = selector.match(/^\[([^=]+)="([^"]+)"\]$/)
    for (const child of this.children) {
      if (child.getAttribute(key) === value) return child
      const found = child.querySelector(selector)
      if (found) return found
    }
    return null
  }
}

function fixture() {
  const rows = ['json', 'atlas', 'image'].map(kind => ({ kind }))
  let builds = 0
  const build = () => {
    builds++
    const body = new Element()
    for (const { kind } of rows) {
      const row = body.appendChild(new Element({ [rowMark]: '1' }))
      row.appendChild(new Element({ [statusMark]: kind }))
    }
    body.appendChild(new Element({ 'data-novaflow-spine-inline-import-clear-all': '1' }))
    body.appendChild(new Element({ 'data-novaflow-spine-inline-import-start': '1' }))
    return body
  }
  const context = vm.createContext({
    HTMLElement: Element, SPINE_INLINE_IMPORT_ROWS: rows,
    buildSpineInlineImportPanelBody: build,
    getSpineInlineImportPanelStatusSnapshot: () => ({ json: 'hero.json' }),
    normalizeSpineInlineImportPreservedStatus: (_, value) => value || '未选择',
    setAttributeIfChanged: (node, key, value) => { node.attrs[key] = value }
  })
  for (const name of ['isSpineInlineImportPanelBodyCanonical', 'ensureCanonicalSpineInlineImportPanelBody']) {
    const start = source.indexOf(`  function ${name}(`)
    assert.ok(start >= 0)
    vm.runInContext(source.slice(start, source.indexOf('\n  function ', start + 10)), context)
  }
  const panel = new Element()
  const body = panel.appendChild(build())
  const ps = body.appendChild(new Element({ id: 'ps-button' }))
  const status = body.appendChild(new Element({ id: 'ps-status' }))
  return { context, panel, body, ps, status, builds: () => builds }
}

test('PS import controls do not rebuild the import buttons on repeated layout refresh', () => {
  const f = fixture()
  const originalRows = f.body.children.slice(0, 5)
  for (let i = 0; i < 60; i++) {
    assert.equal(f.context.ensureCanonicalSpineInlineImportPanelBody(f.panel, f.body), f.body)
  }
  assert.equal(f.builds(), 1)
  assert.deepEqual(f.body.children.slice(0, 5), originalRows)
  assert.equal(f.ps.parent, f.body)
  assert.equal(f.status.parent, f.body)
})

test('a damaged core is repaired once while retaining PS controls and selected filenames', () => {
  const f = fixture()
  f.body.hidden = true
  f.body.appendChild(new Element({ [rowMark]: '1' }))
  const repaired = f.context.ensureCanonicalSpineInlineImportPanelBody(f.panel, f.body)
  assert.notEqual(repaired, f.body)
  assert.equal(repaired.hidden, true)
  assert.equal(f.ps.parent, repaired)
  assert.equal(f.status.parent, repaired)
  assert.equal(repaired.querySelector(`[${statusMark}="json"]`).textContent, 'hero.json')
  assert.equal(f.context.ensureCanonicalSpineInlineImportPanelBody(f.panel, repaired), repaired)
  assert.equal(f.builds(), 2)
})

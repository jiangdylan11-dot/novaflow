const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const dialogPath = path.join(root, 'particle-editor', 'ui-design-image-preview.dialog.js')
const sandbox = { module: { exports: {} }, exports: {} }
sandbox.globalThis = sandbox
vm.runInNewContext(fs.readFileSync(dialogPath, 'utf8'), sandbox, { filename: dialogPath })
const dialog = sandbox.module.exports

class FakeView {
  constructor() {
    this.innerWidth = 1000
    this.innerHeight = 800
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  removeEventListener(type, listener) {
    const values = this.listeners.get(type) || []
    this.listeners.set(type, values.filter((value) => value !== listener))
  }

  dispatchEvent(event) {
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event)
  }
}

class FakeElement {
  constructor(documentRef, tagName) {
    this.ownerDocument = documentRef
    this.tagName = String(tagName || '').toUpperCase()
    this.attributes = new Map()
    this.children = []
    this.parentNode = null
    this.style = {}
    this.listeners = new Map()
    this.textContent = ''
    this.draggable = true
    this.complete = false
    this.naturalWidth = 0
    this.naturalHeight = 0
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value))
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null
  }

  appendChild(child) {
    if (!child) return child
    child.parentNode = this
    this.children.push(child)
    return child
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child))
  }

  remove() {
    if (!this.parentNode) return
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this)
    this.parentNode = null
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  removeEventListener(type, listener) {
    const values = this.listeners.get(type) || []
    this.listeners.set(type, values.filter((value) => value !== listener))
  }

  dispatchEvent(event) {
    if (!event || !event.type) throw new TypeError('event.type is required')
    if (!event.target) event.target = this
    event.currentTarget = this
    event.defaultPrevented = Boolean(event.defaultPrevented)
    event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true })
    event.stopPropagation = event.stopPropagation || (() => { event.propagationStopped = true })
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event)
    return !event.defaultPrevented
  }

  getBoundingClientRect() {
    if (this.getAttribute('data-novaflow-ui-design-image-preview-stage') === '1') {
      return { left: 24, top: 76, width: 952, height: 688, right: 976, bottom: 764 }
    }
    return { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 }
  }

  setPointerCapture(pointerId) {
    this.capturedPointerId = pointerId
  }

  releasePointerCapture(pointerId) {
    if (this.capturedPointerId === pointerId) this.capturedPointerId = null
  }

  focus() {
    this.ownerDocument.activeElement = this
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = new FakeView()
    this.listeners = new Map()
    this.documentElement = new FakeElement(this, 'html')
    this.documentElement.clientWidth = 1000
    this.documentElement.clientHeight = 800
    this.body = new FakeElement(this, 'body')
    this.documentElement.appendChild(this.body)
    this.activeElement = null
  }

  createElement(tagName) {
    return new FakeElement(this, tagName)
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }

  removeEventListener(type, listener) {
    const values = this.listeners.get(type) || []
    this.listeners.set(type, values.filter((value) => value !== listener))
  }

  dispatchEvent(event) {
    event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true })
    event.stopPropagation = event.stopPropagation || (() => { event.propagationStopped = true })
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event)
    return !event.defaultPrevented
  }
}

function findByAttribute(node, name, value) {
  if (node?.getAttribute?.(name) === value) return node
  for (const child of node?.children || []) {
    const found = findByAttribute(child, name, value)
    if (found) return found
  }
  return null
}

test.afterEach(() => dialog.close('test-cleanup'))

test('result image preview fits, zooms, pans, resets and closes without retaining listeners', () => {
  const documentRef = new FakeDocument()
  const closeReasons = []
  const handle = dialog.open({
    src: 'data:image/png;base64,UkVTVUxU',
    name: 'result.png',
    documentRef,
    onClose: (reason) => closeReasons.push(reason),
  })
  const host = findByAttribute(documentRef.body, 'data-novaflow-ui-design-image-preview', '1')
  const stage = findByAttribute(host, 'data-novaflow-ui-design-image-preview-stage', '1')
  const image = findByAttribute(host, 'data-novaflow-ui-design-image-preview-image', '1')
  const fitButton = findByAttribute(host, 'aria-label', '恢复适配窗口')
  const closeButton = findByAttribute(host, 'aria-label', '关闭大图预览')
  assert.ok(host)
  assert.ok(stage)
  assert.ok(image)
  assert.ok(fitButton)
  assert.ok(closeButton)
  assert.equal(host.getAttribute('role'), 'dialog')
  assert.equal(host.getAttribute('aria-modal'), 'true')
  assert.equal(image.draggable, false)
  assert.equal(documentRef.listeners.get('keydown').length, 1)
  assert.equal(documentRef.defaultView.listeners.get('resize').length, 1)

  image.naturalWidth = 500
  image.naturalHeight = 1000
  image.complete = true
  image.dispatchEvent({ type: 'load' })
  assert.equal(handle.snapshot().fitScale, 0.688)
  assert.equal(handle.snapshot().scale, 0.688)

  const wheel = { type: 'wheel', deltaY: -120, clientX: 500, clientY: 420 }
  assert.equal(stage.dispatchEvent(wheel), false)
  assert.ok(handle.snapshot().scale > 0.688)
  assert.equal(wheel.propagationStopped, true)
  const scaleAfterWheel = handle.snapshot().scale
  stage.dispatchEvent({ type: 'wheel', deltaY: 0, clientX: 500, clientY: 420 })
  assert.equal(handle.snapshot().scale, scaleAfterWheel, 'zero-delta wheel events must not change zoom')

  const beforeDrag = handle.snapshot()
  stage.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 7, clientX: 100, clientY: 120 })
  assert.equal(stage.style.cursor, 'grabbing')
  stage.dispatchEvent({ type: 'pointermove', pointerId: 7, clientX: 130, clientY: 165 })
  assert.equal(handle.snapshot().x, beforeDrag.x + 30)
  assert.equal(handle.snapshot().y, beforeDrag.y + 45)
  stage.dispatchEvent({ type: 'pointerup', pointerId: 7 })
  assert.equal(stage.style.cursor, 'grab')

  stage.dispatchEvent({ type: 'dblclick' })
  assert.deepEqual(
    { scale: handle.snapshot().scale, x: handle.snapshot().x, y: handle.snapshot().y },
    { scale: 0.688, x: 0, y: 0 },
  )
  stage.dispatchEvent({ type: 'wheel', deltaY: -120, clientX: 500, clientY: 420 })
  fitButton.dispatchEvent({ type: 'click' })
  assert.equal(handle.snapshot().scale, 0.688)

  assert.equal(documentRef.activeElement, closeButton)
  documentRef.dispatchEvent({ type: 'keydown', key: 'Tab' })
  assert.equal(documentRef.activeElement, fitButton)
  documentRef.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true })
  assert.equal(documentRef.activeElement, closeButton)

  const escape = { type: 'keydown', key: 'Escape' }
  assert.equal(documentRef.dispatchEvent(escape), false)
  assert.equal(dialog.snapshot().open, false)
  assert.equal(findByAttribute(documentRef.body, 'data-novaflow-ui-design-image-preview', '1'), null)
  assert.deepEqual(closeReasons, ['escape'])
  assert.equal(documentRef.listeners.get('keydown').length, 0)
  assert.equal(documentRef.defaultView.listeners.get('resize').length, 0)
})

test('opening a replacement closes the previous preview and API close restores prior focus', () => {
  const documentRef = new FakeDocument()
  let focusRestores = 0
  documentRef.activeElement = { focus() { focusRestores += 1 } }
  const closeReasons = []
  const first = dialog.open({
    src: 'data:image/png;base64,T05F',
    name: 'one.png',
    documentRef,
    onClose: (reason) => closeReasons.push(reason),
  })
  const second = dialog.open({
    src: 'data:image/png;base64,VFdP',
    name: 'two.png',
    documentRef,
    onClose: (reason) => closeReasons.push(reason),
  })
  assert.equal(closeReasons[0], 'replace')
  assert.equal(second.snapshot().name, 'two.png')
  assert.equal(first.close(), false, 'a stale handle must not close its replacement')
  assert.equal(second.snapshot().open, true)
  assert.equal(second.close(), true)
  assert.equal(dialog.snapshot().open, false)
  assert.deepEqual(closeReasons, ['replace', 'api'])
  assert.equal(focusRestores, 1)
})

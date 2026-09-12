const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

function harness() {
  const source = fs.readFileSync(path.join(__dirname, '../../particle-editor/resource-mention.tool.js'), 'utf8')
  const context = { console }
  context.window = context
  const marker = '  window.NovaFlowResourceMentionTool = Object.freeze({'
  assert.ok(source.includes(marker))
  vm.runInNewContext(source.replace(marker, `
    window.imeTest = { bindControllerEvents, unbindControllerEvents, renderController,
      handleEditorKeyDown, handleBeforeInput, syncEditorToBacking,
      isolateEffects: function (effects) {
        editorSelection = function () { return { start: 0, end: 0 }; };
        clearSubmissionError = function () {};
        writeBackingValue = function (controller, value) { controller.textarea.value = value; effects.writes.push(value); };
        renderController = function () { effects.renders++; };
        setEditorSelection = function () {};
        updateMenuFromCaret = function () {};
      }
    };
  ` + marker), context)
  const timers = new Map()
  let timerId = 0
  const view = {
    setTimeout(fn) { timers.set(++timerId, fn); return timerId },
    clearTimeout(id) { timers.delete(id) },
    addEventListener() {}, removeEventListener() {},
  }
  const target = () => ({ isConnected: true, addEventListener() {}, removeEventListener() {} })
  const text = { nodeType: 3, nodeValue: '' }
  const controller = {
    composing: false, compositionCommitTimer: null, handlers: {},
    document: { defaultView: view },
    editor: { ...target(), childNodes: [text] },
    textarea: { ...target(), value: '' },
  }
  const effects = { writes: [], renders: 0 }
  const api = context.imeTest
  api.isolateEffects(effects)
  api.bindControllerEvents(controller)
  return { api, controller, text, effects, timers,
    flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } } }
}

test('Chinese preedit is not published; final input after compositionend commits once', () => {
  const h = harness(), events = h.controller.handlers
  events.compositionstart()
  h.text.nodeValue = '参考tu'
  events.input({ isComposing: true })
  events.input({ isComposing: false })
  assert.deepEqual(h.effects.writes, [])
  events.compositionend()
  assert.deepEqual(h.effects.writes, [])
  h.text.nodeValue = '参考图'
  events.input({ isComposing: false })
  assert.deepEqual(h.effects.writes, [])
  h.flush()
  assert.deepEqual(h.effects.writes, ['参考图'])
  assert.equal(h.effects.renders, 1)
  assert.equal(h.controller.composing, false)
  h.text.nodeValue += ' A'
  events.input({ isComposing: false })
  assert.equal(h.controller.textarea.value, '参考图 A')
})

test('refresh never touches DOM or caret during composition, including end-to-input gap', () => {
  const h = harness()
  const guarded = { composing: true, get editor() { throw Error('DOM touched while IME is active') } }
  h.api.renderController(guarded)
  h.controller.handlers.compositionstart()
  h.controller.handlers.compositionend()
  assert.equal(h.controller.composing, true)
  h.api.syncEditorToBacking(h.controller, true)
  assert.deepEqual(h.effects.writes, [])
})

test('IME keys and beforeinput remain native instead of triggering mention edits', () => {
  const h = harness()
  const guarded = { composing: true, get document() { throw Error('mention selection inspected during IME') } }
  for (const key of ['Enter', 'Tab', 'ArrowDown', 'Backspace', 'Delete']) {
    h.api.handleEditorKeyDown(guarded, { key, preventDefault() { assert.fail('IME key intercepted') } })
    h.api.handleEditorKeyDown({}, { key, keyCode: 229, preventDefault() { assert.fail('IME key intercepted') } })
    h.api.handleEditorKeyDown({}, { key, isComposing: true, preventDefault() { assert.fail('IME key intercepted') } })
  }
  for (const inputType of ['insertParagraph', 'deleteContentBackward', 'insertCompositionText']) {
    h.api.handleBeforeInput(guarded, { inputType, preventDefault() { assert.fail('IME beforeinput intercepted') } })
  }
  h.api.handleBeforeInput({}, { inputType: 'deleteCompositionText', preventDefault() { assert.fail('composition deletion intercepted') } })
})

test('a new composition supersedes pending commit and unmount cancels its timer', () => {
  const h = harness(), events = h.controller.handlers
  events.compositionstart()
  h.text.nodeValue = '图'
  events.compositionend()
  events.compositionstart()
  assert.equal(h.timers.size, 0)
  h.flush()
  assert.deepEqual(h.effects.writes, [])
  h.text.nodeValue = '图片'
  events.compositionend()
  h.flush()
  assert.deepEqual(h.effects.writes, ['图片'])
  events.compositionstart()
  events.compositionend()
  h.api.unbindControllerEvents(h.controller)
  assert.equal(h.timers.size, 0)
})

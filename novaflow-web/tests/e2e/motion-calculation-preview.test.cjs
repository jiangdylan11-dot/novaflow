const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
const read = name => fs.readFileSync(path.join(renderer, name), 'utf8')
const fn = (source, name) => source.match(new RegExp('^  function ' + name + '\\([^]*?^  \\}', 'm'))[0]
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const plain = value => JSON.parse(JSON.stringify(value))

function fixture(empty = false) {
  const json = { skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }, { name: 'ball', parent: 'root', length: 30 }, { name: 'other', parent: 'root' }], slots: [],
    skins: [{ name: 'default', attachments: {} }], animations: { idle: empty ? {} : { bones: { ball: { translate: [{ time: 0, x: 90 }, { time: 2, x: 180 }] }, other: { rotate: [{ time: 0, angle: 7 }] } } } } }
  const state = { json, anim: 'idle', skin: 'default', mode: 'animate', temp: new Map(), history: [], future: [] }, rt = {}
  const props = { spineSubEditor: 'bone', project: json, activeAnimationName: 'idle', selectedBoneName: 'ball', selectedBoneNames: ['ball'], setProject(update) { props.project = update(props.project) } }
  const root = { __reactContainer$test: { stateNode: { current: { memoizedProps: props } } } }, panel = { dataset: {}, querySelector: () => ({ replaceChildren() {}, append() {} }), querySelectorAll: () => [] }
  let bridge
  const ctx = vm.createContext({ console, state, rt, Ops, hostSeen: {}, extStep: null, durations: new Map(), motionOpen: true,
    document: { getElementById: () => root, querySelector: () => null, createElement: () => ({ attachShadow: () => ({}) }) },
    MutationObserver: class { observe() {} }, addEventListener() {},
    computeRoles() {}, setSkin() {}, validateSelection() {}, refresh() {}, snapshot: () => ({ json: state.json }),
    signature: JSON.stringify, motionPanelOpen: () => ctx.motionOpen,
    pushToReact: json => { props.project = { ...props.project, animations: json.animations } },
  })
  ctx.window = ctx
  for (const name of ['vendor/spine/spine-webgl-3.8.js', 'spine-bones.editor.js', 'motion-calculation.engine.js', 'motion-calculation.animation.js']) vm.runInContext(read(name), ctx)
  ctx.readData = j => new ctx.spine.SkeletonJson({}).readSkeletonData(Ops.editorData(j))
  vm.runInContext(['applyJson', 'currentAnimation', 'previewAnimation', 'clearAnimationPreview', 'duration', 'applyExternal'].map(name => fn(read('spine-skeleton-editor.js'), name)).join('\n'), ctx)
  vm.runInContext(['normalizeAnimations', 'applyRibbonAnimation'].map(name => fn(read('spine-skeleton-editor.host.js'), name)).join('\n'), ctx)
  vm.runInContext('applyJson(state.json)', ctx)
  const api = { loaded: () => true, json: () => state.json, anim: () => state.anim, selectedSlot: () => null,
    previewAnimation: ctx.previewAnimation, clearAnimationPreview: ctx.clearAnimationPreview, applyExternal: ctx.applyExternal }
  ctx.api = api
  ctx.NovaFlowSkeletonEditor = { active: () => true, api: () => api,
    applyCalculationAnimation(name, animation, reason) {
      if (!ctx.applyRibbonAnimation(name, animation, reason, '写入动画')) return false
      return reason === 'write' ? state.json.animations[name] : true
    } }
  ctx.NovaFlowMotionPanel = { mount(_shadow, options) { bridge = options; return { destroy() {}, rebind() {}, status() {} } } }
  const source = read('motion-calculation.tool.js').replace('  setInterval(refresh,350);refresh();', '  window.motionPreviewTest={open(mode,node){panel=node;activeMode=mode;open();},close};')
  vm.runInContext(source, ctx)
  return { ctx, state, rt, props, panel, open(mode) { ctx.motionPreviewTest.open(mode, panel); return bridge }, close: () => ctx.motionPreviewTest.close(),
    input(mode, amp = 40) { const stack = ctx.NovaFlowMotionEngine.freshStack(); stack[mode].enabled = true; const axis = mode === 'bounce' ? 'y' : mode === 'expand' ? 'sx' : mode === 'rotate' ? 'r' : 'x'; stack[mode].axes[axis] = { ...stack[mode].axes[axis], on: true, amp }; return [stack, { animationDuration: 2, boneDuration: 1, animationDelay: 0, boneDelay: 0 }] } }
}

for (const mode of ['bounce', 'expand', 'shuttle', 'rotate']) test(`${mode} previews never change project keys, serialization or undo before explicit write`, () => {
  const f = fixture(), bridge = f.open(mode), before = JSON.stringify(f.state.json), nativeBefore = JSON.stringify(f.props.project)
  bridge.preview(...f.input(mode))
  bridge.preview(...f.input(mode, 80))
  assert(f.rt.animationPreview)
  assert.equal(JSON.stringify(f.state.json), before)
  assert.equal(JSON.stringify(f.props.project), nativeBefore)
  assert.equal(f.state.history.length, 0)
  f.close()
  assert.equal(f.rt.animationPreview, null)
  assert.equal(JSON.stringify(f.state.json), before)
  assert.equal(f.state.history.length, 0)
})

test('explicit write commits once, preserves newer unrelated tracks, and later unwritten adjustments are discarded', () => {
  const f = fixture(), bridge = f.open('shuttle'), input = f.input('shuttle'), before = JSON.stringify(f.state.json)
  bridge.preview(...input)
  f.state.json.animations.idle.bones.other.rotate[0].angle = 55
  f.props.project.animations.idle.bones.other.rotate[0].angle = 55
  bridge.save(...input)
  assert.equal(f.state.history.length, 1)
  assert.equal(f.state.json.animations.idle.bones.other.rotate[0].angle, 55)
  assert.equal(f.rt.animationPreview, null)
  assert.notEqual(JSON.stringify(f.state.json), before)
  const written = JSON.stringify(f.state.json)
  bridge.preview(...f.input('shuttle', 120))
  bridge.discard()
  assert.equal(JSON.stringify(f.state.json), written)
  assert.equal(f.state.history.length, 1)
  assert.equal(f.rt.animationPreview, null)
  bridge.restore()
  assert.equal(JSON.stringify(f.state.json), written, 'restore parameters is still only a preview until written')
  f.close()
  assert.equal(JSON.stringify(f.state.json), written)
})

test('an empty animation can play a longer preview without creating authored keys or extending the saved animation', () => {
  const f = fixture(true), bridge = f.open('bounce'), before = JSON.stringify(f.state.json)
  assert.equal(f.ctx.duration(), 0)
  bridge.preview(...f.input('bounce'))
  assert(f.ctx.duration() >= 1)
  assert.equal(JSON.stringify(f.state.json), before)
  bridge.discard()
  assert.equal(f.ctx.duration(), 0)
  assert.equal(f.state.history.length, 0)
})

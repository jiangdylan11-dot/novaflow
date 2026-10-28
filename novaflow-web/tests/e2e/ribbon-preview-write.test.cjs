const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
const read = name => fs.readFileSync(path.join(renderer, name), 'utf8')
const editor = read('spine-skeleton-editor.js'), host = read('spine-skeleton-editor.host.js'), brand = read('novaflow-brand-runtime.js')
const fn = (source, name) => {
  const match = source.match(new RegExp('^  function ' + name + '\\([^]*?^  \\}', 'm'))
  assert.ok(match, name)
  return match[0]
}
const plain = value => JSON.parse(JSON.stringify(value))
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps

function fixture() {
  const json = { skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }, { name: 'b1', parent: 'root', length: 30 }, { name: 'b2', parent: 'b1', x: 30, length: 30 }, { name: 'b3', parent: 'b2', x: 30 }],
    slots: [], skins: [{ name: 'default', attachments: {} }], animations: { idle: { bones: { b1: { rotate: [{ time: 0, angle: 0 }, { time: 2, angle: 0 }] } } } } }
  const state = { json, anim: 'idle', skin: 'default', mode: 'animate', multiSlots: [], temp: new Map(), history: [], future: [], dope: { filter: { keyedOnly: true }, keySel: [] } }
  let pushed = 0
  const rt = {}, ctx = vm.createContext({ console, state, rt, Ops, KEY_COLOR: {}, durations: new Map(), hostSeen: {}, extStep: null,
    computeRoles() {}, setSkin() {}, validateSelection() {}, refresh() {}, selectedBones: () => ['b1'], currentSlot: () => null, animOn: () => true,
    pathId: JSON.stringify, signature: JSON.stringify, timeSec: () => 0.5, snapshot: () => ({ json: state.json }), pushToReact: () => { pushed++; return true }, motionOpen: true,
    motionPanelOpen: () => ctx.motionOpen, getRibbonReactProjectContext: () => ({ project: state.json, animationName: 'idle' }),
    cancelPendingRibbonPreviewProjectCommit() {}, normalizeRibbonElasticityApplyReason: s => s, scheduleFullLayoutRefresh() {},
  })
  vm.runInContext(read('vendor/spine/spine-webgl-3.8.js'), ctx)
  ctx.readData = j => new ctx.spine.SkeletonJson({}).readSkeletonData(Ops.editorData(j))
  vm.runInContext(['applyJson', 'currentAnimation', 'previewAnimation', 'clearAnimationPreview', 'pose', 'trackKind', 'buildDope', 'applyExternal'].map(n => fn(editor, n)).join('\n'), ctx)
  vm.runInContext(['normalizeAnimations', 'applyRibbonAnimation', 'setMotionOpen', 'syncRibbonChain'].map(n => fn(host, n)).join('\n'), ctx)
  vm.runInContext(['getRibbonSkeletonPreviewHost', 'getRibbonCalculationContext', 'cloneRibbonAnimationForProjectCommit', 'cloneRibbonTimelineForProjectCommit', 'cloneRibbonCommitValue', 'setRibbonHiddenValue', 'commitOrScheduleRibbonElasticityProjectPreview'].map(n => fn(brand, n)).join('\n'), ctx)
  vm.runInContext(`applyJson(state.json); var api = {
    json:()=>state.json, loaded:()=>true, anim:()=>state.anim, selectedBone:()=> 'b1', selectedBones:()=>['b1'],
    previewAnimation, clearAnimationPreview, applyExternal, setPanel(){}, reserveBottom(){}
  }; var window = { NovaFlowSkeletonEditor:{active:()=>true, api:()=>api, applyRibbonAnimation} };`, ctx)
  return { ctx, state, rt, json, pushed: () => pushed, run: text => vm.runInContext(text, ctx), preview: {
    bones: { b1: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 45 }, { time: 1, angle: -20 }, { time: 2, angle: 0 }] },
      b2: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 30 }] } }
  } }
}

test('live preview changes the Spine pose, leaving authored keys, JSON and undo history untouched', () => {
  const f = fixture(), before = JSON.stringify(f.state.json)
  f.ctx.preview = f.preview
  assert.equal(f.run("applyRibbonAnimation('idle', preview, 'parameter-preview')"), true)
  f.run('pose(); buildDope()')
  assert.ok(Math.abs(f.rt.skeleton.findBone('b1').rotation - 45) < 0.02)
  assert.equal(JSON.stringify(f.state.json), before)
  assert.equal(f.state.dope.tracks.get('["bones","b1","rotate"]').times.length, 2)
  assert.equal(f.state.history.length, 0)
  assert.equal(f.pushed(), 0)
  assert.equal(Ops.exportable(f.state.json).animations.idle.bones.b2, undefined)
  f.run('clearAnimationPreview(); pose()')
  assert.equal(f.rt.skeleton.findBone('b1').rotation, 0)
})

test('explicit write creates one undo step; closing a later preview keeps the written animation', () => {
  const f = fixture(), before = JSON.stringify(f.state.json)
  f.ctx.preview = f.preview
  f.run("applyRibbonAnimation('idle', preview, 'parameter-preview'); applyRibbonAnimation('idle', preview, 'write')")
  assert.equal(f.state.history.length, 1)
  assert.equal(f.pushed(), 1)
  assert.equal(f.rt.animationPreview, null)
  assert.ok(f.state.json.animations.idle.bones.b2)
  const written = JSON.stringify(f.state.json)
  f.run("applyRibbonAnimation('idle', {bones:{b1:{rotate:[{time:0,angle:99}]}}}, 'parameter-preview'); setMotionOpen(false); pose()")
  assert.equal(JSON.stringify(f.state.json), written)
  assert.equal(f.rt.animationPreview, null)
  assert.equal(f.run("applyRibbonAnimation('idle', preview, 'parameter-preview')"), false, 'late calculations cannot reopen a closed preview')
  f.run('applyJson(state.history.pop().json)')
  assert.equal(JSON.stringify(f.state.json), before)
})

test('calculation drafts cannot mutate the source project and preview commits never invoke setProject', () => {
  const f = fixture(), before = JSON.stringify(f.state.json)
  f.run('var draft=getRibbonCalculationContext(); draft.project.animations.idle.bones.b1.rotate[0].angle=88')
  assert.equal(JSON.stringify(f.state.json), before)
  assert.equal(f.run("commitOrScheduleRibbonElasticityProjectPreview(draft,draft.project.animations.idle,'parameter-preview')"), true)
  assert.equal(f.pushed(), 0)
  assert.equal(f.state.history.length, 0)
})

test('opening ribbon timing cannot add a duration field to the authored animation', () => {
  const f = fixture(), before = JSON.stringify(f.state.json)
  f.ctx.getRibbonTimelineDuration = () => 2
  f.ctx.parseRibbonEventNumber = value => value == null ? null : Number(value)
  vm.runInContext(fn(brand, 'protectRibbonCurrentAnimationDuration'), f.ctx)
  assert.equal(f.run('protectRibbonCurrentAnimationDuration()'), false)
  assert.equal(JSON.stringify(f.state.json), before)
  assert.equal(f.state.history.length, 0)
})

test('repeated write callbacks do not duplicate history, while distinct explicit writes undo separately', () => {
  const f = fixture()
  f.ctx.preview = f.preview
  f.run("applyRibbonAnimation('idle',preview,'write');applyRibbonAnimation('idle',preview,'write')")
  assert.equal(f.state.history.length, 1)
  f.run("applyRibbonAnimation('idle',{bones:{b1:{rotate:[{time:0,angle:99}]}}},'write')")
  assert.equal(f.state.history.length, 2)
  f.run('applyJson(state.history.pop().json)')
  assert.deepEqual(plain(f.state.json.animations.idle.bones), f.preview.bones)
})

test('ribbon context takes hierarchy and manual selection from the visible editor', () => {
  const f = fixture()
  f.ctx.props = { project: { bones: [], animations: { stale: {} } }, activeAnimationName: 'stale', selectedBoneName: 'root', selectedBoneNames: [] }
  f.ctx.findRibbonReactFiber = () => ({ memoizedProps: f.ctx.props })
  f.ctx.guardRibbonProjectSetProjectCallback = () => {}
  f.ctx.rememberRibbonProjectIdentity = () => {}
  f.run(fn(brand, 'getRibbonReactProjectContext'))
  const context = f.run('getRibbonReactProjectContext()')
  assert.equal(context.project.bones, f.json.bones)
  assert.equal(context.animationName, 'idle')
  assert.equal(context.selectedBoneName, 'b1')
  assert.deepEqual(plain(context.selectedBoneNames), ['b1'])
  f.ctx.createRibbonBoneNameNormalizer = () => value => String(value || '')
  f.run(fn(brand, 'getRibbonPrimarySelectedBoneName'))
  assert.equal(f.run('getRibbonPrimarySelectedBoneName({selectedBoneName:"stale"})'), 'b1')
})

function chainFixture() {
  const f = fixture(), c = f.ctx
  c.RIBBON_PRESET_AUTO_CHAIN_MAX_BONES = 30
  c.getRibbonSelectedRootBoneNames = context => context.selectedBoneNames
  c.getRibbonChainIndexValue = value => Math.max(0, Number(value) || 0)
  c.getRibbonProjectIdentityValidation = () => ({ accepted: true })
  c.getRibbonProjectContextSignature = () => 'fixture'
  c.getRibbonProjectCompletenessScore = () => 1
  c.shouldUseRibbonParameterPresetTargetScope = () => true
  c.getRibbonManualChainIndexMap = () => new Map()
  f.run('var ribbonParameterPresetTargetScope = null;\n' + ['getRibbonBoneName', 'getRibbonBoneParentName', 'buildRibbonChildMap', 'scoreRibbonElasticChild', 'buildRibbonElasticChainEntries', 'getRibbonElasticTargetBoneEntries', 'cloneRibbonParameterPresetTargetEntry', 'captureRibbonParameterPresetTargetScope', 'getRibbonParameterPresetScopedTargetEntries'].map(n => fn(brand, n)).join('\n'))
  return f
}

test('auto chain expands descendants, toggles back to manual roots, and retargets without stale scope', () => {
  const f = chainFixture()
  f.run("var context={project:state.json,animationName:'idle',selectedBoneNames:['b1']}; var animation=state.json.animations.idle")
  const targets = (auto) => plain(f.run(`getRibbonParameterPresetScopedTargetEntries(context,animation,${auto},'parameter-preview')`)).map(x => x.name)
  assert.deepEqual(targets(true), ['b1', 'b2', 'b3'])
  assert.deepEqual(targets(false), ['b1'])
  assert.deepEqual(targets(true), ['b1', 'b2', 'b3'])
  f.run("context.selectedBoneNames=['b2']")
  assert.deepEqual(targets(true), ['b2', 'b3'])
})

test('chain highlight uses editor hierarchy even when the hidden workspace has no bones', () => {
  const f = chainFixture(), calls = []
  f.ctx.document = { querySelector: selector => selector.includes('input') ? { checked: true } : {} }
  f.ctx.pickedBones = () => ['b1']
  f.run('window.NovaFlowRibbonChain=(project,root)=>buildRibbonElasticChainEntries(project,root).map(e=>e.name)')
  f.ctx.api.selectChain = names => calls.push(plain(names))
  f.ctx.projectProps = () => { throw new Error('must use editor hierarchy') }
  f.run('syncRibbonChain()')
  assert.deepEqual(calls, [['b1', 'b2', 'b3']])
})

test('export preparation never writes a pending ribbon preview', () => {
  const f = fixture()
  f.ctx.getSkeletonSpineExportContext = () => ({ project: f.state.json })
  f.ctx.applyRibbonElasticityResponse = () => { throw new Error('export must not implicitly write') }
  f.run(fn(brand, 'prepareSkeletonSpineProjectForExport'))
  assert.equal(f.run('prepareSkeletonSpineProjectForExport().project'), f.state.json)
})

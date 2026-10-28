const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const host = fs.readFileSync(path.resolve(__dirname, '../../renderer/spine-skeleton-editor.host.js'), 'utf8')
const tool = fs.readFileSync(path.resolve(__dirname, '../../renderer/motion-calculation.tool.js'), 'utf8')
const fn = (source, name) => source.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  \\}', 'm'))[0]

function fixture() {
  const original = { skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }, { name: 'child', parent: 'root' }], slots: [],
    skins: [{ name: 'default', attachments: {} }], animations: { idle: { bones: { child: { rotate: [{ time: 0, angle: 12 }] } } } } }
  const before = JSON.stringify(original), writes = [], picks = []
  const props = { spineSubEditor: 'bone', project: null, selectedBoneName: null, selectedBoneNames: [], activeAnimationName: '',
    setProject(update) { writes.push(update) } }
  const root = { __reactContainer$test: { stateNode: { current: { memoizedProps: props } } } }
  const workspace = { onSelectedBoneNameChange(name) { props.selectedBoneName = name },
    onSelectedBoneNamesChange(names) { props.selectedBoneNames = names }, onActiveAnimationNameChange(name) { props.activeAnimationName = name } }
  const ctx = vm.createContext({ document: { getElementById: () => root }, api: { loaded: () => true, json: () => original,
    setPanel: (...args) => picks.push(args), anim: () => 'idle', time: () => 0 },
    workspaceProps: () => workspace, pickedBone: () => 'child', pickedBones: () => ['child'], syncAppTreeSelection() {},
    sameNames: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    durations: new Map(), pushedSig: {}, pushedAnimations: null, lastReact: null, motionOpen: false, window: {} })
  vm.runInContext([fn(host, 'reactProps'), fn(host, 'reactFiber'), host.match(/^  const projectProps = .+$/m)[0],
    host.match(/^  const signature = .+$/m)[0], ...['normalizeAnimations', 'withDurations', 'pushToReact', 'pushSelection', 'beforeMotion', 'pullFromReact', 'motionTick'].map(name => fn(host, name)),
    fn(tool, 'getContext')].join('\n'), ctx)
  return { ctx, props, writes, original, before, picks, flush() { while (writes.length) props.project = writes.shift()(props.project) } }
}

test('opening calculations bootstraps a direct nfproj import even when the original React project is null', () => {
  const f = fixture()
  assert.equal(f.ctx.getContext(), null)
  assert.equal(f.ctx.beforeMotion(), true)
  assert.equal(f.ctx.motionOpen, true, 'the first live preview need not wait for the periodic host tick')
  assert.equal(f.writes.length, 1)
  f.flush()
  const context = f.ctx.getContext()
  assert(context)
  assert.equal(context.activeAnimationName, 'idle')
  assert.equal(context.selectedBoneName, 'child')
  assert(context.project.atlas.regionToPage && context.project.atlas.pages && context.project.images, 'the hidden native player still requires texture containers')
  assert.deepEqual(JSON.parse(JSON.stringify(context.project.bones)), f.original.bones)
  assert.deepEqual(JSON.parse(JSON.stringify(context.project.skins)), f.original.skins)
  assert.deepEqual(JSON.parse(JSON.stringify(context.project.animations)), f.original.animations)
  assert.equal(JSON.stringify(f.original), f.before, 'opening tools must not change the authored project')
  assert.equal(f.ctx.beforeMotion(), false, 'an already synchronized project is not initialized again')
})

test('the null React project cannot be pulled over the loaded editor while initialization is queued', () => {
  const f = fixture()
  f.ctx.lastReact = {}
  assert.doesNotThrow(() => f.ctx.pullFromReact())
  assert.equal(JSON.stringify(f.original), f.before)
  assert.equal(f.writes.length, 0)
})

test('periodic workspace updates cannot commit hidden native drafts to the authored project', () => {
  const f = fixture()
  f.props.project = JSON.parse(JSON.stringify(f.original))
  f.props.project.animations.idle.bones.child.rotate[0].angle = 99
  let commits = 0
  f.ctx.api.applyExternal = () => commits++
  f.ctx.motionPanelOpen = () => true
  f.ctx.setMotionOpen = value => { f.ctx.motionOpen = value }
  f.ctx.syncRibbonChain = () => {}
  f.ctx.motionTick()
  assert.equal(commits, 0)
  assert.equal(JSON.stringify(f.original), f.before)
})

test('native working bones and timelines cannot mutate the authored editor through shared references', () => {
  const f = fixture()
  f.ctx.beforeMotion(); f.flush()
  f.props.project.bones[1].x = 999
  f.props.project.animations.idle.bones.child.rotate[0].angle = 99
  f.props.project.skins[0].attachments.draft = {}
  assert.equal(JSON.stringify(f.original), f.before)
})

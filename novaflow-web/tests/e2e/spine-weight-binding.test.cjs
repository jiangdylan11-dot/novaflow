const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-mesh-edit.js'))
const ME = globalThis.NovaFlowMeshEdit
const source = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8')
const fn = name => source.match(new RegExp('^  function ' + name + '\\([^]*?^  \\}', 'm'))[0]
const plain = value => JSON.parse(JSON.stringify(value))

function fixture(weighted = false) {
  const model = { weighted, width: 20, height: 20, hull: 3, tris: [0, 1, 2], edges: [], points: [[0, 0], [20, 0], [0, 20]].map(([x,y],src) => ({x,y,u:0,v:0,src,w:weighted ? [[1,1]] : null})) }
  const state = { json: {}, skin: 'default', weightEdit: { skin: 'default', slot: 'image', name: 'image', extra: [], order: null, bone: null, binding: null } }
  const writes = [], batches = [], statuses = []
  const ctx = vm.createContext({ state, rt: { data: {} }, ME: () => ME, weCache: null,
    meshModelOf: () => ({model,slotBone:1}), renderWeightPanel() {}, status: msg => statuses.push(msg),
    commitWeights: (m,label) => writes.push({model:m,label}), weighOneLayer() {}, batchEdit: (layers,label,op) => batches.push({layers,label,op}) })
  vm.runInContext(['weightContext','weightBones','finishBind','weightAction'].map(fn).join('\n'),ctx)
  return {model,state,writes,batches,statuses,run:code=>vm.runInContext(code,ctx)}
}

test('opening unweighted mesh does not invent a parent binding or weight data', () => {
  const f = fixture(), before = JSON.stringify(f.model)
  assert.deepEqual(plain(f.run('weightBones(weightContext())')), [])
  assert.equal(f.run('weightContext().model.weighted'), false)
  assert.equal(JSON.stringify(f.model), before)
  f.run("weightAction('bind')")
  assert.deepEqual(plain(f.state.weightEdit.binding), [])
  assert.equal(f.writes.length, 0)
})

test('first explicit single-bone binding uses the selected bone, without adding the slot parent', () => {
  const f = fixture()
  f.state.weightEdit.binding = [2]
  f.run('finishBind()')
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].model.weighted, true)
  assert.deepEqual(f.writes[0].model.points.map(p=>plain(p.w)), [[[2,1]],[[2,1]],[[2,1]]])
  assert.equal(f.model.weighted, false, 'the original model stays unchanged until the edit commits')
})

test('first explicit multi-bone binding passes only selected bones to automatic weights', () => {
  const f = fixture()
  f.state.weightEdit.binding = [2,3]
  f.run('finishBind()')
  assert.equal(f.batches.length, 1)
  assert.deepEqual(plain(f.state.weightEdit.order), [2,3])
  assert.equal(f.writes.length, 0)
})

test('existing imported weights keep their binding and an empty binding cannot commit', () => {
  const f = fixture(true)
  assert.deepEqual(plain(f.run('weightBones(weightContext())')), [1])
  f.state.weightEdit.binding = []
  f.run('finishBind()')
  assert.equal(f.writes.length, 0)
  assert.equal(f.batches.length, 0)
  assert.equal(f.statuses.at(-1), '至少要绑定一根骨骼')
})

test('weight operations cannot silently bind an unweighted mesh', () => {
  const f = fixture()
  for (const action of ['auto','smooth','prune']) f.run(`weightAction('${action}')`)
  assert.equal(f.batches.length, 0)
  assert.equal(f.writes.length, 0)
  assert.equal(f.model.weighted, false)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'); const context = { AbortController, console }; vm.createContext(context); vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../../renderer/ui-design-layers.js'), 'utf8'), context); const api = context.NovaFlowUiDesignLayers
const scene = { width: 1024, height: 768, layers: [{ id: 'bg', kind: 'background', dataUrl: 'old-bg' }, { id: 'button', dataUrl: 'old-button' }, { id: 'money', type: 'text', text: 'CREDIT 10,000', locked: true }] }
test('selected layer commit preserves every other layer, ID, geometry and text', async () => {
  const model = api.controller(scene), before = model.snapshot
  await model.regenerate('button', async () => ({ dataUrl: 'new-button' }))
  assert.deepEqual(model.snapshot.layers[0], before.layers[0])
  assert.deepEqual(model.snapshot.layers[2], before.layers[2])
  assert.equal(model.snapshot.layers[1].id, 'button')
  assert.equal(model.snapshot.layers[1].width, before.layers[1].width)
  model.undo(); assert.deepEqual(model.snapshot, before)
  model.redo(); assert.equal(model.snapshot.layers[1].dataUrl, 'new-button')
})
test('failure retains exact original scene and later retry succeeds', async () => {
  const model = api.controller(scene), before = model.snapshot
  await assert.rejects(model.regenerate('button', async () => { throw Error('backend failed') }))
  assert.deepEqual(model.snapshot, before); assert.equal(model.busy, false)
  await model.regenerate('button', async () => ({ dataUrl: 'retry' }))
  assert.equal(model.snapshot.layers[1].dataUrl, 'retry')
})
test('double submit is rejected and cancellation discards late completion', async () => {
  const model = api.controller(scene), before = model.snapshot
  let complete
  const first = model.regenerate('button', () => new Promise(r => { complete = r }))
  await assert.rejects(model.regenerate('button', async () => ({ dataUrl: 'duplicate' })))
  assert.throws(() => model.patch('button', { prompt: 'changed during run' }))
  model.cancel(); complete({ dataUrl: 'late' }); await assert.rejects(first)
  assert.deepEqual(model.snapshot, before)
})
test('cancel then retry cannot let old finally clear the new transaction', async () => {
  const model = api.controller(scene); let oldDone, newDone
  const old = model.regenerate('button', () => new Promise(r => { oldDone = r }))
  model.cancel()
  const next = model.regenerate('button', () => new Promise(r => { newDone = r }))
  oldDone({ dataUrl: 'old-late' }); await assert.rejects(old); assert.equal(model.busy, true)
  newDone({ dataUrl: 'valid-new' }); await next; assert.equal(model.snapshot.layers[1].dataUrl, 'valid-new')
})
test('locked layers reject editing and text stays native on persistence', () => {
  const saved = []; const model = api.controller(scene, s => saved.push(s))
  assert.throws(() => model.patch('money', { text: 'wrong' }))
  assert.throws(() => model.remove('money'))
  model.patch('money', { locked: false }); model.patch('money', { text: 'WIN 500', fontFamily: 'Arial' })
  const restored = api.controller(JSON.parse(JSON.stringify(saved.at(-1))))
  assert.equal(restored.snapshot.layers[2].text, 'WIN 500'); assert.equal(restored.snapshot.layers[2].type, 'text')
})
test('graph bounds GPU workload, keeps all reference roles and rejects excess', () => {
  const runtime = { unet: 'installed-q8', clip: 'installed-8b', vae: 'installed-vae' }
  const roles = ['layout', 'style', 'character', 'material'], names = ['a','b','c','d']
  const g = api.graph({ names, roles, runtime, width: 2048, height: 2048, prompt: 'asset', seed: 42 })
  assert.ok(g['6'].inputs.width * g['6'].inputs.height <= 1048576)
  assert.equal(g['6'].inputs.batch_size, 1)
  assert.equal(g['5'].inputs['images.image_4'][0], '203')
  assert.match(g['5'].inputs.prompt, /Image 4: material/)
  assert.equal(g['9'].inputs.images[0], '8', 'native alpha decode travels directly to PNG')
  assert.throws(() => api.graph({ names: Array(11).fill('a'), roles, runtime, prompt: '' }))
})

test('project reopening validates before mutation, persists native formatting and supports undo', () => {
  const saved = [], model = api.controller(scene, s => saved.push(s)), before = model.snapshot
  assert.throws(() => model.replaceProject({ version: 1, width: 12, height: 1250, layers: [] }))
  assert.deepEqual(model.snapshot, before)
  const project = { version: 1, width: 576, height: 1250, layers: [{ id: 'label', type: 'text', text: 'MAJOR 10,000', fontWeight: 'bold', textAlign: 'center', fontFamily: 'Georgia' }] }
  model.replaceProject(project)
  const reopened = api.controller(JSON.parse(JSON.stringify(saved.at(-1))))
  assert.deepEqual(reopened.snapshot, model.snapshot)
  assert.equal(reopened.snapshot.layers[0].fontWeight, 'bold')
  assert.equal(reopened.snapshot.layers[0].textAlign, 'center')
  model.undo(); assert.deepEqual(model.snapshot, before)
})
test('imported image replacement retains bounds and every other layer through saved reopen', () => {
  let saved; const model = api.controller(scene, s => saved = s), before = model.snapshot
  model.patch('button', { dataUrl: 'data:image/png;base64,new', provenance: { kind: 'import-replacement', fileName: 'new.png' } })
  const reopened = api.controller(JSON.parse(JSON.stringify(saved))).snapshot
  assert.equal(reopened.layers[1].dataUrl, 'data:image/png;base64,new')
  for (const key of ['id','x','y','width','height']) assert.equal(reopened.layers[1][key], before.layers[1][key])
  assert.deepEqual(reopened.layers[0], before.layers[0]); assert.deepEqual(reopened.layers[2], before.layers[2])
})
test('native centered text renders exact content with stored font weight and multiline positions', async () => {
  const draws = [], ctx = { save(){}, restore(){}, fillText(...args){ draws.push({ args, font: this.font, align: this.textAlign }) } }
  const doc = { createElement: () => ({ getContext: () => ctx }) }
  await api.composite(api.normalize({ width: 576, height: 1250, layers: [{ id: 'label', type: 'text', text: 'MAJOR\n10,000', x: 10, y: 20, width: 150, height: 60, fontSize: 25, fontFamily: 'Georgia', fontWeight: 'bold', textAlign: 'center' }] }), doc)
  assert.equal(draws[0].args[0], 'MAJOR'); assert.equal(draws[1].args[0], '10,000')
  assert.equal(draws[0].args[1], 85); assert.equal(draws[1].args[2], 50)
  assert.equal(draws[0].font, 'bold 25px Georgia'); assert.equal(draws[0].align, 'center')
})

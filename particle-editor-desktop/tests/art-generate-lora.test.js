const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
function loadModule(name) {
  const module = { exports: {} }
  new Function('module', fs.readFileSync(path.join(root, 'particle-editor', name), 'utf8'))(module)
  return module.exports
}
const lora = loadModule('art-generate-lora.js')
const models = loadModule('art-generate-model.resource.js')
const source = fs.readFileSync(path.join(root, 'particle-editor/novaflow-brand-runtime.js'), 'utf8')
const templateSource = source.slice(source.indexOf('const ART_GENERATE_WORKFLOW_TEMPLATES ='), source.indexOf('const ART_GENERATE_STATE ='))
const templates = vm.runInNewContext(`${templateSource}; ART_GENERATE_WORKFLOW_TEMPLATES`)
const selected = [{ name: 'qwen\\HQL0.2.safetensors', strength: 0.35 }, { name: 'qwen\\HLora_v0.1.safetensors', strength: 0.5 }]
const info = { LoraLoaderModelOnly: { input: { required: { lora_name: [[...selected.map(x => x.name), 'wan22/test.safetensors', 'other/qwen/test.safetensors', 'qwen-other.safetensors', 'qwen/../escape.safetensors', 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors']] } } } }

test('catalog keeps Qwen files and excludes video and managed accelerators', () => {
  assert.deepEqual(lora.catalogFromInfo(info).sort(), selected.map(x => x.name).sort())
  assert.throws(() => lora.catalogFromInfo({}), /未返回/)
})

test('selection guards duplicates and bad weights; off and zero do not participate', () => {
  assert.deepEqual(lora.selection([...selected, { ...selected[0], enabled: false }]), selected)
  assert.deepEqual(lora.selection([{ ...selected[0], strength: 0 }, { name: '' }]), [])
  assert.throws(() => lora.selection([selected[0], { ...selected[0], name: 'qwen/HQL0.2.safetensors' }]), /重复/)
  for (const strength of [NaN, Infinity, 2.5, -3]) assert.throws(() => lora.selection([{ ...selected[0], strength }]), /权重/)
})

for (const [route, mode, nsfw, preset] of [
  ['img2img', 'img2img', false, 'faithful'],
  ['img2img', 'img2img', false, 'enhanced'],
  ['txt2imgNsfw', 'txt2img', true, 'fine'],
  ['img2imgNsfw', 'img2img', true, 'faithful'],
]) {
  test(`${route}/${preset}: real template keeps all model consumers and CLIP/VAE ports`, () => {
    const state = { provider: 'local', mode, nsfw, localTextQuality: preset, localEditStrength: preset, loras: selected }
    const graph = models.applyLocalWorkflowPreset(JSON.parse(templates[route]), state, mode)
    const before = JSON.parse(JSON.stringify(graph))
    const [baseId] = Object.entries(graph).find(([, n]) => ['UNETLoader', 'CheckpointLoaderSimple'].includes(n.class_type))
    const result = lora.apply(graph, state)
    assert.equal(result, graph)
    assert.equal(graph.nf_art_lora_1.inputs.lora_name, selected[0].name)
    assert.equal(graph.nf_art_lora_1.inputs.strength_model, 0.35)
    assert.deepEqual(graph.nf_art_lora_1.inputs.model, [baseId, 0])
    assert.deepEqual(graph.nf_art_lora_2.inputs.model, ['nf_art_lora_1', 0])
    let redirected = 0
    for (const [id, node] of Object.entries(before)) {
      for (const [field, value] of Object.entries(node.inputs || {})) {
        if (Array.isArray(value) && String(value[0]) === baseId && value[1] === 0) {
          assert.deepEqual(graph[id].inputs[field], ['nf_art_lora_2', 0]); redirected++
        } else assert.deepEqual(graph[id].inputs[field], value)
      }
    }
    assert.ok(redirected > 0)
    lora.validate(graph, info)
    assert.throws(() => lora.validate(graph, { LoraLoaderModelOnly: { input: { required: { lora_name: [[]] } } } }), /不可用/)
  })
}

test('unsupported providers and ordinary txt2img never apply retained selections', () => {
  for (const state of [
    { provider: 'local', mode: 'txt2img', nsfw: false },
    { provider: 'gpt', mode: 'img2img', nsfw: true },
    { provider: 'google', mode: 'txt2img', nsfw: true },
  ]) {
    const graph = { model: { class_type: 'OtherModel', inputs: {} } }
    assert.equal(lora.supports(state), false)
    assert.deepEqual(lora.apply(graph, { ...state, loras: selected }), graph)
  }
  assert.throws(() => lora.apply({}, { provider: 'local', mode: 'img2img', loras: selected }), /唯一/)
})

test('empty selection leaves original workflow byte-for-byte unchanged', () => {
  const graph = JSON.parse(templates.img2img)
  const before = JSON.stringify(graph)
  lora.apply(graph, { provider: 'local', mode: 'img2img', loras: [] })
  assert.equal(JSON.stringify(graph), before)
})

test('UI adds from one dropdown, updates strength, removes and locks during a run', async () => {
  class Element {
    constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.style = {}; this.attrs = {}; this.events = {} }
    setAttribute(k, v) { this.attrs[k] = v }
    appendChild(child) { this.children.push(child); return child }
    append(...children) { this.children.push(...children) }
    replaceChildren(...children) { this.children = children }
    addEventListener(event, fn) { this.events[event] = fn }
  }
  const doc = { createElement(tag) { return new Element(tag, doc) }, createTextNode(text) { return { textContent: text } } }
  const host = doc.createElement('div')
  const state = { provider: 'local', mode: 'img2img', loras: [{ ...selected[0] }] }
  const options = { host, state, loadCatalog: async () => info }
  const all = (node) => [node, ...(node.children || []).flatMap(all)]
  const field = (label) => all(host).find(x => x.attrs?.['aria-label'] === label)
  lora.mount(options)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(all(host).filter(x => x.tagName === 'select').length, 1)
  assert.equal(all(host).filter(x => x.type === 'checkbox' || x.type === 'number').length, 0)
  const add = field('添加兼容 LoRA')
  assert.equal(add.children.some(x => x.value === selected[0].name), false)
  add.value = selected[1].name; add.events.change()
  assert.equal(state.loras.length, 2)
  assert.equal(state.loras[1].strength, 1)
  const slider = field('LoRA 1 强度')
  slider.value = '0.65'; slider.events.input()
  assert.equal(state.loras[0].strength, 0.65)
  assert.ok(all(host).some(x => x.textContent === '强度: 0.65'))
  state.provider = 'gpt'; lora.mount(options)
  assert.equal(host.children[0].hidden, true)
  state.provider = 'local'; lora.mount(options)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(host.children[0].hidden, false)
  assert.equal(state.loras[0].name, selected[0].name)
  state.running = true; lora.mount(options)
  assert.equal(field('添加兼容 LoRA').disabled, true)
  assert.equal(field('LoRA 1 强度').disabled, true)
  field('LoRA 1 强度').value = '1'; field('LoRA 1 强度').events.input()
  assert.equal(state.loras[0].strength, 0.65)
  state.running = false; lora.mount(options)
  field(`移除 ${selected[0].name}`).events.click()
  assert.equal(state.loras.length, 1)
  assert.ok(field('添加兼容 LoRA').children.some(x => x.value === selected[0].name))
})

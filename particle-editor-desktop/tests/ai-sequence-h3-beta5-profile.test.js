const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../../particle-editor/ai-sequence-minimax-h3.workflow.js'), 'utf8')
function load(storage = new Map()) {
  const root = { localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } }
  vm.runInNewContext(source, { globalThis: root })
  return root.NovaFlowAiSequenceMiniMaxH3Workflow
}
const one = (graph, type) => Object.values(graph).find(n => n.class_type === type)
const inputs = { t2v: {}, i2v: { firstFrame: 'first.png' }, fl2v: { firstFrame: 'first.png', lastFrame: 'last.png' }, r2v: { referenceImages: ['first.png', 'second.png'], referenceVideo: 'motion.mp4', referenceAudio: 'sound.wav' } }
test('Both beta5 profiles bind distinct real checkpoints without automatic Turbo adapters', () => {
  const api = load()
  for (const profile of api.PROFILES.filter(p => p.id !== 'classic')) {
    for (const mode of Object.keys(inputs)) for (const steps of [4, 20]) {
      const options = { profile: profile.id, mode, steps, prompt: 'A red toy boat on a calm pond.', ...inputs[mode] }
      const graph = api.buildWorkflow(options)
      assert.equal(one(graph, 'UNETLoader').inputs.unet_name, profile.checkpoint)
      assert.equal(one(graph, 'LoraLoaderModelOnly'), undefined)
      assert.equal(one(graph, 'BasicScheduler').inputs.steps, steps)
      assert.equal(api.validateWorkflow(graph, options), true)
      assert.throws(() => api.validateWorkflow(graph, { ...options, profile: 'classic' }), /Unknown H3 profile/)
      const other = profile.id === 'beta5_int8' ? 'beta5_fp8' : 'beta5_int8'
      assert.throws(() => api.validateWorkflow(graph, { ...options, profile: other }), /wrong UNet/)
      const template = JSON.parse(api.getWorkflowJson({ mode, profile: profile.id, steps }))
      assert.equal(one(api.patchWorkflow(template, options), 'UNETLoader').inputs.unet_name, profile.checkpoint)
    }
    const defaults = api.buildWorkflow({ profile: profile.id, mode: 't2v', prompt: 'A toy boat.' })
    assert.equal(one(defaults, 'BasicScheduler').inputs.steps, 4)
    assert.equal(api.supportsMode(profile.id, 'multi_reference'), true)
    assert.equal(api.supportsMode(profile.id, 'r2v'), true)
    assert.equal(api.supportsMode(profile.id, 'invalid'), false)
    assert.throws(() => api.buildWorkflow({ profile: profile.id, mode: 'r2v', prompt: 'A toy boat.' }), /requires an image, video, or audio reference/)
  }
})
test('Only beta5 profiles remain and omitted profile always builds INT8', () => {
  const api = load()
  assert.deepEqual(Array.from(api.PROFILES, p => p.id), ['beta5_int8', 'beta5_fp8'])
  assert.equal(api.getSelectedProfile(), 'beta5_int8')
  const standard = api.buildWorkflow({ mode: 't2v', prompt: 'A toy boat.' })
  assert.equal(one(standard, 'LoraLoaderModelOnly'), undefined)
  assert.equal(one(standard, 'UNETLoader').inputs.unet_name, api.PROFILES[0].checkpoint)
  const ref = api.buildWorkflow({ mode: 'r2v', prompt: 'A toy boat.', referenceImages: ['first.png'] })
  assert.equal(one(ref, 'UNETLoader').inputs.unet_name, api.PROFILES[0].checkpoint)
  api.setSelectedProfile('beta5_fp8')
  assert.deepEqual(api.buildWorkflow({ mode: 't2v', prompt: 'A toy boat.' }), standard)
  assert.throws(() => api.buildWorkflow({ profile: 'classic', mode: 't2v' }), /Unknown H3 profile/)
})

test('Selection and independent parameters survive reload without crossing profiles', () => {
  const storage = new Map()
  const api = load(storage)
  api.saveProfileSettings('beta5_int8', { steps: 28, durationSeconds: 8 })
  api.saveProfileSettings('beta5_fp8', { steps: 16, fps: 16 })
  api.setSelectedProfile('beta5_fp8')
  const restored = load(storage)
  assert.equal(restored.getSelectedProfile(), 'beta5_fp8')
  assert.equal(restored.getProfileSettings().steps, 16)
  assert.equal(restored.getProfileSettings('beta5_int8').steps, 28)
  restored.saveProfileSettings('beta5_fp8', { steps: -1 })
  assert.equal(restored.getProfileSettings().steps, 4)
})

test('repairs the old beta5 20-step default once and preserves later explicit settings', () => {
  const storage = new Map([['novaflow-h3-beta5-profiles-v1', JSON.stringify({
    selected: 'beta5_int8', settings: { beta5_int8: { steps: 20 }, beta5_fp8: { steps: 12 }, classic: { steps: 20 } },
  })]])
  const api = load(storage)
  assert.equal(api.getProfileSettings('beta5_int8').steps, 4)
  assert.equal(api.getProfileSettings('beta5_fp8').steps, 12)
  assert.throws(() => api.getProfileSettings('classic'), /Unknown H3 profile/)
  api.saveProfileSettings('beta5_int8', { steps: 20 })
  assert.equal(load(storage).getProfileSettings('beta5_int8').steps, 20)
})

test('structurally identified H3 LoRAs reach both beta5 workflows at four steps', () => {
  const api = load()
  const loras = [{ name: 'minimax_h3/style.safetensors', modelFamily: 'h3', kind: 'standard', strength: 0.8, fingerprint: 'v1:123456:1750000000000.125:' + 'a'.repeat(64) }]
  for (const profile of ['beta5_int8', 'beta5_fp8']) {
    const options = { profile, mode: 't2v', prompt: 'A toy boat.', loras }
    const graph = api.buildWorkflow(options)
    assert.equal(api.validateWorkflow(graph, options), true)
    assert.equal(one(graph, 'LoraLoaderModelOnly').inputs.lora_name, loras[0].name)
    assert.equal(Object.values(graph).filter(n => n.class_type === 'LoraLoaderModelOnly').length, 1)
  }
})

test('SageAttention changes only the beta5 model attention path and preserves LoRA order', () => {
  const api = load()
  for (const profile of ['beta5_fp8', 'beta5_int8']) for (const mode of Object.keys(inputs)) {
    for (const loras of [[], [{ name: 'minimax_h3/style.safetensors', modelFamily: 'h3', kind: 'standard', strength: 0.8, fingerprint: 'v1:123456:1750000000000.125:' + 'a'.repeat(64) }]]) {
      const options = { profile, mode, prompt: 'A toy boat.', steps: 4, loras, ...inputs[mode] }
      const plain = api.buildWorkflow({ ...options, acceleration: 'off' })
      const accelerated = api.buildWorkflow(options)
      assert.equal(api.validateWorkflow(accelerated, { ...options, acceleration: 'sage' }), true)
      assert.throws(() => api.validateWorkflow(accelerated, { ...options, acceleration: 'off' }), /NovaFlowH3SageAttention/)
      assert.throws(() => api.validateWorkflow(plain, { ...options, acceleration: 'sage' }), /NovaFlowH3SageAttention/)
      assert.deepEqual(one(accelerated, 'UNETLoader'), one(plain, 'UNETLoader'))
      assert.deepEqual(one(accelerated, 'BasicScheduler'), one(plain, 'BasicScheduler'))
      assert.deepEqual(one(accelerated, 'KSamplerSelect'), one(plain, 'KSamplerSelect'))
      const broken = JSON.parse(JSON.stringify(accelerated))
      one(broken, 'BasicGuider').inputs.model = ['1', 0]
      assert.throws(() => api.validateWorkflow(broken, { ...options, acceleration: 'sage' }), /guider model/)
    }
    assert.equal(load().getProfileSettings(profile).acceleration, 'sage')
    api.saveProfileSettings(profile, { acceleration: 'off' })
    assert.equal(api.getProfileSettings(profile).acceleration, 'sage')
  }
  assert.throws(() => api.buildWorkflow({ profile: 'classic', acceleration: 'sage', mode: 't2v' }), /Unknown H3 profile/)
  assert.throws(() => api.buildWorkflow({ profile: 'beta5_int8', acceleration: 'typo', mode: 't2v' }), /Unknown H3 acceleration/)
})

test('old version selection migrates to low-VRAM off once and the new toggle survives reload', () => {
  for (const selected of ['classic', 'beta5_fp8']) {
    const storage = new Map([['novaflow-h3-beta5-profiles-v1', JSON.stringify({ selected, defaultsVersion: 2, settings: { beta5_int8: { steps: 6 } } })]])
    const api = load(storage)
    assert.equal(api.getSelectedProfile(), 'beta5_int8')
    assert.equal(api.getProfileSettings().steps, 6)
    api.setSelectedProfile('beta5_fp8')
    assert.equal(load(storage).getSelectedProfile(), 'beta5_fp8')
    api.setSelectedProfile('beta5_int8')
    assert.equal(load(storage).getSelectedProfile(), 'beta5_int8')
  }
})

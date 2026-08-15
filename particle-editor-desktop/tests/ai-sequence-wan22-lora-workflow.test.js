const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const workflowPath = path.resolve(__dirname, '../../particle-editor/ai-sequence-wan22-lora.workflow.js')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')

function loadWorkflowModule() {
  const context = { module: { exports: {} }, exports: {}, console }
  context.globalThis = context
  vm.runInNewContext(workflowSource, context, { filename: workflowPath })
  return { api: context.module.exports, browserApi: context.NovaFlowAiSequenceWan22LoraWorkflow }
}

const workflowModule = loadWorkflowModule().api

const HASH = 'a'.repeat(64)
const HIGH_HASH = 'b'.repeat(64)
const LOW_HASH = 'c'.repeat(64)

function descriptor(name, role, strength, index = 0) {
  return {
    name,
    role,
    strength,
    weight: strength,
    enabled: true,
    modelFamily: 'wan2.2_i2v_14b',
    kind: 'standard',
    supportedSteps: null,
    fingerprint: `v1:${100 + index}:1786360000000.${index}:${HASH}`,
    highFingerprint: `v1:200:1786360000001:${HIGH_HASH}`,
    lowFingerprint: `v1:300:1786360000002:${LOW_HASH}`,
  }
}

function actualStyleWorkflow(options = {}) {
  const ids = options.reversed
    ? { high: '239', low: '232', highSwap: '222', lowSwap: '221', highLine: '287', lowLine: '288', sampler: '229' }
    : { high: '37', low: '56', highSwap: '210', lowSwap: '215', highLine: '287', lowLine: '288', sampler: '186' }
  const prompt = {}
  const entries = [
    [ids.lowLine, { class_type: 'LaoLi_Lineup', inputs: { model: [ids.lowSwap, 0], multiplier: 1 } }],
    [ids.high, { class_type: 'UNETLoader', inputs: { unet_name: 'smoothMixWan22I2V14B_i2vHigh.safetensors', weight_dtype: 'default' } }],
    [ids.sampler, {
      class_type: 'WanMoeKSampler',
      inputs: {
        model_low_noise: [ids.lowLine, 0],
        model_high_noise: [ids.highLine, 0],
        steps: 20,
      },
    }],
    [ids.low, { class_type: 'UNETLoader', inputs: { unet_name: 'smoothMixWan22I2V14B_i2vLow.safetensors', weight_dtype: 'default' } }],
    [ids.highLine, { class_type: 'LaoLi_Lineup', inputs: { model: [ids.highSwap, 0], multiplier: 1 } }],
    [ids.lowSwap, { class_type: 'wanBlockSwap', inputs: { model: [ids.low, 0], blocks_to_swap: 20 } }],
    [ids.highSwap, { class_type: 'wanBlockSwap', inputs: { model: [ids.high, 0], blocks_to_swap: 20 } }],
  ]
  for (const [id, node] of options.reversed ? entries.reverse() : entries) prompt[id] = node
  return options.envelope ? { prompt, extra_data: { client_id: 'unchanged' } } : prompt
}

function namesForBranch(result, branch) {
  const prompt = result.workflow.prompt || result.workflow
  return Array.from(result.injectedNodeIds[branch], (id) => prompt[id].inputs.lora_name)
}

test('exports the role-aware Wan workflow API for CommonJS and browsers', () => {
  assert.equal(typeof workflowModule.buildRoleAwareWorkflow, 'function')
  assert.equal(typeof workflowModule.routeValidatedLoras, 'function')
  assert.equal(typeof workflowModule.identifyBranches, 'function')
  assert.equal(typeof workflowModule.validateRoleAwareWorkflow, 'function')

  assert.equal(typeof loadWorkflowModule().browserApi?.buildRoleAwareWorkflow, 'function')
  assert.doesNotMatch(workflowSource, /minimax|h3/i)
})

test('routes mixed High Low and shared LoRAs in user order without cross-branch leakage', () => {
  const input = actualStyleWorkflow({ envelope: true })
  const pristine = JSON.parse(JSON.stringify(input))
  const loras = [
    descriptor('wan2_2/low-a.safetensors', 'low', 0.2, 1),
    descriptor('wan2_2/shared-a.safetensors', 'shared', 0.3, 2),
    descriptor('wan2_2/high-a.safetensors', 'high', 0.4, 3),
    descriptor('wan2_2/shared-b.safetensors', 'shared', 0.5, 4),
  ]
  const result = workflowModule.buildRoleAwareWorkflow(input, loras)

  assert.deepEqual(input, pristine, 'the caller-owned workflow must not be mutated')
  assert.notEqual(result.workflow, input)
  assert.deepEqual(namesForBranch(result, 'high'), [
    'wan2_2/shared-a.safetensors',
    'wan2_2/high-a.safetensors',
    'wan2_2/shared-b.safetensors',
  ])
  assert.deepEqual(namesForBranch(result, 'low'), [
    'wan2_2/low-a.safetensors',
    'wan2_2/shared-a.safetensors',
    'wan2_2/shared-b.safetensors',
  ])
  assert.equal(result.workflow.extra_data.client_id, 'unchanged')

  const highIds = new Set(result.anchors.highPathNodeIds)
  const lowIds = new Set(result.anchors.lowPathNodeIds)
  assert.ok(result.injectedNodeIds.high.every((id) => highIds.has(id) && !lowIds.has(id)))
  assert.ok(result.injectedNodeIds.low.every((id) => lowIds.has(id) && !highIds.has(id)))
  assert.deepEqual(Array.from(result.routes.high, (item) => item.role), ['shared', 'high', 'shared'])
  assert.deepEqual(Array.from(result.routes.low, (item) => item.role), ['low', 'shared', 'shared'])
  assert.equal(result.routes.high[0].fingerprint, loras[1].fingerprint)
  assert.equal(result.routes.low[0].fingerprint, loras[0].fingerprint)
})

test('identifies High and Low by graph connectivity when node insertion order is reversed', () => {
  const workflow = actualStyleWorkflow({ reversed: true })
  const result = workflowModule.buildRoleAwareWorkflow(workflow, [
    descriptor('wan2_2/high-only.safetensors', 'high', 0.65, 5),
    descriptor('wan2_2/low-only.safetensors', 'low', 0.75, 6),
  ])
  assert.equal(result.anchors.highUnetId, '239')
  assert.equal(result.anchors.lowUnetId, '232')
  assert.deepEqual(namesForBranch(result, 'high'), ['wan2_2/high-only.safetensors'])
  assert.deepEqual(namesForBranch(result, 'low'), ['wan2_2/low-only.safetensors'])
  assert.doesNotThrow(() => workflowModule.validateRoleAwareWorkflow(result.workflow, result.routes.all))
})

test('rejects ambiguous, overlapping, swapped, and disconnected model graphs', () => {
  const ambiguous = actualStyleWorkflow()
  ambiguous['900'] = { class_type: 'UNETLoader', inputs: { unet_name: 'other_i2vHigh.safetensors' } }
  ambiguous['287'].inputs.model_backup = ['900', 0]
  assert.throws(() => workflowModule.identifyBranches(ambiguous), /high model branch is ambiguous/i)

  const overlapping = actualStyleWorkflow()
  overlapping['186'].inputs.model_low_noise = ['287', 0]
  assert.throws(() => workflowModule.identifyBranches(overlapping), /wrong UNET|share one UNET|overlap/i)

  const swapped = actualStyleWorkflow()
  const highInput = swapped['186'].inputs.model_high_noise
  swapped['186'].inputs.model_high_noise = swapped['186'].inputs.model_low_noise
  swapped['186'].inputs.model_low_noise = highInput
  assert.throws(() => workflowModule.identifyBranches(swapped), /wrong UNET/i)

  const disconnected = actualStyleWorkflow()
  delete disconnected['186'].inputs.model_low_noise
  assert.throws(() => workflowModule.identifyBranches(disconnected), /connected High and Low sampler/i)
})

test('validation detects cross-branch rewiring and descriptor tampering', () => {
  const loras = [
    descriptor('wan2_2/shared.safetensors', 'shared', 0.35, 7),
    descriptor('wan2_2/high.safetensors', 'high', 0.45, 8),
  ]
  const result = workflowModule.buildRoleAwareWorkflow(actualStyleWorkflow(), loras)
  const crossed = JSON.parse(JSON.stringify(result.workflow))
  crossed['186'].inputs.model_low_noise = [result.injectedNodeIds.high.at(-1), 0]
  assert.throws(() => workflowModule.validateRoleAwareWorkflow(crossed, loras), /wrong UNET|share one UNET|overlap|crossed/i)

  const tampered = JSON.parse(JSON.stringify(result.workflow))
  tampered[result.injectedNodeIds.high[0]].inputs.strength_model = 1.9
  assert.throws(() => workflowModule.validateRoleAwareWorkflow(tampered, loras), /does not match/i)
})

test('fails closed for invalid role, fingerprint, strength, duplicate, or unsafe name', () => {
  const base = descriptor('wan2_2/good.safetensors', 'high', 0.5, 9)
  assert.throws(() => workflowModule.routeValidatedLoras([{ ...base, role: 'both' }]), /role is invalid/i)
  assert.throws(() => workflowModule.routeValidatedLoras([{ ...base, fingerprint: 'fake' }]), /fingerprint is invalid/i)
  assert.throws(() => workflowModule.routeValidatedLoras([{ ...base, strength: 3, weight: 3 }]), /strength must be from 0 to 2/i)
  assert.throws(() => workflowModule.routeValidatedLoras([{ ...base, name: '../escape.safetensors' }]), /name is unsafe/i)
  assert.throws(() => workflowModule.routeValidatedLoras([base, { ...base }]), /duplicated/i)
})

test('routes role-specific LoRAs through every active smoothMix Wan template', () => {
  const bundle = fs.readFileSync(path.resolve(__dirname, '../../particle-editor/assets/index-BbIa-2NM.js'), 'utf8')
  const marker = 'String.raw`'
  const templates = []
  let cursor = 0
  while ((cursor = bundle.indexOf(marker, cursor)) >= 0) {
    const start = cursor + marker.length
    const end = bundle.indexOf('`', start)
    assert.notEqual(end, -1, 'active bundle contains an unterminated String.raw workflow')
    const raw = bundle.slice(start, end)
    if (raw.includes('smoothMixWan22')) templates.push(JSON.parse(raw))
    cursor = end + 1
  }
  assert.equal(templates.length, 3, 'all three active smoothMix Wan templates must be covered')
  const selected = [
    descriptor('wan2_2/high-only.safetensors', 'high', 0.6, 21),
    descriptor('wan2_2/low-only.safetensors', 'low', 0.7, 22),
  ]
  for (const template of templates) {
    const built = workflowModule.buildRoleAwareWorkflow(template, selected)
    assert.equal(built.injectedNodeIds.high.length, 1)
    assert.equal(built.injectedNodeIds.low.length, 1)
    const prompt = built.workflow.prompt || built.workflow
    assert.equal(prompt[built.injectedNodeIds.high[0]].inputs.lora_name, selected[0].name)
    assert.equal(prompt[built.injectedNodeIds.low[0]].inputs.lora_name, selected[1].name)
  }
})

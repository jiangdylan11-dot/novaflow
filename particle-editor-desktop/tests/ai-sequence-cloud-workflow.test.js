const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const frameModePath = path.join(root, 'particle-editor', 'ai-sequence-frame-mode.js')
const workflowPath = path.join(root, 'particle-editor', 'ai-sequence-cloud-workflow.js')
const creditCostPath = path.join(root, 'particle-editor', 'comfyui-workflow-credit-cost.js')
const window = {}
window.window = window
window.globalThis = window

for (const filePath of [frameModePath, workflowPath, creditCostPath]) {
  vm.runInNewContext(readFileSync(filePath, 'utf8'), {
    window,
    globalThis: window,
    console,
  }, { filename: filePath })
}

const workflow = window.NovaFlowAiSequenceCloudWorkflow
const creditCost = window.NovaFlowComfyWorkflowCreditCost
assert.ok(workflow, 'cloud workflow module must be exposed')
assert.ok(creditCost, 'workflow settlement module must be exposed')

const omniSnapshot = {
  mode: 'cloud',
  provider: 'kling',
  genType: 'image_video',
  params: {
    strictFirstFrame: false,
    aspectRatio: '16:9',
    resolution: '720p',
    generateAudio: true,
    storyboardCount: 2,
    storyboard1Duration: 4,
    storyboard2Duration: 5,
    storyboard1Prompt: 'stale shot one',
    storyboard2Prompt: 'stale shot two',
  },
}
assert.equal(workflow.handlesRoute(omniSnapshot), true)
const omni = workflow.patchWorkflow(JSON.parse(workflow.getWorkflowJson(omniSnapshot)), {
  ...omniSnapshot,
  prompt: 'fallback prompt',
  images: ['uploaded-reference.png'],
  storyboardPrompts: ['shot one', 'shot two'],
  seed: 123,
})
assert.equal(omni['3'].class_type, 'KlingOmniProImageToVideoNode')
assert.equal(omni['3'].inputs.model_name, 'kling-v3-omni')
assert.equal(omni['3'].inputs.aspect_ratio, '16:9')
assert.equal(omni['3'].inputs.resolution, '720p')
assert.equal(omni['3'].inputs.duration, 9)
assert.equal(omni['3'].inputs.storyboards, '2 storyboards')
assert.equal(omni['3'].inputs['storyboards.storyboard_1_prompt'], 'shot one')
assert.equal(omni['3'].inputs['storyboards.storyboard_2_prompt'], 'shot two')
assert.deepEqual(Array.from(omni['3'].inputs.reference_images), ['1', 0])
assert.equal(omni['1'].inputs.image, 'uploaded-reference.png')
assert.equal(omni['3'].inputs.seed, 123)
const omniSettlement = creditCost.estimateWorkflowCreditCost({ prompt: omni })
assert.equal(omniSettlement.workflowNodeType, 'KlingOmniProImageToVideoNode')
assert.ok(Math.abs(omniSettlement.estimatedCreditCost - 212.688) < 1e-9)
assert.equal(omniSettlement.creditCost, 213)

const strictSeedanceSnapshot = {
  mode: 'cloud',
  provider: 'jimeng',
  genType: 'image_video',
  params: {
    strictFirstFrame: true,
    model: 'Seedance 2.0',
    aspectRatio: '9:16',
    resolution: '1080p',
    duration: 7,
    generateAudio: false,
  },
}
assert.equal(workflow.handlesRoute(strictSeedanceSnapshot), true)
const strictSeedance = workflow.patchWorkflow(JSON.parse(workflow.getWorkflowJson(strictSeedanceSnapshot)), {
  ...strictSeedanceSnapshot,
  prompt: 'strict first frame',
  images: ['prepared-first-frame.png'],
  seed: 456,
})
assert.equal(strictSeedance['2'].class_type, 'ByteDance2FirstLastFrameNode')
assert.equal(strictSeedance['2'].inputs['model.ratio'], '9:16')
assert.equal(strictSeedance['2'].inputs['model.resolution'], '1080p')
assert.equal(strictSeedance['2'].inputs['model.generate_audio'], false)
assert.deepEqual(Array.from(strictSeedance['2'].inputs.first_frame), ['3', 0])
assert.equal('last_frame' in strictSeedance['2'].inputs, false)
assert.equal(strictSeedance['3'].inputs.image, 'prepared-first-frame.png')
const strictSeedanceSettlement = creditCost.estimateWorkflowCreditCost({ prompt: strictSeedance })
assert.equal(strictSeedanceSettlement.workflowNodeType, 'ByteDance2FirstLastFrameNode')
assert.ok(Math.abs(strictSeedanceSettlement.estimatedCreditCost - 721.496776) < 1e-9)
assert.equal(strictSeedanceSettlement.creditCost, 722)

const strictSeedanceMinimumDuration = workflow.patchWorkflow(
  JSON.parse(workflow.getWorkflowJson(strictSeedanceSnapshot)),
  {
    ...strictSeedanceSnapshot,
    params: { ...strictSeedanceSnapshot.params, duration: 1 },
    prompt: 'minimum duration',
    images: ['prepared-first-frame.png'],
  },
)
assert.equal(strictSeedanceMinimumDuration['2'].inputs['model.duration'], 4)

assert.equal(workflow.handlesRoute({
  ...omniSnapshot,
  params: { ...omniSnapshot.params, strictFirstFrame: true },
}), false, 'strict Kling reuses the proven KlingVideo workflow')
assert.equal(workflow.handlesRoute({
  ...strictSeedanceSnapshot,
  genType: 'first_last',
}), false, 'explicit first-last generation keeps the existing workflow')

assert.throws(() => workflow.patchWorkflow(JSON.parse(workflow.getWorkflowJson(omniSnapshot)), {
  ...omniSnapshot,
  params: {
    ...omniSnapshot.params,
    storyboard1Prompt: '',
    storyboard2Prompt: '',
  },
  images: ['uploaded-reference.png'],
  storyboardPrompts: ['', 'shot two'],
}), /storyboard prompt is empty/)

console.log('AI sequence cloud workflow tests passed')

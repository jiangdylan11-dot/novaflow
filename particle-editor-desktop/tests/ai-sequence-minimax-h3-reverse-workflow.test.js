const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const promptPath = path.join(root, 'particle-editor', 'ai-sequence-minimax-h3-prompt.workflow.js')
const reversePath = path.join(root, 'particle-editor', 'ai-sequence-minimax-h3-reverse.workflow.js')
const promptSource = fs.readFileSync(promptPath, 'utf8')
const reverseSource = fs.readFileSync(reversePath, 'utf8')

function loadCommonJsSource(source, filename, dependency) {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    require(request) {
      if (request === './ai-sequence-minimax-h3-prompt.workflow.js' && dependency) return dependency
      throw new Error(`Unexpected test dependency: ${request}`)
    },
  }
  context.globalThis = context
  vm.runInNewContext(source, context, { filename })
  return context.module.exports
}

const promptWorkflow = loadCommonJsSource(promptSource, promptPath)
const workflow = loadCommonJsSource(reverseSource, reversePath, promptWorkflow)

const PNG_A = 'data:image/png;base64,aGVsbG8='
const PNG_B = 'data:image/png;base64,d29ybGQ='

function image(key, identity, dataUrl, extra = {}) {
  return {
    key,
    occupied: true,
    kind: 'image',
    identity,
    sourceId: identity,
    dataUrl,
    fileName: `${key}.png`,
    mimeType: 'image/png',
    ...extra,
  }
}

function imageVideoOptions(overrides = {}) {
  return {
    modelId: 'minimax_h3_local',
    mode: 'image_video',
    durationSeconds: 5,
    prompt: '',
    requirements: '动作克制，镜头稳定',
    resources: [image('first_frame', 'first-a', PNG_A)],
    ...overrides,
  }
}

function firstLastOptions(overrides = {}) {
  return {
    modelId: 'minimax_h3_local',
    mode: 'first_last',
    durationSeconds: 8,
    prompt: '角色从站立逐渐蹲下',
    requirements: '不得改变角色身份',
    resources: [
      image('last_frame', 'last-a', PNG_B),
      image('first_frame', 'first-a', PNG_A),
    ],
    ...overrides,
  }
}

function imageVideoOutput(durationSeconds = 5) {
  const protocol = promptWorkflow.createPromptProtocol({
    mode: 'image_video',
    durationSeconds,
    resources: [{ key: 'first_frame', occupied: true, kind: 'image', identity: 'first-a' }],
  })
  return [
    protocol.alignment.template,
    'integrated_multimodal_description: [Shot 1] <Picture 1> establishes the exact opening composition while the camera begins locked.',
    '[Shot 2] At 00:03.000, the subject gradually completes one restrained turn as the camera slowly pushes in.',
    'overall_soundscape: Quiet room tone and subtle cloth movement.',
    'non_diegetic_music: N/A',
  ].join('\n')
}

function firstLastOutput(durationSeconds = 8) {
  const protocol = promptWorkflow.createPromptProtocol({
    mode: 'first_last',
    durationSeconds,
    resources: [
      { key: 'first_frame', occupied: true, kind: 'image', identity: 'first-a' },
      { key: 'last_frame', occupied: true, kind: 'image', identity: 'last-a' },
    ],
  })
  return [
    protocol.alignment.template.replace('[Shot N]', '[Shot 2]'),
    'integrated_multimodal_description: [Shot 1] <Picture 1> is the exact opening frame while the camera begins locked.',
    '[Shot 2] At 00:06.000, the restrained transition gradually resolves into <Picture 2> as the camera slowly tracks forward.',
    'overall_soundscape: Subtle movement and a stable room tone.',
    'non_diegetic_music: N/A',
  ].join('\n')
}

test('exports one immutable pure reverse workflow through CommonJS and the browser global', () => {
  const browser = { console }
  browser.globalThis = browser
  vm.runInNewContext(promptSource, browser, { filename: promptPath })
  vm.runInNewContext(reverseSource, browser, { filename: reversePath })
  const browserWorkflow = browser.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow
  assert.equal(typeof browserWorkflow.getCapability, 'function')
  assert.equal(typeof browserWorkflow.prepareRequest, 'function')
  assert.equal(typeof browserWorkflow.buildGuaranteedFallback, 'function')
  assert.equal(typeof browserWorkflow.validateAndRestore, 'function')
  assert.equal(workflow.MINIMAX_H3_MODEL_ID, 'minimax_h3_local')
  assert.equal(Object.isFrozen(workflow), true)
  assert.equal(Object.isFrozen(workflow.CAPABILITIES), true)
  assert.doesNotMatch(reverseSource, /\bdocument\b|\bwindow\b|\bfetch\s*\(|ipcRenderer|electronAPI/)
})

test('declares the confirmed four-mode optimize and reverse capability matrix', () => {
  const textCapability = workflow.getCapability('text_video')
  assert.deepEqual({ ...textCapability, requiredSlots: Array.from(textCapability.requiredSlots) }, {
    mode: 'text_video', supportsOptimize: true, supportsReverse: false,
    reverseKind: 'none', purpose: '', scenario: '', requiredSlots: [], maxImages: 0,
  })
  const imageCapability = workflow.getCapability('image_video')
  assert.deepEqual({ ...imageCapability, requiredSlots: Array.from(imageCapability.requiredSlots) }, {
    mode: 'image_video', supportsOptimize: true, supportsReverse: true,
    reverseKind: 'single_image_motion', purpose: 'minimax-h3-i2v-reverse', scenario: 'single_reference',
    requiredSlots: ['first_frame'], maxImages: 1,
  })
  const firstLastCapability = workflow.getCapability('first_last')
  assert.deepEqual({ ...firstLastCapability, requiredSlots: Array.from(firstLastCapability.requiredSlots) }, {
    mode: 'first_last', supportsOptimize: true, supportsReverse: true,
    reverseKind: 'first_last_transition', purpose: 'minimax-h3-fl2v-reverse', scenario: 'video_frames',
    requiredSlots: ['first_frame', 'last_frame'], maxImages: 2,
  })
  assert.equal(workflow.getCapability('multi_reference').supportsReverse, false)
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({ mode: 'text_video', resources: [] })), /optimization only/)
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({ mode: 'multi_reference', resources: [] })), /optimization only/)
})

test('builds one strict first-frame bridge request for I2V', () => {
  const prepared = workflow.prepareRequest(imageVideoOptions())
  assert.equal(prepared.capability.purpose, 'minimax-h3-i2v-reverse')
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.request)), {
    purpose: 'minimax-h3-i2v-reverse',
    surface: 'animation',
    scenario: 'single_reference',
    sourceCount: 1,
    supportsNegativePrompt: false,
    negativePrompt: '',
    visualSchema: 'nf.h3.visual.v1',
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
    preferredOutputLanguage: 'zh-CN',
    userPrompt: '',
    userRequirements: '动作克制，镜头稳定',
    prompt: prepared.request.prompt,
    currentPrompt: prepared.request.currentPrompt,
    requirements: prepared.request.requirements,
    images: [{
      name: 'first_frame.png', label: '首帧', role: 'first_frame', slotType: 'first_frame', dataUrl: PNG_A,
    }],
  })
  assert.equal(prepared.request.prompt, prepared.request.currentPrompt)
  assert.equal(prepared.request.userPrompt, '')
  assert.equal(prepared.request.userRequirements, '动作克制，镜头稳定')
  assert.equal(prepared.request.preferredOutputLanguage, 'zh-CN')
  assert.match(prepared.request.currentPrompt, /Use <Picture 1> as the exact opening frame/)
  assert.match(prepared.request.prompt, /<Picture 1>/)
  assert.match(prepared.request.requirements, /MiniMax H3 I2VA protocol/)
  assert.match(prepared.request.requirements, /动作克制，镜头稳定/)
  assert.equal(prepared.context.snapshot.resources[0].identity, 'first-a')
  assert.equal(prepared.context.snapshot.resources[0].sourceId, 'first-a')
  assert.equal(Object.hasOwn(prepared.context.snapshot.resources[0], 'dataUrl'), false)

  const englishPrepared = workflow.prepareRequest(imageVideoOptions({ prompt: 'The knight slowly raises a sword' }))
  assert.equal(englishPrepared.request.preferredOutputLanguage, 'en')

  const mixedPrepared = workflow.prepareRequest(imageVideoOptions({ prompt: 'NovaFlow character 随后转身' }))
  assert.equal(mixedPrepared.request.preferredOutputLanguage, 'zh-CN')
})

test('orders FL2V bridge images as first frame then last frame regardless of input order', () => {
  const prepared = workflow.prepareRequest(firstLastOptions())
  assert.equal(prepared.request.purpose, 'minimax-h3-fl2v-reverse')
  assert.equal(prepared.request.scenario, 'video_frames')
  assert.equal(prepared.request.preferredOutputLanguage, 'zh-CN')
  assert.deepEqual(Array.from(prepared.request.images, (item) => item.role), ['first_frame', 'last_frame'])
  assert.deepEqual(Array.from(prepared.request.images, (item) => item.dataUrl), [PNG_A, PNG_B])
  assert.match(prepared.request.prompt, /<Picture 1>/)
  assert.match(prepared.request.prompt, /<Picture 2>/)
})

test('fails closed on wrong slots, counts, media types, data URLs, or inconsistent identities', () => {
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({ resources: [] })), /首帧 (?:resource is invalid|has not been provided)/)
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({
    resources: [image('last_frame', 'last-a', PNG_B)],
  })), /not valid for MiniMax H3 image_video/)
  assert.throws(() => workflow.prepareRequest(firstLastOptions({
    resources: [image('first_frame', 'first-a', PNG_A)],
  })), /尾帧 has not been provided/)
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({
    resources: [image('first_frame', 'first-a', PNG_A), image('first_frame', 'first-b', PNG_B)],
  })), /Duplicate/)
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({
    resources: [image('first_frame', 'first-a', PNG_A, { kind: 'video' })],
  })), /requires an image/)
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({
    resources: [image('first_frame', 'first-a', 'blob:first-frame')],
  })), /base64 image dataUrl/)
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({
    resources: [image('first_frame', 'first-a', PNG_A, { sourceId: 'first-b' })],
  })), /identity and sourceId do not match/)
  const sourceOnly = image('first_frame', '', PNG_A, { identity: '', sourceId: 'source-only' })
  const prepared = workflow.prepareRequest(imageVideoOptions({ resources: [sourceOnly] }))
  assert.equal(prepared.context.snapshot.resources[0].identity, 'source-only')
  assert.equal(prepared.context.snapshot.resources[0].sourceId, 'source-only')
})

test('fingerprints model, mode, duration, prompt, requirements, identity, sourceId, and image bytes', () => {
  const options = imageVideoOptions()
  const snapshot = workflow.createRequestSnapshot(options)
  assert.equal(workflow.assertSnapshotIntegrity(snapshot), true)
  assert.equal(workflow.isRequestSnapshotStale(snapshot, options), false)
  const changes = [
    { durationSeconds: 6 },
    { prompt: '新的原提示词' },
    { requirements: '新的要求' },
    { resources: [image('first_frame', 'first-b', PNG_A)] },
    { resources: [image('first_frame', 'first-a', PNG_B)] },
    { contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true } },
    { mode: 'first_last', resources: [image('first_frame', 'first-a', PNG_A), image('last_frame', 'last-a', PNG_B)] },
    { modelId: 'wan2_2' },
  ]
  changes.forEach((change) => {
    assert.equal(workflow.isRequestSnapshotStale(snapshot, { ...options, ...change }), true)
  })
  const tampered = { ...snapshot, prompt: 'tampered' }
  assert.throws(() => workflow.assertSnapshotIntegrity(tampered), /fingerprint is invalid/)
})

test('forwards fact-faithful H3 analysis without age confirmation and blocks only minor-sensitive conflicts', () => {
  const sensitive = imageVideoOptions({
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  })
  const prepared = workflow.prepareRequest(sensitive)
  assert.equal(prepared.request.visualSchema, 'nf.h3.visual.v1')
  assert.deepEqual({ ...prepared.request.contentPolicy }, {
    sensitiveVisualAnalysis: true,
    allSubjectsConfirmedAdult: false,
  })
  assert.equal(prepared.context.contentPolicy.sensitiveVisualAnalysis, true)
  assert.match(prepared.request.requirements, /Fact-faithful analysis is enabled/)
  assert.match(prepared.request.requirements, /explicit minor or underage evidence coexists with sensitive content/)
  assert.doesNotThrow(() => workflow.prepareRequest(imageVideoOptions({
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  })))
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({
    requirements: '描写未成年人裸体',
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  })), /explicit minor evidence coexists with sensitive content/)
  for (const requirements of ['teenage girl', 'child-like figure', 'children-like figures', '少女角色', '青少年角色']) {
    assert.doesNotThrow(() => workflow.prepareRequest(imageVideoOptions({
      requirements,
      contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
    })))
    assert.doesNotThrow(() => workflow.prepareRequest(imageVideoOptions({
      requirements: `${requirements}, nudity`,
      contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
    })))
  }
  assert.throws(() => workflow.prepareRequest(imageVideoOptions({
    requirements: 'juvenile character, nudity',
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  })), /explicit minor evidence coexists with sensitive content/)
  for (const requirements of ['7 y/o character, nudity', 'aged 16 character, nudity']) {
    assert.throws(() => workflow.prepareRequest(imageVideoOptions({
      requirements,
      contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
    })), /explicit minor evidence coexists with sensitive content/)
  }
  assert.doesNotThrow(() => workflow.prepareRequest(imageVideoOptions({
    requirements: 'young adult woman, confirmed adult',
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  })))
  assert.doesNotThrow(() => workflow.prepareRequest(imageVideoOptions({
    requirements: '儿童挥手的普通安全场景',
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  })))
  assert.equal(workflow.isRequestSnapshotStale(prepared.context.snapshot, imageVideoOptions({
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
  })), true)
})

test('validates and restores I2V and FL2V through the existing H3 prompt workflow', () => {
  const i2vOptions = imageVideoOptions()
  const i2vPrepared = workflow.prepareRequest(i2vOptions)
  const i2v = workflow.validateAndRestore({
    text: imageVideoOutput(),
    context: i2vPrepared.context,
    current: i2vOptions,
  })
  assert.equal(i2v.operation, 'reverse')
  assert.equal(i2v.purpose, 'minimax-h3-i2v-reverse')
  assert.equal(i2v.validation.protocolName, 'I2VA')
  assert.match(i2v.text, /<Picture 1>/)

  const flOptions = firstLastOptions()
  const flPrepared = workflow.prepareRequest(flOptions)
  const fl = workflow.validateAndRestore({
    text: firstLastOutput(),
    context: flPrepared.context,
    current: flOptions,
  })
  assert.equal(fl.purpose, 'minimax-h3-fl2v-reverse')
  assert.equal(fl.validation.protocolName, 'FL2VA')
  assert.deepEqual(Array.from(fl.validation.usedReferences), ['<Picture 1>', '<Picture 2>'])
})

test('rejects generic protocol fallbacks that contain no backend-validated picture facts', () => {
  const i2vOptions = imageVideoOptions()
  const i2vPrepared = workflow.prepareRequest(i2vOptions)
  assert.throws(() => workflow.buildGuaranteedFallback({
    context: i2vPrepared.context,
    current: i2vOptions,
    userPrompt: i2vOptions.prompt,
  }), /backend-validated visual fact payload.*not write-eligible/)

  const flOptions = firstLastOptions()
  const flPrepared = workflow.prepareRequest(flOptions)
  assert.throws(() => workflow.buildGuaranteedFallback({
    context: flPrepared.context,
    current: flOptions,
    userPrompt: flOptions.prompt,
  }), /backend-validated visual fact payload.*not write-eligible/)
  assert.doesNotMatch(reverseSource, /guaranteed-h3-protocol|Preserve every visible subject|保持其中全部可见主体/)
})

test('disabled fallback still rejects stale state and mismatched explicit userPrompt first', () => {
  const options = imageVideoOptions()
  const prepared = workflow.prepareRequest(options)
  assert.throws(() => workflow.buildGuaranteedFallback({
    context: prepared.context,
    current: { ...options, durationSeconds: 6 },
    userPrompt: options.prompt,
  }), /snapshot is stale/)
  assert.throws(() => workflow.buildGuaranteedFallback({
    context: prepared.context,
    current: options,
    userPrompt: 'changed after request',
  }), /userPrompt does not match/)
})

test('discards stale responses and malformed H3 protocol output before writeback', () => {
  const options = imageVideoOptions()
  const prepared = workflow.prepareRequest(options)
  assert.throws(() => workflow.validateAndRestore({
    text: imageVideoOutput(),
    context: prepared.context,
    current: { ...options, resources: [image('first_frame', 'first-a', PNG_B)] },
  }), /snapshot is stale/)
  assert.throws(() => workflow.validateAndRestore({
    text: '普通 WAN 视频提示词',
    context: prepared.context,
    current: options,
  }), /missing required field|field order|fields must appear|structured/i)
  assert.throws(() => workflow.validateAndRestore({
    text: imageVideoOutput(),
    context: prepared.context,
  }), /current state is required/)
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const workflowPath = path.join(root, 'particle-editor', 'ai-sequence-minimax-h3-prompt.workflow.js')
const buildRendererPath = path.join(root, 'particle-editor-desktop', 'scripts', 'build-renderer.mjs')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')
const buildRendererSource = fs.readFileSync(buildRendererPath, 'utf8')

function loadCommonJsWorkflow() {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
  }
  context.globalThis = context
  vm.runInNewContext(workflowSource, context, { filename: workflowPath })
  return context.module.exports
}

const workflow = loadCommonJsWorkflow()

function resource(key, identity, fileName, mimeType) {
  return { key, identity, fileName, mimeType, occupied: true }
}

function firstFrame(identity = 'first-a') {
  return resource('first_frame', identity, 'first.png', 'image/png')
}

function lastFrame(identity = 'last-a') {
  return resource('last_frame', identity, 'last.png', 'image/png')
}

function textVideoPrompt() {
  return [
    'integrated_multimodal_description: [Shot 1] A quiet city wakes before dawn while the locked camera remains static.',
    '[Shot 2] At 00:02.000, warm sunlight travels gradually across the buildings while the camera slowly pans right.',
    'overall_soundscape: Distant traffic and a light morning breeze.',
    'non_diegetic_music: Soft restrained strings.',
  ].join('\n')
}

function imageVideoPrompt(durationSeconds = 5) {
  const protocol = workflow.createPromptProtocol({
    mode: 'image_video',
    durationSeconds,
    resources: [firstFrame()],
  })
  return [
    protocol.alignment.template,
    'integrated_multimodal_description: [Shot 1] <Picture 1> establishes the hero in a still pose while the camera begins locked.',
    '[Shot 2] At 00:02.250, the hero gradually turns and completes the motion as the camera slowly pushes in.',
    'overall_soundscape: Cloth movement and a quiet room tone.',
    'non_diegetic_music: N/A',
  ].join('\n')
}

function firstLastPrompt(durationSeconds = 5) {
  const alignment = workflow.createPromptProtocol({
    mode: 'first_last',
    durationSeconds,
    resources: [firstFrame(), lastFrame()],
  }).alignment.template.replace('[Shot N]', '[Shot 2]')
  return [
    alignment,
    'integrated_multimodal_description: [Shot 1] <Picture 1> is the exact opening composition while the camera begins locked.',
    '[Shot 2] At 00:03.500, motion gradually resolves into <Picture 2> as the camera slowly tracks forward.',
    'overall_soundscape: A smooth mechanical transition.',
    'non_diegetic_music: A short rising pulse.',
  ].join('\n')
}

function multiResources() {
  return [
    resource('multi_ref_image_2', 'image-b', 'hero.png', 'image/png'),
    resource('multi_ref_video_1', 'video-a', 'motion.mp4', 'video/mp4'),
    resource('multi_ref_audio_1', 'audio-a', 'voice.wav', 'audio/wav'),
  ]
}

function multiReferencePrompt() {
  return [
    'subject_definitions:',
    '<Subject 1>: the hero identity and costume from <Picture 1>.',
    'summary:',
    '[reference generation + audio reference] Keep the hero, motion cadence, and supplied voice.',
    'retention_analysis:',
    'Retain <Subject 1> exactly; follow <Video 1> for movement and <Audio 1> for sound timing.',
    'detailed_description:',
    '[Shot 1] <Subject 1> enters frame with the reference-video motion while the camera slowly tracks left.',
    '[Shot 2] At 00:03.000, <Subject 1> gradually stops and looks forward as the camera remains locked.',
    'overall_soundscape: Reuse <Audio 1> and preserve its timing.',
    'non_diegetic_music: N/A',
  ].join('\n')
}

test('exports one immutable pure workflow contract through CommonJS and the browser global', () => {
  const browserContext = { console }
  browserContext.globalThis = browserContext
  vm.runInNewContext(workflowSource, browserContext, { filename: workflowPath })

  assert.equal(typeof browserContext.NovaFlowAiSequenceMiniMaxH3PromptWorkflow.prepareRequest, 'function')
  assert.equal(typeof workflow.validateAndRestore, 'function')
  assert.equal(workflow.MINIMAX_H3_MODEL_ID, 'minimax_h3_local')
  assert.equal(workflow.SNAPSHOT_VERSION, 4)
  assert.equal(workflow.H3_VISUAL_SCHEMA, 'nf.h3.visual.v1')
  assert.deepEqual(Array.from(workflow.MODE_ORDER), [
    'text_video',
    'image_video',
    'first_last',
    'multi_reference',
  ])
  assert.ok(Object.isFrozen(workflow))
  assert.ok(Object.isFrozen(workflow.MODE_DEFINITIONS))
})

test('declares all four H3 protocol modes with their exact field order', () => {
  assert.deepEqual(
    Array.from(workflow.MODE_ORDER, (mode) => {
      const definition = workflow.getModeDefinition(mode)
      return [definition.value, definition.workflowMode, definition.protocolName, Array.from(definition.fieldOrder)]
    }),
    [
      ['text_video', 't2v', 'T2VA', Array.from(workflow.BASE_FIELD_ORDER)],
      ['image_video', 'i2v', 'I2VA', Array.from(workflow.BASE_FIELD_ORDER)],
      ['first_last', 'fl2v', 'FL2VA', Array.from(workflow.BASE_FIELD_ORDER)],
      ['multi_reference', 'r2v', 'Ref2VA', Array.from(workflow.REFERENCE_FIELD_ORDER)],
    ],
  )
  assert.equal(workflow.normalizeMode('T2V'), 'text_video')
  assert.equal(workflow.normalizeMode('first-last'), 'first_last')
  assert.equal(workflow.normalizeMode('r2v'), 'multi_reference')
  assert.equal(workflow.normalizeModelId('minimax_h3_local'), 'minimax_h3_local')
  assert.throws(() => workflow.normalizeModelId(''), /Unsupported MiniMax H3 prompt model/)
  assert.throws(() => workflow.normalizeModelId('local_a'), /Unsupported MiniMax H3 prompt model/)
  assert.throws(() => workflow.normalizeMode('seedance'), /Unsupported MiniMax H3 prompt mode/)
})

test('accepts one-second H3 prompt enhancement and rejects values below the product minimum', () => {
  assert.equal(workflow.MIN_DURATION_SECONDS, 1)
  assert.equal(workflow.MAX_DURATION_SECONDS, 15)

  const protocol = workflow.createPromptProtocol({
    mode: 'text_video',
    durationSeconds: 1,
    resources: [],
  })
  assert.equal(protocol.durationSeconds, 1)

  const request = workflow.prepareRequest({
    modelId: 'minimax_h3_local',
    mode: 'text_video',
    durationSeconds: 1,
    prompt: 'A brief camera move.',
    resources: [],
  })
  assert.equal(request.context.durationSeconds, 1)
  assert.match(request.requirements, /duration: 1\.00 seconds/)

  assert.throws(
    () => workflow.createPromptProtocol({ mode: 'text_video', durationSeconds: 0.99, resources: [] }),
    /between 1 and 15/,
  )
})

test('builds a compact resource-label catalog and restores labels to their original UI slots', () => {
  const catalog = workflow.createReferenceCatalog({
    mode: 'multi_reference',
    resources: [
      resource('multi_ref_image_2', 'image-b', 'second.png', 'image/png'),
      resource('multi_ref_image_4', 'image-d', 'fourth.png', 'image/png'),
      resource('multi_ref_video_1', 'video-a', 'motion.mp4', 'video/mp4'),
    ],
  })

  assert.deepEqual(
    Array.from(catalog.references, (entry) => [entry.slotKey, entry.modelToken, entry.displayToken]),
    [
      ['multi_ref_image_2', '<Picture 1>', '@\u53c2\u8003\u56fe2'],
      ['multi_ref_image_4', '<Picture 2>', '@\u53c2\u8003\u56fe4'],
      ['multi_ref_video_1', '<Video 1>', '@\u89c6\u9891\u53c2\u8003'],
    ],
  )
  assert.equal(
    workflow.toModelReferences('@\u53c2\u8003\u56fe2 follows @\u53c2\u8003\u56fe4 and @\u89c6\u9891\u53c2\u8003', catalog),
    '<Picture 1> follows <Picture 2> and <Video 1>',
  )
  assert.equal(
    workflow.toDisplayReferences('<Picture 1> follows <Picture 2> and <Video 1>', catalog),
    '@\u53c2\u8003\u56fe2 follows @\u53c2\u8003\u56fe4 and @\u89c6\u9891\u53c2\u8003',
  )
  assert.equal(catalog.byModelToken['<Picture 1>'], '@\u53c2\u8003\u56fe2')
  assert.ok(Object.isFrozen(catalog))
  assert.ok(Object.isFrozen(catalog.references))
  assert.throws(
    () => workflow.toModelReferences('use @\u53c2\u8003\u56fe1', catalog),
    /is not available/,
  )
  assert.throws(
    () => workflow.toDisplayReferences('use <Picture 3>', catalog),
    /is not available/,
  )
})

test('prepareRequest returns separate requirements, compiled prompt, and immutable stale context', () => {
  const resources = multiResources()
  const request = workflow.prepareRequest({
    modelId: 'minimax_h3_local',
    mode: 'multi_reference',
    durationSeconds: 5,
    prompt: 'Use @\u53c2\u8003\u56fe2, @\u89c6\u9891\u53c2\u8003, and @\u58f0\u97f3\u53c2\u8003.',
    resources,
  })

  assert.equal(request.prompt, 'Use <Picture 1>, <Video 1>, and <Audio 1>.')
  assert.equal(request.context.modelId, 'minimax_h3_local')
  assert.equal(request.context.snapshot.modelId, 'minimax_h3_local')
  assert.equal(request.text, request.requirements)
  assert.match(request.requirements, /Protocol: Ref2VA/)
  assert.match(request.requirements, /subject_definitions -> summary -> retention_analysis/)
  assert.match(request.requirements, /Available resource labels: <Picture 1> = captured image slot multi_ref_image_2/)
  assert.doesNotMatch(request.requirements, /@\u53c2\u8003\u56fe2/)
  assert.match(request.requirements, /continuous, physically achievable action/)
  assert.match(request.requirements, /movement type or locked position, direction, amplitude, and speed/)
  assert.match(request.requirements, /overall_soundscape is only diegetic sound/)
  assert.equal(request.context.fingerprint, request.context.snapshot.fingerprint)
  assert.ok(Object.isFrozen(request))
  assert.ok(Object.isFrozen(request.context))
  assert.ok(Object.isFrozen(request.context.snapshot))
  assert.ok(Object.isFrozen(request.context.snapshot.references[0]))

  resources[0].identity = 'mutated-after-capture'
  assert.equal(request.context.snapshot.references[0].identity, 'image-b')
})

test('validates and restores a response for every H3 product mode', () => {
  const cases = [
    {
      mode: 'text_video',
      resources: [],
      prompt: 'A city wakes at dawn.',
      response: textVideoPrompt(),
      expectedProtocol: 'T2VA',
    },
    {
      mode: 'image_video',
      resources: [firstFrame()],
      prompt: 'Animate @\u9996\u5e27.',
      response: imageVideoPrompt(),
      expectedProtocol: 'I2VA',
    },
    {
      mode: 'first_last',
      resources: [firstFrame(), lastFrame()],
      prompt: 'Move from @\u9996\u5e27 to @\u5c3e\u5e27.',
      response: firstLastPrompt(),
      expectedProtocol: 'FL2VA',
    },
    {
      mode: 'multi_reference',
      resources: multiResources(),
      prompt: 'Use @\u53c2\u8003\u56fe2, @\u89c6\u9891\u53c2\u8003, and @\u58f0\u97f3\u53c2\u8003.',
      response: multiReferencePrompt(),
      expectedProtocol: 'Ref2VA',
    },
  ]

  cases.forEach((entry) => {
    const request = workflow.prepareRequest({
      modelId: 'minimax_h3_local',
      mode: entry.mode,
      durationSeconds: 5,
      prompt: entry.prompt,
      resources: entry.resources,
    })
    const result = workflow.validateAndRestore({ text: entry.response, context: request.context })
    assert.equal(result.validation.valid, true)
    assert.equal(result.validation.protocolName, entry.expectedProtocol)
    assert.equal(result.fingerprint, request.context.fingerprint)
    assert.equal(result.validation.shots.length, 2)
    assert.equal(result.validation.shots[1].seconds > result.validation.shots[0].seconds, true)
  })

  const imageRequest = workflow.prepareRequest({
    modelId: 'minimax_h3_local',
    mode: 'image_video',
    durationSeconds: 5,
    prompt: 'Animate @\u9996\u5e27.',
    resources: [firstFrame()],
  })
  const restored = workflow.validateAndRestore({ text: imageVideoPrompt(), context: imageRequest.context })
  assert.doesNotMatch(restored.text, /@\u9996\u5e27/)
  assert.match(restored.text, /<Picture 1>/)
  assert.match(restored.modelText, /<Picture 1>/)

  const multiRequest = workflow.prepareRequest({
    modelId: 'minimax_h3_local',
    mode: 'multi_reference',
    durationSeconds: 5,
    prompt: 'Use @\u53c2\u8003\u56fe2, @\u89c6\u9891\u53c2\u8003, and @\u58f0\u97f3\u53c2\u8003.',
    resources: multiResources(),
  })
  const multiRestored = workflow.validateAndRestore({
    text: multiReferencePrompt(),
    context: multiRequest.context,
  })
  assert.match(multiRestored.text, /@\u53c2\u8003\u56fe2/)
  assert.match(multiRestored.text, /@\u89c6\u9891\u53c2\u8003/)
  assert.doesNotMatch(multiRestored.text, /<Picture 1>/)
})

test('rejects wrong field order, missing fields, and illegal mode references', () => {
  assert.throws(
    () => workflow.validatePromptText([
      'overall_soundscape: wind',
      'integrated_multimodal_description: [Shot 1] skyline',
      'non_diegetic_music: N/A',
    ].join('\n'), { mode: 'text_video', durationSeconds: 5, resources: [] }),
    /fields must appear exactly in this order/,
  )
  assert.throws(
    () => workflow.validatePromptText([
      'integrated_multimodal_description: [Shot 1] skyline',
      'overall_soundscape: wind',
    ].join('\n'), { mode: 'text_video', durationSeconds: 5, resources: [] }),
    /fields must appear exactly in this order/,
  )
  assert.throws(
    () => workflow.validatePromptText(textVideoPrompt().replace('A quiet city', '<Picture 1> A quiet city'), {
      mode: 'text_video',
      durationSeconds: 5,
      resources: [],
    }),
    /unavailable reference <Picture 1>/,
  )
  assert.throws(
    () => workflow.validatePromptText(imageVideoPrompt().replace(
      '[Shot 1] <Picture 1> establishes',
      '[Shot 1] <Picture 1> and <Picture 2> establish',
    ), {
      mode: 'image_video',
      durationSeconds: 5,
      resources: [firstFrame()],
    }),
    /unavailable reference <Picture 2>/,
  )
})

test('rejects extra top-level fields without treating ordinary body colons as fields', () => {
  const withExtraField = textVideoPrompt().replace(
    'overall_soundscape:',
    'negative_prompt: blur, artifacts\noverall_soundscape:',
  )
  assert.throws(
    () => workflow.validatePromptText(withExtraField, {
      mode: 'text_video',
      durationSeconds: 5,
      resources: [],
    }),
    /Unexpected MiniMax H3 top-level field: negative_prompt/,
  )

  const bodyColons = textVideoPrompt()
    .replace('A quiet city wakes before dawn.', 'A sign reads: OPEN while a quiet city wakes before dawn.')
    .replace('warm sunlight travels', 'the camera: slowly pans as warm sunlight travels')
  assert.equal(workflow.validatePromptText(bodyColons, {
    mode: 'text_video',
    durationSeconds: 5,
    resources: [],
  }).valid, true)
})

test('rejects Markdown-wrapped and Chinese negative-prompt headings', () => {
  const forbiddenHeadings = [
    '- negative_prompt:',
    '**negative_prompt:**',
    '- **negative prompt:**',
    '### **\u8d1f\u5411\u63d0\u793a\u8bcd\uff1a**',
  ]
  forbiddenHeadings.forEach((heading) => {
    const response = textVideoPrompt().replace(
      'overall_soundscape:',
      `${heading} blur, artifacts\noverall_soundscape:`,
    )
    assert.throws(
      () => workflow.validatePromptText(response, {
        mode: 'text_video',
        durationSeconds: 5,
        resources: [],
      }),
      /Unexpected MiniMax H3 top-level field/,
      heading,
    )
  })
})

test('rejects malformed, non-contiguous, non-increasing, and out-of-range shot times', () => {
  const options = { mode: 'text_video', durationSeconds: 5, resources: [] }
  assert.doesNotThrow(
    () => workflow.validatePromptText(textVideoPrompt().replace('00:02.000', '00:05.000'), options),
  )
  assert.doesNotThrow(
    () => workflow.validatePromptText(textVideoPrompt().replace('00:02.000,', '00:02.000，'), options),
  )
  assert.doesNotThrow(
    () => workflow.validatePromptText(textVideoPrompt().replace('00:02.000,', '00:02.000 '), options),
  )
  assert.throws(
    () => workflow.validatePromptText(textVideoPrompt().replace('[Shot 1]', '[Shot 1] At 00:00.000,'), options),
    /\[Shot 1\] must not contain a timestamp/,
  )
  assert.throws(
    () => workflow.validatePromptText(textVideoPrompt().replace('[Shot 2]', '[Shot 3]'), options),
    /shot numbers must be contiguous/,
  )
  assert.throws(
    () => workflow.validatePromptText(textVideoPrompt().replace('[Shot 2] At 00:02.000,', '[Shot 2] moves'), options),
    /must contain an At MM:SS\.mmm timestamp/,
  )
  assert.throws(
    () => workflow.validatePromptText(textVideoPrompt().replace('00:02.000', '00:00.000'), options),
    /strictly increasing/,
  )
  assert.throws(
    () => workflow.validatePromptText(textVideoPrompt().replace('00:02.000', '00:05.001'), options),
    /exceeds the selected duration/,
  )
})

test('accepts numerically equivalent first-last alignment seconds', () => {
  const options = {
    mode: 'first_last',
    durationSeconds: 8,
    resources: [
      { key: 'first_frame', kind: 'image', occupied: true, identity: 'first' },
      { key: 'last_frame', kind: 'image', occupied: true, identity: 'last' },
    ],
  }
  const response = firstLastPrompt(8)
    .replace('8.00 \u79d2', '8 seconds')
    .replace('00:03.500,', '00:08.000，')
  assert.doesNotThrow(() => workflow.validatePromptText(response, options))
})

test('validates Ref2VA relations and contiguous subject definitions', () => {
  const options = { mode: 'multi_reference', durationSeconds: 5, resources: multiResources() }
  const valid = workflow.validatePromptText(multiReferencePrompt(), options)
  assert.deepEqual(Array.from(valid.subjects), [1])
  assert.deepEqual(Array.from(valid.relations), ['reference generation', 'audio reference'])
  assert.deepEqual(Array.from(valid.usedReferences), ['<Picture 1>', '<Video 1>', '<Audio 1>'])

  const naturalSummary = workflow.validatePromptText(
    multiReferencePrompt().replace(
      '[reference generation + audio reference] Keep the hero, motion cadence, and supplied voice.',
      '\u4fdd\u7559 <Picture 1> \u7684\u8eab\u4efd\u4e0e\u5916\u89c2\uff0c\u53c2\u8003 <Video 1> \u7684\u52a8\u4f5c\u8282\u594f\uff0c\u5e76\u540c\u6b65 <Audio 1> \u7684\u58f0\u97f3\u3002',
    ),
    options,
  )
  assert.deepEqual(
    Array.from(naturalSummary.relations),
    ['reference generation', 'audio reference'],
  )

  assert.throws(
    () => workflow.validatePromptText(
      multiReferencePrompt().replace('[reference generation + audio reference]', '[unsupported relation]'),
      options,
    ),
    /Unsupported MiniMax H3 reference relation/,
  )
  assert.throws(
    () => workflow.validatePromptText(
      multiReferencePrompt().replace(/<Subject 1>/g, '<Subject 2>'),
      options,
    ),
    /must start at <Subject 1> without gaps/,
  )
  assert.throws(
    () => workflow.validatePromptText(
      multiReferencePrompt().replace('<Subject 1> enters', '<Subject 2> enters'),
      options,
    ),
    /used without a subject_definitions entry/,
  )
})

test('captures an immutable fingerprint and detects prompt, mode, duration, or resource changes', () => {
  const base = {
    modelId: 'minimax_h3_local',
    mode: 'image_video',
    durationSeconds: 5,
    prompt: 'Animate @\u9996\u5e27.',
    resources: [firstFrame('first-a')],
  }
  const request = workflow.prepareRequest(base)
  const snapshot = request.context.snapshot

  assert.equal(workflow.assertSnapshotIntegrity(snapshot), true)
  assert.equal(workflow.isPromptSnapshotStale(snapshot, base), false)
  assert.equal(workflow.isContextStale(request.context, base), false)
  assert.equal(workflow.isContextStale(request.context, Object.assign({}, base, { prompt: 'Changed.' })), true)
  assert.equal(workflow.isContextStale(request.context, Object.assign({}, base, { modelId: 'local_a' })), true)
  assert.equal(workflow.isContextStale(request.context, Object.assign({}, base, { durationSeconds: 6 })), true)
  assert.equal(workflow.isContextStale(request.context, Object.assign({}, base, { mode: 'text_video', resources: [] })), true)
  assert.equal(workflow.isContextStale(request.context, Object.assign({}, base, {
    resources: [firstFrame('first-b')],
  })), true)
  assert.equal(workflow.isContextStale(request.context, Object.assign({}, base, {
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true },
  })), true)
  assert.throws(
    () => workflow.assertContextFresh(request.context, Object.assign({}, base, { durationSeconds: 6 })),
    /snapshot is stale/,
  )
})

test('locks fact-faithful H3 analysis and rejects only minor-sensitive, alias, or shallow output', () => {
  const sensitive = {
    modelId: 'minimax_h3_local',
    mode: 'image_video',
    durationSeconds: 5,
    prompt: 'Animate @\u9996\u5e27.',
    resources: [firstFrame()],
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  }
  const request = workflow.prepareRequest(sensitive)
  assert.equal(request.context.visualSchema, 'nf.h3.visual.v1')
  assert.equal(request.context.contentPolicy.sensitiveVisualAnalysis, true)
  assert.match(request.requirements, /Fact-faithful analysis is enabled/)
  assert.doesNotThrow(() => workflow.prepareRequest({
    ...sensitive,
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  }))
  assert.equal(workflow.isContextStale(request.context, {
    ...sensitive,
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
  }), true)
  assert.doesNotThrow(() => workflow.validateAndRestore({
    text: imageVideoPrompt().replace('the hero gradually turns', 'the underage child gradually turns'),
    context: request.context,
    current: sensitive,
  }))
  assert.throws(() => workflow.validateAndRestore({
    text: imageVideoPrompt().replace('the hero gradually turns', 'the nude underage child gradually turns'),
    context: request.context,
    current: sensitive,
  }), /explicit minor evidence coexists with sensitive content/)
  assert.throws(() => workflow.validatePromptText(
    imageVideoPrompt().replace('<Picture 1>', '@\u9996\u5e27 (image)'),
    { mode: 'image_video', durationSeconds: 5, resources: [firstFrame()] },
  ), /not UI aliases/)
  assert.throws(() => workflow.validatePromptText(
    imageVideoPrompt()
      .replace(' while the camera begins locked', '')
      .replace('gradually turns and completes the motion as the camera slowly pushes in', 'is visible'),
    { mode: 'image_video', durationSeconds: 5, resources: [firstFrame()] },
  ), /action progression/)
})

test('validateAndRestore can reject a response against current state before restoring it', () => {
  const current = {
    modelId: 'minimax_h3_local',
    mode: 'image_video',
    durationSeconds: 5,
    prompt: 'Animate @\u9996\u5e27.',
    resources: [firstFrame('first-a')],
  }
  const request = workflow.prepareRequest(current)
  const result = workflow.validateAndRestore({
    text: imageVideoPrompt(),
    context: request.context,
    current,
  })
  assert.equal(result.validation.valid, true)

  assert.throws(
    () => workflow.validateAndRestore({
      text: imageVideoPrompt(),
      context: request.context,
      current: Object.assign({}, current, { modelId: 'local_a' }),
    }),
    /response is stale/,
  )
  assert.throws(
    () => workflow.validateAndRestore({
      text: imageVideoPrompt(),
      context: request.context,
      current: Object.assign({}, current, { resources: [firstFrame('first-b')] }),
    }),
    /response is stale/,
  )
})

test('sensitive validation ignores ambiguous age wording and blocks only explicit minor evidence', () => {
  const sensitive = {
    modelId: 'minimax_h3_local',
    mode: 'image_video',
    durationSeconds: 5,
    prompt: '保持首帧身份并生成克制动作',
    resources: [firstFrame('first-a')],
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  }
  const request = workflow.prepareRequest(sensitive)
  const safeAdult = imageVideoPrompt().replace('the hero', 'the young adult woman')
  assert.doesNotThrow(() => workflow.validateAndRestore({ text: safeAdult, context: request.context, current: sensitive }))
  const ambiguousYouth = safeAdult.replace('young adult woman', 'teenage girl')
  assert.doesNotThrow(() => workflow.validateAndRestore({ text: ambiguousYouth, context: request.context, current: sensitive }))
  const sensitiveYouth = ambiguousYouth.replace('teenage girl', 'nude teenage girl')
  assert.doesNotThrow(() => workflow.validateAndRestore({ text: sensitiveYouth, context: request.context, current: sensitive }))
  for (const ambiguousChildLike of ['nude child-like figure', 'nude children-like figures']) {
    const ambiguousChildLikeOutput = sensitiveYouth.replace('nude teenage girl', ambiguousChildLike)
    assert.doesNotThrow(() => workflow.validateAndRestore({ text: ambiguousChildLikeOutput, context: request.context, current: sensitive }))
  }
  const explicitMinor = sensitiveYouth.replace('nude teenage girl', 'nude underage child')
  assert.throws(() => workflow.validateAndRestore({ text: explicitMinor, context: request.context, current: sensitive }),
    /explicit minor evidence coexists with sensitive content/)
  for (const explicitAge of ['nude 7 y/o figure', 'nude aged 16 figure']) {
    const explicitAgeOutput = sensitiveYouth.replace('nude teenage girl', explicitAge)
    assert.throws(() => workflow.validateAndRestore({ text: explicitAgeOutput, context: request.context, current: sensitive }),
      /explicit minor evidence coexists with sensitive content/)
  }
  const ordinary = workflow.prepareRequest({
    ...sensitive,
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
  })
  assert.doesNotThrow(() => workflow.validateAndRestore({ text: ambiguousYouth, context: ordinary.context }))
})

test('stays a pure prompt module with no DOM, network, runtime, or filesystem dependency', () => {
  assert.doesNotMatch(
    workflowSource,
    /document\.|window\.|fetch\(|XMLHttpRequest|electronAPI|localStorage|sessionStorage|require\s*\(|novaflow-brand-runtime/i,
  )
})

test('clean desktop builds copy and require the H3 prompt workflow module', () => {
  const runtimeStart = buildRendererSource.indexOf('const runtimeShellFiles = [')
  const requiredStart = buildRendererSource.indexOf('const requiredRuntimeShellFiles = new Set([')
  const legacyStart = buildRendererSource.indexOf('const legacyRuntimeShellFiles = [')
  assert.notEqual(runtimeStart, -1)
  assert.notEqual(requiredStart, -1)
  assert.notEqual(legacyStart, -1)

  const runtimeManifest = buildRendererSource.slice(runtimeStart, requiredStart)
  const requiredManifest = buildRendererSource.slice(requiredStart, legacyStart)
  const promptModule = '"ai-sequence-minimax-h3-prompt.workflow.js"'
  assert.match(runtimeManifest, new RegExp(promptModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(requiredManifest, new RegExp(promptModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

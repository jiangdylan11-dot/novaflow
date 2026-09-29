const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const workflowPath = path.join(root, 'novaflow-web', 'renderer', 'ai-sequence-minimax-h3-prompt.workflow.js')
const buildRendererPath = path.join(root, 'particle-editor-desktop', 'scripts', 'build-renderer.mjs')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')
const buildRendererSource = fs.readFileSync(buildRendererPath, 'utf8')

function loadCommonJsWorkflow() {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
  }
  context.NovaFlowH3PromptFormat = require('../admin-server/h3-prompt-enhance.js');
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
    '<Subject 1>: fully_preserved - keep identity and costume; follow <Video 1> for movement and <Audio 1> for sound timing.',
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
  assert.equal(workflow.MAX_DURATION_SECONDS, 30)

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
    /between 1 and 30/,
  )

  assert.equal(
    workflow.createPromptProtocol({ mode: 'text_video', durationSeconds: 30, resources: [] }).durationSeconds,
    30,
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
  assert.match(request.requirements, /subject_definitions[\s\S]*retention_analysis/)
  assert.match(request.requirements, /Available resource labels: <Picture 1> = captured image slot multi_ref_image_2/)
  assert.doesNotMatch(request.requirements, /@\u53c2\u8003\u56fe2/)
  assert.match(request.requirements, /observable action/)
  assert.match(request.requirements, /direction, amplitude/)
  assert.match(request.requirements, /ambience and physical sounds/)
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
  // Base modes show the Chinese-labelled display with the editor alias (图生视频: @参考图);
  // the alignment section is regenerated from mode and duration, not copied from the engine.
  const restored = workflow.validateAndRestore({ text: imageVideoPrompt(), context: imageRequest.context })
  assert.match(restored.text, /^【参考帧对齐】\n@参考图 是视频第 0\.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】@参考图 establishes the hero/)
  assert.match(restored.text, /\n【镜头 2】 At 00:02\.250, the hero gradually turns[^\n]*\n\n【环境声音】\nCloth movement and a quiet room tone\.\n\n【背景音乐】\n无$/)
  assert.doesNotMatch(restored.text, /<Picture 1>|integrated_multimodal_description|参考图片与目标视频对齐/)
  assert.match(restored.modelText, /^integrated_multimodal_description: \[Shot 1\] <Picture 1> establishes/)
  // The display goes back to the engine as fields with protocol tokens.
  assert.equal(workflow.prepareRequest({ modelId: 'minimax_h3_local', mode: 'image_video', durationSeconds: 5, prompt: restored.text, resources: [firstFrame()] }).prompt, restored.modelText)

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

test('base fields are read in any order, unrequested music becomes N/A, and illegal mode references fail', () => {
  const textVideo = { mode: 'text_video', durationSeconds: 5, resources: [] }
  assert.equal(workflow.validatePromptText([
    'overall_soundscape: wind',
    'integrated_multimodal_description: [Shot 1] skyline, the camera holds a static shot',
    'non_diegetic_music: N/A',
  ].join('\n'), textVideo).text, 'integrated_multimodal_description: [Shot 1] skyline, the camera holds a static shot\n\noverall_soundscape: wind\n\nnon_diegetic_music: N/A')
  assert.match(workflow.validatePromptText([
    'integrated_multimodal_description: [Shot 1] skyline, the camera holds a static shot',
    'overall_soundscape: wind',
  ].join('\n'), textVideo).text, /\n\nnon_diegetic_music: N\/A$/)
  assert.throws(() => workflow.validatePromptText('integrated_multimodal_description: [Shot 1] skyline', textVideo), /三个字段/)
  assert.throws(
    () => workflow.validatePromptText(textVideoPrompt().replace('A quiet city', '<Picture 1> A quiet city'), textVideo),
    /参考媒体标签/,
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
    /参考媒体标签/,
  )
  assert.throws(() => workflow.validatePromptText(textVideoPrompt().replace('A quiet city', '<Subject 1> A quiet city'), textVideo), /Subject N/)
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

test('canonicalizes shot layout and rejects non-contiguous, non-increasing, and out-of-range cut times', () => {
  const options = { mode: 'text_video', durationSeconds: 5, resources: [] }
  const narrative = (text) => text.split('overall_soundscape:')[0]
  for (const variant of [textVideoPrompt(), textVideoPrompt().replace('00:02.000,', '00:02.000，'), textVideoPrompt().replace('00:02.000,', '00:02.000 ')]) {
    assert.match(narrative(workflow.validatePromptText(variant, options).text), /\n\[Shot 2\] At 00:02\.000, warm sunlight/)
  }
  // A zero time on [Shot 1] is dropped; a later shot without a time is placed evenly, like 多参.
  assert.match(workflow.validatePromptText(textVideoPrompt().replace('[Shot 1]', '[Shot 1] At 00:00.000,'), options).text, /^integrated_multimodal_description: \[Shot 1\] A quiet city/)
  assert.match(workflow.validatePromptText(textVideoPrompt().replace('[Shot 2] At 00:02.000,', '[Shot 2] moves'), options).text, /\[Shot 2\] At 00:02\.500, moves warm sunlight/)
  assert.throws(() => workflow.validatePromptText(textVideoPrompt().replace('[Shot 1]', '[Shot 1] At 00:01.000,'), options), /切换时间/)
  assert.throws(() => workflow.validatePromptText(textVideoPrompt().replace('[Shot 2]', '[Shot 3]'), options), /镜头编号/)
  assert.throws(() => workflow.validatePromptText(textVideoPrompt().replace('00:02.000', '00:00.000'), options), /切换时间/)
  // Official rule: a cut starts strictly inside the selected duration.
  for (const time of ['00:05.000', '00:05.001']) {
    assert.throws(() => workflow.validatePromptText(textVideoPrompt().replace('00:02.000', time), options), /切换时间/)
  }
})

test('the first-last alignment is regenerated from mode and duration, whatever line the engine wrote', () => {
  const current = {
    modelId: 'minimax_h3_local',
    mode: 'first_last',
    durationSeconds: 8,
    prompt: 'Move from @首帧 to @尾帧.',
    resources: [firstFrame(), lastFrame()],
  }
  const request = workflow.prepareRequest(current)
  const [chinese, ...body] = firstLastPrompt(8).split('\n')
  const official = 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 8.00-second mark of the target video.'
  for (const line of [chinese, chinese.replace('8.00 秒', '8 seconds'), official, 'Reference alignment - <Picture 1> from [Shot 1] = 0.00 seconds; <Picture 2> from [Shot 1] = 3.00 seconds', '']) {
    const response = [line, ...body].filter(Boolean).join('\n').replace('00:03.500,', '00:07.500，')
    const restored = workflow.validateAndRestore({ text: response, context: request.context, current })
    assert.match(restored.text, /^【参考帧对齐】\n@首帧 对齐视频第 0\.00 秒（开头）；@尾帧 对齐第 8\.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】@首帧 is the exact opening composition/)
    assert.match(restored.text, /\n【镜头 2】 At 00:07\.500, motion gradually resolves into @尾帧/)
  }
})

test('validates Ref2VA relations and contiguous subject definitions', () => {
  const options = { mode: 'multi_reference', durationSeconds: 5, resources: multiResources() }
  const valid = workflow.validatePromptText(multiReferencePrompt(), options)
  assert.deepEqual(Array.from(valid.subjects), [1])
  assert.deepEqual(Array.from(valid.relations), ['reference generation', 'audio reference'])
  assert.deepEqual(Array.from(valid.usedReferences), ['<Picture 1>', '<Video 1>', '<Audio 1>'])

  assert.throws(() => workflow.validatePromptText(multiReferencePrompt().replace('[reference generation + audio reference]', ''), options), /明确任务关系/)

  assert.throws(
    () => workflow.validatePromptText(
      multiReferencePrompt().replace('[reference generation + audio reference]', '[unsupported relation]'),
      options,
    ),
    /明确任务关系/,
  )
  assert.throws(
    () => workflow.validatePromptText(
      multiReferencePrompt().replace(/<Subject 1>/g, '<Subject 2>'),
      options,
    ),
    /主体缺少独立定义/,
  )
  assert.throws(
    () => workflow.validatePromptText(
      multiReferencePrompt().replace('<Subject 1>: the hero identity', '<Subject 2>: the hero identity'),
      options,
    ),
    /主体缺少独立定义/,
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
  // An editor alias echoed for a bound frame binds to its protocol token; an unbound one fails.
  const imageOptions = { mode: 'image_video', durationSeconds: 5, resources: [firstFrame()] }
  for (const alias of ['@首帧 (image)', '@参考图']) {
    const bound = workflow.validatePromptText(imageVideoPrompt().replace('<Picture 1>', alias), imageOptions)
    assert.match(bound.text, /\[Shot 1\] <Picture 1> establishes/)
  }
  assert.throws(() => workflow.validatePromptText(imageVideoPrompt().replace('<Picture 1>', '@尾帧'), imageOptions), /not UI aliases \(@尾帧\)/)
  // A shallow caption is not rejected by keyword lists; the missing camera is completed instead.
  const shallow = workflow.validatePromptText(
    imageVideoPrompt()
      .replace(' while the camera begins locked', '')
      .replace('gradually turns and completes the motion as the camera slowly pushes in', 'is visible'),
    imageOptions,
  )
  assert.match(shallow.text, /the hero is visible\. The camera holds a static shot and the framing stays stable\.\n/)
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

test('breathing idle and explicit stillness are valid temporal intent',()=>{
  for(const action of ['角色保持待机状态，呼吸带动肩部轻微起伏，最后平滑回到起始姿态。','角色全程保持静止。']) {
    const value=textVideoPrompt().replace(/integrated_multimodal_description:[\s\S]*?(?=overall_soundscape:)/,'integrated_multimodal_description: [Shot 1] '+action+' 镜头保持固定。\n');
    assert.equal(workflow.validatePromptText(value,{mode:'text_video',durationSeconds:5,resources:[]}).valid,true);
  }
});

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

const format = require('../admin-server/h3-prompt-enhance.js')
const I2V_LINE = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
const chineseFields = (narrative = '[Shot 1] <Picture 1> 中的少女缓慢转身，抬手挥动。镜头保持固定，构图稳定。') =>
  `integrated_multimodal_description: ${narrative}\n\noverall_soundscape: 站台环境声，衣袖摩擦声。\n\nnon_diegetic_music: N/A`
const englishFields = (narrative = '[Shot 1] The girl shown in <Picture 1> slowly turns and raises her hand to wave. The camera holds a static shot and the framing stays stable.') =>
  `integrated_multimodal_description: ${narrative}\n\noverall_soundscape: Platform ambience hums while her sleeve rustles.\n\nnon_diegetic_music: N/A`
const legacyI2v = '【任务定位】\n图生视频，时长5秒。<Picture 1> 为起始首帧。\n\n【说话者】\n无说话者\n\n【递进式详细提示词】\n少女站在站台上，镜头固定。\n\n0-2.5s：她缓慢转身。\n\n2.5-5s：她抬手挥动。\n\n【台词】\n无台词\n\n【连续性与约束】\n1. 环境与动作声音：站台环境声\n2. 配乐：N/A'
const i2vCurrent = (prompt, identity = 'first-a') => ({ modelId: 'minimax_h3_local', mode: 'image_video', durationSeconds: 5, prompt, resources: [firstFrame(identity)] })

test('base optimize asks for the official fields with the bilingual flag and sends fields, never five sections', () => {
  const current = i2vCurrent('@参考图 中的少女转身挥手')
  const request = workflow.prepareRequest(current)
  assert.ok(request.requirements.includes(format.baseInstruction))
  assert.ok(request.requirements.includes(format.baseResultInstruction))
  assert.match(request.requirements, /^H3 response format: bilingual-v1$/m)
  assert.doesNotMatch(request.requirements, /【任务定位】|Return exactly these five sections/)
  assert.match(request.requirements, /\nSource prompt:\n<Picture 1> 中的少女转身挥手$/)
  // Free text stays free text; a display goes to the engine as fields; an old five-section prompt is converted first.
  assert.equal(request.prompt, '<Picture 1> 中的少女转身挥手')
  const display = workflow.validateAndRestore({ text: chineseFields(), context: request.context, current }).text
  assert.equal(workflow.prepareRequest({ ...current, prompt: display }).prompt, chineseFields())
  assert.equal(workflow.prepareRequest({ ...current, prompt: legacyI2v.replace('<Picture 1>', '@参考图') }).prompt,
    'integrated_multimodal_description: [Shot 1] 少女站在站台上，镜头固定。她缓慢转身。她抬手挥动。\n\noverall_soundscape: 站台环境声\n\nnon_diegetic_music: N/A')
})

test('base results: a bilingual pair gives the official English, Chinese fields and old five sections show as the display', () => {
  const current = i2vCurrent('@参考图 中的少女转身挥手')
  const { context } = workflow.prepareRequest(current)
  const pair = workflow.validateAndRestore({ text: JSON.stringify({ modelPrompt: englishFields(), displayPrompt: chineseFields() }), context, current })
  assert.equal(pair.text, '【参考帧对齐】\n@参考图 是视频第 0.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】@参考图 中的少女缓慢转身，抬手挥动。镜头保持固定，构图稳定。\n\n【环境声音】\n站台环境声，衣袖摩擦声。\n\n【背景音乐】\n无')
  assert.equal(pair.modelText, I2V_LINE + '\n\n' + englishFields())
  const local = workflow.validateAndRestore({ text: chineseFields(), context, current })
  assert.equal(local.text, pair.text)
  assert.equal(local.modelText, chineseFields())
  const legacy = workflow.validateAndRestore({ text: legacyI2v, context, current })
  assert.match(legacy.text, /^【参考帧对齐】\n@参考图 是视频第 0\.00 秒[^\n]*\n\n【画面与动作】\n【镜头 1】少女站在站台上，镜头固定。画面从 @参考图 的位置与构图开始。她缓慢转身。她抬手挥动。\n\n【环境声音】\n站台环境声\n\n【背景音乐】\n无$/)
  assert.throws(() => workflow.validateAndRestore({ text: JSON.stringify({ modelPrompt: chineseFields(), displayPrompt: chineseFields() }), context, current }), /英文正文/)
  assert.throws(() => workflow.validateAndRestore({ text: JSON.stringify({ modelPrompt: englishFields().replace('slowly turns', 'slowly turns [Shot 2] At 00:02.000, the camera cuts to her hand'), displayPrompt: chineseFields() }), context, current }), /镜头或切换时间不一致/)
})

test('base pairs bind echoed aliases and complete the camera when the editor already holds a display', async () => {
  const current = i2vCurrent('@参考图 中的少女转身挥手')
  const { context } = workflow.prepareRequest(current)
  const plain = workflow.validateAndRestore({ text: JSON.stringify({ modelPrompt: englishFields(), displayPrompt: chineseFields() }), context, current })
  // An alias in the English half is no Chinese prose, and one in the Chinese half adds no second opening anchor.
  const echoed = workflow.validateAndRestore({ text: JSON.stringify({ modelPrompt: englishFields().replace('<Picture 1>', '@首帧'), displayPrompt: chineseFields().replace('<Picture 1>', '@参考图') }), context, current })
  assert.deepEqual([echoed.text, echoed.modelText], [plain.text, plain.modelText])
  const boy = i2vCurrent(format.toBaseDisplay(chineseFields('[Shot 1] <Picture 1> 中的男孩挥手。镜头保持固定，构图稳定。'), { mode: 'image_video', durationSeconds: 5 }).replace(/<Picture 1>/g, '@参考图'))
  const translated = await workflow.compileForGeneration(boy, async (payload) => JSON.stringify({ modelPrompt: englishFields().replace('<Picture 1>', '@参考图'), displayPrompt: payload.prompt }))
  assert.equal(translated.modelText, plain.modelText)
  // The display's 【镜头 1】 label is not a camera: a camera-less answer still gets the default.
  const still = (text) => text.replace(' The camera holds a static shot and the framing stays stable.', '').replace('镜头保持固定，构图稳定。', '')
  const again = i2vCurrent(format.toBaseDisplay(still(chineseFields()), { mode: 'image_video', durationSeconds: 5 }).replace(/<Picture 1>/g, '@参考图'))
  const completed = workflow.validateAndRestore({ text: JSON.stringify({ modelPrompt: still(englishFields()), displayPrompt: still(chineseFields()) }), context: workflow.prepareRequest(again).context, current: again })
  assert.equal(completed.modelText, I2V_LINE + '\n\n' + englishFields())
  assert.match(completed.text, /抬手挥动。镜头固定，构图保持稳定。\n/)
})

test('generation keeps the cuts and dialogue of an English display around a Chinese name, and sends what it cannot compile as written', async () => {
  const noEngine = async () => { throw new Error('no engine call expected') }
  const narrative = '[Shot 1] Live-action, cinematic. A girl named 小红 walks to the door and waves. The girl (S1) says: <d>[Chinese] 出发吧。</d> The camera holds a static shot.\n[Shot 2] At 00:03.000, the camera cuts to the street as she walks away.'
  const current = { modelId: 'minimax_h3_local', mode: 'text_video', durationSeconds: 5, resources: [], prompt: format.toBaseDisplay(englishFields(narrative), { mode: 'text_video', durationSeconds: 5 }) }
  const translated = narrative.replace('小红', 'Xiaohong')
  const answer = (text) => async () => JSON.stringify({ modelPrompt: englishFields(text), displayPrompt: '' })
  // A translation that loses a cut or a line never reaches H3; the prompt goes out as written instead.
  for (const broken of [translated.replace(/\n\[Shot 2\].*/, ''), translated.replace(/ The girl \(S1\) says: <d>.*?<\/d>/, '')]) {
    const sent = await workflow.compileForGeneration(current, answer(broken))
    assert.equal(sent.asWritten, true)
    assert.equal(sent.modelText, current.prompt.trim())
  }
  assert.equal((await workflow.compileForGeneration(current, answer(translated))).modelText, englishFields(translated.replace('\n', ' ')))
  // Sections that cannot be read go out as written: generation never fails because of the prompt's layout.
  const unreadable = '【画面与动作】\n【镜头 1】女孩挥手。\n\n【环境声音】\n风声。\n\n【环境声音】\n鸟鸣。\n\n【背景音乐】\n无'
  const sentAsWritten = await workflow.compileForGeneration({ ...current, prompt: unreadable }, noEngine)
  assert.equal(sentAsWritten.asWritten, true)
  assert.equal(sentAsWritten.modelText, unreadable)
})

test('generation compiles the base display to the official English text', async () => {
  const noEngine = async () => { throw new Error('no engine call expected') }
  // A translation received while optimizing is reused, keyed on the model-token text.
  const optimized = i2vCurrent('@参考图 中的少女转身挥手', 'compile-a')
  const { context } = workflow.prepareRequest(optimized)
  const shown = workflow.validateAndRestore({ text: JSON.stringify({ modelPrompt: englishFields(), displayPrompt: chineseFields() }), context, current: optimized }).text
  for (const prompt of [shown, shown.replace(/@参考图/g, '<Picture 1>'), shown.replace(/@参考图/g, '@首帧')]) {
    assert.equal((await workflow.compileForGeneration({ ...optimized, prompt }, noEngine)).modelText, I2V_LINE + '\n\n' + englishFields())
  }
  // English fields go straight to H3; free text is sent as written (aliases become tokens).
  const english = i2vCurrent(format.toBaseDisplay(englishFields(), { mode: 'image_video', durationSeconds: 5 }).replace(/<Picture 1>/g, '@参考图'), 'compile-b')
  assert.equal((await workflow.compileForGeneration(english, noEngine)).modelText, I2V_LINE + '\n\n' + englishFields())
  assert.deepEqual({ ...(await workflow.compileForGeneration(i2vCurrent('@参考图 里的少女转身挥手', 'compile-c'), noEngine)) }, { text: '@参考图 里的少女转身挥手', modelText: '<Picture 1> 里的少女转身挥手', referenceEditPolicy: null })
  // A Chinese display is translated once without creative change, then cached.
  const girl = chineseFields('[Shot 1] <Picture 1> 中的女孩缓慢转身，抬手挥动。镜头保持固定，构图稳定。')
  const chinese = i2vCurrent(format.toBaseDisplay(girl, { mode: 'image_video', durationSeconds: 5 }).replace(/<Picture 1>/g, '@参考图'), 'compile-d')
  const requests = []
  const translate = async (payload) => { requests.push(payload); return JSON.stringify({ modelPrompt: englishFields(), displayPrompt: payload.prompt }) }
  const compiled = await workflow.compileForGeneration(chinese, translate)
  assert.equal(compiled.modelText, I2V_LINE + '\n\n' + englishFields())
  assert.equal(compiled.text, chinese.prompt)
  assert.equal(requests.length, 1)
  const [request] = requests
  assert.equal(request.prompt, girl)
  assert.equal(request.h3Mode, 'image_video')
  assert.equal(request.durationSeconds, 5)
  assert.equal(request.purpose, 'minimax-h3-prompt-enhance')
  assert.ok(request.requirements.startsWith(format.baseTranslateInstruction + '\n'))
  assert.match(request.requirements, /^H3 compile: translate-only$/m)
  assert.match(request.requirements, /^H3 response format: bilingual-v1$/m)
  assert.match(request.requirements, /^Available resource labels: <Picture 1> = captured image slot first_frame\./m)
  assert.ok(request.requirements.endsWith('\nSource prompt:\n' + girl), 'nothing follows the source')
  // The translation is text-only: compiled mentions, a new picture or a new duration reuse it.
  await workflow.compileForGeneration({ ...chinese, prompt: chinese.prompt.replace(/@参考图/g, '<Picture 1>') }, noEngine)
  await workflow.compileForGeneration({ ...chinese, resources: [firstFrame('another-picture')] }, noEngine)
  assert.match((await workflow.compileForGeneration({ ...chinese, durationSeconds: 8 }, noEngine)).modelText, /^For the target video/)
  // An old five-section prompt from the history is converted and translated too.
  const legacy = await workflow.compileForGeneration(i2vCurrent(legacyI2v.replace('<Picture 1>', '@参考图'), 'compile-e'), translate)
  assert.match(requests[1].prompt, /^integrated_multimodal_description: \[Shot 1\] 少女站在站台上，镜头固定。画面从 <Picture 1> 的位置与构图开始。/)
  assert.equal(legacy.modelText, I2V_LINE + '\n\n' + englishFields())
  // An engine without the translate step answers in Chinese or five sections: that answer is dropped and
  // the prompt goes out as written, its @参考图 bound to <Picture 1>.
  for (const answer of [legacyI2v, chineseFields()]) {
    const sent = await workflow.compileForGeneration(i2vCurrent(chinese.prompt.replace('女孩', '姑娘'), 'compile-f'), async () => answer)
    assert.equal(sent.asWritten, true)
    assert.equal(sent.text, chinese.prompt.replace('女孩', '姑娘').trim())
    assert.doesNotMatch(sent.modelText, /@参考图|【任务定位】/)
  }
  const chineseBack = await workflow.compileForGeneration(i2vCurrent(chinese.prompt.replace('女孩', '男孩'), 'compile-g'), async () => JSON.stringify({ modelPrompt: chineseFields(), displayPrompt: chineseFields() }))
  assert.equal(chineseBack.asWritten, true)
})

test('generation writes the mode-exact official alignment: none for 文生, bare labels and the final shot for 首尾帧', async () => {
  const t2v = await workflow.compileForGeneration({ modelId: 'minimax_h3_local', mode: 'text_video', durationSeconds: 5, prompt: textVideoPrompt(), resources: [] })
  // A later shot always names its cut (the official "[Shot N] At MM:SS.mmm, the shot cuts to …"); a clause after it stands as its own sentence.
  assert.equal(t2v.modelText, 'integrated_multimodal_description: [Shot 1] A quiet city wakes before dawn while the locked camera remains static. [Shot 2] At 00:02.000, the shot cuts. Warm sunlight travels gradually across the buildings while the camera pans right at slow speed.\n\noverall_soundscape: Distant traffic and a light morning breeze.\n\nnon_diegetic_music: Soft restrained strings.')
  const fl2v = await workflow.compileForGeneration({ modelId: 'minimax_h3_local', mode: 'first_last', durationSeconds: 5, prompt: firstLastPrompt(5).replace(/<Picture 1>/g, '@首帧').replace(/<Picture 2>/g, '@尾帧'), resources: [firstFrame(), lastFrame()] })
  assert.equal(fl2v.modelText.split('\n\n')[0], 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 5.00-second mark of the target video.')
  assert.match(fl2v.modelText, /\[Shot 1\] Picture 1 is the exact opening composition[^\n]* \[Shot 2\] At 00:03\.500, the shot cuts\. Motion gradually resolves into Picture 2 /)
  assert.doesNotMatch(fl2v.modelText, /<Picture|@/)
  // An empty prompt reaches the graph builder's own empty-prompt error unchanged.
  assert.equal((await workflow.compileForGeneration({ modelId: 'minimax_h3_local', mode: 'text_video', durationSeconds: 5, prompt: ' ', resources: [] })).modelText, '')
})

test('the policy follows the user\'s words, quoted lines follow the requirement, and a short translation falls back to the text as written', async () => {
  // The idle-breathing rule reaches only idle requests (source or requirement), for base and 多参 alike.
  assert.doesNotMatch(workflow.prepareRequest(i2vCurrent('@参考图 中的女神闭目养神，晚风轻拂长发')).requirements, /仅呼吸待机/)
  assert.match(workflow.prepareRequest(i2vCurrent('@参考图 中的机器人原地待机')).requirements, /仅呼吸待机/)
  assert.match(workflow.prepareRequest({ ...i2vCurrent('@参考图 中的机器人站着'), requirements: '改成轻微呼吸的循环待机' }).requirements, /仅呼吸待机/)
  const multi = workflow.prepareRequest({ modelId: 'minimax_h3_local', mode: 'multi_reference', durationSeconds: 5, prompt: 'Use @\u53c2\u8003\u56fe2.', resources: multiResources() }).requirements
  assert.ok(multi.includes(format.instructionFor('')))
  assert.doesNotMatch(multi, /仅呼吸待机/)
  // A quoted line must reach H3 unless the requirement changes the dialogue.
  const speaking = i2vCurrent('@参考图 中的少女挥手并说：“出发吧。”')
  const lost = JSON.stringify({ modelPrompt: englishFields(), displayPrompt: chineseFields() })
  assert.throws(() => workflow.validateAndRestore({ text: lost, context: workflow.prepareRequest(speaking).context, current: speaking }), /原台词未完整保留/)
  const said = JSON.stringify({ modelPrompt: englishFields('[Shot 1] The girl shown in <Picture 1> waves and (S1) says: <d>[Chinese] 走吧。</d> The camera holds a static shot.'), displayPrompt: chineseFields('[Shot 1] <Picture 1> 中的少女挥手，(S1) 说：<d>[Chinese] 走吧。</d>镜头固定。') })
  assert.throws(() => workflow.validateAndRestore({ text: said, context: workflow.prepareRequest(speaking).context, current: speaking }), /原台词未完整保留/)
  const renamed = workflow.prepareRequest({ ...speaking, requirements: '把台词改成“走吧。”' })
  assert.match(workflow.validateAndRestore({ text: said, context: renamed.context, current: speaking }).modelText, /<d>\[Chinese\] 走吧。<\/d>/)
  // The requirement decides by what it says: a quoted replacement line replaces the old one, silence drops it.
  for (const requirements of ['把“出发吧。”改成“走吧。”', '让她改说“走吧。”']) {
    assert.match(workflow.validateAndRestore({ text: said, context: workflow.prepareRequest({ ...speaking, requirements }).context, current: speaking }).modelText, /<d>\[Chinese\] 走吧。<\/d>/, requirements)
  }
  assert.ok(workflow.validateAndRestore({ text: lost, context: workflow.prepareRequest({ ...speaking, requirements: '她不开口，只挥手' }).context, current: speaking }).modelText)
  assert.throws(() => workflow.validateAndRestore({ text: lost, context: workflow.prepareRequest({ ...speaking, requirements: '保留原台词，把镜头改成缓慢推近' }).context, current: speaking }), /原台词未完整保留/)
  // A translation that drops part of the display never reaches H3: the display goes out as written.
  const station = '[Shot 1] <Picture 1> 中的少女站在站台上，身穿米色风衣，背着棕色皮包，缓慢转身面向驶来的列车，抬起右手挥动三次，风吹起她的长发与衣摆，列车灯光在她脸上掠过。镜头保持固定，构图稳定。'
  const shown = format.toBaseDisplay(chineseFields(station), { mode: 'image_video', durationSeconds: 5 }).replace(/<Picture 1>/g, '@参考图')
  const translate = (narrative) => async () => JSON.stringify({ modelPrompt: englishFields(narrative), displayPrompt: '' })
  const shortSent = await workflow.compileForGeneration(i2vCurrent(shown, 'compile-h'), translate('[Shot 1] The girl shown in <Picture 1> waves. The camera holds a static shot.'))
  assert.equal(shortSent.asWritten, true)
  assert.doesNotMatch(shortSent.modelText, /waves/)
  const full = '[Shot 1] The girl shown in <Picture 1> stands on the platform in a beige trench coat with a brown leather bag, slowly turns toward the arriving train and waves her right hand three times while the wind lifts her long hair and coat hem and the train lights sweep across her face. The camera holds a static shot and the framing stays stable.'
  assert.equal((await workflow.compileForGeneration(i2vCurrent(shown, 'compile-h'), translate(full))).modelText, I2V_LINE + '\n\n' + englishFields(full))
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

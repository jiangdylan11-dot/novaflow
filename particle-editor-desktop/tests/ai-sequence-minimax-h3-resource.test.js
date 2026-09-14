const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const resourcePath = path.join(root, 'particle-editor', 'ai-sequence-minimax-h3.resource.js')
const resourceSource = fs.readFileSync(resourcePath, 'utf8')

function loadCommonJsResource() {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
  }
  context.globalThis = context
  vm.runInNewContext(resourceSource, context, { filename: resourcePath })
  return context.module.exports
}

const resource = loadCommonJsResource()

function occupied(key, sourceId, fileName, mimeType) {
  return { key, sourceId, fileName, mimeType, occupied: true }
}

test('exports the MiniMax H3 local model contract through CommonJS and the browser global', () => {
  const context = { console }
  context.globalThis = context
  vm.runInNewContext(resourceSource, context, { filename: resourcePath })

  assert.equal(resource.modelId, 'minimax_h3_local')
  assert.equal(context.NovaFlowAiSequenceMiniMaxH3Resource.modelId, 'minimax_h3_local')
  assert.equal(context.NovaFlowAiSequenceMiniMaxH3Resource.MODEL.label, 'MiniMax_h3')
  assert.ok(Object.isFrozen(resource))
})

test('declares the four modes in product order with exact input layouts', () => {
  assert.deepEqual(Array.from(resource.modeOrder), [
    'text_video',
    'image_video',
    'first_last',
    'multi_reference',
  ])
  assert.deepEqual(
    Array.from(resource.modeOptions, (entry) => [entry.value, entry.label, entry.inputLayout]),
    [
      ['text_video', '\u6587\u751f\u89c6\u9891', 'none'],
      ['image_video', '\u56fe\u751f\u89c6\u9891', 'single_image'],
      ['first_last', '\u9996\u5c3e\u5e27\u89c6\u9891', 'first_last'],
      ['multi_reference', '\u591a\u53c2\u89c6\u9891', 'multi_reference'],
    ],
  )
  assert.equal(resource.modeOptions.every((entry) => entry.supportsNegativePrompt === false), true)
  assert.equal(resource.getModeCapability('missing'), null)
  assert.throws(() => resource.assertMode('missing'), /Unsupported MiniMax H3 mode/)
})

test('declares four image slots, one video slot, and one audio slot with neutral keys', () => {
  assert.deepEqual(
    Array.from(resource.multiReferenceSlots, (entry) => [entry.key, entry.kind, entry.accept, entry.modelToken]),
    [
      ['multi_ref_image_1', 'image', 'image/*', '<Picture 1>'],
      ['multi_ref_image_2', 'image', 'image/*', '<Picture 2>'],
      ['multi_ref_image_3', 'image', 'image/*', '<Picture 3>'],
      ['multi_ref_image_4', 'image', 'image/*', '<Picture 4>'],
      ['multi_ref_video_1', 'video', 'video/*', '<Video 1>'],
      ['multi_ref_audio_1', 'audio', 'audio/*', '<Audio 1>'],
    ],
  )
  assert.equal(new Set(resource.multiReferenceSlots.map((entry) => entry.key)).size, 6)
  assert.equal(resource.multiReferenceSlots.every(Object.isFrozen), true)
})

test('validates slot file types from MIME, extension, and data URL evidence', () => {
  assert.equal(resource.fileMatchesSlot({ name: 'hero.PNG', type: 'image/png' }, 'multi_ref_image_1'), true)
  assert.equal(resource.fileMatchesSlot({ name: 'motion.webm', type: 'video/webm' }, 'multi_ref_video_1'), true)
  assert.equal(resource.fileMatchesSlot({ name: 'voice.flac', type: 'audio/flac' }, 'multi_ref_audio_1'), true)
  assert.equal(resource.fileMatchesSlot({ dataUrl: 'data:image/png;base64,AA==' }, 'multi_ref_image_2'), true)
  assert.equal(resource.fileMatchesSlot({ name: 'wrong.mp4', type: 'video/mp4' }, 'multi_ref_image_1'), false)
  assert.equal(resource.fileMatchesSlot({ name: 'conflict.png', type: 'video/mp4' }, 'multi_ref_video_1'), false)
  assert.equal(resource.fileMatchesSlot({ name: 'unknown.bin' }, 'multi_ref_video_1'), false)
  assert.equal(resource.fileMatchesSlot({ name: 'hero.png' }, 'missing_slot'), false)
  assert.throws(
    () => resource.assertFileMatchesSlot({ name: 'voice.wav', type: 'audio/wav' }, 'multi_ref_image_1'),
    /image\/\*/,
  )
})

test('creates an ordered immutable six-slot snapshot and rejects invalid resource sets', () => {
  const snapshot = resource.createResourceSnapshot([
    occupied('multi_ref_video_1', 'video-a', 'motion.mp4', 'video/mp4'),
    occupied('multi_ref_image_1', 'image-a', 'hero.png', 'image/png'),
  ])
  assert.equal(snapshot.length, 6)
  assert.deepEqual(
    Array.from(snapshot, (entry) => [entry.key, entry.occupied]),
    [
      ['multi_ref_image_1', true],
      ['multi_ref_image_2', false],
      ['multi_ref_image_3', false],
      ['multi_ref_image_4', false],
      ['multi_ref_video_1', true],
      ['multi_ref_audio_1', false],
    ],
  )
  assert.ok(Object.isFrozen(snapshot))
  assert.equal(snapshot.every(Object.isFrozen), true)
  assert.throws(
    () => resource.createResourceSnapshot([
      occupied('multi_ref_image_1', 'one', 'one.png', 'image/png'),
      occupied('multi_ref_image_1', 'two', 'two.png', 'image/png'),
    ]),
    /Duplicate MiniMax H3 resource slot/,
  )
  assert.throws(
    () => resource.createResourceSnapshot([occupied('unknown', 'one', 'one.png', 'image/png')]),
    /Unknown MiniMax H3 resource slot/,
  )
  assert.throws(
    () => resource.createResourceSnapshot([occupied('multi_ref_audio_1', 'one', 'one.png', 'image/png')]),
    /audio\/\*/,
  )
})

test('validates mode-aware resource requirements without leaking multi-reference inputs', () => {
  assert.throws(
    () => resource.validateResourceSnapshot([], { mode: 'multi_reference' }),
    /\u81f3\u5c11\u9700\u8981\u4e00\u4e2a\u53c2\u8003\u8d44\u6e90/,
  )
  const image = occupied('multi_ref_image_1', 'image-a', 'hero.png', 'image/png')
  assert.equal(resource.validateResourceSnapshot([image], { mode: 'multi_reference' })[0].occupied, true)
  assert.throws(
    () => resource.validateResourceSnapshot([image], {
      mode: 'text_video',
      rejectInactiveResources: true,
    }),
    /\u4e0d\u5e94\u63d0\u4ea4\u591a\u53c2\u8d44\u6e90/,
  )
  assert.throws(
    () => resource.validateResourceSnapshot([image], {
      mode: 'multi_reference',
      requiredKeys: ['multi_ref_audio_1'],
    }),
    /\u58f0\u97f3\u53c2\u8003\u672a\u63d0\u4f9b/,
  )
})

test('compiles occupied H3 mentions and reports unoccupied aliases without changing them', () => {
  const resources = [
    occupied('multi_ref_image_1', 'image-a', 'hero.png', 'image/png'),
    occupied('multi_ref_video_1', 'video-a', 'motion.mp4', 'video/mp4'),
    occupied('multi_ref_audio_1', 'audio-a', 'voice.wav', 'audio/wav'),
  ]
  const compiled = resource.compileMentions(
    '\u4fdd\u6301 @\u53c2\u8003\u56fe1 \u7684\u4e3b\u4f53\uff0c\u53c2\u8003 @\u89c6\u9891\u53c2\u8003 \u7684\u52a8\u4f5c\u548c @\u58f0\u97f3\u53c2\u8003\uff0c\u4e0d\u8981\u4f7f\u7528 @\u53c2\u8003\u56fe4',
    resources,
  )
  assert.equal(
    compiled.text,
    '\u4fdd\u6301 <Picture 1> \u7684\u4e3b\u4f53\uff0c\u53c2\u8003 <Video 1> \u7684\u52a8\u4f5c\u548c <Audio 1>\uff0c\u4e0d\u8981\u4f7f\u7528 @\u53c2\u8003\u56fe4',
  )
  assert.deepEqual(Array.from(compiled.mentions, (entry) => entry.modelToken), [
    '<Picture 1>',
    '<Video 1>',
    '<Audio 1>',
  ])
  assert.deepEqual(Array.from(compiled.invalidTokens), ['@\u53c2\u8003\u56fe4'])
})

test('compacts non-contiguous image slots to the Ref2VA Picture order', () => {
  const compiled = resource.compileMentions(
    '@\u53c2\u8003\u56fe2 \u8ddf\u968f @\u53c2\u8003\u56fe4 \u7684\u52a8\u4f5c',
    [
      occupied('multi_ref_image_2', 'image-b', 'second.png', 'image/png'),
      occupied('multi_ref_image_4', 'image-d', 'fourth.png', 'image/png'),
    ],
  )

  assert.equal(compiled.text, '<Picture 1> \u8ddf\u968f <Picture 2> \u7684\u52a8\u4f5c')
  assert.deepEqual(
    Array.from(compiled.snapshot.filter((entry) => entry.occupied), (entry) => [entry.key, entry.modelToken]),
    [
      ['multi_ref_image_2', '<Picture 1>'],
      ['multi_ref_image_4', '<Picture 2>'],
    ],
  )
  assert.deepEqual(Array.from(compiled.mentions, (entry) => entry.modelToken), [
    '<Picture 1>',
    '<Picture 2>',
  ])
})

test('detects a resource identity or occupancy change after a snapshot was captured', () => {
  const expected = [occupied('multi_ref_image_1', 'image-a', 'hero.png', 'image/png')]
  const same = [occupied('multi_ref_image_1', 'image-a', 'renamed.png', 'image/png')]
  const replaced = [occupied('multi_ref_image_1', 'image-b', 'hero.png', 'image/png')]

  assert.equal(resource.assertStableResourceSnapshot(expected, same), true)
  assert.throws(
    () => resource.assertStableResourceSnapshot(expected, replaced),
    /\u8d44\u6e90\u5feb\u7167\u5df2\u53d8\u66f4/,
  )
  assert.throws(
    () => resource.assertStableResourceSnapshot(expected, []),
    /\u8d44\u6e90\u5feb\u7167\u5df2\u53d8\u66f4/,
  )
})

test('validates the current 4+1+1 reference-media safety policy', () => {
  assert.equal(typeof resource.validateReferenceMediaPolicy, 'function')
  assert.equal(resource.REFERENCE_MEDIA_POLICY.maxImages, 4)
  assert.equal(resource.REFERENCE_MEDIA_POLICY.maxVideos, 1)
  assert.equal(resource.REFERENCE_MEDIA_POLICY.maxAudios, 1)
  assert.equal(resource.REFERENCE_MEDIA_POLICY.requiredVideoFps, 24)
  assert.equal(resource.REFERENCE_MEDIA_POLICY.minimumDurationSec, 2)
  assert.equal(resource.REFERENCE_MEDIA_POLICY.maximumDurationSec, 15)

  const valid = resource.validateReferenceMediaPolicy({
    images: [{}, {}, {}, {}],
    videos: [{ fps: 23.976, frames: null, durationSec: 15 }],
    audios: [{ durationSec: 2 }],
  })
  assert.equal(valid.imageCount, 4)
  assert.equal(valid.videoCount, 1)
  assert.equal(valid.audioCount, 1)
  assert.equal(valid.videoDurationSec, 15)
  assert.equal(valid.audioDurationSec, 2)

  assert.equal(resource.validateReferenceMediaPolicy({ audios: [{ durationSec: 4 }] }).audioCount, 1)
  assert.throws(
    () => resource.validateReferenceMediaPolicy({ images: [{}], videos: [{ fps: 30, durationSec: 4 }] }),
    /24 FPS/i,
  )
  assert.throws(
    () => resource.validateReferenceMediaPolicy({ images: [{}], videos: [{ fps: 24, frames: 4, durationSec: 4 }] }),
    /at least five frames/i,
  )
  assert.throws(
    () => resource.validateReferenceMediaPolicy({ images: [{}], videos: [{ fps: 24, durationSec: 1.99 }] }),
    /2-15 seconds/i,
  )
  assert.throws(
    () => resource.validateReferenceMediaPolicy({ images: [{}], audios: [{ durationSec: 15.01 }] }),
    /2-15 seconds/i,
  )
  assert.throws(
    () => resource.validateReferenceMediaPolicy({ images: [{}, {}, {}, {}, {}] }),
    /at most 4/i,
  )
})

test('has no dependency on existing mention, input compatibility, or Art Generate modules', () => {
  assert.doesNotMatch(
    resourceSource,
    /NovaFlowResourceMentionTool|NovaFlowAiSequenceInputCompat|NovaFlowArtGenerate|jimeng|seedance|kling/i,
  )
})

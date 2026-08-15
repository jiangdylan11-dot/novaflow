const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const modulePath = path.resolve(__dirname, '../../particle-editor/ui-design-local-resolution.helper.js')
delete require.cache[require.resolve(modulePath)]
require(modulePath)
const resolution = globalThis.NovaFlowUiDesignLocalResolution

function img2imgFixture() {
  return {
    load: {
      class_type: 'LoadImage',
      inputs: { image: 'guide.png' },
    },
    encode: {
      class_type: 'VAEEncode',
      inputs: { pixels: ['load', 0], vae: ['vae', 0] },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: { latent_image: ['encode', 0] },
    },
    decode: {
      class_type: 'VAEDecode',
      inputs: { samples: ['sampler', 0], vae: ['vae', 0] },
    },
    save: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'UI', images: ['decode', 0] },
    },
  }
}

function txt2imgFixture() {
  return {
    latent: {
      class_type: 'EmptyLatentImage',
      inputs: { width: 1080, height: 1920, batch_size: 1 },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: { latent_image: ['latent', 0] },
    },
    decode: {
      class_type: 'VAEDecode',
      inputs: { samples: ['sampler', 0], vae: ['vae', 0] },
    },
    save: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'UI', images: ['decode', 0] },
    },
  }
}

test('safe-resolution plan maps 1080x1920 and its landscape peer to a 921600-pixel working canvas', () => {
  assert.deepEqual(resolution.plan({ width: 1080, height: 1920 }), {
    active: true,
    requested: { width: 1080, height: 1920 },
    working: { width: 720, height: 1280 },
    scaled: true,
    maxWorkingPixels: 921600,
  })
  assert.deepEqual(resolution.plan({ width: 1920, height: 1080 }).working, {
    width: 1280,
    height: 720,
  })
  assert.equal(resolution.plan({ width: 720, height: 1280 }).scaled, false)
})

test('img2img scales only the VAE input, then restores and sharpens the decoded output', () => {
  const source = img2imgFixture()
  const result = resolution.apply(source, {
    state: { width: 1080, height: 1920 },
  })

  assert.equal(result.metadata.mode, 'img2img')
  assert.deepEqual(result.metadata.requested, { width: 1080, height: 1920 })
  assert.deepEqual(result.metadata.working, { width: 720, height: 1280 })
  const workingId = result.metadata.workingScaleNodeIds[0]
  const outputId = result.metadata.outputScaleNodeIds[0]
  const sharpenId = result.metadata.sharpenNodeIds[0]
  assert.deepEqual(result.workflow[workingId].inputs, {
    image: ['load', 0],
    upscale_method: 'lanczos',
    width: 720,
    height: 1280,
    crop: 'disabled',
  })
  assert.deepEqual(result.workflow.encode.inputs.pixels, [workingId, 0])
  assert.deepEqual(result.workflow[outputId].inputs, {
    image: ['decode', 0],
    upscale_method: 'lanczos',
    width: 1080,
    height: 1920,
    crop: 'disabled',
  })
  assert.deepEqual(result.workflow[sharpenId].inputs, {
    image: [outputId, 0],
    sharpen_radius: 1,
    sigma: 0.8,
    alpha: 0.6,
  })
  assert.deepEqual(result.workflow.save.inputs.images, [sharpenId, 0])
  assert.deepEqual(source.encode.inputs.pixels, ['load', 0], 'source workflow stays immutable')
})

test('forceWorkingImageScale inserts a working scale at 720x1280 without adding a second output scale', () => {
  const result = resolution.apply(img2imgFixture(), {
    state: { width: 720, height: 1280 },
    forceWorkingImageScale: true,
  })

  assert.equal(resolution.VERSION, '20260729-ui-local-safe-resolution-3')
  assert.equal(result.metadata.mode, 'img2img')
  assert.equal(result.metadata.scaled, false)
  assert.equal(result.metadata.forceWorkingImageScale, true)
  assert.deepEqual(result.metadata.requested, { width: 720, height: 1280 })
  assert.deepEqual(result.metadata.working, { width: 720, height: 1280 })
  assert.equal(result.metadata.workingScaleNodeIds.length, 1)
  const workingId = result.metadata.workingScaleNodeIds[0]
  assert.deepEqual(result.workflow[workingId].inputs, {
    image: ['load', 0],
    upscale_method: 'lanczos',
    width: 720,
    height: 1280,
    crop: 'disabled',
  })
  assert.deepEqual(result.workflow.encode.inputs.pixels, [workingId, 0])
  assert.equal(result.metadata.outputScaleNodeIds.length, 0)
  assert.equal(result.metadata.sharpenNodeIds.length, 0)
  assert.deepEqual(result.workflow.save.inputs.images, ['decode', 0])
})

test('forceOutputFinish sharpens a native-size result without a redundant scale node', () => {
  const result = resolution.apply(img2imgFixture(), {
    state: { width: 720, height: 1280 },
    forceOutputFinish: true,
    outputSharpenAlpha: 0.15,
  })

  assert.equal(result.metadata.scaled, false)
  assert.equal(result.metadata.forceOutputFinish, true)
  assert.equal(result.metadata.outputScaleNodeIds.length, 0)
  assert.equal(result.metadata.sharpenNodeIds.length, 1)
  const sharpenId = result.metadata.sharpenNodeIds[0]
  assert.deepEqual(result.workflow[sharpenId].inputs, {
    image: ['decode', 0],
    sharpen_radius: 1,
    sigma: 0.8,
    alpha: 0.15,
  })
  assert.deepEqual(result.workflow.save.inputs.images, [sharpenId, 0])
})

test('txt2img reduces the empty latent and applies the same output finish', () => {
  const result = resolution.apply(txt2imgFixture(), {
    width: 1080,
    height: 1920,
  })

  assert.equal(result.metadata.mode, 'txt2img')
  assert.deepEqual(result.workflow.latent.inputs, {
    width: 720,
    height: 1280,
    batch_size: 1,
  })
  assert.equal(result.metadata.workingScaleNodeIds.length, 0)
  assert.equal(result.metadata.outputScaleNodeIds.length, 1)
  assert.equal(result.metadata.sharpenNodeIds.length, 1)
})

test('target dimensions can be recovered from the existing NovaFlow aspect-fit node', () => {
  const workflow = img2imgFixture()
  workflow.target = {
    class_type: 'ImageScale',
    inputs: {
      image: ['load', 0],
      upscale_method: 'lanczos',
      width: 1080,
      height: 1920,
      crop: 'disabled',
    },
    _meta: { title: 'NovaFlow Aspect Fit' },
  }
  const result = resolution.apply(workflow)

  assert.equal(result.metadata.active, true)
  assert.deepEqual(result.metadata.requested, { width: 1080, height: 1920 })
  assert.deepEqual(result.metadata.working, { width: 720, height: 1280 })
})

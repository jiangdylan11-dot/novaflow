const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const projectRoot = path.resolve(__dirname, '..', '..')
const helperPath = path.join(projectRoot, 'particle-editor', 'ui-design-local-reference.helper.js')

function loadCommonJs(filePath) {
  const context = { module: { exports: {} }, exports: {}, console }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath })
  return context.module.exports
}

const helper = loadCommonJs(helperPath)

function proxyEnvironment(options = {}) {
  const loadedSources = []
  const draws = []
  const dimensions = options.dimensions || {}

  class FakeImage {
    set src(value) {
      this._src = String(value || '')
      loadedSources.push(this._src)
      const size = dimensions[this._src] || { width: 1080, height: 1920 }
      this.naturalWidth = size.width
      this.naturalHeight = size.height
      queueMicrotask(() => this.onload?.())
    }

    get src() {
      return this._src
    }
  }

  const document = {
    createElement(type) {
      assert.equal(type, 'canvas')
      const canvas = {
        width: 0,
        height: 0,
        _source: '',
        _filter: 'none',
        getContext(contextType) {
          assert.equal(contextType, '2d')
          if (this._context) return this._context
          this._context = {
            filter: 'none',
            imageSmoothingEnabled: false,
            imageSmoothingQuality: '',
            globalAlpha: 1,
            drawImage(source, ...args) {
              canvas._source = String(source?._source || source?.src || '')
              canvas._filter = String(source?._filter || this.filter || 'none')
              draws.push({
                sourceType: source instanceof FakeImage ? 'image' : 'canvas',
                source: canvas._source,
                filter: String(this.filter || 'none'),
                alpha: this.globalAlpha,
                composite: String(this.globalCompositeOperation || 'source-over'),
                smoothing: this.imageSmoothingEnabled,
                args,
                width: canvas.width,
                height: canvas.height,
              })
            },
          }
          return this._context
        },
        toDataURL() {
          return `data:image/png;base64,${Buffer.from([
            this._source,
            this._filter,
            `${this.width}x${this.height}`,
          ].join('|')).toString('base64')}`
        },
      }
      return canvas
    },
  }

  return { Image: FakeImage, document, loadedSources, draws }
}

function reference(role, index) {
  return {
    name: `${role}-${index}.png`,
    dataUrl: `data:image/png;base64,${role}-${index}`,
    role,
    sourceId: `${role}-${index}`,
    width: 1080,
    height: 1920,
  }
}

test('redesign keeps role-bearing references raw and reduces only palette-only color guidance', () => {
  const roles = ['reference', 'style', 'layout', 'color', 'material', 'character', 'subject', 'content']
  const input = roles.map(reference)
  const snapshot = JSON.stringify(input)
  const plan = helper.buildReferencePlan(input, { mode: 'redesign' })

  assert.equal(helper.VERSION, '20260730-ui-design-local-reference-10')
  assert.equal(plan.kind, 'ui-local-reference-plan')
  assert.equal(plan.mode, 'redesign')
  assert.deepEqual(
    Array.from(plan.guidance, (entry) => entry.role),
    ['color'],
  )
  assert.deepEqual(
    Array.from(plan.raw, (entry) => entry.role),
    ['reference', 'style', 'layout', 'material', 'character', 'subject', 'content'],
  )
  assert.equal(plan.base.length, 0)
  assert.equal(JSON.stringify(input), snapshot)
  assert.ok(Object.isFrozen(plan))
  assert.ok(Object.isFrozen(plan.entries))
  assert.ok(plan.entries.every(Object.isFrozen))
})

test('iteration uses the first generic UI reference as base without promoting the layout guide', () => {
  const plan = helper.buildReferencePlan({
    mode: 'iteration',
    references: [
      reference('ui_layout', 0),
      {
        ...reference('reference', 1),
        targetNodeId: 'generator-1',
        connectionKind: 'iteration',
      },
      reference('style', 2),
      reference('character', 3),
    ],
  })

  assert.equal(plan.mode, 'iteration')
  assert.equal(plan.base.length, 1)
  assert.equal(plan.base[0].index, 1)
  assert.equal(plan.base[0].role, 'reference')
  assert.equal(plan.base[0].targetNodeId, 'generator-1')
  assert.equal(plan.base[0].connectionKind, 'iteration')
  assert.deepEqual(
    Array.from(plan.guidance, (entry) => entry.role),
    [],
  )
  assert.deepEqual(Array.from(plan.raw, (entry) => entry.role), ['layout', 'style', 'character'])
})

test('an explicit iteration base or baseIndex overrides automatic base selection', () => {
  const explicit = helper.buildReferencePlan([
    reference('layout', 0),
    reference('style', 1),
    reference('iteration', 2),
  ], { mode: 'redesign' })
  assert.equal(explicit.base.length, 1)
  assert.equal(explicit.base[0].index, 2)
  assert.equal(explicit.base[0].role, 'reference')

  const indexed = helper.buildReferencePlan([
    reference('layout', 0),
    reference('style', 1),
    reference('reference', 2),
  ], { mode: 'iteration', baseIndex: 1 })
  assert.equal(indexed.base.length, 1)
  assert.equal(indexed.base[0].index, 1)
  assert.equal(indexed.base[0].role, 'style')
})

test('materialization transforms only color guidance and preserves every role-bearing reference', async () => {
  const plan = helper.buildReferencePlan([
    reference('reference', 0),
    reference('style', 1),
    reference('layout', 2),
    reference('material', 3),
    reference('character', 4),
    reference('subject', 5),
    reference('content', 6),
    reference('color', 7),
  ], { mode: 'redesign' })
  const calls = []
  const materialized = await helper.materializeReferencePlan(plan, {
    async transformer(entry, context) {
      calls.push({ index: entry.index, context })
      return {
        dataUrl: `data:image/png;base64,proxy-${entry.index}`,
        width: 64,
        height: 96,
        proxyEncoding: 'test-low-frequency',
      }
    },
  })

  assert.deepEqual(calls.map((call) => call.index), [7])
  assert.ok(calls.every((call) => call.context.mode === 'redesign'))
  assert.deepEqual(
    Array.from(materialized.guidance, (entry) => entry.dataUrl),
    ['data:image/png;base64,proxy-7'],
  )
  assert.ok(materialized.guidance.every((entry) => entry.transformed === true))
  assert.ok(materialized.guidance.every((entry) => entry.proxyEncoding === 'test-low-frequency'))
  assert.deepEqual(
    Array.from(materialized.raw, (entry) => entry.dataUrl),
    [
      'data:image/png;base64,reference-0',
      'data:image/png;base64,style-1',
      'data:image/png;base64,layout-2',
      'data:image/png;base64,material-3',
      'data:image/png;base64,character-4',
      'data:image/png;base64,subject-5',
      'data:image/png;base64,content-6',
    ],
  )
  assert.ok(materialized.raw.every((entry) => entry.transformed === false))
  assert.equal(plan.guidance[0].dataUrl, 'data:image/png;base64,color-7')
})

test('materialization preserves an iteration base at full fidelity', async () => {
  const plan = helper.buildReferencePlan([
    reference('reference', 0),
    reference('style', 1),
    reference('color', 2),
  ], { mode: 'iteration' })
  const transformedIndexes = []
  const materialized = await helper.materializeReferencePlan(plan, {
    transformer(entry) {
      transformedIndexes.push(entry.index)
      return `data:image/png;base64,proxy-${entry.index}`
    },
  })

  assert.deepEqual(transformedIndexes, [2])
  assert.equal(materialized.base[0].dataUrl, 'data:image/png;base64,reference-0')
  assert.equal(materialized.base[0].transformed, false)
  assert.equal(materialized.raw[0].dataUrl, 'data:image/png;base64,style-1')
  assert.equal(materialized.raw[0].transformed, false)
  assert.equal(materialized.guidance[0].dataUrl, 'data:image/png;base64,proxy-2')
})

test('automatic ordinary primary materializes as an identity-reduced composition proxy only', async () => {
  const references = Array.from(helper.buildReferencePlan([
    reference('reference', 0),
    reference('reference', 1),
  ], { mode: 'redesign' }).entries)
  const plan = Object.freeze({
    applied: true,
    strategy: 'connection-order',
    referenceIndex: 0,
    name: references[0].name,
    sourceId: references[0].sourceId,
    references: Object.freeze(references),
  })
  const calls = []
  const materialized = await helper.materializeAutomaticPrimary(plan, {
    async transformer(entry, context) {
      calls.push({ entry, context })
      return {
        dataUrl: 'data:image/png;base64,COMPOSITION_PROXY',
        width: 360,
        height: 640,
        proxyEncoding: 'composition-proxy-raster-v2',
      }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].entry.sourceId, 'reference-0')
  assert.deepEqual({ ...calls[0].context }, {
    mode: 'redesign',
    index: 0,
    treatment: 'composition-guidance',
    purpose: 'automatic-primary-composition-proxy',
    sampleMaxEdge: 48,
    outputMaxEdge: 720,
    monochrome: false,
    sampleFilter: 'blur(0.8px) saturate(0.78)',
    sourceFingerprint: helper.sourceFingerprint(references[0].dataUrl),
  })
  assert.equal(materialized.transformed, true)
  assert.equal(materialized.treatment, 'composition-guidance')
  assert.equal(materialized.proxyEncoding, 'composition-proxy-raster-v2')
  assert.equal(materialized.references[0].dataUrl, 'data:image/png;base64,COMPOSITION_PROXY')
  assert.equal(materialized.references[0].treatment, 'composition-guidance')
  assert.equal(materialized.references[0].proxyEncoding, 'composition-proxy-raster-v2')
  assert.equal(materialized.references[0].transformed, true)
  assert.equal(materialized.references[1].dataUrl, 'data:image/png;base64,reference-1')
  assert.equal(materialized.references[1].treatment, 'raw')
  assert.equal(materialized.references[1].transformed, undefined)
  assert.equal(plan.references[0].dataUrl, 'data:image/png;base64,reference-0')
  assert.ok(Object.isFrozen(materialized))
  assert.ok(Object.isFrozen(materialized.references))
  assert.ok(materialized.references.every(Object.isFrozen))

  const explicitLayoutPlan = Object.freeze({
    applied: false,
    strategy: 'explicit-layout',
    referenceIndex: 0,
    references: Object.freeze([Object.freeze(reference('layout', 0))]),
  })
  assert.equal(
    await helper.materializeAutomaticPrimary(explicitLayoutPlan, {
      transformer() {
        throw new Error('explicit layout must not be proxied')
      },
    }),
    explicitLayoutPlan,
  )
})

test('automatic composition proxy can fuse the theme-neutral semantic guide into the primary low-frequency image', async () => {
  const source = 'data:image/png;base64,REFERENCE'
  const guide = 'data:image/png;base64,SEMANTIC_GUIDE'
  const environment = proxyEnvironment({
    dimensions: {
      [source]: { width: 720, height: 1280 },
      [guide]: { width: 360, height: 640 },
    },
  })
  const fused = await helper.createCompositionProxy({
    name: 'reference.png',
    dataUrl: source,
  }, {
    ...environment,
    outputMaxEdge: 720,
    semanticGuideDataUrl: guide,
    semanticGuideEncoding: 'soft-ui-semantic-scaffold-v1',
  })

  assert.equal(fused.proxyEncoding, 'composition-semantic-fusion-raster-v1')
  assert.equal(fused.proxyKind, 'composition-semantic-fusion')
  assert.equal(fused.semanticGuideFused, true)
  assert.equal(fused.semanticGuideEncoding, 'soft-ui-semantic-scaffold-v1')
  assert.equal(fused.semanticGuideOpacity, 0.28)
  assert.ok(environment.loadedSources.includes(guide))
  const guideDraw = environment.draws.find((draw) => draw.source === guide)
  assert.ok(guideDraw)
  assert.equal(guideDraw.alpha, 0.28)
  assert.equal(guideDraw.composite, 'screen')
})

test('quality perimeter scrub preserves the full interior while pixelating four non-overlapping edge bands', async () => {
  assert.equal(helper.PERIMETER_SCRUB_ENCODING, 'perimeter-identity-scrub-raster-v1')
  assert.equal(helper.PERIMETER_SCRUB_ALGORITHM, 'full-resolution-edge-pixelate-v1')
  assert.equal(helper.PERIMETER_SCRUB_TREATMENT, 'perimeter-scrubbed-primary')
  assert.equal(
    helper.PERIMETER_IDENTITY_REDUCTION_POLICY,
    'scrub-common-perimeter-source-identity-preserve-interior-v1',
  )
  assert.deepEqual({ ...helper.PERIMETER_SCRUB_DEFAULTS }, {
    topRatio: 0.105,
    sideRatio: 0.055,
    bottomRatio: 0.06,
    pixelBlockRatio: 0.02,
    minPixelBlockSize: 12,
    maxPixelBlockSize: 24,
    sampleFilter: 'blur(0.65px)',
  })

  const environment = proxyEnvironment()
  const entry = reference('reference', 0)
  const scrubbed = await helper.createPerimeterIdentityScrub(entry, environment)

  assert.equal(scrubbed.width, 1080)
  assert.equal(scrubbed.height, 1920)
  assert.equal(scrubbed.sourceWidth, 1080)
  assert.equal(scrubbed.sourceHeight, 1920)
  assert.equal(scrubbed.proxyEncoding, helper.PERIMETER_SCRUB_ENCODING)
  assert.equal(scrubbed.proxyKind, 'identity-scrub')
  assert.equal(scrubbed.sourceFingerprint, helper.sourceFingerprint(entry.dataUrl))
  assert.equal(scrubbed.monochrome, false)
  assert.equal(scrubbed.colorMode, 'color')
  assert.equal(scrubbed.frequencyBand, 'full-interior')
  assert.equal(scrubbed.identityReduced, true)
  assert.equal(scrubbed.identityReductionScope, 'perimeter-only')
  assert.equal(
    scrubbed.identityReductionPolicy,
    helper.PERIMETER_IDENTITY_REDUCTION_POLICY,
  )
  assert.equal(scrubbed.perimeterScrubAlgorithm, helper.PERIMETER_SCRUB_ALGORITHM)
  assert.equal(scrubbed.interiorPreserved, true)
  assert.equal(scrubbed.scrubTopRatio, 0.105)
  assert.equal(scrubbed.scrubSideRatio, 0.055)
  assert.equal(scrubbed.scrubBottomRatio, 0.06)
  assert.equal(scrubbed.scrubTopPx, 202)
  assert.equal(scrubbed.scrubSidePx, 59)
  assert.equal(scrubbed.scrubBottomPx, 115)
  assert.equal(scrubbed.pixelBlockRatio, 0.02)
  assert.equal(scrubbed.pixelBlockSize, 22)
  assert.equal(scrubbed.scrubSampleFilter, 'blur(0.65px)')
  assert.equal(scrubbed.scrubRegionCount, 4)
  assert.equal(scrubbed.layoutAwarePreservation, false)
  assert.equal(scrubbed.preserveRegionCount, 0)
  assert.equal(scrubbed.preserveRegionSignature, '')

  const imageDraws = environment.draws.filter((draw) => draw.sourceType === 'image')
  const canvasDraws = environment.draws.filter((draw) => draw.sourceType === 'canvas')
  assert.equal(imageDraws.length, 5)
  assert.equal(canvasDraws.length, 4)
  assert.deepEqual(imageDraws[0].args, [0, 0, 1080, 1920])
  assert.deepEqual(
    imageDraws.slice(1).map((draw) => draw.args.slice(0, 4)),
    [
      [0, 0, 1080, 202],
      [0, 1805, 1080, 115],
      [0, 202, 59, 1603],
      [1021, 202, 59, 1603],
    ],
  )
  assert.deepEqual(
    imageDraws.slice(1).map((draw) => [draw.width, draw.height]),
    [
      [50, 10],
      [50, 6],
      [3, 73],
      [3, 73],
    ],
  )
  assert.ok(imageDraws.slice(1).every((draw) => draw.filter === 'blur(0.65px)'))
  assert.ok(imageDraws.slice(1).every((draw) => draw.smoothing === true))
  assert.deepEqual(
    canvasDraws.map((draw) => draw.args.slice(4)),
    [
      [0, 0, 1080, 202],
      [0, 1805, 1080, 115],
      [0, 202, 59, 1603],
      [1021, 202, 59, 1603],
    ],
  )
  assert.ok(canvasDraws.every((draw) => draw.filter === 'none'))
  assert.ok(canvasDraws.every((draw) => draw.smoothing === false))
})

test('quality perimeter scrub preserves normalized semantic control footprints and scrubs their remainder', async () => {
  const environment = proxyEnvironment()
  const entry = reference('reference', 0)
  const preserveRegions = [
    {
      token: 'navigation-control',
      normalizedBounds: {
        xNorm: 0.82,
        yNorm: 0.02,
        wNorm: 0.14,
        hNorm: 0.07,
      },
    },
  ]
  const scrubbed = await helper.createPerimeterIdentityScrub(entry, {
    ...environment,
    preserveRegions,
  })

  assert.equal(scrubbed.layoutAwarePreservation, true)
  assert.equal(scrubbed.preserveRegionCount, 1)
  assert.equal(scrubbed.preserveRegionSignature, 'preserve=885,38,152,135')
  assert.equal(scrubbed.scrubRegionCount, 7)

  const imageDraws = environment.draws.filter((draw) => draw.sourceType === 'image')
  const scrubSources = imageDraws.slice(1).map((draw) => draw.args.slice(0, 4))
  assert.deepEqual(scrubSources, [
    [0, 0, 1080, 38],
    [0, 173, 1080, 29],
    [0, 38, 885, 135],
    [1037, 38, 43, 135],
    [0, 1805, 1080, 115],
    [0, 202, 59, 1603],
    [1021, 202, 59, 1603],
  ])
  assert.ok(scrubSources.every(([x, y, width, height]) => (
    x + width <= 885
    || x >= 1037
    || y + height <= 38
    || y >= 173
  )))
})

test('quality perimeter scrub cache identity follows the source and actual scrub parameters', async () => {
  const entry = reference('reference', 0)
  const first = await helper.createPerimeterIdentityScrub(entry, proxyEnvironment())
  const repeated = await helper.createPerimeterIdentityScrub(entry, proxyEnvironment())
  const changedTop = await helper.createPerimeterIdentityScrub(entry, {
    ...proxyEnvironment(),
    topRatio: 0.12,
  })
  const changedBlockRatio = await helper.createPerimeterIdentityScrub(entry, {
    ...proxyEnvironment(),
    pixelBlockRatio: 0.025,
  })
  const changedPreserveRegions = await helper.createPerimeterIdentityScrub(entry, {
    ...proxyEnvironment(),
    preserveRegions: [
      { bounds: { x: 0.82, y: 0.02, width: 0.14, height: 0.07 } },
    ],
  })
  const replaced = {
    ...entry,
    dataUrl: 'data:image/png;base64,replaced-perimeter-source',
  }
  const changedSource = await helper.createPerimeterIdentityScrub(replaced, proxyEnvironment())

  assert.equal(first.proxyCacheKey, repeated.proxyCacheKey)
  assert.notEqual(first.proxyCacheKey, changedTop.proxyCacheKey)
  assert.notEqual(first.proxyCacheKey, changedBlockRatio.proxyCacheKey)
  assert.notEqual(first.proxyCacheKey, changedPreserveRegions.proxyCacheKey)
  assert.match(changedPreserveRegions.proxyCacheKey, /preserve=885,38,152,135$/)
  assert.notEqual(first.sourceFingerprint, changedSource.sourceFingerprint)
  assert.notEqual(first.proxyCacheKey, changedSource.proxyCacheKey)
})

test('quality automatic primary forwards generic normalized preserve regions only when supplied', async () => {
  const references = Array.from(helper.buildReferencePlan([
    reference('reference', 0),
  ], { mode: 'redesign' }).entries)
  const plan = Object.freeze({
    applied: true,
    strategy: 'connection-order',
    referenceIndex: 0,
    references: Object.freeze(references),
  })
  const preserveRegions = Object.freeze([
    Object.freeze({
      token: 'primary-control',
      bounds: Object.freeze({ x: 0.8, y: 0.92, width: 0.16, height: 0.06 }),
    }),
  ])
  const calls = []

  await helper.materializeAutomaticPrimary(plan, {
    profile: 'quality',
    preserveRegions,
    async transformer(entry, context) {
      calls.push({ entry, context })
      return helper.createPerimeterIdentityScrub(entry, {
        ...proxyEnvironment(),
        ...context,
      })
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].context.preserveRegions, preserveRegions)
  assert.equal(Object.isFrozen(calls[0].context), true)
})

test('quality automatic primary uses the perimeter scrub contract and preserves secondary references', async () => {
  const references = Array.from(helper.buildReferencePlan([
    reference('reference', 0),
    reference('reference', 1),
  ], { mode: 'redesign' }).entries)
  const plan = Object.freeze({
    applied: true,
    strategy: 'connection-order',
    referenceIndex: 0,
    name: references[0].name,
    sourceId: references[0].sourceId,
    references: Object.freeze(references),
  })
  const environment = proxyEnvironment()
  const calls = []
  const materialized = await helper.materializeAutomaticPrimary(plan, {
    profile: 'quality',
    async transformer(entry, context) {
      calls.push({ entry, context })
      return helper.createPerimeterIdentityScrub(entry, {
        ...environment,
        ...context,
      })
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].entry.sourceId, 'reference-0')
  assert.deepEqual({ ...calls[0].context }, {
    mode: 'redesign',
    index: 0,
    treatment: helper.PERIMETER_SCRUB_TREATMENT,
    purpose: 'automatic-primary-perimeter-identity-scrub',
    ...helper.PERIMETER_SCRUB_DEFAULTS,
    sourceFingerprint: helper.sourceFingerprint(references[0].dataUrl),
  })
  assert.equal(materialized.transformed, true)
  assert.equal(materialized.treatment, helper.PERIMETER_SCRUB_TREATMENT)
  assert.equal(materialized.proxyEncoding, helper.PERIMETER_SCRUB_ENCODING)
  assert.equal(materialized.references[0].treatment, helper.PERIMETER_SCRUB_TREATMENT)
  assert.equal(materialized.references[0].proxyEncoding, helper.PERIMETER_SCRUB_ENCODING)
  assert.equal(materialized.references[0].identityReductionScope, 'perimeter-only')
  assert.equal(
    materialized.references[0].perimeterScrubAlgorithm,
    helper.PERIMETER_SCRUB_ALGORITHM,
  )
  assert.equal(materialized.references[0].interiorPreserved, true)
  assert.equal(materialized.references[0].scrubRegionCount, 4)
  assert.equal(materialized.references[0].scrubTopPx, 202)
  assert.equal(materialized.references[0].scrubSidePx, 59)
  assert.equal(materialized.references[0].scrubBottomPx, 115)
  assert.equal(materialized.references[0].pixelBlockSize, 22)
  assert.equal(materialized.references[1].dataUrl, references[1].dataUrl)
  assert.equal(materialized.references[1].treatment, references[1].treatment)
  assert.equal(materialized.references[1].transformed, undefined)
  assert.equal(plan.references[0].dataUrl, references[0].dataUrl)
  assert.ok(Object.isFrozen(materialized))
  assert.ok(Object.isFrozen(materialized.references))
  assert.ok(materialized.references.every(Object.isFrozen))
})

test('quality automatic primary rejects a perimeter scrub declaring a stale source fingerprint', async () => {
  const references = Array.from(helper.buildReferencePlan([
    reference('reference', 0),
  ], { mode: 'redesign' }).entries)
  const plan = Object.freeze({
    applied: true,
    strategy: 'connection-order',
    referenceIndex: 0,
    references: Object.freeze(references),
  })

  await assert.rejects(
    helper.materializeAutomaticPrimary(plan, {
      profile: 'quality',
      transformer() {
        return {
          dataUrl: 'data:image/png;base64,STALE_PERIMETER_SCRUB',
          proxyEncoding: helper.PERIMETER_SCRUB_ENCODING,
          sourceFingerprint: helper.sourceFingerprint('data:image/png;base64,OLD_SOURCE'),
        }
      },
    }),
    /stale proxy/,
  )
})

test('dual proxy pair keeps low-saturation color composition while exposing an identity-reduced scattered material field', async () => {
  const environment = proxyEnvironment()
  const entry = reference('reference', 0)
  const pair = await helper.createDualProxyPair(entry, environment)

  assert.equal(pair.kind, helper.DUAL_PROXY_KIND)
  assert.equal(pair.sourceFingerprint, helper.sourceFingerprint(entry.dataUrl))
  assert.match(pair.proxyCacheKey, new RegExp(pair.sourceFingerprint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(pair.composition.proxyEncoding, helper.COMPOSITION_PROXY_ENCODING)
  assert.equal(pair.composition.monochrome, false)
  assert.equal(pair.composition.colorMode, 'color')
  assert.equal(pair.composition.identityReduced, true)
  assert.equal(pair.material.proxyEncoding, helper.MATERIAL_PROXY_ENCODING)
  assert.equal(pair.material.proxyKind, 'material')
  assert.equal(pair.material.monochrome, false)
  assert.equal(pair.material.colorMode, 'color')
  assert.equal(pair.material.frequencyBand, 'mid')
  assert.equal(pair.material.identityReduced, true)
  assert.equal(pair.material.identityReductionPolicy, helper.IDENTITY_REDUCTION_POLICY)
  assert.equal(pair.material.materialAlgorithm, helper.MATERIAL_PROXY_ALGORITHM)
  assert.ok(Math.max(pair.material.sampleWidth, pair.material.sampleHeight) <= 192)
  assert.equal(pair.material.microTileSize, 12)
  assert.equal(pair.material.tileCount, pair.material.tileColumns * pair.material.tileRows)
  assert.equal(pair.material.adjacencyBroken, true)
  assert.equal(pair.material.offsetLayerOpacity, 0.14)
  assert.notEqual(pair.material.offsetLayerX, 0)
  assert.notEqual(pair.material.offsetLayerY, 0)
  assert.equal(pair.material.softenFilter, 'blur(0.45px)')
  assert.equal(pair.material.sourceFingerprint, pair.sourceFingerprint)
  assert.notEqual(pair.material.proxyCacheKey, pair.composition.proxyCacheKey)
  assert.ok(Object.isFrozen(pair))
  assert.ok(Object.isFrozen(pair.composition))
  assert.ok(Object.isFrozen(pair.material))

  const imageDraws = environment.draws.filter((draw) => draw.sourceType === 'image')
  assert.equal(imageDraws.length, 2)
  assert.doesNotMatch(imageDraws[0].filter, /grayscale/)
  assert.match(imageDraws[0].filter, /blur\(0\.8px\) saturate\(0\.78\)/)
  assert.doesNotMatch(imageDraws[1].filter, /grayscale/)
  assert.match(imageDraws[1].filter, /blur\(/)
  const materialTileDraws = environment.draws.filter((draw) => (
    draw.sourceType === 'canvas' && draw.args.length === 8
  ))
  assert.equal(materialTileDraws.length, pair.material.tileCount * 2)
  assert.equal(
    materialTileDraws.filter((draw) => draw.alpha === pair.material.offsetLayerOpacity).length,
    pair.material.tileCount,
  )
  assert.match(environment.draws.at(-1).filter, /blur\(0\.45px\)/)
})

test('material scatter is deterministic per fingerprint, breaks source adjacency, and changes cache identity with its field parameters', async () => {
  const firstEnvironment = proxyEnvironment()
  const secondEnvironment = proxyEnvironment()
  const entry = reference('material', 0)
  const first = await helper.createMaterialProxy(entry, firstEnvironment)
  const second = await helper.createMaterialProxy(entry, secondEnvironment)
  const tileSources = (environment, tileCount) => environment.draws
    .filter((draw) => draw.sourceType === 'canvas' && draw.args.length === 8)
    .slice(0, tileCount)
    .map((draw) => [draw.args[0], draw.args[1]])

  assert.deepEqual(
    tileSources(firstEnvironment, first.tileCount),
    tileSources(secondEnvironment, second.tileCount),
  )
  assert.equal(first.proxyCacheKey, second.proxyCacheKey)
  assert.equal(first.scatterSeed, second.scatterSeed)
  const primaryTiles = tileSources(firstEnvironment, first.tileCount)
  const horizontallyAdjacentPairs = primaryTiles.slice(1).filter((current, index) => {
    if ((index + 1) % first.tileColumns === 0) return false
    const previous = primaryTiles[index]
    return Math.abs(current[0] - previous[0]) + Math.abs(current[1] - previous[1])
      <= first.microTileSize
  })
  assert.equal(horizontallyAdjacentPairs.length, 0)

  const changed = await helper.createMaterialProxy(entry, {
    ...proxyEnvironment(),
    microTileSize: 18,
  })
  assert.notEqual(changed.proxyCacheKey, first.proxyCacheKey)
  assert.notEqual(changed.microTileSize, first.microTileSize)
})

test('material proxy is rebuilt from the current data URL and receives a distinct source cache key', async () => {
  const environment = proxyEnvironment()
  const entry = reference('material', 0)
  const firstSource = entry.dataUrl
  const first = await helper.createMaterialProxy(entry, environment)
  entry.dataUrl = 'data:image/png;base64,material-current-replacement'
  const second = await helper.createMaterialProxy(entry, environment)

  assert.deepEqual(environment.loadedSources, [firstSource, entry.dataUrl])
  assert.equal(first.sourceFingerprint, helper.sourceFingerprint(firstSource))
  assert.equal(second.sourceFingerprint, helper.sourceFingerprint(entry.dataUrl))
  assert.notEqual(first.sourceFingerprint, second.sourceFingerprint)
  assert.notEqual(first.proxyCacheKey, second.proxyCacheKey)
  assert.notEqual(first.dataUrl, second.dataUrl)
})

test('materialization rejects a transformed proxy declaring a stale source fingerprint', async () => {
  const plan = helper.buildReferencePlan([
    reference('color', 0),
  ], { mode: 'redesign' })

  await assert.rejects(
    helper.materializeReferencePlan(plan, {
      transformer() {
        return {
          dataUrl: 'data:image/png;base64,STALE_PROXY',
          sourceFingerprint: helper.sourceFingerprint('data:image/png;base64,OLD_SOURCE'),
        }
      },
    }),
    /stale proxy/,
  )
})

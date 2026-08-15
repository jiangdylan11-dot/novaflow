const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const zlib = require('node:zlib')

const projectRoot = path.resolve(__dirname, '..', '..')
const helperPath = path.join(projectRoot, 'particle-editor', 'ui-design-layout-guide.helper.js')

function loadCommonJs(filePath) {
  const context = {
    module: { exports: {} },
    exports: {},
    Buffer,
    console,
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath })
  return context.module.exports
}

const helper = loadCommonJs(helperPath)

function decodePng(dataUrl) {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64')
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), signature)

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let offset = 8
  const idat = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    }
    offset += length + 12
  }

  assert.equal(bitDepth, 8)
  const channels = colorType === 0 ? 1 : colorType === 6 ? 4 : 0
  assert.ok(channels > 0, `unsupported PNG color type ${colorType}`)
  const scanlines = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (stride + 1)
    assert.equal(scanlines[sourceOffset], 0)
    pixels.set(scanlines.subarray(sourceOffset + 1, sourceOffset + 1 + stride), y * stride)
  }
  return { width, height, colorType, channels, pixels }
}

function maximumAdjacentGradient(pixels, width, height) {
  let maximum = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (x + 1 < width) maximum = Math.max(maximum, Math.abs(pixels[index] - pixels[index + 1]))
      if (y + 1 < height) maximum = Math.max(maximum, Math.abs(pixels[index] - pixels[index + width]))
    }
  }
  return maximum
}

function maximumDecodedRgbChannelDelta(decoded) {
  let maximum = 0
  const pixelCount = decoded.width * decoded.height
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * decoded.channels
    const red = decoded.pixels[offset]
    const green = decoded.colorType === 0 ? red : decoded.pixels[offset + 1]
    const blue = decoded.colorType === 0 ? red : decoded.pixels[offset + 2]
    maximum = Math.max(maximum, Math.abs(red - green), Math.abs(red - blue), Math.abs(green - blue))
  }
  return maximum
}

const source = {
  canvas: { width: 1280, height: 1280 },
  blocks: [{
    id: 'hero',
    role: 'hero',
    x: 384,
    y: 512,
    width: 512,
    height: 256,
  }],
}

test('soft occupancy guide is deterministic single-channel grayscale with no hard edge', () => {
  const options = { maxEdge: 128, visualEncoding: 'soft-occupancy-heatmap-v1' }
  const first = helper.createCleanLayoutGuide(source, options)
  const second = helper.createCleanLayoutGuide(source, options)
  const decoded = decodePng(first.dataUrl)

  assert.equal(first.visualEncoding, 'soft-occupancy-heatmap-v1')
  assert.equal(first.dataUrl, second.dataUrl)
  assert.equal(decoded.colorType, 0)
  assert.equal(decoded.channels, 1)
  assert.equal(decoded.width, 128)
  assert.equal(decoded.height, 128)
  assert.equal(maximumDecodedRgbChannelDelta(decoded), 0)

  const center = decoded.pixels[64 * decoded.width + 64]
  const corner = decoded.pixels[0]
  assert.ok(center >= 142, `expected strong region-center occupancy, got ${center}`)
  assert.ok(corner <= 26, `expected neutral low-occupancy background, got ${corner}`)
  assert.ok(center - corner >= 116)

  const uniqueShades = new Set(decoded.pixels)
  const peakCount = Array.from(decoded.pixels, (shade) => shade).filter((shade) => shade === 144).length
  assert.ok(uniqueShades.size >= 80, `expected a continuous feathered field, got ${uniqueShades.size} shades`)
  assert.ok(peakCount < decoded.pixels.length * 0.005, `unexpected solid center plateau of ${peakCount} pixels`)
  assert.ok(
    maximumAdjacentGradient(decoded.pixels, decoded.width, decoded.height) <= 7,
    'soft guide contains a high-gradient hard edge',
  )
})

test('semantic UI scaffold v2 is deterministic grayscale and gaussian-only', () => {
  const scaffoldSource = {
    canvas: { width: 1080, height: 1920 },
    blocks: [
      { id: 'header', role: 'header', x: 0, y: 0, width: 1080, height: 180 },
      { id: 'hero', role: 'hero', purpose: '角色展示', x: 0, y: 180, width: 1080, height: 620 },
      { id: 'content', role: 'content', requirements: '3×3 grid', x: 70, y: 800, width: 940, height: 820 },
      { id: 'footer', role: 'footer', x: 0, y: 1620, width: 1080, height: 300 },
    ],
  }
  const options = {
    maxEdge: 192,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
    semanticText: '顶部显示游戏标题和返回按钮，底部显示余额、投注、WIN与Spin按钮。',
  }
  const first = helper.createCleanLayoutGuide(scaffoldSource, options)
  const second = helper.createCleanLayoutGuide(scaffoldSource, options)
  const decoded = decodePng(first.dataUrl)

  assert.equal(first.visualEncoding, 'soft-ui-semantic-scaffold-v2')
  assert.equal(first.semanticScaffold, true)
  assert.equal(first.visualPrimitive, 'gaussian-only')
  assert.equal(first.dataUrl, second.dataUrl)
  assert.equal(decoded.colorType, 0)
  assert.equal(decoded.channels, 1)
  assert.ok(
    maximumAdjacentGradient(decoded.pixels, decoded.width, decoded.height) <= 30,
    'semantic scaffold contains a hard rectangular edge',
  )
  assert.notEqual(
    first.dataUrl,
    helper.createCleanLayoutGuide(scaffoldSource, {
      ...options,
      visualEncoding: 'soft-occupancy-heatmap-v1',
    }).dataUrl,
  )
})

test('semantic UI scaffold derives functional tokens without storing theme nouns', () => {
  const scaffoldSource = {
    canvas: { width: 1080, height: 1920 },
    blocks: [
      { id: 'header', role: 'header', purpose: '顶部标题与导航', x: 0, y: 0, width: 1080, height: 180 },
      { id: 'hero', role: 'hero', purpose: '角色主视觉展示', x: 0, y: 180, width: 1080, height: 620 },
      { id: 'content', role: 'content', requirements: '严格3行×3列内容网格', x: 70, y: 800, width: 940, height: 820 },
      { id: 'footer', role: 'footer', purpose: '底部操作区', x: 0, y: 1620, width: 1080, height: 300 },
    ],
  }
  const options = {
    maxEdge: 192,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
    semanticText: '东方哪吒主题；顶部游戏标题和返回；底部余额、投注、WIN与Spin。',
  }
  const guide = helper.createCleanLayoutGuide(scaffoldSource, options)
  const specifications = JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications))
  const byId = Object.fromEntries(specifications.map((item) => [item.regionId, item]))

  assert.deepEqual(byId.header.tokens, ['title', 'back'])
  assert.deepEqual(byId.hero.tokens, ['subject'])
  assert.equal(byId.content.kind, 'grid')
  assert.equal(byId.content.columns, 3)
  assert.equal(byId.content.rows, 3)
  assert.deepEqual(byId.footer.tokens, ['balance', 'bet', 'win', 'primary-action'])
  assert.doesNotMatch(JSON.stringify(specifications), /哪吒|东方/)

  const alternateTheme = helper.createCleanLayoutGuide(scaffoldSource, {
    ...options,
    semanticText: '科幻机甲主题；顶部游戏标题和返回；底部余额、投注、WIN与Spin。',
  })
  assert.equal(guide.dataUrl, alternateTheme.dataUrl)
  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications)),
    JSON.parse(JSON.stringify(alternateTheme.semanticScaffoldSpecifications)),
  )
})

test('semantic back scaffold uses a soft horizontal carrier with a recognizable left chevron', () => {
  const project = {
    canvas: { width: 720, height: 1280 },
    blocks: [{
      id: 'header',
      role: 'header',
      purpose: 'Game title and back button',
      x: 50,
      y: 25,
      width: 622,
      height: 154,
    }],
  }
  const options = {
    maxEdge: 288,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  }
  const guide = helper.createCleanLayoutGuide(project, options)
  const withoutBack = helper.createCleanLayoutGuide({
    ...project,
    blocks: [{ ...project.blocks[0], purpose: 'Game title' }],
  }, options)
  const decoded = decodePng(guide.dataUrl)
  const baseline = decodePng(withoutBack.dataUrl)
  const specification = JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications))[0]
  const region = guide.semantic.regions[0]
  const left = region.xNorm * decoded.width
  const top = region.yNorm * decoded.height
  const width = region.wNorm * decoded.width
  const height = region.hNorm * decoded.height
  const centerX = left + width * 0.89
  const centerY = top + height * 0.5
  const halfWidth = Math.max(5, height * 0.1)
  const halfHeight = Math.max(5, height * 0.12)
  const delta = (x, y) => {
    const index = Math.round(y) * decoded.width + Math.round(x)
    return decoded.pixels[index] - baseline.pixels[index]
  }
  const chevronDeltas = [
    delta(centerX - halfWidth, centerY),
    delta(centerX + halfWidth, centerY - halfHeight),
    delta(centerX + halfWidth, centerY + halfHeight),
  ]
  const emptyCornerDeltas = [
    delta(centerX - halfWidth, centerY - halfHeight),
    delta(centerX - halfWidth, centerY + halfHeight),
    delta(centerX + halfWidth, centerY),
  ]

  assert.deepEqual(specification.tokens, ['title', 'back'])
  assert.ok(Math.min(...chevronDeltas) >= 35, `expected a connected left chevron, got ${chevronDeltas}`)
  assert.ok(
    chevronDeltas.reduce((sum, value) => sum + value, 0)
      > emptyCornerDeltas.reduce((sum, value) => sum + value, 0) + 45,
    `back scaffold is not left-directional: ${chevronDeltas} vs ${emptyCornerDeltas}`,
  )

  const changed = []
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(decoded.height, Math.ceil(top + height)); y += 1) {
    for (let x = Math.max(0, Math.floor(left + width * 0.72)); x < decoded.width; x += 1) {
      if (delta(x, y) >= 5) changed.push([x, y])
    }
  }
  const changedXs = changed.map(([x]) => x)
  const changedYs = changed.map(([, y]) => y)
  const changedWidth = Math.max(...changedXs) - Math.min(...changedXs) + 1
  const changedHeight = Math.max(...changedYs) - Math.min(...changedYs) + 1
  assert.ok(changedWidth > changedHeight * 1.15, `back carrier is not horizontal: ${changedWidth}x${changedHeight}`)
  assert.ok(
    maximumAdjacentGradient(decoded.pixels, decoded.width, decoded.height) <= 30,
    'semantic back scaffold contains a hard edge',
  )
})

test('semantic UI scaffold gives an explicit hero win notice its own soft banner center', () => {
  const project = {
    canvas: { width: 720, height: 1280 },
    blocks: [{
      id: 'hero',
      role: 'hero',
      purpose: '角色展示区域中央站立主角，角色下方显示中奖提示文字',
      x: 0,
      y: 128,
      width: 720,
      height: 360,
    }],
  }
  const options = {
    maxEdge: 160,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  }
  const guide = helper.createCleanLayoutGuide(project, options)
  const hero = JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications))[0]
  const withoutBanner = helper.createCleanLayoutGuide({
    ...project,
    blocks: [{ ...project.blocks[0], purpose: '角色展示区域中央站立主角' }],
  }, options)

  assert.deepEqual(hero.tokens, ['subject', 'status-banner'])
  assert.deepEqual(hero.expectedRects['status-banner'], {
    xNorm: 0,
    yNorm: 0.3137,
    wNorm: 1,
    hNorm: 0.0619,
  })
  assert.notEqual(guide.dataUrl, withoutBanner.dataUrl)
  assert.doesNotMatch(JSON.stringify(hero), /中奖|文字|主角/)
})

test('semantic UI scaffold does not invent grids or slot metrics for generic content', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 1080, height: 1920 },
    blocks: [
      { id: 'content', role: 'content', purpose: '商品与文章内容展示', x: 60, y: 260, width: 960, height: 1180 },
      { id: 'footer', role: 'footer', purpose: '辅助操作与帮助', x: 0, y: 1500, width: 1080, height: 420 },
    ],
  }, {
    maxEdge: 192,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
    semanticText: '简洁的内容浏览页面。',
  })
  const specifications = JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications))
  const byId = Object.fromEntries(specifications.map((item) => [item.regionId, item]))

  assert.deepEqual(JSON.parse(JSON.stringify(guide.semanticSubgridSpecifications)), [])
  assert.equal(byId.content.kind, 'generic')
  assert.deepEqual(byId.content.tokens, ['content'])
  assert.deepEqual(byId.footer.tokens, ['controls'])
  assert.doesNotMatch(JSON.stringify(specifications), /grid-|balance|bet|win|primary-action/)
})

test('semantic UI scaffold keeps header-only help semantics out of the footer', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      { id: 'header', role: 'header', purpose: 'Primary navigation', x: 0, y: 0, width: 720, height: 128 },
      { id: 'footer', role: 'footer', purpose: 'Primary controls', x: 0, y: 1024, width: 720, height: 256 },
    ],
  }, {
    maxEdge: 160,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
    semanticText: 'Header has a Help button and title; Footer has Balance, Bet, WIN and Spin controls.',
  })
  const byId = Object.fromEntries(
    JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications))
      .map((item) => [item.regionId, item]),
  )

  assert.deepEqual(byId.footer.tokens, ['balance', 'bet', 'win', 'primary-action'])
  assert.equal(byId.footer.tokens.includes('utility-info'), false)
})

test('semantic UI scaffold preserves the requested footer control count without theme-specific tokens', () => {
  const project = {
    canvas: { width: 720, height: 1280 },
    blocks: [{
      id: 'footer',
      role: 'footer',
      purpose: 'Balance Bet Win Spin Auto Turbo Recharge Menu controls',
      x: 0,
      y: 1024,
      width: 720,
      height: 256,
    }],
  }
  const guide = helper.createCleanLayoutGuide(project, {
    maxEdge: 160,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  const footer = JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications))[0]

  assert.deepEqual(footer.tokens, [
    'balance',
    'bet',
    'win',
    'primary-action',
    'utility-auto',
    'utility-speed',
    'utility-recharge',
    'utility-menu',
  ])

  const primaryOnly = helper.createCleanLayoutGuide({
    ...project,
    blocks: [{ ...project.blocks[0], purpose: 'Balance Bet Win Spin controls' }],
  }, {
    maxEdge: 160,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  assert.notEqual(
    guide.dataUrl,
    primaryOnly.dataUrl,
    'each explicitly requested utility action must contribute a separate soft control center',
  )
})

test('semantic repair mask targets only the missing back control and win-notice slot', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      { id: 'header', role: 'header', purpose: 'Game title and back button', x: 0, y: 0, width: 720, height: 140 },
      { id: 'hero', role: 'hero', purpose: 'Character showcase with winning notice banner', x: 0, y: 140, width: 720, height: 420 },
      { id: 'content', role: 'content', requirements: 'exact 3x3 grid', x: 35, y: 560, width: 650, height: 500 },
      { id: 'footer', role: 'footer', purpose: 'Balance Bet WIN Spin controls', x: 0, y: 1060, width: 720, height: 220 },
    ],
  }, {
    maxEdge: 180,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  const mask = helper.createSemanticRepairMask(guide, {
    maxEdge: 180,
    review: {
      failureClass: 'CONTENT',
      failureCodes: ['MISSING_BACK_BUTTON', 'MISSING_WIN_NOTICE'],
      retryPrompt: 'Restore the complete back control and winning notice banner.',
    },
  })
  const decoded = decodePng(mask.dataUrl)
  const sample = (x, y) => decoded.pixels[Math.round(y) * decoded.width + Math.round(x)]

  assert.deepEqual(Array.from(mask.selectedTokens), ['back', 'status-banner'])
  assert.equal(mask.visualEncoding, 'semantic-repair-mask-v1')
  assert.equal(decoded.colorType, 0)
  assert.ok(mask.coverageRatio > 0 && mask.coverageRatio < 0.45)
  assert.ok(sample(decoded.width * 0.89, decoded.height * 0.055) > 220)
  assert.ok(sample(decoded.width * 0.5, decoded.height * 0.405) > 220)
  assert.equal(sample(decoded.width * 0.5, decoded.height * 0.65), 0)
})

test('semantic repair mask consumes exact region-scoped failed checklist tokens', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      { id: 'header', role: 'header', purpose: 'Game title and back button', x: 0, y: 0, width: 720, height: 140 },
      { id: 'hero', role: 'hero', purpose: 'Character showcase with winning notice banner', x: 0, y: 140, width: 720, height: 420 },
      { id: 'content', role: 'content', requirements: 'exact 3x3 grid', x: 35, y: 560, width: 650, height: 500 },
    ],
  }, {
    maxEdge: 180,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  const mask = helper.createSemanticRepairMask(guide, {
    maxEdge: 180,
    review: {
      failureClass: 'STRUCTURE',
      failureCodes: ['STRUCTURE_MISSING'],
      failedChecklistTokens: ['region-1:back', 'region-2:status-banner'],
      hardFailures: ['Candidate is missing mandatory controls.'],
    },
  })
  const decoded = decodePng(mask.dataUrl)
  const sample = (x, y) => decoded.pixels[Math.round(y) * decoded.width + Math.round(x)]

  assert.deepEqual(Array.from(mask.selectedTokens), ['back', 'status-banner'])
  assert.deepEqual(
    Array.from(mask.selectedChecklistTokens),
    ['region-1:back', 'region-2:status-banner'],
  )
  assert.ok(sample(decoded.width * 0.89, decoded.height * 0.055) > 220)
  assert.ok(sample(decoded.width * 0.5, decoded.height * 0.405) > 220)
  assert.equal(sample(decoded.width * 0.5, decoded.height * 0.65), 0)
})

test('semantic repair mask accepts localized Chinese readability details merged with structure failure', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      { id: 'header', role: 'header', purpose: 'Game title and back button', x: 50, y: 25, width: 622, height: 154 },
      { id: 'hero', role: 'hero', purpose: 'Character showcase with winning notice banner', x: 50, y: 203, width: 622, height: 354 },
      { id: 'content', role: 'content', requirements: 'exact 3x3 grid', x: 50, y: 581, width: 622, height: 437 },
      { id: 'footer', role: 'footer', purpose: 'Balance Bet WIN Auto Speed Recharge Menu Spin controls', x: 50, y: 1043, width: 622, height: 213 },
    ],
  }, {
    maxEdge: 288,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  const failed = [
    'region-1:back',
    'region-2:status-banner',
    'region-4:win',
    'region-4:utility-auto',
    'region-4:utility-speed',
    'region-4:utility-recharge',
    'region-4:utility-menu',
  ]
  const detail = failed.join('、')
  const mask = helper.createSemanticRepairMask(guide, {
    maxEdge: 288,
    review: {
      status: 'FAIL',
      failureClass: 'STRUCTURE',
      failureCodes: ['CORE_UI_UNREADABLE', 'STRUCTURE_MISSING'],
      failedChecklistTokens: failed,
      hardFailures: [
        `候选图中以下必需 UI 项无法清晰辨认，核心 UI 可读性不足：${detail}`,
        `必需语义检查项缺失或不符合要求：${detail}`,
      ],
      retryPrompt: `提高以下必需 UI 项的清晰度、对比度与功能辨识度：${detail}。除这些失败项外，保留已经正确的页面区域、内容与控件。`,
    },
  })

  assert.ok(mask)
  assert.deepEqual(
    Array.from(mask.selectedChecklistTokens),
    failed,
  )
  assert.ok(mask.coverageRatio > 0.45 && mask.coverageRatio < 0.55)
})

test('semantic repair mask maps an exact grid checklist token and rejects unknown checklist IDs', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [{
      id: 'content',
      role: 'content',
      requirements: 'exact 3x3 grid',
      x: 144,
      y: 384,
      width: 432,
      height: 432,
    }],
  }, {
    maxEdge: 180,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  const mask = helper.createSemanticRepairMask(guide, {
    maxEdge: 180,
    review: {
      failureClass: 'STRUCTURE',
      failureCodes: ['STRUCTURE_MISSING'],
      failedChecklistTokens: ['region-1:grid-3x3'],
    },
  })

  assert.deepEqual(Array.from(mask.selectedTokens), ['grid'])
  assert.deepEqual(Array.from(mask.selectedChecklistTokens), ['region-1:grid-3x3'])
  assert.equal(helper.createSemanticRepairMask(guide, {
    review: {
      failureClass: 'STRUCTURE',
      failureCodes: ['STRUCTURE_MISSING'],
      failedChecklistTokens: ['region-9:grid-3x3'],
    },
  }), null)
})

test('exact checklist tokens do not localize a separate actionable leakage failure', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [{
      id: 'header',
      role: 'header',
      purpose: 'Game title and back button',
      x: 0,
      y: 0,
      width: 720,
      height: 140,
    }],
  }, {
    maxEdge: 180,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.equal(helper.createSemanticRepairMask(guide, {
    review: {
      failureClass: 'LEAKAGE',
      failureCodes: ['STRUCTURE_MISSING', 'REFERENCE_CONTENT_LEAKAGE'],
      failedChecklistTokens: ['region-1:back'],
      hardFailures: ['An unrelated reference identity remains at the outer edge.'],
    },
  }), null)
})

test('inventory checklist failures cannot hide a separately localized reference leakage failure', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      {
        id: 'header',
        role: 'header',
        purpose: 'Game title and back button',
        x: 0,
        y: 0,
        width: 720,
        height: 140,
      },
      {
        id: 'hero',
        role: 'hero',
        purpose: 'Character showcase',
        x: 0,
        y: 140,
        width: 720,
        height: 420,
      },
    ],
  }, {
    maxEdge: 180,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.equal(helper.createSemanticRepairMask(guide, {
    review: {
      failureClass: 'STRUCTURE',
      failureCodes: ['STRUCTURE_MISSING', 'REFERENCE_CONTENT_LEAKAGE'],
      failedChecklistTokens: ['region-1:back'],
      hardFailures: ['Copied reference character subject remains in the hero area.'],
      retryPrompt: 'Restore the back control and remove the copied reference character subject.',
    },
  }), null)
})

test('semantic repair mask localizes theme-neutral hero, subject, and background failures', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [{
      id: 'showcase',
      role: 'hero',
      purpose: 'Primary subject showcase',
      x: 36,
      y: 140,
      width: 648,
      height: 300,
    }],
  }, {
    maxEdge: 180,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  const cases = [
    { code: 'MISSING_HERO_REGION', failureClass: 'STRUCTURE', token: 'hero' },
    { code: 'WRONG_HERO_SUBJECT', failureClass: 'CONTENT', token: 'subject' },
    { code: 'BACKGROUND_LEAKAGE', failureClass: 'LEAKAGE', token: 'background' },
  ]

  for (const item of cases) {
    const mask = helper.createSemanticRepairMask(guide, {
      maxEdge: 180,
      review: {
        failureClass: item.failureClass,
        failureCodes: [item.code],
      },
    })
    assert.ok(mask, `${item.token} must be localized from the hero scaffold`)
    assert.deepEqual(Array.from(mask.selectedTokens), [item.token])
    assert.ok(mask.coverageRatio > 0 && mask.coverageRatio < 0.45)
  }
  assert.doesNotMatch(
    JSON.stringify(cases) + helper.createSemanticRepairMask.toString(),
    /哪吒|波塞冬|老虎|老虎机/,
  )
})

test('semantic repair mask requires every content and structure failure to be localized', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      { id: 'hero', role: 'hero', purpose: 'Primary subject showcase', x: 180, y: 140, width: 360, height: 180 },
      { id: 'content', role: 'content', requirements: 'exact 3x3 grid', x: 144, y: 480, width: 432, height: 180 },
    ],
  }, {
    maxEdge: 180,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })
  const mask = helper.createSemanticRepairMask(guide, {
    maxEdge: 180,
    review: {
      failureClass: 'STRUCTURE',
      failureCodes: ['TARGET_CONTENT_MISMATCH', 'STRUCTURE_MISSING'],
      hardFailures: [
        'The hero subject has the wrong identity.',
        'The main content grid structure is missing cells.',
      ],
    },
  })
  const decoded = decodePng(mask.dataUrl)
  const sample = (x, y) => decoded.pixels[Math.round(y) * decoded.width + Math.round(x)]

  assert.deepEqual(Array.from(mask.selectedTokens), ['subject', 'grid'])
  assert.ok(mask.coverageRatio > 0 && mask.coverageRatio < 0.45)
  assert.ok(sample(decoded.width * 0.5, decoded.height * 0.18) > 220)
  assert.ok(sample(decoded.width * 0.5, decoded.height * 0.445) > 220)
  assert.equal(sample(decoded.width * 0.5, decoded.height * 0.9), 0)
})

test('semantic repair mask fails closed when any multi-failure target lacks scaffold localization', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      { id: 'header', role: 'header', purpose: 'Back button only', x: 0, y: 0, width: 720, height: 128 },
      { id: 'hero', role: 'hero', purpose: 'Primary subject showcase', x: 0, y: 128, width: 720, height: 320 },
    ],
  }, {
    maxEdge: 160,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.equal(helper.createSemanticRepairMask(guide, {
    review: {
      failureClass: 'LEAKAGE',
      failureCodes: ['REFERENCE_CONTENT_LEAKAGE', 'MISSING_BACK_BUTTON'],
      hardFailures: ['A reference logo at the outer edge was copied.'],
      retryPrompt: 'Remove the copied edge logo and restore the back button.',
    },
  }), null, 'the back control must not be repaired alone when the leaked logo has no title slot')
  assert.equal(helper.createSemanticRepairMask(guide, {
    review: {
      failureClass: 'LEAKAGE',
      failureCodes: ['MISSING_BACK_BUTTON', 'EDGE_IDENTITY_LEAKAGE'],
      retryPrompt: 'Restore the back control and remove the leaked edge identity.',
    },
  }), null, 'an unknown edge identity must not be silently dropped from a partial mask')
})

test('semantic repair mask refuses polish-only, ambiguous, and over-broad repairs', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [
      { id: 'header', role: 'header', purpose: 'Title and back button', x: 0, y: 0, width: 720, height: 128 },
      { id: 'content', role: 'content', requirements: '3x3 grid', x: 0, y: 128, width: 720, height: 900 },
      { id: 'footer', role: 'footer', purpose: 'Balance Bet WIN Spin', x: 0, y: 1028, width: 720, height: 252 },
    ],
  }, {
    maxEdge: 160,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.equal(helper.createSemanticRepairMask(guide, {
    review: { failureClass: 'POLISH', retryPrompt: 'Improve lighting and material finish.' },
  }), null)
  assert.equal(helper.createSemanticRepairMask(guide, {
    review: { failureClass: 'LEAKAGE', failureCodes: ['REFERENCE_CONTENT_LEAKAGE'] },
  }), null)
  assert.equal(helper.createSemanticRepairMask(guide, {
    maxEdge: 160,
    review: { failureClass: 'STRUCTURE', retryPrompt: 'Rebuild the complete grid.' },
  }), null)
  assert.doesNotMatch(helper.createSemanticRepairMask.toString(), /哪吒|波塞冬|老虎|老虎机/)
})

test('filled-regions-only remains the byte-identical default encoding', () => {
  const implicit = helper.createCleanLayoutGuide(source, { maxEdge: 128 })
  const explicit = helper.createCleanLayoutGuide(source, {
    maxEdge: 128,
    visualEncoding: 'filled-regions-only',
  })

  assert.equal(implicit.visualEncoding, 'filled-regions-only')
  assert.equal(explicit.visualEncoding, 'filled-regions-only')
  assert.equal(implicit.dataUrl, explicit.dataUrl)
  assert.equal(decodePng(implicit.dataUrl).colorType, 6)
})

test('semantic subgrid encodes an exact 3x3 structure as nine soft centers without boxes', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 1280, height: 1280 },
    blocks: [{
      id: 'reels',
      role: 'content',
      purpose: '3×3老虎机转轴',
      requirements: '总共9个符号格',
      x: 128,
      y: 256,
      width: 1024,
      height: 768,
    }],
  }, {
    maxEdge: 128,
    visualEncoding: 'soft-occupancy-heatmap-v1',
    semanticSubgrid: true,
  })
  const decoded = decodePng(guide.dataUrl)
  const sample = (x, y) => decoded.pixels[Math.round(y) * decoded.width + Math.round(x)]
  for (const y of [38, 64, 90]) {
    for (const x of [30, 64, 98]) {
      assert.ok(sample(x, y) >= 138, `expected soft grid center near ${x},${y}`)
    }
  }
  assert.equal(guide.semanticSubgrid, true)
  assert.ok(
    maximumAdjacentGradient(decoded.pixels, decoded.width, decoded.height) <= 16,
    'semantic subgrid contains a hard rectangular edge',
  )
})

test('semantic grid parser supports explicit row-by-column wording without treating delivery size as a grid', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helper.semanticGridFromText('严格3行×4列的奖励符号网格'))), {
    columns: 4,
    rows: 3,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(helper.semanticGridFromText('4 columns by 3 rows'))), {
    columns: 4,
    rows: 3,
  })
  assert.equal(helper.semanticGridFromText('竖屏720×1280'), null)
})

test('semantic scaffold preserves a 3-column reel request as columns-only occupancy', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helper.semanticGridFromText('主内容区域为3列老虎机转轴'))), {
    columns: 3,
    columnsOnly: true,
  })
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 1280, height: 1280 },
    blocks: [{
      id: 'reels',
      role: 'content',
      purpose: '3列老虎机转轴',
      x: 128,
      y: 256,
      width: 1024,
      height: 768,
    }],
  }, {
    maxEdge: 128,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticSubgridSpecifications)),
    [{ regionId: 'reels', columns: 3, columnsOnly: true, source: 'region' }],
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications)),
    [{
      regionId: 'reels',
      kind: 'grid',
      tokens: ['grid-3-columns'],
      columns: 3,
      columnsOnly: true,
      expectedRects: {
        'grid-3-columns': { xNorm: 0.1, yNorm: 0.2, wNorm: 0.8, hNorm: 0.6 },
      },
    }],
  )
  const decoded = decodePng(guide.dataUrl)
  const sample = (x, y) => decoded.pixels[Math.round(y) * decoded.width + Math.round(x)]
  for (const x of [30, 64, 98]) {
    assert.ok(sample(x, 64) >= 150, `expected a column center near ${x},64`)
  }
  for (const y of [40, 88]) {
    for (const x of [30, 64, 98]) {
      assert.ok(sample(x, y) >= 125, `expected vertical column occupancy near ${x},${y}`)
    }
  }
})

test('semantic scaffold preserves a 3-row grid request as rows-only occupancy', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helper.semanticGridFromText('奖励符号grid保持3行'))), {
    rows: 3,
    rowsOnly: true,
  })
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 1280, height: 1280 },
    blocks: [{
      id: 'grid',
      role: 'content',
      requirements: '奖励符号grid保持3行',
      x: 128,
      y: 256,
      width: 1024,
      height: 768,
    }],
  }, {
    maxEdge: 128,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticSubgridSpecifications)),
    [{ regionId: 'grid', rows: 3, rowsOnly: true, source: 'region' }],
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications)),
    [{
      regionId: 'grid',
      kind: 'grid',
      tokens: ['grid-3-rows'],
      rows: 3,
      rowsOnly: true,
      expectedRects: {
        'grid-3-rows': { xNorm: 0.1, yNorm: 0.2, wNorm: 0.8, hNorm: 0.6 },
      },
    }],
  )
  const decoded = decodePng(guide.dataUrl)
  const sample = (x, y) => decoded.pixels[Math.round(y) * decoded.width + Math.round(x)]
  for (const y of [38, 64, 90]) {
    assert.ok(sample(64, y) >= 150, `expected a row center near 64,${y}`)
  }
  for (const x of [30, 98]) {
    for (const y of [38, 64, 90]) {
      assert.ok(sample(x, y) >= 123, `expected horizontal row occupancy near ${x},${y}`)
    }
  }
})

test('semantic grid parser does not treat generic N-column content as a grid', () => {
  assert.equal(helper.semanticGridFromText('3列商品卡片与文章内容排版'), null)
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 720, height: 1280 },
    blocks: [{
      id: 'content',
      role: 'content',
      purpose: '3列商品卡片与文章内容排版',
      x: 40,
      y: 160,
      width: 640,
      height: 960,
    }],
  }, {
    maxEdge: 128,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.deepEqual(JSON.parse(JSON.stringify(guide.semanticSubgridSpecifications)), [])
  assert.equal(JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications))[0].kind, 'generic')
})

test('semantic scaffold keeps complete 3x3 grid specifications unchanged', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helper.semanticGridFromText('严格3×3老虎机转轴'))), {
    columns: 3,
    rows: 3,
  })
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 1280, height: 1280 },
    blocks: [{
      id: 'reels',
      role: 'content',
      purpose: '严格3×3老虎机转轴',
      x: 128,
      y: 256,
      width: 1024,
      height: 768,
    }],
  }, {
    maxEdge: 128,
    visualEncoding: 'soft-ui-semantic-scaffold-v2',
    semanticSubgrid: true,
  })

  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticSubgridSpecifications)),
    [{ regionId: 'reels', columns: 3, rows: 3, source: 'region' }],
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticScaffoldSpecifications)),
    [{
      regionId: 'reels',
      kind: 'grid',
      tokens: ['grid-3x3'],
      columns: 3,
      rows: 3,
      expectedRects: {
        'grid-3x3': { xNorm: 0.1, yNorm: 0.2, wNorm: 0.8, hNorm: 0.6 },
      },
    }],
  )

  const decoded = decodePng(guide.dataUrl)
  const sample = (x, y) => decoded.pixels[Math.round(y) * decoded.width + Math.round(x)]
  const centers = [
    [30, 38], [64, 38], [98, 38],
    [30, 64], [64, 64], [98, 64],
    [30, 90], [64, 90], [98, 90],
  ]
  centers.forEach(([x, y]) => {
    assert.ok(sample(x, y) >= 114, `expected a compact semantic center near ${x},${y}`)
  })
  assert.ok(sample(47, 64) < 60, 'horizontal cell midpoint should not form a connected plate')
  assert.ok(sample(64, 51) < 60, 'vertical cell midpoint should not form a connected plate')

  const regionLeft = Math.floor(decoded.width * 0.1)
  const regionTop = Math.floor(decoded.height * 0.2)
  const regionRight = Math.ceil(decoded.width * 0.9)
  const regionBottom = Math.ceil(decoded.height * 0.8)
  let brightPixels = 0
  let regionPixels = 0
  for (let y = regionTop; y < regionBottom; y += 1) {
    for (let x = regionLeft; x < regionRight; x += 1) {
      regionPixels += 1
      if (sample(x, y) >= 60) brightPixels += 1
    }
  }
  const brightRatio = brightPixels / regionPixels
  assert.ok(brightRatio > 0.02, `semantic centers are too small to preserve the grid footprint: ${brightRatio}`)
  assert.ok(brightRatio < 0.08, `semantic centers occupy too much of the grid region: ${brightRatio}`)
})

test('semantic subgrid maps a 3x3 requirement from the generator prompt onto the main content region', () => {
  const guide = helper.createCleanLayoutGuide({
    canvas: { width: 1080, height: 1920 },
    blocks: [
      { id: 'header', name: '顶部UI区域', role: 'header', x: 0, y: 0, width: 1080, height: 180 },
      { id: 'hero', name: '角色展示区域', role: 'hero', x: 0, y: 180, width: 1080, height: 620 },
      { id: 'content', name: '主内容区域', role: 'content', x: 70, y: 800, width: 940, height: 820 },
      { id: 'footer', name: '底部UI区域', role: 'footer', x: 0, y: 1620, width: 1080, height: 300 },
    ],
  }, {
    maxEdge: 192,
    visualEncoding: 'soft-occupancy-heatmap-v1',
    semanticSubgrid: true,
    semanticText: '中间主内容区域为3×3老虎机转轴，底部保留余额、投注、WIN金额与Spin按钮。',
  })

  assert.deepEqual(
    JSON.parse(JSON.stringify(guide.semanticSubgridSpecifications)),
    [{ regionId: 'content', columns: 3, rows: 3, source: 'semantic-text' }],
  )
  const decoded = decodePng(guide.dataUrl)
  assert.equal(decoded.colorType, 0)
  assert.ok(
    maximumAdjacentGradient(decoded.pixels, decoded.width, decoded.height) <= 16,
    'prompt-derived semantic subgrid contains a hard rectangular edge',
  )
})

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const modulePath = path.resolve(__dirname, '../../particle-editor/ui-design-local-director.workflow.js')

function freshRequire() {
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const workflow = globalThis.NovaFlowUiDesignLocalDirectorWorkflow
  workflow.clearCache()
  return workflow
}

function options(overrides = {}) {
  return {
    intent: 'redesign',
    prompt: '重新设计哪吒主题老虎机',
    negativePrompt: '不要照抄参考图',
    structure: {
      width: 1080,
      height: 1920,
      regions: [{ role: 'hero', purpose: '哪吒主视觉' }],
    },
    references: [{
      id: 'ref-1',
      name: 'reference.png',
      role: 'style',
      dataUrl: 'data:image/png;base64,REFERENCE',
    }],
    ...overrides,
  }
}

test('redesign uses the Local UI assistant as a semantic director', async () => {
  const director = freshRequire()
  const calls = []
  const result = await director.run(options({
    assistant: {
      async run(value) {
        calls.push(value)
        return {
          prompt: JSON.stringify({
            styleProfile: {
              palette: ['#A6232A', '#121212', '#D9A441'],
              material: ['jade-like', 'gilded-metal'],
              finish: ['commercial-game-ui', 'premium'],
            },
          }),
          negativePrompt: '',
        }
      },
    },
  }))

  assert.equal(result.used, true)
  assert.equal(director.VERSION, '20260724-ui-design-local-director-7')
  assert.equal(result.status, 'directed')
  assert.equal(result.prompt, '重新设计哪吒主题老虎机')
  assert.match(result.visualStylePrompt, /#A6232A、#121212、#D9A441/)
  assert.match(result.visualStylePrompt, /玉石质感、鎏金金属/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].provider, 'local')
  assert.equal(calls[0].engine, 'local')
  assert.equal(calls[0].action, 'combine')
  assert.equal(calls[0].purpose, 'ui-design-style-profile')
  assert.equal(calls[0].references.length, 1)
  assert.match(calls[0].requirements, /安全枚举和十六进制色值/)
  assert.match(calls[0].requirements, /contentIdentityLock只能使用用户目标/)
})

test('style profile references exclude layout and content owners before the assistant call', async () => {
  const director = freshRequire()
  const references = [
    { id: 'layout', role: 'layout', dataUrl: 'data:image/png;base64,LAYOUT' },
    { id: 'character', role: 'character', dataUrl: 'data:image/png;base64,CHARACTER' },
    { id: 'content', role: 'content', dataUrl: 'data:image/png;base64,CONTENT' },
    { id: 'style', role: 'style', dataUrl: 'data:image/png;base64,STYLE' },
    { id: 'material', role: 'material', dataUrl: 'data:image/png;base64,MATERIAL' },
    { id: 'color', role: 'color', dataUrl: 'data:image/png;base64,COLOR' },
    { id: 'general', role: 'reference', dataUrl: 'data:image/png;base64,GENERAL' },
  ]
  assert.deepEqual(
    director.styleProfileReferences(references).map((reference) => reference.id),
    ['style', 'material', 'color', 'general'],
  )

  const calls = []
  const result = await director.run(options({
    references,
    assistant: {
      async run(value) {
        calls.push(value)
        return {
          prompt: JSON.stringify({
            styleProfile: {
              palette: ['#13263D', '#D2A44C'],
              material: ['gilded-metal'],
              finish: ['commercial-game-ui'],
            },
          }),
        }
      },
    },
  }))

  assert.equal(result.used, true)
  assert.equal(calls.length, 1)
  assert.deepEqual(
    calls[0].references.map((reference) => reference.id),
    ['style', 'material', 'color', 'general'],
    'layout, character and content references have dedicated owners and must not enter style profiling',
  )
})

test('director safely skips style profiling when references have only dedicated non-style roles', async () => {
  const director = freshRequire()
  let calls = 0
  const result = await director.run(options({
    references: [
      { id: 'layout', role: 'layout', dataUrl: 'data:image/png;base64,LAYOUT' },
      { id: 'character', role: 'character', dataUrl: 'data:image/png;base64,CHARACTER' },
      { id: 'content', role: 'content', dataUrl: 'data:image/png;base64,CONTENT' },
    ],
    assistant: {
      async run() {
        calls += 1
        throw new Error('assistant must not run')
      },
    },
  }))

  assert.equal(calls, 0)
  assert.equal(result.used, false)
  assert.equal(result.status, 'skipped-no-reference')
  assert.equal(result.prompt, '重新设计哪吒主题老虎机')
  assert.match(result.contentLockPrompt, /哪吒主题/)
})

test('theme-neutral style output does not need to repeat user semantic anchors', async () => {
  const director = freshRequire()
  const result = await director.run(options({
    prompt: '中国风哪吒主题，严格3×3转轴，包含WILD与SCATTER',
    assistant: {
      async run() {
        return {
          prompt: JSON.stringify({
            styleProfile: {
              palette: ['#0D2D3A', '#C99438'],
              contrast: ['layered-values', 'focal-emphasis'],
              finish: ['commercial-game-ui'],
            },
          }),
        }
      },
    },
  }))
  assert.equal(result.used, true)
  assert.equal(result.status, 'directed')
  assert.equal(result.prompt, '中国风哪吒主题，严格3×3转轴，包含WILD与SCATTER')
  assert.doesNotMatch(result.visualStylePrompt, /哪吒|转轴|WILD|SCATTER/)
  assert.match(result.contentLockPrompt, /中国风哪吒主题/)
  assert.match(result.contentLockPrompt, /3×3转轴/)
  assert.match(result.contentLockPrompt, /WILD/)
  assert.match(result.contentLockPrompt, /SCATTER/)
})

test('content identity lock accepts only user-prompt phrases and rejects reference leakage', async () => {
  const director = freshRequire()
  const prompt = '中国风哪吒主题，角色为哪吒，主内容包含3×3老虎机转轴、乾坤圈、混天绫、Wild与Scatter，底部保留WIN与Spin按钮'
  const result = await director.run(options({
    prompt,
    assistant: {
      async run() {
        return {
          prompt: JSON.stringify({
            styleProfile: {
              palette: ['#102333', '#C99438'],
              finish: ['commercial-game-ui'],
            },
            contentIdentityLock: {
              identityAnchors: ['中国风哪吒主题', '哪吒', '海神波塞冬'],
              requiredElements: ['3×3老虎机转轴', '乾坤圈', '混天绫', '海浪王座'],
              exactTokens: ['Wild', 'Scatter', 'WIN', 'Spin', 'BONUS'],
            },
          }),
        }
      },
    },
  }))

  assert.deepEqual(result.contentIdentityLock.identityAnchors, ['中国风哪吒主题'])
  assert.match(result.contentLockPrompt, /3×3老虎机转轴/)
  assert.match(result.contentLockPrompt, /乾坤圈/)
  assert.match(result.contentLockPrompt, /Wild/)
  assert.match(result.contentLockPrompt, /Spin/)
  assert.doesNotMatch(result.contentLockPrompt, /海神波塞冬|海浪王座|BONUS/)
})

test('content identity lock keeps visible content but rejects viewport delivery and quality descriptors', () => {
  const director = freshRequire()
  const prompt = [
    '东方幻想赤焰神将主题的转轴游戏界面',
    '角色为赤焰神将',
    '主内容包含3×3转轴、火焰枪符号、WILD与SCATTER',
    '底部保留Spin按钮',
    '手机端清晰可读',
    '小屏幕数字界面清晰可读',
    '竖屏1080×1920',
    '输出尺寸1080×1920',
    '整体高对比精致材质',
    '成熟商业完成度',
  ].join('，')
  const lock = director.mergeContentLocks(prompt, {
    contentIdentityLock: {
      identityAnchors: [
        '东方幻想赤焰神将主题',
        '赤焰神将',
        '转轴游戏界面',
        '小屏幕数字界面清晰可读',
      ],
      requiredElements: [
        '3×3转轴',
        '火焰枪符号',
        'WILD',
        'SCATTER',
        'Spin按钮',
        '手机端清晰可读',
        '竖屏1080×1920',
        '输出尺寸1080×1920',
        '整体高对比精致材质',
        '成熟商业完成度',
      ],
      exactTokens: ['WILD', 'SCATTER', 'Spin'],
    },
  })
  const lockPrompt = director.contentLockPromptFromContract(lock)

  assert.match(lockPrompt, /东方幻想赤焰神将主题/)
  assert.match(lockPrompt, /赤焰神将/)
  assert.match(lockPrompt, /转轴游戏界面/)
  assert.match(lockPrompt, /3×3转轴/)
  assert.match(lockPrompt, /火焰枪符号/)
  assert.match(lockPrompt, /WILD/)
  assert.match(lockPrompt, /SCATTER/)
  assert.match(lockPrompt, /Spin按钮/)
  assert.doesNotMatch(lockPrompt, /手机端清晰可读|小屏幕数字界面清晰可读/)
  assert.doesNotMatch(lockPrompt, /竖屏1080×1920|输出尺寸1080×1920/)
  assert.doesNotMatch(lockPrompt, /整体高对比精致材质|成熟商业完成度/)
})

test('720x1280 is delivery metadata and never enters identity or required-content locks', () => {
  const director = freshRequire()
  const prompt = '哪吒主题全屏奖励符号游戏界面，画布720×1280，竖屏输出尺寸720x1280，包含3列符号与Spin按钮'
  const lock = director.mergeContentLocks(prompt, {
    contentIdentityLock: {
      identityAnchors: [
        '哪吒主题全屏奖励符号游戏界面',
        '画布720×1280',
        '720×1280',
      ],
      requiredElements: [
        '竖屏输出尺寸720x1280',
        '720x1280',
        '3列符号',
        'Spin按钮',
      ],
      exactTokens: ['Spin'],
    },
  })
  const lockPrompt = director.contentLockPromptFromContract(lock)

  assert.deepEqual(lock.identityAnchors, ['哪吒主题全屏奖励符号游戏界面'])
  assert.deepEqual(lock.requiredElements, ['3列符号', 'Spin按钮'])
  assert.equal(
    [...lock.identityAnchors, ...lock.requiredElements].some((item) => /720\s*[x×]\s*1280/i.test(item)),
    false,
  )
  assert.doesNotMatch(lockPrompt, /720\s*[x×]\s*1280/i)
  assert.match(lockPrompt, /哪吒主题全屏奖励符号游戏界面/)
  assert.match(lockPrompt, /3列符号/)
  assert.match(lockPrompt, /Spin按钮/)

  const adjacentPrompt = '竖屏720×1280哪吒主题老虎机游戏界面，包含3列奖励符号与Spin按钮'
  const adjacentLock = director.localContentLockFallback(adjacentPrompt)
  const adjacentLockPrompt = director.contentLockPromptFromContract(adjacentLock)
  const adjacentValues = [
    ...adjacentLock.identityAnchors,
    ...adjacentLock.requiredElements,
  ].join(' ')
  assert.doesNotMatch(adjacentValues, /720\s*[x×]\s*1280/i)
  assert.doesNotMatch(adjacentValues, /1280哪吒主题/)
  assert.doesNotMatch(adjacentLockPrompt, /1280哪吒主题/)
  assert.match(adjacentLockPrompt, /哪吒主题老虎机游戏界面/)
  assert.match(adjacentLockPrompt, /3列奖励符号/)
})

test('content identity lock preserves explicitly requested phone products and physical devices', () => {
  const director = freshRequire()
  const prompt = '商品展示页面，主视觉展示一部手机商品和一台实体游戏设备，保留购买按钮'
  const lock = director.mergeContentLocks(prompt, {
    contentIdentityLock: {
      identityAnchors: ['商品展示页面'],
      requiredElements: ['一部手机商品', '一台实体游戏设备', '购买按钮'],
    },
  })
  const lockPrompt = director.contentLockPromptFromContract(lock)

  assert.match(lockPrompt, /商品展示页面/)
  assert.match(lockPrompt, /一部手机商品/)
  assert.match(lockPrompt, /一台实体游戏设备/)
  assert.match(lockPrompt, /购买按钮/)
})

test('content identity lock rejects themes mentioned only inside a negative reference-copy clause', async () => {
  const director = freshRequire()
  const prompt = '重新设计一个中国风哪吒主题的老虎机界面。参考图只提供风格，不复制参考图的Logo、海洋或老虎主题。'
  const result = await director.run(options({
    prompt,
    references: [],
    assistant: {
      async run() {
        return {
          prompt: JSON.stringify({
            prompt,
            contentIdentityLock: {
              identityAnchors: ['中国风哪吒主题', '老虎主题'],
              requiredElements: ['老虎机界面'],
              exactTokens: [],
            },
          }),
        }
      },
    },
  }))

  assert.match(result.contentLockPrompt, /中国风哪吒主题/)
  assert.doesNotMatch(result.contentLockPrompt, /老虎主题/)
})

test('theme swap rebuilds the local fallback lock without retaining prior theme tokens', () => {
  const director = freshRequire()
  const first = director.localContentLockFallback('中国风哪吒主题，包含3×3转轴与Spin按钮')
  const second = director.localContentLockFallback('星际货运主题，包含4×4货舱网格与LAUNCH按钮')

  assert.match(director.contentLockPromptFromContract(first), /哪吒|3×3|Spin/)
  assert.match(director.contentLockPromptFromContract(second), /星际货运|4×4|LAUNCH/)
  assert.doesNotMatch(director.contentLockPromptFromContract(second), /哪吒|3×3|Spin/)
  assert.notEqual(first.sourceFingerprint, second.sourceFingerprint)
})

test('content identity lock collapses repeated semantics without increasing visible instances', () => {
  const director = freshRequire()
  const prompt = '东方幻想赤焰神将主题，角色为赤焰神将，主内容包含3×3符号矩阵、WILD与SCATTER，底部保留Spin按钮'
  const lock = director.mergeContentLocks(prompt, {
    contentIdentityLock: {
      identityAnchors: ['东方幻想赤焰神将主题', '赤焰神将', '赤焰神将'],
      requiredElements: ['3×3符号矩阵', 'WILD', 'SCATTER', 'Spin按钮', 'WILD'],
      exactTokens: ['WILD', 'wild', 'SCATTER', 'Spin'],
    },
  })
  const lockPrompt = director.contentLockPromptFromContract(lock)
  const occurrences = (token) => lockPrompt.toLowerCase().split(token.toLowerCase()).length - 1

  assert.deepEqual(lock.identityAnchors, ['东方幻想赤焰神将主题'])
  assert.deepEqual(lock.requiredElements, ['3×3符号矩阵', 'WILD', 'SCATTER', 'Spin按钮'])
  assert.deepEqual(lock.exactTokens, ['WILD', 'SCATTER', 'Spin'])
  assert.equal(occurrences('赤焰神将'), 1)
  assert.equal(occurrences('WILD'), 1)
  assert.equal(occurrences('SCATTER'), 1)
  assert.equal(occurrences('Spin'), 1)
  assert.match(lockPrompt, /one semantic requirement, never permission to create another copy/)
})

test('reference content contract derives arbitrary groups, geometry and counts without fixed page roles', () => {
  const director = freshRequire()
  const structure = {
    canvas: { width: 1000, height: 2000 },
    regions: [
      {
        id: 'zone-a',
        name: '品牌信息',
        role: 'brand-zone',
        purpose: '显示项目名称',
        xNorm: 0,
        yNorm: 0,
        wNorm: 1,
        hNorm: 0.12,
      },
      {
        id: 'zone-b',
        name: '收藏内容',
        role: 'collection-zone',
        purpose: '展示收藏内容',
        requirements: '严格4×3阵列，共12个图标',
        x: 50,
        y: 300,
        width: 900,
        height: 1100,
      },
      {
        id: 'zone-c',
        name: '操作信息',
        role: 'command-zone',
        requirements: '2个主要操作',
        xNorm: 0.1,
        yNorm: 0.82,
        wNorm: 0.8,
        hNorm: 0.12,
      },
    ],
  }
  const contract = director.buildReferenceContentContract(
    '收藏管理主题界面',
    structure,
    director.localContentLockFallback('收藏管理主题界面'),
  )
  const contractPrompt = director.referenceContentPromptFromContract(contract)

  assert.equal(contract.groupCount, 3)
  assert.deepEqual(contract.groups.map((group) => group.role), [
    'brand-zone',
    'collection-zone',
    'command-zone',
  ])
  assert.deepEqual(contract.groups[1].geometry, {
    x: 0.05,
    y: 0.15,
    width: 0.9,
    height: 0.55,
  })
  assert.deepEqual(contract.groups[1].matrix, {
    columns: 4,
    rows: 3,
    total: 12,
  })
  assert.deepEqual(contract.groups[1].explicitCounts, [{ count: 12, unit: '个图标' }])
  assert.deepEqual(contract.groups[2].explicitCounts, [{ count: 2, unit: '个' }])
  assert.match(contractPrompt, /preserve exactly 3 groups/)
  assert.match(contractPrompt, /Group 2: fixed normalized bounds x 5\.0%, y 15\.0%, width 90\.0%, height 55\.0%/)
  assert.match(contractPrompt, /exact matrix 4 columns by 3 rows, total 12 cells/)
  assert.match(contractPrompt, /explicit totals 12 个图标/)
  assert.match(contractPrompt, /do not move, expand or duplicate it into another group/)
  assert.doesNotMatch(contractPrompt, /\bhero\b|\bfooter\b|\bgrid\b/i)
})

test('single-axis reel declarations remain exact without inventing a row count, and symbol-list tokens stay whole', () => {
  const director = freshRequire()
  const prompt = '哪吒主题老虎机界面，主内容区域为3列老虎机转轴，符号包括火尖枪、乾坤圈、莲花、哪吒头像、wild标志以及字母A、K、Q、J、10，底部显示余额¥1000、投注金额¥1000、WIN¥1000以及自动、极速、充值、菜单、旋转按钮'
  const lock = director.localContentLockFallback(prompt)
  const contract = director.buildReferenceContentContract(prompt, {
    canvas: { width: 720, height: 1280 },
    regions: [{
      name: '主内容区域',
      role: 'reel-content',
      purpose: '3列老虎机转轴',
    }],
  }, lock)
  const contractPrompt = director.referenceContentPromptFromContract(contract)
  const lockValues = [...lock.requiredElements, ...lock.exactTokens].join('|')

  assert.deepEqual(contract.groups[0].matrix, {
    columns: 3,
    rows: 0,
    total: 0,
    columnsOnly: true,
  })
  assert.match(contractPrompt, /exact 3 columns; row count remains reference-defined/)
  for (const token of ['WILD', 'A', 'K', 'Q', 'J', '10']) {
    assert.match(lock.exactTokens.join('|'), new RegExp(`(?:^|\\|)${token}(?:$|\\|)`, 'i'))
  }
  assert.doesNotMatch(lockValues, /wild标志以|WIN¥1000以|投注金额¥1000以/)
})

test('director result exposes the reference-derived grouping contract for any structure', async () => {
  const director = freshRequire()
  const result = await director.run(options({
    prompt: '星际货运主题，显示5×2货舱阵列',
    structure: {
      width: 1200,
      height: 800,
      regions: [
        {
          id: 'cargo-cluster',
          role: 'cargo-cluster',
          purpose: '5×2货舱阵列',
          x: 120,
          y: 80,
          width: 960,
          height: 560,
        },
      ],
    },
    assistant: {
      async run() {
        return {
          prompt: JSON.stringify({
            styleProfile: {
              palette: ['#172A46', '#D49A3A'],
              finish: ['commercial-game-ui'],
            },
          }),
        }
      },
    },
  }))

  assert.equal(result.referenceContentContract.groupCount, 1)
  assert.deepEqual(result.referenceContentContract.groups[0].matrix, {
    columns: 5,
    rows: 2,
    total: 10,
  })
  assert.match(result.referenceContentPrompt, /preserve exactly 1 group/)
  assert.match(result.referenceContentPrompt, /exact matrix 5 columns by 2 rows, total 10 cells/)
})

test('director exposes a theme-neutral structured style profile for synthesis', async () => {
  const director = freshRequire()
  const result = await director.run(options({
    prompt: '星际货运主题，严格4×4货舱网格，包含LOAD与LAUNCH',
    assistant: {
      async run() {
        return {
          prompt: '星际货运主题，严格4×4货舱网格，包含LOAD与LAUNCH。',
          styleProfile: {
            palette: ['#172A46', '#E8E0D1', '#D49A3A'],
            contrast: ['layered-values', 'focal-emphasis'],
            material: ['matte', 'polished-metal', 'translucent', 'woven-fabric'],
            lighting: ['soft-diffuse', 'rim-accent'],
            shapeLanguage: ['rounded', 'angular', 'layered'],
            ornamentDensity: ['restrained', 'focal-only'],
            typographyMood: ['compact', 'technical', 'high-legibility'],
            finish: ['commercial-game-ui', 'high-detail', 'clean'],
            subject: '不应进入风格档案的货船和人物',
          },
        }
      },
    },
  }))

  assert.equal(result.used, true)
  assert.deepEqual(result.styleProfile, {
    palette: '#172A46、#E8E0D1、#D49A3A',
    contrast: '分层明暗对比、焦点高对比',
    material: '哑光表面、抛光金属、半透明材质、织物',
    lighting: '柔和漫射光、克制轮廓光',
    shapeLanguage: '圆润轮廓、锐角轮廓、分层块面',
    ornamentDensity: '克制装饰、仅焦点装饰',
    typographyMood: '紧凑排版、技术感字形气质、高可读性',
    finish: '商业游戏界面完成度、高细节完成度、干净利落的完成度',
  })
  assert.match(result.visualStylePrompt, /配色：#172A46、#E8E0D1、#D49A3A/)
  assert.match(result.visualStylePrompt, /形状语言：圆润轮廓、锐角轮廓、分层块面/)
  assert.match(result.visualStylePrompt, /渲染完成度：商业游戏界面完成度、高细节完成度/)
  assert.doesNotMatch(result.visualStylePrompt, /货船|人物/)
})

test('legacy labeled director text compiles into the same style profile without theme blacklists', () => {
  const director = freshRequire()
  const source = [
    '森林烹饪主题和菜谱功能保持不变。',
    '配色采用鼠尾草绿、奶油白和陶土橙。',
    '对比关系：柔和背景与高对比主操作形成两级层次。',
    '材质体系：陶瓷、木纹和亚麻织物。',
    '光影：漫射晨光与轻微接触阴影。',
    '形状语言：圆润块面和手工切边。',
    '装饰密度：中低密度，只保留少量叶片纹样。',
    '字体气质：温暖、亲和、略带手写感。',
    '渲染完成度：精致商业休闲游戏UI。',
  ].join('')
  const profile = director.extractStyleProfile(source)

  assert.equal(profile.palette, '鼠尾草绿、奶油白和陶土橙')
  assert.equal(profile.material, '陶瓷、木纹和亚麻织物')
  assert.equal(profile.shapeLanguage, '圆润块面和手工切边')
  assert.equal(profile.typographyMood, '温暖、亲和、略带手写感')
  assert.equal(profile.finish, '精致商业休闲游戏UI')
  assert.doesNotMatch(director.visualStylePromptFromProfile(profile), /森林烹饪|菜谱功能/)
})

test('iteration skips the director and preserves the explicit edit prompt', async () => {
  const director = freshRequire()
  let calls = 0
  const result = await director.run(options({
    intent: 'iteration',
    assistant: { async run() { calls += 1 } },
  }))
  assert.equal(calls, 0)
  assert.equal(result.status, 'skipped-iteration')
  assert.equal(result.prompt, '重新设计哪吒主题老虎机')
})

test('director failure is a best-effort fallback instead of a generation failure', async () => {
  const director = freshRequire()
  const result = await director.run(options({
    assistant: { async run() { throw new Error('VLM busy') } },
  }))
  assert.equal(result.used, false)
  assert.equal(result.status, 'fallback')
  assert.equal(result.prompt, '重新设计哪吒主题老虎机')
  assert.match(result.error, /VLM busy/)
  assert.match(result.contentLockPrompt, /哪吒主题/)
})

test('identical semantic requests reuse the bounded director cache', async () => {
  const director = freshRequire()
  let calls = 0
  const assistant = {
    async run() {
      calls += 1
      return {
        prompt: JSON.stringify({
          styleProfile: {
            palette: ['#5B7077', '#D6D1C7'],
            finish: ['commercial-game-ui'],
          },
        }),
      }
    },
  }
  const first = await director.run(options({ assistant }))
  const second = await director.run(options({ assistant }))
  assert.equal(calls, 1)
  assert.equal(first.cached, false)
  assert.equal(second.cached, true)
  assert.equal(second.prompt, first.prompt)
})

test('director cache separates target style, requirements, and output size', () => {
  const director = freshRequire()
  const base = options()
  const baseline = director.cacheKey(base)
  assert.notEqual(director.cacheKey({ ...base, targetStyle: 'eastern-fantasy' }), baseline)
  assert.notEqual(director.cacheKey({ ...base, requirements: '只允许3×3转轴' }), baseline)
  assert.notEqual(director.cacheKey({ ...base, size: { width: 1920, height: 1080 } }), baseline)
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const workflowPath = path.resolve(__dirname, '../../particle-editor/ui-design-assistant.workflow.js')
const dialogPath = path.resolve(__dirname, '../../particle-editor/ui-design-assistant.dialog.js')
const imageHelperPath = path.resolve(__dirname, '../../particle-editor/ui-design-assistant-image.helper.js')
const indexPath = path.resolve(__dirname, '../../particle-editor/index.html')
const runtimePath = path.resolve(__dirname, '../../particle-editor/novaflow-brand-runtime.js')

function freshWorkflow(overrides = {}) {
  const context = {
    module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout, ...overrides,
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(workflowPath, 'utf8'), context, { filename: workflowPath })
  return context.module.exports
}

const tinyImage = 'data:image/png;base64,iVBORw0KGgo='

test('UI target styles are visual presets, enter the prompt, and remain subordinate to structure', () => {
  const workflow = freshWorkflow()
  assert.deepEqual(Array.from(workflow.UI_STYLE_PRESETS, (item) => item.label), [
    '智能匹配', '跟随参考图', '东方幻想', '二次元精致', '科幻未来', '暗黑史诗', '卡通休闲', '现代极简',
  ])
  assert.equal(workflow.normalizeTargetStyle('dark_epic'), 'dark-epic')
  assert.equal(workflow.normalizeTargetStyle('unknown'), 'auto')

  const requirements = workflow.buildRequirements({
    targetStyle: 'sci-fi-future',
    requirements: '用户要求：右侧必须保留任务按钮',
  }, workflow.structureSnapshot({
    name: '战斗页',
    description: '保持原有功能层级',
    blocks: [{ name: '技能区', role: 'action', requirements: '固定在右下角' }],
  }), [])
  assert.match(requirements, /目标风格（低优先级视觉约束）：科幻未来/)
  assert.match(requirements, /冷色发光边缘、半透明层板/)
  assert.match(requirements, /用户补充要求：用户要求：右侧必须保留任务按钮/)
  assert.match(requirements, /技能区.*固定在右下角/)
  assert.match(requirements, /用户补充要求、页面目标、页面结构和区块生成要求高于目标风格与参考图/)
  assert.match(requirements, /目标风格只控制配色、材质、字体气质、图形语言、光影和装饰，不得改变布局结构、增加功能或删除控件/)
  assert.match(requirements, /页面场景（自动识别，仅用于视觉语境）：战斗 HUD/)
  assert.equal(workflow.inferPageScene({ name: '登录选服页', blocks: [{ name: '服务器列表' }] }), '登录 / 选服')
  assert.equal(workflow.inferPageScene({ name: '玩家大厅', blocks: [{ name: '主菜单' }] }), '主界面 / 大厅')
  assert.equal(workflow.inferPageScene({ name: '实时战斗', blocks: [{ name: '技能区' }, { name: '小地图' }] }), '战斗 HUD')
  assert.equal(workflow.inferPageScene({ name: '装备管理', blocks: [{ name: '物品栏' }] }), '角色 / 背包')
  assert.equal(workflow.inferPageScene({ name: '商城首页', blocks: [{ name: '充值礼包' }] }), '商城 / 活动')
  assert.equal(workflow.inferPageScene({ name: '战斗结算', blocks: [{ name: '胜利界面' }] }), '弹窗 / 结算')
  assert.equal(workflow.inferPageScene({ name: '战斗结算', blocks: [] }), '弹窗 / 结算')
  assert.equal(workflow.inferPageScene({ name: '战斗结果', blocks: [] }), '弹窗 / 结算')
  assert.equal(workflow.inferPageScene({ name: '角色展示', blocks: [{ name: '主视觉', purpose: '展示核心角色' }] }), '通用页面')
  assert.equal(workflow.inferPageScene({ name: '新页面', blocks: [{ name: '顶部区域' }] }), '通用页面')

  const dialogSource = fs.readFileSync(dialogPath, 'utf8')
  assert.match(dialogSource, /record\.targetStyle === preset\.value && preset\.value !== 'auto' \? 'auto' : preset\.value/)
  assert.match(dialogSource, /目标风格（单选，再次点击恢复智能匹配）/)
  assert.match(dialogSource, /已识别场景：\$\{record\.scene\}/)
  assert.doesNotMatch(dialogSource, /页面类型（可选/)
})

test('extreme 32-block structures keep every critical assistant contract inside the desktop transport limit', () => {
  const workflow = freshWorkflow()
  const structure = workflow.structureSnapshot({
    name: '超长战斗页面',
    description: '必须维持实时战斗信息层级。'.repeat(40),
    blocks: Array.from({ length: 32 }, (_, index) => ({
      name: `区块${index + 1}`,
      role: index === 0 ? 'hud' : 'region',
      purpose: `用途说明${index + 1}`.repeat(15),
      requirements: `硬性要求${index + 1}`.repeat(15),
    })),
  })
  const requirements = workflow.buildRequirements({
    targetStyle: 'dark-epic',
    requirements: `用户关键要求标记 ${'补充'.repeat(300)}`,
    size: { width: 1920, height: 1080 },
  }, structure, Array.from({ length: 4 }, (_, index) => ({ role: index === 0 ? 'style' : 'reference' })))

  assert.ok(requirements.length <= workflow.REQUIREMENTS_TRANSPORT_LIMIT)
  for (const contract of [
    '用户关键要求标记', '页面场景（自动识别，仅用于视觉语境）：战斗 HUD',
    '目标风格（低优先级视觉约束）：暗黑史诗', '参考职责：', '页面结构摘要：', '输出应描述可直接生成成品 UI',
  ]) {
    const at = requirements.indexOf(contract)
    assert.ok(at >= 0 && at < 2000, `${contract} must survive the desktop requirements transport limit`)
  }
})

test('character references retain the dedicated character analysis role', () => {
  const workflow = freshWorkflow()
  assert.equal(workflow.normalizeReferenceRole('character'), 'character')
  assert.equal(workflow.normalizeReferenceRole('角色'), 'character')
  assert.equal(workflow.referenceSnapshot([{ role: 'character', dataUrl: tinyImage }])[0].role, 'character')
  assert.match(fs.readFileSync(dialogPath, 'utf8'), /\['character', '角色'\]/)
})

test('local UI design assistant carries structure context, preserves mentions, and writes negative requirements', async () => {
  const workflow = freshWorkflow()
  let payload = null
  const result = await workflow.run({
    engine: 'local',
    provider: 'local',
    action: 'preserve',
    targetStyle: 'eastern-fantasy',
    prompt: '保持 @参考图1 的配色',
    negativePrompt: '',
    requirements: '按钮需要明显悬停状态',
    structure: {
      width: 1920,
      height: 1080,
      blocks: [{ name: '主视觉', role: 'hero', purpose: '展示核心角色' }],
    },
    references: [{ id: 'ref-1', label: '风格图', role: 'style', dataUrl: tinyImage }],
    electronAPI: {
      async promptAssistantReverseImagePrompt(input) {
        payload = input
        return {
          ok: true,
          data: {
            prompt: `${input.currentPrompt}，形成清晰的游戏 UI 层级`,
            negativePrompt: '布局混乱, 元素重叠',
          },
        }
      },
    },
  })
  assert.equal(payload.surface, 'ui-design')
  assert.equal(payload.provider, 'local')
  assert.equal(payload.images[0].role, 'style')
  assert.match(payload.requirements, /1920 × 1080/)
  assert.match(payload.requirements, /主视觉/)
  assert.match(payload.requirements, /目标风格（低优先级视觉约束）：东方幻想/)
  assert.match(payload.requirements, /__NOVAFLOW_/)
  assert.match(result.prompt, /^视觉风格约束（不改变页面结构）：东方幻想。/)
  assert.match(result.prompt, /玉石、鎏金/)
  assert.match(result.prompt, /保持 @参考图1 的配色，形成清晰的游戏 UI 层级$/)
  assert.equal(result.negativePrompt, '布局混乱, 元素重叠')
  assert.equal(result.hasNegativePrompt, true)
  assert.equal(result.targetStyle, 'eastern-fantasy')
  assert.equal(result.scene, '通用页面')
})

test('the Local director can request the dedicated theme-neutral style-profile purpose', async () => {
  const workflow = freshWorkflow()
  let payload = null
  const result = await workflow.run({
    engine: 'local',
    provider: 'local',
    action: 'combine',
    purpose: 'ui-design-style-profile',
    prompt: '任意主题的完整 UI 需求',
    requirements: '只提取配色、材质、光影和完成度',
    structure: { width: 1080, height: 1920, blocks: [{ name: 'Main', role: 'content' }] },
    references: [{ id: 'style', role: 'style', dataUrl: tinyImage }],
    electronAPI: {
      async promptAssistantReverseImagePrompt(input) {
        payload = input
        return {
          ok: true,
          data: {
            prompt: '{"palette":"低饱和青灰","material":"细磨砂金属","finish":"成熟商业UI"}',
            negativePrompt: '',
          },
        }
      },
    },
  })

  assert.equal(payload.purpose, 'ui-design-style-profile')
  assert.equal(payload.surface, 'ui-design')
  assert.match(result.prompt, /"palette":"低饱和青灰"/)
})

test('assistant timeout budget matches each engine contract', () => {
  const workflow = freshWorkflow()
  assert.equal(workflow.DEFAULT_TIMEOUT_MS, 120000)
  assert.equal(workflow.LOCAL_TIMEOUT_MS, 300000)
  assert.equal(workflow.timeoutForEngine('grok'), 120000)
  assert.equal(workflow.timeoutForEngine('local'), 300000)
  assert.equal(workflow.timeoutForEngine('local', 45000), 45000)
})

test('follow-reference style requires a selected style-role reference before calling the model', async () => {
  const workflow = freshWorkflow()
  let calls = 0
  await assert.rejects(workflow.run({
    engine: 'local',
    provider: 'local',
    targetStyle: 'reference',
    references: [{ id: 'layout', role: 'layout', dataUrl: tinyImage }],
    electronAPI: {
      async promptAssistantReverseImagePrompt() {
        calls += 1
        return { ok: true, data: { prompt: 'unexpected' } }
      },
    },
  }), /需要至少选择一张职责为“风格”的参考图/)
  assert.equal(calls, 0)

  const result = await workflow.run({
    engine: 'local',
    provider: 'local',
    targetStyle: 'reference',
    references: [{ id: 'style', role: 'style', dataUrl: tinyImage }],
    electronAPI: {
      async promptAssistantReverseImagePrompt(input) {
        assert.match(input.requirements, /目标风格（低优先级视觉约束）：跟随参考图/)
        return { ok: true, data: { prompt: '跟随风格参考的 UI' } }
      },
    },
  })
  assert.equal(result.targetStyle, 'reference')
  assert.match(result.prompt, /^视觉风格约束（不改变页面结构）：跟随参考图。/)
  assert.match(result.prompt, /跟随风格参考的 UI$/)
})

test('automatic target style leaves the model result untouched', () => {
  const workflow = freshWorkflow()
  assert.equal(workflow.applyTargetStyleContract('模型返回的设计要求', 'auto'), '模型返回的设计要求')
  assert.match(workflow.applyTargetStyleContract('模型返回的设计要求', 'dark-epic'), /^视觉风格约束（不改变页面结构）：暗黑史诗。/)
})

test('target style contracts stay singular across reruns, style switches, and automatic reset', () => {
  const workflow = freshWorkflow()
  const base = '保持既有页面结构与主按钮层级。'
  const eastern = workflow.applyTargetStyleContract(base, 'eastern-fantasy')
  const repeated = workflow.applyTargetStyleContract(eastern, 'eastern-fantasy')
  const switched = workflow.applyTargetStyleContract(repeated, 'dark-epic')
  const automatic = workflow.applyTargetStyleContract(switched, 'auto')

  assert.equal((repeated.match(/视觉风格约束（不改变页面结构）/g) || []).length, 1)
  assert.match(switched, /^视觉风格约束（不改变页面结构）：暗黑史诗。/)
  assert.doesNotMatch(switched, /视觉风格约束（不改变页面结构）：东方幻想。/)
  assert.equal(automatic, base)
  assert.equal(workflow.stripTargetStyleContract(`视觉风格约束（不改变页面结构）只是用户的普通描述。\n${base}`), `视觉风格约束（不改变页面结构）只是用户的普通描述。\n${base}`)
})

test('rerunning the assistant never sends a previously injected style contract back to the model', async () => {
  const workflow = freshWorkflow()
  const base = '保持既有页面结构与主按钮层级。'
  const previous = workflow.applyTargetStyleContract(base, 'eastern-fantasy')
  let payload = null
  const result = await workflow.run({
    engine: 'local',
    provider: 'local',
    targetStyle: 'dark-epic',
    prompt: previous,
    electronAPI: {
      async promptAssistantOptimizePrompt(input) {
        payload = input
        return { ok: true, data: { prompt: input.currentPrompt } }
      },
    },
  })

  assert.equal(payload.currentPrompt, base)
  assert.match(result.prompt, /^视觉风格约束（不改变页面结构）：暗黑史诗。/)
  assert.doesNotMatch(result.prompt, /视觉风格约束（不改变页面结构）：东方幻想。/)
})

test('GPT and Google generation providers never receive or apply a negative prompt', async () => {
  const workflow = freshWorkflow()
  for (const provider of ['gpt', 'google']) {
    let payload = null
    const result = await workflow.run({
      engine: 'local',
      provider,
      prompt: '现代游戏 UI',
      negativePrompt: '不得送入云模型',
      structure: { width: 1080, height: 1920, blocks: [] },
      electronAPI: {
        async promptAssistantOptimizePrompt(input) {
          payload = input
          return { ok: true, data: { positivePrompt: '竖屏现代游戏 UI', negativePrompt: '模型额外返回的负面词' } }
        },
      },
    })
    assert.equal(payload.negativePrompt, '')
    assert.equal(result.negativePrompt, '')
    assert.equal(result.hasNegativePrompt, false)
  }
})

test('local assistant rejects a fourth analysis reference without truncating or calling the model', async () => {
  const workflow = freshWorkflow()
  let calls = 0
  await assert.rejects(workflow.run({
    engine: 'local',
    provider: 'local',
    prompt: '组合参考',
    references: Array.from({ length: 4 }, (_, index) => ({
      id: `ref-${index}`,
      dataUrl: tinyImage,
    })),
    electronAPI: {
      async promptAssistantReverseImagePrompt() { calls += 1; return { ok: true, data: { prompt: 'unexpected' } } },
    },
  }), /本地设计助手一次最多分析 3 张/)
  assert.equal(calls, 0)
})

test('Grok assistant accepts four references, rejects a fifth, and normalizes only its own payload', async () => {
  let normalizeCalls = 0
  const workflow = freshWorkflow({
    NovaFlowUiDesignAssistantImageHelper: {
      async normalizeReferencesForGrok(references) {
        normalizeCalls += 1
        return references.map((reference) => ({ ...reference, dataUrl: reference.dataUrl, imageUrl: reference.dataUrl }))
      },
    },
  })
  let payload = null
  const references = Array.from({ length: 4 }, (_, index) => ({
    id: `ref-${index + 1}`,
    role: index === 0 ? 'layout' : 'style',
    dataUrl: tinyImage,
  }))
  const result = await workflow.run({
    engine: 'grok',
    provider: 'google',
    prompt: '组合四张参考图',
    sessionToken: 'token',
    references,
    electronAPI: {
      async smartAiImageReverse(input) {
        payload = input
        return { ok: true, data: { prompt: '四图分析后的 UI 设计要求' } }
      },
    },
  })
  assert.equal(workflow.analysisReferenceLimit('grok'), 4)
  assert.equal(workflow.analysisReferenceLimit('local'), 3)
  assert.equal(normalizeCalls, 1)
  assert.equal(payload.images.length, 4)
  assert.equal(payload.sourceCount, 4)
  assert.equal(Object.hasOwn(payload.images[0], 'dataUrl'), false, 'Grok payload must not duplicate base64 data in two fields')
  assert.equal(result.referenceCount, 4)

  await workflow.run({
    engine: 'local',
    provider: 'local',
    prompt: '本地单图分析',
    references: [references[0]],
    electronAPI: {
      async promptAssistantReverseImagePrompt() {
        return { ok: true, data: { prompt: '本地单图 UI 要求', negativePrompt: '布局混乱' } }
      },
    },
  })
  assert.equal(normalizeCalls, 1, 'Grok image normalization must not run for the local assistant')

  await assert.rejects(workflow.run({
    engine: 'grok',
    provider: 'google',
    prompt: '超出上限',
    sessionToken: 'token',
    references: [...references, { id: 'ref-5', dataUrl: tinyImage }],
    electronAPI: { async smartAiImageReverse() { throw new Error('must not run') } },
  }), /Grok 设计助手一次最多分析 4 张/)
  assert.equal(normalizeCalls, 1)
})

test('dialog exposes every connected reference, blocks invalid local selection, and centers its CTA', async () => {
  const dialogSource = fs.readFileSync(dialogPath, 'utf8')
  assert.match(dialogSource, /未勾选的连接图仍会参与最终 UI 生成，只是不用于本次设计助手分析/)
  assert.match(dialogSource, /record\.referenceLimitError = selectedCount > limit/)
  assert.match(dialogSource, /record\.submit\.disabled = Boolean\(record\.pending \|\| record\.referenceLimitError\)/)
  assert.match(dialogSource, /record\.engine = value[\s\S]*?updateReferenceRows\(record\)/)
  assert.match(dialogSource, /display: 'flex', justifyContent: 'center'/)
  assert.match(dialogSource, /value === 'reference' && !canFollowReference/)
  assert.match(dialogSource, /请先将至少一张已勾选参考图的职责设为“风格”/)
  assert.match(dialogSource, /“跟随参考图”已恢复为“智能匹配”/)
  assert.match(dialogSource, /function createActionChoice\(record, value, label\)/)
  assert.match(dialogSource, /'data-action': value, 'aria-pressed': 'false'/)
  assert.doesNotMatch(dialogSource, /name: 'novaflow-ui-design-assistant-action'/)
  assert.match(dialogSource, /accentColor: '#23c489'/)
  assert.match(dialogSource, /\['grok', 'Grok AI', '云端 · 深度处理'\]/)
  assert.match(dialogSource, /\['local', '本地模型', '本地 · 快速处理'\]/)

  const runtimeSource = fs.readFileSync(runtimePath, 'utf8')
  assert.match(
    runtimeSource,
    /function shouldPortalNativeSelect\(select\)[\s\S]*?select\.closest\('\[data-novaflow-ui-design-assistant-dialog="1"\]'\)\) return false/,
  )

  const indexSource = fs.readFileSync(indexPath, 'utf8')
  assert.match(indexSource, /novaflow-brand-runtime\.js\?v=20260813-ideogram-instant-1/)
  assert.match(indexSource, /ui-design-assistant\.workflow\.js\?v=20260724-ui-quality-refine-1/)
  assert.match(indexSource, /ui-design-assistant\.dialog\.js\?v=20260723-ui-design-choice-1/)
  const helperAt = indexSource.indexOf('ui-design-assistant-image.helper.js')
  const workflowAt = indexSource.indexOf('ui-design-assistant.workflow.js')
  const dialogAt = indexSource.indexOf('ui-design-assistant.dialog.js')
  assert.ok(helperAt >= 0 && helperAt < workflowAt && workflowAt < dialogAt)

  let releases = 0
  const helperContext = {
    module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout,
    fetch: async () => ({ blob: async () => ({ size: 128 }) }),
    createImageBitmap: async () => ({ width: 32, height: 32, close() { releases += 1 } }),
  }
  helperContext.globalThis = helperContext
  vm.runInNewContext(fs.readFileSync(imageHelperPath, 'utf8'), helperContext, { filename: imageHelperPath })
  const helper = helperContext.module.exports
  assert.equal(helper.MAX_SIDE, 1536)
  assert.ok(helper.TARGET_BLOB_BYTES <= 1.5 * 1024 * 1024)
  const normalized = await helper.normalizeReferencesForGrok(Array.from({ length: 4 }, (_, index) => ({ id: index, dataUrl: tinyImage })))
  assert.equal(normalized.length, 4)
  assert.equal(releases, 4)
})

test('Grok route requires a session and only applies a non-stale result', async () => {
  const workflow = freshWorkflow()
  await assert.rejects(workflow.run({
    engine: 'grok',
    provider: 'local',
    prompt: 'UI',
    electronAPI: { smartAiPromptOptimize: async () => ({ ok: true, data: { prompt: 'UI' } }) },
  }), /请先登录/)

  let grokPayload = null
  const grokResult = await workflow.run({
    engine: 'grok',
    provider: 'google',
    prompt: '组合两张参考图',
    sessionToken: 'token',
    references: [
      { id: 'one', role: 'layout', dataUrl: tinyImage },
      { id: 'two', role: 'style', dataUrl: tinyImage },
    ],
    electronAPI: {
      async smartAiImageReverse(input) {
        grokPayload = input
        return { ok: true, data: { output_text: '组合后的 UI 要求', negative_prompt: '不应写入' } }
      },
    },
  })
  assert.equal(grokPayload.scenario, 'role_reference')
  assert.equal(grokPayload.sourceCount, 2)
  assert.equal(grokPayload.images.length, 2)
  assert.equal(grokPayload.supportsNegativePrompt, false)
  assert.equal(grokResult.negativePrompt, '')

  let revision = 'before'
  await assert.rejects(workflow.run({
    engine: 'grok',
    provider: 'local',
    prompt: 'UI',
    sessionToken: 'token',
    getRevision: () => revision,
    electronAPI: {
      async smartAiPromptOptimize() {
        revision = 'after'
        return { ok: true, data: { prompt: '更新后的 UI' } }
      },
    },
  }), (error) => error?.name === 'StaleResultError')
})

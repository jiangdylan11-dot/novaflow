const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const helperPath = path.join(root, 'particle-editor', 'ui-design-quality-profile.helper.js')
const workflowPath = path.join(root, 'particle-editor', 'ui-design-assistant.workflow.js')
const dialogPath = path.join(root, 'particle-editor', 'ui-design-assistant.dialog.js')
const indexPath = path.join(root, 'particle-editor', 'index.html')

function loadModule(filePath, overrides = {}) {
  const context = { module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout, ...overrides }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath })
  return { api: context.module.exports, context }
}

test('quality profiles classify the four commercial content families', () => {
  const { api } = loadModule(helperPath)
  assert.equal(api.VERSION, '20260724-ui-design-quality-profile-3')
  assert.deepEqual(Array.from(api.CONTENT_TYPES, (item) => item.value), [
    'auto', 'game-ui', 'slot', 'web', 'marketing',
  ])
  assert.equal(api.inferContentType({ name: '东方龙老虎机', regions: [] }), 'slot')
  assert.equal(api.inferContentType({ name: '游戏官网落地页', regions: [] }), 'web')
  assert.equal(api.inferContentType({ name: '周年活动美宣', regions: [] }), 'marketing')
  assert.equal(api.inferContentType({ name: '战斗 HUD', regions: [] }), 'game-ui')
})

test('game UI quality profile never invents character, panel, button, icon, or count templates', () => {
  const { api } = loadModule(helperPath)
  const profile = api.compile({
    contentType: 'game-ui',
    contentPurpose: 'lobby',
    qualityTendency: 'commercial',
    requirements: '仅保留用户声明的2个操作控件',
  }, {
    name: '收藏管理界面',
    regions: [
      { role: 'collection', requirements: '严格4×3阵列，共12个图标' },
      { role: 'actions', requirements: '2个主要操作' },
    ],
  })

  assert.equal(profile.contentType, 'game-ui')
  assert.match(profile.instruction, /页面版块、内容类型、控件和重复项数量只能来自用户要求、页面结构和已声明职责的参考图/)
  assert.match(profile.instruction, /不自动补充角色主视觉、面板、按钮或图标模板/)
  assert.match(profile.instruction, /明确用途：大厅 \/ 主界面。不得据此增加页面结构中未声明的功能/)
  assert.doesNotMatch(profile.instruction, /必须(?:增加|包含|设置|放置).{0,16}(?:角色主视觉|面板|按钮|图标)/)
})

test('slot quality profile is carrier-neutral, viewport-readable, and avoids vendor imitation', () => {
  const { api } = loadModule(helperPath)
  const profile = api.compile({
    contentType: 'slot',
    contentPurpose: 'bonus',
    qualityTendency: 'creative',
  }, { name: '龙主题 Slot', regions: [] })
  assert.equal(profile.contentType, 'slot')
  assert.equal(profile.purpose, 'bonus')
  assert.match(profile.instruction, /成熟精品全屏奖励符号游戏 UI 商业成品/)
  assert.match(profile.instruction, /不复制任何具体厂商/)
  assert.match(profile.instruction, /界面载体必须由用户显式需求决定/)
  assert.match(profile.instruction, /画面边界与界面视口完全重合/)
  assert.match(profile.instruction, /同一正视屏幕平面/)
  assert.match(profile.instruction, /页面版块、控件类型、内容分组、重复项数量和层级关系只能来自/)
  assert.match(profile.instruction, /不得自动套用固定的标题、角色、转轴、底栏或操作控件模板/)
  assert.match(profile.instruction, /目标视口与缩略显示下/)
  assert.doesNotMatch(profile.instruction, /成熟精品移动端 Slot|手机小尺寸辨识度|手机|平板|浏览器窗口|实体机柜|设备边框|状态栏|拍摄场景/)
  assert.match(profile.instruction, /明确用途：Bonus \/ 免费旋转/)
  assert.match(profile.instruction, /更鲜明的主题化构图/)
})

test('assistant workflow injects the quality director contract without changing other surfaces', async () => {
  const helper = loadModule(helperPath).api
  const { api: workflow } = loadModule(workflowPath, { NovaFlowUiDesignQualityProfile: helper })
  let payload = null
  const result = await workflow.run({
    engine: 'local',
    provider: 'local',
    contentType: 'web',
    contentPurpose: 'landing',
    qualityTendency: 'restrained',
    prompt: '科技产品官网',
    structure: { name: '产品落地页', width: 1440, height: 900, blocks: [{ name: '首屏' }] },
    electronAPI: {
      async promptAssistantOptimizePrompt(input) {
        payload = input
        return { ok: true, data: { positivePrompt: '成熟的产品落地页', negativePrompt: '布局混乱' } }
      },
    },
  })
  assert.equal(payload.surface, 'ui-design')
  assert.match(payload.requirements, /成熟头部品牌数字产品成品/)
  assert.match(payload.requirements, /明确用途：品牌落地页/)
  assert.match(payload.requirements, /高级克制/)
  assert.equal(result.contentType, 'web')
  assert.equal(result.contentPurpose, 'landing')
  assert.equal(result.qualityTendency, 'restrained')
})

test('UI dialog exposes type, purpose, and tendency while index loads helper first', () => {
  const dialog = fs.readFileSync(dialogPath, 'utf8')
  const index = fs.readFileSync(indexPath, 'utf8')
  assert.match(dialog, /contentType: record\.contentType/)
  assert.match(dialog, /contentPurpose: record\.contentPurpose/)
  assert.match(dialog, /qualityTendency: record\.qualityTendency/)
  assert.match(dialog, /内容类型 · 用途 · 质量倾向/)
  assert.ok(index.indexOf('ui-design-quality-profile.helper.js') < index.indexOf('ui-design-assistant.workflow.js'))
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const workflowPath = path.join(root, 'particle-editor', 'ui-design-quality-review.workflow.js')
const servicePath = path.join(root, 'particle-editor-desktop', 'prompt-assistant-service.py')
const tinyImage = 'data:image/png;base64,iVBORw0KGgo='

function freshWorkflow(overrides = {}) {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    ...overrides,
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(workflowPath, 'utf8'), context, { filename: workflowPath })
  return context.module.exports
}

function passingReview(overrides = {}) {
  return {
    status: 'PASS',
    hardFailures: [],
    scores: {
      themeAdherence: 91,
      structureAdherence: 88,
      referenceLeakage: 94,
      readability: 86,
      commercialFinish: 82,
    },
    summary: '主题、结构和核心控件均符合要求。',
    retryPrompt: '',
    confidence: 0.91,
    ...overrides,
  }
}

test('quality review workflow sends one candidate and at most two references through existing reverse-image IPC', async () => {
  const workflow = freshWorkflow()
  let payload = null
  const review = await workflow.run({
    candidate: { name: 'candidate.png', dataUrl: tinyImage },
    targetPrompt: '中国风哪吒主题，顶部标题、角色主视觉、3×3转轴和底部操作区。',
    rubric: '矩形结构框不得进入最终成品图。',
    references: [
      { name: 'layout.png', role: 'layout', dataUrl: tinyImage },
      { name: 'style.png', role: 'style', dataUrl: tinyImage },
    ],
    electronAPI: {
      async promptAssistantReverseImagePrompt(input) {
        payload = input
        return { ok: true, data: { qualityReview: passingReview() } }
      },
    },
  })

  assert.equal(payload.purpose, 'ui-design-quality-review')
  assert.equal(payload.surface, 'ui-design')
  assert.equal(payload.provider, 'local')
  assert.equal(payload.currentPrompt, payload.prompt)
  assert.equal(payload.requirements, '矩形结构框不得进入最终成品图。')
  assert.equal(payload.images.length, 3)
  assert.equal(payload.images[0].role, 'candidate')
  assert.equal(payload.images[0].slotType, 'candidate')
  assert.deepEqual(Array.from(payload.images.slice(1), (item) => item.role), ['layout', 'style'])
  assert.equal(review.status, 'PASS')
  assert.equal(review.unavailable, false)
  assert.equal(review.scores.referenceLeakage, 94)
  assert.equal(review.scores.visualHierarchy, review.scores.commercialFinish)
  assert.equal(review.scores.commercialCompleteness, review.scores.commercialFinish)
  assert.deepEqual(Array.from(review.failureCodes), [])
  assert.equal(review.failureClass, '')
  assert.deepEqual(Array.from(review.failedChecklistTokens), [])
})

test('quality review sends a region-scoped mandatory semantic checklist and keeps only exact failed tokens', async () => {
  const workflow = freshWorkflow()
  let payload = null
  const layoutGuide = {
    semanticScaffoldSpecifications: [
      { regionId: 'header', kind: 'header', tokens: ['title', 'back'] },
      {
        regionId: 'hero',
        kind: 'hero',
        tokens: ['subject', 'status-banner'],
        expectedRects: {
          'status-banner': { xNorm: 0.25, yNorm: 0.34, wNorm: 0.5, hNorm: 0.08 },
        },
      },
      { regionId: 'content', kind: 'grid', tokens: ['grid-3x3'], columns: 3, rows: 3 },
    ],
  }
  const review = await workflow.run({
    candidateDataUrl: tinyImage,
    targetPrompt: 'A complete portrait game UI.',
    layoutGuide,
    electronAPI: {
      async promptAssistantReverseImagePrompt(input) {
        payload = input
        return {
          ok: true,
          data: {
            qualityReview: passingReview({
              status: 'FAIL',
              hardFailures: ['The required back control is missing.'],
              failureCodes: ['STRUCTURE_MISSING'],
              failedChecklistTokens: [
                'region-1:back',
                'region-2:status-banner',
                'region-99:invented',
              ],
            }),
          },
        }
      },
    },
  })

  assert.deepEqual(
    Array.from(payload.mandatoryChecklistTokens),
    [
      'region-1:title',
      'region-1:back',
      'region-2:subject',
      'region-2:status-banner',
      'region-3:grid-3x3',
    ],
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(payload.mandatoryChecklist[3])),
    {
      checklistToken: 'region-2:status-banner',
      regionId: 'hero',
      kind: 'hero',
      semanticToken: 'status-banner',
      expectedRect: {
        xNorm: 0.25,
        yNorm: 0.34,
        wNorm: 0.5,
        hNorm: 0.08,
      },
    },
  )
  assert.deepEqual(
    Array.from(review.failedChecklistTokens),
    ['region-1:back', 'region-2:status-banner'],
  )
  assert.equal(review.status, 'FAIL')
  assert.ok(review.failureCodes.includes('STRUCTURE_MISSING'))
  assert.match(review.hardFailures.join('；'), /region-1:back/)
  assert.doesNotMatch(JSON.stringify(payload.mandatoryChecklist), /portrait|game/)
})

test('failed checklist tokens cannot affect review normalization without an allowed semantic checklist', () => {
  const workflow = freshWorkflow()
  const review = workflow.normalizeQualityReview(passingReview({
    failedChecklistTokens: ['region-1:back'],
  }))
  assert.equal(review.status, 'PASS')
  assert.deepEqual(Array.from(review.failedChecklistTokens), [])
})

test('candidate-only visual inventory parser keeps exact tokens and routes missing versus unclear items to structure and readability failures', () => {
  const probe = String.raw`
import importlib.util
import json
import sys

service_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("nf_quality_inventory_probe", service_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

allowed = [
    "region-1:back",
    "region-2:status-banner",
    "region-3:title",
    "region-4:grid-3x3",
]
inventory = module.parse_ui_design_visual_inventory_output(json.dumps({
    "items": [
        {"checklistToken": "region-1:back", "status": "MISSING", "evidence": "no separate navigation control is visible"},
        {"checklistToken": "region-2:status-banner", "status": "UNCLEAR", "evidence": "small text cannot be distinguished"},
        {"checklistToken": "region-3:title", "status": "PRESENT", "evidence": "heading is visible"},
        {"checklistToken": "region-3:title", "status": "MISSING", "evidence": "conflicting duplicate"},
        {"checklistToken": "region-99:invented", "status": "MISSING", "evidence": "must be ignored"},
    ]
}), allowed)
grid_mismatch_inventory = module.parse_ui_design_visual_inventory_output(json.dumps({
    "items": [
        {"checklistToken": "region-1:back", "status": "PRESENT", "evidence": "separate back control is visible"},
        {"checklistToken": "region-2:status-banner", "status": "PRESENT", "evidence": "status banner is visible"},
        {"checklistToken": "region-3:title", "status": "PRESENT", "evidence": "heading is visible"},
        {"checklistToken": "region-4:grid-3x3", "status": "PRESENT", "evidence": "observed=3x2; six symbol centers are visible"},
    ]
}), allowed)
grid_unproven_inventory = module.parse_ui_design_visual_inventory_output(json.dumps({
    "items": [
        {"checklistToken": "region-1:back", "status": "PRESENT", "evidence": "separate back control is visible"},
        {"checklistToken": "region-2:status-banner", "status": "PRESENT", "evidence": "status banner is visible"},
        {"checklistToken": "region-3:title", "status": "PRESENT", "evidence": "heading is visible"},
        {"checklistToken": "region-4:grid-3x3", "status": "PRESENT", "evidence": "a repeated symbol grid is visible"},
    ]
}), allowed)
grid_count = module.parse_ui_design_grid_count_output(
    'prefix ' + json.dumps({
        "columns": 3,
        "rows": 2,
        "confidence": 0.94,
        "evidence": "three aligned columns and two aligned rows",
    }) + ' suffix'
)
grid_verified_inventory = module.apply_ui_design_grid_count(
    grid_unproven_inventory,
    "region-4:grid-3x3",
    3,
    3,
    grid_count,
)
grid_low_confidence_inventory = module.apply_ui_design_grid_count(
    grid_unproven_inventory,
    "region-4:grid-3x3",
    3,
    3,
    {"columns": 3, "rows": 3, "confidence": 0.42, "evidence": "too ambiguous"},
)
checklist = [
    {"checklistToken": token, "semanticToken": token.split(":", 1)[1]}
    for token in allowed
]
merged = module.merge_ui_design_visual_inventory({
    "status": "PASS",
    "hardFailures": [],
    "failureCodes": [],
    "failedChecklistTokens": [],
    "failureClass": "",
    "scores": {},
    "summary": "second stage incorrectly passed",
    "retryPrompt": "",
    "confidence": 1.0,
}, inventory, checklist)
leakage_merged = module.merge_ui_design_visual_inventory({
    "status": "FAIL",
    "hardFailures": ["Copied reference character subject remains in the hero area."],
    "failureCodes": ["REFERENCE_CONTENT_LEAKAGE"],
    "failedChecklistTokens": [],
    "failureClass": "LEAKAGE",
    "scores": {},
    "summary": "reference identity leaked",
    "retryPrompt": "Remove the copied reference character subject.",
    "confidence": 1.0,
}, inventory, checklist)
polish_merged = module.merge_ui_design_visual_inventory({
    "status": "FAIL",
    "hardFailures": ["Commercial finish is insufficient."],
    "failureCodes": ["QUALITY_POLISH_INSUFFICIENT"],
    "failedChecklistTokens": [],
    "failureClass": "POLISH",
    "scores": {},
    "summary": "polish only",
    "retryPrompt": "Improve finish.",
    "confidence": 1.0,
}, inventory, checklist)
unavailable_inventory = module.merge_ui_design_visual_inventory({
    "status": "FAIL",
    "hardFailures": ["Copied reference character subject remains in the hero area."],
    "failureCodes": ["REFERENCE_CONTENT_LEAKAGE"],
    "failedChecklistTokens": [],
    "failureClass": "LEAKAGE",
    "scores": {},
    "summary": "reference identity leaked",
    "retryPrompt": "Remove the copied reference character subject.",
    "confidence": 1.0,
}, {"available": False}, checklist)
reversed_reference_score = module.parse_ui_design_quality_review_output(json.dumps({
    "status": "PASS",
    "hardFailures": [],
    "failureCodes": [],
    "failedChecklistTokens": [],
    "failureClass": "",
    "scores": {
        "themeAdherence": 100,
        "structureAdherence": 100,
        "referenceLeakage": 0,
        "readability": 100,
        "commercialFinish": 100,
        "visualHierarchy": 100,
        "materialCoherence": 100,
        "lightingCoherence": 100,
        "assetConsistency": 100,
        "commercialCompleteness": 100,
    },
    "summary": "no leakage despite reversed score",
    "retryPrompt": "",
    "confidence": 1.0,
}), allowed)
try:
    module.parse_ui_design_quality_review_output(json.dumps({
        "status": "PASS",
        "hardFailures": [],
        "failureCodes": [],
        "failedChecklistTokens": [],
        "failureClass": "",
        "scores": {
            "themeAdherence": 0,
            "structureAdherence": 100,
            "referenceLeakage": 0,
            "readability": 100,
            "commercialFinish": 100,
            "visualHierarchy": 100,
            "materialCoherence": 100,
            "lightingCoherence": 100,
            "assetConsistency": 100,
            "commercialCompleteness": 100,
        },
        "summary": "contradictory pass",
        "retryPrompt": "",
        "confidence": 1.0,
    }), allowed)
    contradiction = ""
except ValueError as error:
    contradiction = str(error)
print(json.dumps({
    "inventory": inventory,
    "gridMismatchInventory": grid_mismatch_inventory,
    "gridUnprovenInventory": grid_unproven_inventory,
    "gridCount": grid_count,
    "gridVerifiedInventory": grid_verified_inventory,
    "gridLowConfidenceInventory": grid_low_confidence_inventory,
    "merged": merged,
    "leakageMerged": leakage_merged,
    "polishMerged": polish_merged,
    "unavailableInventory": unavailable_inventory,
    "reversedReferenceScore": reversed_reference_score["scores"]["referenceLeakage"],
    "contradiction": contradiction,
}, ensure_ascii=False))
`
  const python = process.env.NOVAFLOW_PYTHON || process.env.PYTHON || 'python'
  const result = spawnSync(python, ['-c', probe, servicePath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const parsed = JSON.parse(result.stdout.trim())

  assert.deepEqual(parsed.inventory.missingTokens, ['region-1:back'])
  assert.deepEqual(parsed.inventory.unclearTokens, [
    'region-2:status-banner',
    'region-3:title',
    'region-4:grid-3x3',
  ])
  assert.deepEqual(parsed.gridMismatchInventory.missingTokens, ['region-4:grid-3x3'])
  assert.deepEqual(parsed.gridMismatchInventory.unclearTokens, [])
  assert.deepEqual(parsed.gridUnprovenInventory.missingTokens, [])
  assert.deepEqual(parsed.gridUnprovenInventory.unclearTokens, ['region-4:grid-3x3'])
  assert.equal(parsed.gridCount.columns, 3)
  assert.equal(parsed.gridCount.rows, 2)
  assert.equal(parsed.gridCount.confidence, 0.94)
  assert.deepEqual(parsed.gridVerifiedInventory.missingTokens, ['region-4:grid-3x3'])
  assert.deepEqual(parsed.gridVerifiedInventory.unclearTokens, [])
  assert.deepEqual(parsed.gridLowConfidenceInventory.missingTokens, [])
  assert.deepEqual(parsed.gridLowConfidenceInventory.unclearTokens, ['region-4:grid-3x3'])
  assert.equal(parsed.merged.status, 'FAIL')
  assert.equal(parsed.merged.failureClass, 'STRUCTURE')
  assert.deepEqual(parsed.merged.failedChecklistTokens, [
    'region-1:back',
    'region-2:status-banner',
    'region-3:title',
    'region-4:grid-3x3',
  ])
  assert.ok(parsed.merged.failureCodes.includes('STRUCTURE_MISSING'))
  assert.ok(parsed.merged.failureCodes.includes('CORE_UI_UNREADABLE'))
  assert.match(parsed.merged.hardFailures.join('；'), /region-1:back/)
  assert.match(parsed.merged.hardFailures.join('；'), /region-2:status-banner/)
  assert.match(parsed.merged.retryPrompt, /region-1:back/)
  assert.match(parsed.merged.retryPrompt, /清晰度、对比度与功能辨识度/)
  assert.doesNotMatch(JSON.stringify(parsed.merged), /region-99:invented/)
  assert.equal(parsed.leakageMerged.failureClass, 'LEAKAGE')
  assert.ok(parsed.leakageMerged.failureCodes.includes('REFERENCE_CONTENT_LEAKAGE'))
  assert.ok(parsed.leakageMerged.failureCodes.includes('STRUCTURE_MISSING'))
  assert.ok(parsed.leakageMerged.failedChecklistTokens.includes('region-1:back'))
  assert.match(parsed.leakageMerged.hardFailures.join('；'), /Copied reference character subject/)
  assert.equal(parsed.polishMerged.failureClass, 'STRUCTURE')
  assert.equal(parsed.unavailableInventory.failureClass, 'LEAKAGE')
  assert.deepEqual(parsed.unavailableInventory.failureCodes, ['REFERENCE_CONTENT_LEAKAGE'])
  assert.equal(parsed.reversedReferenceScore, 100)
  assert.equal(parsed.contradiction, 'QUALITY_REVIEW_PASS_SCORE_CONTRADICTION')
})

test('quality review workflow rejects a third original reference instead of silently truncating it', () => {
  const workflow = freshWorkflow()
  assert.throws(() => workflow.buildPayload({
    candidateDataUrl: tinyImage,
    targetPrompt: '竖屏游戏 UI',
    refs: [
      { dataUrl: tinyImage },
      { dataUrl: tinyImage },
      { dataUrl: tinyImage },
    ],
  }), /最多接收 2 张原参考图/)
})

test('quality review normalization clamps scores and treats hard failures as FAIL', () => {
  const workflow = freshWorkflow()
  const review = workflow.normalizeQualityReview(passingReview({
    status: 'PASS',
    hardFailures: ['THEME_MISMATCH'],
    scores: {
      themeAdherence: -10,
      structureAdherence: 150,
      referenceLeakage: 50.4,
      readability: '73',
      commercialFinish: 80,
    },
    retryPrompt: '保留原布局，重新生成明确的哪吒主题老虎机。',
    confidence: 83,
  }))

  assert.equal(review.status, 'FAIL')
  assert.deepEqual(Array.from(review.hardFailures), [
    'THEME_MISMATCH',
    '目标主题或指定主体明显不符合要求',
  ])
  assert.deepEqual({ ...review.scores }, {
    themeAdherence: 0,
    structureAdherence: 100,
    referenceLeakage: 50,
    readability: 73,
    commercialFinish: 80,
    visualHierarchy: 80,
    materialCoherence: 80,
    lightingCoherence: 80,
    assetConsistency: 80,
    commercialCompleteness: 80,
  })
  assert.deepEqual(Array.from(review.failureCodes), ['TARGET_CONTENT_MISMATCH'])
  assert.equal(review.failureClass, 'CONTENT')
  assert.equal(review.confidence, 0.83)
  assert.match(review.retryPrompt, /哪吒主题老虎机/)
})

test('missing or failed Prompt Assistant returns REVIEW/unavailable without turning generation into a failure', async () => {
  const workflow = freshWorkflow()
  for (const electronAPI of [
    {},
    {
      async promptAssistantReverseImagePrompt() {
        throw new Error('service busy')
      },
    },
    {
      async promptAssistantReverseImagePrompt() {
        return { ok: false, error: 'model unavailable' }
      },
    },
  ]) {
    const review = await workflow.run({
      candidateDataUrl: tinyImage,
      targetPrompt: '哪吒主题老虎机',
      electronAPI,
    })
    assert.equal(review.status, 'REVIEW')
    assert.equal(review.unavailable, true)
    assert.equal(review.reason, 'unavailable')
    assert.equal(review.scores.themeAdherence, null)
    assert.equal(workflow.shouldRetry(review, 0), false)
  }
})

test('shouldRetry permits only one retry and builds a deterministic correction when the model omits one', () => {
  const workflow = freshWorkflow()
  const failed = workflow.normalizeQualityReview(passingReview({
    status: 'FAIL',
    hardFailures: ['REFERENCE_CONTENT_LEAKAGE'],
    retryPrompt: '禁止复制参考图标题、Logo和人物，只保留指定结构职责。',
  }))
  assert.equal(workflow.MAX_AUTO_RETRIES, 1)
  assert.equal(workflow.shouldRetry(failed, 0), true)
  assert.equal(workflow.shouldRetry(failed, 1), false)
  assert.equal(workflow.shouldRetry(failed, 2), false)
  assert.equal(workflow.shouldRetry(passingReview(), 0), false)
  assert.equal(workflow.shouldRetry({ ...failed, retryPrompt: '' }, 0), true)
  assert.deepEqual(Array.from(failed.failureCodes), ['REFERENCE_CONTENT_LEAKAGE'])
  assert.equal(failed.failureClass, 'LEAKAGE')
  const correction = workflow.buildActionableRetryPrompt({
    targetPrompt: '中国风哪吒主题，严格3×3转轴，底部显示余额、投注、WIN与Spin',
    structure: {
      regions: [{
        name: '主内容区域',
        purpose: '3×3老虎机转轴',
        requirements: '总共9个符号格',
      }],
    },
    review: { ...failed, retryPrompt: '确保图片1与图片2不同' },
  })
  assert.match(correction, /用户原始目标/)
  assert.match(correction, /严格3×3转轴/)
  assert.match(correction, /总共9个符号格/)
  assert.match(correction, /余额、投注、WIN与Spin/)
  assert.doesNotMatch(correction, /图片\s*[123]/)
})

test('high-confidence low structure score cannot pass and low-confidence PASS requires review', () => {
  const workflow = freshWorkflow()
  const missingStructure = workflow.normalizeQualityReview(passingReview({
    status: 'PASS',
    scores: {
      ...passingReview().scores,
      structureAdherence: 20,
    },
    confidence: 0.9,
  }))
  assert.equal(missingStructure.status, 'FAIL')
  assert.match(missingStructure.hardFailures.join('；'), /页面结构/)
  assert.deepEqual(Array.from(missingStructure.failureCodes), ['STRUCTURE_MISSING'])
  assert.equal(missingStructure.failureClass, 'STRUCTURE')

  const uncertain = workflow.normalizeQualityReview(passingReview({
    status: 'PASS',
    confidence: 0.2,
  }))
  assert.equal(uncertain.status, 'REVIEW')
})

test('old five-score reviews inherit commercial finish without fabricating missing polish failures', () => {
  const workflow = freshWorkflow()
  const review = workflow.normalizeQualityReview(passingReview())

  assert.equal(review.status, 'PASS')
  assert.deepEqual({ ...review.scores }, {
    themeAdherence: 91,
    structureAdherence: 88,
    referenceLeakage: 94,
    readability: 86,
    commercialFinish: 82,
    visualHierarchy: 82,
    materialCoherence: 82,
    lightingCoherence: 82,
    assetConsistency: 82,
    commercialCompleteness: 82,
  })
  assert.deepEqual(Array.from(review.failureCodes), [])
  assert.equal(review.failureClass, '')
})

test('objective polish combinations fail only at high confidence while a single subjective low score does not', () => {
  const workflow = freshWorkflow()
  const weakCombination = {
    ...passingReview(),
    scores: {
      ...passingReview().scores,
      visualHierarchy: 40,
      materialCoherence: 42,
      lightingCoherence: 72,
      assetConsistency: 74,
      commercialCompleteness: 50,
    },
    confidence: 0.84,
  }
  const failed = workflow.normalizeQualityReview(weakCombination)
  assert.equal(failed.status, 'FAIL')
  assert.deepEqual(Array.from(failed.failureCodes), ['QUALITY_POLISH_INSUFFICIENT'])
  assert.equal(failed.failureClass, 'POLISH')
  assert.match(failed.hardFailures.join('；'), /组合质量/)

  const lowConfidence = workflow.normalizeQualityReview({
    ...weakCombination,
    confidence: 0.62,
  })
  assert.equal(lowConfidence.status, 'REVIEW')
  assert.deepEqual(Array.from(lowConfidence.failureCodes), [])
  assert.equal(lowConfidence.failureClass, '')

  const uncertainReportedPolishFailure = workflow.normalizeQualityReview({
    ...weakCombination,
    status: 'FAIL',
    hardFailures: ['QUALITY_POLISH_INSUFFICIENT'],
    failureCodes: ['QUALITY_POLISH_INSUFFICIENT'],
    confidence: 0.62,
  })
  assert.equal(uncertainReportedPolishFailure.status, 'REVIEW')
  assert.deepEqual(Array.from(uncertainReportedPolishFailure.failureCodes), [])
  assert.equal(uncertainReportedPolishFailure.failureClass, '')

  const singleLowDimension = workflow.normalizeQualityReview({
    ...passingReview(),
    scores: {
      ...passingReview().scores,
      visualHierarchy: 82,
      materialCoherence: 20,
      lightingCoherence: 82,
      assetConsistency: 82,
      commercialCompleteness: 82,
    },
    confidence: 0.9,
  })
  assert.equal(singleLowDimension.status, 'PASS')
  assert.deepEqual(Array.from(singleLowDimension.failureCodes), [])
})

test('default rubric and retry guidance are page-type neutral', () => {
  const workflow = freshWorkflow()
  const forbiddenDefaults = /哪吒|老虎机|转轴|Spin|角色主视觉|底部操作区/i
  assert.deepEqual({ ...workflow.FAILURE_CLASSES }, {
    STRUCTURE: 'STRUCTURE',
    CONTENT: 'CONTENT',
    POLISH: 'POLISH',
    READABILITY: 'READABILITY',
    LEAKAGE: 'LEAKAGE',
  })
  assert.doesNotMatch(workflow.DEFAULT_RUBRIC, forbiddenDefaults)
  assert.match(workflow.DEFAULT_RUBRIC, /行数、列数、网格尺寸、重复项总数/)
  assert.match(workflow.DEFAULT_RUBRIC, /任一缺失、增减、错位、替换或无法辨认都必须判定/)
  assert.match(workflow.DEFAULT_RUBRIC, /没有明确要求实体设备.*机柜、机身、手机框、系统状态栏/)
  assert.match(workflow.DEFAULT_RUBRIC, /仅当用户明确要求硬件、设备外观或产品样机时才允许/)
  const prioritizedRubric = workflow.compileRubric({
    regions: [{ name: '主内容', purpose: '显示核心内容' }],
  }, '关键参考构图与数量硬约束：严格3列×3行，共9格')
  assert.match(prioritizedRubric, /^关键参考构图与数量硬约束：严格3列×3行，共9格/)
  assert.match(prioritizedRubric, /本次页面必需结构/)
  const correction = workflow.buildActionableRetryPrompt({
    targetPrompt: '极简科幻设置页面',
    structure: {
      regions: [{
        name: '主要设置区域',
        purpose: '展示音量、语言与画质选项',
      }],
    },
    review: {
      status: 'FAIL',
      hardFailures: ['移除参考图中的海神波塞冬、老虎与原Logo，并提升视觉层级'],
      failureCodes: ['REFERENCE_CONTENT_LEAKAGE', 'QUALITY_POLISH_INSUFFICIENT'],
      failureClass: 'POLISH',
      summary: '候选图仍然像海神波塞冬老虎机',
      retryPrompt: '删除波塞冬、老虎和原Logo',
    },
  })
  assert.doesNotMatch(correction, forbiddenDefaults)
  assert.doesNotMatch(correction, /波塞冬|老虎|原Logo/)
  assert.match(correction, /主要设置区域/)
  assert.match(correction, /层级、材质、光影、资产一致性/)
  assert.match(correction, /不属于用户目标的参考图主体/)
})

test('local Prompt Assistant implements a dedicated structured UI quality-review contract', () => {
  const source = fs.readFileSync(servicePath, 'utf8')
  const branchAt = source.indexOf('if purpose.lower().replace("_", "-") == "ui-design-quality-review":')
  const genericUiAt = source.indexOf('if is_ui_design:', branchAt)
  assert.ok(branchAt >= 0, 'dedicated quality-review purpose branch must exist')
  assert.ok(genericUiAt > branchAt, 'quality review must run before generic UI prompt synthesis')
  assert.match(source, /def parse_ui_design_quality_review_output\([\s\S]*?output: str,[\s\S]*?\) -> dict:/)
  assert.match(source, /def normalize_ui_design_mandatory_checklist\(value\) -> list:/)
  assert.match(source, /allowed_checklist_tokens=None/)
  for (const key of [
    'themeAdherence',
    'structureAdherence',
    'referenceLeakage',
    'readability',
    'commercialFinish',
    'visualHierarchy',
    'materialCoherence',
    'lightingCoherence',
    'assetConsistency',
    'commercialCompleteness',
  ]) {
    assert.match(source, new RegExp(`"${key}"`))
  }
  assert.match(source, /referenceLeakage为100表示没有错误照搬、0表示严重照搬/)
  assert.match(source, /不得因为画面风格漂亮而忽略结构缺失/)
  assert.match(source, /layout或composition参考允许候选保留功能区位置、相对比例、分组、间距、密度和控件关系/)
  assert.match(source, /这些构图相似本身不是泄漏/)
  assert.match(source, /没有明确要求实体设备时，候选图出现机柜、机身、手机框、系统状态栏/)
  assert.match(source, /只有目标明确要求硬件、设备外观或产品样机时才允许这些实体载体/)
  assert.match(source, /retryPrompt禁止使用图片1、图片2、图片3等编号/)
  assert.match(source, /trace_label="uiDesignQualityReview"/)
  assert.match(source, /trace_label="uiDesignQualityReviewRepair"/)
  assert.match(source, /def parse_ui_design_visual_inventory_output\(/)
  assert.match(source, /def merge_ui_design_visual_inventory\(/)
  assert.match(source, /trace_label="uiDesignVisualInventory"/)
  assert.match(source, /images=\[image_tensors\[candidate_index\]\]/)
  assert.match(source, /def parse_ui_design_grid_count_output\(/)
  assert.match(source, /def crop_ui_design_tensor_to_expected_rect\(/)
  assert.match(source, /def apply_ui_design_grid_count\(/)
  assert.match(source, /trace_label="uiDesignGridCount"/)
  assert.match(source, /images=\[grid_crop\]/)
  assert.match(source, /"gridVerifications": grid_verifications/)
  assert.match(source, /本阶段没有目标生成要求，也没有任何参考图/)
  assert.match(source, /不确定时必须使用UNCLEAR，不得猜测为MISSING/)
  assert.match(source, /CORE_UI_UNREADABLE/)
  assert.match(source, /QUALITY_REVIEW_PASS_SCORE_CONTRADICTION/)
  assert.doesNotMatch(source, /inventory_requires_repair = bool\(/)
  assert.doesNotMatch(source, /if inventory_requires_repair:/)
  const inventoryPreflight = source.match(
    /inventory_prompt = \([\s\S]*?(?=\n\s*image_tokens =)/,
  )?.[0] || ''
  assert.doesNotMatch(inventoryPreflight, /\bcurrent_prompt\b|\brequirements\b|images=image_tensors,/)
  assert.match(inventoryPreflight, /images=\[image_tensors\[candidate_index\]\]/)
  assert.match(source, /quality_review = merge_ui_design_visual_inventory\(/)
  assert.ok(
    source.indexOf('trace_label="uiDesignQualityReview"')
      < source.indexOf('quality_review = merge_ui_design_visual_inventory('),
    'full quality review must run before visual inventory is merged',
  )
  assert.match(source, /"visualInventory": visual_inventory/)
  assert.match(source, /failureCodes/)
  assert.match(source, /failedChecklistTokens/)
  assert.match(source, /语义必检清单/)
  assert.match(source, /不得改写ID、不得遗漏、不得新增清单外ID/)
  assert.match(source, /failureClass/)
  assert.match(source, /"qualityReview": quality_review/)
  assert.match(source, /"qualityGateFailed": quality_review\["status"\] == "FAIL"/)
})

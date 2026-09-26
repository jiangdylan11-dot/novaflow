(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignLocalWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  // What the Qwen-Image-2.1 UI run still takes from here: the run intent and the anti-copy prompt.
  const VERSION = '20260927-local-ui-workflow-26'
  const UI_TASK_PROFILE = 'ui-design'
  const REQUIRED_LAYOUT_GUIDE_ENCODING = 'soft-ui-semantic-scaffold-v2'
  const REDESIGN_INTENT = 'redesign'
  const ITERATION_INTENT = 'iteration'
  const REDESIGN_ANTI_COPY_PREFIX = '本地UI重绘约束：'
  const ITERATION_ANTI_COPY_PREFIX = '本地UI修改约束：'
  const FULLSCREEN_DIGITAL_UI_CONTRACT = '整张画布即单一原生数字界面，画面边界与界面视口完全重合，连续背景延伸到四边，全部可见内容均为同一正视屏幕平面内的浅层二维软件图形'
  const FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE = 'FINAL SCREEN-NATIVE OUTPUT: render one finished digital interface edge-to-edge. The image boundary equals the viewport boundary. Keep one continuous background reaching all four edges, with every panel, control and gameplay element integrated as a shallow 2D HUD layer on the same straight-on orthographic screen plane.'
  const TEXT_ONLY_LAYOUT_CONTRACT = [
    `${REDESIGN_ANTI_COPY_PREFIX}本轮没有视觉布局参考图，只按语义区域重建画面，不得把结构说明、辅助线、标注框或结构矩形画成可见内容。`,
    'There is no visual layout reference in this synthesis pass.',
    'Treat region order, relative coverage, required item counts and functional groups as the layout contract.',
    'Invent the finished composition, shapes and materials directly from the written requirements.',
  ].join(' ')

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function referenceRole(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value.role
      : value
    return cleanText(source).toLowerCase().replace(/[\s-]+/g, '_')
  }

  function normalizedReferenceRoles(value) {
    return (Array.isArray(value) ? value : []).map((item, index) => ({
      index,
      role: referenceRole(item),
      name: cleanText(item && typeof item === 'object' ? item.name : ''),
      sourceId: cleanText(item && typeof item === 'object' ? item.sourceId : ''),
      autoPrimary: item && typeof item === 'object' && item.autoPrimary === true,
      roleSource: cleanText(item && typeof item === 'object' ? item.roleSource : ''),
    }))
  }

  function referenceDeclaresIteration(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const candidates = [
      value.kind,
      value.connectionKind,
      value.referenceKind,
      value.intent,
    ]
    return candidates.some((item) => cleanText(item).toLowerCase() === ITERATION_INTENT)
  }

  function resolveIntent(state = {}, referenceRoles = []) {
    const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
    const explicit = [
      source.uiRunIntent,
      source.uiGenerationIntent,
      source.generationIntent,
      source.runIntent,
      source.intent,
    ].map((item) => cleanText(item).toLowerCase()).find(Boolean)
    if (explicit === ITERATION_INTENT) return ITERATION_INTENT
    if (explicit === REDESIGN_INTENT) return REDESIGN_INTENT
    if (
      source.iteration === true
      || source.isIteration === true
      || Number(source.iterationReferenceCount) > 0
      || (
        Array.isArray(referenceRoles)
        && referenceRoles.some((item) => referenceRole(item) !== 'ui_layout' && referenceDeclaresIteration(item))
      )
    ) return ITERATION_INTENT
    return REDESIGN_INTENT
  }

  function compileAntiCopyPrompt(prompt, options = {}) {
    const source = cleanText(prompt)
    if (source.includes(REDESIGN_ANTI_COPY_PREFIX) || source.includes(ITERATION_ANTI_COPY_PREFIX)) return source
    const intent = resolveIntent(options.state, options.referenceRoles)
    const screenNative = intent !== ITERATION_INTENT
      && cleanText(options.carrierIntent).toLowerCase() !== 'hardware'
    if (options.textOnly === true && intent === REDESIGN_INTENT) {
      return [
        TEXT_ONLY_LAYOUT_CONTRACT,
        screenNative ? `${FULLSCREEN_DIGITAL_UI_CONTRACT}。` : '',
        source,
        screenNative ? FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE : '',
      ].filter(Boolean).join(' ')
    }
    const layoutGuide = normalizedReferenceRoles(options.referenceRoles)
      .find((item) => item.role === 'ui_layout')
    const layoutGuideImageNumber = layoutGuide ? layoutGuide.index + 1 : 1
    const constraint = intent === ITERATION_INTENT
      ? `${ITERATION_ANTI_COPY_PREFIX}图1是唯一修改底图；其余图像必须按已声明的参考职责真实参与修改。布局参考约束位置、比例、分组、层级和重复项数量；风格、配色与材质参考约束对应的视觉属性；角色、主体与内容参考约束其声明的身份和内容。用户明确要求用于解决冲突，禁止把未要求的Logo、文案或主题身份带入结果。`
      : `${REDESIGN_ANTI_COPY_PREFIX}图${layoutGuideImageNumber}仅是高斯柔性页面结构引导，只表达区域中心、相对占比、顺序、留白与重复项数量，不得输出结构框、底板、辅助线、坐标或标注。其余参考图必须按已声明职责真实参与合成：布局参考保留主要位置、比例、分组、层级、控件关系与重复项数量；风格、配色和材质参考保留对应视觉属性；角色、主体和内容参考保留其声明的身份与内容。用户明确要求用于解决冲突，禁止带入未要求的Logo、文案或主题身份，也不得把同一内容擅自扩展到其他区域。`
    const digitalCanvasConstraint = screenNative ? ` ${FULLSCREEN_DIGITAL_UI_CONTRACT}。` : ''
    const finalOverride = screenNative ? ` ${FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE}` : ''
    return source
      ? `${constraint}${digitalCanvasConstraint} ${source}${finalOverride}`
      : `${constraint}${digitalCanvasConstraint}${finalOverride}`
  }

  return Object.freeze({
    VERSION,
    UI_TASK_PROFILE,
    REQUIRED_LAYOUT_GUIDE_ENCODING,
    REDESIGN_INTENT,
    ITERATION_INTENT,
    resolveIntent,
    compileAntiCopyPrompt,
  })
})

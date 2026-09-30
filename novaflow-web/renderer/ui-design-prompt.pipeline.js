;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.NovaFlowUiDesignPromptPipeline = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  // One record per active generator; retain original and manually applied text as equivalent inputs.
  const cache = new Map()
  const QWEN_LAYOUT_MODES = ['preserve', 'partial', 'reflow', 'create']
  const QWEN_VISUAL_MODES = ['style-transfer', 'theme-redesign', 'partial', 'create']
  const QWEN_REFERENCE_ROLES = ['layout', 'style', 'content', 'asset', 'combined']
  function normalizeQwenPlan(value, input) {
    const count = input.references?.length || 0
    const fail = () => { throw new Error('Qwen 2.1 UI 设计规划不完整，请重试；本次未提交生成') }
    if (!value || value.version !== 1 || !QWEN_LAYOUT_MODES.includes(value.layoutMode) || !QWEN_VISUAL_MODES.includes(value.visualMode)) fail()
    const layoutReference = value.layoutReference
    if (!Number.isInteger(layoutReference) || layoutReference < 0 || layoutReference > count) fail()
    if ((value.layoutMode === 'create') !== (layoutReference === 0)) fail()
    const references = value.references
    if (!Array.isArray(references) || references.length !== count) fail()
    const seen = new Set()
    for (const ref of references) {
      if (!ref || !Number.isInteger(ref.index) || ref.index < 1 || ref.index > count || seen.has(ref.index) || !QWEN_REFERENCE_ROLES.includes(ref.role)) fail()
      seen.add(ref.index)
      const source = input.references[ref.index - 1]
      if (source.role === 'layout' && !['layout', 'combined'].includes(ref.role)) fail()
      if (['style', 'color', 'material'].includes(source.role) && ref.role !== 'style') fail()
      if (['character', 'subject', 'asset'].includes(source.role) && ref.role !== 'asset') fail()
    }
    if (layoutReference && !['layout', 'combined', 'content'].includes(references.find(r => r.index === layoutReference)?.role)) fail()
    const list = key => {
      if (!Array.isArray(value[key]) || value[key].length > 30 || value[key].some(s => typeof s !== 'string' || !s.trim() || s.length > 800)) fail()
      return value[key].map(s => s.trim())
    }
    const layoutChanges = list('layoutChanges'), preserve = list('preserve')
    if (value.layoutMode === 'partial' && (!layoutChanges.length || !preserve.length)) fail()
    if (value.layoutMode === 'preserve' && layoutChanges.length) fail()
    return { version: 1, layoutMode: value.layoutMode, layoutReference, visualMode: value.visualMode,
      references: [...references].sort((a,b) => a.index-b.index).map(r => ({index:r.index,role:r.role})), layoutChanges, preserve }
  }
  function compileQwenPlan(result, input) {
    const plan = normalizeQwenPlan(result.uiPlan, input)
    // Order the actual model inputs with layout/content first, without changing the user's slots.
    const order = input.references.map((_,i) => i + 1)
    if (plan.layoutReference) order.unshift(...order.splice(order.indexOf(plan.layoutReference),1))
    const remap = value => String(value || '').replace(/@参考图([1-9][0-9]*)/g, (_,n) => { const at = order.indexOf(Number(n)); if (at < 0) throw new Error('设计规划引用了不存在的参考图'); return '@参考图' + (at + 1) })
    const roles = plan.references.map(r => `@参考图${order.indexOf(r.index)+1}：${({layout:'只提供区域分布与功能，不复制原美术',style:'只提供视觉语言，不继承布局和内容',content:'提供需要保留的内容身份和功能',asset:'只提供用户指定的人物或物品素材',combined:'按用户要求分别借鉴布局和内容'})[r.role]}`).join('；')
    const layout = plan.layoutMode === 'preserve' ? '沿用布局参考的区域位置、面积比例、网格行列及功能数量；逐区更换视觉，组件轮廓可自由设计，不画占位线框。'
      : plan.layoutMode === 'partial' ? `只调整这些布局项目：${plan.layoutChanges.map(remap).join('；')}。其余区域的位置、占比、数量和功能关系保持参考图，不扩展为整张重新排版。`
      : plan.layoutMode === 'reflow' ? '按用户要求重新组织布局，保留用户指定的功能，不继承参考图未被要求保留的位置。'
      : '没有布局来源，根据用户要求设计完整布局；风格图、人物和物品图不提供布局。'
    const prompt = [`用户设计需求（最高优先级）：${remap(input.prompt)}`, roles ? `参考用途：${roles}` : '',
      `布局要求：${layout}`, plan.preserve.length ? `必须保留：${plan.preserve.map(remap).join('；')}` : '',
      remap(result.prompt), input.structure?.regions?.length ? `自建布局坐标和模块说明：${JSON.stringify(input.structure)}` : '',
      '只生成完整 UI 成品。保留目标界面的有效文字和功能，不画外部软件界面、编辑手柄或辅助线。'].filter(Boolean).join('\n\n')
    const modelPlan = { ...plan, layoutReference: plan.layoutReference ? 1 : 0,
      references: plan.references.map(r => ({ ...r, index: order.indexOf(r.index) + 1 })).sort((a,b) => a.index-b.index),
      layoutChanges: plan.layoutChanges.map(remap), preserve: plan.preserve.map(remap) }
    return { prompt, references: order.map(i => input.references[i-1]), plan: modelPlan, order }
  }
  function key(input) {
    return JSON.stringify({ provider: input.provider, engine: input.engine || 'grok', targetEngine: input.targetEngine || '', prompt: input.prompt || '', negativePrompt: input.negativePrompt || '', generationIntent: input.generationIntent || '', preserveLayout: input.preserveLayout === true, size: input.size, structure: input.structure, references: (input.references || []).map(r => ({ id: r.id, dataUrl: r.dataUrl || r.imageUrl, role: r.role })) })
  }
  function remember(id, input, result, appliedInput) {
    cache.set(id, { keys: [key(input), ...(appliedInput ? [key(appliedInput)] : [])], result: { ...result } })
    if (cache.size > 16) cache.delete(cache.keys().next().value)
  }
  function aborted() { const error = new Error('任务已中止'); error.name = 'AbortError'; return error }
  async function run(options) {
    const { id, input, signal, assistant } = options
    if (signal?.aborted) throw aborted()
    const previous = cache.get(id)
    if (previous?.keys.includes(key(input))) return { ...previous.result, reused: true }
    let cancel
    const stopped = new Promise((_, reject) => { cancel = () => reject(aborted()); signal?.addEventListener('abort', cancel, { once: true }) })
    try {
      const result = await Promise.race([stopped, Promise.resolve().then(() => assistant.run(input))])
      if (signal?.aborted) throw aborted()
      if (!result?.prompt?.trim()) throw new Error('AI 助手未返回可用设计要求')
      remember(id, input, result)
      return { ...result, reused: false }
    } finally { signal?.removeEventListener('abort', cancel) }
  }
  return Object.freeze({ run, remember, key, normalizeQwenPlan, compileQwenPlan })
})

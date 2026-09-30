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
    const editorIndex=input.references.findIndex(ref=>ref.uiLayoutId&&ref.uiStructure?.regions?.length)
    if(editorIndex>=0&&layoutReference!==editorIndex+1)throw new Error('设计规划未采用当前自建布局，本次未提交生成')
    const list = key => {
      if (!Array.isArray(value[key]) || value[key].length > 30 || value[key].some(s => typeof s !== 'string' || !s.trim() || s.length > 800)) fail()
      return value[key].map(s => s.trim())
    }
    const layoutChanges = list('layoutChanges'), preserve = list('preserve')
    const grids = value.grids === undefined ? [] : value.grids
    if (!Array.isArray(grids) || grids.length > 16 || grids.some(g => !g || typeof g.description !== 'string' || !g.description.trim() || g.description.length > 200 || !Number.isInteger(g.columns) || g.columns < 1 || g.columns > 100 || !Number.isInteger(g.rows) || g.rows < 1 || g.rows > 100)) fail()
    if (value.layoutMode === 'partial' && (!layoutChanges.length || !preserve.length)) fail()
    if (value.layoutMode === 'preserve' && layoutChanges.length) fail()
    return { version: 1, layoutMode: value.layoutMode, layoutReference, visualMode: value.visualMode,
      references: [...references].sort((a,b) => a.index-b.index).map(r => ({index:r.index,role:r.role})), layoutChanges, preserve,
      ...(value.grids !== undefined ? {grids:grids.map(g=>({description:g.description.trim(),columns:g.columns,rows:g.rows}))} : {}) }
  }
  function compileQwenPlan(result, input) {
    const plan = normalizeQwenPlan(result.uiPlan, input)
    // Order the actual model inputs with layout/content first, without changing the user's slots.
    // Competing full-screen references can overwrite the layout. The style image is read by
    // the vision planner; the native edit gets its visual description and the layout image.
    const anchoredStyle = plan.layoutReference > 0
    const wireframe=Boolean(input.references[plan.layoutReference-1]?.uiLayoutId)
    const styleSources = anchoredStyle ? plan.references.filter(r=>r.role==='style').map(r=>r.index) : []
    const order = input.references.map((_,i) => i + 1).filter(i=>!styleSources.includes(i))
    if (plan.layoutReference) order.unshift(...order.splice(order.indexOf(plan.layoutReference),1))
    const remap = value => String(value || '').replace(/(?:@?参考图|图)([1-9][0-9]*)|<image([1-9][0-9]*)>/g, (_,n,tag) => { const source = Number(n || tag); if (styleSources.includes(source)) return '指定风格'; const at = order.indexOf(source); if (at < 0) throw new Error('设计规划引用了不存在的参考图'); return '@参考图' + (at + 1) })
    remap(input.prompt) // Validate the source's identifiers without sending a second full request.
    const native = value => remap(value).replace(/@参考图([1-9][0-9]*)/g, (_,n) => order.length === 1 ? '图片' : `<image${n}>`)
    const modelReferences = plan.references.filter(r=>order.includes(r.index))
    const roles = [...modelReferences].sort((a,b) => order.indexOf(a.index)-order.indexOf(b.index)).map(r => `${order.length === 1 ? '图片' : `<image${order.indexOf(r.index)+1}>`}是${r.index === plan.layoutReference ? wireframe?'自建布局定位图，功能区域的位置与占比以它为准；':'编辑画布，构图和功能布局以它为准；' : ''}${r.index===plan.layoutReference&&wireframe?'只提供空间关系，不是成品外观或人物物品身份，不保留灰块和占位框':({layout:plan.visualMode==='style-transfer'?'保留原内容，只按要求改变美术表现':'布局来源，美术按需求重做',style:'风格来源，只迁移美术表现及其强度，不复制人物物品和布局',content:'内容来源，保留未要求改变的身份与功能',asset:'人物或物品素材来源',combined:'用户指定的布局与内容来源'})[r.role]}`).join('；')
    const layout = plan.layoutMode === 'preserve' ? '沿用布局参考的区域位置、面积比例、网格行列及功能数量；逐区更换视觉，组件轮廓可自由设计，不画占位线框。'
      : plan.layoutMode === 'partial' ? `只调整这些布局项目：${plan.layoutChanges.map(remap).join('；')}。其余区域的位置、占比、数量和功能关系保持参考图，不扩展为整张重新排版。`
      : plan.layoutMode === 'reflow' ? '按用户要求重新组织布局，保留用户指定的功能，不继承参考图未被要求保留的位置。'
      : '没有布局来源，根据用户要求设计完整布局；风格图、人物和物品图不提供布局。'
    // Keep one editing directive. Repeating the source request and every preserved object's
    // appearance invites regeneration instead of preservation (Qwen's official edit guidance).
    const directive = String(result.prompt || '').replace(/(?:^|\n)参考标识[^\n]*/g, '').trim()
    if (!directive) throw new Error('UI 编辑指令为空，本次未提交生成')
    const scope = native(layout)
    const geometry = input.structure?.regions?.length ? `模块位置与用途：${input.structure.regions.map(r =>
      `${r.purpose || '界面模块'}，左${Math.round(r.x/input.structure.width*100)}%、上${Math.round(r.y/input.structure.height*100)}%、宽${Math.round(r.width/input.structure.width*100)}%、高${Math.round(r.height/input.structure.height*100)}%`).join('；')}` : ''
    const prompt = [native(directive), roles, scope,
      '直接设计完整界面，保留参考的整体构图、区域衔接与叠放关系，不将画面改成整齐的通用格子模板。',
      // The native reference carries its arrangement; do not hard-code a vision model's guessed cell counts.
      plan.preserve.length ? `保留这些布局与功能事实：${plan.preserve.map(native).join('；')}` : '', geometry,
      '输出完整UI成品，保留未要求修改的文字与功能。'].filter(Boolean).join('。').replace(/[\r\n]+/g, ' ').replace(/。{2,}/g, '。')
    const modelPlan = { ...plan, layoutReference: plan.layoutReference ? 1 : 0,
      references: modelReferences.map(r => ({ ...r, index: order.indexOf(r.index) + 1 })).sort((a,b) => a.index-b.index),
      layoutChanges: plan.layoutChanges.map(remap), preserve: plan.preserve.map(remap) }
    return { prompt, references: order.map(i => input.references[i-1]), plan: modelPlan, analysisPlan:plan, order }
  }
  function key(input) {
    return JSON.stringify({ contract: 'ui-native-edit-4', provider: input.provider, engine: input.engine || 'grok', targetEngine: input.targetEngine || '', prompt: input.prompt || '', negativePrompt: input.negativePrompt || '', generationIntent: input.generationIntent || '', preserveLayout: input.preserveLayout === true, size: input.size, structure: input.structure, references: (input.references || []).map(r => ({ id: r.id, dataUrl: r.dataUrl || r.imageUrl, role: r.role })) })
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
      const result = await Promise.race([stopped, Promise.resolve().then(() => assistant.run({...input,signal}))])
      if (signal?.aborted) throw aborted()
      if (!result?.prompt?.trim()) throw new Error('AI 助手未返回可用设计要求')
      remember(id, input, result)
      return { ...result, reused: false }
    } finally { signal?.removeEventListener('abort', cancel) }
  }
  return Object.freeze({ run, remember, key, normalizeQwenPlan, compileQwenPlan })
})

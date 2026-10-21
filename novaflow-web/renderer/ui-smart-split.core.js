;(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.NovaFlowUiSmartSplitCore = api
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict'
  const copy = value => JSON.parse(JSON.stringify(value))
  const checkAbort = signal => { if (signal?.aborted) throw new Error('拆图已取消，原图保留') }
  function validate(value) {
    if (typeof value === 'string') { try { value = JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) } catch { throw new Error('识别结果不是有效 JSON，请重新识别') } }
    if (value?.schema !== 'nf.ui.split.v1' || !Array.isArray(value.regions) || !value.regions.length || value.regions.length > 96) throw new Error('没有有效的识别区域，原图未修改')
    const used = new Set()
    return { schema: value.schema, style: String(value.style || '').slice(0, 1200), regions: value.regions.map((region, index) => {
      const box = region.box
      if (!Array.isArray(box) || box.length !== 4 || box.some(n => !Number.isFinite(n) || n < 0 || n > 1000) || box[2] <= box[0] || box[3] <= box[1]) throw new Error('识别区域坐标无效，原图未修改')
      const id = String(region.id || 'region_' + (index + 1)).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
      if (used.has(id)) throw new Error('识别区域 ID 重复')
      used.add(id)
      const kind = region.kind
      if (!['object', 'icon', 'panel', 'text', 'button', 'group'].includes(region.kind)) throw new Error('识别区域类型无效，原图未修改')
      const rounded = box.map(n => Math.round(n))
      if (rounded[2] <= rounded[0] || rounded[3] <= rounded[1]) throw new Error('识别区域为空，原图未修改')
      return { id, name: String(region.name || '区域 ' + (index + 1)).slice(0, 120), kind, box: rounded, uncertain: region.uncertain === true, parentId: String(region.parentId || '').slice(0, 80), origin: region.origin === 'manual' ? 'manual' : region.origin === 'detail' ? 'detail' : 'model', selected: false, manualEdits: 0 }
    }) }
  }
  function pixels(box, width, height) {
    const x = Math.max(0, Math.floor(box[0] * width / 1000)), y = Math.max(0, Math.floor(box[1] * height / 1000))
    const right = Math.min(width, Math.ceil(box[2] * width / 1000)), bottom = Math.min(height, Math.ceil(box[3] * height / 1000))
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
  }
  function merge(regions, ids) {
    const chosen = regions.filter(r => ids.includes(r.id)); if (chosen.length < 2) throw new Error('请先按住 Shift 选择至少两个区域')
    const box = [Math.min(...chosen.map(r => r.box[0])), Math.min(...chosen.map(r => r.box[1])), Math.max(...chosen.map(r => r.box[2])), Math.max(...chosen.map(r => r.box[3]))]
    return [...regions.filter(r => !ids.includes(r.id)), { ...copy(chosen[0]), id: chosen[0].id + '_merged', name: chosen.map(r => r.name).join(' + ').slice(0, 120), box, selected: true, manualEdits: chosen.reduce((n, r) => n + r.manualEdits, 0) + 1 }]
  }
  function divide(regions, id, axis, point) {
    const region = regions.find(r => r.id === id); if (!region) throw new Error('请先选择要分开的区域')
    const coord = axis === 'x' ? 0 : 1, box = region.box
    if (!Number.isFinite(point) || point <= box[coord] + 2 || point >= box[coord + 2] - 2) throw new Error('分割线需在所选区域内部')
    const first = box.slice(), second = box.slice(); first[coord + 2] = Math.round(point); second[coord] = Math.round(point)
    return regions.flatMap(r => r.id !== id ? [r] : [first, second].map((next, index) => ({ ...copy(r), id: r.id + '_' + (index + 1), name: r.name + ' ' + (index + 1), box: next, selected: false, manualEdits: r.manualEdits + 1 })))
  }
  const image = (url, doc) => new Promise((resolve, reject) => { const im = new doc.defaultView.Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('原图读取失败')); im.src = url })
  const canvas = (doc, width, height) => { const c = doc.createElement('canvas'); c.width = width; c.height = height; return c }
  async function detailCrop(source, region, doc = root.document) {
    const im = await image(source.dataUrl, doc), rect = pixels(region.box, im.naturalWidth, im.naturalHeight)
    const x = Math.max(0, rect.x - 32), y = Math.max(0, rect.y - 32), right = Math.min(im.naturalWidth, rect.x + rect.width + 32), bottom = Math.min(im.naturalHeight, rect.y + rect.height + 32)
    const crop = { x, y, width: right - x, height: bottom - y }, c = canvas(doc, crop.width, crop.height)
    c.getContext('2d').drawImage(im, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height)
    return { crop, dataUrl: c.toDataURL('image/png') }
  }
  function mapChildren(proposal, parentId, crop, size, detail) {
    const parent = proposal.regions.find(r => r.id === parentId); if (!parent) throw new Error('细分父组已变更')
    const children = validate(detail).regions
    if (children.length < 2 || children.every(r => ['panel', 'group'].includes(r.kind))) throw new Error('本次局部识别仍是整组，未替换候选')
    const mapped = children.map(r => ({ ...r, id: parentId + '__' + r.id, parentId, origin: 'detail', selected: true, detailLocalBox: r.box.slice(), box: [
      (crop.x + r.box[0] * crop.width / 1000) / size.width * 1000, (crop.y + r.box[1] * crop.height / 1000) / size.height * 1000,
      (crop.x + r.box[2] * crop.width / 1000) / size.width * 1000, (crop.y + r.box[3] * crop.height / 1000) / size.height * 1000
    ].map(n => Math.max(0, Math.min(1000, Math.round(n)))) }))
    const contains = (outer, inner) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
    const removed = proposal.regions.filter(r => r.id !== parentId && (r.parentId === parentId || (!r.parentId && contains(parent.box, r.box)))).map(r => r.id)
    const group = { ...parent, kind: 'group', originalBox: parent.originalBox || parent.box.slice(), box: [Math.min(parent.box[0], ...mapped.map(r => r.box[0])), Math.min(parent.box[1], ...mapped.map(r => r.box[1])), Math.max(parent.box[2], ...mapped.map(r => r.box[2])), Math.max(parent.box[3], ...mapped.map(r => r.box[3]))], selected: false, refinement: { crop, childIds: mapped.map(r => r.id), removedCoarseIds: removed } }
    const regions = proposal.regions.filter(r => r.id !== parentId && !removed.includes(r.id)).concat(group, mapped)
    const next = { ...proposal, regions, groups: regions.filter(r => r.kind === 'group').map(r => ({ id: r.id, name: r.name, box: r.box, originalBox: r.originalBox, childIds: regions.filter(c => c.parentId === r.id).map(c => c.id), pixelLayer: false })) }
    validate(next); return next
  }
  async function sourceHash(dataUrl, crypto = root.crypto) {
    const raw = dataUrl.split(',')[1], bytes = Uint8Array.from(root.atob(raw), c => c.charCodeAt(0))
    if (!crypto?.subtle) throw new Error('当前浏览器无法计算原图校验，请使用本机 Chrome')
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  }
  async function extract(source, proposal, { document: doc = root.document, cutout, signal, onProgress } = {}) {
    const parsed = validate(proposal), im = await image(source.dataUrl, doc), width = im.naturalWidth, height = im.naturalHeight
    const original = canvas(doc, width, height); original.getContext('2d').drawImage(im, 0, 0)
    const background = canvas(doc, width, height); background.getContext('2d').drawImage(im, 0, 0)
    const bg = background.getContext('2d', { willReadFrequently: true }), bgPixels = bg.getImageData(0, 0, width, height)
    const layers = [], failures = [], manualEdits = proposal.regions.reduce((n, r) => n + (r.manualEdits || 0), 0)
    const groups = copy(proposal.groups || proposal.regions.filter(r => r.kind === 'group').map(r => ({ id: r.id, name: r.name, box: r.box, pixelLayer: false })))
    const work = parsed.regions.filter(r => r.kind !== 'group'), textRegions = work.filter(r => r.kind === 'text')
    const origin = { sourceResourceId: source.id, sourceSha256: source.sha256, width, height, style: parsed.style, proposalId: source.proposalId, manualEdits }
    for (let index = 0; index < work.length; index++) {
      checkAbort(signal); const region = work[index], rect = pixels(region.box, width, height), crop = canvas(doc, rect.width, rect.height)
      crop.getContext('2d').drawImage(original, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
      try {
        onProgress?.({ index, total: work.length, name: region.name })
        let recipe = 'confirmed-region-crop'
        if (region.kind === 'object' || region.kind === 'icon') {
          if (typeof cutout !== 'function') throw new Error('当前算力没有对象抠图能力')
          const alphaImage = await image(await cutout(crop.toDataURL('image/png'), { signal, region }), doc); checkAbort(signal)
          const alpha = canvas(doc, rect.width, rect.height); alpha.getContext('2d').drawImage(alphaImage, 0, 0, rect.width, rect.height)
          const a = alpha.getContext('2d').getImageData(0, 0, rect.width, rect.height).data
          const ctx = crop.getContext('2d', { willReadFrequently: true }), p = ctx.getImageData(0, 0, rect.width, rect.height)
          let clear = 0, occupied = 0
          for (let n = 3; n < p.data.length; n += 4) { p.data[n] = Math.round(p.data[n] * a[n] / 255); if (!p.data[n]) clear++; else occupied++ }
          if (!clear || !occupied) throw new Error('对象抠图未得到有效透明轮廓，请调整区域或改为完整区块')
          ctx.putImageData(p, 0, 0); recipe = 'existing-rmbg-alpha-original-rgb'
        }
        const ctx = crop.getContext('2d', { willReadFrequently: true }), layerPixels = ctx.getImageData(0, 0, rect.width, rect.height), protectedTextIds = []
        if (region.kind !== 'text') for (const text of textRegions) {
          const t = pixels(text.box, width, height), left = Math.max(rect.x, t.x), top = Math.max(rect.y, t.y), right = Math.min(rect.x + rect.width, t.x + t.width), bottom = Math.min(rect.y + rect.height, t.y + t.height)
          if (right <= left || bottom <= top) continue
          protectedTextIds.push(text.id)
          for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) layerPixels.data[((y - rect.y) * rect.width + x - rect.x) * 4 + 3] = 0
        }
        let occupied = false; for (let n = 3; n < layerPixels.data.length; n += 4) if (layerPixels.data[n]) { occupied = true; break }
        if (!occupied) throw new Error('该区域与文字保护区完全重合，请调整选区')
        ctx.putImageData(layerPixels, 0, 0)
        const px = layerPixels.data
        for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) if (px[(y * rect.width + x) * 4 + 3] > 0) bgPixels.data[((rect.y + y) * width + rect.x + x) * 4 + 3] = 0
        const group = groups.find(g => g.id === region.parentId)
        layers.push({ id: source.proposalId + '_' + region.id, type: 'image', name: (group ? group.name + ' / ' : '') + region.name, kind: 'asset', ...rect, visible: true, opacity: 1, dataUrl: crop.toDataURL('image/png'), uiSplit: { ...origin, regionId: region.id, regionKind: region.kind, parentId: region.parentId, protectedTextIds, sourceBox: rect, maskRecipe: recipe }, provenance: { kind: 'ui-smart-split', automaticProposal: region.origin !== 'manual', proposalScope: region.origin, confirmedByUser: true, maskRecipe: recipe } })
      } catch (error) { checkAbort(signal); failures.push({ id: region.id, name: region.name, error: String(error.message || error) }) }
    }
    checkAbort(signal)
    if (!layers.length) throw new Error('所有区域提取失败，原图和原图层保留：' + failures.map(f => f.name + '：' + f.error).join('；'))
    bg.putImageData(bgPixels, 0, 0)
    layers.unshift({ id: source.proposalId + '_background', type: 'image', name: '背景（遮挡处未补全）', kind: 'background', x: 0, y: 0, width, height, visible: true, opacity: 1, dataUrl: background.toDataURL('image/png'), uiSplit: { ...origin, sourceBox: { x: 0, y: 0, width, height }, unresolvedOcclusion: true, failedRegions: failures }, provenance: { kind: 'visible-source-remainder', inferredHiddenPixels: false } })
    return { version: 1, width, height, layers, uiSplitGroups: groups, uiSplitOriginal: { ...origin, originalDataUrl: source.dataUrl }, uiSplitFailures: failures, uiSplitManualEdits: manualEdits }
  }
  function repair(context) {
    const refs = (context.references || []).filter(r => r?.dataUrl), targets = refs.filter(r => r.uiSplitContext?.originalDataUrl)
    if (!targets.length) return null
    const sources = new Map(); for (const ref of targets) sources.set(ref.uiSplitContext.sourceSha256, ref.uiSplitContext)
    const combined = refs.map(ref => ({ ...ref }))
    for (const [sha, source] of sources) {
      const existing = combined.find(r => r.dataUrl === source.originalDataUrl)
      if (existing) Object.assign(existing, { role: 'style', uiSplitStyleOnly: true })
      else combined.push({ id: 'ui-original-style-' + sha, name: '拆图原始风格', dataUrl: source.originalDataUrl, role: 'style', uiSplitStyleOnly: true })
    }
    if (combined.length > context.referenceLimit) throw new Error('图层修复还需携带原图风格参考，当前模型参考数量不足；请移除其他参考图')
    const source = targets[0].uiSplitContext, state = {}
    for (const key of ['mode', 'provider', 'count', 'randomSeed', 'seed', 'loras', 'samplingOverrides', 'negativePrompt', 'localTextQuality', 'localEditStrength', 'localDrawEngine', 'gptQualityImg2img', 'gptSize', 'gptCustomWidth', 'gptCustomHeight', 'googleAspectRatioImg2img', 'googleResolution']) if (context.state[key] !== undefined) state[key] = copy(context.state[key])
    Object.assign(state, { mode: 'img2img', width: targets[0].width || source.sourceBox.width, height: targets[0].height || source.sourceBox.height, nsfw: false, uiPreserveLayout: false, uiLayoutMode: 'reflow', uiRunIntent: 'redesign' })
    const originalPrompt = String(context.state.prompt || '')
    const prompt = [originalPrompt || '修复选中的独立 UI 图层', '只输出目标独立素材，使用真实透明背景，不生成整张界面。原始 UI 仅提供画风、配色、材质、光照上下文；不复制其布局、人物身份或其他控件。未明确要求保留的旧形状和身份不要强锁。', ...targets.map((ref, i) => 'Image ' + (refs.indexOf(ref) + 1) + ': 待修改图层 ' + ref.name), ...combined.map((ref, index) => ref.uiSplitStyleOnly ? 'Image ' + (index + 1) + ': 原图风格上下文，不能当布局或待生成内容' : '').filter(Boolean), ...Array.from(sources.values(), s => s.style).filter(Boolean)].join('\n')
    return { uiSplitRepair: true, state, references: combined, originalPrompt, optimizedPrompt: originalPrompt, promptSnapshot: { prompt, negativePrompt: String(context.state.negativePrompt || '') }, sourceContexts: Array.from(sources.values()) }
  }
  return Object.freeze({ validate, pixels, merge, divide, detailCrop, mapChildren, sourceHash, extract, repair })
})

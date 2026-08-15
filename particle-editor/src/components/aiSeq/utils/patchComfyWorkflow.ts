export type ComfyWorkflowPatch = {
  prompt: string
  negative: string
  width: number
  height: number
  frames: number
  fps: number
  steps: number
  seed: number
  images: string[]
  unetHighName?: string
  unetLowName?: string
  loras?: Array<{ id?: string; name: string; weight: number; enabled?: boolean }>
}

export function patchComfyWorkflow(workflow: any, patch: ComfyWorkflowPatch) {
  const promptObj = workflow?.prompt || workflow
  if (!promptObj || typeof promptObj !== 'object') throw new Error('workflow json 不正确（缺少 prompt）')
  const entries = Object.entries<any>(promptObj)
  const hasWanNodes = entries.some(([, n]) => String(n?.class_type || '').toLowerCase().includes('wan'))

  const isLinkPair = (v: any): v is [string, number] => Array.isArray(v) && v.length >= 2 && typeof v[0] === 'string' && typeof v[1] === 'number'

  const setIfHas = (node: any, key: string, value: any) => {
    if (!node?.inputs || typeof node.inputs !== 'object') return
    if (!(key in node.inputs)) return
    node.inputs[key] = value
  }

  const setIfHasNumberLike = (node: any, key: string, value: number) => {
    if (!node?.inputs || typeof node.inputs !== 'object') return
    if (!(key in node.inputs)) return
    const cur = (node.inputs as any)[key]
    const isNumberLike = typeof cur === 'number' || (typeof cur === 'string' && cur.trim() !== '' && Number.isFinite(Number(cur)))
    if (!isNumberLike) return
    ;(node.inputs as any)[key] = value
  }

  const getTitleLower = (node: any) => String(node?._meta?.title || '').toLowerCase()

  const isTextPromptNode = (node: any) => {
    if (!node?.inputs || typeof node.inputs !== 'object') return false
    return ('text' in node.inputs) || ('prompt' in node.inputs)
  }
  const getTextKey = (node: any) => {
    if (!node?.inputs || typeof node.inputs !== 'object') return null
    if ('text' in node.inputs) return 'text'
    if ('prompt' in node.inputs) return 'prompt'
    return null
  }
  const readText = (node: any) => {
    const k = getTextKey(node)
    if (!k) return ''
    try { return String((node.inputs as any)[k] ?? '') } catch { return '' }
  }
  const writeText = (node: any, value: string) => {
    const k = getTextKey(node)
    if (!k) return
    ;(node.inputs as any)[k] = value
  }
  const mergeNegative = (base: any, user: any) => {
    const b = String(base ?? '').trim()
    const u = String(user ?? '').trim()
    if (!u) return b
    if (!b) return u
    if (b.includes(u)) return b
    const b2 = b.replace(/[,\s]+$/g, '')
    return `${b2}, ${u}`
  }
  const isEmptyLatent = (node: any) => String(node?.class_type || '') === 'EmptyLatentImage' && node?.inputs && ('width' in node.inputs || 'height' in node.inputs)
  const isKSampler = (node: any) => String(node?.class_type || '').startsWith('KSampler') && node?.inputs && 'steps' in node.inputs
  const isLoadImage = (node: any) => String(node?.class_type || '') === 'LoadImage' && node?.inputs && ('image' in node.inputs || 'filename' in node.inputs)


  const isIntNode = (node: any) => String(node?.class_type || '') === 'Int' && node?.inputs && 'Number' in node.inputs
  const isIntConstantNode = (node: any) => String(node?.class_type || '') === 'INTConstant' && node?.inputs && 'value' in node.inputs
  const isUNETLoader = (node: any) => String(node?.class_type || '') === 'UNETLoader' && node?.inputs && typeof node.inputs === 'object' && ('unet_name' in node.inputs)
  const isLoraLoader = (node: any) => {
    const ct = String(node?.class_type || '')
    if (!ct) return false
    if (!/lora/i.test(ct)) return false
    if (!node?.inputs || typeof node.inputs !== 'object') return false
    return ('lora_name' in node.inputs) || ('lora' in node.inputs) || ('name' in node.inputs)
  }

  const getNode = (id: any) => (promptObj as any)[id]

  const findPromptNodeFromLink = (link: any, maxDepth = 8): string | null => {
    if (!isLinkPair(link)) return null
    const startId = String(link[0] || '')
    const startOutIndex = Number(link[1] || 0)
    if (!startId) return null
    const seen = new Set<string>()
    const visit = (id: string, depth: number, rootOutIndex: number | null): string | null => {
      if (!id || depth > maxDepth) return null
      if (seen.has(id)) return null
      seen.add(id)
      const node = getNode(id)
      if (!node) return null
      if (isTextPromptNode(node)) return id
      const inputs = node?.inputs && typeof node.inputs === 'object' ? (node.inputs as any) : null
      if (!inputs) return null

      if (depth === 0 && rootOutIndex != null && ('positive' in inputs) && ('negative' in inputs)) {
        if (rootOutIndex === 0 && isLinkPair(inputs.positive)) {
          const out = visit(String(inputs.positive[0] || ''), depth + 1, null)
          if (out) return out
        }
        if (rootOutIndex === 1 && isLinkPair(inputs.negative)) {
          const out = visit(String(inputs.negative[0] || ''), depth + 1, null)
          if (out) return out
        }
      }

      const next: string[] = []
      for (const v of Object.values<any>(inputs)) {
        if (isLinkPair(v)) next.push(String(v[0] || ''))
        else if (Array.isArray(v)) {
          for (const it of v) if (isLinkPair(it)) next.push(String(it[0] || ''))
        }
      }
      for (const nid of next) {
        const out = visit(nid, depth + 1, null)
        if (out) return out
      }
      return null
    }
    return visit(startId, 0, Number.isFinite(startOutIndex) ? startOutIndex : null)
  }

  const posIds = new Set<string>()
  const negIds = new Set<string>()

  for (const [, node] of entries) {
    if (!node?.inputs || typeof node.inputs !== 'object') continue
    const inputs = node.inputs as any
    if (!('positive' in inputs) || !('negative' in inputs)) continue
    const posLink = inputs.positive
    const negLink = inputs.negative
    const pos = findPromptNodeFromLink(posLink)
    const neg = findPromptNodeFromLink(negLink)
    if (pos) posIds.add(pos)
    if (neg) negIds.add(neg)
  }

  const userPos = String(patch.prompt ?? '').trim()
  const userNeg = String(patch.negative ?? '').trim()

  if (posIds.size > 0 && userPos) {
    for (const pid of posIds) {
      const n = getNode(pid)
      if (!n?.inputs || typeof n.inputs !== 'object') continue
      writeText(n, userPos)
    }
  }
  if (negIds.size > 0 && userNeg) {
    for (const nid of negIds) {
      if (posIds.has(nid)) continue
      const n = getNode(nid)
      if (!n?.inputs || typeof n.inputs !== 'object') continue
      writeText(n, mergeNegative(readText(n), userNeg))
    }
  }

  if (posIds.size === 0 || negIds.size === 0) {
    const promptNodes = entries.filter(([, n]) => isTextPromptNode(n)).map(([id]) => id)
    const isPos = (node: any) => {
      const t = getTitleLower(node)
      return t.includes('正') || t.includes('pos') || t.includes('positive') || t.includes('input prompt')
    }
    const isNeg = (node: any) => {
      const t = getTitleLower(node)
      return t.includes('负') || t.includes('neg') || t.includes('negative')
    }
    const posId = promptNodes.find((id) => isPos(getNode(id))) || promptNodes[0]
    const negId = promptNodes.find((id) => isNeg(getNode(id))) || promptNodes.find((id) => id !== posId) || promptNodes[1]
    if (posId && userPos) writeText(getNode(posId), userPos)
    if (negId && userNeg) writeText(getNode(negId), mergeNegative(readText(getNode(negId)), userNeg))
  }

  const vfiMultiplier = (() => {
    let m = 1
    for (const [, node] of entries) {
      const ct = String(node?.class_type || '').toLowerCase()
      if (!ct.includes('rife')) continue
      if (!node?.inputs || typeof node.inputs !== 'object') continue
      const raw = (node.inputs as any).multiplier
      const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
      if (!Number.isFinite(n)) continue
      m = Math.max(m, Math.max(1, Math.round(n)))
    }
    return m
  })()

  const patchVideoCombineFps = (node: any) => {
    const saveOutput = !!(node?.inputs && typeof node.inputs === 'object' && (node.inputs as any).save_output === true)
    const m = saveOutput ? vfiMultiplier : 1
    const v = Math.max(1, Math.min(240, Math.round(patch.fps * m)))
    return v
  }

  for (const [, node] of entries) {
    if (isEmptyLatent(node)) {
      setIfHas(node, 'width', patch.width)
      setIfHas(node, 'height', patch.height)
    }
    if (isKSampler(node)) {
      setIfHas(node, 'steps', patch.steps)
      for (const key of ['seed', 'noise_seed']) setIfHasNumberLike(node, key, patch.seed)
    }

    if (isIntNode(node)) {
      const t = getTitleLower(node)
      if (t.includes('宽') || t.includes('width')) setIfHas(node, 'Number', String(patch.width))
      if (t.includes('高') || t.includes('height')) setIfHas(node, 'Number', String(patch.height))
      if (t.includes('帧') || t.includes('length') || t.includes('总帧')) setIfHas(node, 'Number', String(patch.frames))
      if (t.includes('seed') || t.includes('随机种子')) setIfHas(node, 'Number', String(patch.seed))
    }
    if (isIntConstantNode(node)) {
      const t = getTitleLower(node)
      if (t.includes('采样') || t.includes('steps')) setIfHas(node, 'value', patch.steps)
      if (t.includes('seed') || t.includes('随机种子')) setIfHas(node, 'value', patch.seed)
    }

    if (node?.inputs && typeof node.inputs === 'object') {
      for (const key of ['frames', 'num_frames', 'video_length', 'length']) setIfHasNumberLike(node, key, patch.frames)
      const ct = String(node?.class_type || '')
      const isVideoCombine = ct === 'VHS_VideoCombine' || ct.endsWith('VideoCombine')
      for (const key of ['fps', 'frame_rate', 'frameRate']) {
        const v = (isVideoCombine && key === 'frame_rate') ? patchVideoCombineFps(node) : patch.fps
        setIfHasNumberLike(node, key, v)
      }
      for (const key of ['seed', 'noise_seed']) setIfHasNumberLike(node, key, patch.seed)
    }
  }

  const loadNodes = entries.filter(([, n]) => isLoadImage(n)).map(([id]) => id)
  for (let i = 0; i < Math.min(loadNodes.length, patch.images.length); i++) {
    const id = loadNodes[i]
    const node = (promptObj as any)[id]
    if ('image' in node.inputs) node.inputs.image = patch.images[i]
    else if ('filename' in node.inputs) node.inputs.filename = patch.images[i]
  }

  const unetEntries = entries
    .filter(([, n]) => isUNETLoader(n))
    .map(([id, n]) => {
      const nameLower = String(n?.inputs?.unet_name || '').toLowerCase()
      const titleLower = getTitleLower(n)
      const idNum = Number.parseInt(String(id), 10)
      return { id: String(id), idNum: Number.isFinite(idNum) ? idNum : Number.POSITIVE_INFINITY, node: n, nameLower, titleLower }
    })
    .sort((a, b) => a.idNum - b.idNum)

  const pickHighLowUnetIds = () => {
    const isHigh = (s: string) => /high_lighting|i2vhigh|\bhigh\b|_high\b|highnoise|model_high|high_noise/.test(s)
    const isLow = (s: string) => /low_lighting|i2vlow|\blow\b|_low\b|lownoise|model_low|low_noise/.test(s)
    const highCandidates = unetEntries.filter((x) => isHigh(x.nameLower) || isHigh(x.titleLower))
    const lowCandidates = unetEntries.filter((x) => isLow(x.nameLower) || isLow(x.titleLower))
    const highId = (highCandidates[0]?.id) || ''
    const lowId = (lowCandidates[0]?.id) || ''
    if (highId && lowId && highId !== lowId) return { highId, lowId }
    if (highId && !lowId) {
      const other = unetEntries.find((x) => x.id !== highId)?.id || ''
      return { highId, lowId: other }
    }
    if (lowId && !highId) {
      const other = unetEntries.find((x) => x.id !== lowId)?.id || ''
      return { highId: other, lowId }
    }
    return { highId: unetEntries[0]?.id || '', lowId: unetEntries[1]?.id || '' }
  }

  const { highId: unetHighId, lowId: unetLowId } = pickHighLowUnetIds()
  if (unetHighId && patch.unetHighName) setIfHas(getNode(unetHighId), 'unet_name', String(patch.unetHighName || ''))
  if (unetLowId && patch.unetLowName) setIfHas(getNode(unetLowId), 'unet_name', String(patch.unetLowName || ''))

  const enabledLoras = (Array.isArray(patch.loras) ? patch.loras : [])
    .map((x) => ({ name: String(x?.name || '').trim(), weight: Number(x?.weight), enabled: x?.enabled !== false }))
    .filter((x) => x.enabled && x.name && Number.isFinite(x.weight))

  const isLink = (v: any): v is [string, number] => Array.isArray(v) && v.length >= 2 && typeof v[0] === 'string' && typeof v[1] === 'number'

  const replaceOutputRefs = (fromId: string, toId: string, outIndex: number, onlyNodeIds?: Set<string>) => {
    const nodes = onlyNodeIds ? Array.from(onlyNodeIds).map((k) => (promptObj as any)[k]).filter(Boolean) : Object.values<any>(promptObj)
    for (const node of nodes) {
      if (!node?.inputs || typeof node.inputs !== 'object') continue
      for (const key of Object.keys(node.inputs)) {
        const v = (node.inputs as any)[key]
        if (!isLink(v)) continue
        if (v[0] === fromId && v[1] === outIndex) (node.inputs as any)[key] = [toId, outIndex]
      }
    }
  }

  const nextIdFactory = () => {
    let maxId = 0
    for (const k of Object.keys(promptObj)) {
      const n = Number.parseInt(String(k), 10)
      if (Number.isFinite(n)) maxId = Math.max(maxId, n)
    }
    let cur = maxId + 1
    return () => {
      while ((promptObj as any)[String(cur)]) cur += 1
      return String(cur++)
    }
  }

  const setLoraInputs = (node: any, name: string, w: number) => {
    if (!node?.inputs || typeof node.inputs !== 'object') node.inputs = {}
    const inputs = node.inputs as any
    if ('lora_name' in inputs) inputs.lora_name = name
    else if ('lora' in inputs) inputs.lora = name
    else if ('name' in inputs) inputs.name = name
    if ('strength_model' in inputs) inputs.strength_model = w
    if ('strength_clip' in inputs) inputs.strength_clip = w
    if ('strength' in inputs) inputs.strength = w
    if ('weight' in inputs) inputs.weight = w
    if (!('strength_model' in inputs) && !('strength_clip' in inputs) && String(node?.class_type || '') === 'LoraLoader') {
      inputs.strength_model = w
      inputs.strength_clip = w
    }
  }

  const applyLoraChainFromSeed = (seedId: string, chain: { name: string; weight: number }[]) => {
    if (chain.length === 0) return
    const seed = getNode(seedId)
    if (!seed || !isLoraLoader(seed)) return
    const existingNodeIds = new Set(Object.keys(promptObj))
    const baseModel = seed?.inputs ? (seed.inputs as any).model : undefined
    const baseClip = seed?.inputs ? (seed.inputs as any).clip : undefined
    const mkId = nextIdFactory()
    const modelOutIndex = 0
    const clipOutIndex = (seed?.inputs && typeof seed.inputs === 'object' && 'clip' in seed.inputs) ? 1 : null

    setIfHas(seed, 'model', baseModel)
    if (clipOutIndex != null) setIfHas(seed, 'clip', baseClip)
    setLoraInputs(seed, chain[0].name, chain[0].weight)

    let lastId = seedId
    for (let i = 1; i < chain.length; i++) {
      const id = mkId()
      const inputs: any = { ...(seed.inputs && typeof seed.inputs === 'object' ? seed.inputs : {}) }
      inputs.model = [lastId, modelOutIndex]
      if (clipOutIndex != null) inputs.clip = [lastId, clipOutIndex]
      const node = { class_type: seed.class_type, inputs: { ...inputs } }
      setLoraInputs(node, chain[i].name, chain[i].weight)
      ;(promptObj as any)[id] = node
      lastId = id
    }

    if (lastId !== seedId) {
      replaceOutputRefs(seedId, lastId, modelOutIndex, existingNodeIds)
      if (clipOutIndex != null) replaceOutputRefs(seedId, lastId, clipOutIndex, existingNodeIds)
    }
  }

  const insertLoraChainAfterUnet = (unetId: string, chain: { name: string; weight: number }[]) => {
    if (chain.length === 0) return
    const existingNodeIds = new Set(Object.keys(promptObj))
    const mkId = nextIdFactory()
    const baseModel: any = [unetId, 0]
    const clipLoaderId = Object.entries<any>(promptObj).find(([, n]) => String(n?.class_type || '') === 'CLIPLoader')?.[0]
    const baseClip: any = clipLoaderId ? [String(clipLoaderId), 0] : undefined

    let firstId = ''
    let lastId = ''
    for (let i = 0; i < chain.length; i++) {
      const id = mkId()
      const inputs: any = {}
      if (i === 0) {
        inputs.model = baseModel
        if (baseClip) inputs.clip = baseClip
      } else {
        inputs.model = [lastId, 0]
        if (baseClip) inputs.clip = [lastId, 1]
      }
      inputs.lora_name = chain[i].name
      inputs.strength_model = chain[i].weight
      inputs.strength_clip = chain[i].weight
      ;(promptObj as any)[id] = { class_type: 'LoraLoader', inputs }
      if (!firstId) firstId = id
      lastId = id
    }

    replaceOutputRefs(unetId, lastId, 0, existingNodeIds)
    return { firstId, lastId }
  }

  const insertLoraChainAfterNodeModelOnly = (baseId: string, chain: { name: string; weight: number }[]) => {
    if (chain.length === 0) return
    const existingNodeIds = new Set(Object.keys(promptObj))
    const mkId = nextIdFactory()
    let lastId = ''
    for (let i = 0; i < chain.length; i++) {
      const id = mkId()
      const inputs: any = {}
      inputs.model = i === 0 ? [baseId, 0] : [lastId, 0]
      inputs.lora_name = chain[i].name
      inputs.strength_model = chain[i].weight
      ;(promptObj as any)[id] = { class_type: 'LoraLoaderModelOnly', inputs }
      lastId = id
    }
    replaceOutputRefs(baseId, lastId, 0, existingNodeIds)
  }

  if (enabledLoras.length > 0) {
    const loraSeedIds = Object.entries<any>(promptObj).filter(([, n]) => isLoraLoader(n)).map(([id]) => String(id))
    if (loraSeedIds.length > 0) {
      for (const id of loraSeedIds.slice(0, 2)) applyLoraChainFromSeed(id, enabledLoras)
    } else {
      if (hasWanNodes) {
        const wanSwapIds = Object.entries<any>(promptObj)
          .filter(([, n]) => String(n?.class_type || '').toLowerCase() === 'wanblockswap')
          .map(([id]) => {
            const idNum = Number.parseInt(String(id), 10)
            return { id: String(id), idNum: Number.isFinite(idNum) ? idNum : Number.POSITIVE_INFINITY }
          })
          .sort((a, b) => a.idNum - b.idNum)
          .map((x) => x.id)
        if (wanSwapIds[0]) insertLoraChainAfterNodeModelOnly(wanSwapIds[0], enabledLoras)
        if (wanSwapIds[1]) insertLoraChainAfterNodeModelOnly(wanSwapIds[1], enabledLoras)
      } else {
        const unetIds = Object.entries<any>(promptObj).filter(([, n]) => isUNETLoader(n)).map(([id]) => String(id))
        if (unetIds[0]) insertLoraChainAfterUnet(unetIds[0], enabledLoras)
        if (unetIds[1]) insertLoraChainAfterUnet(unetIds[1], enabledLoras)
      }
    }
  }

  return workflow
}

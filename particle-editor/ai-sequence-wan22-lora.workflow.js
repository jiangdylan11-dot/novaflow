(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceWan22LoraWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MODEL_FAMILY = 'wan2.2_i2v_14b'
  const STANDARD_KIND = 'standard'
  const ROLES = Object.freeze(['high', 'low', 'shared'])
  const FINGERPRINT_PATTERN = /^v1:\d+:\d+(?:\.\d+)?:[a-f0-9]{64}$/i
  const MARKER_KEY = 'novaflowWan22Lora'

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      Object.prototype.toString.call(value) === '[object Object]'
  }

  function cloneJsonValue(value, seen = new Map()) {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new TypeError('Wan2.2 workflow must not contain cycles')
      const output = []
      seen.set(value, output)
      for (const item of value) output.push(cloneJsonValue(item, seen))
      seen.delete(value)
      return output
    }
    if (!isPlainObject(value)) throw new TypeError('Wan2.2 workflow must contain JSON-compatible objects only')
    if (seen.has(value)) throw new TypeError('Wan2.2 workflow must not contain cycles')
    const output = {}
    seen.set(value, output)
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) output[key] = cloneJsonValue(item, seen)
    }
    seen.delete(value)
    return output
  }

  function promptOf(workflow) {
    if (!isPlainObject(workflow)) throw new TypeError('Wan2.2 workflow must be an object')
    const prompt = isPlainObject(workflow.prompt) ? workflow.prompt : workflow
    if (!Object.keys(prompt).length) throw new Error('Wan2.2 workflow prompt is empty')
    for (const [id, node] of Object.entries(prompt)) {
      if (!id || !isPlainObject(node) || !isPlainObject(node.inputs)) {
        throw new TypeError(`Wan2.2 workflow node is invalid: ${id || '(empty)'}`)
      }
    }
    return prompt
  }

  function isLink(value) {
    return Array.isArray(value) && value.length >= 2 && typeof value[0] === 'string' && Number.isInteger(value[1])
  }

  function isSafeLoraName(value) {
    const raw = String(value || '').trim().replace(/\\/g, '/')
    if (!raw || raw.startsWith('/') || /^[a-z]:\//i.test(raw) || !/\.safetensors$/i.test(raw)) return false
    const parts = raw.split('/')
    return !parts.some((part) => !part || part === '.' || part === '..')
  }

  function normalizeDescriptor(value, index) {
    if (!isPlainObject(value)) throw new TypeError(`Wan2.2 LoRA descriptor ${index + 1} must be an object`)
    const name = String(value.name || '').trim()
    const role = String(value.role || '').trim().toLowerCase()
    const modelFamily = String(value.modelFamily || '').trim().toLowerCase()
    const kind = String(value.kind || '').trim().toLowerCase()
    const fingerprint = String(value.fingerprint || '').trim()
    const highFingerprint = String(value.highFingerprint || '').trim()
    const lowFingerprint = String(value.lowFingerprint || '').trim()
    const strengthValue = value.strength == null ? value.weight : value.strength
    const strength = Number(strengthValue)
    if (!isSafeLoraName(name)) throw new Error(`Wan2.2 LoRA name is unsafe: ${name || '(empty)'}`)
    if (!ROLES.includes(role)) throw new Error(`Wan2.2 LoRA role is invalid: ${name}`)
    if (modelFamily !== MODEL_FAMILY || kind !== STANDARD_KIND) {
      throw new Error(`Wan2.2 LoRA descriptor is incompatible: ${name}`)
    }
    if (!FINGERPRINT_PATTERN.test(fingerprint) || !FINGERPRINT_PATTERN.test(highFingerprint) || !FINGERPRINT_PATTERN.test(lowFingerprint)) {
      throw new Error(`Wan2.2 LoRA fingerprint is invalid: ${name}`)
    }
    if (!Number.isFinite(strength) || strength < 0 || strength > 2) {
      throw new RangeError(`Wan2.2 LoRA strength must be from 0 to 2: ${name}`)
    }
    if (value.weight != null && value.strength != null && Number(value.weight) !== strength) {
      throw new Error(`Wan2.2 LoRA strength and weight disagree: ${name}`)
    }
    return Object.freeze({
      name,
      role,
      strength,
      weight: strength,
      enabled: true,
      modelFamily,
      kind,
      supportedSteps: Array.isArray(value.supportedSteps) ? Object.freeze([...value.supportedSteps]) : null,
      fingerprint,
      highFingerprint,
      lowFingerprint,
    })
  }

  function normalizeValidatedLoras(values) {
    if (!Array.isArray(values)) throw new TypeError('Wan2.2 validated LoRAs must be an array')
    const output = []
    const names = new Set()
    for (let index = 0; index < values.length; index += 1) {
      if (values[index]?.enabled === false) continue
      const descriptor = normalizeDescriptor(values[index], index)
      const key = descriptor.name.replace(/\\/g, '/').toLowerCase()
      if (names.has(key)) throw new Error(`Wan2.2 LoRA is duplicated: ${descriptor.name}`)
      names.add(key)
      output.push(descriptor)
    }
    return Object.freeze(output)
  }

  function routeValidatedLoras(values) {
    const normalized = normalizeValidatedLoras(values)
    return Object.freeze({
      all: normalized,
      high: Object.freeze(normalized.filter((item) => item.role === 'high' || item.role === 'shared')),
      low: Object.freeze(normalized.filter((item) => item.role === 'low' || item.role === 'shared')),
    })
  }

  function className(node) {
    return String(node?.class_type || '').trim().toLowerCase()
  }

  function isUnetLoader(node) {
    return className(node) === 'unetloader' && typeof node?.inputs?.unet_name === 'string'
  }

  function isSampler(node) {
    return className(node).includes('sampler')
  }

  function modelInputRole(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const high = /(?:^|_)high(?:_|$)/.test(normalized) || normalized.includes('highnoise')
    const low = /(?:^|_)low(?:_|$)/.test(normalized) || normalized.includes('lownoise')
    if (high === low) return ''
    return high ? 'high' : 'low'
  }

  function isModelInputKey(key) {
    return /model|unet|diffusion/i.test(String(key || ''))
  }

  function traceModelUpstream(prompt, startLink) {
    if (!isLink(startLink)) throw new Error('Wan2.2 sampler model input is not connected')
    const visited = new Set()
    const roots = new Set()
    const stack = [String(startLink[0])]
    while (stack.length) {
      const id = stack.pop()
      if (!id || visited.has(id)) continue
      const node = prompt[id]
      if (!node) throw new Error(`Wan2.2 model path references a missing node: ${id}`)
      visited.add(id)
      if (isUnetLoader(node)) {
        roots.add(id)
        continue
      }
      for (const [key, input] of Object.entries(node.inputs || {})) {
        if (isModelInputKey(key) && isLink(input)) stack.push(String(input[0]))
      }
    }
    return { visited, roots }
  }

  function unetNameRole(node) {
    const text = `${String(node?.inputs?.unet_name || '')} ${String(node?._meta?.title || '')}`
      .toLowerCase()
      .replace(/\\/g, '/')
    const high = /i2v[_. -]*high|high[_. -]*noise|highnoise|(?:^|[/_. -])high(?:$|[/_. -])/.test(text)
    const low = /i2v[_. -]*low|low[_. -]*noise|lownoise|(?:^|[/_. -])low(?:$|[/_. -])/.test(text)
    if (high === low) return ''
    return high ? 'high' : 'low'
  }

  function identifyBranches(workflow) {
    const prompt = promptOf(workflow)
    const samplerIds = []
    const roleTraces = { high: [], low: [] }
    for (const [id, node] of Object.entries(prompt)) {
      if (!isSampler(node)) continue
      let linked = false
      for (const [key, input] of Object.entries(node.inputs)) {
        const role = modelInputRole(key)
        if (!role || !isLink(input)) continue
        linked = true
        roleTraces[role].push(traceModelUpstream(prompt, input))
      }
      if (linked) samplerIds.push(String(id))
    }
    if (!roleTraces.high.length || !roleTraces.low.length) {
      throw new Error('Wan2.2 workflow must expose connected High and Low sampler model inputs')
    }

    const resolveRole = (role) => {
      const roots = new Set()
      const pathNodes = new Set()
      for (const trace of roleTraces[role]) {
        for (const id of trace.roots) roots.add(id)
        for (const id of trace.visited) pathNodes.add(id)
      }
      if (roots.size !== 1) throw new Error(`Wan2.2 ${role} model branch is ambiguous`)
      const unetId = Array.from(roots)[0]
      if (unetNameRole(prompt[unetId]) !== role) {
        throw new Error(`Wan2.2 ${role} sampler branch is connected to the wrong UNET`)
      }
      return { unetId, pathNodes }
    }

    const high = resolveRole('high')
    const low = resolveRole('low')
    if (high.unetId === low.unetId) throw new Error('Wan2.2 High and Low branches share one UNET')
    const overlap = Array.from(high.pathNodes).filter((id) => low.pathNodes.has(id))
    if (overlap.length) throw new Error(`Wan2.2 High and Low model branches overlap: ${overlap.join(', ')}`)
    return Object.freeze({
      highUnetId: high.unetId,
      lowUnetId: low.unetId,
      highPathNodeIds: Object.freeze(Array.from(high.pathNodes)),
      lowPathNodeIds: Object.freeze(Array.from(low.pathNodes)),
      samplerIds: Object.freeze(samplerIds),
    })
  }

  function nextNodeId(prompt) {
    let maximum = 0
    for (const id of Object.keys(prompt)) {
      const number = Number.parseInt(id, 10)
      if (Number.isFinite(number)) maximum = Math.max(maximum, number)
    }
    let candidate = maximum + 1
    return function allocate() {
      while (prompt[String(candidate)]) candidate += 1
      return String(candidate++)
    }
  }

  function replaceRootConsumers(prompt, pathNodeIds, rootId, replacementId) {
    let replaced = 0
    for (const id of pathNodeIds) {
      if (id === rootId) continue
      const node = prompt[id]
      if (!node) continue
      for (const [key, input] of Object.entries(node.inputs || {})) {
        if (!isModelInputKey(key) || !isLink(input) || input[0] !== rootId || input[1] !== 0) continue
        node.inputs[key] = [replacementId, 0]
        replaced += 1
      }
    }
    if (!replaced) throw new Error(`Wan2.2 ${rootId} UNET has no unique model-path consumer`)
  }

  function injectBranch(prompt, branch, rootId, pathNodeIds, descriptors, allocate) {
    if (!descriptors.length) return Object.freeze([])
    const nodeIds = []
    let upstreamId = rootId
    for (let position = 0; position < descriptors.length; position += 1) {
      const descriptor = descriptors[position]
      const id = allocate()
      prompt[id] = {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          model: [upstreamId, 0],
          lora_name: descriptor.name,
          strength_model: descriptor.strength,
        },
        _meta: {
          title: `NovaFlow Wan2.2 ${branch === 'high' ? 'High' : 'Low'} LoRA`,
          [MARKER_KEY]: {
            branch,
            role: descriptor.role,
            position,
            fingerprint: descriptor.fingerprint,
          },
        },
      }
      nodeIds.push(id)
      upstreamId = id
    }
    replaceRootConsumers(prompt, pathNodeIds, rootId, upstreamId)
    return Object.freeze(nodeIds)
  }

  function markedNodes(prompt, branch, pathNodeIds) {
    const path = new Set(pathNodeIds)
    return Object.entries(prompt)
      .filter(([id, node]) => path.has(id) && node?._meta?.[MARKER_KEY]?.branch === branch)
      .sort((left, right) => Number(left[1]._meta[MARKER_KEY].position) - Number(right[1]._meta[MARKER_KEY].position))
  }

  function validateBranch(prompt, branch, rootId, pathNodeIds, expected) {
    const actual = markedNodes(prompt, branch, pathNodeIds)
    if (actual.length !== expected.length) {
      throw new Error(`Wan2.2 ${branch} LoRA node count does not match the validated selection`)
    }
    let upstreamId = rootId
    for (let index = 0; index < expected.length; index += 1) {
      const [id, node] = actual[index]
      const marker = node._meta[MARKER_KEY]
      const descriptor = expected[index]
      if (
        marker.position !== index
        || marker.role !== descriptor.role
        || marker.fingerprint !== descriptor.fingerprint
        || node.inputs.lora_name !== descriptor.name
        || Number(node.inputs.strength_model) !== descriptor.strength
        || !isLink(node.inputs.model)
        || node.inputs.model[0] !== upstreamId
        || node.inputs.model[1] !== 0
      ) {
        throw new Error(`Wan2.2 ${branch} LoRA chain does not match the validated selection at position ${index + 1}`)
      }
      upstreamId = id
    }
    return Object.freeze(actual.map(([id]) => id))
  }

  function validateRoleAwareWorkflow(workflow, validatedLoras) {
    const routes = routeValidatedLoras(validatedLoras)
    const anchors = identifyBranches(workflow)
    const prompt = promptOf(workflow)
    const highNodeIds = validateBranch(prompt, 'high', anchors.highUnetId, anchors.highPathNodeIds, routes.high)
    const lowNodeIds = validateBranch(prompt, 'low', anchors.lowUnetId, anchors.lowPathNodeIds, routes.low)
    const highPath = new Set(anchors.highPathNodeIds)
    const lowPath = new Set(anchors.lowPathNodeIds)
    if (highNodeIds.some((id) => lowPath.has(id)) || lowNodeIds.some((id) => highPath.has(id))) {
      throw new Error('Wan2.2 LoRA node crossed between High and Low branches')
    }
    return Object.freeze({
      anchors,
      routes,
      injectedNodeIds: Object.freeze({ high: highNodeIds, low: lowNodeIds }),
    })
  }

  function buildRoleAwareWorkflow(workflow, validatedLoras) {
    const output = cloneJsonValue(workflow)
    const prompt = promptOf(output)
    const routes = routeValidatedLoras(validatedLoras)
    const anchors = identifyBranches(output)
    const allocate = nextNodeId(prompt)
    injectBranch(prompt, 'high', anchors.highUnetId, anchors.highPathNodeIds, routes.high, allocate)
    injectBranch(prompt, 'low', anchors.lowUnetId, anchors.lowPathNodeIds, routes.low, allocate)
    const validation = validateRoleAwareWorkflow(output, routes.all)
    return Object.freeze({
      workflow: output,
      routes: validation.routes,
      anchors: validation.anchors,
      injectedNodeIds: validation.injectedNodeIds,
    })
  }

  return Object.freeze({
    MODEL_FAMILY,
    STANDARD_KIND,
    ROLES,
    routeValidatedLoras,
    identifyBranches,
    validateRoleAwareWorkflow,
    buildRoleAwareWorkflow,
  })
})

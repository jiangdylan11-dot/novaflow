(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignLayoutGuide = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const SCHEMA_VERSION = 1
  const DEFAULT_WIDTH = 1920
  const DEFAULT_HEIGHT = 1080
  const DEFAULT_GUIDE_MAX_EDGE = 512
  const FILLED_REGIONS_VISUAL_ENCODING = 'filled-regions-only'
  const SOFT_OCCUPANCY_VISUAL_ENCODING = 'soft-occupancy-heatmap-v1'
  const SOFT_UI_SEMANTIC_SCAFFOLD_VISUAL_ENCODING = 'soft-ui-semantic-scaffold-v2'
  const SEMANTIC_REPAIR_MASK_VISUAL_ENCODING = 'semantic-repair-mask-v1'
  const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function finiteNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function positiveNumber(value, fallback) {
    const number = finiteNumber(value)
    return number != null && number > 0 ? number : fallback
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function projectCanvas(source = {}, options = {}) {
    const canvas = source.canvas || source.artboard || source.size || source.document || source.output || {}
    return {
      width: Math.max(64, Math.round(positiveNumber(
        options.width ?? options.outputWidth ?? canvas.width ?? canvas.w ?? source.width,
        DEFAULT_WIDTH,
      ))),
      height: Math.max(64, Math.round(positiveNumber(
        options.height ?? options.outputHeight ?? canvas.height ?? canvas.h ?? source.height,
        DEFAULT_HEIGHT,
      ))),
    }
  }

  function graphLayoutBlocks(source) {
    const graph = source?.graph && typeof source.graph === 'object' ? source.graph : null
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
    const blocks = []
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const type = cleanText(node.type || node.kind || node.nodeType).toLowerCase().replace(/[\s_]+/g, '-')
      const data = node.data && typeof node.data === 'object' ? node.data : {}
      const candidates = [
        data.blocks,
        data.layout?.blocks,
        node.layout?.blocks,
        node.blocks,
      ]
      const isLayoutNode = type === 'layout' || type === 'ui-layout' || type === 'layout-node' || type === 'structure'
      if (!isLayoutNode && !candidates.some(Array.isArray)) continue
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) blocks.push(...candidate)
      }
    }
    return blocks
  }

  function extractBlocks(source = {}) {
    const versionedGraphBlocks = Number(source?.graph?.schemaVersion) >= 2 ? graphLayoutBlocks(source) : []
    if (versionedGraphBlocks.length) return versionedGraphBlocks.filter((item) => item && typeof item === 'object')
    const candidates = [
      source.blocks,
      source.layout?.blocks,
      source.structure?.blocks,
      source.geometry?.blocks,
      source.data?.regions,
      source.regions,
    ]
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) return candidate.filter((item) => item && typeof item === 'object')
    }
    return graphLayoutBlocks(source).filter((item) => item && typeof item === 'object')
  }

  function rawBounds(block) {
    const source = block?.layoutBounds || block?.bounds || block?.geometry || block?.region || block || {}
    const xNorm = finiteNumber(source.xNorm ?? source.leftNorm)
    const yNorm = finiteNumber(source.yNorm ?? source.topNorm)
    const widthNorm = finiteNumber(source.wNorm ?? source.widthNorm)
    const heightNorm = finiteNumber(source.hNorm ?? source.heightNorm)
    if ([xNorm, yNorm, widthNorm, heightNorm].every((value) => value != null)) {
      const x = clamp(xNorm, 0, 1)
      const y = clamp(yNorm, 0, 1)
      return {
        normalized: true,
        x,
        y,
        width: clamp(widthNorm, 0, 1 - x),
        height: clamp(heightNorm, 0, 1 - y),
      }
    }

    const x = finiteNumber(source.x ?? source.left)
    const y = finiteNumber(source.y ?? source.top)
    const width = finiteNumber(source.width ?? source.w)
    const height = finiteNumber(source.height ?? source.h)
    if ([x, y, width, height].some((value) => value == null) || width <= 0 || height <= 0) return null
    return { normalized: false, x, y, width, height }
  }

  function expandedBounds(entries, aspectRatio) {
    const minimumX = Math.min(...entries.map((entry) => entry.bounds.x))
    const minimumY = Math.min(...entries.map((entry) => entry.bounds.y))
    const maximumX = Math.max(...entries.map((entry) => entry.bounds.x + entry.bounds.width))
    const maximumY = Math.max(...entries.map((entry) => entry.bounds.y + entry.bounds.height))
    let width = Math.max(1, maximumX - minimumX)
    let height = Math.max(1, maximumY - minimumY)
    let x = minimumX - width * 0.06
    let y = minimumY - height * 0.06
    width *= 1.12
    height *= 1.12
    const currentAspect = width / height
    if (currentAspect < aspectRatio) {
      const expandedWidth = height * aspectRatio
      x -= (expandedWidth - width) / 2
      width = expandedWidth
    } else if (currentAspect > aspectRatio) {
      const expandedHeight = width / aspectRatio
      y -= (expandedHeight - height) / 2
      height = expandedHeight
    }
    return { x, y, width, height }
  }

  function normalizeRole(value) {
    return cleanText(value || 'region').toLowerCase().replace(/[\s_]+/g, '-') || 'region'
  }

  function compileSemanticLayout(source = {}, options = {}) {
    if (source && source.kind === 'ui-layout-semantic' && Array.isArray(source.regions)) {
      source = { ...source, blocks: source.regions }
    }
    const canvas = projectCanvas(source, options)
    const inputBlocks = extractBlocks(source).filter((block) => block.participates !== false && block.enabled !== false)
    const entries = inputBlocks.map((block, index) => ({ block, index, bounds: rawBounds(block) }))
    const absoluteEntries = entries.filter((entry) => entry.bounds && !entry.bounds.normalized)
    const allAbsoluteFitCanvas = absoluteEntries.length > 0 && absoluteEntries.every((entry) => (
      entry.bounds.x >= 0
      && entry.bounds.y >= 0
      && entry.bounds.x + entry.bounds.width <= canvas.width * 1.02
      && entry.bounds.y + entry.bounds.height <= canvas.height * 1.02
    ))
    const absoluteSpace = absoluteEntries.length && !allAbsoluteFitCanvas
      ? expandedBounds(absoluteEntries, canvas.width / canvas.height)
      : { x: 0, y: 0, width: canvas.width, height: canvas.height }

    const regions = entries.map(({ block, index, bounds }) => {
      let xNorm = null
      let yNorm = null
      let widthNorm = null
      let heightNorm = null
      if (bounds?.normalized) {
        xNorm = bounds.x
        yNorm = bounds.y
        widthNorm = bounds.width
        heightNorm = bounds.height
      } else if (bounds) {
        xNorm = clamp((bounds.x - absoluteSpace.x) / absoluteSpace.width, 0, 1)
        yNorm = clamp((bounds.y - absoluteSpace.y) / absoluteSpace.height, 0, 1)
        widthNorm = clamp(bounds.width / absoluteSpace.width, 0, 1 - xNorm)
        heightNorm = clamp(bounds.height / absoluteSpace.height, 0, 1 - yNorm)
      }
      const hasGeometry = [xNorm, yNorm, widthNorm, heightNorm].every((value) => value != null)
        && widthNorm > 0 && heightNorm > 0
      return {
        id: cleanText(block.id) || `region_${index + 1}`,
        name: cleanText(block.name || block.title || block.label) || `区块 ${index + 1}`,
        role: normalizeRole(block.role || block.kind || block.type),
        purpose: cleanText(block.purpose || block.description || block.summary),
        requirements: cleanText(block.requirements || block.requirement || block.prompt || block.generateRequirement),
        zIndex: Math.round(finiteNumber(block.zIndex ?? block.z) || index + 1),
        hasGeometry,
        xNorm: hasGeometry ? Number(xNorm.toFixed(6)) : null,
        yNorm: hasGeometry ? Number(yNorm.toFixed(6)) : null,
        wNorm: hasGeometry ? Number(widthNorm.toFixed(6)) : null,
        hNorm: hasGeometry ? Number(heightNorm.toFixed(6)) : null,
      }
    })

    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'ui-layout-semantic',
      name: cleanText(source.name || source.title || source.projectName),
      description: cleanText(source.description || source.brief || source.summary),
      requirement: cleanText(source.requirement || source.requirements || source.generateRequirement || source.prompt),
      canvas,
      regions,
    }
  }

  function canvasOrientation(canvas) {
    const width = positiveNumber(canvas?.width, DEFAULT_WIDTH)
    const height = positiveNumber(canvas?.height, DEFAULT_HEIGHT)
    const ratio = width / Math.max(1, height)
    if (ratio > 1.2) return '横向全屏游戏界面'
    if (ratio < 0.83) return '竖向全屏游戏界面'
    return '方形游戏界面'
  }

  function regionPlacement(region) {
    if (!region?.hasGeometry) return ''
    const centerX = clamp(Number(region.xNorm) + Number(region.wNorm) / 2, 0, 1)
    const centerY = clamp(Number(region.yNorm) + Number(region.hNorm) / 2, 0, 1)
    const horizontal = centerX < 0.34 ? '左侧' : centerX > 0.66 ? '右侧' : '中部'
    const vertical = centerY < 0.3 ? '上方' : centerY > 0.7 ? '下方' : '中部'
    const position = horizontal === '中部' && vertical === '中部'
      ? '画面中央'
      : `画面${vertical}${horizontal === '中部' ? '' : horizontal}`
    const area = Math.max(0, Number(region.wNorm) || 0) * Math.max(0, Number(region.hNorm) || 0)
    const scale = area >= 0.3 ? '主要视觉区域' : area >= 0.1 ? '中型功能区域' : '紧凑功能区域'
    return `${position}的${scale}，具体边界和留白严格以图1为准`
  }

  function semanticRoleInstruction(value) {
    const role = cleanText(value).toLowerCase().replace(/[\s_]+/g, '-')
    const labels = {
      navigation: '承载主要导航功能',
      nav: '承载主要导航功能',
      header: '承载顶部信息与导航功能',
      hero: '承载核心视觉与主题信息',
      content: '承载主要内容',
      action: '承载主要操作',
      cta: '承载主要操作',
      footer: '承载底部辅助功能',
      toolbar: '承载工具操作',
      panel: '承载对应功能内容',
    }
    return labels[role] || ''
  }

  function compileSemanticPrompt(value = {}, options = {}) {
    const semantic = value?.kind === 'ui-layout-semantic'
      ? compileSemanticLayout(value, options)
      : compileSemanticLayout(value, options)
    const lines = [`采用${canvasOrientation(semantic.canvas)}构图`]
    if (semantic.description) lines.push(`整体视觉围绕${semantic.description}展开，但不要直接排印这段说明`)
    if (semantic.requirement) lines.push(`设计时满足${semantic.requirement}，不得把这句话作为界面文案`)
    if (semantic.regions.length) lines.push('以下内容只用于决定视觉安排，不得逐字复述或排成说明文字')
    semantic.regions.forEach((region) => {
      const responsibility = region.purpose || semanticRoleInstruction(region.role) || '完成对应界面功能'
      const parts = [`一个区域用于${responsibility}`]
      const placement = regionPlacement(region)
      if (placement) parts.push(placement)
      if (region.requirements) parts.push(`同时满足${region.requirements}`)
      lines.push(parts.join('，'))
    })
    return lines.join('； ')
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const output = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
      output.set(part, offset)
      offset += part.length
    }
    return output
  }

  function uint32Bytes(value) {
    return Uint8Array.from([
      (value >>> 24) & 255,
      (value >>> 16) & 255,
      (value >>> 8) & 255,
      value & 255,
    ])
  }

  let crcTable = null
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256)
      for (let index = 0; index < 256; index += 1) {
        let value = index
        for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
        crcTable[index] = value >>> 0
      }
    }
    let crc = 0xffffffff
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }

  function pngChunk(type, data) {
    const typeBytes = Uint8Array.from(type.split('').map((character) => character.charCodeAt(0)))
    const body = concatBytes([typeBytes, data])
    return concatBytes([uint32Bytes(data.length), body, uint32Bytes(crc32(body))])
  }

  function adler32(bytes) {
    let a = 1
    let b = 0
    for (const byte of bytes) {
      a = (a + byte) % 65521
      b = (b + a) % 65521
    }
    return ((b << 16) | a) >>> 0
  }

  function zlibStore(bytes) {
    const parts = [Uint8Array.from([0x78, 0x01])]
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(65535, bytes.length - offset)
      const final = offset + length >= bytes.length ? 1 : 0
      parts.push(Uint8Array.from([
        final,
        length & 255,
        (length >>> 8) & 255,
        (~length) & 255,
        ((~length) >>> 8) & 255,
      ]))
      parts.push(bytes.subarray(offset, offset + length))
      offset += length
    }
    parts.push(uint32Bytes(adler32(bytes)))
    return concatBytes(parts)
  }

  function bytesToBase64(bytes) {
    const bufferApi = (root && root.Buffer) || (typeof Buffer !== 'undefined' ? Buffer : null)
    if (bufferApi && typeof bufferApi.from === 'function') return bufferApi.from(bytes).toString('base64')
    const encoder = root && typeof root.btoa === 'function' ? root.btoa.bind(root) : null
    if (!encoder) throw new Error('Base64 encoder is unavailable')
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)))
    }
    return encoder(binary)
  }

  function rasterSize(canvas, maxEdge) {
    const maximum = Math.max(128, Math.round(positiveNumber(maxEdge, DEFAULT_GUIDE_MAX_EDGE)))
    const aspect = canvas.width / canvas.height
    if (aspect >= 1) return { width: maximum, height: Math.max(64, Math.round(maximum / aspect)) }
    return { width: Math.max(64, Math.round(maximum * aspect)), height: maximum }
  }

  function regionColor(region, index) {
    let hash = index + 17
    const source = `${region.role}:${region.id}`
    for (let offset = 0; offset < source.length; offset += 1) hash = ((hash * 31) + source.charCodeAt(offset)) >>> 0
    const shade = 72 + (hash % 82)
    return [shade, Math.min(196, shade + 12), Math.min(206, shade + 20), 224]
  }

  function fillRoundedRect(pixels, raster, bounds, color) {
    const left = clamp(Math.floor(bounds.xNorm * raster.width), 0, raster.width)
    const top = clamp(Math.floor(bounds.yNorm * raster.height), 0, raster.height)
    const right = clamp(Math.ceil((bounds.xNorm + bounds.wNorm) * raster.width), 0, raster.width)
    const bottom = clamp(Math.ceil((bounds.yNorm + bounds.hNorm) * raster.height), 0, raster.height)
    const radius = Math.max(1, Math.min(12, Math.floor(Math.min(right - left, bottom - top) * 0.06)))
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const horizontal = x < left + radius ? left + radius - x : (x >= right - radius ? x - (right - radius - 1) : 0)
        const vertical = y < top + radius ? top + radius - y : (y >= bottom - radius ? y - (bottom - radius - 1) : 0)
        if (horizontal && vertical && horizontal * horizontal + vertical * vertical > radius * radius) continue
        const offset = (y * raster.width + x) * 4
        pixels[offset] = color[0]
        pixels[offset + 1] = color[1]
        pixels[offset + 2] = color[2]
        pixels[offset + 3] = color[3]
      }
    }
  }

  function semanticGridFromText(value) {
    const source = cleanText(value)
    const rowsThenColumns = source.match(/([2-6])\s*(?:行|rows?)\s*(?:[xX×*]|by)\s*([2-6])\s*(?:列|columns?)/i)
    if (rowsThenColumns) {
      return {
        columns: Number(rowsThenColumns[2]),
        rows: Number(rowsThenColumns[1]),
      }
    }
    const columnsThenRows = source.match(/([2-6])\s*(?:列|columns?)\s*(?:[xX×*]|by)\s*([2-6])\s*(?:行|rows?)/i)
    if (columnsThenRows) {
      return {
        columns: Number(columnsThenRows[1]),
        rows: Number(columnsThenRows[2]),
      }
    }
    const compact = source.match(/([2-6])\s*[xX×*]\s*([2-6])/)
    if (compact) {
      return {
        columns: Number(compact[1]),
        rows: Number(compact[2]),
      }
    }

    if (!/\b(?:reels?|slots?|grid)\b|转轴|老虎机|网格/i.test(source)) return null
    const columnsOnly = source.match(/([2-6])\s*(?:列|columns?)/i)
    const rowsOnly = source.match(/([2-6])\s*(?:行|rows?)/i)
    if (columnsOnly && rowsOnly) {
      return {
        columns: Number(columnsOnly[1]),
        rows: Number(rowsOnly[1]),
      }
    }
    if (columnsOnly) {
      return {
        columns: Number(columnsOnly[1]),
        columnsOnly: true,
      }
    }
    if (rowsOnly) {
      return {
        rows: Number(rowsOnly[1]),
        rowsOnly: true,
      }
    }
    return null
  }

  function semanticGrid(region) {
    return semanticGridFromText([
      region?.name,
      region?.role,
      region?.purpose,
      region?.requirements,
    ].map(cleanText).filter(Boolean).join(' '))
  }

  function semanticGridTargetScore(region, semanticText) {
    const source = [
      region?.name,
      region?.role,
      region?.purpose,
      region?.requirements,
    ].map(cleanText).filter(Boolean).join(' ').toLowerCase()
    const prompt = cleanText(semanticText).toLowerCase()
    let score = 0
    const weightedTerms = [
      ['主内容', 18],
      ['核心玩法', 18],
      ['转轴', 16],
      ['老虎机', 14],
      ['reel', 14],
      ['slot', 14],
      ['gameplay', 12],
      ['content', 10],
      ['网格', 10],
      ['棋盘', 10],
      ['grid', 10],
      ['玩法', 8],
    ]
    weightedTerms.forEach(([term, weight]) => {
      if (source.includes(term)) score += weight
    })
    const name = cleanText(region?.name).toLowerCase()
    if (name && prompt.includes(name)) score += 24
    if (/(顶部|底部|页眉|页脚|header|footer|导航|navigation)/i.test(source)) score -= 24
    if (/(角色|主视觉|hero|character)/i.test(source)) score -= 14
    if (region?.hasGeometry) {
      const centerY = Number(region.yNorm) + Number(region.hNorm) / 2
      score += Math.max(0, 4 - Math.abs(centerY - 0.58) * 10)
    }
    return score
  }

  function resolveSemanticSubgrids(regions, options = {}) {
    if (options.semanticSubgrid !== true) return { byRegionId: new Map(), specifications: [] }
    const byRegionId = new Map()
    const specifications = []
    regions.forEach((region) => {
      const grid = semanticGrid(region)
      if (!grid) return
      byRegionId.set(region.id, grid)
      specifications.push({ regionId: region.id, ...grid, source: 'region' })
    })
    if (specifications.length) return { byRegionId, specifications }

    const promptGrid = semanticGridFromText(options.semanticText)
    if (!promptGrid || !regions.length) return { byRegionId, specifications }
    const target = regions
      .map((region, index) => ({ region, index, score: semanticGridTargetScore(region, options.semanticText) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0]
    if (!target?.region || target.score <= 0) return { byRegionId, specifications }
    byRegionId.set(target.region.id, promptGrid)
    specifications.push({
      regionId: target.region.id,
      ...promptGrid,
      source: 'semantic-text',
    })
    return { byRegionId, specifications }
  }

  function addGaussian(occupancy, raster, centerX, centerY, sigmaX, sigmaY, intensity = 1) {
    const inverseSigmaX = 1 / Math.max(1, sigmaX)
    const inverseSigmaY = 1 / Math.max(1, sigmaY)
    for (let y = 0; y < raster.height; y += 1) {
      const dy = ((y + 0.5) - centerY) * inverseSigmaY
      const verticalDistance = dy * dy
      const rowOffset = y * raster.width
      for (let x = 0; x < raster.width; x += 1) {
        const dx = ((x + 0.5) - centerX) * inverseSigmaX
        const weight = Math.exp(-0.5 * ((dx * dx) + verticalDistance)) * intensity
        const index = rowOffset + x
        if (weight > occupancy[index]) occupancy[index] = weight
      }
    }
  }

  function addGaussianSegment(occupancy, raster, startX, startY, endX, endY, sigma, intensity = 1) {
    const distance = Math.hypot(endX - startX, endY - startY)
    const samples = Math.max(3, Math.ceil(distance / Math.max(1, sigma * 0.8)) + 1)
    for (let index = 0; index < samples; index += 1) {
      const ratio = index / Math.max(1, samples - 1)
      addGaussian(
        occupancy,
        raster,
        startX + (endX - startX) * ratio,
        startY + (endY - startY) * ratio,
        sigma,
        sigma,
        intensity,
      )
    }
  }

  function createSoftOccupancyHeatmap(raster, regions, options = {}) {
    const background = 24
    const amplitude = 120
    const minimumSigma = 12
    const occupancy = new Float64Array(raster.width * raster.height)

    for (const region of regions) {
      const centerX = (Number(region.xNorm) + Number(region.wNorm) / 2) * raster.width
      const centerY = (Number(region.yNorm) + Number(region.hNorm) / 2) * raster.height
      const sigmaX = Math.max(minimumSigma, Number(region.wNorm) * raster.width * 0.5)
      const sigmaY = Math.max(minimumSigma, Number(region.hNorm) * raster.height * 0.5)
      const grid = options.subgridPlan?.byRegionId?.get(region.id) || null
      if (!grid) {
        addGaussian(occupancy, raster, centerX, centerY, sigmaX, sigmaY)
        continue
      }

      addGaussian(occupancy, raster, centerX, centerY, sigmaX, sigmaY, 0.28)
      const regionLeft = Number(region.xNorm) * raster.width
      const regionTop = Number(region.yNorm) * raster.height
      const regionWidth = Number(region.wNorm) * raster.width
      const regionHeight = Number(region.hNorm) * raster.height
      if (grid.columnsOnly) {
        const columnWidth = regionWidth / grid.columns
        for (let column = 0; column < grid.columns; column += 1) {
          addGaussian(
            occupancy,
            raster,
            regionLeft + (column + 0.5) * columnWidth,
            centerY,
            Math.max(3, columnWidth * 0.24),
            Math.max(3, regionHeight * 0.48),
          )
        }
        continue
      }
      if (grid.rowsOnly) {
        const rowHeight = regionHeight / grid.rows
        for (let row = 0; row < grid.rows; row += 1) {
          addGaussian(
            occupancy,
            raster,
            centerX,
            regionTop + (row + 0.5) * rowHeight,
            Math.max(3, regionWidth * 0.48),
            Math.max(3, rowHeight * 0.24),
          )
        }
        continue
      }
      const cellWidth = Number(region.wNorm) * raster.width / grid.columns
      const cellHeight = Number(region.hNorm) * raster.height / grid.rows
      for (let row = 0; row < grid.rows; row += 1) {
        for (let column = 0; column < grid.columns; column += 1) {
          addGaussian(
            occupancy,
            raster,
            regionLeft + (column + 0.5) * cellWidth,
            regionTop + (row + 0.5) * cellHeight,
            Math.max(3, cellWidth * 0.24),
            Math.max(3, cellHeight * 0.24),
          )
        }
      }
    }

    const pixels = new Uint8Array(occupancy.length)
    for (let index = 0; index < occupancy.length; index += 1) {
      pixels[index] = Math.round(background + amplitude * occupancy[index])
    }
    return pixels
  }

  function regionSemanticText(region) {
    return [
      region?.name,
      region?.role,
      region?.purpose,
      region?.requirements,
    ].map(cleanText).filter(Boolean).join(' ').toLowerCase()
  }

  function semanticScaffoldKind(region, subgridPlan) {
    if (subgridPlan?.byRegionId?.has(region.id)) return 'grid'
    const role = normalizeRole(region?.role)
    const source = regionSemanticText(region)
    if (
      ['header', 'navigation', 'nav', 'topbar', 'titlebar'].includes(role)
      || /\b(header|navigation|top\s*bar|title\s*bar)\b|顶部|页首|标题栏|导航/.test(source)
    ) return 'header'
    if (
      ['footer', 'bottom', 'bottom-bar', 'control-bar', 'toolbar', 'action-bar'].includes(role)
      || /\b(footer|bottom\s*bar|control\s*bar|action\s*bar)\b|底部|页脚|控制栏|操作栏/.test(source)
    ) return 'footer'
    if (
      ['hero', 'character', 'subject', 'showcase', 'main-visual'].includes(role)
      || /\b(hero|character|subject|showcase|main\s*visual)\b|角色展示|人物展示|主体展示|主视觉|角色|人物|主体/.test(source)
    ) return 'hero'
    return 'generic'
  }

  function semanticScopeKind(value) {
    const source = cleanText(value).toLowerCase()
    if (!source) return ''
    if (/\b(footer|bottom(?:\s*ui|\s*bar)?|control\s*bar|action\s*bar)\b|底部|页脚|控制栏|操作栏/.test(source)) return 'footer'
    if (/\b(header|top(?:\s*ui|\s*bar)?|title\s*bar|navigation)\b|顶部|页首|标题栏|导航/.test(source)) return 'header'
    if (/\b(hero|character|subject|showcase|main\s*visual)\b|角色展示|人物展示|主视觉|主角展示/.test(source)) return 'hero'
    if (/\b(main\s*content|content\s*area|reels?|grid)\b|主内容|内容区域|转轴|网格/.test(source)) return 'grid'
    if (/\b(overall|visual\s*style|art\s*direction|palette|material|lighting)\b|整体|视觉风格|配色|材质|光影/.test(source)) return 'global'
    return ''
  }

  function semanticTextForKind(value, kind) {
    const source = cleanText(value).toLowerCase()
    if (!source) return ''
    const clauses = source.split(/[，,；;。.!?\r\n]+/).map(cleanText).filter(Boolean)
    const hasScopedClause = clauses.some((clause) => Boolean(semanticScopeKind(clause)))
    if (!hasScopedClause) return source
    let activeKind = ''
    const selected = []
    clauses.forEach((clause) => {
      const detected = semanticScopeKind(clause)
      if (detected) activeKind = detected === 'global' ? '' : detected
      if (activeKind === kind) selected.push(clause)
    })
    return selected.join('；')
  }

  function explicitFooterControlCount(source) {
    const text = cleanText(source).toLowerCase()
    const interactive = text.match(/(?:exactly|total(?:\s+of)?|共|总共|恰好)?\s*(\d{1,2})\s*(?:个|枚|项)?\s*(buttons?|icons?|actions?|按钮|图标|操作)/i)
    if (interactive) {
      return {
        count: Math.min(12, Math.max(1, Number(interactive[1]) || 0)),
        interactive: true,
      }
    }
    const total = text.match(/(?:exactly|total(?:\s+of)?|共|总共|恰好)\s*(\d{1,2})\s*(?:个|枚|项)?\s*(controls?|elements?|items?|控件|元素|项目)/i)
    if (!total) return null
    return {
      count: Math.min(12, Math.max(1, Number(total[1]) || 0)),
      interactive: false,
    }
  }

  function semanticScaffoldTokens(region, kind, semanticText = '') {
    const regionSource = regionSemanticText(region)
    const scopedSemanticText = semanticTextForKind(semanticText, kind)
    const source = `${regionSource} ${scopedSemanticText}`
    if (kind === 'header') {
      const tokens = []
      if (/\b(title|game\s*title|logo)\b|标题|游戏名|游戏名称/.test(source)) tokens.push('title')
      if (/\b(back|return|go\s*back)\b|返回|后退/.test(source)) tokens.push('back')
      if (!tokens.length) tokens.push('primary-info')
      return tokens
    }
    if (kind === 'hero') {
      const tokens = [/\b(character|person|hero|subject)\b|角色|人物|主角|主体/.test(source)
        ? 'subject'
        : 'focal-visual']
      if (/\b(win(?:ning)?\s*(?:message|notice|banner|prompt)|payout\s*(?:message|notice|banner))\b|中奖(?:提示|信息|横幅|条)|赢取(?:提示|信息)|获胜(?:提示|信息)/.test(source)) {
        tokens.push('status-banner')
      }
      return tokens
    }
    if (kind === 'footer') {
      const tokens = []
      if (/\b(balance|credit|credits)\b|余额|金币|点数/.test(source)) tokens.push('balance')
      if (/\b(bet|wager|stake)\b|投注|押注/.test(source)) tokens.push('bet')
      if (/\b(win|winning|payout)\b|赢取|中奖|获胜|奖金/.test(source)) tokens.push('win')
      if (/\b(spin|start)\b|旋转|开始/.test(source)) tokens.push('primary-action')
      const utilityActions = [
        ['utility-auto', /\b(auto|automatic|autoplay)\b|自动/],
        ['utility-speed', /\b(turbo|fast|speed|quick)\b|极速|快速|加速/],
        ['utility-recharge', /\b(recharge|top\s*up|deposit|wallet)\b|充值|充币/],
        ['utility-menu', /\b(menu|settings?)\b|菜单|设置/],
        ['utility-sound', /\b(sound|audio|music)\b|声音|音效|音乐/],
        ['utility-info', /\b(?:info|help|rules?|paytable)\s*(?:button|icon|entry|menu)\b|(?:说明|帮助|规则|赔付表)(?:按钮|图标|入口|菜单)/],
        ['utility-home', /\b(home|lobby)\b|主页|大厅/],
      ]
      utilityActions.forEach(([token, pattern]) => {
        if (pattern.test(source)) tokens.push(token)
      })
      const explicitCount = explicitFooterControlCount(source)
      if (explicitCount) {
        const existingCount = explicitCount.interactive
          ? tokens.filter((token) => token === 'primary-action' || token.startsWith('utility-')).length
          : tokens.length
        const missingCount = Math.max(0, explicitCount.count - existingCount)
        for (let index = 0; index < missingCount; index += 1) {
          tokens.push(`utility-generic-${index + 1}`)
        }
      }
      if (!tokens.length) tokens.push('controls')
      return tokens
    }
    return ['content']
  }

  function semanticGridToken(grid) {
    if (grid?.columnsOnly) return `grid-${grid.columns}-columns`
    if (grid?.rowsOnly) return `grid-${grid.rows}-rows`
    return `grid-${grid.columns}x${grid.rows}`
  }

  function semanticGridSpecification(grid) {
    if (!grid) return {}
    if (grid.columnsOnly) return { columns: grid.columns, columnsOnly: true }
    if (grid.rowsOnly) return { rows: grid.rows, rowsOnly: true }
    return { columns: grid.columns, rows: grid.rows }
  }

  function resolveSemanticScaffold(regions, options = {}) {
    const specifications = regions.map((region) => {
      const grid = options.subgridPlan?.byRegionId?.get(region.id) || null
      const kind = semanticScaffoldKind(region, options.subgridPlan)
      const tokens = kind === 'grid'
        ? [semanticGridToken(grid)]
        : semanticScaffoldTokens(region, kind, options.semanticText)
      const specification = {
        regionId: region.id,
        kind,
        tokens: Object.freeze(tokens),
        ...semanticGridSpecification(grid),
      }
      const expectedRects = Object.fromEntries(tokens
        .map((semanticToken) => [
          semanticToken,
          semanticChecklistExpectedRect(specification, region, semanticToken),
        ])
        .filter(([, bounds]) => Boolean(bounds)))
      return Object.freeze({
        ...specification,
        expectedRects: Object.freeze(expectedRects),
      })
    })
    return Object.freeze({ specifications: Object.freeze(specifications) })
  }

  function addSemanticGrid(occupancy, raster, region, grid) {
    const regionLeft = Number(region.xNorm) * raster.width
    const regionTop = Number(region.yNorm) * raster.height
    const regionWidth = Number(region.wNorm) * raster.width
    const regionHeight = Number(region.hNorm) * raster.height
    if (grid.columnsOnly) {
      const columnWidth = regionWidth / grid.columns
      for (let column = 0; column < grid.columns; column += 1) {
        addGaussian(
          occupancy,
          raster,
          regionLeft + (column + 0.5) * columnWidth,
          regionTop + regionHeight / 2,
          Math.max(4, columnWidth * 0.24),
          Math.max(4, regionHeight * 0.48),
        )
      }
      return
    }
    if (grid.rowsOnly) {
      const rowHeight = regionHeight / grid.rows
      for (let row = 0; row < grid.rows; row += 1) {
        addGaussian(
          occupancy,
          raster,
          regionLeft + regionWidth / 2,
          regionTop + (row + 0.5) * rowHeight,
          Math.max(4, regionWidth * 0.48),
          Math.max(4, rowHeight * 0.24),
        )
      }
      return
    }
    const cellWidth = regionWidth / grid.columns
    const cellHeight = regionHeight / grid.rows
    const anchorSigma = Math.max(3, Math.min(cellWidth, cellHeight) * 0.08)
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        addGaussian(
          occupancy,
          raster,
          regionLeft + (column + 0.5) * cellWidth,
          regionTop + (row + 0.5) * cellHeight,
          anchorSigma,
          anchorSigma,
          0.76,
        )
      }
    }
  }

  function createSoftSemanticScaffold(raster, regions, options = {}) {
    const background = 20
    const amplitude = 134
    const occupancy = new Float64Array(raster.width * raster.height)
    const regionById = new Map(regions.map((region) => [region.id, region]))
    const plan = resolveSemanticScaffold(regions, options)

    for (const specification of plan.specifications) {
      const region = regionById.get(specification.regionId)
      if (!region) continue
      const left = Number(region.xNorm) * raster.width
      const top = Number(region.yNorm) * raster.height
      const width = Number(region.wNorm) * raster.width
      const height = Number(region.hNorm) * raster.height
      const centerX = left + width / 2
      const centerY = top + height / 2
      addGaussian(
        occupancy,
        raster,
        centerX,
        centerY,
        Math.max(10, width * 0.48),
        Math.max(10, height * 0.48),
        specification.kind === 'generic' ? 0.34 : 0.12,
      )

      if (specification.kind === 'grid') {
        addSemanticGrid(occupancy, raster, region, specification)
        continue
      }

      if (specification.kind === 'header') {
        const hasBack = specification.tokens.includes('back')
        const titleCenterX = left + width * (hasBack ? 0.43 : 0.5)
        addGaussian(
          occupancy,
          raster,
          titleCenterX,
          top + height * 0.5,
          Math.max(8, width * 0.22),
          Math.max(4, height * 0.08),
          0.9,
        )
        if (hasBack) {
          const backCenterX = left + width * 0.89
          const backCenterY = top + height * 0.5
          const chevronHalfWidth = Math.max(5, height * 0.1)
          const chevronHalfHeight = Math.max(5, height * 0.12)
          const chevronSigma = Math.max(2.75, height * 0.035)
          addGaussian(
            occupancy,
            raster,
            backCenterX,
            backCenterY,
            Math.max(7, height * 0.38),
            Math.max(3, height * 0.08),
            0.36,
          )
          addGaussianSegment(
            occupancy,
            raster,
            backCenterX + chevronHalfWidth,
            backCenterY - chevronHalfHeight,
            backCenterX - chevronHalfWidth,
            backCenterY,
            chevronSigma,
            0.86,
          )
          addGaussianSegment(
            occupancy,
            raster,
            backCenterX - chevronHalfWidth,
            backCenterY,
            backCenterX + chevronHalfWidth,
            backCenterY + chevronHalfHeight,
            chevronSigma,
            0.86,
          )
        }
        continue
      }

      if (specification.kind === 'hero') {
        if (specification.tokens.includes('subject')) {
          addGaussian(
            occupancy,
            raster,
            centerX,
            top + height * 0.28,
            Math.max(6, width * 0.1),
            Math.max(6, height * 0.1),
            0.95,
          )
          addGaussian(
            occupancy,
            raster,
            centerX,
            top + height * 0.62,
            Math.max(10, width * 0.22),
            Math.max(10, height * 0.28),
            0.9,
          )
        } else {
          addGaussian(
            occupancy,
            raster,
            centerX,
            centerY,
            Math.max(12, width * 0.28),
            Math.max(12, height * 0.3),
            0.9,
          )
        }
        if (specification.tokens.includes('status-banner')) {
          addGaussian(
            occupancy,
            raster,
            centerX,
            top + height * 0.9,
            Math.max(8, width * 0.2),
            Math.max(4, height * 0.045),
            0.98,
          )
        }
        continue
      }

      if (specification.kind === 'footer') {
        const metrics = specification.tokens.filter((token) => ['balance', 'bet', 'win'].includes(token))
        metrics.forEach((token, index) => {
          const xRatio = metrics.length === 1
            ? 0.5
            : 0.18 + (index * 0.64 / Math.max(1, metrics.length - 1))
          addGaussian(
            occupancy,
            raster,
            left + width * xRatio,
            top + height * 0.28,
            Math.max(5, width * 0.1),
            Math.max(4, height * 0.055),
            0.82,
          )
        })
        const utilityActions = specification.tokens.filter((token) => token.startsWith('utility-'))
        utilityActions.forEach((token, index) => {
          const xRatio = utilityActions.length === 1
            ? 0.18
            : 0.1 + (index * 0.62 / Math.max(1, utilityActions.length - 1))
          addGaussian(
            occupancy,
            raster,
            left + width * xRatio,
            top + height * 0.72,
            Math.max(5, height * 0.1),
            Math.max(5, height * 0.1),
            0.86,
          )
        })
        if (specification.tokens.includes('primary-action')) {
          addGaussian(
            occupancy,
            raster,
            left + width * (utilityActions.length ? 0.9 : 0.5),
            top + height * 0.72,
            Math.max(7, height * 0.16),
            Math.max(7, height * 0.16),
            1,
          )
        }
      }
    }

    const pixels = new Uint8Array(occupancy.length)
    for (let index = 0; index < occupancy.length; index += 1) {
      pixels[index] = Math.round(background + amplitude * occupancy[index])
    }
    return { pixels, plan }
  }

  function encodePng(raster, pixels) {
    const scanlines = new Uint8Array(raster.height * (1 + raster.width * 4))
    for (let y = 0; y < raster.height; y += 1) {
      const targetOffset = y * (1 + raster.width * 4)
      scanlines[targetOffset] = 0
      scanlines.set(pixels.subarray(y * raster.width * 4, (y + 1) * raster.width * 4), targetOffset + 1)
    }
    const ihdr = new Uint8Array(13)
    ihdr.set(uint32Bytes(raster.width), 0)
    ihdr.set(uint32Bytes(raster.height), 4)
    ihdr.set([8, 6, 0, 0, 0], 8)
    return concatBytes([
      PNG_SIGNATURE,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlibStore(scanlines)),
      pngChunk('IEND', new Uint8Array(0)),
    ])
  }

  function encodeGrayscalePng(raster, pixels) {
    const scanlines = new Uint8Array(raster.height * (1 + raster.width))
    for (let y = 0; y < raster.height; y += 1) {
      const targetOffset = y * (1 + raster.width)
      scanlines[targetOffset] = 0
      scanlines.set(pixels.subarray(y * raster.width, (y + 1) * raster.width), targetOffset + 1)
    }
    const ihdr = new Uint8Array(13)
    ihdr.set(uint32Bytes(raster.width), 0)
    ihdr.set(uint32Bytes(raster.height), 4)
    ihdr.set([8, 0, 0, 0, 0], 8)
    return concatBytes([
      PNG_SIGNATURE,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlibStore(scanlines)),
      pngChunk('IEND', new Uint8Array(0)),
    ])
  }

  function semanticRepairFailureClass(review = {}) {
    const direct = cleanText(review.failureClass).toUpperCase()
    if (direct) return direct
    const codes = Array.isArray(review.failureCodes) ? review.failureCodes.join(' ') : ''
    if (/POLISH|QUALITY/.test(codes)) return 'POLISH'
    if (/LEAK/.test(codes)) return 'LEAKAGE'
    if (/STRUCTURE|LAYOUT|COUNT/.test(codes)) return 'STRUCTURE'
    if (/READAB|TEXT/.test(codes)) return 'READABILITY'
    if (/CONTENT|TARGET|THEME/.test(codes)) return 'CONTENT'
    return ''
  }
  function semanticRepairReviewText(review = {}) {
    return [review.failureCodes, review.hardFailures, review.failedChecklistTokens]
      .flatMap((value) => Array.isArray(value) ? value : [])
      .concat(review.retryPrompt, review.summary)
      .map(cleanText).filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ')
  }
  const SEMANTIC_REPAIR_ACTIONABLE_CLASSES = Object.freeze([
    'STRUCTURE',
    'CONTENT',
    'READABILITY',
    'LEAKAGE',
  ])
  const SEMANTIC_REPAIR_GENERIC_FAILURE_CLASSES = Object.freeze({
    TARGET_CONTENT_MISMATCH: 'CONTENT',
    STRUCTURE_MISSING: 'STRUCTURE',
    CORE_UI_UNREADABLE: 'READABILITY',
    REFERENCE_CONTENT_LEAKAGE: 'LEAKAGE',
    QUALITY_GATE_FAILED: 'CONTENT',
    QUALITY_POLISH_INSUFFICIENT: 'POLISH',
  })
  const SEMANTIC_REPAIR_TOKEN_PATTERNS = Object.freeze([
    ['title', /\b(title|logo|heading|wordmark)\b|标题|标志/],
    ['back', /\b(back|return|go back|navigation)\b|返回|后退/],
    ['status-banner', /\b(status banner|win(?:ning)? (?:notice|message|banner|prompt)|payout (?:notice|message|banner))\b|中奖提示|中奖横幅|获胜提示/],
    ['hero', /\b(?:hero|showcase)\s*(?:area|region|section|panel)\b|角色展示(?:区域|区)|人物展示(?:区域|区)|主体展示(?:区域|区)/],
    ['subject', /\b(character|person|subject|main character|primary subject|hero subject)\b|角色|人物|主角|主体/],
    ['focal-visual', /\b(focal visual|main visual|key visual)\b|主视觉|焦点视觉/],
    ['background', /\b(background|backdrop|environment|scenery)\b|背景|环境|场景/],
    ['grid', /\b(grid|reels?|rows?|columns?|cells?)\b|网格|转轴|行列/],
    ['balance', /\b(balance|credit)\b|余额/],
    ['bet', /\b(bet|wager|stake)\b|投注/],
    ['win', /\bwin (?:amount|field|value|metric|readout)\b|中奖金额/],
    ['primary-action', /\b(primary action|spin|start button)\b|旋转按钮|开始按钮/],
    ['utility-auto', /\b(auto|autoplay)\b|自动/],
    ['utility-speed', /\b(turbo|speed|fast)\b|极速|快速/],
    ['utility-recharge', /\b(recharge|top up|deposit)\b|充值/],
    ['utility-menu', /\b(menu|settings)\b|菜单|设置/],
    ['utility-sound', /\b(sound|audio|music)\b|声音|音效/],
    ['utility-info', /\b(info|help|rules|paytable)\b|说明|帮助|规则/],
    ['utility-home', /\b(home|lobby)\b|主页|大厅/],
  ])
  function semanticRepairNormalizedText(value) {
    return cleanText(value).toLowerCase().replace(/[_-]+/g, ' ')
  }
  function semanticRepairTokensForText(value) {
    const source = semanticRepairNormalizedText(value)
    if (!source) return []
    return SEMANTIC_REPAIR_TOKEN_PATTERNS
      .filter(([, pattern]) => pattern.test(source))
      .map(([token]) => token)
  }
  function semanticRepairFailureClassesForText(value) {
    const source = semanticRepairNormalizedText(value)
    if (!source) return []
    const classes = []
    if (/\b(?:polish|quality|finish|material|lighting|hierarchy|commercial)\b|完成度|材质|光影|层级|一致性|质量/.test(source)) {
      classes.push('POLISH')
    }
    if (/\b(?:leak(?:age)?|copied?|copying|reference identity|reference content)\b|参考(?:图)?(?:内容)?(?:泄漏|照搬|复制)|照搬|复制/.test(source)) {
      classes.push('LEAKAGE')
    }
    if (/\b(?:structure|layout|count|missing|extra|misplaced|misaligned|grid|reels?|rows?|columns?|cells?)\b|结构|布局|数量|缺失|多余|错位|网格|转轴|行列/.test(source)) {
      classes.push('STRUCTURE')
    }
    if (/\b(?:readability|unreadable|illegible|blurred?|text clarity)\b|不可读|难以辨认|无法(?:清晰)?辨认|可读性不足|模糊|(?:文字|功能)?清晰度/.test(source)) {
      classes.push('READABILITY')
    }
    if (/\b(?:target|theme|subject|character|identity|wrong|incorrect)\b|目标|主题|主体|角色|身份|错误|不符/.test(source)) {
      classes.push('CONTENT')
    }
    return [...new Set(classes)]
  }
  function semanticRepairGenericFailureClass(value) {
    const code = cleanText(value).toUpperCase().replace(/[\s-]+/g, '_')
    return SEMANTIC_REPAIR_GENERIC_FAILURE_CLASSES[code] || ''
  }
  function semanticRepairHasCompleteFailureLocalization(review, failureClass) {
    const codes = Array.isArray(review.failureCodes) ? review.failureCodes.map(cleanText).filter(Boolean) : []
    const hardFailures = Array.isArray(review.hardFailures) ? review.hardFailures.map(cleanText).filter(Boolean) : []
    const specificItems = codes.filter((code) => !semanticRepairGenericFailureClass(code))
    for (const item of [...specificItems, ...hardFailures]) {
      const classes = semanticRepairFailureClassesForText(item)
      const actionable = classes.some((value) => SEMANTIC_REPAIR_ACTIONABLE_CLASSES.includes(value))
        || (!classes.includes('POLISH') && SEMANTIC_REPAIR_ACTIONABLE_CLASSES.includes(failureClass))
      if (actionable && !semanticRepairTokensForText(item).length) return false
    }

    const requiredClasses = [...new Set(codes
      .map(semanticRepairGenericFailureClass)
      .filter((value) => SEMANTIC_REPAIR_ACTIONABLE_CLASSES.includes(value)))]
    if (!requiredClasses.length) return true
    const detailItems = [
      ...hardFailures,
      ...(Array.isArray(review.failedChecklistTokens) ? review.failedChecklistTokens : []),
      review.retryPrompt,
      review.summary,
    ].map(cleanText).filter(Boolean)
    const tokenizedDetails = detailItems.filter((item) => semanticRepairTokensForText(item).length)
    if (!tokenizedDetails.length) return false
    if (requiredClasses.length === 1) return true
    return requiredClasses.every((requiredClass) => tokenizedDetails.some((item) => (
      semanticRepairFailureClassesForText(item).includes(requiredClass)
    )))
  }
  function semanticRepairAvailableTokens(specification, region) {
    const tokens = specification.tokens.map((sourceToken) => (
      /^grid-/.test(sourceToken) ? 'grid' : sourceToken
    ))
    const role = normalizeRole(region?.role)
    const source = regionSemanticText(region)
    if (specification.kind === 'hero') tokens.push('hero', 'background')
    if (
      ['background', 'backdrop', 'environment', 'scenery'].includes(role)
      || /\b(background|backdrop|environment|scenery)\b|背景|环境|场景/.test(source)
    ) tokens.push('background')
    return [...new Set(tokens)]
  }
  function semanticRepairChecklistEntries(layoutGuide = {}) {
    const specifications = Array.isArray(layoutGuide.semanticScaffoldSpecifications)
      ? layoutGuide.semanticScaffoldSpecifications : []
    const entries = []
    specifications.slice(0, 32).forEach((specification, regionIndex) => {
      const tokens = Array.isArray(specification?.tokens) ? specification.tokens : []
      tokens.forEach((sourceToken) => {
        if (entries.length >= 48) return
        const semanticToken = cleanText(sourceToken).toLowerCase()
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(semanticToken)) return
        entries.push(Object.freeze({
          checklistToken: `region-${regionIndex + 1}:${semanticToken}`,
          semanticToken,
          repairToken: /^grid-/.test(semanticToken) ? 'grid' : semanticToken,
          specification,
        }))
      })
    })
    return Object.freeze(entries)
  }
  function semanticRepairChecklistRequests(layoutGuide, review = {}) {
    const source = Array.isArray(review.failedChecklistTokens)
      ? review.failedChecklistTokens
      : cleanText(review.failedChecklistTokens)
        ? cleanText(review.failedChecklistTokens).split(/[\n,，；;]+/)
        : []
    if (!source.length) return Object.freeze({ provided: false, valid: true, entries: Object.freeze([]) })
    const checklistByToken = new Map(
      semanticRepairChecklistEntries(layoutGuide)
        .map((entry) => [entry.checklistToken, entry]),
    )
    const requested = [...new Set(source.map(cleanText).filter(Boolean))]
    const entries = requested.map((checklistToken) => checklistByToken.get(checklistToken)).filter(Boolean)
    return Object.freeze({
      provided: true,
      valid: entries.length === requested.length,
      entries: Object.freeze(entries),
    })
  }
  function semanticRepairTokenBounds(specification, region, token) {
    const x = Number(region.xNorm)
    const y = Number(region.yNorm)
    const width = Number(region.wNorm)
    const height = Number(region.hNorm)
    const fullRegion = { xNorm: x, yNorm: y, wNorm: width, hNorm: height }
    if (['grid', 'hero', 'background', 'subject', 'focal-visual'].includes(token)) {
      return fullRegion
    }
    if (token === 'title') {
      return { xNorm: x, yNorm: y, wNorm: width, hNorm: height * 0.7 }
    }
    if (token === 'back') {
      return { xNorm: x, yNorm: y + height * 0.1, wNorm: width, hNorm: height * 0.8 }
    }
    if (token === 'status-banner') {
      return { xNorm: x, yNorm: y + height * 0.76, wNorm: width, hNorm: height * 0.22 }
    }
    const metrics = specification.tokens.filter((item) => ['balance', 'bet', 'win'].includes(item))
    if (metrics.includes(token)) {
      return { xNorm: x, yNorm: y, wNorm: width, hNorm: height * 0.46 }
    }
    const utilities = specification.tokens.filter((item) => item.startsWith('utility-'))
    if (token.startsWith('utility-') && utilities.includes(token)) {
      return { xNorm: x, yNorm: y + height * 0.52, wNorm: width, hNorm: height * 0.46 }
    }
    if (token === 'primary-action') {
      return { xNorm: x, yNorm: y + height * 0.52, wNorm: width, hNorm: height * 0.46 }
    }
    return null
  }
  function semanticChecklistExpectedRect(specification, region, semanticToken) {
    const repairToken = /^grid-/.test(semanticToken) ? 'grid' : semanticToken
    const bounds = semanticRepairTokenBounds(specification, region, repairToken)
    if (!bounds) return null
    const xNorm = clamp(Number(bounds.xNorm), 0, 1)
    const yNorm = clamp(Number(bounds.yNorm), 0, 1)
    const right = clamp(xNorm + Number(bounds.wNorm), xNorm, 1)
    const bottom = clamp(yNorm + Number(bounds.hNorm), yNorm, 1)
    if (right <= xNorm || bottom <= yNorm) return null
    const rounded = (value) => Math.round(value * 10000) / 10000
    return Object.freeze({
      xNorm: rounded(xNorm),
      yNorm: rounded(yNorm),
      wNorm: rounded(right - xNorm),
      hNorm: rounded(bottom - yNorm),
    })
  }
  function addSemanticRepairRect(pixels, raster, bounds) {
    const expansionX = bounds.wNorm * raster.width * 0.1
    const expansionY = bounds.hNorm * raster.height * 0.1
    const left = bounds.xNorm * raster.width - expansionX
    const top = bounds.yNorm * raster.height - expansionY
    const right = (bounds.xNorm + bounds.wNorm) * raster.width + expansionX
    const bottom = (bounds.yNorm + bounds.hNorm) * raster.height + expansionY
    const feather = clamp(Math.round(Math.max(raster.width, raster.height) * 0.025), 8, 16)
    const minimumX = clamp(Math.floor(left - feather), 0, raster.width - 1)
    const maximumX = clamp(Math.ceil(right + feather), 0, raster.width - 1)
    const minimumY = clamp(Math.floor(top - feather), 0, raster.height - 1)
    const maximumY = clamp(Math.ceil(bottom + feather), 0, raster.height - 1)
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const distance = Math.hypot(Math.max(left - x, 0, x - right), Math.max(top - y, 0, y - bottom))
        if (distance >= feather) continue
        const ratio = clamp(distance / feather, 0, 1)
        const value = Math.round(255 * (1 - ratio * ratio * (3 - 2 * ratio)))
        const index = y * raster.width + x
        if (value > pixels[index]) pixels[index] = value
      }
    }
  }
  function createSemanticRepairMask(layoutGuide = {}, options = {}) {
    const review = options.review || {}
    const failureClass = semanticRepairFailureClass(review)
    if (!['STRUCTURE', 'CONTENT', 'READABILITY', 'LEAKAGE'].includes(failureClass)) return null
    const text = semanticRepairReviewText(review)
    if (!text) return null
    const checklistRequests = semanticRepairChecklistRequests(layoutGuide, review)
    if (!checklistRequests.valid) return null
    const failureCodes = Array.isArray(review.failureCodes)
      ? review.failureCodes.map(cleanText).filter(Boolean)
      : []
    const checklistIndependentFailureClasses = failureCodes
      .map(semanticRepairGenericFailureClass)
      .filter((value) => ['CONTENT', 'LEAKAGE'].includes(value))
    if (checklistRequests.provided && checklistIndependentFailureClasses.length) return null
    const exactChecklistLocalizesGenericStructureFailure = Boolean(
      checklistRequests.provided
      && checklistRequests.entries.length
      && failureClass === 'STRUCTURE'
      && failureCodes.length
      && failureCodes.every((code) => semanticRepairGenericFailureClass(code) === 'STRUCTURE'),
    )
    if (
      !exactChecklistLocalizesGenericStructureFailure
      && !semanticRepairHasCompleteFailureLocalization(review, failureClass)
    ) return null
    const requested = checklistRequests.provided
      ? new Set()
      : new Set(semanticRepairTokensForText(text))
    if (!checklistRequests.provided && !requested.size) return null
    const semantic = layoutGuide.semantic
    const regions = Array.isArray(semantic?.regions) ? semantic.regions : []
    const specifications = Array.isArray(layoutGuide.semanticScaffoldSpecifications)
      ? layoutGuide.semanticScaffoldSpecifications : []
    const regionById = new Map(regions.map((region) => [region.id, region]))
    const raster = rasterSize(semantic?.canvas || layoutGuide, options.maxEdge || Math.max(layoutGuide.rasterWidth || 0, layoutGuide.rasterHeight || 0))
    const pixels = new Uint8Array(raster.width * raster.height)
    const selectedTokens = []
    const selectedChecklistTokens = []
    if (checklistRequests.provided) {
      checklistRequests.entries.forEach((entry) => {
        const region = regionById.get(entry.specification.regionId)
        if (!region) return
        const availableTokens = semanticRepairAvailableTokens(entry.specification, region)
        if (!availableTokens.includes(entry.repairToken)) return
        const bounds = semanticRepairTokenBounds(entry.specification, region, entry.repairToken)
        if (!bounds) return
        addSemanticRepairRect(pixels, raster, bounds)
        if (!selectedTokens.includes(entry.repairToken)) selectedTokens.push(entry.repairToken)
        selectedChecklistTokens.push(entry.checklistToken)
      })
    } else {
      specifications.forEach((specification) => {
        const region = regionById.get(specification.regionId)
        if (!region) return
        semanticRepairAvailableTokens(specification, region).forEach((token) => {
          if (!requested.has(token) || selectedTokens.includes(token)) return
          const bounds = semanticRepairTokenBounds(specification, region, token)
          if (!bounds) return
          addSemanticRepairRect(pixels, raster, bounds)
          selectedTokens.push(token)
        })
      })
    }
    if (!selectedTokens.length) return null
    if (
      checklistRequests.provided
      ? selectedChecklistTokens.length !== checklistRequests.entries.length
      : [...requested].some((token) => !selectedTokens.includes(token))
    ) return null
    const coverageRatio = pixels.reduce((count, value) => count + (value > 0 ? 1 : 0), 0) / pixels.length
    if (coverageRatio > 0.55) return null
    const png = encodeGrayscalePng(raster, pixels)
    return Object.freeze({
      name: cleanText(options.name) || 'ui_semantic_repair_mask.png',
      dataUrl: `data:image/png;base64,${bytesToBase64(png)}`,
      width: semantic.canvas.width, height: semantic.canvas.height,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
      visualEncoding: SEMANTIC_REPAIR_MASK_VISUAL_ENCODING,
      selectedTokens: Object.freeze(selectedTokens),
      selectedChecklistTokens: Object.freeze(selectedChecklistTokens),
      coverageRatio: Number(coverageRatio.toFixed(6)),
    })
  }

  function createCleanLayoutGuide(source = {}, options = {}) {
    const semantic = source?.kind === 'ui-layout-semantic'
      ? compileSemanticLayout(source, options)
      : compileSemanticLayout(source, options)
    const raster = rasterSize(semantic.canvas, options.maxEdge || options.maxGuideSize)
    const requestedVisualEncoding = cleanText(options.visualEncoding)
    const visualEncoding = requestedVisualEncoding === SOFT_UI_SEMANTIC_SCAFFOLD_VISUAL_ENCODING
      ? SOFT_UI_SEMANTIC_SCAFFOLD_VISUAL_ENCODING
      : requestedVisualEncoding === SOFT_OCCUPANCY_VISUAL_ENCODING
        ? SOFT_OCCUPANCY_VISUAL_ENCODING
        : FILLED_REGIONS_VISUAL_ENCODING
    const regions = semantic.regions
      .filter((region) => region.hasGeometry)
      .sort((left, right) => left.zIndex - right.zIndex)
    const subgridPlan = resolveSemanticSubgrids(regions, {
      semanticSubgrid: options.semanticSubgrid === true,
      semanticText: options.semanticText,
    })
    let png
    let semanticScaffoldPlan = null
    if (visualEncoding === SOFT_OCCUPANCY_VISUAL_ENCODING) {
      png = encodeGrayscalePng(raster, createSoftOccupancyHeatmap(raster, regions, {
        subgridPlan,
      }))
    } else if (visualEncoding === SOFT_UI_SEMANTIC_SCAFFOLD_VISUAL_ENCODING) {
      const scaffold = createSoftSemanticScaffold(raster, regions, {
        subgridPlan,
        semanticText: options.semanticText,
      })
      semanticScaffoldPlan = scaffold.plan
      png = encodeGrayscalePng(raster, scaffold.pixels)
    } else {
      const pixels = new Uint8Array(raster.width * raster.height * 4)
      for (let offset = 0; offset < pixels.length; offset += 4) {
        pixels[offset] = 18
        pixels[offset + 1] = 22
        pixels[offset + 2] = 28
        pixels[offset + 3] = 255
      }
      regions.forEach((region, index) => fillRoundedRect(pixels, raster, region, regionColor(region, index)))
      png = encodePng(raster, pixels)
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'ui-layout-guide',
      role: 'ui_layout',
      source: 'semantic-layout-compiler',
      clean: true,
      editorSnapshot: false,
      name: cleanText(options.name) || 'ui_layout_guide.png',
      dataUrl: `data:image/png;base64,${bytesToBase64(png)}`,
      width: semantic.canvas.width,
      height: semantic.canvas.height,
      rasterWidth: raster.width,
      rasterHeight: raster.height,
      visualEncoding,
      semanticScaffold: visualEncoding === SOFT_UI_SEMANTIC_SCAFFOLD_VISUAL_ENCODING,
      visualPrimitive: visualEncoding === SOFT_UI_SEMANTIC_SCAFFOLD_VISUAL_ENCODING
        ? 'gaussian-only'
        : '',
      semanticSubgrid: options.semanticSubgrid === true,
      semanticSubgridSpecifications: Object.freeze(subgridPlan.specifications.map((item) => Object.freeze({ ...item }))),
      semanticScaffoldSpecifications: semanticScaffoldPlan
        ? semanticScaffoldPlan.specifications
        : Object.freeze([]),
      excludedArtifacts: Object.freeze(['text', 'labels', 'strokes', 'selection', 'ports', 'editor-chrome']),
      semantic,
    }
  }

  function isCleanLayoutGuide(value) {
    return Boolean(
      value
      && value.kind === 'ui-layout-guide'
      && value.role === 'ui_layout'
      && value.clean === true
      && value.editorSnapshot === false
      && /^data:image\/png;base64,/i.test(cleanText(value.dataUrl)),
    )
  }

  return Object.freeze({
    SCHEMA_VERSION,
    extractBlocks,
    compileSemanticLayout,
    compileSemanticPrompt,
    semanticGridFromText,
    resolveSemanticSubgrids,
    resolveSemanticScaffold,
    createSemanticRepairMask,
    createCleanLayoutGuide,
    isCleanLayoutGuide,
  })
})

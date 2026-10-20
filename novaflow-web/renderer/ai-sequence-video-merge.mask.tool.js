(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceVideoMergeMaskTool = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const DEFAULT_TILE_SIZE = 64
  const DEFAULT_MAX_HISTORY_ENTRIES = 100
  const DEFAULT_MAX_HISTORY_BYTES = 64 * 1024 * 1024

  function positiveInteger(value, fallback, label) {
    const normalized = value === undefined ? fallback : Number(value)
    if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new RangeError(`${label} must be a positive integer`)
    return normalized
  }

  function finiteNumber(value, label) {
    const normalized = Number(value)
    if (!Number.isFinite(normalized)) throw new TypeError(`${label} must be finite`)
    return normalized
  }

  function normalizeCoverage(input, pixelCount) {
    if (input === undefined || input === null) {
      const initial = new Uint8ClampedArray(pixelCount)
      initial.fill(255)
      return initial
    }
    if (!ArrayBuffer.isView(input) && !Array.isArray(input)) throw new TypeError('coverage must be an array-like value')
    if (input.length !== pixelCount) throw new RangeError('coverage length must match width * height')
    return Uint8ClampedArray.from(input)
  }

  function createFalloffTable(radiusPx, featherPx, mode) {
    if (featherPx <= 0) return null
    const size = 4096
    const table = new Uint8Array(size)
    const innerSquared = radiusPx * radiusPx
    const outerRadius = radiusPx + featherPx
    const squaredRange = Math.max(1e-9, outerRadius * outerRadius - innerSquared)
    for (let index = 0; index < size; index += 1) {
      const squaredDistance = innerSquared + squaredRange * index / (size - 1)
      const strength = root.NovaFlowSoftBrush.strength(Math.sqrt(squaredDistance), radiusPx, outerRadius)
      const strengthByte = root.NovaFlowSoftBrush.alphaByte(strength)
      table[index] = mode === 'erase' ? 255 - strengthByte : strengthByte
    }
    return table
  }

  function createSurface(options = {}) {
    const width = positiveInteger(options.width, undefined, 'width')
    const height = positiveInteger(options.height, undefined, 'height')
    const tileSize = positiveInteger(options.tileSize, DEFAULT_TILE_SIZE, 'tileSize')
    const maxHistoryEntries = positiveInteger(options.maxHistoryEntries, DEFAULT_MAX_HISTORY_ENTRIES, 'maxHistoryEntries')
    const maxHistoryBytes = positiveInteger(options.maxHistoryBytes, DEFAULT_MAX_HISTORY_BYTES, 'maxHistoryBytes')
    const pixelCount = width * height
    if (!Number.isSafeInteger(pixelCount)) throw new RangeError('surface dimensions are too large')

    let coverage = normalizeCoverage(options.coverage, pixelCount)
    let activeStroke = null
    let undoStack = []
    let redoStack = []
    let historyBytes = 0
    let revision = 0
    let destroyed = false
    let cachedCanvas = null
    let cachedCanvasRevision = -1
    const dirtyTiles = new Map()

    function assertAlive() {
      if (destroyed) throw new Error('mask surface has been destroyed')
    }

    function assertIdle(operation) {
      if (activeStroke) throw new Error(`${operation} is unavailable during an active stroke`)
    }

    function tileBounds(tileX, tileY) {
      const x = tileX * tileSize
      const y = tileY * tileSize
      return { x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) }
    }

    function copyRegion(bounds) {
      const output = new Uint8Array(bounds.width * bounds.height)
      for (let row = 0; row < bounds.height; row += 1) {
        const sourceStart = (bounds.y + row) * width + bounds.x
        output.set(coverage.subarray(sourceStart, sourceStart + bounds.width), row * bounds.width)
      }
      return output
    }

    function writeRegion(bounds, bytes) {
      for (let row = 0; row < bounds.height; row += 1) {
        const sourceStart = row * bounds.width
        const targetStart = (bounds.y + row) * width + bounds.x
        coverage.set(bytes.subarray(sourceStart, sourceStart + bounds.width), targetStart)
      }
    }

    function captureTilesForBounds(stroke, x0, y0, x1, y1) {
      if (x1 <= x0 || y1 <= y0) return
      const firstTileX = Math.floor(x0 / tileSize)
      const lastTileX = Math.floor((x1 - 1) / tileSize)
      const firstTileY = Math.floor(y0 / tileSize)
      const lastTileY = Math.floor((y1 - 1) / tileSize)
      for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
        for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
          const key = `${tileX}:${tileY}`
          if (stroke.tiles.has(key)) continue
          const bounds = tileBounds(tileX, tileY)
          stroke.tiles.set(key, { ...bounds, before: copyRegion(bounds) })
        }
      }
    }

    function markDirtyBounds(x0, y0, x1, y1) {
      const left = Math.max(0, Math.floor(x0))
      const top = Math.max(0, Math.floor(y0))
      const right = Math.min(width, Math.ceil(x1))
      const bottom = Math.min(height, Math.ceil(y1))
      if (right <= left || bottom <= top) return
      const firstTileX = Math.floor(left / tileSize)
      const lastTileX = Math.floor((right - 1) / tileSize)
      const firstTileY = Math.floor(top / tileSize)
      const lastTileY = Math.floor((bottom - 1) / tileSize)
      for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
        for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
          const key = `${tileX}:${tileY}`
          if (!dirtyTiles.has(key)) dirtyTiles.set(key, tileBounds(tileX, tileY))
        }
      }
    }

    function paintPoint(stroke, centerX, centerY) {
      const outerRadius = stroke.radiusPx + stroke.featherPx
      const x0 = Math.max(0, Math.floor(centerX - outerRadius))
      const y0 = Math.max(0, Math.floor(centerY - outerRadius))
      const x1 = Math.min(width, Math.ceil(centerX + outerRadius + 1))
      const y1 = Math.min(height, Math.ceil(centerY + outerRadius + 1))
      captureTilesForBounds(stroke, x0, y0, x1, y1)
      const radiusSquared = stroke.radiusPx * stroke.radiusPx
      const outerSquared = outerRadius * outerRadius
      const falloffTable = stroke.falloffTable
      const lastFalloffIndex = falloffTable ? falloffTable.length - 1 : 0
      const falloffScale = falloffTable
        ? lastFalloffIndex / Math.max(1e-9, outerSquared - radiusSquared)
        : 0
      const isErase = stroke.mode === 'erase'
      const coreTarget = isErase ? 0 : 255
      let changed = false
      for (let y = y0; y < y1; y += 1) {
        const deltaY = y + 0.5 - centerY
        const verticalSquared = deltaY * deltaY
        if (verticalSquared > outerSquared) continue
        const halfSpan = Math.sqrt(Math.max(0, outerSquared - verticalSquared))
        const rowStart = Math.max(x0, Math.ceil(centerX - halfSpan - 0.5))
        const rowEnd = Math.min(x1, Math.floor(centerX + halfSpan - 0.5) + 1)
        let deltaX = rowStart + 0.5 - centerX
        let index = y * width + rowStart
        for (let x = rowStart; x < rowEnd; x += 1, index += 1, deltaX += 1) {
          const distanceSquared = verticalSquared + deltaX * deltaX
          let falloffIndex = 0
          if (distanceSquared > radiusSquared) {
            falloffIndex = ((distanceSquared - radiusSquared) * falloffScale) | 0
            if (falloffIndex > lastFalloffIndex) falloffIndex = lastFalloffIndex
          }
          const target = distanceSquared <= radiusSquared ? coreTarget : falloffTable[falloffIndex]
          const previous = coverage[index]
          const opacity = (isErase ? 255 - target : target) / 255
          const exact=isErase ? previous*(1-opacity) : previous+(255-previous)*opacity
          const next = Math.round(exact)
          if (next===previous) continue
          coverage[index] = next
          changed = true
        }
      }
      stroke.modified = stroke.modified || changed
      if (changed) markDirtyBounds(x0, y0, x1, y1)
      return changed
    }

    function paintSegment(stroke, startX, startY, endX, endY) {
      const radius=stroke.radiusPx+stroke.featherPx
      const points=root.NovaFlowSoftBrush.sampleStroke(stroke.samples || (stroke.samples={}),startX,startY,endX,endY,radius)
      let changed=false
      for (const point of points) changed=paintPoint(stroke,point.x,point.y)||changed
      return changed
    }

    function clearRedo() {
      for (const entry of redoStack) historyBytes -= entry.bytes
      redoStack = []
    }

    function pushHistory(entry) {
      clearRedo()
      if (entry.bytes > maxHistoryBytes) {
        undoStack = []
        historyBytes = 0
        return false
      }
      undoStack.push(entry)
      historyBytes += entry.bytes
      while (undoStack.length > maxHistoryEntries || historyBytes > maxHistoryBytes) {
        const removed = undoStack.shift()
        historyBytes -= removed.bytes
      }
      return true
    }

    function finalizeTiles(tileMap) {
      const tiles = []
      let bytes = 0
      for (const tile of tileMap.values()) {
        const after = copyRegion(tile)
        let differs = false
        for (let index = 0; index < after.length; index += 1) {
          if (after[index] !== tile.before[index]) { differs = true; break }
        }
        if (!differs) continue
        tiles.push({ x: tile.x, y: tile.y, width: tile.width, height: tile.height, before: tile.before, after })
        bytes += tile.before.byteLength + after.byteLength
      }
      return { tiles, bytes }
    }

    function beginStroke(input = {}) {
      assertAlive()
      assertIdle('beginStroke')
      const mode = input.mode === 'erase' || input.mode === 'restore' ? input.mode : ''
      if (!mode) throw new TypeError('stroke mode must be erase or restore')
      const radiusPx = finiteNumber(input.radiusPx, 'radiusPx')
      const featherPx = finiteNumber(input.featherPx ?? 0, 'featherPx')
      if (radiusPx <= 0) throw new RangeError('radiusPx must be greater than zero')
      if (featherPx < 0) throw new RangeError('featherPx cannot be negative')
      const x = finiteNumber(input.x, 'x')
      const y = finiteNumber(input.y, 'y')
      const maximumRadius = Math.hypot(width, height)
      const brushRadius = Math.min(radiusPx, maximumRadius)
      const softWidth = Math.min(featherPx, Math.max(0, maximumRadius - brushRadius))
      const effectiveRadius = brushRadius
      const effectiveFeather = softWidth
      activeStroke = {
        mode,
        radiusPx: effectiveRadius,
        featherPx: effectiveFeather,
        falloffTable: createFalloffTable(effectiveRadius, effectiveFeather, mode),
        lastX: x,
        lastY: y,
        tiles: new Map(),
        modified: false,
      }
      if (paintSegment(activeStroke, x, y, x, y)) revision += 1
      return true
    }

    function extendStroke(input = {}) {
      assertAlive()
      if (!activeStroke) throw new Error('extendStroke requires an active stroke')
      const x = finiteNumber(input.x, 'x')
      const y = finiteNumber(input.y, 'y')
      const changed = paintSegment(activeStroke, activeStroke.lastX, activeStroke.lastY, x, y)
      activeStroke.lastX = x
      activeStroke.lastY = y
      if (changed) revision += 1
      return changed
    }

    function endStroke() {
      assertAlive()
      if (!activeStroke) return false
      const stroke = activeStroke
      activeStroke = null
      if (!stroke.modified) return false
      const entry = finalizeTiles(stroke.tiles)
      if (!entry.tiles.length) return false
      pushHistory(entry)
      return true
    }

    function applyHistoryEntry(entry, field) {
      for (const tile of entry.tiles) {
        writeRegion(tile, tile[field])
        markDirtyBounds(tile.x, tile.y, tile.x + tile.width, tile.y + tile.height)
      }
      revision += 1
    }

    function undo() {
      assertAlive()
      assertIdle('undo')
      const entry = undoStack.pop()
      if (!entry) return false
      applyHistoryEntry(entry, 'before')
      redoStack.push(entry)
      return true
    }

    function redo() {
      assertAlive()
      assertIdle('redo')
      const entry = redoStack.pop()
      if (!entry) return false
      applyHistoryEntry(entry, 'after')
      undoStack.push(entry)
      return true
    }

    function canUndo() { return !destroyed && !activeStroke && undoStack.length > 0 }
    function canRedo() { return !destroyed && !activeStroke && redoStack.length > 0 }

    function clear() {
      assertAlive()
      assertIdle('clear')
      const tiles = new Map()
      for (let tileY = 0; tileY < Math.ceil(height / tileSize); tileY += 1) {
        for (let tileX = 0; tileX < Math.ceil(width / tileSize); tileX += 1) {
          const bounds = tileBounds(tileX, tileY)
          const before = copyRegion(bounds)
          if (before.every((value) => value === 255)) continue
          tiles.set(`${tileX}:${tileY}`, { ...bounds, before })
        }
      }
      if (!tiles.size) return false
      coverage.fill(255)
      for (const tile of tiles.values()) markDirtyBounds(tile.x, tile.y, tile.x + tile.width, tile.y + tile.height)
      revision += 1
      pushHistory(finalizeTiles(tiles))
      return true
    }

    function reset(nextCoverage) {
      assertAlive()
      activeStroke = null
      coverage = normalizeCoverage(nextCoverage, pixelCount)
      undoStack = []
      redoStack = []
      historyBytes = 0
      markDirtyBounds(0, 0, width, height)
      revision += 1
      return true
    }

    function copyCoverage(target) {
      assertAlive()
      if (target !== undefined) {
        if (!ArrayBuffer.isView(target) || target.length !== pixelCount || typeof target.set !== 'function') {
          throw new RangeError('target must be a writable typed array matching width * height')
        }
        target.set(coverage)
        return target
      }
      return new Uint8ClampedArray(coverage)
    }

    function sample(x, y) {
      assertAlive()
      const pixelX = Math.floor(finiteNumber(x, 'x'))
      const pixelY = Math.floor(finiteNumber(y, 'y'))
      if (pixelX < 0 || pixelY < 0 || pixelX >= width || pixelY >= height) return 0
      return coverage[pixelY * width + pixelX]
    }

    function rgbaBytes() {
      const data = new Uint8ClampedArray(pixelCount * 4)
      for (let index = 0; index < pixelCount; index += 1) {
        const offset = index * 4
        data[offset] = 255
        data[offset + 1] = 255
        data[offset + 2] = 255
        data[offset + 3] = coverage[index]
      }
      return data
    }

    function rgbaBytesForBounds(bounds) {
      const data = new Uint8ClampedArray(bounds.width * bounds.height * 4)
      for (let row = 0; row < bounds.height; row += 1) {
        const sourceStart = (bounds.y + row) * width + bounds.x
        for (let column = 0; column < bounds.width; column += 1) {
          const offset = (row * bounds.width + column) * 4
          data[offset] = 255
          data[offset + 1] = 255
          data[offset + 2] = 255
          data[offset + 3] = coverage[sourceStart + column]
        }
      }
      return data
    }

    function toRgbaImageData() {
      assertAlive()
      const data = rgbaBytes()
      if (root && typeof root.ImageData === 'function') return new root.ImageData(data, width, height)
      return { width, height, data }
    }

    function putImageData(target, dx = 0, dy = 0) {
      assertAlive()
      const context = target && typeof target.getContext === 'function' ? target.getContext('2d') : target
      if (!context || typeof context.putImageData !== 'function') throw new TypeError('a 2D canvas context or canvas is required')
      let imageData
      if (typeof context.createImageData === 'function') {
        imageData = context.createImageData(width, height)
        imageData.data.set(rgbaBytes())
      } else imageData = toRgbaImageData()
      context.putImageData(imageData, Number(dx) || 0, Number(dy) || 0)
      return imageData
    }

    function putCoverageBounds(target, bounds) {
      const context = target && typeof target.getContext === 'function' ? target.getContext('2d') : target
      if (!context || typeof context.putImageData !== 'function') throw new TypeError('a 2D canvas context or canvas is required')
      let imageData
      if (typeof context.createImageData === 'function') {
        imageData = context.createImageData(bounds.width, bounds.height)
        imageData.data.set(rgbaBytesForBounds(bounds))
      } else {
        const bytes = rgbaBytesForBounds(bounds)
        imageData = root && typeof root.ImageData === 'function'
          ? new root.ImageData(bytes, bounds.width, bounds.height)
          : { width: bounds.width, height: bounds.height, data: bytes }
      }
      context.putImageData(imageData, bounds.x, bounds.y)
    }

    function createCanvas() {
      if (root && typeof root.OffscreenCanvas === 'function') return new root.OffscreenCanvas(width, height)
      if (root?.document && typeof root.document.createElement === 'function') {
        const canvas = root.document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        return canvas
      }
      return null
    }

    function getCanvas(targetCanvas) {
      assertAlive()
      const canvas = targetCanvas || cachedCanvas || createCanvas()
      if (!canvas) return null
      const resized = canvas.width !== width || canvas.height !== height
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      const fullRefresh = Boolean(targetCanvas || canvas !== cachedCanvas || resized || cachedCanvasRevision < 0)
      if (fullRefresh) {
        putImageData(canvas)
      } else if (cachedCanvasRevision !== revision) {
        if (dirtyTiles.size) dirtyTiles.forEach(function (bounds) { putCoverageBounds(canvas, bounds) })
        else putImageData(canvas)
      }
      if (!targetCanvas || canvas === cachedCanvas) {
        cachedCanvas = canvas
        cachedCanvasRevision = revision
        dirtyTiles.clear()
      }
      return canvas
    }

    function snapshot() {
      assertAlive()
      return Object.freeze({ schemaVersion: 1, kind: 'global-coverage', width, height, revision, coverage: copyCoverage() })
    }

    function debugState() {
      return Object.freeze({
        width,
        height,
        tileSize,
        maxHistoryEntries,
        maxHistoryBytes,
        undoEntries: undoStack.length,
        redoEntries: redoStack.length,
        historyEntries: undoStack.length + redoStack.length,
        historyBytes,
        revision,
        strokeActive: !!activeStroke,
        destroyed,
      })
    }

    function destroy() {
      if (destroyed) return false
      destroyed = true
      activeStroke = null
      undoStack = []
      redoStack = []
      historyBytes = 0
      coverage = null
      cachedCanvas = null
      cachedCanvasRevision = -1
      dirtyTiles.clear()
      return true
    }

    return Object.freeze({
      width,
      height,
      beginStroke,
      extendStroke,
      endStroke,
      undo,
      redo,
      canUndo,
      canRedo,
      clear,
      reset,
      getCoverage: copyCoverage,
      copyCoverage,
      getCanvas,
      putImageData,
      toRgbaImageData,
      sample,
      snapshot,
      debugState,
      destroy,
    })
  }

  return Object.freeze({
    version: '20260805-global-coverage-1',
    DEFAULT_TILE_SIZE,
    DEFAULT_MAX_HISTORY_ENTRIES,
    DEFAULT_MAX_HISTORY_BYTES,
    createSurface,
  })
})

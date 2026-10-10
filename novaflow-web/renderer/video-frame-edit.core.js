// 帧编辑 model: the order of a clip's frames and the selection the operations act on.
//
// The clip's decoded frames never move; the model keeps an `order` of source
// frame indices (0..frameCount-1, each may appear any number of times or not at
// all) and a selection of positions in that order. Every operation is a pure
// step on {order, selection} with an undo stack, so the UI (video-frame-edit.tool.js)
// only renders it and the encoder writes the frames in `order`.
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowVideoFrameEditCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MAX_UNDO = 200

  function uniqueSorted(values) {
    return Array.from(new Set(values.map((value) => Math.trunc(Number(value))).filter((value) => Number.isInteger(value) && value >= 0))).sort((a, b) => a - b)
  }

  function createModel(frameCount) {
    const total = Math.max(0, Math.trunc(Number(frameCount) || 0))
    const initial = Array.from({ length: total }, (_, index) => index)
    let order = initial.slice()
    let selection = total ? [0] : []
    const undo = []
    const redo = []

    const snapshot = () => ({ order: order.slice(), selection: selection.slice() })
    const restore = (state) => { order = state.order.slice(); selection = state.selection.slice() }
    const clampSelection = () => { selection = uniqueSorted(selection).filter((position) => position < order.length) }
    const isContiguous = () => selection.every((position, index) => index === 0 || position === selection[index - 1] + 1)

    function commit(mutate) {
      if (!selection.length) return false
      const before = snapshot()
      const changed = mutate() !== false
      if (!changed) { restore(before); return false }
      clampSelection()
      undo.push(before)
      if (undo.length > MAX_UNDO) undo.shift()
      redo.length = 0
      return true
    }

    const model = {
      get frameCount() { return total },
      get length() { return order.length },
      get order() { return order.slice() },
      get selection() { return selection.slice() },
      get selectionContiguous() { return selection.length > 0 && isContiguous() },
      get canUndo() { return undo.length > 0 },
      get canRedo() { return redo.length > 0 },
      get dirty() { return order.length !== initial.length || order.some((value, index) => value !== initial[index]) },
      sourceAt(position) { return order[position] },
      isSelected(position) { return selection.includes(position) },

      select(positions) { selection = positions == null ? [] : uniqueSorted([].concat(positions)); clampSelection(); return model.selection },
      selectRange(from, to) {
        const a = Math.max(0, Math.min(Math.trunc(from), Math.trunc(to)))
        const b = Math.min(order.length - 1, Math.max(Math.trunc(from), Math.trunc(to)))
        selection = a <= b ? Array.from({ length: b - a + 1 }, (_, index) => a + index) : []
        return model.selection
      },
      toggle(position) {
        const value = Math.trunc(position)
        if (value < 0 || value >= order.length) return model.selection
        selection = selection.includes(value) ? selection.filter((item) => item !== value) : uniqueSorted([...selection, value])
        return model.selection
      },
      selectAll() { selection = order.map((_, index) => index); return model.selection },

      // 删除: the selected frames leave the clip; the frame after the gap becomes current.
      remove() {
        return commit(() => {
          if (selection.length >= order.length) return false
          const first = selection[0]
          const drop = new Set(selection)
          order = order.filter((_, index) => !drop.has(index))
          selection = [Math.min(first, order.length - 1)]
        })
      },
      // 复制插帧: a copy of the selected frames goes in right after the last selected one.
      duplicate() {
        return commit(() => {
          const copy = selection.map((position) => order[position])
          const at = selection[selection.length - 1] + 1
          order.splice(at, 0, ...copy)
          selection = copy.map((_, index) => at + index)
        })
      },
      // Ctrl+C / Ctrl+V: the copied frames (their source frames) go in right after the
      // last selected one and become the selection.
      copySelection() { return selection.map((position) => order[position]) },
      paste(sources) {
        const frames = [].concat(sources || []).map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value < total)
        if (!frames.length) return false
        return commit(() => {
          const at = selection[selection.length - 1] + 1
          order.splice(at, 0, ...frames)
          selection = frames.map((_, index) => at + index)
        })
      },
      // 左移 / 右移: each selected frame swaps with its neighbour, the block keeps its shape.
      move(offset) {
        const step = Math.sign(Math.trunc(Number(offset) || 0))
        if (!step) return false
        return commit(() => {
          if (step < 0 && selection[0] === 0) return false
          if (step > 0 && selection[selection.length - 1] === order.length - 1) return false
          const positions = step < 0 ? selection : selection.slice().reverse()
          for (const position of positions) {
            const target = position + step
            const value = order[position]
            order[position] = order[target]
            order[target] = value
          }
          selection = selection.map((position) => position + step)
        })
      },
      // 倒放: the selected frames run backwards in place.
      reverse() {
        return commit(() => {
          if (selection.length < 2) return false
          const values = selection.map((position) => order[position]).reverse()
          selection.forEach((position, index) => { order[position] = values[index] })
        })
      },
      // 镜像: after the selected frames comes the same run played back, without repeating the turning frame.
      mirror() {
        return commit(() => {
          if (selection.length < 2) return false
          const values = selection.map((position) => order[position])
          const back = values.slice(0, -1).reverse()
          const at = selection[selection.length - 1] + 1
          order.splice(at, 0, ...back)
          selection = back.map((_, index) => at + index)
        })
      },

      undo() {
        const state = undo.pop()
        if (!state) return false
        redo.push(snapshot())
        restore(state)
        clampSelection()
        return true
      },
      redo() {
        const state = redo.pop()
        if (!state) return false
        undo.push(snapshot())
        restore(state)
        clampSelection()
        return true
      },
      // 只保留选中: everything outside the selection leaves the clip.
      keepSelection() {
        return commit(() => {
          if (selection.length >= order.length) return false
          order = selection.map((position) => order[position])
          selection = order.map((_, index) => index)
        })
      },
      reset() {
        if (!model.dirty) return false
        undo.push(snapshot())
        redo.length = 0
        order = initial.slice()
        selection = total ? [0] : []
        return true
      }
    }
    return model
  }

  // The output name: the source stem plus _edit (ASCII, as the shared pool
  // refuses upload names that do not start with a letter or digit), the
  // extension by alpha.
  function sourceStem(sourceName) {
    const stem = String(sourceName || '').replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'video'
    return stem.replace(/_edit(?:_\d+)?$/, '')
  }
  function outputFileName(sourceName, alpha) {
    return `${sourceStem(sourceName)}_edit.${alpha ? 'webm' : 'mp4'}`
  }
  // 保存选中帧: one PNG per selected position, named by its place in the clip.
  function frameFileName(sourceName, position) {
    return `${sourceStem(sourceName)}_frame_${String(Math.max(0, Math.trunc(Number(position) || 0)) + 1).padStart(3, '0')}.png`
  }

  // 找循环: the segments of the clip that play back as a seamless loop.
  //
  // `signatures[source]` is a small grayscale picture of each source frame (the
  // tool draws its thumbnails at 32×32); `order` is the clip's current frame order.
  // A segment start..end loops well when the frame after `end` looks like `start`
  // (the seam) and the one after that like `start + 1` (so the motion carries on at
  // the same pace). Candidates are scored by that seam difference in percent of
  // full scale, a still segment (no motion inside) is skipped, and near-duplicates
  // of a better candidate are dropped.
  function findLoops(signatures, order, options = {}) {
    const minLength = Math.max(2, Math.trunc(Number(options.minLength) || 8))
    const maxCandidates = Math.max(1, Math.trunc(Number(options.maxCandidates) || 6))
    const frames = Array.isArray(order) ? order.map((value) => signatures[value]) : signatures.slice()
    const n = frames.length
    if (n < minLength + 2 || !frames.every((frame) => frame && frame.length === frames[0].length)) return []
    const size = frames[0].length
    const diff = (a, b) => {
      let total = 0
      for (let index = 0; index < size; index += 1) total += Math.abs(a[index] - b[index])
      return total / size / 255 * 100
    }
    // Every pair once: the seam scores read from here.
    const table = new Float32Array(n * n)
    for (let a = 0; a < n; a += 1) {
      for (let b = a + 1; b < n; b += 1) { const value = diff(frames[a], frames[b]); table[a * n + b] = value; table[b * n + a] = value }
    }
    const adjacent = Array.from({ length: n - 1 }, (_, index) => table[index * n + index + 1])
    // A segment must move: at least a fifth of the clip's average frame-to-frame change,
    // and never nothing at all (a still clip offers no loop).
    const motionFloor = Math.max(0.05, (adjacent.reduce((sum, value) => sum + value, 0) / Math.max(1, adjacent.length)) * 0.2)
    const candidates = []
    for (let start = 0; start + minLength - 1 <= n - 3; start += 1) {
      let motion = 0
      for (let end = start + 1; end <= n - 3; end += 1) {
        motion += adjacent[end - 1]
        const length = end - start + 1
        if (length < minLength) continue
        if (motion / (length - 1) < motionFloor) continue
        const seam = table[(end + 1) * n + start]
        const pace = table[(end + 2) * n + start + 1]
        candidates.push({ start, end, length, score: Math.round((seam * 0.7 + pace * 0.3) * 100) / 100 })
      }
    }
    candidates.sort((a, b) => a.score - b.score || b.length - a.length)
    const kept = []
    for (const candidate of candidates) {
      if (kept.some((other) => Math.abs(other.start - candidate.start) <= 2 && Math.abs(other.end - candidate.end) <= 2)) continue
      kept.push(candidate)
      if (kept.length >= maxCandidates) break
    }
    return kept
  }

  return Object.freeze({ createModel, outputFileName, frameFileName, findLoops })
})

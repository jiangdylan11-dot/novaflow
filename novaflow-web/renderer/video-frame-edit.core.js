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
  function outputFileName(sourceName, alpha) {
    const stem = String(sourceName || '').replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'video'
    return `${stem.replace(/_edit(?:_\d+)?$/, '')}_edit.${alpha ? 'webm' : 'mp4'}`
  }

  return Object.freeze({ createModel, outputFileName })
})

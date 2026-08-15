(function installNovaFlowStoryboardResourceWorkflow() {
  'use strict'

  if (window.NovaFlowStoryboardResourceWorkflow) return

  const EDIT_SOURCE_ACTIONS = new Set([
    'inpaint',
    'inpaintEdit',
    'inpaintRepair',
    'inpaintCompletion',
    'penFill',
    'healing',
    'mask',
    'canvasResize'
  ])
  let preparation = null

  function isEditSourceAction(action) {
    return EDIT_SOURCE_ACTIONS.has(String(action || ''))
  }

  function revisionForDataUrl(value) {
    const text = String(value || '')
    let hash = 2166136261
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return `${text.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`
  }

  function deleteGroup(context) {
    const { state, groupId, bridge } = context || {}
    if (!state || !bridge || state.busy || bridge.isEditToolActive()) return false
    const groups = bridge.storyboardGroups()
    const id = String(groupId || '')
    const index = groups.findIndex((group) => group && String(group.id || '') === id)
    if (index < 0) return false
    const wasActive = String(state.activeStoryboardGroupId || '') === id
    const wasPreviewed = wasActive && state.viewMode === 'storyboard'
    const [removed] = groups.splice(index, 1)
    if (wasActive) {
      bridge.cancelWorkspaceSync(1400)
      const next = groups[Math.min(index, groups.length - 1)] || groups[index - 1] || groups[0] || null
      if (next) {
        groups.forEach((candidate) => { candidate.expanded = candidate === next })
        const nextItem = bridge.storyboardItemById(next, next.activeItemId || 'overview') || next.overview
        state.activeStoryboardGroupId = next.id
        state.activeStoryboardItemId = nextItem && nextItem.id || 'overview'
        next.activeItemId = state.activeStoryboardItemId
        if (wasPreviewed) state.viewMode = 'storyboard'
      } else {
        state.activeStoryboardGroupId = ''
        state.activeStoryboardItemId = ''
        if (wasPreviewed) {
          const resources = bridge.sourceResources()
          const fallback = resources.find((resource) => resource && !resource.storyboardEditCopy) || resources[0] || null
          if (fallback) bridge.activateSourceWithWorkspace(fallback.id, { resetViewport: false, sourceView: true })
          else state.viewMode = state.parts.length || state.splitSets.length ? 'parts' : 'source'
        }
      }
      bridge.resetViewport()
    }
    bridge.setMessage(`已删除整组分镜：${removed && (removed.name || 'Storyboard') || 'Storyboard'}`)
    bridge.renderAll()
    if (wasPreviewed && state.viewMode === 'storyboard') bridge.scheduleWorkspaceSync()
    return true
  }

  function fixtureImage(label, color) {
    const text = String(label || 'Storyboard')
    const fill = String(color || '#155e75')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${fill}"/><circle cx="320" cy="156" r="72" fill="rgba(255,255,255,0.16)"/><text x="320" y="285" fill="#fff" font-family="Arial,sans-serif" font-size="30" font-weight="700" text-anchor="middle">${text}</text></svg>`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }

  function installAcceptanceFixture(context) {
    const { state, bridge } = context || {}
    if (!state || !bridge) return false
    const sourceDataUrl = fixtureImage('Original source', '#334155')
    const source = {
      id: 'storyboard_fixture_source',
      fileName: 'storyboard-fixture-source.svg',
      name: 'Storyboard 测试原图',
      dataUrl: sourceDataUrl,
      width: 640,
      height: 360,
      sourceImageSize: { width: 640, height: 360 },
      sourceOffset: { x: 0, y: 0 },
      createdAt: new Date().toISOString()
    }
    const colors = ['#0f766e', '#0369a1', '#4338ca', '#7e22ce', '#a21caf', '#be123c', '#c2410c', '#a16207', '#3f6212']
    const scenes = colors.map((color, index) => {
      const number = index + 1
      return {
        id: `scene_${String(number).padStart(2, '0')}`,
        number,
        title: `验收镜头 ${String(number).padStart(2, '0')}`,
        description: `Storyboard 资源交互验收镜头 ${String(number).padStart(2, '0')}`,
        dataUrl: fixtureImage(`Scene ${String(number).padStart(2, '0')}`, color),
        width: 640,
        height: 360,
        status: 'done'
      }
    })
    const group = {
      id: 'storyboard_fixture_group',
      name: 'Storyboard · 9镜头',
      sourceName: source.fileName,
      expanded: true,
      activeItemId: scenes[0].id,
      overview: {
        id: 'overview',
        title: 'Storyboard 总览图',
        dataUrl: fixtureImage('Storyboard 3x3', '#111827'),
        width: 640,
        height: 360,
        status: 'done'
      },
      scenes
    }
    state.sourceResources = [source]
    state.activeSourceResourceId = source.id
    state.source = { id: source.id, fileName: source.fileName, name: source.name, dataUrl: source.dataUrl }
    state.sourceSize = { width: 640, height: 360 }
    state.sourceImageSize = { width: 640, height: 360 }
    state.sourceOffset = { x: 0, y: 0 }
    state.sourceDataUrlPending = false
    state.parts = []
    state.splitPreviewDataUrl = ''
    state.splitSets = []
    state.activeSplitSetId = ''
    state.activePartId = ''
    state.selectedPartIds = []
    state.storyboardGroups = [group]
    state.activeStoryboardGroupId = group.id
    state.activeStoryboardItemId = group.activeItemId
    state.viewMode = 'storyboard'
    bridge.resetViewport()
    bridge.setMessage('STORYBOARD_RESOURCE_FIXTURE_READY')
    bridge.renderAll()
    bridge.scheduleWorkspaceSync()
    return true
  }

  function editableTarget(context) {
    const { state, group, item, resource, bridge } = context || {}
    if (!state || !bridge) return null
    if (state.viewMode === 'storyboard') {
      if (!group || !item) return null
      if (item.id === 'overview') return { overview: true }
      return {
        group,
        item,
        resource: null,
        groupId: String(group.id || ''),
        itemId: String(item.id || ''),
        number: String(item.number || '').padStart(2, '0'),
        revision: revisionForDataUrl(item.dataUrl),
        dataUrl: item.dataUrl,
        width: Number(item.width) || 0,
        height: Number(item.height) || 0
      }
    }
    if (!resource || !resource.storyboardEditCopy || !resource.dataUrl) return null
    return {
      group: group || null,
      item: item || null,
      resource,
      groupId: String(resource.storyboardGroupId || group && group.id || ''),
      itemId: String(resource.storyboardItemId || item && item.id || ''),
      number: String(resource.storyboardItemNumber || item && item.number || '').padStart(2, '0'),
      revision: String(resource.storyboardRevision || revisionForDataUrl(resource.dataUrl)),
      dataUrl: resource.dataUrl,
      width: Number(resource.width) || 0,
      height: Number(resource.height) || 0
    }
  }

  async function prepareSceneEditableCopy(context) {
    if (preparation) return preparation
    const { state, bridge } = context || {}
    const target = editableTarget(context)
    if (!state || !bridge || !target) return true
    if (target.overview) {
      bridge.setMessage('请先选择镜头01–09中的单个镜头，再使用左侧编辑功能', true)
      bridge.renderWorkspace()
      return false
    }
    const existing = target.resource || bridge.sourceResources().find((resource) => resource
      && resource.storyboardEditCopy
      && String(resource.storyboardGroupId || '') === target.groupId
      && String(resource.storyboardItemId || '') === target.itemId
      && String(resource.storyboardRevision || '') === target.revision) || null
    const existingSet = existing && bridge.linkedSplitSetForResource(existing)
    if (existingSet) {
      bridge.cancelWorkspaceSync(1400)
      const alreadyActive = String(state.activeSourceResourceId || '') === String(existing.id || '')
        && String(state.activeSplitSetId || '') === String(existingSet.id || '')
      if (!alreadyActive) bridge.activateSourceWithWorkspace(existing.id, { resetViewport: false, sourceView: false })
      else if (state.viewMode === 'storyboard') {
        state.viewMode = 'parts'
        bridge.renderAll()
      }
      if (target.group && target.item) {
        state.activeStoryboardGroupId = target.group.id
        state.activeStoryboardItemId = target.item.id
        target.group.activeItemId = target.item.id
      }
      bridge.setMessage(`镜头${target.number || '--'}已恢复独立编辑副本`)
      return true
    }
    const snapshot = {
      source: state.source,
      sourceSize: state.sourceSize,
      sourceImageSize: state.sourceImageSize,
      sourceOffset: state.sourceOffset,
      canvasBoundaryGuide: state.canvasBoundaryGuide,
      activeSourceResourceId: state.activeSourceResourceId,
      sourceDataUrlPending: state.sourceDataUrlPending,
      parts: state.parts,
      splitPreviewDataUrl: state.splitPreviewDataUrl,
      splitPreviewStale: state.splitPreviewStale,
      splitPreviewRefreshPending: state.splitPreviewRefreshPending,
      splitPreviewRefreshToken: state.splitPreviewRefreshToken,
      activeSplitSetId: state.activeSplitSetId,
      splitRunCounter: state.splitRunCounter,
      activePartId: state.activePartId,
      selectedPartIds: state.selectedPartIds,
      tempDir: state.tempDir,
      tempError: state.tempError,
      viewMode: state.viewMode
    }
    preparation = (async () => {
      let retainedResourceIds = null
      let retainedSetIds = null
      try {
        state.busy = true
        state.busyAction = 'storyboardEditSource'
        state.busyStartedAt = Date.now()
        bridge.setMessage(`正在准备镜头${target.number || '--'}编辑副本...`)
        bridge.renderBusy()
        const preservedSet = bridge.preserveCurrentWorkspace()
        if (preservedSet && !snapshot.activeSplitSetId) snapshot.activeSplitSetId = preservedSet.id
        snapshot.splitRunCounter = state.splitRunCounter
        retainedResourceIds = new Set(bridge.sourceResources().map((resource) => String(resource && resource.id || '')))
        retainedSetIds = new Set(state.splitSets.map((set) => String(set && set.id || '')))
        bridge.cancelWorkspaceSync(1400)
        let resource = existing
        if (!resource) {
          const measured = target.width > 0 && target.height > 0
            ? { width: target.width, height: target.height }
            : await bridge.imageSizeFromDataUrl(target.dataUrl)
          const width = Math.max(1, Math.round(Number(measured && measured.width) || 1))
          const height = Math.max(1, Math.round(Number(measured && measured.height) || 1))
          resource = bridge.appendSourceResource({
            fileName: `Storyboard_镜头${target.number || '--'}_编辑副本.png`,
            name: `镜头${target.number || '--'} · 编辑副本`,
            dataUrl: target.dataUrl,
            width,
            height,
            sourceImageSize: { width, height },
            sourceOffset: { x: 0, y: 0 },
            storyboardEditCopy: true,
            storyboardGroupId: target.groupId,
            storyboardItemId: target.itemId,
            storyboardItemNumber: target.number,
            storyboardRevision: target.revision
          }, { resetViewport: false })
        } else {
          bridge.activateSourceWithWorkspace(resource.id, { resetViewport: false, sourceView: false })
        }
        state.parts = []
        state.splitPreviewDataUrl = ''
        state.activeSplitSetId = ''
        state.activePartId = ''
        state.selectedPartIds = []
        state.viewMode = 'source'
        const part = await bridge.ensureSourceAsEditableLayer('分镜编辑', {
          registerNewSet: true,
          splitSet: {
            name: `分镜编辑 ${target.number || '--'}`,
            storyboardGroupId: target.groupId,
            storyboardItemId: target.itemId,
            storyboardRevision: target.revision
          }
        })
        if (!part) throw new Error('镜头编辑副本无法建立独立图层工作区')
        bridge.updateSourceResource(resource.id, { storyboardSplitSetId: String(state.activeSplitSetId || '') })
        if (target.group && target.item) {
          state.activeStoryboardGroupId = target.group.id
          state.activeStoryboardItemId = target.item.id
          target.group.activeItemId = target.item.id
        }
        bridge.setMessage(`镜头${target.number || '--'}已进入独立编辑副本`)
        return true
      } catch (error) {
        if (retainedSetIds) state.splitSets = state.splitSets.filter((set) => set && retainedSetIds.has(String(set.id || '')))
        if (retainedResourceIds) state.sourceResources = bridge.sourceResources().filter((resource) => resource && retainedResourceIds.has(String(resource.id || '')))
        Object.assign(state, snapshot)
        if (target.group && target.item) {
          state.activeStoryboardGroupId = target.group.id
          state.activeStoryboardItemId = target.item.id
          target.group.activeItemId = target.item.id
        }
        bridge.setMessage(String(error && error.message || error || '镜头编辑副本准备失败'), true)
        return false
      } finally {
        state.busy = false
        state.busyAction = ''
        state.busyStartedAt = 0
        try {
          bridge.renderAll()
        } finally {
          bridge.syncBusy()
        }
      }
    })()
    try {
      return await preparation
    } finally {
      preparation = null
    }
  }

  window.NovaFlowStoryboardResourceWorkflow = Object.freeze({
    version: '1.0.0',
    isEditSourceAction,
    deleteGroup,
    installAcceptanceFixture,
    prepareSceneEditableCopy
  })
})()

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const runtimePath = path.resolve(__dirname, '../../particle-editor/spine-split-runtime.js')
const workflowPath = path.resolve(__dirname, '../../particle-editor/storyboard-resource.workflow.js')
const indexPath = path.resolve(__dirname, '../../particle-editor/index.html')
const source = fs.readFileSync(runtimePath, 'utf8')
const workflowSource = fs.readFileSync(workflowPath, 'utf8')
const indexSource = fs.readFileSync(indexPath, 'utf8')

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractFunction(text, name, label) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`, 'g')
  const match = declaration.exec(text)
  assert.ok(match, `${name}() should exist in ${label}`)
  const start = match.index
  const rest = text.slice(start + match[0].length)
  const nextDeclaration = /\n  (?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(rest)
  const end = nextDeclaration ? start + match[0].length + nextDeclaration.index : text.length
  return text.slice(start, end)
}

function runtimeFunction(name) {
  return extractFunction(source, name, 'the source Runtime')
}

function workflowFunction(name) {
  return extractFunction(workflowSource, name, 'the Storyboard resource workflow')
}

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `source marker should exist: ${startMarker}`)
  assert.ok(end > start, `end marker should follow start marker: ${endMarker}`)
  return source.slice(start, end)
}

function workflowApi() {
  const sandbox = { window: {} }
  vm.runInNewContext(workflowSource, sandbox, { filename: workflowPath })
  return sandbox.window.NovaFlowStoryboardResourceWorkflow
}

test('Storyboard resource workflow loads before the Runtime and owns the Edit-action contract', () => {
  const workflowIndex = indexSource.indexOf('./storyboard-resource.workflow.js')
  const runtimeIndex = indexSource.indexOf('./spine-split-runtime.js')
  assert.ok(workflowIndex >= 0 && workflowIndex < runtimeIndex, 'the workflow must install before Runtime dispatch starts')

  const actionSet = /const\s+EDIT_SOURCE_ACTIONS\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/.exec(workflowSource)
  assert.ok(actionSet, 'the independent workflow should declare its Edit action allowlist')
  const actual = Array.from(actionSet[1].matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]).sort()
  const expected = ['canvasResize', 'healing', 'inpaint', 'inpaintCompletion', 'inpaintEdit', 'inpaintRepair', 'mask', 'penFill'].sort()
  assert.deepEqual(actual, expected)

  const runtimePredicate = runtimeFunction('isStoryboardEditSourceAction')
  assert.match(runtimePredicate, /storyboardResourceWorkflow\(\)/)
  assert.doesNotMatch(source, /const\s+STORYBOARD_EDIT_SOURCE_ACTIONS/, 'Runtime should remain dispatcher glue')
})

test('expanded Storyboard groups render a confirmed, interaction-locked whole-group delete button', () => {
  assert.match(source, /STORYBOARD_GROUP_DELETE_ATTR\s*=\s*['"]data-novaflow-storyboard-group-delete['"]/) 
  const groupCard = sourceBetween('const renderStoryboardGroupCard = (group) => {', '\n    const sets = splitRightWorkspaceSetsForRender()')
  assert.match(groupCard, /const\s+interactionLocked\s*=\s*state\.busy\s*\|\|\s*isSplitEditToolActive\(\)/)
  assert.match(groupCard, /\[STORYBOARD_GROUP_DELETE_ATTR\]\s*:\s*group\.id/)
  assert.match(groupCard, /disabled:\s*interactionLocked/)
  assert.match(groupCard, /window\.confirm\(/)
  assert.match(groupCard, /event\.preventDefault\(\)/)
  assert.match(groupCard, /event\.stopPropagation\(\)/)
  assert.match(groupCard, /deleteStoryboardGroup\(group\.id\)/)
  assert.match(groupCard, /删除整组分镜/)
})

test('deleteGroup removes only Storyboard state and selects an adjacent group', () => {
  const api = workflowApi()
  const groups = [
    { id: 'g1', name: 'A', activeItemId: 'scene_01', overview: { id: 'overview' }, scenes: [{ id: 'scene_01' }] },
    { id: 'g2', name: 'B', activeItemId: 'overview', overview: { id: 'overview' }, scenes: [] }
  ]
  const resources = [{ id: 'source', dataUrl: 'data:image/png;base64,AA' }]
  const parts = [{ id: 'edited' }]
  const splitSets = [{ id: 'set-edited', parts }]
  const state = {
    busy: false,
    storyboardGroups: groups,
    activeStoryboardGroupId: 'g1',
    activeStoryboardItemId: 'scene_01',
    viewMode: 'storyboard',
    parts,
    splitSets
  }
  let cancelled = 0
  let rendered = 0
  const result = api.deleteGroup({
    state,
    groupId: 'g1',
    bridge: {
      isEditToolActive: () => false,
      storyboardGroups: () => groups,
      storyboardItemById: (group, id) => group.overview.id === id ? group.overview : group.scenes.find((item) => item.id === id),
      cancelWorkspaceSync: () => { cancelled += 1 },
      sourceResources: () => resources,
      activateSourceWithWorkspace: () => true,
      resetViewport: () => {},
      setMessage: () => {},
      renderAll: () => { rendered += 1 },
      scheduleWorkspaceSync: () => {}
    }
  })

  assert.equal(result, true)
  assert.deepEqual(groups.map((group) => group.id), ['g2'])
  assert.equal(state.activeStoryboardGroupId, 'g2')
  assert.equal(state.activeStoryboardItemId, 'overview')
  assert.equal(state.viewMode, 'storyboard')
  assert.equal(state.parts, parts, 'independent edited parts must be preserved')
  assert.equal(state.splitSets, splitSets, 'independent edited sets must be preserved')
  assert.equal(cancelled, 1)
  assert.equal(rendered, 1)
})

test('deleting the final previewed group restores a linked edit-copy workspace when it is the only fallback', () => {
  const api = workflowApi()
  const groups = [{ id: 'g1', overview: { id: 'overview' }, scenes: [] }]
  const copy = { id: 'copy-1', dataUrl: 'data:image/png;base64,AA', storyboardEditCopy: true, storyboardSplitSetId: 'set-copy' }
  const state = {
    busy: false,
    activeStoryboardGroupId: 'g1',
    activeStoryboardItemId: 'overview',
    viewMode: 'storyboard',
    parts: [],
    splitSets: [{ id: 'set-copy', sourceResourceId: 'copy-1', parts: [{ id: 'p1' }] }]
  }
  let fallback = null
  api.deleteGroup({
    state,
    groupId: 'g1',
    bridge: {
      isEditToolActive: () => false,
      storyboardGroups: () => groups,
      storyboardItemById: () => null,
      cancelWorkspaceSync: () => {},
      sourceResources: () => [copy],
      activateSourceWithWorkspace: (id, options) => { fallback = { id, options }; state.activeSourceResourceId = id; state.activeSplitSetId = copy.storyboardSplitSetId; return true },
      resetViewport: () => {},
      setMessage: () => {},
      renderAll: () => {},
      scheduleWorkspaceSync: () => {}
    }
  })
  assert.equal(state.activeStoryboardGroupId, '')
  assert.equal(state.activeStoryboardItemId, '')
  assert.equal(fallback.id, 'copy-1')
  assert.equal(fallback.options.resetViewport, false)
  assert.equal(fallback.options.sourceView, true)
  assert.equal(state.activeSourceResourceId, 'copy-1')
  assert.equal(state.activeSplitSetId, 'set-copy')
})

test('the acceptance fixture creates a local nine-scene Storyboard without any provider or generation call', () => {
  const api = workflowApi()
  const state = {}
  let rendered = 0
  const result = api.installAcceptanceFixture({
    state,
    bridge: {
      resetViewport: () => {},
      setMessage: () => {},
      renderAll: () => { rendered += 1 },
      scheduleWorkspaceSync: () => {}
    }
  })
  assert.equal(result, true)
  assert.equal(state.storyboardGroups.length, 1)
  assert.equal(state.storyboardGroups[0].scenes.length, 9)
  assert.equal(state.viewMode, 'storyboard')
  assert.match(state.storyboardGroups[0].scenes[0].dataUrl, /^data:image\/svg\+xml/)
  assert.equal(state.sourceResources.length, 1)
  assert.equal(rendered, 1)
  assert.doesNotMatch(workflowFunction('installAcceptanceFixture'), /fetch\(|Grok|Comfy|generate/i)
})

test('a selected scene materializes one versioned edit copy and an independent split set', async () => {
  const api = workflowApi()
  const item = { id: 'scene_07', number: 7, dataUrl: 'data:image/png;base64,SCENE', width: 40, height: 30 }
  const group = { id: 'g1', activeItemId: item.id }
  const resources = [{ id: 'source', dataUrl: 'data:image/png;base64,SOURCE' }]
  const state = {
    busy: false,
    viewMode: 'storyboard',
    source: { id: 'source', dataUrl: resources[0].dataUrl },
    sourceSize: { width: 100, height: 100 },
    sourceImageSize: { width: 100, height: 100 },
    sourceOffset: { x: 0, y: 0 },
    activeSourceResourceId: 'source',
    parts: [],
    splitSets: [],
    activeSplitSetId: '',
    selectedPartIds: [],
    splitRunCounter: 0
  }
  const bridge = {
    sourceResources: () => resources,
    linkedSplitSetForResource: () => null,
    cancelWorkspaceSync: () => {},
    preserveCurrentWorkspace: () => null,
    imageSizeFromDataUrl: async () => ({ width: 40, height: 30 }),
    appendSourceResource: (resource) => {
      const copy = { ...resource, id: 'copy-7' }
      resources.push(copy)
      state.activeSourceResourceId = copy.id
      state.source = { id: copy.id, dataUrl: copy.dataUrl }
      return copy
    },
    activateSourceWithWorkspace: () => true,
    ensureSourceAsEditableLayer: async (_name, options) => {
      const layer = { id: 'layer-copy-7', dataUrl: item.dataUrl, sourceResourceId: 'copy-7' }
      const set = { id: 'set-copy-7', sourceResourceId: 'copy-7', parts: [layer], ...options.splitSet }
      state.parts = [layer]
      state.splitSets.push(set)
      state.activeSplitSetId = set.id
      return layer
    },
    updateSourceResource: (id, patch) => Object.assign(resources.find((resource) => resource.id === id), patch),
    setMessage: () => {},
    renderBusy: () => {},
    renderAll: () => {},
    syncBusy: () => {}
  }

  assert.equal(await api.prepareSceneEditableCopy({ state, group, item, resource: resources[0], bridge }), true)
  const copy = resources.find((resource) => resource.storyboardEditCopy)
  assert.ok(copy)
  assert.equal(copy.dataUrl, item.dataUrl)
  assert.equal(copy.storyboardGroupId, 'g1')
  assert.equal(copy.storyboardItemId, 'scene_07')
  assert.equal(copy.storyboardItemNumber, '07')
  assert.equal(copy.storyboardSplitSetId, 'set-copy-7')
  assert.equal(state.activeSplitSetId, 'set-copy-7')
})

test('an active edit copy preserves the selected layer when its linked workspace is already active', async () => {
  const api = workflowApi()
  const copy = { id: 'copy-7', dataUrl: 'data:image/png;base64,SCENE', storyboardEditCopy: true, storyboardGroupId: 'g1', storyboardItemId: 'scene_07', storyboardRevision: 'r1', storyboardSplitSetId: 'set-copy-7' }
  const set = { id: 'set-copy-7', sourceResourceId: 'copy-7', parts: [{ id: 'p1' }, { id: 'p2' }] }
  const state = { busy: false, viewMode: 'parts', activeSourceResourceId: copy.id, activeSplitSetId: set.id, activePartId: 'p2', selectedPartIds: ['p2'] }
  let activations = 0
  const result = await api.prepareSceneEditableCopy({
    state,
    resource: copy,
    bridge: {
      sourceResources: () => [copy],
      linkedSplitSetForResource: () => set,
      cancelWorkspaceSync: () => {},
      activateSourceWithWorkspace: () => { activations += 1 },
      setMessage: () => {}
    }
  })
  assert.equal(result, true)
  assert.equal(activations, 0, 'the fast path must not reset the current layer selection')
  assert.equal(state.activePartId, 'p2')
  assert.deepEqual(state.selectedPartIds, ['p2'])
})

test('an orphaned edit copy rebuilds its own set instead of contaminating another resource set', async () => {
  const api = workflowApi()
  const copy = { id: 'copy-7', dataUrl: 'data:image/png;base64,SCENE', width: 40, height: 30, storyboardEditCopy: true, storyboardGroupId: 'g1', storyboardItemId: 'scene_07', storyboardItemNumber: '07', storyboardRevision: 'r1', storyboardSplitSetId: '' }
  const otherSet = { id: 'set-other', sourceResourceId: 'source', parts: [{ id: 'other-part' }] }
  const state = {
    busy: false,
    viewMode: 'source',
    source: { id: copy.id, dataUrl: copy.dataUrl },
    sourceSize: { width: 40, height: 30 },
    sourceImageSize: { width: 40, height: 30 },
    sourceOffset: { x: 0, y: 0 },
    activeSourceResourceId: copy.id,
    activeSplitSetId: otherSet.id,
    activePartId: '',
    selectedPartIds: [],
    parts: otherSet.parts,
    splitSets: [otherSet],
    splitRunCounter: 0
  }
  const bridge = {
    sourceResources: () => [copy],
    linkedSplitSetForResource: () => null,
    cancelWorkspaceSync: () => {},
    preserveCurrentWorkspace: () => otherSet,
    activateSourceWithWorkspace: () => true,
    ensureSourceAsEditableLayer: async (_name, options) => {
      const layer = { id: 'copy-part', sourceResourceId: copy.id, dataUrl: copy.dataUrl }
      const set = { id: 'set-copy-new', sourceResourceId: copy.id, parts: [layer], ...options.splitSet }
      state.parts = [layer]
      state.splitSets.push(set)
      state.activeSplitSetId = set.id
      return layer
    },
    updateSourceResource: (_id, patch) => Object.assign(copy, patch),
    setMessage: () => {},
    renderBusy: () => {},
    renderAll: () => {},
    syncBusy: () => {}
  }
  assert.equal(await api.prepareSceneEditableCopy({ state, resource: copy, bridge }), true)
  assert.equal(copy.storyboardSplitSetId, 'set-copy-new')
  assert.equal(state.activeSplitSetId, 'set-copy-new')
  assert.deepEqual(otherSet.parts.map((part) => part.id), ['other-part'])
})

test('editable-copy preparation always clears busy state when its first render fails', async () => {
  const api = workflowApi()
  const copy = { id: 'copy-7', dataUrl: 'data:image/png;base64,SCENE', storyboardEditCopy: true, storyboardGroupId: 'g1', storyboardItemId: 'scene_07', storyboardItemNumber: '07', storyboardRevision: 'r1' }
  const state = {
    busy: false,
    viewMode: 'source',
    source: { id: copy.id, dataUrl: copy.dataUrl },
    sourceSize: { width: 40, height: 30 },
    sourceImageSize: { width: 40, height: 30 },
    sourceOffset: { x: 0, y: 0 },
    activeSourceResourceId: copy.id,
    activeSplitSetId: '',
    activePartId: '',
    selectedPartIds: [],
    parts: [],
    splitSets: []
  }
  let busySynced = 0
  const result = await api.prepareSceneEditableCopy({
    state,
    resource: copy,
    bridge: {
      sourceResources: () => [copy],
      linkedSplitSetForResource: () => null,
      setMessage: () => {},
      renderBusy: () => { throw new Error('render failed') },
      renderAll: () => {},
      syncBusy: () => { busySynced += 1 }
    }
  })
  assert.equal(result, false)
  assert.equal(state.busy, false)
  assert.equal(state.busyAction, '')
  assert.equal(state.busyStartedAt, 0)
  assert.equal(busySynced, 1)
})

test('Runtime dispatch prepares Storyboard previews and edit copies before any Edit tool action', () => {
  const dispatch = runtimeFunction('runSplitControlAction')
  const prepareIndex = dispatch.indexOf('prepareStoryboardSceneEditableCopy(')
  const firstToolIndex = dispatch.indexOf("action === 'canvasResize'")
  assert.match(dispatch, /state\.viewMode\s*===\s*['"]storyboard['"]\s*\|\|\s*isStoryboardEditSourceResource\(\)/)
  assert.match(dispatch, /isStoryboardEditSourceAction\(action\)/)
  assert.ok(prepareIndex >= 0 && prepareIndex < firstToolIndex)
  assert.match(dispatch, /storyboardEditPrepared:\s*true/)
})

test('resource, scene, scene-action, and group switching are locked during an active edit session', () => {
  const resourceCard = sourceBetween('const renderSourceResourceCard = (resource) => {', '\n    const renderStoryboardItemRow = (group, item) => {')
  const itemRow = sourceBetween('const renderStoryboardItemRow = (group, item) => {', '\n    const renderStoryboardSceneActions = (group) => {')
  const sceneActions = sourceBetween('const renderStoryboardSceneActions = (group) => {', '\n    const renderStoryboardGroupCard = (group) => {')
  const groupCard = sourceBetween('const renderStoryboardGroupCard = (group) => {', '\n    const sets = splitRightWorkspaceSetsForRender()')
  assert.match(resourceCard, /resourceLocked\s*=\s*state\.busy\s*\|\|\s*isSplitEditToolActive\(\)/)
  assert.match(resourceCard, /activateSourceResourceWithLinkedSplitSet\(resource\.id/)
  assert.match(itemRow, /locked\s*=\s*state\.busy\s*\|\|\s*isSplitEditToolActive\(\)/)
  assert.match(sceneActions, /actionLocked\s*=\s*state\.busy\s*\|\|\s*isSplitEditToolActive\(\)/)
  assert.match(groupCard, /interactionLocked\s*=\s*state\.busy\s*\|\|\s*isSplitEditToolActive\(\)/)
})

test('split-set activation follows every recorded source identity and disables the stale DOM fast path', () => {
  const activate = runtimeFunction('activateSplitSet')
  const toggle = runtimeFunction('toggleSplitSet')
  assert.match(activate, /set\.sourceResourceId\s*&&\s*set\.sourceResourceId\s*!==\s*state\.activeSourceResourceId/)
  assert.match(toggle, /const\s+sourceChanged\s*=/)
  assert.match(toggle, /!sourceChanged\s*&&\s*sameActiveSet/)
})

;(function (root) {
  'use strict'
  const core = root.NovaFlowUiSmartSplitCore
  function contextForPart(part, set) {
    const context = part?.metadata?.legacyUiLayer?.uiSplit || part?.uiSplit
    if (!context) return null
    const state = root.NovaFlowSpineSplitBridge?.getState?.()
    const owner = set || state?.splitSets?.find(s => s.parts?.some(p => p.id === part.id))
    const original = owner?.uiLayerProject?.uiSplitOriginal || owner?.originalUiLayerProject?.uiSplitOriginal
    const resource = root.NovaFlowSpineSplitBridge?.getSourceResource?.(context.sourceResourceId)
    const dataUrl = original?.originalDataUrl || resource?.dataUrl
    return dataUrl ? { ...context, originalDataUrl: dataUrl } : null
  }
  function mount(options) {
    const { leftHost } = options
    const host = root.location?.hostname || ''
    if (['localhost','127.0.0.1','[::1]'].includes(host) && root.NovaFlowUiAtlasSplit?.mount) {
      return root.NovaFlowUiAtlasSplit.mount(options)
    }
    const doc = leftHost.ownerDocument, accordion = root.NovaFlowLeftPanelAccordion
    const panel = doc.createElement('section')
    panel.setAttribute('class', 'nf-panel')
    panel.setAttribute('data-novaflow-ui-smart-split', '1')
    Object.assign(panel.style, accordion.panelStyle())
    const header = doc.createElement('button')
    header.type = 'button'
    header.disabled = true
    header.setAttribute('class', 'nf-panel-header')
    header.textContent = '拆图（暂时停用）'
    Object.assign(header.style, accordion.headerStyle(false))
    panel.append(header)
    function sync() {
      const active = leftHost.getAttribute('data-psd-fusion-ui') === '1'
      panel.style.display = active ? '' : 'none'
      if (active && panel.parentElement !== leftHost) leftHost.append(panel)
    }
    sync()
    return { sync, destroy() { panel.remove() } }
  }
  root.NovaFlowUiSmartSplit = Object.freeze({ mount, contextForPart, prepareRepair: context => core.repair(context) })
})(typeof window === 'undefined' ? globalThis : window)

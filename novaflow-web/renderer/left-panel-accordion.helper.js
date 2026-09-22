(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowLeftPanelAccordion = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const PANEL_ATTR = 'data-novaflow-left-accordion-panel'
  const TOKENS = Object.freeze({
    panelGap: '5px',
    radius: '8px',
    headerHeight: '36px',
    headerPadding: '0 12px',
    headerBackground: '#24262a',
    headerFontSize: '13px',
    headerFontWeight: '400',
    headerGap: '8px',
    titleMaxWidth: 'calc(100% - 20px)',
    iconSlot: '18px',
    iconMarginRight: '8px',
    iconFontSize: '14px',
    chevronSlot: '12px',
    chevronFontSize: '12px',
    chevronOpacity: '0.7',
    bodyPadding: '6px 12px 8px',
    bodyGap: '6px',
  })

  function panelStyle() {
    return {
      display: 'block',
      width: '100%',
      minWidth: '0',
      maxWidth: '100%',
      margin: '0',
      overflow: 'hidden',
      background: 'transparent',
      backgroundColor: 'transparent',
      border: '0',
      borderRadius: TOKENS.radius,
      boxShadow: 'none',
      boxSizing: 'border-box',
    }
  }

  function headerStyle(expanded) {
    return {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TOKENS.headerGap,
      width: '100%',
      minWidth: '0',
      maxWidth: '100%',
      height: TOKENS.headerHeight,
      minHeight: TOKENS.headerHeight,
      maxHeight: TOKENS.headerHeight,
      padding: TOKENS.headerPadding,
      border: '0',
      borderRadius: expanded ? `${TOKENS.radius} ${TOKENS.radius} 0 0` : TOKENS.radius,
      background: TOKENS.headerBackground,
      backgroundColor: TOKENS.headerBackground,
      color: '#fff',
      cursor: 'pointer',
      fontSize: TOKENS.headerFontSize,
      fontWeight: TOKENS.headerFontWeight,
      textAlign: 'left',
      boxSizing: 'border-box',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      boxShadow: 'none',
      outline: '0',
    }
  }

  function titleStyle() {
    return {
      display: 'flex',
      alignItems: 'center',
      minWidth: '0',
      maxWidth: TOKENS.titleMaxWidth,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
  }

  function iconStyle() {
    return {
      flex: `0 0 ${TOKENS.iconSlot}`,
      width: TOKENS.iconSlot,
      minWidth: TOKENS.iconSlot,
      maxWidth: TOKENS.iconSlot,
      marginRight: TOKENS.iconMarginRight,
      textAlign: 'center',
      fontSize: TOKENS.iconFontSize,
      lineHeight: '1',
      color: '#fff',
    }
  }

  function labelStyle() {
    return {
      minWidth: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }
  }

  function chevronStyle() {
    return {
      flex: `0 0 ${TOKENS.chevronSlot}`,
      width: TOKENS.chevronSlot,
      minWidth: TOKENS.chevronSlot,
      maxWidth: TOKENS.chevronSlot,
      textAlign: 'center',
      fontSize: TOKENS.chevronFontSize,
      lineHeight: '1',
      opacity: TOKENS.chevronOpacity,
      color: '#fff',
    }
  }

  function bodyStyle(expanded) {
    return {
      display: expanded ? 'grid' : 'none',
      gap: TOKENS.bodyGap,
      rowGap: TOKENS.bodyGap,
      columnGap: TOKENS.bodyGap,
      width: '100%',
      minWidth: '0',
      maxWidth: '100%',
      padding: TOKENS.bodyPadding,
      boxSizing: 'border-box',
    }
  }

  function chevronClass(expanded) {
    return `fas fa-chevron-${expanded ? 'down' : 'right'}`
  }

  function setImportantStyle(node, name, value) {
    if (!node?.style) return
    if (typeof node.style.setProperty === 'function') {
      node.style.setProperty(name, value, 'important')
      return
    }
    const property = name.replace(/-([a-z])/g, (_, character) => character.toUpperCase())
    node.style[property] = value
  }

  function syncExpanded(section, header, body, chevron, expanded) {
    const open = expanded === true
    section?.setAttribute?.(PANEL_ATTR, '1')
    section?.setAttribute?.('data-open', open ? '1' : '0')
    header?.setAttribute?.('aria-expanded', open ? 'true' : 'false')
    if (header?.style) header.style.borderRadius = open ? `${TOKENS.radius} ${TOKENS.radius} 0 0` : TOKENS.radius
    setImportantStyle(body, 'display', open ? 'grid' : 'none')
    setImportantStyle(body, 'gap', TOKENS.bodyGap)
    setImportantStyle(body, 'row-gap', TOKENS.bodyGap)
    setImportantStyle(body, 'column-gap', TOKENS.bodyGap)
    setImportantStyle(body, 'padding', TOKENS.bodyPadding)
    setImportantStyle(body, 'margin-top', '0')
    setImportantStyle(body, 'margin-bottom', '0')
    if (chevron) chevron.className = chevronClass(open)
    return open
  }

  return Object.freeze({
    PANEL_ATTR,
    TOKENS,
    panelStyle,
    headerStyle,
    titleStyle,
    iconStyle,
    labelStyle,
    chevronStyle,
    bodyStyle,
    chevronClass,
    syncExpanded,
  })
})

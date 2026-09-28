(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowLeftPanelAccordion = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const PANEL_ATTR = 'data-novaflow-left-accordion-panel'
  const TOKENS = Object.freeze({
    // Reference (spline-review): the group header is a bare summary row -
    // no plate, no radius. Groups are separated by the details' bottom rule,
    // and only :hover gets a fill. The ICON keeps a small plate of its own.
    panelGap: '0px',
    radius: '0px',
    headerHeight: '46px',
    // 7 each side: the reference summary's icon sits 7 in from the card.
    headerPadding: '0 7px',
    headerBackground: 'transparent',
    headerHoverBackground: '#222222',
    panelBorderBottom: '1px solid #272727',
    iconPlateBackground: '#292929',
    iconPlateRadius: '5px',
    iconPlateSize: '24px',
    iconPlatePadding: '0',
    headerFontSize: '12px',
    headerFontWeight: '500',
    headerGap: '8px',
    titleMaxWidth: 'calc(100% - 20px)',
    iconSlot: '18px',
    iconMarginRight: '8px',
    iconFontSize: '12px',
    chevronSlot: '12px',
    chevronFontSize: '12px',
    chevronOpacity: '0.7',
    // The reference's open group: 5 over its content, 17 under it.
    bodyPadding: '5px 7px 17px',
    bodyGap: '6px',
  })

  function panelStyle() {
    return {
      display: 'block',
      width: '100%',
      minWidth: '0',
      maxWidth: '100%',
      margin: '0',
      marginBottom: TOKENS.panelGap,
      overflow: 'hidden',
      background: 'transparent',
      backgroundColor: 'transparent',
      border: '0',
      borderBottom: TOKENS.panelBorderBottom,
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
      borderRadius: TOKENS.radius,
      background: TOKENS.headerBackground,
      backgroundColor: TOKENS.headerBackground,
      color: '#d4d4d4',
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
      flex: `0 0 ${TOKENS.iconPlateSize}`,
      width: TOKENS.iconPlateSize,
      minWidth: TOKENS.iconPlateSize,
      maxWidth: TOKENS.iconPlateSize,
      height: TOKENS.iconPlateSize,
      marginRight: TOKENS.iconMarginRight,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: TOKENS.iconPlateBackground,
      borderRadius: TOKENS.iconPlateRadius,
      padding: TOKENS.iconPlatePadding,
      boxSizing: 'border-box',
      textAlign: 'center',
      fontSize: TOKENS.iconFontSize,
      lineHeight: '1',
      color: '#bdbdbd',
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
    // The header keeps the cards' 6px radius (the runtime's): squaring it
    // here on each toggle made its hover fill a hard rectangle.
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

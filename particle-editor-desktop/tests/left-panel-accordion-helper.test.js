const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const helperPath = path.resolve(__dirname, '../../particle-editor/left-panel-accordion.helper.js')

test('shared left-panel accordion preserves the Drawing header and body contract', () => {
  const resolvedHelperPath = require.resolve(helperPath)
  delete require.cache[resolvedHelperPath]
  require(resolvedHelperPath)
  const accordion = globalThis.NovaFlowLeftPanelAccordion

  assert.equal(Object.isFrozen(accordion), true)
  assert.equal(Object.isFrozen(accordion.TOKENS), true)
  assert.deepEqual({
    panelGap: accordion.TOKENS.panelGap,
    headerHeight: accordion.TOKENS.headerHeight,
    headerPadding: accordion.TOKENS.headerPadding,
    headerBackground: accordion.TOKENS.headerBackground,
    headerFontSize: accordion.TOKENS.headerFontSize,
    headerFontWeight: accordion.TOKENS.headerFontWeight,
    iconSlot: accordion.TOKENS.iconSlot,
    iconMarginRight: accordion.TOKENS.iconMarginRight,
    chevronSlot: accordion.TOKENS.chevronSlot,
    bodyPadding: accordion.TOKENS.bodyPadding,
    bodyGap: accordion.TOKENS.bodyGap,
  }, {
    panelGap: '5px',
    headerHeight: '36px',
    headerPadding: '0 12px',
    headerBackground: '#2f2f2f',
    headerFontSize: '13px',
    headerFontWeight: '400',
    iconSlot: '18px',
    iconMarginRight: '8px',
    chevronSlot: '12px',
    bodyPadding: '6px 12px 8px',
    bodyGap: '6px',
  })
  assert.equal(accordion.headerStyle(false).borderRadius, '8px')
  assert.equal(accordion.headerStyle(true).borderRadius, '8px 8px 0 0')
  assert.equal(accordion.bodyStyle(false).display, 'none')
  assert.equal(accordion.bodyStyle(true).display, 'grid')
  assert.equal(accordion.chevronClass(false), 'fas fa-chevron-right')
  assert.equal(accordion.chevronClass(true), 'fas fa-chevron-down')
})

test('shared expansion synchronizer updates section, header, body, and FontAwesome chevron together', () => {
  const accordion = globalThis.NovaFlowLeftPanelAccordion
  const values = new Map()
  const section = { setAttribute(name, value) { values.set(`section:${name}`, value) } }
  const header = { style: {}, setAttribute(name, value) { values.set(`header:${name}`, value) } }
  const body = { style: {} }
  const chevron = { className: '' }

  accordion.syncExpanded(section, header, body, chevron, true)
  assert.equal(values.get(`section:${accordion.PANEL_ATTR}`), '1')
  assert.equal(values.get('section:data-open'), '1')
  assert.equal(values.get('header:aria-expanded'), 'true')
  assert.equal(header.style.borderRadius, '8px 8px 0 0')
  assert.equal(body.style.display, 'grid')
  assert.equal(body.style.padding, '6px 12px 8px')
  assert.equal(body.style.gap, '6px')
  assert.equal(body.style.rowGap, '6px')
  assert.equal(body.style.columnGap, '6px')
  assert.equal(body.style.marginTop, '0')
  assert.equal(body.style.marginBottom, '0')
  assert.equal(chevron.className, 'fas fa-chevron-down')

  accordion.syncExpanded(section, header, body, chevron, false)
  assert.equal(values.get('section:data-open'), '0')
  assert.equal(values.get('header:aria-expanded'), 'false')
  assert.equal(header.style.borderRadius, '8px')
  assert.equal(body.style.display, 'none')
  assert.equal(chevron.className, 'fas fa-chevron-right')
})

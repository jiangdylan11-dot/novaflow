import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
const split = source('spine-split-runtime.js');
const brand = source('novaflow-brand-runtime.js');
function functionsBetween(text, start, end, sandbox) {
  vm.createContext(sandbox);
  const from = text.indexOf('  function ' + start + '(');
  const to = text.indexOf('  function ' + end + '(', from);
  assert.ok(from >= 0 && to > from);
  vm.runInContext(text.slice(from, to), sandbox);
  return sandbox;
}

test('UI remains mounted with only its generation category, open or collapsed', () => {
  const e = functionsBetween(split, 'splitEditorContentMounted', 'findAiCard', {
    ART_UI_HOST_SELECTOR: '[data-novaflow-art-ui-host="1"]',
    CONTROL_CATEGORY_ATTR: 'category', CONTROL_ACTION_ATTR: 'action',
    CN_ONE_CLICK_SPLIT: '一键拆图', CN_EDIT_MASK: '蒙版编辑', CN_EXPORT_PSD: 'PSD导出', textOf: () => '',
  });
  for (const open of [false, true]) {
    const panel = { open };
    const ui = { matches: () => true, querySelector: selector => selector === '[category="generate"]' ? panel : null };
    assert.equal(e.splitEditorContentMounted(ui), true);
    assert.equal(e.splitEditorContentMounted({ ...ui, querySelector: () => null }), false);
  }
  const drawing = { matches: () => false, querySelector: selector => ['[category="edit"]','[category="split"]','button[action="export"]'].includes(selector) ? {} : null };
  assert.equal(e.splitEditorContentMounted(drawing), true);
  assert.equal(e.splitEditorContentMounted({ ...drawing, querySelector: () => null }), false);
});

test('tab handoff commits the shared surfaces before paint and ignores obsolete switches', () => {
  const frames = [], calls = [];
  let visible = 'ui';
  const e = functionsBetween(split, 'handleArtSecondarySwitchClick', 'artPrimaryButtonFromTarget', {
    artSecondarySwitchToken: 0,
    CN_UI_TAB: 'UI', CN_DRAWING_TAB: '绘图', ART_UI_HOST_SELECTOR: 'ui', ART_DRAWING_HOST_SELECTOR: 'drawing',
    artSecondaryButtonFromTarget: button => button, textOf: button => button.label,
    isMountedCardVisible: () => true, isSplitCanvasRouteActive: () => true,
    resetSplitDrawingCategoriesForEntry: () => calls.push('reset'),
    visibleArtHostBySelector: selector => selector === visible,
    mount: () => calls.push('mount'), syncSplitWorkspace: () => calls.push('canvas'),
    splitDrawingCategoryExpanded: { generate: false },
    removeSplitWorkspaceSurface: () => { throw Error('shared surface must not be torn down'); },
    window: { requestAnimationFrame: fn => frames.push(fn), NovaFlowUiDesignBridge: { sync: () => calls.push('ui') }, __NovaFlowArtGenerate: { deactivate: () => calls.push('close-dock') } },
  });
  const button = label => ({ label, getAttribute: () => null });
  e.handleArtSecondarySwitchClick({ target: button('UI') });
  assert.deepEqual(calls, []);
  frames.shift()();
  assert.deepEqual(calls, ['mount','ui','canvas']);
  calls.length = 0;
  e.handleArtSecondarySwitchClick({ target: button('UI') });
  visible = 'drawing';
  e.handleArtSecondarySwitchClick({ target: button('绘图') });
  frames.shift()();
  assert.deepEqual(calls, ['reset']);
  frames.shift()();
  assert.deepEqual(calls, ['reset','mount','ui','close-dock','canvas']);
});

test('the UI accordion accepts its reduced category set and detects stale drawing panels', () => {
  class Panel {
    constructor(open = false) { this.open = open; }
    querySelector() { return null; }
    getAttribute() { return this.open ? '1' : '0'; }
  }
  const e = functionsBetween(split, 'splitDrawingSectionsForHost', 'syncSplitDrawingCategoryPanelChrome', {
    HTMLElement: Panel, ART_UI_HOST_SELECTOR: 'ui', CONTROL_CATEGORY_ATTR: 'category',
    splitDrawingControlSections: ['generate','edit','split','enhance'].map(id => ({ id })),
    splitDrawingCategoryExpanded: { generate: false, edit: false, split: false, enhance: false },
    nfTopbarHelpSplitDebug() {}, nfTopbarHelpDebugNode() {}, splitDrawingAccordionDebugState() {},
  });
  const panel = new Panel();
  const ui = { matches: () => true, querySelector: () => panel, querySelectorAll: () => [panel] };
  assert.equal(e.splitDrawingCategoryDomMatchesState(ui), true);
  panel.open = true;
  assert.equal(e.splitDrawingCategoryDomMatchesState(ui), false);
  e.splitDrawingCategoryExpanded.generate = true;
  assert.equal(e.splitDrawingCategoryDomMatchesState(ui), true);
  assert.equal(e.splitDrawingCategoryDomMatchesState({ ...ui, querySelectorAll: () => [panel, new Panel()] }), false);
});

test('reselecting either art tab suppresses teardown while real tab switches still proceed', () => {
  class Element {
    constructor(text, attrs = {}) { this.textContent = text; this.attrs = attrs; this.tagName = 'BUTTON'; }
    getAttribute(key) { return this.attrs[key] || null; }
    closest(selector) { return selector.includes('secondary-group') ? this.group : this; }
  }
  const drawing = new Element('绘图'), ui = new Element('UI');
  const group = new Element(''); group.children = [drawing, ui]; drawing.group = ui.group = group;
  const active = new Map(); const programmatic = new Set();
  const e = functionsBetween(brand, 'getArtDrawingSecondaryEventTarget', 'handlePrimaryEntryPostActivation', {
    document: { body: { classList: { contains: () => true } } },
    Element, HTMLElement: Element, HTMLButtonElement: Element,
    ART_DRAWING_SECONDARY_LABEL: '绘图', ART_DRAWING_SECONDARY_GROUP_KEY: '绘图|UI',
    SECONDARY_ACTIVE_BY_GROUP: active, SECONDARY_PROGRAMMATIC_ACTIVATION_BY_GROUP: programmatic,
    normalizeText: text => text.trim(), isArtDrawingSecondaryGroup: labels => labels.join('|') === '绘图|UI',
    inferSecondaryActiveLabel: () => '',
  });
  for (const tab of [drawing, ui]) {
    active.set('绘图|UI', tab.textContent); tab.attrs['aria-pressed'] = 'true';
    let stopped = false;
    const event = { target: tab, button: 0, preventDefault() {}, stopImmediatePropagation() { stopped = true; } };
    assert.equal(e.suppressRedundantArtDrawingSecondaryActivation(event), true);
    assert.equal(stopped, true);
    const other = tab === drawing ? ui : drawing;
    other.attrs['aria-pressed'] = 'false';
    assert.equal(e.suppressRedundantArtDrawingSecondaryActivation({ ...event, target: other }), false);
    programmatic.add('绘图|UI');
    assert.equal(e.suppressRedundantArtDrawingSecondaryActivation(event), false);
    programmatic.clear();
  }
});

test('generation synchronization does not close the independent UI layout extension', () => {
  class Panel {
    constructor(layout = false) { this.layout = layout; }
    hasAttribute() { return this.layout; }
    closest() { return root; }
  }
  const generate = new Panel(), layout = new Panel(true), edit = new Panel();
  const root = new Panel(); root.querySelectorAll = () => [generate, layout, edit];
  const closed = [];
  const e = functionsBetween(brand, 'closeArtGenerateSiblingPanels', 'closeArtGeneratePanelIfOpen', {
    HTMLElement: Panel, isArtGeneratePanelExpanded: () => true, clickArtGeneratePanelHeader: panel => closed.push(panel),
  });
  e.closeArtGenerateSiblingPanels(generate);
  assert.deepEqual(closed, [edit]);
});

test('right-column discovery rejects generated overlays and their descendants', () => {
  class Node {
    constructor(generated = false) { this.generated = generated; }
    closest(selector) { return this.generated && selector.includes('novaflow-art-generate') ? {} : null; }
    getBoundingClientRect() { return { width: 226, height: 900, left: 1400, right: 1626 }; }
  }
  const e = functionsBetween(split, 'isRightPanelRootCandidate', 'rightPanelRootCandidateScore', {
    HTMLElement: Node, mountedCard: null, RIGHT_WORKSPACE_ID: 'split-right', WORKSPACE_OVERLAY_ID: 'split-overlay',
    window: { innerWidth: 1627, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  });
  assert.equal(e.isRightPanelRootCandidate(new Node()), true);
  assert.equal(e.isRightPanelRootCandidate(new Node(true)), false);
});

test('UI omits only the inline login view and switching back restores the drawing view', () => {
  class Node {
    constructor() { this.children = []; this.attributes = {}; this.ownerDocument = doc; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    closest() { return null; }
    addEventListener() {}
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
      this.parentElement = null;
    }
    appendChild(node) { node.remove(); this.children.push(node); node.parentElement = this; }
    insertBefore(node, next) { node.remove(); this.children.splice(this.children.indexOf(next), 0, node); node.parentElement = this; }
    replaceChildren(...children) { for (const node of [...this.children]) node.remove(); children.forEach(node => this.appendChild(node)); }
  }
  const doc = { createElement: () => new Node() }, calls = [];
  const auth = { mount: key => calls.push('mount:' + key), unmount: key => calls.push('unmount:' + key), createAuthorizationContext: () => 'unchanged' };
  const e = { NovaFlowClientAuth: auth, document: doc };
  vm.createContext(e); vm.runInContext(source('art-generate-mode.tool.js'), e);
  const host = new Node(), tool = e.NovaFlowArtGenerateModeTool;
  const ui = tool.mount({ host, showAccount: false });
  assert.equal(host.children.includes(ui.accountSlot), false);
  assert.deepEqual(calls, []);
  const drawing = tool.mount({ host });
  assert.equal(drawing, ui);
  assert.equal(host.children[0], drawing.accountSlot);
  assert.deepEqual(calls, ['mount:art-generate']);
  tool.mount({ host, showAccount: false });
  tool.mount({ host, showAccount: false });
  assert.equal(host.children.includes(ui.accountSlot), false);
  assert.deepEqual(calls, ['mount:art-generate', 'unmount:art-generate']);
  assert.equal(auth.createAuthorizationContext(), 'unchanged');
});

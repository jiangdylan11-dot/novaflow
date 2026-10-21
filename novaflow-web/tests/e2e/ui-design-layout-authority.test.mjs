import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let assertionCount = 0;
const check = new Proxy(assert, { get(target, name) {
  const method = target[name];
  return typeof method === 'function' ? (...args) => { assertionCount += 1; return Reflect.apply(method, target, args); } : method;
} });
after(() => console.log(`Layout authority assertions: ${assertionCount}`));

const portrait = () => ({ id: 'portrait-source', role: 'reference', width: 576, height: 1250, dataUrl: 'data:image/png;base64,original-portrait-ui-pixels' });
const draft = () => ({ id: 'draft-layout', data: { canvasSize: { width: 236, height: 512 }, blocks: [
  { x: 8, y: 10, width: 220, height: 90, purpose: '每日登录' },
  { x: 8, y: 104, width: 220, height: 260, purpose: '老虎机锦标赛' },
  { x: 8, y: 380, width: 220, height: 90, purpose: '邀请好友' },
] } });

function environment(references = [portrait()]) {
  const nodes = [], exports = [], analyses = [];
  const layoutNode = draft(), slots = [...references];
  function node(tag) {
    const value = { tag, style: {}, children: [], attributes: {}, listeners: {},
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(name, data) { this.attributes[name] = data; }, getAttribute(name) { return this.attributes[name]; },
      addEventListener(name, callback) { this.listeners[name] = callback; }, removeEventListener() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, remove() {}, contains() { return false; },
    };
    nodes.push(value); return value;
  }
  const document = { createElement: node, body: node('body'), querySelector() { return null; }, getElementById() { return null; } };
  const leftHost = node('left'); leftHost.ownerDocument = document;
  const noop = () => {};
  const state = { provider: 'local', mode: 'img2img', width: 576, height: 1250, prompt: '按图1布局做中国生肖主题老虎机，迪士尼动画风格', negativePrompt: '' };
  const api = { state, references: () => slots, referenceLimit: () => 2,
    setReference: (index, value) => { slots[index] = value; }, render: noop, refreshReferences: () => true,
  };
  let workbenchOptions;
  const editor = { getLayout: () => layoutNode, getSelection: () => ({}), useLayout: noop, showLayout: noop,
    getActiveGeneratorId: () => 'generator', patchGeneratorOutput: noop, addBlock: noop, destroy: noop,
  };
  const store = { getState: () => ({ project: {}, resources: [], results: [], settings: { assistantEngine: 'grok' } }),
    patchProject: noop, subscribe: () => noop,
  };
  const context = { AbortController, setTimeout, clearTimeout, console, document,
    addEventListener: noop, removeEventListener: noop, requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    MutationObserver: class { observe() {} disconnect() {} },
    __NovaFlowArtGenerate: api,
    NovaFlowLeftPanelAccordion: { headerStyle: () => ({}), titleStyle: () => ({}), iconStyle: () => ({}), labelStyle: () => ({}),
      chevronClass: () => '', chevronStyle: () => ({}), bodyStyle: () => ({}), panelStyle: () => ({}), syncExpanded: noop },
    NovaFlowUiDesignWorkbench: { mount: options => { workbenchOptions = options; return editor; } },
    NovaFlowUiDesignInspectorTool: { mount: () => ({ update: noop, destroy: noop }) },
    NovaFlowUiDesignLayoutGuide: { createCleanLayoutGuide: structure => { exports.push(structure); return { dataUrl: 'data:image/png;base64,published-guide-' + exports.length }; } },
    NovaFlowArtGenerateModels: { capabilityFor: () => ({ engine: 'qwen-2.1' }) },
    NovaFlowUiDesignAssistantWorkflow: { run: async input => { analyses.push(input); return { prompt: '按图片原完整布局替换生肖主题内容', uiPlan: null }; } },
  };
  context.window = context; vm.createContext(context);
  for (const name of ['ui-design-prompt.pipeline.js', 'ui-design-style-reference.js', 'ui-design.drawing.js']) {
    vm.runInContext(readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8'), context);
  }
  const drawing = context.NovaFlowUiDesignDrawing;
  drawing.mount({ leftHost, store });
  const input = limit => drawing.inputFor({ state, references: slots, referenceLimit: limit ?? 2 });
  return { context, drawing, state, slots, exports, analyses, layoutNode, input,
    publish: () => nodes.find(value => value.textContent === '生成布局参考').listeners.click(),
    changed: () => workbenchOptions.onLayoutChange(),
  };
}

test('unpublished editor drafts cannot displace a sole complete portrait UI or reach the native edit prompt', async () => {
  const source = portrait(); source.role = 'asset';
  const e = environment([source]);
  const input = e.input(1);
  check.equal(e.exports.length, 0);
  check.equal(input.references.length, 1);
  check.equal(input.references[0].role, 'layout');
  check.equal(input.references[0].dataUrl, source.dataUrl);
  check.equal(input.references[0].width, 576); check.equal(input.references[0].height, 1250);
  check.equal(input.structure.regions.length, 0);
  check.equal(input.preserveLayout, true);
  const prepared = await e.drawing.prepare({ state: e.state, references: e.slots, referenceLimit: 1 });
  check.equal(e.analyses.length, 1);
  check.equal(e.analyses[0].references.length, 1);
  check.equal(e.analyses[0].structure.regions.length, 0);
  check.equal(prepared.references[0].dataUrl, source.dataUrl);
  check.equal(prepared.uiPlan.layoutReference, 1);
  check.equal(prepared.references[0].uiLayoutId, undefined);
  check.doesNotMatch(prepared.promptSnapshot.prompt, /每日登录|老虎机锦标赛|邀请好友|自建布局定位图/);
  check.equal(e.exports.length, 0);
});

test('unpublished blocks are not a layout image and fail before any planning request', async () => {
  const e = environment([]);
  check.throws(() => e.input(), /必须有布局图/);
  await check.rejects(e.drawing.prepare({ state: e.state, references: e.slots, referenceLimit: 2 }), /必须有布局图/);
  check.equal(e.exports.length, 0);
  check.equal(e.analyses.length, 0);
});

test('explicitly publishing a guide permits live refresh without adding slots or mutating source pixels', () => {
  const source = portrait(), e = environment([source]);
  e.publish();
  check.equal(e.exports.length, 1);
  check.equal(e.slots.length, 2);
  check.equal(e.slots[1].uiLayoutId, e.layoutNode.id);
  const savedGuidePixels = e.slots[1].dataUrl;
  e.layoutNode.data.blocks = [{ x: 12, y: 24, width: 200, height: 340, purpose: '用户新布局' }];
  const input = e.input(2);
  check.equal(e.exports.length, 2);
  check.equal(input.references.length, 2);
  check.equal(input.references[0].dataUrl, source.dataUrl);
  check.equal(input.references[1].uiLayoutId, e.layoutNode.id);
  check.equal(input.references[1].uiStructure.regions[0].purpose, '用户新布局');
  check.equal(input.structure.regions[0].x, 12);
  check.equal(e.slots[1].dataUrl, savedGuidePixels);
  check.notEqual(input.references[1].dataUrl, savedGuidePixels);
  check.throws(() => e.input(1), /最多支持 1 张参考图（包含自建布局图）/);
});

test('removing a published guide restores source authority and layout changes cannot resurrect it', () => {
  const source = portrait(), e = environment([source]);
  e.publish();
  e.slots[1] = null;
  e.layoutNode.data.blocks[0].purpose = '删除后不应复活的布局';
  e.changed();
  const input = e.input(1);
  check.equal(e.exports.length, 1);
  check.equal(input.references.length, 1);
  check.equal(input.references[0].dataUrl, source.dataUrl);
  check.equal(input.references[0].role, 'layout');
  check.equal(input.references[0].uiLayoutId, undefined);
  check.equal(input.structure.regions.length, 0);
  e.slots[0] = null;
  check.throws(() => e.input(), /必须有布局图/);
  check.equal(e.exports.length, 1);
});

test('an imported published guide is not overwritten by a different live editor layout', () => {
  const saved = { id: 'other-guide', role: 'layout', uiLayoutId: 'other-layout', dataUrl: 'data:image/png;base64,other-guide',
    uiStructure: { width: 576, height: 1250, regions: [{ x: 18, y: 30, width: 400, height: 720, purpose: '已发布独立布局' }] } };
  const e = environment([saved]);
  const input = e.input(1);
  check.equal(e.exports.length, 0);
  check.equal(input.references[0].dataUrl, saved.dataUrl);
  check.equal(input.references[0].uiLayoutId, 'other-layout');
  check.equal(input.structure.width, 576);
  check.equal(input.structure.regions[0].purpose, '已发布独立布局');
  check.doesNotMatch(JSON.stringify(input.structure), /每日登录|老虎机锦标赛|邀请好友/);
});

test('source-only editing needs no guide renderer and keeps slot mentions and capacity intact', () => {
  const source = portrait(), style = { role: 'style', id: 'style', dataUrl: 'data:image/png;base64,style-pixels' };
  const e = environment([source, null, style]);
  delete e.context.NovaFlowUiDesignLayoutGuide;
  e.state.prompt = '图1是原完整布局，图3只提供画风';
  const input = e.input(2);
  check.equal(input.references.length, 2);
  check.equal(input.references[0].role, 'layout');
  check.equal(input.references[0].dataUrl, source.dataUrl);
  check.equal(input.references[1].dataUrl, style.dataUrl);
  check.equal(input.prompt, '@参考图1是原完整布局，@参考图2只提供画风');
  check.equal(input.structure.regions.length, 0);
  check.throws(() => e.input(1), /最多支持 1 张参考图/);
  check.equal(e.exports.length, 0);
});

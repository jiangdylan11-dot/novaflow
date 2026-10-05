import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
function environment({ references = [], blocks = [], prompt = '更换深海主题，重新设计按钮造型', assistant } = {}) {
  const optimized = [], generated = [], guides = [];
  const generator = { id: 'generator', type: 'generator', data: { generationSettings: { provider: 'local', prompt }, output: { width: 1280, height: 720 } } };
  const nodes = [generator], edges = [];
  references.forEach((reference, index) => {
    nodes.push({ id: 'reference-' + index, type: 'reference', data: { resourceId: reference.id, role: reference.role } });
    edges.push({ fromNodeId: 'reference-' + index, toNodeId: generator.id, kind: 'reference' });
  });
  if (blocks.length) {
    nodes.push({ id: 'layout', type: 'layout', data: { blocks, canvasSize: { width: 1280, height: 720 } } });
    edges.push({ fromNodeId: 'layout', toNodeId: generator.id, kind: 'layout' });
  }
  const state = { project: { width: 1280, height: 720, graph: { schemaVersion: 2, nodes, edges, lineage: [] } }, resources: references, results: [], settings: {} };
  const store = { getState: () => state };
  const sandbox = {
    AbortController, console, setTimeout, clearTimeout,
    NovaFlowUiDesignStructureTool: { normalizeGraph: graph => graph },
    NovaFlowUiDesignProjectResource: { createProjectStore: () => store },
    NovaFlowUiDesignLayoutGuide: { createCleanLayoutGuide: project => {
      guides.push(project);
      return { clean: true, editorSnapshot: false, dataUrl: 'data:image/png;base64,actual-layout', semantic: { width: 1280, height: 720, regions: project.blocks } };
    } },
    NovaFlowUiDesignAssistantWorkflow: { run: async input => {
      optimized.push(input);
      return assistant ? assistant(input) : { prompt: input.prompt, uiPlan: {
        version: 1, layoutMode: 'preserve', layoutReference: 1, visualMode: 'theme-redesign',
        references: input.references.map((reference, index) => ({ index: index + 1, role: reference.role === 'style' ? 'style' : 'layout' })),
        layoutChanges: [], preserve: [], grids: [],
      } };
    } },
    NovaFlowUiDesignGenerateWorkflow: {
      providerCapability: provider => ({ provider, engine: 'qwen-2.1', externalReferenceLimit: 10, totalReferenceLimit: 10, reservedLayoutReferences: 0 }),
      run: async options => { generated.push(options); throw new Error('captured generation boundary'); },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source('ui-design-prompt.pipeline.js'), sandbox);
  vm.runInContext(source('ui-design.bridge.js'), sandbox);
  return { optimized, generated, guides, state, run: () => sandbox.NovaFlowUiDesignBridge.runGeneration({ generatorNodeId: generator.id }) };
}

test('node UI generation rejects text-only and multi-image auxiliary inputs before assistant or generation', async () => {
  for (const references of [[], [
    { id: 'style', role: 'style', dataUrl: 'data:image/png;base64,style' },
    { id: 'character', role: 'character', dataUrl: 'data:image/png;base64,character' },
  ]]) {
    const e = environment({ references });
    await assert.rejects(e.run(), /必须有布局图|缺少布局图/);
    assert.equal(e.optimized.length, 0);
    assert.equal(e.generated.length, 0);
  }
});

test('a single style-labelled image is the actual layout and enters the Qwen form compiler', async () => {
  const reference = { id: 'only-image', role: 'style', dataUrl: 'data:image/png;base64,source' };
  const e = environment({ references: [reference] });
  await assert.rejects(e.run(), /captured generation boundary/);
  assert.equal(e.optimized[0].references[0].role, 'layout');
  assert.equal(e.optimized[0].targetEngine, 'qwen-2.1');
  assert.equal(e.generated[0].refs[0].role, 'layout');
  assert.equal(e.generated[0].refs[0].dataUrl, reference.dataUrl);
  assert.equal(e.generated[0].state.uiNativeEditPrompt, true);
  assert.match(e.generated[0].prompt, /轮廓|构造/);
  assert.equal(reference.role, 'style', 'normalization must not mutate the saved reference');
});

test('self-authored layout blocks become a real image before assistant and reorder with compiler image numbers', async () => {
  const e = environment({
    references: [{ id: 'style', role: 'style', dataUrl: 'data:image/png;base64,style' }],
    blocks: [{ id: 'playfield', x: 300, y: 100, width: 600, height: 400, purpose: '玩法区' }],
    prompt: '@参考图1只提供风格，更换深海主题',
    assistant: input => ({ prompt: input.prompt, uiPlan: {
      version: 1, layoutMode: 'preserve', layoutReference: 2, visualMode: 'theme-redesign',
      references: [{ index: 1, role: 'style' }, { index: 2, role: 'layout' }], layoutChanges: [], preserve: [], grids: [],
    } }),
  });
  await assert.rejects(e.run(), /captured generation boundary/);
  assert.equal(e.guides.length, 1);
  assert.equal(e.optimized[0].references.length, 2);
  assert.equal(e.optimized[0].references[1].uiLayoutId, 'layout');
  assert.equal(e.optimized[0].references[1].dataUrl, 'data:image/png;base64,actual-layout');
  const output = e.generated[0];
  assert.equal(output.refs.length, 2);
  assert.equal(output.refs[0].role, 'layout');
  assert.equal(output.refs[0].dataUrl, 'data:image/png;base64,actual-layout');
  assert.equal(output.refs[1].role, 'style');
  assert.match(output.prompt, /<image2>只提供风格/);
  assert.equal(Object.keys(output.state.promptMentionBindings).length, 0);
});

test('self-authored layout images count toward the model reference limit before optimization', async () => {
  const e = environment({
    references: Array.from({ length: 10 }, (_, index) => ({ id: 'image-' + index, role: 'style', dataUrl: 'data:image/png;base64,' + index })),
    blocks: [{ id: 'playfield', x: 300, y: 100, width: 600, height: 400 }],
  });
  await assert.rejects(e.run(), /最多支持 10 张参考图/);
  assert.equal(e.optimized.length, 0);
  assert.equal(e.generated.length, 0);
});

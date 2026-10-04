const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../renderer/ai-sequence-minimax-h3.workflow.js'), 'utf8');
function load(storage = new Map()) {
  const root = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  vm.runInNewContext(source, { globalThis: root });
  return root.NovaFlowAiSequenceMiniMaxH3Workflow;
}
const one = (graph, type) => Object.values(graph).find(node => node.class_type === type);
const references = { t2v: {}, i2v: { firstFrame: 'first.png' }, fl2v: { firstFrame: 'first.png', lastFrame: 'last.png' } };

test('PDMD binds the unfused base, one matching adapter, fixed steps and original shifts in all supported modes', () => {
  const api = load();
  for (const profile of api.PROFILES.filter(item => item.adapter)) {
    for (const [mode, refs] of Object.entries(references)) for (const acceleration of ['off', 'sage']) {
      const options = { profile: profile.id, mode, acceleration, prompt: 'A paper boat floating on calm water.', ...refs };
      const graph = api.buildWorkflow(options);
      assert.equal(api.validateWorkflow(graph, options), true);
      assert.equal(one(graph, 'UNETLoader').inputs.unet_name, profile.checkpoint);
      const adapters = Object.values(graph).filter(node => node.class_type === 'LoraLoaderModelOnly');
      assert.equal(adapters.length, 1);
      assert.equal(adapters[0].inputs.lora_name, profile.adapter);
      assert.equal(adapters[0].inputs.strength_model, 1);
      assert.equal(one(graph, 'BasicScheduler').inputs.steps, profile.steps);
      assert.equal(one(graph, 'KSamplerSelect').inputs.sampler_name, 'euler');
      assert.equal(one(graph, 'MiniMaxH3SigmaShift').inputs.shift_video, 12);
      assert.equal(one(graph, 'MiniMaxH3SigmaShift').inputs.shift_audio, 3);
      const patched = api.patchWorkflow(JSON.parse(api.getWorkflowJson(options)), options);
      assert.equal(api.validateWorkflow(patched, options), true);
      for (const mutate of [
        g => { one(g, 'UNETLoader').inputs.unet_name = api.PROFILES[0].checkpoint; },
        g => { one(g, 'LoraLoaderModelOnly').inputs.strength_model = 0.5; },
        g => { one(g, 'LoraLoaderModelOnly').inputs.lora_name = 'wrong.safetensors'; },
        g => { one(g, 'MiniMaxH3SigmaShift').inputs.shift_video = 8; },
        g => { one(g, 'BasicScheduler').inputs.model = ['1', 0]; },
        g => { one(g, 'BasicGuider').inputs.model = ['1', 0]; },
      ]) {
        const invalid = JSON.parse(JSON.stringify(graph)); mutate(invalid);
        assert.throws(() => api.validateWorkflow(invalid, options));
      }
    }
    assert.equal(api.supportsMode(profile.id, 'multi_reference'), false);
    assert.throws(() => api.buildWorkflow({ profile: profile.id, mode: 'r2v', referenceImages: ['first.png'], prompt: 'A boat.' }), /多参考/);
    assert.throws(() => api.buildWorkflow({ profile: profile.id, mode: 't2v', steps: profile.steps === 2 ? 4 : 2 }), /PDMD 必须/);
    assert.throws(() => api.buildWorkflow({ profile: profile.id, mode: 't2v', loras: [{ name: 'style.safetensors' }] }), /仅加载内置/);
  }
});

test('profile selection and independent controls persist without changing TURBO', () => {
  const storage = new Map(), api = load(storage);
  const options = { profile: 'beta5_int8', mode: 't2v', prompt: 'A boat.' };
  const original = JSON.stringify(api.buildWorkflow(options));
  api.saveProfileSettings('beta5_int8', { steps: 6, durationSeconds: 8 });
  api.setSelectedProfile('pdmd_4step');
  api.saveProfileSettings('pdmd_4step', { durationSeconds: 3, steps: 99 });
  let restored = load(storage);
  assert.equal(restored.getSelectedProfile(), 'pdmd_4step');
  assert.equal(restored.getProfileSettings().steps, 4);
  assert.equal(restored.getProfileSettings().durationSeconds, 3);
  restored.setSelectedProfile('pdmd_2step');
  assert.equal(restored.getProfileSettings().steps, 2);
  assert.equal(restored.getProfileSettings('beta5_int8').steps, 6);
  assert.equal(JSON.stringify(restored.buildWorkflow(options)), original);
  assert.equal(one(restored.buildWorkflow(options), 'LoraLoaderModelOnly'), undefined);
});

test('the shipped browser intent preserves the selected profile when the worker builds it', async () => {
  const { createWorkflowHost } = await import('../../worker/src/comfy/workflow-host.mjs');
  const host = await createWorkflowHost({ rendererDir: path.join(__dirname, '../../worker-renderer') });
  const browser = { localStorage: { getItem: () => null, setItem: () => {} }, NovaFlowWebRuntime: {
    serverOnly: (module, method, args) => ({ module, method, options: args[0] }),
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../web-dist/ai-sequence-minimax-h3.workflow.js'), 'utf8'), { globalThis: browser });
  for (const profile of ['beta5_int8', 'pdmd_4step', 'pdmd_2step']) {
    const options = { profile, mode: 't2v', prompt: 'A boat.' };
    const intent = browser.NovaFlowAiSequenceMiniMaxH3Workflow.buildWorkflow(options);
    assert.equal(intent.options.profile, profile);
    const graph = await host.buildGraph(intent);
    const expected = load().buildWorkflow(options);
    assert.equal(one(graph, 'UNETLoader').inputs.unet_name, one(expected, 'UNETLoader').inputs.unet_name);
    assert.equal(one(graph, 'BasicScheduler').inputs.steps, one(expected, 'BasicScheduler').inputs.steps);
    assert.equal(one(graph, 'LoraLoaderModelOnly')?.inputs.lora_name, one(expected, 'LoraLoaderModelOnly')?.inputs.lora_name);
  }
});

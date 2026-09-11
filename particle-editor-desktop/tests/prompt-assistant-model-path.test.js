const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const functionSource = source.slice(
  source.indexOf('function resolvePromptAssistantReverseModelPath('),
  source.indexOf('function promptAssistantModelWeightFiles('),
);

test('desktop uses configured model location without changing the shared models root', () => {
  const configured = 'E:\\ComfyUI\\models\\prompt_generator\\model';
  const override = 'F:\\models\\override';
  const legacy = 'E:\\old-download\\model';
  const env = {};
  const available = new Set([configured]);
  const resolve = vm.runInNewContext(`(${functionSource})`, {
    path: path.win32,
    process: { env },
    readNovaFlowRuntimeConfig: () => ({}),
    NOVAFLOW_PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH: legacy,
    NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME: 'model',
    isPromptAssistantReverseModelDir: (candidate) => available.has(candidate),
  });
  const config = { modelsPath: 'E:\\NovaFlow\\models', promptAssistantReverseModelPath: configured };
  assert.equal(resolve(config), configured);
  assert.equal(config.modelsPath, 'E:\\NovaFlow\\models');
  env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH = override;
  available.add(override);
  assert.equal(resolve(config), override);
  delete env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH;
  available.clear();
  available.add(legacy);
  assert.equal(resolve(config), legacy);
  assert.match(source, /promptAssistantReverseModelPath: String\(data\.promptAssistantReverseModelPath \|\| ""\)/);
});

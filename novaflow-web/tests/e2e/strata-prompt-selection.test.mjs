import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPromptAssistant } from '../../worker/src/prompt-assistant.mjs';

test('Flash is the default local brain; legacy diagnostics require an explicit selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nf-strata-selection-'));
  const runtimeJsonPath = join(dir, 'runtime.json'), configPath = join(dir, 'strata-prompt.json');
  const originalBackend = process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND;
  const originalConfig = process.env.NOVAFLOW_STRATA_CONFIG;
  const create = extra => createPromptAssistant({ runtimeJsonPath, strataConfigPath: configPath, ...extra });
  try {
    delete process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND;
    delete process.env.NOVAFLOW_STRATA_CONFIG;
    await writeFile(runtimeJsonPath, JSON.stringify({ installPath: dir, modelsPath: join(dir, 'models') }));
    assert.equal(create().status().analysisBackend, 'strata');
    await writeFile(configPath, JSON.stringify({ enabled: false, analysisBackend: 'strata' }));
    assert.equal(create().status().analysisBackend, 'strata');
    await writeFile(configPath, JSON.stringify({ enabled: true, analysisBackend: 'strata' }));
    const automatic = create().status();
    assert.equal(automatic.analysisBackend, 'strata');
    assert.equal(automatic.supportsOriginalImages, true);
    assert.equal(automatic.enabled, false, 'a selection cannot claim the absent candidate weights are installed');
    assert.equal(create({ analysisBackend: 'pe' }).status().modelType, 'qwen35_pe_i2i');
    process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND = 'pe';
    assert.equal(create().status().modelType, 'qwen35_pe_i2i');
    assert.equal(create({ analysisBackend: 'strata' }).status().analysisBackend, 'strata');
    process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND = 'strata';
    assert.equal(create({ analysisBackend: 'pe' }).status().modelType, 'qwen35_pe_i2i');
    assert.equal(create({ analysisBackend: 'legacy-nf4' }).status().modelType, 'qwen3_vl_8b_abliterated_nf4', 'legacy diagnostics remain an explicit choice');
    await writeFile(configPath, JSON.stringify({ enabled: false, analysisBackend: 'strata' }));
    assert.equal(create().status().analysisBackend, 'strata', 'an explicit environment choice wins over the local enable flag');
    delete process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND;
    await writeFile(configPath, JSON.stringify({ enabled: true, analysisBackend: 'strata' }));
    assert.equal(createPromptAssistant({ runtimeJsonPath }).status().analysisBackend, 'strata', 'runtime-adjacent config is discovered without modifying the caller');
  } finally {
    if (originalBackend === undefined) delete process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND; else process.env.NOVAFLOW_PROMPT_ASSISTANT_BACKEND = originalBackend;
    if (originalConfig === undefined) delete process.env.NOVAFLOW_STRATA_CONFIG; else process.env.NOVAFLOW_STRATA_CONFIG = originalConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

// 小桃 asks once which picture model to draw with when the user named none, then acts on the
// answer (Dylan, 2026-11-10). The planner reads the lines from currentFoart.art.modelLines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { FOART_TOOL_SYSTEM } from '../packages/shared/src/foart-tool-plan.mjs';

const renderer = new URL('../renderer/', import.meta.url);
function load(name) {
  const context = createContext({ module: { exports: {} }, console });
  context.globalThis = context;
  context.window = context;
  runInNewContextSafe(readFileSync(new URL(name, renderer), 'utf8'), context, name);
  return context.module.exports;
}
function runInNewContextSafe(source, context, name) {
  runInContext(source, context, { filename: name });
}

test('the planner contract asks once for the model line and then switches the select before drawing', () => {
  assert.match(FOART_TOOL_SYSTEM, /currentFoart\.art\.modelLines/);
  assert.match(FOART_TOOL_SYSTEM, /modelControlId/);
  assert.match(FOART_TOOL_SYSTEM, /answer once with status clarify/);
  assert.match(FOART_TOOL_SYSTEM, /never ask again/);
  assert.match(FOART_TOOL_SYSTEM, /first set_control currentFoart\.art\.modelControlId/);
  // The generated browser copy carries the same rule.
  const copy = readFileSync(new URL('foart-tool-contract.js', renderer), 'utf8');
  assert.match(copy, /currentFoart\.art\.modelLines/);
  const edge = readFileSync(new URL('../supabase/functions/_art-shared/foart-tool-plan.mjs', import.meta.url), 'utf8');
  assert.match(edge, /currentFoart\.art\.modelLines/);
});

test('model lines name every drawable line with its credits a picture, a note and the selected one', () => {
  const models = load('art-generate-model.resource.js');
  const quote = ({ mode, model }) => {
    if (model === 'gpt-image-2.6') return { credits: 23, billingMode: 'token' };
    if (model === 'gpt-image-2.5') return mode === 'img2img' ? { credits: 20, billingMode: 'fixed' } : { credits: 23, billingMode: 'token' };
    const fixed = { 'nano-banana-2.1': 13, 'gpt-image-2': mode === 'img2img' ? 11 : 4, 'grok-imagine': 8 };
    return { credits: fixed[model], billingMode: 'fixed' };
  };
  const lines = JSON.parse(JSON.stringify(models.modelLines({ provider: 'gpt', cloudImageModel: 'nano-banana-2.1', mode: 'img2img' }, quote)));
  assert.deepEqual(lines.map((line) => [line.value, line.label, line.credits, line.selected]), [
    ['local', 'Qwen（本地）', 0, false],
    ['gpt', 'GPT Image 2.5', 20, false],
    ['gpt:nano-banana-2.1', 'Nano Banana 2.1', 13, true],
    ['gpt:gpt-image-2', 'GPT Image 2', 11, false],
    ['gpt:grok-imagine', 'Grok 图像', 8, false],
    ['gpt:gpt-image-2.6', 'GPT Image 2.6', null, false],
  ]);
  assert.ok(lines.every((line) => typeof line.note === 'string' && line.note.length > 0));
  // Text-to-image on GPT Image 2.5 is billed by usage: no fixed number is promised.
  const text = JSON.parse(JSON.stringify(models.modelLines({ provider: 'local', mode: 'txt2img' }, quote)));
  assert.equal(text.find((line) => line.value === 'gpt').credits, null);
  assert.equal(text.find((line) => line.value === 'gpt:gpt-image-2').credits, 4);
  assert.equal(text.find((line) => line.value === 'local').selected, true);
  // Without a price card the lines still exist, just without numbers.
  const blind = JSON.parse(JSON.stringify(models.modelLines({ provider: 'local', mode: 'img2img' })));
  assert.equal(blind.length, 6);
  assert.equal(blind[2].credits, null);
  // Every value is an option of the 模型方式 select, so set_control can apply the answer.
  const values = new Set(models.providerOptions.map((option) => option.value));
  assert.ok(lines.every((line) => values.has(line.value)));
});

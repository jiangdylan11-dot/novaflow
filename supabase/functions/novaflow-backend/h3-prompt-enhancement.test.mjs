import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as edge from './h3-prompt-enhance.mjs';
import { buildGrokPromptOptimizeRequest, normalizeMiniMaxH3PromptOutput, callGrokResponseWithVisualRetry } from './smart-ai-grok.workflow.mjs';
const require = createRequire(import.meta.url);
const local = require('../../../particle-editor-desktop/admin-server/h3-prompt-enhance.js');
const cases = JSON.parse(fs.readFileSync(new URL('../../../particle-editor-desktop/tests/fixtures/h3-prompt-enhance-cases.json', import.meta.url), 'utf8'));
const wrap = text => `integrated_multimodal_description: [Shot 1] ${text}\n\noverall_soundscape: N/A\n\nnon_diegetic_music: N/A`;

test('cloud and desktop share the optimization policy and outcomes', () => {
  assert.equal(edge.instruction, local.instruction);
  for (const item of cases) for (const implementation of [edge, local]) {
    const run = () => implementation.validate(wrap(item.result), item.source, item.requirement || '');
    if (item.ok) assert.equal(run(), wrap(item.result), item.name);
    else assert.throws(run, undefined, item.name);
  }
});

const fiveWrap = text => `【任务定位】\n文生视频，时长2秒。\n\n【说话者】\n无说话者\n\n【递进式详细提示词】\n0.0-2.0s：${text}\n\n【台词】\n无台词\n\n【连续性与约束】\n1. 保持主体身份和构图。`;
const request = source => buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'T2VA', durationSeconds:2, currentPrompt:source, visualSchema:'nf.h3.visual.v1', contentPolicy:{sensitiveVisualAnalysis:false, allSubjectsConfirmedAdult:false}}, 'test-model');
test('Grok request includes improvement policy and rejects narrative copy even if audio changes', () => {
  const source = '角色随后抬起右手，镜头固定。';
  const built = request(source);
  assert.equal(built.resultOptions.minimaxH3Enhance, true);
  assert.ok(built.body.input[0].content[0].text.includes(edge.instruction));
  assert.throws(() => normalizeMiniMaxH3PromptOutput(fiveWrap(source).replace('N/A', '轻微风声'), built.resultOptions), e => e.errorCode === 'h3_contract_enhancement_not_applied');
});

test('Grok retries a copy once, accepts a concrete loop, and never fabricates fallback success', async () => {
  const item = cases[1];
  for (const repaired of [true, false]) {
    const built = request(item.source);
    let calls = 0;
    const attempt = async body => {
      calls++;
      if (calls === 2) assert.match(JSON.stringify(body), /h3_contract_enhancement_not_applied/);
      const prompt = normalizeMiniMaxH3PromptOutput(fiveWrap(repaired && calls === 2 ? item.result : item.source), built.resultOptions);
      return { ok:true, data:{output_text:prompt}, providerCallCount:1 };
    };
    const work = callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, attempt);
    if (repaired) assert.match((await work).data.output_text, /回到起始/);
    else await assert.rejects(work);
    assert.equal(calls, 2);
  }
});

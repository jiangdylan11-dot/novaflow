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

// Base modes (text_video / image_video / first_last): the new renderer sends the bilingual flag and gets the official
// three fields as a {modelPrompt, displayPrompt} pair; a translate-only compile turns a finished Chinese prompt into English.
const fields = (narrative, soundscape, music = 'N/A') => `integrated_multimodal_description: ${narrative}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;
const t2v = {mode:'text_video', durationSeconds:6};
const citySource = '先是城市夜景全景，然后切到街角咖啡店里的女孩说：“到了。”';
const cityModel = fields('[Shot 1] Live-action, cinematic, a wide shot shows a city skyline at night. The camera holds a static shot.\n[Shot 2] At 00:03.000, the camera cuts to a medium shot of a girl in a corner café who looks up, and the girl with a soft voice (S1) says: <d>[Chinese] 到了。</d>', 'Distant traffic hums, then cups clink softly inside the café.');
const cityDisplay = fields('[Shot 1] 写实电影风格，夜晚城市天际线的全景。镜头保持固定。\n[Shot 2] At 00:03.000 镜头切到街角咖啡店里女孩的中景，她抬起头，嗓音轻柔的女孩 (S1) 说：<d>[Chinese] 到了。</d>', '远处车流低鸣，随后咖啡店里杯子轻轻碰响。');
const pair = (modelPrompt, displayPrompt) => JSON.stringify({modelPrompt, displayPrompt});
const baseRequest = (h3Mode, source, markers, head = [edge.instruction, edge.baseInstruction, edge.baseResultInstruction]) => buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode, durationSeconds:6, prompt:source,
  requirements:[...head, ...markers, `Protocol: ${h3Mode}; duration: 6.00 seconds.`, 'Source prompt:', source].join('\n')}, 'test-model');
const translateRequest = (h3Mode, source) => baseRequest(h3Mode, source, ['H3 compile: translate-only', 'H3 response format: bilingual-v1'], [edge.baseTranslateInstruction]);
const systemText = built => built.body.input[0].content[0].text;
const userText = built => built.body.input[1].content[0].text;

test('an explicit h3Mode wins over mode names in the requirements text', () => {
  const mention = 'Keep it unlike 多参, FL2VA 首尾帧 and I2VA examples.';
  const mode = (h3Mode, requirements = mention) => buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode, durationSeconds:5, prompt:'人物抬手', requirements}, 'test-model').resultOptions.minimaxH3Mode;
  assert.deepEqual(['text_video', 'T2VA', 'I2V', 'image_video', 'fl2v', 'first_last', 'multi_reference'].map(value => mode(value)),
    ['text_video', 'text_video', 'image_video', 'image_video', 'first_last', 'first_last', 'full_reference']);
  // Without an explicit mode the requirements are still scanned, in the old order.
  assert.equal(mode('', 'FL2VA; duration 8 seconds'), 'first_last');
  assert.equal(mode('', mention), 'full_reference');
  assert.equal(mode('', '一个人挥手'), 'text_video');
  // The base instructions never name another mode themselves.
  assert.equal(mode('', [edge.instruction, edge.baseInstruction, edge.baseResultInstruction, edge.baseTranslateInstruction].join('\n')), 'text_video');
});

test('base optimize with the bilingual flag asks Grok for the official pair; without it the five sections stay', () => {
  for (const h3Mode of ['text_video', 'image_video', 'first_last']) {
    const built = baseRequest(h3Mode, citySource, ['H3 response format: bilingual-v1']);
    assert.deepEqual(built.body.text.format.schema, JSON.parse(JSON.stringify(edge.baseResultSchema)));
    assert.ok(systemText(built).includes(edge.instruction) && systemText(built).includes(edge.baseInstruction));
    assert.ok(userText(built).includes(edge.baseResultInstruction));
    assert.match(userText(built), /\[Shot 2\] At 00:04\.000 镜头切到近景/);
    assert.doesNotMatch(userText(built) + systemText(built), /【任务定位】|five sections/);
    assert.equal(built.resultOptions.minimaxH3BaseResult, true);
    assert.equal(built.resultOptions.minimaxH3TranslateOnly, false);
    assert.equal(built.body.temperature, 0.35);
    const old = baseRequest(h3Mode, citySource, [], [edge.instruction, edge.formatInstruction]);
    assert.deepEqual(old.body.text.format.schema.required, edge.sectionFields);
    assert.ok(userText(old).includes(edge.formatInstruction));
    assert.equal(old.resultOptions.minimaxH3BaseResult, false);
  }
});

test('the base pair is normalized through validateBaseResult with the no-change gate on the Chinese display half', () => {
  const built = baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']);
  const result = JSON.parse(normalizeMiniMaxH3PromptOutput(pair(cityModel, cityDisplay), built.resultOptions));
  assert.equal(result.modelPrompt, edge.validateBaseFields(cityModel, {...t2v, language:'en'}));
  assert.equal(result.displayPrompt, edge.validateBaseFields(cityDisplay, {...t2v, language:'zh'}));
  assert.match(edge.composeBaseModelPrompt(result.modelPrompt, t2v), /^integrated_multimodal_description: \[Shot 1\] Live-action, cinematic, [^\n]+ \[Shot 2\] At 00:03\.000, the camera cuts to /);
  // Object halves from the strict schema are accepted as well.
  const objects = {modelPrompt:edge.parseBaseFields(cityModel).fields, displayPrompt:edge.parseBaseFields(cityDisplay).fields};
  assert.equal(normalizeMiniMaxH3PromptOutput(JSON.stringify(objects), built.resultOptions), JSON.stringify(result));
  const rejects = (text, options, code, message) => assert.throws(() => normalizeMiniMaxH3PromptOutput(text, options), error => {
    assert.equal(error.errorCode, code);
    assert.match(error.message, message);
    assert.notEqual(edge.validationIssue(error).reason, 'contract_invalid');
    return true;
  });
  rejects(pair(cityModel, cityModel), built.resultOptions, 'h3_contract_fields', /简体中文/);
  rejects(pair(cityModel.replace('00:03.000', '00:02.000'), cityDisplay), built.resultOptions, 'h3_contract_fields', /镜头或切换时间不一致/);
  rejects(pair(cityModel.replace('到了。', '走吧。'), cityDisplay), built.resultOptions, 'h3_contract_fields', /台词或屏幕文字不一致/);
  rejects(pair(cityModel.replace('a city skyline', '城市天际线'), cityDisplay), built.resultOptions, 'h3_contract_fields', /英文正文/);
  // Both halves dropping the line the user quoted still fails: the model half must carry it verbatim.
  const silent = text => text.replace(/, and the girl[^\n]*|，嗓音轻柔[^\n]*/, '.');
  rejects(pair(silent(cityModel), silent(cityDisplay)), built.resultOptions, 'h3_contract_fields', /^原台词未完整保留$/);
  // Returning the Chinese source unchanged as the display half is not an optimization.
  const rewrite = baseRequest('text_video', cityDisplay, ['H3 response format: bilingual-v1']);
  rejects(pair(cityModel, cityDisplay), rewrite.resultOptions, 'h3_contract_enhancement_not_applied', /复述|改写|原提示词/);
  // An English source is compared with the English half.
  const english = baseRequest('text_video', 'A wide shot of a city skyline at night, then a girl in a café says a line.', ['H3 response format: bilingual-v1']);
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(pair(cityModel, cityDisplay), english.resultOptions));
});

test('translate-only compile uses the translation instruction and schema, keeps the source as display and skips the no-change gate', () => {
  const built = translateRequest('text_video', cityDisplay);
  assert.deepEqual(built.body.text.format.schema, JSON.parse(JSON.stringify(edge.baseResultSchema)));
  assert.match(userText(built), /^H3 compile: translate-only$/m);
  assert.ok(userText(built).includes(edge.baseTranslateInstruction));
  assert.ok(systemText(built).startsWith("You are NovaFlow's MiniMax H3 prompt translator."));
  assert.ok(systemText(built).includes(edge.baseInstruction));
  assert.ok(!systemText(built).includes(edge.instruction), 'the improvement policy never reaches a translation');
  assert.equal(built.body.temperature, 0.1);
  assert.equal(built.resultOptions.minimaxH3TranslateOnly, true);
  // Whatever Grok echoes as the display half, the Chinese source stays the display.
  const result = JSON.parse(normalizeMiniMaxH3PromptOutput(pair(cityModel, cityDisplay.replace('镜头保持固定。', '')), built.resultOptions));
  assert.equal(result.displayPrompt, edge.validateBaseFields(cityDisplay, {...t2v, language:'zh'}));
  assert.equal(result.modelPrompt, edge.validateBaseFields(cityModel, {...t2v, language:'en'}));
  // A bare English fields text is read as the model half; an unfaithful translation fails parity.
  assert.equal(normalizeMiniMaxH3PromptOutput(cityModel, built.resultOptions), JSON.stringify(result));
  assert.throws(() => normalizeMiniMaxH3PromptOutput(pair(cityModel.replace(/\n\[Shot 2\][^\n]*/, ''), cityDisplay), built.resultOptions), /镜头或切换时间不一致/);
  assert.throws(() => normalizeMiniMaxH3PromptOutput(pair(cityDisplay, cityDisplay), built.resultOptions), /英文正文/);
  // The same flags route image_video and first_last.
  for (const h3Mode of ['image_video', 'first_last']) assert.equal(translateRequest(h3Mode, cityDisplay).resultOptions.minimaxH3BaseResult, true);
});

test('translate-only compile for 多参 uses the reference translation and schema without frames or a no-change gate', () => {
  const labels = 'Available resource labels: <Picture 1> = captured image slot multi_ref_image_1. Never invent a resource label.';
  const six = values => edge.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  const source = six(['<Subject 1>: 穿红色斗篷的少女，黑色长发。素材来源：<Picture 1>', '[reference generation] <Subject 1> 在雪地里奔跑。', '<Subject 1>: fully_preserved - 红色斗篷、黑色长发', '写实风格。[Shot 1] <Subject 1> 在雪地里向前奔跑，镜头跟随她移动。', '风声和踩雪的脚步声。', 'N/A']);
  const english = six(['<Subject 1>: A girl in a red cloak with long black hair. Source assets: <Picture 1>', '[reference generation] <Subject 1> runs across the snow.', '<Subject 1>: fully_preserved - red cloak, long black hair', 'Realistic style. [Shot 1] <Subject 1> runs forward across the snow as the camera tracks her.', 'Wind and footsteps crunching on snow.', 'N/A']);
  const built = buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:source,
    requirements:[labels, 'H3 response format: bilingual-v1', 'H3 compile: translate-only', 'Source prompt:', source].join('\n'),
    h3ReferenceFrames:[{label:'<Picture 1>', dataUrl:'data:image/png;base64,aGVsbG8='}]}, 'test-model');
  assert.equal(built.inputMeta.imageCount, 0);
  assert.deepEqual(built.body.text.format.schema.required, ['modelPrompt', 'displayPrompt', 'editPolicy']);
  assert.match(userText(built), /^H3 compile: translate-only$/m);
  assert.match(userText(built), /Translate only\. The source prompt is a finished Simplified Chinese H3 multi-reference prompt in the six fields/);
  assert.ok(systemText(built).includes(edge.referenceInstruction));
  const editPolicy = {preserveBackground:false, preserveMotion:false, sameShapeAppearanceOnly:false};
  const result = JSON.parse(normalizeMiniMaxH3PromptOutput(JSON.stringify({modelPrompt:english, displayPrompt:'改写过的显示稿', editPolicy}), built.resultOptions));
  assert.equal(result.displayPrompt, edge.validateReference(source, {...built.resultOptions, requireChineseOutput:true}));
  assert.equal(result.modelPrompt, edge.validateReference(english, {...built.resultOptions, requireChineseOutput:false}));
  assert.deepEqual(result.editPolicy, editPolicy);
  // The source is the display as the user wrote it: a mostly English prompt with one Chinese sentence is not gated.
  const mixed = english.replace('as the camera tracks her.', 'as the camera tracks her. 她停下来回头看。');
  const mixedBuilt = buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:mixed,
    requirements:[labels, 'H3 response format: bilingual-v1', 'H3 compile: translate-only', 'Source prompt:', mixed].join('\n')}, 'test-model');
  const translated = english.replace('as the camera tracks her.', 'as the camera tracks her. She stops and looks back.');
  assert.equal(JSON.parse(normalizeMiniMaxH3PromptOutput(JSON.stringify({modelPrompt:translated, displayPrompt:'x', editPolicy}), mixedBuilt.resultOptions)).displayPrompt,
    edge.validateReference(mixed, {...mixedBuilt.resultOptions, requireChineseOutput:false}));
  // Copying the untranslated sentence into the model half is not a translation, even below 多参's usual tolerance.
  assert.throws(() => normalizeMiniMaxH3PromptOutput(JSON.stringify({modelPrompt:mixed, displayPrompt:'x', editPolicy}), mixedBuilt.resultOptions), /英文正文/);
});

test('translate-only keeps a mixed-language source as typed and accepts quoted speech written as a <d> block', () => {
  const mixed = fields('[Shot 1] A girl walks through the park at golden hour while the camera slowly tracks her from the side, 阳光透过树叶洒下。', 'Birds and wind in the leaves.');
  const english = fields('[Shot 1] A girl walks through the park at golden hour while the camera slowly tracks her from the side, and sunlight filters through the leaves.', 'Birds and wind in the leaves.');
  const result = JSON.parse(normalizeMiniMaxH3PromptOutput(pair(english, 'x'), translateRequest('text_video', mixed).resultOptions));
  assert.deepEqual(result, {modelPrompt:edge.validateBaseFields(english, {...t2v, language:'en'}), displayPrompt:edge.validateBaseFields(mixed, t2v)});
  // An optimize still needs a Chinese display half from Grok.
  assert.throws(() => normalizeMiniMaxH3PromptOutput(pair(english, mixed), baseRequest('text_video', '女孩在公园散步', ['H3 response format: bilingual-v1']).resultOptions), /简体中文/);
  // Speech typed in quotes reaches the translator as an official <d> block; the display stays as typed.
  const quoted = fields('[Shot 1] 写实风格，女孩 (S1) 对着镜头说：“我们出发吧！”然后转身离开。镜头保持固定。', '脚步声。');
  const translating = translateRequest('text_video', quoted);
  assert.match(userText(translating), /\(S1\) 对着镜头说：<d>\[Chinese\] 我们出发吧！<\/d>然后/);
  assert.equal(translating.resultOptions.currentPrompt, quoted);
  assert.match(userText(baseRequest('text_video', quoted, ['H3 response format: bilingual-v1'])), /说：“我们出发吧！”/);
  // The official <d> dialogue and kept quotes both match the words of the source; other words do not.
  const says = words => fields(`[Shot 1] Live-action. The girl (S1) says to the camera: ${words} Then she turns and leaves. The camera holds a static shot.`, 'Footsteps.');
  for (const words of ['<d>[Chinese] 我们出发吧！</d>', '"我们出发吧！"']) {
    assert.equal(JSON.parse(normalizeMiniMaxH3PromptOutput(pair(says(words), quoted), translateRequest('text_video', quoted).resultOptions)).modelPrompt, edge.validateBaseFields(says(words), {...t2v, language:'en'}));
  }
  assert.throws(() => normalizeMiniMaxH3PromptOutput(pair(says('<d>[Chinese] 我们走吧！</d>'), quoted), translateRequest('text_video', quoted).resultOptions), /台词或屏幕文字不一致/);
});

test('the quoted line is kept verbatim unless the user asks to change the dialogue', () => {
  const source = '女孩在车站挥手说：“出发吧。”';
  const request = tail => buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'text_video', durationSeconds:6, prompt:source,
    requirements:[edge.instruction, edge.baseInstruction, edge.baseResultInstruction, 'H3 response format: bilingual-v1', 'Source prompt:', source + tail].join('\n')}, 'test-model').resultOptions;
  const answer = words => pair(fields(`[Shot 1] Live-action, cinematic, a medium shot of a girl at a train station who raises her right hand and waves${words ? `, and the girl (S1) says: <d>[Chinese] ${words}</d>` : '.'} The camera holds a static shot.`, 'Platform announcements echo and footsteps pass.'),
    fields(`[Shot 1] 写实电影风格，火车站里女孩的中景，她举起右手挥动${words ? `，女孩 (S1) 说：<d>[Chinese] ${words}</d>` : '。'}镜头保持固定。`, '站台广播回响，脚步声经过。'));
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer('我们走吧。'), request('\n把台词改成“我们走吧。”')));
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer('Let\'s go.'), request('\nChange the line to "Let\'s go."')));
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer(''), request('\n去掉台词')));
  // Asked for a new line, an answer without it is not accepted.
  assert.throws(() => normalizeMiniMaxH3PromptOutput(answer(''), request('\n把台词改成“我们走吧。”')), /原台词未完整保留/);
  assert.throws(() => normalizeMiniMaxH3PromptOutput(answer('我们走吧。'), request('')), /原台词未完整保留/);
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer('出发吧。'), request('')));
  // The edge runs the shared gate, so it reads the requirement the way the renderer does.
  for (const tail of ['\n把“出发吧。”改成“我们走吧。”', '\n让她改说“我们走吧。”']) assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer('我们走吧。'), request(tail)), tail);
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer(''), request('\n让她保持沉默，只挥手')));
  assert.throws(() => normalizeMiniMaxH3PromptOutput(answer(''), request('\n保留原台词，把镜头改成缓慢推近')), /原台词未完整保留/);
});

test('the repair body carries the instruction for the pair schema and the specific registered failure', async () => {
  const repairText = async (built, answer) => {
    const bodies = [];
    await assert.rejects(callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, async body => {
      bodies.push(body);
      return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(answer, built.resultOptions)}, providerCallCount:1};
    }));
    assert.equal(bodies.length, 2);
    return bodies[1].input.at(-1).content.at(-1).text;
  };
  const optimize = await repairText(baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']), pair(cityModel, cityModel));
  assert.ok(optimize.includes(edge.baseResultInstruction));
  assert.match(optimize, /Failed gate: h3_contract_fields\.\n具体失败项：请将画面与动作、环境声音和背景音乐改为简体中文/);
  assert.match(optimize, /Rebuild from the original images and requirements/);
  assert.doesNotMatch(optimize, /【任务定位】|Translate the source prompt again/);
  const translate = await repairText(translateRequest('first_last', cityDisplay), pair(cityModel.replace(/\n\[Shot 2\][^\n]*/, ''), cityDisplay));
  assert.ok(translate.includes(edge.baseTranslateInstruction));
  assert.match(translate, /具体失败项：H3 中英文提示词的镜头或切换时间不一致/);
  assert.match(translate, /Translate the source prompt again/);
  assert.doesNotMatch(translate, /【任务定位】|Rebuild from the original/);
});

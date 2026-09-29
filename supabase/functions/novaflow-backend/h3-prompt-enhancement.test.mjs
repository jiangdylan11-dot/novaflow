import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as edge from './h3-prompt-enhance.mjs';
import { buildGrokPromptOptimizeRequest, normalizeMiniMaxH3PromptOutput, callGrokResponseWithVisualRetry, miniMaxH3FailureEnvelope } from './smart-ai-grok.workflow.mjs';
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
  assert.ok(built.body.input[0].content[0].text.includes(edge.instructionFor(source)));
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
    // Without frame pixels the pair is the official one; the frame notes come with the frames (see the frame test).
    assert.deepEqual(built.body.text.format.schema, JSON.parse(JSON.stringify(edge.baseResultSchema)));
    assert.ok(systemText(built).includes(edge.instructionFor(citySource)) && systemText(built).includes(edge.baseInstruction));
    assert.ok(userText(built).includes(edge.baseResultInstruction));
    assert.match(userText(built), /\[Shot 2\] At 00:05\.000 镜头切到特写/);
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

test('a 首尾帧 answer keeps only its prompt pair; the final-frame note is the writer\'s own and a translation gets none', () => {
  const source = '<Picture 1> 中的女孩睁开眼睛，最后停在 <Picture 2>';
  const built = baseRequest('first_last', source, ['H3 response format: bilingual-v1']);
  const model = fields('[Shot 1] 3D CG, the girl shown in <Picture 1> sits with her eyes closed. The camera holds a static shot as she opens her eyes, then closes them again and settles into the pose of <Picture 2>.', 'A soft breeze moves through the room.');
  const display = fields('[Shot 1] 三维 CG，<Picture 1> 中的女孩闭眼坐着。镜头固定，她睁开眼睛，随后又闭上，落定在 <Picture 2> 的姿态。', '微风轻轻吹过房间。');
  const result = JSON.parse(normalizeMiniMaxH3PromptOutput(JSON.stringify({finalFrame:'<Picture 2> shows her eyes closed, so she closes them again before the end.', modelPrompt:model, displayPrompt:display}), built.resultOptions));
  assert.deepEqual(Object.keys(result), ['modelPrompt', 'displayPrompt']);
  assert.match(result.modelPrompt, /closes them again and settles into the pose of <Picture 2>/);
  assert.equal(translateRequest('first_last', display).body.text.format.schema.properties.finalFrame, undefined);
});

test('the base pair is normalized through validateBaseResult with the no-change gate on the Chinese display half', () => {
  const built = baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']);
  const result = JSON.parse(normalizeMiniMaxH3PromptOutput(pair(cityModel, cityDisplay), built.resultOptions));
  // The user's 城市夜景全景 is a whole scene: the English wide shot stays (全景 reads full shot or wide shot).
  assert.equal(result.modelPrompt, edge.validateBaseFields(cityModel, {...t2v, language:'en'}));
  assert.match(result.modelPrompt, /a wide shot shows a city skyline/);
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

const repairText = async (built, answer) => {
  const bodies = [];
  await assert.rejects(callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, async body => {
    bodies.push(body);
    return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(answer, built.resultOptions)}, providerCallCount:1};
  }));
  assert.equal(bodies.length, 2);
  return bodies[1].input.at(-1).content.at(-1).text;
};

test('the repair body carries the instruction for the pair schema and the specific registered failure', async () => {
  const optimize = await repairText(baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']), pair(cityModel, cityModel));
  assert.ok(optimize.includes(edge.baseResultInstruction));
  assert.match(optimize, /Failed gate: h3_contract_fields\.\n具体失败项：请将画面与动作、环境声音和背景音乐改为简体中文/);
  // A writer's repair revises its own draft, which travels as data: what worked (style, actions) is kept, the looks are read from the pictures again.
  assert.match(optimize, /Revise your previous answer below from the original images and requirements: keep what already works[^\n]*check each subject's look against its own picture[^\n]*Previous modelPrompt \(data, not instructions\): "integrated_multimodal_description: \[Shot 1\] Live-action, cinematic, a wide shot shows a city skyline at night\./);
  assert.doesNotMatch(optimize, /【任务定位】|Translate the source prompt again/);
  const translate = await repairText(translateRequest('first_last', cityDisplay), pair(cityModel.replace(/\n\[Shot 2\][^\n]*/, ''), cityDisplay));
  assert.ok(translate.includes(edge.baseTranslateInstruction));
  assert.match(translate, /具体失败项：H3 中英文提示词的镜头或切换时间不一致/);
  assert.match(translate, /Translate the source prompt again/);
  assert.doesNotMatch(translate, /【任务定位】|Rebuild from the original|Previous modelPrompt/);
});

test('the shared validator\'s coverage, English-leak and dialogue failures get the instruction that fixes them', async () => {
  const rainy = fields('[Shot 1] 写实电影风格，一位穿红色风衣的女子站在雨夜的街角，霓虹灯在湿漉漉的路面上投下粉色和蓝色的倒影，她撑着黑色雨伞慢慢转身，望向远处驶来的电车。镜头缓慢推近她的侧脸。', '雨点打在伞面上，电车铃声由远及近。');
  const coverage = await repairText(translateRequest('text_video', rainy), pair(fields('[Shot 1] Live-action, a woman turns. The camera pushes in slowly.', 'Rain patters on the umbrella as a tram bell approaches.'), rainy));
  assert.match(coverage, /具体失败项：H3 英文提示词遗漏了中文内容[^\n]*\nmodelPrompt left out Chinese content: translate every sentence of every shot completely/);
  assert.match(coverage, /Translate the source prompt again/);
  // A display slip that rides along with a content failure gets its instruction in the one full repair.
  const leak = await repairText(baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']), pair(cityModel.replace(/overall_soundscape: [^\n]*/, 'overall_soundscape: N/A'), cityDisplay.replace('远处车流低鸣，随后咖啡店里杯子轻轻碰响。', 'N/A').replace('夜晚城市天际线', '夜晚 gazebo 城市天际线')));
  assert.match(leak, /具体失败项：H3 环境声音只有用户要求静音时才能写 N\/A[^；\n]*；H3 中文显示稿夹带英文单词[^\n]*\ndisplayPrompt must be Simplified Chinese throughout: translate every remaining English word/);
  assert.doesNotMatch(leak, /modelPrompt left out|Keep each line the user quoted/);
  const silent = text => text.replace(/, and the girl[^\n]*|，嗓音轻柔[^\n]*/, '.');
  const dialogue = await repairText(baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']), pair(silent(cityModel), silent(cityDisplay)));
  assert.match(dialogue, /具体失败项：原台词未完整保留。[^\n]*\nKeep each line the user quoted in the source prompt, or the new line the requirements ask for, word for word/);
  const english = await repairText(baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']), pair(cityModel.replace('a city skyline', '城市天际线'), cityDisplay));
  assert.match(english, /\nmodelPrompt prose is English; Chinese appears only inside <d>\.\.\.<\/d> blocks/);
});

test('a 多参 display repair keeps the reference literals, and five sections get no pair instruction', async () => {
  // 多参's Chinese half keeps its labels, task tags and relation names in English; the base list would drop them.
  const six = values => edge.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  const english = six(['<Subject 1>: A girl in a red cloak with long black hair, from <Picture 1>.', '[reference generation] <Subject 1> runs across the snow, stops and looks back over her shoulder.', '<Subject 1>: fully_preserved - red cloak, long black hair and face.', 'Realistic style. [Shot 1] <Subject 1> runs forward across the snow as the camera tracks her, then she stops and looks back.', 'Wind and footsteps crunching on snow.', 'N/A']);
  const snow = '<Picture 1> 中的少女在雪地里奔跑，停下后回头看。';
  const reference = await repairText(buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:snow,
    requirements:['Available resource labels: <Picture 1> = captured image slot multi_ref_image_1. Never invent a resource label.', 'H3 response format: bilingual-v1', 'Source prompt:', snow].join('\n')}, 'test-model'),
    JSON.stringify({modelPrompt:english, displayPrompt:english, editPolicy:{preserveBackground:false, preserveMotion:false, sameShapeAppearanceOnly:false}}));
  assert.match(reference, /具体失败项：请将多参主体[^\n]*\ndisplayPrompt must be Simplified Chinese throughout: [^\n]*Keep literal only the <Subject N>, <Picture N>, <Video N> and <Audio N> labels, the bracketed task tags such as \[reference generation\], the retention relation names \(fully_preserved, partially_preserved, attribute_transfer, weak_reference, fully_copy, partially_copy, reference\), the source-video prefix/);
  assert.doesNotMatch(reference, /only \[Shot N\]/);
  // An old renderer's five sections write the line as (S1)：“…” in 【台词】, never as a <d> block.
  const station = '女孩在车站挥手，(S1)：“出发吧。”';
  const five = await repairText(baseRequest('image_video', station, ['Available resource labels: <Picture 1> = captured image slot first_frame. Never invent a resource label.'], [edge.instruction, edge.formatInstruction]),
    JSON.stringify({task:'图生视频，<Picture 1> 为起始帧，时长6秒。', speakers:'<Subject 1> = (S1)，车站里的女孩。', description:'女孩站在车站站台上。0.0-3.0s：她抬起右手向远处挥动。3.0-6.0s：她放下手，微笑着看向前方，镜头保持固定。', dialogue:'无台词', constraints:'1. 保持 <Picture 1> 的人物身份和构图。'}));
  assert.match(five, /具体失败项：原台词未完整保留。/);
  assert.ok(five.includes(edge.formatInstruction));
  assert.doesNotMatch(five, /Keep each line the user quoted|<d>\[Language\]|displayPrompt|modelPrompt/);
});

test('the idle-breathing rule reaches Grok only when the user\'s own words ask for idle breathing', () => {
  const idleRule = /^仅呼吸待机时[^。]*。/.exec(edge.instruction)[0];
  // The renderer sends the whole policy ahead of the source prompt; only the source and the requirement after it count.
  const rest = baseRequest('first_last', '<Picture 1> 中坐在台阶上的女神闭目养神，晚风轻拂长发，画面最终停在 <Picture 2>', ['H3 response format: bilingual-v1']);
  assert.ok(!systemText(rest).includes(idleRule));
  assert.ok(systemText(rest).includes(edge.instructionFor('')));
  assert.ok(systemText(baseRequest('text_video', '绿幕前的机器人原地待机，轻微呼吸，循环动画', ['H3 response format: bilingual-v1'])).includes(edge.instruction));
  const tail = buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'image_video', durationSeconds:6, prompt:'女孩站在窗前',
    requirements:[edge.instruction, 'H3 response format: bilingual-v1', 'Source prompt:', '女孩站在窗前\n改成原地呼吸待机'].join('\n')}, 'test-model');
  assert.ok(systemText(tail).includes(idleRule));
  // Old renderers' five-section requests follow the same rule.
  assert.ok(!systemText(baseRequest('image_video', '女孩挥手', [], [edge.instruction, edge.formatInstruction])).includes(idleRule));
});

test('base I2V/FL2V optimize shows Grok its own frames; a translation, 文生 and foreign labels get none', () => {
  const labels = {image_video:'Available resource labels: <Picture 1> = captured image slot first_frame. Never invent a resource label.',
    first_last:'Available resource labels: <Picture 1> = captured image slot first_frame; <Picture 2> = captured image slot last_frame. Never invent a resource label.'};
  const frame = label => ({label, dataUrl:'data:image/jpeg;base64,aGVsbG8='});
  const optimize = (h3Mode, frames, markers = ['H3 response format: bilingual-v1']) => buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode, durationSeconds:6, prompt:'女孩挥手', h3ReferenceFrames:frames,
    requirements:[...markers, labels[h3Mode] || '', 'Source prompt:', '女孩挥手'].join('\n')}, 'test-model');
  const content = built => built.body.input[1].content;
  const i2v = optimize('image_video', [frame('<Picture 1>')]);
  assert.equal(i2v.inputMeta.imageCount, 1);
  assert.match(content(i2v)[1].text, /^Actual frame pixels follow: <Picture 1> is the opening frame of the target video\. Take the visual style, the subjects and their appearance, the composition and the setting from these frames/);
  assert.deepEqual(content(i2v).slice(2).map(item => item.text || item.image_url), ['<Picture 1> opening frame', 'data:image/jpeg;base64,aGVsbG8=']);
  const fl2v = optimize('first_last', [frame('<Picture 1>'), frame('<Picture 2>')]);
  assert.equal(fl2v.inputMeta.imageCount, 2);
  assert.match(content(fl2v)[1].text, /<Picture 1> is the opening frame of the target video and <Picture 2> is its final frame\./);
  assert.deepEqual(content(fl2v).slice(2).map(item => item.text || item.type), ['<Picture 1> opening frame', 'input_image', '<Picture 2> final frame', 'input_image']);
  // With the frames the writer first notes what they show (a field the program drops): 图生 what <Picture 1> leaves out of frame and how
  // each action stays on screen, 首尾帧 what <Picture 2> shows and the path to it. The opening names the light; 首尾帧 spends most on the path.
  const schema = JSON.parse(JSON.stringify(edge.baseResultSchema));
  for (const [built, note] of [[i2v, 'openingFrame'], [fl2v, 'finalFrame']]) {
    const sent = built.body.text.format.schema;
    assert.deepEqual(sent, {...schema, properties:{[note]:{type:'string', description:sent.properties[note].description}, ...schema.properties}, required:[note, ...schema.required]});
    assert.deepEqual([Object.keys(sent.properties)[0], sent.required[0]], [note, note]);
    assert.match(content(built)[1].text, /one of them naming the light the frame shows/);
  }
  assert.match(i2v.body.text.format.schema.properties.openingFrame.description, /out of frame[\s\S]*never with a noun from the request[\s\S]*pick up, take or eat, whether the request says it is the one already in hand; if not, it is a new one that lies within reach, named with its look, and the held thing is set aside first[\s\S]*Camera, written last from the Frame and Plan lines[\s\S]*pull-out or tilt[\s\S]*even when everything already fits the frame/);
  // The note offers no static option; a still camera stays the user's choice in the base rules.
  assert.doesNotMatch(i2v.body.text.format.schema.properties.openingFrame.description, /static/);
  assert.match(fl2v.body.text.format.schema.properties.finalFrame.description, /closer or wider than <Picture 1> \(in this note only: the prompt names no shot size[\s\S]*large amplitude/);
  assert.match(content(fl2v)[1].text, /about a third of the text; the rest is the path from <Picture 1> to <Picture 2>\./);
  assert.doesNotMatch(content(i2v)[1].text, /a third of the text/);
  assert.equal(optimize('text_video', [frame('<Picture 1>')]).body.text.format.schema.properties.openingFrame, undefined);
  // The writer reads the official length as a figure for this clip: 135-195 words for six seconds.
  assert.match(userText(fl2v), /\nLength: about 135-195 English words in integrated_multimodal_description for this 6-second clip, /);
  assert.equal(optimize('first_last', [frame('<Picture 1>'), frame('<Picture 2>')], ['H3 compile: translate-only', 'H3 response format: bilingual-v1']).inputMeta.imageCount, 0);
  assert.equal(content(optimize('text_video', [frame('<Picture 1>')])).length, 1);
  // Only the mode's own anchors, in order, as the resource labels list them.
  assert.throws(() => optimize('image_video', [frame('<Picture 2>')]), /H3 参考画面与素材不匹配/);
  assert.throws(() => optimize('first_last', [frame('<Picture 2>'), frame('<Picture 1>')]), /H3 参考画面与素材不匹配/);
  // Without pixels the writer is told not to guess what the frames show.
  assert.match(content(optimize('image_video', []))[1].text, /^No frame pixels are attached\. Do not name a visual style/);
  assert.equal(optimize('image_video', []).inputMeta.imageCount, 0);
});

test('the optimize that sees pictures carries the reverse content safety in its one call', async () => {
  const labels = {image_video:'Available resource labels: <Picture 1> = captured image slot first_frame. Never invent a resource label.',
    full_reference:'Available resource labels: <Picture 1> = captured image slot multi_ref_image_1. Never invent a resource label.'};
  const frame = {label:'<Picture 1>', dataUrl:'data:image/jpeg;base64,aGVsbG8='};
  const policy = {sensitiveVisualAnalysis:true, allSubjectsConfirmedAdult:false};
  const optimize = (source, {h3Mode = 'image_video', frames = [frame], contentPolicy = policy, markers = ['H3 response format: bilingual-v1']} = {}) => buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode, durationSeconds:6, prompt:source, h3ReferenceFrames:frames, contentPolicy,
    requirements:[...markers, labels[h3Mode === 'multi_reference' ? 'full_reference' : h3Mode] || '', 'Source prompt:', source].join('\n')}, 'test-model');
  const built = optimize('女孩挥手');
  const schema = built.body.text.format.schema;
  assert.deepEqual(schema.required, ['openingFrame', 'modelPrompt', 'displayPrompt', 'contentSafety']);
  assert.deepEqual(schema.properties.contentSafety.required, ['explicitMinorEvidence', 'sensitiveContent']);
  assert.deepEqual({...schema, properties:{modelPrompt:schema.properties.modelPrompt, displayPrompt:schema.properties.displayPrompt}, required:['modelPrompt', 'displayPrompt']}, JSON.parse(JSON.stringify(edge.baseResultSchema)));
  // With pictures in a pair the person rule stays in the request text; the faithful-facts and fail-closed rules ride in the schema.
  assert.match(userText(built), /Content safety: never state a person's age or age group \(成年, 未成年, N岁\)[\s\S]*keep 女孩 as 女孩 in displayPrompt and write girl in modelPrompt/);
  assert.doesNotMatch(userText(built), /H3_CONTENT_POLICY_BLOCKED|sensitive details|\bminor\b|underage/);
  assert.match(schema.properties.contentSafety.description, /both true, every prompt field is exactly H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content\.$/);
  assert.match(schema.properties.contentSafety.properties.sensitiveContent.description, /sensitive details included: never omit or soften a visible fact/);
  assert.equal(built.body.input[1].content.length, 4, 'the rules ride in the request text and schema, the frame items are unchanged');
  // Without the AI 助手's fact-faithful policy (the generation-time 多参 compile) the call is as it was: no field, rules or youth flag.
  const compile = optimize('<Picture 1> 中的小孩在岩石上攀爬', {h3Mode:'multi_reference', contentPolicy:{sensitiveVisualAnalysis:false, allSubjectsConfirmedAdult:false}});
  assert.deepEqual(compile.body.text.format.schema.required, ['modelPrompt', 'displayPrompt', 'editPolicy']);
  assert.doesNotMatch(userText(compile), /Content safety|H3_CONTENT_POLICY_BLOCKED/);
  assert.equal(compile.resultOptions.explicitYouthUserRequest, false);
  // An old page's five sections with pictures have no schema field to carry them: they go in the request text.
  assert.match(userText(optimize('女孩挥手', {markers:[]})), /sensitive details included: never omit or soften a visible fact, and add none that is not visible\.\nWhen explicit minor evidence coexists with sensitive content, write exactly H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content as every field value\./);
  // 多参 reports the same signal next to editPolicy; without pixels the pair schema stays as it was.
  assert.deepEqual(optimize('<Picture 1> 中的女孩奔跑', {h3Mode:'multi_reference'}).body.text.format.schema.required, ['modelPrompt', 'displayPrompt', 'editPolicy', 'contentSafety']);
  assert.deepEqual(optimize('女孩挥手', {frames:[]}).body.text.format.schema, JSON.parse(JSON.stringify(edge.baseResultSchema)));
  assert.match(userText(optimize('女孩挥手', {h3Mode:'text_video', frames:[]})), /keep 女孩 as 女孩 in displayPrompt and write girl in modelPrompt[\s\S]*as every field value\. A young-looking/);
  assert.doesNotMatch(userText(translateRequest('image_video', cityDisplay)), /Content safety|H3_CONTENT_POLICY_BLOCKED/);
  // Explicit minor wording with a sensitive request is refused before any call, as in reverse.
  assert.throws(() => optimize('小孩全裸站在海边'), error => error.errorCode === 'provider_content_policy' && error.statusCode === 422);
  assert.equal(optimize('小孩在海边奔跑').resultOptions.explicitYouthUserRequest, true);
  const model = fields('[Shot 1] Live-action, the girl shown in <Picture 1> raises her right hand and waves toward the camera. The camera holds a static shot.', 'A soft breeze moves through the leaves.');
  const display = fields('[Shot 1] 写实风格，<Picture 1> 中的女孩举起右手，朝镜头挥手。镜头保持固定。', '微风吹过树叶。');
  const answer = (contentSafety, modelPrompt = model) => JSON.stringify({modelPrompt, displayPrompt:display, contentSafety});
  // The signal never leaves the edge; a child or adult sensitive content alone is an ordinary answer.
  assert.deepEqual(Object.keys(JSON.parse(normalizeMiniMaxH3PromptOutput(answer({explicitMinorEvidence:false, sensitiveContent:false}), built.resultOptions))), ['modelPrompt', 'displayPrompt']);
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer({explicitMinorEvidence:true, sensitiveContent:false}), built.resultOptions));
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer({explicitMinorEvidence:false, sensitiveContent:true}), built.resultOptions));
  // Minor evidence with sensitive content, or the fail-closed marker, ends the one call as provider_content_policy: no repair, no retry.
  const blocked = [
    [answer({explicitMinorEvidence:true, sensitiveContent:true}), built],
    [answer({explicitMinorEvidence:true, sensitiveContent:false}, model.replace('waves toward the camera', 'stands fully nude and waves toward the camera')), built],
    // The writer's frame note is read too: minor evidence with nudity named only there (a misgraded sensitiveContent) is still blocked.
    ...['openingFrame', 'finalFrame'].map(note => [JSON.stringify({[note]:'The picture shows the child after undressing, fully nude.', modelPrompt:model, displayPrompt:display, contentSafety:{explicitMinorEvidence:true, sensitiveContent:false}}), built]),
    [answer({explicitMinorEvidence:false, sensitiveContent:true}), optimize('小孩在海边奔跑')],
    [JSON.stringify({modelPrompt:{integrated_multimodal_description:'H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content', overall_soundscape:'H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content', non_diegetic_music:'N/A'}, displayPrompt:display}), built],
    ['H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content', optimize('女孩挥手', {markers:[]})]
  ];
  for (const [text, request] of blocked) {
    let calls = 0;
    await assert.rejects(callGrokResponseWithVisualRetry(request.body, request.inputMeta, {...request.resultOptions, visualRetryAllowed:true}, async () => {
      calls++;
      return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(text, request.resultOptions)}, providerCallCount:1};
    }), error => {
      const envelope = miniMaxH3FailureEnvelope(error);
      assert.equal(error.statusCode, 422);
      assert.deepEqual([envelope.errorCode, envelope.retryable, envelope.retryCount, envelope.failureReason], ['provider_content_policy', false, 0, 'explicit_minor_sensitive']);
      return true;
    });
    assert.equal(calls, 1);
  }
  // A repair whose own answer is blocked ends blocked as well: the first answer kept for a failed repair never outranks the safety rule.
  const tags = fields('[Shot 1] Live-action, girl from <Picture 1>, right hand raised, waving toward camera, bright park, green trees, soft light, calm mood, gentle breeze over grass. The girl smiles. The camera holds a static shot.', 'A soft breeze moves through the leaves.');
  for (const repair of [answer({explicitMinorEvidence:true, sensitiveContent:true}), 'H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content']) {
    const answers = [answer({explicitMinorEvidence:false, sensitiveContent:false}, tags), repair], options = {...built.resultOptions, visualRetryAllowed:true};
    let calls = 0;
    await assert.rejects(callGrokResponseWithVisualRetry(built.body, built.inputMeta, options, async () => {
      const text = answers[calls++];
      try { return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(text, options)}, providerCallCount:1}; } catch (error) { throw Object.assign(error, {grokProviderCallCount:1}); }
    }), error => error.statusCode === 422 && miniMaxH3FailureEnvelope(error).errorCode === 'provider_content_policy');
    assert.equal(calls, 2);
  }
});

test('everyday words next to a child are no sensitive content: bare rock, light through the leaves, a bottle nipple', () => {
  const policy = {sensitiveVisualAnalysis:true, allSubjectsConfirmedAdult:false};
  const frame = {label:'<Picture 1>', dataUrl:'data:image/jpeg;base64,aGVsbG8='};
  const build = (h3Mode, source, frames = []) => buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode, durationSeconds:6, prompt:source, h3ReferenceFrames:frames, contentPolicy:policy,
    requirements:['H3 response format: bilingual-v1', ...(frames.length ? ['Available resource labels: <Picture 1> = captured image slot first_frame. Never invent a resource label.'] : []), 'Source prompt:', source].join('\n')}, 'test-model');
  // The user's own words pass the check before the call; a real request still does not.
  for (const source of ['小孩在裸露的岩石上慢慢攀爬', '小孩坐在裸露的树根上看书', 'a child watches sunlight penetrating the clouds', '婴儿咬着奶嘴 / the baby chews on the rubber nipple of its bottle']) {
    assert.equal(build('text_video', source).resultOptions.explicitYouthUserRequest, true, source);
  }
  for (const source of ['小孩全裸站在海边', '小孩裸露身体', 'a child, fully nude']) {
    assert.throws(() => build('text_video', source), error => error.errorCode === 'provider_content_policy' && error.statusCode === 422, source);
  }
  // A child named in the user's words, and an answer with the same everyday words: written.
  const t2v = build('text_video', '小孩在海边的礁石上奔跑，镜头跟随');
  for (const [model, display] of [
    ['a child runs across the exposed rocks by the sea as waves break behind', '小孩沿着海边裸露的礁石向前奔跑，身后海浪拍打'],
    ['a child runs along the rocks by the sea while sunlight penetrates the clouds in bright shafts', '小孩沿着海边的礁石向前奔跑，阳光穿透云层洒下光束']
  ]) {
    assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(JSON.stringify({
      modelPrompt:fields(`[Shot 1] Live-action, ${model}. The camera follows the child from the side at medium speed.`, 'Waves crash on the rocks and small footsteps slap the wet stone.'),
      displayPrompt:fields(`[Shot 1] 写实风格，${display}。镜头从侧面以中速跟随小孩。`, '海浪拍打礁石，小脚踩在湿石头上啪嗒作响。')
    }), t2v.resultOptions), model);
  }
  // Grok sees a child in the frame: everyday words are written, a nude answer is not.
  const i2v = build('image_video', '<Picture 1> 中的人沿着海边往前跑', [frame]);
  const answer = (en, zh) => JSON.stringify({
    modelPrompt:fields(`[Shot 1] Live-action, the child shown in <Picture 1> ${en}. The camera follows from the side at medium speed.`, 'Waves crash on the rocks and footsteps slap the wet stone.'),
    displayPrompt:fields(`[Shot 1] 写实风格，<Picture 1> 中的小孩${zh}。镜头从侧面以中速跟随。`, '海浪拍打礁石，脚步踩在湿石头上啪嗒作响。'),
    contentSafety:{explicitMinorEvidence:true, sensitiveContent:false}
  });
  for (const [en, zh] of [
    ['runs forward along the exposed rocks by the sea', '沿着海边裸露的礁石向前奔跑'],
    ['runs forward along the rocks while warm sunlight penetrating the clouds lights the sea', '沿着海边的礁石向前奔跑，穿透云层的暖阳照亮海面'],
    ['runs forward along the rocks by the sea, a baby bottle with its rubber nipple in one hand', '一手拿着带奶嘴的奶瓶，沿着海边的礁石向前奔跑']
  ]) assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(answer(en, zh), i2v.resultOptions), en);
  assert.throws(() => normalizeMiniMaxH3PromptOutput(answer('runs forward along the rocks by the sea, fully nude', '全裸着沿着海边的礁石向前奔跑'), i2v.resultOptions),
    error => error.errorCode === 'provider_content_policy' && error.statusCode === 422);
});

test('a Grok 多参 pair gets every quality gate in one repair call from its own draft; a repair that fails again leaves the better answer', async () => {
  const six = values => edge.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  const source = '<Picture 1> 中的角色走向 <Picture 2> 中的角色，第3秒切到两人的近景';
  const built = buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:source,
    requirements:['Available resource labels: <Picture 1> = captured image slot multi_ref_image_1; <Picture 2> = captured image slot multi_ref_image_2. Never invent a resource label.', 'H3 response format: bilingual-v1', 'Source prompt:', source].join('\n')}, 'test-model');
  // The pair rules ask for the official depth, the user's words in the display and exact colours; the translation maps the sizes.
  assert.match(userText(built), /Stage every subject in one shared setting[\s\S]*近景 stays 近景; modelPrompt writes medium close-up[\s\S]*translates every colour, time of day and light exactly/);
  // A writer's 多参 narrative comes in parts the program joins; a translate-only compile keeps the prose field.
  assert.deepEqual(built.body.text.format.schema, JSON.parse(JSON.stringify(edge.referenceWriterSchema)));
  const compileOnly = buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:source,
    requirements:['Available resource labels: <Picture 1> = captured image slot multi_ref_image_1; <Picture 2> = captured image slot multi_ref_image_2. Never invent a resource label.', 'H3 compile: translate-only', 'Source prompt:', source].join('\n')}, 'test-model');
  assert.deepEqual(compileOnly.body.text.format.schema, JSON.parse(JSON.stringify(edge.referenceResultSchema)));
  // A two-handed gesture the user asks for (抱拳) gets the free-hands line next to the user's words; a walk or a translation does not.
  const salute = '<Picture 1> 中的武将和 <Picture 2> 中的武者面对面抱拳行礼，然后并肩走向镜头';
  const saluteBuilt = buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:salute,
    requirements:['Available resource labels: <Picture 1> = captured image slot multi_ref_image_1; <Picture 2> = captured image slot multi_ref_image_2. Never invent a resource label.', 'H3 response format: bilingual-v1', 'Source prompt:', salute].join('\n')}, 'test-model');
  assert.match(userText(saluteBuilt), /Never invent a resource label\.\nThe requested gesture needs both hands free: [^\n]*sheathes it \(only a sword or knife has a sheath\)/);
  assert.doesNotMatch(userText(built) + userText(compileOnly), /both hands free/);
  const english = six(['<Subject 1>: A girl with short dark hair, from <Picture 1>\n<Subject 2>: A small teal and copper robot, from <Picture 2>', '[reference generation] <Subject 1> walks toward <Subject 2>. At the 3-second mark the camera cuts to a close-up of both.',
    '<Subject 1>: fully_preserved - short dark hair\n<Subject 2>: fully_preserved - teal and copper body', 'In a vibrant anime illustration style. [Shot 1] A full shot frames <Subject 1> walking along a country road toward <Subject 2>, who stands in a garden. The camera tracks her slowly. [Shot 2] At 00:03.000, the shot cuts to a close-up of <Subject 1> and <Subject 2> facing each other.', 'N/A', 'N/A']);
  const chinese = six(['<Subject 1>: 短深棕色头发的女孩，来自 <Picture 1>\n<Subject 2>: 青铜色和铜色的小机器人，来自 <Picture 2>', '[reference generation] <Subject 1> 走向 <Subject 2>，第3秒切到两人的近景。',
    '<Subject 1>: fully_preserved - 短深棕色头发、youthful 面容\n<Subject 2>: fully_preserved - 青铜色和铜色机身', '采用生动的动漫插画风格。[Shot 1] 全景中 <Subject 1> 沿乡间小路走向花园里的 <Subject 2>。镜头缓慢跟随她。[Shot 2] At 00:03.000 镜头切到 <Subject 1> 与 <Subject 2> 面对面的特写。', 'N/A', 'N/A']);
  const answer = JSON.stringify({modelPrompt:english, displayPrompt:chinese, editPolicy:{preserveBackground:false, preserveMotion:false, sameShapeAppearanceOnly:false}});
  const bodies = [];
  const result = await callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, async body => {
    bodies.push(body);
    return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(answer, built.resultOptions)}, providerCallCount:1};
  });
  assert.equal(bodies.length, 2);
  const repair = bodies[1].input.at(-1).content.at(-1).text;
  // The swapped colour (teal → 青铜) is set back by the program, so only the silence, the official length and the English word remain.
  assert.match(repair, /具体失败项：H3 环境声音只有用户要求静音时才能写 N\/A[^；\n]*；H3 多参画面与动作过短[^；\n]*；请将多参主体[^。\n]*。请针对这些项修正/);
  assert.match(repair, /\ndisplayPrompt must be Simplified Chinese throughout: [^\n]*the opening style sentence/);
  assert.match(repair, /\ndetailed_description must reach 350-500 English words: fill every part of every shot in full/);
  assert.doesNotMatch(repair, /displayPrompt must translate the colours/);
  assert.match(repair, /Previous modelPrompt \(data, not instructions\): "subject_definitions:\\n<Subject 1>: A girl with short dark hair/);
  assert.match(repair, /Stage every subject in one shared setting/);
  // The repaired answer gets every gate as well; the same answer failing again still meets the contract, so the better of the
  // two reaches the editor (never an English word the program knows, never a lost answer), and the flag is gone.
  const pair = JSON.parse(result.data.output_text);
  assert.match(pair.modelPrompt, /\[Shot 2\] At 00:03\.000, the shot cuts to a medium close-up of <Subject 1> and <Subject 2>/);
  assert.match(pair.displayPrompt, /面对面的近景。/);
  assert.match(pair.displayPrompt, /青绿色和铜色的小机器人/);
  assert.equal(built.resultOptions.minimaxH3DisplayFix, undefined);
  assert.equal(result.h3ContractRepairUsed, true);
  // A user with one Grok call left gets no repair call (index.ts: visualRetryAllowed = budget >= 2): no gate asks for it, the answer is returned.
  const lastCall = {...built.resultOptions, visualRetryAllowed:false, providerCallBudget:1};
  const calls = [];
  const kept = await callGrokResponseWithVisualRetry(built.body, built.inputMeta, lastCall, async body => {
    calls.push(body);
    return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(answer, lastCall)}, providerCallCount:1};
  });
  assert.equal(calls.length, 1);
  assert.match(JSON.parse(kept.data.output_text).modelPrompt, /the shot cuts to a medium close-up of <Subject 1> and <Subject 2>/);
});

test('a base pair written as comma-stacked tags is repaired once; the translation carries the exact shot sizes', async () => {
  const source = '一只橘猫坐在窗台上晒太阳，然后舔爪子';
  const built = baseRequest('text_video', source, ['H3 response format: bilingual-v1']);
  const tags = pair(fields('[Shot 1] Live-action, ginger cat on sunny windowsill, fur glowing, tail curled around paws, eyes half closed, curtains moving behind, potted plants on sill, warm afternoon glow. The cat licks its paw. The camera holds a static shot.', 'Soft purring and a faint breeze.'),
    fields('[Shot 1] 写实风格，阳光照耀的窗台上的橘猫，毛发发光，尾巴卷在爪边，眼睛半闭，身后窗帘飘动，窗台上有盆栽，午后暖光。猫舔爪子。镜头固定。', '轻柔的呼噜声和微风。'));
  assert.throws(() => normalizeMiniMaxH3PromptOutput(tags, built.resultOptions), error => error.errorCode === 'h3_contract_fields' && /逗号堆叠标签/.test(error.message));
  assert.doesNotThrow(() => normalizeMiniMaxH3PromptOutput(tags, {...built.resultOptions, visualRetryAllowed:false}));
  const repair = await (async () => {
    const bodies = [];
    await callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, async body => {
      bodies.push(body);
      return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(tags, built.resultOptions)}, providerCallCount:1};
    });
    return bodies[1].input.at(-1).content.at(-1).text;
  })();
  assert.match(repair, /\nmodelPrompt must be complete English sentences with articles and verbs, never a comma-separated list of tags/);
  for (const text of [edge.baseTranslateInstruction, userText(translateRequest('text_video', cityDisplay))]) assert.match(text, /Shot sizes map exactly: 大特写 extreme close-up, 特写 close-up, 近景 medium close-up/);
  assert.match(userText(buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:'x',
    requirements:'Available resource labels: <Picture 1>\nH3 compile: translate-only\nH3 response format: bilingual-v1\nSource prompt:\nx'}, 'test-model')), /Shot sizes map exactly: 大特写 extreme close-up/);
});

test('a display slip alone keeps the answer: one small no-reasoning call rewrites only its marked sentences, and a failed fix or repair leaves the better answer', async () => {
  const built = baseRequest('text_video', citySource, ['H3 response format: bilingual-v1']);
  const slipped = pair(cityModel, cityDisplay.replace('夜晚城市天际线的全景', '夜晚 skyline 天际线的全景'));
  const run = async (answers) => {
    const bodies = [];
    const result = await callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, async body => {
      bodies.push(body);
      const answer = answers[bodies.length - 1];
      // As index.ts callGrokResponseAttempt: a provider or contract failure still counts its call.
      try {
        if (answer instanceof Error) throw answer;
        return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(answer, built.resultOptions)}, providerCallCount:1};
      } catch (error) { throw Object.assign(error, {grokProviderCallCount:1}); }
    });
    return {bodies, result, display:JSON.parse(result.data.output_text).displayPrompt};
  };
  const fixed = await run([slipped, JSON.stringify({sentences:['[Shot 1] 写实电影风格，夜晚城市天际线的全景。']})]);
  const fix = fixed.bodies[1];
  assert.equal(fix.text.format.name, 'minimax_h3_display_fix');
  assert.deepEqual(fix.reasoning, {effort:'none'});
  assert.ok(fix.max_output_tokens <= 1024);
  assert.ok(!JSON.stringify(fix.input).includes('input_image'));
  assert.match(fix.input[1].content[0].text, /English prompt \(the meaning to follow\):\nintegrated_multimodal_description: \[Shot 1\] Live-action, cinematic, a wide shot shows a city skyline at night\./);
  assert.ok(fix.input[1].content[0].text.includes(JSON.stringify(['[Shot 1] 写实电影风格，夜晚 ⟦skyline⟧ 天际线的全景。'])));
  assert.match(fixed.display, /^integrated_multimodal_description: \[Shot 1\] 写实电影风格，夜晚城市天际线的全景。镜头保持固定。/);
  assert.equal(fixed.result.providerCallCount, 2);
  assert.equal(built.resultOptions.minimaxH3DisplayFix, undefined);
  // A fix that changes a marker, keeps a mark or fails outright leaves the kept answer as it was.
  for (const second of [JSON.stringify({sentences:['[Shot 2] 写实电影风格，夜晚城市天际线的全景。']}), JSON.stringify({sentences:['[Shot 1] 写实电影风格，夜晚 ⟦skyline⟧ 天际线的全景。']}), Object.assign(new Error('provider failed'), {statusCode:500})])
    assert.match((await run([slipped, second])).display, /夜晚 skyline 天际线的全景/);
  // A content failure gets the full repair; when the repaired answer fails a quality gate too, the lighter failure wins.
  const tags = pair(fields('[Shot 1] Live-action, city skyline at night, neon glow, wet streets, girl in café, soft rain, warm window light, quiet mood, cups on table. The girl looks up. The camera holds a static shot.', 'Rain and cups clinking.'),
    fields('[Shot 1] 写实电影风格，夜晚城市天际线，霓虹光，湿街道，咖啡店里的女孩，细雨，温暖窗光，安静氛围，桌上的杯子。女孩抬头。镜头保持固定。', '雨声和杯子碰响。'));
  const better = await run([tags, slipped]);
  assert.equal(better.bodies.length, 2);
  assert.doesNotMatch(better.bodies[1].text.format.name, /display_fix/);
  assert.match(better.display, /夜晚 skyline 天际线的全景/);
  assert.match(JSON.parse(better.result.data.output_text).modelPrompt, /\[Shot 2\] At 00:03\.000, the camera cuts to a medium shot of a girl in a corner café/);
  // A translation is never kept as a fallback: a 多参 translation that drops a shot twice fails the compile.
  const six = values => edge.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  const zh = six(['<Subject 1> 是 <Picture 1> 中的女孩。', '[reference generation] <Subject 1> 走路，然后停下。', '<Subject 1>: fully_preserved - 发型', '动漫风格。[Shot 1] <Subject 1> 沿小路走。[Shot 2] At 00:03.000 镜头切到近景，<Subject 1> 停下。', '脚步声。', 'N/A']);
  const en = six(['<Subject 1> is the girl in <Picture 1>.', '[reference generation] <Subject 1> walks, then stops.', '<Subject 1>: fully_preserved - hair', 'Anime style. [Shot 1] <Subject 1> walks along the path and stops.', 'Footsteps.', 'N/A']);
  const compile = buildGrokPromptOptimizeRequest({purpose:'minimax-h3-prompt-enhance', h3Mode:'multi_reference', durationSeconds:5, prompt:zh,
    requirements:['Available resource labels: <Picture 1>', 'H3 compile: translate-only', 'H3 response format: bilingual-v1', 'Source prompt:', zh].join('\n')}, 'test-model');
  await assert.rejects(callGrokResponseWithVisualRetry(compile.body, compile.inputMeta, compile.resultOptions, async () => {
    try { return {ok:true, data:{output_text:normalizeMiniMaxH3PromptOutput(JSON.stringify({modelPrompt:en, displayPrompt:zh, editPolicy:{preserveBackground:false, preserveMotion:false, sameShapeAppearanceOnly:false}}), compile.resultOptions)}, providerCallCount:1}; }
    catch (error) { throw Object.assign(error, {grokProviderCallCount:1}); }
  }), /镜头或切换时间不一致/);
});

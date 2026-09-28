import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as edge from '../../supabase/functions/novaflow-backend/h3-prompt-enhance.mjs';
const require = createRequire(import.meta.url);
const local = require('../admin-server/h3-prompt-enhance.js');
const context = {console}; context.globalThis = context;
vm.runInNewContext(fs.readFileSync(new URL('../../novaflow-web/renderer/h3-prompt-format.js', import.meta.url), 'utf8'), context);
const renderer = context.NovaFlowH3PromptFormat;
const apis = [local, edge, renderer];
const json = value => JSON.parse(JSON.stringify(value));

// Official base layout (VIDEO_PROMPT_WRITING_GUIDE_base_en.md): the alignment line, a blank line, three fields, shots inline.
const i2vLine = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
const fl2vLine = (shot, duration) => `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${shot}) aligns with the ${duration}-second mark of the target video.`;
const official = {
  text_video: 'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium-wide shot frames a fisherman untying a small boat at a misty dock before dawn. The camera pushes in with small amplitude at slow speed as the old fisherman with a low, rough voice (S1) coils the rope and says: <d>[Chinese] 今天风小。</d> [Shot 2] At 00:05.000, the camera cuts to a close-up of the oars dipping into the still water while ripples spread outward.\n\noverall_soundscape: Water laps against the wooden dock as the rope creaks. Oars splash softly and a distant gull calls once.\n\nnon_diegetic_music: A slow solo piano pattern with sparse low notes that fades out at the end.',
  image_video: i2vLine + '\n\nintegrated_multimodal_description: [Shot 1] 2D-animated, the boy shown in <Picture 1> stays at his desk by the window, keeping his clothing, the lamp and the room layout. The camera holds a static shot as he closes the notebook, stretches both arms upward and turns toward a paper sign reading "明天见".\n\noverall_soundscape: A desk lamp hums quietly while paper rustles and the chair creaks as he leans back.\n\nnon_diegetic_music: N/A',
  first_last: fl2vLine(2, '8.00') + '\n\nintegrated_multimodal_description: [Shot 1] 3D CG, a small robot begins in the position and framing established by Picture 1, standing beside a closed crate. The camera trucks left with small amplitude at slow speed as it lifts the lid. [Shot 2] At 00:04.500, the camera cuts to a wide shot where the robot carries the crate across the workshop and settles into the pose, spacing, and composition established by Picture 2 at the end of the shot.\n\noverall_soundscape: Metal hinges squeak as the lid opens, followed by steady servo whirs and light footsteps on the concrete floor.\n\nnon_diegetic_music: N/A',
};
const durations = {text_video:8, image_video:5, first_last:8};
// The Chinese editor display of the same three prompts.
const display = {
  text_video: '【画面与动作】\n【镜头 1】写实电影风格，中远景，黎明前起雾的码头上，一位渔夫正在解开小船。镜头以小幅度缓慢推近，嗓音低沉粗粝的老渔夫 (S1) 收起缆绳说：<d>[Chinese] 今天风小。</d>\n【镜头 2】 At 00:05.000 镜头切到船桨探入静水的特写，涟漪向外扩散。\n\n【环境声音】\n水拍打木码头，缆绳吱呀作响。船桨轻轻划水，远处一只海鸥叫了一声。\n\n【背景音乐】\n缓慢的钢琴独奏，低音稀疏，结尾渐弱。',
  image_video: '【参考帧对齐】\n<Picture 1> 是视频第 0.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】二维动画风格，<Picture 1> 中的男孩坐在窗边书桌前，服装、台灯和房间布局保持不变。镜头保持固定，他合上笔记本，双臂向上伸展，转向写着“明天见”的纸牌。\n\n【环境声音】\n台灯轻声嗡鸣，纸张沙沙作响，他向后靠时椅子吱呀一声。\n\n【背景音乐】\n无',
  first_last: '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 8.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】三维 CG 风格，小机器人从 <Picture 1> 的位置与构图开始，站在一只合着的箱子旁。镜头以小幅度缓慢向左平移，它掀开箱盖。\n【镜头 2】 At 00:04.500 镜头切到全景，机器人搬着箱子穿过工坊，镜头结尾落定在 <Picture 2> 的姿态、间距与构图。\n\n【环境声音】\n箱盖打开时金属铰链吱吱作响，随后是平稳的伺服声和水泥地上的轻步声。\n\n【背景音乐】\n无',
};

test('mode names, alignment lines and display alignment follow the official base guide', () => {
  for (const api of apis) {
    assert.deepEqual(['t2va', 'T2V', 'text_video', 'i2va', 'image_video', 'I2V', 'fl2va', 'first_last', 'FL2V', 'multi_reference', ''].map(api.baseModeName),
      ['text_video', 'text_video', 'text_video', 'image_video', 'image_video', 'image_video', 'first_last', 'first_last', 'first_last', '', '']);
    assert.equal(api.baseAlignmentLine('text_video', 5, 1), '');
    assert.equal(api.baseAlignmentLine('i2va', 5, 1), i2vLine);
    assert.equal(api.baseAlignmentLine('first_last', 7.5, 3), fl2vLine(3, '7.50'));
    assert.equal(api.baseDisplayAlignment('text_video', 5), '');
    assert.equal(api.baseDisplayAlignment('image_video', 5), '<Picture 1> 是视频第 0.00 秒的起始画面，完整参考。');
    assert.equal(api.baseDisplayAlignment('first_last', 6), '<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 6.00 秒（结尾）。');
    assert.deepEqual(json(api.baseFields), ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']);
    assert.deepEqual(json(api.baseDisplayFields), ['参考帧对齐', '画面与动作', '环境声音', '背景音乐']);
  }
});

test('composeBaseModelPrompt writes the official model text: alignment first, shots inline, FL2V bare labels', () => {
  for (const api of apis) {
    for (const mode of Object.keys(official)) {
      const options = {mode, durationSeconds:durations[mode]};
      // Canonical fields form: no alignment, one line per shot, <Picture N> tags.
      const fields = api.validateBaseFields(official[mode], options);
      assert.doesNotMatch(fields, /aligns with|fully referenced/);
      assert.doesNotMatch(fields, /(?:^|[^<])Picture \d/);
      assert.equal(api.composeBaseModelPrompt(fields, options), official[mode]);
      assert.equal(api.composeBaseModelPrompt(official[mode], options), official[mode]);
      assert.equal(api.composeBaseModelPrompt(JSON.stringify({modelPrompt:fields, displayPrompt:api.fromBaseDisplay(display[mode])}), options), official[mode]);
    }
    // The final shot index and the duration come from the narrative and the options.
    const single = api.validateBaseFields(official.first_last.replace(/ \[Shot 2\] At 00:04\.500, the camera cuts to a wide shot where/, ' Then'), {mode:'first_last', durationSeconds:6});
    assert.equal(api.composeBaseModelPrompt(single, {mode:'first_last', durationSeconds:6}).split('\n')[0], fl2vLine(1, '6.00'));
    // A Chinese narrative is never sent to H3 as model text.
    assert.throws(() => api.composeBaseModelPrompt(api.fromBaseDisplay(display.image_video), {mode:'image_video', durationSeconds:5}), /英文正文/);
  }
});

test('display and fields round trip per mode; the alignment section is regenerated and ignored on the way back', () => {
  for (const api of apis) {
    for (const mode of Object.keys(display)) {
      const options = {mode, durationSeconds:durations[mode]};
      const fields = api.fromBaseDisplay(display[mode]);
      assert.match(fields, /^integrated_multimodal_description: \[Shot 1\] /);
      assert.doesNotMatch(fields, /【|对齐视频|起始画面，完整参考/);
      assert.equal(api.toBaseDisplay(fields, options), display[mode]);
      assert.equal(api.toBaseDisplay(display[mode], options), display[mode]);
      assert.equal(api.fromBaseDisplay(api.toBaseDisplay(fields, options)), fields);
      assert.equal(api.validateBaseFields(display[mode], {...options, language:'zh'}), fields);
      // The official English text shows with the same labels and <Picture N> tags.
      const shown = api.toBaseDisplay(official[mode], options), alignment = text => /^【参考帧对齐】\n[^\n]*/.exec(text)?.[0];
      assert.equal(alignment(shown), alignment(display[mode]));
      assert.match(shown, /\n?【画面与动作】\n【镜头 1】[23A-Z]/);
      assert.doesNotMatch(shown, /aligns with|fully referenced|(?:^|[^<])Picture \d/);
    }
    const fields = api.fromBaseDisplay(display.text_video);
    assert.match(fields, /说：<d>\[Chinese\] 今天风小。<\/d>\n\[Shot 2\] At 00:05\.000 镜头切到/);
    assert.match(fields, /\n\nnon_diegetic_music: 缓慢的钢琴独奏/);
    assert.match(api.fromBaseDisplay(display.image_video), /\n\nnon_diegetic_music: N\/A$/);
    // Without options the mode and duration are read back from the shown alignment.
    assert.equal(api.toBaseDisplay(display.first_last), display.first_last);
    assert.equal(api.toBaseDisplay({modelPrompt:official.first_last, displayPrompt:fields}, {mode:'text_video', durationSeconds:8}), display.text_video);
  }
});

test('tolerant parsing accepts JSON, every alignment variant, newline-separated shots and a timestamp without comma', () => {
  for (const api of apis) {
    const body = 'integrated_multimodal_description: [Shot 1] a girl waves\n[Shot 2] At 00:02.000 she runs\n\noverall_soundscape: wind\n\nnon_diegetic_music: N/A';
    for (const alignment of ['', i2vLine, 'Reference alignment - <Picture 1> from [Shot 1] = 0.00 seconds', '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒', '参考图片与目标视频对齐：<Picture 1>（来自 [Shot 1]）= 0.00 秒']) {
      const parsed = json(api.parseBaseFields((alignment ? alignment + '\n\n' : '') + body));
      assert.equal(parsed.alignment, alignment);
      assert.equal(parsed.fields.integrated_multimodal_description, '[Shot 1] a girl waves\n[Shot 2] At 00:02.000 she runs');
    }
    const parsed = json(api.parseBaseFields(JSON.stringify({integrated_multimodal_description:'[Shot 1] x', overall_soundscape:'y', non_diegetic_music:'N/A'})));
    assert.deepEqual(parsed, {fields:{integrated_multimodal_description:'[Shot 1] x', overall_soundscape:'y', non_diegetic_music:'N/A'}, alignment:''});
    assert.equal(api.validateBaseFields(body, {mode:'text_video', durationSeconds:5}), body.replace('00:02.000 she', '00:02.000, she'));
    // Plain unstructured text is not a fields form and passes through the converters unchanged.
    for (const plain of ['她挥手，镜头慢慢推近。', 'A girl waves.']) {
      assert.equal(api.parseBaseFields(plain), null);
      assert.equal(api.toBaseDisplay(plain, {mode:'image_video', durationSeconds:5}), plain);
      assert.equal(api.fromBaseDisplay(plain), plain);
    }
    // 多参's own display is not touched by the base converter.
    const reference = '【主体定义】\n<主体 1>：黑发少女\n\n【画面与动作】\n【镜头 1】少女挥手';
    assert.equal(api.fromBaseDisplay(reference), reference);
  }
});

test('validateBaseFields fixes the layout and rejects broken shots, media and language', () => {
  const fields = (narrative, soundscape = 'Wind.', music = '') => `integrated_multimodal_description: ${narrative}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;
  const t2v = {mode:'text_video', durationSeconds:6};
  for (const api of apis) {
    // [Shot 1] is added, a style sentence written before it moves behind it, empty music is N/A.
    assert.equal(api.validateBaseFields(fields('狐狸在雪地里奔跑。', '风声。', '无'), t2v), fields('[Shot 1] 狐狸在雪地里奔跑。', '风声。', 'N/A'));
    // Untimed later shots are spaced evenly, like 多参.
    assert.equal(api.validateBaseFields(fields('Watercolor style, [Shot 1] A fox runs. [Shot 2] The camera cuts to a river. [Shot 3] The camera cuts to the moon.'), t2v),
      fields('[Shot 1] Watercolor style. A fox runs.\n[Shot 2] At 00:02.000, The camera cuts to a river.\n[Shot 3] At 00:04.000, The camera cuts to the moon.', 'Wind.', 'N/A'));
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] a. [Shot 3] At 00:02.000, b.'), t2v), /镜头编号/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] a. [Shot 2] At 00:04.000, b. [Shot 3] At 00:03.000, c.'), t2v), /切换时间/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] a. [Shot 2] At 00:06.000, b.'), t2v), /切换时间/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] a. [Shot 2] At 00:02.000, b. [Shot 3] c.'), t2v), /切换时间/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] a.', ''), t2v), /三个字段/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] a.'), {mode:'text_video', durationSeconds:45}), /1-30 秒/);
    // Media tokens per mode; <Subject N> belongs to 多参 only.
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] The girl in <Picture 1> waves.'), t2v), /参考媒体标签/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] <Picture 1> turns into <Picture 2>.'), {mode:'image_video', durationSeconds:6}), /参考媒体标签/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] <Picture 1> <Video 1>.'), {mode:'first_last', durationSeconds:6}), /参考媒体标签/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] <Subject 1> waves.'), t2v), /Subject N/);
    // A frame the narrative never names is anchored: the opening after the first sentence, the ending last.
    assert.equal(api.validateBaseFields(fields('[Shot 1] Live-action, a girl stands. She sits down.'), {mode:'first_last', durationSeconds:6}),
      fields('[Shot 1] Live-action, a girl stands. The shot begins in the position and framing established by <Picture 1>. She sits down. At the end of the shot, the action settles into the pose, spacing, and composition established by <Picture 2>.', 'Wind.', 'N/A'));
    assert.match(api.validateBaseFields(fields('[Shot 1] 写实摄影；中景\n少女坐下', '风声。'), {mode:'image_video', durationSeconds:6}), /^integrated_multimodal_description: \[Shot 1\] 写实摄影；中景。画面从 <Picture 1> 的位置与构图开始。\n少女坐下\n/);
    // FL2V bare labels are read as tags.
    assert.match(api.validateBaseFields(fields('[Shot 1] It starts as Picture 1 and ends as Picture 2.'), {mode:'first_last', durationSeconds:6}), /as <Picture 1> and ends as <Picture 2>\./);
    // Language: English model text keeps Chinese only in <d> and quotes; the display half must be Chinese.
    assert.equal(api.validateBaseFields(fields('[Shot 1] A sign reads "营业中" and she (S1) says: <d>出发吧。</d>'), {...t2v, language:'en'}),
      fields('[Shot 1] A sign reads "营业中" and she (S1) says: <d>[Chinese] 出发吧。</d>', 'Wind.', 'N/A'));
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] A girl 挥手 at the station.'), {...t2v, language:'en'}), /英文正文/);
    assert.throws(() => api.validateBaseFields(fields('[Shot 1] A girl waves at the camera while the train slowly arrives at the station.'), {...t2v, language:'zh'}), /简体中文/);
  }
});

test('validateBaseResult checks the bilingual pair for parity and completes camera and loop closure', () => {
  const options = {mode:'text_video', durationSeconds:8};
  const model = official.text_video;
  const shown = display.text_video;
  for (const api of apis) {
    const result = JSON.parse(api.validateBaseResult(JSON.stringify({modelPrompt:model, displayPrompt:shown}), options));
    assert.equal(result.modelPrompt, api.validateBaseFields(model, options));
    assert.equal(result.displayPrompt, api.fromBaseDisplay(shown));
    assert.equal(api.composeBaseModelPrompt(result.modelPrompt, options), model);
    // Object halves are accepted too.
    assert.equal(api.validateBaseResult({modelPrompt:json(api.parseBaseFields(model)).fields, displayPrompt:api.fromBaseDisplay(shown)}, options), JSON.stringify(result));
    const pair = changes => () => api.validateBaseResult({modelPrompt:model, displayPrompt:shown, ...changes}, options);
    assert.throws(pair({modelPrompt:model.replace(/ \[Shot 2\][^\n]*/, '')}), /镜头或切换时间不一致/);
    assert.throws(pair({modelPrompt:model.replace('00:05.000', '00:04.000')}), /镜头或切换时间不一致/);
    assert.throws(pair({modelPrompt:model.replace('今天风小。', '今天风大。')}), /台词或屏幕文字不一致/);
    assert.throws(pair({modelPrompt:model.replace('at a misty dock', 'at a "Harbor" dock')}), /台词或屏幕文字不一致/);
    assert.throws(pair({modelPrompt:model.replace('a small boat', '一艘小船')}), /英文正文/);
    assert.throws(pair({displayPrompt:model}), /简体中文/);
    // No camera anywhere: both halves get the default; a requested loop gets its closure.
    const bare = {modelPrompt:'integrated_multimodal_description: [Shot 1] Live-action, a girl waves.\n\noverall_soundscape: Wind.\n\nnon_diegetic_music: N/A', displayPrompt:'integrated_multimodal_description: [Shot 1] 写实风格，少女挥手。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: 无'};
    const completed = JSON.parse(api.validateBaseResult(bare, {...options, currentPrompt:'少女挥手，循环播放'}));
    assert.match(completed.modelPrompt, /a girl waves\. It ends by returning smoothly to the starting pose and motion phase so the loop joins naturally\. The camera holds a static shot and the framing stays stable\.\n/);
    assert.match(completed.displayPrompt, /少女挥手。结束时平滑回到起始姿态与运动相位，使循环自然衔接。镜头固定，构图保持稳定。\n/);
    const named = JSON.parse(api.validateBaseResult(bare, {...options, currentPrompt:'少女挥手，镜头缓慢推近'}));
    assert.doesNotMatch(named.modelPrompt + named.displayPrompt, /static shot|镜头固定/);
    // A single text is validated in the requested language and completed the same way.
    assert.equal(api.validateBaseResult(bare.displayPrompt, {...options, language:'zh'}), 'integrated_multimodal_description: [Shot 1] 写实风格，少女挥手。镜头固定，构图保持稳定。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A');
    assert.throws(() => api.validateBaseResult(model, {...options, language:'zh'}), /简体中文/);
  }
});

test('legacy five-section prompts convert to the display without a model', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/h3-five-sections.json', import.meta.url), 'utf8'));
  const five = local.validateFormat(JSON.stringify(fixture), {mode:'I2VA', minimaxH3Mode:'image_video', durationSeconds:10});
  const fl2v = '【任务定位】\n首尾帧视频，时长5秒。<Picture 1> 为起始首帧，<Picture 2> 为结束尾帧。\n\n【说话者】\n<Subject 1> = (S1)，<Picture 1> 中说这句台词的角色。\n\n【递进式详细提示词】\n穿红色战甲的女性站在雪山前，镜头固定。\n\n0-1.7s：<Subject 1> 缓慢抬起右手，开口说话。\n\n1.7-3.3s：右手举到肩高，停顿片刻。\n\n3.3-5s：右手缓缓放下，回到身侧。\n\n【台词】\n(S1)：“出发吧。”\n\n【连续性与约束】\n1. 保持上述人物身份、参考帧绑定及原文明确的约束。\n2. 环境与动作声音：风声和铠甲摩擦声\n3. 配乐：N/A\n4. 保持红色战甲与雪山背景。';
  for (const api of apis) {
    const shown = api.toBaseDisplay(five);
    assert.match(shown, /^【参考帧对齐】\n<Picture 1> 是视频第 0\.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】Use <Picture 1> as the exact starting frame\. /);
    assert.doesNotMatch(shown, /【任务定位】|【说话者】|【递进式详细提示词】|【台词】|【连续性与约束】|\d\s*-\s*\d+(?:\.\d+)?s：|<Subject/);
    // Dialogue follows the first phase that mentions speaking, after the speaker's real identity; constraint items are meta rules and are dropped.
    assert.match(shown, /镜头缓慢推进。紫眸赛博仿生女性 \(S1\) 说：<d>\[Chinese\] 系统自检完成。动力核心已上线，下一条指令——可以直接下达。<\/d> S1抬起右手/);
    assert.match(shown, /人物保持冷静。\n\n【环境声音】\n与画面动作一致的自然环境声和动作声。\n\n【背景音乐】\n无$/);
    assert.doesNotMatch(shown, /口型与说话自然|随机饰件|16:9/);
    // A generic speaker placeholder (…中说这句台词的角色) adds no identity.
    assert.equal(api.toBaseDisplay(fl2v), '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 5.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】穿红色战甲的女性站在雪山前，镜头固定。缓慢抬起右手，开口说话。(S1) 说：<d>[Chinese] 出发吧。</d>右手举到肩高，停顿片刻。右手缓缓放下，回到身侧。\n\n【环境声音】\n风声和铠甲摩擦声\n\n【背景音乐】\n无');
    // Two speakers defined on one line each keep their own identity.
    const twoSpeakers = fl2v.replace('<Subject 1> = (S1)，<Picture 1> 中说这句台词的角色。', '<Subject 1> = (S1)，红衣少女；<Subject 2> = (S2)，老人。').replace('(S1)：“出发吧。”', '(S1)：“出发吧。”\n(S2)：“再见。”');
    assert.match(api.toBaseDisplay(twoSpeakers), /开口说话。红衣少女 \(S1\) 说：<d>\[Chinese\] 出发吧。<\/d>老人 \(S2\) 说：<d>\[Chinese\] 再见。<\/d>右手举到肩高/);
    // Explicit options win over the task line; the result validates as Chinese fields.
    assert.match(api.toBaseDisplay(fl2v, {mode:'first_last', durationSeconds:6}), /对齐第 6\.00 秒（结尾）/);
    assert.equal(api.validateBaseResult(fl2v, {mode:'first_last', durationSeconds:5, language:'zh'}), 'integrated_multimodal_description: [Shot 1] 穿红色战甲的女性站在雪山前，镜头固定。画面从 <Picture 1> 的位置与构图开始。缓慢抬起右手，开口说话。(S1) 说：<d>[Chinese] 出发吧。</d>右手举到肩高，停顿片刻。右手缓缓放下，回到身侧。结尾时，动作落定在 <Picture 2> 的姿态、位置与构图。\n\noverall_soundscape: 风声和铠甲摩擦声\n\nnon_diegetic_music: N/A');
    assert.equal(api.toBaseDisplay(api.fromBaseDisplay(api.toBaseDisplay(fl2v)), {mode:'first_last', durationSeconds:5}), api.toBaseDisplay(fl2v));
  }
});

test('reverse outputs: local fact slots become readable sentences, Grok prose passes through', () => {
  const localI2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒\n\nintegrated_multimodal_description: [Shot 1] 主体1：数量：一名；身份：红色战甲女性；外观：黑色长发；姿态：站立；动作：抬手。\n\n场景：雪山。\n\n画面：全身景；平视。\n\n光色材质：自然光。\n\n随后：她转身向镜头挥手。按用户运镜：镜头缓慢推近。\n\n她说：<d>出发吧。</d>\n\noverall_soundscape: 与场景一致的低强度环境底声。\n\nnon_diegetic_music: N/A';
  const localFl2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒；<Picture 2> 对应 [Shot 1] = 5.00 秒\n\nintegrated_multimodal_description: [Shot 1]\n<Picture 1> 与 <Picture 2> 共同：\n主体1：数量：一名；身份：红色战甲女性；外观：黑色长发；动作：抬手。\n场景：雪山。\n画面：全身景；平视。\n光色材质：自然光。\n\n<Picture 1> 首帧：\n主体1：姿态：站立。\n\n<Picture 2> 尾帧：\n主体1：姿态：坐下。\n\n画面从首帧状态自然延续，动作连贯。镜头保持构图。动作在 5.00 秒连续抵达尾帧状态。\n\noverall_soundscape: 与场景一致的低强度环境底声。\n\nnon_diegetic_music: N/A';
  const localEn = 'Reference alignment - <Picture 1> from [Shot 1] = 0.00 seconds\n\nintegrated_multimodal_description: [Shot 1] Subject 1: count 一名; 红色战甲女性, 黑色长发; pose 站立; action 抬手.\n\nScene: 雪山.\n\nFraming: 全身景, 平视.\n\nLook: 自然光.\n\nThen: 她转身向镜头挥手. Camera follows: 镜头缓慢推近.\n\n她说：<d>出发吧。</d>\n\noverall_soundscape: Low ambience consistent with the scene.\n\nnon_diegetic_music: N/A';
  // compileMiniMaxH3PromptFromVisualFacts output for sample facts (Edge Grok reverse).
  const grokFl2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒；<Picture 2> 对应 [Shot 1] = 5.00 秒（尾帧）。\n\nintegrated_multimodal_description: [Shot 1] 写实摄影；中景；平视\n\n一名 少女；黑色短发；橙色衬衫；站在路边\n\n乡村公路；远处稻田\n\n午后自然光；暖橙色调\n\n动作从首帧姿态轻缓开始，以小幅、连续的姿态变化自然推进，随后逐渐收稳。\n\n镜头保持固定，延续首帧的视角与构图。\n\n过渡过程中逐步到达尾帧状态：坐在路边\n\n到 5.00 秒，动作连续收束至 <Picture 2> 的准确姿态、物体位置与构图。\n\noverall_soundscape: 低声、平稳的环境底声贯穿画面，轻微的动作声随可见运动同步起落。\n\nnon_diegetic_music: N/A';
  const grokI2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒。\n\nintegrated_multimodal_description: [Shot 1] 写实摄影；中景；平视\n\n一名 少女；黑色短发；橙色衬衫；站在路边\n\n<Picture 1> 她转身向镜头挥手，说：“出发吧。”\n\n镜头保持固定，延续首帧的视角与构图。\n\noverall_soundscape: 低声、平稳的环境底声贯穿画面，轻微的动作声随可见运动同步起落。\n\nnon_diegetic_music: N/A';
  const i2v = {mode:'image_video', durationSeconds:5};
  for (const api of apis) {
    const expected = {
      localI2v: '【参考帧对齐】\n<Picture 1> 是视频第 0.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】一名红色战甲女性，黑色长发，站立，抬手。\n场景是雪山。\n画面为全身景，平视。\n光色与质感为自然光。\n随后，她转身向镜头挥手。镜头缓慢推近。\n她说：<d>[Chinese] 出发吧。</d>\n\n【环境声音】\n与场景一致的低强度环境底声。\n\n【背景音乐】\n无',
      // FL2V frame groups read as time phrases; the inventory's own transition sentence is told once.
      localFl2v: '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 5.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】两帧中都有一名红色战甲女性，黑色长发，抬手。\n场景是雪山。\n画面为全身景，平视。\n光色与质感为自然光。\n开头画面 <Picture 1> 中，站立。\n结尾画面 <Picture 2> 中，坐下。\n画面从首帧状态自然延续，动作连贯。镜头保持构图。动作在 5.00 秒连续抵达尾帧状态。\n\n【环境声音】\n与场景一致的低强度环境底声。\n\n【背景音乐】\n无',
      grokFl2v: '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 5.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】写实摄影；中景；平视\n一名 少女；黑色短发；橙色衬衫；站在路边\n乡村公路；远处稻田\n午后自然光；暖橙色调\n动作从首帧姿态轻缓开始，以小幅、连续的姿态变化自然推进，随后逐渐收稳。\n镜头保持固定，延续首帧的视角与构图。\n过渡过程中逐步到达尾帧状态：坐在路边\n到 5.00 秒，动作连续收束至 <Picture 2> 的准确姿态、物体位置与构图。\n\n【环境声音】\n低声、平稳的环境底声贯穿画面，轻微的动作声随可见运动同步起落。\n\n【背景音乐】\n无',
    };
    assert.equal(api.toBaseDisplay(localI2v, i2v), expected.localI2v);
    // A count joins its identity, and the requested camera reads as a sentence on a line of its own too.
    const cat = localI2v.replace('数量：一名；身份：红色战甲女性', '数量：两只；身份：橘猫').replace('挥手。按用户运镜：', '挥手。\n\n按用户运镜：');
    assert.match(api.toBaseDisplay(cat, i2v), /【镜头 1】两只橘猫，黑色长发，站立，抬手。\n[\s\S]*\n随后，她转身向镜头挥手。\n镜头缓慢推近。\n/);
    // The mode and duration also come from the reverse alignment line itself.
    assert.equal(api.toBaseDisplay(localFl2v), expected.localFl2v);
    // A style fact opens the shot, and a motion line between the frames is told before the ending frame.
    const styled = localFl2v.replace('光色材质：自然光。', '光色材质：自然光；国风插画。').replace('\n\n画面从首帧状态', '\n\n随后：她缓缓坐下。\n\n画面从首帧状态');
    assert.match(api.toBaseDisplay(styled), /【镜头 1】国风插画。\n两帧中都有[^\n]*\n场景是雪山。\n画面为全身景，平视。\n光色与质感为自然光。\n开头画面 <Picture 1> 中，站立。\n随后，她缓缓坐下。\n结尾画面 <Picture 2> 中，坐下。\n画面从首帧状态/);
    assert.doesNotMatch(api.toBaseDisplay(styled), /随后画面从开头状态/);
    // Without a motion line or a transition sentence, one neutral sentence carries the opening into the ending.
    assert.match(api.toBaseDisplay(localFl2v.replace('\n\n画面从首帧状态自然延续，动作连贯。镜头保持构图。动作在 5.00 秒连续抵达尾帧状态。', '')), /\n开头画面 <Picture 1> 中，站立。\n随后画面从开头状态连续、自然地过渡到结尾状态。\n结尾画面 <Picture 2> 中，坐下。\n\n/);
    // Each frame keeps its own style (幻想 / 梦幻); only a shared style opens the shot.
    const frameStyles = localFl2v.replace('主体1：姿态：站立。', '主体1：姿态：站立。\n光色材质：幻想风格；蓝紫色调。').replace('主体1：姿态：坐下。', '主体1：姿态：坐下。\n光色材质：梦幻风格；暖光。');
    assert.match(api.toBaseDisplay(frameStyles), /【镜头 1】两帧中都有[^\n]*\n[^]*\n开头画面 <Picture 1> 中，站立。\n光色与质感为幻想风格，蓝紫色调。\n结尾画面 <Picture 2> 中，坐下。\n光色与质感为梦幻风格，暖光。\n/);
    assert.equal(api.toBaseDisplay(grokFl2v), expected.grokFl2v);
    assert.match(api.toBaseDisplay(grokI2v, i2v), /\n【镜头 1】写实摄影；中景；平视\n一名 少女；黑色短发；橙色衬衫；站在路边\n<Picture 1> 她转身向镜头挥手，说：“出发吧。”\n镜头保持固定/);
    // Every fact value survives, and the display is stable through another round.
    for (const [source, shown] of [[localI2v, expected.localI2v], [localFl2v, expected.localFl2v]]) {
      const narrative = source.split('integrated_multimodal_description:')[1].split('overall_soundscape:')[0];
      for (const value of narrative.match(/(?<=[：；])[^：；\n。<]+(?=[；。\n])/g)) assert.ok(shown.includes(value), value);
      assert.equal(api.toBaseDisplay(api.fromBaseDisplay(shown), {mode:/<Picture 2>/.test(shown) ? 'first_last' : 'image_video', durationSeconds:5}), shown);
    }
    const english = api.toBaseDisplay(localEn, i2v);
    assert.match(english, /\n【镜头 1】一名红色战甲女性, 黑色长发, 站立, 抬手\.\nThe scene is 雪山\.\nThe framing is 全身景, 平视\.\nThe look is 自然光\.\nThen, 她转身向镜头挥手\. Camera follows: 镜头缓慢推近\.\n她说：<d>\[Chinese\] 出发吧。<\/d>\n/);
    // The reverse display is valid Chinese fields for the later compile step; the frame groups name both pictures.
    assert.match(api.validateBaseFields(expected.localFl2v, {mode:'first_last', durationSeconds:5, language:'zh'}), /^integrated_multimodal_description: \[Shot 1\] 两帧中都有一名红色战甲女性，黑色长发，抬手。\n[^]*\n开头画面 <Picture 1> 中，站立。\n/);
  }
});

test('new messages are app-owned repair reasons and the instructions never trigger the old mode scan', () => {
  const edgeModeScan = [/(?:ref2va|r2v|multi[-_\s]?reference|full[-_\s]?reference|全参考|多参)/i, /(?:fl2va|first[-_\s]?last|首尾帧)/i, /(?:i2va|image[-_\s]?video|图生视频)/i, /(?:l2va|video[-_\s]?reference|视频参考)/i];
  const failures = [
    ['text_video', 'integrated_multimodal_description: [Shot 1] a', 'sections'],
    ['text_video', 'integrated_multimodal_description: [Shot 1] a [Shot 3] At 00:01.000, b\n\noverall_soundscape: c', 'timeline'],
    ['text_video', 'integrated_multimodal_description: [Shot 1] a [Shot 2] At 00:09.000, b\n\noverall_soundscape: c', 'timeline'],
    ['text_video', 'integrated_multimodal_description: [Shot 1] <Subject 1> a\n\noverall_soundscape: c', 'references'],
    ['text_video', 'integrated_multimodal_description: [Shot 1] <Picture 1> a\n\noverall_soundscape: c', 'references'],
  ];
  for (const api of apis) {
    for (const [mode, text, reason] of failures) {
      let error;
      try { api.validateBaseFields(text, {mode, durationSeconds:5}); } catch (caught) { error = caught; }
      assert.equal(api.validationIssue(error).reason, reason, text);
    }
    for (const message of ['H3 中英文提示词的镜头或切换时间不一致', 'H3 中英文提示词的台词或屏幕文字不一致', '请将画面与动作、环境声音和背景音乐改为简体中文，保留原台词和媒体标签', 'H3 模型侧提示词需要英文正文，中文内容仅用于编辑器显示']) {
      assert.notEqual(api.validationIssue(new Error(message)).reason, 'contract_invalid', message);
    }
    const requirements = [api.baseInstruction, api.baseResultInstruction, api.baseTranslateInstruction].join('\n');
    for (const pattern of edgeModeScan) assert.doesNotMatch(requirements, pattern);
    assert.match(api.baseInstruction, /\[Shot N\] At MM:SS\.mmm, the camera cuts to/);
    assert.match(api.baseTranslateInstruction, /faithful English translation[\s\S]*push in, pull out, pan, truck, tilt, pedestal, arc shot, tracking shot, static shot, zoom, shake, POV or roll/);
    const schema = json(api.baseResultSchema);
    assert.deepEqual(schema.required, ['modelPrompt', 'displayPrompt']);
    for (const half of ['modelPrompt', 'displayPrompt']) {
      assert.equal(schema.properties[half].additionalProperties, false);
      assert.deepEqual(schema.properties[half].required, json(api.baseFields));
      for (const field of api.baseFields) assert.ok(schema.properties[half].properties[field].description.length > 20);
    }
  }
});

const fields = (narrative, soundscape = 'Wind.', music = 'N/A') => `integrated_multimodal_description: ${narrative}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;

test('a translation that drops a block of the Chinese fails the per-shot coverage check', () => {
  // Round 1 rev_fl2v: the English half left out the whole ending-frame block and still passed.
  const zh = '[Shot 1] 写实数字渲染风格，中景，略仰视视角。紫发女子坐在大理石台阶上，长直紫发披肩，穿白色透视长裙配金色腰封，右手握金色月牙法杖，赤足伸展双腿，左臂撑在台阶上。橘色长毛猫蹲坐于下方台阶。背景为夜色山脉与古建筑遗迹，前景是白色大理石台阶，散落红色花瓣。上方柔和暮光照射台阶，整体色板为深蓝紫与粉橙渐变。过渡过程中逐步到达尾帧状态：女子身着白色半透明长裙搭配金色腰带，右手握持金色月牙法杖，赤足坐在大理石台阶上，左手撑在台阶上，双腿交叠。台阶下方有一只橙色长毛猫咪蹲坐，法杖周围飘散金色光粒子，裙摆带有星光效果。背景为层层大理石台阶延伸向上，中景为山脉与古建筑剪影，光源来自画面右上方的柔和暮光。镜头保持固定。';
  const en = '[Shot 1] Realistic digital rendering style, medium shot, slightly low angle. A purple-haired woman sits on marble steps, long straight purple hair over her shoulders, wearing a sheer white long dress with a golden waist sash, holding a golden crescent staff in her right hand, bare feet with legs extended, left arm propped on the steps. An orange long-haired cat crouches on a lower step. The background shows night mountains and ancient ruins, with white marble steps in the foreground scattered with red petals. Soft twilight from above lights the steps, and the palette is deep blue-purple with pink-orange gradients. Over the transition she gradually reaches the final state: she wears a sheer white long dress with a golden belt, holds the golden crescent staff in her right hand, sits barefoot on the marble steps with her left hand propped on a step and her legs crossed. Below the steps an orange long-haired cat crouches, golden light particles drift around the staff, and the hem of her dress sparkles with starlight. Layers of marble steps rise in the background, with mountains and silhouettes of ancient buildings in the middle ground, lit by soft twilight from the upper right. The camera holds a static shot.';
  const options = {mode:'text_video', durationSeconds:6};
  for (const api of apis) {
    assert.doesNotThrow(() => api.validateBaseResult({modelPrompt:fields(en), displayPrompt:fields(zh, '风声。')}, options));
    const dropped = en.replace(/ Over the transition[\s\S]*upper right\./, '');
    assert.throws(() => api.validateBaseResult({modelPrompt:fields(dropped), displayPrompt:fields(zh, '风声。')}, options), /遗漏了中文内容/);
    // Translate-only checks it too: the display half is the user's own source.
    assert.throws(() => api.validateBaseResult({modelPrompt:fields(dropped), displayPrompt:fields(zh, '风声。')}, {...options, displayIsSource:true}), /遗漏了中文内容/);
    // Each shot is measured on its own: a dropped later shot fails even when the first is long.
    const cut = ' [Shot 2] At 00:04.000, the camera cuts to a close-up of the cat, which flicks its tail twice, lifts its head toward the woman and slowly closes its amber eyes as petals drift past.';
    const cutZh = '\n[Shot 2] At 00:04.000 镜头切到猫的特写，它轻轻甩尾两次，抬头望向女子，在飘过的花瓣中慢慢闭上琥珀色的眼睛。';
    assert.doesNotThrow(() => api.validateBaseResult({modelPrompt:fields(en + cut), displayPrompt:fields(zh + cutZh, '风声。')}, options));
    assert.throws(() => api.validateBaseResult({modelPrompt:fields(en + ' [Shot 2] At 00:04.000, the camera cuts to the cat.'), displayPrompt:fields(zh + cutZh, '风声。')}, options), /遗漏了中文内容/);
    assert.equal(api.validationIssue(new Error('H3 英文提示词遗漏了中文内容，请逐句完整翻译每个镜头')).reason, 'language');
  }
});

test('the Chinese half of an optimize pair may not keep single English words; a translate-only source may', () => {
  const options = {mode:'text_video', durationSeconds:10, currentPrompt:'先是城市夜景全景，然后切到街角咖啡店里的女孩'};
  const model = fields('[Shot 1] Live-action, cinematic, a wide night view of the city skyline. The camera holds a static shot.', 'Distant traffic hums with faint city ambience.');
  for (const api of apis) {
    for (const leak of ['远处交通声和 faint 城市氛围。', '女孩 says 你好。', '猫落地时一声 thud。'])
      assert.throws(() => api.validateBaseResult({modelPrompt:model, displayPrompt:fields('[Shot 1] 写实电影风格，城市夜景全景。镜头固定。', leak)}, options), /夹带英文单词/);
    // Capitals (3D, CG), tags, times, N/A and the user's own words stay.
    assert.doesNotThrow(() => api.validateBaseResult({modelPrompt:model, displayPrompt:fields('[Shot 1] 3D CG 风格，城市夜景全景。镜头固定。', '远处交通声。')}, options));
    assert.doesNotThrow(() => api.validateBaseResult({modelPrompt:model, displayPrompt:fields('[Shot 1] 写实风格，vlog 画面中的城市夜景。镜头固定。', '远处交通声。')}, {...options, currentPrompt:'拍一段城市夜景 vlog'}));
    assert.doesNotThrow(() => api.validateBaseResult({modelPrompt:model, displayPrompt:fields('[Shot 1] A girl walks, 城市夜景。镜头固定。', '远处交通声。')}, {...options, displayIsSource:true}));
    assert.equal(api.validationIssue(new Error('H3 中文显示稿夹带英文单词，请译为简体中文，仅台词、屏幕文字和媒体标签保持原样')).reason, 'language');
  }
});

test('the English half uses the official wording for cuts, a still camera and vertical moves', () => {
  const t2v = {mode:'text_video', durationSeconds:8};
  for (const api of apis) {
    const english = api.validateBaseFields(fields('[Shot 1] Live-action. The camera remains static throughout the shot as she reads. A sign reads "The camera is static". [Shot 2] At 00:03.000 close-up of her hands. The camera slowly pans downward to the page. [Shot 3] At 00:05.000, A wide shot of the room, static shot. The camera holds its composition while she says: <d>[English] The camera maintains composition.</d>'), {...t2v, language:'en'});
    assert.match(english, /^integrated_multimodal_description: \[Shot 1\] Live-action\. The camera holds a static shot as she reads\. A sign reads "The camera is static"\.\n/);
    assert.match(english, /\n\[Shot 2\] At 00:03\.000, the shot cuts to close-up of her hands\. The camera slowly tilts down to the page\.\n/);
    assert.match(english, /\n\[Shot 3\] At 00:05\.000, the shot cuts to a wide shot of the room\. The camera holds a static shot\. The camera holds a static shot while she says: <d>\[English\] The camera maintains composition\.<\/d>\n/);
    // An existing cut verb stays; the Chinese display and 'zh' fields are never rewritten.
    assert.match(api.composeBaseModelPrompt(fields('[Shot 1] A cat sits. [Shot 2] At 00:04.000, the camera cuts to a close-up.'), t2v), /\[Shot 2\] At 00:04\.000, the camera cuts to a close-up\./);
    const chinese = fields('[Shot 1] 猫坐着。镜头固定。\n[Shot 2] At 00:04.000 猫的特写。', '风声。');
    assert.equal(api.validateBaseFields(chinese, {...t2v, language:'zh'}), chinese);
    // A pan becomes a tilt only for the camera; a still camera only at its clause end, never beside a camera move or inside an adjective list.
    for (const narrative of ['[Shot 1] Live-action, a chef sets the pots and pans down and picks the frying pan up. Peter Pan up in the sky waves. The camera holds a static shot.',
      '[Shot 1] Live-action, a runner sprints; the camera keeps the framing centered on her as it tracks right at fast speed.',
      '[Shot 1] Live-action, an old man reads; the camera maintains the composition while slowly pushing in toward his hands.',
      '[Shot 1] Live-action, a lighthouse at dusk; the camera slowly pulls back, ending on a wide, static shot.',
      '[Shot 1] Live-action, a boy flies a kite on the beach, framed in a low-angle, static shot.']) {
      assert.equal(api.validateBaseFields(fields(narrative), {...t2v, language:'en'}), fields(narrative), narrative);
    }
    // A later shot that opens with a clause stands as its own sentence after the cut.
    assert.match(api.validateBaseFields(fields('[Shot 1] A city at night. The camera pans up to the sky. [Shot 2] At 00:04.000, the girl walks into a café. [Shot 3] At 00:06.000, she turns and waves.'), {...t2v, language:'en'}),
      /The camera tilts up to the sky\.\n\[Shot 2\] At 00:04\.000, the shot cuts\. The girl walks into a café\.\n\[Shot 3\] At 00:06\.000, the shot cuts\. She turns and waves\./);
  }
});

test('quoted speech, labelled or not, must reach a <d> block unless the requirement changes the dialogue', () => {
  const i2v = {mode:'image_video', durationSeconds:5};
  const kept = fields('[Shot 1] <Picture 1> 中的女孩抬手向镜头挥手，(S1) 说：<d>[Chinese] 出发吧。</d>镜头固定。', '风声。');
  const lost = fields('[Shot 1] <Picture 1> 中的女孩抬手向镜头挥手。镜头固定。', '风声。');
  for (const api of apis) {
    for (const source of ['<Picture 1> 中的女孩抬手向镜头挥手并说：“出发吧。”', '<Picture 1> 中的女孩挥手喊道“出发吧！”', '<Picture 1> waves and says "出发吧"', '<Picture 1> 挥手，(S1) 说：<d>[Chinese] 出发吧。</d>']) {
      assert.doesNotThrow(() => api.validateBaseResult(kept, {...i2v, currentPrompt:source}), source);
      assert.throws(() => api.validateBaseResult(lost, {...i2v, currentPrompt:source}), /原台词未完整保留/, source);
    }
    // In a pair the English half is what H3 hears.
    const english = fields('[Shot 1] The girl shown in <Picture 1> waves toward the camera. The camera holds a static shot.', 'Wind.');
    assert.throws(() => api.validateBaseResult({modelPrompt:english, displayPrompt:lost}, {...i2v, currentPrompt:'<Picture 1> 挥手并说：“出发吧。”'}), /原台词未完整保留/);
    // A requirement about the dialogue replaces the old line; one line it quotes must arrive instead.
    const source = '<Picture 1> 中的女孩挥手并说：“出发吧。”';
    const requirements = changed => 'Source prompt:\n' + source + '\n\n' + changed;
    const renamed = kept.replace('出发吧。', '走吧。');
    assert.doesNotThrow(() => api.validateBaseResult(renamed, {...i2v, currentPrompt:source, requirements:requirements('把台词改成“走吧。”')}));
    assert.throws(() => api.validateBaseResult(kept, {...i2v, currentPrompt:source, requirements:requirements('把台词改成“走吧。”')}), /原台词未完整保留/);
    assert.doesNotThrow(() => api.validateBaseResult(lost, {...i2v, currentPrompt:source, requirements:requirements('删掉台词')}));
    // The requirement decides by what it says: a new line to say replaces the source line, silence drops it, keeping it keeps it.
    for (const changed of ['把“出发吧。”改成“走吧。”', '让她改说“走吧。”']) {
      assert.doesNotThrow(() => api.validateBaseResult(renamed, {...i2v, currentPrompt:source, requirements:requirements(changed)}), changed);
      assert.throws(() => api.validateBaseResult(lost, {...i2v, currentPrompt:source, requirements:requirements(changed)}), /原台词未完整保留/, changed);
    }
    for (const silent of ['让她保持沉默，只挥手', '她不开口，只挥手']) assert.doesNotThrow(() => api.validateBaseResult(lost, {...i2v, currentPrompt:source, requirements:requirements(silent)}), silent);
    assert.throws(() => api.validateBaseResult(lost, {...i2v, currentPrompt:source, requirements:requirements('保留原台词，把镜头改成缓慢推近')}), /原台词未完整保留/);
    // A reverse result is rebuilt from the pictures (quotedLines: false); its refinement keeps the lines.
    assert.doesNotThrow(() => api.validateBaseResult(lost, {...i2v, currentPrompt:source, quotedLines:false}));
    // Quoted on-screen text is no speech.
    assert.doesNotThrow(() => api.validateBaseResult(lost, {...i2v, currentPrompt:'<Picture 1> 旁的招牌写着“营业中”'}));
  }
});

test('looking at the lens names no camera; the idle-breathing rule only reaches idle requests', () => {
  for (const api of apis) {
    const pair = {modelPrompt:fields('[Shot 1] Live-action, the cat looks up toward the camera and blinks slowly.'), displayPrompt:fields('[Shot 1] 写实风格，猫抬头看向镜头，慢慢眨眼。', '风声。')};
    const completed = JSON.parse(api.validateBaseResult(pair, {mode:'text_video', durationSeconds:5, currentPrompt:'猫抬头看向镜头，慢慢眨眼'}));
    assert.match(completed.modelPrompt, /blinks slowly\. The camera holds a static shot and the framing stays stable\./);
    assert.match(completed.displayPrompt, /慢慢眨眼。镜头固定，构图保持稳定。/);
    // A camera move of the lens (镜头前推, 镜头前移, 跟拍) is a camera; standing in front of the lens is not.
    for (const moving of ['女孩向前奔跑，镜头前推，逐渐靠近她的背影。', '男孩踢球，镜头前移贴近足球。', '女孩看向镜头微笑，随后转身离开，跟拍她的背影。']) {
      assert.equal(api.validateBaseResult(fields('[Shot 1] ' + moving, '风声。'), {mode:'text_video', durationSeconds:5, currentPrompt:moving}), fields('[Shot 1] ' + moving, '风声。'), moving);
    }
    assert.match(api.validateBaseResult(fields('[Shot 1] 女孩站在镜头前微笑。', '风声。'), {mode:'text_video', durationSeconds:5, currentPrompt:'女孩站在镜头前微笑'}), /微笑。镜头固定，构图保持稳定。/);
    assert.doesNotMatch(api.instructionFor('紫发女神闭目养神，晚风轻拂长发'), /仅呼吸待机/);
    // Only the idle sentence leaves; the rest of its policy item (no invented events for sequencing) stays.
    assert.match(api.instructionFor('一只橘猫在窗台上伸懒腰，然后跳下窗台'), /^静止或持续状态可以贯穿整个镜头的动作顺序，不必为了制造先后差异新增事件。\n/);
    for (const idle of ['机器人原地待机', '胸口随呼吸起伏', 'an idle loop', 'slow breathing']) assert.match(api.instructionFor(idle), /仅呼吸待机/, idle);
    assert.equal(api.instructionFor('原地待机'), api.instruction);
  }
});

test('the five copies stay in sync with the shared source and policy', () => {
  const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(read('../../novaflow-web/admin/admin-server/h3-prompt-enhance.js'), read('../admin-server/h3-prompt-enhance.js'));
  assert.equal(read('../../novaflow-web/admin/prompt_assistant/h3_prompt_enhance_policy.json'), read('../prompt_assistant/h3_prompt_enhance_policy.json'));
  assert.equal(read('../../novaflow-web/renderer/h3-prompt-format.js'), read('../../particle-editor/h3-prompt-format.js'));
  const names = Object.keys(local).sort();
  assert.deepEqual(Object.keys(edge).sort(), names);
  assert.deepEqual(Object.keys(renderer).sort(), names);
  for (const name of ['instructionFor', 'baseFields', 'baseDisplayFields', 'baseModeName', 'baseInstruction', 'baseResultInstruction', 'baseTranslateInstruction', 'baseResultSchema', 'baseAlignmentLine', 'baseDisplayAlignment', 'parseBaseFields', 'validateBaseFields', 'composeBaseModelPrompt', 'toBaseDisplay', 'fromBaseDisplay', 'validateBaseResult']) assert.ok(names.includes(name), name);
  const policy = JSON.parse(read('../prompt_assistant/h3_prompt_enhance_policy.json'));
  assert.equal(local.baseInstruction, policy.baseInstructions.join('\n'));
  assert.doesNotMatch(policy.instructions.join('\n'), /时间段|timed actions/);
});

test('the opening-frame anchor never lands inside dialogue; a static camera and a cut time before its marker read officially', () => {
  const i2v = 'integrated_multimodal_description: [Shot 1] The girl (S1) says: <d>[Chinese] 出发吧。</d> Then she waves. The camera holds static.\n\noverall_soundscape: Wind blows softly.\n\nnon_diegetic_music: N/A';
  const ref = 'subject_definitions:\n<Subject 1>: A woman from <Picture 1>.\n\nsummary:\n[reference generation] <Subject 1> walks.\n\nretention_analysis:\n<Subject 1>: fully_preserved - face and hair.\n\ndetailed_description:\nLive-action. [Shot 1] <Subject 1> walks along the road. At 00:03.000, [Shot 2] a close-up of <Subject 1> smiling.\n\noverall_soundscape:\nFootsteps.\n\nnon_diegetic_music:\nN/A';
  for (const api of apis) {
    const text = api.validateBaseFields(i2v, {mode:'image_video', durationSeconds:5, language:'en'});
    assert.match(text, /<d>\[Chinese\] 出发吧。<\/d> Then she waves\. The shot begins in the position and framing established by <Picture 1>\./);
    assert.match(text, /The camera holds a static shot\./);
    assert.match(api.validateReference(ref, {durationSeconds:5, requirements:'Available resource labels: <Picture 1>'}), /walks along the road\.\n?\s*\[Shot 2\] At 00:03\.000, the shot cuts to a close-up/);
  }
});

test('a Grok pair writes N/A sound only when the user asks for silence; "is a static shot" reads officially', () => {
  const pair = sound => JSON.stringify({
    modelPrompt: `integrated_multimodal_description: [Shot 1] 3D CG, a robot stands idle in front of a green screen. The camera is a static shot.\n\noverall_soundscape: ${sound}\n\nnon_diegetic_music: N/A`,
    displayPrompt: `integrated_multimodal_description: [Shot 1] 三维动画风格，一个机器人在绿幕前原地待机。镜头固定。\n\noverall_soundscape: ${sound === 'N/A' ? 'N/A' : '低沉的机械嗡鸣声。'}\n\nnon_diegetic_music: N/A`,
  });
  for (const api of apis) {
    assert.throws(() => api.validateBaseResult(pair('N/A'), {mode:'text_video', durationSeconds:8, currentPrompt:'绿幕前的机器人原地待机'}), /静音/);
    assert.equal(api.validationIssue(new Error('H3 环境声音只有用户要求静音时才能写 N/A，请写出与画面一致的具体环境声和动作声')).reason, 'sections');
    assert.doesNotThrow(() => api.validateBaseResult(pair('N/A'), {mode:'text_video', durationSeconds:8, currentPrompt:'绿幕前的机器人原地待机，完全静音'}));
    assert.match(JSON.parse(api.validateBaseResult(pair('A low mechanical hum.'), {mode:'text_video', durationSeconds:8, currentPrompt:'绿幕前的机器人原地待机'})).modelPrompt, /The camera holds a static shot\./);
  }
});

test("shot sizes follow the words: the user's size stays in the display and each English size follows its shot", () => {
  const pairOf = (model, display) => JSON.stringify({modelPrompt:fields(model, 'Wind moves through the leaves.'), displayPrompt:fields(display, '风吹过树叶。')});
  const cut = '一只橘猫坐在窗台上，第3秒切到近景，它开始舔爪子';
  const model = '[Shot 1] Live-action, a full shot frames a ginger cat sitting on a sunny windowsill. The camera holds a static shot.\n[Shot 2] At 00:03.000, the camera cuts to a close-up of the cat licking its paw.';
  for (const api of apis) {
    const sized = display => JSON.parse(api.validateBaseResult(pairOf(model, display), {mode:'text_video', durationSeconds:6, currentPrompt:cut}));
    // The display says 近景 (the user's word): the English is a medium close-up, not a close-up; 全景 stays a full shot.
    const kept = sized('[Shot 1] 写实风格，全景中一只橘猫坐在阳光照耀的窗台上。镜头固定。\n[Shot 2] At 00:03.000 镜头切到猫舔爪子的近景。');
    assert.match(kept.modelPrompt, /a full shot frames[\s\S]*cuts to a medium close-up of the cat/);
    // The writer turned the user's 近景 into 特写 in the cut shot: the display gets the user's word back, the English follows it.
    const swapped = sized('[Shot 1] 写实风格，全景中一只橘猫坐在阳光照耀的窗台上。镜头固定。\n[Shot 2] At 00:03.000 镜头切到猫舔爪子的特写。');
    assert.match(swapped.displayPrompt, /\[Shot 2\] At 00:03\.000 镜头切到猫舔爪子的近景。/);
    assert.match(swapped.modelPrompt, /cuts to a medium close-up of the cat/);
    // A translation keeps the source as written and only maps the English; 前景/中景/后景 layers are no shot sizes.
    const translated = JSON.parse(api.validateBaseResult(pairOf(model, '[Shot 1] 写实风格，全景中一只橘猫坐在阳光照耀的窗台上。镜头固定。\n[Shot 2] At 00:03.000 镜头切到猫舔爪子的特写。'), {mode:'text_video', durationSeconds:6, currentPrompt:cut, displayIsSource:true}));
    assert.match(translated.displayPrompt, /舔爪子的特写/);
    assert.match(translated.modelPrompt, /cuts to a close-up of the cat/);
    const layered = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, a wide shot frames a garden with roses in front, a bench in the middle and trees behind. The camera holds a static shot.', '[Shot 1] 写实风格，远景画面，前景是玫瑰，中景是长椅，后景是树林。镜头固定。'), {mode:'text_video', durationSeconds:6, currentPrompt:'花园'}));
    assert.match(layered.modelPrompt, /a wide shot frames a garden/);
    // A cut time written at the end of the previous shot moves behind its marker, with its verb.
    const early = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, a full shot frames a ginger cat on a windowsill. The camera holds a static shot. At 00:03.000 the camera cuts to [Shot 2] A medium close-up of the cat licking its paw.', '[Shot 1] 写实风格，全景中一只橘猫坐在窗台上。镜头固定。00:03.000 时镜头切到 [Shot 2] 猫舔爪子的近景。'), {mode:'text_video', durationSeconds:6, currentPrompt:cut}));
    assert.match(early.modelPrompt, /static shot\.\n\[Shot 2\] At 00:03\.000, the camera cuts to a medium close-up of the cat/);
    assert.match(early.displayPrompt, /镜头固定。\n\[Shot 2\] At 00:03\.000 镜头切到 猫舔爪子的近景。/);
  }
});

test("a writer's pair (strictPair) reports every quality gate at once; the renderer re-validates without them", () => {
  const six = values => local.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  const source = '<Picture 1> 中的角色走向 <Picture 2> 中的角色，第3秒切到两人的近景';
  const options = {durationSeconds:5, currentPrompt:source, requirements:'Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n' + source};
  const english = six(['<Subject 1>: A girl with short dark hair, from <Picture 1>\n<Subject 2>: A small teal and copper robot, from <Picture 2>', '[reference generation] <Subject 1> walks toward <Subject 2>. At the 3-second mark the camera cuts to a close-up of both.',
    '<Subject 1>: fully_preserved - short dark hair\n<Subject 2>: fully_preserved - teal and copper body', 'In a vibrant anime illustration style. [Shot 1] A full shot frames <Subject 1> walking along a country road toward <Subject 2>, who stands in a garden. The camera tracks her slowly. At 00:03.000 the view cuts to [Shot 2] a close-up of <Subject 1> and <Subject 2> facing each other.', 'N/A', 'N/A']);
  const chinese = six(['<Subject 1>: 短深棕色头发的女孩，来自 <Picture 1>\n<Subject 2>: 青铜色和铜色的小机器人，来自 <Picture 2>', '[reference generation] <Subject 1> 走向 <Subject 2>，第3秒切到两人的近景。',
    '<Subject 1>: fully_preserved - 短深棕色头发、youthful 面容\n<Subject 2>: fully_preserved - 青铜色和铜色机身', '采用生动的动漫插画风格 [Shot 1] 全景中 <Subject 1> 沿乡间小路走向花园里的 <Subject 2>。镜头缓慢跟随她。00:03.000 时画面切至 [Shot 2] <Subject 1> 与 <Subject 2> 面对面的特写。', 'N/A', 'N/A']);
  const answer = JSON.stringify({modelPrompt:english, displayPrompt:chinese});
  for (const api of apis) {
    assert.throws(() => api.validateReferenceResult(answer, {...options, strictPair:true}), error => JSON.stringify(error.issues) === JSON.stringify([
      'H3 环境声音只有用户要求静音时才能写 N/A，请写出与画面一致的具体环境声和动作声', '请将多参主体、任务说明、保留规则和画面动作改为简体中文，保留原台词和媒体标签', 'H3 中文显示稿的颜色与英文不一致，请逐词准确翻译颜色']));
    assert.equal(api.validationIssue(new Error('H3 中文显示稿的颜色与英文不一致，请逐词准确翻译颜色')).reason, 'language');
    // Deterministic in every pair: the official style opening and cut wording, the cut time at its marker, the sizes, the shots of each retention line.
    const pair = JSON.parse(api.validateReferenceResult(answer, options));
    assert.match(pair.modelPrompt, /detailed_description:\nThe target video is in a vibrant anime illustration style\. \[Shot 1\][^\n]*The camera tracks her slowly\.\s*\[Shot 2\] At 00:03\.000, the shot cuts to a medium close-up of <Subject 1> and <Subject 2>/);
    assert.match(pair.modelPrompt, /cuts to a medium close-up of both\./);
    assert.match(pair.modelPrompt, /^<Subject 1> \(appears in \[Shot 1\], \[Shot 2\]\): fully_preserved - short dark hair$/m);
    assert.match(pair.displayPrompt, /^<Subject 2>（出现在 \[Shot 1\]、\[Shot 2\]）: fully_preserved - 青铜色和铜色机身$/m);
    assert.match(pair.displayPrompt, /采用生动的动漫插画风格。 \[Shot 1\][\s\S]*\[Shot 2\] At 00:03\.000 画面切至 <Subject 1> 与 <Subject 2> 面对面的近景。/);
    assert.match(api.toReferenceDisplay(pair.displayPrompt), /^【主体定义】\n<主体 1>: [\s\S]*^<主体 1>（出现在 【镜头 1】、【镜头 2】）: 完全保留 - /m);
    // A translation keeps its source display: no appearances are added to it and only the shot and speech parity is gated.
    const translated = JSON.parse(api.validateReferenceResult(answer, {...options, strictPair:true, displayIsSource:true}));
    assert.doesNotMatch(translated.displayPrompt, /出现在/);
  }
});

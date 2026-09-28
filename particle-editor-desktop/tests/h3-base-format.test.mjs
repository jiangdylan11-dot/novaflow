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
    // Dialogue follows the first phase that mentions speaking; the other constraints end the narrative.
    assert.match(shown, /镜头缓慢推进。\(S1\) 说：<d>\[Chinese\] 系统自检完成。动力核心已上线，下一条指令——可以直接下达。<\/d> S1抬起右手/);
    assert.match(shown, /人物保持冷静。口型与说话自然，脸部、身份稳定。赛博细节丰富，不增加随机饰件或过度闪烁。保持上半身机械联动，不突然切远景。保持16:9横图构图。\n\n【环境声音】\n与画面动作一致的自然环境声和动作声。\n\n【背景音乐】\n无$/);
    assert.equal(api.toBaseDisplay(fl2v), '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 5.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】穿红色战甲的女性站在雪山前，镜头固定。缓慢抬起右手，开口说话。(S1) 说：<d>[Chinese] 出发吧。</d>右手举到肩高，停顿片刻。右手缓缓放下，回到身侧。保持红色战甲与雪山背景。\n\n【环境声音】\n风声和铠甲摩擦声\n\n【背景音乐】\n无');
    // Explicit options win over the task line; the result validates as Chinese fields.
    assert.match(api.toBaseDisplay(fl2v, {mode:'first_last', durationSeconds:6}), /对齐第 6\.00 秒（结尾）/);
    assert.equal(api.validateBaseResult(fl2v, {mode:'first_last', durationSeconds:5, language:'zh'}), 'integrated_multimodal_description: [Shot 1] 穿红色战甲的女性站在雪山前，镜头固定。画面从 <Picture 1> 的位置与构图开始。缓慢抬起右手，开口说话。(S1) 说：<d>[Chinese] 出发吧。</d>右手举到肩高，停顿片刻。右手缓缓放下，回到身侧。保持红色战甲与雪山背景。结尾时，动作落定在 <Picture 2> 的姿态、位置与构图。\n\noverall_soundscape: 风声和铠甲摩擦声\n\nnon_diegetic_music: N/A');
    assert.equal(api.toBaseDisplay(api.fromBaseDisplay(api.toBaseDisplay(fl2v)), {mode:'first_last', durationSeconds:5}), api.toBaseDisplay(fl2v));
  }
});

test('reverse outputs: local fact slots become readable lines, Grok prose passes through', () => {
  const localI2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒\n\nintegrated_multimodal_description: [Shot 1] 主体1：数量：一名；身份：红色战甲女性；外观：黑色长发；姿态：站立；动作：抬手。\n\n场景：雪山。\n\n画面：全身景；平视。\n\n光色材质：自然光。\n\n随后：她转身向镜头挥手。按用户运镜：镜头缓慢推近。\n\n她说：<d>出发吧。</d>\n\noverall_soundscape: 与场景一致的低强度环境底声。\n\nnon_diegetic_music: N/A';
  const localFl2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒；<Picture 2> 对应 [Shot 1] = 5.00 秒\n\nintegrated_multimodal_description: [Shot 1]\n<Picture 1> 与 <Picture 2> 共同：\n主体1：数量：一名；身份：红色战甲女性；外观：黑色长发；动作：抬手。\n场景：雪山。\n画面：全身景；平视。\n光色材质：自然光。\n\n<Picture 1> 首帧：\n主体1：姿态：站立。\n\n<Picture 2> 尾帧：\n主体1：姿态：坐下。\n\n画面从首帧状态自然延续，动作连贯。镜头保持构图。动作在 5.00 秒连续抵达尾帧状态。\n\noverall_soundscape: 与场景一致的低强度环境底声。\n\nnon_diegetic_music: N/A';
  const localEn = 'Reference alignment - <Picture 1> from [Shot 1] = 0.00 seconds\n\nintegrated_multimodal_description: [Shot 1] Subject 1: count 一名; 红色战甲女性, 黑色长发; pose 站立; action 抬手.\n\nScene: 雪山.\n\nFraming: 全身景, 平视.\n\nLook: 自然光.\n\nThen: 她转身向镜头挥手. Camera follows: 镜头缓慢推近.\n\n她说：<d>出发吧。</d>\n\noverall_soundscape: Low ambience consistent with the scene.\n\nnon_diegetic_music: N/A';
  // compileMiniMaxH3PromptFromVisualFacts output for sample facts (Edge Grok reverse).
  const grokFl2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒；<Picture 2> 对应 [Shot 1] = 5.00 秒（尾帧）。\n\nintegrated_multimodal_description: [Shot 1] 写实摄影；中景；平视\n\n一名 少女；黑色短发；橙色衬衫；站在路边\n\n乡村公路；远处稻田\n\n午后自然光；暖橙色调\n\n动作从首帧姿态轻缓开始，以小幅、连续的姿态变化自然推进，随后逐渐收稳。\n\n镜头保持固定，延续首帧的视角与构图。\n\n过渡过程中逐步到达尾帧状态：坐在路边\n\n到 5.00 秒，动作连续收束至 <Picture 2> 的准确姿态、物体位置与构图。\n\noverall_soundscape: 低声、平稳的环境底声贯穿画面，轻微的动作声随可见运动同步起落。\n\nnon_diegetic_music: N/A';
  const grokI2v = '参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒。\n\nintegrated_multimodal_description: [Shot 1] 写实摄影；中景；平视\n\n一名 少女；黑色短发；橙色衬衫；站在路边\n\n<Picture 1> 她转身向镜头挥手，说：“出发吧。”\n\n镜头保持固定，延续首帧的视角与构图。\n\noverall_soundscape: 低声、平稳的环境底声贯穿画面，轻微的动作声随可见运动同步起落。\n\nnon_diegetic_music: N/A';
  const i2v = {mode:'image_video', durationSeconds:5};
  for (const api of apis) {
    const expected = {
      localI2v: '【参考帧对齐】\n<Picture 1> 是视频第 0.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】一名红色战甲女性，黑色长发，站立，抬手。\n场景：雪山。\n画面：全身景，平视。\n光色材质：自然光。\n随后，她转身向镜头挥手。镜头缓慢推近。\n她说：<d>[Chinese] 出发吧。</d>\n\n【环境声音】\n与场景一致的低强度环境底声。\n\n【背景音乐】\n无',
      localFl2v: '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 5.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】两帧共有：\n一名红色战甲女性，黑色长发，抬手。\n场景：雪山。\n画面：全身景，平视。\n光色材质：自然光。\n开头（<Picture 1>）：\n站立。\n结尾（<Picture 2>）：\n坐下。\n画面从首帧状态自然延续，动作连贯。镜头保持构图。动作在 5.00 秒连续抵达尾帧状态。\n\n【环境声音】\n与场景一致的低强度环境底声。\n\n【背景音乐】\n无',
      grokFl2v: '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 5.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】写实摄影；中景；平视\n一名 少女；黑色短发；橙色衬衫；站在路边\n乡村公路；远处稻田\n午后自然光；暖橙色调\n动作从首帧姿态轻缓开始，以小幅、连续的姿态变化自然推进，随后逐渐收稳。\n镜头保持固定，延续首帧的视角与构图。\n过渡过程中逐步到达尾帧状态：坐在路边\n到 5.00 秒，动作连续收束至 <Picture 2> 的准确姿态、物体位置与构图。\n\n【环境声音】\n低声、平稳的环境底声贯穿画面，轻微的动作声随可见运动同步起落。\n\n【背景音乐】\n无',
    };
    assert.equal(api.toBaseDisplay(localI2v, i2v), expected.localI2v);
    // A count joins its identity, and the requested camera reads as a sentence on a line of its own too.
    const cat = localI2v.replace('数量：一名；身份：红色战甲女性', '数量：两只；身份：橘猫').replace('挥手。按用户运镜：', '挥手。\n\n按用户运镜：');
    assert.match(api.toBaseDisplay(cat, i2v), /【镜头 1】两只橘猫，黑色长发，站立，抬手。\n[\s\S]*\n随后，她转身向镜头挥手。\n镜头缓慢推近。\n/);
    // The mode and duration also come from the reverse alignment line itself.
    assert.equal(api.toBaseDisplay(localFl2v), expected.localFl2v);
    assert.equal(api.toBaseDisplay(grokFl2v), expected.grokFl2v);
    assert.match(api.toBaseDisplay(grokI2v, i2v), /\n【镜头 1】写实摄影；中景；平视\n一名 少女；黑色短发；橙色衬衫；站在路边\n<Picture 1> 她转身向镜头挥手，说：“出发吧。”\n镜头保持固定/);
    // Every fact value survives, and the display is stable through another round.
    for (const [source, shown] of [[localI2v, expected.localI2v], [localFl2v, expected.localFl2v]]) {
      const narrative = source.split('integrated_multimodal_description:')[1].split('overall_soundscape:')[0];
      for (const value of narrative.match(/(?<=[：；])[^：；\n。<]+(?=[；。\n])/g)) assert.ok(shown.includes(value), value);
      assert.equal(api.toBaseDisplay(api.fromBaseDisplay(shown), {mode:/<Picture 2>/.test(shown) ? 'first_last' : 'image_video', durationSeconds:5}), shown);
    }
    const english = api.toBaseDisplay(localEn, i2v);
    assert.match(english, /\n【镜头 1】一名红色战甲女性, 黑色长发, 站立, 抬手\.\nScene: 雪山\.\nFraming: 全身景, 平视\.\nLook: 自然光\.\nThen, 她转身向镜头挥手\. Camera follows: 镜头缓慢推近\.\n她说：<d>\[Chinese\] 出发吧。<\/d>\n/);
    // The reverse display is valid Chinese fields for the later compile step.
    assert.match(api.validateBaseFields(expected.localFl2v, {mode:'first_last', durationSeconds:5, language:'zh'}), /^integrated_multimodal_description: \[Shot 1\] 两帧共有：\n/);
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

test('the five copies stay in sync with the shared source and policy', () => {
  const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(read('../../novaflow-web/admin/admin-server/h3-prompt-enhance.js'), read('../admin-server/h3-prompt-enhance.js'));
  assert.equal(read('../../novaflow-web/admin/prompt_assistant/h3_prompt_enhance_policy.json'), read('../prompt_assistant/h3_prompt_enhance_policy.json'));
  assert.equal(read('../../novaflow-web/renderer/h3-prompt-format.js'), read('../../particle-editor/h3-prompt-format.js'));
  const names = Object.keys(local).sort();
  assert.deepEqual(Object.keys(edge).sort(), names);
  assert.deepEqual(Object.keys(renderer).sort(), names);
  for (const name of ['baseFields', 'baseDisplayFields', 'baseModeName', 'baseInstruction', 'baseResultInstruction', 'baseTranslateInstruction', 'baseResultSchema', 'baseAlignmentLine', 'baseDisplayAlignment', 'parseBaseFields', 'validateBaseFields', 'composeBaseModelPrompt', 'toBaseDisplay', 'fromBaseDisplay', 'validateBaseResult']) assert.ok(names.includes(name), name);
  const policy = JSON.parse(read('../prompt_assistant/h3_prompt_enhance_policy.json'));
  assert.equal(local.baseInstruction, policy.baseInstructions.join('\n'));
  assert.doesNotMatch(policy.instructions.join('\n'), /时间段|timed actions/);
});

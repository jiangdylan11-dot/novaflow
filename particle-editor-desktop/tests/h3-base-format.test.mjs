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
  text_video: '【画面与动作】\n【镜头 1】写实电影风格，中远景，黎明前起雾的码头上，一位渔夫正在解开小船。镜头以小幅度缓慢推近，嗓音低沉粗粝的老渔夫 (S1) 收起缆绳说：“今天风小。”\n【镜头 2】（第 5 秒）镜头切到船桨探入静水的特写，涟漪向外扩散。\n\n【环境声音】\n水拍打木码头，缆绳吱呀作响。船桨轻轻划水，远处一只海鸥叫了一声。\n\n【背景音乐】\n缓慢的钢琴独奏，低音稀疏，结尾渐弱。',
  image_video: '【参考帧对齐】\n<Picture 1> 是视频第 0.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】二维动画风格，<Picture 1> 中的男孩坐在窗边书桌前，服装、台灯和房间布局保持不变。镜头保持固定，他合上笔记本，双臂向上伸展，转向写着“明天见”的纸牌。\n\n【环境声音】\n台灯轻声嗡鸣，纸张沙沙作响，他向后靠时椅子吱呀一声。\n\n【背景音乐】\n无',
  first_last: '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 8.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】三维 CG 风格，小机器人从 <Picture 1> 的位置与构图开始，站在一只合着的箱子旁。镜头以小幅度缓慢向左平移，它掀开箱盖。\n【镜头 2】（第 4.5 秒）镜头切到全景，机器人搬着箱子穿过工坊，镜头结尾落定在 <Picture 2> 的姿态、间距与构图。\n\n【环境声音】\n箱盖打开时金属铰链吱吱作响，随后是平稳的伺服声和水泥地上的轻步声。\n\n【背景音乐】\n无',
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
    // Displays written before the Chinese cut time and quoted lines (【镜头 2】 At 00:05.000, <d>[Chinese] …</d>) read back the same.
    const old = {text_video:display.text_video.replace('“今天风小。”', '<d>[Chinese] 今天风小。</d>').replace('（第 5 秒）', ' At 00:05.000 '), first_last:display.first_last.replace('（第 4.5 秒）', ' At 00:04.500 ')};
    for (const mode of Object.keys(old)) {
      assert.equal(api.fromBaseDisplay(old[mode]), api.fromBaseDisplay(display[mode]));
      assert.equal(api.toBaseDisplay(old[mode], {mode, durationSeconds:durations[mode]}), display[mode]);
    }
    assert.doesNotMatch(Object.values(display).join('\n'), /\bAt \d|<d>|\[Chinese\]/);
    // Without options the mode and duration are read back from the shown alignment.
    assert.equal(api.toBaseDisplay(display.first_last), display.first_last);
    assert.equal(api.toBaseDisplay({modelPrompt:official.first_last, displayPrompt:fields}, {mode:'text_video', durationSeconds:8}), display.text_video);
  }
});

test('the editor shows a cut time and a spoken line the Chinese way; every compile reads them back as the official markers', () => {
  const options = {mode:'image_video', durationSeconds:8};
  const spoken = 'integrated_multimodal_description: [Shot 1] 二维动画，<Picture 1> 中的女孩挥手，声音明亮的女孩 (S1) 说：<d>[Chinese] 出发吧。</d>她放下手。\n[Shot 2] At 00:04.500 镜头切到近景，(S1) 以画外音说：<d>[Japanese] 行こう。</d>路牌上写着“出口”。\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: 钢琴轻声弹奏。';
  const reference = local.referenceFields.map(k => k + ':\n' + {subject_definitions:'<Subject 1> 是 <Picture 1> 中的女孩。', summary:'[reference generation] <Subject 1> 挥手。', retention_analysis:'<Subject 1>: fully_preserved - 短发',
    detailed_description:'目标视频采用动漫风格。\n[Shot 1] <Subject 1> 挥手，女孩 (S1) 说：<d>[Chinese] 你好。</d>\n[Shot 2] At 00:03.000 镜头切到 <Subject 1> 的特写。', overall_soundscape:'风声。', non_diegetic_music:'N/A'}[k]).join('\n\n');
  for (const api of apis) {
    const shown = api.toBaseDisplay(spoken, options);
    assert.match(shown, /女孩 \(S1\) 说：“出发吧。”她放下手。\n【镜头 2】（第 4\.5 秒）镜头切到近景，\(S1\) 以画外音说：<d>\[Japanese\] 行こう。<\/d>路牌上写着“出口”。\n/);
    assert.equal(api.validateBaseFields(shown, options), api.validateBaseFields(spoken, options));
    // A line whose tag its words would not give ([Japanese]) stays a <d> block; on-screen text and a quote after no speaker stay quotes.
    assert.match(api.fromBaseDisplay(shown), /<d>\[Chinese\] 出发吧。<\/d>她放下手。\n\[Shot 2\] At 00:04\.500 镜头切到近景，\(S1\) 以画外音说：<d>\[Japanese\] 行こう。<\/d>路牌上写着“出口”。/);
    assert.match(api.fromBaseDisplay(shown.replace('她放下手。', '她放下手，心想：“真好。”')), /她放下手，心想：“真好。”/);
    // The user's own edits: a time written loosely, a line retyped in ASCII quotes, an English line, an old At marker.
    for (const [edit, back] of [[shown.replace('（第 4.5 秒）', '(第6秒)'), /\n\[Shot 2\] At 00:06\.000 镜头切到近景/], [shown.replace('（第 4.5 秒）', '（6.25 秒）'), /\n\[Shot 2\] At 00:06\.250 镜头切到近景/],
      [shown.replace('（第 4.5 秒）', ' At 00:05.000 '), /\n\[Shot 2\] At 00:05\.000 镜头切到近景/], [shown.replace('“出发吧。”', '"我们走吧！"'), /\(S1\) 说：<d>\[Chinese\] 我们走吧！<\/d>她放下手/],
      [shown.replace('“出发吧。”', '“Let\'s go.”'), /\(S1\) 说：<d>\[English\] Let's go\.<\/d>她放下手/]]) assert.match(api.validateBaseFields(edit, options), back);
    // A cut time typed with full-width digits, Chinese numerals, 点, 半 or s reads the same; one that is no number fails instead of being spaced evenly.
    for (const [time, at] of [['（第４秒）', '00:04.000'], ['（第４．５秒）', '00:04.500'], ['（第四秒）', '00:04.000'], ['（第 两 秒）', '00:02.000'], ['（第十二秒）', '00:12.000'], ['（第二十秒）', '00:20.000'],
      ['（第四点五秒）', '00:04.500'], ['（第七点二五秒）', '00:07.250'], ['（第4秒半）', '00:04.500'], ['（第 4 . 5 秒）', '00:04.500'], ['（第 5s）', '00:05.000'], ['（7.5s）', '00:07.500']])
      assert.match(api.fromBaseDisplay(shown.replace('（第 4.5 秒）', time)), new RegExp('\\n\\[Shot 2\\] At ' + at.replace('.', '\\.') + ' 镜头切到近景'));
    for (const time of ['（第十十秒）', '（第4.秒）', '（第四点五点五秒）']) assert.throws(() => api.validateBaseFields(shown.replace('（第 4.5 秒）', time), options), /镜头切换时间/);
    assert.match(api.fromBaseDisplay(shown.replace('（第 4.5 秒）', '（持续 2 秒）')), /\[Shot 2\] （持续 2 秒）镜头切到近景/);
    // A quote after a speaker ID and a colon is a line whatever the verb, typed or shown (大叫, 惊呼, says softly, the official voiceover);
    // on-screen text after a text-surface verb (写着, 亮着, reads) stays a quote, both ways.
    for (const [typed, line] of [['(S1) 大叫：“快跑！”', '(S1) 大叫：<d>[Chinese] 快跑！</d>'], ['(S1) 惊呼：“小心！”', '(S1) 惊呼：<d>[Chinese] 小心！</d>'], ['声音沙哑的老人 (S1) 缓缓开口：“天黑了。”', '声音沙哑的老人 (S1) 缓缓开口：<d>[Chinese] 天黑了。</d>'],
      ['(S1) says softly: "Run!"', '(S1) says softly: <d>[English] Run!</d>'], ['(S1) says in an off-screen voiceover: "It is late."', '(S1) says in an off-screen voiceover: <d>[English] It is late.</d>'],
      ['(S1) reads: "Once upon a time."', '(S1) reads: <d>[English] Once upon a time.</d>'], ['(S2) holds up a sign that reads: "OPEN"', '(S2) holds up a sign that reads: "OPEN"'], ['(S2) 举起纸条，上面写：“别走”', '(S2) 举起纸条，上面写：“别走”']]) {
      const edited = shown.replace('女孩 (S1) 说：“出发吧。”', typed);
      assert.ok(api.fromBaseDisplay(edited).includes(line), typed);
      assert.ok(api.fromBaseDisplay(api.toBaseDisplay(api.fromBaseDisplay(edited), options)).includes(line), typed);
      // The editor shows it as a quote again: only the [Japanese] line keeps its <d> block.
      assert.equal(api.toBaseDisplay(api.fromBaseDisplay(edited), options).split('<d>').length, 2, typed);
    }
    const sign = 'integrated_multimodal_description: [Shot 1] 二维动画，<Picture 1> 中的女孩 (S1) 举起木牌，木牌上写着：“营业中”。店主 (S2) 指向灯牌，灯牌亮着："OPEN"。(S1)：<d>[Chinese] 欢迎。</d>\n\noverall_soundscape: 风声。\n\nnon_diegetic_music: N/A';
    const signShown = api.toBaseDisplay(sign, options);
    assert.match(signShown, /木牌上写着：“营业中”。店主 \(S2\) 指向灯牌，灯牌亮着："OPEN"。\(S1\)：“欢迎。”/);
    assert.match(api.fromBaseDisplay(signShown), /木牌上写着：“营业中”。店主 \(S2\) 指向灯牌，灯牌亮着："OPEN"。\(S1\)：<d>\[Chinese\] 欢迎。<\/d>/);
    assert.equal(api.validateBaseFields(signShown, options), api.validateBaseFields(sign, options));
    const oldSign = sign.replace('“营业中”', '<d>[Chinese] 营业中</d>');
    assert.equal(api.fromBaseDisplay(api.toBaseDisplay(oldSign, options)), api.fromBaseDisplay(oldSign));
    // 多参 shows and reads the same way.
    const referenceShown = api.toReferenceDisplay(reference);
    assert.match(referenceShown, /<主体 1> 挥手，女孩 \(S1\) 说：“你好。”\n【镜头 2】（第 3 秒）镜头切到 <主体 1> 的特写。/);
    assert.match(api.fromReferenceDisplay(referenceShown), /女孩 \(S1\) 说：<d>\[Chinese\] 你好。<\/d>\n\[Shot 2\] At 00:03\.000 镜头切到 <Subject 1> 的特写。/);
    // The camera sentence starts its own line, never inside a spoken line or quoted text: the round trip stays exact.
    const director = reference.replace('<Subject 1> 挥手，女孩 (S1) 说：<d>[Chinese] 你好。</d>', '<Subject 1> 举起写着“禁止喧哗。镜头开拍”的牌子。镜头缓慢推近。<Subject 1> (S1) 说：<d>[Chinese] 看这里。镜头在这边！</d>');
    const directorShown = api.toReferenceDisplay(director);
    assert.match(directorShown, /<主体 1> 举起写着“禁止喧哗。镜头开拍”的牌子。\n镜头缓慢推近。\n<主体 1> \(S1\) 说：“看这里。镜头在这边！”\n/);
    assert.equal(api.fromReferenceDisplay(directorShown).replace(/\s+/g, ''), director.replace(/\s+/g, ''));
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
    // A frame the narrative never names is folded into its sentence (official FL2V case): the opening frame closes a style-led first sentence
    // (the writer's opening), the final frame the last sentence.
    assert.equal(api.validateBaseFields(fields('[Shot 1] Live-action, a girl stands. She sits down.'), {mode:'first_last', durationSeconds:6}),
      fields('[Shot 1] Live-action, a girl stands, as shown in <Picture 1>. She sits down, settling into the pose, spacing, and composition established by <Picture 2>.', 'Wind.', 'N/A'));
    assert.match(api.validateBaseFields(fields('[Shot 1] 写实摄影；中景\n少女坐下', '风声。'), {mode:'image_video', durationSeconds:6}), /^integrated_multimodal_description: \[Shot 1\] 写实摄影；中景，画面如 <Picture 1> 所示。\n少女坐下\n/);
    assert.doesNotMatch(api.validateBaseFields(fields('[Shot 1] Live-action, a girl stands. She sits down.'), {mode:'first_last', durationSeconds:6}), /The shot begins|At the end of the shot/);
    // Any other text may already act in its first sentence: it starts with the official sentence, so the frame comes before the action.
    // A clause replaces only a full stop or ends an unfinished sentence; after ！, ？, …, a spoken line or a quote the sentence stands alone.
    for (const [text, mode, anchored] of [
      ['[Shot 1] 男人转身，向镜头挥手。', 'image_video', '[Shot 1] 画面从 <Picture 1> 的位置与构图开始。男人转身，向镜头挥手。'],
      ['[Shot 1] The man turns around and waves at the camera. He smiles.', 'first_last', '[Shot 1] The shot begins in the position and framing established by <Picture 1>. The man turns around and waves at the camera. He smiles, settling into the pose, spacing, and composition established by <Picture 2>.'],
      ['[Shot 1] 男人大喊一声！他转身跑开，你看到了吗？', 'first_last', '[Shot 1] 画面从 <Picture 1> 的位置与构图开始。男人大喊一声！他转身跑开，你看到了吗？结尾时，动作落定在 <Picture 2> 的姿态、位置与构图。'],
      ['[Shot 1] Live-action, cinematic, a man in a grey coat stands on a bridge at dusk… The camera pushes in.', 'image_video', '[Shot 1] The shot begins in the position and framing established by <Picture 1>. Live-action, cinematic, a man in a grey coat stands on a bridge at dusk… The camera pushes in.'],
      ['[Shot 1] 写实电影风格，女孩站在门边。她把木牌翻到写着“打烊”的一面……', 'first_last', '[Shot 1] 写实电影风格，女孩站在门边，画面如 <Picture 1> 所示。她把木牌翻到写着“打烊”的一面……结尾时，动作落定在 <Picture 2> 的姿态、位置与构图。'],
      ['[Shot 1] Live-action, a girl stands by the door. She waves as the girl (S1) says: <d>[English] See you.</d>', 'first_last', '[Shot 1] Live-action, a girl stands by the door, as shown in <Picture 1>. She waves as the girl (S1) says: <d>[English] See you.</d> At the end of the shot, the action settles into the pose, spacing, and composition established by <Picture 2>.']])
      assert.equal(api.validateBaseFields(fields(text), {mode, durationSeconds:6}).split('\n\n')[0], 'integrated_multimodal_description: ' + anchored, text);
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
    assert.match(shown, /镜头缓慢推进。紫眸赛博仿生女性 \(S1\) 说：“系统自检完成。动力核心已上线，下一条指令——可以直接下达。” S1抬起右手/);
    assert.match(api.fromBaseDisplay(shown), /紫眸赛博仿生女性 \(S1\) 说：<d>\[Chinese\] 系统自检完成。动力核心已上线，下一条指令——可以直接下达。<\/d> S1抬起右手/);
    assert.match(shown, /人物保持冷静。\n\n【环境声音】\n与画面动作一致的自然环境声和动作声。\n\n【背景音乐】\n无$/);
    assert.doesNotMatch(shown, /口型与说话自然|随机饰件|16:9/);
    // A generic speaker placeholder (…中说这句台词的角色) adds no identity.
    assert.equal(api.toBaseDisplay(fl2v), '【参考帧对齐】\n<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐第 5.00 秒（结尾）。\n\n【画面与动作】\n【镜头 1】穿红色战甲的女性站在雪山前，镜头固定。缓慢抬起右手，开口说话。(S1) 说：“出发吧。”右手举到肩高，停顿片刻。右手缓缓放下，回到身侧。\n\n【环境声音】\n风声和铠甲摩擦声\n\n【背景音乐】\n无');
    // Two speakers defined on one line each keep their own identity.
    const twoSpeakers = fl2v.replace('<Subject 1> = (S1)，<Picture 1> 中说这句台词的角色。', '<Subject 1> = (S1)，红衣少女；<Subject 2> = (S2)，老人。').replace('(S1)：“出发吧。”', '(S1)：“出发吧。”\n(S2)：“再见。”');
    assert.match(api.toBaseDisplay(twoSpeakers), /开口说话。红衣少女 \(S1\) 说：“出发吧。”老人 \(S2\) 说：“再见。”右手举到肩高/);
    // Explicit options win over the task line; the result validates as Chinese fields.
    assert.match(api.toBaseDisplay(fl2v, {mode:'first_last', durationSeconds:6}), /对齐第 6\.00 秒（结尾）/);
    assert.equal(api.validateBaseResult(fl2v, {mode:'first_last', durationSeconds:5, language:'zh'}), 'integrated_multimodal_description: [Shot 1] 画面从 <Picture 1> 的位置与构图开始。穿红色战甲的女性站在雪山前，镜头固定。缓慢抬起右手，开口说话。(S1) 说：<d>[Chinese] 出发吧。</d>右手举到肩高，停顿片刻。右手缓缓放下，回到身侧，最终落定在 <Picture 2> 的姿态、位置与构图。\n\noverall_soundscape: 风声和铠甲摩擦声\n\nnon_diegetic_music: N/A');
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

test('the Chinese half of an optimize pair: common English words are written in Chinese, a rarer one is a display slip for the small fix; a translate-only source may keep words', () => {
  // One shot, as the user asks (a requested cut must become its own shot, a gate of its own).
  const options = {mode:'text_video', durationSeconds:10, currentPrompt:'城市夜景全景，街角咖啡店的灯亮着'};
  const model = fields('[Shot 1] Live-action, cinematic, a wide night view of the city skyline. The camera holds a static shot.', 'Distant traffic hums with faint city ambience.');
  const shown = (api, sound, extra = {}) => JSON.parse(api.validateBaseResult({modelPrompt:model, displayPrompt:fields('[Shot 1] 写实电影风格，城市夜景全景。镜头固定。', sound)}, {...options, ...extra})).displayPrompt;
  for (const api of apis) {
    // The program writes the words a display most often keeps (sound words, speech verbs, colours, materials, style and cut phrases) in Chinese.
    for (const [leak, fixed] of [['远处交通声和 faint 城市氛围。', '远处交通声和细微的城市氛围。'], ['女孩 says 你好。', '女孩说你好。'], ['猫落地时一声 thud。', '猫落地时一声闷响。'], ['猫尾扫过 marble 台阶。', '猫尾扫过大理石台阶。'],
      ['猫发出一声惊讶的 meow。', '猫发出一声惊讶的喵叫声。'], ['笛声在追逐时 swell，拥抱时 soften。', '笛声在追逐时渐强，拥抱时变柔和。'], ['红色面具 markings 随喘息起伏。', '红色面具斑纹随喘息起伏。']])
      assert.ok(shown(api, leak, {strictPair:true}).endsWith('overall_soundscape: ' + fixed + '\n\nnon_diegetic_music: N/A'), leak);
    // A rarer word fails a writer's pair as a display slip only, its sentence marked for the one small fix call; the renderer keeps it.
    assert.throws(() => shown(api, '远处传来 gazebo 旁的风铃声。', {strictPair:true}), error => error.h3DisplayOnly === true && /夹带英文单词/.test(error.message)
      && JSON.stringify(error.h3Slips) === JSON.stringify(['远处传来 ⟦gazebo⟧ 旁的风铃声。']));
    assert.match(shown(api, '远处传来 gazebo 旁的风铃声。'), /gazebo/);
    // Capitals (3D, CG) are professional terms; tags, times, N/A and the user's own words stay.
    assert.doesNotThrow(() => api.validateBaseResult({modelPrompt:model, displayPrompt:fields('[Shot 1] 3D CG 风格，城市夜景全景。镜头固定。', '远处交通声。')}, {...options, strictPair:true}));
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
    assert.match(english, /\n\[Shot 2\] At 00:03\.000, the shot cuts to close-up of her hands\. The camera tilts down at slow speed to the page\.\n/);
    // A speed the writer gave after the amplitude is not given twice (round 5: "pushes in at slow speed with small amplitude at slow speed").
    assert.match(api.validateBaseFields(fields('[Shot 1] Live-action, a cat sits. The camera slowly pushes in with small amplitude at slow speed as it blinks.'), {...t2v, language:'en'}),
      /The camera pushes in with small amplitude at slow speed as it blinks\./);
    assert.match(english, /\n\[Shot 3\] At 00:05\.000, the shot cuts to a wide shot of the room\. The camera holds a static shot\. The camera holds a static shot while she says: <d>\[English\] The camera maintains composition\.<\/d>\n/);
    // An existing cut verb stays; the Chinese display and 'zh' fields are never rewritten.
    assert.match(api.composeBaseModelPrompt(fields('[Shot 1] A cat sits. [Shot 2] At 00:04.000, the camera cuts to a close-up.'), t2v), /\[Shot 2\] At 00:04\.000, the camera cuts to a close-up\./);
    const chinese = fields('[Shot 1] 猫坐着。镜头固定。\n[Shot 2] At 00:04.000 猫的特写。', '风声。');
    assert.equal(api.validateBaseFields(chinese, {...t2v, language:'zh'}), chinese);
    // A pan becomes a tilt only for the camera; a still camera only at its clause end, never beside a camera move or inside an adjective list.
    for (const narrative of ['[Shot 1] Live-action, a chef sets the pots and pans down and picks the frying pan up. Peter Pan up in the sky waves. The camera holds a static shot.',
      '[Shot 1] Live-action, a runner sprints; the camera keeps the framing centered on her as it tracks right at fast speed.',
      '[Shot 1] Live-action, an old man reads; the camera maintains the composition while slowly pushing in toward his hands.',
      '[Shot 1] Live-action, a lighthouse at dusk; the camera pulls out at slow speed, ending on a wide, static shot.',
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

test('a look at the lens (回头看镜头, 直视镜头) gets the default static camera; a lens move or an angle (镜头前推, 俯拍) does not', () => {
  for (const api of apis) {
    const camera = (source, en, zh) => JSON.parse(api.validateBaseResult({modelPrompt:fields('[Shot 1] ' + en), displayPrompt:fields('[Shot 1] ' + zh, '风声。')}, {mode:'text_video', durationSeconds:5, currentPrompt:source})).modelPrompt;
    assert.match(camera('猫咪跳上桌子后回头看镜头', 'Live-action, a ginger cat jumps onto a wooden table and turns its head toward the lens.', '写实风格，橘猫跳上木桌，然后回头看向镜头。'), /toward the lens\. The camera holds a static shot/);
    assert.match(camera('女孩直视镜头微笑', 'Live-action, a girl smiles into the lens.', '写实风格，女孩直视镜头微笑。'), /into the lens\. The camera holds a static shot/);
    assert.doesNotMatch(camera('女孩向前奔跑，镜头前推', 'Live-action, a girl runs forward.', '写实风格，女孩向前奔跑。'), /static shot/);
    assert.doesNotMatch(camera('俯拍一只橘猫在窗台上睡觉', 'Live-action, a ginger cat sleeps on a windowsill.', '写实风格，橘猫在窗台上睡觉。'), /static shot/);
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
  const styled = i2v.replace('[Shot 1] The girl', '[Shot 1] Live-action, a girl stands under a sign that reads "OPEN. COME IN." by the door. The girl');
  const ref = 'subject_definitions:\n<Subject 1>: A woman from <Picture 1>.\n\nsummary:\n[reference generation] <Subject 1> walks.\n\nretention_analysis:\n<Subject 1>: fully_preserved - face and hair.\n\ndetailed_description:\nLive-action. [Shot 1] <Subject 1> walks along the road. At 00:03.000, [Shot 2] a close-up of <Subject 1> smiling.\n\noverall_soundscape:\nFootsteps.\n\nnon_diegetic_music:\nN/A';
  for (const api of apis) {
    const text = api.validateBaseFields(i2v, {mode:'image_video', durationSeconds:5, language:'en'});
    assert.match(text, /^integrated_multimodal_description: \[Shot 1\] The shot begins in the position and framing established by <Picture 1>\. The girl \(S1\) says: <d>\[Chinese\] 出发吧。<\/d> Then she waves\. The camera/);
    assert.match(api.validateBaseFields(styled, {mode:'image_video', durationSeconds:5, language:'en'}), /a sign that reads "OPEN\. COME IN\." by the door, as shown in <Picture 1>\. The girl \(S1\) says: <d>\[Chinese\] 出发吧。<\/d> Then she waves\. The camera/);
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
    // The writer's display reads as Chinese: no space is left between the cut verb and what it cuts to.
    assert.match(early.displayPrompt, /镜头固定。\n\[Shot 2\] At 00:03\.000 镜头切到猫舔爪子的近景。/);
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
    // The content gates (silence, the official length) ask for the repair; the display slips ride along. The one swapped colour
    // (teal → 青铜) is set back by the program; two wrong colours in one line stay a colour slip.
    assert.throws(() => api.validateReferenceResult(answer, {...options, strictPair:true}), error => JSON.stringify(error.issues) === JSON.stringify([
      'H3 环境声音只有用户要求静音时才能写 N/A，请写出与画面一致的具体环境声和动作声', 'H3 多参画面与动作过短，请按官方指南写到 350-500 个英文单词', '请将多参主体、任务说明、保留规则和画面动作改为简体中文，保留原台词和媒体标签']));
    assert.throws(() => api.validateReferenceResult(answer.replace('青铜色和铜色的小机器人', '青铜色和紫色的小机器人'), {...options, strictPair:true}), error => error.issues.at(-1) === 'H3 中文显示稿的颜色与英文不一致，请逐词准确翻译颜色');
    assert.equal(api.validationIssue(new Error('H3 中文显示稿的颜色与英文不一致，请逐词准确翻译颜色')).reason, 'language');
    assert.equal(api.validationIssue(new Error('H3 多参画面与动作过短，请按官方指南写到 350-500 个英文单词')).reason, 'sections');
    // Deterministic in every pair: the official style opening and cut wording, the cut time at its marker, the sizes, the shots of each retention line.
    const pair = JSON.parse(api.validateReferenceResult(answer, options));
    assert.match(pair.modelPrompt, /detailed_description:\nThe target video is in a vibrant anime illustration style\. \[Shot 1\][^\n]*The camera tracks her slowly\.\s*\[Shot 2\] At 00:03\.000, the shot cuts to a medium close-up of <Subject 1> and <Subject 2>/);
    assert.match(pair.modelPrompt, /cuts to a medium close-up of both\./);
    assert.match(pair.modelPrompt, /^<Subject 1> \(appears in \[Shot 1\], \[Shot 2\]\): fully_preserved - short dark hair$/m);
    assert.match(pair.displayPrompt, /^<Subject 2>（出现在 \[Shot 1\]、\[Shot 2\]）: fully_preserved - 青绿色和铜色机身$/m);
    assert.match(pair.displayPrompt, /^<Subject 2>: 青绿色和铜色的小机器人/m);
    assert.match(pair.displayPrompt, /采用生动的动漫插画风格。 \[Shot 1\][\s\S]*\[Shot 2\] At 00:03\.000 画面切至 <Subject 1> 与 <Subject 2> 面对面的近景。/);
    assert.match(api.toReferenceDisplay(pair.displayPrompt), /^【主体定义】\n<主体 1>: [\s\S]*^<主体 1>（出现在 【镜头 1】、【镜头 2】）: 完全保留 - /m);
    // A translation keeps its source display: no appearances are added to it and only the shot and speech parity is gated.
    const translated = JSON.parse(api.validateReferenceResult(answer, {...options, strictPair:true, displayIsSource:true}));
    assert.doesNotMatch(translated.displayPrompt, /出现在/);
  }
});

test('shot sizes change only where the words differ: a cut size never lands in the opening, and an order swap stays', () => {
  const pairOf = (model, display) => ({modelPrompt:fields(model, 'Soft purring.'), displayPrompt:fields(display, '轻柔的呼噜声。')});
  const cut = '一只橘猫坐在窗台上，第3秒切到近景，它开始舔爪子';
  for (const api of apis) {
    // The cut shot names no size, or the writer kept one shot: the opening 全景 stays a full shot in both halves.
    const noSize = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, a full shot frames a ginger cat sitting on a sunny windowsill. The camera holds a static shot.\n[Shot 2] At 00:03.000, the camera cuts to the cat licking its paw.', '[Shot 1] 写实风格，全景中一只橘猫坐在阳光照耀的窗台上。镜头固定。\n[Shot 2] At 00:03.000 镜头切到猫舔爪子。'), {mode:'text_video', durationSeconds:6, currentPrompt:cut}));
    assert.match(noSize.modelPrompt, /\[Shot 1\] Live-action, a full shot frames/);
    assert.match(noSize.displayPrompt, /\[Shot 1\] 写实风格，全景中/);
    const oneShot = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, a full shot frames a ginger cat sitting on a sunny windowsill. The cat licks its paw. The camera holds a static shot.', '[Shot 1] 写实风格，全景中一只橘猫坐在阳光照耀的窗台上。猫舔爪子。镜头固定。'), {mode:'text_video', durationSeconds:6, currentPrompt:cut}));
    assert.match(oneShot.modelPrompt, /a full shot frames/);
    assert.match(oneShot.displayPrompt, /全景中/);
    // A timed cut written inside the shot, with no marker, starts its own shot in both halves, and that shot gets the user's size.
    const inline = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, a full shot frames an old keeper standing by a lighthouse. Wind moves his coat. At 00:04.000, the camera cuts to a close-up of the keeper. The camera pulls out slowly, returning to the full shot of the lighthouse.',
      '[Shot 1] 写实风格，全景中老守塔人站在灯塔旁。风吹动他的外套。在 00:04.000 镜头切到守塔人的特写。镜头缓慢后拉，回到灯塔的全景。'), {mode:'text_video', durationSeconds:8, currentPrompt:'老守塔人站在灯塔旁，第4秒切到近景'}));
    assert.match(inline.modelPrompt, /his coat\.\n\[Shot 2\] At 00:04\.000, the camera cuts to a medium close-up of the keeper\. The camera pulls out at slow speed, returning to the full shot of the lighthouse\./);
    assert.match(inline.displayPrompt, /外套。\n\[Shot 2\] At 00:04\.000 镜头切到守塔人的近景。镜头缓慢后拉，回到灯塔的全景。/);
    // The same two sizes in another order are already right: the push-in keeps its direction.
    const push = '[Shot 1] Live-action, the camera slowly pushes in to a close-up of a ginger cat on a windowsill, starting from a wide shot. The cat blinks.';
    assert.match(JSON.parse(api.validateBaseResult(pairOf(push, '[Shot 1] 写实风格，镜头从远景缓缓推进到窗台上橘猫的特写。猫眨了眨眼。'), {mode:'text_video', durationSeconds:5, currentPrompt:'一只橘猫坐在窗台上，镜头慢慢推近'})).modelPrompt,
      /pushes in at slow speed to a close-up of a ginger cat on a windowsill, starting from a wide shot\./);
    // Prose whose clauses have their own actors is no tag list, even without articles.
    assert.doesNotThrow(() => api.validateBaseResult(pairOf('[Shot 1] 2D-animated, her crimson cloak ripples, golden leaves swirl around her boots, sparks drift upward from her lantern, embers glow, and her silver hair streams behind her as she strides forward. The camera trucks left at slow speed.',
      '[Shot 1] 二维动画，她的深红斗篷飘动，金色落叶在她靴边旋转，火星从她的灯笼向上飘散，余烬发光，她的银发在身后飘扬，她大步向前。镜头以慢速向左横移。'), {mode:'text_video', durationSeconds:5, currentPrompt:'女孩提着灯笼在风中向前走', strictPair:true}));
  }
});

test('多参: a shot the user never asked to cut to continues the one before; subjects read "<Subject N> is ..."; correct colours cost nothing and one stray English word only the small display fix', () => {
  const six = values => local.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  const source = '图1的角色和图2的角色面对面抱拳行礼，然后并肩走向镜头';
  const options = {durationSeconds:5, currentPrompt:source, requirements:'Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n' + source};
  const english = six(['<Subject 1>: A man with olive skin and dark hair in a metal breastplate, from <Picture 1>\n<Subject 2>: A warrior with blonde hair in a crimson robe, from <Picture 2>', '[reference generation] <Subject 1> and <Subject 2> salute each other, then walk toward the camera side by side.',
    '<Subject 1>: fully_preserved - olive skin, dark hair, metal breastplate\n<Subject 2>: fully_preserved - blonde hair, crimson robe',
    'The target video is in a 3D CG style. [Shot 1] A full shot frames <Subject 1> on the left and <Subject 2> on the right in a stone courtyard under soft daylight; they face each other and clasp their fists in salute. [Shot 2] The camera pulls back as <Subject 1> and <Subject 2> turn and walk toward it side by side.', 'Footsteps echo on the stone courtyard.', 'N/A']);
  const chinese = six(['<Subject 1>: 橄榄色皮肤、黑发、身穿金属胸甲的男子，来自 <Picture 1>\n<Subject 2>: 金发、身穿深红长袍的武士，来自 <Picture 2>', '[reference generation] <Subject 1> 与 <Subject 2> 互相抱拳行礼，然后并肩走向镜头。',
    '<Subject 1>: fully_preserved - 橄榄色皮肤、黑发、金属胸甲\n<Subject 2>: fully_preserved - 金发、深红长袍',
    '目标视频采用三维CG风格。[Shot 1] 全景中 <Subject 1> 在左、<Subject 2> 在右，站在柔和日光下的石砌 courtyard 里，两人相对抱拳行礼。[Shot 2] 镜头后拉，<Subject 1> 与 <Subject 2> 转身并肩朝镜头走来。', '脚步声在石砌庭院中回响。', 'N/A']);
  const answer = JSON.stringify({modelPrompt:english, displayPrompt:chinese});
  for (const api of apis) {
    const pair = JSON.parse(api.validateReferenceResult(answer, options));
    assert.match(pair.modelPrompt, /in salute\. The camera pulls out as <Subject 1>/);
    assert.match(pair.displayPrompt, /抱拳行礼。镜头后拉/);
    assert.doesNotMatch(pair.modelPrompt + pair.displayPrompt, /\[Shot 2\]/);
    assert.match(pair.modelPrompt, /^<Subject 1> is a man with olive skin[^\n]*\n<Subject 2> is a warrior with blonde hair/m);
    // Asked for, the cut stays a cut at an even time.
    const asked = source + '，第3秒切到两人的近景';
    assert.match(JSON.parse(api.validateReferenceResult(answer, {...options, currentPrompt:asked, requirements:'Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n' + asked})).modelPrompt, /\[Shot 2\] At 00:02\.500, the shot cuts\./);
    // A writer's pair (strictPair) this short is below the official length: the repair is asked for and the stray word rides along.
    const strict = {...options, strictPair:true};
    assert.throws(() => api.validateReferenceResult(answer, strict), error => error.issues[0] === 'H3 多参画面与动作过短，请按官方指南写到 350-500 个英文单词' && error.issues.includes('请将多参主体、任务说明、保留规则和画面动作改为简体中文，保留原台词和媒体标签'));
    assert.throws(() => api.validateReferenceResult(answer.replace('Footsteps echo on the stone courtyard.', 'N/A'), strict), error => error.issues.includes('请将多参主体、任务说明、保留规则和画面动作改为简体中文，保留原台词和媒体标签'));
    // At the official length the stray word alone is a display slip: no rewrite, its sentence marked for the one small fix call.
    const scene = ' Faded red banners ripple along the low stone walls of the courtyard while pale dust drifts across the worn grey flagstones in the soft daylight.'.repeat(12);
    const full = answer.replace('turn and walk toward it side by side.', 'turn and walk toward it side by side.' + scene).replace('转身并肩朝镜头走来。', '转身并肩朝镜头走来。褪色的红色旗帜在庭院低矮的石墙上飘动。');
    assert.throws(() => api.validateReferenceResult(full, strict), error => error.h3DisplayOnly === true && JSON.stringify(error.issues) === JSON.stringify(['请将多参主体、任务说明、保留规则和画面动作改为简体中文，保留原台词和媒体标签'])
      && error.h3Slips.length === 1 && error.h3Slips[0].includes('石砌 ⟦courtyard⟧ 里'));
    assert.doesNotThrow(() => api.validateReferenceResult(full.replace('石砌 courtyard 里', '石砌庭院里'), strict));
  }
});

test('承上启下 in a writer\'s pair: a place the action goes to outside a still frame is repaired; a cut is announced once; a frame tag stands apart', () => {
  const pairOf = (model, display) => ({modelPrompt:fields(model, 'A soft thud as its paws land.'), displayPrompt:fields(display, '爪子落地时轻轻一声闷响。')});
  const options = {mode:'image_video', durationSeconds:5, currentPrompt:'猫咪跳上桌子后回头看镜头', strictPair:true};
  const zh = '[Shot 1] 写实电影风格，<Picture 1>中所示的猫坐在灰色背景前。它转向右侧，跳上画面右侧外的木桌，落地后回头看向镜头。镜头固定。';
  for (const api of apis) {
    // A table beyond the edge of a still frame, or below the frame for a jump up, leaves the requested action off-screen.
    for (const model of ['[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray backdrop. A wooden table stands just beyond the right edge. The cat turns right, leaps onto the table and looks back at the camera. The camera holds a static shot.',
      '[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray backdrop. It leaps upward onto a wooden table just beyond the lower edge of the frame as the camera tilts down, then looks back at the camera.'])
      assert.throws(() => api.validateBaseResult(pairOf(model, zh), options), error => error.issues?.includes('H3 动作去往画面外的物体，但镜头或方向与之矛盾，请让镜头随主体移向它'));
    // The camera moving with the subject toward it is coherent; the frame tag reads apart from the Chinese around it (@参考图 中所示).
    const moving = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray backdrop. A wooden table stands just beyond the right edge at shoulder height. The cat turns right and leaps onto it as the camera pans right with it, then looks back over its shoulder at the camera.', zh.replace('镜头固定。', '镜头随之右摇。')), options));
    assert.match(moving.displayPrompt, /，<Picture 1> 中所示的猫/);
    assert.equal(api.validationIssue(new Error('H3 动作去往画面外的物体，但镜头或方向与之矛盾，请让镜头随主体移向它')).reason, 'sections');
    // A cut announced again right before its own marker is one cut, in both halves.
    const cut = JSON.parse(api.validateBaseResult({modelPrompt:fields('[Shot 1] Live-action, cinematic, a full shot frames a keeper by a lighthouse. Wind moves his coat. At the four-second mark the shot cuts to a close-up. [Shot 2] At 00:04.000, the camera cuts to a close-up of the keeper, who squints into the wind.', 'Wind and waves.'),
      displayPrompt:fields('[Shot 1] 写实电影风格，全景中守塔人站在灯塔旁。风吹动他的外套。00:04.000 时镜头切到特写。\n[Shot 2] At 00:04.000 镜头切到守塔人的特写，他眯眼望向风中。', '风声和浪声。')}, {mode:'text_video', durationSeconds:8, currentPrompt:'守塔人站在灯塔旁，第4秒切到特写'}));
    assert.match(cut.modelPrompt, /Wind moves his coat\.\n\[Shot 2\] At 00:04\.000, the camera cuts to a close-up of the keeper/);
    assert.match(cut.displayPrompt, /风吹动他的外套。\n\[Shot 2\] At 00:04\.000 镜头切到守塔人的特写/);
  }
});

test("多参: a writer's narrative in parts is joined into the official prose in both halves; a beat that restates the camera is dropped", () => {
  const source = '图1的角色和图2的角色面对面抱拳行礼，然后并肩走向镜头';
  const options = {durationSeconds:5, currentPrompt:source, requirements:'Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n' + source};
  const six = (zh, narrative) => ({subject_definitions:zh ? '<Subject 1> 是 <Picture 1> 中的金甲武将。\n<Subject 2> 是 <Picture 2> 中的红袍武者。' : '<Subject 1> is the golden-armoured general in <Picture 1>.\n<Subject 2> is the red-robed warrior in <Picture 2>.',
    summary:'[reference generation] ' + (zh ? '<Subject 1> 与 <Subject 2> 抱拳行礼后并肩走向镜头。' : '<Subject 1> and <Subject 2> salute, then walk toward the camera side by side.'),
    retention_analysis:zh ? '<Subject 1>: fully_preserved - 金甲\n<Subject 2>: fully_preserved - 红袍' : '<Subject 1>: fully_preserved - golden armour\n<Subject 2>: fully_preserved - red robe',
    detailed_description:narrative, overall_soundscape:zh ? '脚步声在石板上回响。' : 'Footsteps echo on the flagstones.', non_diegetic_music:'N/A'});
  const english = {style:'The target video is in a 3D CG style with bright daylight', shots:[{opening:'[Shot 1] A full shot frames a stone courtyard.',
    subjects:[{place:'<Subject 1> stands on the left facing right.', head:'His black hair is tied under a golden crown.', outfit:'His golden armour gleams.', hands:'His right hand grips a spear.'}],
    beats:['<Subject 1> plants the spear upright beside him.', 'The camera pushes in.', '<Subject 1> and <Subject 2> salute with the right fist covered by the left palm.'], ending:'They stand side by side.', camera:'The camera pulls out at slow speed as they walk toward it.'}]};
  const chinese = {style:'目标视频采用三维 CG 风格，日光明亮', shots:[{opening:'[Shot 1] 全景展现石砌庭院。', subjects:[{place:'<Subject 1> 站在左侧面朝右。', head:'他的黑发束在金冠下。', outfit:'他的金甲闪亮。', hands:'他右手握着长枪。'}],
    beats:['<Subject 1> 将长枪竖直插在身旁。', '镜头推近。', '<Subject 1> 与 <Subject 2> 右拳左掌抱拳行礼。'], ending:'两人并肩站立。', camera:'镜头缓慢后拉，他们走向镜头。'}]};
  const answer = JSON.stringify({modelPrompt:six(false, english), displayPrompt:six(true, chinese)});
  for (const api of apis) {
    const pair = JSON.parse(api.validateReferenceResult(answer, options));
    assert.match(pair.modelPrompt, /detailed_description:\nThe target video is in a 3D CG style with bright daylight\.\s\[Shot 1\] A full shot frames a stone courtyard\. <Subject 1> stands on the left facing right\. His black hair is tied under a golden crown\. His golden armour gleams\. His right hand grips a spear\. The camera pulls out at slow speed as they walk toward it\. <Subject 1> plants the spear upright beside him\. <Subject 1> and <Subject 2> salute with the right fist covered by the left palm\. They stand side by side\.\n/);
    assert.match(pair.displayPrompt, /detailed_description:\n目标视频采用三维 CG 风格，日光明亮。\s?\[Shot 1\] 全景展现石砌庭院。<Subject 1> 站在左侧面朝右。他的黑发束在金冠下。他的金甲闪亮。他右手握着长枪。镜头缓慢后拉，他们走向镜头。<Subject 1> 将长枪竖直插在身旁。<Subject 1> 与 <Subject 2> 右拳左掌抱拳行礼。两人并肩站立。\n/);
    const withBeats = (narrative, beats) => ({...narrative, shots:[{...narrative.shots[0], beats}]});
    const paired = JSON.parse(api.validateReferenceResult(JSON.stringify({
      modelPrompt:six(false, withBeats(english, [{action:'<Subject 1> plants the spear upright beside him', detail:'Its red tassel sways in the wind'}, {action:'The camera pushes in', detail:'Dust drifts past'}])),
      displayPrompt:six(true, withBeats(chinese, [{action:'<Subject 1> 将长枪竖直插在身旁', detail:'红色枪缨在风中摆动'}, {action:'镜头推近', detail:'尘土飘过'}]))}), options));
    assert.match(paired.modelPrompt, /as they walk toward it\. <Subject 1> plants the spear upright beside him\. Its red tassel sways in the wind\. They stand side by side\.\n/);
    assert.match(paired.displayPrompt, /他们走向镜头。<Subject 1> 将长枪竖直插在身旁。红色枪缨在风中摆动。两人并肩站立。\n/);
    assert.deepEqual(json(api.referenceWriterSchema.properties.modelPrompt.properties.detailed_description.properties.shots.items.properties.beats.items.required), ['action', 'detail']);
    // The writer's schema asks for the parts in both halves; a translation keeps the one prose field.
    assert.equal(api.referenceWriterSchema.properties.modelPrompt.properties.detailed_description.type, 'object');
    assert.deepEqual(json(api.referenceWriterSchema.properties.displayPrompt.properties.detailed_description.properties.shots.items.required), ['opening', 'subjects', 'camera', 'beats', 'ending']);
    assert.equal(api.referenceResultSchema.properties.modelPrompt.properties.detailed_description.type, 'string');
    // A requested cut: the bare marker takes no full stop; the cut announced in the shot before, the later shot's repeated looks and its
    // "same setting" leave both halves (decided on the English), where each subject now stands stays.
    const cutSource = '<Picture 1> 中的角色走向 <Picture 2> 中的角色，第3秒切到两人的近景';
    const cutOptions = {durationSeconds:5, currentPrompt:cutSource, requirements:'Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n' + cutSource};
    const opening = (frame, setting, light) => ({frame, setting, light}), look = (place, head, outfit, hands) => ({place, head, outfit, hands});
    const walkEn = {style:'The target video is in an anime style', shots:[
      {opening:opening('[Shot 1]', 'A garden path runs between flower beds.', 'Morning sun lights the path.'), subjects:[look('<Subject 1> stands on the left facing right.', 'Her short hair frames her face.', 'She wears an orange shirt.', 'Her hands hang at her sides.'),
        look('<Subject 2> stands on the right facing left.', 'Its round head has yellow eyes.', 'Its body is teal metal.', 'Its right hand holds a watering can.')], beats:['<Subject 1> walks toward <Subject 2>.', 'At the three-second mark the shot cuts.'], ending:'<Subject 1> is mid-stride.', camera:'The camera holds a static shot.'},
      {opening:opening('[Shot 2] At 00:03.000, the shot cuts to a medium close-up of both.', 'The same garden path continues behind them.', 'Warm light falls on their faces.'), subjects:[look('<Subject 1> is now on the left, facing <Subject 2>.', 'Her short hair remains visible.', 'She still wears the orange shirt.', 'Her hands hang at her sides.')],
        beats:['<Subject 1> stops and smiles at <Subject 2>.'], ending:'They face each other.', camera:'The camera holds a static shot.'}]};
    const walkZh = {style:'目标视频采用动漫风格', shots:[
      {opening:opening('[Shot 1]', '花坛之间有一条花园小路。', '晨光照亮小路。'), subjects:[look('<Subject 1> 站在左侧面朝右。', '她的短发衬着脸庞。', '她穿着橙色衬衫。', '她双手垂在身侧。'), look('<Subject 2> 站在右侧面朝左。', '它的圆脑袋上有黄色眼睛。', '它的身体是青绿色金属。', '它右手提着浇水壶。')],
        beats:['<Subject 1> 走向 <Subject 2>。', '第3秒镜头切到近景。'], ending:'<Subject 1> 正迈着步子。', camera:'镜头固定。'},
      {opening:opening('[Shot 2] At 00:03.000 镜头切到两人的近景。', '同一条花园小路在他们身后延续。', '暖光照在他们脸上。'), subjects:[look('<Subject 1> 现在在左侧，面向 <Subject 2>。', '她的短发依然可见。', '她仍穿着橙色衬衫。', '她双手垂在身侧。')],
        beats:['<Subject 1> 停下脚步，对 <Subject 2> 微笑。'], ending:'两人面对面。', camera:'镜头固定。'}]};
    const walk = JSON.parse(api.validateReferenceResult(JSON.stringify({modelPrompt:six(false, walkEn), displayPrompt:six(true, walkZh)}), cutOptions));
    assert.match(walk.modelPrompt, /\[Shot 1\] A garden path runs between flower beds\. Morning sun lights the path\. <Subject 1> stands/);
    // A later shot says what its new size shows of the setting and light (official ref guide: each shot establishes them).
    assert.match(walk.modelPrompt, /Its right hand holds a watering can\. The camera holds a static shot\. <Subject 1> walks toward <Subject 2>\. <Subject 1> is mid-stride\.\n\[Shot 2\] At 00:03\.000, the shot cuts to a medium close-up of both\. The same garden path continues behind them\. Warm light falls on their faces\. <Subject 1> is now on the left, facing <Subject 2>\. The camera holds a static shot\. <Subject 1> stops and smiles at <Subject 2>\./);
    assert.doesNotMatch(walk.modelPrompt, /three-second mark|remains visible|still wears/);
    assert.match(walk.displayPrompt, /它右手提着浇水壶。镜头固定。<Subject 1> 走向 <Subject 2>。<Subject 1> 正迈着步子。\n\[Shot 2\] At 00:03\.000 镜头切到两人的近景。同一条花园小路在他们身后延续。暖光照在他们脸上。<Subject 1> 现在在左侧，面向 <Subject 2>。镜头固定。<Subject 1> 停下脚步/);
    assert.doesNotMatch(walk.displayPrompt, /第3秒镜头切到近景|依然可见|仍穿着/);
    // A later shot that copies the shot just before word for word (round 4 mr_cut) keeps only its new framing, in both halves.
    const copyShot = (shots, first) => shots.map((shot, i) => i ? {...shot, opening:{...shot.opening, setting:first.opening.setting, light:first.opening.light}} : shot);
    const copied = JSON.parse(api.validateReferenceResult(JSON.stringify({modelPrompt:six(false, {...walkEn, shots:copyShot(walkEn.shots, walkEn.shots[0])}), displayPrompt:six(true, {...walkZh, shots:copyShot(walkZh.shots, walkZh.shots[0])})}), cutOptions));
    assert.equal(copied.modelPrompt.split('A garden path runs between flower beds.').length, 2);
    assert.equal(copied.displayPrompt.split('花坛之间有一条花园小路。').length, 2);
    assert.match(copied.modelPrompt, /\[Shot 2\] At 00:03\.000, the shot cuts to a medium close-up of both\. <Subject 1> is now on the left/);
    // A return to an earlier scene (garden → close-up of the robot → back to the garden) keeps its setting and light; a close-up of one
    // subject keeps its head, and a shot of both only where each stands.
    const back = (shots, frame, robot, frameZh) => [shots[0], {...shots[1], opening:{...shots[1].opening, frame}, subjects:[robot]}, {...shots[1], opening:{...shots[0].opening, frame:frameZh}}];
    const returned = JSON.parse(api.validateReferenceResult(JSON.stringify({
      modelPrompt:six(false, {...walkEn, shots:back(walkEn.shots, '[Shot 2] At 00:03.000, the shot cuts to a close-up of <Subject 2>.', look('<Subject 2> fills the frame, facing left.', 'Its yellow eyes glow brighter.', 'Its teal body gleams.', 'Its hand still holds the can.'), '[Shot 3] At 00:04.000, the shot cuts back to a full shot of the garden.')}),
      displayPrompt:six(true, {...walkZh, shots:back(walkZh.shots, '[Shot 2] At 00:03.000 镜头切到 <Subject 2> 的特写。', look('<Subject 2> 占满画面，面朝左。', '它的黄色眼睛更亮了。', '它的青绿色身体闪着光。', '它的手仍提着水壶。'), '[Shot 3] At 00:04.000 镜头切回花园的全景。')})}), cutOptions));
    assert.match(returned.modelPrompt, /\[Shot 2\] At 00:03\.000, the shot cuts to a close-up of <Subject 2>\. The same garden path continues behind them\. Warm light falls on their faces\. <Subject 2> fills the frame, facing left\. Its yellow eyes glow brighter\. The camera/);
    assert.match(returned.displayPrompt, /<Subject 2> 占满画面，面朝左。它的黄色眼睛更亮了。镜头固定。/);
    assert.doesNotMatch(returned.modelPrompt + returned.displayPrompt, /teal body gleams|still holds the can|青绿色身体|仍提着/);
    assert.match(returned.modelPrompt, /\[Shot 3\] At 00:04\.000, the shot cuts back to a full shot of the garden\. A garden path runs between flower beds\. Morning sun lights the path\. <Subject 1> is now on the left/);
    assert.match(returned.displayPrompt, /\[Shot 3\] At 00:04\.000 镜头切回花园的全景。花坛之间有一条花园小路。晨光照亮小路。<Subject 1> 现在在左侧/);
    assert.doesNotMatch(returned.modelPrompt, /still wears/);
  }
});

test("承上启下 and plausibility in a writer's pair: a pose no action produced or a hand still holding before a two-handed gesture is repaired; a silent sway, a still camera's size and vague camera words are fixed by the program", () => {
  const i2v = (currentPrompt, strictPair = true) => ({mode:'image_video', durationSeconds:5, currentPrompt, strictPair});
  const pose = 'H3 画面中的姿态没有动作过渡（如落地后直接坐着、爪子未抬起就被舔），请补上这一步动作', held = 'H3 双手动作前手里仍握着物品，请先交代物品放到哪里';
  const pairOf = (model, display, sound = 'A soft thud as its paws land on the wood.', zhSound = '爪子落在木头上轻轻一声闷响。') => ({modelPrompt:fields(model, sound), displayPrompt:fields(display, zhSound)});
  const table = '[Shot 1] 写实电影风格，<Picture 1> 中所示的猫坐在灰色背景前。右侧桌面齐肩高，它转向右侧跳上桌面，镜头随之右摇，回头看向镜头。';
  const paw = '[Shot 1] 写实电影风格，<Picture 1> 中所示的猫坐在灰色背景前。猫低头舔了舔抬起的前爪。镜头固定。';
  for (const api of apis) {
    // Seated after a landing with no sit-down, and a raised paw nothing lifted, ask for the repair; the written action passes.
    const jump = '[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray backdrop. A wooden table stands just beyond the right edge at shoulder height. The cat turns right and leaps onto it as the camera pans right with it, lands on all four paws';
    assert.throws(() => api.validateBaseResult(pairOf(jump + ' and looks back at the camera, seated on the table.', table), i2v('猫咪跳上桌子后回头看镜头')), error => error.issues?.includes(pose));
    assert.doesNotThrow(() => api.validateBaseResult(pairOf(jump + ', settles onto its haunches and looks back at the camera, seated on the table.', table), i2v('猫咪跳上桌子后回头看镜头')));
    assert.throws(() => api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray backdrop. The cat lowers its head and licks its raised front paw. The camera holds a static shot.', paw), i2v('猫低头舔了舔前爪')), error => error.issues?.includes(pose));
    assert.doesNotThrow(() => api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray backdrop. The cat lifts its right front paw to its chest and licks the raised front paw. The camera holds a static shot.', paw), i2v('猫低头舔了舔前爪')));
    // A hand the opening already shows raised (a palm raised forward) was not lifted by nothing: lowering it later is no pose gap.
    const palm = '[Shot 1] 2D-animated, a monk shown in <Picture 1> stands on a plain white backdrop, a staff in his right hand and his left palm raised forward. Bright even light falls on him. The camera pushes in with small amplitude at slow speed as his raised left hand drops to his side.';
    assert.doesNotThrow(() => api.validateBaseResult(pairOf(palm, '[Shot 1] 二维动画，<Picture 1> 中所示的僧人站在白色背景前，右手持杖，左掌向前举起。明亮均匀的光照在他身上。镜头以小幅度缓慢推近，他举起的左手垂到身侧。'), i2v('僧人放下左手')));
    assert.equal(api.validationIssue(new Error(pose)).reason, 'sections');
    // A two-handed gesture while a hand still holds something asks for the repair; putting it away first passes. A spear is never sheathed.
    const fan = '[Shot 1] 写实电影风格，<Picture 1> 中所示的女孩站在公园小路上，右手拿着一把纸扇，微笑着。她拍了两次手，纸扇随之晃动。镜头固定。';
    const girl = '[Shot 1] Live-action, cinematic, the girl shown in <Picture 1> stands on a park path with a paper fan in her right hand, smiling.';
    assert.throws(() => api.validateBaseResult(pairOf(girl + ' She claps her hands twice. The camera holds a static shot.', fan, 'Two crisp claps.', '两声清脆的拍手声。'), i2v('女孩拍手两次')), error => error.issues?.includes(held));
    assert.doesNotThrow(() => api.validateBaseResult(pairOf(girl + ' She tucks the fan under her left arm, then claps her hands twice. The camera holds a static shot.', fan, 'Two crisp claps.', '两声清脆的拍手声。'), i2v('女孩拍手两次')));
    assert.throws(() => api.validateBaseResult(pairOf(girl.replace('a paper fan', 'a spear') + ' She sheathes her spear and claps her hands twice. The camera holds a static shot.', fan, 'Two crisp claps.', '两声清脆的拍手声。'), i2v('女孩拍手两次')), error => error.issues?.includes(held));
    assert.equal(api.validationIssue(new Error(held)).reason, 'sections');
    // A slow tail sway is silent: its sound leaves both halves. A still camera names no size the user did not ask for (both halves).
    const sway = pairOf('[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a sunny windowsill and slowly sways its tail from side to side. The camera holds a static medium shot.',
      '[Shot 1] 写实电影风格，<Picture 1> 中所示的猫坐在洒满阳光的窗台上，缓缓地左右摆动尾巴。镜头保持固定中景。', 'A soft breeze rustles the curtain. The cat\'s tail makes a soft swish with each slow sway.', '微风吹得窗帘沙沙作响。猫尾每次缓慢摆动都发出轻柔的嗖嗖声。');
    const quiet = JSON.parse(api.validateBaseResult(sway, i2v('猫坐在窗台上慢慢摇尾巴', false)));
    assert.match(quiet.modelPrompt, /The camera holds a static shot\.\n\noverall_soundscape: A soft breeze rustles the curtain\.\n\nnon_diegetic_music/);
    assert.match(quiet.displayPrompt, /镜头保持固定。\n\noverall_soundscape: 微风吹得窗帘沙沙作响。\n\nnon_diegetic_music/);
    assert.match(JSON.parse(api.validateBaseResult(sway, i2v('中景镜头，猫坐在窗台上慢慢摇尾巴', false))).displayPrompt, /镜头保持固定中景。/);
    // A requested cut that stayed inside one shot drops the request: the repair writes it as its own shot.
    const cutAsk = {mode:'text_video', durationSeconds:6, currentPrompt:'女孩在窗边读书，第3秒切到近景', strictPair:true};
    assert.throws(() => api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a girl reads by a window, and at the three-second mark the camera cuts to a medium close-up of her face. The camera holds a static shot.', '[Shot 1] 写实电影风格，女孩在窗边读书，第3秒镜头切到她脸部的近景。镜头固定。'), cutAsk), error => error.issues?.includes('H3 用户要求的切镜没有写成单独的镜头，请在要求的时间写出 [Shot N]'));
    assert.equal(api.validationIssue(new Error('H3 用户要求的切镜没有写成单独的镜头，请在要求的时间写出 [Shot N]')).reason, 'sections');
    assert.doesNotThrow(() => api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a girl cuts a birthday cake on a kitchen table and smiles. The camera holds a static shot.', '[Shot 1] 写实电影风格，女孩在厨房餐桌上切生日蛋糕并露出微笑。镜头固定。', 'The knife sinks softly into the cake.', '刀轻轻切入蛋糕。'), {...cutAsk, currentPrompt:'女孩切蛋糕后笑了'}));
    // Official camera speed words; a sound word before its own 声 or 响 keeps one.
    assert.match(api.validateBaseFields(fields('[Shot 1] Live-action, a knight walks forward as the camera pulls back at medium speed. The camera stays locked in position. The camera holds the medium close-up framing, capturing her smile. The camera tracks right slowly.'), {mode:'text_video', durationSeconds:6, language:'en'}),
      /as the camera pulls out\. The camera holds a static shot\. The camera holds a static shot, capturing her smile\. The camera tracks right at slow speed\./);
    const crunch = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> walks across a gravel path. The camera trucks right at slow speed.', '[Shot 1] 写实电影风格，<Picture 1> 中所示的猫走过碎石小路。镜头缓慢右移。', 'Gravel crunches under its paws with a soft thud.', '碎石在爪下发出轻柔的 crunching 声响，落地一声 thud 声，随后是安静的环境室调声。'), i2v('猫走过碎石小路', false)));
    assert.match(JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray backdrop. The camera pushes in to a medium close-up of its face.', '[Shot 1] 写实电影风格，<Picture 1> 中所示的猫坐在灰色背景前。镜头推进到它脸部的中景近景。'), i2v('猫坐着', false))).displayPrompt, /镜头推进到它脸部的近景。/);
    assert.match(crunch.displayPrompt, /碎石在爪下发出轻柔的嘎吱声响，落地一声闷声，随后是安静的室内环境声。/);
  }
});

test('program fixes touch only what they name: an action with a cut word stays, an announced cut moves into its marker, an exit or a voice is no off-frame place, capitals and letters stay, a colour is set back only in its subject\'s lines', () => {
  const pairOf = (model, display, sound = 'Wind.', zhSound = '风声。') => ({modelPrompt:fields(model, sound), displayPrompt:fields(display, zhSound)});
  const six = (api, values) => api.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  for (const api of apis) {
    // A sentence right before a timed marker is dropped only when it is itself a camera cut: cutting bread, a changing sky, 切换频道 stay.
    const kitchen = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a medium shot frames a chef at a counter at dusk. The chef cuts the loaf halfway through. [Shot 2] At 00:03.000, the camera cuts to a close-up of the bread. The sky outside transitions from orange to violet. [Shot 3] At 00:06.000, the camera cuts to a wide shot of the kitchen.',
      '[Shot 1] 写实电影风格，黄昏时中景中一位厨师站在料理台前。厨师把面包切到一半。[Shot 2] At 00:03.000 镜头切到面包的特写。窗外天空从橙色渐变为紫色。[Shot 3] At 00:06.000 镜头切到厨房的远景。'), {mode:'text_video', durationSeconds:8, currentPrompt:'厨师切面包，第3秒切到面包特写，第6秒切到厨房远景'}));
    assert.match(kitchen.modelPrompt, /The chef cuts the loaf halfway through\.\n\[Shot 2\][^\n]*The sky outside transitions from orange to violet\.\n\[Shot 3\]/);
    assert.match(kitchen.displayPrompt, /厨师把面包切到一半。\n\[Shot 2\][^\n]*窗外天空从橙色渐变为紫色。\n\[Shot 3\]/);
    assert.match(api.fromBaseDisplay('【画面与动作】\n【镜头 1】写实电影风格，中景中一位女子坐在沙发上。她拿起遥控器切换频道。\n【镜头 2】At 00:04.000 镜头切到电视屏幕的特写。\n\n【环境声音】\n遥控器按键声。\n\n【背景音乐】\n无'), /她拿起遥控器切换频道。\n\[Shot 2\]/);
    // A camera cut announced before a marker that does not restate it moves into the marker with its size and subject.
    const face = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a woman reading on a park bench. She lifts her head as a dog barks. The camera cuts to a close-up of her face. [Shot 2] At 00:04.000, her eyes widen and she smiles.',
      '[Shot 1] 写实电影风格，全景中一位女子坐在公园长椅上看书。狗叫声响起，她抬起头。镜头切到她脸部的特写。[Shot 2] At 00:04.000 她睁大眼睛，露出微笑。'), {mode:'text_video', durationSeconds:8, currentPrompt:'女子看书，听到狗叫抬头，第4秒切到她脸部特写'}));
    assert.match(face.modelPrompt, /a dog barks\.\n\[Shot 2\] At 00:04\.000, the camera cuts to a close-up of her face\. Her eyes widen and she smiles\./);
    assert.match(face.displayPrompt, /她抬起头。\n\[Shot 2\] At 00:04\.000 镜头切到她脸部的特写。她睁大眼睛，露出微笑。/);
    // An exit, an off-screen voice, the edge of a thing and a pull-out that widens toward it name no place outside a still frame: no repair.
    for (const [model, prompt] of [['The cat stands up, stretches and walks out of the frame to the right. The camera holds a static shot.', '猫起身走出画面'],
      ['A woman with a calm, low voice (S1) says in an off-screen voiceover: <d>[Chinese] 我回来了。</d> The camera holds a static shot.', '女声画外音说“我回来了。”'],
      ['A cat paws the cup and it slides off the edge of the table. The boy sits with his legs dangling off the edge of the pier. The camera holds a static shot.', '猫把杯子推下桌，男孩坐在码头边晃脚'],
      ['A bowl rests just beyond the right edge. The cat walks toward it as the camera pulls out at slow speed.', '猫走向碗，镜头缓慢后拉']])
      assert.doesNotThrow(() => api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a quiet room. ' + model, '[Shot 1] 写实电影风格，全景中一个安静的房间。' + (/voiceover/.test(model) ? '嗓音平静低沉的女子 (S1) 以画外音说：<d>[Chinese] 我回来了。</d> 镜头固定。' : '猫起身向右走出画面。镜头固定。')),
        {mode:'text_video', durationSeconds:6, currentPrompt:prompt, strictPair:true}), model);
    // Letters, names and capitals stay (A 字裙, Golden Gate Bridge, RED); a cut time takes no 时; a boundary before an appended camera stays a sentence end.
    const letters = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a girl in an A-line skirt walking between point A and point B below the Golden Gate Bridge while a RED camera films. [Shot 2] At 00:03.000, the shot cuts to a close-up of her face. The camera holds a static shot.',
      '[Shot 1] 写实电影风格，全景中穿着 A 字裙的女孩在 Golden Gate Bridge 下的 A 点和 B 点之间来回走，一台 RED 摄影机在拍摄。[Shot 2] At 00:03.000 时镜头切到她脸部的特写。镜头固定。'), {mode:'text_video', durationSeconds:6, currentPrompt:'穿着 A 字裙的女孩在金门大桥下来回走，第3秒切到特写', strictPair:true})).displayPrompt;
    assert.match(letters, /穿着 A 字裙的女孩在 Golden Gate Bridge 下的 A 点和 B 点之间来回走，一台 RED 摄影机在拍摄。\n\[Shot 2\] At 00:03\.000 镜头切到她脸部的特写。/);
    // "of both" reads 两者的近景, which fits people, animals and things (two cats are not 两人): no English is left and no fix call is spent,
    // whether the pair is strict or not; a rarer phrase (of the pair) still goes to the fix call with its short words marked.
    const both = (display, strictPair) => api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a girl by a window. [Shot 2] At 00:03.000, the shot cuts to a medium close-up of both of them. The camera holds a static shot.',
      '[Shot 1] 写实电影风格，全景中女孩站在窗边。[Shot 2] At 00:03.000, the shot cuts to a medium close-up ' + display + '。镜头固定。'), {mode:'text_video', durationSeconds:6, currentPrompt:'女孩站在窗边，第3秒切到近景', strictPair});
    for (const [display, strictPair] of [['of both', true], ['of both', false], ['of both of them', false], ['of them', true]])
      assert.match(JSON.parse(both(display, strictPair)).displayPrompt, /\n\[Shot 2\] At 00:03\.000 镜头切到两者的近景。镜头固定。\n/, display);
    assert.throws(() => both('of the pair', true), error => error.h3DisplayOnly === true && JSON.stringify(error.h3Slips) === JSON.stringify(['[Shot 2] At 00:03.000 镜头切到近景 ⟦of⟧ ⟦the⟧ ⟦pair⟧。']));
    assert.doesNotMatch(JSON.parse(both('of both', false)).displayPrompt.replace(/\[Shot \d+\]|At \d{2}:\d{2}\.\d{3}|N\/A|[a-z_]+:/g, ''), /[A-Za-z]/);
    // A shot whose halves name a different number of sizes (切到近景 … 恢复全景构图 against "a close-up … full framing") still cuts to the user's size.
    const cutSize = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a man on a bridge. The camera holds a static shot. [Shot 2] At 00:04.000, the camera cuts to a close-up of his face, then pulls out to restore the original full framing.',
      '[Shot 1] 写实电影风格，全景中一个男人站在桥上。镜头固定。[Shot 2] At 00:04.000 镜头切到近景，随后镜头拉远，恢复最初的全景构图。'), {mode:'text_video', durationSeconds:8, currentPrompt:'男人站在桥上，第4秒切到近景'})).modelPrompt;
    assert.match(cutSize, /\[Shot 2\] At 00:04\.000, the camera cuts to a medium close-up of his face, then pulls out/);
    // Two replaced words join: a frame written in English reads 镜头切到近景, not 镜头切到 近景.
    assert.match(JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a girl by a window. [Shot 2] At 00:03.000, the shot cuts to a medium close-up of her face. The camera holds a static shot.',
      '[Shot 1] 写实电影风格，全景中女孩站在窗边。[Shot 2] At 00:03.000, the shot cuts to a medium close-up 她的脸。镜头固定。'), {mode:'text_video', durationSeconds:6, currentPrompt:'女孩站在窗边，第3秒切到近景'})).displayPrompt, /\[Shot 2\] At 00:03\.000 镜头切到近景她的脸。/);
    // Calques of the official English read as Chinese: at slow speed is 缓慢, "The shot ends with …" is 最后画面停在 ….
    assert.match(JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a cat on the floor. The cat jumps onto the sofa as the camera trucks right at slow speed. The shot ends with the cat seated on the sofa looking at the viewer.',
      '[Shot 1] 写实电影风格，全景中一只猫在地板上。猫跳上沙发，镜头以缓慢速度向右横移。镜头最后以猫咪坐在沙发上看向观众结束。'), {mode:'text_video', durationSeconds:5, currentPrompt:'猫跳上沙发'})).displayPrompt, /猫跳上沙发，镜头缓慢向右横移。最后画面停在猫咪坐在沙发上看向观众。/);
    // The writer fills a field with its example, never a placeholder: a cut frame shows a real size (a literal "cuts to ..." came back live).
    assert.match(api.referenceWriterSchema.properties.displayPrompt.properties.detailed_description.properties.shots.items.properties.opening.properties.frame.description, /At 00:03\.000 镜头切到两人的近景/);
    for (const half of ['modelPrompt', 'displayPrompt']) assert.doesNotMatch(api.referenceWriterSchema.properties[half].properties.detailed_description.properties.shots.items.properties.opening.properties.frame.description, /\.\.\.|…/);
    const source = '<Picture 1> 中的老人对 <Picture 2> 中的机器人说：“我明白了。”然后并肩走向镜头';
    const options = {durationSeconds:5, currentPrompt:source, requirements:'Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n' + source};
    const english = six(api, ['<Subject 1> is the old man in <Picture 1>, with silver hair and a blue scarf.\n<Subject 2> is the small teal robot in <Picture 2>.', '[reference generation] <Subject 1> speaks to <Subject 2>, then they walk toward the camera side by side.', '<Subject 1>: fully_preserved - silver hair, blue scarf\n<Subject 2>: fully_preserved - teal body',
      'The target video is in a live-action style with soft window light. [Shot 1] <Subject 1> and <Subject 2> stand by a window as surf breaks on the rocks outside. <Subject 1> with a low, slow voice (S1) says: <d>[Chinese] 我明白了。</d> He holds up a card that reads "白鹭". They walk toward the camera side by side', 'A clock ticks softly.', 'N/A']);
    const chinese = six(api, ['<Subject 1> 是 <Picture 1> 中的老人，一头白发，围着蓝色围巾。\n<Subject 2> 是 <Picture 2> 中的青铜色小机器人。', '[reference generation] <Subject 1> 对 <Subject 2> 说话，然后两人并肩走向镜头。', '<Subject 1>: fully_preserved - 白发、蓝色围巾\n<Subject 2>: fully_preserved - 青铜色机身',
      '目标视频采用写实风格，窗光柔和。[Shot 1] <Subject 1> 和 <Subject 2> 站在窗边，窗外浪花拍打岩石。嗓音低沉缓慢的 <Subject 1> (S1) 说：<d>[Chinese] 我明白了。</d> 他举起一张写着"白鹭"的卡片。两人并肩走向镜头', '时钟轻轻滴答。', 'N/A']);
    const pair = JSON.parse(api.validateReferenceResult(JSON.stringify({modelPrompt:english, displayPrompt:chinese}), options));
    assert.match(pair.displayPrompt, /<Subject 1> 是 <Picture 1> 中的老人，一头白发，围着蓝色围巾。\n<Subject 2> 是 <Picture 2> 中的青绿色小机器人。/);
    assert.match(pair.displayPrompt, /<Subject 2>[^\n]*: fully_preserved - 青绿色机身/);
    assert.match(pair.displayPrompt, /窗外浪花拍打岩石。[^\n]*<d>\[Chinese\] 我明白了。<\/d> 他举起一张写着"白鹭"的卡片。两人并肩走向镜头。镜头固定，构图保持稳定。/);
  }
});

test('a cut is a pure cut to a shot and the user\'s words stay; an off-frame place counts where a subject goes to it; calques and colours are fixed only where they are', () => {
  const pairOf = (model, display, sound = 'Wind.', zhSound = '风声。') => ({modelPrompt:fields(model, sound), displayPrompt:fields(display, zhSound)});
  const six = (api, values) => api.referenceFields.map((field, i) => field + ':\n' + values[i]).join('\n\n');
  const t2v = {mode:'text_video', durationSeconds:8};
  for (const api of apis) {
    // A content change written as a switch (slow motion, day to night) is no announced cut: it stays in both halves and in the user's own text.
    const run = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a runner on a track. The camera switches to slow motion as she crosses the line. [Shot 2] At 00:05.000, the camera cuts to a close-up of her face.',
      '[Shot 1] 写实电影风格，全景中一位跑道上的跑者。镜头切换为慢动作，她冲过终点线。[Shot 2] At 00:05.000 镜头切到她脸部的特写。'), {...t2v, currentPrompt:'跑者冲线时变成慢动作，第5秒切到她脸部特写'}));
    assert.match(run.modelPrompt, /The camera switches to slow motion as she crosses the line\.\n\[Shot 2\]/);
    assert.match(run.displayPrompt, /镜头切换为慢动作，她冲过终点线。\n\[Shot 2\]/);
    assert.match(api.fromBaseDisplay('【画面与动作】\n【镜头 1】写实电影风格，远景中午后的城市天际线。画面切换为夜晚，灯光次第亮起。\n【镜头 2】At 00:05.000 镜头切到一扇亮灯窗户的特写。\n\n【环境声音】\n风声。\n\n【背景音乐】\n无'), /画面切换为夜晚，灯光次第亮起。\n\[Shot 2\]/);
    // The user's own words are never dropped, even a cut the marker restates.
    assert.match(api.fromBaseDisplay('【画面与动作】\n【镜头 1】写实电影风格，全景中一位女子坐在长椅上。镜头切到她的脸。\n【镜头 2】At 00:04.000 时镜头切到她脸部的特写，她笑了。\n\n【环境声音】\n风声。\n\n【背景音乐】\n无'), /镜头切到她的脸。\n\[Shot 2\] At 00:04\.000 时镜头切到她脸部的特写，她笑了。/);
    // A writer's cut restated after "At … 时" or by a shot size is one cut; a camera sentence's closing cut goes too; an English cut to quoted Chinese stays English.
    const once = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a girl by a window. She lifts her head. [Shot 2] At 00:03.000, the camera cuts to a medium close-up of her face. She smiles.',
      '[Shot 1] 写实电影风格，全景中女孩站在窗边。她抬起头。镜头切到她脸部的近景。[Shot 2] At 00:03.000 时镜头切到她脸部的近景，她微笑。'), {...t2v, currentPrompt:'女孩站在窗边，第3秒切到近景'}));
    assert.match(once.displayPrompt, /她抬起头。\n\[Shot 2\] At 00:03\.000 镜头切到她脸部的近景，她微笑。/);
    const sized = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a woman in a park. She waves. The camera cuts to a close-up of her face. [Shot 2] At 00:05.000, a wide shot of the whole park as she walks away.',
      '[Shot 1] 写实电影风格，全景中一位女子在公园里。她挥手。镜头切到她脸部的特写。[Shot 2] At 00:05.000 远景中是整个公园，她走远。'), {...t2v, currentPrompt:'女子在公园挥手，第5秒切到远景'}));
    assert.match(sized.modelPrompt, /She waves\.\n\[Shot 2\] At 00:05\.000, the shot cuts to a wide shot of the whole park/);
    assert.match(sized.displayPrompt, /她挥手。\n\[Shot 2\] At 00:05\.000 远景中是整个公园/);
    const closing = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a wide shot frames a path. The camera holds a static wide shot as she walks forward, then cuts to a medium close-up at three seconds. [Shot 2] At 00:03.000, the shot cuts to a medium close-up of her face.',
      '[Shot 1] 写实电影风格，远景中一条小路。镜头保持静态远景拍摄她前行，第三秒切至近景。[Shot 2] At 00:03.000 镜头切至她脸部的近景。'), {...t2v, currentPrompt:'她沿小路走，第3秒切到近景'}));
    assert.match(closing.modelPrompt, /as she walks forward\.\n\[Shot 2\]/);
    assert.match(closing.displayPrompt, /镜头保持静态远景拍摄她前行。\n\[Shot 2\]/);
    assert.match(JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a woman on a street at dusk. The camera cuts to the shop sign reading "面包店". [Shot 2] At 00:04.000, she walks into the bakery.',
      '[Shot 1] 写实电影风格，黄昏时全景中一位女子站在街上。镜头切到写着"面包店"的招牌。[Shot 2] At 00:04.000 她走进面包店。'), {...t2v, currentPrompt:'女子在街上，第4秒切到面包店招牌'})).modelPrompt, /\[Shot 2\] At 00:04\.000, the camera cuts to the shop sign reading "面包店"\. She walks into the bakery\./);
    // A cut to nothing (a copied placeholder) asks for the repair.
    assert.throws(() => api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a girl by a window. [Shot 2] At 00:03.000, the shot cuts to ... She smiles. The camera holds a static shot.',
      '[Shot 1] 写实电影风格，全景中女孩站在窗边。[Shot 2] At 00:03.000 镜头切到 ...她微笑。镜头固定。'), {mode:'text_video', durationSeconds:6, currentPrompt:'女孩站在窗边，第3秒切到近景', strictPair:true}),
    error => error.issues?.includes('H3 切镜没有写出切到的画面，请写明切到的景别和主体'));
    assert.equal(api.validationIssue(new Error('H3 切镜没有写出切到的画面，请写明切到的景别和主体')).reason, 'sections');
    // Off-frame: a push-in, zoom-in or dolly-in never shows a place beyond the edge; off-screen, out of frame and the top edge are places; a glance or a waiting friend is none.
    const offFrame = model => { try { api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a quiet room. ' + model, '[Shot 1] 写实电影风格，全景中一个安静的房间。猫跳上桌子。镜头固定。'), {mode:'text_video', durationSeconds:6, currentPrompt:'猫跳上桌子', strictPair:true}); return false; } catch (error) { return Boolean(error.issues?.includes('H3 动作去往画面外的物体，但镜头或方向与之矛盾，请让镜头随主体移向它')); } };
    for (const model of ['A wooden table stands just beyond the right edge of the frame at chest height. The cat crouches and leaps up onto the table as the camera pushes in at slow speed.',
      'A wooden table stands just beyond the right edge of the frame at chest height. The cat leaps up onto the table as the camera slowly zooms in on its face.',
      'A wooden table stands off-screen to the right at chest height. The cat crouches and leaps up onto the table. The camera holds a static shot.',
      'The cat crouches and leaps up onto a wooden table out of frame to the right. The camera holds a static shot.',
      'A shelf hangs just beyond the top edge of the frame. The cat crouches and leaps up onto the shelf. The camera holds a static shot.',
      'The cat walks to the bowl, which is just outside the frame on the left. The camera holds a static shot.']) assert.equal(offFrame(model), true, model);
    for (const model of ['She glances toward the door just outside the frame when the bell rings, then keeps reading. The camera holds a static shot.',
      'Her friend, waiting just outside the frame, calls her name and she turns toward the voice. The camera holds a static shot.']) assert.equal(offFrame(model), false, model);
    // Calques read as Chinese only after a camera and in one clause: 所以 / 可以 and a clause that ends with 直到…结束 stay.
    const words = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, a full shot frames a girl in a hallway. She hears a knock, so she quickly turns toward the door; the camera can quickly push in, then trucks right at slow speed from a low angle until the music ends.',
      '[Shot 1] 写实电影风格，全景中女孩站在走廊里。她听到敲门声，所以快速转向门口，镜头可以快速推近，随后以慢速向右横移。镜头以低角度固定拍摄，直到音乐结束。'), {...t2v, currentPrompt:'女孩听到敲门声转身'})).displayPrompt;
    assert.match(words, /所以快速转向门口，镜头可以快速推近，随后缓慢向右横移。镜头以低角度固定拍摄，直到音乐结束。/);
    // A resting paw reads 放 (a frequent live slip); "follow the jump" is a camera noun, not a jump after the cat sat down.
    const cat = JSON.parse(api.validateBaseResult(pairOf('[Shot 1] Live-action, cinematic, the cat shown in <Picture 1> sits on a gray floor, front paws resting on the floor. The cat springs upward onto a low stool beside it, settles onto its haunches and looks at the camera as the camera trucks right at slow speed to follow the jump. The shot ends with the cat seated on the stool.',
      '[Shot 1] 写实电影风格，<Picture 1> 中所示的猫坐在灰色地板上，前爪 resting 在地板上。猫向上跃上身旁的矮凳，蹲坐下来看向镜头，镜头缓慢向右横移跟随跳跃。最后画面停在猫坐在凳子上。'), {mode:'image_video', durationSeconds:5, currentPrompt:'猫跳上凳子后看向镜头', strictPair:true}));
    assert.match(cat.displayPrompt, /前爪放在地板上/);
    // Colours: a blonde girl's 黄色连衣裙 is a swap (the hair word excuses only itself); the swapped colour is set back in her sentences of the narrative as well.
    const source = '<Picture 1> 中的女孩向 <Picture 2> 中的机器人挥手';
    const options = {durationSeconds:5, currentPrompt:source, requirements:'Available resource labels: <Picture 1>; <Picture 2>\nSource prompt:\n' + source};
    const pair = JSON.parse(api.validateReferenceResult(JSON.stringify({modelPrompt:six(api, ['<Subject 1> is the blonde girl in <Picture 1>, wearing a green dress.\n<Subject 2> is the small teal robot in <Picture 2>.', '[reference generation] <Subject 1> waves to <Subject 2>.', '<Subject 1>: fully_preserved - blonde hair, green dress\n<Subject 2>: fully_preserved - teal body',
      'The target video is in a live-action style with soft window light. [Shot 1] <Subject 1> in her green dress waves to <Subject 2> by the window. Its teal body reflects the light. The camera holds a static shot.', 'A clock ticks softly.', 'N/A']),
    displayPrompt:six(api, ['<Subject 1> 是 <Picture 1> 中的金发女孩，穿着黄色连衣裙。\n<Subject 2> 是 <Picture 2> 中的青铜色小机器人。', '[reference generation] <Subject 1> 向 <Subject 2> 挥手。', '<Subject 1>: fully_preserved - 金发、黄色连衣裙\n<Subject 2>: fully_preserved - 青铜色机身',
      '目标视频采用写实风格，窗光柔和。[Shot 1] 穿黄色连衣裙的 <Subject 1> 在窗边向 <Subject 2> 挥手。它青铜色的机身反射着光。镜头固定。', '时钟轻轻滴答。', 'N/A'])}), options)).displayPrompt;
    assert.match(pair, /<Subject 1> 是 <Picture 1> 中的金发女孩，穿着绿色连衣裙。\n<Subject 2> 是 <Picture 2> 中的青绿色小机器人。/);
    assert.match(pair, /<Subject 1>[^\n]*: fully_preserved - 金发、绿色连衣裙/);
    assert.match(pair, /穿绿色连衣裙的 <Subject 1> 在窗边向 <Subject 2> 挥手。它青绿色的机身反射着光。/);
  }
});

const C = require('./_common');

module.exports = {
  id: 'generate-mode',
  name: '文生图 / 图生图',
  desc: '绘图区的出图入口：从文字生成，或以当前画面为底整张重画',
  outro: '写提示词 → AI 助手扩写 → 开始生成',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「模式」分组');
    await t.say('「模式」里是账号和模型方式：本地模型 / GPT / Google。', '本机测试验证就绪时，本地模型直接可用');
    await t.wait(1800);
    await C.openGroup(t, '模式');
    await t.wait(1600);

    await t.step('④ 选「文生图」');
    await t.say('文生图从零生成；图生图以参考图为底重画，需要先往下面的槽位传参考图。', '注意：切换模式会清空当前提示词，切之前先存一下');
    await t.wait(2400);
    await t.clickText('文生图', { within: { x0: 400, x1: 1100, y0: 40, y1: 120 }, settle: 900 });
    await t.wait(800);

    await t.step('⑤ 写提示词');
    await t.say('画风要用文字写出来。', '模型不会从参考图里"看出"画风 —— 这是最常见的误解');
    await t.wait(1800);
    await C.fillPrompt(t, '水彩插画风格，一位穿米色风衣和长裤的旅人背对镜头站在乡间小路上，远处是金色麦田和白色栅栏，夏日黄昏', {
      selector: 'textarea',
      perCharMs: 40
    });
    await t.wait(900);

    await t.step('⑥ 用「AI 助手」扩写');
    await t.say('右下角「AI 助手」里有两件事：优化提示词、图片反推。', '优化 = 把一句话补成结构化描述；反推 = 从图片倒推提示词');
    await t.wait(2000);
    const helper = await t.rectOfText('AI 助手', { contains: true, tags: 'button' });
    if (!helper) throw new Error('AI 助手 button not found');
    await t.clickRect(helper, { settle: 1400 });
    await t.wait(1200);

    await t.say('点「优化并写入提示词」，本地模型扩写完直接回填。');
    await t.wait(1100);
    const apply = await t.rectOfText('优化并写入提示词', { tags: 'button' });
    if (apply) {
      await t.clickRect(apply, { settle: 1000 });
      await C.waitForRun(t, { say: '本地模型正在扩写提示词…', sub: '真实调用，视频里已加速', timeout: 600000 });
    }
    await t.wait(1200);
    await t.key('Escape', { settle: 900 });
    await t.wait(700);

    await t.step('⑦ 开始生成');
    await t.say('底部可以改分辨率、质量和随机种子，NSFW 默认关闭。', '都确认好了，点「开始生成」');
    await t.wait(2000);
    const go = await t.rectOfText('开始生成', { within: { x0: 900, x1: 1250 }, tags: 'button' });
    if (!go) throw new Error('开始生成 button not found');
    await t.clickRect(go, { settle: 900 });

    await C.waitForRun(t, {
      say: '正在出图…',
      sub: '真实生成过程，视频里已加速',
      timeout: 900000
    });

    await t.step('⑧ 历史记录');
    await t.say('出过的图都在下面的「历史记录」里，随时回看和复用提示词。');
    await t.wait(3200);
  }
};

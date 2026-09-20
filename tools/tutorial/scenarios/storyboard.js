const C = require('./_common');

const DIALOG = '一键分镜';

module.exports = {
  id: 'storyboard',
  name: '一键分镜',
  desc: '拿当前画面加一段剧情，生成 3×3 分镜',
  outro: '选尺寸 → 写剧情 → 开始生成',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「增强」分组');
    await t.say('一键分镜在「增强」分组里。', '它基于画板上的当前画面出 3×3 分镜');
    await t.wait(700);
    await C.openGroup(t, '增强');
    await t.wait(600);

    await C.loadDemo(t, {
      step: '③ 先让画板上有一张图',
      say: '画板空着不能用，会提示「请先在预览区准备一张图片」。'
    });

    await t.step('④ 打开「一键分镜」');
    await t.say('点开后选生成尺寸。', '「快速测试 16:9」最快，先用它验证剧情走向');
    await t.wait(1000);
    await C.clickAction(t, 'storyboard', { settle: 1200 });
    await C.waitDialog(t, DIALOG);
    await t.wait(1100);

    const quick = await t.rectOfText('快速测试', { contains: true, within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (quick) await t.clickRect(quick, { settle: 900 });
    await t.wait(800);

    await t.step('⑤ 写剧情描述');
    await t.say('一句话说清这段戏要发生什么。', '「AI 导演」开关打开会先让模型排一版分镜计划');
    await t.wait(1100);
    await C.fillPrompt(t, '少女带着机器人沿着乡间小路出发，途中遇到暴雨，最后在旧谷仓里避雨', {
      selector: C.dialogSel(DIALOG) + ' textarea',
      perCharMs: 45
    });
    await t.wait(900);

    await t.step('⑥ 开始生成');
    await t.say('点「开始生成」。');
    await t.wait(700);
    const go = await t.rectOfText('开始生成', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (!go) throw new Error('一键分镜 dialog has no 开始生成 button');
    await t.clickRect(go, { settle: 900 });

    await C.waitForRun(t, {
      say: '正在按剧情生成 9 个分镜…',
      sub: '真实生成过程，视频里已加速',
      timeout: 1800000
    });

    await t.step('⑦ 看结果');
    await t.say('九格分镜出来了，可以据此再细化单格。');
    await t.wait(3200);
  }
};

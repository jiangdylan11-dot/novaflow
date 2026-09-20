const C = require('./_common');

module.exports = {
  id: 'upscale',
  name: '高清放大',
  desc: '单图放大补细节，不用涂遮罩、不用写提示词',
  outro: '拖图 → 点高清放大 → 等结果',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「增强」分组');
    await t.say('高清放大在「增强」分组里。', '走的是 SeedVR2 3B FP8，单图放大');
    await t.wait(700);
    await C.openGroup(t, '增强');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 点「高清放大」');
    await t.say('这个工具不需要涂遮罩，也不用写提示词。', '它处理的是"当前原图"整张，不是某个图层');
    await t.wait(1100);
    await C.clickAction(t, 'imageUpscale', { settle: 1100 });
    await t.waitFor('!!(function(){return [...document.querySelectorAll("button")].find(function(b){return b.textContent.trim()==="开始放大"})})()', { timeout: 15000 });
    await t.wait(1000);

    await t.step('⑤ 选倍数');
    await t.say('面板里选 2x 或 4x，下面直接显示预计输出尺寸。', '4x 对显存和时间的要求都高得多');
    await t.wait(1100);
    const two = await t.rectOfText('2x', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (two) await t.clickRect(two, { settle: 800 });
    await t.wait(900);

    await t.step('⑥ 开始放大');
    await t.say('点「开始放大」。');
    await t.wait(700);
    const go = await t.rectOfText('开始放大', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (!go) throw new Error('高清放大 dialog has no 开始放大 button');
    await t.clickRect(go, { settle: 900 });

    await C.waitForRun(t, {
      say: '正在放大并补细节…',
      sub: '真实生成过程，视频里已加速',
      timeout: 900000
    });

    await t.step('⑦ 看结果');
    await t.say('分辨率上去了，细节也补上了。', '它吃显存也吃时间，放大前先把别的重活跑完');
    await t.wait(3200);
  }
};

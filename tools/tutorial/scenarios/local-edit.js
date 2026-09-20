const C = require('./_common');

module.exports = {
  id: 'local-edit',
  name: '局部编辑',
  desc: '涂哪改哪：只重绘你刷中的区域，画面其余部分一个像素都不动',
  outro: '涂遮罩 → 写要求 → 执行编辑',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「编辑」分组');
    await t.say('「编辑」分组里是七个改图工具。', '局部编辑是其中最常用的一个');
    await t.wait(700);
    await C.openGroup(t, '编辑');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 点「局部编辑」进入涂抹模式');
    await t.say('点一下「局部编辑」，顶部会出现画笔工具条。', '注意：此时按钮变成「执行编辑」');
    await t.wait(800);
    await C.clickAction(t, 'inpaintEdit', { settle: 1100 });
    await C.waitLabel(t, 'inpaintEdit', '执行编辑');
    await t.wait(900);

    await t.step('⑤ 写清楚要改成什么');
    await t.say('在「编辑要求」里描述目标效果。', '这一栏必填 —— 空着执行不会有任何变化');
    await t.wait(700);
    await C.fillPrompt(t, '把橙色上衣换成白色针织毛衣，保持人物和背景不变', {
      placeholder: '必填'
    });
    await t.wait(800);

    await t.step('⑥ 在画板上刷出要改的区域');
    await t.say('按住左键涂抹，红色就是待重绘区域。', '刷大一点没关系，宁可多盖一圈也别漏边');
    await t.wait(900);

    const map = await C.canvasMapper(t);
    const rows = [
      [[0.41, 0.32], [0.57, 0.32]],
      [[0.38, 0.37], [0.60, 0.37]],
      [[0.38, 0.43], [0.60, 0.43]],
      [[0.40, 0.49], [0.57, 0.49]],
      [[0.42, 0.55], [0.56, 0.55]]
    ];
    for (const row of rows) {
      await t.drag(C.stroke(map, row), { stepMs: 26, approachMs: 340, settle: 220 });
    }
    await t.wait(900);

    await t.step('⑦ 再点一次按钮执行');
    await t.say('遮罩画完，点「执行编辑」。', '同一个按钮，第一次进入模式、第二次才执行');
    await t.wait(800);
    await C.clickAction(t, 'inpaintEdit', { settle: 900 });

    await C.waitForRun(t, {
      say: '本地模型正在只重绘遮罩里的部分…',
      sub: '真实生成过程，视频里已加速',
      timeout: 300000
    });

    await t.step('⑧ 对比结果');
    await t.say('上衣换成了白色毛衣，背包、路面、天空原封不动。', '这就是局部编辑和整图重绘的区别');
    await t.wait(2600);

    const orig = await t.rectOfText('原图', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
    if (orig) {
      await t.say('点顶部「原图」可以随时切回来对比。');
      await t.clickRect(orig, { settle: 1500 });
      await t.wait(1400);
      const layer = await t.rectOfText('图层', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
      if (layer) await t.clickRect(layer, { settle: 1200 });
      await t.wait(1200);
    }
  }
};

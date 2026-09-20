const C = require('./_common');

module.exports = {
  id: 'pen-cutout',
  name: '钢笔抠图',
  desc: '手动钢笔路径，边界完全由你定 —— 路径必须闭合',
  outro: '点锚点 → 闭合 → 执行抠图',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「拆图」分组');
    await t.say('钢笔抠图和智能抠图的取舍：', '智能抠图快，边缘交给模型；钢笔抠图慢，但边界你说了算');
    await t.wait(900);
    await C.openGroup(t, '拆图');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 点「钢笔抠图」');
    await t.say('点一下进入钢笔模式，按钮变成「执行抠图」。', '右键可以拖画布，滚轮缩放，贴边时很有用');
    await t.wait(1000);
    await C.clickAction(t, 'penCutout', { settle: 1100 });
    await C.waitLabel(t, 'penCutout', '执行抠图');
    await t.wait(800);

    await t.step('⑤ 沿边缘点锚点');
    await t.say('沿着对象边缘依次点击放锚点。', '最后点回第一个锚点把路径闭合');
    await t.wait(1000);

    const map = await C.canvasMapper(t);
    const outline = [
      [0.74, 0.57], [0.82, 0.60], [0.86, 0.70], [0.87, 0.82],
      [0.85, 0.95], [0.74, 0.97], [0.64, 0.96], [0.61, 0.84],
      [0.62, 0.70], [0.67, 0.60]
    ];
    for (const [u, v] of outline) {
      const p = map.at(u, v);
      await t.click(p.x, p.y, { moveMs: 320, settle: 220 });
    }
    await t.wait(500);

    await t.step('⑥ 闭合路径');
    await t.say('点回起点，路径闭合。', '没闭合就执行会报「请先绘制闭合钢笔路径」');
    await t.wait(800);
    const first = map.at(outline[0][0], outline[0][1]);
    await t.click(first.x, first.y, { moveMs: 520, settle: 900 });
    await t.wait(900);

    await t.step('⑦ 执行抠图');
    await t.say('再点一次按钮执行。');
    await t.wait(700);
    await C.clickAction(t, 'penCutout', { settle: 900 });

    await C.waitForRun(t, {
      say: '正在按你画的路径分割图层…',
      sub: '真实处理过程，视频里已加速',
      timeout: 300000
    });

    await t.step('⑧ 看结果');
    await t.say('沿路径切出的独立图层，边界完全按你画的走。');
    await t.wait(2600);

    const layer = await t.rectOfText('图层', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
    if (layer) {
      await t.clickRect(layer, { settle: 1400 });
      await t.wait(2400);
    }
  }
};

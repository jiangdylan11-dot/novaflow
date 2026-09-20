const C = require('./_common');

module.exports = {
  id: 'pen-fill',
  name: '智能补全',
  desc: '用钢笔圈出缺口，按这个图层自己已有的内容补上',
  outro: '选图层 → 闭合路径 → 执行补全',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「编辑」分组');
    await t.say('智能补全和智能补图的区别：', '补图看整张画面，补全只看当前这一层已有的内容');
    await t.wait(1200);
    await C.openGroup(t, '编辑');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 先选中要补的那一层');
    await t.say('它只对选中的单个图层生效。', '没选会报「智能补全只能在选中的图层中使用」');
    await t.wait(1200);
    await C.selectSourceLayer(t);
    await t.wait(900);

    await t.step('⑤ 点「智能补全」');
    await t.say('进入钢笔模式，按钮变成「执行补全」。');
    await t.wait(900);
    await C.clickAction(t, 'penFill', { settle: 1200 });
    await C.waitLabel(t, 'penFill', '执行补全');
    await t.wait(800);

    await t.step('⑥ 圈出缺失区域');
    await t.say('沿着缺口点锚点，最后点回起点闭合。', '路径不闭合会报「请先绘制闭合钢笔路径」');
    await t.wait(1100);

    const map = await C.canvasMapper(t);
    const outline = [
      [0.10, 0.62], [0.22, 0.60], [0.28, 0.68],
      [0.26, 0.79], [0.15, 0.82], [0.08, 0.73]
    ];
    for (const [u, v] of outline) {
      const p = map.at(u, v);
      await t.click(p.x, p.y, { moveMs: 340, settle: 240 });
    }
    const first = map.at(outline[0][0], outline[0][1]);
    await t.click(first.x, first.y, { moveMs: 520, settle: 1000 });
    await t.wait(900);

    await t.step('⑦ 执行补全');
    await t.say('再点一次按钮执行。');
    await t.wait(800);
    await C.clickAction(t, 'penFill', { settle: 900 });

    await C.waitForRun(t, {
      say: '正在按这一层已有内容补上缺口…',
      sub: '真实处理过程，视频里已加速',
      timeout: 300000
    });

    await t.step('⑧ 看结果');
    await t.say('圈出来的区域按同层内容补好了。');
    await t.wait(2800);
  }
};

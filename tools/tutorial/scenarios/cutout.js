const C = require('./_common');

module.exports = {
  id: 'cutout',
  name: '智能抠图',
  desc: '粗刷一下要的对象，模型自己找边缘，抠出带透明通道的独立图层',
  outro: '刷范围 → 执行抠图 → 拿到透明图层',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「拆图」分组');
    await t.say('抠图工具在「拆图」分组里。', '钢笔抠图靠手动路径，智能抠图靠模型认物体');
    await t.wait(700);
    await C.openGroup(t, '拆图');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 点「智能抠图」');
    await t.say('点「智能抠图」进入涂抹模式。', '按钮会变成「执行抠图」，等你刷完范围');
    await t.wait(800);
    await C.clickAction(t, 'cutout', { settle: 1100 });
    await C.waitLabel(t, 'cutout', '执行抠图');
    await t.wait(900);

    await t.step('⑤ 粗刷出要抠的对象');
    await t.say('不用描边，盖住对象大致范围就行。', '边缘交给模型；刷到一点背景不影响结果');
    await t.wait(900);

    const map = await C.canvasMapper(t);
    const rows = [
      [[0.68, 0.62], [0.81, 0.62]],
      [[0.66, 0.68], [0.83, 0.68]],
      [[0.64, 0.74], [0.85, 0.74]],
      [[0.64, 0.80], [0.85, 0.80]],
      [[0.67, 0.87], [0.84, 0.87]],
      [[0.69, 0.92], [0.82, 0.92]]
    ];
    for (const row of rows) {
      await t.drag(C.stroke(map, row), { stepMs: 24, approachMs: 300, settle: 180 });
    }
    await t.wait(1000);

    await t.step('⑥ 执行抠图');
    await t.say('再点一次按钮执行。', '顶部那个「特效」开关打开，就变成提取光效而不是抠实体');
    await t.wait(900);
    await C.clickAction(t, 'cutout', { settle: 900 });

    await C.waitForRun(t, {
      say: '模型正在沿着对象真实边缘提取…',
      sub: '真实生成过程，视频里已加速',
      timeout: 300000
    });

    await t.step('⑦ 结果是一个独立图层');
    await t.say('机器人被抠成了带透明通道的独立图层。', '可以单独移动、合并，或直接 PSD 导出');
    await t.wait(2400);

    const layer = await t.rectOfText('图层', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
    if (layer) {
      await t.clickRect(layer, { settle: 1400 });
      await t.wait(2200);
    }
  }
};

const C = require('./_common');

module.exports = {
  id: 'mask-edit',
  name: '蒙版编辑',
  desc: '直接改某个图层的蒙版，带羽化和画笔快捷键',
  outro: '选图层 → 擦/画 → 应用蒙版',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「编辑」分组');
    await t.say('蒙版编辑改的是图层的可见范围，不调用模型。', '它是纯手工活，所以给了一套快捷键');
    await t.wait(1000);
    await C.openGroup(t, '编辑');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 先选中一个图层');
    await t.say('没选图层会被拦下：「请先选择一个要使用蒙版编辑的图层」。');
    await t.wait(1100);
    await C.selectSourceLayer(t);
    await t.wait(900);

    await t.step('⑤ 点「蒙版编辑」');
    await t.say('按钮变成「应用蒙版」，说明已经进入编辑状态。', '[ ] 调画笔大小，E / R 在擦除和绘制之间切换');
    await t.wait(1300);
    await C.clickAction(t, 'mask', { settle: 1200 });
    await C.waitLabel(t, 'mask', '应用蒙版');
    await t.wait(900);

    await t.step('⑥ 切到「擦除」');
    await t.say('面板默认是绘制，直接涂看不出变化 —— 先点「擦除」。', '这是最容易卡住的一步；键盘上 E / R 也能切');
    await t.wait(1600);
    const erase = await t.rectOfText('擦除', { within: { x0: 340, x1: 700, y0: 40, y1: 200 }, tags: 'button' });
    if (erase) await t.clickRect(erase, { settle: 900, keepSpot: true });
    await t.wait(900);
    await t.spot(null);

    await t.say('两个滑块分别是画笔大小和羽化。', '边缘要软就把羽化调大');
    await t.wait(1600);

    await t.step('⑦ 擦掉机器人');
    await t.say('在画板上涂抹，这一层被涂的地方就不再显示。');
    await t.wait(1100);

    const map = await C.canvasMapper(t);
    const rows = [
      [[0.66, 0.62], [0.84, 0.62]],
      [[0.63, 0.70], [0.86, 0.70]],
      [[0.62, 0.78], [0.87, 0.78]],
      [[0.64, 0.86], [0.85, 0.86]],
      [[0.66, 0.93], [0.83, 0.93]]
    ];
    for (const row of rows) {
      await t.drag(C.stroke(map, row), { stepMs: 24, approachMs: 340, settle: 200 });
    }
    await t.wait(1100);

    await t.step('⑧ 应用蒙版');
    await t.say('点「应用蒙版」收工，Esc 则放弃。');
    await t.wait(900);
    await C.clickAction(t, 'mask', { settle: 1600 });
    await t.wait(2400);

    await t.step('⑨ 看结果');
    await t.say('机器人从这一层里被擦掉了 —— 像素还在，只是蒙版不让它显示。', '拆图集要先展开，才能对里面的层做遮罩指向');
    await t.wait(3200);
  }
};

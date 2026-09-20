const C = require('./_common');

const DIALOG = '画布扩展';

module.exports = {
  id: 'canvas-resize',
  name: '画布扩展',
  desc: '改画布尺寸，并决定原图钉在哪个角 —— 只加空白，不生成内容',
  outro: '填新尺寸 → 选锚点 → 执行扩展',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「编辑」分组');
    await t.say('画布扩展是「编辑」分组最后一个。', '它是纯尺寸操作，不调用模型');
    await t.wait(700);
    await C.openGroup(t, '编辑');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 打开「画布扩展」');
    await t.say('点开后会显示当前画布大小。');
    await t.wait(800);
    await C.clickAction(t, 'canvasResize', { settle: 1100 });
    await C.waitDialog(t, DIALOG);
    await t.wait(1000);

    await t.step('⑤ 填新的宽度');
    await t.say('把宽度改大，高度保持不变。', '这里填的是最终画布尺寸，不是要增加多少');
    await t.wait(800);
    await C.setDialogNumber(t, DIALOG, 0, 1500);
    await t.wait(900);

    await t.step('⑥ 选锚点');
    await t.say('九宫格决定原图留在新画布的哪个位置。', '选「←」就是原图靠左，空白加在右边');
    await t.wait(900);
    const anchor = await t.rectOfText('←', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (anchor) await t.clickRect(anchor, { settle: 800 });
    await t.wait(900);

    await t.step('⑦ 执行扩展');
    await t.say('点「执行扩展」。');
    await t.wait(700);
    const go = await t.rectOfText('执行扩展', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (!go) throw new Error('画布扩展 dialog has no 执行扩展 button');
    await t.clickRect(go, { settle: 1600 });
    await t.wait(2200);

    await t.step('⑧ 看结果');
    await t.say('画布变宽了，右边是空白 —— 它不会替你画内容。', '想让扩出来的部分长出画面，用「无限扩图」');
    await t.wait(3200);
  }
};

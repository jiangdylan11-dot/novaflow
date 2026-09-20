const C = require('./_common');

const DIALOG = '无限扩图';

module.exports = {
  id: 'outpaint',
  name: '无限扩图',
  desc: '把画布撑开，新增的部分由模型画满，原图区域锁死不动',
  outro: '填新尺寸 → 选锚点 → 执行扩展',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「增强」分组');
    await t.say('无限扩图在「增强」分组里。', '和「画布扩展」的分工：那个只加空白，这个会把空白画满');
    await t.wait(700);
    await C.openGroup(t, '增强');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 打开「无限扩图」');
    await t.say('面板和画布扩展长得一样：填新尺寸 + 选锚点。');
    await t.wait(800);
    await C.clickAction(t, 'imageOutpaint', { settle: 1100 });
    await C.waitDialog(t, DIALOG);
    await t.wait(1000);

    await t.step('⑤ 填新尺寸、选锚点');
    await t.say('把宽度加大，锚点选「←」，让新增区域出现在右边。', '原图区域是强制保留的，扩图不会顺手改你已有的画面');
    await t.wait(900);
    await C.setDialogNumber(t, DIALOG, 0, 1500);
    await t.wait(700);
    const anchor = await t.rectOfText('←', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (anchor) await t.clickRect(anchor, { settle: 800 });
    await t.wait(900);

    await t.step('⑥ 执行扩展');
    await t.say('点「执行扩展」，模型开始补新增区域。');
    await t.wait(700);
    const go = await t.rectOfText('执行扩展', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (!go) throw new Error('无限扩图 dialog has no 执行扩展 button');
    await t.clickRect(go, { settle: 900 });

    await C.waitForRun(t, {
      say: '正在生成新增区域…',
      sub: '真实生成过程，视频里已加速',
      timeout: 900000
    });

    await t.step('⑦ 看结果');
    await t.say('右边新长出来的画面接上了原图的透视和光线。', '原图那部分一个像素都没动');
    await t.wait(3200);
  }
};

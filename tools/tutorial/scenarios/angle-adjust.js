const C = require('./_common');

const DIALOG = '角度调整';

module.exports = {
  id: 'angle-adjust',
  name: '角度调整',
  desc: '换一个机位看同一张图：拖动小方块定角度，模型重新出图',
  outro: '拖角度 → 开始生成',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「增强」分组');
    await t.say('角度调整在「增强」分组里。', '用 Qwen-Image-2.1，对整张原图换机位');
    await t.wait(700);
    await C.openGroup(t, '增强');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 点「角度调整」');
    await t.say('原图没就绪时这个按钮是灰的，这是有意的防呆。', '就绪后点开，会弹出机位面板');
    await t.wait(900);
    await C.clickAction(t, 'imageAngleAdjust', { settle: 1100 });
    await C.waitDialog(t, DIALOG);
    await t.wait(1000);

    await t.step('⑤ 拖出想要的机位');
    await t.say('在面板里拖动，就能改水平角、垂直角和距离。', '右边那个 ↻ 是一键复位');
    await t.wait(900);

    const stage = await t.rect(C.dialogSel(DIALOG) + ' canvas');
    if (stage) {
      await t.spot(stage);
      const mid = { x: stage.cx, y: stage.cy };
      const path = [];
      for (let i = 0; i <= 30; i += 1) {
        path.push({ x: mid.x - i * 3.4, y: mid.y + i * 0.9 });
      }
      await t.drag(path, { stepMs: 32, approachMs: 620, settle: 700 });
      await t.spot(null);
    }
    await t.wait(1400);

    await t.step('⑥ 开始生成');
    await t.say('角度定好，点「开始生成」。');
    await t.wait(700);
    const go = await t.rectOfText('开始生成', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (!go) throw new Error('角度调整 dialog has no 开始生成 button');
    await t.clickRect(go, { settle: 900 });

    await C.waitForRun(t, {
      say: '正在按新机位重画整张图…',
      sub: '真实生成过程，视频里已加速',
      timeout: 900000
    });

    await t.step('⑦ 看结果');
    await t.say('同一个场景，换了个机位重新出图。', '它改的是整张原图，不是某个图层');
    await t.wait(3200);
  }
};

const C = require('./_common');

module.exports = {
  id: 'inpaint-completion',
  name: '智能补图',
  desc: '补回缺掉的结构，还能用提示词指定补成什么',
  outro: '刷缺口 → 写提示词 → 执行补图',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「编辑」分组');
    await t.say('智能补图和去除物体是一对：', '一个往里加结构，一个把东西拿掉并填背景');
    await t.wait(800);
    await C.openGroup(t, '编辑');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 点「智能补图」');
    await t.say('点一下进入涂抹模式。');
    await t.wait(800);
    await C.clickAction(t, 'inpaintCompletion', { settle: 1100 });
    await C.waitLabel(t, 'inpaintCompletion', '执行');
    await t.wait(800);

    await t.step('⑤ 写清楚要补成什么');
    await t.say('这个工具保留提示词输入，可以指定补出来的内容。', '不写也能跑，但写了更可控');
    await t.wait(800);
    await C.fillPrompt(t, '补全完整的木栅栏和草地，保持原有透视', { placeholder: '' });
    await t.wait(800);

    await t.step('⑥ 刷出要补的区域');
    await t.say('刷住结构缺失或想重建的那一块。', '没刷范围就执行，会报「请先在缺失区域涂出修图范围」');
    await t.wait(1000);

    const map = await C.canvasMapper(t);
    const rows = [
      [[0.80, 0.50], [0.97, 0.50]],
      [[0.80, 0.55], [0.97, 0.55]],
      [[0.81, 0.60], [0.97, 0.60]]
    ];
    for (const row of rows) {
      await t.drag(C.stroke(map, row), { stepMs: 24, approachMs: 320, settle: 190 });
    }
    await t.wait(1000);

    await t.step('⑦ 执行补图');
    await t.say('再点一次按钮执行。');
    await t.wait(800);
    await C.clickAction(t, 'inpaintCompletion', { settle: 900 });

    await C.waitForRun(t, {
      say: '正在按提示词重建这块结构…',
      sub: '真实生成过程，视频里已加速',
      timeout: 300000
    });

    await t.step('⑧ 看结果');
    await t.say('刷中的区域按提示词重建了，其余部分没动。');
    await t.wait(3000);
  }
};

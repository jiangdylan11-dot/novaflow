const C = require('./_common');

module.exports = {
  id: 'object-remove',
  name: '去除物体',
  desc: '刷掉不想要的东西，背景自动补上 —— 记得连影子一起刷',
  outro: '刷物体+影子 → 执行去除',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「编辑」分组');
    await t.say('去除物体和局部编辑是同一组里的邻居。', '区别是：一个往里加东西，一个把东西拿掉');
    await t.wait(700);
    await C.openGroup(t, '编辑');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入原图' });

    await t.step('④ 点「去除物体」');
    await t.say('点一下进入涂抹模式。', '这个工具不需要写提示词，它靠遮罩工作');
    await t.wait(900);
    await C.clickAction(t, 'inpaintRepair', { settle: 1100 });
    await C.waitLabel(t, 'inpaintRepair', '执行');
    await t.wait(800);

    await t.step('⑤ 连影子一起刷');
    await t.say('把机器人刷掉 —— 注意地上的投影也要刷。', '只刷物体不刷影子，影子会留在成品上');
    await t.wait(1100);

    const map = await C.canvasMapper(t);
    const rows = [
      [[0.67, 0.61], [0.82, 0.61]],
      [[0.64, 0.67], [0.85, 0.67]],
      [[0.63, 0.73], [0.86, 0.73]],
      [[0.63, 0.79], [0.86, 0.79]],
      [[0.65, 0.85], [0.85, 0.85]],
      [[0.66, 0.91], [0.84, 0.91]],
      [[0.55, 0.95], [0.86, 0.95]],
      [[0.52, 0.98], [0.84, 0.98]]
    ];
    for (const row of rows) {
      await t.drag(C.stroke(map, row), { stepMs: 24, approachMs: 300, settle: 170 });
    }
    await t.wait(1000);

    await t.step('⑥ 执行去除');
    await t.say('再点一次按钮执行。', '顶部「特效」开关打开则变成「执行特效去除」，处理光效而不是实体');
    await t.wait(900);
    await C.clickAction(t, 'inpaintRepair', { settle: 900 });

    await C.waitForRun(t, {
      say: '正在删除遮罩内容并补全背景…',
      sub: '真实生成过程，视频里已加速',
      timeout: 300000
    });

    await t.step('⑦ 看结果');
    await t.say('机器人和它的影子一起没了，路面自己接上了。', '刷得越完整，补出来的背景越干净');
    await t.wait(3000);
  }
};

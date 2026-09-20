const C = require('./_common');

const DIALOG = '[data-novaflow-object-transfer-dialog]';

module.exports = {
  id: 'object-transfer',
  name: '万物迁移',
  desc: '把参考图里的东西搬进当前画面：自动抠主体、你定位置，模型重画光影和投影',
  outro: '传参考物 → 摆位置 → 执行迁移',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「增强」分组');
    await t.say('万物迁移在「增强」分组里。', '它不是贴图，是让模型按当前画面重画这个物体');
    await t.wait(700);
    await C.openGroup(t, '增强');
    await t.wait(600);

    await C.loadDemo(t, {
      step: '③ 载入底图',
      url: '/tutorial-assets/demo-plate.png',
      name: 'demo-plate.png',
      say: '先拖入底图 —— 也就是要被放东西进去的那张画面。',
      sub: '底图是画风的唯一标准，参考图只提供物体本身'
    });

    await t.step('④ 点「万物迁移」上传参考物');
    await t.say('点「万物迁移」，弹窗里传入要搬进来的物体。', '背景简单的参考图，主体提取得更干净');
    await t.wait(800);
    await C.clickAction(t, 'objectTransfer', { settle: 1200 });
    await t.waitFor('!!document.querySelector(' + JSON.stringify(DIALOG) + ')', { timeout: 12000 });
    await t.wait(900);

    const zone = await t.rect(DIALOG + ' div[role="button"]');
    if (zone) await t.spot(zone);
    await t.wait(600);
    await t.loadImage('/tutorial-assets/demo-object.png', 'demo-object.png', DIALOG + ' div[role="button"]');
    await t.waitFor('!!document.querySelector(' + JSON.stringify(DIALOG + ' img') + ')', { timeout: 12000 });
    await t.spot(null);
    await t.wait(1100);

    await t.step('⑤ 确认后自动提取主体');
    await t.say('点「确认」，系统先自动把参考物抠成透明主体。', '不需要你手动抠一遍');
    await t.wait(800);
    const confirm = await t.rectOfText('确认', { within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (!confirm) throw new Error('confirm button not found in transfer dialog');
    await t.clickRect(confirm, { settle: 1200 });

    await t.ffStart('rmbg');
    await t.waitFor('!document.querySelector(' + JSON.stringify(DIALOG) + ')', { timeout: 60000, optional: true });
    await C.waitLabel(t, 'objectTransfer', '执行迁移', { timeout: 180000 });
    await t.ffEnd(5);
    await t.wait(1200);

    await t.step('⑥ 拖到想放的位置');
    await t.say('参考物已经出现在画布上，按住拖到目标位置。', '滚轮可以缩放大小');
    await t.wait(1000);

    /* The subject lands at the canvas origin, not the middle - grab it where it
       actually is, or the drag sails past it and nothing moves. */
    const map = await C.canvasMapper(t);
    const subject = await t.rect('[data-novaflow-object-transfer-subject="1"]');
    const from = subject ? { x: subject.cx, y: subject.cy } : map.at(0.14, 0.14);
    const to = map.at(0.72, 0.70);
    const path = [];
    const steps = 26;
    for (let i = 0; i <= steps; i += 1) {
      path.push({
        x: from.x + (to.x - from.x) * (i / steps),
        y: from.y + (to.y - from.y) * (i / steps)
      });
    }
    await t.drag(path, { stepMs: 34, approachMs: 620, settle: 700 });
    await t.wait(1400);

    await t.step('⑦ 执行迁移');
    await t.say('位置满意了，点「执行迁移」。', '模型会按底图的光线重画物体，并补上真实接触阴影');
    await t.wait(900);
    await C.clickAction(t, 'objectTransfer', { settle: 900 });

    await C.waitForRun(t, {
      say: '正在按底图画风重绘物体与投影…',
      sub: '真实生成过程，视频里已加速',
      timeout: 600000
    });

    await t.step('⑧ 看结果');
    await t.say('物体不是贴上去的：画风、受光、投影都跟着底图走。', '原有人物和画面其余部分保持不变');
    await t.wait(3000);

    const orig = await t.rectOfText('原图', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
    if (orig) {
      await t.say('切「原图」对比一下迁移前后。');
      await t.clickRect(orig, { settle: 1500 });
      await t.wait(1600);
      const layer = await t.rectOfText('图层', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
      if (layer) await t.clickRect(layer, { settle: 1200 });
      await t.wait(1500);
    }
  }
};

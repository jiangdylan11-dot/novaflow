const C = require('./_common');

module.exports = {
  id: 'split',
  name: '一键拆图（骨骼动画）',
  desc: '把一张角色图拆成可以做骨骼动画的分层',
  outro: '拖图 → 一键拆图 → 逐层检查',

  async run(t) {
    await C.enterArtDraw(t);

    await t.step('② 展开「拆图」分组');
    await t.say('一键拆图是整个「拆图」分组最上面那个。', '它一次把角色拆成多层，供后面做骨骼动画');
    await t.wait(700);
    await C.openGroup(t, '拆图');
    await t.wait(600);

    await C.loadDemo(t, { step: '③ 载入角色原图' });

    await t.step('④ 点「一键拆图」');
    await t.say('点开后先选拆图方式。', '默认拆图更快；高清拆图保留更多细节，耗时明显增加');
    await t.wait(1200);
    await C.clickAction(t, 'split', { settle: 1100 });
    await C.waitDialog(t, '选择拆图方式');
    await t.wait(1400);

    await t.step('⑤ 五官要不要单独成层');
    await t.say('做眨眼、口型就打开「五官单独成层」。', '打开后眉毛、眼白、眼珠、睫毛、鼻子、嘴、耳朵各自成层，多约 2 分钟');
    await t.wait(2200);

    await t.say('步数越高越稳定，但越慢。默认 30 够用。');
    await t.wait(1600);

    await t.step('⑥ 选「默认拆图」开始');
    await t.say('点「默认拆图（推荐）」，选完立即开始。');
    await t.wait(900);
    const go = await t.rectOfText('默认拆图', { contains: true, within: { x0: 300, x1: 1400 }, tags: 'button' });
    if (!go) throw new Error('拆图方式 dialog has no 默认拆图 button');
    await t.clickRect(go, { settle: 900 });

    await C.waitForRun(t, {
      say: '正在识别部件并逐层分离…',
      sub: '真实生成过程，视频里已加速',
      timeout: 1200000
    });

    await t.step('⑦ 逐层检查');
    await t.say('右侧是拆出来的图层，可以逐个显示/隐藏检查。', '腿不会自动拆；脚只分左右；脸默认用整个头部图层');
    await t.wait(1200);

    const layer = await t.rectOfText('图层', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
    if (layer) {
      await t.clickRect(layer, { settle: 1400 });
      await t.wait(3000);
    }

    await t.say('需要更细的分层，就用钢笔抠图手动补。', '合并图层要先按住 Ctrl 选中至少 2 层');
    await t.wait(2600);
  }
};

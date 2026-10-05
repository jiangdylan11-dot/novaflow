import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function runtime() {
  const context = {setTimeout, clearTimeout, console};
  vm.createContext(context);
  for (const file of ['ui-design-prompt.pipeline.js', 'ui-design-assistant.workflow.js']) {
    vm.runInContext(readFileSync(new URL('../../renderer/' + file, import.meta.url), 'utf8'), context);
  }
  return context;
}

test('business constraints survive the real wireframe theme path and ordinary image editing', () => {
  const pipeline = runtime().NovaFlowUiDesignPromptPipeline;
  for (const wireframe of [false, true]) {
    const references = [{role: 'layout', dataUrl: 'data:image/png;base64,layout', ...(wireframe ? {uiLayoutId: 'published'} : {})}];
    const uiPlan = {version: 1, layoutReference: 1, layoutMode: 'preserve', visualMode: 'theme-redesign',
      references: [{index: 1, role: 'layout'}], layoutChanges: [], grids: [],
      preserve: ['一个玩法盘5列3行', 'MAJOR 10,000；MEGA 50,000；MINOR 50,000', 'TOTAL WIN 96.00', '余额¥1000、下注¥1000、赢取¥1000', 'sound、quick spin、Spin、auto play、menu五个功能']};
    const result = pipeline.compileQwenPlan({prompt: '中国生肖主题，温暖的3D卡通画风。', uiPlan},
      {prompt: '换成中国生肖主题', references, preserveLayout: true, generationIntent: 'redesign'});
    assert.equal(result.references.length, 1);
    assert.equal(result.plan.layoutReference, 1);
    for (const fact of ['10,000', '50,000', '96.00', '¥1000', 'quick spin', '5列3行']) assert.ok(result.prompt.includes(fact), fact);
    assert.match(result.prompt, /未要求改变的金额、规则、控制功能及其状态保持正确/);
    assert.match(result.prompt, /玩法盘数量、每个盘的行列和逐格实例/);
    assert.match(result.prompt, /不因题材猜测增加登录、邀请、任务或其他新功能/);
    assert.match(result.prompt, /诊断文字与示例值不属于业务数据/);
  }
});

test('actual assistant transport asks for the observed business inventory without a fixed slot template', async () => {
  const context = runtime();
  const requests = [];
  for (const targetEngine of ['qwen-2.1', 'grok']) {
    await context.NovaFlowUiDesignAssistantWorkflow.run({provider: 'local', engine: 'grok', targetEngine,
      sessionToken: 'test', prompt: '参考图做中国生肖主题', preserveLayout: true, generationIntent: 'redesign',
      size: {width: 576, height: 1250}, references: [{role: 'layout', dataUrl: 'data:image/png;base64,layout'}],
      electronAPI: {smartAiImageReverse: async request => {
        requests.push(request);
        return {ok: true, prompt: '生肖主题的完整界面，保留原功能。', uiPlan: null};
      }}});
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.match(request.requirements, /全部奖励档位名称与金额、余额、下注、赢取信息/);
    assert.match(request.requirements, /将准确读到的名称、数值、数量和功能写入最终要求及保留事实/);
    assert.match(request.requirements, /不能新增或重复游戏盘/);
    assert.match(request.requirements, /不能因为主题而添加登录、邀请、任务或其他功能/);
    assert.doesNotMatch(request.requirements, /(?:固定|必须(?:为|是))5列3行|四档奖励|五个底部/);
  }
});

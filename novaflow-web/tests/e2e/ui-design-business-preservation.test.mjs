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
    assert.match(result.prompt, /主题重设计只保留布局图的业务结构/);
    assert.doesNotMatch(result.prompt, /全部操作图标及功能状态逐项保留/);
    assert.match(result.prompt, /不得新增登录、输入、设置、弹窗等新功能/);
    if (wireframe) assert.match(result.prompt, /定位图的标号与演示数值不是业务内容/);
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


test('theme scope differs from strict partial editing at the final compiled prompt', () => {
  const pipeline=runtime().NovaFlowUiDesignPromptPipeline;
  const references=[{role:'layout',dataUrl:'data:image/png;base64,layout'}];
  const base={version:1,layoutReference:1,layoutMode:'preserve',references:[{index:1,role:'layout'}],layoutChanges:[],grids:[],preserve:['MAJOR 10,000','menu']};
  const theme=pipeline.compileQwenPlan({prompt:'全面重新设计埃及主题UI',uiPlan:{...base,visualMode:'theme-redesign'}},{prompt:'更换埃及主题，保留业务功能',references,generationIntent:'redesign',preserveLayout:true});
  assert.match(theme.prompt,/按钮造型、面板边框、字体视觉、材质与配色不继承旧主题/);
  assert.doesNotMatch(theme.prompt,/全部操作图标及功能状态逐项保留|每个盘的行列和逐格实例/);
  assert.ok(theme.prompt.includes('MAJOR 10,000'));
  const partial=pipeline.compileQwenPlan({prompt:'只修改按钮颜色',uiPlan:{...base,visualMode:'partial',layoutMode:'partial',layoutChanges:['只修改按钮颜色']}},{prompt:'只修改按钮颜色，所有内容和位置不变',references,generationIntent:'edit',preserveLayout:true});
  assert.match(partial.prompt,/全部操作图标及功能状态逐项保留/);
  assert.doesNotMatch(partial.prompt,/全部人物、装饰、道具与图标外观必须/);
});

test('real UI assistant and compiler retain repeated styles and unmentioned references through ten images', async () => {
  for (const total of [2, 3, 4, 10]) {
    const context = runtime();
    vm.runInContext(readFileSync(new URL('../../renderer/ui-design.drawing.js', import.meta.url), 'utf8'), context);
    const references = Array.from({length: total}, (_, index) => ({id: 'source-' + (index + 1),
      role: index === 0 ? 'layout' : index === 1 || (total >= 4 && index === 2) ? 'style' : 'asset',
      dataUrl: 'data:image/png;base64,' + Buffer.from('image-' + index).toString('base64')}));
    let transported;
    const input = {provider: 'local', engine: 'local', targetEngine: 'qwen-2.1',
      prompt: '重新设计为糖果主题，图2是主风格，原业务内容和布局保持。', references,
      preserveLayout: true, generationIntent: 'redesign', electronAPI: {
        promptAssistantReverseImagePrompt: async request => {
          transported = request.images;
          return {ok: true, prompt: request.currentPrompt, uiPlan: {
            version: 1, layoutMode: 'preserve', layoutReference: 1, visualMode: 'theme-redesign',
            references: references.map((ref, index) => ({index: index + 1, role: ref.role})),
            layoutChanges: [], preserve: []}};
        }}};
    const result = await context.NovaFlowUiDesignPromptPipeline.run({id: 'roles-' + total,
      input, assistant: context.NovaFlowUiDesignAssistantWorkflow});
    const compiled = context.NovaFlowUiDesignPromptPipeline.compileQwenPlan(result, input);
    const forwarded = context.NovaFlowUiDesignDrawing.generationOptions({uiPlan: compiled.plan, references: compiled.references});
    assert.equal(transported.length, total);
    assert.deepEqual(transported.map(ref => ref.dataUrl), references.map(ref => ref.dataUrl));
    assert.equal(compiled.references.length, total);
    assert.equal(forwarded.referenceRoles.length, total);
    assert.equal(forwarded.taskProfile, 'ui-design');
    assert.equal(forwarded.referenceRoles.filter(ref => ref.role === 'style').length, total >= 4 ? 2 : 1);
    assert.equal(forwarded.referenceRoles[total - 1].sourceId, 'source-' + total);
    assert.ok(compiled.prompt.includes('<image' + total + '>'));
    assert.deepEqual(Array.from(forwarded.referenceRoles, ref => ref.index), Array.from({length: total}, (_, index) => index));
  }
});

test('explicit image roles survive a wrong AI plan without discarding partial edits or remapping identity', async () => {
  const context = runtime();
  vm.runInContext(readFileSync(new URL('../../renderer/ui-design.drawing.js', import.meta.url), 'utf8'), context);
  const roles = ['style', 'asset', 'layout', 'material', 'reference'];
  const references = roles.map((role, index) => ({id: 'stable-' + (index + 1), role,
    dataUrl: 'data:image/png;base64,' + Buffer.from('pixels-' + index).toString('base64')}));
  const input = {provider: 'local', engine: 'local', targetEngine: 'qwen-2.1', references,
    generationIntent: 'iteration', preserveLayout: true,
    prompt: '图1是主风格，图2是角色，图3是布局，图4只提供金雕材质；只修改上方角色，底部金额不变。',
    electronAPI: {promptAssistantReverseImagePrompt: async request => {
      assert.equal(request.images[1].role, 'asset', 'asset must not be normalized into content');
      return {ok: true, prompt: request.currentPrompt, uiPlan: {version: 1, layoutMode: 'partial',
        visualMode: 'partial', layoutReference: 3,
        references: [5, 2, 4, 1, 3].map(index => ({index, role: index === 5 ? 'asset' : 'content'})),
        layoutChanges: ['只修改上方角色'], preserve: ['底部金额¥1000保持'], grids: []}};
    }}};
  const result = await context.NovaFlowUiDesignPromptPipeline.run({id: 'role-authority',
    input, assistant: context.NovaFlowUiDesignAssistantWorkflow});
  const compiled = context.NovaFlowUiDesignPromptPipeline.compileQwenPlan(result, input);
  assert.equal(compiled.plan.layoutMode, 'partial');
  assert.deepEqual(Array.from(compiled.plan.layoutChanges), ['只修改上方角色']);
  assert.ok(compiled.plan.preserve.includes('底部金额¥1000保持'));
  assert.deepEqual(Array.from(compiled.references, ref => ref.id), ['stable-3', 'stable-1', 'stable-2', 'stable-4', 'stable-5']);
  assert.deepEqual(Array.from(compiled.plan.references, ref => ref.role), ['layout', 'style', 'asset', 'style', 'asset']);
  assert.match(compiled.prompt, /<image2>是风格来源/);
  assert.match(compiled.prompt, /<image3>是人物或元素素材来源/);
  assert.match(compiled.prompt, /<image4>是质感来源/);
  assert.ok(compiled.prompt.includes('<image5>'), 'unassigned reference remains and may use AI inference');
  const forwarded = context.NovaFlowUiDesignDrawing.generationOptions({uiPlan: compiled.plan, references: compiled.references});
  assert.deepEqual(Array.from(forwarded.referenceRoles, ref => ref.sourceId), ['stable-3', 'stable-1', 'stable-2', 'stable-4', 'stable-5']);
  assert.equal(forwarded.referenceRoles.filter(ref => ref.role === 'style').length, 2);
});

test('existing design text assigns explicit uses by stable image ID before planning, including sparse slots', () => {
  const context = runtime();
  vm.runInContext(readFileSync(new URL('../../renderer/ui-design.drawing.js', import.meta.url), 'utf8'), context);
  const occupied = id => ({id, dataUrl: 'data:image/png;base64,aGVsbG8='});
  const references = [occupied('layout'), null, occupied('main'), occupied('aux'), null, null, occupied('tiger')];
  const state = {prompt: '图1是布局；图3是主风格；图4是副风格/材质；图7是角色身份。'};
  const input = context.NovaFlowUiDesignDrawing.inputFor({state, references, referenceLimit: 10});
  assert.deepEqual(Array.from(input.references, ref => ref.id), ['layout', 'main', 'aux', 'tiger']);
  assert.deepEqual(Array.from(input.references, ref => ref.role), ['layout', 'style', 'material', 'character']);
  assert.equal(references[2].role, undefined, 'source object is not mutated');
  const negative = context.NovaFlowUiDesignDrawing.inputFor({state: {prompt: '图3不是风格；不要把图4作为材质。'}, references, referenceLimit: 10});
  assert.equal(negative.references[1].role, 'reference');
  assert.equal(negative.references[2].role, 'reference');
  assert.throws(() => context.NovaFlowUiDesignDrawing.inputFor({state: {prompt: '图3是风格；图3是角色。'}, references, referenceLimit: 10}), /不同用途/);
});

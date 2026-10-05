import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let assertionCount = 0;
const check = new Proxy(assert, {
  get(target, name) {
    const method = target[name];
    return typeof method === 'function' ? (...args) => {
      assertionCount += 1;
      return Reflect.apply(method, target, args);
    } : method;
  },
});
after(() => console.log(`Pure-style compatibility assertions: ${assertionCount}`));

function environment() {
  const context = { setTimeout, clearTimeout, console };
  vm.createContext(context);
  for (const name of ['ui-design-prompt.pipeline.js', 'ui-design-assistant.workflow.js']) {
    vm.runInContext(readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8'), context);
  }
  return { pipeline: context.NovaFlowUiDesignPromptPipeline, assistant: context.NovaFlowUiDesignAssistantWorkflow };
}

const layout = { id: 'original-ui', role: 'layout', dataUrl: 'data:image/png;base64,original-layout-pixels' };
const sourceFacts = [
  '符号区5列3行，共15格',
  '五个底部控件的功能保持不变',
  '金额1000与下注100保持不变',
  '原主框矩形轮廓与宽高比例保持不变',
  '奖励栏原承托和连接结构保持不变',
];
const staleContent = ['原人物身份保持不变', '原物品身份与顺序保持不变', '原标题OLD WEST不变'];
const contentMapping = '人物换为美人鱼，标题改为TIDAL TREASURES，第1行第1列换为贝壳，第2行第2列换为海马，金额和五个控件功能保持正确';
const innovation = /锚定区域内可创意重设计|重新设计组件构造、边框组织|通过轮廓、承托与连接关系的具体变化辨认新构造|不能只给相同骨架换材质/;

// Fact boundaries may be normalized by the compiler; compare preserved substance.
const factClauses = values => Array.from(values).flatMap(value => value.split(/[，；]/)).map(value => value.trim()).filter(Boolean);

function planFor(references, overrides = {}) {
  const anchor = references.findIndex(ref => ref.role === 'layout');
  return {
    version: 1, layoutMode: 'preserve', layoutReference: anchor + 1, visualMode: 'theme-redesign',
    references: references.map((ref, index) => ({ index: index + 1, role: ref.role === 'layout' ? 'layout' : 'style' })),
    layoutChanges: [], preserve: [], grids: [], ...overrides,
  };
}

function compile(pipeline, prompt, overrides = {}) {
  const references = overrides.references || [layout];
  const input = { references, prompt, preserveLayout: true, generationIntent: 'redesign', ...overrides.input };
  const uiPlan = overrides.uiPlan === undefined ? planFor(references, { preserve: sourceFacts }) : overrides.uiPlan;
  return pipeline.compileQwenPlan({ prompt: overrides.directive || prompt, uiPlan }, input);
}

test('a new theme can reskin a complete UI while retaining source construction and explicit content mapping', () => {
  const { pipeline } = environment();
  const prompt = '保留图1布局，换成深海主题，只做纯粹换皮，所有组件的轮廓、承托与连接结构保持不变。' + contentMapping;
  for (const uiPlan of [planFor([layout], { layoutMode: 'reflow', layoutChanges: ['使用全新竖屏模板'], preserve: [...sourceFacts, ...staleContent] }), null]) {
    const result = compile(pipeline, prompt, { uiPlan, directive: contentMapping });
    check.equal(pipeline.requestsFormPreservation({ prompt, generationIntent: 'redesign' }), true);
    check.equal(result.plan.visualMode, 'theme-redesign');
    check.equal(result.plan.layoutMode, 'preserve');
    check.deepEqual(Array.from(result.plan.layoutChanges), []);
    check.equal(result.references[0].dataUrl, layout.dataUrl);
    check.match(result.prompt, /美人鱼.*TIDAL TREASURES.*第1行第1列换为贝壳.*第2行第2列换为海马/);
    check.doesNotMatch(result.prompt, /原人物身份保持不变|原物品身份与顺序保持不变|原标题OLD WEST|全新竖屏模板/);
    check.doesNotMatch(result.prompt, innovation);
    if (uiPlan) check.deepEqual(factClauses(result.plan.preserve), factClauses(sourceFacts));
  }
});

test('pure reskin intent overrides a generic redesign label without replacing unchanged content', () => {
  const { pipeline } = environment();
  const prompt = '参考图1，纯换皮，材质改为羊毛毡，全部构造保持不变';
  const result = compile(pipeline, prompt, { directive: '把整个界面的材质换成羊毛毡', uiPlan: planFor([layout], { preserve: [...sourceFacts, ...staleContent] }) });
  check.equal(pipeline.requestsFormPreservation({ prompt, generationIntent: 'redesign' }), true);
  check.equal(result.plan.visualMode, 'style-transfer');
  check.equal(result.plan.layoutMode, 'preserve');
  check.deepEqual(Array.from(result.plan.preserve), [...sourceFacts, ...staleContent]);
  check.match(result.prompt, /保留画布内的原人物与物品身份、文案和功能/);
  check.doesNotMatch(result.prompt, innovation);
});

test('global negation of shape redesign protects construction even while theme content changes', () => {
  const { pipeline } = environment();
  for (const prompt of ['主题改成深海，整张UI的造型不要重新设计，人物物品标题按新主题替换', '换成深海主题，不要重设计外壳，只换主题', '换成深海主题，整体保形']) {
    const result = compile(pipeline, prompt, { directive: contentMapping });
    check.equal(pipeline.requestsFormPreservation({ prompt, generationIntent: 'redesign' }), true);
    check.equal(result.plan.visualMode, 'theme-redesign');
    check.deepEqual(factClauses(result.plan.preserve), factClauses(sourceFacts));
    check.doesNotMatch(result.prompt, innovation);
  }
});

test('ordinary style migration preserves construction and sends no construction-innovation instruction', () => {
  const { pipeline } = environment();
  const result = compile(pipeline, '主题不变，只换画风为手绘水彩', { input: { generationIntent: 'style-transfer' }, directive: '将材质绘制成手绘水彩纸纹' });
  check.equal(result.plan.visualMode, 'style-transfer');
  check.deepEqual(factClauses(result.plan.preserve), factClauses(sourceFacts));
  check.doesNotMatch(result.prompt, innovation);
});

test('affirmative construction work and a rejected pure reskin still allow genuine form innovation', () => {
  const { pipeline } = environment();
  for (const prompt of ['换成深海主题，重新设计组件造型和构造', '换成深海主题，重新设计组件造型但金额和功能保持', '换成深海主题，不要纯换皮，要重新设计组件构造', '换成深海主题，不能只换皮，要重新设计主体承托', '换成深海主题，不是只换皮，要重新设计主体承托', '换成深海主题，所有轮廓无需保留，组件构造重做']) {
    const result = compile(pipeline, prompt);
    check.equal(pipeline.requestsFormPreservation({ prompt, generationIntent: 'redesign' }), false);
    check.equal(result.plan.visualMode, 'theme-redesign');
    check.match(result.prompt, innovation);
    check.doesNotMatch(result.plan.preserve.join('；'), /原主框矩形轮廓|奖励栏原承托/);
  }
});

test('a single component restriction and gameplay preservation cannot freeze whole-screen construction', () => {
  const { pipeline } = environment();
  for (const prompt of ['换成深海主题，主按钮必须保持圆形', '换成深海主题，保留整体布局和所有控件的功能连接', '换成深海主题，只给主按钮换皮，其余组件构造重新设计']) {
    const result = compile(pipeline, prompt);
    check.equal(pipeline.requestsFormPreservation({ prompt, generationIntent: 'redesign' }), false);
    check.match(result.prompt, innovation);
    check.match(result.prompt, /符号区5列3行，共15格.*五个底部控件的功能保持不变/);
    if (prompt.includes('圆形')) check.match(result.prompt, /主按钮必须保持圆形/);
  }
});

test('whole-form preservation keeps layout authority and native reference order', () => {
  const { pipeline } = environment();
  const references = [{ id: 'felt-style', role: 'style', dataUrl: 'data:image/png;base64,style-original-pixels' }, layout];
  const prompt = '图2作为布局，图1仅提供羊毛毡风格，换成深海主题，所有组件形状都保持不变';
  const result = compile(pipeline, prompt, { references, directive: prompt });
  check.equal(pipeline.requestsFormPreservation({ prompt, generationIntent: 'redesign' }), true);
  check.equal(result.references[0], layout);
  check.equal(result.references[1], references[0]);
  check.equal(result.plan.layoutReference, 1);
  check.match(result.prompt, /<image1>作为布局，<image2>仅提供羊毛毡风格/);
  check.match(result.prompt, /<image2>是风格来源，只迁移美术表现/);
  check.doesNotMatch(result.prompt, innovation);
});

test('both planner requirement contracts state the pure-reskin exception without losing a new-theme mapping', async () => {
  const { assistant } = environment();
  const prompt = '换成深海主题，纯换皮，全部组件轮廓与承托连接保持原样。' + contentMapping;
  for (const options of [{ provider: 'local', targetEngine: 'qwen-2.1' }, { provider: 'gpt', targetEngine: 'gpt-image-1' }]) {
    let request;
    const result = await assistant.run({
      ...options, engine: 'grok', sessionToken: 'test', prompt, generationIntent: 'redesign', preserveLayout: true,
      references: [layout], size: { width: 1280, height: 720 },
      electronAPI: { smartAiImageReverse: async payload => {
        request = payload;
        return { ok: true, prompt: contentMapping, uiPlan: planFor([layout], { preserve: sourceFacts }) };
      } },
    });
    check.match(request.requirements, /纯换皮|整体保形|全局保形/);
    check.match(request.requirements, /轮廓.*(?:承托|连接)|构造.*保留|保留.*构造/);
    check.doesNotMatch(request.requirements, /通过轮廓、承托与连接关系(?:的具体变化辨认新构造|辨认具体构造差异)|不能(?:只换材质|仅换材质)/);
    check.match(request.requirements, /布局图片|布局图/);
    check.equal(request.images[0].role, 'layout');
    check.match(result.prompt, /美人鱼.*TIDAL TREASURES.*贝壳.*海马/);
  }
});

test('a wrong assistant construction directive cannot override whole-form preservation or erase content mapping', () => {
  const { pipeline } = environment();
  const prompt = '换成深海主题，只做纯换皮，全图轮廓、承托与连接保持不变。' + contentMapping;
  const result = compile(pipeline, prompt, { directive: contentMapping + '。重新设计所有组件构造。改变全图轮廓和连接方式。' });
  check.equal(result.plan.visualMode, 'theme-redesign');
  check.match(result.prompt, /美人鱼.*TIDAL TREASURES.*第1行第1列换为贝壳.*第2行第2列换为海马/);
  check.doesNotMatch(result.prompt, /重新设计所有组件构造|改变全图轮廓和连接方式/);
  check.doesNotMatch(result.prompt, innovation);
  check.deepEqual(factClauses(result.plan.preserve), factClauses(sourceFacts));
});

test('pure reskin cannot bypass mandatory layout validation before planning or compiling', async () => {
  const { pipeline, assistant } = environment();
  const prompt = '纯换皮，所有造型保持不变';
  let calls = 0;
  check.throws(() => compile(pipeline, prompt, { references: [], uiPlan: null }), /必须有布局图/);
  check.throws(() => compile(pipeline, prompt, { references: [{ role: 'style' }, { role: 'asset' }], uiPlan: null }), /缺少布局图/);
  await check.rejects(assistant.run({ provider: 'local', engine: 'grok', targetEngine: 'qwen-2.1', sessionToken: 'test', prompt, references: [],
    electronAPI: { smartAiImageReverse: async () => { calls += 1; return { ok: true, prompt }; } },
  }), /必须有布局图/);
  check.equal(calls, 0);
});

test('reskin theme replacement retains construction and business data sharing an old-identity fact', () => {
  const { pipeline } = environment();
  const prompt = '换成深海主题，整体保形，人物和物品按新主题替换';
  const mixed = ['原人物身份保持不变，原主框矩形轮廓和连接保持不变，余额10,000和下注100保持不变', '15个符号的身份按目标主题替换'];
  const result = compile(pipeline, prompt, { directive: contentMapping, uiPlan: planFor([layout], { preserve: mixed }) });
  check.match(result.prompt, /原主框矩形轮廓和连接保持不变/);
  check.match(result.prompt, /余额10,000和下注100保持不变/);
  check.match(result.prompt, /15个符号的身份按目标主题替换/);
  check.doesNotMatch(result.prompt, /原人物身份保持不变/);
  check.doesNotMatch(result.prompt, innovation);
});

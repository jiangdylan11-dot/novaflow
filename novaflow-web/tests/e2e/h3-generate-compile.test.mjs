// The shipped bundle's H3 Generate path: 文生 / 图生 / 首尾帧 prompts go through the Smart AI
// overlay's compileH3ForGeneration before the graph is built, so H3 receives the official English
// base format instead of the editor's Chinese display. Runs the real bundle snippet, overlay,
// prompt workflow and shared format module in a VM with a fake local engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL('../../renderer/' + file, import.meta.url), 'utf8');
const bundle = read('assets/index-BbIa-2NM.js');
const I2V_LINE = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
const FL2V_LINE = 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 5.00-second mark of the target video.';
const english = (narrative) => `integrated_multimodal_description: [Shot 1] ${narrative}\n\noverall_soundscape: Platform ambience hums while her sleeve rustles.\n\nnon_diegetic_music: N/A`;
const display = (alignment, narrative) => `${alignment ? '【参考帧对齐】\n' + alignment + '\n\n' : ''}【画面与动作】\n【镜头 1】${narrative}\n\n【环境声音】\n站台环境声，衣袖摩擦声。\n\n【背景音乐】\n无`;

function h3Snippet() {
  const match = bundle.match(/if\(nfH3Mode\)\{(let nfH3Workflow=[\s\S]*?)\}else\{u=Cn\(/);
  assert.ok(match, 'the bundle keeps its H3 generate branch');
  return match[1];
}

// A page with the real overlay and workflows; the engine is a fake local prompt assistant.
function page({ engine, history } = {}) {
  const storage = new Map(history ? [['nf_text_history:ai_seq_prompt', JSON.stringify(history)]] : []);
  storage.set('novaflow.client.auth.session.v1', JSON.stringify({ session: { token: 'session-token' } }));
  const calls = { local: [], grok: [], built: [] };
  const context = vm.createContext({
    console, setTimeout, clearTimeout, URL, Blob,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    document: {
      readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => ({}), documentElement: {}, body: { getAttribute: () => '' },
    },
    MutationObserver: class { observe() {} },
    electronAPI: {
      async promptAssistantOptimizePrompt(payload) { calls.local.push(payload); return engine(payload); },
      async smartAiPromptOptimize(payload) { calls.grok.push(payload); return engine(payload, 'grok'); },
    },
    NovaFlowAiSequenceMiniMaxH3Workflow: { buildWorkflow: (params) => { calls.built.push(params); return { prompt: params.prompt }; } },
    NovaFlowAiSequenceMiniMaxH3Resource: { compileMentions: (text) => ({ text, invalidTokens: [] }) },
  });
  context.window = context;
  context.globalThis = context;
  for (const file of ['h3-prompt-format.js', 'ai-sequence-minimax-h3-prompt.workflow.js', 'novaflow-smart-ai.js']) vm.runInContext(read(file), context, { filename: file });
  const generate = vm.runInContext(`(async function(e,a,t,nfH3SubmitOptions,s,nfVideos,nfAudios,nfH3ValidatedLoras,d){let u;${h3Snippet()};return u})`, context);
  const jobs = [];
  const state = (frames = {}, token = 1) => ({
    aiSeqPrompt: '', aiSeqRunTokenRef: { current: token }, setAiSeqJob: (job) => jobs.push(job), ...frames,
  });
  const run = (mode, prompt, frames, options = {}) => {
    const e = state(frames);
    e.aiSeqPrompt = prompt;
    if (options.bumpTokenDuringCompile) {
      const original = context.__NovaFlowSmartAI.compileH3ForGeneration;
      context.__NovaFlowSmartAI.compileH3ForGeneration = async (request) => { const result = await original(request); e.aiSeqRunTokenRef.current += 1; return result; };
    }
    return generate(e, mode, 1, { durationSeconds: 5, profile: 'beta5_int8' }, ['frame.png'], [], [], [], 7);
  };
  return { context, calls, jobs, storage, run };
}

const frame = (name) => ({ fileName: name + '.png', type: 'image/png', dataUrl: 'data:image/png;base64,' + Buffer.from(name).toString('base64') });
const translate = (narrative) => (payload) => ({ ok: true, prompt: JSON.stringify({ modelPrompt: english(narrative), displayPrompt: payload.prompt }) });

test('the bundle compiles 文生 / 图生 / 首尾帧 prompts before building the graph, exactly once', () => {
  assert.equal(bundle.split('compileH3ForGeneration(').length - 1, 1);
  assert.equal(bundle.split('nfH3Prompt=nfH3Base.modelText}u=nfH3Workflow.buildWorkflow(').length - 1, 1);
  assert.match(bundle, /e\.setAiSeqJob\(\{state:`running`,message:`正在整理提示词…`\}\)/);
  // The patch stays on the bundle's one Generate line, whatever the checkout's line endings.
  const line = bundle.split(/\r?\n/).find((text) => text.includes('nfH3Base'));
  assert.ok(line && line.includes('compileH3ForGeneration(') && line.includes('nfH3Prompt=nfH3Base.modelText}'));
});

test('图生视频: the Chinese display is translated once and H3 receives the official English text', async () => {
  const p = page({ engine: translate('The girl shown in <Picture 1> turns toward the camera and waves. The camera holds a static shot.') });
  const prompt = display('@参考图 是视频第 0.00 秒的起始画面，完整参考。', '@参考图 中的少女缓慢转身，抬手挥动。镜头保持固定。');
  const built = await p.run('image_video', prompt, { aiSeqRefImage: frame('first') });
  assert.equal(built.prompt, I2V_LINE + '\n\n' + english('The girl shown in <Picture 1> turns toward the camera and waves. The camera holds a static shot.'));
  assert.equal(p.calls.built[0].mode, 'i2v');
  assert.deepEqual(Array.from(p.calls.built[0].images), ['frame.png']);
  assert.equal(p.calls.local.length, 1);
  const [request] = p.calls.local;
  assert.equal(request.h3Mode, 'image_video');
  assert.equal(request.purpose, 'minimax-h3-prompt-enhance');
  assert.match(request.requirements, /^H3 compile: translate-only$/m);
  assert.match(request.requirements, /^H3 response format: bilingual-v1$/m);
  assert.ok(request.requirements.endsWith('\nSource prompt:\n' + request.prompt));
  assert.equal(request.prompt, 'integrated_multimodal_description: [Shot 1] <Picture 1> 中的少女缓慢转身，抬手挥动。镜头保持固定。\n\noverall_soundscape: 站台环境声，衣袖摩擦声。\n\nnon_diegetic_music: N/A');
  assert.deepEqual(Array.from(request.h3ReferenceFrames), [], 'a translate-only compile sends no frames');
  assert.deepEqual(p.jobs.map((job) => job.message), ['正在整理提示词…']);
  // The same text reuses the translation on the next Generate, also with another picture.
  await p.run('image_video', prompt, { aiSeqRefImage: frame('second') });
  assert.equal(p.calls.local.length, 1);
  assert.equal(p.calls.built[1].prompt, built.prompt);
});

test('首尾帧视频 uses bare picture labels, 文生视频 has no alignment line, English and free text need no engine', async () => {
  const p = page({ engine: () => { throw new Error('no engine call expected'); } });
  const firstLast = await p.run('first_last', display('@首帧 对齐视频第 0.00 秒（开头）；@尾帧 对齐第 5.00 秒（结尾）。', 'The girl starts as @首帧 and sits down until she matches @尾帧. The camera holds a static shot.').replace('站台环境声，衣袖摩擦声。', 'Footsteps and a creaking bench.'), { aiSeqFirstFrame: frame('first'), aiSeqLastFrame: frame('last') });
  assert.equal(firstLast.prompt, FL2V_LINE + '\n\nintegrated_multimodal_description: [Shot 1] The girl starts as Picture 1 and sits down until she matches Picture 2. The camera holds a static shot.\n\noverall_soundscape: Footsteps and a creaking bench.\n\nnon_diegetic_music: N/A');
  const textVideo = await p.run('text_video', english('A cat leaps onto a bin. The camera holds a static shot.'), {});
  assert.equal(textVideo.prompt, english('A cat leaps onto a bin. The camera holds a static shot.'));
  const free = await p.run('image_video', '@参考图 里的少女转身挥手', { aiSeqRefImage: frame('first') });
  assert.equal(free.prompt, '<Picture 1> 里的少女转身挥手');
  assert.equal(p.calls.local.length, 0);
});

test('a missing local H3 compiler does not call the cloud, an old engine still generates with the prompt as written, a newer run discards the result', async () => {
  const web = page({ engine: (payload, route) => route === 'grok' ? translate('The girl shown in <Picture 1> waves. The camera holds a static shot.')(payload) : { ok: false, error: '提示词助手在 Web 版通过智能 AI 提供' } });
  const prompt = display('', '@参考图 中的少女挥手。镜头保持固定。');
  await assert.rejects(() => web.run('image_video', prompt, { aiSeqRefImage: frame('web') }), /本机 H3 提示词编译不可用/);
  assert.equal(web.calls.local.length, 1);
  assert.equal(web.calls.grok.length, 0);
  assert.equal(web.calls.built.length, 0);

  const old = page({ engine: () => ({ ok: true, prompt: '【任务定位】\n图生视频，时长5秒。' }) });
  // Generation never fails because of the prompt: without the translate step it goes out as written.
  const sentOld = await old.run('image_video', prompt, { aiSeqRefImage: frame('old') });
  assert.equal(old.calls.built.length, 1);
  assert.match(sentOld.prompt, /<Picture 1> 中的少女挥手/);
  assert.doesNotMatch(sentOld.prompt, /@参考图|【任务定位】/);

  const stale = page({ engine: translate('The girl shown in <Picture 1> waves. The camera holds a static shot.') });
  assert.equal(await stale.run('image_video', prompt, { aiSeqRefImage: frame('stale') }, { bumpTokenDuringCompile: true }), undefined);
  assert.equal(stale.calls.built.length, 0);
});

test('prompt history saved in five sections opens as the new display before the bundle reads it', () => {
  const legacy = '【任务定位】\n图生视频，时长5秒。<Picture 1> 为起始首帧。\n\n【说话者】\n无说话者\n\n【递进式详细提示词】\n少女站在站台上，镜头固定。\n\n0-2.5s：她缓慢转身。\n\n2.5-5s：她抬手挥动。\n\n【台词】\n无台词\n\n【连续性与约束】\n1. 环境与动作声音：站台环境声\n2. 配乐：N/A';
  const p = page({ engine: () => ({ ok: false }), history: { recent: [{ text: legacy, at: 5 }, { text: '普通提示词', at: 6 }], pinnedSlots: [null, null, null, null, null] } });
  const history = JSON.parse(p.storage.get('nf_text_history:ai_seq_prompt'));
  assert.equal(history.recent[0].text, '【参考帧对齐】\n@参考图 是视频第 0.00 秒的起始画面，完整参考。\n\n【画面与动作】\n【镜头 1】少女站在站台上，镜头固定。她缓慢转身。她抬手挥动。\n\n【环境声音】\n站台环境声\n\n【背景音乐】\n无');
  assert.equal(history.recent[1].text, '普通提示词');
  // The overlay is a classic script after the format module; the bundle is a deferred module.
  const index = read('index.html');
  assert.ok(index.indexOf('./h3-prompt-format.js') < index.indexOf('./novaflow-smart-ai.js'));
  assert.match(index, /<script type="module" crossorigin src="\.\/assets\/index-BbIa-2NM\.js/);
  assert.doesNotMatch(index, /<script[^>]*(?:defer|async|type="module")[^>]*novaflow-smart-ai\.js/);
});

test('any prompt generates: a 多参 display in 图生视频 or free text with an engine error goes out as written', async () => {
  // The prompt a user saw fail with 「提示词需要画面与动作、环境声音和背景音乐三个字段」 (2026-09-28).
  const multi = '【主体定义】\n<主体 1>：@参考图1 中的少女，黑色短发，橙色衬衫。\n\n【任务说明】\n[参考生成] <主体 1> 沿公路走来。\n\n【保留规则】\n<主体 1>: 完全保留 - 发型与服装。\n\n【画面与动作】\n【镜头 1】<主体 1> 沿公路走向镜头。\n\n【环境声音】\n风声。\n\n【背景音乐】\n无';
  const quiet = page({ engine: () => { throw new Error('no engine call expected'); } });
  const built = await quiet.run('image_video', multi, { aiSeqRefImage: frame('multi') });
  assert.equal(quiet.calls.built.length, 1);
  assert.match(built.prompt, /【主体定义】/);
  const failing = page({ engine: () => ({ ok: false, error: 'engine offline' }) });
  const sent = await failing.run('image_video', display('', '@参考图 中的少女挥手。镜头保持固定。'), { aiSeqRefImage: frame('offline') });
  assert.equal(failing.calls.built.length, 1);
  assert.match(sent.prompt, /<Picture 1> 中的少女挥手/);
});

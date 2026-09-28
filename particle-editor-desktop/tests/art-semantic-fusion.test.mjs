import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildGrokPromptOptimizeRequest, buildGrokImageReverseRequest, grokResponsesPublicResult, callGrokResponseWithVisualRetry} from '../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs';
// A Windows checkout (core.autocrlf) gives the fixture CRLF line ends; the prompts are LF.
const source = fs.readFileSync(new URL('./fixtures/art-reverse-outdoor-fusion.txt',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const instruction = '增加室外背景，提升画面质量和精美度。增加人物细节';
const good = source.split('\n[用户附加要求]')[0].trim()
  .replace('纯白色背景，无其他物体，前景无遮挡，中景主体站立，后景无层次','室外花园，前景花草与石径引导视线，中景主体站立，后景绿树与天空形成空间层次')
  .replace('一名成年女性，','一名成年女性，五官柔和清晰，指尖轮廓自然，银色花冠花瓣有细小雕纹，')
  .replace('背景完全虚化浅景深','背景适度柔化，保留花园层次');
for (const requirements of [instruction,'用户本次修改要求（最高优先级）：'+instruction,'']) {
  const request = buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:source,requirements,supportsNegativePrompt:false},'grok-contract-test');
  assert.equal(request.resultOptions.artSemanticFusion,true);
  assert.equal(request.resultOptions.requirements,instruction);
  assert.ok(!request.resultOptions.originalPrompt.includes('[用户附加要求]'));
  const result = text=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:text})},request.resultOptions);
  assert.equal(result(good).output_text,good);
  const standing = good.replace('主体站立','主体站在花园中');
  assert.equal(result(standing).output_text,standing);
  const blur = good.replace('背景适度柔化，保留花园层次','背景完全虚化浅景深');
  assert.ok(!result(blur).output_text.includes('完全虚化'));
  assert.throws(()=>result(source),/融合未完成/);
  assert.throws(()=>result(request.resultOptions.originalPrompt),/未实际融合/);
  assert.throws(()=>result(good.replace('室外花园，前景花草与石径引导视线，中景主体站立，后景绿树与天空形成空间层次','纯白色背景，前景有草地，后景树木丰富')),/冲突/);
  assert.throws(()=>result(good.replace('五官柔和清晰，指尖轮廓自然，银色花冠花瓣有细小雕纹，','')),/主体物品/);
  assert.throws(()=>result(good.replace('[光线与色彩]','[新光线]')),/缺少原段落/);
}
// An empty requirement box is still a request: enrich the draft, never echo it back.
const plain = source.split('\n[用户附加要求]')[0].trim();
const editorPreamble = '提示词编辑模式：以 prompt / currentPrompt 中的完整原提示词为语义底稿，先分析原画面设定。';
const auto = buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:plain,requirements:editorPreamble,supportsNegativePrompt:false},'grok-contract-test');
assert.equal(auto.resultOptions.artSemanticFusion,true);
assert.equal(auto.resultOptions.requirements,'');
assert.ok(auto.body.input.at(-1).content[0].text.includes('没有额外修改要求'),'no-instruction runs must carry the enrichment brief');
const autoResult = text=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:text})},auto.resultOptions);
const enriched = plain.replace('一名成年女性，','一名成年女性，五官柔和清晰，指尖轮廓自然，银色花冠花瓣有细小雕纹，');
assert.equal(autoResult(enriched).output_text,enriched);
assert.throws(()=>autoResult(plain),/未补足视觉细节/,'an unchanged draft must not pass as an optimization');
assert.throws(()=>autoResult(plain+'，画面更加精美，整体更丰富'),/仅追加泛化质量词/);
try { autoResult(plain); assert.fail('expected failure'); } catch (error) {
  assert.equal(error.artSemanticFusionFailed,true,'a fusion failure must be repairable by one retry');
  assert.equal(error.artSemanticFusionReason,'未补足视觉细节');
}
// A draft with no layout of its own is normalized to the five-section layout
// that single-image reverse already produces.
const proseDraft = '一个机器人站在台阶上，机器人的风格要和图2一样，整体图2做完背景保持不变。';
const proseReq = buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:proseDraft,requirements:'提示词编辑模式：以底稿为准。',supportsNegativePrompt:false},'grok-contract-test');
assert.equal(proseReq.resultOptions.artFiveSectionPrompt,true);
const proseText = proseReq.body.input.at(-1).content[0].text;
assert.ok(proseText.includes('五个且仅五个'),'a layout-less draft must carry the five-section rule');
assert.ok(proseText.includes('版式化不得改变语义'),'rewording is allowed, meaning loss is not');
const laidOut = [
  '[风格设定]','机器人的风格要和图2一样，手绘渲染语言，暖调氛围，完成质感细腻。',
  '[主体物品]','一个机器人站在台阶上，金属躯干与铆钉接缝，站姿稳健，青铜与青绿色材质。',
  '[环境背景]','整体图2做完背景保持不变，台阶为承托面，前景花瓣，后景形成空间层次。',
  '[光线与色彩]','左上方自然光，轮廓光柔和，青绿与暖黄为主辅色。',
  '[拍摄参数]','中景全身，略低视角，中心构图，标准透视，浅景深。'
].join('\n');
const proseResult = text=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:text})},proseReq.resultOptions);
assert.equal(proseResult(laidOut).output_text,laidOut);
for (const [why,bad] of [
  ['仍是散文',proseDraft+'，材质细腻，光影过渡自然。'],
  ['改了段名',laidOut.replace('[拍摄参数]','[镜头]')],
  ['多了前言','以下是结果：\n'+laidOut]
]) {
  assert.throws(()=>proseResult(bad),/未按五个固定分段输出|五段正文前有多余内容/,why);
  try { proseResult(bad); } catch (error) {
    assert.equal(error.artSemanticFusionFailed,true,why+' must be repairable by one retry');
  }
}

// Multi-reference reverse answers in the same layout as single-image reverse.
const refImage = {dataUrl:'data:image/png;base64,AA=='};
const roleReverse = buildGrokImageReverseRequest({
  images:[{...refImage,role:'subject'},{...refImage,dataUrl:'data:image/png;base64,AQ==',role:'background'}],
  scenario:'role_reference'
},'grok-contract-test');
assert.equal(roleReverse.resultOptions.artFiveSectionPrompt,true);
assert.ok(roleReverse.body.input[0].content.at(-1).text.includes('五个且仅五个'),'multi-reference reverse must request the five-section layout');
const roleResult = text=>grokResponsesPublicResult({output_text:JSON.stringify({prompt:text})},roleReverse.resultOptions);
assert.equal(roleResult(laidOut).output_text,laidOut);
assert.throws(()=>roleResult('一台机器人站在台阶上，背景是雪山。'),/未按五个固定分段输出/);
const cloud=fs.readFileSync(new URL('../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs',import.meta.url),'utf8');
const desktop=fs.readFileSync(new URL('../admin-server/server.js',import.meta.url),'utf8');
const fusionCode = text=>text.slice(text.indexOf('const ART_SEMANTIC_FUSION_RULES'),text.indexOf('function buildGrokPromptOptimizeRequest('));
assert.equal(fusionCode(cloud),fusionCode(desktop),'desktop and hosted Grok must use the identical fusion contract');
// Every 美工 answer in the five sections carries one brief: one consistent picture in full sentences, lights that exist in the
// scene, creative detail inside the framework of the user. No rule forbids fitting detail any more.
const briefTexts = [proseText, auto.body.input.at(-1).content[0].text, roleReverse.body.input[0].content.at(-1).text];
for (const text of briefTexts) {
  assert.ok(text.includes('像美术总监给画师的简报') && text.includes('光源只能是[环境背景]里已经写出的那些'), 'every five-section answer carries the brief');
  assert.doesNotMatch(text, /不得新增底稿没有的事实|禁止新增底稿没有的人物、道具或场景|不虚构图中没有的光源/, 'no rule forbids fitting detail');
  // Natural light needs its sun or moon in the scene, feet mean a full shot, and the brief ends with a consistency check.
  assert.ok(text.includes('那里没写月亮就不写月光') && text.includes('中景以内不写脚和鞋') && text.includes('输出前逐项核对并改正'), 'the sections are checked against each other');
}
assert.ok(roleReverse.body.input[0].content.at(-1).text.includes('用户写的姿势或位置取代主体图原有的姿势'), 'a requested pose replaces the reference pose');
// The pictures stay the ground truth: every fixture of the background picture is counted, in-between colours stay mixed, and the
// venue is named only from what its fixtures show. The brief samples closer to the pictures and has room to reason.
assert.ok(['先逐一清点看得见的结构、陈设、灯具和材质', '介于两色之间的写成混合色', '场所类型只按看得见的陈设判断'].every((rule) => roleReverse.body.input[0].content.at(-1).text.includes(rule)), 'the background picture is read fixture by fixture');
assert.equal(roleReverse.body.temperature, 0.45);
assert.equal(roleReverse.body.max_output_tokens, 3072);
assert.ok(!buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:'[画面]\n一只猫趴在沙发上\n[镜头]\n中景平视',requirements:'提示词编辑模式：以底稿为准。',supportsNegativePrompt:false},'grok-contract-test').body.input.at(-1).content[0].text.includes('像美术总监给画师的简报'), 'a layout of its own gets no five-section brief');
const styleReverse = buildGrokImageReverseRequest({images:[{...refImage,role:'subject'},{...refImage,dataUrl:'data:image/png;base64,AQ==',role:'style'}],scenario:'role_reference'},'grok-contract-test');
assert.ok(styleReverse.body.input[0].content.at(-1).text.includes('风格迁移：画面内容只来自图1'), 'a style transfer keeps its content lock under the brief');
// A negative lists visible defects: a deviation or mix-up phrase goes, everything else is written as the model wrote it.
const roleNegative = negative => grokResponsesPublicResult({output_text:JSON.stringify({prompt:laidOut,negative_prompt:negative})},roleReverse.resultOptions).negative_prompt;
assert.equal(roleNegative('画面模糊, 卡通风格偏差, 背景元素混入主体, 手部畸形'),'画面模糊，手部畸形');
assert.equal(roleNegative('画面模糊、手部畸形、塑料质感'),'画面模糊、手部畸形、塑料质感');
// An absence, a change or a negation would put the requested content into the negative channel; real defects stay.
assert.equal(roleNegative('画面模糊，灯笼不发光，夜晚变白天，阴影缺失，缺少背包，改变动作，椅子不稳，窗外场景矛盾，人物变形，左右不对称，光影不自然，色彩渐变断层'),'画面模糊，人物变形，左右不对称，光影不自然，色彩渐变断层');
assert.equal(roleNegative('手部畸形 面部扭曲 椅子不稳 光源方向错误'),'手部畸形，面部扭曲，光源方向错误');
// A section title written in front of its text is a right layout on the wrong line: it is moved, no repair call is spent.
assert.equal(roleResult(laidOut.replace(/\]\n/g, '] ')).output_text, laidOut);
// The repair is a second call: a prompt optimize reserves one, so its fusion failure is final; an image action reserves two.
for (const [budget, expected] of [[1, 1], [2, 2]]) {
  let calls = 0;
  await assert.rejects(callGrokResponseWithVisualRetry(proseReq.body, proseReq.inputMeta, {...proseReq.resultOptions, providerCallBudget: budget}, async () => {
    calls += 1;
    return {ok: true, providerCallCount: 1, data: proseResult(proseDraft + '，材质细腻。')};
  }), /未按五个固定分段输出/);
  assert.equal(calls, expected, 'repair calls stay within the reserved budget ' + budget);
}
console.log('Semantic fusion: all requirements applied, conflict/copy/partial edits rejected, legacy carrier repaired, Grok routes identical');

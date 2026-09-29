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
// A white-background asset (this fixture) keeps its backdrop when the box is empty: the enrich brief and the craft rule both say so.
assert.ok(auto.body.input.at(-1).content[0].text.includes('底稿是纯色、白底或透明背景时保留该背景'), 'the empty-box enrich keeps a plain backdrop');
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
  // A plain-background single asset (a white-background draft, subject picture or request) keeps its backdrop and gets studio light.
  assert.ok(text.includes('纯色、白底或透明背景的单体素材') && text.includes('不补场景陈设') && text.includes('影棚式主光与辅光'), 'a plain backdrop is not turned into a scene');
  // ... unless a background picture is attached: then its fixtures are written.
  assert.ok(text.includes('（没有背景参考图，且底稿或主体图就是这样且用户没要求换背景，或用户要求这类背景）'), 'a background picture outranks the plain backdrop');
  // The model adds no empty quality words, and the ones the draft or the user already wrote stay.
  assert.ok(text.includes('不自行添加高质量、完成质感、细腻渲染、精美、细节丰富等空泛质量词（底稿或用户原文已写的照留在[风格设定]）') && text.includes('底稿或用户原文已写的质量词原样照抄进这一段，没写的不加'), 'quality words already written stay');
  assert.doesNotMatch(text, /不写高质量、完成质感/, 'no rule deletes the quality words of the draft');
}
assert.ok(roleReverse.body.input[0].content.at(-1).text.includes('用户写的姿势取代主体图原有的姿势') && roleReverse.body.input[0].content.at(-1).text.includes('只写位置、朝向或视线且没有姿势参考图时保留主体图的姿势'), 'a requested pose replaces the reference pose; a position alone keeps it unless a pose picture gives one');
assert.doesNotMatch(roleReverse.body.input[0].content.at(-1).text, /只写位置、朝向或视线时保留主体图的姿势/, 'a pose picture is never overruled by the subject picture');
assert.doesNotMatch(roleReverse.body.input[0].content.at(-1).text, /姿势或位置取代/, 'a position is not a pose');
// The pictures stay the ground truth: every fixture of the background picture is counted, in-between colours stay mixed, and the
// venue is named only from what its fixtures show. The one call also grades the pictures' contentSafety, so it samples as close to
// the pictures as every other reverse (0.35, as before round 4) and has room to reason.
assert.ok(['先逐一清点看得见的结构、陈设、灯具和材质', '介于两色之间的写成混合色', '场所类型只按看得见的陈设判断'].every((rule) => roleReverse.body.input[0].content.at(-1).text.includes(rule)), 'the background picture is read fixture by fixture');
assert.equal(roleReverse.body.temperature, 0.35);
assert.equal(roleReverse.body.max_output_tokens, 3072);
assert.ok(!buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:'[画面]\n一只猫趴在沙发上\n[镜头]\n中景平视',requirements:'提示词编辑模式：以底稿为准。',supportsNegativePrompt:false},'grok-contract-test').body.input.at(-1).content[0].text.includes('像美术总监给画师的简报'), 'a layout of its own gets no five-section brief');
const styleReverse = buildGrokImageReverseRequest({images:[{...refImage,role:'subject'},{...refImage,dataUrl:'data:image/png;base64,AQ==',role:'style'}],scenario:'role_reference'},'grok-contract-test');
assert.ok(styleReverse.body.input[0].content.at(-1).text.includes('风格迁移：画面内容只来自图1') && styleReverse.body.input[0].content.at(-1).text.includes('不凑“至少五样”'), 'a style transfer keeps its content lock under the brief');
assert.equal(styleReverse.body.temperature, 0.35);
// A negative lists visible defects: a deviation or mix-up phrase goes, everything else is written as the model wrote it.
const roleNegative = negative => grokResponsesPublicResult({output_text:JSON.stringify({prompt:laidOut,negative_prompt:negative})},roleReverse.resultOptions).negative_prompt;
assert.equal(roleNegative('画面模糊, 卡通风格偏差, 背景元素混入主体, 手部畸形'),'画面模糊，手部畸形');
assert.equal(roleNegative('画面模糊、手部畸形、塑料质感'),'画面模糊、手部畸形、塑料质感');
// An absence, a change or a negation would put the requested content into the negative channel; real defects stay.
assert.equal(roleNegative('画面模糊，灯笼不发光，夜晚变白天，阴影缺失，缺少背包，改变动作，椅子不稳，窗外场景矛盾，人物变形，左右不对称，光影不自然，色彩渐变断层'),'画面模糊，人物变形，左右不对称，光影不自然，色彩渐变断层');
assert.equal(roleNegative('手部畸形 面部扭曲 椅子不稳 光源方向错误'),'手部畸形，面部扭曲，光源方向错误');
// A deviation of the content goes (冷色调偏差, 服装颜色偏差); a visible defect named with 偏差 or 混入 stays.
assert.equal(roleNegative('画面模糊，色彩偏差，比例偏差，文字水印混入，杂物混入画面，冷色调偏差，服装颜色偏差，手部畸形'),'画面模糊，色彩偏差，比例偏差，文字水印混入，杂物混入画面，手部畸形');
// Every term the user wrote in the negative box stays, in the fusion and in the role reference.
const catFive = ['[风格设定]','写实摄影风格，自然光质感。画面氛围温暖慵懒。','[主体物品]','一只橘猫趴在窗台上晒太阳，橘色短毛泛着光泽，眼睛眯成一条缝。它的前爪交叠压在木质窗台边缘，尾巴垂在窗沿外侧。','[环境背景]','室内窗边，木质窗台上摆着一盆绿萝。窗外是绿树和蓝天，半卷的米色窗帘垂在一侧。','[光线与色彩]','午后阳光从窗外斜射，落在猫背上。主色为橘色与米色，绿萝的绿色作点缀。','[拍摄参数]','中景，平视角度，三分法构图。深景深，窗外树影清晰。'].join('\n');
const userNegFusion = buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:'一只橘猫趴在窗台上晒太阳',requirements:'',negativePrompt:'模糊，色彩偏差，透视偏差，缺少尾巴，水印',supportsNegativePrompt:true},'grok-contract-test');
assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt:catFive,negative_prompt:'模糊，色彩偏差，透视偏差，缺少尾巴，水印，阴影缺失，风格偏差，手部畸形'})},userNegFusion.resultOptions).negative_prompt,'模糊，色彩偏差，透视偏差，缺少尾巴，水印，手部畸形');
const userNegRole = buildGrokImageReverseRequest({images:[{...refImage,role:'subject'},{...refImage,dataUrl:'data:image/png;base64,AQ==',role:'background'}],scenario:'role_reference',supportsNegativePrompt:true,negativePrompt:'风格偏差，改变动作'},'grok-contract-test');
assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt:laidOut,negative_prompt:'画面模糊，风格偏差，改变动作，阴影缺失'})},userNegRole.resultOptions).negative_prompt,'画面模糊，风格偏差，改变动作');
// Every term found in the user's own text stays: one asked for in the request, or a negative box separated by 。 or /.
const reqNegRole = buildGrokImageReverseRequest({images:[{...refImage,role:'subject'},{...refImage,dataUrl:'data:image/png;base64,AQ==',role:'background'}],scenario:'role_reference',supportsNegativePrompt:true,requirements:'用户生成要求：图1的角色站在图2场景中央；反向提示词加上阴影缺失、灯笼不发光'},'grok-contract-test');
assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt:laidOut,negative_prompt:'画面模糊，阴影缺失，灯笼不发光，夜晚变白天'})},reqNegRole.resultOptions).negative_prompt,'画面模糊，阴影缺失，灯笼不发光');
for (const negativePrompt of ['不要水印。不要文字。阴影缺失。', '不要水印/不要文字/阴影缺失']) {
  const boxNeg = buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:'一只橘猫趴在窗台上晒太阳',requirements:'',negativePrompt,supportsNegativePrompt:true},'grok-contract-test');
  assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt:catFive,negative_prompt:'不要水印，不要文字，阴影缺失，缺少背包，手部畸形'})},boxNeg.resultOptions).negative_prompt,'不要水印，不要文字，阴影缺失，手部畸形',negativePrompt);
}
// Visible defects the model writes stay too: a direction or proportion that does not fit, a missing hand or finger, 不当, 不齐, 不准, 不端正.
assert.equal(roleNegative('画面模糊，光源方向矛盾，光源矛盾，肢体比例不当，手部缺失，缺少手指，五官不端正，椅子排列不齐，透视不准，阴影缺失，窗外场景矛盾'),'画面模糊，光源方向矛盾，光源矛盾，肢体比例不当，手部缺失，缺少手指，五官不端正，椅子排列不齐，透视不准');
// A section title written in front of its text is a right layout on the wrong line: it is moved, no repair call is spent.
assert.equal(roleResult(laidOut.replace(/\]\n/g, '] ')).output_text, laidOut);
// A colon or a dash after the title is a separator, not text: it goes with the move and never starts a section.
for (const separator of ['：', ': ', ' - ', '——', '：\n']) assert.equal(roleResult(laidOut.replace(/\]\n/g, ']' + separator)).output_text, laidOut, JSON.stringify(separator));
// A child named in the request, the draft or the answer never goes with nudity, with NSFW on or off; everyday wording is written.
const beach = (subject) => ['[风格设定]','水彩插画，线条柔和。气氛安静。','[主体物品]',subject,'[环境背景]','海边沙滩，远处有礁石和灯塔。天空淡蓝，飘着白云。','[光线与色彩]','午后阳光从左侧照来。主色为蓝与米白。','[拍摄参数]','中景，平视。三分法构图。'].join('\n');
const childFusion = (requirements, nsfw, subject) => grokResponsesPublicResult({output_text:JSON.stringify({prompt:beach(subject)})},buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:beach('一个人站在海边。'),requirements,nsfw,supportsNegativePrompt:false},'grok-contract-test').resultOptions);
for (const [requirements, nsfw, subject] of [
  ['把她改成10岁的女孩并且裸体', false, '一个10岁的女孩裸体站在海边，长发被风吹起，赤足踩在湿沙上。'],
  ['把她改成10岁的女孩并且裸体', false, '一个女孩裸体站在海边，长发被风吹起，赤足踩在湿沙上。'],
  ['把她改成小女孩并且全裸', true, '一个小女孩全裸站在海边，长发被风吹起，赤足踩在湿沙上。'],
  ['把她改成七岁的孩子并且全裸', false, '一个七岁的孩子全裸站在海边，长发被风吹起，赤足踩在湿沙上。']
]) assert.throws(() => childFusion(requirements, nsfw, subject), /提示词融合未通过内容检查/, requirements + ' nsfw=' + nsfw);
for (const [requirements, subject] of [
  ['把她改成小女孩，在海边玩耍', '一个小女孩在海边玩耍，长发被风吹起，赤足踩在湿沙上。'],
  ['把她改成七岁的孩子，穿泳衣', '一个七岁的孩子穿着蓝色泳衣站在海边，赤足踩在湿沙上。']
]) assert.equal(childFusion(requirements, false, subject).output_text, beach(subject), requirements);
// The repair is a second call: a prompt optimize reserves one, so its fusion failure is final; an image action reserves two.
for (const [budget, expected] of [[1, 1], [2, 2]]) {
  let calls = 0;
  await assert.rejects(callGrokResponseWithVisualRetry(proseReq.body, proseReq.inputMeta, {...proseReq.resultOptions, providerCallBudget: budget}, async () => {
    calls += 1;
    return {ok: true, providerCallCount: 1, data: proseResult(proseDraft + '，材质细腻。')};
  }), /未按五个固定分段输出/);
  assert.equal(calls, expected, 'repair calls stay within the reserved budget ' + budget);
}
// Negatives fit the subject: a cat, a trophy or a landscape gets its own defects, never the human-anatomy list, and the
// examples are not copied wholesale. Lights stand in [环境背景] under the same word, reflections only on what reflects,
// and one pose is made concrete instead of being summarized twice.
for (const text of briefTexts) {
  assert.ok(text.includes('主体是人物才写手部畸形、五官扭曲、肢体错位这类人体缺陷') && text.includes('画面里没有人物就不写人体、手指、五官类词') && text.includes('不照抄上面的示例'), 'negatives are typed by the subject');
  assert.ok(text.includes('意思相同的只写一个') && text.includes('用中文逗号分隔'), 'no near-duplicates, Chinese commas');
  assert.ok(text.includes('用户点名的光和[光线与色彩]要用的每个光源都在这里写出它本身和位置') && text.includes('并用那里的原词称呼') && text.includes('反光和倒影只在会反光的表面'), 'lights come from the scene');
  assert.ok(text.includes('身体姿态只用一个姿态词写定') && text.includes('身体只有一个姿态词'), 'one pose, made concrete and checked');
  assert.doesNotMatch(text, /需要包含画面模糊、低清晰度、人物变形/, 'no picture is asked for human-anatomy negatives by default');
}
assert.ok(roleReverse.body.input[0].content.at(-1).text.includes('画面里没有人物时不写人体、手指、五官类词'), 'the generic image negative is typed too');
assert.ok(roleReverse.body.input[0].content.at(-1).text.includes('形状照图写') && roleReverse.body.input[0].content.at(-1).text.includes('每件陈设和灯具写在它在图中的位置') && roleReverse.body.input[0].content.at(-1).text.includes('不加图中没有的窗户、天窗和灯具'), 'shapes, positions and lamps are read off the picture');
// A negative the model separated with ASCII commas is written with Chinese commas; other separators stay as written.
assert.equal(roleNegative('画面模糊,低清晰度, 手部畸形'), '画面模糊，低清晰度，手部畸形');
assert.equal(roleNegative('画面模糊、手部畸形、塑料质感'), '画面模糊、手部畸形、塑料质感');
// Round-5 review: a lamp in the hand is written by the hand (a figure facing us has its left hand on picture right), lights
// high on both sides fall in slanting, the fill light has a source too, a named light colour decides the key light while fire
// stays warm, the sky examples carry a position and no quotable moon, and the final check names the recurring slips.
for (const text of briefTexts) {
  assert.ok(text.includes('主体手里拿着的灯不换算成画面方位，只按手写') && text.includes('面向画面的人物，右手在画面左侧') && text.includes('手里拿着的灯按手写'), 'a hand-held lamp is written by the hand');
  assert.ok(text.includes('方向照抄这个光源在[环境背景]里写的位置（那里写“两侧高处的灯架”，这里就写“从两侧高处斜照”，不改成正上方）') && text.includes('主光方向照抄它在那里的位置') && text.includes('辅光也来自[环境背景]写出的东西或天光'), 'side lights and fill lights');
  assert.ok(text.includes('要冷色调灯光时，写明冷色的灯罩（如淡蓝纱罩的灯笼、青白琉璃灯，不只写“冷色灯笼”），由它透出冷光') && text.includes('手里的东西在各段是同一只手') && text.includes('不加不合年代的路灯、街灯，火光只作暖色点缀') && text.includes('火光始终写成暖色（冷色灯罩透出的光除外）'), 'a named light colour and warm fire do not conflict');
  assert.doesNotMatch(text, /雪夜云隙间的一轮冷月|用户要冷色调时在这里写出冷光的来源|纸面颗粒/, 'no quotable moon, no texture in the style example');
  assert.ok(text.includes('户外一定写一句天空的样子，日月写明在画面哪个方位（不写东南西北）') && text.includes('也不因此少于五样') && text.includes('不写“夜晚氛围”'), 'sky with a position, five things, no time in the mood');
  assert.ok(['户外写了天空', '景深句只说前景、中景和主体清晰', '中景以内没写脚和鞋', '全文没有“营造”“保持”“突出”“时间为”', '木面、路面、地毯、布料、泥土不反光'].every((item) => text.includes(item)), 'the final check names the recurring slips');
  assert.ok(text.includes('夜景和舞台不写欠曝、过暗') && text.includes('除纯色背景外不写背景杂乱、背景复杂'), 'negatives do not push away a dark stage or a furnished hall');
  // The box also holds earlier answers and the guard: it counts toward the list, and a full box only gets terms for what is new.
  assert.ok(text.includes('负面框里已有的项（原负向提示词、当前负面 Prompt）算在这 12 至 18 项里，也不受上面按主体选词的限制；框里已有 12 项以上时，只为这次新增或改动的内容补写。'), 'the box counts toward the list');
  assert.doesNotMatch(text, /都原样保留，不计入 12 至 18 项|身后书架上的书脊也清晰可辨|柴犬坐在门口/, 'no growing box, no far-ground depth example, no test subject as the pose example');
  assert.ok(text.includes('深景深让前景的藤椅扶手和老人膝头的相册都清晰。') && text.includes('松鼠立在树桩上，前爪捧着一颗松果，尾巴贴着后背竖起'), 'the depth example names the near ground');
}
// A negative box goes to the model whole, with the rule that keeps its terms except those that contradict the new picture
// (a style changed to cel shading drops the guard's 粗黑描边), on every 美工 text request that has a box: the five-section and
// own-layout optimize, and create.
const KEEP_BOX = '已有的项照原样保留';
const DROP_CONTRADICTING = '只删去与';
const longUserNegative = '多余手指，畸形手指，五官扭曲，模糊，噪点，水印，文字，低质量，过曝，欠曝，色彩断层，透视错误，结构粘连，比例失调，塑料质感，脏色，锯齿，重影，低清晰度，构图拥挤';
const castleFive = ['[风格设定]','写实风景插画，笔触细腻。气氛庄严肃穆。','[主体物品]','一座古堡矗立在悬崖上，灰色石墙爬满青苔。三座塔楼的尖顶覆着深蓝瓦片，城垛上插着褪色的旗帜。','[环境背景]','悬崖下是翻涌的海浪和黑色礁石。天空飘着灰云，画面右上方有西沉的夕阳。','[光线与色彩]','夕阳从画面右上方斜照在塔楼上。主色为灰蓝，点缀橙色。','[拍摄参数]','远景，低角度仰拍。古堡位于三分线上。'].join('\n');
const longNegFusion = buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:'一座古堡矗立在悬崖上',requirements:'',negativePrompt:longUserNegative,supportsNegativePrompt:true},'grok-contract-test');
for (const request of [longNegFusion,
  buildGrokPromptOptimizeRequest({surface:'art',purpose:'optimize',prompt:'[角色]\n一只橘猫趴在窗台上。\n[场景]\n午后的窗台。',requirements:'',negativePrompt:longUserNegative,supportsNegativePrompt:true},'grok-contract-test'),
  buildGrokPromptOptimizeRequest({surface:'art',purpose:'create',prompt:'',requirements:'一只橘猫趴在窗台上晒太阳',negativePrompt:longUserNegative,supportsNegativePrompt:true},'grok-contract-test')]) {
  const sent = JSON.stringify(request.body.input);
  assert.ok(sent.includes(longUserNegative) && sent.includes(KEEP_BOX) && sent.includes(DROP_CONTRADICTING) && sent.includes('新写的项不与已有的重复') && sent.includes('扁平赛璐璐'), 'the box is sent whole with the keep rule');
}
assert.ok(roleReverse.body.input[0].content.at(-1).text.includes('当前负面 Prompt 里已有的项照原样保留，不受按主体选词的限制'), 'the reference route keeps the box too');
assert.equal(grokResponsesPublicResult({output_text:JSON.stringify({prompt:castleFive,negative_prompt:longUserNegative + '，城墙砖块错位'})},longNegFusion.resultOptions).negative_prompt,longUserNegative + '，城墙砖块错位');
assert.ok(roleReverse.body.input[0].content.at(-1).text.includes('把用户原文里的主体称呼（连同图号）和写主体动作') && roleReverse.body.input[0].content.at(-1).text.includes('秀场中间的 runway 是T台') && roleReverse.body.input[0].content.at(-1).text.includes('地面层的灯不写到顶层或天花板'), 'the subject keeps the user\'s name and label, the venue its own words');
console.log('Semantic fusion: all requirements applied, conflict/copy/partial edits rejected, legacy carrier repaired, Grok routes identical');

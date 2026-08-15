const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourcePath = path.join(__dirname, "..", "..", "particle-editor", "novaflow-smart-ai.js");
const source = fs.readFileSync(sourcePath, "utf8");

assert.doesNotMatch(source, /ART_QUALITY_PRESETS|data-smart-ai-quality|qualityGoals/);
assert.doesNotMatch(source, /\["custom",\s*"自定义"/);
assert.doesNotMatch(source, /\["texture",\s*"增强质感"/);
assert.match(source, /\["preserve",\s*"保持原图，提升质量"\]/);
assert.match(source, /function artAutomaticQualityInstruction\(\)/);
assert.match(source, /人物增强面部、眼睛、头发、皮肤、人体结构和原图已有材质的可信细节/);
assert.match(source, /不主动新增穿着或装饰内容/);
assert.doesNotMatch(source, /完整服装结构/);
assert.match(source, /物体和道具增强金属、木材、皮革、玻璃、布料等材质差异与结构质感/);
assert.match(source, /二次元、Q版和厚涂保持原有绘画语言/);
assert.match(source, /artAutomaticQualityInstruction\(\),/);
assert.match(source, /\["cel_comic",\s*"赛璐璐 \/ 漫画线稿"/);
assert.match(source, /function artExplicitOutlineRequested\(\)/);
assert.match(source, /function artNeedsHighQualityCgGuard\(\)/);
assert.match(source, /function artHighQualityCgRenderingGuardInstruction\(\)/);
assert.match(source, /function artHighQualityCgNegativeGuardInstruction\(\)/);
assert.match(source, /轮廓主要由明暗、色彩与材质边缘建立/);
assert.match(source, /禁止在照片上叠加漫画描边滤镜/);
assert.match(source, /粗黑描边，统一黑色外轮廓，厚重墨线，漫画勾线/);
assert.match(source, /parsed\.hasNegativePrompt \|\| Boolean\(qualityNegativeGuard\)/);

console.log("prompt-assistant-art-quality-ui-contract: passed");

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const source = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'prompt-assistant-service.py'), 'utf8')
const mainSource = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'main.js'), 'utf8')
const previewSource = fs.readFileSync(path.join(root, 'tools', 'preview_runtime_server.py'), 'utf8')

assert.match(mainSource, /function normalizePromptAssistantProvider\(value\)[\s\S]*?provider === "gpt" \|\| provider === "google" \? provider : "local";/)
for (const channel of ['prompt-assistant-optimize-prompt', 'prompt-assistant-reverse-image-prompt']) {
  const handler = mainSource.match(new RegExp(`ipcMain\\.handle\\("${channel}"[\\s\\S]*?\\n\\}\\);\\r?\\n`))?.[0] || ''
  assert.match(handler, /const provider = normalizePromptAssistantProvider\(payload\?\.provider\);/)
  assert.match(handler, /requestPromptAssistant\([\s\S]*?provider,/)
}

const reverseHandler = mainSource.match(
  /ipcMain\.handle\("prompt-assistant-reverse-image-prompt"[\s\S]*?\n\}\);\r?\n/,
)?.[0] || ''
assert.match(mainSource, /function normalizePromptAssistantMandatoryChecklist\(value\)[\s\S]*?value\.slice\(0, 48\)/)
assert.match(mainSource, /function normalizePromptAssistantExpectedRect\(value\)/)
assert.match(mainSource, /expectedRect = normalizePromptAssistantExpectedRect\(item\.expectedRect\)/)
assert.match(mainSource, /region-\[1-9\]\\d\{0,2\}:\[a-z0-9\]/)
assert.match(reverseHandler, /const mandatoryChecklist = normalizePromptAssistantMandatoryChecklist\(payload\?\.mandatoryChecklist\);/)
assert.match(reverseHandler, /const mandatoryChecklistTokens = mandatoryChecklist\.map\(\(item\) => item\.checklistToken\);/)
assert.match(
  reverseHandler,
  /requestPromptAssistant\("reverseImagePrompt", \{[\s\S]*?currentPrompt,[\s\S]*?mandatoryChecklist,[\s\S]*?mandatoryChecklistTokens/,
)

const previewReversePayload = previewSource.match(
  /def _prompt_assistant_reverse_payload\(request: dict\) -> dict:[\s\S]*?\n\n\ndef _request_prompt_assistant/,
)?.[0] || ''
assert.match(previewReversePayload, /"images": images\[:3\]/)
for (const field of [
  '"purpose"',
  '"currentPrompt"',
  '"requirements"',
  '"surface"',
  '"provider"',
  '"mandatoryChecklist"',
  '"mandatoryChecklistTokens"',
]) {
  assert.match(previewReversePayload, new RegExp(field))
}
assert.match(previewReversePayload, /_normalize_prompt_assistant_mandatory_checklist\([\s\S]*?source\.get\("mandatoryChecklist"\)/)
assert.match(previewSource, /normalized\["expectedRect"\] = \{/)
assert.match(previewReversePayload, /if provider not in \{"gpt", "google"\}:[\s\S]*?provider = "local"/)
const previewReverseRoute = previewSource.match(
  /elif suffix in \{"\/reverse", "\/reverse-image-prompt"\}:[\s\S]*?\n\s*else:/,
)?.[0] || ''
assert.match(
  previewReverseRoute,
  /reverse_payload = _prompt_assistant_reverse_payload\(request\)[\s\S]*?_request_prompt_assistant\([\s\S]*?"reverseImagePrompt",[\s\S]*?reverse_payload/,
)

assert.match(source, /def is_ui_design_prompt_payload\(payload: dict\) -> bool:/)
assert.match(source, /def ui_design_uses_negative_prompt\(payload: dict\) -> bool:/)

const optimize = source.match(/def optimize_prompt\(self, payload: dict\) -> dict:[\s\S]*?[\r\n]+\s*def run_storyboard_director_patch_sequence/)?.[0] || ''
assert.match(optimize, /if is_ui_design:/)
assert.match(optimize, /NovaFlow UI 版块专用的设计助手/)
assert.match(optimize, /资源引用占位符/)
assert.match(optimize, /if not is_ui_design or ui_design_uses_negative_prompt\(payload\):/)

const reverse = source.match(/def reverse_image_prompt\(self, payload: dict\) -> dict:[\s\S]*?[\r\n]+def data_url_to_tensor/)?.[0] || ''
assert.match(reverse, /if is_ui_design and len\(images\) > 3:/)
assert.match(reverse, /设计助手一次最多分析 3 张参考图/)
assert.match(reverse, /if is_ui_design:[\s\S]*?role_labels =/)
assert.match(reverse, /页面结构、输出尺寸与用户约束/)
assert.match(reverse, /uiDesignReferenceAssistant/)
assert.match(reverse, /if ui_design_uses_negative_prompt\(payload\):[\s\S]*?build_targeted_negative_prompt/)
const qualityReviewBranch = reverse.match(
  /if purpose\.lower\(\)\.replace\("_", "-"\) == "ui-design-quality-review":[\s\S]*?if is_ui_design:/,
)?.[0] || ''
assert.match(qualityReviewBranch, /payload\.get\("mandatoryChecklist"\)/)
assert.match(qualityReviewBranch, /current_prompt or '未提供'/)
assert.match(qualityReviewBranch, /requirements or '按上述默认规则审查'/)
assert.match(qualityReviewBranch, /mandatory_checklist_tokens/)
assert.match(source, /def ui_design_inventory_semantic_definition\(semantic_token: str\) -> str:/)
assert.match(
  source,
  /def merge_ui_design_visual_inventory\([\s\S]*?review = dict\(quality_review or \{\}\)[\s\S]*?if visual_inventory\.get\("available"\) is False:[\s\S]*?return review/,
)
assert.doesNotMatch(source, /inventory_requires_repair/)
assert.match(source, /"back": "位于该语义区域内、与标题分离的方向返回导航控件/)
assert.match(source, /"status-banner": "位于角色或主视觉语义区域内、与标题分离的结果\/中奖\/状态提示条/)
assert.match(qualityReviewBranch, /"regionId": item\["regionId"\]/)
assert.match(qualityReviewBranch, /"kind": item\["kind"\]/)
assert.match(qualityReviewBranch, /"expectedRect": item\.get\("expectedRect"\)/)
assert.match(qualityReviewBranch, /"regionOrdinal": int\(item\["checklistToken"\]/)
assert.match(qualityReviewBranch, /"genericDefinition": ui_design_inventory_semantic_definition/)
assert.match(qualityReviewBranch, /其他区域里的相似图形不得算作PRESENT/)

const styleProfileBranch = reverse.match(
  /if purpose\.lower\(\)\.replace\("_", "-"\) == "ui-design-style-profile":[\s\S]*?if is_ui_design:/,
)?.[0] || ''
assert.match(styleProfileBranch, /"styleProfile":\{/)
assert.match(styleProfileBranch, /"palette":\[\],"contrast":\[\],"material":\[\]/)
assert.match(styleProfileBranch, /styleProfile不得使用自由文本/)
assert.match(styleProfileBranch, /#RRGGBB/)
assert.match(styleProfileBranch, /"contentIdentityLock":\{"identityAnchors":\[\],"requiredElements":\[\],"exactTokens":\[\]\}/)
assert.match(styleProfileBranch, /contentIdentityLock只能从用户目标原文提取/)
assert.match(styleProfileBranch, /严禁从任何图片提取内容/)
assert.match(styleProfileBranch, /requiredElements只能包含成品画面中实际可见的主体、内容、数量要求和控件/)
assert.match(styleProfileBranch, /输出尺寸、分辨率、横屏或竖屏、手机端或桌面端、小屏可读性/)
assert.match(styleProfileBranch, /质量、材质、完成度等展示或交付约束[\s\S]*?不得写入requiredElements/)
assert.match(styleProfileBranch, /明确要求“展示一部手机”或展示某个设备商品[\s\S]*?属于可见内容，必须保留/)
assert.match(styleProfileBranch, /仅要求适配手机端、桌面端或目标视口时[\s\S]*?不得据此添加手机、设备、状态栏、外框或样机/)
assert.match(styleProfileBranch, /exactTokens只用于成品界面内必须原样可见[\s\S]*?不得收录输出分辨率等交付规格/)
assert.match(styleProfileBranch, /用户目标（contentIdentityLock的唯一来源）/)
assert.match(styleProfileBranch, /max_length=560/)

console.log('ui-design-assistant-service-contract: passed')

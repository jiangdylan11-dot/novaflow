# 美工 AI 助手调整与提示词融合验证

日期：2026-09-14

## 已修改

- 美工与动画共用处理方式单选卡，直接显示 Grok AI / 本地模型。移除高级设置折叠入口，保留美工独立选择记忆；多参考图反推仍可直接调整图片用途。
- 普通连续文字或手写分段提示词不再被强制改写为固定六段机器结构。AI 读取完整原文与补充要求，生成相关片段的修改，由程序合并为完整提示词，保留未修改部分。已有机器结构的提示词保留原结构协议。
- 开放质量要求需落实到具体画面细节，拒绝仅增加“更丰富、更高清”等空泛词。结构化路线补充丰富度语义匹配，普通路线避免对视觉表达设置僵硬的词面要求。
- 对纯丰富度增强，保留原文中没有单独标题的“保持、保留、禁止、避免”等约束，避免模型替换长段落时遗漏。
- 修改 Grok 本地服务、Supabase 云端源代码和本地 Python 路线，保留失败时原提示词不被覆盖的保护。

## 验证

- `smart-ai-simple-dialog-contract.test.js`：通过。
- `art-richness-fusion.test.cjs`：桌面及云端语义覆盖测试通过。
- `art-fusion-patch.test.mjs`：合并、原文保留、拒绝无变化和空泛填充、连续文字约束保留测试通过。
- `test_art_richness_fusion.py`：6 项通过。
- Supabase `backend-contract.test.mjs`：72 项通过。
- `grok-prompt-art-director-contract.test.js`：通过。
- `smart-ai-desktop-routing.test.js`：10 项通过。
- `preview-prompt-assistant-runtime-contract.test.js`：通过。
- `check:runtime`：PASS；`check:entry`：Overall GO，4783 与 8188 均可访问。

真实推理使用中性水彩橘猫场景，并补充“增加参考图的画面丰富感”。Grok 成功返回保留猫、陶瓷杯、木桌、花园和水彩画风的完整提示词；本地模型也完成实际推理。请求和结果保存在同目录 `grok-*`、`local-*` 文件中，`local-ui-*` 使用与实际页面相同的连续文字、前端补充规则和当前配置模型。

最终在 `http://127.0.0.1:4783/` 美工页面实际点击 AI 助手，选择本地模型，输入“增加画面丰富感”并提交：助手自动关闭，完整结果成功写回原提示词框。结果新增猫与杯子的具体受光描述，保留橘猫、绿色眼睛、前爪、右侧尾巴、蓝色陶瓷杯、木桌、花园、左侧光源、平视中景和水彩画风；原末尾“保持猫、杯子、木桌和花园，不增加其他动物”完整保留。最终页面文字另存 `ui-writeback.txt`。

此前真实调用发现并修复了严格六段字段校验、丰富度词面匹配，以及长段落重写漏掉无标题约束的问题。`local-ui-response.json` 是中间阶段的模型结果；最终页面写回证据以 `ui-writeback.txt` 为准。

## 验证范围与现存限制

- 已同步 source、desktop renderer 和 win-unpacked 运行目录。本次未重新生成安装包，未部署远程 Supabase 云端。
- 真实推理证明提示词生成及融合，不等同于最终图像质量验收；未额外执行图片生成。
- 扩展回归 `test_prompt_assistant_art_edit_budget.py` 中 60 项通过，另有 H3 预算断言仍期望 384，而工作区已有 H3 实现为 1280；不属于本次美工修改。
- `prompt-assistant-release-contract.test.js` 仍被工作区已有 H3 `userPrompt/userRequirements` 旧代码形状断言阻挡。本次未修改 H3 实现来迁就该断言。

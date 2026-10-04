# UI 图像输入职责与原生多参修复

用户流程保持两种：单图加提示词，整体改变画风并保留布局；布局图加风格图，可附人物、元素和质感图，按提示词生成完整 UI。不增加输入表单、预设题材或布局模板。

## 实际问题

当前 UI 按钮走 `novaflow-brand-runtime.js:runArtGenerate` → `ui-design.drawing.js:prepare` → `NovaFlowUiDesignPromptPipeline.run`（视觉规划）→ `compileQwenPlan` → 绘图上传与 `buildArtQwen21Workflow`。

旧 `compileQwenPlan` 在存在布局锚点时，将所有规划为 `style` 的来源排除在原生图像输入之外。`color`、`material` 在规划中也归入 `style`，因此这些原图仅被视觉助手读取，Qwen 收到布局和其他素材，却没有风格、配色与质感像素。旧单图路径还允许合法的错误助手规划把明确的“只换画风、布局不变”升级成主题重做和重新排版。

旧节点工作台 `ui-design.bridge.js` 另调用 `ui-design-generate.workflow.js`，其单次生成和人工验收标记不能代替当前绘图区实际路径。本次只修改绘图区使用的提示词管线及相关测试。

## 修复

- 完整保留所有原图，只将布局锚点移到原生图像 1；同步重新编号提示词与规划，不更改用户槽位。
- 布局锚点是唯一几何依据。风格、配色、质感分别约束美术表现、色彩关系、纹理与表面细节，不注入布局、文案或无关内容。
- 人物与元素素材仅融合用户指定区域所需身份与内容，不带入原素材背景、布局、文案或额外控件。
- 对明确的 `preserveLayout=true`、`generationIntent=style-transfer`，错误助手规划不能升级为 reflow/theme-redesign。保持布局、原人物物品身份、文案与功能；用户明确指定替换的区域仍按要求执行。
- 保留自建布局的空间用途、局部布局调整及无布局回退，不把视觉助手估算格数变成硬模板。缓存契约变为 `ui-native-edit-6`。
- `uiLayoutId` 定位图只提供几何。该分支不追加成品画布的身份/文案保留规则，末尾明确删除区域名、诊断编号、示例文字和空白占位，只呈现需求指定的最终文案、物品图案与真实功能图标。实际完整截图分支继续保留未要求修改的文字和功能。

## CPU 复现与检查

在当前任务工作目录的 `work/multi-style/layout-solver-audit/reproduce-input-contract.mjs` 中，执行修改前后的真实 `compileQwenPlan`，并以固定模型目录可用性构造真实 `buildArtQwen21Workflow`。只构图，不提交 ComfyUI、不使用 GPU。

| 输入 | 旧原生 LoadImage / encoder 图像槽 | 新原生 LoadImage / encoder 图像槽 |
|---|---:|---:|
| 1 张完整 UI，只换整体画风 | 1，错误规划可成为重新布局/主题重做 | 1，布局保留/风格迁移 |
| 先风格图、后布局图 | 1（仅布局） | 2（布局图 1、风格图 2） |
| 风格、质感、人物、布局、配色、元素 | 3（布局、人物、元素） | 6（全部原图，布局图 1） |

`old-new-native-reference-proof.json` 与六份前后图节点 JSON 保存了规划、输入顺序、提示词、LoadImage 节点和 `TextEncodeQwenImage21.inputs.images.image_N`。模型目录可用性为 CPU fixture，不能证明已安装模型、在线网站或模型输出效果。

`ui-design-drawing.test.mjs` 测试使用真实 `runArtGenerate` 上传调用链，确认输入 dataUrl 保持原值且顺序为布局、风格、质感、人物、配色、元素；单图风格迁移不会被有效但错误的助手规划重排。原有局部编辑、上传数量、取消、批次、随机种子、LoRA、尺寸、负向提示词、GPT/Google Web 结算和普通绘图路径仍检查。

运行记录由任务工作目录 `work/multi-style/layout-solver-audit/checks.json` 保存。要求的源码同步与入口检查不能代替真实界面效果验收。

## 效果复测

实际入口重放输入与模型提示词保存于当前任务的 `work/multi-style/entry-validation/`。单图 `entry-mode1-western-clay-r1-spec.json` 使用原 2D 西部成品，要求全图改为 3D 黏土，父代理已完成本地 GPU 重放，独立静态审图为 92 分；细微组件边界变化仍存在，不能宣称逐像素几何零漂移。双图 `entry-mode2-compact-jade-r1-spec.json` 使用紧凑 20 格定位图与原生玉木成品样式，GPU 重放保住 20 格与布局带、迁移材质，但仍输出 COMPACT SCENERY、麻将身份错误和空圆盘按钮，未达标。由此发现末尾文字保留规则与定位图职责冲突，追加上述局部修复。

新 `entry-mode2-real-mahjong-clay-r1-spec.json` 使用实际 PG 麻将成品图作为唯一布局/身份/文案来源，实际本地西部黏土图仅作风格与材质来源。两个参考刻意为不同玩法和构图，预期保持 5×4、20 格原身份、金额、四倍率与五主控，只改变美术并把标题改为 JADE SPRING。该脚本执行当前生产 `compileQwenPlan`；语义 planner 结果明确是 fixture，未调用正式视觉助手，GPU 重放由父代理执行。局部修复后绘图区测试 28/28、sync:runtime、check:runtime、check:entry（275 个断言）及 diff 检查通过。

以上区分真实 compiler/原图职责、隔离 GPU 重放、独立静态画质和正式页面端到端验收。当前未发布线上，正式助手与可见页面全流程仍未验收；GPT 同输入对照由父代理安排，不能用 CPU 检查代替质量通过。

后续真实双图 `entry-mode2-real-mahjong-clay-r2` 仍未直出通过：WAYS 与 x1 当前态修正，但标题退回源标题、TURRO 误字、顶部缓冲引入木牌、下方额外露牌仍在。r1 planner fixture 把源五筒、五条误写为六，r2 新输入已纠正为五筒及四绿一红的五条；r1 历史输入和图像不覆盖。图像实际逐格身份以原图核对，不能按错误 fixture 宣称六个点通过。

本次优化为原生参考路由和生成/修复流程，未训练或替换 Qwen 权重。整屏美术直出、局部本地修复、原生透明素材重复与精确文字合成是独立阶段；透明生成要求也可能失败，需检查实际 alpha，不能仅凭 PNG 格式或提示词认定透明。隔离样例的人工审图与 CPU 合成未接为正式绘图区自动验收/修复系统，不能将若干高分成品宣传为所有用户输入稳定直出达标。

# NovaFlow Post Refactor + Performance Regression Report

## 基线

- 当前 commit：`b2474432 docs: close out performance phase p2`
- 验收日期：2026-06-30
- 验收性质：Phase 1-5 安全重构 + P2 性能治理后的人工回归验收报告。
- 验收入口：锁定 `http://127.0.0.1:4783/`
- 环境备注：
  - `4783`：HTTP 200，可用。
  - `8188`：当前不可连接；本轮 UI/DOM 验收不阻塞，但 AI 生图、真实结果追加和 Comfy 链路不作为通过依据。
  - 验收方式：Codex in-app browser 自动化点击 + DOM 状态检查；需要真实图片资源或人工目视的项目标为 `WARNING`。

## 结论

本轮未发现阻断性回归，允许进入下一阶段的前置设计/只读定位。

- PASS：18
- WARNING：8
- FAIL：0

不建议在未补充真实图片资源和 8188 后端的情况下直接宣称“完整发布通过”。本轮结论更准确地说是：Runtime/UI 壳层、入口切换、AI/骨骼隔离、顶栏文件隐藏和基础错误稳定性未发现阻断问题；资源卡、AI 真实链路和部分图片工具弹框需要带样例资源复验。

## 验收矩阵

| 项目 | 结果 | 证据 / 备注 |
| --- | --- | --- |
| 4783 正式入口加载 | PASS | 页面标题 `NovaFlow`，正式脚本链包含 `aifx-repaint-runtime.js`、`spine-split-runtime.js`、`novaflow-brand-runtime.js`。 |
| 一级入口：特效 | PASS | 点击成功，保持粒子/特效工作区，无脚本崩溃。 |
| 一级入口：动画 | PASS | 点击成功，body class 进入 `novaflow-primary-target-animation`，出现 `AI序列动画` / `骨骼动画`。 |
| 一级入口：美工 | PASS | 点击成功，body class 进入 `novaflow-primary-target-art`，出现 `绘图` / `UI`。 |
| 一级入口：工具 | PASS | 点击成功，body class 进入 `novaflow-primary-target-tools`，出现 PNG/JPG 压缩工具。 |
| 一级入口：仓库 | PASS | 入口可见并可点击，未触发崩溃；仓库入口在工具壳层下可见。 |
| 一级入口：导出 | PASS | 入口可见并可点击，未触发崩溃；导出入口在工具壳层下可见。 |
| 二级入口：AI序列动画 | PASS | fresh 复验可点击，body class 保持 animation，出现 AI 序列资源、提示词和 `AI优化` / `AI反推`。 |
| 二级入口：骨骼动画 | PASS | fresh 复验可点击，body class 切到 `novaflow-skeleton-animation-layout`，出现骨骼动画面板。 |
| 二级入口：美工 > UI | PASS | 可点击，无崩溃。 |
| 二级入口：美工 > 绘图 | PASS | 可点击，出现绘图、生成、编辑、局部编辑、去除物体、画布扩展等入口。 |
| 弹框：高清放大 | WARNING | 当前无真实图片资源，入口在 headless/无资源状态下不可见；需带样例图片复验打开/关闭。 |
| 弹框：洗图 | WARNING | 当前无真实图片资源，入口在 headless/无资源状态下不可见；需带样例图片复验打开/关闭。 |
| 弹框：无限扩图 | WARNING | 当前无真实图片资源，入口在 headless/无资源状态下不可见；需带样例图片复验打开/关闭。 |
| 弹框：角度调整 | WARNING | 当前无真实图片资源，入口在 headless/无资源状态下不可见；需带样例图片复验打开/关闭。 |
| 弹框：Storyboard 只打开/关闭 | WARNING | 当前可视路径未发现 Storyboard 入口；未触碰其逻辑，需在真实 Storyboard 入口复验。 |
| 资源卡：新增 / 选中 / 删除 / 结果追加 | WARNING | 当前没有样例图片文件和 AI 结果，未模拟资源增删或结果追加。 |
| 预览区：黑底背景 | PASS | 初始预览壳层检测到 `novaflow-blackgray-preview` 相关 class。 |
| 预览区：图片显示 / 切换更新 | WARNING | 无真实图片资源，无法验证图片显示和切换资源后的预览更新。 |
| AI按钮：AI优化 | PASS | 在 AI序列动画路径中可见；未要求真实 AI 生图。 |
| AI按钮：AI反推 | PASS | 在 AI序列动画路径中可见；未要求真实 AI 生图。 |
| 动画隔离：AI序列动画 -> 骨骼动画 -> AI序列动画 | PASS | fresh 复验链路完整，最终可回到 AI序列动画，无脚本崩溃。 |
| 仓库打开 | PASS | 入口可见并可点击，未发现阻断错误。 |
| 导出入口 | PASS | 入口可见并可点击，未发现阻断错误。 |
| 顶栏文件隐藏状态 | PASS | 未检测到可见顶栏 `文件` 入口。 |
| 控制台错误 | PASS | 验收过程中未捕获新增 error log。 |

## WARNING 明细

1. 图片工具弹框（高清放大 / 洗图 / 无限扩图 / 角度调整）：当前没有真实图片资源，工具入口不在可见态，无法执行打开/关闭。
2. Storyboard 弹框：当前可视路径未发现 Storyboard 入口；本轮遵守禁区，不进入或改动 Storyboard V5。
3. 资源卡新增 / 选中 / 删除 / 结果追加：需要真实图片文件或 AI 结果，当前环境未提供。
4. 预览区图片显示 / 切换更新：需要真实资源才能判定。
5. 首帧闪图：自动化 DOM 检查无法可靠代替人工目视确认，建议发布前人工补验。

## FAIL 明细

无。

说明：首轮自动化脚本在点击工具/导出后未重新恢复动画壳层，导致 `AI序列动画` / `骨骼动画` 二级入口出现误判。随后 fresh 页面单独复验，两者均可点击并通过，因此不计入 FAIL。

## 历史高风险问题复查

| 风险项 | 结果 | 说明 |
| --- | --- | --- |
| 首帧闪图 | WARNING | 自动化无法稳定目视确认，建议人工补验。 |
| 按钮失控 | PASS | 一级入口、二级入口、AI/骨骼往返关键按钮均可继续点击。 |
| 布局残留 | PASS | AI序列动画与骨骼动画往返后 DOM 状态可恢复，未发现阻断性残留。 |
| 弹框层级异常 | WARNING | 导出/常规入口未见阻断；图片工具弹框因无资源未打开，需补验。 |
| 二级入口不能收拢 | PASS | AI序列动画、骨骼动画、美工 UI、绘图均可切换。 |
| 美工绘图入口不可见 | PASS | `美工 > 绘图` 可见并可点击。 |
| 预览区不刷新 | WARNING | 无真实资源，无法验证资源切换后的图像刷新。 |
| AI序列/骨骼互相污染 | PASS | 往返切换后可恢复到 AI序列动画，未发现阻断性状态污染。 |

## 是否允许进入下一阶段开发

允许进入下一阶段的只读定位或低风险设计阶段。

不建议直接进入发布封版，除非补跑以下人工路径：

- 带真实图片资源复验高清放大、洗图、无限扩图、角度调整弹框打开/关闭。
- 带真实图片资源复验资源卡新增、选中、删除、结果追加。
- 带真实图片资源复验预览区图片显示和资源切换刷新。
- 在 8188 可用时复验 AI优化 / AI反推错误处理和真实 AI 链路冒烟。
- 人工目视确认 AI序列动画 / 骨骼动画往返没有首帧闪图。

## 建议下一阶段任务

优先级建议：

1. 建立 NovaFlow 2.5 发布基线：补齐真实资源人工验收、记录可发布/不可发布清单。
2. 登录 / 授权系统只读定位：在不动 Runtime 和导出链路的前提下先确认授权状态流、UI 入口和 Electron 边界。
3. 暂停继续性能治理和 Runtime 拆分，避免在当前稳定窗口引入新变量。

## 验证命令

```bash
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```

# NovaFlow 2.5 Release Baseline

## 当前基线

- 代码发布候选基线 commit：`098929e8 docs: add post refactor regression report`
- 建立日期：2026-06-30
- 分支：`rebuild/source-driven-runtime`
- 本文性质：NovaFlow 2.5 发布基线与真实资源补验计划。
- 本轮范围：只读整理 + docs 记录；未开发新功能，未继续重构，未继续性能优化。

## 发布基线状态

NovaFlow 2.5 当前可以进入发布前基线冻结状态，但不应直接宣称完整发布通过。

原因：

- Phase 1-5 安全重构已经收口。
- P2 性能治理已经收口。
- P2H 主要性能收益已经确认。
- P2N 性能收尾已经完成。
- 重构 + 性能治理后的回归验收未发现阻断性 FAIL。
- 仍有依赖真实图片资源、真实 AI 后端和人工目视的 WARNING，需要作为发布前补验项。

建议判断：

- 允许进入下一阶段的只读定位或低风险设计。
- 允许准备 NovaFlow 2.5 发布候选包。
- 不建议跳过真实资源补验直接封版。

## 已完成内容

### Phase 1-5 安全重构

- Phase 1：safe JSON helper 小范围抽离，覆盖 `novaflow-brand-runtime.js`、`spine-split-runtime.js`、`aifx-repaint-runtime.js`。
- Phase 2：低风险 Dialog shell，迁移高清放大、洗图、画布扩展弹框壳层。
- Phase 3：最小 `runWorkflowTask` 外壳，只接入高清放大和角度调整链路。
- Phase 4：只读 `ResourceStore` / `PreviewState` snapshot helper，不替换旧 state。
- Phase 5：在 `aifx-repaint-runtime.js` 内建立无状态 `AifxPureHelpers` 局部边界，停止继续物理拆 Runtime。

### P2 性能治理

- P2A-P2G：逐步补齐 layout refresh、caller、mutation family、skeleton writer、workspace active writer attribution。
- P2H：第一刀真实优化，guard `syncSplitWorkspace.setActive` 的重复 `WORKSPACE_ACTIVE_ATTR` 同值写入。
- P2I：P2H 后重新采样，确认高频 mutation/full layout refresh 大幅下降。
- P2J-P2L：继续观察 layout 子步骤和 marker writer，未直接扩大优化。
- P2M：第二刀真实优化，guard `markAiAnimationWorkspaceLayout` 内已证明重复的 marker raw `setAttribute(..., "1")`。
- P2N：性能治理阶段收尾，确认继续深挖当前链路收益变小。

### 已验证收益

- P2H 后 `workspaceActiveWriterAttempt`：`449 -> 48`。
- P2H 后 `brandMutationFlushRun`：`441 -> 14`。
- P2H 后 `runFullLayoutRefresh`：`440 -> 15`。
- P2H 后 skeleton workspace attr mutation：`442 -> 3`。
- P2M 记录 guarded same-value skips：`102`。
- P2M 对 `previewSurface` 和 `earlyStructureLayout` 有小幅收益，但 `runFullLayoutRefresh` 次数未继续下降。

### 回归验收结果

来自 `docs/NOVAFLOW_POST_REFACTOR_PERFORMANCE_REGRESSION.md`：

- PASS：18
- WARNING：8
- FAIL：0

已确认通过：

- 4783 正式入口加载。
- 一级入口：特效 / 动画 / 美工 / 工具 / 仓库 / 导出。
- 二级入口：AI序列动画 / 骨骼动画 / 美工 > UI / 美工 > 绘图。
- AI按钮：AI优化 / AI反推可见。
- 动画隔离：AI序列动画 -> 骨骼动画 -> AI序列动画。
- 仓库 / 导出入口。
- 顶栏 `文件` 隐藏状态。
- 控制台未捕获新增 error。

## 未改动禁区

以下区域在重构、性能治理和本基线整理中保持禁动：

- Storyboard V5 行为与 workflow。
- Prompt Assistant。
- Comfy workflow JSON。
- Electron IPC 业务逻辑。
- AI 生图真实 workflow 节点、模型、prompt 拼接和 seed 参数。
- 导出业务逻辑。
- 资源卡状态替换。
- 预览区全局状态替换。
- AI序列动画 / 骨骼动画切换业务逻辑。
- Runtime 物理拆分与 `index.html` 加载顺序。

## 当前已知 WARNING

| 项目 | 状态 | 发布判断 |
| --- | --- | --- |
| `8188` health/direct probe timeout | WARNING | 不阻塞 UI/DOM 基线；阻塞真实 AI 生图链路完整验收。 |
| 高清放大 / 洗图 / 无限扩图 / 角度调整弹框 | WARNING | 当前无真实图片资源，需带样例图片复验。 |
| Storyboard 弹框 | WARNING | 当前可视路径未定位入口；需在真实 Storyboard 入口只打开/关闭复验。 |
| 资源卡新增 / 选中 / 删除 / 结果追加 | WARNING | 需要真实图片文件或 AI 结果。 |
| 预览区图片显示 / 切换更新 | WARNING | 需要真实图片资源。 |
| AI优化 / AI反推错误处理 | WARNING | 按钮可见；真实错误处理需在 `8188` 可用或明确断连场景下补验。 |
| 首帧闪图 | WARNING | 自动化 DOM 不能替代人工目视，需要人工补验。 |

## 真实资源补验清单

发布前建议使用固定样例资源执行以下补验，并把结果追加到发布验收记录：

1. 准备样例图片：
   - 一张普通 PNG。
   - 一张 JPG。
   - 一张透明背景 PNG。
   - 一张可用于局部编辑/去物的角色或场景图。
2. 美工 > 绘图：
   - 导入图片资源。
   - 确认资源卡新增、选中、删除。
   - 确认预览区图片显示、黑底背景、切换资源后预览更新。
3. 图片工具弹框：
   - 打开/关闭高清放大弹框。
   - 打开/关闭洗图弹框。
   - 打开/关闭无限扩图弹框。
   - 打开/关闭角度调整弹框。
   - 确认弹框层级、关闭按钮、遮罩和原视觉不异常。
4. AI 链路冒烟：
   - 在 `8188` 可用时点击 AI优化。
   - 在 `8188` 可用时点击 AI反推。
   - 在 `8188` 不可用时确认错误提示不崩溃。
5. 结果资源追加：
   - 任一低成本 AI 任务完成后确认结果资源追加。
   - 确认追加后资源卡可选中，预览可更新。
6. Storyboard：
   - 只打开/关闭 Storyboard 相关弹框。
   - 不修改 Storyboard V5 逻辑。
7. 动画隔离人工目视：
   - AI序列动画 -> 骨骼动画 -> AI序列动画。
   - 观察是否存在首帧闪图、按钮失控、布局残留或状态互相污染。

## 回滚点

推荐回滚锚点：

- `098929e8 docs: add post refactor regression report`：当前 NovaFlow 2.5 代码发布候选基线。
- `b2474432 docs: close out performance phase p2`：P2 性能治理收尾点。
- `5823d14d perf: guard duplicate workspace layout markers`：最后一刀性能优化点。
- `39f01a37 perf: guard duplicate workspace active writes`：P2H 主要性能优化点。
- `994749fe docs: summarize phase 1-5 refactor`：Phase 1-5 安全重构收尾点。
- `9432a7b7 chore: establish phase 0 refactor baseline`：重构前稳定基线。

回滚原则：

- 若发布前真实资源补验出现资源卡/预览区/AI链路回归，优先回滚到 `098929e8` 前的最近相关优化点做二分。
- 若出现广泛入口/布局回归，优先比较 `098929e8` 与 `b2474432`。
- 若怀疑性能 guard 引起行为变化，优先比较 `5823d14d`、`39f01a37` 和其父提交。

## 发布前必跑命令

```bash
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```

如准备正式打包，还应单独执行并记录打包链路：

```bash
npm run build:win:nobump
npm run check:entry
```

## 是否允许进入下一阶段开发

允许进入下一阶段，但建议按以下顺序：

1. 先完成真实资源补验。
2. 建立 NovaFlow 2.5 发布候选记录。
3. 再进入登录 / 授权系统的只读定位。
4. 登录 / 授权系统进入开发前，必须重新输出方案、风险和验收路径。

不建议：

- 在真实资源补验前继续性能治理。
- 在真实资源补验前继续拆 Runtime。
- 在真实资源补验前改 Storyboard、Prompt Assistant、Comfy workflow JSON 或 Electron IPC。

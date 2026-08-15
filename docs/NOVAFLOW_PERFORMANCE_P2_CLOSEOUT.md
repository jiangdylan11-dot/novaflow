# NovaFlow Performance Phase P2 Closeout

## 基线

- 当前基线 commit：`5823d14d perf: guard duplicate workspace layout markers`
- 收尾日期：2026-06-30
- 本轮性质：性能治理阶段收尾，只新增文档，不继续优化代码。
- 复测入口：锁定 `http://127.0.0.1:4783/`
- 环境备注：`4783` 可用；`8188` 直连 health 当前不可用，本轮 DOM 性能复测不依赖真实 AI 生图链路。

## P2A-P2M 时间线

| 阶段 | Commit | 作用 |
| --- | --- | --- |
| P2A | `4355d141` | 增加 layout refresh probe 基础计数，覆盖 full layout、startup tick、mutation flush、observed refresh。 |
| P2B | `f6fdd97c` | 建立首轮性能基线报告，确认二级入口切换和绘图弹框链路存在高频 broad DOM scan / full layout refresh。 |
| P2C | `eb0e4648` | 增加热点 callsite / duration attribution，区分高频计数和真实耗时。 |
| P2D | `e20b9b82` | 补齐 `runFullLayoutRefresh` caller/reason 归因，确认最高来源是 `brandMutationFlush`。 |
| P2E | `82dafa10` | 增加 mutation family 归因，确认 skeleton family 与 attributes mutation 是主要来源。 |
| P2F | `0cfc854f` | 增加 skeleton attribute/writer 归因，定位 `data-novaflow-spine-split-workspace-active`。 |
| P2G | `54407e70` | 在 split runtime writer 端增加 attempted/effective/same-value 观测，确认同值重复写入比例极高。 |
| P2H | `39f01a37` | 第一刀真实优化：guard `syncSplitWorkspace.setActive` 的重复 `WORKSPACE_ACTIVE_ATTR` 同值写入。 |
| P2I | `ecf5d3d4` | P2H 后重新建立性能基线，确认高频 mutation/full layout refresh 明显下降。 |
| P2J | `4efc5e62` | 增加 `applyAiAnimationSectionLayers` / `applyPreviewRuntimeLayout` 子步骤 duration attribution。 |
| P2K | `11115c91` | 继续拆 `previewSurface` 叶子级耗时，定位 `earlyStructureLayout`。 |
| P2L | `cb987d81` | 增加 `applyAiAnimationEarlyStructureLayout` 叶子级 attribution 和 layout marker writer 计数。 |
| P2M | `5823d14d` | 第二刀真实优化：guard `markAiAnimationWorkspaceLayout` 内已证明重复的 marker raw `setAttribute(..., "1")`。 |

## P2H 大收益总结

P2H 是本轮性能治理的主要收益点。P2G 已证明 `WORKSPACE_ACTIVE_ATTR` 写入合计 `attempted 449 / changed 3 / same-value 446`，其中最高 writer 是 `syncSplitWorkspace.setActive`，存在高度重复同值写入。

P2H guard 后，合并对比：

| 指标 | P2G | P2H | 变化 |
| --- | ---: | ---: | ---: |
| `workspaceActiveWriterAttempt` | 449 | 48 | -401 / -89.3% |
| `brandMutationFlushRun` | 441 | 14 | -427 / -96.8% |
| `runFullLayoutRefresh` | 440 | 15 | -425 / -96.6% |
| skeleton workspace attr mutation | 442 | 3 | -439 / -99.3% |

P2I 进一步确认，二级入口切换中 `runFullLayoutRefresh` 从 P2B 的 `250` 降到 `8`，`querySelectorAllStar` 从 `994` 降到 `37`；绘图弹框链路中 `runFullLayoutRefresh` 从 `171` 降到 `3`，`querySelectorAllStar` 从 `673` 降到 `12`。

## P2M 小收益总结

P2L 证明 layout marker 写入存在 `attempted 115 / changed 0 / same-value 115`，但它只证明 marker 写入可 guard，不证明可以跳过整个 `markAiAnimationWorkspaceLayout` 或 `applyAiAnimationEarlyStructureLayout`。

P2M 仅 guard 已证明重复的 marker raw `setAttribute(..., "1")`：

| 指标 | P2L | P2M | 变化 |
| --- | ---: | ---: | ---: |
| guarded same-value skips | 0 | 102 | +102 |
| `applyAiAnimationSectionLayers.previewSurface` | 589.3ms | 574.3ms | -15.0ms |
| `applyAiAnimationEarlyStructureLayout` | 268.8ms | 262.4ms | -6.4ms |
| `runFullLayoutRefresh` | 11 | 11 | 0 |

结论：P2M 有正向但较小的收益，且没有降低 full layout refresh 次数。继续沿当前 marker 链路深挖，收益已经明显变小。

## P2N 最终复测

采样方式：

- Headless Chrome + CDP 打开锁定 `4783`。
- 每个场景 `window.__NFAnimationPerfProbe.start(label, { durationMs: 10000 })`。
- 视口：`1280x720`。
- 测试时间：2026-06-30 03:59 ICT。

| 场景 | `runFullLayoutRefresh` | `brandMutationFlushRun` | `querySelectorAllStar` | `applyAiAnimationSectionLayers` | `applyPreviewRuntimeLayout` | 备注 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 二级入口切换：动画 / AI序列动画 / 骨骼动画 / 美工 / UI / 绘图 | 11 / 878.4ms | 10 | 49 / 1.3ms | 14 / 645.0ms | 13 / 525.8ms | 完整命中，`layoutMarkerWriterSkippedSameValue` 为 51。 |
| 绘图页路径 | 2 / 42.3ms | 1 | 8 / 0.2ms | 2 / 0.8ms | 2 / 12.9ms | 美工 / 绘图切换命中；高清放大、洗图、无限扩图入口在当前 headless/无资源状态下不可见，因此弹框打开关闭未作为有效样本。 |
| AI序列动画 -> 骨骼动画 -> AI序列动画 | 3 / 536.1ms | 12 | 20 / 1.6ms | 9 / 896.4ms | 6 / 496.8ms | 完整命中，剩余热点主要是少量刷新中的单次 layout work。 |

## 当前已验证的性能改善

- 高频 mutation flush -> full layout refresh 链路已被 P2H 大幅压低。
- `querySelectorAllStar` 的高计数已从主要问题降为低耗时残留指标。
- `WORKSPACE_ACTIVE_ATTR` 的重复同值写入已被确认并 guard，未发现采样回归。
- P2M 对已证明重复的 AI workspace layout marker 写入增加 guard，带来小幅子步骤耗时下降。
- 当前剩余耗时不再主要来自 refresh 次数，而来自少量刷新中的 `applyAiAnimationSectionLayers` / `applyPreviewRuntimeLayout` 单次执行成本。

## 当前未动的高风险区域

- Storyboard V5。
- Prompt Assistant。
- Comfy workflow JSON。
- Electron IPC 业务逻辑。
- AI 生图、prompt 拼接、workflow 节点和模型参数。
- 资源卡追加逻辑与预览区全局状态替换。
- AI序列动画 / 骨骼动画切换状态机。
- MutationObserver 范围、filter、刷新条件和 delay。
- `markAiAnimationWorkspaceLayout` / `applyAiAnimationEarlyStructureLayout` 整函数跳过。
- Runtime 物理拆分与 `index.html` 加载顺序。

## 不建议继续挖当前链路的原因

- P2H 已解决本轮最明确、收益最大的重复同值写入问题。
- P2M 证明后续同类 guard 仍有收益，但幅度明显变小。
- 当前 `runFullLayoutRefresh` 次数已经较低，继续减少次数需要碰刷新调度、MutationObserver 或动画切换状态，回归风险高。
- 剩余耗时集中在复杂 UI layout 函数内部，继续优化容易牵动资源区、预览区、二级入口和 AI/骨骼隔离逻辑。
- 继续叠加 probe/guard 会增加维护成本，并可能掩盖真正需要人工验收的交互风险。

## 下一阶段建议

1. 暂停 P2 当前链路，不再继续加 guard 或插 probe。
2. 保留现有 probe 作为后续回归工具，不删除、不扩大。
3. 先做一次人工验收矩阵复跑，重点覆盖二级入口、AI/骨骼切换、绘图页和预览区。
4. 如果继续性能治理，建议进入新的 P3 只读阶段，先基于真实用户卡顿路径采样，而不是沿当前 marker 链路继续深挖。
5. Runtime 物理拆分仍建议延后，等性能治理和人工回归稳定后再评估。

## 验证命令清单

```bash
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```

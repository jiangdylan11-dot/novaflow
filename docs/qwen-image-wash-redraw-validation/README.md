# Qwen 质感重绘修订与验证

本页是前一轮分档方案的记录。用户随后确认了连续强度语义，当前交付见 [连续重绘验证](../qwen-image-wash-continuous-validation/README.md)，以下参数与安装包记录仅对应历史版本。

2026-09-12，NovaFlow 2.3.214，缓存标记 `20260912-qwen-wash-redraw-2`。

用户反馈上一版只调整了少量细节，并出现“Prompt Assistant 推理超时”；目标明确为允许更多重绘，让整张图更精致。

## 本次修改

- Qwen 洗图取消独立 Prompt Assistant 反推，直接通过 Qwen 的 image1 理解原图。调用链不再经过该超时报错位置。没有更改全局 Prompt Assistant 超时，也不宣称修好了其他功能的反推服务。本次未在主日志中定位到截图对应的超时条目。
- 默认 Qwen 强度 0.65，滑块直接传给采样器，取消上一版强度压缩。Wan 默认仍为 0.20，切换卡片分别保留本次对话框内各自的强度。
- 中高强度完整画面保留图像语义条件和原图 VAE 采样起点，移除重复空间参考，使材质、光影、背景和局部造型能明显重绘。低强度（不超过 0.30）和带透明通道的素材仍保留空间参考，以保护结构及透明轮廓。
- 提示词明确允许整体重绘，改善结构、光照、材质和背景。移除画风枚举，避免高强度把举例的像素风引入结果。
- 延续原尺寸输出、工作像素预算和原 alpha 恢复。大图仍可能缩小处理，输出尺寸恢复不是超分辨率。
- UI 卡片为“质感重绘 Qwen”。没有新增模型或修改模型库。

## 实图证据

生产 `runImageWash` 经真实 8188 上传、推理、解码和后处理；测试把独立反推设置为一旦调用即失败，所有新 Qwen 用例均未调用。固定种子 9122026。未自动点击已安装的 Electron 界面。

| 最终用例 | 强度 | 模型推理耗时 | 结果 |
|---|---:|---:|---|
| 完整角色场景 | 0.65 | 约 40 秒 | `release-final/redraw-default.png`，1016×1018 |
| 完整角色场景 | 0.85 | 约 47 秒 | `release-final/redraw-high.png`，1016×1018 |
| 透明机器人 | 0.65 | 约 70 秒 | `alpha/redraw-default.png`，1012×1012 |

最终角色图 prompt IDs、耗时、状态见 `release-final/*-run.json`；节点参数见对应 workflow JSON。透明机器人测试在移除画风枚举前执行，透明检测、空间参考、尺寸及 alpha 后处理代码与交付版相同。原 alpha 改动像素数为 0，包含 257366 个半透明像素，见 `alpha/metrics.json`。

实图可见默认档重新绘制了背包、衣褶、道路、天空和远景，比上一版仅局部精修的变化大。也出现了更偏平涂的画风和五官变化。0.85 明显改变脸部、服装形状和背景，并出现白边，不推荐作为默认；更大变化不等于更高质量，不承诺每张图都优于原图。透明素材为保护外轮廓，变化幅度会更受约束。

[交互对比](index.html) · [默认结果](release-final/redraw-default.png) · [高强度结果](release-final/redraw-high.png)

中间目录保留排查证据，`release-final` 才是最终提示词输出：根目录与 `final` 是仍保留重复空间约束的实验；`visual-only` 是移除该约束的候选；`release` 是修复画风枚举之前的结果，其中默认档命中缓存，不能将 2 秒当成真实推理耗时。未重跑已废弃模型的旧实验。

## 检查与交付边界

- 27 项针对性检查通过，覆盖视觉条件、结构参考策略、透明检测与 alpha、Qwen 不调用反推、Wan 路由、对话框默认强度及模式切换、Rapid 迁移、补图和迁移合成。
- `node --check`、`git diff --check` 通过；`sync:runtime` 完成；打包后 `check:runtime` PASS。source、renderer、dist 中洗图脚本 SHA-256 一致。
- `check:entry` 为 **NO-GO**：4783 没有监听，直接 8188 探测成功。尝试启动隐藏预览服务被自动审批拒绝，工具仅报告 blocked by policy；未绕过该限制。此结果不能称为完整桌面入口验收。
- 上一轮单独发现的 `prompt-assistant-release-contract.test.js` 旧缓存版本断言问题不属于本次 27 项检查，未修改该无关测试。
- 安装包：`D:\AI_APP\NovaFlow\particle-editor-desktop\dist\NovaFlow Setup 2.3.214.exe`。大小、时间、SHA-256 见 `installer.json`。无版本号升级，需运行此新包后重开软件。
- 未覆盖 Program Files 安装目录，未自动提交 Git。

复现：设置 `NODE_PATH` 指向含 `@napi-rs/canvas` 的 Node 依赖，设置独立 `NF_WASH_OUTPUT` 目录，运行 `node tools/qwen-image-wash-smoke.cjs <原图路径>`。脚本检测 Runtime 队列已有任务时不提交测试。

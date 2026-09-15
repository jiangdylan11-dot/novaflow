# Remix T2V Low Q5 洗图替换试验

2026-09-12。用用户已下载的 `E:\NovaFlow\models\unet\Wan22\wan22RemixT2VI2V_t2vLowV20-Q5_K_M.gguf` 替换独立试验图中的原版 Wan T2V Low Q4_K_S，完成真实运行。没有修改正式应用入口、安装包或任何模型文件。

## 结果

两档均成功加载、采样、解码并保存 PNG，没有显存溢出。低强度 0.20 用时 37.649 秒，高一些的强度 0.65 用时 50.175 秒，输出均为 1016×1024。耗时包括本次提交到结果完成，不含 Prompt Assistant 反推，也不能排除缓存和加载对耗时的影响。

- 0.20：头发细丝、背包扣带、布料褶皱、路面颗粒更明显，但脸型、背包结构、背景和绘制方式也发生变化，偏向半写实/三维渲染感。没有保持原图的全部二维插画特征。
- 0.65：重绘明显增加，改变了姿态、服装和道路，仍偏半写实。没有之前 SmoothMix I2V 完整条件下提高强度却几乎不变的问题。
- 结论：可作为追求半写实材质的候选。低强度保真和画风保持存在明显取舍，尚不能视为所有素材通用的升级。

这是一张普通插画、一个种子、两档强度的替换试验，未验证 NSFW 能力，未声称是模型最佳参数。正式入口仍使用原模型，旧权重保留。

## 严格控制的变量

复用 `docs/smoothmix-image-wash-validation` 中已完成的 `wan-low`、`wan-medium` 生产工作流及其真实结果，不重跑旧实验。只替换 LoaderGGUF 的 `gguf_name`；上传名、输出前缀随本轮调整。两套模型的量化等级不同，因此也不能将全部差异归因于训练权重。

保持：原图、提示词全文、随机种子 9122026、7 步、CFG 1、Euler/Beta、shift 8、Wan21 T2V LightX2V rank64 LoRA 强度 1、UMT5、VAE、原图 VAE 采样起点、1MP 处理尺寸及各自 denoise。

此次保留旧 LoRA 是为了直接回答“仅替换模型”的效果，不代表已证明这是 Remix 的最佳 LoRA 配置。反推采用此前固定描述，没有运行在线 Prompt Assistant。

## 证据

| 本轮用例 | Prompt ID | 状态 |
|---|---|---|
| remix-low / 0.20 | a0c51904-2caf-40df-95a3-b7af5b68b93e | success |
| remix-medium / 0.65 | ee1db742-830a-4651-acac-05a68e878ca6 | success |

各 `*-workflow.json`、`*-run.json` 和 PNG 均保存在本目录。原版 Wan 的结果和运行记录来自上一轮，文件原样复制以便复核。

[交互对比](index.html) · [0.20 结果](remix-low.png) · [0.65 结果](remix-medium.png)

复现脚本：`tools/remix-image-wash-smoke.cjs`。每次提交前检查队列，已有任务时退出，不中断用户任务。

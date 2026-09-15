# SmoothMix I2V Low 替代 Wan 洗图：独立实测

2026-09-12。测试目标是判断本机 `smoothMixWan22I2V14B_i2vLow.safetensors` 能否替代当前 Wan 洗图，并提供真实出图对照。此次没有修改应用入口、现有工作流、模型文件或安装包。

## 结论

**该文件已在本机 16GB 显卡上成功加载并出图，但当前实测不足以支持替换现有 Wan 洗图。**

- 完整 I2V 条件方案保留了更多原图内容和绘制风格；但强度从 0.20 提到 0.65，输出仍非常接近原图，对大幅重绘的响应弱。
- 去除额外 I2V 原图条件、仅保留原图 VAE 采样起点后，0.65 可以明显重绘，但结果出现强烈饱和、重黑边、服装和画风偏移，不建议采用这组配置。
- 当前 Wan 在 0.65 的改动明显更大，低强度仍能重画材质和细节；因此继续保留当前方案作为主洗图。
- 这是一个普通插画样例、一个种子、两档强度及一次诊断对照，不证明 SmoothMix 所有配置或其他素材都不适合，也没有证明其画质普遍优于当前 Wan。

[交互对比](index.html) · [SmoothMix 0.20](smooth-low.png) · [SmoothMix 0.65](smooth-medium.png) · [去除额外条件 0.65](smooth-unconditioned-medium.png)

## 配置

共同条件：用户提供的非敏感插画 `a.png`、固定种子 9122026、同一段画面描述和生产 Wan 洗图提示词、约 1MP 工作分辨率、Euler / Beta、shift 8、同一 UMT5 和 Wan VAE。输出均为 1016×1024。

| 配置 | 主模型与条件 | 步数 / CFG | LoRA |
|---|---|---|---|
| 当前 Wan | 生产 `buildWanImageWashWorkflow`；T2V Low Q4_K_S；原图 VAE 起点 | 7 / 1 | 现有 Wan21 T2V LightX2V rank64，强度 1 |
| SmoothMix | UNETLoader default；I2V Low；WanImageToVideo 单帧原图条件；原图 VAE 起点 | 20 / 3.5 | 无 |
| SmoothMix 诊断对照 | 同一 I2V Low；不提供额外图像条件，Runtime 自动填充空条件通道；仍使用原图 VAE 起点 | 20 / 3.5 | 无 |

20 步 / CFG 3.5 是本轮独立试验选值，不声称是该混合模型作者推荐参数。本轮没有预设现有 T2V 加速 LoRA 适合 SmoothMix，也没有下载其他加速 LoRA。这是两套可运行配置的对比，不是仅替换权重、所有参数严格一致的消融实验。

本地文件约 21.28GB，模型头为混合精度，patch embedding 输入为 36 通道。Runtime 实际识别为 WAN21，成功完成默认加载及推理，未发生显存溢出。详细节点连接见各 `*-workflow.json`。

## 运行结果

| 用例 | 强度 | 总耗时 | 相对缩放后原图的 RGB 平均绝对差 |
|---|---:|---:|---:|
| 当前 Wan | 0.20 | 42.8 秒 | 12.34 |
| 当前 Wan | 0.65 | 30.1 秒 | 48.12 |
| SmoothMix 完整 I2V 条件 | 0.20 | 257.5 秒 | 4.96 |
| SmoothMix 完整 I2V 条件 | 0.65 | 111.0 秒 | 5.11 |
| SmoothMix 去除额外条件 | 0.65 | 约 79 秒 | 见 metrics.json |

RGB 差值用于描述本张样例的变化量，不是画质评分。SmoothMix 的两档差值相近，与目视观察到的强原图约束一致。

第一次 SmoothMix 推理包含约 108 秒的首步初始化；之后采样步耗时明显降低。总耗时还受加载、缓存、CFG、步数、资源调度影响，不能把这张表解释为单纯的模型速度倍率。

每次提交前检查 8188 队列，已有任务时不提交。五个用例都真实执行了上传、工作流提交、采样、解码和结果下载；prompt ID、状态、运行时间见 `*-run.json`。为控制变量，使用固定描述而没有运行实时 Prompt Assistant 反推，耗时不包括该反推环节。

复现脚本：`tools/smoothmix-image-wash-smoke.cjs`。默认运行四个主对照；额外诊断使用 `NF_SMOOTH_CASES=smooth-unconditioned-medium`。未执行全软件回归、桌面点击验收、打包或 Git 提交；本轮交付是候选模型实测结果。

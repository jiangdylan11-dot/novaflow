# 洗图：依据原图画风重绘

本轮在实际代码中加入原图画风分析，并以真实输出验证。这里的“保持画风”是保持绘制媒介、线条、上色、纹理语言，不等同于输出更多细节或更写实。

## 代码变更

- Wan 洗图通过专用 `image-wash-style` 视觉请求分析原图，分别提取媒介、边缘/线条、明暗/笔触、色板、材质纹理和画面内容。五项风格必须完整，不能以缺失分析或通用画风继续生成。
- 删除固定 `game-art style` 描述，将原图分析置于提示词前部。所有强度使用同一份画风依据；滑块仍直接控制原有 denoise，没有暗中降低强度。
- Qwen 继续直接读取原图，不增加独立反推调用；同步明确媒介、写实程度、线条和上色约束。
- 正式默认仍为原版 Wan T2V Low Q4_K_S。Remix 尚未通过当前画风保持验证，没有迁移默认模型或删除权重。

## 实测与局限

原图是用户此前提供的普通二维动漫插画。两次真正调用本地 Prompt Assistant：初版得到“2D illustration”及带动漫线条描述的内容；五项分析版得到 digital illustration、smooth/slightly rounded edges、soft/subtle gradients、vibrant/natural tones、smooth/slightly painterly texture。后者仍有概括过粗的问题，不能把结构化字段成功返回当作精确识别已完成。

两次分析约 75 秒和 73 秒，完整响应分别在本目录和 `detailed/`。没有用人工描述冒充自动分析。

先验证相同种子、相同提示词与采样配置下只移除 Remix 的原有加速 LoRA，再验证自动画风提示。Remix 的多组输出仍偏半写实。这只证明这些配置没有满足原画风要求，不证明该模型固定只能写实，也不证明无法进一步调整。

原版 Wan 保持了二维动漫这一大类，但高强度仍会改变人物外观，并将部分柔和上色简化成较平的色块，不能宣称已精确保持所有绘画特征。

另外做了“去除 LoRA、20 步、CFG 3、针对二维图加入排除摄影/三维的负向词”诊断，结果仍偏半写实。该负向提示只适用于当前二维样例，未写入所有图片的生产流程。

进一步的 `manually-observed-style-profile.json` 是助手观察原图后写出的具体画风描述，内容沿用初版自动分析，用来区分识别太笼统与模型没有遵从描述。它仅用于诊断，未写死进软件。

具体画风描述、无 LoRA、CFG 3 的结果仍偏半写实；将 CFG 提到 6 后，动漫描边和色块明显增加，但颜色和高光过强。这证明风格响应可以改变，不能下“固定只能写实”的结论。再加 CFGNorm（strength 1、post-CFG）后，对比降低，但皮肤与材质又偏半写实，仍未达到原图画风验收要求。以上都是独立参数实验，没有把这些配置直接设为默认。

已读取本地 GGUF 头：架构 `wan`，patch embedding 的 GGUF 维度 `[2, 2, 1, 16, 5120]`，确认是 16 输入通道的 T2V 分支，不是 I2V 的 36 输入通道。采样图中 CFG、提示词和是否加载 LoRA 均按记录实际提交。

## 查看结果

[交互对比](index.html) 默认显示最终五项分析在原版 Wan 上的 0.20/0.65 输出，可切换初版分析、Remix 对照、原图和改前结果。

- `wan-style-detail-*`：最终五项自动分析、原版 Wan。
- `wan-style-*`、`remix-style-*`：初版自动分析、两个模型分别测试。
- `remix-guided-no-lora-medium`：初版自动分析，20 步/CFG 3，无 LoRA，加入二维画风负向词。
- `remix-specific-no-lora-medium`：同上，仅换成核对原图后写出的具体画风描述。
- `remix-specific-cfg6-no-lora-medium`：具体画风描述，CFG 6。
- `remix-specific-cfg6-norm-no-lora-medium`：同上，附加 CFGNorm。
- 去除 LoRA 的旧提示词对照保存在 `../remix-image-wash-validation/remix-no-lora-*`。

各 PNG 对应的 `*-workflow.json` 是实际提交图，`*-run.json` 含真实 prompt ID、状态和耗时。旧 Wan、旧 Remix 结果复用已有文件，没有重跑旧实验。所有新用例使用种子 9122026，输出 1016×1024，只有记录明确指出的变量改变。

## 验证与交付边界

- JavaScript 洗图与相关路由/生命周期测试 12 项通过；Python 画风分析测试 3 项通过。
- `sync:runtime` 和 `check:runtime` 通过，源代码、renderer 和 dist 运行副本一致。
- 额外的旧 `prompt-assistant-release-contract.test.js` 失败，因为它仍锁定 20260817 的品牌脚本缓存号；HEAD 和当前代码均已是 20260912，此失败不是本轮修改产生的。
- `check:entry` 是 NO-GO：4783 未启动，直接 8188 可达，检查还报告既有 AI 特效集成项未完成。未宣称桌面全流程验收通过。
- 未打包或覆盖已安装软件，未提交 Git。软件中的修改、独立视觉结果和安装版验收是不同交付状态。

复现工具：`tools/image-wash-style-analyze.py` 使用真实本地视觉服务；`tools/remix-image-wash-smoke.cjs` 读取记录的风格分析并提交实际洗图。运行前都检查队列，不中断已有用户任务。

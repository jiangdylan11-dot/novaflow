# SmoothMix T2V Low v4 洗图接入

2026-09-13，NovaFlow 2.3.214。

洗图窗口新增 `SmoothMix 洗图` 选项，调用本地 `Wan22\smoothMixWan2214BI2V_t2vLowV40.safetensors`。使用 UNETLoader、原有 Wan VAE 和 UMT5，7 步 Euler / Beta、CFG 1、shift 8；原图 VAE 编码作为采样起点。此路线不加载加速 LoRA 或附加 LoRA，不依赖原版 Wan GGUF 文件。

默认重绘强度 0.20，可调 0.10–1.00。三个模式分别记住本次窗口内的强度。原版 Wan 及其附加 LoRA 开关仍可选择，Qwen 路线保留。

SmoothMix 与 Wan 共用原图画风分析。明确识别为动漫、漫画或卡通媒介时添加 `smoothmixanime, anime style`；不会根据场景里出现“动漫海报”等关键词改变整个画风，也不会统一添加写实提示词。其他媒介沿用分析得到的风格描述。

验证结果：

- 22 项相关测试通过，覆盖三个模式的选择与参数传递、SmoothMix 独立模型依赖、风格提示选择，以及原版 Wan / Qwen 回归。
- 通过生产 `runImageWash` 编排完成 0.20 和 0.65 两次真实 8188 出图。画风分析复用已保存的普通插画描述，未重新调用 Prompt Assistant。
- `verification.json` 核对输入与输出 SHA-256、实际运行历史中的工作流，并确认安装包内代码与此次实测代码一致。
- `installer.json` 记录重新生成的 Windows 安装包路径、大小、时间和 SHA-256；版本号保持 2.3.214。
- 打包后 `check:runtime` 为 PASS。收尾时 4783 和 8188 均拒绝连接，`check:entry` 为 NO-GO；这发生在两次真实生成完成之后，入口验收与出图记录分别保留。

本次只是接入已有候选路线。查看 `smoothmix-low.png` 和 `smoothmix-medium.png` 可见实际结果：中档仍有更亮、更光滑的材质倾向，未据此宣称全面替代原版 Wan。

测试入口：覆盖安装新包 → 洗图 → SmoothMix 洗图。

复现脚本：`tools/wan-image-wash-lora-smoke.cjs`，设置 `NF_WASH_SMOKE_MODE=smoothmix`。脚本保护已保存记录，避免覆盖或意外重跑旧结果。

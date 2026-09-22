# 智能补图 FP8 mixed 恢复核验（2026-09-22）

## 结论

用户补齐的 Qwen Image Edit 2511 FP8 mixed 已被当前 Runtime 识别，普通补图现有生产构建器会自动优先选中它，加载精度为 `default`。无需修改源码、重启 Runtime 或重新打包。

两张原失败样例的受控复测仍有偏色、接缝和错误结构。恢复模型可用性已完成，但补图效果问题未解决；不能把模型文件恢复或任务执行成功当作质量修复完成。

## 文件与生产入口

- 实际路径：`E:\NovaFlow\models\diffusion_models\qwen_image_edit_2511_fp8mixed.safetensors`。
- 文件大小：20,533,762,817 字节。
- Safetensors 头可解析，4,451 个 tensor，数据区偏移连续，声明数据长度与文件大小一致。包含 BF16/F32/FP8 张量及量化元数据；并未校验发布者提供的校验和，不能据此证明所有权重字节正确。
- `/object_info/UNETLoader` 同时列出 BF16 与 FP8 mixed。
- 使用 `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/spine-split-runtime.js` 中真实 `resolveInpaintWorkflowRoute` 和 `defaultQwenInpaintWorkflow` 构建工作流。
- 实际选中 `qwen_image_edit_2511_fp8mixed.safetensors`，`weight_dtype=default`，普通补图没有走 Rapid AIO。
- 源码、renderer、dist 的 `spine-split-runtime.js` SHA-256 一致：`3205753c610709ad2409563b7fb819fea3b67b83fbc8f6ee094c014facafe452`。
- `python tools/check_4783_runtime.py`：Overall GO。这个结果只证明入口与运行文件一致。

## 受控生成

复用历史失败任务的输入文件、蒙版、完整提示词、种子 `746924259`、6 步、CFG 1、Euler/simple、denoise 1 和 FP32 Lightning LoRA。逐字段比较新旧图，仅模型文件、加载精度、输出文件前缀不同。未调整提示词、蒙版、采样或风格配置。

| 样例 | 原始任务 | FP8 mixed 任务 | 生成用时 |
| --- | --- | --- | --- |
| 柔和厚涂腿部 | `e78b8a66-ebc7-4997-931e-e3e57e747075` | `d1f92dce-8f69-4441-915e-5c43d34ec45d` | 48.109 秒 |
| 武士双腿 | `c2eb067d-d990-4b13-a01d-fba47e700a76` | `24de0263-246f-4211-a79f-3a7009fef67e` | 52.131 秒 |

两次 Runtime 生成均成功。腿部原始输出仍生成双腿和裙子，并采用明显偏粉、高亮的硬阴影上色；武士结果与原失败输出相近。

## 回贴与可见效果核对

按生产顺序将生成图片缩放到原 crop 尺寸，使用原 RMBG-2.0 配置提取 alpha，再调用生产函数 `qwenRgbWithRmbgAlpha`、`fullCanvasWithLayerMask`，最后叠加原始 crop。Canvas 回放使用 `@napi-rs/canvas`，并非重新操作桌面界面。

- 腿部 RMBG 任务：`9d230288-9f34-440b-9492-28226ec3b52b`。
- 武士 RMBG 任务：`82c4fe88-f2de-4beb-8d67-e19b6982c683`。
- 腿部回贴后仍有肤色断层、偏亮的大片补图及另一条腿被蒙版裁出的细条。
- 武士回贴后仍可见补图区和原腿的色差接缝。
- 没有证明安装客户端交互效果或既往正常版本质量已经恢复。

本地工作流、历史记录与对照图片保存在未纳入版本控制的 `docs/completion-fp8-restore-20260922/`。三列对照依次为原 crop、原 BF16 强制 FP8 结果、恢复 FP8 mixed 后结果。

## 对前序诊断的修正

模型文件及加载方式确实与此前配置存在差异，但这次受控复测不支持“只补齐 FP8 mixed 就能解决偏色和乱生结构”。前序将模型恢复不完整作为主要嫌疑的判断需要收窄。后续应继续追查实际正常版本的完整工作流及参考条件，不能未经对照就把旧预处理或提示词认定为新回归原因。

本轮未修改生产源码、模型选择策略或用户已有图层，也未回退 Rapid AIO。

## 补充：按用户指定的 8 月初版本追溯

发现更早的直接证据后，应修正“原智能补图就是 2511”的前提：

- `logs/debug.log:14924-14928` 记录 2026-07-11 16:03：智能补图从 2509 改为 2511 后，腿部等大面积补全出现明显肤色色差，因此仅智能补图恢复 2509；局部编辑 Edit V5 保持 2511。
- 这段记录也出现在 2026-08-03 的会话工具输出中（任务 `019fc633-7fff-72c0-b8f0-da2cdfad42e2`，原日志第 5689 行），不是今天新补写的推断。
- 2026-07-11 的原对话中，用户先反馈“之前2509颜色就没问题”，随后明确要求“智能补图恢复 2509，模型我已经加回去”（任务 `019f4d3b-8e94-76b3-87e9-1f08055454da`，原记录第 812、856 行）。
- 仓库最早可用的 2026-08-15 基线 `ca3db09` 和 9 月迁移前文件备份均保留相同分工：普通 completion 硬指定 2509，Edit V5 使用 2511。

历史普通智能补图组合为 `Qwen-Image-Edit-2509_fp8_e4m3fn.safetensors` + `eigen-banana-qwen-image-edit-2509-fp16-lora.safetensors` + `Qwen-Image-Lightning-8steps-V2.0.safetensors`，8 步、CFG 1、Euler/simple。当前 2511 + 2511 Lightning、6 步并不等同于这套历史补图组合。

因此，后续恢复应以这个明确记录的普通补图组合为基准；不能把 Rapid 的输出或接缝补丁作为该基准。本轮曾尝试在本地把现有 Rapid 专用接缝处理接入普通补图，用户排除该方向后已撤回全部相关源码和测试改动，未同步到 renderer、dist 或安装目录。

当前已核对的 `E:\NovaFlow\models` 中保留 eigen-banana LoRA，但未找到上述 2509 主模型及 8steps V2 LoRA。本轮仅核查和记录，未切换模型、下载缺失权重或改动安装版。尚未找回用户指定那次成功生成的完整图和工作流，不能声称逐像素复现了 8 月初效果。

## 用户补齐 2509 组合后的验证

用户随后补齐缺失文件，当前已核对：

| 文件 | 大小（字节） |
| --- | ---: |
| `diffusion_models/Qwen-Image-Edit-2509_fp8_e4m3fn.safetensors` | 20,430,635,136 |
| `loras/eigen-banana-qwen-image-edit-2509-fp16-lora.safetensors` | 472,047,184 |
| `loras/Qwen-Image-Lightning-8steps-V2.0.safetensors` | 1,698,951,104 |

三者 Safetensors 头、连续数据偏移和文件声明长度检查通过，Runtime 已列出全部文件。未做发布者校验和验证。

直接读取 `C:\Program Files\NovaFlowPortable\resources\app\renderer\spine-split-runtime.js` 的已安装代码构建普通补图图，与 `ca3db09` 历史构建器在相同 Runtime schema、输入、蒙版、提示词、种子下输出的工作流逐字段完全一致：2509 主模型、默认加载精度、两枚 LoRA 各强度 1、8 步、CFG 1、Euler/simple、denoise 1。源码和安装目录均不需要修改；普通补图每次获取模型列表后优先选 2509。普通局部编辑的构建结果仍为 2511 FP8 mixed。

- 对照来源：用户最新 2511 任务 `8d427bf9-9e5a-4ca7-b934-0888f1fc25b0`。
- 2509 复测任务：`3287da12-e4e5-430a-81da-1df33df1442f`，成功，64.159 秒。
- RMBG 任务：`8012c064-1800-4678-9b29-f819b431e387`，成功。
- 最终回贴使用已安装代码的 `canvasFromDataUrl`、`qwenRgbWithRmbgAlpha`、`fullCanvasWithLayerMask`，Canvas 回放采用 `@napi-rs/canvas`；未加入任何额外调色、羽化或 Rapid 接缝算法。
- 目视对照：2509 相比同输入的 2511 输出，左腿膝盖附近色阶断层减轻，右腿颜色和明暗更接近原图；局部差异仍存在，不宣称完美复现既往结果。

本地原始工作流、执行记录和三列对照图位于未纳入版本控制的 `docs/completion-2509-restore-20260922/`，对照图为 `samurai-comparison.png`（原 crop / 2511 / 恢复 2509）。没有重新安装、重启用户软件或修改现有图层；再次执行普通智能补图即可使用已补齐的组合，旧生成图层不会自动重算。

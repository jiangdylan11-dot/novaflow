# 万物迁移改用 Qwen-Image-2.1 与 2511 bf16 淘汰核验（2026-09-24）

## 结论

- 万物迁移在算力节点带 Qwen-Image-2.1 权重时改走 2.1（`objectTransferEngine` 读本地助手能力快照里的 `qwenImage21`），没有 2.1 的节点仍走 2511，但 2511 优先选 `qwen_image_edit_2511_fp8mixed.safetensors`，bf16 只剩后备名。
- 同一输入、同一种子的三次实机对比里，2.1 三次都把物体放在拖放位置、画面其余部分保持；两份 2511 权重（bf16、fp8mixed，加载时都被转成 fp8_e4m3fn）三次都在物体和人物脚下画出黑色硬影，武士场景那次 fp8mixed 还把猫整个抹掉了。
- 另外三处写死 bf16 的地方一并改为 fp8mixed：LoRA 检查基准（`particle-editor-desktop/main/qwen-lora-catalog.js`，bf16 作为文件缺失时的后备）、UI 设计旧 2511 链路（`ui-design-local.workflow.js`）、绘图图生图 2511 模板（`novaflow-brand-runtime.js`）。两份 2511 文件的 846 个二维权重名称与形状完全一致，本机 16 个 Qwen LoRA 用两份基准检查的结论逐一相同。

## 实测

工具：`docs/object-transfer-qwen21-20260924/ot-harness.cjs`（未纳入版本控制的证据目录）在 Node 沙盒里跑 `novaflow-web/renderer/spine-split-runtime.js` 的真实流水线——RMBG 抠图 → 画风转换 → 摆放合成板 → 整合生成 → 解码回原尺寸——对本机 ComfyUI 0.37（8188）逐引擎执行。2.1 的整合图与画风转换图和源码里 `buildObjectTransferQwen21Workflow` / `buildObjectTransferRestyleWorkflow` 生成的图逐字段一致（去掉种子、文件名后比较）。

"框外差" 是结果与原图在物体框以外的平均 |RGB 差|/255，衡量整幅画被重画的程度；"框内差" 仅供参考（fp8mixed 在武士场景把猫抹掉后框内反而接近原图）。

| 场景 | 种子 | 引擎 | 框外差 | 框内差 | 画风转换 / 整合用时 | 目视 |
| --- | --- | --- | ---: | ---: | --- | --- |
| A 女神台阶 756x1137 + 猫 | 9122026 | bf16 | 9.22 | 32.78 | 复用探针任务 / 107.6 s | 猫下和人物脚下各一块黑影 |
| A | 9122026 | fp8mixed | 17.00 | 40.86 | 135.6 s / 102.7 s | 黑影更大，地面出现亮斑 |
| A | 9122026 | 2.1 | 3.59 | 20.08 | 118.6 s / 107.5 s | 猫在原位，柔和接触影，画面其余不变 |
| A | 424242 | fp8mixed | 10.99 | 32.57 | 158.2 s / 96.9 s | 两条拉长的黑影 |
| A | 424242 | 2.1 | 9.82 | 23.46 | 118.3 s / 113.0 s | 猫在原位，柔和接触影 |
| B 武士草地 626x1360 + 猫 | 9122026 | fp8mixed | 11.43 | 11.28 | 143.6 s / 103.3 s | 猫被抹掉，只剩黑斑 |
| B | 9122026 | 2.1 | 9.74 | 34.02 | 126.1 s / 106.0 s | 猫在原位，画面保持 |

2.1 参数：`UnetLoaderGGUF` qwen-image-2.1-UC-Q8_0 + Qwen3-VL w4a8 + 2.1 VAE，`TextEncodeQwenImage21` resolution 0，图 1 为摆放合成板、图 2 为未动的原画，采样器直接用编码器输出的 latent，25 步、CFG 1、euler/simple、denoise 1，`SplitImageWithAlpha` 去掉 alpha 后保存；合成板尺寸在 2511 板基础上向上取到 32 的倍数（`qwen21EditPlateSize`），编码器不会重采样。用时含模型换入；两台模型交替加载时画风转换一步要 2 分钟左右。

## 未做与限制

- 网页/本地助手的算力任务白名单（`packages/shared/src/workflow-modules.mjs`）目前只放行 `spine-split-runtime` 的 `defaultQwenInpaintWorkflow` 与 `defaultRmbgWorkflow`；万物迁移记录的是私有构建器 `buildQwenEditPlateWorkflow` / `buildObjectTransferQwen21Workflow`，提交时会被本地助手以“不支持的工作流”拒绝，浏览器端 `comfyAllObjectInfo` 也拿不到节点目录。这是改动前就存在的缺口，本轮未扩白名单；接入需要在算力端加一个自己读节点目录的异步包装构建器并计价。
- 桌面旧副本 `particle-editor/` 未同步（`particle-editor-desktop/tests` 读的是它；其中 object-transfer-scene-composite 在 HEAD 上就因 CRLF 失败）。
- 未删除任何模型文件；`E:\NovaFlow\models\unet\qwen_image_layered_control_bf16.safetensors`（40.8 GB，图层拆分用）不在本次范围。

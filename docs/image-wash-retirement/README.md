# 取消洗图功能及专用模型

按用户要求移除整个洗图功能。当前目标是通过现有图片反推与图生图完成重新创作，停止维护单独的洗图流程。本次没有改造图生图，也没有重跑旧洗图实验。

## 程序改动

- 删除洗图工具入口、状态文案、动作分发、弹窗、手动提示词与 LoRA 设置、生成工作流和调试导出。
- 删除专用画风分析及缓存、桌面和预览服务中的洗图分支。
- 删除未启用的 Wan 重绘实验节点及其打包、同步清单；新安装包不再携带这些文件。
- 将共用的 Rapid checkpoint、模型名称匹配和分镜参考图反推独立命名并保留。扩图、角度调整、万物迁移和分镜生成工作流与移除前逐节点一致（随机种子归一化后比较）。

## 已删除模型

| 文件（相对 E:\NovaFlow\models） | GiB |
| --- | ---: |
| unet\Wan22\Wan2.2-T2V-A14B-LowNoise-Q4_K_S.gguf | 8.146 |
| text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors | 6.273 |
| loras\Wan21\Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors | 0.588 |
| loras\wan22-k3nk4llinon3-15epoc-full-low-k3nk.safetensors | 0.286 |
| vae\wan_2.1_vae_fp8_e4m3fn.safetensors | 0.118 |

共 5 个文件，16,547,486,148 字节（15.411 GiB）。均已核对实际路径、文件大小、时间和 SHA-256；文件链接数均为 1。删除前后 E 盘可用空间增加 16,547,500,032 字节。详见 model-audit.json、model-hashes-before.json、deleted-models.json。

Remix T2V Q5、SmoothMix T2V v4 此次检查时已不存在，没有重复计算释放空间。

## 保留依赖与验证

- 从当前页面实际加载的 index-BbIa-2NM.js 提取并执行视频工作流选择器：图生视频与首尾帧均使用 SmoothMix I2V High/Low、umt5_xxl_fp16.safetensors、wan_2.1_vae.safetensors 和 clip_vision_h.safetensors。这些文件均保留。
- 删除候选项从 object_info 中排除后，保留的视频模板和 4 个图像工具仍能解析所需模型；Wan2.2 视频 LoRA 目录内容保持一致。Rapid、Qwen 图像编码器及其他共用模型保留。
- 主模型被 Runtime 内存映射占用，普通 /free 无法解除文件锁。确认队列为空及 8188 PID/可执行路径后，只停止该 Runtime，删除文件，再用原 start-runtime.bat 恢复。删除后 8188 正常响应，5 个文件从文件系统和实时模型列表中消失，保留依赖仍可识别。见 postcheck.json。
- 27 项测试通过：洗图移除、分镜反推、Rapid 图像工具、视频工作流与 LoRA 目录等。Python 语法检查、check:runtime 和包内源码一致性检查通过。
- 1 项广泛的旧提示词发布测试仍失败：prompt-assistant-release-contract.test.js 的 Art 提示词保留辅助函数提取边界已过时（第 682 行）。其所检查的 novaflow-smart-ai.js 本次未改动；未将这个问题算作通过。
- check:entry 仍为 NO-GO：4783 入口不可达，且报告既有 AI 特效接入不完整。此次验证没有重新生成视频或完成正式预览界面验收。

## 安装包

NovaFlow Setup 2.3.214.exe 已按不升版本号流程重新打包，包内没有洗图入口、工作流或专用节点。安装后当前客户端才会显示移除后的界面。

- 路径：D:\AI_APP\NovaFlow\particle-editor-desktop\dist\NovaFlow Setup 2.3.214.exe
- 大小：250,101,575 字节
- SHA-256：7ad774b208dbdd3b61aff043f9f7eecec6e91146c181c52d0075137632585f54
- 包内源码及删除后检查记录：postcheck.json

# NovaFlow 模型库只读审计 — 2026-09-12

> 执行更新：用户已授权删除。14 个清单内权重文件已全部删除，释放 99.348 GB（约 92.53 GiB），模型库现剩 352 个文件、300.474 GB。其余 352 个审计文件均存在且大小未变。删除后重新获取 Runtime 列表，主模型加载器已不再列出删除项；9 条工作流构建通过，15 个 Qwen LoRA 仍兼容。部分其他自定义节点仍缓存旧文件名，记录在删除日志中，文件本身已不存在。没有提交推理，不能据此声称完成全部功能出图回归。
>
> 删除日志：[deletion-result.json](deletion-result.json)。以下清单及 inventory.csv 为删除前审计快照。

范围：`E:\NovaFlow\models`。共 366 个文件，399.822 GB（372.363 GiB）。按文件逻辑字节统计；磁盘实际释放量会受文件系统分配/压缩影响。模型目录未发现重解析链接。

建议清理 14 个权重文件，共 **99.348 GB**（92.525 GiB，约 24.8%）；清理后剩 300.474 GB。另有 0.000 GB 二级候选，不计入推荐合计。

仅针对当前 NovaFlow 内置功能。审计阶段未操作模型；随后已按用户授权执行删除，详情见上方执行更新。没有更改软件代码，没有提交推理。用户外部 ComfyUI 和已保存自定义工作流未逐份审计。

## 建议清理清单

| 模型库内路径 | GB | 依据 |
|---|---:|---|
| `clip_vision\CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | 1.264 | 与clip_vision_h.safetensors完整SHA-256相同，非同一硬链接；保留短文件名满足视频及优先回退 |
| `diffusion_models\qwen_image_edit_2511_bf16.safetensors` | 40.861 | 当前内置Qwen编辑统一走Rapid；旧UI质量配置残留不代表当前Rapid工作流依赖 |
| `diffusion_models\wan2.1_vace_1.3B_fp16.safetensors` | 4.310 | 当前产品入口和活动bundle无调用；旧特效V2V实验脚本仍加载。用户已明确不需要重跑这些旧实验，因此纳入清理清单；共用UMT5和Wan VAE保留。已按用户授权删除该权重 |
| `loras\eigen-banana-qwen-image-edit-2509-fp16-lora.safetensors` | 0.472 | 旧独立Qwen工作流配套，当前Rapid无此依赖；不在当前Qwen用户LoRA目录内 |
| `loras\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | 0.850 | 旧独立Qwen工作流配套，当前Rapid无此依赖；不在当前Qwen用户LoRA目录内 |
| `loras\Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors` | 0.850 | 旧独立Qwen工作流配套，当前Rapid无此依赖；不在当前Qwen用户LoRA目录内 |
| `loras\Qwen-Image-Lightning-8steps-V2.0.safetensors` | 1.699 | 旧独立Qwen工作流配套，当前Rapid无此依赖；不在当前Qwen用户LoRA目录内 |
| `loras\minimax_h3\lightx_768\minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors` | 1.956 | 当前两个H3 TURBO主模型不自动加载此目录；当前LoRA目录接口明确排除加速类LoRA |
| `loras\minimax_h3\lightx_768\minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | 1.956 | 当前两个H3 TURBO主模型不自动加载此目录；当前LoRA目录接口明确排除加速类LoRA |
| `loras\minimax_h3\lightx_768\minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` | 1.956 | 当前两个H3 TURBO主模型不自动加载此目录；当前LoRA目录接口明确排除加速类LoRA |
| `loras\minimax_h3\lightx_768\minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | 1.956 | 当前两个H3 TURBO主模型不自动加载此目录；当前LoRA目录接口明确排除加速类LoRA |
| `unet\qwen_image_edit_2511_fp8mixed.safetensors` | 20.534 | 当前内置Qwen编辑统一走Rapid；旧UI质量配置残留不代表当前Rapid工作流依赖 |
| `unet\Qwen-Image-Edit-2509_fp8_e4m3fn.safetensors` | 20.431 | 当前内置Qwen编辑统一走Rapid；旧UI质量配置残留不代表当前Rapid工作流依赖 |
| `vae\qwen_image_vae.safetensors` | 0.254 | 旧独立Qwen工作流配套，当前Rapid无此依赖；不在当前Qwen用户LoRA目录内 |

## 不能随旧 Qwen 一起删除

- Rapid v20：文生图NSFW、图生图、局部编辑/补图、扩图、迁移、角度、UI、分镜及AI特效。
- `qwen_image_layered_control_bf16.safetensors`（40.861 GB）、`qwen_image_layered_vae.safetensors`、Qwen 2.5 VL编码器：分层拆图。Layered与Edit不是重复模型。
- SeeThrough 两个模型目录（约13.44 GB）：另一套分层/深度拆图。
- 两份 SmoothMix Wan22 高低噪声、UMT5 FP16、Wan VAE、clip_vision_h：当前视频模板。
- Wan22 GGUF、Wan21蒸馏LoRA、UMT5 FP8、Wan FP8 VAE：普通洗图。
- H3 TURBO INT8与W4A8：当前两个可选档位；32B编码器及音视频VAE仍需保留。两档主模型不能当作相同文件删除。
- Ideogram主模型、Qwen3VL 8B、flux2 VAE：普通文生图。
- fill-dev-OneReward、removal LoRA、CLIP-L、T5及ae VAE：去除物体。
- RMBG-2.0、BiRefNet及SAM：智能抠图/参考图/分割和兼容回退。部分备用模型未逐项证明可无损删除，不计收益。
- SEEDVR2：高清放大。ControlNet Union：AI特效。SDPose：姿态参考提取，名称由代码动态匹配。
- 提示词助手量化缓存约6.39 GB：本地提示词/反推仍可能依赖，保留。
- Qwen目录15个LoRA均通过已安装版Rapid兼容目录检查；H3内容LoRA仍在可选目录，不能因没有硬编码名称判为无用。
- MiDaS、RMBG-1.4、备用BiRefNet/SAM、IPAdapter和SigCLIP归为保留待定，不能把它们的容量算入确定可释放空间。

## 证据与验证边界

1. 读取运行配置和8188 system_stats，确认当前模型根目录为E:/NovaFlow/models；获取1983个节点的object_info。当前history为空，不构成近期实际使用证明。
2. 搜索源码、已安装renderer/main、index.html实际加载的index-BbIa-2NM.js。对动态选择路径检查SDPose、ControlNet、LoRA目录、RMBG、SAM和SeeThrough。没有以文件名零匹配直接判定所有文件可删。
3. 将建议项及VACE从object_info枚举中内存排除，使用已安装版真实构建函数检查9条图：补图、编辑、去除物体、扩图、迁移、角度、AI特效、普通洗图、Rapid洗图。均正常构建，未提交生成。此验证不等于所有功能的端到端推理回归。
4. 通过已安装版LoRA目录函数确认15个Qwen内容LoRA兼容Rapid；H3当前接口排除所有加速类，四份lightx_768未被内置H3默认图引用。
5. 对所有大于10MB的相同长度文件组做完整SHA-256。唯一相同内容组是两份CLIP Vision；逐个fsutil hardlink list确认它们是两份独立文件。Qwen两份VAE的哈希不同，单独qwen_image_vae的清理依据是无当前独立加载依赖，而非重复。
6. UI质量配置保留旧2511常量，但当前传入Rapid checkpoint会强制选择Rapid采样路径，不加载旧UNET或Lightning。已保留该残留说明，不能仅凭常量存在或不存在判断用途。

完整366文件清单见 [inventory.csv](inventory.csv)，其中“保留待定”不是“确定必需”，也不是“可删除”。

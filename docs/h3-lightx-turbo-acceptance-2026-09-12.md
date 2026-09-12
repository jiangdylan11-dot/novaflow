# H3 独立 Turbo 配置验收

> 历史记录：此配置已按用户要求撤回，原有测试数据仅作留档。当前界面不再提供 LightX 新版配置。额外下载的四份 LightX 权重删除曾被自动审批拦截，不能视为已清理。后续 beta5 配置直接使用用户提供的两份本地基模，不依赖这四份权重。

本次交付是通用 H3 Turbo 配置。沿用已安装的 H3 FL2VA / Ref2VA INT8 基模，新增官方 LightX2V Turbo 适配权重、配套采样流程及独立参数档案。原版仍可切换使用。验收素材为水面玩具帆船，不包含 NSFW 能力验收。

## 使用入口

打开 `http://127.0.0.1:4783/`，进入 **动画 → AI序列动画 → 模式选择 → MiniMax_h3**，在底部 **H3 版本** 选择 **H3 Turbo 768p（新版）**。

- 4 步为快速档；8 步使用独立的 8 步适配权重。
- 文生、图生、首尾帧使用 FL2V 权重；多参考使用 Ref2V 权重。
- 画幅、分辨率、时长、FPS 和步数分别保存到两个配置，点击生成时固定当次参数。
- `768p` 指新版 FL2V 权重系列，不强制输出尺寸；实际输出以分辨率选择框为准。Ref2V 4 步沿用该系列官方 v0.1 权重。
- 默认仍为 480×864、5 秒、24 FPS、4 步。原版保留旧 Turbo 0.75 和原有步数能力。

## 安装情况

Runtime：`C:\ProgramData\NovaFlow\AI-Runtime-H3`，ComfyUI 0.31.1，端口 8189。此版本已包含 `MiniMaxH3SigmaShift` 等全部节点，无需安装额外自定义节点包。

模型实际目录：`E:\NovaFlow\models\loras\minimax_h3\lightx_768`。四个文件总计约 7.82 GB，均完成大小与 SHA256 校验。下载仓库固定到 `lightx2v/Minimax-h3-Turbo@3ec17a324ced54151364f24f8b5fb6bf7e26414f`。

| 模式 | 步数 | 权重版本 | 视频 / 音频 shift |
| --- | --- | --- | --- |
| 文生 / 图生 / 首尾帧 | 4 | FL2V v1.1 768p | 6 / 3 |
| 文生 / 图生 / 首尾帧 | 8 | FL2V v1.0 768p | 6 / 3 |
| 多参考 | 4 | Ref2V v0.1 | 12 / 3 |
| 多参考 | 8 | Ref2V v1.0 768p | 6 / 3 |

新版使用 Euler、simple scheduler、Turbo strength 1.0。内部加速权重不能再作为用户 LoRA 重复添加。基模、编码器与 VAE 未重复下载。

来源：[官方工作流及参数说明](https://github.com/ModelTC/Minimax-H3-Turbo)、[官方权重仓库](https://huggingface.co/lightx2v/Minimax-h3-Turbo)。

## 真实验收

硬件：RTX 4090 Laptop 16GB，系统内存 64GB。完整结果保存在 `C:\ProgramData\NovaFlow\AI-Runtime-H3\generated\lightx-acceptance`。

通过真实 NovaFlow 界面提交的 480×864 / 5 秒 / 24 FPS / 4 步任务：

- Prompt ID：`100c7fc5-537c-4fc5-b91e-2ad5784e9b62`
- Runtime 实际耗时：96.21 秒。
- 已自动加入临时仓库、回填画布并验证播放；资源卡显示“生成96S”。
- 视频：`C:\ProgramData\NovaFlow\AI-Runtime-H3\generated\output\video\MiniMax_H3_t2v_00010_.mp4`。

另完成文生、图生、首尾帧、多参考四种 4 步模式，以及 FL2V / Ref2V 两种 8 步权重的实际出片测试。短测为 576×352、请求 1 秒，H3 对齐后输出 39 帧 / 1.625 秒。此对齐继承原有时长规则。

速度结果受首次加载、缓存、分辨率和解码影响，不能将短测耗时外推为所有场景的加速比例。8 步质量档通常需要更多计算。

同提示词、同种子 `20260914`、同 576×352 / 39 帧 / 24 FPS / 4 步的热缓存对照：原版 **10.809 秒**，新版 **11.107 秒**。两次基模、编码器和条件节点均已缓存；此短测没有证明显著提速，不能承诺新版比原版快。因此保留原版默认入口，由用户比较画质后选择。此前 22.93 / 14.96 秒的顺序运行缓存状态不同，不作为加速结论。

| 实测案例 | Runtime 执行时间 | 状态 |
| --- | ---: | --- |
| 新版文生 4 步首次运行 | 37.27 秒 | 音画 MP4 成功 |
| 新版图生 4 步 | 20.63 秒 | 音画 MP4 成功 |
| 新版首尾帧 4 步 | 22.39 秒 | 音画 MP4 成功 |
| 新版多参考 4 步 | 29.95 秒 | 音画 MP4 成功 |
| 新版文生 8 步 | 36.47 秒 | 音画 MP4 成功 |
| 新版多参考 8 步 | 39.61 秒 | 音画 MP4 成功 |
| 界面 480×864 / 请求 5 秒 / 4 步 | 96.21 秒 | 回填画布、临时仓库及播放成功 |

耗时取 Runtime 的 execution_start / execution_success 时间戳，排除脚本轮询间隔。`media-report.json` 保存每次 Prompt ID、缓存节点与 ffprobe 音视频检查；`first-last-contact-sheet.jpg` 为各模式首尾帧检查图。5 秒界面样片实际为 H.264 + AAC、124 帧、24 FPS、约 5.167 秒。

## 回归及打包

- 新增配置测试覆盖全部 8 个模式/步数组合、错误权重/shift 拒绝、用户 LoRA 链路以及配置参数隔离，已通过。
- 原版工作流测试、提示词工作流 18 项已通过。
- 界面契约 13 项通过；2 项旧基线断言仍失败：美工模块固定哈希、品牌脚本旧缓存版本。它们对应本次开始前已存在的工作区改动，本次没有覆盖这些实现或把这些检查改成无条件通过。
- `check:runtime` 通过，打包后 `check:entry` 通过，4783、8188、8189 均实际可用。
- 已完成 `build:win:nobump`，安装包版本保持 2.3.214；未签名。
- 安装包：`particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`。
- SHA256：`24563FD93E8AC5AA9FCD9EAEC56631FB44E395A875B2C193E65C66AF5C94D59B`。
- 同版本旧安装包保存在 `.exe.before-h3-lightx`，工作区无自动提交。

模型在本机 Runtime 中，约 7.82 GB 权重不内嵌到 NovaFlow 安装包。迁移到其他机器时需先有兼容 H3 Runtime 和基模，再运行下列安装器。

## 复查命令

在仓库根目录执行：

```powershell
& C:\ProgramData\NovaFlow\AI-Runtime-H3\engine\python\python.exe tools/ai-runtime-h3/install-lightx-turbo.py --verify-only
node particle-editor-desktop/tests/ai-sequence-h3-lightx-profile.test.js
node particle-editor-desktop/tests/ai-sequence-minimax-h3-workflow.test.js
npm run check:runtime
npm run check:entry
```

`tools/ai-runtime-h3/lightx-turbo-manifest.json` 记录完整文件名和校验值；`install-lightx-turbo.py` 可重现下载和校验。`build-lightx-smoke.cjs`、`run-lightx-smoke.py`、`report-lightx-smoke.py` 用于复现本次生成及音视频流检查。再次提交测试前应确认 Runtime 队列为空。

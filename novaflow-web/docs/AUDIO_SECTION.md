# 音频版块（游戏循环背景音乐 / 游戏音效）

2026-10-07 新增。本地算力节点生成，暂未接入正式控制面（共享池/线上站点仍需后续部署协议副本）。

## 选型

| 用途 | 模型（内部，界面不显示） | 文件 | 许可 |
| --- | --- | --- | --- |
| 背景音乐 | Stable Audio 3.0 Medium（1.4B，44.1 kHz 立体声，最长 6:20） | `checkpoints/stable_audio_3_medium.safetensors`（9.2 GB） | Stability AI Community License，年收入 100 万美元以下可商用，产出归用户 |
| 音效 | Stable Audio 3.0 Small SFX（0.6B，可 CPU） | `checkpoints/stable_audio_3_small_sfx.safetensors`（2.3 GB） | 同上 |
| 文本编码 | T5Gemma | `text_encoders/t5gemma_b_b_ul2.safetensors`（1.2 GB） | 随模型 |
| 描述改写（中文→英文、补全乐器/氛围） | Qwen3.5 2B（ComfyUI 原生 TextGenerate 节点） | `text_encoders/qwen3.5_2b_bf16.safetensors`（4.5 GB） | Apache 2.0 |

模型均放在 `E:\NovaFlow\models`，来源 Hugging Face `Comfy-Org/stable-audio-3`、`Comfy-Org/Qwen3.5`（未门禁，直接下载）。对比下载的 ACE-Step 1.5 turbo（`diffusion_models/acestep_v1.5_turbo.safetensors` + `qwen_0.6b_ace15` + `ace_1.5_vae`）未接入，可删。

ComfyUI 0.37 原生支持该模型（`comfy/text_encoders/sa3.py`），采样 8 步 lcm/simple cfg 1。RTX 4090 Laptop 实测：30 秒音乐约 3–7 秒，音效 1–5 秒（含改写）。

## 自定义节点 `E:\NovaFlow\custom_nodes\novaflow_audio`

- `NovaFlowAudioSeamlessLoop`：按 BPM 裁成整小节，±120 ms 搜索与开头最相似的切点，头部与切点后的续写做等功率交叉淡化，峰值归一 -1 dBFS。`enabled=false` 时只裁长度加淡入淡出。
- `NovaFlowAudioSfxClean`：去首尾静音（-50 dB）、尾部 30 ms 淡出、峰值归一。
- `NovaFlowAudioCaption`：清理改写模型的输出（去 Output:/引号/多行），保留 BPM，末尾写入实际渲染长度 `Length: N seconds`。
- `NovaFlowSaveAudioWav`：标准库写 16-bit PCM WAV（运行环境无 torchcodec），把描述随输出条目回传。

改节点后需重启运行环境：`C:\ProgramData\NovaFlow\AI-Runtime\scripts\stop-runtime.bat` / `start-runtime.bat`。

## 任务链

- 协议：`audio_music` / `audio_sfx`（`packages/shared/src/protocol.mjs`，kind `audio`，自托管不计费），参数校验在 `control-plane.mjs`（prompt、duration_seconds、loop、bpm、crossfade_ms、reprompt）。
- 模板：`worker/workflows/audio_music.json`、`audio_sfx.json`。worker 在 `audioGraphExtras`（`workflow-runner.mjs`）里算渲染长度（循环版多渲染 3 秒给接缝）和改写提示词（`audio-reprompt.mjs`）。
- 输出：`comfy-client.collectOutputs` 收 `audio` 条目；`worker-core` 标 kind `audio` 并带 caption；网关返回 `audio/wav`。
- 模型清单：`audio-music`、`audio-sfx`（`model-manifest.mjs`），节点就绪才在 capabilities 里可用。

## 网页（2026-10-07 第二版：按动画版块骨架）

- 侧栏入口「音频」在「动画」正下方：`audio-studio.tool.js` 创建 body 级单元，brand runtime 的 `primaryRailSlotForIndex / primaryIndexForRailSlot` 把后面的「美工」「工具」下移一格（定位与点击命中都按槽位换算）。React 包只有四格，不能重建；打开时用遮罩盖住仍被 React 选中的原入口，点遮罩会把完整的 pointerdown→click 事件转给原入口。
- 布局与「动画」一致（1920 下实测坐标）：左卡片 x75 w218（模式切换「背景音乐 | 音效」+ 折叠行「音频生成」「音轨编辑」「导出」）；舞台 x302 起（左上工程标签 `audio_1`，右上缩放 % + 适应窗口）；舞台内是时间轴编辑器；展开「音频生成」时舞台底部出现生成坞（时长/BPM/无缝循环 或 时长/数量，开始生成，状态行 + 任务中止，描述框 + AI 润色）；最底是走带栏（⏮ ◀ ▶ ▶ ⏭ 循环，时间，BPM，吸附，缩放，导出混音，总览条）；右侧 206px 资源列表（上传资源，生成结果带波形缩略图，拖到音轨 / 双击加入 / 试听 / 下载 / 删除）。
- 时间轴编辑器 `audio-timeline.editor.js`（纯浏览器）：多音轨（名称、M/S、音量、增删），片段拖动换轨、边缘裁剪、拖过末尾即循环重复（虚线标接缝）、左上角小方块拖淡入淡出、播放头处分割（S）、删除（Delete）、复制、吸附到拍/小节，Web Audio 调度播放（整段循环），OfflineAudioContext 混音导出 16-bit WAV（进资源列表和仓库），单片段导出。
- 生成结果自动放到对应音轨（音乐轨 / 音效轨），资源列表和仓库各存一份（`Audio_日期_NNN.wav`）。仓库 `novaflow-web-warehouse.js` 新增音频类型（过滤、预览 `<audio>`）。

## 验证记录（2026-10-07）

- 后端：源码助手（4786，临时控制面 4895）创建任务 → ComfyUI → WAV 经网关取回；中文描述「森林关卡的背景音乐，轻松又有点神秘，竖琴和长笛」改写为英文 caption，30 秒循环版 12 小节/88 BPM。
- 网页：浏览器窗格内点击「音频」→ 生成音乐/音效（2 个变体）→ 结果卡片、波形、仓库待保存提示。
- 测试：`tests/e2e/audio-studio.test.mjs`（7 项）。

## 待办

- 正式链：部署 `supabase/functions/novaflow-web` 的协议副本后共享池才认识 `audio_*`；`package:site` / `build:win` 发布。
- 音效去静音阈值固定 -50 dB，极安静的音效可能保留尾部噪声。
- 改写模型偶尔添油加醋（如「海边」），已在提示里禁止臆造，仍可能出现；关掉改写走原描述（参数 `reprompt:false`，界面暂未暴露）。

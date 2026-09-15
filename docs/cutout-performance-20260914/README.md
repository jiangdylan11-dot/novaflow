# 视频抠图准备、保存与直接导出修复

2026-09-14，版本保持 2.3.214。

## 行为变更

- 视频抠图编辑中，从顶部导出入口或已有导出窗口提交导出，先调用同一条“保存并关闭”流程，资产提交并退出编辑后再继续原操作。连续点击和与手动保存重叠时共享保存任务；保存失败保留编辑状态，不继续导出。
- 准备帧改用独立解码器，在跳转前注册真实视频帧回调，继续严格核对目标时间。消除原先跳转完成后才监听回调、逐帧等超时的开销。
- 导出暂停播放并取消预览预渲染，避免共同缓存互相清空；一次预渲染失败不会自动无限重试。
- 重复 PNG 编码、SHA256 和快照诊断默认关闭。索引、蒙版与源帧一致性检查继续执行。需要详细诊断时设置 `window.__NOVAFLOW_AI_CUTOUT_DIAGNOSTICS__ = true`。
- 投影/光效混合保持原方程与参数，删除每像素、每种光色的临时数组分配和重复点积。保留之前的局部投影、材质、光效、边缘、擦除与修复行为。
- 仅内部保存启用 VP9 行并行和 4 线程；保持 CRF 30、原始尺寸和透明通道处理。
- 新 renderer 已保留完整捕获 RGB，明确请求 `returnMaskOnly: true`。后端仅在已验证的第 2 版捕获帧协议下省略两份中间预览视频编码，返回原二进制蒙版及完整帧对应关系；旧客户端仍使用原视频返回路径。

## 实测

固定素材为 `docs/cutout-key-parity-20260914/gloweyes/backend/job-IRKD3t/src_green-screen.mp4`：1080×1920，24 FPS，121 帧。对照顺序执行，固定使用同组真实模型蒙版（通过捕获 RGB 匹配），测试 IPC 与正式客户端一样传递二进制字节，不转换数字数组。

| 阶段 | 修改前 | 修改后 |
|---|---:|---:|
| 准备帧 | 42.43 秒 | 17.27 秒 |
| 透明帧合成与 PNG 写出 | 127.12 秒 | 85.12 秒 |
| 同一组透明 PNG 的 WebM 编码 | 17.13 秒 | 13.56 秒 |

前两项来自 `before-typed/report.json`、`final-typed/report.json`；编码来自 `encode-comparison.json`，均在 `logs/cutout-performance-20260914/` 下。前两项对照使用缓存蒙版，不包含实际模型推理。最初测试脚本的 `Array.from` 产生了额外 IPC 开销，旧 `before/after` 结果不作为正式对照。

真实 React 组件、保存协调器和正式 WebM 编码处理器验证：未播放、未手动保存、直接点击导出两次，121 帧只保存一次、继续一次；保存用时 97.59 秒，其中编码 14.01 秒。保存结果为 1080×1920、5.042 秒，播放器解码成功，编辑退出后源媒体可见。`auto-export-full/report.json` 保存证据。此测试验证继续导出动作，完整 PNG 导出另由生产 exporter 的 121 帧测试覆盖。

## 质量与验证边界

- 全分辨率第 0、1、30、60、119、120 帧，优化前后 RGBA、alpha、材质统计逐像素一致。基线代码及数据保存在 `logs/cutout-performance-20260914/baseline/`，结果为 `matting-parity.json`。
- 覆盖顶部入口、已有窗口、重复提交、与手动保存重叠、失败保留编辑、旧传输协议、投影、光效、轮廓及历史最多 15 条。
- `check:runtime` PASS；`check:entry` 仍为 NO-GO：4783 入口不可达，8188 直连成功，独立 AI effects takeover 项未完成。不把独立 Electron 测试当作已安装客户端的完整界面验收。
- 无降分辨率、删帧、替换模型或关闭投影/光效来换速度。实际耗时随视频长度、分辨率、材质复杂度和硬件变化，模型推理仍有独立耗时。

## 复核命令

`node --test particle-editor-desktop/tests/cutout-export-coordination.test.cjs particle-editor-desktop/tests/cutout-mask-only-contract.test.cjs particle-editor-desktop/tests/green-screen-matting.test.cjs particle-editor-desktop/tests/chroma-material-recovery.test.cjs particle-editor-desktop/tests/green-screen-alpha-encode.test.cjs particle-editor-desktop/tests/prompt-history-display-limit.test.mjs`

`node particle-editor-desktop/tests/cutout-matting-performance-parity.cjs --baseline logs/cutout-performance-20260914/baseline/matting.js`

Electron 测试入口：`ai-sequence-green-screen-video-smoke.cjs --performance-only`（固定蒙版加 `--ai-masks` 和对应 `--ai-mask-source-frames`，真实模型加 `--live-backend`）；保存协调测试：`cutout-preview-lifecycle-smoke.cjs --auto-export --encode-save`。

## 最终结果与安装包

- 40 项回归通过。实际安装的 RMBG-2.0 模型经正式 IPC 执行一次，返回 121 帧二进制 alpha（250905600 字节），无中间视频；同次运行导出 121 张透明 PNG，错误为 0。见 `live-ai-mask-only/report.json` 和 `backend/result.json`。这次完整链路耗时约 186.9 秒，其中准备 17.1 秒、后端 81.7 秒、PNG 输出 86.3 秒；后端包含模型启动、推理和蒙版打包，不能等同于纯推理时间。
- 安装包：`D:\AI_APP\NovaFlow\particle-editor-desktop\dist\NovaFlow Setup 2.3.214 - 视频抠图加速与导出修复.exe`
- 大小：250140499 字节；SHA256：`aafcec4c30d27c9368188e7cda074af52ed9722ce39f3e5ab8e7b48fdf7ed28c`。
- 从实际安装包提取的 17 个文件与源码一致，包内历史记录组件测试通过。保留上一版 H3/历史修复。
- 安装包未自动安装或替换正在运行的客户端；已安装客户端完整界面验收仍未完成。

# H3 beta5 SageAttention 2 加速适配

本次为两个现有 beta5 配置自动启用 SageAttention 2 注意力计算后端。模型文件、采样器、默认 4 步和用户 LoRA 权重保持不变；没有增加 Turbo LoRA，也没有提交视频生成任务。实际耗时、显存峰值和画面差异待用户验收，不宣称已实测提速。

## 使用方式

更新客户端后，动画 → AI序列动画 → MiniMax_h3 → H3 版本选择任一 beta5，即自动使用 SageAttention 2。按用户最新要求，界面不再显示加速开关，以前保存的关闭状态不再影响生成；提交、导出以及工作流 API 的 beta5 默认路径均启用。H3 原版不应用新节点。首次运行可能包含 Triton 内核编译，不能用首次总耗时推断稳定运行速度。

SageAttention 使用近似数值计算，不能保证与原后端逐像素一致，也不能保证改善 INT8 模型的动作和提示词表现。它只优化注意力计算；模型加载、显存搬运、文本编码和解码的耗时仍然存在。当前机器为 RTX 4090 Laptop 16GB。

## 已部署的本地引擎

- Runtime：`C:\ProgramData\NovaFlow\AI-Runtime-H3`，端口 8189。
- Python 3.12.10、PyTorch 2.10.0+cu130 保持原版本。
- 已安装 `sageattention 2.2.0+cu130torch2.9.0andhigher.post4` 和 `triton-windows 3.6.0.post26`，使用 `--no-deps`，未升级 PyTorch。
- 安装脚本：`tools/ai-runtime-h3/install-sage-acceleration.py`；下载文件、SHA256 和安装记录位于 Runtime 的 `generated/sage-packages`。
- 新节点 `NovaFlowH3SageAttention` 已复制到 Runtime 的 `custom_nodes/novaflow_h3_attention`；8189 的 `/object_info/NovaFlowH3SageAttention` 已返回该节点。
- 节点复制 MODEL 配置，仅设置该实例的 `optimized_attention_override`。不修改全局注意力选择，启动日志显示 `Using pytorch attention` 属于正常现象。
- 工作流顺序为基模 → 可选用户 LoRA → SageAttention → guider。关闭加速时不添加此节点。ComfyUI 的 Sage 后端遇到内核错误时可能记录日志并回退 PyTorch，届时不能当作成功加速。

源码与安装来源：[SageAttention](https://github.com/thu-ml/SageAttention)、[Windows wheel](https://github.com/woct0rdho/SageAttention/releases/tag/v2.2.0-windows.post4)、[Triton Windows](https://github.com/triton-lang/triton-windows)。

## 验证与交付边界

- 依赖导入通过，Sage 的 SM89 原生模块可用；没有运行 CUDA 数值测试。
- 两项 CPU 节点契约测试通过。
- 20 项所选 H3 工作流和界面契约检查通过，覆盖两个 beta5、三个模式、LoRA 链路、开关隔离和默认值；两个既有非本次范围的界面断言未纳入统计。
- 主 bundle 语法检查通过，源码、renderer、活动 win-unpacked 的 runtime 一致性检查 PASS。
- 本轮 4783 入口未启动，`check:entry` 为 NO-GO；8188 直接探测可达。启动 4783 预览服务的操作被自动审批拒绝，仅返回 blocked by policy；未绕过该限制。因此没有完成本轮浏览器交互验收。
- 最新自动启用版采用独立 `particle-editor-desktop/dist/h3-sage-auto-update` 输出目录构建，不清理活动 win-unpacked。版本保持 2.3.214。20 项所选检查再次通过，语法与 runtime 一致性检查通过；本次没有重新进行生成测试。
- 正式安装目录 `C:\Program Files\NovaFlowPortable` 在前次部署中已被 Windows 拒绝写入；本轮没有修改它。用户需使用更新后的 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe` 覆盖安装并重开客户端。此机器的 Runtime 依赖和节点已单独安装，不依赖客户端安装包再下载；安装包并非向其他机器分发这些 Python 依赖的完整 Runtime 包。

用户正常使用无需配置加速开关。内部工作流 API 保留显式 `acceleration: 'off'` 作为开发诊断途径，产品界面不暴露；实际对比应固定模型、提示词、输入、种子、分辨率、帧数、步数和 LoRA，分别记录首次与后续生成耗时和画面表现。

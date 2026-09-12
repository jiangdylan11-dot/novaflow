# H3 beta5 TURBO 双模型替换

用户提供的两份本地 TURBO 权重替换原来两个 beta5 选项的模型引用，未删除或改写原文件。没有下载模型，没有提交生成任务。

| 界面选项 | diffusion_models 下的相对路径 | 字节数 |
| --- | --- | --- |
| H3 beta5 TURBO · INT8 | `Minimax_H3\10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors` | 20970414464 |
| H3 beta5 TURBO · W4A8 | `Minimax_H3\10Eros_Max_h3_TURBO-hybrid_beta5_w4a8_14gb_optimized.safetensors` | 13997668774 |

实际模型根目录为 `E:\NovaFlow\models\diffusion_models`。8189 的 `object_info/UNETLoader` 已列出上述两个精确名称。文件头分别包含 734 / 1294 个张量；最大数据末端与各自文件长度一致。该检查不等同于来源哈希认证或推理质量验证。

为保留用户已保存的参数，内部配置 ID 仍是 `beta5_int8` 和 `beta5_fp8`，后者界面已准确标为 W4A8。默认 4 步，已有自定义步数继续保留；本次没有调整采样器或调度器。SageAttention 自动启用，不显示开关；不额外添加 Turbo LoRA。H3 原版配置保持不变。

20 项所选 H3 工作流和界面契约检查通过，包含两个模型的三个视频模式、LoRA 链路与 SageAttention 路径。两个既有无关界面断言未纳入本次检查。bundle 语法与源码、renderer、win-unpacked 同步检查通过。模型文件及 Sage 节点均已在 8189 注册；没有运行生成或测试实际速度。

本次 Windows 2.3.214 安装包在 `particle-editor-desktop/dist/h3-beta5-turbo-update` 独立目录构建，最终交付 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`。用户需要覆盖安装并重开正式客户端才能加载更新；本次没有写入先前被 Windows 拒绝写入的 Program Files 安装目录。

本轮 `check:entry` 为 NO-GO：4783 预览入口未启动，8188 直接探测可达。没有完成浏览器交互验收，也没有绕过此前阻止启动预览服务的策略限制。

前次 SageAttention 适配记录见 `h3-beta5-sage-acceleration-2026-09-12.md`。此前普通 beta5 部署文档属于历史记录，本文件中的模型映射优先。

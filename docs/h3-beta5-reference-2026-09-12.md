# beta5 TURBO 多参考接入

两个 beta5 TURBO 配置现接入 `MiniMaxH3ReferenceToVideo`。INT8 和 W4A8 的多参考流程各自加载同一选项下的 TURBO-hybrid 权重，不再固定加载旧 Ref2VA。H3 原版仍使用其原有专用 Ref2VA 权重。

界面启用 beta5 的“多参视频”，移除旧版专用提示；切换 beta5 选项时保留多参考模式，不强制跳回图生视频。现有参考图片、视频和音频上传、时长及格式校验保持原逻辑。普通 LoRA 继续按参考模式兼容性筛选。

SageAttention 自动启用，默认 4 步，不增加 Turbo LoRA。保持现有采样器、调度器和用户已保存参数。

## 验证范围

- 20 项所选 H3 工作流及界面契约检查通过。现有双模型测试扩展为四种模式，包含两张图片、参考视频和独立音频的组合。
- 多参考工作流的模型选择、跨配置拒绝、模板导出与重新应用、空参考拒绝、普通 LoRA 链路、SageAttention 路径均通过结构检查。
- bundle 语法和源码、renderer、win-unpacked 一致性检查通过。
- 8189 已注册参考节点和 SageAttention 节点；安装包中的工作流、bundle、HTML 与源文件哈希一致，旧界面限制已移除。
- 4783 预览入口仍不可达，`check:entry` 为 NO-GO；8188 直接探测可达。本轮没有浏览器点击验收。
- 未提交生成任务，没有验证实际参考一致性、质量或耗时；按用户要求由用户测试。

## 部署

客户端使用独立 `particle-editor-desktop/dist/h3-beta5-reference-update` 目录构建，保持 2.3.214，最终安装包为 `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`。正式客户端需覆盖安装并重开后生效；本次未写入先前被拒绝写入的 Program Files 安装目录，不重启用户生成引擎。

模型文件未移动、删除或改写。此处接入范围覆盖此前文档中“beta5 不支持多参考”的限制；当前状态为已接入、生成效果待用户验收。

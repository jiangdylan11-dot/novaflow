# 洗图固定使用 Wan

2026-09-13，NovaFlow 2.3.214。

洗图窗口移除了全部链路选择卡片，固定调用原版 Wan T2V Low Q4_K_S。保留附加 LoRA 开关、LoRA 强度（默认 0.60）和重绘强度（默认 0.20），窗口恢复为紧凑宽度。

SmoothMix 与 Qwen 洗图构建器、入口分支及导出已删除。旧调用即使携带 `smoothmix` 或 `qwenNsfw` 模式，也只能执行 Wan。其他编辑功能共用的 Rapid checkpoint 保留；本次没有删除本地模型文件。

验证：15 项相关测试通过。改动前后的 Wan 工作流在重绘 0.20 / 0.65、附加 LoRA 关闭 / 0.60 共四种组合下完全相同，见 `preserved-workflows.json`。此次没有重新运行历史生成实验。

安装包已按原版本号重新生成，见 `installer.json`。已核对包内代码与源代码一致、洗图选择卡片和两个旧构建器均已移除，以及四组 Wan 工作流保持不变。打包后 `check:runtime` 为 PASS；正式入口结果单独记录于 `validation.json`。

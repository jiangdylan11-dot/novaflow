# Wan 洗图手动提示词

洗图窗口新增可选的正面、负面提示词多行输入区。填写内容分别追加到原有正面提示词和负面条件，保留原图画风分析，与 LoRA 开关独立。默认留空，不注入任何固定用户提示词。

新增 CFG 调节，默认 1，范围 1–6。当前 ComfyUI 采样器在 CFG 1 时跳过负面条件；填写负面词后窗口明确提示将 CFG 调高才会参与引导。软件不自动提高 CFG。更高 CFG 会改变画面效果和耗时，不代表质量必然提高。

## 验证

- 18 项相关测试通过：UI 执行入口到真实 Wan builder 的参数传递、LoRA 开关独立性、中文输入与回车换行、CFG 提示、原有画风分析和其他 Rapid 功能回归。
- 4 组工作流与改动前逐节点一致：正负面留空、CFG 1，重绘强度 0.2/0.65 与 LoRA 0/0.6 的组合。见 default-parity.json。
- 已打包的对话框组件在隐藏 Electron 窗口通过真实 DOM 检查，默认空输入、换行与提交值正确。见 dialog-check.json、dialog.png。这项检查不等于整个正式应用的验收。
- 8188 实际生成成功，prompt ID 847519e3-92cc-4d3f-b54e-d7b7287f76b2，耗时 293.618 秒。测试使用普通插画和中性提示词，CFG 1.5，额外 LoRA 关闭。后台 history 与提交 workflow 完全一致。见 workflow.json、history.json、run.json、result.png。
- 实测沿用已记录的原图画风分析，未重新测试 Prompt Assistant。结果仍为插画，但这是一张链路验证图，不能据此认定画质提升或提示词服从度全面达标。
- 生成后其他任务进入 Runtime，跳过释放模型，保留其任务。原始验证脚本因此在清理阶段返回非零；成功生成的 history 与结果不受影响。未重跑生成。
- 无版本号升级打包完成；安装包、源码与包内脚本哈希见 installer.json。check:runtime PASS。
- check:entry 仍为 NO-GO：4783 入口不可达，并报告既有 AI 特效接入未完成。8188 直连正常。本次未完成正式预览入口验收。

安装包：D:\AI_APP\NovaFlow\particle-editor-desktop\dist\NovaFlow Setup 2.3.214.exe

保留 WAN 单一路线、LoRA 默认 0.60、重绘默认 0.20；未恢复 SmoothMix / Qwen 洗图选择。

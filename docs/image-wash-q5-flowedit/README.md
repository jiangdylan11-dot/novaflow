# Remix Q5 原图风格重绘候选

本候选已被否决：偏写实、重绘不足，不能替代原版 Wan。软件默认仍是原版 Wan。

用户反馈后重新对照：之前对 7 步方案“动漫表现恢复”的评价过于宽松，它仍有半写实光泽，变化量也不足。源图与目标预测相减会抵消共同变化；当描述接近时，这种编辑算法不能等同于原版 Wan 的直接加噪重绘。本目录保留实验依据，不再以补跑它的强度矩阵作为下一步。下一轮直接调用现有 8188 的标准 KSampler 验证，不涉及曾被拒绝的节点安装和后台进程启动。

本轮从特征参考转为源图与目标图的速度场差分。核心位于 `particle-editor-desktop/main/wan-wash-node/sampler.py`，可复用 Comfy 节点位于同目录 `__init__.py`。算法参照 [FlowEdit 官方实现](https://github.com/fallenshock/FlowEdit)，当前 Wan/GGUF 适配是本地实验，不代表论文已验证此模型。

## 已证实与限制

- 未加速方案：12 步、CFG 3、shift 1，0.2 / 0.65 的正式尺寸输出保住动漫画风；0.9 又偏写实，未通过。
- 已否决候选：原版 Wan 的加速 LoRA、7 步、CFG 1、shift 8；1 MP / 0.9 实测 66.047 秒，仍偏半写实且重绘不足。
- 最新候选的低、中强度、摄影和三维回归尚未完成。早期摄影结果使用旧动漫负面词，只能视作初步证据；测试器现已统一调用软件的原图类型提示词。
- 所有本页图像使用同一 Q5 主权重和种子 9122026，没有输出图混合。参数、代码哈希和实际调用次数在各 `*-run.json`。
- 独立工作进程测试不是 8188 `/history` 或 4783 UI 验收。
- 16 GB Windows GPU 与其他应用共用时，5 GiB 预留仍可能进入共享显存。7 GiB 预留已完成正式尺寸运行；节点的预算调整会在完成、失败或取消后恢复。
- 新候选节点尚未安装到运行中的 Runtime。安装/重启操作及后续 GPU 验证重启被自动审批拒绝，仅返回 blocked by policy，没有具体原因。

## 已改代码

- 新增 `buildWanSourceRedrawWorkflow` 候选工作流，`distilledCandidate: true` 明确选择最新 7 步方案；`runImageWash` 的默认路由未切换。
- 新增可复用节点和只写自身两个 Python 文件的安装辅助模块，未接入自动安装。
- 洗图 Qwen3-VL 分析单独启用加载后临时 CUDA 缓存清理。实际摄影图总分析约 37 秒，之前同图 300 秒超时；其他分析用途默认不改变。
- 按源图 SHA-256 缓存最多 8 项成功画风分析；失败不缓存，同名不同图不会复用。无需重复加载分析模型来测试另一强度。
- 修复 Qwen3 缓存锁在 Windows 使用 `os.kill(pid, 0)` 的错误：现在使用只读的进程句柄与零超时状态查询，不发送 Ctrl+C。原来反复中断的缓存测试现已完整通过 9 项，另有 23 项洗图分析、路由与工作流检查通过；这些检查不代表画质验收通过。详见 [中断排查](execution-interruption.md)。
- 已执行 `npm run sync:runtime`；`npm run check:runtime` 通过。`npm run check:entry` 仍为 NO-GO：4783 预览入口未响应，8188 直接探测成功；检查还列出 AI 特效接管集成未完成。这不是安装包或软件入口验收通过。

## 复现（需要可运行本地验证的环境）

已成功的高强度候选：

```powershell
& 'C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe' tools/wan-wash-reference-smoke.py --production-size --reference 0 --reference-mode flowedit --strength .9 --steps 7 --shift 8 --source-cfg 1 --target-cfg 1 --distilled --reserve-vram 7 --node --output docs/image-wash-q5-flowedit/anime-distilled-1mp
```

待完成的四项回归列在 `tools/validate-wan-source-distilled.ps1`。运行真实服务器工作流的脚本为 `tools/wan-source-wash-live-smoke.cjs`，最后一个参数 `distilled` 使用最新候选；需 Runtime 已提供 `NovaFlowWanSourceRedraw`。

摄影源图是 scikit-image 的 coffee.png（Rachel Michetti，CC0）。动漫、三维源图来自本任务已使用的本地资源。

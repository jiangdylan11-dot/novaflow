# 单图 30% 与美工主体透明度排查

## 结论与边界

- 用户截图中的 a.png 原图尚未取得，长期停在 30% 的现场原因未复现，不能宣称已修复。
- 单图分支在模型启动前发送 30%，原实现此后只等子进程返回。缺少中间反馈可以解释“等待时进度不动”，不能解释异常等待的具体原因。
- 本次只添加单图等待秒数、结束耗时与错误日志；没有新增超时，没有修改模型或美工透明度算法。
- 检查时安装目录与项目的 main.js、BiRefNet runner、renderer 主 bundle、spine-split-runtime.js 哈希一致，不能把现场问题直接归因于安装版本落后。

## 实际验证

- 现有后端回调配合本机 RMBG-2.0：512×512 样例约 14.8 秒返回。
- Electron 回归接入实际后端回调、Python、模型和进度事件，加载 dist 组件，512×512 椅子样例约 19 秒推理完成；预览有色主体像素 46092、透明背景像素 216052，弹窗关闭，PNG 导出成功。导出图已目视检查。
- 测试隔离了 app 生命周期、临时文件清理与命令封装；没有操作用户当前打开的完整客户端，样例也不是用户的 a.png。
- `logs/cutout-image-20260914/live-dist/after.json`、`backend/trace.jsonl`、`export.png` 保存此次证据，测试产物不提交。
- `npm run sync:runtime` 与 `npm run check:runtime` 通过。`node --check particle-editor-desktop/main.js` 通过。
- `npm run check:entry` 为 NO-GO：4783 没有监听，8188 直连正常。启动预览服务被自动审批拒绝（blocked by policy），未绕过限制。

## 美工智能抠图

当前入口为 `executeCutoutTool → runObjectExtractV2Pipeline → runRmbgCutout → sourceRgbWithModelAlpha → refineObjectAlphaMask → cleanupObjectExtractEdges`。

原始模型 alpha 被直接用于合成。内部保护针对原 alpha >=244 的像素，边缘清理保存并恢复 alpha，没有把全部主体变成不透明的步骤。

实际调用当前细化与清理函数的 Electron 回归结果：

| 主体内部输入 alpha | 细化后 | 清理后 |
| --- | --- | --- |
| 255 | 255 | 255 |
| 128 | 128 | 128 |

清理步骤的 alpha 改变量均为零。说明当前后处理不会把此类不透明内部主动减半，但模型若给出半透明主体，现有保护不会自动恢复。因此不能保证新版不存在反馈中的现象。截图是局部显示效果，缺少原图和实际 RGBA 导出，无法断定反馈案例来自模型、源图 alpha 还是显示叠加。

下一步使用用户 a.png 原图复现单图完整链路；美工案例需对照原图与实际导出的透明 PNG，避免把头发、薄纱或光效等合理透明度一并强制变实。

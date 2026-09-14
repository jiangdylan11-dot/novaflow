# 图片生成接入一级临时仓库

## 修复

一级入口 `runtime-open-output-folder` 打开当前会话的 `ai-sequence-cache` 目录。视频已经写入该目录；绘图只将下载结果转成 data URL、加入预览和原图资源，缺少写盘步骤。

- 在绘图与 UI 设计共用的 `artFetchBlob` 中，将 `/view` 返回的 output 类型 PNG/JPEG/WebP 原始字节通过现有 `aiSeqCacheTempFile` 写入同一目录。
- 根据来源服务、输出类型、子目录和文件名去重；图片采用 `image_日期_时间` 文件名，保留扩展名。视频命名保持原逻辑。
- 两处结果处理流程下载全部返回图片，仍使用第一张作为当前预览。
- 写盘失败明确提示“图片已生成，但加入临时仓库失败”；输入参考图不自动入库。浏览器预览没有桌面缓存 API，不进行本地入库。

## 验证

- 50 项针对性测试通过：图片仓库、UI 生成、绘图提供方集成、会话临时目录生命周期。
- H3 发布 IPC / 仓库入口的 3 项针对性测试通过。其完整旧测试中有一条固定要求 `index-BbIa-2NM.js?v=20260812-minimax-h3-assistant-1`；变更前 HEAD 已为 `20260914-pipeline-1`，因此该版本标签断言原本即失败，未修改无关 H3 测试。
- `npm run sync:runtime` 完成；`npm run check:runtime` PASS；`npm run check:entry` Overall: GO，4783 与 8188 可达。

在独立启动的 `dist/win-unpacked/NovaFlowPortable.exe` 中，临时替换该测试进程的工作流构建器为 `EmptyImage(batch_size=2) → SaveImage`，调用真实 `__NovaFlowArtGenerate.run()`。保留真实下发、历史轮询、下载、Electron IPC、写盘、预览数据转换与资源列表写入，最后还原构建器。未调用 AI 模型，验证的是生成完成后的资源链路。

- 状态为“生成完成”，错误为空，首张预览数据有效，`placedInSource=true`。
- 真实一级入口返回 `ok=true`，指向测试会话 `sessions/36528-1789385424953-a578733af8/ai-sequence-cache`。
- 目录内有 `image_20260914_183146.png` 与 `image_20260914_183146_2.png`，各 424 字节。
- 两个文件分别与 Runtime 输出原图的 SHA-256 相同：`ee56c2d8b52ce80b049353c6888c6967e6fc64bdd6160ed7c4b64e65ecff3903`。

本次同步源码、renderer 和 dist 运行文件，未重建安装包，未替换 `C:/Program Files/NovaFlowPortable` 的已安装客户端。

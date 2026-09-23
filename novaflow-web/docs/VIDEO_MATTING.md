# WEB 视频抠图

网页通过现有任务接口将已捕获的 PNG 帧交给连接的算力机，复用本仓库的
`particle-editor-desktop/main/birefnet-runner.py`。本机模式走助手私有队列；
共享模式走现有控制面和文件网关。浏览器无需安装 Python，也不执行模型推理。

传输使用 `video_matting` / `png-frames-v1`：每帧为小端 `u32 index`、
`u32 length` 和原始 PNG。每个包不超过 64 MiB，最多 4 个包、300 帧。
算力机逐帧校验格式、尺寸、数量后推理，返回同尺寸的 `u8-mask-v1` 遮罩。
网页的预览事件和最终结果使用同一份 alpha 数据，保留原有合成和保存流程。
不重新解码源视频，不依赖文件名或页面中的第一个 video 元素定位素材。

助手需能找到 Pillow、torch、兼容的 transformers 4.x 和 BiRefNet 模型。
算力机缺少推理环境时不报告该模型可用。安装包将 Python 入口放在 resources
目录，避免外部 Python 无法读取 Electron asar 内部文件。

## 验证记录（2026-09-23）

- 浏览器适配器回归覆盖真实解压、帧索引、原始 PNG 包传输和损坏结果拒绝。
- 共享控制面使用真实 PGlite SQL，验证注册、排队、领取、遮罩清单、下载授权和零积分计费。
- `tests/e2e/video-matting-packs.test.py` 验证跨包原始 PNG 字节保持，以及截断、错序、缺帧和错尺寸拒绝。
- 真实浏览器通过已授权助手调用本机 BiRefNet：模板 `slot-symbol-pop.mp4`，
  640×640、39 帧，约 23 秒返回 15,974,400 字节 alpha 和 39 个预览事件；
  已目视确认透明棋盘背景上的抠图结果。
- 人工验收页为 `tests/manual/video-matting.html`。在本机助手启动且浏览器完成配对后，
  将它临时复制为 `web-dist/video-matting-acceptance.html` 即可测试；它不进入正式源码构建。

上述实测覆盖网页接口、实际推理及透明预览。没有原始报错视频，未验证该 91 帧素材；
完整编辑器的保存交互、线上站点、已安装启动助手尚未做本次发布验收。
部署时须同步更新站点、控制面和算力助手；仅刷新旧线上页面不会增加算力节点的新任务能力。

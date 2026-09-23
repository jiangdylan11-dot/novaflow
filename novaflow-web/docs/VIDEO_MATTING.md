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
完整编辑器的线上抠图与保存交互仍待导入视频验收。

2026-09-23 已完成正式站点、控制面和已安装助手 0.4.5 的同步更新；正式地址与名称保持不变。
线上适配器逐字节匹配交付 ZIP，控制面健康且识别视频抠图，已安装节点报告 0.4.5 和模型 ready。
安装包、ZIP、部署编号和文件校验见 [0.4.5 发布记录](releases/0.4.5.md)。

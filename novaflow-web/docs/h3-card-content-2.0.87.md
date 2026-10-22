# H3 卡片内容修正候选 2.0.87

仅按用户最新规格修正卡片内容。横向满宽、位置、入口顺序、容量、存档、提示词和最终节点绑定保持 2.0.86 行为；未重新设计页面。未重试失败的 Library 下载流程，用户原截图由主会话查看。

## 修改与依据

上一版图片被接管为自定义预览，并叠加了类型文字/编号；可见标题使用类型编号，mediaName 没有传原始 fileName，因此文件名被替换。本版撤回这些展示改动：

- 图片走原 nfAiSeqRefDropzone 的直接 img 分支，src 使用原始 dataUrl；无图片类型图标、类型文字或“图片 N”。原缩略图与底部实际文件名保留。
- 视频/音频只有左上角 14px 对应 SVG 小图标，中间居中显示实际秒数，底部显示实际原始文件名。没有“视频/音频”类别文字、大播放三角或大音符。
- 原右上删除和三个添加入口保持。长文件名用原标题区域单行省略，悬停可读完整原名；加号仍只在添加入口。
- 只有 H3 的 JS/CSS 卡片展示部分修改。原 bundle 和 novaflow-brand-runtime 没有修改；逐字检查确认 layoutReferenceBar、存储/容量/绑定前缀、API 导出和横向几何 CSS 与 2.0.86 一致。

未单凭源码断言用户黑图的唯一成因。已恢复原图片分支，并用运行时检查原始 src、naturalWidth/Height、可见性、图片/文件名不重叠和实际截图像素，确认本版测试素材可见且不是黑色块。

## 已验证

源码和最终包内资源各通过 34 个生成区运行时场景。保留既有满宽、横向滚动、3+3 同屏、容量显隐、删除恢复、连续上传、三视频同时拖入、两模型切换、layers 样式、窄容器、存档重开和伪元素加号检查。

新增真实 File.name 导入素材：product-front-original-photo.png、product-side-original-photo.png、camera-reference-long-original-filename.mp4（23.8s）、speaker-reference-original-voice.wav（2.5s）。检查：

- 原生 img 直接接收原图片 src，原图 256×256，实际缩略图尺寸可见，opacity=1、visibility=visible、无滤镜；截图图像区域具有原图亮色/彩色像素，非黑块。
- 底部可见文本等于实际原始 fileName，悬停标题为完整同名文件；省略样式生效。
- 图片没有图标或预览覆盖层；视频/音频只有 ≤16px 的左上角对应图标，秒数在预览区域中心。
- 视频/音频实测显示 23.8s / 2.5s；没有额外类别文字或大播放符号。23.8s 文件仅用于 UI 显示测试，没有提交采样，也没有扩大既有参考时长规则。

重点截图：worker/dist/h3-beta6-2.0.87/visual-check/beta5_int8-named-files.png、beta6_int8-named-files.png。results.json 保存 src、尺寸、文件名、坐标及伪元素等检查结果。

包内 worker-renderer 的 beta5/beta6 各 15 素材队列、重映射、节点输入绑定及重开另行通过。H3 Node 合并 8 个测试通过；sync:runtime、check:runtime、check:entry 通过，entry 四个文件内部检查为 48、63、138、32 项。

## 本地候选安装包

worker/dist/h3-beta6-2.0.87/NovaFlowSetup-2.0.87.exe

大小：129,550,295 字节。
SHA256：81de14b112d40cacbcdcb5b6645eba8b89912c0567df89e99f057527dbc244db。

包内 H3 JS/CSS 与源文件逐一哈希一致。旧包保留，未自动安装、重启、显示登录窗口、接管前台、运行 GPU 或部署。没有 Supabase 修改。用户自行安装并重开客户端才生效。打包基于当前工作树；其他窗口已有工作保留，本任务只提交相关文件。

## 尚未验收

以上使用实际生成区代码、CSS 和运行时函数的受控渲染测试；空闲任务状态与关闭的历史弹窗有测试适配器。不是已登录完整应用或真实 GPU 生成验收。完整应用、用户原始素材在实机中的最终表现及 16GB 显存下 9+3+3 出图仍需后续确认，不冒充通过。